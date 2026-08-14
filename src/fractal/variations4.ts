import type { Rng } from "./rng";
import type { Variation, VariationType, Vec4 } from "./types";
import { clamp } from "./vec";

/**
 * The 4D lift of the seventeen nonlinear variation functions (fr-hy8), the fourth
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
 *   - **Fold warps** (`boxfold`, `spherefold`, `mandelbox` — fr-p7nu) treat `w`
 *     exactly like the spatial axes: the box fold reflects all four axes and
 *     the sphere fold inverts through the full 4-D radius.
 *   - `sinusoidal` folds each of the four axes through a sine; `linear` is the
 *     identity.
 *   - `qsquare` (fr-7u8t.3) is the only entry whose 4D form is the DEFINITION
 *     and whose 3D form is the restriction — the quaternions are natively 4D.
 *     `bulb` (fr-7u8t.7) is the opposite extreme: triplex numbers have no 4D
 *     structure at all, so it warps `x, y, z` and carries `w` through, the
 *     angular warps' treatment of an axis their formula never mentions.
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
 * warp and duplicates its x/y/z arithmetic term for term. The equality is
 * exact (not merely close) for all seventeen; the tests pin `toEqual`. That is what makes an
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
};

/** A transform's blended 4D variation map, ready to apply to its affine output. */
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
 * dimension up.
 *
 * The blend is the weighted sum `Σ weight · V(type)` (flame semantics — weights
 * are free strengths, never normalised), evaluated left to right so a stochastic
 * variation consumes the RNG in list order.
 */
export function composeVariations4(
  variations: Variation[] | undefined,
): VariationBlend4 | null {
  if (!variations || variations.length === 0) return null;
  const active = variations
    .filter((v) => Number.isFinite(v.weight) && v.weight !== 0)
    .map((v): [VariationFn4, number] => [VARIATIONS4[v.type], v.weight]);
  if (active.length === 0) return null;

  return (x, y, z, w, rng) => {
    let ox = 0;
    let oy = 0;
    let oz = 0;
    let ow = 0;
    for (const [fn, wt] of active) {
      const [vx, vy, vz, vw] = fn(x, y, z, w, rng);
      ox += wt * vx;
      oy += wt * vy;
      oz += wt * vz;
      ow += wt * vw;
    }
    return [ox, oy, oz, ow];
  };
}
