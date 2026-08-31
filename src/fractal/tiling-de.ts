import type { BulbDE } from "./bulb-de";
import { BULB_ITERATIONS, estimateBulbDistance } from "./bulb-de";
import type { EscapeDE } from "./escape-de";
import { ESCAPE_TIME_ITERATIONS, estimateEscapeDistance } from "./escape-de";
import type { EscapeDE4 } from "./escape-de-4d";
import { estimateEscapeDistance4 } from "./escape-de-4d";
import { shapeSdf } from "./shapes";
import type { ResolvedShapeTrap } from "./shape-trap";
import type { SurfaceDE } from "./surface-de";
import { estimateDistance, estimateDistanceRefined } from "./surface-de";
import type { SurfaceDE4 } from "./surface-de-4d";
import { estimateDistance4, estimateDistance4Refined } from "./surface-de-4d";
import { foldToChamber } from "./tiling";
import type { ResolvedTiling } from "./tiling";
import type { Vec3, Vec4 } from "./types";

/**
 * The query-space tiling wrappers — the estimator side of the space-tiling
 * vocabulary (`docs/tiling-contract.md` is the frozen record; `tiling.ts`
 * owns the groups, the fold and the resolver). This module owns exactly one
 * thing: the seven public estimator entries below, each of which folds the
 * query into the chamber with {@link foldToChamber} FIRST — once, before
 * anything else in the estimator path — evaluates the UNTOUCHED core at the
 * folded point with every other argument passed through unchanged, and
 * maxes the result with the clip's raw signed SDF. The cores stay
 * byte-identical (that is the point); this is the contract's wrapper order
 * (step 1, the tiling fold, and step 5, the clip max) applied OUTSIDE them,
 * the `descendLens`/`descendLens4` idiom — the wrapper owns the public
 * estimator names, so tiling absent means nothing anywhere changes.
 *
 * THE COMPOSITION, exactly as the contract's soundness chain:
 *
 *     estimate(q) = max(DE(F(q)), clipDist(F(q)))
 *
 * with `DE(q') ≤ d(q', A)` the core's own lower bound, `clipDist` the
 * clip's conservative SDF, and the NEAREST-COPY THEOREM
 * (`docs/tiling-contract.md`) the equality that closes it:
 *
 *     DE(F(q)) ≤ d(F(q), A) ≤ d(F(q), A∩C∩clip) = d(q, T)
 *
 * — so the wrapper never overshoots: `estimate(q) ≤ d(q, T)` for the
 * rendered set `T = G·(A∩C∩clip)`. The chamber enters ONLY through the
 * fold: the wall distance is deliberately not a term (unsound as a max,
 * false geometry as a min), and the clip term uses the RAW SIGNED SDF —
 * never a `max(0, ·)` — because `sdf ≤ d(q', clip) ≤ d(q', S)` holds
 * everywhere, so maxing with it never breaks soundness, and inside the
 * clip the negative term lets the estimate stay the DE (a point inside the
 * authored clip is still judged by its distance to the attractor).
 *
 * THE CUTOFF CONTRACT PASSES THROUGH UNCHANGED. The core's early-out
 * guarantees compose with the max: a returned `>= cutoff` is exact, and
 * `< cutoff` means the full value is `< cutoff`. Verbatim: if the wrapper
 * returns `>= cutoff`, the clip term (computed exactly, no early-out) or
 * the core's exact result holds the value; if it returns `< cutoff`, then
 * `inner < cutoff` (the core's guarantee: the full inner value is
 * `< cutoff`) AND `clip < cutoff`, so the full `max(inner, clip)` is
 * `< cutoff` too. The wrapper's contract is therefore the core's, with the
 * core's `cutoff` argument threaded through unmodified.
 *
 * THE `null` FOLD RETURNS 0 — fully conservative, never an overshoot, and
 * by the fold's proven step bound (24 for F4, capped at
 * `tiling.ts`'s 32) it never fires.
 *
 * REFUSALS. Enforced HERE: the 4D slab (`halfExtent` a real segment
 * throws, both 4D entries) — the fold of a segment is a bent polyline
 * (per-point reflection sequences), and the slab's conservative-bound
 * contract does not survive it, so tiled 4D sessions run slice 0. Named
 * for the full legal-combination context but enforced by the ROUTING, not
 * this module (a wrapper handed a refused combination has no way to know
 * it): the kaleidoscope (both are query-space folds, and the descent
 * cores' swept rotation has no certified lower-bound order after a tiling
 * fold — phase 1 never combines them), and the balloon (an orbit's echo
 * is not the echo's orbit). The H4/reducible-group refusals live in the
 * group vocabulary itself (`tiling.ts`'s `TILING_GROUPS`). A forward core
 * read here may still carry ITS OWN kaleidoscope (a query-space wedge
 * fold inside the core, seeded at the folded point) — sound by the same
 * pre-fold argument, but phase 1's one-routing-rule keeps even that
 * combination off the fixtures.
 *
 * THE 4D CLIP IS EMBEDDED EXTRUDED THROUGH `w`. The shape vocabulary is
 * deliberately 3D (`shapes.ts`'s module doc: each consumer decides its
 * embedding), and this consumer's embedding is "the clip applied to the
 * folded point's first three coordinates" — `shapeSdf(clip, qx, qy, qz)`
 * with the folded point's `w` dropped. The fold genuinely reflects `w`
 * (the 4D groups' roots carry it — F4's fourth root especially), and the
 * clip term then reads exactly the 3D part the 3D wrappers read: at
 * `w = 0` for a flat system this wrapper is the 3D wrapper's value for
 * value, and a clip sweeps along `w` rather than slicing it (the
 * escape4 shape-trap's own embedding stance).
 *
 * MODULE SCRATCH: one `Vec3` and one `Vec4`, reused across calls — the
 * `escape-de.ts` `FOLDED` convention, safe because the estimator is
 * synchronous and single-threaded and every core copies its input point
 * before reading it.
 *
 * THESE ARE THE CPU ORACLES the GLSL tracers' and WGSL cores' compile-gated
 * tiling arms mirror; the surface-grid floors, the shading probe taps and
 * the march-epsilon cutoffs all ride the wrapper — every estimator
 * evaluation, probe included, folds first.
 */

/** The folded 3D query, reused across calls — the wrappers run ~1e7 times
 * a frame and an allocation per call is not free (the `escape-de.ts`
 * `FOLDED` convention, safe because the estimator is synchronous and
 * single-threaded). */
const FOLDED3: Vec3 = [0, 0, 0];

/** The folded 4D query — `FOLDED3` one dimension up. */
const FOLDED4: Vec4 = [0, 0, 0, 0];

/** True when `halfExtent` describes a real slab rather than the point
 * query — replicated from `surface-de-4d.ts`'s private `isSegment` (not
 * exported there), because this module must recognize a segment to refuse
 * it, and a refusal read with a different predicate than the cores' own
 * segment test would refuse a query the core would treat as a point (or
 * pass one it treats as a segment). Zero is the point query, exactly as
 * the cores read it. */
function isSegment(halfExtent: Vec4 | null): halfExtent is Vec4 {
  return (
    halfExtent !== null &&
    (halfExtent[0] !== 0 ||
      halfExtent[1] !== 0 ||
      halfExtent[2] !== 0 ||
      halfExtent[3] !== 0)
  );
}

/**
 * The 3D affine/fold wrapper over {@link estimateDistance}: fold the query
 * into the chamber, descend the untouched core at the folded point (cutoff
 * and footprint threaded through — the cutoff contract composes with the
 * max, module doc), max with the clip's raw signed SDF. The `null` fold
 * returns 0 (never fires by the proof).
 */
export function estimateDistanceTiled(
  tiling: ResolvedTiling,
  de: SurfaceDE,
  p: Vec3,
  cutoff = 0,
  footprint = 0,
): number {
  const folded = foldToChamber(tiling.info, p, FOLDED3);
  if (folded === null) return 0;
  const q = folded as Vec3;
  const inner = estimateDistance(de, q, cutoff, footprint);
  if (!tiling.clip) return inner;
  return Math.max(inner, shapeSdf(tiling.clip, q[0], q[1], q[2]));
}

/**
 * The 3D affine/fold wrapper over {@link estimateDistanceRefined} — the
 * refined certificates one wrapper out, identical composition (fold, then
 * the untouched refined core with cutoff and footprint threaded through,
 * then the clip max).
 */
export function estimateDistanceRefinedTiled(
  tiling: ResolvedTiling,
  de: SurfaceDE,
  p: Vec3,
  cutoff = 0,
  footprint = 0,
): number {
  const folded = foldToChamber(tiling.info, p, FOLDED3);
  if (folded === null) return 0;
  const q = folded as Vec3;
  const inner = estimateDistanceRefined(de, q, cutoff, footprint);
  if (!tiling.clip) return inner;
  return Math.max(inner, shapeSdf(tiling.clip, q[0], q[1], q[2]));
}

/**
 * The 4D affine/fold wrapper over {@link estimateDistance4} (which takes
 * no cutoff — nothing to thread). THROWS when `halfExtent` is a real
 * segment: the contract's tiling + 4D slab refusal — the fold of a
 * segment is a bent polyline, so the slab's conservative-bound contract
 * does not survive the pre-fold; tiled 4D sessions run slice 0 (the
 * shipped default). `null`/zero — the point query — passes through.
 */
export function estimateDistance4Tiled(
  tiling: ResolvedTiling,
  de: SurfaceDE4,
  p: Vec4,
  halfExtent: Vec4 | null = null,
): number {
  if (isSegment(halfExtent)) {
    throw new Error(
      "tiling-de: slab queries are refused under tiling — the fold of a " +
        "segment is a bent polyline (the tiling + 4D slab refusal, " +
        "docs/tiling-contract.md); tiled 4D sessions run slice 0",
    );
  }
  const folded = foldToChamber(tiling.info, p, FOLDED4);
  if (folded === null) return 0;
  const q = folded as Vec4;
  const inner = estimateDistance4(de, q, halfExtent);
  if (!tiling.clip) return inner;
  return Math.max(inner, shapeSdf(tiling.clip, q[0], q[1], q[2]));
}

/**
 * The 4D affine/fold wrapper over {@link estimateDistance4Refined} — the
 * refined 4D ladder one wrapper out. Same slab throw (module doc of
 * {@link estimateDistance4Tiled}), cutoff threaded through unchanged (the
 * cutoff contract composes with the max).
 */
export function estimateDistance4RefinedTiled(
  tiling: ResolvedTiling,
  de: SurfaceDE4,
  p: Vec4,
  cutoff = 0,
  halfExtent: Vec4 | null = null,
): number {
  if (isSegment(halfExtent)) {
    throw new Error(
      "tiling-de: slab queries are refused under tiling — the fold of a " +
        "segment is a bent polyline (the tiling + 4D slab refusal, " +
        "docs/tiling-contract.md); tiled 4D sessions run slice 0",
    );
  }
  const folded = foldToChamber(tiling.info, p, FOLDED4);
  if (folded === null) return 0;
  const q = folded as Vec4;
  const inner = estimateDistance4Refined(de, q, cutoff, halfExtent);
  if (!tiling.clip) return inner;
  return Math.max(inner, shapeSdf(tiling.clip, q[0], q[1], q[2]));
}

/**
 * The 3D escape wrapper over {@link estimateEscapeDistance}: fold the
 * query into the chamber, run the untouched forward chain at the folded
 * point (`maxIterations` and the trap threaded through), max with the
 * clip's raw signed SDF. The forward cores are HEURISTICS — the
 * composition is the same max, and its soundness chain holds verbatim
 * when the heuristic under-reads, but nothing here certifies the chain's
 * own estimate; the fixture-level gates own that question.
 */
export function estimateEscapeDistanceTiled(
  tiling: ResolvedTiling,
  de: EscapeDE,
  p: Vec3,
  maxIterations = ESCAPE_TIME_ITERATIONS,
  trap: ResolvedShapeTrap | null = null,
): number {
  const folded = foldToChamber(tiling.info, p, FOLDED3);
  if (folded === null) return 0;
  const q = folded as Vec3;
  const inner = estimateEscapeDistance(de, q, maxIterations, trap);
  if (!tiling.clip) return inner;
  return Math.max(inner, shapeSdf(tiling.clip, q[0], q[1], q[2]));
}

/**
 * The Mandelbulb wrapper over {@link estimateBulbDistance}: the same
 * fold-then-evaluate-then-max composition as the family's other wrappers,
 * with `maxIterations` threaded through.
 */
export function estimateBulbDistanceTiled(
  tiling: ResolvedTiling,
  de: BulbDE,
  p: Vec3,
  maxIterations = BULB_ITERATIONS,
): number {
  const folded = foldToChamber(tiling.info, p, FOLDED3);
  if (folded === null) return 0;
  const q = folded as Vec3;
  const inner = estimateBulbDistance(de, q, maxIterations);
  if (!tiling.clip) return inner;
  return Math.max(inner, shapeSdf(tiling.clip, q[0], q[1], q[2]));
}

/**
 * The 4D escape wrapper over {@link estimateEscapeDistance4}: the 4D fold
 * (whose roots genuinely carry `w`), then the untouched forward chain at
 * the folded point, then the clip max — the clip read on the folded
 * point's first three coordinates (the extruded embedding, module doc).
 */
export function estimateEscapeDistance4Tiled(
  tiling: ResolvedTiling,
  de: EscapeDE4,
  p: Vec4,
  maxIterations = ESCAPE_TIME_ITERATIONS,
  trap: ResolvedShapeTrap | null = null,
): number {
  const folded = foldToChamber(tiling.info, p, FOLDED4);
  if (folded === null) return 0;
  const q = folded as Vec4;
  const inner = estimateEscapeDistance4(de, q, maxIterations, trap);
  if (!tiling.clip) return inner;
  return Math.max(inner, shapeSdf(tiling.clip, q[0], q[1], q[2]));
}
