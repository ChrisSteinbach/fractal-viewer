/**
 * Should the escape-time FOLDS read their distance through the
 * Böttcher/Green's log form instead of the linear one they ship?
 *
 * THE ESTIMATE FORM, not the orbit form — `escape-form-sweep.harness.ts` is
 * the sibling that settles the other one, and the two forks are worth
 * keeping apart by name because they are worth keeping apart in the head.
 * That sheet chose which OBJECT the mode renders (the Mandelbrot `+ p`
 * against the retired Julia `+ t`). This one holds the orbit
 * fixed — same links, same cycle, same bailout, same SET — and forks only
 * the RETURN STATEMENT:
 *
 *     linear   DE = |v| / dr                     escape-de.ts ships this
 *     log-v    DE = 0.5·|v|·ln|v| / dr           bulb-de.ts / qjulia-de.ts's
 *     log-y    DE = 0.5·|y|·ln|y| / (sigma·dr)   the same, read in y space
 *
 * ======================= VERDICT: KEEP THE LINEAR FORM =======================
 *
 * The proposal is right that the log form beats the shipped one on every
 * system tested. It is right for a reason that makes the change not worth
 * having:
 * ON THIS FAMILY THE LOG FORM IS THE LINEAR FORM TIMES A CONSTANT, and the
 * constant is a knob the mode already exposes.
 *
 * THE MECHANISM. Both arms read the SAME terminal radius off the SAME orbit
 * through the SAME `dr`, so their ratio is exactly `0.5·ln r` — a number
 * that depends on nothing but where the orbit stopped. And the orbit stops
 * at the bailout: an escaping fold orbit leaves a radius-4 ball and lands
 * just outside it, so `0.5·ln r` is pinned just above `0.5·ln 4 = 0.693`.
 * Measured over 3.4-4.0k exterior queries per fixture, the factor's
 * [p05 p50 p95] runs [0.698 0.744 0.841] to [0.706 0.819 0.992] across all
 * seven — a 0.7-0.8x damping, everywhere, on every fixture.
 *
 * The `ln r` clamp `bulb-de.ts` needs is therefore dead code here: `zero%`
 * (the log form certifying nothing) is 0.00% on every fixture. It would
 * still have to be written into six mirrors, because a fold system CAN be
 * authored whose orbit converges inward.
 *
 * THE CONTROL the incidental measurement lacked is `linear x k` —
 * the shipped estimate scaled by that same median factor, a change to one
 * constant. It reproduces the log form's entire result. Hits at the shipped
 * step scale, `linear / linear x k / log-v`, with steps/ray:
 *
 *     mandelboxClassic  31.02@7.1   32.10@8.7   32.32@8.6    log-ctl +0.21
 *     mandelboxRings    33.92@10.7  35.87@12.4  36.32@12.1             +0.45
 *     mandelboxCube     25.08@4.6   25.13@5.9   25.13@6.0              +0.00
 *     foldChain         38.07@6.8   39.40@8.3   39.47@8.2              +0.07
 *     foldChainBoulder  46.81@6.6   48.02@8.0   48.05@7.9              +0.03
 *     foldChainFlower   34.93@6.2   35.99@7.8   36.07@7.7              +0.09
 *     SIX-link          16.01@12.9  17.28@16.3  17.74@15.8             +0.45
 *
 * The log form buys 1.1-2.4 points of hits over the shipped arm for 13-30%
 * more steps — the proposal's own "more hits, 20-40% more steps/ray",
 * confirmed
 * (`mandelboxCube` is the exception at +0.05, its march already converged at
 * 0.35). What the FORM is worth OVER THE CONSTANT is 0.00-0.45 points.
 *
 * The bound- and step-violation columns say the same thing (64 directions,
 * `linear / linear x k / log-v`): bound 21.3 / 20.1 / 19.5 on the control
 * map, 11.7 / 9.4 / 8.7 on the two-link chain, 91.6 / 83.9 / 88.0 on the
 * cube — where the constant BEATS the form. Across the seven fixtures the
 * two controls are within a point of each other in both columns and neither
 * consistently wins.
 *
 * AND THE FACTOR CARRIES NO STRUCTURE, which is the last place a defence of
 * the form could live. If `0.5·ln r` fell toward the surface it would be a
 * boundary-adaptive damping and no constant could imitate it. Median factor
 * over the NEAREST decile of queries against the FARTHEST: 0.747/0.735,
 * 0.875/0.852, 0.740/0.735, 0.745/0.735, 0.739/0.720, 0.759/0.735 — flat on
 * six of seven fixtures (`mandelboxCube`, 0.719/0.897, is the exception and
 * runs the wrong way). The variation around the constant is jitter that
 * carries no distance information, and the close sheet shows it: the log
 * panel is nearer the CONTROL panel than the shipped one on all seven
 * fixtures (hit-mask disagreement 0.02-4.39% against 0.08-5.65%, surface
 * shift roughly halved), but it is not the same picture as either.
 *
 * THE DIMENSIONAL ARGUMENT, which is why this is a refutation rather than a
 * close call. The fold family is EQUIVARIANT under a uniform rescale — since
 * its three lengths became authored, so scaling `t`, the lengths and
 * the bailout by λ scales the whole orbit exactly (`localL` and `dr` are
 * invariant). A correctly-dimensioned estimator must then satisfy
 * `DE_λ(λp) = λ·DE(p)`. The linear form does, TO THE BIT (worst deviation
 * 0.000e+0 over 4000 queries at λ = 2). The log form cannot: the extra term
 * is `λ·0.5·r·lnλ/dr`, and it measures a median relative error of 44.8%
 * (p95 49.8%) and a worst of 107x on the same queries.
 *
 * That is not an accident of this fixture. `ln r` needs `r` dimensionless,
 * and the Green's-function limit that makes it so for a degree-d power map
 * (`G = lim log|z_n|/d^n`, where the additive constant washes out) never
 * happens for a fold: far from the origin the map is `v -> w·v + p`, an
 * asymptotically LINEAR escape whose potential is linear too. Which is
 * exactly why the field marches Mandelboxes with `r/dr` and Mandelbulbs
 * with `0.5·r·ln r/dr`, and why `bulb-de.ts` and `qjulia-de.ts` are right to
 * differ from `escape-de.ts` rather than having drifted from it.
 *
 * WHICH RADIUS, since the proposal asks. `log-y` (the estimate read off the
 * post-affine `|y|` against `sigma_max(M)·dr`) is a READOUT, not a port —
 * same orbit, same bailout on `|v|`, same set — because a chain has no
 * single `M` to push the recurrence through, which is the reason
 * `hybrid-chain.harness.ts` stayed in `v` space too. It differs from `log-v`
 * by a median 0.92-1.59x with a p05-p95 span of 0.19-3.78, i.e. far more
 * than the two log arms differ from linear, and it is not uniformly better:
 * on `mandelboxCube` its step-violation rate is 17.8% against `log-v`'s
 * 4.3%. Reading the log off `|y|` is a third form, not a refinement.
 *
 * COST is not the argument either way: the three forms share one orbit and
 * differ by a `Math.log` and a compare, and measure 0.18-0.60 us/eval — the
 * log arms 0-14% dearer per eval, which is that one call. The frame cost is
 * march LENGTH — the 13-30% extra steps — and no arm exhausts a ray
 * anywhere: `exhausted` is 0.00% in every panel of every sweep, at every
 * step scale from 1.0 down to 0.1.
 *
 * WHAT WOULD OVERTURN THIS. A pose or a system where the log form's jitter
 * around its constant is worth more than 0.45 points of hits; or a fold
 * system whose orbits routinely terminate far outside the bailout ball,
 * where `0.5·ln r` stops being nearly constant (the `looser%` column —
 * queries with `r > e² = 7.389`, where the log form is LARGER than linear —
 * reaches 4.10% on `mandelboxRings` and 2.28% on the six-link chain, and is
 * 0.00% on the rest, so that regime exists but is rare). Neither is a real
 * driver question, which is worth saying plainly: this verdict rests on the
 * estimator's arithmetic and on CPU renders of it, and the GPU mirrors
 * compute the same expression in f32. There is nothing here a real driver
 * could show that this sheet cannot.
 *
 * CAVEATS ON THE EVIDENCE, two of which the proposal names and one it does
 * not:
 *
 *   - The violation rate is a WITNESS SEARCH and therefore a LOWER bound
 *     (14 random directions at `0.9·d` and `stepScale·d`, oracle =
 *     `escapeSetContains` at the rendered 30-pass budget). This file prices
 *     that: at 64 directions `mandelboxCube` reads 91.6% where 14 finds
 *     55.6%, and four independent 14-direction witness sets spread the same
 *     rate by 0.6-1.6 points. Every arm is probed with the IDENTICAL
 *     queries and directions, so between-arm differences do not inherit
 *     that spread; absolute rates do.
 *   - On the thinnest object the metric has no power at all:
 *     `mandelboxRings` reads 0.0%/0.0% for EVERY arm at 14, 32 and 64
 *     directions, because a set with no measurable volume is not found by
 *     random probing (the same property `escape-de.ts` warns about for
 *     `probeEscapeFill`). Its row is decided by the hits and the pictures.
 *   - THE DENOMINATORS DIFFER between arms — an arm that declines to
 *     certify a hard query drops it from its own row — so `probed` is
 *     printed. It is stable here (within ~1%) precisely because the clamp
 *     never fires.
 *
 * The shipped control row reproduces `escape-de.ts`'s own recorded numbers,
 * which is what says this apparatus is measuring the same thing the module
 * doc's tables did: bound/step 14.0/9.0 against the recorded 13.4/6.6 at 14
 * directions, and at the close pose 84.54% hits at step scale 0.35 against
 * the form sweep's recorded 84.3%.
 *
 * IF THE ~0.75x DAMPING IS WHAT YOU ACTUALLY WANT, it is already reachable
 * and this is where to read that before reaching for `ESCAPE_STEP_SCALE`.
 * The log form's entire measured benefit is a constant, and the mode has two
 * constants that between them ARE that constant: the step scale (0.35 ->
 * ~0.26, the `equal-march` arm in the violation table) shortens the march,
 * and the acceptance epsilon covers the rest — scaling an estimate moves the
 * hit test as well as the step, which is why the scale control and the
 * equal-march arm are not the same experiment above. Nothing needs to change
 * in six mirrors to get it.
 *
 * BUT IT IS NOT A FREE WIN, and taking it means re-opening a measured
 * decision rather than filling a gap. The form sweep chose 0.35 deliberately,
 * as a COST/QUALITY pick with no convergence knee to find — read
 * `ESCAPE_STEP_SCALE`'s own doc, whose table runs 1.0 -> 62.0% hits through
 * 0.35 -> 84.3% to 0.1 -> 89.1% at 52.5 steps/ray, and which settled on 0.35
 * as "where the image stops reading as erosion and starts reading as a lit
 * object". Everything below buys hits with steps on that same curve; none of
 * it says the curve should be read at a different point. Whoever wants 0.26
 * needs that sweep's argument re-run, not this sheet.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/escape-estimate-form.harness.ts
 * Writes, all under `scripts/out/`: `escape-estimate-form.png` (linear beside
 *         log at the shipped step scale, one row per fixture),
 *         `escape-estimate-form-march.png` (the step-scale frontier, all
 *         three arms), `escape-estimate-form-close.png` (the close pose, with
 *         the scale control as the third panel of every triple — the sheet
 *         the verdict rests on).
 */
import {
  buildEscapeDE,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
  escapeSetContains,
  estimateEscapeDistance,
  foldQueryIntoSector,
} from "../src/fractal/escape-de";
import type { EscapeDE } from "../src/fractal/escape-de";
import {
  foldChain,
  foldChainBoulder,
  foldChainFlower,
  mandelboxClassic,
  mandelboxCube,
  mandelboxRings,
  PRESET_SYMMETRIES,
} from "../src/fractal/presets";
import { mulberry32 } from "../src/fractal/rng";
import {
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_SPHEREFOLD,
  transformSigmas,
} from "../src/fractal/surface-de";
import type {
  SymmetryParams,
  Transform,
  VariationType,
} from "../src/fractal/types";
import { PREVIEW_HIT, renderPreview, writeContactSheet } from "./de-preview";
import type { DistanceEstimator, PanelStats, Vec3 } from "./de-preview";

/** Contact-sheet panel size. */
const SIZE = 380;
/** Step-scale sweep panel size — the same objects, cheaper. */
const SMALL = 240;
/** Close-pose panel size. */
const CLOSE = 340;

/**
 * `escape-form-sweep.harness.ts`'s framing, deliberately: `de-preview.ts`'s
 * default eye, `zoom` 0.5, and the BAILOUT ball as the marching ball for
 * every fixture. That is what the app itself does — `buildEscapeDE` pins
 * `boundingRadius` to `ESCAPE_TIME_RADIUS` for every escape system and
 * main.ts frames a new session on exactly that ball — so no panel here is
 * framed by a fit this harness invented, and every fixture shares ONE pose.
 */
const ZOOM = 0.5;
/** The close pose: same eye, a narrow frustum. `boundingRadius` is both the
 * camera stand-off and the march bound, so a close-up has to be a telephoto
 * rather than a dolly-in. It is the pose the form sweep's own step-scale
 * sweep found the fold's overshoot at (`escape-step-scale.png`). */
const CLOSE_ZOOM = 0.28;

// -------------------------------------------------------------- fixtures

const rot = (deg: number): Vec3 => [0, (deg * Math.PI) / 180, 0];

/** A single pure-fold map in the DOCUMENT vocabulary — the shape both
 * surface gates read. Only the six-link chain needs it; the other seven
 * fixtures ARE shipped presets, imported rather than re-authored. */
function foldMap(
  id: number,
  type: VariationType,
  weight: number,
  rotation: Vec3 = [0, 0, 0],
): Transform {
  return {
    id,
    position: [0, 0, 0],
    rotation,
    scale: [1, 1, 1],
    variations: [{ type, weight }],
  };
}

interface Fixture {
  label: string;
  transforms: Transform[];
  symmetry?: SymmetryParams;
}

/**
 * Every fold system the Escape-time menu group reaches, plus the longest
 * chain the family's own sheets measure.
 *
 * The three `mandelbulb*` presets sit in that same menu group and are NOT
 * here: `analyzeBulbSystem` owns them and `bulb-de.ts` already returns the
 * log form, so they are the question's other side rather than a fixture of
 * it. `mandelboxRings` is the deliberate adversary — the module doc records
 * it reading 0.0000% ball fill at 65536 samples while rendering ~38k
 * surface hits, i.e. a set thin enough that a change in the estimate has
 * nowhere to hide.
 */
const FIXTURES: Fixture[] = [
  {
    label: "CONTROL mandelboxClassic w=2 (1 link, ships)",
    transforms: mandelboxClassic(),
  },
  { label: "mandelboxRings w=3 (1 link, THIN)", transforms: mandelboxRings() },
  { label: "mandelboxCube w=-1.5 (1 link)", transforms: mandelboxCube() },
  { label: "foldChain (2 links)", transforms: foldChain() },
  { label: "foldChainBoulder (3 links)", transforms: foldChainBoulder() },
  {
    label: "foldChainFlower (2 links, order-5)",
    transforms: foldChainFlower(),
    symmetry: PRESET_SYMMETRIES.foldChainFlower,
  },
  {
    label: "SIX-link chain (escape-chain's)",
    transforms: [
      foldMap(1, "mandelbox", 2),
      foldMap(2, "mandelbox", 2, rot(20)),
      foldMap(3, "boxfold", 1.6),
      foldMap(4, "spherefold", 1.2),
      foldMap(5, "mandelbox", -1.5),
      foldMap(6, "boxfold", 1, rot(25)),
    ],
  },
];

// ------------------------------------------------------- the local orbit

/** Which radius the estimate is read off, and through which form. */
type Form = "linear" | "log-v" | "log-y";

const FORMS: Form[] = ["linear", "log-v", "log-y"];

/**
 * A fixture, resolved. `sigmaMax` is one entry per LINK, in the same order
 * `buildEscapeDE` builds them (both filter `weight > 0` over the document
 * order), and exists only for the `log-y` arm; `bailout` is a parameter
 * rather than the module constant so the equivariance test can scale it
 * with the system.
 */
interface LocalSystem {
  label: string;
  de: EscapeDE;
  sigmaMax: number[];
  bailout: number;
}

function localSystem(
  label: string,
  transforms: Transform[],
  symmetry?: SymmetryParams,
  bailout = ESCAPE_TIME_RADIUS,
): LocalSystem {
  return {
    label,
    de: buildEscapeDE(transforms, null, symmetry),
    sigmaMax: transforms
      .filter((t) => (t.weight ?? 1) > 0)
      .map((t) => transformSigmas(t).max),
    bailout,
  };
}

const localFixture = (f: Fixture): LocalSystem =>
  localSystem(f.label, f.transforms, f.symmetry);

/** `escape-de.ts`'s `foldAxis`, and its scratch vector, duplicated for the
 * reason that module duplicates them: the copy must stay allocation-free
 * and term-for-term or the pin below is worthless. */
function foldAxis(t: number, wall: number): number {
  return 2 * Math.max(-wall, Math.min(wall, t)) - t;
}
const FOLDED: Vec3 = [0, 0, 0];

// The orbit's terminal state, in module scratch for the reason
// `escape-de.ts` keeps its own there: this runs ~1e8 times across a sheet.
let localR = 0;
let localDr = 1;
let localYr = 0;
let localYdr = 1;

/**
 * {@link runEscapeOrbit} verbatim — the shipped cycle, the shipped `dr`
 * recurrence, the shipped query fold — with a parameterised bailout and two
 * extra READS: the pre-fold radius `|y|` of the last link applied, and the
 * derivative bound that goes with it.
 *
 * The `y` readout costs the main path nothing and changes no arithmetic on
 * it, which is what lets the pin below be bit-exact rather than merely
 * close. `|dy_n/dp| <= sigma_max(M_L)·dr_n` because `y_n = M_L v_n + t_L`,
 * so the bound is recorded BEFORE `dr` moves on to bound `v_(n+1)`.
 */
function runLocalOrbit(sys: LocalSystem, p: Vec3, maxIterations: number): void {
  const de = sys.de;
  const links = de.links;
  const n = links.length;
  const q =
    de.symmetryOrder > 1
      ? foldQueryIntoSector(p, de.symmetryOrder, de.symmetryPlane, FOLDED)
      : p;
  const qx = q[0];
  const qy = q[1];
  const qz = q[2];
  let vx = qx;
  let vy = qy;
  let vz = qz;
  let dr = 1;
  let r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  // Seeded at the query itself, so a point that escapes before the loop
  // body ever runs still has a `y` to report.
  let yr = r;
  let ydr = dr;
  const maxSteps = maxIterations * n;
  for (let step = 0; step < maxSteps && r <= sys.bailout; step++) {
    const slot = step % n;
    const link = links[slot];
    const m = link.m;
    const yx = m[0] * vx + m[1] * vy + m[2] * vz + link.t[0];
    const yy = m[3] * vx + m[4] * vy + m[5] * vz + link.t[1];
    const yz = m[6] * vx + m[7] * vy + m[8] * vz + link.t[2];
    yr = Math.sqrt(yx * yx + yy * yy + yz * yz);
    ydr = sys.sigmaMax[slot] * dr;
    let fx: number;
    let fy: number;
    let fz: number;
    let localL: number;
    const wall = link.boxLimit;
    const mR2 = link.minRadius2;
    const fR2 = link.fixedRadius2;
    if (link.kind === SURFACE_FOLD_BOXFOLD) {
      fx = foldAxis(yx, wall);
      fy = foldAxis(yy, wall);
      fz = foldAxis(yz, wall);
      localL = 1;
    } else if (link.kind === SURFACE_FOLD_SPHEREFOLD) {
      const r2 = yx * yx + yy * yy + yz * yz;
      const f = fR2 / Math.max(mR2, Math.min(fR2, r2));
      fx = yx * f;
      fy = yy * f;
      fz = yz * f;
      localL = f;
    } else {
      const bx = foldAxis(yx, wall);
      const by = foldAxis(yy, wall);
      const bz = foldAxis(yz, wall);
      const r2 = bx * bx + by * by + bz * bz;
      const f = fR2 / Math.max(mR2, Math.min(fR2, r2));
      fx = bx * f;
      fy = by * f;
      fz = bz * f;
      localL = f;
    }
    vx = link.w * fx + qx;
    vy = link.w * fy + qy;
    vz = link.w * fz + qz;
    dr = link.derivGrowth * localL * dr + 1;
    r = Math.sqrt(vx * vx + vy * vy + vz * vz);
  }
  localR = r;
  localDr = dr;
  localYr = yr;
  localYdr = ydr;
}

/**
 * The three forms, off one orbit.
 *
 * THE CLAMP IS `bulb-de.ts`'s, and both log arms need it for its reason:
 * `ln r` goes negative below `r = 1`, and a negative estimate marches the
 * tracer BACKWARDS. Returning exactly 0 there is the inside signal and is
 * safe in the direction a sphere tracer needs. It fires far more often here
 * than the proposal's sketch implies — see the ratio table below, where "log
 * certifies nothing" is a column.
 */
function estimator(
  sys: LocalSystem,
  form: Form,
  maxIterations = ESCAPE_TIME_ITERATIONS,
): DistanceEstimator {
  return (p: Vec3): number => {
    runLocalOrbit(sys, p, maxIterations);
    if (form === "linear") return localR / localDr;
    if (form === "log-v") {
      return localR <= 1 ? 0 : (0.5 * localR * Math.log(localR)) / localDr;
    }
    return localYr <= 1 ? 0 : (0.5 * localYr * Math.log(localYr)) / localYdr;
  };
}

/**
 * The shipped estimate, uniformly damped — the control the incidental
 * measurement lacked and the one every column below needs.
 *
 * The log form is not a different bound, it is the linear bound times
 * `0.5·ln r` (the ratio table's whole subject), so a comparison against
 * plain `linear` is confounded: a SMALLER certificate violates less and
 * accepts a hit sooner whatever produced it. `k` is that factor's measured
 * median, applied as a constant. Anything the log arm does that this arm
 * does not is attributable to the factor's VARIATION with the orbit —
 * which is the only thing the form actually adds.
 *
 * Note this is NOT the same experiment as lowering `ESCAPE_STEP_SCALE`:
 * a step scale shortens the march but leaves the acceptance test
 * `d < eps` where it was, while scaling the estimate moves both. The
 * frontier sweep runs the step-scale control; this runs the estimate one.
 */
function damped(de: DistanceEstimator, k: number): DistanceEstimator {
  return (p: Vec3) => k * de(p);
}

// ------------------------------------------------------------ measurement

/** Uniform points in a ball about the origin, seeded — the sampling every
 * sibling harness uses (cbrt for the radius, cos-uniform for the polar
 * angle), pulled out so every table below draws from the same shape. */
function ballPoints(radius: number, count: number, seed: number): Vec3[] {
  const rng = mulberry32(seed);
  const pts: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const u = Math.cbrt(rng()) * radius;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    pts.push([u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct]);
  }
  return pts;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(q * (sorted.length - 1))),
  );
  return sorted[i];
}

interface RatioStats {
  /** Exterior queries the LINEAR form certified something at. */
  probed: number;
  p05: number;
  p50: number;
  p95: number;
  /** Share of those where the log form returns exactly 0 — `r <= 1`, the
   * clamp. The log form certifies NOTHING at these points. */
  zeroPct: number;
  /** Share where the log form is LOOSER than linear (`r > e² = 7.389`), the
   * only region where swapping the form can lose a bound the linear one
   * held. */
  looserPct: number;
  /** Median factor over the NEAREST decile of queries by linear distance,
   * and over the farthest. A factor that falls toward the surface is a
   * boundary-adaptive damping — the one thing here a constant cannot
   * reproduce. */
  nearP50: number;
  farP50: number;
}

/**
 * What the log form multiplies the linear estimate BY.
 *
 * It is not a different bound so much as a rescaled one: both arms read the
 * SAME terminal `r` off the SAME orbit through the SAME `dr`, so
 * `log-v / linear` is exactly `0.5·ln r`, a number that depends on nothing
 * but where the orbit stopped. This measures its distribution over the
 * marching ball, which is the whole mechanism of the incidental result.
 */
function ratioStats(sys: LocalSystem, count = 4000): RatioStats {
  const lin = estimator(sys, "linear");
  const rows: { d: number; ratio: number }[] = [];
  let zero = 0;
  let looser = 0;
  for (const p of ballPoints(sys.bailout, count, 0x5eed_1234)) {
    const d = lin(p);
    if (!(d > 1e-6)) continue; // on or inside the set: nothing certified
    const ratio = localR <= 1 ? 0 : 0.5 * Math.log(localR);
    rows.push({ d, ratio });
    if (ratio === 0) zero++;
    if (ratio > 1) looser++;
  }
  const n = rows.length;
  const ratios = rows.map((r) => r.ratio).sort((a, b) => a - b);
  // Nearest and farthest deciles by the linear distance itself: the factor
  // is a function of the terminal radius, and whether that tracks proximity
  // to the surface is the only question a constant control cannot settle.
  const byD = [...rows].sort((a, b) => a.d - b.d);
  const decile = Math.max(1, Math.floor(n / 10));
  const med = (xs: { ratio: number }[]) =>
    quantile(
      xs.map((r) => r.ratio).sort((a, b) => a - b),
      0.5,
    );
  return {
    probed: n,
    p05: quantile(ratios, 0.05),
    p50: quantile(ratios, 0.5),
    p95: quantile(ratios, 0.95),
    zeroPct: n > 0 ? (100 * zero) / n : 0,
    looserPct: n > 0 ? (100 * looser) / n : 0,
    nearP50: n > 0 ? med(byD.slice(0, decile)) : 0,
    farP50: n > 0 ? med(byD.slice(n - decile)) : 0,
  };
}

/** The median `0.5·ln r` for a system — the constant the log form is worth,
 * and hence both controls' one parameter: {@link damped} scales the estimate
 * by it, and `ESCAPE_STEP_SCALE * k` is the step scale that spends the same
 * march. Cached because the sheets ask for it repeatedly. */
const LOG_FACTOR = new Map<string, number>();
function logFactor(sys: LocalSystem): number {
  const hit = LOG_FACTOR.get(sys.label);
  if (hit !== undefined) return hit;
  const k = ratioStats(sys).p50;
  LOG_FACTOR.set(sys.label, k);
  return k;
}

interface Violations {
  /** Exterior queries this arm certified a non-empty ball at — the
   * denominator, and NOT the same across arms (the log clamp declines to
   * certify anything wherever `r <= 1`). */
  probed: number;
  bound: number;
  step: number;
}

/** Directions the witness search tries per query. `escape-chain.harness.ts`
 * and `hybrid-chain.harness.ts` both use 14, and this file keeps that so
 * its rows are readable against `escape-de.ts`'s own table. */
const PROBE_DIRS = 14;
/** The DEEP search's direction count. 14 is what the family's recorded
 * tables were measured with and is kept for that comparison alone; this is
 * what the arms are actually judged on, because a witness search that finds
 * more violations is strictly closer to the truth (see the resolution test —
 * at 14 directions `mandelboxCube` reads 55.6% where 64 finds 91.6%). */
const DEEP_DIRS = 64;
/** Fraction of the certified radius the BOUND probe fires at. */
const BOUND_PROBE = 0.9;
/** Exterior queries per row. */
const PROBE_QUERIES = 1200;

/**
 * The witness search's queries and directions, PRE-GENERATED so every arm
 * sees byte-identical probes.
 *
 * The sibling harnesses draw both from one live stream and break the
 * direction loop early once both violations are witnessed, which couples
 * how much randomness an arm consumes to how badly it scores: change the
 * step scale and every subsequent QUERY moves too. Measured, that shifted
 * this file's denominators by 3-15 queries between arms of a single
 * fixture — small, but it is noise on exactly the difference being
 * measured, and a paired comparison is free.
 *
 * The cost of decoupling is that rows here are not bit-comparable with
 * `escape-chain.harness.ts`'s; they are still drawn the same way from the
 * same seed in the same ball, and the shipped control row reproduces
 * `escape-de.ts`'s recorded table to a tenth of a point either way, which
 * is the anchor that matters.
 */
const PROBE_POOL = new Map<string, { queries: Vec3[]; dirs: Vec3[][] }>();
function probePool(
  radius: number,
  dirCount = PROBE_DIRS,
  seed = 0xd12ec7,
): { queries: Vec3[]; dirs: Vec3[][] } {
  const key = `${radius}:${dirCount}:${seed}`;
  const hit = PROBE_POOL.get(key);
  if (hit) return hit;
  const queries = ballPoints(radius, PROBE_QUERIES, 0x5eed_1234);
  const rng = mulberry32(seed);
  const dirs = queries.map(() => {
    const set: Vec3[] = [];
    for (let k = 0; k < dirCount; k++) {
      const c2 = 2 * rng() - 1;
      const s2 = Math.sqrt(Math.max(0, 1 - c2 * c2));
      const p2 = 2 * Math.PI * rng();
      set.push([s2 * Math.cos(p2), s2 * Math.sin(p2), c2]);
    }
    return set;
  });
  const pool = { queries, dirs };
  PROBE_POOL.set(key, pool);
  return pool;
}

/**
 * How often does an arm claim an empty ball that is not empty?
 *
 * `escape-chain.harness.ts`'s `violationPct`, parameterised by ESTIMATOR
 * and STEP SCALE so the two forms can each be measured at their own
 * marching step, and drawing from the same bailout ball with the same seed
 * so its rows are comparable with `escape-de.ts`'s recorded table.
 *
 * The membership oracle is the SHIPPED {@link escapeSetContains},
 * unchanged, and that is exact rather than approximate here: both arms run
 * the same orbit over the same links with the same bailout, so they render
 * the same SET and differ only in the number they report about it.
 *
 * THREE CAVEATS, all of which the proposal names and two of which it
 * under-states:
 *
 *   1. A LOWER BOUND. This is a witness search over {@link PROBE_DIRS}
 *      random directions at two radii; a violation with no witness among
 *      those 14 is not counted. The true rate is at least this.
 *   2. The membership oracle is the estimator's own finite budget
 *      ({@link ESCAPE_TIME_ITERATIONS} passes) — the rendered set, not a
 *      longer truth.
 *   3. THE DENOMINATORS DIFFER BETWEEN ARMS, which nothing before this
 *      harness accounted for. A query where the log form returns 0 is
 *      skipped from its row and kept in the linear row, so an arm that
 *      declines to certify the hardest points scores better for free.
 *      `probed` is printed for exactly that reason.
 *
 * And the deeper one, which is why the frontier sweep exists: an estimator
 * that is uniformly k < 1 times another certifies smaller balls and
 * therefore violates less, trivially. Violation rates ALONE cannot compare
 * two forms of different scale.
 */
function violations(
  sys: LocalSystem,
  de: DistanceEstimator,
  stepScale: number,
  dirCount = PROBE_DIRS,
  seed = 0xd12ec7,
): Violations {
  // The oracle is the SHIPPED membership test, which reads the module's own
  // `ESCAPE_TIME_RADIUS` rather than this system's field. That is what makes
  // the arms comparable, and it means a rescaled system (the equivariance
  // test's) would be probed against the wrong set — silently, and with
  // plausible-looking numbers. It never is; this says so out loud.
  if (sys.bailout !== ESCAPE_TIME_RADIUS) {
    throw new Error(
      `violations() reads escapeSetContains, whose bailout is the module's ` +
        `${ESCAPE_TIME_RADIUS}, not this system's ${sys.bailout}`,
    );
  }
  const { queries, dirs } = probePool(sys.bailout, dirCount, seed);
  let probed = 0;
  let badBound = 0;
  let badStep = 0;
  queries.forEach((p, q) => {
    const d = de(p);
    if (!(d > 1e-6)) return;
    probed++;
    let hitBound = false;
    let hitStep = false;
    for (const u of dirs[q]) {
      if (
        !hitBound &&
        escapeSetContains(sys.de, [
          p[0] + BOUND_PROBE * d * u[0],
          p[1] + BOUND_PROBE * d * u[1],
          p[2] + BOUND_PROBE * d * u[2],
        ])
      ) {
        hitBound = true;
      }
      if (
        !hitStep &&
        escapeSetContains(sys.de, [
          p[0] + stepScale * d * u[0],
          p[1] + stepScale * d * u[1],
          p[2] + stepScale * d * u[2],
        ])
      ) {
        hitStep = true;
      }
      if (hitBound && hitStep) break;
    }
    if (hitBound) badBound++;
    if (hitStep) badStep++;
  });
  return {
    probed,
    bound: probed > 0 ? (100 * badBound) / probed : 0,
    step: probed > 0 ? (100 * badStep) / probed : 0,
  };
}

/** One panel at the shared pose, plus the per-ray numbers the brief asks
 * every row to carry. */
interface PanelReport {
  panel: PanelStats;
  hitPct: number;
  stepsMean: number;
  /** 95th percentile of steps over rays that ENTERED the marching ball —
   * rays that miss the bounding sphere spend 0 and would otherwise drag the
   * quantile toward the background. */
  stepsP95: number;
  exhaustedPct: number;
}

function panelReport(
  de: DistanceEstimator,
  stepScale: number,
  size: number,
  zoom = ZOOM,
  collect = true,
): PanelReport {
  const panel = renderPreview(
    {
      de,
      boundingRadius: ESCAPE_TIME_RADIUS,
      stepScale,
      zoom,
      collect,
    },
    size,
  );
  const px = size * size;
  let p95 = 0;
  if (panel.stepCount) {
    const entered: number[] = [];
    for (const s of panel.stepCount) if (s > 0) entered.push(s);
    entered.sort((a, b) => a - b);
    p95 = quantile(entered, 0.95);
  }
  return {
    panel,
    hitPct: (100 * panel.hits) / px,
    stepsMean: panel.steps / px,
    stepsP95: p95,
    exhaustedPct: (100 * panel.exhausted) / px,
  };
}

/**
 * us/eval over uniform queries in the bailout ball — `escape-chain.
 * harness.ts`'s own cost method and query count, so the columns line up,
 * plus a WARM-UP pass and a best-of-three that harness does not need.
 *
 * The three forms share one orbit and differ by at most a `Math.log` and a
 * compare, so their true costs are within a percent of each other — which
 * is precisely why this needs warming: measured cold, whichever arm ran
 * first paid V8's optimisation for the whole closure and read 1.5-2.5x the
 * others, i.e. the ARM ORDER, printed as if it were a property of the
 * formula. Best-of-three then drops the runs that caught a GC.
 */
function microsPerEval(de: DistanceEstimator, count = 60_000): number {
  const warm = ballPoints(ESCAPE_TIME_RADIUS, 20_000, 0x515e);
  const pts = ballPoints(ESCAPE_TIME_RADIUS, count, 0xbeef);
  let acc = 0;
  for (const p of warm) acc += de(p);
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const t0 = Date.now();
    for (const p of pts) acc += de(p);
    best = Math.min(best, Date.now() - t0);
  }
  // Read the accumulator so no engine can elide the loops.
  if (!Number.isFinite(acc)) throw new Error("non-finite checksum");
  return (best * 1000) / pts.length;
}

const pct = (x: number) => `${x.toFixed(2)}%`;

/**
 * How different are two panels GEOMETRICALLY: the share of pixels whose
 * hit/miss verdict disagrees, and how far the surface moved where both hit
 * (in units of the marching radius).
 *
 * DELIBERATELY NOT AN RGB DIFF, and the first cut of this harness got that
 * wrong. `de-preview.ts` stands the STEP COUNT in for ambient occlusion and
 * cone-traces its shadow through the DE, so both shading terms read the
 * MARCHER'S STATISTICS rather than the object —
 * `chain-speckle.harness.ts`'s mechanism (C). Measured that way, the log
 * panel sat 17.6/255 from the shipped one and 15.9/255 from a control whose
 * hit counts match it to 0.4 of a point: a change in step LENGTH repaints
 * the frame wherever geometry is identical, so an RGB diff here answers a
 * question about the harness's shading. These two numbers come off the
 * per-pixel arrays `collect` already fills and cannot be confounded that
 * way.
 */
function geomDiff(
  a: PanelStats,
  b: PanelStats,
): { maskPct: number; shiftMean: number; shiftP95: number } {
  const sa = a.status;
  const sb = b.status;
  const pa = a.hitPos;
  const pb = b.hitPos;
  if (!sa || !sb || !pa || !pb) throw new Error("geomDiff needs collect: true");
  const px = a.width * a.height;
  let mask = 0;
  const shifts: number[] = [];
  for (let i = 0; i < px; i++) {
    const hitA = sa[i] === PREVIEW_HIT;
    const hitB = sb[i] === PREVIEW_HIT;
    if (hitA !== hitB) {
      mask++;
      continue;
    }
    if (!hitA) continue;
    const at = i * 3;
    shifts.push(
      Math.hypot(
        pa[at] - pb[at],
        pa[at + 1] - pb[at + 1],
        pa[at + 2] - pb[at + 2],
      ),
    );
  }
  shifts.sort((x, y) => x - y);
  const mean =
    shifts.length > 0 ? shifts.reduce((s, v) => s + v, 0) / shifts.length : 0;
  return {
    maskPct: (100 * mask) / px,
    shiftMean: mean / ESCAPE_TIME_RADIUS,
    shiftP95: quantile(shifts, 0.95) / ESCAPE_TIME_RADIUS,
  };
}

// ------------------------------------------------------------------ tests

describe("linear vs Böttcher-log estimate form for the escape folds", () => {
  it("pins the local orbit against the SHIPPED estimator, bit-exactly", () => {
    // The whole harness rests on this. If the linear configuration of the
    // copy below is `estimateEscapeDistance` to the last bit, then the log
    // column is a change of ONE expression and nothing else — which is the
    // claim the proposal makes about the production change too. Same discipline
    // as `spherefold-radius-sweep.harness.ts`'s parameterised orbit and
    // `hybrid-chain.harness.ts`'s one-link degeneration.
    const rng = mulberry32(0x2b1d);
    for (const f of FIXTURES) {
      const sys = localFixture(f);
      const mine = estimator(sys, "linear");
      let worst = 0;
      for (let i = 0; i < 4000; i++) {
        const p: Vec3 = [8 * rng() - 4, 8 * rng() - 4, 8 * rng() - 4];
        worst = Math.max(
          worst,
          Math.abs(mine(p) - estimateEscapeDistance(sys.de, p)),
        );
      }
      console.log(
        `  ${f.label.padEnd(42)} ${String(sys.de.links.length).padStart(2)} links  ` +
          `worst |shipped - local| = ${worst}`,
      );
      expect(worst, f.label).toBe(0);
    }
  });

  it("measures what the log form MULTIPLIES the linear estimate by", () => {
    // The mechanism, and it is arithmetic rather than a new bound: both
    // arms read the same terminal `r` off the same orbit through the same
    // `dr`, so `log-v / linear` is exactly `0.5·ln r`. If that factor sits
    // in a narrow band, the log form is the linear form under a different
    // step scale, and the proposal's "better bound, more steps" is that band
    // measured from the outside.
    //
    // `zero%` is the clamp firing — the log form certifying NOTHING (`r <=
    // 1`, orbits that converge inward). `looser%` is the only region where
    // the swap can cost a bound the linear form held: `r > e² = 7.389`.
    console.log(
      `  factor = 0.5·ln(terminal |v|); < 1 means the log form DAMPS the march`,
    );
    for (const f of FIXTURES) {
      const sys = localFixture(f);
      const s = ratioStats(sys);
      console.log(
        `  ${f.label.padEnd(42)} probed ${String(s.probed).padStart(4)}  ` +
          `factor [p05 ${s.p05.toFixed(3)}  p50 ${s.p50.toFixed(3)}  p95 ${s.p95.toFixed(3)}]  ` +
          `zero ${pct(s.zeroPct).padStart(7)}  looser ${pct(s.looserPct).padStart(7)}\n` +
          `  ${" ".repeat(42)} nearest decile ${s.nearP50.toFixed(3)} vs farthest ${s.farP50.toFixed(3)}  ` +
          `-> equal-march linear scale ${(ESCAPE_STEP_SCALE * s.p50).toFixed(3)}`,
      );
      // The band matters more than its location: a factor that swung over
      // orders of magnitude would make "a rescaled step" the wrong reading.
      expect(s.probed, `${f.label}: nothing certified`).toBeGreaterThan(100);
    }
  });

  it("sweeps the march step scale for BOTH forms — the hits/cost frontier", () => {
    // THE DECISIVE EXPERIMENT, and the one the incidental numbers
    // could not be: a uniformly smaller estimate buys more hits and pays
    // more steps whatever produced it, so the only fair question is what
    // each arm delivers AT EQUAL COST. Sweeping both over one ladder traces
    // each arm's hits-against-steps frontier; if the two frontiers lie on
    // top of each other, the log form is a reparameterisation of
    // ESCAPE_STEP_SCALE and buys nothing a constant already buys.
    const scales = [1, 0.7, 0.5, 0.35, 0.2, 0.1];
    const shipped = scales.indexOf(ESCAPE_STEP_SCALE);
    const panels: PanelStats[] = [];
    for (const f of FIXTURES) {
      const sys = localFixture(f);
      const k = logFactor(sys);
      const lin = estimator(sys, "linear");
      const arms: [string, DistanceEstimator][] = [
        ["linear       ", lin],
        [`linear x${k.toFixed(3)}`, damped(lin, k)],
        ["log-v        ", estimator(sys, "log-v")],
      ];
      const curves = new Map<string, { steps: number; hits: number }[]>();
      for (const [name, de] of arms) {
        const row: string[] = [];
        const curve: { steps: number; hits: number }[] = [];
        for (const stepScale of scales) {
          const r = panelReport(de, stepScale, SMALL, ZOOM, false);
          row.push(
            `${stepScale}: hits ${r.hitPct.toFixed(2)}% steps ${r.stepsMean.toFixed(1)} ` +
              `exh ${r.exhaustedPct.toFixed(2)}%`,
          );
          curve.push({ steps: r.stepsMean, hits: r.hitPct });
          panels.push(r.panel);
        }
        curves.set(name.trim(), curve);
        console.log(`  ${f.label}  ${name.trim()}\n      ${row.join("  |  ")}`);
      }
      // The reading, in two lines. First: what plain linear delivers at the
      // cost the log arm pays at the shipped 0.35 — that is the frontier
      // question, and it is blind to acceptance. Second: the scale control
      // at the SAME step scale, which is not blind to it. If the log arm
      // and the control land together, the form is the constant.
      const log = curves.get("log-v")!;
      const ctl = curves.get(`linear x${k.toFixed(3)}`)!;
      const at = log[shipped];
      const c = ctl[shipped];
      console.log(
        `      AT EQUAL COST  log-v@0.35 spends ${at.steps.toFixed(1)} steps/ray for ` +
          `${at.hits.toFixed(2)}% hits;  plain linear at ${at.steps.toFixed(1)} steps/ray ` +
          `gives ${interpolateHits(curves.get("linear")!, at.steps).toFixed(2)}%\n` +
          `      SCALE CONTROL  linear x${k.toFixed(3)} @0.35 gives ${c.hits.toFixed(2)}% ` +
          `at ${c.steps.toFixed(1)} steps/ray  (log-v ${at.hits.toFixed(2)}% at ` +
          `${at.steps.toFixed(1)};  delta ${(at.hits - c.hits >= 0 ? "+" : "") + (at.hits - c.hits).toFixed(2)} pts)`,
      );
    }
    console.log(
      `  wrote ${writeContactSheet(panels, scales.length, "escape-estimate-form-march.png")}`,
    );
  });

  it("measures bound and damped-step VIOLATION rates for both forms", () => {
    // The proposal's own metric, reproduced with the caveats made explicit and
    // one arm added. `linear@equal-work` is the control the incidental
    // measurement lacked: the shipped form damped by the same factor the
    // log form applies, so a log column that beats plain 0.35 but ties this
    // has demonstrated the step scale, not the form.
    console.log(
      `  witness search: ${PROBE_QUERIES} exterior queries in the bailout ball, ` +
        `${PROBE_DIRS} random directions each, at ${BOUND_PROBE}·d (bound) and ` +
        `stepScale·d (step). A LOWER BOUND on the true rate — an unwitnessed ` +
        `violation is not counted — and the oracle is escapeSetContains at the ` +
        `rendered ${ESCAPE_TIME_ITERATIONS}-pass budget. `,
    );
    console.log(
      `  probed is each arm's OWN denominator; the log clamp declines to certify ` +
        `anything where the orbit ends at |v| <= 1, and those queries leave its row.`,
    );
    for (const f of FIXTURES) {
      const sys = localFixture(f);
      const k = logFactor(sys);
      const lin = estimator(sys, "linear");
      const arms: [string, DistanceEstimator, number][] = [
        ["linear         @0.35 (ships)", lin, ESCAPE_STEP_SCALE],
        [
          `linear x${k.toFixed(3)} @0.35 CONTROL`,
          damped(lin, k),
          ESCAPE_STEP_SCALE,
        ],
        [
          `linear         @${(ESCAPE_STEP_SCALE * k).toFixed(3)} equal-march`,
          lin,
          ESCAPE_STEP_SCALE * k,
        ],
        ["log-v          @0.35", estimator(sys, "log-v"), ESCAPE_STEP_SCALE],
        ["log-y          @0.35", estimator(sys, "log-y"), ESCAPE_STEP_SCALE],
      ];
      console.log(`  ${f.label}`);
      for (const [name, de, stepScale] of arms) {
        const v = violations(sys, de, stepScale);
        const deep = violations(sys, de, stepScale, DEEP_DIRS);
        console.log(
          `      ${name.padEnd(30)} probed ${String(v.probed).padStart(4)}  ` +
            `14d bound ${v.bound.toFixed(1).padStart(4)}% step ${v.step.toFixed(1).padStart(4)}%  ` +
            `| ${DEEP_DIRS}d bound ${deep.bound.toFixed(1).padStart(4)}% step ${deep.step.toFixed(1).padStart(4)}%`,
        );
      }
    }
  });

  it("prices the violation metric's OWN resolution", () => {
    // The proposal asks for this caveat fixed where it can be. It cannot be
    // removed — a witness search is a lower bound by construction — but it
    // CAN be priced, and a reader deciding a shader change on a 1-2 point
    // difference needs both numbers below.
    //
    // WITNESS DEPTH: more directions find more violations, so the rate
    // climbs with the search and never converges from above. The gap
    // between 14 and 64 is how much of a LOWER bound 14 is.
    //
    // WITNESS SET: four independent direction pools at the shipped 14, same
    // queries. The spread is this metric's noise floor for an ABSOLUTE
    // rate. Between-arm differences are far tighter than that spread and do
    // not inherit it, because every arm above is probed with the identical
    // queries and the identical directions — that pairing is the whole
    // reason this file pre-generates its pools.
    const seeds = [0xd12ec7, 0x1ce, 0x9a17, 0xb0b];
    for (const f of FIXTURES) {
      const sys = localFixture(f);
      const lin = estimator(sys, "linear");
      const depth = [PROBE_DIRS, 32, 64].map((n) => {
        const v = violations(sys, lin, ESCAPE_STEP_SCALE, n);
        return `${n}d ${v.bound.toFixed(1)}/${v.step.toFixed(1)}`;
      });
      const spread = seeds.map((s) => {
        const v = violations(sys, lin, ESCAPE_STEP_SCALE, PROBE_DIRS, s);
        return v.bound;
      });
      const lo = Math.min(...spread);
      const hi = Math.max(...spread);
      console.log(
        `  ${f.label.padEnd(42)} depth ${depth.join("  ")}   |   ` +
          `bound over 4 witness sets ${lo.toFixed(1)}-${hi.toFixed(1)}% ` +
          `(spread ${(hi - lo).toFixed(1)})`,
      );
    }
  });

  it("renders the side-by-side contact sheet", () => {
    // Same object, same pose, same step scale, same shading — the only
    // difference between the two panels of a row is the return statement.
    // That is what `de-preview.ts` exists to guarantee, and it is how
    // the form sweep decided the step scale.
    const panels: PanelStats[] = [];
    for (const f of FIXTURES) {
      const sys = localFixture(f);
      for (const form of ["linear", "log-v"] as Form[]) {
        const r = panelReport(estimator(sys, form), ESCAPE_STEP_SCALE, SIZE);
        console.log(
          `  ${f.label.padEnd(42)} ${form.padEnd(7)} ` +
            `hits ${r.hitPct.toFixed(2)}%  steps/ray ${r.stepsMean.toFixed(1)}  ` +
            `p95 ${r.stepsP95}  exhausted ${pct(r.exhaustedPct)}  ${r.panel.ms}ms`,
        );
        panels.push(r.panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 2, "escape-estimate-form.png")}`,
    );
    // Guard the guard: a blank panel makes the sheet meaningless.
    panels.forEach((p, i) => {
      expect(p.hits, `panel ${i} rendered nothing`).toBeGreaterThan(
        0.005 * SIZE * SIZE,
      );
    });
  });

  it("looks CLOSE, where a step scale and a form separate", () => {
    // The silhouette sheet cannot settle "resolves more or merely accepts
    // earlier". This is the pose the form sweep found the fold's
    // overshoot at, with {@link damped}'s scale control as every triple's
    // third panel: if the log panel is the CONTROL panel rather than the
    // shipped one, the form has been shown to be a constant.
    const panels: PanelStats[] = [];
    for (const f of FIXTURES) {
      const sys = localFixture(f);
      const k = logFactor(sys);
      const lin = estimator(sys, "linear");
      const arms: [string, DistanceEstimator, number][] = [
        ["linear @0.35", lin, ESCAPE_STEP_SCALE],
        ["log-v  @0.35", estimator(sys, "log-v"), ESCAPE_STEP_SCALE],
        [`linear x${k.toFixed(3)}`, damped(lin, k), ESCAPE_STEP_SCALE],
      ];
      const shot: PanelStats[] = [];
      for (const [name, de, stepScale] of arms) {
        const r = panelReport(de, stepScale, CLOSE, CLOSE_ZOOM);
        console.log(
          `  ${f.label.padEnd(42)} ${name.padEnd(14)} ` +
            `hits ${r.hitPct.toFixed(2)}%  steps/ray ${r.stepsMean.toFixed(1)}  ` +
            `p95 ${r.stepsP95}  exhausted ${pct(r.exhaustedPct)}`,
        );
        shot.push(r.panel);
        panels.push(r.panel);
      }
      // The picture question, as a number. If the log panel is nearer the
      // control than the shipped one, the eye is being shown the constant.
      const [ship, log, ctl] = shot;
      const vsShip = geomDiff(log, ship);
      const vsCtl = geomDiff(log, ctl);
      console.log(
        `  ${" ".repeat(42)} log-v vs shipped: mask ${vsShip.maskPct.toFixed(2)}% ` +
          `shift [mean ${vsShip.shiftMean.toExponential(2)} p95 ${vsShip.shiftP95.toExponential(2)}]R  |  ` +
          `vs CONTROL: mask ${vsCtl.maskPct.toFixed(2)}% ` +
          `shift [mean ${vsCtl.shiftMean.toExponential(2)} p95 ${vsCtl.shiftP95.toExponential(2)}]R`,
      );
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "escape-estimate-form-close.png")}`,
    );
  });

  it("prices the forms against each other", () => {
    // The forms share an orbit, so the only cost difference an EVAL can
    // carry is one `Math.log` and a compare. Anything larger in the frame
    // numbers is march length, not arithmetic — which is the distinction
    // the proposal's "20-40% more steps/ray" needs to be read against.
    // Every arm of every fixture is exercised before ANY of them is timed:
    // the forms share one `runLocalOrbit`, so a link shape first seen
    // halfway down the table would deoptimise the call site under the rows
    // already measured and price the ORDER rather than the formula.
    const built = FIXTURES.map((f) => {
      const sys = localFixture(f);
      return { f, arms: FORMS.map((form) => estimator(sys, form)) };
    });
    const warm = ballPoints(ESCAPE_TIME_RADIUS, 5_000, 0x515e);
    for (const b of built) for (const de of b.arms) for (const p of warm) de(p);
    for (const b of built) {
      const row = b.arms.map(
        (de, i) => `${FORMS[i]} ${microsPerEval(de).toFixed(2)} us/eval`,
      );
      console.log(`  ${b.f.label.padEnd(42)} ${row.join("   ")}`);
    }
  });

  it("asks which radius feeds the log: |v| or the post-link |y|", () => {
    // `escape-de.ts` reads `|v|` with `dr` tracking `dv/dp` and a literal
    // `+ 1`; `bulb-de.ts` reads `|y|` with `dr` tracking `dy/dp`, seeded
    // and offset by `sigma_max(M)`. Those are the same recurrence in two
    // coordinates for a SINGLE map, and a chain has no single `M` to push
    // through — which is why `hybrid-chain.harness.ts` stayed in `v` space
    // and why the log-y arm here is a READOUT rather than a port: it runs
    // the identical orbit, tests escape on the identical `|v|`, and divides
    // the same `dr` by that link's own `sigma_max`. The SET is untouched in
    // both arms; only the number reported about it moves.
    //
    // A true y-space port would test escape on `|y|` and render a different
    // object, which is more than the one-return-statement change this
    // proposal is about.
    for (const f of FIXTURES) {
      const sys = localFixture(f);
      const v = estimator(sys, "log-v");
      const y = estimator(sys, "log-y");
      const rel: number[] = [];
      let bothZero = 0;
      let oneZero = 0;
      for (const p of ballPoints(sys.bailout, 4000, 0x5eed_1234)) {
        const a = v(p);
        const b = y(p);
        if (a === 0 && b === 0) {
          bothZero++;
          continue;
        }
        if (a === 0 || b === 0) {
          oneZero++;
          continue;
        }
        rel.push(b / a);
      }
      rel.sort((x, z) => x - z);
      console.log(
        `  ${f.label.padEnd(42)} log-y/log-v [p05 ${quantile(rel, 0.05).toFixed(3)} ` +
          `p50 ${quantile(rel, 0.5).toFixed(3)} p95 ${quantile(rel, 0.95).toFixed(3)}]  ` +
          `both-zero ${bothZero}  one-zero ${oneZero}  of 4000`,
      );
    }
  });

  it("tests both forms for UNIFORM-RESCALE equivariance", () => {
    // The dimensional argument, executable. The fold family is equivariant
    // under a uniform rescale once its three lengths became authored:
    // scale `t`, the fold's lengths and the bailout by λ and the whole orbit
    // scales exactly (`localL` and `dr` are invariant, `|v|` scales), so a
    // correctly-dimensioned estimator must satisfy DE_λ(λp) = λ·DE(p).
    //
    // The linear form does, to the bit. `0.5·r·ln r` cannot: the extra term
    // is `λ·0.5·r·lnλ/dr`, so the log estimate is off by `1 + lnλ/ln r` —
    // 50% too large at λ = 2 and a terminal radius of 4, and CLAMPED TO
    // ZERO for a small enough λ. `ln r` needs r to be dimensionless, and in
    // this family it is not: the escape is asymptotically LINEAR (the map
    // is `v -> w·v + p` far out, a constant-factor growth), where the
    // Green's-function limit that cancels the additive constant for a
    // degree-d power map never happens. That is the textbook reason the
    // field marches Mandelboxes with `r/dr` and Mandelbulbs with
    // `0.5·r·ln r/dr`, and it is the one thing here that no amount of
    // step-scale tuning can repair.
    const lambda = 2;
    const base: Transform[] = [
      {
        id: 1,
        position: [0.4, 0.3, 0.2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [
          {
            type: "mandelbox",
            weight: 2,
            minRadius: 0.5,
            fixedRadius: 1,
            boxLimit: 1,
          },
        ],
      },
    ];
    const scaled: Transform[] = [
      {
        id: 1,
        position: [0.4 * lambda, 0.3 * lambda, 0.2 * lambda],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [
          {
            type: "mandelbox",
            weight: 2,
            minRadius: 0.5 * lambda,
            fixedRadius: 1 * lambda,
            boxLimit: 1 * lambda,
          },
        ],
      },
    ];
    const one = localSystem("base", base);
    const big = localSystem(
      "scaled",
      scaled,
      undefined,
      ESCAPE_TIME_RADIUS * lambda,
    );
    for (const form of ["linear", "log-v"] as Form[]) {
      const a = estimator(one, form);
      const b = estimator(big, form);
      const rel: number[] = [];
      let zeroed = 0;
      for (const p of ballPoints(ESCAPE_TIME_RADIUS, 4000, 0xa11ce)) {
        const want = lambda * a(p);
        const got = b([p[0] * lambda, p[1] * lambda, p[2] * lambda]);
        if (want === 0 || got === 0) {
          if (want !== got) zeroed++;
          continue;
        }
        rel.push(Math.abs(got / want - 1));
      }
      rel.sort((x, z) => x - z);
      const worstRel = rel.length > 0 ? rel[rel.length - 1] : 0;
      console.log(
        `  λ=${lambda}  ${form.padEnd(7)} |DE_λ(λp)/(λ·DE(p)) - 1| over ` +
          `${rel.length} queries: p50 ${quantile(rel, 0.5).toExponential(3)}  ` +
          `p95 ${quantile(rel, 0.95).toExponential(3)}  worst ` +
          `${worstRel.toExponential(3)}  (one side exactly 0 on ${zeroed})`,
      );
      if (form === "linear") {
        // Exact, not approximate: λ is a power of two, so every scaled
        // quantity in the orbit is an exact f64 rescale of the unscaled one.
        expect(worstRel, "linear form is not rescale-equivariant").toBe(0);
      } else {
        expect(
          worstRel,
          "log form turned out rescale-equivariant after all",
        ).toBeGreaterThan(0.1);
      }
    }
  });
});

/** Hits the linear arm delivers at a given steps/ray, read off its own
 * measured curve by linear interpolation (the curve is monotone in both
 * coordinates over this ladder). Outside the measured range it clamps to
 * the nearest endpoint and the caller can see that from the printed row. */
function interpolateHits(
  curve: { steps: number; hits: number }[],
  steps: number,
): number {
  const sorted = [...curve].sort((a, b) => a.steps - b.steps);
  if (steps <= sorted[0].steps) return sorted[0].hits;
  const last = sorted[sorted.length - 1];
  if (steps >= last.steps) return last.hits;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (steps <= b.steps) {
      const f = (steps - a.steps) / (b.steps - a.steps || 1);
      return a.hits + f * (b.hits - a.hits);
    }
  }
  return last.hits;
}
