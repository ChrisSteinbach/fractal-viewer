import { composeAffine4, toTransform4 } from "./affine4";
import { runChaosGame4 } from "./chaos-game-4d";
import { mulberry32 } from "./rng";
import {
  CONFORMAL_RATIO,
  CONTRACTION_LIMIT,
  DEPTH_RESOLUTION,
  ESCAPE_FACTOR,
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
 * builds on top of it — greedy descent into the branch whose inverse image
 * lands nearest the origin, escaped-sibling certificates folded in at every
 * level, the terminal KIFS bound closing off the descended branch — carries
 * over unchanged. {@link estimateDistance4} is a structural port of
 * `estimateDistance`: four coordinates instead of three, and nothing else
 * different in shape.
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
 * - No final-transform lens: 3D's `SurfaceDE.final` is a straightforward
 *   port waiting to happen, deliberately deferred until this spike's verdict
 *   on whether a 4D surface render is worth building out at all.
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
 * fr-beck experiment this module exists to support; nothing here answers it.
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
 * 3D's `SurfaceEligibility`, minus the final-transform bookkeeping this
 * spike does not cover (see the module doc). */
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
 * there is no final-transform parameter (spike scope, see the module doc)
 * and no symmetry to affect eligibility either way.
 */
export function analyzeSurfaceSystem4(
  transforms: Transform[],
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
 * analogue of 3D's `SurfaceDE` (minus `visibleBoundingRadius`/`final`: no
 * final-transform lens in this spike, see the module doc). */
export interface SurfaceDE4 {
  /** One inverse map per ACTIVE input transform (weight-0 maps contribute no
   * slot — they are never selected, so they add nothing to the attractor). */
  maps: SurfaceDE4Map[];
  /** Bounding-hypersphere radius of the attractor, probed by a seeded 4D
   * chaos game and padded. */
  boundingRadius: number;
  /** `ESCAPE_FACTOR * boundingRadius` — descent past this cannot help. */
  escapeRadius: number;
  /** Descent depth cap, sized so the SLOWEST contraction chain resolves
   * features below `DEPTH_RESOLUTION`. */
  maxDepth: number;
  /** March step multiplier from {@link analyzeSurfaceSystem4}. */
  stepScale: number;
}

/**
 * Precompute the {@link SurfaceDE4} for a system: every active map lifted
 * (`toTransform4`) and analytically inverted, a probed bounding-hypersphere
 * radius, and a depth cap sized off the slowest contraction. Mirrors 3D's
 * `buildSurfaceDE` minus symmetry expansion (there is none to expand — every
 * slot is a base map 1:1) and minus the final-transform lens (deferred; see
 * the module doc).
 *
 * Throws when the system is ineligible ({@link analyzeSurfaceSystem4}) — the
 * app would gate on the analysis first, so reaching the throw is a bug.
 */
export function buildSurfaceDE4(transforms: Transform[]): SurfaceDE4 {
  const analysis = analyzeSurfaceSystem4(transforms);
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

  // Depth cap from the SLOWEST contraction, identical formula to 3D.
  const slowest = maps.reduce((acc, map) => Math.max(acc, map.sigmaMin), 0);
  const maxDepth = Math.min(
    48,
    Math.max(8, Math.ceil(Math.log(DEPTH_RESOLUTION) / Math.log(slowest))),
  );

  return {
    maps,
    boundingRadius,
    escapeRadius: ESCAPE_FACTOR * boundingRadius,
    maxDepth,
    stepScale: analysis.stepScale,
  };
}

/**
 * Reference DE the module's validity argument certifies: greedy inverse-map
 * descent with sibling-certificate tracking, a structural port of 3D's
 * `estimateDistance` (see the module doc for why the validity argument
 * transfers) with every coordinate step unrolled to four terms instead of
 * three, and no final-transform block (this spike does not build a lens —
 * see the module doc).
 *
 * At each depth every inverse image is computed to find the greedy branch
 * (nearest the origin) while also tracking the two smallest ESCAPED
 * certificates (`sigma_min_j * (r_j - R)`, only for images that landed
 * outside the bounding sphere); the smaller of the two survives as the
 * "sibling" certificate whenever the overall smallest belongs to the branch
 * about to be descended (its own certificate is about to be refined by the
 * next level instead, so folding it in here would double-count). The loop
 * breaks once the greedy branch escapes past `escapeRadius`; the final
 * `(lastR - R)` scaled by the accumulated contraction is the terminal KIFS
 * bound for whatever is left of the descended branch. The overall estimate
 * never beats the depth-0 sphere bound `|p| - R`.
 */
export function estimateDistance4(de: SurfaceDE4, p: Vec4): number {
  const R = de.boundingRadius;
  let x = p[0];
  let y = p[1];
  let z = p[2];
  let w = p[3];
  const sphereBound = Math.sqrt(x * x + y * y + z * z + w * w) - R;

  let best = Infinity;
  let scale = 1;
  let lastR = Math.sqrt(x * x + y * y + z * z + w * w);

  for (let depth = 0; depth < de.maxDepth; depth++) {
    let greedyR = Infinity;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    let gw = 0;
    let gSigma = 1;
    // Two smallest certificates this level + which map owns the smallest,
    // so the descended (greedy) branch's own certificate can be dropped in
    // favor of its deeper refinement without a second scan.
    let greedyIndex = -1;
    let cert1 = Infinity;
    let cert2 = Infinity;
    let cert1Index = -1;
    for (let j = 0; j < de.maps.length; j++) {
      const map = de.maps[j];
      const im = map.invM;
      const it = map.invT;
      const ix = im[0] * x + im[1] * y + im[2] * z + im[3] * w + it[0];
      const iy = im[4] * x + im[5] * y + im[6] * z + im[7] * w + it[1];
      const iz = im[8] * x + im[9] * y + im[10] * z + im[11] * w + it[2];
      const iw = im[12] * x + im[13] * y + im[14] * z + im[15] * w + it[3];
      const r = Math.sqrt(ix * ix + iy * iy + iz * iz + iw * iw);
      if (r < greedyR) {
        greedyR = r;
        gx = ix;
        gy = iy;
        gz = iz;
        gw = iw;
        gSigma = map.sigmaMin;
        greedyIndex = j;
      }
      if (r > R) {
        const bound = map.sigmaMin * (r - R);
        if (bound < cert1) {
          cert2 = cert1;
          cert1 = bound;
          cert1Index = j;
        } else if (bound < cert2) {
          cert2 = bound;
        }
      }
    }
    const siblingCert = cert1Index === greedyIndex ? cert2 : cert1;
    if (siblingCert < Infinity && scale * siblingCert < best) {
      best = scale * siblingCert;
    }
    x = gx;
    y = gy;
    z = gz;
    w = gw;
    lastR = greedyR;
    scale *= gSigma;
    if (greedyR > de.escapeRadius) break;
  }

  // Terminal bound of the descended branch (the KIFS last-value formula):
  // non-positive when the point tracked the attractor to the depth cap.
  const terminal = scale * (lastR - R);
  let d = Math.min(best, terminal);
  if (sphereBound > d) d = sphereBound;
  return d;
}
