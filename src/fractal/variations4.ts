import type { Rng } from "./rng";
import type { Variation, VariationType, Vec4 } from "./types";
import {
  CLASSIC_CURL_C1,
  CLASSIC_CURL_C2,
  CLASSIC_JULIA_DIST,
  CLASSIC_JULIA_POWER,
  isClassicCurlParams,
  isClassicFoldRadii,
  isClassicJuliaParams,
  isFoldVariationType,
  isParametricVariationType,
  resolveCurlParams,
  resolveFoldRadii,
  resolveJuliaParams,
} from "./variations";
import type {
  CurlParams,
  FoldRadii,
  JuliaParams,
  ParametricVariationType,
} from "./variations";
import { clamp } from "./vec";

/**
 * The 4D lift of the twenty nonlinear variation functions, the fourth
 * dimension raised over `variations.ts` by the SAME convention that file already
 * documents for its 2D → 3D lift — read that header first. One dimension up:
 *
 *   - **Angular warps** (`polar`, `handkerchief`, `heart`, `disc`, `spiral`,
 *     `julia`) act in the xy-plane — angle `θ = atan2(y, x)`, planar radius
 *     `√(x²+y²)` — and carry `z` AND `w` through unchanged, warping every
 *     (z, w)-slice the same way.
 *   - **Radial warps** (`spherical`, `bubble`) and `swirl` use the full 4-D
 *     radius `x²+y²+z²+w²`, so `w` genuinely participates; where the 3D code
 *     scales `z` by a radial factor, the 4D code scales `w` by that same factor.
 *   - **Fold warps** (`boxfold`, `spherefold`, `mandelbox`) treat `w` exactly
 *     like the spatial axes: the box fold reflects all four axes and the
 *     sphere fold inverts through the full 4-D radius.
 *   - **The parametric julia family and curl** (`julian`, `juliascope`,
 *     `curl`) are xy-plane warps — logarithmic spiral sector sweeps and a
 *     complex reciprocal read nothing but the planar angle and radius — so
 *     they lift like the angular warps: the EXACT 2D form applied to (x, y),
 *     with z AND w carried through. `bulb` already rode that same treatment.
 *   - `sinusoidal` folds each of the four axes through a sine; `linear` is the
 *     identity.
 *   - `qsquare` is the only entry whose 4D form is the DEFINITION and whose
 *     3D form is the restriction — the quaternions are natively 4D. `bulb`
 *     is the opposite extreme: triplex numbers have no 4D structure at all,
 *     so it warps `x, y, z` and carries `w` through, the angular warps'
 *     treatment of an axis their formula never mentions.
 *
 * ## The anchor property (the heart of the embed — see `embedTransform3`)
 *
 * At `w = 0` every lifted function reproduces its 3D counterpart EXACTLY and
 * returns `w' = 0`. Angular warps carry `w` through, so `w = 0 → w' = 0` and
 * their x/y/z outputs never involve `w` at all. Radial warps accumulate the
 * squared radius left-associated ending in `+ w*w` (`x*x + y*y + z*z + w*w`),
 * so at `w = 0` the final `+ 0` leaves the floating-point value BIT-identical to
 * the 3D expression `x*x + y*y + z*z` — hence identical `c`, identical x/y/z, and
 * `w' = w·c = 0`. Fold warps anchor the same way: `foldAxis(0) = 0` exactly, and
 * the sphere-fold radius ends in `+ w*w`. `bulb` carries `w` like an angular
 * warp and duplicates its x/y/z arithmetic term for term, and so do the three
 * parametric warps — all three read (x, y) alone. The equality is
 * exact (not merely close) for all twenty; the tests pin `toEqual`. That is what makes an
 * embedded 3D system's `w = 0` slice warp bit-for-bit like the native 3D path.
 */
export type VariationFn4 = (
  x: number,
  y: number,
  z: number,
  w: number,
  rng: Rng,
) => Vec4;

/**
 * Small floor added to divisors that could otherwise be zero at the origin, so
 * every variation is total (never NaN/Inf) on finite input. Identical to
 * `variations.ts`'s `EPS`, and placed at the SAME spot in each radius/hypot
 * expression, so the anchor property stays exact. See `variations.ts` for the
 * why (a point at a warp's singularity is pushed to a large-but-finite spot,
 * which the chaos game's escape check then reseeds — far better than a NaN).
 */
const EPS = 1e-12;

/** 2π — identical to `variations.ts`'s `TWO_PI` (duplicated under the
 * twin-file convention like `EPS`), so the julia family's branch arithmetic
 * stays term-for-term identical across the embed. */
const TWO_PI = Math.PI * 2;

/**
 * One axis of the Mandelbox box fold — identical arithmetic to
 * `variations.ts`'s `foldAxis` (duplicated under the twin-file convention, like
 * `EPS`), so the anchor property stays exact: `foldAxis(0) = 0` bit-exactly.
 */
const foldAxis = (t: number) => 2 * clamp(t, -1, 1) - t;

/**
 * The Mandelbox sphere-fold scale factor — identical arithmetic to
 * `variations.ts`'s `sphereFoldFactor` (classic `mR² = 0.25`, `fR² = 1`; the
 * clamp floor doubles as the EPS guard). Fed the 4-D squared radius written
 * left-associated ending in `+ w*w`, so at `w = 0` the factor is bit-identical
 * to the 3D one.
 */
const sphereFoldFactor = (r2: number) => 1 / clamp(r2, 0.25, 1);

/**
 * The three fold warps at arbitrary lengths — `variations.ts`'s
 * {@link foldVariationFn} one dimension up, and the twin-file convention's
 * one exception: the ARITHMETIC is duplicated as always, but the domain rule
 * ({@link resolveFoldRadii}) and the classic constants are IMPORTED, because
 * "what does an absent field mean" must have exactly one answer across both
 * dimensions or a 3D system and its 4D lift would render different objects.
 * Returns the shared classic entry at classic lengths, so a document that
 * predates the fields runs the same function it always did.
 */
function foldVariationFn4(
  type: "boxfold" | "spherefold" | "mandelbox",
  r: FoldRadii,
): VariationFn4 {
  if (isClassicFoldRadii(r)) return VARIATIONS4[type];
  const { boxLimit: wall } = r;
  const mR2 = r.minRadius * r.minRadius;
  const fR2 = r.fixedRadius * r.fixedRadius;
  const axis = (t: number) => 2 * clamp(t, -wall, wall) - t;
  const factor = (r2: number) => fR2 / clamp(r2, mR2, fR2);
  if (type === "boxfold") {
    return (x, y, z, w) => [axis(x), axis(y), axis(z), axis(w)];
  }
  if (type === "spherefold") {
    return (x, y, z, w) => {
      const c = factor(x * x + y * y + z * z + w * w);
      return [x * c, y * c, z * c, w * c];
    };
  }
  return (x, y, z, w) => {
    const bx = axis(x);
    const by = axis(y);
    const bz = axis(z);
    const bw = axis(w);
    const c = factor(bx * bx + by * by + bz * bz + bw * bw);
    return [bx * c, by * c, bz * c, bw * c];
  };
}

/**
 * The parametric julia family's two warps at arbitrary parameters —
 * `variations.ts`'s {@link juliaVariationFn} one dimension up, the
 * twin-file convention's second exception: the ARITHMETIC is duplicated as
 * always, but the domain rule ({@link resolveJuliaParams}) and the classic
 * constants are IMPORTED, exactly as the fold family's are — "what does an
 * absent field mean" must have one answer across both dimensions. The three
 * warps are xy-plane sweeps (planar angle and radius only), so the lift is
 * the angular warps': the 2D form on (x, y), z AND w carried through — and
 * the RNG draw count matches the 3D closure's exactly (one), which is what
 * keeps an embedded julia's branch bit identical to the native 3D path's.
 * Returns the shared classic entry at classic parameters.
 */
function juliaVariationFn4(
  type: "julian" | "juliascope",
  p: JuliaParams,
): VariationFn4 {
  if (isClassicJuliaParams(p)) return VARIATIONS4[type];
  const { power, dist } = p;
  return (x, y, z, w, rng) => {
    const t = Math.trunc(Math.abs(power) * rng());
    const a = Math.atan2(y, x);
    const theta =
      type === "julian"
        ? (a + TWO_PI * t) / power
        : (TWO_PI * t + (t % 2 === 0 ? a : -a)) / power;
    const r = Math.pow(x * x + y * y, dist / (2 * power));
    return [r * Math.cos(theta), r * Math.sin(theta), z, w];
  };
}

/**
 * The curl warp at arbitrary coefficients — {@link curlVariationFn} one
 * dimension up: the complex reciprocal over the input's xy-plane, z AND w
 * carried through, the divisor's EPS floor duplicated term for term so the
 * anchor property stays exact. Returns the shared classic entry at classic
 * coefficients.
 */
function curlVariationFn4(p: CurlParams): VariationFn4 {
  if (isClassicCurlParams(p)) return VARIATIONS4.curl;
  const { c1, c2 } = p;
  return (x, y, z, w) => {
    const re = 1 + c1 * x + c2 * (x * x - y * y);
    const im = c1 * y + 2 * c2 * x * y;
    const r = 1 / (re * re + im * im + EPS);
    return [(x * re + y * im) * r, (y * re - x * im) * r, z, w];
  };
}

/** The parametric family's blend dispatch one dimension up — the fold
 * family's own dispatcher shape beside {@link foldVariationFn4}: resolves
 * once per compose, never per plotted point. */
function parametricVariationFn4(
  type: ParametricVariationType,
  v: Variation,
): VariationFn4 {
  if (type === "curl") return curlVariationFn4(resolveCurlParams(v));
  return juliaVariationFn4(type, resolveJuliaParams(type, v));
}

/**
 * The 4D variation registry: every {@link VariationType} mapped to its lifted
 * warp. Typed as a total `Record`, so a name in `VARIATION_TYPES` without an
 * implementation here (or vice versa) fails to compile — the exact guard
 * `variations.ts`'s `VARIATIONS` carries, one dimension up.
 */
const VARIATIONS4: Record<VariationType, VariationFn4> = {
  // The affine result, untouched.
  linear: (x, y, z, w) => [x, y, z, w],

  // Fold each axis through a sine — now including w.
  sinusoidal: (x, y, z, w) => [
    Math.sin(x),
    Math.sin(y),
    Math.sin(z),
    Math.sin(w),
  ],

  // Inversion through the unit 3-sphere: `p / |p|²` with the full 4D radius.
  // Radius written `x*x + y*y + z*z + w*w + EPS` so at w = 0 it is bit-identical
  // to the 3D `x*x + y*y + z*z + EPS`.
  spherical: (x, y, z, w) => {
    const c = 1 / (x * x + y * y + z * z + w * w + EPS);
    return [x * c, y * c, z * c, w * c];
  },

  // Rotate in the xy-plane by an angle equal to the FULL 4D squared radius (the
  // 3D swirl uses the full 3D radius and carries z; here we carry z AND w).
  swirl: (x, y, z, w) => {
    const r2 = x * x + y * y + z * z + w * w;
    const s = Math.sin(r2);
    const c = Math.cos(r2);
    return [x * s - y * c, x * c + y * s, z, w];
  },

  // Horseshoe: angle doubled, planar radius kept. Applied per (z, w)-slice.
  horseshoe: (x, y, z, w) => {
    const c = 1 / (Math.hypot(x, y) + EPS);
    return [c * (x - y) * (x + y), c * 2 * x * y, z, w];
  },

  // Unroll (θ, r) onto a strip: angle → x, planar radius → y; z and w carried.
  polar: (x, y, z, w) => {
    const rp = Math.hypot(x, y);
    return [Math.atan2(y, x) / Math.PI, rp - 1, z, w];
  },

  // Waves rippling outward with the planar radius; z and w carried.
  handkerchief: (x, y, z, w) => {
    const rp = Math.hypot(x, y);
    const t = Math.atan2(y, x);
    return [rp * Math.sin(t + rp), rp * Math.cos(t - rp), z, w];
  },

  // Nested heart shapes in the xy-plane; z and w carried.
  heart: (x, y, z, w) => {
    const rp = Math.hypot(x, y);
    const t = Math.atan2(y, x);
    return [rp * Math.sin(t * rp), -rp * Math.cos(t * rp), z, w];
  },

  // Rippling disc — concentric arcs by angle in the xy-plane; z and w carried.
  disc: (x, y, z, w) => {
    const rp = Math.hypot(x, y);
    const t = Math.atan2(y, x) / Math.PI;
    const pr = Math.PI * rp;
    return [t * Math.sin(pr), t * Math.cos(pr), z, w];
  },

  // Spiralling arms in the xy-plane (diverges near the origin, where the EPS
  // floor keeps it finite and the chaos game reseeds); z and w carried.
  spiral: (x, y, z, w) => {
    const rp = Math.hypot(x, y);
    const c = 1 / (rp + EPS);
    const t = Math.atan2(y, x);
    return [
      c * (Math.cos(t) + Math.sin(rp)),
      c * (Math.sin(t) - Math.cos(rp)),
      z,
      w,
    ];
  },

  // Maps all of space into the unit 3-ball (`4/(r²+4)`) with the full 4D radius.
  // Radius written `… + w*w + 4` so at w = 0 it matches the 3D `… + z*z + 4`.
  bubble: (x, y, z, w) => {
    const c = 4 / (x * x + y * y + z * z + w * w + 4);
    return [x * c, y * c, z * c, w * c];
  },

  // Half the xy-angle plus a random half-turn and the square-rooted planar
  // radius; z and w carried. Draws ONE bit from the RNG, exactly like the 3D
  // julia (same draw count and order), so a seeded run is reproducible and an
  // embedded julia consumes the RNG identically to the 3D path.
  julia: (x, y, z, w, rng) => {
    const rq = Math.sqrt(Math.hypot(x, y));
    const t = Math.atan2(y, x) / 2 + (rng() < 0.5 ? 0 : Math.PI);
    return [rq * Math.cos(t), rq * Math.sin(t), z, w];
  },

  // The Mandelbox box fold with `w` folded like every spatial axis; at w = 0
  // the fourth output is foldAxis(0) = 0 exactly.
  boxfold: (x, y, z, w) => [foldAxis(x), foldAxis(y), foldAxis(z), foldAxis(w)],

  // The Mandelbox sphere fold through the full 4-D radius (`… + w*w` so the
  // w = 0 factor is bit-identical to 3D).
  spherefold: (x, y, z, w) => {
    const c = sphereFoldFactor(x * x + y * y + z * z + w * w);
    return [x * c, y * c, z * c, w * c];
  },

  // The full Mandelbox step `sphereFold(boxFold(p))` — see `variations.ts` for
  // why the composite must be its own variation (blending is a weighted sum).
  mandelbox: (x, y, z, w) => {
    const bx = foldAxis(x);
    const by = foldAxis(y);
    const bz = foldAxis(z);
    const bw = foldAxis(w);
    const c = sphereFoldFactor(bx * bx + by * by + bz * bz + bw * bw);
    return [bx * c, by * c, bz * c, bw * c];
  },

  // The quaternion square `q²` for `q = x + y·i + z·j + w·k` — `x` is the
  // REAL part. Writing `q = x + v` with `v` the vector part,
  // `q² = x² - |v|² + 2x·v` (the `v × v` term vanishes), which is the closed
  // form below. Anchors at `w = 0` the way this file requires: the fourth
  // output is `2xw = 0` exactly, and the first three collapse to
  // `variations.ts`'s `[x² - y² - z², 2xy, 2xz]` term for term, because
  // `span{1, i, j}` is closed under squaring.
  //
  // This is the only variation here whose 4D lift is the DEFINITION and whose
  // 3D form is the restriction, rather than the other way round — the
  // quaternions are natively 4D. See `qjulia-de.ts` for the escape-time set
  // it generates and why a transform's translation reads as the Julia
  // constant.
  qsquare: (x, y, z, w) => [
    x * x - y * y - z * z - w * w,
    2 * x * y,
    2 * x * z,
    2 * x * w,
  ],

  // The White/Nylander triplex 8th power (see `variations.ts`'s
  // `triplexPow8` for the formula), with `w` CARRIED THROUGH unchanged.
  //
  // This is the one entry whose lift is an admission rather than a
  // generalisation. `qsquare` above lifts because the quaternions ARE 4D and
  // the 3D form is their `w = 0` restriction; the fold and radial warps lift
  // because a 4th axis and a 4-radius are well defined. Triplex numbers are
  // none of that — they are R³ with a spherical-coordinate product that is
  // neither associative nor distributive, defined by the two angles a point
  // in THREE dimensions has. There is no fourth angle to add, and inventing
  // one (say, powering a quaternion's polar decomposition) would be a
  // different map wearing this one's name. So `w` rides through untouched,
  // which is exactly what the ANGULAR warps above do with the axes their
  // formula does not mention — and it anchors for the same reason: `w = 0`
  // in gives `w' = 0` out, with x/y/z arithmetic duplicated term for term
  // from the 3D file under the twin-file convention.
  bulb: (x, y, z, w) => {
    const a = x * x + y * y; // ρ²
    const r2 = a + z * z;
    const z2 = z * z;
    const r4 = r2 * r2;
    const zOut =
      128 * z2 * z2 * z2 * z2 -
      256 * z2 * z2 * z2 * r2 +
      160 * z2 * z2 * r4 -
      32 * z2 * r4 * r2 +
      r4 * r4;
    const s =
      128 * z2 * z2 * z2 * z -
      192 * z2 * z2 * z * r2 +
      80 * z2 * z * r4 -
      8 * z * r4 * r2;
    const rho = Math.sqrt(a);
    const inv = rho > 0 ? 1 / rho : 0;
    const u1 = x * inv;
    const v1 = y * inv;
    const u2 = u1 * u1 - v1 * v1;
    const v2 = 2 * u1 * v1;
    const u4 = u2 * u2 - v2 * v2;
    const v4 = 2 * u2 * v2;
    const u8 = u4 * u4 - v4 * v4;
    const v8 = 2 * u4 * v4;
    return [rho * s * u8, rho * s * v8, zOut, w];
  },

  // The three parametric warps, at their classic parameters — the values
  // an absent params object resolves to. The 3D registry entries' arithmetic
  // duplicated under the twin-file convention on (x, y) alone, z AND w
  // carried through (the angular warps' lift), which is exactly what makes
  // the anchor property hold: w = 0 in gives w' = 0 out, with x/y
  // arithmetic duplicated term for term from the 3D file.
  julian: (x, y, z, w, rng) => {
    const t = Math.trunc(Math.abs(CLASSIC_JULIA_POWER) * rng());
    const theta = (Math.atan2(y, x) + TWO_PI * t) / CLASSIC_JULIA_POWER;
    const r = Math.pow(
      x * x + y * y,
      CLASSIC_JULIA_DIST / (2 * CLASSIC_JULIA_POWER),
    );
    return [r * Math.cos(theta), r * Math.sin(theta), z, w];
  },

  juliascope: (x, y, z, w, rng) => {
    const t = Math.trunc(Math.abs(CLASSIC_JULIA_POWER) * rng());
    const a = Math.atan2(y, x);
    const theta = (TWO_PI * t + (t % 2 === 0 ? a : -a)) / CLASSIC_JULIA_POWER;
    const r = Math.pow(
      x * x + y * y,
      CLASSIC_JULIA_DIST / (2 * CLASSIC_JULIA_POWER),
    );
    return [r * Math.cos(theta), r * Math.sin(theta), z, w];
  },

  // The complex reciprocal over the xy-plane — see `variations.ts`'s `curl`
  // for the classic reduction and the EPS floor.
  curl: (x, y, z, w) => {
    const re = 1 + CLASSIC_CURL_C1 * x + CLASSIC_CURL_C2 * (x * x - y * y);
    const im = CLASSIC_CURL_C1 * y + 2 * CLASSIC_CURL_C2 * x * y;
    const r = 1 / (re * re + im * im + EPS);
    return [(x * re + y * im) * r, (y * re - x * im) * r, z, w];
  },
};

/**
 * A transform's blended 4D variation map, ready to apply to its affine output.
 * The returned `Vec4` is OWNED BY THE CLOSURE and overwritten in place on
 * every call, mirroring `variations.ts`'s `VariationBlend` — valid only
 * until the next call on this SAME blend.
 */
export type VariationBlend4 = (
  x: number,
  y: number,
  z: number,
  w: number,
  rng: Rng,
) => Vec4;

/**
 * Compile a transform's {@link Variation} list into a single 4D blend function,
 * or `null` when there is nothing to apply — no list, an empty list, or every
 * weight zero/non-finite. The `null` return is the fast path
 * {@link import("./chaos-game-4d").runChaosGame4} uses to keep purely-affine 4D
 * systems byte-for-byte identical (no RNG draw, no code-path change) to before
 * variations existed. Mirrors `variations.ts`'s `composeVariations` exactly, one
 * dimension up — the parallel fn/weight arrays and the reused result array
 * included.
 *
 * The blend is the weighted sum `Σ weight · V(type)` (flame semantics — weights
 * are free strengths, never normalised), evaluated left to right so a stochastic
 * variation consumes the RNG in list order.
 */
export function composeVariations4(
  variations: Variation[] | undefined,
): VariationBlend4 | null {
  if (!variations || variations.length === 0) return null;
  const active = variations.filter(
    (v) => Number.isFinite(v.weight) && v.weight !== 0,
  );
  if (active.length === 0) return null;

  const fns: VariationFn4[] = active.map((v) =>
    isFoldVariationType(v.type)
      ? foldVariationFn4(v.type, resolveFoldRadii(v))
      : isParametricVariationType(v.type)
        ? parametricVariationFn4(v.type, v)
        : VARIATIONS4[v.type],
  );
  const weights: number[] = active.map((v) => v.weight);
  const n = fns.length;
  const out: Vec4 = [0, 0, 0, 0];

  return (x, y, z, w, rng) => {
    let ox = 0;
    let oy = 0;
    let oz = 0;
    let ow = 0;
    for (let i = 0; i < n; i++) {
      const [vx, vy, vz, vw] = fns[i](x, y, z, w, rng);
      const wt = weights[i];
      ox += wt * vx;
      oy += wt * vy;
      oz += wt * vz;
      ow += wt * vw;
    }
    out[0] = ox;
    out[1] = oy;
    out[2] = oz;
    out[3] = ow;
    return out;
  };
}
