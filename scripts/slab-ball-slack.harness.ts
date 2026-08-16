/**
 * WHAT THE SLACK SLAB COSTS, AND WHAT IT BUYS (fr-v7ca).
 *
 * `surface-de-4d.ts` used to REFUSE fr-wa6o slab queries — `halfExtent`,
 * thickness `h > 0` — for any 4D system whose fold set includes a spherefold
 * or a mandelbox. The reason was sound and is unchanged: the spherefold MID
 * branch is a sphere inversion, an inversion takes the slab's SEGMENT to a
 * circular ARC, and min-radius-over-chord is not min-radius-over-arc in
 * either direction, so a plain segment certificate there is unsound, not
 * merely loose. Two lifts stood open, and this sheet exists to decide
 * between them with numbers rather than with taste:
 *
 *   (A) THE BALL-SLACK FORM. `slabDE(p, h) = max(0, DE(p) - h)` over the
 *       ordinary POINT estimator. Sound by the triangle inequality in one
 *       line — `dist(segment, A) >= dist(centre, A) - h >= DE(centre) - h` —
 *       independently of how the descent works. One subtraction; no new
 *       chain state, no new frontier register, no new WGSL variant.
 *   (B) THE THREADED SEGMENT+BALL-SLACK STATE, the bead's own sketch. Carry
 *       `(q, e, rho)`: affine branches transport `e` exactly and grow `rho`
 *       by their `sigma_max`; at a spherefold MID crossing, enclose the
 *       segment in a ball of radius `|e| + rho`, push it through the
 *       inversion with `inversion.ts`'s `inversionBallScale` (Möbius takes
 *       balls to balls exactly), re-emerge with `e' = 0` and the image ball
 *       as `rho'`. One extra scalar per CPU chain tuple, one extra f32 per
 *       frontier slot in the fold4 WGSL kernel — the register-pressure
 *       territory fr-b72d/fr-d0nn measured at 2.2x for the `ext` vec4 — its
 *       own codegen variant, its own soundness tests, its own bench fixture.
 *
 * THE FIRST RUN OF THIS SHEET COULD ONLY BRACKET (B), and said so. On a
 * BOXFOLD-ONLY system the two arms it renders are (B)'s two ENDPOINTS —
 * EXACT is (B) with no mid crossing ever (`rho` never leaves 0, its ceiling)
 * and BALL is (B) with the crossing at DEPTH 0 (`chainScale · rho_d = h`
 * exactly, its floor) — so the EXACT-vs-BALL gap is the full span of what
 * (B) could ever buy, and where inside it a real spherefold system falls was
 * the whole question. (B) HAS SINCE BEEN BUILT (`descendFold4`'s SLACK
 * section), so sections 4 measures it directly and the bracket is closed.
 *
 * ================================ THE VERDICT ================================
 *
 * FORM (B) IS REAL, SOUND, AND NOT WORTH A KERNEL. It lands next to form (A),
 * which is where the first run predicted it would — and the prediction now has
 * a STRUCTURAL reason behind it as well as two systems' worth of numbers.
 *
 * THE STRUCTURAL REASON, which is why two systems are enough. Branch
 * enumeration is UNCONDITIONAL: the descent tries all three sphere branches at
 * EVERY level, depth 0 included, on every map. So a mid-crossed chain always
 * exists from the first level, and crossing only ever LOWERS a chain's
 * certificate — which makes the crossed chain more likely, never less, to own
 * the final min. There is therefore no such thing as a spherefold system whose
 * first mid crossing is deep, and the "crossing-depth instrument" the first run
 * named as a wake condition would have measured a constant. What was left to
 * measure was whether the crossed chain actually wins, and it does, at every
 * thickness that matters, on both systems below.
 *
 *  1. THE PICTURE PUTS (B) NEXT TO (A), and this is the cleanest number on
 *     the sheet because it is a WITHIN-ROW comparison. Hit-mask IoU of the
 *     two arms against each other, `IoU(S, B)`: 0.912 -> 0.783 across the
 *     slider on the SHARP system (`mixedFoldTrio4`) and 0.766 -> 0.620 on the
 *     smooth one. Section 1 measures the same quantity where a real slab
 *     exists — `IoU(E, B)` — and gets 0.27 to 0.57. Where a true slab shares
 *     roughly a third to a half of its pixels with the ball form, (B) shares
 *     four fifths.
 *
 *  2. AS A BOUND IT RECOVERS A SLIVER OF THE GAP. `charge/worth`, the ball
 *     form's overcharge, is 4.1-15.8x on the three fold controls and 117-335x
 *     on `sixteenCellFlake` when the denominator is a REAL slab. Against
 *     (B) as the denominator it is 1.5-1.7x on the mixed trio and 1.1-1.5x on
 *     the spherefold pair. In absolute terms at the slider's own ceiling, (B)
 *     keeps 0.612 / 0.583 of the point bound where (A) keeps 0.422 / 0.365 —
 *     better, and nowhere near the 0.850-0.997 every exact control keeps.
 *     AND THE FIXTURES ARE NOT THE EXPLANATION: `boxfoldLens4` is THINNER in
 *     `w` than either slack system (wSupport 0.070 of visR against 0.130 and
 *     0.174) and still overcharges 10.3-59.6x, so 1.1-1.7x is (B)'s own
 *     ceiling here and not an artifact of a thin fixture.
 *
 *  3. IT COSTS 2-8x. Same panel, same pose, `ms S` against `ms B`: 10.3-16.8s
 *     against 4.2-5.0s on the mixed trio (2.1-3.4x, and 2.1-3.4x its own
 *     `h = 0` baseline), 297-770ms against 92-155ms on the spherefold pair.
 *     Two descents is the honest price of the entry-level ball floor, and the
 *     capsule's own frontier work is the rest. A kernel would pay that twice
 *     over — the second descent AND a per-slot f32 in the register-pressure
 *     band fr-b72d/fr-d0nn measured at 2.2x for the `ext` vec4.
 *
 *  4. SOUNDNESS AND THE FLOOR BOTH HOLD, which is what makes the verdict a
 *     COST verdict rather than a correctness one. 0 violations of the true
 *     segment distance in 4800 (query, thickness, form) checks; 0 of 2400
 *     queries where (B) fell below `DE(p) - h`, the floor its public entry
 *     promises; 0 where `max(0, S) < B`. (B) is never worse than (A). It is
 *     just barely better.
 *
 *  5. AND SECTIONS 1-3 REPRODUCE THE PRE-LIFT SHEET EXACTLY, which is the
 *     regression check that matters: `rho` never leaves 0 on a
 *     {@link slabExact4} system, so the EXACT arm descends byte for byte.
 *     Every figure the sections below print for the four boxfold controls is
 *     the figure the first run printed.
 *
 * SO: (B) SHIPS IN THE CPU ORACLE AND NOWHERE ELSE. `surface-de-4d.ts`
 * answers spherefold and mandelbox BASE maps (only a non-affine FINAL lens is
 * still refused — `slabSupported4`, where the crossing lands before depth 0
 * and (B) IS (A) exactly), while `surface-de-gpu.ts`'s packer,
 * `surface-compute.ts`'s pipeline pick and main.ts's thickness row all still
 * gate on `slabExact4`. The capability stops at the oracle deliberately: on
 * these numbers a kernel mirror buys 1.1-1.7x of bound and four fifths of the
 * same picture for 2-8x the work and a frontier register. This sheet is what
 * that decision rests on, and it is kept RUNNABLE rather than summarized —
 * which is the reason (B) stays in the oracle at all.
 *
 * WHAT WOULD REOPEN IT is no longer an instrument, because the instruments
 * are spent: a THICKNESS CAP is the one design this sheet has never scored.
 * (A) tracks a real slab wherever `h / DE` stays small — section 2's whole
 * point — and that ratio is knowable from a cheap CPU probe before any render
 * (`escape-de.ts`'s pre-scale method one family over: measure the budget
 * first, then pick). A capped (A) needs no register, no second descent and no
 * new WGSL variant, which is exactly the shape of the thing that could ship.
 * Named, not recommended: nothing has asked for it.
 *
 * THE INSTRUMENT is `de-preview.ts`'s shared CPU marcher — no ninth marcher,
 * and the two shading terms that read the marcher's own STATISTICS rather
 * than the object (the step-count AO stand-in, the cone-traced shadow) are
 * both OFF, because the arms differ in step count by construction and a
 * comparison sheet must differ only in the formula. Sections 1-3 run four
 * `slabExact4` systems so the EXACT control exists: a pure-boxfold pair (the
 * 81-branch 4D fold frontier), a boxfold + two affine maps (the mixed
 * frontier), a boxfold FINAL lens over an affine 4D base (`descendLens4`),
 * and the shipped `sixteenCellFlake` preset (the plain affine ladder — the
 * shape the slice slider actually runs on today). Section 4 runs the two
 * `slabExact4` FALSE systems (B) exists for, deliberately one of each KIND:
 * `mixedFoldTrio4` is SHARP (two 81-branch boxfolds under one spherefold) and
 * `spherefoldPair4` is SMOOTH. One fixed pose per system, fitted once to the
 * widest slab so every row is the same camera.
 *
 * ONE CAVEAT THE VERDICT CARRIES, in the direction of caution. The spherefold
 * pair is SMOOTH — shells and lobes, no fine structure, `qjulia-de.ts`'s
 * finding one map over — so its panels cannot show the smoothing failure the
 * boxfold controls show, and its sweep must not be read as (B) passing. That
 * is precisely why `mixedFoldTrio4` sits beside it: sharp, and on the slack
 * path, so the panels answer the question the smooth row cannot.
 */
import {
  analyzeSurfaceSystem4,
  buildSurfaceDE4,
  deHasFolds4,
  estimateDistance4,
  estimateDistance4Refined,
  slabExact4,
  slabSupported4,
} from "../src/fractal/surface-de-4d";
import type { SurfaceDE4 } from "../src/fractal/surface-de-4d";
import { runChaosGame4 } from "../src/fractal/chaos-game-4d";
import type { ChaosGame4Result } from "../src/fractal/chaos-game-4d";
import { toTransform4 } from "../src/fractal/affine4";
import { mulberry32 } from "../src/fractal/rng";
import { sixteenCellFlake } from "../src/fractal/presets";
import type { Transform, Vec4 } from "../src/fractal/types";
import { PREVIEW_HIT, renderPreview, writeContactSheet } from "./de-preview";
import type { DistanceEstimator, PanelStats, Vec3 } from "./de-preview";

// --------------------------------------------------------------- constants

/** Panel edge, square. Chosen against the 5-minute budget: the EXACT arm on
 * the 81-branch pair costs ~120us per DE eval, and 44 panels of it is the
 * whole sheet's wall. */
const PANEL = 96;
/**
 * Section 4's panel edge, narrower than the global {@link PANEL} on purpose.
 * That section renders 28 panels rather than section 1's 13-per-system, and
 * its SLACK arm honestly costs TWO descents per query (the capsule plus the
 * entry-level ball floor under it), so 96 would push one `it` past ten
 * minutes on the mixed trio alone. Nothing here compares across panel sizes —
 * every number in section 4 is a within-section comparison at one edge — so
 * the drop costs no conclusion. Sections 1-3 keep {@link PANEL} unchanged, so
 * their rows stay comparable with the ones the module header quotes.
 */
const PANEL_SLACK = 72;
/** Points in the seeded 4D chaos game each system's framing is fitted from,
 * and the cloud section 3 measures the true segment distance against. */
const CLOUD_POINTS = 12000;
/** Seed for every cloud below — one number, so a re-run is the same sheet. */
const CLOUD_SEED = 0x51ab;
/** Seed for section 2/3's query draws. */
const QUERY_SEED = 0xb0a7;
/**
 * The one thickness sweep, in the units the panel's own knob uses: fractions
 * of `wSupport`, whose slider runs 0..0.5 (`index.html`'s
 * `fourDSliceThicknessSlider`, `scene.ts`'s `setSurface4View`). `1.0` is
 * deliberately PAST the maximum, as the control that says what the app is
 * being kept away from.
 *
 * The bead suggested sweeping `h` in units of `visibleBoundingRadius`
 * instead, and this sheet's first run did. It is the wrong ruler and the run
 * says so: `wSupport / visR` measures 0.070 / 0.214 / 0.330 / 0.935 on the
 * four systems below — a 13x spread — so a visR-normalised sweep put EVERY
 * row of `boxfoldLens4` past the slider's ceiling and every row of
 * `sixteenCellFlake` well inside it, i.e. it compared four systems at four
 * unrelated knob positions. Each table prints `h` and `h/visR` beside the
 * slider position, so the geometric reading is still there to be had.
 */
const SLIDER_STOPS = [0.05, 0.1, 0.2, 0.35, 0.5, 1.0];
/** The panel slider's own ceiling. */
const SLIDER_MAX = 0.5;
/** Queries per (system, thickness) in sections 2, 3 and 4. */
const QUERIES = 200;
/** `renderPreview`'s default eye offset, restated because the depth columns
 * need the eye position the marcher used. */
const EYE: Vec3 = [1.55, 1.1, 1.8];

// ----------------------------------------------------------------- systems

/** `surface-de-4d.test.ts`'s `map4` — a minimal contracting 4D map each
 * factory below merges its own fields over. */
function map4(overrides: Partial<Transform> = {}): Transform {
  return {
    id: 0,
    position: [0.1, 0.2, 0.3],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
    ...overrides,
  };
}

/**
 * Both maps pure `boxfold` with a `w` ROTATION apiece — 81 branches each,
 * every one a reflection + translation isometry, and `slabExact4` true so
 * the EXACT control exists. The rotation rather than a `w` TRANSLATION is
 * deliberate and is `escape-4d.harness.ts`'s measured lesson one family
 * over: a translation slides the object along an axis the render then cuts
 * across, while a rotation MIXES `w` with a spatial axis and gives the set
 * real thickness in `w` — which is the only way a slice has anything to
 * thicken.
 */
function boxfoldPair4(): Transform[] {
  return [
    map4({
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.45, 0.45, 0.45],
      w: { rotation: { xw: 0.5 } },
      variations: [{ type: "boxfold", weight: 1 }],
    }),
    map4({
      id: 1,
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.5, 0.5, 0.5],
      w: { rotation: { yw: 0.5 } },
      variations: [{ type: "boxfold", weight: 0.9 }],
    }),
  ];
}

/** One boxfold map against two plain affine ones — the MIXED frontier,
 * where fold branches and single affine children compete in the same
 * candidate stream, and the fullest slice of the four systems. */
function boxfoldTrio4(): Transform[] {
  return [
    map4({
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.5, 0.5, 0.5],
      w: { rotation: { xw: 0.45 } },
      variations: [{ type: "boxfold", weight: 1 }],
    }),
    map4({
      id: 1,
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.52, 0.52, 0.52],
      w: { position: 0.12, rotation: { yw: 0.35 } },
    }),
    map4({
      id: 2,
      position: [0, 0.35, -0.35],
      rotation: [0.2, 0.3, 0],
      scale: [0.5, 0.5, 0.5],
      w: { position: -0.12, rotation: { zw: 0.35 } },
    }),
  ];
}

/** Three affine 4D base maps under a boxfold FINAL lens — the third
 * `slabExact4` descent path (`descendLens4`'s branch sweep around untouched
 * cores), so the sheet covers the frontier, the mixed frontier and the lens
 * rather than measuring one body three times. */
function boxfoldLensBase4(): Transform[] {
  return [
    map4({
      position: [0.35, 0.1, 0],
      rotation: [0.2, 0.3, 0],
      scale: [0.44, 0.44, 0.44],
      w: { rotation: { xw: 0.45 } },
    }),
    map4({
      id: 1,
      position: [-0.3, -0.25, 0.2],
      rotation: [0, 0.4, 0.1],
      scale: [0.46, 0.46, 0.46],
      w: { position: 0.1, rotation: { yw: 0.4 } },
    }),
    map4({
      id: 2,
      position: [0.05, 0.3, -0.3],
      rotation: [0.35, 0, 0.25],
      scale: [0.45, 0.45, 0.45],
      w: { position: -0.1, rotation: { zw: 0.35 } },
    }),
  ];
}

/** The lens itself. The SMALL weight matters (`surface-de-4d.test.ts`'s own
 * note on `boxfoldFinal4`): `u = p/w` has to reach past the fold planes or
 * the lens degenerates to its affine part. */
function boxfoldLens4(): Transform {
  return map4({
    id: 99,
    position: [0.15, -0.1, 0.05],
    rotation: [0.2, 0.3, 0.1],
    scale: [0.9, 0.9, 0.9],
    w: { rotation: { yw: 0.2 } },
    variations: [{ type: "boxfold", weight: 0.55 }],
  });
}

/**
 * The SPHEREFOLD deliverable: a pure-spherefold 4D pair, `slabExact4` FALSE,
 * so both public estimators throw on a slab query and form (A) is the only
 * thing that can draw one. Scale kept small on purpose — the composite
 * Lipschitz bound `|w|·4·sigma_max` sets `maxDepth`, and a slower-contracting
 * pair pushes it to the 128 ceiling and prices the row out of a 5-minute
 * sheet without changing what it demonstrates.
 */
function spherefoldPair4(): Transform[] {
  return [
    map4({
      position: [0.3, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.12, 0.12, 0.12],
      w: { rotation: { xw: 0.45 } },
      variations: [{ type: "spherefold", weight: 0.9 }],
    }),
    map4({
      id: 1,
      position: [-0.25, -0.2, 0.2],
      rotation: [0, 0.5, 0.1],
      scale: [0.11, 0.11, 0.11],
      w: { rotation: { yw: 0.4 } },
      variations: [{ type: "spherefold", weight: 1.1 }],
    }),
  ];
}

/**
 * THE STRUCTURED NON-EXACT SYSTEM: `boxfoldPair4`'s two maps verbatim plus
 * one spherefold, so `slabExact4` is FALSE and every slab query below takes
 * fr-v7ca's slack path — while the two 81-branch boxfolds keep the object
 * SHARP. That combination is the whole reason this fixture exists.
 * `spherefoldPair4` (the row this sheet already had) is smooth by nature, so
 * it cannot show whether form (B) preserves structure where the ball form
 * smears it; a mixed system can, and section 4 renders both.
 *
 * The three numbers were picked by measurement, in this order:
 *
 *  - `slabExact4` FALSE is structural — one non-affine base fold is enough,
 *    and `slack` is then armed for the WHOLE descent, not merely the third
 *    map's branches. So the spherefold does not have to dominate the object
 *    to put the estimator on the path being measured.
 *  - `analyzeSurfaceSystem4` ELIGIBLE (not degraded, not ineligible) needs
 *    the composite fold bound `|w|·L_V·sigma_max` under 1: a spherefold's
 *    `L_V` is the classic `fR²/mR²` = 4, so `4·0.6·0.2 = 0.48` clears it
 *    with the same margin the two boxfolds have (`1·1·0.45`). Every map is
 *    uniformly scaled, so anisotropy is exactly 1 and the status is
 *    `eligible` rather than `degraded`.
 *  - COST is what set the scale/weight pair, and it is not a small effect.
 *    A first cut at `scale 0.2, weight 1` measured `lip = 0.8`, which pushed
 *    `maxDepth` from 13 to 42 and a single 64px panel from 4.7s to 32.5s —
 *    the descent prunes far less when the contraction is that slack.
 *    `weight 0.6` buys the depth back and leaves the spherefold's own scale
 *    large enough to contribute real geometry. Two further candidates
 *    (`0.125/0.9` and `0.16/0.9`, both `lip <= 0.58`) render the same kind
 *    of object at 2-2.5x the cost, so this one ships.
 *
 * MEASURED at PANEL 72: depth 13, marchR 1.120, 8.58% of rays hit at `h = 0`
 * (23.53% at the slider's ceiling), 0 exhausted rays at every stop — a
 * fold-shaped object in the same coverage band as the sheet's other
 * controls, not a near-empty frame and not the whole marching ball.
 *
 * NO MANDELBOX HERE, and that is a COST decision rather than a matter of
 * principle: a mandelbox base map is 243 branches against a boxfold's 81 and
 * a spherefold's 3, which prices a 7-stop two-arm panel sweep out of this
 * sheet's budget. The slack path a mandelbox takes is the spherefold's — the
 * MID branch inversion is the same crossing — so what section 4 measures
 * here is what it would measure there, more slowly.
 */
function mixedFoldTrio4(): Transform[] {
  return [
    ...boxfoldPair4(),
    map4({
      id: 2,
      position: [0, 0.3, -0.3],
      rotation: [0.2, 0.3, 0],
      scale: [0.2, 0.2, 0.2],
      w: { rotation: { zw: 0.4 } },
      variations: [{ type: "spherefold", weight: 0.6 }],
    }),
  ];
}

/**
 * A spherefold FINAL lens over one plain contracting base map — the ONE shape
 * `slabSupported4` still refuses after fr-v7ca's lift, and the reason is
 * structural rather than a gap: `descendLens4` crosses its lens inversion
 * BEFORE depth 0, so the chain's slack ball is born isotropic and the capsule
 * estimator degrades to `max(0, DE(p) - h)` — form (A) exactly, which this
 * sheet measured and rejected. Modelled on `surface-de-4d.test.ts`'s
 * `mandelboxFinal4` but written out here: a harness must not reach into a
 * test file's fixtures. The SMALL weight is the same requirement every lens
 * fixture in this project carries (`u = p/w` has to reach past the fold
 * planes), though nothing below descends it — the refusal fires at the public
 * entry, before any branch runs.
 */
function spherefoldLens4(): Transform {
  return map4({
    id: 99,
    position: [0.05, 0.1, 0],
    rotation: [0.3, 0, 0.2],
    scale: [0.85, 0.85, 0.85],
    w: { rotation: { yw: 0.2 } },
    variations: [{ type: "spherefold", weight: 0.6 }],
  });
}

interface SystemSpec {
  name: string;
  transforms: Transform[];
  final: Transform | null;
}

const SYSTEMS: SystemSpec[] = [
  { name: "boxfoldPair4", transforms: boxfoldPair4(), final: null },
  { name: "boxfoldTrio4", transforms: boxfoldTrio4(), final: null },
  {
    name: "boxfoldLens4",
    transforms: boxfoldLensBase4(),
    final: boxfoldLens4(),
  },
  { name: "sixteenCellFlake", transforms: sixteenCellFlake(), final: null },
];

/**
 * Section 4's two systems: both `slabExact4` FALSE, so both take fr-v7ca's
 * slack path, and deliberately one of each KIND — the mixed trio is sharp
 * (two 81-branch boxfolds under one spherefold) and the spherefold pair is
 * smooth. A single row could not separate "form (B) keeps the structure"
 * from "this object had none to lose".
 */
const SLACK_SYSTEMS: SystemSpec[] = [
  { name: "mixedFoldTrio4", transforms: mixedFoldTrio4(), final: null },
  { name: "spherefoldPair4", transforms: spherefoldPair4(), final: null },
];

// ----------------------------------------------------------------- framing

interface Frame {
  de: SurfaceDE4;
  cloud: ChaosGame4Result;
  /** The hyperplane the panel marches: the cloud's own `w` MIDPOINT. A
   * literal `w = 0` would measure where the object happens to sit in `w`
   * rather than what the estimator does to a slab, and the app's centred
   * slider position pivots on the cloud's own centre anyway. */
  w0: number;
  /** Marching-ball centre and radius, fitted ONCE per system to the WIDEST
   * slab in the sweep so every row is the same camera. */
  target: Vec3;
  radius: number;
  /** `wSupport` at the identity rotor — the cloud's `w` half-extent, which
   * is exactly what `scene.ts`'s `setSurface4View` multiplies the 0..0.5
   * slice-thickness slider by. */
  wSupport: number;
  eye: Vec3;
}

function fitFrame(spec: SystemSpec): Frame {
  const de = buildSurfaceDE4(spec.transforms, spec.final);
  const cloud = runChaosGame4(
    spec.transforms.map(toTransform4),
    CLOUD_POINTS,
    mulberry32(CLOUD_SEED),
    spec.final ? toTransform4(spec.final) : null,
  );
  let wMin = Infinity;
  let wMax = -Infinity;
  for (let i = 0; i < cloud.count; i++) {
    const w = cloud.w[i];
    if (w < wMin) wMin = w;
    if (w > wMax) wMax = w;
  }
  const w0 = (wMin + wMax) / 2;
  const wSupport = (wMax - wMin) / 2;

  const hMax = Math.max(...SLIDER_STOPS) * wSupport;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let n = 0;
  for (let i = 0; i < cloud.count; i++) {
    if (Math.abs(cloud.w[i] - w0) > hMax) continue;
    cx += cloud.positions[i * 3];
    cy += cloud.positions[i * 3 + 1];
    cz += cloud.positions[i * 3 + 2];
    n++;
  }
  cx /= n || 1;
  cy /= n || 1;
  cz /= n || 1;
  const radii: number[] = [];
  for (let i = 0; i < cloud.count; i++) {
    if (Math.abs(cloud.w[i] - w0) > hMax) continue;
    radii.push(
      Math.hypot(
        cloud.positions[i * 3] - cx,
        cloud.positions[i * 3 + 1] - cy,
        cloud.positions[i * 3 + 2] - cz,
      ),
    );
  }
  radii.sort((a, b) => a - b);
  // 99.5th percentile rather than the max: one chaos-game outlier must not
  // set the framing for every row (`framing-bounds.ts`'s own reasoning).
  const radius = (radii[Math.floor(radii.length * 0.995)] ?? 1) * 1.1;
  const target: Vec3 = [cx, cy, cz];
  const eye: Vec3 = [
    target[0] + EYE[0] * radius,
    target[1] + EYE[1] * radius,
    target[2] + EYE[2] * radius,
  ];
  return { de, cloud, w0, target, radius, wSupport, eye };
}

// -------------------------------------------------------------------- arms

/**
 * SLAB: the SHIPPED slab query, one call for both of this sheet's worlds —
 * which is the whole point of fr-v7ca's lift, and why this arm is no longer
 * named `exactArm`. `estimateDistance4Refined(de, q, 0, halfExtent)` now
 * ANSWERS wherever `slabSupported4` holds, and the ESTIMATOR picks the path:
 *
 *  - On a `slabExact4` system (fold set at most {boxfold}) it is form (B)
 *    with no mid crossing ever — the chain's slack `rho` never leaves 0,
 *    every expression reduces to the segment machinery that shipped before
 *    the lift, and the answer is byte-identical to it. That is (B) at its
 *    ceiling, and sections 1-3's four systems are all of this kind.
 *  - On a spherefold/mandelbox BASE-map system it is form (B)'s SLACK
 *    capsule: exact segment threading down to the first spherefold MID
 *    crossing, a ball of slack from there down, floored at the public entry
 *    by form (A)'s own `DE(p) - h`. Section 4's two systems are of this kind.
 *
 * A row says for itself which it is — `describeFrame` prints `slabExact` per
 * system — so no second arm and no second call site is needed to tell them
 * apart. The one shape still refused is a spherefold/mandelbox FINAL lens
 * (`slabSupported4`), asserted in section 4.
 */
function slabArm(frame: Frame, h: number): DistanceEstimator {
  const halfExtent: Vec4 | null = h > 0 ? [0, 0, 0, h] : null;
  return (p) =>
    estimateDistance4Refined(
      frame.de,
      [p[0], p[1], p[2], frame.w0],
      0,
      halfExtent,
    );
}

/** BALL: form (A) — the point estimator, minus the thickness, clamped. */
function ballArm(frame: Frame, h: number): DistanceEstimator {
  return (p) =>
    Math.max(
      0,
      estimateDistance4Refined(
        frame.de,
        [p[0], p[1], p[2], frame.w0],
        0,
        null,
      ) - h,
    );
}

/** POINT: `h = 0`, the zero-thickness hyperplane — what the refusal ships
 * today, and the control that says what "no slab at all" looks like. */
function pointArm(frame: Frame): DistanceEstimator {
  return ballArm(frame, 0);
}

// -------------------------------------------------------------- panel maths

interface Arm {
  panel: PanelStats;
  hit: Uint8Array;
  /** Marched depth `t` per hit pixel, 0 elsewhere. */
  depth: Float64Array;
}

function renderArm(frame: Frame, de: DistanceEstimator, size: number): Arm {
  const panel = renderPreview(
    {
      de,
      boundingRadius: frame.radius,
      target: frame.target,
      stepScale: frame.de.stepScale,
      eyeOffset: EYE,
      // Both shading terms that read the MARCHER's statistics rather than
      // the object are off: the arms differ in step count by construction,
      // and a comparison sheet must differ only in the formula.
      ao: false,
      shadow: false,
      collect: true,
    },
    size,
  );
  const status = panel.status;
  const hitPos = panel.hitPos;
  if (!status || !hitPos) throw new Error("renderPreview did not collect");
  const hit = new Uint8Array(size * size);
  const depth = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) {
    if (status[i] !== PREVIEW_HIT) continue;
    hit[i] = 1;
    depth[i] = Math.hypot(
      hitPos[i * 3] - frame.eye[0],
      hitPos[i * 3 + 1] - frame.eye[1],
      hitPos[i * 3 + 2] - frame.eye[2],
    );
  }
  return { panel, hit, depth };
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) union++;
    if (a[i] && b[i]) inter++;
  }
  return union === 0 ? NaN : inter / union;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** Mean and p95 of `|t_a - t_b|` over pixels BOTH arms hit. */
function depthGap(a: Arm, b: Arm): { mean: number; p95: number; n: number } {
  const diffs: number[] = [];
  let sum = 0;
  for (let i = 0; i < a.hit.length; i++) {
    if (!a.hit[i] || !b.hit[i]) continue;
    const d = Math.abs(a.depth[i] - b.depth[i]);
    diffs.push(d);
    sum += d;
  }
  diffs.sort((x, y) => x - y);
  return {
    mean: diffs.length ? sum / diffs.length : NaN,
    p95: quantile(diffs, 0.95),
    n: diffs.length,
  };
}

/**
 * Chebyshev distance from every pixel to the nearest set pixel, by
 * 8-neighbour BFS (8-neighbour graph distance IS the Chebyshev metric),
 * capped so the sweep stays O(size² · cap).
 */
function chebyshevDistance(
  set: Uint8Array,
  size: number,
  cap: number,
): Uint8Array {
  const dist = new Uint8Array(size * size).fill(cap + 1);
  let frontier: number[] = [];
  for (let i = 0; i < set.length; i++) {
    if (set[i]) {
      dist[i] = 0;
      frontier.push(i);
    }
  }
  for (let d = 1; d <= cap && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const idx of frontier) {
      const px = idx % size;
      const py = (idx - px) / size;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const at = ny * size + nx;
          if (dist[at] <= d) continue;
          dist[at] = d;
          next.push(at);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * The rind test. `grown` is an arm that hits more pixels than `base`; every
 * pixel it adds is scored by its Chebyshev distance to the nearest pixel
 * `base` already had. A pure DILATION puts its additions in the first ring
 * or two; genuinely new structure lands further out.
 */
function rind(
  base: Uint8Array,
  grown: Uint8Array,
  size: number,
): { added: number; d1: number; d2: number } {
  const dist = chebyshevDistance(base, size, 2);
  let added = 0;
  let d1 = 0;
  let d2 = 0;
  for (let i = 0; i < base.length; i++) {
    if (!grown[i] || base[i]) continue;
    added++;
    if (dist[i] === 1) d1++;
    if (dist[i] <= 2) d2++;
  }
  return { added, d1, d2 };
}

// --------------------------------------------------------- true distances

/** Distance from the SEGMENT `q ± halfExtent` to the nearest cloud point —
 * `surface-de-4d.test.ts`'s `nearestSegmentDistance4`, restated here (it is
 * private there) as the soundness reference both forms are checked against.
 * With `halfExtent` all-zero this is the plain point distance. */
function nearestSegmentDistance4(
  cloud: ChaosGame4Result,
  q: Vec4,
  halfExtent: Vec4,
): number {
  const eLen2 =
    halfExtent[0] * halfExtent[0] +
    halfExtent[1] * halfExtent[1] +
    halfExtent[2] * halfExtent[2] +
    halfExtent[3] * halfExtent[3];
  let best = Infinity;
  for (let i = 0; i < cloud.count; i++) {
    const dx = cloud.positions[i * 3] - q[0];
    const dy = cloud.positions[i * 3 + 1] - q[1];
    const dz = cloud.positions[i * 3 + 2] - q[2];
    const dw = cloud.w[i] - q[3];
    let s = 0;
    if (eLen2 > 0) {
      s =
        (dx * halfExtent[0] +
          dy * halfExtent[1] +
          dz * halfExtent[2] +
          dw * halfExtent[3]) /
        eLen2;
      s = Math.max(-1, Math.min(1, s));
    }
    const ex = dx - s * halfExtent[0];
    const ey = dy - s * halfExtent[1];
    const ez = dz - s * halfExtent[2];
    const ew = dw - s * halfExtent[3];
    const d2 = ex * ex + ey * ey + ez * ez + ew * ew;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** Seeded uniform draws in the marching ball — the domain the marcher
 * actually enters, which is the domain a bound should be priced over. */
function ballQueries(frame: Frame, count: number): Vec3[] {
  const rng = mulberry32(QUERY_SEED);
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.cbrt(rng()) * frame.radius;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    out.push([
      frame.target[0] + r * st * Math.cos(ph),
      frame.target[1] + r * st * Math.sin(ph),
      frame.target[2] + r * ct,
    ]);
  }
  return out;
}

// ------------------------------------------------------------- table print

function cell(value: string, width: number): string {
  return value.padStart(width);
}

function num(value: number, digits: number, width: number): string {
  return cell(Number.isFinite(value) ? value.toFixed(digits) : "--", width);
}

function pct(hits: number, size: number): number {
  return (100 * hits) / (size * size);
}

function describeFrame(name: string, frame: Frame): string {
  return (
    `${name}: visR ${frame.de.visibleBoundingRadius.toFixed(3)}` +
    `  marchR ${frame.radius.toFixed(3)}` +
    `  w0 ${frame.w0.toFixed(3)}` +
    `  wSupport ${frame.wSupport.toFixed(3)}` +
    ` (${(frame.wSupport / frame.de.visibleBoundingRadius).toFixed(3)} visR)` +
    `  depth ${frame.de.maxDepth}` +
    `  baseFolds ${String(deHasFolds4(frame.de))}` +
    `  foldLens ${String(frame.de.foldFinal !== null)}` +
    `  slabExact ${String(slabExact4(frame.de))}`
  );
}

// ------------------------------------------------------------------ suites

describe("fr-v7ca: ball slack against the exact segment slab", () => {
  it("section 1: renders EXACT, BALL and POINT at one pose per system and scores coverage, agreement, depth and cost", () => {
    const lines: string[] = [];
    for (const spec of SYSTEMS) {
      const frame = fitFrame(spec);
      const point = renderArm(frame, pointArm(frame), PANEL);
      const exact: Arm[] = [];
      const ball: Arm[] = [];
      for (const stop of SLIDER_STOPS) {
        const h = stop * frame.wSupport;
        exact.push(renderArm(frame, slabArm(frame, h), PANEL));
        ball.push(renderArm(frame, ballArm(frame, h), PANEL));
      }

      lines.push("");
      lines.push(describeFrame(spec.name, frame));
      lines.push(
        "  COVERAGE + AGREEMENT" +
          "   (slider = the shipped slice-thickness knob, 0..0.50; * = past its max)",
      );
      lines.push(
        "    slider       h  h/visR |  hit%E  hit%B  hit%P |   B/E   P/E | IoU(E,B) IoU(E,P)",
      );
      SLIDER_STOPS.forEach((stop, i) => {
        const h = stop * frame.wSupport;
        const hE = pct(exact[i].panel.hits, PANEL);
        const hB = pct(ball[i].panel.hits, PANEL);
        const hP = pct(point.panel.hits, PANEL);
        lines.push(
          "  " +
            num(stop, 2, 8) +
            (stop > SLIDER_MAX ? "*" : " ") +
            num(h, 4, 7) +
            num(h / frame.de.visibleBoundingRadius, 3, 8) +
            " |" +
            num(hE, 2, 7) +
            num(hB, 2, 7) +
            num(hP, 2, 7) +
            " |" +
            num(hB / hE, 2, 6) +
            num(hP / hE, 2, 6) +
            " |" +
            num(iou(exact[i].hit, ball[i].hit), 3, 9) +
            num(iou(exact[i].hit, point.hit), 3, 9),
        );
      });

      lines.push(
        "  MARCHED DEPTH + COST   (|t| gaps in world units, against marchR " +
          `${frame.radius.toFixed(3)})`,
      );
      lines.push(
        "    slider |  dt(E,B) mean    p95     px |  dt(E,P) mean    p95     px |  steps/px  E     B     P",
      );
      SLIDER_STOPS.forEach((stop, i) => {
        const gapB = depthGap(exact[i], ball[i]);
        const gapP = depthGap(exact[i], point);
        lines.push(
          "  " +
            num(stop, 2, 8) +
            " |" +
            num(gapB.mean, 4, 13) +
            num(gapB.p95, 4, 7) +
            // How many pixels the two means are taken over: a gap averaged
            // over a handful of commonly-hit pixels is not a measurement,
            // and the POINT column runs thin exactly where its object is.
            cell(String(gapB.n), 7) +
            " |" +
            num(gapP.mean, 4, 13) +
            num(gapP.p95, 4, 7) +
            cell(String(gapP.n), 7) +
            " |" +
            num(exact[i].panel.steps / (PANEL * PANEL), 1, 11) +
            num(ball[i].panel.steps / (PANEL * PANEL), 1, 6) +
            num(point.panel.steps / (PANEL * PANEL), 1, 6),
        );
      });

      lines.push(
        "  RIND vs INTERIOR   (Chebyshev px from each ADDED pixel to the arm it is added to)",
      );
      lines.push(
        "    slider |  B adds over E   d=1   d<=2 |  E adds over P (a REAL slab)   d=1   d<=2",
      );
      SLIDER_STOPS.forEach((stop, i) => {
        const rB = rind(exact[i].hit, ball[i].hit, PANEL);
        const rE = rind(point.hit, exact[i].hit, PANEL);
        lines.push(
          "  " +
            num(stop, 2, 8) +
            " |" +
            cell(String(rB.added), 15) +
            num(rB.added ? rB.d1 / rB.added : NaN, 2, 6) +
            num(rB.added ? rB.d2 / rB.added : NaN, 2, 7) +
            " |" +
            cell(String(rE.added), 25) +
            num(rE.added ? rE.d1 / rE.added : NaN, 2, 6) +
            num(rE.added ? rE.d2 / rE.added : NaN, 2, 7),
        );
      });

      // Row 1 = POINT then the EXACT panels; row 2 = POINT again then the
      // BALL panels, so each thickness's two arms sit one above the other
      // and the comparison is a glance rather than a hunt.
      const sheet = writeContactSheet(
        [
          point.panel,
          ...exact.map((a) => a.panel),
          point.panel,
          ...ball.map((a) => a.panel),
        ],
        1 + SLIDER_STOPS.length,
        `slab-ball-slack-${spec.name}.png`,
      );
      lines.push(`  wrote ${sheet}  (row 1 POINT + EXACT, row 2 POINT + BALL)`);
    }
    console.log(lines.join("\n"));
  });

  it("section 2: prices the two forms as BOUNDS over the shipped slider's own range, with no renderer involved", () => {
    const lines: string[] = [];
    lines.push("");
    lines.push(
      "  Seeded uniform queries in each system's marching ball. E = exact segment," +
        " B = max(0, DE - h), P = the point query.",
    );
    lines.push(
      "  E/P is what a REAL slab costs the bound; B/P is what form (A) charges" +
        " for the same thickness; charge/worth is",
    );
    lines.push(
      "  (1 - B/P) / (1 - E/P), the overcharge. That gap IS the direction-" +
        "blindness: the segment only reaches in w,",
    );
    lines.push("  and (A) has to assume every direction.");
    lines.push(
      "  `B=0, E>0` is the rind measured VOLUMETRICALLY: where form (A) says" +
        " 'surface' and the segment does not.",
    );
    for (const spec of SYSTEMS) {
      const frame = fitFrame(spec);
      const queries = ballQueries(frame, QUERIES);
      const points = queries.map((q) =>
        estimateDistance4Refined(
          frame.de,
          [q[0], q[1], q[2], frame.w0],
          0,
          null,
        ),
      );
      lines.push("");
      lines.push(describeFrame(spec.name, frame));
      lines.push(
        "    slider       h  h/visR |  med E/P  med B/P  charge/worth |  med B/E  p10 B/E |  B=0,E>0   B>E",
      );
      for (const stop of SLIDER_STOPS) {
        const h = stop * frame.wSupport;
        const halfExtent: Vec4 = [0, 0, 0, h];
        const ratios: number[] = [];
        const exactRel: number[] = [];
        const ballRel: number[] = [];
        let collapsed = 0;
        let tighter = 0;
        queries.forEach((q, i) => {
          const e = estimateDistance4Refined(
            frame.de,
            [q[0], q[1], q[2], frame.w0],
            0,
            halfExtent,
          );
          const b = Math.max(0, points[i] - h);
          if (points[i] > 0) {
            exactRel.push(e / points[i]);
            ballRel.push(b / points[i]);
          }
          if (e > 0) ratios.push(b / e);
          if (b === 0 && e > 0) collapsed++;
          if (b > e + 1e-12) tighter++;
        });
        ratios.sort((a, b) => a - b);
        exactRel.sort((a, b) => a - b);
        ballRel.sort((a, b) => a - b);
        const worth = 1 - quantile(exactRel, 0.5);
        const charge = 1 - quantile(ballRel, 0.5);
        lines.push(
          "  " +
            num(stop, 2, 8) +
            (stop > SLIDER_MAX ? "*" : " ") +
            num(h, 4, 7) +
            num(h / frame.de.visibleBoundingRadius, 3, 8) +
            " |" +
            num(quantile(exactRel, 0.5), 3, 9) +
            num(quantile(ballRel, 0.5), 3, 9) +
            num(worth > 0 ? charge / worth : NaN, 1, 14) +
            " |" +
            num(quantile(ratios, 0.5), 3, 9) +
            num(quantile(ratios, 0.1), 3, 9) +
            " |" +
            num(collapsed / QUERIES, 3, 9) +
            num(tighter / QUERIES, 3, 6),
        );
      }
    }
    console.log(lines.join("\n"));
  });

  it("section 3: both forms stay under the true segment distance at every thickness — form (A)'s one-line soundness, made executable", () => {
    const lines: string[] = [];
    lines.push("");
    lines.push(
      "  Truth = nearest distance from the SEGMENT q ± (0,0,0,h) to a " +
        `${CLOUD_POINTS}-point seeded 4D cloud.`,
    );
    lines.push(
      "    system                slider  checks | viol E  viol B |  med E/truth  med B/truth",
    );
    let totalChecks = 0;
    let totalViolations = 0;
    for (const spec of SYSTEMS) {
      const frame = fitFrame(spec);
      const queries = ballQueries(frame, QUERIES);
      const points = queries.map((q) =>
        estimateDistance4Refined(
          frame.de,
          [q[0], q[1], q[2], frame.w0],
          0,
          null,
        ),
      );
      for (const stop of SLIDER_STOPS) {
        const h = stop * frame.wSupport;
        const halfExtent: Vec4 = [0, 0, 0, h];
        let violE = 0;
        let violB = 0;
        const relE: number[] = [];
        const relB: number[] = [];
        queries.forEach((q, i) => {
          const at: Vec4 = [q[0], q[1], q[2], frame.w0];
          const truth = nearestSegmentDistance4(frame.cloud, at, halfExtent);
          const e = estimateDistance4Refined(frame.de, at, 0, halfExtent);
          const b = Math.max(0, points[i] - h);
          if (e > truth + 1e-6) violE++;
          if (b > truth + 1e-6) violB++;
          if (truth > 0) {
            relE.push(e / truth);
            relB.push(b / truth);
          }
        });
        relE.sort((a, b) => a - b);
        relB.sort((a, b) => a - b);
        totalChecks += QUERIES * 2;
        totalViolations += violE + violB;
        lines.push(
          "  " +
            spec.name.padEnd(20) +
            num(stop, 2, 6) +
            (stop > SLIDER_MAX ? "*" : " ") +
            cell(String(QUERIES), 7) +
            " |" +
            cell(String(violE), 7) +
            cell(String(violB), 8) +
            " |" +
            num(quantile(relE, 0.5), 3, 13) +
            num(quantile(relB, 0.5), 3, 13),
        );
      }
    }
    lines.push("");
    lines.push(
      `  ${totalViolations} violations in ${totalChecks} (query, thickness, form) checks.`,
    );
    console.log(lines.join("\n"));
    expect(totalViolations).toBe(0);
  });

  it("section 4: the deliverable — what form (B) draws where form (A) was the only arm", () => {
    // THE ONE REFUSAL THAT SURVIVES, asserted rather than quoted: this sheet
    // is about the state of the world, and the world moved. A spherefold or
    // mandelbox FINAL lens still throws, because `descendLens4` crosses its
    // inversion BEFORE depth 0 — the chain's slack ball is born isotropic
    // there and the capsule would BE `max(0, DE(p) - h)`, i.e. form (A),
    // which is what the rest of this file measured and rejected. A lift that
    // is identically a form already refused is not a lift.
    const lensDe = buildSurfaceDE4([map4()], spherefoldLens4());
    expect(slabSupported4(lensDe)).toBe(false);
    // The point is irrelevant — the entries refuse before any branch runs.
    const lensAt: Vec4 = [0.1, 0.2, 0.15, 0.05];
    expect(() => estimateDistance4(lensDe, lensAt, [0, 0, 0, 0.1])).toThrow(
      /slabSupported4/,
    );
    expect(() =>
      estimateDistance4Refined(lensDe, lensAt, 0, [0, 0, 0, 0.1]),
    ).toThrow(/slabSupported4/);

    const lines: string[] = [];
    lines.push("");
    lines.push(
      `  S = the SHIPPED slab query (form (B)'s slack capsule, ball-floored);` +
        ` B = form (A), max(0, DE - h); P = the point query.`,
    );
    lines.push(
      `  Both systems are slabExact4 FALSE, so S is the CAPSULE here and not` +
        ` the segment machinery sections 1-3 exercise.`,
    );
    lines.push(
      `  Panels at ${PANEL_SLACK}px (see PANEL_SLACK); queries ${QUERIES} per` +
        ` (system, thickness), seeded uniformly in the marching ball.`,
    );
    lines.push(
      `  S IS NOT CLAMPED AT 0 and form (A) as written above IS, so the two` +
        ` are compared under the same clamp (the S<B column);`,
    );
    lines.push(
      `  S<0 counts where the shipped estimator returns a NEGATIVE value —` +
        ` the query is nearer the set than h, which every marcher`,
    );
    lines.push(
      `  reads as a hit exactly as it reads form (A)'s 0. S<P-h is the floor` +
        ` itself, unclamped, which is what the entry actually promises.`,
    );

    const stops = [0, ...SLIDER_STOPS];
    // Accumulated across BOTH systems and BOTH forms, so one number answers
    // "did anything at all exceed the true segment distance".
    let truthChecks = 0;
    let truthViolations = 0;
    /**
     * THE BALL FLOOR'S GUARANTEE, and the one place this sheet had to be
     * careful about what it was comparing. `estimateDistance4Refined`'s
     * entry returns `max(capsule, DE(p) - h)` — UNCLAMPED — while form (A) as
     * `ballArm` writes it (and as the module header states it) is
     * `max(0, DE(p) - h)`. So there are two different questions:
     *
     *  - `floorViolations`: `S < DE(p) - h`, the floor the estimator itself
     *    promises. MEASURED 0 in 2400, exactly, at every stop on both
     *    systems.
     *  - `clampedViolations`: `max(0, S) < B`, the like-for-like comparison —
     *    is form (B) ever WORSE than form (A) once both are read the way a
     *    marcher reads them. Also 0, and it is the honest form of "never
     *    worse".
     *
     * The raw `S < B` count is neither of those and is NOT zero (246 of 2400
     * on the first run of this section): every one of them is a query where
     * `DE(p) - h < 0`, so B clamps to 0 while S returns the negative number
     * — measured, the raw count equals the `S < 0` count exactly at every
     * stop on both systems. That is a difference in CLAMP CONVENTION, not in
     * the bound, which is why the `S<0` column is printed beside the floor
     * rather than folded into it.
     */
    let floorChecks = 0;
    let floorViolations = 0;
    let clampedViolations = 0;

    for (const spec of SLACK_SYSTEMS) {
      const frame = fitFrame(spec);
      // The row is on the SLACK path (not the exact segment one) and the
      // estimators answer rather than throw — the two facts every number
      // below is only meaningful under.
      expect(slabExact4(frame.de)).toBe(false);
      expect(slabSupported4(frame.de)).toBe(true);
      // And that the system is one the mode would actually ENTER — a fixture
      // the gate calls `degraded` would render a damped march and quietly
      // measure something else. Asserted rather than asserted-in-a-comment,
      // because `mixedFoldTrio4`'s scale/weight pair was chosen to clear it.
      const eligibility = analyzeSurfaceSystem4(spec.transforms, spec.final);
      expect(eligibility.status).toBe("eligible");

      const slack = stops.map((stop) =>
        renderArm(frame, slabArm(frame, stop * frame.wSupport), PANEL_SLACK),
      );
      const ball = stops.map((stop) =>
        renderArm(frame, ballArm(frame, stop * frame.wSupport), PANEL_SLACK),
      );

      lines.push("");
      lines.push(describeFrame(spec.name, frame));
      lines.push(
        `  eligibility ${eligibility.status}` +
          `  anisotropy ${eligibility.anisotropy.toFixed(3)}` +
          `  stepScale ${eligibility.stepScale.toFixed(3)}`,
      );
      lines.push(
        "  PANELS   (slider = the shipped slice-thickness knob, 0..0.50;" +
          " * = past its max)",
      );
      lines.push(
        "    slider       h  h/visR |  hit% S  hit% B |  st/px S  st/px B |" +
          "  exh S |  IoU(S,B) IoU(S,S@0) IoU(B,B@0) |    ms S    ms B",
      );
      stops.forEach((stop, i) => {
        const h = stop * frame.wSupport;
        lines.push(
          "  " +
            num(stop, 2, 8) +
            (stop > SLIDER_MAX ? "*" : " ") +
            num(h, 4, 7) +
            num(h / frame.de.visibleBoundingRadius, 3, 8) +
            " |" +
            num(pct(slack[i].panel.hits, PANEL_SLACK), 2, 8) +
            num(pct(ball[i].panel.hits, PANEL_SLACK), 2, 8) +
            " |" +
            num(slack[i].panel.steps / (PANEL_SLACK * PANEL_SLACK), 1, 9) +
            num(ball[i].panel.steps / (PANEL_SLACK * PANEL_SLACK), 1, 9) +
            " |" +
            cell(String(slack[i].panel.exhausted), 7) +
            " |" +
            num(iou(slack[i].hit, ball[i].hit), 3, 10) +
            // Against each arm's OWN zero-thickness panel: how far the
            // slider has moved the picture, per arm, on the same object.
            num(iou(slack[i].hit, slack[0].hit), 3, 11) +
            num(iou(ball[i].hit, ball[0].hit), 3, 11) +
            " |" +
            num(slack[i].panel.ms, 0, 8) +
            num(ball[i].panel.ms, 0, 8),
        );
      });

      // Row 1 SLACK, row 2 BALL, one column per stop, so each thickness's
      // two arms sit one above the other exactly as section 1's sheet does.
      const sheetFile =
        spec.name === "mixedFoldTrio4"
          ? "slab-slack-mixed.png"
          : "slab-slack-spherefold.png";
      lines.push(
        `  wrote ${writeContactSheet(
          [...slack.map((a) => a.panel), ...ball.map((a) => a.panel)],
          stops.length,
          sheetFile,
        )}  (row 1 SLACK, row 2 BALL, at slider ${stops.join(", ")})`,
      );

      // ------------------------------------------------------ as a BOUND
      const queries = ballQueries(frame, QUERIES);
      const points = queries.map((q) =>
        estimateDistance4Refined(
          frame.de,
          [q[0], q[1], q[2], frame.w0],
          0,
          null,
        ),
      );
      lines.push(
        "  AS A BOUND   (section 2's vocabulary, with S in the column E held" +
          " there: charge/worth is the overcharge)",
      );
      lines.push(
        "    slider       h  h/visR |  med S/P  med B/P  charge/worth |" +
          "  med B/S  p10 B/S |  B=0,S>0    S>B",
      );
      const soundness: string[] = [];
      soundness.push(
        "  SOUNDNESS + THE BALL FLOOR   (truth = nearest distance from the" +
          ` SEGMENT q ± (0,0,0,h) to the ${CLOUD_POINTS}-point cloud)`,
      );
      soundness.push(
        "  slider  checks |  viol S  viol B |  med S/truth  med B/truth |" +
          "  S<B  S<0  S<P-h  S>B",
      );
      for (const stop of SLIDER_STOPS) {
        const h = stop * frame.wSupport;
        const halfExtent: Vec4 = [0, 0, 0, h];
        const slackRel: number[] = [];
        const ballRel: number[] = [];
        const ratios: number[] = [];
        const relS: number[] = [];
        const relB: number[] = [];
        let collapsed = 0;
        let tighter = 0;
        let violS = 0;
        let violB = 0;
        let belowFloor = 0;
        let negative = 0;
        let belowClamped = 0;
        queries.forEach((q, i) => {
          const at: Vec4 = [q[0], q[1], q[2], frame.w0];
          const s = estimateDistance4Refined(frame.de, at, 0, halfExtent);
          const b = Math.max(0, points[i] - h);
          if (points[i] > 0) {
            slackRel.push(s / points[i]);
            ballRel.push(b / points[i]);
          }
          if (s > 0) ratios.push(b / s);
          if (b === 0 && s > 0) collapsed++;
          if (s > b + 1e-12) tighter++;
          // The three floor readings, see the counters' doc above. `S<B` is
          // the raw comparison the two forms' own conventions produce,
          // `S<0` is the clamp difference that explains it, and `S<P-h` is
          // the floor the entry promises.
          if (s < b - 1e-9) belowClamped++;
          if (s < 0) negative++;
          if (s < points[i] - h - 1e-9) belowFloor++;
          // Both forms read the way a marcher reads them — the "never worse
          // than form (A)" claim proper, with the clamp difference removed.
          if (Math.max(0, s) < b - 1e-9) clampedViolations++;
          const truth = nearestSegmentDistance4(frame.cloud, at, halfExtent);
          if (s > truth + 1e-6) violS++;
          if (b > truth + 1e-6) violB++;
          if (truth > 0) {
            relS.push(s / truth);
            relB.push(b / truth);
          }
        });
        ratios.sort((a, b) => a - b);
        slackRel.sort((a, b) => a - b);
        ballRel.sort((a, b) => a - b);
        relS.sort((a, b) => a - b);
        relB.sort((a, b) => a - b);
        const worth = 1 - quantile(slackRel, 0.5);
        const charge = 1 - quantile(ballRel, 0.5);
        lines.push(
          "  " +
            num(stop, 2, 8) +
            (stop > SLIDER_MAX ? "*" : " ") +
            num(h, 4, 7) +
            num(h / frame.de.visibleBoundingRadius, 3, 8) +
            " |" +
            num(quantile(slackRel, 0.5), 3, 9) +
            num(quantile(ballRel, 0.5), 3, 9) +
            num(worth > 0 ? charge / worth : NaN, 1, 14) +
            " |" +
            num(quantile(ratios, 0.5), 3, 9) +
            num(quantile(ratios, 0.1), 3, 9) +
            " |" +
            num(collapsed / QUERIES, 3, 9) +
            num(tighter / QUERIES, 3, 6),
        );
        soundness.push(
          "  " +
            num(stop, 2, 6) +
            (stop > SLIDER_MAX ? "*" : " ") +
            cell(String(QUERIES), 7) +
            " |" +
            cell(String(violS), 8) +
            cell(String(violB), 8) +
            " |" +
            num(quantile(relS, 0.5), 3, 13) +
            num(quantile(relB, 0.5), 3, 13) +
            " |" +
            cell(String(belowClamped), 5) +
            cell(String(negative), 5) +
            cell(String(belowFloor), 7) +
            cell(String(tighter), 5),
        );
        truthChecks += QUERIES * 2;
        truthViolations += violS + violB;
        floorChecks += QUERIES;
        floorViolations += belowFloor;
      }
      lines.push(...soundness);
    }

    lines.push("");
    lines.push(
      `  ${truthViolations} violations of the true segment distance in` +
        ` ${truthChecks} (query, thickness, form) checks.`,
    );
    lines.push(
      `  ${floorViolations} queries in ${floorChecks} where S fell below` +
        ` P - h, the floor the entry promises (the S<P-h column, summed).`,
    );
    lines.push(
      `  ${clampedViolations} queries in ${floorChecks} where form (B) came` +
        ` back WORSE than form (A) read the same way, max(0, S) < B.`,
    );
    lines.push(
      "  CAVEAT: spherefoldPair4 is SMOOTH — shells and lobes, no fine" +
        " structure — so its panels cannot show the",
    );
    lines.push(
      "  smoothing failure the boxfold controls show, and a dilation of a" +
        " smooth object is a smooth object. That is",
    );
    lines.push(
      "  exactly why mixedFoldTrio4 is beside it: two 81-branch boxfolds" +
        " under one spherefold, sharp AND on the slack path.",
    );
    lines.push("  VERDICT: see the module header.");
    // Printed BEFORE the numeric assertions, so a failure still ships the
    // table that explains it.
    console.log(lines.join("\n"));
    expect(truthViolations).toBe(0);
    expect(floorViolations).toBe(0);
    expect(clampedViolations).toBe(0);
  });
});
