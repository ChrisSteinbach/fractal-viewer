import {
  encodeSurfaceComputeHdr,
  setSurfaceComputeSchedulePins,
  surfaceComputeLightingVisibility,
  fitSurfaceComputeRaster,
  surfaceComputeJointArenaBytes,
  SURFACE_COMPUTE_JOINT_ARENA_BYTES,
  foldSurfaceComputeLayerSample,
  encodeSurfaceComputeLayerMean,
  initialShadeHitCost,
  marchChunkFor,
  nextLightingRayCap,
  nextShadeBatchSize,
  nextShadeHitCost,
  nextStepsPerPass,
  resampleSurfacePixels,
  shadeHitBatchSize,
  SURFACE_COMPUTE_TRANSPORT_DISPATCH_CEILING_MS,
  transportBatchSize,
  nextTransportQuantum,
  transportQuantumCap,
  SURFACE_COMPUTE_TRANSPORT_QUANTUM_TARGET_MS,
  shadeHitAllowanceUs,
  shadeHitBudgetUs,
  SURFACE_COMPUTE_MARCH_CHUNK_MIN,
  SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH,
  SURFACE_COMPUTE_MAX_STEPS_PER_PASS,
  SURFACE_COMPUTE_MAX_TILE_RAYS,
  SURFACE_COMPUTE_PASS_TARGET_MS,
  SURFACE_COMPUTE_RAY_STATE_BYTES,
  SURFACE_COMPUTE_RAY_BYTES,
  SURFACE_COMPUTE_LIGHTING_RAY_BYTES,
  SURFACE_COMPUTE_SHADE_COST_PIVOT,
  SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS,
  SURFACE_COMPUTE_SHADE_MARGINAL_DECAY,
  SURFACE_COMPUTE_SHADE_HIT_CAP_START,
  SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST,
  SURFACE_COMPUTE_WORKGROUP_SIZE,
  surfaceComputeDispatchWorkMs,
  surfaceComputeFenceGroupAllowanceMs,
  surfaceComputeFenceGroupSize,
  surfaceComputeFenceGroupStagedFull,
  SURFACE_COMPUTE_FENCE_GROUP_STAGED_BYTES,
  surfaceComputeFenceRoundTripMs,
  surfaceComputeGpuGroupMs,
  surfaceComputeGroupDispatchMs,
  SURFACE_COMPUTE_FENCE_GROUP_MAX,
  SURFACE_COMPUTE_FENCE_GROUP_MS,
  SURFACE_COMPUTE_JOB_WATCHDOG_MARGIN,
  SURFACE_COMPUTE_JOB_WATCHDOG_MS,
  surfaceComputeLightingRayBatch,
  surfaceComputePassDurationsMs,
  SURFACE_COMPUTE_TS_QUERY_CAPACITY,
  SurfaceComputeRenderer,
  surfaceComputeTargetMeshIds,
  surfaceComputeMaxDispatchRays,
  surfaceComputeMaxFrameRays,
  surfaceComputeProgressDone,
  surfaceComputeSeedDispatches,
  surfaceComputeTileRows,
  subPixelSample,
} from "./surface-compute";
import type {
  SurfaceComputeFrameSpec,
  SurfaceComputeAnyTarget,
  SurfaceComputeTarget,
} from "./surface-compute";
import {
  SURFACE_GPU_CHAOS_BYTES,
  SURFACE_GPU_RAY_MISS,
  SURFACE_GPU_RAY_HIT,
  SURFACE_GPU_TRANSPORT_COMPLETE,
  SURFACE_GPU_TRANSPORT_PENDING,
  SURFACE_GPU_TRANSPORT_INVALID,
  SURFACE_GPU_TRANSPORT_UNRESOLVED,
  SURFACE_GPU_SHADE_LIGHTING_BYTES,
  SURFACE_GPU_HIT_FLOOR,
  SURFACE_GPU_LENS4_POST_BYTES,
  SURFACE_GPU_LENS_POST_BYTES,
  SURFACE_GPU_PARAMS4_CHAOS_BYTES,
  SURFACE_GPU_PARAMS4_ESCAPE_TILING_BYTES,
  SURFACE_GPU_PARAMS_CHAOS_BYTES,
  SURFACE_GPU_PARAMS4_TILING_BYTES,
  SURFACE_GPU_PARAMS_TILING_BYTES,
  SURFACE_GPU_PARAMS4_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_BYTES,
  surfaceDeKernelWgsl,
} from "../fractal/surface-de-gpu";
import { DIELECTRIC_REPLAY_PASSES } from "../fractal/surface-dielectric";
import { SURFACE_FULL_HIT_FLOOR } from "./surface-material";
import { surface4FragmentFor } from "./surface-material-4d";
import { identityRotorPair, rotateInPlane, rotorMatrix } from "./rotor4";
import { buildSurfaceDE } from "../fractal/surface-de";
import { buildSurfaceDE4 } from "../fractal/surface-de-4d";
import { buildEscapeDE } from "../fractal/escape-de";
import { buildEscapeDE4 } from "../fractal/escape-de-4d";
import { buildBulbDE } from "../fractal/bulb-de";
import { resolveTiling } from "../fractal/tiling";
import { resolveShapeTrap } from "../fractal/shape-trap";
import { activeMeshSdfAtlas } from "../fractal/mesh-sdf-atlas-cache";
import {
  defaultTransforms,
  foldChain,
  gearworks,
  mandelbulbClassic,
  mandelboxBrick,
  PRESET_TRAPS,
  starFoundry,
} from "../fractal/presets";
import type { Transform } from "../fractal/types";
import { resolveSphereInversion } from "../fractal/sphere-inversion";
import type { SphereInversionAuthored } from "../fractal/sphere-inversion";
import { buildSphereInversionDE } from "../fractal/sphere-inversion-de";
import { buildSphereInversionDE4 } from "../fractal/sphere-inversion-de-4d";
import { packSphereInversionGpuTables } from "../fractal/surface-sphere-inversion-gpu";
import {
  cloneSurfaceLighting,
  DEFAULT_SURFACE_LIGHTING,
  surfaceLightingRuntime,
} from "../fractal/surface-lighting";
import {
  FINITE_TRANSPORT_RUNNING,
  SPHERE_INVERSION_POOL_FRESH_BIT,
  SPHERE_INVERSION_POOL_PASS_MASK,
  SPHERE_INVERSION_POOL_RAY_BITS,
  SPHERE_INVERSION_POOL_RAY_MASK,
  SPHERE_INVERSION_POOL_SPEC_BIT,
  sphereInversionPoolWord,
  TRANSPORT_PATH_BYTES,
  finiteTransportWorkBytes,
  transportWorkBytes,
} from "../fractal/finite-transport-work";
import {
  FINITE_SOLID_HALF_EXTENT,
  analyzeFiniteSolidGeneral,
} from "../fractal/finite-solid";
import {
  finiteSolidTransportSource,
  type FiniteSolidGeneralWire,
} from "../fractal/surface-finite-solid-gpu";
import { surfaceSlotMaterials } from "./surface-slots";
import type { SurfaceMaterialSlots } from "../fractal/surface-material-wire";

describe("the two engines' full-tier hit floor (mirror pin)", () => {
  it("is ONE number: surface-de-gpu.ts's SURFACE_GPU_HIT_FLOOR is surface-material.ts's SURFACE_FULL_HIT_FLOOR", () => {
    // `SURFACE_GPU_HIT_FLOOR`'s own doc calls itself a "Mirror of
    // surface-material.ts's SURFACE_FULL_HIT_FLOOR", and this renderer's
    // `hitFloor` spec field names both — but until this test the two were
    // only ever pinned to their own literals in their own files, so
    // retuning the GLSL side left the suite green and the two engines
    // accepting hits at different distances on the same scene. The
    // equality is the claim; the literal is the second line, so a
    // deliberate retune has to move BOTH constants and this test with them.
    // Asserted here rather than beside the kernel because src/fractal/ is
    // the dependency-free core and surface-material.ts pulls in Three.js.
    expect(SURFACE_GPU_HIT_FLOOR).toBe(SURFACE_FULL_HIT_FLOOR);
    expect(SURFACE_FULL_HIT_FLOOR).toBe(1.0e-5);
  });
});

type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];

/** Read the position operand from the generated WGSL radius lift. Keeping
 * this extraction deliberately narrow makes the numeric parity cases below
 * exercise the generated shader's choice, rather than restating which choice
 * the test expects. */
function wgslBalloonRadiusSource(wgsl: string): "pos" | "colorPos" {
  const matches = [
    ...wgsl.matchAll(
      /let q4c = rotorInvApply4\(vec4f\((hi\.colorPos|pos), hitW\)\);/g,
    ),
  ];
  expect(matches).toHaveLength(1);
  return matches[0][1] === "hi.colorPos" ? "colorPos" : "pos";
}

/** GLSL twin of {@link wgslBalloonRadiusSource}. The fragment shader names
 * the balloon hit-info source `cpos`; both spellings map to the same semantic
 * source below. */
function glslBalloonRadiusSource(glsl: string): "pos" | "colorPos" {
  const matches = [
    ...glsl.matchAll(
      /vec4 q4 = uInvRotor \* vec4\((cpos|pos), uW0 \+ sStar \* uSliceHalfW\);/g,
    ),
  ];
  expect(matches).toHaveLength(1);
  return matches[0][1] === "cpos" ? "colorPos" : "pos";
}

/** Read the position operand from the generated WGSL height ramp. */
function wgslBalloonHeightSource(wgsl: string): "pos" | "colorPos" {
  const matches = [
    ...wgsl.matchAll(
      /u = clamp\((hi\.colorPos|pos)\.y \/ params\.visRadius4 \* 0\.5 \+ 0\.5, 0\.0, 1\.0\);/g,
    ),
  ];
  expect(matches).toHaveLength(1);
  return matches[0][1] === "hi.colorPos" ? "colorPos" : "pos";
}

/** GLSL twin of {@link wgslBalloonHeightSource}. */
function glslBalloonHeightSource(glsl: string): "pos" | "colorPos" {
  const matches = [
    ...glsl.matchAll(
      /u = clamp\((cpos|pos)\.y \/ uVisibleRadius \* 0\.5 \+ 0\.5, 0\.0, 1\.0\);/g,
    ),
  ];
  expect(matches).toHaveLength(1);
  return matches[0][1] === "cpos" ? "colorPos" : "pos";
}

/** Apply the inverse of a row-major SO(4) rotor. Both shader packers upload
 * this transpose, but spelling the multiply here lets a non-identity rotor
 * expose a source-coordinate error that the identity case alone could hide. */
function inverseRotorApply4(rotor: number[], q: Vec4): Vec4 {
  return [0, 1, 2, 3].map((row) =>
    q.reduce((sum, value, column) => sum + rotor[column * 4 + row] * value, 0),
  ) as Vec4;
}

function shaderRadiusU(
  source: "pos" | "colorPos",
  rotor: number[],
  pos: Vec3,
  colorPos: Vec3,
  w0: number,
  sliceHalfW: number,
  sStar: number,
): number {
  const p = source === "colorPos" ? colorPos : pos;
  const q = inverseRotorApply4(rotor, [
    p[0],
    p[1],
    p[2],
    w0 + sStar * sliceHalfW,
  ]);
  const center: Vec4 = [0.13, -0.21, 0.34, -0.08];
  const radius = Math.hypot(
    q[0] - center[0],
    q[1] - center[1],
    q[2] - center[2],
    q[3] - center[3],
  );
  return Math.min(Math.max((radius - 0.17) * 0.73, 0), 1);
}

function shaderHeightU(
  source: "pos" | "colorPos",
  pos: Vec3,
  colorPos: Vec3,
  visibleRadius: number,
): number {
  const p = source === "colorPos" ? colorPos : pos;
  return Math.min(Math.max((p[1] / visibleRadius) * 0.5 + 0.5, 0), 1);
}

describe("the two engines' 4D balloon radius source (mirror pin)", () => {
  const identityRotor = rotorMatrix(identityRotorPair());
  const rotatedRotor = rotorMatrix(
    rotateInPlane(identityRotorPair(), "xw", Math.PI / 5),
  );
  const views = [
    {
      name: "identity rotor, off-center thick slice",
      rotor: identityRotor,
      w0: 0.31,
      sliceHalfW: 0.19,
      sStar: -0.65,
    },
    {
      name: "xw rotor, off-center thick slice",
      rotor: rotatedRotor,
      w0: -0.27,
      sliceHalfW: 0.22,
      sStar: 0.7,
    },
  ];
  const marchedPos: Vec3 = [0.24, -0.18, 0.41];
  const invertedSource: Vec3 = [1.17, 0.36, -0.72];
  const glsl = surface4FragmentFor(1, 0);

  it.each(["affine4", "fold4"] as const)(
    "%s lifts the balloon argmin's inverted source, matching WebGL's cpos contract",
    (core) => {
      const wgsl = surfaceDeKernelWgsl({
        mode: "shade",
        core,
        width: 4,
        workgroupSize: 32,
        sharedFrontier: false,
        bnbStage2: false,
        balloon: true,
      });
      expect(wgsl).toContain(
        "let q4c = rotorInvApply4(vec4f(hi.colorPos, hitW));",
      );
      expect(wgsl).not.toContain("let q4c = rotorInvApply4(vec4f(pos, hitW));");
      expect(wgslBalloonRadiusSource(wgsl)).toBe(glslBalloonRadiusSource(glsl));
    },
  );

  it.each(
    (["affine4", "fold4"] as const).flatMap((core) =>
      views.map((view) => ({ core, ...view })),
    ),
  )(
    "$core agrees with WebGL for $name at nonzero w0/sliceHalfW/sStar",
    ({ core, rotor, w0, sliceHalfW, sStar }) => {
      const wgsl = surfaceDeKernelWgsl({
        mode: "shade",
        core,
        width: 4,
        workgroupSize: 32,
        sharedFrontier: false,
        bnbStage2: false,
        balloon: true,
      });
      const compute = shaderRadiusU(
        wgslBalloonRadiusSource(wgsl),
        rotor,
        marchedPos,
        invertedSource,
        w0,
        sliceHalfW,
        sStar,
      );
      const webgl = shaderRadiusU(
        glslBalloonRadiusSource(glsl),
        rotor,
        marchedPos,
        invertedSource,
        w0,
        sliceHalfW,
        sStar,
      );
      const staleMarchedPositionResult = shaderRadiusU(
        "pos",
        rotor,
        marchedPos,
        invertedSource,
        w0,
        sliceHalfW,
        sStar,
      );

      expect(compute).toBeCloseTo(webgl, 12);
      expect(Math.abs(webgl - staleMarchedPositionResult)).toBeGreaterThan(0.1);
    },
  );
});

describe("the two engines' 4D balloon height source (mirror pin)", () => {
  const marchedPos: Vec3 = [0.24, -0.18, 0.41];
  const invertedSource: Vec3 = [1.17, 0.36, -0.72];
  const visibleRadius = 1.6;
  const glsl = surface4FragmentFor(1, 0);

  it.each(["affine4", "fold4"] as const)(
    "%s reads the balloon argmin's inverted source, matching WebGL's cpos contract",
    (core) => {
      const wgsl = surfaceDeKernelWgsl({
        mode: "shade",
        core,
        width: 4,
        workgroupSize: 32,
        sharedFrontier: false,
        bnbStage2: false,
        balloon: true,
      });
      expect(wgsl).toContain(
        "u = clamp(hi.colorPos.y / params.visRadius4 * 0.5 + 0.5, 0.0, 1.0);",
      );
      expect(wgsl).not.toContain(
        "u = clamp(pos.y / params.visRadius4 * 0.5 + 0.5, 0.0, 1.0);",
      );
      expect(wgslBalloonHeightSource(wgsl)).toBe(glslBalloonHeightSource(glsl));
    },
  );

  it.each(["affine4", "fold4"] as const)(
    "%s agrees with WebGL for a shell winner away from the marched hit",
    (core) => {
      const wgsl = surfaceDeKernelWgsl({
        mode: "shade",
        core,
        width: 4,
        workgroupSize: 32,
        sharedFrontier: false,
        bnbStage2: false,
        balloon: true,
      });
      const compute = shaderHeightU(
        wgslBalloonHeightSource(wgsl),
        marchedPos,
        invertedSource,
        visibleRadius,
      );
      const webgl = shaderHeightU(
        glslBalloonHeightSource(glsl),
        marchedPos,
        invertedSource,
        visibleRadius,
      );
      const staleMarchedPositionResult = shaderHeightU(
        "pos",
        marchedPos,
        invertedSource,
        visibleRadius,
      );

      expect(compute).toBeCloseTo(webgl, 12);
      expect(Math.abs(webgl - staleMarchedPositionResult)).toBeGreaterThan(0.1);
    },
  );
});

describe("surfaceComputeSeedDispatches", () => {
  it("covers an ordinary raster with one dispatch of 16-pixel workgroups", () => {
    expect(
      surfaceComputeSeedDispatches(1280, 720, {
        maxComputeWorkgroupsPerDimension: 65535,
      }),
    ).toEqual([{ originX: 0, originY: 0, groupsX: 80, groupsY: 45 }]);
  });

  it("rounds a partial workgroup up so the last row and column are seeded", () => {
    // 17 pixels is one whole 16-pixel workgroup plus one pixel; the kernel's
    // own bounds check discards the other fifteen invocations.
    expect(
      surfaceComputeSeedDispatches(17, 1, {
        maxComputeWorkgroupsPerDimension: 65535,
      }),
    ).toEqual([{ originX: 0, originY: 0, groupsX: 2, groupsY: 1 }]);
  });

  it("tiles a side past the device's workgroup ceiling, each tile from its own origin", () => {
    // Two workgroups a side is a 32-pixel tile, so a 40-pixel-wide raster
    // needs a second tile starting at x = 32 with one workgroup.
    expect(
      surfaceComputeSeedDispatches(40, 20, {
        maxComputeWorkgroupsPerDimension: 2,
      }),
    ).toEqual([
      { originX: 0, originY: 0, groupsX: 2, groupsY: 2 },
      { originX: 32, originY: 0, groupsX: 1, groupsY: 2 },
    ]);
  });

  it("needs no dispatch for an empty raster", () => {
    expect(
      surfaceComputeSeedDispatches(0, 10, {
        maxComputeWorkgroupsPerDimension: 65535,
      }),
    ).toEqual([]);
  });
});

describe("surfaceComputeMaxDispatchRays", () => {
  it("buys 4,194,240 rays at WebGPU's spec-minimum workgroup ceiling", () => {
    // The device is requested without raising maxComputeWorkgroupsPerDimension
    // (only the two storage limits are), which pins it at the spec floor of
    // 65535 on every shipped adapter — so this is the figure that actually
    // bounds a dispatch in the field, since every dispatch this module issues
    // is one-dimensional at SURFACE_COMPUTE_WORKGROUP_SIZE (64) threads per
    // workgroup.
    const rays = surfaceComputeMaxDispatchRays({
      maxComputeWorkgroupsPerDimension: 65535,
    });
    expect(rays).toBe(65535 * SURFACE_COMPUTE_WORKGROUP_SIZE);
    expect(rays).toBe(4_194_240);
  });

  it("scales linearly with a larger reported ceiling", () => {
    // A device advertising 4x the spec-minimum workgroup ceiling buys 4x
    // the rays — the relationship is a straight multiply, not a curve.
    expect(
      surfaceComputeMaxDispatchRays({
        maxComputeWorkgroupsPerDimension: 65535 * 4,
      }),
    ).toBe(4_194_240 * 4);
  });

  it("floors at one workgroup's worth of rays rather than 0 on a degenerate limit", () => {
    // A zero-reported ceiling would zero out the multiplication, and a
    // zero-length dispatch drains no queue and never terminates the loop
    // that sized it — so the floor holds it at SURFACE_COMPUTE_WORKGROUP_SIZE.
    expect(
      surfaceComputeMaxDispatchRays({ maxComputeWorkgroupsPerDimension: 0 }),
    ).toBe(SURFACE_COMPUTE_WORKGROUP_SIZE);
  });
});

describe("surfaceComputeMaxFrameRays", () => {
  it("sizes the frame by the ray-state buffer against the tighter ceiling", () => {
    // A 128 MiB storage-binding ceiling under a 256 MiB buffer ceiling: the
    // binding one governs, and it buys 128 MiB / 16 B = 8.4M rays — just
    // over a 4K raster, and a quarter of what a 4x export of a 1920x1057
    // pane would ask for (the device-ceiling report).
    expect(
      surfaceComputeMaxFrameRays({
        maxBufferSize: 256 * 1024 * 1024,
        maxStorageBufferBindingSize: 128 * 1024 * 1024,
      }),
    ).toBe((128 * 1024 * 1024) / SURFACE_COMPUTE_RAY_STATE_BYTES);
  });

  it("takes the buffer ceiling when it is the lower of the two", () => {
    expect(
      surfaceComputeMaxFrameRays({
        maxBufferSize: 64 * 1024 * 1024,
        maxStorageBufferBindingSize: 2 * 1024 * 1024 * 1024,
      }),
    ).toBe((64 * 1024 * 1024) / SURFACE_COMPUTE_RAY_STATE_BYTES);
  });

  it("does NOT clamp to the dispatch ceiling — a memory question, not a submission-shape one", () => {
    // A 128 MiB storage binding still buys 8.4M rays here even though that
    // is twice surfaceComputeMaxDispatchRays of a spec-minimum device: the
    // two are deliberately not met against each other, since folding the
    // smaller in would soften a 4K pane's raster for a submission-shape
    // ceiling no single piece of work has to meet. Every dispatch this
    // loop issues sizes and clamps at its own call site instead.
    const frameRays = surfaceComputeMaxFrameRays({
      maxBufferSize: 256 * 1024 * 1024,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
    });
    const dispatchRays = surfaceComputeMaxDispatchRays({
      maxComputeWorkgroupsPerDimension: 65535,
    });
    expect(frameRays).toBe(
      (128 * 1024 * 1024) / SURFACE_COMPUTE_RAY_STATE_BYTES,
    );
    expect(frameRays).toBeGreaterThan(dispatchRays);
  });
});

describe("surface compute composite layer storage", () => {
  it("prices the second output and staging buffers at 44 GPU bytes per ray", () => {
    // states 16 + active 4 + color/staging 8 + layer/staging 8 +
    // status/staging 8.
    expect(SURFACE_COMPUTE_RAY_BYTES).toBe(44);
  });

  it("averages coefficient lanes but keeps the nearest covered signed CoC", () => {
    const accum = new Float32Array(2 * 3);
    const frontmost = new Uint8Array([255, 255]);
    foldSurfaceComputeLayerSample(
      accum,
      frontmost,
      new Uint8Array([
        0,
        0,
        255,
        255, // uncovered: its sentinel cannot win
        255,
        64,
        32,
        210,
      ]),
    );
    foldSurfaceComputeLayerSample(
      accum,
      frontmost,
      new Uint8Array([
        255,
        128,
        16,
        80, // nearer covered sample wins
        255,
        192,
        64,
        230, // farther covered sample loses
      ]),
    );

    expect(
      Array.from(encodeSurfaceComputeLayerMean(accum, 2, frontmost)),
    ).toEqual([128, 64, 136, 80, 255, 128, 48, 210]);
  });

  it("keeps the far sentinel when every supersample is uncovered", () => {
    const accum = new Float32Array(3);
    const frontmost = new Uint8Array([255]);
    foldSurfaceComputeLayerSample(
      accum,
      frontmost,
      new Uint8Array([0, 0, 255, 12]),
    );
    foldSurfaceComputeLayerSample(
      accum,
      frontmost,
      new Uint8Array([0, 0, 255, 200]),
    );
    expect(
      Array.from(encodeSurfaceComputeLayerMean(accum, 2, frontmost)),
    ).toEqual([0, 0, 255, 255]);
  });
});

describe("surfaceComputeTileRows", () => {
  it("traces an ordinary export as one whole tile", () => {
    // 1920x1057 at 1x is 2.0M rays — comfortably inside the cap, so the
    // capture keeps its single-frame path.
    expect(surfaceComputeTileRows(1920, 1057, Infinity)).toBe(1057);
  });

  it("bands a 4x export under the tile cap", () => {
    // The device-ceiling report's raster: 7680x4228 = 32.5M rays, which
    // asked for a 520 MB ray-state buffer as one frame.
    const rows = surfaceComputeTileRows(7680, 4228, Infinity);
    expect(rows * 7680).toBeLessThanOrEqual(SURFACE_COMPUTE_MAX_TILE_RAYS);
    expect(Math.ceil(4228 / rows)).toBe(9);
  });

  it("balances the bands rather than leaving a one-row remainder", () => {
    // 521 rows per tile would fit the cap, but 4228 = 8x521 + 60: the
    // last band would be a 60-row sliver, and the export modal's
    // per-tile progress would lurch through it.
    const rows = surfaceComputeTileRows(7680, 4228, Infinity);
    const count = Math.ceil(4228 / rows);
    expect(4228 - (count - 1) * rows).toBeGreaterThan(rows / 2);
  });

  it("covers every row exactly once, none of them over the cap", () => {
    for (const [w, h, cap] of [
      [7680, 4228, Infinity],
      [3840, 2160, 1_000_000],
      [1000, 1000, 999_999],
      [1920, 1057, 100_000],
    ] as const) {
      const rows = surfaceComputeTileRows(w, h, cap);
      const count = Math.ceil(h / rows);
      let covered = 0;
      for (let i = 0; i < count; i++) {
        const band = Math.min(rows, h - i * rows);
        expect(band).toBeGreaterThan(0);
        expect(band * w).toBeLessThanOrEqual(
          Math.min(cap, SURFACE_COMPUTE_MAX_TILE_RAYS),
        );
        covered += band;
      }
      expect(covered).toBe(h);
    }
  });

  it("honours a device ceiling below the tile cap", () => {
    // A device that allocates 500k rays per frame gets 250-row bands
    // (500k / 2000 px), not the 4M-ray constant's 2000-row whole image.
    expect(surfaceComputeTileRows(2000, 2000, 500_000)).toBe(250);
  });
});

describe("fitSurfaceComputeRaster", () => {
  it("leaves a raster the device can allocate for alone", () => {
    expect(fitSurfaceComputeRaster(1920, 1057, Infinity)).toEqual({
      width: 1920,
      height: 1057,
    });
  });

  it("shrinks an oversized live raster keeping its aspect", () => {
    // A hidpi 5K pane (14.7M rays) on a device that allocates 8.4M: the
    // pane traces softer and blits up rather than failing to allocate.
    const fit = fitSurfaceComputeRaster(5120, 2880, 8_388_608);
    expect(fit.width * fit.height).toBeLessThanOrEqual(8_388_608);
    expect(fit.width / fit.height).toBeCloseTo(5120 / 2880, 2);
  });

  it("fits even a ceiling below one row of the raster", () => {
    const fit = fitSurfaceComputeRaster(1000, 1, 2);
    expect(fit.width * fit.height).toBeLessThanOrEqual(2);
    expect(fit.width).toBeGreaterThanOrEqual(1);
    expect(fit.height).toBeGreaterThanOrEqual(1);
  });
});

describe("resampleSurfacePixels", () => {
  it("nearest-samples pixel centers with row 0 staying the bottom row", () => {
    // 1x2 source: bottom row red, top row green. Upscaled to 1x4, the
    // bottom two rows must stay red and the top two green — no flip.
    const src = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
    const out = resampleSurfacePixels(src, 1, 2, 1, 4);
    expect(Array.from(out.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(out.slice(4, 8))).toEqual([255, 0, 0, 255]);
    expect(Array.from(out.slice(8, 12))).toEqual([0, 255, 0, 255]);
    expect(Array.from(out.slice(12, 16))).toEqual([0, 255, 0, 255]);
  });

  it("downsamples by picking the covering source texel", () => {
    // 4x1 source, distinct reds; 2x1 output samples centers at x=1 and 3.
    const src = new Uint8Array([10, 20, 30, 40].flatMap((r) => [r, 0, 0, 255]));
    const out = resampleSurfacePixels(src, 4, 1, 2, 1);
    expect(out[0]).toBe(20);
    expect(out[4]).toBe(40);
  });
});

describe("nextStepsPerPass", () => {
  it("doubles while the last pass came in under the target", () => {
    expect(nextStepsPerPass(1, 10)).toBe(2);
    expect(nextStepsPerPass(8, SURFACE_COMPUTE_PASS_TARGET_MS - 1)).toBe(16);
  });

  it("holds at or over the target", () => {
    expect(nextStepsPerPass(8, SURFACE_COMPUTE_PASS_TARGET_MS)).toBe(8);
    expect(nextStepsPerPass(1, 5000)).toBe(1);
  });

  it("caps at the per-pass step bound", () => {
    expect(nextStepsPerPass(SURFACE_COMPUTE_MAX_STEPS_PER_PASS, 1)).toBe(
      SURFACE_COMPUTE_MAX_STEPS_PER_PASS,
    );
    expect(nextStepsPerPass(20, 1)).toBe(SURFACE_COMPUTE_MAX_STEPS_PER_PASS);
  });
});

describe("marchChunkFor", () => {
  it("sizes slices to the pass target from the measured per-ray-step cost", () => {
    // 10µs/ray·step at 1 step → 25k rays fill the 250ms target.
    expect(marchChunkFor(10, 1)).toBe(25_000);
    // Deeper steps shrink the slice proportionally (floored).
    expect(marchChunkFor(10, 2)).toBe(12_500);
  });

  it("never drops below the dispatch-overhead floor", () => {
    expect(marchChunkFor(200, 1)).toBe(SURFACE_COMPUTE_MARCH_CHUNK_MIN);
    expect(marchChunkFor(10, 32)).toBe(SURFACE_COMPUTE_MARCH_CHUNK_MIN);
  });
});

describe("shadeHitAllowanceUs", () => {
  it("is the room left inside the pass target while the fixed cost fits there", () => {
    // lens3's ~25ms of fixed dispatch cost leaves ~225ms of the 250ms
    // target to buy hits with, and the predicted total is the target
    // itself. That branch owns every intercept under
    // 250ms / (1 + WORK_PER_FIXED_COST).
    expect(shadeHitAllowanceUs(25_000)).toBe(
      SURFACE_COMPUTE_PASS_TARGET_MS * 1000 - 25_000,
    );
    expect(shadeHitBudgetUs(25_000)).toBe(
      SURFACE_COMPUTE_PASS_TARGET_MS * 1000,
    );
  });

  it("spends a multiple of the fixed cost once the dispatch is latency-bound", () => {
    // A dispatch whose fixed cost alone is 100ms cannot be made cheaper
    // by shrinking it, so it buys hits in proportion rather than refusing
    // to widen.
    expect(shadeHitAllowanceUs(100_000)).toBe(
      SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST * 100_000,
    );
  });

  it("names a WIDTH in that branch, not a ratio the scene has a say in", () => {
    // nextShadeHitCost preserves intercept = PIVOT x marginal identically
    // (proof at that function), so the allowance divided by the marginal
    // is WORK_PER_FIXED_COST x PIVOT hits for EVERY scene that reaches
    // this branch. The two models below differ by 100x in both terms and
    // in what a hit costs, and the sizer asks for the same width — which
    // is exactly why that constant had to be chosen by measuring widths.
    const wide =
      SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST *
      SURFACE_COMPUTE_SHADE_COST_PIVOT;
    // Both models sit in the middle branch, which owns fixed costs from
    // 250ms/(1+K) to 250ms — i.e. marginals of ~61 to ~488us per hit.
    for (const marginalUs of [100, 400]) {
      expect(
        shadeHitBatchSize(
          {
            interceptUs: SURFACE_COMPUTE_SHADE_COST_PIVOT * marginalUs,
            marginalUs,
          },
          Number.MAX_SAFE_INTEGER,
        ),
      ).toBe(wide);
    }
  });

  it("keeps buying hits across the whole range real scenes measure in", () => {
    // The ceiling on the predicted TOTAL necessarily squeezes the allowance
    // to nothing as the intercept approaches it — a dispatch that costs the
    // ceiling before its first hit has no room for hits. That squeeze is
    // the settle-park trapdoor if it lands where scenes live, and
    // mandelboxKifs, the hardest scene here, measures its intercept between
    // 430 and 960 ms. So across 0-1s of fixed cost the allowance is never
    // less than a quarter of the pass target, and never less than what a
    // batch of hits can be bought with.
    for (let interceptUs = 0; interceptUs <= 1_000_000; interceptUs += 10_000) {
      expect(shadeHitAllowanceUs(interceptUs)).toBeGreaterThanOrEqual(
        (SURFACE_COMPUTE_PASS_TARGET_MS * 1000) / 4,
      );
    }
  });

  it("never aims a dispatch lower as its fixed cost rises", () => {
    // The property the allowance exists to have, stated on the number it is
    // about: what one dispatch is PREDICTED to cost in total. A rule that
    // traded the allowance away against a rising intercept would shrink the
    // dispatch exactly where shrinking it cannot help, which is the
    // settle-park trapdoor. Monotone up to the ceiling and then pinned
    // there — the allowance itself falls through that upper range only
    // because the intercept it is added to is rising.
    let prev = 0;
    for (let interceptUs = 0; interceptUs <= 1_900_000; interceptUs += 10_000) {
      const totalUs = shadeHitBudgetUs(interceptUs);
      expect(totalUs).toBeGreaterThanOrEqual(prev);
      prev = totalUs;
    }
    expect(shadeHitBudgetUs(300_000)).toBe(
      SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS * 1000,
    );
  });

  it("stops adding work as the predicted total approaches the ceiling", () => {
    // Above the ceiling there is nothing safe left to add — and unlike
    // the range above, this is a regime where a dispatch's FIXED cost
    // alone is a watchdog conversation, so declining to widen it is the
    // answer rather than a trapdoor.
    const ceilingUs = SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS * 1000;
    expect(shadeHitBudgetUs(1_500_000)).toBe(ceilingUs);
    expect(shadeHitAllowanceUs(ceilingUs)).toBe(0);
    expect(shadeHitAllowanceUs(3_000_000)).toBe(0);
  });
});

describe("nextLightingRayCap", () => {
  // The ladder's ceiling is the caller's DEVICE cap —
  // surfaceComputeMaxDispatchRays of a real adapter — never a fixed
  // constant: the shipped 4096 was one fixed width too many and throttled
  // every lit settle 5.5x (nextLightingRayCap's own doc). 4096 here is a
  // stand-in device ceiling, the smallest round number that still shows
  // every rung of the climb.
  const CEILING = 4096;

  it("doubles while the worst dispatch fits the lit target, and saturates at the ceiling", () => {
    expect(nextLightingRayCap(64, 49, CEILING)).toBe(128);
    expect(nextLightingRayCap(2048, 49, CEILING)).toBe(4096);
    // The ceiling is the ceiling; nothing above it, however cheap the
    // dispatch measured.
    expect(nextLightingRayCap(4096, 1, CEILING)).toBe(4096);
  });

  it("holds between the target and double it", () => {
    expect(nextLightingRayCap(512, 50, CEILING)).toBe(512);
    expect(nextLightingRayCap(512, 100, CEILING)).toBe(512);
  });

  it("quarters on a 2x overrun and floors at one workgroup", () => {
    expect(nextLightingRayCap(1024, 101, CEILING)).toBe(256);
    expect(nextLightingRayCap(64, 500, CEILING)).toBe(
      SURFACE_COMPUTE_WORKGROUP_SIZE,
    );
  });

  it("climbs one workgroup to the cap in six steps — the ladder paces, it does not leap", () => {
    let cap = SURFACE_COMPUTE_WORKGROUP_SIZE;
    const seen = [cap];
    for (let i = 0; i < 6; i++) {
      cap = nextLightingRayCap(cap, 1, CEILING);
      seen.push(cap);
    }
    expect(seen).toEqual([64, 128, 256, 512, 1024, 2048, 4096]);
  });
});

describe("surfaceComputeLightingRayBatch on measured costs", () => {
  it("widens once the lane carries a measured cost, where an inert lane pinned it to the cap", () => {
    // MEASURED on this project's own cathedral fixture. The model affords
    // far more than the cap passed here, so the capacity ladder is what
    // paces the width — the division of labour the unlit queue has.
    const surface = { interceptUs: 16600, marginalUs: 7.59 };
    expect(surfaceComputeLightingRayBatch(surface, 4096)).toBe(4096);
    // The ladder still binds while it is climbing.
    expect(surfaceComputeLightingRayBatch(surface, 256)).toBe(256);
    // A genuinely expensive scene is held down by the model, not the cap.
    expect(
      surfaceComputeLightingRayBatch(
        { interceptUs: 5630, marginalUs: 200 },
        4096,
      ),
    ).toBe(192);
  });
});

describe("nextShadeBatchSize", () => {
  it("doubles only while batches come in under the budget they were sized for", () => {
    expect(nextShadeBatchSize(32, 249, 250)).toBe(64);
    // In the holding band (between the budget and double it) the capacity
    // neither grows nor shrinks.
    expect(nextShadeBatchSize(32, 250, 250)).toBe(32);
  });

  it("reads the LATENCY-BOUND budget, not a fixed pass target", () => {
    // A 500ms dispatch under an 800ms budget is a batch that fit: the
    // capacity has to keep climbing there. Judged against the old fixed
    // PASS_TARGET/2 threshold this froze at whatever width cost 125ms —
    // ~256 hits on the measured scene against a measured optimum of ~1050.
    expect(nextShadeBatchSize(256, 500, 800)).toBe(512);
    expect(nextShadeBatchSize(256, 500, SURFACE_COMPUTE_PASS_TARGET_MS)).toBe(
      256,
    );
  });

  it("quarters on a big overshoot — the watchdog-safety bias", () => {
    expect(nextShadeBatchSize(256, 501, 250)).toBe(64);
  });

  it("quarters down to the one-workgroup floor, never below", () => {
    // Quartering from just above the floor lands exactly on it...
    expect(nextShadeBatchSize(256, 10_000, 250)).toBe(
      SURFACE_COMPUTE_WORKGROUP_SIZE,
    );
    // ...and quartering FROM the floor holds there rather than dropping
    // below it: a sub-workgroup batch buys no submission-wall safety (GPU
    // cost inside one workgroup is depth-, not width-dominated), so
    // shrinking further would only multiply worst-ray-cost submissions —
    // the settle park was exactly this floor missing, quartering all the
    // way to 1-ray batches.
    expect(
      nextShadeBatchSize(SURFACE_COMPUTE_WORKGROUP_SIZE, 10_000, 250),
    ).toBe(SURFACE_COMPUTE_WORKGROUP_SIZE);
  });

  it("caps at the batch ceiling", () => {
    expect(
      nextShadeBatchSize(SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH, 1, 250),
    ).toBe(SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH);
  });
});

describe("surfaceComputeFenceRoundTripMs", () => {
  it("takes the smallest COUNTED probe, so a cold outlier cannot set the constant", () => {
    // A Firefox-class probe run whose first COUNTED fence landed on a
    // cold compositor tick. The mean of the counted probes is 148.4ms —
    // 48ms of a round-trip nothing after the warm-up ever pays again,
    // which would be subtracted from every dispatch for the life of the
    // session. The leading entry is the alignment fence and is never a
    // candidate, however small it reads.
    expect(surfaceComputeFenceRoundTripMs([1, 100, 101, 100, 340, 101])).toBe(
      100,
    );
  });

  it("reads no counted samples as 'not measured' — a zero subtraction", () => {
    expect(surfaceComputeFenceRoundTripMs([])).toBe(0);
  });

  it("reads only-the-alignment-probe as 'not measured' too", () => {
    // A frame cancelled mid-calibration, or a caller that only ever timed
    // the discarded probe: nothing counted survives, so this is the same
    // zero subtraction as an empty run, not a crash on `Math.min()`.
    expect(surfaceComputeFenceRoundTripMs([16.42])).toBe(0);
  });

  it("never subtracts more than the cheapest COUNTED round-trip actually observed", () => {
    // The over-subtracting direction is the unbounded one: a corrected
    // reading floors at zero, and a calibrated cost model reads it
    // directly with no ladder pacing it. The alignment probe here is the
    // smallest number in the whole array and must still be excluded.
    expect(surfaceComputeFenceRoundTripMs([1, 3, 5, 9, 11])).toBe(3);
  });

  it("never returns a negative round-trip", () => {
    // A clock that went backwards must not turn the subtraction into an
    // ADDITION on every later dispatch.
    expect(surfaceComputeFenceRoundTripMs([-100, -5, -1, -3])).toBe(0);
  });

  it("reads the aligned minimum on the measured in-app regression draw", () => {
    // The five probes a pre-fix Firefox session traced live, plus the
    // sixth fence the calibration now issues: probe #1 at a random phase
    // of the ~100 ms poll, every later one a whole tick. The old
    // min-of-five read 16.42, which pinned the lit capacity ladder at the
    // one-workgroup floor for a 121,519 ms settle
    // (`scripts/surface-fence-cost.verify.mjs`, exit 3) where the same
    // build's other lit runs settled in 4,534-5,150 ms.
    expect(
      surfaceComputeFenceRoundTripMs([
        16.42, 100.56, 100.26, 100.12, 100.16, 100.3,
      ]),
    ).toBeCloseTo(100.12, 10);
  });
});

describe("surfaceComputeDispatchWorkMs", () => {
  it("takes the session's fence round-trip out of the measured wall time", () => {
    expect(surfaceComputeDispatchWorkMs(106, 101)).toBeCloseTo(5, 10);
  });

  it("floors at zero when the dispatch came in under the measured fence", () => {
    // Under a polling-tick fence a dispatch can land early in the tick it
    // is charged to, so the wall time can read below the calibrated
    // constant. That is not negative work.
    expect(surfaceComputeDispatchWorkMs(98, 101)).toBe(0);
  });

  it("is the identity when the fence has not been measured", () => {
    // fenceMs 0 is what an unmeasured session carries, and it must render
    // today's behaviour value for value.
    expect(surfaceComputeDispatchWorkMs(106, 0)).toBe(106);
  });
});

describe("surfaceComputePassDurationsMs", () => {
  it("converts nanosecond begin/end pairs to ms, in submission order", () => {
    const raw = [1_000_000n, 41_000_000n, 41_000_000n, 41_050_000n];
    expect(surfaceComputePassDurationsMs(raw, 2)).toEqual([40, 0.05]);
  });

  it("reads a zero difference as a legal zero-duration pass, not an error", () => {
    // A trivial pass on a coarse-timer stack can report begin == end; the
    // conversion is not where the broken-instrument verdict lives.
    const raw = [5n, 5n, 5n, 5n];
    expect(surfaceComputePassDurationsMs(raw, 2)).toEqual([0, 0]);
  });

  it("reads exactly `pairs` pairs out of a longer buffer", () => {
    const raw = [0n, 1_000_000n, 0n, 2_000_000n, 9n, 9n];
    expect(surfaceComputePassDurationsMs(raw, 2)).toEqual([1, 2]);
  });
});

describe("surfaceComputeGpuGroupMs", () => {
  it("sums the group's own pass durations — the sizers' GPU-side input", () => {
    expect(surfaceComputeGpuGroupMs([18.4, 21.2])).toBeCloseTo(39.6, 10);
  });

  it("reads no readings as the wall currency's cue", () => {
    expect(surfaceComputeGpuGroupMs(null)).toBe(null);
  });

  it("reads an empty group as the wall currency's cue", () => {
    expect(surfaceComputeGpuGroupMs([])).toBe(null);
  });

  it("rejects a non-finite reading — the group was not measured, not cheap", () => {
    expect(surfaceComputeGpuGroupMs([18.4, NaN])).toBe(null);
    expect(surfaceComputeGpuGroupMs([Infinity])).toBe(null);
  });

  it("rejects an all-zero set — a broken instrument is not free work", () => {
    // The capacity ladders GROW on under-budget readings and the two-term
    // model would converge to zero: an all-zero set must fall back to the
    // wall currency, never be read as "every dispatch cost nothing".
    expect(surfaceComputeGpuGroupMs([0, 0])).toBe(null);
  });

  it("keeps a mix of zeros with real durations — a trivial pass is legal", () => {
    expect(surfaceComputeGpuGroupMs([0, 21.5])).toBeCloseTo(21.5, 10);
  });
});

describe("the pass-duration instrument's creation", () => {
  it("allocates the query set and its resolve/read staging only when the device exposes timestamp-query", async () => {
    const withFeature = await createPaletteResourceHarness(
      false,
      undefined,
      false,
      ["timestamp-query"],
    );
    const tsBuffers = withFeature.bufferDescriptors.filter((d) =>
      Boolean(d.usage & GPUBufferUsage.QUERY_RESOLVE),
    );
    expect(tsBuffers).toHaveLength(1);
    expect(tsBuffers[0].size).toBe(SURFACE_COMPUTE_TS_QUERY_CAPACITY * 8);
    expect(tsBuffers[0].usage & GPUBufferUsage.COPY_SRC).toBeTruthy();
    const tsRead = withFeature.bufferDescriptors.filter(
      (d) =>
        Boolean(d.usage & GPUBufferUsage.MAP_READ) &&
        Boolean(d.usage & GPUBufferUsage.COPY_DST),
    );
    expect(tsRead).toHaveLength(1);
    expect(tsRead[0].size).toBe(SURFACE_COMPUTE_TS_QUERY_CAPACITY * 8);

    const withoutFeature = await createPaletteResourceHarness(false);
    expect(
      withoutFeature.bufferDescriptors.filter((d) =>
        Boolean(d.usage & GPUBufferUsage.QUERY_RESOLVE),
      ),
    ).toEqual([]);
  });
});

describe("the lit capacity ladder under a Firefox-class fence", () => {
  it("walks the lit cap to the one-workgroup floor and pins it there on RAW wall time", () => {
    // A ~5ms lit dispatch measured across Firefox's ~101ms fence reads
    // 106ms — over double nextLightingRayCap's 50ms target, so the ladder
    // can only ever quarter. One full-pane lit pass then turns Chrome's
    // few hundred dispatches into tens of thousands, each paying another
    // fence.
    const rawMs = 106;
    let cap = 4096;
    const seen = [cap];
    for (let i = 0; i < 6; i++) {
      cap = nextLightingRayCap(cap, rawMs, 4096);
      seen.push(cap);
    }
    expect(seen).toEqual([4096, 1024, 256, 64, 64, 64, 64]);
  });

  it("climbs the same dispatch back to the ceiling once its fence is subtracted", () => {
    // Identical measurements, read through surfaceComputeDispatchWorkMs:
    // 5ms of actual work fits the 50ms target, so the ladder doubles out
    // of the floor the raw reading pinned it at.
    const workMs = surfaceComputeDispatchWorkMs(106, 101);
    let cap = SURFACE_COMPUTE_WORKGROUP_SIZE;
    const seen = [cap];
    for (let i = 0; i < 6; i++) {
      cap = nextLightingRayCap(cap, workMs, 4096);
      seen.push(cap);
    }
    expect(seen).toEqual([64, 128, 256, 512, 1024, 2048, 4096]);
  });
});

describe("the unlit hit capacity ladder under a Firefox-class fence", () => {
  it("freezes the hit capacity on RAW wall time, where the fence-free work would grow it", () => {
    // The budget the sizer aimed at, from a measured intercept: 250ms,
    // shadeHitAllowanceUs's PASS_TARGET floor. A 200ms hit dispatch FIT
    // that budget, but measured across Firefox's ~101ms fence it reads
    // 301ms and the ladder reads a batch that overran.
    const budgetMs = shadeHitBudgetUs(16_600) / 1000;
    expect(budgetMs).toBe(250);
    expect(nextShadeBatchSize(512, 301, budgetMs)).toBe(512);
    expect(
      nextShadeBatchSize(512, surfaceComputeDispatchWorkMs(301, 101), budgetMs),
    ).toBe(1024);
  });

  it("stays pinned at the starting capacity for the whole run on RAW wall time", () => {
    // Iterated, the frozen ladder is the damage: the capacity never
    // leaves the width it started at, so every hit batch of the session
    // is sized by a cap that has learned nothing.
    const budgetMs = shadeHitBudgetUs(16_600) / 1000;
    let rawCap = SURFACE_COMPUTE_SHADE_HIT_CAP_START;
    let workCap = SURFACE_COMPUTE_SHADE_HIT_CAP_START;
    for (let i = 0; i < 8; i++) {
      rawCap = nextShadeBatchSize(rawCap, 301, budgetMs);
      workCap = nextShadeBatchSize(
        workCap,
        surfaceComputeDispatchWorkMs(301, 101),
        budgetMs,
      );
    }
    expect(rawCap).toBe(SURFACE_COMPUTE_SHADE_HIT_CAP_START);
    expect(workCap).toBe(SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH);
  });

  it("cannot be QUARTERED by a Firefox-class fence — the unlit budget floor is five times the lit target", () => {
    // Said explicitly because the lit ladder's failure and this one's are
    // not the same failure. Quartering needs the reading to exceed DOUBLE
    // the budget, so the fence would have to exceed the whole budget —
    // and shadeHitBudgetUs never returns less than PASS_TARGET's 250ms,
    // against a measured fence of ~101ms. A 399ms dispatch is the worst
    // this fence can misreport, and it lands in the holding band, not the
    // quartering one.
    const budgetMs = shadeHitBudgetUs(16_600) / 1000;
    expect(nextShadeBatchSize(512, 399 + 101, budgetMs)).toBe(512);
  });
});

describe("shadeHitBatchSize", () => {
  it("hands a frame that has measured nothing exactly one workgroup", () => {
    // The empty model asks for everything (the two-term model deleted the
    // per-hit prior — it could only ask for less than the floor already
    // gives) and the one-workgroup starting capacity is what answers.
    expect(
      shadeHitBatchSize(
        initialShadeHitCost(),
        SURFACE_COMPUTE_SHADE_HIT_CAP_START,
      ),
    ).toBe(SURFACE_COMPUTE_SHADE_HIT_CAP_START);
  });

  it("divides the budget by the MARGINAL cost, not by a whole submission over its rays", () => {
    // The measured boxfold-pair model: ~88ms fixed per dispatch, ~154us per
    // hit beyond it. 7 x 88ms / 154us = 4000 hits, where the shipped sizer
    // before the two-term model sat at 64-256 — and 512 after it, this
    // model's own intercept/marginal ratio being what named that number
    // rather than anything measured (see shadeHitAllowanceUs).
    expect(
      shadeHitBatchSize(
        { interceptUs: 88_000, marginalUs: 154 },
        SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH,
      ),
    ).toBe(4000);
  });

  it("widens a latency-bound dispatch instead of refusing to", () => {
    // 400ms of fixed cost, 500us per hit: the ceiling caps the predicted
    // total at 2s, so the sizer buys the 1.6s that leaves — 3200 hits.
    // Under a fixed 250ms target the allowance would be negative and this
    // would floor at 64 — a 50x throughput loss for no reduction in the
    // submission wall, since the wall is the 400ms.
    expect(
      shadeHitBatchSize(
        { interceptUs: 400_000, marginalUs: 500 },
        SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH,
      ),
    ).toBe(3200);
  });

  it("keeps buying hits right up to the ceiling", () => {
    // A 1.4s intercept is 1.4s whatever the width, so the sizer spends
    // what the 2s ceiling leaves — 600ms of hits at 500us each — rather
    // than declining to widen a dispatch it cannot shorten. At a 1s
    // ceiling this same model floored at 64 hits for the same 1.4s: 19x
    // fewer hits for the same wall, which is the trapdoor
    // SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS's placement exists to
    // keep out of the range real scenes measure in.
    expect(
      shadeHitBatchSize(
        { interceptUs: 1_400_000, marginalUs: 500 },
        SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH,
      ),
    ).toBe(1200);
  });

  it("never collapses below one workgroup when per-hit cost is enormous", () => {
    expect(
      shadeHitBatchSize(
        { interceptUs: 0, marginalUs: 400_000 },
        SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH,
      ),
    ).toBe(SURFACE_COMPUTE_WORKGROUP_SIZE);
    // A cap below one workgroup can't reduce submission wall either, so
    // the floor overrides it.
    expect(shadeHitBatchSize({ interceptUs: 0, marginalUs: 400_000 }, 8)).toBe(
      SURFACE_COMPUTE_WORKGROUP_SIZE,
    );
  });

  it("lets cheap measured costs fill the earned capacity, no further", () => {
    expect(shadeHitBatchSize({ interceptUs: 0, marginalUs: 1_000 }, 64)).toBe(
      64,
    );
    expect(shadeHitBatchSize({ interceptUs: 0, marginalUs: 1_000 }, 4096)).toBe(
      250,
    );
  });
});

describe("nextShadeHitCost", () => {
  it("fits the measurement it just took — the split double-counts nothing", () => {
    const cost = nextShadeHitCost(
      { interceptUs: 40_000, marginalUs: 300 },
      256,
      190_000,
    );
    expect(cost.interceptUs + 256 * cost.marginalUs).toBeCloseTo(190_000, 3);
  });

  it("credits a one-workgroup dispatch to the INTERCEPT — it cannot be about per-hit cost", () => {
    // 64 hits at 97.9ms from an empty model: w = 64/(64+512) = 0.111, so
    // ~89% of it lands on the fixed term. The truth on that scene was
    // 88ms fixed and 154us/hit.
    const cost = nextShadeHitCost(initialShadeHitCost(), 64, 97_856);
    expect(cost.interceptUs).toBeGreaterThan(0.85 * 97_856);
    expect(cost.marginalUs).toBeLessThan(200);
  });

  it("credits a wide dispatch to the MARGINAL — that is what a wide one measures", () => {
    const cost = nextShadeHitCost(initialShadeHitCost(), 4096, 700_000);
    expect(4096 * cost.marginalUs).toBeGreaterThan(0.85 * 700_000);
  });

  it("shrugs off a QUEUE-LIMITED batch instead of shrinking on it", () => {
    // The converged boxfold-pair model, then a sweep that only had 100
    // hits to give — and 5% dearer than priced, so there is a real
    // surprise to attribute rather than a no-op.
    const before = { interceptUs: 88_000, marginalUs: 154 };
    const measuredUs = 1.05 * (88_000 + 100 * 154);
    const cap = SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH;

    // The OLD reading of that same dispatch: a whole submission over its
    // rays is 1.14ms per hit, 7.4x the marginal, which the spike-lift EMA
    // took instantly and which sizes 219 hits — a 4.8x cut off the back
    // of a batch that was small because the QUEUE was, not the region.
    const wholeSubmissionUsPerHit = measuredUs / 100;
    expect(wholeSubmissionUsPerHit).toBeGreaterThan(7 * before.marginalUs);
    expect(
      Math.floor(
        (SURFACE_COMPUTE_PASS_TARGET_MS * 1000) / wholeSubmissionUsPerHit,
      ),
    ).toBeLessThan(0.25 * shadeHitBatchSize(before, cap));

    // The pivot hands a 100-hit measurement mostly to the intercept, so
    // the next batch barely moves. (At PIVOT = 0 — the single-term model
    // this replaced — it would fall to 0.75x and this would fail.)
    const after = nextShadeHitCost(before, 100, measuredUs);
    expect(shadeHitBatchSize(after, cap)).toBeGreaterThan(
      0.85 * shadeHitBatchSize(before, cap),
    );
  });

  it("cuts the next batch hard on a genuine cost spike", () => {
    // The same converged model walking into a band 30x more expensive per
    // hit at 1024 hits — the scanline-clustered near-surface silhouette
    // the whole slow-trust policy exists for. ONE observation lifts the
    // marginal by more than an order and cuts the next batch by more than
    // 6x — and the cut is not the ceiling doing it, which is worth
    // pinning: the marginal alone accounts for it, since a batch sized
    // against the pass target on the new marginal is the same order.
    const before = { interceptUs: 88_000, marginalUs: 154 };
    const spiked = nextShadeHitCost(before, 1024, 88_000 + 1024 * 154 * 30);
    expect(spiked.marginalUs).toBeGreaterThan(10 * before.marginalUs);
    const cap = SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH;
    expect(shadeHitBatchSize(spiked, cap)).toBeLessThan(
      shadeHitBatchSize(before, cap) / 6,
    );
  });

  it("will not become optimistic faster than the capacity ladder grows", () => {
    // A wildly cheap measurement against a converged model — a wide batch
    // of ground-plane terminals, which the ground plane queues WITH the
    // hits but which shade analytically. Clamped at zero the marginal would
    // read "hits are free" and the sizer would ask for the entire capacity
    // on one dispatch's evidence, which on a fold monster is a multi-second
    // submission. The decay floor holds it to a halving, i.e. at most a
    // doubling of the next batch — the rate the ladder already enforces.
    const before = { interceptUs: 500_000, marginalUs: 900 };
    const after = nextShadeHitCost(before, 2048, 1_000);
    expect(after.marginalUs).toBeGreaterThanOrEqual(
      before.marginalUs * SURFACE_COMPUTE_SHADE_MARGINAL_DECAY,
    );
    const cap = SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH;
    expect(shadeHitBatchSize(after, cap)).toBeLessThanOrEqual(
      2 * shadeHitBatchSize(before, cap),
    );
    // Repeated cheap measurements DO get there — the floor is a rate
    // limit, not a pin.
    let cost = before;
    for (let i = 0; i < 20; i++) cost = nextShadeHitCost(cost, 2048, 1_000);
    expect(cost.marginalUs).toBeLessThan(1);
  });

  it("converges on its target width within a frame's worth of dispatches", () => {
    // The whole sizer, run against the measured cost curve for the boxfold
    // pair: 88ms of fixed dispatch cost plus 154us per hit. It reaches its
    // target width in single digits, and the capacity ladder — not the
    // model — is what paces the climb, so no batch is ever wider than
    // measured-cheap evidence supports.
    const costOf = (n: number): number => 88_000 + 154 * n;
    let cost = initialShadeHitCost();
    let cap = SURFACE_COMPUTE_SHADE_HIT_CAP_START;
    const widths: number[] = [];
    for (let i = 0; i < 10; i++) {
      const budgetMs = shadeHitBudgetUs(cost.interceptUs) / 1000;
      const n = shadeHitBatchSize(cost, cap);
      const measuredUs = costOf(n);
      widths.push(n);
      // No dispatch on the way up may pass double the budget it was
      // sized for — the bound the capacity ladder is there to keep.
      expect(measuredUs / 1000).toBeLessThan(2 * budgetMs);
      cost = nextShadeHitCost(cost, n, measuredUs);
      cap = nextShadeBatchSize(cap, measuredUs / 1000, budgetMs);
    }
    expect(widths[widths.length - 1]).toBe(
      SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST *
        SURFACE_COMPUTE_SHADE_COST_PIVOT,
    );
    // And the climb is the ladder's doubling, not a jump: every step at
    // most doubles the last.
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThanOrEqual(2 * widths[i - 1]);
    }
    // WHAT THIS DOES NOT SHOW, said here because an earlier version of
    // this test claimed the opposite: the model does NOT recover the two
    // physical terms, and cannot. nextShadeHitCost preserves
    // intercept = PIVOT x marginal identically, so the reported pair
    // lands near (88ms, 154us) here only because that curve's own ratio
    // happens to be near the pivot — feed it a curve of the same shape
    // with an eight times larger fixed cost and the same identity holds
    // and the same width comes out. The split is exact-fitting at the
    // width it measured, and that is all it is.
    expect(cost.interceptUs / cost.marginalUs).toBeCloseTo(
      SURFACE_COMPUTE_SHADE_COST_PIVOT,
      6,
    );
    const steep = (n: number): number => 700_000 + 154 * n;
    let other = initialShadeHitCost();
    let otherCap = SURFACE_COMPUTE_SHADE_HIT_CAP_START;
    for (let i = 0; i < 10; i++) {
      const budgetMs = shadeHitBudgetUs(other.interceptUs) / 1000;
      const n = shadeHitBatchSize(other, otherCap);
      other = nextShadeHitCost(other, n, steep(n));
      otherCap = nextShadeBatchSize(otherCap, steep(n) / 1000, budgetMs);
    }
    expect(other.interceptUs / other.marginalUs).toBeCloseTo(
      SURFACE_COMPUTE_SHADE_COST_PIVOT,
      6,
    );
  });

  it("loses that ratio the moment the marginal's decay floor binds", () => {
    // The identity is UNCLAMPED algebra, and one of the clamps is
    // reachable in ordinary operation — an earlier draft of this file's
    // comments claimed it held "whatever the measurements say" and the
    // tests above all walk straight-line curves upward, so none of them
    // could see otherwise. The floor binds exactly when a dispatch
    // measures under HALF its prediction, and the ratio then becomes
    // 2 * PIVOT * (measured / predicted).
    const cost = {
      interceptUs: SURFACE_COMPUTE_SHADE_COST_PIVOT * 200,
      marginalUs: 200,
    };
    const n = 3584;
    const predictedUs = cost.interceptUs + n * cost.marginalUs;
    const measuredUs = predictedUs * 0.4;
    const after = nextShadeHitCost(cost, n, measuredUs);
    expect(after.marginalUs).toBe(
      cost.marginalUs * SURFACE_COMPUTE_SHADE_MARGINAL_DECAY,
    );
    expect(after.interceptUs / after.marginalUs).toBeCloseTo(
      2 * SURFACE_COMPUTE_SHADE_COST_PIVOT * 0.4,
      6,
    );
  });

  it("makes K x PIVOT an upper bound on the width, never a floor", () => {
    // Which is the property that actually matters, since the ratio is not
    // a constant: whatever the clamps do, the sizer may not come out
    // ASKING FOR MORE than the dial names. It errs narrow — the shipped
    // kaleido4 settle reports 3583 at its widest against a 2464 mean.
    const wide =
      SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST *
      SURFACE_COMPUTE_SHADE_COST_PIVOT;
    let cost = initialShadeHitCost();
    let cap = SURFACE_COMPUTE_SHADE_HIT_CAP_START;
    // the width fix's own kaleido4 curve, driven with the drain pattern its
    // own record describes: full-width batches interleaved with the
    // queue-limited slivers the partial-batch HOLD releases on a present
    // interval, which is the pair that trips the floor.
    const costOf = (n: number): number => 283_100 + 64.8 * n;
    for (let i = 0; i < 40; i++) {
      const asked = shadeHitBatchSize(cost, cap);
      const sent = i % 4 === 1 ? Math.min(asked, 200) : asked;
      const budgetMs = shadeHitBudgetUs(cost.interceptUs) / 1000;
      const measuredUs = costOf(sent);
      expect(asked).toBeLessThanOrEqual(wide);
      expect(asked).toBeGreaterThanOrEqual(SURFACE_COMPUTE_WORKGROUP_SIZE);
      cost = nextShadeHitCost(cost, sent, measuredUs);
      cap = nextShadeBatchSize(cap, measuredUs / 1000, budgetMs);
    }
  });
});

describe("surfaceComputeProgressDone", () => {
  it("reads zero at frame start, before any dispatch", () => {
    expect(
      surfaceComputeProgressDone({
        rays: 100,
        active: 100,
        shadeQueued: 0,
        sweepSteps: 0,
        sliced: 0,
        stepsThisPass: 1,
        marchSteps: 160,
      }),
    ).toBe(0);
  });

  it("accrues continuous march credit mid-sweep — the in-sphere first sweep no longer parks at 0", () => {
    // 40 of the 100 active rays are sliced into the current 8-step pass:
    // 0.5 * 40 * (8/160) of the march half; the rest hold the (zero)
    // completed-sweep fraction.
    expect(
      surfaceComputeProgressDone({
        rays: 100,
        active: 100,
        shadeQueued: 0,
        sweepSteps: 0,
        sliced: 40,
        stepsThisPass: 8,
        marchSteps: 160,
      }),
    ).toBe(1);
  });

  it("credits terminal-but-unshaded rays half — the shipped behavior unchanged", () => {
    expect(
      surfaceComputeProgressDone({
        rays: 100,
        active: 0,
        shadeQueued: 60,
        sweepSteps: 20,
        sliced: 0,
        stepsThisPass: 8,
        marchSteps: 160,
      }),
    ).toBe(70);
  });

  it("reaches exactly the ray total at frame completion", () => {
    expect(
      surfaceComputeProgressDone({
        rays: 100,
        active: 0,
        shadeQueued: 0,
        sweepSteps: 40,
        sliced: 0,
        stepsThisPass: 8,
        marchSteps: 160,
      }),
    ).toBe(100);
  });

  it("caps a marching ray's credit at the terminal half once steps meet the budget", () => {
    // sweepSteps (200) may legitimately exceed marchSteps (160) while the
    // last exhausted rays drain: 90 terminal rays plus 10 active rays
    // capped at 0.5 each, never more.
    expect(
      surfaceComputeProgressDone({
        rays: 100,
        active: 10,
        shadeQueued: 0,
        sweepSteps: 200,
        sliced: 0,
        stepsThisPass: 8,
        marchSteps: 160,
      }),
    ).toBe(95);
  });

  it("is continuous across a sweep boundary — dispatched-ray credit equals next sweep's base credit", () => {
    // A fully-dispatched sweep (sliced === active) folding stepsThisPass
    // into sweepSteps must not move the number when no rays terminated:
    // the monotonicity seam the doc comment argues for.
    const preBoundary = surfaceComputeProgressDone({
      rays: 100,
      active: 50,
      shadeQueued: 20,
      sweepSteps: 8,
      sliced: 50,
      stepsThisPass: 8,
      marchSteps: 160,
    });
    const postBoundary = surfaceComputeProgressDone({
      rays: 100,
      active: 50,
      shadeQueued: 20,
      sweepSteps: 16,
      sliced: 0,
      stepsThisPass: 8,
      marchSteps: 160,
    });
    expect(preBoundary).toBe(42.5);
    expect(postBoundary).toBe(42.5);
    expect(preBoundary).toBe(postBoundary);
  });
});

describe("subPixelSample", () => {
  it("puts pass 0 at the pixel CENTRE exactly — the claim that a supersampled frame's first pass is the pre-supersampling one", () => {
    // Not "close to" 0.5: every ray derivation used to spell the centre as a
    // literal 0.5, so anything else here makes pass 0 a different image and
    // the whole bit-identity argument false.
    expect(subPixelSample(0)).toEqual([0.5, 0.5]);
  });

  it("treats a negative index as pass 0 rather than walking off the sequence", () => {
    expect(subPixelSample(-1)).toEqual([0.5, 0.5]);
  });

  it("keeps every later pass strictly inside the pixel", () => {
    for (let s = 1; s < 64; s++) {
      const [x, y] = subPixelSample(s);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(1);
    }
  });

  it("is the same eight offsets on every device — the shipped sequence, by value", () => {
    // "Seedless and device-independent" is a claim about WHICH numbers come
    // out, so the numbers are written down: pass 0 the exact pixel centre,
    // passes 1-7 the R2 low-discrepancy sequence `(0.5 + phi2^-1 * s) % 1`,
    // `(0.5 + phi2^-2 * s) % 1`. Every step is an IEEE
    // multiply/add/remainder on doubles, so these are exact on any engine —
    // and the WebGL strip arm imports this same function, which is what
    // makes "8 samples" one picture across the two engines. Comparing the
    // call to itself asserted none of that.
    expect(Array.from({ length: 8 }, (_, s) => subPixelSample(s))).toEqual([
      [0.5, 0.5],
      [0.2548776662466927, 0.06984029099805289],
      [0.009755332493385449, 0.639680581996106],
      [0.764632998740078, 0.2095208729941591],
      [0.5195106649867709, 0.779361163992212],
      [0.27438833123346384, 0.3492014549902649],
      [0.029265997480155903, 0.9190417459883182],
      [0.7841436637268488, 0.48888203698637156],
    ]);
  });

  it("stratifies the eight passes the settle actually traces: eight distinct 4x4 cells, all four quadrants", () => {
    // The point of a low-discrepancy sequence over a jittered grid is that
    // stopping after ANY number of passes leaves an evenly covered pixel, and
    // the shipped count is where that has to hold. Measured: the first eight
    // offsets occupy eight distinct sixteenths AND all four quarters. (Not
    // asserted at sixteen, where the sequence does collide once — 15 cells,
    // not 16. Pinning the shipped count is the honest claim.)
    const cell = (n: number, s: number): string => {
      const [x, y] = subPixelSample(s);
      return `${Math.floor(x * n)},${Math.floor(y * n)}`;
    };
    const sixteenths = new Set(Array.from({ length: 8 }, (_, s) => cell(4, s)));
    const quarters = new Set(Array.from({ length: 8 }, (_, s) => cell(2, s)));
    expect(sixteenths.size).toBe(8);
    expect(quarters.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Deferred-teardown harness
//
// Pins the state machine `destroy()` / `releaseFrame()` / `destroyDevice()`
// make between them: a `destroy()` landing while a frame is still counted
// must not touch the device until that frame unwinds, and the device must
// never be destroyed twice. Tearing a device down under a frame parked on
// live submitted GPU work took the whole Firefox PROCESS down, so this is the
// costliest thing in the file to get wrong — and a fake GPUDevice is the only
// way to drive a state machine whose real inputs are a GPU driver's timing.
// `scripts/surface-teardown.verify.mjs` stays the authority on real devices;
// these tests are the fast regression net under the counting.
//
// The renderer is built through its init-object constructor, the seam this
// suite exists for — the same one `flame-gpu-backend.test.ts` drives its twin
// through.
// ---------------------------------------------------------------------------

// `GPUBufferUsage` is a real runtime global in a browser/WebGPU context, not
// just the compile-time ambient type `@webgpu/types` declares — a frame's
// buffer allocation reads its flags directly, mirroring the real WebGPU API.
// Node has no such global, so a plain Node test run needs the same minimal
// stand-in a browser provides for free (values are the WebGPU spec's own flag
// bits; nothing here reads them beyond handing them to the fake `createBuffer`
// below, which ignores its argument entirely). Same stand-in, same reason, as
// flame-gpu-backend.test.ts's `GPUMapMode`.
globalThis.GPUBufferUsage = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
};
globalThis.GPUMapMode = { READ: 0x1, WRITE: 0x2 };
globalThis.GPUShaderStage = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
};
globalThis.GPUTextureUsage = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
  TRANSIENT_ATTACHMENT: 0x20,
};

interface PaletteResourceHarness {
  renderer: SurfaceComputeRenderer;
  layoutDescriptors: GPUBindGroupLayoutDescriptor[];
  bufferDescriptors: GPUBufferDescriptor[];
  paramsBuffer: GPUBuffer;
  shaderSources: string[];
  textureDescriptors: GPUTextureDescriptor[];
  textureWrites: ReturnType<typeof vi.fn>;
  bufferWrites: ReturnType<typeof vi.fn>;
  bindGroups: GPUBindGroupDescriptor[];
  primaryTexture: GPUTexture;
  balloonTexture: GPUTexture | null;
}

/** Drive the real buildOnDevice resource/layout branch over an inert device.
 * Shader generation and all packers remain production code; only WebGPU
 * allocation/compilation outcomes are supplied by the fake. */
async function createPaletteResourceHarness(
  balloon: boolean,
  targetOverride?: SurfaceComputeAnyTarget,
  lighting = false,
  deviceFeatures: string[] = [],
  opticsOpts?: {
    chunkPaths?: number;
    maxPaths?: number;
    backend?: "finiteSolid" | "sphereInversion";
  },
  finiteCacheCrossings?: boolean,
): Promise<PaletteResourceHarness> {
  const layoutDescriptors: GPUBindGroupLayoutDescriptor[] = [];
  const bufferDescriptors: GPUBufferDescriptor[] = [];
  const shaderSources: string[] = [];
  const textureDescriptors: GPUTextureDescriptor[] = [];
  const bindGroups: GPUBindGroupDescriptor[] = [];
  const textureWrites = vi.fn();
  const bufferWrites = vi.fn();
  const buffers: GPUBuffer[] = [];
  const textures: GPUTexture[] = [];
  const neverLost = new Promise<GPUDeviceLostInfo>(() => {});
  const device = {
    lost: neverLost,
    // The pass-duration instrument gates on the device's own feature set
    // (defensively, this fake predates the check); a harness that names
    // "timestamp-query" gets the query set allocated and its two staging
    // buffers captured beside the session's own.
    features: new Set<string>(deviceFeatures),
    createQuerySet: () => ({}),
    limits: {
      maxBufferSize: 1 << 28,
      maxStorageBufferBindingSize: 1 << 28,
      maxComputeWorkgroupsPerDimension: 65535,
    },
    queue: {
      writeBuffer: bufferWrites,
      writeTexture: textureWrites,
      // The frame seed's one submission, which precedes the Params upload
      // the capture helpers below stop at. Inert: nothing here is traced.
      submit: () => {},
    },
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => {},
        setBindGroup: () => {},
        dispatchWorkgroups: () => {},
        end: () => {},
      }),
      finish: () => ({}),
    }),
    pushErrorScope: () => {},
    popErrorScope: async () => null,
    createShaderModule: (descriptor: GPUShaderModuleDescriptor) => {
      // The frame seed compiles as its own module beside the kernel pair;
      // `shaderSources` is the pair's codegen, which these tests pin.
      if (!descriptor.code.includes("fn seedFrame(")) {
        shaderSources.push(descriptor.code);
      }
      return {
        getCompilationInfo: async () => ({ messages: [] }),
      };
    },
    createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => {
      layoutDescriptors.push(descriptor);
      return {};
    },
    createPipelineLayout: () => ({}),
    createComputePipelineAsync: async () => ({}),
    createBuffer: (descriptor: GPUBufferDescriptor) => {
      bufferDescriptors.push(descriptor);
      const buffer = { destroy: vi.fn() } as unknown as GPUBuffer;
      buffers.push(buffer);
      return buffer;
    },
    createTexture: (descriptor: GPUTextureDescriptor) => {
      textureDescriptors.push(descriptor);
      const texture = {
        createView: () => ({}),
        destroy: vi.fn(),
      } as unknown as GPUTexture;
      textures.push(texture);
      return texture;
    },
    createSampler: () => ({}),
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
      bindGroups.push(descriptor);
      return {};
    },
    destroy: vi.fn(),
  } as unknown as GPUDevice;
  const de = buildSurfaceDE(defaultTransforms(), null, {
    order: 1,
    plane: "xz",
  });
  const target: SurfaceComputeAnyTarget = targetOverride ?? {
    kind: "ifs",
    de,
    balloon,
  };
  const build = Reflect.get(SurfaceComputeRenderer, "buildOnDevice") as (
    device: GPUDevice,
    target: SurfaceComputeAnyTarget,
    colors: [number, number, number][],
    trapIndices: number[],
    shadeDeWidth: number,
    adapterStatus: { label: string | undefined; software: boolean },
    materials: SurfaceMaterialSlots | null,
    lighting: boolean,
    opticsBackend?: "finiteSolid" | "sphereInversion",
    chunkPaths?: number,
    maxPaths?: number,
    cacheCrossings?: boolean,
    siChunkPaths?: number,
  ) => Promise<SurfaceComputeRenderer>;
  const siOptics = opticsOpts?.backend === "sphereInversion";
  const renderer = await build.call(
    SurfaceComputeRenderer,
    device,
    target,
    [[1, 1, 1]],
    [0],
    1,
    { label: undefined, software: false },
    opticsOpts
      ? surfaceSlotMaterials(
          [{ ...defaultTransforms()[0], optics: { model: "dielectric" } }],
          [{ baseIndex: 0 }],
          undefined,
          FINITE_SOLID_HALF_EXTENT,
        )
      : null,
    lighting,
    opticsOpts ? (opticsOpts.backend ?? "finiteSolid") : undefined,
    siOptics ? undefined : opticsOpts?.chunkPaths,
    opticsOpts?.maxPaths,
    finiteCacheCrossings,
    siOptics ? opticsOpts.chunkPaths : undefined,
  );
  return {
    renderer,
    layoutDescriptors,
    bufferDescriptors,
    paramsBuffer: buffers[0],
    shaderSources,
    textureDescriptors,
    textureWrites,
    bufferWrites,
    bindGroups,
    primaryTexture: textures[0],
    balloonTexture: textures[1] ?? null,
  };
}

/** Stop a real host frame at its first Params upload. Everything through
 * target routing and the selected production packer has run; command
 * encoding/readback remain outside this host-only fake-device seam. */
async function captureParamsWrite(
  harness: PaletteResourceHarness,
  spec: SurfaceComputeFrameSpec,
): Promise<ArrayBuffer> {
  const opaqueBuffer = (): GPUBuffer => ({}) as GPUBuffer;
  Reflect.set(harness.renderer, "allocateFrameBuffers", async () => ({
    rays: spec.width * spec.height,
    states: opaqueBuffer(),
    active: opaqueBuffer(),
    color: opaqueBuffer(),
    layer: opaqueBuffer(),
  }));
  Reflect.set(harness.renderer, "uploadedLutVersion", spec.lutVersion);
  harness.bufferWrites.mockClear();

  const stop = new Error("params upload observed");
  let params: ArrayBuffer | null = null;
  harness.bufferWrites.mockImplementation(
    (buffer: GPUBuffer, _offset: number, data: ArrayBuffer) => {
      if (buffer === harness.paramsBuffer) {
        params = data;
        throw stop;
      }
    },
  );
  const run = Reflect.get(harness.renderer, "runFrame") as (
    token: number,
    frame: SurfaceComputeFrameSpec,
    opts: Record<string, never>,
  ) => Promise<unknown>;
  await expect(run.call(harness.renderer, 0, spec, {})).rejects.toBe(stop);
  expect(params).not.toBeNull();
  return params!;
}

describe("SurfaceComputeRenderer finite-tiling target integration", () => {
  it("routes every 3D/4D target through tiled codegen and an exactly sized Params allocation/write", async () => {
    const clip = {
      parts: [
        {
          primitive: { kind: "sphere" as const, radius: 0.4 },
          combine: "union" as const,
        },
      ],
    };
    const tiling3 = resolveTiling({ group: "a3", clip })!;
    const tiling4 = resolveTiling({ group: "f4", clip })!;
    const cases: {
      label: string;
      target: SurfaceComputeTarget;
      dimension: 3 | 4;
      groupCode: number;
      expectedBytes: number;
    }[] = [
      {
        label: "ifs",
        target: {
          kind: "ifs",
          de: buildSurfaceDE(defaultTransforms(), null, {
            order: 1,
            plane: "xz",
          }),
          tiling: tiling3,
        },
        dimension: 3,
        groupCode: 1,
        expectedBytes: SURFACE_GPU_PARAMS_TILING_BYTES,
      },
      {
        label: "escape",
        target: {
          kind: "escape",
          de: buildEscapeDE(foldChain()),
          tiling: tiling3,
        },
        dimension: 3,
        groupCode: 1,
        expectedBytes: SURFACE_GPU_PARAMS_TILING_BYTES,
      },
      {
        label: "bulb",
        target: {
          kind: "bulb",
          de: buildBulbDE(mandelbulbClassic()),
          tiling: tiling3,
        },
        dimension: 3,
        groupCode: 1,
        expectedBytes: SURFACE_GPU_PARAMS_TILING_BYTES,
      },
      {
        label: "escape4",
        target: {
          kind: "escape4",
          de: buildEscapeDE4(mandelboxBrick()),
          tiling: tiling4,
        },
        dimension: 4,
        groupCode: 6,
        expectedBytes: SURFACE_GPU_PARAMS4_ESCAPE_TILING_BYTES,
      },
      {
        label: "ifs4",
        target: {
          kind: "ifs4",
          de: buildSurfaceDE4(defaultTransforms(), null, {
            order: 1,
            plane: "xz",
          }),
          tiling: tiling4,
        },
        dimension: 4,
        groupCode: 6,
        expectedBytes: SURFACE_GPU_PARAMS4_TILING_BYTES,
      },
    ];

    for (const testCase of cases) {
      const harness = await createPaletteResourceHarness(
        false,
        testCase.target,
      );
      expect(harness.shaderSources.length, testCase.label).toBeGreaterThan(0);
      for (const source of harness.shaderSources) {
        expect(source, testCase.label).toContain(
          `fn tilingFold(pIn: vec${testCase.dimension}f)`,
        );
        expect(source, testCase.label).toContain("fn tilingClipSdf(");
        expect(source, testCase.label).toContain(
          `params.tilingGroup != ${testCase.groupCode}u`,
        );
      }

      const spec = frameSpec();
      if (testCase.dimension === 4) {
        spec.view4 = {
          rotor: rotorMatrix(identityRotorPair()),
          w0: 0,
          sliceHalfW: 0,
        };
      }
      const params = await captureParamsWrite(harness, spec);
      expect(harness.bufferDescriptors[0].size, testCase.label).toBe(
        testCase.expectedBytes,
      );
      expect(params.byteLength, testCase.label).toBe(testCase.expectedBytes);
      const tilingOffset = testCase.expectedBytes - 16;
      expect(
        new DataView(params).getUint32(tilingOffset, true),
        testCase.label,
      ).toBe(testCase.groupCode);
      expect(
        Array.from(new Uint8Array(params, tilingOffset + 4, 12)),
        testCase.label,
      ).toEqual(new Array(12).fill(0));
      harness.renderer.destroy();
    }
  });
});

describe("SurfaceComputeRenderer general finite target", () => {
  const noSymmetry = { order: 1, plane: "xz" as const };
  const construction = analyzeFiniteSolidGeneral(
    defaultTransforms(),
    null,
    noSymmetry,
    1,
    3,
  );
  if (construction.status !== "eligible" || !construction.construction) {
    throw new Error("the default-system fixture must admit");
  }
  const wire: FiniteSolidGeneralWire = construction.construction;

  it("bakes the document's own maps into the emitted kernels and leaves the shipped construction alone", async () => {
    const general = await createPaletteResourceHarness(false, {
      kind: "finite",
      level: 1,
      general: wire,
    });
    expect(general.shaderSources.length).toBeGreaterThan(0);
    for (const source of general.shaderSources) {
      expect(source).toContain("const FIN_M = array<vec4f, 16>(");
      // The default system's invariant BOX root: eight corners.
      expect(source).toContain("const FIN_ROOT = array<vec4f, 8>(");
      expect(source).toContain("fn finCompose(");
    }
    general.renderer.destroy();
    const shipped = await createPaletteResourceHarness(false, {
      kind: "finite",
      level: 2,
    });
    for (const source of shipped.shaderSources) {
      // The shipped grid construction's own display body is present; the
      // baked word tree is not.
      expect(source).toContain("fn finiteBoxSdf(");
      expect(source).not.toContain("const FIN_M ");
      expect(source).not.toContain("fn finCompose(");
    }
    shipped.renderer.destroy();
  });
});

describe("SurfaceComputeRenderer fold-final post params tail", () => {
  const finalTransform: Transform = {
    id: 99,
    position: [0.15, -0.1, 0.05],
    rotation: [0.2, 0.3, 0.1],
    scale: [0.9, 0.9, 0.9],
    variations: [{ type: "boxfold", weight: 0.55 }],
    post: {
      m: [0.5, 0, 0, 0, 1, 0, 0, 0, 2],
      t: [0.25, -0.5, 0.75],
    },
  };

  it("compile-gates lensPost and allocates its exact appended tail in 3D and 4D", async () => {
    const cases: {
      label: string;
      target: SurfaceComputeTarget;
      expectedBytes: number;
      marker: string;
    }[] = [
      {
        label: "ifs",
        target: {
          kind: "ifs",
          de: buildSurfaceDE(defaultTransforms(), finalTransform),
        },
        expectedBytes: 288 + SURFACE_GPU_LENS_POST_BYTES,
        marker: "lensPostI0: vec3f",
      },
      {
        label: "ifs4",
        target: {
          kind: "ifs4",
          de: buildSurfaceDE4(defaultTransforms(), finalTransform),
        },
        expectedBytes: 576 + SURFACE_GPU_LENS4_POST_BYTES,
        marker: "lens4PostI0: vec4f",
      },
    ];

    for (const testCase of cases) {
      const harness = await createPaletteResourceHarness(
        false,
        testCase.target,
      );
      expect(harness.bufferDescriptors[0].size, testCase.label).toBe(
        testCase.expectedBytes,
      );
      for (const source of harness.shaderSources) {
        expect(source, testCase.label).toContain(testCase.marker);
      }
      harness.renderer.destroy();
    }
  });
});

describe("SurfaceComputeRenderer condensation session resources", () => {
  it("does not allocate, upload, or bind a mesh atlas for an analytic scene", async () => {
    const harness = await createPaletteResourceHarness(false);

    for (const source of harness.shaderSources) {
      expect(source).not.toContain("@binding(11)");
    }
    for (const layout of harness.layoutDescriptors) {
      expect(layout.entries).not.toContainEqual(
        expect.objectContaining({ binding: 11 }),
      );
    }
    expect(harness.textureDescriptors).not.toContainEqual(
      expect.objectContaining({ format: "r32float" }),
    );
    // The one write is the always-present palette LUT, not a mesh slab.
    expect(harness.textureWrites).toHaveBeenCalledTimes(1);
    harness.renderer.destroy();
  });

  it("uploads one active R32F slab and adds binding 11 to both layouts for the mesh preset", async () => {
    const de = buildSurfaceDE(starFoundry());
    const target: SurfaceComputeTarget = { kind: "ifs", de };
    expect(surfaceComputeTargetMeshIds(target)).toEqual(["star-prism-v1"]);
    const harness = await createPaletteResourceHarness(false, target);

    expect(harness.shaderSources).toHaveLength(2);
    for (const source of harness.shaderSources) {
      expect(source).toContain(
        "@group(0) @binding(11) var shapeMeshSdfTex: texture_3d<f32>;",
      );
    }
    // Layouts 0 and 1 are the march/shade pair; the frame seed's layout
    // follows them and never samples the atlas.
    const [marchLayout, shadeLayout, seedLayout] = harness.layoutDescriptors;
    for (const layout of [marchLayout, shadeLayout]) {
      expect(layout.entries).toContainEqual(
        expect.objectContaining({
          binding: 11,
          texture: {
            sampleType: "unfilterable-float",
            viewDimension: "3d",
          },
        }),
      );
    }
    expect(
      Array.from(seedLayout.entries).some((entry) => entry.binding === 11),
    ).toBe(false);
    expect(harness.textureDescriptors).toContainEqual(
      expect.objectContaining({
        dimension: "3d",
        format: "r32float",
        size: { width: 64, height: 64, depthOrArrayLayers: 64 },
      }),
    );
    expect(harness.textureWrites).toHaveBeenCalledTimes(2);
    expect(harness.textureWrites.mock.calls[1][1]).toBe(
      activeMeshSdfAtlas(["star-prism-v1"]).values,
    );
    harness.renderer.destroy();
  });

  it("passes emitter geometry into both kernels and allocates the appended params block", async () => {
    const de = buildSurfaceDE(
      gearworks(),
      null,
      { order: 1, plane: "xz" },
      {
        condensationDepthBand: { minDepth: 2, maxDepth: 4 },
      },
    );
    expect(de.condensation?.emitters.length).toBeGreaterThan(0);
    const harness = await createPaletteResourceHarness(false, {
      kind: "ifs",
      de,
    });

    expect(harness.shaderSources).toHaveLength(2);
    for (const source of harness.shaderSources) {
      expect(source).toContain("struct CondensationHit");
      expect(source).toContain("condensationShapeSdf");
    }
    expect(harness.bufferDescriptors[0].size).toBe(304);
    harness.renderer.destroy();
  });

  it("does the same for the slab-refusing 4D kernel pair", async () => {
    const de = buildSurfaceDE4(
      gearworks(),
      null,
      { order: 1, plane: "xz" },
      {
        condensationDepthBand: { maxDepth: 0 },
      },
    );
    const harness = await createPaletteResourceHarness(false, {
      kind: "ifs4",
      de,
    });

    // An embedded condensation solid does not admit the 4D segment query,
    // so this session intentionally compiles only its slab-free pair.
    expect(harness.shaderSources).toHaveLength(2);
    for (const source of harness.shaderSources) {
      expect(source).toContain("struct CondensationHit");
      expect(source).toContain("condensationShapeSdf");
      expect(source).toContain("max(shapeDistance, 0.0), local.w");
    }
    expect(harness.bufferDescriptors[0].size).toBe(592);
    harness.renderer.destroy();
  });
});

describe("SurfaceComputeRenderer scheduled-hybrid session resources", () => {
  const schedule = {
    transforms: [
      {
        id: 0,
        position: [-0.4, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [0.45, 0.45, 0.45] as [number, number, number],
      },
      {
        id: 1,
        position: [0.4, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [0.45, 0.45, 0.45] as [number, number, number],
      },
    ] satisfies Transform[],
    depth: 2,
  };

  it("selects scheduled 3D kernels and allocates their appended params block", async () => {
    const de = buildSurfaceDE(
      defaultTransforms(),
      null,
      { order: 1, plane: "xz" },
      { schedule },
    );
    const harness = await createPaletteResourceHarness(false, {
      kind: "ifs",
      de,
    });

    expect(harness.shaderSources).toHaveLength(2);
    for (const source of harness.shaderSources) {
      expect(source).toContain("scheduleMapStart");
      expect(source).toContain("scheduleBound1");
    }
    expect(harness.bufferDescriptors[0].size).toBe(
      SURFACE_GPU_PARAMS_SCHEDULE_BYTES,
    );
    harness.renderer.destroy();
  });

  it("does the same for both slab variants of the 4D lift", async () => {
    const de = buildSurfaceDE4(
      defaultTransforms(),
      null,
      { order: 1, plane: "xz" },
      { schedule },
    );
    const harness = await createPaletteResourceHarness(false, {
      kind: "ifs4",
      de,
    });

    expect(harness.shaderSources).toHaveLength(4);
    for (const source of harness.shaderSources) {
      expect(source).toContain("scheduleMapStart");
      expect(source).toContain("scheduleBound1");
    }
    expect(harness.bufferDescriptors[0].size).toBe(
      SURFACE_GPU_PARAMS4_SCHEDULE_BYTES,
    );
    harness.renderer.destroy();
  });

  it("allocates the combined schedule-plus-condensation ABI", async () => {
    const de = buildSurfaceDE(
      gearworks(),
      null,
      { order: 1, plane: "xz" },
      {
        schedule,
        condensationDepthBand: { minDepth: 1, maxDepth: 3 },
      },
    );
    const harness = await createPaletteResourceHarness(false, {
      kind: "ifs",
      de,
    });

    for (const source of harness.shaderSources) {
      expect(source).toContain("scheduleMapStart");
      expect(source).toContain("struct CondensationHit");
    }
    expect(harness.bufferDescriptors[0].size).toBe(
      SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_BYTES,
    );
    harness.renderer.destroy();
  });
});

describe("SurfaceComputeRenderer reverse-chi session resources", () => {
  const graphTransforms: Transform[] = [
    {
      id: 0,
      position: [-0.3, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.4, 0.4, 0.4],
      chaos: [1, 0],
    },
    {
      id: 1,
      position: [0.3, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.4, 0.4, 0.4],
      chaos: [0, 1],
    },
  ];

  it("passes graph state to both 3D kernels and allocates the appended 24-mask block", async () => {
    const de = buildSurfaceDE(graphTransforms);
    expect(de.chaos?.predecessorMasks).toEqual(Uint32Array.from([1, 2]));
    const harness = await createPaletteResourceHarness(false, {
      kind: "ifs",
      de,
    });

    expect(harness.shaderSources).toHaveLength(2);
    for (const source of harness.shaderSources) {
      expect(source).toContain("fn chaosAllows(");
      expect(source).toContain("params.chaosMask0");
    }
    expect(SURFACE_GPU_PARAMS_CHAOS_BYTES).toBe(288 + SURFACE_GPU_CHAOS_BYTES);
    expect(harness.bufferDescriptors[0].size).toBe(
      SURFACE_GPU_PARAMS_CHAOS_BYTES,
    );
    harness.renderer.destroy();
  });

  it("does the same for both flat-lift 4D slab variants without underallocating the forced lens-prefix ABI", async () => {
    const de = buildSurfaceDE4(graphTransforms);
    const harness = await createPaletteResourceHarness(false, {
      kind: "ifs4",
      de,
    });

    expect(harness.shaderSources).toHaveLength(4);
    for (const source of harness.shaderSources) {
      expect(source).toContain("fn chaosAllows(");
      expect(source).toContain("params.chaosMask0");
    }
    expect(SURFACE_GPU_PARAMS4_CHAOS_BYTES).toBe(576 + SURFACE_GPU_CHAOS_BYTES);
    expect(harness.bufferDescriptors[0].size).toBe(
      SURFACE_GPU_PARAMS4_CHAOS_BYTES,
    );
    harness.renderer.destroy();
  });
});

describe("SurfaceComputeRenderer shape-trap geometry session resources", () => {
  const authoredTrap = () => ({
    ...PRESET_TRAPS.foldChainGear!(),
    geometryLevelMin: 2,
    geometryLevelMax: 5,
  });

  it("selects the geometry-enabled 3D kernel pair while color-only stays classic", async () => {
    const trap = authoredTrap();
    const resolved = resolveShapeTrap(trap);
    const de = buildEscapeDE(foldChain());
    const geometry = await createPaletteResourceHarness(false, {
      kind: "escape",
      de,
      shapeTrap: trap.shape,
      shapeTrapGeometry: resolved,
    });

    expect(geometry.bufferDescriptors[0].size).toBe(400);
    expect(geometry.shaderSources).toHaveLength(2);
    for (const source of geometry.shaderSources) {
      expect(source).toContain("var trapDistance = 1.0e30");
      expect(source).toContain("i >= 2u && i <= 5u");
      expect(source).toContain("return min(escapeDistance, trapDistance);");
    }

    const colorOnly = await createPaletteResourceHarness(false, {
      kind: "escape",
      de,
      shapeTrap: trap.shape,
    });
    expect(colorOnly.bufferDescriptors[0].size).toBe(400);
    for (const source of colorOnly.shaderSources) {
      expect(source).not.toContain("var trapDistance = 1.0e30");
    }
    expect(
      colorOnly.shaderSources.some((source) =>
        source.includes("fn trapCandidate"),
      ),
    ).toBe(true);
    geometry.renderer.destroy();
    colorOnly.renderer.destroy();
  });

  it("selects the same inclusive geometry band for the 4D escape kernel pair", async () => {
    const trap = authoredTrap();
    const harness = await createPaletteResourceHarness(false, {
      kind: "escape4",
      de: buildEscapeDE4(mandelboxBrick()),
      shapeTrap: trap.shape,
      shapeTrapGeometry: resolveShapeTrap(trap),
    });

    expect(harness.bufferDescriptors[0].size).toBe(688);
    expect(harness.shaderSources).toHaveLength(2);
    for (const source of harness.shaderSources) {
      expect(source).toContain("i >= 2u && i <= 5u");
      expect(source).toContain("trapLocalSdf(v.xyz)");
      expect(source).toContain("return min(escapeDistance, trapDistance);");
    }
    harness.renderer.destroy();
  });
});

describe("SurfaceComputeRenderer sphere-inversion targets", () => {
  function construction(authored: SphereInversionAuthored) {
    const r = resolveSphereInversion(authored);
    if (!r.ok) throw new Error(r.reasons.join("; "));
    return r.construction;
  }

  it("builds a 3D session on the sphereInv kernel pair with the table wire at binding 1 and a 288 B params buffer (336 B with a floor)", async () => {
    const de = buildSphereInversionDE(
      construction({
        arrangement: "ico12",
        seed: { kind: "cutShell" },
        depth: 5,
      }),
    );
    const tableBytes = packSphereInversionGpuTables(de).data.byteLength;
    const plain = await createPaletteResourceHarness(false, {
      kind: "sphereInversion",
      de,
    });
    expect(plain.bufferDescriptors[0].size).toBe(288);
    expect(plain.bufferDescriptors.some((d) => d.size === tableBytes)).toBe(
      true,
    );
    expect(plain.shaderSources).toHaveLength(2);
    for (const source of plain.shaderSources) {
      expect(source).toContain("var<storage, read> siTable: array<vec4f>;");
      expect(source).toContain("fn siEstimate(q: vec3f) -> SiResult");
    }
    plain.renderer.destroy();
    const floor = await createPaletteResourceHarness(false, {
      kind: "sphereInversion",
      de,
      groundPlane: true,
    });
    expect(floor.bufferDescriptors[0].size).toBe(336);
    expect(floor.shaderSources.every((src) => src.includes("groundY"))).toBe(
      true,
    );
    floor.renderer.destroy();
  });

  it("builds a native 4D session on the sphereInv4 pair: 576 B params (624 B with a floor), the 600-cell's 472,416 B table, one kernel pair with no slab twin", async () => {
    const de = buildSphereInversionDE4(
      construction({
        arrangement: "cell600",
        seed: { kind: "cutShell", size: 0.9, thickness: 0.04 },
        depth: 5,
      }),
    );
    const plain = await createPaletteResourceHarness(false, {
      kind: "sphereInversion4",
      de,
    });
    expect(plain.bufferDescriptors[0].size).toBe(576);
    expect(plain.bufferDescriptors.some((d) => d.size === 472_416)).toBe(true);
    expect(plain.shaderSources).toHaveLength(2);
    for (const source of plain.shaderSources) {
      expect(source).toContain("fn siEstimate(q: vec4f) -> SiResult");
      expect(source).toContain("liftSphereInv4(");
    }
    plain.renderer.destroy();
    const floor = await createPaletteResourceHarness(false, {
      kind: "sphereInversion4",
      de,
      groundPlane: true,
    });
    expect(floor.bufferDescriptors[0].size).toBe(624);
    floor.renderer.destroy();
  });
});

async function runPaletteFramePrelude(
  harness: PaletteResourceHarness,
  spec: SurfaceComputeFrameSpec,
): Promise<{ flags: number; textureCalls: unknown[][] }> {
  // Stop immediately after the shade uniform write. This observes LUT
  // upload + flag packing without mocking the march loop or readbacks.
  Reflect.set(harness.renderer, "allocateFrameBuffers", async () => ({}));
  Reflect.set(harness.renderer, "uploadedLutVersion", spec.lutVersion);
  harness.textureWrites.mockClear();
  harness.bufferWrites.mockClear();
  const stop = new Error("shade prelude observed");
  let shadeBytes: ArrayBuffer | null = null;
  harness.bufferWrites.mockImplementationOnce(
    (_buffer: GPUBuffer, _offset: number, data: ArrayBuffer) => {
      shadeBytes = data;
      throw stop;
    },
  );
  const run = Reflect.get(harness.renderer, "runFrame") as (
    token: number,
    spec: SurfaceComputeFrameSpec,
    opts: Record<string, never>,
  ) => Promise<unknown>;
  await expect(run.call(harness.renderer, 0, spec, {})).rejects.toBe(stop);
  expect(shadeBytes).not.toBeNull();
  return {
    flags: new DataView(shadeBytes!).getUint32(124, true),
    textureCalls: harness.textureWrites.mock.calls,
  };
}

describe("SurfaceComputeRenderer balloon palette resources", () => {
  it.each([
    [false, 1, false],
    [true, 2, true],
  ] as const)(
    "allocates and binds the second LUT only when target.balloon is %s",
    async (balloon, expectedTextures, expectsBinding10) => {
      const harness = await createPaletteResourceHarness(balloon);
      expect(harness.textureDescriptors).toHaveLength(expectedTextures);
      // Every allocated LUT is initialized to a valid 256x1 white texture.
      expect(harness.textureWrites).toHaveBeenCalledTimes(expectedTextures);
      for (const descriptor of harness.textureDescriptors) {
        expect(descriptor.size).toEqual({ width: 256, height: 1 });
        expect(descriptor.format).toBe("rgba8unorm");
      }
      const shadeLayout = harness.layoutDescriptors[1];
      expect(
        Array.from(shadeLayout.entries).some((entry) => entry.binding === 10),
      ).toBe(expectsBinding10);

      const ensure = Reflect.get(harness.renderer, "ensureFrameBuffers") as (
        rays: number,
      ) => unknown;
      ensure.call(harness.renderer, 1);
      const shadeBindGroup = harness.bindGroups[1];
      expect(
        Array.from(shadeBindGroup.entries).some(
          (entry) => entry.binding === 10,
        ),
      ).toBe(expectsBinding10);
      if (expectsBinding10) {
        expect(harness.balloonTexture).not.toBeNull();
      } else {
        expect(harness.balloonTexture).toBeNull();
      }
    },
  );

  it("uploads only the target-specific balloon LUT revision and enables flags bit1", async () => {
    const harness = await createPaletteResourceHarness(true);
    const lut = new Uint8Array(256 * 4).fill(73);
    const spec = frameSpec();
    spec.balloon = { center: [0, 0, 0], rho: 2, R: 3, far: 8 };
    spec.balloonLut = lut;
    spec.balloonLutVersion = 7;

    const first = await runPaletteFramePrelude(harness, spec);
    expect(first.flags).toBe(2);
    expect(first.textureCalls).toHaveLength(1);
    expect(first.textureCalls[0][0]).toEqual({
      texture: harness.balloonTexture,
    });
    expect(first.textureCalls[0][1]).toEqual(lut);

    const cached = await runPaletteFramePrelude(harness, spec);
    expect(cached.flags).toBe(2);
    expect(cached.textureCalls).toHaveLength(0);

    spec.balloonLutVersion = 8;
    const revised = await runPaletteFramePrelude(harness, spec);
    expect(revised.textureCalls).toHaveLength(1);
  });

  it("does not upload or set bit1 for inherit, or for a non-balloon target handed stray palette bytes", async () => {
    const balloon = await createPaletteResourceHarness(true);
    const inherit = frameSpec();
    inherit.balloon = { center: [0, 0, 0], rho: 2, R: 3, far: 8 };
    inherit.balloonLut = null;
    inherit.balloonLutVersion = 4;
    const inherited = await runPaletteFramePrelude(balloon, inherit);
    expect(inherited.flags).toBe(0);
    expect(inherited.textureCalls).toHaveLength(0);

    const plain = await createPaletteResourceHarness(false);
    const stray = frameSpec();
    stray.balloonLut = new Uint8Array(256 * 4).fill(255);
    stray.balloonLutVersion = 4;
    const ignored = await runPaletteFramePrelude(plain, stray);
    expect(ignored.flags).toBe(0);
    expect(ignored.textureCalls).toHaveLength(0);
  });
});

/** A promise a test settles on its own schedule, independent of when the
 * class under test actually awaits it — mirrors flame-gpu-backend.test.ts's
 * helper of the same name. */
function deferred(): { promise: Promise<null>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<null>((res) => {
    resolve = () => {
      res(null);
    };
  });
  return { promise, resolve };
}

/** Resolves after a real macrotask boundary, by which point every microtask
 * queued so far has drained — a frame takes several internal `await`s to
 * reach the point it parks at. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The smallest frame the renderer will accept. Only `width`/`height` matter
 * to the teardown path (they size the per-ray buffers); every other field is
 * required by the type and never read before the frame parks. */
function frameSpec(): SurfaceComputeFrameSpec {
  return {
    width: 2,
    height: 2,
    invProjView: new Float32Array(16),
    camPos: [0, 0, 3],
    camForward: [0, 0, -1],
    focusDepth: 3,
    acceptPixelEps: 1e-3,
    tracePixelEps: 1e-3,
    maxDepth: 8,
    marchSteps: 32,
    shadowSteps: 0,
    aoTaps: 0,
    hitFloor: 1e-4,
    lightDir: [0, 1, 0],
    ambient: 0.2,
    bgTop: [0, 0, 0],
    bgBottom: [0, 0, 0],
    colorSource: 0,
    colorSpeed: 0.5,
    lut: null,
    lutVersion: 0,
    dither: false,
  };
}

interface TeardownHarness {
  renderer: SurfaceComputeRenderer;
  /** Spy on the fake device's own `destroy()` — the one call the whole
   * deferred-teardown state machine exists to TIME correctly. */
  deviceDestroy: ReturnType<typeof vi.fn>;
  /** One destroy spy per per-frame GPU buffer the renderer has allocated so
   * far (states/active/color/layer/status + the three staging buffers). Grows as
   * frames allocate; a parked frame's staging buffers are exactly the ones
   * that must not be freed under it. */
  bufferDestroys: ReturnType<typeof vi.fn>[];
  /** Settles the device round trip an in-flight frame is parked on. A frame
   * makes several, and the FIRST — the error-scope pair
   * `allocateFrameBuffers` awaits over its buffer allocation — is the one a
   * fake device reaches without reimplementing the march loop's readbacks.
   * In production a frame parks further in, on
   * `mapAsync`/`onSubmittedWorkDone` over submitted work; either way what is
   * under test is the COUNTED SPAN, from `renderFrame`'s increment to its
   * `.finally` release, which is the same span whichever await the frame
   * happens to be sitting on. It settles with NO error, so the frame resumes
   * into the ordinary token check and unwinds there — the real cancellation
   * path a `destroy()` (or a newer frame) puts
   * it on, not an error path. */
  settleFrameWork: () => void;
  /** Resolves the device's `lost` promise, which is what a real device does
   * once it goes away — including when we destroyed it ourselves. */
  loseDevice: () => void;
}

/**
 * Builds a `SurfaceComputeRenderer` over a fake GPUDevice. The fake
 * CONFIGURES outcomes (a settle-on-demand device round trip, spies counting
 * destroys) and implements no GPU behavior: pipelines, layouts, bind groups
 * and the LUT texture/sampler are opaque casts, since nothing on the teardown
 * path inspects them. `lost` never settles unless a test calls `loseDevice` —
 * or `lostBeforeConstruction` settles it up front, which is what a device
 * that died during `create()`'s pipeline compiles hands the constructor.
 */
function createHarness(
  opts: {
    lostBeforeConstruction?: boolean;
    target?: SurfaceComputeTarget;
  } = {},
): TeardownHarness {
  const work = deferred();
  const lost = deferred();
  const bufferDestroys: ReturnType<typeof vi.fn>[] = [];
  const deviceDestroy = vi.fn();
  const device = {
    lost: lost.promise,
    // Generous enough that a 2x2 frame is nowhere near the device's ray
    // ceiling this renderer checks before it allocates anything.
    limits: {
      maxBufferSize: 1 << 28,
      maxStorageBufferBindingSize: 1 << 28,
      maxComputeWorkgroupsPerDimension: 65535,
    },
    pushErrorScope: () => {},
    // Both of the allocation's two pops share one promise, so a single
    // `settleFrameWork()` releases the parked frame.
    popErrorScope: () => work.promise,
    createBuffer: () => {
      const destroy = vi.fn();
      bufferDestroys.push(destroy);
      return { destroy } as unknown as GPUBuffer;
    },
    createBindGroup: () => ({}) as GPUBindGroup,
    destroy: deviceDestroy,
  } as unknown as GPUDevice;

  // Settled BEFORE the renderer exists, so its constructor's `.then` is
  // already queued to run with nothing registered to hear it.
  if (opts.lostBeforeConstruction) lost.resolve();

  const renderer = new SurfaceComputeRenderer({
    device,
    // The teardown path never reads the target: the packers that do sit past
    // the point a parked frame has reached.
    target: opts.target ?? ({ kind: "ifs" } as unknown as SurfaceComputeTarget),
    marchPipeline: {} as GPUComputePipeline,
    marchLayout: {} as GPUBindGroupLayout,
    shadePipeline: {} as GPUComputePipeline,
    shadeLayout: {} as GPUBindGroupLayout,
    marchPipelineNoSlab: null,
    shadePipelineNoSlab: null,
    transportPipeline: null,
    transportPipelineNoSlab: null,
    opticsMapsBuf: null,
    seedPipeline: {} as GPUComputePipeline,
    seedLayout: {} as GPUBindGroupLayout,
    seedBuf: {} as GPUBuffer,
    paramsBuf: {} as GPUBuffer,
    shadeBuf: {} as GPUBuffer,
    mapsBuf: {} as GPUBuffer,
    shadeMapsBuf: {} as GPUBuffer,
    lutTex: { createView: () => ({}) } as unknown as GPUTexture,
    lutSamp: {} as GPUSampler,
    software: false,
  });

  return {
    renderer,
    deviceDestroy,
    bufferDestroys,
    settleFrameWork: work.resolve,
    loseDevice: lost.resolve,
  };
}

describe("SurfaceComputeRenderer live lattice scale", () => {
  it("re-resolves h on the existing target without changing its baked clip", () => {
    const clip = {
      parts: [
        {
          primitive: { kind: "sphere" as const, radius: 0.5 },
          combine: "union" as const,
        },
      ],
    };
    const target = {
      kind: "ifs",
      de: {},
      tiling: resolveTiling({ kind: "lattice", cellScale: 1.5, clip }, 2),
    } as unknown as SurfaceComputeTarget;
    const { renderer } = createHarness({ target });

    renderer.setLatticeScale(2.5);

    expect(target.tiling).toEqual(
      resolveTiling({ kind: "lattice", cellScale: 2.5, clip }, 2),
    );
  });

  it("is inert for a target without lattice tiling", () => {
    const target = { kind: "ifs" } as unknown as SurfaceComputeTarget;
    const { renderer } = createHarness({ target });

    renderer.setLatticeScale(2.5);

    expect(target.tiling).toBeUndefined();
  });
});

describe("SurfaceComputeRenderer teardown", () => {
  it("defers device.destroy() until an in-flight frame unwinds", async () => {
    const { renderer, deviceDestroy, settleFrameWork } = createHarness();
    const frame = renderer.renderFrame(frameSpec());
    await flushMicrotasks();

    renderer.destroy();
    expect(deviceDestroy).toHaveBeenCalledTimes(0);

    settleFrameWork();
    await frame;
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("tears the device down synchronously when no frame is in flight", () => {
    const { renderer, deviceDestroy } = createHarness();
    renderer.destroy();
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the device exactly once when destroy() is called twice during the deferred window", async () => {
    const { renderer, deviceDestroy, settleFrameWork } = createHarness();
    const frame = renderer.renderFrame(frameSpec());
    await flushMicrotasks();

    renderer.destroy();
    renderer.destroy(); // second call while still deferred: must not re-commit the teardown.
    expect(deviceDestroy).toHaveBeenCalledTimes(0);

    settleFrameWork();
    await frame;
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("waits for the LAST of two in-flight frames, not the first", async () => {
    // A frame is counted from its renderFrame CALL, not from when the chain
    // lets it run — so the second one here is in flight (queued behind the
    // first) without ever having touched the device, and destroy() owes it
    // the same wait. Both then unwind: the first at its post-allocation token
    // check, the second at its first, since destroy() moved the token.
    const { renderer, deviceDestroy, settleFrameWork } = createHarness();
    // Read at the moment the first frame has fully unwound (its release runs
    // before its promise resolves) with the second still counted — the one
    // instant that tells "waits for the last" apart from "waits for one".
    let destroysWhenFirstUnwound = -1;
    const first = renderer.renderFrame(frameSpec()).then((frame) => {
      destroysWhenFirstUnwound = deviceDestroy.mock.calls.length;
      return frame;
    });
    // Only once the first is PARKED, or it would resolve null at its opening
    // token check (the second call supersedes it) and never be in flight at
    // the same time — a latest-wins request during a live frame is what
    // actually puts two of them in the count.
    await flushMicrotasks();
    const second = renderer.renderFrame(frameSpec());

    renderer.destroy();
    expect(deviceDestroy).toHaveBeenCalledTimes(0);

    settleFrameWork();
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    expect(destroysWhenFirstUnwound).toBe(0);
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("never destroys the device a second time when a frame starts after the teardown", async () => {
    const { renderer, deviceDestroy } = createHarness();
    renderer.destroy(); // idle, so the device is already gone.
    expect(deviceDestroy).toHaveBeenCalledTimes(1);

    // The OTHER path into the real teardown: this frame is counted, resolves
    // null at its first token check (destroy() bumped the token) and then
    // releases — arriving at the teardown with `destroyed` already true, which
    // is exactly what the separate `deviceDestroyed` flag is there to catch.
    expect(await renderer.renderFrame(frameSpec())).toBeNull();
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("never destroys a frame's buffers directly, leaving them to the device", async () => {
    // Freeing a staging buffer out from under a pending map is its own
    // crash vector — the reason the teardown hands everything to
    // `device.destroy()` rather than walking the buffers first
    // (flame-gpu-backend's own finding, one module over).
    const { renderer, bufferDestroys, settleFrameWork } = createHarness();
    const frame = renderer.renderFrame(frameSpec());
    await flushMicrotasks();
    expect(bufferDestroys.length).toBeGreaterThan(0); // the frame really allocated.

    renderer.destroy();
    settleFrameWork();
    await frame;

    bufferDestroys.forEach((destroy) =>
      expect(destroy).toHaveBeenCalledTimes(0),
    );
  });

  it("does not report a device loss that its own destroy() caused", async () => {
    // A real device resolves `lost` when it is destroyed, and onLost is the
    // session's cue to re-enter through the WebGL tracer — firing it on a
    // deliberate exit would toast the user and restart a mode they just left.
    const { renderer, loseDevice } = createHarness();
    const onLost = vi.fn();
    renderer.onLost = onLost;

    renderer.destroy();
    loseDevice();
    await flushMicrotasks();

    expect(onLost).not.toHaveBeenCalled();
    // The handler DID run — otherwise the assertion above passes vacuously.
    expect(renderer.lost).toBe(true);
  });
});

describe("SurfaceComputeRenderer device loss", () => {
  it("reports a loss that arrives after the callback is registered", async () => {
    const { renderer, loseDevice } = createHarness();
    const onLost = vi.fn();
    renderer.onLost = onLost;

    loseDevice();
    await flushMicrotasks();

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(renderer.lost).toBe(true);
  });

  it("reports a loss that PRECEDED the callback's registration", async () => {
    // `create()` spends seconds in pipeline compiles, which is exactly when a
    // flaky driver dies — so `device.lost` can already be resolved by the time
    // main.ts gets the renderer back and assigns onLost. The loss is the
    // session's only cue to fall back to WebGL; dropping it leaves a renderer
    // whose every frame resolves null behind a permanently blank pane.
    const { renderer } = createHarness({ lostBeforeConstruction: true });
    await flushMicrotasks(); // the constructor's handler runs with no callback.
    expect(renderer.lost).toBe(true);

    const onLost = vi.fn();
    renderer.onLost = onLost;
    await flushMicrotasks();

    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("does not re-report a delivered loss to a second callback", async () => {
    // One loss is one fallback. A later assignment must not toast the user and
    // re-enter the mode again over the same dead device.
    const { renderer } = createHarness({ lostBeforeConstruction: true });
    await flushMicrotasks(); // deliver through the SETTER, as the test above.
    const first = vi.fn();
    renderer.onLost = first;
    await flushMicrotasks();
    expect(first).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    renderer.onLost = second;
    await flushMicrotasks();

    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
  });
});

/** Configured GPU outcomes through the real frame scheduler. No shader math
 * is simulated: every primary ray misses and each readback supplies a known
 * linear sample. Uniform writes, dispatch widths and cancellation are real
 * host code. */
/** Float offsets into the packed shade buffer: the 240-byte legacy+pattern
 * prefix is 60 floats, then the nine lighting lanes. */
const SHADE_LIGHTING_FLOAT = 60;
const SHADE_SAMPLE_INDEX_FLOAT = SHADE_LIGHTING_FLOAT + 8 * 4 + 2;

function lightingDispatchHarness(parkShade: boolean | number = false) {
  const parked = deferred();
  const dispatches: { rays: number; groups: number }[] = [];
  const shadeWrites: Float32Array[] = [];
  const fences: number[] = [];
  const deviceDestroy = vi.fn();
  const paramsBuf = {} as GPUBuffer;
  const shadeBuf = {} as GPUBuffer;
  const marchPipeline = {} as GPUComputePipeline;
  const shadePipeline = {} as GPUComputePipeline;
  let itemCount = 0;
  let sampleIndex = 0;
  let lastWasShade = false;
  const device = {
    lost: new Promise<GPUDeviceLostInfo>(() => {}),
    limits: {
      maxBufferSize: 1 << 28,
      maxStorageBufferBindingSize: 1 << 28,
      maxComputeWorkgroupsPerDimension: 65535,
      maxTextureDimension2D: 8192,
    },
    pushErrorScope: () => {},
    popErrorScope: async () => null,
    createBuffer: () => ({ destroy: vi.fn() }),
    createBindGroup: () => ({}),
    queue: {
      writeTexture: () => {},
      writeBuffer: (
        buffer: GPUBuffer,
        offset: number,
        data: ArrayBuffer | ArrayBufferView,
      ) => {
        const bytes = ArrayBuffer.isView(data)
          ? data.buffer.slice(
              data.byteOffset,
              data.byteOffset + data.byteLength,
            )
          : data;
        if (buffer === paramsBuf)
          itemCount = new DataView(bytes).getUint32(56, true);
        if (buffer === shadeBuf) {
          const floats = new Float32Array(bytes);
          shadeWrites.push(floats.slice());
          sampleIndex = floats[SHADE_SAMPLE_INDEX_FLOAT];
        }
      },
      submit: () => {},
      onSubmittedWorkDone: () => {
        fences.push(dispatches.length);
        const shouldPark =
          typeof parkShade === "number"
            ? dispatches.length >= parkShade
            : parkShade;
        return shouldPark && lastWasShade ? parked.promise : Promise.resolve();
      },
    },
    createCommandEncoder: () => ({
      beginComputePass: () => {
        let selected: GPUComputePipeline;
        return {
          setPipeline: (pipeline: GPUComputePipeline) => {
            selected = pipeline;
          },
          setBindGroup: () => {},
          dispatchWorkgroups: (groups: number) => {
            lastWasShade = selected === shadePipeline;
            if (lastWasShade) dispatches.push({ rays: itemCount, groups });
          },
          end: () => {},
        };
      },
      copyBufferToBuffer: () => {},
      finish: () => ({}),
    }),
    destroy: deviceDestroy,
  } as unknown as GPUDevice;
  const de = buildSurfaceDE(defaultTransforms(), null, {
    order: 1,
    plane: "xz",
  });
  const renderer = new SurfaceComputeRenderer({
    device,
    target: { kind: "ifs", de },
    marchPipeline,
    shadePipeline,
    marchLayout: {} as GPUBindGroupLayout,
    shadeLayout: {} as GPUBindGroupLayout,
    marchPipelineNoSlab: null,
    shadePipelineNoSlab: null,
    transportPipeline: null,
    transportPipelineNoSlab: null,
    opticsMapsBuf: null,
    seedPipeline: {} as GPUComputePipeline,
    seedLayout: {} as GPUBindGroupLayout,
    seedBuf: {} as GPUBuffer,
    paramsBuf,
    shadeBuf,
    mapsBuf: {} as GPUBuffer,
    shadeMapsBuf: {} as GPUBuffer,
    lutTex: { createView: () => ({}) } as unknown as GPUTexture,
    lightingBackgroundTex: { createView: () => ({}) } as unknown as GPUTexture,
    lutSamp: {} as GPUSampler,
    software: false,
    lighting: true,
  });
  Reflect.set(
    renderer,
    "drainStaging",
    async (_buffer: GPUBuffer, bytes: number) =>
      new Uint32Array(bytes / 4).fill(SURFACE_GPU_RAY_MISS).buffer,
  );
  Reflect.set(
    renderer,
    "readbackFrame",
    async (
      _color: GPUBuffer,
      _staging: GPUBuffer,
      _layer: GPUBuffer,
      _layerStaging: GPUBuffer,
      layerBytes: number,
      colorBytes: number,
    ) => {
      expect(colorBytes).toBe(layerBytes * 4);
      const hdr = new Float32Array(colorBytes / 4);
      for (let p = 0; p < hdr.length; p += 4) {
        hdr[p] = sampleIndex === 0 ? 1.6 : 0;
        hdr[p + 3] = 2 + 65536;
      }
      // Every ray reads back uncovered: coverage 0, fog 0, beta 255, far
      // CoC 255 — the seed's own layer bytes.
      const layer = new Uint8Array(layerBytes);
      for (let p = 0; p < layer.length; p += 4) {
        layer[p + 2] = 255;
        layer[p + 3] = 255;
      }
      return [hdr.buffer, layer.buffer];
    },
  );
  const spec = frameSpec();
  spec.lighting = cloneSurfaceLighting(DEFAULT_SURFACE_LIGHTING);
  spec.lightingRuntime = surfaceLightingRuntime({
    dimension: 3,
    boundingRadius: 2,
  });
  return {
    renderer,
    spec,
    dispatches,
    shadeWrites,
    fences,
    deviceDestroy,
    resume: parked.resolve,
  };
}

describe("SurfaceComputeRenderer authored lighting", () => {
  it.each([1, 2])(
    "observes each raw completed sample before a %i-sample mean",
    async (samples) => {
      const { renderer, spec } = lightingDispatchHarness();
      const observed: { index: number; red: number; missed: number }[] = [];
      const frame = await renderer.renderFrame(spec, {
        samples,
        onSample: (sample, index) =>
          observed.push({
            index,
            red: sample.pixels[0],
            missed: sample.counts.miss,
          }),
      });
      expect(frame).not.toBeNull();
      expect(observed.map((sample) => sample.index)).toEqual(
        samples === 1 ? [0] : [0, 1],
      );
      expect(observed[0].red).toBe(255);
      if (samples === 2) expect(observed[1].red).toBe(0);
      expect(
        observed.every((sample) => sample.missed === spec.width * spec.height),
      ).toBe(true);
      renderer.destroy();
    },
  );

  it("does not certify a truncated sample through the completion observer", async () => {
    const { renderer, spec } = lightingDispatchHarness();
    const onSample = vi.fn();
    const frame = await renderer.renderFrame(spec, { budgetMs: -1, onSample });
    expect(frame?.truncated).toBe(true);
    expect(onSample).not.toHaveBeenCalled();
    renderer.destroy();
  });

  it("allocates the opt-in HDR ABI and background binding without moving mesh binding 11", async () => {
    const plain = await createPaletteResourceHarness(false);
    const lit = await createPaletteResourceHarness(false, undefined, true);
    expect(plain.bufferDescriptors[1].size).toBe(224);
    expect(lit.bufferDescriptors[1].size).toBe(
      SURFACE_GPU_SHADE_LIGHTING_BYTES,
    );
    expect(
      Array.from(lit.layoutDescriptors[0].entries).some(
        (entry) => entry.binding === 12,
      ),
    ).toBe(false);
    expect(
      Array.from(lit.layoutDescriptors[1].entries).some(
        (entry) => entry.binding === 12,
      ),
    ).toBe(true);
    for (const [harness, bytes] of [
      [plain, SURFACE_COMPUTE_RAY_BYTES],
      [lit, SURFACE_COMPUTE_LIGHTING_RAY_BYTES],
    ] as const) {
      const before = harness.bufferDescriptors.length;
      (
        Reflect.get(harness.renderer, "ensureFrameBuffers") as (
          rays: number,
        ) => unknown
      ).call(harness.renderer, 3);
      expect(
        harness.bufferDescriptors
          .slice(before)
          .reduce((sum, descriptor) => sum + descriptor.size, 0),
      ).toBe(bytes * 3);
    }
  });

  it("averages HDR before clipping and widens the lit dispatch as it learns", async () => {
    const { renderer, spec, dispatches, shadeWrites, fences } =
      lightingDispatchHarness();
    spec.width = 128;
    spec.height = 1;
    const pending = renderer.renderFrame(spec, { samples: 2 });
    // The spec's nested rig must not follow a later UI edit mid-frame.
    spec.lighting!.lights[0].position[0] = 999;
    const frame = await pending;
    expect(frame).not.toBeNull();
    expect(frame!.pixels[0]).toBe(Math.round(255 * Math.pow(0.8, 1 / 2.2)));
    expect(frame!.pixels[3]).toBe(255);
    expect(frame!.lightingVisibility).toEqual({ exhausted: 512, invalid: 256 });
    expect(shadeWrites.map((write) => write[SHADE_SAMPLE_INDEX_FLOAT])).toEqual(
      [0, 1],
    );
    expect(shadeWrites[0][SHADE_LIGHTING_FLOAT]).toBe(
      DEFAULT_SURFACE_LIGHTING.lights[0].position[0],
    );
    // Lane 8's first word: one surface sample per pass, whatever the rig.
    expect(shadeWrites[0][SHADE_LIGHTING_FLOAT + 8 * 4]).toBe(1);
    // Every ray here MISSES, and a miss is free work under any rig: the
    // whole raster drains in one dispatch per pass, which is what the
    // participating medium used to make impossible (its rays paid
    // visibility marches whether or not the primary ray hit anything).
    expect(dispatches).toEqual([
      { rays: 128, groups: 2 },
      { rays: 128, groups: 2 },
    ]);
    expect(fences.length).toBeGreaterThan(0);
  });

  it("defers destruction while a lit dispatch is parked on submitted work", async () => {
    const { renderer, spec, dispatches, deviceDestroy, resume } =
      lightingDispatchHarness(true);
    const onSample = vi.fn();
    const frame = renderer.renderFrame(spec, { onSample });
    await flushMicrotasks();
    expect(dispatches).toHaveLength(1);
    renderer.destroy();
    expect(deviceDestroy).not.toHaveBeenCalled();
    resume();
    expect(await frame).toBeNull();
    expect(onSample).not.toHaveBeenCalled();
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("presents linear radiance at opaque alpha whatever its diagnostic lane holds", () => {
    // The w lane is the packed visibility diagnostic, not display alpha.
    const linear = new Float32Array([0, 0, 1, 0, 1, 0, 0, 3 + 2 * 65536]);
    expect(
      encodeSurfaceComputeHdr(linear).filter(
        (_value, index) => index % 4 === 3,
      ),
    ).toEqual(new Uint8Array(2).fill(255));
  });

  it("unpacks exhausted and invalid visibility counts from the diagnostic lane", () => {
    expect(
      surfaceComputeLightingVisibility(
        new Float32Array([0, 0, 0, 3 + 2 * 65536, 0, 0, 0, 7]),
      ),
    ).toEqual({ exhausted: 10, invalid: 2 });
  });
});

/** A small glass-shaped sphere-inversion subject for the host-loop fakes:
 * the loop never reads its geometry, only its target kind. */
function continuationSphereInversionDE() {
  const r = resolveSphereInversion({
    arrangement: "oct6",
    seed: { kind: "ball", size: 0.28 },
    depth: 2,
  });
  if (!r.ok) throw new Error(r.reasons.join("; "));
  return buildSphereInversionDE(r.construction);
}

interface FiniteHostDispatch {
  submission: number;
  initialize: number;
  counterBefore: number;
  /** The header's per-submission scheduling quantum. */
  quantum: number;
  generation: number;
  rayIds: number[];
  replayPass: number;
  statusBefore: number[];
}

/** Exercise the actual host loop, copies and readbacks over byte-backed GPU
 * buffers. Writes and submitted commands remain queued until a fence or map
 * completes. The simulated kernel supplies only completion outcomes; it does
 * not reproduce optical arithmetic or the continuation implementation. */
function finiteContinuationHarness(
  opts: {
    kind?: "finite" | "finite4" | "sphereInversion";
    chunkPaths?: number;
    /** The sphere-inversion lane's quantum ladder (init field). */
    adaptiveSchedule?: boolean;
    maxPaths?: number;
    parkLabel?: string;
    outcome?: (dispatch: FiniteHostDispatch) => {
      running: number;
      statuses: (number | null)[];
    };
  } = {},
) {
  interface BufferMemory {
    data: ArrayBuffer;
    descriptor: GPUBufferDescriptor;
    destroy: ReturnType<typeof vi.fn>;
  }
  const memory = new Map<GPUBuffer, BufferMemory>();
  const bindGroups = new Map<GPUBindGroup, Map<number, GPUBuffer>>();
  const dispatches: FiniteHostDispatch[] = [];
  const copies: {
    submission: number;
    src: GPUBuffer;
    dst: GPUBuffer;
    srcOffset: number;
    bytes: number;
  }[] = [];
  const maps: string[] = [];
  const completions: {
    kind: "map" | "fence";
    label?: string;
    transportDispatches: number;
  }[] = [];
  const queued: { submission: number; operation: () => void }[] = [];
  const parked = deferred();
  let didPark = false;
  let submission = 0;
  let executingSubmission = 0;
  const completeQueue = (kind: "map" | "fence", label?: string) => {
    const before = dispatches.length;
    for (const command of queued.splice(0)) {
      executingSubmission = command.submission;
      command.operation();
    }
    completions.push({
      kind,
      label,
      transportDispatches: dispatches.length - before,
    });
  };
  const createBuffer = (descriptor: GPUBufferDescriptor): GPUBuffer => {
    const item: BufferMemory = {
      data: new ArrayBuffer(Number(descriptor.size)),
      descriptor,
      destroy: vi.fn(),
    };
    let mapped = false;
    const buffer = {
      size: Number(descriptor.size),
      destroy: item.destroy,
      mapAsync: async () => {
        const label = descriptor.label ?? "";
        maps.push(label);
        if (!didPark && opts.parkLabel === label) {
          didPark = true;
          await parked.promise;
        }
        await Promise.resolve();
        completeQueue("map", label);
        mapped = true;
      },
      getMappedRange: (offset = 0, size = item.data.byteLength - offset) => {
        expect(mapped).toBe(true);
        return item.data.slice(offset, offset + size);
      },
      unmap: () => {
        mapped = false;
      },
    } as unknown as GPUBuffer;
    memory.set(buffer, item);
    return buffer;
  };
  const words = (buffer: GPUBuffer) =>
    new Uint32Array(memory.get(buffer)!.data);
  const plain = (size = 512) =>
    createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  const paramsBuf = plain();
  const shadeBuf = plain();
  const mapsBuf = plain();
  const pipelines = {
    seed: {} as GPUComputePipeline,
    march: {} as GPUComputePipeline,
    shade: {} as GPUComputePipeline,
    transport: {} as GPUComputePipeline,
  };
  const deviceDestroy = vi.fn();
  const device = {
    lost: new Promise<GPUDeviceLostInfo>(() => {}),
    limits: {
      maxBufferSize: 1 << 28,
      maxStorageBufferBindingSize: 1 << 28,
      maxComputeWorkgroupsPerDimension: 65535,
    },
    pushErrorScope: () => {},
    popErrorScope: async () => null,
    createBuffer,
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
      const group = {} as GPUBindGroup;
      const bindings = new Map<number, GPUBuffer>();
      for (const entry of descriptor.entries) {
        if ("buffer" in entry.resource)
          bindings.set(entry.binding, entry.resource.buffer);
      }
      bindGroups.set(group, bindings);
      return group;
    },
    queue: {
      writeTexture: () => {},
      writeBuffer: (
        buffer: GPUBuffer,
        offset: number,
        data: ArrayBuffer | ArrayBufferView,
      ) => {
        const view = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
        const bytes = view.slice();
        queued.push({
          submission: 0,
          operation: () => {
            new Uint8Array(memory.get(buffer)!.data).set(bytes, offset);
          },
        });
      },
      submit: (commands: { operations: (() => void)[] }[]) => {
        submission++;
        for (const command of commands)
          for (const operation of command.operations)
            queued.push({ submission, operation });
      },
      onSubmittedWorkDone: async () => {
        await Promise.resolve();
        completeQueue("fence");
      },
    },
    createCommandEncoder: () => {
      const operations: (() => void)[] = [];
      return {
        beginComputePass: () => {
          let pipeline: GPUComputePipeline;
          let group: GPUBindGroup;
          return {
            setPipeline: (value: GPUComputePipeline) => {
              pipeline = value;
            },
            setBindGroup: (_index: number, value: GPUBindGroup) => {
              group = value;
            },
            dispatchWorkgroups: (count: number) => {
              operations.push(() => {
                if (count === 0) return;
                const bindings = bindGroups.get(group)!;
                const length = words(paramsBuf)[14]; // shared Params.itemCount
                if (pipeline === pipelines.march) {
                  words(bindings.get(5)!).fill(SURFACE_GPU_RAY_HIT, 0, length);
                } else if (pipeline === pipelines.transport) {
                  // The sphere-inversion continuation rides binding 16; an
                  // unchunked session has none (binding 1 is its table).
                  const work =
                    opts.kind === "sphereInversion"
                      ? (bindings.get(16) ?? mapsBuf)
                      : bindings.get(1)!;
                  const header = work === mapsBuf ? [1, 0, 0] : words(work);
                  const status = words(bindings.get(15)!);
                  const rayIds = Array.from(
                    words(bindings.get(2)!).slice(0, length),
                  );
                  const dispatch: FiniteHostDispatch = {
                    submission: executingSubmission,
                    initialize: header[0],
                    counterBefore: header[1],
                    quantum: header[4] ?? 0,
                    generation: header[2],
                    rayIds,
                    replayPass: new Float32Array(
                      memory.get(shadeBuf)!.data,
                    )[56],
                    statusBefore: Array.from(status.slice(0, length)),
                  };
                  dispatches.push(dispatch);
                  const outcome = opts.outcome?.(dispatch) ?? {
                    running:
                      work !== mapsBuf && dispatch.initialize === 1 ? 1 : 0,
                    statuses: rayIds.map((_, i) =>
                      work !== mapsBuf && dispatch.initialize === 1 && i === 0
                        ? FINITE_TRANSPORT_RUNNING
                        : SURFACE_GPU_TRANSPORT_COMPLETE,
                    ),
                  };
                  outcome.statuses.forEach((value, i) => {
                    if (value !== null) status[i] = value;
                  });
                  if (work !== mapsBuf) words(work)[1] = outcome.running;
                  // Non-round f32 bits ensure the diagnostic path is a raw
                  // GPU copy rather than reconstructed display pixels.
                  const records = words(bindings.get(14)!);
                  for (const ray of rayIds) records[ray * 8] = 0x3f800001 + ray;
                }
              });
            },
            end: () => {},
          };
        },
        copyBufferToBuffer: (
          src: GPUBuffer,
          srcOffset: number,
          dst: GPUBuffer,
          dstOffset: number,
          bytes: number,
        ) => {
          operations.push(() => {
            expect(
              memory.get(src)!.descriptor.usage & GPUBufferUsage.COPY_SRC,
            ).not.toBe(0);
            new Uint8Array(memory.get(dst)!.data, dstOffset, bytes).set(
              new Uint8Array(memory.get(src)!.data, srcOffset, bytes),
            );
            copies.push({
              submission: executingSubmission,
              src,
              dst,
              srcOffset,
              bytes,
            });
          });
        },
        finish: () => ({ operations }),
      };
    },
    destroy: deviceDestroy,
  } as unknown as GPUDevice;
  const renderer = new SurfaceComputeRenderer({
    device,
    target:
      opts.kind === "sphereInversion"
        ? { kind: "sphereInversion", de: continuationSphereInversionDE() }
        : { kind: opts.kind ?? "finite", level: 2 },
    marchPipeline: pipelines.march,
    shadePipeline: pipelines.shade,
    marchLayout: {} as GPUBindGroupLayout,
    shadeLayout: {} as GPUBindGroupLayout,
    marchPipelineNoSlab: null,
    shadePipelineNoSlab: null,
    transportPipeline: pipelines.transport,
    transportPipelineNoSlab: null,
    finiteTransportChunkPaths: opts.chunkPaths,
    sphereInversionTransportChunkPaths: opts.chunkPaths,
    sphereInversionAdaptiveSchedule: opts.adaptiveSchedule,
    transportMaxPaths: opts.maxPaths,
    opticsMapsBuf: plain(),
    seedPipeline: pipelines.seed,
    seedLayout: {} as GPUBindGroupLayout,
    seedBuf: plain(),
    paramsBuf,
    shadeBuf,
    mapsBuf,
    shadeMapsBuf: plain(),
    lutTex: { createView: () => ({}) } as unknown as GPUTexture,
    lutSamp: {} as GPUSampler,
    software: false,
  });
  const spec = frameSpec();
  spec.width = 3;
  spec.height = 1;
  if (opts.kind === "finite4")
    spec.view4 = {
      rotor: rotorMatrix(identityRotorPair()),
      w0: 0.18,
      sliceHalfW: 0,
    };
  return {
    renderer,
    spec,
    memory,
    maps,
    completions,
    copies,
    dispatches,
    deviceDestroy,
    resume: parked.resolve,
  };
}

describe("SurfaceComputeRenderer finite continuation", () => {
  it.each(["finite", "finite4"] as const)(
    "forwards the %s crossing-cache diagnostic to primary and transport kernels",
    async (kind) => {
      const dim = kind === "finite" ? 3 : 4;
      const cached = finiteSolidTransportSource(dim);
      const uncached = finiteSolidTransportSource(dim, false);
      expect(cached).not.toBe(uncached);
      for (const cacheCrossings of [undefined, true, false]) {
        const h = await createPaletteResourceHarness(
          false,
          { kind, level: 2 },
          false,
          [],
          {},
          cacheCrossings,
        );
        expect(h.shaderSources).toHaveLength(2);
        for (const source of h.shaderSources)
          expect(source).toContain(
            cacheCrossings === false ? uncached : cached,
          );
        h.renderer.destroy();
      }
    },
  );

  it("leaves nonfinite kernels unchanged when the finite crossing-cache diagnostic is supplied", async () => {
    const defaults = await createPaletteResourceHarness(false);
    const diagnostic = await createPaletteResourceHarness(
      false,
      undefined,
      false,
      [],
      undefined,
      false,
    );
    expect(diagnostic.shaderSources).toEqual(defaults.shaderSources);
    defaults.renderer.destroy();
    diagnostic.renderer.destroy();
  });

  it.each(["finite", "finite4"] as const)(
    "builds %s continuation with the existing nine storage bindings and retains the uninterrupted control",
    async (kind) => {
      for (const chunkPaths of [undefined, 0]) {
        const h = await createPaletteResourceHarness(
          false,
          { kind, level: 2 },
          false,
          [],
          { chunkPaths, maxPaths: 2 },
        );
        const shadeLayout = Array.from(h.layoutDescriptors[1].entries);
        expect(
          shadeLayout.filter((e) => e.buffer && e.buffer.type !== "uniform"),
        ).toHaveLength(9);
        expect(shadeLayout.find((e) => e.binding === 1)?.buffer?.type).toBe(
          chunkPaths === 0 ? "read-only-storage" : "storage",
        );
        expect(
          Array.from(h.layoutDescriptors[0].entries).find(
            (e) => e.binding === 1,
          )?.buffer?.type,
        ).toBe("read-only-storage");
        const allocate = Reflect.get(h.renderer, "allocateFrameBuffers") as (
          rays: number,
        ) => Promise<unknown>;
        await allocate.call(h.renderer, 17);
        const work = h.bufferDescriptors.filter(
          (b) => b.label === "finite-transport-work",
        );
        expect(work).toHaveLength(chunkPaths === 0 ? 0 : 1);
        if (work.length)
          expect(work[0].size).toBe(finiteTransportWorkBytes(17));
        const march = Array.from(h.bindGroups[0].entries).find(
          (e) => e.binding === 1,
        )?.resource;
        const shade = Array.from(h.bindGroups[1].entries).find(
          (e) => e.binding === 1,
        )?.resource;
        if (chunkPaths === 0) expect(shade).toEqual(march);
        else expect(shade).not.toEqual(march);
        h.renderer.destroy();
      }
    },
  );

  it.each(["finite", "finite4"] as const)(
    "holds %s slot identity and theta until every paused trace finishes",
    async (kind) => {
      const h = finiteContinuationHarness({
        kind,
        outcome: (d) => {
          if (d.initialize === 1)
            return {
              running: 1,
              statuses: d.rayIds.map((_, i) =>
                i === 0
                  ? FINITE_TRANSPORT_RUNNING
                  : SURFACE_GPU_TRANSPORT_COMPLETE,
              ),
            };
          return {
            running: 0,
            statuses: d.rayIds.map((_, i) =>
              i === 0
                ? d.replayPass === 0
                  ? SURFACE_GPU_TRANSPORT_PENDING
                  : SURFACE_GPU_TRANSPORT_COMPLETE
                : null,
            ),
          };
        },
      });
      const frame = await h.renderer.renderFrame(h.spec, {
        transportReadback: true,
      });
      expect(frame?.transport).toMatchObject({
        passes: 2,
        resolved: 3,
        unresolved: 0,
        invalid: 0,
        continuationChunks: 2,
      });
      expect(frame?.transport?.batchMs).toHaveLength(4);
      expect(
        h.dispatches.map((d) => [
          d.initialize,
          d.generation,
          d.replayPass,
          d.rayIds,
        ]),
      ).toEqual([
        [1, 1, 0, [0, 1, 2]],
        [0, 1, 0, [0, 1, 2]],
        [1, 2, 1, [0]],
        [0, 2, 1, [0]],
      ]);
      expect(h.dispatches.every((d) => d.counterBefore === 0)).toBe(true);
      expect(h.dispatches[1].statusBefore).toEqual([
        FINITE_TRANSPORT_RUNNING,
        SURFACE_GPU_TRANSPORT_COMPLETE,
        SURFACE_GPU_TRANSPORT_COMPLETE,
      ]);
      expect(
        Array.from(frame!.transportState!).filter((_, i) => i % 8 === 0),
      ).toEqual([0x3f800001, 0x3f800002, 0x3f800003]);
      const counterCopies = h.copies.filter(
        (c) =>
          h.memory.get(c.dst)!.descriptor.label === "finite-transport-running",
      );
      expect(counterCopies).toHaveLength(4);
      expect(h.completions.filter((c) => c.transportDispatches > 0)).toEqual(
        Array.from({ length: 4 }, () => ({
          kind: "map",
          label: "finite-transport-running",
          transportDispatches: 1,
        })),
      );
      for (const counter of counterCopies) {
        expect(counter).toMatchObject({ srcOffset: 4, bytes: 4 });
        expect(
          h.copies.filter((c) => c.submission === counter.submission),
        ).toHaveLength(2);
      }
      const diagnostics = [...h.memory.values()].filter(
        (b) => b.descriptor.label === "transport diagnostic readback",
      );
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].destroy).toHaveBeenCalledOnce();
      h.renderer.destroy();
    },
  );

  it("waits for the finite counter map to finish GPU work and includes that wait in each chunk timing", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const h = finiteContinuationHarness({
      parkLabel: "finite-transport-running",
    });
    try {
      const pending = h.renderer.renderFrame(h.spec);
      await flushMicrotasks();
      expect(h.maps).toContain("finite-transport-running");
      // submit() only queued the kernel and copies. A redundant queue fence
      // would already have completed this work before the map was reached.
      expect(h.dispatches).toHaveLength(0);
      now = 37;
      h.resume();
      const frame = await pending;
      expect(frame?.transport?.resolved).toBe(3);
      expect(frame?.transport?.batchMs).toEqual([37, 0]);
      expect(h.dispatches).toHaveLength(2);
    } finally {
      h.resume();
      h.renderer.destroy();
      clock.mockRestore();
    }
  });

  it("reuses bounded batch scratch across AA samples and frames, while generations advance", async () => {
    const h = finiteContinuationHarness();
    h.spec.width = 5000;
    const observed: number[] = [];
    expect(
      await h.renderer.renderFrame(h.spec, {
        samples: 2,
        onSample: (frame) => observed.push(frame.transport!.resolved),
      }),
    ).not.toBeNull();
    const before = h.dispatches.at(-1)!.generation;
    const scratch = [...h.memory.values()].filter(
      (b) => b.descriptor.label === "finite-transport-work",
    );
    expect(scratch).toHaveLength(1);
    expect(scratch[0].descriptor.size).toBe(finiteTransportWorkBytes(4096));
    h.spec.width = 3;
    expect(await h.renderer.renderFrame(h.spec)).not.toBeNull();
    expect(h.dispatches.at(-1)!.generation).toBeGreaterThan(before);
    expect(
      [...h.memory.values()].filter(
        (b) => b.descriptor.label === "finite-transport-work",
      ),
    ).toHaveLength(1);
    expect(observed).toEqual([5000, 5000]);
    expect(h.maps).not.toContain("transport diagnostic readback");
    // Growth releases the old frame allocation; later device teardown
    // releases the currently retained allocation through WebGPU itself.
    h.spec.width = 6000;
    expect(await h.renderer.renderFrame(h.spec)).not.toBeNull();
    expect(scratch[0].destroy).toHaveBeenCalledOnce();
    h.renderer.destroy();
    expect(h.deviceDestroy).toHaveBeenCalledOnce();
  });

  it("keeps the zero-quantum control uninterrupted and allocates no continuation state", async () => {
    const h = finiteContinuationHarness({ chunkPaths: 0 });
    expect((await h.renderer.renderFrame(h.spec))?.transport).toMatchObject({
      resolved: 3,
      passes: 1,
    });
    expect(h.dispatches).toHaveLength(1);
    expect(h.completions.filter((c) => c.transportDispatches > 0)).toEqual([
      { kind: "fence", label: undefined, transportDispatches: 1 },
    ]);
    expect(
      [...h.memory.values()].some((b) =>
        b.descriptor.label?.startsWith("finite-transport-"),
      ),
    ).toBe(false);
    h.renderer.destroy();
  });

  it("cancels while a running-counter readback is pending and starts the next frame fresh", async () => {
    const h = finiteContinuationHarness({
      parkLabel: "finite-transport-running",
    });
    const pending = h.renderer.renderFrame(h.spec);
    await flushMicrotasks();
    expect(h.maps).toContain("finite-transport-running");
    h.renderer.cancel();
    h.resume();
    expect(await pending).toBeNull();
    expect(h.dispatches).toHaveLength(1);
    expect(await h.renderer.renderFrame(h.spec)).not.toBeNull();
    expect(h.dispatches[1]).toMatchObject({ initialize: 1, generation: 2 });
    h.renderer.destroy();
  });

  it("defers teardown and always destroys temporary diagnostic staging after cancellation", async () => {
    const h = finiteContinuationHarness({
      parkLabel: "transport diagnostic readback",
    });
    const pending = h.renderer.renderFrame(h.spec, { transportReadback: true });
    await flushMicrotasks();
    expect(h.maps).toContain("transport diagnostic readback");
    const staging = [...h.memory.values()].find(
      (b) => b.descriptor.label === "transport diagnostic readback",
    )!;
    h.renderer.destroy();
    expect(h.deviceDestroy).not.toHaveBeenCalled();
    expect(staging.destroy).not.toHaveBeenCalled();
    h.resume();
    expect(await pending).toBeNull();
    expect(staging.destroy).toHaveBeenCalledOnce();
    expect(h.deviceDestroy).toHaveBeenCalledOnce();
  });

  it.each([
    "excess running",
    "running escaped",
    "never drains",
    "unknown status",
  ])("refuses a malformed continuation: %s", async (failure) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = finiteContinuationHarness({
      maxPaths: 2,
      chunkPaths: 1,
      outcome: (d) => ({
        running:
          failure === "excess running"
            ? d.rayIds.length + 1
            : failure === "running escaped" || failure === "unknown status"
              ? 0
              : 1,
        statuses: d.rayIds.map(() =>
          failure === "unknown status" ? 255 : FINITE_TRANSPORT_RUNNING,
        ),
      }),
    });
    try {
      expect(await h.renderer.renderFrame(h.spec)).toBeNull();
      expect(errors).toHaveBeenCalledOnce();
      expect(h.dispatches.length).toBeLessThanOrEqual(3);
      expect(h.dispatches.every((d) => d.replayPass === 0)).toBe(true);
    } finally {
      h.renderer.destroy();
      errors.mockRestore();
    }
  });
});

/** The real unlit frame loop over a fake device that records every queue
 * write (target, size, bytes), the descriptor of every buffer the FRAME
 * allocates, and every dispatch. Every primary ray misses on its first
 * sweep and readbacks return zeroed bytes, so a frame runs seed, march,
 * shade and readback once. Session buffers are handed in directly, so
 * `descriptors` holds only the frame's own per-ray buffers. */
function frameStagingHarness() {
  const descriptors = new Map<GPUBuffer, GPUBufferDescriptor>();
  const writes: { buffer: GPUBuffer; bytes: number; data: ArrayBuffer }[] = [];
  const dispatches: { pipeline: GPUComputePipeline; x: number; y: number }[] =
    [];
  /** Every write, dispatch and fence in queue order. */
  const events: (
    | { kind: "write"; bytes: number }
    | { kind: "dispatch"; pipeline: GPUComputePipeline; x: number }
    | { kind: "fence" }
  )[] = [];
  const seedBuf = {} as GPUBuffer;
  const marchPipeline = {} as GPUComputePipeline;
  const shadePipeline = {} as GPUComputePipeline;
  const seedPipeline = {} as GPUComputePipeline;
  const device = {
    lost: new Promise<GPUDeviceLostInfo>(() => {}),
    limits: {
      maxBufferSize: 1 << 28,
      maxStorageBufferBindingSize: 1 << 28,
      maxComputeWorkgroupsPerDimension: 65535,
      maxTextureDimension2D: 8192,
    },
    pushErrorScope: () => {},
    popErrorScope: async () => null,
    createBuffer: (descriptor: GPUBufferDescriptor) => {
      const buffer = { destroy: vi.fn() } as unknown as GPUBuffer;
      descriptors.set(buffer, descriptor);
      return buffer;
    },
    createBindGroup: () => ({}),
    queue: {
      writeTexture: () => {},
      writeBuffer: (
        buffer: GPUBuffer,
        _offset: number,
        data: ArrayBuffer | ArrayBufferView,
      ) => {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(
              data.buffer,
              data.byteOffset,
              data.byteLength,
            ).slice().buffer
          : data.slice(0);
        writes.push({ buffer, bytes: bytes.byteLength, data: bytes });
        events.push({ kind: "write", bytes: bytes.byteLength });
      },
      submit: () => {},
      onSubmittedWorkDone: () => {
        events.push({ kind: "fence" });
        return Promise.resolve();
      },
    },
    createCommandEncoder: () => ({
      beginComputePass: () => {
        let selected = {} as GPUComputePipeline;
        return {
          setPipeline: (pipeline: GPUComputePipeline) => {
            selected = pipeline;
          },
          setBindGroup: () => {},
          dispatchWorkgroups: (x: number, y = 1) => {
            dispatches.push({ pipeline: selected, x, y });
            events.push({ kind: "dispatch", pipeline: selected, x });
          },
          end: () => {},
        };
      },
      copyBufferToBuffer: () => {},
      finish: () => ({}),
    }),
    destroy: vi.fn(),
  } as unknown as GPUDevice;
  const de = buildSurfaceDE(defaultTransforms(), null, {
    order: 1,
    plane: "xz",
  });
  const renderer = new SurfaceComputeRenderer({
    device,
    target: { kind: "ifs", de },
    marchPipeline,
    shadePipeline,
    marchLayout: {} as GPUBindGroupLayout,
    shadeLayout: {} as GPUBindGroupLayout,
    marchPipelineNoSlab: null,
    shadePipelineNoSlab: null,
    transportPipeline: null,
    transportPipelineNoSlab: null,
    opticsMapsBuf: null,
    seedPipeline,
    seedLayout: {} as GPUBindGroupLayout,
    seedBuf,
    paramsBuf: {} as GPUBuffer,
    shadeBuf: {} as GPUBuffer,
    mapsBuf: {} as GPUBuffer,
    shadeMapsBuf: {} as GPUBuffer,
    lutTex: { createView: () => ({}) } as unknown as GPUTexture,
    lutSamp: {} as GPUSampler,
    software: false,
  });
  Reflect.set(
    renderer,
    "drainStaging",
    async (_buffer: GPUBuffer, bytes: number) =>
      new Uint32Array(bytes / 4).fill(SURFACE_GPU_RAY_MISS).buffer,
  );
  Reflect.set(
    renderer,
    "readbackFrame",
    async (
      _color: GPUBuffer,
      _staging: GPUBuffer,
      _layer: GPUBuffer,
      _layerStaging: GPUBuffer,
      layerBytes: number,
      colorBytes: number,
    ) => [new ArrayBuffer(colorBytes), new ArrayBuffer(layerBytes)],
  );
  return {
    renderer,
    descriptors,
    writes,
    dispatches,
    events,
    seedBuf,
    seedPipeline,
    marchPipeline,
  };
}

describe("SurfaceComputeRenderer frame seed", () => {
  it("stages no colour, layer or ray-state upload: the frame's only raster-sized write target is its active ray list", async () => {
    const { renderer, descriptors, writes } = frameStagingHarness();
    const spec = frameSpec();
    spec.width = 64;
    spec.height = 32;

    expect(await renderer.renderFrame(spec)).not.toBeNull();

    const rays = spec.width * spec.height;
    const frameTargets = new Set(
      writes.map((write) => write.buffer).filter((b) => descriptors.has(b)),
    );
    expect(frameTargets.size).toBe(1);
    const [onlyTarget] = frameTargets;
    expect(descriptors.get(onlyTarget)).toEqual({
      size: rays * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  });

  it("stages no larger a write outside the ray lists at 256x128 than at 16x8", async () => {
    const largestSessionWrite = async (width: number, height: number) => {
      const { renderer, descriptors, writes } = frameStagingHarness();
      const spec = frameSpec();
      spec.width = width;
      spec.height = height;
      expect(await renderer.renderFrame(spec)).not.toBeNull();
      return Math.max(
        ...writes
          .filter((write) => !descriptors.has(write.buffer))
          .map((write) => write.bytes),
      );
    };

    expect(await largestSessionWrite(256, 128)).toBe(
      await largestSessionWrite(16, 8),
    );
  });

  it("seeds the whole raster with one device dispatch before the first march", async () => {
    const {
      renderer,
      writes,
      dispatches,
      seedBuf,
      seedPipeline,
      marchPipeline,
    } = frameStagingHarness();
    const spec = frameSpec();
    spec.width = 100;
    spec.height = 40;

    expect(await renderer.renderFrame(spec)).not.toBeNull();

    const seedAt = dispatches.findIndex((d) => d.pipeline === seedPipeline);
    const marchAt = dispatches.findIndex((d) => d.pipeline === marchPipeline);
    expect(
      dispatches
        .filter((d) => d.pipeline === seedPipeline)
        .map(({ x, y }) => [x, y]),
    ).toEqual([[7, 3]]);
    expect(seedAt).toBeLessThan(marchAt);
    expect(
      writes
        .filter((write) => write.buffer === seedBuf)
        .map((write) => Array.from(new Uint32Array(write.data))),
    ).toEqual([[100, 40, 0, 0]]);
  });
});

describe("surfaceComputeFenceGroupSize", () => {
  it("fences one dispatch at a time until the lane has been measured", () => {
    // THE PILOT: no group is built on a cost this frame has not measured.
    expect(surfaceComputeFenceGroupSize(null)).toBe(1);
  });

  it("sizes the group from twice the lane's worst measured dispatch", () => {
    // 300 ms of group budget against 2 x 25 ms of measured work is six
    // dispatches, which the measured browser ceiling then cuts to its own
    // — so the formula is checked past that cap, where it still speaks.
    expect(surfaceComputeFenceGroupSize(25, Infinity, 16)).toBe(6);
    expect(surfaceComputeFenceGroupSize(25)).toBe(
      SURFACE_COMPUTE_FENCE_GROUP_MAX,
    );
  });

  it("gives an expensive lane a group of one", () => {
    // A dispatch already worth its own round-trip closes its own group,
    // which is what keeps the grouping off the frames that never needed
    // it.
    expect(surfaceComputeFenceGroupSize(250)).toBe(1);
  });

  it("caps a nearly free lane at the dispatch count", () => {
    // The bound that actually binds on a frame of queue-limited slivers,
    // where the measured work per dispatch is almost nothing.
    expect(surfaceComputeFenceGroupSize(0)).toBe(
      SURFACE_COMPUTE_FENCE_GROUP_MAX,
    );
    expect(surfaceComputeFenceGroupSize(0.001)).toBe(
      SURFACE_COMPUTE_FENCE_GROUP_MAX,
    );
  });

  it("never queues past what the caller has left to spend", () => {
    // The time before the next progressive present falls due, or before
    // the frame budget cuts — the screen has to keep developing and a
    // budget cut has to be able to land.
    expect(surfaceComputeFenceGroupSize(10, 60, 16)).toBe(3);
    expect(surfaceComputeFenceGroupSize(10, 0)).toBe(1);
    expect(surfaceComputeFenceGroupSize(10, -100)).toBe(1);
  });

  it("treats a nonsense measurement as unmeasured", () => {
    expect(surfaceComputeFenceGroupSize(Number.NaN)).toBe(1);
    expect(surfaceComputeFenceGroupSize(-5)).toBe(1);
  });

  it("honours a pinned ceiling, and 1 is the pre-grouping loop", () => {
    // `?surfacefencegroup=1` is the before arm of this feature's own A/B.
    expect(surfaceComputeFenceGroupSize(0, Infinity, 1)).toBe(1);
    expect(surfaceComputeFenceGroupSize(0, Infinity, 4)).toBe(4);
  });
});

describe("surfaceComputeFenceGroupAllowanceMs", () => {
  it("holds a fence interval to a quarter of the measured job deadline, which binds nothing today", () => {
    // The measured single-job ceiling is 2000 ms on this repository's AMD
    // RX 7900 XTX under Chrome, and the project's usual watchdog margin is
    // 4x, so an interval may stand behind 500 ms of work. The shipped work
    // target is 300, so the min picks the target and nothing this renderer
    // sizes moves — the no-op claim pinned rather than left in prose.
    expect(
      SURFACE_COMPUTE_JOB_WATCHDOG_MS / SURFACE_COMPUTE_JOB_WATCHDOG_MARGIN,
    ).toBe(500);
    expect(SURFACE_COMPUTE_FENCE_GROUP_MS).toBe(300);
    expect(surfaceComputeFenceGroupAllowanceMs()).toBe(
      SURFACE_COMPUTE_FENCE_GROUP_MS,
    );
    // 300 ms against 2 x 25 ms of measured work is still six dispatches,
    // exactly as it was before the bound existed.
    expect(surfaceComputeFenceGroupSize(25, Infinity, 16)).toBe(6);
  });

  it("clamps a raised work target at the driver's job deadline", () => {
    // The reason the bound is written down at all: a session tuning the
    // fence tax raises the work target on throughput grounds, where that
    // trade has no term for the watchdog in it. Tested through the
    // parameter rather than by mutating the module's constant.
    expect(surfaceComputeFenceGroupAllowanceMs(400)).toBe(400);
    expect(surfaceComputeFenceGroupAllowanceMs(500)).toBe(500);
    expect(surfaceComputeFenceGroupAllowanceMs(1200)).toBe(500);
    expect(
      surfaceComputeFenceGroupAllowanceMs(SURFACE_COMPUTE_JOB_WATCHDOG_MS),
    ).toBe(500);
  });
});

describe("SurfaceComputeRenderer fence group staging", () => {
  /** Each fence's group: the bytes written and the real dispatches
   * submitted since the previous fence (calibration probes dispatch zero
   * workgroups and the frame seed is not a group member, so neither
   * counts). */
  const fenceGroups = (
    events: ReturnType<typeof frameStagingHarness>["events"],
    seedPipeline: GPUComputePipeline,
  ): { bytes: number; dispatches: number }[] => {
    const groups: { bytes: number; dispatches: number }[] = [];
    let bytes = 0;
    let dispatches = 0;
    for (const event of events) {
      if (event.kind === "write") bytes += event.bytes;
      else if (event.kind === "dispatch") {
        if (event.x > 0 && event.pipeline !== seedPipeline) dispatches++;
      } else {
        groups.push({ bytes, dispatches });
        bytes = 0;
        dispatches = 0;
      }
    }
    return groups;
  };

  it("never stands a second dispatch behind a fence once the group's staged bytes reach the ceiling", async () => {
    // 1024x512 in 180,000-ray slices: after the pilot slice, slices two and
    // three (720 KB and 657 KB of ray list) would share a fence on the
    // count cap alone.
    setSurfaceComputeSchedulePins({ marchChunk: 180_000 });
    try {
      const { renderer, events, seedPipeline } = frameStagingHarness();
      const spec = frameSpec();
      spec.width = 1024;
      spec.height = 512;

      expect(await renderer.renderFrame(spec)).not.toBeNull();

      const groups = fenceGroups(events, seedPipeline);
      for (const group of groups.filter((g) => g.dispatches >= 2)) {
        expect(group.bytes).toBeLessThan(
          SURFACE_COMPUTE_FENCE_GROUP_STAGED_BYTES,
        );
      }
      // The oversized path really ran: a lone dispatch past the ceiling.
      expect(
        groups.some(
          (g) =>
            g.dispatches === 1 &&
            g.bytes >= SURFACE_COMPUTE_FENCE_GROUP_STAGED_BYTES,
        ),
      ).toBe(true);
    } finally {
      setSurfaceComputeSchedulePins({});
    }
  });

  it("still stands small dispatches behind one fence", async () => {
    setSurfaceComputeSchedulePins({ marchChunk: 256 });
    try {
      const { renderer, events, seedPipeline } = frameStagingHarness();
      const spec = frameSpec();
      spec.width = 64;
      spec.height = 32;

      expect(await renderer.renderFrame(spec)).not.toBeNull();

      expect(
        fenceGroups(events, seedPipeline).some((g) => g.dispatches === 2),
      ).toBe(true);
    } finally {
      setSurfaceComputeSchedulePins({});
    }
  });
});

describe("surfaceComputeFenceGroupStagedFull", () => {
  const KB16 = 16 * 1024;

  it("closes a group once its staged bytes reach the ceiling", () => {
    expect(
      surfaceComputeFenceGroupStagedFull(
        2,
        SURFACE_COMPUTE_FENCE_GROUP_STAGED_BYTES,
      ),
    ).toBe(true);
  });

  it("closes an open group before a write that would carry it to the ceiling", () => {
    // Row D's shape: a small dispatch already queued, and a raster-sized
    // ray list next — the list must not join it.
    expect(
      surfaceComputeFenceGroupStagedFull(
        1,
        KB16,
        SURFACE_COMPUTE_FENCE_GROUP_STAGED_BYTES,
      ),
    ).toBe(true);
  });

  it("still sends an oversized single dispatch out, as a group of one", () => {
    // Row E: 8 MB behind a group of ONE is harmless. An empty group never
    // closes, so the dispatch goes out; once it is queued the group closes.
    const eightMb = 8 * 1024 * 1024;
    expect(surfaceComputeFenceGroupStagedFull(0, 0, eightMb)).toBe(false);
    expect(surfaceComputeFenceGroupStagedFull(1, eightMb)).toBe(true);
  });

  it("keeps two 16 KB dispatches grouped", () => {
    // Row C's writes: small staging must not close a group early.
    expect(surfaceComputeFenceGroupStagedFull(1, KB16, KB16)).toBe(false);
    expect(surfaceComputeFenceGroupStagedFull(2, 2 * KB16)).toBe(false);
  });
});

describe("surfaceComputeGroupDispatchMs", () => {
  it("splits a group's fence-free work equally across its dispatches", () => {
    expect(surfaceComputeGroupDispatchMs(120, 4)).toBe(30);
  });

  it("is the identity for a group of one", () => {
    expect(surfaceComputeGroupDispatchMs(120, 1)).toBe(120);
  });

  it("never divides by zero when a group has no priced member", () => {
    expect(surfaceComputeGroupDispatchMs(120, 0)).toBe(120);
  });
});

describe("nextShadeHitCost over a fence group", () => {
  it("fits the group's whole measurement exactly", () => {
    // d dispatches and N hits, one measurement: after the update the
    // model reproduces it. That is the same exact-fit property the
    // single-dispatch form has, which is what keeps nothing double
    // counted in either direction.
    const before = { interceptUs: 90_000, marginalUs: 40 };
    const d = 3;
    const hits = 1500;
    const measuredUs = 500_000;
    const after = nextShadeHitCost(before, hits, measuredUs, d);
    expect(d * after.interceptUs + hits * after.marginalUs).toBeCloseTo(
      measuredUs,
      3,
    );
  });

  it("preserves intercept = PIVOT x marginal at any group size", () => {
    // The ratio invariant the single-dispatch form has, unchanged by the
    // generalization — the weight carries the dispatch count so the
    // algebra cancels exactly as it does at d = 1.
    const marginalUs = 40;
    const on = {
      interceptUs: SURFACE_COMPUTE_SHADE_COST_PIVOT * marginalUs,
      marginalUs,
    };
    for (const d of [1, 2, 8]) {
      const after = nextShadeHitCost(on, 900 * d, 4_000_000, d);
      expect(after.interceptUs / after.marginalUs).toBeCloseTo(
        SURFACE_COMPUTE_SHADE_COST_PIVOT,
        6,
      );
    }
  });

  it("is the same answer as folding each member at the equal share, at equal widths", () => {
    // The identity surfaceComputeGroupDispatchMs's own comment names: a
    // uniform group read jointly and read member by member agree by
    // algebra, so the two attributions cannot disagree where they overlap.
    const before = { interceptUs: 90_000, marginalUs: 40 };
    const d = 4;
    const n = 700;
    const measuredUs = 800_000;
    const joint = nextShadeHitCost(before, n * d, measuredUs, d);
    let member = before;
    for (let i = 0; i < d; i++) {
      member = nextShadeHitCost(member, n, measuredUs / d);
    }
    expect(joint.interceptUs).toBeCloseTo(member.interceptUs, 6);
    expect(joint.marginalUs).toBeCloseTo(member.marginalUs, 6);
  });

  it("is the original function for a group of one", () => {
    const before = { interceptUs: 90_000, marginalUs: 40 };
    expect(nextShadeHitCost(before, 512, 300_000, 1)).toEqual(
      nextShadeHitCost(before, 512, 300_000),
    );
  });
});

describe("transportBatchSize", () => {
  it("holds a transport dispatch's predicted total under its own ceiling, far below the shade lane's", () => {
    // A heavy transport shape: 400 ms fixed, 400 us a ray. The shade
    // ceiling lets the batch grow until the prediction reaches 2 s — the
    // AMD box's measured job cut, which a heavy-tailed transport batch
    // overshoots (tess16 glass landed 1.85 s, the 600-cell lost the
    // device). The transport lane stops at its own 500 ms.
    const cost = { interceptUs: 400_000, marginalUs: 400 };
    expect(shadeHitBatchSize(cost, SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH)).toBe(
      4000,
    );
    const batch = transportBatchSize(cost, SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH);
    expect(batch).toBe(250);
    expect(cost.interceptUs + batch * cost.marginalUs).toBeLessThanOrEqual(
      SURFACE_COMPUTE_TRANSPORT_DISPATCH_CEILING_MS * 1000,
    );
  });

  it("never asks for more than the shade sizer would, so a light lane is unchanged", () => {
    const light = { interceptUs: 2_000, marginalUs: 5 };
    expect(transportBatchSize(light, SURFACE_COMPUTE_SHADE_HIT_CAP_START)).toBe(
      shadeHitBatchSize(light, SURFACE_COMPUTE_SHADE_HIT_CAP_START),
    );
  });

  it("floors at one workgroup even when the fixed cost alone passes the ceiling", () => {
    // Below a workgroup buys no watchdog safety (shadeHitBatchSize's doc);
    // a single workgroup that outruns the watchdog needs a resumable trace.
    expect(
      transportBatchSize(
        { interceptUs: 900_000, marginalUs: 500 },
        SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH,
      ),
    ).toBe(SURFACE_COMPUTE_WORKGROUP_SIZE);
  });
});

describe("nextTransportQuantum", () => {
  const T = SURFACE_COMPUTE_TRANSPORT_QUANTUM_TARGET_MS;

  it("doubles only after a chunk under half the target", () => {
    expect(nextTransportQuantum(32, 32, T / 2 - 1, 2048)).toBe(64);
    expect(nextTransportQuantum(32, 32, T / 2, 2048)).toBe(32);
  });

  it("holds between half the target and the target", () => {
    expect(nextTransportQuantum(256, 32, T, 2048)).toBe(256);
  });

  it("halves over the target and returns to the base past twice it", () => {
    expect(nextTransportQuantum(256, 32, T + 1, 2048)).toBe(128);
    expect(nextTransportQuantum(256, 32, 2 * T + 1, 2048)).toBe(32);
    expect(nextTransportQuantum(256, 32, Number.NaN, 2048)).toBe(32);
  });

  it("stays inside [base, max]", () => {
    expect(nextTransportQuantum(2048, 32, 0, 2048)).toBe(2048);
    expect(nextTransportQuantum(32, 32, T + 1, 2048)).toBe(32);
  });

  it("is capped by a full-width base chunk's per-path price", () => {
    // Pearls-like: a 46 ms full-width chunk may grow five-fold at most.
    expect(transportQuantumCap(32, 46, 2048)).toBe(160);
    // 600-cell-like: a heavy full-width chunk pins the base.
    expect(transportQuantumCap(32, 560, 2048)).toBe(32);
    expect(transportQuantumCap(32, Number.NaN, 2048)).toBe(32);
    // Never past the processed-path guard.
    expect(transportQuantumCap(32, 0, 2048)).toBe(2048);
    // At the cap, that chunk's per-path price stays under half the
    // transport ceiling.
    const cap = transportQuantumCap(32, 46, 2048);
    expect((cap / 32) * 46).toBeLessThanOrEqual(
      SURFACE_COMPUTE_TRANSPORT_DISPATCH_CEILING_MS / 2,
    );
  });

  it("targets far inside the transport ceiling", () => {
    expect(4 * T).toBeLessThan(SURFACE_COMPUTE_TRANSPORT_DISPATCH_CEILING_MS);
  });
});

describe("SurfaceComputeRenderer sphere-inversion glass continuation", () => {
  function glassTarget(): SurfaceComputeAnyTarget {
    return { kind: "sphereInversion", de: continuationSphereInversionDE() };
  }

  it("binds its continuation at 16, beside the table it leaves at 1, as the stage's tenth storage buffer", async () => {
    const h = await createPaletteResourceHarness(
      false,
      glassTarget(),
      false,
      [],
      { backend: "sphereInversion" },
    );
    const shadeLayout = Array.from(h.layoutDescriptors[1].entries);
    expect(
      shadeLayout.filter((e) => e.buffer && e.buffer.type !== "uniform"),
    ).toHaveLength(10);
    expect(shadeLayout.find((e) => e.binding === 1)?.buffer?.type).toBe(
      "read-only-storage",
    );
    expect(shadeLayout.find((e) => e.binding === 16)?.buffer?.type).toBe(
      "storage",
    );
    const transport = h.shaderSources.find((src) =>
      src.includes("fn transportRays("),
    );
    expect(transport).toContain(
      "@group(0) @binding(16) var<storage, read_write> siWork: SiTransportBatch;",
    );
    expect(transport).toContain(
      "processed - chunkStartProcessed >= siWork.quantum",
    );
    const allocate = Reflect.get(h.renderer, "allocateFrameBuffers") as (
      rays: number,
    ) => Promise<unknown>;
    await allocate.call(h.renderer, 17);
    const work = h.bufferDescriptors.filter(
      (b) => b.label === "si-transport-work",
    );
    expect(work).toHaveLength(1);
    expect(work[0].size).toBe(transportWorkBytes(17, TRANSPORT_PATH_BYTES));
    const entry = (group: number, binding: number) =>
      Array.from(h.bindGroups[group].entries).find((e) => e.binding === binding)
        ?.resource;
    // The table stays the table in both groups; the work is its own slot.
    expect(entry(1, 1)).toEqual(entry(0, 1));
    expect(entry(1, 16)).toBeDefined();
    expect(entry(0, 16)).toBeUndefined();
    h.renderer.destroy();
  });

  it("keeps the uninterrupted control's nine bindings and kernel text when the quantum is zero", async () => {
    const h = await createPaletteResourceHarness(
      false,
      glassTarget(),
      false,
      [],
      { backend: "sphereInversion", chunkPaths: 0 },
    );
    const shadeLayout = Array.from(h.layoutDescriptors[1].entries);
    expect(
      shadeLayout.filter((e) => e.buffer && e.buffer.type !== "uniform"),
    ).toHaveLength(9);
    expect(shadeLayout.some((e) => e.binding === 16)).toBe(false);
    for (const src of h.shaderSources) {
      expect(src).not.toContain("siWork");
      expect(src).not.toContain("Work.quantum");
    }
    const allocate = Reflect.get(h.renderer, "allocateFrameBuffers") as (
      rays: number,
    ) => Promise<unknown>;
    await allocate.call(h.renderer, 17);
    expect(
      h.bufferDescriptors.some((b) => b.label === "si-transport-work"),
    ).toBe(false);
    h.renderer.destroy();
  });

  it("resumes a paused trace from the same slot list through its own running counter", async () => {
    const h = finiteContinuationHarness({ kind: "sphereInversion" });
    const frame = await h.renderer.renderFrame(h.spec);
    expect(frame?.transport?.resolved).toBe(3);
    expect(frame?.transport?.continuationChunks).toBe(1);
    expect(
      h.dispatches.map((d) => [d.initialize, d.generation, d.rayIds]),
    ).toEqual([
      [1, 1, [0, 1, 2]],
      [0, 1, [0, 1, 2]],
    ]);
    expect(
      h.copies.filter(
        (c) => h.memory.get(c.dst)!.descriptor.label === "si-transport-running",
      ),
    ).toHaveLength(2);
    h.renderer.destroy();
  });

  it("pilots at one workgroup and grows on its worst CHUNK, not on the batch the chunks sum to", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    // Four chunks of 150 ms: every submission is well under the transport
    // ceiling, while the batch they sum to (600 ms) is over it. Judged per
    // submission the lane grows; judged per batch it would stay pinned.
    const chunks = new Map<number, number>();
    const h = finiteContinuationHarness({
      kind: "sphereInversion",
      outcome: (d) => {
        now += 150;
        const k = (chunks.get(d.generation) ?? 0) + 1;
        chunks.set(d.generation, k);
        const running = k < 4 ? d.rayIds.length : 0;
        return {
          running,
          statuses: d.rayIds.map(() =>
            running > 0
              ? FINITE_TRANSPORT_RUNNING
              : SURFACE_GPU_TRANSPORT_COMPLETE,
          ),
        };
      },
    });
    try {
      h.spec.width = 400;
      const frame = await h.renderer.renderFrame(h.spec);
      expect(frame?.transport?.resolved).toBe(400);
      const batches = h.dispatches
        .filter((d) => d.initialize === 1)
        .map((d) => d.rayIds.length);
      expect(batches[0]).toBe(SURFACE_COMPUTE_SHADE_HIT_CAP_START);
      expect(batches[1]).toBeGreaterThan(SURFACE_COMPUTE_SHADE_HIT_CAP_START);
      expect(4 * 150).toBeGreaterThan(
        SURFACE_COMPUTE_TRANSPORT_DISPATCH_CEILING_MS,
      );
    } finally {
      h.renderer.destroy();
      clock.mockRestore();
    }
  });

  it("grows a drained pool's quantum from the base", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    // A batch whose chunks each cost 5 ms and stay running for six chunks:
    // far under the ladder's growth line, so every chunk doubles the next.
    const chunks = new Map<number, number>();
    const h = finiteContinuationHarness({
      kind: "sphereInversion",
      chunkPaths: 32,
      adaptiveSchedule: true,
      outcome: (d) => {
        now += 5;
        const k = (chunks.get(d.generation) ?? 0) + 1;
        chunks.set(d.generation, k);
        const running = k < 6 ? d.rayIds.length : 0;
        return {
          running,
          statuses: d.rayIds.map(() =>
            running > 0
              ? FINITE_TRANSPORT_RUNNING
              : SURFACE_GPU_TRANSPORT_COMPLETE,
          ),
        };
      },
    });
    try {
      const frame = await h.renderer.renderFrame(h.spec);
      expect(frame?.transport?.resolved).toBe(3);
      expect(h.dispatches.map((d) => d.quantum)).toEqual([
        32, 64, 128, 256, 512, 1024,
      ]);
    } finally {
      h.renderer.destroy();
      clock.mockRestore();
    }
  });

  it("holds the base quantum while the pool can still widen (width first)", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    // Cheap chunks (5 ms, far under the growth line) over 5,000 hits: every
    // trace pauses once. While rays wait in the queue and the width is
    // under capacity, the quantum must stay at the base so the width
    // ladder keeps its base-quantum chunks to learn from.
    const seen = new Set<number>();
    const h = finiteContinuationHarness({
      kind: "sphereInversion",
      chunkPaths: 32,
      adaptiveSchedule: true,
      outcome: (d) => {
        now += 5;
        const statuses = d.rayIds.map((w) => {
          const ray = w & SPHERE_INVERSION_POOL_RAY_MASK;
          if ((w & SPHERE_INVERSION_POOL_FRESH_BIT) !== 0) {
            seen.add(ray);
            return FINITE_TRANSPORT_RUNNING;
          }
          return SURFACE_GPU_TRANSPORT_COMPLETE;
        });
        return {
          running: statuses.filter((v) => v === FINITE_TRANSPORT_RUNNING)
            .length,
          statuses,
        };
      },
    });
    try {
      h.spec.width = 5000;
      const frame = await h.renderer.renderFrame(h.spec);
      expect(frame?.transport?.resolved).toBe(5000);
      const widths = h.dispatches.map((d) => d.rayIds.length);
      expect(widths.slice(0, 5)).toEqual([64, 128, 256, 512, 1024]);
      expect(h.dispatches.slice(0, 5).map((d) => d.quantum)).toEqual([
        32, 32, 32, 32, 32,
      ]);
    } finally {
      h.renderer.destroy();
      clock.mockRestore();
    }
  });

  it("refills a finished pool slot with the next queued ray, fresh", async () => {
    // 100 hits against a one-workgroup opening width: the first chunk
    // holds 64 rays, every trace completes at once, and the next chunk's
    // slots carry the remaining 36 rays with the fresh bit set.
    const h = finiteContinuationHarness({
      kind: "sphereInversion",
      chunkPaths: 32,
      adaptiveSchedule: true,
      outcome: (d) => ({
        running: 0,
        statuses: d.rayIds.map(() => SURFACE_GPU_TRANSPORT_COMPLETE),
      }),
    });
    try {
      h.spec.width = 100;
      const frame = await h.renderer.renderFrame(h.spec);
      expect(frame?.transport?.resolved).toBe(100);
      const fresh = SPHERE_INVERSION_POOL_FRESH_BIT;
      const [first, second] = h.dispatches;
      expect(first.rayIds).toHaveLength(64);
      expect(first.rayIds.every((w) => (w & fresh) !== 0)).toBe(true);
      expect(
        first.rayIds.map((w) => w & SPHERE_INVERSION_POOL_RAY_MASK),
      ).toEqual(Array.from({ length: 64 }, (_, i) => i));
      expect(
        second.rayIds
          .filter((w) => (w & fresh) !== 0)
          .map((w) => w & SPHERE_INVERSION_POOL_RAY_MASK),
      ).toEqual(Array.from({ length: 36 }, (_, i) => 64 + i));
    } finally {
      h.renderer.destroy();
    }
  });

  it("re-queues a pending trace at its next replay pass instead of waiting for the pass to end", async () => {
    // Ray 0 comes back PENDING at pass 0 while ray 1 keeps running; the
    // next chunk restarts ray 0 at pass 1 beside ray 1's continuation.
    let chunk = 0;
    const h = finiteContinuationHarness({
      kind: "sphereInversion",
      chunkPaths: 32,
      adaptiveSchedule: true,
      outcome: (d) => {
        chunk++;
        return {
          running: chunk === 1 ? 1 : 0,
          statuses: d.rayIds.map((w, i) => {
            const ray = w & SPHERE_INVERSION_POOL_RAY_MASK;
            if (chunk === 1)
              return ray === 0
                ? SURFACE_GPU_TRANSPORT_PENDING
                : ray === 1
                  ? FINITE_TRANSPORT_RUNNING
                  : SURFACE_GPU_TRANSPORT_COMPLETE;
            return i < 3 ? SURFACE_GPU_TRANSPORT_COMPLETE : null;
          }),
        };
      },
    });
    try {
      const frame = await h.renderer.renderFrame(h.spec);
      expect(frame?.transport?.resolved).toBe(3);
      expect(frame?.transport?.passes).toBe(2);
      const second = h.dispatches[1].rayIds;
      const pass = (w: number) =>
        (w >>> SPHERE_INVERSION_POOL_RAY_BITS) &
        SPHERE_INVERSION_POOL_PASS_MASK;
      // Slot 0 restarts ray 0 at pass 1; slot 1 resumes ray 1 unflagged.
      expect(second[0] & SPHERE_INVERSION_POOL_RAY_MASK).toBe(0);
      expect(pass(second[0])).toBe(1);
      expect(second[0] & SPHERE_INVERSION_POOL_FRESH_BIT).not.toBe(0);
      expect(second[1]).toBe(1);
    } finally {
      h.renderer.destroy();
    }
  });

  describe("speculative replay passes", () => {
    const flags =
      SPHERE_INVERSION_POOL_SPEC_BIT | SPHERE_INVERSION_POOL_FRESH_BIT;
    const keyOf = (w: number) => (w & ~flags) >>> 0;
    const key = (ray: number, pass: number) =>
      sphereInversionPoolWord(ray, pass, false);
    const isSpec = (w: number) => (w & SPHERE_INVERSION_POOL_SPEC_BIT) !== 0;
    const isFresh = (w: number) => (w & SPHERE_INVERSION_POOL_FRESH_BIT) !== 0;
    const R = FINITE_TRANSPORT_RUNNING;
    const C = SURFACE_GPU_TRANSPORT_COMPLETE;
    const P = SURFACE_GPU_TRANSPORT_PENDING;
    const U = SURFACE_GPU_TRANSPORT_UNRESOLVED;
    /** A pool over glass rays whose kernel answers each dispatched word
     * from `script(key, n, word)`, `n` counting that key's dispatches
     * (1-based) within the frame. The parked sentinel answers INVALID, as
     * the kernel's bounds guard does. `primed` first renders a frame in
     * which ray 0 goes pending once at pass 0: the prediction the measured
     * frame at the same raster seeds. */
    const scripted = async (
      script: (k: number, n: number, word: number) => number,
      primed = true,
      width = 3,
    ) => {
      const seen = new Map<number, number>();
      let priming = primed;
      const h = finiteContinuationHarness({
        kind: "sphereInversion",
        chunkPaths: 32,
        adaptiveSchedule: true,
        outcome: (d) => {
          const statuses = d.rayIds.map((w) => {
            if (
              (w & SPHERE_INVERSION_POOL_RAY_MASK) ===
              SPHERE_INVERSION_POOL_RAY_MASK
            )
              return SURFACE_GPU_TRANSPORT_INVALID;
            const k = keyOf(w);
            const n = (seen.get(k) ?? 0) + 1;
            seen.set(k, n);
            if (priming) return k === key(0, 0) ? P : C;
            return script(k, n, w);
          });
          return {
            running: statuses.filter((v) => v === R).length,
            statuses,
          };
        },
      });
      h.spec.width = width;
      if (primed) {
        const primer = await h.renderer.renderFrame(h.spec);
        expect(primer?.transport?.passes).toBe(2);
        priming = false;
        seen.clear();
      }
      const before = h.dispatches.length;
      return { h, measured: () => h.dispatches.slice(before) };
    };
    const wordsOf = (dispatches: FiniteHostDispatch[], k: number) =>
      dispatches.flatMap((d) => d.rayIds.filter((w) => keyOf(w) === k));

    it("seeds a predicted pixel's next pass beside its pass 0, and makes it the real pass when pass 0 goes pending", async () => {
      const { h, measured } = await scripted((k, n) =>
        k === key(0, 0)
          ? n < 4
            ? R
            : P
          : k === key(0, 1)
            ? n < 6
              ? R
              : C
            : C,
      );
      try {
        const frame = await h.renderer.renderFrame(h.spec);
        expect(frame?.transport?.resolved).toBe(3);
        expect(frame?.transport?.passes).toBe(2);
        const [first] = measured();
        // The first chunk carries pass 0 and its speculated pass 1 together.
        expect(first.rayIds.map(keyOf)).toContain(key(0, 1));
        const pass1 = wordsOf(measured(), key(0, 1));
        expect(isSpec(pass1[0]) && isFresh(pass1[0])).toBe(true);
        // Speculative through chunk 4, where pass 0 goes pending; then the
        // same trace resumes unflagged. Never restarted.
        expect(pass1.slice(0, 4).every(isSpec)).toBe(true);
        expect(pass1.slice(4).every((w) => w === key(0, 1))).toBe(true);
        expect(pass1.filter(isFresh)).toHaveLength(1);
      } finally {
        h.renderer.destroy();
      }
    });

    it("commits a speculative trace that finished in the same chunk its predecessor went pending", async () => {
      const { h, measured } = await scripted((k, n, w) =>
        k === key(0, 0)
          ? n < 4
            ? R
            : P
          : k === key(0, 1)
            ? isSpec(w)
              ? n < 4
                ? R
                : C
              : C // the commit re-reports the stored status
            : C,
      );
      try {
        const frame = await h.renderer.renderFrame(h.spec);
        expect(frame?.transport?.resolved).toBe(3);
        expect(frame?.transport?.passes).toBe(2);
        const pass1 = wordsOf(measured(), key(0, 1));
        // Four speculative chunks, then ONE commit: same slot, unflagged.
        expect(pass1.filter(isSpec)).toHaveLength(4);
        expect(pass1.at(-1)).toBe(key(0, 1));
        expect(pass1.filter((w) => !isSpec(w))).toHaveLength(1);
      } finally {
        h.renderer.destroy();
      }
    });

    it("holds a speculative trace that fails before its predecessor finishes, and commits it when the predecessor goes pending", async () => {
      // A later pass can fail sooner (its stack fills first).
      const { h, measured } = await scripted((k, n) =>
        k === key(0, 0) ? (n < 5 ? R : P) : k === key(0, 1) ? U : C,
      );
      try {
        const frame = await h.renderer.renderFrame(h.spec);
        expect(frame?.transport?.resolved).toBe(2);
        expect(frame?.transport?.unresolved).toBe(1);
        expect(frame?.transport?.passes).toBe(2);
        const pass1 = wordsOf(measured(), key(0, 1));
        expect(pass1.filter(isFresh)).toHaveLength(1);
        expect(pass1.at(-1)).toBe(key(0, 1));
        expect(pass1.filter((w) => !isSpec(w))).toHaveLength(1);
      } finally {
        h.renderer.destroy();
      }
    });

    it("drops a held speculative result when its predecessor finishes for good", async () => {
      const { h, measured } = await scripted((k, n) =>
        k === key(0, 0) ? (n < 5 ? R : C) : k === key(0, 1) ? U : C,
      );
      try {
        const frame = await h.renderer.renderFrame(h.spec);
        expect(frame?.transport?.resolved).toBe(3);
        expect(frame?.transport?.unresolved).toBe(0);
        expect(frame?.transport?.passes).toBe(1);
        expect(wordsOf(measured(), key(0, 1)).some((w) => !isSpec(w))).toBe(
          false,
        );
      } finally {
        h.renderer.destroy();
      }
    });

    it("parks a running speculative slot, unwritten, when its predecessor finishes for good", async () => {
      // Ray 0's pass 0 completes in chunk 3 while its pass 1 still runs;
      // ray 1 keeps the pool going and the parked slot inside the width.
      const { h, measured } = await scripted(
        (k, n) =>
          k === key(0, 0)
            ? n < 3
              ? R
              : C
            : k === key(3, 0)
              ? n < 7
                ? R
                : C
              : k === key(0, 1)
                ? R
                : C,
        true,
        4,
      );
      try {
        const frame = await h.renderer.renderFrame(h.spec);
        expect(frame?.transport?.resolved).toBe(4);
        const after = measured().slice(3);
        expect(after.length).toBeGreaterThan(0);
        expect(
          after.some((d) => d.rayIds.some((w) => keyOf(w) === key(0, 1))),
        ).toBe(false);
        expect(after[0].rayIds).toContain(SPHERE_INVERSION_POOL_RAY_MASK);
      } finally {
        h.renderer.destroy();
      }
    });

    it("never speculates a ray that has not gone pending without a prediction, nor across a raster change", async () => {
      // The 4D starter's shape: long traces, none pending. Every chunk waits
      // for its slowest lane, so speculating them would only slow them.
      const cold = await scripted(
        (k, n) => (k === key(0, 0) ? (n < 6 ? R : C) : C),
        false,
      );
      const moved = await scripted((k, n) =>
        k === key(0, 0) ? (n < 6 ? R : C) : C,
      );
      try {
        await cold.h.renderer.renderFrame(cold.h.spec);
        moved.h.spec.width = 4;
        await moved.h.renderer.renderFrame(moved.h.spec);
        for (const { measured } of [cold, moved])
          expect(measured().some((d) => d.rayIds.some((w) => isSpec(w)))).toBe(
            false,
          );
      } finally {
        cold.h.renderer.destroy();
        moved.h.renderer.destroy();
      }
    });

    it("stops speculating once a prediction fails to come true, and re-arms when the pending set repeats", async () => {
      // Primer: ray 0 pending. Frame A: ray 0 completes (the guess was
      // wrong). Frame B: ray 0 pending again, but unspeculated. Frame C:
      // pending again, and speculated.
      // (Frame B's pending pass 0 still chains its pass 2 ahead of the
      // real pass 1 — SPEC_AHEAD, the ray's own evidence — so the
      // prediction is read off pass 1 alone.)
      let frame = "A";
      const { h, measured } = await scripted((k) =>
        k === key(0, 0) ? (frame === "A" ? C : P) : C,
      );
      try {
        const specPass1 = (ds: FiniteHostDispatch[]) =>
          ds.some((d) =>
            d.rayIds.some((w) => isSpec(w) && keyOf(w) === key(0, 1)),
          );
        const at = () => h.dispatches.length;
        await h.renderer.renderFrame(h.spec);
        expect(specPass1(measured())).toBe(true); // trusted once
        let before = at();
        frame = "B";
        await h.renderer.renderFrame(h.spec);
        expect(specPass1(h.dispatches.slice(before))).toBe(false);
        before = at();
        frame = "C";
        await h.renderer.renderFrame(h.spec);
        expect(specPass1(h.dispatches.slice(before))).toBe(true);
      } finally {
        h.renderer.destroy();
      }
    });

    it("keeps one pass speculated ahead of a cold ray that went pending", async () => {
      // No prediction: ray 0 goes pending at passes 0 and 1 and completes
      // at pass 2. Pass 2 runs speculatively beside the real pass 1, and
      // pass 3 beside the promoted pass 2, killed unwritten at its end.
      const { h, measured } = await scripted(
        (k, n) =>
          k === key(0, 0)
            ? n < 3
              ? R
              : P
            : k === key(0, 1)
              ? n < 3
                ? R
                : P
              : k === key(0, 2)
                ? n < 8
                  ? R
                  : C
                : k === key(0, 3)
                  ? R
                  : C,
        false,
      );
      try {
        const frame = await h.renderer.renderFrame(h.spec);
        expect(frame?.transport?.resolved).toBe(3);
        expect(frame?.transport?.passes).toBe(3);
        const ds = measured();
        const pass1 = wordsOf(ds, key(0, 1));
        const pass2 = wordsOf(ds, key(0, 2));
        const pass3 = wordsOf(ds, key(0, 3));
        // Pass 1 is real from the start (nothing predicted it).
        expect(pass1.some(isSpec)).toBe(false);
        // Pass 2 starts speculatively beside pass 1, once, and becomes real.
        expect(pass2.filter(isFresh)).toHaveLength(1);
        expect(isSpec(pass2[0])).toBe(true);
        expect(pass2.at(-1)).toBe(key(0, 2));
        // Pass 3 only ever ran speculatively, and never past pass 2's end.
        expect(pass3.length).toBeGreaterThan(0);
        expect(pass3.every(isSpec)).toBe(true);
        let lastPass2 = -1;
        ds.forEach((d, i) => {
          if (d.rayIds.some((w) => keyOf(w) === key(0, 2))) lastPass2 = i;
        });
        expect(
          ds
            .slice(lastPass2 + 1)
            .some((d) => d.rayIds.some((w) => keyOf(w) === key(0, 3))),
        ).toBe(false);
      } finally {
        h.renderer.destroy();
      }
    });

    it("never chains a ray the prediction seeded", async () => {
      // Primed: ray 0 predicted to pass 1. It goes pending at pass 0 and
      // completes at pass 1, so its promoted pass 1 is its last: nothing
      // runs at pass 2.
      const { h, measured } = await scripted((k, n) =>
        k === key(0, 0)
          ? n < 3
            ? R
            : P
          : k === key(0, 1)
            ? n < 6
              ? R
              : C
            : C,
      );
      try {
        const frame = await h.renderer.renderFrame(h.spec);
        expect(frame?.transport?.passes).toBe(2);
        expect(wordsOf(measured(), key(0, 2))).toHaveLength(0);
      } finally {
        h.renderer.destroy();
      }
    });

    it("never chains past the last replay pass", async () => {
      const { h, measured } = await scripted(
        (k) =>
          (k >>> SPHERE_INVERSION_POOL_RAY_BITS) + 1 <
            DIELECTRIC_REPLAY_PASSES &&
          (k & SPHERE_INVERSION_POOL_RAY_MASK) === 0
            ? P
            : C,
        false,
      );
      try {
        const frame = await h.renderer.renderFrame(h.spec);
        expect(frame?.transport?.passes).toBe(DIELECTRIC_REPLAY_PASSES);
        const passes = measured()
          .flatMap((d) => d.rayIds)
          .filter((w) => (w & SPHERE_INVERSION_POOL_RAY_MASK) === 0)
          .map(
            (w) =>
              (keyOf(w) >>> SPHERE_INVERSION_POOL_RAY_BITS) &
              SPHERE_INVERSION_POOL_PASS_MASK,
          );
        expect(Math.max(...passes)).toBe(DIELECTRIC_REPLAY_PASSES - 1);
      } finally {
        h.renderer.destroy();
      }
    });

    it("marks a budget cut in the pool's serial tail, and only there", async () => {
      // The wall is jumped past the budget from the pool's second chunk
      // on. Three rays fit the first chunk, so the cut finds an empty
      // queue: the tail. Two hundred do not, so the cut finds rays still
      // owed a slot: not the tail.
      const realNow = performance.now.bind(performance);
      let offset = 0;
      const clock = vi
        .spyOn(performance, "now")
        .mockImplementation(() => realNow() + offset);
      try {
        const cut = async (width: number) => {
          const { h } = await scripted(
            (k, n) => {
              if (n >= 2) offset = 1e9;
              return k === key(0, 0) ? R : C;
            },
            false,
            width,
          );
          try {
            offset = 0;
            return await h.renderer.renderFrame(h.spec, { budgetMs: 1e8 });
          } finally {
            h.renderer.destroy();
          }
        };
        const tail = await cut(3);
        expect(tail?.truncated).toBe(true);
        expect(tail?.transport?.tailCut).toBe("budget");
        const early = await cut(200);
        expect(early?.truncated).toBe(true);
        expect(early?.transport?.tailCut).toBeUndefined();
      } finally {
        clock.mockRestore();
      }
    });

    it("yields its serial tail to endTail, and never before every ray had a slot", async () => {
      // Two hundred rays outnumber the first chunks, so endTail is asked
      // only once the queue drains; ray 0 is still running then.
      const run = async (endTail: () => boolean) => {
        const { h } = await scripted(
          (k, n) => (k === key(0, 0) ? (n < 40 ? R : C) : C),
          false,
          200,
        );
        try {
          return await h.renderer.renderFrame(h.spec, { endTail });
        } finally {
          h.renderer.destroy();
        }
      };
      const yielded = await run(() => true);
      expect(yielded?.truncated).toBe(true);
      expect(yielded?.transport?.tailCut).toBe("yielded");
      expect(yielded?.transport?.resolved).toBe(199);
      const whole = await run(() => false);
      expect(whole?.truncated).toBe(false);
      expect(whole?.transport?.tailCut).toBeUndefined();
      expect(whole?.transport?.resolved).toBe(200);
    });

    it("never speculates under ?surfacesispec=0", async () => {
      const { h, measured } = await scripted((k, n) =>
        k === key(0, 0) ? (n < 4 ? R : P) : C,
      );
      setSurfaceComputeSchedulePins({ siSpecOff: true });
      try {
        const frame = await h.renderer.renderFrame(h.spec);
        expect(frame?.transport?.resolved).toBe(3);
        expect(measured().some((d) => d.rayIds.some((w) => isSpec(w)))).toBe(
          false,
        );
      } finally {
        setSurfaceComputeSchedulePins({});
        h.renderer.destroy();
      }
    });
  });

  it("keeps a pinned quantum fixed: without the ladder every chunk runs the base", async () => {
    const chunks = new Map<number, number>();
    const h = finiteContinuationHarness({
      kind: "sphereInversion",
      chunkPaths: 32,
      outcome: (d) => {
        const k = (chunks.get(d.generation) ?? 0) + 1;
        chunks.set(d.generation, k);
        const running = k < 4 ? d.rayIds.length : 0;
        return {
          running,
          statuses: d.rayIds.map(() =>
            running > 0
              ? FINITE_TRANSPORT_RUNNING
              : SURFACE_GPU_TRANSPORT_COMPLETE,
          ),
        };
      },
    });
    try {
      await h.renderer.renderFrame(h.spec);
      expect(h.dispatches.map((d) => d.quantum)).toEqual([32, 32, 32, 32]);
    } finally {
      h.renderer.destroy();
    }
  });
});

describe("surfaceComputeJointArenaBytes (the glass joint pool's size rules)", () => {
  const roomy = {
    maxStorageBufferBindingSize: 2 ** 31,
    maxBufferSize: 2 ** 31,
  };

  it("takes the envelope's 4-sample settle and the app's 8-sample settle at 512x288", () => {
    expect(surfaceComputeJointArenaBytes(512 * 288, 4, roomy)).toBe(
      4 * 512 * 288 * 56,
    );
    expect(surfaceComputeJointArenaBytes(512 * 288, 8, roomy)).toBe(
      8 * 512 * 288 * 56,
    );
  });

  it("keeps one pool per sample past the arena ceiling, at one sample, and under the pin", () => {
    expect(surfaceComputeJointArenaBytes(1920 * 1080, 4, roomy)).toBe(0);
    expect(4 * 1920 * 1080 * 56).toBeGreaterThan(
      SURFACE_COMPUTE_JOINT_ARENA_BYTES,
    );
    expect(surfaceComputeJointArenaBytes(512 * 288, 1, roomy)).toBe(0);
    setSurfaceComputeSchedulePins({ siJointOff: true });
    try {
      expect(surfaceComputeJointArenaBytes(512 * 288, 4, roomy)).toBe(0);
    } finally {
      setSurfaceComputeSchedulePins({});
    }
  });

  it("refuses an arena whose transport records outgrow one storage binding", () => {
    const small = {
      maxStorageBufferBindingSize: 2 ** 24,
      maxBufferSize: 2 ** 31,
    };
    expect(512 * 288 * 4 * 32).toBeGreaterThan(
      small.maxStorageBufferBindingSize,
    );
    expect(surfaceComputeJointArenaBytes(512 * 288, 4, small)).toBe(0);
  });
});
