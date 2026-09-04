import {
  composeVariations,
  resolveFoldRadii,
  resolveJuliaParams,
  resolveCurlParams,
  isClassicJuliaParams,
  isClassicCurlParams,
  juliaVariationFn,
  curlVariationFn,
  CLASSIC_FOLD_RADII,
  CLASSIC_JULIA_PARAMS,
  CLASSIC_CURL_PARAMS,
  isParametricVariationType,
  activeParametricVariationTypes,
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

describe("parametric julia/curl resolvers", () => {
  it("absent fields resolve to the classic parameters — flam3's own defaults", () => {
    expect(resolveJuliaParams("julian", { type: "julian", weight: 1 })).toEqual(
      CLASSIC_JULIA_PARAMS,
    );
    expect(
      resolveJuliaParams("juliascope", { type: "juliascope", weight: 1 }),
    ).toEqual(CLASSIC_JULIA_PARAMS);
    expect(resolveCurlParams({ type: "curl", weight: 1 })).toEqual(
      CLASSIC_CURL_PARAMS,
    );
    expect(CLASSIC_JULIA_PARAMS).toEqual({ power: 1, dist: 1 });
    expect(CLASSIC_CURL_PARAMS).toEqual({ c1: 1, c2: 0 });
  });

  it("each julia type reads its OWN fields, not the sibling's", () => {
    const v: Variation = {
      type: "julian",
      weight: 1,
      julianPower: 3,
      julianDist: 1.5,
      // A hand-crafted entry could carry both types' fields; the type alone
      // decides which pair is live.
      juliascopePower: 9,
      juliascopeDist: -4,
    };
    expect(resolveJuliaParams("julian", v)).toEqual({ power: 3, dist: 1.5 });
    expect(resolveJuliaParams("juliascope", v)).toEqual({
      power: 9,
      dist: -4,
    });
  });

  it("power below the 1e-6 magnitude floor, 0, NaN and Infinity fall back to the classic 1", () => {
    for (const power of [0, 1e-7, -1e-7, NaN, Infinity]) {
      expect(
        resolveJuliaParams("julian", {
          type: "julian",
          weight: 1,
          julianPower: power,
        }).power,
      ).toBe(1);
    }
    // Exactly at the floor is kept — the domain is inclusive.
    expect(
      resolveJuliaParams("julian", {
        type: "julian",
        weight: 1,
        julianPower: 1e-6,
      }).power,
    ).toBe(1e-6);
    // A negative power above the floor is kept (the spiral runs backwards).
    expect(
      resolveJuliaParams("julian", {
        type: "julian",
        weight: 1,
        julianPower: -2,
      }).power,
    ).toBe(-2);
  });

  it("dist and the curl coefficients accept any finite value, falling back only when non-finite", () => {
    expect(
      resolveJuliaParams("julian", { type: "julian", weight: 1, julianDist: 0 })
        .dist,
    ).toBe(0);
    expect(
      resolveJuliaParams("julian", {
        type: "julian",
        weight: 1,
        julianDist: -2,
      }).dist,
    ).toBe(-2);
    expect(
      resolveJuliaParams("julian", {
        type: "julian",
        weight: 1,
        julianDist: NaN,
      }).dist,
    ).toBe(1);
    expect(
      resolveCurlParams({ type: "curl", weight: 1, curlC1: 0, curlC2: 5 }).c1,
    ).toBe(0);
    expect(
      resolveCurlParams({ type: "curl", weight: 1, curlC1: Infinity }).c1,
    ).toBe(1);
    expect(resolveCurlParams({ type: "curl", weight: 1, curlC2: NaN }).c2).toBe(
      0,
    );
  });

  it("the classic predicates recognize exactly the classic sets", () => {
    expect(isClassicJuliaParams({ power: 1, dist: 1 })).toBe(true);
    expect(isClassicJuliaParams({ power: 2, dist: 1 })).toBe(false);
    expect(isClassicJuliaParams({ power: 1, dist: 0 })).toBe(false);
    expect(isClassicCurlParams({ c1: 1, c2: 0 })).toBe(true);
    expect(isClassicCurlParams({ c1: 0, c2: 0 })).toBe(false);
    expect(isClassicCurlParams({ c1: 1, c2: 1 })).toBe(false);
  });

  it("isParametricVariationType guards exactly the three parametric types", () => {
    expect(isParametricVariationType("julian")).toBe(true);
    expect(isParametricVariationType("juliascope")).toBe(true);
    expect(isParametricVariationType("curl")).toBe(true);
    expect(isParametricVariationType("julia")).toBe(false);
    expect(isParametricVariationType("mandelbox")).toBe(false);
    expect(isParametricVariationType("linear")).toBe(false);
  });

  it("activeParametricVariationTypes returns the active entries' types in order, ignoring zero-weight and non-parametric", () => {
    expect(
      activeParametricVariationTypes([
        { type: "swirl", weight: 1 },
        { type: "julian", weight: 0.5 },
        { type: "curl", weight: 0 },
        { type: "juliascope", weight: 1 },
        { type: "julian", weight: NaN },
      ]),
    ).toEqual(["julian", "juliascope"]);
    expect(activeParametricVariationTypes(undefined)).toEqual([]);
  });
});

describe("parametric julia/curl variation functions", () => {
  it("renders byte-identically whether the classic parameters are absent or spelled out explicitly", () => {
    const points = mulberry32(20260904);
    const samples: [number, number, number][] = [
      [0, 0, 0],
      [1, 0, 0],
      [-1, 1, 0.5],
      [0.5, -0.5, -0.25],
    ];
    for (let i = 0; i < 200; i++) {
      samples.push([
        (points() - 0.5) * 6,
        (points() - 0.5) * 6,
        (points() - 0.5) * 6,
      ]);
    }
    for (const type of ["julian", "juliascope", "curl"] as const) {
      const implicit = composeVariations([{ type, weight: 2 }]);
      const explicit = composeVariations([
        {
          type,
          weight: 2,
          ...(type === "curl"
            ? { curlC1: 1, curlC2: 0 }
            : type === "julian"
              ? { julianPower: 1, julianDist: 1 }
              : { juliascopePower: 1, juliascopeDist: 1 }),
        },
      ]);
      if (!implicit || !explicit) {
        throw new Error(`expected both blends for ${type}`);
      }
      for (const [x, y, z] of samples) {
        // Identically-seeded RNGs: the julia types each consume one draw.
        const a = implicit(x, y, z, mulberry32(99));
        const b = explicit(x, y, z, mulberry32(99));
        expect(b[0]).toBe(a[0]);
        expect(b[1]).toBe(a[1]);
        expect(b[2]).toBe(a[2]);
      }
    }
  });

  it("returns the SHARED classic function object at classic parameters — the fold early-return pattern reproduced", () => {
    const classic = juliaVariationFn("julian", CLASSIC_JULIA_PARAMS);
    const blend = composeVariations([{ type: "julian", weight: 1 }]);
    if (!blend) throw new Error("expected a blend");
    // Both go through the registry's shared entry at classic params; the
    // document runs the same function, not merely the same numbers. Pinned
    // behaviorally (the object is internal): same branch choice, same
    // values, same rng consumption.
    const a = classic(1.5, -0.5, 0.25, mulberry32(7));
    const b = blend(1.5, -0.5, 0.25, mulberry32(7));
    expect(b).toEqual(a);
    // Classic curl is the complex reciprocal (x+iy)/(1+z) — at (1, -2):
    // re = 2, im = -2, r = 1/8 → (0.75, -0.25), z carried.
    const curlClassic = curlVariationFn(CLASSIC_CURL_PARAMS);
    const [cx, cy, cz] = curlClassic(1, -2, 0.5, Math.random);
    expect(cx).toBeCloseTo(0.75, 10);
    expect(cy).toBeCloseTo(-0.25, 10);
    expect(cz).toBe(0.5);
  });

  it("julian at power 2 dist 1 is the two-valued julia map: half angle plus a branch per sector", () => {
    const blend = composeVariations([
      { type: "julian", weight: 1, julianPower: 2 },
    ]);
    if (!blend) throw new Error("expected a blend");
    // t = trunc(2 * rand01): rand < 0.5 picks sector 0, rand >= 0.5 sector 1.
    // At (1, 0), sector 0: theta = atan2/2 = 0, r = 1^(1/4) = 1.
    const [x0, y0] = blend(1, 0, 0, () => 0.4);
    expect(x0).toBeCloseTo(1, 12);
    expect(y0).toBeCloseTo(0, 12);
    // Sector 1: theta = (0 + 2pi)/2 = pi → (-1, 0).
    const [x1, y1] = blend(1, 0, 0, () => 0.6);
    expect(x1).toBeCloseTo(-1, 12);
    expect(y1).toBeCloseTo(0, 12);
  });

  it("juliascope flips the input angle's sign on odd branches (flam3 var33's parity)", () => {
    const blend = composeVariations([
      { type: "juliascope", weight: 1, juliascopePower: 2 },
    ]);
    if (!blend) throw new Error("expected a blend");
    // (0.5, 0.5): planar radius √0.5, atan2 = π/4. Even t keeps +atan2:
    // theta = (0 + π/4)/2 = π/8. Odd t flips: theta = (2π − π/4)/2 = 7π/8.
    const r = Math.pow(0.5, 0.25); // (x²+y²)^(dist/(2·power)) = 0.5^(1/4)
    const [x0, y0] = blend(0.5, 0.5, 0, () => 0.4);
    expect(x0).toBeCloseTo(r * Math.cos(Math.PI / 8), 12);
    expect(y0).toBeCloseTo(r * Math.sin(Math.PI / 8), 12);
    const [x1, y1] = blend(0.5, 0.5, 0, () => 0.6);
    expect(x1).toBeCloseTo(r * Math.cos((7 * Math.PI) / 8), 12);
    expect(y1).toBeCloseTo(r * Math.sin((7 * Math.PI) / 8), 12);
  });

  it("julian's radius is (x²+y²)^(dist/(2·power)): dist 2, power 2 keeps the planar radius", () => {
    // dist/(2*power) = 2/4 = 0.5, applied to x²+y² = 16: r = 4 — the
    // planar radius itself (r¹), since the exponent addresses the SQUARED
    // radius. At (4, 0), sector 0: theta = 0.
    const blend = composeVariations([
      { type: "julian", weight: 1, julianPower: 2, julianDist: 2 },
    ]);
    if (!blend) throw new Error("expected a blend");
    const [x] = blend(4, 0, 0, () => 0.4);
    expect(x).toBeCloseTo(4, 12);
    // dist 4, power 2 doubles the radius exponent: r = 16^1 = 16.
    const wide = composeVariations([
      { type: "julian", weight: 1, julianPower: 2, julianDist: 4 },
    ]);
    if (!wide) throw new Error("expected a blend");
    const [wx] = wide(4, 0, 0, () => 0.4);
    expect(wx).toBeCloseTo(16, 10);
  });

  it("curl at classic params is the complex reciprocal (x+iy)/(1+z), and carries z through", () => {
    // (0,0): re = 1, im = 0 → (0, 0).
    expect(warp("curl", 0, 0, 0.75)).toEqual([0, 0, 0.75]);
    // (0,1): re = 1, im = 1 → (1+i)/(1) rotated... compute directly:
    // r = 1/(1+1) = 0.5; x' = (0*1 + 1*1)*0.5 = 0.5; y' = (1*1 - 0*1)*0.5 = 0.5.
    const [x, y, z] = warp("curl", 0, 1, 0.75);
    expect(x).toBeCloseTo(0.5, 12);
    expect(y).toBeCloseTo(0.5, 12);
    expect(z).toBe(0.75);
  });

  it("curl with authored coefficients matches the complex reciprocal expanded term for term", () => {
    const c1 = 0.5;
    const c2 = -1;
    const blend = composeVariations([
      { type: "curl", weight: 1, curlC1: c1, curlC2: c2 },
    ]);
    if (!blend) throw new Error("expected a blend");
    for (const [x, y] of [
      [0.3, -0.7],
      [2, 1],
      [-0.5, 0.25],
    ]) {
      const re = 1 + c1 * x + c2 * (x * x - y * y);
      const im = c1 * y + 2 * c2 * x * y;
      // The implementation's divisor carries the module's EPS floor
      // (totality at the one exactly-singular input); the expectation
      // includes it so the pin is exact, not approximate.
      const r = 1 / (re * re + im * im + 1e-12);
      const [ox, oy] = blend(x, y, 0, Math.random);
      expect(ox).toBeCloseTo((x * re + y * im) * r, 12);
      expect(oy).toBeCloseTo((y * re - x * im) * r, 12);
    }
  });

  it("never produces NaN or Infinity across a grid of julia/curl parameters and points, including the origin", () => {
    const paramSets: Partial<Variation>[] = [
      {},
      { julianPower: 0 },
      { julianPower: -2, julianDist: -1 },
      { julianPower: 1e6, julianDist: 1e6 },
      { juliascopePower: 0.5, juliascopeDist: 0 },
      { curlC1: -5, curlC2: 5 },
      { curlC1: NaN, curlC2: Infinity },
      { julianPower: NaN, julianDist: Infinity },
    ];
    const points: [number, number, number][] = [
      [0, 0, 0],
      [1e6, 0, 0],
      [0, 1e6, -1e6],
      [1, 2, -3],
      [-0.5, 0.5, 0.25],
      [-1, 0, 0], // curl classic's exact zero-divisor point in flam3
    ];
    for (const type of ["julian", "juliascope", "curl"] as const) {
      for (const params of paramSets) {
        const blend = composeVariations([{ type, weight: 1, ...params }]);
        if (blend === null) continue;
        for (const [x, y, z] of points) {
          for (const c of blend(x, y, z, () => 0.5)) {
            expect(Number.isFinite(c)).toBe(true);
          }
        }
      }
    }
  });
});
