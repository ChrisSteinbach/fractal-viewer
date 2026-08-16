/**
 * WHAT THE CHEAP SLAB COSTS: BALL SLACK AGAINST THE EXACT SEGMENT (fr-v7ca).
 *
 * `surface-de-4d.ts` REFUSES fr-wa6o slab queries — `halfExtent`, thickness
 * `h > 0` — for any 4D system whose fold set includes a spherefold or a
 * mandelbox (`slabExact4`). The reason is sound and not negotiable: the
 * spherefold MID branch is a sphere inversion, an inversion takes the slab's
 * SEGMENT to a circular ARC, and min-radius-over-chord is not
 * min-radius-over-arc in either direction, so the segment certificate stops
 * being a lower bound. Box-fold-only systems keep the exact segment slab.
 * Two candidate lifts stand open, and this sheet exists to pick between them
 * with numbers rather than with taste:
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
 * WHY A BOXFOLD-ONLY SYSTEM ANSWERS A SPHEREFOLD QUESTION, which is the one
 * thing to be convinced of before reading a single number below. The two
 * arms this sheet renders are the two ENDPOINTS of form (B):
 *
 *   - EXACT (`estimateDistance4Refined(de, q, 0, halfExtent)`, the shipped
 *     segment machinery) is (B) with NO mid crossing ever — a boxfold branch
 *     inverse is a per-axis reflection ± translation, so `e` is transported
 *     exactly at every level and `rho` never leaves 0. That is (B) at its
 *     ceiling.
 *   - BALL (form (A)) is (B) with the crossing at DEPTH 0. The slack is
 *     carried down as `rho_d = h · prod(1/sigma_min)` and every certificate
 *     is scaled back out by `chainScale = prod(sigma_min)`, so
 *     `chainScale · rho_d = h` exactly: a ball adopted at the query and a
 *     subtraction of `h` at the very end are the same number. The beam's
 *     SELECTION survives that too — the shift is the same `h` on every
 *     chain, whatever its path, so the argmin is unmoved and the two are the
 *     same descent and not merely the same value.
 *
 * A real spherefold system lands BETWEEN them, at a position set by how deep
 * its first mid crossing is. So the EXACT-vs-BALL gap measured here is the
 * FULL SPAN of form (B), and an upper bound on what (B) could ever buy.
 * (What this sheet does NOT measure is where inside that span a given
 * spherefold system actually falls: `FoldFrontierTap4` reports candidates
 * but not branch INDICES, and deciding the mid region here would mean a
 * second copy of the branch algebra in a file that has no business owning
 * one. The bracket is the honest instrument.)
 *
 * THE INSTRUMENT is `de-preview.ts`'s shared CPU marcher — no ninth marcher,
 * and the two shading terms that read the marcher's own STATISTICS rather
 * than the object (the step-count AO stand-in, the cone-traced shadow) are
 * both OFF, because the arms differ in step count by construction and a
 * comparison sheet must differ only in the formula. Four systems, all
 * `slabExact4` so the EXACT control exists: a pure-boxfold pair (the 81-branch
 * 4D fold frontier), a boxfold + two affine maps (the mixed frontier), a
 * boxfold FINAL lens over an affine 4D base (`descendLens4`), and the shipped
 * `sixteenCellFlake` preset (the plain affine ladder — the shape the slice
 * slider actually runs on today). One fixed pose per system, fitted once to
 * the widest slab so every row is the same camera. Plus one SPHEREFOLD row,
 * where no EXACT control exists — that being the whole point of the bead —
 * so the sheet shows the actual deliverable and not only its control.
 *
 * WHAT IT CONCLUDED: NEITHER — KEEP THE REFUSAL. Form (A) does not render a
 * slab, and form (B)'s advantage is unmeasurable from outside the descent
 * and collapses structurally on exactly the systems the lift is for. The
 * numbers, in the order the sections establish them:
 *
 *  1. (A) IS A DILATION, AND THE PICTURES SAY IT FIRST. On
 *     `sixteenCellFlake` the exact slab is a crisp Sierpinski-shaped fractal
 *     at EVERY thickness — hit rate 17.64% -> 20.40% across the whole sweep
 *     — while (A) is a smooth lobed blob by slider 0.10, a featureless dark
 *     ball by 0.35, and the bare marching ball by 0.50 (44.36% of rays,
 *     steps/px 0.0: every ray hits on entry). `boxfoldTrio4` and
 *     `boxfoldPair4` hold their structure to slider ~0.10 and are smooth
 *     capsules by 0.35. Coverage says the same: at slider 0.50 (A) hits
 *     2.72 / 1.77 / 3.66 / 2.22x as many rays as the exact slab.
 *
 *  2. ON TWO OF THE FOUR CONTROLS, (A) IS FURTHER FROM THE EXACT SLAB THAN
 *     DOING NOTHING AT ALL. Hit-mask IoU against EXACT at slider 0.50 —
 *     BALL vs POINT: 0.360/0.035 and 0.566/0.136 (the two base-fold systems,
 *     where BALL wins by 10x and 4x), but 0.273/0.276 on the boxfold LENS
 *     and 0.451/0.882 on the flake, where POINT wins — and on the flake
 *     POINT wins at every stop from 0.05 up. In marched DEPTH, POINT wins on
 *     all four at every stop worth quoting: mean |dt| against EXACT at
 *     slider 0.50 is 0.112 / 0.286 / 0.080 / 0.927 world units for BALL
 *     against 0.037 / 0.167 / 0.004 / 0.041 for POINT — 16.9-68.8% of the
 *     marching-ball radius against 0.8-15.2%. (A) does not merely add a
 *     silhouette rind; it floats the whole surface `h` toward the camera.
 *
 *  3. IT ADDS RIND WHERE THE REAL SLAB ADDS STRUCTURE. Chebyshev distance
 *     from each ADDED pixel to the arm it is added to, at slider 0.50: 61% /
 *     46% / 71% of (A)'s additions sit within 2px of EXACT's own hits,
 *     against 23% / 26% / 57% for the genuine slab's additions over POINT.
 *     The fourth system INVERTS the statistic (27% against 88%) and that is
 *     a worse result, not a better one: (A) has covered the whole ball
 *     there, so its additions are nowhere near EXACT's hits at all.
 *
 *  4. AS A BOUND IT OVERCHARGES BY 4x TO 333x, and the mechanism is
 *     DIRECTION-BLINDNESS. The segment reaches only in `w`; (A) has to
 *     assume every direction. Median estimate as a fraction of
 *     the point query at slider 0.50: the exact slab keeps 0.964 / 0.850 /
 *     0.990 / 0.997 of it — a true slab costs the bound 0.3-15% — while (A)
 *     keeps 0.600 / 0.381 / 0.713 / 0.000, i.e. charges 29-100% for the same
 *     thickness, an overcharge of 11.1 / 4.1 / 29.8 / 333.3x (the
 *     `charge/worth` column, and 4.1-335.5x over the whole sweep).
 *     Volumetrically, (A) returns 0 where the segment returns
 *     something positive over 8.0% / 21.5% / 3.5% / 100% of the marching
 *     ball. The whole of (A)'s behaviour is ONE dimensionless number — `h`
 *     over the DE's own typical value, which is exactly what the `med B/P`
 *     column is one minus — and `h` is `slider · wSupport`, so the systems
 *     that break are the ones that are genuinely THICK in `w`. Those are the
 *     systems a slice-thickness slider exists for.
 *
 *  5. BOTH FORMS ARE SOUND, WHICH SETTLES NOTHING. 0 violations of the true
 *     segment distance in 9600 (query, thickness, form) checks against a
 *     12000-point seeded cloud, at every thickness including the ones past
 *     the slider's ceiling. "Sound in one line" is true of (A) and is not
 *     the same claim as "renders the slab".
 *
 *  6. AND (B) CANNOT BE JUSTIFIED FROM OUTSIDE THE DESCENT. Its ceiling is
 *     real — the EXACT column above IS that ceiling, and it is excellent —
 *     but it is reached only where no mid crossing happens, i.e. on the
 *     systems that already have the exact slab. Every system the lift is for
 *     crosses the mid branch; that is what `slabExact4` refuses on, and each
 *     crossing drops (B) toward (A). This sheet BRACKETS (B) between its two
 *     arms and the bracket is wide (IoU 0.27-0.57 against 1.0; bound
 *     overcharge 4-333x), so where inside it a real
 *     spherefold system lands is the whole question — and it is not
 *     answerable here.
 *
 * WHAT WOULD REOPEN IT, both cheap next to a frontier register:
 *
 *   - THE CROSSING-DEPTH INSTRUMENT. Report the depth of the FIRST
 *     spherefold MID crossing per query (`FoldFrontierTap4` reports
 *     candidates but not branch INDICES today, which is why this sheet
 *     cannot). Typically depth 0-1 makes (B) identically (A) and the refusal
 *     permanent; deep makes (B) worth its register, and this sheet's EXACT
 *     column is then the prize.
 *   - A PER-SYSTEM THICKNESS CAP. (A) tracks the exact slab wherever
 *     `h / DE` stays small, and that ratio is knowable from a cheap probe
 *     BEFORE any render (`escape-de.ts`'s pre-scale method one family over:
 *     measure the budget on the CPU, then pick). A capped (A) is a third
 *     design and not one of the three this sheet was asked to choose
 *     between, so it is named rather than recommended.
 *
 * ONE CAVEAT THE VERDICT CARRIES, in the direction of caution. The
 * spherefold pair in section 4 is SMOOTH — shells and lobes, no fine
 * structure, `qjulia-de.ts`'s finding one map over — so its panels cannot
 * show the smoothing failure the boxfold controls show, and its clean-looking
 * sweep (3.56% -> 27.67% of rays over the slider, 0 exhausted rays, a
 * coherent object at every stop) must not be read as (A) passing. A
 * dilation of a smooth object is a smooth object. What section 4 does
 * establish is the negative: the estimators DO throw there today (asserted),
 * so the refusal is real and (A) is the only arm that can draw anything at
 * all.
 */
import {
  buildSurfaceDE4,
  deHasFolds4,
  estimateDistance4,
  estimateDistance4Refined,
  slabExact4,
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
/** Queries per (system, thickness) in sections 2 and 3. */
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

/** EXACT: the shipped segment machinery — form (B) with no mid crossing. */
function exactArm(frame: Frame, h: number): DistanceEstimator {
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
        exact.push(renderArm(frame, exactArm(frame, h), PANEL));
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
        "    slider |  dt(E,B) mean    p95 |  dt(E,P) mean    p95 |  steps/px  E     B     P |  ms E    B",
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
            " |" +
            num(gapP.mean, 4, 13) +
            num(gapP.p95, 4, 7) +
            " |" +
            num(exact[i].panel.steps / (PANEL * PANEL), 1, 11) +
            num(ball[i].panel.steps / (PANEL * PANEL), 1, 6) +
            num(point.panel.steps / (PANEL * PANEL), 1, 6) +
            " |" +
            num(exact[i].panel.ms, 0, 6) +
            num(ball[i].panel.ms, 0, 6),
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

  it("section 4: the deliverable — what form (A) draws on a spherefold system, where the estimators throw today", () => {
    const spec: SystemSpec = {
      name: "spherefoldPair4",
      transforms: spherefoldPair4(),
      final: null,
    };
    const frame = fitFrame(spec);
    expect(slabExact4(frame.de)).toBe(false);
    const at: Vec4 = [
      frame.target[0],
      frame.target[1],
      frame.target[2],
      frame.w0,
    ];
    // The refusal itself, asserted rather than quoted: this is the state of
    // the world the recommendation is about.
    expect(() => estimateDistance4(frame.de, at, [0, 0, 0, 0.1])).toThrow(
      /slab queries are unsound/,
    );
    expect(() =>
      estimateDistance4Refined(frame.de, at, 0, [0, 0, 0, 0.1]),
    ).toThrow(/slab queries are unsound/);

    const lines: string[] = [];
    lines.push("");
    lines.push(describeFrame(spec.name, frame));
    lines.push(
      "  Both public estimators THROW on a slab query here (asserted above)," +
        " so BALL is the only arm that exists.",
    );
    lines.push(
      "    slider       h  h/visR |  hit%  steps/px  exhausted |  IoU(B, h=0)   ms",
    );
    const stops = [0, ...SLIDER_STOPS];
    const arms = stops.map((stop) =>
      renderArm(frame, ballArm(frame, stop * frame.wSupport), PANEL),
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
          num(pct(arms[i].panel.hits, PANEL), 2, 6) +
          num(arms[i].panel.steps / (PANEL * PANEL), 1, 10) +
          cell(String(arms[i].panel.exhausted), 12) +
          " |" +
          num(iou(arms[0].hit, arms[i].hit), 3, 13) +
          num(arms[i].panel.ms, 0, 6),
      );
    });
    lines.push(
      `  wrote ${writeContactSheet(
        arms.map((a) => a.panel),
        stops.length,
        "slab-ball-slack-spherefold.png",
      )}  (BALL at slider ${stops.join(", ")})`,
    );
    lines.push(
      "  CAVEAT: this pair is SMOOTH, so its panels cannot show the smoothing" +
        " failure the boxfold controls show.",
    );
    lines.push("");
    lines.push(
      "  VERDICT — KEEP THE REFUSAL. (A) is a dilation, not a slab: it floats" +
        " the marched surface h toward the",
    );
    lines.push(
      "  camera, charges 29-100% of the bound where the exact segment charges" +
        " 0.3-15%, and is FURTHER from the",
    );
    lines.push(
      "  exact slab than doing nothing on two of four controls. (B)'s ceiling" +
        " is the EXACT column and is worth",
    );
    lines.push(
      "  having, but it is reached only where no mid crossing happens — i.e." +
        " on the systems that already have",
    );
    lines.push(
      "  the exact slab. See the module header for what would reopen it.",
    );
    console.log(lines.join("\n"));
  });
});
