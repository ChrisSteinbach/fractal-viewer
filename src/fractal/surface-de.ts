import { composeAffine } from "./affine";
import { isFlatTransform } from "./affine4";
import {
  effectiveSymmetryOrder,
  runChaosGame,
  symmetryRotation,
} from "./chaos-game";
import { mulberry32 } from "./rng";
import type { SymmetryParams, Transform, Vec3 } from "./types";

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
 * exponential branch tree, so {@link estimateDistance} descends greedily
 * (always into the branch whose inverse image lands nearest the origin),
 * unrolling the recursion
 *
 *     dist(q, A) >= min( certificates of the NON-descended siblings,
 *                        sigma_min_g * dist(inv_g(q), A) )
 *
 * into: the min over every level's escaped-sibling certificates, terminated
 * by the greedy branch's own final bound. The descended branch's shallow
 * certificates are deliberately NOT folded in — the recursion refines that
 * one branch deeper, which is what keeps the estimate tight near the
 * surface (the classic KIFS last-value formula, plus a sibling safety net
 * so surfaces reachable through a shallower branch are not overshot).
 * Branches whose images stay INSIDE the sphere carry no positive
 * certificate; descending only the nearest of them is the greedy heuristic,
 * and the residual risk of that choice is what the eligibility analysis'
 * `stepScale` fudge (and the marcher's hit epsilon) absorbs. Two properties
 * worth noting:
 *
 * - A query point ON the attractor can never yield a positive bound: its
 *   true ancestor branch keeps the greedy image inside the sphere at every
 *   depth, so the estimate falls through to `<= 0` (a hit).
 * - Deep in a VOID, every image escapes within a few levels and the positive
 *   certificates measure the void's depth — the march crosses voids instead
 *   of stalling on the (useless, negative) bounding-sphere bound.
 */

/** Per-map anisotropy ratio `sigma_max / sigma_min` at or below which the
 * system counts as conformal-enough to march at full speed. */
const CONFORMAL_RATIO = 1.05;

/** A map whose largest singular value reaches this stops counting as a
 * contraction (Hutchinson's condition for the IFS attractor to exist — and
 * for greedy inverse descent to terminate). */
const CONTRACTION_LIMIT = 0.999;

/** Smallest singular value below which a map is treated as non-invertible
 * (a flat/degenerate map has no inverse to descend through). */
const NEAR_SINGULAR_SIGMA = 1e-4;

/** Points drawn by the seeded bounding-radius probe. */
const PROBE_POINTS = 8192;

/** Fixed seed for the bounding-radius probe: the DE for a given system must
 * be deterministic (tests, GLSL uniforms, and repeated builds all agree). */
const PROBE_SEED = 0x5eedf00d;

/** Pad factor applied to the probe's sampled `maxR` — the probe sees a
 * finite sample of the attractor, whose true supremum sits slightly beyond. */
const RADIUS_PAD = 1.05;

/** Descent stops once the tracked point escapes this multiple of `R`:
 * beyond it, deeper certificates cannot improve the min. */
const ESCAPE_FACTOR = 2;

/** Accumulated-contraction floor that sizes {@link SurfaceDE.maxDepth}:
 * descend until the slowest map chain has shrunk features below ~1e-4. */
const DEPTH_RESOLUTION = 1e-4;

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

/** One symmetry-expanded inverse map of the DE. */
export interface SurfaceDEMap {
  /** Row-major 3x3 `inv(M_i) . Rot_k^T` — the slot's inverse linear part
   * (kaleidoscope copies rotate AFTER the base map, so their inverses
   * un-rotate FIRST). */
  invM: number[];
  /** `-inv(M_i) . t_i` — shared by every rotated copy of base map `i`. */
  invT: Vec3;
  /** Smallest singular value of the FORWARD map — the certified contraction
   * factor multiplied into the running `dr` product. */
  sigmaMin: number;
  /** Which base (un-rotated) map this slot inverts — the analogue of
   * `idx % baseTransformCount`, for per-transform coloring. */
  baseIndex: number;
}

/** Everything the marcher needs, precomputed: the wire format the GLSL
 * uniforms are packed from. */
export interface SurfaceDE {
  /** Symmetry-expanded inverse maps (weight-0 base maps contribute no
   * slots — they are never selected, so they add nothing to the attractor). */
  maps: SurfaceDEMap[];
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

/** Row-major 3x3 product `a · b`. */
function mulMat3(a: number[], b: number[]): number[] {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        a[row * 3] * b[col] +
        a[row * 3 + 1] * b[3 + col] +
        a[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}

/** Row-major 3x3 transpose. */
function transpose3(m: number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/**
 * Precompute the {@link SurfaceDE} for a system: analytically inverted maps
 * (symmetry-expanded exactly like `prepareChaosGame` — same
 * `effectiveSymmetryOrder` clamp against the FULL transform list, same
 * per-copy rotation matrices), per-map `sigma_min`, a probed bounding
 * radius, and the pre-inverted final-transform lens.
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

  // Base inverses, computed once per ACTIVE base map. The kaleidoscope copy
  // k applies its rotation AFTER the base map (chaos-game.ts postRotations),
  // so slot (k, i) is p -> Rot_k · (M_i p + t_i), whose inverse is
  // q -> inv(M_i) · Rot_k^T · q - inv(M_i) · t_i: the translation part is
  // shared by every copy of map i.
  interface BaseInverse {
    invM: number[];
    invT: Vec3;
    sigmaMin: number;
    baseIndex: number;
  }
  const bases: BaseInverse[] = [];
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
    bases.push({ invM, invT, sigmaMin: analysis.sigmas[i].min, baseIndex: i });
  });

  // Symmetry expansion mirroring prepareChaosGame: the effective order is
  // clamped against the FULL list length (weight-0 slots included), copy 0
  // unrotated first.
  const order = effectiveSymmetryOrder(symmetry.order, transforms.length);
  const maps: SurfaceDEMap[] = [];
  for (let k = 0; k < order; k++) {
    const rotT =
      k === 0
        ? null
        : transpose3(
            symmetryRotation(symmetry.axis, (2 * Math.PI * k) / order),
          );
    for (const base of bases) {
      maps.push({
        invM: rotT ? mulMat3(base.invM, rotT) : base.invM,
        invT: base.invT,
        sigmaMin: base.sigmaMin,
        baseIndex: base.baseIndex,
      });
    }
  }

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
  // resolution.
  const slowest = bases.reduce((acc, b) => Math.max(acc, b.sigmaMin), 0);
  const maxDepth = Math.min(
    48,
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
    boundingRadius,
    visibleBoundingRadius,
    escapeRadius: ESCAPE_FACTOR * boundingRadius,
    maxDepth,
    stepScale: analysis.stepScale,
    final,
  };
}

/**
 * Reference DE the GLSL marcher mirrors: greedy inverse-map descent with
 * sibling-certificate tracking (see the module doc for the validity
 * argument).
 *
 * At each level every inverse image is computed anyway to pick the greedy
 * branch (nearest the origin); NON-descended images that escaped the
 * bounding sphere contribute `sigma_min_j · (|image_j| - R)` — a certified
 * lower bound on the distance to THAT piece — while the descended branch is
 * refined by the next level and finally bounded by its terminal
 * `(|q_K| - R)` value. The estimate is the min over all of these, un-scaled
 * by the accumulated contraction, and never beaten by the depth-0 sphere
 * bound `|p| - R`. A point tracking the attractor's occupied region the
 * whole way down ends `<= 0`; the MARCHER floors at its epsilon, not this
 * function, so callers see the raw (possibly negative) bound.
 */
export function estimateDistance(de: SurfaceDE, p: Vec3): number {
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

  const R = de.boundingRadius;
  const sphereBound = Math.sqrt(x * x + y * y + z * z) - R;
  let best = Infinity;
  let scale = 1;
  let lastR = Math.sqrt(x * x + y * y + z * z);

  for (let depth = 0; depth < de.maxDepth; depth++) {
    let greedyR = Infinity;
    let gx = 0;
    let gy = 0;
    let gz = 0;
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
      const ix = im[0] * x + im[1] * y + im[2] * z + it[0];
      const iy = im[3] * x + im[4] * y + im[5] * z + it[1];
      const iz = im[6] * x + im[7] * y + im[8] * z + it[2];
      const r = Math.sqrt(ix * ix + iy * iy + iz * iz);
      if (r < greedyR) {
        greedyR = r;
        gx = ix;
        gy = iy;
        gz = iz;
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
    lastR = greedyR;
    scale *= gSigma;
    if (greedyR > de.escapeRadius) break;
  }

  // Terminal bound of the descended branch (the KIFS last-value formula):
  // non-positive when the point tracked the attractor to the depth cap.
  const terminal = scale * (lastR - R);
  let d = Math.min(best, terminal);
  if (sphereBound > d) d = sphereBound;
  return d * finalScale;
}
