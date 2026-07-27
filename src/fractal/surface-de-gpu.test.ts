import {
  packSurfaceGpuMaps,
  packSurfaceGpuParams,
  packSurfaceGpuShade,
  packSurfaceGpuShadeMaps,
  SURFACE_GPU_HIT_FLOOR,
  SURFACE_GPU_MAP_VEC4,
  SURFACE_GPU_PARAMS_BYTES,
  SURFACE_GPU_RAY_ACTIVE,
  SURFACE_GPU_RAY_EXHAUSTED,
  SURFACE_GPU_RAY_HIT,
  SURFACE_GPU_RAY_MISS,
  SURFACE_GPU_SHADE_BYTES,
  surfaceDeKernelWgsl,
  surfaceGpuWorkgroupBytes,
} from "./surface-de-gpu";
import type {
  SurfaceGpuKernelOptions,
  SurfaceGpuPose,
  SurfaceGpuShadeParams,
} from "./surface-de-gpu";
import { buildSurfaceDE, SURFACE_FOLD_BOXFOLD } from "./surface-de";
import type { SurfaceDE } from "./surface-de";
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
  it("returns an ArrayBuffer of exactly SURFACE_GPU_PARAMS_BYTES (208 bytes, per the module doc)", () => {
    expect(SURFACE_GPU_PARAMS_BYTES).toBe(208);
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

  it("maps symmetry axis x/y/z to symAxis 0/1/2 at offset 44", () => {
    for (const [axis, expected] of [
      ["x", 0],
      ["y", 1],
      ["z", 2],
    ] as const) {
      const de = buildSurfaceDE(foldSystemTransforms(), null, {
        order: 1,
        axis,
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

  it("throws when the DE has a foldFinal lens (out of spike scope)", () => {
    const de = buildSurfaceDE(foldSystemTransforms());
    const withFoldFinal: SurfaceDE = {
      ...de,
      foldFinal: {
        invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        invT: [0, 0, 0],
        sigmaMin: 1,
        foldKind: SURFACE_FOLD_BOXFOLD,
        invW: 1,
        absW: 1,
      },
    };
    expect(() => packSurfaceGpuParams(withFoldFinal, { itemCount: 1 })).toThrow(
      /foldFinal/,
    );
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

/** Full mode-"image" shading params, overridable per test — distinct
 * exactly-representable values per field so any offset mixup shows up as
 * the wrong value, not a coincidental match. */
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
  it("returns an ArrayBuffer of exactly SURFACE_GPU_SHADE_BYTES (128 bytes, per the module doc)", () => {
    expect(SURFACE_GPU_SHADE_BYTES).toBe(128);
    const buf = packSurfaceGpuShade(shadeParams());
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(SURFACE_GPU_SHADE_BYTES);
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

  it("mode 'image' generates fn marchShadeRays on top of the march ray-state bindings and no evalQueries", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "image" }));
    expect(wgsl).toContain("fn marchShadeRays");
    expect(wgsl).toContain("var<storage, read> activeList: array<u32>;");
    expect(wgsl).toContain("var<storage, read_write> states: array<vec4f>;");
    expect(wgsl).not.toContain("fn evalQueries");
  });

  it("mode 'image' declares the shading interface at bindings 4-8 (shade/shadeMaps/colorOut/lutTex/lutSamp)", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "image" }));
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

  it("mode 'image' emits the greedy hit-info descent and packs pixels with pack4x8unorm", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "image" }));
    expect(wgsl).toContain("fn surfaceDEHitInfo");
    expect(wgsl).toContain("pack4x8unorm");
  });

  it("mode 'image' gates the march-start hash dither behind the flags bit", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "image" }));
    expect(wgsl).toContain("(shade.flags & 1u) != 0u");
    expect(wgsl).toContain("hash2(");
  });
});

describe("surfaceDeKernelWgsl image-mode isolation (eval/march output unchanged)", () => {
  it("mode 'eval' output contains none of the image-only markers", () => {
    const wgsl = surfaceDeKernelWgsl(kernelOpts({ mode: "eval" }));
    expect(wgsl).not.toContain("ShadeParams");
    expect(wgsl).not.toContain("binding(4)");
    expect(wgsl).not.toContain("marchShadeRays");
    expect(wgsl).not.toContain("shade");
  });

  it("mode 'march' output contains none of the image-only markers — not even the 'shade' substring", () => {
    const wgsl = surfaceDeKernelWgsl(
      kernelOpts({ mode: "march", sharedFrontier: true, bnbStage2: true }),
    );
    expect(wgsl).not.toContain("ShadeParams");
    expect(wgsl).not.toContain("binding(4)");
    expect(wgsl).not.toContain("marchShadeRays");
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
