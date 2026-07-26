import { composeVariations } from "./variations";
import type { Rng } from "./rng";
import { VARIATION_TYPES } from "./types";
import type { Variation } from "./types";

/** Apply a single variation at weight 1 — the common case, straight from the public API. */
function warp(
  type: Variation["type"],
  x: number,
  y: number,
  z: number,
  rng: Rng = Math.random,
): [number, number, number] {
  const blend = composeVariations([{ type, weight: 1 }]);
  if (!blend) throw new Error(`expected a blend for ${type}`);
  return blend(x, y, z, rng);
}

describe("variation functions", () => {
  it("linear returns the point unchanged", () => {
    expect(warp("linear", 0.3, -0.7, 0.2)).toEqual([0.3, -0.7, 0.2]);
  });

  it("sinusoidal folds each axis through sine", () => {
    const [x, y, z] = warp("sinusoidal", 1, -1, 0.5);
    expect(x).toBeCloseTo(Math.sin(1));
    expect(y).toBeCloseTo(Math.sin(-1));
    expect(z).toBeCloseTo(Math.sin(0.5));
  });

  it("spherical fixes points on the unit sphere and everts the interior", () => {
    // On the unit sphere p / |p|² = p (bar the tiny EPS floor on the divisor).
    const [ux, uy, uz] = warp("spherical", 1, 0, 0);
    expect(ux).toBeCloseTo(1);
    expect(uy).toBeCloseTo(0);
    expect(uz).toBeCloseTo(0);
    // Interior point is pushed outside (inversion): (0.5,0,0) → (2,0,0).
    const [x] = warp("spherical", 0.5, 0, 0);
    expect(x).toBeCloseTo(2);
  });

  it("swirl preserves the planar radius and passes z through", () => {
    const [x, y, z] = warp("swirl", 0.3, 0.4, 0.7);
    expect(Math.hypot(x, y)).toBeCloseTo(0.5); // hypot(0.3,0.4)
    expect(z).toBe(0.7);
  });

  it("bubble maps every point into the unit ball", () => {
    for (const [x, y, z] of [
      [2, 0, 0],
      [10, 10, 10],
      [0.1, -0.2, 0.05],
    ]) {
      const [ox, oy, oz] = warp("bubble", x, y, z);
      expect(Math.hypot(ox, oy, oz)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it("julia picks its branch from the RNG bit", () => {
    // atan2(0,1)=0, so the angle is 0 or π; √(hypot(1,0))=1.
    const low = warp("julia", 1, 0, 0, () => 0.4); // < 0.5 ⇒ +0
    const high = warp("julia", 1, 0, 0, () => 0.6); // ≥ 0.5 ⇒ +π
    expect(low[0]).toBeCloseTo(1);
    expect(high[0]).toBeCloseTo(-1);
  });

  it("boxfold passes the unit-box interior through untouched", () => {
    // 2·clamp(t,−1,1) − t = 2t − t = t exactly inside the box (Sterbenz).
    expect(warp("boxfold", 0.5, -0.9, 0)).toEqual([0.5, -0.9, 0]);
  });

  it("boxfold reflects each axis back off the |t| = 1 planes", () => {
    // fold(1.5) = 2 − 1.5 = 0.5; fold(−1.5) = −2 + 1.5 = −0.5; fold(3) = −1.
    const [x, y, z] = warp("boxfold", 1.5, -1.5, 3);
    expect(x).toBeCloseTo(0.5);
    expect(y).toBeCloseTo(-0.5);
    expect(z).toBeCloseTo(-1);
  });

  it("boxfold is continuous at the fold plane", () => {
    // At the plane itself the fold is the identity: 2·1 − 1 = 1 exactly.
    expect(warp("boxfold", 1, -1, 1)).toEqual([1, -1, 1]);
  });

  it("spherefold inflates the inner ball, inverts the mid shell, and passes the exterior", () => {
    // r² = 0.01 < 0.25 ⇒ ×4 (fR²/mR²): (0.1, 0, 0) → (0.4, 0, 0).
    const [inner] = warp("spherefold", 0.1, 0, 0);
    expect(inner).toBeCloseTo(0.4);
    // 0.25 ≤ r² = 0.64 < 1 ⇒ inversion ÷r²: 0.8 → 0.8/0.64 = 1.25.
    const [mid] = warp("spherefold", 0.8, 0, 0);
    expect(mid).toBeCloseTo(1.25);
    // r² ≥ 1 ⇒ untouched (×1 is exact).
    expect(warp("spherefold", 1.5, -2, 0.5)).toEqual([1.5, -2, 0.5]);
  });

  it("mandelbox is exactly spherefold composed after boxfold", () => {
    // The composite exists because blending is a weighted SUM — no boxfold +
    // spherefold list can express the composition. Pin it against the two
    // primitives chained by hand, bit-exactly.
    for (const [x, y, z] of [
      [1.3, -0.2, 0.4],
      [0.1, 0.05, -0.02],
      [2.5, -2.5, 0],
    ]) {
      const [bx, by, bz] = warp("boxfold", x, y, z);
      expect(warp("mandelbox", x, y, z)).toEqual(
        warp("spherefold", bx, by, bz),
      );
    }
  });

  it("mandelbox at weight 2 is the classic scale-2 Mandelbox step", () => {
    // (1.2, 0, 0): box fold → 0.8; r² = 0.64 ⇒ ÷0.64 = 1.25; ×2 ⇒ 2.5.
    const blend = composeVariations([{ type: "mandelbox", weight: 2 }]);
    const [x, y, z] = blend!(1.2, 0, 0, Math.random);
    expect(x).toBeCloseTo(2.5);
    expect(y).toBe(0);
    expect(z).toBe(0);
  });

  // The load-bearing safety property: a variation must never emit NaN/Inf, or a
  // single bad landing poisons the whole chaos-game orbit. Includes the origin,
  // where several warps would divide by zero without their EPS floor.
  it("every variation is finite at the origin and beyond", () => {
    const probes = [
      [0, 0, 0],
      [1, 2, -3],
      [-0.001, 0.002, 0],
      [1e-9, 0, 1e-9],
    ];
    for (const type of VARIATION_TYPES) {
      for (const [x, y, z] of probes) {
        for (const c of warp(type, x, y, z, () => 0.5)) {
          expect(Number.isFinite(c)).toBe(true);
        }
      }
    }
  });
});

describe("composeVariations", () => {
  it("returns null when there is nothing to apply", () => {
    expect(composeVariations(undefined)).toBeNull();
    expect(composeVariations([])).toBeNull();
    expect(composeVariations([{ type: "spherical", weight: 0 }])).toBeNull();
  });

  it("drops non-finite weights, treating an all-NaN list as empty", () => {
    expect(composeVariations([{ type: "swirl", weight: NaN }])).toBeNull();
  });

  it("blends variations as a weighted sum", () => {
    // 0.5·linear + 0.5·linear = linear, but proves weights scale the output.
    const blend = composeVariations([
      { type: "linear", weight: 0.25 },
      { type: "linear", weight: 0.75 },
    ]);
    expect(blend!(4, 8, -2, Math.random)).toEqual([4, 8, -2]);
  });

  it("scales a single variation by its weight", () => {
    const blend = composeVariations([{ type: "linear", weight: 3 }]);
    expect(blend!(1, -1, 2, Math.random)).toEqual([3, -3, 6]);
  });

  it("ignores a zero-weight variation inside a blend", () => {
    const withDead = composeVariations([
      { type: "linear", weight: 1 },
      { type: "spherical", weight: 0 },
    ]);
    expect(withDead!(2, 3, 4, Math.random)).toEqual([2, 3, 4]);
  });
});
