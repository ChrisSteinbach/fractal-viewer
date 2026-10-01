import type { BulbDE } from "./bulb-de";
import { BULB_ITERATIONS, estimateBulbDistance } from "./bulb-de";
import type { EscapeDE } from "./escape-de";
import { ESCAPE_TIME_ITERATIONS, estimateEscapeDistance } from "./escape-de";
import type { EscapeDE4 } from "./escape-de-4d";
import { estimateEscapeDistance4 } from "./escape-de-4d";
import { shapeSdf } from "./shapes";
import type { ResolvedShapeTrap } from "./shape-trap";
import type { SurfaceDE, SurfaceDistanceSample } from "./surface-de";
import {
  estimateDistance,
  estimateDistanceRefined,
  estimateDistanceSample,
  estimateDistanceRefinedSample,
} from "./surface-de";
import type { SurfaceDE4 } from "./surface-de-4d";
import {
  estimateDistance4,
  estimateDistance4Refined,
  estimateDistance4Sample,
  estimateDistance4RefinedSample,
  slabSupported4,
} from "./surface-de-4d";
import {
  foldLattice3,
  foldLattice4,
  foldToChamber,
  isResolvedLatticeTiling,
  tilingSlabPieces,
} from "./tiling";
import type { ResolvedFiniteTiling, ResolvedTiling } from "./tiling";
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
 * REFUSALS. Enforced HERE, on a real slab (`halfExtent` a segment): the
 * LATTICE arm — the affine-A1 product's walls need their own crossing
 * enumeration and bounded work, and the finite groups' proven
 * `maxWordLength` root table is not that enumeration; and a system whose
 * core has no slab certificate at all ({@link slabSupported4} false — a
 * swirl final lens or a condensation shape), whose point queries the
 * inner entries refuse too. A finite group with a supported core
 * composes instead: the split vocabulary (`tiling.ts`'s
 * {@link tilingSlabPieces}) divides the segment at the wall crossings and
 * folds each piece, the inner core answers each straight folded piece —
 * its own SEGMENT machinery where the fold set is segment-exact
 * ({@link slabExact4}: affine and boxfold), and the BOUNDED MIDPOINT
 * COVER where it is not (spherefold/mandelbox, recursive maps or the
 * final lens): the cover's certificate is sound PER PIECE by the same
 * triangle-inequality argument it makes untiled, so the composition is
 * `min_j max(coverCert_j, clipSdf(mid_j) - halfLen_j)` — bounded work
 * (`pieces x SLAB_COVER_PIECES` point descents), no new
 * soundness surface. The clip is intersected PER PIECE — the composition
 * the split's module doc derives. Point queries keep the fold-once
 * composition below in every arm. Named for context but enforced by
 * routing: infinite lattice + Balloon has no finite enclosing ball.
 * Finite Balloon wraps these public estimators after dimensional
 * reduction, with the certified origin-centred visible ball. H4/reducible-group refusals
 * live in the group vocabulary itself (`tiling.ts`'s `TILING_GROUPS`).
 * Kaleidoscope is part of the untouched core's set A: the same nearest-copy
 * proof accepts it in every supported dimension and core family, without
 * commuting its sector sweep/wedge fold past the tiling. This transports
 * the core's existing approximation; it does not improve that approximation.
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

/** The slab routing gate for a REAL segment under tiling. Lattice tiling
 * still refuses outright: the affine-A1 product's walls need their own
 * crossing enumeration and bounded work, and the finite groups' proven
 * `maxWordLength` root table is not that enumeration. A finite group
 * composes through the split vocabulary (`tiling.ts`'s
 * {@link tilingSlabPieces}) wherever the core has a slab certificate at
 * all ({@link slabSupported4}): a segment-exact fold set
 * ({@link slabExact4}: affine and boxfold) takes the split's own segment
 * machinery per piece, and a nonlinear one (spherefold/mandelbox,
 * recursive or in the final lens) takes the BOUNDED MIDPOINT COVER per
 * piece — the cover's triangle-inequality certificate is sound over each
 * folded straight piece exactly as it is over the untiled segment, so
 * the composition is the split's `min_j` over `max(coverCert_j,
 * clipSdf(mid_j) - halfLen_j)` with `coverCert_j` the cover's bound on
 * that piece, bounded work (`pieces x SLAB_COVER_PIECES` point
 * descents), no new soundness surface. Only the core-wide refusals
 * (condensation, a swirl final lens) and the lattice arm stay — each
 * names itself, and nothing silently clamps after the control is
 * enabled. Returns the finite arm, narrowed for the split's `info`
 * reads. */
function assertFiniteSlab4(
  tiling: ResolvedTiling,
  de: SurfaceDE4,
): ResolvedFiniteTiling {
  if (isResolvedLatticeTiling(tiling)) {
    throw new Error(
      "tiling-de: slab queries are refused under lattice tiling — the " +
        "affine-A1 product's walls need their own crossing enumeration " +
        "and bounded work (the finite groups' root table is not that " +
        "enumeration, docs/tiling-contract.md); tiled lattice 4D sessions " +
        "run slice 0",
    );
  }
  if (!slabSupported4(de)) {
    throw new Error(
      "tiling-de: slab queries are refused for this system's nonlinear " +
        "final lens (swirl) or condensation shape — the tiled composition " +
        "needs the core's own point certificate first (slabSupported4); " +
        "clamp sliceHalfW to 0 for this system",
    );
  }
  return tiling;
}

/** The finite slab answer over the split's folded pieces:
 * `min_j max(coreDE(F_j), clipSdf(mid_j) − halfLen_j)` — the composition
 * the split vocabulary's module doc derives, with the DE and clip
 * combined PER PIECE so the intersection stays at one segment parameter.
 * Each piece's `coreDE` is the inner public entry's own answer at the
 * piece's extent: the segment machinery where the fold set is exact
 * ({@link slabExact4}), the bounded midpoint cover where it is not —
 * whose certificate is sound over the straight folded piece by the same
 * argument it makes untiled. The cutoff threads RAW into each piece's
 * entry, whose own machinery prices its slack: the segment descent none
 * (exact), the cover `+ halfPiece` internally (its cutoff contract), so
 * a piece clearing the inflated early-out proves the piece clears
 * `cutoff`. A `null` split (a fold cap expiry, never by the proof)
 * returns 0 — fully conservative. */
function tiledSlabDistance4(
  tiling: ResolvedFiniteTiling,
  de: SurfaceDE4,
  p: Vec4,
  halfExtent: Vec4,
  cutoff: number,
  refined: boolean,
): number {
  const pieces = tilingSlabPieces(tiling.info, p, halfExtent);
  if (pieces === null) return 0;
  let bound = Infinity;
  for (const piece of pieces) {
    const halfLen = Math.hypot(
      piece.extent[0],
      piece.extent[1],
      piece.extent[2],
      piece.extent[3],
    );
    // The piece's cutoff threads RAW: each piece's own machinery prices
    // its slack (the segment descent is exact, so inflating its early-out
    // by halfLen would only saturate the piece's bound at `cutoff +
    // halfLen` — far above the marcher's acceptance epsilon — and step
    // the render straight through the object; measured on the A4-tiled
    // dust, the inflated form lost ~90% of the slab's hits). The cover
    // adds its own `halfPiece` internally, keeping the same contract.
    const inner = refined
      ? estimateDistance4Refined(de, piece.center, cutoff, piece.extent)
      : estimateDistance4(de, piece.center, piece.extent);
    let value = inner;
    if (tiling.clip) {
      value = Math.max(
        value,
        shapeSdf(
          tiling.clip,
          piece.center[0],
          piece.center[1],
          piece.center[2],
        ) - halfLen,
      );
    }
    if (value < bound) bound = value;
  }
  return bound > 0 ? bound : 0;
}

/** The paired sample twin of {@link tiledSlabDistance4}: both lanes get the
 * same per-piece narrowing max, and the min over pieces of each lane is the
 * query's safe step (every piece's pair lower-bounds that piece's distance,
 * so the nearest piece's bound governs the march). */
function tiledSlabSample4(
  tiling: ResolvedFiniteTiling,
  de: SurfaceDE4,
  p: Vec4,
  halfExtent: Vec4,
  cutoff: number,
  refined: boolean,
): SurfaceDistanceSample {
  const pieces = tilingSlabPieces(tiling.info, p, halfExtent);
  if (pieces === null) return { d: 0, stride: 0 };
  let bestD = Infinity;
  let bestStride = Infinity;
  for (const piece of pieces) {
    const halfLen = Math.hypot(
      piece.extent[0],
      piece.extent[1],
      piece.extent[2],
      piece.extent[3],
    );
    const inner = refined
      ? estimateDistance4RefinedSample(de, piece.center, cutoff, piece.extent)
      : estimateDistance4Sample(de, piece.center, piece.extent);
    let d = inner.d;
    let stride = inner.stride;
    if (tiling.clip) {
      const clip =
        shapeSdf(
          tiling.clip,
          piece.center[0],
          piece.center[1],
          piece.center[2],
        ) - halfLen;
      d = Math.max(d, clip);
      stride = Math.max(stride, clip);
    }
    if (d < bestD) bestD = d;
    if (stride < bestStride) bestStride = stride;
  }
  return {
    d: bestD > 0 ? bestD : 0,
    stride: bestStride > 0 ? bestStride : 0,
  };
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
 * no cutoff — nothing to thread). A real `halfExtent` routes through the
 * finite split ({@link tiledSlabDistance4}) — each folded piece answered
 * by the core's own segment machinery or midpoint cover — and refuses a
 * lattice arm or a core without a slab certificate; the routing gate's
 * doc names each reason. `null`/zero — the point query — keeps the
 * fold-once composition below unchanged.
 */
export function estimateDistance4Tiled(
  tiling: ResolvedTiling,
  de: SurfaceDE4,
  p: Vec4,
  halfExtent: Vec4 | null = null,
): number {
  if (isSegment(halfExtent)) {
    const finite = assertFiniteSlab4(tiling, de);
    return tiledSlabDistance4(finite, de, p, halfExtent, 0, false);
  }
  const folded = foldQuery4(tiling, p);
  if (folded === null) return 0;
  const q = folded;
  const inner = estimateDistance4(de, q, halfExtent);
  return finish4(tiling, q, inner);
}

/**
 * The 4D affine/fold wrapper over {@link estimateDistance4Refined} — the
 * refined 4D ladder one wrapper out. Same slab routing as
 * {@link estimateDistance4Tiled} (the gate's module doc), cutoff threaded
 * through unchanged (the cutoff contract composes with the max).
 */
export function estimateDistance4RefinedTiled(
  tiling: ResolvedTiling,
  de: SurfaceDE4,
  p: Vec4,
  cutoff = 0,
  halfExtent: Vec4 | null = null,
): number {
  if (isSegment(halfExtent)) {
    const finite = assertFiniteSlab4(tiling, de);
    return tiledSlabDistance4(finite, de, p, halfExtent, cutoff, true);
  }
  const folded = foldQuery4(tiling, p);
  if (folded === null) return 0;
  const q = folded;
  const inner = estimateDistance4Refined(de, q, cutoff, halfExtent);
  return finish4(tiling, q, inner);
}

/** The paired march sample follows the same fold/clip composition as the
 * scalar public estimator. Both lanes receive the same narrowing floor;
 * below-cutoff acceptance already equals stride in the core, so a rejecting
 * clip never exposes an inexact early-return stride. */
export function estimateDistanceSampleTiled(
  tiling: ResolvedTiling,
  de: SurfaceDE,
  p: Vec3,
  cutoff = 0,
  footprint = 0,
): SurfaceDistanceSample {
  const q = foldQuery3(tiling, p);
  if (!q) return { d: 0, stride: 0 };
  const inner = estimateDistanceSample(de, q, cutoff, footprint);
  return {
    d: finish3(tiling, q, inner.d),
    stride: finish3(tiling, q, inner.stride),
  };
}

/** Refined twin of the paired tiled march sample. */
export function estimateDistanceRefinedSampleTiled(
  tiling: ResolvedTiling,
  de: SurfaceDE,
  p: Vec3,
  cutoff = 0,
  footprint = 0,
): SurfaceDistanceSample {
  const q = foldQuery3(tiling, p);
  if (!q) return { d: 0, stride: 0 };
  const inner = estimateDistanceRefinedSample(de, q, cutoff, footprint);
  return {
    d: finish3(tiling, q, inner.d),
    stride: finish3(tiling, q, inner.stride),
  };
}

/** 4D paired twin; a real slab routes through the finite split
 * ({@link tiledSlabSample4}) under the same gate as the scalar entry. */
export function estimateDistance4SampleTiled(
  tiling: ResolvedTiling,
  de: SurfaceDE4,
  p: Vec4,
  halfExtent: Vec4 | null = null,
): SurfaceDistanceSample {
  if (isSegment(halfExtent)) {
    const finite = assertFiniteSlab4(tiling, de);
    return tiledSlabSample4(finite, de, p, halfExtent, 0, false);
  }
  const q = foldQuery4(tiling, p);
  if (!q) return { d: 0, stride: 0 };
  const inner = estimateDistance4Sample(de, q, halfExtent);
  return {
    d: finish4(tiling, q, inner.d),
    stride: finish4(tiling, q, inner.stride),
  };
}

/** Refined 4D paired twin, preserving the public cutoff argument and the
 * same slab routing. */
export function estimateDistance4RefinedSampleTiled(
  tiling: ResolvedTiling,
  de: SurfaceDE4,
  p: Vec4,
  cutoff = 0,
  halfExtent: Vec4 | null = null,
): SurfaceDistanceSample {
  if (isSegment(halfExtent)) {
    const finite = assertFiniteSlab4(tiling, de);
    return tiledSlabSample4(finite, de, p, halfExtent, cutoff, true);
  }
  const q = foldQuery4(tiling, p);
  if (!q) return { d: 0, stride: 0 };
  const inner = estimateDistance4RefinedSample(de, q, cutoff, halfExtent);
  return {
    d: finish4(tiling, q, inner.d),
    stride: finish4(tiling, q, inner.stride),
  };
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
