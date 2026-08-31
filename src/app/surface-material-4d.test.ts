import type * as THREE from "three";
import { Data3DTexture, DataTexture, NearestFilter } from "three";
import {
  createSurfaceMaterial4,
  setSurface4Balloon,
  setSurface4Materials,
  setSurface4GroundPlane,
  setSurfaceSystem4,
  setSurfaceView4,
  surface4FragmentFor,
  surface4FragmentResolvedFor,
  SURFACE4_MAX_MAPS,
} from "./surface-material-4d";
import {
  createSurfaceMaterial,
  materialSurfaceTiling,
  packSurfaceBalloonPalette,
  packSurfaceBalloonTint,
  SURFACE_CONDENSATION_GLSL_DEPTH_MAX,
  SURFACE_GLSL_STRIP_BYTES,
  surfaceFragmentFor,
  surfaceFragmentResolvedFor,
} from "./surface-material";
import { resolveSurfaceFinish } from "../fractal/surface-finish";
import {
  CLASSIC_SURFACE_MATERIAL,
  resolveSurfaceMaterial,
  surfaceMaterialLanes,
  type SurfaceMaterialSlots,
} from "../fractal/surface-material-wire";
import { identityRotorPair, rotateInPlane, rotorMatrix } from "./rotor4";
import type { SurfaceDE4, SurfaceDE4Map } from "../fractal/surface-de-4d";
import { radiusBandInvRange } from "../fractal/surface-de-4d";
import { CLASSIC_SURFACE_FOLD_RADII } from "../fractal/surface-de";
import {
  resolveTiling,
  TILING_GROUP_INFO,
  TILING_GROUPS,
  type ResolvedTiling,
} from "../fractal/tiling";
import type { ShapeSpec } from "../fractal/shapes";
import { twentyFourCellFlake } from "../fractal/presets";
import { createHash } from "node:crypto";
import { PRE_PATTERN_SOURCE_HASHES } from "./surface-pattern-baseline";

/** Balloon-palette source advance; unaffected rows stay pinned to the shared
 * pre-pattern fixture. */
const BALLOON_PALETTE_SOURCE_HASHES: Record<
  string,
  { resolved: string; emitted: string }
> = {
  "4D balloon finish0": {
    resolved: "0769da4164ccda95",
    emitted: "50f29771c6ddd73c",
  },
  "4D balloon finish1": {
    resolved: "62e202ba5c488c7c",
    emitted: "a66d90c86b8d1447",
  },
};

/** Intentional whole-tracer source advance for signed-CoC metadata. */
const DEPTH_OF_FIELD_SOURCE_HASHES: Record<
  string,
  { resolved: string; emitted: string }
> = {
  "4D base finish0": {
    resolved: "8248aba6382b9a4e",
    emitted: "8248aba6382b9a4e",
  },
  "4D balloon finish0": {
    resolved: "a6b1d39f778a691b",
    emitted: "b99a52e0f70aea2c",
  },
  "4D plane finish0": {
    resolved: "ca7b92ca9e64278e",
    emitted: "8800bea40c8a62ae",
  },
  "4D base finish1": {
    resolved: "c2310c52de115b63",
    emitted: "c2310c52de115b63",
  },
  "4D balloon finish1": {
    resolved: "898bef0145e8d230",
    emitted: "047caf9d7122a79b",
  },
  "4D plane finish1": {
    resolved: "88e962ee6787fb59",
    emitted: "c1238e6ba2bf9863",
  },
};

/**
 * The 4D tracer's per-map data rides a std140 uniform BLOCK rather than
 * default-block uniform arrays (that block is what let the cap match 3D's
 * 24 maps), and a std140 lane written one float off is invisible until
 * someone loads a 4D system in a browser. So while the rest of this
 * material is verified by running the app, its PACKER is pinned here: the
 * block's backing floats are pure data, no GL context involved.
 */

/** A minimal contracting inverse-map slot, merged with each test's overrides
 * (identity inverse unless a test cares about the matrix). */
function map4(overrides: Partial<SurfaceDE4Map> = {}): SurfaceDE4Map {
  return {
    invM: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    invT: [0, 0, 0, 0],
    sigmaMin: 0.5,
    baseIndex: 0,
    // Inert affine-slot defaults for the 4D fold fields — this packer
    // predates fold-4D and packs none of them.
    foldKind: 0,
    foldInvW: 1,
    foldSigma: 0.5,
    foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    invMSigmaMin: 0.5,
    invTNorm: 0,
    bnbDir: [0, 0, 0, 0],
    ...overrides,
  };
}

/** Row-major 4x4 identity — the no-kaleidoscope backward step. */
const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The smallest DE the packer accepts, wrapped around the given slots. */
function de4(
  maps: SurfaceDE4Map[],
  symmetry: SurfaceDE4["symmetry"] = { order: 1, stepBack: IDENTITY4 },
): SurfaceDE4 {
  return {
    maps,
    symmetry,
    boundingRadius: 1,
    visibleBoundingRadius: 1,
    radiusBand: { center: [0, 0, 0, 0], minD: 0, maxD: 1 },
    escapeRadius: 2,
    maxDepth: 8,
    slowestSigma: 0.5,
    beamWidth: 4,
    stepScale: 1,
    patternCalibration: {
      ringsLow: 0,
      ringsInvSpan: 0,
      sheetsLow: 0,
      sheetsInvSpan: 0,
    },
    final: null,
    foldFinal: null,
  };
}

/** The six Float32Arrays behind the material's `SurfaceMaps4` block, in the
 * order the fragment shader declares its members — the bytes the GPU reads.
 * Reached through the uniforms group because block members deliberately do
 * NOT appear in `material.uniforms`. */
function mapBlock(material: THREE.ShaderMaterial): {
  invM: Float32Array;
  invT: Float32Array;
  colorSigma: Float32Array;
  trap: Float32Array;
  finishA: Float32Array;
  finishB: Float32Array;
} {
  const group = material.uniformsGroups[0];
  const uniforms = group.uniforms as THREE.Uniform<Float32Array>[];
  return {
    invM: uniforms[0].value,
    invT: uniforms[1].value,
    colorSigma: uniforms[2].value,
    trap: uniforms[3].value,
    finishA: uniforms[4].value,
    finishB: uniforms[5].value,
  };
}

/** THREE.Matrix4 stores column-major; this reads one back out in the
 * row-major order rotorMatrix (rotor4.ts) and setSurfaceView4's own doc
 * comment both use, so an independently-computed expected matrix lines up
 * index for index against what the packer wrote. */
function rowMajorOf(m: THREE.Matrix4): number[] {
  const e = m.elements;
  return [
    e[0],
    e[4],
    e[8],
    e[12],
    e[1],
    e[5],
    e[9],
    e[13],
    e[2],
    e[6],
    e[10],
    e[14],
    e[3],
    e[7],
    e[11],
    e[15],
  ];
}

const COND4_SPHERE: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "sphere", radius: 0.35 },
      combine: "union",
    },
  ],
};

const COND4_BOX: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "box", half: [0.2, 0.25, 0.3] },
      combine: "union",
    },
  ],
};

const MESH4_SHAPE: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "mesh", meshId: "star-prism-v1" },
      combine: "union",
    },
  ],
};

function condEmitter4(
  shape: ShapeSpec,
  shadeIndex: number,
  invT: [number, number, number, number],
) {
  return {
    shape,
    baseIndex: shadeIndex,
    shadeIndex,
    sigmaMin: 0.2,
    invM: IDENTITY4,
    invT,
    center: [0, 0, 0, 0] as [number, number, number, number],
    radius: 1,
  };
}

function scheduled4(
  maps: SurfaceDE4Map[],
  depth = 2,
): NonNullable<SurfaceDE4["schedule"]> {
  return {
    maps,
    depth,
    bounds: Array.from({ length: depth + 1 }, (_, d) => ({
      radius: 10 - d,
      escapeRadius: 20 - 2 * d,
    })),
  };
}

describe("4D GLSL finite schedule packing and source", () => {
  it("keeps absent and zero-depth schedules on the exact legacy program", () => {
    const legacy = surface4FragmentFor();
    expect(surface4FragmentFor(0, 0, 0, 0, null, 0)).toBe(legacy);
    expect(legacy).not.toContain("uSchedule");
    expect(legacy).not.toContain("surface4LevelBound");
    const condensationLegacy = surface4FragmentFor(0, 0, 0, 0, [COND4_SPHERE]);
    expect(surface4FragmentFor(0, 0, 0, 0, [COND4_SPHERE], 0)).toBe(
      condensationLegacy,
    );
    expect(condensationLegacy).not.toContain("uCondMapCount");

    const material = createSurfaceMaterial4();
    const original = material.fragmentShader;
    setSurfaceSystem4(
      material,
      { ...de4([map4()]), schedule: scheduled4([map4()], 0) },
      [[0, 0, 0]],
    );
    expect(material.defines.SURFACE4_SCHEDULE).toBeUndefined();
    expect(material.uniforms.uScheduleDepth.value).toBe(0);
    expect(material.fragmentShader).toBe(original);
  });

  it("packs [A][B][emitters] while record, schedule and shade counts remain separate", () => {
    const material = createSurfaceMaterial4();
    const de: SurfaceDE4 = {
      ...de4([map4({ invT: [1, 0, 0, 0] }), map4({ invT: [2, 0, 0, 0] })]),
      schedule: scheduled4([
        map4({ invT: [3, 0, 0, 0], sigmaMin: 0.3 }),
        map4({ invT: [4, 0, 0, 0], sigmaMin: 0.4 }),
      ]),
      condensation: {
        emitters: [condEmitter4(COND4_SPHERE, 2, [5, 0, 0, 0])],
        depthBand: { minDepth: 0, maxDepth: 2 },
      },
    };
    setSurfaceSystem4(material, de, [
      [0, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const u = material.uniforms;
    expect(u.uMapCount.value).toBe(2);
    expect(u.uScheduleCount.value).toBe(2);
    expect(u.uScheduleDepth.value).toBe(2);
    expect(u.uCondMapCount.value).toBe(4);
    expect(u.uCondCount.value).toBe(1);
    expect(u.uShadeCount.value).toBe(3);
    const block = mapBlock(material);
    expect([0, 1, 2, 3, 4].map((slot) => block.invT[slot * 4])).toEqual([
      1, 2, 3, 4, 5,
    ]);
    // Logical emitter shade slot 2 shares B0's physical record lanes: its
    // color occupies xyz without corrupting B0's contraction in w.
    expect(Array.from(block.colorSigma.subarray(8, 11))).toEqual([1, 0, 0]);
    expect(block.colorSigma[11]).toBeCloseTo(0.3);
    const bounds = u.uScheduleBounds.value as THREE.Vector2[];
    expect([bounds[0].x, bounds[0].y, bounds[1].x, bounds[1].y]).toEqual([
      9, 18, 8, 16,
    ]);
  });

  it("switches the d=k-1 refiner to A, suppresses B symmetry, and begins A attribution at d=k", () => {
    const src = surface4FragmentResolvedFor(0, 0, 0, 0, null, 1);
    expect(src).toContain("return depth < uScheduleDepth ? uMapCount : 0;");
    expect(src).toContain("return depth < uScheduleDepth ? 1 : uSymOrder;");
    expect(src).toContain("vec2 childBound = surface4LevelBound(depth + 1);");
    expect(src).toContain(
      "best = min(best, refinedCert4(eQ, eExt, eR, eScale, depth + 1));",
    );
    expect(src).toContain("if (depth == uScheduleDepth)");
    expect(src).toContain("if (depth >= uScheduleDepth)");
  });

  it("composes schedule and condensation and preserves the post-B slab pattern trajectory", () => {
    const src = surface4FragmentFor(1, 0, 1, 1, [COND4_SPHERE], 1);
    expect(src).toContain("depth -= uScheduleDepth;");
    expect(src).toContain("int slot = uCondMapCount + e;");
    expect(src).toContain("patternScheduleCenter4 = c1Q;");
    expect(src).toContain(
      "patternRaw = patternScheduleCenter4 + sStar * patternScheduleExtent4",
    );
    expect(src).not.toContain("vec4 patternSource4 = vec4(pos");
  });

  it("accepts 24 physical records, rejects 25, strips the tight plain arm, and keeps every emitted variant below 64KB", () => {
    const accepted = createSurfaceMaterial4();
    setSurfaceSystem4(
      accepted,
      {
        ...de4([map4(), map4()]),
        schedule: scheduled4(Array.from({ length: 22 }, () => map4())),
      },
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
    );
    expect(accepted.uniforms.uScheduleCount.value).toBe(22);
    expect(() =>
      setSurfaceSystem4(
        createSurfaceMaterial4(),
        {
          ...de4([map4(), map4()]),
          schedule: scheduled4(Array.from({ length: 23 }, () => map4())),
        },
        [
          [0, 0, 0],
          [0, 0, 0],
        ],
      ),
    ).toThrow(/schedule maps/);

    const plainResolved = surface4FragmentResolvedFor(0, 0, 0, 0, null, 1);
    const plain = surface4FragmentFor(0, 0, 0, 0, null, 1);
    expect(plainResolved.length).toBeGreaterThan(SURFACE_GLSL_STRIP_BYTES);
    expect(plain).not.toContain("//");
    const variants = [
      plain,
      surface4FragmentFor(1, 0, 1, 1, null, 1),
      surface4FragmentFor(0, 1, 1, 1, null, 1),
      surface4FragmentFor(0, 0, 1, 1, [COND4_SPHERE], 1),
    ];
    for (const src of variants) expect(src.length).toBeLessThan(64 * 1024);
  });
});

describe("4D GLSL reverse-chi packing and source", () => {
  function graphDE(schedule = false): SurfaceDE4 {
    const de: SurfaceDE4 = {
      ...de4([map4({ stateIndex: 0 }), map4({ stateIndex: 1 })]),
      condensation: {
        emitters: [
          condEmitter4(COND4_SPHERE, 2, [5, 0, 0, 0]),
          condEmitter4(COND4_SPHERE, 2, [6, 0, 0, 0]),
        ],
        depthBand: { minDepth: 0, maxDepth: 8 },
      },
      chaos: {
        predecessorMasks: Uint32Array.from([0b101, 0b010, 0b111]),
        emitterStateIndices: Uint8Array.from([2, 2]),
        activeStateCount: 3,
      },
    };
    if (schedule) de.schedule = scheduled4([map4(), map4()]);
    return de;
  }

  it("keeps absent chi byte-identical and restores it exactly after a live graph", () => {
    const classic = surface4FragmentFor();
    expect(surface4FragmentFor(0, 0, 0, 0, null, 0, 0)).toBe(classic);
    expect(classic).not.toContain("surfaceChaosAllows4");
    expect(classic).not.toContain("uChaosPredecessorMasks");
    expect(classic).not.toContain("uniform vec4 uChaosPredecessorMasks");

    const material = createSurfaceMaterial4();
    const baseline = material.fragmentShader;
    setSurfaceSystem4(material, graphDE(), [
      [0, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
    ]);
    expect(material.defines.SURFACE4_CHAOS).toBe(1);
    expect(material.fragmentShader).toContain("surfaceChaosAllows4");
    setSurfaceSystem4(material, de4([map4()]), [[0, 0, 0]]);
    expect(material.defines.SURFACE4_CHAOS).toBeUndefined();
    expect(material.fragmentShader).toBe(baseline);
  });

  it("packs current-state masks and shared physical emitter states outside the frozen std140 map block", () => {
    const material = createSurfaceMaterial4();
    setSurfaceSystem4(material, graphDE(true), [
      [0, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const masks = material.uniforms.uChaosPredecessorMasks
      .value as THREE.Vector4[];
    expect([masks[0].x, masks[0].y, masks[0].z, masks[0].w]).toEqual([
      0b101, 0b010, 0b111, 0,
    ]);
    expect(material.uniforms.uCondState.value.slice(0, 2)).toEqual([2, 2]);
    expect(material.uniforms.uShadeCount.value).toBe(3);
    expect(material.uniforms.uCondCount.value).toBe(2);
    expect(material.uniformsGroups[0].uniforms).toHaveLength(6);
  });

  it("keeps root/B wildcard state and filters A/refiner/condensation predecessors without symmetry-expanded state", () => {
    const src = surface4FragmentResolvedFor(0, 0, 0, 0, [COND4_SPHERE], 1, 1);
    expect(src).toContain("if (currentState < 0) return true;");
    expect(src).toContain("uniform vec4 uChaosPredecessorMasks");
    expect(src).toContain("return mod(floor(mask / bit), 2.0) >= 1.0;");
    expect(src).toContain("if (depth < uScheduleDepth) return -1;");
    expect(src).toContain("int aState = -1;");
    expect(
      src.match(/if \(!surfaceChaosAllows4\(pState, childState\)\) continue;/g),
    ).toHaveLength(2);
    expect(src).toContain(
      "if (!surfaceChaosAllows4(currentState, childState)) continue;",
    );
    expect(src).toContain(
      "if (!surfaceChaosAllows4(currentState, uCondState[e])) continue;",
    );
    expect(src).toContain("childState = surfaceChaosChildState4(depth, j)");
    expect(src).not.toContain("childState = k");
  });

  it("keeps the largest emitted 4D chaos/schedule/condensation/lens-equivalent program below 65,536 bytes", () => {
    const variants: string[] = [];
    for (const balloon of [0, 1]) {
      for (const plane of [0, 1]) {
        if (balloon && plane) continue;
        for (const finish of [0, 1]) {
          for (const pattern of [0, 1]) {
            for (const condensation of [0, 1]) {
              for (const schedule of [0, 1]) {
                variants.push(
                  surface4FragmentFor(
                    balloon,
                    plane,
                    finish,
                    pattern,
                    condensation ? [COND4_SPHERE] : null,
                    schedule,
                    1,
                  ),
                );
              }
            }
          }
        }
      }
    }
    expect(Math.max(...variants.map((src) => src.length))).toBeLessThan(65_536);
  });
});

describe("4D GLSL condensation packing and source", () => {
  it("adds the shared manual atlas sampler only to mesh-bearing condensation source", () => {
    const analytic = surface4FragmentResolvedFor(0, 0, 0, 0, [COND4_SPHERE]);
    expect(analytic).not.toContain("uShapeMeshSdf");
    expect(analytic).not.toContain("shapeMeshSdf(");

    const mesh = surface4FragmentResolvedFor(0, 0, 0, 0, [
      MESH4_SHAPE,
      MESH4_SHAPE,
    ]);
    expect(
      countOccurrences(mesh, "uniform highp sampler3D uShapeMeshSdf;"),
    ).toBe(1);
    expect(countOccurrences(mesh, "texelFetch(uShapeMeshSdf")).toBe(8);
    expect(mesh).toContain("shapeMeshSdf(0, vec3(");
    expect(mesh).toMatch(
      /if \(mesh == 0\) return shapeMeshSdfSample\(p, vec3\([^)]*\), vec3\([^)]*\), [^,]+, 0, 64\);/,
    );
  });

  it("binds a 1^3 R32F placeholder, installs the catalog atlas, and resets it", () => {
    const material = createSurfaceMaterial4();
    const placeholder = material.uniforms.uShapeMeshSdf.value as Data3DTexture;
    expect(placeholder).toBeInstanceOf(Data3DTexture);
    expect(placeholder.image).toMatchObject({ width: 1, height: 1, depth: 1 });
    expect(placeholder.internalFormat).toBe("R32F");
    expect(placeholder.minFilter).toBe(NearestFilter);
    expect(placeholder.magFilter).toBe(NearestFilter);

    const de: SurfaceDE4 = {
      ...de4([map4()]),
      condensation: {
        emitters: [condEmitter4(MESH4_SHAPE, 1, [0, 0, 0, 0])],
        depthBand: { minDepth: 0, maxDepth: 8 },
      },
    };
    setSurfaceSystem4(material, de, [
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const atlas = material.uniforms.uShapeMeshSdf.value as Data3DTexture;
    expect(atlas).not.toBe(placeholder);
    expect(atlas.image).toMatchObject({ width: 64, height: 64, depth: 64 });
    expect(atlas.image.data).toBeInstanceOf(Float32Array);
    expect(atlas.internalFormat).toBe("R32F");
    expect(atlas.minFilter).toBe(NearestFilter);
    expect(atlas.magFilter).toBe(NearestFilter);

    setSurfaceSystem4(material, de4([map4()]), [[0, 0, 0]]);
    expect(material.uniforms.uShapeMeshSdf.value).toBe(placeholder);
    expect(material.uniforms.uShapeMeshSdf.value.image).toMatchObject({
      width: 1,
      height: 1,
      depth: 1,
    });
  });

  it("appends inverse records in the std140 map arrays while recursive and shade counts remain separate", () => {
    const material = createSurfaceMaterial4();
    const de: SurfaceDE4 = {
      ...de4([map4()]),
      condensation: {
        emitters: [
          condEmitter4(COND4_SPHERE, 1, [1, 2, 3, 4]),
          condEmitter4(COND4_BOX, 2, [5, 6, 7, 8]),
          condEmitter4(COND4_SPHERE, 1, [9, 10, 11, 12]),
        ],
        depthBand: { minDepth: 1, maxDepth: 4 },
      },
    };
    setSurfaceSystem4(material, de, [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const u = material.uniforms;
    expect(u.uMapCount.value).toBe(1);
    expect(u.uCondCount.value).toBe(3);
    expect(u.uShadeCount.value).toBe(3);
    expect(u.uCondMinDepth.value).toBe(1);
    expect(u.uCondMaxDepth.value).toBe(4);
    expect(u.uCondShape.value.slice(0, 3)).toEqual([0, 1, 0]);
    expect(u.uCondShade.value.slice(0, 3)).toEqual([1, 2, 1]);
    const block = mapBlock(material);
    expect(Array.from(block.invT.subarray(4, 8))).toEqual([1, 2, 3, 4]);
    expect(Array.from(block.invT.subarray(12, 16))).toEqual([9, 10, 11, 12]);
    expect(Array.from(block.colorSigma.subarray(4, 7))).toEqual([1, 0, 0]);
    expect(Array.from(block.colorSigma.subarray(8, 11))).toEqual([0, 1, 0]);
    expect(block.colorSigma[7]).toBeCloseTo(0.2, 6);

    de.condensation!.depthBand.maxDepth = Number.MAX_SAFE_INTEGER;
    setSurfaceSystem4(material, de, [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(u.uCondMaxDepth.value).toBe(SURFACE_CONDENSATION_GLSL_DEPTH_MAX);
  });

  it("bakes the embedded-solid formula, multiple selectors and all recursive visit hooks", () => {
    const glsl = surface4FragmentFor(0, 0, 0, 0, [
      COND4_SPHERE,
      COND4_BOX,
      COND4_SPHERE,
    ]);
    expect(glsl).toContain("float condensation4Sdf0");
    expect(glsl).toContain("float condensation4Sdf1");
    expect(glsl).not.toContain("condensation4Sdf2");
    expect(glsl).toContain("length(vec2(max(sd, 0.0), local.w))");
    expect(glsl).toContain("scale * 0.9 * uMapColorSigma[slot].w");
    expect(glsl).toContain("condensationFutureAfterChild4");
    expect(glsl.match(/float\s+tKey\s*=\s*c4Key\s*;/g)).toHaveLength(4);
    expect(glsl.match(/eKey\s*=\s*tKey\s*;/g)).toHaveLength(4);
    expect(glsl).toContain("condensationTerm4(img, 1.0, depth).x");
    expect(glsl).toContain(
      "uMapColorSigma[clamp(firstChoice, 0, uShadeCount - 1)].xyz",
    );
    expect(glsl).not.toContain("__SURFACE_CONDENSATION_SDFS__");
    expect(glsl.length).toBeLessThan(SURFACE_GLSL_STRIP_BYTES);
  });

  it("composes with both admitted 4D scene arms", () => {
    const balloon = surface4FragmentFor(1, 0, 0, 0, [COND4_SPHERE]);
    const plane = surface4FragmentFor(0, 1, 0, 0, [COND4_SPHERE]);
    expect(balloon).toContain("balloonInvert");
    expect(balloon).toContain("condensationTerm4");
    expect(plane).toContain("shadeGroundPlane");
    expect(plane).toContain("condensationTerm4");
  });

  it("restores the byte-identical off source and enforces the shared 24-record cap", () => {
    const material = createSurfaceMaterial4();
    const baseline = material.fragmentShader;
    const withCondensation: SurfaceDE4 = {
      ...de4([map4()]),
      condensation: {
        emitters: [condEmitter4(COND4_SPHERE, 1, [0, 0, 0, 0])],
        depthBand: { minDepth: 0, maxDepth: 8 },
      },
    };
    setSurfaceSystem4(material, withCondensation, [
      [0, 0, 0],
      [1, 0, 0],
    ]);
    expect(material.fragmentShader).not.toBe(baseline);
    setSurfaceSystem4(material, de4([map4()]), [[0, 0, 0]]);
    expect(material.fragmentShader).toBe(baseline);
    expect(material.uniforms.uCondCount.value).toBe(0);

    const maps = Array.from({ length: 21 }, (_, baseIndex) =>
      map4({ baseIndex }),
    );
    const overflow: SurfaceDE4 = {
      ...de4(maps),
      condensation: {
        emitters: Array.from({ length: 4 }, (_, i) =>
          condEmitter4(COND4_SPHERE, 21 + i, [i, 0, 0, 0]),
        ),
        depthBand: { minDepth: 0, maxDepth: 8 },
      },
    };
    expect(() =>
      setSurfaceSystem4(
        material,
        overflow,
        Array.from({ length: 25 }, () => [0, 0, 0]),
      ),
    ).toThrow(/condensation records/);
  });
});

describe("setSurfaceSystem4 slot cap", () => {
  it("has room for the 24 maps twentyFourCellFlake brings", () => {
    expect(twentyFourCellFlake()).toHaveLength(24);
    expect(twentyFourCellFlake().length).toBeLessThanOrEqual(SURFACE4_MAX_MAPS);
  });

  it("packs a full 24-map system, last slot included", () => {
    const material = createSurfaceMaterial4();
    const maps = Array.from({ length: 24 }, (_, j) =>
      map4({ sigmaMin: 0.3, baseIndex: j }),
    );
    setSurfaceSystem4(
      material,
      de4(maps),
      maps.map(() => [0.5, 0.5, 0.5]),
      maps.map((_, j) => j / 100),
    );
    expect(material.uniforms.uMapCount.value).toBe(24);
    // Slot 23 is the one the old 16-slot block had no room for.
    expect(mapBlock(material).trap[23 * 4]).toBeCloseTo(0.23, 6);
  });

  it("refuses a 25-map system rather than dropping the surplus silently", () => {
    const material = createSurfaceMaterial4();
    const maps = Array.from({ length: 25 }, () => map4());
    expect(() =>
      setSurfaceSystem4(
        material,
        de4(maps),
        maps.map(() => [0.5, 0.5, 0.5]),
      ),
    ).toThrow(RangeError);
  });
});

describe("setSurfaceSystem4 std140 packing", () => {
  it("transposes each row-major inverse map into its column-major mat4 slot", () => {
    const material = createSurfaceMaterial4();
    const rowMajor = Array.from({ length: 16 }, (_, k) => k);
    setSurfaceSystem4(material, de4([map4({ invM: rowMajor })]), [[0, 0, 0]]);
    expect(Array.from(mapBlock(material).invM.subarray(0, 16))).toEqual([
      0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15,
    ]);
  });

  it("gives each map's inverse translation its own vec4 slot", () => {
    const material = createSurfaceMaterial4();
    setSurfaceSystem4(
      material,
      de4([
        map4({ invT: [0.1, 0.2, 0.3, 0.4] }),
        map4({ invT: [-0.5, -0.6, -0.7, -0.8] }),
      ]),
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
    );
    const { invT } = mapBlock(material);
    expect(
      Array.from(invT.subarray(0, 8)).map((v) => Number(v.toFixed(4))),
    ).toEqual([0.1, 0.2, 0.3, 0.4, -0.5, -0.6, -0.7, -0.8]);
  });

  it("folds each map's contraction factor into its slot's w lane", () => {
    const material = createSurfaceMaterial4();
    setSurfaceSystem4(
      material,
      de4([
        map4({ sigmaMin: 0.11 }),
        map4({ sigmaMin: 0.22 }),
        map4({ sigmaMin: 0.33 }),
      ]),
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    );
    const { colorSigma } = mapBlock(material);
    expect(colorSigma[3]).toBeCloseTo(0.11, 6);
    expect(colorSigma[7]).toBeCloseTo(0.22, 6);
    expect(colorSigma[11]).toBeCloseTo(0.33, 6);
  });

  it("puts each map's color in the xyz lanes of its own slot", () => {
    const material = createSurfaceMaterial4();
    setSurfaceSystem4(material, de4([map4(), map4()]), [
      [1, 0, 0],
      [0, 0.5, 1],
    ]);
    const { colorSigma } = mapBlock(material);
    expect(Array.from(colorSigma.subarray(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(colorSigma.subarray(4, 7))).toEqual([0, 0.5, 1]);
  });

  it("resets a previous system's trap coordinate when the new call omits it", () => {
    const material = createSurfaceMaterial4();
    setSurfaceSystem4(material, de4([map4()]), [[0, 0, 0]], [0.75]);
    setSurfaceSystem4(material, de4([map4()]), [[0, 0, 0]]);
    expect(mapBlock(material).trap[0]).toBe(0);
  });
});

describe("setSurfaceSystem4 kaleidoscope sweep uniforms", () => {
  it("defaults to a single sector and an identity backward step before any system arrives", () => {
    const material = createSurfaceMaterial4();
    expect(material.uniforms.uSymOrder.value).toBe(1);
    const m = material.uniforms.uSymStepBack.value as THREE.Matrix4;
    expect(Array.from(m.elements)).toEqual(IDENTITY4);
  });

  it("packs the DE's order and its row-major backward step column-major, the uFinalInvM convention", () => {
    const material = createSurfaceMaterial4();
    const rowMajor = Array.from({ length: 16 }, (_, k) => k);
    setSurfaceSystem4(
      material,
      de4([map4()], { order: 5, stepBack: rowMajor }),
      [[0, 0, 0]],
    );
    expect(material.uniforms.uSymOrder.value).toBe(5);
    const m = material.uniforms.uSymStepBack.value as THREE.Matrix4;
    expect(Array.from(m.elements)).toEqual([
      0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15,
    ]);
  });

  it("resets a previous system's sectors when the next system has no kaleidoscope", () => {
    const material = createSurfaceMaterial4();
    setSurfaceSystem4(
      material,
      de4([map4()], {
        order: 3,
        stepBack: Array.from({ length: 16 }, (_, k) => k),
      }),
      [[0, 0, 0]],
    );
    setSurfaceSystem4(material, de4([map4()]), [[0, 0, 0]]);
    expect(material.uniforms.uSymOrder.value).toBe(1);
    const m = material.uniforms.uSymStepBack.value as THREE.Matrix4;
    expect(Array.from(m.elements)).toEqual(IDENTITY4);
  });
});

describe("setSurfaceSystem4 radius-band uniforms", () => {
  it("packs the DE's radiusBand into uRadiusCenter4/uRadiusMinD/uRadiusInvRange", () => {
    const material = createSurfaceMaterial4();
    // Every field a different number, like balloonSpec's fixture below —
    // de4()'s own default band (all-zero center, degenerate [0,1] range)
    // would let a packer that crossed two axes, or crossed minD with
    // invRange, pass silently.
    const radiusBand = {
      center: [1.5, -2.25, 3.75, -0.5] as [number, number, number, number],
      minD: 0.2,
      maxD: 4.2,
    };
    setSurfaceSystem4(material, { ...de4([map4()]), radiusBand }, [[0, 0, 0]]);
    const u = material.uniforms;
    const center = u.uRadiusCenter4.value as THREE.Vector4;
    expect([center.x, center.y, center.z, center.w]).toEqual(radiusBand.center);
    expect(u.uRadiusMinD.value).toBe(radiusBand.minD);
    // radiusBandInvRange is the ONE inverse-range definition this packer
    // and the WGSL packer (surface-de-gpu.ts) both read off
    // surface-de-4d.ts — pinning uRadiusInvRange against a direct call to
    // it checks that the derived number was ROUTED to the right uniform
    // (not swapped with minD, not dropped), the same division of labor as
    // surface-de-gpu.test.ts's "round-trips SurfaceDE4.radiusBand" leg;
    // radiusBandInvRange's own arithmetic is pinned independently by
    // surface-de-4d.test.ts's "radiusBandInvRange" describe.
    expect(u.uRadiusInvRange.value).toBe(radiusBandInvRange(radiusBand));
  });
});

describe("slab-hit radius color", () => {
  // The tracer itself is verified by running the app; what is pinned here
  // is the MIRRORING contract with surface-de-gpu.ts's affine4 core: both
  // shading descents report sStar — the deepest level winner's segment
  // parameter — and both radius colors lift through w0 + sStar * halfW,
  // so neither side can drift to the slab's centre plane alone. At
  // uSliceHalfW = 0 segmentS's guard pins sStar to 0 and the lift is the
  // slice plane bit for bit.
  it("lifts the radius color through the descent's sStar — the slab hit's own w", () => {
    const glsl = createSurfaceMaterial4().fragmentShader;
    expect(glsl).toContain("float segmentS(vec4 q, vec4 e)");
    expect(glsl).toContain("sStar = segmentS(c1Q, c1Ext);");
    expect(glsl).toContain(
      "vec4 q4 = uInvRotor * vec4(pos, uW0 + sStar * uSliceHalfW);",
    );
  });
});

describe("the supersampling jitter uniform", () => {
  // The 4D tracer is the PRIMARY arm for kaleidoscope-4D sessions and the
  // fallback for plain-4D ones, so it takes the 3D tracer's jitter line
  // for line — same uniform, same two reads, same untouched backdrop. The
  // scene writes one uniform per armed job and both materials answer to it.
  it("defaults to the pixel CENTRE, so a single-pass 4D trace is the pre-supersampling one", () => {
    const material = createSurfaceMaterial4();
    const jitter = material.uniforms.uPixelJitter.value as THREE.Vector4;
    expect([jitter.x, jitter.y, jitter.z, jitter.w]).toEqual([0, 0, 0, 0]);
  });

  it("enters the ray and the dither, and leaves the backdrop gradient alone", () => {
    const glsl = createSurfaceMaterial4().fragmentShader;
    expect(glsl).toContain("uniform vec4 uPixelJitter;");
    expect(glsl).toContain("(vUv + uPixelJitter.xy) * 2.0 - 1.0");
    expect(glsl).toContain("hash(gl_FragCoord.xy + uPixelJitter.zw)");
    expect(glsl).toContain("mix(uBgBottom, uBgTop, backgroundShapeT(vUv))");
    expect(glsl).toContain("float backgroundShapeT(vec2 p)");
  });
});

/** A balloon payload whose fields are all different numbers, so a packer
 * that crossed two of them fails loudly. */
const balloonSpec = () => ({
  center: [1, 2, 3] as [number, number, number],
  rho: 4,
  R: 5,
  far: 6,
});

/** Non-overlapping occurrence count — the 3D suite's helper, restated. */
function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/** SHA-256 of a source string (the baseline fixture's hash function). */
function sha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

/** The same, for the floor. */
const groundSpec = () => ({
  y: -1.5,
  fadeStart: 3,
  fadeEnd: 9,
  ballCenter: [0.1, 0.2, 0.3] as [number, number, number],
  ballRadius: 1.25,
  albedo: [0.4, 0.5, 0.6] as [number, number, number],
  pattern: 1 as const,
  tileScale: 0.64,
  emission: 1.4,
});

describe("the 4D tracer's variant arms", () => {
  // The arms are resolved JS-side (surface4FragmentFor, which reuses the
  // 3D file's resolver), which is what makes OFF byte-identical to the
  // shipped tracer AND keeps every variant the driver sees far under the
  // Mesa source cliff. MEASURED raw resolved / what the driver gets: off
  // 62765 B (61.3KB) / 62765 B — under the 64KB threshold, so NOT
  // stripped (the finish lanes' two unconditional block members had moved
  // this from 62388 B, the radial backdrop branch before them from 62711
  // B to 62804 B); balloon 69242 B (67.6KB) / 17330 B (16.9KB) (the echo
  // tint had moved this from 68176 B / 17086 B to 69399 B / 17274 B);
  // plane 70527 B (68.9KB) / 18215 B (17.8KB). The assertions below pin
  // the CONTRACT (under threshold, arms present or absent) rather than
  // those figures, which any shader edit moves.
  it("resolves the shipped source verbatim when both arms are off", () => {
    const glsl = surface4FragmentFor();
    expect(glsl).toBe(createSurfaceMaterial4().fragmentShader);
    // Un-stripped: indentation and block comments survive, which is the
    // observable half of "a plain 4D session hands the driver the bytes it
    // always did".
    expect(glsl).toContain("\n  precision highp float;");
    // RESOLVED length, not emitted: emitted stays byte-identical to
    // resolved only below the threshold, so an emitted-length assertion
    // would keep passing even after this arm crossed it and got stripped
    // to a third. Today's figure: 62765 B, 2771 B under the threshold —
    // the tightest margin of any shipped unstripped arm.
    expect(surface4FragmentResolvedFor().length).toBeLessThan(
      SURFACE_GLSL_STRIP_BYTES,
    );
    for (const token of [
      "uBalloonCenter",
      "uBalloonRho",
      "balloonInvert",
      "surfaceDEBalloonHitInfo",
      "surfaceDEFractal",
      "uGroundY",
      "uGroundBallR",
      "shadeGroundPlane",
    ]) {
      expect(glsl).not.toContain(token);
    }
  });

  it("compiles the balloon wrapper over the descent when the balloon is on", () => {
    const glsl = surface4FragmentFor(1, 0);
    expect(glsl).toContain("uniform vec3 uBalloonCenter;");
    expect(glsl).toContain("uniform float uBalloonRho;");
    // The rename that lets the wrapper own the public names.
    expect(glsl).toContain("#define surfaceDE surfaceDEFractal");
    expect(glsl).toContain("#undef surfaceDE");
    expect(glsl).toContain("vec3 balloonInvert(vec3 p, out float scale) {");
    // fractal/balloon-de.ts's invertBalloon, with the f32 centre floor.
    expect(glsl).toContain("float fl = 1.0e-6 * uBalloonRho;");
    expect(glsl).toContain("scale = r / uBalloonRho;");
    // The union and its cutoff scaling (the cutoff contract through the
    // shell term's value factor).
    expect(glsl).toContain(
      "scale * surfaceDEFractal(q, cutoff > 0.0 ? cutoff / scale : 0.0);",
    );
    // The march-entry semantics: no visible-sphere gate, far cap past the
    // balloon centre, every ray from the camera.
    expect(glsl).toContain(
      "float tFar = length(uCamPos - uBalloonCenter) + uBalloonFar;",
    );
    expect(glsl).not.toContain("shadeGroundPlane");
    expect(glsl.length).toBeLessThan(SURFACE_GLSL_STRIP_BYTES);
  });

  it("keeps the 4D hit-info's sStar through the balloon's argmin routing", () => {
    // Six outputs, one more than the 3D wrapper carries: sStar is the
    // slab hit's own place along the query segment, so a SHELL hit's
    // radius colour has to lift through the shell descent's parameter,
    // not the fractal's. Ties go to the fractal (the oracle's attribution
    // convention) — hence the strict dS < dF.
    const glsl = surface4FragmentFor(1, 0);
    expect(glsl).toContain(
      "surfaceDEFractal(q, firstChoice, trap, rings, sheets, sStar);",
    );
    expect(glsl).toContain(
      "return surfaceDEFractal(p, firstChoice, trap, rings, sheets, sStar);",
    );
    expect(glsl).toContain("if (dS < dF) {\ncolorPos = q;");
    // Both position-driven colour sources read the winning term's SOURCE
    // point, the radius one still through the slab lift.
    expect(glsl).toContain(
      "u = clamp(cpos.y / uVisibleRadius * 0.5 + 0.5, 0.0, 1.0);",
    );
    expect(glsl).toContain(
      "vec4 q4 = uInvRotor * vec4(cpos, uW0 + sStar * uSliceHalfW);",
    );
  });

  it("shadows the balloon from the fractal alone — the shell never casts", () => {
    const glsl = surface4FragmentFor(1, 0);
    expect(glsl).toContain(
      "vec3 sp = pos + n * h * 2.0 + uLightDir * ts;\nfloat d = surfaceDEFractal(sp);",
    );
  });

  it("compiles the floor and its two analytic ball certificates when the plane is on", () => {
    const glsl = surface4FragmentFor(0, 1);
    expect(glsl).toContain("uniform float uGroundY;");
    expect(glsl).toContain("uniform vec3 uGroundAlbedo;");
    expect(glsl).toContain(
      "vec3 shadeGroundPlane(\nvec3 ro,\nvec3 rd,\nvec3 background,\nout float cov,\nout float layerCoverage,\nout float layerFog,\nout float layerDepth\n) {",
    );
    // One-sided, radially faded, and the two gates that make an infinite
    // floor affordable (shadow corridor, AO reach).
    expect(glsl).toContain("if (ro.y <= uGroundY || rd.y >= -1.0e-6) {");
    expect(glsl).toContain(
      "1.0 - smoothstep(uGroundFadeStart, uGroundFadeEnd, length(rel));",
    );
    expect(glsl).toContain(
      "float corridor = uGroundBallR * 1.05 + 0.3 * along;",
    );
    expect(glsl).toContain(
      "float reach = uGroundBallR * (1.02 + 0.04 * float(uAoTaps));",
    );
    // The taps run the 4D value overload — there is no probe descent here.
    expect(glsl).toContain(
      "clamp((hh - surfaceDE(hp + vec3(0.0, hh, 0.0))) / hh, 0.0, 1.0);",
    );
    expect(glsl).not.toContain("balloonInvert");
    expect(glsl.length).toBeLessThan(SURFACE_GLSL_STRIP_BYTES);
  });

  it("planes a sphere-exit miss and never an exhausted ray", () => {
    // The 4D main() had no such split before the floor's 4D lift — with
    // no floor, both outcomes painted the same backdrop. A
    // budget-exhausted ray resolved no geometry, so planing it would
    // paint floor straight through the object it ran out of steps inside.
    const glsl = surface4FragmentFor(0, 1);
    expect(glsl).toContain(
      [
        "if (!hit) {",
        "if (t > tFar) {",
        "float planeCovMiss;",
        "float planeLayerCoverageMiss;",
        "float planeLayerFogMiss;",
        "float planeLayerDepthMiss;",
        "outColor = vec4(",
        "shadeGroundPlane(",
        "ro,",
        "rd,",
        "background,",
        "planeCovMiss,",
        "planeLayerCoverageMiss,",
        "planeLayerFogMiss,",
        "planeLayerDepthMiss",
        "),",
        "planeCovMiss",
        ");",
        "outTraceLayer = traceLayer(",
        "planeLayerCoverageMiss,",
        "planeLayerFogMiss,",
        "planeLayerDepthMiss",
        ");",
        "return;",
        "}",
        "outColor = vec4(background, 0.5);",
        "outTraceLayer = traceLayer(0.0, 0.0, 0.0);",
      ].join("\n"),
    );
  });

  it("lands the two pre-march misses on the floor too", () => {
    const glsl = surface4FragmentFor(0, 1);
    expect(glsl).toContain(
      "if (disc < 0.0) {\nfloat planeCov;\nfloat planeLayerCoverage;\nfloat planeLayerFog;\nfloat planeLayerDepth;\noutColor = vec4(\nshadeGroundPlane(",
    );
    expect(glsl).toContain("if (tFar <= 0.0) {\nfloat planeCovExit;");
  });

  it("refuses a floor inside the shell — there is no horizon in there", () => {
    expect(() => surface4FragmentFor(1, 1)).toThrow(RangeError);
  });

  it("emits the 3D and 4D envTint helpers character for character, which is what keeps the mirror from drifting", () => {
    // The 3D and 4D tracers each declare their own envTint (GLSL needs
    // declaration before use in each source, so it cannot be shared as
    // one function) — this pin is what stands in for that sharing.
    // Whitespace is normalized before comparing: the 3D "off" variant
    // strips (its raw source is over the Mesa size threshold) while the
    // 4D "off" variant does not, so the token stream is what must agree,
    // not the indentation.
    const body = (src: string): string => {
      const match = src.match(/vec3 envTint\(vec3 n\) \{[\s\S]*?\n\s*\}/);
      expect(match).not.toBeNull();
      return match![0].replace(/\s+/g, " ").trim();
    };
    const glsl3d = body(surfaceFragmentFor(0, 0));
    const glsl4d = body(surface4FragmentFor());
    expect(glsl3d).toBe(glsl4d);
    expect(glsl3d).toContain(
      "return mix(vec3(1.0), e / max(max(e.r, max(e.g, e.b)), 1.0e-4), uEnvLight);",
    );
  });

  it("packs the echo tint's uniforms and the shell-gated base-albedo mix when the balloon is on", () => {
    const glsl = surface4FragmentFor(1, 0);
    expect(glsl).toContain("uniform vec3 uBalloonTint;");
    expect(glsl).toContain("uniform float uBalloonTintStrength;");
    // Gated on shell, and on the BASE ALBEDO — the same line the 3D arm
    // emits, character for character (see the cross-file pin below).
    expect(glsl).toContain(
      "base = mix(base, uBalloonTint, uBalloonTintStrength * shell);",
    );
    expect(glsl.length).toBeLessThan(SURFACE_GLSL_STRIP_BYTES);
  });

  it("pays nothing for the echo tint while the balloon is off", () => {
    // uBalloonTint/uBalloonTintStrength both carry the uBalloonCenter etc.
    // prefix the "resolves the shipped source verbatim" test above already
    // nets for the off/off case; this pins the tint's own tokens
    // independently, and across the plane arm too (the balloon's only
    // other neighbor), so a future narrowing of that wider check cannot
    // silently stop covering this one.
    for (const glsl of [surface4FragmentFor(), surface4FragmentFor(0, 1)]) {
      expect(glsl).not.toContain("uBalloonTint");
      expect(glsl).not.toContain("uBalloonTintStrength");
      expect(glsl).not.toContain("uBalloonColorLUT");
      expect(glsl).not.toContain("uBalloonPaletteEnabled");
      expect(glsl).not.toContain("balloonIndex");
      expect(glsl).not.toContain("* shell");
    }
  });

  it("surfaceDEBalloonHitInfo reports shell 1.0 on the inverted term and 0.0 on the fractal term/tie, right after colorPos, with sStar staying the trailing output", () => {
    // The balloon arm always resolves over the 64KB strip threshold here
    // (module doc: raw ~68KB), so this pin — unlike 3D's escape+balloon
    // combo — reads the STRIPPED (indentation-free) token stream.
    const glsl = surface4FragmentFor(1, 0);
    expect(glsl).toContain(
      "vec3 p,\nout vec3 colorPos,\nout float shell,\nout int firstChoice,",
    );
    expect(glsl).toContain("out float sheets,\nout float sStar\n) {");
    expect(glsl).toContain("if (dS < dF) {\ncolorPos = q;\nshell = 1.0;");
    expect(glsl).toContain(
      "colorPos = p;\nshell = 0.0;\nreturn surfaceDEFractal(p, firstChoice, trap, rings, sheets, sStar);",
    );
  });

  it("emits the same balloon tint mix line in both dimensions, character for character", () => {
    // The bulbPow8 drift-prevention idiom (surface-material.test.ts), one
    // feature over: both mirrors read shell and uBalloonTint the same way,
    // so a one-sided edit to either fails here rather than in a browser.
    const line =
      "base = mix(base, uBalloonTint, uBalloonTintStrength * shell);";
    expect(surfaceFragmentFor(0, 0, 1)).toContain(line);
    expect(surface4FragmentFor(1, 0)).toContain(line);
  });

  it("mirrors the 3D shell-only palette lookup exactly, including the pre-inversion cpos/rho coordinate and palette-before-tint order", () => {
    const paletteBlock = (src: string): string => {
      const match = src.match(
        /if \(uBalloonPaletteEnabled > 0\.5 && shell > 0\.5\) \{[\s\S]*?\n\s*\}/,
      );
      expect(match).not.toBeNull();
      return match![0].replace(/\s+/g, " ").trim();
    };
    const three = surfaceFragmentResolvedFor(0, 0, 1);
    const four = surface4FragmentResolvedFor(1, 0);
    expect(paletteBlock(four)).toBe(paletteBlock(three));
    expect(paletteBlock(four)).toContain(
      "length(cpos - uBalloonCenter) / uBalloonRho, 0.0, 1.0",
    );
    expect(paletteBlock(four)).toContain("min(floor(balloonU * 256.0), 255.0)");
    expect(four.indexOf("uBalloonColorLUT,")).toBeLessThan(
      four.indexOf(
        "base = mix(base, uBalloonTint, uBalloonTintStrength * shell);",
      ),
    );
  });
});

describe("compile-gated finite tiling in the 4D GLSL tracer", () => {
  const f4 = resolveTiling({ group: "f4" })!;
  const clippedF4 = resolveTiling({ group: "f4", clip: COND4_SPHERE })!;

  const sourceFor = (
    tiling: ResolvedTiling,
    {
      plane = 0,
      finish = 0,
      pattern = 0,
      condensation = null,
      schedule = 0,
      chaos = 0,
    }: {
      plane?: number;
      finish?: number;
      pattern?: number;
      condensation?: readonly ShapeSpec[] | null;
      schedule?: number;
      chaos?: number;
    } = {},
  ): string =>
    surface4FragmentResolvedFor(
      0,
      plane,
      finish,
      pattern,
      condensation,
      schedule,
      chaos,
      tiling,
    );

  it("keeps an absent block byte-identical across every pre-existing legal arm", () => {
    const variants: Parameters<typeof surface4FragmentResolvedFor>[] = [
      [],
      [0, 1],
      [0, 0, 1, 1],
      [0, 1, 1, 1, [COND4_SPHERE], 1, 1],
    ];
    for (const args of variants) {
      const [balloon, plane, finish, pattern, condensation, schedule, chaos] =
        args;
      expect(surface4FragmentResolvedFor(...args)).toBe(
        surface4FragmentResolvedFor(
          balloon,
          plane,
          finish,
          pattern,
          condensation,
          schedule,
          chaos,
          null,
        ),
      );
    }
  });

  it("folds the true vec4 query before the untouched sliced core and clips in folded xyz", () => {
    const source = sourceFor(clippedF4);
    expect(source).toContain("vec4 surfaceTilingQuery4;");
    expect(source.indexOf("precision highp float;")).toBeLessThan(
      source.indexOf("vec4 surfaceTilingQuery4;"),
    );
    expect(source).toContain("TilingFoldResult tilingFold(vec4 pIn)");
    expect(source).toContain(
      "TilingFoldResult folded = tilingFold(uInvRotor * vec4(p, uW0));",
    );
    expect(source).toContain("vec4 q = surfaceTilingQuery4;");
    expect(source).toContain("float inner = surfaceDETilingCore(p, cutoff);");
    expect(source).toContain("return max(inner, tilingClipSdf(q.xyz));");
    expect(source).toContain("uTilingGroup != 6 || uSliceHalfW > 0.0");
    expect(sourceFor(f4)).not.toContain("tilingClipSdf");
  });

  it("attributes 4D height, radius and pattern to the folded query while retaining visible world-space finish", () => {
    const source = sourceFor(f4, { finish: 1, pattern: 1 });
    expect(source).toContain(
      "(transpose(uInvRotor) * surfaceTilingHitPoint).y / uVisibleRadius",
    );
    expect(source).toContain("vec4 q4 = surfaceTilingHitPoint;");
    expect(source).toContain("vec4 patternLifted = surfaceTilingHitPoint;");
    expect(source).toContain("finishShade(base, pos, n, rd");
  });

  it("source-generates every legal 4D group and orthogonal variant", () => {
    for (const group of TILING_GROUPS.slice(3)) {
      const source = sourceFor(resolveTiling({ group })!);
      expect(source).toContain("TilingFoldResult tilingFold(vec4 pIn)");
    }
    const variants = [
      sourceFor(f4, { plane: 1 }),
      sourceFor(f4, { finish: 1, pattern: 1 }),
      sourceFor(f4, {
        condensation: [COND4_SPHERE],
        schedule: 1,
        chaos: 1,
      }),
    ];
    for (const source of variants) {
      expect(source).toContain("surfaceDETilingCore");
      expect(source).toContain("surfaceTilingHitPoint");
    }
  });

  it("emits all 128 legal 4D option combinations below the source ceiling", () => {
    let count = 0;
    for (const clip of [null, COND4_SPHERE] as const) {
      const tiling = resolveTiling({
        group: "f4",
        ...(clip ? { clip } : {}),
      })!;
      for (const plane of [0, 1])
        for (const finish of [0, 1])
          for (const pattern of [0, 1])
            for (const condensation of [0, 1])
              for (const schedule of [0, 1])
                for (const chaos of [0, 1]) {
                  const source = surface4FragmentFor(
                    0,
                    plane,
                    finish,
                    pattern,
                    condensation ? [COND4_SPHERE] : null,
                    schedule,
                    chaos,
                    tiling,
                  );
                  expect(source.length).toBeLessThan(SURFACE_GLSL_STRIP_BYTES);
                  count++;
                }
    }
    expect(count).toBe(128);
  });

  it("defensively rejects wrong-dimensional, forged, mesh, and balloon pairings", () => {
    for (const group of TILING_GROUPS.slice(0, 3)) {
      expect(() => sourceFor(resolveTiling({ group })!)).toThrow(/3D.*4D/);
    }
    const forged = {
      ...f4,
      info: { ...TILING_GROUP_INFO.f4 },
    };
    expect(() => sourceFor(forged)).toThrow(/canonical frozen group info/);
    expect(() =>
      sourceFor(resolveTiling({ group: "f4", clip: MESH4_SHAPE })!),
    ).toThrow(/mesh clips are refused/);
    expect(() =>
      surface4FragmentResolvedFor(1, 0, 0, 0, null, 0, 0, f4),
    ).toThrow(/cannot compile into the balloon variant/);
  });

  it("installs one live group word and refuses kaleidoscope, slab, and balloon", () => {
    const material = createSurfaceMaterial4();
    setSurfaceSystem4(material, de4([map4()]), [[0, 0, 0]], undefined, f4);
    expect(materialSurfaceTiling(material, true)).toBe(f4);
    expect(material.uniforms.uTilingGroup.value).toBe(6);
    expect(material.defines.SURFACE4_TILING).toBe(1);
    expect(material.fragmentShader).toContain("surfaceTilingFold");

    setSurface4GroundPlane(material, groundSpec());
    expect(materialSurfaceTiling(material, true)).toBe(f4);
    expect(material.fragmentShader).toContain("surfaceTilingFold");
    expect(material.fragmentShader).toContain("shadeGroundPlane");
    setSurface4GroundPlane(material, null);
    expect(() => setSurfaceView4(material, IDENTITY4, 0.25, 0)).not.toThrow();

    const version = material.version;
    setSurfaceSystem4(material, de4([map4()]), [[0, 0, 0]], undefined, f4);
    expect(material.version).toBe(version);
    expect(() =>
      setSurfaceSystem4(
        material,
        de4([map4()], { order: 3, stepBack: IDENTITY4 }),
        [[0, 0, 0]],
        undefined,
        f4,
      ),
    ).toThrow(/cannot compose with kaleidoscope/);
    expect(() => setSurfaceView4(material, IDENTITY4, 0, 0.1)).toThrow(
      /cannot compose with a 4D slab/,
    );
    expect(() => setSurface4Balloon(material, balloonSpec())).toThrow(
      /cannot compose with balloon/,
    );

    setSurfaceSystem4(material, de4([map4()]), [[0, 0, 0]], undefined, null);
    expect(materialSurfaceTiling(material, true)).toBeNull();
    expect(material.uniforms.uTilingGroup.value).toBe(0);
    expect(material.defines.SURFACE4_TILING).toBeUndefined();
    expect(material.fragmentShader).not.toContain("surfaceTilingFold");
  });
});

describe("setSurfaceView4", () => {
  it("sets uInvRotor to the inverse of a non-identity world rotor — pinned against rotor4.ts's own math, not the packer's transpose", () => {
    const material = createSurfaceMaterial4();
    // A single-plane SO(4) rotation's inverse is the SAME plane rotated
    // by the NEGATIVE angle — group closure (R(angle) . R(-angle) =
    // R(0) = identity) makes rotorMatrix(R(-angle)) the exact matrix
    // inverse of rotorMatrix(R(angle)), and since both are orthogonal
    // that inverse is also the transpose setSurfaceView4 is documented to
    // compute. So this is an independent route to the expected matrix —
    // it never transposes anything — rather than checking the packer's
    // own column-reordered transpose against itself. Non-identity so a
    // wrong row/column swap can't hide behind identity's symmetry, the
    // uInvRotor counterpart of the per-map "transposes each row-major
    // inverse map…" test above.
    const angle = Math.PI / 6;
    const rotor = rotorMatrix(rotateInPlane(identityRotorPair(), "xw", angle));
    const expectedInv = rotorMatrix(
      rotateInPlane(identityRotorPair(), "xw", -angle),
    );
    setSurfaceView4(material, rotor, 0, 0);
    const invRotor = material.uniforms.uInvRotor.value as THREE.Matrix4;
    rowMajorOf(invRotor).forEach((v, i) =>
      expect(v).toBeCloseTo(expectedInv[i], 9),
    );
  });

  it("uploads w0 and sliceHalfW verbatim — the normalized-slider-to-world wSupport conversion is scene.ts's setSurface4View, upstream of this packer", () => {
    const material = createSurfaceMaterial4();
    setSurfaceView4(material, IDENTITY4, 0.62, 0.17);
    expect(material.uniforms.uW0.value).toBe(0.62);
    expect(material.uniforms.uSliceHalfW.value).toBe(0.17);
  });
});

describe("setSurface4Balloon", () => {
  it("packs the spec and compiles the arm in", () => {
    const material = createSurfaceMaterial4();
    setSurface4Balloon(material, balloonSpec());
    const center = material.uniforms.uBalloonCenter.value as THREE.Vector3;
    expect([center.x, center.y, center.z]).toEqual([1, 2, 3]);
    expect(material.uniforms.uBalloonR.value).toBe(5);
    expect(material.uniforms.uBalloonRho.value).toBe(4);
    expect(material.uniforms.uBalloonFar.value).toBe(6);
    expect(material.defines.SURFACE4_BALLOON).toBe(1);
    expect(material.fragmentShader).toContain("balloonInvert");
  });

  it("resets to the inert off state on null, rho included", () => {
    const material = createSurfaceMaterial4();
    setSurface4Balloon(material, balloonSpec());
    setSurface4Balloon(material, null);
    const center = material.uniforms.uBalloonCenter.value as THREE.Vector3;
    expect([center.x, center.y, center.z]).toEqual([0, 0, 0]);
    expect(material.uniforms.uBalloonR.value).toBe(0);
    // 1, not 0: a stray enabled read must never divide by zero.
    expect(material.uniforms.uBalloonRho.value).toBe(1);
    expect(material.uniforms.uBalloonFar.value).toBe(0);
    expect(material.defines.SURFACE4_BALLOON).toBe(0);
    expect(material.fragmentShader).not.toContain("uBalloonCenter");
  });

  it("rebuilds the program only when the arm moves, never on a radius drag", () => {
    // The radius slider writes uniforms per tick; a program rebuild per
    // tick would be a recompile per tick.
    const material = createSurfaceMaterial4();
    setSurface4Balloon(material, balloonSpec());
    const version = material.version;
    setSurface4Balloon(material, { ...balloonSpec(), R: 9 });
    expect(material.uniforms.uBalloonR.value).toBe(9);
    expect(material.version).toBe(version);
    setSurface4Balloon(material, null);
    expect(material.version).toBeGreaterThan(version);
  });

  it("packSurfaceBalloonTint (surface-material.ts) packs this material's uniforms too — one helper, both dimensions", () => {
    // No 4D-local pack helper exists: this material declares the same
    // uBalloonTint/uBalloonTintStrength names as the 3D one, the
    // established direction of reuse this module already runs the other
    // way (surfaceFragmentFor, SurfaceBalloonSpec, both imported above).
    const material = createSurfaceMaterial4();
    packSurfaceBalloonTint(material, [0.2, 0.4, 0.6], 0.75);
    const tint = material.uniforms.uBalloonTint.value as THREE.Vector3;
    expect([tint.x, tint.y, tint.z]).toEqual([0.2, 0.4, 0.6]);
    expect(material.uniforms.uBalloonTintStrength.value).toBe(0.75);
  });

  it("packSurfaceBalloonTint never touches the shader on this material either", () => {
    const material = createSurfaceMaterial4();
    setSurface4Balloon(material, balloonSpec());
    const version = material.version;

    packSurfaceBalloonTint(material, [1, 0, 0], 0.5);

    expect(material.version).toBe(version);
  });

  it("shares packSurfaceBalloonPalette's explicit-inherit uniform contract without touching the 4D shader", () => {
    const material = createSurfaceMaterial4();
    const primary = material.uniforms.uColorLUT.value;
    const texture = new DataTexture(new Uint8Array(4), 1, 1);
    const shader = material.fragmentShader;
    const version = material.version;

    packSurfaceBalloonPalette(material, texture);
    expect(material.uniforms.uBalloonColorLUT.value).toBe(texture);
    expect(material.uniforms.uBalloonPaletteEnabled.value).toBe(1);
    expect(material.uniforms.uColorLUT.value).toBe(primary);

    packSurfaceBalloonPalette(material, null);
    expect(material.uniforms.uBalloonPaletteEnabled.value).toBe(0);
    expect(material.uniforms.uBalloonColorLUT.value).toBe(texture);
    expect(material.fragmentShader).toBe(shader);
    expect(material.version).toBe(version);
  });
});

describe("setSurface4GroundPlane", () => {
  it("packs the spec and compiles the arm in", () => {
    const material = createSurfaceMaterial4();
    setSurface4GroundPlane(material, groundSpec());
    const u = material.uniforms;
    expect(u.uGroundY.value).toBe(-1.5);
    expect(u.uGroundFadeStart.value).toBe(3);
    expect(u.uGroundFadeEnd.value).toBe(9);
    expect(u.uGroundBallR.value).toBe(1.25);
    const ball = u.uGroundBallC.value as THREE.Vector3;
    expect([ball.x, ball.y, ball.z]).toEqual([0.1, 0.2, 0.3]);
    const albedo = u.uGroundAlbedo.value as THREE.Vector3;
    expect([albedo.x, albedo.y, albedo.z]).toEqual([0.4, 0.5, 0.6]);
    expect(u.uGroundPattern.value).toBe(1);
    expect(u.uGroundTileScale.value).toBe(0.64);
    expect(u.uGroundEmission.value).toBe(1.4);
    expect(material.defines.SURFACE4_GROUND_PLANE).toBe(1);
    expect(material.fragmentShader).toContain("shadeGroundPlane");
  });

  it("resets to the inert off state on null, ball radius and albedo included", () => {
    const material = createSurfaceMaterial4();
    setSurface4GroundPlane(material, groundSpec());
    setSurface4GroundPlane(material, null);
    const u = material.uniforms;
    expect(u.uGroundY.value).toBe(0);
    expect(u.uGroundFadeStart.value).toBe(0);
    expect(u.uGroundFadeEnd.value).toBe(0);
    // 1 and white, not zeros: a stray enabled read must never divide by
    // zero or paint a black band.
    expect(u.uGroundBallR.value).toBe(1);
    const albedo = u.uGroundAlbedo.value as THREE.Vector3;
    expect([albedo.x, albedo.y, albedo.z]).toEqual([1, 1, 1]);
    expect(u.uGroundPattern.value).toBe(0);
    expect(u.uGroundTileScale.value).toBe(0.64);
    expect(u.uGroundEmission.value).toBe(0);
    expect(material.defines.SURFACE4_GROUND_PLANE).toBe(0);
    expect(material.fragmentShader).not.toContain("uGroundY");
  });

  it("rebuilds the program only when the arm moves", () => {
    const material = createSurfaceMaterial4();
    setSurface4GroundPlane(material, groundSpec());
    const version = material.version;
    setSurface4GroundPlane(material, { ...groundSpec(), y: -4 });
    expect(material.uniforms.uGroundY.value).toBe(-4);
    expect(material.version).toBe(version);
  });
});

describe("balloon seniority over the floor", () => {
  it("drops a live floor when the balloon comes on", () => {
    const material = createSurfaceMaterial4();
    setSurface4GroundPlane(material, groundSpec());
    expect(material.defines.SURFACE4_GROUND_PLANE).toBe(1);
    setSurface4Balloon(material, balloonSpec());
    expect(material.defines.SURFACE4_BALLOON).toBe(1);
    expect(material.defines.SURFACE4_GROUND_PLANE).toBe(0);
    expect(material.fragmentShader).not.toContain("shadeGroundPlane");
  });

  it("refuses a floor over a live balloon without moving any state", () => {
    const material = createSurfaceMaterial4();
    setSurface4Balloon(material, balloonSpec());
    const version = material.version;
    expect(() => setSurface4GroundPlane(material, groundSpec())).toThrow(
      RangeError,
    );
    expect(material.defines.SURFACE4_GROUND_PLANE).toBe(0);
    expect(material.uniforms.uGroundBallR.value).toBe(1);
    expect(material.version).toBe(version);
    expect(material.fragmentShader).toContain("balloonInvert");
  });
});

describe("the 4D trace alpha statuses", () => {
  it("keeps miss, exhausted, and covered distinct without changing RGB", () => {
    const shader = surface4FragmentResolvedFor(0, 0, 0, 0);
    const terminal = shader.slice(shader.indexOf("if (!hit)"));
    expect(terminal).toContain("if (t > tFar) {");
    expect(terminal).toContain("outColor = vec4(background, 0.0);");
    expect(terminal).toContain("outColor = vec4(background, 0.5);");
    expect(shader).toContain("outColor = vec4(col, 1.0);");
  });

  it("keeps exhausted distinct when a sphere-exit miss can become a plane", () => {
    const shader = surface4FragmentResolvedFor(0, 1, 0, 0);
    expect(shader).toMatch(
      /shadeGroundPlane\(\s*ro,\s*rd,\s*background,\s*planeCovMiss,\s*planeLayerCoverageMiss,\s*planeLayerFogMiss,\s*planeLayerDepthMiss\s*\)/,
    );
    expect(shader).toContain("outColor = vec4(background, 0.5);");
  });

  it("mirrors the 3D coverage, fog, backdrop weight, and signed-CoC sidecar", () => {
    const shader = surface4FragmentResolvedFor(0, 1, 0, 0);
    const focus = createSurfaceMaterial4().uniforms.uFocusPlane.value;
    expect(focus.toArray()).toEqual([0, 0, -1, 1]);
    expect(shader).toContain("layout(location = 0) out vec4 outColor;");
    expect(shader).toContain("layout(location = 1) out vec4 outTraceLayer;");
    expect(shader).toContain(
      [
        "float beta = 1.0 - coverage +",
        "      coverage * fog * (1.0 - uFogTintStrength);",
        "    float coc = coverage > 0.0",
        "      ? clamp(",
        "          (cameraDepth - uFocusPlane.w) / max(uVisibleRadius, 1.0e-6),",
        "          -1.0,",
        "          1.0",
        "        )",
        "      : 1.0;",
        "    float cocCode = (128.0 + 127.0 * coc) / 255.0;",
        "    return vec4(coverage, fog, beta, cocCode);",
      ].join("\n"),
    );
    expect(shader).toContain("layerCoverage = 0.0;");
    expect(shader).toContain("layerFog = 0.0;");
    expect(shader).toContain("layerDepth = 0.0;");
    expect(shader).toContain("cov = 1.0;\n    layerCoverage = fade;");
    expect(shader).toContain("layerDepth = dot(hp - ro, uFocusPlane.xyz);");
    expect(shader).toContain("layerFog = clamp(fog, 0.0, 1.0);");
    expect(shader).toMatch(
      /outTraceLayer = traceLayer\(\s*planeLayerCoverageMiss,\s*planeLayerFogMiss,\s*planeLayerDepthMiss\s*\);/,
    );
    expect(shader).toContain("outTraceLayer = traceLayer(0.0, 0.0, 0.0);");
    expect(shader).toMatch(
      /outTraceLayer = traceLayer\(\s*1\.0,\s*clamp\(fog, 0\.0, 1\.0\),\s*dot\(pos - ro, uFocusPlane\.xyz\)\s*\);/,
    );
    for (const [name, source] of [
      ["plain", surface4FragmentResolvedFor(0, 0, 0, 0)],
      ["balloon", surface4FragmentResolvedFor(1, 0, 0, 0)],
      ["ground", shader],
    ] as const) {
      expect(countOccurrences(source, "outTraceLayer ="), name).toBe(
        countOccurrences(source, "outColor ="),
      );
    }
  });
});

describe("the 4D tracer's finish arm", () => {
  const fetchLine =
    "vec3 col = finishShade(base, pos, n, rd, shadow, ao, background, uMapFinishA[fSlot], uMapFinishB[fSlot]);";

  /** Every field away from classic and every field a different number, so
   * a lane landing one float off in the std140 block is visible. */
  const authored = resolveSurfaceFinish({
    specular: 0.9,
    shininess: 64,
    metalness: 0.3,
    reflect: 0.5,
    transmit: 0.2,
  });
  const finishMaterials = (
    finishes: readonly (typeof authored)[],
  ): SurfaceMaterialSlots => ({
    slots: finishes.map((finish) => ({
      finish,
      pattern: CLASSIC_SURFACE_MATERIAL.pattern,
    })),
    finish: true,
    pattern: false,
  });
  const calibration = {
    ringsLow: 0.1,
    ringsInvSpan: 2,
    sheetsLow: 0.2,
    sheetsInvSpan: 3,
  };
  const patternMaterials = (finish = false): SurfaceMaterialSlots => ({
    slots: [
      resolveSurfaceMaterial(finish ? authored : undefined, {
        kind: "marble",
        axis: "x",
        scale: 3.1256,
        strength: 0.625,
      }),
    ],
    finish,
    pattern: true,
    patternCalibration: calibration,
  });

  it("declares the finish lanes as the block's two trailing members UNCONDITIONALLY, read only under the arm", () => {
    // The block's member list is the std140 layout contract with the
    // UniformsGroup, so the lanes must be there whether or not the arm
    // is compiled — a member that came and went with the define would
    // move every offset three derives from the group's order on each
    // toggle. Off: declared, never read (finishShade absent). On: read.
    for (const [balloon, plane] of [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as const) {
      const off = surface4FragmentFor(balloon, plane, 0);
      expect(off).toContain("vec4 uMapFinishA[MAX_MAPS];");
      expect(off).toContain("vec4 uMapFinishB[MAX_MAPS];");
      expect(off).not.toContain("finishShade");
      expect(off).not.toContain("uMapFinishA[fSlot]");
      expect(off).not.toContain("SURFACE_FINISH");
      // Omitted means explicit 0, resolved and emitted alike.
      expect(surface4FragmentFor(balloon, plane)).toBe(off);
      expect(surface4FragmentResolvedFor(balloon, plane)).toBe(
        surface4FragmentResolvedFor(balloon, plane, 0),
      );
      // The members are the block's LAST two, in A-then-B order — the
      // order the group appends its backing arrays in.
      const block = off.match(
        /layout\(std140\) uniform SurfaceMaps4 \{[\s\S]*?\n\s*\};/,
      );
      expect(block).not.toBeNull();
      const members = block![0]
        .split("\n")
        .filter((line) => /^\s*(mat4|vec4) u/.test(line))
        .map((line) => line.trim());
      expect(members).toEqual([
        "mat4 uInvM[MAX_MAPS];",
        "vec4 uInvT[MAX_MAPS];",
        "vec4 uMapColorSigma[MAX_MAPS];",
        "vec4 uMapTrap[MAX_MAPS];",
        "vec4 uMapFinishA[MAX_MAPS];",
        "vec4 uMapFinishB[MAX_MAPS];",
      ]);
    }
  });

  it("compiles exactly one finishShade and the 3D tracer's fetch line, character for character, into every 4D variant with the arm on", () => {
    for (const [balloon, plane] of [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as const) {
      const resolved = surface4FragmentResolvedFor(balloon, plane, 1);
      expect(
        countOccurrences(
          resolved,
          "vec3 finishShade(vec3 base, vec3 pos, vec3 n, vec3 rd, float shadow, float ao, vec3 bg, vec4 fa, vec4 fb) {",
        ),
      ).toBe(1);
      expect(resolved).toContain(
        "int fSlot = clamp(firstChoice, 0, uMapCount - 1);",
      );
      expect(countOccurrences(resolved, fetchLine)).toBe(1);
      expect(resolved).not.toContain("#if SURFACE_FINISH");
      // The fixed formula was resolved away with the #else.
      expect(resolved).not.toContain("32.0) * 0.4;");
    }
    // Cross-dimension parity: the 3D tracer emits the identical fetch
    // line (both tracers name the pixel backdrop `background`).
    expect(surfaceFragmentResolvedFor(0, 0, 0, 0, 0, 1)).toContain(fetchLine);
    // And the identical finishShade body — one template in
    // surface-finish.ts, spliced into both.
    const body = (src: string): string => {
      const match = src.match(/vec3 finishShade\([\s\S]*?\n\s*\}/);
      expect(match).not.toBeNull();
      return match![0].replace(/\s+/g, " ").trim();
    };
    // Both RESOLVED: the 3D base arm strips (its body comment would go),
    // the 4D one does not.
    expect(body(surface4FragmentResolvedFor(0, 0, 1))).toBe(
      body(surfaceFragmentResolvedFor(0, 0, 0, 0, 0, 1)),
    );
    // The plane-over-balloon refusal holds with the finish on.
    expect(() => surface4FragmentFor(1, 1, 1)).toThrow(RangeError);
  });

  it("keeps the plain 4D arm under the strip threshold with the finish on — this file's tightest margin", () => {
    // Current recorded material baseline: 63878 B resolved, 1658 B under.
    // The patterned 4D plain arm intentionally crosses and strips; this
    // finish-only arm remains the tightest unstripped material pairing.
    expect(surface4FragmentResolvedFor(0, 0, 1).length).toBeLessThan(
      SURFACE_GLSL_STRIP_BYTES,
    );
    expect(surface4FragmentFor(0, 0, 1)).toContain(
      "\n  precision highp float;",
    );
    expect(surface4FragmentResolvedFor(1, 0, 1).length).toBeGreaterThan(
      SURFACE_GLSL_STRIP_BYTES,
    );
    expect(surface4FragmentFor(1, 0, 1)).not.toContain("//");
  });

  it("backs the block's two new members with classic-lane placeholders, in the group's last two slots", () => {
    const material = createSurfaceMaterial4();
    expect(material.defines.SURFACE4_FINISH).toBe(0);
    const group = material.uniformsGroups[0];
    expect(group.uniforms).toHaveLength(6);
    const maps = mapBlock(material);
    expect(maps.finishA).toHaveLength(SURFACE4_MAX_MAPS * 4);
    expect(maps.finishB).toHaveLength(SURFACE4_MAX_MAPS * 4);
    const classic = surfaceMaterialLanes(CLASSIC_SURFACE_MATERIAL);
    for (let j = 0; j < SURFACE4_MAX_MAPS; j++) {
      expect(maps.finishA.subarray(j * 4, j * 4 + 4)).toEqual(
        new Float32Array(classic.a),
      );
      expect(maps.finishB.subarray(j * 4, j * 4 + 4)).toEqual(
        new Float32Array(classic.b),
      );
    }
  });

  it("setSurface4Materials writes finish-only slots into the block at j * 4, resets the rest, flips the finish gate and recompiles", () => {
    const material = createSurfaceMaterial4();
    const versionBefore = material.version;
    setSurface4Materials(
      material,
      finishMaterials([
        authored,
        resolveSurfaceFinish({ specular: 0.1, shininess: 8 }),
      ]),
    );
    const maps = mapBlock(material);
    expect(maps.finishA.subarray(0, 4)).toEqual(
      new Float32Array([0.9, 64, 0.3, 0.5]),
    );
    expect(maps.finishB.subarray(0, 4)).toEqual(
      new Float32Array([0.2, 1, 0, 0]),
    );
    expect(maps.finishA.subarray(4, 8)).toEqual(
      new Float32Array([0.1, 8, 0, 0]),
    );
    expect(maps.finishB.subarray(4, 8)).toEqual(new Float32Array([0, 1, 0, 0]));
    expect(maps.finishA.subarray(8, 12)).toEqual(
      new Float32Array([0.4, 32, 0, 0]),
    );
    const last = (SURFACE4_MAX_MAPS - 1) * 4;
    expect(maps.finishA.subarray(last, last + 4)).toEqual(
      new Float32Array([0.4, 32, 0, 0]),
    );
    expect(material.defines.SURFACE4_FINISH).toBe(1);
    expect(material.fragmentShader).toContain("vec3 finishShade(");
    expect(material.fragmentShader).toContain(fetchLine);
    expect(material.fragmentShader).not.toContain("32.0) * 0.4;");
    expect(material.version).toBeGreaterThan(versionBefore);
    // A float32 lane rounds an authored value to the GPU's own precision —
    // which is the precision every other member of this block carries.
    setSurface4Materials(
      material,
      finishMaterials([{ ...authored, specular: 0.7 }]),
    );
    expect(maps.finishA[0]).toBeCloseTo(0.7, 6);
  });

  it("rewrites the lanes without touching the shader on a value-only change, and null hands the fixed formula back with every slot classic", () => {
    const material = createSurfaceMaterial4();
    setSurface4Materials(material, finishMaterials([authored]));
    const version = material.version;
    const shader = material.fragmentShader;
    setSurface4Materials(
      material,
      finishMaterials([{ ...authored, reflect: 1 }]),
    );
    const maps = mapBlock(material);
    expect(maps.finishA[3]).toBe(1);
    expect(material.version).toBe(version);
    expect(material.fragmentShader).toBe(shader);

    setSurface4Materials(material, null);
    expect(material.defines.SURFACE4_FINISH).toBe(0);
    expect(maps.finishA.subarray(0, 4)).toEqual(
      new Float32Array([0.4, 32, 0, 0]),
    );
    expect(material.fragmentShader).toBe(surface4FragmentFor());
    expect(material.fragmentShader).not.toContain("finishShade");
    expect(material.version).toBeGreaterThan(version);
  });

  it("keeps the fixed std140 layout and classic lighting for pattern-only materials", () => {
    const material = createSurfaceMaterial4();
    const group = material.uniformsGroups[0];
    setSurface4Materials(material, patternMaterials());
    expect(group.uniforms).toHaveLength(6);
    expect(material.defines.SURFACE4_FINISH).toBe(0);
    expect(material.defines.SURFACE4_PATTERN).toBe(1);
    expect(material.fragmentShader).not.toContain("finishShade");
    expect(material.fragmentShader).toContain("32.0) * 0.4;");
    expect(material.fragmentShader).toContain(
      "uniform vec4 uPatternCalibration;",
    );
    const maps = mapBlock(material);
    expect(maps.finishB[2]).not.toBe(0);
    expect(maps.finishB[3]).toBeCloseTo(3.1256, 6);
    expect(
      (material.uniforms.uPatternCalibration.value as THREE.Vector4).toArray(),
    ).toEqual([0.1, 2, 0.2, 3]);

    setSurface4Materials(material, null);
    expect("SURFACE4_PATTERN" in material.defines).toBe(false);
    expect(group.uniforms).toHaveLength(6);
    expect(material.fragmentShader).toBe(surface4FragmentFor());
  });

  it("survives both scene arms' rebuilds in either direction, and reads them back when it rebuilds", () => {
    const material = createSurfaceMaterial4();
    setSurface4Materials(material, patternMaterials(true));
    const finished = (what: string) => {
      expect(material.defines.SURFACE4_FINISH, what).toBe(1);
      expect(material.defines.SURFACE4_PATTERN, what).toBe(1);
      expect(material.fragmentShader, what).toContain(fetchLine);
      expect(material.fragmentShader, what).toContain("uPatternCalibration");
    };
    setSurface4Balloon(material, balloonSpec());
    expect(material.fragmentShader).toContain("balloonInvert");
    finished("balloon on");
    setSurface4Balloon(material, null);
    finished("balloon off");
    setSurface4GroundPlane(material, groundSpec());
    expect(material.fragmentShader).toContain("shadeGroundPlane");
    finished("plane on");
    // Clearing the finish over a live floor keeps the floor.
    setSurface4Materials(material, null);
    expect(material.defines.SURFACE4_GROUND_PLANE).toBe(1);
    expect(material.fragmentShader).toContain("shadeGroundPlane");
    expect(material.fragmentShader).not.toContain("finishShade");
    // And re-enabling it over the floor composes both.
    setSurface4Materials(material, patternMaterials(true));
    expect(material.fragmentShader).toContain("shadeGroundPlane");
    finished("finish over plane");
  });

  it("refuses more material slots than the block carries, and a material without a block", () => {
    const material = createSurfaceMaterial4();
    expect(() =>
      setSurface4Materials(
        material,
        finishMaterials(
          Array.from({ length: SURFACE4_MAX_MAPS + 1 }, () => authored),
        ),
      ),
    ).toThrow(RangeError);
    expect(() =>
      setSurface4Materials(
        material,
        finishMaterials(
          Array.from({ length: SURFACE4_MAX_MAPS }, () => authored),
        ),
      ),
    ).not.toThrow();
    expect(() =>
      setSurface4Materials(
        createSurfaceMaterial(),
        finishMaterials([authored]),
      ),
    ).toThrow(TypeError);
  });
});

describe("the 4D tracer's pattern arm", () => {
  const calibration = {
    ringsLow: 0.1,
    ringsInvSpan: 2,
    sheetsLow: 0.2,
    sheetsInvSpan: 3,
  };
  const patternMaterials = (finish = false): SurfaceMaterialSlots => ({
    slots: [
      resolveSurfaceMaterial(finish ? authored() : undefined, {
        kind: "marble",
        axis: "x",
        scale: 3.1256,
        strength: 0.625,
      }),
    ],
    finish,
    pattern: true,
    patternCalibration: calibration,
  });
  const authored = (): ReturnType<typeof resolveSurfaceFinish> =>
    resolveSurfaceFinish({
      specular: 0.9,
      shininess: 64,
      metalness: 0.3,
      reflect: 0.5,
      transmit: 0.2,
    });

  it("matches the pinned pattern-off byte identity for every scene arm", () => {
    for (const finish of [0, 1]) {
      for (const [name, balloon, plane] of [
        ["4D base", 0, 0],
        ["4D balloon", 1, 0],
        ["4D plane", 0, 1],
      ] as const) {
        const key = `${name} finish${finish}`;
        const expected =
          DEPTH_OF_FIELD_SOURCE_HASHES[key] ??
          BALLOON_PALETTE_SOURCE_HASHES[key] ??
          PRE_PATTERN_SOURCE_HASHES[key];
        expect(expected, key).toBeDefined();
        const resolved = surface4FragmentResolvedFor(balloon, plane, finish, 0);
        const emitted = surface4FragmentFor(balloon, plane, finish, 0);
        expect(sha256(resolved).slice(0, 16), `${key} resolved`).toBe(
          expected.resolved,
        );
        expect(sha256(emitted).slice(0, 16), `${key} emitted`).toBe(
          expected.emitted,
        );
        expect(resolved, key).not.toContain("patternShade");
        expect(resolved, key).not.toContain("patternHash3");
        expect(resolved, key).not.toContain("SURFACE_PATTERN");
      }
    }
  });

  it("compiles exactly one patternShade body into every scene arm with the flag on, and keeps the six-member std140 block fixed", () => {
    for (const [balloon, plane] of [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as const) {
      const resolved = surface4FragmentResolvedFor(balloon, plane, 0, 1);
      expect(
        countOccurrences(
          resolved,
          "vec3 patternShade(vec3 base, vec3 objectP, vec4 fb, vec4 calibration, float sheets, float pixelFootprint) {",
        ),
      ).toBe(1);
      expect(resolved).toContain("uniform vec4 uPatternCalibration;");
      expect(resolved).toContain("base = patternShade(");
      // The block keeps exactly its six members; the pattern calibration is
      // a default-block vec4, never a seventh member.
      const block = resolved.match(
        /layout\(std140\) uniform SurfaceMaps4 \{[\s\S]*?\n\s*\};/,
      );
      expect(block).not.toBeNull();
      const members = block![0]
        .split("\n")
        .filter((line) => /^\s*(mat4|vec4) u/.test(line))
        .map((line) => line.trim());
      expect(members).toEqual([
        "mat4 uInvM[MAX_MAPS];",
        "vec4 uInvT[MAX_MAPS];",
        "vec4 uMapColorSigma[MAX_MAPS];",
        "vec4 uMapTrap[MAX_MAPS];",
        "vec4 uMapFinishA[MAX_MAPS];",
        "vec4 uMapFinishB[MAX_MAPS];",
      ]);
    }
    // The plane-over-balloon refusal holds with the pattern on.
    expect(() => surface4FragmentFor(1, 1, 0, 1)).toThrow(RangeError);
  });

  it("emits the identical patternShade body the 3D tracer emits — one template, both dimensions", () => {
    const body = (src: string): string => {
      const match = src.match(/vec3 patternShade\([\s\S]*?\n\s*\}/);
      expect(match).not.toBeNull();
      return match![0].replace(/\s+/g, " ").trim();
    };
    // The 4D plain arm resolves under the strip threshold when the arm is
    // on? No — it crosses (the size test below pins that), so compare the
    // RESOLVED sources: both contain the full commentary-free body.
    expect(body(surface4FragmentResolvedFor(0, 0, 0, 1))).toBe(
      body(surfaceFragmentResolvedFor(0, 0, 0, 0, 0, 0, 1)),
    );
  });

  it("routes the source hit through the 4D view lift and the affine final inverse, normalized by the RAW radius", () => {
    const resolved = surface4FragmentResolvedFor(0, 0, 0, 1);
    // The hit's own w is inserted BEFORE the inverse rotor (the frame
    // oracle's surfacePatternHitW + inverseRotor order), using the winning
    // descent's sStar under the slab.
    expect(resolved).toContain(
      "vec4 patternSource4 = vec4(pos, uW0 + sStar * uSliceHalfW);",
    );
    expect(resolved).toContain(
      "vec4 patternLifted = uInvRotor * patternSource4;",
    );
    expect(resolved).toContain(
      "vec4 patternRaw = uFinalInvM * patternLifted + uFinalInvT;",
    );
    expect(resolved).toContain(
      "vec3 objectP = patternRaw.xyz / uBoundingRadius;",
    );
    expect(resolved).toContain(
      "float patternFootprint = uAcceptPixelEps * t / uBoundingRadius;",
    );
    // Balloon: the shell winner's pre-inversion cpos keeps its own w.
    const balloon = surface4FragmentResolvedFor(1, 0, 0, 1);
    expect(balloon).toContain("if (shell > 0.5) {");
    expect(balloon).toContain(
      "patternSource4 = vec4(cpos, uW0 + sStar * uSliceHalfW);",
    );
  });

  it("keeps the fixed std140 layout and classic lighting for pattern-only materials", () => {
    const material = createSurfaceMaterial4();
    const group = material.uniformsGroups[0];
    setSurface4Materials(material, patternMaterials());
    expect(group.uniforms).toHaveLength(6);
    expect(material.defines.SURFACE4_FINISH).toBe(0);
    expect(material.defines.SURFACE4_PATTERN).toBe(1);
    expect(material.fragmentShader).toContain("vec3 patternShade(");
    expect(material.fragmentShader).not.toContain("finishShade");
    expect(material.fragmentShader).toContain("32.0) * 0.4;");
    // A value-only lane change never rebuilds the shader.
    const version = material.version;
    setSurface4Materials(material, patternMaterials(true));
    expect(material.defines.SURFACE4_FINISH).toBe(1);
    setSurface4Materials(material, patternMaterials(true));
    expect(material.version).toBeGreaterThan(version);
    setSurface4Materials(material, null);
    expect("SURFACE4_PATTERN" in material.defines).toBe(false);
    expect(material.fragmentShader).toBe(surface4FragmentFor());
  });

  it("crosses the plain arm over the strip threshold with the pattern on — benignly: the emitted program is the stripped token stream", () => {
    // Measured at landing: 74312 B resolved with pattern on (62765 B off),
    // so the plain 4D arm's commentary stops reaching a driver log exactly
    // when a 4D document authors a pattern. Crossing is the documented
    // contract: the emitted program is the identical token stream at a
    // fraction of the size, and the stripped programs sit far under the
    // ~80KB Mesa crash cliff.
    expect(surface4FragmentResolvedFor(0, 0, 0, 1).length).toBeGreaterThan(
      SURFACE_GLSL_STRIP_BYTES,
    );
    const emitted = surface4FragmentFor(0, 0, 0, 1);
    expect(emitted).not.toContain("//");
    expect(emitted.length).toBeLessThan(SURFACE_GLSL_STRIP_BYTES / 2);
    // Off, the plain arm stays unstripped — the pre-pattern record.
    expect(surface4FragmentResolvedFor(0, 0, 0, 0).length).toBeLessThan(
      SURFACE_GLSL_STRIP_BYTES,
    );
    // And no pattern-enabled variant approaches the Mesa cliff.
    for (const [balloon, plane] of [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as const) {
      expect(surface4FragmentFor(balloon, plane, 1, 1).length).toBeLessThan(
        80 * 1024,
      );
    }
  });
});
