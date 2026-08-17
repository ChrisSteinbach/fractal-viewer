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

  it("boxfold folds w like the spatial axes", () => {
    // fold(1.5) = 2 − 1.5 = 0.5 on w, while the in-box axes pass through.
    const [x, y, z, w] = warp4("boxfold", 0.2, -0.4, 0.9, 1.5);
    expect([x, y, z]).toEqual([0.2, -0.4, 0.9]);
    expect(w).toBeCloseTo(0.5, 12);
  });

  it("spherefold uses the full 4D radius (so w genuinely participates)", () => {
    // The spatial radius alone (r² = 0.16) sits in the inner ball (×4), but w
    // pushes the FULL radius into the inversion band: r² = 0.16 + 0.81 = 0.97,
    // so every coordinate divides by 0.97 instead. This pins that w is really
    // in the radius, not just carried through.
    const [x, y, z, w] = warp4("spherefold", 0.4, 0, 0, 0.9);
    expect(x).toBeCloseTo(0.4 / 0.97, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(0, 12);
    expect(w).toBeCloseTo(0.9 / 0.97, 12);
  });

  it("mandelbox is exactly spherefold composed after boxfold in 4D", () => {
    const [bx, by, bz, bw] = warp4("boxfold", 1.3, -0.2, 0.4, -1.7);
    expect(warp4("mandelbox", 1.3, -0.2, 0.4, -1.7)).toEqual(
      warp4("spherefold", bx, by, bz, bw),
    );
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

  it("a second call reuses the result array with its own values, not the previous call's (fr-7smh)", () => {
    // Mirrors variations.test.ts's same-named 3D test, one dimension up —
    // the fourth (w) component is the one a partial reset would most easily
    // miss.
    const build = () =>
      composeVariations4([
        { type: "linear", weight: 0.5 },
        { type: "spherical", weight: 1.5 },
      ])!;
    const blend = build();
    blend(1, 2, 3, 4, () => 0.5); // dirties the reused array; result unread
    const second = blend(-4, 0.5, 2, -1, () => 0.5);
    const fresh = build();
    expect(second).toEqual(fresh(-4, 0.5, 2, -1, () => 0.5));
  });
});

describe("4D fold radii (fr-s9ll)", () => {
  it("boxfold, spherefold and mandelbox render byte-identically in 4D whether the classic radii are absent or spelled out explicitly", () => {
    const points = mulberry32(20260815);
    const blendRng = mulberry32(7);
    const samples: [number, number, number, number][] = [
      [0, 0, 0, 0],
      [1, 0, 0, 0],
      [0.5, 0, 0, 0.5],
      [-1, -1, -1, -1],
    ];
    for (let i = 0; i < 200; i++) {
      samples.push([
        (points() - 0.5) * 6,
        (points() - 0.5) * 6,
        (points() - 0.5) * 6,
        (points() - 0.5) * 6,
      ]);
    }
    for (const type of ["boxfold", "spherefold", "mandelbox"] as const) {
      const implicit = composeVariations4([{ type, weight: 2 }]);
      const explicit = composeVariations4([
        { type, weight: 2, minRadius: 0.5, fixedRadius: 1, boxLimit: 1 },
      ]);
      if (!implicit || !explicit) {
        throw new Error(`expected both 4D blends for ${type}`);
      }
      for (const [x, y, z, w] of samples) {
        const a = implicit(x, y, z, w, blendRng);
        const b = explicit(x, y, z, w, blendRng);
        expect(b[0]).toBe(a[0]);
        expect(b[1]).toBe(a[1]);
        expect(b[2]).toBe(a[2]);
        expect(b[3]).toBe(a[3]);
      }
    }
  });

  // THE IMPORTANT ONE: a 3D system and its 4D lift must render the SAME
  // object at every fold length, not just the classic ones — otherwise a
  // document with a non-classic fold would mean two different shapes
  // depending on which file happened to iterate it.
  it("at w = 0 the 4D fold is bit-exact against the 3D fold at the same non-classic radii", () => {
    const points = mulberry32(424242);
    const nonClassic = { minRadius: 0.3, fixedRadius: 1.4, boxLimit: 0.8 };
    for (const type of ["boxfold", "spherefold", "mandelbox"] as const) {
      const blend3 = composeVariations([{ type, weight: 2, ...nonClassic }]);
      const blend4 = composeVariations4([{ type, weight: 2, ...nonClassic }]);
      if (!blend3 || !blend4) {
        throw new Error(`expected both blends for ${type}`);
      }
      for (let i = 0; i < 200; i++) {
        const x = (points() - 0.5) * 6;
        const y = (points() - 0.5) * 6;
        const z = (points() - 0.5) * 6;
        const [x3, y3, z3] = blend3(x, y, z, mulberry32(7));
        const [x4, y4, z4, w4] = blend4(x, y, z, 0, mulberry32(7));
        expect(x4).toBe(x3);
        expect(y4).toBe(y3);
        expect(z4).toBe(z3);
        expect(w4).toBe(0);
      }
    }
  });

  it("never produces NaN or Infinity in 4D across a grid of fold parameters and points, including the origin and 1e6-scale values", () => {
    const paramSets: Partial<Variation>[] = [
      {},
      { weight: 0 },
      { minRadius: 5, fixedRadius: 1 },
      { minRadius: 0 },
      { fixedRadius: 0 },
      { minRadius: -3, fixedRadius: -2, boxLimit: -1 },
      { minRadius: NaN, fixedRadius: NaN, boxLimit: NaN },
    ];
    const points4: [number, number, number, number][] = [
      [0, 0, 0, 0],
      [1e6, 0, 0, 0],
      [0, 1e6, -1e6, 1e6],
      [1, 2, -3, 4],
      [-0.5, 0.5, 0.25, -0.25],
    ];
    for (const type of ["boxfold", "spherefold", "mandelbox"] as const) {
      for (const params of paramSets) {
        const blend = composeVariations4([{ type, weight: 1, ...params }]);
        if (blend === null) continue; // weight 0 legitimately yields no blend
        for (const [x, y, z, w] of points4) {
          for (const c of blend(x, y, z, w, Math.random)) {
            expect(Number.isFinite(c)).toBe(true);
          }
        }
      }
    }
  });
});
