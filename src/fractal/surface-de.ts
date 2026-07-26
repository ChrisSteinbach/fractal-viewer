import { composeAffine } from "./affine";
import { isFlatTransform } from "./affine4";
import { effectiveSymmetryOrder, runChaosGame } from "./chaos-game";
import { mulberry32 } from "./rng";
import type { SymmetryAxis, SymmetryParams, Transform, Vec3 } from "./types";

/**
 * Surface distance estimation for an affine IFS (epic fr-7jlk).
 *
 * The chaos game applies maps FORWARD to a moving point; a distance
 * estimator (DE) applies INVERSE maps to an arbitrary query point, tracking
 * accumulated contraction so the final distance can be un-scaled — the KIFS
 * "dr *= scale" bookkeeping generalised to maps that are not folds of each
 * other. This module is the dependency-free CPU oracle the GLSL sphere-tracer
 * mirrors (`src/app/surface-material.ts`), the same oracle discipline as
 * `flame.ts` <-> `flame-gpu.ts`.
 *
 * VALIDITY. For an invertible affine `f` with linear part `M`,
 *
 *     dist(p, f(A)) >= sigma_min(M) * dist(f^-1(p), A)
 *
 * where `sigma_min` is the smallest singular value — equality only for
 * conformal maps (rotation/reflection + uniform scale), which is why
 * conformality determines eligibility quality. Using `sigma_min` (never the
 * mean or `sigma_max`) keeps the bound a true LOWER bound for anisotropic
 * maps: conservative = slower march, never overshoot artifacts. Combined with
 * the base case `dist(q, A) >= |q| - R` (the attractor sits inside the
 * bounding sphere of radius `R`), every branch of inverse-map descent yields
 * a certified bound for ITS piece of the attractor:
 *
 *     dist(p, f_j(A)) >= sigma_min_j * (|f_j^-1(p)| - R)
 *
 * A FULL bound on `dist(p, A) = min_j dist(p, f_j(A))` would need the whole
 * exponential branch tree, so {@link estimateDistance} descends a BEAM of
 * {@link SurfaceDE.beamWidth} chains (width 1 = the classic greedy descent
 * into the branch whose inverse image lands nearest the origin), unrolling
 * the recursion
 *
 *     dist(q, A) >= min( certificates of the NON-descended siblings,
 *                        sigma_min_g * dist(inv_g(q), A) )
 *
 * into: the min over every level's non-descended escaped-sibling
 * certificates, terminated by each descended chain's own final bound. A
 * descended candidate's shallow certificate is deliberately NOT folded in —
 * the next level refines that chain deeper, which is what keeps the
 * estimate tight near the surface (the classic KIFS last-value formula,
 * plus a sibling safety net so surfaces reachable through a shallower
 * branch are not overshot). Every term folded into the min is a valid lower
 * bound for ITS piece, so beam selection can never break validity — it only
 * decides which branches get REFINED instead of frozen (or, for in-sphere
 * branches, covered at all).
 *
 * Branches whose images stay INSIDE the sphere carry no positive
 * certificate; a level with more simultaneous in-sphere branches than the
 * beam has slots drops the excess uncounted, and the residual risk of that
 * drop is what the eligibility analysis' `stepScale` fudge (and the
 * marcher's hit epsilon) absorbs. Width 1 drops ANY second in-sphere
 * branch, and the fr-v6yg harness (`scripts/surface-beam.harness.ts`)
 * measured that overshooting for real across the board — worst on the
 * doubleRotation profile (2 maps, sigma 0.93/0.22: max excess ~19% of R),
 * but also on plain shipped presets (default 10.8%R, spiral 8.6%R,
 * pyramid 6.2%R), with no per-map sigma threshold separating the clean
 * systems from the overshooting ones — so the paired chains are
 * unconditional (~1.7-1.8x width 1's inverse applications, violations
 * collapse to the fp-noise floor on every measured 2-map system AND every
 * preset, and tightness IMPROVES since the second chain refines the
 * barely-escaped sibling certificates fr-beck measured every ghost back
 * to); width 1 remains only as the tests' pin of the single-chain
 * mechanism. Width 2's own measured residual — levels with 3+
 * SIMULTANEOUS in-sphere branches still dropped the excess (jerusalem
 * 3.6%R, m >= 3 slow maps ~2%R, sigma >= 0.96 ~2%R) — was fr-jkpn,
 * closed by the two VALIDITY SLOTS production builds add (width 4): a
 * second insert-shift ladder tracks each level's rank-3/4 candidates
 * exactly (fed by everything the top-2 ladder evicts), and those continue
 * as extra chains ONLY while in-sphere — the branches that carry no
 * positive certificate, whose silent drop was the invalidity — folding
 * the ordinary guarded certificate the moment they escape and no cap
 * terminal at all (see descend's terminal note). In-sphere keys are
 * negative and escaped keys positive, so the four slots hold EVERY
 * in-sphere branch until they run out — exhaustive coverage for m <= 2
 * (at most 4 candidates a level). Measured (fr-jkpn harness rerun,
 * CLOUD=300k, refined estimator, at the fr-xok8 depth ceiling): jerusalem
 * 38 violations @3.6%R -> 4 @0.003%R, default/spiral/pyramid/dodecahedron
 * -> 0, sigma-0.96 sweep real excess 2.3e-2 -> 0 (the surviving counts
 * are sub-5e-7 deep-descent fp noise), repro3 109 @2.1%R -> 85 @1.2%R
 * (m = 3 keeps dropping past four slots at its 127-level depth, and
 * wanderer terminals tick its void false hits 0 -> 2/435 — see descend's
 * terminal note), preset void false hits stay 0 everywhere, and cost
 * lands within +/-5% of width 2 on clean presets (validity slots only
 * occupy when a 3rd in-sphere branch EXISTS at a level) and +28% worst
 * (menger). The one profile no finite width can repair stays disclosed:
 * kaleidoscope copies of a ZERO-TRANSLATION near-isometric map tie their
 * image norms exactly, every chain re-spawns all `order` tied copies each
 * level (an order^depth tie tree), and rank selection cannot split exact
 * ties — repro2+sym4y holds ~9.8%R refined.
 *
 * Escaped-sibling certificates fold REFINED on the production path
 * (fr-1z6p — fr-beck's 4D ghost-eliminator carried back down): before a
 * non-descended escaped candidate freezes, one more Hutchinson level is
 * applied to its own inverse image ({@link estimateDistanceRefined}),
 * lifting the barely-escaped near-zero certificates that width 2 alone
 * still let false-hit in genuine voids (fr-v6yg record, w2 base:
 * voidFalseHit default 3/271, sierpinski 6/307, pyramid 6/251,
 * jerusalem 2/318 — rendered as smooth "balloon" membranes across
 * attractor voids). Measured after the port (same harness, CLOUD=300k):
 * width-2 refined voidFalseHits drop to 0 on EVERY system measured
 * (kaleidoscope stress profile included), tightness improves (sierpinski
 * DE/D p10 0.451 -> 0.646), validity is unchanged on every shipped preset
 * (jerusalem's fr-jkpn residual stayed 3.6%R until the width-4 validity
 * slots above closed it), and cost lands at ~2-4x inverse applications
 * over base thanks to the fold-time laziness guard.
 * Disclosed interaction (noted on fr-jkpn): kaleidoscope orders >= 3
 * multiply every branch, so the >= 3 simultaneous in-sphere drops that
 * break strict validity get COMMON there, and refinement — by raising
 * certificates elsewhere — exposes more of the invalid min the dropped
 * branches leave behind. Measured: the slow-map stress profile
 * (repro2+sym4y) deepens from 5.1%R to 9.8%R max excess; a fast-map
 * kaleidoscope (sierpinski x order-3 z) goes from 0 measured violations
 * (but 3/140 void probes ghosting) to 2/200 probes overshooting <= 2.6%R
 * (and 0 ghosts) — opposite-signed errors from the same dropped
 * branches, and the refined direction is the visually benign one. The
 * GLSL tracer marches the refined estimator; plain
 * {@link estimateDistance} remains the tests' mechanism seam alongside
 * width 1. Two properties worth noting:
 *
 * - A query point ON the attractor can never yield a positive bound: its
 *   true ancestor branch keeps the greedy image inside the sphere at every
 *   depth, so the estimate falls through to `<= 0` (a hit).
 * - Deep in a VOID, every image escapes within a few levels and the positive
 *   certificates measure the void's depth — the march crosses voids instead
 *   of stalling on the (useless, negative) bounding-sphere bound.
 *
 * SYMMETRY: SECTOR SWEEP, NOT A WEDGE FOLD (fr-x029). A kaleidoscope of
 * order `n` replicates every base map `f_i` into `n` copies `g_k . f_i`,
 * where `g_k` is the rotation by `2*pi*k/n` about `symmetry.axis` applied
 * AFTER the base map (`chaos-game.ts`'s `postRotations`). Those copies used
 * to be MATERIALISED: {@link buildSurfaceDE} emitted `n * m` composed
 * inverse maps and the GLSL mirror carried them in fixed 24-slot uniform
 * arrays, so high orders on multi-map systems were gated out of the mode
 * entirely by a slot budget. {@link SurfaceDE.maps} now holds the `m` BASE
 * inverses only, and the descent walks the `n` sectors by rotating each
 * chain point ONE step (`Rot_axis(-2*pi/n)`, the copy rotation's transpose)
 * per sector — `inv(M_i) . Rot_k^T . q` re-associated as
 * `inv(M_i) . (Rot_k^T . q)`. The uniform arrays are base-sized for ANY
 * order, while the candidate set, its enumeration ORDER (sector-major,
 * exactly the old slot order, so the insert-shift ladders break ties
 * identically), every key, every certificate and every terminal are the
 * ones the expansion produced. The beam, fr-jkpn's validity slots and
 * fr-55r5's cutoff exits are therefore untouched — this is a repacking, and
 * the validity argument above carries over verbatim instead of needing a
 * new one. Order 1 skips the rotation entirely, so every non-kaleidoscope
 * system (every shipped preset) stays bit-for-bit on its old numbers.
 *
 * WHY NOT THE KIFS FOLD. The tempting move is to fold the query into the
 * fundamental wedge by its own angle and scan the base maps once — O(m)
 * instead of O(n*m). It is UNSOUND here, and not marginally. The DE must
 * LOWER-bound the true distance, and `dist(p, A) = min over group
 * elements g of dist(g^-1 p, .)`; a fold commits to ONE `g` chosen by `p`'s
 * angle, so it minimises over a SUBSET and can only come out too HIGH — the
 * march steps through the surface. The argument that makes classic KIFS
 * mirror folds legitimate does not transfer: for a reflection across a
 * plane bounding a half-space `H` that CONTAINS the piece `S`,
 * `|q' - s|^2 - |q - s|^2 = 4 (q.n)(s.n) >= 0` for every `q, s` in `H`, so
 * folding provably cannot lose the argmin. Rotations admit no such
 * inequality, and this composition's pieces `f_i(A)` are not wedge-contained
 * in the first place — `g_k` is applied AFTER `f_i`, so a base map may land
 * its image at any angle whatsoever. Concretely at order 4 with `f_i(A)` a
 * blob at angle 5 deg: a query at 85 deg already sits INSIDE the fold's own
 * wedge [0, 90), so the fold keeps `k = 0` and certifies `2 sin 40 = 1.29`,
 * while the copy at 95 deg is `2 sin 5 = 0.17` away — a 7x over-estimate at
 * a point the fold does not even treat as a boundary case. Scanning the
 * fold's sector plus its two NEIGHBOURS repairs exactly what the inequality
 * `cos(wrap(d - k*alpha)) <= cos(wrap(d))` covers — with `q` and the piece
 * both inside ONE closed wedge, `|d| <= alpha` forces every `|k| >= 2`
 * sector to be no closer, so three sectors suffice — but its hypothesis is
 * precisely the wedge containment this composition does not give. A per-map
 * fold (choose `k` from the angle of `t_i` rather than of `p`) does recover
 * the exact per-map certificate MINIMUM in O(1), because the key and the
 * certificate are both monotone in the image radius — but only for
 * CONFORMAL maps, and the mode deliberately admits anisotropic ("degraded")
 * systems where that argmin has no closed form. It would be a fold that
 * stops being a lower bound exactly where the eligibility ladder is already
 * weakest. The sweep keeps the whole candidate set and pays O(n*m) inverse
 * applications, the same count the expansion paid; the SLOT budget, which
 * is what actually gated the mode, is what this change removes.
 *
 * BLEND. `SymmetryParams.blend` fades the rotated copies' SELECTION WEIGHTS
 * (`prepareChaosGame`), never their geometry, and the expansion never read
 * it: every copy sat in the DE's support at any blend, `0` included. The
 * sweep matches that inclusion rule exactly — `order` is the only symmetry
 * field it reads — so no blend value moves the estimated surface, just as
 * none did before.
 */

/** Per-map anisotropy ratio `sigma_max / sigma_min` at or below which the
 * system counts as conformal-enough to march at full speed. Shared with the
 * 4D twin (`surface-de-4d.ts`) — like `chaos-game-4d.ts` importing
 * `chaos-game.ts`'s constants, this keeps the two eligibility ladders from
 * ever drifting apart. */
export const CONFORMAL_RATIO = 1.05;

/** A map whose largest singular value reaches this stops counting as a
 * contraction (Hutchinson's condition for the IFS attractor to exist — and
 * for greedy inverse descent to terminate). */
export const CONTRACTION_LIMIT = 0.999;

/** Smallest singular value below which a map is treated as non-invertible
 * (a flat/degenerate map has no inverse to descend through). */
export const NEAR_SINGULAR_SIGMA = 1e-4;

/** Points drawn by the seeded bounding-radius probe. */
export const PROBE_POINTS = 8192;

/** Fixed seed for the bounding-radius probe: the DE for a given system must
 * be deterministic (tests, GLSL uniforms, and repeated builds all agree). */
export const PROBE_SEED = 0x5eedf00d;

/** Pad factor applied to the probe's sampled `maxR` — the probe sees a
 * finite sample of the attractor, whose true supremum sits slightly beyond. */
export const RADIUS_PAD = 1.05;

/** Descent stops once the tracked point escapes this multiple of `R`:
 * beyond it, deeper certificates cannot improve the min. */
export const ESCAPE_FACTOR = 2;

/** Accumulated-contraction floor that sizes {@link SurfaceDE.maxDepth}:
 * descend until the slowest map chain has shrunk features below ~1e-4. */
export const DEPTH_RESOLUTION = 1e-4;

/** Hard ceiling on {@link SurfaceDE.maxDepth}. Sized so every shipped
 * preset reaches {@link DEPTH_RESOLUTION} in full: the slowest preset map
 * (doubleRotation's sigma 0.93) needs ceil(ln 1e-4 / ln 0.93) = 127
 * levels. The previous ceiling of 48 clamped that to 0.93^48 ~ 0.031 —
 * rendered as a smooth SOLID BALL of radius ~0.047R at the slow map's
 * fixed point, the unresolved image of the bounding sphere under the
 * all-slow-map chain (fr-xok8: doubleRotation's surface render grew a fat
 * featureless ball at the spiral core; measured est = |p| - 0.0466 along
 * a ray into the origin at cap 48, properly resolved at 127). Maps with
 * sigma above 10^(-4/128) ~ 0.931 still clamp — their residual blobs
 * shrink 26x against the old ceiling (0.96: 0.141R -> 0.0054R) and stay
 * disclosed. Cost: the descent loop only runs deep while chains survive
 * (near the attractor, slow maps only — sigma below 0.825 never reaches
 * the old ceiling, let alone this one), the GLSL loop bound is already
 * the uMaxDepth uniform, and the render tier's march budgets + adaptive
 * strips bound every GPU submission regardless. Shared with the 4D twin
 * like the eligibility constants above. */
export const MAX_DESCENT_DEPTH = 128;

/** `prepareChaosGame`'s no-symmetry default, duplicated here because it is
 * private there; order 1 is the identity expansion for any axis. */
const NO_SYMMETRY: SymmetryParams = { order: 1, axis: "y" };

/** Smallest/largest singular value of a map's linear part. */
export interface MapSigmas {
  min: number;
  max: number;
}

export type SurfaceEligibilityStatus = "eligible" | "degraded" | "ineligible";

/** What {@link analyzeSurfaceSystem} feeds the DE build and the UI gate. */
export interface SurfaceEligibility {
  /**
   * `eligible`: every active map is conformal (to {@link CONFORMAL_RATIO})
   * — march at full step. `degraded`: anisotropic but marchable with
   * `stepScale` applied. `ineligible`: no valid distance estimator exists;
   * see `reasons`.
   */
  status: SurfaceEligibilityStatus;
  /** Human-readable blockers; non-empty exactly when `ineligible`. */
  reasons: string[];
  /** Worst per-map `sigma_max / sigma_min` over active maps (and the final
   * transform), `1` = perfectly conformal. */
  anisotropy: number;
  /** Suggested march step multiplier in (0, 1]: `1` when eligible, smaller
   * as anisotropy grows. Meaningful only when not `ineligible`. */
  stepScale: number;
  /** Singular values per INPUT transform (every map, weight-0 included),
   * indexed like `transforms`. */
  sigmas: MapSigmas[];
}

/** One BASE (un-rotated) inverse map of the DE. Kaleidoscope copies are not
 * slots any more — the descent sweeps sectors around these (fr-x029; see the
 * module doc's symmetry section). */
export interface SurfaceDEMap {
  /** Row-major 3x3 `inv(M_i)` — the base map's inverse linear part. The
   * sector sweep un-rotates the chain point by `Rot_k^T` BEFORE applying
   * this (kaleidoscope copies rotate AFTER the base map, so their inverses
   * un-rotate first). */
  invM: number[];
  /** `-inv(M_i) . t_i` — shared by every sector of base map `i`. */
  invT: Vec3;
  /** Smallest singular value of the FORWARD map — the certified contraction
   * factor multiplied into the running `dr` product. */
  sigmaMin: number;
  /** Which input transform this slot inverts — the index into the caller's
   * `transforms`, for per-transform coloring. */
  baseIndex: number;
}

/** The kaleidoscope the descent sweeps instead of expanding (fr-x029). */
export interface SurfaceSymmetry {
  /** Effective sector count — `effectiveSymmetryOrder` against the FULL
   * transform list, exactly as `prepareChaosGame` clamps it. `1` = no
   * kaleidoscope, and the descent then skips sector rotation entirely. */
  order: number;
  /** Axis the sectors turn about. */
  axis: SymmetryAxis;
  /** `cos`/`sin` of ONE forward sector step `2*pi/order`. The descent walks
   * sectors incrementally off these — no per-sector transcendental, and the
   * GLSL mirror gets the pair as a single `vec2` uniform instead of an
   * order-sized table it could not afford. `1`/`0` at order 1. */
  stepCos: number;
  stepSin: number;
}

/** Everything the marcher needs, precomputed: the wire format the GLSL
 * uniforms are packed from. */
export interface SurfaceDE {
  /** BASE inverse maps — weight-0 maps contribute no slots (they are never
   * selected, so they add nothing to the attractor), and kaleidoscope copies
   * contribute none either: {@link symmetry} replaces the old expansion, so
   * this array is base-sized at any order (fr-x029). */
  maps: SurfaceDEMap[];
  /** Kaleidoscope sectors swept around every {@link maps} entry. */
  symmetry: SurfaceSymmetry;
  /** Bounding-sphere radius of the RAW attractor (pre-final-transform),
   * probed by a seeded chaos game and padded. */
  boundingRadius: number;
  /** Radius bounding the VISIBLE set `F(attractor)` — equals
   * `boundingRadius` when there is no final transform. */
  visibleBoundingRadius: number;
  /** `ESCAPE_FACTOR * boundingRadius` — descent past this cannot help. */
  escapeRadius: number;
  /** Descent depth cap, sized so the SLOWEST contraction chain resolves
   * features below {@link DEPTH_RESOLUTION}. */
  maxDepth: number;
  /** How many descent chains {@link estimateDistance} refines in parallel.
   * Widths 1/2 are the classic greedy chain and the fr-v6yg pair; widths
   * 3/4 add the fr-jkpn VALIDITY slots — extra chains that hold the level's
   * rank-3/4 candidates ONLY while their points are in-sphere (an escaped
   * rank-3/4 candidate folds its refined certificate instead, exactly as it
   * would without the slots), so levels with three or four simultaneous
   * in-sphere branches no longer drop the excess uncounted.
   * {@link buildSurfaceDE} always emits 4 (see the module doc for the
   * measured verdict); 1 and 2 exist so tests can pin each mechanism. The
   * GLSL tracer hardcodes the production width. */
  beamWidth: 1 | 2 | 3 | 4;
  /** March step multiplier from {@link analyzeSurfaceSystem}. */
  stepScale: number;
  /** Pre-inverted final-transform lens (the plotted set is `F(attractor)`),
   * or `null`. Applied ONCE to the query point; the result is un-scaled by
   * its `sigmaMin`. */
  final: { invM: number[]; invT: Vec3; sigmaMin: number } | null;
}

/** Mirrors `composeVariations`' active filter exactly: a variation entry
 * only warps space when its weight is finite and nonzero, so THAT is the
 * eligibility criterion — not the mere presence of the array. */
function hasActiveVariations(t: Transform): boolean {
  return (
    t.variations?.some((v) => Number.isFinite(v.weight) && v.weight !== 0) ??
    false
  );
}

/** `transform.weight ?? 1 > 0` — the maps that can ever be selected, i.e.
 * the maps whose images make up the attractor. */
function isActive(t: Transform): boolean {
  return (t.weight ?? 1) > 0;
}

/**
 * Singular values of a row-major 3x3 via the closed-form (trigonometric)
 * eigenvalues of the symmetric `M^T M` — deterministic, no iteration. The
 * `sqrt` of the extreme eigenvalues are `sigma_max` / `sigma_min`.
 */
export function singularValues3(m: number[]): MapSigmas {
  // A = M^T M (symmetric, so six unique entries).
  const a00 = m[0] * m[0] + m[3] * m[3] + m[6] * m[6];
  const a11 = m[1] * m[1] + m[4] * m[4] + m[7] * m[7];
  const a22 = m[2] * m[2] + m[5] * m[5] + m[8] * m[8];
  const a01 = m[0] * m[1] + m[3] * m[4] + m[6] * m[7];
  const a02 = m[0] * m[2] + m[3] * m[5] + m[6] * m[8];
  const a12 = m[1] * m[2] + m[4] * m[5] + m[7] * m[8];

  const q = (a00 + a11 + a22) / 3;
  const p1 = a01 * a01 + a02 * a02 + a12 * a12;
  const p2 =
    (a00 - q) * (a00 - q) +
    (a11 - q) * (a11 - q) +
    (a22 - q) * (a22 - q) +
    2 * p1;
  if (p2 <= 1e-30) {
    // A is (numerically) q·I: a uniform scale, possibly rotated.
    const s = Math.sqrt(Math.max(q, 0));
    return { min: s, max: s };
  }
  const p = Math.sqrt(p2 / 6);
  // B = (A - q·I) / p, then det(B)/2 ∈ [-1, 1] up to rounding.
  const b00 = (a00 - q) / p;
  const b11 = (a11 - q) / p;
  const b22 = (a22 - q) / p;
  const b01 = a01 / p;
  const b02 = a02 / p;
  const b12 = a12 / p;
  const detB =
    b00 * (b11 * b22 - b12 * b12) -
    b01 * (b01 * b22 - b12 * b02) +
    b02 * (b01 * b12 - b11 * b02);
  const r = Math.min(1, Math.max(-1, detB / 2));
  const phi = Math.acos(r) / 3;
  const lambdaMax = q + 2 * p * Math.cos(phi);
  const lambdaMin = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  return {
    min: Math.sqrt(Math.max(lambdaMin, 0)),
    max: Math.sqrt(Math.max(lambdaMax, 0)),
  };
}

/** Singular values of a transform's linear part. Without shear,
 * `M = R · diag(scale)` and the singular values are exactly `|scale|`
 * (closed form, no eigen solve); with shear, fall through to
 * {@link singularValues3} on the composed matrix. */
export function transformSigmas(t: Transform): MapSigmas {
  const { shear } = t;
  if (!shear || (shear[0] === 0 && shear[1] === 0 && shear[2] === 0)) {
    const sx = Math.abs(t.scale[0]);
    const sy = Math.abs(t.scale[1]);
    const sz = Math.abs(t.scale[2]);
    return {
      min: Math.min(sx, sy, sz),
      max: Math.max(sx, sy, sz),
    };
  }
  return singularValues3(composeAffine(t).m);
}

/**
 * Classify a system for the surface render mode: does a valid distance
 * estimator exist, and how fast can it be marched? Weight-0 maps are ignored
 * (they are never selected, so they add nothing to the attractor); the final
 * transform is held to invertibility but NOT contraction (it is a lens
 * applied once, not an iterated map). Symmetry never affects eligibility —
 * kaleidoscope copies are rotations of maps already analyzed.
 */
export function analyzeSurfaceSystem(
  transforms: Transform[],
  finalTransform: Transform | null = null,
): SurfaceEligibility {
  const reasons: string[] = [];
  const sigmas = transforms.map(transformSigmas);
  const active = transforms.filter(isActive);
  let anisotropy = 1;

  if (transforms.length === 0) {
    reasons.push("no transforms");
  } else if (active.length === 0) {
    reasons.push("every transform has weight 0");
  }

  transforms.forEach((t, i) => {
    if (!isActive(t)) return;
    const label = `map ${i + 1}`;
    if (hasActiveVariations(t)) {
      reasons.push(`${label} uses variations`);
    }
    if (!isFlatTransform(t)) {
      reasons.push(`${label} extends into 4D`);
    }
    const s = sigmas[i];
    if (s.min < NEAR_SINGULAR_SIGMA) {
      reasons.push(`${label} is nearly flat (scale ≈ 0)`);
    } else if (s.max >= CONTRACTION_LIMIT) {
      reasons.push(`${label} does not contract`);
    } else {
      anisotropy = Math.max(anisotropy, s.max / s.min);
    }
  });

  if (finalTransform) {
    if (hasActiveVariations(finalTransform)) {
      reasons.push("final transform uses variations");
    }
    if (!isFlatTransform(finalTransform)) {
      reasons.push("final transform extends into 4D");
    }
    const s = transformSigmas(finalTransform);
    if (s.min < NEAR_SINGULAR_SIGMA) {
      reasons.push("final transform is nearly flat (scale ≈ 0)");
    } else {
      anisotropy = Math.max(anisotropy, s.max / s.min);
    }
  }

  const status: SurfaceEligibilityStatus =
    reasons.length > 0
      ? "ineligible"
      : anisotropy <= CONFORMAL_RATIO
        ? "eligible"
        : "degraded";
  const stepScale =
    status === "eligible"
      ? 1
      : Math.min(0.9, Math.max(0.55, 0.95 / anisotropy));
  return { status, reasons, anisotropy, stepScale, sigmas };
}

/** Row-major 3x3 inverse via adjugate/determinant. The eligibility gate
 * guarantees `|det| >= sigma_min^3 > 0` for every map this is called on. */
function inverse3(m: number[]): number[] {
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  const inv = 1 / det;
  return [
    (m[4] * m[8] - m[5] * m[7]) * inv,
    (m[2] * m[7] - m[1] * m[8]) * inv,
    (m[1] * m[5] - m[2] * m[4]) * inv,
    (m[5] * m[6] - m[3] * m[8]) * inv,
    (m[0] * m[8] - m[2] * m[6]) * inv,
    (m[2] * m[3] - m[0] * m[5]) * inv,
    (m[3] * m[7] - m[4] * m[6]) * inv,
    (m[1] * m[6] - m[0] * m[7]) * inv,
    (m[0] * m[4] - m[1] * m[3]) * inv,
  ];
}

/**
 * One sector step of the kaleidoscope sweep (fr-x029): turn `(x, y, z)`
 * BACKWARD by `2*pi/order` about `axis`, writing into `out` so the descent's
 * hot loop never allocates.
 *
 * This is the TRANSPOSE of `chaos-game.ts`'s `symmetryRotation(axis, +step)`
 * — copy `k` rotates forward after its base map, so descending through that
 * copy un-rotates first — and `symmetryRotation` is `rotationMatrixXYZ` with
 * a single nonzero Euler angle, i.e. the plain right-handed rotation about
 * that axis. Transposing flips the sign of `sin` alone, which is why one
 * `(cos, sin)` pair of the FORWARD step drives every sector.
 */
function stepSector(
  axis: SymmetryAxis,
  c: number,
  s: number,
  x: number,
  y: number,
  z: number,
  out: number[],
): void {
  if (axis === "x") {
    out[0] = x;
    out[1] = c * y + s * z;
    out[2] = -s * y + c * z;
  } else if (axis === "y") {
    out[0] = c * x - s * z;
    out[1] = y;
    out[2] = s * x + c * z;
  } else {
    out[0] = c * x + s * y;
    out[1] = -s * x + c * y;
    out[2] = z;
  }
}

/**
 * Precompute the {@link SurfaceDE} for a system: analytically inverted BASE
 * maps, the kaleidoscope the descent sweeps around them (same
 * `effectiveSymmetryOrder` clamp against the FULL transform list
 * `prepareChaosGame` applies, so the swept set is the plotted set),
 * per-map `sigma_min`, a probed bounding radius, and the pre-inverted
 * final-transform lens.
 *
 * Throws when the system is ineligible ({@link analyzeSurfaceSystem}) — the
 * app gates on the analysis first, so reaching the throw is a bug.
 */
export function buildSurfaceDE(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = NO_SYMMETRY,
): SurfaceDE {
  const analysis = analyzeSurfaceSystem(transforms, finalTransform);
  if (analysis.status === "ineligible") {
    throw new Error(
      `system has no surface distance estimator: ${analysis.reasons.join("; ")}`,
    );
  }

  // Base inverses, one per ACTIVE map — the whole array, at any symmetry
  // order (fr-x029). The kaleidoscope copy k applies its rotation AFTER the
  // base map (chaos-game.ts postRotations), so copy (k, i) is
  // p -> Rot_k · (M_i p + t_i), whose inverse is
  // q -> inv(M_i) · (Rot_k^T · q) - inv(M_i) · t_i — a base inverse applied
  // to the point ALREADY turned into sector k, which is exactly what the
  // descent's sector sweep feeds it. Nothing per-copy is left to store.
  const maps: SurfaceDEMap[] = [];
  transforms.forEach((t, i) => {
    if (!isActive(t)) return;
    const affine = composeAffine(t);
    const invM = inverse3(affine.m);
    const [tx, ty, tz] = affine.t;
    const invT: Vec3 = [
      -(invM[0] * tx + invM[1] * ty + invM[2] * tz),
      -(invM[3] * tx + invM[4] * ty + invM[5] * tz),
      -(invM[6] * tx + invM[7] * ty + invM[8] * tz),
    ];
    maps.push({ invM, invT, sigmaMin: analysis.sigmas[i].min, baseIndex: i });
  });

  // Sector count mirroring prepareChaosGame: the effective order is clamped
  // against the FULL list length (weight-0 slots included), so the swept set
  // is the plotted set. `blend` is deliberately not read — it fades copy
  // WEIGHTS, never geometry, and the expansion this replaces ignored it too
  // (module doc, BLEND).
  const order = effectiveSymmetryOrder(symmetry.order, transforms.length);
  const step = (2 * Math.PI) / order;

  // Bounding radius of the RAW attractor: seeded probe of the exact plotted
  // set (full transform list + symmetry, but NO final transform — the DE
  // descends the raw attractor and applies the lens to the query instead).
  const probe = runChaosGame(
    transforms,
    PROBE_POINTS,
    mulberry32(PROBE_SEED),
    null,
    symmetry,
  );
  const boundingRadius = probe.bounds.maxR * RADIUS_PAD + 1e-3;

  // Depth cap from the SLOWEST contraction: the largest per-level shrink
  // factor bounds how many levels matter before features drop below
  // resolution (ceiling: see MAX_DESCENT_DEPTH's fr-xok8 sizing note).
  const slowest = maps.reduce((acc, b) => Math.max(acc, b.sigmaMin), 0);
  const maxDepth = Math.min(
    MAX_DESCENT_DEPTH,
    Math.max(8, Math.ceil(Math.log(DEPTH_RESOLUTION) / Math.log(slowest))),
  );

  let final: SurfaceDE["final"] = null;
  let visibleBoundingRadius = boundingRadius;
  if (finalTransform) {
    const affine = composeAffine(finalTransform);
    const invM = inverse3(affine.m);
    const [tx, ty, tz] = affine.t;
    const invT: Vec3 = [
      -(invM[0] * tx + invM[1] * ty + invM[2] * tz),
      -(invM[3] * tx + invM[4] * ty + invM[5] * tz),
      -(invM[6] * tx + invM[7] * ty + invM[8] * tz),
    ];
    const s = transformSigmas(finalTransform);
    final = { invM, invT, sigmaMin: s.min };
    // |F(x)| <= sigma_max·|x| + |t| bounds the visible set F(attractor).
    visibleBoundingRadius = s.max * boundingRadius + Math.hypot(tx, ty, tz);
  }

  return {
    maps,
    symmetry: {
      order,
      axis: symmetry.axis,
      // Exact at order 1 (cos 2pi = 1, sin 2pi = 0 only up to rounding), so
      // the descent's order-1 short circuit is what actually guarantees
      // bit-identical non-kaleidoscope behavior, not these two numbers.
      stepCos: Math.cos(step),
      stepSin: Math.sin(step),
    },
    boundingRadius,
    visibleBoundingRadius,
    escapeRadius: ESCAPE_FACTOR * boundingRadius,
    maxDepth,
    beamWidth: 4,
    stepScale: analysis.stepScale,
    final,
  };
}

/**
 * Reference DE the GLSL marcher mirrors: beam inverse-map descent with
 * sibling-certificate tracking (see the module doc for the validity
 * argument). Width 1 is the classic greedy descent, value-equivalent to
 * the pre-fr-v6yg estimator; width 2 keeps a second chain alive so a
 * second simultaneous in-sphere branch is refined instead of dropped;
 * widths 3/4 add the fr-jkpn validity slots — rank-3/4 chains that live
 * only while in-sphere, closing the 3-and-4-simultaneous drops.
 *
 * At each level every live chain's inverse images are computed and ranked
 * by the selection key `chainScale · (r - R)` — within one chain that is
 * the classic nearest-the-origin greedy order, and across chains it weighs
 * each branch by the contraction already accumulated, so the beam always
 * refines the candidates whose pieces could still hide the nearest
 * surface. The best candidate continues as chain A, the runner-up as chain
 * B (width 2 up); ranks 3/4 continue as validity chains V1/V2 while
 * in-sphere (widths 3/4); every OTHER candidate that escaped the bounding
 * sphere folds its frozen certificate `chainScale · sigma_min_j · (r - R)`
 * — a certified lower bound on the distance to THAT piece — into the
 * running min. A chain dies once its point escapes past `escapeRadius`
 * (deeper refinement cannot improve the min), folding its terminal
 * `chainScale' · (r - R)` bound; chains A/B still alive at the depth cap
 * fold the same terminal (the KIFS last-value formula; validity chains
 * fold none — see the terminal note in descend). The estimate is the min
 * over all folded terms, never beaten by the depth-0 sphere bound
 * `|p| - R`. A point tracking the attractor's occupied region the whole
 * way down ends `<= 0`; the MARCHER floors at its epsilon, not this
 * function, so callers see the raw (possibly negative) bound.
 */
export function estimateDistance(de: SurfaceDE, p: Vec3): number {
  return descend(de, p, false);
}

/**
 * Certificate-refinement variant of {@link estimateDistance} — the fr-beck
 * ghost-eliminator (`estimateDistance4Refined`) ported back down to 3D
 * (fr-1z6p): identical beam descent, terminal KIFS bound, depth-0 sphere
 * floor, and final-transform lens prologue/epilogue — the only change is
 * what certificate an ESCAPED sibling (`r_j > R`) earns. The base version
 * stops at one Hutchinson level (`sigmaMin_j * (r_j - R)`); this variant
 * applies one MORE level before settling:
 *
 *     inner_j = min over ALL maps k of [ sigmaMin_k * (|invMap_k(q'_j)| - R) ]
 *     cert_j  = sigmaMin_j * max( r_j - R, inner_j )
 *
 * Validity is the 4D twin's argument verbatim (dimension-free): each
 * `inner_j` term lower-bounds `dist(q'_j, f_k(A))` regardless of sign, so
 * their min lower-bounds `dist(q'_j, A)`, and `max`ing against the
 * untouched base case can only RAISE the certificate — never below the
 * base estimate, pinned by the test suite.
 *
 * WHY 3D NEEDS IT TOO. The fr-v6yg record showed the shipped width-2 BASE
 * estimator still false-hitting in genuine voids on plain presets
 * (voidFalseHit default 3/271, sierpinski 6/307, pyramid 6/251,
 * jerusalem 2/318) — rendered as smooth "balloon" membranes spanning
 * attractor voids, the same barely-escaped-sibling mechanism fr-beck
 * measured every 4D ghost back to. The beam refines only the per-level
 * runner-up; every OTHER barely-escaped sibling still froze a near-zero
 * plain certificate. Refinement closes those: measured on the fr-v6yg
 * harness, 3D voidFalseHits drop to 0 on every preset (fr-jkpn's
 * kaleidoscope-tie/slow-map residuals excepted) with validity unchanged.
 *
 * COST. Refinement is paid lazily at FOLD time, and — new over the 4D
 * original, backported there in the same change — only when the fold could
 * matter: refinement can only RAISE a certificate, so a fold whose PLAIN
 * certificate already fails to beat the running min folds nothing either
 * way (`min(best, refined) === best` whenever `plain >= best`). Skipping
 * those is bit-exact and caps the extra inverse sweeps at the folds that
 * actually advance the min — the barely-escaped ghosts among them —
 * instead of every escaped sibling (the unguarded 4D shape measured
 * 95 -> 1504 apps/call on 16-map tesseract; 3D's symmetry expansion goes
 * to 24 slots).
 *
 * EARLY-OUT CUTOFF (fr-55r5). A sphere-tracing march does not need the
 * distance at every step — it needs to know whether the bound has dropped
 * under its acceptance epsilon. `cutoff` is that epsilon (the marcher's
 * per-step hit threshold at the query point); the descent may then stop the
 * moment the value it would return is already below it. Contract:
 *
 * - `cutoff <= 0` (the default) — the full descent, bit-for-bit. Every
 *   caller that needs the VALUE rather than a hit decision passes it:
 *   normal probes, ambient-occlusion taps, shadow rays, every test.
 * - `cutoff > 0` — if the returned value is `>= cutoff` it EQUALS the
 *   `cutoff = 0` result bit-for-bit (an early exit only ever returns a
 *   value below the cutoff, so march step sizes above the hit threshold
 *   never drift); if it is `< cutoff`, the `cutoff = 0` result is `< cutoff`
 *   too (the hit decision is identical — no false hit, no lost hit).
 *
 * Both properties rest on the descent being MONOTONE and on the exit test
 * reading only FINALIZED terms. Monotone: the returned value is
 * `max(best, sphereBound) * finalScale`, `best` only ever falls as terms
 * fold, and the other two are fixed by the prologue — so a value already
 * under the cutoff can never climb back. Finalized: `best` is only ever
 * ASSIGNED a settled term — on this refined path the fold sites write the
 * REFINED certificate, never the plain key that gates it — so the running
 * min is at all times a min over terms the full computation also contains.
 * Testing a raw pre-refinement certificate instead would re-open exactly
 * the ghost class refinement exists to kill: a barely-escaped sibling dips
 * under the cutoff, the full descent lifts it back above, and the march
 * paints a balloon membrane across a void.
 */
export function estimateDistanceRefined(
  de: SurfaceDE,
  p: Vec3,
  cutoff = 0,
): number {
  return descend(de, p, true, cutoff);
}

/** The descent's return value for a running min: the folded terms' min
 * floored by the depth-0 sphere bound, then un-scaled by the final lens.
 * The loop's own tail and every {@link estimateDistanceRefined} cutoff exit
 * land here, so an early exit cannot drift from the full result it stands
 * in for. */
function descentValue(
  best: number,
  sphereBound: number,
  finalScale: number,
): number {
  let d = best;
  if (sphereBound > d) d = sphereBound;
  return d * finalScale;
}

/**
 * Shared beam-descent body for {@link estimateDistance} (`refine` false:
 * plain frozen certificates) and {@link estimateDistanceRefined} (`refine`
 * true: one extra Hutchinson level on the folds that beat the running
 * min). One body, not two: unlike the 4D twin (whose two estimators
 * predate the guard and stay self-contained), the refined 3D descent IS
 * the plain descent with three fold sites upgraded, and duplicating the
 * ~100-line skeleton would leave the mirrors to drift. The GLSL tracer
 * mirrors the `refine === true` path line for line.
 *
 * `cutoff` is {@link estimateDistanceRefined}'s early-out threshold (see its
 * doc for the contract and why the exits sit where they sit); `0` — what
 * {@link estimateDistance} always passes — disables it entirely.
 */
function descend(de: SurfaceDE, p: Vec3, refine: boolean, cutoff = 0): number {
  let x = p[0];
  let y = p[1];
  let z = p[2];
  let finalScale = 1;
  if (de.final) {
    const f = de.final;
    const qx = f.invM[0] * x + f.invM[1] * y + f.invM[2] * z + f.invT[0];
    const qy = f.invM[3] * x + f.invM[4] * y + f.invM[5] * z + f.invT[1];
    const qz = f.invM[6] * x + f.invM[7] * y + f.invM[8] * z + f.invT[2];
    x = qx;
    y = qy;
    z = qz;
    finalScale = f.sigmaMin;
  }

  // Kaleidoscope sectors swept around the base maps (fr-x029) — `order` 1
  // leaves every `k > 0` branch below dead, so a system without symmetry
  // runs the pre-sweep arithmetic unchanged. Two scratch triples, never one:
  // `refinedCert` sweeps from inside the candidate loop's own sweep.
  const { order, axis, stepCos, stepSin } = de.symmetry;
  const sweep = [0, 0, 0];
  const certSweep = [0, 0, 0];

  const R = de.boundingRadius;
  const startR = Math.sqrt(x * x + y * y + z * z);
  const sphereBound = startR - R;
  const wide = de.beamWidth > 1;
  let best = Infinity;

  // Early-out threshold (fr-55r5): the value below which the descent may
  // stop and hand the caller what it has. `-Infinity` disables the test —
  // for `cutoff <= 0` (callers that need the distance itself), and for a
  // depth-0 sphere floor that already holds the answer at or above the
  // cutoff no matter how far `best` falls, since the floor is what the
  // return would clamp to. Both exits below test `best * finalScale`
  // against it AFTER a fold, never a raw pre-refinement key.
  const bailBelow =
    cutoff > 0 && sphereBound * finalScale < cutoff ? cutoff : -Infinity;

  // One extra Hutchinson level on a frozen escaped candidate's own inverse
  // image, over every map k (see estimateDistanceRefined's doc): the
  // certificate becomes childScale * max(r - R, inner) — never below the
  // plain childScale * (r - R). Only called on the refined path, and only
  // for folds whose plain certificate beats the running min.
  const refinedCert = (
    ix: number,
    iy: number,
    iz: number,
    r: number,
    childScale: number,
  ): number => {
    let inner = Infinity;
    // The inner Hutchinson level sweeps the same sectors the candidate loop
    // does — "over every map" means every (sector, base map) pair, which is
    // what the expanded list used to spell out.
    let sx = ix;
    let sy = iy;
    let sz = iz;
    for (let k = 0; k < order; k++) {
      if (k > 0) {
        stepSector(axis, stepCos, stepSin, sx, sy, sz, certSweep);
        sx = certSweep[0];
        sy = certSweep[1];
        sz = certSweep[2];
      }
      for (let j = 0; j < de.maps.length; j++) {
        const mapJ = de.maps[j];
        const imJ = mapJ.invM;
        const itJ = mapJ.invT;
        const jx = imJ[0] * sx + imJ[1] * sy + imJ[2] * sz + itJ[0];
        const jy = imJ[3] * sx + imJ[4] * sy + imJ[5] * sz + itJ[1];
        const jz = imJ[6] * sx + imJ[7] * sy + imJ[8] * sz + itJ[2];
        const rj = Math.sqrt(jx * jx + jy * jy + jz * jz);
        const innerTerm = mapJ.sigmaMin * (rj - R);
        if (innerTerm < inner) inner = innerTerm;
      }
    }
    return childScale * Math.max(r - R, inner);
  };

  // Chain slot A starts at the (lensed) query; slot B idles until beam
  // selection fills it (width-2 systems only). Each chain carries the
  // contraction accumulated INCLUDING its own map and the radius its point
  // was selected at — `scale · (r - R)` is its terminal bound. V1/V2 are
  // the fr-jkpn validity slots (widths 3/4): they hold the level's rank-3/4
  // candidates ONLY while those are in-sphere — branches that carry no
  // positive certificate, so dropping them was the measured invalidity —
  // and fold the ordinary refined certificate the moment they escape.
  const extra = de.beamWidth - 2;
  let aX = x;
  let aY = y;
  let aZ = z;
  let aScale = 1;
  let aR = startR;
  let aLive = true;
  let bX = 0;
  let bY = 0;
  let bZ = 0;
  let bScale = 1;
  let bR = 0;
  let bLive = false;
  // Validity chains carry no R field: unlike A/B they never fold a
  // terminal (see the note past the loop), and expansion re-derives every
  // child radius, so the selection radius is dead weight once occupancy
  // is decided.
  let v1X = 0;
  let v1Y = 0;
  let v1Z = 0;
  let v1Scale = 1;
  let v1Live = false;
  let v2X = 0;
  let v2Y = 0;
  let v2Z = 0;
  let v2Scale = 1;
  let v2Live = false;

  for (let depth = 0; depth < de.maxDepth; depth++) {
    if (!aLive && !bLive && !v1Live && !v2Live) break;
    // The two smallest-key candidates this level, key-ascending. The
    // sentinel r = 0 keeps empty slots out of every escaped-candidate fold
    // below (their certificates are meaningless until occupied).
    let c1Key = Infinity;
    let c1X = 0;
    let c1Y = 0;
    let c1Z = 0;
    let c1Scale = 1;
    let c1R = 0;
    let c1Cert = 0;
    let c2Key = Infinity;
    let c2X = 0;
    let c2Y = 0;
    let c2Z = 0;
    let c2Scale = 1;
    let c2R = 0;
    let c2Cert = 0;
    // Ranks 3/4, tracked the same way on widths 3/4 (a second insert-shift
    // ladder fed by everything the top-2 ladder evicts, so the pair holds
    // exactly the level's third- and fourth-smallest keys).
    let c3Key = Infinity;
    let c3X = 0;
    let c3Y = 0;
    let c3Z = 0;
    let c3Scale = 1;
    let c3R = 0;
    let c3Cert = 0;
    let c4Key = Infinity;
    let c4X = 0;
    let c4Y = 0;
    let c4Z = 0;
    let c4Scale = 1;
    let c4R = 0;
    let c4Cert = 0;
    for (let c = 0; c < 4; c++) {
      let pX: number;
      let pY: number;
      let pZ: number;
      let pScale: number;
      if (c === 0) {
        if (!aLive) continue;
        pX = aX;
        pY = aY;
        pZ = aZ;
        pScale = aScale;
      } else if (c === 1) {
        if (!bLive) continue;
        pX = bX;
        pY = bY;
        pZ = bZ;
        pScale = bScale;
      } else if (c === 2) {
        if (!v1Live) continue;
        pX = v1X;
        pY = v1Y;
        pZ = v1Z;
        pScale = v1Scale;
      } else {
        if (!v2Live) continue;
        pX = v2X;
        pY = v2Y;
        pZ = v2Z;
        pScale = v2Scale;
      }
      // Sector sweep (fr-x029): the chain point turns one step per
      // kaleidoscope sector and every BASE map is applied to it there, so
      // the candidates — and their SECTOR-MAJOR enumeration order, which is
      // exactly the order the expanded map list was built in — are the ones
      // the expansion produced. The ladders below therefore break ties the
      // same way, and the beam, the validity slots and the cutoff exits see
      // an unchanged stream.
      let sX = pX;
      let sY = pY;
      let sZ = pZ;
      for (let k = 0; k < order; k++) {
        if (k > 0) {
          stepSector(axis, stepCos, stepSin, sX, sY, sZ, sweep);
          sX = sweep[0];
          sY = sweep[1];
          sZ = sweep[2];
        }
        for (let j = 0; j < de.maps.length; j++) {
          const map = de.maps[j];
          const im = map.invM;
          const it = map.invT;
          const ix = im[0] * sX + im[1] * sY + im[2] * sZ + it[0];
          const iy = im[3] * sX + im[4] * sY + im[5] * sZ + it[1];
          const iz = im[6] * sX + im[7] * sY + im[8] * sZ + it[2];
          const r = Math.sqrt(ix * ix + iy * iy + iz * iz);
          const key = pScale * (r - R);
          const childScale = pScale * map.sigmaMin;
          const cert = childScale * (r - R);
          // Exactly one tuple leaves the top-2 ladder per candidate — the
          // displaced runner-up, or the candidate itself. It spills to the
          // rank-3/4 ladder (widths 3/4) or folds below; empty-slot
          // sentinels flow through both harmlessly (key Infinity never
          // inserts, r = 0 never folds).
          let eKey = key;
          let eX = ix;
          let eY = iy;
          let eZ = iz;
          let eScale = childScale;
          let eR = r;
          let eCert = cert;
          if (key < c1Key) {
            eKey = c2Key;
            eX = c2X;
            eY = c2Y;
            eZ = c2Z;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            c2Key = c1Key;
            c2X = c1X;
            c2Y = c1Y;
            c2Z = c1Z;
            c2Scale = c1Scale;
            c2R = c1R;
            c2Cert = c1Cert;
            c1Key = key;
            c1X = ix;
            c1Y = iy;
            c1Z = iz;
            c1Scale = childScale;
            c1R = r;
            c1Cert = cert;
          } else if (key < c2Key) {
            eKey = c2Key;
            eX = c2X;
            eY = c2Y;
            eZ = c2Z;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            c2Key = key;
            c2X = ix;
            c2Y = iy;
            c2Z = iz;
            c2Scale = childScale;
            c2R = r;
            c2Cert = cert;
          }
          if (extra > 0) {
            // Spill into the rank-3/4 ladder; what THAT evicts (or the
            // spilled tuple itself, when it beats neither slot) falls
            // through to the fold below.
            if (eKey < c3Key) {
              // The evicted key is dead past this point — only the folded
              // fields (point, scale, radius, certificate) survive.
              const tX = extra > 1 ? c4X : c3X;
              const tY = extra > 1 ? c4Y : c3Y;
              const tZ = extra > 1 ? c4Z : c3Z;
              const tScale = extra > 1 ? c4Scale : c3Scale;
              const tR = extra > 1 ? c4R : c3R;
              const tCert = extra > 1 ? c4Cert : c3Cert;
              if (extra > 1) {
                c4Key = c3Key;
                c4X = c3X;
                c4Y = c3Y;
                c4Z = c3Z;
                c4Scale = c3Scale;
                c4R = c3R;
                c4Cert = c3Cert;
              }
              c3Key = eKey;
              c3X = eX;
              c3Y = eY;
              c3Z = eZ;
              c3Scale = eScale;
              c3R = eR;
              c3Cert = eCert;
              eX = tX;
              eY = tY;
              eZ = tZ;
              eScale = tScale;
              eR = tR;
              eCert = tCert;
            } else if (extra > 1 && eKey < c4Key) {
              const tX = c4X;
              const tY = c4Y;
              const tZ = c4Z;
              const tScale = c4Scale;
              const tR = c4R;
              const tCert = c4Cert;
              c4Key = eKey;
              c4X = eX;
              c4Y = eY;
              c4Z = eZ;
              c4Scale = eScale;
              c4R = eR;
              c4Cert = eCert;
              eX = tX;
              eY = tY;
              eZ = tZ;
              eScale = tScale;
              eR = tR;
              eCert = tCert;
            }
          }
          // The tuple leaving the beam frontier: escaped candidates fold
          // their certificate (REFINED on the refined path, where the guard
          // already knows the plain certificate would have advanced the
          // min); an in-sphere tuple carries no positive certificate — on
          // widths 3/4 it can only get here past FOUR smaller keys, the
          // (shrunken) fr-jkpn residual drop.
          if (eR > R && eCert < best) {
            const folded = refine ? refinedCert(eX, eY, eZ, eR, eScale) : eCert;
            if (folded < best) {
              best = folded;
              // Cutoff exit (fr-55r5). `folded` is FINALIZED — already
              // refined on the refined path, so no later level can lift it —
              // and `best` only falls from here, so once the value this
              // would return sits under the caller's acceptance epsilon the
              // remaining descent cannot change its verdict.
              if (best * finalScale < bailBelow) {
                return descentValue(best, sphereBound, finalScale);
              }
            }
          }
        }
      }
    }
    // Promote: the best candidate always continues as chain A (or, past
    // the escape radius, folds its terminal and dies); the runner-up
    // becomes chain B only on width-2+ systems — width 1 folds it frozen,
    // exactly the classic sibling certificate. An in-sphere runner-up on a
    // width-1 system folds nothing: that is the documented residual drop.
    // Ranks 3/4 (widths 3/4) continue as validity chains ONLY while
    // in-sphere; escaped they fold the same refined certificate they would
    // have folded without the slots.
    aLive = false;
    bLive = false;
    v1Live = false;
    v2Live = false;
    if (c1Key < Infinity) {
      if (c1R > de.escapeRadius) {
        if (c1Cert < best) best = c1Cert;
      } else {
        aX = c1X;
        aY = c1Y;
        aZ = c1Z;
        aScale = c1Scale;
        aR = c1R;
        aLive = true;
      }
    }
    if (c2Key < Infinity) {
      if (!wide) {
        // Width-1 runner-up: the classic frozen sibling — the exact
        // certificate the fr-beck spike measured every ghost back to, so
        // the refined path refines it; the escape-radius fold below stays
        // PLAIN on both paths (matching estimateDistance4Refined: a
        // candidate past 2R folds a bound already >= childScale * R —
        // comfortably positive, so it can never read as a ghost and
        // refining it buys nothing a marcher could see).
        if (c2R > R && c2Cert < best) {
          const folded = refine
            ? refinedCert(c2X, c2Y, c2Z, c2R, c2Scale)
            : c2Cert;
          if (folded < best) best = folded;
        }
      } else if (c2R > de.escapeRadius) {
        if (c2Cert < best) best = c2Cert;
      } else {
        bX = c2X;
        bY = c2Y;
        bZ = c2Z;
        bScale = c2Scale;
        bR = c2R;
        bLive = true;
      }
    }
    if (extra > 0 && c3Key < Infinity) {
      if (c3R > R) {
        if (c3Cert < best) {
          const folded = refine
            ? refinedCert(c3X, c3Y, c3Z, c3R, c3Scale)
            : c3Cert;
          if (folded < best) best = folded;
        }
      } else {
        v1X = c3X;
        v1Y = c3Y;
        v1Z = c3Z;
        v1Scale = c3Scale;
        v1Live = true;
      }
    }
    if (extra > 1 && c4Key < Infinity) {
      if (c4R > R) {
        if (c4Cert < best) {
          const folded = refine
            ? refinedCert(c4X, c4Y, c4Z, c4R, c4Scale)
            : c4Cert;
          if (folded < best) best = folded;
        }
      } else {
        v2X = c4X;
        v2Y = c4Y;
        v2Z = c4Z;
        v2Scale = c4Scale;
        v2Live = true;
      }
    }
    // Cutoff exit (fr-55r5), covering the four promote folds above in one
    // test: each of them either wrote a SETTLED bound into `best` — the
    // certificate this path folds (refined for the caller that can pass a
    // cutoff at all) at the three refinable sites, the deliberately plain
    // escape-radius bound at the other two — or continued a chain, and
    // neither the rest of this level nor any deeper one can raise the
    // running min back. Deliberately NOT a `break`: the
    // terminal bounds past the loop are folds the FULL descent only makes
    // at the depth cap, and folding one here could drop `best` below a
    // value the full computation never reaches.
    if (best * finalScale < bailBelow) {
      return descentValue(best, sphereBound, finalScale);
    }
  }

  // Terminal bound of chains alive at the depth cap (the KIFS last-value
  // formula): non-positive when the chain tracked the attractor all the
  // way down.
  if (aLive) {
    const terminal = aScale * (aR - R);
    if (terminal < best) best = terminal;
  }
  if (bLive) {
    const terminal = bScale * (bR - R);
    if (terminal < best) best = terminal;
  }
  // Validity chains fold NO cap terminal — deliberately asymmetric with
  // A/B. In-sphere means inside the bounding SPHERE, not near the
  // attractor, so a validity chain's cap terminal is a vacuous negative
  // bound that can only ever pull the estimate toward a fabricated hit
  // (the membrane direction fr-jkpn's record calls the visually harmful
  // one), never fix a real one — the piece it tracks sits within
  // sigmaMax_chain * 2R of the query, sub-resolution wherever the depth
  // cap is not clamped. Measured (fr-jkpn harness, all systems, both
  // estimators, widths 3/4): folding them changes NOTHING — whenever a
  // validity chain survives to the cap, chain A holds an equal-or-deeper
  // branch whose terminal already dominates — so the fold is omitted on
  // principle, not cost. (The disclosed repro3 void-false-hit uptick,
  // 0 -> 2/435 refined at width 4, comes from A's OWN terminal on
  // wanderer branches the validity slots keep alive in-sphere to the
  // depth cap — and in-sphere is not near-attractor, so the KIFS
  // last-value bound is vacuous for them at ANY cap size: re-measured
  // unchanged after fr-xok8 raised the ceiling from 48 to 128.)
  return descentValue(best, sphereBound, finalScale);
}
