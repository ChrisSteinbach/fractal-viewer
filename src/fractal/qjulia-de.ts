/**
 * Quaternion Julia render (fr-7u8t): the distance-estimated escape-time set
 * of `q <- q² + c` in the quaternions — the original 3D fractal DE result
 * (Hart/Sandin/Kauffman, SIGGRAPH 1989) — for exactly the systems whose one
 * map is a pure quaternion square.
 *
 * THE OBJECT. `escape-de.ts` renders the escape-time set of a single FOLD
 * map. This module renders the other canonical escape-time object, and the
 * one the site is named after: a genuinely 4D set, of which a 3D render is
 * a SLICE. The vocabulary is unchanged — a transform carrying the `qsquare`
 * variation (`variations4.ts`) and nothing else iterates
 *
 *     F(v) = V(M v + t) = (M v + t)²
 *
 * and when `M` is the identity that is `v <- (v + t)²`, which is CONJUGATE
 * BY TRANSLATION to the classic Julia form `q <- q² + c` with `c = t`:
 * writing `psi(q) = q + c`, `psi . F . psi⁻¹ (q) = q² + c`. So the authored
 * transform's TRANSLATION is the Julia constant, the rendered set is the
 * classic set translated by `-c`, and no second document format is needed —
 * the fr-kltj scoping decision one object over.
 *
 * That conjugacy is not decoration; it is what the estimator iterates. Set
 * `y_n = M v_n + t` (the point actually being squared). Then
 *
 *     y_0     = M p + t
 *     y_(n+1) = M y_n² + t
 *
 * and at `M = I` the `y` orbit IS the classic orbit of `q² + c`, started at
 * `psi(p)`. The estimate is read off `|y|`, never `|v|`; reading `|v|`
 * silently shifts the object by `c` and degrades the bound.
 *
 * THE ESTIMATE. The Böttcher/Green's-function distance estimate every
 * published quaternion Julia marcher uses:
 *
 *     dr = sigma_max(M)                          // d y_0 / d p
 *     repeat until |y| > bailout or the budget runs out:
 *       dr = 2·|y|·sigma_max(M)·dr
 *       y  = M y² + t
 *     DE = 0.5 · |y| · ln|y| / dr
 *
 * `dr` is a bound on `|d y_n / d p|`, and the `2·|y|` factor is EXACT rather
 * than a Lipschitz over-estimate: quaternion multiplication is
 * norm-multiplicative, so `q <- q²` has `|dq'| = 2|q|·|dq|` identically.
 * This is the substantive difference from `escape-de.ts`, whose `dr`
 * deliberately over-estimates because folds are not conformal. When `M` is a
 * SIMILARITY (`sigma_min = sigma_max` — a rotation, a uniform scale, or
 * both, which is what the transform editor produces unless shear or
 * per-axis scale is touched) the scalar `dr` is the exact derivative norm
 * and this is the field's certified-form estimate; otherwise `sigma_max`
 * makes it an over-estimate in the same conservative direction the folds
 * take, and {@link QJuliaDE.conformal} records which case a build landed in.
 *
 * WHAT THE TRANSFORM'S OTHER SLIDERS DO, and why `scale` is not an
 * independent knob. For a similarity `M = s·R`, substituting `u = s·y` turns
 * `y <- s·R·y² + t` into `u <- (R u)² + s·t` — so a uniform scale is
 * CONJUGATE to leaving the scale at 1 and moving the Julia constant to
 * `s·c`, with the rendered set shrunk by `1/s`. That is not a defect (the
 * estimator is exact either way, and `sigma_max` accounts for it), but it
 * has two consequences worth knowing before wiring UI:
 *   - Dragging `scale` walks `c` through parameter space, so it can carry a
 *     connected set out of the connectedness locus and collapse it to a dust
 *     with empty interior. At `c = (-0.2, 0.6, 0.2)`, scale 1.3 already
 *     does (measured: 0 interior samples in 4000). This is correct
 *     behaviour, but it will look like the render breaking.
 *   - Rotation is the genuinely independent knob: `R` does not commute with
 *     squaring, so `u <- (R u)² + c` is a real second family rather than a
 *     reparameterization, and it keeps `sigma = 1` and the estimate exact.
 *
 * MEASURED VERDICT (2026-08-13, f64 CPU, single thread):
 *   - 0.059 us/eval at 2.7 orbit iterations average over 400k uniform
 *     queries, against 0.633 us/eval for the shipped mandelbox fold on the
 *     same query set — 10.7x cheaper per eval.
 *   - Step scale 1.0 is SOUND. Swept 1.0/0.9/0.8/0.7/0.6/0.5 against a
 *     200-iteration membership oracle, 24 probe directions per query, ~5400
 *     queries each, at three values of c including one with a real fourth
 *     component: 0.00% overshoot at every scale, 1.0 included. The fold
 *     path's damping (`escape-de.ts`'s `ESCAPE_STEP_SCALE`, measured down
 *     to 0.35 by fr-7u8t.8) is not needed here,
 *     which is the conformality above showing up in the marcher.
 * Together that is roughly 15x cheaper per ray than the escape-time fold
 * mode. `qjulia-de.test.ts` keeps both claims honest.
 *
 * ELIGIBILITY is a sibling of `analyzeEscapeSystem`, not an extension of it:
 * exactly one active map whose single active variation is `qsquare`, no
 * final transform, no kaleidoscope. Note what is deliberately ABSENT — the
 * fold gate's "must not contract" clause. That clause exists because a
 * contracting fold has a genuine IFS attractor and a sound inverse-descent
 * estimator that should own it; a squaring map has no tractable inverse
 * branch structure in this vocabulary, so `analyzeSurfaceSystem` refuses it
 * at every parameter and the complement is automatic. There is likewise no
 * flatness clause: the quaternions are natively 4D, and a `w` extension on
 * the map is exactly how the Julia constant acquires its `k` component.
 */
import { composeAffine4, toTransform4 } from "./affine4";
import { effectiveSymmetryOrder } from "./chaos-game";
import { transformSigmas4 } from "./surface-de-4d";
import type { SymmetryParams, Transform, Variation, Vec4 } from "./types";

/**
 * Orbit length before a point counts as non-escaping. The quaternion square
 * escapes far faster than a fold orbit wanders — the measured average is
 * 2.7 iterations over a uniform query set — so this is a tail budget, not a
 * typical cost, and it buys the thin filaments where the orbit lingers.
 */
export const QJULIA_ITERATIONS = 30;

/**
 * Floor on the escape radius. The per-system bailout is
 * `max(this, escapeRadius(de))` — the analytic radius alone can fall below
 * 1 for a small constant, where `ln|y|` goes negative and the estimate
 * loses meaning, and the Böttcher approximation behind
 * {@link estimateQJuliaDistance} sharpens with distance. 4 is the classic
 * small bailout, matching `escape-de.ts`'s `ESCAPE_TIME_RADIUS`.
 */
export const QJULIA_BAILOUT_FLOOR = 4;

/**
 * March step fudge. UNLIKE the fold marchers' heavy damping
 * (`escape-de.ts`'s `ESCAPE_STEP_SCALE`), this is 1.0: the estimate is the
 * conformal Böttcher form rather than a Lipschitz heuristic, and the module
 * doc's step-scale sweep measured 0.00% overshoot at full step length
 * across three values of `c`. Exported as a named constant anyway so that
 * IF a mirror is ever written it imports the one definition rather than
 * inlining a literal, as the fold path does. NONE EXISTS: fr-7u8t.5 is
 * closed won't-do — see the module doc's standing note.
 */
export const QJULIA_STEP_SCALE = 1;

export type QJuliaEligibilityStatus = "eligible" | "ineligible";

/** What {@link analyzeQJuliaSystem} feeds the session gate. */
export interface QJuliaEligibility {
  status: QJuliaEligibilityStatus;
  /** Human-readable blockers; non-empty exactly when ineligible. */
  reasons: string[];
}

/** Everything a quaternion Julia marcher WOULD need — the uniform/params
 * wire format, mirroring {@link estimateQJuliaDistance}. No marcher reads
 * it, and none is planned (fr-7u8t.5, closed won't-do); the shape is here
 * because it is the wire the measurement was taken through. */
export interface QJuliaDE {
  /** Row-major 4x4 FORWARD linear part `M` of the map. */
  m: number[];
  /** Forward translation `t` — the Julia constant `c` (module doc). */
  t: Vec4;
  /** `sigma_max(M)`, the per-iteration derivative growth the exact `2|y|`
   * factor multiplies onto. `1` for a rotation, the scale for a uniform
   * scale. */
  sigmaMax: number;
  /**
   * Whether `M` is a similarity (`sigma_min === sigma_max`), in which case
   * {@link estimateQJuliaDistance}'s scalar `dr` is the EXACT derivative
   * norm rather than an upper bound. True for every system the transform
   * editor produces without shear or per-axis scale, so it is the normal
   * case, not a special one. Consumers may use it to justify the 1.0 step
   * scale; a false here is not an error, just a looser bound.
   */
  conformal: boolean;
  /** Orbit radius past which escape is certain (module doc; the `|y|`
   * radius, not a bound on the rendered set). */
  bailout: number;
  /** Marching bound in QUERY space: the non-escaping set is contained in
   * this ball about the origin, so the sphere tracer enters and exits
   * against it. */
  boundingRadius: number;
}

/** `composeVariations`' active filter again (the twin of `escape-de.ts`'s
 * `pureFoldVariation`): the single active `qsquare` entry, or null. */
function pureQSquareVariation(t: Transform): Variation | null {
  const active = (t.variations ?? []).filter(
    (v) => Number.isFinite(v.weight) && v.weight !== 0,
  );
  if (active.length !== 1) return null;
  return active[0].type === "qsquare" ? active[0] : null;
}

/**
 * Classify a system for the quaternion Julia render (module doc). A sibling
 * of `analyzeEscapeSystem`, deliberately without its contraction clause.
 */
export function analyzeQJuliaSystem(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = { order: 1, plane: "xz" },
): QJuliaEligibility {
  const reasons: string[] = [];
  const active = transforms.filter((t) => (t.weight ?? 1) > 0);
  if (active.length !== 1) {
    reasons.push(
      active.length === 0
        ? "no active maps"
        : "more than one active map (quaternion Julia sets are single-map)",
    );
  }
  const map = active[0];
  if (map) {
    const q = pureQSquareVariation(map);
    if (!q) {
      reasons.push("the map is not a pure quaternion square");
    } else if (q.weight !== 1) {
      // A weight other than 1 makes the map `w·(Mv + t)²`, which is the
      // same object under the change of variable `v -> v/w` only when the
      // affine part absorbs it — not in general. Rather than silently
      // render a different set than the one the estimate is derived for,
      // refuse: the scale the user wants lives in the transform's own
      // scale, where `sigmaMax` accounts for it exactly.
      reasons.push(
        "the quaternion square's weight must be 1 (scale the map instead)",
      );
    } else if (transformSigmas4(toTransform4(map)).min <= 0) {
      // A singular M collapses the orbit onto a subspace, where the escape
      // radius below has no solution and the bounding ball is unbounded.
      reasons.push("the map is singular (zero scale on some axis)");
    }
  }
  if (finalTransform) {
    reasons.push("final transform (unsupported in quaternion Julia mode)");
  }
  if (effectiveSymmetryOrder(symmetry.order, transforms.length) > 1) {
    reasons.push(
      "kaleidoscope symmetry (unsupported in quaternion Julia mode)",
    );
  }
  return { status: reasons.length > 0 ? "ineligible" : "eligible", reasons };
}

/**
 * The `|y|` past which escape is certain. `|M y² + t| >= sigma_min·|y|² -
 * |t|`, which exceeds `|y|` once `sigma_min·|y|² - |y| - |t| > 0`; the
 * positive root of that quadratic is the radius below. At `M = I` it is the
 * textbook `(1 + sqrt(1 + 4|c|)) / 2`.
 */
function escapeRadius(sigmaMin: number, tLen: number): number {
  return (1 + Math.sqrt(1 + 4 * sigmaMin * tLen)) / (2 * sigmaMin);
}

/**
 * Precompute the {@link QJuliaDE} for an eligible system. Throws on an
 * ineligible one ({@link analyzeQJuliaSystem}) — the contract the fold and
 * bulb builders keep, where the app gates first and reaching the throw is
 * a bug. There is no app caller (fr-7u8t.5, closed won't-do), so the throw
 * is the only gate; the harnesses call {@link analyzeQJuliaSystem} first
 * exactly as a routing arm would.
 */
export function buildQJuliaDE(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = { order: 1, plane: "xz" },
): QJuliaDE {
  const analysis = analyzeQJuliaSystem(transforms, finalTransform, symmetry);
  if (analysis.status === "ineligible") {
    throw new Error(
      `system has no quaternion Julia estimator: ${analysis.reasons.join("; ")}`,
    );
  }
  const map = transforms.filter((t) => (t.weight ?? 1) > 0)[0];
  const lifted = toTransform4(map);
  const affine = composeAffine4(lifted);
  const sigmas = transformSigmas4(lifted);
  const tLen = Math.hypot(...affine.t);
  const bailout = Math.max(
    QJULIA_BAILOUT_FLOOR,
    escapeRadius(sigmas.min, tLen),
  );
  return {
    m: affine.m,
    t: affine.t,
    sigmaMax: sigmas.max,
    conformal: sigmas.min === sigmas.max,
    bailout,
    // Query space: `y_0 = M p + t` must stay inside the escape radius for
    // `p` to belong to the set, so `sigma_min·|p| - |t| <= bailout`.
    boundingRadius: (bailout + tLen) / sigmas.min,
  };
}

/**
 * The quaternion Julia distance estimate (module doc) — the f64 oracle a
 * GLSL variant and WGSL core WOULD mirror line for line, under the
 * `flame-gpu.ts` discipline the rest of this family follows. Neither
 * exists, and neither will: fr-7u8t.5 is closed won't-do, refused by
 * measurement (module doc). What DOES consume this module is fr-j231,
 * which takes the exact `2|q|` derivative below for a chain LINK.
 * `maxIterations` exists
 * for the preview tier's depth clamp, through the same door the fold
 * descents use; callers wanting the full estimate pass nothing.
 */
export function estimateQJuliaDistance(
  de: QJuliaDE,
  p: Vec4,
  maxIterations = QJULIA_ITERATIONS,
): number {
  const m = de.m;
  const t = de.t;
  // y_0 = M p + t — the point the square is applied to, and the orbit the
  // estimate is read off (module doc).
  let yx = m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3] * p[3] + t[0];
  let yy = m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7] * p[3] + t[1];
  let yz = m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11] * p[3] + t[2];
  let yw = m[12] * p[0] + m[13] * p[1] + m[14] * p[2] + m[15] * p[3] + t[3];
  // dr bounds |d y_n / d p|, so it starts at |M| rather than 1.
  let dr = de.sigmaMax;
  let r = Math.sqrt(yx * yx + yy * yy + yz * yz + yw * yw);
  for (let i = 0; i < maxIterations && r <= de.bailout; i++) {
    // |d(y²)| = 2|y|·|dy| EXACTLY (quaternion norms multiply), then the
    // affine part contributes its operator norm.
    dr = 2 * r * de.sigmaMax * dr;
    // q² for q = yx + yy·i + yz·j + yw·k, real part first: writing q = a + v
    // with v the vector part, q² = a² - |v|² + 2a·v (the v x v term drops).
    const sx = yx * yx - (yy * yy + yz * yz + yw * yw);
    const sy = 2 * yx * yy;
    const sz = 2 * yx * yz;
    const sw = 2 * yx * yw;
    yx = m[0] * sx + m[1] * sy + m[2] * sz + m[3] * sw + t[0];
    yy = m[4] * sx + m[5] * sy + m[6] * sz + m[7] * sw + t[1];
    yz = m[8] * sx + m[9] * sy + m[10] * sz + m[11] * sw + t[2];
    yw = m[12] * sx + m[13] * sy + m[14] * sz + m[15] * sw + t[3];
    r = Math.sqrt(yx * yx + yy * yy + yz * yz + yw * yw);
  }
  // `ln|y|` goes NEGATIVE below |y| = 1, which a converging orbit reaches —
  // and a negative estimate would march the tracer backwards. Clamping the
  // logarithm's argument at 1 returns exactly 0 there, which is the inside
  // signal and is safe in the direction a sphere tracer needs (0 is always
  // an under-estimate of the true distance).
  return r <= 1 ? 0 : (0.5 * r * Math.log(r)) / dr;
}
