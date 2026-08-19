import {
  composeVariations,
  resolveFoldRadii,
  CLASSIC_FOLD_RADII,
} from "./variations";
import { mulberry32 } from "./rng";
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

  it("a second call reuses the result array with its own values, not the previous call's", () => {
    // The blend's result array is owned by the closure and overwritten in
    // place each call. Fire it once with values discarded (to dirty every
    // component), then compare a second call against an independently built
    // closure fed the SAME second inputs — a missing reset on any one
    // component (ox/oy/oz) would leave that axis at the first call's stale
    // value instead of the fresh one, and this would catch it.
    const build = () =>
      composeVariations([
        { type: "linear", weight: 0.5 },
        { type: "spherical", weight: 1.5 },
      ])!;
    const blend = build();
    blend(1, 2, 3, () => 0.5); // dirties the reused array; result unread
    const second = blend(-4, 0.5, 2, () => 0.5);
    const fresh = build();
    expect(second).toEqual(fresh(-4, 0.5, 2, () => 0.5));
  });
});

describe("fold radii", () => {
  it("absent fields resolve to the classic lengths", () => {
    expect(resolveFoldRadii({ type: "mandelbox", weight: 2 })).toEqual(
      CLASSIC_FOLD_RADII,
    );
  });

  it("boxfold, spherefold and mandelbox render byte-identically whether the classic radii are absent or spelled out explicitly", () => {
    const points = mulberry32(20260815);
    const blendRng = mulberry32(7);
    const samples: [number, number, number][] = [
      [0, 0, 0],
      [1, 0, 0],
      [0.5, 0, 0],
      [-1, -1, -1],
    ];
    for (let i = 0; i < 200; i++) {
      samples.push([
        (points() - 0.5) * 6,
        (points() - 0.5) * 6,
        (points() - 0.5) * 6,
      ]);
    }
    for (const type of ["boxfold", "spherefold", "mandelbox"] as const) {
      const implicit = composeVariations([{ type, weight: 2 }]);
      const explicit = composeVariations([
        { type, weight: 2, minRadius: 0.5, fixedRadius: 1, boxLimit: 1 },
      ]);
      if (!implicit || !explicit) {
        throw new Error(`expected both blends for ${type}`);
      }
      for (const [x, y, z] of samples) {
        const a = implicit(x, y, z, blendRng);
        const b = explicit(x, y, z, blendRng);
        expect(b[0]).toBe(a[0]);
        expect(b[1]).toBe(a[1]);
        expect(b[2]).toBe(a[2]);
      }
    }
  });

  it("a non-classic minRadius actually changes mandelbox's output, so the byte-identical test above is not vacuous", () => {
    const classic = composeVariations([{ type: "mandelbox", weight: 2 }]);
    const shrunk = composeVariations([
      { type: "mandelbox", weight: 2, minRadius: 0.25 },
    ]);
    if (!classic || !shrunk) throw new Error("expected both blends");
    // (0.2, 0, 0): the box fold leaves it untouched (inside the unit box), so
    // the whole difference is the magnification fR²/mR²: classic clamps r² =
    // 0.04 to mR² = 0.25 (factor 4 → 0.8, weight 2 → 1.6); minRadius 0.25
    // clamps the same r² to mR² = 0.0625 (factor 16 → 3.2, weight 2 → 6.4).
    expect(classic(0.2, 0, 0, Math.random)[0]).toBeCloseTo(1.6);
    expect(shrunk(0.2, 0, 0, Math.random)[0]).toBeCloseTo(6.4);
  });

  it("minRadius above fixedRadius clamps down to fixedRadius, where the sphere fold becomes the identity", () => {
    const r = resolveFoldRadii({
      type: "spherefold",
      weight: 1,
      minRadius: 5,
      fixedRadius: 1,
    });
    expect(r.minRadius).toBe(1);
    expect(r.fixedRadius).toBe(1);

    const identity = composeVariations([
      { type: "spherefold", weight: 1, minRadius: 5, fixedRadius: 1 },
    ]);
    if (!identity) throw new Error("expected a blend");
    for (const [x, y, z] of [
      [0.3, -0.7, 0.2],
      [2, 0, 0],
      [0, 0, 0],
      [-1.5, 4, -2.25],
    ]) {
      expect(identity(x, y, z, Math.random)).toEqual([x, y, z]);
    }
  });

  it("fixedRadius of 0, negative, NaN or Infinity falls back to the classic 1", () => {
    expect(
      resolveFoldRadii({ type: "spherefold", weight: 1, fixedRadius: 0 })
        .fixedRadius,
    ).toBe(1);
    expect(
      resolveFoldRadii({ type: "spherefold", weight: 1, fixedRadius: -3 })
        .fixedRadius,
    ).toBe(1);
    expect(
      resolveFoldRadii({ type: "spherefold", weight: 1, fixedRadius: NaN })
        .fixedRadius,
    ).toBe(1);
    expect(
      resolveFoldRadii({
        type: "spherefold",
        weight: 1,
        fixedRadius: Infinity,
      }).fixedRadius,
    ).toBe(1);
  });

  it("minRadius is floored above zero so the magnification fR²/mR² stays finite", () => {
    const r = resolveFoldRadii({
      type: "spherefold",
      weight: 1,
      minRadius: 0,
    });
    expect(r.minRadius).toBeGreaterThan(0);
  });

  it("boxLimit 0 is kept, not replaced — boxfold becomes the point reflection t → -t", () => {
    const r = resolveFoldRadii({ type: "boxfold", weight: 1, boxLimit: 0 });
    expect(r.boxLimit).toBe(0);

    const reflect = composeVariations([
      { type: "boxfold", weight: 1, boxLimit: 0 },
    ]);
    if (!reflect) throw new Error("expected a blend");
    expect(reflect(0.3, -0.7, 2, Math.random)).toEqual([-0.3, 0.7, -2]);
  });

  it("boxLimit negative or NaN falls back to the classic 1", () => {
    expect(
      resolveFoldRadii({ type: "boxfold", weight: 1, boxLimit: -2 }).boxLimit,
    ).toBe(1);
    expect(
      resolveFoldRadii({ type: "boxfold", weight: 1, boxLimit: NaN }).boxLimit,
    ).toBe(1);
  });

  it("never produces NaN or Infinity across a grid of fold parameters and points, including the origin and 1e6-scale values", () => {
    const paramSets: Partial<Variation>[] = [
      {},
      { weight: 0 },
      { minRadius: 5, fixedRadius: 1 },
      { minRadius: 0 },
      { fixedRadius: 0 },
      { minRadius: -3, fixedRadius: -2, boxLimit: -1 },
      { minRadius: NaN, fixedRadius: NaN, boxLimit: NaN },
    ];
    const points: [number, number, number][] = [
      [0, 0, 0],
      [1e6, 0, 0],
      [0, 1e6, -1e6],
      [1, 2, -3],
      [-0.5, 0.5, 0.25],
    ];
    for (const type of ["boxfold", "spherefold", "mandelbox"] as const) {
      for (const params of paramSets) {
        const blend = composeVariations([{ type, weight: 1, ...params }]);
        if (blend === null) continue; // weight 0 legitimately yields no blend
        for (const [x, y, z] of points) {
          for (const c of blend(x, y, z, Math.random)) {
            expect(Number.isFinite(c)).toBe(true);
          }
        }
      }
    }
  });
});
