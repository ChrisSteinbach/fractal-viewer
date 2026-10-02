/**
 * `chain-speckle.harness.ts`'s scene-construction vocabulary, moved verbatim
 * so a worker thread can rebuild the sheet's scenes from data: closures
 * cannot cross `worker_threads`, so what the sheet held as local functions
 * and tables becomes plain data plus two deterministic factories.
 *
 * Nothing here computes anything the harness did not compute before.
 * `chainSpeckleRows` builds each row exactly as the harness's row
 * construction sites did — `buildEscapeDE` over the fixture's transforms,
 * the shipped estimator bound to it, and the set-extent-fitted marching
 * radius — memoized in module scope so the fitted radii are computed once
 * per import no matter how many call sites ask. `chainSpeckleScene`
 * assembles the `PreviewScene` literal the harness's `renderPreview` call
 * sites share. Row order is the harness's: the three FIXTURES rows, then
 * the sphere anchor. No clock, no RNG of its own, no state that differs
 * between a main-thread import and a worker-bundled one.
 */
import {
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_RADIUS,
  buildEscapeDE,
  escapeSetContains,
  estimateEscapeDistance,
} from "../src/fractal/escape-de";
import type { EscapeDE } from "../src/fractal/escape-de";
import type { Transform, VariationType } from "../src/fractal/types";
import type { DistanceEstimator, PreviewScene, Vec3 } from "./de-preview";
import { sampleSetExtent } from "./set-extent";

/** `escape-chain.harness.ts`'s pose, verbatim, so these panels are the ones
 * the question was asked about rather than a second framing. */
export const EYE: Vec3 = [1.348, 0.957, 1.565];
export const ZOOM = 0.52;

// ------------------------------------------------------------- fixtures

/** `escape-chain.harness.ts`'s `foldMap`, duplicated rather than imported:
 * importing a `*.harness.ts` file would register its whole suite here. */
function foldMap(
  id: number,
  type: VariationType,
  weight: number,
  opts: { position?: Vec3; rotation?: Vec3; scale?: Vec3 } = {},
): Transform {
  return {
    id,
    position: opts.position ?? [0, 0, 0],
    rotation: opts.rotation ?? [0, 0, 0],
    scale: opts.scale ?? [1, 1, 1],
    variations: [{ type, weight }],
  };
}

const rot = (deg: number): Vec3 => [0, (deg * Math.PI) / 180, 0];

/** The three lengths the question is about: the single map that already
 * ships (so every reading has the accepted baseline beside it), a two-link
 * chain, and the six-link one. `escape-chain.harness.ts`'s fixtures 1, 2
 * and 8, unchanged. */
export const FIXTURES: [string, Transform[]][] = [
  ["CONTROL single mbox2", [foldMap(1, "mandelbox", 2)]],
  [
    "TWO mbox2 -> boxfold1.6",
    [foldMap(1, "mandelbox", 2), foldMap(2, "boxfold", 1.6)],
  ],
  [
    "SIX mbox2 -> mbox2r20 -> box1.6 -> sph1.2 -> mbox-1.5 -> box1r25",
    [
      foldMap(1, "mandelbox", 2),
      foldMap(2, "mandelbox", 2, { rotation: rot(20) }),
      foldMap(3, "boxfold", 1.6),
      foldMap(4, "spherefold", 1.2),
      foldMap(5, "mandelbox", -1.5),
      foldMap(6, "boxfold", 1, { rotation: rot(25) }),
    ],
  ],
];

/** The anchor row: a unit sphere through the identical marcher, shading and
 * pose. Whatever speckle a SMOOTH solid measures here is the floor every
 * fold reading has to be read against — it is what the instrument itself
 * contributes. */
export const SPHERE: DistanceEstimator = (p) =>
  Math.hypot(p[0], p[1], p[2]) - 1;
export const SPHERE_R = 1.12;
export const SPHERE_LABEL = "ANCHOR unit sphere (a smooth solid)";

/** `escape-chain.harness.ts`'s `fitMarchRadius`, verbatim in effect, so a
 * panel here frames what the sheet in question framed.
 *
 * Reach was a grid over the marching box thresholding the estimate at
 * `1e-3` until the set-extent correction, which is the wrong instrument
 * twice over (`scripts/set-extent.ts` carries both arguments). It asks
 * {@link escapeSetContains} over a seeded uniform sample now, exactly as
 * the sheet it mirrors does — the fitted radii moved by under 1% and no
 * reading in this file depends on which one is used, but a framing
 * quantity computed the wrong way is still a wrong number in a record. */
export function fitMarchRadius(member: (p: Vec3) => boolean): number {
  const { reachAbs } = sampleSetExtent(member, {
    fillRadius: ESCAPE_TIME_RADIUS,
  });
  if (reachAbs <= 0) return ESCAPE_TIME_RADIUS;
  return Math.min(ESCAPE_TIME_RADIUS, Math.max(1.15, reachAbs * 1.06));
}

// ------------------------------------------------------- the rows, as data

/** One calibrated row of `chain-speckle.harness.ts`'s sheet, in the shape
 * both a render call and a worker rebuild need: the label, the raw built DE
 * (`undefined` for the sphere anchor, which has none), the estimator bound
 * for the marcher, and the fitted marching radius. */
export interface ChainSpeckleRow {
  label: string;
  de: EscapeDE | undefined;
  est: DistanceEstimator;
  marchR: number;
}

let rowsMemo: ChainSpeckleRow[] | undefined;

/** The sheet's four rows — the three FIXTURES rows, then the sphere anchor
 * — built exactly as the harness's row-construction sites build them, and
 * memoized so repeated calls return the same objects (the fitted radii are
 * computed once). Fixture rows carry the raw `de` (tests that mirror the
 * hit-info overload read it directly); the sphere row has none. */
export function chainSpeckleRows(): ChainSpeckleRow[] {
  if (rowsMemo) return rowsMemo;
  const rows: ChainSpeckleRow[] = FIXTURES.map(
    ([label, transforms]): ChainSpeckleRow => {
      const de = buildEscapeDE(transforms);
      const est: DistanceEstimator = (p) => estimateEscapeDistance(de, p);
      return {
        label,
        de,
        est,
        marchR: fitMarchRadius((p) => escapeSetContains(de, p)),
      };
    },
  );
  rows.push({
    label: SPHERE_LABEL,
    de: undefined,
    est: SPHERE,
    marchR: SPHERE_R,
  });
  rowsMemo = rows;
  return rowsMemo;
}

/** The spec `chainSpeckleScene` builds a scene from — named so the harness's
 * parallel call sites can type their args against the factory's own input. */
export interface ChainSpeckleSceneSpec {
  row: number;
  maxSteps?: number;
  stepScale?: number;
  ao?: boolean;
  shadow?: boolean;
}

/** The `PreviewScene` the harness's `renderPreview` call sites build:
 * the row's estimator over its fitted radius, at the sheet's shared pose,
 * collecting panel stats. `maxSteps`/`stepScale`/`ao`/`shadow` ride only
 * when the spec carries them; absent `maxSteps`/`ao`/`shadow` mean the
 * `renderPreview` defaults byte-identically, and absent `stepScale`
 * carries the shipped escape damping — the interface REQUIRES the field
 * and the marcher multiplies by it directly (`PreviewScene` carries no
 * runtime default), so `chain-speckle.harness.ts`'s shipped arm passes
 * {@link ESCAPE_STEP_SCALE} at every one of its call sites. Throws for an
 * out-of-range `row`. */
export function chainSpeckleScene(spec: ChainSpeckleSceneSpec): PreviewScene {
  const rows = chainSpeckleRows();
  const row = rows[spec.row];
  if (!row) {
    throw new Error(
      `chainSpeckleScene: row ${spec.row} out of range (0..${rows.length - 1})`,
    );
  }
  const scene: PreviewScene = {
    de: row.est,
    boundingRadius: row.marchR,
    stepScale: spec.stepScale ?? ESCAPE_STEP_SCALE,
    eyeOffset: EYE,
    zoom: ZOOM,
    collect: true,
  };
  if (spec.maxSteps !== undefined) scene.maxSteps = spec.maxSteps;
  if (spec.ao !== undefined) scene.ao = spec.ao;
  if (spec.shadow !== undefined) scene.shadow = spec.shadow;
  return scene;
}
