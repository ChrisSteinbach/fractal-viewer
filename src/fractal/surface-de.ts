import { composeAffine } from "./affine";
import { isFlatTransform } from "./affine4";
import { effectiveSymmetryOrder, runChaosGame } from "./chaos-game";
import { mulberry32 } from "./rng";
import type {
  SymmetryAxis,
  SymmetryParams,
  Transform,
  Variation,
  Vec3,
} from "./types";

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
 *
 * PURE-FOLD MAPS: THE FOLD-BRANCH SWEEP (fr-5rvk). Maps whose variation
 * list is exactly ONE active fold-family entry (`boxfold`, `spherefold`,
 * `mandelbox` — fr-p7nu) are the one variation class with a sound descent
 * extension: `T = w·V(M p + t)` is a genuine COMPOSITION (a blended list
 * is a weighted SUM of maps — no branch decomposition exists, so blends
 * stay ineligible forever), and each fold `V` is piecewise
 * affine-or-conformal, so `V(Y) = union over cells c of B_c(Y ∩ cell_c)`
 * and
 *
 *     dist(u, V(Y)) = min_c dist(u, B_c(Y ∩ cell_c))
 *                  >= min_c sigma_c · dist(B_c^-1(u), Y)
 *
 * — dropping each cell intersection only SHRINKS a term (distance to a
 * subset is >= distance to the set), so enumerating every branch
 * UNCONDITIONALLY — no validity-region tests; a branch whose cell the
 * attractor never occupies just contributes a loose-but-true term — keeps
 * the whole estimate a lower bound. `dist(q, w·X) = |w|·dist(q/w, X)`
 * absorbs the weight (negative `w` included: both folds are odd). Every
 * branch child enters the SAME candidate stream as an affine map's single
 * child — same key `pScale·(r − R)`, same certificate, same ladders,
 * validity slots, refinement and cutoff exits — so the beam's validity
 * argument above is branch-source agnostic and carries over verbatim.
 * The branches, in enumeration order (`b` ascending; the GLSL mirrors the
 * order exactly):
 *
 * - `boxfold` (27 = 3^3): per axis, output `u_a` has affine preimages
 *   `u_a` (in-box), `2 − u_a` (folded from above), `−2 − u_a` (folded
 *   from below) — each branch a reflection + translation ISOMETRY,
 *   sigma_c = 1 exactly. Axis selectors nest x-fastest:
 *   `b = selX + 3·selY + 9·selZ`.
 * - `spherefold` (3): with `mR² = 0.25`, `fR² = 1` fixed
 *   (`variations.ts`'s `sphereFoldFactor`): OUTER identity `v = u`
 *   (sigma 1), INNER `v = u/4` (the forward ×4 inflation is conformal,
 *   sigma exactly 4), MID unit-sphere inversion `v = u/|u|²` (an
 *   involution). The mid branch is conformal with LOCAL scale, not one
 *   sigma; for cell points `|x| <= 1`,
 *   `|u − Inv(x)| = |u' − x| / (|u'||x|) >= |u|·|u' − x|`, so the branch
 *   descends with the query-dependent certified factor `|u|`. Below
 *   `|u| = SPHEREFOLD_MID_MIN_R` the inversion image would overflow the
 *   GLSL mirror's f32, so the descent folds the shell bound
 *   `pScale·|w|·(1 − |u|)` instead — the mid piece lives in the u-space
 *   shell `1 <= |·| <= 2`, so that bound is ~`pScale·|w|`, never a
 *   near-zero ghost term.
 * - `mandelbox` (81 = 3·27): `V = sphereFold ∘ boxFold`, so the inverse
 *   chains each spherefold branch (order as above) through the box
 *   expansion of ITS output: `b = boxIndex + 27·sphereIndex`.
 *
 * Unconditional enumeration alone is VALID but measurably useless for the
 * spherefold family: the mid branch's inversion is the one inverse map
 * that DEFEATS the "inverse maps expand, so wanderers escape" dichotomy
 * the affine descent's terminals rest on, and spurious never-escaping
 * chains fold vacuous negative cap terminals across genuine voids
 * (measured: ~2/3 of void probes false-hitting). The repair is the REGION
 * FLOOR: every branch's OUTPUT region is known exactly (box id [−1,1]
 * per axis, up/down half-lines; spherefold outer outside the unit ball,
 * inner inside radius 2, mid the shell between — composites max the two
 * transported bounds), `regionDist(u)` is a certified lower bound on the
 * distance to that branch's piece, and each chain carries the strongest
 * `scale·|w|·regionDist` certificate its branch history ever earned.
 * Selection keys, folded certificates and cap terminals are all raised
 * to the chain's floor; a chain whose floor is still 0 took an exact
 * preimage at every level and is therefore ON the attractor up to the
 * telescoped contraction — the full mechanism, its measured numbers and
 * the width-{@link SURFACE_FOLD_BEAM_WIDTH} frontier that replaces the
 * four ladder slots live on {@link descendFold}.
 *
 * Bookkeeping: the child is `inv(M)·(branch preimage of q/w) + invT` —
 * the SAME `invM`/`invT` an affine map descends through — and the
 * branch's certified factor is `|w|·sigma_c·sigma_min(M)`, i.e.
 * {@link SurfaceDEMap.foldSigma} (`|w|·sigma_min`) times the branch's own
 * conformal sigma. ELIGIBILITY gates the composite's contraction on the
 * Lipschitz bound `|w|·L_V·sigma_max(M) < CONTRACTION_LIMIT` with
 * `L_boxfold = 1` and `L_spherefold = L_mandelbox = 4` (the ×4 inner
 * region is the worst branch) — which also caps every certified branch
 * factor below 1, since `|w|·L_V·sigma_min <= 0.999·sigma_min/sigma_max`.
 * Anisotropy stays `sigma_max/sigma_min` of `M` alone: every branch is
 * conformal, so the fold contributes ratio 1. Consequences worth naming:
 * the shipped Mandelbox preset (`mandelbox 1.2` blended with
 * `linear 0.25`) still reads "uses variations", and a pure-fold FINAL
 * transform stays ineligible too — the lens is applied ONCE to the query
 * point, and a multi-branch lens would need one root descent per branch
 * (beam seeding), which is out of scope rather than unsound.
 *
 * MEASURED VERDICT (fr-5rvk; scripts/surface-beam.harness.ts section 4,
 * CLOUD=300k, both estimators): on the two-map stress pairs — boxfold,
 * boxfold(-w)+affine, spherefold, mandelbox, boxfold x order-3 — jittered
 * and uniform violations are 0 everywhere, DEEP void false hits
 * (> 0.15R, the fr-1z6p ghost proxy) are 0 everywhere, the cutoff
 * contract is exact, and the only exact-class reading is the spherefold
 * pair's 6/100 at 5.5e-5 = 0.0024%R — deep-descent fp noise, two orders
 * under a marcher epsilon. The shipped mandelboxKifs preset (12 maps,
 * 8x81 + 4x27 branches) carries the one real disclosed residual: an
 * EXACT-class erosion tail of 77 probes at 4.4e-3 = 0.22%R — the fold
 * edition of fr-jkpn's more-in-sphere-branches-than-slots drop, width-
 * bound (frontier 24 measures 0.06%R at 3x the applications) and far
 * inside the affine precedent (repro3's disclosed 1.2%R, jittered) —
 * with every off-attractor and void column at 0. Inverse applications:
 * ~13/call on the boxfold pairs, ~175-232 on the spherefold/mandelbox
 * pairs, ~1400-2040 on the preset (map visits; each visit expands the
 * map's branches). The 0.05R-0.15R "shallow void" band reads high on the
 * dust-like sphere-family pairs — that band measures the fold bounds'
 * LOOSENESS (median DE/D 0.13-0.20 vs the affine presets' 0.61-0.84),
 * not fabricated hits; the harness's DEEP_VOID_FACTOR doc carries the
 * argument.
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

/** Forward Lipschitz bound of the spherefold's worst branch: the ×4
 * inflation inside the minimum-radius ball (the mid inversion's local scale
 * also peaks at 4, at `|x| = 0.5`). The boxfold's branches are isometries
 * (L = 1). Multiplied into the pure-fold contraction gate and the depth-cap
 * sizing (fold-branch sweep, module doc). */
export const SPHEREFOLD_LIPSCHITZ = 4;

/** u-space query radius below which the spherefold MID branch folds the
 * unit-shell bound instead of descending: inverting a point this close to
 * the origin would overflow the GLSL mirror's f32 arithmetic (`|u|⁻¹` up to
 * 1e3 here — comfortably finite — but unbounded without the floor). */
export const SPHEREFOLD_MID_MIN_R = 1e-3;

/** {@link SurfaceDEMap.foldKind} vocabulary. Numeric, not a string union:
 * the GLSL mirror carries the kind inside a packed per-map `vec4` uniform,
 * and the descent's hot loop dispatches on it per candidate. */
export const SURFACE_FOLD_NONE = 0;
export const SURFACE_FOLD_BOXFOLD = 1;
export const SURFACE_FOLD_SPHEREFOLD = 2;
export const SURFACE_FOLD_MANDELBOX = 3;
export type SurfaceFoldKind = 0 | 1 | 2 | 3;

/** The variation types the fold-branch sweep can decompose (fr-5rvk). */
const FOLD_VARIATION_TYPES: ReadonlySet<string> = new Set([
  "boxfold",
  "spherefold",
  "mandelbox",
]);

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
  /** Which fold family (if any) the map's single pure-fold variation
   * applies after its affine part — {@link SURFACE_FOLD_NONE} for a plain
   * affine map. Non-none maps expand into the fold's inverse BRANCHES
   * (27/3/81 candidates; fold-branch sweep, module doc). */
  foldKind: SurfaceFoldKind;
  /** `1/w` — signed reciprocal of the pure-fold weight (`1` at foldKind 0).
   * The descent divides the chain point into u-space with it. */
  foldInvW: number;
  /** `|w| · sigmaMin` — the certified contraction of the fold's ISOMETRIC
   * branches (box reflections, spherefold outer); the spherefold inner/mid
   * branches multiply their own conformal sigma on top. Equal to `sigmaMin`
   * (and unused) at foldKind 0. */
  foldSigma: number;
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

/** The single fold-family entry of a PURE-FOLD map — a variation list whose
 * ACTIVE entries (`composeVariations`' filter again) are exactly one
 * fold-family variation — or `null` for everything else. Blended lists are
 * deliberately excluded: a weighted SUM of maps is not a composition and
 * has no branch decomposition (fold-branch sweep, module doc). */
function pureFoldVariation(t: Transform): Variation | null {
  const active = (t.variations ?? []).filter(
    (v) => Number.isFinite(v.weight) && v.weight !== 0,
  );
  if (active.length !== 1) return null;
  const v = active[0];
  return FOLD_VARIATION_TYPES.has(v.type) ? v : null;
}

/** Forward Lipschitz bound of a pure-fold variation, weight folded in:
 * `|w| · L_V`, with L = 1 for the boxfold's reflection isometries and
 * {@link SPHEREFOLD_LIPSCHITZ} for the families containing the spherefold's
 * ×4 inner branch. */
function foldLipschitz(v: Variation): number {
  return Math.abs(v.weight) * (v.type === "boxfold" ? 1 : SPHEREFOLD_LIPSCHITZ);
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
    // Pure-fold maps (exactly one active fold-family variation) descend via
    // the fold-branch sweep (module doc, fr-5rvk); every other active
    // variation list has no tractable inverse and gates the mode out.
    const fold = pureFoldVariation(t);
    if (!fold && hasActiveVariations(t)) {
      reasons.push(`${label} uses variations`);
    }
    if (!isFlatTransform(t)) {
      reasons.push(`${label} extends into 4D`);
    }
    const s = sigmas[i];
    // A pure-fold map iterates w·V(Mp + t), so contraction is gated on the
    // composite Lipschitz bound |w|·L_V·sigma_max — the affine part alone
    // may even expand when the fold weight compensates. Invertibility
    // (near-flat) stays on M: every fold branch descends through inv(M).
    const lip = fold ? foldLipschitz(fold) * s.max : s.max;
    if (s.min < NEAR_SINGULAR_SIGMA) {
      reasons.push(`${label} is nearly flat (scale ≈ 0)`);
    } else if (lip >= CONTRACTION_LIMIT) {
      reasons.push(`${label} does not contract`);
    } else {
      anisotropy = Math.max(anisotropy, s.max / s.min);
    }
  });

  if (finalTransform) {
    // A pure-fold FINAL stays ineligible, unlike an iterated map: the lens
    // is applied ONCE to the query point, and a multi-branch lens would
    // need one root descent per branch (module doc's fold section).
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
    const sigmaMin = analysis.sigmas[i].min;
    // Pure-fold maps carry their fold family + weight into the descent's
    // branch expansion (fold-branch sweep, module doc); plain affine maps
    // get the inert defaults the GLSL packs the same way.
    const fold = pureFoldVariation(t);
    const foldKind: SurfaceFoldKind = !fold
      ? SURFACE_FOLD_NONE
      : fold.type === "boxfold"
        ? SURFACE_FOLD_BOXFOLD
        : fold.type === "spherefold"
          ? SURFACE_FOLD_SPHEREFOLD
          : SURFACE_FOLD_MANDELBOX;
    maps.push({
      invM,
      invT,
      sigmaMin,
      foldKind,
      foldInvW: fold ? 1 / fold.weight : 1,
      foldSigma: fold ? Math.abs(fold.weight) * sigmaMin : sigmaMin,
      baseIndex: i,
    });
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
  // resolution (ceiling: see MAX_DESCENT_DEPTH's fr-xok8 sizing note). For
  // fold maps the slowest certified branch is |w|·L_V·sigma_min — the
  // spherefold's ×4 branches shrink features slowest — and eligibility
  // keeps even that below CONTRACTION_LIMIT.
  const slowest = maps.reduce((acc, b) => {
    const factor =
      b.foldKind === SURFACE_FOLD_NONE
        ? b.sigmaMin
        : b.foldKind === SURFACE_FOLD_BOXFOLD
          ? b.foldSigma
          : b.foldSigma * SPHEREFOLD_LIPSCHITZ;
    return Math.max(acc, factor);
  }, 0);
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
 *
 * `cutoff` is {@link estimateDistanceRefined}'s early-out contract
 * (fr-55r5), verbatim: `<= 0` (the default) is the full descent
 * bit-for-bit; `> 0` lets the descent stop once its return is pinned under
 * the cutoff — a returned value `>= cutoff` equals the full result exactly,
 * a value `< cutoff` guarantees the full result is `< cutoff` too. The
 * contract's monotone/finalized argument is refine-agnostic: both paths
 * share the descent bodies' exits, and the plain path folds only settled
 * plain certificates, so the running min never tests a term the full
 * computation lacks (fr-aj4w exposed the parameter here so the empty-space
 * grid can price fold floors with the estimator the fold GLSL actually
 * marches).
 */
export function estimateDistance(de: SurfaceDE, p: Vec3, cutoff = 0): number {
  return deHasFolds(de)
    ? descendFold(de, p, false, cutoff)
    : descend(de, p, false, cutoff);
}

/** Whether any map expands into fold branches — such systems descend via
 * {@link descendFold}'s wide frontier instead of the affine ladder body
 * (which `beamWidth` parameterizes; the fold frontier has one measured
 * width, {@link SURFACE_FOLD_BEAM_WIDTH}). Exported for
 * `surface-grid.ts`'s estimator choice (fr-aj4w): fold systems price
 * their empty-space floors with the plain descent — the estimator the
 * fold GLSL actually marches — instead of the refined one. */
export function deHasFolds(de: SurfaceDE): boolean {
  for (const m of de.maps) {
    if (m.foldKind !== SURFACE_FOLD_NONE) return true;
  }
  return false;
}

/**
 * Static per-level cost multiple of {@link descendFold}'s frontier over the
 * affine ladder descent: the mean fold-branch count per map (an affine map
 * contributes one candidate where a fold map contributes 27/3/81) times the
 * frontier-over-ladder width ratio. Exactly `1` for fold-free systems.
 *
 * This is the number the preview ladder's cost-weighted entry
 * (`render-tier.ts`) consumes: the ladder's mid-ladder start rung assumes a
 * session's first frames cost what the shipped anchor rung costs, and fold
 * systems break that assumption by two to four orders of magnitude — enough
 * to wedge a weak GPU on the very first trace, before the governor has a
 * single sample to act on.
 */
export function surfaceDescentCostWeight(de: SurfaceDE): number {
  if (de.maps.length === 0 || !deHasFolds(de)) return 1;
  let branches = 0;
  for (const m of de.maps) {
    branches +=
      m.foldKind === SURFACE_FOLD_NONE
        ? 1
        : m.foldKind === SURFACE_FOLD_BOXFOLD
          ? 27
          : m.foldKind === SURFACE_FOLD_SPHEREFOLD
            ? 3
            : 81;
  }
  return (branches / de.maps.length) * (SURFACE_FOLD_BEAM_WIDTH / 4);
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
 *
 * SPHERE FLOOR (fr-zkt2). Once `best` falls to or below the depth-0 sphere
 * bound, the eventual return is already pinned: `descentValue` clamps
 * through `max(best, sphereBound)`, and `best` is a monotone min, so no
 * later fold can lift the clamp back off `sphereBound`. The descent
 * therefore exits the instant `best <= sphereBound`, unconditionally — no
 * cutoff involved. Unlike the fr-55r5 exit above, this one is value-exact
 * for EVERY caller, including the cutoff-0 value taps (normal probes,
 * ambient-occlusion taps, shadow rays): the value it returns equals the
 * full descent's, bit-for-bit, always — not just at or above a cutoff.
 * Where it pays: ANISOTROPIC maps, whose certificates lose a
 * sigmaMin/sigmaMax factor per level and so dip under the floor (~30% of
 * probes pinned on an anisotropic sierpinski variant); an isotropic map
 * that keeps the bounding ball invariant (|t| <= R(1 - sigma)) provably
 * never dips — `|p - t| - sigma R >= |p| - R` inducts down every chain —
 * so on the isotropic presets the exit never fires and costs one dead
 * comparison per fold.
 */
export function estimateDistanceRefined(
  de: SurfaceDE,
  p: Vec3,
  cutoff = 0,
): number {
  return deHasFolds(de)
    ? descendFold(de, p, true, cutoff)
    : descend(de, p, true, cutoff);
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

/** Scratch triple for {@link refinedCertValue}'s sector sweep — module
 * scope so the hot path never allocates. Distinct from the descent
 * bodies' own sweep scratch: refinement sweeps from inside their
 * candidate loops. Single-threaded by construction (each worker owns its
 * module instance). */
const CERT_SWEEP = [0, 0, 0];

/**
 * One extra Hutchinson level on a frozen escaped candidate's own inverse
 * image, over every (sector, base map, fold branch) triple (see
 * {@link estimateDistanceRefined}'s doc): the certificate becomes
 * `childScale * max(r - R, inner)` — never below the plain
 * `childScale * (r - R)`. Only called on the refined paths, and only for
 * folds whose plain certificate beats the running min. Shared by the
 * affine descent and the fold frontier ({@link descendFold}); fold-free
 * systems run the pre-fr-5rvk arithmetic bit for bit (every branch loop
 * below collapses to the single affine child).
 */
function refinedCertValue(
  de: SurfaceDE,
  ix: number,
  iy: number,
  iz: number,
  r: number,
  childScale: number,
): number {
  const { order, axis, stepCos, stepSin } = de.symmetry;
  const R = de.boundingRadius;
  let inner = Infinity;
  let sx = ix;
  let sy = iy;
  let sz = iz;
  for (let k = 0; k < order; k++) {
    if (k > 0) {
      stepSector(axis, stepCos, stepSin, sx, sy, sz, CERT_SWEEP);
      sx = CERT_SWEEP[0];
      sy = CERT_SWEEP[1];
      sz = CERT_SWEEP[2];
    }
    for (let j = 0; j < de.maps.length; j++) {
      const mapJ = de.maps[j];
      const imJ = mapJ.invM;
      const itJ = mapJ.invT;
      // Fold-branch sweep, one Hutchinson level deep: the inner min must
      // cover the same candidate set the fold frontier expands, or a fold
      // map's certificate would skip pieces. Each term carries the same
      // REGION strengthening the frontier's certificates do:
      // max(branchSigma·(r − R), |w|·regionDist).
      const kindJ = mapJ.foldKind;
      const branchCountJ =
        kindJ === SURFACE_FOLD_NONE
          ? 1
          : kindJ === SURFACE_FOLD_BOXFOLD
            ? 27
            : kindJ === SURFACE_FOLD_SPHEREFOLD
              ? 3
              : 81;
      const absWJ = mapJ.foldSigma / mapJ.sigmaMin;
      let ux = 0;
      let uy = 0;
      let uz = 0;
      let ru = 0;
      let px0 = 0;
      let px1 = 0;
      let px2 = 0;
      let py0 = 0;
      let py1 = 0;
      let py2 = 0;
      let pz0 = 0;
      let pz1 = 0;
      let pz2 = 0;
      let dxUp = 0;
      let dxDn = 0;
      let dyUp = 0;
      let dyDn = 0;
      let dzUp = 0;
      let dzDn = 0;
      let vx = 0;
      let vy = 0;
      let vz = 0;
      let sfSigma = 1;
      let sfRd = 0;
      if (kindJ !== SURFACE_FOLD_NONE) {
        ux = sx * mapJ.foldInvW;
        uy = sy * mapJ.foldInvW;
        uz = sz * mapJ.foldInvW;
        if (kindJ === SURFACE_FOLD_BOXFOLD) {
          px0 = ux;
          px1 = 2 - ux;
          px2 = -2 - ux;
          py0 = uy;
          py1 = 2 - uy;
          py2 = -2 - uy;
          pz0 = uz;
          pz1 = 2 - uz;
          pz2 = -2 - uz;
          dxUp = ux > 1 ? ux - 1 : 0;
          dxDn = ux < -1 ? -1 - ux : 0;
          dyUp = uy > 1 ? uy - 1 : 0;
          dyDn = uy < -1 ? -1 - uy : 0;
          dzUp = uz > 1 ? uz - 1 : 0;
          dzDn = uz < -1 ? -1 - uz : 0;
        } else {
          ru = Math.sqrt(ux * ux + uy * uy + uz * uz);
        }
      }
      for (let b = 0; b < branchCountJ; b++) {
        let jx: number;
        let jy: number;
        let jz: number;
        let branchSigma: number;
        let branchRd = 0;
        if (kindJ === SURFACE_FOLD_NONE) {
          jx = imJ[0] * sx + imJ[1] * sy + imJ[2] * sz + itJ[0];
          jy = imJ[3] * sx + imJ[4] * sy + imJ[5] * sz + itJ[1];
          jz = imJ[6] * sx + imJ[7] * sy + imJ[8] * sz + itJ[2];
          branchSigma = mapJ.sigmaMin;
        } else {
          if (
            kindJ === SURFACE_FOLD_SPHEREFOLD ||
            (kindJ === SURFACE_FOLD_MANDELBOX && b % 27 === 0)
          ) {
            const s = kindJ === SURFACE_FOLD_SPHEREFOLD ? b : b / 27;
            if (s === 0) {
              vx = ux;
              vy = uy;
              vz = uz;
              sfSigma = 1;
              sfRd = ru < 1 ? 1 - ru : 0;
            } else if (s === 1) {
              vx = 0.25 * ux;
              vy = 0.25 * uy;
              vz = 0.25 * uz;
              sfSigma = 4;
              sfRd = ru > 2 ? ru - 2 : 0;
            } else {
              if (ru < SPHEREFOLD_MID_MIN_R) {
                // Same shell stand-in the frontier folds, in the frozen
                // child's own frame.
                const shellTerm = absWJ * (1 - ru);
                if (shellTerm < inner) inner = shellTerm;
                if (kindJ === SURFACE_FOLD_MANDELBOX) b += 26;
                continue;
              }
              const invR2 = 1 / (ru * ru);
              vx = ux * invR2;
              vy = uy * invR2;
              vz = uz * invR2;
              sfSigma = ru;
              sfRd = ru < 1 ? 1 - ru : ru > 2 ? ru - 2 : 0;
            }
            if (kindJ === SURFACE_FOLD_MANDELBOX) {
              px0 = vx;
              px1 = 2 - vx;
              px2 = -2 - vx;
              py0 = vy;
              py1 = 2 - vy;
              py2 = -2 - vy;
              pz0 = vz;
              pz1 = 2 - vz;
              pz2 = -2 - vz;
              dxUp = vx > 1 ? vx - 1 : 0;
              dxDn = vx < -1 ? -1 - vx : 0;
              dyUp = vy > 1 ? vy - 1 : 0;
              dyDn = vy < -1 ? -1 - vy : 0;
              dzUp = vz > 1 ? vz - 1 : 0;
              dzDn = vz < -1 ? -1 - vz : 0;
            }
          }
          let cx: number;
          let cy: number;
          let cz: number;
          if (kindJ === SURFACE_FOLD_SPHEREFOLD) {
            cx = vx;
            cy = vy;
            cz = vz;
            branchRd = sfRd;
          } else {
            const bb = kindJ === SURFACE_FOLD_BOXFOLD ? b : b % 27;
            const selX = bb % 3;
            const selY = ((bb / 3) | 0) % 3;
            const selZ = (bb / 9) | 0;
            cx = selX === 0 ? px0 : selX === 1 ? px1 : px2;
            cy = selY === 0 ? py0 : selY === 1 ? py1 : py2;
            cz = selZ === 0 ? pz0 : selZ === 1 ? pz1 : pz2;
            const ddx =
              selX === 0
                ? dxUp > dxDn
                  ? dxUp
                  : dxDn
                : selX === 1
                  ? dxUp
                  : dxDn;
            const ddy =
              selY === 0
                ? dyUp > dyDn
                  ? dyUp
                  : dyDn
                : selY === 1
                  ? dyUp
                  : dyDn;
            const ddz =
              selZ === 0
                ? dzUp > dzDn
                  ? dzUp
                  : dzDn
                : selZ === 1
                  ? dzUp
                  : dzDn;
            const boxRd2 = ddx * ddx + ddy * ddy + ddz * ddz;
            const boxRd = boxRd2 > 0 ? Math.sqrt(boxRd2) : 0;
            branchRd =
              kindJ === SURFACE_FOLD_BOXFOLD
                ? boxRd
                : sfRd > sfSigma * boxRd
                  ? sfRd
                  : sfSigma * boxRd;
          }
          jx = imJ[0] * cx + imJ[1] * cy + imJ[2] * cz + itJ[0];
          jy = imJ[3] * cx + imJ[4] * cy + imJ[5] * cz + itJ[1];
          jz = imJ[6] * cx + imJ[7] * cy + imJ[8] * cz + itJ[2];
          branchSigma = mapJ.foldSigma * sfSigma;
        }
        const rj = Math.sqrt(jx * jx + jy * jy + jz * jz);
        let innerTerm = branchSigma * (rj - R);
        if (branchRd > 0) {
          const regionTerm = absWJ * branchRd;
          if (regionTerm > innerTerm) innerTerm = regionTerm;
        }
        if (innerTerm < inner) inner = innerTerm;
      }
    }
  }
  return childScale * Math.max(r - R, inner);
}

/**
 * Shared beam-descent body for the FOLD-FREE {@link estimateDistance}
 * (`refine` false: plain frozen certificates) and
 * {@link estimateDistanceRefined} (`refine` true: one extra Hutchinson
 * level on the folds that beat the running min). One body, not two:
 * unlike the 4D twin (whose two estimators predate the guard and stay
 * self-contained), the refined 3D descent IS the plain descent with three
 * fold sites upgraded, and duplicating the ~100-line skeleton would leave
 * the mirrors to drift. The GLSL tracer mirrors the `refine === true`
 * path line for line. Systems with pure-fold maps route to
 * {@link descendFold} instead — a different frontier structure entirely
 * (see its doc) — so this body stays the affine mode's arithmetic,
 * untouched by fr-5rvk.
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
  // runs the pre-sweep arithmetic unchanged.
  const { order, axis, stepCos, stepSin } = de.symmetry;
  const sweep = [0, 0, 0];

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
  // against it AFTER a fold, never a raw pre-refinement key. (That sphere
  // floor case now has its own unconditional exit — fr-zkt2, below — that
  // fires the moment `best` reaches it, cutoff or not.)
  const bailBelow =
    cutoff > 0 && sphereBound * finalScale < cutoff ? cutoff : -Infinity;

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
            const folded = refine
              ? refinedCertValue(de, eX, eY, eZ, eR, eScale)
              : eCert;
            if (folded < best) {
              best = folded;
              // Cutoff exit (fr-55r5) plus the sphere-floor pin (fr-zkt2).
              // `folded` is FINALIZED — already refined on the refined
              // path, so no later level can lift it — and `best` only
              // falls from here. Once `best` sits at or below the depth-0
              // sphere bound the return is pinned at `sphereBound *
              // finalScale` no matter how much further `best` still
              // falls, so that case exits unconditionally; short of it,
              // once the value this would return sits under the caller's
              // acceptance epsilon the remaining descent cannot change
              // its verdict either.
              if (best <= sphereBound || best * finalScale < bailBelow) {
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
            ? refinedCertValue(de, c2X, c2Y, c2Z, c2R, c2Scale)
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
            ? refinedCertValue(de, c3X, c3Y, c3Z, c3R, c3Scale)
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
            ? refinedCertValue(de, c4X, c4Y, c4Z, c4R, c4Scale)
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
    // Cutoff exit (fr-55r5) plus the sphere-floor pin (fr-zkt2), covering
    // the four promote folds above in one test: each of them either wrote
    // a SETTLED bound into `best` — the certificate this path folds
    // (refined for the caller that can pass a cutoff at all) at the three
    // refinable sites, the deliberately plain escape-radius bound at the
    // other two — or continued a chain, and neither the rest of this
    // level nor any deeper one can raise the running min back. Once
    // `best` is at or below the depth-0 sphere bound the eventual return
    // is already pinned at `sphereBound * finalScale`, so that case exits
    // unconditionally. Deliberately NOT a `break`: the
    // terminal bounds past the loop are folds the FULL descent only makes
    // at the depth cap, and folding one here could drop `best` below a
    // value the full computation never reaches.
    if (best <= sphereBound || best * finalScale < bailBelow) {
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

/** How many chains the fold frontier ({@link descendFold}) keeps alive.
 * Sized by measurement (fr-5rvk fold probe, exhaustive-reference sweep):
 * with region floors, floored keys, the drop-fold rule and the
 * floor-vs-best prune, the exhaustive frontier peaks at 10 (mandelbox
 * stress pair) to 33 (spherefold stress pair) live chains, and width 12
 * already reproduces the exhaustive values on every probe class
 * (on-attractor max 1.7e-8R vs width 8's 1.5e-3R erosion); widths past 12
 * buy nothing measurable. Fixed — the GLSL mirror sizes its arrays with
 * the same constant. */
export const SURFACE_FOLD_BEAM_WIDTH = 12;

// Module-scope scratch for descendFold — the current frontier, the
// next-level kept tuples (key-ascending), and the sector-sweep triple.
// Zero-allocation hot path; single-threaded by construction (each worker
// owns its module instance, and refinedCertValue never re-enters
// descendFold).
const FOLD_W = SURFACE_FOLD_BEAM_WIDTH;
const fcX = new Float64Array(FOLD_W);
const fcY = new Float64Array(FOLD_W);
const fcZ = new Float64Array(FOLD_W);
const fcScale = new Float64Array(FOLD_W);
const fcFloor = new Float64Array(FOLD_W);
const fcR = new Float64Array(FOLD_W);
const fnKey = new Float64Array(FOLD_W);
const fnX = new Float64Array(FOLD_W);
const fnY = new Float64Array(FOLD_W);
const fnZ = new Float64Array(FOLD_W);
const fnScale = new Float64Array(FOLD_W);
const fnFloor = new Float64Array(FOLD_W);
const fnR = new Float64Array(FOLD_W);
const fnCert = new Float64Array(FOLD_W);
const FOLD_SWEEP = [0, 0, 0];

/**
 * Fold-system descent (fr-5rvk): a width-{@link SURFACE_FOLD_BEAM_WIDTH}
 * FRONTIER of chains replaces {@link descend}'s two-plus-two ladder
 * slots. The shape is forced by measurement, not preference: fold maps
 * spawn up to 81 branch candidates each, whole SETS of them stay
 * in-sphere simultaneously (exhaustive reference peaks of 30-50 live
 * chains against the affine mode's at-most-m), and a four-slot beam
 * measurably erodes the surface (exact on-attractor queries read up to
 * ~2e-2R positive). Three mechanisms make the wide frontier both correct
 * and affordable:
 *
 * - REGION FLOORS. Every candidate inherits its chain's floor — the
 *   strongest `scale · |w| · regionDist` certificate collected along its
 *   branch history (module doc, fold section) — and every value the
 *   candidate ever folds (escape certificate, drop, cap terminal) is
 *   raised to it. A chain whose floor is still 0 at the cap took every
 *   fold branch inside that branch's output region, so an exact preimage
 *   exists at every level (affine steps always are one): the query is
 *   within the chain's telescoped Lipschitz product of the attractor,
 *   and its negative cap terminal is the legitimate hit signal — while a
 *   spurious "wanderer" (the inversion-riding chains that otherwise
 *   never escape) strays by construction, earns a positive floor, and
 *   can no longer fabricate a hit. This is what turns the mid branch's
 *   escape-defeating inversion from unsound to merely expensive.
 * - FLOORED KEYS + THE DROP-FOLD RULE. Selection ranks by
 *   `max(pScale·(r − R), floor)`, so strayed branches never outrank a
 *   floor-0 (possibly true) tracker, and a tuple dropped off the
 *   frontier folds its floor when it has one — the subtree's every fold
 *   is >= its floor (floors only grow), so the drop loses tightness,
 *   never validity. Measured: violations are 0 at EVERY width with the
 *   rule active, width included only buys tracking accuracy.
 * - FLOOR-VS-BEST PRUNE. A candidate whose floor already reaches the
 *   running min cannot advance it (every deeper fold is >= the floor),
 *   so it is skipped outright — this is what collapses the frontier from
 *   branch-count blowup to the measured 10-33 peak.
 *
 * Everything else mirrors {@link descend}: same prologue/lens, same
 * selection-key semantics otherwise, same escape-radius folds (plain on
 * both paths), same guarded refinement of escaped folds
 * ({@link refinedCertValue} — the certificate keeps its floor via max:
 * refinement examines the child's own neighbourhood, the floor its
 * branch history, so the pair's max is the strongest settled term), same
 * cutoff/sphere-floor exits after every settled fold (the fr-55r5 /
 * fr-zkt2 contract carries verbatim: `best` is monotone and every folded
 * term is finalized), and the same KIFS cap terminals — floor-raised,
 * for every live chain alike (the affine body's A/B-vs-validity-slot
 * asymmetry exists to starve affine wanderers, which floors handle
 * better here). In-sphere floor-0 drops past the frontier width remain
 * the one silent residual, overshoot-direction only — measured zero at
 * this width on the probe set.
 *
 * MIRROR NOTE: the GLSL fold tracer marches this body's refine=FALSE
 * path. Refinement is measurably a no-op on fold systems — the harness's
 * base and refined rows are indistinguishable (region floors, not
 * refinement, carry the ghost-killing; deep-void false hits are 0 in
 * both) — and {@link refinedCertValue}'s branch sweep inlined into the
 * frontier's innermost GLSL loop is part of what Mesa's compiler died
 * on (see surface-material.ts's fold notes). The refined path stays the
 * CPU production estimator for the grid worker and the tests.
 */
function descendFold(
  de: SurfaceDE,
  p: Vec3,
  refine: boolean,
  cutoff = 0,
): number {
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

  const { order, axis, stepCos, stepSin } = de.symmetry;
  const R = de.boundingRadius;
  const startR = Math.sqrt(x * x + y * y + z * z);
  const sphereBound = startR - R;
  let best = Infinity;
  const bailBelow =
    cutoff > 0 && sphereBound * finalScale < cutoff ? cutoff : -Infinity;

  let chainCount = 1;
  fcX[0] = x;
  fcY[0] = y;
  fcZ[0] = z;
  fcScale[0] = 1;
  fcFloor[0] = 0;
  fcR[0] = startR;

  for (let depth = 0; depth < de.maxDepth && chainCount > 0; depth++) {
    let keptCount = 0;
    // Worst kept slot, maintained by a fixed-bound rescan whenever the
    // frontier is full (see the insertion comment below for why the
    // storage is deliberately UNSORTED).
    let fnWorstKey = -Infinity;
    let fnWorstIdx = 0;
    for (let c = 0; c < chainCount; c++) {
      const pScale = fcScale[c];
      const pFloor = fcFloor[c];
      let sX = fcX[c];
      let sY = fcY[c];
      let sZ = fcZ[c];
      for (let k = 0; k < order; k++) {
        if (k > 0) {
          stepSector(axis, stepCos, stepSin, sX, sY, sZ, FOLD_SWEEP);
          sX = FOLD_SWEEP[0];
          sY = FOLD_SWEEP[1];
          sZ = FOLD_SWEEP[2];
        }
        for (let j = 0; j < de.maps.length; j++) {
          const map = de.maps[j];
          const im = map.invM;
          const it = map.invT;
          // Fold-branch sweep (module doc): one candidate per inverse
          // BRANCH — 27 (boxfold), 3 (spherefold), 81 (mandelbox), 1
          // (affine map in a mixed system) — enumerated unconditionally;
          // validity never depends on which fold cell the attractor
          // actually occupies.
          const kind = map.foldKind;
          const branchCount =
            kind === SURFACE_FOLD_NONE
              ? 1
              : kind === SURFACE_FOLD_BOXFOLD
                ? 27
                : kind === SURFACE_FOLD_SPHEREFOLD
                  ? 3
                  : 81;
          const absW = map.foldSigma / map.sigmaMin;
          // u-space chain point (q/w), the per-axis box preimage triple
          // {u, 2−u, −2−u} with the matching per-axis output-interval
          // distances (boxfold reads them off u once; mandelbox refreshes
          // them from each spherefold branch output), and the current
          // spherefold branch output + conformal sigma + region distance.
          let ux = 0;
          let uy = 0;
          let uz = 0;
          let ru = 0;
          let px0 = 0;
          let px1 = 0;
          let px2 = 0;
          let py0 = 0;
          let py1 = 0;
          let py2 = 0;
          let pz0 = 0;
          let pz1 = 0;
          let pz2 = 0;
          let dxUp = 0;
          let dxDn = 0;
          let dyUp = 0;
          let dyDn = 0;
          let dzUp = 0;
          let dzDn = 0;
          let vx = 0;
          let vy = 0;
          let vz = 0;
          let sfSigma = 1;
          let sfRd = 0;
          if (kind !== SURFACE_FOLD_NONE) {
            ux = sX * map.foldInvW;
            uy = sY * map.foldInvW;
            uz = sZ * map.foldInvW;
            if (kind === SURFACE_FOLD_BOXFOLD) {
              px0 = ux;
              px1 = 2 - ux;
              px2 = -2 - ux;
              py0 = uy;
              py1 = 2 - uy;
              py2 = -2 - uy;
              pz0 = uz;
              pz1 = 2 - uz;
              pz2 = -2 - uz;
              dxUp = ux > 1 ? ux - 1 : 0;
              dxDn = ux < -1 ? -1 - ux : 0;
              dyUp = uy > 1 ? uy - 1 : 0;
              dyDn = uy < -1 ? -1 - uy : 0;
              dzUp = uz > 1 ? uz - 1 : 0;
              dzDn = uz < -1 ? -1 - uz : 0;
            } else {
              ru = Math.sqrt(ux * ux + uy * uy + uz * uz);
            }
          }
          for (let b = 0; b < branchCount; b++) {
            let ix: number;
            let iy: number;
            let iz: number;
            let branchSigma: number;
            let branchRd = 0;
            if (kind === SURFACE_FOLD_NONE) {
              ix = im[0] * sX + im[1] * sY + im[2] * sZ + it[0];
              iy = im[3] * sX + im[4] * sY + im[5] * sZ + it[1];
              iz = im[6] * sX + im[7] * sY + im[8] * sZ + it[2];
              branchSigma = map.sigmaMin;
            } else {
              if (
                kind === SURFACE_FOLD_SPHEREFOLD ||
                (kind === SURFACE_FOLD_MANDELBOX && b % 27 === 0)
              ) {
                // (Re)compute the spherefold branch this b enters: outer
                // identity, inner /4 (conformal sigma 4), mid unit-sphere
                // inversion (query-dependent sigma |u| — module doc),
                // each with its distance to the branch's OUTPUT region
                // (outer outside the unit ball, inner inside radius 2,
                // mid the shell between).
                const s = kind === SURFACE_FOLD_SPHEREFOLD ? b : b / 27;
                if (s === 0) {
                  vx = ux;
                  vy = uy;
                  vz = uz;
                  sfSigma = 1;
                  sfRd = ru < 1 ? 1 - ru : 0;
                } else if (s === 1) {
                  vx = 0.25 * ux;
                  vy = 0.25 * uy;
                  vz = 0.25 * uz;
                  sfSigma = 4;
                  sfRd = ru > 2 ? ru - 2 : 0;
                } else {
                  if (ru < SPHEREFOLD_MID_MIN_R) {
                    // Inverting a chain point this close to the sector
                    // origin would overflow the GLSL mirror's f32; the
                    // mid piece lives in the u-space shell 1 <= |·| <= 2,
                    // so fold the shell bound |w|·(1 − |u|) — ~pScale·|w|,
                    // never a near-zero ghost term — and skip the branch
                    // (box expansion included). A settled fold, so the
                    // standard exits apply.
                    let shellCert = pScale * absW * (1 - ru);
                    if (pFloor > shellCert) shellCert = pFloor;
                    if (shellCert < best) {
                      best = shellCert;
                      if (
                        best <= sphereBound ||
                        best * finalScale < bailBelow
                      ) {
                        return descentValue(best, sphereBound, finalScale);
                      }
                    }
                    if (kind === SURFACE_FOLD_MANDELBOX) b += 26;
                    continue;
                  }
                  const invR2 = 1 / (ru * ru);
                  vx = ux * invR2;
                  vy = uy * invR2;
                  vz = uz * invR2;
                  sfSigma = ru;
                  sfRd = ru < 1 ? 1 - ru : ru > 2 ? ru - 2 : 0;
                }
                if (kind === SURFACE_FOLD_MANDELBOX) {
                  px0 = vx;
                  px1 = 2 - vx;
                  px2 = -2 - vx;
                  py0 = vy;
                  py1 = 2 - vy;
                  py2 = -2 - vy;
                  pz0 = vz;
                  pz1 = 2 - vz;
                  pz2 = -2 - vz;
                  dxUp = vx > 1 ? vx - 1 : 0;
                  dxDn = vx < -1 ? -1 - vx : 0;
                  dyUp = vy > 1 ? vy - 1 : 0;
                  dyDn = vy < -1 ? -1 - vy : 0;
                  dzUp = vz > 1 ? vz - 1 : 0;
                  dzDn = vz < -1 ? -1 - vz : 0;
                }
              }
              let cx: number;
              let cy: number;
              let cz: number;
              if (kind === SURFACE_FOLD_SPHEREFOLD) {
                cx = vx;
                cy = vy;
                cz = vz;
                branchRd = sfRd;
              } else {
                // Box branch decode: per-axis preimage selectors, x
                // fastest (b = selX + 3·selY + 9·selZ), each selector
                // paired with the distance from the source point to that
                // branch's output interval (id [−1,1], up (−inf,1],
                // down [−1,inf)).
                const bb = kind === SURFACE_FOLD_BOXFOLD ? b : b % 27;
                const selX = bb % 3;
                const selY = ((bb / 3) | 0) % 3;
                const selZ = (bb / 9) | 0;
                cx = selX === 0 ? px0 : selX === 1 ? px1 : px2;
                cy = selY === 0 ? py0 : selY === 1 ? py1 : py2;
                cz = selZ === 0 ? pz0 : selZ === 1 ? pz1 : pz2;
                const ddx =
                  selX === 0
                    ? dxUp > dxDn
                      ? dxUp
                      : dxDn
                    : selX === 1
                      ? dxUp
                      : dxDn;
                const ddy =
                  selY === 0
                    ? dyUp > dyDn
                      ? dyUp
                      : dyDn
                    : selY === 1
                      ? dyUp
                      : dyDn;
                const ddz =
                  selZ === 0
                    ? dzUp > dzDn
                      ? dzUp
                      : dzDn
                    : selZ === 1
                      ? dzUp
                      : dzDn;
                const boxRd2 = ddx * ddx + ddy * ddy + ddz * ddz;
                const boxRd = boxRd2 > 0 ? Math.sqrt(boxRd2) : 0;
                branchRd =
                  kind === SURFACE_FOLD_BOXFOLD
                    ? boxRd
                    : sfRd > sfSigma * boxRd
                      ? sfRd
                      : sfSigma * boxRd;
              }
              ix = im[0] * cx + im[1] * cy + im[2] * cz + it[0];
              iy = im[3] * cx + im[4] * cy + im[5] * cz + it[1];
              iz = im[6] * cx + im[7] * cy + im[8] * cz + it[2];
              branchSigma = map.foldSigma * sfSigma;
            }
            const r = Math.sqrt(ix * ix + iy * iy + iz * iz);
            const childScale = pScale * branchSigma;
            // Floor first: the chain's floor raised by this branch's own
            // region certificate.
            let candFloor = pFloor;
            if (branchRd > 0) {
              const flr = pScale * absW * branchRd;
              if (flr > candFloor) candFloor = flr;
            }
            // Floor-vs-best prune: every fold the candidate's subtree
            // could ever contribute is >= its floor, which already
            // cannot advance the min.
            if (candFloor > 0 && candFloor >= best) continue;
            let key = pScale * (r - R);
            if (candFloor > 0 && candFloor > key) key = candFloor;
            let cert = childScale * (r - R);
            if (candFloor > 0 && candFloor > cert) cert = candFloor;
            // Past the escape radius deeper refinement cannot improve the
            // min: fold the (floor-raised) certificate plain, exactly as
            // the affine body's escape-radius folds stay plain.
            if (r > de.escapeRadius) {
              if (cert < best) {
                best = cert;
                if (best <= sphereBound || best * finalScale < bailBelow) {
                  return descentValue(best, sphereBound, finalScale);
                }
              }
              continue;
            }
            // Frontier insertion: UNSORTED storage with a tracked worst
            // slot. The kept set is still exactly the level's FOLD_W
            // smallest floored keys — a full frontier replaces its worst
            // slot whenever a smaller key arrives, ties evicting the
            // newcomer — only the storage ORDER differs from the sorted
            // insert-shift this replaces. The shape is forced by the GLSL
            // mirror: Mesa's compiler dies outright on the data-dependent
            // shift chains (measured on Iris Xe: seconds of linkProgram
            // stall, then VALIDATE_STATUS false with an empty info log and
            // a lost GL context — the driver-reset signature), while one
            // indexed write plus a fixed-bound read-only rescan compiles
            // fine; the oracle keeps the identical structure so the two
            // stay in lockstep term for term. Whatever leaves the kept set
            // — this candidate, or the displaced worst slot — folds:
            // escaped tuples their certificate, in-sphere tuples their
            // floor (the drop-fold rule; a floor-0 in-sphere drop stays
            // the silent overshoot-direction residual, measured zero at
            // this width).
            let evX = 0;
            let evY = 0;
            let evZ = 0;
            let evScale = 0;
            let evR = 0;
            let evCert = 0;
            let evFloor = 0;
            let evHas = false;
            if (keptCount === FOLD_W && key >= fnWorstKey) {
              evX = ix;
              evY = iy;
              evZ = iz;
              evScale = childScale;
              evR = r;
              evCert = cert;
              evFloor = candFloor;
              evHas = true;
            } else {
              let slot: number;
              if (keptCount === FOLD_W) {
                slot = fnWorstIdx;
                evX = fnX[slot];
                evY = fnY[slot];
                evZ = fnZ[slot];
                evScale = fnScale[slot];
                evR = fnR[slot];
                evCert = fnCert[slot];
                evFloor = fnFloor[slot];
                evHas = true;
              } else {
                slot = keptCount;
                keptCount++;
              }
              fnKey[slot] = key;
              fnX[slot] = ix;
              fnY[slot] = iy;
              fnZ[slot] = iz;
              fnScale[slot] = childScale;
              fnFloor[slot] = candFloor;
              fnR[slot] = r;
              fnCert[slot] = cert;
              // Recompute the worst kept key once the frontier is full —
              // a fixed-bound scan of reads, first max wins.
              if (keptCount === FOLD_W) {
                fnWorstKey = -Infinity;
                fnWorstIdx = 0;
                for (let s = 0; s < FOLD_W; s++) {
                  if (fnKey[s] > fnWorstKey) {
                    fnWorstKey = fnKey[s];
                    fnWorstIdx = s;
                  }
                }
              }
            }
            if (evHas) {
              if (evR > R) {
                if (evCert < best) {
                  let folded = evCert;
                  if (refine) {
                    const rc = refinedCertValue(
                      de,
                      evX,
                      evY,
                      evZ,
                      evR,
                      evScale,
                    );
                    if (rc > folded) folded = rc;
                  }
                  if (folded < best) {
                    best = folded;
                    if (best <= sphereBound || best * finalScale < bailBelow) {
                      return descentValue(best, sphereBound, finalScale);
                    }
                  }
                }
              } else if (evFloor > 0 && evFloor < best) {
                best = evFloor;
                if (best <= sphereBound || best * finalScale < bailBelow) {
                  return descentValue(best, sphereBound, finalScale);
                }
              }
            }
          }
        }
      }
    }
    // The kept tuples become the next frontier (key/cert are selection
    // artifacts; the chains carry point, scale, floor and radius).
    for (let i = 0; i < keptCount; i++) {
      fcX[i] = fnX[i];
      fcY[i] = fnY[i];
      fcZ[i] = fnZ[i];
      fcScale[i] = fnScale[i];
      fcFloor[i] = fnFloor[i];
      fcR[i] = fnR[i];
    }
    chainCount = keptCount;
  }

  // Floor-raised KIFS terminals for every chain alive at the depth cap: a
  // floor-0 chain is a true preimage orbit (its negative terminal is the
  // hit signal), a strayed chain folds its certified positive floor.
  for (let c = 0; c < chainCount; c++) {
    let terminal = fcScale[c] * (fcR[c] - R);
    if (fcFloor[c] > 0 && fcFloor[c] > terminal) terminal = fcFloor[c];
    if (terminal < best) best = terminal;
  }
  return descentValue(best, sphereBound, finalScale);
}
