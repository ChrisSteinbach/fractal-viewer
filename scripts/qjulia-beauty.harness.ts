/**
 * Decision sheet for the quaternion Julia epic's two shader beads — the
 * kernels and the 4D lift: is there anything STUNNING in the quaternion
 * Julia family, or does `qjulia-preview.harness.ts`'s "solid of revolution,
 * visually monotonous" verdict settle it before either is built?
 *
 * WHAT THE EXISTING VERDICT PROVES, AND WHAT IT DOES NOT. Every automorphism
 * of the quaternions is a conjugation, which rotates the imaginary 3-space and
 * fixes the reals; it therefore carries any `c` to a COMPLEX one, and the
 * stabiliser of that plane still rotates `(j, k)`. So for the PLAIN map
 * `y <- y² + c`, membership depends only on `(a, b, |(c, d)|)` and the 4D set
 * is a solid of revolution about a 2-plane — for every constant, and (the same
 * argument) for every power. That is watertight. It says nothing about the two
 * levers this sheet measures, because neither changes the CONSTANT:
 *
 *   1. A ROTATION IN THE TRANSFORM. `qjulia-de.ts` ships it already —
 *      `M = R` makes the iteration `y <- R y² + c`, which keeps
 *      `sigma_min = sigma_max = 1` (so the estimate stays exact and the 1.0
 *      step scale stays sound) and is not conjugate to any plain map.
 *   2. A ROTOR-POSED SLICE. `estimateQJuliaDistance` already takes a `Vec4`,
 *      so `q = R·(p, w0)` for an SO(4) rotor `R` renders an arbitrary
 *      orientation cut through the 4D set with NO shader work — what the 4D
 *      lift would show, and what nobody had looked at.
 *
 * The rotor slice needs no soundness argument beyond the one the estimator
 * already carries: `R` is an isometry, so the estimate at `R·(p, w0)` is a
 * lower bound on the 4D distance, which is a lower bound on the distance
 * WITHIN the 3-plane. (This is not the 4D slice-thickness slab, which is a
 * segment-valued bound a squaring map would break — that landmine stays live
 * for the 4D lift.)
 *
 * WHAT THE SHEET ADDS TO THE ARGUMENT. `lathe` is the numeric form of "solid
 * of revolution", not a proxy for it. If a rotation `rho` of the orbit space
 * commutes with the map and fixes `c`, then `F(rho y) = rho F(y)`, the orbit
 * of `rho y` is `rho` of the orbit of `y`, and — because the estimate reads
 * only `|y|` and a scalar `dr` — the DE is EXACTLY invariant. So this column
 * searches all 2-plane rotations (96 random seeds, then a local refinement) for
 * the smallest relative DE defect they leave: `0.000` means the set really is
 * a solid of revolution, and a number means no rotation family in the search
 * leaves it alone. It is checked against the theorem in the second `it()`, and
 * it prices the two levers separately:
 *
 *   - `rho` must COMMUTE with `M` and FIX `c`. So a map rotation in the
 *     `(1, i)` or `(j, k)` planes (which commute with the `(j, k)` rotations)
 *     leaves a complex `c`'s lathe intact, and every other plane breaks it.
 *     Rotation is a REAL escape from the theorem, but only in the right planes.
 *   - A rotor slice cannot break a lathe that is there — the 4D set is what it
 *     is — but it decides WHICH 3D object you see: a cut whose normal lies in
 *     the invariant 2-plane is the classic (equivalent to `w0 = 0`) view, a cut
 *     whose normal is orthogonal to it contains the whole revolution and
 *     renders literal turned wood, and everything between is a section nobody
 *     has published.
 *
 * Every panel marches the SHIPPED `buildQJuliaDE`/`estimateQJuliaDistance`
 * through `de-preview.ts`'s identical shading, so the sheet compares OBJECTS
 * and not lighting; panel 0 is the plain `M = I`, `w0 = 0`, unposed slice —
 * the object the existing verdict describes — so every other panel is read
 * against it. `reach` follows `escape-form-sweep.harness.ts`'s `extent()`
 * convention (a grid over a box twice the view ball, so a set that outgrew
 * the frame reads as `reach > 1` instead of silently clipping). `fill%` is
 * VOLUME, and since the set-extent correction it is answered by a seeded
 * uniform sample against the orbit's own membership test
 * (`qjuliaSetContains`, this file's own copy of `estimateQJuliaDistance`'s
 * recurrence, composed through the SAME rotor/slice/anchor transform each
 * panel is built from) rather than by thresholding the DE — `set-extent.ts`'s
 * module doc has the general argument. `occ%`/`rough` stay GRID measures at
 * the box's cell scale, kept for what a volume sampler cannot see: a dendrite
 * constant has EMPTY interior, so `fill%` alone would report the most
 * intricate objects as nothing — `occ%` counts cells the set comes within a
 * cell radius of (never a volume fraction, however fine the grid), and
 * `rough` is that occupancy's surface area over the area of an equal-volume
 * ball rasterised on the same grid (1.0 = as smooth as a ball, itself a
 * rasterised property rather than a volume one).
 *
 * MEASURED VERDICT (2026-08-14, f64 CPU; fill% re-measured 2026-08-16 under
 * the corrected set-extent instrument, see the closing paragraph below): THE
 * EXISTING VERDICT SURVIVES, and the narrower reading of it does not change
 * the answer.
 *
 *   - The theorem is confirmed numerically, and SHARPENED. `lathe` is 2e-16 —
 *     machine zero — at every plain constant tried, the gallery ones included.
 *     It is ALSO machine zero for a map rotation in the `(1,i)` or `(j,k)`
 *     planes, which the "rotation is a genuinely second family" claim
 *     does not distinguish: those rotations commute with the revolution and
 *     fix a complex `c`, so they buy a different-looking object out of the
 *     SAME lathe. Only the other four planes break it (`lathe` 0.02-0.10).
 *   - LEVER 1 (rotation) escapes the theorem and does not pay. Breaking the
 *     revolution SMOOTHS the object rather than complicating it: the plain
 *     rabbit's laminated shell (`rough` 1.20, fill 2.6%) becomes a smooth
 *     teardrop at `rx=45` (1.18, 3.3%) and a thin broken husk at `rx=90`
 *     (1.39, 0.0%). At 64x the rotated surface is the smoothest close-up on
 *     the whole sheet.
 *   - LEVER 2 (rotor slice) changes the view, never the object. A `zw` turn is
 *     a no-op — panel 8 reproduces panel 1 in every digit of every column,
 *     which is the invariant plane showing up as a measurement rather than as
 *     an argument (exactly so in real arithmetic; the rotor's own rounding is
 *     why this is stated as agreement, not as bit equality) — while `xw` turns
 *     tilt the cut and give a genuinely unpublished section that still looks
 *     like the same shell; and `xw=90` — the pure-imaginary 3-space, which
 *     CONTAINS the revolution — renders a near-perfect grooved SPHERE, the
 *     dullest panel here. So the 4D lift's honest promise is a different
 *     section, not a different kind of object, and one of its orientations is
 *     worse than the fixed slice the shader cores would have shipped.
 *   - The close-up sheet answers the question the wide frames cannot: the
 *     detail is real (laminated plates persist to 64x — this is a fractal,
 *     not a blob) but it is ONE MOTIF at every scale, every constant and both
 *     levers. Nothing new appears on the way in, which is exactly what a
 *     Mandelbulb close-up does do.
 *   - A THIRD LEVER, which the brief did not name and which neither the
 *     theorem nor the two above covers, pays close to nothing either: a
 *     NON-SIMILARITY `M` (anisotropic scale or shear, both authorable today,
 *     both admitted by `analyzeQJuliaSystem`, and both leaving the estimate
 *     sound but no longer exact). Half the search's rolls deform `M`, and
 *     under the corrected fill instrument (closing paragraph below) they are
 *     a dead heat with plain similarities at the top of the ranking rather
 *     than trailing it: the two roughest SURVIVING bodies are both deformed,
 *     tied at 1.17, against a best plain similarity a hundredth behind at
 *     1.16 — a margin inside the search's own noise, not a real gap either
 *     way.
 *   - 240 random rolls over the WHOLE authorable space (4D constant x
 *     six-plane map rotation x anisotropic scale x shear x six-plane rotor x
 *     slice offset) found 45 bodies worth looking at, 164 dusts and 10 that
 *     outgrew the shared frame. The best of them are handsome smooth
 *     sculptures — a looping torus, a coiled shell — with no fine structure
 *     at all. That is the family's ceiling, and it was found by search
 *     rather than by taste.
 *   - FILL'S INSTRUMENT CHANGED under the set-extent correction, mid-epic,
 *     and every fill% figure above is the re-measured one: `fill%` is now a
 *     seeded uniform sample against the orbit's own membership test rather
 *     than a `d < 1e-3` threshold on the DE (`set-extent.ts`'s module doc;
 *     `occ%` and `rough` are untouched, since they were already grid measures
 *     and are now only labelled as such rather than implied to be volume).
 *     Every panel and scan `fill%` moved by a few tenths of a point at most —
 *     three panels rounded down to exactly 0.0%: the plain dendrite and its
 *     `rx=60`-rotated, `xw`-sliced sibling (this doc's own prediction for a
 *     known-empty interior, working as intended rather than regressing) and
 *     the plain rabbit rotated `rx=90` (a thin husk, `rough` 1.39, with no
 *     measurable interior of its own). The search loop is where it mattered:
 *     re-run at the same 240 rolls, 45 land as bodies (was 59), 164 read dust
 *     (was 142), 10 outgrow the frame (was 18) — fewer bodies because the
 *     corrected sampler no longer counts a near-boundary ESCAPER as interior,
 *     so the dust gate now catches what the threshold used to wave through.
 *     The clearest single case is the roll that used to TOP the ranking:
 *     `rough` 1.39, similarity, `c=(0.81,-0.81,0.18,-0.22)`, read `fill` 2.6%
 *     on the broken instrument and reads 0.20% on the fixed one — below the
 *     0.5% cutoff, and now correctly excluded as dust. Its exclusion is what
 *     moves the THIRD LEVER bullet above: with the false top gone, the two
 *     roughest surviving bodies are both deformed.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/qjulia-beauty.harness.ts
 * Writes: `scripts/out/qjulia-beauty.png` (20 panels: the control, the
 *   constants, both levers, their combinations, and the 2D gallery's own
 *   constants), `qjulia-beauty-zoom.png` (four systems at 1x/8x/64x), and
 *   `qjulia-beauty-search.png` (the random search's best four).
 */
import {
  buildQJuliaDE,
  estimateQJuliaDistance,
  QJULIA_ITERATIONS,
  QJULIA_STEP_SCALE,
} from "../src/fractal/qjulia-de";
import type { QJuliaDE } from "../src/fractal/qjulia-de";
import { mulberry32 } from "../src/fractal/rng";
import type { Rng } from "../src/fractal/rng";
import {
  identityRotorPair,
  rotateInPlane,
  rotorMatrix,
} from "../src/app/rotor4";
import type { RotorPair } from "../src/app/rotor4";
import type { Rotation4, Transform, Vec3, Vec4 } from "../src/fractal/types";
import { renderPreview, writeContactSheet } from "./de-preview";
import type { DistanceEstimator, PanelStats } from "./de-preview";
import { sampleSetFill, SET_SAMPLE_POINTS } from "./set-extent";

const SIZE = 420;

/**
 * The marching ball every panel shares, so objects are compared at ONE scale
 * rather than each auto-framed to fill its own tile. Comfortably above the
 * family's own bound: the orbit start `y` stays inside `escapeRadius(|c|) <
 * 1.7` for every constant here and `p` is an isometric image of it, so `reach`
 * (max occupied radius / this) should stay well under 1 — a panel that
 * reported otherwise would be clipping, which is why the column exists.
 */
const VIEW_R = 2.4;

/** Camera offset in units of {@link VIEW_R} (magnitude > 1 keeps the eye
 * outside the ball) and frustum half-spread — shared, like the ball. */
const EYE_OFFSET: Vec3 = [0.95, 0.72, 1.15];
const ZOOM = 0.5;

const rad = (degrees: number) => (degrees * Math.PI) / 180;

// --------------------------------------------------------------- the maps

/** A quaternion Julia system, in the vocabulary the document already has. */
interface MapSpec {
  /** The Julia constant `c`, authored as the transform's translation — the
   * fourth component rides the `w` block, exactly as a user would author it. */
  c: Vec4;
  /** Euler-XYZ angles in DEGREES on the transform's own rotation. In the
   * quaternion identification `(x, y, z, w) = (1, i, j, k)` these turn the
   * `(i,j)`, `(1,j)` and `(1,i)` planes respectively — so `rz` mixes only the
   * complex plane, and `rx`/`ry` reach outside it. */
  rot?: Vec3;
  /** The `w`-mixing planes of the transform's `w` block, in DEGREES. */
  wRot?: { xw?: number; yw?: number; zw?: number };
  /**
   * Per-axis scale, default `[1,1,1]`. A UNIFORM scale is not a lever — the
   * module doc of `qjulia-de.ts` shows it is conjugate to moving `c` — but an
   * ANISOTROPIC one makes `M` a non-similarity, which is the one shape the
   * automorphism argument and the two named levers all miss. The estimate
   * stays SOUND there (`sigma_max` over-estimates `dr`, so the distance is
   * under-estimated, the direction a sphere tracer needs) and merely stops
   * being exact — `QJuliaDE.conformal` records it.
   */
  scale?: Vec3;
  /** The transform's 3D shear `[xy, xz, yz]` — the other non-similarity. */
  shear?: Vec3;
}

/** One pure quaternion square whose translation is the Julia constant. */
function qjuliaTransform(spec: MapSpec): Transform {
  const [rx, ry, rz] = spec.rot ?? [0, 0, 0];
  const transform: Transform = {
    id: 1,
    position: [spec.c[0], spec.c[1], spec.c[2]],
    rotation: [rad(rx), rad(ry), rad(rz)],
    scale: spec.scale ?? [1, 1, 1],
    variations: [{ type: "qsquare", weight: 1 }],
  };
  if (spec.shear) transform.shear = spec.shear;
  const wRotation: { xw?: number; yw?: number; zw?: number } = {};
  if (spec.wRot?.xw !== undefined) wRotation.xw = rad(spec.wRot.xw);
  if (spec.wRot?.yw !== undefined) wRotation.yw = rad(spec.wRot.yw);
  if (spec.wRot?.zw !== undefined) wRotation.zw = rad(spec.wRot.zw);
  const hasWRotation = Object.keys(wRotation).length > 0;
  if (spec.c[3] !== 0 || hasWRotation) {
    transform.w = {
      ...(spec.c[3] === 0 ? {} : { position: spec.c[3] }),
      ...(hasWRotation ? { rotation: wRotation } : {}),
    };
  }
  return transform;
}

function buildMap(spec: MapSpec): QJuliaDE {
  return buildQJuliaDE([qjuliaTransform(spec)]);
}

// ------------------------------------------------------------- 4D helpers

const dot4 = (a: Vec4, b: Vec4) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

/** `m · v` for a row-major 4x4. */
function apply4(m: number[], v: Vec4): Vec4 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3] * v[3],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7] * v[3],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11] * v[3],
    m[12] * v[0] + m[13] * v[1] + m[14] * v[2] + m[15] * v[3],
  ];
}

/** `mᵀ · v` — the INVERSE of a row-major 4x4 rotation, which is what every
 * `M`/`R` in this sheet is (unit scales, so `composeAffine4` returns a plain
 * rotation matrix and `QJuliaDE.conformal` is true). */
function applyT4(m: number[], v: Vec4): Vec4 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
}

/**
 * Solve `m · p = b` for a row-major 4x4 by Gaussian elimination with partial
 * pivoting. `applyT4` is the inverse only while `m` is orthogonal, which every
 * ROTOR is but a map with anisotropic scale or shear is not — and getting that
 * wrong would frame such a panel off-centre and silently mis-measure the lathe
 * defect, i.e. it would make the one untested lever look worse than it is.
 * `analyzeQJuliaSystem` refuses a singular `M`, so this never divides by zero.
 */
function solve4(m: number[], b: Vec4): Vec4 {
  const a = [
    [m[0], m[1], m[2], m[3], b[0]],
    [m[4], m[5], m[6], m[7], b[1]],
    [m[8], m[9], m[10], m[11], b[2]],
    [m[12], m[13], m[14], m[15], b[3]],
  ];
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    for (let row = col + 1; row < 4; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    const swap = a[col];
    a[col] = a[pivot];
    a[pivot] = swap;
    const lead = a[col][col];
    for (let k = col; k < 5; k++) a[col][k] /= lead;
    for (let row = 0; row < 4; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let k = col; k < 5; k++) a[row][k] -= factor * a[col][k];
    }
  }
  return [a[0][4], a[1][4], a[2][4], a[3][4]];
}

// ------------------------------------------------------------- the slices

/** How a 3D query is lifted into the 4D set (the 4D lift's own question). */
interface SliceSpec {
  /** Rotor turns composed in order, in DEGREES — fed through `rotor4.ts`'s
   * own `rotateInPlane`, so this is the same SO(4) the 4D view uses. */
  turns?: { plane: keyof Rotation4; degrees: number }[];
  /** Where the cut sits along its own fourth axis. */
  w0?: number;
}

function sliceMatrix(spec: SliceSpec): number[] {
  let pair: RotorPair = identityRotorPair();
  for (const turn of spec.turns ?? []) {
    pair = rotateInPlane(pair, turn.plane, rad(turn.degrees));
  }
  return rotorMatrix(pair);
}

/** `q = R·(p, w0)` — the lift, and the whole of its geometry. */
function sliceQuery(r: number[], p: Vec3, w0: number): Vec4 {
  return apply4(r, [p[0], p[1], p[2], w0]);
}

/**
 * Where to centre the panel: the slice point closest to the 4D point whose
 * orbit starts at `y = 0`, i.e. `p = (Rᵀ M⁻¹(−t)).xyz`. Analytic rather than
 * a measured centroid on purpose — a dendrite constant has no interior to take
 * a centroid of, and the anchor must not depend on the object being solid.
 */
function sliceAnchor(de: QJuliaDE, r: number[]): Vec3 {
  const centre4 = solve4(de.m, [-de.t[0], -de.t[1], -de.t[2], -de.t[3]]);
  const inSlice = applyT4(r, centre4);
  // Only the xyz part: the discarded fourth component is how far the cut sits
  // from that 4D centre, which is `w0`'s business and not the frame's.
  return [inSlice[0], inSlice[1], inSlice[2]];
}

/** The panel's estimator: the SHIPPED one, wrapped in the slice lift and the
 * centring shift. No fork — the query moves, the formula does not. */
function panelDE(
  de: QJuliaDE,
  r: number[],
  w0: number,
  centre: Vec3,
): DistanceEstimator {
  return (p) =>
    estimateQJuliaDistance(
      de,
      sliceQuery(r, [p[0] + centre[0], p[1] + centre[1], p[2] + centre[2]], w0),
    );
}

// -------------------------------------------------------- the membership

/** The orbit's terminal radius, left in module scratch by
 * {@link runQJuliaOrbit} — `escape-de.ts`'s `runEscapeOrbit` split, for its
 * reason: a fill measurement has to ask the orbit ITSELF whether
 * it escaped, never a threshold on the distance estimate — `d < eps` reads
 * small for a near-boundary ESCAPER exactly as it does near one the orbit
 * stays inside of, which is DEFECT 2 in `set-extent.ts`'s module doc.
 * `qjulia-de.ts` exports no membership reader of its own (the shader cores
 * are closed won't-do, so no renderer has ever needed one), so this is the
 * harness's own copy of {@link estimateQJuliaDistance}'s position
 * recurrence, term for term, minus the `dr` accumulator — `dr` feeds only
 * the DISTANCE and never the escape test `r <= de.bailout` below, so
 * dropping it cannot change what counts as a member. */
let qjuliaOrbitR = 0;

function runQJuliaOrbit(
  de: QJuliaDE,
  p: Vec4,
  maxIterations = QJULIA_ITERATIONS,
): void {
  const m = de.m;
  const t = de.t;
  let yx = m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3] * p[3] + t[0];
  let yy = m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7] * p[3] + t[1];
  let yz = m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11] * p[3] + t[2];
  let yw = m[12] * p[0] + m[13] * p[1] + m[14] * p[2] + m[15] * p[3] + t[3];
  let r = Math.sqrt(yx * yx + yy * yy + yz * yz + yw * yw);
  for (let i = 0; i < maxIterations && r <= de.bailout; i++) {
    // q² for q = yx + yy·i + yz·j + yw·k — `estimateQJuliaDistance`'s own
    // formula, copied rather than imported so the two cannot drift apart
    // (that module exports no split loop to share).
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
  qjuliaOrbitR = r;
}

/** Did `p`'s orbit stay inside the bailout ball for the whole budget — the
 * membership {@link estimateQJuliaDistance}'s own orbit supports but does
 * not expose, and the reading `sampleSetFill`/`sampleSetExtent`
 * (`set-extent.ts`) want in place of a distance threshold. */
function qjuliaSetContains(
  de: QJuliaDE,
  p: Vec4,
  maxIterations = QJULIA_ITERATIONS,
): boolean {
  runQJuliaOrbit(de, p, maxIterations);
  return qjuliaOrbitR <= de.bailout;
}

/** {@link panelDE}'s membership twin: the SAME slice lift and centring
 * shift, so fill is measured on the object the panel actually SHOWS rather
 * than on the plain, unrotated, unsliced `q² + c` set the panel was built
 * from — composing the transform twice, once per instrument, is exactly
 * the gap that would make a fill column describe a different object than
 * its own picture. */
function panelMember(
  de: QJuliaDE,
  r: number[],
  w0: number,
  centre: Vec3,
): (p: Vec3) => boolean {
  return (p) =>
    qjuliaSetContains(
      de,
      sliceQuery(r, [p[0] + centre[0], p[1] + centre[1], p[2] + centre[2]], w0),
    );
}

// ------------------------------------------------------- the lathe measure

/**
 * The estimator re-parameterized by the ORBIT's own start point `y = M p + t`
 * (`qjulia-de.ts`'s module doc). While `M` is a rotation that change of
 * variable is an isometry, so a distance in `y` space is a distance in query
 * space — and the rotations that could make the set a solid of revolution act
 * about the ORIGIN there, which is what makes the search below a search over
 * plain 2-plane rotations rather than over affine motions.
 */
function orbitSpaceDE(de: QJuliaDE): (y: Vec4) => number {
  return (y) =>
    estimateQJuliaDistance(
      de,
      solve4(de.m, [
        y[0] - de.t[0],
        y[1] - de.t[1],
        y[2] - de.t[2],
        y[3] - de.t[3],
      ]),
    );
}

/** Rotate `q` by `angle` in the 2-plane spanned by the orthonormal `u`, `v`. */
function rotateIn2Plane(u: Vec4, v: Vec4, angle: number, q: Vec4): Vec4 {
  const a = dot4(q, u);
  const b = dot4(q, v);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const da = a * c - b * s - a;
  const db = a * s + b * c - b;
  return [
    q[0] + da * u[0] + db * v[0],
    q[1] + da * u[1] + db * v[1],
    q[2] + da * u[2] + db * v[2],
    q[3] + da * u[3] + db * v[3],
  ];
}

/** Two angles, so a plane that merely happens to carry a DISCRETE symmetry at
 * one of them cannot pass as a continuous revolution. */
const LATHE_ANGLES = [1, 2.2];

/** Uniform-ish samples of the region the set lives in, in orbit space. */
function orbitQueries(rng: Rng, count: number, radius: number): Vec4[] {
  const out: Vec4[] = [];
  while (out.length < count) {
    const q: Vec4 = [
      rng() * 2 - 1,
      rng() * 2 - 1,
      rng() * 2 - 1,
      rng() * 2 - 1,
    ];
    const len = Math.hypot(...q);
    if (len > 1 || len === 0) continue;
    out.push([
      q[0] * radius,
      q[1] * radius,
      q[2] * radius,
      q[3] * radius,
    ] as Vec4);
  }
  return out;
}

function normalize4(v: Vec4): Vec4 {
  const len = Math.hypot(...v) || 1;
  return [v[0] / len, v[1] / len, v[2] / len, v[3] / len];
}

/** Gram-Schmidt `v` against `u`, then normalize — an orthonormal 2-frame. */
function orthonormalize(u: Vec4, v: Vec4): [Vec4, Vec4] {
  const un = normalize4(u);
  const d = dot4(un, v);
  return [
    un,
    normalize4([
      v[0] - d * un[0],
      v[1] - d * un[1],
      v[2] - d * un[2],
      v[3] - d * un[3],
    ]),
  ];
}

function gaussian4(rng: Rng): Vec4 {
  const pair = (): [number, number] => {
    const u = Math.max(rng(), 1e-12);
    const r = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * rng();
    return [r * Math.cos(theta), r * Math.sin(theta)];
  };
  const [a, b] = pair();
  const [c, d] = pair();
  return [a, b, c, d];
}

/** Relative DE defect a rotation family leaves — `0` iff the set really is a
 * solid of revolution about that 2-plane (see the module doc). */
function planeDefect(
  dey: (y: Vec4) => number,
  queries: Vec4[],
  base: number[],
  scale: number,
  u: Vec4,
  v: Vec4,
): number {
  let worst = 0;
  for (const angle of LATHE_ANGLES) {
    let sum = 0;
    for (let i = 0; i < queries.length; i++) {
      sum += Math.abs(dey(rotateIn2Plane(u, v, angle, queries[i])) - base[i]);
    }
    worst = Math.max(worst, sum / queries.length / scale);
  }
  return worst;
}

/**
 * The smallest relative DE defect any 2-plane rotation leaves: `0.000` means
 * the 4D set is a solid of revolution, and the theorem's own plane is offered
 * as a seed so the plain family lands on exactly zero rather than on whatever
 * a random search happened to find.
 */
function latheDefect(de: QJuliaDE, seed = 0x51ce): number {
  const rng = mulberry32(seed);
  const dey = orbitSpaceDE(de);
  const queries = orbitQueries(rng, 224, 2);
  const base = queries.map(dey);
  const scale = base.reduce((a, b) => a + b, 0) / base.length || 1;

  // The theorem's plane: the imaginary directions orthogonal to `c`'s own
  // imaginary part, which is what an automorphism leaves fixed.
  const imag: Vec4 = [0, de.t[1], de.t[2], de.t[3]];
  const seeds: [Vec4, Vec4][] = [];
  if (Math.hypot(imag[1], imag[2], imag[3]) > 1e-9) {
    const axis = normalize4(imag);
    // Two imaginary directions orthogonal to `axis` (x is the real part).
    const trial: Vec4[] = [
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const perp: Vec4[] = [];
    for (const t of trial) {
      const d = dot4(t, axis);
      const w = normalize4([
        0,
        t[1] - d * axis[1],
        t[2] - d * axis[2],
        t[3] - d * axis[3],
      ]);
      for (const already of perp) {
        const e = dot4(w, already);
        w[0] -= e * already[0];
        w[1] -= e * already[1];
        w[2] -= e * already[2];
        w[3] -= e * already[3];
      }
      if (Math.hypot(...w) > 0.3) perp.push(normalize4(w));
      if (perp.length === 2) break;
    }
    if (perp.length === 2) seeds.push([perp[0], perp[1]]);
  }
  for (let i = 0; i < 96; i++) {
    seeds.push(orthonormalize(gaussian4(rng), gaussian4(rng)));
  }

  let best = Infinity;
  let bestU: Vec4 = [1, 0, 0, 0];
  let bestV: Vec4 = [0, 1, 0, 0];
  for (const [u, v] of seeds) {
    const d = planeDefect(dey, queries, base, scale, u, v);
    if (d < best) {
      best = d;
      bestU = u;
      bestV = v;
    }
  }
  // Local refinement: a coarse random sweep of the Grassmannian would miss a
  // near-miss plane, and a near-miss is exactly what "almost a lathe" means.
  let sigma = 0.35;
  for (let step = 0; step < 360; step++) {
    if (step > 0 && step % 60 === 0) sigma *= 0.5;
    const gu = gaussian4(rng);
    const gv = gaussian4(rng);
    const [u, v] = orthonormalize(
      [
        bestU[0] + sigma * gu[0],
        bestU[1] + sigma * gu[1],
        bestU[2] + sigma * gu[2],
        bestU[3] + sigma * gu[3],
      ],
      [
        bestV[0] + sigma * gv[0],
        bestV[1] + sigma * gv[1],
        bestV[2] + sigma * gv[2],
        bestV[3] + sigma * gv[3],
      ],
    );
    const d = planeDefect(dey, queries, base, scale, u, v);
    if (d < best) {
      best = d;
      bestU = u;
      bestV = v;
    }
  }
  return best;
}

// -------------------------------------------------------- the shape stats

interface ShapeStats {
  /** Percent of the view ball whose points are MEMBERS — a seeded uniform
   * sample against the orbit's own escape test ({@link qjuliaSetContains}),
   * not a threshold on the DE. This is the one VOLUME measure of
   * the four; the other three stay grid measures (see `shapeStats`'s doc). */
  fillPct: number;
  /** Percent of the view ball the set comes within one grid-cell radius of,
   * which is the only measure a dendrite (empty interior) shows up in at
   * all. A GRID measure at the `cells` resolution `shapeStats` was called
   * with, NOT a volume fraction — see its doc. */
  occPct: number;
  /** Max occupied radius over {@link VIEW_R} — `> 1` means the frame clips. */
  reach: number;
  /** Occupancy surface area over that of an equal-volume ball rasterised on
   * the same grid: 1.0 = as smooth as a sphere, higher = more intricate. An
   * intrinsically RASTERISED ratio — see `shapeStats`'s doc. */
  rough: number;
}

/**
 * Shape measures over a box TWICE the view ball (`extent()`'s convention, so
 * a set that outgrew the frame reads in `reach > 1` rather than clipping
 * silently) — from TWO DIFFERENT INSTRUMENTS that must not be read as
 * interchangeable.
 *
 * `fillPct` is VOLUME, and it is the only one of the four numbers that is:
 * a seeded uniform sample against `member`, the panel's own membership
 * oracle ({@link qjuliaSetContains} composed through {@link panelMember}),
 * never a threshold on `de`. `set-extent.ts`'s module doc gives the reason —
 * a distance estimate reads small near a boundary an orbit ESCAPES through
 * exactly as it does near one an orbit stays inside of, so `d < eps` cannot
 * tell the two apart, which is what the old `d < 1e-3` reading here did.
 *
 * `occPct` and `rough` stay GRID measures, at the cell scale `cells` resolves
 * the box into — a deliberate, different choice from `fillPct`, not an
 * oversight the set-extent correction missed: a dendrite constant has EMPTY
 * interior, so a volume sampler reads `fillPct` near zero for the most
 * intricate object on the sheet, and `occPct` ("does the set come within one
 * cell of this point") is the only column that shows up for one at all.
 * NEITHER IS A VOLUME FRACTION however fine `cells` gets — `occPct` counts
 * cells the set merely comes close to (a generous, cell-radius-wide test),
 * and `rough` is a rasterised surface-area ratio, a property of the grid it
 * is measured on rather than of the set alone.
 */
function shapeStats(
  de: DistanceEstimator,
  member: (p: Vec3) => boolean,
  cells: number,
): ShapeStats {
  const half = 2 * VIEW_R;
  const h = (2 * half) / (cells - 1);
  const cellRadius = (h * Math.sqrt(3)) / 2;
  const occupied = new Uint8Array(cells * cells * cells);
  let inBall = 0;
  let occInBall = 0;
  let maxR = 0;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      for (let k = 0; k < cells; k++) {
        const p: Vec3 = [-half + h * i, -half + h * j, -half + h * k];
        const r = Math.hypot(p[0], p[1], p[2]);
        const d = de(p);
        const occ = d < cellRadius;
        if (occ) {
          occupied[(i * cells + j) * cells + k] = 1;
          maxR = Math.max(maxR, r);
        }
        if (r <= VIEW_R) {
          inBall++;
          if (occ) occInBall++;
        }
      }
    }
  }
  const volumeCells = occupied.reduce((a: number, b: number) => a + b, 0);
  const fillPct = sampleSetFill(member, {
    fillRadius: VIEW_R,
    points: SET_SAMPLE_POINTS,
  });
  return {
    fillPct,
    occPct: (100 * occInBall) / inBall,
    reach: maxR / VIEW_R,
    rough:
      volumeCells < 200
        ? NaN
        : surfaceCells(occupied, cells) / ballFaces(volumeCells, cells, h),
  };
}

/** Faces between an occupied cell and an unoccupied one (or the grid edge) —
 * a rasterised surface area in units of `h²`. */
function surfaceCells(occupied: Uint8Array, cells: number): number {
  const at = (i: number, j: number, k: number) =>
    i < 0 || j < 0 || k < 0 || i >= cells || j >= cells || k >= cells
      ? 0
      : occupied[(i * cells + j) * cells + k];
  let faces = 0;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      for (let k = 0; k < cells; k++) {
        if (!at(i, j, k)) continue;
        faces +=
          6 -
          at(i - 1, j, k) -
          at(i + 1, j, k) -
          at(i, j - 1, k) -
          at(i, j + 1, k) -
          at(i, j, k - 1) -
          at(i, j, k + 1);
      }
    }
  }
  return faces;
}

/** The same face count for a BALL of the same cell volume, rasterised on the
 * same grid — the reference that makes `rough` read 1.0 for a smooth blob
 * instead of the ~1.5 a cubic grid's staircase would otherwise charge it. */
function ballFaces(volumeCells: number, cells: number, h: number): number {
  const radius = Math.cbrt((3 * volumeCells * h * h * h) / (4 * Math.PI));
  const centre = (cells - 1) / 2;
  const ball = new Uint8Array(cells * cells * cells);
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      for (let k = 0; k < cells; k++) {
        const r =
          h * Math.hypot(i - centre, j - centre, k - centre) <= radius ? 1 : 0;
        ball[(i * cells + j) * cells + k] = r;
      }
    }
  }
  return surfaceCells(ball, cells) || 1;
}

// --------------------------------------------------------------- close-up

/**
 * A surface point to fly in on: the first hit along the wide shot's own
 * framing ray, i.e. what its centre pixel shows. Falls back to a small bundle
 * of rays across the frustum, because a dendrite constant's set has empty
 * interior and one ray can thread straight past it.
 */
function probeSurface(de: DistanceEstimator, radius: number): Vec3 | null {
  const eye: Vec3 = [
    EYE_OFFSET[0] * radius,
    EYE_OFFSET[1] * radius,
    EYE_OFFSET[2] * radius,
  ];
  const len = Math.hypot(...eye);
  let best: Vec3 | null = null;
  let bestT = Infinity;
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      // Jitter the aim across the frustum; the centre ray is (0, 0).
      const dir: Vec3 = [
        -eye[0] / len + i * 0.06,
        -eye[1] / len + j * 0.06,
        -eye[2] / len,
      ];
      const dl = Math.hypot(...dir);
      const d3: Vec3 = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
      let t = 0;
      for (let step = 0; step < 3000 && t < 2 * len; step++) {
        const p: Vec3 = [
          eye[0] + d3[0] * t,
          eye[1] + d3[1] * t,
          eye[2] + d3[2] * t,
        ];
        const d = de(p);
        if (d < 1e-5) {
          if (t < bestT) {
            bestT = t;
            best = p;
          }
          break;
        }
        t += Math.max(d * QJULIA_STEP_SCALE, 1e-6);
      }
    }
  }
  return best;
}

/**
 * The same object magnified `k`x about `centre` — a SIMILARITY applied to the
 * estimator (`k · DE(centre + p/k)` is exactly the DE of the scaled set), not a
 * camera move. That keeps the tracer in the identical numeric regime as the
 * wide panels (`de-preview.ts`'s hit epsilon has an absolute floor, so flying
 * the camera in would quietly stop resolving detail and flatter the verdict),
 * so a close-up differs from a wide shot only in magnification.
 */
function zoomDE(
  de: DistanceEstimator,
  centre: Vec3,
  k: number,
): DistanceEstimator {
  return (p) =>
    k * de([centre[0] + p[0] / k, centre[1] + p[1] / k, centre[2] + p[2] / k]);
}

// ------------------------------------------------------------- the panels

interface Panel {
  label: string;
  map: MapSpec;
  slice?: SliceSpec;
}

const CONTROL_C: Vec4 = [-0.2, 0.6, 0.2, 0];
const RABBIT_C: Vec4 = [-0.123, 0.745, 0, 0];
const DENDRITE_C: Vec4 = [0, 1, 0, 0];
const FOURD_C: Vec4 = [-0.4, 0.6, 0, 0.25];
/** The constants a 2D Julia gallery is made of — the hardest test of "no
 * choice of constant escapes the lathe". */
const SEAHORSE_C: Vec4 = [-0.7269, 0.1889, 0, 0];
const SIEGEL_C: Vec4 = [-0.390541, 0.586788, 0, 0];
const LIGHTNING_C: Vec4 = [-0.8, 0.156, 0, 0];
const CUSP_C: Vec4 = [0.285, 0.01, 0, 0];

function renderPanel(panel: Panel, cells: number): PanelStats & ShapeStats {
  const de = buildMap(panel.map);
  const slice = panel.slice ?? {};
  const r = sliceMatrix(slice);
  const w0 = slice.w0 ?? 0;
  const centre = sliceAnchor(de, r);
  const estimator = panelDE(de, r, w0, centre);
  const member = panelMember(de, r, w0, centre);
  const shape = shapeStats(estimator, member, cells);
  const stats = renderPreview(
    {
      de: estimator,
      boundingRadius: VIEW_R,
      stepScale: QJULIA_STEP_SCALE,
      eyeOffset: EYE_OFFSET,
      zoom: ZOOM,
    },
    SIZE,
  );
  return { ...stats, ...shape };
}

describe("quaternion Julia beauty sweep", () => {
  it("is a solid of revolution exactly where the theorem says", () => {
    // The theorem: the plain map is a lathe at EVERY constant.
    for (const c of [CONTROL_C, RABBIT_C, DENDRITE_C, FOURD_C]) {
      const d = latheDefect(buildMap({ c }));
      console.log(`  plain c=${c.join(",")}  lathe ${d.toExponential(1)}`);
      expect(d).toBeLessThan(1e-9);
    }
    // A map rotation is a lathe iff it COMMUTES with the revolution and FIXES
    // c: for a complex c that is the (1,i) plane (Euler rz) and the (j,k)
    // plane (the w block's zw), and nothing else.
    const keeps: MapSpec[] = [
      { c: RABBIT_C, rot: [0, 0, 35] },
      { c: RABBIT_C, wRot: { zw: 40 } },
    ];
    for (const map of keeps) {
      const d = latheDefect(buildMap(map));
      console.log(`  commuting rotation  lathe ${d.toExponential(1)}`);
      expect(d).toBeLessThan(1e-9);
    }
    const breaks: MapSpec[] = [
      { c: RABBIT_C, rot: [35, 0, 0] },
      { c: RABBIT_C, rot: [0, 35, 0] },
      { c: RABBIT_C, wRot: { xw: 35 } },
      { c: RABBIT_C, wRot: { yw: 35 } },
    ];
    for (const map of breaks) {
      const d = latheDefect(buildMap(map));
      console.log(`  non-commuting rotation  lathe ${d.toFixed(4)}`);
      expect(d).toBeGreaterThan(1e-3);
    }
  });

  it("renders the contact sheet", () => {
    const panels: Panel[] = [
      // Row 1 — inside the theorem: the control, then the constant survey.
      { label: "CONTROL plain c=(-.2,.6,.2) w0=0", map: { c: CONTROL_C } },
      { label: "plain Douady rabbit", map: { c: RABBIT_C } },
      { label: "plain dendrite c=(0,1,0)", map: { c: DENDRITE_C } },
      {
        label: "plain 4D c=(-.4,.6,0,.25) w0=.15",
        map: { c: FOURD_C },
        slice: { w0: 0.15 },
      },
      // Row 2 — LEVER 1, a rotation in the transform. The first commutes with
      // the revolution and fixes c, so it is still a lathe; the rest are not.
      {
        label: "rabbit + rot rz=45 (lathe KEPT)",
        map: { c: RABBIT_C, rot: [0, 0, 45] },
      },
      { label: "rabbit + rot rx=45", map: { c: RABBIT_C, rot: [45, 0, 0] } },
      { label: "rabbit + rot rx=90", map: { c: RABBIT_C, rot: [90, 0, 0] } },
      {
        label: "rabbit + rot (35,25,15)",
        map: { c: RABBIT_C, rot: [35, 25, 15] },
      },
      // Row 3 — LEVER 2, a rotor-posed slice of the SAME plain rabbit set.
      // Its revolution plane is (j,k) = (z,w), so a zw turn is a no-op, an xw
      // turn tilts the cut out of the classic orientation, and xw=90 lands on
      // the pure-imaginary 3-space, which CONTAINS the revolution.
      {
        label: "rabbit, rotor zw=50 (predicted no-op)",
        map: { c: RABBIT_C },
        slice: { turns: [{ plane: "zw", degrees: 50 }] },
      },
      {
        label: "rabbit, rotor xw=35",
        map: { c: RABBIT_C },
        slice: { turns: [{ plane: "xw", degrees: 35 }] },
      },
      {
        label: "rabbit, rotor xw=65 w0=.3",
        map: { c: RABBIT_C },
        slice: { turns: [{ plane: "xw", degrees: 65 }], w0: 0.3 },
      },
      {
        label: "rabbit, rotor xw=90 (imaginary 3-space)",
        map: { c: RABBIT_C },
        slice: { turns: [{ plane: "xw", degrees: 90 }] },
      },
      // Row 4 — both levers at once, and the other constants.
      {
        label: "rabbit + rot rx=45, rotor xw=45",
        map: { c: RABBIT_C, rot: [45, 0, 0] },
        slice: { turns: [{ plane: "xw", degrees: 45 }] },
      },
      {
        label: "control c + rot(35,25,15), rotor xw=55 w0=.25",
        map: { c: CONTROL_C, rot: [35, 25, 15] },
        slice: { turns: [{ plane: "xw", degrees: 55 }], w0: 0.25 },
      },
      {
        label: "4D c + rot ry=40, rotor yw=50 w0=.2",
        map: { c: FOURD_C, rot: [0, 40, 0] },
        slice: { turns: [{ plane: "yw", degrees: 50 }], w0: 0.2 },
      },
      {
        label: "dendrite + rot rx=60, rotor xw=40",
        map: { c: DENDRITE_C, rot: [60, 0, 0] },
        slice: { turns: [{ plane: "xw", degrees: 40 }] },
      },
      // Row 5 — the constants a 2D Julia gallery is actually made of, plain,
      // because "no choice of constant escapes the lathe" is the theorem's
      // strongest claim and these are the constants most likely to test it.
      { label: "seahorse c=-0.7269+0.1889i", map: { c: SEAHORSE_C } },
      { label: "Siegel disc c=-0.390541+0.586788i", map: { c: SIEGEL_C } },
      { label: "lightning c=-0.8+0.156i", map: { c: LIGHTNING_C } },
      { label: "near-cusp c=0.285+0.01i", map: { c: CUSP_C } },
    ];

    const rendered = panels.map((panel, i) => {
      const stats = renderPanel(panel, 121);
      const lathe = latheDefect(buildMap(panel.map));
      console.log(
        `  ${String(i).padStart(2)}. ${panel.label}\n` +
          `      hits ${((stats.hits / (SIZE * SIZE)) * 100).toFixed(1).padStart(5)}%  ` +
          `fill ${stats.fillPct.toFixed(1).padStart(5)}%  ` +
          `occ ${stats.occPct.toFixed(1).padStart(5)}%  ` +
          `reach ${stats.reach.toFixed(2)}xR  ` +
          `rough ${stats.rough.toFixed(2)}  ` +
          `lathe ${lathe < 1e-9 ? "0 (revolution)" : lathe.toFixed(4)}  ` +
          `steps/ray ${(stats.steps / (SIZE * SIZE)).toFixed(0)}  ${stats.ms}ms`,
      );
      return stats;
    });

    console.log(
      `  wrote ${writeContactSheet(rendered, 4, "qjulia-beauty.png")}`,
    );
    rendered.forEach((p, i) => {
      expect(p.hits, `panel ${i} rendered nothing`).toBeGreaterThan(
        0.005 * SIZE * SIZE,
      );
      expect(p.reach, `panel ${i} clips the frame`).toBeLessThan(1);
    });
  });

  it("flies in, to see whether the detail is one motif or many", () => {
    // The wide sheet frames every object at one scale, which answers "what
    // shape is it" and not "does it hold up close" — the question that
    // separates a turned-wood family from a Mandelbulb. Two plain constants
    // and one panel per lever, each rendered wide, then magnified 8x and 64x
    // on the point the wide shot's own centre pixel shows.
    const study: Panel[] = [
      { label: "plain seahorse", map: { c: SEAHORSE_C } },
      { label: "plain near-cusp", map: { c: CUSP_C } },
      {
        label: "LEVER 1 rabbit + rot rx=45",
        map: { c: RABBIT_C, rot: [45, 0, 0] },
      },
      {
        label: "LEVER 2 rabbit, rotor xw=35",
        map: { c: RABBIT_C },
        slice: { turns: [{ plane: "xw", degrees: 35 }] },
      },
    ];
    const rows: PanelStats[][] = [[], [], []];
    for (const panel of study) {
      const de = buildMap(panel.map);
      const slice = panel.slice ?? {};
      const r = sliceMatrix(slice);
      const w0 = slice.w0 ?? 0;
      const centre = sliceAnchor(de, r);
      const estimator = panelDE(de, r, w0, centre);
      const shape = shapeStats(estimator, panelMember(de, r, w0, centre), 121);
      const surface = probeSurface(estimator, VIEW_R);
      const scales = [1, 8, 64];
      scales.forEach((k, row) => {
        const scaled =
          k === 1 || !surface ? estimator : zoomDE(estimator, surface, k);
        const stats = renderPreview(
          {
            de: scaled,
            boundingRadius: VIEW_R,
            stepScale: QJULIA_STEP_SCALE,
            eyeOffset: EYE_OFFSET,
            zoom: ZOOM,
          },
          SIZE,
        );
        rows[row].push(stats);
        console.log(
          `  ${panel.label} @${k}x  hits ${((stats.hits / (SIZE * SIZE)) * 100).toFixed(1)}%  ` +
            (k === 1
              ? `fill ${shape.fillPct.toFixed(1)}%  occ ${shape.occPct.toFixed(1)}%  ` +
                `reach ${shape.reach.toFixed(2)}xR  rough ${shape.rough.toFixed(2)}  `
              : "") +
            `steps/ray ${(stats.steps / (SIZE * SIZE)).toFixed(0)}  ${stats.ms}ms`,
        );
      });
    }
    console.log(
      `  wrote ${writeContactSheet(rows.flat(), 4, "qjulia-beauty-zoom.png")}`,
    );
  });

  it("searches the whole parameter space for the family's best", () => {
    // The panels above are chosen; this is not. Every lever at once — a random
    // 4D constant, a random rotation in all six planes of the MAP, a random
    // anisotropic scale and shear (the non-similarity shape neither named
    // lever covers), a random rotor and slice offset for the CUT — ranked by
    // `rough`, the intricacy index. If the family has a striking corner the
    // chosen panels missed, 240 rolls over the whole space is where it shows.
    const rng = mulberry32(0x7a8b2026);
    const angle = () => (rng() * 2 - 1) * 90;
    const candidates: { panel: Panel; shape: ShapeStats }[] = [];
    let dust = 0;
    let refused = 0;
    for (let i = 0; i < 240; i++) {
      const c: Vec4 = [
        rng() * 2 - 1,
        rng() * 2 - 1,
        (rng() * 2 - 1) * 0.6,
        (rng() * 2 - 1) * 0.6,
      ];
      // Half the rolls stay similarities (where the estimate is exact), half
      // deform `M` — so the sheet cannot be accused of having only measured
      // the shape the estimator flatters.
      const deformed = rng() < 0.5;
      const axis = () => (deformed ? 0.7 + rng() * 0.7 : 1);
      const skew = () => (deformed ? (rng() * 2 - 1) * 0.4 : 0);
      const map: MapSpec = {
        c,
        rot: [angle(), angle(), angle()],
        wRot: { xw: angle(), yw: angle(), zw: angle() },
        scale: [axis(), axis(), axis()],
        shear: [skew(), skew(), skew()],
      };
      const turns: { plane: keyof Rotation4; degrees: number }[] = (
        ["xy", "xz", "yz", "xw", "yw", "zw"] as (keyof Rotation4)[]
      ).map((plane) => ({ plane, degrees: angle() }));
      const slice: SliceSpec = { turns, w0: (rng() * 2 - 1) * 0.4 };
      const de = buildMap(map);
      const r = sliceMatrix(slice);
      const w0 = slice.w0 ?? 0;
      const centre = sliceAnchor(de, r);
      const shape = shapeStats(
        panelDE(de, r, w0, centre),
        panelMember(de, r, w0, centre),
        49,
      );
      // A bare `rough` ranking crowns DUST: a constant outside the
      // connectedness locus scatters into specks, whose staircase area over an
      // equal-volume ball is enormous and whose panel is empty backdrop. So a
      // candidate has to be a body first — some interior, and enough of the
      // frame to look at — and is ranked on intricacy only after that.
      if (!Number.isFinite(shape.rough)) continue;
      if (shape.fillPct < 0.5 || shape.occPct < 5) {
        dust++;
        continue;
      }
      // A deformed `M` grows the bounding radius, so such a roll can outgrow
      // the shared frame; that is a framing failure, not a finding.
      if (shape.reach > 0.95) {
        refused++;
        continue;
      }
      candidates.push({
        panel: {
          label:
            `${de.conformal ? "similarity " : "DEFORMED  "} ` +
            `c=(${c.map((v) => v.toFixed(2)).join(",")}) ` +
            `rot=(${map.rot?.map((v) => v.toFixed(0)).join(",")}) ` +
            `w=(${[map.wRot?.xw, map.wRot?.yw, map.wRot?.zw].map((v) => v?.toFixed(0)).join(",")}) ` +
            `scale=(${map.scale?.map((v) => v.toFixed(2)).join(",")}) ` +
            `shear=(${map.shear?.map((v) => v.toFixed(2)).join(",")}) ` +
            `rotor=(${turns.map((t) => t.degrees.toFixed(0)).join(",")}) w0=${w0.toFixed(2)}`,
          map,
          slice,
        },
        shape,
      });
    }
    candidates.sort((a, b) => b.shape.rough - a.shape.rough);
    console.log(
      `  ${candidates.length}/240 rolls landed a body worth looking at ` +
        `(${dust} were dust or near-empty, ${refused} outgrew the frame)`,
    );
    for (const { panel, shape } of candidates.slice(0, 8)) {
      console.log(
        `  rough ${shape.rough.toFixed(2)}  fill ${shape.fillPct.toFixed(1).padStart(5)}%  ` +
          `occ ${shape.occPct.toFixed(1).padStart(5)}%  ${panel.label}`,
      );
    }
    const best = candidates.slice(0, 4).map((c) => renderPanel(c.panel, 61));
    console.log(
      `  wrote ${writeContactSheet(best, 4, "qjulia-beauty-search.png")}`,
    );
  });

  it("scans the two levers for something worth rendering", () => {
    const rows: string[] = [];
    for (const angle of [10, 20, 30, 45, 60, 90]) {
      for (const [name, map] of [
        ["rot rx", { c: CONTROL_C, rot: [angle, 0, 0] }],
        ["rot ry", { c: CONTROL_C, rot: [0, angle, 0] }],
        ["rot rz", { c: CONTROL_C, rot: [0, 0, angle] }],
        ["w  xw ", { c: CONTROL_C, wRot: { xw: angle } }],
      ] as [string, MapSpec][]) {
        const de = buildMap(map);
        const r = sliceMatrix({});
        const centre = sliceAnchor(de, r);
        const shape = shapeStats(
          panelDE(de, r, 0, centre),
          panelMember(de, r, 0, centre),
          61,
        );
        rows.push(
          `  ${name} ${String(angle).padStart(3)}deg  fill ${shape.fillPct.toFixed(1).padStart(5)}%  ` +
            `occ ${shape.occPct.toFixed(1).padStart(5)}%  rough ${shape.rough.toFixed(2)}  ` +
            `lathe ${latheDefect(de).toFixed(4)}`,
        );
      }
    }
    for (const row of rows) console.log(row);
  });
});
