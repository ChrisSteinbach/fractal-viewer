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

  // The fold family reads its three lengths off the entry; every other
  // type is the shared parameterless warp. Resolved here, ONCE per
  // compose, never per plotted point. Parallel arrays rather than a
  // [fn, weight] tuple list, so the hot closure below indexes two flat
  // arrays instead of destructuring a tuple on every call.
  const fns: VariationFn[] = active.map((v) =>
    isFoldVariationType(v.type)
      ? foldVariationFn(v.type, resolveFoldRadii(v))
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
