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
import {
  foldLattice3,
  foldLattice4,
  foldToChamber,
  isResolvedLatticeTiling,
} from "./tiling";
import type { ResolvedTiling } from "./tiling";
import type { Vec3, Vec4 } from "./types";

/**
 * The dependency-free CPU estimator authority for both space-tiling arms
 * (`docs/tiling-contract.md` is the frozen record; `tiling.ts` owns the
 * union, resolver and folds). Each of the seven inverse/forward, 3D/4D public
 * entries folds the query ONCE before the UNTOUCHED core and then applies the
 * selected arm's narrowing terms. Every other core argument passes through
 * unchanged; absent tiling never calls these wrappers.
 *
 * THE TWO COMPOSITIONS, exactly as the contract's soundness chain:
 *
 *     finite:  max(DE(F(q)), clipDist(F(q)))
 *     lattice: max(DE(F(q)), length(F(q)) - R, clipDist(F(q)))
 *
 * with `DE(q') ≤ d(q', A)` the core's own lower bound, `clipDist` the
 * clip's conservative SDF, and the NEAREST-COPY THEOREM
 * (`docs/tiling-contract.md`) the equality that closes it:
 *
 *     DE(F(q)) ≤ d(F(q), A) ≤ d(F(q), A∩C∩clip) = d(q, T)
 *
 * — so the wrapper never overshoots. The finite arm uses
 * {@link foldToChamber}; the lattice arm mirrors x/z or x/z/w and preserves
 * y. Its mandatory origin-centred ball term keeps canonical content inside
 * the cell because the resolver proves `h >= R`, making the same theorem
 * sound for the infinite product reflection group. The chamber enters ONLY
 * through the fold: wall/seam distance is deliberately not a term (unsound as
 * a max, false geometry as a min), and the clip term uses the RAW SIGNED SDF —
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
 * `< cutoff`) AND every exact narrowing term is `< cutoff`, so the full max
 * is `< cutoff` too. The wrapper's contract is therefore the core's, with the
 * core's `cutoff` argument threaded through unmodified.
 *
 * A `null` FINITE fold returns 0 — fully conservative, never an overshoot,
 * and by the fold's proven step bound (24 for F4, capped at `tiling.ts`'s 32)
 * it never fires. The lattice fold has fixed work and cannot fail.
 *
 * REFUSALS. Enforced HERE: the 4D slab (`halfExtent` a real segment
 * throws, both 4D entries) — the fold of a segment is a bent polyline
 * (per-point reflection sequences), and the slab's conservative-bound
 * contract does not survive it, so tiled 4D sessions run slice 0. Named
 * for the full legal-combination context but enforced by the ROUTING, not
 * this module (a wrapper handed a refused combination has no way to know
 * it): the kaleidoscope (both are query-space folds, and the descent
 * cores' swept rotation has no certified lower-bound order after a tiling
 * fold), and the balloon (an orbit's echo
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
 * THESE ARE THE CPU ORACLES. The existing finite GLSL/WGSL arms mirror the
 * finite branch. A lattice renderer must mirror this same fold/ball/clip
 * order for primary, normal, shadow and AO queries; routing currently refuses
 * lattice until those shader and carrier paths land.
 */

/** The folded 3D query, reused across calls — the wrappers run ~1e7 times
 * a frame and an allocation per call is not free (the `escape-de.ts`
 * `FOLDED` convention, safe because the estimator is synchronous and
 * single-threaded). */
const FOLDED3: Vec3 = [0, 0, 0];

/** The folded 4D query — `FOLDED3` one dimension up. */
const FOLDED4: Vec4 = [0, 0, 0, 0];

/** Fold through the selected tiling arm. The finite arm retains its guarded
 * null result; the lattice arm has fixed work and cannot fail. */
function foldQuery3(tiling: ResolvedTiling, p: Vec3): Vec3 | null {
  return isResolvedLatticeTiling(tiling)
    ? foldLattice3(p, tiling.h, FOLDED3)
    : (foldToChamber(tiling.info, p, FOLDED3) as Vec3 | null);
}

function foldQuery4(tiling: ResolvedTiling, p: Vec4): Vec4 | null {
  return isResolvedLatticeTiling(tiling)
    ? foldLattice4(p, tiling.h, FOLDED4)
    : (foldToChamber(tiling.info, p, FOLDED4) as Vec4 | null);
}

/** Finish the common 3D composition. The lattice ball is mandatory: it
 * narrows canonical-cell content to the certified origin-centred ball whose
 * radius derived `h`, making the infinite nearest-copy theorem applicable.
 * Finite behavior stays value-identical because that arm skips this term. */
function finish3(tiling: ResolvedTiling, q: Vec3, inner: number): number {
  let result = inner;
  if (isResolvedLatticeTiling(tiling)) {
    result = Math.max(result, Math.hypot(q[0], q[1], q[2]) - tiling.radius);
  }
  if (tiling.clip) {
    result = Math.max(result, shapeSdf(tiling.clip, q[0], q[1], q[2]));
  }
  return result;
}

/** 4D twin: the certified ball is the full visible 4D ball, never the
 * slice-adjusted one; the authored clip remains extruded through w. */
function finish4(tiling: ResolvedTiling, q: Vec4, inner: number): number {
  let result = inner;
  if (isResolvedLatticeTiling(tiling)) {
    result = Math.max(
      result,
      Math.hypot(q[0], q[1], q[2], q[3]) - tiling.radius,
    );
  }
  if (tiling.clip) {
    result = Math.max(result, shapeSdf(tiling.clip, q[0], q[1], q[2]));
  }
  return result;
}

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
  const folded = foldQuery3(tiling, p);
  if (folded === null) return 0;
  const q = folded;
  const inner = estimateDistance(de, q, cutoff, footprint);
  return finish3(tiling, q, inner);
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
  const folded = foldQuery3(tiling, p);
  if (folded === null) return 0;
  const q = folded;
  const inner = estimateDistanceRefined(de, q, cutoff, footprint);
  return finish3(tiling, q, inner);
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
  const folded = foldQuery4(tiling, p);
  if (folded === null) return 0;
  const q = folded;
  const inner = estimateDistance4(de, q, halfExtent);
  return finish4(tiling, q, inner);
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
  const folded = foldQuery4(tiling, p);
  if (folded === null) return 0;
  const q = folded;
  const inner = estimateDistance4Refined(de, q, cutoff, halfExtent);
  return finish4(tiling, q, inner);
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
  const folded = foldQuery3(tiling, p);
  if (folded === null) return 0;
  const q = folded;
  const inner = estimateEscapeDistance(de, q, maxIterations, trap);
  return finish3(tiling, q, inner);
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
  const folded = foldQuery3(tiling, p);
  if (folded === null) return 0;
  const q = folded;
  const inner = estimateBulbDistance(de, q, maxIterations);
  return finish3(tiling, q, inner);
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
  const folded = foldQuery4(tiling, p);
  if (folded === null) return 0;
  const q = folded;
  const inner = estimateEscapeDistance4(de, q, maxIterations, trap);
  return finish4(tiling, q, inner);
}
