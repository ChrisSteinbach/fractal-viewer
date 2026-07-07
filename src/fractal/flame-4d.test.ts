import { accumulateFlame4 } from "./flame-4d";
import type { FlameColor4, FourDFlameView } from "./flame-4d";
import { WARMUP_ITERATIONS } from "./chaos-game";
import { plotPoint4, prepareChaosGame4, stepOrbit4 } from "./chaos-game-4d";
import { rotationMatrix4, toTransform4 } from "./affine4";
import {
  buildColorModeLUT,
  transformColors,
  wRampColor,
  W_SIDE_PALETTES,
} from "./color";
import { buildPaletteLUT } from "./palette";
import {
  composeFlameProjection4,
  composeRotorProjection4,
  sliceWeight,
} from "./project4";
import { createFlameHistogram } from "./flame";
import type { Mat4 } from "./flame";
import { pentatope } from "./presets";
import { mulberry32 } from "./rng";
import type { Transform4, Vec4 } from "./types";

/** A single map that ignores its input and always lands exactly on `point`:
 * scale 0 collapses the linear part to zero, so `applyAffine4` (and thus
 * every warmup/orbit step) returns `point` unchanged — the 4D twin of
 * `flame.test.ts`'s `fixedPointSystem`. */
function fixedPointSystem4(point: Vec4): Transform4[] {
  return [{ position: point, scale: [0, 0, 0, 0] }];
}

/** The pentatope gasket, but weighted unevenly (1..5) so the "weighted" pick
 * path in {@link pickIndex4} is genuinely exercised, not just the uniform
 * fast path. */
function weightedPentatope(): Transform4[] {
  return pentatope()
    .map(toTransform4)
    .map((t, i) => ({ ...t, weight: i + 1 }));
}

/** Row-major 4x4 identity rotor — no rotation, so the rotor-projection step
 * degenerates to "drop w, keep xyz", exactly like an inert 4D view. */
// prettier-ignore
const IDENTITY_ROTOR = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/** w = 1 always: no perspective divide, matching flame.test.ts's ORTHOGRAPHIC
 * fixture — this module isn't re-testing the perspective divide itself, just
 * needs a valid, simple camera matrix. */
// prettier-ignore
const ORTHOGRAPHIC: Mat4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/** The identity-rotor-about-the-origin projection composed with
 * {@link ORTHOGRAPHIC}: `(x, y, z, w, 1) -> (x, y, z, w)` verbatim (clipX = x,
 * clipY = y, clipW = 1, sRaw = w) — the simplest possible 20-coefficient
 * projection, for tests that aren't exercising the rotor/camera math itself. */
const FLAT_PROJECTION = composeFlameProjection4(
  ORTHOGRAPHIC,
  composeRotorProjection4(IDENTITY_ROTOR, [0, 0, 0, 0]),
);

const FLAT_VIEW: FourDFlameView = {
  invWAmp: 1,
  sliceOn: false,
  sliceCenter: 0,
  sliceWidth: 1,
};

describe("accumulateFlame4 vs. stepOrbit4/plotPoint4 (correctness oracle)", () => {
  it("matches a reference loop built directly from stepOrbit4/plotPoint4 and the rotor+camera projection, iteration for iteration", () => {
    // A stand-in for what accumulateFlame4's hand-inlined hot loop must stay
    // byte-for-byte equivalent to — mirrors flame.test.ts's "matches a
    // reference loop built directly from stepOrbit/plotPoint" one dimension
    // up: a genuinely 4D weighted system (varying weights, w-spread from the
    // pentatope embed) with a final transform, projected by hand via the
    // documented two-step rotor math (rotate about center, drop w, add back
    // xyz) then a camera.
    const transforms4 = weightedPentatope();
    const finalTransform4: Transform4 = {
      position: [0.15, -0.1, 0.05, 0.2],
      scale: [1.1, 1.1, 1.1, 1.1],
      rotation: { xw: 0.25, yz: 0.4 },
    };
    const prepared = prepareChaosGame4(transforms4, finalTransform4);
    const palette = transformColors(transforms4.length);
    const width = 64;
    const height = 64;
    const iterations = 5000;
    const seed = 42;

    const rotor = rotationMatrix4({ xw: 0.35, yw: -0.2, xy: 0.15 });
    const center: Vec4 = [0.05, -0.03, 0.02, 0.1];
    // prettier-ignore
    const camera: Mat4 = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 1, 3,
    ];
    const projection = composeFlameProjection4(
      camera,
      composeRotorProjection4(rotor, center),
    );
    // sliceOn: false here — the slice/ghost-floor weighting has its own
    // dedicated test below (fixed-point system, immune to the ULP noise a
    // real weighted Gaussian would introduce over thousands of iterations);
    // this oracle isolates the projection/plot/pick math, at weight 1 always.
    const view: FourDFlameView = {
      invWAmp: 0.8,
      sliceOn: false,
      sliceCenter: 0.1,
      sliceWidth: 0.6,
    };

    const actual = accumulateFlame4(
      prepared,
      projection,
      view,
      width,
      height,
      iterations,
      mulberry32(seed),
      { kind: "transform", palette },
    );

    const rng = mulberry32(seed);
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    let w = rng() - 0.5;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const step = stepOrbit4(prepared, x, y, z, w, rng);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
    }
    const expected = createFlameHistogram(width, height);
    for (let i = 0; i < iterations; i++) {
      const step = stepOrbit4(prepared, x, y, z, w, rng);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
      const [px, py, pz, pw] = plotPoint4(prepared, x, y, z, w, rng);

      // Two-step rotor projection, exactly as project4.ts documents:
      // q = R * (v - center); p = q.xyz + center.xyz; sRaw = q.w (no + center.w).
      const vx = px - center[0];
      const vy = py - center[1];
      const vz = pz - center[2];
      const vw = pw - center[3];
      const qx = rotor[0] * vx + rotor[1] * vy + rotor[2] * vz + rotor[3] * vw;
      const qy = rotor[4] * vx + rotor[5] * vy + rotor[6] * vz + rotor[7] * vw;
      const qz =
        rotor[8] * vx + rotor[9] * vy + rotor[10] * vz + rotor[11] * vw;
      const qw =
        rotor[12] * vx + rotor[13] * vy + rotor[14] * vz + rotor[15] * vw;
      const projx = qx + center[0];
      const projy = qy + center[1];
      const projz = qz + center[2];
      const sRaw = qw;

      const cw =
        camera[12] * projx +
        camera[13] * projy +
        camera[14] * projz +
        camera[15];
      if (cw <= 0) continue;
      const cx =
        camera[0] * projx + camera[1] * projy + camera[2] * projz + camera[3];
      const cy =
        camera[4] * projx + camera[5] * projy + camera[6] * projz + camera[7];
      const ndcX = cx / cw;
      const ndcY = cy / cw;
      const col = Math.floor((ndcX + 1) * 0.5 * width);
      const row = Math.floor((1 - ndcY) * 0.5 * height);
      if (col < 0 || col >= width || row < 0 || row >= height) continue;

      const sScaled = sRaw * view.invWAmp;
      const s = sScaled < -1 ? -1 : sScaled > 1 ? 1 : sScaled;
      const weight = view.sliceOn
        ? sliceWeight(s, view.sliceCenter, view.sliceWidth, 0.06)
        : 1;

      const bucket = row * width + col;
      expected.hits[bucket] += weight;
      expected.maxHits = Math.max(expected.maxHits, expected.hits[bucket]);
      const rgb = palette[step.index] ?? [1, 1, 1];
      const o = bucket * 3;
      expected.sumRGB[o] += rgb[0] * weight;
      expected.sumRGB[o + 1] += rgb[1] * weight;
      expected.sumRGB[o + 2] += rgb[2] * weight;
    }
    expected.orbit = [x, y, z];
    expected.orbitW = w;

    expect(Array.from(actual.hits)).toEqual(Array.from(expected.hits));
    expect(Array.from(actual.sumRGB)).toEqual(Array.from(expected.sumRGB));
    expect(actual.maxHits).toBe(expected.maxHits);
    expect(actual.orbit).toEqual(expected.orbit);
    expect(actual.orbitW).toBe(expected.orbitW);
  });
});

describe("accumulateFlame4 determinism", () => {
  it("produces identical histograms for the same seed", () => {
    const prepared = prepareChaosGame4(weightedPentatope());
    const color: FlameColor4 = {
      kind: "transform",
      palette: transformColors(5),
    };
    const a = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      16,
      16,
      2000,
      mulberry32(5),
      color,
    );
    const b = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      16,
      16,
      2000,
      mulberry32(5),
      color,
    );
    expect(Array.from(a.hits)).toEqual(Array.from(b.hits));
    expect(Array.from(a.sumRGB)).toEqual(Array.from(b.sumRGB));
    expect(a.orbit).toEqual(b.orbit);
    expect(a.orbitW).toBe(b.orbitW);
  });

  it("differs for a different seed", () => {
    const prepared = prepareChaosGame4(weightedPentatope());
    const color: FlameColor4 = {
      kind: "transform",
      palette: transformColors(5),
    };
    const a = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      16,
      16,
      2000,
      mulberry32(5),
      color,
    );
    const b = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      16,
      16,
      2000,
      mulberry32(6),
      color,
    );
    expect(Array.from(a.hits)).not.toEqual(Array.from(b.hits));
  });
});

describe("accumulateFlame4 progressive accumulation", () => {
  it("chunked calls (same rng instance, histogram threaded through) match a single-shot run of the same total — pins orbit/orbitW/orbitColor continuation", () => {
    const prepared = prepareChaosGame4(weightedPentatope());
    const lut = buildPaletteLUT("spectrum");
    if (!lut) throw new Error("spectrum should have a LUT");
    const color: FlameColor4 = { kind: "structural", lut };
    const width = 32;
    const height = 32;

    const chunkedRng = mulberry32(11);
    let chunked = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      400,
      chunkedRng,
      color,
    );
    chunked = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      600,
      chunkedRng,
      color,
      chunked,
    );

    const singleShot = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      1000,
      mulberry32(11),
      color,
    );

    expect(Array.from(chunked.hits)).toEqual(Array.from(singleShot.hits));
    expect(Array.from(chunked.sumRGB)).toEqual(Array.from(singleShot.sumRGB));
    expect(chunked.maxHits).toBe(singleShot.maxHits);
    expect(chunked.orbit).toEqual(singleShot.orbit);
    expect(chunked.orbitW).toBe(singleShot.orbitW);
    expect(chunked.orbitColor).toBe(singleShot.orbitColor);
  });
});

describe("accumulateFlame4 soft w-slice floor (fr-6x2 ghost context)", () => {
  it("lands every iteration in one predictable bucket, weighted at the 0.06 ghost floor when far outside the slice", () => {
    // A fixed point AT the rotor's pivot (the origin) has q = R*(v - center)
    // = R*0 = 0 regardless of the rotor, so sRaw = q.w = 0 exactly — ~20
    // slice-widths from sliceCenter = 1, which underflows the Gaussian to
    // exactly 0 in double precision, pinning every iteration's weight at
    // exactly the 0.06 floor (see project4.ts's sliceWeight).
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    const view: FourDFlameView = {
      invWAmp: 1,
      sliceOn: true,
      sliceCenter: 1,
      sliceWidth: 0.05,
    };
    const width = 10;
    const height = 10;
    const iterations = 1000;
    const color: FlameColor4 = {
      kind: "transform",
      palette: transformColors(1),
    };

    const hist = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      view,
      width,
      height,
      iterations,
      mulberry32(1),
      color,
    );

    // NDC (0, 0) -> col = floor(0.5 * 10) = 5, row = floor(0.5 * 10) = 5.
    const centerBucket = 5 * 10 + 5;
    expect(hist.hits[centerBucket]).toBeCloseTo(iterations * 0.06, 6);
    expect(hist.hits.reduce((a, b) => a + b, 0)).toBeCloseTo(
      iterations * 0.06,
      6,
    );
  });
});

describe("accumulateFlame4 color kinds", () => {
  const width = 10;
  const height = 10;
  // NDC (0, 0) -> col = floor(0.5 * 10) = 5, row = floor(0.5 * 10) = 5 —
  // every fixture below lands its single point at the exact origin in xyz
  // (the identity rotor about the origin leaves it untouched), so every test
  // shares this same landing bucket.
  const centerBucket = 5 * 10 + 5;

  it("structural: pins the LUT color at c = 0.5 (a single-transform system stays pinned there)", () => {
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    const lut = new Float32Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      lut[i * 3] = i / 255;
      lut[i * 3 + 1] = 0;
      lut[i * 3 + 2] = 1 - i / 255;
    }
    const hist = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      1,
      mulberry32(1),
      { kind: "structural", lut },
    );
    const li = 128 * 3; // (0.5 * 256) | 0 = 128.
    const o = centerBucket * 3;
    expect(hist.sumRGB[o]).toBe(lut[li]);
    expect(hist.sumRGB[o + 1]).toBe(lut[li + 1]);
    expect(hist.sumRGB[o + 2]).toBe(lut[li + 2]);
  });

  it("wRamp: matches wRampColor at the point's normalized signed-w signal", () => {
    // Fixed point at w = 0.5, rotor pivot at the origin, identity rotor and
    // invWAmp = 1: sRaw = q.w = 0.5 - 0 = 0.5 exactly, so s = 0.5.
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0.5]));
    const side = W_SIDE_PALETTES.wBlueOrange;
    const hist = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      1,
      mulberry32(1),
      { kind: "wRamp", side },
    );
    const expected = wRampColor(0.5, side);
    const o = centerBucket * 3;
    expect(hist.sumRGB[o]).toBe(expected[0]);
    expect(hist.sumRGB[o + 1]).toBe(expected[1]);
    expect(hist.sumRGB[o + 2]).toBe(expected[2]);
  });

  it("transform: pins palette[idx] for the single transform that fired", () => {
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    const palette = transformColors(1);
    const hist = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      1,
      mulberry32(1),
      { kind: "transform", palette },
    );
    const expected = palette[0];
    const o = centerBucket * 3;
    expect(hist.sumRGB[o]).toBe(expected[0]);
    expect(hist.sumRGB[o + 1]).toBe(expected[1]);
    expect(hist.sumRGB[o + 2]).toBe(expected[2]);
  });

  it("radius: pins the radius-ramp LUT at the point's normalized 4D distance from color.center", () => {
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    const lut = buildColorModeLUT("radius", 1);
    const hist = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      1,
      mulberry32(1),
      { kind: "radius", lut, center: [1, 0, 0, 0], minD: 0, maxD: 2 },
    );
    // d4 = distance((0,0,0,0), (1,0,0,0)) = 1; t = (1 - 0) / (2 - 0) = 0.5;
    // li = (0.5 * 255 + 0.5) | 0 = 128 (round-to-nearest — voxel.ts's convention).
    const li = 128 * 3;
    const o = centerBucket * 3;
    expect(hist.sumRGB[o]).toBe(lut[li]);
    expect(hist.sumRGB[o + 1]).toBe(lut[li + 1]);
    expect(hist.sumRGB[o + 2]).toBe(lut[li + 2]);
  });
});

describe("accumulateFlame4 validation", () => {
  it("throws for a projection that isn't 20 entries", () => {
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    expect(() =>
      accumulateFlame4(
        prepared,
        new Float64Array(16),
        FLAT_VIEW,
        10,
        10,
        1,
        mulberry32(1),
        { kind: "transform", palette: transformColors(1) },
      ),
    ).toThrow(RangeError);
  });

  it("throws when a passed-in histogram's dimensions don't match width/height", () => {
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    const mismatched = createFlameHistogram(5, 5);
    expect(() =>
      accumulateFlame4(
        prepared,
        FLAT_PROJECTION,
        FLAT_VIEW,
        10,
        10,
        1,
        mulberry32(1),
        { kind: "transform", palette: transformColors(1) },
        mismatched,
      ),
    ).toThrow(RangeError);
  });
});
