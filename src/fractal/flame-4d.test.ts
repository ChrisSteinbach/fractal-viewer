import { accumulateFlame4 } from "./flame-4d";
import {
  CHAOS_SUB_ORBIT_POINTS,
  DEFAULT_COLOR_SPEED,
  ESCAPE_LIMIT,
  WARMUP_ITERATIONS,
  derivedColorIndex,
} from "./chaos-game";
import { plotPoint4, prepareChaosGame4, stepOrbit4 } from "./chaos-game-4d";
import type { PreparedChaosGame4 } from "./chaos-game-4d";
import { rotationMatrix4, toTransform4 } from "./affine4";
import {
  buildColorModeLUT,
  transformColors,
  wRampColor,
  W_SIDE_PALETTES,
} from "./color";
import type { FourDRenderColor } from "./color";
import { buildPaletteLUT } from "./palette";
import { balloonPaletteCoordinate, buildBalloonFromBall } from "./balloon-de";
import {
  composeFlameProjection4,
  composeRotorProjection4,
  sliceWeight,
  SLICE_GHOST_FLOOR,
} from "./project4";
import type { FourDView } from "./project4";
import { createFlameHistogram } from "./flame";
import type { FlameHistogram, Mat4 } from "./flame";
import { pentatope } from "./presets";
import { mulberry32 } from "./rng";
import type { Rng } from "./rng";
import {
  createPointTilingCursorState,
  POINT_TILING_ACCUMULATION_FANOUT_CAP,
  resolvePointTilingPlan,
  visitPointTilingAttemptBounded,
  visitPointTilingImagesExhaustive,
} from "./point-tiling";
import type { PointTilingPlan } from "./point-tiling";
import type { ShapeSpec } from "./shapes";
import { foldToChamber, resolveTiling, TILING_GROUP_INFO } from "./tiling";
import type { TilingSpec } from "./tiling";
import type { Transform4, Vec3, Vec4 } from "./types";

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

const FLAT_VIEW: FourDView = {
  invWAmp: 1,
  sliceOn: false,
  sliceCenter: 0,
  sliceWidth: 1,
  sliceRelativeColor: false,
};

// Every raw image lands in the sole pixel, while the fourth row exposes raw
// image w unchanged for w-ramp and slice tests.
const RAW_W_PROJECTION = new Float64Array([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0,
]);

function pointPlan4(spec: TilingSpec, radius?: number): PointTilingPlan {
  let resolved;
  if ("kind" in spec) {
    if (radius === undefined) throw new Error("lattice fixture needs a radius");
    resolved = resolveTiling(spec, radius);
  } else {
    resolved = resolveTiling(spec);
  }
  if (!resolved) throw new Error("test tiling did not resolve");
  const plan = resolvePointTilingPlan(resolved, 4);
  if (!plan) throw new Error("test point-tiling plan did not resolve");
  return plan;
}

function genericF4ChamberPoint(): Vec4 {
  const point = foldToChamber(
    TILING_GROUP_INFO.f4,
    [0.11, -0.17, 0.19, 0.23],
    [0, 0, 0, 0],
  );
  if (!point) throw new Error("F4 fixture did not fold");
  return point as Vec4;
}

function accumulateTiled4(
  prepared: PreparedChaosGame4,
  projection: Float64Array,
  view: FourDView,
  width: number,
  height: number,
  iterations: number,
  rng: Rng,
  color: FourDRenderColor,
  plan: PointTilingPlan,
  histogram?: FlameHistogram,
): FlameHistogram {
  return accumulateFlame4(
    prepared,
    projection,
    view,
    width,
    height,
    iterations,
    rng,
    color,
    histogram,
    undefined,
    undefined,
    undefined,
    undefined,
    plan,
  );
}

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
    const view: FourDView = {
      invWAmp: 0.8,
      sliceOn: false,
      sliceCenter: 0.1,
      sliceWidth: 0.6,
      sliceRelativeColor: false,
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

describe("accumulateFlame4 escape-reseed", () => {
  it("reseeds every iteration when the map always lands past ESCAPE_LIMIT, keeping the histogram finite and resetting the color coordinate to 0.5", () => {
    // The 4D twin of flame.test.ts's escape-reseed test: every oracle above
    // is built from a contracting system that never escapes, so none of
    // them walks flame-4d.ts's inlined reseed branch. This map always lands
    // at (2 * ESCAPE_LIMIT) on every axis — comfortably past the limit
    // regardless of the current orbit point — so EVERY iteration of the hot
    // loop walks that branch. colorIndex/colorSpeed are authored well away
    // from 0.5 for the same reason as the 3D test: at the derived defaults
    // of a single-map system the blend alone is already a fixed point at
    // 0.5, which would make the reset assertion pass even with the reset
    // deleted.
    const escapedCoord = ESCAPE_LIMIT * 2;
    const transforms4 = fixedPointSystem4([
      escapedCoord,
      escapedCoord,
      escapedCoord,
      escapedCoord,
    ]).map((t) => ({ ...t, colorIndex: 0.9, colorSpeed: 0.8 }));
    const prepared = prepareChaosGame4(transforms4);
    const lut = buildPaletteLUT("spectrum");
    if (!lut) throw new Error("spectrum should have a LUT");

    const hist = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      10,
      10,
      30,
      mulberry32(1),
      { kind: "structural", lut },
    );

    // Every reseed redraws x/y/z/w in [-0.5, 0.5) — comfortably inside the
    // 10x10 frame — so a working guard leaves a populated, finite
    // histogram; a deleted guard leaves the point stuck outside
    // ESCAPE_LIMIT forever, permanently outside the frame, and every bucket
    // at zero.
    expect(Array.from(hist.hits).some((h) => h > 0)).toBe(true);
    expect(Array.from(hist.hits).every(Number.isFinite)).toBe(true);
    expect(Array.from(hist.sumRGB).every(Number.isFinite)).toBe(true);
    // The reset is the last thing every iteration does to c, so it lands
    // exactly on 0.5 regardless of how many iterations ran.
    expect(hist.orbitColor).toBe(0.5);
  });
});

describe("accumulateFlame4 determinism", () => {
  it("produces identical histograms for the same seed", () => {
    const prepared = prepareChaosGame4(weightedPentatope());
    const color: FourDRenderColor = {
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
    const color: FourDRenderColor = {
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
    const color: FourDRenderColor = { kind: "structural", lut };
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

describe("accumulateFlame4 soft w-slice floor (ghost context)", () => {
  it("lands every iteration in one predictable bucket, weighted at the 0.06 ghost floor when far outside the slice", () => {
    // A fixed point AT the rotor's pivot (the origin) has q = R*(v - center)
    // = R*0 = 0 regardless of the rotor, so sRaw = q.w = 0 exactly — ~20
    // slice-widths from sliceCenter = 1, which underflows the Gaussian to
    // exactly 0 in double precision, pinning every iteration's weight at
    // exactly the 0.06 floor (see project4.ts's sliceWeight).
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    const view: FourDView = {
      invWAmp: 1,
      sliceOn: true,
      sliceCenter: 1,
      sliceWidth: 0.05,
      sliceRelativeColor: false,
    };
    const width = 10;
    const height = 10;
    const iterations = 1000;
    const color: FourDRenderColor = {
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

  it("wRamp: with the slice on and sliceRelativeColor, matches wRampColor at the slice-recentered signal", () => {
    // Same fixture as the previous test (s = 0.5 exactly), now with the
    // slice on and sliceRelativeColor true: the ramp evaluates at (s -
    // sliceCenter) / (2 * sliceWidth) instead of the raw s. With the slice
    // on, the single hit carries weight = sliceWeight(s, 0.25, 0.3, 0.06)
    // (the flame's ghost floor) rather than 1, so sumRGB / hits cancels the
    // weight back out to the plain wRampColor triple.
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0.5]));
    const side = W_SIDE_PALETTES.wBlueOrange;
    const view: FourDView = {
      invWAmp: 1,
      sliceOn: true,
      sliceCenter: 0.25,
      sliceWidth: 0.3,
      sliceRelativeColor: true,
    };
    const hist = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      view,
      width,
      height,
      1,
      mulberry32(1),
      { kind: "wRamp", side },
    );
    const s = 0.5;
    const weight = sliceWeight(s, 0.25, 0.3, 0.06);
    const expected = wRampColor((s - 0.25) / (2 * 0.3), side);
    const o = centerBucket * 3;
    expect(hist.hits[centerBucket]).toBeCloseTo(weight, 12);
    expect(hist.sumRGB[o] / hist.hits[centerBucket]).toBeCloseTo(
      expected[0],
      12,
    );
    expect(hist.sumRGB[o + 1] / hist.hits[centerBucket]).toBeCloseTo(
      expected[1],
      12,
    );
    expect(hist.sumRGB[o + 2] / hist.hits[centerBucket]).toBeCloseTo(
      expected[2],
      12,
    );
  });

  it("wRamp: sliceRelativeColor changes the accumulated color but never the slice weight", () => {
    // sliceCenter (0.25) sits off the fixed point's s (0.5), so recentering
    // the ramp on it genuinely changes which color is sampled — while the
    // slice WEIGHT (sliceWeight, unaffected by sliceColorRemap) stays
    // identical between the two runs.
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0.5]));
    const side = W_SIDE_PALETTES.wBlueOrange;
    const baseView = {
      invWAmp: 1,
      sliceOn: true,
      sliceCenter: 0.25,
      sliceWidth: 0.3,
    };
    const withoutRemap = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      { ...baseView, sliceRelativeColor: false },
      width,
      height,
      1,
      mulberry32(1),
      { kind: "wRamp", side },
    );
    const withRemap = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      { ...baseView, sliceRelativeColor: true },
      width,
      height,
      1,
      mulberry32(1),
      { kind: "wRamp", side },
    );
    expect(Array.from(withRemap.hits)).toEqual(Array.from(withoutRemap.hits));
    expect(Array.from(withRemap.sumRGB)).not.toEqual(
      Array.from(withoutRemap.sumRGB),
    );
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

  it("Height/Position/Uniform lift the raw-XYZ 3D color semantics", () => {
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    const axes = {
      x: [0, 1, 0] as Vec3,
      y: [0, 0, 1] as Vec3,
      z: [1, 0, 0] as Vec3,
    };
    const heightLut = buildColorModeLUT("height", 2);
    const render = (color: FourDRenderColor) =>
      accumulateFlame4(
        prepared,
        FLAT_PROJECTION,
        FLAT_VIEW,
        width,
        height,
        1,
        mulberry32(1),
        color,
      );
    const o = centerBucket * 3;

    const heightHist = render({
      kind: "height",
      lut: heightLut,
      minY: -1,
      maxY: 3,
    });
    expect(Array.from(heightHist.sumRGB.slice(o, o + 3))).toEqual(
      Array.from(heightLut.slice(64 * 3, 64 * 3 + 3)),
    );

    const positionHist = render({
      kind: "position",
      min: [-1, -2, -3],
      max: [3, 2, 1],
      colorGamma: 1,
      axisColors: axes,
    });
    expect(Array.from(positionHist.sumRGB.slice(o, o + 3))).toEqual(
      [0.8, 0.4, 0.6].map(Math.fround),
    );

    const uniformHist = render({
      kind: "uniform",
      color: [0.4, 0.8, 1],
    });
    expect(Array.from(uniformHist.sumRGB.slice(o, o + 3))).toEqual([
      0.4, 0.8, 1,
    ]);
  });
});

describe("accumulateFlame4 structural coloring: per-transform colorIndex/colorSpeed", () => {
  it("pins an all-absent render exactly identical to the same system with every derived default authored explicitly", () => {
    const base = pentatope().map(toTransform4);
    const n = base.length;
    const withDefaultsAuthored = base.map((t, i) => ({
      ...t,
      colorIndex: derivedColorIndex(i, n),
      colorSpeed: DEFAULT_COLOR_SPEED,
    }));
    const lut = buildPaletteLUT("spectrum");
    if (!lut) throw new Error("spectrum should have a LUT");
    const width = 32;
    const height = 32;
    const iterations = 3000;

    const absent = accumulateFlame4(
      prepareChaosGame4(base),
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      iterations,
      mulberry32(13),
      { kind: "structural", lut },
    );
    const explicit = accumulateFlame4(
      prepareChaosGame4(withDefaultsAuthored),
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      iterations,
      mulberry32(13),
      { kind: "structural", lut },
    );

    expect(Array.from(explicit.hits)).toEqual(Array.from(absent.hits));
    expect(Array.from(explicit.sumRGB)).toEqual(Array.from(absent.sumRGB));
    expect(explicit.maxHits).toBe(absent.maxHits);
    expect(explicit.orbitColor).toBe(absent.orbitColor);
  });

  it("colorSpeed: 0 pins the color coordinate at its 0.5 start for every point, whichever map fires", () => {
    const transforms = pentatope()
      .map(toTransform4)
      .map((t) => ({ ...t, colorSpeed: 0 }));
    const lut = buildPaletteLUT("spectrum");
    if (!lut) throw new Error("spectrum should have a LUT");
    const width = 32;
    const height = 32;
    const iterations = 3000;

    const hist = accumulateFlame4(
      prepareChaosGame4(transforms),
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      iterations,
      mulberry32(6),
      { kind: "structural", lut },
    );

    // Speed 0 never blends c toward a map's slot, and escape-reseed resets it
    // to 0.5 too, so it stays exactly 0.5 the entire run — every accumulated
    // point took the LUT sample at c = 0.5, regardless of which map fired.
    expect(hist.orbitColor).toBe(0.5);
    const li = 128 * 3; // (0.5 * 256) | 0 = 128.
    const totalHits = hist.hits.reduce((a, b) => a + b, 0);
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let i = 0; i < width * height; i++) {
      sumR += hist.sumRGB[i * 3];
      sumG += hist.sumRGB[i * 3 + 1];
      sumB += hist.sumRGB[i * 3 + 2];
    }
    expect(sumR).toBeCloseTo(lut[li] * totalHits, 6);
    expect(sumG).toBeCloseTo(lut[li + 1] * totalHits, 6);
    expect(sumB).toBeCloseTo(lut[li + 2] * totalHits, 6);
  });

  it("authored colorIndex/colorSpeed never perturb the orbit: hits match a derived render, same seed", () => {
    const base = pentatope().map(toTransform4);
    const colored = base.map((t, i) => ({
      ...t,
      colorIndex: (i + 1) / (base.length + 1),
      colorSpeed: 0.2,
    }));
    const lut = buildPaletteLUT("spectrum");
    if (!lut) throw new Error("spectrum should have a LUT");
    const width = 32;
    const height = 32;
    const iterations = 3000;

    const plain = accumulateFlame4(
      prepareChaosGame4(base),
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      iterations,
      mulberry32(4),
      { kind: "structural", lut },
    );
    const withColors = accumulateFlame4(
      prepareChaosGame4(colored),
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      iterations,
      mulberry32(4),
      { kind: "structural", lut },
    );

    expect(Array.from(withColors.hits)).toEqual(Array.from(plain.hits));
    expect(withColors.maxHits).toBe(plain.maxHits);
  });
});

// ---------------------------------------------------------------------------
// Kaleidoscope symmetry — the 4D twin of flame.test.ts's
// "accumulateFlame with symmetry" block.
// ---------------------------------------------------------------------------

/** A flat (w-collapsing) three-map system: `scale[3] = 0` and no w
 * translation, so after one step every orbit point sits EXACTLY on the
 * `w = 0` hyperplane. That exactness is what lets the w-plane test below
 * assert on integer-vs-fractional slice weights rather than on a tolerance. */
function flatSystem4(): Transform4[] {
  return [
    { position: [0.3, 0.2, 0.1, 0], scale: [0.5, 0.5, 0.5, 0] },
    { position: [-0.3, 0.1, -0.2, 0], scale: [0.5, 0.5, 0.5, 0] },
    { position: [0.1, -0.3, 0.25, 0], scale: [0.5, 0.5, 0.5, 0] },
  ];
}

describe("accumulateFlame4 with symmetry", () => {
  it("matches the stepOrbit4/plotPoint4 oracle when the prepared system has rotated copies", () => {
    // The oracle test at the top of this file, but with a genuinely 4D
    // kaleidoscope prepared in: stepOrbit4 already rotates a picked slot's
    // full affine + variation output, so if accumulateFlame4's hand-inlined
    // loop ever drifts from that — its post-rotation block or its BASE-index
    // handling — this is what catches it.
    const transforms4 = weightedPentatope();
    const prepared = prepareChaosGame4(transforms4, null, {
      order: 3,
      plane: "zw",
      twist: 1,
    });
    const palette = transformColors(transforms4.length);
    const width = 64;
    const height = 64;
    const iterations = 5000;
    const seed = 42;

    const actual = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
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
      const [px, py] = plotPoint4(prepared, x, y, z, w, rng);
      // FLAT_PROJECTION is `(x, y, z, w, 1) -> (x, y, z, w)` verbatim, so
      // clipW is 1 and the bucket math reduces to x/y directly.
      const col = Math.floor((px + 1) * 0.5 * width);
      const row = Math.floor((1 - py) * 0.5 * height);
      if (col < 0 || col >= width || row < 0 || row >= height) continue;
      const bucket = row * width + col;
      expected.hits[bucket] += 1;
      expected.maxHits = Math.max(expected.maxHits, expected.hits[bucket]);
      // step.index is already the BASE map (see chaos-game-4d.ts's
      // stepOrbit4), so this indexes `palette` — sized to transforms4.length,
      // NOT the expanded slot count — exactly like the no-symmetry oracle.
      const rgb = palette[step.index] ?? [1, 1, 1];
      const o = bucket * 3;
      expected.sumRGB[o] += rgb[0];
      expected.sumRGB[o + 1] += rgb[1];
      expected.sumRGB[o + 2] += rgb[2];
    }

    expect(Array.from(actual.hits)).toEqual(Array.from(expected.hits));
    expect(Array.from(actual.sumRGB)).toEqual(Array.from(expected.sumRGB));
    expect(actual.maxHits).toBe(expected.maxHits);
    expect(actual.orbit).toEqual([x, y, z]);
    expect(actual.orbitW).toBe(w);
  });

  it("order 1 renders byte-identically to omitting symmetry, whatever the plane and twist", () => {
    const transforms4 = weightedPentatope();
    const color: FourDRenderColor = {
      kind: "transform",
      palette: transformColors(transforms4.length),
    };
    const run = (prepared: ReturnType<typeof prepareChaosGame4>) =>
      accumulateFlame4(
        prepared,
        FLAT_PROJECTION,
        FLAT_VIEW,
        32,
        32,
        2000,
        mulberry32(7),
        color,
      );

    const omitted = run(prepareChaosGame4(transforms4));
    const orderOne = run(
      prepareChaosGame4(transforms4, null, {
        order: 1,
        plane: "zw",
        twist: 3,
      }),
    );

    expect(Array.from(orderOne.hits)).toEqual(Array.from(omitted.hits));
    expect(Array.from(orderOne.sumRGB)).toEqual(Array.from(omitted.sumRGB));
    expect(orderOne.maxHits).toBe(omitted.maxHits);
    expect(orderOne.orbit).toEqual(omitted.orbit);
    expect(orderOne.orbitW).toBe(omitted.orbitW);
    expect(orderOne.orbitColor).toBe(omitted.orbitColor);
  });

  it("an order-4 kaleidoscope occupies more buckets than the same system unreplicated", () => {
    const transforms4 = flatSystem4();
    const color: FourDRenderColor = {
      kind: "transform",
      palette: transformColors(transforms4.length),
    };
    const run = (prepared: ReturnType<typeof prepareChaosGame4>) =>
      accumulateFlame4(
        prepared,
        FLAT_PROJECTION,
        FLAT_VIEW,
        64,
        64,
        20000,
        mulberry32(11),
        color,
      );
    const occupied = (hits: Float64Array) =>
      Array.from(hits).filter((h) => h > 0).length;

    const plain = run(prepareChaosGame4(transforms4));
    const kaleido = run(
      prepareChaosGame4(transforms4, null, { order: 4, plane: "xy" }),
    );

    expect(occupied(kaleido.hits)).toBeGreaterThan(occupied(plain.hits));
    expect(Array.from(kaleido.hits)).not.toEqual(Array.from(plain.hits));
  });

  it("colors every kaleidoscope copy as the BASE map it copies, never as an expanded slot", () => {
    // Two maps, two saturated palette entries and NO third: an accumulator
    // that indexed `palette` by the expanded slot (0..5 at order 3) would
    // fall through to accumulateFlame4's white FALLBACK_COLOR and light the
    // blue channel, which the base palette can never do.
    const transforms4 = flatSystem4().slice(0, 2);
    const palette: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
    ];
    const hist = accumulateFlame4(
      prepareChaosGame4(transforms4, null, { order: 3, plane: "xy" }),
      FLAT_PROJECTION,
      FLAT_VIEW,
      32,
      32,
      20000,
      mulberry32(3),
      { kind: "transform", palette },
    );

    expect(hist.maxHits).toBeGreaterThan(0);
    for (let i = 0; i < hist.hits.length; i++) {
      const o = i * 3;
      expect(hist.sumRGB[o + 2]).toBe(0); // no white fallback ever fired.
      // Every hit contributed exactly one saturated channel, so red + green
      // accounts for the bucket's whole hit count.
      expect(hist.sumRGB[o] + hist.sumRGB[o + 1]).toBe(hist.hits[i]);
    }
  });

  it("a w-plane moves density off the w = 0 slice; a w-free plane leaves it exactly on it", () => {
    // flatSystem4 collapses w to exactly 0, and FLAT_PROJECTION's sRaw row is
    // w verbatim, so under a narrow slice centered at 0 every in-slice point
    // weighs exactly 1 — every bucket an integer. A zw-plane copy turns z
    // into w, which no other mechanism in this render can do.
    const transforms4 = flatSystem4();
    const slice: FourDView = {
      invWAmp: 1,
      sliceOn: true,
      sliceCenter: 0,
      sliceWidth: 0.05,
      sliceRelativeColor: false,
    };
    const run = (plane: "xy" | "zw") =>
      accumulateFlame4(
        prepareChaosGame4(transforms4, null, { order: 4, plane }),
        FLAT_PROJECTION,
        slice,
        48,
        48,
        20000,
        mulberry32(5),
        { kind: "transform", palette: transformColors(transforms4.length) },
      );

    const wFree = run("xy");
    const wPlane = run("zw");

    expect(wFree.maxHits).toBeGreaterThan(0);
    expect(Array.from(wFree.hits).every(Number.isInteger)).toBe(true);
    expect(Array.from(wPlane.hits).some((h) => !Number.isInteger(h))).toBe(
      true,
    );
  });
});

describe("accumulateFlame4 balloon echo", () => {
  it("projects to the visible 3D point before inversion, inherits slice weight, and tints only the echo", () => {
    const point: Vec4 = [0.25, 0, 0, 2];
    const prepared = prepareChaosGame4(fixedPointSystem4(point));
    const palette: Vec3[] = [[0.8, 0.2, 0.1]];
    const rotorProjection = composeRotorProjection4(
      IDENTITY_ROTOR,
      [0, 0, 0, 0],
    );
    const projection = composeFlameProjection4(ORTHOGRAPHIC, rotorProjection);
    const view: FourDView = {
      ...FLAT_VIEW,
      sliceOn: true,
      sliceCenter: 0,
      sliceWidth: 0.5,
    };
    const iterations = 8;
    const hist = accumulateFlame4(
      prepared,
      projection,
      view,
      20,
      20,
      iterations,
      mulberry32(3),
      { kind: "transform", palette },
      undefined,
      {
        // After the identity rotor drops w, x = 0.25. R² = 0.125 maps that
        // visible 3D source to x = 0.5. Inverting the ORIGINAL 4D point would
        // include w = 2 in the denominator and land near x = 0.008 instead.
        balloon: buildBalloonFromBall(
          { center: [0, 0, 0], radius: 0.5 },
          Math.SQRT1_2,
        ),
        tint: [0, 1, 0],
        tintStrength: 1,
        weight: 0.25,
      },
      rotorProjection,
      ORTHOGRAPHIC,
    );

    const sourceWeight = sliceWeight(1, 0, 0.5, 0.06);
    const sourceBucket = 10 * 20 + 12; // projected x = 0.25.
    const echoBucket = 10 * 20 + 15; // 3D inversion x = 0.5.
    const wrong4DInversionBucket = 10 * 20 + 10;
    expect(hist.hits[sourceBucket]).toBeCloseTo(iterations * sourceWeight, 12);
    expect(hist.sumRGB[sourceBucket * 3]).toBeCloseTo(
      0.8 * iterations * sourceWeight,
      12,
    );
    expect(hist.sumRGB[sourceBucket * 3 + 1]).toBeCloseTo(
      0.2 * iterations * sourceWeight,
      12,
    );
    expect(hist.sumRGB[sourceBucket * 3 + 2]).toBeCloseTo(
      0.1 * iterations * sourceWeight,
      12,
    );
    expect(hist.hits[echoBucket]).toBeCloseTo(
      iterations * sourceWeight * 0.25,
      12,
    );
    expect(hist.sumRGB[echoBucket * 3]).toBe(0);
    expect(hist.sumRGB[echoBucket * 3 + 1]).toBeCloseTo(
      iterations * sourceWeight * 0.25,
      12,
    );
    expect(hist.sumRGB[echoBucket * 3 + 2]).toBe(0);
    expect(hist.hits[wrong4DInversionBucket]).toBe(0);
  });

  it("samples the independent palette from the projected pre-inversion 3D source before tint and weight", () => {
    const source4: Vec4 = [0.25, 0, 0, 2];
    const palette: Vec3[] = [[0.8, 0.2, 0.1]];
    const rotorProjection = composeRotorProjection4(
      IDENTITY_ROTOR,
      [0, 0, 0, 0],
    );
    const balloon = buildBalloonFromBall(
      { center: [0, 0, 0], radius: 0.5 },
      Math.SQRT1_2,
    );
    const echoColorLUT = new Float32Array(256 * 3);
    const source3: Vec3 = [0.25, 0, 0];
    const li =
      Math.min(255, (balloonPaletteCoordinate(balloon, source3) * 256) | 0) * 3;
    echoColorLUT.set([0.1, 0.5, 0.9], li);
    const iterations = 8;
    const hist = accumulateFlame4(
      prepareChaosGame4(fixedPointSystem4(source4)),
      composeFlameProjection4(ORTHOGRAPHIC, rotorProjection),
      FLAT_VIEW,
      20,
      20,
      iterations,
      mulberry32(3),
      { kind: "transform", palette },
      undefined,
      {
        balloon,
        tint: [0.9, 0.1, 0.3],
        tintStrength: 0.25,
        weight: 0.5,
      },
      rotorProjection,
      ORTHOGRAPHIC,
      echoColorLUT,
    );

    const sourceBucket = 10 * 20 + 12;
    const echoBucket = 10 * 20 + 15;
    for (const [channel, value] of palette[0].entries()) {
      expect(hist.sumRGB[sourceBucket * 3 + channel]).toBeCloseTo(
        value * iterations,
        12,
      );
    }
    const echoWeight = iterations * 0.5;
    const sampled = [
      echoColorLUT[li],
      echoColorLUT[li + 1],
      echoColorLUT[li + 2],
    ];
    const tint: Vec3 = [0.9, 0.1, 0.3];
    for (let channel = 0; channel < 3; channel++) {
      const expected =
        (sampled[channel] + (tint[channel] - sampled[channel]) * 0.25) *
        echoWeight;
      expect(hist.sumRGB[echoBucket * 3 + channel]).toBeCloseTo(expected, 12);
    }
  });

  it("keeps an explicitly absent echo byte-identical to the original call shape", () => {
    const prepared = prepareChaosGame4(weightedPentatope());
    const color: FourDRenderColor = {
      kind: "transform",
      palette: transformColors(5),
    };
    const plain = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      32,
      32,
      5000,
      mulberry32(29),
      color,
    );
    const absent = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      32,
      32,
      5000,
      mulberry32(29),
      color,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(Array.from(absent.hits)).toEqual(Array.from(plain.hits));
    expect(Array.from(absent.sumRGB)).toEqual(Array.from(plain.sumRGB));
    expect(absent.maxHits).toBe(plain.maxHits);
    expect(absent.orbit).toEqual(plain.orbit);
    expect(absent.orbitW).toBe(plain.orbitW);
    expect(absent.orbitColor).toBe(plain.orbitColor);
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

  it("requires the separate rotor and camera projections when balloon echo is on", () => {
    const prepared = prepareChaosGame4(fixedPointSystem4([0.25, 0, 0, 0]));
    const echo = {
      balloon: buildBalloonFromBall(
        { center: [0, 0, 0] as Vec3, radius: 1 },
        1,
      ),
      tint: [0, 0, 0] as Vec3,
      tintStrength: 0,
      weight: 0.5,
    };
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
        undefined,
        echo,
      ),
    ).toThrow(/rotorProjection/);
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
        undefined,
        echo,
        composeRotorProjection4(IDENTITY_ROTOR, [0, 0, 0, 0]),
      ),
    ).toThrow(/cameraProjection/);
  });
});

describe("accumulateFlame4 graph-directed selection (chaos rows)", () => {
  // The weighted pentatope plus one origin-anchored spherical map (which
  // occasionally blows the orbit past ESCAPE_LIMIT), all carrying chi rows —
  // the 4D twin of flame.test.ts's chi fixture: weighted picks, escapes,
  // and row-directed selection in one system.
  function chiSystem4(): Transform4[] {
    const base = weightedPentatope().map((t, i) => ({
      ...t,
      chaos: [1, 0.25, 1.5, 1, 0.5, 2].map((v, j) => (j === i ? 1 : v)),
    }));
    base.push({
      position: [0, 0, 0, 0],
      scale: [0.6, 0.6, 0.6, 0.6],
      variations: [{ type: "spherical", weight: 1 }],
      chaos: [2, 1, 1, 1, 1, 0],
    });
    return base;
  }

  it("matches a stepOrbit4/plotPoint4 reference under chi — weighted, kaleidoscope order 2, escapes, a sub-orbit boundary, structural color", () => {
    const transforms4 = chiSystem4();
    const symmetry = { order: 2, plane: "xy" as const };
    const prepared = prepareChaosGame4(transforms4, null, symmetry);
    const lut = buildPaletteLUT("spectrum");
    if (!lut) throw new Error("spectrum should have a LUT");
    const width = 64;
    const height = 64;
    const iterations = 6000;
    const seed = 42;
    const n = transforms4.length;

    const actual = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      iterations,
      mulberry32(seed),
      { kind: "structural", lut },
    );

    const rng = mulberry32(seed);
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    let w = rng() - 0.5;
    let prevBase = -1;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const step = stepOrbit4(prepared, x, y, z, w, rng, rng, prevBase);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
      prevBase = step.escaped ? -1 : step.index;
    }
    const expected = createFlameHistogram(width, height);
    let c = 0.5;
    let chaosLeft = CHAOS_SUB_ORBIT_POINTS;
    for (let i = 0; i < iterations; i++) {
      if (chaosLeft <= 0) {
        x = rng() - 0.5;
        y = rng() - 0.5;
        z = rng() - 0.5;
        w = rng() - 0.5;
        prevBase = -1;
        for (let k = 0; k < WARMUP_ITERATIONS; k++) {
          const step = stepOrbit4(prepared, x, y, z, w, rng, rng, prevBase);
          x = step.x;
          y = step.y;
          z = step.z;
          w = step.w;
          prevBase = step.escaped ? -1 : step.index;
        }
        c = 0.5;
        chaosLeft = CHAOS_SUB_ORBIT_POINTS;
      }
      chaosLeft--;
      const step = stepOrbit4(prepared, x, y, z, w, rng, rng, prevBase);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
      // Blend-at-pick, overwritten by the escape reset — same net value as
      // the inlined ordering (see flame.test.ts's chi oracle).
      const slot = n > 1 ? step.index / (n - 1) : 0.5;
      c = (c + slot) / 2;
      if (step.escaped) c = 0.5;
      prevBase = step.escaped ? -1 : step.index;
      const [px, py, pz, pw] = plotPoint4(prepared, x, y, z, w, rng);

      // FLAT_PROJECTION: clipX = x, clipY = y, clipW = 1 — project by hand.
      const col = Math.floor((px + 1) * 0.5 * width);
      const row = Math.floor((1 - py) * 0.5 * height);
      void pz;
      void pw;
      if (col < 0 || col >= width || row < 0 || row >= height) continue;
      const bucket = row * width + col;
      expected.hits[bucket] += 1;
      expected.maxHits = Math.max(expected.maxHits, expected.hits[bucket]);
      const li = Math.min(255, (c * 256) | 0) * 3;
      const o = bucket * 3;
      expected.sumRGB[o] += lut[li];
      expected.sumRGB[o + 1] += lut[li + 1];
      expected.sumRGB[o + 2] += lut[li + 2];
    }

    expect(Array.from(actual.hits)).toEqual(Array.from(expected.hits));
    expect(Array.from(actual.sumRGB)).toEqual(Array.from(expected.sumRGB));
    expect(actual.orbit).toEqual([x, y, z]);
    expect(actual.orbitW).toBe(w);
    expect(actual.orbitColor).toBe(c);
    expect(actual.orbitPrevBase).toBe(prevBase);
    expect(actual.orbitChaosLeft).toBe(chaosLeft);
  });

  it("accumulates independently of chunk boundaries under chi — the re-fuse counter rides the histogram", () => {
    const transforms4 = chiSystem4();
    const prepared = prepareChaosGame4(transforms4);
    const palette = transformColors(transforms4.length);
    const color: FourDRenderColor = { kind: "transform", palette };
    const width = 32;
    const height = 32;

    const chunkedRng = mulberry32(11);
    let chunked = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      4000,
      chunkedRng,
      color,
    );
    chunked = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      5000,
      chunkedRng,
      color,
      chunked,
    );

    const single = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      width,
      height,
      9000,
      mulberry32(11),
      color,
    );

    expect(Array.from(chunked.hits)).toEqual(Array.from(single.hits));
    expect(Array.from(chunked.sumRGB)).toEqual(Array.from(single.sumRGB));
    expect(chunked.orbit).toEqual(single.orbit);
    expect(chunked.orbitW).toBe(single.orbitW);
    expect(chunked.orbitPrevBase).toBe(single.orbitPrevBase);
    expect(chunked.orbitChaosLeft).toBe(single.orbitChaosLeft);
  });
});

describe("accumulateFlame4 scheduled-hybrid post-word (correctness oracle)", () => {
  it("matches the stepOrbit4/plotPoint4 reference when the prepared system carries a schedule", () => {
    // The top oracle with a live post-word: plotPoint4's schedule stage
    // (flat B lifted through toTransform4, one primary draw per level,
    // post-word -> lens) is pinned in chaos-game-4d.test.ts, so equality
    // FORCES accumulateFlame4's hand-inlined copy.
    const transforms4 = weightedPentatope();
    const finalTransform4: Transform4 = {
      position: [0.15, -0.1, 0.05, 0.2],
      scale: [1.1, 1.1, 1.1, 1.1],
      rotation: { xw: 0.25, yz: 0.4 },
    };
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
          position: [0.5, 0.2, 0] as Vec3,
          rotation: [0, 0, 0.4] as Vec3,
          scale: [0.5, 0.5, 0.5] as Vec3,
          weight: 3,
        },
      ],
      depth: 2,
    };
    const prepared = prepareChaosGame4(
      transforms4,
      finalTransform4,
      { order: 1, plane: "xz" },
      schedule,
    );
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
    const view: FourDView = {
      invWAmp: 0.8,
      sliceOn: false,
      sliceCenter: 0.1,
      sliceWidth: 0.6,
      sliceRelativeColor: false,
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

      const vx = px - center[0];
      const vy = py - center[1];
      const vz = pz - center[2];
      const vw = pw - center[3];
      const qx = rotor[0] * vx + rotor[1] * vy + rotor[2] * vz + rotor[3] * vw;
      const qy = rotor[4] * vx + rotor[5] * vy + rotor[6] * vz + rotor[7] * vw;
      const qz =
        rotor[8] * vx + rotor[9] * vy + rotor[10] * vz + rotor[11] * vw;
      const projx = qx + center[0];
      const projy = qy + center[1];
      const projz = qz + center[2];

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

      const bucket = row * width + col;
      expected.hits[bucket] += 1;
      expected.maxHits = Math.max(expected.maxHits, expected.hits[bucket]);
      const rgb = palette[step.index] ?? [1, 1, 1];
      const o = bucket * 3;
      expected.sumRGB[o] += rgb[0];
      expected.sumRGB[o + 1] += rgb[1];
      expected.sumRGB[o + 2] += rgb[2];
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

describe("accumulateFlame4 shape emitters (correctness oracle)", () => {
  it("matches the stepOrbit4/plotPoint4 oracle with an emitter forced through the inlined loop", () => {
    // The condensation twin of the top oracle (see chaos-game-4d.test.ts for
    // the emitter branch's own semantics pins — sample embedded at w = 0,
    // one primary seed draw, variations skipped): the emitter map mixes w
    // through an xw rotation and carries a variation on purpose, and the
    // deposit count asserts the branch genuinely fired.
    const spec: ShapeSpec = {
      parts: [{ primitive: { kind: "sphere", radius: 0.5 }, combine: "union" }],
    };
    const transforms4: Transform4[] = [
      ...weightedPentatope(),
      {
        position: [0.1, -0.05, 0, 0.3],
        scale: [0.5, 0.5, 0.5, 0.5],
        rotation: { xw: 0.4 },
        weight: 3,
        variations: [{ type: "swirl", weight: 0.6 }],
        emitter: spec,
      },
    ];
    const prepared = prepareChaosGame4(transforms4);
    const palette = transformColors(transforms4.length);
    const width = 48;
    const height = 48;
    const iterations = 4000;
    const seed = 91;

    const actual = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
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
    let emitterDeposits = 0;
    const emitterIndex = transforms4.length - 1;
    for (let i = 0; i < iterations; i++) {
      const step = stepOrbit4(prepared, x, y, z, w, rng);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
      const [px, py] = plotPoint4(prepared, x, y, z, w, rng);
      // FLAT_PROJECTION: clipX = x, clipY = y, clipW = 1 — no divide.
      const col = Math.floor((px + 1) * 0.5 * width);
      const row = Math.floor((1 - py) * 0.5 * height);
      if (col < 0 || col >= width || row < 0 || row >= height) continue;
      const bucket = row * width + col;
      expected.hits[bucket] += 1;
      expected.maxHits = Math.max(expected.maxHits, expected.hits[bucket]);
      const rgb = palette[step.index] ?? [1, 1, 1];
      const o = bucket * 3;
      expected.sumRGB[o] += rgb[0];
      expected.sumRGB[o + 1] += rgb[1];
      expected.sumRGB[o + 2] += rgb[2];
      if (step.index === emitterIndex) emitterDeposits++;
    }
    expected.orbit = [x, y, z];
    expected.orbitW = w;

    expect(Array.from(actual.hits)).toEqual(Array.from(expected.hits));
    expect(Array.from(actual.sumRGB)).toEqual(Array.from(expected.sumRGB));
    expect(actual.maxHits).toBe(expected.maxHits);
    expect(actual.orbit).toEqual(expected.orbit);
    expect(actual.orbitW).toBe(expected.orbitW);
    expect(emitterDeposits).toBeGreaterThan(iterations / 10);
  });
});

describe("accumulateFlame4 point-space tiling", () => {
  it("uses the bounded F4 estimator while keeping Height color on the canonical source", () => {
    const source = genericF4ChamberPoint();
    const plan = pointPlan4({ group: "f4" });
    const prepared = prepareChaosGame4(fixedPointSystem4(source));
    const lut = buildColorModeLUT("height", 1);
    const color: FourDRenderColor = {
      kind: "height",
      lut,
      minY: -1,
      maxY: 1,
    };
    const histogram = createFlameHistogram(1, 1);
    histogram.pointTiling = {
      ...createPointTilingCursorState(),
      credit: 31,
      attempts: 31,
    };
    let exhaustiveWeight = 0;
    const exhaustiveCount = visitPointTilingImagesExhaustive(
      plan,
      ...source,
      (_x, _y, _z, _w, weight) => {
        exhaustiveWeight += weight;
      },
    );

    const actual = accumulateTiled4(
      prepared,
      RAW_W_PROJECTION,
      FLAT_VIEW,
      1,
      1,
      1,
      mulberry32(7),
      color,
      plan,
      histogram,
    );

    const t = (source[1] + 1) / 2;
    const li = ((t * 255 + 0.5) | 0) * 3;
    expect(exhaustiveCount).toBe(TILING_GROUP_INFO.f4.order);
    expect(actual.hits[0]).toBeCloseTo(exhaustiveWeight, 11);
    expect(actual.sumRGB[0]).toBeCloseTo(lut[li] * exhaustiveWeight, 10);
    expect(actual.sumRGB[1]).toBeCloseTo(lut[li + 1] * exhaustiveWeight, 10);
    expect(actual.sumRGB[2]).toBeCloseTo(lut[li + 2] * exhaustiveWeight, 10);
    expect(actual.pointTiling).toEqual({
      credit: 0,
      cursor: 32,
      attempts: 32,
      accepted: 1,
      selected: POINT_TILING_ACCUMULATION_FANOUT_CAP,
      emitted: POINT_TILING_ACCUMULATION_FANOUT_CAP,
    });
  });

  it("derives lattice w-ramp color and soft-slice density from each raw xyzw image", () => {
    const source: Vec4 = [0.08, 0.03, -0.07, 0.11];
    const plan = pointPlan4({ kind: "lattice", cellScale: 1 }, 0.5);
    const prepared = prepareChaosGame4(fixedPointSystem4(source));
    const side = W_SIDE_PALETTES.wBlueOrange;
    const view: FourDView = {
      invWAmp: 0.2,
      sliceOn: true,
      sliceCenter: 0.15,
      sliceWidth: 0.25,
      sliceRelativeColor: false,
    };
    const initialState = {
      ...createPointTilingCursorState(),
      credit: 31,
      attempts: 31,
    };
    const expectedState = { ...initialState };
    let expectedHits = 0;
    const expectedRGB = [0, 0, 0];
    const imageW: number[] = [];
    visitPointTilingAttemptBounded(
      plan,
      ...source,
      POINT_TILING_ACCUMULATION_FANOUT_CAP,
      expectedState,
      (_x, _y, _z, w, tilingWeight) => {
        imageW.push(w);
        const scaled = w * view.invWAmp;
        const s = scaled < -1 ? -1 : scaled > 1 ? 1 : scaled;
        const weight =
          tilingWeight *
          sliceWeight(s, view.sliceCenter, view.sliceWidth, SLICE_GHOST_FLOOR);
        const rgb = wRampColor(s, side);
        expectedHits += weight;
        expectedRGB[0] += rgb[0] * weight;
        expectedRGB[1] += rgb[1] * weight;
        expectedRGB[2] += rgb[2] * weight;
      },
    );
    const histogram = createFlameHistogram(1, 1);
    histogram.pointTiling = { ...initialState };

    const actual = accumulateTiled4(
      prepared,
      RAW_W_PROJECTION,
      view,
      1,
      1,
      1,
      mulberry32(9),
      { kind: "wRamp", side },
      plan,
      histogram,
    );

    expect(
      new Set(imageW.map((value) => value.toFixed(9))).size,
    ).toBeGreaterThan(1);
    expect(actual.hits[0]).toBe(expectedHits);
    expect(Array.from(actual.sumRGB)).toEqual(expectedRGB);
    expect(actual.pointTiling).toEqual(expectedState);
  });

  it.each([
    ["finite", pointPlan4({ group: "f4" })],
    ["lattice", pointPlan4({ kind: "lattice", cellScale: 1 }, 0.5)],
  ] as const)(
    "resumes %s cursor/credit exactly across serialized irregular chunks",
    (_kind, plan) => {
      const source = genericF4ChamberPoint();
      const prepared = prepareChaosGame4(fixedPointSystem4(source));
      const color: FourDRenderColor = {
        kind: "uniform",
        color: [0.2, 0.4, 0.8],
      };
      const chunkedRng = mulberry32(13);
      let chunked = accumulateTiled4(
        prepared,
        RAW_W_PROJECTION,
        FLAT_VIEW,
        1,
        1,
        13,
        chunkedRng,
        color,
        plan,
      );
      expect(chunked.pointTiling).toBeDefined();
      chunked.pointTiling = { ...chunked.pointTiling! };
      chunked = accumulateTiled4(
        prepared,
        RAW_W_PROJECTION,
        FLAT_VIEW,
        1,
        1,
        17,
        chunkedRng,
        color,
        plan,
        chunked,
      );
      chunked.pointTiling = { ...chunked.pointTiling! };
      chunked = accumulateTiled4(
        prepared,
        RAW_W_PROJECTION,
        FLAT_VIEW,
        1,
        1,
        19,
        chunkedRng,
        color,
        plan,
        chunked,
      );

      const singleRng = mulberry32(13);
      const single = accumulateTiled4(
        prepared,
        RAW_W_PROJECTION,
        FLAT_VIEW,
        1,
        1,
        49,
        singleRng,
        color,
        plan,
      );

      expect(Array.from(chunked.hits)).toEqual(Array.from(single.hits));
      expect(Array.from(chunked.sumRGB)).toEqual(Array.from(single.sumRGB));
      expect(chunked.maxHits).toBe(single.maxHits);
      expect(chunked.orbit).toEqual(single.orbit);
      expect(chunked.orbitW).toBe(single.orbitW);
      expect(chunked.orbitColor).toBe(single.orbitColor);
      expect(chunked.pointTiling).toEqual(single.pointTiling);
      expect(chunkedRng()).toBe(singleRng());
    },
  );

  it("completes valid empty canonical content without an untiled deposit", () => {
    const source = genericF4ChamberPoint();
    const plan = pointPlan4({
      group: "f4",
      clip: {
        parts: [
          {
            primitive: { kind: "sphere", radius: 0.01 },
            combine: "union",
            pose: { offset: [100, 100, 100] },
          },
        ],
      },
    });
    const iterations = 37;

    const actual = accumulateTiled4(
      prepareChaosGame4(fixedPointSystem4(source)),
      RAW_W_PROJECTION,
      FLAT_VIEW,
      1,
      1,
      iterations,
      mulberry32(15),
      { kind: "uniform", color: [1, 1, 1] },
      plan,
    );

    expect(Array.from(actual.hits)).toEqual([0]);
    expect(Array.from(actual.sumRGB)).toEqual([0, 0, 0]);
    expect(actual.maxHits).toBe(0);
    expect(actual.pointTiling).toEqual({
      credit: iterations,
      cursor: 0,
      attempts: iterations,
      accepted: 0,
      selected: 0,
      emitted: 0,
    });
  });

  it("consumes the same primary RNG and leaves the same orbit for equal source work", () => {
    const prepared = prepareChaosGame4(weightedPentatope());
    const plan = pointPlan4({ kind: "lattice", cellScale: 1 }, 2);
    const color: FourDRenderColor = {
      kind: "uniform",
      color: [0.3, 0.5, 0.7],
    };
    const untiledRng = mulberry32(17);
    const untiled = accumulateFlame4(
      prepared,
      RAW_W_PROJECTION,
      FLAT_VIEW,
      1,
      1,
      200,
      untiledRng,
      color,
    );
    const tiledRng = mulberry32(17);
    const tiled = accumulateTiled4(
      prepared,
      RAW_W_PROJECTION,
      FLAT_VIEW,
      1,
      1,
      200,
      tiledRng,
      color,
      plan,
    );

    expect(tiled.orbit).toEqual(untiled.orbit);
    expect(tiled.orbitW).toBe(untiled.orbitW);
    expect(tiled.orbitColor).toBe(untiled.orbitColor);
    expect(tiled.orbitPrevBase).toBe(untiled.orbitPrevBase);
    expect(tiled.orbitChaosLeft).toBe(untiled.orbitChaosLeft);
    expect(tiled.pointTiling?.attempts).toBe(200);
    expect(tiled.pointTiling!.selected).toBeLessThanOrEqual(200);
    expect(tiledRng()).toBe(untiledRng());
  });

  it("keeps the absent-plan call value-identical and state-free", () => {
    const prepared = prepareChaosGame4(weightedPentatope());
    const color: FourDRenderColor = {
      kind: "transform",
      palette: transformColors(5),
    };
    const omitted = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      12,
      12,
      300,
      mulberry32(19),
      color,
    );
    const explicit = accumulateFlame4(
      prepared,
      FLAT_PROJECTION,
      FLAT_VIEW,
      12,
      12,
      300,
      mulberry32(19),
      color,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(explicit).toEqual(omitted);
    expect(explicit.pointTiling).toBeUndefined();
    expect(omitted.pointTiling).toBeUndefined();
  });

  it("rejects wrong-dimensional, Balloon, and kaleidoscope combinations", () => {
    const source = genericF4ChamberPoint();
    const prepared = prepareChaosGame4(fixedPointSystem4(source));
    const plan = pointPlan4({ group: "f4" });
    const threeDResolved = resolveTiling({ group: "a3" });
    if (!threeDResolved) throw new Error("3D test tiling did not resolve");
    const threeDPlan = resolvePointTilingPlan(threeDResolved, 3);
    if (!threeDPlan) throw new Error("3D test plan did not resolve");
    const echo = {
      balloon: buildBalloonFromBall(
        { center: [0, 0, 0] as Vec3, radius: 1 },
        1,
      ),
      tint: [0, 0, 0] as Vec3,
      tintStrength: 0,
      weight: 0.5,
    };
    const base = [
      RAW_W_PROJECTION,
      FLAT_VIEW,
      1,
      1,
      1,
      mulberry32(21),
      { kind: "uniform", color: [1, 1, 1] } as FourDRenderColor,
    ] as const;

    expect(() =>
      accumulateFlame4(
        prepared,
        ...base,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        threeDPlan,
      ),
    ).toThrow(/requires a 4D point-tiling plan/);
    expect(() =>
      accumulateFlame4(
        prepared,
        ...base,
        undefined,
        echo,
        composeRotorProjection4(IDENTITY_ROTOR, [0, 0, 0, 0]),
        ORTHOGRAPHIC,
        undefined,
        plan,
      ),
    ).toThrow(/unavailable with Balloon/);
    expect(() =>
      accumulateFlame4(
        prepareChaosGame4(fixedPointSystem4(source), null, {
          order: 2,
          plane: "xz",
        }),
        ...base,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        plan,
      ),
    ).toThrow(/kaleidoscope symmetry above order 1/);
  });
});
