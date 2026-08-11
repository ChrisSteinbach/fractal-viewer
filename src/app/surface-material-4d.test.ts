import type * as THREE from "three";
import {
  createSurfaceMaterial4,
  setSurfaceSystem4,
  SURFACE4_MAX_MAPS,
} from "./surface-material-4d";
import type { SurfaceDE4, SurfaceDE4Map } from "../fractal/surface-de-4d";
import { twentyFourCellFlake } from "../fractal/presets";

/**
 * The 4D tracer's per-map data rides a std140 uniform BLOCK rather than
 * default-block uniform arrays (fr-dqlq — that block is what let the cap
 * match 3D's 24 maps), and a std140 lane written one float off is invisible
 * until someone loads a 4D system in a browser. So while the rest of this
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
    // Inert affine-slot defaults for the fr-rsp6 fold fields — this
    // packer predates fold-4D and packs none of them.
    foldKind: 0,
    foldInvW: 1,
    foldSigma: 0.5,
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
    escapeRadius: 2,
    maxDepth: 8,
    beamWidth: 4,
    stepScale: 1,
    final: null,
    foldFinal: null,
  };
}

/** The four Float32Arrays behind the material's `SurfaceMaps4` block, in the
 * order the fragment shader declares its members — the bytes the GPU reads.
 * Reached through the uniforms group because block members deliberately do
 * NOT appear in `material.uniforms`. */
function mapBlock(material: THREE.ShaderMaterial): {
  invM: Float32Array;
  invT: Float32Array;
  colorSigma: Float32Array;
  trap: Float32Array;
} {
  const group = material.uniformsGroups[0];
  const uniforms = group.uniforms as THREE.Uniform<Float32Array>[];
  return {
    invM: uniforms[0].value,
    invT: uniforms[1].value,
    colorSigma: uniforms[2].value,
    trap: uniforms[3].value,
  };
}

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

describe("setSurfaceSystem4 kaleidoscope sweep uniforms (fr-u91x)", () => {
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

describe("slab-hit radius color (fr-9c9e)", () => {
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
