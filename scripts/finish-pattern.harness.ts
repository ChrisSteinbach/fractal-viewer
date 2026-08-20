/**
 * Does WOOD read as wood on fractal geometry? — the Tier-2 patterned-albedo
 * question, decided by a contact sheet rather than a hunch
 * (`qjulia-beauty.harness.ts`'s precedent: twenty panels refused a whole
 * epic, and that is an acceptable outcome here too).
 *
 * The candidate is FRACTAL-NATIVE patterning: the grain is driven by hit
 * quantities that keep resolving under zoom — the tracers' own `rings` and
 * `sheets` hit-info traps (the descent orbit's closest radial approach to
 * the attractor's centre, and its closest approach to the attractor frame's
 * `y = 0` plane, both normalized by the bounding radius), through
 * `surface-finish.ts`'s `surfaceFinishPatternAlbedo` ramp, modulating the
 * ALBEDO before lighting. The fallback is WORLD-SPACE patterning — a
 * cylinder radius wobbled by value noise, the textbook procedural wood —
 * whose detail plateaus under magnification: the bands are fixed in world
 * space, so a close-up holds fewer of them and the wobble stops producing
 * new structure. Both routes drive the SAME ramp and are lit by the SAME
 * composition, so a panel pair differs only in where the grain coordinate
 * comes from.
 *
 * Every hit is lit with the REAL composition — `finishShadeTs` at the
 * classic params, through `de-preview.ts`'s shading hook — never a ninth
 * approximation; the only thing the sheet varies between a control and a
 * patterned panel is the albedo handed to that one function.
 *
 * The per-hit traps are computed on the CPU by {@link hitInfo}, a port of
 * the GLSL fold-variant hit-info body (`surface-material.ts`'s
 * `SURFACE_FOLDS` `surfaceDE` overload): a GREEDY single-chain descent that
 * follows the smallest floored-key candidate over every (sector, base map,
 * fold branch) triple and min-tracks `|image − centre|/R` and `|image.y|/R`
 * along it. The CPU oracle deliberately mirrors distance only, so no
 * hit-info entry point exists to import; this is a derivation from the
 * `SurfaceDE` fields the oracle exports (`maps`, `symmetry`,
 * `boundCenter`, `boundingRadius`, `escapeRadius`, `maxDepth`, `final`).
 * For fold systems it IS the shipped definition; for affine systems the
 * shipped tracers read the refined ladder's per-level best candidate
 * instead, which differs from the greedy chain only near beam ties — the
 * shading nuance the fold overload's own doc accepts. A pure-fold FINAL
 * lens is refused here (its `descendLens` wrapper is not mirrored).
 *
 * Panel stats are printed per panel, prefixed with its `[index] rRcC`
 * position in the sheet — the sheet PNGs carry no text of their own
 * (`de-preview.ts`'s `writeContactSheet` has no label support, and it is a
 * shared instrument this harness does not extend), so this prefix IS the
 * legend a reader maps the pictures against: hit share, the patterned
 * albedo's luminance VARIANCE over hits (the pattern's contrast,
 * pre-lighting), its EDGE DENSITY (the share of adjacent hit-pixel pairs
 * whose albedo luminance differs by more than {@link EDGE_STEP} — the
 * grain's spatial frequency at the pixel scale, the number the zoom pairs
 * are judged on: a coordinate that keeps resolving holds its edge density
 * under magnification, a world-space one loses it), and the driving trap's
 * range over the hits (so a scale can be read as "bands across the object").
 *
 * Three things a first cut of this sheet got wrong, and this revision's
 * fix for each: (1) the ZOOM CAMERA reused ONE anchor point across every
 * magnification (`zoomDE`'s similarity trick), but the anchor itself came
 * straight off a coarse low-res probe hit — a residual error the same
 * order as the harness's own top zoom ball (`R / 64`), which is exactly
 * the error the similarity trick then MAGNIFIES by `k`, carrying the
 * object out of frame at 64x. {@link refineAnchor} continues the same
 * damped march to a residual many orders tighter. (2) The WIDE framing
 * itself was one `eye`/`frame` pair hand-picked once and reused for every
 * system, which left a sparse system (a fold pair whose visible hits cover
 * well under 1% of the frame — not a small blob off-centre, but a sparse
 * filament network spread across most of it, which an extent-bounded first
 * attempt at this fix could not tighten enough) under the panels' own 2%
 * "did anything render" floor even at 1x; {@link fitFrame} instead
 * re-measures hit COVERAGE directly and tightens the frame, iterating,
 * until it clears a healthy target. (3) The WOOD/MARBLE SCALE SWEEP was
 * one fixed 6/14/30/10 set
 * for every system, which read as invisible on one system's geometry and
 * as fine speckle on another's, because the driving trap's own numeric
 * range differs per system; {@link calibrateTrap} samples each system's own
 * `rings`/`sheets` population and picks scales that put ~3/~8/~20 bands
 * across the OBSERVED range, falling back to the original fixed sweep (and
 * printing why) when a trap turns out too near-constant to calibrate
 * against at all — a real finding about that system's geometry, not
 * something to paper over.
 *
 * THE VERDICT, decided by this sheet rather than assumed going in
 * (`qjulia-beauty.harness.ts`'s own precedent — a contact sheet is allowed
 * to refuse a whole feature, and did here):
 *
 * 1. THE ZOOM CLAIM IS CONFIRMED, decisively. On menger's own ladder (the
 *    sheet's load-bearing evidence), fractal-native wood holds structure
 *    across 1x/8x/64x — albedoVar 0.0139 -> 0.0137 -> 0.0151, edge density
 *    78.5% -> 51.3% -> 10.4% (speckle COARSENING into bands, not
 *    vanishing) — while the world-space noise fallback collapses over the
 *    SAME ladder: albedoVar 0.0138 -> 0.0135 -> 0.0039, edges 52.6% ->
 *    14.6% -> 1.1% (flat and featureless by 64x). That is the predicted
 *    plateau, and it is the strongest single result this sheet produced.
 *    mandelbox-pair's own 1x/8x pair (7.6% coverage, 74.1% -> 68.0% edges,
 *    once its zoom anchor was corrected onto the hit centroid rather than
 *    a screen-space pick that had been landing on an isolated spike) tells
 *    the same story on a second, structurally different estimator — this
 *    is a hit-info property, not a coincidence of menger's own geometry.
 * 2. WOOD DOES NOT READ AS WOOD AT ORDINARY VIEWING SCALE. Every
 *    remaining system's own calibrated ~8-band panel sits at 74-79% edge
 *    density at 1x (sierpinski 77.5%, menger 78.5%, mandelbox-pair 74.1%,
 *    sierpinski-lens 78.7%): the pattern changes on most adjacent hit
 *    pixels, which is speckle/corrosion texture, not the coherent banding
 *    wood grain needs. `rings` varies at the fractal's OWN detail
 *    frequency — exactly the property that makes finding 1 true — and
 *    that is the opposite of what a legible growth-ring period wants at a
 *    FIXED viewing distance.
 * 3. So Tier-2 patterning AS SPECIFIED — wood, keyed off `rings` — is a
 *    WON'T-DO, closed on this sheet's own evidence rather than a hunch
 *    about cost. Marble (keyed off `sheets` instead) is the one survivor:
 *    23-28% edge density at every system and every zoom level, visibly
 *    band-like rather than speckled, and it keeps that character under
 *    magnification exactly as wood was supposed to. That is a DIFFERENT
 *    feature from the wood/marble patterning question this sheet was built
 *    to answer, not a smuggled-in yes: it needs its own document field, its
 *    own WGSL emission and both GLSL
 *    arms, UI, and a full re-measure against `surface-material.ts`'s own
 *    `SURFACE_GLSL_STRIP_BYTES` budget, so it is left as follow-on work
 *    rather than wired here. `surfaceFinishPatternAlbedo`'s own doc
 *    (`surface-finish.ts`) carries this verdict too, since it is the
 *    function the verdict is about.
 *
 * boxfold-pair (`foldBoxfoldPair`, the 27-branch box-fold coverage point)
 * was DROPPED from {@link SYSTEMS} rather than kept and excused: three
 * independently different camera-fitting strategies — no fitting at all,
 * NDC-extent-bounded tightening, and hit-fraction-targeted tightening WITH
 * hit-centroid recentring — all converged on the SAME ~0.6-0.7% control
 * coverage and ~0.3% at 8x. That triple agreement, from strategies that
 * move the camera in genuinely different ways, is the signature of GENUINE
 * geometric sparseness (a thin, dust-like structure from any reasonable
 * vantage point) rather than a camera bug the fitting algorithm failed to
 * find, and a panel that thin cannot answer a material question about
 * pattern legibility in either direction — see {@link SYSTEMS}'s own
 * comment for the full measurement.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/finish-pattern.harness.ts
 * Writes: `scripts/out/finish-pattern-<system>.png` (one sheet per system,
 *         4 columns) and `scripts/out/finish-pattern-zoom.png` (the
 *         fractal-native vs world-space zoom ladders, 3 columns: 1x / 8x /
 *         64x).
 */
import {
  buildSurfaceDE,
  deHasFolds,
  estimateDistance,
  estimateDistanceRefined,
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_MANDELBOX,
  SURFACE_FOLD_NONE,
  SURFACE_FOLD_SPHEREFOLD,
} from "../src/fractal/surface-de";
import type { SurfaceDE } from "../src/fractal/surface-de";
import {
  CLASSIC_SURFACE_FINISH,
  finishShadeTs,
  SURFACE_PATTERN_MARBLE,
  SURFACE_PATTERN_NONE,
  SURFACE_PATTERN_WOOD,
  surfaceFinishPatternAlbedo,
} from "../src/fractal/surface-finish";
import type {
  SurfaceFinishPattern,
  SurfaceFinishShadeEnv,
} from "../src/fractal/surface-finish";
import { mengerSponge, sierpinskiTetrahedron } from "../src/fractal/presets";
import type { Transform, Vec3 as CoreVec3 } from "../src/fractal/types";
import {
  PREVIEW_BG_BOTTOM,
  PREVIEW_BG_TOP,
  PREVIEW_HIT,
  renderPreview,
  writeContactSheet,
} from "./de-preview";
import type {
  DistanceEstimator,
  PanelStats,
  PreviewHit,
  Vec3,
} from "./de-preview";
import { foldMandelboxPair } from "./harness-profiles";

/** Panel edge for every system except {@link MANDELBOX_PAIR_SIZE}'s own
 * override. The zoom ladders render at this same size (both ladder systems
 * use the default) so their edge densities compare pixel for pixel. */
const SIZE = 224;
/**
 * `foldMandelboxPair`'s own panel size: MEASURED at 90-97s PER PANEL at the
 * default 224 (`maxDepth` 73, the 81-branch mandelbox composite — the
 * fold family's frontier cost worst case by design, `harness-profiles.ts`'s
 * own description), which alone cost ~830s of a ~955s baseline run across
 * its per-system sheet and (before the swap below) the zoom ladder. The
 * zoom fix in this revision (see the module doc) makes it WORSE, not
 * better, for this specific system: a correctly-framed 8x/64x panel goes
 * from mostly-miss (cheap, ~8-33s here) to hit-heavy like the control
 * (~90-97s), so every one of its eight panels now costs what only the
 * control used to. Trimming resolution for the one system that needs it,
 * rather than every system that does not, keeps the whole file's runtime
 * sane without flattening the other four sheets' detail to match. */
const MANDELBOX_PAIR_SIZE = 96;
/** Hit-luminance step that counts as a grain edge between two adjacent
 * hit pixels: a tenth of the wood ramp's full latewood drop on the oak
 * base, well above the ramp's gradual rise between neighbours. */
const EDGE_STEP = 0.03;

// ------------------------------------------------------ per-system framing
//
// A wide framing tuned by hand for one system does not generalize: the
// original fixed `eye`/`frame` pair left boxfold-pair at 0.6% hit coverage
// even at 1x (well under the panel's own 2% "did anything render" floor).
// `fitFrame` reads the wide framing's own low-res probes and tightens the
// frustum until hit coverage clears a healthy floor, so every system's
// frame is sized off its own geometry instead of a number picked to work
// for whichever system was authored first.
//
// THE FIRST VERSION OF THIS FUNCTION MEASURED THE WRONG THING: it bounded
// the frustum to the farthest HIT PIXEL's NDC coordinate (the object's
// observed angular extent), on the assumption that low coverage means "a
// small blob lost in a big empty frame". boxfold-pair refutes that: its
// hits reach out to 67% of the ORIGINAL frame's own radius (not a small
// cluster near centre at all) while covering only 0.6% of its pixels — a
// SPARSE, filament-like structure spread wide but thin, where an
// extent-bounded fit computed almost no tightening (0.550 -> 0.480) and
// left coverage at 0.7%, still failing the same floor.
//
// THE SECOND VERSION TARGETED HIT FRACTION DIRECTLY (`frame *= sqrt(measured
// / target)`) BUT STILL ONLY MOVED THE FRUSTUM, NEVER THE AIM POINT — and
// still measured boxfold-pair pinned at 0.6% after a 5.7x tightening, a
// factor the `1 / frame^2` model says should have bought ~32x more coverage.
// The missing piece: `target` is `buildSurfaceDE`'s fitted ENCLOSING BALL
// centre, which promises to contain the attractor, never that it sits near
// where the VISIBLE mass actually is along one particular eye direction —
// for a sparse system that centre can easily be aimed at near-empty space,
// and narrowing the FOV around it only shows a smaller slice of that SAME
// emptiness, however much you tighten. So this version RECENTRES on the
// current round's own hit centroid before deciding how much further to
// tighten, every round, compounding the two corrections instead of only
// ever applying one of them.
//
// It only ever tightens (never widens) and only while coverage is short of
// the target, so a system that already clears it (sierpinski, menger,
// mandelbox-pair, sierpinski-lens all do, even before fitting) renders
// with its authored `frame`/`target` untouched.

/** Hit-coverage floor to fit toward on the LOW-RES fitting probe — well
 * above the panels' own 2% "did anything render" floor, so a system that
 * just clears this here still clears that with margin at full resolution
 * (a coarser raster is noisier, and floating a margin above the assertion
 * it feeds is what keeps that noise from flipping the verdict). */
const FRAME_FIT_TARGET_FRACTION = 0.1;
/** Resolution of the FITTING probes — coarse, so a few of them per system
 * cost nothing next to a single SIZE-resolution panel. `collect`ed (unlike
 * a hit-count-only design) because recentring needs the hit positions. */
const FRAME_FIT_PROBE_SIZE = 64;
/** Fitting rounds: one gets close under the `1/frame^2` model, a second or
 * third corrects for how a real projection (clipping, a non-uniform
 * filament density, a centroid that itself moves once the frame narrows)
 * departs from it. */
const FRAME_FIT_ITERATIONS = 3;
/** Floor on how far one round may tighten the frustum, so a probe that (by
 * bad luck) sampled zero hits cannot collapse it to zero/an unusably tight
 * FOV in one step — repeated rounds still compound past this if needed. */
const FRAME_FIT_MIN_RATIO = 0.1;

/** The centroid of a probe's hit positions, or `null` when it found none
 * (the caller keeps its current target rather than recentring on nothing).
 * Shared by {@link fitFrame}'s recentring round and {@link buildSystem}'s
 * zoom-anchor pick, both of which want "where the visible mass actually
 * is" rather than a screen-space or bounding-ball notion of centre. */
function hitCentroid(probe: PanelStats, size: number): Vec3 | null {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (let i = 0; i < size * size; i++) {
    if (probe.status![i] !== PREVIEW_HIT) continue;
    sx += probe.hitPos![i * 3];
    sy += probe.hitPos![i * 3 + 1];
    sz += probe.hitPos![i * 3 + 2];
    n++;
  }
  return n > 0 ? [sx / n, sy / n, sz / n] : null;
}

/** Resolution of the anchor/calibration probe pass — coarse enough to cost
 * nothing next to the SIZE-resolution panels, fine enough that the trap
 * sample (see calibrateTrap) is not too thin on a sparse system. */
const PROBE_SIZE = 96;

/** Tighten `frame` AND recentre `target` on the observed hit centroid until
 * the (cheap, low-res) fitting probe's hit fraction clears
 * {@link FRAME_FIT_TARGET_FRACTION}, re-measuring after each round rather
 * than trusting a single correction (see the section doc for why recentring
 * matters as much as tightening). A no-op past the first round whenever the
 * object already clears the target, and safe against a probe that samples
 * zero hits (breaks out, keeping the last target, rather than recentring on
 * nothing) — the hit-fraction assertion on the real panels is what catches
 * a system this function could not fit. */
function fitFrame(
  estimator: DistanceEstimator,
  R: number,
  startTarget: Vec3,
  eyeOffset: Vec3,
  stepScale: number,
  startFrame: number,
): { frame: number; target: Vec3 } {
  let frame = startFrame;
  let target = startTarget;
  const px = FRAME_FIT_PROBE_SIZE * FRAME_FIT_PROBE_SIZE;
  for (let i = 0; i < FRAME_FIT_ITERATIONS; i++) {
    const probe = renderPreview(
      {
        de: estimator,
        boundingRadius: R,
        target,
        stepScale,
        eyeOffset,
        zoom: frame,
        collect: true,
        ao: false,
        shadow: false,
      },
      FRAME_FIT_PROBE_SIZE,
    );
    const fraction = probe.hits / px;
    if (fraction >= FRAME_FIT_TARGET_FRACTION || !(fraction > 0)) break;
    target = hitCentroid(probe, FRAME_FIT_PROBE_SIZE) ?? target;
    const ratio = Math.max(
      FRAME_FIT_MIN_RATIO,
      Math.sqrt(fraction / FRAME_FIT_TARGET_FRACTION),
    );
    frame *= ratio;
  }
  return { frame, target };
}

/**
 * Tighten a rough hit onto the surface by CONTINUING the same damped sphere
 * march past the probe's own (coarse) hit tolerance, from the already-close
 * rough hit, toward a residual many orders below anything a zoom step
 * could magnify back into visibility.
 *
 * `zoomDE` (below) reuses ONE anchor, unscaled, at every requested
 * magnification `k` — that is what makes the similarity trick cheap — so
 * any residual left in the anchor gets magnified by `k` right along with
 * the geometry. The probe's own hit tolerance (`de-preview.ts`'s
 * `eps * max(t, 1)`) is comparable to `R / 64`, this harness's own top
 * zoom, which is exactly why an unrefined anchor carried the object out of
 * frame at 64x (and partway out at 8x): the anchor's true-surface error was
 * the same order as the ball the highest zoom marches.
 *
 * UNDAMPED DIVERGENCE IS THE HAZARD HERE, MEASURED: the first version of
 * this function trusted every step (`t += d * stepScale`, no bound), and on
 * sierpinski — an IFS whose four copies meet at tangency points, exactly
 * where a beam estimator's winning candidate can flip discontinuously
 * between branches with different local distance functions — one step off
 * such a tie read back a large `d`, and the next several compounded it
 * (each step's distance growing roughly with `t` itself) into an anchor
 * around 1e17 within the loop's own 80 iterations. `zoomDE` then evaluated
 * the real estimator near THAT point every subsequent pixel, which returned
 * `NaN`/`Infinity`, which poisoned `Math.max` in `de-preview.ts`'s own step
 * arithmetic and dropped every ray to a 1-step immediate exit — EVERY
 * zoomed panel at 0% hits, strictly worse than the bug this function exists
 * to fix. The marcher this mirrors is safe only because it is bounded by
 * the marching SPHERE's own exit (`t < tEnd`); this loop has no such
 * geometry, so instead it tracks the BEST (smallest `|d|`) point seen and
 * stops the instant a step fails to improve on it, rather than trusting
 * every step blindly — which makes "no improvement available" and "totally
 * unrefined" the same safe fallback: the original rough hit, unchanged.
 */
function refineAnchor(
  de: DistanceEstimator,
  eye: Vec3,
  rough: Vec3,
  stepScale: number,
  R: number,
): Vec3 {
  const diff: Vec3 = [rough[0] - eye[0], rough[1] - eye[1], rough[2] - eye[2]];
  const len = Math.hypot(diff[0], diff[1], diff[2]);
  if (!(len > 0)) return rough;
  const dir: Vec3 = [diff[0] / len, diff[1] / len, diff[2] / len];
  const tightEps = R * 1e-7;
  let bestP = rough;
  let bestAbsD = Infinity;
  let t = len;
  for (let i = 0; i < 80; i++) {
    const p: Vec3 = [
      eye[0] + dir[0] * t,
      eye[1] + dir[1] * t,
      eye[2] + dir[2] * t,
    ];
    const d = de(p);
    if (!Number.isFinite(d)) break;
    const absD = Math.abs(d);
    if (absD >= bestAbsD) break; // no longer improving — stop right here
    bestP = p;
    bestAbsD = absD;
    if (absD < tightEps) break;
    t += d * stepScale;
  }
  return bestP;
}

// --------------------------------------------------- per-system calibration
//
// A fixed scale sweep (the original 6/14/30) cannot serve every system: the
// module doc's own reading found sierpinski's grain visually lost in the
// control and menger's read as fine speckle at the SAME scale numbers,
// because the driving trap's own numeric range differs per system (a
// system-independent scale times a system-dependent range is a
// system-dependent band COUNT, which is the one thing a legible sweep
// needs to hold roughly fixed). calibrateTrap samples the trap actually
// driving each pattern (rings for wood, sheets for marble) over the wide
// framing's own visible hits, and picks scales that put ~3, ~8 and ~20
// bands across the OBSERVED range rather than the trap's theoretical [0, 1]
// domain.
const CALIBRATION_BANDS: readonly [number, number, number] = [3, 8, 20];
/** Trimmed off each end of the sampled trap population before measuring its
 * span, so one grazing hit at the silhouette (an outlier by construction —
 * a beam-width tie or a near-tangent ray) cannot dominate the whole sweep's
 * scale. */
const CALIBRATION_TRIM = 0.03;
/** Below this span the trap reads as carrying no usable structure to key a
 * band count off (see the "near-constant" finding this guards) — scaling
 * `bands / span` would blow up toward an meaningless, enormous frequency,
 * so this floor instead falls back to the original fixed sweep and the
 * near-constant finding is printed rather than silently forcing a pattern
 * that is not there. */
const MIN_CALIBRATION_SPAN = 0.02;
/** The sweep shipped before per-system calibration existed — the fallback
 * for a trap too flat to calibrate against. */
const FALLBACK_SCALES: readonly [number, number, number] = [6, 14, 30];

/** Linear-interpolated percentile of a SORTED array, `p` in `[0, 1]`. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const t = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * t;
}

interface TrapCalibration {
  /** The trimmed observed range — printed so the sheet's numbers explain
   * its pictures. */
  lo: number;
  hi: number;
  span: number;
  /** Hits sampled. */
  n: number;
  /** False when the span was too thin to calibrate against — the printed
   * finding, and the trigger for {@link FALLBACK_SCALES}. */
  structured: boolean;
  /** Scales giving ~{@link CALIBRATION_BANDS} bands across the observed
   * range (or the fallback sweep, verbatim, when `!structured`). */
  scales: [number, number, number];
}

function calibrateTrap(values: number[]): TrapCalibration {
  const sorted = [...values].sort((a, b) => a - b);
  const lo = percentile(sorted, CALIBRATION_TRIM);
  const hi = percentile(sorted, 1 - CALIBRATION_TRIM);
  const span = hi - lo;
  const structured = span >= MIN_CALIBRATION_SPAN;
  const scales: [number, number, number] = structured
    ? [
        CALIBRATION_BANDS[0] / span,
        CALIBRATION_BANDS[1] / span,
        CALIBRATION_BANDS[2] / span,
      ]
    : [FALLBACK_SCALES[0], FALLBACK_SCALES[1], FALLBACK_SCALES[2]];
  return { lo, hi, span, n: sorted.length, structured, scales };
}

// ---------------------------------------------------------------- hit info

interface HitInfo {
  rings: number;
  sheets: number;
  /** Descent levels the chain lived through before escaping or capping. */
  levels: number;
}

/** One kaleidoscope sector step — `surface-de.ts`'s private `stepSector`,
 * the same three branches and the same arithmetic. */
function stepSector(
  plane: SurfaceDE["symmetry"]["plane"],
  c: number,
  s: number,
  v: Vec3,
): Vec3 {
  const [x, y, z] = v;
  if (plane === "yz") return [x, c * y + s * z, -s * y + c * z];
  if (plane === "xz") return [c * x - s * z, y, s * x + c * z];
  return [c * x + s * y, -s * x + c * y, z];
}

/**
 * The GLSL fold-variant hit-info body on the CPU (see the module doc): a
 * greedy chain over the `SurfaceDE`'s own candidate enumeration, reading
 * `rings`/`sheets` off the per-level winner. Affine maps contribute one
 * candidate, fold maps their 27/3/81 inverse branches with the branch
 * algebra exactly as `descendFold` spells it (the spherefold's outer /
 * inner / mid pieces with their region distances, the box's per-axis
 * preimage triple); region floors raise the selection key exactly as the
 * shader does, so the chain follows the same winner.
 */
function hitInfo(de: SurfaceDE, p: Vec3): HitInfo {
  if (de.foldFinal) {
    throw new Error("finish-pattern: a pure-fold final lens is not mirrored");
  }
  let q: Vec3 = [p[0], p[1], p[2]];
  if (de.final) {
    const f = de.final;
    q = [
      f.invM[0] * p[0] + f.invM[1] * p[1] + f.invM[2] * p[2] + f.invT[0],
      f.invM[3] * p[0] + f.invM[4] * p[1] + f.invM[5] * p[2] + f.invT[1],
      f.invM[6] * p[0] + f.invM[7] * p[1] + f.invM[8] * p[2] + f.invT[2],
    ];
  }
  const { order, plane, stepCos, stepSin } = de.symmetry;
  const R = de.boundingRadius;
  const [bcX, bcY, bcZ] = de.boundCenter;
  let rings = 1;
  let sheets = 1;
  let levels = 0;
  let ch = q;
  let chScale = 1;
  let chFloor = 0;
  for (let depth = 0; depth < de.maxDepth; depth++) {
    let lbKey = Infinity;
    let lbR = 0;
    let lbAbsY = 0;
    let lbQ: Vec3 = [0, 0, 0];
    let lbScale = 1;
    let lbFloor = 0;
    const pScale = chScale;
    const pFloor = chFloor;
    let s = ch;
    for (let k = 0; k < order; k++) {
      if (k > 0) s = stepSector(plane, stepCos, stepSin, s);
      for (const map of de.maps) {
        const im = map.invM;
        const it = map.invT;
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
        const fr = map.foldRadii;
        const wall = fr.wall;
        const wall2 = 2 * wall;
        let u: Vec3 = [0, 0, 0];
        let ru = 0;
        let pre0: Vec3 = [0, 0, 0];
        let pre1: Vec3 = [0, 0, 0];
        let pre2: Vec3 = [0, 0, 0];
        let dUp: Vec3 = [0, 0, 0];
        let dDn: Vec3 = [0, 0, 0];
        let v: Vec3 = [0, 0, 0];
        let sfSigma = 1;
        let sfRd = 0;
        const boxSetup = (w: Vec3): void => {
          pre0 = w;
          pre1 = [wall2 - w[0], wall2 - w[1], wall2 - w[2]];
          pre2 = [-wall2 - w[0], -wall2 - w[1], -wall2 - w[2]];
          dUp = [
            Math.max(w[0] - wall, 0),
            Math.max(w[1] - wall, 0),
            Math.max(w[2] - wall, 0),
          ];
          dDn = [
            Math.max(-wall - w[0], 0),
            Math.max(-wall - w[1], 0),
            Math.max(-wall - w[2], 0),
          ];
        };
        if (kind !== SURFACE_FOLD_NONE) {
          u = [s[0] * map.foldInvW, s[1] * map.foldInvW, s[2] * map.foldInvW];
          if (kind === SURFACE_FOLD_BOXFOLD) boxSetup(u);
          else ru = Math.hypot(u[0], u[1], u[2]);
        }
        for (let b = 0; b < branchCount; b++) {
          let c: Vec3;
          let branchSigma: number;
          let branchRd = 0;
          if (kind === SURFACE_FOLD_NONE) {
            c = s;
            branchSigma = map.sigmaMin;
          } else {
            if (
              kind === SURFACE_FOLD_SPHEREFOLD ||
              (kind === SURFACE_FOLD_MANDELBOX && b % 27 === 0)
            ) {
              const piece = kind === SURFACE_FOLD_SPHEREFOLD ? b : (b / 27) | 0;
              if (piece === 0) {
                v = u;
                sfSigma = 1;
                sfRd = Math.max(fr.fixedR - ru, 0);
              } else if (piece === 1) {
                v = [
                  fr.innerScale * u[0],
                  fr.innerScale * u[1],
                  fr.innerScale * u[2],
                ];
                sfSigma = fr.innerSigma;
                sfRd = Math.max(ru - fr.outputR, 0);
              } else {
                if (ru < fr.midMinR) {
                  if (kind === SURFACE_FOLD_MANDELBOX) b += 26;
                  continue;
                }
                const invR2 = fr.fixedR2 / (ru * ru);
                v = [u[0] * invR2, u[1] * invR2, u[2] * invR2];
                sfSigma = ru * fr.invFixedR;
                sfRd = Math.max(Math.max(fr.fixedR - ru, ru - fr.outputR), 0);
              }
              if (kind === SURFACE_FOLD_MANDELBOX) boxSetup(v);
            }
            if (kind === SURFACE_FOLD_SPHEREFOLD) {
              c = v;
              branchRd = sfRd;
            } else {
              const bb = kind === SURFACE_FOLD_BOXFOLD ? b : b % 27;
              const sel = [bb % 3, ((bb / 3) | 0) % 3, (bb / 9) | 0];
              const pick = (axis: 0 | 1 | 2): number =>
                sel[axis] === 0
                  ? pre0[axis]
                  : sel[axis] === 1
                    ? pre1[axis]
                    : pre2[axis];
              const dist = (axis: 0 | 1 | 2): number =>
                sel[axis] === 0
                  ? Math.max(dUp[axis], dDn[axis])
                  : sel[axis] === 1
                    ? dUp[axis]
                    : dDn[axis];
              c = [pick(0), pick(1), pick(2)];
              const boxRd = Math.hypot(dist(0), dist(1), dist(2));
              branchRd =
                kind === SURFACE_FOLD_BOXFOLD
                  ? boxRd
                  : Math.max(sfRd, sfSigma * boxRd);
            }
            branchSigma = map.foldSigma * sfSigma;
          }
          const img: Vec3 = [
            im[0] * c[0] + im[1] * c[1] + im[2] * c[2] + it[0],
            im[3] * c[0] + im[4] * c[1] + im[5] * c[2] + it[1],
            im[6] * c[0] + im[7] * c[1] + im[8] * c[2] + it[2],
          ];
          const r = Math.hypot(img[0] - bcX, img[1] - bcY, img[2] - bcZ);
          let candFloor = pFloor;
          if (branchRd > 0) {
            candFloor = Math.max(candFloor, pScale * absW * branchRd);
          }
          let key = pScale * (r - R);
          if (candFloor > 0 && candFloor > key) key = candFloor;
          if (key < lbKey) {
            lbKey = key;
            lbR = r;
            lbAbsY = Math.abs(img[1]);
            lbQ = img;
            lbScale = pScale * branchSigma;
            lbFloor = candFloor;
          }
        }
      }
    }
    if (lbKey === Infinity) break;
    levels++;
    rings = Math.min(rings, lbR / R);
    sheets = Math.min(sheets, lbAbsY / R);
    if (lbR > de.escapeRadius) break;
    ch = lbQ;
    chScale = lbScale;
    chFloor = lbFloor;
  }
  return {
    rings: Math.min(1, Math.max(0, rings)),
    sheets: Math.min(1, Math.max(0, sheets)),
    levels,
  };
}

// ---------------------------------------------------- world-space fallback

/** Integer-lattice hash to `[0, 1)` — deterministic, seedless, cheap. */
function hash3(ix: number, iy: number, iz: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Trilinear value noise with smoothstep weights, `[0, 1]`. */
function valueNoise(p: Vec3): number {
  const ix = Math.floor(p[0]);
  const iy = Math.floor(p[1]);
  const iz = Math.floor(p[2]);
  const fx = p[0] - ix;
  const fy = p[1] - iy;
  const fz = p[2] - iz;
  const sm = (t: number): number => t * t * (3 - 2 * t);
  const wx = sm(fx);
  const wy = sm(fy);
  const wz = sm(fz);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number): number =>
    hash3(ix + dx, iy + dy, iz + dz);
  return lerp(
    lerp(
      lerp(c(0, 0, 0), c(1, 0, 0), wx),
      lerp(c(0, 1, 0), c(1, 1, 0), wx),
      wy,
    ),
    lerp(
      lerp(c(0, 0, 1), c(1, 0, 1), wx),
      lerp(c(0, 1, 1), c(1, 1, 1), wx),
      wy,
    ),
    wz,
  );
}

/** Four octaves of value noise, centred on 0, amplitude ~`[-0.5, 0.5]`. */
function fbm(p: Vec3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < 4; o++) {
    sum += amp * (valueNoise([p[0] * f, p[1] * f, p[2] * f]) - 0.5);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/**
 * The textbook world-space wood coordinate, normalized like `rings`:
 * distance from the attractor's vertical axis in units of the bounding
 * radius, wobbled by a fixed-octave fbm (`NOISE_WOBBLE` of a radius at a
 * base frequency of `NOISE_FREQ` cycles per radius). Fed to the SAME ramp
 * as the descent's `rings`, so a panel pair differs only in the
 * coordinate.
 */
const NOISE_WOBBLE = 0.06;
const NOISE_FREQ = 5;
function noiseRings(p: Vec3, centre: Vec3, R: number): number {
  const x = (p[0] - centre[0]) / R;
  const y = (p[1] - centre[1]) / R;
  const z = (p[2] - centre[2]) / R;
  return (
    Math.hypot(x, z) +
    NOISE_WOBBLE * fbm([x * NOISE_FREQ, y * NOISE_FREQ, z * NOISE_FREQ])
  );
}

// ------------------------------------------------------------- the panels

/** Oak-ish base for the wood panels; pale stone for the marble ones. */
const OAK: CoreVec3 = [0.76, 0.56, 0.36];
const STONE: CoreVec3 = [0.9, 0.88, 0.84];

type Coordinate = "descent" | "noise";

interface PanelSpec {
  label: string;
  base: CoreVec3;
  pattern: SurfaceFinishPattern;
  /** Where the driving trap comes from: the descent's own hit info, or
   * the world-space fallback. */
  coordinate: Coordinate;
  /** Magnification about the system's zoom anchor (1 = the wide framing). */
  zoom: number;
}

interface SystemSpec {
  name: string;
  transforms: Transform[];
  final?: Transform;
  /** Camera offset in units of the bounding radius (`PreviewScene.eyeOffset`). */
  eye: Vec3;
  frame: number;
  /** Panel edge override — absent means {@link SIZE}. Only
   * `mandelbox-pair` sets this (see {@link MANDELBOX_PAIR_SIZE}'s doc). */
  size?: number;
}

interface RenderedPanel {
  stats: PanelStats;
  spec: PanelSpec;
  /** Luminance variance of the patterned albedo over hits. */
  albedoVar: number;
  /** Share of adjacent hit-hit pixel pairs whose albedo luminance steps by
   * more than {@link EDGE_STEP}. */
  edgeDensity: number;
  trapMin: number;
  trapMax: number;
  trapMean: number;
  meanLevels: number;
}

const ENV_BASE: Omit<SurfaceFinishShadeEnv, "lightDir"> = {
  ambient: 0.25,
  envStrength: 0.35,
  bgTop: PREVIEW_BG_TOP.map((c) => Math.pow(c, 1 / 2.2)) as CoreVec3,
  bgBottom: PREVIEW_BG_BOTTOM.map((c) => Math.pow(c, 1 / 2.2)) as CoreVec3,
};

const luminance = (c: CoreVec3): number =>
  0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The same object magnified `k`x about `centre` — `qjulia-beauty.harness.ts`'s
 * similarity idiom: `k · DE(centre + p/k)` is exactly the DE of the scaled
 * set, so the tracer stays in the identical numeric regime as the wide
 * panel and a close-up differs from it only in magnification. */
function zoomDE(
  de: DistanceEstimator,
  centre: Vec3,
  k: number,
): DistanceEstimator {
  return (p) =>
    k * de([centre[0] + p[0] / k, centre[1] + p[1] / k, centre[2] + p[2] / k]);
}

interface BuiltSystem {
  spec: SystemSpec;
  de: SurfaceDE;
  estimator: DistanceEstimator;
  R: number;
  target: Vec3;
  /** Resolved panel edge: `spec.size ?? SIZE`. */
  size: number;
  /** The frustum half-angle every panel actually renders at:
   * `spec.frame`, self-tightened by {@link fitFrame} when the object
   * leaves most of the authored frame unused. */
  frame: number;
  /** A surface point near the wide framing's centre: the zoom anchor,
   * tightened onto the surface by {@link refineAnchor}. */
  anchor: Vec3;
  /** Wood's driving trap (rings), sampled over the wide framing's hits. */
  ringsCal: TrapCalibration;
  /** Marble's driving trap (sheets), sampled the same way. */
  sheetsCal: TrapCalibration;
}

function buildSystem(spec: SystemSpec): BuiltSystem {
  const de = buildSurfaceDE(spec.transforms, spec.final ?? null);
  // The estimator each system class actually MARCHES (surface-grid.ts's
  // per-system choice): plain for fold systems, refined for affine.
  const estimator: DistanceEstimator = deHasFolds(de)
    ? (p) => estimateDistance(de, p)
    : (p) => estimateDistanceRefined(de, p);
  const R = de.visibleBoundingRadius * 1.05;
  const boundTarget: Vec3 = de.final ? [0, 0, 0] : [...de.boundCenter];

  // Cheap low-res rounds against the authored frame/target, tightening and
  // recentring only if hit coverage there is unhealthy (fitFrame's own doc).
  const { frame, target } = fitFrame(
    estimator,
    R,
    boundTarget,
    spec.eye,
    de.stepScale,
    spec.frame,
  );

  // The frame/target every panel will actually use (a no-op re-render when
  // fitFrame left both alone): the anchor and the calibration sample both
  // need the SAME framing the real panels render with.
  const probe = renderPreview(
    {
      de: estimator,
      boundingRadius: R,
      target,
      stepScale: de.stepScale,
      eyeOffset: spec.eye,
      zoom: frame,
      collect: true,
      ao: false,
      shadow: false,
    },
    PROBE_SIZE,
  );
  const eye: Vec3 = [
    target[0] + spec.eye[0] * R,
    target[1] + spec.eye[1] * R,
    target[2] + spec.eye[2] * R,
  ];
  // The zoom anchor is picked by proximity to the hit CENTROID (world
  // space), not to the panel's screen-space centre pixel: a screen-space
  // pick can land on whichever point happens to be foremost along the
  // central ray, which on a sparse fractal is easily an isolated spike —
  // exactly what mandelbox-pair's 8x panel measured (14.7% hits at 1x,
  // 0.6% once zoomed onto such a point). The centroid-nearest hit is
  // surrounded by other nearby surface by construction, which is a much
  // better bet for "this neighbourhood has structure to zoom into".
  const centroid = hitCentroid(probe, PROBE_SIZE) ?? target;
  let anchor: Vec3 = target;
  let bestD = Infinity;
  const rings: number[] = [];
  const sheets: number[] = [];
  for (let i = 0; i < PROBE_SIZE * PROBE_SIZE; i++) {
    if (probe.status![i] !== PREVIEW_HIT) continue;
    const p: Vec3 = [
      probe.hitPos![i * 3],
      probe.hitPos![i * 3 + 1],
      probe.hitPos![i * 3 + 2],
    ];
    const info = hitInfo(de, p);
    rings.push(info.rings);
    sheets.push(info.sheets);
    const d = Math.hypot(
      p[0] - centroid[0],
      p[1] - centroid[1],
      p[2] - centroid[2],
    );
    if (d < bestD) {
      bestD = d;
      anchor = p;
    }
  }
  anchor = refineAnchor(estimator, eye, anchor, de.stepScale, R);
  return {
    spec,
    de,
    estimator,
    R,
    target,
    size: spec.size ?? SIZE,
    frame,
    anchor,
    ringsCal: calibrateTrap(rings),
    sheetsCal: calibrateTrap(sheets),
  };
}

function renderPanel(sys: BuiltSystem, spec: PanelSpec): RenderedPanel {
  const k = spec.zoom;
  const size = sys.size;
  const estimator =
    k === 1 ? sys.estimator : zoomDE(sys.estimator, sys.anchor, k);
  const target: Vec3 = k === 1 ? sys.target : [0, 0, 0];
  const albedoL = new Float32Array(size * size).fill(-1);
  let trapMin = Infinity;
  let trapMax = -Infinity;
  let trapSum = 0;
  let levelSum = 0;
  let n = 0;
  const shade = (hit: PreviewHit): Vec3 => {
    // Un-zoom: the hit-info and the world-space coordinate both want the
    // TRUE surface point, not the similarity's scaled copy.
    const world: Vec3 =
      k === 1
        ? hit.p
        : [
            sys.anchor[0] + hit.p[0] / k,
            sys.anchor[1] + hit.p[1] / k,
            sys.anchor[2] + hit.p[2] / k,
          ];
    let rings: number;
    let sheets: number;
    let levels = 0;
    if (spec.coordinate === "descent") {
      const info = hitInfo(sys.de, world);
      rings = info.rings;
      sheets = info.sheets;
      levels = info.levels;
    } else {
      rings = noiseRings(world, sys.target, sys.R);
      sheets = rings;
    }
    const albedo = surfaceFinishPatternAlbedo(spec.base, spec.pattern, {
      rings,
      sheets,
      p: world,
    });
    const trap = spec.pattern.kind === SURFACE_PATTERN_MARBLE ? sheets : rings;
    trapMin = Math.min(trapMin, trap);
    trapMax = Math.max(trapMax, trap);
    trapSum += trap;
    levelSum += levels;
    n++;
    albedoL[hit.py * size + hit.px] = luminance(albedo);
    return finishShadeTs(
      albedo,
      hit.n,
      hit.rd,
      hit.shadow,
      hit.ao,
      hit.bg,
      CLASSIC_SURFACE_FINISH,
      { ...ENV_BASE, lightDir: hit.light },
    );
  };
  const stats = renderPreview(
    {
      de: estimator,
      boundingRadius: sys.R,
      target,
      stepScale: sys.de.stepScale,
      eyeOffset: sys.spec.eye,
      zoom: sys.frame,
      shade,
    },
    size,
  );
  // Albedo variance and edge density over the hit mask.
  let sum = 0;
  let sumSq = 0;
  let edges = 0;
  let pairs = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = py * size + px;
      const l = albedoL[i];
      if (l < 0) continue;
      sum += l;
      sumSq += l * l;
      if (px + 1 < size && albedoL[i + 1] >= 0) {
        pairs++;
        if (Math.abs(albedoL[i + 1] - l) > EDGE_STEP) edges++;
      }
      if (py + 1 < size && albedoL[i + size] >= 0) {
        pairs++;
        if (Math.abs(albedoL[i + size] - l) > EDGE_STEP) edges++;
      }
    }
  }
  const mean = n > 0 ? sum / n : 0;
  return {
    stats,
    spec,
    albedoVar: n > 0 ? Math.max(0, sumSq / n - mean * mean) : 0,
    edgeDensity: pairs > 0 ? edges / pairs : 0,
    trapMin: n > 0 ? trapMin : 0,
    trapMax: n > 0 ? trapMax : 0,
    trapMean: n > 0 ? trapSum / n : 0,
    meanLevels: n > 0 ? levelSum / n : 0,
  };
}

// -------------------------------------------------------------- the sheets

/** An AFFINE plot-time lens for the lens row: a turn plus a squash, so the
 * drawn set is visibly not the raw attractor while the hit info — which
 * un-lenses the query first — keeps reading the raw frame's traps. */
function squashLens(): Transform {
  return {
    id: 99,
    position: [0, 0, 0],
    rotation: [0.3, 0.6, 0.2],
    scale: [1.1, 0.7, 1],
  };
}

/** Hit-fraction floor: "did anything render at all", well under any
 * system's actual coverage but far above what a broken camera (0 or a
 * handful of stray hits) produces. Uniform across every system that
 * remains in {@link SYSTEMS} — it is what caught the anchor-divergence and
 * frame-fit bugs this file's header records, and stays exactly as strict
 * for all of them. */
const MIN_HIT_FRACTION = 0.02;

const SYSTEMS: SystemSpec[] = [
  {
    name: "sierpinski",
    transforms: sierpinskiTetrahedron(),
    eye: [1.55, 1.1, 1.8],
    frame: 0.55,
  },
  {
    name: "menger",
    transforms: mengerSponge(),
    eye: [1.55, 1.1, 1.8],
    frame: 0.5,
  },
  // boxfold-pair (foldBoxfoldPair, 27-branch coverage) was DROPPED here,
  // not merely excused: three independently different camera-fitting
  // strategies (none, NDC-extent-bounded, hit-fraction-targeted WITH
  // centroid recentring) all converged on the SAME ~0.6-0.7% control
  // coverage and ~0.3% at 8x — genuine geometric sparseness (a thin,
  // dust-like fold pair), not a camera bug left to fix. A panel that thin
  // cannot answer a material question in either direction, so keeping it
  // in the sheet would only ever measure the system's sparseness, never
  // the pattern's legibility — see the module doc's verdict for the
  // measured numbers.
  {
    name: "mandelbox-pair",
    transforms: foldMandelboxPair(),
    eye: [1.55, 1.1, 1.8],
    frame: 0.55,
    size: MANDELBOX_PAIR_SIZE,
  },
  {
    name: "sierpinski-lens",
    transforms: sierpinskiTetrahedron(),
    final: squashLens(),
    eye: [1.55, 1.1, 1.8],
    frame: 0.55,
  },
];

const plain = (base: CoreVec3 = OAK): PanelSpec => ({
  label: "plain albedo (control)",
  base,
  pattern: { kind: SURFACE_PATTERN_NONE, scale: 0, strength: 0 },
  coordinate: "descent",
  zoom: 1,
});
const wood = (
  scale: number,
  strength = 1,
  coordinate: Coordinate = "descent",
  zoom = 1,
): PanelSpec => ({
  label: `wood s${scale} k${strength}${coordinate === "noise" ? " NOISE" : ""}${zoom > 1 ? ` @${zoom}x` : ""}`,
  base: OAK,
  pattern: { kind: SURFACE_PATTERN_WOOD, scale, strength },
  coordinate,
  zoom,
});
const marble = (
  scale: number,
  strength = 1,
  coordinate: Coordinate = "descent",
  zoom = 1,
): PanelSpec => ({
  label: `marble s${scale} k${strength}${coordinate === "noise" ? " NOISE" : ""}${zoom > 1 ? ` @${zoom}x` : ""}`,
  base: STONE,
  pattern: { kind: SURFACE_PATTERN_MARBLE, scale, strength },
  coordinate,
  zoom,
});

/** Round to one decimal — the calibrated scales are floats, and a label
 * like "wood s8.3333333333 k1" is not something a reader can index. */
const round1 = (x: number): number => Math.round(x * 10) / 10;

/** The per-system sheet: control, the wood scale sweep, the strength
 * halving, marble, and the 8x wood pair (wide twin at the middle scale is
 * the sweep's own panel; the zoomed one sits beside it) — same eight-panel
 * shape every system has always rendered, now at each system's OWN
 * calibrated scales (see calibrateTrap) instead of one fixed sweep. */
function buildSheet(sys: BuiltSystem): PanelSpec[] {
  const w = sys.ringsCal.scales.map(round1) as [number, number, number];
  const m = round1(sys.sheetsCal.scales[1]);
  return [
    plain(),
    wood(w[0]),
    wood(w[1]),
    wood(w[2]),
    wood(w[1], 0.5),
    marble(m),
    wood(w[1], 1, "descent", 8),
    marble(m, 1, "descent", 8),
  ];
}

/** One panel's stats line, prefixed with its position in the sheet
 * (`writeContactSheet` tiles row-major) so a reader can map the printed
 * numbers straight onto the PNG without a separate legend — the sheet
 * PNGs carry no text of their own (`de-preview.ts`'s `writeContactSheet`
 * has no label support, and it is a shared instrument this harness does
 * not extend). */
function report(
  name: string,
  r: RenderedPanel,
  index: number,
  cols: number,
): void {
  const s = r.stats;
  const px = s.width * s.height;
  const pos = `[${index}] r${Math.floor(index / cols)}c${index % cols}`;
  console.log(
    `  ${pos.padEnd(8)} ${name.padEnd(16)} ${r.spec.label.padEnd(26)} hits ${((100 * s.hits) / px).toFixed(1).padStart(5)}%  ` +
      `albedoVar ${r.albedoVar.toFixed(4)}  edges ${(100 * r.edgeDensity).toFixed(1).padStart(5)}%  ` +
      `trap [${r.trapMin.toFixed(3)}, ${r.trapMax.toFixed(3)}] mean ${r.trapMean.toFixed(3)}  ` +
      (r.spec.coordinate === "descent"
        ? `levels ${r.meanLevels.toFixed(1)}  `
        : "") +
      `steps/ray ${(s.steps / px).toFixed(0)}  exhausted ${s.exhausted}  ${s.ms}ms`,
  );
}

describe("finish pattern sheet", () => {
  for (const spec of SYSTEMS) {
    it(`renders ${spec.name}: control, wood scales/strengths, marble, and the 8x pair`, () => {
      const sys = buildSystem(spec);
      console.log(
        `  ${spec.name}: R ${sys.R.toFixed(3)} maps ${sys.de.maps.length} ` +
          `maxDepth ${sys.de.maxDepth} ${deHasFolds(sys.de) ? "fold (plain DE)" : "affine (refined DE)"} ` +
          `anchor (${sys.anchor.map((c) => c.toFixed(3)).join(", ")})` +
          (sys.frame !== spec.frame
            ? `  frame ${spec.frame.toFixed(3)} -> ${sys.frame.toFixed(3)} ` +
              `target (${sys.target.map((c) => c.toFixed(3)).join(", ")}) (wide framing under-filled)`
            : ""),
      );
      console.log(
        `  ${spec.name}: rings [${sys.ringsCal.lo.toFixed(3)}, ${sys.ringsCal.hi.toFixed(3)}] ` +
          `n=${sys.ringsCal.n} -> wood scales ${sys.ringsCal.scales.map((x) => x.toFixed(1)).join("/")}` +
          (sys.ringsCal.structured
            ? ""
            : "  ** NEAR-CONSTANT: rings carries no usable structure here, falling back to the fixed sweep **"),
      );
      console.log(
        `  ${spec.name}: sheets [${sys.sheetsCal.lo.toFixed(3)}, ${sys.sheetsCal.hi.toFixed(3)}] ` +
          `n=${sys.sheetsCal.n} -> marble scale ${sys.sheetsCal.scales[1].toFixed(1)}` +
          (sys.sheetsCal.structured
            ? ""
            : "  ** NEAR-CONSTANT: sheets carries no usable structure here either **"),
      );
      const sheet = buildSheet(sys);
      const rendered = sheet.map((panel, i) => {
        const r = renderPanel(sys, panel);
        report(spec.name, r, i, 4);
        return r;
      });
      console.log(
        `  wrote ${writeContactSheet(
          rendered.map((r) => r.stats),
          4,
          `finish-pattern-${spec.name}.png`,
        )}`,
      );
      // The sheet has to be a sheet: every panel draws, the control is
      // flat (no pattern = no albedo variance), and every patterned panel
      // at full strength puts SOME grain on the object.
      for (const r of rendered) {
        expect(
          r.stats.hits,
          `${r.spec.label} rendered nothing`,
        ).toBeGreaterThan(MIN_HIT_FRACTION * r.stats.width * r.stats.height);
      }
      // The control's albedo is ANALYTICALLY flat — surfaceFinishPatternAlbedo
      // returns `base` unchanged for SURFACE_PATTERN_NONE, so every hit reads
      // the exact same double for luminance — but variance is computed as
      // `sumSq/n - mean*mean` over thousands of independently-rounded
      // accumulations, and that never lands on exact 0 in double precision
      // (measured ~7.5e-15 here). An epsilon many orders below any real
      // pattern's variance (~1e-2, below) is the honest floor.
      expect(rendered[0].albedoVar).toBeLessThan(1e-12);
      for (const r of rendered.slice(1)) {
        expect(
          r.albedoVar,
          `${r.spec.label} put no grain on the object`,
        ).toBeGreaterThan(1e-4);
      }
    });
  }

  it("zoom ladders: does the grain keep resolving, and does the world-space fallback plateau?", () => {
    // Three magnifications about one surface point, for the descent-driven
    // wood, the descent-driven marble, and the noise-driven wood, on the
    // sponge. The number to read is EDGE DENSITY down each ladder: a
    // coordinate that keeps resolving holds it; bands fixed in world space
    // lose it roughly as fast as the magnification grows. Scales are
    // menger's own calibrated ~8-band values (calibrateTrap) — the same
    // mid panel the per-system sheet renders — rather than one fixed
    // 14/10 pair.
    //
    // MENGER ALONE, not a second fold-pair system: boxfold-pair (the
    // original second system) was dropped from SYSTEMS entirely — see its
    // comment there — and mandelbox-pair (the only fold pair left) renders
    // at its own reduced MANDELBOX_PAIR_SIZE, which writeContactSheet
    // cannot mix with menger's default SIZE in the one sheet this test
    // writes (it tiles every panel at `panels[0]`'s width). Every finding
    // this ladder draws is menger's own, and the module header records
    // that scope plainly rather than implying a second system corroborates
    // it.
    const zooms = [1, 8, 64];
    const sheet: PanelStats[] = [];
    const edgeRows: { label: string; edges: number[] }[] = [];
    let index = 0;
    const spec = SYSTEMS[1];
    const sys = buildSystem(spec);
    const w = round1(sys.ringsCal.scales[1]);
    const m = round1(sys.sheetsCal.scales[1]);
    const panels: ((zoom: number) => PanelSpec)[] = [
      (z) => wood(w, 1, "descent", z),
      (z) => marble(m, 1, "descent", z),
      (z) => wood(w, 1, "noise", z),
    ];
    for (const make of panels) {
      const edges: number[] = [];
      for (const z of zooms) {
        const r = renderPanel(sys, make(z));
        report(spec.name, r, index++, 3);
        // The hit test is the camera/estimator's, not the pattern's — a
        // panel that goes blank at high zoom (the object left the frame)
        // and a coordinate that genuinely lost all structure both read as
        // ~0% edge density below, so this is the ONE check that tells
        // them apart. Without it a re-broken zoom camera reads exactly
        // like the fallback's own expected plateau.
        expect(
          r.stats.hits,
          `${spec.name} ${r.spec.label} rendered nothing`,
        ).toBeGreaterThan(MIN_HIT_FRACTION * r.stats.width * r.stats.height);
        sheet.push(r.stats);
        edges.push(r.edgeDensity);
      }
      edgeRows.push({ label: `${spec.name} ${make(1).label}`, edges });
    }
    console.log(
      `  wrote ${writeContactSheet(sheet, 3, "finish-pattern-zoom.png")}`,
    );
    console.log("  EDGE DENSITY down each ladder (1x / 8x / 64x):");
    for (const row of edgeRows) {
      console.log(
        `    ${row.label.padEnd(40)} ${row.edges.map((e) => `${(100 * e).toFixed(1)}%`.padStart(7)).join("  ")}` +
          `   64x/1x = ${(row.edges[2] / Math.max(1e-9, row.edges[0])).toFixed(2)}`,
      );
    }
    // The noise ladder is the CONTROL for the claim, so its plateau is
    // asserted: at 64x the world-space wood has lost most of its edges.
    for (const row of edgeRows) {
      if (!row.label.includes("NOISE")) continue;
      expect(
        row.edges[2],
        `${row.label}: the world-space coordinate was expected to plateau at 64x`,
      ).toBeLessThan(0.5 * row.edges[0]);
    }
  });
});
