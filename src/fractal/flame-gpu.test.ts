import {
  CHAIN_STRIDE_BYTES,
  COLOR_FIXED_POINT_SCALE,
  DOWNSAMPLE_PARAMS_BYTES,
  FLAME_GPU_KERNEL_WGSL,
  HIST_U32_PER_BUCKET,
  KERNEL_VARIATION_INDEX,
  MAX_SLOT_VARIATIONS,
  PARAMS_BYTES,
  SLOT_STRIDE_BYTES,
  convertGpuDisplayHistogram,
  convertGpuHistogram,
  packGpuChains,
  packGpuDownsample,
  packGpuParams,
  packGpuSystem,
  planGpuDispatches,
} from "./flame-gpu";
import type { GpuFlameSystemSpec, GpuParamsFields } from "./flame-gpu";
import { rotationMatrixXYZ } from "./affine";
import { MAX_TRANSFORMS, prepareChaosGame } from "./chaos-game";
import { transformColors } from "./color";
import { createFlameHistogram } from "./flame";
import type { Mat4 } from "./flame";
import { buildPaletteLUT } from "./palette";
import { mulberry32 } from "./rng";
import { VARIATION_TYPES } from "./types";
import type { SymmetryParams, Transform } from "./types";

function makeTransforms(count: number): Transform[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    position: [0.5, 0.5, 0.5],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  }));
}

/** Default spec for tests that don't care about the specific system —
 * override just the field under test. */
function baseSpec(
  overrides: Partial<GpuFlameSystemSpec> = {},
): GpuFlameSystemSpec {
  return {
    transforms: makeTransforms(2),
    finalTransform: null,
    symmetry: { order: 1, axis: "y" },
    paletteId: "legacy",
    ...overrides,
  };
}

// Slot element offsets (4-byte units), restated directly from flame-gpu.ts's
// byte-layout doc comment (byte offset / 4) — independent of that module's
// own (private) offset constants, so a mistake in the implementation could
// not coincidentally agree with a matching mistake here.
const F32_PER_SLOT = SLOT_STRIDE_BYTES / 4; // 52
const ROW_X = 0; // byte 0
const ROW_Y = 4; // byte 16
const ROW_Z = 8; // byte 32
const POST_X = 12; // byte 48
const POST_Y = 16; // byte 64
const POST_Z = 20; // byte 80
const VAR_WEIGHTS = 24; // byte 96, array<vec4f, 3>
const VAR_TYPES = 36; // byte 144, array<vec4u, 3>
const VAR_COUNT = 48; // byte 192
const HAS_POST = 49; // byte 196
const CUM_WEIGHT = 50; // byte 200

describe("packGpuSystem validation", () => {
  it("rejects systems with more than MAX_TRANSFORMS transforms, matching prepareChaosGame's message", () => {
    const tooMany = makeTransforms(MAX_TRANSFORMS + 1);
    expect(() => packGpuSystem(baseSpec({ transforms: tooMany }))).toThrow(
      RangeError,
    );
    expect(() => packGpuSystem(baseSpec({ transforms: tooMany }))).toThrow(
      `IFS supports at most ${MAX_TRANSFORMS} transforms, got ${tooMany.length}`,
    );
  });

  it("rejects a transform whose active-variation count exceeds MAX_SLOT_VARIATIONS", () => {
    const tooManyVariations = Array.from(
      { length: MAX_SLOT_VARIATIONS + 1 },
      () => ({ type: "linear" as const, weight: 1 }),
    );
    const transforms = makeTransforms(1).map((t) => ({
      ...t,
      variations: tooManyVariations,
    }));
    expect(() => packGpuSystem(baseSpec({ transforms }))).toThrow(RangeError);
  });
});

describe("packGpuSystem slot layout (byte-layout pinning)", () => {
  // Zero rotation + a distinct diagonal scale per axis, so each affine row's
  // expected numbers are obvious by eye (m = diag(scale)) rather than
  // needing composeAffine's trig to cross-check. Base 0 is pure affine; base
  // 1 carries 5 variations (crossing the array<vec4,3> boundary at lane 4),
  // and the final transform carries its own, smaller list.
  const LAYOUT_TRANSFORMS: Transform[] = [
    {
      id: 0,
      position: [0.1, 0.2, 0.3],
      rotation: [0, 0, 0],
      scale: [2, 3, 4],
      weight: 3,
    },
    {
      id: 1,
      position: [-0.4, -0.5, -0.6],
      rotation: [0, 0, 0],
      scale: [5, 6, 7],
      weight: 1,
      variations: [
        { type: "sinusoidal", weight: 1.5 },
        { type: "spherical", weight: 0.5 },
        { type: "swirl", weight: 2 },
        { type: "horseshoe", weight: 0.25 },
        { type: "polar", weight: 4 },
      ],
    },
  ];
  const LAYOUT_FINAL: Transform = {
    id: 2,
    position: [0.7, 0.8, 0.9],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [
      { type: "linear", weight: 1 },
      { type: "heart", weight: 0.3 },
    ],
  };

  function layoutSpec(): GpuFlameSystemSpec {
    return {
      transforms: LAYOUT_TRANSFORMS,
      finalTransform: LAYOUT_FINAL,
      symmetry: { order: 2, axis: "y" },
      paletteId: "legacy",
    };
  }

  it("expands to order * baseTransformCount slots (2 * 2 = 4), plus one final slot", () => {
    const packed = packGpuSystem(layoutSpec());
    expect(packed.transformCount).toBe(4);
    expect(packed.baseTransformCount).toBe(2);
    expect(packed.slots.byteLength).toBe(5 * SLOT_STRIDE_BYTES);
  });

  it("writes each expanded slot's affine rows from its BASE transform, with the post-rotation kept separate", () => {
    const packed = packGpuSystem(layoutSpec());
    const f32 = new Float32Array(packed.slots);

    // Slots 0 (k=0) and 2 (k=1) both come from base transform 0 — copy 1's
    // rotation is NEVER baked into the affine rows, only into its post rows
    // (see the next test), so both slots' affine rows are identical.
    for (const slot of [0, 2]) {
      const base = slot * F32_PER_SLOT;
      expect(f32[base + ROW_X]).toBe(2);
      // toBeCloseTo, not toBe: rotationMatrixXYZ(0,0,0)'s off-diagonal terms
      // (e.g. -cos(0)*sin(0)) are IEEE -0, not +0 — a real sign-of-zero
      // quirk of that (authoritative, unmodified) function, not a defect
      // here. toBe uses Object.is, which treats -0 and 0 as different.
      expect(f32[base + ROW_X + 1]).toBeCloseTo(0, 6);
      expect(f32[base + ROW_X + 2]).toBeCloseTo(0, 6);
      expect(f32[base + ROW_X + 3]).toBeCloseTo(0.1, 6);
      expect(f32[base + ROW_Y]).toBeCloseTo(0, 6);
      expect(f32[base + ROW_Y + 1]).toBe(3);
      expect(f32[base + ROW_Y + 3]).toBeCloseTo(0.2, 6);
      expect(f32[base + ROW_Z + 2]).toBe(4);
      expect(f32[base + ROW_Z + 3]).toBeCloseTo(0.3, 6);
    }

    for (const slot of [1, 3]) {
      const base = slot * F32_PER_SLOT;
      expect(f32[base + ROW_X]).toBe(5);
      expect(f32[base + ROW_X + 3]).toBeCloseTo(-0.4, 6);
      expect(f32[base + ROW_Y + 1]).toBe(6);
      expect(f32[base + ROW_Y + 3]).toBeCloseTo(-0.5, 6);
      expect(f32[base + ROW_Z + 2]).toBe(7);
      expect(f32[base + ROW_Z + 3]).toBeCloseTo(-0.6, 6);
    }
  });

  it("sets hasPost and the post rows only for the rotated copy (k > 0)", () => {
    const packed = packGpuSystem(layoutSpec());
    const f32 = new Float32Array(packed.slots);
    const u32 = new Uint32Array(packed.slots);

    // Copy 0 (slots 0, 1) is never rotated — hasPost and the post rows stay
    // at the ArrayBuffer's zero default, mirroring prepareChaosGame's null.
    for (const slot of [0, 1]) {
      const base = slot * F32_PER_SLOT;
      expect(u32[base + HAS_POST]).toBe(0);
      expect(f32[base + POST_X]).toBe(0);
      expect(f32[base + POST_Y]).toBe(0);
      expect(f32[base + POST_Z]).toBe(0);
    }

    // Copy 1 (slots 2, 3) rotates by 2π * 1 / 2 = π about y.
    const r = rotationMatrixXYZ(0, Math.PI, 0);
    for (const slot of [2, 3]) {
      const base = slot * F32_PER_SLOT;
      expect(u32[base + HAS_POST]).toBe(1);
      expect(f32[base + POST_X]).toBeCloseTo(r[0], 6);
      expect(f32[base + POST_X + 1]).toBeCloseTo(r[1], 6);
      expect(f32[base + POST_X + 2]).toBeCloseTo(r[2], 6);
      expect(f32[base + POST_Y]).toBeCloseTo(r[3], 6);
      expect(f32[base + POST_Y + 1]).toBeCloseTo(r[4], 6);
      expect(f32[base + POST_Y + 2]).toBeCloseTo(r[5], 6);
      expect(f32[base + POST_Z]).toBeCloseTo(r[6], 6);
      expect(f32[base + POST_Z + 1]).toBeCloseTo(r[7], 6);
      expect(f32[base + POST_Z + 2]).toBeCloseTo(r[8], 6);
    }
  });

  it("writes varCount and the type/weight lanes, including a lane beyond index 3 (array<vec4,3>'s second vec4)", () => {
    const packed = packGpuSystem(layoutSpec());
    const f32 = new Float32Array(packed.slots);
    const u32 = new Uint32Array(packed.slots);

    // Base transform 0 has no variations.
    for (const slot of [0, 2]) {
      expect(u32[slot * F32_PER_SLOT + VAR_COUNT]).toBe(0);
    }

    // Base transform 1's 5 variations; both its copies (slots 1 and 3) carry
    // the identical list, each independently re-derived.
    const expectedTypes = [
      KERNEL_VARIATION_INDEX.sinusoidal,
      KERNEL_VARIATION_INDEX.spherical,
      KERNEL_VARIATION_INDEX.swirl,
      KERNEL_VARIATION_INDEX.horseshoe,
      KERNEL_VARIATION_INDEX.polar,
    ];
    const expectedWeights = [1.5, 0.5, 2, 0.25, 4];
    for (const slot of [1, 3]) {
      const base = slot * F32_PER_SLOT;
      expect(u32[base + VAR_COUNT]).toBe(5);
      for (let v = 0; v < 5; v++) {
        expect(u32[base + VAR_TYPES + v]).toBe(expectedTypes[v]);
        expect(f32[base + VAR_WEIGHTS + v]).toBeCloseTo(expectedWeights[v], 6);
      }
    }
  });

  it("places the final transform's slot at index transformCount, with its own affine/variations and hasPost 0", () => {
    const packed = packGpuSystem(layoutSpec());
    const f32 = new Float32Array(packed.slots);
    const u32 = new Uint32Array(packed.slots);
    const base = packed.transformCount * F32_PER_SLOT;

    expect(base).toBe(4 * F32_PER_SLOT);
    expect(f32[base + ROW_X]).toBe(1);
    expect(f32[base + ROW_X + 3]).toBeCloseTo(0.7, 6);
    expect(f32[base + ROW_Y + 1]).toBe(1);
    expect(f32[base + ROW_Y + 3]).toBeCloseTo(0.8, 6);
    expect(f32[base + ROW_Z + 2]).toBe(1);
    expect(f32[base + ROW_Z + 3]).toBeCloseTo(0.9, 6);
    expect(u32[base + HAS_POST]).toBe(0);

    expect(u32[base + VAR_COUNT]).toBe(2);
    expect(u32[base + VAR_TYPES]).toBe(KERNEL_VARIATION_INDEX.linear);
    expect(u32[base + VAR_TYPES + 1]).toBe(KERNEL_VARIATION_INDEX.heart);
    expect(f32[base + VAR_WEIGHTS]).toBeCloseTo(1, 6);
    expect(f32[base + VAR_WEIGHTS + 1]).toBeCloseTo(0.3, 6);
  });

  it("accumulates cumWeight as the running sum over expanded slots, in copy-major order (weights 3,1,3,1)", () => {
    const packed = packGpuSystem(layoutSpec());
    const f32 = new Float32Array(packed.slots);
    const expectedCum = [3, 4, 7, 8];
    for (let s = 0; s < 4; s++) {
      expect(f32[s * F32_PER_SLOT + CUM_WEIGHT]).toBeCloseTo(expectedCum[s], 6);
    }
    expect(packed.totalWeight).toBe(8);
    expect(packed.weighted).toBe(true);
  });

  it("leaves the final slot zeroed and hasFinal false when no final transform is given", () => {
    const packed = packGpuSystem(baseSpec());
    expect(packed.hasFinal).toBe(false);
    const f32 = new Float32Array(packed.slots);
    const u32 = new Uint32Array(packed.slots);
    const base = packed.transformCount * F32_PER_SLOT;
    for (let e = 0; e < F32_PER_SLOT; e++) {
      expect(f32[base + e]).toBe(0);
    }
    expect(u32[base + VAR_COUNT]).toBe(0);
  });
});

describe("packGpuSystem variation filtering", () => {
  it("drops non-finite/zero-weight variations (composeVariations' rule) and compacts survivors in original order", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [
          { type: "sinusoidal", weight: 1 },
          { type: "linear", weight: 0 }, // dropped: zero weight.
          { type: "spherical", weight: NaN }, // dropped: non-finite.
          { type: "swirl", weight: 3 },
        ],
      },
    ];
    const packed = packGpuSystem(baseSpec({ transforms }));
    const u32 = new Uint32Array(packed.slots);
    const f32 = new Float32Array(packed.slots);
    expect(u32[VAR_COUNT]).toBe(2);
    expect(u32[VAR_TYPES]).toBe(KERNEL_VARIATION_INDEX.sinusoidal);
    expect(u32[VAR_TYPES + 1]).toBe(KERNEL_VARIATION_INDEX.swirl);
    expect(f32[VAR_WEIGHTS]).toBe(1);
    expect(f32[VAR_WEIGHTS + 1]).toBe(3);
  });
});

describe("packGpuSystem parity with prepareChaosGame", () => {
  it("matches transformCount, baseTransformCount, weighted, totalWeight, and cumWeight lanes", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.2, 0, 0],
        rotation: [0.1, 0.2, 0.3],
        scale: [0.5, 0.5, 0.5],
        weight: 2,
      },
      {
        id: 1,
        position: [-0.2, 0.1, 0],
        rotation: [0, 0.4, 0],
        scale: [0.6, 0.5, 0.4],
        weight: 5,
      },
      {
        id: 2,
        position: [0, -0.2, 0.1],
        rotation: [0.2, 0, 0.1],
        scale: [0.4, 0.4, 0.4],
        weight: 1,
      },
    ];
    const symmetry: SymmetryParams = { order: 3, axis: "z" };
    const prepared = prepareChaosGame(transforms, null, symmetry);
    const packed = packGpuSystem({
      transforms,
      finalTransform: null,
      symmetry,
      paletteId: "legacy",
    });

    expect(packed.transformCount).toBe(prepared.transformCount);
    expect(packed.baseTransformCount).toBe(prepared.baseTransformCount);
    expect(packed.weighted).toBe(prepared.weighted);
    expect(packed.totalWeight).toBe(prepared.totalWeight);

    const f32 = new Float32Array(packed.slots);
    const expectedCum = Array.from(prepared.cumulative);
    for (let s = 0; s < packed.transformCount; s++) {
      expect(f32[s * F32_PER_SLOT + CUM_WEIGHT]).toBeCloseTo(expectedCum[s], 6);
    }
  });
});

describe("packGpuSystem colors", () => {
  it("packs the legacy per-BASE-transform palette (transformColors) with colorMode 0", () => {
    const packed = packGpuSystem(baseSpec({ transforms: makeTransforms(3) }));
    expect(packed.colorMode).toBe(0);
    const colorsU32 = new Uint32Array(packed.colors);
    const palette = transformColors(3);
    for (let i = 0; i < 3; i++) {
      const [r, g, b] = palette[i];
      expect(colorsU32[i * 4]).toBe(Math.round(r * COLOR_FIXED_POINT_SCALE));
      expect(colorsU32[i * 4 + 1]).toBe(
        Math.round(g * COLOR_FIXED_POINT_SCALE),
      );
      expect(colorsU32[i * 4 + 2]).toBe(
        Math.round(b * COLOR_FIXED_POINT_SCALE),
      );
    }
  });

  it("packs a 256-entry gradient LUT with colorMode 1 for a non-legacy palette id", () => {
    const packed = packGpuSystem(baseSpec({ paletteId: "spectrum" }));
    expect(packed.colorMode).toBe(1);
    const colorsU32 = new Uint32Array(packed.colors);
    const lut = buildPaletteLUT("spectrum");
    if (!lut) throw new Error("spectrum should have a LUT");
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
    }
  });

  it("sets colorDenom to baseTransformCount - 1, or 0 for a single-transform system", () => {
    expect(
      packGpuSystem(baseSpec({ transforms: makeTransforms(4) })).colorDenom,
    ).toBe(3);
    expect(
      packGpuSystem(baseSpec({ transforms: makeTransforms(1) })).colorDenom,
    ).toBe(0);
  });
});

describe("packGpuChains", () => {
  it("is deterministic for a given seed", () => {
    const a = new Uint8Array(packGpuChains(4, 7));
    const b = new Uint8Array(packGpuChains(4, 7));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("draws pos.xyz, a fixed 0.5 color coordinate, one aux.x seed, and one odd aux.y stream increment per chain, in exactly that order", () => {
    const numChains = 3;
    const seed = 42;
    const buf = packGpuChains(numChains, seed);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    const f32PerChain = CHAIN_STRIDE_BYTES / 4;

    // A hand-rolled mulberry32(seed) sequence, drawn in the exact documented
    // order — the oracle packGpuChains must agree with, independent of its
    // own implementation.
    const rng = mulberry32(seed);
    for (let c = 0; c < numChains; c++) {
      const base = c * f32PerChain;
      const expectedX = rng() - 0.5;
      const expectedY = rng() - 0.5;
      const expectedZ = rng() - 0.5;
      const expectedAux = Math.floor(rng() * 0x100000000) >>> 0;
      const expectedInc = ((Math.floor(rng() * 0x100000000) << 1) | 1) >>> 0;
      expect(f32[base]).toBeCloseTo(expectedX, 6);
      expect(f32[base + 1]).toBeCloseTo(expectedY, 6);
      expect(f32[base + 2]).toBeCloseTo(expectedZ, 6);
      expect(f32[base + 3]).toBe(0.5);
      expect(u32[base + 4]).toBe(expectedAux);
      expect(u32[base + 5]).toBe(expectedInc);
    }
  });

  it("gives every chain an odd stream increment, distinct across chains", () => {
    const numChains = 512;
    const u32 = new Uint32Array(packGpuChains(numChains, 1234));
    const incs: number[] = [];
    for (let c = 0; c < numChains; c++) {
      const inc = u32[c * (CHAIN_STRIDE_BYTES / 4) + 5];
      expect(inc & 1).toBe(1);
      incs.push(inc);
    }
    expect(new Set(incs).size).toBe(numChains);
  });

  it("sizes the buffer as numChains * CHAIN_STRIDE_BYTES", () => {
    const buf = packGpuChains(10, 1);
    expect(buf.byteLength).toBe(10 * CHAIN_STRIDE_BYTES);
  });
});

describe("packGpuParams", () => {
  function fields(overrides: Partial<GpuParamsFields> = {}): GpuParamsFields {
    // prettier-ignore
    const projection: Mat4 = [
      1, 2, 3, 4,
      5, 6, 7, 8,
      -1, -2, -3, -4, // row 2 (clip Z): must never be read.
      13, 14, 15, 16,
    ];
    return {
      projection,
      width: 640,
      height: 480,
      transformCount: 12,
      baseTransformCount: 4,
      itersPerInvocation: 256,
      colorMode: 1,
      weighted: true,
      hasFinal: true,
      totalWeight: 9.5,
      colorDenom: 3,
      numChains: 65536,
      ...overrides,
    };
  }

  it("writes every field at its documented element offset", () => {
    const buf = packGpuParams(fields());
    expect(buf.byteLength).toBe(PARAMS_BYTES);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);

    expect(Array.from(f32.slice(0, 4))).toEqual([1, 2, 3, 4]); // projX
    expect(Array.from(f32.slice(4, 8))).toEqual([5, 6, 7, 8]); // projY
    expect(Array.from(f32.slice(8, 12))).toEqual([13, 14, 15, 16]); // projW
    expect(u32[12]).toBe(640); // width
    expect(u32[13]).toBe(480); // height
    expect(u32[14]).toBe(12); // transformCount
    expect(u32[15]).toBe(4); // baseTransformCount
    expect(u32[16]).toBe(256); // itersPerInvocation
    expect(u32[17]).toBe(1); // colorMode
    expect(u32[18]).toBe(1); // weighted
    expect(u32[19]).toBe(1); // hasFinal
    expect(f32[20]).toBeCloseTo(9.5, 6); // totalWeight
    expect(f32[21]).toBe(3); // colorDenom
    expect(u32[22]).toBe(65536); // numChains
  });

  it("ignores the projection matrix's row 2 (clip Z)", () => {
    // prettier-ignore
    const alteredRow2: Mat4 = [
      1, 2, 3, 4,
      5, 6, 7, 8,
      777, 888, 999, 111,
      13, 14, 15, 16,
    ];
    const a = packGpuParams(fields());
    const b = packGpuParams(fields({ projection: alteredRow2 }));
    expect(Array.from(new Float32Array(a))).toEqual(
      Array.from(new Float32Array(b)),
    );
  });

  it("encodes weighted and hasFinal independently at their own offsets", () => {
    const onlyWeighted = new Uint32Array(
      packGpuParams(fields({ weighted: true, hasFinal: false })),
    );
    const onlyHasFinal = new Uint32Array(
      packGpuParams(fields({ weighted: false, hasFinal: true })),
    );
    expect(onlyWeighted[18]).toBe(1);
    expect(onlyWeighted[19]).toBe(0);
    expect(onlyHasFinal[18]).toBe(0);
    expect(onlyHasFinal[19]).toBe(1);
  });
});

describe("planGpuDispatches", () => {
  it("matches the worked example: 20_000_000 requested over 65_536 chains at max 512", () => {
    const plan = planGpuDispatches(20_000_000, 65_536, 512);
    // ceil(20_000_000 / 65_536) = ceil(305.175...) = 306.
    expect(plan.itersPerInvocation).toBe(306);
    expect(plan.dispatches).toBe(1);
    // 65_536 * 306 = 20_054_016.
    expect(plan.iterations).toBe(20_054_016);
  });

  it("never under-runs the requested iteration count, across a spread of sizes", () => {
    const cases: Array<[number, number, number]> = [
      [1, 128, 512],
      [999, 128, 512],
      [100_000_000, 65_536, 512],
      [65_536 * 512, 65_536, 512], // exactly the single-dispatch boundary.
      [65_536 * 512 + 1, 65_536, 512], // one past it.
    ];
    for (const [requested, numChains, max] of cases) {
      const plan = planGpuDispatches(requested, numChains, max);
      expect(plan.iterations).toBeGreaterThanOrEqual(requested);
    }
  });

  it("keeps itersPerInvocation within [1, maxItersPerInvocation]", () => {
    const cases: Array<[number, number, number]> = [
      [1, 128, 512],
      [20_000_000, 65_536, 512],
      [100_000_000, 65_536, 512],
    ];
    for (const [requested, numChains, max] of cases) {
      const plan = planGpuDispatches(requested, numChains, max);
      expect(plan.itersPerInvocation).toBeGreaterThanOrEqual(1);
      expect(plan.itersPerInvocation).toBeLessThanOrEqual(max);
    }
  });

  it("always satisfies iterations = numChains * itersPerInvocation * dispatches", () => {
    const plan = planGpuDispatches(100_000_000, 65_536, 512);
    expect(plan.iterations).toBe(
      65_536 * plan.itersPerInvocation * plan.dispatches,
    );
  });

  it("uses a single dispatch with overshoot under numChains when the request fits one dispatch's capacity", () => {
    const numChains = 65_536;
    const requested = 20_000_000; // well under numChains * 512 = 33_554_432.
    const plan = planGpuDispatches(requested, numChains, 512);
    expect(plan.dispatches).toBe(1);
    expect(plan.iterations - requested).toBeLessThan(numChains);
  });

  it("caps itersPerInvocation at the maximum and adds dispatches for a request beyond one dispatch's capacity", () => {
    const numChains = 65_536;
    const max = 512;
    const perDispatchCapacity = numChains * max; // 33_554_432
    const requested = perDispatchCapacity * 2 + 1; // just over 2 full dispatches.
    const plan = planGpuDispatches(requested, numChains, max);
    expect(plan.itersPerInvocation).toBe(max);
    expect(plan.dispatches).toBe(3); // ceil((2x + 1) / x) = 3.
    expect(plan.iterations).toBe(perDispatchCapacity * 3);
  });

  it("degrades a non-positive request to the minimal single 1-iteration-per-invocation dispatch", () => {
    const zero = planGpuDispatches(0, 1024, 512);
    expect(zero).toEqual({
      itersPerInvocation: 1,
      dispatches: 1,
      iterations: 1024,
    });
    const negative = planGpuDispatches(-5, 1024, 512);
    expect(negative).toEqual(zero);
  });
});

describe("convertGpuHistogram", () => {
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

  it("carries the lo/hi hit-count pair into one number (hi=1, lo=5 -> 4294967301)", () => {
    const words = makeWords(2, 1, { 0: [5, 1, 0, 0, 0, 0, 0, 0] });
    const hist = convertGpuHistogram(words, 2, 1);
    expect(hist.hits[0]).toBe(4294967301);
  });

  it("scales summed color channels by 1 / COLOR_FIXED_POINT_SCALE", () => {
    const words = makeWords(1, 1, { 0: [10, 0, 512, 0, 256, 0, 128, 0] });
    const hist = convertGpuHistogram(words, 1, 1);
    expect(hist.sumRGB[0]).toBeCloseTo(512 / COLOR_FIXED_POINT_SCALE, 6);
    expect(hist.sumRGB[1]).toBeCloseTo(256 / COLOR_FIXED_POINT_SCALE, 6);
    expect(hist.sumRGB[2]).toBeCloseTo(128 / COLOR_FIXED_POINT_SCALE, 6);
  });

  it("recomputes maxHits as the max over every converted bucket", () => {
    const words = makeWords(2, 1, {
      0: [10, 0, 0, 0, 0, 0, 0, 0],
      1: [999, 0, 0, 0, 0, 0, 0, 0],
    });
    const hist = convertGpuHistogram(words, 2, 1);
    expect(hist.maxHits).toBe(999);
  });

  it("throws RangeError naming both the actual and expected word count on a length mismatch", () => {
    const words = new Uint32Array(10);
    const expectedWords = 4 * 4 * HIST_U32_PER_BUCKET;
    expect(() => convertGpuHistogram(words, 4, 4)).toThrow(RangeError);
    expect(() => convertGpuHistogram(words, 4, 4)).toThrow(/\b10\b/);
    expect(() => convertGpuHistogram(words, 4, 4)).toThrow(
      new RegExp(`\\b${expectedWords}\\b`),
    );
  });

  it("fully overwrites a reused out histogram's stale nonzero buckets", () => {
    const out = createFlameHistogram(2, 1);
    out.hits[0] = 12345;
    out.hits[1] = 6789;
    out.sumRGB.fill(42);
    out.maxHits = 12345;

    const words = makeWords(2, 1, { 0: [7, 0, 0, 0, 0, 0, 0, 0] }); // bucket 1 all-zero.
    const hist = convertGpuHistogram(words, 2, 1, out);

    expect(hist).toBe(out); // reused, not reallocated.
    expect(hist.hits[0]).toBe(7);
    expect(hist.hits[1]).toBe(0); // stale 6789 must not survive.
    expect(Array.from(hist.sumRGB)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(hist.maxHits).toBe(7);
  });

  it("throws RangeError when out has different dimensions than requested", () => {
    const out = createFlameHistogram(3, 3);
    const words = new Uint32Array(2 * 2 * HIST_U32_PER_BUCKET);
    expect(() => convertGpuHistogram(words, 2, 2, out)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// fr-ee9: GPU-side progressive display downsample — packGpuDownsample (the
// pure kernel/weight-table packer) and convertGpuDisplayHistogram (the
// readback converter). The WGSL itself (FLAME_GPU_DOWNSAMPLE_WGSL) is pinned
// by the agreement harness (src/app/gpu-bench/), not here — see that
// module's doc.
// ---------------------------------------------------------------------------

describe("packGpuDownsample", () => {
  // Params element offsets (4-byte units), restated directly from
  // flame-gpu.ts's DOWNSAMPLE_PARAMS_BYTES doc comment, independent of that
  // module's own (private) offset constants — same "can't coincidentally
  // agree with a matching mistake" reasoning as packGpuSystem's tests above.
  const P_SRC_W = 0;
  const P_SRC_H = 1;
  const P_OUT_W = 2;
  const P_OUT_H = 3;
  const P_SCALE_X = 4;
  const P_SCALE_Y = 5;
  const P_RADIUS_X = 6;
  const P_RADIUS_Y = 7;
  const P_KERNEL_Y_OFFSET = 8;
  const P_COL_WEIGHT_SUM_OFFSET = 9;

  /** Independent restatement of downsampleFlame's phase/sigma/radius
   * derivation (flame.ts) — the oracle packGpuDownsample's kernel values
   * must agree with, computed here from scratch rather than imported. */
  function expectedKernel(
    scale: number,
    filterRadius: number,
  ): { phase: number; sigma: number; radius: number; values: number[] } {
    const phase = 0.5 * (scale - 1);
    const sigma = Math.max(filterRadius, 1e-3) * scale;
    const radius = Math.max(1, Math.ceil(sigma * 3));
    const values: number[] = [];
    for (let k = -radius; k <= radius; k++) {
      const d = k - phase;
      values.push(Math.exp(-(d * d) / (2 * sigma * sigma)));
    }
    return { phase, sigma, radius, values };
  }

  it("writes srcW/srcH/outW/outH/scaleX/scaleY at their documented offsets", () => {
    const packed = packGpuDownsample(20, 12, 10, 4, 0.4); // scaleX=2, scaleY=3.
    expect(packed.params.byteLength).toBe(DOWNSAMPLE_PARAMS_BYTES);
    const u32 = new Uint32Array(packed.params);
    expect(u32[P_SRC_W]).toBe(20);
    expect(u32[P_SRC_H]).toBe(12);
    expect(u32[P_OUT_W]).toBe(10);
    expect(u32[P_OUT_H]).toBe(4);
    expect(u32[P_SCALE_X]).toBe(2);
    expect(u32[P_SCALE_Y]).toBe(3);
  });

  it("computes kernelX matching downsampleFlame's phase/sigma/radius formula at an EVEN scale (half-cell phase)", () => {
    const filterRadius = 0.4;
    const packed = packGpuDownsample(8, 8, 4, 4, filterRadius); // scale 2, even.
    const { phase, radius, values } = expectedKernel(2, filterRadius);
    expect(phase).toBe(0.5); // the even-scale half-cell offset.
    const u32 = new Uint32Array(packed.params);
    expect(u32[P_RADIUS_X]).toBe(radius);
    for (let k = 0; k < values.length; k++) {
      expect(packed.weights[k]).toBeCloseTo(values[k], 5);
    }
  });

  it("computes kernelY matching the same formula at an ODD scale (integer phase, no half-cell offset)", () => {
    const filterRadius = 0.4;
    const packed = packGpuDownsample(9, 9, 3, 3, filterRadius); // scale 3, odd.
    const { phase, radius, values } = expectedKernel(3, filterRadius);
    expect(phase).toBe(1); // the odd-scale integer offset — no phase kink.
    const u32 = new Uint32Array(packed.params);
    expect(u32[P_RADIUS_Y]).toBe(radius);
    const kernelYOffset = u32[P_KERNEL_Y_OFFSET];
    for (let k = 0; k < values.length; k++) {
      expect(packed.weights[kernelYOffset + k]).toBeCloseTo(values[k], 5);
    }
  });

  it("gives an interior column the full (unclipped) kernel sum reciprocal", () => {
    const filterRadius = 0.4;
    const packed = packGpuDownsample(40, 40, 20, 20, filterRadius); // scale 2.
    const { values } = expectedKernel(2, filterRadius);
    const fullSum = values.reduce((a, b) => a + b, 0);
    const u32 = new Uint32Array(packed.params);
    const colWeightSumOffset = u32[P_COL_WEIGHT_SUM_OFFSET];
    // A column safely in the interior (far from both edges) sees every tap
    // in bounds, so its reciprocal is exactly 1/fullSum.
    expect(packed.weights[colWeightSumOffset + 10]).toBeCloseTo(1 / fullSum, 5);
  });

  it("gives an edge column a smaller weight sum (larger reciprocal) than an interior column", () => {
    // A wide filterRadius against a small output so the leftmost column's
    // kernel footprint genuinely spills past the source's left edge.
    const packed = packGpuDownsample(20, 20, 10, 10, 2); // scale 2, wide kernel.
    const u32 = new Uint32Array(packed.params);
    const colWeightSumOffset = u32[P_COL_WEIGHT_SUM_OFFSET];
    const edgeRecip = packed.weights[colWeightSumOffset + 0];
    const interiorRecip = packed.weights[colWeightSumOffset + 5];
    expect(edgeRecip).toBeGreaterThan(interiorRecip);
  });

  it("gives an edge row the same clipped-sum treatment as an edge column (Y axis)", () => {
    const packed = packGpuDownsample(20, 20, 10, 10, 2);
    const u32 = new Uint32Array(packed.params);
    const rowWeightSumOffset = u32[P_COL_WEIGHT_SUM_OFFSET] + 10; // colWeightSumOffset + outW.
    const edgeRecip = packed.weights[rowWeightSumOffset + 0];
    const interiorRecip = packed.weights[rowWeightSumOffset + 5];
    expect(edgeRecip).toBeGreaterThan(interiorRecip);
  });

  it("sizes the weights array as kernelX + kernelY + outW + outH", () => {
    const outW = 6;
    const outH = 5;
    const packed = packGpuDownsample(12, 10, outW, outH, 0.4); // scaleX=2, scaleY=2.
    const u32 = new Uint32Array(packed.params);
    const radiusX = u32[P_RADIUS_X];
    const radiusY = u32[P_RADIUS_Y];
    const expectedLength = 2 * radiusX + 1 + (2 * radiusY + 1) + outW + outH;
    expect(packed.weights.length).toBe(expectedLength);
  });

  it("passes through a scale-1 (no supersample) axis without degenerating", () => {
    // scaleX = 1 (outW === srcW): downsampleFlame's own pass-through case —
    // phase 0, sigma pinned to MIN_FILTER_SIGMA's floor.
    const packed = packGpuDownsample(10, 20, 10, 10, 0.4); // scaleX=1, scaleY=2.
    const u32 = new Uint32Array(packed.params);
    expect(u32[P_SCALE_X]).toBe(1);
    const { phase, radius, values } = expectedKernel(1, 0.4);
    expect(phase).toBe(0);
    expect(u32[P_RADIUS_X]).toBe(radius);
    for (let k = 0; k < values.length; k++) {
      expect(packed.weights[k]).toBeCloseTo(values[k], 5);
    }
  });
});

describe("convertGpuDisplayHistogram", () => {
  it("copies interleaved [hits,r,g,b] into out.hits/out.sumRGB", () => {
    const out = createFlameHistogram(2, 1);
    const data = new Float32Array([5, 1, 2, 3, 9, 4, 5, 6]);
    const hist = convertGpuDisplayHistogram(data, 2, 1, out);
    expect(hist).toBe(out); // reused, not reallocated.
    expect(Array.from(hist.hits)).toEqual([5, 9]);
    expect(Array.from(hist.sumRGB)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("recomputes maxHits as the max over every converted bucket", () => {
    const out = createFlameHistogram(2, 1);
    const data = new Float32Array([5, 0, 0, 0, 999, 0, 0, 0]);
    const hist = convertGpuDisplayHistogram(data, 2, 1, out);
    expect(hist.maxHits).toBe(999);
  });

  it("fully overwrites a reused out histogram's stale nonzero buckets", () => {
    const out = createFlameHistogram(2, 1);
    out.hits[0] = 12345;
    out.hits[1] = 6789;
    out.sumRGB.fill(42);
    out.maxHits = 12345;

    const data = new Float32Array([7, 0, 0, 0, 0, 0, 0, 0]); // bucket 1 all-zero.
    const hist = convertGpuDisplayHistogram(data, 2, 1, out);

    expect(hist.hits[0]).toBe(7);
    expect(hist.hits[1]).toBe(0); // stale 6789 must not survive.
    expect(Array.from(hist.sumRGB)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(hist.maxHits).toBe(7);
  });

  it("throws RangeError naming both the actual and expected length on a data length mismatch", () => {
    const out = createFlameHistogram(2, 2);
    const data = new Float32Array(10);
    expect(() => convertGpuDisplayHistogram(data, 2, 2, out)).toThrow(
      RangeError,
    );
    expect(() => convertGpuDisplayHistogram(data, 2, 2, out)).toThrow(/\b10\b/);
    expect(() => convertGpuDisplayHistogram(data, 2, 2, out)).toThrow(/\b16\b/); // 2*2*4.
  });

  it("throws RangeError when out has different dimensions than requested", () => {
    const out = createFlameHistogram(3, 3);
    const data = new Float32Array(2 * 2 * 4);
    expect(() => convertGpuDisplayHistogram(data, 2, 2, out)).toThrow(
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// fr-jnu: static tripwire tests for the variation switch's STRUCTURE. WGSL
// cannot execute under Vitest, so these tests can't check the variation
// FORMULAS — that's pinned by the browser agreement harness
// (src/app/gpu-bench/) against flame.ts's accumulateFlame. What CAN run here
// is a plain string/regex scan of FLAME_GPU_KERNEL_WGSL's applyVariation
// switch, pinned against KERNEL_VARIATION_INDEX: today, adding a
// VariationType without extending the WGSL switch, or renumbering
// KERNEL_VARIATION_INDEX against the WGSL cases, renders silently as
// `linear` (the switch's `default`) with a green CI.
// ---------------------------------------------------------------------------

describe("FLAME_GPU_KERNEL_WGSL variation switch", () => {
  /** Slices out just the `applyVariation` function body from a kernel
   * source. The 4D kernel (flame-gpu-4d.ts) has OTHER switches later in its
   * source — a color-mode dispatch with its own `case 0u: { // structural:`
   * etc. — that would poison a whole-source case scan, so this narrows to
   * the one function between `fn applyVariation` and the next top-level
   * `fn `. */
  function applyVariationBody(wgsl: string): string {
    const start = wgsl.indexOf("fn applyVariation");
    const end = wgsl.indexOf("\nfn ", start);
    return wgsl.slice(start, end === -1 ? wgsl.length : end);
  }

  it("pins KERNEL_VARIATION_INDEX to the exact case numbering both WGSL kernels are written against", () => {
    // The tripwire itself: renumbering this table without re-verifying BOTH
    // kernels' switches must be a loud, deliberate edit here, not a silent
    // one-line change.
    expect(KERNEL_VARIATION_INDEX).toEqual({
      linear: 0,
      sinusoidal: 1,
      spherical: 2,
      swirl: 3,
      horseshoe: 4,
      polar: 5,
      handkerchief: 6,
      heart: 7,
      disc: 8,
      spiral: 9,
      bubble: 10,
      julia: 11,
    });
  });

  it("carries one variation lane per VariationType", () => {
    expect(MAX_SLOT_VARIATIONS).toBe(VARIATION_TYPES.length);
  });

  it("has a case for every variation type at its index, labeled with that variation's name", () => {
    const body = applyVariationBody(FLAME_GPU_KERNEL_WGSL);
    // The `// name` label rides each case's body, so a KERNEL_VARIATION_INDEX
    // entry renumbered to point at ANOTHER variation's case fails here even
    // though the case-number SET (checked next) still matches.
    for (const name of VARIATION_TYPES) {
      expect(body).toMatch(
        new RegExp(`case ${KERNEL_VARIATION_INDEX[name]}u: \\{ // ${name}\\b`),
      );
    }
  });

  it("switches on exactly the KERNEL_VARIATION_INDEX values — no missing or extra cases", () => {
    const body = applyVariationBody(FLAME_GPU_KERNEL_WGSL);
    const cases = [...body.matchAll(/case (\d+)u:/g)]
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
    const expected = Object.values(KERNEL_VARIATION_INDEX).sort(
      (a, b) => a - b,
    );
    // A case missing from the switch falls into WGSL's `default` and
    // renders as `linear` — the exact silent failure this guards against.
    expect(cases).toEqual(expected);
  });
});
