import { composeAffine } from "./affine";
import { isFlatTransform, symmetryIsNonFlat } from "./affine4";
import {
  effectiveSymmetryOrder,
  buildChaosSelection,
  prepareSchedule,
  runChaosGame,
  symmetryRotation,
  systemHasChaos,
  transformHasEmitter,
} from "./chaos-game";
import {
  condensationBoundingRadius3,
  condensationHasFutureDepth,
  condensationTerm3,
  resolveCondensationDepthBand,
} from "./condensation-de";
import type {
  CondensationDE3,
  CondensationDepthBand,
  CondensationEmitter3,
} from "./condensation-de";
import { mulberry32 } from "./rng";
import { SHAPE_MARCH_SAFETY, shapeBoundingRadius, shapeSdf } from "./shapes";
import {
  calibrateSurfaceNativeCarriers,
  SURFACE_NATIVE_CALIBRATION_SAMPLE_COUNT,
} from "./surface-pattern";
import type {
  SurfaceNativeCalibration,
  SurfaceNativeCarrierSample,
} from "./surface-pattern";
import type {
  HybridSchedule,
  SymmetryParams,
  SymmetryPlane,
  Transform,
  Variation,
  Vec3,
} from "./types";
import {
  CLASSIC_FOLD_RADII,
  foldVariationFn,
  resolveFoldRadii,
  sphereFoldLipschitz,
} from "./variations";

/**
 * Surface distance estimation for an affine IFS.
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
 * branch, and the beam harness (`scripts/surface-beam.harness.ts`)
 * measured that overshooting for real across the board — worst on the
 * doubleRotation profile (2 maps, sigma 0.93/0.22: max excess ~19% of R),
 * but also on plain shipped presets (default 10.8%R, spiral 8.6%R,
 * pyramid 6.2%R), with no per-map sigma threshold separating the clean
 * systems from the overshooting ones — so the paired chains are
 * unconditional (~1.7-1.8x width 1's inverse applications, violations
 * collapse to the fp-noise floor on every measured 2-map system AND every
 * preset, and tightness IMPROVES since the second chain refines the
 * barely-escaped sibling certificates the 4D DE spike measured every
 * ghost back to); width 1 remains only as the tests' pin of the
 * single-chain mechanism. Width 2's own measured residual — levels with
 * 3+ SIMULTANEOUS in-sphere branches still dropped the excess (jerusalem
 * 3.6%R, m >= 3 slow maps ~2%R, sigma >= 0.96 ~2%R) — is
 * closed by the two VALIDITY SLOTS production builds add (width 4): a
 * second insert-shift ladder tracks each level's rank-3/4 candidates
 * exactly (fed by everything the top-2 ladder evicts), and those continue
 * as extra chains ONLY while in-sphere — the branches that carry no
 * positive certificate, whose silent drop was the invalidity — folding
 * the ordinary guarded certificate the moment they escape and no cap
 * terminal at all (see descend's terminal note). In-sphere keys are
 * negative and escaped keys positive, so the four slots hold EVERY
 * in-sphere branch until they run out — exhaustive coverage for m <= 2
 * (at most 4 candidates a level). Measured (harness rerun, CLOUD=300k,
 * refined estimator, at the 128-level depth ceiling): jerusalem
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
 * (the 4D spike's ghost-eliminator carried back down): before a
 * non-descended escaped candidate freezes, one more Hutchinson level is
 * applied to its own inverse image ({@link estimateDistanceRefined}),
 * lifting the barely-escaped near-zero certificates that width 2 alone
 * still let false-hit in genuine voids (the beam harness record, w2 base:
 * voidFalseHit default 3/271, sierpinski 6/307, pyramid 6/251,
 * jerusalem 2/318 — rendered as smooth "balloon" membranes across
 * attractor voids). Measured after the port (same harness, CLOUD=300k):
 * width-2 refined voidFalseHits drop to 0 on EVERY system measured
 * (kaleidoscope stress profile included), tightness improves (sierpinski
 * DE/D p10 0.451 -> 0.646), validity is unchanged on every shipped preset
 * (jerusalem's residual stayed 3.6%R until the width-4 validity
 * slots above closed it), and cost lands at ~2-4x inverse applications
 * over base thanks to the fold-time laziness guard.
 * Disclosed interaction, noted with those slots: kaleidoscope orders >= 3
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
 * SYMMETRY: SECTOR SWEEP, NOT A WEDGE FOLD. A kaleidoscope of
 * order `n` replicates every base map `f_i` into `n` copies `g_k . f_i`,
 * where `g_k` is the rotation by `2*pi*k/n` in `symmetry.plane` applied
 * AFTER the base map (`chaos-game.ts`'s `postRotations`). Those copies used
 * to be MATERIALISED: {@link buildSurfaceDE} emitted `n * m` composed
 * inverse maps and the GLSL mirror carried them in fixed 24-slot uniform
 * arrays, so high orders on multi-map systems were gated out of the mode
 * entirely by a slot budget. {@link SurfaceDE.maps} now holds the `m` BASE
 * inverses only, and the descent walks the `n` sectors by rotating each
 * chain point ONE step (`Rot_plane(-2*pi/n)`, the copy rotation's transpose)
 * per sector — `inv(M_i) . Rot_k^T . q` re-associated as
 * `inv(M_i) . (Rot_k^T . q)`. The uniform arrays are base-sized for ANY
 * order, while the candidate set, its enumeration ORDER (sector-major,
 * exactly the old slot order, so the insert-shift ladders break ties
 * identically), every key, every certificate and every terminal are the
 * ones the expansion produced. The beam, the validity slots and the
 * march-epsilon cutoff exits are therefore untouched — this is a
 * repacking, and the validity argument above carries over verbatim
 * instead of needing a new one. Order 1 skips the rotation entirely, so
 * every non-kaleidoscope system (every shipped preset) stays bit-for-bit
 * on its old numbers.
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
 * PURE-FOLD MAPS: THE FOLD-BRANCH SWEEP. Maps whose variation
 * list is exactly ONE active fold-family entry (`boxfold`, `spherefold`,
 * `mandelbox`) are the one variation class with a sound descent
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
 * factor below 1, since `|w|·L_V·sigma_min <= 0.999·sigma_min/sigma_max`
 * — and floors `|w|` itself at {@link NEAR_ZERO_FOLD_WEIGHT}: the
 * contraction bound only ever IMPROVES as `w -> 0`, but the descent
 * divides by `w`, so a near-zero weight must be refused rather than
 * admitted. Anisotropy stays `sigma_max/sigma_min` of `M` alone: every
 * branch is conformal, so the fold contributes ratio 1. Consequences
 * worth naming: the shipped Mandelbox preset (`mandelbox 1.2` blended
 * with `linear 0.25`) still reads "uses variations". A pure-fold FINAL
 * transform is eligible: the lens is applied ONCE to the
 * query point, so its branches expand into one round of root descents —
 * {@link descendLens} lifts this exact branch/sigma/region-floor
 * vocabulary to the query level and leaves the descent cores untouched
 * (`final` stays null when `foldFinal` is set). No contraction gate
 * applies to the lens: an un-iterated map needs none, exactly like the
 * affine lens.
 *
 * MEASURED VERDICT (scripts/surface-beam.harness.ts section 4,
 * CLOUD=300k, both estimators): on the two-map stress pairs — boxfold,
 * boxfold(-w)+affine, spherefold, mandelbox, boxfold x order-3 — jittered
 * and uniform violations are 0 everywhere, DEEP void false hits
 * (> 0.15R, the refinement work's ghost proxy) are 0 everywhere, the cutoff
 * contract is exact, and the only exact-class reading is the spherefold
 * pair's 6/100 at 5.5e-5 = 0.0024%R — deep-descent fp noise, two orders
 * under a marcher epsilon. The shipped mandelboxKifs preset (12 maps,
 * 8x81 + 4x27 branches) carries the one real disclosed residual: an
 * EXACT-class erosion tail of 77 probes at 4.4e-3 = 0.22%R — the fold
 * edition of the more-in-sphere-branches-than-slots drop, width-
 * bound (frontier 24 measures 0.06%R at 3x the applications) and far
 * inside the affine precedent (repro3's disclosed 1.2%R, jittered) —
 * with every off-attractor and void column at 0 at that density; the
 * 60k probe set reaches the refined tail OFF-attractor (j1@7.7e-4 =
 * 0.039%R) and erodes it to 1.66%R (base 0.92%R), so the harness gates
 * the production estimator per class — base for folds, whose
 * off-attractor and void columns are 0 at both densities — and
 * discloses the refined fold rows. Inverse applications:
 * ~13/call on the boxfold pairs, ~175-232 on the spherefold/mandelbox
 * pairs, ~1400-2040 on the preset (map visits; each visit expands the
 * map's branches). The 0.05R-0.15R "shallow void" band reads high on the
 * dust-like sphere-family pairs — that band measures the fold bounds'
 * LOOSENESS (median DE/D 0.13-0.20 vs the affine presets' 0.61-0.84),
 * not fabricated hits; the harness's DEEP_VOID_FACTOR doc carries the
 * argument.
 *
 * BRANCH-AND-BOUND / PROBE-FIT-BALL ADDENDUM (same harness, re-measured): the
 * branch-and-bound skip cut the per-branch transforms behind those visit
 * counts ~75x on the preset (fine counter, fold-cost-split harness:
 * 18,252 -> 243.5 transforms/call) at byte-identical estimates, and the
 * probe-fit ball then moved every fold pair's R (boxfold 0.78 -> 0.69,
 * boxfold-w+affine 0.84 -> 0.48, spherefold 2.31 -> 1.71, mandelbox
 * 2.30 -> 1.88; the preset's near-origin-symmetric attractor keeps
 * ~R 1.98), lifting DE/D medians (boxfold pair 0.630 -> 0.701,
 * -w+affine 0.613 -> 0.777) and dropping visit counts (spherefold pair
 * 182 -> 135). Values on centered systems are unchanged (origin ball
 * kept). One disclosure moved WITH the probe set, not the estimator: the
 * mandelbox pair's smaller ball re-scales the R-relative uniform probe
 * cloud, which now samples a pre-existing weak spot at
 * p ~ [0.99, 1.93, 0.05] — trueD 0.646 (0.34R) but estimate 0.0123,
 * reading 1/200 in the deep-void column. Verified BIT-IDENTICAL under
 * the origin ball at the old radius (the old probe set just never landed
 * there), and above the marcher's real acceptance epsilon at typical hit
 * distances (~0.006) — a slow-march spot of the known in-sphere
 * floor-0-drop residual class, not a rendered ghost and not a
 * probe-fit-ball regression.
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

/**
 * Eligibility floor on a pure-fold variation's |weight|. The
 * descent works in u-space `u = p/w` (`foldInvW = 1/w`, an f32 uniform in
 * the GLSL/WGSL mirrors), and `w -> 0+` slides THROUGH the composite
 * Lipschitz gate — `|w|·L_V·sigma_max` only improves as the weight
 * shrinks — while the mirrors degrade: the ±2 fold-cell lattice loses f32
 * resolution against `|u| ~ |p|/w` long before `1/w` literally overflows
 * to Inf (where the map's branch terms would silently leave the min and
 * the estimator would march through its own surface). At 1e-4 the lattice
 * stays resolved with orders of margin. The UI's 0–2 weight slider cannot
 * land in `(0, 1e-4)` — only a hand-edited hash/import payload can, which
 * is exactly what an eligibility reason (rather than a clamp) is for.
 */
export const NEAR_ZERO_FOLD_WEIGHT = 1e-4;

/** Points drawn by the seeded bounding-radius probe. */
export const PROBE_POINTS = 8192;

/** Fixed seed for the bounding-radius probe: the DE for a given system must
 * be deterministic (tests, GLSL uniforms, and repeated builds all agree). */
export const PROBE_SEED = 0x5eedf00d;

/** Pad factor applied to the probe's sampled `maxR` — the probe sees a
 * finite sample of the attractor, whose true supremum sits slightly beyond. */
export const RADIUS_PAD = 1.05;

/**
 * Near-smallest enclosing ball of an interleaved-xyz point cloud —
 * Ritter's construction (pick a point, walk to its farthest, walk to
 * THAT one's farthest, seed the ball on that diameter, then grow through
 * every outlier). Each growth step moves the center by exactly the
 * radius gain, so previously-enclosed points stay enclosed
 * (`|p − c'| <= r + |c − c'| = r'`) and ONE pass already encloses the
 * whole sample; the two extra passes only mop up float rounding at the
 * boundary. Deterministic: fixed iteration order over the seeded probe,
 * no randomness. Padding the result outward keeps the same
 * sample-vs-attractor safety convention as the origin ball.
 */
function fitEnclosingBall(positions: Float32Array): {
  center: Vec3;
  radius: number;
} {
  const n = positions.length / 3;
  if (n === 0) return { center: [0, 0, 0], radius: 0 };
  const farthestFrom = (x: number, y: number, z: number): number => {
    let bestD = -1;
    let bestI = 0;
    for (let i = 0; i < n; i++) {
      const dx = positions[i * 3] - x;
      const dy = positions[i * 3 + 1] - y;
      const dz = positions[i * 3 + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > bestD) {
        bestD = d;
        bestI = i;
      }
    }
    return bestI;
  };
  const a = farthestFrom(positions[0], positions[1], positions[2]);
  const b = farthestFrom(
    positions[a * 3],
    positions[a * 3 + 1],
    positions[a * 3 + 2],
  );
  let cx = (positions[a * 3] + positions[b * 3]) / 2;
  let cy = (positions[a * 3 + 1] + positions[b * 3 + 1]) / 2;
  let cz = (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2;
  let r =
    Math.hypot(
      positions[a * 3] - positions[b * 3],
      positions[a * 3 + 1] - positions[b * 3 + 1],
      positions[a * 3 + 2] - positions[b * 3 + 2],
    ) / 2;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) {
      const dx = positions[i * 3] - cx;
      const dy = positions[i * 3 + 1] - cy;
      const dz = positions[i * 3 + 2] - cz;
      const d = Math.hypot(dx, dy, dz);
      if (d > r) {
        const grown = (r + d) / 2;
        const t = (d - grown) / d;
        cx += dx * t;
        cy += dy * t;
        cz += dz * t;
        r = grown;
      }
    }
  }
  return { center: [cx, cy, cz], radius: r };
}

/** Descent stops once the tracked point escapes this multiple of `R`:
 * beyond it, deeper certificates cannot improve the min. */
export const ESCAPE_FACTOR = 2;

/** Depth floor for the footprint-capped descent — the same 4-level floor
 * `render-tier.ts`'s `previewMaxDepth` keeps, for the same reason (the
 * solid-ball artifact at the slowest map's fixed point is what an
 * unfloored cap regrows). */
export const FOOTPRINT_DEPTH_FLOOR = 4;

/**
 * Depth needed before every chain's tracked piece is smaller than the
 * caller's own resolution (brief §3.3): a chain at depth `d`
 * tracks a piece of diameter `<= 2R·slowestSigma^d`, so once that is
 * under `footprint` — the marcher's cone width `eps·t` at the current
 * step — deeper levels resolve sub-footprint detail and an in-sphere cap
 * terminal is a hit AT THAT RESOLUTION (`previewMaxDepth`'s own
 * argument, made per-query instead of per-frame). `footprint <= 0` (and
 * NaN) disables the cap: today's frame-wide depth, bit-identical.
 * Validity is depth-independent — every cap terminal is a certified
 * bound for its chain's piece at ANY depth — so a capped estimate is
 * still a true lower bound, merely coarser.
 */
function footprintDepthCap(de: SurfaceDE, footprint: number): number {
  // A finite prefix has a non-stationary alphabet/bound sequence; the
  // classic logarithmic exponent prices repeated A levels only.
  if (de.schedule) return de.maxDepth;
  if (!(footprint > 0)) return de.maxDepth;
  const cap = Math.ceil(
    Math.log(footprint / (2 * de.boundingRadius)) / Math.log(de.slowestSigma),
  );
  return Math.min(de.maxDepth, Math.max(FOOTPRINT_DEPTH_FLOOR, cap));
}

/** Accumulated-contraction floor that sizes {@link SurfaceDE.maxDepth}:
 * descend until the slowest map chain has shrunk features below ~1e-4. */
export const DEPTH_RESOLUTION = 1e-4;

/** Hard ceiling on {@link SurfaceDE.maxDepth}. Sized so every shipped
 * preset reaches {@link DEPTH_RESOLUTION} in full: the slowest preset map
 * (doubleRotation's sigma 0.93) needs ceil(ln 1e-4 / ln 0.93) = 127
 * levels. The previous ceiling of 48 clamped that to 0.93^48 ~ 0.031 —
 * rendered as a smooth SOLID BALL of radius ~0.047R at the slow map's
 * fixed point, the unresolved image of the bounding sphere under the
 * all-slow-map chain (doubleRotation's surface render grew a fat
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

/** Forward Lipschitz bound of the spherefold's worst branch AT THE CLASSIC
 * RADII: the ×4 inflation inside the minimum-radius ball (the mid
 * inversion's local scale also peaks at 4, at `|x| = 0.5`). The boxfold's
 * branches are isometries (L = 1). The fold's radii are authorable, and
 * the bound a map actually gates on is `variations.ts`'s
 * {@link sphereFoldLipschitz} — the magnification `fR²/mR²`, of which this
 * is the value at the classic lengths. Kept as the classic constant
 * because that is what the fold-family DOCS and tests quote; nothing
 * derives a live bound from it. */
export const SPHEREFOLD_LIPSCHITZ = sphereFoldLipschitz(CLASSIC_FOLD_RADII);

/** u-space query radius below which the spherefold MID branch folds the
 * shell bound instead of descending: inverting a point this close to the
 * origin would overflow the GLSL mirror's f32 arithmetic (`|u|⁻¹` up to 1e3
 * here — comfortably finite — but unbounded without the floor).
 *
 * RELATIVE TO `fR`, not absolute: the mid branch inverts in the sphere of
 * radius `fR`, so the image radius is `fR²/|u|` and holding it to `1e3·fR`
 * — equivalently holding the DIMENSIONLESS `fR²/|u|²` to 1e6 — means the
 * threshold is `SPHEREFOLD_MID_MIN_R · fR`. A threshold scaling with `fR²`
 * (as the original sketch for authored lengths proposed) would be a length²
 * where a length belongs, and would break the uniform-rescale equivariance
 * the whole fold family has: a system and its 2x-scaled twin would guard at
 * different relative radii and stop being the same shape. The two are
 * indistinguishable at the classic `fR = 1`, which is why the sketch could
 * not see the difference. */
export const SPHEREFOLD_MID_MIN_R = 1e-3;

/**
 * The fold's three lengths as the INVERSE branch algebra wants them —
 * derived once per map at build time, because every one of these appears
 * inside a per-candidate, per-branch loop that runs ~1e7 times a frame.
 *
 * Each field is named for the role it plays in the branch enumeration
 * (fold-branch sweep, module doc), and each carries its value at the classic
 * lengths, because "absent means classic" has to be checkable by eye at
 * every site: at the classic radii the expressions below reduce to the
 * literals that shipped, multiplication by exactly 1 and 2*1 included, so a
 * document that predates the fields descends BIT-IDENTICALLY.
 */
export interface SurfaceFoldRadii {
  /** `boxLimit` — the box fold's reflection plane. Its per-axis preimages
   * are `u`, `2·wall − u`, `−2·wall − u` and its in-box region is
   * `[−wall, wall]`. Classic 1. */
  wall: number;
  /** `mR` — the sphere fold's minimum radius, the one AUTHORED length no
   * branch below reads on its own (every CPU site wants it already combined
   * with `fR`). It rides here for the GPU mirrors, which pack the three
   * authored lengths and re-derive the rest of this struct in the shader:
   * a wire of three numbers is checkable against `resolveFoldRadii` by eye,
   * where a wire of eight derived ones would be eight chances to disagree.
   * Classic 0.5. */
  minR: number;
  /** `fR` — the outer branch's region radius, the mid shell's INNER edge,
   * and the divisor of the mid branch's certified factor `|u|/fR`.
   * Classic 1. */
  fixedR: number;
  /** `1/fR`, so that certified factor costs a multiply rather than a divide
   * inside the branch loop. Classic 1. */
  invFixedR: number;
  /** `fR²` — the mid branch's inversion numerator (`v = fR²·u/|u|²`).
   * Classic 1. */
  fixedR2: number;
  /** `mR²/fR²` — the INNER branch's inverse scaling (the forward branch
   * inflates by the reciprocal). Classic 0.25. */
  innerScale: number;
  /** `fR²/mR²` — the inner branch's conformal sigma, which is also the
   * fold's forward Lipschitz bound. Classic 4. */
  innerSigma: number;
  /** `fR²/mR` — the largest radius the sphere fold can output, hence both
   * the INNER branch's region radius and the mid shell's OUTER edge.
   * Classic 2. */
  outputR: number;
  /** {@link SPHEREFOLD_MID_MIN_R}`·fR` — the mid branch's inversion floor.
   * Classic 1e-3. */
  midMinR: number;
}

/** The classic lengths, shared by every map that has no fold to speak of
 * (plain affine slots never read these) and by every fold left at the
 * defaults — one frozen object rather than an allocation per map. */
export const CLASSIC_SURFACE_FOLD_RADII: SurfaceFoldRadii =
  surfaceFoldRadii(null);

/** {@link SurfaceFoldRadii} for a pure-fold variation, or the classic set
 * for `null`. The domain rules live in `variations.ts`'s
 * {@link resolveFoldRadii}; this only re-expresses the resolved lengths in
 * the branch algebra's own terms. */
export function surfaceFoldRadii(fold: Variation | null): SurfaceFoldRadii {
  const {
    minRadius: mR,
    fixedRadius: fR,
    boxLimit: wall,
  } = fold ? resolveFoldRadii(fold) : CLASSIC_FOLD_RADII;
  const fixedR2 = fR * fR;
  return {
    wall,
    minR: mR,
    fixedR: fR,
    invFixedR: 1 / fR,
    fixedR2,
    innerScale: (mR * mR) / fixedR2,
    innerSigma: fixedR2 / (mR * mR),
    outputR: fixedR2 / mR,
    midMinR: SPHEREFOLD_MID_MIN_R * fR,
  };
}

/** {@link SurfaceDEMap.foldKind} vocabulary. Numeric, not a string union:
 * the GLSL mirror carries the kind inside a packed per-map `vec4` uniform,
 * and the descent's hot loop dispatches on it per candidate. */
export const SURFACE_FOLD_NONE = 0;
export const SURFACE_FOLD_BOXFOLD = 1;
export const SURFACE_FOLD_SPHEREFOLD = 2;
export const SURFACE_FOLD_MANDELBOX = 3;
export type SurfaceFoldKind = 0 | 1 | 2 | 3;

/** The variation types the fold-branch sweep can decompose. */
const FOLD_VARIATION_TYPES: ReadonlySet<string> = new Set([
  "boxfold",
  "spherefold",
  "mandelbox",
]);

/** `prepareChaosGame`'s no-symmetry default, duplicated here because it is
 * private there; order 1 is the identity expansion for any axis. */
const NO_SYMMETRY: SymmetryParams = { order: 1, plane: "xz" };

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

/** One global-depth bounding ball for a scheduled Surface descent. */
export interface SurfaceLevelBound {
  center: Vec3;
  radius: number;
  escapeRadius: number;
}

/** One BASE (un-rotated) inverse map of the DE. Kaleidoscope copies are not
 * slots any more — the descent sweeps sectors around these (see the module
 * doc's symmetry section). */
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
  /** The fold's authored lengths in branch-algebra form — the classic set
   * at foldKind 0, where nothing reads it. */
  foldRadii: SurfaceFoldRadii;
  /** Which input transform this slot inverts — the index into the caller's
   * `transforms`, for per-transform coloring. */
  baseIndex: number;
  /** Compact graph-directed state. Present only when chi is non-trivial;
   * scheduled B maps deliberately omit it because B carries wildcard. */
  stateIndex?: number;
  /** Smallest singular value of `invM` — exactly `1 / sigma_max(M)`. With
   * {@link invTNorm} it gives the branch-and-bound's child-radius lower
   * bound `|invM·pre + t'| >= invMSigmaMin·|pre| − invTNorm` (the
   * branch-and-bound's stage 2), knowable from `|pre|` alone, BEFORE the
   * transform. `t'` is `invT − boundCenter` throughout: the skips price the
   * CENTERED child radius the descent actually compares. */
  invMSigmaMin: number;
  /** `|invT − boundCenter|` — the subtracted slack of the sigma-form
   * bound above, and the ADDED term of the directional bound below. */
  invTNorm: number;
  /** `invM^T · t' / |t'|` for `t' = invT − boundCenter` (zero vector when
   * `t'` is): for unit `d = t'/|t'|`, `|invM·pre + t'| >=
   * dot(d, invM·pre) + |t'| = dot(bnbDir, pre) + invTNorm` — the other
   * stage-2 bound, the one that stays TIGHT when the inverse translation
   * dominates the child radius (the common fold case; the sigma-form
   * above loses 2·|t'| of range there, but survives `t' = 0` where this
   * one is vacuous). */
  bnbDir: Vec3;
}

/** The kaleidoscope the descent sweeps instead of expanding. */
export interface SurfaceSymmetry {
  /** Effective sector count — `effectiveSymmetryOrder` against the FULL
   * transform list, exactly as `prepareChaosGame` clamps it. `1` = no
   * kaleidoscope, and the descent then skips sector rotation entirely. */
  order: number;
  /** Coordinate plane the sectors turn in — one of the three w-free planes
   * (`xy`/`xz`/`yz`), the only ones this 3D descent has a rotation for. */
  plane: SymmetryPlane;
  /** `cos`/`sin` of ONE forward sector step `2*pi/order`. The descent walks
   * sectors incrementally off these — no per-sector transcendental, and the
   * GLSL mirror gets the pair as a single `vec2` uniform instead of an
   * order-sized table it could not afford. `1`/`0` at order 1. */
  stepCos: number;
  stepSin: number;
}

/**
 * {@link SurfaceSymmetry.plane} as the shader int both surface backends
 * branch on — the GLSL `uSymPlane` uniform (`surface-material.ts`) and the
 * WGSL `params.symPlane` word (`surface-de-gpu.ts`), which is why it lives
 * here rather than in either of them: one numeric contract, one definition,
 * no drift.
 *
 * The three codes are FROZEN at the values the LEGACY axis codes had
 * (`x = 0`, `y = 1`, `z = 2`), which is the same statement one vocabulary
 * over — "about x" is "in the yz plane" — so a migrated document packs the
 * identical byte and neither shader body's branch order moved.
 *
 * The `w`-plane entries exist only because ORDER 1 is the identity for any
 * plane, so a document may legitimately REMEMBER a `w`-plane while its
 * kaleidoscope is off and still be flat (`affine4.ts`'s `symmetryIsNonFlat`);
 * such a `SurfaceDE` reaches the shaders with `order: 1`, where the sweep is
 * a single unrotated pass and this code is never read. At any order that
 * would read it, {@link buildSurfaceDE} has already thrown.
 */
export const SYM_PLANE_CODE: Readonly<
  Record<SurfaceSymmetry["plane"], number>
> = {
  yz: 0,
  xz: 1,
  xy: 2,
  xw: 0,
  yw: 1,
  zw: 2,
};

/** Everything the marcher needs, precomputed: the wire format the GLSL
 * uniforms are packed from. */
export interface SurfaceDE {
  /** BASE inverse maps — weight-0 maps contribute no slots (they are never
   * selected, so they add nothing to the attractor), and kaleidoscope copies
   * contribute none either: {@link symmetry} replaces the old expansion, so
   * this array is base-sized at any order. */
  maps: SurfaceDEMap[];
  /** Reverse graph-directed support, omitted for absent/all-one chi so the
   * classic object and hot paths remain untouched. */
  chaos?: SurfaceChaosDE;
  /** Finite B-prefix inverse maps and per-global-depth bounds. Absent keeps
   * the classic stationary A alphabet and root ball byte-for-byte. */
  schedule?: SurfaceScheduleDE;
  /** Condensation set C0. Absent on emitter-free systems so their built DE
   * and every estimator arithmetic path stay unchanged. */
  condensation?: CondensationDE3;
  /** Kaleidoscope sectors swept around every {@link maps} entry. */
  symmetry: SurfaceSymmetry;
  /** Bounding-sphere radius of the RAW attractor (pre-final-transform),
   * probed by a seeded chaos game and padded. */
  boundingRadius: number;
  /** Center of that bounding sphere: a Ritter-fit near-smallest
   * enclosing ball of the probe cloud, kept only when its padded radius
   * beats the origin ball's — `[0, 0, 0]` otherwise, which reproduces the
   * historical origin-centered bound exactly. Every descent sphere term
   * (`|q| − R` keys/certs/terminals, the escape test, the depth-0 sphere
   * floor) reads `|q − boundCenter| − boundingRadius` instead; a tighter
   * enclosing ball is still an enclosing ball, so the validity argument
   * is unchanged while off-center attractors stop paying their offset as
   * slack through every level (brief §3.2, factor B). */
  boundCenter: Vec3;
  /** Origin-centred radius bounding the VISIBLE set `F(attractor)`. Without a
   * final transform this is `|boundCenter| + boundingRadius`; a final lens
   * replaces it with the corresponding origin-visible image bound. */
  visibleBoundingRadius: number;
  /** Camera-independent p03/p97 calibration of the greedy native rings and
   * sheets carriers. Derived from the RAW pre-final probe, so neither an
   * affine nor a pure-fold final lens can move these four wire values. */
  patternCalibration: SurfaceNativeCalibration;
  /** `ESCAPE_FACTOR * boundingRadius` — descent past this cannot help. */
  escapeRadius: number;
  /** Descent depth cap, sized so the SLOWEST contraction chain resolves
   * features below {@link DEPTH_RESOLUTION}. */
  maxDepth: number;
  /** The largest per-level certified shrink factor over the maps (the
   * factor {@link maxDepth} is sized from): a chain at depth `d` tracks a
   * piece of the attractor of diameter `<= 2R·slowestSigma^d`, which is
   * what lets a caller cap depth at ITS OWN resolution (the marcher's
   * per-step cone footprint) instead of the frame-wide cap. */
  slowestSigma: number;
  /** How many descent chains {@link estimateDistance} refines in parallel.
   * Widths 1/2 are the classic greedy chain and the paired A/B chains;
   * widths 3/4 add the rank-3/4 VALIDITY slots — extra chains that hold
   * the level's rank-3/4 candidates ONLY while their points are in-sphere
   * (an escaped rank-3/4 candidate folds its refined certificate instead,
   * exactly as it would without the slots), so levels with three or four
   * simultaneous in-sphere branches no longer drop the excess uncounted.
   * {@link buildSurfaceDE} always emits 4 (see the module doc for the
   * measured verdict); 1 and 2 exist so tests can pin each mechanism. The
   * GLSL tracer hardcodes the production width. */
  beamWidth: 1 | 2 | 3 | 4;
  /** March step multiplier from {@link analyzeSurfaceSystem}. */
  stepScale: number;
  /** Pre-inverted AFFINE final-transform lens (the plotted set is
   * `F(attractor)`), or `null`. Applied ONCE to the query point; the result
   * is un-scaled by its `sigmaMin`. Always `null` when {@link foldFinal}
   * is set — the two lens shapes are mutually exclusive, and the descent
   * cores only ever see this one (the fold lens wraps them from outside). */
  final: { invM: number[]; invT: Vec3; sigmaMin: number } | null;
  /** Pure-FOLD final-transform lens `F = w·V(M p + t)`, or
   * `null`. Handled by {@link descendLens}: the fold's inverse branches
   * are enumerated ONCE at the query — each an affine-lensed root descent
   * with certified factor `|w|·sigma_branch·sigmaMin` and a region floor
   * `|w|·regionDist` (the fold-branch sweep's vocabulary, lifted one level) —
   * and the descent cores run their no-lens path untouched. `invW`/`absW` are
   * `1/w` and `|w|`; `invM`/`invT`/`sigmaMin` are the lens's AFFINE part,
   * exactly {@link SurfaceDE.final}'s fields. */
  foldFinal: {
    invM: number[];
    invT: Vec3;
    sigmaMin: number;
    foldKind: SurfaceFoldKind;
    invW: number;
    absW: number;
    /** The lens fold's authored lengths, in the same branch-algebra form
     * the base maps carry. */
    foldRadii: SurfaceFoldRadii;
  } | null;
}

/** CPU/build-only controls for condensation geometry. Persistence and UI
 * wiring deliberately land with the integration stage. */
export interface SurfaceDEBuildOptions {
  condensationDepthBand?: CondensationDepthBand;
  schedule?: HybridSchedule | null;
}

/** Minimal shared shape accepted by {@link surfaceOriginVisibleRadius}. The
 * 4D descriptor deliberately has no `boundCenter`: its raw and visible balls
 * are already origin-centred. */
interface SurfaceOriginVisibleBounds {
  boundingRadius: number;
  visibleBoundingRadius: number;
  boundCenter?: readonly number[];
  final: object | null;
  foldFinal: object | null;
}

/** Certified radius of the rendered set about the origin. A plain 3D inverse
 * IFS may use a tighter off-origin descent ball, so its origin-visible radius
 * restores the centre offset. Affine/fold final lenses already bake that
 * offset into `visibleBoundingRadius`, as do all 4D descriptors. */
export function surfaceOriginVisibleRadius(
  de: SurfaceOriginVisibleBounds,
): number {
  const center = de.boundCenter;
  if (center && de.final === null && de.foldFinal === null) {
    return Math.hypot(center[0], center[1], center[2]) + de.boundingRadius;
  }
  return de.visibleBoundingRadius;
}

/** Prepared CPU form of a scheduled hybrid. `bounds[d]` encloses
 * `B^(depth-d)(A)` and `bounds[depth]` is A's ordinary bound. */
export interface SurfaceScheduleDE {
  maps: SurfaceDEMap[];
  depth: number;
  bounds: SurfaceLevelBound[];
}

/** Surface's compact graph-directed representation. Recursive maps occupy
 * the first states in `maps` order; unique emitter bases follow. Mask `j`
 * contains every predecessor state `i` for which the point sampler can take
 * the forward edge i -> j. Symmetry copies share their base state. */
export interface SurfaceChaosDE {
  predecessorMasks: Uint32Array;
  emitterStateIndices: Uint8Array;
  activeStateCount: number;
}

/** Wildcard chain state used at the reverse root and through scheduled B. */
export const SURFACE_CHAOS_WILDCARD = 0xffffffff;
export const MAX_SURFACE_CHAOS_STATES = 24;

/** Whether reverse candidate `predecessorState` is admitted beneath a chain
 * whose current outer state is `currentState`. Exported for CPU mirrors and
 * focused oracle tests; shaders use the identical bit test. */
export function surfaceChaosAllows(
  chaos: SurfaceChaosDE | undefined,
  currentState: number,
  predecessorState: number,
): boolean {
  return (
    chaos === undefined ||
    currentState === SURFACE_CHAOS_WILDCARD ||
    (chaos.predecessorMasks[currentState] & (1 << predecessorState)) !== 0
  );
}

/** Build binary reverse support from the point picker's exact chi domain.
 * Positive authored magnitudes affect probability, never geometry. A row
 * with no positive active destination falls back to global active support,
 * exactly like `pickIndex`'s degenerate-row branch. */
export function buildSurfaceChaosDE(
  transforms: readonly Transform[],
  recursiveBaseIndices: readonly number[],
  emitterBaseIndices: readonly number[],
  emitterCopyBaseIndices: readonly number[] = [],
  symmetry: SymmetryParams = NO_SYMMETRY,
): SurfaceChaosDE | undefined {
  if (!systemHasChaos(transforms)) return undefined;
  const activeBases = [...recursiveBaseIndices, ...emitterBaseIndices];
  if (activeBases.length > MAX_SURFACE_CHAOS_STATES) {
    throw new RangeError(
      `Surface graph supports at most ${MAX_SURFACE_CHAOS_STATES} active states, got ${activeBases.length}`,
    );
  }
  const stateByBase = new Map<number, number>();
  activeBases.forEach((base, state) => stateByBase.set(base, state));
  const order = effectiveSymmetryOrder(symmetry.order, transforms.length);
  const blend = Math.min(1, Math.max(0, symmetry.blend ?? 1));
  const slotWeights = new Array<number>(order * transforms.length);
  for (let slot = 0; slot < slotWeights.length; slot++) {
    const base = transforms[slot % transforms.length].weight ?? 1;
    slotWeights[slot] = slot < transforms.length ? base : base * blend;
  }
  const selection = buildChaosSelection(
    transforms,
    slotWeights,
    transforms.length,
  )!;
  const fallbackRows = new Set(selection.chaosFallbackRows);
  const predecessorMasks = new Uint32Array(activeBases.length);
  for (
    let predecessorState = 0;
    predecessorState < activeBases.length;
    predecessorState++
  ) {
    const predecessorBase = activeBases[predecessorState];
    const fallback = fallbackRows.has(predecessorBase);
    for (
      let destinationState = 0;
      destinationState < activeBases.length;
      destinationState++
    ) {
      const destinationBase = activeBases[destinationState];
      let supported = fallback;
      if (!supported) {
        const row = selection.chaosRows[predecessorBase];
        for (
          let slot = destinationBase;
          slot < row.length;
          slot += transforms.length
        ) {
          const previous = slot === 0 ? 0 : row[slot - 1];
          if (row[slot] > previous) {
            supported = true;
            break;
          }
        }
      }
      if (supported) {
        predecessorMasks[destinationState] |= 1 << predecessorState;
      }
    }
  }
  return {
    predecessorMasks,
    emitterStateIndices: Uint8Array.from(
      emitterCopyBaseIndices.map((base) => stateByBase.get(base)!),
    ),
    activeStateCount: activeBases.length,
  };
}

type SurfaceNativeCarrierContext = Pick<
  SurfaceDE,
  | "maps"
  | "schedule"
  | "chaos"
  | "symmetry"
  | "boundingRadius"
  | "boundCenter"
  | "escapeRadius"
  | "maxDepth"
>;

/** Scratch triple for the native-carrier sector sweep. Calibration runs only
 * during the synchronous DE build, and the public evaluator never re-enters
 * itself, so one module-owned tuple keeps its inner loop allocation-free. */
const NATIVE_CARRIER_SWEEP = [0, 0, 0];

/**
 * Production CPU oracle for the surface shaders' native-trap trajectories.
 * `sourcePoint` is already in the RAW attractor frame: final-transform lenses
 * are deliberately absent from this evaluator. Affine systems mirror the
 * shader's width-4 ladder trajectory; any fold base map selects the fold
 * shader's deliberately greedy width-1 shading path.
 */
export function evaluateSurfaceNativeCarriers(
  de: SurfaceDE,
  sourcePoint: Vec3,
): SurfaceNativeCarrierSample {
  return evaluateSurfaceNativeCarriersRaw(
    de,
    sourcePoint[0],
    sourcePoint[1],
    sourcePoint[2],
  );
}

function evaluateSurfaceNativeCarriersRaw(
  de: SurfaceNativeCarrierContext,
  sourceX: number,
  sourceY: number,
  sourceZ: number,
): SurfaceNativeCarrierSample {
  for (const map of de.maps) {
    if (map.foldKind !== SURFACE_FOLD_NONE) {
      return evaluateFoldSurfaceNativeCarriersRaw(
        de,
        sourceX,
        sourceY,
        sourceZ,
      );
    }
  }
  return evaluateAffineSurfaceNativeCarriersRaw(de, sourceX, sourceY, sourceZ);
}

/** Width-4 affine shading trajectory: the primary chain's rings/sheets see
 * every candidate carried by the top-2 plus rank-3/4 spill ladders. */
function evaluateAffineSurfaceNativeCarriersRaw(
  de: SurfaceNativeCarrierContext,
  sourceX: number,
  sourceY: number,
  sourceZ: number,
): SurfaceNativeCarrierSample {
  const { order, plane, stepCos, stepSin } = de.symmetry;
  let rings = 1;
  let sheets = 1;
  const chainX = [sourceX, 0, 0, 0];
  const chainY = [sourceY, 0, 0, 0];
  const chainZ = [sourceZ, 0, 0, 0];
  const chainScale = [1, 1, 1, 1];
  const chainState = [
    SURFACE_CHAOS_WILDCARD,
    SURFACE_CHAOS_WILDCARD,
    SURFACE_CHAOS_WILDCARD,
    SURFACE_CHAOS_WILDCARD,
  ];
  const chainLive = [true, false, false, false];
  const key = [1e30, 1e30, 1e30, 1e30];
  const pointX = [0, 0, 0, 0];
  const pointY = [0, 0, 0, 0];
  const pointZ = [0, 0, 0, 0];
  const scale = [1, 1, 1, 1];
  const radius = [0, 0, 0, 0];
  const pointState = [
    SURFACE_CHAOS_WILDCARD,
    SURFACE_CHAOS_WILDCARD,
    SURFACE_CHAOS_WILDCARD,
    SURFACE_CHAOS_WILDCARD,
  ];

  for (let depth = 0; depth < de.maxDepth; depth++) {
    if (!chainLive[0] && !chainLive[1] && !chainLive[2] && !chainLive[3]) {
      break;
    }
    key.fill(1e30);
    pointX.fill(0);
    pointY.fill(0);
    pointZ.fill(0);
    scale.fill(1);
    radius.fill(0);

    const inB = de.schedule !== undefined && depth < de.schedule.depth;
    const levelMaps = inB ? de.schedule!.maps : de.maps;
    const sectorOrder = inB ? 1 : order;
    const childBound = de.schedule
      ? de.schedule.bounds[Math.min(depth + 1, de.schedule.depth)]
      : null;
    const R = childBound ? childBound.radius : de.boundingRadius;
    const bcX = childBound ? childBound.center[0] : de.boundCenter[0];
    const bcY = childBound ? childBound.center[1] : de.boundCenter[1];
    const bcZ = childBound ? childBound.center[2] : de.boundCenter[2];
    const escapeRadius = childBound ? childBound.escapeRadius : de.escapeRadius;

    for (let chain = 0; chain < 4; chain++) {
      if (!chainLive[chain]) continue;
      const parentScale = chainScale[chain];
      const parentState = chainState[chain];
      let sectorX = chainX[chain];
      let sectorY = chainY[chain];
      let sectorZ = chainZ[chain];
      for (let k = 0; k < sectorOrder; k++) {
        if (k > 0) {
          stepSector(
            plane,
            stepCos,
            stepSin,
            sectorX,
            sectorY,
            sectorZ,
            NATIVE_CARRIER_SWEEP,
          );
          sectorX = NATIVE_CARRIER_SWEEP[0];
          sectorY = NATIVE_CARRIER_SWEEP[1];
          sectorZ = NATIVE_CARRIER_SWEEP[2];
        }
        for (const map of levelMaps) {
          if (
            !inB &&
            !surfaceChaosAllows(de.chaos, parentState, map.stateIndex!)
          ) {
            continue;
          }
          const childState = inB
            ? SURFACE_CHAOS_WILDCARD
            : (map.stateIndex ?? SURFACE_CHAOS_WILDCARD);
          const im = map.invM;
          const it = map.invT;
          const imageX =
            im[0] * sectorX + im[1] * sectorY + im[2] * sectorZ + it[0];
          const imageY =
            im[3] * sectorX + im[4] * sectorY + im[5] * sectorZ + it[1];
          const imageZ =
            im[6] * sectorX + im[7] * sectorY + im[8] * sectorZ + it[2];
          const r = Math.hypot(imageX - bcX, imageY - bcY, imageZ - bcZ);
          const candidateKey = parentScale * (r - R);
          const childScale = parentScale * map.sigmaMin;
          let evictedKey = candidateKey;
          let evictedX = imageX;
          let evictedY = imageY;
          let evictedZ = imageZ;
          let evictedScale = childScale;
          let evictedR = r;
          let evictedState = childState;

          if (candidateKey < key[0]) {
            evictedKey = key[1];
            evictedX = pointX[1];
            evictedY = pointY[1];
            evictedZ = pointZ[1];
            evictedScale = scale[1];
            evictedR = radius[1];
            evictedState = pointState[1];
            key[1] = key[0];
            pointX[1] = pointX[0];
            pointY[1] = pointY[0];
            pointZ[1] = pointZ[0];
            scale[1] = scale[0];
            radius[1] = radius[0];
            pointState[1] = pointState[0];
            key[0] = candidateKey;
            pointX[0] = imageX;
            pointY[0] = imageY;
            pointZ[0] = imageZ;
            scale[0] = childScale;
            radius[0] = r;
            pointState[0] = childState;
          } else if (candidateKey < key[1]) {
            evictedKey = key[1];
            evictedX = pointX[1];
            evictedY = pointY[1];
            evictedZ = pointZ[1];
            evictedScale = scale[1];
            evictedR = radius[1];
            evictedState = pointState[1];
            key[1] = candidateKey;
            pointX[1] = imageX;
            pointY[1] = imageY;
            pointZ[1] = imageZ;
            scale[1] = childScale;
            radius[1] = r;
            pointState[1] = childState;
          }

          if (evictedKey < key[2]) {
            key[3] = key[2];
            pointX[3] = pointX[2];
            pointY[3] = pointY[2];
            pointZ[3] = pointZ[2];
            scale[3] = scale[2];
            radius[3] = radius[2];
            pointState[3] = pointState[2];
            key[2] = evictedKey;
            pointX[2] = evictedX;
            pointY[2] = evictedY;
            pointZ[2] = evictedZ;
            scale[2] = evictedScale;
            radius[2] = evictedR;
            pointState[2] = evictedState;
          } else if (evictedKey < key[3]) {
            key[3] = evictedKey;
            pointX[3] = evictedX;
            pointY[3] = evictedY;
            pointZ[3] = evictedZ;
            scale[3] = evictedScale;
            radius[3] = evictedR;
            pointState[3] = evictedState;
          }
        }
      }
    }

    rings = Math.min(rings, radius[0] / R);
    sheets = Math.min(sheets, Math.abs(pointY[0]) / R);
    for (let chain = 0; chain < 4; chain++) chainLive[chain] = false;
    if (key[0] < 1e29 && radius[0] <= escapeRadius) {
      chainX[0] = pointX[0];
      chainY[0] = pointY[0];
      chainZ[0] = pointZ[0];
      chainScale[0] = scale[0];
      chainState[0] = pointState[0];
      chainLive[0] = true;
    }
    if (key[1] < 1e29 && radius[1] <= escapeRadius) {
      chainX[1] = pointX[1];
      chainY[1] = pointY[1];
      chainZ[1] = pointZ[1];
      chainScale[1] = scale[1];
      chainState[1] = pointState[1];
      chainLive[1] = true;
    }
    if (key[2] < 1e29 && radius[2] <= R) {
      chainX[2] = pointX[2];
      chainY[2] = pointY[2];
      chainZ[2] = pointZ[2];
      chainScale[2] = scale[2];
      chainState[2] = pointState[2];
      chainLive[2] = true;
    }
    if (key[3] < 1e29 && radius[3] <= R) {
      chainX[3] = pointX[3];
      chainY[3] = pointY[3];
      chainZ[3] = pointZ[3];
      chainScale[3] = scale[3];
      chainState[3] = pointState[3];
      chainLive[3] = true;
    }
  }

  return {
    rings: Math.min(1, Math.max(0, rings)),
    sheets: Math.min(1, Math.max(0, sheets)),
  };
}

/** Width-1 fold shading trajectory: strict lowest floored candidate over the
 * complete sector/base-map/fold-branch stream at every level. */
function evaluateFoldSurfaceNativeCarriersRaw(
  de: SurfaceNativeCarrierContext,
  sourceX: number,
  sourceY: number,
  sourceZ: number,
): SurfaceNativeCarrierSample {
  const { order, plane, stepCos, stepSin } = de.symmetry;
  let rings = 1;
  let sheets = 1;
  let chX = sourceX;
  let chY = sourceY;
  let chZ = sourceZ;
  let chScale = 1;
  let chFloor = 0;
  let chState = SURFACE_CHAOS_WILDCARD;

  for (let depth = 0; depth < de.maxDepth; depth++) {
    const inB = de.schedule !== undefined && depth < de.schedule.depth;
    const levelMaps = inB ? de.schedule!.maps : de.maps;
    const sectorOrder = inB ? 1 : order;
    const childBound = de.schedule
      ? de.schedule.bounds[Math.min(depth + 1, de.schedule.depth)]
      : null;
    const R = childBound ? childBound.radius : de.boundingRadius;
    const bcX = childBound ? childBound.center[0] : de.boundCenter[0];
    const bcY = childBound ? childBound.center[1] : de.boundCenter[1];
    const bcZ = childBound ? childBound.center[2] : de.boundCenter[2];
    const escapeRadius = childBound ? childBound.escapeRadius : de.escapeRadius;
    let lowestKey = Infinity;
    let lowestR = 0;
    let lowestAbsY = 0;
    let lowestX = 0;
    let lowestY = 0;
    let lowestZ = 0;
    let lowestScale = 1;
    let lowestFloor = 0;
    let lowestState = SURFACE_CHAOS_WILDCARD;
    const parentScale = chScale;
    const parentFloor = chFloor;
    let sectorX = chX;
    let sectorY = chY;
    let sectorZ = chZ;

    for (let k = 0; k < sectorOrder; k++) {
      if (k > 0) {
        stepSector(
          plane,
          stepCos,
          stepSin,
          sectorX,
          sectorY,
          sectorZ,
          NATIVE_CARRIER_SWEEP,
        );
        sectorX = NATIVE_CARRIER_SWEEP[0];
        sectorY = NATIVE_CARRIER_SWEEP[1];
        sectorZ = NATIVE_CARRIER_SWEEP[2];
      }

      for (const map of levelMaps) {
        if (!inB && !surfaceChaosAllows(de.chaos, chState, map.stateIndex!)) {
          continue;
        }
        const im = map.invM;
        const it = map.invT;
        const kind = map.foldKind;
        const branchCount = foldBranchCount(kind);
        const absW = map.foldSigma / map.sigmaMin;
        const fr = map.foldRadii;
        const wall = fr.wall;
        const wall2 = 2 * wall;

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
        let sphereSigma = 1;
        let sphereRegionDistance = 0;

        if (kind !== SURFACE_FOLD_NONE) {
          ux = sectorX * map.foldInvW;
          uy = sectorY * map.foldInvW;
          uz = sectorZ * map.foldInvW;
          if (kind === SURFACE_FOLD_BOXFOLD) {
            px0 = ux;
            px1 = wall2 - ux;
            px2 = -wall2 - ux;
            py0 = uy;
            py1 = wall2 - uy;
            py2 = -wall2 - uy;
            pz0 = uz;
            pz1 = wall2 - uz;
            pz2 = -wall2 - uz;
            dxUp = Math.max(ux - wall, 0);
            dxDn = Math.max(-wall - ux, 0);
            dyUp = Math.max(uy - wall, 0);
            dyDn = Math.max(-wall - uy, 0);
            dzUp = Math.max(uz - wall, 0);
            dzDn = Math.max(-wall - uz, 0);
          } else {
            ru = Math.hypot(ux, uy, uz);
          }
        }

        for (let branch = 0; branch < branchCount; branch++) {
          let preX: number;
          let preY: number;
          let preZ: number;
          let branchSigma: number;
          let branchRegionDistance = 0;

          if (kind === SURFACE_FOLD_NONE) {
            preX = sectorX;
            preY = sectorY;
            preZ = sectorZ;
            branchSigma = map.sigmaMin;
          } else {
            if (
              kind === SURFACE_FOLD_SPHEREFOLD ||
              (kind === SURFACE_FOLD_MANDELBOX && branch % 27 === 0)
            ) {
              const piece =
                kind === SURFACE_FOLD_SPHEREFOLD
                  ? branch
                  : Math.floor(branch / 27);
              if (piece === 0) {
                vx = ux;
                vy = uy;
                vz = uz;
                sphereSigma = 1;
                sphereRegionDistance = Math.max(fr.fixedR - ru, 0);
              } else if (piece === 1) {
                vx = fr.innerScale * ux;
                vy = fr.innerScale * uy;
                vz = fr.innerScale * uz;
                sphereSigma = fr.innerSigma;
                sphereRegionDistance = Math.max(ru - fr.outputR, 0);
              } else {
                if (ru < fr.midMinR) {
                  if (kind === SURFACE_FOLD_MANDELBOX) branch += 26;
                  continue;
                }
                const invR2 = fr.fixedR2 / (ru * ru);
                vx = ux * invR2;
                vy = uy * invR2;
                vz = uz * invR2;
                sphereSigma = ru * fr.invFixedR;
                sphereRegionDistance = Math.max(
                  Math.max(fr.fixedR - ru, ru - fr.outputR),
                  0,
                );
              }

              if (kind === SURFACE_FOLD_MANDELBOX) {
                px0 = vx;
                px1 = wall2 - vx;
                px2 = -wall2 - vx;
                py0 = vy;
                py1 = wall2 - vy;
                py2 = -wall2 - vy;
                pz0 = vz;
                pz1 = wall2 - vz;
                pz2 = -wall2 - vz;
                dxUp = Math.max(vx - wall, 0);
                dxDn = Math.max(-wall - vx, 0);
                dyUp = Math.max(vy - wall, 0);
                dyDn = Math.max(-wall - vy, 0);
                dzUp = Math.max(vz - wall, 0);
                dzDn = Math.max(-wall - vz, 0);
              }
            }

            if (kind === SURFACE_FOLD_SPHEREFOLD) {
              preX = vx;
              preY = vy;
              preZ = vz;
              branchRegionDistance = sphereRegionDistance;
            } else {
              const boxBranch =
                kind === SURFACE_FOLD_BOXFOLD ? branch : branch % 27;
              const selectX = boxBranch % 3;
              const selectY = Math.floor(boxBranch / 3) % 3;
              const selectZ = Math.floor(boxBranch / 9);
              preX = selectX === 0 ? px0 : selectX === 1 ? px1 : px2;
              preY = selectY === 0 ? py0 : selectY === 1 ? py1 : py2;
              preZ = selectZ === 0 ? pz0 : selectZ === 1 ? pz1 : pz2;
              const distX =
                selectX === 0
                  ? Math.max(dxUp, dxDn)
                  : selectX === 1
                    ? dxUp
                    : dxDn;
              const distY =
                selectY === 0
                  ? Math.max(dyUp, dyDn)
                  : selectY === 1
                    ? dyUp
                    : dyDn;
              const distZ =
                selectZ === 0
                  ? Math.max(dzUp, dzDn)
                  : selectZ === 1
                    ? dzUp
                    : dzDn;
              // Hot calibration path: the inputs are finite fold-region
              // distances, so mirror shader `length` directly instead of
              // paying Math.hypot's general-purpose rescaling cost.
              const boxRegionDistance = Math.sqrt(
                distX * distX + distY * distY + distZ * distZ,
              );
              branchRegionDistance =
                kind === SURFACE_FOLD_BOXFOLD
                  ? boxRegionDistance
                  : Math.max(
                      sphereRegionDistance,
                      sphereSigma * boxRegionDistance,
                    );
            }
            branchSigma = map.foldSigma * sphereSigma;
          }

          const imageX = im[0] * preX + im[1] * preY + im[2] * preZ + it[0];
          const imageY = im[3] * preX + im[4] * preY + im[5] * preZ + it[1];
          const imageZ = im[6] * preX + im[7] * preY + im[8] * preZ + it[2];
          const dx = imageX - bcX;
          const dy = imageY - bcY;
          const dz = imageZ - bcZ;
          const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
          let candidateFloor = parentFloor;
          if (branchRegionDistance > 0) {
            candidateFloor = Math.max(
              candidateFloor,
              parentScale * absW * branchRegionDistance,
            );
          }
          let key = parentScale * (r - R);
          if (candidateFloor > 0 && candidateFloor > key) key = candidateFloor;
          if (key < lowestKey) {
            lowestKey = key;
            lowestR = r;
            lowestAbsY = Math.abs(imageY);
            lowestX = imageX;
            lowestY = imageY;
            lowestZ = imageZ;
            lowestScale = parentScale * branchSigma;
            lowestFloor = candidateFloor;
            lowestState = inB
              ? SURFACE_CHAOS_WILDCARD
              : (map.stateIndex ?? SURFACE_CHAOS_WILDCARD);
          }
        }
      }
    }

    if (lowestKey === Infinity) break;
    rings = Math.min(rings, lowestR / R);
    sheets = Math.min(sheets, lowestAbsY / R);
    if (lowestR > escapeRadius) break;
    chX = lowestX;
    chY = lowestY;
    chZ = lowestZ;
    chScale = lowestScale;
    chFloor = lowestFloor;
    chState = lowestState;
  }

  return {
    rings: Math.min(1, Math.max(0, rings)),
    sheets: Math.min(1, Math.max(0, sheets)),
  };
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
 * `|w| · L_V`, with L = 1 for the boxfold's reflection isometries (at any
 * `boxLimit`) and the sphere fold's magnification `fR²/mR²` for the families
 * containing its inner branch — so the fold's own radii move the contraction
 * gate with them (measured: exactly one shipped system, `mandelboxKifs`, is
 * close enough to cross the Surface/escape-time seam). */
function foldLipschitz(v: Variation): number {
  return (
    Math.abs(v.weight) *
    (v.type === "boxfold" ? 1 : sphereFoldLipschitz(resolveFoldRadii(v)))
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
  schedule: HybridSchedule | null = null,
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

  if (
    active.length > 0 &&
    transforms.every((t) => !isActive(t) || transformHasEmitter(t))
  ) {
    reasons.push("shape emitters leave no recursive maps");
  }

  transforms.forEach((t, i) => {
    if (!isActive(t)) return;
    const label = `map ${i + 1}`;
    if (transformHasEmitter(t)) {
      // Surface consumes the emitter's SDF directly, so even an intersection
      // that has no point sampler remains a condensation shape here. Only
      // the full affine pose matters and the transform is not recursive.
      if (!isFlatTransform(t)) {
        reasons.push(`${label} extends into 4D`);
      }
      if (sigmas[i].min < NEAR_SINGULAR_SIGMA) {
        reasons.push(`${label} emitter is nearly flat (scale ≈ 0)`);
      }
      return;
    }
    // Pure-fold maps (exactly one active fold-family variation) descend via
    // the fold-branch sweep (module doc); every other active
    // variation list has no tractable inverse and gates the mode out.
    const fold = pureFoldVariation(t);
    if (!fold && hasActiveVariations(t)) {
      reasons.push(`${label} uses variations`);
    }
    // The composite gate below cannot catch w ≈ 0 — a smaller weight only
    // ever helps contraction — but the descent divides by w. See
    // NEAR_ZERO_FOLD_WEIGHT.
    if (fold && Math.abs(fold.weight) < NEAR_ZERO_FOLD_WEIGHT) {
      reasons.push(`${label} fold weight ≈ 0`);
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
    if (transformHasEmitter(finalTransform)) {
      reasons.push("final transform has a shape emitter");
    }
    // A pure-fold FINAL is eligible: the lens is applied ONCE to
    // the query point, so its fold expands into one round of branch root
    // descents — {@link descendLens} — with no contraction requirement (an
    // un-iterated map needs none, exactly like the affine lens). Blended
    // final variation lists stay out for the iterated maps' reason: a
    // weighted sum has no branch decomposition.
    const foldFinal = pureFoldVariation(finalTransform);
    if (!foldFinal && hasActiveVariations(finalTransform)) {
      reasons.push("final transform uses variations");
    }
    // The lens has no contraction gate at all, so the weight floor is the
    // ONLY thing standing between a hand-edited w ≈ 0 and descendLens's
    // 1/w (see NEAR_ZERO_FOLD_WEIGHT).
    if (foldFinal && Math.abs(foldFinal.weight) < NEAR_ZERO_FOLD_WEIGHT) {
      reasons.push("final transform fold weight ≈ 0");
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

  const preparedSchedule = prepareSchedule(schedule);
  if (preparedSchedule) {
    const supported = schedule!.transforms.filter(
      (t) => !preparedSchedule.weighted || (t.weight ?? 1) > 0,
    );
    supported.forEach((t, i) => {
      const label = `schedule map ${i + 1}`;
      if (!isFlatTransform(t)) {
        reasons.push(`${label} extends into 4D`);
      }
      const s = transformSigmas(t);
      if (s.min < NEAR_SINGULAR_SIGMA) {
        reasons.push(`${label} is nearly flat (scale ≈ 0)`);
      } else {
        // B is finite, so it has no contraction gate; anisotropy still
        // determines the conservative world-space march factor.
        anisotropy = Math.max(anisotropy, s.max / s.min);
      }
    });
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
 * One sector step of the kaleidoscope sweep: turn `(x, y, z)`
 * BACKWARD by `2*pi/order` in `plane`, writing into `out` so the descent's
 * hot loop never allocates.
 *
 * This is the TRANSPOSE of `chaos-game.ts`'s `symmetryRotation(plane, +step)`
 * — copy `k` rotates forward after its base map, so descending through that
 * copy un-rotates first — and `symmetryRotation` is `rotationMatrixXYZ` with
 * a single nonzero Euler angle, i.e. the plain right-handed rotation fixing
 * the plane's complementary axis. Transposing flips the sign of `sin` alone,
 * which is why one `(cos, sin)` pair of the FORWARD step drives every sector.
 *
 * The three branches are the plane-vocabulary rename of the legacy
 * `x`/`y`/`z` axis branches — `yz`/`xz`/`xy` in that same order, same
 * arithmetic — so the swept group is bit-identically the one this always
 * swept. A `w`-plane never reaches here (the 3D surface descent is only
 * built for flat systems); the `else` keeps the legacy branchless shape
 * rather than paying a throw in the descent's hot loop, and
 * {@link buildSurfaceDE} rejects one up front.
 */
function stepSector(
  plane: SymmetryPlane,
  c: number,
  s: number,
  x: number,
  y: number,
  z: number,
  out: number[],
): void {
  if (plane === "yz") {
    out[0] = x;
    out[1] = c * y + s * z;
    out[2] = -s * y + c * z;
  } else if (plane === "xz") {
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
  options: SurfaceDEBuildOptions = {},
): SurfaceDE {
  const analysis = analyzeSurfaceSystem(
    transforms,
    finalTransform,
    options.schedule,
  );
  if (analysis.status === "ineligible") {
    throw new Error(
      `system has no surface distance estimator: ${analysis.reasons.join("; ")}`,
    );
  }
  // A w-plane (or a twist) makes the SYSTEM 4D — `affine4.ts`'s
  // `symmetryIsNonFlat` — so it routes to `surface-de-4d.ts`, never here.
  // Loud, like the over-cap map count the material refuses: reaching this
  // 3D builder with a 4D kaleidoscope is a routing bug, not a degrade.
  if (symmetryIsNonFlat(symmetry)) {
    throw new Error(
      `surface-de: a 4D kaleidoscope (plane "${symmetry.plane}", twist ` +
        `${symmetry.twist ?? 0}) has no 3D descent — route to the 4D tracer`,
    );
  }

  // Base inverses, one per ACTIVE map — the whole array, at any symmetry
  // order. The kaleidoscope copy k applies its rotation AFTER the
  // base map (chaos-game.ts postRotations), so copy (k, i) is
  // p -> Rot_k · (M_i p + t_i), whose inverse is
  // q -> inv(M_i) · (Rot_k^T · q) - inv(M_i) · t_i — a base inverse applied
  // to the point ALREADY turned into sector k, which is exactly what the
  // descent's sector sweep feeds it. Nothing per-copy is left to store.
  const hasEmitter = transforms.some(
    (transform) => isActive(transform) && transformHasEmitter(transform),
  );
  const hasChaos = systemHasChaos(transforms);
  const maps: SurfaceDEMap[] = [];
  transforms.forEach((t, i) => {
    if (!isActive(t)) return;
    if (transformHasEmitter(t)) return;
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
      foldRadii: surfaceFoldRadii(fold),
      baseIndex: i,
      ...(hasChaos ? { stateIndex: maps.length } : {}),
      // Reciprocal singular values: sigma(inv(M)) = 1/sigma(M), so the
      // smallest of the inverse is exactly one over the largest of the
      // forward map (the branch-and-bound stage 2's bound data).
      invMSigmaMin: 1 / analysis.sigmas[i].max,
      // Filled below, once the bounding ball's center is known — the
      // stage-2 bounds must price the CENTERED child radius.
      invTNorm: 0,
      bnbDir: [0, 0, 0],
    });
  });

  // B's support is the picker's exact support: a genuinely weighted table
  // can select only positive-weight entries; the uniform path includes every
  // entry, including prepareSchedule's all-zero fallback.
  const preparedSchedule = prepareSchedule(options.schedule);
  let scheduleMaps: SurfaceDEMap[] | null = null;
  let scheduleTransforms: Transform[] | null = null;
  if (preparedSchedule && options.schedule) {
    scheduleTransforms = options.schedule.transforms.filter(
      (t) => !preparedSchedule.weighted || (t.weight ?? 1) > 0,
    );
    scheduleMaps = scheduleTransforms.map((t, i) => {
      const affine = composeAffine(t);
      const invM = inverse3(affine.m);
      const [tx, ty, tz] = affine.t;
      const sigmas = transformSigmas(t);
      return {
        invM,
        invT: [
          -(invM[0] * tx + invM[1] * ty + invM[2] * tz),
          -(invM[3] * tx + invM[4] * ty + invM[5] * tz),
          -(invM[6] * tx + invM[7] * ty + invM[8] * tz),
        ],
        sigmaMin: sigmas.min,
        foldKind: SURFACE_FOLD_NONE,
        foldInvW: 1,
        foldSigma: sigmas.min,
        foldRadii: surfaceFoldRadii(null),
        baseIndex: i,
        invMSigmaMin: 1 / sigmas.max,
        // B stage 2 is disabled: its child center changes with global depth.
        invTNorm: 0,
        bnbDir: [0, 0, 0],
      } satisfies SurfaceDEMap;
    });
  }

  // Sector count mirroring prepareChaosGame: the effective order is clamped
  // against the FULL list length (weight-0 slots included), so the swept set
  // is the plotted set. `blend` is deliberately not read — it fades copy
  // WEIGHTS, never geometry, and the expansion this replaces ignored it too
  // (module doc, BLEND).
  const order = effectiveSymmetryOrder(symmetry.order, transforms.length);
  const step = (2 * Math.PI) / order;

  let condensation: CondensationDE3 | undefined;
  const emitterBaseIndices: number[] = [];
  const emitterCopyBaseIndices: number[] = [];
  if (hasEmitter) {
    const emitters: CondensationEmitter3[] = [];
    const shadeIndices = new Map<number, number>();
    let nextShadeIndex = maps.length;
    for (let i = 0; i < transforms.length; i++) {
      if (isActive(transforms[i]) && transformHasEmitter(transforms[i])) {
        shadeIndices.set(i, nextShadeIndex++);
        emitterBaseIndices.push(i);
      }
    }
    for (let k = 0; k < order; k++) {
      const post = k === 0 ? null : symmetryRotation(symmetry.plane, step * k);
      for (let i = 0; i < transforms.length; i++) {
        if (!isActive(transforms[i]) || !transformHasEmitter(transforms[i])) {
          continue;
        }
        const t = transforms[i];
        const affine = composeAffine(t);
        const baseInv = inverse3(affine.m);
        const [tx, ty, tz] = affine.t;
        const invT: Vec3 = [
          -(baseInv[0] * tx + baseInv[1] * ty + baseInv[2] * tz),
          -(baseInv[3] * tx + baseInv[4] * ty + baseInv[5] * tz),
          -(baseInv[6] * tx + baseInv[7] * ty + baseInv[8] * tz),
        ];
        let invM = baseInv;
        let center: Vec3 = [tx, ty, tz];
        if (post !== null) {
          // inv(P·M) = inv(M)·P^T; the copy rotates the translated affine
          // output too, exactly as the point stepper's postRotations slot.
          invM = new Array<number>(9);
          for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
              invM[r * 3 + c] =
                baseInv[r * 3] * post[c * 3] +
                baseInv[r * 3 + 1] * post[c * 3 + 1] +
                baseInv[r * 3 + 2] * post[c * 3 + 2];
            }
          }
          center = [
            post[0] * tx + post[1] * ty + post[2] * tz,
            post[3] * tx + post[4] * ty + post[5] * tz,
            post[6] * tx + post[7] * ty + post[8] * tz,
          ];
        }
        emitters.push({
          shape: t.emitter!,
          invM,
          invT,
          sigmaMin: analysis.sigmas[i].min,
          center,
          radius: analysis.sigmas[i].max * shapeBoundingRadius(t.emitter!),
          baseIndex: i,
          // Recursive-map slots occupy [0, maps.length); unique emitters are
          // appended once and every symmetry copy points at that shade slot.
          shadeIndex: shadeIndices.get(i)!,
        });
        emitterCopyBaseIndices.push(i);
      }
    }
    if (emitters.length > 0) {
      condensation = {
        emitters,
        depthBand: resolveCondensationDepthBand(options.condensationDepthBand),
      };
    }
  }
  const chaos = buildSurfaceChaosDE(
    transforms,
    maps.map((map) => map.baseIndex),
    emitterBaseIndices,
    emitterCopyBaseIndices,
    symmetry,
  );

  // A sampled cloud cannot certify a bounding ball: an arbitrarily small
  // positive map weight can hide a geometrically remote branch.  When C0 is
  // present, close that hole analytically.  If B(c, R) contains C0 and an
  // admitted recursive map F is globally L-Lipschitz, then
  //
  //   F(B(c, R)) is inside B(F(c), L R),
  //
  // hence B(c, R) is invariant whenever
  // R >= |F(c) - c| / (1 - L).  Taking the maximum over C0 and every
  // (sector, map) copy proves B contains the least fixed set
  // A = C0 union_j F_j(A).  Fold maps use the same certified global
  // Lipschitz constants as eligibility; sector rotations are isometries.
  const condensationInvariantRadius =
    condensation || chaos
      ? (center: Vec3): number => {
          let radius = condensation
            ? condensationBoundingRadius3(condensation, center)
            : 0;
          for (let k = 0; k < order; k++) {
            const post =
              k === 0 ? null : symmetryRotation(symmetry.plane, step * k);
            for (let i = 0; i < transforms.length; i++) {
              if (
                !isActive(transforms[i]) ||
                transformHasEmitter(transforms[i])
              ) {
                continue;
              }
              const transform = transforms[i];
              const affine = composeAffine(transform);
              let fx =
                affine.m[0] * center[0] +
                affine.m[1] * center[1] +
                affine.m[2] * center[2] +
                affine.t[0];
              let fy =
                affine.m[3] * center[0] +
                affine.m[4] * center[1] +
                affine.m[5] * center[2] +
                affine.t[1];
              let fz =
                affine.m[6] * center[0] +
                affine.m[7] * center[1] +
                affine.m[8] * center[2] +
                affine.t[2];
              const fold = pureFoldVariation(transform);
              let lipschitz = analysis.sigmas[i].max;
              if (fold) {
                const q = foldVariationFn(
                  fold.type as "boxfold" | "spherefold" | "mandelbox",
                  resolveFoldRadii(fold),
                )(fx, fy, fz, mulberry32(0));
                fx = fold.weight * q[0];
                fy = fold.weight * q[1];
                fz = fold.weight * q[2];
                lipschitz *= foldLipschitz(fold);
              }
              if (post !== null) {
                const rx = post[0] * fx + post[1] * fy + post[2] * fz;
                const ry = post[3] * fx + post[4] * fy + post[5] * fz;
                const rz = post[6] * fx + post[7] * fy + post[8] * fz;
                fx = rx;
                fy = ry;
                fz = rz;
              }
              radius = Math.max(
                radius,
                Math.hypot(fx - center[0], fy - center[1], fz - center[2]) /
                  (1 - lipschitz),
              );
            }
          }
          // Preserve a small numerical margin around the analytic fixed point.
          return radius * RADIUS_PAD + 1e-3;
        }
      : null;

  // Bounding radius of the RAW attractor: seeded probe of the exact plotted
  // set (full transform list + symmetry, but NO final transform — the DE
  // descends the raw attractor and applies the lens to the query instead).
  const aProbe = runChaosGame(
    transforms,
    PROBE_POINTS,
    mulberry32(PROBE_SEED),
    null,
    symmetry,
  );
  const originRadius = Math.max(
    aProbe.bounds.maxR * RADIUS_PAD + 1e-3,
    condensationInvariantRadius ? condensationInvariantRadius([0, 0, 0]) : 0,
  );
  // Fit a near-smallest enclosing ball to the same probe cloud
  // (Ritter's deterministic two-pass construction + growth repasses) and
  // adopt it only when its PADDED radius strictly beats the origin
  // ball's — both candidates are enclosing balls of the sample, padded by
  // the same convention, so the choice is a pure tightness win and no
  // system can regress to a looser bound than it shipped with.
  const fit = fitEnclosingBall(aProbe.positions);
  // A kaleidoscope attractor is exactly n-fold symmetric about the FIXED
  // AXIS of its rotation plane — the one coordinate the plane leaves alone
  // (plane `yz` fixes x, `xz` fixes y, `xy` fixes z) — so its true smallest
  // enclosing ball is CENTERED ON that axis. But the raw fit of a finite
  // sample lands epsilon off it, and that epsilon breaks the descent's exact
  // on-axis sector ties (the sweep tests pin that tie behavior). Project the
  // center onto the axis (zero the two IN-PLANE coordinates) and re-measure
  // the enclosing radius with one exact pass over the cloud.
  if (order > 1) {
    if (symmetry.plane === "yz") {
      fit.center[1] = 0;
      fit.center[2] = 0;
    } else if (symmetry.plane === "xz") {
      fit.center[0] = 0;
      fit.center[2] = 0;
    } else {
      fit.center[0] = 0;
      fit.center[1] = 0;
    }
    let maxSq = 0;
    for (let i = 0; i < aProbe.positions.length; i += 3) {
      const dx = aProbe.positions[i] - fit.center[0];
      const dy = aProbe.positions[i + 1] - fit.center[1];
      const dz = aProbe.positions[i + 2] - fit.center[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d > maxSq) maxSq = d;
    }
    fit.radius = Math.sqrt(maxSq);
  }
  const fitRadius = Math.max(
    fit.radius * RADIUS_PAD + 1e-3,
    condensationInvariantRadius ? condensationInvariantRadius(fit.center) : 0,
  );
  const centered = fitRadius < originRadius;
  const aBoundingRadius = centered ? fitRadius : originRadius;
  const aBoundCenter: Vec3 = centered ? fit.center : [0, 0, 0];

  let probe = aProbe;
  let boundingRadius = aBoundingRadius;
  let boundCenter = aBoundCenter;
  let scheduleDE: SurfaceScheduleDE | undefined;
  if (
    preparedSchedule &&
    options.schedule &&
    scheduleMaps &&
    scheduleTransforms
  ) {
    const depth = preparedSchedule.depth;
    const bounds = new Array<SurfaceLevelBound>(depth + 1);
    bounds[depth] = {
      center: aBoundCenter,
      radius: aBoundingRadius,
      escapeRadius: ESCAPE_FACTOR * aBoundingRadius,
    };
    for (let d = depth - 1; d >= 0; d--) {
      const remaining = depth - d;
      const levelProbe = runChaosGame(
        transforms,
        PROBE_POINTS,
        mulberry32(PROBE_SEED),
        null,
        symmetry,
        undefined,
        { transforms: options.schedule.transforms, depth: remaining },
      );
      const previous = bounds[d + 1];
      const certifiedRadius = (center: Vec3): number => {
        let radius = 0;
        for (const t of scheduleTransforms) {
          const affine = composeAffine(t);
          const image = [
            affine.m[0] * previous.center[0] +
              affine.m[1] * previous.center[1] +
              affine.m[2] * previous.center[2] +
              affine.t[0],
            affine.m[3] * previous.center[0] +
              affine.m[4] * previous.center[1] +
              affine.m[5] * previous.center[2] +
              affine.t[1],
            affine.m[6] * previous.center[0] +
              affine.m[7] * previous.center[1] +
              affine.m[8] * previous.center[2] +
              affine.t[2],
          ] as Vec3;
          radius = Math.max(
            radius,
            Math.hypot(
              image[0] - center[0],
              image[1] - center[1],
              image[2] - center[2],
            ) +
              transformSigmas(t).max * previous.radius,
          );
        }
        return radius;
      };
      const levelOriginRadius = Math.max(
        levelProbe.bounds.maxR * RADIUS_PAD + 1e-3,
        certifiedRadius([0, 0, 0]),
      );
      const levelFit = fitEnclosingBall(levelProbe.positions);
      const levelFitRadius = Math.max(
        levelFit.radius * RADIUS_PAD + 1e-3,
        certifiedRadius(levelFit.center),
      );
      const useFit = levelFitRadius < levelOriginRadius;
      const radius = useFit ? levelFitRadius : levelOriginRadius;
      bounds[d] = {
        center: useFit ? levelFit.center : [0, 0, 0],
        radius,
        escapeRadius: ESCAPE_FACTOR * radius,
      };
      if (d === 0) probe = levelProbe;
    }
    scheduleDE = { maps: scheduleMaps, depth, bounds };
    boundingRadius = bounds[0].radius;
    boundCenter = bounds[0].center;
  }

  // Stage-2 bound data, centered on that fitted ball: the skips must
  // lower-bound `|invM·pre + invT − boundCenter|`, i.e. the sigma and
  // directional forms with `t' = invT − boundCenter`. With the origin
  // center this computes the plain `invT` forms exactly.
  for (const m of maps) {
    const tpx = m.invT[0] - aBoundCenter[0];
    const tpy = m.invT[1] - aBoundCenter[1];
    const tpz = m.invT[2] - aBoundCenter[2];
    const tn = Math.hypot(tpx, tpy, tpz);
    m.invTNorm = tn;
    m.bnbDir =
      tn > 0
        ? [
            (m.invM[0] * tpx + m.invM[3] * tpy + m.invM[6] * tpz) / tn,
            (m.invM[1] * tpx + m.invM[4] * tpy + m.invM[7] * tpz) / tn,
            (m.invM[2] * tpx + m.invM[5] * tpy + m.invM[8] * tpz) / tn,
          ]
        : [0, 0, 0];
  }

  // Depth cap from the SLOWEST contraction: the largest per-level shrink
  // factor bounds how many levels matter before features drop below
  // resolution (ceiling: see MAX_DESCENT_DEPTH's sizing note). For
  // fold maps the slowest certified branch is |w|·L_V·sigma_min — the
  // spherefold's ×4 branches shrink features slowest — and eligibility
  // keeps even that below CONTRACTION_LIMIT.
  const slowest = maps.reduce((acc, b) => {
    const factor =
      b.foldKind === SURFACE_FOLD_NONE
        ? b.sigmaMin
        : b.foldKind === SURFACE_FOLD_BOXFOLD
          ? b.foldSigma
          : b.foldSigma * b.foldRadii.innerSigma;
    return Math.max(acc, factor);
  }, 0);
  const aMaxDepth = Math.max(
    8,
    Math.ceil(Math.log(DEPTH_RESOLUTION) / Math.log(slowest)),
  );
  const maxDepth = Math.min(
    MAX_DESCENT_DEPTH,
    aMaxDepth + (scheduleDE?.depth ?? 0),
  );

  // Camera-independent native-trap calibration from exactly 256 evenly
  // strided points of the EXISTING seeded 8192-point RAW probe. 8192 / 256
  // is exactly 32, so the pilot reads point indices 0, 32, ..., 8160 without
  // running another chaos game or consulting the final lens below.
  const nativeCarrierContext: SurfaceNativeCarrierContext = {
    maps,
    ...(chaos ? { chaos } : {}),
    ...(scheduleDE ? { schedule: scheduleDE } : {}),
    symmetry: {
      order,
      plane: symmetry.plane,
      stepCos: Math.cos(step),
      stepSin: Math.sin(step),
    },
    boundingRadius,
    boundCenter,
    escapeRadius: ESCAPE_FACTOR * boundingRadius,
    maxDepth,
  };
  const nativeCarrierSamples = new Array<SurfaceNativeCarrierSample>(
    SURFACE_NATIVE_CALIBRATION_SAMPLE_COUNT,
  );
  const nativeProbeStride =
    PROBE_POINTS / SURFACE_NATIVE_CALIBRATION_SAMPLE_COUNT;
  for (
    let sample = 0;
    sample < SURFACE_NATIVE_CALIBRATION_SAMPLE_COUNT;
    sample++
  ) {
    const offset = sample * nativeProbeStride * 3;
    nativeCarrierSamples[sample] = evaluateSurfaceNativeCarriersRaw(
      nativeCarrierContext,
      probe.positions[offset],
      probe.positions[offset + 1],
      probe.positions[offset + 2],
    );
  }
  const patternCalibration =
    calibrateSurfaceNativeCarriers(nativeCarrierSamples);

  let final: SurfaceDE["final"] = null;
  let foldFinal: SurfaceDE["foldFinal"] = null;
  let visibleBoundingRadius =
    Math.hypot(boundCenter[0], boundCenter[1], boundCenter[2]) + boundingRadius;
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
    const fold = pureFoldVariation(finalTransform);
    // The affine image of ball(boundCenter, R) is inside the ball at
    // `M·boundCenter + t` of radius `sigma_max·R`, so from the origin
    // `|M x + t| <= |M·boundCenter + t| + sigma_max·R` — with the origin
    // center this reduces to the historical `sigma_max·R + |t|` exactly.
    const [bx, by, bz] = boundCenter;
    const affineR =
      s.max * boundingRadius +
      Math.hypot(
        affine.m[0] * bx + affine.m[1] * by + affine.m[2] * bz + tx,
        affine.m[3] * bx + affine.m[4] * by + affine.m[5] * bz + ty,
        affine.m[6] * bx + affine.m[7] * by + affine.m[8] * bz + tz,
      );
    if (fold) {
      const kind: SurfaceFoldKind =
        fold.type === "boxfold"
          ? SURFACE_FOLD_BOXFOLD
          : fold.type === "spherefold"
            ? SURFACE_FOLD_SPHEREFOLD
            : SURFACE_FOLD_MANDELBOX;
      const radii = surfaceFoldRadii(fold);
      foldFinal = {
        invM,
        invT,
        sigmaMin: s.min,
        foldKind: kind,
        invW: 1 / fold.weight,
        absW: Math.abs(fold.weight),
        foldRadii: radii,
      };
      // Bound the visible set w·V(M·A + t). Per axis the boxfold obeys
      // |fold(t)| <= max(|t|, wall), so |boxfold(y)|² <= Σ max(y_a², wall²)
      // <= |y|² + 3·wall²; the spherefold's clamp caps every branch's output
      // at max(|y|, fR²/mR) (identity keeps |y|, the shell inverts into
      // (fR, fR²/mR], the inner region tops out at (fR²/mR²)·mR = fR²/mR);
      // the mandelbox chains the two. At the classic lengths those are the
      // `+ 3` and the `2` that shipped before the lengths were authorable.
      const boxR = Math.sqrt(affineR * affineR + 3 * radii.wall * radii.wall);
      visibleBoundingRadius =
        foldFinal.absW *
        (kind === SURFACE_FOLD_BOXFOLD
          ? boxR
          : kind === SURFACE_FOLD_SPHEREFOLD
            ? Math.max(affineR, radii.outputR)
            : Math.max(boxR, radii.outputR));
    } else {
      final = { invM, invT, sigmaMin: s.min };
      visibleBoundingRadius = affineR;
    }
  }

  return {
    maps,
    ...(chaos ? { chaos } : {}),
    ...(scheduleDE ? { schedule: scheduleDE } : {}),
    ...(condensation ? { condensation } : {}),
    symmetry: {
      order,
      plane: symmetry.plane,
      // Exact at order 1 (cos 2pi = 1, sin 2pi = 0 only up to rounding), so
      // the descent's order-1 short circuit is what actually guarantees
      // bit-identical non-kaleidoscope behavior, not these two numbers.
      stepCos: Math.cos(step),
      stepSin: Math.sin(step),
    },
    boundingRadius,
    boundCenter,
    visibleBoundingRadius,
    patternCalibration,
    escapeRadius: ESCAPE_FACTOR * boundingRadius,
    maxDepth,
    slowestSigma: slowest,
    beamWidth: 4,
    stepScale: analysis.stepScale,
    final,
    foldFinal,
  };
}

/**
 * Reference DE the GLSL marcher mirrors: beam inverse-map descent with
 * sibling-certificate tracking (see the module doc for the validity
 * argument). Width 1 is the classic greedy descent, value-equivalent to the
 * estimator that predated the paired chains; width 2 keeps a second chain
 * alive so a second simultaneous in-sphere branch is refined instead of
 * dropped; widths 3/4 add the validity slots — rank-3/4 chains that live only
 * while in-sphere, closing the 3-and-4-simultaneous drops.
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
 * `cutoff` is {@link estimateDistanceRefined}'s early-out contract,
 * verbatim: `<= 0` (the default) is the full descent
 * bit-for-bit; `> 0` lets the descent stop once its return is pinned under
 * the cutoff — a returned value `>= cutoff` equals the full result exactly,
 * a value `< cutoff` guarantees the full result is `< cutoff` too. The
 * contract's monotone/finalized argument is refine-agnostic: both paths
 * share the descent bodies' exits, and the plain path folds only settled
 * plain certificates, so the running min never tests a term the full
 * computation lacks (the parameter is exposed here so the empty-space
 * grid can price fold floors with the estimator the fold GLSL actually
 * marches).
 */
export function estimateDistance(
  de: SurfaceDE,
  p: Vec3,
  cutoff = 0,
  footprint = 0,
): number {
  if (de.foldFinal) return descendLens(de, p, false, cutoff, footprint);
  return deHasFolds(de)
    ? descendFold(de, p, false, cutoff, footprint)
    : descend(de, p, false, cutoff, footprint);
}

/** Whether any map expands into fold branches — such systems descend via
 * {@link descendFold}'s wide frontier instead of the affine ladder body
 * (which `beamWidth` parameterizes; the fold frontier has one measured
 * width, {@link SURFACE_FOLD_BEAM_WIDTH}). Exported for
 * `surface-grid.ts`'s estimator choice: fold systems price
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
  let weight = 1;
  if (de.maps.length > 0 && deHasFolds(de)) {
    let branches = 0;
    for (const m of de.maps) {
      branches += foldBranchCount(m.foldKind);
    }
    weight = (branches / de.maps.length) * (SURFACE_FOLD_BEAM_WIDTH / 4);
  }
  if (de.schedule && de.maps.length > 0 && de.maxDepth > 0) {
    const prefixDepth = Math.min(de.schedule.depth, de.maxDepth);
    const widthFactor = deHasFolds(de) ? SURFACE_FOLD_BEAM_WIDTH / 4 : 1;
    const prefixWeight =
      (de.schedule.maps.length / de.maps.length) * widthFactor;
    weight =
      (prefixDepth * prefixWeight + (de.maxDepth - prefixDepth) * weight) /
      de.maxDepth;
  }
  if (de.foldFinal) {
    // A fold LENS multiplies the whole trace by its root-descent count.
    // Statically that is the branch count, but the sphere/floor prunes
    // (descendLens) kill the branches whose preimages fall outside the
    // bounding sphere — most of them, for typical attractors well inside
    // the fold's cell lattice — so weight by a measured-typical /8. The
    // preview governor's ladder corrects the residual either way.
    weight *= Math.max(1, foldBranchCount(de.foldFinal.foldKind) / 8);
  }
  return weight;
}

/** Inverse-branch count of a fold family — 1 for a plain affine map. */
function foldBranchCount(kind: SurfaceFoldKind): number {
  return kind === SURFACE_FOLD_NONE
    ? 1
    : kind === SURFACE_FOLD_BOXFOLD
      ? 27
      : kind === SURFACE_FOLD_SPHEREFOLD
        ? 3
        : 81;
}

/**
 * Certificate-refinement variant of {@link estimateDistance} — the 4D
 * spike's ghost-eliminator (`estimateDistance4Refined`) ported back down
 * to 3D: identical beam descent, terminal KIFS bound, depth-0 sphere
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
 * WHY 3D NEEDS IT TOO. The beam harness record showed the shipped width-2 BASE
 * estimator still false-hitting in genuine voids on plain presets
 * (voidFalseHit default 3/271, sierpinski 6/307, pyramid 6/251,
 * jerusalem 2/318) — rendered as smooth "balloon" membranes spanning
 * attractor voids, the same barely-escaped-sibling mechanism the 4D spike
 * measured every 4D ghost back to. The beam refines only the per-level
 * runner-up; every OTHER barely-escaped sibling still froze a near-zero
 * plain certificate. Refinement closes those: measured on the same
 * harness, 3D voidFalseHits drop to 0 on every preset (the validity
 * slots' kaleidoscope-tie/slow-map residuals excepted) with validity
 * unchanged.
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
 * EARLY-OUT CUTOFF. A sphere-tracing march does not need the
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
 * SPHERE FLOOR. Once `best` falls to or below the depth-0 sphere
 * bound, the eventual return is already pinned: `descentValue` clamps
 * through `max(best, sphereBound)`, and `best` is a monotone min, so no
 * later fold can lift the clamp back off `sphereBound`. The descent
 * therefore exits the instant `best <= sphereBound`, unconditionally — no
 * cutoff involved. Unlike the cutoff exit above, this one is value-exact
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
  footprint = 0,
): number {
  if (de.foldFinal) return descendLens(de, p, true, cutoff, footprint);
  return deHasFolds(de)
    ? descendFold(de, p, true, cutoff, footprint)
    : descend(de, p, true, cutoff, footprint);
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

function scheduledCondensationTerm3(
  de: SurfaceDE,
  depth: number,
  scale: number,
  x: number,
  y: number,
  z: number,
  currentState = SURFACE_CHAOS_WILDCARD,
): number {
  if (!de.condensation) return Infinity;
  const aDepth = depth - (de.schedule?.depth ?? 0);
  if (aDepth < 0) return Infinity;
  if (!de.chaos || currentState === SURFACE_CHAOS_WILDCARD) {
    return condensationTerm3(de.condensation, aDepth, scale, x, y, z);
  }
  const band = de.condensation.depthBand;
  if (aDepth < band.minDepth || aDepth > band.maxDepth) return Infinity;
  let best = Infinity;
  for (let i = 0; i < de.condensation.emitters.length; i++) {
    const state = de.chaos.emitterStateIndices[i];
    if (!surfaceChaosAllows(de.chaos, currentState, state)) continue;
    const emitter = de.condensation.emitters[i];
    const m = emitter.invM;
    const t = emitter.invT;
    const qx = m[0] * x + m[1] * y + m[2] * z + t[0];
    const qy = m[3] * x + m[4] * y + m[5] * z + t[1];
    const qz = m[6] * x + m[7] * y + m[8] * z + t[2];
    const value = emitter.sigmaMin * shapeSdf(emitter.shape, qx, qy, qz);
    if (value < best) best = value;
  }
  return scale * SHAPE_MARCH_SAFETY * best;
}

function scheduledCondensationHasFutureDepth(
  de: SurfaceDE,
  nextDepth: number,
): boolean {
  if (!de.condensation) return false;
  const aDepth = nextDepth - (de.schedule?.depth ?? 0);
  return (
    aDepth < 0 || condensationHasFutureDepth(de.condensation.depthBand, aDepth)
  );
}

/**
 * One extra Hutchinson level on a frozen escaped candidate's own inverse
 * image, over every (sector, base map, fold branch) triple (see
 * {@link estimateDistanceRefined}'s doc): the certificate becomes
 * `childScale * max(r - R, inner)` — never below the plain
 * `childScale * (r - R)`. Only called on the refined paths, and only for
 * folds whose plain certificate beats the running min. Shared by the
 * affine descent and the fold frontier ({@link descendFold}); fold-free
 * systems run the pre-fold-sweep arithmetic bit for bit (every branch loop
 * below collapses to the single affine child).
 */
function refinedCertValue(
  de: SurfaceDE,
  ix: number,
  iy: number,
  iz: number,
  r: number,
  childScale: number,
  depth: number,
  currentState = SURFACE_CHAOS_WILDCARD,
): number {
  const { order, plane, stepCos, stepSin } = de.symmetry;
  const inB = de.schedule !== undefined && depth < de.schedule.depth;
  const levelMaps = inB ? de.schedule!.maps : de.maps;
  const sectorOrder = inB ? 1 : order;
  const childBound = de.schedule
    ? de.schedule.bounds[Math.min(depth + 1, de.schedule.depth)]
    : null;
  const currentBound = de.schedule
    ? de.schedule.bounds[Math.min(depth, de.schedule.depth)]
    : null;
  const currentR = currentBound ? currentBound.radius : de.boundingRadius;
  const R = childBound ? childBound.radius : de.boundingRadius;
  const bcX = childBound ? childBound.center[0] : de.boundCenter[0];
  const bcY = childBound ? childBound.center[1] : de.boundCenter[1];
  const bcZ = childBound ? childBound.center[2] : de.boundCenter[2];
  let inner = scheduledCondensationTerm3(
    de,
    depth,
    1,
    ix,
    iy,
    iz,
    currentState,
  );
  let sx = ix;
  let sy = iy;
  let sz = iz;
  for (let k = 0; k < sectorOrder; k++) {
    if (k > 0) {
      stepSector(plane, stepCos, stepSin, sx, sy, sz, CERT_SWEEP);
      sx = CERT_SWEEP[0];
      sy = CERT_SWEEP[1];
      sz = CERT_SWEEP[2];
    }
    for (let j = 0; j < levelMaps.length; j++) {
      const mapJ = levelMaps[j];
      if (
        !inB &&
        !surfaceChaosAllows(de.chaos, currentState, mapJ.stateIndex!)
      ) {
        continue;
      }
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
      // The map's authored fold lengths, hoisted out of the branch
      // loop. At the classic set every expression below reduces to the
      // literal that shipped — `wall` 1, `innerScale` 0.25, `innerSigma` 4,
      // `fixedR`/`invFixedR`/`fixedR2` 1, `outputR` 2 — so an unparameterized
      // document descends bit-identically.
      const fr = mapJ.foldRadii;
      const wall = fr.wall;
      const wall2 = 2 * wall;
      if (kindJ !== SURFACE_FOLD_NONE) {
        ux = sx * mapJ.foldInvW;
        uy = sy * mapJ.foldInvW;
        uz = sz * mapJ.foldInvW;
        if (kindJ === SURFACE_FOLD_BOXFOLD) {
          px0 = ux;
          px1 = wall2 - ux;
          px2 = -wall2 - ux;
          py0 = uy;
          py1 = wall2 - uy;
          py2 = -wall2 - uy;
          pz0 = uz;
          pz1 = wall2 - uz;
          pz2 = -wall2 - uz;
          dxUp = ux > wall ? ux - wall : 0;
          dxDn = ux < -wall ? -wall - ux : 0;
          dyUp = uy > wall ? uy - wall : 0;
          dyDn = uy < -wall ? -wall - uy : 0;
          dzUp = uz > wall ? uz - wall : 0;
          dzDn = uz < -wall ? -wall - uz : 0;
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
              sfRd = ru < fr.fixedR ? fr.fixedR - ru : 0;
            } else if (s === 1) {
              vx = fr.innerScale * ux;
              vy = fr.innerScale * uy;
              vz = fr.innerScale * uz;
              sfSigma = fr.innerSigma;
              sfRd = ru > fr.outputR ? ru - fr.outputR : 0;
            } else {
              if (ru < fr.midMinR) {
                // Same shell stand-in the frontier folds, in the frozen
                // child's own frame.
                const shellTerm = absWJ * (fr.fixedR - ru);
                if (shellTerm < inner) inner = shellTerm;
                if (kindJ === SURFACE_FOLD_MANDELBOX) b += 26;
                continue;
              }
              const invR2 = fr.fixedR2 / (ru * ru);
              vx = ux * invR2;
              vy = uy * invR2;
              vz = uz * invR2;
              sfSigma = ru * fr.invFixedR;
              sfRd =
                ru < fr.fixedR
                  ? fr.fixedR - ru
                  : ru > fr.outputR
                    ? ru - fr.outputR
                    : 0;
            }
            if (kindJ === SURFACE_FOLD_MANDELBOX) {
              px0 = vx;
              px1 = wall2 - vx;
              px2 = -wall2 - vx;
              py0 = vy;
              py1 = wall2 - vy;
              py2 = -wall2 - vy;
              pz0 = vz;
              pz1 = wall2 - vz;
              pz2 = -wall2 - vz;
              dxUp = vx > wall ? vx - wall : 0;
              dxDn = vx < -wall ? -wall - vx : 0;
              dyUp = vy > wall ? vy - wall : 0;
              dyDn = vy < -wall ? -wall - vy : 0;
              dzUp = vz > wall ? vz - wall : 0;
              dzDn = vz < -wall ? -wall - vz : 0;
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
        const jcx = jx - bcX;
        const jcy = jy - bcY;
        const jcz = jz - bcZ;
        const rj = Math.sqrt(jcx * jcx + jcy * jcy + jcz * jcz);
        let innerTerm = branchSigma * (rj - R);
        if (branchRd > 0) {
          const regionTerm = absWJ * branchRd;
          if (regionTerm > innerTerm) innerTerm = regionTerm;
        }
        if (innerTerm < inner) inner = innerTerm;
      }
    }
  }
  return childScale * Math.max(r - currentR, inner);
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
 * untouched by the fold-branch sweep.
 *
 * `cutoff` is {@link estimateDistanceRefined}'s early-out threshold (see its
 * doc for the contract and why the exits sit where they sit); `0` — what
 * {@link estimateDistance} always passes — disables it entirely.
 */
function descend(
  de: SurfaceDE,
  p: Vec3,
  refine: boolean,
  cutoff = 0,
  footprint = 0,
): number {
  const maxDepth = footprintDepthCap(de, footprint);
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

  // Kaleidoscope sectors swept around the base maps — `order` 1
  // leaves every `k > 0` branch below dead, so a system without symmetry
  // runs the pre-sweep arithmetic unchanged.
  const { order, plane, stepCos, stepSin } = de.symmetry;
  const sweep = [0, 0, 0];

  const R = de.boundingRadius;
  const [bcX, bcY, bcZ] = de.boundCenter;
  const condensation = de.condensation;
  const startR = Math.hypot(x - bcX, y - bcY, z - bcZ);
  const sphereBound = startR - R;
  const wide = de.beamWidth > 1;
  let best = Infinity;

  // Early-out threshold: the value below which the descent may
  // stop and hand the caller what it has. `-Infinity` disables the test —
  // for `cutoff <= 0` (callers that need the distance itself), and for a
  // depth-0 sphere floor that already holds the answer at or above the
  // cutoff no matter how far `best` falls, since the floor is what the
  // return would clamp to. Both exits below test `best * finalScale`
  // against it AFTER a fold, never a raw pre-refinement key. (That sphere
  // floor case now has its own unconditional exit — the sphere-floor pin
  // below — that fires the moment `best` reaches it, cutoff or not.)
  const bailBelow =
    cutoff > 0 && sphereBound * finalScale < cutoff ? cutoff : -Infinity;

  // Chain slot A starts at the (lensed) query; slot B idles until beam
  // selection fills it (width-2 systems only). Each chain carries the
  // contraction accumulated INCLUDING its own map and the radius its point
  // was selected at — `scale · (r - R)` is its terminal bound. V1/V2 are
  // the validity slots (widths 3/4): they hold the level's rank-3/4
  // candidates ONLY while those are in-sphere — branches that carry no
  // positive certificate, so dropping them was the measured invalidity —
  // and fold the ordinary refined certificate the moment they escape.
  const extra = de.beamWidth - 2;
  let aX = x;
  let aY = y;
  let aZ = z;
  let aScale = 1;
  let aR = startR;
  let aState = SURFACE_CHAOS_WILDCARD;
  let aLive = true;
  let bX = 0;
  let bY = 0;
  let bZ = 0;
  let bScale = 1;
  let bR = 0;
  let bState = SURFACE_CHAOS_WILDCARD;
  let bLive = false;
  // Validity chains carry no R field: unlike A/B they never fold a
  // terminal (see the note past the loop), and expansion re-derives every
  // child radius, so the selection radius is dead weight once occupancy
  // is decided.
  let v1X = 0;
  let v1Y = 0;
  let v1Z = 0;
  let v1Scale = 1;
  let v1State = SURFACE_CHAOS_WILDCARD;
  let v1Live = false;
  let v2X = 0;
  let v2Y = 0;
  let v2Z = 0;
  let v2Scale = 1;
  let v2State = SURFACE_CHAOS_WILDCARD;
  let v2Live = false;

  for (let depth = 0; depth < maxDepth; depth++) {
    if (!aLive && !bLive && !v1Live && !v2Live) break;
    const inB = de.schedule !== undefined && depth < de.schedule.depth;
    const levelMaps = inB ? de.schedule!.maps : de.maps;
    const sectorOrder = inB ? 1 : order;
    const childBound = de.schedule
      ? de.schedule.bounds[Math.min(depth + 1, de.schedule.depth)]
      : null;
    const R = childBound ? childBound.radius : de.boundingRadius;
    const bcX = childBound ? childBound.center[0] : de.boundCenter[0];
    const bcY = childBound ? childBound.center[1] : de.boundCenter[1];
    const bcZ = childBound ? childBound.center[2] : de.boundCenter[2];
    const escapeRadius = childBound ? childBound.escapeRadius : de.escapeRadius;
    if (condensation) {
      if (aLive) {
        best = Math.min(
          best,
          scheduledCondensationTerm3(de, depth, aScale, aX, aY, aZ, aState),
        );
      }
      if (bLive) {
        best = Math.min(
          best,
          scheduledCondensationTerm3(de, depth, bScale, bX, bY, bZ, bState),
        );
      }
      if (v1Live) {
        best = Math.min(
          best,
          scheduledCondensationTerm3(
            de,
            depth,
            v1Scale,
            v1X,
            v1Y,
            v1Z,
            v1State,
          ),
        );
      }
      if (v2Live) {
        best = Math.min(
          best,
          scheduledCondensationTerm3(
            de,
            depth,
            v2Scale,
            v2X,
            v2Y,
            v2Z,
            v2State,
          ),
        );
      }
      if (best <= sphereBound || best * finalScale < bailBelow) {
        return descentValue(best, sphereBound, finalScale);
      }
    }
    const futureCondensation = scheduledCondensationHasFutureDepth(
      de,
      depth + 1,
    );
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
    let c1State = SURFACE_CHAOS_WILDCARD;
    let c2Key = Infinity;
    let c2X = 0;
    let c2Y = 0;
    let c2Z = 0;
    let c2Scale = 1;
    let c2R = 0;
    let c2Cert = 0;
    let c2State = SURFACE_CHAOS_WILDCARD;
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
    let c3State = SURFACE_CHAOS_WILDCARD;
    let c4Key = Infinity;
    let c4X = 0;
    let c4Y = 0;
    let c4Z = 0;
    let c4Scale = 1;
    let c4R = 0;
    let c4Cert = 0;
    let c4State = SURFACE_CHAOS_WILDCARD;
    for (let c = 0; c < 4; c++) {
      let pX: number;
      let pY: number;
      let pZ: number;
      let pScale: number;
      let pState: number;
      if (c === 0) {
        if (!aLive) continue;
        pX = aX;
        pY = aY;
        pZ = aZ;
        pScale = aScale;
        pState = aState;
      } else if (c === 1) {
        if (!bLive) continue;
        pX = bX;
        pY = bY;
        pZ = bZ;
        pScale = bScale;
        pState = bState;
      } else if (c === 2) {
        if (!v1Live) continue;
        pX = v1X;
        pY = v1Y;
        pZ = v1Z;
        pScale = v1Scale;
        pState = v1State;
      } else {
        if (!v2Live) continue;
        pX = v2X;
        pY = v2Y;
        pZ = v2Z;
        pScale = v2Scale;
        pState = v2State;
      }
      // Sector sweep: the chain point turns one step per
      // kaleidoscope sector and every BASE map is applied to it there, so
      // the candidates — and their SECTOR-MAJOR enumeration order, which is
      // exactly the order the expanded map list was built in — are the ones
      // the expansion produced. The ladders below therefore break ties the
      // same way, and the beam, the validity slots and the cutoff exits see
      // an unchanged stream.
      let sX = pX;
      let sY = pY;
      let sZ = pZ;
      for (let k = 0; k < sectorOrder; k++) {
        if (k > 0) {
          stepSector(plane, stepCos, stepSin, sX, sY, sZ, sweep);
          sX = sweep[0];
          sY = sweep[1];
          sZ = sweep[2];
        }
        for (let j = 0; j < levelMaps.length; j++) {
          const map = levelMaps[j];
          if (!inB && !surfaceChaosAllows(de.chaos, pState, map.stateIndex!)) {
            continue;
          }
          const childState = inB
            ? SURFACE_CHAOS_WILDCARD
            : (map.stateIndex ?? SURFACE_CHAOS_WILDCARD);
          const im = map.invM;
          const it = map.invT;
          const ix = im[0] * sX + im[1] * sY + im[2] * sZ + it[0];
          const iy = im[3] * sX + im[4] * sY + im[5] * sZ + it[1];
          const iz = im[6] * sX + im[7] * sY + im[8] * sZ + it[2];
          const icx = ix - bcX;
          const icy = iy - bcY;
          const icz = iz - bcZ;
          const r = Math.sqrt(icx * icx + icy * icy + icz * icz);
          const key = pScale * (r - R);
          const childScale = pScale * map.sigmaMin;
          const cert = childScale * (r - R);
          if (condensation) {
            const shapeTerm = scheduledCondensationTerm3(
              de,
              depth + 1,
              childScale,
              ix,
              iy,
              iz,
              childState,
            );
            if (shapeTerm < best) best = shapeTerm;
          }
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
          let eState = childState;
          if (key < c1Key) {
            eKey = c2Key;
            eX = c2X;
            eY = c2Y;
            eZ = c2Z;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            eState = c2State;
            c2Key = c1Key;
            c2X = c1X;
            c2Y = c1Y;
            c2Z = c1Z;
            c2Scale = c1Scale;
            c2R = c1R;
            c2Cert = c1Cert;
            c2State = c1State;
            c1Key = key;
            c1X = ix;
            c1Y = iy;
            c1Z = iz;
            c1Scale = childScale;
            c1R = r;
            c1Cert = cert;
            c1State = childState;
          } else if (key < c2Key) {
            eKey = c2Key;
            eX = c2X;
            eY = c2Y;
            eZ = c2Z;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            eState = c2State;
            c2Key = key;
            c2X = ix;
            c2Y = iy;
            c2Z = iz;
            c2Scale = childScale;
            c2R = r;
            c2Cert = cert;
            c2State = childState;
          }
          if (extra > 0) {
            // Spill into the rank-3/4 ladder; what THAT evicts (or the
            // spilled tuple itself, when it beats neither slot) falls
            // through to the fold below.
            if (eKey < c3Key) {
              // Keep the key paired with the evicted tuple. Condensation's
              // future-subtree fold distinguishes an actual in-ball eviction
              // from the empty Infinity/r=0 sentinel; dropping only this lane
              // turns that sentinel into a false whole-ball hit.
              const tKey = extra > 1 ? c4Key : c3Key;
              const tX = extra > 1 ? c4X : c3X;
              const tY = extra > 1 ? c4Y : c3Y;
              const tZ = extra > 1 ? c4Z : c3Z;
              const tScale = extra > 1 ? c4Scale : c3Scale;
              const tR = extra > 1 ? c4R : c3R;
              const tCert = extra > 1 ? c4Cert : c3Cert;
              const tState = extra > 1 ? c4State : c3State;
              if (extra > 1) {
                c4Key = c3Key;
                c4X = c3X;
                c4Y = c3Y;
                c4Z = c3Z;
                c4Scale = c3Scale;
                c4R = c3R;
                c4Cert = c3Cert;
                c4State = c3State;
              }
              c3Key = eKey;
              c3X = eX;
              c3Y = eY;
              c3Z = eZ;
              c3Scale = eScale;
              c3R = eR;
              c3Cert = eCert;
              c3State = eState;
              eKey = tKey;
              eX = tX;
              eY = tY;
              eZ = tZ;
              eScale = tScale;
              eR = tR;
              eCert = tCert;
              eState = tState;
            } else if (extra > 1 && eKey < c4Key) {
              const tKey = c4Key;
              const tX = c4X;
              const tY = c4Y;
              const tZ = c4Z;
              const tScale = c4Scale;
              const tR = c4R;
              const tCert = c4Cert;
              const tState = c4State;
              c4Key = eKey;
              c4X = eX;
              c4Y = eY;
              c4Z = eZ;
              c4Scale = eScale;
              c4R = eR;
              c4Cert = eCert;
              c4State = eState;
              eKey = tKey;
              eX = tX;
              eY = tY;
              eZ = tZ;
              eScale = tScale;
              eR = tR;
              eCert = tCert;
              eState = tState;
            }
          }
          // The tuple leaving the beam frontier: escaped candidates fold
          // their certificate (REFINED on the refined path, where the guard
          // already knows the plain certificate would have advanced the
          // min); an in-sphere tuple carries no positive certificate — on
          // widths 3/4 it can only get here past FOUR smaller keys, the
          // (shrunken) residual drop the slots exist for.
          if (eR > R && eCert < best) {
            const folded = refine
              ? refinedCertValue(de, eX, eY, eZ, eR, eScale, depth + 1, eState)
              : eCert;
            if (folded < best) {
              best = folded;
              // Cutoff exit plus the sphere-floor pin.
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
          } else if (eKey < Infinity && futureCondensation && eR <= R) {
            // Immediate C0 was evaluated above.  If this evicted in-ball
            // subtree can still reach a later enabled C0, its invariant-ball
            // terminal is the conservative certificate for all descendants.
            const subtree = eScale * (eR - R);
            if (subtree < best) best = subtree;
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
      if (c1R > escapeRadius) {
        if (c1Cert < best) best = c1Cert;
      } else {
        aX = c1X;
        aY = c1Y;
        aZ = c1Z;
        aScale = c1Scale;
        aR = c1R;
        aState = c1State;
        aLive = true;
      }
    }
    if (c2Key < Infinity) {
      if (!wide) {
        // Width-1 runner-up: the classic frozen sibling — the exact
        // certificate the 4D DE spike measured every ghost back to, so
        // the refined path refines it; the escape-radius fold below stays
        // PLAIN on both paths (matching estimateDistance4Refined: a
        // candidate past 2R folds a bound already >= childScale * R —
        // comfortably positive, so it can never read as a ghost and
        // refining it buys nothing a marcher could see).
        if (c2R > R && c2Cert < best) {
          const folded = refine
            ? refinedCertValue(
                de,
                c2X,
                c2Y,
                c2Z,
                c2R,
                c2Scale,
                depth + 1,
                c2State,
              )
            : c2Cert;
          if (folded < best) best = folded;
        } else if (futureCondensation && c2R <= R) {
          const subtree = c2Scale * (c2R - R);
          if (subtree < best) best = subtree;
        }
      } else if (c2R > escapeRadius) {
        if (c2Cert < best) best = c2Cert;
      } else {
        bX = c2X;
        bY = c2Y;
        bZ = c2Z;
        bScale = c2Scale;
        bR = c2R;
        bState = c2State;
        bLive = true;
      }
    }
    if (extra > 0 && c3Key < Infinity) {
      if (c3R > R) {
        if (c3Cert < best) {
          const folded = refine
            ? refinedCertValue(
                de,
                c3X,
                c3Y,
                c3Z,
                c3R,
                c3Scale,
                depth + 1,
                c3State,
              )
            : c3Cert;
          if (folded < best) best = folded;
        }
      } else {
        v1X = c3X;
        v1Y = c3Y;
        v1Z = c3Z;
        v1Scale = c3Scale;
        v1State = c3State;
        v1Live = true;
      }
    }
    if (extra > 1 && c4Key < Infinity) {
      if (c4R > R) {
        if (c4Cert < best) {
          const folded = refine
            ? refinedCertValue(
                de,
                c4X,
                c4Y,
                c4Z,
                c4R,
                c4Scale,
                depth + 1,
                c4State,
              )
            : c4Cert;
          if (folded < best) best = folded;
        }
      } else {
        v2X = c4X;
        v2Y = c4Y;
        v2Z = c4Z;
        v2Scale = c4Scale;
        v2State = c4State;
        v2Live = true;
      }
    }
    // Cutoff exit plus the sphere-floor pin, covering
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
  if (condensation) {
    if (aLive) {
      best = Math.min(
        best,
        scheduledCondensationTerm3(de, maxDepth, aScale, aX, aY, aZ, aState),
      );
    }
    if (bLive) {
      best = Math.min(
        best,
        scheduledCondensationTerm3(de, maxDepth, bScale, bX, bY, bZ, bState),
      );
    }
    if (v1Live) {
      best = Math.min(
        best,
        scheduledCondensationTerm3(
          de,
          maxDepth,
          v1Scale,
          v1X,
          v1Y,
          v1Z,
          v1State,
        ),
      );
    }
    if (v2Live) {
      best = Math.min(
        best,
        scheduledCondensationTerm3(
          de,
          maxDepth,
          v2Scale,
          v2X,
          v2Y,
          v2Z,
          v2State,
        ),
      );
    }
  }
  const terminalR = de.schedule
    ? de.schedule.bounds[Math.min(maxDepth, de.schedule.depth)].radius
    : R;
  if (aLive) {
    const terminal = aScale * (aR - terminalR);
    if (terminal < best) best = terminal;
  }
  if (bLive) {
    const terminal = bScale * (bR - terminalR);
    if (terminal < best) best = terminal;
  }
  // Validity chains fold NO cap terminal — deliberately asymmetric with
  // A/B. In-sphere means inside the bounding SPHERE, not near the
  // attractor, so a validity chain's cap terminal is a vacuous negative
  // bound that can only ever pull the estimate toward a fabricated hit
  // (the membrane direction the beam record calls the visually harmful
  // one), never fix a real one — the piece it tracks sits within
  // sigmaMax_chain * 2R of the query, sub-resolution wherever the depth
  // cap is not clamped. Measured (beam harness, all systems, both
  // estimators, widths 3/4): folding them changes NOTHING — whenever a
  // validity chain survives to the cap, chain A holds an equal-or-deeper
  // branch whose terminal already dominates — so the fold is omitted on
  // principle, not cost. (The disclosed repro3 void-false-hit uptick,
  // 0 -> 2/435 refined at width 4, comes from A's OWN terminal on
  // wanderer branches the validity slots keep alive in-sphere to the
  // depth cap — and in-sphere is not near-attractor, so the KIFS
  // last-value bound is vacuous for them at ANY cap size: re-measured
  // unchanged after the ceiling was raised from 48 to 128.)
  return descentValue(best, sphereBound, finalScale);
}

/** How many chains the fold frontier ({@link descendFold}) keeps alive.
 * Sized by measurement (the fold probe's exhaustive-reference sweep):
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
const fcState = new Uint32Array(FOLD_W);
const fnKey = new Float64Array(FOLD_W);
const fnX = new Float64Array(FOLD_W);
const fnY = new Float64Array(FOLD_W);
const fnZ = new Float64Array(FOLD_W);
const fnScale = new Float64Array(FOLD_W);
const fnFloor = new Float64Array(FOLD_W);
const fnR = new Float64Array(FOLD_W);
const fnCert = new Float64Array(FOLD_W);
const fnState = new Uint32Array(FOLD_W);
const FOLD_SWEEP = [0, 0, 0];

/** One frontier-insertion candidate as {@link FoldFrontierTap} reports it:
 * the floored selection key and the chain state the slot would carry. */
export interface FoldFrontierCandidate {
  key: number;
  x: number;
  y: number;
  z: number;
  scale: number;
  floor: number;
  r: number;
}

/**
 * Test-only observation tap on {@link descendFold}'s frontier.
 * When installed, every candidate that reaches frontier INSERTION (i.e.
 * survived the floor-vs-best prune and the B&B skips and did not fold as
 * an escape) is reported in arrival order, and every level that completes
 * its sweep reports the kept slots in slot order — levels truncated by a
 * value-exact early exit report nothing. The contract this exists to pin:
 * the kept set is exactly the level's FOLD_W smallest floored keys, a
 * full frontier replacing its first-scanned worst slot only when a
 * STRICTLY smaller key arrives (ties evict the newcomer). The cross-check
 * lives in surface-de.test.ts as a brute-force replay of the candidate
 * stream. Production never installs a tap: the null path costs one
 * pointer check per inserted candidate and per level, and the GLSL/WGSL
 * mirrors carry no counterpart — the tap reads state, never perturbs it.
 */
export interface FoldFrontierTap {
  candidate(depth: number, c: FoldFrontierCandidate): void;
  level(depth: number, kept: FoldFrontierCandidate[]): void;
}

let foldFrontierTap: FoldFrontierTap | null = null;

/** Install (or clear, with `null`) the {@link FoldFrontierTap}. Tests
 * only; callers must clear the tap in a `finally`. */
export function setFoldFrontierTap(tap: FoldFrontierTap | null): void {
  foldFrontierTap = tap;
}

/**
 * Fold-system descent: a width-{@link SURFACE_FOLD_BEAM_WIDTH}
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
 * - BRANCH-AND-BOUND SKIP (stage 2). Both the floor prune and
 *   the transform reorder above it still pay the branch decode; this
 *   skip prices the CHILD before the inverse application, from
 *   `r >= invMSigmaMin·|pre| − invTNorm`. A candidate provably past the
 *   escape radius with certificate >= best, or — frontier full — provably
 *   both non-displacing (key >= worst kept) and fold-no-op, is a state
 *   no-op and is skipped BIT-IDENTICALLY (the in-loop comment carries
 *   the case analysis; measured byte-identical on the harness's full
 *   probe gauntlet, transforms/call sharply down).
 *
 * Everything else mirrors {@link descend}: same prologue/lens, same
 * selection-key semantics otherwise, same escape-radius folds (plain on
 * both paths), same guarded refinement of escaped folds
 * ({@link refinedCertValue} — the certificate keeps its floor via max:
 * refinement examines the child's own neighbourhood, the floor its
 * branch history, so the pair's max is the strongest settled term), same
 * cutoff/sphere-floor exits after every settled fold (the cutoff and
 * sphere-floor contract carries verbatim: `best` is monotone and every folded
 * term is finalized), and the same KIFS cap terminals — floor-raised,
 * for every live chain alike (the affine body's A/B-vs-validity-slot
 * asymmetry exists to starve affine wanderers, which floors handle
 * better here). In-sphere floor-0 drops past the frontier width remain
 * the one silent residual, overshoot-direction only — measured zero at
 * this width on the probe set.
 *
 * MIRROR NOTE: the GLSL fold tracer marches this body's refine=FALSE
 * path — and refine=false IS the fold production estimator everywhere
 * (the SURFACE_FOLDS GLSL variant, the WGSL fold core, the empty-space grid
 * floors priced "plain"; refined-on-folds is harness/test-only). Region
 * floors, not refinement, carry the ghost-killing on fold systems
 * (deep-void false hits are 0 for both estimators), and
 * {@link refinedCertValue}'s branch sweep inlined into the frontier's
 * innermost GLSL loop is part of what Mesa's compiler died on (see
 * surface-material.ts's fold notes). Refinement is NOT a bit-level
 * no-op here: it carries the disclosed width-bound tail, so the
 * surface-beam harness gates the base row.
 */
function descendFold(
  de: SurfaceDE,
  p: Vec3,
  refine: boolean,
  cutoff = 0,
  footprint = 0,
): number {
  const maxDepth = footprintDepthCap(de, footprint);
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

  const { order, plane, stepCos, stepSin } = de.symmetry;
  const R = de.boundingRadius;
  const [bcX, bcY, bcZ] = de.boundCenter;
  const condensation = de.condensation;
  const startR = Math.hypot(x - bcX, y - bcY, z - bcZ);
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
  fcState[0] = SURFACE_CHAOS_WILDCARD;

  for (let depth = 0; depth < maxDepth && chainCount > 0; depth++) {
    const inB = de.schedule !== undefined && depth < de.schedule.depth;
    const levelMaps = inB ? de.schedule!.maps : de.maps;
    const sectorOrder = inB ? 1 : order;
    const childBound = de.schedule
      ? de.schedule.bounds[Math.min(depth + 1, de.schedule.depth)]
      : null;
    const R = childBound ? childBound.radius : de.boundingRadius;
    const bcX = childBound ? childBound.center[0] : de.boundCenter[0];
    const bcY = childBound ? childBound.center[1] : de.boundCenter[1];
    const bcZ = childBound ? childBound.center[2] : de.boundCenter[2];
    const escapeRadius = childBound ? childBound.escapeRadius : de.escapeRadius;
    if (condensation) {
      for (let c = 0; c < chainCount; c++) {
        const term = scheduledCondensationTerm3(
          de,
          depth,
          fcScale[c],
          fcX[c],
          fcY[c],
          fcZ[c],
          fcState[c],
        );
        if (term < best) best = term;
      }
      if (best <= sphereBound || best * finalScale < bailBelow) {
        return descentValue(best, sphereBound, finalScale);
      }
    }
    const futureCondensation = scheduledCondensationHasFutureDepth(
      de,
      depth + 1,
    );
    let keptCount = 0;
    // Worst kept slot, maintained by a fixed-bound rescan whenever the
    // frontier is full (see the insertion comment below for why the
    // storage is deliberately UNSORTED).
    let fnWorstKey = -Infinity;
    let fnWorstIdx = 0;
    for (let c = 0; c < chainCount; c++) {
      const pScale = fcScale[c];
      const pFloor = fcFloor[c];
      const pState = fcState[c];
      let sX = fcX[c];
      let sY = fcY[c];
      let sZ = fcZ[c];
      // Stage-2 hoists: the chain-point norm is sector-invariant
      // (sectors rotate about an axis through the origin), so the affine
      // arm's |pre|² is one number per chain; 1/pScale prices the skip's
      // frontier-key condition.
      // With condensation, R is the proven invariant ball of the FULL
      // recursive closure A (ordinary pieces and every nested C0), not a
      // probe radius. Therefore childScale*(r-R) lower-bounds the whole
      // candidate subtree. A stage-2 skip proved from that certificate is
      // sound even though it does not literally evaluate the separately
      // damped 0.9*C0 heuristic; fold region floors constrain the same
      // branch image. Surviving candidates still evaluate immediate C0
      // before frontier insertion below.
      const chainNormSq = sX * sX + sY * sY + sZ * sZ;
      const invPScale = 1 / pScale;
      for (let k = 0; k < sectorOrder; k++) {
        if (k > 0) {
          stepSector(plane, stepCos, stepSin, sX, sY, sZ, FOLD_SWEEP);
          sX = FOLD_SWEEP[0];
          sY = FOLD_SWEEP[1];
          sZ = FOLD_SWEEP[2];
        }
        for (let j = 0; j < levelMaps.length; j++) {
          const map = levelMaps[j];
          if (!inB && !surfaceChaosAllows(de.chaos, pState, map.stateIndex!)) {
            continue;
          }
          const childState = inB
            ? SURFACE_CHAOS_WILDCARD
            : (map.stateIndex ?? SURFACE_CHAOS_WILDCARD);
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
          // Stage 2 (branch-and-bound skip): a candidate whose
          // processing is provably a STATE no-op — nothing folded below
          // best, nothing displaced in the frontier — can be skipped
          // bit-identically, not merely validly. The child radius is
          // lower-bounded from `pre` alone, by the LARGER of two forms:
          //
          //     r = |invM·pre + invT| >= invMSigmaMin·|pre| − invTNorm
          //     r                     >= dot(bnbDir, pre) + invTNorm
          //
          // (the sigma form; and the directional form — project onto the
          // unit direction of invT: |x| >= dot(d, x) for unit d, so
          // r >= dot(d, invM·pre) + |invT|. The first survives invT = 0,
          // the second stays tight when the inverse translation
          // dominates the child radius — the measured fold case, where
          // the sigma form's −|invT| slack made it fire never.) The
          // directional form is radical-free and tested directly; the
          // sigma form is tested squared (both sides nonnegative by
          // construction). Two no-op classes:
          //
          // - ESCAPE skip: rLower STRICTLY > escapeRadius forces the
          //   plain escape fold, which is a no-op when also
          //   childScale·(rLower − R) >= best (the folded certificate is
          //   >= its own lower bound; a cert >= best never updates best,
          //   so the early exits cannot fire either). No frontier state
          //   involved, so this arm works at ANY keptCount.
          // - FRONTIER skip, only with the frontier FULL: (a)
          //   rLower >= R and childScale·(rLower − R) >= best — the
          //   eviction fold cannot advance the min (refinement only
          //   raises folded certificates, and at rLower = R exactly,
          //   possible only with best <= 0, the in-sphere eviction folds
          //   a positive floor or nothing — either way a no-op) — AND
          //   (b) pScale·(rLower − R) >= fnWorstKey, so key >= fnWorstKey
          //   and ties-evict-the-newcomer takes the eviction path for
          //   certain. Encoded via qReq = R + max(0, best/childScale,
          //   fnWorstKey/pScale): skip iff
          //   |pre|²·invMSigmaMin² >= (qReq + invTNorm)².
          //
          // best/fnWorstKey only DECREASE within a level, so a skip
          // decided now would also be decided at any later state;
          // enumeration order (and thus every tie-break) is untouched.
          const bnbSigma = map.invMSigmaMin;
          const bnbSigmaSq = bnbSigma * bnbSigma;
          const bnbT = map.invTNorm;
          const needE = escapeRadius + bnbT;
          const needESq = needE * needE;
          const bnbDir = map.bnbDir;
          const gX = bnbDir[0];
          const gY = bnbDir[1];
          const gZ = bnbDir[2];
          let invChildScale =
            1 /
            (pScale *
              (kind === SURFACE_FOLD_NONE ? map.sigmaMin : map.foldSigma));
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
          // The map's authored fold lengths, hoisted out of the
          // branch loop; classic values reduce every expression to the
          // literal that shipped.
          const fr = map.foldRadii;
          const wall = fr.wall;
          const wall2 = 2 * wall;
          if (kind !== SURFACE_FOLD_NONE) {
            ux = sX * map.foldInvW;
            uy = sY * map.foldInvW;
            uz = sZ * map.foldInvW;
            if (kind === SURFACE_FOLD_BOXFOLD) {
              px0 = ux;
              px1 = wall2 - ux;
              px2 = -wall2 - ux;
              py0 = uy;
              py1 = wall2 - uy;
              py2 = -wall2 - uy;
              pz0 = uz;
              pz1 = wall2 - uz;
              pz2 = -wall2 - uz;
              dxUp = ux > wall ? ux - wall : 0;
              dxDn = ux < -wall ? -wall - ux : 0;
              dyUp = uy > wall ? uy - wall : 0;
              dyDn = uy < -wall ? -wall - uy : 0;
              dzUp = uz > wall ? uz - wall : 0;
              dzDn = uz < -wall ? -wall - uz : 0;
            } else {
              ru = Math.sqrt(ux * ux + uy * uy + uz * uz);
            }
          }
          for (let b = 0; b < branchCount; b++) {
            let ix: number;
            let iy: number;
            let iz: number;
            let branchSigma: number;
            // The candidate's floor — its chain's floor, raised below by
            // the branch's own region certificate — is knowable BEFORE the
            // child transform (stage 1: branchRd needs only the
            // branch decode), so the floor-vs-best prune runs first and
            // only surviving branches pay the inverse application.
            let candFloor = pFloor;
            if (kind === SURFACE_FOLD_NONE) {
              if (candFloor > 0 && candFloor >= best) continue;
              // Stage-2 B&B skips (see the hoist comment above).
              const rDir = gX * sX + gY * sY + gZ * sZ + bnbT;
              const rEsc = R + best * invChildScale;
              if (!inB && rDir > escapeRadius && rDir >= rEsc) continue;
              const sTerm = chainNormSq * bnbSigmaSq;
              if (!inB && sTerm > needESq) {
                const needC = rEsc + bnbT;
                if (needC <= 0 || sTerm >= needC * needC) continue;
              }
              if (!inB && keptCount === FOLD_W) {
                const qReq =
                  R +
                  Math.max(
                    0,
                    Math.max(best * invChildScale, fnWorstKey * invPScale),
                  );
                if (rDir >= qReq) continue;
                const need = qReq + bnbT;
                if (sTerm >= need * need) continue;
              }
              ix = im[0] * sX + im[1] * sY + im[2] * sZ + it[0];
              iy = im[3] * sX + im[4] * sY + im[5] * sZ + it[1];
              iz = im[6] * sX + im[7] * sY + im[8] * sZ + it[2];
              branchSigma = map.sigmaMin;
            } else {
              let branchRd: number;
              if (
                kind === SURFACE_FOLD_SPHEREFOLD ||
                (kind === SURFACE_FOLD_MANDELBOX && b % 27 === 0)
              ) {
                // (Re)compute the spherefold branch this b enters: outer
                // identity, inner ×mR²/fR² (conformal sigma fR²/mR²), mid
                // inversion in the sphere of radius fR (query-dependent
                // sigma |u|/fR — module doc), each with its distance to the
                // branch's OUTPUT region (outer outside radius fR, inner
                // inside fR²/mR, mid the shell between).
                const s = kind === SURFACE_FOLD_SPHEREFOLD ? b : b / 27;
                if (s === 0) {
                  vx = ux;
                  vy = uy;
                  vz = uz;
                  sfSigma = 1;
                  sfRd = ru < fr.fixedR ? fr.fixedR - ru : 0;
                } else if (s === 1) {
                  vx = fr.innerScale * ux;
                  vy = fr.innerScale * uy;
                  vz = fr.innerScale * uz;
                  sfSigma = fr.innerSigma;
                  sfRd = ru > fr.outputR ? ru - fr.outputR : 0;
                } else {
                  if (ru < fr.midMinR) {
                    // Inverting a chain point this close to the sector
                    // origin would overflow the GLSL mirror's f32; the mid
                    // piece lives in the u-space shell fR <= |·| <= fR²/mR,
                    // so fold the shell bound |w|·(fR − |u|) — ~pScale·|w|·fR,
                    // never a near-zero ghost term — and skip the branch
                    // (box expansion included). A settled fold, so the
                    // standard exits apply.
                    let shellCert = pScale * absW * (fr.fixedR - ru);
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
                  const invR2 = fr.fixedR2 / (ru * ru);
                  vx = ux * invR2;
                  vy = uy * invR2;
                  vz = uz * invR2;
                  sfSigma = ru * fr.invFixedR;
                  sfRd =
                    ru < fr.fixedR
                      ? fr.fixedR - ru
                      : ru > fr.outputR
                        ? ru - fr.outputR
                        : 0;
                }
                // This sphere branch's childScale reciprocal for the
                // stage-2 skip (sfSigma just changed).
                invChildScale = 1 / (pScale * map.foldSigma * sfSigma);
                if (kind === SURFACE_FOLD_MANDELBOX) {
                  px0 = vx;
                  px1 = wall2 - vx;
                  px2 = -wall2 - vx;
                  py0 = vy;
                  py1 = wall2 - vy;
                  py2 = -wall2 - vy;
                  pz0 = vz;
                  pz1 = wall2 - vz;
                  pz2 = -wall2 - vz;
                  dxUp = vx > wall ? vx - wall : 0;
                  dxDn = vx < -wall ? -wall - vx : 0;
                  dyUp = vy > wall ? vy - wall : 0;
                  dyDn = vy < -wall ? -wall - vy : 0;
                  dzUp = vz > wall ? vz - wall : 0;
                  dzDn = vz < -wall ? -wall - vz : 0;
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
              if (branchRd > 0) {
                const flr = pScale * absW * branchRd;
                if (flr > candFloor) candFloor = flr;
              }
              // Floor-vs-best prune: every fold the candidate's subtree
              // could ever contribute is >= its floor, which already
              // cannot advance the min. Pruned branches never reach the
              // inverse application below.
              if (candFloor > 0 && candFloor >= best) continue;
              // Stage-2 B&B skips (see the hoist comment above); the
              // bounds read the branch preimage exactly, after the shell
              // guard.
              const rDir = gX * cx + gY * cy + gZ * cz + bnbT;
              const rEsc = R + best * invChildScale;
              if (!inB && rDir > escapeRadius && rDir >= rEsc) continue;
              const sTerm = (cx * cx + cy * cy + cz * cz) * bnbSigmaSq;
              if (!inB && sTerm > needESq) {
                const needC = rEsc + bnbT;
                if (needC <= 0 || sTerm >= needC * needC) continue;
              }
              if (!inB && keptCount === FOLD_W) {
                const qReq =
                  R +
                  Math.max(
                    0,
                    Math.max(best * invChildScale, fnWorstKey * invPScale),
                  );
                if (rDir >= qReq) continue;
                const need = qReq + bnbT;
                if (sTerm >= need * need) continue;
              }
              ix = im[0] * cx + im[1] * cy + im[2] * cz + it[0];
              iy = im[3] * cx + im[4] * cy + im[5] * cz + it[1];
              iz = im[6] * cx + im[7] * cy + im[8] * cz + it[2];
              branchSigma = map.foldSigma * sfSigma;
            }
            const icx = ix - bcX;
            const icy = iy - bcY;
            const icz = iz - bcZ;
            const r = Math.sqrt(icx * icx + icy * icy + icz * icz);
            const childScale = pScale * branchSigma;
            if (condensation) {
              const shapeTerm = scheduledCondensationTerm3(
                de,
                depth + 1,
                childScale,
                ix,
                iy,
                iz,
                childState,
              );
              if (shapeTerm < best) best = shapeTerm;
            }
            let key = pScale * (r - R);
            if (candFloor > 0 && candFloor > key) key = candFloor;
            let cert = childScale * (r - R);
            if (candFloor > 0 && candFloor > cert) cert = candFloor;
            // Past the escape radius deeper refinement cannot improve the
            // min: fold the (floor-raised) certificate plain, exactly as
            // the affine body's escape-radius folds stay plain.
            if (r > escapeRadius) {
              if (cert < best) {
                best = cert;
                if (best <= sphereBound || best * finalScale < bailBelow) {
                  return descentValue(best, sphereBound, finalScale);
                }
              }
              continue;
            }
            if (foldFrontierTap !== null) {
              foldFrontierTap.candidate(depth, {
                key,
                x: ix,
                y: iy,
                z: iz,
                scale: childScale,
                floor: candFloor,
                r,
              });
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
            let evState = SURFACE_CHAOS_WILDCARD;
            let evHas = false;
            if (keptCount === FOLD_W && key >= fnWorstKey) {
              evX = ix;
              evY = iy;
              evZ = iz;
              evScale = childScale;
              evR = r;
              evCert = cert;
              evFloor = candFloor;
              evState = childState;
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
                evState = fnState[slot];
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
              fnState[slot] = childState;
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
                      depth + 1,
                      evState,
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
              } else if (futureCondensation) {
                const subtree = evScale * (evR - R);
                if (subtree < best) best = subtree;
                if (best <= sphereBound || best * finalScale < bailBelow) {
                  return descentValue(best, sphereBound, finalScale);
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
      fcState[i] = fnState[i];
    }
    chainCount = keptCount;
    if (foldFrontierTap !== null) {
      const kept: FoldFrontierCandidate[] = [];
      for (let i = 0; i < keptCount; i++) {
        kept.push({
          key: fnKey[i],
          x: fnX[i],
          y: fnY[i],
          z: fnZ[i],
          scale: fnScale[i],
          floor: fnFloor[i],
          r: fnR[i],
        });
      }
      foldFrontierTap.level(depth, kept);
    }
  }

  // Floor-raised KIFS terminals for every chain alive at the depth cap: a
  // floor-0 chain is a true preimage orbit (its negative terminal is the
  // hit signal), a strayed chain folds its certified positive floor.
  const terminalR = de.schedule
    ? de.schedule.bounds[Math.min(maxDepth, de.schedule.depth)].radius
    : R;
  for (let c = 0; c < chainCount; c++) {
    if (condensation) {
      const shapeTerm = scheduledCondensationTerm3(
        de,
        maxDepth,
        fcScale[c],
        fcX[c],
        fcY[c],
        fcZ[c],
        fcState[c],
      );
      if (shapeTerm < best) best = shapeTerm;
    }
    let terminal = fcScale[c] * (fcR[c] - terminalR);
    if (fcFloor[c] > 0 && fcFloor[c] > terminal) terminal = fcFloor[c];
    if (terminal < best) best = terminal;
  }
  return descentValue(best, sphereBound, finalScale);
}

/**
 * Pure-fold FINAL-transform lens descent: the visible set is
 * `F(A)` with `F = w·V(M p + t)` and `V` a fold family, so
 *
 *     dist(p, F(A)) = |w| · dist(p/w, V(Y))          (odd folds; Y = M·A + t)
 *                   >= |w| · min_c max( regionDist_c(p/w),
 *                                       sigma_c · dist(B_c^-1(p/w), Y) )
 *                   >= min_c max( |w|·regionDist_c(p/w),
 *                                 |w|·sigma_c·sigmaMin(M) · dist(q_c, A) )
 *
 * — exactly the fold-branch sweep vocabulary (branch preimages,
 * conformal sigmas, region floors) lifted ONE level, to the query itself:
 * each fold branch seeds a root descent at `q_c = invM·B_c^-1(p/w) + invT`
 * through the UNTOUCHED descent cores ({@link descend}/{@link descendFold}
 * — `de.final` is null whenever `de.foldFinal` is set, so the cores run
 * their no-lens arithmetic verbatim), and the estimate is the min over
 * branch terms, floored by the visible-set sphere bound
 * `|p| − visibleBoundingRadius`.
 *
 * Three prunes keep the branch loop from costing its worst case, each
 * VALUE-EXACT (a pruned branch's term is proven `>= best`, so the min is
 * untouched):
 *
 * - REGION FLOOR vs best: `|w|·regionDist_c >= best` — every value the
 *   branch could contribute is at least its floor.
 * - SPHERE CERTIFICATE vs best: `factor_c·(|q_c| − R) >= best` — the
 *   core's return never undercuts its own depth-0 sphere bound.
 * - VISIBLE-SPHERE PIN (the sphere-floor argument, outer edition): once
 *   `best <= |p| − visibleR` the eventual `max(best, visBound)` is pinned;
 *   return it immediately, bit-exact for every caller.
 *
 * The spherefold MID branch keeps its {@link SPHEREFOLD_MID_MIN_R} shell
 * guard: a query that close to the origin in u-space folds the settled
 * shell bound `|w|·(1 − ru)` instead of inverting (and, for the mandelbox,
 * skips that sphere branch's whole box expansion), exactly as the iterated
 * sweep does.
 *
 * BRANCH ORDER IS DELIBERATELY THE INDEX ORDER (measured 2026-07-30 — do
 * not "fix" this without re-measuring). The prunes all
 * test against the running `best`, so visiting a near-argmin branch first
 * would strengthen every later one, and best-FIRST ordering (seed the
 * sweep with the argmin of each branch's exact depth-0 lower bound
 * `max(floor_c, factor_c·(rq_c − R))`, kept in six scalars, then sweep
 * skipping it) was implemented in all of this function, its WGSL mirror
 * and their tests, and REVERTED. It works as designed and still loses:
 * core descents per call fell 4.46 -> 2.26 on the `lensMandelboxOverTetra`
 * archetype and 6.83 -> 5.94 on the identity-lens field class (9-15% of CPU
 * wall, `scripts/lens-branch-cost.harness.ts`), but the real Iris Xe driver
 * measured 1.46-1.54x SLOWER end to end (frame-lens 3425 -> 4986ms,
 * unproj-lens 184 -> 283ms), because pricing all 81 branch preimages a
 * second time costs the GPU more than the ~16% of descent transforms it
 * saves — the branch-and-bound's stage-2 verdict, one level up. The
 * survivors that remain after seeding are branches whose preimages land
 * INSIDE the bounding ball, where the depth-0 sphere certificate is vacuous
 * at ANY visit order, so ordering had already reached its ceiling. Cutting
 * the sweep's remaining ~4.3x tax over the un-lensed system needs a
 * stronger in-ball certificate, not a cheaper route to this one.
 *
 * AND THE STRONGER IN-BALL CERTIFICATE IS AT ITS CEILING TOO (measured
 * 2026-07-30 — the sentence above sends a reader here, so read
 * this before building one). The strongest in-ball certificate that
 * exists is a conservative distance floor over the BASE attractor,
 * sampled at each branch preimage: `surface-grid.ts` prices its cells
 * with a FULL descent at the cell center, so nothing short of an exact
 * `dist(q_c, A)` beats one by more than a cell radius. Wired in as a
 * fourth prune (`factor_c · floor_grid(q_c) >= best`, NEAREST fetch, the
 * grid built over the same transforms with no final) and measured on the
 * three systems of `scripts/lens-branch-cost.harness.ts` — core descents
 * per call, then transforms per call, at the harness pose and at the 0.6x
 * framing where the class costs 2-3x more per ray:
 *
 *   lensMandelboxIdentityOverDefault  6.83 -> 3.71 (262 -> 170)
 *     at 0.6x                         7.57 -> 2.97 (356 -> 211), 1.68x wall
 *   lensMandelboxOverTetra            4.46 -> 4.33 (195 -> 190)
 *     at 0.6x                         3.68 -> 3.33 (158 -> 145), 1.12x wall
 *   lensBoxfoldOverTetra              2.34 -> 2.31 ( 44 ->  43)
 *     at 0.6x                         1.15 -> 1.10 ( 91 ->  91), 0.98x wall
 *
 * ONE system pays — the identity-lens field class — and it pays MORE the
 * closer the camera gets: gridless survivors RISE across that sweep (6.83
 * -> 7.57) while pruned ones FALL (3.71 -> 2.97). The
 * `lensMandelboxOverTetra` archetype and the boxfold lens get 3-12% and
 * nothing, and would still pay the fetch. Neither grid resolution nor cube
 * reach is the limit: 32 and 64 agree within 0.1 descents, and inflating
 * the cover to 2x/4x the descent ball moves nothing monotonically (4.27 ->
 * 4.12 -> 4.26). What the floors cannot kill are branches whose preimages
 * sit genuinely NEAR the base attractor, where a floor is zero by
 * construction — real candidates for the min, not waste. So most of the
 * ~4.3x tax is what a lens with several preimages near its own attractor
 * simply COSTS.
 *
 * NOT LANDED, and the shape of the refusal matters as much as the numbers.
 * Unlike the three prunes above, this one is SOUND BUT NOT VALUE-EXACT: a
 * floor bounds the TRUE distance, which the core's return only
 * under-estimates, so a pruned branch's exact term can sit below `best` and
 * a grid-carrying DE returns `>=` the gridless one (measured 0 deviation
 * over 12,000 points at cutoff 0 — the inexactness is structural, not
 * frequent). Every mirror not sampling the same floors is therefore a
 * DIFFERENT estimator, which is a fourth mirror's worth of obligation for a
 * win one system in three can spend — against a lineage where the
 * branch-and-bound's stage 2 and the ordering pass above were both
 * CPU-positive and measured NET NEGATIVE on the real Iris driver, and where
 * this trade adds divergent memory traffic where those two added ALU. If it
 * is ever revisited: the field class is where the prize is, the tables
 * above are what a fresh attempt has to beat, and the real-driver
 * `bench:surface` verdict has to be green first or the GPU A/B that would
 * decide it cannot be read.
 *
 * CUTOFF CONTRACT (the march-epsilon one, honored verbatim): inner descents
 * receive `min(best, cutoff)/factor_c` when `cutoff > 0` — an inner value
 * below that line certifies its term below `min(best, cutoff)`, so any
 * inexact (early-exited) term forces the final return under the cutoff, and
 * every return at or above the cutoff is a min over EXACT terms. With
 * `cutoff <= 0` the inner descents run full (`0`), keeping the value
 * callers (normals, AO taps, the grid's floor build) bit-exact — the prunes
 * above carry the cost saving instead.
 */
function descendLens(
  de: SurfaceDE,
  p: Vec3,
  refine: boolean,
  cutoff = 0,
  footprint = 0,
): number {
  const lens = de.foldFinal!;
  const R = de.boundingRadius;
  const [bcX, bcY, bcZ] = de.boundCenter;
  const hasFolds = deHasFolds(de);
  // The VISIBLE ball stays origin-centered (its own bound, its own
  // radius); only the raw attractor's descent ball carries the probe-fit
  // center.
  const visBound =
    Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) -
    de.visibleBoundingRadius;
  const kind = lens.foldKind;
  const absW = lens.absW;
  const im = lens.invM;
  const it = lens.invT;
  const sigmaMinM = lens.sigmaMin;

  const ux = p[0] * lens.invW;
  const uy = p[1] * lens.invW;
  const uz = p[2] * lens.invW;
  let best = Infinity;

  // Per-axis box preimage triples + output-interval distances (boxfold
  // reads them off u once; the mandelbox refreshes them from each
  // spherefold branch output) — the iterated sweep's locals, one level up.
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
  let ru = 0;
  // The LENS fold's own authored lengths — a final transform
  // carries its three fields exactly like a base map, and the classic set
  // reduces every expression below to the literal that shipped.
  const fr = lens.foldRadii;
  const wall = fr.wall;
  const wall2 = 2 * wall;
  if (kind === SURFACE_FOLD_BOXFOLD) {
    px0 = ux;
    px1 = wall2 - ux;
    px2 = -wall2 - ux;
    py0 = uy;
    py1 = wall2 - uy;
    py2 = -wall2 - uy;
    pz0 = uz;
    pz1 = wall2 - uz;
    pz2 = -wall2 - uz;
    dxUp = ux > wall ? ux - wall : 0;
    dxDn = ux < -wall ? -wall - ux : 0;
    dyUp = uy > wall ? uy - wall : 0;
    dyDn = uy < -wall ? -wall - uy : 0;
    dzUp = uz > wall ? uz - wall : 0;
    dzDn = uz < -wall ? -wall - uz : 0;
  } else {
    ru = Math.sqrt(ux * ux + uy * uy + uz * uz);
  }

  const branchCount = foldBranchCount(kind);
  for (let b = 0; b < branchCount; b++) {
    if (
      kind === SURFACE_FOLD_SPHEREFOLD ||
      (kind === SURFACE_FOLD_MANDELBOX && b % 27 === 0)
    ) {
      const s = kind === SURFACE_FOLD_SPHEREFOLD ? b : b / 27;
      if (s === 0) {
        vx = ux;
        vy = uy;
        vz = uz;
        sfSigma = 1;
        sfRd = ru < fr.fixedR ? fr.fixedR - ru : 0;
      } else if (s === 1) {
        vx = fr.innerScale * ux;
        vy = fr.innerScale * uy;
        vz = fr.innerScale * uz;
        sfSigma = fr.innerSigma;
        sfRd = ru > fr.outputR ? ru - fr.outputR : 0;
      } else {
        if (ru < fr.midMinR) {
          // Shell guard (see doc): fold the settled shell bound and skip
          // the branch, box expansion included.
          const shellCert = absW * (fr.fixedR - ru);
          if (shellCert < best) {
            best = shellCert;
            if (best <= visBound) return visBound;
            if (cutoff > 0 && best < cutoff) {
              return best > visBound ? best : visBound;
            }
          }
          if (kind === SURFACE_FOLD_MANDELBOX) b += 26;
          continue;
        }
        const invR2 = fr.fixedR2 / (ru * ru);
        vx = ux * invR2;
        vy = uy * invR2;
        vz = uz * invR2;
        sfSigma = ru * fr.invFixedR;
        sfRd =
          ru < fr.fixedR
            ? fr.fixedR - ru
            : ru > fr.outputR
              ? ru - fr.outputR
              : 0;
      }
      if (kind === SURFACE_FOLD_MANDELBOX) {
        px0 = vx;
        px1 = wall2 - vx;
        px2 = -wall2 - vx;
        py0 = vy;
        py1 = wall2 - vy;
        py2 = -wall2 - vy;
        pz0 = vz;
        pz1 = wall2 - vz;
        pz2 = -wall2 - vz;
        dxUp = vx > wall ? vx - wall : 0;
        dxDn = vx < -wall ? -wall - vx : 0;
        dyUp = vy > wall ? vy - wall : 0;
        dyDn = vy < -wall ? -wall - vy : 0;
        dzUp = vz > wall ? vz - wall : 0;
        dzDn = vz < -wall ? -wall - vz : 0;
      }
    }
    let cx: number;
    let cy: number;
    let cz: number;
    let branchRd: number;
    if (kind === SURFACE_FOLD_SPHEREFOLD) {
      cx = vx;
      cy = vy;
      cz = vz;
      branchRd = sfRd;
    } else {
      const bb = kind === SURFACE_FOLD_BOXFOLD ? b : b % 27;
      const selX = bb % 3;
      const selY = ((bb / 3) | 0) % 3;
      const selZ = (bb / 9) | 0;
      cx = selX === 0 ? px0 : selX === 1 ? px1 : px2;
      cy = selY === 0 ? py0 : selY === 1 ? py1 : py2;
      cz = selZ === 0 ? pz0 : selZ === 1 ? pz1 : pz2;
      const ddx =
        selX === 0 ? (dxUp > dxDn ? dxUp : dxDn) : selX === 1 ? dxUp : dxDn;
      const ddy =
        selY === 0 ? (dyUp > dyDn ? dyUp : dyDn) : selY === 1 ? dyUp : dyDn;
      const ddz =
        selZ === 0 ? (dzUp > dzDn ? dzUp : dzDn) : selZ === 1 ? dzUp : dzDn;
      const boxRd2 = ddx * ddx + ddy * ddy + ddz * ddz;
      const boxRd = boxRd2 > 0 ? Math.sqrt(boxRd2) : 0;
      branchRd =
        kind === SURFACE_FOLD_BOXFOLD
          ? boxRd
          : sfRd > sfSigma * boxRd
            ? sfRd
            : sfSigma * boxRd;
    }
    const floor = absW * branchRd;
    if (floor > 0 && floor >= best) continue;
    const qx = im[0] * cx + im[1] * cy + im[2] * cz + it[0];
    const qy = im[3] * cx + im[4] * cy + im[5] * cz + it[1];
    const qz = im[6] * cx + im[7] * cy + im[8] * cz + it[2];
    const factor = absW * sfSigma * sigmaMinM;
    const qcx = qx - bcX;
    const qcy = qy - bcY;
    const qcz = qz - bcZ;
    const rq = Math.sqrt(qcx * qcx + qcy * qcy + qcz * qcz);
    // The core's return never undercuts its own depth-0 sphere bound
    // (|q − boundCenter| − R against the probe-fit ball), so a branch
    // whose scaled sphere certificate already reaches the running min
    // cannot advance it — skip the whole descent, exactly.
    if (factor * (rq - R) >= best) continue;
    const innerCutoff =
      cutoff > 0 ? (best < cutoff ? best : cutoff) / factor : 0;
    // The footprint scales like the cutoff: a world feature of
    // size f is an inner-space feature of size f / factor — a lens with
    // |w| > 1 SHRINKS inner features in world terms, so dividing keeps
    // the cap resolving exactly to the caller's resolution either way.
    const innerFootprint = footprint > 0 ? footprint / factor : 0;
    LENS_QUERY[0] = qx;
    LENS_QUERY[1] = qy;
    LENS_QUERY[2] = qz;
    const inner = hasFolds
      ? descendFold(de, LENS_QUERY, refine, innerCutoff, innerFootprint)
      : descend(de, LENS_QUERY, refine, innerCutoff, innerFootprint);
    let term = factor * inner;
    if (floor > term) term = floor;
    if (term < best) {
      best = term;
      if (best <= visBound) return visBound;
      if (cutoff > 0 && best < cutoff) {
        return best > visBound ? best : visBound;
      }
    }
  }
  return best > visBound ? best : visBound;
}

/** Scratch query triple for {@link descendLens}' root descents — module
 * scope so the branch loop never allocates. Single-threaded by
 * construction, like the descent scratch above. */
const LENS_QUERY: Vec3 = [0, 0, 0];
