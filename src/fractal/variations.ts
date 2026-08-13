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
 * (`boxfold`, `spherefold`, `mandelbox` — fr-p7nu) are natively 3-D: per-axis
 * plane reflections and a full-3D-radius ball inversion, the Mandelbox's two
 * moves.
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
};

/** A transform's blended variation map, ready to apply to its affine output. */
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
 */
export function composeVariations(
  variations: Variation[] | undefined,
): VariationBlend | null {
  if (!variations || variations.length === 0) return null;
  const active = variations
    .filter((v) => Number.isFinite(v.weight) && v.weight !== 0)
    .map((v): [VariationFn, number] => [VARIATIONS[v.type], v.weight]);
  if (active.length === 0) return null;

  return (x, y, z, rng) => {
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (const [fn, w] of active) {
      const [vx, vy, vz] = fn(x, y, z, rng);
      ox += w * vx;
      oy += w * vy;
      oz += w * vz;
    }
    return [ox, oy, oz];
  };
}
