import { composeAffine4, symmetryRotation4, toTransform4 } from "./affine4";
import {
  effectiveSymmetryOrder,
  prepareSchedule,
  systemHasChaos,
  transformHasEmitter,
} from "./chaos-game";
import { runChaosGame4 } from "./chaos-game-4d";
import {
  condensationBoundingRadius4,
  condensationHasFutureDepth,
  condensationTerm4,
  resolveCondensationDepthBand,
} from "./condensation-de";
import type {
  CondensationDE4,
  CondensationDepthBand,
  CondensationEmitter4,
} from "./condensation-de";
import { mulberry32 } from "./rng";
import { SHAPE_MARCH_SAFETY, shapeBoundingRadius, shapeSdf } from "./shapes";
import {
  SURFACE_NATIVE_CALIBRATION_SAMPLE_COUNT,
  calibrateSurfaceNativeCarriers,
} from "./surface-pattern";
import type { SurfaceNativeCalibration } from "./surface-pattern";
import {
  CONFORMAL_RATIO,
  CONTRACTION_LIMIT,
  DEPTH_RESOLUTION,
  ESCAPE_FACTOR,
  MAX_DESCENT_DEPTH,
  NEAR_SINGULAR_SIGMA,
  NEAR_ZERO_FOLD_WEIGHT,
  PROBE_POINTS,
  PROBE_SEED,
  RADIUS_PAD,
  SURFACE_FOLD_BEAM_WIDTH,
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_MANDELBOX,
  SURFACE_FOLD_NONE,
  SURFACE_FOLD_SPHEREFOLD,
  SURFACE_CHAOS_WILDCARD,
  buildSurfaceChaosDE,
  surfaceChaosAllows,
  surfaceFoldRadii,
} from "./surface-de";
import type {
  MapSigmas,
  SurfaceEligibilityStatus,
  SurfaceFoldKind,
  SurfaceFoldRadii,
  SurfaceChaosDE,
} from "./surface-de";
import { resolveFoldRadii, sphereFoldLipschitz } from "./variations";
import type {
  HybridSchedule,
  SymmetryParams,
  Transform,
  Transform4,
  Variation,
  Vec4,
} from "./types";
import { clamp } from "./vec";

/**
 * 4D surface distance estimation for an affine IFS — the feasibility
 * spike, `surface-de.ts`'s distance estimator (DE) carried one dimension up.
 * See that module's doc for the full validity argument and the KIFS-descent
 * picture it builds on; this doc covers only what changes (or does not)
 * crossing into 4D.
 *
 * VALIDITY TRANSFERS VERBATIM. The core inequality
 *
 *     dist(p, f(A)) >= sigma_min(M) * dist(f^-1(p), A)
 *
 * holds for an invertible linear map `M` in ANY dimension: the proof only
 * needs `sigma_min` to be the worst-case contraction `M` applies to any unit
 * direction, never the dimension of the space `M` acts on. So everything 3D
 * builds on top of it — the width-2 descent beam refining the
 * branches whose inverse images land nearest the origin, escaped-sibling
 * certificates folded in at every level, the terminal KIFS bound closing
 * off each descended chain — carries over unchanged.
 * {@link estimateDistance4} is a structural port of `estimateDistance`:
 * four coordinates instead of three, and nothing else different in shape.
 *
 * WHY THE SINGULAR VALUES NEED AN EIGEN-SOLVE HERE. 3D's `singularValues3`
 * is closed-form because the characteristic CUBIC of the symmetric `M^T M`
 * has a trigonometric solution (a Viete substitution collapses it to
 * `cos(acos(x)/3)`). The 4x4 case's characteristic polynomial is a quartic:
 * quartics do have a closed form (Ferrari's method), but it is a numerically
 * fragile tower of nested radicals with no analogue of the cubic's clean
 * trig substitution. {@link singularValues4} instead runs a deterministic
 * CYCLIC JACOBI eigen-solve on `M^T M` — repeatedly zero each off-diagonal
 * pair with a rotation, in the same fixed order every call, until the
 * off-diagonal energy is negligible. A FIXED sweep order (not "largest
 * pivot first", the classical variant) is what keeps it deterministic: a
 * given matrix always converges to bit-identical sigmas.
 *
 * WHAT THIS SPIKE DELIBERATELY LEAVES OUT.
 * - No kaleidoscope symmetry — at the time true of the whole 4D chaos-game
 *   pipeline by design. BOTH halves have SINCE landed: `chaos-game-4d.ts`
 *   grew its kaleidoscope (`postRotations`, copy-major slots `k*n + i`),
 *   and the 3D tracer's sector sweep was lifted up here —
 *   see the SYMMETRY section below. {@link SurfaceDE4.maps} STAYS the input
 *   maps 1:1 at any order, exactly like 3D's swept `SurfaceDEMap[]`.
 * - The final-transform lens is no longer on this list. It was originally
 *   deferred here as 3D's `SurfaceDE.final` "waiting to happen" until this
 *   spike's verdict landed; it has SINCE landed (post-verdict), a
 *   straight port one dimension up — {@link SurfaceDE4.final}, matching
 *   `analyzeSurfaceSystem4`/`buildSurfaceDE4` bookkeeping, and the lens
 *   prologue/epilogue {@link estimateDistance4} and
 *   {@link estimateDistance4Refined} apply in lockstep.
 * - Folds are no longer on this list either: the fold-branch
 *   sweep — 3D's pure-fold base maps and its fold FINAL lens —
 *   is ported one dimension up. The validity argument transfers verbatim
 *   (each fold branch is affine-or-conformal in ANY dimension;
 *   `V(Y) = ∪_c B_c(Y ∩ cell_c)` and unconditional branch enumeration keep
 *   the estimate a lower bound); the only structural charge is the branch
 *   fan — the boxfold folds FOUR axes, so 27 -> 81 and the mandelbox
 *   81 -> 243 ({@link foldBranchCount4}), while the spherefold stays 3
 *   (radial structure is dimension-free). `variations4.ts` folds `w`
 *   exactly like every spatial axis, so no new fold math exists — the maps
 *   are the same three families the 4D chaos game already iterates.
 *
 * SLAB × FOLD (the one place the slab query and the fold sweep interact).
 * The slab query's segment threading rests on "affine maps take segments
 * to segments". Boxfold branch inverses are per-axis reflections ±
 * translation (linear part diag(±1)) — affine, so a boxfold-only system
 * keeps exact slab queries with the segment machinery untouched. The
 * spherefold MID branch is an inversion: it takes a segment to a circular
 * ARC, and bounding the arc by its chord is unsound in BOTH directions —
 * so systems whose fold set includes spherefold or mandelbox REFUSE
 * `halfExtent` queries outright ({@link slabExact4}; the public estimators
 * throw, and the app clamps sliceHalfW to 0 for such sessions). Refusal
 * over degradation is deliberate: `h` defaults to 0, folds are the
 * feature, and a silently inflated "slab" would be exactly the kind of
 * wrong image this project never ships. The segment+ball-slack chain state
 * that would admit spherefold slabs (inversion maps balls to balls
 * exactly) is recorded on {@link slabExact4} — MEASURED and not built
 * (`scripts/slab-ball-slack.harness.ts`): its advantage lives exactly
 * where it is not needed. See that constant's doc.
 *
 * THE SLICE CAVEAT — why this spike exists in the first place. The app would
 * never march the full 4D attractor `A` for display; it marches a `w = w0`
 * SLICE. The visible slice `A ∩ {w = w0}` is a SUBSET of `A`, and distance to
 * a subset can only be greater-or-equal to distance to the superset, so for
 * a query `(p, w0)`:
 *
 *     dist4((p, w0), A) <= dist3(p, A ∩ {w = w0})
 *
 * A certified 4D DE (which never overshoots `dist4(·, A)`, by the validity
 * argument above) is therefore ALSO a certified lower bound on distance to
 * the slice — safe to march the slice with. What it does NOT promise is
 * TIGHTNESS: near off-slice structure (part of `A` close in 4D but not on
 * the `w = w0` slice), the bound can fall well short of the true slice
 * distance, stalling the march or reading as ghostly, oversized bulges in
 * the rendered surface. Measuring exactly how loose — is the gap small
 * enough for a real render, or does it need slice-aware tightening — is the
 * experiment this module exists to support; the verdict below
 * answers the GO/NO-GO half, and HOW LOOSE, MEASURED below that
 * answers the tightness half — measured at ~10%, and flat in `w0`.
 *
 * SPIKE VERDICT (measured 2026-07): GO for a slice-mode render.
 * {@link estimateDistance4}'s validity held on every conformal, >=3-map
 * preset measured (pentatope, sixteenCellFlake, tesseract): 0 violations
 * across 2100 queries (700 each — jittered/uniform/exact). But the slice
 * march itself was dominated by ghosts on those same three systems: measured
 * ghost-of-marcher-hits ran 53.5-84.6% on pentatope's two measured slices,
 * 13.7% on tesseract, 4.7% on sixteenCellFlake — and every measured ghost
 * point traced to ONE mechanism: 100% attributed to a shallow, barely-
 * escaped sibling certificate (median recording depth 0-1 of a 14-level
 * cap), never to the terminal bound or the depth-0 sphere floor. Shrinking
 * the march hit-epsilon 4x (0.01R -> 0.0025R) barely moved it (pentatope's
 * two slices: 53.5%/84.6% -> 50.0%/83.3%) — a bound-tightness problem, not a
 * march-discretization one. {@link estimateDistance4Refined} — one extra
 * Hutchinson level applied to exactly that certificate — measurably
 * ELIMINATES it: 0.0% ghost-of-hits on every slice measured across all
 * three systems, slice DE/d3 median tightness improves from 0.48-0.59 to
 * 0.68-0.73 (pentatope), slice-tightness stalling drops to exactly 0%, and
 * base validity is preserved (0 violations, unchanged). Measured exclusion:
 * doubleRotation-profile systems (2 maps, 6:1 selection weight, sigma
 * 0.93/0.22) overshoot `dist4(., A)` via a DIFFERENT mechanism — greedy
 * BRANCH-SELECTION risk inherited from 3D `estimateDistance` (confirmed
 * reproduced on the shipped, unmodified 3D module during this spike) —
 * which the certificate refinement never touches: its violations measurably
 * WORSEN under refinement (39 -> 49 over the same 700-query mix) and its
 * march stays majority-ghost even refined (91.5% -> 52.9% of hits). An
 * eligibility-side guard for that profile was the planned follow-up;
 * the paragraph below is what landed instead.
 *
 * THAT EXCLUSION'S RESOLUTION (measured 2026-07, after the verdict above):
 * the exclusion is repaired — not by an eligibility guard but by the
 * width-2 descent BEAM both estimators now run (see `estimateDistance` in
 * the 3D twin for the mechanics): the second chain refines the
 * second-nearest in-sphere branch instead of dropping it, which is exactly
 * the branch-selection risk doubleRotation exposed. Measured on the beam
 * harness (`scripts/surface-beam.harness.ts`): doubleRotation's
 * jittered/uniform violations drop to 0 for BOTH estimators (max excess
 * 19.4%R base / 20.8%R refined -> fp-noise ~3e-8), and the refined
 * estimator's void-false-hit proxy reads 0/514 — the march-ghost mechanism
 * and the overshoot mechanism are both closed, at ~1.5x
 * inverse-application cost on this system. Residual, disclosed with it: 3+
 * simultaneous in-sphere branches still drop (m >= 3 slow-map systems,
 * sigma_max >= 0.96, and kaleidoscope-tied copies in 3D) at ~2-5%R.
 *
 * HOW LOOSE, MEASURED — the SLICE CAVEAT's own closing question,
 * answered. "Is the gap small enough for a real render, or does it need
 * slice-aware tightening" was left open by the spike and is settled here
 * against a chaos-game GROUND TRUTH rather than against another bound. The
 * quantity is the slice PENALTY
 *
 *     dist4((p, w0), A) / dist3(p, A ∩ slab)
 *
 * — the caveat with the estimator's own conservativeness divided out — and on
 * BOTH of the app's affine 4D scenes it sits at 0.82-0.94 at the median and
 * DOES NOT degrade as `w0` moves off centre (`plain4` 0.91 at `w0 = 0`, 0.94
 * at `0.3R`; `kaleido4` 0.94 and 0.88; p10 0.58-0.83 throughout, and
 * shrinking the ground-truth slab 4x moves the medians by at most 0.03). The
 * 4D structure nearest a point in a slice is, at the median, structure that
 * slice itself cuts. The estimator's OWN conservativeness is three times
 * larger and just as flat: `DE / dist4` reads 0.66-0.72 on both scenes.
 *
 * SO SLICE-AWARE CERTIFICATES ARE A WON'T-DO, not an unbuilt idea. They
 * were written and measured: each chain carries the pulled-back slice
 * normal beside its point (a plane's normal moves by `M^T` where its
 * points move by `inv(M)`), a branch whose bounding ball cannot reach the
 * marched slab is DROPPED — it holds no part of the drawn set — and the
 * rest price against the disc the slab cuts rather than the whole ball,
 * `sqrt(r^2 - dHi^2) - sqrt(R^2 - dLo^2)`, whose depth-0 instance IS the
 * tracer's own `sliceVisR`. Sound (pinned against slab members of a
 * chaos-game cloud, final-transform lens and twisted kaleidoscope
 * included) and not worth it: ~10% fewer march steps for 1.4-2.2x the work
 * per evaluation, on top of a caveat worth ~10%. The measurement lives in
 * `scripts/slice-cost.harness.ts`, and the app-level half — the 20-40x
 * cost cliff that motivated the whole thing, and which does not reproduce
 * on either engine — in `scripts/slice-cliff.probe.mjs`.
 *
 * SLAB QUERIES. The SLICE CAVEAT above marches a zero-thickness
 * hyperplane: the query is the single 4D point `(p, w0)`, so the rendered
 * object is the cross-section `A ∩ {w = w0}`. Both estimators now take an
 * optional half-extent `e` that turns the query into the SEGMENT
 * `S = {(p, w0) + s·e : s ∈ [-1, 1]}`, and with `e` the slab's w-direction
 * scaled by a half-thickness `h`, `S` is exactly the part of the slab
 * `{|w - w0| <= h}` sitting over `p`. The contract generalizes term for term:
 *
 *     dist4(S, A) <= dist3(p, proj(A ∩ slab))
 *
 * with the zero sets EQUAL — `S` meets `A` exactly where `p` lies in the
 * slab's shadow — so a certified lower bound on `dist4(S, A)` is a certified
 * lower bound for marching that shadow, the same "conservative bound, exact
 * zero set" the `h = 0` instance already had, just looser. Nothing new can go
 * unsound.
 *
 * Every piece of the descent carries over because AFFINE MAPS TAKE SEGMENTS
 * TO SEGMENTS. The core inequality holds for a SET query verbatim —
 * `dist(S, f(A)) >= sigma_min(M) · dist(f^-1(S), A)`, since every `s ∈ S` has
 * `|s - f(a)| = |M(f^-1(s) - a)| >= sigma_min · dist(f^-1(S), A)` — and
 * `f^-1(S)` is the segment centred at `f^-1(q)` with half-extent `M^-1 e`.
 * So the descent carries one extra 4-vector alongside each chain's and
 * candidate's point, transformed by the inverse map's LINEAR part alone, and
 * every `|q| - R` ball certificate becomes {@link segmentRadius}` - R`. The
 * beam, the validity slots, the spike's refined certificates, the
 * terminal KIFS bound, the depth-0 sphere floor, the final-transform lens and
 * both early exits are structurally untouched.
 *
 * HOW MUCH THE BOUND CAN LOSE. `e` GROWS down the descent (inverse maps
 * expand), but only as fast as the chain's contraction shrinks:
 * `|e_chain| <= h / chainScale`, so `chainScale · |e_chain| <= h` at every
 * level. A slab certificate therefore sits within `h` of the point
 * certificate it replaces — the trivial `dist(S, A) >= dist(q, A) - h` bound,
 * recovered level by level. (That trivial bound is also why `min` over N
 * discrete `w` samples is NOT what this does: subtracting `h` outright is
 * valid and needs no new math, but it fattens the zero set ISOTROPICALLY —
 * dilating the rendered object in x/y/z too — where the segment fattens it in
 * `w` alone, which is the whole point.)
 *
 * SYMMETRY: THE SECTOR SWEEP, ONE DIMENSION UP. A 4D kaleidoscope
 * of order `n` replicates every base map into `n` copies
 * `g_k . f_i`, `g_k` the rotation for copy `k` applied AFTER the base map —
 * `chaos-game-4d.ts`'s `postRotations`, built by `affine4.ts`'s
 * `symmetryRotation4(plane, 2πk/n, twist)`: a rotation in a PLANE, plus an
 * optional `twist` turning the COMPLEMENT plane in lockstep (a double
 * rotation, which has no 3D counterpart). The DE never materialises those
 * copies: exactly like 3D's own repacking, {@link SurfaceDE4.maps} holds
 * the base inverses only and the descent walks the `n` sectors by turning
 * each chain point ONE step backward per sector — `inv(M_i) . g_k^T . q`
 * re-associated as `inv(M_i) . (g_k^T . q)` — enumerated sector-major
 * (sector `k` outer, base map `i` inner), the expansion's own `k*n + i` slot
 * order, so the insert-shift ladders break ties identically and the beam,
 * the validity slots, the refined certificates and the cutoff exits
 * see an unchanged candidate stream. The validity argument (and the whole
 * WHY-NOT-THE-KIFS-FOLD case against folding the query into one wedge — a
 * fold minimises over a SUBSET of group elements and can only come out too
 * HIGH) is `surface-de.ts`'s symmetry section verbatim; every word of it is
 * dimension-independent. Order 1 skips the rotation entirely, so every
 * non-kaleidoscope system stays bit-for-bit on its old numbers.
 *
 * Two places the lift is NOT a blind mirror of the 3D code:
 *
 * - ONE MATRIX, NOT A (cos, sin) PAIR. 3D's backward step rides a single
 *   (cos, sin) pair because transposing a single-plane rotation flips the
 *   sign of sin alone. A double rotation carries TWO angles, so
 *   {@link SurfaceSymmetry4.stepBack} is the whole 4x4 backward step: the
 *   TRANSPOSE of the same `symmetryRotation4` call the chaos game rotates
 *   copy 1 by (the generator is orthogonal, so its transpose is its exact
 *   inverse, bit-derived from the same entries) — which also means the
 *   PLANE_SIGN convention buried in that call is inherited rather than
 *   re-derived. Under a slab query the carried half-extent takes the same
 *   multiply per sector: an isometry maps segments to segments, so the swept
 *   segment is `{g_k^T q + s · g_k^T e}`.
 *
 * - THE FIXED SUBSPACE. 3D projects its probe-fit ball centre onto the
 *   rotation AXIS — the group-fixed subspace — so one centred ball serves
 *   every sector. In 4D the cyclic group's fixed subspace is the fixed
 *   subspace of the GENERATOR: at `twist = 0` the COMPLEMENT plane of the
 *   rotation plane (projection = zero the two in-plane coordinates), and at
 *   `twist != 0` the ORIGIN alone — both angles are nonzero multiples of
 *   `2π/order` strictly inside `(0, 2π)`, so neither block of the generator
 *   fixes a direction. This module's bounding ball is ORIGIN-anchored by
 *   construction (3D's probe-fit centred ball was never ported up), and the
 *   origin is fixed by EVERY generator, twist included, so the ball is
 *   sector-invariant for free and there is nothing to project — see the
 *   comment in {@link buildSurfaceDE4} for what a future centred-ball port
 *   must do instead of copying 3D's in-plane zeroing. The same
 *   norm-invariance (`|g^T q| = |q|` for any orthogonal `g` fixing the
 *   origin) is why every origin-anchored gate — the depth-0 sphere bound,
 *   the escape test, the tracer's visible-ball gate (its slab form
 *   `max(0, |w0| - h)` included) — needs no per-sector adjustment, the very
 *   fact 3D's fold frontier leans on for its `chainNormSq` hoist
 *   (no fold frontier exists here for the hoist itself to land in).
 */

/** Fixed sweep order for {@link singularValues4}'s cyclic Jacobi: the six
 * off-diagonal pairs of a symmetric 4x4, visited in the same order every
 * call — what makes the eigen-solve deterministic, unlike the "largest
 * pivot first" classical Jacobi variant. */
const JACOBI_PAIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];

/** Sweep cap for {@link singularValues4} — generous headroom over the
 * handful of sweeps a well-conditioned 4x4 typically needs to converge. */
const JACOBI_MAX_SWEEPS = 32;

/**
 * Zero the `(p, q)` off-diagonal entry of symmetric `a` (a row-major 4x4, 16
 * entries) with a Jacobi rotation, updating `a` in place. The standard
 * classical Jacobi eigenvalue step (Golub & Van Loan): `tau` measures how
 * lopsided the 2x2 sub-block `[[a_pp, a_pq], [a_pq, a_qq]]` already is, `t`
 * is the rotation's tangent chosen to exactly cancel `a_pq` (the smaller
 * root of its defining quadratic, for numerical stability), and `c`/`s` are
 * its cosine/sine. A no-op when `a_pq` is already exactly 0 — the common
 * case once a matrix is mostly diagonalized, and always true for the
 * untouched w-block of a 3D map's block-diagonal 4D lift (see the test
 * suite's cross-check against `singularValues3`).
 */
function zeroJacobiPair(a: number[], p: number, q: number): void {
  const apq = a[p * 4 + q];
  if (apq === 0) return;
  const app = a[p * 4 + p];
  const aqq = a[q * 4 + q];
  const tau = (aqq - app) / (2 * apq);
  const t =
    tau === 0 ? 1 : Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
  const c = 1 / Math.sqrt(1 + t * t);
  const s = t * c;

  // Full similarity update: every OTHER row r mixes its (p, q) entries by
  // (c, s); writing both a[r][p]/a[p][r] (and the q twin) together keeps A
  // symmetric throughout.
  for (let r = 0; r < 4; r++) {
    if (r === p || r === q) continue;
    const arp = a[r * 4 + p];
    const arq = a[r * 4 + q];
    const rotP = c * arp - s * arq;
    const rotQ = s * arp + c * arq;
    a[r * 4 + p] = rotP;
    a[p * 4 + r] = rotP;
    a[r * 4 + q] = rotQ;
    a[q * 4 + r] = rotQ;
  }
  a[p * 4 + p] = app - t * apq;
  a[q * 4 + q] = aqq + t * apq;
  a[p * 4 + q] = 0;
  a[q * 4 + p] = 0;
}

/** Frobenius norm of `a`'s six off-diagonal entries (each counted twice, for
 * its mirrored symmetric partner) — {@link singularValues4}'s convergence
 * signal: near 0 once every {@link JACOBI_PAIRS} rotation has become a
 * no-op. */
function offDiagonalNorm(a: number[]): number {
  let sumSq = 0;
  for (const [p, q] of JACOBI_PAIRS) {
    const v = a[p * 4 + q];
    sumSq += 2 * v * v;
  }
  return Math.sqrt(sumSq);
}

/**
 * Cyclic-Jacobi singular values of a row-major 4x4 `m`: the square roots of
 * the extreme eigenvalues of the symmetric `A = M^T M`, found by repeatedly
 * sweeping {@link JACOBI_PAIRS} in the same fixed order and zeroing each
 * with {@link zeroJacobiPair}, until the off-diagonal energy is negligible
 * (or {@link JACOBI_MAX_SWEEPS} sweeps run out) — see the module doc for why
 * a 4x4 needs this where 3D's `singularValues3` has a closed form.
 * Deterministic: the sweep order never depends on the data, so a given
 * matrix always converges to bit-identical output.
 */
export function singularValues4(m: number[]): MapSigmas {
  // A = M^T M: a[i*4+j] = sum_k m[k*4+i] * m[k*4+j] (M^T's row i is M's
  // column i).
  const a = new Array<number>(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += m[k * 4 + i] * m[k * 4 + j];
      a[i * 4 + j] = sum;
    }
  }

  // Trace is invariant under every rotation below (each is an orthogonal
  // similarity transform), so the convergence tolerance can be fixed once,
  // up front, rather than recomputed per sweep.
  const traceMag = Math.abs(a[0] + a[5] + a[10] + a[15]);
  const tolerance = 1e-14 * (1 + traceMag);

  for (let sweep = 0; sweep < JACOBI_MAX_SWEEPS; sweep++) {
    for (const [p, q] of JACOBI_PAIRS) zeroJacobiPair(a, p, q);
    if (offDiagonalNorm(a) <= tolerance) break;
  }

  const e0 = a[0];
  const e1 = a[5];
  const e2 = a[10];
  const e3 = a[15];
  const minEig = Math.min(e0, e1, e2, e3);
  const maxEig = Math.max(e0, e1, e2, e3);
  return {
    min: Math.sqrt(Math.max(0, minEig)),
    max: Math.sqrt(Math.max(0, maxEig)),
  };
}

/**
 * Singular values of a lifted transform's 4x4 linear part. Mirrors 3D's
 * `transformSigmas`: without shear, `M = R · diag(scale)` with `R`
 * orthogonal, so the singular values are exactly `|scale|`'s extremes — no
 * eigen-solve needed. With shear, `M` is no longer orthogonal-times-diagonal
 * and {@link singularValues4} on the fully composed matrix is the only way.
 */
export function transformSigmas4(t: Transform4): MapSigmas {
  const { shear } = t;
  const sheared =
    shear !== undefined &&
    ((shear.xy ?? 0) !== 0 ||
      (shear.xz ?? 0) !== 0 ||
      (shear.yz ?? 0) !== 0 ||
      (shear.xw ?? 0) !== 0 ||
      (shear.yw ?? 0) !== 0 ||
      (shear.zw ?? 0) !== 0);
  if (!sheared) {
    const s0 = Math.abs(t.scale[0]);
    const s1 = Math.abs(t.scale[1]);
    const s2 = Math.abs(t.scale[2]);
    const s3 = Math.abs(t.scale[3]);
    return {
      min: Math.min(s0, s1, s2, s3),
      max: Math.max(s0, s1, s2, s3),
    };
  }
  return singularValues4(composeAffine4(t).m);
}

/** Mirrors `composeVariations`' active filter exactly (copied from
 * `surface-de.ts`, which cannot export a private helper): a variation entry
 * only warps space when its weight is finite and nonzero. `Transform` and
 * `Transform4` share the exact same `variations?: Variation[]` shape, but
 * this is only ever called on the INPUT `Transform`s here (never the lifted
 * `Transform4`s) — reasons are reported against what the caller authored,
 * mirroring 3D's `analyzeSurfaceSystem`. */
function hasActiveVariations(t: Transform): boolean {
  return (
    t.variations?.some((v) => Number.isFinite(v.weight) && v.weight !== 0) ??
    false
  );
}

/** `transform.weight ?? 1 > 0` — copied from `surface-de.ts` for the same
 * reason as {@link hasActiveVariations}. */
function isActive(t: Transform): boolean {
  return (t.weight ?? 1) > 0;
}

/** The fold family the 4D descent can sweep (`surface-de.ts`'s own set,
 * which cannot export a private const). `variations4.ts` folds
 * `w` exactly like every spatial axis, so the family is the same three. */
const FOLD_VARIATION_TYPES = new Set(["boxfold", "spherefold", "mandelbox"]);

/** The single fold-family entry of a PURE-FOLD map — copied from
 * `surface-de.ts` (private there) for {@link hasActiveVariations}' reason.
 * Blended lists are excluded: a weighted SUM has no branch decomposition
 * (see the 3D module doc's fold-branch sweep argument, which transfers
 * dimension-free — each fold branch is affine-or-conformal in any
 * dimension). */
function pureFoldVariation(t: Transform): Variation | null {
  const active = (t.variations ?? []).filter(
    (v) => Number.isFinite(v.weight) && v.weight !== 0,
  );
  if (active.length !== 1) return null;
  const v = active[0];
  return FOLD_VARIATION_TYPES.has(v.type) ? v : null;
}

/** Forward Lipschitz bound of a pure-fold variation, weight folded in —
 * copied from `surface-de.ts`. The constants are dimension-free: a boxfold
 * branch is a reflection isometry per axis (L = 1) in any dimension at any
 * `boxLimit`, and the spherefold's magnification `fR²/mR²`
 * ({@link sphereFoldLipschitz}) is the same radial statement whatever the
 * ambient dimension — so the fold's own radii move the contraction gate
 * with them exactly as in 3D. */
function foldLipschitz(v: Variation): number {
  return (
    Math.abs(v.weight) *
    (v.type === "boxfold" ? 1 : sphereFoldLipschitz(resolveFoldRadii(v)))
  );
}

/** Forward value of an admitted pure fold, including its authored weight. */
function applyPureFold4(
  fold: Variation,
  x: number,
  y: number,
  z: number,
  w: number,
): Vec4 {
  const radii = resolveFoldRadii(fold);
  const wall = radii.boxLimit;
  const axis = (value: number) => 2 * clamp(value, -wall, wall) - value;
  let fx = x;
  let fy = y;
  let fz = z;
  let fw = w;
  if (fold.type === "boxfold" || fold.type === "mandelbox") {
    fx = axis(fx);
    fy = axis(fy);
    fz = axis(fz);
    fw = axis(fw);
  }
  if (fold.type === "spherefold" || fold.type === "mandelbox") {
    const minR2 = radii.minRadius * radii.minRadius;
    const fixedR2 = radii.fixedRadius * radii.fixedRadius;
    const factor =
      fixedR2 / clamp(fx * fx + fy * fy + fz * fz + fw * fw, minR2, fixedR2);
    fx *= factor;
    fy *= factor;
    fz *= factor;
    fw *= factor;
  }
  return [
    fold.weight * fx,
    fold.weight * fy,
    fold.weight * fz,
    fold.weight * fw,
  ];
}

/** Fold-branch fan per map application — 3D's `foldBranchCount` ONE
 * DIMENSION UP: the boxfold folds four axes, so its per-axis three-way
 * preimage choice fans 3^4 = 81 (3D: 27), the spherefold stays 3 (its
 * branches are radial — outer identity / inner ×4 / mid inversion — and
 * radial structure is dimension-free), and the mandelbox chains the two
 * into 3 · 81 = 243 (encoded `b = boxIndex + 81 · sphereIndex`, the 3D
 * `b = boxIndex + 27 · sphereIndex` convention re-based). */
export function foldBranchCount4(kind: SurfaceFoldKind): number {
  return kind === SURFACE_FOLD_NONE
    ? 1
    : kind === SURFACE_FOLD_BOXFOLD
      ? 81
      : kind === SURFACE_FOLD_SPHEREFOLD
        ? 3
        : 243;
}

/** True when any base map carries a fold — the 4D twin of `deHasFolds`,
 * and the routing key that sends a system to `descendFold4` (the frontier
 * body) instead of the unrolled affine ladder. */
export function deHasFolds4(de: SurfaceDE4): boolean {
  return de.maps.some((m) => m.foldKind !== SURFACE_FOLD_NONE);
}

/** True when the DOCUMENT is fold-shaped for a 4D surface session — any
 * ACTIVE pure-fold base map or a pure-fold final — WITHOUT building the DE
 * at all: the eligibility gate consults this per edit, and a
 * fold-shaped 4D system renders ONLY on the WebGPU compute path (the
 * fragment 4D tracer carries no fold GLSL — deliberately: the 3D fold GLSL
 * already sits at Mesa's link cliff, and a 243-branch 4D body there would
 * be unshippable), so the gate refuses it with a disclosure when compute
 * is unavailable rather than letting a fold-blind tracer render the wrong
 * object. Derived from transforms, never stored — the house predicate
 * discipline. */
export function systemFoldShaped4(
  transforms: Transform[],
  finalTransform: Transform | null,
): boolean {
  return (
    transforms.some((t) => isActive(t) && pureFoldVariation(t) !== null) ||
    (finalTransform !== null && pureFoldVariation(finalTransform) !== null)
  );
}

/** True when every fold branch in the system (base maps AND a fold final
 * lens) is AFFINE — i.e. the fold set is at most {boxfold} — and there is
 * no condensation shape, so the
 * slab query's segment threading stays exact (affine maps take
 * segments to segments; a boxfold branch inverse is a per-axis reflection
 * ± translation). The spherefold MID branch is an inversion, which takes a
 * segment to a circular ARC: min-radius-over-chord and min-radius-over-arc
 * differ in BOTH directions, so a segment certificate there is unsound —
 * not merely loose — and slab queries are REFUSED for any system whose
 * fold set includes spherefold or mandelbox ({@link estimateDistance4} /
 * {@link estimateDistance4Refined} throw; the app clamps sliceHalfW to 0
 * for such sessions instead of degrading into a silently wrong image).
 * Condensation also refuses a nonzero segment: the 4D C0 term is defined for
 * the point query as a transformed 3D solid at local w=0; minimizing that
 * shaped term over a carried segment needs a separate exact set-distance
 * evaluator. Refusal keeps the point and cloud geometries aligned.
 *
 * THE REFUSAL IS NOW MEASURED RATHER THAN MERELY REASONED
 * (`scripts/slab-ball-slack.harness.ts`), and BOTH candidate lifts lost.
 *
 * The cheap one — `max(0, DE(p) − h)` over the point estimator, sound by
 * the triangle inequality alone — DOES NOT RENDER A SLAB. It is a
 * DILATION: on `sixteenCellFlake` it degrades from the exact slab's crisp
 * fractal to a featureless ball by the slider's own ceiling (44.4% of rays
 * at 0.0 steps/px — every ray hits on entry). On two of the four controls
 * it lands FURTHER from the exact slab than doing nothing at all, and in
 * marched depth the point query beats it on all four (mean |dt| 16.9-68.8%
 * of the marching ball against 0.8-15.2%): it floats the whole surface
 * toward the camera rather than adding a rind. As a bound it overcharges
 * by one to two orders of magnitude, and the mechanism is
 * DIRECTION-BLINDNESS — the segment reaches only in `w`, a ball has to
 * assume every direction, so a true slab costs the bound 0.3-15% where
 * the ball costs 29-100%. Soundness settles nothing: 0 violations in 9600
 * checks, for BOTH forms.
 *
 * The finer one — the spherefold's outer (identity) and inner (×4)
 * branches ARE linear, so a segment+ball-slack chain state (enclose the
 * segment in a ball at each mid-branch crossing, inversion maps balls to
 * balls exactly — `inversion.ts`'s `inversionBallScale`, which shipped
 * with this verdict — degrade the slack by sigma_max per subsequent map)
 * would admit spherefold slabs at the cost of one extra scalar per chain
 * tuple — CANNOT BE JUSTIFIED FROM OUTSIDE THE DESCENT. The two arms
 * above BRACKET it: the exact segment IS that design with no mid crossing
 * ever, the ball form IS it with the crossing at depth 0. Its ceiling is
 * excellent and is reached only where no crossing happens — i.e. on the
 * systems that already have the exact slab. Every system the lift is FOR
 * crosses the mid branch, and each crossing drops it toward the ball
 * form.
 *
 * WHAT WOULD REOPEN IT, both cheap next to the frontier register the lift
 * would cost: an instrument reporting the DEPTH of the first mid crossing
 * per query (`FoldFrontierTap4` reports candidates but not branch
 * indices), which decides where inside the bracket a real system falls;
 * or a per-system thickness CAP, since the ball form tracks the exact slab
 * wherever `h / DE` stays small and that ratio is knowable from a cheap
 * CPU probe before any render. */
export function slabExact4(de: SurfaceDE4): boolean {
  return (
    de.condensation === undefined &&
    de.maps.every(
      (m) =>
        m.foldKind === SURFACE_FOLD_NONE || m.foldKind === SURFACE_FOLD_BOXFOLD,
    ) &&
    (de.foldFinal === null || de.foldFinal.foldKind === SURFACE_FOLD_BOXFOLD)
  );
}

/** `prepareChaosGame4`'s no-symmetry default, duplicated here because it is
 * private there (exactly `surface-de.ts`'s `NO_SYMMETRY` situation); order 1
 * is the identity expansion for any plane and any twist. */
const NO_SYMMETRY4: SymmetryParams = { order: 1, plane: "xz" };

/** What {@link analyzeSurfaceSystem4} feeds the 4D DE build. Same shape as
 * 3D's `SurfaceEligibility` — final-transform bookkeeping included (see
 * {@link analyzeSurfaceSystem4}'s doc for the one place its gate
 * deliberately diverges from 3D's). */
export interface SurfaceEligibility4 {
  /** See 3D's `SurfaceEligibility.status`. */
  status: SurfaceEligibilityStatus;
  /** Human-readable blockers; non-empty exactly when `ineligible`. */
  reasons: string[];
  /** Worst per-map `sigma_max / sigma_min` over active maps, `1` = perfectly
   * conformal. */
  anisotropy: number;
  /** Suggested march step multiplier in (0, 1]; meaningful only when not
   * `ineligible`. */
  stepScale: number;
  /** Sigmas of the LIFTED (`toTransform4`) maps, indexed like `transforms`. */
  sigmas: MapSigmas[];
}

/** One origin-centred global-depth bound in a scheduled 4D descent. */
export interface SurfaceLevelBound4 {
  radius: number;
  escapeRadius: number;
}

/**
 * Classify a system for a 4D surface render mode. Mirrors 3D's
 * `analyzeSurfaceSystem` — the pure-fold base-map carve-out and the pure-fold
 * FINAL included (exactly one active fold-family variation is admitted per
 * map with the composite `|w|·L_V·sigma_max` contraction bound and the
 * NEAR_ZERO_FOLD_WEIGHT floor; blends refuse; the fold FINAL needs only the
 * weight floor) — with two deliberate differences: every transform is lifted
 * with `toTransform4` before its sigmas are measured (so a map's `w`
 * extension is what gets checked for contraction, not ignored — fold maps
 * included: their composite bound prices the lifted sigma), and there is no
 * `isFlatTransform` gate — a system extending into 4D is the entire point of
 * this module, not a disqualifier. Weight-0 maps are still ignored (never
 * selected, so they add nothing to the attractor). Symmetry never affects
 * eligibility — kaleidoscope copies are rotations of maps already analyzed
 * (the 3D `analyzeSurfaceSystem` stance, twist included: a double rotation is
 * still an isometry).
 *
 * The optional `finalTransform` mirrors 3D's final-transform gate (blended
 * variations disqualify, near-zero scale disqualifies, anisotropy folds into
 * the reported worst case) with the SAME 4D-specific carve-out as the
 * per-map loop above: no `isFlatTransform` gate and no "extends into 4D"
 * reason for the final transform either — lifting the visible set out of
 * the `w = 0` slice via the final transform is exactly this module's point,
 * not a disqualifier.
 *
 * Eligibility says nothing about SLAB queries: the `halfExtent` is
 * VIEW state, not a system property, so the segment-soundness rule lives on
 * the built DE instead ({@link slabExact4} — boxfold-only fold sets keep
 * the slab, spherefold/mandelbox refuse it at the estimator entries).
 */
export function analyzeSurfaceSystem4(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  schedule: HybridSchedule | null = null,
): SurfaceEligibility4 {
  const reasons: string[] = [];
  const sigmas = transforms.map((t) => transformSigmas4(toTransform4(t)));
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
      // Surface consumes the emitter's SDF directly, so an intersection is
      // still a condensation shape even though point modes cannot sample it.
      // The reset event uses the lifted affine only and is not iterated.
      if (sigmas[i].min < NEAR_SINGULAR_SIGMA) {
        reasons.push(`${label} emitter is nearly flat (scale ≈ 0)`);
      }
      return;
    }
    // Pure-fold maps (exactly one active fold-family variation) descend via
    // the fold-branch sweep (3D's carve-out one dimension
    // up); every other active variation list has no tractable inverse and
    // gates the mode out.
    const fold = pureFoldVariation(t);
    if (!fold && hasActiveVariations(t)) {
      reasons.push(`${label} uses variations`);
    }
    // The composite gate below cannot catch w ≈ 0 — a smaller weight only
    // ever helps contraction — but the descent divides by w. See
    // NEAR_ZERO_FOLD_WEIGHT (surface-de.ts).
    if (fold && Math.abs(fold.weight) < NEAR_ZERO_FOLD_WEIGHT) {
      reasons.push(`${label} fold weight ≈ 0`);
    }
    const s = sigmas[i];
    // A pure-fold map iterates w·V(Mp + t), so contraction is gated on the
    // composite Lipschitz bound |w|·L_V·sigma_max — the affine part alone
    // may even expand when the fold weight compensates. Invertibility
    // (near-flat) stays on M: every fold branch descends through inv(M).
    // The sigmas here are the LIFTED map's, so a `w` extension is priced
    // into the same composite exactly as it is into the affine-only gate.
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
    // A pure-fold FINAL is eligible (3D's lens one dimension up): the lens is
    // applied ONCE to the query point, so its fold expands into one round of
    // branch root descents with no contraction requirement (an un-iterated
    // map needs none, exactly like the affine lens). Blended final variation
    // lists stay out for the iterated maps' reason: a weighted sum has no
    // branch decomposition.
    const foldFinal = pureFoldVariation(finalTransform);
    if (!foldFinal && hasActiveVariations(finalTransform)) {
      reasons.push("final transform uses variations");
    }
    // The lens has no contraction gate at all, so the weight floor is the
    // ONLY thing standing between a hand-edited w ≈ 0 and the lens's 1/w
    // (see NEAR_ZERO_FOLD_WEIGHT).
    if (foldFinal && Math.abs(foldFinal.weight) < NEAR_ZERO_FOLD_WEIGHT) {
      reasons.push("final transform fold weight ≈ 0");
    }
    // Unlike the per-map loop's isFlatTransform check in 3D's
    // analyzeSurfaceSystem, there is no isFlatTransform gate and no "extends
    // into 4D" reason for the final transform here: a final transform
    // extending into 4D is fine — that is this module's entire point.
    const s = transformSigmas4(toTransform4(finalTransform));
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
      const s = transformSigmas4(toTransform4(t));
      if (s.min < NEAR_SINGULAR_SIGMA) {
        reasons.push(`schedule map ${i + 1} is nearly flat (scale ≈ 0)`);
      } else {
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

/**
 * Row-major 4x4 inverse via Gauss-Jordan elimination with partial pivoting
 * on an augmented `[M | I]` copy. Unlike 3D's `inverse3` (a closed-form
 * adjugate/determinant formula — cheap at 3x3, unwieldy at 4x4: the adjugate
 * of a 4x4 needs sixteen 3x3 cofactor determinants), Gauss-Jordan is the
 * practical choice one dimension up. Deterministic (fixed pivot-selection
 * rule, no randomness); the eligibility gate ({@link analyzeSurfaceSystem4})
 * guarantees every map this is called on has `sigma_min >=
 * NEAR_SINGULAR_SIGMA`, so the pivots this function selects are always well
 * clear of 0.
 */
function inverse4(m: number[]): number[] {
  // Augmented rows [M | I], mutated in place by the elimination below.
  const rows: number[][] = [];
  for (let r = 0; r < 4; r++) {
    const row = new Array<number>(8).fill(0);
    for (let c = 0; c < 4; c++) row[c] = m[r * 4 + c];
    row[4 + r] = 1;
    rows.push(row);
  }

  for (let col = 0; col < 4; col++) {
    // Partial pivot: swap in whichever remaining row has the largest
    // magnitude in this column, for numerical stability.
    let pivotRow = col;
    let pivotMag = Math.abs(rows[col][col]);
    for (let r = col + 1; r < 4; r++) {
      const mag = Math.abs(rows[r][col]);
      if (mag > pivotMag) {
        pivotMag = mag;
        pivotRow = r;
      }
    }
    if (pivotRow !== col) {
      const swap = rows[col];
      rows[col] = rows[pivotRow];
      rows[pivotRow] = swap;
    }

    const invPivot = 1 / rows[col][col];
    for (let c = 0; c < 8; c++) rows[col][c] *= invPivot;
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const factor = rows[r][col];
      if (factor === 0) continue;
      for (let c = 0; c < 8; c++) rows[r][c] -= factor * rows[col][c];
    }
  }

  const inv = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) inv[r * 4 + c] = rows[r][4 + c];
  }
  return inv;
}

/** Row-major 4x4 transpose — for an orthogonal matrix (every kaleidoscope
 * generator) this is the exact inverse, bit-derived from the same entries. */
function transpose4(m: number[]): number[] {
  // prettier-ignore
  return [
    m[0], m[4], m[8], m[12],
    m[1], m[5], m[9], m[13],
    m[2], m[6], m[10], m[14],
    m[3], m[7], m[11], m[15],
  ];
}

/**
 * One sector step of the kaleidoscope sweep: turn `(x, y, z, w)`
 * BACKWARD by one sector — multiply by {@link SurfaceSymmetry4.stepBack} —
 * writing into `out` so the descent's hot loop never allocates. The 4D twin
 * of `surface-de.ts`'s `stepSector`, except the step is one whole matrix
 * (a double rotation has two angles; see the stepBack doc), so the three
 * per-plane branches collapse into one branchless multiply. A slab query's
 * half-extent takes the same multiply via {@link applyLinear4} at the call
 * sites — an isometry maps segments to segments.
 */
function stepSector4(
  back: number[],
  x: number,
  y: number,
  z: number,
  w: number,
  out: number[],
): void {
  out[0] = back[0] * x + back[1] * y + back[2] * z + back[3] * w;
  out[1] = back[4] * x + back[5] * y + back[6] * z + back[7] * w;
  out[2] = back[8] * x + back[9] * y + back[10] * z + back[11] * w;
  out[3] = back[12] * x + back[13] * y + back[14] * z + back[15] * w;
}

/** One BASE (un-rotated) inverted map of the 4D DE — the direct analogue of
 * 3D's `SurfaceDEMap`. Kaleidoscope copies are not slots: the
 * descent sweeps sectors around these — see the module doc's SYMMETRY
 * section. */
export interface SurfaceDE4Map {
  /** Row-major 4x4 `inv(M_i)` — the base map's inverse linear part. The
   * sector sweep un-rotates the chain point (and, under a slab query, its
   * half-extent) by {@link SurfaceSymmetry4.stepBack} BEFORE applying this
   * (kaleidoscope copies rotate AFTER the base map, so their inverses
   * un-rotate first). */
  invM: number[];
  /** `-inv(M_i) . t_i`. */
  invT: Vec4;
  /** Smallest singular value of the FORWARD map — the certified contraction
   * factor multiplied into the running `dr` product. */
  sigmaMin: number;
  /** Which input transform this slot inverts — the index into the caller's
   * `transforms`, for per-transform coloring. The sector sweep
   * replaced what would have been a symmetry expansion, so this array stays
   * base-sized at any order and no two slots ever share a base map. */
  baseIndex: number;
  /** Compact graph-directed state; absent on chi-free and scheduled B maps. */
  stateIndex?: number;
  /** The slot's fold family (3D's fold fields one dimension
   * up), `SURFACE_FOLD_NONE` for a plain affine slot. A fold slot iterates
   * `w·V(Mp + t)`, so the descent expands its inverse into
   * {@link foldBranchCount4} branch preimages per application. */
  foldKind: SurfaceFoldKind;
  /** `1/w` of the fold variation (`1` when none) — the descent divides the
   * chain point by the weight before un-folding. */
  foldInvW: number;
  /** `|w| · sigmaMin` for a fold slot (`sigmaMin` when none) — the
   * certified per-branch contraction floor the chain scale multiplies. */
  foldSigma: number;
  /** The fold's authored lengths in branch-algebra form — the
   * classic set at foldKind `SURFACE_FOLD_NONE`, where nothing reads it.
   * Same field 3D's `SurfaceDEMap` carries. */
  foldRadii: SurfaceFoldRadii;
  /** Smallest singular value of `inv(M)` = `1 / sigma_max(M)` —
   * branch-and-bound stage-2 data (the sigma-form skip's constant). */
  invMSigmaMin: number;
  /** `|invT|` — stage-2's translation norm (origin-centered here:
   * this module never adopted 3D's probe-fit centred ball, so the stage-2
   * bounds price the plain `invT` forms — see the build's bounding-radius
   * comment for why a centred port must NOT mirror 3D blindly). */
  invTNorm: number;
  /** `invM^T · invT / |invT|` — the directional child-radius skip's
   * direction (zero vector when `invT` is zero). */
  bnbDir: Vec4;
}

/** The kaleidoscope the 4D descent sweeps instead of expanding — 3D's
 * `SurfaceSymmetry` one dimension up. */
export interface SurfaceSymmetry4 {
  /** Effective sector count — `effectiveSymmetryOrder` against the FULL
   * transform list, exactly as `prepareChaosGame4` clamps it. `1` = no
   * kaleidoscope, and the descent then skips sector rotation entirely. */
  order: number;
  /** Row-major 4x4 of ONE BACKWARD sector step: the TRANSPOSE of the forward
   * copy rotation `symmetryRotation4(plane, 2π/order, twist)` — the exact
   * call `prepareChaosGame4` rotates copy 1 by, so the PLANE_SIGN convention
   * rides in instead of being re-derived, and the transpose is the exact
   * inverse because the generator is orthogonal. One whole MATRIX where 3D
   * ships a `(cos, sin)` pair: transposing a single-plane rotation flips the
   * sign of sin alone, but a double rotation carries two angles, so the
   * matrix is the honest step. The descent walks sectors incrementally off
   * it — no per-sector transcendentals — and the GLSL mirror gets it as a
   * single `mat4` uniform. Only ~identity at order 1 (cos 2π rounds), so —
   * exactly as in 3D — the descent's order-1 short circuit is what actually
   * guarantees bit-identical non-kaleidoscope behavior, not these entries. */
  stepBack: number[];
}

/** Everything {@link estimateDistance4} needs, precomputed — the 4D
 * analogue of 3D's `SurfaceDE`, final-transform lens included
 * (post-verdict — see the module doc's landing note). */
export interface SurfaceDE4 {
  /** One inverse map per ACTIVE input transform (weight-0 maps contribute no
   * slot — they are never selected, so they add nothing to the attractor),
   * and kaleidoscope copies contribute none either: {@link symmetry} is
   * swept around every entry, so this array is base-sized at any
   * order. */
  maps: SurfaceDE4Map[];
  /** Reverse graph support, omitted for absent/all-one chi. */
  chaos?: SurfaceChaosDE;
  /** Finite B-prefix inverse maps and global-depth bounds. */
  schedule?: SurfaceScheduleDE4;
  /** Condensation set C0, omitted completely on emitter-free systems. */
  condensation?: CondensationDE4;
  /** Kaleidoscope sectors swept around every {@link maps} entry. */
  symmetry: SurfaceSymmetry4;
  /** Bounding-hypersphere radius of the RAW attractor (pre-final-transform),
   * probed by a seeded 4D chaos game and padded. */
  boundingRadius: number;
  /** Radius bounding the VISIBLE set `F(attractor)` — equals
   * `boundingRadius` when there is no final transform. */
  visibleBoundingRadius: number;
  /** Radial color band of the VISIBLE set: the seeded probe's 4D
   * bounds-center — final transform applied, so this is the PLOTTED set —
   * and the [minD, maxD] range of the probe points' distances from it: the
   * exact quantities `buildColors4`'s `"radius"` mode normalizes with. The
   * surface radius ramp maps this band onto [0, 1] so the full palette is
   * in play the way the cloud's is; the old `|q| / visibleBoundingRadius`
   * normalizer compressed every hit into the narrow sub-band
   * `[minD, maxD] / visR4` of the ramp — in 4D a slice's content spans a
   * thin radial shell of the whole ball, so entire frames rendered in one
   * near-uniform hue and read as "the palette is incorrect". Probe-seeded
   * attractor-frame constants: deterministic per system, invariant under
   * rotor spins and slice moves, so coloring still never swims as the pose
   * changes (the property the old denominator was chosen for). */
  radiusBand: { center: Vec4; minD: number; maxD: number };
  /** `ESCAPE_FACTOR * boundingRadius` — descent past this cannot help. */
  escapeRadius: number;
  /** Camera-independent p03/p97 calibration of the native rings/sheets
   * carriers. Derived from 256 evenly-strided points of the RAW seeded probe;
   * final lenses and the live rotor/slice never enter this compact wire. */
  patternCalibration: SurfaceNativeCalibration;
  /** Descent depth cap, sized so the SLOWEST contraction chain resolves
   * features below `DEPTH_RESOLUTION`. */
  maxDepth: number;
  /** 4D twin of SurfaceDE.slowestSigma: the largest certified per-level
   * shrink, retained so camera-dependent deep zoom can extend maxDepth by
   * exactly the number of levels its smaller footprint needs. */
  slowestSigma: number;
  /** How many descent chains {@link estimateDistance4} refines in
   * parallel. Widths 1/2 are the classic greedy chain and the paired A/B
   * chains; widths 3/4 add the rank-3/4 VALIDITY slots — extra chains that
   * hold the level's rank-3/4 candidates ONLY while their points are
   * in-sphere (an escaped rank-3/4 candidate folds its refined certificate
   * instead, exactly as it would without the slots), so levels with three
   * or four simultaneous in-sphere branches no longer drop the excess
   * uncounted.
   * {@link buildSurfaceDE4} always emits 4 (see the 3D twin's module doc
   * for the measured verdict); 1 and 2 exist so tests can pin each
   * mechanism. */
  beamWidth: 1 | 2 | 3 | 4;
  /** March step multiplier from {@link analyzeSurfaceSystem4}. */
  stepScale: number;
  /** Pre-inverted final-transform lens (the plotted set is `F(attractor)`),
   * or `null`. Applied ONCE to the query point; the result is un-scaled by
   * its `sigmaMin`. Validity transfers dimension-free:
   * `dist(q, F(A)) >= sigma_min(F) * dist(F^-1(q), A)` holds in any
   * dimension (see the module doc's VALIDITY TRANSFERS VERBATIM section), so
   * the slice lower-bound argument is unaffected by the lens. Mutually
   * exclusive with {@link foldFinal}. */
  final: { invM: number[]; invT: Vec4; sigmaMin: number } | null;
  /** Pure-fold FINAL lens (3D's `foldFinal` one
   * dimension up), or `null`. When set, {@link final} is `null` and the
   * public estimators route through `descendLens4`: the lens fold expands
   * into ONE round of branch root descents around the untouched cores.
   * `invM`/`invT` invert the lens's AFFINE part; `invW`/`absW` carry the
   * fold weight; `sigmaMin` is the affine part's smallest singular value
   * (the per-branch descent factor is `absW · sigma_branch · sigmaMin`). */
  foldFinal: {
    invM: number[];
    invT: Vec4;
    sigmaMin: number;
    foldKind: SurfaceFoldKind;
    invW: number;
    absW: number;
    /** The lens fold's authored lengths, in the same branch-algebra form
     * the base maps carry. */
    foldRadii: SurfaceFoldRadii;
  } | null;
}

export interface SurfaceDE4BuildOptions {
  condensationDepthBand?: CondensationDepthBand;
  schedule?: HybridSchedule | null;
}

export interface SurfaceScheduleDE4 {
  maps: SurfaceDE4Map[];
  depth: number;
  bounds: SurfaceLevelBound4[];
}

/** The two fractal-native carrier values produced by the 4D surface shade
 * descent. They are normalized against the RAW attractor's origin-centred
 * bounding radius, exactly like the GLSL/WGSL `rings` and `sheets` extras. */
export interface SurfaceNativeCarriers4 {
  rings: number;
  sheets: number;
}

type SurfaceNativeCarrierFrame4 = Pick<
  SurfaceDE4,
  | "maps"
  | "schedule"
  | "chaos"
  | "symmetry"
  | "boundingRadius"
  | "escapeRadius"
  | "maxDepth"
>;

/**
 * Precompute the {@link SurfaceDE4} for a system: every active map lifted
 * (`toTransform4`) and analytically inverted, the kaleidoscope the descent
 * sweeps around them (same `effectiveSymmetryOrder` clamp against the FULL
 * transform list `prepareChaosGame4` applies, so the swept set is the
 * plotted set), a probed bounding-hypersphere radius, a depth cap
 * sized off the slowest contraction, and the pre-inverted final-transform
 * lens. Mirrors 3D's `buildSurfaceDE`; every plane (w-planes included) and
 * any twist is admissible here — this module is exactly where 3D's
 * `symmetryIsNonFlat` throw routes them.
 *
 * Throws when the system is ineligible ({@link analyzeSurfaceSystem4}) — the
 * app would gate on the analysis first, so reaching the throw is a bug.
 */
export function buildSurfaceDE4(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = NO_SYMMETRY4,
  options: SurfaceDE4BuildOptions = {},
): SurfaceDE4 {
  const analysis = analyzeSurfaceSystem4(
    transforms,
    finalTransform,
    options.schedule,
  );
  if (analysis.status === "ineligible") {
    throw new Error(
      `system has no surface distance estimator: ${analysis.reasons.join("; ")}`,
    );
  }

  // Lift every transform once, up front: the probe below needs the FULL
  // list (weight-0 slots included, so they occupy the right slot even
  // though they are never drawn), and the per-map inversion loop needs the
  // same lift.
  const lifted = transforms.map(toTransform4);
  const hasEmitter = transforms.some(
    (transform) => isActive(transform) && transformHasEmitter(transform),
  );
  const hasChaos = systemHasChaos(transforms);

  const maps: SurfaceDE4Map[] = [];
  transforms.forEach((t, i) => {
    if (!isActive(t)) return;
    if (transformHasEmitter(t)) return;
    const affine = composeAffine4(lifted[i]);
    const invM = inverse4(affine.m);
    const [tx, ty, tz, tw] = affine.t;
    const invT: Vec4 = [
      -(invM[0] * tx + invM[1] * ty + invM[2] * tz + invM[3] * tw),
      -(invM[4] * tx + invM[5] * ty + invM[6] * tz + invM[7] * tw),
      -(invM[8] * tx + invM[9] * ty + invM[10] * tz + invM[11] * tw),
      -(invM[12] * tx + invM[13] * ty + invM[14] * tz + invM[15] * tw),
    ];
    const sigmaMin = analysis.sigmas[i].min;
    // Pure-fold maps carry their fold family + weight into the descent's
    // branch expansion (3D's fold-branch sweep one dimension up);
    // plain affine maps get the inert defaults.
    const fold = pureFoldVariation(t);
    const foldKind: SurfaceFoldKind = !fold
      ? SURFACE_FOLD_NONE
      : fold.type === "boxfold"
        ? SURFACE_FOLD_BOXFOLD
        : fold.type === "spherefold"
          ? SURFACE_FOLD_SPHEREFOLD
          : SURFACE_FOLD_MANDELBOX;
    const invTNorm = Math.hypot(invT[0], invT[1], invT[2], invT[3]);
    maps.push({
      invM,
      invT,
      sigmaMin,
      baseIndex: i,
      ...(hasChaos ? { stateIndex: maps.length } : {}),
      foldKind,
      foldInvW: fold ? 1 / fold.weight : 1,
      foldSigma: fold ? Math.abs(fold.weight) * sigmaMin : sigmaMin,
      foldRadii: surfaceFoldRadii(fold),
      // Reciprocal singular values: sigma(inv(M)) = 1/sigma(M), so the
      // smallest of the inverse is exactly one over the largest of the
      // forward map (the stage-2 bound data). Origin-centered — this
      // module has no probe-fit ball, so the plain invT forms are exact.
      invMSigmaMin: 1 / analysis.sigmas[i].max,
      invTNorm,
      bnbDir:
        invTNorm > 0
          ? [
              (invM[0] * invT[0] +
                invM[4] * invT[1] +
                invM[8] * invT[2] +
                invM[12] * invT[3]) /
                invTNorm,
              (invM[1] * invT[0] +
                invM[5] * invT[1] +
                invM[9] * invT[2] +
                invM[13] * invT[3]) /
                invTNorm,
              (invM[2] * invT[0] +
                invM[6] * invT[1] +
                invM[10] * invT[2] +
                invM[14] * invT[3]) /
                invTNorm,
              (invM[3] * invT[0] +
                invM[7] * invT[1] +
                invM[11] * invT[2] +
                invM[15] * invT[3]) /
                invTNorm,
            ]
          : [0, 0, 0, 0],
    });
  });

  const preparedSchedule = prepareSchedule(options.schedule);
  let scheduleMaps: SurfaceDE4Map[] | null = null;
  let scheduleTransforms: Transform[] | null = null;
  if (preparedSchedule && options.schedule) {
    scheduleTransforms = options.schedule.transforms.filter(
      (t) => !preparedSchedule.weighted || (t.weight ?? 1) > 0,
    );
    scheduleMaps = scheduleTransforms.map((t, i) => {
      const liftedB = toTransform4(t);
      const affine = composeAffine4(liftedB);
      const invM = inverse4(affine.m);
      const [tx, ty, tz, tw] = affine.t;
      const invT: Vec4 = [
        -(invM[0] * tx + invM[1] * ty + invM[2] * tz + invM[3] * tw),
        -(invM[4] * tx + invM[5] * ty + invM[6] * tz + invM[7] * tw),
        -(invM[8] * tx + invM[9] * ty + invM[10] * tz + invM[11] * tw),
        -(invM[12] * tx + invM[13] * ty + invM[14] * tz + invM[15] * tw),
      ];
      const sigmas = transformSigmas4(liftedB);
      return {
        invM,
        invT,
        sigmaMin: sigmas.min,
        baseIndex: i,
        foldKind: SURFACE_FOLD_NONE,
        foldInvW: 1,
        foldSigma: sigmas.min,
        foldRadii: surfaceFoldRadii(null),
        invMSigmaMin: 1 / sigmas.max,
        // Disabled in B levels: the child bound changes with global depth.
        invTNorm: 0,
        bnbDir: [0, 0, 0, 0],
      } satisfies SurfaceDE4Map;
    });
  }

  // Sector count mirroring prepareChaosGame4: the effective order is clamped
  // against the FULL list length (weight-0 slots included), so the swept set
  // is the plotted set. `blend` is deliberately not read — it fades copy
  // WEIGHTS, never geometry, exactly the 3D module doc's BLEND rule (the
  // probe below still receives it, so a faded copy shifts the sampled
  // extent there just as it always shifted the plotted one).
  const order = effectiveSymmetryOrder(symmetry.order, transforms.length);
  // The BACKWARD one-step generator: build the FORWARD step with the exact
  // symmetryRotation4 call prepareChaosGame4 rotates copy 1 by (k = 1 — the
  // PLANE_SIGN convention lives inside that call, so reusing it is how this
  // module stays out of the sign trap), then transpose it: the generator is
  // orthogonal (block-diagonal over the plane and its complement), so the
  // transpose is the exact inverse, bit-derived from the same entries —
  // never a numerically composed g^(order-1).
  const stepBack = transpose4(
    symmetryRotation4(
      symmetry.plane,
      (2 * Math.PI) / order,
      symmetry.twist ?? 0,
    ),
  );

  let condensation: CondensationDE4 | undefined;
  const emitterBaseIndices: number[] = [];
  const emitterCopyBaseIndices: number[] = [];
  if (hasEmitter) {
    const emitters: CondensationEmitter4[] = [];
    const shadeIndices = new Map<number, number>();
    let nextShadeIndex = maps.length;
    for (let i = 0; i < transforms.length; i++) {
      if (isActive(transforms[i]) && transformHasEmitter(transforms[i])) {
        shadeIndices.set(i, nextShadeIndex++);
        emitterBaseIndices.push(i);
      }
    }
    for (let k = 0; k < order; k++) {
      const post =
        k === 0
          ? null
          : symmetryRotation4(
              symmetry.plane,
              (2 * Math.PI * k) / order,
              symmetry.twist ?? 0,
            );
      for (let i = 0; i < transforms.length; i++) {
        if (!isActive(transforms[i]) || !transformHasEmitter(transforms[i])) {
          continue;
        }
        const t = transforms[i];
        const affine = composeAffine4(lifted[i]);
        const baseInv = inverse4(affine.m);
        const [tx, ty, tz, tw] = affine.t;
        const invT: Vec4 = [
          -(
            baseInv[0] * tx +
            baseInv[1] * ty +
            baseInv[2] * tz +
            baseInv[3] * tw
          ),
          -(
            baseInv[4] * tx +
            baseInv[5] * ty +
            baseInv[6] * tz +
            baseInv[7] * tw
          ),
          -(
            baseInv[8] * tx +
            baseInv[9] * ty +
            baseInv[10] * tz +
            baseInv[11] * tw
          ),
          -(
            baseInv[12] * tx +
            baseInv[13] * ty +
            baseInv[14] * tz +
            baseInv[15] * tw
          ),
        ];
        let invM = baseInv;
        let center: Vec4 = [tx, ty, tz, tw];
        if (post !== null) {
          invM = new Array<number>(16);
          for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
              let value = 0;
              for (let a = 0; a < 4; a++) {
                value += baseInv[r * 4 + a] * post[c * 4 + a];
              }
              invM[r * 4 + c] = value;
            }
          }
          center = [
            post[0] * tx + post[1] * ty + post[2] * tz + post[3] * tw,
            post[4] * tx + post[5] * ty + post[6] * tz + post[7] * tw,
            post[8] * tx + post[9] * ty + post[10] * tz + post[11] * tw,
            post[12] * tx + post[13] * ty + post[14] * tz + post[15] * tw,
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

  // Condensation makes the attractor the recursive closure
  // A = C0 union_j F_j(A), so a finite weighted probe is not a bound: it can
  // miss an arbitrarily rare translated branch.  About the 4D origin, C0 is
  // inside radius R0 and an admitted recursive map is globally L-Lipschitz,
  // hence F(B(0, R)) is inside radius |F(0)| + L R.  Therefore
  // R >= max(R0, |F(0)| / (1 - L)) is an invariant ball.  The fold L values
  // are exactly the eligibility certificates; symmetry post-rotations are
  // isometries and do not change |F(0)|.  Final lenses remain outside this
  // raw fixed point and use the existing one-shot visible-radius bound.
  let condensationInvariantRadius = 0;
  if (condensation || chaos) {
    condensationInvariantRadius = condensation
      ? condensationBoundingRadius4(condensation)
      : 0;
    for (let i = 0; i < transforms.length; i++) {
      if (!isActive(transforms[i]) || transformHasEmitter(transforms[i])) {
        continue;
      }
      const affine = composeAffine4(lifted[i]);
      let image: Vec4 = [affine.t[0], affine.t[1], affine.t[2], affine.t[3]];
      const fold = pureFoldVariation(transforms[i]);
      let lipschitz = analysis.sigmas[i].max;
      if (fold) {
        image = applyPureFold4(fold, image[0], image[1], image[2], image[3]);
        lipschitz *= foldLipschitz(fold);
      }
      condensationInvariantRadius = Math.max(
        condensationInvariantRadius,
        Math.hypot(...image) / (1 - lipschitz),
      );
    }
    condensationInvariantRadius =
      condensationInvariantRadius * RADIUS_PAD + 1e-3;
  }

  // Bounding radius: a seeded probe of the exact plotted set (the full
  // lifted list + kaleidoscope — weight-0 slots are simply never drawn).
  // Unlike 3D's
  // `probe.bounds.maxR` (already origin-based), `runChaosGame4`'s `radius`
  // is measured from the cloud's CENTER, not the origin (see its doc) — the
  // wrong quantity for a DE's "the attractor sits inside a sphere AROUND THE
  // ORIGIN" base case — so this re-derives the max ORIGIN distance directly
  // from the emitted points instead of reusing that field.
  //
  // The ball is ORIGIN-anchored (this module never adopted 3D's
  // probe-fit centred ball), and the origin is fixed by EVERY sector
  // generator, twist included — so the ball is invariant under the whole
  // kaleidoscope group and the sweep needs no centre projection. Recorded
  // for the port that would add a centred fit, because this is the ONE
  // place the 3D code must NOT be mirrored blindly: the subspace to project
  // a fitted centre onto is the GENERATOR's fixed subspace — at twist 0 the
  // COMPLEMENT plane of the rotation plane (zero the two in-plane
  // coordinates, keep the pair the rotation never touches), and at
  // twist != 0 the ORIGIN alone (both angles are nonzero multiples of
  // 2π/order strictly inside (0, 2π), so neither block of the generator
  // fixes a direction). Projecting a twisted fit to the origin re-measures
  // to exactly the origin ball, so 3D's "keep the fit only where its padded
  // radius beats the origin ball's" comparison retires the twisted case
  // naturally rather than through a special case; copying 3D's in-plane
  // zeroing instead would leave a twisted kaleidoscope a NON-invariant
  // centre — an unsound certificate, not merely a loose one.
  const aProbe = runChaosGame4(
    lifted,
    PROBE_POINTS,
    mulberry32(PROBE_SEED),
    null,
    symmetry,
  );
  let maxR = 0;
  for (let i = 0; i < aProbe.count; i++) {
    const x = aProbe.positions[i * 3];
    const y = aProbe.positions[i * 3 + 1];
    const z = aProbe.positions[i * 3 + 2];
    const w = aProbe.w[i];
    const r = Math.sqrt(x * x + y * y + z * z + w * w);
    if (r > maxR) maxR = r;
  }
  const aBoundingRadius = Math.max(
    maxR * RADIUS_PAD + 1e-3,
    condensationInvariantRadius,
  );
  let probe = aProbe;
  let boundingRadius = aBoundingRadius;
  let scheduleDE: SurfaceScheduleDE4 | undefined;
  if (
    preparedSchedule &&
    options.schedule &&
    scheduleMaps &&
    scheduleTransforms
  ) {
    const depth = preparedSchedule.depth;
    const bounds = new Array<SurfaceLevelBound4>(depth + 1);
    bounds[depth] = {
      radius: aBoundingRadius,
      escapeRadius: ESCAPE_FACTOR * aBoundingRadius,
    };
    for (let d = depth - 1; d >= 0; d--) {
      const levelProbe = runChaosGame4(
        lifted,
        PROBE_POINTS,
        mulberry32(PROBE_SEED),
        null,
        symmetry,
        undefined,
        { transforms: options.schedule.transforms, depth: depth - d },
      );
      let levelMaxR = 0;
      for (let i = 0; i < levelProbe.count; i++) {
        const x = levelProbe.positions[i * 3];
        const y = levelProbe.positions[i * 3 + 1];
        const z = levelProbe.positions[i * 3 + 2];
        const w = levelProbe.w[i];
        levelMaxR = Math.max(levelMaxR, Math.hypot(x, y, z, w));
      }
      let certifiedRadius = 0;
      for (const t of scheduleTransforms) {
        const liftedB = toTransform4(t);
        const affine = composeAffine4(liftedB);
        certifiedRadius = Math.max(
          certifiedRadius,
          Math.hypot(...affine.t) +
            transformSigmas4(liftedB).max * bounds[d + 1].radius,
        );
      }
      const radius = Math.max(levelMaxR * RADIUS_PAD + 1e-3, certifiedRadius);
      bounds[d] = { radius, escapeRadius: ESCAPE_FACTOR * radius };
      if (d === 0) probe = levelProbe;
    }
    scheduleDE = { maps: scheduleMaps, depth, bounds };
    boundingRadius = bounds[0].radius;
  }

  // Depth cap from the SLOWEST contraction, identical formula to 3D
  // (ceiling: see MAX_DESCENT_DEPTH's sizing note — doubleRotation
  // is the preset the old 48 ceiling clamped into a solid core ball). For
  // fold maps the slowest certified branch is |w|·L_V·sigma_min — the
  // spherefold's ×4 branches shrink features slowest — and eligibility
  // keeps even that below CONTRACTION_LIMIT.
  const slowest = maps.reduce((acc, map) => {
    const factor =
      map.foldKind === SURFACE_FOLD_NONE
        ? map.sigmaMin
        : map.foldKind === SURFACE_FOLD_BOXFOLD
          ? map.foldSigma
          : map.foldSigma * map.foldRadii.innerSigma;
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

  // Native pattern calibration samples the RAW attractor in its production
  // carrier frame: origin-centred radius, no view rotor/slice, and no final
  // lens. The existing 8192-point seeded probe is already paid for by the DE
  // build; take exactly 256 evenly-strided entries (8192 / 256 = 32) rather
  // than launching another orbit or letting camera coverage bias the span.
  const patternSamples: SurfaceNativeCarriers4[] = [];
  const patternStride = PROBE_POINTS / SURFACE_NATIVE_CALIBRATION_SAMPLE_COUNT;
  if (!Number.isInteger(patternStride) || probe.count !== PROBE_POINTS) {
    throw new Error(
      "surface-de-4d: native calibration requires the complete evenly-divisible raw probe",
    );
  }
  const carrierFrame: SurfaceNativeCarrierFrame4 = {
    maps,
    ...(chaos ? { chaos } : {}),
    ...(scheduleDE ? { schedule: scheduleDE } : {}),
    symmetry: { order, stepBack },
    boundingRadius,
    escapeRadius: ESCAPE_FACTOR * boundingRadius,
    maxDepth,
  };
  for (let i = 0; i < SURFACE_NATIVE_CALIBRATION_SAMPLE_COUNT; i++) {
    const at = i * patternStride;
    patternSamples.push(
      surfaceNativeCarriers4Raw(carrierFrame, [
        probe.positions[at * 3],
        probe.positions[at * 3 + 1],
        probe.positions[at * 3 + 2],
        probe.w[at],
      ]),
    );
  }
  const patternCalibration = calibrateSurfaceNativeCarriers(patternSamples);

  // Final-transform lens, mirroring 3D's buildSurfaceDE lines 485-500: lift,
  // invert the composed 4x4, and derive invT with the same row-major
  // pattern as the per-map inversion above. The probe above never applies
  // this — it measures the RAW attractor, and the DE descends the raw
  // attractor and applies the lens to the query instead (see
  // estimateDistance4's prologue).
  let final: SurfaceDE4["final"] = null;
  let foldFinal: SurfaceDE4["foldFinal"] = null;
  let visibleBoundingRadius = boundingRadius;
  if (finalTransform) {
    const liftedFinal = toTransform4(finalTransform);
    const affine = composeAffine4(liftedFinal);
    const invM = inverse4(affine.m);
    const [tx, ty, tz, tw] = affine.t;
    const invT: Vec4 = [
      -(invM[0] * tx + invM[1] * ty + invM[2] * tz + invM[3] * tw),
      -(invM[4] * tx + invM[5] * ty + invM[6] * tz + invM[7] * tw),
      -(invM[8] * tx + invM[9] * ty + invM[10] * tz + invM[11] * tw),
      -(invM[12] * tx + invM[13] * ty + invM[14] * tz + invM[15] * tw),
    ];
    const s = transformSigmas4(liftedFinal);
    // |F(x)| <= sigma_max·|x| + |t| bounds the visible AFFINE image.
    const affineR = s.max * boundingRadius + Math.hypot(tx, ty, tz, tw);
    const fold = pureFoldVariation(finalTransform);
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
      // <= |y|² + 4·wall² — the axis COUNT (4, not 3D's 3: the boxfold
      // folds w like every spatial axis, variations4.ts). The spherefold's
      // clamp caps every branch's output at max(|y|, fR²/mR) (identity
      // keeps |y|, the shell inverts into (fR, fR²/mR], the inner region
      // tops out at (fR²/mR²)·mR = fR²/mR — all radial statements,
      // dimension-free); the mandelbox chains the two. At the classic
      // lengths those are the `+ 4` and the `2` that shipped.
      const boxR = Math.sqrt(affineR * affineR + 4 * radii.wall * radii.wall);
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

  // Radial color band of the VISIBLE set: re-probe WITH the
  // final transform when one exists — runChaosGame4's own final
  // application (composed affine + variations) is the plotted set's
  // ground truth, better than re-deriving F here — else reuse the raw
  // probe (they are the same seeded orbit). `center` is the result's 4D
  // bounds-center and the [minD, maxD] loop mirrors buildColors4's
  // radius branch, so the surface ramp and the cloud ramp normalize the
  // same way.
  const probeVis = finalTransform
    ? runChaosGame4(
        lifted,
        PROBE_POINTS,
        mulberry32(PROBE_SEED),
        toTransform4(finalTransform),
        symmetry,
        undefined,
        options.schedule ?? null,
      )
    : probe;
  const bandCenter = probeVis.center;
  let minD = Infinity;
  let maxD = 0;
  for (let i = 0; i < probeVis.count; i++) {
    const dx = probeVis.positions[i * 3] - bandCenter[0];
    const dy = probeVis.positions[i * 3 + 1] - bandCenter[1];
    const dz = probeVis.positions[i * 3 + 2] - bandCenter[2];
    const dw = probeVis.w[i] - bandCenter[3];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
    if (d < minD) minD = d;
    if (d > maxD) maxD = d;
  }
  if (minD > maxD) minD = 0; // empty probe — the maxR loop's same degenerate

  return {
    maps,
    ...(chaos ? { chaos } : {}),
    ...(scheduleDE ? { schedule: scheduleDE } : {}),
    ...(condensation ? { condensation } : {}),
    symmetry: { order, stepBack },
    boundingRadius,
    visibleBoundingRadius,
    radiusBand: {
      center: [bandCenter[0], bandCenter[1], bandCenter[2], bandCenter[3]],
      minD,
      maxD,
    },
    escapeRadius: ESCAPE_FACTOR * boundingRadius,
    patternCalibration,
    maxDepth,
    slowestSigma: slowest,
    beamWidth: 4,
    stepScale: analysis.stepScale,
    final,
    foldFinal,
  };
}

/** Clamp a shader carrier to its documented `[0, 1]` range. */
function clampCarrier4(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * The affine4 shade body's carrier-only trajectory. This is deliberately not
 * the distance oracle: the shaders' hit-info overload routes a width-4 beam
 * by candidate key, records `rings`/`sheets` from the level winner, and uses
 * only radius gates to decide which candidates continue. Certificates and
 * the final lens never participate. Keeping that smaller contract here is
 * what makes calibration match the values the eventual pattern shader reads.
 */
function surfaceAffineNativeCarriers4(
  de: SurfaceNativeCarrierFrame4,
  point: Vec4,
): SurfaceNativeCarriers4 {
  const { order, stepBack } = de.symmetry;
  const chainX = [point[0], 0, 0, 0];
  const chainY = [point[1], 0, 0, 0];
  const chainZ = [point[2], 0, 0, 0];
  const chainW = [point[3], 0, 0, 0];
  const chainScale = [1, 1, 1, 1];
  const chainState = [
    SURFACE_CHAOS_WILDCARD,
    SURFACE_CHAOS_WILDCARD,
    SURFACE_CHAOS_WILDCARD,
    SURFACE_CHAOS_WILDCARD,
  ];
  let chainCount = 1;
  let rings = 1;
  let sheets = 1;

  const key = new Array<number>(4);
  const x = new Array<number>(4);
  const y = new Array<number>(4);
  const z = new Array<number>(4);
  const w = new Array<number>(4);
  const scale = new Array<number>(4);
  const radius = new Array<number>(4);
  const state = new Array<number>(4);
  const sector = [0, 0, 0, 0];

  for (let depth = 0; depth < de.maxDepth && chainCount > 0; depth++) {
    const inB = de.schedule !== undefined && depth < de.schedule.depth;
    const levelMaps = inB ? de.schedule!.maps : de.maps;
    const sectorOrder = inB ? 1 : order;
    const childBound = de.schedule
      ? de.schedule.bounds[Math.min(depth + 1, de.schedule.depth)]
      : null;
    const R = childBound ? childBound.radius : de.boundingRadius;
    const escapeRadius = childBound ? childBound.escapeRadius : de.escapeRadius;
    key.fill(1e30);
    radius.fill(0);
    for (let c = 0; c < chainCount; c++) {
      let sx = chainX[c];
      let sy = chainY[c];
      let sz = chainZ[c];
      let sw = chainW[c];
      const pScale = chainScale[c];
      const pState = chainState[c];
      for (let k = 0; k < sectorOrder; k++) {
        if (k > 0) {
          stepSector4(stepBack, sx, sy, sz, sw, sector);
          sx = sector[0];
          sy = sector[1];
          sz = sector[2];
          sw = sector[3];
        }
        for (const map of levelMaps) {
          if (!inB && !surfaceChaosAllows(de.chaos, pState, map.stateIndex!)) {
            continue;
          }
          const childState = inB
            ? SURFACE_CHAOS_WILDCARD
            : (map.stateIndex ?? SURFACE_CHAOS_WILDCARD);
          const im = map.invM;
          const it = map.invT;
          const ix = im[0] * sx + im[1] * sy + im[2] * sz + im[3] * sw + it[0];
          const iy = im[4] * sx + im[5] * sy + im[6] * sz + im[7] * sw + it[1];
          const iz =
            im[8] * sx + im[9] * sy + im[10] * sz + im[11] * sw + it[2];
          const iw =
            im[12] * sx + im[13] * sy + im[14] * sz + im[15] * sw + it[3];
          const r = Math.hypot(ix, iy, iz, iw);
          const candidateKey = pScale * (r - R);
          let slot = 0;
          // Strict comparison preserves the shaders' sector-major tie rule:
          // an equal later candidate stays behind the earlier one.
          while (slot < 4 && !(candidateKey < key[slot])) slot++;
          if (slot === 4) continue;
          for (let q = 3; q > slot; q--) {
            key[q] = key[q - 1];
            x[q] = x[q - 1];
            y[q] = y[q - 1];
            z[q] = z[q - 1];
            w[q] = w[q - 1];
            scale[q] = scale[q - 1];
            radius[q] = radius[q - 1];
            state[q] = state[q - 1];
          }
          key[slot] = candidateKey;
          x[slot] = ix;
          y[slot] = iy;
          z[slot] = iz;
          w[slot] = iw;
          scale[slot] = pScale * map.sigmaMin;
          radius[slot] = r;
          state[slot] = childState;
        }
      }
    }

    rings = Math.min(rings, radius[0] / R);
    sheets = Math.min(sheets, Math.abs(y[0]) / R);

    chainCount = 0;
    const keep = (slot: number, limit: number): void => {
      if (key[slot] >= 1e29 || radius[slot] > limit) return;
      chainX[chainCount] = x[slot];
      chainY[chainCount] = y[slot];
      chainZ[chainCount] = z[slot];
      chainW[chainCount] = w[slot];
      chainScale[chainCount] = scale[slot];
      chainState[chainCount] = state[slot];
      chainCount++;
    };
    keep(0, escapeRadius);
    keep(1, escapeRadius);
    keep(2, R);
    keep(3, R);
  }
  return { rings: clampCarrier4(rings), sheets: clampCarrier4(sheets) };
}

/**
 * The fold4 shade body's greedy carrier trajectory. It enumerates every
 * sector/map/fold-branch triple, raises the candidate key by the branch
 * region floor, and continues only the strict smallest candidate. This is
 * the WGSL hit-info contract rather than the wider distance frontier.
 */
function surfaceFoldNativeCarriers4(
  de: SurfaceNativeCarrierFrame4,
  point: Vec4,
): SurfaceNativeCarriers4 {
  const { order, stepBack } = de.symmetry;
  let chX = point[0];
  let chY = point[1];
  let chZ = point[2];
  let chW = point[3];
  let chScale = 1;
  let chFloor = 0;
  let chState = SURFACE_CHAOS_WILDCARD;
  let rings = 1;
  let sheets = 1;
  const sector = [0, 0, 0, 0];

  for (let depth = 0; depth < de.maxDepth; depth++) {
    const inB = de.schedule !== undefined && depth < de.schedule.depth;
    const levelMaps = inB ? de.schedule!.maps : de.maps;
    const sectorOrder = inB ? 1 : order;
    const childBound = de.schedule
      ? de.schedule.bounds[Math.min(depth + 1, de.schedule.depth)]
      : null;
    const R = childBound ? childBound.radius : de.boundingRadius;
    const escapeRadius = childBound ? childBound.escapeRadius : de.escapeRadius;
    let lbKey = 1e30;
    let lbX = 0;
    let lbY = 0;
    let lbZ = 0;
    let lbW = 0;
    let lbR = 0;
    let lbScale = 1;
    let lbFloor = 0;
    let lbState = SURFACE_CHAOS_WILDCARD;
    let sx = chX;
    let sy = chY;
    let sz = chZ;
    let sw = chW;

    for (let k = 0; k < sectorOrder; k++) {
      if (k > 0) {
        stepSector4(stepBack, sx, sy, sz, sw, sector);
        sx = sector[0];
        sy = sector[1];
        sz = sector[2];
        sw = sector[3];
      }
      for (const map of levelMaps) {
        if (!inB && !surfaceChaosAllows(de.chaos, chState, map.stateIndex!)) {
          continue;
        }
        const kind = map.foldKind;
        const branchCount = foldBranchCount4(kind);
        const absW = map.foldSigma / map.sigmaMin;
        const fr = map.foldRadii;
        const wall2 = 2 * fr.wall;
        let ux = 0;
        let uy = 0;
        let uz = 0;
        let uw = 0;
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
        let pw0 = 0;
        let pw1 = 0;
        let pw2 = 0;
        let dxUp = 0;
        let dxDn = 0;
        let dyUp = 0;
        let dyDn = 0;
        let dzUp = 0;
        let dzDn = 0;
        let dwUp = 0;
        let dwDn = 0;
        let vx = 0;
        let vy = 0;
        let vz = 0;
        let vw = 0;
        let sfSigma = 1;
        let sfRd = 0;
        if (kind !== SURFACE_FOLD_NONE) {
          ux = sx * map.foldInvW;
          uy = sy * map.foldInvW;
          uz = sz * map.foldInvW;
          uw = sw * map.foldInvW;
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
            pw0 = uw;
            pw1 = wall2 - uw;
            pw2 = -wall2 - uw;
            dxUp = Math.max(ux - fr.wall, 0);
            dxDn = Math.max(-fr.wall - ux, 0);
            dyUp = Math.max(uy - fr.wall, 0);
            dyDn = Math.max(-fr.wall - uy, 0);
            dzUp = Math.max(uz - fr.wall, 0);
            dzDn = Math.max(-fr.wall - uz, 0);
            dwUp = Math.max(uw - fr.wall, 0);
            dwDn = Math.max(-fr.wall - uw, 0);
          } else {
            ru = Math.hypot(ux, uy, uz, uw);
          }
        }

        for (let b = 0; b < branchCount; b++) {
          let cx: number;
          let cy: number;
          let cz: number;
          let cw: number;
          let branchSigma: number;
          let branchRd = 0;
          if (kind === SURFACE_FOLD_NONE) {
            cx = sx;
            cy = sy;
            cz = sz;
            cw = sw;
            branchSigma = map.sigmaMin;
          } else {
            if (
              kind === SURFACE_FOLD_SPHEREFOLD ||
              (kind === SURFACE_FOLD_MANDELBOX && b % 81 === 0)
            ) {
              const sphereBranch =
                kind === SURFACE_FOLD_SPHEREFOLD ? b : b / 81;
              if (sphereBranch === 0) {
                vx = ux;
                vy = uy;
                vz = uz;
                vw = uw;
                sfSigma = 1;
                sfRd = Math.max(fr.fixedR - ru, 0);
              } else if (sphereBranch === 1) {
                vx = fr.innerScale * ux;
                vy = fr.innerScale * uy;
                vz = fr.innerScale * uz;
                vw = fr.innerScale * uw;
                sfSigma = fr.innerSigma;
                sfRd = Math.max(ru - fr.outputR, 0);
              } else {
                if (ru < fr.midMinR) {
                  if (kind === SURFACE_FOLD_MANDELBOX) b += 80;
                  continue;
                }
                const invR2 = fr.fixedR2 / (ru * ru);
                vx = ux * invR2;
                vy = uy * invR2;
                vz = uz * invR2;
                vw = uw * invR2;
                sfSigma = ru * fr.invFixedR;
                sfRd = Math.max(fr.fixedR - ru, ru - fr.outputR, 0);
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
                pw0 = vw;
                pw1 = wall2 - vw;
                pw2 = -wall2 - vw;
                dxUp = Math.max(vx - fr.wall, 0);
                dxDn = Math.max(-fr.wall - vx, 0);
                dyUp = Math.max(vy - fr.wall, 0);
                dyDn = Math.max(-fr.wall - vy, 0);
                dzUp = Math.max(vz - fr.wall, 0);
                dzDn = Math.max(-fr.wall - vz, 0);
                dwUp = Math.max(vw - fr.wall, 0);
                dwDn = Math.max(-fr.wall - vw, 0);
              }
            }

            if (kind === SURFACE_FOLD_SPHEREFOLD) {
              cx = vx;
              cy = vy;
              cz = vz;
              cw = vw;
              branchRd = sfRd;
            } else {
              const bb = kind === SURFACE_FOLD_BOXFOLD ? b : b % 81;
              const selX = bb % 3;
              const selY = ((bb / 3) | 0) % 3;
              const selZ = ((bb / 9) | 0) % 3;
              const selW = (bb / 27) | 0;
              cx = selX === 0 ? px0 : selX === 1 ? px1 : px2;
              cy = selY === 0 ? py0 : selY === 1 ? py1 : py2;
              cz = selZ === 0 ? pz0 : selZ === 1 ? pz1 : pz2;
              cw = selW === 0 ? pw0 : selW === 1 ? pw1 : pw2;
              const ddx =
                selX === 0 ? Math.max(dxUp, dxDn) : selX === 1 ? dxUp : dxDn;
              const ddy =
                selY === 0 ? Math.max(dyUp, dyDn) : selY === 1 ? dyUp : dyDn;
              const ddz =
                selZ === 0 ? Math.max(dzUp, dzDn) : selZ === 1 ? dzUp : dzDn;
              const ddw =
                selW === 0 ? Math.max(dwUp, dwDn) : selW === 1 ? dwUp : dwDn;
              // This is the calibration builder's hottest loop on a
              // mandelbox (up to 243 branches per map). `sqrt(sum sq)` is
              // the shader's `length` arithmetic and avoids Math.hypot's
              // general-purpose rescaling overhead for these finite,
              // already-bounded fold coordinates.
              const boxRd = Math.sqrt(
                ddx * ddx + ddy * ddy + ddz * ddz + ddw * ddw,
              );
              branchRd =
                kind === SURFACE_FOLD_BOXFOLD
                  ? boxRd
                  : Math.max(sfRd, sfSigma * boxRd);
            }
            branchSigma = map.foldSigma * sfSigma;
          }

          const im = map.invM;
          const it = map.invT;
          const ix = im[0] * cx + im[1] * cy + im[2] * cz + im[3] * cw + it[0];
          const iy = im[4] * cx + im[5] * cy + im[6] * cz + im[7] * cw + it[1];
          const iz =
            im[8] * cx + im[9] * cy + im[10] * cz + im[11] * cw + it[2];
          const iw =
            im[12] * cx + im[13] * cy + im[14] * cz + im[15] * cw + it[3];
          const r = Math.sqrt(ix * ix + iy * iy + iz * iz + iw * iw);
          let candFloor = chFloor;
          if (branchRd > 0) {
            candFloor = Math.max(candFloor, chScale * absW * branchRd);
          }
          let candidateKey = chScale * (r - R);
          if (candFloor > 0 && candFloor > candidateKey) {
            candidateKey = candFloor;
          }
          if (candidateKey < lbKey) {
            lbKey = candidateKey;
            lbX = ix;
            lbY = iy;
            lbZ = iz;
            lbW = iw;
            lbR = r;
            lbScale = chScale * branchSigma;
            lbFloor = candFloor;
            lbState = inB
              ? SURFACE_CHAOS_WILDCARD
              : (map.stateIndex ?? SURFACE_CHAOS_WILDCARD);
          }
        }
      }
    }

    if (lbKey >= 1e29) break;
    rings = Math.min(rings, lbR / R);
    sheets = Math.min(sheets, Math.abs(lbY) / R);
    if (lbR > escapeRadius) break;
    chX = lbX;
    chY = lbY;
    chZ = lbZ;
    chW = lbW;
    chScale = lbScale;
    chFloor = lbFloor;
    chState = lbState;
  }
  return { rings: clampCarrier4(rings), sheets: clampCarrier4(sheets) };
}

/**
 * Evaluate the exact native carrier pair the 4D shade core would produce for
 * one RAW attractor-frame point. View rotor, w-slice and final lenses are
 * intentionally absent: callers reconstruct/invert those before this seam,
 * while system calibration samples the existing raw seeded probe directly.
 */
export function surfaceNativeCarriers4(
  de: SurfaceDE4,
  point: Vec4,
): SurfaceNativeCarriers4 {
  return surfaceNativeCarriers4Raw(de, point);
}

function surfaceNativeCarriers4Raw(
  de: SurfaceNativeCarrierFrame4,
  point: Vec4,
): SurfaceNativeCarriers4 {
  return de.maps.some((map) => map.foldKind !== SURFACE_FOLD_NONE)
    ? surfaceFoldNativeCarriers4(de, point)
    : surfaceAffineNativeCarriers4(de, point);
}

/**
 * `1 / (maxD - minD)` with `buildColors4`'s degenerate-range `|| 1` guard —
 * the ONE inverse-range definition the GLSL and WGSL packers share, so the
 * two tracers cannot drift on how {@link SurfaceDE4.radiusBand} maps onto
 * the ramp: `u = clamp((|q - center| - minD) * invRange, 0, 1)`.
 */
export function radiusBandInvRange(band: SurfaceDE4["radiusBand"]): number {
  const range = band.maxD - band.minD;
  return range > 0 ? 1 / range : 1;
}

/**
 * Distance from the ORIGIN to the segment `{q + s·e : s ∈ [-1, 1]}` — the
 * slab query's stand-in for `|q|` at every radius, escape test and ball
 * certificate the descent computes (see the module doc's SLAB
 * QUERIES section). `s` is the segment's own parameter at closest approach:
 * the unconstrained minimizer of `|q + s·e|²` is `-dot(q, e) / dot(e, e)`,
 * and clamping it to the segment's ends turns the infinite LINE's distance
 * (which undershoots, and by more than the slab justifies) into the
 * segment's exact one.
 *
 * At `e = 0` this returns `|q|` bit for bit — `ee = 0` takes the guarded
 * `s = 0` branch and `q + 0·e` is `q` exactly — which is what lets the whole
 * thickness feature ship defaulting to `h = 0` with the zero-thickness path
 * unchanged value for value.
 *
 * OVERFLOW TAIL (the GLSL mirror's, not this one's). `chainScale · |e| <= h`
 * bounds the extent at every level (module doc), and `ee` is `|e|²`, so `ee`
 * only overflows f32 once `|e|` passes that ceiling's square root, ~1.8e19 —
 * which takes a `chainScale` below `h / 1.8e19`, sixteen orders of magnitude
 * under `DEPTH_RESOLUTION`, where certificates are numerically dead. There
 * `ee` saturates to Infinity, `s` divides to 0, and this degrades to `|q|`:
 * an overshoot of a term already indistinguishable from zero. f64 (here)
 * never reaches it.
 */
function segmentRadius(
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  e: Float64Array,
): number {
  const ee = e[0] * e[0] + e[1] * e[1] + e[2] * e[2] + e[3] * e[3];
  const s =
    ee > 0
      ? clamp(-(qx * e[0] + qy * e[1] + qz * e[2] + qw * e[3]) / ee, -1, 1)
      : 0;
  const dx = qx + s * e[0];
  const dy = qy + s * e[1];
  const dz = qz + s * e[2];
  const dw = qw + s * e[3];
  return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
}

/**
 * `dst = M · src` for a row-major 4x4 — the LINEAR part of an affine map,
 * which is all a segment's half-extent ever sees: a translation slides the
 * segment's centre and leaves its extent alone. Alias-safe (`src === dst` is
 * fine), since every component is read before any is written.
 */
function applyLinear4(m: number[], src: Float64Array, dst: Float64Array): void {
  const x = src[0];
  const y = src[1];
  const z = src[2];
  const w = src[3];
  dst[0] = m[0] * x + m[1] * y + m[2] * z + m[3] * w;
  dst[1] = m[4] * x + m[5] * y + m[6] * z + m[7] * w;
  dst[2] = m[8] * x + m[9] * y + m[10] * z + m[11] * w;
  dst[3] = m[12] * x + m[13] * y + m[14] * z + m[15] * w;
}

/**
 * True when `halfExtent` describes a real slab rather than the point query.
 * Both estimators hoist this once and gate every extent PROPAGATION on it —
 * the arithmetic would collapse correctly anyway (a zero extent stays zero
 * through any linear map), so the flag buys only the work, never the values.
 * It mirrors the GLSL's `uSliceHalfW > 0.0`, which is dynamically uniform
 * across a draw and therefore free.
 */
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
 * Reference DE the module's validity argument certifies: beam inverse-map
 * descent with sibling-certificate tracking, a structural port of 3D's
 * `estimateDistance` (see the module doc for why the validity argument
 * transfers) with every coordinate step unrolled to four terms instead of
 * three, and the same final-transform lens prologue/epilogue as the 3D twin
 * (applied once to the query, un-scaled by its `sigmaMin` on the way out —
 * see the module doc's landing note and `SurfaceDE4.final`). See the 3D
 * twin's doc for the beam mechanics: the selection key
 * `chainScale · (r - R)`, the frozen certificates every non-descended
 * escaped candidate folds, the terminal bound a chain folds at escape or
 * the depth cap, and the width-1 equivalence to the classic greedy descent.
 * Width 2 is what repairs the branch-selection overshoot
 * (doubleRotation's profile) that certificate refinement provably cannot
 * touch; widths 3/4 add the validity slots — rank-3/4 chains that
 * live only while in-sphere, closing the 3-and-4-simultaneous drops.
 *
 * `halfExtent` turns the query into the SEGMENT `p ± halfExtent` — the slab
 * query — see the module doc's SLAB QUERIES section. The default
 * `null` is the point query, value for value.
 *
 * Kaleidoscope sectors are SWEPT around the base maps (the module
 * doc's SYMMETRY section): each chain point (and its half-extent) turns one
 * backward step per sector and every base map is applied to it there,
 * sector-major, so the candidate stream is exactly the expansion's. Order 1
 * leaves every `k > 0` branch dead — a system without symmetry runs the
 * pre-sweep arithmetic unchanged.
 *
 * Routing (mirroring 3D's `estimateDistance`): a fold FINAL lens
 * wraps the cores in `descendLens4`'s branch sweep, fold base maps descend
 * `descendFold4`'s frontier, and the plain affine ladder below serves the
 * rest. Slab queries (`halfExtent`) are refused — thrown, not degraded —
 * when the system's fold set breaks segment exactness ({@link slabExact4}).
 */
export function estimateDistance4(
  de: SurfaceDE4,
  p: Vec4,
  halfExtent: Vec4 | null = null,
): number {
  if (halfExtent && isSegment(halfExtent) && !slabExact4(de)) {
    throw new Error(
      "surface-de-4d: slab queries are unsound for this system's folds " +
        "or condensation shape — clamp sliceHalfW to 0 " +
        "for this system (slabExact4)",
    );
  }
  if (de.foldFinal) return descendLens4(de, p, false, 0, halfExtent);
  if (deHasFolds4(de)) return descendFold4(de, p, false, 0, halfExtent);
  return descend4(de, p, halfExtent);
}

function scheduledCondensationTerm4(
  de: SurfaceDE4,
  depth: number,
  scale: number,
  x: number,
  y: number,
  z: number,
  w: number,
  currentState = SURFACE_CHAOS_WILDCARD,
): number {
  if (!de.condensation) return Infinity;
  const aDepth = depth - (de.schedule?.depth ?? 0);
  if (aDepth < 0) return Infinity;
  if (!de.chaos || currentState === SURFACE_CHAOS_WILDCARD) {
    return condensationTerm4(de.condensation, aDepth, scale, x, y, z, w);
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
    const qx = m[0] * x + m[1] * y + m[2] * z + m[3] * w + t[0];
    const qy = m[4] * x + m[5] * y + m[6] * z + m[7] * w + t[1];
    const qz = m[8] * x + m[9] * y + m[10] * z + m[11] * w + t[2];
    const qw = m[12] * x + m[13] * y + m[14] * z + m[15] * w + t[3];
    const sd = shapeSdf(emitter.shape, qx, qy, qz);
    const value = emitter.sigmaMin * Math.hypot(Math.max(sd, 0), qw);
    if (value < best) best = value;
  }
  return scale * SHAPE_MARCH_SAFETY * best;
}

function scheduledCondensationHasFutureDepth4(
  de: SurfaceDE4,
  nextDepth: number,
): boolean {
  if (!de.condensation) return false;
  const aDepth = nextDepth - (de.schedule?.depth ?? 0);
  return (
    aDepth < 0 || condensationHasFutureDepth(de.condensation.depthBand, aDepth)
  );
}

function descend4(
  de: SurfaceDE4,
  p: Vec4,
  halfExtent: Vec4 | null = null,
): number {
  let x = p[0];
  let y = p[1];
  let z = p[2];
  let w = p[3];
  // The query's half-extent, carried alongside the point down every chain.
  // Zero — the default — is the point query this module shipped with, and
  // every term below collapses to it exactly (see `segmentRadius`).
  const segment = isSegment(halfExtent);
  const ext = new Float64Array(4);
  if (segment) ext.set(halfExtent);
  let finalScale = 1;
  if (de.final) {
    const f = de.final;
    const im = f.invM;
    const it = f.invT;
    const qx = im[0] * x + im[1] * y + im[2] * z + im[3] * w + it[0];
    const qy = im[4] * x + im[5] * y + im[6] * z + im[7] * w + it[1];
    const qz = im[8] * x + im[9] * y + im[10] * z + im[11] * w + it[2];
    const qw = im[12] * x + im[13] * y + im[14] * z + im[15] * w + it[3];
    x = qx;
    y = qy;
    z = qz;
    w = qw;
    // The lens carries the extent by its LINEAR part alone.
    if (segment) applyLinear4(im, ext, ext);
    finalScale = f.sigmaMin;
  }

  // Kaleidoscope sectors swept around the base maps — `order` 1
  // leaves every `k > 0` branch below dead, so a system without symmetry
  // runs the pre-sweep arithmetic unchanged. `sweep`/`sweepExt` are the
  // sector scratch (point quadruple + slab half-extent), hoisted here so
  // the hot loop never allocates.
  const { order, stepBack } = de.symmetry;
  const sweep = [0, 0, 0, 0];
  const sweepExt = new Float64Array(4);

  const R = de.boundingRadius;
  const condensation = de.condensation;
  const startR = segmentRadius(x, y, z, w, ext);
  const sphereBound = startR - R;
  const wide = de.beamWidth > 1;
  let best = Infinity;

  // Chain slot A starts at the (lensed) query; slot B idles until beam
  // selection fills it (width-2 up). V1/V2 are the validity slots
  // (widths 3/4): they hold the level's rank-3/4 candidates ONLY while
  // those are in-sphere — branches that carry no positive certificate, so
  // dropping them was the measured invalidity — and fold the ordinary
  // certificate the moment they escape. Mirrors 3D's estimateDistance with
  // a fourth coordinate on every chain and candidate slot.
  //
  // Each slot's segment half-extent rides in its own 4-element buffer rather
  // than four more unrolled scalars: that keeps this body line-for-line with
  // the GLSL mirror, where the same quantity is one `vec4`. The candidate and
  // eviction buffers are hoisted out of the depth loop (the GLSL declares
  // them inside it, where declarations are free) — safe because a slot's
  // contents are read only once its own key/radius sentinel says it is
  // occupied, and occupancy is re-decided from scratch every level.
  const extra = de.beamWidth - 2;
  let aX = x;
  let aY = y;
  let aZ = z;
  let aW = w;
  const aExt = new Float64Array(ext);
  let aScale = 1;
  let aR = startR;
  let aState = SURFACE_CHAOS_WILDCARD;
  let aLive = true;
  let bX = 0;
  let bY = 0;
  let bZ = 0;
  let bW = 0;
  const bExt = new Float64Array(4);
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
  let v1W = 0;
  const v1Ext = new Float64Array(4);
  let v1Scale = 1;
  let v1State = SURFACE_CHAOS_WILDCARD;
  let v1Live = false;
  let v2X = 0;
  let v2Y = 0;
  let v2Z = 0;
  let v2W = 0;
  const v2Ext = new Float64Array(4);
  let v2Scale = 1;
  let v2State = SURFACE_CHAOS_WILDCARD;
  let v2Live = false;
  const c1Ext = new Float64Array(4);
  const c2Ext = new Float64Array(4);
  const c3Ext = new Float64Array(4);
  const c4Ext = new Float64Array(4);
  const eExt = new Float64Array(4);
  const imgExt = new Float64Array(4);
  // No `tExt` here, unlike the refined twin: this estimator's rank-3/4 spill
  // hands the fold site a radius and a certificate only — never a point, and
  // so never an extent — so the displaced tuple's extent dies with it.

  for (let depth = 0; depth < de.maxDepth; depth++) {
    if (!aLive && !bLive && !v1Live && !v2Live) break;
    const inB = de.schedule !== undefined && depth < de.schedule.depth;
    const levelMaps = inB ? de.schedule!.maps : de.maps;
    const sectorOrder = inB ? 1 : order;
    const childBound = de.schedule
      ? de.schedule.bounds[Math.min(depth + 1, de.schedule.depth)]
      : null;
    const R = childBound ? childBound.radius : de.boundingRadius;
    const escapeRadius = childBound ? childBound.escapeRadius : de.escapeRadius;
    if (condensation) {
      if (aLive) {
        best = Math.min(
          best,
          scheduledCondensationTerm4(de, depth, aScale, aX, aY, aZ, aW, aState),
        );
      }
      if (bLive) {
        best = Math.min(
          best,
          scheduledCondensationTerm4(de, depth, bScale, bX, bY, bZ, bW, bState),
        );
      }
      if (v1Live) {
        best = Math.min(
          best,
          scheduledCondensationTerm4(
            de,
            depth,
            v1Scale,
            v1X,
            v1Y,
            v1Z,
            v1W,
            v1State,
          ),
        );
      }
      if (v2Live) {
        best = Math.min(
          best,
          scheduledCondensationTerm4(
            de,
            depth,
            v2Scale,
            v2X,
            v2Y,
            v2Z,
            v2W,
            v2State,
          ),
        );
      }
    }
    const futureCondensation = scheduledCondensationHasFutureDepth4(
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
    let c1W = 0;
    let c1Scale = 1;
    let c1R = 0;
    let c1Cert = 0;
    let c1State = SURFACE_CHAOS_WILDCARD;
    let c2Key = Infinity;
    let c2X = 0;
    let c2Y = 0;
    let c2Z = 0;
    let c2W = 0;
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
    let c3W = 0;
    let c3Scale = 1;
    let c3R = 0;
    let c3Cert = 0;
    let c3State = SURFACE_CHAOS_WILDCARD;
    let c4Key = Infinity;
    let c4X = 0;
    let c4Y = 0;
    let c4Z = 0;
    let c4W = 0;
    let c4Scale = 1;
    let c4R = 0;
    let c4Cert = 0;
    let c4State = SURFACE_CHAOS_WILDCARD;
    for (let c = 0; c < 4; c++) {
      let pX: number;
      let pY: number;
      let pZ: number;
      let pW: number;
      // Read-only alias of the chain's own extent buffer — every write below
      // lands in `imgExt` or the sector scratch `sweepExt` (a copy), never
      // here.
      let pExt: Float64Array;
      let pScale: number;
      let pState: number;
      if (c === 0) {
        if (!aLive) continue;
        pX = aX;
        pY = aY;
        pZ = aZ;
        pW = aW;
        pExt = aExt;
        pScale = aScale;
        pState = aState;
      } else if (c === 1) {
        if (!bLive) continue;
        pX = bX;
        pY = bY;
        pZ = bZ;
        pW = bW;
        pExt = bExt;
        pScale = bScale;
        pState = bState;
      } else if (c === 2) {
        if (!v1Live) continue;
        pX = v1X;
        pY = v1Y;
        pZ = v1Z;
        pW = v1W;
        pExt = v1Ext;
        pScale = v1Scale;
        pState = v1State;
      } else {
        if (!v2Live) continue;
        pX = v2X;
        pY = v2Y;
        pZ = v2Z;
        pW = v2W;
        pExt = v2Ext;
        pScale = v2Scale;
        pState = v2State;
      }
      // Sector sweep (3D's shape one dimension up): the chain
      // point — and, under a slab query, its half-extent, since the backward
      // step is an isometry taking segments to segments — turns one step per
      // kaleidoscope sector, and every BASE map is applied to it there, so
      // the candidates and their SECTOR-MAJOR enumeration order (k*n + i,
      // exactly chaos-game-4d's expansion slots) are the ones the expansion
      // would have produced. The ladders below therefore break ties the same
      // way, and the beam, the validity slots and the exits see an unchanged
      // stream. See the module doc's SYMMETRY section for why a single wedge
      // FOLD would not be sound here.
      let sX = pX;
      let sY = pY;
      let sZ = pZ;
      let sW = pW;
      if (segment) sweepExt.set(pExt);
      for (let k = 0; k < sectorOrder; k++) {
        if (k > 0) {
          stepSector4(stepBack, sX, sY, sZ, sW, sweep);
          sX = sweep[0];
          sY = sweep[1];
          sZ = sweep[2];
          sW = sweep[3];
          if (segment) applyLinear4(stepBack, sweepExt, sweepExt);
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
          const ix = im[0] * sX + im[1] * sY + im[2] * sZ + im[3] * sW + it[0];
          const iy = im[4] * sX + im[5] * sY + im[6] * sZ + im[7] * sW + it[1];
          const iz =
            im[8] * sX + im[9] * sY + im[10] * sZ + im[11] * sW + it[2];
          const iw =
            im[12] * sX + im[13] * sY + im[14] * sZ + im[15] * sW + it[3];
          if (segment) applyLinear4(im, sweepExt, imgExt);
          const r = segmentRadius(ix, iy, iz, iw, imgExt);
          const key = pScale * (r - R);
          const childScale = pScale * map.sigmaMin;
          const cert = childScale * (r - R);
          if (condensation) {
            const shapeTerm = scheduledCondensationTerm4(
              de,
              depth + 1,
              childScale,
              ix,
              iy,
              iz,
              iw,
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
          let eW = iw;
          eExt.set(imgExt);
          let eScale = childScale;
          let eR = r;
          let eCert = cert;
          let eState = childState;
          if (key < c1Key) {
            eKey = c2Key;
            eX = c2X;
            eY = c2Y;
            eZ = c2Z;
            eW = c2W;
            eExt.set(c2Ext);
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            eState = c2State;
            c2Key = c1Key;
            c2X = c1X;
            c2Y = c1Y;
            c2Z = c1Z;
            c2W = c1W;
            c2Ext.set(c1Ext);
            c2Scale = c1Scale;
            c2R = c1R;
            c2Cert = c1Cert;
            c2State = c1State;
            c1Key = key;
            c1X = ix;
            c1Y = iy;
            c1Z = iz;
            c1W = iw;
            c1Ext.set(imgExt);
            c1Scale = childScale;
            c1R = r;
            c1Cert = cert;
            c1State = childState;
          } else if (key < c2Key) {
            eKey = c2Key;
            eX = c2X;
            eY = c2Y;
            eZ = c2Z;
            eW = c2W;
            eExt.set(c2Ext);
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            eState = c2State;
            c2Key = key;
            c2X = ix;
            c2Y = iy;
            c2Z = iz;
            c2W = iw;
            c2Ext.set(imgExt);
            c2Scale = childScale;
            c2R = r;
            c2Cert = cert;
            c2State = childState;
          }
          if (extra > 0) {
            // Spill into the rank-3/4 ladder; what THAT evicts (or the
            // spilled tuple itself, when it beats neither slot) falls
            // through to the fold below — which reads radius + certificate
            // only, so evictions narrow to that pair.
            if (eKey < c3Key) {
              const tKey = extra > 1 ? c4Key : c3Key;
              const tScale = extra > 1 ? c4Scale : c3Scale;
              const tR = extra > 1 ? c4R : c3R;
              const tCert = extra > 1 ? c4Cert : c3Cert;
              if (extra > 1) {
                c4Key = c3Key;
                c4X = c3X;
                c4Y = c3Y;
                c4Z = c3Z;
                c4W = c3W;
                c4Ext.set(c3Ext);
                c4Scale = c3Scale;
                c4R = c3R;
                c4Cert = c3Cert;
                c4State = c3State;
              }
              c3Key = eKey;
              c3X = eX;
              c3Y = eY;
              c3Z = eZ;
              c3W = eW;
              c3Ext.set(eExt);
              c3Scale = eScale;
              c3R = eR;
              c3Cert = eCert;
              c3State = eState;
              eKey = tKey;
              eScale = tScale;
              eR = tR;
              eCert = tCert;
            } else if (extra > 1 && eKey < c4Key) {
              const tKey = c4Key;
              const tScale = c4Scale;
              const tR = c4R;
              const tCert = c4Cert;
              c4Key = eKey;
              c4X = eX;
              c4Y = eY;
              c4Z = eZ;
              c4W = eW;
              c4Ext.set(eExt);
              c4Scale = eScale;
              c4R = eR;
              c4Cert = eCert;
              c4State = eState;
              eKey = tKey;
              eScale = tScale;
              eR = tR;
              eCert = tCert;
            }
          }
          // The tuple leaving the beam frontier: escaped candidates fold
          // their plain certificate; an in-sphere tuple carries no positive
          // certificate — on widths 3/4 it can only get here past FOUR
          // smaller keys, the (shrunken) residual drop the slots exist for.
          if (eR > R && eCert < best) best = eCert;
          else if (eKey < Infinity && futureCondensation && eR <= R) {
            const subtree = eScale * (eR - R);
            if (subtree < best) best = subtree;
          }
        }
      }
    }
    // Promote: the best candidate always continues as chain A (or, past
    // the escape radius, folds its terminal and dies); the runner-up
    // becomes chain B only on width-2+ systems — width 1 folds it frozen,
    // exactly the classic sibling certificate. Ranks 3/4 (widths 3/4)
    // continue as validity chains ONLY while in-sphere; escaped they fold
    // the same certificate they would have folded without the slots.
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
        aW = c1W;
        aExt.set(c1Ext);
        aScale = c1Scale;
        aR = c1R;
        aState = c1State;
        aLive = true;
      }
    }
    if (c2Key < Infinity) {
      if (!wide || c2R > escapeRadius) {
        if (c2R > R && c2Cert < best) best = c2Cert;
        else if (!wide && futureCondensation && c2R <= R) {
          const subtree = c2Scale * (c2R - R);
          if (subtree < best) best = subtree;
        }
      } else {
        bX = c2X;
        bY = c2Y;
        bZ = c2Z;
        bW = c2W;
        bExt.set(c2Ext);
        bScale = c2Scale;
        bR = c2R;
        bState = c2State;
        bLive = true;
      }
    }
    if (extra > 0 && c3Key < Infinity) {
      if (c3R > R) {
        if (c3Cert < best) best = c3Cert;
      } else {
        v1X = c3X;
        v1Y = c3Y;
        v1Z = c3Z;
        v1W = c3W;
        v1Ext.set(c3Ext);
        v1Scale = c3Scale;
        v1State = c3State;
        v1Live = true;
      }
    }
    if (extra > 1 && c4Key < Infinity) {
      if (c4R > R) {
        if (c4Cert < best) best = c4Cert;
      } else {
        v2X = c4X;
        v2Y = c4Y;
        v2Z = c4Z;
        v2W = c4W;
        v2Ext.set(c4Ext);
        v2Scale = c4Scale;
        v2State = c4State;
        v2Live = true;
      }
    }
  }

  // Terminal bound of chains alive at the depth cap (the KIFS last-value
  // formula): non-positive when the chain tracked the attractor all the
  // way down.
  if (condensation) {
    if (aLive) {
      best = Math.min(
        best,
        scheduledCondensationTerm4(
          de,
          de.maxDepth,
          aScale,
          aX,
          aY,
          aZ,
          aW,
          aState,
        ),
      );
    }
    if (bLive) {
      best = Math.min(
        best,
        scheduledCondensationTerm4(
          de,
          de.maxDepth,
          bScale,
          bX,
          bY,
          bZ,
          bW,
          bState,
        ),
      );
    }
    if (v1Live) {
      best = Math.min(
        best,
        scheduledCondensationTerm4(
          de,
          de.maxDepth,
          v1Scale,
          v1X,
          v1Y,
          v1Z,
          v1W,
          v1State,
        ),
      );
    }
    if (v2Live) {
      best = Math.min(
        best,
        scheduledCondensationTerm4(
          de,
          de.maxDepth,
          v2Scale,
          v2X,
          v2Y,
          v2Z,
          v2W,
          v2State,
        ),
      );
    }
  }
  const terminalR = de.schedule
    ? de.schedule.bounds[Math.min(de.maxDepth, de.schedule.depth)].radius
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
  let d = best;
  if (sphereBound > d) d = sphereBound;
  return d * finalScale;
}

/** The descent's return value for a running min: the folded terms' min
 * floored by the depth-0 sphere bound, then un-scaled by the final lens.
 * {@link estimateDistance4Refined}'s tail and each of its cutoff exits land
 * here, so an early exit cannot drift from the full result it stands in for.
 * A private copy of the 3D twin's helper, like `isActive` above. */
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
 * Certificate-refinement variant of {@link estimateDistance4}: identical
 * greedy descent, terminal KIFS bound, depth-0 sphere floor, and
 * final-transform lens prologue/epilogue — the only change is what
 * certificate an ESCAPED sibling (`r_j > R`) earns. The base
 * version stops at one Hutchinson level (`sigmaMin_j * (r_j - R)`, the base
 * case `dist(q, A) >= |q| - R` applied directly to the sibling's own inverse
 * image `q'_j`); this variant applies one MORE level before settling:
 *
 *     inner_j = min over ALL (sector, map k) pairs of
 *               [ sigmaMin_k * (|invMap_k(g_sector^T q'_j)| - R) ]
 *     cert_j  = sigmaMin_j * max( r_j - R, inner_j )
 *
 * (the sector sweep — at order 1 exactly the historical
 * min-over-maps)
 *
 * Widths 3/4 add the validity slots exactly as the base estimator
 * does (rank-3/4 chains that live only while in-sphere, closing the
 * 3-and-4-simultaneous drops); their escaped rank-3/4 candidates fold
 * through this same guarded refined path, indistinguishable from the
 * width-2 runner-up's fold site.
 *
 * VALIDITY. Each `inner_j` term lower-bounds `dist(q'_j, f_k(A))` regardless
 * of sign — an inner image landing inside the bounding sphere gives a `<= 0`
 * term, trivially a valid (if useless) lower bound — so the `min` over every
 * `k` lower-bounds `dist(q'_j, A)` itself (the same "min of per-branch lower
 * bounds lower-bounds the overall min" argument the module doc's VALIDITY
 * section already leans on). `max`ing that in against the untouched base
 * case can only RAISE the certificate, never lower it:
 * `estimateDistance4Refined(de, p) >= estimateDistance4(de, p)` at every
 * `p` — pinned by `surface-de-4d.test.ts`'s "never falls below the base
 * estimate" test.
 *
 * WHY THIS EXISTS. The spike measured WHICH term of
 * {@link estimateDistance4}'s `min(best, terminal)` (floored by the depth-0
 * sphere bound) produces
 * every false-hit ("ghost") a `w = w0` slice march would register: on every
 * system measured, 100% of measured ghost points traced to the
 * sibling-certificate term (`best`), NEVER the terminal bound or the sphere
 * floor — and the winning certificate was fixed almost immediately (median
 * recording depth 0-1 of a 14-level cap on pentatope). That is exactly a
 * barely-escaped sibling (`r_j` just past `R`) whose certificate never gets
 * refined again, because the base case is the ENTIRE Hutchinson
 * decomposition it receives — one more level closes most of that gap. See
 * the module doc's SPIKE VERDICT section for the measured numbers this
 * conclusion rests on.
 *
 * COST. Refinement is paid lazily, at FOLD time: only candidates actually
 * frozen into the running min (evicted from or rejected by the beam, or
 * the width-1 runner-up) run the extra inner level — beam-selected
 * candidates are refined by their own deeper descent instead, and a
 * chain's terminal fold (escape or depth cap) stays the plain KIFS bound,
 * exactly like the base estimator's. That folds the same set of values the
 * spike's exhaustive variant minimized (every escaped non-descended
 * sibling), at strictly less work than the measured 5.65x exhaustive
 * ceiling — the shape the SPIKE VERDICT's cost note said a GPU port
 * should take. On top of that, every refined fold site carries the
 * fold-time laziness guard (backported alongside the 3D
 * `estimateDistanceRefined`): refinement can only RAISE a certificate, so
 * a fold whose PLAIN certificate already fails to beat the running min
 * folds nothing either way (`min(best, refined) === best` whenever
 * `plain >= best`) and the inner sweep is skipped. Bit-exact — every
 * number in the SPIKE VERDICT above is unchanged — while the extra
 * sweeps collapse to the folds that actually advance the min.
 *
 * EARLY-OUT CUTOFF, the 3D twin's `estimateDistanceRefined`
 * contract verbatim. A sphere-tracing march needs a hit DECISION, not a
 * distance: `cutoff` is its acceptance epsilon at the query point, and the
 * descent may stop the moment the value it would return is already below
 * it. `cutoff <= 0` (the default) is the full descent, bit-for-bit — what
 * normal probes, occlusion taps, shadow rays and every test pass. For
 * `cutoff > 0`: a returned value `>= cutoff` EQUALS the `cutoff = 0` result
 * bit-for-bit (early exits only ever return below the cutoff, so march
 * steps above the hit threshold never drift), and a returned value
 * `< cutoff` guarantees the `cutoff = 0` result is `< cutoff` too.
 *
 * Both rest on the descent being MONOTONE — the returned value is
 * `max(best, sphereBound) * finalScale`, and `best` only ever falls while
 * the other two are fixed by the prologue — and on the exits reading only
 * FINALIZED terms: `best` is only ever ASSIGNED a settled bound (the
 * REFINED certificate at every refined fold site, never the plain key that
 * gates it), so the running min is at all times a min over terms the full
 * computation also contains. Exiting on a raw pre-refinement certificate
 * instead would re-open the exact ghost class refinement exists to kill —
 * a barely-escaped sibling dips under the cutoff, the full descent lifts it
 * back above, and the march paints a membrane across a void.
 *
 * SPHERE FLOOR, the 3D twin's contract one dimension up (see
 * estimateDistanceRefined's paragraph for where the exit pays — live on
 * anisotropic maps, provably dead on isotropic invariant-ball ones, since
 * `|p - t| - sigma R >= |p| - R` inducts down every chain). Once `best`
 * falls to or below the depth-0 sphere bound, the eventual return is
 * already pinned: `descentValue` clamps through `max(best, sphereBound)`,
 * and `best` is a monotone min, so no later fold can lift the clamp back
 * off `sphereBound`. The descent therefore exits the instant
 * `best <= sphereBound`, unconditionally — no cutoff involved — and the
 * value it returns equals the full descent's, bit-for-bit, always, unlike
 * the cutoff exit above which is exact only at or above a cutoff. Plain
 * `estimateDistance4` does NOT carry this exit: unlike 3D, where both
 * estimators share `descend` and the plain one picks the exit up
 * structurally, the two 4D estimators predate the cutoff machinery and
 * stay self-contained (see the module doc) — this exit is deliberately
 * scoped to the refined estimator only.
 *
 * Routing: same three-way split as `estimateDistance4` — lens
 * sweep, fold frontier, affine ladder — with `refine: true` and the cutoff
 * threaded through. Slab refusal identical ({@link slabExact4}).
 */
export function estimateDistance4Refined(
  de: SurfaceDE4,
  p: Vec4,
  cutoff = 0,
  halfExtent: Vec4 | null = null,
): number {
  if (halfExtent && isSegment(halfExtent) && !slabExact4(de)) {
    throw new Error(
      "surface-de-4d: slab queries are unsound for this system's folds " +
        "or condensation shape — clamp sliceHalfW to 0 " +
        "for this system (slabExact4)",
    );
  }
  if (de.foldFinal) return descendLens4(de, p, true, cutoff, halfExtent);
  if (deHasFolds4(de)) return descendFold4(de, p, true, cutoff, halfExtent);
  return descend4Refined(de, p, cutoff, halfExtent);
}

function descend4Refined(
  de: SurfaceDE4,
  p: Vec4,
  cutoff = 0,
  halfExtent: Vec4 | null = null,
): number {
  let x = p[0];
  let y = p[1];
  let z = p[2];
  let w = p[3];
  // The query's half-extent, carried alongside the point down every chain.
  // Zero — the default — is the point query this module shipped with, and
  // every term below collapses to it exactly (see `segmentRadius`).
  const segment = isSegment(halfExtent);
  const ext = new Float64Array(4);
  if (segment) ext.set(halfExtent);
  let finalScale = 1;
  if (de.final) {
    const f = de.final;
    const im = f.invM;
    const it = f.invT;
    const qx = im[0] * x + im[1] * y + im[2] * z + im[3] * w + it[0];
    const qy = im[4] * x + im[5] * y + im[6] * z + im[7] * w + it[1];
    const qz = im[8] * x + im[9] * y + im[10] * z + im[11] * w + it[2];
    const qw = im[12] * x + im[13] * y + im[14] * z + im[15] * w + it[3];
    x = qx;
    y = qy;
    z = qz;
    w = qw;
    // The lens carries the extent by its LINEAR part alone.
    if (segment) applyLinear4(im, ext, ext);
    finalScale = f.sigmaMin;
  }

  // Kaleidoscope sectors swept around the base maps — `order` 1
  // leaves every `k > 0` branch below dead, so a system without symmetry
  // runs the pre-sweep arithmetic unchanged. `sweep`/`sweepExt` are the
  // descent body's sector scratch; `refinedCert` below carries its OWN pair,
  // because it sweeps from INSIDE the candidate loop where these are live.
  const { order, stepBack } = de.symmetry;
  const sweep = [0, 0, 0, 0];
  const sweepExt = new Float64Array(4);

  const R = de.boundingRadius;
  const condensation = de.condensation;
  const startR = segmentRadius(x, y, z, w, ext);
  const sphereBound = startR - R;
  const wide = de.beamWidth > 1;
  let best = Infinity;

  // Early-out threshold: the value below which the descent may stop and hand
  // the caller what it has. `-Infinity` disables the test — for `cutoff <= 0`
  // (callers that need the distance itself), and for a depth-0 sphere floor
  // that already holds the answer at or above the cutoff no matter how far
  // `best` falls, since the floor is what the return would clamp to. Both
  // exits below test `best * finalScale` against it AFTER a fold, never a raw
  // pre-refinement key. (That sphere floor case now has its own unconditional
  // exit — the sphere-floor pin below — that fires the moment `best` reaches
  // it, cutoff or not.)
  const bailBelow =
    cutoff > 0 && sphereBound * finalScale < cutoff ? cutoff : -Infinity;

  // One extra Hutchinson level on a frozen escaped candidate's own inverse
  // image, over every (sector, base map) pair (see the doc comment's
  // VALIDITY note): the certificate becomes childScale * max(r - R, inner)
  // — never below the base estimator's childScale * (r - R). The inner min
  // must cover the same candidate set the descent sweeps, or a
  // symmetric system's certificate would skip its rotated pieces.
  // `certSweep`/`certSweepExt` are this refinement's OWN sector scratch,
  // distinct from the descent body's `sweep`/`sweepExt`: refinement runs
  // from INSIDE the candidate loop, where those are live — the 3D twin's
  // module-scope CERT_SWEEP rationale, function-scoped here because
  // `refinedCert` is already a per-call closure rather than a module-level
  // helper.
  const innerExt = new Float64Array(4);
  const certSweep = [0, 0, 0, 0];
  const certSweepExt = new Float64Array(4);
  const refinedCert = (
    ix: number,
    iy: number,
    iz: number,
    iw: number,
    iExt: Float64Array,
    r: number,
    childScale: number,
    depth: number,
    currentState: number,
  ): number => {
    const inB = de.schedule !== undefined && depth < de.schedule.depth;
    const levelMaps = inB ? de.schedule!.maps : de.maps;
    const sectorOrder = inB ? 1 : order;
    const currentR = de.schedule
      ? de.schedule.bounds[Math.min(depth, de.schedule.depth)].radius
      : de.boundingRadius;
    const childR = de.schedule
      ? de.schedule.bounds[Math.min(depth + 1, de.schedule.depth)].radius
      : de.boundingRadius;
    let inner = scheduledCondensationTerm4(
      de,
      depth,
      1,
      ix,
      iy,
      iz,
      iw,
      currentState,
    );
    let sx = ix;
    let sy = iy;
    let sz = iz;
    let sw = iw;
    if (segment) certSweepExt.set(iExt);
    for (let k = 0; k < sectorOrder; k++) {
      if (k > 0) {
        stepSector4(stepBack, sx, sy, sz, sw, certSweep);
        sx = certSweep[0];
        sy = certSweep[1];
        sz = certSweep[2];
        sw = certSweep[3];
        if (segment) applyLinear4(stepBack, certSweepExt, certSweepExt);
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
        const jx =
          imJ[0] * sx + imJ[1] * sy + imJ[2] * sz + imJ[3] * sw + itJ[0];
        const jy =
          imJ[4] * sx + imJ[5] * sy + imJ[6] * sz + imJ[7] * sw + itJ[1];
        const jz =
          imJ[8] * sx + imJ[9] * sy + imJ[10] * sz + imJ[11] * sw + itJ[2];
        const jw =
          imJ[12] * sx + imJ[13] * sy + imJ[14] * sz + imJ[15] * sw + itJ[3];
        if (segment) applyLinear4(imJ, certSweepExt, innerExt);
        const rj = segmentRadius(jx, jy, jz, jw, innerExt);
        const innerTerm = mapJ.sigmaMin * (rj - childR);
        if (innerTerm < inner) inner = innerTerm;
      }
    }
    return childScale * Math.max(r - currentR, inner);
  };

  // Chain slot A starts at the (lensed) query; slot B idles until beam
  // selection fills it (width-2 up). V1/V2 are the validity slots
  // (widths 3/4): they hold the level's rank-3/4 candidates ONLY while
  // those are in-sphere — branches that carry no positive certificate, so
  // dropping them was the measured invalidity — and fold the ordinary
  // refined certificate the moment they escape.
  //
  // Each slot's segment half-extent rides in its own 4-element buffer rather
  // than four more unrolled scalars: that keeps this body line-for-line with
  // the GLSL mirror, where the same quantity is one `vec4`. The candidate and
  // eviction buffers are hoisted out of the depth loop (the GLSL declares
  // them inside it, where declarations are free) — safe because a slot's
  // contents are read only once its own key/radius sentinel says it is
  // occupied, and occupancy is re-decided from scratch every level.
  const extra = de.beamWidth - 2;
  let aX = x;
  let aY = y;
  let aZ = z;
  let aW = w;
  const aExt = new Float64Array(ext);
  let aScale = 1;
  let aR = startR;
  let aState = SURFACE_CHAOS_WILDCARD;
  let aLive = true;
  let bX = 0;
  let bY = 0;
  let bZ = 0;
  let bW = 0;
  const bExt = new Float64Array(4);
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
  let v1W = 0;
  const v1Ext = new Float64Array(4);
  let v1Scale = 1;
  let v1State = SURFACE_CHAOS_WILDCARD;
  let v1Live = false;
  let v2X = 0;
  let v2Y = 0;
  let v2Z = 0;
  let v2W = 0;
  const v2Ext = new Float64Array(4);
  let v2Scale = 1;
  let v2State = SURFACE_CHAOS_WILDCARD;
  let v2Live = false;
  const c1Ext = new Float64Array(4);
  const c2Ext = new Float64Array(4);
  const c3Ext = new Float64Array(4);
  const c4Ext = new Float64Array(4);
  const eExt = new Float64Array(4);
  const imgExt = new Float64Array(4);
  const tExt = new Float64Array(4);

  for (let depth = 0; depth < de.maxDepth; depth++) {
    if (!aLive && !bLive && !v1Live && !v2Live) break;
    const inB = de.schedule !== undefined && depth < de.schedule.depth;
    const levelMaps = inB ? de.schedule!.maps : de.maps;
    const sectorOrder = inB ? 1 : order;
    const childBound = de.schedule
      ? de.schedule.bounds[Math.min(depth + 1, de.schedule.depth)]
      : null;
    const R = childBound ? childBound.radius : de.boundingRadius;
    const escapeRadius = childBound ? childBound.escapeRadius : de.escapeRadius;
    if (condensation) {
      if (aLive) {
        best = Math.min(
          best,
          scheduledCondensationTerm4(de, depth, aScale, aX, aY, aZ, aW, aState),
        );
      }
      if (bLive) {
        best = Math.min(
          best,
          scheduledCondensationTerm4(de, depth, bScale, bX, bY, bZ, bW, bState),
        );
      }
      if (v1Live) {
        best = Math.min(
          best,
          scheduledCondensationTerm4(
            de,
            depth,
            v1Scale,
            v1X,
            v1Y,
            v1Z,
            v1W,
            v1State,
          ),
        );
      }
      if (v2Live) {
        best = Math.min(
          best,
          scheduledCondensationTerm4(
            de,
            depth,
            v2Scale,
            v2X,
            v2Y,
            v2Z,
            v2W,
            v2State,
          ),
        );
      }
      if (best <= sphereBound || best * finalScale < bailBelow) {
        return descentValue(best, sphereBound, finalScale);
      }
    }
    const futureCondensation = scheduledCondensationHasFutureDepth4(
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
    let c1W = 0;
    let c1Scale = 1;
    let c1R = 0;
    let c1Cert = 0;
    let c1State = SURFACE_CHAOS_WILDCARD;
    let c2Key = Infinity;
    let c2X = 0;
    let c2Y = 0;
    let c2Z = 0;
    let c2W = 0;
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
    let c3W = 0;
    let c3Scale = 1;
    let c3R = 0;
    let c3Cert = 0;
    let c3State = SURFACE_CHAOS_WILDCARD;
    let c4Key = Infinity;
    let c4X = 0;
    let c4Y = 0;
    let c4Z = 0;
    let c4W = 0;
    let c4Scale = 1;
    let c4R = 0;
    let c4Cert = 0;
    let c4State = SURFACE_CHAOS_WILDCARD;
    for (let c = 0; c < 4; c++) {
      let pX: number;
      let pY: number;
      let pZ: number;
      let pW: number;
      // Read-only alias of the chain's own extent buffer — every write below
      // lands in `imgExt` or the sector scratch `sweepExt` (a copy), never
      // here.
      let pExt: Float64Array;
      let pScale: number;
      let pState: number;
      if (c === 0) {
        if (!aLive) continue;
        pX = aX;
        pY = aY;
        pZ = aZ;
        pW = aW;
        pExt = aExt;
        pScale = aScale;
        pState = aState;
      } else if (c === 1) {
        if (!bLive) continue;
        pX = bX;
        pY = bY;
        pZ = bZ;
        pW = bW;
        pExt = bExt;
        pScale = bScale;
        pState = bState;
      } else if (c === 2) {
        if (!v1Live) continue;
        pX = v1X;
        pY = v1Y;
        pZ = v1Z;
        pW = v1W;
        pExt = v1Ext;
        pScale = v1Scale;
        pState = v1State;
      } else {
        if (!v2Live) continue;
        pX = v2X;
        pY = v2Y;
        pZ = v2Z;
        pW = v2W;
        pExt = v2Ext;
        pScale = v2Scale;
        pState = v2State;
      }
      // Sector sweep (3D's shape one dimension up): the chain
      // point — and, under a slab query, its half-extent, since the backward
      // step is an isometry taking segments to segments — turns one step per
      // kaleidoscope sector, and every BASE map is applied to it there, so
      // the candidates and their SECTOR-MAJOR enumeration order (k*n + i,
      // exactly chaos-game-4d's expansion slots) are the ones the expansion
      // would have produced. The ladders below therefore break ties the same
      // way, and the beam, the validity slots and the exits see an unchanged
      // stream. See the module doc's SYMMETRY section for why a single wedge
      // FOLD would not be sound here.
      let sX = pX;
      let sY = pY;
      let sZ = pZ;
      let sW = pW;
      if (segment) sweepExt.set(pExt);
      for (let k = 0; k < sectorOrder; k++) {
        if (k > 0) {
          stepSector4(stepBack, sX, sY, sZ, sW, sweep);
          sX = sweep[0];
          sY = sweep[1];
          sZ = sweep[2];
          sW = sweep[3];
          if (segment) applyLinear4(stepBack, sweepExt, sweepExt);
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
          const ix = im[0] * sX + im[1] * sY + im[2] * sZ + im[3] * sW + it[0];
          const iy = im[4] * sX + im[5] * sY + im[6] * sZ + im[7] * sW + it[1];
          const iz =
            im[8] * sX + im[9] * sY + im[10] * sZ + im[11] * sW + it[2];
          const iw =
            im[12] * sX + im[13] * sY + im[14] * sZ + im[15] * sW + it[3];
          if (segment) applyLinear4(im, sweepExt, imgExt);
          const r = segmentRadius(ix, iy, iz, iw, imgExt);
          const key = pScale * (r - R);
          const childScale = pScale * map.sigmaMin;
          const cert = childScale * (r - R);
          if (condensation) {
            const shapeTerm = scheduledCondensationTerm4(
              de,
              depth + 1,
              childScale,
              ix,
              iy,
              iz,
              iw,
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
          let eW = iw;
          eExt.set(imgExt);
          let eScale = childScale;
          let eR = r;
          let eCert = cert;
          let eState = childState;
          if (key < c1Key) {
            eKey = c2Key;
            eX = c2X;
            eY = c2Y;
            eZ = c2Z;
            eW = c2W;
            eExt.set(c2Ext);
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            eState = c2State;
            c2Key = c1Key;
            c2X = c1X;
            c2Y = c1Y;
            c2Z = c1Z;
            c2W = c1W;
            c2Ext.set(c1Ext);
            c2Scale = c1Scale;
            c2R = c1R;
            c2Cert = c1Cert;
            c2State = c1State;
            c1Key = key;
            c1X = ix;
            c1Y = iy;
            c1Z = iz;
            c1W = iw;
            c1Ext.set(imgExt);
            c1Scale = childScale;
            c1R = r;
            c1Cert = cert;
            c1State = childState;
          } else if (key < c2Key) {
            eKey = c2Key;
            eX = c2X;
            eY = c2Y;
            eZ = c2Z;
            eW = c2W;
            eExt.set(c2Ext);
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            eState = c2State;
            c2Key = key;
            c2X = ix;
            c2Y = iy;
            c2Z = iz;
            c2W = iw;
            c2Ext.set(imgExt);
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
              // The evicted key is dead past this point — only the folded
              // fields (point, scale, radius, certificate) survive.
              const tX = extra > 1 ? c4X : c3X;
              const tY = extra > 1 ? c4Y : c3Y;
              const tZ = extra > 1 ? c4Z : c3Z;
              const tW = extra > 1 ? c4W : c3W;
              tExt.set(extra > 1 ? c4Ext : c3Ext);
              const tScale = extra > 1 ? c4Scale : c3Scale;
              const tR = extra > 1 ? c4R : c3R;
              const tCert = extra > 1 ? c4Cert : c3Cert;
              const tState = extra > 1 ? c4State : c3State;
              if (extra > 1) {
                c4Key = c3Key;
                c4X = c3X;
                c4Y = c3Y;
                c4Z = c3Z;
                c4W = c3W;
                c4Ext.set(c3Ext);
                c4Scale = c3Scale;
                c4R = c3R;
                c4Cert = c3Cert;
                c4State = c3State;
              }
              c3Key = eKey;
              c3X = eX;
              c3Y = eY;
              c3Z = eZ;
              c3W = eW;
              c3Ext.set(eExt);
              c3Scale = eScale;
              c3R = eR;
              c3Cert = eCert;
              c3State = eState;
              eX = tX;
              eY = tY;
              eZ = tZ;
              eW = tW;
              eExt.set(tExt);
              eScale = tScale;
              eR = tR;
              eCert = tCert;
              eState = tState;
            } else if (extra > 1 && eKey < c4Key) {
              const tX = c4X;
              const tY = c4Y;
              const tZ = c4Z;
              const tW = c4W;
              tExt.set(c4Ext);
              const tScale = c4Scale;
              const tR = c4R;
              const tCert = c4Cert;
              const tState = c4State;
              c4Key = eKey;
              c4X = eX;
              c4Y = eY;
              c4Z = eZ;
              c4W = eW;
              c4Ext.set(eExt);
              c4Scale = eScale;
              c4R = eR;
              c4Cert = eCert;
              c4State = eState;
              eX = tX;
              eY = tY;
              eZ = tZ;
              eW = tW;
              eExt.set(tExt);
              eScale = tScale;
              eR = tR;
              eCert = tCert;
              eState = tState;
            }
          }
          // The tuple leaving the beam frontier: escaped candidates fold
          // their certificate through the guarded refined path (the guard
          // already knows the plain certificate would have advanced the
          // min); an in-sphere tuple carries no positive certificate — on
          // widths 3/4 it can only get here past FOUR smaller keys, the
          // (shrunken) residual drop the slots exist for.
          if (eR > R && eCert < best) {
            const rc = refinedCert(
              eX,
              eY,
              eZ,
              eW,
              eExt,
              eR,
              eScale,
              depth + 1,
              eState,
            );
            if (rc < best) {
              best = rc;
              // Cutoff exit plus the sphere-floor pin.
              // `rc` is FINALIZED — already refined — and `best` only
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
            const subtree = eScale * (eR - R);
            if (subtree < best) best = subtree;
          }
        }
      }
    }
    // Promote: the best candidate always continues as chain A (or, past
    // the escape radius, folds its terminal and dies); the runner-up
    // becomes chain B only on width-2+ systems — width 1 folds it frozen,
    // the classic frozen sibling refined path measures every ghost back
    // to. Ranks 3/4 (widths 3/4) continue as validity chains ONLY while
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
        aW = c1W;
        aExt.set(c1Ext);
        aScale = c1Scale;
        aR = c1R;
        aState = c1State;
        aLive = true;
      }
    }
    if (c2Key < Infinity) {
      if (!wide) {
        if (c2R > R && c2Cert < best) {
          const rc = refinedCert(
            c2X,
            c2Y,
            c2Z,
            c2W,
            c2Ext,
            c2R,
            c2Scale,
            depth + 1,
            c2State,
          );
          if (rc < best) best = rc;
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
        bW = c2W;
        bExt.set(c2Ext);
        bScale = c2Scale;
        bR = c2R;
        bState = c2State;
        bLive = true;
      }
    }
    if (extra > 0 && c3Key < Infinity) {
      if (c3R > R) {
        if (c3Cert < best) {
          const rc = refinedCert(
            c3X,
            c3Y,
            c3Z,
            c3W,
            c3Ext,
            c3R,
            c3Scale,
            depth + 1,
            c3State,
          );
          if (rc < best) best = rc;
        }
      } else {
        v1X = c3X;
        v1Y = c3Y;
        v1Z = c3Z;
        v1W = c3W;
        v1Ext.set(c3Ext);
        v1Scale = c3Scale;
        v1State = c3State;
        v1Live = true;
      }
    }
    if (extra > 1 && c4Key < Infinity) {
      if (c4R > R) {
        if (c4Cert < best) {
          const rc = refinedCert(
            c4X,
            c4Y,
            c4Z,
            c4W,
            c4Ext,
            c4R,
            c4Scale,
            depth + 1,
            c4State,
          );
          if (rc < best) best = rc;
        }
      } else {
        v2X = c4X;
        v2Y = c4Y;
        v2Z = c4Z;
        v2W = c4W;
        v2Ext.set(c4Ext);
        v2Scale = c4Scale;
        v2State = c4State;
        v2Live = true;
      }
    }
    // Cutoff exit plus the sphere-floor pin, covering
    // the four promote folds above in one test: each of them either wrote
    // a settled certificate into `best` (a refined one at the two
    // validity-slot sites and the width-1 runner-up, the deliberately
    // plain escape-radius bound at the other two) or continued a chain,
    // and neither the rest of this level nor any deeper one can raise the
    // running min back. Once `best` is at or below the depth-0 sphere
    // bound the eventual return is already pinned at `sphereBound *
    // finalScale`, so that case exits unconditionally. Deliberately NOT a
    // `break`: the terminal bounds past the loop are folds the FULL
    // descent only makes at the depth cap, and folding one here could
    // drop `best` below a value the full computation never reaches.
    if (best <= sphereBound || best * finalScale < bailBelow) {
      return descentValue(best, sphereBound, finalScale);
    }
  }

  if (condensation) {
    if (aLive) {
      best = Math.min(
        best,
        scheduledCondensationTerm4(
          de,
          de.maxDepth,
          aScale,
          aX,
          aY,
          aZ,
          aW,
          aState,
        ),
      );
    }
    if (bLive) {
      best = Math.min(
        best,
        scheduledCondensationTerm4(
          de,
          de.maxDepth,
          bScale,
          bX,
          bY,
          bZ,
          bW,
          bState,
        ),
      );
    }
    if (v1Live) {
      best = Math.min(
        best,
        scheduledCondensationTerm4(
          de,
          de.maxDepth,
          v1Scale,
          v1X,
          v1Y,
          v1Z,
          v1W,
          v1State,
        ),
      );
    }
    if (v2Live) {
      best = Math.min(
        best,
        scheduledCondensationTerm4(
          de,
          de.maxDepth,
          v2Scale,
          v2X,
          v2Y,
          v2Z,
          v2W,
          v2State,
        ),
      );
    }
  }
  const terminalR = de.schedule
    ? de.schedule.bounds[Math.min(de.maxDepth, de.schedule.depth)].radius
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

// ---------------------------------------------------------------------------
// Fold frontier scratch — 3D's `descendFold` module-scope state one
// dimension up: the CURRENT frontier (`fc*`), the next level's kept tuples
// (`fn*`, key-ascending only in the sense that the kept SET is the level's
// smallest keys — the storage itself is deliberately unsorted, see the
// insertion comment), the sector-sweep quadruple, and the slab half-extent
// buffers every point is shadowed by. Zero-allocation hot path; single-threaded
// by construction (each worker owns its module instance, and
// {@link refinedCertValue4} — which carries its OWN sweep scratch — never
// re-enters the frontier body).
//
// Every chain and candidate carries FOUR extra lanes over 3D: the `w`
// coordinate and the four half-extent components. Extent lanes are written
// only under a slab query (zero otherwise) but MOVED unconditionally with the
// coordinates — moving zeros is free and keeps insertion/eviction/promote one
// shape instead of two.
const FOLD_W4 = SURFACE_FOLD_BEAM_WIDTH;
const fcX = new Float64Array(FOLD_W4);
const fcY = new Float64Array(FOLD_W4);
const fcZ = new Float64Array(FOLD_W4);
const fcW = new Float64Array(FOLD_W4);
const fcExtX = new Float64Array(FOLD_W4);
const fcExtY = new Float64Array(FOLD_W4);
const fcExtZ = new Float64Array(FOLD_W4);
const fcExtW = new Float64Array(FOLD_W4);
const fcScale = new Float64Array(FOLD_W4);
const fcFloor = new Float64Array(FOLD_W4);
const fcR = new Float64Array(FOLD_W4);
const fcState = new Uint32Array(FOLD_W4);
const fnKey = new Float64Array(FOLD_W4);
const fnX = new Float64Array(FOLD_W4);
const fnY = new Float64Array(FOLD_W4);
const fnZ = new Float64Array(FOLD_W4);
const fnW = new Float64Array(FOLD_W4);
const fnExtX = new Float64Array(FOLD_W4);
const fnExtY = new Float64Array(FOLD_W4);
const fnExtZ = new Float64Array(FOLD_W4);
const fnExtW = new Float64Array(FOLD_W4);
const fnScale = new Float64Array(FOLD_W4);
const fnFloor = new Float64Array(FOLD_W4);
const fnR = new Float64Array(FOLD_W4);
const fnCert = new Float64Array(FOLD_W4);
const fnState = new Uint32Array(FOLD_W4);
const FOLD_SWEEP4 = [0, 0, 0, 0];
/** The (lensed) query's own half-extent — rewritten at every entry. */
const FOLD_EXT4 = new Float64Array(4);
/** The current chain's half-extent, turned one sector step at a time. */
const FOLD_SWEEP_EXT4 = new Float64Array(4);
/** The candidate child's half-extent (`invM · D · e_u`, or `invM · e` on the
 * affine arm). */
const FOLD_IMG_EXT4 = new Float64Array(4);
/** The half-extent of whatever leaves the kept set — the newcomer or the
 * displaced worst slot — for {@link refinedCertValue4}. */
const FOLD_EV_EXT4 = new Float64Array(4);
/** {@link refinedCertValue4}'s own sector scratch: refinement sweeps from
 * INSIDE the frontier body's candidate loop, where the buffers above are
 * live (3D's `CERT_SWEEP` rationale, with the extent alongside). */
const CERT_SWEEP4 = [0, 0, 0, 0];
const CERT_SWEEP_EXT4 = new Float64Array(4);
const CERT_IMG_EXT4 = new Float64Array(4);

/**
 * Zero every extent buffer a POINT query leaves untouched. Module scratch
 * outlives a call, and under `h = 0` nothing below writes these (the extent
 * propagation is `segment`-gated, exactly as in `descend4Refined`), so a
 * previous SLAB query's residue would otherwise leak in and shrink every
 * radius that reads them — a silent OVERSHOOT, the one error class this
 * module refuses to ship. One reset per point query keeps `h = 0` value-exact
 * against the pre-slab arithmetic. (The frontier's own `fc*`/`fn*` extent
 * lanes need no reset: they are written unconditionally from
 * {@link FOLD_IMG_EXT4} and {@link FOLD_EXT4}, both of which this covers.)
 */
function clearFoldSegmentScratch(): void {
  FOLD_SWEEP_EXT4.fill(0);
  FOLD_IMG_EXT4.fill(0);
  FOLD_EV_EXT4.fill(0);
  CERT_SWEEP_EXT4.fill(0);
  CERT_IMG_EXT4.fill(0);
}

/** One frontier-insertion candidate as {@link FoldFrontierTap4} reports it:
 * the floored selection key and the chain state the slot would carry. The
 * slab half-extent is deliberately absent — the replay cross-check drives
 * POINT queries, where it is identically zero. */
export interface FoldFrontierCandidate4 {
  key: number;
  x: number;
  y: number;
  z: number;
  w: number;
  scale: number;
  floor: number;
  r: number;
}

/**
 * Test-only observation tap on {@link descendFold4}'s frontier — 3D's
 * `FoldFrontierTap` one dimension up. When installed, every candidate that
 * reaches frontier INSERTION (i.e. survived the floor-vs-best prune and the
 * B&B skips and did not fold as an escape) is reported in arrival order, and
 * every level that completes its sweep reports the kept slots in slot order —
 * levels truncated by a value-exact early exit report nothing. The contract
 * this exists to pin: the kept set is exactly the level's {@link FOLD_W4}
 * smallest floored keys, a full frontier replacing its first-scanned worst
 * slot only when a STRICTLY smaller key arrives (ties evict the newcomer).
 * Production never installs a tap: the null path costs one pointer check per
 * inserted candidate and per level, and the tap reads state, never perturbs
 * it.
 */
export interface FoldFrontierTap4 {
  candidate(depth: number, c: FoldFrontierCandidate4): void;
  level(depth: number, kept: FoldFrontierCandidate4[]): void;
}

let foldFrontierTap4: FoldFrontierTap4 | null = null;

/** Install (or clear, with `null`) the {@link FoldFrontierTap4}. Tests only;
 * callers must clear the tap in a `finally`. */
export function setFoldFrontierTap4(tap: FoldFrontierTap4 | null): void {
  foldFrontierTap4 = tap;
}

/**
 * One extra Hutchinson level on a frozen escaped candidate's own inverse
 * image, over every `(sector, base map, fold branch)` triple — 3D's
 * `refinedCertValue` one dimension up: the certificate becomes
 * `childScale * max(r - R, inner)`, never below the plain
 * `childScale * (r - R)`. Called only from {@link descendFold4}'s refined
 * path, and only for folds whose PLAIN certificate already beats the running
 * min (the fold-time laziness guard). The affine ladder keeps its own
 * fold-free closure inside `descend4Refined` — that estimator predates folds
 * and stays self-contained, exactly as the two 4D estimators do.
 *
 * The inner min must cover the same candidate set the frontier expands (every
 * sector, every base map, every fold BRANCH), or a fold map's certificate
 * would skip pieces of the attractor; each term carries the same REGION
 * strengthening the frontier's certificates do,
 * `max(branchSigma·(rj − R), |w|·regionDist)`.
 *
 * `iExt` is the candidate's slab half-extent, transported here exactly as
 * the frontier transports it: turned by each sector step, scaled into u-space,
 * signed by the box branch's `diag(±1)` derivative, then carried through
 * `invM`. Under `segment === false` it is identically zero and every
 * propagation below is skipped.
 */
function refinedCertValue4(
  de: SurfaceDE4,
  ix: number,
  iy: number,
  iz: number,
  iw: number,
  iExt: Float64Array,
  r: number,
  childScale: number,
  segment: boolean,
  depth: number,
  currentState: number,
): number {
  const { order, stepBack } = de.symmetry;
  const inB = de.schedule !== undefined && depth < de.schedule.depth;
  const levelMaps = inB ? de.schedule!.maps : de.maps;
  const sectorOrder = inB ? 1 : order;
  const currentR = de.schedule
    ? de.schedule.bounds[Math.min(depth, de.schedule.depth)].radius
    : de.boundingRadius;
  const childR = de.schedule
    ? de.schedule.bounds[Math.min(depth + 1, de.schedule.depth)].radius
    : de.boundingRadius;
  let inner = scheduledCondensationTerm4(
    de,
    depth,
    1,
    ix,
    iy,
    iz,
    iw,
    currentState,
  );
  let sx = ix;
  let sy = iy;
  let sz = iz;
  let sw = iw;
  if (segment) CERT_SWEEP_EXT4.set(iExt);
  for (let k = 0; k < sectorOrder; k++) {
    if (k > 0) {
      stepSector4(stepBack, sx, sy, sz, sw, CERT_SWEEP4);
      sx = CERT_SWEEP4[0];
      sy = CERT_SWEEP4[1];
      sz = CERT_SWEEP4[2];
      sw = CERT_SWEEP4[3];
      if (segment) applyLinear4(stepBack, CERT_SWEEP_EXT4, CERT_SWEEP_EXT4);
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
      const kindJ = mapJ.foldKind;
      const branchCountJ = foldBranchCount4(kindJ);
      const absWJ = mapJ.foldSigma / mapJ.sigmaMin;
      // u-space point + per-axis box preimage quadruple {u, 2−u, −2−u} with
      // the matching output-interval distances — FOUR axes here, `w` folded
      // exactly like x/y/z (`variations4.ts`).
      let ux = 0;
      let uy = 0;
      let uz = 0;
      let uw = 0;
      let ru = 0;
      let euX = 0;
      let euY = 0;
      let euZ = 0;
      let euW = 0;
      let px0 = 0;
      let px1 = 0;
      let px2 = 0;
      let py0 = 0;
      let py1 = 0;
      let py2 = 0;
      let pz0 = 0;
      let pz1 = 0;
      let pz2 = 0;
      let pw0 = 0;
      let pw1 = 0;
      let pw2 = 0;
      let dxUp = 0;
      let dxDn = 0;
      let dyUp = 0;
      let dyDn = 0;
      let dzUp = 0;
      let dzDn = 0;
      let dwUp = 0;
      let dwDn = 0;
      let vx = 0;
      let vy = 0;
      let vz = 0;
      let vw = 0;
      let sfSigma = 1;
      let sfRd = 0;
      // The map's authored fold lengths, hoisted out of the
      // branch loop. At the classic set every expression below reduces to
      // the literal that shipped — `wall` 1, `innerScale` 0.25,
      // `innerSigma` 4, `fixedR`/`invFixedR`/`fixedR2` 1, `outputR` 2 — so
      // an unparameterized document descends bit-identically.
      const fr = mapJ.foldRadii;
      const wall = fr.wall;
      const wall2 = 2 * wall;
      if (kindJ !== SURFACE_FOLD_NONE) {
        ux = sx * mapJ.foldInvW;
        uy = sy * mapJ.foldInvW;
        uz = sz * mapJ.foldInvW;
        uw = sw * mapJ.foldInvW;
        if (segment) {
          // u-space is a SCALAR multiple of world space, so the segment's
          // half-extent scales with it and stays a segment.
          euX = CERT_SWEEP_EXT4[0] * mapJ.foldInvW;
          euY = CERT_SWEEP_EXT4[1] * mapJ.foldInvW;
          euZ = CERT_SWEEP_EXT4[2] * mapJ.foldInvW;
          euW = CERT_SWEEP_EXT4[3] * mapJ.foldInvW;
        }
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
          pw0 = uw;
          pw1 = wall2 - uw;
          pw2 = -wall2 - uw;
          dxUp = ux > wall ? ux - wall : 0;
          dxDn = ux < -wall ? -wall - ux : 0;
          dyUp = uy > wall ? uy - wall : 0;
          dyDn = uy < -wall ? -wall - uy : 0;
          dzUp = uz > wall ? uz - wall : 0;
          dzDn = uz < -wall ? -wall - uz : 0;
          dwUp = uw > wall ? uw - wall : 0;
          dwDn = uw < -wall ? -wall - uw : 0;
          if (segment) {
            // Same per-axis segment relaxation the frontier applies — see
            // the frontier's own comment for the min-over-segment argument.
            const ax = Math.abs(euX);
            const ay = Math.abs(euY);
            const az = Math.abs(euZ);
            const aw = Math.abs(euW);
            dxUp = dxUp > ax ? dxUp - ax : 0;
            dxDn = dxDn > ax ? dxDn - ax : 0;
            dyUp = dyUp > ay ? dyUp - ay : 0;
            dyDn = dyDn > ay ? dyDn - ay : 0;
            dzUp = dzUp > az ? dzUp - az : 0;
            dzDn = dzDn > az ? dzDn - az : 0;
            dwUp = dwUp > aw ? dwUp - aw : 0;
            dwDn = dwDn > aw ? dwDn - aw : 0;
          }
        } else {
          ru = Math.sqrt(ux * ux + uy * uy + uz * uz + uw * uw);
        }
      }
      for (let b = 0; b < branchCountJ; b++) {
        let jx: number;
        let jy: number;
        let jz: number;
        let jw: number;
        let branchSigma: number;
        let branchRd = 0;
        if (kindJ === SURFACE_FOLD_NONE) {
          jx = imJ[0] * sx + imJ[1] * sy + imJ[2] * sz + imJ[3] * sw + itJ[0];
          jy = imJ[4] * sx + imJ[5] * sy + imJ[6] * sz + imJ[7] * sw + itJ[1];
          jz = imJ[8] * sx + imJ[9] * sy + imJ[10] * sz + imJ[11] * sw + itJ[2];
          jw =
            imJ[12] * sx + imJ[13] * sy + imJ[14] * sz + imJ[15] * sw + itJ[3];
          if (segment) applyLinear4(imJ, CERT_SWEEP_EXT4, CERT_IMG_EXT4);
          branchSigma = mapJ.sigmaMin;
        } else {
          if (
            kindJ === SURFACE_FOLD_SPHEREFOLD ||
            (kindJ === SURFACE_FOLD_MANDELBOX && b % 81 === 0)
          ) {
            // The mandelbox chains 81 box branches per sphere branch here
            // (3D: 27), so the sphere branch turns over every 81st index.
            const s = kindJ === SURFACE_FOLD_SPHEREFOLD ? b : b / 81;
            if (s === 0) {
              vx = ux;
              vy = uy;
              vz = uz;
              vw = uw;
              sfSigma = 1;
              sfRd = ru < fr.fixedR ? fr.fixedR - ru : 0;
            } else if (s === 1) {
              vx = fr.innerScale * ux;
              vy = fr.innerScale * uy;
              vz = fr.innerScale * uz;
              vw = fr.innerScale * uw;
              sfSigma = fr.innerSigma;
              sfRd = ru > fr.outputR ? ru - fr.outputR : 0;
            } else {
              if (ru < fr.midMinR) {
                // Same shell stand-in the frontier folds, in the frozen
                // child's own frame. (Unreachable under a segment: the
                // public entries refuse spherefold/mandelbox slabs.)
                const shellTerm = absWJ * (fr.fixedR - ru);
                if (shellTerm < inner) inner = shellTerm;
                if (kindJ === SURFACE_FOLD_MANDELBOX) b += 80;
                continue;
              }
              const invR2 = fr.fixedR2 / (ru * ru);
              vx = ux * invR2;
              vy = uy * invR2;
              vz = uz * invR2;
              vw = uw * invR2;
              sfSigma = ru * fr.invFixedR;
              sfRd =
                ru < fr.fixedR
                  ? fr.fixedR - ru
                  : ru > fr.outputR
                    ? ru - fr.outputR
                    : 0;
            }
            if (kindJ === SURFACE_FOLD_MANDELBOX) {
              // No segment relaxation needed on this refresh — a mandelbox
              // map never transports one (slabExact4).
              px0 = vx;
              px1 = wall2 - vx;
              px2 = -wall2 - vx;
              py0 = vy;
              py1 = wall2 - vy;
              py2 = -wall2 - vy;
              pz0 = vz;
              pz1 = wall2 - vz;
              pz2 = -wall2 - vz;
              pw0 = vw;
              pw1 = wall2 - vw;
              pw2 = -wall2 - vw;
              dxUp = vx > wall ? vx - wall : 0;
              dxDn = vx < -wall ? -wall - vx : 0;
              dyUp = vy > wall ? vy - wall : 0;
              dyDn = vy < -wall ? -wall - vy : 0;
              dzUp = vz > wall ? vz - wall : 0;
              dzDn = vz < -wall ? -wall - vz : 0;
              dwUp = vw > wall ? vw - wall : 0;
              dwDn = vw < -wall ? -wall - vw : 0;
            }
          }
          let cx: number;
          let cy: number;
          let cz: number;
          let cw: number;
          let bex = 0;
          let bey = 0;
          let bez = 0;
          let bew = 0;
          if (kindJ === SURFACE_FOLD_SPHEREFOLD) {
            cx = vx;
            cy = vy;
            cz = vz;
            cw = vw;
            branchRd = sfRd;
          } else {
            // Box branch decode, FOUR axes: x fastest,
            // `b = selX + 3·selY + 9·selZ + 27·selW` (3D's three-axis
            // `selX + 3·selY + 9·selZ` with the w digit appended).
            const bb = kindJ === SURFACE_FOLD_BOXFOLD ? b : b % 81;
            const selX = bb % 3;
            const selY = ((bb / 3) | 0) % 3;
            const selZ = ((bb / 9) | 0) % 3;
            const selW = (bb / 27) | 0;
            cx = selX === 0 ? px0 : selX === 1 ? px1 : px2;
            cy = selY === 0 ? py0 : selY === 1 ? py1 : py2;
            cz = selZ === 0 ? pz0 : selZ === 1 ? pz1 : pz2;
            cw = selW === 0 ? pw0 : selW === 1 ? pw1 : pw2;
            if (segment) {
              // Branch derivative `diag(±1)`: the in-box preimage is `u`
              // (+1), both folded ones are `±2 − u` (−1).
              bex = selX === 0 ? euX : -euX;
              bey = selY === 0 ? euY : -euY;
              bez = selZ === 0 ? euZ : -euZ;
              bew = selW === 0 ? euW : -euW;
            }
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
            const ddw =
              selW === 0
                ? dwUp > dwDn
                  ? dwUp
                  : dwDn
                : selW === 1
                  ? dwUp
                  : dwDn;
            const boxRd2 = ddx * ddx + ddy * ddy + ddz * ddz + ddw * ddw;
            const boxRd = boxRd2 > 0 ? Math.sqrt(boxRd2) : 0;
            branchRd =
              kindJ === SURFACE_FOLD_BOXFOLD
                ? boxRd
                : sfRd > sfSigma * boxRd
                  ? sfRd
                  : sfSigma * boxRd;
          }
          jx = imJ[0] * cx + imJ[1] * cy + imJ[2] * cz + imJ[3] * cw + itJ[0];
          jy = imJ[4] * cx + imJ[5] * cy + imJ[6] * cz + imJ[7] * cw + itJ[1];
          jz = imJ[8] * cx + imJ[9] * cy + imJ[10] * cz + imJ[11] * cw + itJ[2];
          jw =
            imJ[12] * cx + imJ[13] * cy + imJ[14] * cz + imJ[15] * cw + itJ[3];
          if (segment) {
            CERT_IMG_EXT4[0] =
              imJ[0] * bex + imJ[1] * bey + imJ[2] * bez + imJ[3] * bew;
            CERT_IMG_EXT4[1] =
              imJ[4] * bex + imJ[5] * bey + imJ[6] * bez + imJ[7] * bew;
            CERT_IMG_EXT4[2] =
              imJ[8] * bex + imJ[9] * bey + imJ[10] * bez + imJ[11] * bew;
            CERT_IMG_EXT4[3] =
              imJ[12] * bex + imJ[13] * bey + imJ[14] * bez + imJ[15] * bew;
          }
          branchSigma = mapJ.foldSigma * sfSigma;
        }
        const rj = segmentRadius(jx, jy, jz, jw, CERT_IMG_EXT4);
        let innerTerm = branchSigma * (rj - childR);
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
 * Fold-branch frontier descent, one dimension up — the 4D twin
 * of 3D's `descendFold`: a width-{@link FOLD_W4} frontier
 * over the `(sector, base map, fold branch)` candidate stream, region
 * floors from the branch validity cells, the branch-and-bound's stage-1/2
 * skips, the cutoff/sphere-floor exits at every settled fold, and — under
 * `refine` — the refined certificate on escaped evictions. `halfExtent`
 * rides only where {@link slabExact4} holds (boxfold branch inverses are
 * per-axis reflections — segment-exact); the public entries refuse it
 * otherwise, so this body may assume every fold branch it transports a
 * segment through is affine.
 *
 * The three mechanisms that make a wide frontier both correct and affordable
 * are 3D's, and their arguments are dimension-free (read `descendFold`'s doc
 * for the measured record behind each):
 *
 * - REGION FLOORS. Every candidate inherits its chain's floor — the
 *   strongest `scale · |w| · regionDist` certificate its branch history ever
 *   earned — and every value it folds (escape certificate, drop, cap
 *   terminal) is raised to it. A floor-0 chain took an exact preimage at
 *   every level, so its negative cap terminal is the legitimate hit signal,
 *   while a spherefold-inversion "wanderer" strays by construction, earns a
 *   positive floor and can no longer fabricate a hit.
 * - FLOORED KEYS + THE DROP-FOLD RULE. Selection ranks by
 *   `max(pScale·(r − R), floor)`, and a tuple dropped off the frontier folds
 *   its floor when it has one — the subtree's every fold is >= its floor, so
 *   the drop loses tightness, never validity.
 * - FLOOR-VS-BEST PRUNE + the stage-2 BRANCH-AND-BOUND SKIP, both
 *   priced BEFORE the child transform.
 *
 * FOUR DIMENSIONS, FOUR DELTAS. The branch fan grows ({@link
 * foldBranchCount4}: boxfold 3^4 = 81 with `b = selX + 3·selY + 9·selZ +
 * 27·selW`, spherefold still 3, mandelbox 3·81 = 243 with
 * `b = boxIndex + 81·sphereIndex`); every radius is {@link segmentRadius}
 * rather than `|q|`, so the slab rides one extra 4-vector per chain
 * and candidate; there is NO probe-fit bound centre (this module's ball is
 * origin-anchored — where 3D subtracts `boundCenter`, 4D subtracts nothing)
 * and NO footprint cap (no cone-footprint parameter exists up here),
 * so the loop runs `de.maxDepth`. Like 3D, this body IGNORES
 * `de.beamWidth` — the affine ladder's 1/2/3/4 slots are replaced wholesale
 * by the {@link FOLD_W4}-wide frontier, whose measured sizing is a
 * statement about branch fans and region floors that the lift keeps.
 */
function descendFold4(
  de: SurfaceDE4,
  p: Vec4,
  refine: boolean,
  cutoff: number,
  halfExtent: Vec4 | null,
): number {
  // No footprint cap in 4D (see the doc): the depth cap is the built one.
  const maxDepth = de.maxDepth;
  let x = p[0];
  let y = p[1];
  let z = p[2];
  let w = p[3];
  const segment = isSegment(halfExtent);
  FOLD_EXT4.fill(0);
  if (segment) {
    FOLD_EXT4.set(halfExtent);
  } else {
    // A point query must not inherit a previous slab query's extent residue.
    clearFoldSegmentScratch();
  }
  let finalScale = 1;
  // AFFINE final lens (a fold-base system may still carry one). A fold FINAL
  // never reaches here: `descendLens4` owns that shape and `de.final` is null
  // whenever `de.foldFinal` is set.
  if (de.final) {
    const f = de.final;
    const im = f.invM;
    const it = f.invT;
    const qx = im[0] * x + im[1] * y + im[2] * z + im[3] * w + it[0];
    const qy = im[4] * x + im[5] * y + im[6] * z + im[7] * w + it[1];
    const qz = im[8] * x + im[9] * y + im[10] * z + im[11] * w + it[2];
    const qw = im[12] * x + im[13] * y + im[14] * z + im[15] * w + it[3];
    x = qx;
    y = qy;
    z = qz;
    w = qw;
    // The lens carries the extent by its LINEAR part alone.
    if (segment) applyLinear4(im, FOLD_EXT4, FOLD_EXT4);
    finalScale = f.sigmaMin;
  }

  const { order, stepBack } = de.symmetry;
  const R = de.boundingRadius;
  const condensation = de.condensation;
  const startR = segmentRadius(x, y, z, w, FOLD_EXT4);
  const sphereBound = startR - R;
  let best = Infinity;
  const bailBelow =
    cutoff > 0 && sphereBound * finalScale < cutoff ? cutoff : -Infinity;

  let chainCount = 1;
  fcX[0] = x;
  fcY[0] = y;
  fcZ[0] = z;
  fcW[0] = w;
  fcExtX[0] = FOLD_EXT4[0];
  fcExtY[0] = FOLD_EXT4[1];
  fcExtZ[0] = FOLD_EXT4[2];
  fcExtW[0] = FOLD_EXT4[3];
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
    const escapeRadius = childBound ? childBound.escapeRadius : de.escapeRadius;
    if (condensation) {
      for (let c = 0; c < chainCount; c++) {
        const term = scheduledCondensationTerm4(
          de,
          depth,
          fcScale[c],
          fcX[c],
          fcY[c],
          fcZ[c],
          fcW[c],
          fcState[c],
        );
        if (term < best) best = term;
      }
      if (best <= sphereBound || best * finalScale < bailBelow) {
        return descentValue(best, sphereBound, finalScale);
      }
    }
    const futureCondensation = scheduledCondensationHasFutureDepth4(
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
      let sW = fcW[c];
      if (segment) {
        FOLD_SWEEP_EXT4[0] = fcExtX[c];
        FOLD_SWEEP_EXT4[1] = fcExtY[c];
        FOLD_SWEEP_EXT4[2] = fcExtZ[c];
        FOLD_SWEEP_EXT4[3] = fcExtW[c];
      }
      // Stage-2 hoists: the chain-point norm is sector-invariant
      // (every generator is an orthogonal map fixing the origin — the module
      // doc's FIXED SUBSPACE note), so the affine arm's |pre|² is one number
      // per chain; 1/pScale prices the skip's frontier-key condition.
      // With condensation, R encloses the FULL recursive closure, including
      // every nested C0. Thus childScale*(r-R) certifies the same entire
      // subtree a stage-2 skip removes. It need not equal the separately
      // damped 0.9*C0 term: it is a direct geometric lower bound, while fold
      // region floors still certify the selected branch image. Every
      // surviving candidate evaluates immediate C0 before frontier insertion.
      const chainNormSq = sX * sX + sY * sY + sZ * sZ + sW * sW;
      const invPScale = 1 / pScale;
      for (let k = 0; k < sectorOrder; k++) {
        if (k > 0) {
          stepSector4(stepBack, sX, sY, sZ, sW, FOLD_SWEEP4);
          sX = FOLD_SWEEP4[0];
          sY = FOLD_SWEEP4[1];
          sZ = FOLD_SWEEP4[2];
          sW = FOLD_SWEEP4[3];
          if (segment) applyLinear4(stepBack, FOLD_SWEEP_EXT4, FOLD_SWEEP_EXT4);
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
          // Fold-branch sweep: one candidate per inverse BRANCH — 81
          // (boxfold), 3 (spherefold), 243 (mandelbox), 1 (affine map in a
          // mixed system) — enumerated unconditionally; validity never
          // depends on which fold cell the attractor actually occupies.
          const kind = map.foldKind;
          const branchCount = foldBranchCount4(kind);
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
          // the second stays tight when the inverse translation dominates
          // the child radius — the measured fold case.) Two no-op classes:
          //
          // - ESCAPE skip: rLower STRICTLY > escapeRadius forces the plain
          //   escape fold, which is a no-op when also
          //   childScale·(rLower − R) >= best. No frontier state involved,
          //   so this arm works at ANY keptCount.
          // - FRONTIER skip, only with the frontier FULL: the eviction fold
          //   cannot advance the min AND the key cannot displace the worst
          //   kept slot (ties evict the newcomer), encoded via
          //   qReq = R + max(0, best/childScale, fnWorstKey/pScale).
          //
          // best/fnWorstKey only DECREASE within a level, so a skip decided
          // now would also be decided at any later state; enumeration order
          // (and thus every tie-break) is untouched.
          //
          // SEGMENT BYPASS (slab × fold, a 4D-only decision): both
          // forms are POINT statements, and under a slab query `r` is the
          // segment's MINIMUM radius, which sits BELOW them. The sigma form
          // relaxes cheaply (replace `|pre|` with the segment's own radius),
          // but the directional form's relaxation needs `|invM·e_pre|` — the
          // very inverse application the skip exists to avoid — so a slab
          // query would pay most of the skip's cost to keep half its
          // strength. Skips are state NO-OPS by construction (never taking
          // one is always sound and always value-identical), so the whole
          // stage-2 block is gated off under a segment: `h = 0` — the
          // shipped default, and the only path the mirrors march — keeps
          // 3D's arithmetic verbatim, and slab sessions simply pay the
          // stage-1 floor prune alone.
          const bnbSigma = map.invMSigmaMin;
          const bnbSigmaSq = bnbSigma * bnbSigma;
          const bnbT = map.invTNorm;
          const needE = escapeRadius + bnbT;
          const needESq = needE * needE;
          const bnbDir = map.bnbDir;
          const gX = bnbDir[0];
          const gY = bnbDir[1];
          const gZ = bnbDir[2];
          const gW = bnbDir[3];
          let invChildScale =
            1 /
            (pScale *
              (kind === SURFACE_FOLD_NONE ? map.sigmaMin : map.foldSigma));
          // u-space chain point (q/w), the per-axis box preimage triple
          // {u, 2−u, −2−u} with the matching per-axis output-interval
          // distances (boxfold reads them off u once; mandelbox refreshes
          // them from each spherefold branch output), and the current
          // spherefold branch output + conformal sigma + region distance.
          // FOUR axes, not three: `variations4.ts` folds `w` like every
          // spatial axis, so the w quadruple is the whole 4D delta here.
          let ux = 0;
          let uy = 0;
          let uz = 0;
          let uw = 0;
          let ru = 0;
          let euX = 0;
          let euY = 0;
          let euZ = 0;
          let euW = 0;
          let px0 = 0;
          let px1 = 0;
          let px2 = 0;
          let py0 = 0;
          let py1 = 0;
          let py2 = 0;
          let pz0 = 0;
          let pz1 = 0;
          let pz2 = 0;
          let pw0 = 0;
          let pw1 = 0;
          let pw2 = 0;
          let dxUp = 0;
          let dxDn = 0;
          let dyUp = 0;
          let dyDn = 0;
          let dzUp = 0;
          let dzDn = 0;
          let dwUp = 0;
          let dwDn = 0;
          let vx = 0;
          let vy = 0;
          let vz = 0;
          let vw = 0;
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
            uw = sW * map.foldInvW;
            if (segment) {
              // u-space is a SCALAR multiple of world space, so the
              // half-extent scales with the point and stays a segment.
              euX = FOLD_SWEEP_EXT4[0] * map.foldInvW;
              euY = FOLD_SWEEP_EXT4[1] * map.foldInvW;
              euZ = FOLD_SWEEP_EXT4[2] * map.foldInvW;
              euW = FOLD_SWEEP_EXT4[3] * map.foldInvW;
            }
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
              pw0 = uw;
              pw1 = wall2 - uw;
              pw2 = -wall2 - uw;
              dxUp = ux > wall ? ux - wall : 0;
              dxDn = ux < -wall ? -wall - ux : 0;
              dyUp = uy > wall ? uy - wall : 0;
              dyDn = uy < -wall ? -wall - uy : 0;
              dzUp = uz > wall ? uz - wall : 0;
              dzDn = uz < -wall ? -wall - uz : 0;
              dwUp = uw > wall ? uw - wall : 0;
              dwDn = uw < -wall ? -wall - uw : 0;
              if (segment) {
                // REGION DISTANCES UNDER A SEGMENT (slab × fold). The
                // distances above are measured from the u-space CENTRE, but
                // the query is the whole segment `u ± e_u`. Each per-axis
                // distance is 1-Lipschitz in its axis, so
                // `min_s d_a(u_a + s·e_a) >= max(0, d_a(u_a) − |e_a|)`, and
                // the cell distance `sqrt(Σ_a d_a²)` minimized over the
                // segment is at least the same composition of those
                // per-axis relaxations (each term bounded below
                // independently). Relaxing HERE — before any selector reads
                // them — also covers the in-box selector's `max(dUp, dDn)`,
                // since relaxation is monotone. Only BOXFOLD branches ever
                // transport a segment (`slabExact4`), so the mandelbox
                // refresh below needs no counterpart.
                const ax = Math.abs(euX);
                const ay = Math.abs(euY);
                const az = Math.abs(euZ);
                const aw = Math.abs(euW);
                dxUp = dxUp > ax ? dxUp - ax : 0;
                dxDn = dxDn > ax ? dxDn - ax : 0;
                dyUp = dyUp > ay ? dyUp - ay : 0;
                dyDn = dyDn > ay ? dyDn - ay : 0;
                dzUp = dzUp > az ? dzUp - az : 0;
                dzDn = dzDn > az ? dzDn - az : 0;
                dwUp = dwUp > aw ? dwUp - aw : 0;
                dwDn = dwDn > aw ? dwDn - aw : 0;
              }
            } else {
              ru = Math.sqrt(ux * ux + uy * uy + uz * uz + uw * uw);
            }
          }
          for (let b = 0; b < branchCount; b++) {
            let ix: number;
            let iy: number;
            let iz: number;
            let iw: number;
            let branchSigma: number;
            // The candidate's floor — its chain's floor, raised below by
            // the branch's own region certificate — is knowable BEFORE the
            // child transform (stage 1: branchRd needs only the
            // branch decode), so the floor-vs-best prune runs first and
            // only surviving branches pay the inverse application.
            let candFloor = pFloor;
            if (kind === SURFACE_FOLD_NONE) {
              if (candFloor > 0 && candFloor >= best) continue;
              // Stage-2 B&B skips (see the hoist comment above), point
              // queries only.
              if (!segment && !inB) {
                const rDir = gX * sX + gY * sY + gZ * sZ + gW * sW + bnbT;
                const rEsc = R + best * invChildScale;
                if (rDir > escapeRadius && rDir >= rEsc) continue;
                const sTerm = chainNormSq * bnbSigmaSq;
                if (sTerm > needESq) {
                  const needC = rEsc + bnbT;
                  if (needC <= 0 || sTerm >= needC * needC) continue;
                }
                if (keptCount === FOLD_W4) {
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
              }
              ix = im[0] * sX + im[1] * sY + im[2] * sZ + im[3] * sW + it[0];
              iy = im[4] * sX + im[5] * sY + im[6] * sZ + im[7] * sW + it[1];
              iz = im[8] * sX + im[9] * sY + im[10] * sZ + im[11] * sW + it[2];
              iw =
                im[12] * sX + im[13] * sY + im[14] * sZ + im[15] * sW + it[3];
              if (segment) applyLinear4(im, FOLD_SWEEP_EXT4, FOLD_IMG_EXT4);
              branchSigma = map.sigmaMin;
            } else {
              let branchRd: number;
              if (
                kind === SURFACE_FOLD_SPHEREFOLD ||
                (kind === SURFACE_FOLD_MANDELBOX && b % 81 === 0)
              ) {
                // (Re)compute the spherefold branch this b enters: outer
                // identity, inner ×mR²/fR² (conformal sigma fR²/mR²), mid
                // inversion in the sphere of radius fR (query-dependent
                // sigma |u|/fR), each with its distance to the branch's
                // OUTPUT region (outer outside radius fR, inner inside
                // fR²/mR, mid the shell between). Every one of those is a
                // RADIAL statement, so the 3D expressions carry up
                // unchanged — only `ru` gained a term. The mandelbox's box
                // expansion is 81 wide here, so its sphere branch turns
                // over every 81st index (3D: 27th).
                const s = kind === SURFACE_FOLD_SPHEREFOLD ? b : b / 81;
                if (s === 0) {
                  vx = ux;
                  vy = uy;
                  vz = uz;
                  vw = uw;
                  sfSigma = 1;
                  sfRd = ru < fr.fixedR ? fr.fixedR - ru : 0;
                } else if (s === 1) {
                  vx = fr.innerScale * ux;
                  vy = fr.innerScale * uy;
                  vz = fr.innerScale * uz;
                  vw = fr.innerScale * uw;
                  sfSigma = fr.innerSigma;
                  sfRd = ru > fr.outputR ? ru - fr.outputR : 0;
                } else {
                  if (ru < fr.midMinR) {
                    // Inverting a chain point this close to the sector
                    // origin would overflow the GPU mirrors' f32; the mid
                    // piece lives in the u-space shell fR <= |·| <= fR²/mR,
                    // so fold the shell bound |w|·(fR − |u|) —
                    // ~pScale·|w|·fR, never a near-zero ghost term — and
                    // skip the branch (box expansion included, 81 wide
                    // here). A settled fold, so the standard exits apply.
                    // Point queries only: a spherefold map never transports
                    // a segment (`slabExact4`), so the shell bound needs no
                    // segment form.
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
                    if (kind === SURFACE_FOLD_MANDELBOX) b += 80;
                    continue;
                  }
                  const invR2 = fr.fixedR2 / (ru * ru);
                  vx = ux * invR2;
                  vy = uy * invR2;
                  vz = uz * invR2;
                  vw = uw * invR2;
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
                  // No segment relaxation on this refresh — a mandelbox map
                  // never transports one (`slabExact4`).
                  px0 = vx;
                  px1 = wall2 - vx;
                  px2 = -wall2 - vx;
                  py0 = vy;
                  py1 = wall2 - vy;
                  py2 = -wall2 - vy;
                  pz0 = vz;
                  pz1 = wall2 - vz;
                  pz2 = -wall2 - vz;
                  pw0 = vw;
                  pw1 = wall2 - vw;
                  pw2 = -wall2 - vw;
                  dxUp = vx > wall ? vx - wall : 0;
                  dxDn = vx < -wall ? -wall - vx : 0;
                  dyUp = vy > wall ? vy - wall : 0;
                  dyDn = vy < -wall ? -wall - vy : 0;
                  dzUp = vz > wall ? vz - wall : 0;
                  dzDn = vz < -wall ? -wall - vz : 0;
                  dwUp = vw > wall ? vw - wall : 0;
                  dwDn = vw < -wall ? -wall - vw : 0;
                }
              }
              let cx: number;
              let cy: number;
              let cz: number;
              let cw: number;
              let bex = 0;
              let bey = 0;
              let bez = 0;
              let bew = 0;
              if (kind === SURFACE_FOLD_SPHEREFOLD) {
                cx = vx;
                cy = vy;
                cz = vz;
                cw = vw;
                branchRd = sfRd;
              } else {
                // Box branch decode: per-axis preimage selectors, x
                // fastest, FOUR digits — `b = selX + 3·selY + 9·selZ +
                // 27·selW` (3D's three-digit code with the w axis
                // appended). Each selector is paired with the distance from
                // the source point to that branch's output interval (id
                // [−1,1], up (−inf,1], down [−1,inf)).
                const bb = kind === SURFACE_FOLD_BOXFOLD ? b : b % 81;
                const selX = bb % 3;
                const selY = ((bb / 3) | 0) % 3;
                const selZ = ((bb / 9) | 0) % 3;
                const selW = (bb / 27) | 0;
                cx = selX === 0 ? px0 : selX === 1 ? px1 : px2;
                cy = selY === 0 ? py0 : selY === 1 ? py1 : py2;
                cz = selZ === 0 ? pz0 : selZ === 1 ? pz1 : pz2;
                cw = selW === 0 ? pw0 : selW === 1 ? pw1 : pw2;
                if (segment) {
                  // The branch's own derivative is `diag(±1)`: the in-box
                  // preimage is `u` (+1), both folded ones are `±2 − u`
                  // (−1). A reflection takes the segment to a segment, so
                  // the half-extent just picks up those signs.
                  bex = selX === 0 ? euX : -euX;
                  bey = selY === 0 ? euY : -euY;
                  bez = selZ === 0 ? euZ : -euZ;
                  bew = selW === 0 ? euW : -euW;
                }
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
                const ddw =
                  selW === 0
                    ? dwUp > dwDn
                      ? dwUp
                      : dwDn
                    : selW === 1
                      ? dwUp
                      : dwDn;
                const boxRd2 = ddx * ddx + ddy * ddy + ddz * ddz + ddw * ddw;
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
              // guard. Point queries only — see the SEGMENT BYPASS note.
              if (!segment && !inB) {
                const rDir = gX * cx + gY * cy + gZ * cz + gW * cw + bnbT;
                const rEsc = R + best * invChildScale;
                if (rDir > escapeRadius && rDir >= rEsc) continue;
                const sTerm =
                  (cx * cx + cy * cy + cz * cz + cw * cw) * bnbSigmaSq;
                if (sTerm > needESq) {
                  const needC = rEsc + bnbT;
                  if (needC <= 0 || sTerm >= needC * needC) continue;
                }
                if (keptCount === FOLD_W4) {
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
              }
              ix = im[0] * cx + im[1] * cy + im[2] * cz + im[3] * cw + it[0];
              iy = im[4] * cx + im[5] * cy + im[6] * cz + im[7] * cw + it[1];
              iz = im[8] * cx + im[9] * cy + im[10] * cz + im[11] * cw + it[2];
              iw =
                im[12] * cx + im[13] * cy + im[14] * cz + im[15] * cw + it[3];
              if (segment) {
                FOLD_IMG_EXT4[0] =
                  im[0] * bex + im[1] * bey + im[2] * bez + im[3] * bew;
                FOLD_IMG_EXT4[1] =
                  im[4] * bex + im[5] * bey + im[6] * bez + im[7] * bew;
                FOLD_IMG_EXT4[2] =
                  im[8] * bex + im[9] * bey + im[10] * bez + im[11] * bew;
                FOLD_IMG_EXT4[3] =
                  im[12] * bex + im[13] * bey + im[14] * bez + im[15] * bew;
              }
              branchSigma = map.foldSigma * sfSigma;
            }
            const r = segmentRadius(ix, iy, iz, iw, FOLD_IMG_EXT4);
            const childScale = pScale * branchSigma;
            if (condensation) {
              const shapeTerm = scheduledCondensationTerm4(
                de,
                depth + 1,
                childScale,
                ix,
                iy,
                iz,
                iw,
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
            if (foldFrontierTap4 !== null) {
              foldFrontierTap4.candidate(depth, {
                key,
                x: ix,
                y: iy,
                z: iz,
                w: iw,
                scale: childScale,
                floor: candFloor,
                r,
              });
            }
            // Frontier insertion: UNSORTED storage with a tracked worst
            // slot. The kept set is still exactly the level's FOLD_W4
            // smallest floored keys — a full frontier replaces its worst
            // slot whenever a smaller key arrives, ties evicting the
            // newcomer — only the storage ORDER differs from a sorted
            // insert-shift. The shape is forced by 3D's GPU mirrors (Mesa's
            // compiler dies outright on data-dependent shift chains), and
            // this oracle keeps the identical structure so the eventual 4D
            // mirrors inherit a body that already compiles. Whatever leaves
            // the kept set — this candidate, or the displaced worst slot —
            // folds: escaped tuples their certificate, in-sphere tuples
            // their floor (the drop-fold rule; a floor-0 in-sphere drop
            // stays the silent overshoot-direction residual).
            let evX = 0;
            let evY = 0;
            let evZ = 0;
            let evW = 0;
            let evScale = 0;
            let evR = 0;
            let evCert = 0;
            let evFloor = 0;
            let evState = SURFACE_CHAOS_WILDCARD;
            let evHas = false;
            if (keptCount === FOLD_W4 && key >= fnWorstKey) {
              evX = ix;
              evY = iy;
              evZ = iz;
              evW = iw;
              FOLD_EV_EXT4.set(FOLD_IMG_EXT4);
              evScale = childScale;
              evR = r;
              evCert = cert;
              evFloor = candFloor;
              evState = childState;
              evHas = true;
            } else {
              let slot: number;
              if (keptCount === FOLD_W4) {
                slot = fnWorstIdx;
                evX = fnX[slot];
                evY = fnY[slot];
                evZ = fnZ[slot];
                evW = fnW[slot];
                FOLD_EV_EXT4[0] = fnExtX[slot];
                FOLD_EV_EXT4[1] = fnExtY[slot];
                FOLD_EV_EXT4[2] = fnExtZ[slot];
                FOLD_EV_EXT4[3] = fnExtW[slot];
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
              fnW[slot] = iw;
              fnExtX[slot] = FOLD_IMG_EXT4[0];
              fnExtY[slot] = FOLD_IMG_EXT4[1];
              fnExtZ[slot] = FOLD_IMG_EXT4[2];
              fnExtW[slot] = FOLD_IMG_EXT4[3];
              fnScale[slot] = childScale;
              fnFloor[slot] = candFloor;
              fnR[slot] = r;
              fnCert[slot] = cert;
              fnState[slot] = childState;
              // Recompute the worst kept key once the frontier is full —
              // a fixed-bound scan of reads, first max wins.
              if (keptCount === FOLD_W4) {
                fnWorstKey = -Infinity;
                fnWorstIdx = 0;
                for (let s = 0; s < FOLD_W4; s++) {
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
                    // The lazy guard: refinement can only RAISE a
                    // certificate, so only folds that would advance the min
                    // pay the extra Hutchinson level.
                    const rc = refinedCertValue4(
                      de,
                      evX,
                      evY,
                      evZ,
                      evW,
                      FOLD_EV_EXT4,
                      evR,
                      evScale,
                      segment,
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
    // artifacts; the chains carry point, half-extent, scale, floor and
    // radius).
    for (let i = 0; i < keptCount; i++) {
      fcX[i] = fnX[i];
      fcY[i] = fnY[i];
      fcZ[i] = fnZ[i];
      fcW[i] = fnW[i];
      fcExtX[i] = fnExtX[i];
      fcExtY[i] = fnExtY[i];
      fcExtZ[i] = fnExtZ[i];
      fcExtW[i] = fnExtW[i];
      fcScale[i] = fnScale[i];
      fcFloor[i] = fnFloor[i];
      fcR[i] = fnR[i];
      fcState[i] = fnState[i];
    }
    chainCount = keptCount;
    if (foldFrontierTap4 !== null) {
      const kept: FoldFrontierCandidate4[] = [];
      for (let i = 0; i < keptCount; i++) {
        kept.push({
          key: fnKey[i],
          x: fnX[i],
          y: fnY[i],
          z: fnZ[i],
          w: fnW[i],
          scale: fnScale[i],
          floor: fnFloor[i],
          r: fnR[i],
        });
      }
      foldFrontierTap4.level(depth, kept);
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
      const shapeTerm = scheduledCondensationTerm4(
        de,
        maxDepth,
        fcScale[c],
        fcX[c],
        fcY[c],
        fcZ[c],
        fcW[c],
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

/** Scratch query quadruple + half-extent for {@link descendLens4}'s root
 * descents — module scope so the branch loop never allocates, and DISTINCT
 * from the frontier body's buffers (which `descendFold4` owns and rewrites
 * on every branch call this loop makes). Single-threaded by construction,
 * like the descent scratch above; `descendLens4` never re-enters itself. */
const LENS_QUERY4: Vec4 = [0, 0, 0, 0];
const LENS_QUERY_EXT4: Vec4 = [0, 0, 0, 0];
/** The lens query's own half-extent, and the branch preimage's transported
 * one — the {@link segmentRadius} arguments the two `Vec4`s above cannot be
 * (that helper reads a `Float64Array`). Written in lockstep with them. */
const LENS_EXT4 = new Float64Array(4);
const LENS_BRANCH_EXT4 = new Float64Array(4);

/**
 * Fold FINAL lens sweep, one dimension up — the 4D twin of 3D's
 * `descendLens`: the visible set is `F(A)` with `F = w·V(M p + t)`
 * and `V` a fold family, so
 *
 *     dist(p, F(A)) = |w| · dist(p/w, V(Y))        (odd folds; Y = M·A + t)
 *                   >= min_c max( |w|·regionDist_c(p/w),
 *                                 |w|·sigma_c·sigmaMin(M) · dist(q_c, A) )
 *
 * — the fold-branch vocabulary (branch preimages, conformal sigmas, region
 * floors) lifted ONE level, to the query itself: each branch seeds a root
 * descent at `q_c = invM·B_c^-1(p/w) + invT` through the UNTOUCHED cores
 * ({@link descendFold4} when the base maps fold, else the affine ladder —
 * `de.final` is null whenever `de.foldFinal` is set, so the cores run their
 * no-lens arithmetic verbatim), and the estimate is the min over branch
 * terms, floored by the visible-set sphere bound
 * `|p| − visibleBoundingRadius`. Every dimension-sensitive quantity is the
 * 4D one: 81/3/243 branches ({@link foldBranchCount4}) with the box code
 * `selX + 3·selY + 9·selZ + 27·selW`, and {@link segmentRadius} in place of
 * every `|q|` so a slab rides through the lens too (boxfold lenses
 * only — {@link slabExact4} refuses the rest at the public entries).
 *
 * Three prunes keep the branch loop from costing its worst case, each
 * VALUE-EXACT (a pruned branch's term is proven `>= best`, so the min is
 * untouched):
 *
 * - REGION FLOOR vs best: `|w|·regionDist_c >= best` — every value the
 *   branch could contribute is at least its floor.
 * - SPHERE CERTIFICATE vs best: `factor_c·(|q_c| − R) >= best` — the core's
 *   return never undercuts its own depth-0 sphere bound (the same statement
 *   under a segment, where both sides read {@link segmentRadius}).
 * - VISIBLE-SPHERE PIN (the sphere-floor argument, outer edition): once
 *   `best <= |p| − visibleR` the eventual `max(best, visBound)` is pinned;
 *   return it immediately, bit-exact for every caller.
 *
 * The visible ball stays ORIGIN-centered, matching 3D's deliberate choice —
 * trivially so here, since this module never adopted 3D's probe-fit
 * centre for the raw attractor's ball either (module doc, FIXED SUBSPACE).
 *
 * The spherefold MID branch keeps its shell guard, scaled by the map's own
 * `fR` (`foldRadii.midMinR`): a query that close to the origin
 * in u-space folds the settled shell bound `|w|·(fR − ru)` instead of
 * inverting (and, for the mandelbox, skips that sphere branch's whole
 * 81-wide box expansion), exactly as the iterated sweep does.
 *
 * BRANCH ORDER IS DELIBERATELY THE INDEX ORDER — carried up from 3D's record
 * rather than re-derived (measured 2026-07-30; do not "fix" this
 * without re-measuring). Best-FIRST ordering (seed the sweep with the argmin
 * of each branch's exact depth-0 lower bound, then sweep skipping it) was
 * implemented in 3D's function, its WGSL mirror and their tests, and
 * REVERTED: core descents per call fell 4.46 -> 2.26 on the lens archetype,
 * but the real Iris Xe driver measured 1.46-1.54x SLOWER end to end, because
 * pricing all the branch preimages a second time costs the GPU more than the
 * descent transforms it saves. The survivors after seeding are branches whose
 * preimages land INSIDE the bounding ball, where the depth-0 sphere
 * certificate is vacuous at ANY visit order — ordering had already reached
 * its ceiling.
 *
 * AND THE STRONGER IN-BALL CERTIFICATE IS AT ITS CEILING TOO (measured
 * 2026-07-30, 3D — recorded here so a 4D reader does not rebuild it). A
 * conservative distance floor over the BASE attractor, sampled at each branch
 * preimage from `surface-grid.ts`, was wired in as a fourth prune and measured
 * on three systems: ONE paid (the identity-lens field class, 6.83 -> 3.71 core
 * descents per call), the other two got 3-12% and nothing while still paying
 * the fetch. Unlike the three prunes above it is SOUND BUT NOT VALUE-EXACT — a
 * floor bounds the TRUE distance, which the core's return only under-estimates
 * — so every mirror not sampling the same floors becomes a DIFFERENT
 * estimator. NOT LANDED; the 3D twin's `descendLens` doc carries the tables.
 * (4D has no grid at all — the live rotor/slice would invalidate one per frame
 * — so the prune is doubly unavailable here.)
 *
 * CUTOFF CONTRACT (the march-epsilon one, honored verbatim): inner descents
 * receive `min(best, cutoff)/factor_c` when `cutoff > 0` — an inner value
 * below that line certifies its term below `min(best, cutoff)`, so any inexact
 * (early-exited) term forces the final return under the cutoff, and every
 * return at or above the cutoff is a min over EXACT terms. ONE SEAM over 3D:
 * the plain 4D core (`descend4`) predates the cutoff machinery and takes none,
 * so on the `refine === false` affine arm the root descents run EXACT —
 * tighter than the contract requires, never looser, and the plain public entry
 * passes `cutoff = 0` anyway, so no caller can tell.
 */
function descendLens4(
  de: SurfaceDE4,
  p: Vec4,
  refine: boolean,
  cutoff: number,
  halfExtent: Vec4 | null,
): number {
  const lens = de.foldFinal!;
  const R = de.boundingRadius;
  const hasFolds = deHasFolds4(de);
  const segment = isSegment(halfExtent);
  LENS_EXT4.fill(0);
  if (segment) LENS_EXT4.set(halfExtent);
  // Written per branch under a segment; zeroed here so a point query reads
  // the plain `|q|` out of every `segmentRadius` below (module scratch
  // outlives the call — see `clearFoldSegmentScratch`).
  LENS_BRANCH_EXT4.fill(0);
  // The VISIBLE ball is origin-anchored (its own bound, its own radius).
  const visBound =
    segmentRadius(p[0], p[1], p[2], p[3], LENS_EXT4) - de.visibleBoundingRadius;
  const kind = lens.foldKind;
  const absW = lens.absW;
  const im = lens.invM;
  const it = lens.invT;
  const sigmaMinM = lens.sigmaMin;

  const ux = p[0] * lens.invW;
  const uy = p[1] * lens.invW;
  const uz = p[2] * lens.invW;
  const uw = p[3] * lens.invW;
  // u-space is a SCALAR multiple of world space, so a slab query's
  // half-extent scales with the point and stays a segment.
  const euX = LENS_EXT4[0] * lens.invW;
  const euY = LENS_EXT4[1] * lens.invW;
  const euZ = LENS_EXT4[2] * lens.invW;
  const euW = LENS_EXT4[3] * lens.invW;
  let best = Infinity;

  // Per-axis box preimage triples + output-interval distances (boxfold reads
  // them off u once; the mandelbox refreshes them from each spherefold branch
  // output) — the iterated sweep's locals, one level up, with the w axis
  // `variations4.ts` folds like every spatial one.
  let px0 = 0;
  let px1 = 0;
  let px2 = 0;
  let py0 = 0;
  let py1 = 0;
  let py2 = 0;
  let pz0 = 0;
  let pz1 = 0;
  let pz2 = 0;
  let pw0 = 0;
  let pw1 = 0;
  let pw2 = 0;
  let dxUp = 0;
  let dxDn = 0;
  let dyUp = 0;
  let dyDn = 0;
  let dzUp = 0;
  let dzDn = 0;
  let dwUp = 0;
  let dwDn = 0;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  let vw = 0;
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
    pw0 = uw;
    pw1 = wall2 - uw;
    pw2 = -wall2 - uw;
    dxUp = ux > wall ? ux - wall : 0;
    dxDn = ux < -wall ? -wall - ux : 0;
    dyUp = uy > wall ? uy - wall : 0;
    dyDn = uy < -wall ? -wall - uy : 0;
    dzUp = uz > wall ? uz - wall : 0;
    dzDn = uz < -wall ? -wall - uz : 0;
    dwUp = uw > wall ? uw - wall : 0;
    dwDn = uw < -wall ? -wall - uw : 0;
    if (segment) {
      // Per-axis segment relaxation — the frontier body's argument verbatim
      // (each `d_a` is 1-Lipschitz, so the min over the segment is at least
      // the composition of the relaxed per-axis distances), applied before
      // any selector reads them so the in-box `max(dUp, dDn)` inherits it.
      const ax = Math.abs(euX);
      const ay = Math.abs(euY);
      const az = Math.abs(euZ);
      const aw = Math.abs(euW);
      dxUp = dxUp > ax ? dxUp - ax : 0;
      dxDn = dxDn > ax ? dxDn - ax : 0;
      dyUp = dyUp > ay ? dyUp - ay : 0;
      dyDn = dyDn > ay ? dyDn - ay : 0;
      dzUp = dzUp > az ? dzUp - az : 0;
      dzDn = dzDn > az ? dzDn - az : 0;
      dwUp = dwUp > aw ? dwUp - aw : 0;
      dwDn = dwDn > aw ? dwDn - aw : 0;
    }
  } else {
    ru = Math.sqrt(ux * ux + uy * uy + uz * uz + uw * uw);
  }

  const branchCount = foldBranchCount4(kind);
  for (let b = 0; b < branchCount; b++) {
    if (
      kind === SURFACE_FOLD_SPHEREFOLD ||
      (kind === SURFACE_FOLD_MANDELBOX && b % 81 === 0)
    ) {
      const s = kind === SURFACE_FOLD_SPHEREFOLD ? b : b / 81;
      if (s === 0) {
        vx = ux;
        vy = uy;
        vz = uz;
        vw = uw;
        sfSigma = 1;
        sfRd = ru < fr.fixedR ? fr.fixedR - ru : 0;
      } else if (s === 1) {
        vx = fr.innerScale * ux;
        vy = fr.innerScale * uy;
        vz = fr.innerScale * uz;
        vw = fr.innerScale * uw;
        sfSigma = fr.innerSigma;
        sfRd = ru > fr.outputR ? ru - fr.outputR : 0;
      } else {
        if (ru < fr.midMinR) {
          // Shell guard (see doc): fold the settled shell bound and skip
          // the branch, box expansion included. Point queries only — a
          // spherefold lens never transports a segment (`slabExact4`).
          const shellCert = absW * (fr.fixedR - ru);
          if (shellCert < best) {
            best = shellCert;
            if (best <= visBound) return visBound;
            if (cutoff > 0 && best < cutoff) {
              return best > visBound ? best : visBound;
            }
          }
          if (kind === SURFACE_FOLD_MANDELBOX) b += 80;
          continue;
        }
        const invR2 = fr.fixedR2 / (ru * ru);
        vx = ux * invR2;
        vy = uy * invR2;
        vz = uz * invR2;
        vw = uw * invR2;
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
        pw0 = vw;
        pw1 = wall2 - vw;
        pw2 = -wall2 - vw;
        dxUp = vx > wall ? vx - wall : 0;
        dxDn = vx < -wall ? -wall - vx : 0;
        dyUp = vy > wall ? vy - wall : 0;
        dyDn = vy < -wall ? -wall - vy : 0;
        dzUp = vz > wall ? vz - wall : 0;
        dzDn = vz < -wall ? -wall - vz : 0;
        dwUp = vw > wall ? vw - wall : 0;
        dwDn = vw < -wall ? -wall - vw : 0;
      }
    }
    let cx: number;
    let cy: number;
    let cz: number;
    let cw: number;
    let bex = 0;
    let bey = 0;
    let bez = 0;
    let bew = 0;
    let branchRd: number;
    if (kind === SURFACE_FOLD_SPHEREFOLD) {
      cx = vx;
      cy = vy;
      cz = vz;
      cw = vw;
      branchRd = sfRd;
    } else {
      const bb = kind === SURFACE_FOLD_BOXFOLD ? b : b % 81;
      const selX = bb % 3;
      const selY = ((bb / 3) | 0) % 3;
      const selZ = ((bb / 9) | 0) % 3;
      const selW = (bb / 27) | 0;
      cx = selX === 0 ? px0 : selX === 1 ? px1 : px2;
      cy = selY === 0 ? py0 : selY === 1 ? py1 : py2;
      cz = selZ === 0 ? pz0 : selZ === 1 ? pz1 : pz2;
      cw = selW === 0 ? pw0 : selW === 1 ? pw1 : pw2;
      if (segment) {
        // Branch derivative `diag(±1)`: in-box `u` (+1), folded `±2 − u`
        // (−1). A reflection takes the segment to a segment.
        bex = selX === 0 ? euX : -euX;
        bey = selY === 0 ? euY : -euY;
        bez = selZ === 0 ? euZ : -euZ;
        bew = selW === 0 ? euW : -euW;
      }
      const ddx =
        selX === 0 ? (dxUp > dxDn ? dxUp : dxDn) : selX === 1 ? dxUp : dxDn;
      const ddy =
        selY === 0 ? (dyUp > dyDn ? dyUp : dyDn) : selY === 1 ? dyUp : dyDn;
      const ddz =
        selZ === 0 ? (dzUp > dzDn ? dzUp : dzDn) : selZ === 1 ? dzUp : dzDn;
      const ddw =
        selW === 0 ? (dwUp > dwDn ? dwUp : dwDn) : selW === 1 ? dwUp : dwDn;
      const boxRd2 = ddx * ddx + ddy * ddy + ddz * ddz + ddw * ddw;
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
    const qx = im[0] * cx + im[1] * cy + im[2] * cz + im[3] * cw + it[0];
    const qy = im[4] * cx + im[5] * cy + im[6] * cz + im[7] * cw + it[1];
    const qz = im[8] * cx + im[9] * cy + im[10] * cz + im[11] * cw + it[2];
    const qw = im[12] * cx + im[13] * cy + im[14] * cz + im[15] * cw + it[3];
    if (segment) {
      // The lens's AFFINE part carries the branch half-extent by its linear
      // part alone; the two buffers stay in lockstep (one is the descent
      // hand-off, the other the `segmentRadius` argument).
      LENS_BRANCH_EXT4[0] =
        im[0] * bex + im[1] * bey + im[2] * bez + im[3] * bew;
      LENS_BRANCH_EXT4[1] =
        im[4] * bex + im[5] * bey + im[6] * bez + im[7] * bew;
      LENS_BRANCH_EXT4[2] =
        im[8] * bex + im[9] * bey + im[10] * bez + im[11] * bew;
      LENS_BRANCH_EXT4[3] =
        im[12] * bex + im[13] * bey + im[14] * bez + im[15] * bew;
      LENS_QUERY_EXT4[0] = LENS_BRANCH_EXT4[0];
      LENS_QUERY_EXT4[1] = LENS_BRANCH_EXT4[1];
      LENS_QUERY_EXT4[2] = LENS_BRANCH_EXT4[2];
      LENS_QUERY_EXT4[3] = LENS_BRANCH_EXT4[3];
    }
    const factor = absW * sfSigma * sigmaMinM;
    const rq = segmentRadius(qx, qy, qz, qw, LENS_BRANCH_EXT4);
    // The core's return never undercuts its own depth-0 sphere bound, so a
    // branch whose scaled sphere certificate already reaches the running min
    // cannot advance it — skip the whole descent, exactly.
    if (factor * (rq - R) >= best) continue;
    const innerCutoff =
      cutoff > 0 ? (best < cutoff ? best : cutoff) / factor : 0;
    LENS_QUERY4[0] = qx;
    LENS_QUERY4[1] = qy;
    LENS_QUERY4[2] = qz;
    LENS_QUERY4[3] = qw;
    const innerExt = segment ? LENS_QUERY_EXT4 : null;
    const inner = hasFolds
      ? descendFold4(
          de,
          LENS_QUERY4,
          refine,
          refine ? innerCutoff : 0,
          innerExt,
        )
      : refine
        ? descend4Refined(de, LENS_QUERY4, innerCutoff, innerExt)
        : descend4(de, LENS_QUERY4, innerExt);
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
