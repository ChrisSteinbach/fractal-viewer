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
import { composeAffine4 } from "./affine4";
import { prepareChaosGame4 } from "./chaos-game-4d";
import { MAX_TRANSFORMS } from "./chaos-game";
import {
  COLOR_FIXED_POINT_SCALE,
  HIST_U32_PER_BUCKET,
  KERNEL_VARIATION_INDEX,
  WORKGROUP_SIZE,
} from "./flame-gpu";
import { createFlameHistogram } from "./flame";
import { mulberry32 } from "./rng";
import type { Transform4, Vec3, Vec4 } from "./types";
import type { FourDView } from "./project4";

function makeTransforms4(count: number): Transform4[] {
  return Array.from({ length: count }, () => ({
    position: [0.5, 0.5, 0.5, 0.5],
    scale: [0.5, 0.5, 0.5, 0.5],
  }));
}

/** Default spec for tests that don't care about the specific system —
 * override just the field under test. `wRamp` is the simplest color kind
 * (leaves the colors buffer untouched), matching the 3D sibling's use of
 * `paletteId: "legacy"` as its own no-fuss default. */
function baseSpec4(
  overrides: Partial<GpuFlameSystemSpec4> = {},
): GpuFlameSystemSpec4 {
  return {
    transforms4: makeTransforms4(2),
    finalTransform4: null,
    color: { kind: "wRamp", side: { neg: [0, 0, 0], pos: [0, 0, 0] } },
    ...overrides,
  };
}

// Slot4 element offsets (4-byte units), restated directly from
// flame-gpu-4d.ts's byte-layout doc comment (byte offset / 4) — independent
// of that module's own (private) offset constants, so a mistake in the
// implementation could not coincidentally agree with a matching mistake here.
const F32_PER_SLOT4 = SLOT4_STRIDE_BYTES / 4; // 48
const ROW_X = 0; // byte 0
const ROW_Y = 4; // byte 16
const ROW_Z = 8; // byte 32
const ROW_W = 12; // byte 48
const TRANS = 16; // byte 64
const VAR_WEIGHTS = 20; // byte 80, array<vec4f, 3>
const VAR_TYPES = 32; // byte 128, array<vec4u, 3>
const VAR_COUNT = 44; // byte 176
const CUM_WEIGHT = 45; // byte 180

describe("layout constants", () => {
  it("pins the byte-layout sizes documented on the module", () => {
    expect(PARAMS4_BYTES).toBe(192);
    expect(SLOT4_STRIDE_BYTES).toBe(192);
    expect(CHAIN4_STRIDE_BYTES).toBe(32);
    expect(PARAMS4_ITERS_OFFSET_BYTES).toBe(140);
    expect(WEIGHT_FIXED_POINT_SCALE).toBe(256);
  });

  it("maps every FourDRenderColor kind to the kernel's colorKind switch value", () => {
    expect(KERNEL_COLOR_KIND.structural).toBe(0);
    expect(KERNEL_COLOR_KIND.wRamp).toBe(1);
    expect(KERNEL_COLOR_KIND.transform).toBe(2);
    expect(KERNEL_COLOR_KIND.radius).toBe(3);
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
    for (let v = 0; v < 12; v++) {
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

describe("packGpuSystem4 parity with prepareChaosGame4", () => {
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

  it("sets colorDenom to 0 for a single-transform system, transformCount - 1 otherwise", () => {
    expect(
      packGpuSystem4(baseSpec4({ transforms4: makeTransforms4(1) })).colorDenom,
    ).toBe(0);
    expect(
      packGpuSystem4(baseSpec4({ transforms4: makeTransforms4(4) })).colorDenom,
    ).toBe(3);
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

  it("draws pos.xyzw from rng() - 0.5 each, a fixed 0.5 color coordinate with no draw, then one aux.x seed, continuing the SAME rng sequence across chains", () => {
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
      expect(f32[base]).toBe(Math.fround(expectedX));
      expect(f32[base + 1]).toBe(Math.fround(expectedY));
      expect(f32[base + 2]).toBe(Math.fround(expectedZ));
      expect(f32[base + 3]).toBe(Math.fround(expectedW));
      expect(f32[base + 5]).toBe(0.5);
      expect(u32[base + 4]).toBe(expectedAux);
    }
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
  const ITERS_PER_INVOCATION = 35;
  const COLOR_KIND = 36;
  const WEIGHTED = 37;
  const HAS_FINAL = 38;
  const NUM_CHAINS = 39;
  const TOTAL_WEIGHT = 40;
  const COLOR_DENOM = 41;
  const INV_W_AMP = 42;
  const SLICE_ON = 43;
  const SLICE_CENTER = 44;
  const SLICE_WIDTH = 45;
  const MIN_D = 46;
  const INV_RADIUS_RANGE = 47;

  const VIEW: FourDView = {
    invWAmp: 2.5,
    sliceOn: true,
    sliceCenter: 0.25,
    sliceWidth: 0.3,
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
      itersPerInvocation: 256,
      weighted: true,
      hasFinal: true,
      totalWeight: 9.5,
      colorDenom: 3,
      numChains: 65536,
      view: VIEW,
      color: {
        kind: "wRamp",
        side: { neg: [0.1, 0.2, 0.3], pos: [0.4, 0.5, 0.6] },
      },
      ...overrides,
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
    expect(u32[ITERS_PER_INVOCATION]).toBe(256);
    expect(ITERS_PER_INVOCATION * 4).toBe(PARAMS4_ITERS_OFFSET_BYTES);
    expect(u32[COLOR_KIND]).toBe(KERNEL_COLOR_KIND.wRamp);
    expect(u32[WEIGHTED]).toBe(1);
    expect(u32[HAS_FINAL]).toBe(1);
    expect(u32[NUM_CHAINS]).toBe(65536);
    expect(f32[TOTAL_WEIGHT]).toBeCloseTo(9.5, 6);
    expect(f32[COLOR_DENOM]).toBe(3);
    expect(f32[INV_W_AMP]).toBe(Math.fround(2.5));
    expect(u32[SLICE_ON]).toBe(1);
    expect(f32[SLICE_CENTER]).toBeCloseTo(0.25, 6);
    expect(f32[SLICE_WIDTH]).toBeCloseTo(0.3, 6);
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
});
