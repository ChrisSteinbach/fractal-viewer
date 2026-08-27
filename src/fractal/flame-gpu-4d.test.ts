import {
  CHAIN4_STRIDE_BYTES,
  FLAME_GPU_KERNEL_4D_WGSL,
  KERNEL_COLOR_KIND,
  PARAMS4_BYTES,
  PARAMS4_ITERS_OFFSET_BYTES,
  SLOT4_STRIDE_BYTES,
  WEIGHT_FIXED_POINT_SCALE,
  convertGpuDisplayHistogram4,
  convertGpuHistogram4,
  packGpuChains4,
  packGpuParams4,
  packGpuSystem4,
} from "./flame-gpu-4d";
import type { GpuFlameSystemSpec4, GpuParams4Fields } from "./flame-gpu-4d";
import { composeAffine4, symmetryRotation4, toTransform4 } from "./affine4";
import { prepareChaosGame4 } from "./chaos-game-4d";
import { MAX_TRANSFORMS } from "./chaos-game";
import {
  COLOR_FIXED_POINT_SCALE,
  EMITTER_OVERLAP_ATTEMPTS,
  HIST_U32_PER_BUCKET,
  KERNEL_VARIATION_INDEX,
  WORKGROUP_SIZE,
  packGpuSystem,
} from "./flame-gpu";
import { createFlameHistogram } from "./flame";
import type { Mat4 } from "./flame";
import { mulberry32 } from "./rng";
import {
  MESH_ASSET_IDS,
  meshAsset,
  meshAssetCatalogIndex,
  meshAssetIdAtCatalogIndex,
  type MeshAssetId,
} from "./mesh-shapes";
import { VARIATION_TYPES } from "./types";
import type { SymmetryParams, Transform4, Vec3, Vec4 } from "./types";
import type { FourDView } from "./project4";
import { GEAR_SHAPE, ORBIT_RING_SHAPE, PEACE_SIGN_SHAPE } from "./shapes";
import type { ShapeSpec } from "./shapes";

function meshEmitterShape(meshId: MeshAssetId, posed = false): ShapeSpec {
  return {
    parts: [
      {
        primitive: { kind: "mesh", meshId },
        combine: "union",
        ...(posed
          ? {
              pose: {
                offset: [0.1, -0.2, 0.3] as Vec3,
                rotate: [0.2, -0.1, 0.4] as Vec3,
                scale: 2,
              },
            }
          : {}),
      },
    ],
  };
}

/** Independent expectation for binding 7's mesh region: the prepared area
 * CDF followed by every indexed triangle expanded to three vec3f vertices. */
function expectedMeshTriangleTable(meshId: MeshAssetId): number[] {
  const asset = meshAsset(meshId);
  return [
    ...Array.from(asset.triangleCumulativeAreas, Math.fround),
    ...asset.triangles.flatMap((triangle) =>
      triangle.flatMap((vertex) =>
        Array.from(asset.vertices[vertex], Math.fround),
      ),
    ),
  ];
}

function makeTransforms4(count: number): Transform4[] {
  return Array.from({ length: count }, () => ({
    position: [0.5, 0.5, 0.5, 0.5],
    scale: [0.5, 0.5, 0.5, 0.5],
  }));
}

/** Default spec for tests that don't care about the specific system —
 * override just the field under test. `wRamp` is the simplest color kind
 * (leaves the colors buffer untouched), matching the 3D sibling's use of
 * `palette: "legacy"` as its own no-fuss default. */
function baseSpec4(
  overrides: Partial<GpuFlameSystemSpec4> = {},
): GpuFlameSystemSpec4 {
  return {
    transforms4: makeTransforms4(2),
    finalTransform4: null,
    symmetry: { order: 1, plane: "xz" },
    color: { kind: "wRamp", side: { neg: [0, 0, 0], pos: [0, 0, 0] } },
    ...overrides,
  };
}

// Slot4 element offsets (4-byte units), restated directly from
// flame-gpu-4d.ts's byte-layout doc comment (byte offset / 4) — independent
// of that module's own (private) offset constants, so a mistake in the
// implementation could not coincidentally agree with a matching mistake here.
const F32_PER_SLOT4 = SLOT4_STRIDE_BYTES / 4; // 96
const ROW_X = 0; // byte 0
const ROW_Y = 4; // byte 16
const ROW_Z = 8; // byte 32
const ROW_W = 12; // byte 48
const TRANS = 16; // byte 64
const POST_X = 20; // byte 80
const POST_Y = 24; // byte 96
const POST_Z = 28; // byte 112
const POST_W = 32; // byte 128
const VAR_WEIGHTS = 36; // byte 144, array<vec4f, 5>
const VAR_TYPES = 56; // byte 224, array<vec4u, 5>
const VAR_COUNT = 76; // byte 304
const HAS_POST = 77; // byte 308
const CUM_WEIGHT = 78; // byte 312
const COLOR_INDEX = 79; // byte 316
const COLOR_SPEED = 80; // byte 320

describe("layout constants", () => {
  it("pins the byte-layout sizes documented on the module", () => {
    expect(PARAMS4_BYTES).toBe(480);
    expect(SLOT4_STRIDE_BYTES).toBe(1168);
    expect(CHAIN4_STRIDE_BYTES).toBe(32);
    expect(PARAMS4_ITERS_OFFSET_BYTES).toBe(144);
    expect(WEIGHT_FIXED_POINT_SCALE).toBe(256);
  });

  it("maps every FourDRenderColor kind to the kernel's colorKind switch value", () => {
    expect(KERNEL_COLOR_KIND.structural).toBe(0);
    expect(KERNEL_COLOR_KIND.wRamp).toBe(1);
    expect(KERNEL_COLOR_KIND.transform).toBe(2);
    expect(KERNEL_COLOR_KIND.radius).toBe(3);
    expect(KERNEL_COLOR_KIND.height).toBe(4);
    expect(KERNEL_COLOR_KIND.position).toBe(5);
    expect(KERNEL_COLOR_KIND.uniform).toBe(6);
  });
});

describe("packGpuSystem4 validation", () => {
  it("rejects systems with more than MAX_TRANSFORMS transforms, matching prepareChaosGame4's message", () => {
    const tooMany = makeTransforms4(MAX_TRANSFORMS + 1);
    expect(() => packGpuSystem4(baseSpec4({ transforms4: tooMany }))).toThrow(
      RangeError,
    );
    expect(() => packGpuSystem4(baseSpec4({ transforms4: tooMany }))).toThrow(
      `IFS supports at most ${MAX_TRANSFORMS} transforms, got ${tooMany.length}`,
    );
  });
});

describe("packGpuSystem4 slot layout (byte-layout pinning)", () => {
  it("writes a slot's affine rows and translation from composeAffine4's own output, in f32", () => {
    const transform: Transform4 = {
      position: [0.1, 0.2, 0.3, 0.4],
      scale: [0.5, 0.6, 0.7, 0.8],
      rotation: { xy: 0.3, zw: -0.4 },
    };
    const packed = packGpuSystem4(baseSpec4({ transforms4: [transform] }));
    const f32 = new Float32Array(packed.slots);
    const { m, t } = composeAffine4(transform);
    for (let c = 0; c < 4; c++) {
      expect(f32[ROW_X + c]).toBe(Math.fround(m[c]));
      expect(f32[ROW_Y + c]).toBe(Math.fround(m[4 + c]));
      expect(f32[ROW_Z + c]).toBe(Math.fround(m[8 + c]));
      expect(f32[ROW_W + c]).toBe(Math.fround(m[12 + c]));
      expect(f32[TRANS + c]).toBe(Math.fround(t[c]));
    }
  });

  it("writes variation weight/type lanes and varCount for two active variations at their documented offsets", () => {
    const transform: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [1, 1, 1, 1],
      variations: [
        { type: "swirl", weight: 0.7 },
        { type: "julia", weight: 1.2 },
      ],
    };
    const packed = packGpuSystem4(baseSpec4({ transforms4: [transform] }));
    const f32 = new Float32Array(packed.slots);
    const u32 = new Uint32Array(packed.slots);
    expect(f32[VAR_WEIGHTS]).toBeCloseTo(0.7, 6);
    expect(f32[VAR_WEIGHTS + 1]).toBeCloseTo(1.2, 6);
    expect(u32[VAR_TYPES]).toBe(KERNEL_VARIATION_INDEX.swirl);
    expect(u32[VAR_TYPES + 1]).toBe(KERNEL_VARIATION_INDEX.julia);
    expect(u32[VAR_COUNT]).toBe(2);
  });

  it("writes a variation lane beyond index 3 (array<vec4,3>'s second vec4) contiguously, across 5 variations", () => {
    const transform: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [1, 1, 1, 1],
      variations: [
        { type: "sinusoidal", weight: 1.5 },
        { type: "spherical", weight: 0.5 },
        { type: "swirl", weight: 2 },
        { type: "horseshoe", weight: 0.25 },
        { type: "polar", weight: 4 },
      ],
    };
    const packed = packGpuSystem4(baseSpec4({ transforms4: [transform] }));
    const f32 = new Float32Array(packed.slots);
    const u32 = new Uint32Array(packed.slots);
    const expectedTypes = [
      KERNEL_VARIATION_INDEX.sinusoidal,
      KERNEL_VARIATION_INDEX.spherical,
      KERNEL_VARIATION_INDEX.swirl,
      KERNEL_VARIATION_INDEX.horseshoe,
      KERNEL_VARIATION_INDEX.polar,
    ];
    const expectedWeights = [1.5, 0.5, 2, 0.25, 4];
    expect(u32[VAR_COUNT]).toBe(5);
    for (let v = 0; v < 5; v++) {
      expect(u32[VAR_TYPES + v]).toBe(expectedTypes[v]);
      expect(f32[VAR_WEIGHTS + v]).toBeCloseTo(expectedWeights[v], 6);
    }
  });

  it("leaves variation lanes and varCount zeroed when a transform has no variations", () => {
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: makeTransforms4(1) }),
    );
    const f32 = new Float32Array(packed.slots);
    const u32 = new Uint32Array(packed.slots);
    expect(u32[VAR_COUNT]).toBe(0);
    // All 16 storage lanes (15 used variation types + 1 spare), not just the
    // old 12 — a zero-fill regression in the unused 16th lane, or in lanes
    // 12-14 (the Mandelbox fold family), must fail here.
    for (let v = 0; v < 16; v++) {
      expect(f32[VAR_WEIGHTS + v]).toBe(0);
      expect(u32[VAR_TYPES + v]).toBe(0);
    }
  });

  it("accumulates cumWeight as the running sum over weights [2, 3, 5]", () => {
    const transforms4: Transform4[] = [2, 3, 5].map((weight) => ({
      position: [0, 0, 0, 0],
      scale: [1, 1, 1, 1],
      weight,
    }));
    const packed = packGpuSystem4(baseSpec4({ transforms4 }));
    const f32 = new Float32Array(packed.slots);
    const expectedCum = [2, 5, 10];
    for (let s = 0; s < 3; s++) {
      expect(f32[s * F32_PER_SLOT4 + CUM_WEIGHT]).toBeCloseTo(
        expectedCum[s],
        6,
      );
    }
    expect(packed.totalWeight).toBe(10);
    expect(packed.weighted).toBe(true);
  });

  it("marks weighted false and totalWeight = count when every weight is 1", () => {
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: makeTransforms4(4) }),
    );
    expect(packed.weighted).toBe(false);
    expect(packed.totalWeight).toBe(4);
  });

  it("sizes slots as (transformCount + 1) * SLOT4_STRIDE_BYTES", () => {
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: makeTransforms4(3) }),
    );
    expect(packed.slots.byteLength).toBe(4 * SLOT4_STRIDE_BYTES);
  });

  it("writes the final transform's affine rows at slot index transformCount and sets hasFinal true", () => {
    const finalTransform4: Transform4 = {
      position: [0.7, 0.8, 0.9, 1.0],
      scale: [1, 1, 1, 1],
    };
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: makeTransforms4(2), finalTransform4 }),
    );
    expect(packed.hasFinal).toBe(true);
    const f32 = new Float32Array(packed.slots);
    const base = packed.transformCount * F32_PER_SLOT4;
    const { m, t } = composeAffine4(finalTransform4);
    expect(f32[base + ROW_X]).toBe(Math.fround(m[0]));
    expect(f32[base + TRANS]).toBe(Math.fround(t[0]));
    expect(f32[base + TRANS + 3]).toBe(Math.fround(t[3]));
  });

  it("leaves the final slot zeroed and hasFinal false when no final transform is given", () => {
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: makeTransforms4(2) }),
    );
    expect(packed.hasFinal).toBe(false);
    const f32 = new Float32Array(packed.slots);
    const base = packed.transformCount * F32_PER_SLOT4;
    for (let e = 0; e < F32_PER_SLOT4; e++) {
      expect(f32[base + e]).toBe(0);
    }
  });
});

describe("packGpuSystem4 variation filtering", () => {
  it("drops non-finite/zero-weight variations (packVariations' rule) and compacts survivors in original order", () => {
    const transforms4: Transform4[] = [
      {
        position: [0, 0, 0, 0],
        scale: [1, 1, 1, 1],
        variations: [
          { type: "sinusoidal", weight: 1 },
          { type: "linear", weight: 0 }, // dropped: zero weight.
          { type: "spherical", weight: NaN }, // dropped: non-finite.
          { type: "swirl", weight: 3 },
        ],
      },
    ];
    const packed = packGpuSystem4(baseSpec4({ transforms4 }));
    const u32 = new Uint32Array(packed.slots);
    const f32 = new Float32Array(packed.slots);
    expect(u32[VAR_COUNT]).toBe(2);
    expect(u32[VAR_TYPES]).toBe(KERNEL_VARIATION_INDEX.sinusoidal);
    expect(u32[VAR_TYPES + 1]).toBe(KERNEL_VARIATION_INDEX.swirl);
    expect(f32[VAR_WEIGHTS]).toBe(1);
    expect(f32[VAR_WEIGHTS + 1]).toBe(3);
  });
});

describe("packGpuSystem4 fold radii", () => {
  /** Element index of fold `i`'s lane in slot 0 — the module's own
   * SLOT4_FOLD_RADII at 84, restated as a literal for the same reason the
   * rest of this file restates offsets. */
  const FOLD4_RADII = 84;

  it("packs the fold family's authored lengths in the 3D kernel's own form, so a system and its lift agree", () => {
    const transforms: Transform4[] = [
      {
        position: [0, 0, 0, 0],
        scale: [1, 1, 1, 1],
        variations: [
          { type: "boxfold", weight: 1, boxLimit: 3 },
          {
            type: "mandelbox",
            weight: 1,
            minRadius: 0.25,
            fixedRadius: 1.5,
            boxLimit: 0.75,
          },
        ],
      },
    ];
    const f32 = new Float32Array(
      packGpuSystem4(baseSpec4({ transforms4: transforms })).slots,
    );
    expect(Array.from(f32.slice(FOLD4_RADII, FOLD4_RADII + 3))).toEqual([
      0.25, 1, 3,
    ]);
    expect(Array.from(f32.slice(FOLD4_RADII + 4, FOLD4_RADII + 7))).toEqual([
      0, 0, 0,
    ]);
    expect(Array.from(f32.slice(FOLD4_RADII + 8, FOLD4_RADII + 11))).toEqual([
      0.0625, 2.25, 0.75,
    ]);
  });

  it("reads its lengths off the slot in the kernel rather than the classic literals", () => {
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain("foldRadii: array<vec4f, 3>");
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
      "applyVariation(ty, a, rng, slots[slotIdx].foldRadii[fi].xyz)",
    );
    expect(FLAME_GPU_KERNEL_4D_WGSL).not.toContain(
      "clamp(dot(p, p), 0.25, 1.0)",
    );
    expect(FLAME_GPU_KERNEL_4D_WGSL).not.toContain(
      "clamp(p, vec4f(-1.0), vec4f(1.0))",
    );
  });
});

describe("packGpuSystem4 shape emitters", () => {
  /** Element offsets restated from flame-gpu-4d.ts's byte-layout doc (the
   * fold-radii block's own discipline above): SLOT4_EMITTER_FLAG et al. at
   * 96-100, then flame-gpu.ts's shared 24-element EmitterPart sub-layout. */
  const EMITTER_FLAG = 96;
  const EMITTER_PART_COUNT = 97;
  const EMITTER_FALLBACK_PART = 99;
  const EMITTER_PARTS = 100;
  const EP_KIND_PARAMS0 = 0;
  const EP_PARAMS1 = 4;
  const EP_ROT0 = 12;
  const EP_ROT1 = 16;

  function transform4WithEmitter(emitter: ShapeSpec): Transform4 {
    return { position: [0, 0, 0, 0], scale: [1, 1, 1, 1], emitter };
  }

  it("leaves every emitter field at zero and gearTable null for an emitter-free system", () => {
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: makeTransforms4(2) }),
    );
    const u32 = new Uint32Array(packed.slots);
    for (let s = 0; s < 2; s++) {
      const base = s * F32_PER_SLOT4;
      expect(u32[base + EMITTER_FLAG]).toBe(0);
      expect(u32[base + EMITTER_PART_COUNT]).toBe(0);
      expect(u32[base + EMITTER_FALLBACK_PART]).toBe(0);
    }
    expect(packed.gearTable).toBeNull();
    expect(packed.multiPartEmitters).toBe(false);
  });

  it("packs a sphere part's kind tag, radius and identity pose — flame-gpu.ts's shared EmitterPart layout", () => {
    const spec: ShapeSpec = {
      parts: [{ primitive: { kind: "sphere", radius: 2 }, combine: "union" }],
    };
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: [transform4WithEmitter(spec)] }),
    );
    const u32 = new Uint32Array(packed.slots);
    const f32 = new Float32Array(packed.slots);
    expect(u32[EMITTER_FLAG]).toBe(1);
    expect(u32[EMITTER_PART_COUNT]).toBe(1);
    const p = EMITTER_PARTS;
    expect(f32[p + EP_KIND_PARAMS0]).toBe(0); // sphere
    expect(f32[p + EP_KIND_PARAMS0 + 1]).toBe(2); // radius
    expect(Array.from(f32.slice(p + EP_ROT0, p + EP_ROT0 + 3))).toEqual([
      1, 0, 0,
    ]); // identity rotation row 0.
    expect(packed.multiPartEmitters).toBe(false);
  });

  it("packs Orbit Ring through the shared torus lanes", () => {
    const packed = packGpuSystem4(
      baseSpec4({
        transforms4: [transform4WithEmitter(ORBIT_RING_SHAPE)],
      }),
    );
    const f32 = new Float32Array(packed.slots);
    const p = EMITTER_PARTS;
    expect(f32[p + EP_KIND_PARAMS0]).toBe(2);
    expect(f32[p + EP_KIND_PARAMS0 + 1]).toBeCloseTo(0.78, 5);
    expect(f32[p + EP_KIND_PARAMS0 + 2]).toBeCloseTo(0.26, 5);
    expect(packed.gearTable).toBeNull();
    expect(packed.multiPartEmitters).toBe(false);
  });

  it("packs Peace's actual torus/capsule set and enables bounded overlap", () => {
    const packed = packGpuSystem4(
      baseSpec4({
        transforms4: [transform4WithEmitter(PEACE_SIGN_SHAPE)],
      }),
    );
    const f32 = new Float32Array(packed.slots);
    expect(
      PEACE_SIGN_SHAPE.parts.map(
        (_part, i) => f32[EMITTER_PARTS + i * 24 + EP_KIND_PARAMS0],
      ),
    ).toEqual([2, 3, 3, 3]);
    expect(packed.multiPartEmitters).toBe(true);
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
      "if (!MULTI_PART_EMITTERS || partCount <= 1u)",
    );
  });

  it("packs a gear part's device table region — the SAME buildGearTriangleTable helper flame-gpu.ts's kernel uses", () => {
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: [transform4WithEmitter(GEAR_SHAPE)] }),
    );
    const f32 = new Float32Array(packed.slots);
    const p = EMITTER_PARTS;
    expect(f32[p + EP_KIND_PARAMS0]).toBe(4); // gear
    const triCount = f32[p + EP_KIND_PARAMS0 + 2];
    expect(triCount).toBeGreaterThan(0);
    expect(Array.from(f32.slice(p + EP_PARAMS1, p + EP_PARAMS1 + 4))).toEqual([
      1,
      Math.fround(0.22),
      Math.fround(0.16),
      Math.fround(0.35),
    ]);
    expect(f32[p + EP_ROT1 + 3]).toBeCloseTo((2 * Math.PI) / 8, 6);
    expect(packed.gearTable).not.toBeNull();
    expect(new Float32Array(packed.gearTable!).length).toBe(
      triCount + triCount * 6,
    );
  });

  it.each(MESH_ASSET_IDS)(
    "packs catalog mesh %s with the byte-identical 3D EmitterPart/table contract",
    (meshId) => {
      const asset = meshAsset(meshId);
      const catalogIndex = meshAssetCatalogIndex(meshId);
      expect(asset.id).toBe(meshId);
      expect(meshAssetIdAtCatalogIndex(catalogIndex)).toBe(meshId);
      const spec = meshEmitterShape(meshId, true);
      const packed4 = packGpuSystem4(
        baseSpec4({
          transforms4: [transform4WithEmitter(spec)],
        }),
      );
      const packed3 = packGpuSystem({
        transforms: [
          {
            id: 0,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            emitter: spec,
          },
        ],
        finalTransform: null,
        symmetry: { order: 1, plane: "xz" },
        palette: "legacy",
      });
      expect(SLOT4_STRIDE_BYTES).toBe(1168);
      const f32 = new Float32Array(packed4.slots);
      const p = EMITTER_PARTS;
      expect(f32[p + EP_KIND_PARAMS0]).toBe(5);
      expect(f32[p + EP_KIND_PARAMS0 + 1]).toBe(0);
      expect(f32[p + EP_KIND_PARAMS0 + 2]).toBe(asset.triangles.length);
      expect(Array.from(f32.slice(EMITTER_PARTS, EMITTER_PARTS + 24))).toEqual(
        Array.from(new Float32Array(packed3.slots).slice(88, 88 + 24)),
      );

      const table4 = new Float32Array(packed4.gearTable!);
      const table3 = new Float32Array(packed3.gearTable!);
      const n = asset.triangles.length;
      expect(table4.length).toBe(n + n * 9);
      expect(Array.from(table4)).toEqual(expectedMeshTriangleTable(meshId));
      expect(Array.from(table4)).toEqual(Array.from(table3));
      expect(FLAME_GPU_KERNEL_4D_WGSL).toContain("fn emitterDrawMesh(");
      expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
        "let vBase = tableOffset + triCount + lo * 9u;",
      );
      expect(FLAME_GPU_KERNEL_4D_WGSL).toContain("case 5u: { // mesh:");
    },
  );

  it("replicates a base map's emitter block into every kaleidoscope copy", () => {
    const packed = packGpuSystem4(
      baseSpec4({
        transforms4: [transform4WithEmitter(GEAR_SHAPE)],
        symmetry: { order: 3, plane: "xz" },
      }),
    );
    expect(packed.transformCount).toBe(3);
    const u32 = new Uint32Array(packed.slots);
    for (let s = 0; s < 3; s++) {
      expect(u32[s * F32_PER_SLOT4 + EMITTER_FLAG]).toBe(1);
    }
  });

  it("packs the shared positive-measure fallback word without growing Slot4", () => {
    const spec: ShapeSpec = {
      parts: [
        { primitive: { kind: "sphere", radius: 0 }, combine: "union" },
        { primitive: { kind: "box", half: [1, 1, 1] }, combine: "union" },
      ],
    };
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: [transform4WithEmitter(spec)] }),
    );
    expect(new Uint32Array(packed.slots)[EMITTER_FALLBACK_PART]).toBe(1);
    expect(SLOT4_STRIDE_BYTES).toBe(1168);
    expect(packed.multiPartEmitters).toBe(true);
  });

  it("uses the same bounded posed-containment policy as the 3D kernel", () => {
    expect(EMITTER_OVERLAP_ATTEMPTS).toBe(64);
    for (const source of [FLAME_GPU_KERNEL_4D_WGSL]) {
      expect(source).toContain("emitterOverlapAttempts: u32,");
      expect(source).toContain("override MULTI_PART_EMITTERS: bool = true;");
      expect(source).toContain("if (!MULTI_PART_EMITTERS || partCount <= 1u)");
      expect(source).toContain("fn emitterPartContains(");
      expect(source).toContain(
        "part.rot0.x * shifted.x + part.rot1.x * shifted.y + part.rot2.x * shifted.z",
      );
      expect(source).toContain("let seg = part.rot1.w;");
      expect(source).toContain(
        "var attemptsLeft = params.emitterOverlapAttempts;",
      );
      expect(source).toContain("if (attemptsLeft == 0u)");
      expect(source).toContain("attemptsLeft -= 1u;");
      expect(source).not.toContain("attempt < EMITTER_OVERLAP_ATTEMPTS");
      expect(source).toContain(
        "slots[slotIdx].emitterParts[slots[slotIdx].emitterFallbackPart]",
      );
      expect(source).toContain(
        "if (u32(slots[slotIdx].emitterParts[pick].kindParams0.x) == 5u)",
      );
    }
  });

  it("does not enable the multipart specialization for a spec rejected by prepareEmitters", () => {
    const unsamplable: ShapeSpec = {
      parts: [
        { primitive: { kind: "sphere", radius: 1 }, combine: "union" },
        {
          primitive: { kind: "sphere", radius: 0.5 },
          combine: "intersect",
        },
      ],
    };
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: [transform4WithEmitter(unsamplable)] }),
    );
    expect(new Uint32Array(packed.slots)[EMITTER_FLAG]).toBe(0);
    expect(packed.multiPartEmitters).toBe(false);
  });

  it("embeds the shape sample at w = 0 before this slot's own 4D affine poses it — stepOrbit4's own dimensional decision", () => {
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
      "let sample = vec4f(emitterSampleSlot(&derived, slotIdx), 0.0);",
    );
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
      "@group(0) @binding(7) var<storage, read> emitterTriangleTable: array<f32>;",
    );
    expect(FLAME_GPU_KERNEL_4D_WGSL).not.toContain("@binding(8)");
  });
});

describe("packGpuSystem4 agreement with prepareChaosGame4 at default blend", () => {
  it("matches transformCount, weighted, totalWeight, and cumWeight lanes", () => {
    const transforms4: Transform4[] = [
      { position: [0.2, 0, 0, 0], scale: [0.5, 0.5, 0.5, 0.5], weight: 2 },
      { position: [-0.2, 0.1, 0, 0], scale: [0.6, 0.5, 0.4, 0.4], weight: 5 },
      { position: [0, -0.2, 0.1, 0], scale: [0.4, 0.4, 0.4, 0.4], weight: 1 },
    ];
    const prepared = prepareChaosGame4(transforms4);
    const packed = packGpuSystem4(baseSpec4({ transforms4 }));

    expect(packed.transformCount).toBe(prepared.transformCount);
    expect(packed.weighted).toBe(prepared.weighted);
    expect(packed.totalWeight).toBe(prepared.totalWeight);

    const f32 = new Float32Array(packed.slots);
    const expectedCum = Array.from(prepared.cumulative);
    for (let s = 0; s < packed.transformCount; s++) {
      expect(f32[s * F32_PER_SLOT4 + CUM_WEIGHT]).toBeCloseTo(
        expectedCum[s],
        6,
      );
    }
  });

  it("resolves every slot's color pair to the value prepareChaosGame4 resolved for that transform", () => {
    // Mixed on purpose — authored pair, speed only, neither — so the
    // fallbacks run on BOTH sides. The anti-drift pin: pack through
    // the same derivedColorIndex/DEFAULT_COLOR_SPEED definitions the CPU
    // oracle's PreparedChaosGame4 uses, or a 4D flame colors differently on
    // GPU than on CPU.
    const transforms4: Transform4[] = [
      {
        position: [0.2, 0, 0, 0],
        scale: [0.5, 0.5, 0.5, 0.5],
        colorIndex: 0.8,
        colorSpeed: 0.3,
      },
      {
        position: [-0.2, 0.1, 0, 0],
        scale: [0.5, 0.5, 0.5, 0.5],
        colorSpeed: 0.9,
      },
      { position: [0, -0.2, 0.1, 0], scale: [0.5, 0.5, 0.5, 0.5] },
    ];
    const prepared = prepareChaosGame4(transforms4);
    const packed = packGpuSystem4(baseSpec4({ transforms4 }));

    const f32 = new Float32Array(packed.slots);
    for (let i = 0; i < packed.transformCount; i++) {
      expect(f32[i * F32_PER_SLOT4 + COLOR_INDEX]).toBe(
        Math.fround(prepared.colorIndex[i]),
      );
      expect(f32[i * F32_PER_SLOT4 + COLOR_SPEED]).toBe(
        Math.fround(prepared.colorSpeed[i]),
      );
    }
  });
});

describe("packGpuSystem4 symmetry expansion", () => {
  /** Two visibly distinct base maps, so a slot that took the wrong base
   * transform's affine is obvious from row 0 alone. */
  function twoBaseMaps(): Transform4[] {
    return [
      { position: [0.1, 0.2, 0.3, 0.4], scale: [2, 3, 4, 5] },
      { position: [-0.4, -0.5, -0.6, -0.7], scale: [6, 7, 8, 9] },
    ];
  }

  const SYMMETRY: SymmetryParams = { order: 3, plane: "zw", twist: 1 };

  it("expands to order * baseTransformCount slots (3 * 2 = 6), plus one final slot", () => {
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: twoBaseMaps(), symmetry: SYMMETRY }),
    );
    expect(packed.transformCount).toBe(6);
    expect(packed.baseTransformCount).toBe(2);
    expect(packed.slots.byteLength).toBe(7 * SLOT4_STRIDE_BYTES);
  });

  it("writes each expanded slot's affine rows from its BASE transform, copy-major, with the post-rotation kept separate", () => {
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: twoBaseMaps(), symmetry: SYMMETRY }),
    );
    const f32 = new Float32Array(packed.slots);
    // Slots 0/2/4 are base map 0, 1/3/5 base map 1 — a copy's rotation is
    // NEVER baked into its affine rows, only into its post rows, so every
    // copy of a map carries that map's rows verbatim.
    for (const slot of [0, 2, 4]) {
      const base = slot * F32_PER_SLOT4;
      expect(f32[base + ROW_X]).toBe(2);
      expect(f32[base + ROW_Y + 1]).toBe(3);
      expect(f32[base + TRANS]).toBe(Math.fround(0.1));
    }
    for (const slot of [1, 3, 5]) {
      const base = slot * F32_PER_SLOT4;
      expect(f32[base + ROW_X]).toBe(6);
      expect(f32[base + ROW_Y + 1]).toBe(7);
      expect(f32[base + TRANS]).toBe(Math.fround(-0.4));
    }
  });

  it("sets hasPost and all four post rows only for the rotated copies (k > 0), from symmetryRotation4", () => {
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: twoBaseMaps(), symmetry: SYMMETRY }),
    );
    const f32 = new Float32Array(packed.slots);
    const u32 = new Uint32Array(packed.slots);

    // Copy 0 (slots 0, 1) is never rotated — hasPost and all sixteen post
    // lanes stay at the ArrayBuffer's zero default, mirroring
    // prepareChaosGame4's null.
    for (const slot of [0, 1]) {
      const base = slot * F32_PER_SLOT4;
      expect(u32[base + HAS_POST]).toBe(0);
      for (const row of [POST_X, POST_Y, POST_Z, POST_W]) {
        for (let c = 0; c < 4; c++) expect(f32[base + row + c]).toBe(0);
      }
    }

    // Copies 1 and 2 carry symmetryRotation4's DOUBLE rotation (a zw plane
    // plus its orthogonal xy complement, at twist 1) — the case with no 3D
    // counterpart at all.
    for (const k of [1, 2]) {
      const expected = symmetryRotation4("zw", (2 * Math.PI * k) / 3, 1);
      for (const i of [0, 1]) {
        const base = (k * 2 + i) * F32_PER_SLOT4;
        expect(u32[base + HAS_POST]).toBe(1);
        for (let c = 0; c < 4; c++) {
          expect(f32[base + POST_X + c]).toBeCloseTo(expected[c], 6);
          expect(f32[base + POST_Y + c]).toBeCloseTo(expected[4 + c], 6);
          expect(f32[base + POST_Z + c]).toBeCloseTo(expected[8 + c], 6);
          expect(f32[base + POST_W + c]).toBeCloseTo(expected[12 + c], 6);
        }
      }
    }
  });

  it("leaves hasPost 0 on the final-transform lens slot — a lens never rotates", () => {
    const packed = packGpuSystem4(
      baseSpec4({
        transforms4: twoBaseMaps(),
        symmetry: SYMMETRY,
        finalTransform4: { position: [0.7, 0.8, 0.9, 1], scale: [1, 1, 1, 1] },
      }),
    );
    const u32 = new Uint32Array(packed.slots);
    expect(u32[packed.transformCount * F32_PER_SLOT4 + HAS_POST]).toBe(0);
  });

  it("matches prepareChaosGame4's expanded weight table at default blend", () => {
    const transforms4: Transform4[] = [
      { position: [0.2, 0, 0, 0], scale: [0.5, 0.5, 0.5, 0.5], weight: 2 },
      { position: [-0.2, 0.1, 0, 0], scale: [0.6, 0.5, 0.4, 0.4], weight: 5 },
      { position: [0, -0.2, 0.1, 0], scale: [0.4, 0.4, 0.4, 0.4], weight: 1 },
    ];
    const symmetry: SymmetryParams = { order: 3, plane: "xw" };
    const prepared = prepareChaosGame4(transforms4, null, symmetry);
    const packed = packGpuSystem4(baseSpec4({ transforms4, symmetry }));

    expect(packed.transformCount).toBe(prepared.transformCount);
    expect(packed.baseTransformCount).toBe(prepared.baseTransformCount);
    expect(packed.weighted).toBe(prepared.weighted);
    expect(packed.totalWeight).toBe(prepared.totalWeight);

    const f32 = new Float32Array(packed.slots);
    const expectedCum = Array.from(prepared.cumulative);
    for (let s = 0; s < packed.transformCount; s++) {
      expect(f32[s * F32_PER_SLOT4 + CUM_WEIGHT]).toBeCloseTo(
        expectedCum[s],
        6,
      );
    }
  });

  it("deliberately ignores the in-flight morph blend that prepareChaosGame4 applies to rotated copies", () => {
    const transforms4 = makeTransforms4(1);
    const symmetry: SymmetryParams = { order: 3, plane: "xw", blend: 0.25 };
    const prepared = prepareChaosGame4(transforms4, null, symmetry);
    const packed = packGpuSystem4(baseSpec4({ transforms4, symmetry }));
    const f32 = new Float32Array(packed.slots);
    const packedCumulative = Array.from(
      { length: packed.transformCount },
      (_, s) => f32[s * F32_PER_SLOT4 + CUM_WEIGHT],
    );

    expect(Array.from(prepared.cumulative)).toEqual([1, 1.25, 1.5]);
    expect(prepared.weighted).toBe(true);
    expect(prepared.totalWeight).toBe(1.5);
    expect(packedCumulative).toEqual([1, 2, 3]);
    expect(packed.weighted).toBe(false);
    expect(packed.totalWeight).toBe(3);
  });

  it("replicates each BASE map's color pair across every copy of it, so the kernel needs no modulo", () => {
    const transforms4: Transform4[] = [
      {
        position: [0, 0, 0, 0],
        scale: [1, 1, 1, 1],
        colorIndex: 0.25,
        colorSpeed: 0.75,
      },
      {
        position: [0, 0, 0, 0],
        scale: [1, 1, 1, 1],
        colorIndex: 0.5,
        colorSpeed: 0.125,
      },
    ];
    const packed = packGpuSystem4(
      baseSpec4({ transforms4, symmetry: { order: 3, plane: "yw" } }),
    );
    expect(packed.transformCount).toBe(6);
    const f32 = new Float32Array(packed.slots);
    for (const slot of [0, 2, 4]) {
      expect(f32[slot * F32_PER_SLOT4 + COLOR_INDEX]).toBe(0.25);
      expect(f32[slot * F32_PER_SLOT4 + COLOR_SPEED]).toBe(0.75);
    }
    for (const slot of [1, 3, 5]) {
      expect(f32[slot * F32_PER_SLOT4 + COLOR_INDEX]).toBe(0.5);
      expect(f32[slot * F32_PER_SLOT4 + COLOR_SPEED]).toBe(0.125);
    }
  });

  it("packs order 1 (any plane, any twist) byte-identically to the pre-symmetry buffers", () => {
    const transforms4 = twoBaseMaps();
    const plain = packGpuSystem4(
      baseSpec4({ transforms4, symmetry: { order: 1, plane: "xz" } }),
    );
    const twisted = packGpuSystem4(
      baseSpec4({ transforms4, symmetry: { order: 1, plane: "zw", twist: 3 } }),
    );
    expect(new Uint8Array(twisted.slots)).toEqual(new Uint8Array(plain.slots));
    expect(twisted.transformCount).toBe(2);
    expect(twisted.baseTransformCount).toBe(2);
  });

  it("clamps the effective order to fit MAX_TRANSFORMS, exactly like prepareChaosGame4", () => {
    const transforms4 = makeTransforms4(100);
    const symmetry: SymmetryParams = { order: 5, plane: "zw" };
    const packed = packGpuSystem4(baseSpec4({ transforms4, symmetry }));
    expect(packed.transformCount).toBe(
      prepareChaosGame4(transforms4, null, symmetry).transformCount,
    );
    expect(packed.transformCount).toBe(200); // order 5 -> 2 (2 * 100 <= 256).
  });
});

describe("packGpuSystem4 colors", () => {
  it("sizes colors as 256 * 16 bytes", () => {
    const packed = packGpuSystem4(baseSpec4());
    expect(packed.colors.byteLength).toBe(256 * 16);
  });

  it("packs a structural color's 256-entry LUT with the fixed-point scale", () => {
    const lut = new Float32Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      lut[i * 3] = i / 255;
      lut[i * 3 + 1] = (255 - i) / 255;
      lut[i * 3 + 2] = 0.5;
    }
    const packed = packGpuSystem4(
      baseSpec4({ color: { kind: "structural", lut } }),
    );
    const colorsU32 = new Uint32Array(packed.colors);
    for (let i = 0; i < 256; i++) {
      expect(colorsU32[i * 4]).toBe(
        Math.round(lut[i * 3] * COLOR_FIXED_POINT_SCALE),
      );
      expect(colorsU32[i * 4 + 1]).toBe(
        Math.round(lut[i * 3 + 1] * COLOR_FIXED_POINT_SCALE),
      );
      expect(colorsU32[i * 4 + 2]).toBe(
        Math.round(lut[i * 3 + 2] * COLOR_FIXED_POINT_SCALE),
      );
      expect(colorsU32[i * 4 + 3]).toBe(0);
    }
  });

  it("packs a radius color's LUT with the same fixed-point scale as structural", () => {
    const lut = new Float32Array(256 * 3);
    lut[0] = 0.25;
    lut[1] = 0.5;
    lut[2] = 0.75;
    const packed = packGpuSystem4(
      baseSpec4({
        color: { kind: "radius", lut, center: [0, 0, 0, 0], minD: 0, maxD: 1 },
      }),
    );
    const colorsU32 = new Uint32Array(packed.colors);
    expect(colorsU32[0]).toBe(Math.round(0.25 * COLOR_FIXED_POINT_SCALE));
    expect(colorsU32[1]).toBe(Math.round(0.5 * COLOR_FIXED_POINT_SCALE));
    expect(colorsU32[2]).toBe(Math.round(0.75 * COLOR_FIXED_POINT_SCALE));
  });

  it("packs a height color's LUT through that identical fixed-point path", () => {
    const lut = new Float32Array(256 * 3);
    lut[64 * 3] = 0.125;
    lut[64 * 3 + 1] = 0.625;
    lut[64 * 3 + 2] = 1;
    const packed = packGpuSystem4(
      baseSpec4({ color: { kind: "height", lut, minY: -1, maxY: 3 } }),
    );
    const colorsU32 = new Uint32Array(packed.colors);
    expect(colorsU32[64 * 4]).toBe(Math.round(0.125 * COLOR_FIXED_POINT_SCALE));
    expect(colorsU32[64 * 4 + 1]).toBe(
      Math.round(0.625 * COLOR_FIXED_POINT_SCALE),
    );
    expect(colorsU32[64 * 4 + 2]).toBe(COLOR_FIXED_POINT_SCALE);
  });

  it("packs a transform color's palette per transform, white-padding entries past palette.length", () => {
    const palette: Vec3[] = [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ];
    const packed = packGpuSystem4(
      baseSpec4({
        transforms4: makeTransforms4(4),
        color: { kind: "transform", palette },
      }),
    );
    const colorsU32 = new Uint32Array(packed.colors);
    expect(colorsU32[0]).toBe(Math.round(0.1 * COLOR_FIXED_POINT_SCALE));
    expect(colorsU32[1]).toBe(Math.round(0.2 * COLOR_FIXED_POINT_SCALE));
    expect(colorsU32[2]).toBe(Math.round(0.3 * COLOR_FIXED_POINT_SCALE));
    expect(colorsU32[4]).toBe(Math.round(0.4 * COLOR_FIXED_POINT_SCALE));
    // Entries 2 and 3 (past palette.length 2, within transformCount 4) are
    // white-padded — the FALLBACK_COLOR every channel rounds to 256.
    expect(colorsU32[8]).toBe(256);
    expect(colorsU32[9]).toBe(256);
    expect(colorsU32[10]).toBe(256);
    expect(colorsU32[12]).toBe(256);
    expect(colorsU32[13]).toBe(256);
    expect(colorsU32[14]).toBe(256);
    // Entries beyond transformCount (4) are untouched (zero).
    expect(colorsU32[16]).toBe(0);
  });

  it("leaves the colors buffer all-zero for a wRamp color", () => {
    const packed = packGpuSystem4(
      baseSpec4({
        color: { kind: "wRamp", side: { neg: [1, 1, 1], pos: [1, 1, 1] } },
      }),
    );
    const colorsU32 = new Uint32Array(packed.colors);
    expect(colorsU32.every((v) => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The per-transform palette index + color speed the kernel's
// structural walk blends with, packed per slot (the 3D twin's own color-slot
// block, minus the kaleidoscope replication 4D has no copies for).
// ---------------------------------------------------------------------------

describe("packGpuSystem4 color slots", () => {
  it("packs a transform's authored colorIndex and colorSpeed verbatim", () => {
    const transforms4: Transform4[] = [
      {
        position: [0, 0, 0, 0],
        scale: [1, 1, 1, 1],
        colorIndex: 0.75,
        colorSpeed: 0.2,
      },
      {
        position: [0, 0, 0, 0],
        scale: [1, 1, 1, 1],
        colorIndex: 0.125,
        colorSpeed: 1,
      },
    ];
    const f32 = new Float32Array(
      packGpuSystem4(baseSpec4({ transforms4 })).slots,
    );
    expect(f32[COLOR_INDEX]).toBe(0.75);
    expect(f32[COLOR_SPEED]).toBe(Math.fround(0.2));
    expect(f32[F32_PER_SLOT4 + COLOR_INDEX]).toBe(0.125);
    expect(f32[F32_PER_SLOT4 + COLOR_SPEED]).toBe(1);
  });

  it("falls back to the even i/(n-1) spread and the 0.5 halfway speed when a transform authors neither", () => {
    // Three maps with no color fields: derivedColorIndex spreads them 0, 0.5,
    // 1 across the gradient and every speed is DEFAULT_COLOR_SPEED — the
    // behavior the kernel hard-coded before those fields existed. Keyed on
    // the RAW
    // transform count: 4D has no symmetry copies to collapse.
    const f32 = new Float32Array(
      packGpuSystem4(baseSpec4({ transforms4: makeTransforms4(3) })).slots,
    );
    expect([0, 1, 2].map((s) => f32[s * F32_PER_SLOT4 + COLOR_INDEX])).toEqual([
      0, 0.5, 1,
    ]);
    expect([0, 1, 2].map((s) => f32[s * F32_PER_SLOT4 + COLOR_SPEED])).toEqual([
      0.5, 0.5, 0.5,
    ]);
  });

  it("gives a lone map the 0.5 midpoint rather than a 0/0 spread", () => {
    const f32 = new Float32Array(
      packGpuSystem4(baseSpec4({ transforms4: makeTransforms4(1) })).slots,
    );
    expect(f32[COLOR_INDEX]).toBe(0.5);
  });

  it("resolves each field independently — an authored speed does not suppress the derived index, or vice versa", () => {
    const transforms4: Transform4[] = [
      { position: [0, 0, 0, 0], scale: [1, 1, 1, 1], colorSpeed: 0.9 },
      { position: [0, 0, 0, 0], scale: [1, 1, 1, 1], colorIndex: 0.25 },
    ];
    const f32 = new Float32Array(
      packGpuSystem4(baseSpec4({ transforms4 })).slots,
    );
    expect(f32[COLOR_INDEX]).toBe(0); // index absent -> derived 0.
    expect(f32[COLOR_SPEED]).toBe(Math.fround(0.9));
    expect(f32[F32_PER_SLOT4 + COLOR_INDEX]).toBe(0.25);
    expect(f32[F32_PER_SLOT4 + COLOR_SPEED]).toBe(0.5); // speed absent -> 0.5.
  });

  it("leaves the final-lens slot's pair at zero — the pick never draws it", () => {
    const finalTransform4: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [1, 1, 1, 1],
    };
    const packed = packGpuSystem4(baseSpec4({ finalTransform4 }));
    const f32 = new Float32Array(packed.slots);
    const base = packed.transformCount * F32_PER_SLOT4;
    expect(f32[base + COLOR_INDEX]).toBe(0);
    expect(f32[base + COLOR_SPEED]).toBe(0);
  });
});

describe("packGpuChains4", () => {
  it("sizes the buffer as numChains * CHAIN4_STRIDE_BYTES", () => {
    const buf = packGpuChains4(10, 1);
    expect(buf.byteLength).toBe(10 * CHAIN4_STRIDE_BYTES);
  });

  it("is deterministic for a given seed", () => {
    const a = new Uint8Array(packGpuChains4(4, 7));
    const b = new Uint8Array(packGpuChains4(4, 7));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("differs for different seeds", () => {
    const a = new Uint8Array(packGpuChains4(4, 7));
    const b = new Uint8Array(packGpuChains4(4, 8));
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("draws pos.xyzw from rng() - 0.5 each, a fixed 0.5 color coordinate with no draw, then one aux.x seed and one odd aux.z stream increment, continuing the SAME rng sequence across chains", () => {
    const numChains = 2;
    const seed = 42;
    const buf = packGpuChains4(numChains, seed);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    const f32PerChain = CHAIN4_STRIDE_BYTES / 4; // 8

    // A hand-rolled mulberry32(seed) sequence, drawn in the exact documented
    // order — the oracle packGpuChains4 must agree with, independent of its
    // own implementation. One `rng` instance spans both chains below, so
    // chain 1 continuing the SAME sequence (not restarting it) is pinned too.
    const rng = mulberry32(seed);
    for (let c = 0; c < numChains; c++) {
      const base = c * f32PerChain;
      const expectedX = rng() - 0.5;
      const expectedY = rng() - 0.5;
      const expectedZ = rng() - 0.5;
      const expectedW = rng() - 0.5;
      const expectedAux = Math.floor(rng() * 0x100000000) >>> 0;
      const expectedInc = ((Math.floor(rng() * 0x100000000) << 1) | 1) >>> 0;
      expect(f32[base]).toBe(Math.fround(expectedX));
      expect(f32[base + 1]).toBe(Math.fround(expectedY));
      expect(f32[base + 2]).toBe(Math.fround(expectedZ));
      expect(f32[base + 3]).toBe(Math.fround(expectedW));
      expect(f32[base + 5]).toBe(0.5);
      expect(u32[base + 4]).toBe(expectedAux);
      expect(u32[base + 6]).toBe(expectedInc);
    }
  });

  it("gives every chain an odd stream increment, distinct across chains", () => {
    const numChains = 512;
    const u32 = new Uint32Array(packGpuChains4(numChains, 1234));
    const incs: number[] = [];
    for (let c = 0; c < numChains; c++) {
      const inc = u32[c * (CHAIN4_STRIDE_BYTES / 4) + 6];
      expect(inc & 1).toBe(1);
      incs.push(inc);
    }
    expect(new Set(incs).size).toBe(numChains);
  });
});

describe("packGpuParams4", () => {
  // Params4 element offsets (4-byte units), restated directly from
  // flame-gpu-4d.ts's byte-layout doc comment, independent of that module's
  // own (private) offset constants.
  const PROJ_X = 0;
  const PROJ_Y = 4;
  const PROJ_W = 8;
  const PROJ_S = 12;
  const PROJ_C = 16;
  const CENTER = 20;
  const NEG_COLOR = 24;
  const POS_COLOR = 28;
  const WIDTH = 32;
  const HEIGHT = 33;
  const TRANSFORM_COUNT = 34;
  const BASE_TRANSFORM_COUNT = 35;
  const ITERS_PER_INVOCATION = 36;
  const COLOR_KIND = 37;
  const WEIGHTED = 38;
  const HAS_FINAL = 39;
  const NUM_CHAINS = 40;
  const TOTAL_WEIGHT = 41;
  const INV_W_AMP = 42;
  const SLICE_ON = 43;
  const SLICE_CENTER = 44;
  const SLICE_WIDTH = 45;
  const MIN_D = 46;
  const INV_RADIUS_RANGE = 47;
  const SLICE_COLOR_SHIFT = 48;
  const SLICE_COLOR_INV_SCALE = 49;
  const ECHO_WEIGHT = 50;
  const ECHO_RHO = 51;
  const ECHO_PROJ_X = 52;
  const ECHO_PROJ_Y = 56;
  const ECHO_PROJ_Z = 60;
  const ECHO_PROJ_C = 64;
  const ECHO_CAMERA_X = 68;
  const ECHO_CAMERA_Y = 72;
  const ECHO_CAMERA_W = 76;
  const ECHO_CENTER_R2 = 80;
  const ECHO_TINT_STRENGTH = 84;
  const ECHO_PALETTE_ENABLED = 88;
  const EMITTER_OVERLAP_ATTEMPTS_WORD = 94;
  const COLOR_MIN = 96;
  const COLOR_INV_RANGE_GAMMA = 100;
  const AXIS_X = 104;
  const AXIS_Y = 108;
  const AXIS_Z = 112;
  const UNIFORM_COLOR = 116;

  const VIEW: FourDView = {
    invWAmp: 2.5,
    sliceOn: true,
    sliceCenter: 0.25,
    sliceWidth: 0.3,
    sliceRelativeColor: false,
  };

  function makeProjection(): Float64Array {
    const projection = new Float64Array(20);
    for (let i = 0; i < 20; i++) projection[i] = i * 0.01 + 1;
    return projection;
  }

  function fields4(
    overrides: Partial<GpuParams4Fields> = {},
  ): GpuParams4Fields {
    return {
      projection: makeProjection(),
      width: 640,
      height: 480,
      transformCount: 12,
      baseTransformCount: 4,
      itersPerInvocation: 256,
      weighted: true,
      hasFinal: true,
      totalWeight: 9.5,
      numChains: 65536,
      view: VIEW,
      color: {
        kind: "wRamp",
        side: { neg: [0.1, 0.2, 0.3], pos: [0.4, 0.5, 0.6] },
      },
      scheduleCount: 0,
      scheduleDepth: 0,
      scheduleWeighted: false,
      scheduleTotalWeight: 0,
      chaosEnabled: false,
      ...overrides,
      echoPalette: overrides.echoPalette ?? false,
    };
  }

  it("writes every projection row and scalar field at its documented element offset", () => {
    const projection = makeProjection();
    const buf = packGpuParams4(fields4({ projection }));
    expect(buf.byteLength).toBe(PARAMS4_BYTES);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);

    for (let i = 0; i < 4; i++) {
      expect(f32[PROJ_X + i]).toBe(Math.fround(projection[i]));
      expect(f32[PROJ_Y + i]).toBe(Math.fround(projection[5 + i]));
      expect(f32[PROJ_W + i]).toBe(Math.fround(projection[10 + i]));
      expect(f32[PROJ_S + i]).toBe(Math.fround(projection[15 + i]));
    }
    expect(f32[PROJ_C]).toBe(Math.fround(projection[4]));
    expect(f32[PROJ_C + 1]).toBe(Math.fround(projection[9]));
    expect(f32[PROJ_C + 2]).toBe(Math.fround(projection[14]));
    expect(f32[PROJ_C + 3]).toBe(Math.fround(projection[19]));

    expect(u32[WIDTH]).toBe(640);
    expect(u32[HEIGHT]).toBe(480);
    expect(u32[TRANSFORM_COUNT]).toBe(12);
    expect(u32[BASE_TRANSFORM_COUNT]).toBe(4);
    expect(u32[ITERS_PER_INVOCATION]).toBe(256);
    expect(ITERS_PER_INVOCATION * 4).toBe(PARAMS4_ITERS_OFFSET_BYTES);
    expect(u32[COLOR_KIND]).toBe(KERNEL_COLOR_KIND.wRamp);
    expect(u32[WEIGHTED]).toBe(1);
    expect(u32[HAS_FINAL]).toBe(1);
    expect(u32[NUM_CHAINS]).toBe(65536);
    expect(f32[TOTAL_WEIGHT]).toBeCloseTo(9.5, 6);
    expect(f32[INV_W_AMP]).toBe(Math.fround(2.5));
    expect(u32[SLICE_ON]).toBe(1);
    expect(f32[SLICE_CENTER]).toBeCloseTo(0.25, 6);
    expect(f32[SLICE_WIDTH]).toBeCloseTo(0.3, 6);
    // The slice-relative remap stays the identity here: VIEW's
    // sliceRelativeColor is false, so sliceOn alone isn't enough to opt in
    // (see sliceColorRemap).
    expect(f32[SLICE_COLOR_SHIFT]).toBe(0);
    expect(f32[SLICE_COLOR_INV_SCALE]).toBe(1);
    // Optional echo absent: every field in its tail block stays zero.
    expect(Array.from(u32.slice(50, 92))).toEqual(new Array(42).fill(0));
    expect(u32[EMITTER_OVERLAP_ATTEMPTS_WORD]).toBe(EMITTER_OVERLAP_ATTEMPTS);
    expect(u32[95]).toBe(0); // final Params4 alignment pad
  });

  it("packs project-then-invert echo rows and its echo-only tint", () => {
    const rotorProjection = new Float64Array(20);
    for (let i = 0; i < 20; i++) rotorProjection[i] = 10 + i / 10;
    // prettier-ignore
    const cameraProjection: Mat4 = [
      1, 2, 3, 4,
      5, 6, 7, 8,
      9, 10, 11, 12,
      13, 14, 15, 16,
    ];
    const f32 = new Float32Array(
      packGpuParams4(
        fields4({
          echo: {
            balloon: { center: [1.5, -2.25, 3], rho: 4.5, R: 2 },
            tint: [0.2, 0.4, 0.8],
            tintStrength: 0.6,
            weight: 0.5,
          },
          rotorProjection,
          cameraProjection,
          echoPalette: true,
        }),
      ),
    );
    expect(f32[ECHO_WEIGHT]).toBe(0.5);
    expect(f32[ECHO_RHO]).toBe(4.5);
    for (let i = 0; i < 4; i++) {
      expect(f32[ECHO_PROJ_X + i]).toBe(Math.fround(rotorProjection[i]));
      expect(f32[ECHO_PROJ_Y + i]).toBe(Math.fround(rotorProjection[5 + i]));
      expect(f32[ECHO_PROJ_Z + i]).toBe(Math.fround(rotorProjection[10 + i]));
      expect(f32[ECHO_CAMERA_X + i]).toBe(cameraProjection[i]);
      expect(f32[ECHO_CAMERA_Y + i]).toBe(cameraProjection[4 + i]);
      expect(f32[ECHO_CAMERA_W + i]).toBe(cameraProjection[12 + i]);
    }
    expect(Array.from(f32.slice(ECHO_PROJ_C, ECHO_PROJ_C + 4))).toEqual([
      Math.fround(rotorProjection[4]),
      Math.fround(rotorProjection[9]),
      Math.fround(rotorProjection[14]),
      0,
    ]);
    expect(Array.from(f32.slice(ECHO_CENTER_R2, ECHO_CENTER_R2 + 4))).toEqual([
      1.5, -2.25, 3, 4,
    ]);
    expect(
      Array.from(f32.slice(ECHO_TINT_STRENGTH, ECHO_TINT_STRENGTH + 4)),
    ).toEqual([
      Math.fround(0.2),
      Math.fround(0.4),
      Math.fround(0.8),
      Math.fround(0.6),
    ]);
    expect(new Uint32Array(f32.buffer)[ECHO_PALETTE_ENABLED]).toBe(1);
  });

  it("rejects an echo without both uncomposed projection stages", () => {
    const echo = {
      balloon: { center: [0, 0, 0] as Vec3, rho: 1, R: 1 },
      tint: [0, 0, 0] as Vec3,
      tintStrength: 0,
      weight: 0.5,
    };
    expect(() => packGpuParams4(fields4({ echo }))).toThrow(
      /rotorProjection with 20 entries/,
    );
    expect(() =>
      packGpuParams4({
        ...fields4({ echo }),
        rotorProjection: new Float64Array(20),
      }),
    ).toThrow(/cameraProjection with 16 entries/);
  });

  it("packs the slice-relative color remap into sliceColorShift/sliceColorInvScale when both the slice and the option are on", () => {
    const buf = packGpuParams4(
      fields4({
        view: {
          invWAmp: 1,
          sliceOn: true,
          sliceCenter: 0.25,
          sliceWidth: 0.3,
          sliceRelativeColor: true,
        },
      }),
    );
    const f32 = new Float32Array(buf);
    expect(f32[SLICE_COLOR_SHIFT]).toBeCloseTo(0.25, 6);
    // 1 / (SLICE_COLOR_SPAN * sliceWidth) = 1 / (2 * 0.3) = 1 / 0.6; f32
    // storage rounds it, hence toBeCloseTo rather than toBe.
    expect(f32[SLICE_COLOR_INV_SCALE]).toBeCloseTo(1 / 0.6, 5);
  });

  it("stays the identity (0, 1) when sliceRelativeColor is true but the slice is off", () => {
    const buf = packGpuParams4(
      fields4({
        view: {
          invWAmp: 1,
          sliceOn: false,
          sliceCenter: 0.25,
          sliceWidth: 0.3,
          sliceRelativeColor: true,
        },
      }),
    );
    const f32 = new Float32Array(buf);
    expect(f32[SLICE_COLOR_SHIFT]).toBe(0);
    expect(f32[SLICE_COLOR_INV_SCALE]).toBe(1);
  });

  it("packs the wRamp side colors into negColor/posColor xyz lanes, leaving center/minD/invRadiusRange at zero", () => {
    const buf = packGpuParams4(
      fields4({
        color: {
          kind: "wRamp",
          side: { neg: [0.1, 0.2, 0.3], pos: [0.4, 0.5, 0.6] },
        },
      }),
    );
    const f32 = new Float32Array(buf);
    expect(f32[NEG_COLOR]).toBe(Math.fround(0.1));
    expect(f32[NEG_COLOR + 1]).toBe(Math.fround(0.2));
    expect(f32[NEG_COLOR + 2]).toBe(Math.fround(0.3));
    expect(f32[POS_COLOR]).toBe(Math.fround(0.4));
    expect(f32[POS_COLOR + 1]).toBe(Math.fround(0.5));
    expect(f32[POS_COLOR + 2]).toBe(Math.fround(0.6));
    for (let i = 0; i < 4; i++) expect(f32[CENTER + i]).toBe(0);
    expect(f32[MIN_D]).toBe(0);
    expect(f32[INV_RADIUS_RANGE]).toBe(0);
  });

  it("packs a radius color's center/minD/invRadiusRange, leaving negColor/posColor at zero", () => {
    const center: Vec4 = [0.1, 0.2, 0.3, 0.4];
    const buf = packGpuParams4(
      fields4({
        color: {
          kind: "radius",
          lut: new Float32Array(256 * 3),
          center,
          minD: 0.5,
          maxD: 2.5,
        },
      }),
    );
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    for (let i = 0; i < 4; i++) {
      expect(f32[CENTER + i]).toBe(Math.fround(center[i]));
    }
    expect(f32[MIN_D]).toBe(0.5);
    expect(f32[INV_RADIUS_RANGE]).toBe(Math.fround(1 / 2));
    expect(u32[COLOR_KIND]).toBe(KERNEL_COLOR_KIND.radius);
    for (let i = 0; i < 3; i++) {
      expect(f32[NEG_COLOR + i]).toBe(0);
      expect(f32[POS_COLOR + i]).toBe(0);
    }
  });

  it("guards a degenerate radius range (minD === maxD) with invRadiusRange = 1", () => {
    const buf = packGpuParams4(
      fields4({
        color: {
          kind: "radius",
          lut: new Float32Array(256 * 3),
          center: [0, 0, 0, 0],
          minD: 1,
          maxD: 1,
        },
      }),
    );
    const f32 = new Float32Array(buf);
    expect(f32[INV_RADIUS_RANGE]).toBe(1);
  });

  it("packs Height raw-Y bounds and its dedicated color kind", () => {
    const f32 = new Float32Array(
      packGpuParams4(
        fields4({
          color: {
            kind: "height",
            lut: new Float32Array(256 * 3),
            minY: -2,
            maxY: 6,
          },
        }),
      ),
    );
    expect(f32[COLOR_MIN + 1]).toBe(-2);
    expect(f32[COLOR_INV_RANGE_GAMMA + 1]).toBe(0.125);
    expect(new Uint32Array(f32.buffer)[COLOR_KIND]).toBe(
      KERNEL_COLOR_KIND.height,
    );
  });

  it("packs Position raw-XYZ bounds, contrast, and custom axis colors", () => {
    const f32 = new Float32Array(
      packGpuParams4(
        fields4({
          color: {
            kind: "position",
            min: [-1, -2, -3],
            max: [3, 2, 1],
            colorGamma: 2,
            axisColors: {
              x: [0.1, 0.2, 0.3],
              y: [0.4, 0.5, 0.6],
              z: [0.7, 0.8, 0.9],
            },
          },
        }),
      ),
    );
    expect(Array.from(f32.slice(COLOR_MIN, COLOR_MIN + 3))).toEqual([
      -1, -2, -3,
    ]);
    expect(
      Array.from(f32.slice(COLOR_INV_RANGE_GAMMA, COLOR_INV_RANGE_GAMMA + 4)),
    ).toEqual([0.25, 0.25, 0.25, 2]);
    expect(Array.from(f32.slice(AXIS_X, AXIS_X + 3))).toEqual(
      [0.1, 0.2, 0.3].map(Math.fround),
    );
    expect(Array.from(f32.slice(AXIS_Y, AXIS_Y + 3))).toEqual(
      [0.4, 0.5, 0.6].map(Math.fround),
    );
    expect(Array.from(f32.slice(AXIS_Z, AXIS_Z + 3))).toEqual(
      [0.7, 0.8, 0.9].map(Math.fround),
    );
    expect(new Uint32Array(f32.buffer)[COLOR_KIND]).toBe(
      KERNEL_COLOR_KIND.position,
    );
  });

  it("packs Uniform's cyan and leaves the legacy Params prefix intact", () => {
    const f32 = new Float32Array(
      packGpuParams4(
        fields4({ color: { kind: "uniform", color: [0.4, 0.8, 1] } }),
      ),
    );
    expect(Array.from(f32.slice(UNIFORM_COLOR, UNIFORM_COLOR + 3))).toEqual(
      [0.4, 0.8, 1].map(Math.fround),
    );
    expect(new Uint32Array(f32.buffer)[COLOR_KIND]).toBe(
      KERNEL_COLOR_KIND.uniform,
    );
  });

  it("throws RangeError naming the actual length when projection.length !== 20", () => {
    const shortProjection = new Float64Array(16);
    expect(() =>
      packGpuParams4(fields4({ projection: shortProjection })),
    ).toThrow(RangeError);
    expect(() =>
      packGpuParams4(fields4({ projection: shortProjection })),
    ).toThrow(/\b16\b/);
  });
});

describe("convertGpuHistogram4", () => {
  function makeWords(
    width: number,
    height: number,
    buckets: Record<number, number[]>,
  ): Uint32Array {
    const words = new Uint32Array(width * height * HIST_U32_PER_BUCKET);
    for (const [bucket, values] of Object.entries(buckets)) {
      const w = Number(bucket) * HIST_U32_PER_BUCKET;
      values.forEach((v, i) => {
        words[w + i] = v;
      });
    }
    return words;
  }

  it("divides hits by WEIGHT_FIXED_POINT_SCALE and sumRGB by COLOR_FIXED_POINT_SCALE * WEIGHT_FIXED_POINT_SCALE", () => {
    const words = makeWords(2, 1, {
      0: [512, 0, 131072, 0, 65536, 0, 0, 1],
    });
    const hist = convertGpuHistogram4(words, 2, 1);
    expect(hist.hits[0]).toBe(512 / WEIGHT_FIXED_POINT_SCALE);
    expect(hist.sumRGB[0]).toBe(
      131072 / (COLOR_FIXED_POINT_SCALE * WEIGHT_FIXED_POINT_SCALE),
    );
    expect(hist.sumRGB[1]).toBe(1);
    expect(hist.sumRGB[2]).toBe(
      2 ** 32 / (COLOR_FIXED_POINT_SCALE * WEIGHT_FIXED_POINT_SCALE),
    );
    expect(hist.maxHits).toBe(2);
  });

  it("combines the hi word into the hits count (hitsHi=1 -> 2^32 / WEIGHT_FIXED_POINT_SCALE)", () => {
    const words = makeWords(1, 1, { 0: [0, 1, 0, 0, 0, 0, 0, 0] });
    const hist = convertGpuHistogram4(words, 1, 1);
    expect(hist.hits[0]).toBe(2 ** 32 / WEIGHT_FIXED_POINT_SCALE);
  });

  it("throws RangeError on a words length mismatch", () => {
    const words = new Uint32Array(10);
    expect(() => convertGpuHistogram4(words, 4, 4)).toThrow(RangeError);
  });

  it("throws RangeError when out has different dimensions than requested", () => {
    const out = createFlameHistogram(3, 3);
    const words = new Uint32Array(2 * 2 * HIST_U32_PER_BUCKET);
    expect(() => convertGpuHistogram4(words, 2, 2, out)).toThrow(RangeError);
  });

  it("fully overwrites a reused out histogram's stale nonzero buckets with an all-zero conversion, returning the same object", () => {
    const out = createFlameHistogram(2, 1);
    out.hits[0] = 12345;
    out.hits[1] = 6789;
    out.sumRGB.fill(42);
    out.maxHits = 12345;

    const words = new Uint32Array(2 * HIST_U32_PER_BUCKET); // all zero.
    const hist = convertGpuHistogram4(words, 2, 1, out);

    expect(hist).toBe(out); // reused, not reallocated.
    expect(Array.from(hist.hits)).toEqual([0, 0]);
    expect(Array.from(hist.sumRGB)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(hist.maxHits).toBe(0);
  });
});

describe("convertGpuDisplayHistogram4", () => {
  it("divides every channel by WEIGHT_FIXED_POINT_SCALE", () => {
    const out = createFlameHistogram(1, 1);
    const data = new Float32Array([256, 512, 768, 1024]);
    const hist = convertGpuDisplayHistogram4(data, 1, 1, out);
    expect(hist).toBe(out); // reused, not reallocated.
    expect(hist.hits[0]).toBe(1);
    expect(Array.from(hist.sumRGB)).toEqual([2, 3, 4]);
    expect(hist.maxHits).toBe(1);
  });

  it("throws RangeError on a data length mismatch", () => {
    const out = createFlameHistogram(2, 2);
    const data = new Float32Array(10);
    expect(() => convertGpuDisplayHistogram4(data, 2, 2, out)).toThrow(
      RangeError,
    );
  });

  it("throws RangeError when out has different dimensions than requested", () => {
    const out = createFlameHistogram(3, 3);
    const data = new Float32Array(2 * 2 * 4);
    expect(() => convertGpuDisplayHistogram4(data, 2, 2, out)).toThrow(
      RangeError,
    );
  });

  it("fully overwrites a reused out histogram's stale nonzero buckets", () => {
    const out = createFlameHistogram(2, 1);
    out.hits[0] = 12345;
    out.hits[1] = 6789;
    out.sumRGB.fill(42);
    out.maxHits = 12345;

    const data = new Float32Array([7 * 256, 0, 0, 0, 0, 0, 0, 0]); // bucket 1 all-zero.
    const hist = convertGpuDisplayHistogram4(data, 2, 1, out);

    expect(hist.hits[0]).toBe(7);
    expect(hist.hits[1]).toBe(0); // stale 6789 must not survive.
    expect(Array.from(hist.sumRGB)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(hist.maxHits).toBe(7);
  });
});

describe("FLAME_GPU_KERNEL_4D_WGSL", () => {
  it("colors Height/Position from the raw plotted point, before view projection", () => {
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
      "(pp.y - params.colorMin.y) * params.colorInvRangeGamma.y",
    );
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
      "(pp.xyz - params.colorMin.xyz) * params.colorInvRangeGamma.xyz",
    );
  });

  it("interpolates WORKGROUP_SIZE and WEIGHT_FIXED_POINT_SCALE into the kernel source", () => {
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
      `@workgroup_size(${WORKGROUP_SIZE})`,
    );
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
      `round(weight * ${WEIGHT_FIXED_POINT_SCALE}.0)`,
    );
  });

  it("declares the PLOT override and the accumulate entry point", () => {
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain("override PLOT: bool = true;");
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain("fn accumulate(");
  });

  it("project-then-inverts in visible 3D and deposits the echo independently", () => {
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain("fn depositPrimary(");
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain("fn depositEcho(");
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
      "dot(params.echoProjX, pp) + params.echoProjC.x",
    );
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
      "let centerFloor = 1e-6 * params.echoRho;",
    );
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
      "depositEcho(inv, echoRgb, echoWeightFix);",
    );
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
      "let u = clamp(length(d) / params.echoRho, 0.0, 1.0);",
    );
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain(
      "echoBase = echoColors[li].xyz;",
    );
  });

  it("keeps tint echo-only and omits radial fade/conformal magnification", () => {
    expect(FLAME_GPU_KERNEL_4D_WGSL).toContain("params.echoTintStrength");
    expect(FLAME_GPU_KERNEL_4D_WGSL).not.toContain("echoFade");
    expect(FLAME_GPU_KERNEL_4D_WGSL).not.toContain("echoMag");
  });
});

// ---------------------------------------------------------------------------
// The 4D twin of flame-gpu.test.ts's "FLAME_GPU_KERNEL_WGSL
// variation switch" block. The exact case numbering (linear: 0, sinusoidal:
// 1, ...) is pinned ONCE, in that file — this file doesn't repeat the
// literal because the 4D kernel is hand-written against the SAME
// KERNEL_VARIATION_INDEX table, imported from flame-gpu.ts rather than kept
// as a 4D-local copy (see this module's own doc comment). What these
// tests check is that the 4D kernel's switch actually matches that shared
// table — the same silent-`linear`-fallback failure mode as the 3D kernel
// if it doesn't.
// ---------------------------------------------------------------------------

describe("FLAME_GPU_KERNEL_4D_WGSL variation switch", () => {
  /** Slices out just the `applyVariation` function body from a kernel
   * source. Duplicated from flame-gpu.test.ts rather than shared — this
   * repo's tests are deliberately DAMP. The 4D kernel has OTHER switches
   * later in its source (a color-mode dispatch with its own `case 0u: { //
   * structural:` etc.) that would poison a whole-source case scan, so this
   * narrows to the one function between `fn applyVariation` and the next
   * top-level `fn `. */
  function applyVariationBody(wgsl: string): string {
    const start = wgsl.indexOf("fn applyVariation");
    const end = wgsl.indexOf("\nfn ", start);
    return wgsl.slice(start, end === -1 ? wgsl.length : end);
  }

  it("has a case for every variation type at its index, labeled with that variation's name", () => {
    const body = applyVariationBody(FLAME_GPU_KERNEL_4D_WGSL);
    // The 4D kernel's case comments carry extra suffixes after the name
    // (e.g. "// spherical — full 4D radius."), unlike the 3D kernel's bare
    // "// spherical" — the \b boundary matches the name either way.
    for (const name of VARIATION_TYPES) {
      expect(body).toMatch(
        new RegExp(`case ${KERNEL_VARIATION_INDEX[name]}u: \\{ // ${name}\\b`),
      );
    }
  });

  it("switches on exactly the KERNEL_VARIATION_INDEX values — no missing or extra cases", () => {
    const body = applyVariationBody(FLAME_GPU_KERNEL_4D_WGSL);
    const cases = [...body.matchAll(/case (\d+)u:/g)]
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
    const expected = Object.values(KERNEL_VARIATION_INDEX).sort(
      (a, b) => a - b,
    );
    // Same silent failure as the 3D kernel: a case missing from the switch
    // falls into WGSL's `default` and renders as `linear`.
    expect(cases).toEqual(expected);
  });

  it("carries w through the bulb power untouched — the ONE line where this kernel departs from the 3D one", () => {
    // The triplex 8th power has no fourth component to give meaning to
    // (bulb-de.ts's model refusal), so variations4.ts's rule is that w
    // rides along, and the kernel's only legitimate difference from the 3D
    // text is the vec4f that carries it. The text identity itself is pinned
    // once, in flame-gpu.test.ts's "the flame kernels' triplexPow8" block,
    // which reads both kernels; this is the 4D half's own claim.
    const body = applyVariationBody(FLAME_GPU_KERNEL_4D_WGSL);
    expect(body).toContain(
      "      return vec4f(rho * s * u8, rho * s * v8, zOut, p.w);",
    );
    // ...and w is touched NOWHERE else in the case: the polar/azimuth
    // arithmetic reads x, y and z alone.
    const open = body.indexOf("    case 16u: {");
    expect(open).toBeGreaterThan(-1);
    const arithmetic = body.slice(
      body.indexOf("      let a = ", open),
      body.indexOf("\n      return ", open),
    );
    expect(arithmetic).not.toContain("p.w");
  });
});

describe("packGpuSystem4 chaos rows (the chi lane)", () => {
  // The 3D packer's chi fixture one dimension up: order 2 expands 2 base
  // maps to 4 slots, so the packed rows must weigh the EXPANDED slot list
  // (a kaleidoscope copy inherits its base map's chi column). Values are
  // asserted against prepareChaosGame4's OWN prepared tables — the
  // transfer contract, through flame-gpu.ts's shared packChaosRowsTable.
  const CHI_TRANSFORMS4: Transform4[] = [
    {
      position: [0.5, 0, 0, 0],
      scale: [0.5, 0.5, 0.5, 0.5],
      weight: 3,
      chaos: [1, 0.5],
    },
    {
      position: [0, 0.5, 0, 0],
      scale: [0.5, 0.5, 0.5, 0.5],
      weight: 1,
      chaos: [2, 1],
    },
  ];
  const CHI_SYMMETRY: SymmetryParams = { order: 2, plane: "xz" };

  it("transfers buildChaosSelection's tables through the shared packChaosRowsTable — totals first, then rows over the expanded slots", () => {
    const packed = packGpuSystem4(
      baseSpec4({ transforms4: CHI_TRANSFORMS4, symmetry: CHI_SYMMETRY }),
    );
    const prepared = prepareChaosGame4(CHI_TRANSFORMS4, null, CHI_SYMMETRY);
    expect(packed.chaosRows).not.toBeNull();
    const f32 = new Float32Array(packed.chaosRows!);
    expect(f32.length).toBe(2 + 2 * 4);
    for (let i = 0; i < 2; i++) {
      expect(f32[i]).toBe(Math.fround(prepared.chaosRowTotals![i]));
      for (let s = 0; s < 4; s++) {
        expect(f32[2 + i * 4 + s]).toBe(Math.fround(prepared.chaosRows![i][s]));
      }
    }
  });

  it("no longer throws on a chi-carrying 4D system — the defense-in-depth guard went out with the kernels' lift", () => {
    const transforms4 = makeTransforms4(2).map((t, i) =>
      i === 0 ? { ...t, chaos: [1, 0] } : t,
    );
    expect(() => packGpuSystem4(baseSpec4({ transforms4 }))).not.toThrow();
    expect(packGpuSystem4(baseSpec4({ transforms4 })).chaosRows).not.toBeNull();
  });

  it("packs chaosRows null for a chi-free system, and for an all-trivial row that selects exactly as no row at all", () => {
    expect(packGpuSystem4(baseSpec4()).chaosRows).toBeNull();
    const trivial = makeTransforms4(2).map((t) => ({ ...t, chaos: [1, 1] }));
    expect(
      packGpuSystem4(baseSpec4({ transforms4: trivial })).chaosRows,
    ).toBeNull();
  });
});

describe("packGpuSystem4 scheduled-hybrid B slots", () => {
  const schedule = {
    transforms: [
      {
        id: 0,
        position: [-0.5, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [0.5, 0.5, 0.5] as Vec3,
      },
      {
        id: 1,
        position: [0.5, 0.25, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [0.5, 0.5, 0.5] as Vec3,
        weight: 3,
      },
    ],
    depth: 2,
  };

  it("a schedule-less spec packs byte-identically (null and absent alike)", () => {
    const base = packGpuSystem4(baseSpec4());
    const withNull = packGpuSystem4(baseSpec4({ schedule: null }));
    expect(new Uint8Array(withNull.slots)).toEqual(new Uint8Array(base.slots));
    expect(base.slots.byteLength).toBe((2 + 1) * SLOT4_STRIDE_BYTES);
    expect(base.scheduleCount).toBe(0);
    expect(base.scheduleDepth).toBe(0);
    const dead = packGpuSystem4(
      baseSpec4({ schedule: { ...schedule, depth: 0 } }),
    );
    expect(new Uint8Array(dead.slots)).toEqual(new Uint8Array(base.slots));
  });

  it("appends B slots lifted through toTransform4 after the lens slot", () => {
    const packed = packGpuSystem4(baseSpec4({ schedule }));
    expect(packed.scheduleCount).toBe(2);
    expect(packed.scheduleDepth).toBe(2);
    expect(packed.scheduleWeighted).toBe(true);
    expect(packed.scheduleTotalWeight).toBe(4);
    expect(packed.slots.byteLength).toBe((2 + 1 + 2) * SLOT4_STRIDE_BYTES);

    const f32 = new Float32Array(packed.slots);
    const u32 = new Uint32Array(packed.slots);
    // B slot 0 at index transformCount + 1 = 3: the lift's own composed 4D
    // affine — the exact bytes prepareSchedule4 hands the CPU oracle.
    const b0 = 3 * F32_PER_SLOT4;
    const lifted = composeAffine4(toTransform4(schedule.transforms[0]));
    for (let c = 0; c < 4; c++) {
      expect(f32[b0 + ROW_X + c]).toBe(Math.fround(lifted.m[c]));
      expect(f32[b0 + ROW_W + c]).toBe(Math.fround(lifted.m[12 + c]));
      expect(f32[b0 + TRANS + c]).toBe(Math.fround(lifted.t[c]));
    }
    expect(u32[b0 + VAR_COUNT]).toBe(0); // affine-only: no lanes.
    expect(u32[b0 + HAS_POST]).toBe(0);
    expect(f32[b0 + CUM_WEIGHT]).toBe(1);
    const b1 = 4 * F32_PER_SLOT4;
    expect(f32[b1 + CUM_WEIGHT]).toBe(4); // weight 3 after weight 1.
  });
});

describe("packGpuParams4 schedule scalars", () => {
  it("writes the schedule four at their documented element offsets", () => {
    const projection = new Float64Array(20);
    for (let i = 0; i < 20; i++) projection[i] = 1;
    const buf = packGpuParams4({
      projection,
      width: 64,
      height: 64,
      transformCount: 2,
      baseTransformCount: 2,
      itersPerInvocation: 16,
      weighted: false,
      hasFinal: false,
      totalWeight: 2,
      numChains: 128,
      view: {
        invWAmp: 1,
        sliceOn: false,
        sliceCenter: 0,
        sliceWidth: 0.5,
        sliceRelativeColor: false,
      },
      color: { kind: "wRamp", side: { neg: [0, 0, 0], pos: [0, 0, 0] } },
      echoPalette: false,
      scheduleCount: 20,
      scheduleDepth: 3,
      scheduleWeighted: true,
      scheduleTotalWeight: 7.5,
      chaosEnabled: true,
    });
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    expect(buf.byteLength).toBe(PARAMS4_BYTES);
    expect(u32[89]).toBe(20); // scheduleCount (byte 356)
    expect(u32[90]).toBe(3); // scheduleDepth (byte 360)
    expect(u32[91]).toBe(1); // scheduleWeighted (byte 364)
    expect(f32[92]).toBe(7.5); // scheduleTotalWeight (byte 368)
    expect(u32[93]).toBe(1); // chaosEnabled (byte 372, the old pad)
  });
});
