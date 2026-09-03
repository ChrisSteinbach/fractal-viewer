import {
  DEFAULT_GAMMA_THRESHOLD,
  FLAME_DENSITY_SATURATION,
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
import {
  CHAOS_SUB_ORBIT_POINTS,
  DEFAULT_COLOR_SPEED,
  ESCAPE_LIMIT,
  WARMUP_ITERATIONS,
  derivedColorIndex,
  plotPoint,
  prepareChaosGame,
  stepOrbit,
} from "./chaos-game";
import { transformColors } from "./color";
import { buildPaletteLUT } from "./palette";
import { balloonPaletteCoordinate, buildBalloonFromBall } from "./balloon-de";
import { mulberry32 } from "./rng";
import { sierpinskiTetrahedron } from "./presets";
import { resolvePointTilingPlan } from "./point-tiling";
import { GEAR_SHAPE } from "./shapes";
import { resolveTiling } from "./tiling";
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

describe("accumulateFlame point-space tiling", () => {
  it("deposits bounded finite images with their multiplicity weights and canonical color", () => {
    const plan = resolvePointTilingPlan(resolveTiling({ group: "a3" }), 3)!;
    const palette: Vec3[] = [[0.25, 0.5, 0.75]];
    const iterations = 40;
    const hist = accumulateFlame(
      prepareChaosGame(fixedPointSystem([0.3, 0.3, 0.3])),
      ORTHOGRAPHIC,
      64,
      64,
      iterations,
      mulberry32(3),
      palette,
      undefined,
      undefined,
      undefined,
      undefined,
      plan,
    );

    expect(hist.pointTiling).toEqual({
      credit: 0,
      cursor: iterations,
      attempts: iterations,
      accepted: iterations,
      selected: iterations,
      emitted: iterations,
    });
    const totalWeight = hist.hits.reduce((sum, hit) => sum + hit, 0);
    // One selected image per accepted source carries the generic A3 orbit's
    // full 24-image multiplicity.
    expect(totalWeight).toBe(iterations * 24);
    expect(hist.hits.filter((hit) => hit > 0).length).toBeGreaterThan(12);
    for (let channel = 0; channel < 3; channel++) {
      let sum = 0;
      for (let i = channel; i < hist.sumRGB.length; i += 3) {
        sum += hist.sumRGB[i];
      }
      expect(sum).toBe(palette[0][channel] * totalWeight);
    }
  });

  it("tests canonical membership after the scheduled post-word and final lens", () => {
    const plan = resolvePointTilingPlan(
      resolveTiling(
        {
          kind: "lattice",
          cellScale: 4,
          clip: {
            parts: [
              {
                primitive: { kind: "sphere", radius: 0.05 },
                combine: "union",
                pose: { offset: [1.2, 0.5, 0.6] },
              },
            ],
          },
        },
        3,
      ),
      3,
    )!;
    const prepared = prepareChaosGame(
      fixedPointSystem([0.1, 0.2, 0.3]),
      {
        id: 0,
        position: [0.2, 0.3, -0.4],
        rotation: [0, 0, 0],
        scale: [2, 2, 2],
      },
      { order: 1, plane: "xz" },
      {
        depth: 1,
        transforms: [
          {
            id: 0,
            position: [0.4, -0.1, 0.2],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        ],
      },
    );
    const hist = accumulateFlame(
      prepared,
      [0.03, 0, 0, 0, 0, 0.03, 0, 0, 0, 0, 0.03, 0, 0, 0, 0, 1],
      32,
      32,
      1,
      mulberry32(5),
      [[1, 1, 1]],
      undefined,
      undefined,
      undefined,
      undefined,
      plan,
    );

    expect(hist.pointTiling?.attempts).toBe(1);
    expect(hist.pointTiling?.accepted).toBe(1);
    expect(hist.pointTiling?.emitted).toBe(1);
    expect(hist.hits.reduce((sum, hit) => sum + hit, 0)).toBeGreaterThan(0);
  });

  it("uses the lattice weighted estimator without exceeding source-attempt work", () => {
    const plan = resolvePointTilingPlan(
      resolveTiling({ kind: "lattice", cellScale: 4 }, 1),
      3,
    )!;
    const iterations = 200;
    const hist = accumulateFlame(
      prepareChaosGame(fixedPointSystem([0.2, 0.1, 0.3])),
      [0.08, 0, 0, 0, 0, 0.08, 0, 0, 0, 0, 0.08, 0, 0, 0, 0, 1],
      64,
      64,
      iterations,
      mulberry32(7),
      [[1, 1, 1]],
      undefined,
      undefined,
      undefined,
      undefined,
      plan,
    );

    expect(hist.pointTiling?.attempts).toBe(iterations);
    expect(hist.pointTiling?.accepted).toBe(iterations);
    expect(hist.pointTiling?.selected).toBeLessThanOrEqual(iterations);
    expect(hist.pointTiling?.emitted).toBeLessThanOrEqual(
      hist.pointTiling!.selected,
    );
    expect(hist.pointTiling?.emitted).toBeGreaterThan(0);
    expect(hist.hits.reduce((sum, hit) => sum + hit, 0)).toBeGreaterThan(0);
    expect(hist.hits.filter((hit) => hit > 0).length).toBeGreaterThan(1);
  });

  it("banks empty attempts, then caps one accepted finite source at 32 images", () => {
    const plan = resolvePointTilingPlan(
      resolveTiling({
        group: "b3",
        clip: {
          parts: [
            {
              primitive: { kind: "sphere", radius: 0.05 },
              combine: "union",
              pose: { offset: [0.3, 0.3, 0.6] },
            },
          ],
        },
      }),
      3,
    )!;
    const rng = mulberry32(19);
    const empty = accumulateFlame(
      prepareChaosGame(fixedPointSystem([0.3, 0.3, 0.9])),
      ORTHOGRAPHIC,
      64,
      64,
      40,
      rng,
      [[1, 1, 1]],
      undefined,
      undefined,
      undefined,
      undefined,
      plan,
    );

    expect(empty.hits.every((hit) => hit === 0)).toBe(true);
    expect(empty.maxHits).toBe(0);
    expect(empty.pointTiling).toEqual({
      credit: 40,
      cursor: 0,
      attempts: 40,
      accepted: 0,
      selected: 0,
      emitted: 0,
    });

    const resumed = accumulateFlame(
      prepareChaosGame(fixedPointSystem([0.3, 0.3, 0.6])),
      ORTHOGRAPHIC,
      64,
      64,
      1,
      rng,
      [[1, 1, 1]],
      empty,
      undefined,
      undefined,
      undefined,
      plan,
    );
    expect(resumed.pointTiling).toEqual({
      credit: 9,
      cursor: 32,
      attempts: 41,
      accepted: 1,
      selected: 32,
      emitted: 32,
    });
    expect(resumed.hits.reduce((sum, hit) => sum + hit, 0)).toBe(48);
  });

  it.each(["finite", "lattice"] as const)(
    "keeps %s cursor, weights, and deposits identical across chunks",
    (kind) => {
      const plan = resolvePointTilingPlan(
        kind === "finite"
          ? resolveTiling({ group: "a3" })
          : resolveTiling({ kind: "lattice", cellScale: 4 }, 1),
        3,
      )!;
      const prepared = prepareChaosGame(fixedPointSystem([0.3, 0.3, 0.3]));
      const palette: Vec3[] = [[0.2, 0.4, 0.6]];
      const chunkRng = mulberry32(23);
      let chunked = accumulateFlame(
        prepared,
        ORTHOGRAPHIC,
        64,
        64,
        37,
        chunkRng,
        palette,
        undefined,
        undefined,
        undefined,
        undefined,
        plan,
      );
      chunked = accumulateFlame(
        prepared,
        ORTHOGRAPHIC,
        64,
        64,
        63,
        chunkRng,
        palette,
        chunked,
        undefined,
        undefined,
        undefined,
        plan,
      );
      const oneShot = accumulateFlame(
        prepared,
        ORTHOGRAPHIC,
        64,
        64,
        100,
        mulberry32(23),
        palette,
        undefined,
        undefined,
        undefined,
        undefined,
        plan,
      );

      expect(Array.from(chunked.hits)).toEqual(Array.from(oneShot.hits));
      expect(Array.from(chunked.sumRGB)).toEqual(Array.from(oneShot.sumRGB));
      expect(chunked.maxHits).toBe(oneShot.maxHits);
      expect(chunked.orbit).toEqual(oneShot.orbit);
      expect(chunked.pointTiling).toEqual(oneShot.pointTiling);
    },
  );

  it("does not let tiling perturb xaos, emitter, schedule, final, or color state", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [-0.2, 0.1, 0],
        rotation: [0, 0.2, 0],
        scale: [0.45, 0.45, 0.45],
        chaos: [1, 0.2],
        emitter: GEAR_SHAPE,
      },
      {
        id: 1,
        position: [0.25, -0.1, 0.15],
        rotation: [0.1, 0, -0.2],
        scale: [0.5, 0.5, 0.5],
        chaos: [0.3, 1],
      },
    ];
    const prepared = prepareChaosGame(
      transforms,
      {
        id: 0,
        position: [0.1, 0, -0.1],
        rotation: [0, 0.15, 0],
        scale: [0.8, 0.8, 0.8],
      },
      { order: 1, plane: "xz" },
      {
        depth: 2,
        transforms: [
          {
            id: 0,
            position: [0.05, -0.05, 0],
            rotation: [0, 0, 0],
            scale: [0.9, 0.9, 0.9],
          },
        ],
      },
    );
    const plan = resolvePointTilingPlan(
      resolveTiling({ kind: "lattice", cellScale: 4 }, 4),
      3,
    )!;
    const palette = transformColors(2);
    const colorLUT = buildPaletteLUT("aurora")!;
    const plainRng = mulberry32(101);
    const tiledRng = mulberry32(101);
    const plain = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      48,
      48,
      300,
      plainRng,
      palette,
      undefined,
      colorLUT,
    );
    const tiled = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      48,
      48,
      300,
      tiledRng,
      palette,
      undefined,
      colorLUT,
      undefined,
      undefined,
      plan,
    );

    expect(tiled.orbit).toEqual(plain.orbit);
    expect(tiled.orbitColor).toBe(plain.orbitColor);
    expect(tiled.orbitPrevBase).toBe(plain.orbitPrevBase);
    expect(tiled.orbitChaosLeft).toBe(plain.orbitChaosLeft);
    expect(tiledRng()).toBe(plainRng());
    expect(tiled.pointTiling?.attempts).toBe(300);
  });

  it("keeps an explicitly absent plan value-identical and state-free", () => {
    const prepared = prepareChaosGame(sierpinskiTetrahedron());
    const palette = transformColors(4);
    const plain = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      32,
      32,
      5000,
      mulberry32(17),
      palette,
    );
    const absent = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      32,
      32,
      5000,
      mulberry32(17),
      palette,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(Array.from(absent.hits)).toEqual(Array.from(plain.hits));
    expect(Array.from(absent.sumRGB)).toEqual(Array.from(plain.sumRGB));
    expect(absent.maxHits).toBe(plain.maxHits);
    expect(absent.orbit).toEqual(plain.orbit);
    expect(absent.orbitColor).toBe(plain.orbitColor);
    expect(Object.keys(absent)).toEqual(Object.keys(plain));
    expect(absent.pointTiling).toBeUndefined();
  });

  it("rejects a raw Balloon plus active tiling invariant violation", () => {
    const plan = resolvePointTilingPlan(resolveTiling({ group: "a3" }), 3)!;
    expect(() =>
      accumulateFlame(
        prepareChaosGame(fixedPointSystem([0.3, 0.3, 0.3])),
        ORTHOGRAPHIC,
        8,
        8,
        1,
        mulberry32(2),
        [[1, 1, 1]],
        undefined,
        undefined,
        {
          balloon: buildBalloonFromBall({ center: [0, 0, 0], radius: 1 }, 1),
          tint: [0, 0, 0],
          tintStrength: 0,
          weight: 1,
        },
        undefined,
        plan,
      ),
    ).toThrow("Flame point tiling is unavailable with Balloon");
  });

  it("rejects a kaleidoscope-prepared system plus active tiling invariant violation", () => {
    const plan = resolvePointTilingPlan(resolveTiling({ group: "a3" }), 3)!;
    expect(() =>
      accumulateFlame(
        prepareChaosGame(fixedPointSystem([0.3, 0.3, 0.3]), null, {
          order: 2,
          plane: "xz",
        }),
        ORTHOGRAPHIC,
        8,
        8,
        1,
        mulberry32(2),
        [[1, 1, 1]],
        undefined,
        undefined,
        undefined,
        undefined,
        plan,
      ),
    ).toThrow("kaleidoscope symmetry above order 1");
  });
});

describe("accumulateFlame balloon echo", () => {
  it("deposits an off-frame source's visible inversion into the same histogram at the configured weight", () => {
    const palette: Vec3[] = [[0.8, 0.2, 0.1]];
    const hist = accumulateFlame(
      prepareChaosGame(fixedPointSystem([2, 0, 0])),
      ORTHOGRAPHIC,
      20,
      20,
      8,
      mulberry32(1),
      palette,
      undefined,
      undefined,
      {
        // R = 1: x = 2 inverts to x = 0.5, visibly inside the frame.
        balloon: buildBalloonFromBall({ center: [0, 0, 0], radius: 1 }, 1),
        tint: [0, 1, 0],
        tintStrength: 0.75,
        weight: 0.25,
      },
    );

    const echoBucket = 10 * 20 + 15; // NDC (0.5, 0).
    expect(hist.hits.reduce((sum, hit) => sum + hit, 0)).toBe(2);
    expect(hist.hits[echoBucket]).toBe(2); // 8 * 0.25.
    expect(hist.maxHits).toBe(2);
    const mixed: Vec3 = [0.2, 0.8, 0.025];
    expect(hist.sumRGB[echoBucket * 3]).toBeCloseTo(mixed[0] * 2, 12);
    expect(hist.sumRGB[echoBucket * 3 + 1]).toBeCloseTo(mixed[1] * 2, 12);
    expect(hist.sumRGB[echoBucket * 3 + 2]).toBeCloseTo(mixed[2] * 2, 12);
  });

  it("tints only the echo while leaving the primary splat's color untouched", () => {
    const palette: Vec3[] = [[0.8, 0.2, 0.1]];
    const iterations = 6;
    const hist = accumulateFlame(
      prepareChaosGame(fixedPointSystem([0.25, 0, 0])),
      ORTHOGRAPHIC,
      20,
      20,
      iterations,
      mulberry32(2),
      palette,
      undefined,
      undefined,
      {
        // R² = 0.125: x = 0.25 inverts to x = 0.5.
        balloon: buildBalloonFromBall(
          { center: [0, 0, 0], radius: 0.5 },
          Math.SQRT1_2,
        ),
        tint: [0, 1, 0],
        tintStrength: 1,
        weight: 0.5,
      },
    );

    const sourceBucket = 10 * 20 + 12;
    const echoBucket = 10 * 20 + 15;
    expect(hist.hits[sourceBucket]).toBe(iterations);
    expect(hist.sumRGB[sourceBucket * 3]).toBeCloseTo(0.8 * iterations, 12);
    expect(hist.sumRGB[sourceBucket * 3 + 1]).toBeCloseTo(0.2 * iterations, 12);
    expect(hist.sumRGB[sourceBucket * 3 + 2]).toBeCloseTo(0.1 * iterations, 12);
    expect(hist.hits[echoBucket]).toBe(iterations * 0.5);
    expect(hist.sumRGB[echoBucket * 3]).toBe(0);
    expect(hist.sumRGB[echoBucket * 3 + 1]).toBe(iterations * 0.5);
    expect(hist.sumRGB[echoBucket * 3 + 2]).toBe(0);
  });

  it("samples the independent palette by pre-inversion source radius, then applies tint and weight", () => {
    const palette: Vec3[] = [[0.8, 0.2, 0.1]];
    const balloon = buildBalloonFromBall(
      { center: [0, 0, 0], radius: 0.5 },
      Math.SQRT1_2,
    );
    const echoColorLUT = new Float32Array(256 * 3);
    const source: Vec3 = [0.25, 0, 0];
    const li =
      Math.min(255, (balloonPaletteCoordinate(balloon, source) * 256) | 0) * 3;
    echoColorLUT.set([0.1, 0.5, 0.9], li);
    const iterations = 6;
    const hist = accumulateFlame(
      prepareChaosGame(fixedPointSystem(source)),
      ORTHOGRAPHIC,
      20,
      20,
      iterations,
      mulberry32(2),
      palette,
      undefined,
      undefined,
      {
        balloon,
        tint: [0.9, 0.1, 0.3],
        tintStrength: 0.25,
        weight: 0.5,
      },
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

  it("keeps independent-palette progressive chunks identical to one shot", () => {
    const prepared = prepareChaosGame(sierpinskiTetrahedron());
    const palette = transformColors(4);
    const echo = {
      balloon: buildBalloonFromBall(
        { center: [0, 0, 0] as Vec3, radius: 2 },
        0.9,
      ),
      tint: [0.2, 0.7, 0.4] as Vec3,
      tintStrength: 0.3,
      weight: 1,
    };
    const echoColorLUT = buildPaletteLUT("aurora")!;
    const rngChunked = mulberry32(91);
    let chunked = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      32,
      32,
      2000,
      rngChunked,
      palette,
      undefined,
      undefined,
      echo,
      echoColorLUT,
    );
    chunked = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      32,
      32,
      3000,
      rngChunked,
      palette,
      chunked,
      undefined,
      echo,
      echoColorLUT,
    );
    const oneShot = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      32,
      32,
      5000,
      mulberry32(91),
      palette,
      undefined,
      undefined,
      echo,
      echoColorLUT,
    );

    expect(Array.from(chunked.hits)).toEqual(Array.from(oneShot.hits));
    expect(Array.from(chunked.sumRGB)).toEqual(Array.from(oneShot.sumRGB));
    expect(chunked.orbit).toEqual(oneShot.orbit);
    expect(chunked.orbitColor).toBe(oneShot.orbitColor);
  });

  it("keeps an explicitly absent echo byte-identical to the original call shape", () => {
    const prepared = prepareChaosGame(sierpinskiTetrahedron());
    const palette = transformColors(4);
    const plain = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      32,
      32,
      5000,
      mulberry32(17),
      palette,
    );
    const absent = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      32,
      32,
      5000,
      mulberry32(17),
      palette,
      undefined,
      undefined,
      undefined,
    );

    expect(Array.from(absent.hits)).toEqual(Array.from(plain.hits));
    expect(Array.from(absent.sumRGB)).toEqual(Array.from(plain.sumRGB));
    expect(absent.maxHits).toBe(plain.maxHits);
    expect(absent.orbit).toEqual(plain.orbit);
    expect(absent.orbitColor).toBe(plain.orbitColor);
  });
});

// ---------------------------------------------------------------------------
// The hitMass invariant: the tone-map's normalizer must be the exact sum of
// the `hits` array, so EVERY deposit site — the plain plot, the tiling
// visitor's weighted mirrors, the balloon echo's second splat — has to
// account its weight into the running mass. One missed site fails these
// loudly instead of silently shifting every render's exposure.
// ---------------------------------------------------------------------------

/** sum(hist.hits) === hist.hitMass within a relative 1e-9 (fp-tolerant). */
function expectMassEqualsHits(hist: FlameHistogram): void {
  let sum = 0;
  for (let i = 0; i < hist.hits.length; i++) sum += hist.hits[i];
  expect(Math.abs(hist.hitMass - sum)).toBeLessThanOrEqual(
    1e-9 * Math.max(1, Math.abs(sum)),
  );
}

describe("FlameHistogram hitMass invariant", () => {
  it("accumulateFlame: hitMass is the exact sum of hits after a plain run", () => {
    const hist = accumulateFlame(
      prepareChaosGame(sierpinskiTetrahedron()),
      ORTHOGRAPHIC,
      32,
      32,
      20_000,
      mulberry32(3),
      transformColors(4),
    );
    expectMassEqualsHits(hist);
  });

  it("accumulateFlame: hitMass survives chunked accumulation exactly like one shot", () => {
    const prepared = prepareChaosGame(sierpinskiTetrahedron());
    const palette = transformColors(4);
    const rng = mulberry32(5);
    let chunked = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      32,
      32,
      2000,
      rng,
      palette,
    );
    chunked = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      32,
      32,
      3000,
      rng,
      palette,
      chunked,
    );
    const oneShot = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      32,
      32,
      5000,
      mulberry32(5),
      palette,
    );
    expect(chunked.hitMass).toBe(oneShot.hitMass);
    expectMassEqualsHits(chunked);
  });

  it("accumulateFlame: echo deposits count their weight into the mass", () => {
    const hist = accumulateFlame(
      prepareChaosGame(fixedPointSystem([0.25, 0, 0])),
      ORTHOGRAPHIC,
      20,
      20,
      6,
      mulberry32(2),
      [[0.8, 0.2, 0.1]],
      undefined,
      undefined,
      {
        balloon: buildBalloonFromBall(
          { center: [0, 0, 0] as Vec3, radius: 0.5 },
          Math.SQRT1_2,
        ),
        tint: [0, 1, 0],
        tintStrength: 1,
        weight: 0.5,
      },
    );
    // 6 primary hits (weight 1 each) + 6 echo splats (weight 0.5 each).
    expect(hist.hitMass).toBeCloseTo(6 + 6 * 0.5, 12);
    expectMassEqualsHits(hist);
  });

  it("accumulateFlame: tiling mirror deposits count their weight into the mass", () => {
    const plan = resolvePointTilingPlan(resolveTiling({ group: "a3" }), 3)!;
    const hist = accumulateFlame(
      prepareChaosGame(fixedPointSystem([0.3, 0.3, 0.3])),
      ORTHOGRAPHIC,
      16,
      16,
      200,
      mulberry32(3),
      [[1, 1, 1]],
      undefined,
      undefined,
      undefined,
      undefined,
      plan,
    );
    expect(hist.pointTiling).toBeDefined();
    expectMassEqualsHits(hist);
  });

  it("downsampleFlame: recomputes the mass exactly from its output buckets", () => {
    const oversized = unevenSource();
    const out = downsampleFlame(oversized, 3, 3, 0.5);
    expectMassEqualsHits(out);
    // And into a reused (dirty) target, where a leaked stale mass would
    // shift the whole tone map.
    const target = dirtyTarget();
    downsampleFlame(oversized, 3, 3, 0.5, target);
    expectMassEqualsHits(target);
  });

  it("adaptiveDownsampleFlame: recomputes the mass exactly from its output buckets", () => {
    const oversized = unevenSource();
    const params: DensityEstimatorParams = {
      estimatorRadius: 3,
      estimatorMinimumRadius: 0,
      estimatorCurve: 0.4,
    };
    const out = adaptiveDownsampleFlame(oversized, 3, 3, {
      estimatorRadius: 3,
      estimatorMinimumRadius: 0,
      estimatorCurve: 0.4,
    });
    expectMassEqualsHits(out);
    const target = dirtyTarget();
    adaptiveDownsampleFlame(oversized, 3, 3, params, target);
    expectMassEqualsHits(target);
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

describe("accumulateFlame escape-reseed", () => {
  it("reseeds every iteration when the map always lands past ESCAPE_LIMIT, keeping the histogram finite and resetting the color coordinate to 0.5", () => {
    // Every oracle above is built from a contracting system that never
    // escapes, so none of them walks flame.ts's inlined reseed branch
    // (nx/ny/nz redrawn from rng(), c forced back to 0.5). This map always
    // lands at (2 * ESCAPE_LIMIT) on every axis — comfortably past the
    // limit regardless of the current orbit point (scale 0 zeroes out the
    // input) — so EVERY iteration of the hot loop, not just an occasional
    // one, walks that branch. colorIndex/colorSpeed are authored well away
    // from 0.5 so the blend alone can never land c there: for the derived
    // defaults of a single-map system (colorIndex 0.5, speed 0.5) the blend
    // itself is already a fixed point at 0.5, which would make the reset
    // assertion below pass even with the reset deleted.
    const escapedCoord = ESCAPE_LIMIT * 2;
    const transforms = fixedPointSystem([
      escapedCoord,
      escapedCoord,
      escapedCoord,
    ]).map((t) => ({ ...t, colorIndex: 0.9, colorSpeed: 0.8 }));
    const prepared = prepareChaosGame(transforms);
    const palette = transformColors(1);
    const colorLUT = buildPaletteLUT("spectrum");
    if (!colorLUT) throw new Error("spectrum should have a LUT");

    const hist = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      10,
      10,
      30,
      mulberry32(1),
      palette,
      undefined,
      colorLUT,
    );

    // Every reseed redraws x/y/z in [-0.5, 0.5) — comfortably inside the
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

describe("accumulateFlame structural coloring (colorLUT)", () => {
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

describe("accumulateFlame structural coloring: per-transform colorIndex/colorSpeed", () => {
  it("pins an all-absent render exactly identical to the same system with every derived default authored explicitly", () => {
    const base = sierpinskiTetrahedron();
    const n = base.length;
    const withDefaultsAuthored = base.map((t, i) => ({
      ...t,
      colorIndex: derivedColorIndex(i, n),
      colorSpeed: DEFAULT_COLOR_SPEED,
    }));
    const palette = transformColors(n);
    const colorLUT = buildPaletteLUT("spectrum");
    if (!colorLUT) throw new Error("spectrum should have a LUT");
    const width = 48;
    const height = 48;
    const iterations = 4000;

    const absent = accumulateFlame(
      prepareChaosGame(base),
      ORTHOGRAPHIC,
      width,
      height,
      iterations,
      mulberry32(17),
      palette,
      undefined,
      colorLUT,
    );
    const explicit = accumulateFlame(
      prepareChaosGame(withDefaultsAuthored),
      ORTHOGRAPHIC,
      width,
      height,
      iterations,
      mulberry32(17),
      palette,
      undefined,
      colorLUT,
    );

    expect(Array.from(explicit.hits)).toEqual(Array.from(absent.hits));
    expect(Array.from(explicit.sumRGB)).toEqual(Array.from(absent.sumRGB));
    expect(explicit.maxHits).toBe(absent.maxHits);
    expect(explicit.orbitColor).toBe(absent.orbitColor);
  });

  it("colorSpeed: 0 pins the color coordinate at its 0.5 start for every point, whichever map fires", () => {
    const transforms = sierpinskiTetrahedron().map((t) => ({
      ...t,
      colorSpeed: 0,
    }));
    const palette = transformColors(transforms.length);
    const colorLUT = buildPaletteLUT("spectrum");
    if (!colorLUT) throw new Error("spectrum should have a LUT");
    const width = 32;
    const height = 32;
    const iterations = 3000;

    const hist = accumulateFlame(
      prepareChaosGame(transforms),
      ORTHOGRAPHIC,
      width,
      height,
      iterations,
      mulberry32(5),
      palette,
      undefined,
      colorLUT,
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
    expect(sumR).toBeCloseTo(colorLUT[li] * totalHits, 6);
    expect(sumG).toBeCloseTo(colorLUT[li + 1] * totalHits, 6);
    expect(sumB).toBeCloseTo(colorLUT[li + 2] * totalHits, 6);
  });

  it("colorSpeed: 1 snaps the coordinate straight to the picked map's colorIndex every step", () => {
    const base = sierpinskiTetrahedron();
    const n = base.length;
    const transforms = base.map((t) => ({ ...t, colorSpeed: 1 }));
    const prepared = prepareChaosGame(transforms);
    const palette = transformColors(n);
    const colorLUT = buildPaletteLUT("spectrum");
    if (!colorLUT) throw new Error("spectrum should have a LUT");
    const iterations = 3000;

    const hist = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      16,
      16,
      iterations,
      mulberry32(23),
      palette,
      undefined,
      colorLUT,
    );

    // Reference: the same orbit, but c snaps straight to the picked map's
    // (derived, since none is authored here) slot every step, instead of
    // blending halfway toward it.
    const rng = mulberry32(23);
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    for (let i = 0; i < 100; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
    }
    let c = 0.5;
    for (let i = 0; i < iterations; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
      c = derivedColorIndex(s.index, n);
    }

    expect(hist.orbitColor).toBe(c);
  });

  it("authored colorIndex genuinely changes the accumulated colors vs. the derived default", () => {
    const base = sierpinskiTetrahedron();
    const palette = transformColors(base.length);
    const colorLUT = buildPaletteLUT("spectrum");
    if (!colorLUT) throw new Error("spectrum should have a LUT");
    const width = 32;
    const height = 32;
    const iterations = 4000;

    const derived = accumulateFlame(
      prepareChaosGame(base),
      ORTHOGRAPHIC,
      width,
      height,
      iterations,
      mulberry32(9),
      palette,
      undefined,
      colorLUT,
    );
    // Deliberately NOT the derived spread (i / (n - 1)) for any map.
    const authored = base.map((t, i) => ({
      ...t,
      colorIndex: (i + 1) / (base.length + 1),
    }));
    const withAuthored = accumulateFlame(
      prepareChaosGame(authored),
      ORTHOGRAPHIC,
      width,
      height,
      iterations,
      mulberry32(9),
      palette,
      undefined,
      colorLUT,
    );

    expect(Array.from(withAuthored.sumRGB)).not.toEqual(
      Array.from(derived.sumRGB),
    );
  });

  it("authored colorIndex/colorSpeed never perturb the orbit: hits and maxHits match a derived render, same seed", () => {
    const base = sierpinskiTetrahedron();
    const colored = base.map((t, i) => ({
      ...t,
      colorIndex: (i + 1) / (base.length + 1),
      colorSpeed: 0.15,
    }));
    const palette = transformColors(base.length);
    const colorLUT = buildPaletteLUT("spectrum");
    if (!colorLUT) throw new Error("spectrum should have a LUT");
    const width = 32;
    const height = 32;
    const iterations = 4000;

    const plain = accumulateFlame(
      prepareChaosGame(base),
      ORTHOGRAPHIC,
      width,
      height,
      iterations,
      mulberry32(9),
      palette,
      undefined,
      colorLUT,
    );
    const withColors = accumulateFlame(
      prepareChaosGame(colored),
      ORTHOGRAPHIC,
      width,
      height,
      iterations,
      mulberry32(9),
      palette,
      undefined,
      colorLUT,
    );

    expect(Array.from(withColors.hits)).toEqual(Array.from(plain.hits));
    expect(withColors.maxHits).toBe(plain.maxHits);
  });
});

/**
 * `TonemapParams` at the neutral collapse point (gamma: 1, vibrancy: 1) — see
 * "collapses to the neutral tonemap" below. `gammaThreshold` is
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

/**
 * The mean-relative log-density tone-map, written out independently — the
 * oracle "collapses to the neutral tonemap" pins tonemapFlame against. It
 * implements the NEW density form (`log1p(h / mean) /
 * log1p(FLAME_DENSITY_SATURATION)`, mean = hitMass / (width * height)) and
 * reads the same declared input (`hitMass`) the production curve does; that
 * the mass really is the sum of the `hits` array is pinned separately by the
 * hitMass invariant tests below, so this file never compares two copies of a
 * broken bookkeeping against each other blind.
 */
function tonemapFlameNeutralOracle(
  histogram: FlameHistogram,
  exposure: number,
): Uint8ClampedArray {
  const { width, height, hits, sumRGB, hitMass } = histogram;
  const out = new Uint8ClampedArray(width * height * 4);
  if (hitMass <= 0) return out;
  const mean = hitMass / (width * height);
  const logSaturation = Math.log1p(FLAME_DENSITY_SATURATION);
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (h <= 0) continue;
    const brightness = (Math.log1p(h / mean) / logSaturation) * exposure;
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

describe("accumulateFlame with symmetry", () => {
  it("matches the stepOrbit/plotPoint oracle when the prepared system has rotated copies", () => {
    // Same shape as "accumulateFlame vs. stepOrbit/plotPoint" above, but
    // `prepared` is built with rotated copies: stepOrbit already rotates a
    // picked slot's full affine+variation output (see chaos-game.test.ts's
    // "rotates a slot's FULL affine+variation output"), so if
    // accumulateFlame's hand-inlined loop ever drifts from that — including
    // its post-rotation and BASE-index handling — this is what catches it.
    const transforms = sierpinskiTetrahedron();
    const finalTransform: Transform = {
      id: 0,
      position: [0.2, -0.1, 0],
      rotation: [0, 0.3, 0],
      scale: [1.2, 1.2, 1.2],
    };
    const prepared = prepareChaosGame(transforms, finalTransform, {
      order: 4,
      plane: "xz",
    });
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
      // s.index is already the BASE map (see chaos-game.ts's stepOrbit), so
      // this indexes `palette` (sized to transforms.length) exactly like the
      // no-symmetry oracle above.
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

  it("matches the structural-coloring (colorLUT) oracle when the prepared system has rotated copies", () => {
    const transforms = sierpinskiTetrahedron();
    const finalTransform: Transform = {
      id: 0,
      position: [0.2, -0.1, 0],
      rotation: [0, 0.3, 0],
      scale: [1.2, 1.2, 1.2],
    };
    const prepared = prepareChaosGame(transforms, finalTransform, {
      order: 3,
      plane: "xy",
    });
    const palette = transformColors(transforms.length);
    const colorLUT = buildPaletteLUT("spectrum");
    if (!colorLUT) throw new Error("spectrum should have a LUT");
    const width = 64;
    const height = 64;
    const iterations = 5000;
    const projection = ORTHOGRAPHIC;
    // BASE count — colorDenom keys on this, not the expanded slot count (see
    // flame.ts's accumulateFlame), so every rotated copy of a base map
    // repeats that map's gradient slot instead of smearing across copies.
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

  it("produces a differently-shaped histogram than the same seed without symmetry", () => {
    const transforms = sierpinskiTetrahedron();
    const palette = transformColors(transforms.length);
    const width = 64;
    const height = 64;
    const iterations = 5000;

    const withoutSymmetry = accumulateFlame(
      prepareChaosGame(transforms),
      ORTHOGRAPHIC,
      width,
      height,
      iterations,
      mulberry32(1),
      palette,
    );
    const withSymmetry = accumulateFlame(
      prepareChaosGame(transforms, null, { order: 5, plane: "yz" }),
      ORTHOGRAPHIC,
      width,
      height,
      iterations,
      mulberry32(1),
      palette,
    );

    expect(Array.from(withSymmetry.hits)).not.toEqual(
      Array.from(withoutSymmetry.hits),
    );
  });

  it("colors every rotated copy as its base map's authored colorIndex/colorSpeed, not its own", () => {
    const authoredColor = [
      { index: 0.9, speed: 0.8 },
      { index: 0.1, speed: 0.3 },
    ];
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.05, -0.05],
        rotation: [0.1, 0.2, 0.05],
        scale: [0.5, 0.5, 0.5],
        colorIndex: authoredColor[0].index,
        colorSpeed: authoredColor[0].speed,
      },
      {
        id: 1,
        position: [-0.1, 0.05, 0.1],
        rotation: [0, 0.1, 0.2],
        scale: [0.5, 0.5, 0.5],
        colorIndex: authoredColor[1].index,
        colorSpeed: authoredColor[1].speed,
      },
    ];
    const prepared = prepareChaosGame(transforms, null, {
      order: 3,
      plane: "xz",
    });
    const palette = transformColors(transforms.length);
    const colorLUT = buildPaletteLUT("spectrum");
    if (!colorLUT) throw new Error("spectrum should have a LUT");
    const width = 48;
    const height = 48;
    const iterations = 4000;

    const actual = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      width,
      height,
      iterations,
      mulberry32(31),
      palette,
      undefined,
      colorLUT,
    );

    // Reference loop: same orbit, c blended using the BASE map's authored
    // colorIndex/colorSpeed — stepOrbit already resolves `s.index` to the
    // base map regardless of which rotated copy actually fired, so if
    // accumulateFlame ever keyed the blend on the expanded slot instead, this
    // would diverge (or, past the resolved arrays' length, produce NaN).
    const rng = mulberry32(31);
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
      const a = authoredColor[s.index];
      c = c * (1 - a.speed) + a.index * a.speed;
      // No final transform in this system, so plotPoint(prepared, ...) would
      // return [x, y, z] unchanged while touching no rng — skip the no-op call.
      const cw =
        ORTHOGRAPHIC[12] * x +
        ORTHOGRAPHIC[13] * y +
        ORTHOGRAPHIC[14] * z +
        ORTHOGRAPHIC[15];
      if (cw <= 0) continue;
      const cx =
        ORTHOGRAPHIC[0] * x +
        ORTHOGRAPHIC[1] * y +
        ORTHOGRAPHIC[2] * z +
        ORTHOGRAPHIC[3];
      const cy =
        ORTHOGRAPHIC[4] * x +
        ORTHOGRAPHIC[5] * y +
        ORTHOGRAPHIC[6] * z +
        ORTHOGRAPHIC[7];
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

    expect(Array.from(actual.hits)).toEqual(Array.from(expected.hits));
    expect(Array.from(actual.sumRGB)).toEqual(Array.from(expected.sumRGB));
    expect(actual.orbitColor).toBe(c);
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
    let hitMass = 0;
    for (const { bucket, hits, color } of entries) {
      hist.hits[bucket] = hits;
      const o = bucket * 3;
      hist.sumRGB[o] = color[0] * hits;
      hist.sumRGB[o + 1] = color[1] * hits;
      hist.sumRGB[o + 2] = color[2] * hits;
      maxHits = Math.max(maxHits, hits);
      hitMass += hits;
    }
    hist.maxHits = maxHits;
    hist.hitMass = hitMass;
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

  it("keeps a lone hit legible when the frame is sparse (mean-relative, by hand)", () => {
    // One hit in a 4x4 frame: mean deposited density = 1/16, so the bucket
    // sits at 16x the mean and its density is log1p(16)/log1p(32) ~= 0.817
    // by hand — a LINEAR hits-vs-area ratio would read 16/65536 of full
    // brightness (byte 0). The log keeps sparse structure legible.
    const hist = histogramWith([{ bucket: 0, hits: 1, color: [1, 1, 1] }]);
    const image = tonemapFlame(hist, neutral(1));
    const density = Math.log1p(16) / Math.log1p(FLAME_DENSITY_SATURATION);
    const expected = new Uint8ClampedArray([density * 255]);
    expect(image[0]).toBe(expected[0]);
    expect(image[0]).toBeGreaterThan(10);
  });

  it("dims a lone hit that rides beside a bucket 10^6 times denser (the hot core may saturate, the mean anchors)", () => {
    // THE LOOK CHANGE, pinned: under the old maxHits curve this lone hit
    // read ~10 (log1p(1)/log1p(1e6+1)); under the mean-relative curve the
    // 1e6-hit bucket drags the mean up and the lone hit's h/mean collapses
    // to ~1.6e-5 — byte 0. A single stray hit no longer glows in a
    // converged frame; that is the anchor's point.
    const hist = histogramWith([
      { bucket: 0, hits: 1, color: [1, 1, 1] },
      { bucket: 1, hits: 1_000_000, color: [1, 1, 1] },
    ]);
    const image = tonemapFlame(hist, neutral(1));
    expect(image[0]).toBe(0);
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

describe("tonemapFlame collapses to the neutral tonemap at gamma: 1, vibrancy: 1", () => {
  // A render that never touches gamma/vibrancy must see byte-for-byte the
  // mean-relative log-density tone-map: the controls' terms must be exact
  // no-ops at their neutral values, not merely close.
  function histogramWith(
    entries: { bucket: number; hits: number; color: Vec3 }[],
    width: number,
    height: number,
  ): FlameHistogram {
    const hist = createFlameHistogram(width, height);
    let maxHits = 0;
    let hitMass = 0;
    for (const { bucket, hits, color } of entries) {
      hist.hits[bucket] = hits;
      const o = bucket * 3;
      hist.sumRGB[o] = color[0] * hits;
      hist.sumRGB[o + 1] = color[1] * hits;
      hist.sumRGB[o + 2] = color[2] * hits;
      maxHits = Math.max(maxHits, hits);
      hitMass += hits;
    }
    hist.maxHits = maxHits;
    hist.hitMass = hitMass;
    return hist;
  }

  it("matches the neutral oracle exactly across a spread of hit counts, colors, and exposures", () => {
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
      const expected = tonemapFlameNeutralOracle(hist, exposure);
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
    const expected = tonemapFlameNeutralOracle(hist, 1.3);
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
    // A consistent fixture: the mass IS the sum of the hits array (the mean
    // is then hits / 2 across the two buckets), which is the discipline
    // every tonemap fixture in this file keeps.
    hist.hitMass = hits;
    return hist;
  }

  it("above 1, brightens a faint (low-density) bucket relative to gamma: 1", () => {
    // h/mean = 2 -> density = log1p(2)/log1p(32) ~= 0.317, well below the
    // hot end, so the gamma reshape has room to brighten it.
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

  it("leaves a bucket at exactly FLAME_DENSITY_SATURATION x mean at full brightness regardless of gamma", () => {
    // density = 1 exactly where h/mean = FLAME_DENSITY_SATURATION (the
    // curve's own ceiling): log1p(32)/log1p(32) === 1, and 1 ** (1/gamma)
    // === 1 for any gamma. Built by hand: one bucket at 3200 hits plus
    // 3200 more spread over the other 63 buckets of a 64-wide row gives
    // mass 6400, mean 100, h/mean 32 for bucket 0.
    const hist = createFlameHistogram(64, 1);
    hist.hits[0] = 3200;
    hist.sumRGB[0] = 3200;
    hist.sumRGB[1] = 3200;
    hist.sumRGB[2] = 3200;
    for (let i = 1; i < 64; i++) {
      hist.hits[i] = i === 1 ? 100 : 50;
      hist.sumRGB[i * 3] = hist.hits[i];
      hist.sumRGB[i * 3 + 1] = hist.hits[i];
      hist.sumRGB[i * 3 + 2] = hist.hits[i];
    }
    hist.maxHits = 3200;
    hist.hitMass = 6400;

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
    expect(gamma1[0]).toBe(255);
    expect(gamma4[0]).toBe(gamma1[0]);
  });

  it("saturates a bucket far above the ceiling to the same full brightness", () => {
    // The h/mean = 32 point is the anchor, not a clamp on the curve's value:
    // past it the density keeps rising (here h/mean = 42.7, density 1.09)
    // and the 8-bit output has nowhere to go but white, at any gamma.
    const hist = createFlameHistogram(64, 1);
    hist.hits[0] = 12_800;
    hist.sumRGB[0] = 12_800;
    hist.sumRGB[1] = 12_800;
    hist.sumRGB[2] = 12_800;
    for (let i = 1; i < 64; i++) {
      hist.hits[i] = 100;
      hist.sumRGB[i * 3] = hist.hits[i];
      hist.sumRGB[i * 3 + 1] = hist.hits[i];
      hist.sumRGB[i * 3 + 2] = hist.hits[i];
    }
    hist.maxHits = 12_800;
    hist.hitMass = 12_800 + 63 * 100;

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
    expect(gamma1[0]).toBe(255);
    expect(gamma4[0]).toBe(gamma1[0]);
  });
});

describe("tonemapFlame gammaThreshold", () => {
  it("is continuous across the threshold: densities just below and just above it read nearly identically", () => {
    // Solve for the (real-valued) hit count whose density lands exactly on
    // the threshold — under the mean-relative form, log1p(h/mean) /
    // log1p(FLAME_DENSITY_SATURATION) = threshold means
    // h = mean * expm1(threshold * log1p(FLAME_DENSITY_SATURATION)) — then
    // take the integer hit counts immediately below and above it. A third
    // filler bucket pins the mean independently of the two straddling
    // buckets (with only two buckets the mean would move to meet them and
    // the straddle could not be tight); a large mean keeps consecutive
    // integers' h/mean ratios close together near the crossing, exactly the
    // role the old curve's large maxHits played.
    const mean = 1_000_000;
    const threshold = 0.2;
    const gamma = 5;
    const targetH =
      mean * Math.expm1(threshold * Math.log1p(FLAME_DENSITY_SATURATION));
    const hBelow = Math.floor(targetH);
    const hAbove = hBelow + 1;

    const hist = createFlameHistogram(3, 1);
    hist.hits[0] = hBelow;
    hist.hits[1] = hAbove;
    hist.hits[2] = 3 * mean - hBelow - hAbove;
    hist.sumRGB[0] = hBelow;
    hist.sumRGB[1] = hBelow;
    hist.sumRGB[2] = hBelow;
    hist.sumRGB[3] = hAbove;
    hist.sumRGB[4] = hAbove;
    hist.sumRGB[5] = hAbove;
    hist.sumRGB[6] = hist.hits[2];
    hist.sumRGB[7] = hist.hits[2];
    hist.sumRGB[8] = hist.hits[2];
    hist.maxHits = Math.max(hBelow, hAbove, hist.hits[2]);
    hist.hitMass = 3 * mean;
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
    hist.hitMass = 3;
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
    // Mass is consistent with the hits array; in a 1x1 histogram the bucket
    // IS the mean, so h/mean = 1 and density = log1p(1)/log1p(32) = 0.2.
    const hist = createFlameHistogram(1, 1);
    hist.hits[0] = 500;
    hist.sumRGB[0] = 500; // r = 1
    hist.sumRGB[1] = 0; // g = 0
    hist.sumRGB[2] = 0; // b = 0
    hist.maxHits = 500;
    hist.hitMass = 500;
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
    // By hand under the mean-relative form: h/mean = 1 in a 1x1 histogram,
    // so density = log1p(1)/log1p(FLAME_DENSITY_SATURATION), then invGamma.
    const density = Math.log1p(1) / Math.log1p(FLAME_DENSITY_SATURATION);
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

// ---------------------------------------------------------------------------
// The mean-density anchor's acceptance tests. The old curve anchored the
// log-density normalizer on the hottest bucket, which made whole-image
// brightness a function of that single bucket (one contractive map measured
// max/mean 21356; max/mean drifted 20.5 -> 10.0 across a 16x budget ladder on
// one system). These tests pin the replacement's invariances on real
// accumulated scenes; tolerances below were measured against the new curve
// and against the old maxHits-anchored one (noted per test).
// ---------------------------------------------------------------------------

/** Mean Rec.709 luminance over the image's populated (alpha > 0) pixels. */
function meanLuminanceOverPopulated(
  image: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  let sum = 0;
  let populated = 0;
  for (let i = 0; i < width * height; i++) {
    if (image[i * 4 + 3] === 0) continue;
    sum +=
      0.2126 * image[i * 4] +
      0.7152 * image[i * 4 + 1] +
      0.0722 * image[i * 4 + 2];
    populated++;
  }
  return populated > 0 ? sum / populated : 0;
}

describe("tonemapFlame mean-density anchor (acceptance)", () => {
  // The app's shipped look (exposure 1, gamma 2.4, vibrancy 1).
  const LOOK: TonemapParams = {
    exposure: 1,
    gamma: 2.4,
    gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
    vibrancy: 1,
  };

  function accumulate(
    transforms: Transform[],
    width: number,
    height: number,
    iterations: number,
    seed: number,
  ): FlameHistogram {
    return accumulateFlame(
      prepareChaosGame(transforms),
      ORTHOGRAPHIC,
      width,
      height,
      iterations,
      mulberry32(seed),
      transformColors(transforms.length),
    );
  }

  it("is invariant under the iteration budget: 1x and 16x tone-map to the same mean luminance within 5%", () => {
    // MEASURED on this fixture: the new curve's mean luminance moves 2.3%
    // across the ladder (residual noise reshaping, not anchoring); the old
    // maxHits curve moved 9.3% (its normalizer rode max/mean 31 -> 33) and
    // the brief's calibration system measured 20.5 -> 10.0 across 16x.
    const base = sierpinskiTetrahedron();
    const sparse = accumulate(base, 32, 32, 20_000, 7);
    const converged = accumulate(base, 32, 32, 320_000, 7);
    const luminance = (hist: FlameHistogram): number => {
      const image = tonemapFlame(hist, LOOK);
      return meanLuminanceOverPopulated(image, hist.width, hist.height);
    };
    const lo = luminance(sparse);
    const hi = luminance(converged);
    expect(Math.abs(lo - hi) / Math.max(lo, hi)).toBeLessThan(0.05);
  });

  it("is invariant under supersample pooling: ss 1 and ss 4 (through downsampleFlame) agree within 8% over the shared silhouette", () => {
    // ss 4 accumulates the SAME per-display-pixel mass (16x the iterations
    // over 16x the buckets) and is pooled by downsampleFlame into the same
    // display grid. The pooled buckets are weighted MEANS, so per-bucket
    // h/mean — the curve's whole input — survives the pooling; the mass is
    // recomputed from the output. Compared over the INTERSECTION of the two
    // images' populated pixels because the Gaussian's silhouette spread (a
    // real pooling effect, ~90 populated display buckets apart here) is a
    // boundary effect, not an exposure one — over the shared silhouette the
    // new curve measured 1.9% apart (the old curve, 3.6%, so this pins
    // invariance rather than discriminating the old anchor).
    const base = sierpinskiTetrahedron();
    const ss1 = accumulate(base, 32, 32, 20_000, 7);
    const ss4 = downsampleFlame(
      accumulate(base, 128, 128, 320_000, 7),
      32,
      32,
      0.4,
    );
    const image1 = tonemapFlame(ss1, LOOK);
    const image4 = tonemapFlame(ss4, LOOK);
    // Mean luminance over pixels populated in BOTH images, per image.
    const intersectionMean = (
      image: Uint8ClampedArray,
    ): { mean: number; count: number } => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 32 * 32; i++) {
        if (image1[i * 4 + 3] === 0 || image4[i * 4 + 3] === 0) continue;
        sum +=
          0.2126 * image[i * 4] +
          0.7152 * image[i * 4 + 1] +
          0.0722 * image[i * 4 + 2];
        n++;
      }
      return { mean: n > 0 ? sum / n : 0, count: n };
    };
    const shared = intersectionMean(image1).count;
    expect(shared).toBeGreaterThan(0); // the silhouettes genuinely overlap.
    const luminance1 = intersectionMean(image1).mean;
    const luminance4 = intersectionMean(image4).mean;
    expect(
      Math.abs(luminance1 - luminance4) / Math.max(luminance1, luminance4),
    ).toBeLessThan(0.08);
  });

  it("renders a strongly contractive map at close to the brightness of the same scene without it", () => {
    // One map at scale 1e-3 concentrates its picks into ~1 bucket: max/mean
    // measured 382 here (the brief's calibration case measured 21356). The
    // old maxHits anchor let that single bucket drag the whole frame down
    // (measured with/without luminance ratio 0.62 at gamma 1; the new curve
    // measures 0.765). The residual gap is the map's legitimate mass
    // redistribution — 25% of the iterations no longer land on the base
    // structure — so the floor sits below that, at 0.70, leaving the old
    // curve's failure 13% below the line.
    const contractive: Transform = {
      id: 4,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1e-3, 1e-3, 1e-3],
    };
    const base = sierpinskiTetrahedron();
    const without = accumulate(base, 64, 64, 20_000, 11);
    const withMap = accumulate([...base, contractive], 64, 64, 20_000, 11);
    const luminance = (hist: FlameHistogram): number => {
      const image = tonemapFlame(hist, {
        exposure: 1,
        gamma: 1,
        gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
        vibrancy: 1,
      });
      return meanLuminanceOverPopulated(image, hist.width, hist.height);
    };
    const lo = luminance(without);
    const hi = luminance(withMap);
    expect(hi / lo).toBeGreaterThanOrEqual(0.7);
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
      estimatorCurve: 0.4, // irrelevant when max == min: whatever radius a count maps to is clamped to the same constant.
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
  // cell's own local hit count resolves to: the WIDER the radius a cell
  // gathers with, the more it dilutes its own peak by averaging in more
  // (zero) neighbors. That is the directly observable effect of radius
  // choice — not, e.g., how far a DIFFERENT cell's influence spreads (a
  // neighboring empty cell's OWN radius depends on ITS OWN — always zero —
  // local count, not on how dense a nearby source happens to be, so it
  // is always the widest possible regardless of what is next to it).

  it("dilutes a low-count cell's own reading proportionally more than a high-count cell's", () => {
    const width = 60;
    const height = 1;
    const bucket = 30;
    const params: DensityEstimatorParams = {
      estimatorRadius: 8,
      estimatorMinimumRadius: 0,
      estimatorCurve: 0.4,
    };

    // 5 hits: barely sampled — radius 8 / 5 ** 0.4 ~= 4.2px, a wide gather
    // that spreads most of the cell's own mass away.
    const sparse = createFlameHistogram(width, height);
    sparse.hits[bucket] = 5;
    sparse.sumRGB[bucket * 3] = 5;
    sparse.maxHits = 5;

    // 50,000 hits: thoroughly sampled — radius 8 / 50_000 ** 0.4 ~= 0.1px,
    // which quantizes to the sharp end of the kernel cache.
    const dense = createFlameHistogram(width, height);
    dense.hits[bucket] = 50_000;
    dense.sumRGB[bucket * 3] = 50_000;
    dense.maxHits = 50_000;

    const sparseOut = adaptiveDownsampleFlame(sparse, width, height, params);
    const denseOut = adaptiveDownsampleFlame(dense, width, height, params);

    // Compare the FRACTION of each cell's own raw count that survives, so
    // the two scenarios' different absolute counts cancel out.
    expect(denseOut.hits[bucket] / 50_000).toBeGreaterThan(0.9);
    expect(sparseOut.hits[bucket] / 5).toBeLessThan(0.5);
  });

  it("keeps a well-sampled cell sharp regardless of how hot the image's peak is elsewhere", () => {
    // The bug this pins against: the original mapping normalized a cell's
    // density against the histogram's PEAK on a log scale, so a
    // well-converged 1000-hit cell sitting in an image whose hottest bucket
    // was 1,000,000 still resolved to a near-maximum radius — the whole
    // finished frame blurred to mush. The radius must depend on the cell's
    // own absolute count only: identical histograms that differ ONLY in the
    // recorded peak (set directly on maxHits — a pure normalization
    // reference, nothing at that position for a kernel to pick up) must
    // produce byte-identical output.
    const width = 60;
    const height = 1;
    const bucket = 30;
    const params: DensityEstimatorParams = {
      estimatorRadius: 8,
      estimatorMinimumRadius: 0,
      estimatorCurve: 0.4,
    };

    const ownPeak = createFlameHistogram(width, height);
    ownPeak.hits[bucket] = 1000;
    ownPeak.sumRGB[bucket * 3] = 1000;
    ownPeak.maxHits = 1000;

    const hotterElsewhere = createFlameHistogram(width, height);
    hotterElsewhere.hits[bucket] = 1000;
    hotterElsewhere.sumRGB[bucket * 3] = 1000;
    hotterElsewhere.maxHits = 1_000_000;

    const a = adaptiveDownsampleFlame(ownPeak, width, height, params);
    const b = adaptiveDownsampleFlame(hotterElsewhere, width, height, params);

    expect(Array.from(a.hits)).toEqual(Array.from(b.hits));
    expect(Array.from(a.sumRGB)).toEqual(Array.from(b.sumRGB));
    // And "sharp" in absolute terms: 1000 hits resolves to a ~0.5px radius,
    // so most of the cell's own reading survives instead of being spread
    // across a near-maximum kernel.
    expect(a.hits[bucket]).toBeGreaterThan(700);
  });

  it("keeps a heavily-sampled cell's own reading close to its raw value", () => {
    // 200,000 hits resolves to estimatorRadius / 200_000 ** 0.4 ~= 0.08px,
    // which quantizes below MIN_ADAPTIVE_FILTER_SIGMA's floor — but that
    // floor does not mean the kernel is literally a 1-cell passthrough (see
    // that constant's doc), so this checks "close to raw", not bit-exact.
    const hist = createFlameHistogram(5, 5);
    hist.hits[12] = 200_000; // center bucket, and the histogram's only hits.
    hist.sumRGB[12 * 3] = 200_000;
    hist.maxHits = 200_000;

    const out = adaptiveDownsampleFlame(hist, 5, 5, {
      estimatorRadius: 10,
      estimatorMinimumRadius: 0,
      estimatorCurve: 0.4,
    });

    expect(out.hits[12]).toBeGreaterThan(190_000); // within 5% of the raw count.
    expect(out.hits[12]).toBeLessThanOrEqual(200_000);
  });

  it("shapes the falloff with estimatorCurve: a lower curve dilutes a mid-count cell more than a higher curve does", () => {
    // radius = estimatorRadius / count ** curve, so at 1000 hits a curve of
    // 0.3 leaves 8 / 1000 ** 0.3 ~= 1.0px of blur while a curve of 3
    // collapses to the sharp floor — the cell's own dilution should be
    // visibly larger at the low curve.
    const width = 30;
    const height = 4;
    const hist = createFlameHistogram(width, height);
    const midBucket = 2 * width + 5;
    const midHits = 1000;
    hist.hits[midBucket] = midHits;
    hist.sumRGB[midBucket * 3] = midHits;
    hist.maxHits = midHits;

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
// Reused `out` histograms: both downsample flavors can write into a
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

  it("overwrites dirty buckets with zeros where the kernel footprint is provably empty", () => {
    // A single distant hot cell in an otherwise empty source: output cells
    // whose entire (even widest-radius) footprint holds no hits take the
    // empty-footprint fast path, which must still WRITE its zeros — a
    // reused dirty target would otherwise leak stale garbage exactly where
    // the skip saved the gather (see the occupancy skip).
    const size = 96; // several occupancy tiles across, so far cells' tile queries are genuinely empty.
    const source = createFlameHistogram(size, size);
    source.hits[0] = 500; // top-left corner.
    source.sumRGB[0] = 500;
    source.maxHits = 500;

    const params: DensityEstimatorParams = {
      estimatorRadius: 2,
      estimatorMinimumRadius: 0,
      estimatorCurve: 0.4,
    };
    const fresh = adaptiveDownsampleFlame(source, size, size, params);

    const dirty = createFlameHistogram(size, size);
    dirty.hits.fill(123);
    dirty.sumRGB.fill(-7);
    dirty.maxHits = 999_999;
    adaptiveDownsampleFlame(source, size, size, params, dirty);

    const farCorner = size * size - 1; // bottom-right — many tiles from the hot cell.
    expect(fresh.hits[farCorner]).toBe(0);
    expect(dirty.hits[farCorner]).toBe(0);
    expect(Array.from(dirty.hits)).toEqual(Array.from(fresh.hits));
    expect(Array.from(dirty.sumRGB)).toEqual(Array.from(fresh.sumRGB));
  });
});

describe("viewFlameHistogram", () => {
  it("wraps external arrays without copying, and tone-maps identically to the histogram it mirrors", () => {
    // Accumulate something real, then rebuild it as a view over the SAME
    // arrays plus the scalar maxHits and the scalar hitMass — the exact
    // reconstruction the main thread performs over shared memory in the
    // worker's shared-frame mode. Mass is a PARAMETER of the reconstruction
    // (it cannot be recomputed from a live view mid-accumulation), and the
    // byte-identical tone-map below is the canary that the worker's
    // hitMass really travels with the frame.
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

    const view = viewFlameHistogram(
      8,
      8,
      hist.hits,
      hist.sumRGB,
      hist.maxHits,
      hist.hitMass,
    );
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

describe("accumulateFlame graph-directed selection (chaos rows)", () => {
  // Weighted + occasionally-escaping chi fixture (julia's coin flips and
  // spherical's origin singularity), the inlined mirror's hardest case: the
  // chi oracle below must cover the escape -> entry-pick path, not just the
  // scheduled sub-orbit boundary.
  function chiFlameSystem(): Transform[] {
    return [
      {
        id: 0,
        position: [0.5, 0.5, 0.5],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        weight: 2,
        chaos: [1, 0.25, 1.5],
      },
      {
        id: 1,
        position: [-0.5, -0.5, -0.5],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        chaos: [2, 1, 1],
        variations: [
          { type: "linear", weight: 1 },
          { type: "julia", weight: 0.3 },
        ],
      },
      {
        id: 2,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.6, 0.6, 0.6],
        variations: [{ type: "spherical", weight: 1 }],
      },
    ];
  }

  it("matches a stepOrbit/plotPoint reference under chi — weighted, kaleidoscope order 2, escapes, a sub-orbit boundary, structural color", () => {
    // The chi extension of this file's correctness oracle: the inlined loop's
    // prevBase threading, escape re-fuse, scheduled sub-orbit re-fuse (seed +
    // warm-up + color reset) and row-directed picks must all be byte-for-byte
    // what the real stepping blocks produce. 6000 iterations cross the 4096
    // boundary once.
    const transforms = chiFlameSystem();
    const symmetry = { order: 2, plane: "xz" as const };
    const prepared = prepareChaosGame(transforms, null, symmetry);
    const palette = transformColors(transforms.length);
    const colorLUT = buildPaletteLUT("spectrum");
    if (!colorLUT) throw new Error("spectrum should have a LUT");
    const width = 64;
    const height = 64;
    const iterations = 6000;
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
    let prevBase = -1;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const s = stepOrbit(prepared, x, y, z, rng, rng, prevBase);
      x = s.x;
      y = s.y;
      z = s.z;
      prevBase = s.escaped ? -1 : s.index;
    }
    const expected = createFlameHistogram(width, height);
    let c = 0.5;
    let chaosLeft = CHAOS_SUB_ORBIT_POINTS;
    for (let i = 0; i < iterations; i++) {
      if (chaosLeft <= 0) {
        x = rng() - 0.5;
        y = rng() - 0.5;
        z = rng() - 0.5;
        prevBase = -1;
        for (let k = 0; k < WARMUP_ITERATIONS; k++) {
          const s = stepOrbit(prepared, x, y, z, rng, rng, prevBase);
          x = s.x;
          y = s.y;
          z = s.z;
          prevBase = s.escaped ? -1 : s.index;
        }
        c = 0.5;
        chaosLeft = CHAOS_SUB_ORBIT_POINTS;
      }
      chaosLeft--;
      const s = stepOrbit(prepared, x, y, z, rng, rng, prevBase);
      x = s.x;
      y = s.y;
      z = s.z;
      // The inlined loop blends c toward the picked base's slot at pick
      // time and resets it on an escape; blending then overwriting on
      // escape lands the same value.
      const slot = n > 1 ? s.index / (n - 1) : 0.5;
      c = (c + slot) / 2;
      if (s.escaped) c = 0.5;
      prevBase = s.escaped ? -1 : s.index;
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
    expected.orbitPrevBase = prevBase;
    expected.orbitChaosLeft = chaosLeft;

    expect(Array.from(actual.hits)).toEqual(Array.from(expected.hits));
    expect(Array.from(actual.sumRGB)).toEqual(Array.from(expected.sumRGB));
    expect(actual.orbit).toEqual(expected.orbit);
    expect(actual.orbitColor).toBe(expected.orbitColor);
    expect(actual.orbitPrevBase).toBe(expected.orbitPrevBase);
    expect(actual.orbitChaosLeft).toBe(expected.orbitChaosLeft);
  });

  it("renders independently of chunk boundaries — the re-fuse counter rides the histogram", () => {
    // Chunk sizes vary per frame budget; the rendered object must not. A
    // 4000 + 5000 split puts the first re-fuse boundary (4096) inside the
    // SECOND chunk — if the countdown or prevBase were worker-local instead
    // of persisted on the histogram, the split would re-fuse at the wrong
    // iteration and diverge from the single 9000-iteration call.
    const transforms = chiFlameSystem();
    const prepared = prepareChaosGame(transforms);
    const palette = transformColors(transforms.length);
    const width = 32;
    const height = 32;

    const chunkedRng = mulberry32(11);
    let chunked = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      width,
      height,
      4000,
      chunkedRng,
      palette,
    );
    chunked = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      width,
      height,
      5000,
      chunkedRng,
      palette,
      chunked,
    );

    const single = accumulateFlame(
      prepared,
      ORTHOGRAPHIC,
      width,
      height,
      9000,
      mulberry32(11),
      palette,
    );

    expect(Array.from(chunked.hits)).toEqual(Array.from(single.hits));
    expect(Array.from(chunked.sumRGB)).toEqual(Array.from(single.sumRGB));
    expect(chunked.orbit).toEqual(single.orbit);
    expect(chunked.orbitPrevBase).toBe(single.orbitPrevBase);
    expect(chunked.orbitChaosLeft).toBe(single.orbitChaosLeft);
  });
});

describe("accumulateFlame scheduled-hybrid post-word (correctness oracle)", () => {
  it("matches the stepOrbit/plotPoint reference when the prepared system carries a schedule", () => {
    // The top oracle with a live post-word: plotPoint's schedule stage was
    // pinned in chaos-game.test.ts, so equality here FORCES the
    // hand-inlined copy in accumulateFlame — the post-word's draws, its
    // order against the lens, and its adopt-only-if-finite rule cannot
    // drift. A lens rides along so the inlined section exercises
    // post-word -> lens in one run.
    const transforms = sierpinskiTetrahedron();
    const finalTransform: Transform = {
      id: 0,
      position: [0.2, -0.1, 0],
      rotation: [0, 0.3, 0],
      scale: [1.2, 1.2, 1.2],
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
    const prepared = prepareChaosGame(
      transforms,
      finalTransform,
      { order: 1, plane: "xz" },
      schedule,
    );
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

describe("accumulateFlame shape emitters (correctness oracle)", () => {
  it("matches the stepOrbit/plotPoint oracle with a gear emitter forced through the inlined loop", () => {
    // The top oracle with a condensation system: stepOrbit owns the emitter
    // branch (chaos-game.test.ts pins its semantics), so driving it by hand
    // here is what forces accumulateFlame's hand-inlined copy — the seed
    // draw, the derived sampler stream, the skipped variations — to stay
    // byte-for-byte equivalent. The emitter map carries a variation on
    // purpose: the inlined loop must NOT run it on emitter steps.
    const transforms: Transform[] = [
      ...sierpinskiTetrahedron(),
      {
        id: 4,
        position: [0, 0.1, 0],
        rotation: [0.8, 0, 0.3],
        scale: [0.45, 0.45, 0.45],
        weight: 1.5,
        variations: [{ type: "swirl", weight: 0.8 }],
        emitter: GEAR_SHAPE,
      },
    ];
    const prepared = prepareChaosGame(transforms);
    const palette = transformColors(transforms.length);
    const width = 48;
    const height = 48;
    const iterations = 4000;
    const projection = ORTHOGRAPHIC;

    const actual = accumulateFlame(
      prepared,
      projection,
      width,
      height,
      iterations,
      mulberry32(1234),
      palette,
    );

    const rng = mulberry32(1234);
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
    }
    const expected = createFlameHistogram(width, height);
    let emitterDeposits = 0;
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
      const col = Math.floor((cx / cw + 1) * 0.5 * width);
      const row = Math.floor((1 - cy / cw) * 0.5 * height);
      if (col < 0 || col >= width || row < 0 || row >= height) continue;
      const bucket = row * width + col;
      expected.hits[bucket] += 1;
      expected.maxHits = Math.max(expected.maxHits, expected.hits[bucket]);
      const rgb = palette[s.index] ?? [1, 1, 1];
      const o = bucket * 3;
      expected.sumRGB[o] += rgb[0];
      expected.sumRGB[o + 1] += rgb[1];
      expected.sumRGB[o + 2] += rgb[2];
      if (s.index === 4) emitterDeposits++;
    }
    expected.orbit = [x, y, z];

    expect(Array.from(actual.hits)).toEqual(Array.from(expected.hits));
    expect(Array.from(actual.sumRGB)).toEqual(Array.from(expected.sumRGB));
    expect(actual.maxHits).toBe(expected.maxHits);
    expect(actual.orbit).toEqual(expected.orbit);
    // The system genuinely emitted — an oracle over a path that never fired
    // would pass vacuously.
    expect(emitterDeposits).toBeGreaterThan(iterations / 8);
  });
});
