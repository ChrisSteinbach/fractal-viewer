import {
  packBulbGpuParams,
  packEscape4GpuMaps,
  packEscape4GpuParams,
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
  SURFACE_GPU_PARAMS4_BALLOON_BYTES,
  SURFACE_GPU_PARAMS4_BALLOON_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS4_BYTES,
  SURFACE_GPU_PARAMS4_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS4_ESCAPE_BYTES,
  SURFACE_GPU_PARAMS4_LENS_BYTES,
  SURFACE_GPU_PARAMS4_PLANE_BYTES,
  SURFACE_GPU_PARAMS4_PLANE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS4_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS4_TRAP_BYTES,
  SURFACE_GPU_PARAMS4_CHAOS_BYTES,
  SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_CHAOS_BYTES,
  SURFACE_GPU_PARAMS_BALLOON_BYTES,
  SURFACE_GPU_PARAMS_BALLOON_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS_BYTES,
  SURFACE_GPU_PARAMS_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS_PLANE_BYTES,
  SURFACE_GPU_PARAMS_PLANE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS_PLANE_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS_TRAP_BYTES,
  SURFACE_GPU_CHAOS_BYTES,
  SURFACE_GPU_PARAMS_CHAOS_BYTES,
  SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_CHAOS_BYTES,
  SURFACE_GPU_RAY_ACTIVE,
  SURFACE_GPU_RAY_EXHAUSTED,
  SURFACE_GPU_RAY_HIT,
  SURFACE_GPU_RAY_MISS,
  SURFACE_GPU_RAY_PLANE,
  SURFACE_GPU_SHADE_BYTES,
  SURFACE_GPU_SHADE_PATTERN_BYTES,
  SURFACE_GPU_TILING_BYTES,
  SURFACE_GPU_UNIFORM_MAP_SLOTS,
  surfaceDeKernelWgsl,
  surfaceMeshSdfWgslSource,
  surfaceGpuWorkgroupBytes,
} from "./surface-de-gpu";
import {
  BALLOON_FAR_CAP_RHO,
  BALLOON_RHO_MARGIN,
  balloonBall,
  balloonBall4,
  buildBalloon,
  buildBalloon4,
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
  ESCAPE_LINK_BULB,
  ESCAPE_LINK_MANDELBOX,
  ESCAPE_LINK_QSQUARE,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
} from "./escape-de";
import { resolveShapeTrap } from "./shape-trap";
import { LATTICE_PRESENTATION_RADIUS_MULT } from "./lattice-march";
import { GEAR_SHAPE, PEACE_SIGN_SHAPE, type ShapeSpec } from "./shapes";
import { MESH_ASSET_IDS, meshAssetCatalogIndex } from "./mesh-shapes";
import { buildEscapeDE4, SYM_PLANE_CODE4 } from "./escape-de-4d";
import {
  buildSurfaceDE,
  CLASSIC_SURFACE_FOLD_RADII,
  SURFACE_FOLD_BOXFOLD,
} from "./surface-de";
import type { SurfaceDE } from "./surface-de";
import { buildSurfaceDE4, radiusBandInvRange } from "./surface-de-4d";
import type { SurfaceDE4 } from "./surface-de-4d";
import {
  CLASSIC_SURFACE_FINISH,
  type ResolvedSurfaceFinish,
} from "./surface-finish";
import {
  CLASSIC_SURFACE_MATERIAL,
  encodeSurfacePatternConfig,
  resolveSurfaceMaterial,
  type ResolvedSurfaceMaterial,
} from "./surface-material-wire";
import type { Transform } from "./types";
import {
  LATTICE_TILING_CODE,
  latticeFoldSource,
  resolveTiling,
  TILING_GROUP_INFO,
  tilingFoldSource,
  tilingGroupCode,
  type ResolvedFiniteTiling,
  type ResolvedLatticeTiling,
} from "./tiling";

/** Two-map pure-boxfold system (the pure-fold shape used throughout
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
 * (the fold-lens port's stage B). */
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

/** A second, DIFFERENT link for the chain fixtures: a rotated
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

/** A triplex-power LINK for the power-link chain fixtures — `EscapeLinkKind`
 * 4, the first kind that is not a fold. Pre-scaled to 0.3, the pre-scale
 * escape-de.ts's POWER LINKS table measures a renderable object at, so the
 * fixture is a chain a session could actually author. A LONE power map is
 * refused by the gate (the Mandelbulb render owns it), so every fixture
 * here chains it behind {@link canonicalMandelbox}. */
function bulbLink(): Transform {
  return {
    id: 2,
    position: [0, 0, 0],
    rotation: [0, 0.2, 0],
    scale: [0.3, 0.3, 0.3],
    variations: [{ type: "bulb", weight: 1 }],
  };
}

/** The quaternion square LINK — `EscapeLinkKind` 5, the other side of the
 * `kind < 4u` guard, at the pre-scale its own stiffness bound allows. */
function qsquareLink(): Transform {
  return {
    id: 3,
    position: [0.1, 0, -0.05],
    rotation: [0, 0, 0],
    scale: [0.4, 0.4, 0.4],
    variations: [{ type: "qsquare", weight: 1 }],
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

function withSchedule3(
  de: SurfaceDE,
  scheduleMapCount = 2,
  depth = 2,
): SurfaceDE {
  return {
    ...de,
    schedule: {
      maps: Array.from({ length: scheduleMapCount }, () => ({ ...de.maps[0] })),
      depth,
      bounds: [
        {
          center: [4, 5, 6] as [number, number, number],
          radius: 11,
          escapeRadius: 22,
        },
        {
          center: [1, 2, 3] as [number, number, number],
          radius: 7,
          escapeRadius: 14,
        },
        {
          center: de.boundCenter,
          radius: de.boundingRadius,
          escapeRadius: de.escapeRadius,
        },
      ].slice(0, depth + 1),
    },
  };
}

function withSchedule4(
  de: SurfaceDE4,
  scheduleMapCount = 2,
  depth = 2,
): SurfaceDE4 {
  return {
    ...de,
    schedule: {
      maps: Array.from({ length: scheduleMapCount }, () => ({ ...de.maps[0] })),
      depth,
      bounds: [
        { radius: 11, escapeRadius: 22 },
        { radius: 7, escapeRadius: 14 },
        { radius: de.boundingRadius, escapeRadius: de.escapeRadius },
      ].slice(0, depth + 1),
    },
  };
}

const CONDENSATION_SPHERE: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "sphere", radius: 0.5 },
      combine: "union",
    },
  ],
};

const CONDENSATION_BOX: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "box", half: [0.2, 0.3, 0.4] },
      combine: "union",
    },
  ],
};

const MESH_SHAPE: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "mesh", meshId: "star-prism-v1" },
      combine: "union",
    },
  ],
};

/** One recursive map plus two base emitters. Order 3 expands only the
 * emitter records (six total) while preserving two unique shade slots. */
function condensationTransforms(): Transform[] {
  return [
    {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.45, 0.45, 0.45],
      variations: [],
    },
    {
      id: 1,
      position: [0.5, 0, 0],
      rotation: [0, 0, 0.2],
      scale: [0.25, 0.25, 0.25],
      variations: [],
      emitter: CONDENSATION_SPHERE,
    },
    {
      id: 2,
      position: [-0.35, 0.2, 0],
      rotation: [0.1, 0.2, 0],
      scale: [0.2, 0.2, 0.2],
      variations: [],
      emitter: CONDENSATION_BOX,
    },
  ];
}

describe("packSurfaceGpuParams byte length", () => {
  it("returns an ArrayBuffer of exactly SURFACE_GPU_PARAMS_BYTES (288 bytes since the lens fold's authored lengths were appended to the lens block, per the module doc)", () => {
    expect(SURFACE_GPU_PARAMS_BYTES).toBe(288);
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

  it("maps symmetry plane yz/xz/xy to symPlane 0/1/2 at offset 44 — the frozen axis codes", () => {
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
    // The literal alone is NOT the mirror claim this constant's doc makes
    // ("Mirror of surface-material.ts's SURFACE_FULL_HIT_FLOOR"): the two
    // are asserted EQUAL in surface-compute.test.ts, which is app-side and
    // may therefore import the Three.js-bound GLSL module this
    // dependency-free core must not.
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

  it("round-trips a foldFinal lens's invM rows / invT / lensParams at the documented 208..271 offsets", () => {
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

  it("throws when a footprint is combined with a foldFinal lens (the fold-lens cut boundary)", () => {
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

  it("balloon third-arg null (and omitted) returns today's base-size buffer byte for byte", () => {
    const de = buildSurfaceDE(foldSystemTransforms(), affineFinalTransform());
    const omitted = new Uint8Array(packSurfaceGpuParams(de, { itemCount: 3 }));
    const explicit = new Uint8Array(
      packSurfaceGpuParams(de, { itemCount: 3 }, null),
    );
    expect(omitted.byteLength).toBe(SURFACE_GPU_PARAMS_BYTES);
    expect(explicit).toEqual(omitted);
  });

  it("packs the balloon block at the frozen 288..319 offsets from buildBalloon's numbers, growing the buffer to 320 without touching 0..287 (the lensFold quartet moved the shared block up from 272)", () => {
    expect(SURFACE_GPU_PARAMS_BALLOON_BYTES).toBe(320);
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
    expect(view.getFloat32(288, true)).toBe(Math.fround(b.center[0]));
    expect(view.getFloat32(292, true)).toBe(Math.fround(b.center[1]));
    expect(view.getFloat32(296, true)).toBe(Math.fround(b.center[2]));
    expect(view.getFloat32(300, true)).toBe(
      Math.fround(ball.radius * BALLOON_RHO_MARGIN),
    );
    expect(view.getFloat32(304, true)).toBe(Math.fround(1.6 * ball.radius));
    expect(view.getFloat32(308, true)).toBe(
      Math.fround(BALLOON_FAR_CAP_RHO * ball.radius),
    );
    expect(view.getFloat32(312, true)).toBe(0);
    expect(view.getFloat32(316, true)).toBe(0);
  });

  it("throws when a footprint is combined with the balloon (the balloon cut boundary)", () => {
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
  it("packs focusDepth into the former offset-92 padding word", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const view = new DataView(
      packSurfaceGpuParams(de, { itemCount: 1, focusDepth: 4.25 }),
    );
    expect(view.getFloat32(92, true)).toBe(Math.fround(4.25));
    expect(
      new DataView(packSurfaceGpuParams(de, { itemCount: 1 })).getFloat32(
        92,
        true,
      ),
    ).toBe(0);
  });

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

  // Offset 204 is the former pad1 slot, claimed for the fog
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
    // Grown 6 -> 7 by the `fold` lane carrying the map's three
    // AUTHORED fold lengths, pinned by its own test below.
    expect(SURFACE_GPU_MAP_VEC4).toBe(7);
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

describe("the fold's authored lengths on the wire", () => {
  it("carries each 3D map's OWN authored lengths in the fold lane, not the classic set", () => {
    // Two folds with different apparatus, every length exactly
    // representable in f32 and no two equal — a lane swap shows up as the
    // wrong number rather than a coincidental match. Both stay inside the
    // contraction gate: |w|·(fR²/mR²)·sigma_max is 0.8 and 0.72.
    const de = buildSurfaceDE([
      {
        id: 0,
        position: [0.4, 0.1, 0],
        rotation: [0.3, 0.2, 0],
        scale: [0.45, 0.45, 0.45],
        variations: [
          {
            type: "mandelbox",
            weight: 1,
            minRadius: 0.375,
            fixedRadius: 0.5,
            boxLimit: 0.75,
          },
        ],
      },
      {
        id: 1,
        position: [-0.35, -0.2, 0.3],
        rotation: [0, 0.5, 0.1],
        scale: [0.2, 0.2, 0.2],
        variations: [
          {
            type: "spherefold",
            weight: 0.9,
            minRadius: 0.25,
            fixedRadius: 0.5,
            boxLimit: 2,
          },
        ],
      },
    ]);
    const stride = SURFACE_GPU_MAP_VEC4 * 4;
    const out = packSurfaceGpuMaps(de);
    expect(Array.from(out.slice(24, 28))).toEqual([0.375, 0.5, 0.75, 0]);
    expect(Array.from(out.slice(stride + 24, stride + 28))).toEqual([
      0.25, 0.5, 2, 0,
    ]);
  });

  it("carries the classic (0.5, 1, 1) for a fold that authored none of them — the wire's own 'absent means classic'", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const stride = SURFACE_GPU_MAP_VEC4 * 4;
    const out = packSurfaceGpuMaps(de);
    de.maps.forEach((_, j) => {
      expect(Array.from(out.slice(j * stride + 24, j * stride + 28))).toEqual([
        0.5, 1, 1, 0,
      ]);
    });
  });

  it("carries the same three lengths one dimension up, so a 3D system and its 4D lift cannot disagree", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.4, 0.1, 0],
        rotation: [0.3, 0.2, 0],
        scale: [0.45, 0.45, 0.45],
        variations: [
          {
            type: "boxfold",
            weight: 1.25,
            minRadius: 0.375,
            fixedRadius: 0.5,
            boxLimit: 0.75,
          },
        ],
      },
    ];
    const out3 = packSurfaceGpuMaps(buildSurfaceDE(transforms));
    const out4 = packSurfaceGpuMaps4(buildSurfaceDE4(transforms));
    expect(Array.from(out3.slice(24, 28))).toEqual([0.375, 0.5, 0.75, 0]);
    expect(Array.from(out4.slice(32, 36))).toEqual([0.375, 0.5, 0.75, 0]);
  });

  it("carries each escape LINK's lengths SQUARED, which is the form its forward orbit reads", () => {
    // A chain whose two links hold DIFFERENT apparatus — the head
    // parameterized, the tail leaving the sphere pair absent — so the
    // per-link wire and the absent-means-classic rule are pinned together.
    const de = buildEscapeDE([
      {
        id: 0,
        position: [0.4, 0.3, 0.2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [
          {
            type: "mandelbox",
            weight: 2,
            minRadius: 0.375,
            fixedRadius: 0.5,
            boxLimit: 0.75,
          },
        ],
      },
      {
        id: 1,
        position: [-0.1, 0.2, 0],
        rotation: [0.2, 0, 0.1],
        scale: [1, 1, 1],
        variations: [{ type: "boxfold", weight: 1.5, boxLimit: 3 }],
      },
    ]);
    const stride = SURFACE_GPU_MAP_VEC4 * 4;
    const maps = packEscapeGpuMaps(de);
    expect(Array.from(maps.slice(24, 28))).toEqual([0.140625, 0.25, 0.75, 0]);
    expect(Array.from(maps.slice(stride + 24, stride + 28))).toEqual([
      0.25, 1, 3, 0,
    ]);
  });

  it("packs the fold LENS's own lengths into the params block, and zeros the slot when there is no lens", () => {
    const lensed = buildSurfaceDE(foldSystemTransforms(), {
      id: 98,
      position: [0.12, -0.05, 0.08],
      rotation: [0.3, 0.1, -0.2],
      scale: [0.9, 0.9, 0.9],
      variations: [
        {
          type: "spherefold",
          weight: 0.9,
          minRadius: 0.375,
          fixedRadius: 1.5,
          boxLimit: 0.75,
        },
      ],
    });
    const view = new DataView(packSurfaceGpuParams(lensed, { itemCount: 1 }));
    expect(view.getFloat32(272, true)).toBe(0.375);
    expect(view.getFloat32(276, true)).toBe(1.5);
    expect(view.getFloat32(280, true)).toBe(0.75);
    expect(view.getFloat32(284, true)).toBe(0);

    const plain = buildSurfaceDE(foldSystemTransforms());
    expect(plain.foldFinal).toBeNull();
    const plainView = new DataView(
      packSurfaceGpuParams(plain, { itemCount: 1 }),
    );
    expect(plainView.getFloat32(272, true)).toBe(0);
    expect(plainView.getFloat32(276, true)).toBe(0);
    expect(plainView.getFloat32(280, true)).toBe(0);
  });

  it("packs the 4D fold lens's lengths past the lens4 block", () => {
    const de = buildSurfaceDE4(fourDFoldSystemTransforms(), {
      id: 98,
      position: [0.12, -0.05, 0.08],
      rotation: [0.3, 0.1, -0.2],
      scale: [0.9, 0.9, 0.9],
      variations: [
        {
          type: "spherefold",
          weight: 0.9,
          minRadius: 0.375,
          fixedRadius: 1.5,
          boxLimit: 0.75,
        },
      ],
    });
    expect(de.foldFinal).not.toBeNull();
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    expect(view.getFloat32(560, true)).toBe(0.375);
    expect(view.getFloat32(564, true)).toBe(1.5);
    expect(view.getFloat32(568, true)).toBe(0.75);
    expect(view.getFloat32(572, true)).toBe(0);
  });

  it("derives the branch algebra from the wire in every kernel that enumerates fold branches, and in no other", () => {
    for (const opts of [
      kernelOpts({ core: "fold" }),
      kernelOpts({ core: "fold4" }),
      kernelOpts({ core: "affine", lens: true }),
      kernelOpts({ core: "affine4", lens: true }),
    ]) {
      expect(surfaceDeKernelWgsl(opts)).toContain("fn foldRadiiOf(");
    }
    for (const opts of [
      kernelOpts({ core: "affine" }),
      kernelOpts({ core: "affine4" }),
      kernelOpts({ core: "escape" }),
      kernelOpts({ core: "bulb" }),
    ]) {
      expect(surfaceDeKernelWgsl(opts)).not.toContain("foldRadiiOf");
    }
  });

  it("leaves no classic fold length baked into a fold body — the CPU/GPU divergence this closed", () => {
    for (const core of ["fold", "fold4"] as const) {
      const src = surfaceDeKernelWgsl(kernelOpts({ core }));
      expect(src).not.toContain("= 2.0 - u;");
      expect(src).not.toContain("= -2.0 - u;");
      expect(src).not.toContain("v = 0.25 * u;");
      expect(src).not.toContain("sfSigma = 4.0;");
      expect(src).not.toContain("max(ru - 2.0, 0.0)");
      expect(src).not.toContain("max(1.0 - ru, 0.0)");
    }
    // The forward orbit reads its links' lengths straight off the wire
    // instead, so the escape core's own two constants are gone as well.
    const escape = surfaceDeKernelWgsl(kernelOpts({ core: "escape" }));
    expect(escape).not.toContain("clamp(dot(y, y), 0.25, 1.0)");
    expect(escape).not.toContain("clamp(y, vec3f(-1.0), vec3f(1.0))");
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
    bgOffset: [12, 34],
    bgExtent: [640, 480],
    bgCenter: [0.5, 0.5],
    bgScale: [1.25, 0.8],
    bgShape: 1,
    ...overrides,
  };
}

describe("packSurfaceGpuShade", () => {
  it("returns an ArrayBuffer of exactly SURFACE_GPU_SHADE_BYTES (224 bytes, per the module doc)", () => {
    // 144 through the fog tint pair; 160 since pixelJitter
    // at 144 (a WGSL uniform struct rounds to its largest member's 16-byte
    // alignment, so the trailing vec2f costs a full stride); 176 since
    // the bgOffset/bgExtent vec2f pair at 160/168; 208 since
    // the bgCenter/bgScale vec2f pair at 176/184 plus bgShape u32 at
    // 192, rounded up to the next 16-byte multiple; and 224 since
    // balloonTint's vec3f at 208 plus balloonTintStrength f32 at
    // 220 — bgShape's 196..207 tail is 12 bytes a vec3f cannot use
    // (AlignOf 16, 196 % 16 != 0), so the pair lands at the next
    // 16-aligned offset and closes the struct with no pad at all.
    expect(SURFACE_GPU_SHADE_BYTES).toBe(224);
    const buf = packSurfaceGpuShade(shadeParams());
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(SURFACE_GPU_SHADE_BYTES);
  });

  it("defaults pixelJitter to the pixel centre, so an unset jitter is the pre-supersampling kernel input", () => {
    const view = new DataView(packSurfaceGpuShade(shadeParams()));
    expect(view.getFloat32(144, true)).toBe(0.5);
    expect(view.getFloat32(148, true)).toBe(0.5);
  });

  it("round-trips an explicit pixelJitter at offset 144", () => {
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

  it("packs the independent balloon-palette gate in flags bit1 without disturbing dither bit0", () => {
    const inherit = new DataView(
      packSurfaceGpuShade(
        shadeParams({ dither: false, balloonPalette: false }),
      ),
    );
    const palette = new DataView(
      packSurfaceGpuShade(shadeParams({ dither: false, balloonPalette: true })),
    );
    const both = new DataView(
      packSurfaceGpuShade(shadeParams({ dither: true, balloonPalette: true })),
    );
    expect(inherit.getUint32(124, true)).toBe(0);
    expect(palette.getUint32(124, true)).toBe(2);
    expect(both.getUint32(124, true)).toBe(3);
    expect(both.getUint32(124, true) & 1).toBe(1);
    expect(both.getUint32(124, true) & 2).toBe(2);
  });

  it("defaults fogTint to [1, 1, 1] at offset 128 and fogTintStrength to 0 at offset 140 when omitted (the fog-tint identity)", () => {
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

  it("defaults envStrength to 0 at offset 152 when omitted (the pre-feature identity)", () => {
    const view = new DataView(packSurfaceGpuShade(shadeParams()));
    expect(view.getFloat32(152, true)).toBe(0);
  });

  it("round-trips an explicit envStrength at offset 152", () => {
    const view = new DataView(
      packSurfaceGpuShade(shadeParams({ envStrength: 0.4 })),
    );
    expect(view.getFloat32(152, true)).toBe(Math.fround(0.4));
  });

  it("writes an omitted envStrength byte-identically to the pre-environment-light buffer at every other offset", () => {
    const withField = new Uint8Array(
      packSurfaceGpuShade(shadeParams({ envStrength: 0 })),
    );
    const without = new Uint8Array(packSurfaceGpuShade(shadeParams()));
    expect(withField).toEqual(without);
  });

  it("round-trips bgOffset/bgExtent at offsets 160/168", () => {
    const view = new DataView(
      packSurfaceGpuShade(
        shadeParams({ bgOffset: [7, 1057], bgExtent: [1920, 3169] }),
      ),
    );
    expect(view.getFloat32(160, true)).toBe(7);
    expect(view.getFloat32(164, true)).toBe(1057);
    expect(view.getFloat32(168, true)).toBe(1920);
    expect(view.getFloat32(172, true)).toBe(3169);
  });

  it("round-trips bgCenter/bgScale/bgShape at offsets 176/184/192", () => {
    const view = new DataView(
      packSurfaceGpuShade(
        shadeParams({
          bgCenter: [0.5, 0.4375],
          bgScale: [1.5, 0.75],
          bgShape: 1,
        }),
      ),
    );
    expect(view.getFloat32(176, true)).toBe(0.5);
    expect(view.getFloat32(180, true)).toBe(0.4375);
    expect(view.getFloat32(184, true)).toBe(1.5);
    expect(view.getFloat32(188, true)).toBe(0.75);
    expect(view.getUint32(192, true)).toBe(1);
  });

  it("round-trips balloonTint at offset 208 and balloonTintStrength at 220", () => {
    const view = new DataView(
      packSurfaceGpuShade(
        shadeParams({
          balloonTint: [0.125, 0.5, 0.9375],
          balloonTintStrength: 0.75,
        }),
      ),
    );
    expect(view.getFloat32(208, true)).toBe(0.125);
    expect(view.getFloat32(212, true)).toBe(0.5);
    expect(view.getFloat32(216, true)).toBe(0.9375);
    expect(view.getFloat32(220, true)).toBe(0.75);
  });

  it("zero-fills the whole balloon tint pair when the caller omits it — mix(base, black, 0) is the pre-tint identity", () => {
    const view = new DataView(packSurfaceGpuShade(shadeParams()));
    expect(view.getFloat32(208, true)).toBe(0);
    expect(view.getFloat32(212, true)).toBe(0);
    expect(view.getFloat32(216, true)).toBe(0);
    expect(view.getFloat32(220, true)).toBe(0);
  });

  it("leaves the 196..207 alignment pad untouched, so bgShape's tail is not what the tint's vec3f landed in", () => {
    // The tint could NOT sit at 196 (vec3f AlignOf 16, 196 % 16 != 0),
    // which is the whole reason the struct grew rather than filling a pad
    // the way envStrength did at 152.
    const bytes = new Uint8Array(
      packSurfaceGpuShade(
        shadeParams({
          balloonTint: [1, 1, 1],
          balloonTintStrength: 1,
        }),
      ),
    );
    expect(Array.from(bytes.slice(196, 208))).toEqual(Array(12).fill(0));
  });

  it("packs the pattern calibration quartet at 224, growing the buffer to 240 — absent keeps the 224-byte buffer byte for byte", () => {
    expect(SURFACE_GPU_SHADE_PATTERN_BYTES).toBe(240);
    const calibration: [number, number, number, number] = [
      0.03,
      1 / 0.94,
      0.2,
      1 / 0.6,
    ];
    const buf = packSurfaceGpuShade(
      shadeParams({ patternCalibration: calibration }),
    );
    expect(buf.byteLength).toBe(SURFACE_GPU_SHADE_PATTERN_BYTES);
    const view = new DataView(buf);
    expect(view.getFloat32(224, true)).toBe(Math.fround(calibration[0]));
    expect(view.getFloat32(228, true)).toBe(Math.fround(calibration[1]));
    expect(view.getFloat32(232, true)).toBe(Math.fround(calibration[2]));
    expect(view.getFloat32(236, true)).toBe(Math.fround(calibration[3]));
    // Every pre-calibration byte is the 224-byte buffer's own.
    const without = new Uint8Array(packSurfaceGpuShade(shadeParams()));
    expect(without.byteLength).toBe(SURFACE_GPU_SHADE_BYTES);
    expect(new Uint8Array(buf, 0, SURFACE_GPU_SHADE_BYTES)).toEqual(without);
    // An explicit zero quartet is still a 240-byte buffer (the member's
    // presence is the wire signal, not its values).
    expect(
      packSurfaceGpuShade(shadeParams({ patternCalibration: [0, 0, 0, 0] }))
        .byteLength,
    ).toBe(SURFACE_GPU_SHADE_PATTERN_BYTES);
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

  it("absent materials return the 1-vec4-stride buffer byte for byte — every earlier caller is unmoved", () => {
    const colors: [number, number, number][] = [
      [0.125, 0.25, 0.375],
      [0.5, 0.625, 0.75],
    ];
    const traps = [0.25, 0.75];
    // The pre-finish packer's exact output, constructed here as the
    // expectation: stride 4, (rgb, trapIndex) per slot, nothing else.
    const expected = new Float32Array(colors.length * 4);
    colors.forEach((c, j) => {
      expected[j * 4 + 0] = c[0];
      expected[j * 4 + 1] = c[1];
      expected[j * 4 + 2] = c[2];
      expected[j * 4 + 3] = traps[j];
    });
    expect(packSurfaceGpuShadeMaps(colors, traps)).toEqual(expected);
    expect(packSurfaceGpuShadeMaps(colors, traps, undefined)).toEqual(expected);
  });

  it("packs finish-only stride 3 — [0] the (rgb, trap) vec4 unchanged, then shared lanes A/B at exact indices", () => {
    const finishes: ResolvedSurfaceFinish[] = [
      {
        specular: 0.75,
        shininess: 96,
        metalness: 0.25,
        reflect: 0.5,
        transmit: 0.125,
        reflectionTint: 0.75,
      },
      CLASSIC_SURFACE_FINISH,
    ];
    const materials: ResolvedSurfaceMaterial[] = finishes.map((finish) => ({
      finish,
      pattern: CLASSIC_SURFACE_MATERIAL.pattern,
    }));
    const out = packSurfaceGpuShadeMaps(
      [
        [0.125, 0.25, 0.375],
        [0.5, 0.625, 0.75],
      ],
      [0.25, 0.75],
      materials,
    );
    expect(out.length).toBe(24);
    // Slot 0: today's vec4, then a = (specular, shininess, metalness,
    // reflect), then b = (transmit, reflectionTint, 0, 0).
    expect(Array.from(out.subarray(0, 12))).toEqual([
      0.125, 0.25, 0.375, 0.25, 0.75, 96, 0.25, 0.5, 0.125, 0.75, 0, 0,
    ]);
    // Slot 1: the classic lanes (0.4 is f32-exact only after fround, so
    // compare the rounded value).
    expect(Array.from(out.subarray(12, 24))).toEqual([
      0.5,
      0.625,
      0.75,
      0.75,
      Math.fround(0.4),
      32,
      0,
      0,
      0,
      1,
      0,
      0,
    ]);
  });

  it("throws RangeError when materials do not cover every color slot — a caller bug, like the module's other pack throws", () => {
    expect(() =>
      packSurfaceGpuShadeMaps(
        [
          [1, 0, 0],
          [0, 1, 0],
        ],
        [0, 0],
        [CLASSIC_SURFACE_MATERIAL],
      ),
    ).toThrow(RangeError);
  });

  it("packs pattern-only materials at stride 3 while retaining classic finish lanes", () => {
    const material = resolveSurfaceMaterial(undefined, {
      kind: "strata",
      axis: "x",
      scale: 3.1256,
      strength: 0.625,
    });
    const out = packSurfaceGpuShadeMaps([[0.25, 0.5, 0.75]], [0.4], [material]);
    expect(out.length).toBe(12);
    expect(Array.from(out.subarray(4, 12))).toEqual([
      Math.fround(0.4),
      32,
      0,
      0,
      0,
      1,
      encodeSurfacePatternConfig(material.pattern),
      Math.fround(3.1256),
    ]);
  });

  it("pads one zero stride of 12 floats for empty colors under materials — the slot clamp keeps reads inside real slots, so zeros are safe", () => {
    const out = packSurfaceGpuShadeMaps([], [], []);
    expect(out.length).toBe(12);
    expect(Array.from(out)).toEqual(Array<number>(12).fill(0));
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

  it("mode 'shade' declares the shading interface at bindings 4-9 (shade/shadeMaps/colorOut/lutTex/lutSamp/layerOut)", () => {
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
    expect(wgsl).toContain(
      "@group(0) @binding(9) var<storage, read_write> layerOut: array<u32>;",
    );
  });

  it("packs the presentation sidecar as coverage/fog/beta/signed-CoC and writes every ordinary terminal path without changing colorOut", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "shade" }));
    expect(wgsl).toContain(
      "fn packSurfaceLayer(coverage: f32, fog: f32, coc: f32) -> u32",
    );
    expect(wgsl).toContain("(cameraDepth - params.focusDepth)");
    expect(wgsl).toContain("max(params.visibleRadius, 1.0e-6)");
    expect(wgsl).toContain("return (128.0 + 127.0 * signedCoc) / 255.0;");
    expect(wgsl).toContain("coverage * fog * (1.0 - shade.fogTintStrength)");
    expect(wgsl).toContain(
      "return pack4x8unorm(vec4f(coverage, fog, beta, coc));",
    );
    // Defensive gate miss, terminal miss/exhausted, terminal hit.
    expect(wgsl.split("layerOut[ray] = packSurfaceLayer(").length - 1).toBe(3);
    expect(wgsl).toContain("layerOut[ray] = packSurfaceLayer(0.0, 0.0, 1.0);");
    expect(wgsl).toContain("let coc = surfaceCoc(dot(pos - ro, params.fwd));");
    expect(wgsl).toContain(
      "layerOut[ray] = packSurfaceLayer(1.0, clamp(fog, 0.0, 1.0), coc);",
    );
    expect(wgsl).toContain("colorOut[ray] = pack4x8unorm(vec4f(col, 1.0));");
  });

  it.each([
    { core: "fold" as const },
    { core: "affine" as const },
    { core: "escape" as const },
    { core: "bulb" as const },
    { core: "fold4" as const },
    { core: "affine4" as const },
    { core: "escape4" as const },
    { core: "fold" as const, balloon: true },
  ])("initializes signed CoC metadata in the $core shade kernel", (opts) => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 4, ...opts }),
    );
    expect(wgsl).toContain("focusDepth: f32,");
    expect(wgsl).toContain("fn surfaceCoc(cameraDepth: f32) -> f32");
    expect(wgsl).toContain("layerOut[ray] = packSurfaceLayer(0.0, 0.0, 1.0);");
    expect(wgsl).toContain("let coc = surfaceCoc(dot(pos - ro, params.fwd));");
    expect(wgsl).toContain(
      "layerOut[ray] = packSurfaceLayer(1.0, clamp(fog, 0.0, 1.0), coc);",
    );
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
    expect(wgsl).not.toContain("layerOut");
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

describe("surfaceDeKernelWgsl march status side-channel (statusOut)", () => {
  it("statusOut:true declares @group(0) @binding(5) var<storage, read_write> statusOut: array<u32>;, and the flag absent has no occurrence of statusOut at all", () => {
    const on = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "fold", width: 12, statusOut: true }),
    );
    expect(on).toContain(
      "@group(0) @binding(5) var<storage, read_write> statusOut: array<u32>;",
    );
    const off = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "fold", width: 12 }),
    );
    expect(off).not.toContain("statusOut");
  });

  it("statusOut:false reproduces the absent-field source byte for byte, and stripping every statusOut-mentioning line out of the true source recovers it exactly — the 'pure side channel' claim", () => {
    const off = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "fold", width: 12 }),
    );
    const explicitFalse = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "fold", width: 12, statusOut: false }),
    );
    expect(explicitFalse).toBe(off);

    const on = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "fold", width: 12, statusOut: true }),
    );
    const stripped = on
      .split("\n")
      .filter((line) => !line.includes("statusOut"))
      .join("\n");
    expect(stripped).toBe(off);
  });

  it("writes the status at every marchRays exit except the out-of-range guard — a future early return added without a write must fail this test", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "fold", width: 12, statusOut: true }),
    );
    const body = wgsl.slice(wgsl.indexOf("fn marchRays"));
    const lines = body.split("\n");
    const writeLine = "statusOut[slotI] = u32(st.y);";
    const returnLineIndices = lines
      .map((line, i) => (line.trim() === "return;" ? i : -1))
      .filter((i) => i !== -1);
    // Module doc: every exit writes it — both sphere-gate early-outs, the
    // defensive non-ACTIVE guard and the fall-through — except the
    // slotI >= params.itemCount guard, whose slot sits outside the
    // dispatch's item range. That is exactly 4 literal `return;` sites.
    expect(returnLineIndices.length).toBe(4);
    for (let n = 0; n < returnLineIndices.length; n++) {
      const lineIx = returnLineIndices[n];
      let p = lineIx - 1;
      while (p >= 0 && lines[p].trim() === "") p--;
      const precededByWrite = p >= 0 && lines[p].trim() === writeLine;
      if (n === 0) {
        expect(precededByWrite).toBe(false);
      } else {
        expect(precededByWrite).toBe(true);
      }
    }
    // The fall-through — the loop's shared exit, not a `return;` at all —
    // writes the status right after its states[ray] = st; write.
    const stateWriteIndices = lines
      .map((line, i) => (line.trim() === "states[ray] = st;" ? i : -1))
      .filter((i) => i !== -1);
    const fallThroughIx = stateWriteIndices[stateWriteIndices.length - 1];
    expect(lines[fallThroughIx + 1].trim()).toBe(writeLine);
  });

  it("balloon drops the two sphere-gate early-outs entirely, so its march body writes the status at exactly 2 sites against the non-balloon fold config's 4 (the balloon gate composes with the side channel)", () => {
    const writeLine = "statusOut[slotI] = u32(st.y);";
    const plain = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", core: "fold", width: 12, statusOut: true }),
    );
    const balloon = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "march",
        core: "fold",
        width: 12,
        balloon: true,
        statusOut: true,
      }),
    );
    expect(plain.split(writeLine).length - 1).toBe(4);
    expect(balloon.split(writeLine).length - 1).toBe(2);
  });

  it("groundPlane's classifier assignment lands before the write at both sphere-gate exits (the plane composes with the side channel)", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "march",
        core: "fold",
        width: 12,
        groundPlane: true,
        statusOut: true,
      }),
    );
    const gateBlock =
      "    st.y = groundPlaneStatus(ro, rd);\n" +
      "    states[ray] = st;\n" +
      "    statusOut[slotI] = u32(st.y);\n" +
      "    return;";
    expect(wgsl.split(gateBlock).length - 1).toBe(2);
  });

  it("throws for mode 'eval' and mode 'shade' — statusOut is a march-mode output", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ mode: "eval", statusOut: true })),
    ).toThrow(/march-mode/);
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ mode: "shade", statusOut: true })),
    ).toThrow(/march-mode/);
  });

  it("composes with the 4D descent cores — the march entry text is shared across cores, so affine4 and fold4 declare the binding and write at every exit exactly like the 3D fold core", () => {
    const writeLine = "statusOut[slotI] = u32(st.y);";
    for (const core of ["affine4", "fold4"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "march", core, width: 12, statusOut: true }),
      );
      expect(wgsl).toContain(
        "@group(0) @binding(5) var<storage, read_write> statusOut: array<u32>;",
      );
      const lines = wgsl.slice(wgsl.indexOf("fn marchRays")).split("\n");
      const returnLineIndices = lines
        .map((line, i) => (line.trim() === "return;" ? i : -1))
        .filter((i) => i !== -1);
      expect(returnLineIndices.length).toBe(4);
      for (let n = 0; n < returnLineIndices.length; n++) {
        const lineIx = returnLineIndices[n];
        let p = lineIx - 1;
        while (p >= 0 && lines[p].trim() === "") p--;
        const precededByWrite = p >= 0 && lines[p].trim() === writeLine;
        if (n === 0) {
          expect(precededByWrite).toBe(false);
        } else {
          expect(precededByWrite).toBe(true);
        }
      }
      const stateWriteIndices = lines
        .map((line, i) => (line.trim() === "states[ray] = st;" ? i : -1))
        .filter((i) => i !== -1);
      const fallThroughIx = stateWriteIndices[stateWriteIndices.length - 1];
      expect(lines[fallThroughIx + 1].trim()).toBe(writeLine);
    }
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

describe("surfaceDeKernelWgsl shade probe width (shadeDeWidth)", () => {
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

describe("surfaceDeKernelWgsl descent core (core)", () => {
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

  it("core 'affine' emits the width-4 refined ladder — refinedCert, A/B chains, rank-3/4 validity slots — and no fold frontier", () => {
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

describe("surfaceDeKernelWgsl fold-lens wrapper (lens)", () => {
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

describe("surfaceDeKernelWgsl balloon wrapper (balloon)", () => {
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
      // with the march-epsilon inner cutoff scaled by the value factor.
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
    // WGSL value constructors are all-or-none — and the echo tint added
    // the zeroed `shell` beside it.
    expect(wgsl).toContain(
      "SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0, vec3f(0.0), 0.0)",
    );
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

  it("throws on every FORWARD core — the swallowed-camera exclusion, in both dimensions", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "escape", balloon: true })),
    ).toThrow(/escape/);
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "bulb", balloon: true })),
    ).toThrow(/bulb/);
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "escape4", balloon: true })),
    ).toThrow(/escape4/);
  });

  it("composes with the 4D DESCENT cores, landing the balloon block past the unconditionally-declared lens4 block", () => {
    for (const core of ["affine4", "fold4"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, width: 12, balloon: true }),
      );
      // The lens4 block is declared even without a lens, so balloonCenter
      // lands at the frozen 576 either way.
      expect(wgsl.indexOf("lens4Fold: vec4f")).toBeGreaterThan(0);
      expect(wgsl.indexOf("balloonCenter: vec3f")).toBeGreaterThan(
        wgsl.indexOf("lens4Fold: vec4f"),
      );
      // The wrapper text is the 3D one, unchanged — that is what makes the
      // semantics slice-then-invert.
      expect(wgsl).toContain("fn balloonInvert(p: vec3f) -> vec4f {");
      expect(wgsl).toContain("fn surfaceDEFractal(");
    }
  });
});

describe("balloon echo tint", () => {
  it("carries the oracle's shell attribution on SurfaceHitInfo, written 1.0 by the echo branch and 0.0 by the fractal fall-through", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, shadeDeWidth: 1, balloon: true }),
    );
    expect(wgsl).toContain("shell: f32,");
    // Ties go to the FRACTAL term — the strict `dS < dF` the CPU oracle's
    // BalloonDistance.shell uses — so the echo branch is the 1.0 side.
    expect(wgsl).toContain(`  if (dS < dF) {
    var hi = surfaceDEHitInfoFractal(inv.xyz, li);
    hi.colorPos = inv.xyz;
    hi.shell = 1.0;
    return hi;
  }
  var hi = surfaceDEHitInfoFractal(p, li);
  hi.colorPos = p;
  hi.shell = 0.0;
  return hi;`);
    // WGSL value constructors are all-or-none, so the cores' full-member
    // constructor zeroes the new member too — and a zeroed shell reads as
    // the fractal term, the untinted direction.
    expect(wgsl).toContain(
      "SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0, vec3f(0.0), 0.0)",
    );
  });

  it("mixes the tint into the BASE albedo, gated on hi.shell, before the sRGB decode the lighting rides", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, shadeDeWidth: 1, balloon: true }),
    );
    const mix =
      "base = mix(base, shade.balloonTint, shade.balloonTintStrength * hi.shell);";
    expect(wgsl).toContain(mix);
    // Before lighting: the specular stays untinted and the shell still
    // shades as geometry (the envTint rule, one feature over).
    expect(wgsl.indexOf(mix)).toBeGreaterThan(
      wgsl.indexOf("base = textureSampleLevel(lutTex, lutSamp,"),
    );
    expect(wgsl.indexOf(mix)).toBeLessThan(
      wgsl.indexOf("let linBase = pow(base, vec3f(2.2));"),
    );
  });

  it("binds and samples the balloon LUT only for shell hits with flags bit1, using the exact source/rho coordinate before tint", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, shadeDeWidth: 1, balloon: true }),
    );
    const binding =
      "@group(0) @binding(10) var balloonLutTex: texture_2d<f32>;";
    const guard = "if ((shade.flags & 2u) != 0u && hi.shell > 0.5) {";
    const radial = `let balloonU = clamp(
      length(hi.colorPos - params.balloonCenter) / params.balloonRho,
      0.0,
      1.0,
    );`;
    const bucket = "let balloonIndex = min(floor(balloonU * 256.0), 255.0);";
    const lookup = `base = textureSampleLevel(
      balloonLutTex,
      lutSamp,
      vec2f((balloonIndex + 0.5) / 256.0, 0.5),
      0.0,
    ).rgb;`;
    const tint =
      "base = mix(base, shade.balloonTint, shade.balloonTintStrength * hi.shell);";
    expect(wgsl).toContain(binding);
    expect(wgsl).toContain(guard);
    expect(wgsl).toContain(radial);
    expect(wgsl).toContain(bucket);
    expect(wgsl).toContain(lookup);
    expect(wgsl.indexOf(lookup)).toBeLessThan(wgsl.indexOf(tint));
    expect(wgsl.split("balloonLutTex")).toHaveLength(3);
  });

  it("emits the same palette lookup for 3D and 4D balloon shade cores", () => {
    const paletteBlock = (src: string): string => {
      const match = src.match(
        /if \(\(shade\.flags & 2u\) != 0u && hi\.shell > 0\.5\) \{[\s\S]*?\n\s*\}/,
      );
      expect(match).not.toBeNull();
      return match![0];
    };
    const three = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "fold", width: 12, balloon: true }),
    );
    for (const core of ["affine4", "fold4"] as const) {
      const four = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, width: 12, balloon: true }),
      );
      expect(paletteBlock(four)).toBe(paletteBlock(three));
    }
  });

  it("emits the mix once per shade kernel and nowhere in the eval/march kernels, which have no base albedo", () => {
    const shade = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, balloon: true }),
    );
    expect(
      shade.split(
        "base = mix(base, shade.balloonTint, shade.balloonTintStrength * hi.shell);",
      ).length,
    ).toBe(2);
    for (const mode of ["eval", "march"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode, width: 12, balloon: true }),
      );
      expect(wgsl).not.toContain("shade.balloonTint");
      // Neither mode emits SurfaceHitInfo at all — the attribution bit
      // exists to be read by shading, so it costs the marcher nothing.
      expect(wgsl).not.toContain("shell: f32,");
      expect(wgsl).not.toContain("hi.shell");
      expect(wgsl).not.toContain("@binding(10)");
      expect(wgsl).not.toContain("balloonLutTex");
      expect(wgsl).not.toContain("shade.flags & 2u");
      expect(wgsl).not.toContain("balloonIndex");
    }
  });

  it("reaches BOTH dimensions from ONE emission — the shade entry text is shared across cores", () => {
    for (const core of ["fold", "affine", "affine4", "fold4"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, width: 12, balloon: true }),
      );
      expect(wgsl).toContain("shell: f32,");
      expect(wgsl).toContain("hi.shell = 1.0;");
      expect(wgsl).toContain("hi.shell = 0.0;");
      expect(wgsl).toContain(
        "base = mix(base, shade.balloonTint, shade.balloonTintStrength * hi.shell);",
      );
    }
  });

  it("keeps balloon tint unread outside balloon and ground shade kernels", () => {
    const cases: Partial<SurfaceGpuKernelOptions>[] = [
      { mode: "shade", core: "fold", width: 12, shadeDeWidth: 1 },
      { mode: "shade", core: "affine", width: 4 },
      { mode: "shade", core: "escape", width: 4 },
      { mode: "shade", core: "bulb", width: 4 },
      { mode: "shade", core: "affine4", width: 4 },
      { mode: "shade", core: "fold4", width: 12 },
      { mode: "shade", core: "escape4", width: 4 },
      { mode: "shade", core: "fold", width: 12, lens: true },
      { mode: "shade", core: "fold", width: 12, groundPlane: true },
      { mode: "march", rays: "unproject", width: 12 },
      { mode: "eval", width: 12 },
    ];
    for (const overrides of cases) {
      const wgsl = surfaceDeKernelWgsl(kernelOpts(overrides));
      // No attribution member and no reader of one.
      expect(wgsl).not.toContain("shell: f32,");
      expect(wgsl).not.toContain("hi.shell");
      expect(wgsl).not.toContain("@binding(10)");
      expect(wgsl).not.toContain("balloonLutTex");
      expect(wgsl).not.toContain("shade.flags & 2u");
      expect(wgsl).not.toContain("balloonIndex");
      if (overrides.groundPlane) {
        expect(wgsl).toContain("shade.balloonTint.z");
      } else {
        expect(wgsl).not.toContain("shade.balloonTint");
      }
      // `balloonTint` occurs ONLY as the ShadeParams declaration — a
      // uniform struct is one layout across every kernel, which is the
      // single deliberate exception to "balloon:false adds no text".
      const declared = wgsl.split("balloonTint").length - 1;
      if (!overrides.groundPlane) {
        expect(declared).toBe(wgsl.includes("struct ShadeParams") ? 2 : 0);
      }
    }
  });

  it("keeps every generated balloon kernel's braces and parens balanced across the core/mode matrix", () => {
    for (const core of ["fold", "affine", "affine4", "fold4"] as const) {
      for (const mode of ["eval", "march", "shade"] as const) {
        const wgsl = surfaceDeKernelWgsl(
          kernelOpts({ core, mode, width: 4, balloon: true }),
        );
        expect([...wgsl.matchAll(/\}/g)].length).toBe(
          [...wgsl.matchAll(/\{/g)].length,
        );
        expect([...wgsl.matchAll(/\)/g)].length).toBe(
          [...wgsl.matchAll(/\(/g)].length,
        );
      }
    }
  });
});

describe("groundPlane wrapper", () => {
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
    // The lens block (the balloon's frozen-offset move) is what puts the
    // plane block at the frozen offset 272 here.
    expect(wgsl).toContain("lensM0: vec3f,");
    expect(wgsl).toContain("groundY: f32,");
    expect(wgsl).toContain("groundAlbedo: vec3f,");
  });

  it("shade lights the PLANE status (4.0) through shadeGroundPlane, whose taps ride the width-1 probe exactly like the fractal's own shading taps", () => {
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
    expect(wgsl).toContain("let coc = surfaceCoc(dot(hp - ro, params.fwd));");
    expect(wgsl).toContain(
      "layerOut[ray] = packSurfaceLayer(ground.coverage, ground.fog, ground.coc);",
    );
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

  it("throws groundPlane+balloon (no horizon inside the shell), in both dimensions", () => {
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ groundPlane: true, balloon: true })),
    ).toThrow(/groundPlane\+balloon/);
    expect(() =>
      surfaceDeKernelWgsl(
        kernelOpts({ core: "affine4", groundPlane: true, balloon: true }),
      ),
    ).toThrow(/groundPlane\+balloon/);
  });

  it("composes with every 4D core, landing the plane block past the unconditionally-declared lens4 block", () => {
    for (const core of ["affine4", "fold4", "escape4"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, width: 12, groundPlane: true }),
      );
      const tail =
        core === "escape4" ? "padE4: array<vec4f, 6>," : "lens4Fold: vec4f";
      expect(wgsl.indexOf(tail)).toBeGreaterThan(0);
      expect(wgsl.indexOf("groundY: f32,")).toBeGreaterThan(wgsl.indexOf(tail));
      expect(wgsl).toContain("fn shadeGroundPlane(");
      const march = surfaceDeKernelWgsl(
        kernelOpts({ mode: "march", core, width: 12, groundPlane: true }),
      );
      expect(march).toContain("fn groundPlaneStatus(");
      expect(march).toContain("groundPlaneStatus(ro, rd)");
    }
  });

  it("packs the ground-plane block at the frozen 288..335 offsets, growing the buffer to SURFACE_GPU_PARAMS_PLANE_BYTES (336) without touching 0..287", () => {
    expect(SURFACE_GPU_PARAMS_PLANE_BYTES).toBe(336);
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
    expect(view.getFloat32(288, true)).toBe(Math.fround(gp.y));
    expect(view.getFloat32(292, true)).toBe(Math.fround(gp.fadeStart));
    expect(view.getFloat32(296, true)).toBe(Math.fround(gp.fadeEnd));
    expect(view.getFloat32(300, true)).toBe(Math.fround(gp.ballRadius));
    expect(view.getFloat32(304, true)).toBe(Math.fround(gp.ballCenter[0]));
    expect(view.getFloat32(308, true)).toBe(Math.fround(gp.ballCenter[1]));
    expect(view.getFloat32(312, true)).toBe(Math.fround(gp.ballCenter[2]));
    expect(view.getFloat32(320, true)).toBe(Math.fround(gp.albedo[0]));
    expect(view.getFloat32(324, true)).toBe(Math.fround(gp.albedo[1]));
    expect(view.getFloat32(328, true)).toBe(Math.fround(gp.albedo[2]));
  });

  it("omits the ground-plane 4th arg back to today's base-size packSurfaceGpuParams buffer, byte for byte", () => {
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
    expect(view.getFloat32(256, true)).toBe(Math.fround(de.kind));
    expect(view.getFloat32(260, true)).toBe(Math.fround(de.w));
    expect(view.getFloat32(288, true)).toBe(Math.fround(gp.y));
    expect(view.getFloat32(292, true)).toBe(Math.fround(gp.fadeStart));
    expect(view.getFloat32(296, true)).toBe(Math.fround(gp.fadeEnd));
    expect(view.getFloat32(300, true)).toBe(Math.fround(gp.ballRadius));
    expect(view.getFloat32(304, true)).toBe(Math.fround(gp.ballCenter[0]));
    expect(view.getFloat32(308, true)).toBe(Math.fround(gp.ballCenter[1]));
    expect(view.getFloat32(312, true)).toBe(Math.fround(gp.ballCenter[2]));
    expect(view.getFloat32(320, true)).toBe(Math.fround(gp.albedo[0]));
    expect(view.getFloat32(324, true)).toBe(Math.fround(gp.albedo[1]));
    expect(view.getFloat32(328, true)).toBe(Math.fround(gp.albedo[2]));
  });

  it("omits gp on packEscapeGpuParams back to today's base-size buffer, byte for byte", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const omitted = new Uint8Array(packEscapeGpuParams(de, { itemCount: 2 }));
    const explicit = new Uint8Array(
      packEscapeGpuParams(de, { itemCount: 2 }, null),
    );
    expect(omitted.byteLength).toBe(SURFACE_GPU_PARAMS_BYTES);
    expect(explicit).toEqual(omitted);
  });
});

describe("surfaceDeKernelWgsl per-slot finishes (finish)", () => {
  it("omitted and explicit finish:false produce identical source across every mode/core/variant — the byte-identical off state", () => {
    const cases: Partial<SurfaceGpuKernelOptions>[] = [
      // The lens/balloon/plane sweeps' own config lists, unioned…
      { mode: "eval", width: 12, sharedFrontier: true, bnbStage2: true },
      { mode: "eval", core: "affine", width: 4 },
      { mode: "eval", core: "escape", width: 4 },
      { mode: "march", width: 12 },
      { mode: "march", rays: "unproject", width: 12 },
      { mode: "march", rays: "unproject", width: 12, statusOut: true },
      { mode: "march", core: "affine" },
      { mode: "shade", width: 12 },
      { mode: "shade", width: 12, shadeDeWidth: 1 },
      { mode: "shade", core: "fold", lens: true },
      { mode: "shade", lens: true, width: 12, shadeDeWidth: 1, balloon: true },
      { mode: "shade", core: "escape" },
      { mode: "shade", core: "escape", groundPlane: true },
      { mode: "shade", core: "bulb" },
      // …and the 4D half, scoped up front (Dimensional Parity).
      { mode: "shade", core: "affine4" },
      { mode: "shade", core: "fold4", width: 12, shadeDeWidth: 1 },
      { mode: "shade", core: "escape4" },
      { mode: "shade", core: "affine4", balloon: true },
      { mode: "shade", core: "fold4", lens: true },
    ];
    for (const overrides of cases) {
      const omitted = surfaceDeKernelWgsl(kernelOpts(overrides));
      const explicit = surfaceDeKernelWgsl(
        kernelOpts({ ...overrides, finish: false }),
      );
      expect(explicit).toBe(omitted);
      expect(omitted).not.toContain("finishShade");
      expect(omitted).not.toContain("fSlot");
    }
  });

  it("is inert in march and eval modes — finish:true emits byte-identical source for every core (those kernels never read shadeMaps), so one options object builds a session's march and shade kernels", () => {
    const cores = [
      "fold",
      "affine",
      "escape",
      "bulb",
      "affine4",
      "fold4",
      "escape4",
    ] as const;
    for (const core of cores) {
      for (const mode of ["eval", "march"] as const) {
        const off = surfaceDeKernelWgsl(kernelOpts({ mode, core, width: 4 }));
        const on = surfaceDeKernelWgsl(
          kernelOpts({ mode, core, width: 4, finish: true }),
        );
        expect(on).toBe(off);
      }
    }
  });

  it("shade + finish emits exactly one finishShade with the fa/fb lane fetches, replacing the fixed lighting lines ahead of the fog", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, finish: true }),
    );
    expect(wgsl.split("fn finishShade(").length).toBe(2);
    expect(wgsl.indexOf("fn finishShade(")).toBeLessThan(
      wgsl.indexOf("fn shadeRays("),
    );
    expect(wgsl).toContain(
      "let fSlot = clamp(hi.firstChoice, 0, i32(params.mapCount) - 1);",
    );
    expect(wgsl).toContain("let fa = shadeMaps[fSlot * 3 + 1];");
    expect(wgsl).toContain("let fb = shadeMaps[fSlot * 3 + 2];");
    expect(wgsl).toContain(
      "var col = finishShade(base, n, rd, shadow, ao, bg, fa, fb);",
    );
    expect(wgsl).toContain("base = shadeMaps[fSlot * 3].rgb;");
    // REPLACED, not kept beside the call: the fixed specular literal and
    // the shade entry's own envTint block are gone (shadeGroundPlane keeps
    // its separate envTint — the floor's own matte formula).
    expect(wgsl).not.toContain("pow(max(dot(n, halfVec), 0.0), 32.0) * 0.4");
    // The fog lines after the call still read col/t/tEnter/bg.
    expect(wgsl).toContain(
      "let fog = 1.0 - exp(-0.12 * pow((t - tEnter) * params.fogDensity / max(visR, 1.0e-6), 2.0));",
    );
  });

  it("leaves NO stride-1 shadeMaps read behind under finish — every read site's index carries * 3, across cores and wrappers", () => {
    const cases: Partial<SurfaceGpuKernelOptions>[] = [
      { mode: "shade", width: 12, shadeDeWidth: 1 },
      { mode: "shade", core: "affine" },
      { mode: "shade", core: "escape" },
      { mode: "shade", core: "bulb" },
      { mode: "shade", core: "affine4" },
      { mode: "shade", core: "fold4", width: 12 },
      { mode: "shade", core: "escape4" },
      { mode: "shade", lens: true, width: 12 },
      { mode: "shade", core: "affine4", lens: true },
      { mode: "shade", balloon: true, width: 12 },
      { mode: "shade", groundPlane: true, width: 12 },
    ];
    for (const overrides of cases) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ ...overrides, finish: true }),
      );
      const reads = [...wgsl.matchAll(/shadeMaps\[([^\]]*)\]/g)];
      // Every shade kernel reads at least the two lanes + the map-color
      // base; the descent cores add their hit-info trap read.
      expect(reads.length).toBeGreaterThanOrEqual(3);
      for (const read of reads) {
        expect(read[1]).toContain("* 3");
      }
    }
  });

  it("composes with every core — no new throws, one finishShade each, braces balanced", () => {
    const cores = [
      "fold",
      "affine",
      "escape",
      "bulb",
      "affine4",
      "fold4",
      "escape4",
    ] as const;
    for (const core of cores) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, width: 4, finish: true }),
      );
      expect(wgsl.split("fn finishShade(").length).toBe(2);
      expect([...wgsl.matchAll(/\}/g)].length).toBe(
        [...wgsl.matchAll(/\{/g)].length,
      );
    }
  });

  it("composes with lens, balloon and groundPlane; the floor stays matte and the echo tint keeps its albedo-side ordering", () => {
    for (const extra of [
      { lens: true },
      { balloon: true },
      { groundPlane: true },
    ] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", width: 12, finish: true, ...extra }),
      );
      expect(wgsl).toContain("fn finishShade(");
      expect([...wgsl.matchAll(/\}/g)].length).toBe(
        [...wgsl.matchAll(/\{/g)].length,
      );
    }
    // Ground plane stays MATTE: the whole source holds the finishShade
    // definition plus exactly ONE call — the hit path's — so
    // shadeGroundPlane's "lighting minus specular" body never reaches it.
    const plane = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, groundPlane: true, finish: true }),
    );
    expect(plane.split("finishShade(").length).toBe(3);
    // Balloon: the echo tint mixes into `base` BEFORE finishShade reads
    // it, so a shell hit inherits its source map's finish over the tinted
    // albedo — balloonTint's ordering unchanged.
    const balloon = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, balloon: true, finish: true }),
    );
    const tintAt = balloon.indexOf("base = mix(base, shade.balloonTint");
    expect(tintAt).toBeGreaterThan(0);
    expect(tintAt).toBeLessThan(balloon.indexOf("finishShade(base, n, rd"));
  });

  it("keeps ShadeParams untouched — SURFACE_GPU_SHADE_BYTES stays 224 and the struct gains no member: the wire is the per-slot shadeMaps lane alone", () => {
    expect(SURFACE_GPU_SHADE_BYTES).toBe(224);
    const on = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, finish: true }),
    );
    const off = surfaceDeKernelWgsl(kernelOpts({ mode: "shade", width: 12 }));
    const struct = (src: string): string =>
      src.slice(
        src.indexOf("struct ShadeParams"),
        src.indexOf("}", src.indexOf("struct ShadeParams")) + 1,
      );
    expect(struct(on)).toBe(struct(off));
  });
});

describe("surfaceDeKernelWgsl independent pattern material gate", () => {
  const cores = [
    "fold",
    "affine",
    "escape",
    "bulb",
    "affine4",
    "fold4",
    "escape4",
  ] as const;

  it("keeps omitted and explicit pattern:false byte-identical across every core and mode", () => {
    for (const core of cores) {
      for (const mode of ["eval", "march", "shade"] as const) {
        const omitted = surfaceDeKernelWgsl(
          kernelOpts({ mode, core, width: 4 }),
        );
        const explicit = surfaceDeKernelWgsl(
          kernelOpts({ mode, core, width: 4, pattern: false }),
        );
        expect(explicit).toBe(omitted);
      }
    }
  });

  it("is structurally inert in march/eval while pattern-only shade uses stride 3 with fixed classic lighting", () => {
    for (const core of cores) {
      for (const mode of ["eval", "march"] as const) {
        const off = surfaceDeKernelWgsl(kernelOpts({ mode, core, width: 4 }));
        const on = surfaceDeKernelWgsl(
          kernelOpts({ mode, core, width: 4, pattern: true }),
        );
        expect(on).toBe(off);
      }

      const shade = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, width: 4, pattern: true }),
      );
      expect(shade).toContain(
        "let fSlot = clamp(hi.firstChoice, 0, i32(params.mapCount) - 1);",
      );
      expect(shade).toContain("let fa = shadeMaps[fSlot * 3 + 1];");
      expect(shade).toContain("let fb = shadeMaps[fSlot * 3 + 2];");
      expect(shade).toContain("base = shadeMaps[fSlot * 3].rgb;");
      expect(shade).not.toContain("fn finishShade(");
      expect(shade).toContain(
        "let specular = pow(max(dot(n, halfVec), 0.0), 32.0) * 0.4;",
      );
      for (const read of shade.matchAll(/shadeMaps\[([^\]]*)\]/g)) {
        expect(read[1]).toContain("* 3");
      }
    }
  });

  it("composes both gates without changing finish-only source when pattern is false", () => {
    const finishOnly = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, finish: true }),
    );
    expect(
      surfaceDeKernelWgsl(
        kernelOpts({
          mode: "shade",
          width: 12,
          finish: true,
          pattern: false,
        }),
      ),
    ).toBe(finishOnly);
    // With both gates on, the pattern arm joins the finish arm — one
    // finishShade call and one patternShade call, braces balanced.
    const combined = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "shade",
        width: 12,
        finish: true,
        pattern: true,
      }),
    );
    expect(combined).not.toBe(finishOnly);
    expect(combined.split("fn finishShade(")).toHaveLength(2);
    expect(combined.split("fn patternShade(")).toHaveLength(2);
    expect([...combined.matchAll(/\}/g)].length).toBe(
      [...combined.matchAll(/\{/g)].length,
    );
    // The document's order: colour source -> balloon tint -> pattern ->
    // lighting -> fog. The pattern call lands before the finishShade call.
    expect(combined.indexOf("base = patternShade(")).toBeLessThan(
      combined.indexOf("finishShade(base,"),
    );
  });

  it("grows ShadeParams to 240 only under shade + pattern — the frozen 224-byte layout otherwise", () => {
    expect(SURFACE_GPU_SHADE_BYTES).toBe(224);
    expect(SURFACE_GPU_SHADE_PATTERN_BYTES).toBe(240);
    const struct = (source: string): string =>
      source.slice(
        source.indexOf("struct ShadeParams"),
        source.indexOf("}", source.indexOf("struct ShadeParams")) + 1,
      );
    // Absent and pattern:false keep the 224-byte struct byte for byte.
    const off = surfaceDeKernelWgsl(kernelOpts({ mode: "shade", width: 12 }));
    const offExplicit = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, pattern: false }),
    );
    expect(struct(offExplicit)).toBe(struct(off));
    expect(off).not.toContain("patternCalibration");
    // Shade + pattern declares the calibration quartet at 224.
    const on = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, pattern: true }),
    );
    const onStruct = struct(on);
    expect(onStruct).toContain("patternCalibration: vec4f,");
    expect(onStruct.endsWith("patternCalibration: vec4f,\n}")).toBe(true);
    // Finish alone does not grow it.
    const finish = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, finish: true }),
    );
    expect(struct(finish)).toBe(struct(off));
    // A pattern-enabled MARCH kernel keeps the 224-byte struct: its text
    // must stay byte-identical under the flag, so the member is a
    // shade-only declaration.
    const march = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", rays: "unproject", width: 12 }),
    );
    const marchOn = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "march",
        rays: "unproject",
        width: 12,
        pattern: true,
      }),
    );
    expect(struct(marchOn)).toBe(struct(march));
  });

  it("splices ONE pattern body (the shared WGSL twin) into every shade kernel, pattern-only retaining the fixed classic lighting lines", () => {
    for (const core of cores) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, width: 4, pattern: true }),
      );
      expect(wgsl.split("fn patternShade(")).toHaveLength(2);
      // The shared body's marker functions, each exactly once.
      expect(wgsl.split("fn patternHash3(")).toHaveLength(2);
      expect(wgsl.split("fn patternFbm(")).toHaveLength(2);
      expect(wgsl.split("fn patternAlbedo(")).toHaveLength(2);
      // The pattern call reads the hit's material lane, the calibration
      // quartet, the sheets carrier and the tier-independent footprint.
      expect(wgsl).toContain(
        "base = patternShade(base, objectP, fb, shade.patternCalibration, hi.sheets, patternFootprint);",
      );
      // The classic lighting lines survive pattern-only.
      expect(wgsl).toContain(
        "let specular = pow(max(dot(n, halfVec), 0.0), 32.0) * 0.4;",
      );
      // Pattern-only never emits the parametric finish.
      expect(wgsl).not.toContain("fn finishShade(");
    }
  });

  it("routes the pattern source through the hit-info's source4 member with the frame-oracle reconstruction per core", () => {
    // The struct carries the raw attractor-frame source4 under the gate.
    const fold = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "fold", width: 4, pattern: true }),
    );
    expect(fold).toContain("source4: vec4f,");
    // 3D descent cores fill the final-applied query q — the GLSL
    // patternSource (balloon cpos / plain pos, then the affine final
    // inverse; identity under a fold final).
    expect(fold).toContain("info.source4 = vec4f(q, 0.0);");
    const affine = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine", width: 4, pattern: true }),
    );
    expect(affine).toContain("info.source4 = vec4f(q, 0.0);");
    // The FORWARD cores fill the plain hit (no final transform exists).
    const escape = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "escape", width: 4, pattern: true }),
    );
    expect(escape).toContain("info.source4 = vec4f(p, 0.0);");
    const bulb = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "bulb", width: 4, pattern: true }),
    );
    expect(bulb).toContain("info.source4 = vec4f(p, 0.0);");
    // The 4D descent cores re-lift the hit at its OWN w before the inverse
    // rotor and the affine final inverse — the oracle's lift-with-hitW
    // order (the sStar member places the hit along the segment).
    const affine4 = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine4", width: 4, pattern: true }),
    );
    expect(affine4).toContain(
      "info.source4 = finalApply4(rotorInvApply4(vec4f(p, params.w0 + info.sStar * params.sliceHalfW)));",
    );
    const fold4 = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "fold4", width: 4, pattern: true }),
    );
    expect(fold4).toContain(
      "info.source4 = finalApply4(rotorInvApply4(vec4f(p, params.w0 + info.sStar * params.sliceHalfW)));",
    );
    // escape4 lifts through the rotor alone (its slab is pinned 0 and no
    // final lens can exist on a forward chain; finalApply4 is not even
    // emitted for forward cores).
    const escape4 = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "escape4", width: 4, pattern: true }),
    );
    expect(escape4).toContain("info.source4 = liftEscape4(p);");
  });

  it("routes the 4D fold-final source as the winning branch tuple bestQ + sStar * bestExt — and the 3D balloon source through the core's own fill", () => {
    const fold4Lens = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "shade",
        core: "fold4",
        width: 4,
        lens: true,
        pattern: true,
      }),
    );
    expect(fold4Lens).toContain(
      "var hi = surfaceDEHitInfoCore(bestQ, bestExt, li);",
    );
    expect(fold4Lens).toContain("hi.source4 = bestQ + hi.sStar * bestExt;");
    // Without a slab the tuple collapses to the branch centre.
    const fold4LensNoSlab = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "shade",
        core: "fold4",
        width: 4,
        lens: true,
        slabExt: false,
        pattern: true,
      }),
    );
    expect(fold4LensNoSlab).toContain("hi.source4 = bestQ;");
    expect(fold4LensNoSlab).not.toContain("bestQ + hi.sStar");
    // The 3D lens core fills its own query (the winning branch bestQ with
    // the identity final), so the wrapper needs no pattern handoff — the
    // GLSL patternFoldLensSource value, produced in the core.
    const foldLens = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "shade",
        core: "fold",
        width: 4,
        lens: true,
        pattern: true,
      }),
    );
    expect(foldLens).toContain("info.source4 = vec4f(q, 0.0);");
    // The balloon wrapper needs no source4 edit either: the core call at
    // the winning term's own query fills it — colorPos after the final
    // inverse, exactly the GLSL `if (shell > 0.5) patternSource = cpos`.
    const balloon = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "shade",
        core: "fold",
        width: 4,
        balloon: true,
        pattern: true,
      }),
    );
    expect(balloon).toContain("info.source4 = vec4f(q, 0.0);");
    expect(balloon).toContain("source4: vec4f,");
  });

  it("normalizes the pattern source per dimension and pins the tier-independent footprint expression", () => {
    const fold = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "fold", width: 4, pattern: true }),
    );
    // 3D reuses the shared bound centre; 4D the implicit zero centre.
    expect(fold).toContain(
      "let objectP = (hi.source4.xyz - params.boundCenter) / params.boundingRadius;",
    );
    const escape4 = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "escape4", width: 4, pattern: true }),
    );
    expect(escape4).toContain(
      "let objectP = hi.source4.xyz / params.boundingRadius;",
    );
    // The footprint is the ACCEPTANCE epsilon at the hit depth — the
    // march's own params.pixelEps, which the host packs from the
    // native-height acceptPixelEps — normalized by the raw bounding
    // radius: the GLSL uAcceptPixelEps * t / uBoundingRadius twin, so
    // preview/settle tiers cannot change the material detail.
    for (const core of cores) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, width: 4, pattern: true }),
      );
      expect(wgsl).toContain(
        "let patternFootprint = params.pixelEps * t / params.boundingRadius;",
      );
    }
  });

  it("keeps the ground plane and the balloon echo tint outside the pattern arm, preserving the document's ordering", () => {
    const plane = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "shade",
        width: 12,
        groundPlane: true,
        pattern: true,
      }),
    );
    // The floor stays unpatterned: shadeGroundPlane never calls the
    // pattern helper (the hit path's call is the only one).
    expect(plane.split("base = patternShade(")).toHaveLength(2);
    expect(plane.indexOf("fn shadeGroundPlane")).toBeLessThan(
      plane.indexOf("fn patternShade("),
    );
    expect(
      plane.slice(
        plane.indexOf("fn shadeGroundPlane("),
        plane.indexOf("fn patternShade("),
      ),
    ).not.toContain("patternShade(");
    // Ordering: color source -> balloon palette -> tint -> pattern ->
    // lighting -> fog.
    const balloon = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", width: 12, balloon: true, pattern: true }),
    );
    expect(balloon.indexOf("balloonLutTex,")).toBeLessThan(
      balloon.indexOf("base = mix(base, shade.balloonTint"),
    );
    expect(balloon.indexOf("base = mix(base, shade.balloonTint")).toBeLessThan(
      balloon.indexOf("base = patternShade("),
    );
    expect(balloon.indexOf("base = patternShade(")).toBeLessThan(
      balloon.indexOf("let diffuse = max(dot(n, shade.lightDir), 0.0);"),
    );
    expect(
      balloon.indexOf("let diffuse = max(dot(n, shade.lightDir), 0.0);"),
    ).toBeLessThan(
      balloon.indexOf("let fog = 1.0 - exp(-0.12 * pow((t - tEnter)"),
    );
  });

  it("emits no source4 member, no pattern functions, and no calibration member when pattern is false", () => {
    for (const core of cores) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, width: 4 }),
      );
      expect(wgsl).not.toContain("source4");
      expect(wgsl).not.toContain("fn patternShade(");
      expect(wgsl).not.toContain("patternCalibration");
    }
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

describe("packEscapeGpuParams", () => {
  it("packs focusDepth at offset 92 without growing the base ABI", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const view = new DataView(
      packEscapeGpuParams(de, { itemCount: 1, focusDepth: 5.5 }),
    );
    expect(view.getFloat32(92, true)).toBe(Math.fround(5.5));
    expect(view.byteLength).toBe(SURFACE_GPU_PARAMS_BYTES);
  });

  it("returns an ArrayBuffer of exactly SURFACE_GPU_PARAMS_BYTES, the same struct size the fold/affine packer uses", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    const buf = packEscapeGpuParams(de, { itemCount: 1 });
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_BYTES);
  });

  it("packs the LINK COUNT at mapCount and the wedge fold's order/plane at symOrder/symPlane", () => {
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

  // The escape core shares the frozen block's offset-204
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
    expect(view.getFloat32(256, true)).toBe(Math.fround(de.kind));
    expect(view.getFloat32(260, true)).toBe(Math.fround(de.w));
    expect(view.getFloat32(264, true)).toBe(Math.fround(de.derivGrowth));
    // The quartet's tail is the chain-level estimate-form flag, 0 on a
    // fold-only chain (the row below is its 1 case).
    expect(view.getFloat32(268, true)).toBe(0);
  });

  it("packs logEstimate at offset 268 — 0 for a fold-only chain, 1 once a POWER link makes the escape super-exponential", () => {
    const folds = buildEscapeDE([canonicalMandelbox(), rotatedBoxfold()]);
    expect(folds.logEstimate).toBe(false);
    expect(
      new DataView(packEscapeGpuParams(folds, { itemCount: 1 })).getFloat32(
        268,
        true,
      ),
    ).toBe(0);

    for (const power of [bulbLink(), qsquareLink()]) {
      const chain = buildEscapeDE([canonicalMandelbox(), power]);
      expect(chain.logEstimate).toBe(true);
      expect(
        new DataView(packEscapeGpuParams(chain, { itemCount: 1 })).getFloat32(
          268,
          true,
        ),
      ).toBe(1);
    }
  });

  it("reads the flag off the CHAIN and not the head link — a fold head with a power tail still packs 1", () => {
    // The head link's own kind stays a fold at offset 256, so a packer
    // that derived the form from the flat (head-link) fields would read 0
    // here and the kernel would march the linear estimate under a
    // super-exponential orbit.
    const chain = buildEscapeDE([canonicalMandelbox(), bulbLink()]);
    const view = new DataView(packEscapeGpuParams(chain, { itemCount: 1 }));
    expect(view.getFloat32(256, true)).toBe(Math.fround(chain.links[0].kind));
    expect(view.getFloat32(256, true)).toBeLessThan(4);
    expect(view.getFloat32(268, true)).toBe(1);
  });
});

describe("packEscapeGpuMaps (the formula chain)", () => {
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
      expect(maps[base + 12]).toBe(link.kind);
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

  it("writes the POWER kinds 4 and 5 in the p0.x lane a fold link uses for 1/2/3 — one dispatch code space for the whole chain", () => {
    const de = buildEscapeDE([canonicalMandelbox(), bulbLink(), qsquareLink()]);
    const maps = packEscapeGpuMaps(de);
    const stride = SURFACE_GPU_MAP_VEC4 * 4;
    expect(maps[12]).toBe(ESCAPE_LINK_MANDELBOX);
    expect(maps[stride + 12]).toBe(ESCAPE_LINK_BULB);
    expect(maps[2 * stride + 12]).toBe(ESCAPE_LINK_QSQUARE);
    // A power link has no fold apparatus, and buildEscapeLink resolves the
    // CLASSIC lengths for it rather than zeros — so the lane a stray
    // sphere-fold read would divide by is never 0 (escape-de.ts's own
    // reason). Squared on the wire, like every other link's.
    expect(maps[stride + 24]).toBe(Math.fround(0.5 * 0.5));
    expect(maps[stride + 25]).toBe(1);
    expect(maps[stride + 26]).toBe(1);
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

describe("surfaceDeKernelWgsl escape core (core)", () => {
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
    // The formula chain rides the maps storage binding — one
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
    // fattens the set to 37.1% of the bailout ball at six links, against
    // cycling's 0.2%).
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
    // The CONTINUOUS escape count — the raw integer read as
    // confetti under a palette once the object stopped being a blob.
    // Normalized by the PASS budget and not the single-link step budget
    // (mirroring the GLSL arm): escapedAt counts single-link steps
    // and an orbit escapes after a handful of them however long the chain
    // is, so dividing by a budget that multiplies by the link count painted
    // a six-link chain inside the darkest fifth of its palette.
    expect(wgsl).toContain("(f32(escapedAt) - escFrac) / f32(params.maxDepth)");
    expect(wgsl).not.toContain("(f32(escapedAt) - escFrac) / f32(steps)");
    // Only the denominator moved: the loop bound and the escaped test stay
    // the per-link step budget.
    expect(wgsl).toContain("let steps = params.maxDepth * n;");
    expect(wgsl).toContain("if (escapedAt < steps) {");
    // The constant-factor arm is the fold family's, and the power links
    // moved it behind the power arm rather than changing it.
    expect(wgsl).toContain("} else if (growth > 1.0) {");
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

  it("guards the fold pair behind kind < 4u in BOTH bodies, and dispatches the two power maps past it", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "escape" }),
    );
    // The value body and the hit-info body each carry the guard: the fold
    // pair is exhaustive by NEGATION over {1, 2, 3}, so an unguarded kind
    // 4 satisfies both `!= 2u` and `!= 1u` and runs BOTH folds.
    expect(wgsl.split("if (kind < 4u) {").length).toBe(3);
    expect(wgsl.split("} else if (kind == 4u) {").length).toBe(3);
    // The triplex power's local factor and the quaternion square's, in the
    // value body only — the hit-info body tracks no dr (colors-only).
    expect(wgsl).toContain("localL = 8.0 * (r2y * r2y * r2y * sqrt(r2y));");
    expect(wgsl).toContain("localL = 2.0 * length(y);");
    expect(wgsl.split("y = bulbPow8(").length).toBe(3);
    expect(
      wgsl.split(
        "y = vec3f(y.x * y.x - y.y * y.y - y.z * y.z, 2.0 * y.x * y.y, 2.0 * y.x * y.z);",
      ).length,
    ).toBe(3);
  });

  it("reads the chain's estimate form off escParams.w — linear r/dr at 0, the Böttcher form at 1, with the inside exit below r = 1", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "escape" }),
    );
    expect(wgsl).toContain(
      "if (params.escParams.w == 0.0) {\n    return r / dr;",
    );
    // `ln r` is negative below 1 and a negative estimate marches the
    // tracer backwards, so the converging orbit's exit is 0 — the bulb
    // core's identical closing pair.
    expect(wgsl).toContain("if (r <= 1.0) {\n    return 0.0;\n  }");
    expect(wgsl).toContain("return 0.5 * r * log(r) / dr;");
  });

  it("picks the trap's interpolant by the DEGREE of the link that produced the terminal radius", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "escape" }),
    );
    // 0 for a fold — asymptotically affine, no exponent to multiply — so a
    // fold-only chain still reads the constant-factor arm at every step.
    expect(wgsl).toContain("var lastPower = 0.0;");
    expect(wgsl).toContain(
      "lastPower = select(select(0.0, 2.0, kind == 5u), 8.0, kind == 4u);",
    );
    // The power arm is the bulb core's own expression with the link's
    // degree in place of its baked-in 8. A pre-scaled power link has
    // growth < 1, so without it the constant-factor guard fires and the
    // trap degenerates to the raw integer step function.
    expect(wgsl).toContain(
      "escFrac = clamp(log(log(r) / log(params.boundingRadius)) / log(lastPower), 0.0, 1.0);",
    );
  });

  it("emits ONE bulbPow8, character for character the bulb core's — the escape chain's kind-4 link and the bulb core share the definition rather than copying it", () => {
    const grab = (src: string): string => {
      const start = src.indexOf("fn bulbPow8(");
      expect(start).toBeGreaterThan(-1);
      return src.slice(start, src.indexOf("\n}", start) + 2);
    };
    const escape = surfaceDeKernelWgsl(kernelOpts({ core: "escape" }));
    const bulb = surfaceDeKernelWgsl(kernelOpts({ core: "bulb" }));
    expect(escape.split("fn bulbPow8(").length).toBe(2);
    expect(bulb.split("fn bulbPow8(").length).toBe(2);
    expect(grab(escape)).toBe(grab(bulb));
  });

  it("emits it even when no link could be a power map — the source is memoized on the CODEGEN CONFIG, so the chain's contents must not reach the text", () => {
    // Dead code the compiler drops. Narrowing it to chains that carry a
    // kind-4 link would key two different kernels to one cache entry,
    // which is why the emission is unconditional for this core.
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "eval", core: "escape" }),
    );
    expect(wgsl).toContain("fn bulbPow8(");
  });

  it("leaves the DESCENT cores' source untouched — no bulbPow8 anywhere in an affine or fold kernel", () => {
    for (const core of ["affine", "fold", "affine4", "fold4"] as const) {
      for (const mode of ["eval", "march", "shade"] as const) {
        const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode, core }));
        expect(wgsl).not.toContain("bulbPow8");
        expect(wgsl).not.toContain("kind < 4u");
      }
    }
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

/** `bulbPow8`'s emitted WGSL, FROZEN — character for character the text
 * that lived inside `bulbDescentText` before the power links hoisted it
 * out to be shared with the escape chain's kind-4 link. Frozen here for
 * the reason `escape-de.test.ts` freezes a copy of the single-map loop:
 * the hoist's whole
 * claim is that it moved the text and changed nothing in it, and a claim
 * about bytes needs the bytes written down. `variations.ts`'s
 * `triplexPow8` is the definition both of them mirror; an edit that is
 * genuinely intended lands here too, deliberately. */
const BULB_POW8_WGSL = `// variations.ts's triplexPow8, the White/Nylander 8th power in its
// trig-free form: Chebyshev T8/U7 for the polar angle, three complex
// squarings (de Moivre) for the azimuth. The power is BAKED IN — triplex
// multiplication is not associative, so p^8 is not ((p^2)^2)^2 and every
// power needs its own closed form (bulb-de.ts's BULB_POWER doc). r2 is
// passed in because every caller already has it.
fn bulbPow8(y: vec3f, r2: f32) -> vec3f {
  let a = y.x * y.x + y.y * y.y;
  let z2 = y.z * y.z;
  let r4 = r2 * r2;
  let vz = 128.0 * z2 * z2 * z2 * z2 - 256.0 * z2 * z2 * z2 * r2 + 160.0 * z2 * z2 * r4 - 32.0 * z2 * r4 * r2 + r4 * r4;
  let s = 128.0 * z2 * z2 * z2 * y.z - 192.0 * z2 * z2 * y.z * r2 + 80.0 * z2 * y.z * r4 - 8.0 * y.z * r4 * r2;
  let rho = sqrt(a);
  var inv = 0.0;
  if (rho > 0.0) {
    inv = 1.0 / rho;
  }
  let u1 = y.x * inv;
  let v1 = y.y * inv;
  let u2 = u1 * u1 - v1 * v1;
  let v2 = 2.0 * u1 * v1;
  let u4 = u2 * u2 - v2 * v2;
  let v4 = 2.0 * u2 * v2;
  let u8 = u4 * u4 - v4 * v4;
  let v8 = 2.0 * u4 * v4;
  return vec3f(rho * s * u8, rho * s * v8, vz);
}`;

describe("bulbPow8 emission and declaration order", () => {
  it("declares it before every call site in both FORWARD cores — WGSL has no forward declarations, so a body emitted in the wrong order is a compile error a GPU run would be the first to find", () => {
    // The shipped order is headerText, then bodyBlock (which carries the
    // descent text and therefore the definition), then the shade entry
    // (which carries the hit-info that calls it) — so the definition
    // precedes every use structurally. This pins that rather than trusting
    // the assembly to stay in that order.
    const callSites: Record<string, number> = {
      eval: 1,
      march: 1,
      // Two: the value body's kind-4 branch AND the hit-info's.
      shade: 2,
    };
    for (const core of ["escape", "bulb"] as const) {
      for (const mode of ["eval", "march", "shade"] as const) {
        const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode, core }));
        const declAt = wgsl.indexOf("fn bulbPow8(") + "fn ".length;
        expect(declAt).toBeGreaterThan("fn ".length - 1);
        // Exactly ONE definition, which is what the hoist bought.
        expect(wgsl.split("fn bulbPow8(").length).toBe(2);

        const uses = [...wgsl.matchAll(/bulbPow8\(/g)].map((m) => m.index);
        // The definition's own occurrence is the FIRST one in the source.
        expect(uses[0]).toBe(declAt);
        expect(uses.length - 1).toBe(callSites[mode]);
        for (const at of uses.slice(1)) {
          expect(at).toBeGreaterThan(declAt);
        }
      }
    }
  });

  it("emits neither the definition nor a call in ANY descent core — the catch for an emission that stopped being conditional", () => {
    for (const core of ["affine", "fold", "affine4", "fold4"] as const) {
      for (const mode of ["eval", "march", "shade"] as const) {
        const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode, core }));
        expect(wgsl.split("fn bulbPow8(").length - 1).toBe(0);
        expect([...wgsl.matchAll(/bulbPow8\(/g)].length).toBe(0);
      }
    }
  });

  it("emits the FROZEN text byte for byte in both cores — the hoist moved it and changed nothing in it", () => {
    for (const core of ["escape", "bulb"] as const) {
      expect(surfaceDeKernelWgsl(kernelOpts({ core }))).toContain(
        BULB_POW8_WGSL,
      );
    }
  });

  it("leaves the bulb descent body's own seam where it was — definition, blank line, descent, exactly as when the text was inline", () => {
    // With the text itself frozen above, this is what makes "core: 'bulb'
    // is byte-identical to the pre-hoist source" a pinned claim rather
    // than a measurement someone took once: the only thing an interpolation
    // could plausibly change is the join, and the join is asserted here.
    expect(surfaceDeKernelWgsl(kernelOpts({ core: "bulb" }))).toContain(
      `${BULB_POW8_WGSL}\n\nfn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {`,
    );
  });
});

describe("surfaceDeKernelWgsl affine4 core (core)", () => {
  it("accepts a fold-final lens — descendLens4's sweep around the REFINED ladder", () => {
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
    // OWN w: hit-info's sStar places it along the slab
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

describe("surfaceDeKernelWgsl affine4 slab half-extent (slabExt, the register-pressure probe)", () => {
  it("defaults to true: explicit and omitted produce identical eval-mode source", () => {
    const omitted = surfaceDeKernelWgsl(kernelOpts({ core: "affine4" }));
    const explicit = surfaceDeKernelWgsl(
      kernelOpts({ core: "affine4", slabExt: true }),
    );
    expect(explicit).toBe(omitted);
  });

  it("false strips the half-extent machinery from the eval-mode descent (fn refinedCert / fn surfaceDE), leaving the shared segmentRadius4 helper declared but uncalled", () => {
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

  it("threads the slab hit's own w into the radius color: slab shade updates info.sStar per level, noslab keeps the constructor's 0", () => {
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

describe("surfaceDeKernelWgsl 4D maps address space (mapsUniform, the maps-load probe)", () => {
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

describe("surfaceDeKernelWgsl fold4 core (core)", () => {
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
    // radius through the slab hit's own w, the greedy chain's
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

  it("emits the narrow shading probe from the same body at the probe width, with no index helper to rename (both frontiers are function-scope)", () => {
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

describe("surfaceDeKernelWgsl fold4 slab half-extent (slabExt)", () => {
  it("defaults to true: explicit and omitted produce identical eval-mode source", () => {
    const omitted = surfaceDeKernelWgsl(kernelOpts({ core: "fold4" }));
    const explicit = surfaceDeKernelWgsl(
      kernelOpts({ core: "fold4", slabExt: true }),
    );
    expect(explicit).toBe(omitted);
  });

  it("false strips the half-extent machinery from the eval-mode descent, leaving the shared segmentRadius4 helper declared but uncalled", () => {
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

  it("threads the slab hit's own w into the radius color: slab shade updates info.sStar per level, noslab keeps the constructor's 0", () => {
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

describe("surfaceDeKernelWgsl 4D fold-lens wrapper (lens)", () => {
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

  it("hands the REFINED core the march-epsilon inner cutoff and the PLAIN core cutoff 0 — descendLens4's `refine ? innerCutoff : 0` seam", () => {
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

  it("threads the slab segment through the branch transport under slabExt, and drops it entirely without", () => {
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

/** Two-map 4D system whose BASE maps FOLD — the 3D
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

/** A boxfold FINAL lens over a 4D base — the 4D lens archetype,
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

describe("packSurface4GpuParams", () => {
  it("packs focusDepth at offset 92 without growing the base 4D ABI", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const view = new DataView(
      packSurface4GpuParams(de, view4(), {
        itemCount: 1,
        focusDepth: 6.75,
      }),
    );
    expect(view.getFloat32(92, true)).toBe(Math.fround(6.75));
    expect(view.byteLength).toBe(SURFACE_GPU_PARAMS4_BYTES);
  });

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

  // The 4D cores share the frozen block's offset-204 fogDensity
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

describe("packSurface4GpuParams fold-final lens block", () => {
  it("keeps the 464-byte buffer without a foldFinal and grows to SURFACE_GPU_PARAMS4_LENS_BYTES with one", () => {
    expect(SURFACE_GPU_PARAMS4_LENS_BYTES).toBe(576);
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

  it("round-trips SurfaceDE4.radiusBand at 432..455 — center, minD, the shared radiusBandInvRange, zero spares", () => {
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

describe("packSurfaceGpuMaps4", () => {
  it("packs each map's invM rows / invT / p0 fold lanes / bnb / p1 at the documented word offsets, per SURFACE_GPU_MAP4_VEC4 stride", () => {
    // Grown 6 -> 8 by the 4D fold-branch sweep: ONE layout for both 4D cores,
    // exactly as the 3D GpuMap carries fold lanes the affine core never
    // reads. Then 8 -> 9 by the authored-lengths `fold` lane, the 3D one verbatim.
    expect(SURFACE_GPU_MAP4_VEC4).toBe(9);
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
 * mutation that shipped undetected one object over. */
function scaledBulb(): Transform {
  return {
    id: 0,
    position: [0.12, -0.05, 0.08],
    rotation: [0.3, 0.2, -0.1],
    scale: [1.3, 1.3, 1.3],
    variations: [{ type: "bulb", weight: 1 }],
  };
}

describe("packBulbGpuParams", () => {
  it("packs focusDepth at offset 92 without growing the base ABI", () => {
    const de = buildBulbDE([canonicalBulb()]);
    const view = new DataView(
      packBulbGpuParams(de, { itemCount: 1, focusDepth: 7.25 }),
    );
    expect(view.getFloat32(92, true)).toBe(Math.fround(7.25));
    expect(view.byteLength).toBe(SURFACE_GPU_PARAMS_BYTES);
  });

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

  it("appends the ground-plane block past the bulb variant block, and omitting it returns the base-size buffer byte for byte", () => {
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
    expect(view.getFloat32(288, true)).toBe(Math.fround(gp.y));
    expect(view.getFloat32(300, true)).toBe(Math.fround(gp.ballRadius));
    expect(view.getFloat32(320, true)).toBe(Math.fround(gp.albedo[0]));

    expect(
      new Uint8Array(packBulbGpuParams(de, { itemCount: 2 }, null)),
    ).toEqual(plain);
  });
});

describe("surfaceDeKernelWgsl bulb core (core)", () => {
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

// -----------------------------------------------------------------------
// The ESCAPE4 core's packers -- packEscape4GpuParams/
// packEscape4GpuMaps, `core: "escape4"`'s wire one dimension up from the
// 3D escape packers above. Fixtures mirror escape-de-4d.test.ts's own
// (duplicated per this file's DAMP convention -- test files stay isolated
// from one another).
// -----------------------------------------------------------------------

/** The 4D escape-time family's canonical single-map Mandelbox
 * (escape-de-4d.test.ts's own canonicalMandelbox() shape) -- non-contracting
 * at the classic weight, so it is this render mode's on every gate it
 * reaches. */
function escape4Mandelbox(overrides: Partial<Transform> = {}): Transform {
  return {
    id: 0,
    position: [0.4, 0.3, 0.2],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight: 2 }],
    ...overrides,
  };
}

/** A second, DIFFERENT link for the escape4 chain fixtures: a rotated
 * boxfold carrying a genuine w-mixing rotation, so the chain reaches out of
 * the w = 0 hyperplane (the point of this render mode) and a packer that
 * wrote the head link n times (or read slot 0 every step) could not pass. */
function escape4RotatedBoxfold(): Transform {
  return {
    id: 1,
    position: [0, 0, 0],
    rotation: [0, 0.35, 0],
    scale: [1, 1, 1],
    variations: [{ type: "boxfold", weight: 1.6 }],
    w: { position: 0.2, rotation: { xw: 0.25 } },
  };
}

/** The quaternion-square link -- EscapeLinkKind 5, chained behind
 * escape4Mandelbox() below the lone-power-map refusal, at the pre-scale
 * escape-de.ts's own POWER LINKS table measures a renderable object at. */
function escape4QsquareLink(): Transform {
  return {
    id: 3,
    position: [0.1, 0, -0.05],
    rotation: [0, 0, 0],
    scale: [0.4, 0.4, 0.4],
    variations: [{ type: "qsquare", weight: 1 }],
  };
}

describe("packEscape4GpuParams byte length", () => {
  it("returns SURFACE_GPU_PARAMS4_ESCAPE_BYTES (576) without a ground plane and SURFACE_GPU_PARAMS4_PLANE_BYTES (624) with one", () => {
    expect(SURFACE_GPU_PARAMS4_ESCAPE_BYTES).toBe(576);
    expect(SURFACE_GPU_PARAMS4_PLANE_BYTES).toBe(624);
    const de = buildEscapeDE4([escape4Mandelbox(), escape4RotatedBoxfold()]);
    const plain = packEscape4GpuParams(de, view4(), { itemCount: 1 });
    expect(plain).toBeInstanceOf(ArrayBuffer);
    expect(plain.byteLength).toBe(SURFACE_GPU_PARAMS4_ESCAPE_BYTES);
    const gp: SurfaceGpuGroundPlane = {
      y: 0,
      fadeStart: 1,
      fadeEnd: 2,
      ballCenter: [0, 0, 0],
      ballRadius: 1,
      albedo: [1, 1, 1],
    };
    const withPlane = packEscape4GpuParams(de, view4(), { itemCount: 1 }, gp);
    expect(withPlane.byteLength).toBe(SURFACE_GPU_PARAMS4_PLANE_BYTES);
  });
});

describe("packEscape4GpuParams frozen-block scalars", () => {
  it("packs focusDepth at offset 92 without growing the escape4 ABI", () => {
    const de = buildEscapeDE4([escape4Mandelbox(), escape4RotatedBoxfold()]);
    const view = new DataView(
      packEscape4GpuParams(de, view4(), {
        itemCount: 1,
        focusDepth: 8.5,
      }),
    );
    expect(view.getFloat32(92, true)).toBe(Math.fround(8.5));
    expect(view.byteLength).toBe(SURFACE_GPU_PARAMS4_ESCAPE_BYTES);
  });

  it("packs the bailout ball at boundingRadius (12), escapeRadius as 2R (16), ESCAPE_STEP_SCALE (20), the link count at mapCount (48) and maxDepth (52, overridable by run.maxDepth)", () => {
    const de = buildEscapeDE4([escape4Mandelbox(), escape4RotatedBoxfold()]);
    const view = new DataView(
      packEscape4GpuParams(de, view4(), { itemCount: 1 }),
    );
    expect(view.getFloat32(12, true)).toBe(Math.fround(de.boundingRadius));
    expect(view.getFloat32(16, true)).toBe(Math.fround(de.boundingRadius * 2));
    expect(view.getFloat32(20, true)).toBe(Math.fround(ESCAPE_STEP_SCALE));
    expect(view.getUint32(48, true)).toBe(de.links.length);
    expect(view.getUint32(48, true)).toBe(2);
    expect(view.getUint32(52, true)).toBe(ESCAPE_TIME_ITERATIONS);

    const clamped = new DataView(
      packEscape4GpuParams(de, view4(), { itemCount: 1, maxDepth: 12 }),
    );
    expect(clamped.getUint32(52, true)).toBe(12);
  });

  it("packs the slice-adjusted radius at offset 24 as sqrt(R^2 - w0^2) for a nonzero w0", () => {
    const de = buildEscapeDE4([escape4Mandelbox(), escape4RotatedBoxfold()]);
    const R = de.boundingRadius;
    const w0 = 0.3 * R;
    const view = new DataView(
      packEscape4GpuParams(de, view4({ w0 }), { itemCount: 1 }),
    );
    expect(view.getFloat32(24, true)).toBe(
      Math.fround(Math.sqrt(R * R - w0 * w0)),
    );
  });

  it("packs symOrder at 40 and symPlane at 44 in SYM_PLANE_CODE4's six-plane code -- a w-plane packs its own code, not the descents' collapsed 0", () => {
    expect(SYM_PLANE_CODE4.xw).toBe(3);
    const chain = [escape4Mandelbox(), escape4RotatedBoxfold()];
    const de = buildEscapeDE4(chain, null, { order: 5, plane: "xw" });
    const view = new DataView(
      packEscape4GpuParams(de, view4(), { itemCount: 1 }),
    );
    expect(view.getUint32(40, true)).toBe(5);
    expect(view.getUint32(44, true)).toBe(3);
  });

  it("packs w0 (416), sliceHalfW as 0 (420, a forward orbit cannot thread a segment), visRadius4 as R (428) and radiusInvRange as 1/R (452)", () => {
    const de = buildEscapeDE4([escape4Mandelbox(), escape4RotatedBoxfold()]);
    const R = de.boundingRadius;
    const view = new DataView(
      packEscape4GpuParams(de, view4({ w0: 0.37 }), { itemCount: 1 }),
    );
    expect(view.getFloat32(416, true)).toBe(Math.fround(0.37));
    expect(view.getFloat32(420, true)).toBe(0);
    expect(view.getFloat32(428, true)).toBe(Math.fround(R));
    expect(view.getFloat32(452, true)).toBe(Math.fround(1 / R));
  });

  it("packs logEstimate at offset 464 -- 0 for a fold-only chain, 1 once a qsquare link is present", () => {
    const folds = buildEscapeDE4([escape4Mandelbox(), escape4RotatedBoxfold()]);
    expect(folds.logEstimate).toBe(false);
    expect(
      new DataView(
        packEscape4GpuParams(folds, view4(), { itemCount: 1 }),
      ).getFloat32(464, true),
    ).toBe(0);

    const withPower = buildEscapeDE4([
      escape4Mandelbox(),
      escape4QsquareLink(),
    ]);
    expect(withPower.logEstimate).toBe(true);
    expect(
      new DataView(
        packEscape4GpuParams(withPower, view4(), { itemCount: 1 }),
      ).getFloat32(464, true),
    ).toBe(1);
  });
});

describe("packEscape4GpuParams stepBack4/final4M identity and the rotor transpose", () => {
  it("packs stepBack4 (272..335) and final4M (336..399) as identity -- no sector sweep, no lens", () => {
    const de = buildEscapeDE4([escape4Mandelbox(), escape4RotatedBoxfold()]);
    const view = new DataView(
      packEscape4GpuParams(de, view4(), { itemCount: 1 }),
    );
    for (const base of [272, 336]) {
      for (let r = 0; r < 4; r++) {
        expect(view.getFloat32(base + r * 20, true)).toBe(1); // diagonal
      }
      // A sample of off-diagonal entries: zero-init, never written.
      expect(view.getFloat32(base + 4, true)).toBe(0);
      expect(view.getFloat32(base + 8, true)).toBe(0);
      expect(view.getFloat32(base + 16, true)).toBe(0);
    }
  });

  it("packs the rotor rows at 208..271 as the TRANSPOSE of the passed row-major rotor", () => {
    const de = buildEscapeDE4([escape4Mandelbox(), escape4RotatedBoxfold()]);
    // Sixteen distinct values so a row/column mixup cannot hide behind a
    // repeated entry -- the same recipe packSurface4GpuParams's own rotor
    // test uses.
    const rotor = Array.from({ length: 16 }, (_, i) => i + 1);
    const view = new DataView(
      packEscape4GpuParams(de, view4({ rotor }), { itemCount: 1 }),
    );
    for (let i = 0; i < 4; i++) {
      const at = 208 + i * 16;
      expect(view.getFloat32(at, true)).toBe(rotor[i]);
      expect(view.getFloat32(at + 4, true)).toBe(rotor[4 + i]);
      expect(view.getFloat32(at + 8, true)).toBe(rotor[8 + i]);
      expect(view.getFloat32(at + 12, true)).toBe(rotor[12 + i]);
    }
  });
});

describe("packEscape4GpuParams slab refusal and ground-plane block", () => {
  it("throws for a nonzero sliceHalfW -- a forward orbit cannot thread a segment", () => {
    const de = buildEscapeDE4([escape4Mandelbox(), escape4RotatedBoxfold()]);
    expect(() =>
      packEscape4GpuParams(de, view4({ sliceHalfW: 0.05 }), { itemCount: 1 }),
    ).toThrow(/slab/);
    expect(() =>
      packEscape4GpuParams(de, view4({ sliceHalfW: 0 }), { itemCount: 1 }),
    ).not.toThrow();
  });

  it("lands the ground-plane block at 576..623 without disturbing 0..575", () => {
    const de = buildEscapeDE4([escape4Mandelbox(), escape4RotatedBoxfold()]);
    const gp: SurfaceGpuGroundPlane = {
      y: 0.125,
      fadeStart: 1.5,
      fadeEnd: 4.5,
      ballCenter: [0.25, -0.5, 0.75],
      ballRadius: 1.25,
      albedo: [0.375, 0.625, 0.875],
    };
    const plain = new Uint8Array(
      packEscape4GpuParams(de, view4(), { itemCount: 4 }),
    );
    const buf = packEscape4GpuParams(de, view4(), { itemCount: 4 }, gp);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS4_PLANE_BYTES);
    expect(new Uint8Array(buf, 0, SURFACE_GPU_PARAMS4_ESCAPE_BYTES)).toEqual(
      plain,
    );
    const view = new DataView(buf);
    expect(view.getFloat32(576, true)).toBe(Math.fround(gp.y));
    expect(view.getFloat32(580, true)).toBe(Math.fround(gp.fadeStart));
    expect(view.getFloat32(584, true)).toBe(Math.fround(gp.fadeEnd));
    expect(view.getFloat32(588, true)).toBe(Math.fround(gp.ballRadius));
    expect(view.getFloat32(592, true)).toBe(Math.fround(gp.ballCenter[0]));
    expect(view.getFloat32(596, true)).toBe(Math.fround(gp.ballCenter[1]));
    expect(view.getFloat32(600, true)).toBe(Math.fround(gp.ballCenter[2]));
    expect(view.getFloat32(608, true)).toBe(Math.fround(gp.albedo[0]));
    expect(view.getFloat32(612, true)).toBe(Math.fround(gp.albedo[1]));
    expect(view.getFloat32(616, true)).toBe(Math.fround(gp.albedo[2]));
  });
});

describe("packEscape4GpuMaps", () => {
  it("packs one 36-float GpuMap4 stride per link: 16 forward matrix entries, translation at 16..19, (kind, w, derivGrowth) at 20..22, squared radii + wall at 32..34, every other lane 0", () => {
    const de = buildEscapeDE4([escape4Mandelbox(), escape4RotatedBoxfold()]);
    const stride = SURFACE_GPU_MAP4_VEC4 * 4;
    expect(stride).toBe(36);
    const maps = packEscape4GpuMaps(de);
    expect(maps.length).toBe(2 * stride);
    de.links.forEach((link, j) => {
      const base = j * stride;
      for (let i = 0; i < 16; i++) {
        expect(maps[base + i]).toBe(Math.fround(link.m[i]));
      }
      expect(maps[base + 16]).toBe(Math.fround(link.t[0]));
      expect(maps[base + 17]).toBe(Math.fround(link.t[1]));
      expect(maps[base + 18]).toBe(Math.fround(link.t[2]));
      expect(maps[base + 19]).toBe(Math.fround(link.t[3]));
      expect(maps[base + 20]).toBe(link.kind);
      expect(maps[base + 21]).toBe(Math.fround(link.w));
      expect(maps[base + 22]).toBe(Math.fround(link.derivGrowth));
      expect(maps[base + 32]).toBe(Math.fround(link.minRadius2));
      expect(maps[base + 33]).toBe(Math.fround(link.fixedRadius2));
      expect(maps[base + 34]).toBe(Math.fround(link.boxLimit));
      // Every other lane -- 23..31 and 35 -- is 0: the "one layout, lanes
      // a core may ignore" contract the 4D descent cores already ride.
      for (const lane of [23, 24, 25, 26, 27, 28, 29, 30, 31, 35]) {
        expect(maps[base + lane]).toBe(0);
      }
    });
  });

  it("keeps the links DISTINCT -- a chain of two different links (a fold and a POWER map) packs two different strides", () => {
    const de = buildEscapeDE4([escape4Mandelbox(), escape4QsquareLink()]);
    const maps = packEscape4GpuMaps(de);
    const stride = SURFACE_GPU_MAP4_VEC4 * 4;
    const head = Array.from(maps.slice(0, stride));
    const tail = Array.from(maps.slice(stride, 2 * stride));
    expect(head).not.toEqual(tail);
    expect(maps[20]).not.toBe(maps[stride + 20]);
  });

  it("pads to one zero stride rather than an empty array, like packEscapeGpuMaps", () => {
    const de = buildEscapeDE4([escape4Mandelbox(), escape4RotatedBoxfold()]);
    const empty = packEscape4GpuMaps({ ...de, links: [] });
    const stride = SURFACE_GPU_MAP4_VEC4 * 4;
    expect(empty.length).toBe(stride);
    expect(Array.from(empty)).toEqual(new Array(stride).fill(0));
  });
});

// -----------------------------------------------------------------------
// packSurface4GpuParams's balloon/groundPlane blocks --
// the 3D packer's frozen-288 pair (packSurfaceGpuParams's balloon/
// groundPlane describes above) one dimension up, appended at the frozen
// 576.
// -----------------------------------------------------------------------

describe("packSurface4GpuParams balloon/groundPlane blocks", () => {
  it("passing neither balloon nor groundPlane reproduces today's buffer byte for byte, no-lens and lensed alike", () => {
    const cases: [SurfaceDE4, number][] = [
      [buildSurfaceDE4(fourDSystemTransforms()), SURFACE_GPU_PARAMS4_BYTES],
      [
        buildSurfaceDE4(fourDSystemTransforms(), fourDBoxfoldFinalTransform()),
        SURFACE_GPU_PARAMS4_LENS_BYTES,
      ],
    ];
    for (const [de, expectedSize] of cases) {
      const omitted = new Uint8Array(
        packSurface4GpuParams(de, view4(), { itemCount: 5 }),
      );
      const explicit = new Uint8Array(
        packSurface4GpuParams(de, view4(), { itemCount: 5 }, null, null),
      );
      expect(omitted.byteLength).toBe(expectedSize);
      expect(explicit).toEqual(omitted);
    }
  });

  it("packs the balloon block at the frozen 576..607 offsets, growing the buffer to SURFACE_GPU_PARAMS4_BALLOON_BYTES (608), with the no-lens lens4 region (464..575) zero-filled and 0..463 otherwise untouched", () => {
    expect(SURFACE_GPU_PARAMS4_BALLOON_BYTES).toBe(608);
    const de = buildSurfaceDE4(fourDSystemTransforms());
    expect(de.foldFinal).toBeNull();
    const ball = balloonBall4(de);
    const b = buildBalloon4(de, 1.6);
    const balloon = {
      center: b.center,
      rho: b.rho,
      R: b.R,
      far: BALLOON_FAR_CAP_RHO * ball.radius,
    };
    const plain = new Uint8Array(
      packSurface4GpuParams(de, view4(), { itemCount: 7 }),
    );
    const buf = packSurface4GpuParams(de, view4(), { itemCount: 7 }, balloon);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS4_BALLOON_BYTES);
    expect(new Uint8Array(buf, 0, SURFACE_GPU_PARAMS4_BYTES)).toEqual(plain);
    // The lens4 region (464..575) is zero-filled for a no-lens DE -- what
    // keeps the balloon block's offset frozen at 576 whether or not a lens
    // is present (pinned directly, not just implied by the byte length).
    const lens4Region = new Uint8Array(
      buf,
      SURFACE_GPU_PARAMS4_BYTES,
      SURFACE_GPU_PARAMS4_LENS_BYTES - SURFACE_GPU_PARAMS4_BYTES,
    );
    expect(lens4Region).toEqual(new Uint8Array(lens4Region.length));
    const view = new DataView(buf);
    expect(view.getFloat32(576, true)).toBe(Math.fround(b.center[0]));
    expect(view.getFloat32(580, true)).toBe(Math.fround(b.center[1]));
    expect(view.getFloat32(584, true)).toBe(Math.fround(b.center[2]));
    expect(view.getFloat32(588, true)).toBe(Math.fround(b.rho));
    expect(view.getFloat32(592, true)).toBe(Math.fround(b.R));
    expect(view.getFloat32(596, true)).toBe(Math.fround(balloon.far));
  });

  it("keeps its lens4 block AND lands the balloon block at 576 for a LENSED 4D DE -- the two coexist", () => {
    const de = buildSurfaceDE4(
      fourDSystemTransforms(),
      fourDBoxfoldFinalTransform(),
    );
    const lens = de.foldFinal;
    if (!lens) throw new Error("expected a 4D foldFinal lens");
    const ball = balloonBall4(de);
    const b = buildBalloon4(de, 1.6);
    const balloon = {
      center: b.center,
      rho: b.rho,
      R: b.R,
      far: BALLOON_FAR_CAP_RHO * ball.radius,
    };
    const lensedPlain = new Uint8Array(
      packSurface4GpuParams(de, view4(), { itemCount: 3 }),
    );
    const buf = packSurface4GpuParams(de, view4(), { itemCount: 3 }, balloon);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS4_BALLOON_BYTES);
    // The lens4 block is now REAL content, not zero-fill, and it survives
    // byte for byte alongside the appended balloon block.
    expect(new Uint8Array(buf, 0, SURFACE_GPU_PARAMS4_LENS_BYTES)).toEqual(
      lensedPlain,
    );
    const view = new DataView(buf);
    for (let i = 0; i < 16; i++) {
      expect(view.getFloat32(464 + i * 4, true)).toBe(
        Math.fround(lens.invM[i]),
      );
    }
    expect(view.getFloat32(544, true)).toBe(SURFACE_FOLD_BOXFOLD);
    expect(view.getFloat32(576, true)).toBe(Math.fround(b.center[0]));
    expect(view.getFloat32(592, true)).toBe(Math.fround(b.R));
  });

  it("packs the ground-plane block at the frozen 576..623 offsets, growing the buffer to SURFACE_GPU_PARAMS4_PLANE_BYTES (624), leaving 0..575 untouched", () => {
    expect(SURFACE_GPU_PARAMS4_PLANE_BYTES).toBe(624);
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const gp: SurfaceGpuGroundPlane = {
      y: 0.125,
      fadeStart: 1.5,
      fadeEnd: 4.5,
      ballCenter: [0.25, -0.5, 0.75],
      ballRadius: 1.25,
      albedo: [0.375, 0.625, 0.875],
    };
    const plain = new Uint8Array(
      packSurface4GpuParams(de, view4(), { itemCount: 4 }),
    );
    const buf = packSurface4GpuParams(de, view4(), { itemCount: 4 }, null, gp);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS4_PLANE_BYTES);
    expect(new Uint8Array(buf, 0, SURFACE_GPU_PARAMS4_BYTES)).toEqual(plain);
    const view = new DataView(buf);
    expect(view.getFloat32(576, true)).toBe(Math.fround(gp.y));
    expect(view.getFloat32(580, true)).toBe(Math.fround(gp.fadeStart));
    expect(view.getFloat32(584, true)).toBe(Math.fround(gp.fadeEnd));
    expect(view.getFloat32(588, true)).toBe(Math.fround(gp.ballRadius));
    expect(view.getFloat32(592, true)).toBe(Math.fround(gp.ballCenter[0]));
    expect(view.getFloat32(596, true)).toBe(Math.fround(gp.ballCenter[1]));
    expect(view.getFloat32(600, true)).toBe(Math.fround(gp.ballCenter[2]));
    expect(view.getFloat32(608, true)).toBe(Math.fround(gp.albedo[0]));
    expect(view.getFloat32(612, true)).toBe(Math.fround(gp.albedo[1]));
    expect(view.getFloat32(616, true)).toBe(Math.fround(gp.albedo[2]));
  });

  it("throws when both a balloon and a ground plane are passed -- the two blocks share the frozen offset 576", () => {
    const de = buildSurfaceDE4(fourDSystemTransforms());
    const b = buildBalloon4(de, 0.9);
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
      packSurface4GpuParams(de, view4(), { itemCount: 1 }, balloon, gp),
    ).toThrow(/groundPlane\+balloon/);
  });
});

/** Every BOX-BRANCH DECODE the generated kernel carries, in emission
 * order. That block is the ~25 lines that turn a fold branch index `b`
 * into its per-axis preimage selectors (`selX`/`selY`/`selZ`, plus
 * `selW` one dimension up) and from them the `pre` preimage and the `dd`
 * distance fan the branch floor is built out of — the fold DE's own
 * correctness core, hand-copied once per arm because each sits inside a
 * different descent's loop body and WGSL has no way to share a fragment
 * of one.
 *
 * Anchored `var bb = b;` (the decode's first line) through
 * `let boxRd = length(dd);` (its last) — both appear exactly once per
 * copy and nowhere else in the module, so the extraction cannot slide.
 * Each block is then dedented by its own common indent: the copies sit
 * at four different nesting depths and are otherwise the same text, so a
 * UNIFORM per-line strip is the only normalization applied and any
 * difference in the code itself survives it. */
function boxBranchDecodes(wgsl: string): string[] {
  const START = "var bb = b;";
  const END = "let boxRd = length(dd);";
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const hit = wgsl.indexOf(START, at);
    if (hit === -1) return out;
    const from = wgsl.lastIndexOf("\n", hit) + 1;
    const endHit = wgsl.indexOf(END, hit);
    if (endHit === -1) {
      throw new Error(`box-branch decode at ${hit} has no "${END}" after it`);
    }
    const to = wgsl.indexOf("\n", endHit);
    const lines = wgsl.slice(from, to).split("\n");
    const indent = Math.min(
      ...lines
        .filter((line) => line.trim().length > 0)
        .map((line) => line.length - line.trimStart().length),
    );
    out.push(lines.map((line) => line.slice(indent)).join("\n"));
    at = to;
  }
}

/** Drop whole-line `//` comments, leaving the code. Used ONLY on the 4D
 * copies, whose slab sub-block carries a prose paragraph in two
 * of the four arms and none in the other two — see the pair of tests
 * below, the second of which shows the code underneath is identical. */
function withoutCommentLines(block: string): string {
  return block
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

describe("box-branch decode duplication", () => {
  it("emits the 3D box-branch decode character for character in all eight places a fold or lens kernel carries one, so a branch fix landing in one arm and not the others cannot ship", () => {
    // Six from the fold shade kernel — the width-`width` descent, its
    // narrow shading probe, the hit-info descent, and the three lens
    // sweeps wrapped around them — plus two from the affine lens kernel,
    // whose ladder core folds nothing but whose lens wrappers decode the
    // final transform's own branches.
    const copies = [
      ...boxBranchDecodes(
        surfaceDeKernelWgsl(
          kernelOpts({
            mode: "shade",
            core: "fold",
            lens: true,
            shadeDeWidth: 1,
          }),
        ),
      ),
      ...boxBranchDecodes(
        surfaceDeKernelWgsl(
          kernelOpts({ mode: "shade", core: "affine", lens: true }),
        ),
      ),
    ];
    expect(copies).toHaveLength(8);
    for (const [i, copy] of copies.entries()) {
      expect(copy, `copy ${String(i)}`).toBe(copies[0]);
    }
    // The extracted text is the whole decode, not a prefix that any two
    // blocks opening `var bb = b;` would match.
    expect(copies[0]).toContain("bb = b % 27u;");
    expect(copies[0]).toContain("let selZ = bb / 9u;");
    expect(copies[0]).toContain(
      "select(select(pre2.x, pre1.x, selX == 1u), pre0.x, selX == 0u),",
    );
    expect(copies[0]).toContain("max(dUp.z, dDn.z),");
    expect(copies[0].split("\n")).toHaveLength(30);
  });

  it("emits the 4D box-branch decode character for character in all eight places, once the slab sub-block's commentary is set aside", () => {
    // The 4D twins of the same eight arms. Only the slab's
    // `preExt` sign fan differs between them in the shipped text, and
    // only in its COMMENT — the next test is the proof of that.
    const copies = [
      ...boxBranchDecodes(
        surfaceDeKernelWgsl(
          kernelOpts({
            mode: "shade",
            core: "fold4",
            lens: true,
            shadeDeWidth: 1,
          }),
        ),
      ),
      ...boxBranchDecodes(
        surfaceDeKernelWgsl(
          kernelOpts({ mode: "shade", core: "affine4", lens: true }),
        ),
      ),
    ].map(withoutCommentLines);
    expect(copies).toHaveLength(8);
    for (const [i, copy] of copies.entries()) {
      expect(copy, `copy ${String(i)}`).toBe(copies[0]);
    }
    expect(copies[0]).toContain("bb = b % 81u;");
    expect(copies[0]).toContain("let selW = bb / 27u;");
    expect(copies[0]).toContain(
      "select(select(pre2.w, pre1.w, selW == 1u), pre0.w, selW == 0u),",
    );
    // The slab's own reflection fan rides inside the decode and is
    // pinned with it.
    expect(copies[0]).toContain("select(-eu.w, eu.w, selW == 0u),");
  });

  it("emits the 4D decode character for character WITH its comments once the slab is off, which is what makes the strip above a comment strip and not a code one", () => {
    // slabExt: false drops the `preExt` sub-block wholesale (the
    // register-pressure probe's leg), and with it the only text the four
    // 4D arms disagree
    // about. Nothing is normalized here beyond the shared dedent.
    const copies = [
      ...boxBranchDecodes(
        surfaceDeKernelWgsl(
          kernelOpts({
            mode: "shade",
            core: "fold4",
            lens: true,
            shadeDeWidth: 1,
            slabExt: false,
          }),
        ),
      ),
      ...boxBranchDecodes(
        surfaceDeKernelWgsl(
          kernelOpts({
            mode: "shade",
            core: "affine4",
            lens: true,
            slabExt: false,
          }),
        ),
      ),
    ];
    expect(copies).toHaveLength(8);
    for (const [i, copy] of copies.entries()) {
      expect(copy, `copy ${String(i)}`).toBe(copies[0]);
    }
    expect(copies[0]).not.toContain("preExt");
  });

  it("counts the box-branch decode in every kernel arm that can carry one, so a new copy has to be pinned here deliberately rather than shipping unwatched", () => {
    // The census the two identity tests are read against: which arm
    // emits how many. A copy added to an arm (or a refactor that shares
    // one away) moves a row here and forces the author to say so.
    const census: [Partial<SurfaceGpuKernelOptions>, number][] = [
      // 3D: the fold frontier alone, then each thing that wraps it.
      [{ mode: "eval", core: "fold" }, 1],
      [{ mode: "march", core: "fold" }, 1],
      [{ mode: "shade", core: "fold" }, 2],
      [{ mode: "shade", core: "fold", shadeDeWidth: 1 }, 3],
      [{ mode: "shade", core: "fold", lens: true, shadeDeWidth: 1 }, 6],
      [{ mode: "shade", core: "affine", lens: true }, 2],
      // Cores with no fold branch enumeration decode nothing — the
      // affine ladder, and both forward orbits.
      [{ mode: "shade", core: "affine" }, 0],
      [{ mode: "shade", core: "escape" }, 0],
      [{ mode: "shade", core: "bulb" }, 0],
      // 4D: the same shape one dimension up.
      [{ mode: "eval", core: "fold4" }, 1],
      [{ mode: "march", core: "fold4" }, 1],
      [{ mode: "shade", core: "fold4" }, 2],
      [{ mode: "shade", core: "fold4", shadeDeWidth: 1 }, 3],
      [{ mode: "shade", core: "fold4", lens: true, shadeDeWidth: 1 }, 6],
      [{ mode: "shade", core: "affine4", lens: true }, 2],
      [{ mode: "shade", core: "affine4" }, 0],
      [{ mode: "shade", core: "escape4" }, 0],
    ];
    for (const [overrides, expected] of census) {
      const wgsl = surfaceDeKernelWgsl(kernelOpts(overrides));
      expect(boxBranchDecodes(wgsl).length, JSON.stringify(overrides)).toBe(
        expected,
      );
    }
  });
});

describe("surfaceDeKernelWgsl shape trap (shapeTrap)", () => {
  // This deliberately cold-bakes the largest production asset. V8 coverage
  // instrumentation is several times slower than the separately gated
  // production benchmark, so give the structural source assertion room to
  // finish without weakening the benchmark's 2 s application budget.
  it("emits compact slabs with dense shader-slot dispatch", () => {
    const requested = [
      MESH_ASSET_IDS.at(-1)!,
      MESH_ASSET_IDS[0],
      MESH_ASSET_IDS.at(-1)!,
    ];
    const activeIds = [...new Set(requested)].sort(
      (a, b) => meshAssetCatalogIndex(a) - meshAssetCatalogIndex(b),
    );
    const wgsl = surfaceMeshSdfWgslSource(requested);
    activeIds.forEach((_id, slabIndex) => {
      expect(wgsl).toContain(`case ${slabIndex}u:`);
      expect(wgsl).toContain(`return shapeMeshSdf${slabIndex}(p);`);
      expect(wgsl).toContain(`let z0 = ${String(slabIndex * 64)} + i0.z;`);
    });
    expect(wgsl).not.toContain(`case ${String(activeIds.length)}u:`);
    expect(wgsl.match(/fn shapeMeshSdf\d+\(p: vec3f\)/g)).toHaveLength(
      activeIds.length,
    );
  }, 30_000);

  it("omitted and explicit shapeTrap:null produce identical source across every mode/core/variant — the byte-identical off state", () => {
    const cases: Partial<SurfaceGpuKernelOptions>[] = [
      { mode: "eval", width: 12 },
      { mode: "eval", core: "escape", width: 4 },
      { mode: "march", rays: "unproject", width: 12, statusOut: true },
      { mode: "shade", width: 12, shadeDeWidth: 1 },
      { mode: "shade", core: "escape" },
      { mode: "shade", core: "escape", groundPlane: true },
      { mode: "shade", core: "bulb" },
      { mode: "shade", core: "bulb", finish: true },
      { mode: "shade", core: "escape4" },
      { mode: "shade", core: "escape4", groundPlane: true },
      { mode: "shade", core: "affine4" },
      { mode: "shade", core: "fold4", lens: true },
    ];
    for (const overrides of cases) {
      const omitted = surfaceDeKernelWgsl(kernelOpts(overrides));
      const explicit = surfaceDeKernelWgsl(
        kernelOpts({ ...overrides, shapeTrap: null }),
      );
      expect(explicit).toBe(omitted);
      expect(omitted).not.toContain("trapShapeSdf");
      expect(omitted).not.toContain("trapCandidate");
      expect(omitted).not.toContain("trapR0");
    }
  });

  it("adds the shared mesh atlas binding exactly where a mesh-trap SDF is evaluated", () => {
    for (const mode of ["eval", "march", "shade"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode, core: "escape", shapeTrap: MESH_SHAPE }),
      );
      expect(wgsl.match(/@group\(0\) @binding\(11\)/g) ?? []).toHaveLength(
        mode === "shade" ? 1 : 0,
      );
      if (mode === "shade") {
        expect(wgsl).toContain("shapeMeshSdf(0u, vec3f(");
      }
    }
    const geometry = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "march",
        core: "escape",
        shapeTrap: MESH_SHAPE,
        shapeTrapGeometry: {
          geometry: true,
          geometryLevelMin: 0,
          geometryLevelMax: 2,
        },
      }),
    );
    expect(geometry.match(/@group\(0\) @binding\(11\)/g)).toHaveLength(1);
    expect(geometry).toContain("shapeMeshSdf(0u, vec3f(");
  });

  it("throws on every descent core — the trap is the escape family's channel", () => {
    for (const core of ["fold", "affine", "affine4", "fold4"] as const) {
      expect(() =>
        surfaceDeKernelWgsl(
          kernelOpts({ mode: "shade", core, shapeTrap: PEACE_SIGN_SHAPE }),
        ),
      ).toThrow(/escape family/);
    }
  });

  it("emits the baked SDF, the candidate/finalize helpers, the accumulator in the hit-info orbit, the struct member and the source-6 dispatch for each trap-carrying core", () => {
    for (const core of ["escape", "bulb", "escape4"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, shapeTrap: PEACE_SIGN_SHAPE }),
      );
      expect(wgsl).toContain("fn trapShapeSdf(p: vec3f) -> f32");
      expect(wgsl).toContain("fn trapCandidate(pOrbit: vec3f, stepIdx: u32)");
      expect(wgsl).toContain("fn trapValue(best: f32, cross: f32)");
      expect(wgsl).toContain("trapBest = min(trapBest, tCand);");
      expect(wgsl).toContain(
        "info.shapeTrap = trapValue(trapBest, trapCross);",
      );
      expect(wgsl).toContain("shapeTrap: f32,");
      expect(wgsl).toContain("u = hi.shapeTrap;");
      // The params block's four lanes, declared past the (unconditional)
      // plane region.
      for (const field of ["trapR0", "trapR1", "trapR2", "trapP"]) {
        expect(wgsl).toContain(`${field}: vec4f,`);
      }
      expect(wgsl).toContain("groundY: f32,");
    }
  });

  it("keeps the trap's params block out of the march/eval BODIES: only struct declarations, no reads outside shade", () => {
    for (const mode of ["eval", "march"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({
          mode,
          core: "escape",
          ...(mode === "march" ? { rays: "unproject" as const } : {}),
          shapeTrap: PEACE_SIGN_SHAPE,
        }),
      );
      expect(wgsl).toContain("trapP: vec4f,");
      expect(wgsl).not.toContain("params.trapP");
      expect(wgsl).not.toContain("trapShapeSdf");
    }
  });

  it("bakes the normalizer as the shared shapeTrapInvNorm literal", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "shade",
        core: "escape",
        shapeTrap: PEACE_SIGN_SHAPE,
      }),
    );
    const invNorm = 1 / 1.12; // torus major 1 + minor 0.12 — the peace
    // sign's bounding radius, shapeBoundingRadius's tight gear-free bound.
    expect(wgsl).toContain(`trapShapeSdf(tl) * ${String(invNorm)}`);
  });

  it("keeps every color-only kernel byte-identical when the geometry gate is omitted or null", () => {
    for (const core of ["escape", "escape4"] as const) {
      for (const mode of ["eval", "march", "shade"] as const) {
        const colorOnly = surfaceDeKernelWgsl(
          kernelOpts({ mode, core, shapeTrap: PEACE_SIGN_SHAPE }),
        );
        const explicitOff = surfaceDeKernelWgsl(
          kernelOpts({
            mode,
            core,
            shapeTrap: PEACE_SIGN_SHAPE,
            shapeTrapGeometry: null,
          }),
        );
        const explicitFalse = surfaceDeKernelWgsl(
          kernelOpts({
            mode,
            core,
            shapeTrap: PEACE_SIGN_SHAPE,
            shapeTrapGeometry: {
              geometry: false,
              geometryLevelMin: 2,
              geometryLevelMax: 5,
            },
          }),
        );
        expect(explicitOff).toBe(colorOnly);
        expect(explicitFalse).toBe(colorOnly);
        expect(colorOnly).not.toContain("trapLocalSdf");
        expect(colorOnly).not.toContain("trapDistance");
      }
    }
  });

  it("emits the inclusive post-link geometry term in eval, march, and shade for both escape dimensions", () => {
    const shapeTrapGeometry = {
      geometry: true,
      geometryLevelMin: 2,
      geometryLevelMax: 5,
    };
    for (const core of ["escape", "escape4"] as const) {
      for (const mode of ["eval", "march", "shade"] as const) {
        const wgsl = surfaceDeKernelWgsl(
          kernelOpts({
            mode,
            core,
            shapeTrap: PEACE_SIGN_SHAPE,
            shapeTrapGeometry,
          }),
        );
        expect(wgsl.match(/fn trapShapeSdf\(p: vec3f\)/g)).toHaveLength(1);
        expect(wgsl).toContain("fn trapLocalSdf(pOrbit: vec3f) -> f32");
        expect(wgsl).toContain("var trapDistance = 1.0e30;");
        expect(wgsl).toContain("if (i >= 2u && i <= 5u) {");
        expect(wgsl).toContain(
          core === "escape"
            ? "let trapLocalDistance = trapLocalSdf(v);"
            : "let trapLocalDistance = trapLocalSdf(v.xyz);",
        );
        expect(wgsl).toContain(
          "(0.9 * trapLocalDistance) / (params.trapP.x * dr)",
        );
        expect(wgsl).toContain("return min(escapeDistance, trapDistance);");

        // The sampled point and derivative are both POST-link, matching
        // runEscapeOrbit/runEscapeOrbit4. The local SDF stays below the
        // inclusive band predicate, so a narrow band does no SDF work outside
        // its range.
        const drAt = wgsl.indexOf("dr = L.p0.z * localL * dr + 1.0;");
        const radiusAt = wgsl.indexOf("r = length(v);", drAt);
        const bandAt = wgsl.indexOf("if (i >= 2u && i <= 5u) {", radiusAt);
        const sdfAt = wgsl.indexOf("let trapLocalDistance", bandAt);
        expect(drAt).toBeGreaterThan(-1);
        expect(radiusAt).toBeGreaterThan(drAt);
        expect(bandAt).toBeGreaterThan(radiusAt);
        expect(sdfAt).toBeGreaterThan(bandAt);

        // Geometry is folded into the existing value orbit rather than a
        // second geometry-only traversal. Shade has exactly one additional
        // orbit for its pre-existing color hit-info.
        expect(
          wgsl.match(/for \(var i = 0u; i < steps; i\+\+\)/g),
        ).toHaveLength(mode === "shade" ? 2 : 1);
      }
    }
  });

  it("shares one posed SDF between shade geometry and color while applying logEstimate only to the escape term", () => {
    for (const core of ["escape", "escape4"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({
          mode: "shade",
          core,
          shapeTrap: PEACE_SIGN_SHAPE,
          shapeTrapGeometry: {
            geometry: true,
            geometryLevelMin: 0,
            geometryLevelMax: 0x7fffffff,
          },
        }),
      );
      expect(wgsl).toContain("return trapLocalSdf(pOrbit) *");
      expect(wgsl.match(/fn trapLocalSdf\(/g)).toHaveLength(1);
      expect(wgsl).toContain("var escapeDistance = r / dr;");
      expect(wgsl).toContain(
        core === "escape"
          ? "if (params.escParams.w != 0.0) {"
          : "if (params.esc4Params.x != 0.0) {",
      );
      const logAt = wgsl.indexOf("escapeDistance = 0.5 * r * log(r) / dr;");
      const unionAt = wgsl.indexOf(
        "return min(escapeDistance, trapDistance);",
        logAt,
      );
      expect(logAt).toBeGreaterThan(-1);
      expect(unionAt).toBeGreaterThan(logAt);
      expect(wgsl).not.toContain("log(trapDistance)");
    }
  });

  it("rejects missing traps, malformed bands, and bulb geometry instead of silently changing power geometry", () => {
    expect(() =>
      surfaceDeKernelWgsl(
        kernelOpts({
          core: "escape",
          shapeTrapGeometry: {
            geometry: true,
            geometryLevelMin: 0,
            geometryLevelMax: 1,
          },
        }),
      ),
    ).toThrow(/requires shapeTrap/);

    for (const shapeTrapGeometry of [
      { geometry: true, geometryLevelMin: -1, geometryLevelMax: 1 },
      { geometry: true, geometryLevelMin: 2, geometryLevelMax: 1 },
      { geometry: true, geometryLevelMin: 0.5, geometryLevelMax: 1 },
      { geometry: true, geometryLevelMin: 0, geometryLevelMax: 0x80000000 },
    ]) {
      expect(() =>
        surfaceDeKernelWgsl(
          kernelOpts({
            core: "escape",
            shapeTrap: PEACE_SIGN_SHAPE,
            shapeTrapGeometry,
          }),
        ),
      ).toThrow(/bad shape-trap geometry band/);
    }

    expect(() =>
      surfaceDeKernelWgsl(
        kernelOpts({
          core: "bulb",
          shapeTrap: PEACE_SIGN_SHAPE,
          shapeTrapGeometry: {
            geometry: true,
            geometryLevelMin: 0,
            geometryLevelMax: 1,
          },
        }),
      ),
    ).toThrow(/bulb\/power/);
  });
});

describe("packers' shape-trap block (the appended 336/624 layout)", () => {
  const trap = () =>
    resolveShapeTrap({
      shape: PEACE_SIGN_SHAPE,
      position: [0.3, -0.2, 0.5],
      rotation: [0.2, 0, 0.4],
      scale: 0.7,
      mode: "threshold",
      threshold: 0.3,
      fade: 0.05,
    });
  const escapeDe = () =>
    buildEscapeDE([
      {
        id: 0,
        position: [0.4, 0.3, 0.2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "mandelbox", weight: 2 }],
      },
    ]);

  it("grows packEscapeGpuParams to SURFACE_GPU_PARAMS_TRAP_BYTES with the lanes at 336 and the plane region zero-filled", () => {
    expect(SURFACE_GPU_PARAMS_TRAP_BYTES).toBe(400);
    const rt = trap();
    const buf = packEscapeGpuParams(escapeDe(), { itemCount: 2 }, null, rt);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_TRAP_BYTES);
    const f32 = new Float32Array(buf);
    // The plane region (288..335) stays zero — the unconditional pad that
    // keeps the trap at ONE offset.
    for (let i = 288 / 4; i < 336 / 4; i++) expect(f32[i]).toBe(0);
    // Rᵀ rows with the position in the .w lanes, then the params quartet.
    expect(f32[336 / 4 + 3]).toBeCloseTo(0.3, 6);
    expect(f32[352 / 4 + 3]).toBeCloseTo(-0.2, 6);
    expect(f32[368 / 4 + 3]).toBeCloseTo(0.5, 6);
    expect(f32[384 / 4 + 0]).toBeCloseTo(rt.invScale, 6);
    expect(f32[384 / 4 + 1]).toBe(1); // threshold mode
    expect(f32[384 / 4 + 2]).toBeCloseTo(0.3, 6);
    expect(f32[384 / 4 + 3]).toBeCloseTo(0.05, 6);
    // Rᵀ row 0 is resolveShapeTrap's own matrix, transferred not
    // recomputed.
    expect(f32[336 / 4 + 0]).toBeCloseTo(rt.invRot[0], 6);
    expect(f32[336 / 4 + 1]).toBeCloseTo(rt.invRot[1], 6);
    expect(f32[336 / 4 + 2]).toBeCloseTo(rt.invRot[2], 6);
  });

  it("leaves the frozen 0..287 escape block byte-identical to the trap-free packing of the same system", () => {
    const de = escapeDe();
    const plain = new Uint8Array(packEscapeGpuParams(de, { itemCount: 2 }));
    const trapped = new Uint8Array(
      packEscapeGpuParams(de, { itemCount: 2 }, null, trap()),
    );
    expect(trapped.slice(0, SURFACE_GPU_PARAMS_BYTES)).toEqual(plain);
  });

  it("composes trap + groundPlane: the plane block keeps its 288 offset under the trap", () => {
    const gp: SurfaceGpuGroundPlane = {
      y: -1.5,
      fadeStart: 2,
      fadeEnd: 4,
      ballCenter: [0, 0, 0],
      ballRadius: 4,
      albedo: [0.5, 0.5, 0.5],
    };
    const de = escapeDe();
    const planeOnly = new Uint8Array(
      packEscapeGpuParams(de, { itemCount: 2 }, gp),
    );
    const both = new Uint8Array(
      packEscapeGpuParams(de, { itemCount: 2 }, gp, trap()),
    );
    expect(both.byteLength).toBe(SURFACE_GPU_PARAMS_TRAP_BYTES);
    expect(both.slice(0, SURFACE_GPU_PARAMS_PLANE_BYTES)).toEqual(planeOnly);
  });

  it("packBulbGpuParams takes the identical block at the identical offset", () => {
    const de = buildBulbDE([
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "bulb", weight: 1 }],
      },
    ]);
    const rt = trap();
    const buf = packBulbGpuParams(de, { itemCount: 2 }, null, rt);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_TRAP_BYTES);
    const f32 = new Float32Array(buf);
    expect(f32[384 / 4 + 0]).toBeCloseTo(rt.invScale, 6);
    const plain = new Uint8Array(packBulbGpuParams(de, { itemCount: 2 }));
    expect(new Uint8Array(buf).slice(0, SURFACE_GPU_PARAMS_BYTES)).toEqual(
      plain,
    );
  });

  it("packEscape4GpuParams appends at the frozen 624 — past the zero-filled plane region — and leaves the 0..575 block byte-identical", () => {
    expect(SURFACE_GPU_PARAMS4_TRAP_BYTES).toBe(688);
    const de4 = buildEscapeDE4([
      {
        id: 0,
        position: [0.3, 0.1, 0.2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "mandelbox", weight: 2 }],
        w: { position: 0.2, rotation: { xw: 0.6 } },
      },
    ]);
    const view: SurfaceGpu4View = {
      rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      w0: 0.1,
      sliceHalfW: 0,
    };
    const rt = trap();
    const buf = packEscape4GpuParams(de4, view, { itemCount: 2 }, null, rt);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS4_TRAP_BYTES);
    const f32 = new Float32Array(buf);
    for (let i = 576 / 4; i < 624 / 4; i++) expect(f32[i]).toBe(0);
    expect(f32[624 / 4 + 3]).toBeCloseTo(0.3, 6);
    expect(f32[672 / 4 + 1]).toBe(1);
    const plain = new Uint8Array(
      packEscape4GpuParams(de4, view, { itemCount: 2 }),
    );
    expect(
      new Uint8Array(buf).slice(0, SURFACE_GPU_PARAMS4_ESCAPE_BYTES),
    ).toEqual(plain);
  });

  it("omits the trap back to today's buffers, byte for byte, on all three packers", () => {
    const de = escapeDe();
    expect(
      new Uint8Array(packEscapeGpuParams(de, { itemCount: 2 }, null, null)),
    ).toEqual(new Uint8Array(packEscapeGpuParams(de, { itemCount: 2 })));
  });

  it("keeps geometry on the existing frozen pose wire and refuses it for the bulb packer", () => {
    const color = trap();
    const geometry = resolveShapeTrap({
      shape: PEACE_SIGN_SHAPE,
      position: [0.3, -0.2, 0.5],
      rotation: [0.2, 0, 0.4],
      scale: 0.7,
      mode: "threshold",
      threshold: 0.3,
      fade: 0.05,
      geometry: true,
      geometryLevelMin: 2,
      geometryLevelMax: 5,
    });
    const de = escapeDe();
    const color3 = new Uint8Array(
      packEscapeGpuParams(de, { itemCount: 2 }, null, color),
    );
    const geometry3 = new Uint8Array(
      packEscapeGpuParams(de, { itemCount: 2 }, null, geometry),
    );
    expect(geometry3.byteLength).toBe(400);
    expect(geometry3).toEqual(color3);

    const de4 = buildEscapeDE4([
      {
        id: 0,
        position: [0.3, 0.1, 0.2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "mandelbox", weight: 2 }],
        w: { position: 0.2, rotation: { xw: 0.6 } },
      },
    ]);
    const view: SurfaceGpu4View = {
      rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      w0: 0.1,
      sliceHalfW: 0,
    };
    const color4 = new Uint8Array(
      packEscape4GpuParams(de4, view, { itemCount: 2 }, null, color),
    );
    const geometry4 = new Uint8Array(
      packEscape4GpuParams(de4, view, { itemCount: 2 }, null, geometry),
    );
    expect(geometry4.byteLength).toBe(688);
    expect(geometry4).toEqual(color4);

    const bulb = buildBulbDE([
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "bulb", weight: 1 }],
      },
    ]);
    expect(() =>
      packBulbGpuParams(bulb, { itemCount: 2 }, null, geometry),
    ).toThrow(/bulb\/power/);
  });
});

describe("condensation GPU packing", () => {
  const symmetry = { order: 3, plane: "xy" as const };
  const depthOptions = {
    condensationDepthBand: { minDepth: 1, maxDepth: 3 },
  };
  const balloon = {
    center: [0.1, -0.2, 0.3] as [number, number, number],
    rho: 1.5,
    R: 2.5,
    far: 3.5,
  };
  const groundPlane: SurfaceGpuGroundPlane = {
    y: -1,
    fadeStart: 2,
    fadeEnd: 3,
    ballCenter: [0, 0, 0],
    ballRadius: 2,
    albedo: [0.2, 0.3, 0.4],
  };

  it("appends expanded 3D emitters while mapCount and shades stay base-sized", () => {
    const de = buildSurfaceDE(
      condensationTransforms(),
      null,
      symmetry,
      depthOptions,
    );
    expect(de.maps).toHaveLength(1);
    expect(de.condensation?.emitters).toHaveLength(6);
    const out = packSurfaceGpuMaps(de);
    expect(out).toHaveLength(7 * SURFACE_GPU_MAP_VEC4 * 4);
    const emitters = de.condensation!.emitters;
    emitters.forEach((emitter, j) => {
      const at = (de.maps.length + j) * SURFACE_GPU_MAP_VEC4 * 4;
      expect(Array.from(out.slice(at, at + 3))).toEqual(
        Array.from(new Float32Array(emitter.invM.slice(0, 3))),
      );
      expect(out[at + 3]).toBeCloseTo(emitter.invT[0], 6);
      expect(out[at + 12]).toBeCloseTo(emitter.sigmaMin, 6);
      expect(out[at + 13]).toBe(emitter.shadeIndex);
      expect(out[at + 14]).toBe(emitter.shadeIndex - de.maps.length);
    });
    expect(emitters.map((e) => e.shadeIndex)).toEqual([1, 2, 1, 2, 1, 2]);

    const view = new DataView(packSurfaceGpuParams(de, { itemCount: 1 }));
    expect(view.byteLength).toBe(SURFACE_GPU_PARAMS_CONDENSATION_BYTES);
    expect(view.getUint32(48, true)).toBe(1);
    expect(view.getUint32(288, true)).toBe(6);
    expect(view.getUint32(292, true)).toBe(1);
    expect(view.getUint32(296, true)).toBe(3);
    expect(view.getUint32(300, true)).toBe(3);
  });

  it("uses the 4D layout and preserves embedded-solid emitter metadata", () => {
    const de = buildSurfaceDE4(
      condensationTransforms(),
      null,
      symmetry,
      depthOptions,
    );
    const out = packSurfaceGpuMaps4(de);
    expect(out).toHaveLength(7 * SURFACE_GPU_MAP4_VEC4 * 4);
    de.condensation!.emitters.forEach((emitter, j) => {
      const at = (de.maps.length + j) * SURFACE_GPU_MAP4_VEC4 * 4;
      expect(Array.from(out.slice(at, at + 16))).toEqual(
        Array.from(new Float32Array(emitter.invM)),
      );
      expect(Array.from(out.slice(at + 16, at + 20))).toEqual(
        Array.from(new Float32Array(emitter.invT)),
      );
      expect(out[at + 20]).toBeCloseTo(emitter.sigmaMin, 6);
      expect(out[at + 21]).toBe(emitter.shadeIndex);
      expect(out[at + 22]).toBe(emitter.shadeIndex - de.maps.length);
    });
    const view = new DataView(
      packSurface4GpuParams(de, view4(), { itemCount: 1 }),
    );
    expect(view.byteLength).toBe(SURFACE_GPU_PARAMS4_CONDENSATION_BYTES);
    expect(view.getUint32(48, true)).toBe(1);
    expect(view.getUint32(576, true)).toBe(6);
    expect(view.getUint32(580, true)).toBe(1);
    expect(view.getUint32(584, true)).toBe(3);
    expect(view.getUint32(588, true)).toBe(3);
  });

  it("places controls after every frozen balloon/plane tail", () => {
    const de3 = buildSurfaceDE(
      condensationTransforms(),
      null,
      symmetry,
      depthOptions,
    );
    const base3 = new Uint8Array(packSurfaceGpuParams(de3, { itemCount: 2 }));
    const balloon3 = new Uint8Array(
      packSurfaceGpuParams(de3, { itemCount: 2 }, balloon),
    );
    const plane3 = new Uint8Array(
      packSurfaceGpuParams(de3, { itemCount: 2 }, null, groundPlane),
    );
    expect(balloon3.byteLength).toBe(
      SURFACE_GPU_PARAMS_BALLOON_CONDENSATION_BYTES,
    );
    expect(plane3.byteLength).toBe(SURFACE_GPU_PARAMS_PLANE_CONDENSATION_BYTES);
    expect(balloon3.slice(0, 288)).toEqual(base3.slice(0, 288));
    expect(plane3.slice(0, 288)).toEqual(base3.slice(0, 288));
    expect(new DataView(balloon3.buffer).getUint32(320, true)).toBe(6);
    expect(new DataView(plane3.buffer).getUint32(336, true)).toBe(6);

    const de4 = buildSurfaceDE4(
      condensationTransforms(),
      null,
      symmetry,
      depthOptions,
    );
    const base4 = new Uint8Array(
      packSurface4GpuParams(de4, view4(), { itemCount: 2 }),
    );
    const balloon4 = new Uint8Array(
      packSurface4GpuParams(de4, view4(), { itemCount: 2 }, balloon),
    );
    const plane4 = new Uint8Array(
      packSurface4GpuParams(de4, view4(), { itemCount: 2 }, null, groundPlane),
    );
    expect(balloon4.byteLength).toBe(
      SURFACE_GPU_PARAMS4_BALLOON_CONDENSATION_BYTES,
    );
    expect(plane4.byteLength).toBe(
      SURFACE_GPU_PARAMS4_PLANE_CONDENSATION_BYTES,
    );
    expect(balloon4.slice(0, 576)).toEqual(base4.slice(0, 576));
    expect(plane4.slice(0, 576)).toEqual(base4.slice(0, 576));
    expect(new DataView(balloon4.buffer).getUint32(608, true)).toBe(6);
    expect(new DataView(plane4.buffer).getUint32(624, true)).toBe(6);
  });

  it("places controls after populated 3D and 4D fold-lens prefixes", () => {
    const de3 = buildSurfaceDE(
      condensationTransforms(),
      spherefoldFinalTransform(),
      symmetry,
      depthOptions,
    );
    const view3 = new DataView(packSurfaceGpuParams(de3, { itemCount: 1 }));
    expect(de3.foldFinal).not.toBeNull();
    expect(view3.byteLength).toBe(SURFACE_GPU_PARAMS_CONDENSATION_BYTES);
    expect(view3.getFloat32(256, true)).toBe(de3.foldFinal!.foldKind);
    expect(view3.getUint32(288, true)).toBe(6);

    const de4 = buildSurfaceDE4(
      condensationTransforms(),
      fourDBoxfoldFinalTransform(),
      symmetry,
      depthOptions,
    );
    const view4Params = new DataView(
      packSurface4GpuParams(de4, view4(), { itemCount: 1 }),
    );
    expect(de4.foldFinal).not.toBeNull();
    expect(view4Params.byteLength).toBe(SURFACE_GPU_PARAMS4_CONDENSATION_BYTES);
    expect(view4Params.getFloat32(544, true)).toBe(de4.foldFinal!.foldKind);
    expect(view4Params.getUint32(576, true)).toBe(6);
  });

  it("keeps empty condensation on legacy bytes exactly", () => {
    const plain3 = buildSurfaceDE([condensationTransforms()[0]]);
    const empty3: SurfaceDE = {
      ...plain3,
      condensation: {
        emitters: [],
        depthBand: { minDepth: 0, maxDepth: 3 },
      },
    };
    expect(
      new Uint8Array(packSurfaceGpuParams(empty3, { itemCount: 2 })),
    ).toEqual(new Uint8Array(packSurfaceGpuParams(plain3, { itemCount: 2 })));
    expect(packSurfaceGpuMaps(empty3)).toEqual(packSurfaceGpuMaps(plain3));

    const plain4 = buildSurfaceDE4([condensationTransforms()[0]]);
    const empty4: SurfaceDE4 = {
      ...plain4,
      condensation: {
        emitters: [],
        depthBand: { minDepth: 0, maxDepth: 3 },
      },
    };
    expect(
      new Uint8Array(packSurface4GpuParams(empty4, view4(), { itemCount: 2 })),
    ).toEqual(
      new Uint8Array(packSurface4GpuParams(plain4, view4(), { itemCount: 2 })),
    );
    expect(packSurfaceGpuMaps4(empty4)).toEqual(packSurfaceGpuMaps4(plain4));
  });

  it("enforces the 24-record cap and contiguous shade suffix", () => {
    const de = buildSurfaceDE(
      condensationTransforms(),
      null,
      symmetry,
      depthOptions,
    );
    const first = de.condensation!.emitters[0];
    const tooMany: SurfaceDE = {
      ...de,
      condensation: {
        ...de.condensation!,
        emitters: Array.from({ length: 24 }, () => first),
      },
    };
    expect(() => packSurfaceGpuMaps(tooMany)).toThrow(/25.*cap is 24/);
    expect(() => packSurfaceGpuParams(tooMany, { itemCount: 1 })).toThrow(
      /25.*cap is 24/,
    );
    const badShade: SurfaceDE = {
      ...de,
      condensation: {
        ...de.condensation!,
        emitters: [{ ...first, shadeIndex: 7 }],
      },
    };
    expect(() => packSurfaceGpuMaps(badShade)).toThrow(/contiguous suffix/);
  });
});

describe("surfaceDeKernelWgsl condensation", () => {
  const shapes = [CONDENSATION_SPHERE, CONDENSATION_BOX] as const;
  const condensation = {
    mapCount: 1,
    emitters: [
      { shape: shapes[0], shadeIndex: 1 },
      { shape: shapes[1], shadeIndex: 2 },
      { shape: shapes[0], shadeIndex: 1 },
      { shape: shapes[1], shadeIndex: 2 },
    ],
  } as const;

  it("keeps absent, null, and empty options source-byte identical", () => {
    const cases: Partial<SurfaceGpuKernelOptions>[] = [
      { core: "fold", mode: "shade", shadeDeWidth: 1, lens: true },
      { core: "affine", mode: "march", balloon: true },
      { core: "fold4", mode: "shade", groundPlane: true },
      { core: "affine4", mode: "eval", lens: true },
    ];
    for (const overrides of cases) {
      const omitted = surfaceDeKernelWgsl(kernelOpts(overrides));
      expect(
        surfaceDeKernelWgsl(kernelOpts({ ...overrides, condensation: null })),
      ).toBe(omitted);
      expect(
        surfaceDeKernelWgsl(
          kernelOpts({
            ...overrides,
            condensation: { mapCount: 1, emitters: [] },
          }),
        ),
      ).toBe(omitted);
    }
  });

  it("declares one binding-11 R32F atlas helper only for mesh-bearing condensation in 3D and 4D", () => {
    const meshCondensation = {
      mapCount: 1,
      emitters: [
        { shape: MESH_SHAPE, shadeIndex: 1 },
        { shape: MESH_SHAPE, shadeIndex: 1 },
      ],
    };
    for (const core of ["affine", "affine4"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ core, condensation: meshCondensation }),
      );
      expect(
        wgsl.match(
          /@group\(0\) @binding\(11\) var shapeMeshSdfTex: texture_3d<f32>;/g,
        ),
      ).toHaveLength(1);
      expect(wgsl).toContain("fn shapeMeshSdf(meshIndex: u32, p: vec3f)");
      expect(wgsl.match(/textureLoad\(shapeMeshSdfTex/g)).toHaveLength(8);
      expect(wgsl).toContain("return max(interpolated, boxDistance);");
      expect(wgsl).toContain("shapeMeshSdf(0u, vec3f(");
    }
    expect(
      surfaceDeKernelWgsl(kernelOpts({ core: "affine", condensation })),
    ).not.toContain("@binding(11)");
  });

  it("bakes unique shapes and dispatches appended records by selector", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ core: "affine", condensation }),
    );
    expect(wgsl).toContain("fn condensationShape0(p: vec3f) -> f32");
    expect(wgsl).toContain("fn condensationShape1(p: vec3f) -> f32");
    expect(wgsl).toContain("case 0u:");
    expect(wgsl).toContain("case 1u:");
    expect(wgsl).toContain("let m = maps[params.mapCount + e];");
    expect(wgsl).toContain("shade = i32(m.p0.y)");
    expect(wgsl).toContain("u32(m.p0.z)");
    expect(wgsl).toContain(
      "depth < params.condDepthMin || depth > params.condDepthMax",
    );
    expect(wgsl).toContain(
      "return scale * 0.9 * condensationDistance(q).distance",
    );
  });

  it("uses the 4D embedded-solid formula rather than extrusion", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ core: "affine4", condensation }),
    );
    expect(wgsl).toContain("length(vec2f(max(shapeDistance, 0.0), local.w))");
    expect(wgsl).toContain("fn condensationDistance(q: vec4f)");
  });

  it("attributes shade hit-info to a winning emitter at every descent observation point", () => {
    for (const core of ["affine", "affine4"] as const) {
      const dim = core === "affine4" ? "vec4f" : "vec3f";
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, condensation }),
      );
      expect(wgsl).toContain(`fn condensationTermHit(q: ${dim}`);
      expect(wgsl).toContain("info.firstChoice = condensationHit.shade");
      expect(wgsl).toContain("condensationTermHit(aQ, aScale, depth)");
      expect(wgsl).toContain(
        "condensationTermHit(img, childScale, depth + 1u)",
      );
      expect(wgsl).toContain(
        "condensationTermHit(aQ, aScale, params.maxDepth)",
      );
      expect(wgsl).toContain("depth == 0u && c1Cert < best");
      expect(wgsl).toContain("futureCondensation && eR <= R");
      expect(wgsl).toMatch(
        /best = min\(best, refinedCert\(eQ, (?:eExt, )?eR, eScale, depth \+ 1u\)\)/,
      );
    }

    for (const core of ["fold", "fold4"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, condensation }),
      );
      expect(wgsl).toContain("info.firstChoice = condensationHit.shade");
      expect(wgsl).toContain("condensationTermHit(chQ, chScale, depth)");
      expect(wgsl).toContain(
        "condensationTermHit(img, pScale * branchSigma, depth + 1u)",
      );
      expect(wgsl).toContain(
        "condensationTermHit(chQ, chScale, params.maxDepth)",
      );
      expect(wgsl).toContain("lbScale * (lbR - R) < condensationBest");
    }
  });

  it("carries emitter attribution through every 3D/4D lens wrapper without changing eval or march helpers", () => {
    for (const core of ["affine", "fold", "affine4", "fold4"] as const) {
      const lensed = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, lens: true, condensation }),
      );
      expect(lensed).toContain("fn surfaceDEHitInfoCore(");
      expect(lensed).toContain("info.firstChoice = condensationHit.shade");
      expect(lensed).toMatch(/return surfaceDEHitInfoCore\(bestQ,/);

      for (const mode of ["eval", "march"] as const) {
        const valueOnly = surfaceDeKernelWgsl(
          kernelOpts({ mode, core, lens: true, condensation }),
        );
        expect(valueOnly).not.toContain("fn condensationTermHit(");
        expect(valueOnly).toContain(
          "return scale * 0.9 * condensationDistance(q).distance",
        );
      }
    }
  });

  it("moves the evicted c4 key with its tuple before a future-condensation fold", () => {
    for (const core of ["affine", "affine4"] as const) {
      const valueOnly = surfaceDeKernelWgsl(
        kernelOpts({ mode: "eval", core, condensation }),
      );
      expect(valueOnly.match(/let tKey = c4Key;/g)).toHaveLength(2);
      expect(valueOnly.match(/eKey = tKey;/g)).toHaveLength(2);

      const withHitInfo = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, condensation }),
      );
      expect(withHitInfo.match(/let tKey = c4Key;/g)).toHaveLength(4);
      expect(withHitInfo.match(/eKey = tKey;/g)).toHaveLength(4);
      expect(withHitInfo).toContain("eKey = tKey;\n            eQ = tQ;");
    }
  });

  it("mirrors roots, children, refinement, terminals, and future drops", () => {
    const affine = surfaceDeKernelWgsl(
      kernelOpts({ core: "affine", condensation }),
    );
    expect(affine).toContain(
      "fn refinedCert(img: vec3f, r: f32, childScale: f32, depth: u32)",
    );
    expect(affine).toContain("condensationTerm(img, 1.0, depth)");
    for (const chain of ["aQ", "bQ", "v1Q", "v2Q"]) {
      expect(affine).toContain(`condensationTerm(${chain}`);
    }
    expect(affine).toContain("condensationTerm(img, childScale, depth + 1u)");
    expect(affine).toContain("condensationHasFuture(depth + 1u)");
    expect(affine).toContain("eScale * (eR - R)");
    expect(affine).toContain("condensationTerm(aQ, aScale, maxDepth)");

    const foldShade = surfaceDeKernelWgsl(
      kernelOpts({
        mode: "shade",
        core: "fold",
        shadeDeWidth: 1,
        condensation,
      }),
    );
    expect(foldShade).toContain(
      "condensationTerm(rootQ, fcScale[frontierIx(rootC, li)], depth)",
    );
    expect(foldShade).toContain("evScale * (evR - R)");
    expect(foldShade.match(/fn surfaceDE(?:Probe)?\(/g)).toHaveLength(2);
    expect(
      foldShade.match(/condensationHasFuture\(depth \+ 1u\)/g),
    ).toHaveLength(2);
  });

  it("refuses forward cores, shapeTrap combinations, and excess slots", () => {
    for (const core of ["escape", "bulb", "escape4"] as const) {
      expect(() =>
        surfaceDeKernelWgsl(kernelOpts({ core, condensation })),
      ).toThrow(/forward cores refuse/);
    }
    expect(() =>
      surfaceDeKernelWgsl(
        kernelOpts({
          core: "affine",
          condensation,
          shapeTrap: CONDENSATION_SPHERE,
        }),
      ),
    ).toThrow(/condensation\+shapeTrap/);
    expect(() =>
      surfaceDeKernelWgsl(
        kernelOpts({
          core: "affine",
          condensation: {
            mapCount: 0,
            emitters: Array.from({ length: 25 }, (_, shadeIndex) => ({
              shape: GEAR_SHAPE,
              shadeIndex,
            })),
          },
        }),
      ),
    ).toThrow(/25.*cap is 24/);
  });
});

describe("hybrid schedule GPU ABI", () => {
  const balloon = {
    center: [0.1, -0.2, 0.3] as [number, number, number],
    rho: 1.5,
    R: 2.5,
    far: 3.5,
  };
  const groundPlane: SurfaceGpuGroundPlane = {
    y: -1,
    fadeStart: 2,
    fadeEnd: 3,
    ballCenter: [0, 0, 0],
    ballRadius: 2,
    albedo: [0.2, 0.3, 0.4],
  };

  it("keeps zero/empty schedules on the exact legacy bytes and source", () => {
    const plain3 = buildSurfaceDE([condensationTransforms()[0]]);
    const empty3: SurfaceDE = {
      ...plain3,
      schedule: {
        maps: [],
        depth: 0,
        bounds: [
          {
            center: plain3.boundCenter,
            radius: plain3.boundingRadius,
            escapeRadius: plain3.escapeRadius,
          },
        ],
      },
    };
    expect(packSurfaceGpuParams(empty3, { itemCount: 2 })).toEqual(
      packSurfaceGpuParams(plain3, { itemCount: 2 }),
    );
    expect(packSurfaceGpuMaps(empty3)).toEqual(packSurfaceGpuMaps(plain3));

    const plain4 = buildSurfaceDE4([condensationTransforms()[0]]);
    const empty4: SurfaceDE4 = {
      ...plain4,
      schedule: {
        maps: [],
        depth: 0,
        bounds: [
          { radius: plain4.boundingRadius, escapeRadius: plain4.escapeRadius },
        ],
      },
    };
    expect(packSurface4GpuParams(empty4, view4(), { itemCount: 2 })).toEqual(
      packSurface4GpuParams(plain4, view4(), { itemCount: 2 }),
    );
    expect(packSurfaceGpuMaps4(empty4)).toEqual(packSurfaceGpuMaps4(plain4));

    for (const core of ["fold", "affine", "fold4", "affine4"] as const) {
      const legacy = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, width: 4 }),
      );
      expect(
        surfaceDeKernelWgsl(
          kernelOpts({
            mode: "shade",
            core,
            width: 4,
            schedule: { mapCount: 1, scheduleMapCount: 0 },
          }),
        ),
      ).toBe(legacy);
    }
  });

  it("appends controls and five clamped bounds after every 3D/4D feature tail", () => {
    const base3 = buildSurfaceDE([condensationTransforms()[0]]);
    const scheduled3 = withSchedule3(base3);
    const p3 = new DataView(packSurfaceGpuParams(scheduled3, { itemCount: 1 }));
    expect(p3.byteLength).toBe(SURFACE_GPU_PARAMS_SCHEDULE_BYTES);
    expect(p3.getFloat32(0, true)).toBe(4);
    expect(p3.getFloat32(4, true)).toBe(5);
    expect(p3.getFloat32(8, true)).toBe(6);
    expect(p3.getFloat32(12, true)).toBe(11);
    expect(p3.getFloat32(16, true)).toBe(22);
    expect(p3.getUint32(48, true)).toBe(base3.maps.length);
    expect(p3.getUint32(288, true)).toBe(2);
    expect(p3.getUint32(292, true)).toBe(2);
    expect(Array.from(new Float32Array(p3.buffer, 304, 4))).toEqual([
      1, 2, 3, 7,
    ]);
    expect(p3.getFloat32(380, true)).toBeCloseTo(base3.boundingRadius, 6);
    expect(
      packSurfaceGpuParams(scheduled3, { itemCount: 1 }, balloon).byteLength,
    ).toBe(SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_BYTES);
    expect(
      packSurfaceGpuParams(scheduled3, { itemCount: 1 }, null, groundPlane)
        .byteLength,
    ).toBe(SURFACE_GPU_PARAMS_PLANE_SCHEDULE_BYTES);

    const base4 = buildSurfaceDE4([condensationTransforms()[0]]);
    const scheduled4 = withSchedule4(base4);
    const p4 = new DataView(
      packSurface4GpuParams(scheduled4, view4(), { itemCount: 1 }),
    );
    expect(p4.byteLength).toBe(SURFACE_GPU_PARAMS4_SCHEDULE_BYTES);
    expect(p4.getFloat32(12, true)).toBe(11);
    expect(p4.getFloat32(16, true)).toBe(22);
    expect(p4.getUint32(576, true)).toBe(2);
    expect(p4.getUint32(580, true)).toBe(2);
    expect(Array.from(new Float32Array(p4.buffer, 592, 4))).toEqual([
      0, 0, 0, 7,
    ]);
    expect(p4.getFloat32(668, true)).toBeCloseTo(base4.boundingRadius, 6);
    expect(
      packSurface4GpuParams(scheduled4, view4(), { itemCount: 1 }, balloon)
        .byteLength,
    ).toBe(SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_BYTES);
    expect(
      packSurface4GpuParams(
        scheduled4,
        view4(),
        { itemCount: 1 },
        null,
        groundPlane,
      ).byteLength,
    ).toBe(SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_BYTES);
  });

  it("places B between A and condensation emitters and keeps shade selectors A-relative", () => {
    const options = {
      condensationDepthBand: { minDepth: 1, maxDepth: 3 },
    };
    const base3 = buildSurfaceDE(
      condensationTransforms(),
      null,
      undefined,
      options,
    );
    const scheduled3 = withSchedule3(base3);
    const maps3 = packSurfaceGpuMaps(scheduled3);
    const b3 = base3.maps.length * SURFACE_GPU_MAP_VEC4 * 4;
    expect(maps3[b3 + 15]).toBe(0);
    expect(Array.from(maps3.slice(b3 + 24, b3 + 27))).toEqual([0.5, 1, 1]);
    const emitter3 =
      (base3.maps.length + scheduled3.schedule!.maps.length) *
      SURFACE_GPU_MAP_VEC4 *
      4;
    expect(maps3[emitter3 + 13]).toBe(
      base3.condensation!.emitters[0].shadeIndex,
    );
    expect(maps3[emitter3 + 14]).toBe(
      base3.condensation!.emitters[0].shadeIndex - base3.maps.length,
    );
    const params3 = new DataView(
      packSurfaceGpuParams(scheduled3, { itemCount: 1 }),
    );
    expect(params3.byteLength).toBe(
      SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_BYTES,
    );
    expect(params3.getUint32(288, true)).toBe(
      base3.condensation!.emitters.length,
    );
    expect(params3.getUint32(304, true)).toBe(scheduled3.schedule!.maps.length);

    const base4 = buildSurfaceDE4(
      condensationTransforms(),
      null,
      undefined,
      options,
    );
    const scheduled4 = withSchedule4(base4);
    const maps4 = packSurfaceGpuMaps4(scheduled4);
    const b4 = base4.maps.length * SURFACE_GPU_MAP4_VEC4 * 4;
    expect(maps4[b4 + 23]).toBe(0);
    const emitter4 =
      (base4.maps.length + scheduled4.schedule!.maps.length) *
      SURFACE_GPU_MAP4_VEC4 *
      4;
    expect(maps4[emitter4 + 21]).toBe(
      base4.condensation!.emitters[0].shadeIndex,
    );
    expect(maps4[emitter4 + 22]).toBe(
      base4.condensation!.emitters[0].shadeIndex - base4.maps.length,
    );
    const params4 = new DataView(
      packSurface4GpuParams(scheduled4, view4(), { itemCount: 1 }),
    );
    expect(params4.byteLength).toBe(
      SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_BYTES,
    );
    expect(params4.getUint32(576, true)).toBe(
      base4.condensation!.emitters.length,
    );
    expect(params4.getUint32(592, true)).toBe(scheduled4.schedule!.maps.length);

    expect(
      packSurfaceGpuParams(scheduled3, { itemCount: 1 }, balloon).byteLength,
    ).toBe(SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_CONDENSATION_BYTES);
    expect(
      packSurfaceGpuParams(scheduled3, { itemCount: 1 }, null, groundPlane)
        .byteLength,
    ).toBe(SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CONDENSATION_BYTES);
    expect(
      packSurface4GpuParams(scheduled4, view4(), { itemCount: 1 }, balloon)
        .byteLength,
    ).toBe(SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_CONDENSATION_BYTES);
    expect(
      packSurface4GpuParams(
        scheduled4,
        view4(),
        { itemCount: 1 },
        null,
        groundPlane,
      ).byteLength,
    ).toBe(SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CONDENSATION_BYTES);
  });

  it("accepts 24 physical records and rejects 25 in both dimensions and codegen", () => {
    const base3 = buildSurfaceDE([condensationTransforms()[0]]);
    expect(packSurfaceGpuMaps(withSchedule3(base3, 23))).toHaveLength(
      24 * SURFACE_GPU_MAP_VEC4 * 4,
    );
    expect(() => packSurfaceGpuMaps(withSchedule3(base3, 24))).toThrow(
      /25.*cap is 24/,
    );
    const base4 = buildSurfaceDE4([condensationTransforms()[0]]);
    expect(packSurfaceGpuMaps4(withSchedule4(base4, 23))).toHaveLength(
      24 * SURFACE_GPU_MAP4_VEC4 * 4,
    );
    expect(() => packSurfaceGpuMaps4(withSchedule4(base4, 24))).toThrow(
      /25.*cap is 24/,
    );
    expect(() =>
      surfaceDeKernelWgsl(
        kernelOpts({ schedule: { mapCount: 1, scheduleMapCount: 23 } }),
      ),
    ).not.toThrow();
    expect(() =>
      surfaceDeKernelWgsl(
        kernelOpts({ schedule: { mapCount: 1, scheduleMapCount: 24 } }),
      ),
    ).toThrow(/25.*cap is 24/);
  });
});

describe("surfaceDeKernelWgsl hybrid schedule", () => {
  const schedule = { mapCount: 2, scheduleMapCount: 3 };

  it("switches all hit/value/refined loops and bounds across the four descent cores", () => {
    for (const core of ["fold", "affine", "fold4", "affine4"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({
          mode: "shade",
          core,
          width: 4,
          bnbStage2: true,
          schedule,
        }),
      );
      expect(wgsl).toContain("scheduleMapStart(depth)");
      expect(wgsl).toContain("scheduleMapEnd(depth)");
      expect(wgsl).toContain("scheduleSymOrder(depth)");
      expect(wgsl).not.toContain("k < params.symOrder");
      expect(wgsl).not.toContain("j < params.mapCount");
      expect(wgsl).toContain("r - scheduleBound(depth + 1u).w");
      expect(wgsl).toContain("scheduleEscapeRadius(depth + 1u)");
      expect(wgsl).toContain("if (depth == params.scheduleDepth");
      expect(wgsl).toContain("if (depth >= params.scheduleDepth)");
      expect(wgsl).not.toContain("let bnbSigma =");
      if (core === "fold" || core === "affine") {
        expect(wgsl).toContain("scheduleBound(depth + 1u).xyz");
        expect(wgsl).toContain("scheduleBound(maxDepth).w");
      } else {
        expect(wgsl).toContain("scheduleBound(params.maxDepth).w");
      }
      if (core === "affine" || core === "affine4") {
        expect(wgsl).toMatch(/fn refinedCert\([^)]*depth: u32/);
        expect(wgsl).toContain("max(r - scheduleBound(depth).w, inner)");
      }
    }
  });

  it("keeps lens inversion outside scheduled cores", () => {
    for (const core of ["fold", "affine", "fold4", "affine4"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ mode: "shade", core, lens: true, schedule }),
      );
      expect(wgsl).toContain("fn surfaceDECore(");
      expect(wgsl).toContain("fn surfaceDEHitInfoCore(");
      expect(wgsl).toContain("scheduleMapStart(depth)");
      expect(wgsl).toContain("fn surfaceDE(");
    }
  });

  it("shifts condensation to A depth and reads emitters after B", () => {
    const condensation = {
      mapCount: 2,
      emitters: [
        { shape: CONDENSATION_SPHERE, shadeIndex: 2 },
        { shape: CONDENSATION_BOX, shadeIndex: 3 },
      ],
    };
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "shade", core: "affine", schedule, condensation }),
    );
    expect(wgsl).toContain(
      "maps[params.mapCount + params.scheduleMapCount + e]",
    );
    expect(wgsl).toContain("if (depth < params.scheduleDepth)");
    expect(wgsl).toContain("let aDepth = depth - params.scheduleDepth;");
    expect(wgsl).toContain(
      "let aChildDepth = childDepth - params.scheduleDepth;",
    );
    expect(() =>
      surfaceDeKernelWgsl(
        kernelOpts({
          schedule: { mapCount: 2, scheduleMapCount: 21 },
          condensation,
        }),
      ),
    ).toThrow(/25 physical.*24/);
  });
});

describe("graph-directed Surface GPU ABI", () => {
  const masks = Uint32Array.from([0b101, 0b010, 0b111]);

  function withChaos3(de: SurfaceDE): SurfaceDE {
    return {
      ...de,
      chaos: {
        activeStateCount: 3,
        predecessorMasks: masks,
        emitterStateIndices: Uint8Array.from(
          de.condensation?.emitters.map((e) => e.shadeIndex) ?? [],
        ),
      },
    };
  }

  function withChaos4(de: SurfaceDE4): SurfaceDE4 {
    return {
      ...de,
      chaos: {
        activeStateCount: 3,
        predecessorMasks: masks,
        emitterStateIndices: Uint8Array.from(
          de.condensation?.emitters.map((e) => e.shadeIndex) ?? [],
        ),
      },
    };
  }

  it("appends six vec4u masks after the existing 3D and forced-576 4D tails", () => {
    expect(SURFACE_GPU_CHAOS_BYTES).toBe(96);
    const plain3 = buildSurfaceDE([condensationTransforms()[0]]);
    const chaos3: SurfaceDE = {
      ...plain3,
      chaos: {
        activeStateCount: 1,
        predecessorMasks: Uint32Array.of(1),
        emitterStateIndices: new Uint8Array(),
      },
    };
    const packed3 = new DataView(
      packSurfaceGpuParams(chaos3, { itemCount: 1 }),
    );
    expect(packed3.byteLength).toBe(SURFACE_GPU_PARAMS_CHAOS_BYTES);
    expect(new Uint8Array(packed3.buffer, 0, 288)).toEqual(
      new Uint8Array(packSurfaceGpuParams(plain3, { itemCount: 1 })),
    );
    expect(packed3.getUint32(288, true)).toBe(1);
    expect(packed3.getUint32(292, true)).toBe(0);

    const plain4 = buildSurfaceDE4([condensationTransforms()[0]]);
    const chaos4: SurfaceDE4 = {
      ...plain4,
      chaos: {
        activeStateCount: 1,
        predecessorMasks: Uint32Array.of(1),
        emitterStateIndices: new Uint8Array(),
      },
    };
    const packed4 = new DataView(
      packSurface4GpuParams(chaos4, view4(), { itemCount: 1 }),
    );
    expect(packed4.byteLength).toBe(SURFACE_GPU_PARAMS4_CHAOS_BYTES);
    expect(new Uint8Array(packed4.buffer, 0, 464)).toEqual(
      new Uint8Array(packSurface4GpuParams(plain4, view4(), { itemCount: 1 })),
    );
    expect(Array.from(new Uint8Array(packed4.buffer, 464, 112))).toEqual(
      new Array(112).fill(0),
    );
    expect(packed4.getUint32(576, true)).toBe(1);
  });

  it("places masks after combined schedule and condensation in both dimensions", () => {
    const base3 = buildSurfaceDE(condensationTransforms(), null, undefined, {
      condensationDepthBand: { minDepth: 1, maxDepth: 3 },
    });
    const de3 = withChaos3(withSchedule3(base3));
    const packed3 = new DataView(packSurfaceGpuParams(de3, { itemCount: 1 }));
    expect(packed3.byteLength).toBe(
      SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_CHAOS_BYTES,
    );
    expect(packed3.getUint32(304, true)).toBe(2);
    expect(Array.from(new Uint32Array(packed3.buffer, 400, 4))).toEqual([
      0b101, 0b010, 0b111, 0,
    ]);

    const base4 = buildSurfaceDE4(condensationTransforms(), null, undefined, {
      condensationDepthBand: { minDepth: 1, maxDepth: 3 },
    });
    const de4 = withChaos4(withSchedule4(base4));
    const packed4 = new DataView(
      packSurface4GpuParams(de4, view4(), { itemCount: 1 }),
    );
    expect(packed4.byteLength).toBe(
      SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_CHAOS_BYTES,
    );
    expect(packed4.getUint32(592, true)).toBe(2);
    expect(Array.from(new Uint32Array(packed4.buffer, 688, 4))).toEqual([
      0b101, 0b010, 0b111, 0,
    ]);
  });

  it("keeps missing, null, and zero-state chaos source byte-identical", () => {
    for (const core of ["fold", "affine", "fold4", "affine4"] as const) {
      const overrides = {
        core,
        mode: "shade" as const,
        lens: true,
        slabExt: core.endsWith("4") ? false : undefined,
      };
      const classic = surfaceDeKernelWgsl(kernelOpts(overrides));
      expect(
        surfaceDeKernelWgsl(kernelOpts({ ...overrides, chaos: null })),
      ).toBe(classic);
      expect(
        surfaceDeKernelWgsl(
          kernelOpts({
            ...overrides,
            chaos: { activeStateCount: 0, predecessorMasks: [] },
          }),
        ),
      ).toBe(classic);
    }
  });

  it("threads wildcard/current/child state through every value and shade core", () => {
    const chaos = {
      activeStateCount: 3,
      predecessorMasks: [0b101, 0b010, 0b111],
    };
    const schedule = { mapCount: 2, scheduleMapCount: 1 };
    const condensation = {
      mapCount: 2,
      emitters: [{ shape: CONDENSATION_SPHERE, shadeIndex: 2 }],
    };
    for (const core of ["fold", "affine", "fold4", "affine4"] as const) {
      for (const lens of [false, true]) {
        const wgsl = surfaceDeKernelWgsl(
          kernelOpts({
            mode: "shade",
            core,
            lens,
            slabExt: core.endsWith("4") ? false : undefined,
            schedule,
            condensation,
            chaos,
          }),
        );
        expect(wgsl).toContain("chaosMask0: vec4u");
        expect(wgsl).toContain("fn chaosAllows(source: u32, current: u32)");
        expect(wgsl).toContain("!chaosAllows(j, pState)");
        expect(wgsl).toContain("chaosChildState(depth, j)");
        expect(wgsl).toContain(
          "select(source, CHAOS_WILDCARD, depth < params.scheduleDepth)",
        );
        expect(wgsl).toContain("!chaosAllows(u32(m.p0.y), currentState)");
        expect(wgsl).toContain("if (depth == params.scheduleDepth");
        expect(wgsl).toContain("fn surfaceDEHitInfo");
        if (core === "fold" || core === "fold4") {
          expect(wgsl).toContain("fcState");
          expect(wgsl).toContain("fnState");
        } else {
          expect(wgsl).toContain("currentState: u32");
          expect(wgsl).toContain("c4State");
        }
      }
    }
  });

  it("validates mask shape and refuses graph selection on forward cores", () => {
    expect(() =>
      surfaceDeKernelWgsl(
        kernelOpts({
          chaos: { activeStateCount: 3, predecessorMasks: [1, 2] },
        }),
      ),
    ).toThrow(/exactly 3 predecessor masks/);
    expect(() =>
      surfaceDeKernelWgsl(
        kernelOpts({
          chaos: { activeStateCount: 2, predecessorMasks: [1, 4] },
        }),
      ),
    ).toThrow(/outside 0\.\.1/);
    for (const core of ["escape", "bulb", "escape4"] as const) {
      expect(() =>
        surfaceDeKernelWgsl(
          kernelOpts({
            core,
            chaos: { activeStateCount: 1, predecessorMasks: [1] },
          }),
        ),
      ).toThrow(/graph-directed.*descent cores/);
    }
  });
});

describe("finite reflection tiling WGSL and params ABI", () => {
  const tiled3 = resolveTiling({ group: "b3", clip: GEAR_SHAPE })!;
  const tiled4 = resolveTiling({ group: "f4", clip: GEAR_SHAPE })!;
  const plane: SurfaceGpuGroundPlane = {
    y: -1.25,
    fadeStart: 2,
    fadeEnd: 4,
    ballCenter: [0, 0, 0],
    ballRadius: 4,
    albedo: [0.4, 0.5, 0.6],
  };

  function expectTilingTail(
    plain: ArrayBuffer,
    tiled: ArrayBuffer,
    tiling: ResolvedFiniteTiling,
  ): void {
    expect(SURFACE_GPU_TILING_BYTES).toBe(16);
    expect(tiled.byteLength).toBe(plain.byteLength + 16);
    expect(new Uint8Array(tiled, 0, plain.byteLength)).toEqual(
      new Uint8Array(plain),
    );
    const view = new DataView(tiled);
    expect(view.getUint32(plain.byteLength, true)).toBe(
      tilingGroupCode(tiling.group),
    );
    expect(Array.from(new Uint8Array(tiled, plain.byteLength + 4, 12))).toEqual(
      new Array(12).fill(0),
    );
  }

  function withTilingChaos3(de: SurfaceDE): SurfaceDE {
    return {
      ...de,
      chaos: {
        activeStateCount: 1,
        predecessorMasks: Uint32Array.of(1),
        emitterStateIndices: Uint8Array.from(
          de.condensation?.emitters.map(() => 0) ?? [],
        ),
      },
    };
  }

  function withTilingChaos4(de: SurfaceDE4): SurfaceDE4 {
    return {
      ...de,
      chaos: {
        activeStateCount: 1,
        predecessorMasks: Uint32Array.of(1),
        emitterStateIndices: Uint8Array.from(
          de.condensation?.emitters.map(() => 0) ?? [],
        ),
      },
    };
  }

  it("keeps omitted, undefined, and null source byte-identical for all seven cores in every mode", () => {
    for (const core of [
      "affine",
      "fold",
      "escape",
      "bulb",
      "affine4",
      "fold4",
      "escape4",
    ] as const) {
      for (const mode of ["eval", "march", "shade"] as const) {
        const classic = surfaceDeKernelWgsl(kernelOpts({ core, mode }));
        expect(
          surfaceDeKernelWgsl(kernelOpts({ core, mode, tiling: undefined })),
        ).toBe(classic);
        expect(
          surfaceDeKernelWgsl(kernelOpts({ core, mode, tiling: null })),
        ).toBe(classic);
        expect(classic).not.toContain("tilingGroup");
        expect(classic).not.toContain("TilingFoldResult");
      }
    }
  });

  it("wraps all seven public cores outside their untouched bodies and emits the shared dimensional fold plus analytic clip", () => {
    for (const core of ["affine", "fold", "escape", "bulb"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ core, mode: "shade", tiling: tiled3, pattern: true }),
      );
      expect(wgsl).toContain(tilingFoldSource(tiled3.info, "wgsl"));
      expect(wgsl).toContain("tilingGroup: u32");
      expect(wgsl).toContain(
        `if (params.tilingGroup != ${tilingGroupCode(tiled3.group)}u)`,
      );
      expect(wgsl).toContain("fn tilingClipSdf(p: vec3f) -> f32");
      expect(wgsl).toContain("fn surfaceDETilingCore(");
      expect(wgsl).toContain("fn surfaceDE(pIn: vec3f");
      expect(wgsl).toContain("let folded = tilingFold(pIn);");
      expect(wgsl).toContain("return max(inner, tilingClipSdf(folded.point));");
      expect(wgsl).toContain("info.tilingPoint = vec4f(folded.point, 0.0)");
    }

    for (const core of ["affine4", "fold4", "escape4"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ core, mode: "shade", tiling: tiled4, pattern: true }),
      );
      // This exact shared-emitter inclusion pins F4's named fourth root,
      // including its non-zero w coefficient, instead of accepting a 3D
      // root table padded with zero.
      expect(wgsl).toContain(tilingFoldSource(TILING_GROUP_INFO.f4, "wgsl"));
      expect(wgsl).toContain("point: vec4f");
      expect(wgsl).toContain("fn surfaceDETilingCore(qIn: vec4f");
      expect(wgsl).toContain("fn surfaceDE(pIn: vec3f");
      expect(wgsl).toContain(
        "return max(inner, tilingClipSdf(folded.point.xyz));",
      );
      expect(wgsl).toContain("info.tilingPoint = folded.point");
      if (core === "escape4") {
        expect(wgsl).toContain("let folded = tilingFold(liftEscape4(pIn));");
        expect(wgsl).toContain("surfaceDETilingCore(folded.point, cutoff, li)");
      } else {
        expect(wgsl).toContain(
          "let folded = tilingFold(rotorInvApply4(vec4f(pIn, params.w0)));",
        );
        expect(wgsl).toContain(
          "surfaceDETilingCore(folded.point, vec4f(0.0), cutoff, li)",
        );
      }
    }
  });

  it("composes outside lens, probe, floor, finish, pattern, condensation, schedule, chaos, and forward trap variants", () => {
    const descent = surfaceDeKernelWgsl(
      kernelOpts({
        core: "fold4",
        mode: "shade",
        tiling: tiled4,
        lens: true,
        groundPlane: true,
        finish: true,
        pattern: true,
        shadeDeWidth: 1,
        schedule: { mapCount: 1, scheduleMapCount: 1 },
        condensation: {
          mapCount: 1,
          emitters: [{ shape: CONDENSATION_SPHERE, shadeIndex: 1 }],
        },
        chaos: { activeStateCount: 1, predecessorMasks: [1] },
      }),
    );
    expect(descent).toContain("fn surfaceDEProbeTilingCore(");
    expect(descent).toContain("fn surfaceDEProbe(pIn: vec3f");
    expect(descent).toContain("fn shadeGroundPlane(");
    expect(descent).toContain("fn finishShade(");
    expect(descent).toContain("fn patternShade(");
    expect(descent).toContain("fn condensationTerm(");
    expect(descent).toContain("fn scheduleBound(");
    expect(descent).toContain("fn chaosAllows(");

    const trap = resolveShapeTrap({
      shape: PEACE_SIGN_SHAPE,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      mode: "threshold",
      threshold: 0.2,
      fade: 0.05,
    });
    const forward = surfaceDeKernelWgsl(
      kernelOpts({
        core: "escape",
        mode: "shade",
        tiling: tiled3,
        groundPlane: true,
        shapeTrap: trap.spec,
        pattern: true,
      }),
    );
    expect(forward).toContain("shapeTrap: f32");
    expect(forward).toContain("tilingPoint: vec4f");
    expect(forward).toContain("fn surfaceDEHitInfoTilingCore(");
  });

  it("appends one live word and twelve zero pad bytes for the packer serving every core", () => {
    const surface3 = buildSurfaceDE(foldSystemTransforms());
    const escape3 = buildEscapeDE([canonicalMandelbox(), rotatedBoxfold()]);
    const bulb = buildBulbDE([canonicalBulb()]);
    const surface4 = buildSurfaceDE4(fourDSystemTransforms());
    const escape4 = buildEscapeDE4([
      escape4Mandelbox(),
      escape4RotatedBoxfold(),
    ]);
    const run = { itemCount: 3 };

    const packers = [
      {
        name: "affine",
        plain: () => packSurfaceGpuParams(surface3, run),
        tiled: () => packSurfaceGpuParams(surface3, run, null, null, tiled3),
        tiling: tiled3,
      },
      {
        name: "fold",
        plain: () => packSurfaceGpuParams(surface3, run),
        tiled: () => packSurfaceGpuParams(surface3, run, null, null, tiled3),
        tiling: tiled3,
      },
      {
        name: "escape",
        plain: () => packEscapeGpuParams(escape3, run),
        tiled: () => packEscapeGpuParams(escape3, run, null, null, tiled3),
        tiling: tiled3,
      },
      {
        name: "bulb",
        plain: () => packBulbGpuParams(bulb, run),
        tiled: () => packBulbGpuParams(bulb, run, null, null, tiled3),
        tiling: tiled3,
      },
      {
        name: "affine4",
        plain: () => packSurface4GpuParams(surface4, view4(), run),
        tiled: () =>
          packSurface4GpuParams(surface4, view4(), run, null, null, tiled4),
        tiling: tiled4,
      },
      {
        name: "fold4",
        plain: () => packSurface4GpuParams(surface4, view4(), run),
        tiled: () =>
          packSurface4GpuParams(surface4, view4(), run, null, null, tiled4),
        tiling: tiled4,
      },
      {
        name: "escape4",
        plain: () => packEscape4GpuParams(escape4, view4(), run),
        tiled: () =>
          packEscape4GpuParams(escape4, view4(), run, null, null, tiled4),
        tiling: tiled4,
      },
    ];
    for (const entry of packers) {
      expect(entry.name).toBeTruthy();
      expectTilingTail(entry.plain(), entry.tiled(), entry.tiling);
    }
  });

  it("places the tiling word after every 3D and 4D descent-tail combination, including the corrected 560/848 maxima", () => {
    for (const dimension of [3, 4] as const) {
      for (const condensation of [false, true]) {
        for (const schedule of [false, true]) {
          for (const chaos of [false, true]) {
            for (const groundPlane of [false, true]) {
              if (dimension === 3) {
                let de = condensation
                  ? buildSurfaceDE(condensationTransforms(), null, undefined, {
                      condensationDepthBand: { minDepth: 1, maxDepth: 3 },
                    })
                  : buildSurfaceDE(foldSystemTransforms());
                if (schedule) de = withSchedule3(de, 1, 1);
                if (chaos) de = withTilingChaos3(de);
                const gp = groundPlane ? plane : null;
                const plain = packSurfaceGpuParams(
                  de,
                  { itemCount: 1 },
                  null,
                  gp,
                );
                const tiled = packSurfaceGpuParams(
                  de,
                  { itemCount: 1 },
                  null,
                  gp,
                  tiled3,
                );
                expectTilingTail(plain, tiled, tiled3);
                if (condensation && schedule && chaos && groundPlane) {
                  expect(tiled.byteLength).toBe(560);
                }
              } else {
                let de = condensation
                  ? buildSurfaceDE4(condensationTransforms(), null, undefined, {
                      condensationDepthBand: { minDepth: 1, maxDepth: 3 },
                    })
                  : buildSurfaceDE4(fourDSystemTransforms());
                if (schedule) de = withSchedule4(de, 1, 1);
                if (chaos) de = withTilingChaos4(de);
                const gp = groundPlane ? plane : null;
                const plain = packSurface4GpuParams(
                  de,
                  view4(),
                  { itemCount: 1 },
                  null,
                  gp,
                );
                const tiled = packSurface4GpuParams(
                  de,
                  view4(),
                  { itemCount: 1 },
                  null,
                  gp,
                  tiled4,
                );
                expectTilingTail(plain, tiled, tiled4);
                if (condensation && schedule && chaos && groundPlane) {
                  expect(tiled.byteLength).toBe(848);
                }
              }
            }
          }
        }
      }
    }
  });

  it("appends after the lens and every forward trap tail without moving a frozen byte", () => {
    const lens3 = buildSurfaceDE(
      foldSystemTransforms(),
      spherefoldFinalTransform(),
    );
    const lens4 = buildSurfaceDE4(
      fourDSystemTransforms(),
      fourDBoxfoldFinalTransform(),
    );
    expectTilingTail(
      packSurfaceGpuParams(lens3, { itemCount: 1 }),
      packSurfaceGpuParams(lens3, { itemCount: 1 }, null, null, tiled3),
      tiled3,
    );
    expectTilingTail(
      packSurface4GpuParams(lens4, view4(), { itemCount: 1 }),
      packSurface4GpuParams(
        lens4,
        view4(),
        { itemCount: 1 },
        null,
        null,
        tiled4,
      ),
      tiled4,
    );

    const trap = resolveShapeTrap({
      shape: PEACE_SIGN_SHAPE,
      position: [0.3, -0.2, 0.5],
      rotation: [0.2, 0, 0.4],
      scale: 0.7,
      mode: "threshold",
      threshold: 0.3,
      fade: 0.05,
    });
    const escape3 = buildEscapeDE([canonicalMandelbox()]);
    const bulb = buildBulbDE([canonicalBulb()]);
    const escape4 = buildEscapeDE4([escape4Mandelbox()]);
    expectTilingTail(
      packEscapeGpuParams(escape3, { itemCount: 1 }, null, trap),
      packEscapeGpuParams(escape3, { itemCount: 1 }, null, trap, tiled3),
      tiled3,
    );
    expectTilingTail(
      packBulbGpuParams(bulb, { itemCount: 1 }, null, trap),
      packBulbGpuParams(bulb, { itemCount: 1 }, null, trap, tiled3),
      tiled3,
    );
    expectTilingTail(
      packEscape4GpuParams(escape4, view4(), { itemCount: 1 }, null, trap),
      packEscape4GpuParams(
        escape4,
        view4(),
        { itemCount: 1 },
        null,
        trap,
        tiled4,
      ),
      tiled4,
    );
  });

  it("defensively refuses wrong-dimensional, non-canonical, mesh, balloon, kaleidoscope, and real-slab combinations", () => {
    const wrong3 = resolveTiling({ group: "a4" })!;
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ core: "fold", tiling: wrong3 })),
    ).toThrow(/a4 is 4D.*3D core/);
    expect(() =>
      packSurface4GpuParams(
        buildSurfaceDE4(fourDSystemTransforms()),
        view4(),
        { itemCount: 1 },
        null,
        null,
        tiled3,
      ),
    ).toThrow(/b3 is 3D.*4D core/);

    const nonCanonical = {
      ...tiled3,
      info: { ...tiled3.info },
    } satisfies ResolvedFiniteTiling;
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ tiling: nonCanonical })),
    ).toThrow(/canonical resolveTiling result/);
    const meshTiling = resolveTiling({ group: "b3", clip: MESH_SHAPE })!;
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ tiling: meshTiling })),
    ).toThrow(/mesh-bearing tiling clips/);
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ tiling: tiled3, balloon: true })),
    ).toThrow(/tiling\+balloon/);

    const symmetric3: SurfaceDE = {
      ...buildSurfaceDE(foldSystemTransforms()),
      symmetry: {
        ...buildSurfaceDE(foldSystemTransforms()).symmetry,
        order: 3,
      },
    };
    expect(() =>
      packSurfaceGpuParams(symmetric3, { itemCount: 1 }, null, null, tiled3),
    ).toThrow(/tiling\+kaleidoscope/);
    expect(() =>
      packSurface4GpuParams(
        buildSurfaceDE4(fourDSystemTransforms()),
        view4({ sliceHalfW: 0.1 }),
        { itemCount: 1 },
        null,
        null,
        tiled4,
      ),
    ).toThrow(/tiling\+4D slab/);

    const balloon = {
      center: [0, 0, 0] as [number, number, number],
      rho: 1,
      R: 2,
      far: 4,
    };
    expect(() =>
      packSurfaceGpuParams(
        buildSurfaceDE(foldSystemTransforms()),
        { itemCount: 1 },
        balloon,
        null,
        tiled3,
      ),
    ).toThrow(/tiling\+balloon/);
  });
});

describe("mirrored lattice WGSL and params ABI", () => {
  const lattice3 = resolveTiling(
    { kind: "lattice", cellScale: 1.75, clip: GEAR_SHAPE },
    3.25,
  );
  const lattice4 = resolveTiling(
    { kind: "lattice", cellScale: 1.5, clip: GEAR_SHAPE },
    5.5,
  );
  const plane: SurfaceGpuGroundPlane = {
    y: -1.25,
    fadeStart: 2,
    fadeEnd: 4,
    ballCenter: [0, 0, 0],
    ballRadius: 4,
    albedo: [0.4, 0.5, 0.6],
  };

  function expectLatticeTail(
    plain: ArrayBuffer,
    tiled: ArrayBuffer,
    tiling: ResolvedLatticeTiling,
  ): void {
    expect(SURFACE_GPU_TILING_BYTES).toBe(16);
    expect(tiled.byteLength).toBe(plain.byteLength + 16);
    expect(new Uint8Array(tiled, 0, plain.byteLength)).toEqual(
      new Uint8Array(plain),
    );
    const view = new DataView(tiled);
    expect(view.getUint32(plain.byteLength, true)).toBe(LATTICE_TILING_CODE);
    expect(view.getFloat32(plain.byteLength + 4, true)).toBe(
      Math.fround(tiling.h),
    );
    // The tail's third word: the PROVISIONAL presentation window radius
    // (authority radius times the shared multiplier), zero for finite
    // tails. Only the final pad word stays zero.
    expect(view.getFloat32(plain.byteLength + 8, true)).toBe(
      Math.fround(tiling.radius * LATTICE_PRESENTATION_RADIUS_MULT),
    );
    expect(Array.from(new Uint8Array(tiled, plain.byteLength + 12, 4))).toEqual(
      new Array(4).fill(0),
    );
  }

  it("emits the floor-modulo x/z lattice and mandatory ball wrapper for every 3D core and mode", () => {
    for (const core of ["affine", "fold", "escape", "bulb"] as const) {
      for (const mode of ["eval", "march", "shade"] as const) {
        const wgsl = surfaceDeKernelWgsl(
          kernelOpts({ core, mode, tiling: lattice3, pattern: true }),
        );
        expect(wgsl).toContain(latticeFoldSource("wgsl", 3, "tilingFold"));
        expect(wgsl).toContain("tilingGroup: u32");
        expect(wgsl).toContain("tilingH: f32");
        expect(wgsl).toContain(
          `if (params.tilingGroup != ${LATTICE_TILING_CODE}u)`,
        );
        expect(wgsl).toContain("let folded = tilingFold(pIn, params.tilingH);");
        expect(wgsl).toContain(
          `let bounded = max(inner, length(folded) - params.${
            core === "affine" || core === "fold"
              ? "visibleRadius"
              : "boundingRadius"
          });`,
        );
        expect(wgsl).toContain("return max(bounded, tilingClipSdf(folded));");
        expect(wgsl).not.toContain("q.y = tilingFoldCoordinate");
        if (mode === "shade") {
          expect(wgsl).toContain(
            "let folded = tilingFold(rawTilingPoint, params.tilingH);",
          );
          expect(wgsl).toContain("info.tilingPoint = vec4f(folded, 0.0)");
        }
      }
    }
  });

  it("lifts before the x/z/w fold and uses the full 4D authority ball for every 4D core and mode", () => {
    for (const core of ["affine4", "fold4", "escape4"] as const) {
      for (const mode of ["eval", "march", "shade"] as const) {
        const wgsl = surfaceDeKernelWgsl(
          kernelOpts({ core, mode, tiling: lattice4, pattern: true }),
        );
        expect(wgsl).toContain(latticeFoldSource("wgsl", 4, "tilingFold"));
        expect(wgsl).toContain("q.w = tilingFoldCoordinate(q.w, h);");
        const lift =
          core === "escape4"
            ? "liftEscape4(pIn)"
            : "rotorInvApply4(vec4f(pIn, params.w0))";
        expect(wgsl).toContain(
          `let folded = tilingFold(${lift}, params.tilingH);`,
        );
        expect(wgsl).toContain(
          `let bounded = max(inner, length(folded) - params.${
            core === "escape4" ? "boundingRadius" : "visRadius4"
          });`,
        );
        expect(wgsl).toContain(
          "return max(bounded, tilingClipSdf(folded.xyz));",
        );
        if (mode === "shade") {
          expect(wgsl).toContain(
            "let folded = tilingFold(rawTilingPoint, params.tilingH);",
          );
          expect(wgsl).toContain("info.tilingPoint = folded");
        }
      }
    }
  });

  it("packs code, h, and zero padding through all five packers without moving a classic byte", () => {
    const surface3 = buildSurfaceDE(foldSystemTransforms());
    const escape3 = buildEscapeDE([canonicalMandelbox(), rotatedBoxfold()]);
    const bulb = buildBulbDE([canonicalBulb()]);
    const surface4 = buildSurfaceDE4(fourDSystemTransforms());
    const escape4 = buildEscapeDE4([
      escape4Mandelbox(),
      escape4RotatedBoxfold(),
    ]);
    const run = { itemCount: 3 };
    const tiledSurface3 = resolveTiling(
      { kind: "lattice", cellScale: 1.25 },
      surface3.visibleBoundingRadius,
    );
    const tiledEscape3 = resolveTiling(
      { kind: "lattice", cellScale: 1.5 },
      escape3.boundingRadius,
    );
    const tiledBulb = resolveTiling(
      { kind: "lattice", cellScale: 2 },
      bulb.boundingRadius,
    );
    const tiledSurface4 = resolveTiling(
      { kind: "lattice", cellScale: 1.75 },
      surface4.visibleBoundingRadius,
    );
    const tiledEscape4 = resolveTiling(
      { kind: "lattice", cellScale: 2.25 },
      escape4.boundingRadius,
    );

    expectLatticeTail(
      packSurfaceGpuParams(surface3, run),
      packSurfaceGpuParams(surface3, run, null, null, tiledSurface3),
      tiledSurface3,
    );
    expectLatticeTail(
      packEscapeGpuParams(escape3, run),
      packEscapeGpuParams(escape3, run, null, null, tiledEscape3),
      tiledEscape3,
    );
    expectLatticeTail(
      packBulbGpuParams(bulb, run),
      packBulbGpuParams(bulb, run, null, null, tiledBulb),
      tiledBulb,
    );
    expectLatticeTail(
      packSurface4GpuParams(surface4, view4(), run),
      packSurface4GpuParams(surface4, view4(), run, null, null, tiledSurface4),
      tiledSurface4,
    );
    expectLatticeTail(
      packEscape4GpuParams(escape4, view4(), run),
      packEscape4GpuParams(escape4, view4(), run, null, null, tiledEscape4),
      tiledEscape4,
    );
  });

  it("keeps the lattice tail at the corrected 560/848 maxima", () => {
    let de3 = buildSurfaceDE(condensationTransforms(), null, undefined, {
      condensationDepthBand: { minDepth: 1, maxDepth: 3 },
    });
    de3 = withSchedule3(de3, 1, 1);
    de3 = {
      ...de3,
      chaos: {
        activeStateCount: 1,
        predecessorMasks: Uint32Array.of(1),
        emitterStateIndices: Uint8Array.from(
          de3.condensation?.emitters.map(() => 0) ?? [],
        ),
      },
    };
    const tiled3 = resolveTiling(
      { kind: "lattice", cellScale: 1.5 },
      de3.visibleBoundingRadius,
    );
    const plain3 = packSurfaceGpuParams(de3, { itemCount: 1 }, null, plane);
    const packed3 = packSurfaceGpuParams(
      de3,
      { itemCount: 1 },
      null,
      plane,
      tiled3,
    );
    expectLatticeTail(plain3, packed3, tiled3);
    expect(packed3.byteLength).toBe(560);

    let de4 = buildSurfaceDE4(condensationTransforms(), null, undefined, {
      condensationDepthBand: { minDepth: 1, maxDepth: 3 },
    });
    de4 = withSchedule4(de4, 1, 1);
    de4 = {
      ...de4,
      chaos: {
        activeStateCount: 1,
        predecessorMasks: Uint32Array.of(1),
        emitterStateIndices: Uint8Array.from(
          de4.condensation?.emitters.map(() => 0) ?? [],
        ),
      },
    };
    const tiled4 = resolveTiling(
      { kind: "lattice", cellScale: 1.25 },
      de4.visibleBoundingRadius,
    );
    const plain4 = packSurface4GpuParams(
      de4,
      view4(),
      { itemCount: 1 },
      null,
      plane,
    );
    const packed4 = packSurface4GpuParams(
      de4,
      view4(),
      { itemCount: 1 },
      null,
      plane,
      tiled4,
    );
    expectLatticeTail(plain4, packed4, tiled4);
    expect(packed4.byteLength).toBe(848);
  });

  it("refuses non-resolver lattice data, authority-radius mismatches, mesh clips, balloon, kaleidoscope, and real slabs", () => {
    const malformed = { ...lattice3, h: lattice3.h + 1 };
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ tiling: malformed })),
    ).toThrow(/canonical resolveTiling result/);

    const surface3 = buildSurfaceDE(foldSystemTransforms());
    expect(() =>
      packSurfaceGpuParams(surface3, { itemCount: 1 }, null, null, lattice3),
    ).toThrow(/does not match the estimator authority/);
    const escape3 = buildEscapeDE([canonicalMandelbox()]);
    expect(() =>
      packEscapeGpuParams(escape3, { itemCount: 1 }, null, null, lattice3),
    ).toThrow(/does not match the estimator authority/);
    const surface4 = buildSurfaceDE4(fourDSystemTransforms());
    expect(() =>
      packSurface4GpuParams(
        surface4,
        view4(),
        { itemCount: 1 },
        null,
        null,
        lattice4,
      ),
    ).toThrow(/does not match the estimator authority/);

    const meshLattice = resolveTiling(
      { kind: "lattice", cellScale: 1.5, clip: MESH_SHAPE },
      3,
    );
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ tiling: meshLattice })),
    ).toThrow(/mesh-bearing tiling clips/);
    expect(() =>
      surfaceDeKernelWgsl(kernelOpts({ tiling: lattice3, balloon: true })),
    ).toThrow(/tiling\+balloon/);

    const symmetric3: SurfaceDE = {
      ...surface3,
      symmetry: { ...surface3.symmetry, order: 3 },
    };
    const symmetricTiling = resolveTiling(
      { kind: "lattice", cellScale: 1.5 },
      symmetric3.visibleBoundingRadius,
    );
    expect(() =>
      packSurfaceGpuParams(
        symmetric3,
        { itemCount: 1 },
        null,
        null,
        symmetricTiling,
      ),
    ).toThrow(/tiling\+kaleidoscope/);

    const surfaceTiling4 = resolveTiling(
      { kind: "lattice", cellScale: 1.5 },
      surface4.visibleBoundingRadius,
    );
    expect(() =>
      packSurface4GpuParams(
        surface4,
        view4({ sliceHalfW: 0.1 }),
        { itemCount: 1 },
        null,
        null,
        surfaceTiling4,
      ),
    ).toThrow(/tiling\+4D slab/);
  });

  it("marches and shades through the presentation carrier in 3D with an out-of-carrier open-space probe guard", () => {
    for (const core of ["affine", "fold", "escape", "bulb"] as const) {
      const march = surfaceDeKernelWgsl(
        kernelOpts({ core, mode: "march", tiling: lattice3 }),
      );
      // The shared carrier source is emitted.
      expect(march, core).toContain("fn latticePresentationInterval(");
      expect(march, core).toContain("fn latticePresentationContains(");
      expect(march, core).toContain("struct LatticeCarrierInterval");
      // The march gate is the carrier interval, not the sphere gate.
      expect(march, core).toContain(
        "let carrier = latticePresentationInterval(ro, rd, params.",
      );
      expect(march, core).toContain(
        `if (!carrier.ok || params.tilingGroup != ${LATTICE_TILING_CODE}u)`,
      );
      expect(march, core).toContain("let tFar = carrier.tFar;");
      expect(march, core).toContain("t = carrier.tEnter;");
      expect(march, core).not.toContain(
        "let radius = params.visibleRadius * 1.02;",
      );
      expect(march, core).not.toContain("let disc = bq * bq - cq;");
      // The struct declares the presentation radius in the lattice tail.
      expect(march, core).toContain("tilingPresentationR: f32");

      const shade = surfaceDeKernelWgsl(
        kernelOpts({ core, mode: "shade", tiling: lattice3 }),
      );
      // The wrapper's probe guard: out-of-carrier taps are open space.
      expect(shade, core).toContain(
        "if (!latticePresentationContains(pIn, params.",
      );
      expect(shade, core).toContain("return 2.0 * params.tilingPresentationR;");
      // The shade entry recomputes the carrier for the fog origin and
      // bounds shadow rays by their own carrier.
      expect(shade, core).toContain(
        "let carrier = latticePresentationInterval(ro, rd, params.",
      );
      expect(shade, core).toContain(
        "let tEnter = select(t, max(carrier.tEnter, 0.0), carrier.ok);",
      );
      expect(shade, core).toContain(
        "let shadowCarrier = latticePresentationInterval(pos + n * h * 2.0, shade.lightDir, params.",
      );
      expect(shade, core).toContain(
        "shadow < 0.02 || !shadowCarrier.ok || ts > shadowCarrier.tFar",
      );
      // The 3D fog keeps the visibleRadius normalizer (it IS the
      // authority for inverse cores; boundingRadius for forward).
      expect(shade, core).toContain("max(visR, 1.0e-6)");
    }
  });

  it("4D cores pass the inverse rotor's y row to the carrier and normalize fog by the full radius", () => {
    for (const core of ["affine4", "fold4", "escape4"] as const) {
      const wgsl = surfaceDeKernelWgsl(
        kernelOpts({ core, mode: "shade", tiling: lattice4 }),
      );
      // The packed rotorInv rows ARE the inverse rotor's rows, so the y
      // row is rotorInvR1 itself — never an assembled column. (The height
      // color source's assembled column is a DIFFERENT quantity: the
      // world y of the folded hit, the GLSL transpose lift's twin.)
      expect(wgsl, core).toContain(
        "latticePresentationInterval(ro, rd, params.w0, params.rotorInvR1,",
      );
      expect(wgsl, core).toContain(
        "latticePresentationContains(pIn, params.w0, params.rotorInvR1,",
      );
      // The 4D march gate adds the slab refusal.
      const march = surfaceDeKernelWgsl(
        kernelOpts({ core, mode: "march", tiling: lattice4 }),
      );
      expect(march, core).toContain(" || params.sliceHalfW > 0.0)");
      // The 4D hit fog normalizes by the full certified radius, never
      // the slice-adjusted visibleRadius slot.
      expect(wgsl, core).toContain("max(params.visRadius4, 1.0e-6)");
      expect(wgsl, core).not.toContain(`max(visR, 1.0e-6)`);
    }
  });

  it("replaces the ground plane's ball corridor and AO reach with carrier tests under lattice", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({
        core: "fold",
        mode: "shade",
        tiling: lattice3,
        groundPlane: true,
      }),
    );
    expect(wgsl).toContain(
      "let gShadowCarrier = latticePresentationInterval(hp, shade.lightDir, params.",
    );
    expect(wgsl).toContain("if (gShadowCarrier.ok) {");
    expect(wgsl).toContain("shadow < 0.02 || ts > gShadowCarrier.tFar");
    expect(wgsl).not.toContain("let corridor = gR * 1.05 + 0.3 * along;");
    expect(wgsl).not.toContain(
      "let reach = gR * (1.02 + 0.04 * f32(shade.aoTaps));",
    );
    // Non-lattice ground planes keep the shipped corridor verbatim.
    const plain = surfaceDeKernelWgsl(
      kernelOpts({ core: "fold", mode: "shade", groundPlane: true }),
    );
    expect(plain).toContain("let corridor = gR * 1.05 + 0.3 * along;");
    expect(plain).toContain(
      "let reach = gR * (1.02 + 0.04 * f32(shade.aoTaps));",
    );
    expect(plain).not.toContain("latticePresentationInterval");
  });
});
