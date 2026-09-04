import type { Rng } from "./rng";
import type { Variation, VariationType, Vec3 } from "./types";
import { clamp } from "./vec";

/**
 * A nonlinear variation: it maps the point produced by a transform's affine
 * part to a warped point. Borrowed from Draves & Reckase's fractal flame
 * algorithm, where a "variation" is a fixed function `V(x, y)` applied after the
 * affine map. Most ignore the {@link Rng}; the stochastic ones (e.g. `julia`)
 * draw from it, so every variation takes it for a uniform signature.
 *
 * The classic variations are planar. Here each is generalised to 3-D under a
 * consistent scheme: the *radial* warps (`spherical`, `bubble`) and `swirl` use
 * the full 3-D radius `x²+y²+z²`, so depth genuinely participates; the *angular*
 * warps (`polar`, `handkerchief`, `heart`, `disc`, `spiral`, `julia`) act in the
 * xy-plane — angle `θ = atan2(y, x)`, planar radius `√(x²+y²)` — and carry `z`
 * through unchanged, warping every z-slice the same way. The *fold* warps
 * (`boxfold`, `spherefold`, `mandelbox`) are natively 3-D: per-axis plane
 * reflections and a full-3D-radius ball inversion, the Mandelbox's two
 * moves — the Mandelbox itself due to Tom Lowe ("tglad"), who introduced it
 * on fractalforums in 2010.
 */
export type VariationFn = (x: number, y: number, z: number, rng: Rng) => Vec3;

/**
 * Small floor added to divisors that could otherwise be zero at the origin, so
 * every variation is total (never NaN/Inf) on finite input. A point that lands
 * exactly where a warp diverges is pushed to a large-but-finite spot, which the
 * chaos game's escape check then reseeds — far better than a NaN poisoning the
 * whole orbit.
 */
const EPS = 1e-12;

/** 2π, restated here (the file carries no angle constants today) for the
 * julia family's branch sweep and its WGSL mirrors' shared convention. */
const TWO_PI = Math.PI * 2;

/**
 * One axis of the Mandelbox box fold: reflect `t` back off the `|t| = 1`
 * planes. `2·clamp(t, −1, 1) − t` is the branchless closed form — inside the
 * box it is the identity (`2t − t`), outside it mirrors inward (`±2 − t`),
 * continuous at the fold planes. Shared by `boxfold` and `mandelbox`;
 * `variations4.ts` duplicates it under the twin-file convention.
 */
const foldAxis = (t: number) => 2 * clamp(t, -1, 1) - t;

/**
 * The Mandelbox sphere-fold scale factor for a squared radius: `fR²/clamp(r²,
 * mR², fR²)` with the classic minimum radius `mR² = 0.25` and fixed radius
 * `fR² = 1`. Points inside the small ball inflate ×4, the mid shell inverts
 * (`1/r²`), everything at or beyond the unit sphere passes through unchanged.
 * The clamp floor doubles as the EPS guard (the divisor is never below 0.25),
 * so the fold is total with no explicit epsilon.
 */
const sphereFoldFactor = (r2: number) => 1 / clamp(r2, 0.25, 1);

/* ---- the fold's three lengths ------------------------------------- */

/** The sphere fold's classic minimum radius `mR`. An absent
 * {@link Variation.minRadius} is exactly this. */
export const SPHERE_FOLD_MIN_RADIUS = 0.5;

/** The sphere fold's classic fixed radius `fR`. An absent
 * {@link Variation.fixedRadius} is exactly this. */
export const SPHERE_FOLD_FIXED_RADIUS = 1;

/** The box fold's classic reflection plane. An absent
 * {@link Variation.boxLimit} is exactly this. */
export const BOX_FOLD_LIMIT = 1;

/**
 * Smallest `fixedRadius` (and `boxLimit`) the fold arithmetic will work in.
 * Anything below it — including 0 and every non-finite value — resolves to
 * the classic length instead, which is what keeps `fR² > 0` and so keeps the
 * sphere fold's division total (this module's stated guarantee).
 */
const FOLD_MIN_LENGTH = 1e-6;

/**
 * Floor on `minRadius / fixedRadius`, i.e. a ceiling of `1e12` on the
 * magnification `fR²/mR²`. RELATIVE and not absolute on purpose: the whole
 * fold family is equivariant under a uniform rescale of its three lengths,
 * and an absolute floor would break that equivariance for small apparatus
 * sizes — a rescaled system would stop being the same shape.
 */
const FOLD_MIN_RADIUS_RATIO = 1e-6;

/** A fold's three lengths, resolved: never absent, never non-finite, and
 * always ordered `0 < minRadius <= fixedRadius`. */
export interface FoldRadii {
  /** `mR` — the sphere fold's minimum radius. */
  minRadius: number;
  /** `fR` — the sphere fold's fixed radius. */
  fixedRadius: number;
  /** The box fold's reflection plane, `|t| = boxLimit`. */
  boxLimit: number;
}

/** The classic Mandelbox lengths, shared so a caller can compare against the
 * default set by identity rather than by re-typing three numbers. */
export const CLASSIC_FOLD_RADII: FoldRadii = {
  minRadius: SPHERE_FOLD_MIN_RADIUS,
  fixedRadius: SPHERE_FOLD_FIXED_RADIUS,
  boxLimit: BOX_FOLD_LIMIT,
};

/**
 * A variation's fold lengths, with absent and out-of-domain values resolved —
 * THE ONE PLACE the "absent means classic" rule from {@link Variation} is
 * written down. Every forward fold, every inverse-branch estimator and every
 * eligibility gate reads its lengths from here, so none of them can disagree
 * about what an under-specified document means.
 *
 * The domain it enforces, and why each part is not merely defensive:
 * - `fixedRadius` below {@link FOLD_MIN_LENGTH} (0, negative, NaN, absent)
 *   falls back to the classic length. `fR² = 0` would make the sphere fold's
 *   divisor zero, and this module promises totality on finite input.
 * - `minRadius` is clamped into `[fixedRadius · FOLD_MIN_RADIUS_RATIO,
 *   fixedRadius]`. The upper end is the fold's own domain: at `mR = fR` the
 *   mid shell closes and the fold is exactly the identity, and past it the
 *   inversion would run backwards. The lower end keeps the magnification —
 *   which is the sphere fold's Lipschitz bound, and therefore an input to
 *   `surface-de.ts`'s contraction gate — finite.
 * - `boxLimit` below zero or non-finite falls back to the classic length.
 *   Zero itself is kept: `2·clamp(t, 0, 0) − t = −t` is a point reflection,
 *   total and a legitimate (if extreme) authored fold.
 *
 * Clamping rather than rejecting is what keeps a MORPH continuous: `mR` and
 * `fR` interpolate independently, and a path that would cross `mR = fR`
 * arrives at the identity fold and stays there, with no jump in the rendered
 * point.
 */
export function resolveFoldRadii(v: Variation): FoldRadii {
  const fixedRadius =
    Number.isFinite(v.fixedRadius) &&
    (v.fixedRadius as number) >= FOLD_MIN_LENGTH
      ? (v.fixedRadius as number)
      : SPHERE_FOLD_FIXED_RADIUS;
  const minRadius = Number.isFinite(v.minRadius)
    ? clamp(
        v.minRadius as number,
        fixedRadius * FOLD_MIN_RADIUS_RATIO,
        fixedRadius,
      )
    : Math.min(SPHERE_FOLD_MIN_RADIUS, fixedRadius);
  const boxLimit =
    Number.isFinite(v.boxLimit) && (v.boxLimit as number) >= 0
      ? (v.boxLimit as number)
      : BOX_FOLD_LIMIT;
  return { minRadius, fixedRadius, boxLimit };
}

/** Are these the classic lengths — i.e. does this fold render exactly as it
 * did before the fields existed? The forward and inverse paths both branch on
 * it to take their ORIGINAL code, so "absent is byte-identical" holds by
 * construction rather than by an argument about floating point. */
export function isClassicFoldRadii(r: FoldRadii): boolean {
  return (
    r.minRadius === SPHERE_FOLD_MIN_RADIUS &&
    r.fixedRadius === SPHERE_FOLD_FIXED_RADIUS &&
    r.boxLimit === BOX_FOLD_LIMIT
  );
}

/**
 * The sphere fold's forward Lipschitz bound: the magnification `fR²/mR²`.
 *
 * It is attained on the inner ball, where the fold is that exact linear
 * scaling, and the mid inversion's local scale `fR²/|x|²` peaks at the same
 * value on the shell's inner edge `|x| = mR` — so the bound is tight, not
 * merely valid. The outer branch is the identity, and the BOX fold's
 * per-axis reflections are isometries at any `boxLimit`, so this is also the
 * bound for the `mandelbox` composite: the box wall does not enter it.
 *
 * This is the expression `surface-de.ts`'s contraction gate multiplies by
 * `|w|·sigma_max(M)`, and — as the deliberate complement — the one
 * `escape-de.ts` tests for expansion, so the fold's own radii move the seam
 * between the two render modes with them — how far is tabulated in
 * `scripts/spherefold-radius-sweep.harness.ts`.
 */
export function sphereFoldLipschitz(r: FoldRadii): number {
  return (r.fixedRadius * r.fixedRadius) / (r.minRadius * r.minRadius);
}

/**
 * The three fold warps at arbitrary lengths — {@link VARIATIONS}'s
 * `boxfold`/`spherefold`/`mandelbox` entries with their constants lifted out.
 * Returns the SHARED classic entry when the lengths are classic, so an
 * unparameterized document does not merely compute the same numbers, it runs
 * the same function.
 */
export function foldVariationFn(
  type: "boxfold" | "spherefold" | "mandelbox",
  r: FoldRadii,
): VariationFn {
  if (isClassicFoldRadii(r)) return VARIATIONS[type];
  const { boxLimit: wall } = r;
  const mR2 = r.minRadius * r.minRadius;
  const fR2 = r.fixedRadius * r.fixedRadius;
  const axis = (t: number) => 2 * clamp(t, -wall, wall) - t;
  const factor = (r2: number) => fR2 / clamp(r2, mR2, fR2);
  if (type === "boxfold") {
    return (x, y, z) => [axis(x), axis(y), axis(z)];
  }
  if (type === "spherefold") {
    return (x, y, z) => {
      const c = factor(x * x + y * y + z * z);
      return [x * c, y * c, z * c];
    };
  }
  return (x, y, z) => {
    const bx = axis(x);
    const by = axis(y);
    const bz = axis(z);
    const c = factor(bx * bx + by * by + bz * bz);
    return [bx * c, by * c, bz * c];
  };
}

/** The fold family, as a type guard — the variations that read
 * {@link FoldRadii}. Everything else ignores the three fields entirely. */
export function isFoldVariationType(
  type: VariationType,
): type is "boxfold" | "spherefold" | "mandelbox" {
  return type === "boxfold" || type === "spherefold" || type === "mandelbox";
}

/* ---- the parametric julia family and curl --------------------------- */

/** The julian/juliascope classic power. An absent `Variation.julianPower`
 * (or `juliascopePower`) is exactly this — flam3's own param default
 * (`variations.c`'s julian/juliascope init). */
export const CLASSIC_JULIA_POWER = 1;

/** The julian/juliascope classic distance exponent. An absent
 * `Variation.julianDist` (or `juliascopeDist`) is exactly this. */
export const CLASSIC_JULIA_DIST = 1;

/** The curl classic real coefficient. An absent `Variation.curlC1` is
 * exactly this — flam3's own default, a well-defined complex reciprocal. */
export const CLASSIC_CURL_C1 = 1;

/** The curl classic anti-holomorphic coefficient. An absent
 * `Variation.curlC2` is exactly this — flam3's default curl is a pure c1
 * term. */
export const CLASSIC_CURL_C2 = 0;

/**
 * Smallest `|power|` the julia machinery works in. Anything below it —
 * including 0 and every non-finite value — resolves to the classic power
 * instead. This is not merely defensive: the output angle divides by
 * `power`, so at `power = 0` the angle itself explodes, and near-zero
 * powers send `2πt/power` and the radius exponent `dist/(2·power)` to
 * garbage. flam3 has no such guard (its params arrive pre-validated);
 * ours lives here so every consumer — CPU blend, GPU lane packer, morph,
 * mutation — inherits one domain. Exported because mutate-system's power
 * jitter clamps at the resolver's own floor rather than re-typing it.
 */
export const JULIA_POWER_FLOOR = 1e-6;

/** The julian/juliascope parameters, resolved: never absent, never
 * non-finite, `power` never smaller in magnitude than 1e-6. */
export interface JuliaParams {
  /** The angular copy count and angle divisor. */
  power: number;
  /** The radius exponent's numerator. */
  dist: number;
}

/** The curl parameters, resolved: never absent, never non-finite. */
export interface CurlParams {
  /** The holomorphic coefficient. */
  c1: number;
  /** The anti-holomorphic coefficient. */
  c2: number;
}

/** The classic parameter sets, shared so a caller can compare against the
 * defaults by identity rather than by re-typing the numbers. */
export const CLASSIC_JULIA_PARAMS: JuliaParams = {
  power: CLASSIC_JULIA_POWER,
  dist: CLASSIC_JULIA_DIST,
};
export const CLASSIC_CURL_PARAMS: CurlParams = {
  c1: CLASSIC_CURL_C1,
  c2: CLASSIC_CURL_C2,
};

/**
 * A julia-family variation's power and dist, with absent and out-of-domain
 * values resolved — THE ONE PLACE the "absent means classic" rule for
 * {@link Variation.julianPower}/`julianDist`/`juliascopePower`/
 * `juliascopeDist` is written down. Both julia types share identical
 * machinery, so one resolver serves both: the TYPE says which FIELDS to
 * read (flam3's params are per-variation wire attributes, so the document
 * stores them under the type's own names) while the resolved SHAPE is the
 * same. Every consumer — the CPU blend, both WGSL lane packers, the
 * `.flame` import/export and the UI rows — reads its values from here, so
 * none of them can disagree about what an under-specified document means.
 *
 * The domain it enforces, and why each part is not merely defensive:
 * - `power` below 1e-6 in magnitude (0, sub-float noise, NaN, absent) falls
 *   back to the classic 1. The angle division is the reason — see
 *   {@link JULIA_POWER_FLOOR} — and the FALLBACK (rather than a clamp) is
 *   what keeps a morph that would cross power 0 from hanging on a
 *   degenerate frame: the value crosses into the classic map and stays
 *   there, continuous in the rendered point the way `resolveFoldRadii`'s
 *   clamp is.
 * - `dist` is kept for any finite value. 0 is a unit ring (every point maps
 *   onto the unit circle — total, and a legitimate authored shape);
 *   negative values invert the radius power exactly as flam3's real-valued
 *   dist does. The one degenerate corner, `x = y = 0` with a NEGATIVE
 *   exponent (`dist / (2·power) < 0`), sends `0^negative` to `+Infinity` —
 *   flam3's own behavior, and the chaos game's escape-reseed catches an
 *   infinite landing exactly as it catches a large-but-finite one.
 */
export function resolveJuliaParams(
  type: "julian" | "juliascope",
  v: Variation,
): JuliaParams {
  const rawPower = type === "julian" ? v.julianPower : v.juliascopePower;
  const rawDist = type === "julian" ? v.julianDist : v.juliascopeDist;
  return {
    power:
      Number.isFinite(rawPower) &&
      Math.abs(rawPower as number) >= JULIA_POWER_FLOOR
        ? (rawPower as number)
        : CLASSIC_JULIA_POWER,
    dist: Number.isFinite(rawDist) ? (rawDist as number) : CLASSIC_JULIA_DIST,
  };
}

/**
 * A curl variation's c1/c2, with absent and out-of-domain values resolved —
 * the curl twin of {@link resolveJuliaParams}. Both coefficients accept any
 * finite value: at the classic c1 = 1, c2 = 0 the map is the complex
 * reciprocal `(x+iy) / (1 + z)`, well-defined everywhere the module's own
 * EPS floor reaches; c1 = 0 is a pure c2 term and equally total (the
 * divisor below carries the same EPS floor `spherical` and `horseshoe`
 * carry, so the one exactly-singular input flam3 would divide by zero on —
 * `re = im = 0` — pushes to a large-but-finite spot instead).
 */
export function resolveCurlParams(v: Variation): CurlParams {
  return {
    c1: Number.isFinite(v.curlC1) ? (v.curlC1 as number) : CLASSIC_CURL_C1,
    c2: Number.isFinite(v.curlC2) ? (v.curlC2 as number) : CLASSIC_CURL_C2,
  };
}

/** Are these the classic parameters — i.e. does this julia variation render
 * exactly as it would with the fields absent? The blend branches on it to
 * return the ORIGINAL shared function object, so "absent is byte-identical"
 * holds by construction rather than by an argument about floating point. */
export function isClassicJuliaParams(p: JuliaParams): boolean {
  return p.power === CLASSIC_JULIA_POWER && p.dist === CLASSIC_JULIA_DIST;
}

/** {@link isClassicJuliaParams}' curl twin. */
export function isClassicCurlParams(p: CurlParams): boolean {
  return p.c1 === CLASSIC_CURL_C1 && p.c2 === CLASSIC_CURL_C2;
}

/**
 * The parametric julia family and curl, as a type guard — the variations
 * that read the parameters resolved by
 * {@link resolveJuliaParams}/{@link resolveCurlParams}. Everything else
 * ignores the six fields entirely. This is the guard the fold family's
 * {@link isFoldVariationType} role is to the folds: the packers, the UI
 * rows and the analyzers gate on it, so a parametric variation's params can
 * never be silently ignored at a site that still thinks in
 * type -> weight maps.
 */
export type ParametricVariationType = "julian" | "juliascope" | "curl";

export function isParametricVariationType(
  type: VariationType,
): type is ParametricVariationType {
  return type === "julian" || type === "juliascope" || type === "curl";
}

/**
 * The ACTIVE parametric entries' types, in list order — the eligibility
 * gates' named-refusal helper. Each Surface/escape/bulb analyzer keeps its
 * own private whitelist of estimable warps, so a parametric one is refused
 * by default; this helper lets each refusal NAME what it refuses
 * (`surface-eligibility.ts`'s qsquare-hint precedent) instead of the
 * generic "uses variations" that leaves the reader guessing which warp.
 * "Active" is `composeVariations`' filter (finite, nonzero weight), the
 * same criterion the analyzers already apply.
 */
export function activeParametricVariationTypes(
  variations: Variation[] | undefined,
): ParametricVariationType[] {
  const out: ParametricVariationType[] = [];
  for (const v of variations ?? []) {
    if (
      isParametricVariationType(v.type) &&
      Number.isFinite(v.weight) &&
      v.weight !== 0 &&
      !out.includes(v.type)
    ) {
      out.push(v.type);
    }
  }
  return out;
}

/**
 * The julian/juliascope warps at arbitrary parameters — {@link VARIATIONS}'s
 * two julia entries with their constants lifted out. Both apply the SAME
 * complex-power machinery to the input's xy-plane (flam3's var31/var33
 * verbatim semantics):
 *
 *     t     = trunc(|power| · rand01)                    — one RNG draw
 *     theta = (atan2(y, x) + 2π·t) / power               (julian)
 *     theta = (2π·t ± atan2(y, x)) / power, sign by
 *             branch parity: even t keeps +atan2, odd flips to −atan2
 *                                                            (juliascope)
 *     r     = (x² + y²)^(dist / (2·power))
 *
 * The weight multiplies OUTSIDE the function (`composeVariations`' blend),
 * the existing registry convention — so `r` carries no `w` here. Returns
 * the SHARED classic entry when the parameters are classic, so an
 * unparameterized document does not merely compute the same numbers, it
 * runs the same function — {@link foldVariationFn}'s early-return pattern
 * reproduced for the parametric family.
 */
export function juliaVariationFn(
  type: "julian" | "juliascope",
  p: JuliaParams,
): VariationFn {
  if (isClassicJuliaParams(p)) return VARIATIONS[type];
  const { power, dist } = p;
  return (x, y, z, rng) => {
    const t = Math.trunc(Math.abs(power) * rng());
    const a = Math.atan2(y, x);
    const theta =
      type === "julian"
        ? (a + TWO_PI * t) / power
        : (TWO_PI * t + (t % 2 === 0 ? a : -a)) / power;
    const r = Math.pow(x * x + y * y, dist / (2 * power));
    return [r * Math.cos(theta), r * Math.sin(theta), z];
  };
}

/**
 * The curl warp at arbitrary coefficients — flam3's var46 verbatim: the
 * complex reciprocal `(x+iy) / (1 + c1·z + c2·z²)` expanded into real
 * arithmetic over the input's xy-plane,
 *
 *     re = 1 + c1·x + c2·(x² − y²)
 *     im = c1·y + 2·c2·x·y
 *     r  = w / (re² + im²)          — weight outside, per the registry
 *     x' = (x·re + y·im)·r,  y' = (y·re − x·im)·r
 *
 * The divisor carries the module's own EPS floor (the `spherical`/
 * `horseshoe` convention): at the classic c1 = 1, c2 = 0 the exact
 * reciprocal's `re² + im²` vanishes at exactly (−1, 0), and an EPS-floor is
 * what keeps this module's totality promise there rather than a flam3-
 * faithful 1/0. Returns the SHARED classic entry at classic parameters.
 */
export function curlVariationFn(p: CurlParams): VariationFn {
  if (isClassicCurlParams(p)) return VARIATIONS.curl;
  const { c1, c2 } = p;
  return (x, y, z) => {
    const re = 1 + c1 * x + c2 * (x * x - y * y);
    const im = c1 * y + 2 * c2 * x * y;
    const r = 1 / (re * re + im * im + EPS);
    return [(x * re + y * im) * r, (y * re - x * im) * r, z];
  };
}

/** The parametric family's blend dispatch — {@link composeVariations}' and
 * {@link composeVariations4}'s shared second arm beside the fold family's:
 * resolves ONCE per compose, never per plotted point, and returns the
 * shared classic function object when nothing was authored. */
export function parametricVariationFn(
  type: ParametricVariationType,
  v: Variation,
): VariationFn {
  if (type === "curl") return curlVariationFn(resolveCurlParams(v));
  return juliaVariationFn(type, resolveJuliaParams(type, v));
}

/**
 * The White/Nylander triplex 8th power — the Mandelbulb's map.
 * The "triplex" product is the spherical-coordinate one, `(r, θ, φ) · (r',
 * θ', φ') = (r·r', θ+θ', φ+φ')` with `z` as the polar axis, so the 8th power
 * is `(r, θ, φ) ↦ (r⁸, 8θ, 8φ)`:
 *
 *     x' = r⁸·sin(8θ)·cos(8φ)   y' = r⁸·sin(8θ)·sin(8φ)   z' = r⁸·cos(8θ)
 *     cos θ = z/r,  ρ = √(x²+y²),  (cos φ, sin φ) = (x, y)/ρ
 *
 * Written WITHOUT trigonometry, which is an exact rewrite and not an
 * approximation: `cos 8θ` and `sin 8θ / sin θ` are the Chebyshev polynomials
 * `T₈`/`U₇` evaluated at `cos θ` (homogenised here so no division by `r`
 * appears), and `(cos 8φ, sin 8φ)` is the 8th power of the unit complex
 * number `(x + iy)/ρ` — de Moivre, three squarings. Measured: the estimator
 * built on it (`bulb-de.ts`) runs ~11x cheaper than the same loop with the
 * trigonometric form, and the two agree to 6e-14 relative — f64 rounding —
 * over 200k queries (`bulb-de.test.ts` pins the agreement;
 * `scripts/bulb-preview.harness.ts` is the measurement).
 *
 * NOT an algebra: triplex multiplication is neither associative nor
 * distributive, so `p⁸` means this closed form and nothing else — in
 * particular it is NOT `((p²)²)²`. Squaring three times re-canonicalises the
 * polar angle into `[0, π]` at every step and flips the azimuth by π
 * whenever it leaves, which renders a DIFFERENT object — measured: the two
 * disagree on 48.8% of a uniform query set, and the harness keeps the
 * squaring as the refutation's executable record. That non-associativity is
 * also why the power is baked in rather than parameterised: every power
 * needs its own closed form (the harness renders 3, 5 and 12 from the
 * trigonometric reference, which is the only form that generalises).
 *
 * Total on all finite input. On the polar axis (`ρ = 0`) `sin θ = 0`, so the
 * `x'`/`y'` terms vanish and the reciprocal is replaced by 0 rather than
 * floored by an EPS — the azimuth is genuinely undefined there, not merely
 * ill-conditioned, and 0 is the value the limit takes from every direction.
 */
export function triplexPow8(x: number, y: number, z: number): Vec3 {
  const a = x * x + y * y; // ρ²
  const r2 = a + z * z;
  const z2 = z * z;
  const r4 = r2 * r2;
  // z' = r⁸·T₈(z/r) = 128z⁸ − 256z⁶r² + 160z⁴r⁴ − 32z²r⁶ + r⁸.
  const zOut =
    128 * z2 * z2 * z2 * z2 -
    256 * z2 * z2 * z2 * r2 +
    160 * z2 * z2 * r4 -
    32 * z2 * r4 * r2 +
    r4 * r4;
  // r⁸·sin(8θ) = ρ · r⁷·U₇(z/r) = ρ · (128z⁷ − 192z⁵r² + 80z³r⁴ − 8z·r⁶).
  const s =
    128 * z2 * z2 * z2 * z -
    192 * z2 * z2 * z * r2 +
    80 * z2 * z * r4 -
    8 * z * r4 * r2;
  const rho = Math.sqrt(a);
  const inv = rho > 0 ? 1 / rho : 0;
  // (cos 8φ, sin 8φ) = ((x + iy)/ρ)⁸ — three complex squarings.
  const u1 = x * inv;
  const v1 = y * inv;
  const u2 = u1 * u1 - v1 * v1;
  const v2 = 2 * u1 * v1;
  const u4 = u2 * u2 - v2 * v2;
  const v4 = 2 * u2 * v2;
  const u8 = u4 * u4 - v4 * v4;
  const v8 = 2 * u4 * v4;
  return [rho * s * u8, rho * s * v8, zOut];
}

/**
 * The variation registry: every {@link VariationType} mapped to its warp. Typed
 * as a total `Record`, so adding a name to `VARIATION_TYPES` without an
 * implementation here (or vice versa) fails to compile.
 */
const VARIATIONS: Record<VariationType, VariationFn> = {
  // The affine result, untouched — lets a map blend a linear component in with
  // its nonlinear ones (a pure `[{ linear, 1 }]` is exactly the old behaviour).
  linear: (x, y, z) => [x, y, z],

  // Fold each axis through a sine — space ripples into a tiled, wavy lattice.
  sinusoidal: (x, y, z) => [Math.sin(x), Math.sin(y), Math.sin(z)],

  // Inversion through the unit sphere: `p / |p|²`. Turns the interior inside out
  // and packs the exterior toward the origin — the signature flame "bubble".
  spherical: (x, y, z) => {
    const c = 1 / (x * x + y * y + z * z + EPS);
    return [x * c, y * c, z * c];
  },

  // Rotate about the z-axis by an angle equal to the (3-D) squared radius, so
  // shells at different depths and radii twist by different amounts.
  swirl: (x, y, z) => {
    const r2 = x * x + y * y + z * z;
    const s = Math.sin(r2);
    const c = Math.cos(r2);
    return [x * s - y * c, x * c + y * s, z];
  },

  // Opens the plane out like a horseshoe: angle doubled, radius kept. Applied
  // per z-slice, dividing by the planar radius.
  horseshoe: (x, y, z) => {
    const c = 1 / (Math.hypot(x, y) + EPS);
    return [c * (x - y) * (x + y), c * 2 * x * y, z];
  },

  // Unroll (θ, r) onto a strip: angle → x, radius → y. Straightens rings.
  polar: (x, y, z) => {
    const rp = Math.hypot(x, y);
    return [Math.atan2(y, x) / Math.PI, rp - 1, z];
  },

  // Waves that ripple outward with the radius — a fluttering "handkerchief".
  handkerchief: (x, y, z) => {
    const rp = Math.hypot(x, y);
    const t = Math.atan2(y, x);
    return [rp * Math.sin(t + rp), rp * Math.cos(t - rp), z];
  },

  // Pinches the plane into nested heart shapes.
  heart: (x, y, z) => {
    const rp = Math.hypot(x, y);
    const t = Math.atan2(y, x);
    return [rp * Math.sin(t * rp), -rp * Math.cos(t * rp), z];
  },

  // Wraps the plane onto a rippling disc — concentric arcs sweep by angle.
  disc: (x, y, z) => {
    const rp = Math.hypot(x, y);
    const t = Math.atan2(y, x) / Math.PI;
    const pr = Math.PI * rp;
    return [t * Math.sin(pr), t * Math.cos(pr), z];
  },

  // Sweeps points along spiralling arms (diverges near the origin, where the
  // EPS floor keeps it finite and the chaos game reseeds).
  spiral: (x, y, z) => {
    const rp = Math.hypot(x, y);
    const c = 1 / (rp + EPS);
    const t = Math.atan2(y, x);
    return [
      c * (Math.cos(t) + Math.sin(rp)),
      c * (Math.sin(t) - Math.cos(rp)),
      z,
    ];
  },

  // Maps all of space into a ball of radius 1 (`4/(r²+4)`): nested spheres.
  bubble: (x, y, z) => {
    const c = 4 / (x * x + y * y + z * z + 4);
    return [x * c, y * c, z * c];
  },

  // Half the angle plus a random half-turn and the square-rooted radius — the
  // two-valued map behind flame "julia" flowers. Draws one bit from the RNG.
  julia: (x, y, z, rng) => {
    const rq = Math.sqrt(Math.hypot(x, y));
    const t = Math.atan2(y, x) / 2 + (rng() < 0.5 ? 0 : Math.PI);
    return [rq * Math.cos(t), rq * Math.sin(t), z];
  },

  // The Mandelbox box fold: reflect each axis off the |t| = 1 planes. The
  // interior of the unit box passes through untouched; outside, points mirror
  // inward — the crease that grows box-lattice structure.
  boxfold: (x, y, z) => [foldAxis(x), foldAxis(y), foldAxis(z)],

  // The Mandelbox sphere fold (ball inversion) — see `sphereFoldFactor`.
  spherefold: (x, y, z) => {
    const c = sphereFoldFactor(x * x + y * y + z * z);
    return [x * c, y * c, z * c];
  },

  // The full Mandelbox step, `sphereFold(boxFold(p))`, as ONE variation:
  // blending is a weighted SUM, so no combination of `boxfold` and
  // `spherefold` entries can express the composition — it has to be its own
  // function. The variation weight is the classic scale `s` in
  // `s·sphereFold(boxFold(p))` (weight 2 = the canonical Mandelbox step), and
  // the transform's affine part supplies the rotation/translation.
  mandelbox: (x, y, z) => {
    const bx = foldAxis(x);
    const by = foldAxis(y);
    const bz = foldAxis(z);
    const c = sphereFoldFactor(bx * bx + by * by + bz * bz);
    return [bx * c, by * c, bz * c];
  },

  // The quaternion square with `x` as the REAL part and `(y, z)` as `(i, j)`
  // — the `w = 0` restriction of `variations4.ts`'s full `q²`. The subalgebra
  // `span{1, i, j}` is closed under squaring (`ij + ji = 0` kills the `k`
  // term), so this is not a projection or a truncation: it is the exact 4D
  // map on the slice, which is what keeps the twin files bit-exact at
  // `w = 0`. Total on all finite input — no divisor, hence no EPS.
  //
  // Composed as `V(M v + t)`, a transform carrying this alone iterates
  // `v ← (v + t)²`, which is conjugate by translation to the classic Julia
  // form `q ← q² + c` with `c = t`. That conjugacy is what lets the
  // quaternion Julia set be a render mode over the existing document
  // vocabulary rather than a second document format — see `qjulia-de.ts`.
  qsquare: (x, y, z) => [x * x - y * y - z * z, 2 * x * y, 2 * x * z],

  // The White/Nylander triplex 8th power — see {@link triplexPow8} for the
  // formula, the trig-free rewrite and why the power is fixed. Composed as
  // `V(M v + t)` with the QUERY POINT re-added each iteration, this is the
  // map whose escape-time set is the Mandelbulb (`bulb-de.ts`); iterated
  // inside the chaos game it is simply a very sharp radial warp (`r⁸` sends
  // anything past the unit sphere away fast, which `chaos-game.ts`'s
  // ESCAPE_LIMIT reseed then catches, exactly as it does for `qsquare`).
  bulb: triplexPow8,

  // The three PARAMETRIC warps, at their classic parameters — the values
  // an absent params object resolves to ({@link resolveJuliaParams}/
  // {@link resolveCurlParams}). `julian`/`juliascope` share machinery, so
  // their entries are one shared body's two spellings: the branch sweep
  // `t = trunc(|power|·rand01)` (ONE RNG draw, like `julia`'s bit) over
  // `n = trunc(|power|)` sectors and the radius power `dist/(2·power)`,
  // with juliascope flipping the input angle's sign on odd branches (flam3's
  // var33) where julian keeps it. At the classic power 1 / dist 1 both
  // reduce to the weight-scaled identity in xy (t is always 0 — one draw,
  // one branch), which is why an unparameterized document was never able to
  // carry these types at all before the GPU lane existed. Parameterized
  // documents do NOT run these entries: `juliaVariationFn`/`curlVariationFn`
  // build the parameterized closures, and only the classic parameters
  // resolve back to these shared objects.
  //
  // julian at power 2, dist 1: theta = atan2/2 + π·t over t ∈ {0, 1} — the
  // two-valued julia map behind flame "juliaN" flowers.
  julian: (x, y, z, rng) => {
    const t = Math.trunc(Math.abs(CLASSIC_JULIA_POWER) * rng());
    const theta = (Math.atan2(y, x) + TWO_PI * t) / CLASSIC_JULIA_POWER;
    const r = Math.pow(
      x * x + y * y,
      CLASSIC_JULIA_DIST / (2 * CLASSIC_JULIA_POWER),
    );
    return [r * Math.cos(theta), r * Math.sin(theta), z];
  },

  juliascope: (x, y, z, rng) => {
    const t = Math.trunc(Math.abs(CLASSIC_JULIA_POWER) * rng());
    const a = Math.atan2(y, x);
    const theta = (TWO_PI * t + (t % 2 === 0 ? a : -a)) / CLASSIC_JULIA_POWER;
    const r = Math.pow(
      x * x + y * y,
      CLASSIC_JULIA_DIST / (2 * CLASSIC_JULIA_POWER),
    );
    return [r * Math.cos(theta), r * Math.sin(theta), z];
  },

  // The complex reciprocal `(x+iy) / (1 + c1·z + c2·z²)` (z = x + iy), at
  // flam3's own defaults c1 = 1, c2 = 0 — a gentle conformal swirl that
  // folds the plane toward the point (−1, 0), where the module's EPS floor
  // takes over from flam3's own 1/0 (see {@link curlVariationFn}). No RNG.
  // An xy-plane warp: carries the third coordinate through like the angular
  // warps do, which is what keeps the 4D lift bit-exact at w = 0.
  curl: (x, y, z) => {
    const re = 1 + CLASSIC_CURL_C1 * x + CLASSIC_CURL_C2 * (x * x - y * y);
    const im = CLASSIC_CURL_C1 * y + 2 * CLASSIC_CURL_C2 * x * y;
    const r = 1 / (re * re + im * im + EPS);
    return [(x * re + y * im) * r, (y * re - x * im) * r, z];
  },
};

/**
 * A transform's blended variation map, ready to apply to its affine output.
 * The returned `Vec3` is OWNED BY THE CLOSURE and overwritten in place on
 * every call — valid only until the next call on this SAME blend; copy
 * the components out before calling again if you need to keep them.
 */
export type VariationBlend = (
  x: number,
  y: number,
  z: number,
  rng: Rng,
) => Vec3;

/**
 * Compile a transform's {@link Variation} list into a single blend function, or
 * `null` when there is nothing to apply — no list, an empty list, or every
 * weight zero/non-finite. A `null` return is the fast path the chaos game uses
 * to keep purely-affine systems byte-for-byte identical to before.
 *
 * The blend is the weighted sum `Σ weight · V(type)` (flame semantics — weights
 * are free strengths, never normalised), evaluated left to right so a stochastic
 * variation consumes the RNG in list order.
 *
 * Allocation-free per call (measured 1.27-1.55x on 20M blend calls):
 * the fn/weight pairs are split into parallel arrays once here rather than a
 * `[fn, weight]` tuple list, and the returned closure accumulates into ONE
 * result array reused across calls — see {@link VariationBlend}'s reuse
 * contract.
 */
export function composeVariations(
  variations: Variation[] | undefined,
): VariationBlend | null {
  if (!variations || variations.length === 0) return null;
  const active = variations.filter(
    (v) => Number.isFinite(v.weight) && v.weight !== 0,
  );
  if (active.length === 0) return null;

  // The fold family reads its three lengths off the entry and the
  // parametric julia/curl family its own parameters; every other type is
  // the shared parameterless warp. Resolved here, ONCE per compose, never
  // per plotted point — and the classic branch returns the SHARED
  // parameterless function object in both families, so an unparameterized
  // document runs the same functions, not merely the same numbers. Parallel
  // arrays rather than a [fn, weight] tuple list, so the hot closure below
  // indexes two flat arrays instead of destructuring a tuple on every call.
  const fns: VariationFn[] = active.map((v) =>
    isFoldVariationType(v.type)
      ? foldVariationFn(v.type, resolveFoldRadii(v))
      : isParametricVariationType(v.type)
        ? parametricVariationFn(v.type, v)
        : VARIATIONS[v.type],
  );
  const weights: number[] = active.map((v) => v.weight);
  const n = fns.length;
  const out: Vec3 = [0, 0, 0];

  return (x, y, z, rng) => {
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let i = 0; i < n; i++) {
      const [vx, vy, vz] = fns[i](x, y, z, rng);
      const w = weights[i];
      ox += w * vx;
      oy += w * vy;
      oz += w * vz;
    }
    out[0] = ox;
    out[1] = oy;
    out[2] = oz;
    return out;
  };
}
