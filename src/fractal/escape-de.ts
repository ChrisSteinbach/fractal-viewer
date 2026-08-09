/**
 * Escape-time fold render (fr-kltj): the distance-estimated ESCAPE-TIME set
 * of a single fold map — the canonical Mandelbox/Juliabox object — for
 * exactly the systems the IFS surface mode is right to refuse.
 *
 * THE OBJECT. `surface-de.ts` renders IFS attractors: the fixed set of a
 * CONTRACTIVE map family, estimated by descending inverse maps. A pure-fold
 * map authored at the classic Mandelbox parameters (weight ~2) is not
 * contractive — it has NO IFS attractor, `analyzeSurfaceSystem` correctly
 * reads "does not contract", and no inverse-descent estimator exists. But
 * that map has a different canonical set: iterate `v <- T(v) = w·V(M v + t)`
 * FORWARD from the query point and ask whether the orbit stays bounded.
 * The boundary of the non-escaping region is the object every published
 * Mandelbox render marches. Because the document's `t` is a fixed offset
 * (not the per-pixel `c` of the Mandelbrot-form), the rendered set is the
 * JULIA-form fold set of the authored transform — the same vocabulary the
 * chaos game, morphs and mutations already speak, which is what makes this
 * a render MODE rather than a second document format (the fr-kltj scoping
 * decision).
 *
 * THE ESTIMATE. The classic scalar-derivative distance estimate
 * (Hart's unbounding volumes via the Buddhi/Rrrola Mandelbox form the
 * fr-kltj sketch names):
 *
 *     v = p; dr = 1
 *     repeat ESCAPE_TIME_ITERATIONS times or until |v| > ESCAPE_TIME_RADIUS:
 *       y  = M v + t
 *       v  = w · V(y)          // the fold, exactly variations.ts's forward math
 *       dr = |w| · L(y) · sigma_max(M) · dr + 1
 *     DE = |v| / dr
 *
 * `L(y)` is the fold's local conformal factor at the point — 1 for the
 * boxfold's reflections, `sphereFoldFactor(|y|²)` (1..4) for the
 * spherefold family — and `sigma_max(M)` bounds the affine part, so `dr`
 * over-estimates the orbit derivative and the quotient under-estimates
 * distance in the direction a sphere tracer needs. Unlike the IFS
 * estimators this is the field's standard HEURISTIC bound, not a
 * certified one (the `+ 1` keeps the Mandelbrot-form's conservatism);
 * the marcher's stepScale and acceptance epsilon absorb the usual slack
 * exactly as every published Mandelbox marcher does. A non-escaping
 * orbit returns |v|/dr with dr grown huge — effectively 0, the inside
 * signal.
 *
 * ELIGIBILITY is the COMPLEMENT of the IFS gate on the shapes this
 * formula covers: exactly one active map, whose active variation list is
 * exactly one fold-family entry, flat, no final transform, no
 * kaleidoscope — and NOT an IFS-eligible contraction (a system the
 * attractor tracer already owns keeps its sound estimator; this mode
 * exists for the ones it refuses). Everything else stays ineligible for
 * both modes, with reasons.
 */
import { composeAffine } from "./affine";
import { isFlatTransform } from "./affine4";
import { effectiveSymmetryOrder } from "./chaos-game";
import {
  CONTRACTION_LIMIT,
  SPHEREFOLD_LIPSCHITZ,
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_MANDELBOX,
  SURFACE_FOLD_SPHEREFOLD,
  transformSigmas,
} from "./surface-de";
import type { SurfaceFoldKind } from "./surface-de";
import type { SymmetryParams, Transform, Variation, Vec3 } from "./types";

/** Orbit length before a point counts as non-escaping. The classic
 * Mandelbox quality/cost balance (published marchers run 15-50); the
 * preview tier halves it through the same depth-clamp plumbing the IFS
 * descent uses. */
export const ESCAPE_TIME_ITERATIONS = 30;

/** Orbit radius past which escape is certain for every eligible map and
 * the estimate is settled. The classic small bailout: larger radii buy
 * marginally smoother far fields for strictly more iterations. */
export const ESCAPE_TIME_RADIUS = 4;

/** March step fudge for the escape-time marchers (GLSL variant and WGSL
 * core alike): the scalar-derivative estimate is the field's standard
 * heuristic, not a certified lower bound — every published Mandelbox
 * marcher damps its steps; 0.7 is the common conservative pick. */
export const ESCAPE_STEP_SCALE = 0.7;

export type EscapeEligibilityStatus = "eligible" | "ineligible";

/** What {@link analyzeEscapeSystem} feeds the session gate. */
export interface EscapeEligibility {
  status: EscapeEligibilityStatus;
  /** Human-readable blockers; non-empty exactly when ineligible. */
  reasons: string[];
}

/** Everything the escape-time marcher needs — the GLSL uniform wire
 * format, mirroring {@link estimateEscapeDistance}. */
export interface EscapeDE {
  /** Row-major 3x3 FORWARD linear part M of the map. */
  m: number[];
  /** Forward translation t. */
  t: Vec3;
  /** The fold family applied after the affine part. */
  foldKind: SurfaceFoldKind;
  /** Signed fold weight w — the classic Mandelbox scale. */
  w: number;
  /** `|w| · sigma_max(M)` — the per-iteration derivative growth the local
   * fold factor multiplies onto. */
  derivGrowth: number;
  /** Marching bounds: the non-escaping set is contained in the bailout
   * ball, so the sphere tracer enters/exits against this radius. */
  boundingRadius: number;
}

/** `composeVariations`' active filter again (surface-de.ts keeps its own
 * copy private): the single active fold-family entry, or null. */
function pureFoldVariation(t: Transform): Variation | null {
  const active = (t.variations ?? []).filter(
    (v) => Number.isFinite(v.weight) && v.weight !== 0,
  );
  if (active.length !== 1) return null;
  const v = active[0];
  return v.type === "boxfold" ||
    v.type === "spherefold" ||
    v.type === "mandelbox"
    ? v
    : null;
}

/**
 * Classify a system for the escape-time render. Deliberately the
 * COMPLEMENT of the IFS gate on single pure-fold maps: a contractive map
 * has a genuine attractor and the sound inverse-descent estimator — this
 * mode exists for the canonical expanding parameterizations that gate
 * refuses.
 */
export function analyzeEscapeSystem(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = { order: 1, plane: "xz" },
): EscapeEligibility {
  const reasons: string[] = [];
  const active = transforms.filter((t) => (t.weight ?? 1) > 0);
  if (active.length !== 1) {
    reasons.push(
      active.length === 0
        ? "no active maps"
        : "more than one active map (escape-time sets are single-map)",
    );
  }
  const map = active[0];
  if (map) {
    const fold = pureFoldVariation(map);
    if (!fold) {
      reasons.push("the map is not a pure fold");
    } else if (!isFlatTransform(map)) {
      reasons.push("the map extends into 4D");
    } else {
      const s = transformSigmas(map);
      const lip =
        Math.abs(fold.weight) *
        (fold.type === "boxfold" ? 1 : SPHEREFOLD_LIPSCHITZ) *
        s.max;
      if (lip < CONTRACTION_LIMIT) {
        reasons.push(
          "the map contracts (the attractor surface render owns it)",
        );
      }
    }
  }
  if (finalTransform) {
    reasons.push("final transform (unsupported in escape-time mode)");
  }
  if (effectiveSymmetryOrder(symmetry.order, transforms.length) > 1) {
    reasons.push("kaleidoscope symmetry (unsupported in escape-time mode)");
  }
  return {
    status: reasons.length > 0 ? "ineligible" : "eligible",
    reasons,
  };
}

/**
 * Precompute the {@link EscapeDE} for an eligible system. Throws on an
 * ineligible one ({@link analyzeEscapeSystem}) — the app gates first, so
 * reaching the throw is a bug.
 */
export function buildEscapeDE(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = { order: 1, plane: "xz" },
): EscapeDE {
  const analysis = analyzeEscapeSystem(transforms, finalTransform, symmetry);
  if (analysis.status === "ineligible") {
    throw new Error(
      `system has no escape-time estimator: ${analysis.reasons.join("; ")}`,
    );
  }
  const map = transforms.filter((t) => (t.weight ?? 1) > 0)[0];
  const fold = pureFoldVariation(map)!;
  const affine = composeAffine(map);
  const s = transformSigmas(map);
  return {
    m: affine.m,
    t: affine.t,
    foldKind:
      fold.type === "boxfold"
        ? SURFACE_FOLD_BOXFOLD
        : fold.type === "spherefold"
          ? SURFACE_FOLD_SPHEREFOLD
          : SURFACE_FOLD_MANDELBOX,
    w: fold.weight,
    derivGrowth: Math.abs(fold.weight) * s.max,
    boundingRadius: ESCAPE_TIME_RADIUS,
  };
}

/** One axis of the box fold — variations.ts's `foldAxis`, duplicated here
 * for the same reason `variations4.ts` duplicates it: the estimator must
 * be dependency-light and bit-exact against the GLSL mirror. */
function foldAxis(t: number): number {
  return 2 * Math.max(-1, Math.min(1, t)) - t;
}

/**
 * The escape-time distance estimate (module doc) — the CPU oracle the
 * `SURFACE_ESCAPE` GLSL variant mirrors line for line. `maxIterations`
 * exists for the preview tier's depth clamp; callers wanting the full
 * estimate pass nothing.
 */
export function estimateEscapeDistance(
  de: EscapeDE,
  p: Vec3,
  maxIterations = ESCAPE_TIME_ITERATIONS,
): number {
  const m = de.m;
  let vx = p[0];
  let vy = p[1];
  let vz = p[2];
  let dr = 1;
  let r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  for (let i = 0; i < maxIterations && r <= ESCAPE_TIME_RADIUS; i++) {
    const yx = m[0] * vx + m[1] * vy + m[2] * vz + de.t[0];
    const yy = m[3] * vx + m[4] * vy + m[5] * vz + de.t[1];
    const yz = m[6] * vx + m[7] * vy + m[8] * vz + de.t[2];
    let fx: number;
    let fy: number;
    let fz: number;
    let localL: number;
    if (de.foldKind === SURFACE_FOLD_BOXFOLD) {
      fx = foldAxis(yx);
      fy = foldAxis(yy);
      fz = foldAxis(yz);
      localL = 1;
    } else if (de.foldKind === SURFACE_FOLD_SPHEREFOLD) {
      const r2 = yx * yx + yy * yy + yz * yz;
      const f = 1 / Math.max(0.25, Math.min(1, r2));
      fx = yx * f;
      fy = yy * f;
      fz = yz * f;
      localL = f;
    } else {
      const bx = foldAxis(yx);
      const by = foldAxis(yy);
      const bz = foldAxis(yz);
      const r2 = bx * bx + by * by + bz * bz;
      const f = 1 / Math.max(0.25, Math.min(1, r2));
      fx = bx * f;
      fy = by * f;
      fz = bz * f;
      localL = f;
    }
    vx = de.w * fx;
    vy = de.w * fy;
    vz = de.w * fz;
    dr = de.derivGrowth * localL * dr + 1;
    r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  }
  return r / dr;
}
