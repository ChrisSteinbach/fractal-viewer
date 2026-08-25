/**
 * The balloon inverted-union DE — the production port of the spike wrapper
 * (scripts/balloon-inversion.harness.ts), the CPU oracle the GLSL/WGSL
 * balloon arms mirror under the house agreement discipline (the `flame.ts`
 * <-> `flame-gpu.ts` contract, one wrapper further out).
 *
 * THE SCENE. The attractor enclosed by its own sphere-inverted
 * echo: `I(p) = c + R²(p−c)/|p−c|²` through a balloon of radius `R`
 * centered at the attractor center `c`, the scene the UNION of the
 * visible set `S` and its echo `S' = I(S)`. One continuous parameter:
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
 * composes. Condensation needs no special case: its public estimator already
 * bounds the full `C0 union f_j(A)` set and carries the analytic invariant
 * ball, so this same proof admits balloon-over-condensation in both
 * dimensions.
 *
 * BALLOON PALETTE COORDINATE. Every renderer samples an independently
 * selected balloon gradient at one renderer-neutral coordinate:
 *
 *     t = clamp(|source - c| / rho, 0, 1)
 *
 * `source` is the exact pre-inversion point whose image is being drawn:
 * the projected source point in Points and Flame, and the shell argmin's
 * inverted query (`BalloonDistance.shell`'s source) in Surface. Thus one
 * source sample keeps one colour through the inversion, the coordinate is
 * independent of the balloon radius `R`, and Points/Flame/Surface do not
 * silently borrow three unrelated main-render colour modes. The margined
 * `rho`, rather than raw ball radius, is deliberate: it is the one bound all
 * balloon paths already carry and keeps certified source samples inside the
 * gradient up to measured ball-fit slack. {@link balloonPaletteCoordinate}
 * is the CPU definition; GLSL/WGSL spell the same formula where moving the
 * coordinate itself would cost more than recomputing it. Palette lookup
 * replaces only the balloon term's base colour, then the existing balloon
 * tint mix runs, followed by each renderer's existing intensity,
 * accumulation, pattern, lighting, and fog operations.
 *
 * THE BALL is the DE's own ({@link balloonBall}): the probe-fit
 * `(boundCenter, boundingRadius)` for plain systems, the analytic
 * `([0,0,0], visibleBoundingRadius)` for lens systems (either final
 * shape) — the estimator measures distance to the VISIBLE set, which is
 * also what the chaos game plots. {@link BALLOON_RHO_MARGIN} multiplies
 * the raw radius before it becomes the bound's divisor: the shell bound
 * DIVIDES by `rho`, so a `rho` that under-covers the true set inflates
 * the bound into genuine overshoot. The DE ball's own radius is
 * `probe.maxR · 1.05 + 1e-3` over an 8192-point probe (`surface-de.ts`'s
 * `RADIUS_PAD`); the spike measured `sampleMax/ballR = 0.952−0.962` at 37x
 * that probe density (0 conservativeness violations in 6 systems x 3 R
 * regimes x 2 estimators x 950 off-set queries at margin 1), so the pad
 * already holds with ~4% headroom — but density independence is
 * MEASURED, not proven, and the margin buys insurance at a known price:
 * every shell value loosens by exactly the margin factor. 1.02 keeps the
 * certified divisor >= 1.06x the densest measured extent while costing 2%
 * shell tightness.
 *
 * CUTOFF survives the wrapper verbatim: the shell term's inner
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
 * FOOTPRINT passes to the fractal term verbatim and to the
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
 * MARCH-ENTRY SEMANTICS the shader arms share (decided here):
 * every ray can hit the enclosing shell, so balloon mode DROPS the
 * visible-sphere march gate and caps rays at
 * `tFar = |cam − c| + BALLOON_FAR_CAP_RHO · rho` — attractor material
 * near `c` maps the shell toward infinity in places, and the cap makes
 * that graceful: capped rays fall through to the EXISTING background
 * modes (the balloon is a HIT, not a background). The spike marched this
 * exact cap (10 rho) with 0 step-budget cap-outs across 24 system x R
 * rows. The empty-space grid is CONDITIONAL in balloon mode — its floors
 * bound the fractal alone, and are a valid bound on the union exactly
 * while the shell clears the grid box (`surface-grid.ts`'s
 * `balloonClearsGridBox`: `R^2/rho > |c| + sqrt(3)*halfExtent`, which the
 * rest state satisfies on every measured system and both inflation regimes
 * fail). The blanket OFF this module shipped with was the same rule before
 * anything measured where it holds.
 *
 * MEASURED VERDICT (the spike, CLOUD=300k, margin 1): 0 off-set
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
import type { SurfaceDE4 } from "./surface-de-4d";
import type { Vec3, Vec4 } from "./types";

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

/**
 * Renderer-neutral balloon gradient coordinate (module doc): normalized
 * pre-inversion source radius about the balloon's certified, margined ball.
 * Clamping is part of the render contract: a probe-fit source may sit in the
 * small raw-ball slack that `rho` covers.
 */
export function balloonPaletteCoordinate(b: Balloon, source: Vec3): number {
  const dx = source[0] - b.center[0];
  const dy = source[1] - b.center[1];
  const dz = source[2] - b.center[2];
  return Math.min(1, Math.hypot(dx, dy, dz) / b.rho);
}

/**
 * Build a balloon from an already-chosen RAW enclosing ball. This is the
 * shared `rMult`/rho-margin convention for renderers whose enclosing ball
 * does not come from a surface DE (the point-cloud/flame pair), while
 * {@link buildBalloon} and {@link buildBalloon4} remain the DE-specific
 * front doors.
 */
export function buildBalloonFromBall(
  ball: { center: Vec3; radius: number },
  rMult: number,
): Balloon {
  return {
    center: [ball.center[0], ball.center[1], ball.center[2]],
    rho: ball.radius * BALLOON_RHO_MARGIN,
    R: rMult * ball.radius,
  };
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
 * bound; plain systems use the probe fit. Exposed raw so the UI
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
  return buildBalloonFromBall(balloonBall(de), rMult);
}

/** `I(p) = c + R²(p−c)/|p−c|²`, `|p−c|²` floored so a query at `c` maps
 * far away instead of to NaN. Self-inverse away from the floor. `out` is an
 * optional caller-owned tuple for allocation-free hot loops; omitted, the
 * long-standing return-a-fresh-tuple behavior is unchanged. */
export function invertBalloon(
  b: Balloon,
  p: Vec3,
  out: Vec3 = [0, 0, 0],
): Vec3 {
  const dx = p[0] - b.center[0];
  const dy = p[1] - b.center[1];
  const dz = p[2] - b.center[2];
  const floor = BALLOON_CENTER_FLOOR * b.rho;
  const r2 = Math.max(dx * dx + dy * dy + dz * dz, floor * floor);
  const s = (b.R * b.R) / r2;
  out[0] = b.center[0] + s * dx;
  out[1] = b.center[1] + s * dy;
  out[2] = b.center[2] + s * dz;
  return out;
}

/**
 * The union DE: `min(DE(p), (|p−c|/rho) · DE(I(p)))` over the UNTOUCHED
 * public estimator `fn`, with the cutoff contract and the footprint
 * preserved through the scale (module doc). Returns the min and its term
 * attribution for hit-info/coloring routing.
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

/* ------------------------------------------------------------------ *
 * The 4D lift, and the whole of it is a SEMANTIC decision
 * plus a ball choice — no new algebra.
 *
 * SLICE THEN INVERT. The surface render draws the `w = w0` slice of the
 * rotor-posed 4D set, and the marched ray lives in that sliced 3D space.
 * So the inversion stays a 3D operation ON THE MARCHED POINT and the
 * echo is the inversion of exactly what is drawn — the explorer echo's
 * precedent (`scene.ts` inverts the PROJECTED cloud), and the reading a
 * user gets: object plus echo, both moving together as the slider
 * scrubs. The rejected alternative, inverting in 4D and slicing the
 * result, draws the echo of a DIFFERENT slice — `I₄({w = w0})` is a
 * 3-sphere, not the hyperplane — and the two agree exactly where the
 * ball's centre lies on the slice, which for this origin-anchored ball
 * is `w0 = 0`.
 *
 * THE BOUND IS 3D's, VERBATIM, and that is the point of stating the
 * semantics this way. Write `S` for the drawn slice and
 * `DE(q) := DE4((q, w0))`. A 4D estimate lower-bounds the 4D distance
 * from `(q, w0)` to the set, which is at most the IN-SLICE distance from
 * `q` to `S` — so `DE` is a valid lower bound for `S`, and the module
 * doc's inversion argument applies to it word for word.
 *
 * THE BALL IS THE ORIGIN AND THE FULL 4D RADIUS. `SurfaceDE4` has no
 * `boundCenter` — it is origin-anchored by construction, and
 * `buildSurfaceDE4`'s own comment warns against copying 3D's centred fit
 * blindly (the subspace a fitted centre must project onto is the
 * kaleidoscope generator's fixed subspace, which a twist collapses to
 * the origin). The radius is the FULL `visibleBoundingRadius`, not the
 * slice-adjusted one: the slice sits inside `ball(0, R4)` because
 * `|q| <= |(q, w0)| <= R4`, so the bound stays certified, and a radius
 * that did not move with `w0` keeps the shell from pulsing as the slice
 * slider scrubs. `rMult` therefore means the same thing at every slice.
 *
 * NO SLAB CONFLICT. A `halfExtent` rides through both terms unchanged:
 * the inversion does not touch `w`, so for each `w` in the slab the
 * argument above holds against that slice, and a segment estimate lower-
 * bounds every one of them. The 4D estimators' own `slabExact4` refusal
 * is what gates whether the slab query is legal at all.
 * ------------------------------------------------------------------ */

/** The 4D public-estimator shape the wrapper composes over
 * (`estimateDistance4` / `estimateDistance4Refined`). `cutoff` is the
 * refined entry's; `halfExtent` rides through untouched. */
export type BalloonEstimator4 = (
  de: SurfaceDE4,
  p: Vec4,
  cutoff?: number,
  halfExtent?: Vec4 | null,
) => number;

/** {@link balloonBall}'s 4D twin — the origin and the FULL 4D visible
 * radius, PROJECTED to the marched 3D space (see the section note above
 * for both choices). The final-transform fork 3D makes is absent because
 * the answer is the same either way here: 4D's ball is origin-anchored
 * with or without a lens, and `visibleBoundingRadius` already equals
 * `boundingRadius` when there is no final. */
export function balloonBall4(de: SurfaceDE4): {
  center: Vec3;
  radius: number;
} {
  return { center: [0, 0, 0], radius: de.visibleBoundingRadius };
}

/** {@link buildBalloon}'s 4D twin — same margin, same `rMult`
 * normalization, over {@link balloonBall4}. */
export function buildBalloon4(de: SurfaceDE4, rMult: number): Balloon {
  return buildBalloonFromBall(balloonBall4(de), rMult);
}

/**
 * The 4D union DE — {@link estimateBalloonDistance} with the slice-then-
 * invert semantics spelled out: `p` is the MARCHED 3D point and `w0` the
 * slice the tracer is on, so the inversion below is the 3D one and the
 * estimator sees `(q, w0)` on both terms.
 *
 * The CPU oracle for the `balloon: true` WGSL 4D cores, whose wrapper is
 * textually the 3D one for exactly this reason: it composes over a public
 * `surfaceDE(vec3)` and the core's own prologue does the lift.
 *
 * WHICH FRAME `fn` ANSWERS IN IS THE CALLER'S CHOICE, and matching the
 * kernel means answering in the MARCHED one. The kernel's core applies
 * `rotorInv` inside its own body, AFTER this wrapper has inverted, so an
 * agreement check hands `fn` an estimator that lifts the same way. Passed
 * a bare `estimateDistance4Refined`, this measures the same object in the
 * attractor frame instead — correct, and a different pose.
 */
export function estimateBalloonDistance4(
  fn: BalloonEstimator4,
  de: SurfaceDE4,
  b: Balloon,
  p: Vec3,
  w0: number,
  cutoff = 0,
  halfExtent: Vec4 | null = null,
): BalloonDistance {
  const at = (q: Vec3): Vec4 => [q[0], q[1], q[2], w0];
  const dFractal = fn(de, at(p), cutoff, halfExtent);
  const dx = p[0] - b.center[0];
  const dy = p[1] - b.center[1];
  const dz = p[2] - b.center[2];
  const r = Math.max(Math.hypot(dx, dy, dz), BALLOON_CENTER_FLOOR * b.rho);
  const scale = r / b.rho;
  const innerCutoff = cutoff > 0 ? cutoff / scale : 0;
  const dShell =
    scale * fn(de, at(invertBalloon(b, p)), innerCutoff, halfExtent);
  return dShell < dFractal
    ? { d: dShell, shell: true }
    : { d: dFractal, shell: false };
}
