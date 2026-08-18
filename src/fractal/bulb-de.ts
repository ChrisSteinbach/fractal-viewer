/**
 * Mandelbulb render (fr-7u8t.7): the distance-estimated escape-time set of
 * the White/Nylander triplex 8th power — the third object in the
 * escape-time family, beside `escape-de.ts`'s folds and `qjulia-de.ts`'s
 * quaternion Julia, and the one people picture when they say "3D fractal".
 *
 * THE OBJECT. The vocabulary is unchanged — a transform carrying the `bulb`
 * variation (`variations.ts`'s `triplexPow8`) and nothing else. Iterated
 * with the query point re-added each step, that map's non-escaping set is
 * the Mandelbulb:
 *
 *     v <- V(M v + t) + p        V = the triplex 8th power, p = the query
 *
 * MANDELBROT, NOT JULIA, and that is a decision fr-7u8t.8 already paid for
 * one object over. Read `escape-de.ts`'s "TWO FORMS" and "WHY NOT BOTH
 * FORMS" paragraphs: the fold mode shipped the Julia form (offset fixed by
 * the document), measured it rendering a near-sphere at every constant a
 * user would author, and replaced it with the query-point offset. This
 * module starts where that ended. `t` keeps the role it kept there — the
 * PRE-power offset, a live deformation knob, with the textbook Mandelbulb
 * at exactly `t = 0` — so the mode adds NO document state.
 *
 * The Juliabulb was measured rather than argued away, exactly as the
 * Juliabox was, and it is the more interesting result of the two:
 * `scripts/bulb-preview.harness.ts` renders it from a local prototype and
 * sweeps its constant. Verdict there, not here.
 *
 * WHICH VECTOR THE ESTIMATE READS. Set `y_n = M v_n + t`, the point the
 * power is actually applied to. Then
 *
 *     y_0     = M p + t
 *     y_(n+1) = M V(y_n) + y_0
 *
 * — the offset in `y` space is `y_0` ITSELF, which is what makes this the
 * Mandelbrot form (in the Julia form it would be a document constant). At
 * `M = I, t = 0` the two orbits coincide (`y_n = v_n`) and this is the
 * textbook `z <- z⁸ + c` with `c = p`; at a general `M` they do not, and
 * the estimate is read off `|y|` — `qjulia-de.ts`'s lesson 3, which
 * survives the change of form because the `y` recursion above closes. (The
 * sibling that reads `|v|` instead, `escape-de.ts`, is internally
 * consistent the other way: its `dr` tracks `d v_n / d p`, so its `+ 1` is
 * literal. Mixing the two — `|v|` against a `dy/dp` derivative — silently
 * renders a different object, which is the trap that paragraph exists for.)
 *
 * THE ESTIMATE. The Böttcher/Green's-function form every published
 * Mandelbulb marcher uses, with the scalar running derivative
 * `escape-de.ts`'s recurrence already has the shape of:
 *
 *     y = M p + t;  dr = sigma_max(M)          // d y_0 / d p IS M, not I
 *     repeat until |y| > bailout or the budget runs out:
 *       dr = 8·|y|⁷·sigma_max(M)·dr + sigma_max(M)
 *       y  = M V(y) + y_0
 *     DE = 0.5 · |y| · ln|y| / dr
 *
 * Two terms carry more than their weight:
 *
 *   - The trailing `+ sigma_max(M)` is `escape-de.ts`'s `+ 1`, carried
 *     through `M`: it is the Mandelbrot offset's own derivative
 *     `d(+y_0)/dp = M`, exact rather than conservative, and equal to the
 *     literal `+ 1` at every rotation or identity map (the normal case).
 *     Factoring `sigma_max` out of the whole recurrence gives back
 *     `dr̂ = 8|y|⁷·sigma_max·dr̂ + 1` with a final `/sigma_max`, the same
 *     numbers — this is that `+ 1`, not a different idea.
 *   - It also FLOORS `dr` at `sigma_max`, and that matters far more here
 *     than for the folds. `8·|y|⁷` SHRINKS whenever `|y| < 1` — by 16x at
 *     `|y| = 0.5` — and most of the object's interior lives there, so
 *     without the floor a converging orbit drives `dr` to zero and returns
 *     a distance vastly larger than the query's own radius: a marcher that
 *     steps clean past the surface. With it, `DE <= 0.5·|y|·ln|y| /
 *     sigma_max` always.
 *
 * A HEURISTIC AGAIN, unlike `qjulia-de.ts`. The quaternion square is
 * norm-multiplicative, so its `2|q|` factor is the exact derivative norm
 * and the estimate is the certified Böttcher form. The triplex power is
 * not that: in the orthonormal spherical frame it stretches by `8r⁷`
 * radially and in the polar direction, but by `8r⁷·|U₇(cos θ)|` in the
 * AZIMUTHAL one (`U₇` is the Chebyshev polynomial `sin 8θ / sin θ`), which
 * reaches `8x` that at the poles. So `8r⁷` under-estimates the true
 * Lipschitz constant near the z axis, `dr` under-estimates the derivative
 * there, and the estimate can overshoot — the fold family's problem, back
 * again, for a reason specific to this map. Pricing the bound at its true
 * `64r⁷` maximum would make every step 8x shorter everywhere to fix a
 * defect confined to two poles; damping the marcher is the field's answer
 * and the one measured below.
 *
 * MEASURED VERDICT (2026-08-14, f64 CPU, single thread; the numbers are
 * `scripts/bulb-preview.harness.ts`'s, and `bulb-de.test.ts` keeps the
 * claims honest):
 *   - 0.29 us/eval at 8.9 orbit iterations average over 200k uniform
 *     queries in its own marching ball, against 1.04 us/eval for the
 *     shipped mandelbox fold and 0.22 for the quaternion square on the same
 *     set. The bead expected this to be the EXPENSIVE object (its
 *     trig prototype measured ~2 us/eval, "so a trig-free triplex
 *     formulation is worth measuring"); it is the middle one, and 3.5x
 *     cheaper than the fold mode that already ships.
 *   - TRIG-FREE, and the choice was not close. `triplexPow8`'s
 *     Chebyshev/de-Moivre form is an EXACT algebraic rewrite of the
 *     `acos`/`atan2`/`sin`/`cos`/`pow` one — 6e-14 worst relative
 *     difference on the raw power over 200k queries, i.e. f64 rounding —
 *     and the whole estimator runs ~11x cheaper with it. (Through the
 *     orbit the two estimates diverge to 2e-8 relative in the worst case;
 *     that is the chaos below, not an error in either.) The OTHER
 *     trig-free candidate, three triplex SQUARINGS, is a different map
 *     rather than an optimisation: it disagrees with the power on 48.8% of
 *     queries, because triplex multiplication is not associative and
 *     squaring re-canonicalises the polar angle every step.
 *   - STEP SCALE 1.0, measured rather than assumed — and the bead's
 *     prediction that "the step-scale damping comes back" did not hold.
 *     Swept 1.0/0.9/0.8/0.7/0.6/0.5 against a 400-iteration membership
 *     oracle, 24 probe directions per query, 2.4k-3.3k probed queries on
 *     each of four systems: 0.06-0.66% overshoot at 1.0, and damping does
 *     NOT clear it (0.04-0.21% at 0.5) — the residual is the boundary
 *     shell, not the step length. At FRAME level the full step loses no
 *     geometry: 46.7% hits against a 0.2-step reference's 46.8% on the
 *     classic fixture, with 2.2% of pixels differing by more than 12/255
 *     (crease shading). Re-run at a CLOSE pose, where creases and filigree
 *     rather than a silhouette are what the marcher must resolve — the pose
 *     fr-7u8t.8's own sweep found the fold's overshoot at — the six panels
 *     from 1.0 down to 0.2 are indistinguishable and hits move 89.52% ->
 *     89.53%, about two pixels in 176k
 *     (`scripts/out/bulb-step-scale.png`). For scale, the fold family on
 *     its own object still loses 4.6% of its hits and differs on 12.1% at
 *     the 0.35 fr-7u8t.8 measured it down to — and lost 17% at the 0.7 it
 *     shipped with before that, climbing 62% -> 84% of its hits as the
 *     damping fell, which is what a step scale that is actually binding
 *     looks like. Nothing here climbs: 0.7 would buy 2.4x fewer differing
 *     pixels for 1.45x the steps, if fr-7u8t.9's real tracer ever wants it.
 *
 * ONE WARNING FOR THE MIRRORS (fr-7u8t.9), learned by fr-dlxh one object
 * over and re-measured here: a forward power-8 orbit multiplies any
 * perturbation by `8r⁷` per step, so two implementations of the SAME map
 * disagree about membership in a thin shell around the boundary — measured
 * at 0.22% of the marching ball between this module's polynomial power and
 * the trigonometric reference, both f64. A GPU agreement leg comparing f32
 * against this oracle will see that shell as "failures" and it is chaos,
 * not divergence; `forwardQueryStable`'s ensemble classifier and
 * `forwardShadowFlipVerified` (`src/app/gpu-bench/`) are the shape of the
 * answer. The step-scale sweep above had to exclude the same shell to
 * measure anything at all (7-28 queries per system, disclosed per row).
 *
 * ELIGIBILITY is a sibling of `analyzeEscapeSystem` and
 * `analyzeQJuliaSystem`, not an extension of either: exactly one active map
 * whose single active variation is `bulb` at weight 1, non-singular, FLAT,
 * no final transform, no kaleidoscope. The flatness clause is the one place
 * this gate differs from the quaternion one, and it is the same clause the
 * fold gate carries: the quaternions are natively 4D, so a `w` extension
 * there is how the Julia constant gets its `k` component, but triplex
 * numbers are R³ with a spherical-coordinate product and have no fourth
 * component to give meaning to (`variations4.ts`'s `bulb` carries `w`
 * through untouched, which is honest for the chaos game and useless to an
 * estimator). Like both siblings there is no "must not contract" clause:
 * `analyzeSurfaceSystem` refuses every map with a non-fold variation
 * ("map N uses variations"), so the IFS complement is automatic.
 */
import { composeAffine } from "./affine";
import { isFlatTransform } from "./affine4";
import { effectiveSymmetryOrder } from "./chaos-game";
import { transformSigmas } from "./surface-de";
import type { SymmetryParams, Transform, Variation, Vec3 } from "./types";

/**
 * The triplex power the `bulb` variation raises to — 8, the iconic one.
 * Deliberately a CONSTANT and not a document field: every power needs its
 * own closed form (triplex multiplication is not associative, so there is no
 * repeated-squaring ladder to parameterise), which would mean a branch in
 * six shader mirrors and a persisted knob whose interesting values are all
 * near 8 anyway. `scripts/bulb-preview.harness.ts` renders the neighbours
 * from a local prototype, which is the evidence a later bead would need to
 * overturn this.
 */
export const BULB_POWER = 8;

/**
 * Orbit length before a point counts as non-escaping. `r⁸` leaves the
 * bailout ball almost immediately once it is outside the set — the measured
 * average is well under three iterations — so this is a tail budget for the
 * thin structure near the boundary, not a typical cost, and the preview
 * tier halves it through the same depth-clamp door the fold descents use.
 */
export const BULB_ITERATIONS = 16;

/**
 * Floor on the escape radius. The per-system bailout is
 * `max(this, escapeRadius(de))`: the analytic radius sits near 1.1 for the
 * classic map, where `ln|y|` has barely turned positive and the Böttcher
 * approximation is at its worst, so the orbit is run out to a comfortable
 * distance instead. 4 is the classic small bailout, matching
 * `escape-de.ts`'s `ESCAPE_TIME_RADIUS` and `qjulia-de.ts`'s
 * `QJULIA_BAILOUT_FLOOR`; at power 8 it costs at most two extra iterations
 * (a radius past 1.1 reaches 440 in two steps).
 */
export const BULB_BAILOUT_FLOOR = 4;

/**
 * March step fudge — the ONE definition the GLSL/WGSL mirrors import rather
 * than inlining a literal, exactly as `escape-de.ts`'s `ESCAPE_STEP_SCALE`
 * and `qjulia-de.ts`'s `QJULIA_STEP_SCALE` are.
 *
 * 1.0, and unlike `qjulia-de.ts`'s 1.0 this is an empirical result rather
 * than a consequence of conformality: the estimate IS a heuristic here
 * (module doc), it does overshoot on a fraction of a percent of queries,
 * and damping to 0.5 does not clear that residual because it lives in the
 * boundary shell rather than in the step length. What decided it is the
 * frame-level measurement in the module doc's verdict — at 1.0 the marcher
 * loses no geometry against a 0.2-step reference, where the fold family
 * still loses 4.6% of its hits at the 0.35 it was measured down to (and
 * 17% at its old 0.7). Damping this marcher would pay 1.45x the steps for
 * sharper creases, not for correctness.
 */
export const BULB_STEP_SCALE = 1;

export type BulbEligibilityStatus = "eligible" | "ineligible";

/** What {@link analyzeBulbSystem} feeds the session gate. */
export interface BulbEligibility {
  status: BulbEligibilityStatus;
  /** Human-readable blockers; non-empty exactly when ineligible. */
  reasons: string[];
}

/** Everything the Mandelbulb marcher needs — the uniform/params wire
 * format, mirroring {@link estimateBulbDistance}. */
export interface BulbDE {
  /** Row-major 3x3 FORWARD linear part `M` of the map. */
  m: number[];
  /** Forward translation `t` — the PRE-power offset (module doc), not a
   * Julia constant: the textbook Mandelbulb is `t = 0`. */
  t: Vec3;
  /** `sigma_max(M)`, which rides the derivative recurrence twice — as the
   * per-iteration growth and as the Mandelbrot offset's own derivative.
   * `1` for a rotation, the scale for a uniform scale. */
  sigmaMax: number;
  /** Orbit radius past which escape is certain (module doc; a bound on
   * `|y|`, not on the rendered set). */
  bailout: number;
  /** Marching bound in QUERY space: the non-escaping set is contained in
   * this ball about the origin, so the sphere tracer enters and exits
   * against it. */
  boundingRadius: number;
}

/** `composeVariations`' active filter again (the twin of `escape-de.ts`'s
 * `pureFoldVariation`): the single active `bulb` entry, or null. */
function pureBulbVariation(t: Transform): Variation | null {
  const active = (t.variations ?? []).filter(
    (v) => Number.isFinite(v.weight) && v.weight !== 0,
  );
  if (active.length !== 1) return null;
  return active[0].type === "bulb" ? active[0] : null;
}

/**
 * Classify a system for the Mandelbulb render (module doc). A sibling of
 * `analyzeEscapeSystem`/`analyzeQJuliaSystem`, carrying the fold gate's
 * flatness clause and the quaternion gate's weight clause.
 */
export function analyzeBulbSystem(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = { order: 1, plane: "xz" },
): BulbEligibility {
  const reasons: string[] = [];
  const active = transforms.filter((t) => (t.weight ?? 1) > 0);
  if (active.length !== 1) {
    reasons.push(
      active.length === 0
        ? "no active maps"
        : "more than one active map (Mandelbulb sets are single-map)",
    );
  }
  const map = active[0];
  if (map) {
    const bulb = pureBulbVariation(map);
    if (!bulb) {
      reasons.push("the map is not a pure triplex power");
    } else if (bulb.weight !== 1) {
      // A weight other than 1 iterates `w·V(Mv + t) + p`, which is a
      // different object, not a rescaling of this one: the offset `+ p` does
      // not absorb `w`, so no change of variable undoes it. Rather than
      // silently render a set the estimate was not derived for, refuse — the
      // scale the user wants lives in the transform's own scale, where
      // `sigmaMax` accounts for it exactly.
      reasons.push(
        "the triplex power's weight must be 1 (scale the map instead)",
      );
    } else if (!isFlatTransform(map)) {
      reasons.push("the map extends into 4D (the Mandelbulb is a 3D object)");
    } else if (transformSigmas(map).min <= 0) {
      // A singular M collapses the orbit onto a subspace, where the escape
      // radius below has no solution and the bounding ball is unbounded.
      reasons.push("the map is singular (zero scale on some axis)");
    }
  }
  if (finalTransform) {
    reasons.push("final transform (unsupported in Mandelbulb mode)");
  }
  if (effectiveSymmetryOrder(symmetry.order, transforms.length) > 1) {
    reasons.push("kaleidoscope symmetry (unsupported in Mandelbulb mode)");
  }
  return { status: reasons.length > 0 ? "ineligible" : "eligible", reasons };
}

/**
 * The `|y|` past which escape is certain. `|M V(y) + y_0| >=
 * sigma_min·|y|^n - |y_0|`, and once `|y| >= |y_0|` that exceeds `|y|`
 * as soon as `sigma_min·|y|^(n-1) > 2`; the radius below is that crossing.
 * At `M = I` it is the textbook `2^(1/(n-1))` — 1.104 at power 8, which is
 * why every published Mandelbulb render fits inside a radius-1.2 ball.
 */
function escapeRadius(sigmaMin: number): number {
  return Math.pow(2 / sigmaMin, 1 / (BULB_POWER - 1));
}

/**
 * Precompute the {@link BulbDE} for an eligible system. Throws on an
 * ineligible one ({@link analyzeBulbSystem}) — the app gates first, so
 * reaching the throw is a bug.
 */
export function buildBulbDE(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = { order: 1, plane: "xz" },
): BulbDE {
  const analysis = analyzeBulbSystem(transforms, finalTransform, symmetry);
  if (analysis.status === "ineligible") {
    throw new Error(
      `system has no Mandelbulb estimator: ${analysis.reasons.join("; ")}`,
    );
  }
  const map = transforms.filter((t) => (t.weight ?? 1) > 0)[0];
  const affine = composeAffine(map);
  const sigmas = transformSigmas(map);
  const escR = escapeRadius(sigmas.min);
  const tLen = Math.hypot(...affine.t);
  return {
    m: affine.m,
    t: affine.t,
    sigmaMax: sigmas.max,
    bailout: Math.max(BULB_BAILOUT_FLOOR, escR),
    // Query space: `y_0 = M p + t` must stay inside the ESCAPE radius (not
    // the bailout — a bailout raised for the estimate's sake would inflate
    // the marching ball for nothing), so `sigma_min·|p| - |t| <= escR`.
    boundingRadius: (escR + tLen) / sigmas.min,
  };
}

/**
 * The Mandelbulb distance estimate (module doc) — the f64 oracle the GLSL
 * variant and WGSL core will mirror line for line (fr-7u8t.9).
 * `maxIterations` exists for the preview tier's depth clamp, through the
 * same door the fold descents use; callers wanting the full estimate pass
 * nothing.
 */
export function estimateBulbDistance(
  de: BulbDE,
  p: Vec3,
  maxIterations = BULB_ITERATIONS,
): number {
  const m = de.m;
  // y_0 = M p + t — the point the power is applied to, and (module doc) the
  // Mandelbrot form's per-iteration offset in y space.
  const cx = m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + de.t[0];
  const cy = m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + de.t[1];
  const cz = m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + de.t[2];
  let yx = cx;
  let yy = cy;
  let yz = cz;
  // dr bounds |d y_n / d p|, so it starts at |M| rather than 1.
  let dr = de.sigmaMax;
  let r2 = yx * yx + yy * yy + yz * yz;
  let r = Math.sqrt(r2);
  for (let i = 0; i < maxIterations && r <= de.bailout; i++) {
    // 8·r⁷ is the triplex power's radial/polar stretch — the field's
    // heuristic factor, not a Lipschitz bound (module doc) — then M's
    // operator norm, then the offset's own derivative.
    dr = BULB_POWER * (r2 * r2 * r2 * r) * de.sigmaMax * dr + de.sigmaMax;
    // `variations.ts`'s triplexPow8, INLINED — duplicated for the reason
    // `escape-de.ts` duplicates `foldAxis`: this estimator is the oracle a
    // GLSL/WGSL mirror is written against, so it stays allocation-free and
    // term-for-term. `bulb-de.test.ts` pins the two BIT-exactly.
    const a = yx * yx + yy * yy;
    const z2 = yz * yz;
    const r4 = r2 * r2;
    const vz =
      128 * z2 * z2 * z2 * z2 -
      256 * z2 * z2 * z2 * r2 +
      160 * z2 * z2 * r4 -
      32 * z2 * r4 * r2 +
      r4 * r4;
    const s =
      128 * z2 * z2 * z2 * yz -
      192 * z2 * z2 * yz * r2 +
      80 * z2 * yz * r4 -
      8 * yz * r4 * r2;
    const rho = Math.sqrt(a);
    const inv = rho > 0 ? 1 / rho : 0;
    const u1 = yx * inv;
    const v1 = yy * inv;
    const u2 = u1 * u1 - v1 * v1;
    const v2 = 2 * u1 * v1;
    const u4 = u2 * u2 - v2 * v2;
    const v4 = 2 * u2 * v2;
    const u8 = u4 * u4 - v4 * v4;
    const v8 = 2 * u4 * v4;
    const vx = rho * s * u8;
    const vy = rho * s * v8;
    yx = m[0] * vx + m[1] * vy + m[2] * vz + cx;
    yy = m[3] * vx + m[4] * vy + m[5] * vz + cy;
    yz = m[6] * vx + m[7] * vy + m[8] * vz + cz;
    r2 = yx * yx + yy * yy + yz * yz;
    r = Math.sqrt(r2);
  }
  // `ln|y|` goes NEGATIVE below |y| = 1, which a converging orbit reaches —
  // and a negative estimate would march the tracer backwards. Clamping the
  // logarithm's argument at 1 returns exactly 0 there, which is the inside
  // signal and is safe in the direction a sphere tracer needs (0 is always
  // an under-estimate of the true distance). `qjulia-de.ts` takes the same
  // exit for the same reason; here it fires far more often, because `8r⁷`
  // pulls a non-escaping orbit hard toward the origin.
  return r <= 1 ? 0 : (0.5 * r * Math.log(r)) / dr;
}
