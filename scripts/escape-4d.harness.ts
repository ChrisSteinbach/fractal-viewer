/**
 * WHAT A 4D ESCAPE-TIME CHAIN LOOKS LIKE, BEFORE ANY PRESET SHIPS (fr-vag4).
 *
 * `escape-de-4d.ts` exists; nothing renders it yet and no preset reaches it.
 * This sheet is the measurement that comes first — the project's standing
 * discipline, and the one fr-vag4 states outright. It asks the two questions
 * a preset choice needs answered: WHICH 4D KNOB BUYS AN OBJECT, and WHAT DOES
 * A ROTOR-POSED `w`-SLICE OF ONE ACTUALLY DRAW.
 *
 * THE KNOB UNDER TEST IS A `w` ROTATION, AND THAT IS THE WHOLE FRAMING.
 * fr-wuuu already measured the other one and came back negative: the
 * quaternion square's `k` component — a `w` TRANSLATION on a chain link —
 * "does not buy an object", behaving like a weaker fourth translation, with
 * every slice off `w = 0` an EROSION of the `w = 0` set (containment 94-98%,
 * nothing left to draw by `w0 = 0.8`). A translation cannot mix `w` with a
 * spatial axis; it can only slide the object along an axis the render then
 * cuts across. `w: { rotation: { xw, yw, zw } }` MIXES, which is the genuinely
 * four-dimensional deformation and the one nobody has measured. Every row
 * below turns that knob and nothing else.
 *
 * WHAT IT CONCLUDED, in order:
 *
 *  1. THE ANCHOR HOLDS AT SHEET LEVEL. Five flat systems x 55937 queries — a
 *     33^3 grid over [-4, 4] at 0.25 spacing, which lands 9 planes per axis
 *     exactly on the integers and so hits the classic box wall `±1` and its
 *     `±2` image dead on, plus 20000 seeded ball draws for the interior — and
 *     `estimateEscapeDistance4` at `w = 0` is `estimateEscapeDistance` on all
 *     279685 of them, to the bit, membership included. The slice-fill
 *     instrument this sheet uses is bit-equal to the shipped
 *     `probeEscapeFill` on the same five (3.5400 / 0.9033 / 1.1963 / 1.4893 /
 *     0.3418%). So every row below is comparable with an
 *     `escape-chain.harness.ts` row BY CONSTRUCTION rather than by claim.
 *
 *  2. THE `w` ROTATION BUYS VOLUME AND COSTS ENTRY-POSE PRESENCE, and the two
 *     hit columns DISAGREE — which is the finding, not an artefact. Over
 *     `xw` 0 -> 1.2 on `mbox2 -> boxfold1.6`, 4-ball fill goes 0.334 ->
 *     0.565%, slice fill 1.080 -> 1.841% (a 70% lift), reach BARELY MOVES
 *     (2.00 -> 2.07) — and hits fall 40.5 -> 30.9% at the fixed bailout ball
 *     while staying FLAT at each row's own fitted ball (62.3 -> 60.6%, the
 *     whole sweep inside 57.5-62.6%). READ THE FITTED COLUMN FOR SHAPE AND THE
 *     BAILOUT COLUMN FOR WHAT A SESSION OPENS ON — a preset owes the second,
 *     because `buildEscapeDE4` pins `boundingRadius` to the bailout ball and
 *     main.ts frames a new escape session on exactly that.
 *
 *     AND THE TEMPTING EXPLANATION FOR THAT DROP IS WRONG, which is why the
 *     A/B at the foot of that test exists. "The rotation makes the object
 *     FINER, so more of it falls below the pixel at the coarse framing, and
 *     the shipped tracer's 8x settle supersampling would give it back" is
 *     testable in one line and FAILS: doubling the panel to 600px moves both
 *     rows slightly DOWN (40.50 -> 39.49% flat, 30.90 -> 30.41% rotated) and
 *     leaves the gap where it was. The drop is the object's own coverage of
 *     the fixed entry frame, and a preset must not expect antialiasing to
 *     repay it.
 *
 *     WHICH LINK CARRIES THE ROTATION MATTERS, and the PER-AXIS EXTENT column
 *     says why. Rotating the HEAD (the `mandelbox w=2`) of the quaternion
 *     chain costs a third of its rays — 49.2 -> 32.6% — and FLATTENS the set
 *     along the rotated axis while the other two hold: extents run
 *     3.99/4.00/3.99 -> 3.16/4.00/3.99 -> 1.29/4.00/3.99. Rotating the
 *     QSQUARE link instead leaves all three at 3.99/4.00/3.99 on every row,
 *     holds 47.5 / 46.7 / 46.9 / 46.0 / 43.8 / 51.6% of rays, and still lifts
 *     slice fill 1.587 -> 2.190%. A head link's rotation reaches every later
 *     step through the whole orbit; a power link's output is tested before any
 *     fold can compound it, so a rotation there deforms without shrinking. IF
 *     ONE ROW OF THIS SHEET DECIDES A PRESET, IT IS THAT ONE. (Blocks (a) and
 *     (b) are the honest caveat: their extents move only 5-8% with no clean
 *     trend, so the entry-pose drop there is NOT fully accounted for by size.)
 *
 *  3. THE `w0` SLICE IS NOT fr-wuuu's EROSION, AND THAT IS THIS SHEET'S
 *     CONTRADICTION OF IT. Sliding `w0` over 0 / 0.1 / 0.2 / 0.4 / 0.8 / 1.2
 *     on the section-2 subject thins the slice hard — members 5444 -> 5240 ->
 *     5173 -> 4256 -> 2175 -> 429, slice fill 2.079 -> 0.163% — but the
 *     CONTAINMENT column reads 57.0 / 55.3 / 52.5 / 61.3 / 61.5%, where
 *     fr-wuuu's `k`-component sweep read 94-98%. Roughly half of every
 *     offset slice's members are NOT members of the `w0 = 0` slice, so these
 *     are genuinely different cuts and not a shrinking subset. And it never
 *     goes blank: fr-wuuu's `k` sweep drew 0.0% of its rays by `w0 = 0.8`,
 *     while a `w`-ROTATED chain still draws 16.0% at the entry pose and 47.9%
 *     at its own fitted frame at `w0 = 1.2`. A `w` ROTATION GIVES THE OBJECT
 *     REAL THICKNESS AND REAL VARIATION IN `w`; the translation knob gave it
 *     neither. The slice slider is a live knob here, but it pays in density.
 *
 *  4. THE ROTOR IS A PROPORTION KNOB — ON AN ANISOTROPIC SYSTEM, AND ONLY
 *     THERE. Two subjects, two answers, and printing both is the point.
 *     Section 3's chain is near-ISOTROPIC in `w`: its three `w`-FREE control
 *     poses read slice fill 2.016-2.084%, containment 55.2-56.3%, IoU
 *     0.379-0.382, and its `w`-MIXING poses read 1.914-1.997%, 57.2-59.1%,
 *     0.388-0.403 — separated from the controls, consistently, and only just.
 *     The BRICK (`mandelboxCube` with `xw = 1`) is anisotropic BY
 *     CONSTRUCTION and the same instrument is emphatic. Its `w`-free controls
 *     hold members to 0.4% (67367-67604 against the identity's 67427) and
 *     fill to 0.5%, containment 75.6-77.2% — a rigid turn, exactly as the
 *     algebra requires. Its `xw` rotor poses drop 20-28% of their members,
 *     contain at 93.9-94.5% (a SUBSET), and walk the PER-AXIS EXTENT from
 *     3.13/2.00/2.00 through 2.39 and 2.14 to EXACTLY 2.00/2.00/2.00 at rotor
 *     `xw = 1.0` — the rotor cancelling the document's own `xw = 1` and
 *     handing back cube proportions. `zw 0.6` redirects instead
 *     (3.13/2.00/2.42). That column is `axisExtent`, and `reach` cannot see
 *     any of it: reach is a radius and a brick and a cube of the same
 *     diagonal read identically through it.
 *
 *  5. THE SHORTLIST, ranked at the entry pose, is at the bottom and is what
 *     this sheet is for. Its headline candidate is the one no 3D document can
 *     express: `mandelboxCube` — the solid cube with medallioned faces — under
 *     a `w` rotation becomes a BRICK, and the ROTATION PLANE PICKS WHICH AXIS
 *     ELONGATES. In the extent column, to the number: the 3D control reads
 *     2.00/2.00/2.00, `xw = 1` reads 3.13/2.00/2.00 and `yw = 0.8` reads
 *     2.00/2.49/2.00. That is a 4D rotation showing up as a 3D proportion, on
 *     the cheapest system in the family.
 *     Its weakest candidate is measured too, and named as weakest: a `w`-plane
 *     KALEIDOSCOPE is a different object (IoU 0.673) but NOT a visible
 *     rosette, because the wedge's symmetry plane contains `w` and so does not
 *     lie in the rendered slice. Worse, at EVEN order it is a no-op on that
 *     slice altogether — 1 of 262144 cloud points changes side at orders 2, 4,
 *     6 and 8, against 3821 and 3662 at orders 3 and 5 — so a preset authored
 *     at order 4 would silently be its 3D twin. (The 1 point is not a
 *     coincidence either: `Math.sin(Math.PI)` is 1.22e-16, so the wedge leaks
 *     that much `w` into a query that was exactly on the slice.)
 *
 * INSTRUMENTS, and the two this family keeps getting wrong. FILL IS NEVER A
 * VISIBILITY PREDICATE, and this sheet's own shortlist makes the point without
 * borrowing one: `escapeShells4` occupies 0.346% of the 4-ball and 1.777% of
 * its rendered slice while drawing 43.7% of its rays, against `escapeBrick`'s
 * 14.816% / 25.705% and 41.4%. A 43x difference in volume; a 1.06x difference
 * in what the marcher finds. (`escape-de.ts`'s own record has the limiting
 * case, `mandelboxRings` at 0.000% fill and 44.9% of rays.) So both columns
 * are printed side by side on every row and the verdict is read off the HIT
 * column. And no grid and no distance
 * threshold measures a set: SLICE fill and reach come from `set-extent.ts`'s
 * `sampleSetExtent` against the membership oracle `escapeSetContains4`, and
 * the 4-BALL fill from `probeEscapeFill4` itself. `set-extent.ts`'s API IS 3D
 * (`member: (p: Vec3) => boolean`) and that is exactly right here rather than
 * a limitation: a slice of a 4D set IS a 3D set, and the caller's oracle is
 * where the lift lives. The one place it does not reach is the 4-BALL volume,
 * which is `probeEscapeFill4`'s own volume-uniform S³ draw. A GRID APPEARS
 * ONCE, in the anchor test, and only because the question there is BIT
 * EQUALITY rather than volume — a grid's alignment with a fold's walls is a
 * defect for a volume estimate and an advantage for an equality check.
 *
 * Every panel runs through `de-preview.ts`'s identical shading, so a sheet
 * compares OBJECTS and not lighting, and the sibling harnesses' caveat
 * applies: no empty-space grid, no tier-pinned acceptance epsilon, a 600-step
 * budget — fold surfaces speckle here where the shipped tracer resolves them.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/escape-4d.harness.ts
 * Writes, all under `scripts/out/`: `escape-4d-rotation.png` (section 2 — four
 *   blocks of seven, angle left to right), `escape-4d-slice.png` (section 3 —
 *   `w0` left to right), `escape-4d-rotor.png` (section 4 — subject (a)'s
 *   eight poses then subject (b)'s), `escape-4d-shortlist.png` (section 5 —
 *   THE DELIVERABLE: six candidates in ranked order, then the two 3D controls)
 *
 * Costs ~2 minutes on a quiet machine (CPU only — nothing here needs a GPU or
 * a display, and no verdict depends on timing).
 */
import {
  analyzeEscapeSystem,
  buildEscapeDE,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
  escapeSetContains,
  estimateEscapeDistance,
  probeEscapeFill,
} from "../src/fractal/escape-de";
import {
  analyzeEscapeSystem4,
  buildEscapeDE4,
  escapeSetContains4,
  estimateEscapeDistance4,
  probeEscapeFill4,
} from "../src/fractal/escape-de-4d";
import type { EscapeDE4 } from "../src/fractal/escape-de-4d";
import { mulberry32 } from "../src/fractal/rng";
import {
  identityRotorPair,
  rotateInPlane,
  rotorMatrix,
} from "../src/app/rotor4";
import type { RotorPair } from "../src/app/rotor4";
import type {
  Rotation4,
  SymmetryParams,
  Transform,
  Vec4,
} from "../src/fractal/types";
import { renderPreview, writeContactSheet } from "./de-preview";
import type { DistanceEstimator, PanelStats, Vec3 } from "./de-preview";
import { sampleSetExtent, SET_SAMPLE_POINTS } from "./set-extent";

/** Panel size for the deliverable sheet, and for the sweeps. The sweeps are
 * the same objects, cheaper — nothing in sections 2-4 is decided on a detail
 * a 300px panel hides, and section 5 is what a preset is picked off. */
const SIZE = 420;
const SMALL = 300;

/** `escape-chain.harness.ts`'s pose, verbatim, so a row here and a row there
 * are the same camera. Its own note: `de-preview.ts` fogs on absolute ray
 * distance, so the module default buries a fitted object; this sits at 2.2
 * marching radii with the frustum widened to keep the silhouette in frame,
 * and still outside the marching ball. */
const EYE: Vec3 = [1.348, 0.957, 1.565];
const ZOOM = 0.52;

/** Points every SLICE fill/reach column is sampled at — `set-extent.ts`'s own
 * budget, which is also `probeEscapeFill`'s, so a figure here is quotable
 * against one from any other sheet in the family. */
const FILL_POINTS = SET_SAMPLE_POINTS;

/** Points the 4-BALL fill is sampled at. Above the brief's 65536 floor and
 * equal to {@link FILL_POINTS} on purpose: the two columns then differ by
 * WHICH SET they measure (the whole 4-ball against the `w = 0` slice of it)
 * and never by how hard they looked. */
const BALL4_POINTS = SET_SAMPLE_POINTS;

/** Points in the fixed containment cloud (section 3/4). Twice the fill budget,
 * for `hybrid-chain.harness.ts`'s reason: a 1.6%-fill set puts ~2k of 131072
 * points inside, and a containment fraction standing on 2k members cannot
 * resolve the small-perturbation rows. */
const CLOUD_POINTS = 2 * SET_SAMPLE_POINTS;

// ------------------------------------------------------- the document shape

/** The link kinds `analyzeEscapeSystem4` admits. `bulb` is absent because the
 * gate refuses it BY NAME — triplex numbers are R³ and have no fourth
 * component (`escape-de-4d.ts`'s WHAT LIFTS section) — so a fixture carrying
 * one would only ever measure the refusal. */
type LinkKind = "mandelbox" | "boxfold" | "spherefold" | "qsquare";

/** The three `w`-mixing rotation planes, i.e. the knob (`types.ts`'s
 * {@link import("../src/fractal/types").WExtension}`.rotation`). */
type WRotation = Pick<Rotation4, "xw" | "yw" | "zw">;

/**
 * One chain link as the DOCUMENT spells it — `presets.ts`'s `foldLink` and
 * `hybridLink` merged, plus the one field neither has: the `w` block.
 *
 * A spec rather than a `Transform` because the shortlist's deliverable is
 * SOURCE. {@link spell} prints these back as the literal a `presets.ts`
 * function would return, `(20 * Math.PI) / 180` and all, so a candidate can be
 * pasted rather than transcribed.
 */
interface LinkSpec {
  type: LinkKind;
  /** The variation weight — the classic Mandelbox `scale` for the folds. */
  weight: number;
  /** Uniform affine pre-scale (`hybridLink`'s fourth parameter). */
  scale?: number;
  /** Degrees about `y` (`foldLink`'s fourth parameter). */
  rotY?: number;
  /** THE KNOB: `w`-mixing rotation planes, in radians. */
  w?: WRotation;
}

/** A whole candidate: the link list and the kaleidoscope it is authored
 * under. `symmetry` is separate from the links for `presets.ts`'s reason —
 * it rides `PRESET_SYMMETRIES`, not the transform list. */
interface SystemSpec {
  links: LinkSpec[];
  symmetry?: SymmetryParams;
}

function transformOf(spec: LinkSpec, id: number): Transform {
  const s = spec.scale ?? 1;
  const t: Transform = {
    id,
    position: [0, 0, 0],
    rotation: [0, ((spec.rotY ?? 0) * Math.PI) / 180, 0],
    scale: [s, s, s],
    variations: [{ type: spec.type, weight: spec.weight }],
  };
  if (spec.w) t.w = { rotation: { ...spec.w } };
  return t;
}

function transformsOf(spec: SystemSpec): Transform[] {
  return spec.links.map(transformOf);
}

/** A candidate as `presets.ts` would spell it — the shortlist's actual
 * deliverable. Indented as a preset body so the output is paste-ready. */
function spell(spec: SystemSpec): string {
  const lines = spec.links.map((l, id) => {
    const s = l.scale ?? 1;
    const rot = l.rotY ? `[0, (${l.rotY} * Math.PI) / 180, 0]` : `[0, 0, 0]`;
    const wBlock = l.w
      ? `\n      w: { rotation: { ${Object.entries(l.w)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")} } },`
      : "";
    return (
      `    {\n` +
      `      id: ${id},\n` +
      `      position: [0, 0, 0],\n` +
      `      rotation: ${rot},\n` +
      `      scale: [${s}, ${s}, ${s}],\n` +
      `      variations: [{ type: "${l.type}", weight: ${l.weight} }],` +
      `${wBlock}\n` +
      `    },`
    );
  });
  const sym = spec.symmetry
    ? `\n  // PRESET_SYMMETRIES: { order: ${spec.symmetry.order}, ` +
      `plane: "${spec.symmetry.plane}" }`
    : "";
  return `  return [\n${lines.join("\n")}\n  ];${sym}`;
}

// ------------------------------------------------------------- the lift

/** How a 3D marched point becomes the 4D query — the whole geometry of a
 * slice, and the one thing this sheet varies besides the document. */
type Lift = (p: Vec3) => Vec4;

/** The plain `w = w0` hyperplane: the tracer at the identity rotor pose. */
function sliceLift(w0: number): Lift {
  return (p) => [p[0], p[1], p[2], w0];
}

/**
 * The rotor-posed slice, mirroring what the kernel body does:
 * `q = rotorInv · vec4f(p, w0)`.
 *
 * `rotor` is the WORLD rotor exactly as `four-d-view.ts`'s `matrix()` produces
 * it (row-major, attractor space INTO view space). The tracer needs the
 * opposite direction and a rotation's inverse is its transpose, which is why
 * `surface-material-4d.ts`'s `setSurfaceView4` builds `uInvRotor` from the
 * SAME 16 numbers with rows and columns swapped. So this reads column-major:
 * `out[i] = sum_j rotor[j*4 + i] * v[j]`.
 */
function rotorLift(rotor: number[], w0: number): Lift {
  return (p) => {
    const v = [p[0], p[1], p[2], w0];
    const out: Vec4 = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      out[i] =
        rotor[i] * v[0] +
        rotor[4 + i] * v[1] +
        rotor[8 + i] * v[2] +
        rotor[12 + i] * v[3];
    }
    return out;
  };
}

/** The 4D estimator bound to a lift, ready for `de-preview.ts`. */
function de4Of(de: EscapeDE4, lift: Lift): DistanceEstimator {
  return (p) => estimateEscapeDistance4(de, lift(p));
}

/** The MEMBERSHIP oracle bound to a lift — what every fill, reach and
 * containment column below asks, and never a threshold on the estimate
 * (`set-extent.ts`'s defect 2). */
function member4Of(de: EscapeDE4, lift: Lift): (p: Vec3) => boolean {
  return (p) => escapeSetContains4(de, lift(p));
}

// ------------------------------------------------------------ measurement

/** `escape-chain.harness.ts`'s fit, verbatim: over-estimate deliberately
 * (rays entering further out cost steps, never geometry), and fall back to
 * the whole bailout ball when the sampler found no members at all — which
 * `mandelboxRings` reaches, and which must not collapse the frame onto an
 * object the marcher can plainly see. */
function fitMarchRadius(reachAbs: number): number {
  if (reachAbs <= 0) return ESCAPE_TIME_RADIUS;
  return Math.min(ESCAPE_TIME_RADIUS, Math.max(1.15, reachAbs * 1.06));
}

function hitPct(panel: PanelStats, size: number): number {
  return (100 * panel.hits) / (size * size);
}

/** The one fixed 3D cloud every containment column scores against — the same
 * points for every row, so two rows differ by their SET and not by their
 * sample. Uniform in the radius-4 ball, `probeEscapeFill`'s own draw. */
const CONTAINMENT_CLOUD = (() => {
  const rng = mulberry32(0x4d_c10d);
  const pts = new Float64Array(CLOUD_POINTS * 3);
  for (let i = 0; i < CLOUD_POINTS; i++) {
    const u = Math.cbrt(rng()) * ESCAPE_TIME_RADIUS;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    pts[i * 3] = u * st * Math.cos(ph);
    pts[i * 3 + 1] = u * st * Math.sin(ph);
    pts[i * 3 + 2] = u * ct;
  }
  return pts;
})();

function memberMask(member: (p: Vec3) => boolean): Uint8Array {
  const mask = new Uint8Array(CLOUD_POINTS);
  for (let i = 0; i < CLOUD_POINTS; i++) {
    mask[i] = member([
      CONTAINMENT_CLOUD[i * 3],
      CONTAINMENT_CLOUD[i * 3 + 1],
      CONTAINMENT_CLOUD[i * 3 + 2],
    ])
      ? 1
      : 0;
  }
  return mask;
}

/**
 * The slice's PER-AXIS support — `max |x|`, `max |y|`, `max |z|` over the
 * members of {@link CONTAINMENT_CLOUD}.
 *
 * The column the rotor question turns on, and the one a scalar `reach` cannot
 * supply: `reach` is a radius and is blind to PROPORTION, so a brick and a
 * cube of the same diagonal read identically through it. Three numbers say
 * which axis is long.
 *
 * Resolution-limited exactly as `set-extent.ts`'s reach is, and for the same
 * reason (a fractal has structure below any sampling density): read it as
 * "the outermost coordinate at which this instrument can see the set", never
 * as a bounding box.
 */
function axisExtent(mask: Uint8Array): [number, number, number] {
  const mx: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    for (let k = 0; k < 3; k++) {
      const v = Math.abs(CONTAINMENT_CLOUD[i * 3 + k]);
      if (v > mx[k]) mx[k] = v;
    }
  }
  return mx;
}

/**
 * How much of this row's set was already in the reference row's, and how much
 * the two share overall.
 *
 * BOTH, because IoU alone CONFLATES "moved" WITH "shrank" — `|A∩B|/|A∪B|`
 * falls just as fast when A is a shrinking SUBSET of B as when A has moved off
 * it, and those are opposite findings. `contain` near 100% says EROSION (this
 * sheet's question 3); near 0 says the set is somewhere else.
 * `hybrid-chain.harness.ts`'s section 6 pair, for its reason.
 */
function overlap(
  mask: Uint8Array,
  ref: Uint8Array,
): { members: number; contain: number; iou: number } {
  let own = 0;
  let inter = 0;
  let union = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) own++;
    if (mask[i] && ref[i]) inter++;
    if (mask[i] || ref[i]) union++;
  }
  return {
    members: own,
    contain: own > 0 ? (100 * inter) / own : Number.NaN,
    iou: union > 0 ? inter / union : 0,
  };
}

/** Everything one row of every table below reports. */
interface Row {
  /** `probeEscapeFill4`'s own volume-uniform draw of the 4-BALL, in percent —
   * the only column that sees the whole 4D object rather than one cut. */
  ball4Pct: number;
  /** `sampleSetExtent`'s fill of the rendered SLICE, in percent. */
  slicePct: number;
  reach: number;
  marchR: number;
  /** Hits at the FIXED bailout ball — what a session opens on. */
  framed: PanelStats;
  /** Hits at this row's own fitted ball — what the object looks like. */
  fitted: PanelStats;
  /** This slice's membership over {@link CONTAINMENT_CLOUD}. */
  mask: Uint8Array;
  /** {@link axisExtent} of that mask — the PROPORTION column, which `reach`
   * is structurally blind to. */
  extent: [number, number, number];
}

function measure(de: EscapeDE4, lift: Lift, size: number): Row {
  const ball4Pct = 100 * probeEscapeFill4(de, BALL4_POINTS);
  const { fillPct, reachAbs } = sampleSetExtent(member4Of(de, lift), {
    fillRadius: ESCAPE_TIME_RADIUS,
    points: FILL_POINTS,
  });
  const marchR = fitMarchRadius(reachAbs);
  const view = {
    de: de4Of(de, lift),
    stepScale: ESCAPE_STEP_SCALE,
    eyeOffset: EYE,
    zoom: ZOOM,
  };
  const mask = memberMask(member4Of(de, lift));
  return {
    ball4Pct,
    slicePct: fillPct,
    reach: reachAbs,
    marchR,
    framed: renderPreview(
      { ...view, boundingRadius: ESCAPE_TIME_RADIUS },
      size,
    ),
    fitted: renderPreview({ ...view, boundingRadius: marchR }, size),
    mask,
    extent: axisExtent(mask),
  };
}

function showRow(label: string, r: Row, size: number): void {
  console.log(
    `      ${label.padEnd(14)} ball4 ${r.ball4Pct.toFixed(3).padStart(7)}%  ` +
      `slice ${r.slicePct.toFixed(3).padStart(7)}%  ` +
      `reach ${r.reach.toFixed(2)}  ` +
      `extent ${r.extent.map((v) => v.toFixed(2)).join("/")}  ` +
      `hits(R4) ${hitPct(r.framed, size).toFixed(1).padStart(5)}%  ` +
      `hits(fit ${r.marchR.toFixed(2)}) ${hitPct(r.fitted, size).toFixed(1).padStart(5)}%  ` +
      `steps/ray ${(r.framed.steps / (size * size)).toFixed(1)}`,
  );
}

/** Cost per estimate over the BAILOUT ball the marcher actually enters
 * against — `escape-chain.harness.ts`'s domain choice, for its reason: it is
 * the same for every row, so a cost figure does not move when a FRAMING
 * radius is refitted. */
function priceUsPerEval(de: EscapeDE4, lift: Lift): number {
  const rng = mulberry32(0xbeef);
  const pts: Vec3[] = [];
  for (let i = 0; i < 40_000; i++) {
    const u = Math.cbrt(rng()) * ESCAPE_TIME_RADIUS;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    pts.push([u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct]);
  }
  const est = de4Of(de, lift);
  let acc = 0;
  const t0 = Date.now();
  for (const p of pts) acc += est(p);
  const ms = Date.now() - t0;
  // Touch the accumulator so no engine can elide the loop.
  if (!Number.isFinite(acc)) throw new Error("non-finite estimate sum");
  return (ms * 1000) / pts.length;
}

// -------------------------------------------------------------- fixtures

/** The three base chains section 2 sweeps, in `escape-chain.harness.ts`'s own
 * vocabulary so a flat row here IS a row there: two of its fold fixtures plus
 * the shipped `hybridChainQuaternion`. */
const CHAIN_A: LinkSpec[] = [
  { type: "mandelbox", weight: 2 },
  { type: "boxfold", weight: 1.6 },
];
const CHAIN_B: LinkSpec[] = [
  { type: "mandelbox", weight: 2 },
  { type: "mandelbox", weight: -1.5 },
];
const CHAIN_C: LinkSpec[] = [
  { type: "mandelbox", weight: 2 },
  { type: "qsquare", weight: 1, scale: 0.5 },
];

/** The sweep, in radians. 0 is the flat control and is the row every other
 * one is read against. */
const ANGLES = [0, 0.1, 0.2, 0.35, 0.5, 0.8, 1.2];

/** Section 3/4's subject: section 2's best row — chain B (`mbox2 ->
 * mbox-1.5`) with `xw = 0.35` on the head link, the highest hit rate of any
 * rotated row measured and a 36% lift in slice fill over its own flat
 * control. Pinned as a literal rather than picked at run time so the sheet is
 * reproducible and the header can name it. */
const SUBJECT: SystemSpec = {
  links: [
    { type: "mandelbox", weight: 2, w: { xw: 0.35 } },
    { type: "mandelbox", weight: -1.5 },
  ],
};

/** Put the `w` rotation on one link of a chain, leaving the rest alone. */
function withRotation(
  links: LinkSpec[],
  index: number,
  w: WRotation,
): LinkSpec[] {
  return links.map((l, i) => (i === index ? { ...l, w } : l));
}

// ------------------------------------------------------------------ tests

describe("the 4D escape-time chain, measured before a preset ships (fr-vag4)", () => {
  it("anchors every row: a flat system's 4D estimate IS the 3D one, to the bit", () => {
    // The licence for everything below. `escape-de-4d.ts` appends the fourth
    // coordinate at the END of every term it joins, so a flat system's orbit
    // is the 3D one exactly — `+ 0.0` and `foldAxis(0) = 0` are both exact.
    // The unit tests pin that; this pins it at SHEET level, so a fill or hit
    // figure here is comparable with `escape-chain.harness.ts`'s by
    // construction rather than by assertion elsewhere.
    //
    // A GRID, DELIBERATELY, and it is the one in this file. `set-extent.ts`
    // is emphatic that a grid aliases against a fold's walls and must not
    // measure volume — the aligned resolutions over [-4, 4] are exactly
    // `n - 1` in {8, 16, 24, 32, 40, 48}, and this one is deliberately 33.
    // That defect is an ADVANTAGE for an equality check: the walls are where
    // two transcriptions of the same fold could differ, so the grid is chosen
    // to LAND on them — 0.25 spacing puts 9 planes per axis on the integers,
    // the classic box wall `±1` and its `±2` image included. The seeded ball
    // draw rides beside it for the interior, where a grid sees nothing
    // special.
    const fixtures: [string, LinkSpec[]][] = [
      ["single mbox2", [CHAIN_A[0]]],
      ["mbox2 -> boxfold1.6", CHAIN_A],
      ["mbox2 -> mbox-1.5", CHAIN_B],
      ["hybridChainQuaternion", CHAIN_C],
      [
        "mbox2 -> box1.6 -> sph1.2",
        [
          { type: "mandelbox", weight: 2 },
          { type: "boxfold", weight: 1.6 },
          { type: "spherefold", weight: 1.2 },
        ],
      ],
    ];
    const grid: Vec3[] = [];
    const N = 33;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        for (let k = 0; k < N; k++) {
          grid.push([
            -4 + (8 * i) / (N - 1),
            -4 + (8 * j) / (N - 1),
            -4 + (8 * k) / (N - 1),
          ]);
        }
      }
    }
    const rng = mulberry32(0xa11ce_4d);
    const ball: Vec3[] = [];
    for (let i = 0; i < 20_000; i++) {
      const u = Math.cbrt(rng()) * ESCAPE_TIME_RADIUS;
      const ct = 2 * rng() - 1;
      const st = Math.sqrt(Math.max(0, 1 - ct * ct));
      const ph = 2 * Math.PI * rng();
      ball.push([u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct]);
    }
    const queries = [...grid, ...ball];
    console.log(
      `  ${queries.length} queries per row: a ${N}^3 grid over [-4, 4] at ` +
        `${(8 / (N - 1)).toFixed(2)} spacing, landing on the integer fold ` +
        `walls +-1 and +-2, + ${ball.length} seeded ball draws (the interior)`,
    );
    for (const [label, links] of fixtures) {
      const transforms = transformsOf({ links });
      // Both gates must ADMIT a flat system, or the two estimators are not
      // being asked about the same object.
      expect(analyzeEscapeSystem(transforms).status).toBe("eligible");
      expect(analyzeEscapeSystem4(transforms).status).toBe("eligible");
      const de3 = buildEscapeDE(transforms);
      const de4 = buildEscapeDE4(transforms);
      let estimateDiffs = 0;
      let memberDiffs = 0;
      for (const p of queries) {
        const q: Vec4 = [p[0], p[1], p[2], 0];
        if (
          estimateEscapeDistance4(de4, q) !== estimateEscapeDistance(de3, p)
        ) {
          estimateDiffs++;
        }
        if (escapeSetContains4(de4, q) !== escapeSetContains(de3, p)) {
          memberDiffs++;
        }
      }
      // And the INSTRUMENT anchors too: this sheet's slice-fill column, taken
      // through `escapeSetContains4` at `w = 0`, must be the shipped
      // `probeEscapeFill`'s own number to the bit — not merely close to it.
      // Without this the two halves of a comparison could be two definitions
      // of "fill" that happen to agree (`escape-chain.harness.ts`'s ONE
      // INSTRUMENT, PINNED).
      const fillSlice = sampleSetExtent(member4Of(de4, sliceLift(0)), {
        fillRadius: ESCAPE_TIME_RADIUS,
        points: 4096,
      }).fillPct;
      const fill3 = 100 * probeEscapeFill(de3, 4096);
      console.log(
        `  ${label.padEnd(26)} estimate diffs ${estimateDiffs}  ` +
          `membership diffs ${memberDiffs}  ` +
          `slice fill ${fillSlice.toFixed(4)}% vs probeEscapeFill ` +
          `${fill3.toFixed(4)}%`,
      );
      expect(estimateDiffs, `${label} estimate`).toBe(0);
      expect(memberDiffs, `${label} membership`).toBe(0);
      expect(fillSlice, `${label} fill instrument`).toBe(fill3);
    }
  });

  it("sweeps a w ROTATION on one link — the knob fr-wuuu did NOT measure", () => {
    // fr-wuuu measured a `w` TRANSLATION (the quaternion square's `k`) and
    // found it does not buy an object: it is a weaker fourth translation, and
    // every slice off `w = 0` erodes. A translation cannot MIX `w` with a
    // spatial axis. `w: { rotation: { xw } }` does, so a flat query's orbit
    // leaves the `w = 0` hyperplane at the very first link and the rendered
    // slice is a genuinely 4D object's cut rather than a displaced 3D one.
    //
    // TWO HIT COLUMNS ON EVERY ROW, because they disagree and the
    // disagreement is the finding. `hits(R4)` is the FIXED bailout ball —
    // what `buildEscapeDE4` pins `boundingRadius` to and what a session opens
    // on, so it is the only column comparable across rows and the only one a
    // preset owes. `hits(fit)` refits the frame to each row's own reach, which
    // is what the panel shows: a shrinking object hidden by zooming in on it.
    // Fill is support, never the verdict (`probeEscapeFill4`'s warning).
    const blocks: [string, LinkSpec[], number][] = [
      ["(a) mbox2 -> boxfold1.6, xw on link 0", CHAIN_A, 0],
      ["(b) mbox2 -> mbox-1.5, xw on link 0", CHAIN_B, 0],
      ["(c) hybridChainQuaternion, xw on link 0 (the MANDELBOX)", CHAIN_C, 0],
      ["(d) hybridChainQuaternion, xw on link 1 (the QSQUARE)", CHAIN_C, 1],
    ];
    console.log(
      `  fill: probeEscapeFill4 over the 4-BALL and sampleSetExtent over the ` +
        `w = 0 SLICE, both at ${FILL_POINTS} points, both membership\n` +
        `  panels ${SMALL}px at the fixed bailout ball; ` +
        `${ESCAPE_TIME_ITERATIONS} passes, step scale ${ESCAPE_STEP_SCALE}`,
    );
    const panels: PanelStats[] = [];
    for (const [title, links, index] of blocks) {
      console.log(`  ${title}`);
      for (const xw of ANGLES) {
        const spec: SystemSpec = {
          links: xw === 0 ? links : withRotation(links, index, { xw }),
        };
        const transforms = transformsOf(spec);
        const gate3 = analyzeEscapeSystem(transforms);
        const de4 = buildEscapeDE4(transforms);
        const row = measure(de4, sliceLift(0), SMALL);
        showRow(`xw = ${xw}`, row, SMALL);
        if (xw !== 0) {
          // The whole reason this module exists: every rotated row is a
          // document the 3D gate refuses outright.
          expect(gate3.status).toBe("ineligible");
          expect(gate3.reasons.join("; ")).toContain("extends into 4D");
        } else {
          expect(gate3.status).toBe("eligible");
        }
        panels.push(row.framed);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, ANGLES.length, "escape-4d-rotation.png")}` +
        ` — blocks a..d top to bottom, angle left to right`,
    );

    // IS THE BAILOUT-POSE HIT DROP A SAMPLING ARTEFACT? NO — and this A/B is
    // here because the obvious explanation was wrong and would otherwise have
    // gone into the record unchecked. Block (a)'s reach barely moves across
    // the whole sweep, so the fitted framing is essentially constant and its
    // hit column is flat, yet the same rows lose a quarter of their rays at
    // the coarse bailout-ball pose. The tempting story is sub-pixel structure:
    // the rotation makes the object FINER, so more of it falls below the pixel
    // at the coarse framing, and the shipped tracer (which supersamples 8x on
    // the settle, fr-vpbq/fr-jf9y) would recover it. If that were true,
    // doubling the panel would recover more of the rotated row's rays than of
    // the flat row's. IT DOES NOT: both rows move together and slightly DOWN,
    // and the gap between them is unchanged. So the drop is the object's
    // own — the rotated set covers less of the fixed entry frame — and a
    // preset cannot expect the renderer's antialiasing to give it back.
    console.log(
      `  the bailout-pose hit drop against RESOLUTION (block a, same pose, ` +
        `same DE) — a sub-pixel-structure story predicts the gap CLOSING:`,
    );
    for (const px of [SMALL, 2 * SMALL]) {
      const cells: string[] = [];
      for (const xw of [0, 1.2]) {
        const de4 = buildEscapeDE4(
          transformsOf({
            links: xw === 0 ? CHAIN_A : withRotation(CHAIN_A, 0, { xw }),
          }),
        );
        const panel = renderPreview(
          {
            de: de4Of(de4, sliceLift(0)),
            boundingRadius: ESCAPE_TIME_RADIUS,
            stepScale: ESCAPE_STEP_SCALE,
            eyeOffset: EYE,
            zoom: ZOOM,
          },
          px,
        );
        cells.push(`xw ${xw}: ${hitPct(panel, px).toFixed(2)}%`);
      }
      console.log(`      ${String(px).padStart(4)}px   ${cells.join("   ")}`);
    }
  });

  it("sweeps the w0 SLICE — does it resolve something new, or merely erode?", () => {
    // fr-wuuu's question, asked of the ROTATION knob. Its own answer for the
    // TRANSLATION knob was erosion: containment 94-98% on every row with
    // members, and a genuine blank (0.0% of rays) by `w0 = 0.8`. Containment
    // is what separates the two readings and IoU cannot — a set that SHRANK
    // into its reference and a set that MOVED off it score the same IoU.
    const de4 = buildEscapeDE4(transformsOf(SUBJECT));
    const ref = memberMask(member4Of(de4, sliceLift(0)));
    console.log(
      `  subject: mbox2 (xw 0.35) -> mbox-1.5, section 2's best rotated row\n` +
        `  containment: membership over ONE fixed cloud of ${CLOUD_POINTS} ` +
        `points in the radius-${ESCAPE_TIME_RADIUS} ball, identical every row\n` +
        `  contain = % of THIS slice's members that are also members of the ` +
        `w0 = 0 slice at the same (x, y, z): high = EROSION, low = elsewhere`,
    );
    const panels: PanelStats[] = [];
    for (const w0 of [0, 0.1, 0.2, 0.4, 0.8, 1.2]) {
      const row = measure(de4, sliceLift(w0), SMALL);
      const o = overlap(row.mask, ref);
      showRow(`w0 = ${w0}`, row, SMALL);
      console.log(
        `                     members ${String(o.members).padStart(6)}  ` +
          `contain ${Number.isNaN(o.contain) ? "  n/a" : o.contain.toFixed(1).padStart(5)}%  ` +
          `IoU ${o.iou.toFixed(3)}`,
      );
      panels.push(row.framed);
    }
    console.log(
      `  wrote ${writeContactSheet(panels, 6, "escape-4d-slice.png")}` +
        ` — w0 left to right`,
    );
    // The instrument has to be in a state to answer the question: the
    // reference slice must be populated enough for a containment fraction to
    // mean anything.
    expect(overlap(ref, ref).members).toBeGreaterThan(2000);
  });

  it("sweeps the ROTOR — the pose the surface render actually slices at", () => {
    // The 4D surface render poses the object with an SO(4) rotor and THEN
    // cuts, so the rotor — not the `w0` slider — is what a 4D session spends
    // its interaction on. The lift here is the kernel's own
    // `rotorInv · vec4f(p, w0)` ({@link rotorLift}).
    //
    // THE THREE w-FREE POSES ARE THE READING RULE, and there are three of them
    // rather than one because a single control cannot show its own spread. A
    // `w`-free rotor at `w0 = 0` maps the slice to a RIGID ROTATION of the
    // identity slice, so fill, reach, member count and the per-axis extents
    // are INVARIANT while containment falls — measured, not assumed, and the
    // width of those three rows is the noise floor every `w`-mixing row is
    // read against.
    //
    // AND THE COLUMN THAT DECIDES IT IS {@link axisExtent}, not `reach`. Both
    // subjects below have essentially the same reach at every pose; only the
    // three per-axis numbers say whether the slice is a BRICK or a CUBE, which
    // is the whole structural question.
    //
    // TWO SUBJECTS, because one of them answers "no" and that is not the
    // sheet's verdict:
    //   (a) section 3's chain, whose 4D set turns out to be near-ISOTROPIC in
    //       `w` — every cut through the origin is statistically the same cut,
    //       so the rotor buys nothing a `w`-free turn would not;
    //   (b) the BRICK (`mandelboxCube` with `xw = 1`), which is anisotropic in
    //       `w` BY CONSTRUCTION, and where the rotor is a live proportion
    //       knob.
    //
    // ONE FRAME PER SUBJECT (its identity row's fitted ball), because a
    // structural comparison cannot have the frame moving under it.
    const poses: [string, RotorPair][] = [
      ["identity", identityRotorPair()],
      ["xy 0.5 (w-FREE)", rotateInPlane(identityRotorPair(), "xy", 0.5)],
      ["xz 0.9 (w-FREE)", rotateInPlane(identityRotorPair(), "xz", 0.9)],
      ["yz 1.1 (w-FREE)", rotateInPlane(identityRotorPair(), "yz", 1.1)],
      ["xw 0.3", rotateInPlane(identityRotorPair(), "xw", 0.3)],
      ["xw 0.7", rotateInPlane(identityRotorPair(), "xw", 0.7)],
      ["xw 1.0", rotateInPlane(identityRotorPair(), "xw", 1)],
      ["zw 0.6", rotateInPlane(identityRotorPair(), "zw", 0.6)],
    ];
    const subjects: [string, SystemSpec][] = [
      ["(a) mbox2 (xw 0.35) -> mbox-1.5 — section 3's chain", SUBJECT],
      [
        "(b) BRICK: mandelboxCube (xw 1.0) — anisotropic in w by construction",
        { links: [{ type: "mandelbox", weight: -1.5, w: { xw: 1 } }] },
      ],
    ];
    console.log(
      `  lift: rotorInv * vec4(p, 0), the kernel body's own — rotorMatrix's ` +
        `world rotor TRANSPOSED (setSurfaceView4's uInvRotor)\n` +
        `  extent x/y/z: max |coordinate| over this pose's members of the ` +
        `fixed ${CLOUD_POINTS}-point cloud — the PROPORTION column`,
    );
    const panels: PanelStats[] = [];
    for (const [title, spec] of subjects) {
      const de4 = buildEscapeDE4(transformsOf(spec));
      const frameR = fitMarchRadius(
        sampleSetExtent(member4Of(de4, sliceLift(0)), {
          fillRadius: ESCAPE_TIME_RADIUS,
          points: FILL_POINTS,
        }).reachAbs,
      );
      const ref = memberMask(member4Of(de4, sliceLift(0)));
      console.log(`  ${title}, framed at ONE radius ${frameR.toFixed(2)}`);
      for (const [label, pair] of poses) {
        const lift = rotorLift(rotorMatrix(pair), 0);
        const { fillPct, reachAbs } = sampleSetExtent(member4Of(de4, lift), {
          fillRadius: ESCAPE_TIME_RADIUS,
          points: FILL_POINTS,
        });
        const panel = renderPreview(
          {
            de: de4Of(de4, lift),
            boundingRadius: frameR,
            stepScale: ESCAPE_STEP_SCALE,
            eyeOffset: EYE,
            zoom: ZOOM,
          },
          SMALL,
        );
        const mask = memberMask(member4Of(de4, lift));
        const o = overlap(mask, ref);
        const mx = axisExtent(mask);
        console.log(
          `      ${label.padEnd(16)} slice ${fillPct.toFixed(3).padStart(7)}%  ` +
            `reach ${reachAbs.toFixed(2)}  extent ${mx
              .map((v) => v.toFixed(2))
              .join("/")}  ` +
            `hits ${hitPct(panel, SMALL).toFixed(1).padStart(5)}%  ` +
            `members ${String(o.members).padStart(6)}  ` +
            `contain ${Number.isNaN(o.contain) ? "  n/a" : o.contain.toFixed(1).padStart(5)}%  ` +
            `IoU ${o.iou.toFixed(3)}`,
        );
        panels.push(panel);
      }
    }
    console.log(
      `  wrote ${writeContactSheet(panels, poses.length, "escape-4d-rotor.png")}` +
        ` — subject (a) then (b), poses in table order`,
    );
    // The identity pose's lift must be the plain slice, or the rotor column is
    // measuring the transpose convention rather than the poses.
    const de4 = buildEscapeDE4(transformsOf(SUBJECT));
    const idLift = rotorLift(rotorMatrix(identityRotorPair()), 0);
    for (const p of [
      [1, 2, 3],
      [-0.5, 0.25, 2],
    ] as Vec3[]) {
      expect(de4Of(de4, idLift)(p)).toBeCloseTo(
        estimateEscapeDistance4(de4, [p[0], p[1], p[2], 0]),
        12,
      );
    }
  });

  it("ranks a PRESET SHORTLIST at the entry pose — the deliverable", () => {
    // WHAT A PRESET OWES, and why the ranking column is `hits(R4)`.
    // `buildEscapeDE4` pins `boundingRadius` to the bailout ball for every
    // system, and main.ts frames a new escape session on exactly that ball —
    // so an object reaching only ~2.0 of a radius-4 ball opens as a speck a
    // quarter of the pane wide, which is the framing argument that
    // SUBSTITUTED `foldChainBoulder`'s original chain. Fitted hits are printed
    // beside it for shape, and fill for support, but the entry pose decides.
    const candidates: [string, SystemSpec, string][] = [
      [
        "escapeBrick",
        {
          links: [{ type: "mandelbox", weight: -1.5, w: { xw: 1 } }],
        },
        "mandelboxCube's solid medallioned cube stretched into a wide BRICK, " +
          "its face medallions flattened to shallow pits — and the ROTATION " +
          "PLANE PICKS THE LONG AXIS (xw wide, yw tall, zw deep)",
      ],
      [
        "escapeColumn",
        {
          links: [{ type: "mandelbox", weight: -1.5, w: { yw: 0.8 } }],
        },
        "the same map with yw instead of xw: a standing COLUMN, its faces " +
          "banded in horizontal courses rather than medallioned — the plane " +
          "-> axis claim above, run twice",
      ],
      [
        "escapeBlockhouse",
        {
          links: [
            { type: "mandelbox", weight: -1.5, w: { xw: 0.8 } },
            { type: "boxfold", weight: 1.6, rotY: 20 },
          ],
        },
        "the brick put through foldChain's turned box fold: a crenellated " +
          "block ribbed and grooved right through, the best fitted-frame hit " +
          "rate on the sheet",
      ],
      [
        "escapeBoulder4",
        {
          links: [
            { type: "mandelbox", weight: 2, w: { xw: 0.35 } },
            { type: "mandelbox", weight: -1.5 },
            { type: "boxfold", weight: 1.6, rotY: 20 },
          ],
        },
        "foldChainBoulder with the head link turned into w: the densest of " +
          "the shortlist, a crested round mass",
      ],
      [
        "escapeShells4",
        {
          links: [
            { type: "mandelbox", weight: 2 },
            { type: "qsquare", weight: 1, scale: 0.5, w: { zw: 0.35 } },
          ],
        },
        "hybridChainQuaternion with the QSQUARE link turned into w: broken " +
          "plates, arcs and hooks scattered round a core — the family's most " +
          "dramatic morphology, and the one link position that costs no rays",
      ],
      [
        "escapeWedge4",
        {
          links: [{ type: "mandelbox", weight: 2 }],
          symmetry: { order: 5, plane: "xw" },
        },
        "mandelboxClassic under a five-fold kaleidoscope in a W-PLANE — the " +
          "shape analyzeEscapeSystem refuses OUTRIGHT, and the WEAKEST of the " +
          "six: measurably a different object (IoU 0.673 against order 1, " +
          "3662 of 262144 cloud points changing side) but NOT a visible " +
          "rosette, because the wedge's symmetry plane contains w and so does " +
          "not lie in the rendered slice. It reads as mandelboxClassic's " +
          "lobed ball with the lobes rearranged",
      ],
    ];
    /** The 3D presets the candidates are read against — rendered in the same
     * sheet, because "what does the 4D knob buy" is not answerable from the
     * 4D row alone. */
    const controls: [string, SystemSpec][] = [
      [
        "CONTROL mandelboxCube (3D)",
        { links: [{ type: "mandelbox", weight: -1.5 }] },
      ],
      ["CONTROL hybridChainQuaternion (3D)", { links: CHAIN_C }],
    ];

    interface Ranked {
      name: string;
      spec: SystemSpec;
      note: string;
      row: Row;
      us: number;
      threeD: string;
    }
    const rank = (name: string, spec: SystemSpec, note: string): Ranked => {
      const transforms = transformsOf(spec);
      const gate3 = analyzeEscapeSystem(transforms, null, spec.symmetry);
      const gate4 = analyzeEscapeSystem4(transforms, null, spec.symmetry);
      expect(gate4.status, `${name} 4D gate`).toBe("eligible");
      const de4 = buildEscapeDE4(transforms, null, spec.symmetry);
      return {
        name,
        spec,
        note,
        row: measure(de4, sliceLift(0), SIZE),
        us: priceUsPerEval(de4, sliceLift(0)),
        threeD:
          gate3.status === "eligible"
            ? "ELIGIBLE IN 3D (a control)"
            : gate3.reasons.join("; "),
      };
    };

    const ranked = candidates
      .map(([n, s, note]) => rank(n, s, note))
      .sort((a, b) => hitPct(b.row.framed, SIZE) - hitPct(a.row.framed, SIZE));
    const controlRows = controls.map(([n, s]) => rank(n, s, ""));

    console.log(
      `  ranked by hits at the ENTRY POSE — the fixed radius-${ESCAPE_TIME_RADIUS} ` +
        `bailout ball buildEscapeDE4 pins and main.ts frames on\n` +
        `  panels ${SIZE}px, ${ESCAPE_TIME_ITERATIONS} passes, step scale ` +
        `${ESCAPE_STEP_SCALE}; us/eval over that same ball at 40000 queries`,
    );
    for (const [i, c] of ranked.entries()) {
      console.log(
        `\n  ${i + 1}. ${c.name}  ${hitPct(c.row.framed, SIZE).toFixed(1)}% of rays ` +
          `at the entry pose\n` +
          `      ${c.note}\n` +
          `      4-ball fill ${c.row.ball4Pct.toFixed(3)}%  ` +
          `slice fill ${c.row.slicePct.toFixed(3)}%  reach ${c.row.reach.toFixed(2)}  ` +
          `extent ${c.row.extent.map((v) => v.toFixed(2)).join("/")}  ` +
          `hits(fit ${c.row.marchR.toFixed(2)}) ${hitPct(c.row.fitted, SIZE).toFixed(1)}%  ` +
          `${c.us.toFixed(2)} us/eval  ` +
          `steps/ray ${(c.row.framed.steps / (SIZE * SIZE)).toFixed(1)}\n` +
          `      3D gate: ${c.threeD}\n` +
          `${spell(c.spec)}`,
      );
    }
    for (const c of controlRows) {
      console.log(
        `\n  ${c.name}  ${hitPct(c.row.framed, SIZE).toFixed(1)}% of rays\n` +
          `      4-ball fill ${c.row.ball4Pct.toFixed(3)}%  ` +
          `slice fill ${c.row.slicePct.toFixed(3)}%  reach ${c.row.reach.toFixed(2)}  ` +
          `extent ${c.row.extent.map((v) => v.toFixed(2)).join("/")}  ` +
          `hits(fit ${c.row.marchR.toFixed(2)}) ${hitPct(c.row.fitted, SIZE).toFixed(1)}%  ` +
          `${c.us.toFixed(2)} us/eval`,
      );
    }
    console.log(
      `\n  wrote ${writeContactSheet(
        [
          ...ranked.map((c) => c.row.framed),
          ...controlRows.map((c) => c.row.framed),
        ],
        4,
        "escape-4d-shortlist.png",
      )} — six candidates in ranked order, then the two 3D controls`,
    );

    // THE ONE TRAP AN AUTHOR OF `escapeWedge4` MUST NOT FALL INTO, measured
    // rather than warned about. A `w`-plane wedge fold at EVEN order is a
    // NO-OP on the `w = 0` slice for an origin-centred fold: the fold's
    // arithmetic is odd axis by axis, so the set already carries the symmetry
    // the wedge would impose, and the preset would silently be its 3D twin.
    // `foldChainFlower`'s doc records the same hazard for the 3D planes; this
    // is it re-measured one dimension up, where it decides the ORDER a preset
    // may ship with.
    console.log(
      `\n  the w-plane kaleidoscope's even-order NO-OP (mandelboxClassic, ` +
        `plane xw, w0 = 0):`,
    );
    // NO-OP "TO THE SAMPLE", NOT TO THE BIT, and the residue is worth naming
    // because it looks like a bug and is not: at even order the wedge's turn
    // is a whole multiple of pi, and `Math.sin(Math.PI)` is 1.22e-16 rather
    // than 0, so `foldQueryIntoSector4` leaks a `w` of about `1.2e-16 * x`
    // into a query that was exactly on the slice. Measured, that flips ONE
    // point of 262144 at order 2 and none at 4/6/8 — so the test is a
    // threshold and the differing count is printed rather than hidden.
    const base = transformsOf({ links: [{ type: "mandelbox", weight: 2 }] });
    const plainMask = memberMask(member4Of(buildEscapeDE4(base), sliceLift(0)));
    for (const order of [1, 2, 3, 4, 5, 6, 8]) {
      const symmetry: SymmetryParams = { order, plane: "xw" };
      const de4 = buildEscapeDE4(base, null, symmetry);
      const mask = memberMask(member4Of(de4, sliceLift(0)));
      const o = overlap(mask, plainMask);
      let differ = 0;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] !== plainMask[i]) differ++;
      }
      const noop = o.iou > 0.999;
      console.log(
        `      order ${order}  members ${String(o.members).padStart(6)}  ` +
          `IoU vs order 1 ${o.iou.toFixed(4)}  ` +
          `points differing ${differ} of ${CLOUD_POINTS}  ` +
          `4-ball fill ${(100 * probeEscapeFill4(de4, BALL4_POINTS)).toFixed(3)}%` +
          (noop ? "   <- NO-OP on the rendered slice" : ""),
      );
      // Even orders must be no-ops and odd ones must not — the rule the
      // shortlist's order 5 rests on.
      if (order > 1) expect(noop, `order ${order}`).toBe(order % 2 === 0);
    }

    // Guard the guard: a blank panel makes the deliverable meaningless, and
    // `SURFACE_BLANK_HIT_FRACTION` (0.001) is main.ts's own bar for "this
    // frame drew essentially nothing".
    for (const c of [...ranked, ...controlRows]) {
      expect(
        hitPct(c.row.framed, SIZE),
        `${c.name} renders essentially nothing at the entry pose`,
      ).toBeGreaterThan(0.1);
    }
  });
});
