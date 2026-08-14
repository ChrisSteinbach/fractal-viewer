import {
  packBulbGpuParams,
  packEscapeGpuMaps,
  packEscapeGpuParams,
  packSurface4GpuParams,
  packSurfaceGpuMaps,
  packSurfaceGpuMaps4,
  packSurfaceGpuParams,
  packSurfaceGpuShade,
  packSurfaceGpuShadeMaps,
  SURFACE_GPU_HIT_FLOOR,
  SURFACE_GPU_MAP4_VEC4,
  SURFACE_GPU_MAP_VEC4,
  SURFACE_GPU_PARAMS4_BYTES,
  SURFACE_GPU_PARAMS4_LENS_BYTES,
  SURFACE_GPU_PARAMS_BALLOON_BYTES,
  SURFACE_GPU_PARAMS_BYTES,
  SURFACE_GPU_PARAMS_PLANE_BYTES,
  SURFACE_GPU_RAY_ACTIVE,
  SURFACE_GPU_RAY_EXHAUSTED,
  SURFACE_GPU_RAY_HIT,
  SURFACE_GPU_RAY_MISS,
  SURFACE_GPU_RAY_PLANE,
  SURFACE_GPU_SHADE_BYTES,
  SURFACE_GPU_UNIFORM_MAP_SLOTS,
  surfaceDeKernelWgsl,
  surfaceGpuWorkgroupBytes,
} from "./surface-de-gpu";
import {
  BALLOON_FAR_CAP_RHO,
  BALLOON_RHO_MARGIN,
  balloonBall,
  buildBalloon,
} from "./balloon-de";
import type {
  SurfaceGpu4View,
  SurfaceGpuGroundPlane,
  SurfaceGpuKernelOptions,
  SurfaceGpuPose,
  SurfaceGpuShadeParams,
} from "./surface-de-gpu";
import { buildBulbDE, BULB_ITERATIONS, BULB_STEP_SCALE } from "./bulb-de";
import {
  buildEscapeDE,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
} from "./escape-de";
import {
  buildSurfaceDE,
  CLASSIC_SURFACE_FOLD_RADII,
  SURFACE_FOLD_BOXFOLD,
} from "./surface-de";
import type { SurfaceDE } from "./surface-de";
import { buildSurfaceDE4, radiusBandInvRange } from "./surface-de-4d";
import type { SurfaceDE4 } from "./surface-de-4d";
import type { Transform } from "./types";

/** Two-map pure-boxfold system (the fr-5rvk shape used throughout
 * surface-de.test.ts and scripts/harness-profiles.ts's foldBoxfoldPair) — a
 * minimal ELIGIBLE fold system, so buildSurfaceDE gives a real SurfaceDE with
 * non-trivial per-map fold fields to pin the packer's byte layout against. */
function foldSystemTransforms(): Transform[] {
  return [
    {
      id: 0,
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.45, 0.45, 0.45],
      variations: [{ type: "boxfold", weight: 1 }],
    },
    {
      id: 1,
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.5, 0.5, 0.5],
      variations: [{ type: "boxfold", weight: 0.9 }],
    },
  ];
}

/** Plain affine final transform (no variations) — gives `SurfaceDE.final` a
 * real, non-identity lens to round-trip against the packer's finalM/finalT
 * offsets, as a counterpart to the no-final-transform identity case. */
function affineFinalTransform(): Transform {
  return {
    id: 99,
    position: [0.3, -0.2, 0.1],
    rotation: [0.4, 0.2, -0.3],
    scale: [0.8, 0.8, 0.8],
  };
}

/** Pure-spherefold FINAL transform (rotated/offset affine part, non-unit
 * weight) — gives `SurfaceDE.foldFinal` a real, BUILT lens, so the packer's
 * identity-final-under-the-lens contract and the 208+ block are pinned
 * against `buildSurfaceDE`'s own output rather than a hand-crafted object
 * (fr-55s1 stage B). */
function spherefoldFinalTransform(): Transform {
  return {
    id: 98,
    position: [0.12, -0.05, 0.08],
    rotation: [0.3, 0.1, -0.2],
    scale: [0.9, 0.9, 0.9],
    variations: [{ type: "spherefold", weight: 0.9 }],
  };
}

/** The canonical single-map Mandelbox shape (escape-de.test.ts's fixture) —
 * a minimal ELIGIBLE escape system, so buildEscapeDE gives a real EscapeDE
 * to pin the ESCAPE core packer/generator against. */
function canonicalMandelbox(): Transform {
  return {
    id: 0,
    position: [0.4, 0.3, 0.2],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight: 2 }],
  };
}

/** Same shape with a NEGATIVE weight and a non-unit scale, so `w` (-2) and
 * `derivGrowth` (|w|·sigmaMax = 3) land on distinct values — a same-sign
 * same-magnitude fixture would let the 208..271 variant block's offset
 * 260/264 pair swap silently. */
function negativeWeightMandelbox(): Transform {
  return {
    id: 0,
    position: [0.4, 0.3, 0.2],
    rotation: [0, 0, 0],
    scale: [1.5, 1.5, 1.5],
    variations: [{ type: "mandelbox", weight: -2 }],
  };
}

/** A second, DIFFERENT link for the chain fixtures (fr-s04t): a rotated
 * boxfold at weight 1.6 — a different fold kind, weight and matrix from
 * {@link canonicalMandelbox}, so a packer that wrote the head link n times
 * (or read slot 0 every step) could not pass. */
function rotatedBoxfold(): Transform {
  return {
    id: 1,
    position: [0, 0, 0],
    rotation: [0, 0.35, 0],
    scale: [1, 1, 1],
    variations: [{ type: "boxfold", weight: 1.6 }],
  };
}

/** Default kernel-generator options, overridable per test — mirrors
 * flame-gpu.test.ts's baseSpec() convention. */
function kernelOpts(
  overrides: Partial<SurfaceGpuKernelOptions> = {},
): SurfaceGpuKernelOptions {
  return {
    mode: "eval",
    width: 4,
    workgroupSize: 32,
    sharedFrontier: false,
    bnbStage2: false,
    ...overrides,
  };
}

describe("packSurfaceGpuParams byte length", () => {
  it("returns an ArrayBuffer of exactly SURFACE_GPU_PARAMS_BYTES (272 bytes since the fr-55s1 lens block, per the module doc)", () => {
    expect(SURFACE_GPU_PARAMS_BYTES).toBe(272);
    const de = buildSurfaceDE(foldSystemTransforms());
    const buf = packSurfaceGpuParams(de, { itemCount: 5 });
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_BYTES);
  });
});

describe("packSurfaceGpuParams field round-trip (doc offsets)", () => {
  it("round-trips boundCenter/boundingRadius/escapeRadius/stepScale/visibleBoundingRadius/slowestSigma/stepCos/stepSin/mapCount/maxDepth at their documented offsets", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const view = new DataView(packSurfaceGpuParams(de, { itemCount: 1 }));

    expect(view.getFloat32(0, true)).toBe(Math.fround(de.boundCenter[0]));
    expect(view.getFloat32(4, true)).toBe(Math.fround(de.boundCenter[1]));
    expect(view.getFloat32(8, true)).toBe(Math.fround(de.boundCenter[2]));
    expect(view.getFloat32(12, true)).toBe(Math.fround(de.boundingRadius));
    expect(view.getFloat32(16, true)).toBe(Math.fround(de.escapeRadius));
    expect(view.getFloat32(20, true)).toBe(Math.fround(de.stepScale));
    expect(view.getFloat32(24, true)).toBe(
      Math.fround(de.visibleBoundingRadius),
    );
    expect(view.getFloat32(28, true)).toBe(Math.fround(de.slowestSigma));
    expect(view.getFloat32(32, true)).toBe(Math.fround(de.symmetry.stepCos));
    expect(view.getFloat32(36, true)).toBe(Math.fround(de.symmetry.stepSin));
    expect(view.getUint32(40, true)).toBe(de.symmetry.order);
    expect(view.getUint32(48, true)).toBe(de.maps.length);
    expect(view.getUint32(52, true)).toBe(de.maxDepth);
  });

  it("maps symmetry plane yz/xz/xy to symPlane 0/1/2 at offset 44 — the frozen pre-fr-q0h6 axis codes", () => {
    for (const [plane, expected] of [
      ["yz", 0],
      ["xz", 1],
      ["xy", 2],
    ] as const) {
      const de = buildSurfaceDE(foldSystemTransforms(), null, {
        order: 1,
        plane,
      });
      const view = new DataView(packSurfaceGpuParams(de, { itemCount: 1 }));
      expect(view.getUint32(44, true)).toBe(expected);
    }
  });

  it("round-trips the run params' itemCount/stepsThisPass/cutoff/footprint/marchSteps at their documented offsets", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const view = new DataView(
      packSurfaceGpuParams(de, {
        itemCount: 777,
        stepsThisPass: 12,
        cutoff: 0.025,
        footprint: 0.125,
        marchSteps: 160,
      }),
    );
    expect(view.getUint32(56, true)).toBe(777);
    expect(view.getUint32(60, true)).toBe(12);
    expect(view.getFloat32(64, true)).toBe(Math.fround(0.025));
    expect(view.getFloat32(68, true)).toBe(Math.fround(0.125));
    expect(view.getUint32(72, true)).toBe(160);
  });

  it("defaults stepsThisPass/cutoff/footprint/marchSteps to the documented zero when the run params omit them", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const view = new DataView(packSurfaceGpuParams(de, { itemCount: 3 }));
    expect(view.getUint32(60, true)).toBe(0);
    expect(view.getFloat32(64, true)).toBe(0);
    expect(view.getFloat32(68, true)).toBe(0);
    expect(view.getUint32(72, true)).toBe(0);
  });

  it("packs hitFloorEps at offset 80 as fround(boundingRadius * SURFACE_GPU_HIT_FLOOR)", () => {
    expect(SURFACE_GPU_HIT_FLOOR).toBe(1.0e-5);
    const de = buildSurfaceDE(foldSystemTransforms());
    const view = new DataView(packSurfaceGpuParams(de, { itemCount: 1 }));
    expect(view.getFloat32(80, true)).toBe(
      Math.fround(de.boundingRadius * SURFACE_GPU_HIT_FLOOR),
    );
  });
});

describe("packSurfaceGpuParams final-transform lens", () => {
  it("packs an absent final transform's lens as the identity matrix, zero translation, and sigmaMin 1", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    expect(de.final).toBeNull();
    const view = new DataView(packSurfaceGpuParams(de, { itemCount: 1 }));

    // finalM row0 = [1, 0, 0], finalT.x = 0.
    expect(view.getFloat32(96, true)).toBe(1);
    expect(view.getFloat32(100, true)).toBe(0);
    expect(view.getFloat32(104, true)).toBe(0);
    expect(view.getFloat32(108, true)).toBe(0);
    // finalM row1 = [0, 1, 0], finalT.y = 0.
    expect(view.getFloat32(112, true)).toBe(0);
    expect(view.getFloat32(116, true)).toBe(1);
    expect(view.getFloat32(120, true)).toBe(0);
    expect(view.getFloat32(124, true)).toBe(0);
    // finalM row2 = [0, 0, 1], finalT.z = 0.
    expect(view.getFloat32(128, true)).toBe(0);
    expect(view.getFloat32(132, true)).toBe(0);
    expect(view.getFloat32(136, true)).toBe(1);
    expect(view.getFloat32(140, true)).toBe(0);
    expect(view.getFloat32(156, true)).toBe(1); // finalSigmaMin
  });

  it("round-trips a real affine final transform's invM rows / invT / sigmaMin at their documented offsets", () => {
    const de = buildSurfaceDE(foldSystemTransforms(), affineFinalTransform());
    if (!de.final) throw new Error("expected an affine final lens");
    const f = de.final;
    const view = new DataView(packSurfaceGpuParams(de, { itemCount: 1 }));

    expect(view.getFloat32(96, true)).toBe(Math.fround(f.invM[0]));
    expect(view.getFloat32(100, true)).toBe(Math.fround(f.invM[1]));
    expect(view.getFloat32(104, true)).toBe(Math.fround(f.invM[2]));
    expect(view.getFloat32(108, true)).toBe(Math.fround(f.invT[0]));
    expect(view.getFloat32(112, true)).toBe(Math.fround(f.invM[3]));
    expect(view.getFloat32(116, true)).toBe(Math.fround(f.invM[4]));
    expect(view.getFloat32(120, true)).toBe(Math.fround(f.invM[5]));
    expect(view.getFloat32(124, true)).toBe(Math.fround(f.invT[1]));
    expect(view.getFloat32(128, true)).toBe(Math.fround(f.invM[6]));
    expect(view.getFloat32(132, true)).toBe(Math.fround(f.invM[7]));
    expect(view.getFloat32(136, true)).toBe(Math.fround(f.invM[8]));
    expect(view.getFloat32(140, true)).toBe(Math.fround(f.invT[2]));
    expect(view.getFloat32(156, true)).toBe(Math.fround(f.sigmaMin));
  });

  it("round-trips a foldFinal lens's invM rows / invT / lensParams at the documented 208..271 offsets (fr-55s1 stage B)", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    // Synthetic, distinctive lens values — this pins the byte LAYOUT, not
    // eligibility (the throw-free packing of a real lens system is the
    // bench's job).
    const withFoldFinal: SurfaceDE = {
      ...de,
      final: null,
      foldFinal: {
        invM: [1.5, 0.25, -0.5, 0.125, 2.5, 0.75, -0.25, 0.375, 3.5],
        invT: [0.1, -0.2, 0.3],
        sigmaMin: 0.7,
        foldKind: 3,
        invW: 2.5,
        absW: 0.4,
        foldRadii: CLASSIC_SURFACE_FOLD_RADII,
      },
    };
    const view = new DataView(
      packSurfaceGpuParams(withFoldFinal, { itemCount: 1 }),
    );
    expect(view.getFloat32(208, true)).toBeCloseTo(1.5, 6);
    expect(view.getFloat32(212, true)).toBeCloseTo(0.25, 6);
    expect(view.getFloat32(216, true)).toBeCloseTo(-0.5, 6);
    expect(view.getFloat32(220, true)).toBeCloseTo(0.1, 6);
    expect(view.getFloat32(224, true)).toBeCloseTo(0.125, 6);
    expect(view.getFloat32(228, true)).toBeCloseTo(2.5, 6);
    expect(view.getFloat32(232, true)).toBeCloseTo(0.75, 6);
    expect(view.getFloat32(236, true)).toBeCloseTo(-0.2, 6);
    expect(view.getFloat32(240, true)).toBeCloseTo(-0.25, 6);
    expect(view.getFloat32(244, true)).toBeCloseTo(0.375, 6);
    expect(view.getFloat32(248, true)).toBeCloseTo(3.5, 6);
    expect(view.getFloat32(252, true)).toBeCloseTo(0.3, 6);
    expect(view.getFloat32(256, true)).toBe(3);
    expect(view.getFloat32(260, true)).toBeCloseTo(2.5, 6);
    expect(view.getFloat32(264, true)).toBeCloseTo(0.4, 6);
    expect(view.getFloat32(268, true)).toBeCloseTo(0.7, 6);
  });

  it("zero-fills the whole 208..271 lens block when the DE has no foldFinal", () => {
    const de = buildSurfaceDE(foldSystemTransforms(), affineFinalTransform());
    const view = new DataView(packSurfaceGpuParams(de, { itemCount: 1 }));
    for (let off = 208; off < 272; off += 4) {
      expect(view.getFloat32(off, true)).toBe(0);
    }
  });

  it("packs a BUILT foldFinal system's core final as identity/1 and round-trips the built lens block (the wrapper alone applies the lens)", () => {
    const de = buildSurfaceDE(
      foldSystemTransforms(),
      spherefoldFinalTransform(),
    );
    // buildSurfaceDE's invariant, load-bearing for the cores: under a
    // foldFinal the affine `final` slot is null, so the packer's fallback
    // hands the descent cores the identity lens and sigmaMin 1 — they run
    // their no-lens arithmetic verbatim, exactly like the CPU cores under
    // descendLens.
    expect(de.final).toBeNull();
    const lens = de.foldFinal;
    if (!lens) throw new Error("expected a foldFinal lens");
    const view = new DataView(packSurfaceGpuParams(de, { itemCount: 1 }));

    expect(view.getFloat32(96, true)).toBe(1);
    expect(view.getFloat32(100, true)).toBe(0);
    expect(view.getFloat32(104, true)).toBe(0);
    expect(view.getFloat32(108, true)).toBe(0);
    expect(view.getFloat32(112, true)).toBe(0);
    expect(view.getFloat32(116, true)).toBe(1);
    expect(view.getFloat32(120, true)).toBe(0);
    expect(view.getFloat32(124, true)).toBe(0);
    expect(view.getFloat32(128, true)).toBe(0);
    expect(view.getFloat32(132, true)).toBe(0);
    expect(view.getFloat32(136, true)).toBe(1);
    expect(view.getFloat32(140, true)).toBe(0);
    expect(view.getFloat32(156, true)).toBe(1); // finalSigmaMin

    expect(view.getFloat32(208, true)).toBe(Math.fround(lens.invM[0]));
    expect(view.getFloat32(212, true)).toBe(Math.fround(lens.invM[1]));
    expect(view.getFloat32(216, true)).toBe(Math.fround(lens.invM[2]));
    expect(view.getFloat32(220, true)).toBe(Math.fround(lens.invT[0]));
    expect(view.getFloat32(224, true)).toBe(Math.fround(lens.invM[3]));
    expect(view.getFloat32(228, true)).toBe(Math.fround(lens.invM[4]));
    expect(view.getFloat32(232, true)).toBe(Math.fround(lens.invM[5]));
    expect(view.getFloat32(236, true)).toBe(Math.fround(lens.invT[1]));
    expect(view.getFloat32(240, true)).toBe(Math.fround(lens.invM[6]));
    expect(view.getFloat32(244, true)).toBe(Math.fround(lens.invM[7]));
    expect(view.getFloat32(248, true)).toBe(Math.fround(lens.invM[8]));
    expect(view.getFloat32(252, true)).toBe(Math.fround(lens.invT[2]));
    // lensParams — (foldKind, invW, absW, sigmaMin), the GLSL uLensParams
    // order (module doc table).
    expect(view.getFloat32(256, true)).toBe(lens.foldKind);
    expect(view.getFloat32(260, true)).toBe(Math.fround(lens.invW));
    expect(view.getFloat32(264, true)).toBe(Math.fround(lens.absW));
    expect(view.getFloat32(268, true)).toBe(Math.fround(lens.sigmaMin));
  });

  it("throws when a footprint is combined with a foldFinal lens (the fr-55s1 cut boundary)", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const withFoldFinal: SurfaceDE = {
      ...de,
      final: null,
      foldFinal: {
        invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        invT: [0, 0, 0],
        sigmaMin: 1,
        foldKind: SURFACE_FOLD_BOXFOLD,
        invW: 1,
        absW: 1,
        foldRadii: CLASSIC_SURFACE_FOLD_RADII,
      },
    };
    expect(() =>
      packSurfaceGpuParams(withFoldFinal, { itemCount: 1, footprint: 0.01 }),
    ).toThrow(/footprint/);
    expect(() =>
      packSurfaceGpuParams(withFoldFinal, { itemCount: 1, footprint: 0 }),
    ).not.toThrow();
  });

  it("throws when foldFinal and final are both set — buildSurfaceDE's exclusivity invariant", () => {
    const de = buildSurfaceDE(foldSystemTransforms(), affineFinalTransform());
    expect(de.final).not.toBeNull();
    const violating: SurfaceDE = {
      ...de,
      foldFinal: {
        invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        invT: [0, 0, 0],
        sigmaMin: 1,
        foldKind: SURFACE_FOLD_BOXFOLD,
        invW: 1,
        absW: 1,
        foldRadii: CLASSIC_SURFACE_FOLD_RADII,
      },
    };
    expect(() => packSurfaceGpuParams(violating, { itemCount: 1 })).toThrow(
      /exclusive/,
    );
  });

  it("balloon third-arg null (and omitted) returns today's 272-byte buffer byte for byte (fr-5wlv.5)", () => {
    const de = buildSurfaceDE(foldSystemTransforms(), affineFinalTransform());
    const omitted = new Uint8Array(packSurfaceGpuParams(de, { itemCount: 3 }));
    const explicit = new Uint8Array(
      packSurfaceGpuParams(de, { itemCount: 3 }, null),
    );
    expect(omitted.byteLength).toBe(SURFACE_GPU_PARAMS_BYTES);
    expect(explicit).toEqual(omitted);
  });

  it("packs the balloon block at the frozen 272..303 offsets from buildBalloon's numbers, growing the buffer to 304 without touching 0..271 (fr-5wlv.5)", () => {
    expect(SURFACE_GPU_PARAMS_BALLOON_BYTES).toBe(304);
    const de = buildSurfaceDE(foldSystemTransforms());
    // The oracle link: the packed block is buildBalloon's convention —
    // MARGINED rho as the divisor, R in world units, the far cap in raw
    // ball radii — so the kernel and estimateBalloonDistance certify
    // against the same ball.
    const ball = balloonBall(de);
    const b = buildBalloon(de, 1.6);
    const balloon = {
      center: b.center,
      rho: b.rho,
      R: b.R,
      far: BALLOON_FAR_CAP_RHO * ball.radius,
    };
    const plain = new Uint8Array(packSurfaceGpuParams(de, { itemCount: 7 }));
    const buf = packSurfaceGpuParams(de, { itemCount: 7 }, balloon);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_BALLOON_BYTES);
    expect(new Uint8Array(buf, 0, SURFACE_GPU_PARAMS_BYTES)).toEqual(plain);
    const view = new DataView(buf);
    expect(view.getFloat32(272, true)).toBe(Math.fround(b.center[0]));
    expect(view.getFloat32(276, true)).toBe(Math.fround(b.center[1]));
    expect(view.getFloat32(280, true)).toBe(Math.fround(b.center[2]));
    expect(view.getFloat32(284, true)).toBe(
      Math.fround(ball.radius * BALLOON_RHO_MARGIN),
    );
    expect(view.getFloat32(288, true)).toBe(Math.fround(1.6 * ball.radius));
    expect(view.getFloat32(292, true)).toBe(
      Math.fround(BALLOON_FAR_CAP_RHO * ball.radius),
    );
    expect(view.getFloat32(296, true)).toBe(0);
    expect(view.getFloat32(300, true)).toBe(0);
  });

  it("throws when a footprint is combined with the balloon (the fr-5wlv.5 cut boundary)", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const b = buildBalloon(de, 0.9);
    const balloon = { center: b.center, rho: b.rho, R: b.R, far: 10 };
    expect(() =>
      packSurfaceGpuParams(de, { itemCount: 1, footprint: 0.01 }, balloon),
    ).toThrow(/footprint/);
    expect(() =>
      packSurfaceGpuParams(de, { itemCount: 1, footprint: 0 }, balloon),
    ).not.toThrow();
  });
});

describe("packSurfaceGpuParams pose", () => {
  it("packs pose ro/right/up/fwd/tanHalf/aspect/pixelEps/rasterWidth/rasterHeight at their documented offsets when a pose is given", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const pose: SurfaceGpuPose = {
      ro: [1.1, 2.2, 3.3],
      right: [1, 0, 0],
      up: [0, 1, 0],
      fwd: [0, 0, -1],
      tanHalf: 0.5773,
      aspect: 1.7778,
      rasterWidth: 640,
      rasterHeight: 360,
      pixelEps: 0.0007,
    };
    const view = new DataView(packSurfaceGpuParams(de, { itemCount: 1, pose }));

    expect(view.getFloat32(76, true)).toBe(Math.fround(pose.pixelEps));
    expect(view.getUint32(84, true)).toBe(pose.rasterWidth);
    expect(view.getUint32(88, true)).toBe(pose.rasterHeight);
    expect(view.getFloat32(144, true)).toBe(Math.fround(pose.ro[0]));
    expect(view.getFloat32(148, true)).toBe(Math.fround(pose.ro[1]));
    expect(view.getFloat32(152, true)).toBe(Math.fround(pose.ro[2]));
    expect(view.getFloat32(160, true)).toBe(Math.fround(pose.right[0]));
    expect(view.getFloat32(164, true)).toBe(Math.fround(pose.right[1]));
    expect(view.getFloat32(168, true)).toBe(Math.fround(pose.right[2]));
    expect(view.getFloat32(172, true)).toBe(Math.fround(pose.tanHalf));
    expect(view.getFloat32(176, true)).toBe(Math.fround(pose.up[0]));
    expect(view.getFloat32(180, true)).toBe(Math.fround(pose.up[1]));
    expect(view.getFloat32(184, true)).toBe(Math.fround(pose.up[2]));
    expect(view.getFloat32(188, true)).toBe(Math.fround(pose.aspect));
    expect(view.getFloat32(192, true)).toBe(Math.fround(pose.fwd[0]));
    expect(view.getFloat32(196, true)).toBe(Math.fround(pose.fwd[1]));
    expect(view.getFloat32(200, true)).toBe(Math.fround(pose.fwd[2]));
  });

  it("packs the documented pose defaults (ro=0, right=+x, up=+y, fwd=+z, tanHalf=0, aspect=1, pixelEps=0, raster=0) when no pose is given", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const view = new DataView(packSurfaceGpuParams(de, { itemCount: 1 }));

    expect(view.getFloat32(76, true)).toBe(0); // pixelEps
    expect(view.getUint32(84, true)).toBe(0); // rasterWidth
    expect(view.getUint32(88, true)).toBe(0); // rasterHeight
    expect(view.getFloat32(144, true)).toBe(0); // ro
    expect(view.getFloat32(148, true)).toBe(0);
    expect(view.getFloat32(152, true)).toBe(0);
    expect(view.getFloat32(160, true)).toBe(1); // right = +x
    expect(view.getFloat32(164, true)).toBe(0);
    expect(view.getFloat32(168, true)).toBe(0);
    expect(view.getFloat32(172, true)).toBe(0); // tanHalf
    expect(view.getFloat32(176, true)).toBe(0); // up = +y
    expect(view.getFloat32(180, true)).toBe(1);
    expect(view.getFloat32(184, true)).toBe(0);
    expect(view.getFloat32(188, true)).toBe(1); // aspect
    expect(view.getFloat32(192, true)).toBe(0); // fwd = +z
    expect(view.getFloat32(196, true)).toBe(0);
    expect(view.getFloat32(200, true)).toBe(1);
  });
});

describe("packSurfaceGpuParams run overrides", () => {
  it("packs run.maxDepth at offset 52 in place of de.maxDepth", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const view = new DataView(
      packSurfaceGpuParams(de, { itemCount: 1, maxDepth: de.maxDepth + 3 }),
    );
    expect(view.getUint32(52, true)).toBe(de.maxDepth + 3);
  });

  it("derives offset 80 from run.hitFloor when given (fround(R * hitFloor))", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const view = new DataView(
      packSurfaceGpuParams(de, { itemCount: 1, hitFloor: 0.02 }),
    );
    expect(view.getFloat32(80, true)).toBe(
      Math.fround(de.boundingRadius * 0.02),
    );
  });

  it("keeps the documented defaults (de.maxDepth, SURFACE_GPU_HIT_FLOOR) when both overrides are omitted", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const view = new DataView(packSurfaceGpuParams(de, { itemCount: 1 }));
    expect(view.getUint32(52, true)).toBe(de.maxDepth);
    expect(view.getFloat32(80, true)).toBe(
      Math.fround(de.boundingRadius * SURFACE_GPU_HIT_FLOOR),
    );
  });

  // fr-5h5d: offset 204 is the former pad1 slot, claimed for the fog
  // density multiplier every core's shared shade entry reads.
  it("defaults offset 204 (fogDensity, former pad1) to 1 when run.fogDensity is omitted", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const view = new DataView(packSurfaceGpuParams(de, { itemCount: 1 }));
    expect(view.getFloat32(204, true)).toBe(1);
  });

  it("round-trips a non-default run.fogDensity at offset 204", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const view = new DataView(
      packSurfaceGpuParams(de, { itemCount: 1, fogDensity: 0.35 }),
    );
    expect(view.getFloat32(204, true)).toBe(Math.fround(0.35));
  });
});

describe("packSurfaceGpuMaps", () => {
  it("packs each map's invM/invT/sigmaMin/foldInvW/foldSigma/foldKind/bnbDir/invTNorm/invMSigmaMin at the documented word offsets", () => {
    expect(SURFACE_GPU_MAP_VEC4).toBe(6);
    const de = buildSurfaceDE(foldSystemTransforms());
    const out = packSurfaceGpuMaps(de);
    const stride = SURFACE_GPU_MAP_VEC4 * 4;
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(de.maps.length * stride);

    de.maps.forEach((m, j) => {
      const base = j * stride;
      // r0 = invM row0 xyz, invT.x; r1 = invM row1 xyz, invT.y;
      // r2 = invM row2 xyz, invT.z.
      expect(out[base + 0]).toBe(Math.fround(m.invM[0]));
      expect(out[base + 1]).toBe(Math.fround(m.invM[1]));
      expect(out[base + 2]).toBe(Math.fround(m.invM[2]));
      expect(out[base + 3]).toBe(Math.fround(m.invT[0]));
      expect(out[base + 4]).toBe(Math.fround(m.invM[3]));
      expect(out[base + 5]).toBe(Math.fround(m.invM[4]));
      expect(out[base + 6]).toBe(Math.fround(m.invM[5]));
      expect(out[base + 7]).toBe(Math.fround(m.invT[1]));
      expect(out[base + 8]).toBe(Math.fround(m.invM[6]));
      expect(out[base + 9]).toBe(Math.fround(m.invM[7]));
      expect(out[base + 10]).toBe(Math.fround(m.invM[8]));
      expect(out[base + 11]).toBe(Math.fround(m.invT[2]));
      // p0 = sigmaMin, foldInvW, foldSigma, foldKind.
      expect(out[base + 12]).toBe(Math.fround(m.sigmaMin));
      expect(out[base + 13]).toBe(Math.fround(m.foldInvW));
      expect(out[base + 14]).toBe(Math.fround(m.foldSigma));
      expect(out[base + 15]).toBe(m.foldKind);
      // bnb = bnbDir xyz, invTNorm.
      expect(out[base + 16]).toBe(Math.fround(m.bnbDir[0]));
      expect(out[base + 17]).toBe(Math.fround(m.bnbDir[1]));
      expect(out[base + 18]).toBe(Math.fround(m.bnbDir[2]));
      expect(out[base + 19]).toBe(Math.fround(m.invTNorm));
      // p1 = invMSigmaMin, 0, 0, 0.
      expect(out[base + 20]).toBe(Math.fround(m.invMSigmaMin));
      expect(out[base + 21]).toBe(0);
      expect(out[base + 22]).toBe(0);
      expect(out[base + 23]).toBe(0);
    });
  });

  it("returns one stride worth of zeros when the DE has no active maps", () => {
    const zeroMapDe: SurfaceDE = {
      ...buildSurfaceDE(foldSystemTransforms()),
      maps: [],
    };
    const out = packSurfaceGpuMaps(zeroMapDe);
    const stride = SURFACE_GPU_MAP_VEC4 * 4;
    expect(out.length).toBe(stride);
    expect(Array.from(out)).toEqual(new Array(stride).fill(0));
  });
});

/** Full ShadeParams inputs (march "unproject" + mode "shade"),
 * overridable per test — distinct exactly-representable values per field
 * so any offset mixup shows up as the wrong value, not a coincidental
 * match. */
function shadeParams(
  overrides: Partial<SurfaceGpuShadeParams> = {},
): SurfaceGpuShadeParams {
  return {
    invProjView: Array.from({ length: 16 }, (_, k) => k + 0.5),
    lightDir: [0.25, 0.5, -0.75],
    ambient: 0.22,
    bgTop: [0.05, 0.075, 0.125],
    bgBottom: [0.01, 0.02, 0.03],
    colorSpeed: 0.5,
    tracePixelEps: 0.0019,
    colorSource: 3,
    shadowSteps: 24,
    aoTaps: 5,
    dither: true,
    ...overrides,
  };
}

describe("packSurfaceGpuShade", () => {
  it("returns an ArrayBuffer of exactly SURFACE_GPU_SHADE_BYTES (160 bytes, per the module doc)", () => {
    // 144 through fr-5h5d's fog tint pair; 160 since fr-vpbq's pixelJitter
    // at 144, because a WGSL uniform struct rounds to its largest member's
    // 16-byte alignment and the trailing vec2f costs a full stride.
    expect(SURFACE_GPU_SHADE_BYTES).toBe(160);
    const buf = packSurfaceGpuShade(shadeParams());
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(SURFACE_GPU_SHADE_BYTES);
  });

  it("defaults pixelJitter to the pixel centre, so an unset jitter is the pre-supersampling kernel input", () => {
    const view = new DataView(packSurfaceGpuShade(shadeParams()));
    expect(view.getFloat32(144, true)).toBe(0.5);
    expect(view.getFloat32(148, true)).toBe(0.5);
  });

  it("round-trips an explicit pixelJitter at offset 144 (fr-vpbq)", () => {
    const view = new DataView(
      packSurfaceGpuShade(shadeParams({ pixelJitter: [0.25, 0.8125] })),
    );
    expect(view.getFloat32(144, true)).toBe(0.25);
    expect(view.getFloat32(148, true)).toBe(0.8125);
  });

  it("round-trips the invProjView matrix column-major: element k at byte k*4", () => {
    const shade = shadeParams();
    const view = new DataView(packSurfaceGpuShade(shade));
    for (let k = 0; k < 16; k++) {
      expect(view.getFloat32(k * 4, true)).toBe(
        Math.fround(shade.invProjView[k]),
      );
    }
  });

  it("round-trips lightDir/ambient/bgTop/colorSpeed/bgBottom/tracePixelEps/colorSource/shadowSteps/aoTaps at their documented offsets", () => {
    const shade = shadeParams();
    const view = new DataView(packSurfaceGpuShade(shade));
    expect(view.getFloat32(64, true)).toBe(Math.fround(shade.lightDir[0]));
    expect(view.getFloat32(68, true)).toBe(Math.fround(shade.lightDir[1]));
    expect(view.getFloat32(72, true)).toBe(Math.fround(shade.lightDir[2]));
    expect(view.getFloat32(76, true)).toBe(Math.fround(shade.ambient));
    expect(view.getFloat32(80, true)).toBe(Math.fround(shade.bgTop[0]));
    expect(view.getFloat32(84, true)).toBe(Math.fround(shade.bgTop[1]));
    expect(view.getFloat32(88, true)).toBe(Math.fround(shade.bgTop[2]));
    expect(view.getFloat32(92, true)).toBe(Math.fround(shade.colorSpeed));
    expect(view.getFloat32(96, true)).toBe(Math.fround(shade.bgBottom[0]));
    expect(view.getFloat32(100, true)).toBe(Math.fround(shade.bgBottom[1]));
    expect(view.getFloat32(104, true)).toBe(Math.fround(shade.bgBottom[2]));
    expect(view.getFloat32(108, true)).toBe(Math.fround(shade.tracePixelEps));
    expect(view.getUint32(112, true)).toBe(shade.colorSource);
    expect(view.getUint32(116, true)).toBe(shade.shadowSteps);
    expect(view.getUint32(120, true)).toBe(shade.aoTaps);
  });

  it("sets flags bit0 at offset 124 when dither is true and clears it when false", () => {
    const on = new DataView(packSurfaceGpuShade(shadeParams({ dither: true })));
    expect(on.getUint32(124, true)).toBe(1);
    const off = new DataView(
      packSurfaceGpuShade(shadeParams({ dither: false })),
    );
    expect(off.getUint32(124, true)).toBe(0);
  });

  it("defaults fogTint to [1, 1, 1] at offset 128 and fogTintStrength to 0 at offset 140 when omitted (the fr-5h5d identity)", () => {
    const view = new DataView(packSurfaceGpuShade(shadeParams()));
    expect(view.getFloat32(128, true)).toBe(1);
    expect(view.getFloat32(132, true)).toBe(1);
    expect(view.getFloat32(136, true)).toBe(1);
    expect(view.getFloat32(140, true)).toBe(0);
  });

  it("round-trips explicit fogTint/fogTintStrength at their documented offsets", () => {
    const shade = shadeParams({
      fogTint: [0.375, 0.625, 0.875],
      fogTintStrength: 0.4,
    });
    const view = new DataView(packSurfaceGpuShade(shade));
    expect(view.getFloat32(128, true)).toBe(0.375);
    expect(view.getFloat32(132, true)).toBe(0.625);
    expect(view.getFloat32(136, true)).toBe(0.875);
    expect(view.getFloat32(140, true)).toBe(Math.fround(0.4));
  });
});

describe("packSurfaceGpuShadeMaps", () => {
  it("packs (color.r, color.g, color.b, trapIndex) per map slot", () => {
    const out = packSurfaceGpuShadeMaps(
      [
        [0.125, 0.25, 0.375],
        [0.5, 0.625, 0.75],
      ],
      [0.25, 0.75],
    );
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(8);
    expect(Array.from(out)).toEqual([
      0.125, 0.25, 0.375, 0.25, 0.5, 0.625, 0.75, 0.75,
    ]);
  });

  it("zero-fills trapIndex for slots beyond a shorter trapIndices array", () => {
    const out = packSurfaceGpuShadeMaps(
      [
        [1, 0, 0],
        [0, 1, 0],
      ],
      [0.5],
    );
    expect(out[3]).toBe(0.5);
    expect(out[7]).toBe(0);
  });

  it("returns one zero stride when there are no colors", () => {
    const out = packSurfaceGpuShadeMaps([], []);
    expect(out.length).toBe(4);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });
});

describe("surfaceGpuWorkgroupBytes core", () => {
  it("returns 0 for core 'affine' even under sharedFrontier — its ladder declares no frontier arrays", () => {
    expect(
      surfaceGpuWorkgroupBytes({
        core: "affine",
        width: 12,
        workgroupSize: 32,
        sharedFrontier: true,
      }),
    ).toBe(0);
  });

  it("treats an omitted core as 'fold' — same bytes as an explicit fold core", () => {
    const omitted = surfaceGpuWorkgroupBytes({
      width: 12,
      workgroupSize: 32,
      sharedFrontier: true,
    });
    expect(omitted).toBe(14 * 12 * 32 * 4);
    expect(
      surfaceGpuWorkgroupBytes({
        core: "fold",
        width: 12,
        workgroupSize: 32,
        sharedFrontier: true,
      }),
    ).toBe(omitted);
  });
});

describe("surfaceGpuWorkgroupBytes", () => {
  it("computes 14 * width * workgroupSize * 4 bytes when sharedFrontier is true", () => {
    expect(
      surfaceGpuWorkgroupBytes({
        width: 12,
        workgroupSize: 32,
        sharedFrontier: true,
      }),
    ).toBe(14 * 12 * 32 * 4);
    expect(
      surfaceGpuWorkgroupBytes({
        width: 6,
        workgroupSize: 64,
        sharedFrontier: true,
      }),
    ).toBe(14 * 6 * 64 * 4);
  });

  it("returns 0 when sharedFrontier is false, regardless of width/workgroupSize", () => {
    expect(
      surfaceGpuWorkgroupBytes({
        width: 12,
        workgroupSize: 32,
        sharedFrontier: false,
      }),
    ).toBe(0);
  });
});

describe("surfaceDeKernelWgsl validation", () => {
  it("throws on a zero frontier width", () => {
    expect(() => surfaceDeKernelWgsl(kernelOpts({ width: 0 }))).toThrow();
  });

  it("throws on a non-integer frontier width", () => {
    expect(() => surfaceDeKernelWgsl(kernelOpts({ width: 3.5 }))).toThrow();
  });

  it("throws on a zero workgroup size", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ workgroupSize: 0 })),
    ).toThrow();
  });
});

describe("surfaceDeKernelWgsl mode selection", () => {
  it("mode 'eval' generates fn evalQueries with query/result bindings and no activeList", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "eval" }));
    expect(wgsl).toContain("fn evalQueries");
    expect(wgsl).toContain("var<storage, read> queries: array<vec4f>;");
    expect(wgsl).toContain("var<storage, read_write> results: array<f32>;");
    expect(wgsl).not.toContain("activeList");
  });

  it("mode 'march' generates fn marchRays with activeList/states bindings and no evalQueries", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "march" }));
    expect(wgsl).toContain("fn marchRays");
    expect(wgsl).toContain("var<storage, read> activeList: array<u32>;");
    expect(wgsl).toContain("var<storage, read_write> states: array<vec4f>;");
    expect(wgsl).not.toContain("fn evalQueries");
  });

  it("mode 'shade' generates fn shadeRays over the ray-state bindings, with no march or eval entry", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "shade" }));
    expect(wgsl).toContain("fn shadeRays");
    expect(wgsl).toContain("var<storage, read> activeList: array<u32>;");
    expect(wgsl).toContain("var<storage, read_write> states: array<vec4f>;");
    expect(wgsl).not.toContain("fn marchRays");
    expect(wgsl).not.toContain("fn evalQueries");
  });

  it("mode 'shade' declares the shading interface at bindings 4-8 (shade/shadeMaps/colorOut/lutTex/lutSamp)", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "shade" }));
    expect(wgsl).toContain(
      "@group(0) @binding(4) var<uniform> shade: ShadeParams;",
    );
    expect(wgsl).toContain(
      "@group(0) @binding(5) var<storage, read> shadeMaps: array<vec4f>;",
    );
    expect(wgsl).toContain(
      "@group(0) @binding(6) var<storage, read_write> colorOut: array<u32>;",
    );
    expect(wgsl).toContain(
      "@group(0) @binding(7) var lutTex: texture_2d<f32>;",
    );
    expect(wgsl).toContain("@group(0) @binding(8) var lutSamp: sampler;");
  });

  it("mode 'shade' emits the greedy hit-info descent and packs pixels with pack4x8unorm", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "shade" }));
    expect(wgsl).toContain("fn surfaceDEHitInfo");
    expect(wgsl).toContain("pack4x8unorm");
  });

  it("mode 'shade' has no march loop and no dither — a shade batch only reads terminal states", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "shade" }));
    expect(wgsl).not.toContain("hash2");
    expect(wgsl).not.toContain("shade.flags");
    expect(wgsl).not.toContain("params.stepsThisPass");
  });
});

describe("surfaceDeKernelWgsl march ray derivation (rays option)", () => {
  it("rays 'unproject' keeps fn marchRays and derives rays through shade.invProjView with ShadeParams at binding 4", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", rays: "unproject" }),
    );
    expect(wgsl).toContain("fn marchRays");
    expect(wgsl).toContain("struct ShadeParams");
    expect(wgsl).toContain(
      "@group(0) @binding(4) var<uniform> shade: ShadeParams;",
    );
    expect(wgsl).toContain("shade.invProjView * vec4f(ndcX, ndcY, -1.0, 1.0)");
  });

  it("rays 'unproject' gates the march-start hash dither behind the flags bit", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", rays: "unproject" }),
    );
    expect(wgsl).toContain("(shade.flags & 1u) != 0u");
    expect(wgsl).toContain("hash2(");
  });

  it("rays 'unproject' writes states only — no shade-mode pixel interface, no hit-info descent", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", rays: "unproject" }),
    );
    expect(wgsl).not.toContain("shadeMaps");
    expect(wgsl).not.toContain("colorOut");
    expect(wgsl).not.toContain("lutTex");
    expect(wgsl).not.toContain("lutSamp");
    expect(wgsl).not.toContain("binding(5)");
    expect(wgsl).not.toContain("surfaceDEHitInfo");
    expect(wgsl).not.toContain("pack4x8unorm");
  });

  it("rays defaults to 'pose': explicit and omitted produce identical source", () => {
    const omitted = surfaceDeKernelWgsl(kernelOpts({ mode: "march" }));
    const explicit = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", rays: "pose" }),
    );
    expect(explicit).toBe(omitted);
  });
});

describe("surfaceDeKernelWgsl shade-split isolation (eval/march-pose output unchanged)", () => {
  it("mode 'eval' output contains none of the shade markers", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "eval" }));
    expect(wgsl).not.toContain("ShadeParams");
    expect(wgsl).not.toContain("binding(4)");
    expect(wgsl).not.toContain("shadeRays");
    expect(wgsl).not.toContain("shade");
  });

  it("mode 'march' with default pose rays contains none of the shade markers — not even the 'shade' substring", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", sharedFrontier: true, bnbStage2: true }),
    );
    expect(wgsl).not.toContain("ShadeParams");
    expect(wgsl).not.toContain("binding(4)");
    expect(wgsl).not.toContain("shadeRays");
    expect(wgsl).not.toContain("shade");
  });
});

describe("surfaceDeKernelWgsl frontier storage class", () => {
  it("declares all 14 frontier arrays as workgroup-shared, each sized width*workgroupSize, when sharedFrontier is true", () => {
    const width = 12;
    const workgroupSize = 32;
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ width, workgroupSize, sharedFrontier: true }),
    );
    const matches = [
      ...wgsl.matchAll(/var<workgroup> \w+: array<f32, (\d+)>;/g),
    ];
    expect(matches.length).toBe(14);
    for (const m of matches) {
      expect(Number(m[1])).toBe(width * workgroupSize);
    }
  });

  it("declares no workgroup-shared memory and sizes the function-scope frontier arrays to width when sharedFrontier is false", () => {
    const width = 7;
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ width, workgroupSize: 32, sharedFrontier: false }),
    );
    expect(wgsl).not.toContain("var<workgroup>");
    const matches = [...wgsl.matchAll(/var \w+: array<f32, (\d+)>;/g)];
    expect(matches.length).toBe(14);
    for (const m of matches) {
      expect(Number(m[1])).toBe(width);
    }
  });
});

describe("surfaceDeKernelWgsl shade probe width (shadeDeWidth, fr-p8bc)", () => {
  it("throws on a zero or non-integer shade probe width", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ mode: "shade", shadeDeWidth: 0 })),
    ).toThrow();
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ mode: "shade", shadeDeWidth: 2.5 })),
    ).toThrow();
  });

  it("omitted and equal-to-width produce identical shade source — the byte-identical off state", () => {
    const omitted = surfaceDeKernelWgsl(kernelOpts({ mode: "shade" }));
    const equal = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", shadeDeWidth: 4 }),
    );
    expect(equal).toBe(omitted);
    expect(omitted).not.toContain("surfaceDEProbe");
  });

  it("emits fn surfaceDEProbe at the probe width and routes the normal/shadow/AO taps to it, leaving the main descent at full width", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, shadeDeWidth: 1 }),
    );
    expect(wgsl).toContain("fn surfaceDEProbe(pIn: vec3f");
    expect(wgsl).toContain("fn probeIx(");
    // The probe's 14 frontier arrays are its own p-named privates at the
    // probe width; the main descent keeps its full-width f-named arrays.
    const probeArrays = [...wgsl.matchAll(/var p\w+: array<f32, (\d+)>;/g)];
    expect(probeArrays.length).toBe(14);
    for (const m of probeArrays) expect(Number(m[1])).toBe(1);
    const mainArrays = [...wgsl.matchAll(/var f\w+: array<f32, (\d+)>;/g)];
    expect(mainArrays.length).toBe(14);
    for (const m of mainArrays) expect(Number(m[1])).toBe(12);
    // Every probe tap goes through the cheap descent…
    expect(wgsl).toContain("surfaceDEProbe(pos + e.xyy * h, 0.0, li)");
    expect(wgsl).toContain("surfaceDEProbe(sp, 0.0, li)");
    expect(wgsl).toContain("surfaceDEProbe(pos + n * hh, 0.0, li)");
    // …and none stays on the full-width descent.
    expect(wgsl).not.toContain("surfaceDE(pos + e.xyy * h, 0.0, li)");
    expect(wgsl).not.toContain("surfaceDE(sp, 0.0, li)");
    expect(wgsl).not.toContain("surfaceDE(pos + n * hh, 0.0, li)");
  });

  it("keeps the probe frontier in function-scope private arrays under a workgroup-shared main frontier", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "shade",
        width: 12,
        workgroupSize: 32,
        sharedFrontier: true,
        shadeDeWidth: 1,
      }),
    );
    // Main frontier: 14 workgroup arrays, none of them probe-named.
    const shared = [...wgsl.matchAll(/var<workgroup> (\w+):/g)];
    expect(shared.length).toBe(14);
    for (const m of shared) expect(m[1].startsWith("p")).toBe(false);
    // Probe frontier: private, probe-sized.
    const probeArrays = [...wgsl.matchAll(/var p\w+: array<f32, (\d+)>;/g)];
    expect(probeArrays.length).toBe(14);
    for (const m of probeArrays) expect(Number(m[1])).toBe(1);
  });

  it("is ignored outside shade mode: march and eval source are unchanged by shadeDeWidth", () => {
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "march", rays: "unproject", shadeDeWidth: 1 }),
      ),
    ).toBe(
      surfaceDeKernelWgsl(kernelOpts({ mode: "march", rays: "unproject" })),
    );
    expect(
      surfaceDeKernelWgsl(kernelOpts({ mode: "eval", shadeDeWidth: 1 })),
    ).toBe(surfaceDeKernelWgsl(kernelOpts({ mode: "eval" })));
  });
});

describe("surfaceDeKernelWgsl descent core (core, fr-55s1)", () => {
  it("omitted and explicit 'fold' produce identical source across every mode/variant — the byte-identical off state", () => {
    const cases: Partial<SurfaceGpuKernelOptions>[] = [
      { mode: "eval", width: 12, sharedFrontier: true, bnbStage2: true },
      { mode: "eval", width: 4 },
      { mode: "march", width: 12 },
      { mode: "march", rays: "unproject", width: 12 },
      { mode: "shade", width: 12 },
      { mode: "shade", width: 12, shadeDeWidth: 1 },
    ];
    for (const overrides of cases) {
      const omitted = surfaceDeKernelWgsl(kernelOpts(overrides));
      const explicit = surfaceDeKernelWgsl(
        kernelOpts({ ...overrides, core: "fold" }),
      );
      expect(explicit).toBe(omitted);
    }
  });

  it("keeps the fold descent's distinctive body under the default core, with no affine-ladder marker in sight", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "eval", width: 12 }));
    // The fold frontier's identity: the unsorted worst-slot rescan and the
    // region-floor prune, plus the frontier index helper.
    expect(wgsl).toContain("fn frontierIx(");
    expect(wgsl).toContain("fnWorstKey = -1e30;");
    expect(wgsl).toContain(
      "candFloor = max(candFloor, pScale * absW * branchRd);",
    );
    // …and none of the affine ladder's.
    expect(wgsl).not.toContain("fn refinedCert(");
    expect(wgsl).not.toContain("v1Live");
  });

  it("core 'affine' emits the width-4 refined ladder — refinedCert, A/B chains, fr-jkpn validity slots — and no fold frontier", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "affine" }),
    );
    expect(wgsl).toContain(
      "fn refinedCert(img: vec3f, r: f32, childScale: f32) -> f32",
    );
    expect(wgsl).toContain(
      "fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32",
    );
    expect(wgsl).toContain("for (var c = 0u; c < 4u; c++)");
    for (const slot of ["aLive", "bLive", "v1Live", "v2Live"]) {
      expect(wgsl).toContain(slot);
    }
    // No frontier: no arrays, no index helper, no workgroup storage.
    expect(wgsl).not.toContain("frontierIx");
    expect(wgsl).not.toContain("var<workgroup>");
    expect(wgsl).not.toContain("array<f32,");
    expect(wgsl).not.toContain("chainCount");
  });

  it("core 'affine' keeps the eval entry point and its bindings textually unchanged", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "affine" }),
    );
    expect(wgsl).toContain("fn evalQueries");
    expect(wgsl).toContain(
      "results[i] = surfaceDE(queries[i].xyz, params.cutoff, li);",
    );
    expect(wgsl).toContain("var<storage, read> queries: array<vec4f>;");
  });

  it("core 'affine' ignores width, sharedFrontier and bnbStage2 — all four produce identical source", () => {
    const base = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "affine", width: 4 }),
    );
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "affine", width: 12 }),
      ),
    ).toBe(base);
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "affine", sharedFrontier: true }),
      ),
    ).toBe(base);
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "affine", bnbStage2: true }),
      ),
    ).toBe(base);
  });

  it("core 'affine' march mode swaps only the descent body — same marchRays entry, same ray/gate code", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", rays: "unproject", core: "affine" }),
    );
    expect(wgsl).toContain("fn marchRays");
    expect(wgsl).toContain("let d = surfaceDE(ro + rd * t, eps, li);");
    expect(wgsl).toContain("fn refinedCert(");
    expect(wgsl).not.toContain("frontierIx");
  });

  it("core 'affine' still validates width, so a bad value is caught wherever it came from", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "affine", width: 0 })),
    ).toThrow();
  });

  it("core 'affine' with mode 'shade' emits the affine hit-info descent — the ladder's trajectory feeding colors only (stage C)", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine" }),
    );
    expect(wgsl).toContain("fn surfaceDEHitInfo(");
    // The affine hit-info is the four-chain ladder, not the fold twin's
    // greedy chain…
    expect(wgsl).toContain("var c3Key = 1e30;");
    expect(wgsl).not.toContain("var lbKey = 1e30;");
    // …and the value side is trimmed: no certificates in the shading
    // descent (refinedCert exists in the VALUE body alongside it).
    expect(wgsl).toContain("fn refinedCert(");
    expect(wgsl).toContain("fn shadeRays(");
  });

  it("core 'affine' ignores shadeDeWidth — no probe descent, taps ride the full ladder (its GLSL arm carries no probe)", () => {
    const plain = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine" }),
    );
    const withWidth = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine", shadeDeWidth: 1 }),
    );
    expect(withWidth).toBe(plain);
    expect(withWidth).not.toContain("surfaceDEProbe");
  });
});

describe("surfaceDeKernelWgsl fold-lens wrapper (lens, fr-55s1 stage B)", () => {
  it("omitted and explicit lens:false produce identical source across every mode/variant/core — the byte-identical off state", () => {
    const cases: Partial<SurfaceGpuKernelOptions>[] = [
      { mode: "eval", width: 12, sharedFrontier: true, bnbStage2: true },
      { mode: "eval", width: 4 },
      { mode: "eval", core: "affine", width: 4 },
      { mode: "march", width: 12 },
      { mode: "march", rays: "unproject", width: 12 },
      { mode: "march", core: "affine", width: 4 },
      { mode: "shade", width: 12 },
      { mode: "shade", width: 12, shadeDeWidth: 1 },
    ];
    for (const overrides of cases) {
      const omitted = surfaceDeKernelWgsl(kernelOpts(overrides));
      const explicit = surfaceDeKernelWgsl(
        kernelOpts({ ...overrides, lens: false }),
      );
      expect(explicit).toBe(omitted);
      expect(omitted).not.toContain("surfaceDECore");
      expect(omitted).not.toContain("lensParams");
    }
  });

  it("lens:true renames the descent body to surfaceDECore and emits the sweep wrapper as the one public surfaceDE, for BOTH cores", () => {
    for (const core of ["fold", "affine"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ lens: true, core, width: core === "fold" ? 12 : 4 }),
      );
      // Exactly one renamed core, exactly one wrapper owning the public
      // name — the mode entries' call sites resolve to the wrapper. The
      // wrapper is emitted AFTER the core, declaration before use.
      expect(wgsl.split("fn surfaceDECore(").length).toBe(2);
      expect(wgsl.split("fn surfaceDE(").length).toBe(2);
      expect(wgsl.indexOf("fn surfaceDECore(")).toBeLessThan(
        wgsl.indexOf("fn surfaceDE("),
      );
      expect(wgsl).toContain("surfaceDECore(q, innerCutoff, li)");
      // The lens params struct fields exist only under the lens.
      expect(wgsl).toContain("lensParams: vec4f");
      // The wrapper's sweep carries the oracle's prunes.
      expect(wgsl).toContain("b += 26u");
      expect(wgsl).toContain("factor * (rq - params.boundingRadius) >= best");
    }
    // Each core keeps its own body under the rename.
    const fold = surfaceDeKernelWgsl(kernelOpts({ lens: true, width: 12 }));
    expect(fold).toContain("fn frontierIx(");
    expect(fold).not.toContain("fn refinedCert(");
    const affine = surfaceDeKernelWgsl(
      kernelOpts({ lens: true, core: "affine", width: 4 }),
    );
    expect(affine).toContain("fn refinedCert(");
    expect(affine).not.toContain("fn frontierIx(");
  });

  it("keeps the wrapper out of the entry text — eval and march entries call surfaceDE exactly as without the lens", () => {
    for (const mode of ["eval", "march"] as const) {
      const plain = surfaceDeKernelWgsl(kernelOpts({ mode, width: 12 }));
      const lensed = surfaceDeKernelWgsl(
        kernelOpts({ mode, width: 12, lens: true }),
      );
      const entryCall =
        mode === "eval"
          ? "surfaceDE(queries[i].xyz, params.cutoff, li)"
          : "surfaceDE(ro + rd * t, eps, li)";
      expect(plain).toContain(entryCall);
      expect(lensed).toContain(entryCall);
    }
  });

  it("lens shade renames the hit-info to surfaceDEHitInfoCore behind the argmin-sweep wrapper, for BOTH cores (stage C)", () => {
    for (const core of ["fold", "affine"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({
          mode: "shade",
          lens: true,
          core,
          width: core === "fold" ? 12 : 4,
        }),
      );
      expect(wgsl.split("fn surfaceDEHitInfoCore(").length).toBe(2);
      expect(wgsl.split("fn surfaceDEHitInfo(").length).toBe(2);
      // The wrapper's argmin sweep: zero-cutoff full-width core calls,
      // identity-branch fallback, one core hit call on the winner.
      expect(wgsl).toContain("surfaceDECore(q, 0.0, li)");
      expect(wgsl).toContain("return surfaceDEHitInfoCore(bestQ, li);");
    }
  });

  it("lens shade with a probe width renames the probe body too and hands the taps a probe lens sweep — one text, three names", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", lens: true, width: 12, shadeDeWidth: 1 }),
    );
    expect(wgsl.split("fn surfaceDEProbeCore(").length).toBe(2);
    expect(wgsl.split("fn surfaceDEProbe(").length).toBe(2);
    expect(wgsl).toContain("surfaceDEProbeCore(q, innerCutoff, li)");
    // Without a probe width the probe sweep is absent entirely.
    const noProbe = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", lens: true, width: 12 }),
    );
    expect(noProbe).not.toContain("surfaceDEProbe");
  });

  it("lens composes with march rays 'unproject' — the app ray derivation needs nothing lens-specific beyond the wrapper", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", rays: "unproject", lens: true, width: 12 }),
    );
    expect(wgsl).toContain("fn marchRays");
    expect(wgsl).toContain("struct ShadeParams");
    expect(wgsl).toContain("let d = surfaceDE(ro + rd * t, eps, li);");
    expect(wgsl).toContain("fn surfaceDECore(");
  });
});

describe("surfaceDeKernelWgsl balloon wrapper (balloon, fr-5wlv.5)", () => {
  it("omitted and explicit balloon:false produce identical source across every 3D mode/variant — the byte-identical off state", () => {
    const cases: Partial<SurfaceGpuKernelOptions>[] = [
      { mode: "eval", core: "affine", width: 4 },
      { mode: "eval", width: 12, sharedFrontier: true, bnbStage2: true },
      { mode: "march", width: 12 },
      { mode: "march", rays: "unproject", width: 12 },
      { mode: "shade", width: 12, shadeDeWidth: 1 },
      { mode: "shade", lens: true, width: 12, shadeDeWidth: 1 },
      { mode: "eval", core: "escape", width: 4 },
    ];
    for (const overrides of cases) {
      const omitted = surfaceDeKernelWgsl(kernelOpts(overrides));
      const explicit = surfaceDeKernelWgsl(
        kernelOpts({ ...overrides, balloon: false }),
      );
      expect(explicit).toBe(omitted);
      expect(omitted).not.toContain("balloonInvert");
      expect(omitted).not.toContain("balloonCenter");
      expect(omitted).not.toContain("colorPos");
    }
  });

  it("balloon:true renames the public DE one level out and emits the union wrapper as the one public surfaceDE — fold, affine and lens variants", () => {
    const cases: Partial<SurfaceGpuKernelOptions>[] = [
      { mode: "eval", core: "affine", width: 4 },
      { mode: "march", width: 12 },
      { mode: "shade", lens: true, width: 12 },
    ];
    for (const overrides of cases) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ ...overrides, balloon: true }),
      );
      // Exactly one renamed public, exactly one union wrapper owning the
      // public name, emitted after it — the lens idiom one level out.
      expect(wgsl.split("fn surfaceDEFractal(").length).toBe(2);
      expect(wgsl.split("fn surfaceDE(").length).toBe(2);
      expect(wgsl.indexOf("fn surfaceDEFractal(")).toBeLessThan(
        wgsl.indexOf("fn surfaceDE("),
      );
      expect(wgsl.split("fn balloonInvert(").length).toBe(2);
      // The union: min of the fractal term and the scaled shell term,
      // with the fr-55r5 inner cutoff scaled by the value factor.
      expect(wgsl).toContain("return min(dS, dF);");
      expect(wgsl).toContain("select(0.0, cutoff / inv.w, cutoff > 0.0)");
      // The balloon params struct fields exist only under balloon.
      expect(wgsl).toContain("balloonCenter: vec3f");
      expect(wgsl).toContain("balloonFar: f32");
    }
    // Under a lens the balloon wraps the LENS wrapper, not the core: the
    // core keeps its Core name and the lens sweep is the renamed public.
    const lensed = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", lens: true, width: 12, balloon: true }),
    );
    expect(lensed.split("fn surfaceDECore(").length).toBe(2);
    expect(lensed).toContain("surfaceDECore(q, innerCutoff, li)");
  });

  it("balloon keeps the mode entries' call sites untouched — surfaceDE resolves to the union wrapper", () => {
    for (const mode of ["eval", "march"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode, width: 12, balloon: true }),
      );
      const entryCall =
        mode === "eval"
          ? "surfaceDE(queries[i].xyz, params.cutoff, li)"
          : "surfaceDE(ro + rd * t, eps, li)";
      expect(wgsl).toContain(entryCall);
    }
  });

  it("balloon march drops the visible-sphere gate for the oracle's far cap, dither surviving at the t = 0 start", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "march",
        rays: "unproject",
        width: 12,
        balloon: true,
      }),
    );
    expect(wgsl).toContain(
      "let tFar = length(ro - params.balloonCenter) + params.balloonFar;",
    );
    expect(wgsl).not.toContain("let tFar = -bq + sq;");
    expect(wgsl).toContain("t = 0.0;");
    expect(wgsl).toContain("(shade.flags & 1u) != 0u");
    const plain = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", rays: "unproject", width: 12 }),
    );
    expect(plain).toContain("let tFar = -bq + sq;");
  });

  it("balloon shade adds colorPos to SurfaceHitInfo and argmin-routes the hit-info to the winning term's own query point", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, shadeDeWidth: 1, balloon: true }),
    );
    expect(wgsl).toContain("colorPos: vec3f");
    expect(wgsl.split("fn surfaceDEHitInfoFractal(").length).toBe(2);
    expect(wgsl.split("fn surfaceDEHitInfo(").length).toBe(2);
    // The core's full-member constructor gained the zeroed colorPos —
    // WGSL value constructors are all-or-none.
    expect(wgsl).toContain("SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0, vec3f(0.0))");
    // Ties go to the fractal term (strict <, the oracle's attribution
    // convention), and colorPos carries the winner's query point.
    expect(wgsl).toContain("if (dS < dF) {");
    expect(wgsl).toContain("hi.colorPos = inv.xyz;");
    // Height/radius color sources read the winner's SOURCE point.
    expect(wgsl).toContain("hi.colorPos.y / visR");
    expect(wgsl).toContain("length(hi.colorPos) / visR");
    // The argmin's value form is the probe under a fold probe config,
    // the full descent otherwise (GLSL parity).
    expect(wgsl).toContain("let dF = surfaceDEProbeFractal(p, 0.0, li);");
    const noProbe = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine", width: 4, balloon: true }),
    );
    expect(noProbe).toContain("let dF = surfaceDEFractal(p, 0.0, li);");
    expect(noProbe).not.toContain("surfaceDEProbe");
  });

  it("balloon shade emits the probe union exactly when the probe is, and routes the shadow tap fractal-only (receives, never casts)", () => {
    const probed = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, shadeDeWidth: 1, balloon: true }),
    );
    expect(probed.split("fn surfaceDEProbeFractal(").length).toBe(2);
    expect(probed.split("fn surfaceDEProbe(").length).toBe(2);
    // The shadow ray tests the FRACTAL alone; normal + AO stay on the
    // public union names.
    expect(probed).toContain("let d = surfaceDEProbeFractal(sp, 0.0, li);");
    expect(probed).toContain("surfaceDEProbe(pos + e.xyy * h, 0.0, li)");
    expect(probed).toContain("(hh - surfaceDEProbe(pos + n * hh, 0.0, li))");
    const noProbe = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine", width: 4, balloon: true }),
    );
    expect(noProbe).toContain("let d = surfaceDEFractal(sp, 0.0, li);");
    expect(noProbe).toContain("surfaceDE(pos + e.xyy * h, 0.0, li)");
  });

  it("balloon shade drops the defensive no-intersection miss and keeps the fog origin continuous across the sphere silhouette", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, balloon: true }),
    );
    // The continuous form: sq is sqrt(max(disc, 0)), so a ray missing the
    // sphere reads the closest-approach depth max(-bq, 0) rather than 0 —
    // both forms meet at the silhouette (a discontinuous camera-seeded
    // origin painted the sphere's silhouette as a lighter disc over the
    // shell, user-reported at the R=0.99 mid-flip from a far camera). The
    // min(..., t) clamp is the fog pow's negative-base guard.
    expect(wgsl).toContain("let tEnter = min(max(-bq - sq, 0.0), t);");
    expect(wgsl).toContain("let sq = sqrt(max(disc, 0.0));");
    expect(wgsl).not.toContain("Defensive — a HIT ray always intersected");
    const plain = surfaceDeKernelWgsl(kernelOpts({ mode: "shade", width: 12 }));
    expect(plain).toContain("Defensive — a HIT ray always intersected");
  });

  it("throws on the escape core and the 4D cores — the fr-5wlv.4 exclusion and the deferred 4D lift", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "escape", balloon: true })),
    ).toThrow(/escape/);
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "affine4", balloon: true })),
    ).toThrow(/3D-only/);
    expect(() =>
      surfaceDeKernelWgsl(
        kernelOpts({ core: "fold4", width: 12, balloon: true }),
      ),
    ).toThrow(/3D-only/);
  });
});

describe("groundPlane wrapper (fr-rhn5)", () => {
  it("pins SURFACE_GPU_RAY_PLANE to 4, sitting beside the ACTIVE/HIT/MISS/EXHAUSTED march-state contract", () => {
    expect(SURFACE_GPU_RAY_PLANE).toBe(4);
  });

  it("omitted and explicit groundPlane:false produce identical source across every composing mode/core — the byte-identical off state", () => {
    const cases: Partial<SurfaceGpuKernelOptions>[] = [
      { mode: "march", core: "fold", rays: "unproject" },
      { mode: "shade", core: "fold", width: 12, shadeDeWidth: 1 },
      { mode: "eval", core: "fold" },
      { mode: "march", core: "affine" },
      { mode: "shade", core: "escape" },
      { mode: "shade", core: "fold", lens: true },
    ];
    for (const overrides of cases) {
      const omitted = surfaceDeKernelWgsl(kernelOpts(overrides));
      const explicit = surfaceDeKernelWgsl(
        kernelOpts({ ...overrides, groundPlane: false }),
      );
      expect(explicit).toBe(omitted);
      // Never assert on the bare token "ground" — "background" contains it.
      expect(omitted).not.toContain("groundPlaneStatus");
      expect(omitted).not.toContain("shadeGroundPlane");
      expect(omitted).not.toContain("groundY");
    }
  });

  it("march classifies every sphere-gate/sphere-exit MISS through groundPlaneStatus, with the unconditionally-declared lens block ahead of the plane fields for a non-lens descent core", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "march",
        core: "fold",
        rays: "unproject",
        groundPlane: true,
      }),
    );
    expect(wgsl).toContain("fn groundPlaneStatus");
    // Both sphere-gate early-outs plus the step loop's sphere exit: three
    // MISS terminations, all reclassified against the floor.
    expect(wgsl.split("st.y = groundPlaneStatus(ro, rd);").length).toBe(4);
    // The lens block (fr-5wlv.5's frozen-offset move) is what puts the
    // plane block at the frozen offset 272 here.
    expect(wgsl).toContain("lensM0: vec3f,");
    expect(wgsl).toContain("groundY: f32,");
    expect(wgsl).toContain("groundAlbedo: vec3f,");
  });

  it("shade lights the PLANE status (4.0) through shadeGroundPlane, whose taps ride the fr-p8bc width-1 probe exactly like the fractal's own shading taps", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "shade",
        core: "fold",
        width: 12,
        shadeDeWidth: 1,
        groundPlane: true,
      }),
    );
    expect(wgsl).toContain("fn shadeGroundPlane");
    expect(wgsl).toContain("if (st.y == 4.0) {");
    expect(wgsl).toContain("surfaceDEProbe(");
  });

  it("escape shade composes with the ground plane — the classic Mandelbox floor — appending the plane block after the escape variant block, taps riding the plain surfaceDE (escape has no probe)", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "escape", groundPlane: true }),
    );
    expect(wgsl).toContain("fn shadeGroundPlane");
    expect(wgsl).toContain("escParams: vec4f,");
    expect(wgsl).toContain("groundY: f32,");
    expect(wgsl).toContain("surfaceDE(");
  });

  it("is inert in eval mode — no rays ever terminate PLANE, so only the struct fields appear", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "fold", groundPlane: true }),
    );
    expect(wgsl).not.toContain("groundPlaneStatus");
    expect(wgsl).not.toContain("shadeGroundPlane");
    expect(wgsl).toContain("groundY: f32,");
  });

  it("throws groundPlane+balloon (no horizon inside the shell) and groundPlane on either 4D core (fr-rhn5's 3D scope)", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ groundPlane: true, balloon: true })),
    ).toThrow(/groundPlane\+balloon/);
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "affine4", groundPlane: true })),
    ).toThrow(/3D-only/);
    expect(() =>
      surfaceDeKernelWgsl(
        kernelOpts({ core: "fold4", width: 12, groundPlane: true }),
      ),
    ).toThrow(/3D-only/);
  });

  it("packs the ground-plane block at the frozen 272..319 offsets, growing the buffer to SURFACE_GPU_PARAMS_PLANE_BYTES (320) without touching 0..271", () => {
    expect(SURFACE_GPU_PARAMS_PLANE_BYTES).toBe(320);
    const de = buildSurfaceDE(foldSystemTransforms());
    const gp: SurfaceGpuGroundPlane = {
      y: 0.125,
      fadeStart: 1.5,
      fadeEnd: 4.5,
      ballCenter: [0.25, -0.5, 0.75],
      ballRadius: 1.25,
      albedo: [0.375, 0.625, 0.875],
    };
    const plain = new Uint8Array(packSurfaceGpuParams(de, { itemCount: 4 }));
    const buf = packSurfaceGpuParams(de, { itemCount: 4 }, null, gp);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_PLANE_BYTES);
    expect(new Uint8Array(buf, 0, SURFACE_GPU_PARAMS_BYTES)).toEqual(plain);
    const view = new DataView(buf);
    expect(view.getFloat32(272, true)).toBe(Math.fround(gp.y));
    expect(view.getFloat32(276, true)).toBe(Math.fround(gp.fadeStart));
    expect(view.getFloat32(280, true)).toBe(Math.fround(gp.fadeEnd));
    expect(view.getFloat32(284, true)).toBe(Math.fround(gp.ballRadius));
    expect(view.getFloat32(288, true)).toBe(Math.fround(gp.ballCenter[0]));
    expect(view.getFloat32(292, true)).toBe(Math.fround(gp.ballCenter[1]));
    expect(view.getFloat32(296, true)).toBe(Math.fround(gp.ballCenter[2]));
    expect(view.getFloat32(304, true)).toBe(Math.fround(gp.albedo[0]));
    expect(view.getFloat32(308, true)).toBe(Math.fround(gp.albedo[1]));
    expect(view.getFloat32(312, true)).toBe(Math.fround(gp.albedo[2]));
  });

  it("omits the ground-plane 4th arg back to today's 272-byte packSurfaceGpuParams buffer, byte for byte", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const omitted = new Uint8Array(packSurfaceGpuParams(de, { itemCount: 3 }));
    const explicit = new Uint8Array(
      packSurfaceGpuParams(de, { itemCount: 3 }, null),
    );
    expect(omitted.byteLength).toBe(SURFACE_GPU_PARAMS_BYTES);
    expect(explicit).toEqual(omitted);
  });

  it("throws when both a balloon and a ground plane are passed to packSurfaceGpuParams — the two blocks share the frozen offset 272", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const b = buildBalloon(de, 0.9);
    const balloon = { center: b.center, rho: b.rho, R: b.R, far: 10 };
    const gp: SurfaceGpuGroundPlane = {
      y: 0,
      fadeStart: 1,
      fadeEnd: 2,
      ballCenter: [0, 0, 0],
      ballRadius: 1,
      albedo: [1, 1, 1],
    };
    expect(() =>
      packSurfaceGpuParams(de, { itemCount: 1 }, balloon, gp),
    ).toThrow(/groundPlane\+balloon/);
  });

  it("packs the same ground-plane block onto packEscapeGpuParams, leaving the escape variant block (foldKind/w at 256/260) untouched", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const gp: SurfaceGpuGroundPlane = {
      y: 0.125,
      fadeStart: 1.5,
      fadeEnd: 4.5,
      ballCenter: [0.25, -0.5, 0.75],
      ballRadius: 1.25,
      albedo: [0.375, 0.625, 0.875],
    };
    const plain = new Uint8Array(packEscapeGpuParams(de, { itemCount: 2 }));
    const buf = packEscapeGpuParams(de, { itemCount: 2 }, gp);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_PLANE_BYTES);
    expect(new Uint8Array(buf, 0, SURFACE_GPU_PARAMS_BYTES)).toEqual(plain);
    const view = new DataView(buf);
    expect(view.getFloat32(256, true)).toBe(Math.fround(de.foldKind));
    expect(view.getFloat32(260, true)).toBe(Math.fround(de.w));
    expect(view.getFloat32(272, true)).toBe(Math.fround(gp.y));
    expect(view.getFloat32(276, true)).toBe(Math.fround(gp.fadeStart));
    expect(view.getFloat32(280, true)).toBe(Math.fround(gp.fadeEnd));
    expect(view.getFloat32(284, true)).toBe(Math.fround(gp.ballRadius));
    expect(view.getFloat32(288, true)).toBe(Math.fround(gp.ballCenter[0]));
    expect(view.getFloat32(292, true)).toBe(Math.fround(gp.ballCenter[1]));
    expect(view.getFloat32(296, true)).toBe(Math.fround(gp.ballCenter[2]));
    expect(view.getFloat32(304, true)).toBe(Math.fround(gp.albedo[0]));
    expect(view.getFloat32(308, true)).toBe(Math.fround(gp.albedo[1]));
    expect(view.getFloat32(312, true)).toBe(Math.fround(gp.albedo[2]));
  });

  it("omits gp on packEscapeGpuParams back to today's 272-byte buffer, byte for byte", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const omitted = new Uint8Array(packEscapeGpuParams(de, { itemCount: 2 }));
    const explicit = new Uint8Array(
      packEscapeGpuParams(de, { itemCount: 2 }, null),
    );
    expect(omitted.byteLength).toBe(SURFACE_GPU_PARAMS_BYTES);
    expect(explicit).toEqual(omitted);
  });
});

describe("surfaceDeKernelWgsl stage-2 branch-and-bound flag", () => {
  it("includes the bnbSigmaSq marker when bnbStage2 is true", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ bnbStage2: true }));
    expect(wgsl).toContain("bnbSigmaSq");
  });

  it("omits the bnbSigmaSq marker when bnbStage2 is false", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ bnbStage2: false }));
    expect(wgsl).not.toContain("bnbSigmaSq");
  });
});

describe("surfaceDeKernelWgsl workgroup size", () => {
  it("emits @workgroup_size(N) matching the requested workgroupSize", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ workgroupSize: 96 }));
    expect(wgsl).toContain("@workgroup_size(96)");
  });
});

describe("ray-state status constants", () => {
  it("pins SURFACE_GPU_RAY_ACTIVE/HIT/MISS/EXHAUSTED to 0/1/2/3, the march-state contract other code relies on", () => {
    expect(SURFACE_GPU_RAY_ACTIVE).toBe(0);
    expect(SURFACE_GPU_RAY_HIT).toBe(1);
    expect(SURFACE_GPU_RAY_MISS).toBe(2);
    expect(SURFACE_GPU_RAY_EXHAUSTED).toBe(3);
  });
});

describe("packEscapeGpuParams (fr-dlxh)", () => {
  it("returns an ArrayBuffer of exactly SURFACE_GPU_PARAMS_BYTES, the same struct size the fold/affine packer uses", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const buf = packEscapeGpuParams(de, { itemCount: 1 });
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_BYTES);
  });

  it("packs the LINK COUNT at mapCount and the wedge fold's order/plane at symOrder/symPlane (fr-s04t)", () => {
    const chain = buildEscapeDE(
      [canonicalMandelbox(), rotatedBoxfold()],
      null,
      { order: 5, plane: "xz" },
    );
    const view = new DataView(packEscapeGpuParams(chain, { itemCount: 1 }));
    expect(view.getUint32(48, true)).toBe(2);
    expect(view.getUint32(40, true)).toBe(5);
    expect(view.getUint32(44, true)).toBe(1); // SYM_PLANE_CODE.xz
    // The sector-sweep pair stays inert — that is a descent concept; the
    // escape arm derives its sector angle from the order alone.
    expect(view.getFloat32(32, true)).toBe(1);
    expect(view.getFloat32(36, true)).toBe(0);
  });

  it("packs the frozen scalar offsets: zero boundCenter, the bailout ball doubling as bounding/visible radius, the dead 2R escapeRadius, ESCAPE_STEP_SCALE, and symmetry pinned off", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const view = new DataView(packEscapeGpuParams(de, { itemCount: 1 }));

    // boundCenter zeros — the escape loop has no bounding-ball center.
    expect(view.getFloat32(0, true)).toBe(0);
    expect(view.getFloat32(4, true)).toBe(0);
    expect(view.getFloat32(8, true)).toBe(0);
    expect(view.getFloat32(12, true)).toBe(Math.fround(de.boundingRadius));
    // escapeRadius packs the GLSL's dead 2R so the wire never carries an
    // uninitialized word (module doc) — nothing reads it in this core.
    expect(view.getFloat32(16, true)).toBe(Math.fround(de.boundingRadius * 2));
    expect(view.getFloat32(20, true)).toBe(Math.fround(ESCAPE_STEP_SCALE));
    // visibleRadius is the SAME bailout ball as boundingRadius.
    expect(view.getFloat32(24, true)).toBe(Math.fround(de.boundingRadius));
    expect(view.getFloat32(28, true)).toBe(1); // slowestSigma
    expect(view.getFloat32(32, true)).toBe(1); // stepCos
    expect(view.getFloat32(36, true)).toBe(0); // stepSin
    expect(view.getUint32(40, true)).toBe(1); // symOrder
    expect(view.getUint32(44, true)).toBe(1); // symPlane
    expect(view.getUint32(48, true)).toBe(1); // mapCount
  });

  it("packs maxDepth at offset 52 as ESCAPE_TIME_ITERATIONS by default, overridden by run.maxDepth (the preview clamp door)", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const def = new DataView(packEscapeGpuParams(de, { itemCount: 1 }));
    expect(def.getUint32(52, true)).toBe(ESCAPE_TIME_ITERATIONS);

    const clamped = new DataView(
      packEscapeGpuParams(de, { itemCount: 1, maxDepth: 12 }),
    );
    expect(clamped.getUint32(52, true)).toBe(12);
  });

  it("round-trips the run params' itemCount/stepsThisPass/cutoff/marchSteps at their documented offsets", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const view = new DataView(
      packEscapeGpuParams(de, {
        itemCount: 321,
        stepsThisPass: 9,
        cutoff: 0.04,
        marchSteps: 96,
      }),
    );
    expect(view.getUint32(56, true)).toBe(321);
    expect(view.getUint32(60, true)).toBe(9);
    expect(view.getFloat32(64, true)).toBe(Math.fround(0.04));
    expect(view.getUint32(72, true)).toBe(96);
  });

  // fr-5h5d: the escape core shares the frozen block's offset-204
  // fogDensity slot (former pad1) — packEscapeGpuParams never wrote it
  // before this, leaving it at the ArrayBuffer's zero default.
  it("defaults offset 204 (fogDensity, former pad1) to 1 when run.fogDensity is omitted", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const view = new DataView(packEscapeGpuParams(de, { itemCount: 1 }));
    expect(view.getFloat32(204, true)).toBe(1);
  });

  it("round-trips a non-default run.fogDensity at offset 204", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const view = new DataView(
      packEscapeGpuParams(de, { itemCount: 1, fogDensity: 0.35 }),
    );
    expect(view.getFloat32(204, true)).toBe(Math.fround(0.35));
  });

  it("packs footprint at offset 68 as 0 even when run.footprint is passed — a forward loop has no cone-footprint depth cap", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const withFootprint = new DataView(
      packEscapeGpuParams(de, { itemCount: 1, footprint: 0.5 }),
    );
    expect(withFootprint.getFloat32(68, true)).toBe(0);
    const without = new DataView(packEscapeGpuParams(de, { itemCount: 1 }));
    expect(without.getFloat32(68, true)).toBe(0);
  });

  it("packs hitFloorEps at offset 80 as fround(boundingRadius * SURFACE_GPU_HIT_FLOOR) by default, and fround(boundingRadius * run.hitFloor) when given", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const def = new DataView(packEscapeGpuParams(de, { itemCount: 1 }));
    expect(def.getFloat32(80, true)).toBe(
      Math.fround(de.boundingRadius * SURFACE_GPU_HIT_FLOOR),
    );
    const overridden = new DataView(
      packEscapeGpuParams(de, { itemCount: 1, hitFloor: 0.03 }),
    );
    expect(overridden.getFloat32(80, true)).toBe(
      Math.fround(de.boundingRadius * 0.03),
    );
  });

  it("packs the final transform as identity/1 at 96..156 — the escape gate refuses final transforms, so nothing else is ever eligible to fill it", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const view = new DataView(packEscapeGpuParams(de, { itemCount: 1 }));
    expect(view.getFloat32(96, true)).toBe(1);
    expect(view.getFloat32(100, true)).toBe(0);
    expect(view.getFloat32(104, true)).toBe(0);
    expect(view.getFloat32(108, true)).toBe(0);
    expect(view.getFloat32(112, true)).toBe(0);
    expect(view.getFloat32(116, true)).toBe(1);
    expect(view.getFloat32(120, true)).toBe(0);
    expect(view.getFloat32(124, true)).toBe(0);
    expect(view.getFloat32(128, true)).toBe(0);
    expect(view.getFloat32(132, true)).toBe(0);
    expect(view.getFloat32(136, true)).toBe(1);
    expect(view.getFloat32(140, true)).toBe(0);
    expect(view.getFloat32(156, true)).toBe(1); // finalSigmaMin
  });

  it("packs pose ro/right/up/fwd/tanHalf/aspect/pixelEps/raster at their documented offsets, and the documented defaults when no pose is given", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const pose: SurfaceGpuPose = {
      ro: [1.1, 2.2, 3.3],
      right: [1, 0, 0],
      up: [0, 1, 0],
      fwd: [0, 0, -1],
      tanHalf: 0.5773,
      aspect: 1.7778,
      rasterWidth: 640,
      rasterHeight: 360,
      pixelEps: 0.0007,
    };
    const view = new DataView(packEscapeGpuParams(de, { itemCount: 1, pose }));

    expect(view.getFloat32(76, true)).toBe(Math.fround(pose.pixelEps));
    expect(view.getUint32(84, true)).toBe(pose.rasterWidth);
    expect(view.getUint32(88, true)).toBe(pose.rasterHeight);
    expect(view.getFloat32(144, true)).toBe(Math.fround(pose.ro[0]));
    expect(view.getFloat32(148, true)).toBe(Math.fround(pose.ro[1]));
    expect(view.getFloat32(152, true)).toBe(Math.fround(pose.ro[2]));
    expect(view.getFloat32(160, true)).toBe(Math.fround(pose.right[0]));
    expect(view.getFloat32(164, true)).toBe(Math.fround(pose.right[1]));
    expect(view.getFloat32(168, true)).toBe(Math.fround(pose.right[2]));
    expect(view.getFloat32(172, true)).toBe(Math.fround(pose.tanHalf));
    expect(view.getFloat32(176, true)).toBe(Math.fround(pose.up[0]));
    expect(view.getFloat32(180, true)).toBe(Math.fround(pose.up[1]));
    expect(view.getFloat32(184, true)).toBe(Math.fround(pose.up[2]));
    expect(view.getFloat32(188, true)).toBe(Math.fround(pose.aspect));
    expect(view.getFloat32(192, true)).toBe(Math.fround(pose.fwd[0]));
    expect(view.getFloat32(196, true)).toBe(Math.fround(pose.fwd[1]));
    expect(view.getFloat32(200, true)).toBe(Math.fround(pose.fwd[2]));

    const noPose = new DataView(packEscapeGpuParams(de, { itemCount: 1 }));
    expect(noPose.getFloat32(76, true)).toBe(0);
    expect(noPose.getUint32(84, true)).toBe(0);
    expect(noPose.getUint32(88, true)).toBe(0);
    expect(noPose.getFloat32(144, true)).toBe(0);
    expect(noPose.getFloat32(148, true)).toBe(0);
    expect(noPose.getFloat32(152, true)).toBe(0);
    expect(noPose.getFloat32(160, true)).toBe(1);
    expect(noPose.getFloat32(164, true)).toBe(0);
    expect(noPose.getFloat32(168, true)).toBe(0);
    expect(noPose.getFloat32(172, true)).toBe(0);
    expect(noPose.getFloat32(176, true)).toBe(0);
    expect(noPose.getFloat32(180, true)).toBe(1);
    expect(noPose.getFloat32(184, true)).toBe(0);
    expect(noPose.getFloat32(188, true)).toBe(1);
    expect(noPose.getFloat32(192, true)).toBe(0);
    expect(noPose.getFloat32(196, true)).toBe(0);
    expect(noPose.getFloat32(200, true)).toBe(1);
  });

  it("packs the forward map's m rows / t / escParams at the documented 208..271 offsets, a negative weight keeping w and derivGrowth distinguishable", () => {
    const de = buildEscapeDE([negativeWeightMandelbox()]);
    // Sanity pin on the fixture (escape-de.test.ts owns buildEscapeDE's own
    // correctness): w and derivGrowth must differ, or this test could not
    // catch an offset swap between 260 and 264.
    expect(de.w).toBe(-2);
    expect(de.derivGrowth).toBeCloseTo(3, 12);

    const view = new DataView(packEscapeGpuParams(de, { itemCount: 1 }));
    expect(view.getFloat32(208, true)).toBe(Math.fround(de.m[0]));
    expect(view.getFloat32(212, true)).toBe(Math.fround(de.m[1]));
    expect(view.getFloat32(216, true)).toBe(Math.fround(de.m[2]));
    expect(view.getFloat32(220, true)).toBe(Math.fround(de.t[0]));
    expect(view.getFloat32(224, true)).toBe(Math.fround(de.m[3]));
    expect(view.getFloat32(228, true)).toBe(Math.fround(de.m[4]));
    expect(view.getFloat32(232, true)).toBe(Math.fround(de.m[5]));
    expect(view.getFloat32(236, true)).toBe(Math.fround(de.t[1]));
    expect(view.getFloat32(240, true)).toBe(Math.fround(de.m[6]));
    expect(view.getFloat32(244, true)).toBe(Math.fround(de.m[7]));
    expect(view.getFloat32(248, true)).toBe(Math.fround(de.m[8]));
    expect(view.getFloat32(252, true)).toBe(Math.fround(de.t[2]));
    expect(view.getFloat32(256, true)).toBe(Math.fround(de.foldKind));
    expect(view.getFloat32(260, true)).toBe(Math.fround(de.w));
    expect(view.getFloat32(264, true)).toBe(Math.fround(de.derivGrowth));
    expect(view.getFloat32(268, true)).toBe(0); // packed-zero spare
  });
});

describe("packEscapeGpuMaps (the formula chain, fr-s04t)", () => {
  it("packs one GpuMap stride per link, in document order, with the forward rows and the uEscParams quartet", () => {
    const de = buildEscapeDE([canonicalMandelbox(), rotatedBoxfold()]);
    const maps = packEscapeGpuMaps(de);
    expect(maps.length).toBe(2 * SURFACE_GPU_MAP_VEC4 * 4);
    de.links.forEach((link, j) => {
      const base = j * SURFACE_GPU_MAP_VEC4 * 4;
      // r0/r1/r2: the FORWARD linear part's rows, t in the .w lanes.
      expect(Array.from(maps.slice(base, base + 12))).toEqual(
        [
          link.m[0],
          link.m[1],
          link.m[2],
          link.t[0],
          link.m[3],
          link.m[4],
          link.m[5],
          link.t[1],
          link.m[6],
          link.m[7],
          link.m[8],
          link.t[2],
        ].map(Math.fround),
      );
      // p0: the GLSL uEscParams order, so both mirrors read one quartet.
      expect(maps[base + 12]).toBe(link.foldKind);
      expect(maps[base + 13]).toBe(Math.fround(link.w));
      expect(maps[base + 14]).toBe(Math.fround(link.derivGrowth));
      expect(maps[base + 15]).toBe(0);
      // bnb/p1: inverse-descent lanes this core never reads, zero-packed
      // for layout parity (the affine cores' own contract).
      expect(Array.from(maps.slice(base + 16, base + 24))).toEqual(
        new Array(8).fill(0),
      );
    });
  });

  it("keeps the links DISTINCT — a chain of two different folds packs two different strides", () => {
    const de = buildEscapeDE([canonicalMandelbox(), rotatedBoxfold()]);
    const maps = packEscapeGpuMaps(de);
    const stride = SURFACE_GPU_MAP_VEC4 * 4;
    const head = Array.from(maps.slice(0, stride));
    const tail = Array.from(maps.slice(stride, 2 * stride));
    expect(head).not.toEqual(tail);
    // Specifically the fold KIND lane: mandelbox (3) then boxfold (1), the
    // dispatch every body branches on.
    expect(maps[12]).not.toBe(maps[stride + 12]);
  });

  it("agrees with the params block's head link — the wire's one redundancy cannot drift", () => {
    const de = buildEscapeDE([canonicalMandelbox(), rotatedBoxfold()]);
    const maps = packEscapeGpuMaps(de);
    const view = new DataView(packEscapeGpuParams(de, { itemCount: 1 }));
    expect(maps[0]).toBe(view.getFloat32(208, true));
    expect(maps[3]).toBe(view.getFloat32(220, true));
    expect(maps[12]).toBe(view.getFloat32(256, true));
    expect(maps[13]).toBe(view.getFloat32(260, true));
    expect(maps[14]).toBe(view.getFloat32(264, true));
  });

  it("pads to one zero stride rather than an empty array, like packSurfaceGpuMaps", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const empty = packEscapeGpuMaps({ ...de, links: [] });
    expect(empty.length).toBe(SURFACE_GPU_MAP_VEC4 * 4);
    expect(Array.from(empty)).toEqual(
      new Array(SURFACE_GPU_MAP_VEC4 * 4).fill(0),
    );
  });
});

describe("surfaceDeKernelWgsl escape core (core, fr-dlxh)", () => {
  it("throws when combined with a fold-final lens — the escape gate refuses final transforms, so no shape is pinned", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "escape", lens: true })),
    ).toThrow(/escape core cannot take a fold-final lens/);
  });

  it("still validates width and workgroupSize, even though the forward loop ignores both", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "escape", width: 0 })),
    ).toThrow();
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "escape", workgroupSize: 0 })),
    ).toThrow();
  });

  it("mode 'eval' emits the forward-loop body once, reads its chain from the maps binding, and carries none of the fold/affine descent markers", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "escape" }),
    );
    expect(wgsl).toContain("fn evalQueries");
    expect(
      wgsl.split("fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32)").length,
    ).toBe(2);
    expect(wgsl).toContain("dr = L.p0.z * localL * dr + 1.0");
    // fr-s04t: the formula chain rides the maps storage binding — one
    // GpuMap per link — and the head link's params block stays declared
    // as frozen layout ballast the body no longer reads.
    expect(wgsl).toContain(
      "@group(0) @binding(1) var<storage, read> maps: array<GpuMap>;",
    );
    expect(wgsl).toContain("struct GpuMap {");
    expect(wgsl).toContain("escM0: vec3f");
    expect(wgsl).toContain("escT0: f32");
    expect(wgsl).toContain("escParams: vec4f");
    for (const marker of [
      "mapApply",
      "stepSector",
      "frontierIx",
      "fcX",
      "refinedCert",
      "surfaceDECore",
    ]) {
      expect(wgsl).not.toContain(marker);
    }
  });

  it("mode 'eval' CYCLES through the chain: maxDepth * mapCount single-link steps, slot i mod n, the offset and the bailout test after EACH link", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "escape" }),
    );
    // A PASS is one full cycle, so maxDepth keeps meaning "how many times
    // is each link applied" (escape-de.ts's A PASS IS ONE FULL CYCLE).
    expect(wgsl).toContain("let n = params.mapCount;");
    expect(wgsl).toContain("let steps = params.maxDepth * n;");
    expect(wgsl).toContain("let L = maps[link];");
    // The cycle's wrap — slot i mod n without an integer division.
    expect(wgsl).toContain("link++;");
    expect(wgsl).toContain("if (link == n) {");
    // The bailout test sits at the head of the SINGLE-LINK step, and the
    // Mandelbrot offset lands per link — never once per pass (chaining
    // fattens the set to 72.8% of the bailout ball at six links).
    expect(wgsl).toContain("v = L.p0.y * y + q;");
  });

  it("mode 'eval' folds the query into the kaleidoscope's wedge ONCE before the orbit, dihedrally", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "escape" }),
    );
    expect(wgsl).toContain("fn foldQuerySector(p: vec3f) -> vec3f {");
    // Order 1 returns the point untouched — what keeps an unsymmetrised
    // document bit-identical to the pre-chain kernel.
    expect(wgsl).toContain("if (params.symOrder <= 1u) {\n    return p;");
    // DIHEDRAL: a rotation back to the wedge AND a mirror (the abs). A
    // rotate-only fold is discontinuous across seams and has no Lipschitz
    // bound at all (escape-de.ts's KALEIDOSCOPE IS FREE section).
    expect(wgsl).toContain("let turn = round(atan2(b, a) / sector) * sector;");
    expect(wgsl).toContain("let fb = abs(b * c - a * s);");
    // Seeded AND offset by the folded point, so the set is exactly
    // g^-1(M) rather than a rotated smear of it.
    expect(wgsl).toContain("let q = foldQuerySector(pIn);");
  });

  it("mode 'march' keeps the same absence set, and rays 'unproject' composes normally with ShadeParams at binding 4", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "escape" }),
    );
    expect(wgsl).toContain("fn marchRays");
    for (const marker of [
      "mapApply",
      "stepSector",
      "frontierIx",
      "fcX",
      "refinedCert",
      "surfaceDECore",
    ]) {
      expect(wgsl).not.toContain(marker);
    }

    const unprojected = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "escape", rays: "unproject" }),
    );
    expect(unprojected).toContain("fn marchRays");
    expect(unprojected).toContain("shade.invProjView");
    expect(unprojected).toContain(
      "@group(0) @binding(4) var<uniform> shade: ShadeParams;",
    );
  });

  it("mode 'shade' emits the escape hit-info once, with the escape fraction as trap, over the full shading interface", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "escape" }),
    );
    expect(wgsl).toContain("fn shadeRays");
    expect(wgsl).toContain("escapedAt = i");
    // The CONTINUOUS escape count (fr-7u8t.8) — the raw integer read as
    // confetti under a palette once the object stopped being a blob.
    // Normalized by the PASS budget and not the single-link step budget
    // (fr-byxb, mirroring the GLSL arm): escapedAt counts single-link steps
    // and an orbit escapes after a handful of them however long the chain
    // is, so dividing by a budget that multiplies by the link count painted
    // a six-link chain inside the darkest fifth of its palette.
    expect(wgsl).toContain("(f32(escapedAt) - escFrac) / f32(params.maxDepth)");
    expect(wgsl).not.toContain("(f32(escapedAt) - escFrac) / f32(steps)");
    // Only the denominator moved: the loop bound and the escaped test stay
    // the per-link step budget.
    expect(wgsl).toContain("let steps = params.maxDepth * n;");
    expect(wgsl).toContain("if (escapedAt < steps && growth > 1.0) {");
    // ...and the growth rate the fraction divides by is the link that
    // actually produced the escaping radius, not a fixed uniform.
    expect(wgsl).toContain("growth = L.p0.z;");
    expect(wgsl).toContain("let q = foldQuerySector(p);");
    expect(wgsl.split("fn surfaceDEHitInfo(").length).toBe(2);
    expect(wgsl).toContain(
      "@group(0) @binding(5) var<storage, read> shadeMaps: array<vec4f>;",
    );
    expect(wgsl).toContain(
      "@group(0) @binding(6) var<storage, read_write> colorOut: array<u32>;",
    );
    expect(wgsl).toContain(
      "@group(0) @binding(7) var lutTex: texture_2d<f32>;",
    );
    expect(wgsl).toContain("@group(0) @binding(8) var lutSamp: sampler;");
    expect(wgsl).not.toContain("fn surfaceDEProbe");
  });

  it("ignores width, sharedFrontier and bnbStage2 — all producing identical eval source", () => {
    const base = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "escape", width: 4 }),
    );
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "escape", width: 12 }),
      ),
    ).toBe(base);
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "escape", sharedFrontier: true }),
      ),
    ).toBe(base);
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "escape", bnbStage2: true }),
      ),
    ).toBe(base);
  });

  it("ignores shadeDeWidth in shade mode too — no probe descent for a forward loop with nothing to narrow", () => {
    const shadeBase = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "escape" }),
    );
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core: "escape", shadeDeWidth: 1 }),
      ),
    ).toBe(shadeBase);
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core: "escape", shadeDeWidth: 12 }),
      ),
    ).toBe(shadeBase);
  });

  it("surfaceGpuWorkgroupBytes returns 0 for core 'escape' even under sharedFrontier — the forward loop has no frontier concept", () => {
    expect(
      surfaceGpuWorkgroupBytes({
        core: "escape",
        width: 12,
        workgroupSize: 32,
        sharedFrontier: true,
      }),
    ).toBe(0);
  });
});

describe("surfaceDeKernelWgsl affine4 core (core, fr-dlxh 4D)", () => {
  it("accepts a fold-final lens since fr-rsp6 phase 2B — descendLens4's sweep around the REFINED ladder", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ core: "affine4", lens: true }),
    );
    expect(wgsl).toContain("fn surfaceDECore(qIn: vec4f, qExt: vec4f,");
    expect(wgsl).toContain("fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32)");
  });

  it("still validates width and workgroupSize, even though the fixed-width ladder ignores both", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "affine4", width: 0 })),
    ).toThrow();
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "affine4", workgroupSize: 0 })),
    ).toThrow();
  });

  it("mode 'eval' emits the affine4 ladder body once, declares the 4D variant uniform fields, and carries none of the fold/affine/escape/lens descent markers", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "affine4" }),
    );
    expect(wgsl).toContain("fn evalQueries");
    expect(
      wgsl.split("fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32)").length,
    ).toBe(2);
    for (const marker of [
      "fn refinedCert(img: vec4f",
      "rotorInvApply4",
      "segmentRadius4",
      "stepSector4",
      "struct GpuMap4",
      "array<GpuMap4>",
      "rotorInvR0",
      "stepBack4R0",
      "final4MR0",
      "final4T",
      "w0",
      "sliceHalfW",
      "final4SigmaMin",
    ]) {
      expect(wgsl).toContain(marker);
    }
    // Every other core's identity, and the 3D-only surface it replaces.
    // The Params struct still DECLARES boundCenter/footprint/finalSigmaMin
    // for every core (module doc: "a struct never reads past its own
    // size"), so the absence check is on the READ site ("params."-
    // prefixed), never the bare field name.
    for (const marker of [
      "frontierIx",
      "fcX",
      "escParams",
      "escM0",
      "lensParams",
      "surfaceDECore",
      "struct GpuMap {",
      "fn mapApply(m: GpuMap,",
      "fn stepSector(v: vec3f)",
      "params.footprint",
      "params.finalSigmaMin",
      "params.boundCenter",
    ]) {
      expect(wgsl).not.toContain(marker);
    }
  });

  it("mode 'march' keeps the same absence set under pose rays, and rays 'unproject' composes normally with ShadeParams at binding 4", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "affine4" }),
    );
    expect(wgsl).toContain("fn marchRays");
    for (const marker of [
      "frontierIx",
      "fcX",
      "escParams",
      "escM0",
      "lensParams",
      "surfaceDECore",
    ]) {
      expect(wgsl).not.toContain(marker);
    }

    const unprojected = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "affine4", rays: "unproject" }),
    );
    expect(unprojected).toContain("fn marchRays");
    expect(unprojected).toContain("shade.invProjView");
    expect(unprojected).toContain(
      "@group(0) @binding(4) var<uniform> shade: ShadeParams;",
    );
  });

  it("mode 'shade' emits the 4D hit-info descent once, with its own segment-aware markers, over the full shading interface", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine4" }),
    );
    expect(wgsl).toContain("fn shadeRays");
    expect(wgsl.split("fn surfaceDEHitInfo(").length).toBe(2);
    expect(wgsl).toContain("c1Map");
    expect(wgsl).toContain("c1Ext");
    expect(wgsl).toContain("shade.colorSpeed");
    expect(wgsl).toContain("rotorInvApply4");
    // The dimension-specific color normalizers (module doc): height over
    // the FULL 4D visible radius, radius as the rotor-lifted TRUE 4D
    // radius — the slice-invariant 4D GLSL forms, not the 3D entries'
    // straight visibleRadius reads. Radius lifts through the slab hit's
    // OWN w (fr-9c9e): hit-info's sStar places it along the fr-wa6o
    // segment, and stays 0 at h = 0 (w0 exactly).
    expect(wgsl).toContain("params.visRadius4");
    expect(wgsl).toContain(
      "let hitW = params.w0 + hi.sStar * params.sliceHalfW;",
    );
    expect(wgsl).toContain("rotorInvApply4(vec4f(pos, hitW))");
    expect(wgsl).toContain("info.sStar = segmentS4(c1Q, c1Ext);");
    expect(wgsl).toContain(
      "@group(0) @binding(5) var<storage, read> shadeMaps: array<vec4f>;",
    );
    expect(wgsl).toContain(
      "@group(0) @binding(6) var<storage, read_write> colorOut: array<u32>;",
    );
    expect(wgsl).toContain(
      "@group(0) @binding(7) var lutTex: texture_2d<f32>;",
    );
    expect(wgsl).toContain("@group(0) @binding(8) var lutSamp: sampler;");
    expect(wgsl).not.toContain("fn surfaceDEProbe");
  });

  it("ignores width, sharedFrontier and bnbStage2 — all producing identical eval source", () => {
    const base = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "affine4", width: 4 }),
    );
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "affine4", width: 12 }),
      ),
    ).toBe(base);
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "affine4", sharedFrontier: true }),
      ),
    ).toBe(base);
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "affine4", bnbStage2: true }),
      ),
    ).toBe(base);
  });

  it("ignores shadeDeWidth in shade mode too — no probe descent for a fixed-width ladder with nothing to narrow", () => {
    const shadeBase = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine4" }),
    );
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core: "affine4", shadeDeWidth: 1 }),
      ),
    ).toBe(shadeBase);
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core: "affine4", shadeDeWidth: 12 }),
      ),
    ).toBe(shadeBase);
    expect(shadeBase).not.toContain("surfaceDEProbe");
  });

  it("surfaceGpuWorkgroupBytes returns 0 for core 'affine4' even under sharedFrontier — the fixed-width ladder declares no frontier arrays", () => {
    expect(
      surfaceGpuWorkgroupBytes({
        core: "affine4",
        width: 12,
        workgroupSize: 32,
        sharedFrontier: true,
      }),
    ).toBe(0);
  });

  it("carries no affine4 markers into any fold/affine/escape config — the byte-identity guard for the fourth core", () => {
    const affine4Markers = [
      "GpuMap4",
      "rotorInvR0",
      "segmentRadius4",
      "final4SigmaMin",
      "visRadius4",
    ];
    const cases: Partial<SurfaceGpuKernelOptions>[] = [
      { core: "fold", mode: "eval", width: 12 },
      { core: "fold", mode: "march", width: 12 },
      { core: "fold", mode: "march", rays: "unproject", width: 12 },
      { core: "fold", mode: "shade", width: 12 },
      { core: "fold", mode: "eval", width: 12, lens: true },
      { core: "fold", mode: "shade", width: 12, lens: true },
      { core: "affine", mode: "eval", width: 4 },
      { core: "affine", mode: "march", width: 4 },
      { core: "affine", mode: "shade", width: 4 },
      { core: "affine", mode: "eval", width: 4, lens: true },
      { core: "affine", mode: "shade", width: 4, lens: true },
      { core: "escape", mode: "eval" },
      { core: "escape", mode: "march" },
      { core: "escape", mode: "march", rays: "unproject" },
      { core: "escape", mode: "shade" },
    ];
    for (const overrides of cases) {
      const wgsl = surfaceDeKernelWgsl(kernelOpts(overrides));
      for (const marker of affine4Markers) {
        expect(wgsl).not.toContain(marker);
      }
    }
  });
});

describe("surfaceDeKernelWgsl affine4 slab half-extent (slabExt, fr-d0nn probe for fr-b72d)", () => {
  it("defaults to true: explicit and omitted produce identical eval-mode source", () => {
    const omitted = surfaceDeKernelWgsl(kernelOpts({ core: "affine4" }));
    const explicit = surfaceDeKernelWgsl(
      kernelOpts({ core: "affine4", slabExt: true }),
    );
    expect(explicit).toBe(omitted);
  });

  it("false strips the fr-wa6o half-extent machinery from the eval-mode descent (fn refinedCert / fn surfaceDE), leaving the shared segmentRadius4 helper declared but uncalled", () => {
    const withExt = surfaceDeKernelWgsl(kernelOpts({ core: "affine4" }));
    const withoutExt = surfaceDeKernelWgsl(
      kernelOpts({ core: "affine4", slabExt: false }),
    );
    expect(withoutExt).not.toBe(withExt);
    expect(withoutExt).not.toContain("let segment");
    expect(withoutExt).not.toContain("aExt");
    expect(withoutExt).not.toContain("imgExt");
    // The helper FUNCTION DEFINITION survives (dead code Tint DCEs it);
    // every CALL site in refinedCert/surfaceDE is gone, so the sole
    // surviving occurrence of the substring is that definition line.
    expect([...withoutExt.matchAll(/segmentRadius4\(/g)].length).toBe(1);
    expect(withoutExt).toContain("fn segmentRadius4(");
    expect(withoutExt).toContain("length(q)");
    expect(withoutExt).toContain("length(img)");

    for (const wgsl of [withExt, withoutExt]) {
      const opens = [...wgsl.matchAll(/\{/g)].length;
      const closes = [...wgsl.matchAll(/\}/g)].length;
      expect(closes).toBe(opens);
    }
  });

  it("carries the same absences into mode 'shade', which additionally exercises the affine4 hit-info descent", () => {
    const withExt = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine4" }),
    );
    const withoutExt = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine4", slabExt: false }),
    );
    expect(withoutExt).not.toBe(withExt);
    expect(withoutExt).not.toContain("let segment");
    expect(withoutExt).not.toContain("aExt");
    expect(withoutExt).not.toContain("imgExt");
    expect([...withoutExt.matchAll(/segmentRadius4\(/g)].length).toBe(1);
    expect(withoutExt).toContain("fn segmentRadius4(");
    expect(withoutExt).toContain("length(q)");
    expect(withoutExt).toContain("length(img)");

    for (const wgsl of [withExt, withoutExt]) {
      const opens = [...wgsl.matchAll(/\{/g)].length;
      const closes = [...wgsl.matchAll(/\}/g)].length;
      expect(closes).toBe(opens);
    }
  });

  it("threads the slab hit's own w into the radius color (fr-9c9e): slab shade updates info.sStar per level, noslab keeps the constructor's 0", () => {
    const withExt = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine4" }),
    );
    expect(withExt).toContain("info.sStar = segmentS4(c1Q, c1Ext);");
    const withoutExt = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine4", slabExt: false }),
    );
    // The helper declaration survives (Tint DCEs it); no call site
    // remains, so sStar keeps the constructor's 0 and the shade entry's
    // hitW collapses to w0 — the slice plane, today's value exactly.
    expect([...withoutExt.matchAll(/segmentS4\(/g)].length).toBe(1);
    expect(withoutExt).toContain(
      "let hitW = params.w0 + hi.sStar * params.sliceHalfW;",
    );
  });

  it("is inert outside core 'affine4' — fold/affine/escape generate byte-identical source with slabExt false or absent", () => {
    for (const core of ["fold", "affine", "escape"] as const) {
      const base = surfaceDeKernelWgsl(kernelOpts({ core }));
      const withFalse = surfaceDeKernelWgsl(
        kernelOpts({ core, slabExt: false }),
      );
      expect(withFalse).toBe(base);
    }
  });
});

describe("surfaceDeKernelWgsl 4D maps address space (mapsUniform, fr-b72d probe)", () => {
  const STORAGE_LINE =
    "@group(0) @binding(1) var<storage, read> maps: array<GpuMap4>;";
  const UNIFORM_LINE = `@group(0) @binding(1) var<uniform> maps: array<GpuMap4, ${SURFACE_GPU_UNIFORM_MAP_SLOTS}>;`;

  it("defaults to false: explicit and omitted produce identical source for both 4D cores", () => {
    for (const core of ["affine4", "fold4"] as const) {
      const omitted = surfaceDeKernelWgsl(kernelOpts({ core }));
      const explicit = surfaceDeKernelWgsl(
        kernelOpts({ core, mapsUniform: false }),
      );
      expect(explicit).toBe(omitted);
      expect(omitted).toContain(STORAGE_LINE);
      expect(omitted).not.toContain(UNIFORM_LINE);
    }
  });

  it("true swaps EXACTLY the binding declaration — substituting the storage line back reproduces the default text byte for byte, in every 4D (core, mode) pair", () => {
    for (const core of ["affine4", "fold4"] as const) {
      for (const mode of ["eval", "march", "shade"] as const) {
        const storage = surfaceDeKernelWgsl(kernelOpts({ core, mode }));
        const uniform = surfaceDeKernelWgsl(
          kernelOpts({ core, mode, mapsUniform: true }),
        );
        expect(uniform).toContain(UNIFORM_LINE);
        expect(uniform).not.toContain(STORAGE_LINE);
        expect(uniform.replace(UNIFORM_LINE, STORAGE_LINE)).toBe(storage);
      }
    }
  });

  it("declares SURFACE_GPU_UNIFORM_MAP_SLOTS slots — the app's 4D eligibility cap, so no eligible system overflows the fixed array", () => {
    expect(SURFACE_GPU_UNIFORM_MAP_SLOTS).toBe(24);
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ core: "affine4", mapsUniform: true }),
    );
    expect(wgsl).toContain("array<GpuMap4, 24>");
  });

  it("composes with slabExt:false and with the lens wrapper as the same one-line swap", () => {
    const cases = [
      { core: "affine4", slabExt: false },
      { core: "affine4", lens: true },
      { core: "fold4", slabExt: false, lens: true },
    ] as const;
    for (const overrides of cases) {
      const storage = surfaceDeKernelWgsl(kernelOpts({ ...overrides }));
      const uniform = surfaceDeKernelWgsl(
        kernelOpts({ ...overrides, mapsUniform: true }),
      );
      expect(uniform.replace(UNIFORM_LINE, STORAGE_LINE)).toBe(storage);
      const opens = [...uniform.matchAll(/\{/g)].length;
      const closes = [...uniform.matchAll(/\}/g)].length;
      expect(closes).toBe(opens);
    }
  });

  it("is inert outside the 4D cores — fold/affine/escape generate byte-identical source with mapsUniform true or absent", () => {
    for (const core of ["fold", "affine", "escape"] as const) {
      const base = surfaceDeKernelWgsl(kernelOpts({ core }));
      const withTrue = surfaceDeKernelWgsl(
        kernelOpts({ core, mapsUniform: true }),
      );
      expect(withTrue).toBe(base);
    }
  });
});

describe("surfaceDeKernelWgsl fold4 core (core, fr-rsp6 phase 2A)", () => {
  it("accepts a fold-final lens since phase 2B — descendLens4's sweep around the PLAIN frontier", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ core: "fold4", lens: true }));
    expect(wgsl).toContain("fn surfaceDECore(qIn: vec4f, qExt: vec4f,");
    expect(wgsl).toContain("fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32)");
  });

  it("validates width and workgroup size, which this core actually uses", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "fold4", width: 0 })),
    ).toThrow();
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "fold4", width: 2.5 })),
    ).toThrow();
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "fold4", workgroupSize: 0 })),
    ).toThrow();
  });

  it("mode 'eval' emits the fold4 frontier body once over the 4D uniform/maps interface, carrying none of the other cores' markers", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "fold4" }),
    );
    expect(wgsl).toContain("fn evalQueries");
    expect(
      wgsl.split("fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32)").length,
    ).toBe(2);
    for (const marker of [
      "var fcQ: array<vec4f, 4>;",
      "var fnCert: array<f32, 4>;",
      "fnWorstIdx",
      "rotorInvApply4",
      "segmentRadius4",
      "stepSector4",
      "struct GpuMap4",
      "array<GpuMap4>",
      "final4SigmaMin",
    ]) {
      expect(wgsl).toContain(marker);
    }
    // The 3D fold core's frontier plumbing, the affine ladders' refined
    // certificate, and every other core's variant block.
    for (const marker of [
      "frontierIx",
      "var fcX",
      "fn refinedCert",
      "fn mapApply(m: GpuMap,",
      "fn stepSector(v: vec3f)",
      "params.footprint",
      "params.finalSigmaMin",
      "params.boundCenter",
      "escParams",
      "lensParams",
      "surfaceDECore",
    ]) {
      expect(wgsl).not.toContain(marker);
    }
  });

  it("enumerates the 4D branch fans — 81 boxfold / 3 spherefold / 243 mandelbox — and skips the mandelbox box expansion 80 wide, never 3D's 27/26", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "fold4" }),
    );
    expect(wgsl).toContain("branchCount = 81u;");
    expect(wgsl).toContain("branchCount = 3u;");
    expect(wgsl).toContain("branchCount = 243u;");
    // Mandelbox decode: b = boxIndex + 81 * sphereIndex, and the shell
    // guard skips the whole 81-wide expansion.
    expect(wgsl).toContain("(b % 81u) == 0u");
    expect(wgsl).toContain("s = b / 81u;");
    expect(wgsl).toContain("bb = b % 81u;");
    expect(wgsl).toContain("b += 80u;");
    // The FOUR-digit box code: selW is the 27s digit (3D stops at selZ).
    expect(wgsl).toContain("let selW = bb / 27u;");
    expect(wgsl).not.toContain("branchCount = 27u;");
    expect(wgsl).not.toContain("b += 26u;");
  });

  it("mode 'march' keeps the shared march entry and the same absence set, and rays 'unproject' composes normally", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "fold4" }),
    );
    expect(wgsl).toContain("fn marchRays");
    expect(wgsl).toContain("let d = surfaceDE(ro + rd * t, eps, li);");
    for (const marker of ["frontierIx", "var fcX", "escParams", "lensParams"]) {
      expect(wgsl).not.toContain(marker);
    }

    const unprojected = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "fold4", rays: "unproject" }),
    );
    expect(unprojected).toContain("shade.invProjView");
    expect(unprojected).toContain(
      "@group(0) @binding(4) var<uniform> shade: ShadeParams;",
    );
  });

  it("mode 'shade' emits the greedy fold4 hit-info once, with the 4D color normalizers, over the full shading interface", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "fold4" }),
    );
    expect(wgsl).toContain("fn shadeRays");
    expect(wgsl.split("fn surfaceDEHitInfo(").length).toBe(2);
    // The greedy width-1 chain's argmin state (the 3D fold hit-info's
    // vocabulary) over the 4D branch fan.
    expect(wgsl).toContain("var lbKey = 1e30;");
    expect(wgsl).toContain("lbMap = j;");
    expect(wgsl).toContain("trapAcc += trapW * shadeMaps[lbMap].w;");
    expect(wgsl).toContain("branchCount = 243u;");
    expect(wgsl).toContain("rotorInvApply4");
    // Slice-invariant height/radius normalizers, like the affine4 core —
    // radius through the slab hit's own w (fr-9c9e), the greedy chain's
    // level winner placing it.
    expect(wgsl).toContain("params.visRadius4");
    expect(wgsl).toContain(
      "let hitW = params.w0 + hi.sStar * params.sliceHalfW;",
    );
    expect(wgsl).toContain("rotorInvApply4(vec4f(pos, hitW))");
    expect(wgsl).toContain("info.sStar = segmentS4(lbQ, lbExt);");
    expect(wgsl).toContain(
      "@group(0) @binding(6) var<storage, read_write> colorOut: array<u32>;",
    );
    expect(wgsl).not.toContain("fn surfaceDEProbe");
  });

  it("honors width — the frontier arrays and the full-slot comparisons scale with it", () => {
    const w4 = surfaceDeKernelWgsl(kernelOpts({ mode: "eval", core: "fold4" }));
    const w12 = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "fold4", width: 12 }),
    );
    expect(w12).not.toBe(w4);
    expect(w12).toContain("var fcQ: array<vec4f, 12>;");
    expect(w12).toContain("if (keptCount == 12u && key >= fnWorstKey) {");
    expect(w12).toContain("for (var s2 = 0u; s2 < 12u; s2++) {");
    expect(w4).toContain("if (keptCount == 4u && key >= fnWorstKey) {");
  });

  it("ignores sharedFrontier and bnbStage2 — the frontier is private by measured verdict and stage 2 is never emitted", () => {
    const base = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "fold4", width: 12 }),
    );
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({
          mode: "eval",
          core: "fold4",
          width: 12,
          sharedFrontier: true,
        }),
      ),
    ).toBe(base);
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "fold4", width: 12, bnbStage2: true }),
      ),
    ).toBe(base);
    expect(base).not.toContain("var<workgroup>");
    expect(base).not.toContain("bnbSigmaSq");
    expect(base).not.toContain("m.bnb");
    expect(base).not.toContain("m.p1");
  });

  it("emits the fr-p8bc probe from the same body at the probe width, with no index helper to rename (both frontiers are function-scope)", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "fold4", width: 12, shadeDeWidth: 1 }),
    );
    expect(wgsl).toContain("fn surfaceDEProbe(pIn: vec3f");
    expect(wgsl).not.toContain("probeIx");
    const sizes = (text: string): number[] =>
      [...text.matchAll(/array<(?:vec4f|f32), (\d+)>/g)].map((m) =>
        Number(m[1]),
      );
    const probeAt = wgsl.indexOf("fn surfaceDEProbe(");
    const mainAt = wgsl.indexOf("fn surfaceDE(pIn: vec3f");
    const mainSizes = sizes(wgsl.slice(mainAt, probeAt));
    const probeSizes = sizes(wgsl.slice(probeAt));
    expect(mainSizes.length).toBe(12);
    expect(new Set(mainSizes)).toEqual(new Set([12]));
    expect(probeSizes.length).toBe(12);
    expect(new Set(probeSizes)).toEqual(new Set([1]));
    // Every shading tap rides the cheap descent, none the full frontier.
    expect(wgsl).toContain("surfaceDEProbe(pos + e.xyy * h, 0.0, li)");
    expect(wgsl).toContain("surfaceDEProbe(sp, 0.0, li)");
    expect(wgsl).toContain("surfaceDEProbe(pos + n * hh, 0.0, li)");
    expect(wgsl).not.toContain("surfaceDE(sp, 0.0, li)");
  });

  it("keeps shadeDeWidth's off state byte-identical (omitted or equal to width) and inert outside shade mode", () => {
    const shadeBase = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "fold4", width: 12 }),
    );
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({
          mode: "shade",
          core: "fold4",
          width: 12,
          shadeDeWidth: 12,
        }),
      ),
    ).toBe(shadeBase);
    expect(shadeBase).not.toContain("surfaceDEProbe");
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "fold4", shadeDeWidth: 1 }),
      ),
    ).toBe(surfaceDeKernelWgsl(kernelOpts({ mode: "eval", core: "fold4" })));
  });

  it("surfaceGpuWorkgroupBytes returns 0 for core 'fold4' even under sharedFrontier — its frontier is function-scope by construction", () => {
    expect(
      surfaceGpuWorkgroupBytes({
        core: "fold4",
        width: 12,
        workgroupSize: 32,
        sharedFrontier: true,
      }),
    ).toBe(0);
  });

  it("carries no fold4 markers into the affine4 core, which shares its uniform/maps interface", () => {
    for (const mode of ["eval", "march", "shade"] as const) {
      const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode, core: "affine4" }));
      for (const marker of [
        "var fcQ",
        "branchCount = 81u;",
        "branchCount = 243u;",
        "b += 80u;",
        "let selW",
      ]) {
        expect(wgsl).not.toContain(marker);
      }
    }
  });
});

describe("surfaceDeKernelWgsl fold4 slab half-extent (slabExt, fr-rsp6 phase 2A)", () => {
  it("defaults to true: explicit and omitted produce identical eval-mode source", () => {
    const omitted = surfaceDeKernelWgsl(kernelOpts({ core: "fold4" }));
    const explicit = surfaceDeKernelWgsl(
      kernelOpts({ core: "fold4", slabExt: true }),
    );
    expect(explicit).toBe(omitted);
  });

  it("false strips the fr-wa6o half-extent machinery from the eval-mode descent, leaving the shared segmentRadius4 helper declared but uncalled", () => {
    const withExt = surfaceDeKernelWgsl(
      kernelOpts({ core: "fold4", width: 12 }),
    );
    const withoutExt = surfaceDeKernelWgsl(
      kernelOpts({ core: "fold4", width: 12, slabExt: false }),
    );
    expect(withoutExt).not.toBe(withExt);
    expect(withoutExt).not.toContain("let segment");
    // Every extent register the frontier, the u-space hoist and the
    // branch decode carry under a slab query.
    for (const marker of [
      "fcExt",
      "fnExt",
      "sExt",
      "imgExt",
      "preExt",
      "var eu",
    ]) {
      expect(withExt).toContain(marker);
      expect(withoutExt).not.toContain(marker);
    }
    // The helper FUNCTION DEFINITION survives (Tint DCEs it); every call
    // site is gone, so the sole surviving occurrence is that line.
    expect([...withoutExt.matchAll(/segmentRadius4\(/g)].length).toBe(1);
    expect(withoutExt).toContain("fn segmentRadius4(");
    expect(withoutExt).toContain("let startR = length(q);");
    expect(withoutExt).toContain("let r = length(img);");
    // The frontier itself narrows by the two extent arrays.
    expect([...withExt.matchAll(/array<(?:vec4f|f32), 12>/g)].length).toBe(12);
    expect([...withoutExt.matchAll(/array<(?:vec4f|f32), 12>/g)].length).toBe(
      10,
    );

    for (const wgsl of [withExt, withoutExt]) {
      const opens = [...wgsl.matchAll(/\{/g)].length;
      const closes = [...wgsl.matchAll(/\}/g)].length;
      expect(closes).toBe(opens);
    }
  });

  it("carries the same absences into mode 'shade', which additionally exercises the fold4 hit-info and its probe", () => {
    const withoutExt = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "shade",
        core: "fold4",
        width: 12,
        shadeDeWidth: 1,
        slabExt: false,
      }),
    );
    expect(withoutExt).toContain("fn surfaceDEHitInfo(");
    expect(withoutExt).toContain("fn surfaceDEProbe(");
    expect(withoutExt).not.toContain("let segment");
    for (const marker of [
      "fcExt",
      "fnExt",
      "sExt",
      "imgExt",
      "chExt",
      "lbExt",
    ]) {
      expect(withoutExt).not.toContain(marker);
    }
    expect([...withoutExt.matchAll(/segmentRadius4\(/g)].length).toBe(1);
    const opens = [...withoutExt.matchAll(/\{/g)].length;
    const closes = [...withoutExt.matchAll(/\}/g)].length;
    expect(closes).toBe(opens);
  });

  it("threads the slab hit's own w into the radius color (fr-9c9e): slab shade updates info.sStar per level, noslab keeps the constructor's 0", () => {
    const withExt = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "fold4", width: 12 }),
    );
    expect(withExt).toContain("info.sStar = segmentS4(lbQ, lbExt);");
    const withoutExt = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "fold4", width: 12, slabExt: false }),
    );
    // The helper declaration survives (Tint DCEs it); no call site
    // remains, so sStar keeps the constructor's 0 and the shade entry's
    // hitW collapses to w0 — the slice plane, today's value exactly.
    expect([...withoutExt.matchAll(/segmentS4\(/g)].length).toBe(1);
    expect(withoutExt).toContain(
      "let hitW = params.w0 + hi.sStar * params.sliceHalfW;",
    );
  });
});

describe("surfaceDeKernelWgsl 4D fold-lens wrapper (lens, fr-rsp6 phase 2B)", () => {
  it("omitted and explicit lens:false stay byte-identical for both 4D cores, at either slabExt", () => {
    const cases: Partial<SurfaceGpuKernelOptions>[] = [
      { mode: "eval", core: "affine4" },
      { mode: "eval", core: "affine4", slabExt: false },
      { mode: "march", core: "fold4", width: 12 },
      { mode: "shade", core: "fold4", width: 12, shadeDeWidth: 1 },
      { mode: "shade", core: "fold4", width: 12, slabExt: false },
    ];
    for (const overrides of cases) {
      const omitted = surfaceDeKernelWgsl(kernelOpts(overrides));
      const explicit = surfaceDeKernelWgsl(
        kernelOpts({ ...overrides, lens: false }),
      );
      expect(explicit).toBe(omitted);
      expect(omitted).not.toContain("surfaceDECore");
      expect(omitted).not.toContain("lens4Params");
    }
  });

  it("renames the core, hoists the VIEW LIFT into the wrapper, and declares the lens4 params block — for both 4D cores", () => {
    for (const core of ["affine4", "fold4"] as const) {
      const wgsl = surfaceDeKernelWgsl(kernelOpts({ core, lens: true }));
      // Exactly one renamed core and one public wrapper, wrapper last.
      expect(wgsl.split("fn surfaceDECore(").length).toBe(2);
      expect(wgsl.split("fn surfaceDE(").length).toBe(2);
      expect(wgsl.indexOf("fn surfaceDECore(")).toBeLessThan(
        wgsl.indexOf("fn surfaceDE("),
      );
      // The 4D deviation: the core takes the LIFTED 4D query (plus its
      // half-extent under a slab), and the wrapper does the one rotor
      // apply — so exactly one rotorInvApply4 of the incoming vec3f is
      // left in the value path, in the wrapper.
      expect(wgsl).toContain(
        "fn surfaceDECore(qIn: vec4f, qExt: vec4f, cutoff: f32, li: u32) -> f32 {",
      );
      expect(wgsl).toContain("fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32)");
      expect(wgsl).toContain("let p = rotorInvApply4(vec4f(pIn, params.w0));");
      // …and that wrapper line is the ONLY lift left: the core reads its
      // query straight off the parameter.
      expect([...wgsl.matchAll(/rotorInvApply4\(vec4f\(pIn/g)].length).toBe(1);
      expect(wgsl).toContain("  var q = qIn;");
      // The appended params block, and NOT the 3D lens block.
      expect(wgsl).toContain("lens4Params: vec4f");
      expect(wgsl).toContain("lens4MR3: vec4f");
      expect(wgsl).not.toContain("lensParams: vec4f");
      // The 4D tail is still declared — a lensed 4D kernel needs both.
      expect(wgsl).toContain("rotorInvR0: vec4f");
      expect(wgsl).toContain("visRadius4: f32");
    }
  });

  it("sweeps the 4D branch fans (81/3/243, four-digit box code, b += 80u) — never 3D's 27/26", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ core: "affine4", lens: true }),
    );
    expect(wgsl).toContain("branchCount = 81u;");
    expect(wgsl).toContain("branchCount = 3u;");
    expect(wgsl).toContain("var branchCount = 243u;");
    expect(wgsl).toContain("(b % 81u) == 0u");
    expect(wgsl).toContain("s = b / 81u;");
    expect(wgsl).toContain("bb = b % 81u;");
    expect(wgsl).toContain("b += 80u;");
    expect(wgsl).toContain("let selW = bb / 27u;");
    expect(wgsl).not.toContain("branchCount = 27u;");
    expect(wgsl).not.toContain("b += 26u;");
  });

  it("floors the sweep on the FULL 4D visible radius, not the slice-adjusted march gate", () => {
    // params.visibleRadius carries the slice's shadow for this core
    // (packing contract); descendLens4's visible ball is the full 4D one,
    // so a wrapper reading the frozen slot would shrink its pin as w0
    // slides.
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ core: "affine4", lens: true }),
    );
    expect(wgsl).toContain(
      "let visBound = segmentRadius4(p, pExt) - params.visRadius4;",
    );
    expect(wgsl).not.toContain("- params.visibleRadius;");
    const noslab = surfaceDeKernelWgsl(
      kernelOpts({ core: "affine4", lens: true, slabExt: false }),
    );
    expect(noslab).toContain("let visBound = length(p) - params.visRadius4;");
  });

  it("hands the REFINED core the fr-55r5 inner cutoff and the PLAIN core cutoff 0 — descendLens4's `refine ? innerCutoff : 0` seam", () => {
    const affine4 = surfaceDeKernelWgsl(
      kernelOpts({ core: "affine4", lens: true }),
    );
    expect(affine4).toContain("innerCutoff = min(best, cutoff) / factor;");
    expect(affine4).toContain("surfaceDECore(q, qExt, innerCutoff, li)");

    const fold4 = surfaceDeKernelWgsl(
      kernelOpts({ core: "fold4", lens: true, width: 12 }),
    );
    expect(fold4).toContain("surfaceDECore(q, qExt, 0.0, li)");
    expect(fold4).not.toContain("innerCutoff = min(best, cutoff) / factor;");
  });

  it("threads the fr-wa6o segment through the branch transport under slabExt, and drops it entirely without", () => {
    const withExt = surfaceDeKernelWgsl(
      kernelOpts({ core: "fold4", lens: true, width: 12 }),
    );
    // u-space scaling, the boxfold branch's diag(+-1) transport, the
    // lens's linear part on the branch extent, and the segment radius in
    // place of every length.
    expect(withExt).toContain("eu = pExt * params.lens4Params.y;");
    expect(withExt).toContain("select(-eu.w, eu.w, selW == 0u),");
    expect(withExt).toContain("qExt = vec4f(");
    expect(withExt).toContain("let rq = segmentRadius4(q, qExt);");

    const withoutExt = surfaceDeKernelWgsl(
      kernelOpts({ core: "fold4", lens: true, width: 12, slabExt: false }),
    );
    expect(withoutExt).toContain("let rq = length(q);");
    expect(withoutExt).toContain("surfaceDECore(q, 0.0, li)");
    for (const marker of ["let segment", "pExt", "qExt", "preExt", "var eu"]) {
      expect(withoutExt).not.toContain(marker);
    }
  });

  it("keeps the wrapper out of the entry text — the 4D entries call surfaceDE exactly as without the lens", () => {
    for (const mode of ["eval", "march"] as const) {
      const plain = surfaceDeKernelWgsl(kernelOpts({ mode, core: "fold4" }));
      const lensed = surfaceDeKernelWgsl(
        kernelOpts({ mode, core: "fold4", lens: true }),
      );
      const entryCall =
        mode === "eval"
          ? "surfaceDE(queries[i].xyz, params.cutoff, li)"
          : "surfaceDE(ro + rd * t, eps, li)";
      expect(plain).toContain(entryCall);
      expect(lensed).toContain(entryCall);
    }
  });

  it("mode 'shade' renames the 4D hit-info behind its own argmin sweep, which hands the core the winning branch's lifted query", () => {
    for (const core of ["affine4", "fold4"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, lens: true }),
      );
      expect(wgsl.split("fn surfaceDEHitInfoCore(").length).toBe(2);
      expect(wgsl.split("fn surfaceDEHitInfo(").length).toBe(2);
      expect(wgsl).toContain(
        "fn surfaceDEHitInfoCore(qIn: vec4f, qExt: vec4f, li: u32)",
      );
      expect(wgsl).toContain("fn surfaceDEHitInfo(p: vec3f, li: u32)");
      // Shading conventions: zero-cutoff full-width core calls, one core
      // hit call on the argmin branch — the 3D wrapper's shape.
      expect(wgsl).toContain("surfaceDECore(q, qExt, 0.0, li)");
      expect(wgsl).toContain(
        "return surfaceDEHitInfoCore(bestQ, bestExt, li);",
      );
    }
    const noslab = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "fold4", lens: true, slabExt: false }),
    );
    expect(noslab).toContain("return surfaceDEHitInfoCore(bestQ, li);");
  });

  it("fold4 shade with a probe width renames the probe body and gives the taps their own 4D lens sweep", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "shade",
        core: "fold4",
        lens: true,
        width: 12,
        shadeDeWidth: 1,
      }),
    );
    expect(wgsl.split("fn surfaceDEProbeCore(").length).toBe(2);
    expect(wgsl.split("fn surfaceDEProbe(").length).toBe(2);
    expect(wgsl).toContain(
      "fn surfaceDEProbeCore(qIn: vec4f, qExt: vec4f, cutoff: f32, li: u32)",
    );
    expect(wgsl).toContain("surfaceDEProbeCore(q, qExt, 0.0, li)");
    // The probe's own frontier narrows to the probe width, the main
    // descent keeps its own — one text, three names.
    expect(wgsl).toContain("var fcQ: array<vec4f, 1>;");
    expect(wgsl).toContain("var fcQ: array<vec4f, 12>;");

    const noProbe = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "fold4", lens: true, width: 12 }),
    );
    expect(noProbe).not.toContain("surfaceDEProbe");
  });

  it("balances every brace across the lens matrix — the generated wrapper is one text per (core, mode, slabExt)", () => {
    for (const core of ["affine4", "fold4"] as const) {
      for (const mode of ["eval", "march", "shade"] as const) {
        for (const slabExt of [true, false]) {
          const wgsl = surfaceDeKernelWgsl(
            kernelOpts({ core, mode, slabExt, lens: true, width: 4 }),
          );
          expect([...wgsl.matchAll(/\}/g)].length).toBe(
            [...wgsl.matchAll(/\{/g)].length,
          );
          expect([...wgsl.matchAll(/\)/g)].length).toBe(
            [...wgsl.matchAll(/\(/g)].length,
          );
        }
      }
    }
  });

  it("still refuses a lensed ESCAPE kernel — that gate is unchanged by the 4D lift", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "escape", lens: true })),
    ).toThrow(/escape core cannot take a fold-final lens/);
  });
});

/** Two-map 4D system, the second map's w block making the system genuinely
 * 4D (not a flat 3D lift) — a minimal ELIGIBLE system for buildSurfaceDE4,
 * so the affine4 packer's byte layout is pinned against a real SurfaceDE4
 * (mirrors surface-de-4d.test.ts's map4 idiom, lifted to two maps). */
function fourDSystemTransforms(): Transform[] {
  return [
    {
      id: 0,
      position: [0.3, 0.1, -0.2],
      rotation: [0.2, 0.1, 0],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 1,
      position: [-0.25, 0.2, 0.1],
      rotation: [0, 0.3, 0.1],
      scale: [0.45, 0.45, 0.45],
      w: { position: 0.4, rotation: { xw: 0.3 } },
    },
  ];
}

/** Two-map 4D system whose BASE maps FOLD (fr-rsp6 phase 2A) — the 3D
 * foldSystemTransforms() shape with a genuine w block, and deliberately
 * non-unit boxfold weights so `foldInvW` (1/w) and `foldSigma` (|w|·sigmaMin)
 * land away from the affine defaults 1 / sigmaMin that would let a lane
 * swap hide. The routing key `deHasFolds4` sends this system to
 * `descendFold4` on the CPU and to `core: "fold4"` on the GPU. */
function fourDFoldSystemTransforms(): Transform[] {
  return [
    {
      id: 0,
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.45, 0.45, 0.45],
      variations: [{ type: "boxfold", weight: 1.25 }],
    },
    {
      id: 1,
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.5, 0.5, 0.5],
      variations: [{ type: "boxfold", weight: 0.9 }],
      w: { position: 0.4, rotation: { xw: 0.3 } },
    },
  ];
}

/** Two-map 4D system whose base maps SPHEREFOLD — the fold family whose
 * mid branch is an inversion, so `slabExact4` refuses it and a slab query
 * is unsound (surface-de-4d.ts). Mirrors that module's own
 * pureSpherefoldPair4 fixture; used here to pin the packer's slab guard. */
function fourDSpherefoldSystemTransforms(): Transform[] {
  return [
    {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.2, 0.2, 0.2],
      variations: [{ type: "spherefold", weight: 1 }],
      w: { position: 0.2, rotation: { yw: 0.2 } },
    },
    {
      id: 1,
      position: [-0.1, 0.1, -0.05],
      rotation: [0, 0, 0],
      scale: [0.22, 0.22, 0.22],
      variations: [{ type: "spherefold", weight: 0.9 }],
      w: { position: -0.2, rotation: { yw: 0.2 } },
    },
  ];
}

/** A boxfold FINAL lens over a 4D base — the fr-rsp6 phase 2B archetype,
 * mirroring surface-de-4d.test.ts's boxfoldFinal4(). The SMALL weight
 * matters: `u = p/w` reaches past the fold planes, so the non-identity
 * branches carry real geometry instead of degenerating to the affine part,
 * and boxfold is the ONE fold family a slab query survives (slabExact4). */
function fourDBoxfoldFinalTransform(): Transform {
  return {
    id: 99,
    position: [0.15, -0.1, 0.05],
    rotation: [0.2, 0.3, 0.1],
    scale: [0.9, 0.9, 0.9],
    variations: [{ type: "boxfold", weight: 0.55 }],
    w: { position: 0.1, rotation: { yw: 0.2 } },
  };
}

/** Plain affine 4D final transform (no variations, w block included) —
 * gives SurfaceDE4.final a real, non-identity lens to round-trip the
 * packer's final4M/final4T/final4SigmaMin offsets against, the 4D
 * counterpart of affineFinalTransform() above. */
function fourDFinalTransform(): Transform {
  return {
    id: 99,
    position: [0.2, -0.1, 0.15],
    rotation: [0.3, -0.2, 0.1],
    scale: [0.7, 0.7, 0.7],
    w: { position: -0.2, rotation: { yw: 0.2 } },
  };
}

/** Default SurfaceGpu4View, overridable per test — mirrors kernelOpts()'s
 * convention. Identity rotor, zero-thickness slice (the shipped default,
 * point-query value for value). */
function view4(overrides: Partial<SurfaceGpu4View> = {}): SurfaceGpu4View {
  return {
    rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    w0: 0,
    sliceHalfW: 0,
    ...overrides,
  };
}

describe("packSurface4GpuParams (fr-dlxh 4D)", () => {
  it("returns an ArrayBuffer of exactly SURFACE_GPU_PARAMS4_BYTES — the frozen 0..207 block plus the 4D variant tail (464 bytes, per the module doc)", () => {
    expect(SURFACE_GPU_PARAMS4_BYTES).toBe(464);
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const buf = packSurface4GpuParams(de, view4(), { itemCount: 5 });
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS4_BYTES);
  });

  it("packs the origin as boundCenter, and boundingRadius/escapeRadius/stepScale/mapCount/maxDepth straight from the built DE", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    // boundCenter packs the origin — the 4D oracle is origin-anchored by
    // construction (surface-de-4d.ts carries no boundCenter field of its
    // own to round-trip here, unlike 3D's SurfaceDE).
    expect(view.getFloat32(0, true)).toBe(0);
    expect(view.getFloat32(4, true)).toBe(0);
    expect(view.getFloat32(8, true)).toBe(0);
    expect(view.getFloat32(12, true)).toBe(Math.fround(de.boundingRadius));
    expect(view.getFloat32(16, true)).toBe(Math.fround(de.escapeRadius));
    expect(view.getFloat32(20, true)).toBe(Math.fround(de.stepScale));
    expect(view.getUint32(48, true)).toBe(de.maps.length);
    expect(view.getUint32(52, true)).toBe(de.maxDepth);
  });

  it("packs slowestSigma/stepCos/stepSin/symPlane as the benign never-read constants 1/1/0/1 — this core has no footprint cap or (cos, sin) sector step", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    expect(view.getFloat32(28, true)).toBe(1); // slowestSigma
    expect(view.getFloat32(32, true)).toBe(1); // stepCos
    expect(view.getFloat32(36, true)).toBe(0); // stepSin
    expect(view.getUint32(44, true)).toBe(1); // symPlane
  });

  it("packs symOrder at offset 40 from de.symmetry.order", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms(), null, {
      order: 3,
      plane: "xz",
      twist: 1,
    });
    expect(de.symmetry.order).toBe(3);
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    expect(view.getUint32(40, true)).toBe(3);
  });

  it("packs maxDepth at offset 52 as de.maxDepth by default, overridden by run.maxDepth (the preview clamp door)", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const def = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    expect(def.getUint32(52, true)).toBe(de.maxDepth);

    const clamped = new DataView(
      packSurface4GpuParams(de, view4(), {
        itemCount: 1,
        maxDepth: de.maxDepth + 5,
      }),
    );
    expect(clamped.getUint32(52, true)).toBe(de.maxDepth + 5);
  });

  it("round-trips the run params' itemCount/stepsThisPass/cutoff/marchSteps at their documented offsets, leaving footprint (68) at its unwritten 0", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const view = new DataView(
      packSurface4GpuParams(de, view4(), {
        itemCount: 321,
        stepsThisPass: 9,
        cutoff: 0.04,
        marchSteps: 96,
      }),
    );
    expect(view.getUint32(56, true)).toBe(321);
    expect(view.getUint32(60, true)).toBe(9);
    expect(view.getFloat32(64, true)).toBe(Math.fround(0.04));
    expect(view.getUint32(72, true)).toBe(96);
    expect(view.getFloat32(68, true)).toBe(0);
  });

  // fr-5h5d: the 4D cores share the frozen block's offset-204 fogDensity
  // slot (former pad1) — packSurface4GpuParams never wrote it before
  // this, leaving it at the ArrayBuffer's zero default.
  it("defaults offset 204 (fogDensity, former pad1) to 1 when run.fogDensity is omitted", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    expect(view.getFloat32(204, true)).toBe(1);
  });

  it("round-trips a non-default run.fogDensity at offset 204", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1, fogDensity: 0.35 }),
    );
    expect(view.getFloat32(204, true)).toBe(Math.fround(0.35));
  });

  it("packs hitFloorEps at offset 80 as fround(boundingRadius * SURFACE_GPU_HIT_FLOOR) by default, and fround(boundingRadius * run.hitFloor) when given", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const def = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    expect(def.getFloat32(80, true)).toBe(
      Math.fround(de.boundingRadius * SURFACE_GPU_HIT_FLOOR),
    );
    const overridden = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1, hitFloor: 0.02 }),
    );
    expect(overridden.getFloat32(80, true)).toBe(
      Math.fround(de.boundingRadius * 0.02),
    );
  });

  it("packs the 3D-frozen finalM rows as identity, finalT as zero and finalSigmaMin as 1 — the 4D lens rides the variant tail alone", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    expect(view.getFloat32(96, true)).toBe(1);
    expect(view.getFloat32(100, true)).toBe(0);
    expect(view.getFloat32(104, true)).toBe(0);
    expect(view.getFloat32(108, true)).toBe(0);
    expect(view.getFloat32(112, true)).toBe(0);
    expect(view.getFloat32(116, true)).toBe(1);
    expect(view.getFloat32(120, true)).toBe(0);
    expect(view.getFloat32(124, true)).toBe(0);
    expect(view.getFloat32(128, true)).toBe(0);
    expect(view.getFloat32(132, true)).toBe(0);
    expect(view.getFloat32(136, true)).toBe(1);
    expect(view.getFloat32(140, true)).toBe(0);
    expect(view.getFloat32(156, true)).toBe(1); // finalSigmaMin
  });

  it("packs pose ro/right/up/fwd/tanHalf/aspect/pixelEps/raster at their documented offsets, and the documented defaults when no pose is given", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const pose: SurfaceGpuPose = {
      ro: [1.1, 2.2, 3.3],
      right: [1, 0, 0],
      up: [0, 1, 0],
      fwd: [0, 0, -1],
      tanHalf: 0.5773,
      aspect: 1.7778,
      rasterWidth: 640,
      rasterHeight: 360,
      pixelEps: 0.0007,
    };
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1, pose }),
    );
    expect(view.getFloat32(76, true)).toBe(Math.fround(pose.pixelEps));
    expect(view.getUint32(84, true)).toBe(pose.rasterWidth);
    expect(view.getUint32(88, true)).toBe(pose.rasterHeight);
    expect(view.getFloat32(144, true)).toBe(Math.fround(pose.ro[0]));
    expect(view.getFloat32(148, true)).toBe(Math.fround(pose.ro[1]));
    expect(view.getFloat32(152, true)).toBe(Math.fround(pose.ro[2]));
    expect(view.getFloat32(160, true)).toBe(Math.fround(pose.right[0]));
    expect(view.getFloat32(164, true)).toBe(Math.fround(pose.right[1]));
    expect(view.getFloat32(168, true)).toBe(Math.fround(pose.right[2]));
    expect(view.getFloat32(172, true)).toBe(Math.fround(pose.tanHalf));
    expect(view.getFloat32(176, true)).toBe(Math.fround(pose.up[0]));
    expect(view.getFloat32(180, true)).toBe(Math.fround(pose.up[1]));
    expect(view.getFloat32(184, true)).toBe(Math.fround(pose.up[2]));
    expect(view.getFloat32(188, true)).toBe(Math.fround(pose.aspect));
    expect(view.getFloat32(192, true)).toBe(Math.fround(pose.fwd[0]));
    expect(view.getFloat32(196, true)).toBe(Math.fround(pose.fwd[1]));
    expect(view.getFloat32(200, true)).toBe(Math.fround(pose.fwd[2]));

    const noPose = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    expect(noPose.getFloat32(76, true)).toBe(0);
    expect(noPose.getUint32(84, true)).toBe(0);
    expect(noPose.getUint32(88, true)).toBe(0);
    expect(noPose.getFloat32(144, true)).toBe(0);
    expect(noPose.getFloat32(148, true)).toBe(0);
    expect(noPose.getFloat32(152, true)).toBe(0);
    expect(noPose.getFloat32(160, true)).toBe(1);
    expect(noPose.getFloat32(164, true)).toBe(0);
    expect(noPose.getFloat32(168, true)).toBe(0);
    expect(noPose.getFloat32(172, true)).toBe(0);
    expect(noPose.getFloat32(176, true)).toBe(0);
    expect(noPose.getFloat32(180, true)).toBe(1);
    expect(noPose.getFloat32(184, true)).toBe(0);
    expect(noPose.getFloat32(188, true)).toBe(1);
    expect(noPose.getFloat32(192, true)).toBe(0);
    expect(noPose.getFloat32(196, true)).toBe(0);
    expect(noPose.getFloat32(200, true)).toBe(1);
  });

  it("packs visibleRadius at offset 24 as the slice-adjusted sliceVisR: sqrt(visR² − minW²) with minW = max(|w0| − sliceHalfW, 0), clamped to 0", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const visR = de.visibleBoundingRadius;
    const cases: [number, number][] = [
      [0, 0], // zero-thickness point query at w0 0: minW 0, full visR.
      [visR * 0.5, 0], // w0 partway out, zero thickness.
      [visR * 0.3, visR * 0.5], // sliceHalfW re-covers a w0 outside it.
      [visR * 1.5, 0], // w0 beyond the visible ball entirely: 0.
    ];
    for (const [w0, sliceHalfW] of cases) {
      const minW = Math.max(Math.abs(w0) - sliceHalfW, 0);
      const expected = Math.fround(
        Math.sqrt(Math.max(visR * visR - minW * minW, 0)),
      );
      const view = new DataView(
        packSurface4GpuParams(de, view4({ w0, sliceHalfW }), {
          itemCount: 1,
        }),
      );
      expect(view.getFloat32(24, true)).toBe(expected);
    }
  });

  it("packs the rotorInv tail as the TRANSPOSE of the input rotor: row i holds column i of the packed 4x4", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    // Sixteen distinct values so a row/column mixup cannot hide behind a
    // repeated entry.
    const rotor = Array.from({ length: 16 }, (_, i) => i + 1);
    const view = new DataView(
      packSurface4GpuParams(de, view4({ rotor }), { itemCount: 1 }),
    );
    for (let i = 0; i < 4; i++) {
      const at = 208 + i * 16;
      expect(view.getFloat32(at, true)).toBe(rotor[i]);
      expect(view.getFloat32(at + 4, true)).toBe(rotor[4 + i]);
      expect(view.getFloat32(at + 8, true)).toBe(rotor[8 + i]);
      expect(view.getFloat32(at + 12, true)).toBe(rotor[12 + i]);
    }
  });

  it("packs stepBack4 sequentially from de.symmetry.stepBack under a real kaleidoscope (order 3, plane xz, twist 1)", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms(), null, {
      order: 3,
      plane: "xz",
      twist: 1,
    });
    // A twisted kaleidoscope's backward step has no repeated axis block
    // (order 1's stepBack is ~identity), so a transposed or reordered
    // write cannot hide behind a symmetric matrix here.
    expect(de.symmetry.order).toBe(3);
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    for (let i = 0; i < 16; i++) {
      expect(view.getFloat32(272 + i * 4, true)).toBe(
        Math.fround(de.symmetry.stepBack[i]),
      );
    }
  });

  it("packs final4M as the identity, final4T as zero and final4SigmaMin as 1 when the DE has no final transform", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    expect(de.final).toBeNull();
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        expect(view.getFloat32(336 + (r * 4 + c) * 4, true)).toBe(
          r === c ? 1 : 0,
        );
      }
    }
    expect(view.getFloat32(400, true)).toBe(0);
    expect(view.getFloat32(404, true)).toBe(0);
    expect(view.getFloat32(408, true)).toBe(0);
    expect(view.getFloat32(412, true)).toBe(0);
    expect(view.getFloat32(424, true)).toBe(1); // final4SigmaMin
  });

  it("round-trips a real final transform's invM rows / invT / sigmaMin at the documented 336..431 offsets", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms(), fourDFinalTransform());
    if (!de.final) throw new Error("expected a 4D final lens");
    const f = de.final;
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    for (let i = 0; i < 16; i++) {
      expect(view.getFloat32(336 + i * 4, true)).toBe(Math.fround(f.invM[i]));
    }
    expect(view.getFloat32(400, true)).toBe(Math.fround(f.invT[0]));
    expect(view.getFloat32(404, true)).toBe(Math.fround(f.invT[1]));
    expect(view.getFloat32(408, true)).toBe(Math.fround(f.invT[2]));
    expect(view.getFloat32(412, true)).toBe(Math.fround(f.invT[3]));
    expect(view.getFloat32(424, true)).toBe(Math.fround(f.sigmaMin));
  });

  it("packs w0 and sliceHalfW verbatim at offsets 416 and 420", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const view = new DataView(
      packSurface4GpuParams(de, view4({ w0: 0.37, sliceHalfW: 0.08 }), {
        itemCount: 1,
      }),
    );
    expect(view.getFloat32(416, true)).toBe(Math.fround(0.37));
    expect(view.getFloat32(420, true)).toBe(Math.fround(0.08));
  });

  it("packs the FULL 4D visible radius at offset 428 (visRadius4) even while the frozen visibleRadius slot carries the slice-adjusted gate", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const view = new DataView(
      packSurface4GpuParams(de, view4({ w0: 0.3 * de.boundingRadius }), {
        itemCount: 1,
      }),
    );
    // The two radii deliberately diverge whenever |w0| > 0: 24 holds the
    // slice's shadow (the march gate), 428 the slice-INVARIANT color
    // normalizer.
    expect(view.getFloat32(428, true)).toBe(
      Math.fround(de.visibleBoundingRadius),
    );
    expect(view.getFloat32(24, true)).toBeLessThan(de.visibleBoundingRadius);
  });

  it("throws when a footprint is requested — the 4D oracle takes no cone-footprint depth cap", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    expect(() =>
      packSurface4GpuParams(de, view4(), { itemCount: 1, footprint: 0.1 }),
    ).toThrow(/footprint/);
    expect(() =>
      packSurface4GpuParams(de, view4(), { itemCount: 1, footprint: 0 }),
    ).not.toThrow();
  });
});

describe("packSurface4GpuParams fold-final lens block (fr-rsp6 phase 2B)", () => {
  it("keeps the 464-byte buffer without a foldFinal and grows to SURFACE_GPU_PARAMS4_LENS_BYTES with one", () => {
    expect(SURFACE_GPU_PARAMS4_LENS_BYTES).toBe(560);
    const plain = buildSurfaceDE4(fourDSystemTransforms());
    expect(plain.foldFinal).toBeNull();
    expect(
      packSurface4GpuParams(plain, view4(), { itemCount: 1 }).byteLength,
    ).toBe(SURFACE_GPU_PARAMS4_BYTES);

    const lensed = buildSurfaceDE4(
      fourDSystemTransforms(),
      fourDBoxfoldFinalTransform(),
    );
    expect(lensed.foldFinal).not.toBeNull();
    expect(
      packSurface4GpuParams(lensed, view4(), { itemCount: 1 }).byteLength,
    ).toBe(SURFACE_GPU_PARAMS4_LENS_BYTES);
  });

  it("leaves the frozen 0..463 block byte-identical to the no-lens packing of the same base system", () => {
    // The lens block is APPENDED: a 4D kernel without the lens declares a
    // struct that ends at 464 and never reads past it, so nothing before
    // that offset may move.
    const base = fourDSystemTransforms();
    const plain = packSurface4GpuParams(buildSurfaceDE4(base), view4(), {
      itemCount: 7,
    });
    const lensed = packSurface4GpuParams(
      buildSurfaceDE4(base, fourDBoxfoldFinalTransform()),
      view4(),
      { itemCount: 7 },
    );
    const a = new DataView(plain);
    const b = new DataView(lensed);
    for (let off = 0; off < SURFACE_GPU_PARAMS4_BYTES; off += 4) {
      // Only the two radii and the radius-ramp band (432..455)
      // legitimately differ (a fold final changes the VISIBLE set), so
      // compare the layout everywhere else.
      if (off === 24 || off === 428 || (off >= 432 && off < 456)) continue;
      expect(b.getUint32(off, true)).toBe(a.getUint32(off, true));
    }
  });

  it("round-trips the built lens's invM rows / invT / lens4Params at the documented 464..559 offsets", () => {
    const de = buildSurfaceDE4(
      fourDSystemTransforms(),
      fourDBoxfoldFinalTransform(),
    );
    const lens = de.foldFinal;
    if (!lens) throw new Error("expected a 4D foldFinal lens");
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    // Row-major bytes of the matrix the body applies (dot(rowN, v)) —
    // the file's standing 4D convention, same as final4M/stepBack4.
    for (let i = 0; i < 16; i++) {
      expect(view.getFloat32(464 + i * 4, true)).toBe(
        Math.fround(lens.invM[i]),
      );
    }
    expect(view.getFloat32(528, true)).toBe(Math.fround(lens.invT[0]));
    expect(view.getFloat32(532, true)).toBe(Math.fround(lens.invT[1]));
    expect(view.getFloat32(536, true)).toBe(Math.fround(lens.invT[2]));
    expect(view.getFloat32(540, true)).toBe(Math.fround(lens.invT[3]));
    // lens4Params — (foldKind, invW, absW, sigmaMin), the GLSL
    // uLensParams order the wrapper reads.
    expect(view.getFloat32(544, true)).toBe(SURFACE_FOLD_BOXFOLD);
    expect(view.getFloat32(548, true)).toBe(Math.fround(lens.invW));
    expect(view.getFloat32(552, true)).toBe(Math.fround(lens.absW));
    expect(view.getFloat32(556, true)).toBe(Math.fround(lens.sigmaMin));
    // A real lens, not a degenerate one: weight 0.55 gives invW ~1.82.
    expect(lens.absW).toBeCloseTo(0.55, 12);
  });

  it("round-trips SurfaceDE4.radiusBand at 432..455 — center, minD, the shared radiusBandInvRange, zero spares (fr-skhv)", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    const band = de.radiusBand;
    expect(view.getFloat32(432, true)).toBe(Math.fround(band.center[0]));
    expect(view.getFloat32(436, true)).toBe(Math.fround(band.center[1]));
    expect(view.getFloat32(440, true)).toBe(Math.fround(band.center[2]));
    expect(view.getFloat32(444, true)).toBe(Math.fround(band.center[3]));
    expect(view.getFloat32(448, true)).toBe(Math.fround(band.minD));
    expect(view.getFloat32(452, true)).toBe(
      Math.fround(radiusBandInvRange(band)),
    );
    expect(view.getFloat32(456, true)).toBe(0);
    expect(view.getFloat32(460, true)).toBe(0);
    // A real band, not a degenerate one: the probe spans a genuine
    // radial range around a finite center.
    expect(band.minD).toBeGreaterThanOrEqual(0);
    expect(band.maxD).toBeGreaterThan(band.minD);
  });

  it("packs the cores' OWN final rows as identity/zero/1 under a foldFinal — the wrapper alone applies the lens", () => {
    const de = buildSurfaceDE4(
      fourDSystemTransforms(),
      fourDBoxfoldFinalTransform(),
    );
    // buildSurfaceDE4 keeps the two exclusive, which is what lets the
    // cores run their no-lens arithmetic verbatim under the wrapper.
    expect(de.final).toBeNull();
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        expect(view.getFloat32(336 + (r * 4 + c) * 4, true)).toBe(
          r === c ? 1 : 0,
        );
      }
    }
    expect(view.getFloat32(400, true)).toBe(0);
    expect(view.getFloat32(404, true)).toBe(0);
    expect(view.getFloat32(408, true)).toBe(0);
    expect(view.getFloat32(412, true)).toBe(0);
    expect(view.getFloat32(424, true)).toBe(1);
  });

  it("refuses a slab query for a system slabExact4 rejects, and allows one for a boxfold-only system", () => {
    // A spherefold branch takes a segment to an ARC, so the segment
    // certificate is unsound (not merely loose) — the CPU entries throw
    // and the app clamps sliceHalfW; this is the kernel-side belt.
    const spherefold = buildSurfaceDE4(fourDSpherefoldSystemTransforms());
    expect(() =>
      packSurface4GpuParams(spherefold, view4({ sliceHalfW: 0.05 }), {
        itemCount: 1,
      }),
    ).toThrow(/slabExact4/);
    // Zero thickness is the point query, admissible for any system.
    expect(() =>
      packSurface4GpuParams(spherefold, view4({ sliceHalfW: 0 }), {
        itemCount: 1,
      }),
    ).not.toThrow();

    const boxfoldBase = buildSurfaceDE4(fourDFoldSystemTransforms());
    expect(() =>
      packSurface4GpuParams(boxfoldBase, view4({ sliceHalfW: 0.05 }), {
        itemCount: 1,
      }),
    ).not.toThrow();
    const boxfoldLens = buildSurfaceDE4(
      fourDSystemTransforms(),
      fourDBoxfoldFinalTransform(),
    );
    expect(() =>
      packSurface4GpuParams(boxfoldLens, view4({ sliceHalfW: 0.05 }), {
        itemCount: 1,
      }),
    ).not.toThrow();
  });
});

describe("packSurfaceGpuMaps4 (fr-dlxh 4D; fr-rsp6 phase 2A lanes)", () => {
  it("packs each map's invM rows / invT / p0 fold lanes / bnb / p1 at the documented word offsets, per SURFACE_GPU_MAP4_VEC4 stride", () => {
    // Grown 6 -> 8 by fr-rsp6 phase 2A: ONE layout for both 4D cores,
    // exactly as the 3D GpuMap carries fold lanes the affine core never
    // reads.
    expect(SURFACE_GPU_MAP4_VEC4).toBe(8);
    const de = buildSurfaceDE4(fourDFoldSystemTransforms());
    const out = packSurfaceGpuMaps4(de);
    const stride = SURFACE_GPU_MAP4_VEC4 * 4;
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(de.maps.length * stride);
    // The fixture is a real FOLD system, so the p0 lanes carry live
    // values rather than the affine defaults pinned below.
    expect(de.maps.some((m) => m.foldKind === SURFACE_FOLD_BOXFOLD)).toBe(true);

    de.maps.forEach((m, j) => {
      const base = j * stride;
      // r0..r3 = invM rows 0..3, row-major, 16 floats sequential.
      for (let i = 0; i < 16; i++) {
        expect(out[base + i]).toBe(Math.fround(m.invM[i]));
      }
      // t = invT.
      expect(out[base + 16]).toBe(Math.fround(m.invT[0]));
      expect(out[base + 17]).toBe(Math.fround(m.invT[1]));
      expect(out[base + 18]).toBe(Math.fround(m.invT[2]));
      expect(out[base + 19]).toBe(Math.fround(m.invT[3]));
      // p0 = sigmaMin, foldInvW, foldSigma, foldKind — the 3D lane order.
      expect(out[base + 20]).toBe(Math.fround(m.sigmaMin));
      expect(out[base + 21]).toBe(Math.fround(m.foldInvW));
      expect(out[base + 22]).toBe(Math.fround(m.foldSigma));
      expect(out[base + 23]).toBe(m.foldKind);
      // bnb = the whole bnbDir (4D fills the lane 3D squeezes invTNorm
      // into).
      expect(out[base + 24]).toBe(Math.fround(m.bnbDir[0]));
      expect(out[base + 25]).toBe(Math.fround(m.bnbDir[1]));
      expect(out[base + 26]).toBe(Math.fround(m.bnbDir[2]));
      expect(out[base + 27]).toBe(Math.fround(m.bnbDir[3]));
      // p1 = invTNorm, invMSigmaMin, 0, 0.
      expect(out[base + 28]).toBe(Math.fround(m.invTNorm));
      expect(out[base + 29]).toBe(Math.fround(m.invMSigmaMin));
      expect(out[base + 30]).toBe(0);
      expect(out[base + 31]).toBe(0);
    });
  });

  it("packs an AFFINE 4D system's fold lanes as the inert defaults the affine4 core never reads: kind 0, invW 1, foldSigma = sigmaMin", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const out = packSurfaceGpuMaps4(de);
    const stride = SURFACE_GPU_MAP4_VEC4 * 4;
    de.maps.forEach((m, j) => {
      const base = j * stride;
      expect(out[base + 21]).toBe(1);
      expect(out[base + 22]).toBe(Math.fround(m.sigmaMin));
      expect(out[base + 23]).toBe(0);
    });
  });

  it("returns one stride worth of zeros when the DE has no active maps", () => {
    const zeroMapDe: SurfaceDE4 = {
      ...buildSurfaceDE4(fourDSystemTransforms()),
      maps: [],
    };
    const out = packSurfaceGpuMaps4(zeroMapDe);
    const stride = SURFACE_GPU_MAP4_VEC4 * 4;
    expect(out.length).toBe(stride);
    expect(Array.from(out)).toEqual(new Array(stride).fill(0));
  });
});

/** The textbook Mandelbulb map — a lone pure triplex power at the
 * identity affine part, which is what `analyzeBulbSystem` admits and what
 * a preset would ship. */
function canonicalBulb(): Transform {
  return {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "bulb", weight: 1 }],
  };
}

/** The same map uniformly SCALED (and rotated, and offset), so
 * `sigmaMax` is 1.3 rather than 1 and the two variant-block scalars are
 * distinguishable from each other and from a dropped term. An
 * identity-or-rotation fixture cannot see either of the estimator's
 * `sigma_max(M)` terms — dropping them there is a bit-exact no-op, the
 * mutation fr-7u8t.4 shipped undetected one object over. */
function scaledBulb(): Transform {
  return {
    id: 0,
    position: [0.12, -0.05, 0.08],
    rotation: [0.3, 0.2, -0.1],
    scale: [1.3, 1.3, 1.3],
    variations: [{ type: "bulb", weight: 1 }],
  };
}

describe("packBulbGpuParams (fr-7u8t.9)", () => {
  it("returns an ArrayBuffer of exactly SURFACE_GPU_PARAMS_BYTES, the same struct size every other 3D packer uses", () => {
    const de = buildBulbDE([canonicalBulb()]);
    const buf = packBulbGpuParams(de, { itemCount: 1 });
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_BYTES);
  });

  it("packs the frozen scalar offsets: zero boundCenter, the QUERY-space marching ball as bounding/visible radius, the dead 2R escapeRadius, BULB_STEP_SCALE, and symmetry pinned off", () => {
    const de = buildBulbDE([canonicalBulb()]);
    const view = new DataView(packBulbGpuParams(de, { itemCount: 1 }));

    expect(view.getFloat32(0, true)).toBe(0);
    expect(view.getFloat32(4, true)).toBe(0);
    expect(view.getFloat32(8, true)).toBe(0);
    expect(view.getFloat32(12, true)).toBe(Math.fround(de.boundingRadius));
    expect(view.getFloat32(16, true)).toBe(Math.fround(de.boundingRadius * 2));
    expect(view.getFloat32(20, true)).toBe(Math.fround(BULB_STEP_SCALE));
    expect(view.getFloat32(24, true)).toBe(Math.fround(de.boundingRadius));
    expect(view.getFloat32(28, true)).toBe(1); // slowestSigma
    expect(view.getFloat32(32, true)).toBe(1); // stepCos
    expect(view.getFloat32(36, true)).toBe(0); // stepSin
    expect(view.getUint32(40, true)).toBe(1); // symOrder
    expect(view.getUint32(44, true)).toBe(1); // symPlane
    expect(view.getUint32(48, true)).toBe(1); // mapCount

    // The ONE place this wire differs from the escape packer's: there the
    // orbit's bailout ball WAS the marching ball, here the two are
    // different numbers and only the marching one may reach offset 12.
    expect(de.bailout).toBeGreaterThan(de.boundingRadius * 2);
    expect(view.getFloat32(12, true)).not.toBe(Math.fround(de.bailout));
  });

  it("packs maxDepth at offset 52 as BULB_ITERATIONS by default, overridden by run.maxDepth (the preview clamp door)", () => {
    const de = buildBulbDE([canonicalBulb()]);
    const def = new DataView(packBulbGpuParams(de, { itemCount: 1 }));
    expect(def.getUint32(52, true)).toBe(BULB_ITERATIONS);

    const clamped = new DataView(
      packBulbGpuParams(de, { itemCount: 1, maxDepth: 8 }),
    );
    expect(clamped.getUint32(52, true)).toBe(8);
  });

  it("defaults offset 204 (fogDensity) to 1 and round-trips a non-default", () => {
    const de = buildBulbDE([canonicalBulb()]);
    expect(
      new DataView(packBulbGpuParams(de, { itemCount: 1 })).getFloat32(
        204,
        true,
      ),
    ).toBe(1);
    expect(
      new DataView(
        packBulbGpuParams(de, { itemCount: 1, fogDensity: 0.35 }),
      ).getFloat32(204, true),
    ).toBe(Math.fround(0.35));
  });

  it("packs footprint at offset 68 as 0 even when run.footprint is passed — a forward loop has no cone-footprint depth cap", () => {
    const de = buildBulbDE([canonicalBulb()]);
    expect(
      new DataView(
        packBulbGpuParams(de, { itemCount: 1, footprint: 0.5 }),
      ).getFloat32(68, true),
    ).toBe(0);
  });

  it("packs hitFloorEps at offset 80 off the marching radius, default and overridden", () => {
    const de = buildBulbDE([canonicalBulb()]);
    expect(
      new DataView(packBulbGpuParams(de, { itemCount: 1 })).getFloat32(
        80,
        true,
      ),
    ).toBe(Math.fround(de.boundingRadius * SURFACE_GPU_HIT_FLOOR));
    expect(
      new DataView(
        packBulbGpuParams(de, { itemCount: 1, hitFloor: 0.03 }),
      ).getFloat32(80, true),
    ).toBe(Math.fround(de.boundingRadius * 0.03));
  });

  it("packs the final transform as identity/1 at 96..156 — the bulb gate refuses final transforms, so nothing is ever eligible to fill it", () => {
    const de = buildBulbDE([canonicalBulb()]);
    const view = new DataView(packBulbGpuParams(de, { itemCount: 1 }));
    expect(view.getFloat32(96, true)).toBe(1);
    expect(view.getFloat32(100, true)).toBe(0);
    expect(view.getFloat32(104, true)).toBe(0);
    expect(view.getFloat32(108, true)).toBe(0);
    expect(view.getFloat32(112, true)).toBe(0);
    expect(view.getFloat32(116, true)).toBe(1);
    expect(view.getFloat32(120, true)).toBe(0);
    expect(view.getFloat32(124, true)).toBe(0);
    expect(view.getFloat32(128, true)).toBe(0);
    expect(view.getFloat32(132, true)).toBe(0);
    expect(view.getFloat32(136, true)).toBe(1);
    expect(view.getFloat32(140, true)).toBe(0);
    expect(view.getFloat32(156, true)).toBe(1);
  });

  it("packs the forward map's m rows / t / bulbParams at the documented 208..271 offsets, a SCALED map keeping sigmaMax distinguishable from 1", () => {
    const de = buildBulbDE([scaledBulb()]);
    // Sanity pin on the fixture (bulb-de.test.ts owns buildBulbDE's own
    // correctness): sigmaMax must differ from 1 AND from the bailout, or
    // this test could not catch a dropped term or a 256/260 swap.
    expect(de.sigmaMax).toBeCloseTo(1.3, 12);
    expect(de.bailout).not.toBeCloseTo(de.sigmaMax, 6);

    const view = new DataView(packBulbGpuParams(de, { itemCount: 1 }));
    expect(view.getFloat32(208, true)).toBe(Math.fround(de.m[0]));
    expect(view.getFloat32(212, true)).toBe(Math.fround(de.m[1]));
    expect(view.getFloat32(216, true)).toBe(Math.fround(de.m[2]));
    expect(view.getFloat32(220, true)).toBe(Math.fround(de.t[0]));
    expect(view.getFloat32(224, true)).toBe(Math.fround(de.m[3]));
    expect(view.getFloat32(228, true)).toBe(Math.fround(de.m[4]));
    expect(view.getFloat32(232, true)).toBe(Math.fround(de.m[5]));
    expect(view.getFloat32(236, true)).toBe(Math.fround(de.t[1]));
    expect(view.getFloat32(240, true)).toBe(Math.fround(de.m[6]));
    expect(view.getFloat32(244, true)).toBe(Math.fround(de.m[7]));
    expect(view.getFloat32(248, true)).toBe(Math.fround(de.m[8]));
    expect(view.getFloat32(252, true)).toBe(Math.fround(de.t[2]));
    expect(view.getFloat32(256, true)).toBe(Math.fround(de.sigmaMax));
    expect(view.getFloat32(260, true)).toBe(Math.fround(de.bailout));
    expect(view.getFloat32(264, true)).toBe(0); // packed-zero spare
    expect(view.getFloat32(268, true)).toBe(0); // packed-zero spare
  });

  it("appends the ground-plane block past the bulb variant block, and omitting it returns the 272-byte buffer byte for byte", () => {
    const de = buildBulbDE([scaledBulb()]);
    const gp: SurfaceGpuGroundPlane = {
      y: 0.125,
      fadeStart: 1.5,
      fadeEnd: 4.5,
      ballCenter: [0.25, -0.5, 0.75],
      ballRadius: 1.25,
      albedo: [0.375, 0.625, 0.875],
    };
    const plain = new Uint8Array(packBulbGpuParams(de, { itemCount: 2 }));
    const buf = packBulbGpuParams(de, { itemCount: 2 }, gp);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_PLANE_BYTES);
    expect(new Uint8Array(buf, 0, SURFACE_GPU_PARAMS_BYTES)).toEqual(plain);
    const view = new DataView(buf);
    expect(view.getFloat32(256, true)).toBe(Math.fround(de.sigmaMax));
    expect(view.getFloat32(260, true)).toBe(Math.fround(de.bailout));
    expect(view.getFloat32(272, true)).toBe(Math.fround(gp.y));
    expect(view.getFloat32(284, true)).toBe(Math.fround(gp.ballRadius));
    expect(view.getFloat32(304, true)).toBe(Math.fround(gp.albedo[0]));

    expect(
      new Uint8Array(packBulbGpuParams(de, { itemCount: 2 }, null)),
    ).toEqual(plain);
  });
});

describe("surfaceDeKernelWgsl bulb core (core, fr-7u8t.9)", () => {
  it("throws when combined with a fold-final lens or the balloon — the bulb gate refuses finals, and the solid's interior reaches the ball center", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "bulb", lens: true })),
    ).toThrow(/bulb core cannot take a fold-final lens/);
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "bulb", balloon: true })),
    ).toThrow(/balloon\+bulb/);
  });

  it("still validates width and workgroupSize, even though the forward loop ignores both", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "bulb", width: 0 })),
    ).toThrow();
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "bulb", workgroupSize: 0 })),
    ).toThrow();
  });

  it("mode 'eval' emits the forward power loop once, declares the bulb* uniform fields, and carries none of the descent or escape-fold markers", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "bulb" }),
    );
    expect(wgsl).toContain("fn evalQueries");
    expect(
      wgsl.split("fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32)").length,
    ).toBe(2);
    expect(wgsl.split("fn bulbPow8(").length).toBe(2);
    expect(wgsl).toContain("bulbM0: vec3f");
    expect(wgsl).toContain("bulbT0: f32");
    expect(wgsl).toContain("bulbParams: vec4f");
    for (const marker of [
      "@binding(1)",
      "struct GpuMap",
      "mapApply",
      "stepSector",
      "frontierIx",
      "fcX",
      "refinedCert",
      "surfaceDECore",
      "escParams",
    ]) {
      expect(wgsl).not.toContain(marker);
    }
  });

  it("carries the three terms an identity-map fixture cannot see: the sigma seed, the sigma floor, and the ln|y| clamp", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "bulb" }),
    );
    // dr seeds at sigma_max(M), not 1 — dy0/dp IS M.
    expect(wgsl).toContain("var dr = sigma;");
    // ...and the trailing + sigma is escape-de.ts's + 1 through M, which
    // also floors dr (8|y|^7 shrinks wherever |y| < 1).
    expect(wgsl).toContain(
      "dr = 8.0 * (r2 * r2 * r2 * r) * sigma * dr + sigma;",
    );
    // The estimate reads |y| — the PRE-power vector — through the Boettcher
    // log form, clamped below 1 so a converging orbit never marches the
    // tracer backwards.
    expect(wgsl).toContain("return 0.5 * r * log(r) / dr;");
    expect(wgsl).toContain("if (r <= 1.0) {");
  });

  it("mode 'march' keeps the same absence set, and rays 'unproject' composes normally with ShadeParams at binding 4", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "bulb" }),
    );
    expect(wgsl).toContain("fn marchRays");
    for (const marker of [
      "@binding(1)",
      "struct GpuMap",
      "mapApply",
      "frontierIx",
      "refinedCert",
      "surfaceDECore",
    ]) {
      expect(wgsl).not.toContain(marker);
    }

    const unprojected = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "bulb", rays: "unproject" }),
    );
    expect(unprojected).toContain("shade.invProjView");
    expect(unprojected).toContain(
      "@group(0) @binding(4) var<uniform> shade: ShadeParams;",
    );
  });

  it("mode 'shade' emits the bulb hit-info once, with the POWER map's continuous escape count as trap, over the full shading interface", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "bulb" }),
    );
    expect(wgsl).toContain("fn shadeRays");
    expect(wgsl.split("fn surfaceDEHitInfo(").length).toBe(2);
    // The power map's smooth iteration count, NOT the fold arm's
    // constant-factor log(r/R)/log(growth): r is raised to the power each
    // step, so the fraction is log(log r / log R)/log n.
    expect(wgsl).toContain(
      "escFrac = clamp(log(log(r) / log(bail)) / log(8.0), 0.0, 1.0);",
    );
    expect(wgsl).toContain("(f32(escapedAt) - escFrac) / f32(params.maxDepth)");
    // One bulbPow8, shared by the value body and the hit-info body.
    expect(wgsl.split("fn bulbPow8(").length).toBe(2);
    expect(wgsl).toContain(
      "@group(0) @binding(6) var<storage, read_write> colorOut: array<u32>;",
    );
    expect(wgsl).not.toContain("fn surfaceDEProbe");
  });

  it("ignores width, sharedFrontier, bnbStage2 and shadeDeWidth — all producing identical source", () => {
    const base = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "bulb", width: 4 }),
    );
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "bulb", width: 12 }),
      ),
    ).toBe(base);
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "bulb", sharedFrontier: true }),
      ),
    ).toBe(base);
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core: "bulb", bnbStage2: true }),
      ),
    ).toBe(base);

    const shadeBase = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "bulb" }),
    );
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core: "bulb", shadeDeWidth: 1 }),
      ),
    ).toBe(shadeBase);
    expect(surfaceGpuWorkgroupBytes({ ...kernelOpts({ core: "bulb" }) })).toBe(
      0,
    );
  });

  it("composes with the ground plane, appending the plane block after the bulb variant block", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "bulb", groundPlane: true }),
    );
    expect(wgsl).toContain("bulbParams: vec4f,");
    expect(wgsl).toContain("groundY: f32,");
    expect(wgsl).toContain("fn shadeGroundPlane(");
  });
});
