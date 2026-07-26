import { composeAffine4, toTransform4 } from "./affine4";
import { runChaosGame4 } from "./chaos-game-4d";
import { mulberry32 } from "./rng";
import {
  CONFORMAL_RATIO,
  CONTRACTION_LIMIT,
  DEPTH_RESOLUTION,
  ESCAPE_FACTOR,
  MAX_DESCENT_DEPTH,
  NEAR_SINGULAR_SIGMA,
  PROBE_POINTS,
  PROBE_SEED,
  RADIUS_PAD,
} from "./surface-de";
import type { MapSigmas, SurfaceEligibilityStatus } from "./surface-de";
import type { Transform, Transform4, Vec4 } from "./types";

/**
 * 4D surface distance estimation for an affine IFS — the fr-beck feasibility
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
 * builds on top of it — the width-2 descent beam (fr-v6yg) refining the
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
 * - No kaleidoscope symmetry: the 4D chaos-game pipeline has none, by design
 *   (`chaos-game-4d.ts`'s `PreparedChaosGame4` — "every slot IS a base
 *   transform", no `postRotations`/`baseTransformCount` to carry), so there
 *   is nothing here to expand — {@link SurfaceDE4.maps} is the input maps
 *   1:1, unlike 3D's symmetry-expanded `SurfaceDEMap[]`.
 * - The final-transform lens is no longer on this list. It was originally
 *   deferred here as 3D's `SurfaceDE.final` "waiting to happen" until this
 *   spike's verdict landed; it has SINCE landed (fr-vxoj, post-verdict), a
 *   straight port one dimension up — {@link SurfaceDE4.final}, matching
 *   `analyzeSurfaceSystem4`/`buildSurfaceDE4` bookkeeping, and the lens
 *   prologue/epilogue {@link estimateDistance4} and
 *   {@link estimateDistance4Refined} apply in lockstep.
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
 * fr-beck experiment this module exists to support; the verdict below
 * answers it.
 *
 * SPIKE VERDICT (fr-beck, measured 2026-07): GO for a slice-mode render.
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
 * eligibility-side guard for that profile was filed as follow-up work
 * (fr-v6yg). Full experiment tables live on the fr-beck bead.
 *
 * FR-V6YG RESOLUTION (measured 2026-07, after the verdict above): the
 * exclusion is repaired — not by an eligibility guard but by the width-2
 * descent BEAM both estimators now run (see `estimateDistance` in the 3D
 * twin for the mechanics): the second chain refines the second-nearest
 * in-sphere branch instead of dropping it, which is exactly the
 * branch-selection risk doubleRotation exposed. Measured on the fr-v6yg
 * harness (`scripts/surface-beam.harness.ts`): doubleRotation's jittered/
 * uniform violations drop to 0 for BOTH estimators (max excess 19.4%R base
 * / 20.8%R refined -> fp-noise ~3e-8), and the refined estimator's
 * void-false-hit proxy reads 0/514 — the march-ghost mechanism and the
 * overshoot mechanism are both closed, at ~1.5x inverse-application cost
 * on this system. Residual (disclosed on the fr-v6yg bead): 3+
 * simultaneous in-sphere branches still drop (m >= 3 slow-map systems,
 * sigma_max >= 0.96, and kaleidoscope-tied copies in 3D) at ~2-5%R.
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

/**
 * Classify a system for a 4D surface render mode. Mirrors 3D's
 * `analyzeSurfaceSystem` exactly, with two deliberate differences: every
 * transform is lifted with `toTransform4` before its sigmas are measured
 * (so a map's `w` extension is what gets checked for contraction, not
 * ignored), and there is no `isFlatTransform` gate — a system extending into
 * 4D is the entire point of this module, not a disqualifier. Weight-0 maps
 * are still ignored (never selected, so they add nothing to the attractor);
 * no symmetry to affect eligibility either way.
 *
 * The optional `finalTransform` mirrors 3D's final-transform gate (active
 * variations disqualify, near-zero scale disqualifies, anisotropy folds into
 * the reported worst case) with the SAME 4D-specific carve-out as the
 * per-map loop above: no `isFlatTransform` gate and no "extends into 4D"
 * reason for the final transform either — lifting the visible set out of
 * the `w = 0` slice via the final transform is exactly this module's point,
 * not a disqualifier.
 */
export function analyzeSurfaceSystem4(
  transforms: Transform[],
  finalTransform: Transform | null = null,
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

  transforms.forEach((t, i) => {
    if (!isActive(t)) return;
    const label = `map ${i + 1}`;
    if (hasActiveVariations(t)) {
      reasons.push(`${label} uses variations`);
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

/** One inverted base map of the 4D DE — the direct analogue of 3D's
 * `SurfaceDEMap`, minus the kaleidoscope rotation (there are no symmetry
 * copies to un-rotate; see the module doc). */
export interface SurfaceDE4Map {
  /** Row-major 4x4 `inv(M_i)`. */
  invM: number[];
  /** `-inv(M_i) . t_i`. */
  invT: Vec4;
  /** Smallest singular value of the FORWARD map — the certified contraction
   * factor multiplied into the running `dr` product. */
  sigmaMin: number;
  /** Which input transform this slot inverts — always `===` the slot's own
   * index, since there is no symmetry expansion folding multiple slots onto
   * one base map; kept for parity with 3D's `baseIndex` (e.g. per-transform
   * coloring keyed the same way). */
  baseIndex: number;
}

/** Everything {@link estimateDistance4} needs, precomputed — the 4D
 * analogue of 3D's `SurfaceDE`, final-transform lens included (fr-vxoj,
 * post-verdict — see the module doc's landing note). */
export interface SurfaceDE4 {
  /** One inverse map per ACTIVE input transform (weight-0 maps contribute no
   * slot — they are never selected, so they add nothing to the attractor). */
  maps: SurfaceDE4Map[];
  /** Bounding-hypersphere radius of the RAW attractor (pre-final-transform),
   * probed by a seeded 4D chaos game and padded. */
  boundingRadius: number;
  /** Radius bounding the VISIBLE set `F(attractor)` — equals
   * `boundingRadius` when there is no final transform. */
  visibleBoundingRadius: number;
  /** `ESCAPE_FACTOR * boundingRadius` — descent past this cannot help. */
  escapeRadius: number;
  /** Descent depth cap, sized so the SLOWEST contraction chain resolves
   * features below `DEPTH_RESOLUTION`. */
  maxDepth: number;
  /** How many descent chains {@link estimateDistance4} refines in
   * parallel. Widths 1/2 are the classic greedy chain and the fr-v6yg pair;
   * widths 3/4 add the fr-jkpn VALIDITY slots — extra chains that hold the
   * level's rank-3/4 candidates ONLY while their points are in-sphere (an
   * escaped rank-3/4 candidate folds its refined certificate instead,
   * exactly as it would without the slots), so levels with three or four
   * simultaneous in-sphere branches no longer drop the excess uncounted.
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
   * the slice lower-bound argument is unaffected by the lens. */
  final: { invM: number[]; invT: Vec4; sigmaMin: number } | null;
}

/**
 * Precompute the {@link SurfaceDE4} for a system: every active map lifted
 * (`toTransform4`) and analytically inverted, a probed bounding-hypersphere
 * radius, a depth cap sized off the slowest contraction, and the
 * pre-inverted final-transform lens. Mirrors 3D's `buildSurfaceDE` minus
 * symmetry expansion (there is none to expand — every slot is a base map
 * 1:1).
 *
 * Throws when the system is ineligible ({@link analyzeSurfaceSystem4}) — the
 * app would gate on the analysis first, so reaching the throw is a bug.
 */
export function buildSurfaceDE4(
  transforms: Transform[],
  finalTransform: Transform | null = null,
): SurfaceDE4 {
  const analysis = analyzeSurfaceSystem4(transforms, finalTransform);
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

  const maps: SurfaceDE4Map[] = [];
  transforms.forEach((t, i) => {
    if (!isActive(t)) return;
    const affine = composeAffine4(lifted[i]);
    const invM = inverse4(affine.m);
    const [tx, ty, tz, tw] = affine.t;
    const invT: Vec4 = [
      -(invM[0] * tx + invM[1] * ty + invM[2] * tz + invM[3] * tw),
      -(invM[4] * tx + invM[5] * ty + invM[6] * tz + invM[7] * tw),
      -(invM[8] * tx + invM[9] * ty + invM[10] * tz + invM[11] * tw),
      -(invM[12] * tx + invM[13] * ty + invM[14] * tz + invM[15] * tw),
    ];
    maps.push({ invM, invT, sigmaMin: analysis.sigmas[i].min, baseIndex: i });
  });

  // Bounding radius: a seeded probe of the exact plotted set (the full
  // lifted list — weight-0 slots are simply never drawn). Unlike 3D's
  // `probe.bounds.maxR` (already origin-based), `runChaosGame4`'s `radius`
  // is measured from the cloud's CENTER, not the origin (see its doc) — the
  // wrong quantity for a DE's "the attractor sits inside a sphere AROUND THE
  // ORIGIN" base case — so this re-derives the max ORIGIN distance directly
  // from the emitted points instead of reusing that field.
  const probe = runChaosGame4(lifted, PROBE_POINTS, mulberry32(PROBE_SEED));
  let maxR = 0;
  for (let i = 0; i < probe.count; i++) {
    const x = probe.positions[i * 3];
    const y = probe.positions[i * 3 + 1];
    const z = probe.positions[i * 3 + 2];
    const w = probe.w[i];
    const r = Math.sqrt(x * x + y * y + z * z + w * w);
    if (r > maxR) maxR = r;
  }
  const boundingRadius = maxR * RADIUS_PAD + 1e-3;

  // Depth cap from the SLOWEST contraction, identical formula to 3D
  // (ceiling: see MAX_DESCENT_DEPTH's fr-xok8 sizing note — doubleRotation
  // is the preset the old 48 ceiling clamped into a solid core ball).
  const slowest = maps.reduce((acc, map) => Math.max(acc, map.sigmaMin), 0);
  const maxDepth = Math.min(
    MAX_DESCENT_DEPTH,
    Math.max(8, Math.ceil(Math.log(DEPTH_RESOLUTION) / Math.log(slowest))),
  );

  // Final-transform lens, mirroring 3D's buildSurfaceDE lines 485-500: lift,
  // invert the composed 4x4, and derive invT with the same row-major
  // pattern as the per-map inversion above. The probe above never applies
  // this — it measures the RAW attractor, and the DE descends the raw
  // attractor and applies the lens to the query instead (see
  // estimateDistance4's prologue).
  let final: SurfaceDE4["final"] = null;
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
    final = { invM, invT, sigmaMin: s.min };
    // |F(x)| <= sigma_max·|x| + |t| bounds the visible set F(attractor).
    visibleBoundingRadius = s.max * boundingRadius + Math.hypot(tx, ty, tz, tw);
  }

  return {
    maps,
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
 * Width 2 is what repairs the fr-v6yg branch-selection overshoot
 * (doubleRotation's profile) that certificate refinement provably cannot
 * touch; widths 3/4 add the fr-jkpn validity slots — rank-3/4 chains that
 * live only while in-sphere, closing the 3-and-4-simultaneous drops.
 */
export function estimateDistance4(de: SurfaceDE4, p: Vec4): number {
  let x = p[0];
  let y = p[1];
  let z = p[2];
  let w = p[3];
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
    finalScale = f.sigmaMin;
  }

  const R = de.boundingRadius;
  const startR = Math.sqrt(x * x + y * y + z * z + w * w);
  const sphereBound = startR - R;
  const wide = de.beamWidth > 1;
  let best = Infinity;

  // Chain slot A starts at the (lensed) query; slot B idles until beam
  // selection fills it (width-2 up). V1/V2 are the fr-jkpn validity slots
  // (widths 3/4): they hold the level's rank-3/4 candidates ONLY while
  // those are in-sphere — branches that carry no positive certificate, so
  // dropping them was the measured invalidity — and fold the ordinary
  // certificate the moment they escape. Mirrors 3D's estimateDistance with
  // a fourth coordinate on every chain and candidate slot.
  const extra = de.beamWidth - 2;
  let aX = x;
  let aY = y;
  let aZ = z;
  let aW = w;
  let aScale = 1;
  let aR = startR;
  let aLive = true;
  let bX = 0;
  let bY = 0;
  let bZ = 0;
  let bW = 0;
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
  let v1W = 0;
  let v1Scale = 1;
  let v1Live = false;
  let v2X = 0;
  let v2Y = 0;
  let v2Z = 0;
  let v2W = 0;
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
    let c1W = 0;
    let c1Scale = 1;
    let c1R = 0;
    let c1Cert = 0;
    let c2Key = Infinity;
    let c2X = 0;
    let c2Y = 0;
    let c2Z = 0;
    let c2W = 0;
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
    let c3W = 0;
    let c3Scale = 1;
    let c3R = 0;
    let c3Cert = 0;
    let c4Key = Infinity;
    let c4X = 0;
    let c4Y = 0;
    let c4Z = 0;
    let c4W = 0;
    let c4Scale = 1;
    let c4R = 0;
    let c4Cert = 0;
    for (let c = 0; c < 4; c++) {
      let pX: number;
      let pY: number;
      let pZ: number;
      let pW: number;
      let pScale: number;
      if (c === 0) {
        if (!aLive) continue;
        pX = aX;
        pY = aY;
        pZ = aZ;
        pW = aW;
        pScale = aScale;
      } else if (c === 1) {
        if (!bLive) continue;
        pX = bX;
        pY = bY;
        pZ = bZ;
        pW = bW;
        pScale = bScale;
      } else if (c === 2) {
        if (!v1Live) continue;
        pX = v1X;
        pY = v1Y;
        pZ = v1Z;
        pW = v1W;
        pScale = v1Scale;
      } else {
        if (!v2Live) continue;
        pX = v2X;
        pY = v2Y;
        pZ = v2Z;
        pW = v2W;
        pScale = v2Scale;
      }
      for (let j = 0; j < de.maps.length; j++) {
        const map = de.maps[j];
        const im = map.invM;
        const it = map.invT;
        const ix = im[0] * pX + im[1] * pY + im[2] * pZ + im[3] * pW + it[0];
        const iy = im[4] * pX + im[5] * pY + im[6] * pZ + im[7] * pW + it[1];
        const iz = im[8] * pX + im[9] * pY + im[10] * pZ + im[11] * pW + it[2];
        const iw =
          im[12] * pX + im[13] * pY + im[14] * pZ + im[15] * pW + it[3];
        const r = Math.sqrt(ix * ix + iy * iy + iz * iz + iw * iw);
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
        let eW = iw;
        let eScale = childScale;
        let eR = r;
        let eCert = cert;
        if (key < c1Key) {
          eKey = c2Key;
          eX = c2X;
          eY = c2Y;
          eZ = c2Z;
          eW = c2W;
          eScale = c2Scale;
          eR = c2R;
          eCert = c2Cert;
          c2Key = c1Key;
          c2X = c1X;
          c2Y = c1Y;
          c2Z = c1Z;
          c2W = c1W;
          c2Scale = c1Scale;
          c2R = c1R;
          c2Cert = c1Cert;
          c1Key = key;
          c1X = ix;
          c1Y = iy;
          c1Z = iz;
          c1W = iw;
          c1Scale = childScale;
          c1R = r;
          c1Cert = cert;
        } else if (key < c2Key) {
          eKey = c2Key;
          eX = c2X;
          eY = c2Y;
          eZ = c2Z;
          eW = c2W;
          eScale = c2Scale;
          eR = c2R;
          eCert = c2Cert;
          c2Key = key;
          c2X = ix;
          c2Y = iy;
          c2Z = iz;
          c2W = iw;
          c2Scale = childScale;
          c2R = r;
          c2Cert = cert;
        }
        if (extra > 0) {
          // Spill into the rank-3/4 ladder; what THAT evicts (or the
          // spilled tuple itself, when it beats neither slot) falls
          // through to the fold below — which reads radius + certificate
          // only, so evictions narrow to that pair.
          if (eKey < c3Key) {
            const tR = extra > 1 ? c4R : c3R;
            const tCert = extra > 1 ? c4Cert : c3Cert;
            if (extra > 1) {
              c4Key = c3Key;
              c4X = c3X;
              c4Y = c3Y;
              c4Z = c3Z;
              c4W = c3W;
              c4Scale = c3Scale;
              c4R = c3R;
              c4Cert = c3Cert;
            }
            c3Key = eKey;
            c3X = eX;
            c3Y = eY;
            c3Z = eZ;
            c3W = eW;
            c3Scale = eScale;
            c3R = eR;
            c3Cert = eCert;
            eR = tR;
            eCert = tCert;
          } else if (extra > 1 && eKey < c4Key) {
            const tR = c4R;
            const tCert = c4Cert;
            c4Key = eKey;
            c4X = eX;
            c4Y = eY;
            c4Z = eZ;
            c4W = eW;
            c4Scale = eScale;
            c4R = eR;
            c4Cert = eCert;
            eR = tR;
            eCert = tCert;
          }
        }
        // The tuple leaving the beam frontier: escaped candidates fold
        // their plain certificate; an in-sphere tuple carries no positive
        // certificate — on widths 3/4 it can only get here past FOUR
        // smaller keys, the (shrunken) fr-jkpn residual drop.
        if (eR > R && eCert < best) best = eCert;
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
      if (c1R > de.escapeRadius) {
        if (c1Cert < best) best = c1Cert;
      } else {
        aX = c1X;
        aY = c1Y;
        aZ = c1Z;
        aW = c1W;
        aScale = c1Scale;
        aR = c1R;
        aLive = true;
      }
    }
    if (c2Key < Infinity) {
      if (!wide || c2R > de.escapeRadius) {
        if (c2R > R && c2Cert < best) best = c2Cert;
      } else {
        bX = c2X;
        bY = c2Y;
        bZ = c2Z;
        bW = c2W;
        bScale = c2Scale;
        bR = c2R;
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
        v1Scale = c3Scale;
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
        v2Scale = c4Scale;
        v2Live = true;
      }
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
 *     inner_j = min over ALL maps k of [ sigmaMin_k * (|invMap_k(q'_j)| - R) ]
 *     cert_j  = sigmaMin_j * max( r_j - R, inner_j )
 *
 * Widths 3/4 add the fr-jkpn validity slots exactly as the base estimator
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
 * WHY THIS EXISTS. fr-beck's spike measured WHICH term of
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
 * fr-1z6p laziness guard (backported alongside the 3D
 * `estimateDistanceRefined`): refinement can only RAISE a certificate, so
 * a fold whose PLAIN certificate already fails to beat the running min
 * folds nothing either way (`min(best, refined) === best` whenever
 * `plain >= best`) and the inner sweep is skipped. Bit-exact — every
 * number in the SPIKE VERDICT above is unchanged — while the extra
 * sweeps collapse to the folds that actually advance the min.
 *
 * EARLY-OUT CUTOFF (fr-55r5), the 3D twin's `estimateDistanceRefined`
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
 */
export function estimateDistance4Refined(
  de: SurfaceDE4,
  p: Vec4,
  cutoff = 0,
): number {
  let x = p[0];
  let y = p[1];
  let z = p[2];
  let w = p[3];
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
    finalScale = f.sigmaMin;
  }

  const R = de.boundingRadius;
  const startR = Math.sqrt(x * x + y * y + z * z + w * w);
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
  // image, over every map k (see the doc comment's VALIDITY note): the
  // certificate becomes childScale * max(r - R, inner) — never below the
  // base estimator's childScale * (r - R).
  const refinedCert = (
    ix: number,
    iy: number,
    iz: number,
    iw: number,
    r: number,
    childScale: number,
  ): number => {
    let inner = Infinity;
    for (let k = 0; k < de.maps.length; k++) {
      const mapK = de.maps[k];
      const imK = mapK.invM;
      const itK = mapK.invT;
      const kx = imK[0] * ix + imK[1] * iy + imK[2] * iz + imK[3] * iw + itK[0];
      const ky = imK[4] * ix + imK[5] * iy + imK[6] * iz + imK[7] * iw + itK[1];
      const kz =
        imK[8] * ix + imK[9] * iy + imK[10] * iz + imK[11] * iw + itK[2];
      const kw =
        imK[12] * ix + imK[13] * iy + imK[14] * iz + imK[15] * iw + itK[3];
      const rk = Math.sqrt(kx * kx + ky * ky + kz * kz + kw * kw);
      const innerTerm = mapK.sigmaMin * (rk - R);
      if (innerTerm < inner) inner = innerTerm;
    }
    return childScale * Math.max(r - R, inner);
  };

  // Chain slot A starts at the (lensed) query; slot B idles until beam
  // selection fills it (width-2 up). V1/V2 are the fr-jkpn validity slots
  // (widths 3/4): they hold the level's rank-3/4 candidates ONLY while
  // those are in-sphere — branches that carry no positive certificate, so
  // dropping them was the measured invalidity — and fold the ordinary
  // refined certificate the moment they escape.
  const extra = de.beamWidth - 2;
  let aX = x;
  let aY = y;
  let aZ = z;
  let aW = w;
  let aScale = 1;
  let aR = startR;
  let aLive = true;
  let bX = 0;
  let bY = 0;
  let bZ = 0;
  let bW = 0;
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
  let v1W = 0;
  let v1Scale = 1;
  let v1Live = false;
  let v2X = 0;
  let v2Y = 0;
  let v2Z = 0;
  let v2W = 0;
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
    let c1W = 0;
    let c1Scale = 1;
    let c1R = 0;
    let c1Cert = 0;
    let c2Key = Infinity;
    let c2X = 0;
    let c2Y = 0;
    let c2Z = 0;
    let c2W = 0;
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
    let c3W = 0;
    let c3Scale = 1;
    let c3R = 0;
    let c3Cert = 0;
    let c4Key = Infinity;
    let c4X = 0;
    let c4Y = 0;
    let c4Z = 0;
    let c4W = 0;
    let c4Scale = 1;
    let c4R = 0;
    let c4Cert = 0;
    for (let c = 0; c < 4; c++) {
      let pX: number;
      let pY: number;
      let pZ: number;
      let pW: number;
      let pScale: number;
      if (c === 0) {
        if (!aLive) continue;
        pX = aX;
        pY = aY;
        pZ = aZ;
        pW = aW;
        pScale = aScale;
      } else if (c === 1) {
        if (!bLive) continue;
        pX = bX;
        pY = bY;
        pZ = bZ;
        pW = bW;
        pScale = bScale;
      } else if (c === 2) {
        if (!v1Live) continue;
        pX = v1X;
        pY = v1Y;
        pZ = v1Z;
        pW = v1W;
        pScale = v1Scale;
      } else {
        if (!v2Live) continue;
        pX = v2X;
        pY = v2Y;
        pZ = v2Z;
        pW = v2W;
        pScale = v2Scale;
      }
      for (let j = 0; j < de.maps.length; j++) {
        const map = de.maps[j];
        const im = map.invM;
        const it = map.invT;
        const ix = im[0] * pX + im[1] * pY + im[2] * pZ + im[3] * pW + it[0];
        const iy = im[4] * pX + im[5] * pY + im[6] * pZ + im[7] * pW + it[1];
        const iz = im[8] * pX + im[9] * pY + im[10] * pZ + im[11] * pW + it[2];
        const iw =
          im[12] * pX + im[13] * pY + im[14] * pZ + im[15] * pW + it[3];
        const r = Math.sqrt(ix * ix + iy * iy + iz * iz + iw * iw);
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
        let eW = iw;
        let eScale = childScale;
        let eR = r;
        let eCert = cert;
        if (key < c1Key) {
          eKey = c2Key;
          eX = c2X;
          eY = c2Y;
          eZ = c2Z;
          eW = c2W;
          eScale = c2Scale;
          eR = c2R;
          eCert = c2Cert;
          c2Key = c1Key;
          c2X = c1X;
          c2Y = c1Y;
          c2Z = c1Z;
          c2W = c1W;
          c2Scale = c1Scale;
          c2R = c1R;
          c2Cert = c1Cert;
          c1Key = key;
          c1X = ix;
          c1Y = iy;
          c1Z = iz;
          c1W = iw;
          c1Scale = childScale;
          c1R = r;
          c1Cert = cert;
        } else if (key < c2Key) {
          eKey = c2Key;
          eX = c2X;
          eY = c2Y;
          eZ = c2Z;
          eW = c2W;
          eScale = c2Scale;
          eR = c2R;
          eCert = c2Cert;
          c2Key = key;
          c2X = ix;
          c2Y = iy;
          c2Z = iz;
          c2W = iw;
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
            const tW = extra > 1 ? c4W : c3W;
            const tScale = extra > 1 ? c4Scale : c3Scale;
            const tR = extra > 1 ? c4R : c3R;
            const tCert = extra > 1 ? c4Cert : c3Cert;
            if (extra > 1) {
              c4Key = c3Key;
              c4X = c3X;
              c4Y = c3Y;
              c4Z = c3Z;
              c4W = c3W;
              c4Scale = c3Scale;
              c4R = c3R;
              c4Cert = c3Cert;
            }
            c3Key = eKey;
            c3X = eX;
            c3Y = eY;
            c3Z = eZ;
            c3W = eW;
            c3Scale = eScale;
            c3R = eR;
            c3Cert = eCert;
            eX = tX;
            eY = tY;
            eZ = tZ;
            eW = tW;
            eScale = tScale;
            eR = tR;
            eCert = tCert;
          } else if (extra > 1 && eKey < c4Key) {
            const tX = c4X;
            const tY = c4Y;
            const tZ = c4Z;
            const tW = c4W;
            const tScale = c4Scale;
            const tR = c4R;
            const tCert = c4Cert;
            c4Key = eKey;
            c4X = eX;
            c4Y = eY;
            c4Z = eZ;
            c4W = eW;
            c4Scale = eScale;
            c4R = eR;
            c4Cert = eCert;
            eX = tX;
            eY = tY;
            eZ = tZ;
            eW = tW;
            eScale = tScale;
            eR = tR;
            eCert = tCert;
          }
        }
        // The tuple leaving the beam frontier: escaped candidates fold
        // their certificate through the guarded refined path (the guard
        // already knows the plain certificate would have advanced the
        // min); an in-sphere tuple carries no positive certificate — on
        // widths 3/4 it can only get here past FOUR smaller keys, the
        // (shrunken) fr-jkpn residual drop.
        if (eR > R && eCert < best) {
          const rc = refinedCert(eX, eY, eZ, eW, eR, eScale);
          if (rc < best) {
            best = rc;
            // Cutoff exit (fr-55r5). `rc` is FINALIZED — already refined,
            // so no later level can lift it — and `best` only falls from
            // here, so once the value this would return sits under the
            // caller's acceptance epsilon the remaining descent cannot
            // change its verdict.
            if (best * finalScale < bailBelow) {
              return descentValue(best, sphereBound, finalScale);
            }
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
      if (c1R > de.escapeRadius) {
        if (c1Cert < best) best = c1Cert;
      } else {
        aX = c1X;
        aY = c1Y;
        aZ = c1Z;
        aW = c1W;
        aScale = c1Scale;
        aR = c1R;
        aLive = true;
      }
    }
    if (c2Key < Infinity) {
      if (!wide) {
        if (c2R > R && c2Cert < best) {
          const rc = refinedCert(c2X, c2Y, c2Z, c2W, c2R, c2Scale);
          if (rc < best) best = rc;
        }
      } else if (c2R > de.escapeRadius) {
        if (c2Cert < best) best = c2Cert;
      } else {
        bX = c2X;
        bY = c2Y;
        bZ = c2Z;
        bW = c2W;
        bScale = c2Scale;
        bR = c2R;
        bLive = true;
      }
    }
    if (extra > 0 && c3Key < Infinity) {
      if (c3R > R) {
        if (c3Cert < best) {
          const rc = refinedCert(c3X, c3Y, c3Z, c3W, c3R, c3Scale);
          if (rc < best) best = rc;
        }
      } else {
        v1X = c3X;
        v1Y = c3Y;
        v1Z = c3Z;
        v1W = c3W;
        v1Scale = c3Scale;
        v1Live = true;
      }
    }
    if (extra > 1 && c4Key < Infinity) {
      if (c4R > R) {
        if (c4Cert < best) {
          const rc = refinedCert(c4X, c4Y, c4Z, c4W, c4R, c4Scale);
          if (rc < best) best = rc;
        }
      } else {
        v2X = c4X;
        v2Y = c4Y;
        v2Z = c4Z;
        v2W = c4W;
        v2Scale = c4Scale;
        v2Live = true;
      }
    }
    // Cutoff exit (fr-55r5), covering the four promote folds above in one
    // test: each of them either wrote a settled certificate into `best` (a
    // refined one at the two validity-slot sites and the width-1 runner-up,
    // the deliberately plain escape-radius bound at the other two) or
    // continued a chain, and neither the rest of this level nor any deeper
    // one can raise the running min back. Deliberately NOT a `break`: the
    // terminal bounds past the loop are folds the FULL descent only makes
    // at the depth cap, and folding one here could drop `best` below a
    // value the full computation never reaches.
    if (best * finalScale < bailBelow) {
      return descentValue(best, sphereBound, finalScale);
    }
  }

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
