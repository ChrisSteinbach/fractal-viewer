import { composeVariations } from "./variations";
import { composeVariations4 } from "./variations4";
import { mulberry32 } from "./rng";
import { VARIATION_TYPES } from "./types";
import type { Rng } from "./rng";
import type { Variation, Vec4 } from "./types";

/** Apply a single 3D variation at weight 1 — straight from the public API. */
function warp3(
  type: Variation["type"],
  x: number,
  y: number,
  z: number,
  rng: Rng,
): [number, number, number] {
  const blend = composeVariations([{ type, weight: 1 }]);
  if (!blend) throw new Error(`expected a 3D blend for ${type}`);
  return blend(x, y, z, rng);
}

/** Apply a single 4D variation at weight 1 — straight from the public API. */
function warp4(
  type: Variation["type"],
  x: number,
  y: number,
  z: number,
  w: number,
  rng: Rng = Math.random,
): Vec4 {
  const blend = composeVariations4([{ type, weight: 1 }]);
  if (!blend) throw new Error(`expected a 4D blend for ${type}`);
  return blend(x, y, z, w, rng);
}

describe("4D variation anchor property", () => {
  // The load-bearing property of the whole embed: at w = 0 each lifted warp is
  // BIT-identical to its 3D counterpart and emits w' = 0. Exact (toBe), for
  // every type — including julia, fed two identically-seeded RNGs so it draws
  // the same branch bit on each side.
  it("every lifted variation equals its 3D counterpart at w = 0 and returns w' = 0", () => {
    for (const type of VARIATION_TYPES) {
      for (const seed of [1, 5, 42, 500]) {
        const rng = mulberry32(seed);
        const x = (rng() - 0.5) * 3;
        const y = (rng() - 0.5) * 3;
        const z = (rng() - 0.5) * 3;
        const [x3, y3, z3] = warp3(type, x, y, z, mulberry32(99));
        const [x4, y4, z4, w4] = warp4(type, x, y, z, 0, mulberry32(99));
        expect(x4).toBe(x3);
        expect(y4).toBe(y3);
        expect(z4).toBe(z3);
        expect(w4).toBe(0);
      }
    }
  });

  // The origin is where several warps would divide by zero without their EPS
  // floor; the 4D radius must keep them finite too (and still w' = 0 at w = 0).
  it("stays finite at the origin for every type", () => {
    for (const type of VARIATION_TYPES) {
      const [x, y, z, w] = warp4(type, 0, 0, 0, 0, () => 0.5);
      for (const c of [x, y, z, w]) expect(Number.isFinite(c)).toBe(true);
    }
  });
});

describe("4D variation radius and carry-through", () => {
  it("spherical uses the full 4D radius (so w genuinely participates)", () => {
    // At (1, 0, 0, 1) the 4D squared radius is 2, so c = 1/2: every coordinate
    // is halved. A purely-3D (z-only) radius would leave w untouched — this
    // pins that w is really in the radius.
    const [x, y, z, w] = warp4("spherical", 1, 0, 0, 1);
    expect(x).toBeCloseTo(0.5, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(0, 12);
    expect(w).toBeCloseTo(0.5, 12);
  });

  it("bubble uses the full 4D radius", () => {
    // c = 4 / (r² + 4) with r² = 1 + 1 = 2, so c = 4/6 = 2/3; x and w scale by c.
    const [x, , , w] = warp4("bubble", 1, 0, 0, 1);
    expect(x).toBeCloseTo(2 / 3, 12);
    expect(w).toBeCloseTo(2 / 3, 12);
  });

  it("swirl carries w through and (per the 3D convention) preserves the planar radius", () => {
    // swirl rotates in the xy-plane by an angle set by the FULL 4D radius, so it
    // preserves hypot(x, y) and passes z AND w through unchanged — the 4D mirror
    // of variations.ts's "preserves the planar radius and passes z through".
    const [x, y, z, w] = warp4("swirl", 0.3, 0.4, 0.7, 0.5);
    expect(Math.hypot(x, y)).toBeCloseTo(0.5, 12); // hypot(0.3, 0.4)
    expect(z).toBe(0.7);
    expect(w).toBe(0.5);
  });

  it("a purely-angular warp (polar) passes both z and w through untouched", () => {
    const [, , z, w] = warp4("polar", 0.3, -0.6, 0.2, -0.9);
    expect(z).toBe(0.2);
    expect(w).toBe(-0.9);
  });
});

describe("composeVariations4", () => {
  it("returns null when there is nothing to apply", () => {
    expect(composeVariations4(undefined)).toBeNull();
    expect(composeVariations4([])).toBeNull();
    expect(composeVariations4([{ type: "spherical", weight: 0 }])).toBeNull();
  });

  it("drops non-finite weights, treating an all-NaN list as empty", () => {
    expect(composeVariations4([{ type: "swirl", weight: NaN }])).toBeNull();
  });

  it("blends variations as a weighted sum across all four coordinates", () => {
    // 0.25·linear + 0.75·linear = linear, but proves weights scale every axis.
    const blend = composeVariations4([
      { type: "linear", weight: 0.25 },
      { type: "linear", weight: 0.75 },
    ]);
    expect(blend!(4, 8, -2, 6, Math.random)).toEqual([4, 8, -2, 6]);
  });

  it("scales a single variation by its weight (w included)", () => {
    const blend = composeVariations4([{ type: "linear", weight: 3 }]);
    expect(blend!(1, -1, 2, 4, Math.random)).toEqual([3, -3, 6, 12]);
  });

  it("ignores a zero-weight variation inside a blend", () => {
    const withDead = composeVariations4([
      { type: "linear", weight: 1 },
      { type: "spherical", weight: 0 },
    ]);
    expect(withDead!(2, 3, 4, 5, Math.random)).toEqual([2, 3, 4, 5]);
  });
});
