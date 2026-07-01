import { accumulateFlame, createFlameHistogram, tonemapFlame } from "./flame";
import type { FlameHistogram, Mat4 } from "./flame";
import { plotPoint, prepareChaosGame, stepOrbit } from "./chaos-game";
import { transformColors } from "./color";
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
    const image = tonemapFlame(createFlameHistogram(4, 4), { exposure: 1 });
    expect(image).toHaveLength(4 * 4 * 4);
    expect(Array.from(image).every((v) => v === 0)).toBe(true);
  });

  it("leaves an unvisited bucket fully transparent alongside a visited one", () => {
    const hist = histogramWith([{ bucket: 5, hits: 100, color: [1, 1, 1] }]);
    const image = tonemapFlame(hist, { exposure: 1 });
    expect(Array.from(image.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(image[5 * 4 + 3]).toBe(255); // visited bucket is opaque.
  });

  it("is brighter for a denser bucket than a sparser one of the same color", () => {
    const hist = histogramWith([
      { bucket: 0, hits: 1, color: [1, 0, 0] },
      { bucket: 1, hits: 1_000_000, color: [1, 0, 0] },
    ]);
    const image = tonemapFlame(hist, { exposure: 1 });
    expect(image[0 * 4]).toBeLessThan(image[1 * 4]);
  });

  it("compresses via log density: a single hit still reads well above black", () => {
    const hist = histogramWith([
      { bucket: 0, hits: 1, color: [1, 1, 1] },
      { bucket: 1, hits: 1_000_000, color: [1, 1, 1] },
    ]);
    const image = tonemapFlame(hist, { exposure: 1 });
    // A linear hits/maxHits ratio would put this near 0/255; log-density
    // keeps a lone visited bucket clearly legible.
    expect(image[0]).toBeGreaterThan(10);
  });

  it("scales brightness with exposure", () => {
    const hist = histogramWith([
      { bucket: 0, hits: 50, color: [0.5, 0.5, 0.5] },
    ]);
    const dim = tonemapFlame(hist, { exposure: 0.5 });
    const bright = tonemapFlame(hist, { exposure: 1 });
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
    const image = tonemapFlame(hist, { exposure: 1 });

    let previous = -1;
    for (let i = 0; i < counts.length; i++) {
      const value = image[i * 4];
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});
