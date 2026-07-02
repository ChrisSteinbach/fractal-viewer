import {
  DEFAULT_GAMMA_THRESHOLD,
  accumulateFlame,
  adaptiveDownsampleFlame,
  clampSupersampleToBudget,
  createFlameHistogram,
  downsampleFlame,
  tonemapFlame,
  viewFlameHistogram,
} from "./flame";
import type {
  DensityEstimatorParams,
  FlameHistogram,
  Mat4,
  TonemapParams,
} from "./flame";
import { plotPoint, prepareChaosGame, stepOrbit } from "./chaos-game";
import { transformColors } from "./color";
import { buildPaletteLUT } from "./palette";
import { mulberry32 } from "./rng";
import { sierpinskiTetrahedron } from "./presets";
import type { Transform, Vec3 } from "./types";

function makeTransforms(count: number): Transform[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    position: [0.5, 0.5, 0.5],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  }));
}

/**
 * A single map that ignores its input and always lands exactly on `point`:
 * scale 0 collapses the linear part to zero, so `applyAffine` (and thus
 * every warmup/orbit step, including the very first) returns `point`
 * unchanged. Lets a test predict exactly which pixel bucket *every*
 * iteration lands in, without hand-simulating the RNG.
 */
function fixedPointSystem(point: Vec3): Transform[] {
  return [{ id: 0, position: point, rotation: [0, 0, 0], scale: [0, 0, 0] }];
}

/** w = 1 always (row 3 = [0, 0, 0, 1]): no perspective divide, so NDC = clip
 * = world xyz directly. Still exercises the NDC→pixel mapping and the
 * front-of-camera gate (cw = 1 > 0 always, so nothing is ever rejected on
 * that basis alone). */
// prettier-ignore
const ORTHOGRAPHIC: Mat4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/** w = z (row 3 = [0, 0, 1, 0]): a minimal perspective-shaped matrix, just
 * enough to drive a real divide and a sign-dependent front/behind test. */
// prettier-ignore
const W_EQUALS_Z: Mat4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 1, 0,
];

describe("createFlameHistogram", () => {
  it("starts with every bucket at zero hits", () => {
    const hist = createFlameHistogram(4, 3);
    expect(hist.width).toBe(4);
    expect(hist.height).toBe(3);
    expect(hist.hits).toHaveLength(12);
    expect(hist.sumRGB).toHaveLength(36);
    expect(Array.from(hist.hits).every((h) => h === 0)).toBe(true);
    expect(hist.maxHits).toBe(0);
    // The color coordinate starts mid-gradient (flam3's convention).
    expect(hist.orbitColor).toBe(0.5);
  });

  // Regression: sumRGB must stay Float64Array, matching hits. A hot bucket's
  // channel sum can exceed 2^24 (~16.78M) in a converged render — past that
  // magnitude Float32's ULP exceeds 1, so accumulating an O(1) palette color
  // per hit silently rounds away to a no-op: the sum plateaus while hits
  // keeps climbing correctly, and `sumRGB / hits` undershoots toward black
  // exactly where the render is meant to glow brightest.
  it("keeps accumulating a hot bucket's color sum past 2^24, where Float32 would round it away", () => {
    const hist = createFlameHistogram(1, 1);
    expect(hist.sumRGB).toBeInstanceOf(Float64Array);

    const priorSum = 20_000_000; // past 2^24 = 16_777_216
    hist.sumRGB[0] = priorSum;
    // A Float32Array-backed sum would show no change at all from this
    // increment — Math.fround(20_000_000 + 0.9) rounds back to 20_000_000.
    hist.sumRGB[0] += 0.9;
    expect(hist.sumRGB[0]).toBe(priorSum + 0.9);
  });
});

describe("accumulateFlame projection and bucketing", () => {
  it("plots a world-origin point in the center bucket", () => {
    const prepared = prepareChaosGame(fixedPointSystem([0, 0, 0]));
    const palette = transformColors(1);
    const hist = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      10,
      10,
      37,
      mulberry32(1),
      palette,
    );

    // NDC (0, 0) -> col = floor(0.5 * 10) = 5, row = floor(0.5 * 10) = 5.
    const centerBucket = 5 * 10 + 5;
    expect(hist.hits[centerBucket]).toBe(37);
    // Every one of the 37 iterations landed in that one bucket.
    expect(hist.hits.reduce((a, b) => a + b, 0)).toBe(37);
    expect(hist.maxHits).toBe(37);

    const [r, g, b] = palette[0];
    expect(hist.sumRGB[centerBucket * 3]).toBeCloseTo(r * 37, 5);
    expect(hist.sumRGB[centerBucket * 3 + 1]).toBeCloseTo(g * 37, 5);
    expect(hist.sumRGB[centerBucket * 3 + 2]).toBeCloseTo(b * 37, 5);
  });

  it("maps positive NDC Y (up) to the top row and negative to the bottom row", () => {
    const palette = transformColors(1);

    const top = accumulateFlame(
      prepareChaosGame(fixedPointSystem([-0.9, 0.9, 0])),
      ORTHOGRAPHIC,
      10,
      10,
      5,
      mulberry32(1),
      palette,
    );
    // ndcX = -0.9 -> col = floor(0.1 * 5) = 0; ndcY = 0.9 -> row = floor(0.1 * 5) = 0.
    expect(top.hits[0 * 10 + 0]).toBe(5);

    const bottom = accumulateFlame(
      prepareChaosGame(fixedPointSystem([-0.9, -0.9, 0])),
      ORTHOGRAPHIC,
      10,
      10,
      5,
      mulberry32(1),
      palette,
    );
    // ndcY = -0.9 -> row = floor(1.9 * 5) = 9.
    expect(bottom.hits[9 * 10 + 0]).toBe(5);
  });

  it("drops points that land outside the [-1, 1] NDC frame", () => {
    const prepared = prepareChaosGame(fixedPointSystem([10, 10, 10]));
    const hist = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      10,
      10,
      100,
      mulberry32(1),
      transformColors(1),
    );
    expect(hist.hits.reduce((a, b) => a + b, 0)).toBe(0);
    expect(hist.maxHits).toBe(0);
  });

  it("drops points behind the camera (non-positive clip w)", () => {
    const behind = accumulateFlame(
      prepareChaosGame(fixedPointSystem([0, 0, -2])),
      W_EQUALS_Z,
      10,
      10,
      50,
      mulberry32(1),
      transformColors(1),
    );
    expect(behind.hits.reduce((a, b) => a + b, 0)).toBe(0);

    // The same setup with a positive z (in front of the camera) does land.
    const front = accumulateFlame(
      prepareChaosGame(fixedPointSystem([0, 0, 2])),
      W_EQUALS_Z,
      10,
      10,
      50,
      mulberry32(1),
      transformColors(1),
    );
    expect(front.hits.reduce((a, b) => a + b, 0)).toBe(50);
  });
});

describe("accumulateFlame determinism", () => {
  it("produces identical histograms for the same seed", () => {
    const prepared = prepareChaosGame(makeTransforms(3));
    const palette = transformColors(3);
    const a = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      16,
      16,
      2000,
      mulberry32(5),
      palette,
    );
    const b = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      16,
      16,
      2000,
      mulberry32(5),
      palette,
    );
    expect(Array.from(a.hits)).toEqual(Array.from(b.hits));
    expect(Array.from(a.sumRGB)).toEqual(Array.from(b.sumRGB));
    expect(a.orbit).toEqual(b.orbit);
  });
});

describe("accumulateFlame progressive accumulation", () => {
  it("chunked calls (same rng instance, histogram threaded through) match a single-shot run of the same total", () => {
    const prepared = prepareChaosGame(sierpinskiTetrahedron());
    const palette = transformColors(4);
    const width = 32;
    const height = 32;

    const chunkedRng = mulberry32(11);
    let chunked = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      width,
      height,
      400,
      chunkedRng,
      palette,
    );
    chunked = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      width,
      height,
      600,
      chunkedRng,
      palette,
      chunked,
    );

    const singleShot = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      width,
      height,
      1000,
      mulberry32(11),
      palette,
    );

    expect(Array.from(chunked.hits)).toEqual(Array.from(singleShot.hits));
    expect(Array.from(chunked.sumRGB)).toEqual(Array.from(singleShot.sumRGB));
    expect(chunked.maxHits).toBe(singleShot.maxHits);
    expect(chunked.orbit).toEqual(singleShot.orbit);
  });
});

describe("accumulateFlame validation", () => {
  it("throws for a projection matrix that isn't 16 entries", () => {
    const prepared = prepareChaosGame(makeTransforms(2));
    expect(() =>
      accumulateFlame(
        prepared,
        [1, 2, 3],
        4,
        4,
        10,
        mulberry32(1),
        transformColors(2),
      ),
    ).toThrow(RangeError);
  });

  it("throws when resuming with a histogram of a different size", () => {
    const prepared = prepareChaosGame(makeTransforms(2));
    const palette = transformColors(2);
    const hist = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      8,
      8,
      10,
      mulberry32(1),
      palette,
    );
    expect(() =>
      accumulateFlame(
        prepared,
        ORTHOGRAPHIC,
        16,
        16,
        10,
        mulberry32(1),
        palette,
        hist,
      ),
    ).toThrow(RangeError);
  });
});

describe("accumulateFlame vs. stepOrbit/plotPoint (correctness oracle)", () => {
  it("matches a reference loop built directly from stepOrbit/plotPoint, iteration for iteration", () => {
    // A stand-in for what accumulateFlame's hand-inlined hot loop must stay
    // byte-for-byte equivalent to: the exact same building blocks the
    // point-cloud path drives (see chaos-game.test.ts's "driving
    // stepOrbit/plotPoint by hand"), projected and bucketed by hand here.
    // If accumulateFlame's inlined copy of stepOrbit/plotPoint ever drifts
    // from the real thing, this test is what catches it.
    const transforms = sierpinskiTetrahedron();
    const finalTransform: Transform = {
      id: 0,
      position: [0.2, -0.1, 0],
      rotation: [0, 0.3, 0],
      scale: [1.2, 1.2, 1.2],
    };
    const prepared = prepareChaosGame(transforms, finalTransform);
    const palette = transformColors(transforms.length);
    const width = 64;
    const height = 64;
    const iterations = 5000;
    const projection = ORTHOGRAPHIC;

    const actual = accumulateFlame(
      prepared,
      projection,
      width,
      height,
      iterations,
      mulberry32(42),
      palette,
    );

    const rng = mulberry32(42);
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    for (let i = 0; i < 100; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
    }
    const expected = createFlameHistogram(width, height);
    for (let i = 0; i < iterations; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
      const [px, py, pz] = plotPoint(prepared, x, y, z, rng);
      const cw =
        projection[12] * px +
        projection[13] * py +
        projection[14] * pz +
        projection[15];
      if (cw <= 0) continue;
      const cx =
        projection[0] * px +
        projection[1] * py +
        projection[2] * pz +
        projection[3];
      const cy =
        projection[4] * px +
        projection[5] * py +
        projection[6] * pz +
        projection[7];
      const ndcX = cx / cw;
      const ndcY = cy / cw;
      const col = Math.floor((ndcX + 1) * 0.5 * width);
      const row = Math.floor((1 - ndcY) * 0.5 * height);
      if (col < 0 || col >= width || row < 0 || row >= height) continue;
      const bucket = row * width + col;
      expected.hits[bucket] += 1;
      expected.maxHits = Math.max(expected.maxHits, expected.hits[bucket]);
      const rgb = palette[s.index] ?? [1, 1, 1];
      const o = bucket * 3;
      expected.sumRGB[o] += rgb[0];
      expected.sumRGB[o + 1] += rgb[1];
      expected.sumRGB[o + 2] += rgb[2];
    }
    expected.orbit = [x, y, z];

    expect(Array.from(actual.hits)).toEqual(Array.from(expected.hits));
    expect(Array.from(actual.sumRGB)).toEqual(Array.from(expected.sumRGB));
    expect(actual.maxHits).toBe(expected.maxHits);
    expect(actual.orbit).toEqual(expected.orbit);
  });
});

describe("accumulateFlame structural coloring (colorLUT, fr-6us)", () => {
  it("matches a reference loop that tracks the color coordinate the same way", () => {
    // The colorLUT counterpart to the oracle above: the color coordinate `c`
    // rides the orbit (init 0.5, blended halfway toward the picked transform's
    // slot each step) and indexes the gradient. Because updating `c` consumes
    // no rng, the orbit — and thus `hits` — is byte-identical to the legacy
    // path; only sumRGB differs, and this pins it to the same rule the inlined
    // loop uses.
    const transforms = sierpinskiTetrahedron();
    const finalTransform: Transform = {
      id: 0,
      position: [0.2, -0.1, 0],
      rotation: [0, 0.3, 0],
      scale: [1.2, 1.2, 1.2],
    };
    const prepared = prepareChaosGame(transforms, finalTransform);
    const palette = transformColors(transforms.length);
    const colorLUT = buildPaletteLUT("spectrum");
    if (!colorLUT) throw new Error("spectrum should have a LUT");
    const width = 64;
    const height = 64;
    const iterations = 5000;
    const projection = ORTHOGRAPHIC;
    const n = transforms.length;

    const actual = accumulateFlame(
      prepared,
      projection,
      width,
      height,
      iterations,
      mulberry32(42),
      palette,
      undefined,
      colorLUT,
    );

    const rng = mulberry32(42);
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    for (let i = 0; i < 100; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
    }
    const expected = createFlameHistogram(width, height);
    let c = 0.5;
    for (let i = 0; i < iterations; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
      const slot = n > 1 ? s.index / (n - 1) : 0.5;
      c = (c + slot) / 2;
      const [px, py, pz] = plotPoint(prepared, x, y, z, rng);
      const cw =
        projection[12] * px +
        projection[13] * py +
        projection[14] * pz +
        projection[15];
      if (cw <= 0) continue;
      const cx =
        projection[0] * px +
        projection[1] * py +
        projection[2] * pz +
        projection[3];
      const cy =
        projection[4] * px +
        projection[5] * py +
        projection[6] * pz +
        projection[7];
      const col = Math.floor((cx / cw + 1) * 0.5 * width);
      const row = Math.floor((1 - cy / cw) * 0.5 * height);
      if (col < 0 || col >= width || row < 0 || row >= height) continue;
      const bucket = row * width + col;
      expected.hits[bucket] += 1;
      expected.maxHits = Math.max(expected.maxHits, expected.hits[bucket]);
      const li = Math.min(255, (c * 256) | 0) * 3;
      const o = bucket * 3;
      expected.sumRGB[o] += colorLUT[li];
      expected.sumRGB[o + 1] += colorLUT[li + 1];
      expected.sumRGB[o + 2] += colorLUT[li + 2];
    }
    expected.orbit = [x, y, z];
    expected.orbitColor = c;

    expect(Array.from(actual.hits)).toEqual(Array.from(expected.hits));
    expect(Array.from(actual.sumRGB)).toEqual(Array.from(expected.sumRGB));
    expect(actual.maxHits).toBe(expected.maxHits);
    expect(actual.orbit).toEqual(expected.orbit);
    expect(actual.orbitColor).toBe(expected.orbitColor);
  });

  it("threads the color coordinate across chunks (progressive == single-shot)", () => {
    const prepared = prepareChaosGame(sierpinskiTetrahedron());
    const palette = transformColors(4);
    const colorLUT = buildPaletteLUT("ember");
    if (!colorLUT) throw new Error("ember should have a LUT");
    const width = 32;
    const height = 32;

    const chunkedRng = mulberry32(11);
    let chunked = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      width,
      height,
      400,
      chunkedRng,
      palette,
      undefined,
      colorLUT,
    );
    chunked = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      width,
      height,
      600,
      chunkedRng,
      palette,
      chunked,
      colorLUT,
    );

    const singleShot = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      width,
      height,
      1000,
      mulberry32(11),
      palette,
      undefined,
      colorLUT,
    );

    expect(Array.from(chunked.sumRGB)).toEqual(Array.from(singleShot.sumRGB));
    expect(chunked.orbitColor).toBe(singleShot.orbitColor);
  });

  it("colors by the gradient instead of the per-transform palette, without changing the orbit", () => {
    const prepared = prepareChaosGame(sierpinskiTetrahedron());
    const legacy = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      16,
      16,
      1000,
      mulberry32(3),
      transformColors(4),
    );
    // The legacy (no-LUT) path never touches the color coordinate.
    expect(legacy.orbitColor).toBe(0.5);

    const colorLUT = buildPaletteLUT("aurora");
    if (!colorLUT) throw new Error("aurora should have a LUT");
    const colored = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      16,
      16,
      1000,
      mulberry32(3),
      transformColors(4),
      undefined,
      colorLUT,
    );

    expect(colored.orbitColor).not.toBe(0.5);
    // Same seed, same orbit → identical hits whether or not a LUT is supplied.
    expect(Array.from(colored.hits)).toEqual(Array.from(legacy.hits));
    // ...but the accumulated colors differ (gradient vs per-transform hue).
    expect(Array.from(colored.sumRGB)).not.toEqual(Array.from(legacy.sumRGB));
  });
});

/**
 * `TonemapParams` at the fr-ucs collapse point (gamma: 1, vibrancy: 1) — see
 * "collapses to the pre-fr-ucs tonemap" below. `gammaThreshold` is
 * deliberately a real, non-degenerate value (not e.g. 0) so these tests
 * exercise the same code path a real render does, not a threshold-disabled
 * shortcut.
 */
function neutral(exposure: number): TonemapParams {
  return {
    exposure,
    gamma: 1,
    gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
    vibrancy: 1,
  };
}

/** Pre-fr-ucs tonemapFlame, verbatim — the oracle "collapses to the
 * pre-fr-ucs tonemap" pins the new formula against. */
function tonemapFlamePreFrUcs(
  histogram: FlameHistogram,
  exposure: number,
): Uint8ClampedArray {
  const { width, height, hits, sumRGB, maxHits } = histogram;
  const out = new Uint8ClampedArray(width * height * 4);
  if (maxHits <= 0) return out;
  const logMax = Math.log1p(maxHits);
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (h <= 0) continue;
    const brightness = (Math.log1p(h) / logMax) * exposure;
    const invHits = 1 / h;
    const o = i * 3;
    const oi = i * 4;
    out[oi] = sumRGB[o] * invHits * brightness * 255;
    out[oi + 1] = sumRGB[o + 1] * invHits * brightness * 255;
    out[oi + 2] = sumRGB[o + 2] * invHits * brightness * 255;
    out[oi + 3] = 255;
  }
  return out;
}

describe("tonemapFlame", () => {
  function histogramWith(
    entries: { bucket: number; hits: number; color: Vec3 }[],
    width = 4,
    height = 4,
  ): FlameHistogram {
    const hist = createFlameHistogram(width, height);
    let maxHits = 0;
    for (const { bucket, hits, color } of entries) {
      hist.hits[bucket] = hits;
      const o = bucket * 3;
      hist.sumRGB[o] = color[0] * hits;
      hist.sumRGB[o + 1] = color[1] * hits;
      hist.sumRGB[o + 2] = color[2] * hits;
      maxHits = Math.max(maxHits, hits);
    }
    hist.maxHits = maxHits;
    return hist;
  }

  it("returns a fully transparent image for a histogram with no hits", () => {
    const image = tonemapFlame(createFlameHistogram(4, 4), neutral(1));
    expect(image).toHaveLength(4 * 4 * 4);
    expect(Array.from(image).every((v) => v === 0)).toBe(true);
  });

  it("leaves an unvisited bucket fully transparent alongside a visited one", () => {
    const hist = histogramWith([{ bucket: 5, hits: 100, color: [1, 1, 1] }]);
    const image = tonemapFlame(hist, neutral(1));
    expect(Array.from(image.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(image[5 * 4 + 3]).toBe(255); // visited bucket is opaque.
  });

  it("is brighter for a denser bucket than a sparser one of the same color", () => {
    const hist = histogramWith([
      { bucket: 0, hits: 1, color: [1, 0, 0] },
      { bucket: 1, hits: 1_000_000, color: [1, 0, 0] },
    ]);
    const image = tonemapFlame(hist, neutral(1));
    expect(image[0 * 4]).toBeLessThan(image[1 * 4]);
  });

  it("compresses via log density: a single hit still reads well above black", () => {
    const hist = histogramWith([
      { bucket: 0, hits: 1, color: [1, 1, 1] },
      { bucket: 1, hits: 1_000_000, color: [1, 1, 1] },
    ]);
    const image = tonemapFlame(hist, neutral(1));
    // A linear hits/maxHits ratio would put this near 0/255; log-density
    // keeps a lone visited bucket clearly legible.
    expect(image[0]).toBeGreaterThan(10);
  });

  it("scales brightness with exposure", () => {
    const hist = histogramWith([
      { bucket: 0, hits: 50, color: [0.5, 0.5, 0.5] },
    ]);
    const dim = tonemapFlame(hist, neutral(0.5));
    const bright = tonemapFlame(hist, neutral(1));
    expect(bright[0]).toBeGreaterThan(dim[0]);
  });

  it("is monotonically non-decreasing in hit count", () => {
    const counts = [1, 2, 5, 10, 50, 200, 1000];
    const entries = counts.map((hits, i) => ({
      bucket: i,
      hits,
      color: [1, 1, 1] as Vec3,
    }));
    const hist = histogramWith(entries, counts.length, 1);
    const image = tonemapFlame(hist, neutral(1));

    let previous = -1;
    for (let i = 0; i < counts.length; i++) {
      const value = image[i * 4];
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe("tonemapFlame collapses to the pre-fr-ucs tonemap at gamma: 1, vibrancy: 1", () => {
  // The regression guard fr-ucs's design explicitly calls for: every render
  // (and every fr-o7s-era test) that never touches gamma/vibrancy must see
  // byte-for-byte the same image as before those controls existed.
  function histogramWith(
    entries: { bucket: number; hits: number; color: Vec3 }[],
    width: number,
    height: number,
  ): FlameHistogram {
    const hist = createFlameHistogram(width, height);
    let maxHits = 0;
    for (const { bucket, hits, color } of entries) {
      hist.hits[bucket] = hits;
      const o = bucket * 3;
      hist.sumRGB[o] = color[0] * hits;
      hist.sumRGB[o + 1] = color[1] * hits;
      hist.sumRGB[o + 2] = color[2] * hits;
      maxHits = Math.max(maxHits, hits);
    }
    hist.maxHits = maxHits;
    return hist;
  }

  it("matches the pre-fr-ucs formula exactly across a spread of hit counts, colors, and exposures", () => {
    const hist = histogramWith(
      [
        { bucket: 0, hits: 1, color: [1, 0.4, 0.1] },
        { bucket: 1, hits: 7, color: [0, 1, 0.5] },
        { bucket: 2, hits: 500, color: [0.2, 0.2, 0.9] },
        { bucket: 5, hits: 1_000_000, color: [1, 1, 1] },
      ],
      4,
      4,
    );
    for (const exposure of [0.2, 0.5, 1, 2, 4]) {
      const actual = tonemapFlame(hist, neutral(exposure));
      const expected = tonemapFlamePreFrUcs(hist, exposure);
      expect(Array.from(actual)).toEqual(Array.from(expected));
    }
  });

  it("matches on a histogram produced by a real accumulateFlame run", () => {
    const prepared = prepareChaosGame(sierpinskiTetrahedron());
    const hist = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      24,
      24,
      6000,
      mulberry32(7),
      transformColors(4),
    );
    const actual = tonemapFlame(hist, neutral(1.3));
    const expected = tonemapFlamePreFrUcs(hist, 1.3);
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });
});

describe("tonemapFlame gamma", () => {
  function singleBucketHist(hits: number, maxHits: number): FlameHistogram {
    const hist = createFlameHistogram(2, 1);
    hist.hits[0] = hits;
    hist.sumRGB[0] = hits;
    hist.sumRGB[1] = hits;
    hist.sumRGB[2] = hits;
    hist.maxHits = maxHits;
    return hist;
  }

  it("above 1, brightens a faint (low-density) bucket relative to gamma: 1", () => {
    const hist = singleBucketHist(2, 1_000_000);
    const plain = tonemapFlame(hist, {
      exposure: 1,
      gamma: 1,
      gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
      vibrancy: 1,
    });
    const punchy = tonemapFlame(hist, {
      exposure: 1,
      gamma: 3,
      gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
      vibrancy: 1,
    });
    expect(punchy[0]).toBeGreaterThan(plain[0]);
  });

  it("below 1, darkens a faint bucket relative to gamma: 1", () => {
    const hist = singleBucketHist(2, 1_000_000);
    const plain = tonemapFlame(hist, {
      exposure: 1,
      gamma: 1,
      gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
      vibrancy: 1,
    });
    const flat = tonemapFlame(hist, {
      exposure: 1,
      gamma: 0.5,
      gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
      vibrancy: 1,
    });
    expect(flat[0]).toBeLessThan(plain[0]);
  });

  it("leaves the fully-saturated (maximum-density) bucket at full brightness regardless of gamma", () => {
    // density = 1 at the hottest bucket; 1 ** (1/gamma) === 1 for any gamma.
    const hist = singleBucketHist(1_000_000, 1_000_000);
    const gamma1 = tonemapFlame(hist, {
      exposure: 1,
      gamma: 1,
      gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
      vibrancy: 1,
    });
    const gamma4 = tonemapFlame(hist, {
      exposure: 1,
      gamma: 4,
      gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
      vibrancy: 1,
    });
    expect(gamma4[0]).toBe(gamma1[0]);
  });
});

describe("tonemapFlame gammaThreshold", () => {
  it("is continuous across the threshold: densities just below and just above it read nearly identically", () => {
    // Solve for the (real-valued) hit count whose density lands exactly on
    // the threshold, then take the integer hit counts immediately below and
    // above it — their densities straddle the threshold as tightly as an
    // integer hit count allows. A large maxHits keeps consecutive integers'
    // densities close together near the crossing (log1p is steep for small
    // maxHits, which would make even adjacent integers straddle by a lot).
    const maxHits = 1_000_000_000;
    const threshold = 0.2;
    const gamma = 5;
    const targetH = Math.expm1(threshold * Math.log1p(maxHits));
    const hBelow = Math.floor(targetH);
    const hAbove = hBelow + 1;

    const hist = createFlameHistogram(2, 1);
    hist.hits[0] = hBelow;
    hist.hits[1] = hAbove;
    hist.sumRGB[0] = hBelow;
    hist.sumRGB[1] = hBelow;
    hist.sumRGB[2] = hBelow;
    hist.sumRGB[3] = hAbove;
    hist.sumRGB[4] = hAbove;
    hist.sumRGB[5] = hAbove;
    hist.maxHits = maxHits;
    const params: TonemapParams = {
      exposure: 1,
      gamma,
      gammaThreshold: threshold,
      vibrancy: 1,
    };
    const image = tonemapFlame(hist, params);
    expect(Math.abs(image[0] - image[4])).toBeLessThanOrEqual(1);
  });

  it("has no effect when gamma is 1, at any threshold", () => {
    const hist = createFlameHistogram(2, 1);
    hist.hits[0] = 3;
    hist.sumRGB[0] = 3;
    hist.sumRGB[1] = 3;
    hist.sumRGB[2] = 3;
    hist.maxHits = 10_000;
    const low = tonemapFlame(hist, {
      exposure: 1,
      gamma: 1,
      gammaThreshold: 0.001,
      vibrancy: 1,
    });
    const high = tonemapFlame(hist, {
      exposure: 1,
      gamma: 1,
      gammaThreshold: 0.5,
      vibrancy: 1,
    });
    expect(Array.from(low)).toEqual(Array.from(high));
  });
});

describe("tonemapFlame vibrancy", () => {
  function twoToneHist(): FlameHistogram {
    // A hot, saturated-red bucket: density-scaled (vivid) and flat-gamma
    // color diverge sharply here, so vibrancy's effect is easy to see.
    const hist = createFlameHistogram(1, 1);
    hist.hits[0] = 500;
    hist.sumRGB[0] = 500; // r = 1
    hist.sumRGB[1] = 0; // g = 0
    hist.sumRGB[2] = 0; // b = 0
    hist.maxHits = 1_000_000;
    return hist;
  }

  it("at 0, ignores density entirely: red channel matches the gamma-only curve on the raw color", () => {
    const hist = twoToneHist();
    const params: TonemapParams = {
      exposure: 1,
      gamma: 2,
      gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
      vibrancy: 0,
    };
    const image = tonemapFlame(hist, params);
    // r = 1 (sumRGB/hits), so the flat branch is 1 ** (1/gamma) * exposure = 1.
    expect(image[0]).toBe(255);
  });

  it("at 1, matches the density-scaled color (vivid) exactly", () => {
    const hist = twoToneHist();
    const vivid = tonemapFlame(hist, {
      exposure: 1,
      gamma: 2,
      gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
      vibrancy: 1,
    });
    const density = Math.log1p(500) / Math.log1p(1_000_000);
    const alpha = density ** 0.5; // invGamma = 1/2.
    // Route through a Uint8ClampedArray rather than hand-rounding, so this
    // matches its actual round-half-to-even clamping rule instead of risking
    // a tie-breaking mismatch against a plain Math.round.
    const expected = new Uint8ClampedArray([alpha * 255]);
    expect(vivid[0]).toBe(expected[0]);
  });

  it("at a fractional value, lands strictly between the vibrancy: 0 and vibrancy: 1 results", () => {
    const hist = twoToneHist();
    const base = {
      exposure: 1,
      gamma: 2,
      gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
    };
    const flat = tonemapFlame(hist, { ...base, vibrancy: 0 });
    const vivid = tonemapFlame(hist, { ...base, vibrancy: 1 });
    const mid = tonemapFlame(hist, { ...base, vibrancy: 0.5 });
    const lo = Math.min(flat[0], vivid[0]);
    const hi = Math.max(flat[0], vivid[0]);
    expect(mid[0]).toBeGreaterThanOrEqual(lo);
    expect(mid[0]).toBeLessThanOrEqual(hi);
  });
});

describe("downsampleFlame", () => {
  it("rejects a source whose dimensions aren't an exact multiple of the target", () => {
    const oversized = createFlameHistogram(10, 8);
    expect(() => downsampleFlame(oversized, 3, 8, 1)).toThrow(RangeError);
    expect(() => downsampleFlame(oversized, 10, 3, 1)).toThrow(RangeError);
  });

  it("passes an already-target-sized histogram through unchanged at filterRadius 0", () => {
    // supersample = 1 (source and target are the same size) and filterRadius
    // 0 together mean every output cell's kernel collapses to a single tap
    // on its own source cell (weight at any nonzero offset underflows to
    // exactly 0 at the floored sigma) — true pass-through, not just "close
    // because neighbors happen to be empty". A nonzero filterRadius, even at
    // supersample 1, is a real blur: see "pools hits and color as weighted
    // sums" below for what spreading mass into empty neighbors looks like.
    const hist = createFlameHistogram(3, 3);
    hist.hits[4] = 10; // center bucket.
    hist.sumRGB[4 * 3] = 5;
    hist.sumRGB[4 * 3 + 1] = 2;
    hist.sumRGB[4 * 3 + 2] = 1;
    hist.maxHits = 10;

    const out = downsampleFlame(hist, 3, 3, 0);
    expect(out.width).toBe(3);
    expect(out.height).toBe(3);
    expect(out.hits[4]).toBeCloseTo(10, 6);
    expect(out.sumRGB[4 * 3]).toBeCloseTo(5, 6);
    expect(out.sumRGB[4 * 3 + 1]).toBeCloseTo(2, 6);
    expect(out.sumRGB[4 * 3 + 2]).toBeCloseTo(1, 6);
  });

  it("pools hits and color as weighted sums, not pre-averaged per source cell", () => {
    // Two adjacent, equally-weighted source buckets (supersample = 2, so
    // both fall in the same 2x2 home block of the single output cell) with
    // very different hit counts but the same per-hit color: a pre-average
    // bug (averaging each source cell's color before pooling) would treat
    // the sparse-but-bright and dense-but-dim cells as EQUALLY important;
    // pooling raw sums instead weights the output toward the denser one.
    const hist = createFlameHistogram(2, 2);
    hist.hits[0] = 1; // sparse
    hist.sumRGB[0] = 1;
    hist.hits[1] = 99; // dense, same per-hit color (sumRGB/hits = 1 for both)
    hist.sumRGB[1 * 3] = 99;
    hist.maxHits = 99;

    const out = downsampleFlame(hist, 1, 1, 0.5);
    // Pooled hits = 1 + 99 = 100 (times each cell's kernel weight, which are
    // equal here since both cells are equidistant from the output center on
    // the x axis and on the same row) — either way, color-per-hit is
    // uniformly 1 in both source cells, so the reconstructed average must
    // also be 1, and hits must reflect real pooled mass, not an average of
    // two averages.
    expect(out.sumRGB[0] / out.hits[0]).toBeCloseTo(1, 6);
    expect(out.hits[0]).toBeGreaterThan(1); // reflects pooled mass, not a single cell.
  });

  it("recomputes maxHits from the filtered histogram, not the source's", () => {
    const hist = createFlameHistogram(4, 4);
    hist.hits[0] = 1_000_000; // an isolated spike, far from every other cell.
    hist.sumRGB[0] = 1_000_000;
    hist.maxHits = 1_000_000;

    const out = downsampleFlame(hist, 2, 2, 0.5);
    // Spread across a narrow kernel and normalized, the reconstructed peak
    // is necessarily smaller than the raw spike it came from.
    expect(out.maxHits).toBeLessThan(1_000_000);
    expect(out.maxHits).toBeGreaterThan(0);
    expect(out.maxHits).toBe(Math.max(...out.hits));
  });

  it("does not darken a hit near the border for lack of off-histogram neighbors", () => {
    // A uniform field (every source cell equally hot) should downsample to
    // an equally uniform result everywhere, including at the edges — if
    // edge cells weren't renormalized to their own (smaller) surviving
    // weight sum, they would read measurably dimmer than the interior.
    const hist = createFlameHistogram(6, 6);
    for (let i = 0; i < hist.hits.length; i++) {
      hist.hits[i] = 40;
      hist.sumRGB[i * 3] = 40;
      hist.sumRGB[i * 3 + 1] = 40;
      hist.sumRGB[i * 3 + 2] = 40;
    }
    hist.maxHits = 40;

    const out = downsampleFlame(hist, 3, 3, 1);
    const corner = out.hits[0];
    const center = out.hits[1 * 3 + 1];
    expect(corner).toBeCloseTo(center, 6);
  });
});

describe("clampSupersampleToBudget", () => {
  it("returns the requested factor unchanged when it already fits", () => {
    // 100x100 at 2x = 40 000 buckets, comfortably under a 1 000 000 budget.
    expect(clampSupersampleToBudget(100, 100, 2, 1_000_000)).toBe(2);
  });

  it("reduces to the largest factor that fits when the requested one does not", () => {
    // 1000x1000 at 3x = 9 000 000 buckets; at 2x = 4 000 000; budget 5 000 000
    // rules out 3x but allows 2x.
    expect(clampSupersampleToBudget(1000, 1000, 3, 5_000_000)).toBe(2);
  });

  it("never returns less than 1, even when 1x itself exceeds the budget", () => {
    expect(clampSupersampleToBudget(1000, 1000, 3, 1)).toBe(1);
  });

  it("returns 1 unchanged when the requested factor is already 1", () => {
    expect(clampSupersampleToBudget(100, 100, 1, 1_000_000_000)).toBe(1);
  });

  it("reproduces the hi-DPI OOM scenario: a Retina drawing buffer clamps 3x down", () => {
    // 2880x1800 (1440x900 CSS @ devicePixelRatio 2) at 3x is ~46.7M buckets;
    // a ~300 MiB / 32-bytes-per-bucket budget (~9.8M buckets) must reject it.
    const width = 2880;
    const height = 1800;
    const budget = Math.floor((300 * 1024 * 1024) / 32);
    const clamped = clampSupersampleToBudget(width, height, 3, budget);
    expect(clamped).toBeLessThan(3);
    expect(width * clamped * (height * clamped)).toBeLessThanOrEqual(budget);
  });

  it("floors a fractional requested factor before searching", () => {
    expect(clampSupersampleToBudget(10, 10, 2.9, 1_000_000)).toBe(2);
  });

  it("treats a non-positive width or height as unconstrained (nothing to divide by)", () => {
    expect(clampSupersampleToBudget(0, 100, 3, 10)).toBe(3);
    expect(clampSupersampleToBudget(100, 0, 3, 10)).toBe(3);
  });
});

describe("adaptiveDownsampleFlame", () => {
  it("rejects a source whose dimensions aren't an exact multiple of the target", () => {
    const oversized = createFlameHistogram(10, 8);
    const params: DensityEstimatorParams = {
      estimatorRadius: 3,
      estimatorMinimumRadius: 0,
      estimatorCurve: 0.4,
    };
    expect(() => adaptiveDownsampleFlame(oversized, 3, 8, params)).toThrow(
      RangeError,
    );
    expect(() => adaptiveDownsampleFlame(oversized, 10, 3, params)).toThrow(
      RangeError,
    );
  });

  // -------------------------------------------------------------------------
  // Oracle: a constant radius must reproduce downsampleFlame exactly
  // -------------------------------------------------------------------------

  it("reproduces downsampleFlame exactly when estimatorRadius equals estimatorMinimumRadius", () => {
    // A non-uniform, non-trivial field (several hit counts spanning orders of
    // magnitude) so this isn't accidentally passing on a degenerate input —
    // every cell's computed density differs, but the radius formula must
    // still collapse to the same constant everywhere when max == min.
    const hist = createFlameHistogram(6, 6);
    const hot = [
      { bucket: 0, hits: 1 },
      { bucket: 7, hits: 50 },
      { bucket: 14, hits: 1000 },
      { bucket: 21, hits: 5 },
      { bucket: 28, hits: 200_000 },
      { bucket: 35, hits: 12 },
    ];
    let maxHits = 0;
    for (const { bucket, hits } of hot) {
      hist.hits[bucket] = hits;
      hist.sumRGB[bucket * 3] = hits * 0.3;
      hist.sumRGB[bucket * 3 + 1] = hits * 0.6;
      hist.sumRGB[bucket * 3 + 2] = hits * 0.9;
      maxHits = Math.max(maxHits, hits);
    }
    hist.maxHits = maxHits;

    const radius = 1; // an exact multiple of RADIUS_QUANTUM (0.5) - no quantization rounding.
    const adaptive = adaptiveDownsampleFlame(hist, 3, 3, {
      estimatorRadius: radius,
      estimatorMinimumRadius: radius,
      estimatorCurve: 0.4, // irrelevant when max == min: (1-d)**curve is always multiplied by a zero span.
    });
    const fixed = downsampleFlame(hist, 3, 3, radius);

    expect(Array.from(adaptive.hits)).toEqual(Array.from(fixed.hits));
    expect(Array.from(adaptive.sumRGB)).toEqual(Array.from(fixed.sumRGB));
    expect(adaptive.maxHits).toBe(fixed.maxHits);
  });

  // -------------------------------------------------------------------------
  // Density -> radius mapping
  // -------------------------------------------------------------------------

  // Each of these compares a cell's OWN reading (how much its raw value
  // survives being pooled with its — empty, in every scenario below —
  // neighbors) across two scenarios that differ only in what radius that
  // cell's own local density resolves to: the WIDER the radius a cell
  // gathers with, the more it dilutes its own peak by averaging in more
  // (zero) neighbors. That is the directly observable effect of radius
  // choice — not, e.g., how far a DIFFERENT cell's influence spreads (a
  // neighboring empty cell's OWN radius depends on ITS OWN — always zero —
  // local density, not on how dense a nearby source happens to be, so it
  // is always the widest possible regardless of what is next to it).

  it("dilutes a sparse cell's own reading more than a dense cell's, at the same raw hit count", () => {
    const width = 60;
    const height = 1;
    const bucket = 30;
    const params: DensityEstimatorParams = {
      estimatorRadius: 8,
      estimatorMinimumRadius: 0,
      estimatorCurve: 1,
    };

    // Scenario A: this cell IS the histogram's peak (normalizedDensity ==
    // 1, "dense") -> narrowest radius -> minimal dilution.
    const dense = createFlameHistogram(width, height);
    dense.hits[bucket] = 100;
    dense.sumRGB[bucket * 3] = 100;
    dense.maxHits = 100;

    // Scenario B: the identical raw hit count, but read against a much
    // higher peak recorded elsewhere in the render (set directly on maxHits
    // — no competing bucket actually holding it, so there is nothing at
    // that position for a kernel to geometrically pick up; maxHits is a
    // pure normalization reference, not a spatial one) -> lower
    // normalizedDensity -> wider radius -> more dilution.
    const sparse = createFlameHistogram(width, height);
    sparse.hits[bucket] = 100;
    sparse.sumRGB[bucket * 3] = 100;
    sparse.maxHits = 1_000_000;

    const denseOut = adaptiveDownsampleFlame(dense, width, height, params);
    const sparseOut = adaptiveDownsampleFlame(sparse, width, height, params);

    expect(denseOut.hits[bucket]).toBeGreaterThan(sparseOut.hits[bucket]);
    // The dense case is close to its raw 100 (small correction only from
    // MIN_ADAPTIVE_FILTER_SIGMA's floor — see that constant's doc); the
    // sparse case is diluted to a small fraction of it.
    expect(denseOut.hits[bucket]).toBeGreaterThan(90);
    expect(sparseOut.hits[bucket]).toBeLessThan(50);
  });

  it("keeps a fully-saturated cell's own reading close to its raw value", () => {
    // normalizedDensity is exactly log1p(maxHits)/log1p(maxHits) == 1, so
    // (1 - 1) ** curve is exactly 0 regardless of curve and radius collapses
    // to estimatorMinimumRadius exactly, provably (not just empirically) —
    // but estimatorMinimumRadius: 0 does not mean the radius used to BUILD
    // the kernel is literally 0 (see MIN_ADAPTIVE_FILTER_SIGMA's doc for
    // why), so this checks "close to raw", not bit-exact pass-through.
    const hist = createFlameHistogram(5, 5);
    hist.hits[12] = 500; // center bucket, and the histogram's only hits.
    hist.sumRGB[12 * 3] = 500;
    hist.maxHits = 500;

    const out = adaptiveDownsampleFlame(hist, 5, 5, {
      estimatorRadius: 10,
      estimatorMinimumRadius: 0,
      estimatorCurve: 0.4,
    });

    expect(out.hits[12]).toBeGreaterThan(475); // within 5% of the raw 500.
    expect(out.hits[12]).toBeLessThanOrEqual(500);
  });

  it("shapes the falloff with estimatorCurve: a lower curve dilutes a mid-density cell more than a higher curve does", () => {
    // (1 - 0.5) ** curve is LARGER for curve < 1 than curve > 1 (0.5 ** 0.3
    // ~= 0.81 vs 0.5 ** 3 ~= 0.125), so a mid-density cell's OWN radius (and
    // therefore its own dilution) should be visibly wider at the low curve.
    const width = 30;
    const height = 4;
    const hist = createFlameHistogram(width, height);
    const midBucket = 2 * width + 5;
    // maxHits chosen so this single cell's log-density sits near the curve's
    // midpoint: log1p(hits) / log1p(maxHits) ~= 0.5.
    const maxHits = 1_000_000;
    const midHits = Math.round(Math.expm1(0.5 * Math.log1p(maxHits)));
    hist.hits[midBucket] = midHits;
    hist.sumRGB[midBucket * 3] = midHits;
    hist.maxHits = maxHits;

    const wideAtMid = adaptiveDownsampleFlame(hist, width, height, {
      estimatorRadius: 8,
      estimatorMinimumRadius: 0,
      estimatorCurve: 0.3,
    });
    const narrowAtMid = adaptiveDownsampleFlame(hist, width, height, {
      estimatorRadius: 8,
      estimatorMinimumRadius: 0,
      estimatorCurve: 3,
    });

    // Higher curve -> narrower radius at this same mid-density -> less
    // diluted -> a reading closer to the raw midHits value.
    expect(narrowAtMid.hits[midBucket]).toBeGreaterThan(
      wideAtMid.hits[midBucket],
    );
  });

  // -------------------------------------------------------------------------
  // Neighborhood density estimate (not a single noisy cell)
  // -------------------------------------------------------------------------

  it("estimates density from the whole home block, not just the single output-aligned source cell", () => {
    // supersample = 2 (a 2x2 home block per output cell). The block's OWN
    // "home" source cell (top-left of the block) is empty, but its three
    // siblings in the same block are as hot as the histogram gets — a
    // density estimate that only looked at the single home cell would see
    // zero density here (widest possible blur, heavy dilution); one that
    // sums the whole block sees it as fully dense (sharpest possible blur,
    // minimal dilution) instead. The hot block sits well away from every
    // edge/corner (comfortably beyond any radius this test uses) so the
    // comparison point is never itself in reach of the hot block's kernel.
    const outSize = 20;
    const srcSize = outSize * 2;
    const hist = createFlameHistogram(srcSize, srcSize);
    // Output cell (10, 10)'s home block is source rows/cols [20, 21].
    const homeBase = 20;
    const siblingBuckets = [
      homeBase * srcSize + (homeBase + 1), // top-right of the block.
      (homeBase + 1) * srcSize + homeBase, // bottom-left.
      (homeBase + 1) * srcSize + (homeBase + 1), // bottom-right.
    ];
    for (const b of siblingBuckets) {
      hist.hits[b] = 1_000_000;
      hist.sumRGB[b * 3] = 1_000_000;
    }
    hist.maxHits = 1_000_000;

    const params: DensityEstimatorParams = {
      estimatorRadius: 2, // small on purpose: keeps the far corner (below)
      estimatorMinimumRadius: 0, // genuinely out of reach at any density,
      estimatorCurve: 0.4, // isolating the density estimate from raw distance.
    };
    const out = adaptiveDownsampleFlame(hist, outSize, outSize, params);

    const centerBucket = 10 * outSize + 10;
    const farCorner = 0; // output (0, 0) — 20+ output cells from the block.
    // A block-aware estimate reads this block's SUM (3,000,000, three cells
    // at the global max) as saturated and collapses to a narrow radius, so
    // most of the block's own mass survives pooling — well above what
    // spreading it across the widest (estimatorRadius) kernel could leave
    // behind (the "dilutes a sparse cell" test above shows a lone 100-hit
    // cell loses over half its own reading under the widest radius; here
    // the home block holds 3,000,000 hits, so a single-cell estimate that
    // missed the hot siblings and fell back to the widest radius would
    // scatter far more of it away than survives below). A truly distant,
    // all-empty corner reads exactly zero regardless.
    expect(out.hits[centerBucket]).toBeGreaterThan(500_000);
    expect(out.hits[farCorner]).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Weighted-sum pooling (same discipline as downsampleFlame)
  // -------------------------------------------------------------------------

  it("pools hits and color as weighted sums, not pre-averaged per source cell", () => {
    // Same setup/reasoning as downsampleFlame's own version of this test:
    // pooling raw (weight * value) sums must weight a dense-but-dim cell
    // more than a sparse-but-bright one of the same average color, which
    // pre-averaging each source cell before pooling would get wrong.
    const hist = createFlameHistogram(2, 2);
    hist.hits[0] = 1;
    hist.sumRGB[0] = 1;
    hist.hits[1] = 99;
    hist.sumRGB[1 * 3] = 99;
    hist.maxHits = 99;

    const out = adaptiveDownsampleFlame(hist, 1, 1, {
      estimatorRadius: 2,
      estimatorMinimumRadius: 0.5,
      estimatorCurve: 0.4,
    });
    expect(out.sumRGB[0] / out.hits[0]).toBeCloseTo(1, 6);
    expect(out.hits[0]).toBeGreaterThan(1);
  });

  // -------------------------------------------------------------------------
  // Edge handling
  // -------------------------------------------------------------------------

  it("does not darken a hit near the border for lack of off-histogram neighbors", () => {
    // A uniform field downsamples to an equally uniform result everywhere,
    // including at the edges, exactly like downsampleFlame's own version of
    // this test — the density estimate is uniform too, so every cell picks
    // the same radius, isolating the edge-renormalization behavior.
    const hist = createFlameHistogram(6, 6);
    for (let i = 0; i < hist.hits.length; i++) {
      hist.hits[i] = 40;
      hist.sumRGB[i * 3] = 40;
    }
    hist.maxHits = 40;

    const out = adaptiveDownsampleFlame(hist, 3, 3, {
      estimatorRadius: 3,
      estimatorMinimumRadius: 1,
      estimatorCurve: 0.4,
    });
    const corner = out.hits[0];
    const center = out.hits[1 * 3 + 1];
    expect(corner).toBeCloseTo(center, 6);
  });

  // -------------------------------------------------------------------------
  // estimatorMinimumRadius defensively clamped to estimatorRadius
  // -------------------------------------------------------------------------

  it("clamps an estimatorMinimumRadius greater than estimatorRadius rather than inverting the curve", () => {
    const hist = createFlameHistogram(4, 4);
    hist.hits[5] = 500;
    hist.sumRGB[5 * 3] = 500;
    hist.maxHits = 500;

    // estimatorMinimumRadius (10) > estimatorRadius (2): every density must
    // still resolve to the SAME effective radius (2), matching what passing
    // estimatorMinimumRadius: estimatorRadius: 2 directly would produce -
    // not a negative span or an inverted (denser = blurrier) result.
    const inverted = adaptiveDownsampleFlame(hist, 4, 4, {
      estimatorRadius: 2,
      estimatorMinimumRadius: 10,
      estimatorCurve: 0.4,
    });
    const clampedEquivalent = adaptiveDownsampleFlame(hist, 4, 4, {
      estimatorRadius: 2,
      estimatorMinimumRadius: 2,
      estimatorCurve: 0.4,
    });

    expect(Array.from(inverted.hits)).toEqual(
      Array.from(clampedEquivalent.hits),
    );
  });
});

// ---------------------------------------------------------------------------
// Reused `out` histograms (fr-96i): both downsample flavors can write into a
// caller-provided target — the seam that lets the flame worker downsample
// straight into SharedArrayBuffer-backed buckets (and reuse one local
// histogram across progressive ticks in transfer mode). The contract under
// test: byte-identical to allocating fresh, even from a dirty target.
// ---------------------------------------------------------------------------

/** A non-trivial 6x6 source (hit counts spanning orders of magnitude) so the
 * reuse oracles below aren't accidentally passing on a mostly-zero input. */
function unevenSource(): FlameHistogram {
  const hist = createFlameHistogram(6, 6);
  const hot = [
    { bucket: 0, hits: 1 },
    { bucket: 7, hits: 50 },
    { bucket: 14, hits: 1000 },
    { bucket: 21, hits: 5 },
    { bucket: 28, hits: 200_000 },
    { bucket: 35, hits: 12 },
  ];
  let maxHits = 0;
  for (const { bucket, hits } of hot) {
    hist.hits[bucket] = hits;
    hist.sumRGB[bucket * 3] = hits * 0.3;
    hist.sumRGB[bucket * 3 + 1] = hits * 0.6;
    hist.sumRGB[bucket * 3 + 2] = hits * 0.9;
    maxHits = Math.max(maxHits, hits);
  }
  hist.maxHits = maxHits;
  return hist;
}

/** A deliberately dirty 3x3 target: every bucket and maxHits pre-filled with
 * garbage a lazy implementation would leak through. */
function dirtyTarget(): FlameHistogram {
  const target = createFlameHistogram(3, 3);
  target.hits.fill(123);
  target.sumRGB.fill(-7);
  target.maxHits = 999_999;
  return target;
}

describe("downsampleFlame into a reused out histogram", () => {
  it("returns the provided histogram itself, byte-identical to a fresh allocation", () => {
    const source = unevenSource();
    const fresh = downsampleFlame(source, 3, 3, 0.5);

    const target = dirtyTarget();
    const returned = downsampleFlame(source, 3, 3, 0.5, target);

    expect(returned).toBe(target); // wrote in place, not into a new allocation.
    expect(Array.from(target.hits)).toEqual(Array.from(fresh.hits));
    expect(Array.from(target.sumRGB)).toEqual(Array.from(fresh.sumRGB));
    expect(target.maxHits).toBe(fresh.maxHits);
  });

  it("rejects an out histogram whose dimensions don't match the requested target size", () => {
    const source = unevenSource();
    expect(() =>
      downsampleFlame(source, 3, 3, 0.5, createFlameHistogram(3, 2)),
    ).toThrow(RangeError);
    expect(() =>
      downsampleFlame(source, 3, 3, 0.5, createFlameHistogram(6, 6)),
    ).toThrow(RangeError);
  });
});

describe("adaptiveDownsampleFlame into a reused out histogram", () => {
  const params: DensityEstimatorParams = {
    estimatorRadius: 3,
    estimatorMinimumRadius: 0,
    estimatorCurve: 0.4,
  };

  it("returns the provided histogram itself, byte-identical to a fresh allocation", () => {
    const source = unevenSource();
    const fresh = adaptiveDownsampleFlame(source, 3, 3, params);

    const target = dirtyTarget();
    const returned = adaptiveDownsampleFlame(source, 3, 3, params, target);

    expect(returned).toBe(target);
    expect(Array.from(target.hits)).toEqual(Array.from(fresh.hits));
    expect(Array.from(target.sumRGB)).toEqual(Array.from(fresh.sumRGB));
    expect(target.maxHits).toBe(fresh.maxHits);
  });

  it("rejects an out histogram whose dimensions don't match the requested target size", () => {
    const source = unevenSource();
    expect(() =>
      adaptiveDownsampleFlame(source, 3, 3, params, createFlameHistogram(2, 3)),
    ).toThrow(RangeError);
  });
});

describe("viewFlameHistogram", () => {
  it("wraps external arrays without copying, and tone-maps identically to the histogram it mirrors", () => {
    // Accumulate something real, then rebuild it as a view over the SAME
    // arrays plus the scalar maxHits — the exact reconstruction the main
    // thread performs over shared memory in the worker's shared-frame mode.
    const prepared = prepareChaosGame(sierpinskiTetrahedron(), null);
    const hist = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      8,
      8,
      2000,
      mulberry32(1),
      transformColors(4),
    );

    const view = viewFlameHistogram(8, 8, hist.hits, hist.sumRGB, hist.maxHits);
    expect(view.hits).toBe(hist.hits); // shares, never copies.
    expect(view.sumRGB).toBe(hist.sumRGB);

    const params: TonemapParams = {
      exposure: 1.5,
      gamma: 2.2,
      gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
      vibrancy: 0.8,
    };
    expect(Array.from(tonemapFlame(view, params))).toEqual(
      Array.from(tonemapFlame(hist, params)),
    );
  });
});
