/**
 * fr-5wlv.3: the balloon inverted-union DE — the production port of the
 * fr-5wlv.1 spike wrapper (scripts/balloon-inversion.harness.ts), the CPU
 * oracle the GLSL/WGSL balloon arms mirror under the house agreement
 * discipline (the `flame.ts` <-> `flame-gpu.ts` contract, one wrapper
 * further out).
 *
 * THE SCENE. The epic wants the attractor enclosed by its own
 * sphere-inverted echo: `I(p) = c + R²(p−c)/|p−c|²` through a balloon of
 * radius `R` centered at the attractor center `c`, the scene the UNION of
 * the visible set `S` and its echo `S' = I(S)`. One continuous parameter:
 * at small `R` the echo is a crumpled ball near `c`; as `R` sweeps past
 * the attractor's extent the copies exchange sides continuously; at rest
 * `R > rho` the attractor sits inside a cave whose walls are itself,
 * inside out.
 *
 * THE BOUND. Inversion's exact distance distortion
 * `|I(a)−I(b)| = R²|a−b| / (|a−c||b−c|)` gives, for a query `p` against
 * the echo, with `a = I(p)` and `|I(p)−c| = R²/|p−c|`:
 *
 *     d(p, S') = |p−c| · inf_s |a−s|/|s−c|  >=  |p−c| · DE(a) / rho
 *
 * where `rho >= sup_s |s−c|` bounds the visible set about `c`. So
 *
 *     DE_scene(p) = min( DE(p),  (|p−c|/rho) · DE(I(p)) )
 *
 * is conservative whenever `DE` is — at EVERY `R`, mid-inflation
 * interpenetration included (a min of two conservative bounds) — and
 * certified relative to the same bounding-ball provenance the descent's
 * own in-sphere validity already stands on. Tight where it matters: at
 * `p -> c` the shell term approaches `R²/rho`, the true distance to the
 * cave wall. The wrapper composes over the PUBLIC estimators — the
 * `descendLens` idiom one layer further out; no estimator internals
 * change, and any core (affine ladder, fold frontier, escape, 4D later)
 * composes.
 *
 * THE BALL is the DE's own ({@link balloonBall}): the fr-pjqw probe-fit
 * `(boundCenter, boundingRadius)` for plain systems, the analytic
 * `([0,0,0], visibleBoundingRadius)` for lens systems (either final
 * shape) — the estimator measures distance to the VISIBLE set, which is
 * also what the chaos game plots. {@link BALLOON_RHO_MARGIN} multiplies
 * the raw radius before it becomes the bound's divisor: the shell bound
 * DIVIDES by `rho`, so a `rho` that under-covers the true set inflates
 * the bound into genuine overshoot. The DE ball's own radius is
 * `probe.maxR · 1.05 + 1e-3` over an 8192-point probe (fr-pjqw /
 * RADIUS_PAD); the spike measured `sampleMax/ballR = 0.952−0.962` at 37x
 * that probe density (0 conservativeness violations in 6 systems x 3 R
 * regimes x 2 estimators x 950 off-set queries at margin 1), so the pad
 * already holds with ~4% headroom — but density independence is
 * MEASURED, not proven, and the margin buys insurance at a known price:
 * every shell value loosens by exactly the margin factor. 1.02 keeps the
 * certified divisor >= 1.06x the densest measured extent while costing 2%
 * shell tightness.
 *
 * CUTOFF (fr-55r5) survives the wrapper verbatim: the shell term's inner
 * cutoff scales by the inverse of its value factor
 * (`cutoff · rho/|p−c|`), so the outer value crosses `cutoff` exactly
 * when the inner value crosses the scaled one. Per term: an inner return
 * `>= innerCutoff` is the full inner result exactly, so the scaled outer
 * value is exact and `>= cutoff`; an inner return `< innerCutoff` pins
 * the full inner result under it, so the full outer value is `< cutoff`.
 * The min of two terms each honoring the contract honors it. (At the
 * exact boundary the guarantee is float-fuzzy at ~1 ULP through the
 * scale division, like every float comparison the marcher already
 * makes.)
 *
 * FOOTPRINT (fr-3c0k) passes to the fractal term verbatim and to the
 * shell term scaled by the LOCAL conformal factor `R²/|p−c|²` — the
 * Jacobian of `I` at the inner query `I(p)` is `|p−c|²/R²`, so an inner
 * feature of size `g` appears near `p` at size `g·|p−c|²/R²`, and outer
 * features below `f` come from inner features below `f·R²/|p−c|²`. Any
 * footprint value is SOUND (it only caps descent depth; terminal
 * certificates stay conservative) — the scaling tunes preview cost, not
 * validity. Near `c` the scaled footprint explodes and the inner descent
 * floors at FOOTPRINT_DEPTH_FLOOR — a coarse bound is fine there, the
 * cave wall is `~R²/rho` away.
 *
 * MARCH-ENTRY SEMANTICS the shader arms share (decided here, fr-5wlv.3):
 * every ray can hit the enclosing shell, so balloon mode DROPS the
 * visible-sphere march gate and caps rays at
 * `tFar = |cam − c| + BALLOON_FAR_CAP_RHO · rho` — attractor material
 * near `c` maps the shell toward infinity in places, and the cap makes
 * that graceful: capped rays fall through to the EXISTING background
 * modes (the balloon is a HIT, not a background). The spike marched this
 * exact cap (10 rho) with 0 step-budget cap-outs across 24 system x R
 * rows. The empty-space grid stays OFF in balloon mode (its floors are
 * fractal-only; the valid-at-rest re-enable rule is recorded on the
 * epic).
 *
 * MEASURED VERDICT (fr-5wlv.1, CLOUD=300k, margin 1): 0 off-set
 * conservativeness violations anywhere; erosion transports, never
 * amplifies; rest-state march steps x1.25−2.06 over plain (worst rest
 * p95 131 of the 160 full-tier budget); value queries x1.00−1.27 apps —
 * the naive 2x never materializes (the inner eval lands outside the ball
 * for most queries and the sphere prunes kill it near-free). Early
 * inflation (R = 0.35 rho) is the disclosed rough regime: fold monsters
 * read soft near the crumpled ball and the lens archetype's p95 steps
 * exceed the full-tier budget — the animation transits it; rest is what
 * persists, and it is clean.
 */
import type { SurfaceDE } from "./surface-de";
import type { Vec3 } from "./types";

/** Provenance margin multiplied onto the DE ball's radius before it
 * becomes the shell bound's divisor `rho` (module doc: measured ~4%
 * headroom at 37x probe density; 2% margin = 2% shell looseness). */
export const BALLOON_RHO_MARGIN = 1.02;

/** Balloon-mode far cap, in units of `rho`: rays march to
 * `|cam − c| + BALLOON_FAR_CAP_RHO · rho`, then fall through to the
 * existing background modes. The spike's march section used exactly this
 * cap with zero step-budget cap-outs. */
export const BALLOON_FAR_CAP_RHO = 10;

/** `|p − c|` floor factor (of `rho`): a query exactly at `c` maps far
 * away instead of to NaN, and the shell scale never divides by zero. */
export const BALLOON_CENTER_FLOOR = 1e-12;

/** The inversion balloon: `center`/`rho` anchor the certified bound
 * (`rho` MARGINED — the divisor), `R` is the balloon radius in world
 * units. Build via {@link buildBalloon} so the ball choice and margin
 * stay one definition. */
export interface Balloon {
  center: Vec3;
  rho: number;
  R: number;
}

/** A wrapped estimate with its term attribution: `shell` when the echo
 * term won the min STRICTLY — ties go to the fractal term, the
 * convention the shader arms' hit-info argmin must mirror. */
export interface BalloonDistance {
  d: number;
  shell: boolean;
}

/** The public-estimator shape the wrapper composes over
 * (`estimateDistance` / `estimateDistanceRefined`). */
export type BalloonEstimator = (
  de: SurfaceDE,
  p: Vec3,
  cutoff?: number,
  footprint?: number,
) => number;

/** The ball the wrapper certifies against — the DE's own, RAW
 * (unmargined): lens systems (either final shape) descend to the
 * VISIBLE set, so their ball is the analytic origin-centered visible
 * bound; plain systems use the fr-pjqw probe fit. Exposed raw so the UI
 * can normalize `R` against the same radius everywhere; the margin is
 * applied once, in {@link buildBalloon}. */
export function balloonBall(de: SurfaceDE): { center: Vec3; radius: number } {
  if (de.final !== null || de.foldFinal !== null) {
    return { center: [0, 0, 0], radius: de.visibleBoundingRadius };
  }
  return { center: de.boundCenter, radius: de.boundingRadius };
}

/** Build the balloon for a DE at normalized radius `rMult` (multiples of
 * the RAW ball radius, so `rMult = 1` touches the attractor's certified
 * extent and the spike's regimes — 0.35 early, 0.9 mid, 1.6 rest — mean
 * the same thing here). */
export function buildBalloon(de: SurfaceDE, rMult: number): Balloon {
  const ball = balloonBall(de);
  return {
    center: ball.center,
    rho: ball.radius * BALLOON_RHO_MARGIN,
    R: rMult * ball.radius,
  };
}

/** `I(p) = c + R²(p−c)/|p−c|²`, `|p−c|²` floored so a query at `c` maps
 * far away instead of to NaN. Self-inverse away from the floor. */
export function invertBalloon(b: Balloon, p: Vec3): Vec3 {
  const dx = p[0] - b.center[0];
  const dy = p[1] - b.center[1];
  const dz = p[2] - b.center[2];
  const floor = BALLOON_CENTER_FLOOR * b.rho;
  const r2 = Math.max(dx * dx + dy * dy + dz * dz, floor * floor);
  const s = (b.R * b.R) / r2;
  return [b.center[0] + s * dx, b.center[1] + s * dy, b.center[2] + s * dz];
}

/**
 * The union DE: `min(DE(p), (|p−c|/rho) · DE(I(p)))` over the UNTOUCHED
 * public estimator `fn`, with the fr-55r5 cutoff contract and the
 * fr-3c0k footprint preserved through the scale (module doc). Returns
 * the min and its term attribution for hit-info/coloring routing.
 */
export function estimateBalloonDistance(
  fn: BalloonEstimator,
  de: SurfaceDE,
  b: Balloon,
  p: Vec3,
  cutoff = 0,
  footprint = 0,
): BalloonDistance {
  const dFractal = fn(de, p, cutoff, footprint);
  const dx = p[0] - b.center[0];
  const dy = p[1] - b.center[1];
  const dz = p[2] - b.center[2];
  const r = Math.max(Math.hypot(dx, dy, dz), BALLOON_CENTER_FLOOR * b.rho);
  const scale = r / b.rho;
  const innerCutoff = cutoff > 0 ? cutoff / scale : 0;
  const innerFootprint =
    footprint > 0 ? (footprint * (b.R * b.R)) / (r * r) : 0;
  const dShell =
    scale * fn(de, invertBalloon(b, p), innerCutoff, innerFootprint);
  return dShell < dFractal
    ? { d: dShell, shell: true }
    : { d: dFractal, shell: false };
}
