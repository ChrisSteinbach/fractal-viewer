import { composeAffine, composeLinearAffine, isIdentityAffine } from "./affine";
import { composeAffine4, composeLinearAffine4, toTransform4 } from "./affine4";
import { hyperMengerSpongeTransforms, mengerSponge } from "./presets";
import { singularValues3 } from "./surface-de";
import { singularValues4 } from "./surface-de-4d";
import { SHAPE_MARCH_SAFETY } from "./shapes";
import type { SymmetryParams, Transform, Vec3, Vec4 } from "./types";

/**
 * The FINITE-SOLID optical oracle — the dielectric transport's
 * co-extensive optical solid over a finite cell decomposition
 * (`docs/surface-dielectric-study.md`'s "Explicit geometry", the
 * owner-selected appearance) as a production `src/fractal/` module.
 *
 * The attractor of a recursive IFS has no volume; glass is a MEDIUM with an
 * interior. The study's selected object is the FINITE Menger — a level-N
 * cell decomposition — and its posed 4D hyper-Menger slice. The honest
 * deliverable is glass over the finite construction itself, with the
 * display CO-EXTENSIVE with the optical solid (the transport contract's
 * rear-scene rule). This module is the ONE construction and its query
 * forms:
 *
 * - **The construction** (`FiniteSolidConstruction`): the study's exact
 *   ternary grid — each axis split in thirds per level, a child kept when
 *   AT MOST ONE of its coordinates is the middle third (3D: 20 children
 *   per level; 4D: 48) — so membership is an integer-cell predicate,
 *   shared internal cell faces are suppressible by identity, and the
 *   boundary planes are exact. The construction is admitted FROM THE
 *   DOCUMENT's own maps (`analyzeFiniteSolidSystem` composes each active
 *   map with the shared affine twins and refuses anything that is not
 *   exactly the shipped level-1 map set), so the document's edits always
 *   render the cells its own maps build — never a construction restated
 *   from a preset.
 * - **The exact boundary query** (`finiteSolidNextBoundary`,
 *   `finiteSolidNextBoundaryFromAnchor`): the qualified fixture's DDA —
 *   integer cell occupancy, analytic grid planes, NO distance epsilon, the
 *   anchor contract (canonical intrinsic point, tied-plane mask, plane
 *   indices, post-incident cell indices), and the exact-corner normal
 *   convention (projection onto the span of the tied displayed normals,
 *   Gram-Schmidt in ascending intrinsic-axis order, rank-zero refusal).
 *   This is `scripts/transmission-dielectric-solid.ts`'s arithmetic — the
 *   STUDY'S oracle, not a marched min-SDF. The distinction is load-bearing
 *   (the abutting-seam measurement): an interval query never
 *   marches a field, so the ~0 the min-combined union field reads at
 *   shared interior planes cannot produce phantom crossings.
 * - **The signed field** (`finiteSolidField`): min over occupied cells of
 *   the exact box SDF — outside it is a certified conservative bound
 *   (1-Lipschitz boxes; the union's distance is the min), inside it is the
 *   deepest containing box's depth (a lower bound on the complement
 *   distance). The zero is exact. This is the display/preview estimator
 *   and the field the shader mirrors step; the transport's boundary query
 *   does NOT use it (the DDA above is exact).
 * - **The exact ray intervals** (`finiteSolidIntervals`): per-cell slab
 *   clips unioned with NO optical epsilon — the proxy's
 *   `boxUnionIntervals` (`scripts/transmission-proxy.ts`), the arithmetic
 *   the owner-selected appearance came from. A positive gap stays a gap.
 *
 * DIMENSIONAL PARITY is the construction's own: the 4D rule is the 3D
 * rule with "at most one middle coordinate" generalized to four axes
 * (48 maps vs 20), the posed slice rides `FiniteSolidPose` (row-major
 * world→intrinsic rows + slice, the qualified fixture's convention), and
 * the displayed normal of a 4D boundary is the crossed matrix row's
 * normalized xyz part with the outward sign — a normal of the DISPLAYED
 * slice (slice-then-operate, the transport contract's own reduction).
 * Both dimensions are certified by the same harness
 * (`scripts/finite-solid.harness.ts`).
 *
 * THE LEVEL IS AUTHORED. The SHAPED constructions certify 0..2
 * (`FINITE_SOLID_MAX_LEVEL`, the proxy's certified band): level 0 the root
 * box, level 1 the 20/48 cells, level 2 the 400/2,304-cell study
 * construction. The GENERAL construction — the document's own maps as a
 * SIMPLICIAL word tree (`analyzeFiniteSolidGeneral`) — certifies 0..4
 * (`FINITE_SOLID_GENERAL_MAX_LEVEL`, the 4-slot anchor word's band); level
 * 5 would need a packed word. Deeper levels than a construction certifies
 * were measured too costly for full-size transport; the refusal states
 * that rather than silently clamping.
 *
 * Refusals are loud (`analyzeFiniteSolidSystem` returns every reason):
 * only compositions the cell arithmetic certifies are admitted — the
 * shipped level-1 map sets themselves (any edit leaves the vocabulary),
 * no kaleidoscope above order 1, no warping final transform (an exact
 * identity lens composes), and the level cap.
 */
export const FINITE_SOLID_MAX_LEVEL = 2;

/** Which shipped construction a document opts into. */
export type FiniteSolidShape = "menger" | "hyperMenger";

export const FINITE_SOLID_SHAPES: readonly FiniteSolidShape[] = [
  "menger",
  "hyperMenger",
];

/** The resolved finite-solid block. `kind: "shaped"` names one of the
 * shipped constructions (the maps must BE it — `analyzeFiniteSolidSystem`);
 * `kind: "general"` is the SHAPE-LESS block `{level}` alone: the word tree
 * built from the DOCUMENT's own maps (`analyzeFiniteSolidGeneral`, the
 * general admission). */
export type FiniteSolid =
  | { kind: "shaped"; shape: FiniteSolidShape; level: number }
  | { kind: "general"; level: number };

/** The authored finite-solid block exactly as the document carries it —
 * {@link resolveFiniteSolid} validates it, never clamps, so a refused block
 * stays verbatim in the document with its refusal beside it (the
 * sphere-inversion block's own discipline). */
export interface FiniteSolidAuthored {
  shape?: string;
  level?: number;
}

export type FiniteSolidResolution =
  { ok: true; value: FiniteSolid } | { ok: false; reasons: string[] };

/**
 * Validate one authored finite-solid block. A block carrying `shape` names
 * one of the shipped constructions and resolves `kind: "shaped"`; a block
 * carrying `{level}` alone resolves `kind: "general"` — the document's own
 * maps as the word tree. Either way the level must be an integer in the
 * certified band. Out-of-domain values and unknown keys REFUSE with
 * reasons, never clamp or coerce — a clamp would render a different object
 * than the document names, and an unknown key may be a field from a newer
 * version that must not silently render as if absent.
 */
export function resolveFiniteSolid(
  authored: FiniteSolidAuthored,
): FiniteSolidResolution {
  const reasons: string[] = [];
  for (const key of Object.keys(authored)) {
    if (key !== "shape" && key !== "level") {
      reasons.push(`unknown finite-solid field "${key}"`);
    }
  }
  const level = authored.level;
  const shapeKey = "shape" in authored ? authored.shape : undefined;
  const shaped =
    shapeKey === "menger" || shapeKey === "hyperMenger" ? shapeKey : null;
  const maxLevel =
    shaped === null ? FINITE_SOLID_GENERAL_MAX_LEVEL : FINITE_SOLID_MAX_LEVEL;
  const levelOk =
    typeof level === "number" &&
    Number.isInteger(level) &&
    level >= 0 &&
    level <= maxLevel;
  if (!levelOk) {
    reasons.push(`the finite-solid level must be an integer in 0..${maxLevel}`);
  }
  if (shapeKey !== undefined && shaped === null) {
    reasons.push(`unknown finite-solid shape "${String(shapeKey)}"`);
  }
  // Any refusal wins over any value: a block the document names must never
  // silently render as a different one (the resolver's own discipline).
  if (reasons.length > 0 || !levelOk) {
    return { ok: false, reasons };
  }
  return {
    ok: true,
    value:
      shaped === null
        ? { kind: "general", level: level }
        : { kind: "shaped", shape: shaped, level: level },
  };
}

/** The construction's origin-centred bound: the root box's circumscribed
 * sphere in the construction's own dimension (`half·√dim`) — the whole
 * construction is visible, so this is also the marching ball. Optical
 * material lengths use the root half extent independently, matching the
 * selected study's Beer normalization in both dimensions. */
export function finiteSolidBoundingRadius(dim: 3 | 4): number {
  return FINITE_SOLID_HALF_EXTENT * Math.sqrt(dim);
}

/** The root half extent both constructions normalize to (the study's
 * `DIELECTRIC_HALF_EXTENT`): maps at offsets ±0.5 with scale 1/3 give
 * H = H/3 + 0.5, hence H = 0.75, in both dimensions. */
export const FINITE_SOLID_HALF_EXTENT = 0.75;

/** One grid face: the axis, the finest-grid plane index in [0, G], and the
 * construction level — the anchor's canonical face identity. */
export interface FiniteSolidFace {
  axis: number;
  planeIndex: number;
  level: number;
}

/** The boundary query's anchor — backend-owned continuation state that
 * identifies the crossed boundary canonically so the next query suppresses
 * exactly that face at exactly its own origin. Carries the intrinsic
 * intersection (crossed components snapped to their planes), the
 * tied-plane mask, the plane indices and the post-incident cell indices —
 * the qualified fixture's anchor, unchanged. */
export interface FiniteSolidAnchor {
  intrinsicPoint: Vec4;
  planeMask: number;
  planeIndices: [number, number, number, number];
  cellIndices: [number, number, number, number];
}

export interface FiniteSolidBoundary {
  kind: "boundary";
  t: number;
  entering: boolean;
  outwardNormal: Vec3;
  intrinsicAxis: number;
  faceSign: -1 | 1;
  face: FiniteSolidFace;
  anchor: FiniteSolidAnchor;
  visits: number;
  /** The general word tree's MEDIA transition (absent on the shaped
   * grid): the medium code before and after the event
   * (`FINITE_SOLID_MEDIUM_AIR`, a glass code >= 1, or
   * `FINITE_SOLID_MEDIUM_OPAQUE`) and the branch — the top-level map —
   * that owns the medium after it (-1 in air). */
  fromMedium?: number;
  toMedium?: number;
  toBranch?: number;
}

export interface FiniteSolidMiss {
  kind: "miss";
  visits: number;
}

export type FiniteSolidRefusalReason =
  | "visit-cap"
  | "invalid-input"
  | "state-mismatch"
  | "ambiguous-anchor"
  | "nonmonotone-crossing"
  | "degenerate-projected-normal";

export interface FiniteSolidRefusal {
  kind: "refused";
  reason: FiniteSolidRefusalReason;
  visits: number;
  /** On the general word tree's state-mismatch: the medium the GEOMETRY
   * reads at the start — what a transport re-anchoring its split adopts
   * (the corner class's one-query-deeper retry, medium-coded). */
  geometryMedium?: number;
}

export type FiniteSolidBoundaryResult =
  FiniteSolidBoundary | FiniteSolidMiss | FiniteSolidRefusal;

export interface FiniteSolidNextBoundaryOptions {
  /** Medium ownership immediately after tMin along this ray. */
  inside: boolean;
  tMin?: number;
  /** Only this same face may be suppressed, and only exactly at tMin. */
  previousFace?: FiniteSolidFace;
}

/** The general word tree's query options: the per-map `media` table
 * (absent = every map glass code 1, the single-material solid) and the
 * caller's claimed `medium` code, which replaces `inside` as the claim
 * when media is present (`inside` stays required for the shared shape). */
export interface FiniteSolidGeneralQueryOptions extends FiniteSolidNextBoundaryOptions {
  media?: FiniteSolidGeneralMedia;
  medium?: number;
}

/** The posed display: row-major world→intrinsic rows (the composed
 * rotor's) plus the slice position. 3D sessions use the identity pose —
 * the embed is exact there. */
export interface FiniteSolidPose {
  rows: [Vec4, Vec4, Vec4, Vec4];
  slice: number;
}

/** The canonical 3D pose (identity rows, slice 0). */
export const FINITE_SOLID_IDENTITY_POSE: FiniteSolidPose = {
  rows: [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ],
  slice: 0,
};

export function finiteSolidPose(
  rows: readonly number[],
  slice: number,
): FiniteSolidPose {
  return {
    rows: [
      [rows[0], rows[1], rows[2], rows[3]],
      [rows[4], rows[5], rows[6], rows[7]],
      [rows[8], rows[9], rows[10], rows[11]],
      [rows[12], rows[13], rows[14], rows[15]],
    ],
    slice,
  };
}

/** A CONSTRUCTED finite solid: the ternary grid (level, half extent), the
 * occupancy bitmap, and the per-level child count the maps were validated
 * against. Intrinsic coordinates: the root spans `[-half, half]^dim`,
 * plane i sits at `gridPlane(i)`, cell size `2·half/G`. */
export interface FiniteSolidConstruction {
  shape: FiniteSolidShape;
  dimension: 3 | 4;
  level: number;
  half: number;
  /** `3^level` cells per axis. */
  gridSize: number;
  /** Occupancy bitmap, bit `ix + G·iy + G²·iz (+ G³·iw)`. */
  occupancy: Uint32Array;
  /** The per-level child count the maps were validated against. */
  mapCount: number;
}

/** Tolerance for the "exactly 1/3 scale, exactly the grid offsets" map
 * checks — authored documents carry 0.5 and 1/3 as computed doubles and
 * `composeAffine`'s multiply is exact for both, so this is a pure
 * round-trip guard, never a clamp. */
const MAP_TOL = 1e-12;

/** The coordinate reconstruction envelope, relative to the half extent —
 * the fixture's f32-rounding allowance (`2·2^-23`), the float-precision
 * continuation policy's declared allowance. */
const COORDINATE_ENVELOPE_REL = 2 * 2 ** -23;

function coordinateEnvelope(half: number): number {
  return half * COORDINATE_ENVELOPE_REL;
}

/**
 * The hyper-Menger's level-1 maps: the 3D Menger's rule one dimension up —
 * keep the child when at most ONE of its four coordinates is the middle
 * third (16 with no middle axis + 4·8 with exactly one = 48 children).
 * The 4D half's ONE definition; the 3D preset's maps (`mengerSponge`) are
 * reused verbatim where the rules coincide. Defined in `presets.ts`
 * beside its 3D twin (this module imports it from there), re-exported so
 * the family's vocabulary stays one import away.
 */
export { hyperMengerSpongeTransforms } from "./presets";

/** Terminal-cell counts per level, for budget lines and eligibility notes. */
export function finiteSolidCellCount(dimension: 3 | 4, level: number): number {
  const per = dimension === 3 ? 20 : 48;
  return per ** level;
}

/** Build the construction's occupancy bitmap from the shape's own rule. */
export function buildFiniteSolidConstruction(
  shape: FiniteSolidShape,
  dimension: 3 | 4,
  level: number,
): FiniteSolidConstruction {
  const gridSize = 3 ** level;
  const bitCount = gridSize ** dimension;
  const occupancy = new Uint32Array(Math.ceil(bitCount / 32));
  const index = new Array<number>(dimension).fill(0);
  const visit = (axis: number, linear: number): void => {
    if (axis === dimension) {
      if (finiteSolidCellOccupiedByRule(dimension, level, index)) {
        occupancy[linear >>> 5] |= 1 << (linear & 31);
      }
      return;
    }
    for (let i = 0; i < gridSize; i++) {
      index[axis] = i;
      visit(axis + 1, linear * gridSize + i);
    }
  };
  visit(0, 0);
  return {
    shape,
    dimension,
    level,
    half: FINITE_SOLID_HALF_EXTENT,
    gridSize,
    occupancy,
    mapCount: dimension === 3 ? 20 : 48,
  };
}

/** The construction rule, directly (the bitmap's definition): a finest
 * cell is occupied iff, at every level, at most one of its coordinates
 * falls in the middle third. Out-of-range indices are empty. */
export function finiteSolidCellOccupiedByRule(
  dimension: 3 | 4,
  level: number,
  index: readonly number[],
): boolean {
  const gridSize = 3 ** level;
  for (let axis = 0; axis < dimension; axis++) {
    if (
      !Number.isInteger(index[axis]) ||
      index[axis] < 0 ||
      index[axis] >= gridSize
    ) {
      return false;
    }
  }
  for (let l = 0, divisor = gridSize / 3; l < level; l++, divisor /= 3) {
    let middles = 0;
    for (let axis = 0; axis < dimension; axis++) {
      if (Math.floor(index[axis] / divisor) % 3 === 1) middles++;
    }
    if (middles > 1) return false;
  }
  return true;
}

/** Bitmap membership (the DDA's read path). */
export function finiteSolidCellOccupied(
  c: FiniteSolidConstruction,
  index: readonly number[],
): boolean {
  const g = c.gridSize;
  for (let axis = 0; axis < c.dimension; axis++) {
    if (index[axis] < 0 || index[axis] >= g) return false;
  }
  let linear = 0;
  for (let axis = 0; axis < c.dimension; axis++) {
    linear = linear * g + index[axis];
  }
  return (c.occupancy[linear >>> 5] & (1 << (linear & 31))) !== 0;
}

/** The centred rational grid plane — the fixture's own form, chosen because
 * it has no multiply-add cancellation site for a backend to contract
 * differently between boundary emission and anchor validation. */
export function finiteSolidGridPlane(
  planeIndex: number,
  half: number,
  gridSize: number,
): number {
  if (planeIndex === 0) return -half;
  if (planeIndex === gridSize) return half;
  return (half * (2 * planeIndex - gridSize)) / gridSize;
}

/** Maximum finest-grid cells one boundary query may classify — the
 * fixture's bound (a straight segment crosses each axis's grid planes at
 * most once each). */
export function finiteSolidMaxVisits(dimension: 3 | 4, level: number): number {
  const gridSize = 3 ** level;
  return dimension * (gridSize - 1) + 1;
}

// ---------------------------------------------------------------------------
// The posed embed (the qualified fixture's convention, verbatim).
// ---------------------------------------------------------------------------

export function finiteSolidIntrinsicPoint(
  pose: FiniteSolidPose,
  point: Vec3,
): Vec4 {
  const p: Vec4 = [point[0], point[1], point[2], pose.slice];
  return pose.rows.map((row) =>
    row.reduce((sum, value, axis) => sum + value * p[axis], 0),
  ) as Vec4;
}

export function finiteSolidIntrinsicDirection(
  pose: FiniteSolidPose,
  direction: Vec3,
): Vec4 {
  return pose.rows.map(
    (row) =>
      row[0] * direction[0] + row[1] * direction[1] + row[2] * direction[2],
  ) as Vec4;
}

// ---------------------------------------------------------------------------
// The admission.
// ---------------------------------------------------------------------------

export interface FiniteSolidAnalysis {
  status: "eligible" | "ineligible";
  reasons: string[];
  construction?: FiniteSolidConstruction;
}

/** Is the row-major 3x3 exactly the third contraction diag(1/3)? */
function isThirdContraction3(m: readonly number[]): boolean {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const target = r === c ? 1 / 3 : 0;
      if (Math.abs(m[r * 3 + c] - target) > MAP_TOL) return false;
    }
  }
  return true;
}

/** Is the row-major 4x4 exactly the third contraction diag(1/3)? */
function isThirdContraction4(m: readonly number[]): boolean {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const target = r === c ? 1 / 3 : 0;
      if (Math.abs(m[r * 4 + c] - target) > MAP_TOL) return false;
    }
  }
  return true;
}

/** Compose each active map through the shared affine twins and collect its
 * offset vector, refusing anything that is not one of the constructions'
 * bare third-contraction affines. */
function collectFiniteSolidMaps(
  transforms: readonly Transform[],
  reasons: string[],
): Vec4[] | null {
  const offsets: Vec4[] = [];
  for (const transform of transforms) {
    if (transform.variations && transform.variations.length > 0) {
      reasons.push(
        `map ${transform.id + 1} carries variations; the cell decomposition is pure affine`,
      );
      return null;
    }
    if (transform.emitter) {
      reasons.push(
        `map ${transform.id + 1} carries an emitter; the cell decomposition is pure affine`,
      );
      return null;
    }
    if (transform.chaos) {
      reasons.push(
        `map ${transform.id + 1} carries a chaos row; the cell decomposition has no graph-directed selection`,
      );
      return null;
    }
    if (transform.post && !isIdentityAffine(transform.post)) {
      reasons.push(
        `map ${transform.id + 1} carries a post-affine; the cell decomposition is the bare affine contraction`,
      );
      return null;
    }
    let t: Vec4;
    if (transform.w) {
      const lifted = toTransform4(transform);
      if (lifted.post4) {
        reasons.push(
          `map ${transform.id + 1} carries a 4D post-affine; the cell decomposition is the bare affine contraction`,
        );
        return null;
      }
      const a4 = composeAffine4(lifted);
      if (!isThirdContraction4(a4.m)) {
        reasons.push(
          `map ${transform.id + 1} is not the exact third-contraction affine`,
        );
        return null;
      }
      t = a4.t;
    } else {
      const a = composeAffine(transform);
      if (!isThirdContraction3(a.m)) {
        reasons.push(
          `map ${transform.id + 1} is not the exact third-contraction affine`,
        );
        return null;
      }
      t = [a.t[0], a.t[1], a.t[2], 0];
    }
    // The construction's offsets are VALUES, not just signs: an edited
    // position optically moves the cells away from the grid the document's
    // other views draw, so any offset outside {0, ±0.5} (to the same
    // round-trip tolerance) refuses.
    for (let axis = 0; axis < 4; axis++) {
      if (axis === 3 && !transform.w) {
        // A 3D-embedded map carries no w offset at all.
        continue;
      }
      if (!isConstructionOffset(t[axis])) {
        reasons.push(
          `map ${transform.id + 1} translates ${t[axis]} on axis ${axis}, not a construction offset (0, ±0.5)`,
        );
        return null;
      }
    }
    offsets.push(t);
  }
  return offsets;
}

function isConstructionOffset(value: number): boolean {
  return (
    Math.abs(value) <= MAP_TOL || Math.abs(Math.abs(value) - 0.5) <= MAP_TOL
  );
}

function offsetKey(o: Vec4, dimension: 3 | 4): string {
  return o
    .slice(0, dimension)
    .map((v) => (v === 0 ? "0" : v > 0 ? "+" : "-"))
    .join("");
}

/** The shipped level-1 offset sets, as canonical signed-axis keys. */
function shippedLevel1Offsets(dimension: 3 | 4): Set<string> {
  const keys = new Set<string>();
  if (dimension === 3) {
    for (const t of mengerSponge()) {
      keys.add(offsetKey([t.position[0], t.position[1], t.position[2], 0], 3));
    }
  } else {
    for (const t of hyperMengerSpongeTransforms()) {
      keys.add(
        offsetKey(
          [t.position[0], t.position[1], t.position[2], t.w?.position ?? 0],
          4,
        ),
      );
    }
  }
  return keys;
}

/**
 * The finite-solid admission: classify the document's transform system as
 * one of the two shipped constructions at an authored level, or return
 * every reason it is not. Pure; the routing layer layers its own
 * combination refusals (tiling, shape trap, session balloon) on top, the
 * way `surfaceClosedSolidAdmitted` does for the estimator backend.
 */
export function analyzeFiniteSolidSystem(
  transforms: readonly Transform[],
  finalTransform: Transform | null,
  symmetry: SymmetryParams,
  shape: FiniteSolidShape,
  level: number,
): FiniteSolidAnalysis {
  const dimension = shape === "hyperMenger" ? 4 : 3;
  if (!Number.isInteger(level) || level < 0 || level > FINITE_SOLID_MAX_LEVEL) {
    return {
      status: "ineligible",
      reasons: [
        `finite-solid level ${level} is outside the certified band 0..${FINITE_SOLID_MAX_LEVEL}`,
      ],
    };
  }
  const active = transforms.filter((t) => (t.weight ?? 1) > 0);
  const expectedMaps = dimension === 3 ? 20 : 48;
  const reasons: string[] = [];
  if (active.length !== expectedMaps) {
    reasons.push(
      `the ${shape} construction is exactly ${expectedMaps} active maps; this document carries ${active.length}`,
    );
    return { status: "ineligible", reasons };
  }
  if (symmetry.order > 1) {
    reasons.push(
      "the kaleidoscope does not compose with a finite cell decomposition (the cells are the un-symmetrized set)",
    );
    return { status: "ineligible", reasons };
  }
  if (finalTransform && !isIdentityAffine(composeAffine(finalTransform))) {
    reasons.push(
      "the final transform warps the cell decomposition (only an untouched identity lens composes)",
    );
    return { status: "ineligible", reasons };
  }
  const collected = collectFiniteSolidMaps(active, reasons);
  if (!collected) {
    return { status: "ineligible", reasons };
  }
  const expected = shippedLevel1Offsets(dimension);
  const seen = collected.map((o) => offsetKey(o, dimension));
  const seenSet = new Set(seen);
  if (seen.length !== expected.size || seenSet.size !== seen.length) {
    reasons.push(
      `the active maps are not the ${shape} construction's level-1 map set (${seenSet.size} distinct offsets against ${expected.size})`,
    );
    return { status: "ineligible", reasons };
  }
  for (const key of seen) {
    if (!expected.has(key)) {
      reasons.push(`map offset (${key}) is not a ${shape} child position`);
      return { status: "ineligible", reasons };
    }
  }
  return {
    status: "eligible",
    reasons: [],
    construction: buildFiniteSolidConstruction(shape, dimension, level),
  };
}

// ---------------------------------------------------------------------------
// Membership at a point.
// ---------------------------------------------------------------------------

function candidateCellIndices(
  coordinate: number,
  half: number,
  gridSize: number,
): number[] {
  if (coordinate < -half || coordinate > half) return [];
  const width = (2 * half) / gridSize;
  const u = (coordinate + half) / width;
  if (u <= 0) return [0];
  if (u >= gridSize) return [gridSize - 1];
  const lower = Math.floor(u);
  return u === lower ? [lower - 1, lower] : [lower];
}

/** Closed-set membership at a point (either side of an exact plane owns). */
export function finiteSolidContains(
  c: FiniteSolidConstruction,
  pose: FiniteSolidPose,
  point: Vec3,
): boolean {
  if (!point.every(Number.isFinite)) return false;
  const q = finiteSolidIntrinsicPoint(pose, point);
  const g = c.gridSize;
  const half = c.half;
  const candidates: number[][] = [];
  for (let axis = 0; axis < c.dimension; axis++) {
    candidates.push(candidateCellIndices(q[axis], half, g));
  }
  if (candidates.some((axis) => axis.length === 0)) return false;
  const index = new Array<number>(c.dimension).fill(0);
  const search = (axis: number): boolean => {
    if (axis === c.dimension) return finiteSolidCellOccupied(c, index);
    for (const candidate of candidates[axis]) {
      index[axis] = candidate;
      if (search(axis + 1)) return true;
    }
    return false;
  };
  return search(0);
}

/** Occupancy an infinitesimal positive distance along `direction`. */
export function finiteSolidRaySideOccupancy(
  c: FiniteSolidConstruction,
  pose: FiniteSolidPose,
  point: Vec3,
  direction: Vec3,
): boolean {
  if (!point.every(Number.isFinite) || !direction.every(Number.isFinite)) {
    return false;
  }
  const q = finiteSolidIntrinsicPoint(pose, point);
  const qd = finiteSolidIntrinsicDirection(pose, direction);
  const g = c.gridSize;
  const half = c.half;
  const width = (2 * half) / g;
  const index: number[] = [];
  for (let axis = 0; axis < c.dimension; axis++) {
    const u = (q[axis] + half) / width;
    let cell: number;
    if (u <= 0) cell = qd[axis] < 0 ? -1 : 0;
    else if (u >= g) cell = qd[axis] > 0 ? g : g - 1;
    else {
      const lower = Math.floor(u);
      cell = u === lower && qd[axis] < 0 ? lower - 1 : lower;
    }
    index.push(cell);
  }
  return finiteSolidCellOccupied(c, index);
}

// ---------------------------------------------------------------------------
// The exact boundary query (the qualified DDA, adapted to the construction).
// ---------------------------------------------------------------------------

function sameFace(a: FiniteSolidFace | undefined, b: FiniteSolidFace): boolean {
  return (
    a !== undefined &&
    a.axis === b.axis &&
    a.planeIndex === b.planeIndex &&
    a.level === b.level
  );
}

function chooseAxis(axes: readonly number[], qd: Vec4): number {
  let chosen = axes[0];
  for (const axis of axes) {
    if (Math.abs(qd[axis]) > Math.abs(qd[chosen])) chosen = axis;
  }
  return chosen;
}

/**
 * The exact-corner normal: reflect/refract against the incident ray's
 * projection onto the span of every exactly tied displayed face normal.
 * Single-face crossings use that face's own row. Rank-zero geometry (a
 * direction orthogonal to every tied face's span) refuses.
 */
export function finiteSolidBoundaryNormal(
  pose: FiniteSolidPose,
  dimension: 3 | 4,
  direction: Vec3,
  planeMask: number,
  entering: boolean,
): Vec3 | null {
  if (planeMask > 0 && (planeMask & (planeMask - 1)) === 0) {
    const axis = Math.log2(planeMask);
    if (axis >= dimension) return null;
    const row = pose.rows[axis];
    const magnitude = Math.hypot(row[0], row[1], row[2]);
    if (!(magnitude > 0) || !Number.isFinite(magnitude)) return null;
    const intrinsicDirection =
      row[0] * direction[0] + row[1] * direction[1] + row[2] * direction[2];
    const directionSign = intrinsicDirection > 0 ? 1 : -1;
    const faceSign = entering ? -directionSign : directionSign;
    return [
      (faceSign * row[0]) / magnitude,
      (faceSign * row[1]) / magnitude,
      (faceSign * row[2]) / magnitude,
    ];
  }
  const basis: Vec3[] = [];
  for (let axis = 0; axis < dimension && basis.length < 3; axis++) {
    if ((planeMask & (1 << axis)) === 0) continue;
    const vector = [...pose.rows[axis].slice(0, 3)] as Vec3;
    for (const unit of basis) {
      const projection = vector.reduce(
        (sum, value, component) => sum + value * unit[component],
        0,
      );
      for (let component = 0; component < 3; component++) {
        vector[component] -= projection * unit[component];
      }
    }
    const magnitude = Math.hypot(vector[0], vector[1], vector[2]);
    if (!(magnitude > 0) || !Number.isFinite(magnitude)) continue;
    basis.push([
      vector[0] / magnitude,
      vector[1] / magnitude,
      vector[2] / magnitude,
    ]);
  }
  const projected: Vec3 = [0, 0, 0];
  for (const unit of basis) {
    const amount = direction.reduce(
      (sum, value, component) => sum + value * unit[component],
      0,
    );
    for (let component = 0; component < 3; component++) {
      projected[component] += amount * unit[component];
    }
  }
  const magnitude = Math.hypot(projected[0], projected[1], projected[2]);
  if (!(magnitude > 0) || !Number.isFinite(magnitude)) return null;
  const sign = entering ? -1 : 1;
  return [
    (sign * projected[0]) / magnitude,
    (sign * projected[1]) / magnitude,
    (sign * projected[2]) / magnitude,
  ];
}

interface RootClip {
  enter: number;
  exit: number;
  enterAxes: number[];
}

function clipRoot(
  half: number,
  dimension: 3 | 4,
  q: Vec4,
  qd: Vec4,
): RootClip | null {
  let enter = -Infinity;
  let exit = Infinity;
  let enterAxes: number[] = [];
  for (let axis = 0; axis < dimension; axis++) {
    if (qd[axis] === 0) {
      if (q[axis] < -half || q[axis] > half) return null;
      continue;
    }
    const a = (-half - q[axis]) / qd[axis];
    const b = (half - q[axis]) / qd[axis];
    const near = Math.min(a, b);
    const far = Math.max(a, b);
    if (near > enter) {
      enter = near;
      enterAxes = [axis];
    } else if (near === enter) {
      enterAxes.push(axis);
    }
    exit = Math.min(exit, far);
    if (exit < enter) return null;
  }
  return { enter, exit, enterAxes };
}

function boundaryFor(
  c: FiniteSolidConstruction,
  pose: FiniteSolidPose,
  qOrigin: Vec4,
  direction: Vec3,
  t: number,
  entering: boolean,
  axis: number,
  crossedAxes: readonly number[],
  planeIndices: readonly number[],
  cellIndices: readonly number[],
  qd: Vec4,
  visits: number,
): FiniteSolidBoundary | FiniteSolidRefusal {
  const dimension = c.dimension;
  const half = c.half;
  const gridSize = c.gridSize;
  const planeIndex = planeIndices[axis];
  const directionSign = qd[axis] > 0 ? 1 : -1;
  const faceSign = (entering ? -directionSign : directionSign) as -1 | 1;
  const planeMask = crossedAxes.reduce(
    (mask, crossedAxis) => mask | (1 << crossedAxis),
    0,
  );
  const outwardNormal = finiteSolidBoundaryNormal(
    pose,
    dimension,
    direction,
    planeMask,
    entering,
  );
  if (!outwardNormal) {
    return { kind: "refused", reason: "degenerate-projected-normal", visits };
  }
  const intrinsicPoint = qOrigin.map(
    (value, intrinsicAxis) => value + t * qd[intrinsicAxis],
  ) as Vec4;
  const anchorPlanes: [number, number, number, number] = [-1, -1, -1, -1];
  for (const crossedAxis of crossedAxes) {
    anchorPlanes[crossedAxis] = planeIndices[crossedAxis];
    intrinsicPoint[crossedAxis] = finiteSolidGridPlane(
      planeIndices[crossedAxis],
      half,
      gridSize,
    );
  }
  const anchorCells: [number, number, number, number] = [-1, -1, -1, -1];
  for (let intrinsicAxis = 0; intrinsicAxis < dimension; intrinsicAxis++) {
    anchorCells[intrinsicAxis] = cellIndices[intrinsicAxis];
  }
  // The integer DDA cell is authoritative: an unmasked coordinate rounded
  // across its cell boundary by evaluating qOrigin + t·qd is reconstructed
  // onto the canonical plane within the declared envelope, and refused
  // beyond it.
  const envelope = coordinateEnvelope(half);
  for (let intrinsicAxis = 0; intrinsicAxis < dimension; intrinsicAxis++) {
    if ((planeMask & (1 << intrinsicAxis)) !== 0) continue;
    const cell = anchorCells[intrinsicAxis];
    const lower = finiteSolidGridPlane(cell, half, gridSize);
    const upper = finiteSolidGridPlane(cell + 1, half, gridSize);
    if (intrinsicPoint[intrinsicAxis] < lower) {
      if (lower - intrinsicPoint[intrinsicAxis] > envelope) {
        return { kind: "refused", reason: "invalid-input", visits };
      }
      intrinsicPoint[intrinsicAxis] = lower;
    } else if (intrinsicPoint[intrinsicAxis] > upper) {
      if (intrinsicPoint[intrinsicAxis] - upper > envelope) {
        return { kind: "refused", reason: "invalid-input", visits };
      }
      intrinsicPoint[intrinsicAxis] = upper;
    }
  }
  return {
    kind: "boundary",
    t,
    entering,
    outwardNormal,
    intrinsicAxis: axis,
    faceSign,
    face: { axis, planeIndex, level: c.level },
    anchor: {
      intrinsicPoint,
      planeMask,
      planeIndices: anchorPlanes,
      cellIndices: anchorCells,
    },
    visits,
  };
}

function validConstruction(c: FiniteSolidConstruction): boolean {
  return (
    (c.dimension === 3 || c.dimension === 4) &&
    Number.isInteger(c.level) &&
    c.level >= 0 &&
    c.level <= FINITE_SOLID_MAX_LEVEL &&
    Number.isFinite(c.half) &&
    c.half > 0 &&
    Number.isInteger(c.gridSize) &&
    c.gridSize === 3 ** c.level &&
    c.occupancy instanceof Uint32Array
  );
}

function validAnchor(
  c: FiniteSolidConstruction,
  anchor: FiniteSolidAnchor,
): boolean {
  const gridSize = 3 ** c.level;
  const envelope = coordinateEnvelope(c.half);
  if (
    !anchor.intrinsicPoint.every(Number.isFinite) ||
    !Number.isInteger(anchor.planeMask) ||
    anchor.planeMask <= 0 ||
    (anchor.planeMask & ~((1 << c.dimension) - 1)) !== 0 ||
    anchor.planeIndices.length !== 4 ||
    anchor.cellIndices.length !== 4
  ) {
    return false;
  }
  const planesOk = anchor.planeIndices.every((value, axis) =>
    (anchor.planeMask & (1 << axis)) !== 0
      ? Number.isInteger(value) && value >= 0 && value <= gridSize
      : value === -1,
  );
  if (!planesOk) return false;
  const cellsOk = anchor.cellIndices.every((value, axis) => {
    if (axis >= c.dimension) return value === -1;
    if (!Number.isInteger(value)) return false;
    if ((anchor.planeMask & (1 << axis)) !== 0) {
      const planeIndex = anchor.planeIndices[axis];
      return value === planeIndex - 1 || value === planeIndex;
    }
    return (
      value >= 0 &&
      value < gridSize &&
      anchor.intrinsicPoint[axis] >=
        finiteSolidGridPlane(value, c.half, gridSize) - envelope &&
      anchor.intrinsicPoint[axis] <=
        finiteSolidGridPlane(value + 1, c.half, gridSize) + envelope
    );
  });
  if (!cellsOk) return false;
  return anchor.intrinsicPoint.every((value, axis) => {
    const masked = (anchor.planeMask & (1 << axis)) !== 0;
    if (masked) {
      return (
        Math.abs(
          value -
            finiteSolidGridPlane(anchor.planeIndices[axis], c.half, gridSize),
        ) <= envelope
      );
    }
    return (
      axis >= c.dimension ||
      (value >= -c.half - envelope && value <= c.half + envelope)
    );
  });
}

/**
 * The next exact occupancy transition of the finite cell union along a
 * ray: the qualified fixture's DDA over the construction's own grid.
 * Crossing-time ties are exact numeric equality and all tied axes advance
 * atomically; at a nondifferentiable corner the normal uses the incident
 * ray's projection onto the tied displayed normals' span. There is no
 * distance epsilon — only numerically equal crossing times tie, so a
 * positive interval the arithmetic represents is never merged away.
 */
export function finiteSolidNextBoundary(
  c: FiniteSolidConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  direction: Vec3,
  options: FiniteSolidNextBoundaryOptions,
): FiniteSolidBoundaryResult {
  if (
    !validConstruction(c) ||
    typeof options.inside !== "boolean" ||
    !origin.every(Number.isFinite) ||
    !direction.every(Number.isFinite) ||
    !(Math.hypot(direction[0], direction[1], direction[2]) > 0)
  ) {
    return { kind: "refused", reason: "invalid-input", visits: 0 };
  }
  const tMin = options.tMin ?? 0;
  if (!Number.isFinite(tMin) || tMin < 0) {
    return { kind: "refused", reason: "invalid-input", visits: 0 };
  }
  return finiteSolidNextBoundaryInternal(c, pose, origin, direction, {
    ...options,
    tMin,
  });
}

/**
 * Secondary traversal whose intrinsic anchor is authoritative. The world
 * hit is deliberately absent from this API, so rounded display coordinates
 * cannot silently replace the canonical boundary origin.
 */
export function finiteSolidNextBoundaryFromAnchor(
  c: FiniteSolidConstruction,
  pose: FiniteSolidPose,
  direction: Vec3,
  options: { inside: boolean; anchor: FiniteSolidAnchor },
): FiniteSolidBoundaryResult {
  if (!validConstruction(c) || !validAnchor(c, options.anchor)) {
    return { kind: "refused", reason: "invalid-input", visits: 0 };
  }
  if (
    typeof options.inside !== "boolean" ||
    !direction.every(Number.isFinite) ||
    !(Math.hypot(direction[0], direction[1], direction[2]) > 0)
  ) {
    return { kind: "refused", reason: "invalid-input", visits: 0 };
  }
  return finiteSolidNextBoundaryInternal(c, pose, [0, 0, 0], direction, {
    inside: options.inside,
    tMin: 0,
    anchor: options.anchor,
  });
}

function finiteSolidNextBoundaryInternal(
  c: FiniteSolidConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  direction: Vec3,
  options: FiniteSolidNextBoundaryOptions & { anchor?: FiniteSolidAnchor },
): FiniteSolidBoundaryResult {
  const dimension = c.dimension;
  const half = c.half;
  const gridSize = c.gridSize;
  const tMin = options.tMin ?? 0;
  const anchor = options.anchor;
  const q = anchor
    ? ([...anchor.intrinsicPoint] as Vec4)
    : finiteSolidIntrinsicPoint(pose, origin);
  if (anchor) {
    for (let axis = 0; axis < dimension; axis++) {
      if ((anchor.planeMask & (1 << axis)) !== 0) {
        q[axis] = finiteSolidGridPlane(
          anchor.planeIndices[axis],
          half,
          gridSize,
        );
      } else {
        const cell = anchor.cellIndices[axis];
        const lower = finiteSolidGridPlane(cell, half, gridSize);
        const upper = finiteSolidGridPlane(cell + 1, half, gridSize);
        if (q[axis] < lower) q[axis] = lower;
        else if (q[axis] > upper) q[axis] = upper;
      }
    }
  }
  const qd = finiteSolidIntrinsicDirection(pose, direction);
  const clip = clipRoot(half, dimension, q, qd);
  if (!clip) return { kind: "miss", visits: 0 };
  const start = Math.max(tMin, clip.enter);
  if (clip.exit < start || (!anchor && clip.exit === start)) {
    return { kind: "miss", visits: 0 };
  }
  const width = (2 * half) / gridSize;
  const qStart = q.map((value, axis) => value + start * qd[axis]) as Vec4;
  const raySideIndex = (value: number, d: number): number => {
    const u = (value + half) / width;
    if (u <= 0) return d < 0 ? -1 : 0;
    if (u >= gridSize) return d > 0 ? gridSize : gridSize - 1;
    const lower = Math.floor(u);
    if (u === lower && d < 0) return lower - 1;
    // A ray coincident with a grid plane uses its upper half-open cell —
    // deterministic one-sided ownership, not closed membership.
    return lower;
  };
  const index = Array.from({ length: dimension }, (_, axis) =>
    raySideIndex(qStart[axis], qd[axis]),
  );
  if (anchor) {
    for (let axis = 0; axis < dimension; axis++) {
      index[axis] = anchor.cellIndices[axis];
      if ((anchor.planeMask & (1 << axis)) === 0) continue;
      if (qd[axis] === 0) {
        return { kind: "refused", reason: "ambiguous-anchor", visits: 0 };
      }
      index[axis] =
        qd[axis] > 0
          ? anchor.planeIndices[axis]
          : anchor.planeIndices[axis] - 1;
    }
  }
  if (
    !anchor &&
    options.previousFace?.level === c.level &&
    qd[options.previousFace.axis] !== 0
  ) {
    const axis = options.previousFace.axis;
    const plane = finiteSolidGridPlane(
      options.previousFace.planeIndex,
      half,
      gridSize,
    );
    const faceT = (plane - q[axis]) / qd[axis];
    // Face identity affects the side only when its analytic crossing is
    // exactly tMin: this repairs reconstruction of a non-binary grid point
    // without suppressing any nearby positive interval.
    if (faceT === tMin) {
      index[axis] =
        qd[axis] > 0
          ? options.previousFace.planeIndex
          : options.previousFace.planeIndex - 1;
    }
  }
  let visits = 0;
  let sideInside = finiteSolidCellOccupied(c, index);
  if (index.every((value) => value >= 0 && value < gridSize)) visits++;
  const mediumInside = options.inside;

  if (sideInside !== mediumInside) {
    if (anchor) {
      return { kind: "refused", reason: "state-mismatch", visits };
    }
    let axes: number[];
    if (start === clip.enter) {
      axes = clip.enterAxes;
    } else {
      axes = [];
      for (let axis = 0; axis < dimension; axis++) {
        const u = (qStart[axis] + half) / width;
        if (u === Math.round(u) && qd[axis] !== 0) axes.push(axis);
      }
    }
    if (axes.length === 0) {
      return { kind: "refused", reason: "state-mismatch", visits };
    }
    const axis = chooseAxis(axes, qd);
    const planeIndices = new Array<number>(dimension).fill(-1);
    for (const crossedAxis of axes) {
      planeIndices[crossedAxis] = Math.round(
        (qStart[crossedAxis] + half) / width,
      );
    }
    const event = boundaryFor(
      c,
      pose,
      q,
      direction,
      start,
      sideInside,
      axis,
      axes,
      planeIndices,
      index,
      qd,
      visits,
    );
    if (event.kind === "refused") return event;
    if (start === tMin && sameFace(options.previousFace, event.face)) {
      return { kind: "refused", reason: "state-mismatch", visits };
    }
    return event;
  }

  for (;;) {
    let nextT = Infinity;
    const crossingT = new Array<number>(dimension).fill(Infinity);
    for (let axis = 0; axis < dimension; axis++) {
      if (qd[axis] === 0) continue;
      const planeIndex = qd[axis] > 0 ? index[axis] + 1 : index[axis];
      const plane = finiteSolidGridPlane(planeIndex, half, gridSize);
      crossingT[axis] = (plane - q[axis]) / qd[axis];
      nextT = Math.min(nextT, crossingT[axis]);
    }
    if (!Number.isFinite(nextT)) return { kind: "miss", visits };
    if (nextT < start) {
      return { kind: "refused", reason: "nonmonotone-crossing", visits };
    }
    const axes = crossingT
      .map((value, axis) => ({ value, axis }))
      .filter(({ value }) => value === nextT)
      .map(({ axis }) => axis);
    const oldIndex = [...index];
    for (const axis of axes) index[axis] += qd[axis] > 0 ? 1 : -1;
    const inRoot = index.every((value) => value >= 0 && value < gridSize);
    if (inRoot) {
      if (visits >= finiteSolidMaxVisits(dimension, c.level)) {
        return { kind: "refused", reason: "visit-cap", visits };
      }
      visits++;
    }
    const nextInside = inRoot && finiteSolidCellOccupied(c, index);
    if (nextInside !== sideInside) {
      const axis = chooseAxis(axes, qd);
      const planeIndices = new Array<number>(dimension).fill(-1);
      for (const crossedAxis of axes) {
        planeIndices[crossedAxis] =
          qd[crossedAxis] > 0
            ? oldIndex[crossedAxis] + 1
            : oldIndex[crossedAxis];
      }
      const event = boundaryFor(
        c,
        pose,
        q,
        direction,
        nextT,
        nextInside,
        axis,
        axes,
        planeIndices,
        index,
        qd,
        visits,
      );
      if (event.kind === "refused") return event;
      if (sideInside !== mediumInside) {
        return { kind: "refused", reason: "state-mismatch", visits };
      }
      if (nextT === tMin && sameFace(options.previousFace, event.face)) {
        return { kind: "refused", reason: "state-mismatch", visits };
      }
      return event;
    }
    sideInside = nextInside;
    if (!inRoot) return { kind: "miss", visits };
  }
}

// ---------------------------------------------------------------------------
// The signed field and the exact interval union (the proxy's arithmetic).
// ---------------------------------------------------------------------------

/** The occupied cells as boxes (finite and small at the certified levels:
 * 400 in 3D / 2,304 in 4D at level 2). */
export function finiteSolidCells(
  c: FiniteSolidConstruction,
): Array<{ center: number[]; half: number }> {
  const g = c.gridSize;
  const width = (2 * c.half) / g;
  const cells: Array<{ center: number[]; half: number }> = [];
  const index = new Array<number>(c.dimension).fill(0);
  const visit = (axis: number, linear: number): void => {
    if (axis === c.dimension) {
      if ((c.occupancy[linear >>> 5] & (1 << (linear & 31))) === 0) return;
      const center = new Array<number>(c.dimension).fill(0);
      for (let a = 0; a < c.dimension; a++) {
        center[a] = -c.half + (index[a] + 0.5) * width;
      }
      cells.push({ center, half: width / 2 });
      return;
    }
    for (let i = 0; i < g; i++) {
      index[axis] = i;
      visit(axis + 1, linear * g + i);
    }
  };
  visit(0, 0);
  return cells;
}

/** One box's exact SDF: positive outside, negative inside, zero on the
 * boundary; inside it is the deepest gap's negation (a lower bound on the
 * complement distance — the certified inside stride). */
function boxSdf(
  center: readonly number[],
  half: number,
  p: readonly number[],
  dimension: number,
): number {
  let outsideSquared = 0;
  let inside = -Infinity;
  for (let axis = 0; axis < dimension; axis++) {
    const gap = Math.abs(p[axis] - center[axis]) - half;
    outsideSquared += Math.max(0, gap) ** 2;
    inside = Math.max(inside, gap);
  }
  return Math.sqrt(outsideSquared) + Math.min(0, inside);
}

/**
 * The signed transport field: min over occupied cells of the box SDF, the
 * outside side scaled by the shared march-safety budget
 * (`SHAPE_MARCH_SAFETY` — the step both sides may take without crossing
 * the boundary unsampled). In the OPEN interior of each cell the value is
 * the local box's interior depth (negative, exact); OUTSIDE the union it
 * is a certified conservative bound. Exactly ON an interior shared plane
 * the min reads 0 — both boxes' own surfaces meet there — which is the
 * known min-box limitation that makes the field UNSUITABLE as a marched
 * medium oracle and is why the transport's boundary query is the DDA
 * above, never a field march (the abutting-seam measurement). Primary
 * finite rays now use that exact query too; this field remains available
 * for shading and independent outside-march controls.
 */
export function finiteSolidField(
  c: FiniteSolidConstruction,
  pose: FiniteSolidPose,
  p: Vec3,
): number {
  const q = finiteSolidIntrinsicPoint(pose, p);
  const cells = finiteSolidCells(c);
  let best = Infinity;
  for (const cell of cells) {
    const d = boxSdf(cell.center, cell.half, q, c.dimension);
    if (d < best) best = d;
  }
  if (best === Infinity) return 1e30;
  return best > 0 ? best * SHAPE_MARCH_SAFETY : best;
}

/**
 * The distance-to-union estimate for marching displays — the signed field
 * (outside it is the certified conservative bound; inside the OPEN cell
 * interior it is the deepest containing box's depth; the zero is exact on
 * the union's boundary, and — disclosed above — also on interior shared
 * planes, which an outside march stops before traversing).
 */
export function finiteSolidDistance(
  c: FiniteSolidConstruction,
  pose: FiniteSolidPose,
  p: Vec3,
): number {
  return finiteSolidField(c, pose, p);
}

/**
 * How close (as a fraction of the half extent) to a level-1 box's boundary
 * the display marcher's hierarchical estimate descends into that box's
 * children. Any value above the march's acceptance scale certifies the
 * same zero set; this one keeps the typical call at one refinement
 * (~2·3^dim box evaluations) and the worst corner case bounded.
 */
export const FINITE_SOLID_DISPLAY_REFINE_REL = 1 / 6;

/**
 * The display marcher's bounded-work estimate: the certified hybrid of the
 * level-1 boxes and their occupied children.
 *
 * The flat field above is conservative outside the union, but at level 2 it costs
 * one box evaluation per occupied finest cell (400 in 3D, 2,304 in 4D) per
 * query — a full-frame display march cannot pay that. The naive cheap
 * replacement, the plain min over the level-1 boxes, is UNSOUND in a
 * specific, load-bearing way: a level-1 box's own faces are its zero set,
 * and the axis tunnels of the construction PIERCE those faces at their
 * centre patches (a face's centre child is empty on both sides of every
 * wall — the rule's symmetry), so the plain min reads 0 at the tunnel
 * mouths and the display march would SEAL every tunnel at its mouth plane.
 * The same seal would patch the void network's wall openings one level
 * in.
 *
 * The hybrid fixes exactly that while keeping a certified lower bound:
 *
 *   DE(q) = min over occupied level-1 boxes i of
 *             dist(q, box_i) < tau ? min over box_i's occupied children
 *                                  : dist(q, box_i)
 *
 * with `tau = FINITE_SOLID_DISPLAY_REFINE_REL · half`. Both terms are
 * lower bounds of the distance to the union: a box CONTAINS its part of
 * the union's surface (a point of the union inside the box is reached
 * through the box's boundary, so dist(q, box) ≤ dist(q, union-point)),
 * and the children ARE the union's part in the box. The global nearest
 * union point lives in some box i*, whose term is therefore ≤ the true
 * distance — the min cannot overstate, so a march step can never skip the
 * surface. Boundary zeros are preserved: an unrefined term is 0 only ON
 * a box face, but d < tau refines, and the refined term vanishes on the
 * children's faces (the tunnel mouths read positive: their rim recedes).
 * Interior shared child faces also read 0; the zero set therefore is NOT
 * only the union's boundary, and this field is not a membership oracle.
 * Inside one child the value is that child's interior
 * depth, the same convention as the flat field.
 *
 * Level 1 has no children and returns the plain min (the boxes ARE the
 * union); level 0 the root box. Pinned by `finite-solid.test.ts` against
 * the flat field on the boundary and — the load-bearing leg — against
 * `finiteSolidIntervals` on tunnel-axis rays, which the sealed estimator
 * would fail.
 */
export function finiteSolidDisplayDistance(
  c: FiniteSolidConstruction,
  pose: FiniteSolidPose,
  p: Vec3,
): number {
  const q = finiteSolidIntrinsicPoint(pose, p);
  const dimension = c.dimension;
  const half = c.half;
  if (c.level === 0) {
    const d = boxSdf(new Array<number>(dimension).fill(0), half, q, dimension);
    return d > 0 ? d * SHAPE_MARCH_SAFETY : d;
  }
  const width1 = (2 * half) / 3;
  const half1 = width1 / 2;
  const tau = half * FINITE_SOLID_DISPLAY_REFINE_REL;
  const width2 = (2 * half) / 9;
  const half2 = width2 / 2;
  const index1 = new Array<number>(dimension).fill(0);
  const offset = new Array<number>(dimension).fill(0);
  let result = Infinity;
  // One pass over the 3^dimension level-1 grid; occupied cells evaluate
  // their own box, and — within tau of it — their occupied children.
  const visit = (axis: number): void => {
    if (axis === dimension) {
      let middles = 0;
      for (let a = 0; a < dimension; a++) {
        if (index1[a] === 1) middles++;
      }
      if (middles > 1) return;
      const center1 = new Array<number>(dimension);
      for (let a = 0; a < dimension; a++) {
        center1[a] = (index1[a] - 1) * width1;
      }
      const d1 = boxSdf(center1, half1, q, dimension);
      let term = d1;
      if (c.level > 1 && d1 < tau) {
        let best2 = Infinity;
        const child = (childAxis: number): void => {
          if (childAxis === dimension) {
            let childMiddles = 0;
            for (let a = 0; a < dimension; a++) {
              if (offset[a] === 1) childMiddles++;
            }
            if (childMiddles > 1) return;
            const center2 = new Array<number>(dimension);
            for (let a = 0; a < dimension; a++) {
              center2[a] = (3 * index1[a] + offset[a] - 4) * width2;
            }
            const d2 = boxSdf(center2, half2, q, dimension);
            if (d2 < best2) best2 = d2;
            return;
          }
          for (let i = 0; i < 3; i++) {
            offset[childAxis] = i;
            child(childAxis + 1);
          }
        };
        child(0);
        term = best2;
      }
      if (term < result) result = term;
      return;
    }
    for (let i = 0; i < 3; i++) {
      index1[axis] = i;
      visit(axis + 1);
    }
  };
  visit(0);
  return result > 0 ? result * SHAPE_MARCH_SAFETY : result;
}

/**
 * Ray ⟂ solid = the UNION of per-cell slab intervals, exact, with
 * deliberately NO optical epsilon: a positive gap, however thin, remains a
 * real gap (`scripts/transmission-proxy.ts`'s `boxUnionIntervals`, the
 * arithmetic the owner-selected appearance came from). The per-cell
 * extents derive from the CANONICAL grid planes (`finiteSolidGridPlane`),
 * not from center±half, so two cells sharing a face produce the same f64
 * endpoint on both sides and touching intervals merge exactly — the
 * union of a solid traversal is one interval, while a genuine empty cell
 * between two occupied ones stays a genuine gap.
 */
export function finiteSolidIntervals(
  c: FiniteSolidConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  dir: Vec3,
): Array<{ enter: number; exit: number }> {
  const q = finiteSolidIntrinsicPoint(pose, origin);
  const qd = finiteSolidIntrinsicDirection(pose, dir);
  const g = c.gridSize;
  const index = new Array<number>(c.dimension).fill(0);
  const intervals: Array<{ enter: number; exit: number }> = [];
  const visit = (axis: number, linear: number): void => {
    if (axis === c.dimension) {
      if ((c.occupancy[linear >>> 5] & (1 << (linear & 31))) === 0) return;
      let enter = 0;
      let exit = Infinity;
      for (let a = 0; a < c.dimension; a++) {
        const lo = finiteSolidGridPlane(index[a], c.half, g);
        const hi = finiteSolidGridPlane(index[a] + 1, c.half, g);
        const d = qd[a];
        if (d === 0) {
          if (q[a] < lo || q[a] > hi) {
            exit = -1;
            break;
          }
          continue;
        }
        const ta = (lo - q[a]) / d;
        const tb = (hi - q[a]) / d;
        enter = Math.max(enter, Math.min(ta, tb));
        exit = Math.min(exit, Math.max(ta, tb));
      }
      if (exit > enter) intervals.push({ enter, exit });
      return;
    }
    for (let i = 0; i < g; i++) {
      index[axis] = i;
      visit(axis + 1, linear * g + i);
    }
  };
  visit(0, 0);
  intervals.sort((a, b) => a.enter - b.enter || a.exit - b.exit);
  const union: Array<{ enter: number; exit: number }> = [];
  for (const interval of intervals) {
    const last = union[union.length - 1];
    if (last && interval.enter <= last.exit) {
      last.exit = Math.max(last.exit, interval.exit);
    } else {
      union.push({ ...interval });
    }
  }
  return union;
}

// ---------------------------------------------------------------------------
// The general construction: the document's OWN maps as the cell tree.
//
// The shipped construction above is the special case where the document's
// maps ARE a shared ternary grid's structure — diag(1/3) at {0, ±0.5}
// offsets — so every face has a canonical grid-plane value and every
// neighbor a discrete grid index. A general document's maps are arbitrary
// contracting affines — and an affine maps tetrahedra to tetrahedra
// exactly — so the construction is the SIMPLICIAL word tree: the level-N
// images of the root SIMPLEX under the document's maps, every word
// occupied. The holes are the complement BETWEEN cells, not a carved
// rule. The box construction's diagonal-only refusal is retired here:
// rotations, shears (rotation × non-uniform scale composes one), per-axis
// non-uniform scale and post-affines all stay inside the same bare-affine
// family the tree closes under.
//
// ROOT: the maps' fixed points' convex hull when that hull is one simplex
// AND INVARIANT (the tight root — the Sierpinski tetrahedron gets the
// gasket's own hull; invariance implies containment of the attractor), else
// a canonical derived bounding simplex: a regular simplex around the
// INVARIANT AXIS BOX — the bbox fixed point of the Hutchinson iteration
// `B ← bbox({fixed} ∪ {M_i(corner)})`, the attractor's own bounding box —
// oriented by a fixed closed-form frame (`canonicalSimplexDirections`, no
// basis choice), sized so its inscribed ball contains the box exactly.
// `rootKind` discloses which. The invariance REQUIREMENT applies to the
// hull candidate ONLY: rotating maps admit NO invariant simplex (measured —
// the default system's hull escapes by 0.50, a 4000-restart search found no
// invariant tetrahedron, and the escape is scale-free), so the derived root
// is never invariance-filtered and no document refuses for hull escape.
//
// Admission: contraction by the LARGEST SINGULAR VALUE < 1 (Jacobi's
// values exist for every matrix — no diagonal restriction), non-degenerate
// (sigma_min above the collapse floor), and the structural refusals
// unchanged (variations, emitters, chaos rows, kaleidoscope above order 1,
// warping finals). A document whose fixed points do not span the
// construction's dimension refuses: the attractor is flat there and has no
// solid to glass.
//
// The walk: ray-simplex as the facet half-space slabs (4 facets in 3D, 5
// in 4D), the tie discipline re-qualified for general planes through
// different word compositions (the declared resolution merges a shared
// face's two sides), and the anchor contract with the face vocabulary
// becoming FACET INDICES within the cell: the anchor's mask names the
// incident leaf's crossed facets (5 bits in 4D — the facet identity rides
// the mask, so the 4 `planeIndices` slots need no extension and stay
// unused, −1), its word names the post-incident cell, and the snap targets
// are the leaf's COMPOSED facet planes — the clip's own values, never a
// reconstruction (the corner-class discipline, one tree up). The
// production query is a PRUNED DFS whose node test is the ray against the
// child's WORD-IMAGE of its LEVEL BOX (`levelBoxes[k] ⊇ U_k`, computed one
// Hutchinson step per level from the root's bbox) — the subtree sits
// inside that box by construction, so the pruned enumeration equals the
// unpruned one endpoint for endpoint WITHOUT root invariance. The node
// clip transforms the ray by the composed word's inverse and clips the
// axis-aligned box (the parameter survives the reparametrization); the
// leaf clips are the simplex facet slabs. Capped per ray; the interval
// union below stays the UNCAPPED reference enumeration the harness pins
// against.
//
// The display hybrid rides the branch boxes for the same soundness reason:
// the min over the level-1 branch boxes' oriented-box SDFs (the max of the
// six facet half-space distances — a certified lower bound outside, the
// exact interior depth inside), the nearest refined into its children's
// boxes within tau of the box's own surface — the seal argument carries
// one box up. Every union point sits inside its branch's word-image of
// `levelBoxes[N−1]`, so no term can overstate; the zeros sit on box faces
// (not the union's surface), which the transport's exact walk corrects —
// disclosed as coarser AO/shadow taps, never wrong pixels.
// ---------------------------------------------------------------------------

/** The word-tree construction's certified depth band: the anchor word's
 * four `cellIndices` slots carry one map index per level, so level 4
 * rides the wire exactly; level 5 would need a packed word. */
export const FINITE_SOLID_GENERAL_MAX_LEVEL = 4;

/** The general construction's map cap — the shipped 4D construction's
 * own map count, so the general path admits at least everything the
 * shipped one does. */
export const FINITE_SOLID_GENERAL_MAX_MAPS = 48;

/** Adjacency's declared resolution: interval endpoints within this
 * relative distance are ONE boundary (the anchor reconstruction's
 * coordinate envelope, promoted from a restart allowance to the
 * construction's declared resolution). A genuine gap below it is
 * unrepresentable on the f32 wire the transport rides. */
export const FINITE_SOLID_GENERAL_TIE_REL = 2 * 2 ** -23;

/** The pruned walk's leaf cap: a ray that clips more leaves than this
 * refuses visit-cap rather than truncating. The interval union below is
 * the UNCAPPED reference; the cap is a disclosed per-ray refusal sized
 * from measurement (`scripts/finite-solid.harness.ts`'s sweeps), and the
 * production walk bakes the smaller of this and the construction's own
 * worst case. */
export const FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES = 128;

/** The anchor snap's declared envelope, relative to the SCALE of the
 * arithmetic that produced the point, not to the cell: a boundary point is
 * `q + t·qd` and its facet residual `c − n·p` rounds at the magnitude of
 * `q`, `t` and `p` — at f32 about 16 ulps of that magnitude (the dot
 * products' accumulation, the division's error projected back onto the
 * facet normal) — while a level-4 cell can be a hundredth of it. The box
 * construction's cell-relative envelope refused the first hit of rays
 * from a camera a few radii out (a measured 5-50% of sampled rays, every
 * one a masked-facet correction 1.6-15x past it). The envelope is
 * `FINITE_SOLID_GENERAL_SNAP_REL · max(1, cell radius, scale)` with scale
 * `max(|q|∞, |t|)` for an event and `|anchor|∞` for an anchored restart —
 * the same `max(1, ·)` floor the tie takes. It still refuses a claimed
 * anchor that is not ON its word's leaf; it no longer refuses rounding. */
export const FINITE_SOLID_GENERAL_SNAP_REL = 32 * 2 ** -23;

/** The exact-corner normal's rank test: a tied facet's displayed normal is
 * DEPENDENT on the basis already accepted when its Gram-Schmidt residual
 * falls below this fraction of its own length. The box construction never
 * needed one — its faces were the pose's exact rows, so a repeated axis
 * projected to exactly zero — but a general shared face is ONE real plane
 * computed through two word compositions, so its two sides' normals agree
 * only to ulps and an exact `> 0` test would promote the rounding residue
 * to a basis vector of arbitrary direction. Distinct facets of a real cell
 * sit far above this; ulp-level twins (f64 ~1e-16, f32 ~1e-7) far below. */
export const FINITE_SOLID_GENERAL_NORMAL_DEPENDENT_REL = 1e-3;

/** The general word tree's MEDIA (per-map materials inside the glass
 * solid). A leaf's material is its BRANCH's — the word's first map, the
 * top-level subtree it belongs to (level 0's lone root cell is branch 0).
 * `media[a]` is branch a's code: `FINITE_SOLID_MEDIUM_OPAQUE_MAP` (0) for
 * an opaque map, else a GLASS code >= 1, equal codes meaning one material
 * (so a crossing between two such subtrees is silent — equal IORs pass
 * through). Absent media is every map glass code 1: the single-material
 * solid, event for event. THE OWNER RULE partitions overlapping cells:
 * any covering OPAQUE branch owns the point (opaque dominates — glass
 * inside a wall is invisible anyway), else the LOWEST-INDEX covering glass
 * branch does, else air. A deterministic partition is what makes every
 * medium change a well-defined event. */
export type FiniteSolidGeneralMedia = readonly number[];
/** The per-map media code of an opaque map. */
export const FINITE_SOLID_MEDIUM_OPAQUE_MAP = 0;
/** The medium code of air (no covering leaf). */
export const FINITE_SOLID_MEDIUM_AIR = 0;
/** The medium code of an opaque region — past every glass code (at most
 * FINITE_SOLID_GENERAL_MAX_MAPS) and u32-safe on the kernel wire. */
export const FINITE_SOLID_MEDIUM_OPAQUE = 65535;

/** The medium owning a point from its per-branch coverage counts (the
 * owner rule above). */
function generalMediumOf(
  coverage: readonly number[],
  media: FiniteSolidGeneralMedia | undefined,
): { medium: number; branch: number } {
  let glassBranch = -1;
  for (let a = 0; a < coverage.length; a++) {
    if (!(coverage[a] > 0)) continue;
    const code = media ? media[a] : 1;
    if (code === FINITE_SOLID_MEDIUM_OPAQUE_MAP) {
      return { medium: FINITE_SOLID_MEDIUM_OPAQUE, branch: a };
    }
    if (glassBranch < 0) glassBranch = a;
  }
  if (glassBranch < 0) return { medium: FINITE_SOLID_MEDIUM_AIR, branch: -1 };
  return { medium: media ? media[glassBranch] : 1, branch: glassBranch };
}

/** A media table must name every map with an integer code: 0 opaque or a
 * glass code in 1..FINITE_SOLID_GENERAL_MAX_MAPS. */
function validGeneralMedia(
  c: FiniteSolidGeneralConstruction,
  media: FiniteSolidGeneralMedia | undefined,
): boolean {
  return (
    media === undefined ||
    (media.length === c.mapCount &&
      media.every(
        (code) =>
          Number.isInteger(code) &&
          code >= 0 &&
          code <= FINITE_SOLID_GENERAL_MAX_MAPS,
      ))
  );
}

/** The general construction: cells are the level-`level` images of the
 * root simplex under the document's own maps. Each map is a general
 * contracting affine baked row-major 4x4 (the 3D maps carry the w row and
 * column identity, so composed words keep w fixed); the root simplex's
 * `dimension + 1` vertices close the tree. */
export interface FiniteSolidGeneralConstruction {
  dimension: 3 | 4;
  level: number;
  /** Row-major 4x4 per map; 3D maps carry the w row/column identity. */
  mapMatrix: number[][];
  mapOffset: Vec4[];
  mapCount: number;
  /** The root simplex's vertices: `dimension + 1` entries, w = 0 in 3D. */
  rootVertices: Vec4[];
  /** Which root the admission derived — the fixed points' own hull
   * ("hull") or the canonical derived bounding simplex ("derived"). */
  rootKind: "hull" | "derived";
  /** The walk's level bounding boxes, one per remaining depth k = 0..level:
   * `levelBoxes[k] ⊇ U_k`, the level-k union `∪_{|w| = k} w(root)` — so a
   * node's whole subtree nests inside its word-image of the box, which is
   * what makes the pruned DFS SOUND for every contracting family (rotating
   * maps admit NO invariant simplex — measured — so the pruning cannot
   * ride the cells themselves). */
  levelBoxes: Array<{ min: Vec4; max: Vec4 }>;
}

export interface FiniteSolidGeneralAnalysis {
  status: "eligible" | "ineligible";
  reasons: string[];
  construction?: FiniteSolidGeneralConstruction;
}

/** One composed map: row-major 4x4 (w identity in 3D) + offset. */
interface GeneralMap {
  matrix: number[];
  offset: Vec4;
}

/** Deterministic Gaussian elimination with partial pivoting (ties to the
 * lowest row index), scale-relative pivots: solve the n×n system
 * `A·x = b` in f64. Returns null when no acceptable pivot remains — the
 * caller refuses rather than dividing by noise. */
function solveLinear(
  a: readonly number[],
  b: readonly number[],
  n: number,
): number[] | null {
  const m = a.slice();
  const rhs = b.slice();
  const rowScale: number[] = [];
  for (let i = 0; i < n; i++) {
    let scale = 0;
    for (let j = 0; j < n; j++) scale = Math.max(scale, Math.abs(m[i * n + j]));
    if (!(scale > 0)) return null;
    rowScale.push(scale);
  }
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = -1;
    for (let row = col; row < n; row++) {
      const magnitude = Math.abs(m[row * n + col]) / rowScale[row];
      if (magnitude > best) {
        best = magnitude;
        pivot = row;
      }
    }
    if (!(best > 1e-13)) return null;
    if (pivot !== col) {
      for (let j = 0; j < n; j++) {
        const tmp = m[col * n + j];
        m[col * n + j] = m[pivot * n + j];
        m[pivot * n + j] = tmp;
      }
      const tmpRhs = rhs[col];
      rhs[col] = rhs[pivot];
      rhs[pivot] = tmpRhs;
    }
    for (let row = col + 1; row < n; row++) {
      const factor = m[row * n + col] / m[col * n + col];
      if (factor === 0) continue;
      for (let j = col; j < n; j++) m[row * n + j] -= factor * m[col * n + j];
      rhs[row] -= factor * rhs[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = rhs[row];
    for (let j = row + 1; j < n; j++) sum -= m[row * n + j] * x[j];
    x[row] = sum / m[row * n + row];
    if (!Number.isFinite(x[row])) return null;
  }
  return x;
}

function identityMatrix4(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Embed a row-major 3x3 into the 4x4 w-identity form. */
function embed3Matrix(m: readonly number[]): number[] {
  return [
    m[0],
    m[1],
    m[2],
    0,
    m[3],
    m[4],
    m[5],
    0,
    m[6],
    m[7],
    m[8],
    0,
    0,
    0,
    0,
    1,
  ];
}

/** Apply a row-major 4x4 to a Vec4. */
function applyMatrix4(m: readonly number[], v: Vec4): Vec4 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3] * v[3],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7] * v[3],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11] * v[3],
    m[12] * v[0] + m[13] * v[1] + m[14] * v[2] + m[15] * v[3],
  ];
}

/** Compose two row-major 4x4s: `a` applied after `b`. */
function multiplyMatrix4(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4 + 0] * b[c] +
        a[r * 4 + 1] * b[4 + c] +
        a[r * 4 + 2] * b[8 + c] +
        a[r * 4 + 3] * b[12 + c];
    }
  }
  return out;
}

/** Compose a word's affine: `map` applied after the accumulated prefix
 * (`(prefix ∘ map)(x) = prefix(map(x))`). */
function composeWordStep(
  matrix: readonly number[],
  offset: Vec4,
  map: GeneralMap,
): { matrix: number[]; offset: Vec4 } {
  const nextOffset: Vec4 = [
    matrix[0] * map.offset[0] +
      matrix[1] * map.offset[1] +
      matrix[2] * map.offset[2] +
      matrix[3] * map.offset[3] +
      offset[0],
    matrix[4] * map.offset[0] +
      matrix[5] * map.offset[1] +
      matrix[6] * map.offset[2] +
      matrix[7] * map.offset[3] +
      offset[1],
    matrix[8] * map.offset[0] +
      matrix[9] * map.offset[1] +
      matrix[10] * map.offset[2] +
      matrix[11] * map.offset[3] +
      offset[2],
    matrix[12] * map.offset[0] +
      matrix[13] * map.offset[1] +
      matrix[14] * map.offset[2] +
      matrix[15] * map.offset[3] +
      offset[3],
  ];
  return {
    matrix: multiplyMatrix4(matrix, map.matrix),
    offset: nextOffset,
  };
}

function dotIntrinsic(a: Vec4, b: Vec4, dimension: 3 | 4): number {
  return (
    a[0] * b[0] +
    a[1] * b[1] +
    a[2] * b[2] +
    (dimension === 4 ? a[3] * b[3] : 0)
  );
}

/** The generalized cross of three R⁴ vectors — the Hodge dual of their
 * wedge, `n_j = (−1)^(j+1)·det(minor_j)`, orthogonal to all three with
 * the right-hand magnitude (e1,e2,e3 -> e4). */
function cross4(a: Vec4, b: Vec4, c: Vec4): Vec4 {
  const minor = (skip: number): number => {
    const rows: number[] = [];
    for (let i = 0; i < 4; i++) {
      if (i === skip) continue;
      rows.push(a[i], b[i], c[i]);
    }
    return (
      rows[0] * (rows[4] * rows[8] - rows[5] * rows[7]) -
      rows[1] * (rows[3] * rows[8] - rows[5] * rows[6]) +
      rows[2] * (rows[3] * rows[7] - rows[4] * rows[6])
    );
  };
  return [-minor(0), minor(1), -minor(2), minor(3)];
}

/** One facet's plane: the unit outward normal `n` and offset `c`, the
 * plane `n·x = c` with `s = n·x − c` negative inside. */
interface GeneralFacet {
  n: Vec4;
  c: number;
}

/** The simplex's facets from its own vertices: facet k opposite vertex k,
 * its vertices in ascending index order, the normal the edge fan's
 * (generalized) cross oriented OUTWARD — away from the opposite vertex —
 * and normalized. Two leaves sharing a face compute the same real plane
 * through different word compositions; the crossing times agree to ulps
 * and the declared tie merges them. Returns null for a degenerate leaf (a
 * zero cross): the admission's sigma_min floor makes that vanishingly
 * rare, and the walk skips the leaf rather than divide by noise. */
function facetsFromVertices(
  vertices: readonly Vec4[],
  dimension: 3 | 4,
): GeneralFacet[] | null {
  const count = dimension + 1;
  const facets: GeneralFacet[] = [];
  for (let k = 0; k < count; k++) {
    const faceIdx: number[] = [];
    for (let i = 0; i < count; i++) {
      if (i !== k) faceIdx.push(i);
    }
    const a = vertices[faceIdx[0]];
    const sub = (i: number): Vec4 => [
      vertices[faceIdx[i]][0] - a[0],
      vertices[faceIdx[i]][1] - a[1],
      vertices[faceIdx[i]][2] - a[2],
      vertices[faceIdx[i]][3] - a[3],
    ];
    const e1 = sub(1);
    const e2 = sub(2);
    let n: Vec4;
    if (dimension === 3) {
      n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
        0,
      ];
    } else {
      n = cross4(e1, e2, sub(3));
    }
    const magnitude = Math.hypot(n[0], n[1], n[2], dimension === 4 ? n[3] : 0);
    if (!(magnitude > 0) || !Number.isFinite(magnitude)) return null;
    n = [
      n[0] / magnitude,
      n[1] / magnitude,
      n[2] / magnitude,
      dimension === 4 ? n[3] / magnitude : 0,
    ];
    // Orient outward: away from the opposite vertex. A side of exactly
    // zero means the opposite vertex lies ON the facet plane — the simplex
    // is degenerate and this facet has no outward side.
    const opp = vertices[k];
    const side =
      (opp[0] - a[0]) * n[0] +
      (opp[1] - a[1]) * n[1] +
      (opp[2] - a[2]) * n[2] +
      (dimension === 4 ? (opp[3] - a[3]) * n[3] : 0);
    if (!(side < 0)) {
      if (side > 0) {
        n = [-n[0], -n[1], -n[2], dimension === 4 ? -n[3] : 0];
      } else {
        return null;
      }
    }
    const c =
      n[0] * a[0] +
      n[1] * a[1] +
      n[2] * a[2] +
      (dimension === 4 ? n[3] * a[3] : 0);
    facets.push({ n, c });
  }
  return facets;
}

/** The leaf's vertices: the word's maps applied to the root, composed in
 * the SAME op sequence the walk's DFS accumulates (prefix order, one
 * `composeWordStep` per depth, left-associated) — the anchor's snap
 * targets are these facet planes, and the corner-class discipline
 * requires them to be the clip's own values bit for bit. */
function generalLeafVertices(
  c: FiniteSolidGeneralConstruction,
  word: readonly number[],
): Vec4[] {
  let matrix = identityMatrix4();
  let offset: Vec4 = [0, 0, 0, 0];
  for (let depth = 0; depth < word.length; depth++) {
    const step = composeWordStep(matrix, offset, {
      matrix: c.mapMatrix[word[depth]],
      offset: c.mapOffset[word[depth]],
    });
    matrix = step.matrix;
    offset = step.offset;
  }
  return c.rootVertices.map((v) => {
    const image = applyMatrix4(matrix, v);
    return [
      image[0] + offset[0],
      image[1] + offset[1],
      image[2] + offset[2],
      image[3] + offset[3],
    ] as Vec4;
  });
}

/** The cell's radius: the farthest vertex's distance from the centroid —
 * the per-cell scale the anchor envelope and the display refine margin
 * read (the box construction's halfMax role). */
function generalCellRadius(
  vertices: readonly Vec4[],
  dimension: 3 | 4,
): number {
  const centroid: Vec4 = [0, 0, 0, 0];
  for (const v of vertices) {
    for (let axis = 0; axis < 4; axis++) centroid[axis] += v[axis];
  }
  const count = dimension + 1;
  for (let axis = 0; axis < 4; axis++) centroid[axis] /= count;
  let radius = 0;
  for (const v of vertices) {
    const dx = v[0] - centroid[0];
    const dy = v[1] - centroid[1];
    const dz = v[2] - centroid[2];
    const dw = dimension === 4 ? v[3] - centroid[3] : 0;
    radius = Math.max(radius, Math.hypot(dx, dy, dz, dimension === 4 ? dw : 0));
  }
  return radius;
}

/** The ∞-norm of an intrinsic point over the construction's axes — the
 * snap envelope's scale. */
function intrinsicMagnitude(p: Vec4, dimension: 3 | 4): number {
  let magnitude = 0;
  for (let axis = 0; axis < dimension; axis++) {
    magnitude = Math.max(magnitude, Math.abs(p[axis]));
  }
  return magnitude;
}

/** The invariant axis-aligned box: the bbox fixed point of the Hutchinson
 * iteration `B ← bbox({fixed} ∪ {M_i(corner) ∀ i})`. The limit is the
 * attractor's own bounding box — the minimal axis-aligned box invariant
 * under every map, so it contains the attractor and every level union the
 * tree builds. Canonical (no basis choice), derivable, cheap: the measured
 * default-system document stabilizes at round 76 (growth tolerance 1e-12,
 * cap 256 rounds). */
function invariantAxisBox(
  maps: readonly GeneralMap[],
  fixed: readonly Vec4[],
  dimension: 3 | 4,
): { min: Vec4; max: Vec4 } {
  const boundsFrom = (points: readonly Vec4[]): { min: Vec4; max: Vec4 } => {
    const min: Vec4 = [Infinity, Infinity, Infinity, Infinity];
    const max: Vec4 = [-Infinity, -Infinity, -Infinity, -Infinity];
    for (const p of points) {
      for (let axis = 0; axis < dimension; axis++) {
        min[axis] = Math.min(min[axis], p[axis]);
        max[axis] = Math.max(max[axis], p[axis]);
      }
    }
    return { min, max };
  };
  let box = boundsFrom(fixed);
  for (let round = 0; round < 256; round++) {
    const corners = axisBoxCorners(box, dimension);
    const points: Vec4[] = [...fixed];
    for (const corner of corners) {
      for (const map of maps) {
        const image = applyMatrix4(map.matrix, corner);
        for (let axis = 0; axis < 4; axis++) image[axis] += map.offset[axis];
        points.push(image);
      }
    }
    const next = boundsFrom(points);
    let growth = 0;
    for (let axis = 0; axis < dimension; axis++) {
      growth = Math.max(
        growth,
        Math.abs(next.min[axis] - box.min[axis]),
        Math.abs(next.max[axis] - box.max[axis]),
      );
    }
    box = next;
    if (growth < 1e-12) break;
  }
  return box;
}

/** The `2^dimension` corners of an axis-aligned intrinsic box. */
/** The `2^dimension` corners of an axis-aligned intrinsic box. The w slot
 * is the box's own bound in 4D and exactly 0 in 3D — reading the box's
 * uninitialized sentinel there would feed 0·Infinity = NaN into the
 * images. */
function axisBoxCorners(
  box: { min: Vec4; max: Vec4 },
  dimension: 3 | 4,
): Vec4[] {
  const corners: Vec4[] = [];
  for (let mask = 0; mask < 1 << dimension; mask++) {
    corners.push([
      mask & 1 ? box.max[0] : box.min[0],
      mask & 2 ? box.max[1] : box.min[1],
      mask & 4 ? box.max[2] : box.min[2],
      dimension === 4 ? (mask & 8 ? box.max[3] : box.min[3]) : 0,
    ]);
  }
  return corners;
}

/** The level bounding boxes: `levelBoxes[0] = bbox(root)`, then one
 * Hutchinson step per level — `levelBoxes[k] = bbox(∪_a M_a(corner images
 * of levelBoxes[k−1]))`. Sound because
 * `U_k = ∪_a M_a(U_{k−1}) ⊆ ∪_a M_a(levelBoxes[k−1])` and an affine image's
 * bbox extreme sits at a corner's image. */
function levelBoxesFor(
  dimension: 3 | 4,
  level: number,
  mapMatrix: readonly number[][],
  mapOffset: readonly Vec4[],
  rootVertices: readonly Vec4[],
): Array<{ min: Vec4; max: Vec4 }> {
  const bboxFrom = (points: readonly Vec4[]): { min: Vec4; max: Vec4 } => {
    const min: Vec4 = [Infinity, Infinity, Infinity, Infinity];
    const max: Vec4 = [-Infinity, -Infinity, -Infinity, -Infinity];
    for (const p of points) {
      for (let axis = 0; axis < 4; axis++) {
        min[axis] = Math.min(min[axis], p[axis]);
        max[axis] = Math.max(max[axis], p[axis]);
      }
    }
    return { min, max };
  };
  const boxes: Array<{ min: Vec4; max: Vec4 }> = [];
  let current = bboxFrom(rootVertices);
  boxes.push({ min: [...current.min] as Vec4, max: [...current.max] as Vec4 });
  for (let k = 1; k <= level; k++) {
    const corners = axisBoxCorners(current, dimension);
    const points: Vec4[] = [];
    for (let a = 0; a < mapMatrix.length; a++) {
      const m = mapMatrix[a];
      const t = mapOffset[a];
      for (const corner of corners) {
        const image = applyMatrix4(m, corner);
        for (let axis = 0; axis < 4; axis++) image[axis] += t[axis];
        points.push(image);
      }
    }
    current = bboxFrom(points);
    boxes.push({
      min: [...current.min] as Vec4,
      max: [...current.max] as Vec4,
    });
  }
  return boxes;
}

/** An affine's inverse as {m⁻¹, −m⁻¹t} — the composed-word node clip and
 * the display's oriented-box facets both read its rows. Deterministic
 * Gauss-Jordan with the same pivot discipline as solveLinear; a
 * non-invertible map returns NaN rows (the caller refuses). */
function inverseAffine(
  m: readonly number[],
  t: Vec4,
): { m: number[]; t: Vec4 } {
  const work = m.slice();
  const rhs: number[][] = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  const rowScale: number[] = [];
  for (let i = 0; i < 4; i++) {
    let scale = 0;
    for (let j = 0; j < 4; j++) scale = Math.max(scale, Math.abs(m[i * 4 + j]));
    if (!(scale > 0)) {
      return { m: new Array<number>(16).fill(NaN), t: [NaN, NaN, NaN, NaN] };
    }
    rowScale.push(scale);
  }
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    let best = -1;
    for (let row = col; row < 4; row++) {
      const magnitude = Math.abs(work[row * 4 + col]) / rowScale[row];
      if (magnitude > best) {
        best = magnitude;
        pivot = row;
      }
    }
    if (!(best > 1e-13)) {
      return { m: new Array<number>(16).fill(NaN), t: [NaN, NaN, NaN, NaN] };
    }
    if (pivot !== col) {
      for (let j = 0; j < 4; j++) {
        const tmp = work[col * 4 + j];
        work[col * 4 + j] = work[pivot * 4 + j];
        work[pivot * 4 + j] = tmp;
      }
      const tmpRow = rhs[col];
      rhs[col] = rhs[pivot];
      rhs[pivot] = tmpRow;
    }
    for (let row = 0; row < 4; row++) {
      if (row === col) continue;
      const factor = work[row * 4 + col] / work[col * 4 + col];
      if (factor === 0) continue;
      for (let j = 0; j < 4; j++)
        work[row * 4 + j] -= factor * work[col * 4 + j];
      for (let j = 0; j < 4; j++) rhs[row][j] -= factor * rhs[col][j];
    }
  }
  const inv = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row++) {
    const d = work[row * 4 + row];
    for (let j = 0; j < 4; j++) inv[row * 4 + j] = rhs[row][j] / d;
  }
  const ti: Vec4 = [
    -(inv[0] * t[0] + inv[1] * t[1] + inv[2] * t[2] + inv[3] * t[3]),
    -(inv[4] * t[0] + inv[5] * t[1] + inv[6] * t[2] + inv[7] * t[3]),
    -(inv[8] * t[0] + inv[9] * t[1] + inv[10] * t[2] + inv[11] * t[3]),
    -(inv[12] * t[0] + inv[13] * t[1] + inv[14] * t[2] + inv[15] * t[3]),
  ];
  return { m: inv, t: ti };
}

/** The axis-aligned slab clip of a ray against an intrinsic box — the
 * node-prune test. The ray's parameter is preserved by the inverse
 * transform (an affine reparametrization keeps t), so the node's interval
 * contains the subtree leaves' intervals exactly. */
function clipAxisAlignedBox(
  box: { min: Vec4; max: Vec4 },
  dimension: 3 | 4,
  p: Vec4,
  d: Vec4,
): { enter: number; exit: number } | null {
  let enter = -Infinity;
  let exit = Infinity;
  for (let axis = 0; axis < dimension; axis++) {
    const da = d[axis];
    if (da === 0) {
      if (p[axis] < box.min[axis] || p[axis] > box.max[axis]) return null;
      continue;
    }
    const ta = (box.min[axis] - p[axis]) / da;
    const tb = (box.max[axis] - p[axis]) / da;
    const near = Math.min(ta, tb);
    const far = Math.max(ta, tb);
    if (near > enter) enter = near;
    if (far < exit) exit = far;
    if (exit < enter) return null;
  }
  if (enter === -Infinity) enter = -1e30;
  if (exit === Infinity) exit = 1e30;
  if (!(exit > enter)) return null;
  return { enter, exit };
}

/** The oriented box's signed-distance form: `M(box)` is the set
 * {y : lo_i ≤ e_i·M⁻¹(y − t) ≤ hi_i} — the i-th coordinate of M⁻¹(y) is
 * `row_i(invM)·y + invT[i]`, so per axis the two facet planes have normal
 * = row i of invM (length `|row|`) and the signed distances to them are
 * the frame gaps divided by that length. The max of the half-space
 * distances is a certified lower bound outside (the box is the
 * intersection of its half-spaces) and the exact interior depth inside —
 * the display hybrid's branch term. */
function orientedBoxSdf(
  invM: readonly number[],
  invT: Vec4,
  box: { min: Vec4; max: Vec4 },
  dimension: 3 | 4,
  q: Vec4,
): number {
  let best = -Infinity;
  for (let axis = 0; axis < dimension; axis++) {
    const r0 = invM[axis * 4];
    const r1 = invM[axis * 4 + 1];
    const r2 = invM[axis * 4 + 2];
    const r3 = invM[axis * 4 + 3];
    const scale = Math.hypot(r0, r1, r2, dimension === 4 ? r3 : 0);
    if (!(scale > 0)) return Infinity;
    const value = r0 * q[0] + r1 * q[1] + r2 * q[2] + r3 * q[3] + invT[axis];
    const loGap = (box.min[axis] - value) / scale;
    const hiGap = (value - box.max[axis]) / scale;
    best = Math.max(best, loGap, hiGap);
  }
  return best;
}
/** The exact simplex SDF over its own facets: the max of the facet
 * half-space distances. Outside it is a certified conservative bound (the
 * simplex is the intersection of its half-spaces, so the distance to the
 * intersection is at least the max of the distances to them — understated
 * near edges and corners, never overstated); inside it is the exact depth
 * to the nearest facet; zero exactly on the boundary. */
function simplexSdf(
  facets: readonly GeneralFacet[],
  dimension: 3 | 4,
  q: Vec4,
): number {
  let best = -Infinity;
  for (const facet of facets) {
    const s = dotIntrinsic(facet.n, q, dimension) - facet.c;
    if (s > best) best = s;
  }
  return best;
}

/** Ray ∩ simplex by its facet half-spaces: `s(t) = s(q) + t·(n·qd)`; the
 * crossing time `−s/(n·qd)` is an entry when the ray moves inward (dot <
 * 0), an exit when it moves outward (dot > 0), and a parallel facet
 * requires the ray already inside its half-space. No epsilon — only
 * numerically equal crossing times tie; the binding facets ride the
 * masks. A ray wholly inside (no entering facet) or wholly outside
 * forward (no exiting facet) clamps to the ±1e30 sentinels the sweep
 * reads. */
interface GeneralClip {
  enter: number;
  exit: number;
  enterMask: number;
  exitMask: number;
}

function clipGeneralSimplex(
  facets: readonly GeneralFacet[],
  dimension: 3 | 4,
  q: Vec4,
  qd: Vec4,
  onPlaneMask = 0,
): GeneralClip | null {
  let enter = -Infinity;
  let exit = Infinity;
  let enterMask = 0;
  let exitMask = 0;
  for (let k = 0; k < facets.length; k++) {
    const facet = facets[k];
    const denom = dotIntrinsic(facet.n, qd, dimension);
    // A facet the anchor asserts the query point sits ON reads residual
    // exactly zero — what the snap computed in exact arithmetic (see
    // enumerateSimplicialLeaves).
    const s =
      (onPlaneMask & (1 << k)) !== 0
        ? 0
        : dotIntrinsic(facet.n, q, dimension) - facet.c;
    if (denom === 0) {
      if (s > 0) return null;
      continue;
    }
    const t = -s / denom;
    if (denom > 0) {
      if (t < exit) {
        exit = t;
        exitMask = 1 << k;
      } else if (t === exit) {
        exitMask |= 1 << k;
      }
    } else {
      if (t > enter) {
        enter = t;
        enterMask = 1 << k;
      } else if (t === enter) {
        enterMask |= 1 << k;
      }
    }
  }
  // The sentinels: a ray wholly inside (every facet exiting) enters at
  // −∞; a ray converging into the simplex exits at +∞. The sweep's tie at
  // the sentinel absorbs nothing but itself.
  if (enter === -Infinity) enter = -1e30;
  if (exit === Infinity) exit = 1e30;
  if (!(exit > enter) || !Number.isFinite(enter) || !Number.isFinite(exit)) {
    return null;
  }
  return { enter, exit, enterMask, exitMask };
}

/** One leaf's enumeration record: the word, the clipped interval, and the
 * binding facet masks at each end (the atomic-event candidates). */
interface GeneralLeaf {
  word: number[];
  enter: number;
  exit: number;
  enterMask: number;
  exitMask: number;
}

interface GeneralEndpoint {
  t: number;
  delta: 1 | -1;
  leaf: GeneralLeaf;
  mask: number;
}

/** The pruned enumeration: the level-N leaves whose SIMPLEX the ray clips,
 * subtrees pruned when the ray misses the child node's LEVEL BOX — the
 * word-image of `levelBoxes[remaining]`, which contains the node's whole
 * subtree by construction (`U_k ⊆ levelBoxes[k]`), so the pruned
 * enumeration equals the unpruned one endpoint for endpoint WITHOUT any
 * root-invariance assumption (rotating maps admit no invariant simplex —
 * measured). The node clip transforms the ray by the composed word's
 * inverse and clips the axis-aligned box; the ray's parameter survives the
 * affine reparametrization, so the leaf clips' times compare directly.
 * Returns null when the leaf cap refused. */
function enumerateSimplicialLeaves(
  c: FiniteSolidGeneralConstruction,
  q: Vec4,
  qd: Vec4,
  cap: number,
  anchor?: FiniteSolidAnchor,
): GeneralLeaf[] | null {
  const leaves: GeneralLeaf[] = [];
  const dimension = c.dimension;
  const word: number[] = [];
  // THE ANCHOR'S OWN LEAF CROSSES ITS MASKED FACETS AT EXACTLY t = 0. The
  // snap put the query point on those planes, but only to the precision it
  // rounds at: at a grazing angle the recomputed crossing `−s/denom`
  // amplifies that residual past the tie, and the restart then misreads
  // its own starting side (measured on the f32 twin: 3 of 420 sampled
  // chains refused state-mismatch mid-walk; 0 of 420 with this rule). The
  // box construction had the property for free — an axis snap sets the
  // coordinate EXACTLY to the face — and the anchor contract already
  // declares the anchor authoritative, so its leaf's masked residuals are
  // the zeros exact arithmetic would compute. Every other leaf, including
  // a tied neighbour across the same face, clips from the point as-is.
  const onPlaneMask = (leafWord: readonly number[]): number =>
    anchor && leafWord.every((w, slot) => w === anchor.cellIndices[slot])
      ? anchor.planeMask
      : 0;
  const clipComposed = (
    matrix: readonly number[],
    offset: Vec4,
  ): GeneralClip | null => {
    const vertices = c.rootVertices.map((v) => {
      const image = applyMatrix4(matrix, v);
      return [
        image[0] + offset[0],
        image[1] + offset[1],
        image[2] + offset[2],
        image[3] + offset[3],
      ] as Vec4;
    });
    const facets = facetsFromVertices(vertices, dimension);
    if (!facets) return null;
    return clipGeneralSimplex(facets, dimension, q, qd, onPlaneMask(word));
  };
  const walk = (
    matrix: number[],
    offset: Vec4,
    invM: number[],
    invT: Vec4,
    depth: number,
  ): boolean => {
    for (let a = 0; a < c.mapCount; a++) {
      const step = composeWordStep(matrix, offset, {
        matrix: c.mapMatrix[a],
        offset: c.mapOffset[a],
      });
      // The child node's inverse: (parent ∘ M_a)⁻¹ = M_a⁻¹ ∘ parent⁻¹.
      const child = childInverse(inverseMapMatrix[a], c.mapOffset[a], {
        m: invM,
        t: invT,
      });
      const childInvM = child.m;
      const childInvT = child.t;
      const childDepth = depth + 1;
      if (childDepth < c.level) {
        // The node prune: the subtree nests inside the child's word-image
        // of its level box. Transform the ray by the composed inverse and
        // clip the axis-aligned box; skip the subtree when the ray misses.
        const nodeP: Vec4 = [
          childInvM[0] * q[0] +
            childInvM[1] * q[1] +
            childInvM[2] * q[2] +
            childInvM[3] * q[3] +
            childInvT[0],
          childInvM[4] * q[0] +
            childInvM[5] * q[1] +
            childInvM[6] * q[2] +
            childInvM[7] * q[3] +
            childInvT[1],
          childInvM[8] * q[0] +
            childInvM[9] * q[1] +
            childInvM[10] * q[2] +
            childInvM[11] * q[3] +
            childInvT[2],
          childInvM[12] * q[0] +
            childInvM[13] * q[1] +
            childInvM[14] * q[2] +
            childInvM[15] * q[3] +
            childInvT[3],
        ];
        const nodeD: Vec4 = [
          childInvM[0] * qd[0] +
            childInvM[1] * qd[1] +
            childInvM[2] * qd[2] +
            childInvM[3] * qd[3],
          childInvM[4] * qd[0] +
            childInvM[5] * qd[1] +
            childInvM[6] * qd[2] +
            childInvM[7] * qd[3],
          childInvM[8] * qd[0] +
            childInvM[9] * qd[1] +
            childInvM[10] * qd[2] +
            childInvM[11] * qd[3],
          childInvM[12] * qd[0] +
            childInvM[13] * qd[1] +
            childInvM[14] * qd[2] +
            childInvM[15] * qd[3],
        ];
        const nodeClip = clipAxisAlignedBox(
          c.levelBoxes[c.level - childDepth],
          dimension,
          nodeP,
          nodeD,
        );
        if (!nodeClip) continue;
      }
      word.push(a);
      if (childDepth === c.level) {
        const childClip = clipComposed(step.matrix, step.offset);
        if (!childClip) {
          word.pop();
          continue;
        }
        if (leaves.length >= cap) {
          word.pop();
          return false;
        }
        leaves.push({
          word: [...word],
          enter: childClip.enter,
          exit: childClip.exit,
          enterMask: childClip.enterMask,
          exitMask: childClip.exitMask,
        });
      } else if (
        !walk(step.matrix, step.offset, childInvM, childInvT, childDepth)
      ) {
        word.pop();
        return false;
      }
      word.pop();
    }
    return true;
  };
  if (c.level === 0) {
    const facets = facetsFromVertices(c.rootVertices, dimension);
    if (!facets) return leaves;
    const clip = clipGeneralSimplex(facets, dimension, q, qd, onPlaneMask([]));
    if (clip) {
      leaves.push({
        word: [],
        enter: clip.enter,
        exit: clip.exit,
        enterMask: clip.enterMask,
        exitMask: clip.exitMask,
      });
    }
    return leaves;
  }
  // The entry prune: the whole tree sits inside levelBoxes[level]; a ray
  // missing that axis-aligned box misses every leaf.
  const rootClip = clipAxisAlignedBox(c.levelBoxes[c.level], dimension, q, qd);
  if (!rootClip) return leaves;
  const inverseMapMatrix = finiteSolidGeneralInverseMaps(c).map((inv) => inv.m);
  return walk(
    identityMatrix4(),
    [0, 0, 0, 0],
    identityMatrix4(),
    [0, 0, 0, 0],
    0,
  )
    ? leaves
    : null;
}

function generalTieAbs(t: number): number {
  return FINITE_SOLID_GENERAL_TIE_REL * Math.max(1, Math.abs(t));
}

/** The UNCAPPED reference enumeration: every level-N word's simplex
 * clipped against the intrinsic ray (the same clip arithmetic and the
 * same prefix compose association as the production walk, no pruning —
 * the harness's sweeps pin the pruned walk against it). */
function enumerateAllSimplicialLeaves(
  c: FiniteSolidGeneralConstruction,
  q: Vec4,
  qd: Vec4,
): GeneralLeaf[] {
  const leaves: GeneralLeaf[] = [];
  const word: number[] = new Array<number>(c.level).fill(0);
  const clipWord = (w: readonly number[]): void => {
    let matrix = identityMatrix4();
    let offset: Vec4 = [0, 0, 0, 0];
    for (let depth = 0; depth < w.length; depth++) {
      const step = composeWordStep(matrix, offset, {
        matrix: c.mapMatrix[w[depth]],
        offset: c.mapOffset[w[depth]],
      });
      matrix = step.matrix;
      offset = step.offset;
    }
    const vertices = c.rootVertices.map((v) => {
      const image = applyMatrix4(matrix, v);
      return [
        image[0] + offset[0],
        image[1] + offset[1],
        image[2] + offset[2],
        image[3] + offset[3],
      ] as Vec4;
    });
    const facets = facetsFromVertices(vertices, c.dimension);
    if (!facets) return;
    const clip = clipGeneralSimplex(facets, c.dimension, q, qd);
    if (clip) {
      leaves.push({
        word: [...w],
        enter: clip.enter,
        exit: clip.exit,
        enterMask: clip.enterMask,
        exitMask: clip.exitMask,
      });
    }
  };
  if (c.level === 0) {
    clipWord([]);
  } else {
    for (;;) {
      clipWord(word);
      let digit = c.level - 1;
      for (; digit >= 0; digit--) {
        if (++word[digit] < c.mapCount) break;
        word[digit] = 0;
      }
      if (digit < 0) break;
    }
  }
  return leaves;
}

/** The exact interval union along the ray: the leaves' intervals merged
 * with the declared-resolution tie (endpoints within the envelope are ONE
 * boundary — a shared face's two sides, computed through different word
 * compositions, must not read as a phantom gap). The UNCAPPED reference
 * enumeration (K^level leaves). */
export function finiteSolidGeneralIntervals(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  dir: Vec3,
): Array<{ enter: number; exit: number }> {
  const q = finiteSolidIntrinsicPoint(pose, origin);
  const qd = finiteSolidIntrinsicDirection(pose, dir);
  const leaves = enumerateAllSimplicialLeaves(c, q, qd);
  const endpoints: Array<{ t: number; delta: number }> = [];
  for (const leaf of leaves) {
    endpoints.push({ t: leaf.enter, delta: 1 });
    endpoints.push({ t: leaf.exit, delta: -1 });
  }
  endpoints.sort((a, b) => a.t - b.t);
  const union: Array<{ enter: number; exit: number }> = [];
  let coverage = 0;
  let openEnter = 0;
  let i = 0;
  while (i < endpoints.length) {
    const groupT = endpoints[i].t;
    const tie = generalTieAbs(groupT);
    let net = 0;
    while (i < endpoints.length && endpoints[i].t - groupT <= tie) {
      net += endpoints[i].delta;
      i++;
    }
    const before = coverage;
    coverage += net;
    if (before === 0 && coverage > 0) openEnter = groupT;
    if (before > 0 && coverage === 0)
      union.push({ enter: openEnter, exit: groupT });
  }
  return union;
} /** The displayed normal of an intrinsic facet normal: the world direction
 * whose intrinsic image is the normal's projection onto the displayed
 * slice's direction space — `Pᵀn` for the pose rows' xyz columns `P`
 * (orthonormal, so exact); the identity pose reduces to the xyz part. */
function displayedNormal(pose: FiniteSolidPose, n: Vec4): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let a = 0; a < 4; a++) {
    x += pose.rows[a][0] * n[a];
    y += pose.rows[a][1] * n[a];
    z += pose.rows[a][2] * n[a];
  }
  return [x, y, z];
}

/** The exact-corner normal, one tree up: reflect/refract against the
 * incident ray's projection onto the span of every tied face's DISPLAYED
 * normal, Gram-Schmidt in the group's sorted-endpoint order (each face's
 * masked facets ascending). A vec3 of zeros is the rank-zero refusal
 * sentinel — the shipped convention's shape. */
function simplicialBoundaryNormal(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  direction: Vec3,
  faces: ReadonlyArray<{ leaf: GeneralLeaf; mask: number }>,
  entering: boolean,
): Vec3 | null {
  const basis: Vec3[] = [];
  for (const face of faces) {
    if (basis.length === 3) break;
    const vertices = generalLeafVertices(c, face.leaf.word);
    const facets = facetsFromVertices(vertices, c.dimension);
    if (!facets) return null;
    for (let f = 0; f < facets.length && basis.length < 3; f++) {
      if ((face.mask & (1 << f)) === 0) continue;
      const displayed = displayedNormal(pose, facets[f].n);
      const vector: Vec3 = [displayed[0], displayed[1], displayed[2]];
      const length = Math.hypot(vector[0], vector[1], vector[2]);
      for (const unit of basis) {
        const projection =
          vector[0] * unit[0] + vector[1] * unit[1] + vector[2] * unit[2];
        for (let component = 0; component < 3; component++) {
          vector[component] -= projection * unit[component];
        }
      }
      const magnitude = Math.hypot(vector[0], vector[1], vector[2]);
      // A 4D facet whose displayed normal vanishes (orthogonal to the
      // slice) and a shared face's ulp twin are both dependent.
      if (
        !(magnitude > FINITE_SOLID_GENERAL_NORMAL_DEPENDENT_REL * length) ||
        !Number.isFinite(magnitude)
      ) {
        continue;
      }
      basis.push([
        vector[0] / magnitude,
        vector[1] / magnitude,
        vector[2] / magnitude,
      ]);
    }
  }
  const projected: Vec3 = [0, 0, 0];
  for (const unit of basis) {
    const amount =
      direction[0] * unit[0] + direction[1] * unit[1] + direction[2] * unit[2];
    for (let component = 0; component < 3; component++) {
      projected[component] += amount * unit[component];
    }
  }
  const magnitude = Math.hypot(projected[0], projected[1], projected[2]);
  if (!(magnitude > 0) || !Number.isFinite(magnitude)) return null;
  const sign = entering ? -1 : 1;
  return [
    (sign * projected[0]) / magnitude,
    (sign * projected[1]) / magnitude,
    (sign * projected[2]) / magnitude,
  ];
}

function validGeneralConstruction(c: FiniteSolidGeneralConstruction): boolean {
  return (
    (c.dimension === 3 || c.dimension === 4) &&
    Number.isInteger(c.level) &&
    c.level >= 0 &&
    c.level <= FINITE_SOLID_GENERAL_MAX_LEVEL &&
    Number.isInteger(c.mapCount) &&
    c.mapCount >= 1 &&
    c.mapCount <= FINITE_SOLID_GENERAL_MAX_MAPS &&
    c.mapMatrix.length === c.mapCount &&
    c.mapOffset.length === c.mapCount &&
    c.mapMatrix.every((m) => m.length === 16 && m.every(Number.isFinite)) &&
    c.mapOffset.every((t) => t.every(Number.isFinite)) &&
    c.rootVertices.length === c.dimension + 1 &&
    c.rootVertices.every((v) => v.every(Number.isFinite)) &&
    (c.rootKind === "hull" || c.rootKind === "derived")
  );
}

/** The anchor's word must name real maps at the construction's depth, the
 * mask must sit inside the cell's own facet range, and the simplicial
 * contract leaves every `planeIndices` slot unused — the facet identity
 * rides the mask and the planes recompute from the leaf's vertices. */
function validGeneralAnchor(
  c: FiniteSolidGeneralConstruction,
  anchor: FiniteSolidAnchor,
): boolean {
  if (!anchor.intrinsicPoint.every(Number.isFinite)) return false;
  if (
    !Number.isInteger(anchor.planeMask) ||
    anchor.planeMask <= 0 ||
    (anchor.planeMask & ~((1 << (c.dimension + 1)) - 1)) !== 0
  ) {
    return false;
  }
  if (!anchor.planeIndices.every((value) => value === -1)) return false;
  let depth = 0;
  for (let slot = 0; slot < 4; slot++) {
    const index = anchor.cellIndices[slot];
    if (index === -1) break;
    if (index < 0 || index >= c.mapCount) return false;
    depth++;
  }
  if (depth !== c.level) return false;
  for (let slot = depth; slot < 4; slot++) {
    if (anchor.cellIndices[slot] !== -1) return false;
  }
  return true;
}

/** The boundary event from one tied endpoint group. The entering side is
 * the group's after-coverage (the actual geometry, never the claim); the
 * tied faces' displayed normals carry the span-projected normal; the
 * anchor names the INCIDENT leaf — the group's sorted-first endpoint's
 * leaf — whose own crossed facets are the mask and whose COMPOSED facet
 * planes are the restart's snap targets. */
function simplicialBoundaryEvent(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  q: Vec4,
  qd: Vec4,
  direction: Vec3,
  group: {
    t: number;
    before: number;
    after: number;
    afterBranch: number;
    faces: Array<{ leaf: GeneralLeaf; mask: number }>;
  },
  t: number,
  visits: number,
): FiniteSolidBoundary | FiniteSolidRefusal {
  // "Entering" is the medium after the event being anything but air: the
  // outward normal then faces AGAINST the ray (an entry, a glass-to-glass
  // interface, an opaque terminal), and along it on an exit into air.
  const entering = group.after !== FINITE_SOLID_MEDIUM_AIR;
  const outwardNormal = simplicialBoundaryNormal(
    c,
    pose,
    direction,
    group.faces,
    entering,
  );
  if (!outwardNormal) {
    return { kind: "refused", reason: "degenerate-projected-normal", visits };
  }
  // The primary facet: the tied facet with the largest |n·qd| — the
  // chooseAxis analog (ties keep the group's sorted order's first).
  const incident = group.faces[0];
  const incidentVertices = generalLeafVertices(c, incident.leaf.word);
  const incidentFacets = facetsFromVertices(incidentVertices, c.dimension);
  if (!incidentVertices || !incidentFacets) {
    return { kind: "refused", reason: "invalid-input", visits };
  }
  let primaryFacet = -1;
  let primaryMagnitude = -1;
  let primaryNormal: Vec4 | null = null;
  for (const face of group.faces) {
    const facets = facetsFromVertices(
      generalLeafVertices(c, face.leaf.word),
      c.dimension,
    );
    if (!facets) {
      return { kind: "refused", reason: "invalid-input", visits };
    }
    for (let f = 0; f < facets.length; f++) {
      if ((face.mask & (1 << f)) === 0) continue;
      const magnitude = Math.abs(dotIntrinsic(facets[f].n, qd, c.dimension));
      if (magnitude > primaryMagnitude) {
        primaryMagnitude = magnitude;
        primaryFacet = f;
        primaryNormal = facets[f].n;
      }
    }
  }
  if (primaryFacet < 0 || !primaryNormal) {
    return { kind: "refused", reason: "invalid-input", visits };
  }
  const directionSign =
    dotIntrinsic(primaryNormal, qd, c.dimension) > 0 ? 1 : -1;
  const faceSign = (entering ? -directionSign : directionSign) as -1 | 1;
  // The anchor: the incident leaf's crossed facets ride the mask; the
  // crossed coordinates snap onto the leaf's COMPOSED facet planes — the
  // clip's own values — and the rest clamp into the leaf under the
  // declared envelope.
  const radius = generalCellRadius(incidentVertices, c.dimension);
  const envelope =
    FINITE_SOLID_GENERAL_SNAP_REL *
    Math.max(1, radius, intrinsicMagnitude(q, c.dimension), Math.abs(t));
  const intrinsicPoint = q.map(
    (value, intrinsicAxis) => value + t * qd[intrinsicAxis],
  ) as Vec4;
  for (let f = 0; f < incidentFacets.length; f++) {
    if ((incident.mask & (1 << f)) === 0) continue;
    const correction =
      incidentFacets[f].c -
      dotIntrinsic(incidentFacets[f].n, intrinsicPoint, c.dimension);
    if (Math.abs(correction) > envelope) {
      return { kind: "refused", reason: "invalid-input", visits };
    }
    for (let axis = 0; axis < 4; axis++) {
      intrinsicPoint[axis] += correction * incidentFacets[f].n[axis];
    }
  }
  for (let pass = 0; pass <= incidentFacets.length; pass++) {
    let worst = -1;
    let worstS = 0;
    for (let f = 0; f < incidentFacets.length; f++) {
      if ((incident.mask & (1 << f)) !== 0) continue;
      const s =
        dotIntrinsic(incidentFacets[f].n, intrinsicPoint, c.dimension) -
        incidentFacets[f].c;
      if (s > worstS) {
        worstS = s;
        worst = f;
      }
    }
    if (worst < 0) break;
    if (worstS > envelope) {
      return { kind: "refused", reason: "invalid-input", visits };
    }
    for (let axis = 0; axis < 4; axis++) {
      intrinsicPoint[axis] -= worstS * incidentFacets[worst].n[axis];
    }
  }
  const cellIndices: [number, number, number, number] = [-1, -1, -1, -1];
  for (let slot = 0; slot < incident.leaf.word.length; slot++) {
    cellIndices[slot] = incident.leaf.word[slot];
  }
  return {
    kind: "boundary",
    t,
    entering,
    outwardNormal,
    intrinsicAxis: primaryFacet,
    faceSign,
    face: { axis: primaryFacet, planeIndex: primaryFacet, level: c.level },
    anchor: {
      intrinsicPoint,
      planeMask: incident.mask,
      planeIndices: [-1, -1, -1, -1],
      cellIndices,
    },
    visits,
    fromMedium: group.before,
    toMedium: group.after,
    toBranch: group.afterBranch,
  };
}

/**
 * The simplicial word-tree boundary query — the shipped DDA's event
 * taxonomy over the document's own cell tree, pruned. The medium flips
 * where the leaves' interval union's coverage crosses zero; tied
 * endpoints (a shared face's two sides, or an exact corner across cells)
 * are ONE atomic event with the span-projected normal, so an interior
 * shared face is traversed silently and a genuine gap fires the honest
 * exit/enter pair. The leaf cap refuses a ray that clips more pruned
 * leaves than the device's bound.
 */
export function finiteSolidGeneralNextBoundary(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  direction: Vec3,
  options: FiniteSolidGeneralQueryOptions,
): FiniteSolidBoundaryResult {
  if (
    !validGeneralConstruction(c) ||
    !validGeneralMedia(c, options.media) ||
    typeof options.inside !== "boolean" ||
    !origin.every(Number.isFinite) ||
    !direction.every(Number.isFinite) ||
    !(Math.hypot(direction[0], direction[1], direction[2]) > 0)
  ) {
    return { kind: "refused", reason: "invalid-input", visits: 0 };
  }
  const tMin = options.tMin ?? 0;
  if (!Number.isFinite(tMin) || tMin < 0) {
    return { kind: "refused", reason: "invalid-input", visits: 0 };
  }
  return finiteSolidGeneralNextBoundaryInternal(c, pose, origin, direction, {
    ...options,
    tMin,
  });
}

/** The anchored continuation: the intrinsic anchor is authoritative (the
 * rounded display coordinate cannot replace the canonical boundary
 * origin). The anchor's word names the post-incident leaf; its masked
 * facets — the incident leaf's own crossed facet indices — name the
 * incident faces, and the reconstruction snaps onto those COMPOSED facet
 * planes and clamps the rest into the leaf under the declared envelope. */
export function finiteSolidGeneralNextBoundaryFromAnchor(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  direction: Vec3,
  options: {
    inside: boolean;
    anchor: FiniteSolidAnchor;
    media?: FiniteSolidGeneralMedia;
    medium?: number;
  },
): FiniteSolidBoundaryResult {
  if (
    !validGeneralConstruction(c) ||
    !validGeneralAnchor(c, options.anchor) ||
    !validGeneralMedia(c, options.media)
  ) {
    return { kind: "refused", reason: "invalid-input", visits: 0 };
  }
  if (
    typeof options.inside !== "boolean" ||
    !direction.every(Number.isFinite) ||
    !(Math.hypot(direction[0], direction[1], direction[2]) > 0)
  ) {
    return { kind: "refused", reason: "invalid-input", visits: 0 };
  }
  return finiteSolidGeneralNextBoundaryInternal(c, pose, [0, 0, 0], direction, {
    inside: options.inside,
    tMin: 0,
    anchor: options.anchor,
    media: options.media,
    medium: options.medium,
  });
}

function finiteSolidGeneralNextBoundaryInternal(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  direction: Vec3,
  options: FiniteSolidGeneralQueryOptions & { anchor?: FiniteSolidAnchor },
): FiniteSolidBoundaryResult {
  const anchor = options.anchor;
  const tMin = options.tMin ?? 0;
  const dimension = c.dimension;
  let q: Vec4;
  if (anchor) {
    // The anchor's word is authoritative for its own faces: snap the
    // masked coordinates onto the leaf's COMPOSED facet planes and clamp
    // the rest into the leaf under the declared envelope — the shipped
    // reconstruction's discipline, one tree up.
    const word: number[] = [];
    for (let slot = 0; slot < c.level; slot++) {
      word.push(anchor.cellIndices[slot]);
    }
    const vertices = generalLeafVertices(c, word);
    const facets = facetsFromVertices(vertices, dimension);
    if (!facets) {
      return { kind: "refused", reason: "invalid-input", visits: 0 };
    }
    const radius = generalCellRadius(vertices, dimension);
    const p = [...anchor.intrinsicPoint] as Vec4;
    const envelope =
      FINITE_SOLID_GENERAL_SNAP_REL *
      Math.max(1, radius, intrinsicMagnitude(p, dimension));
    for (let f = 0; f < facets.length; f++) {
      if ((anchor.planeMask & (1 << f)) === 0) continue;
      const correction = facets[f].c - dotIntrinsic(facets[f].n, p, dimension);
      if (Math.abs(correction) > envelope) {
        return { kind: "refused", reason: "invalid-input", visits: 0 };
      }
      for (let axis = 0; axis < 4; axis++) {
        p[axis] += correction * facets[f].n[axis];
      }
    }
    for (let pass = 0; pass <= facets.length; pass++) {
      let worst = -1;
      let worstS = 0;
      for (let f = 0; f < facets.length; f++) {
        if ((anchor.planeMask & (1 << f)) !== 0) continue;
        const s = dotIntrinsic(facets[f].n, p, dimension) - facets[f].c;
        if (s > worstS) {
          worstS = s;
          worst = f;
        }
      }
      if (worst < 0) break;
      if (worstS > envelope) {
        return { kind: "refused", reason: "invalid-input", visits: 0 };
      }
      for (let axis = 0; axis < 4; axis++) {
        p[axis] -= worstS * facets[worst].n[axis];
      }
    }
    q = p;
  } else {
    q = finiteSolidIntrinsicPoint(pose, origin);
  }
  const qd = finiteSolidIntrinsicDirection(pose, direction);
  const leafCap = Math.min(
    c.mapCount ** c.level,
    FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES,
  );
  const leaves = enumerateSimplicialLeaves(c, q, qd, leafCap, anchor);
  if (!leaves) {
    // The pruned enumeration overflowed its cap: a disclosed refusal —
    // never a truncation.
    return { kind: "refused", reason: "visit-cap", visits: 0 };
  }
  // Endpoint sweep with the declared-resolution ties: consecutive
  // endpoints within the tie of a group's first endpoint are ONE boundary
  // group. Coverage is counted PER BRANCH and the medium after each group
  // is the owner rule's (generalMediumOf); an event is a MEDIUM CHANGE, so
  // a group that leaves the medium unchanged (a shared face's exit tied
  // with the neighbour's entry, an overlap's interior face, a crossing
  // between equal-material glass subtrees) is traversed silently. Without
  // media every branch is glass code 1 and this is the union's coverage
  // crossing zero, exactly.
  const media = options.media;
  const endpoints: GeneralEndpoint[] = [];
  for (const leaf of leaves) {
    endpoints.push({ t: leaf.enter, delta: 1, leaf, mask: leaf.enterMask });
    endpoints.push({ t: leaf.exit, delta: -1, leaf, mask: leaf.exitMask });
  }
  endpoints.sort((a, b) => a.t - b.t);
  interface GeneralGroup {
    t: number;
    before: number;
    after: number;
    afterBranch: number;
    faces: Array<{ leaf: GeneralLeaf; mask: number }>;
  }
  const groups: GeneralGroup[] = [];
  const coverage = new Array<number>(c.mapCount).fill(0);
  let medium: number = FINITE_SOLID_MEDIUM_AIR;
  let i = 0;
  while (i < endpoints.length) {
    const groupT = endpoints[i].t;
    const tie = generalTieAbs(groupT);
    const faces: Array<{ leaf: GeneralLeaf; mask: number }> = [];
    while (i < endpoints.length && endpoints[i].t - groupT <= tie) {
      coverage[endpoints[i].leaf.word[0] ?? 0] += endpoints[i].delta;
      faces.push({ leaf: endpoints[i].leaf, mask: endpoints[i].mask });
      i++;
    }
    const before = medium;
    const owner = generalMediumOf(coverage, media);
    medium = owner.medium;
    groups.push({
      t: groupT,
      before,
      after: medium,
      afterBranch: owner.branch,
      faces,
    });
  }
  // The state at tMin: the last group at or before it (within that
  // group's tie); its after-medium owns the point (half-open, the
  // entering side — the shipped ray-side convention).
  let startGroupIndex = -1;
  for (let g = 0; g < groups.length; g++) {
    if (groups[g].t <= tMin + generalTieAbs(groups[g].t)) startGroupIndex = g;
    else break;
  }
  const stateAtStart =
    startGroupIndex >= 0
      ? groups[startGroupIndex].after
      : FINITE_SOLID_MEDIUM_AIR;
  // The claim: a medium code when the caller carries one, else the
  // single-material form's inside flag (glass code 1 / air).
  const claimed =
    options.medium ?? (options.inside ? 1 : FINITE_SOLID_MEDIUM_AIR);
  const stateMatches = media
    ? stateAtStart === claimed
    : (stateAtStart !== FINITE_SOLID_MEDIUM_AIR) === options.inside;
  const startGroup = startGroupIndex >= 0 ? groups[startGroupIndex] : undefined;
  const atStartGroup =
    startGroup !== undefined &&
    Math.abs(startGroup.t - tMin) <= generalTieAbs(startGroup.t);
  if (!stateMatches) {
    if (anchor || !atStartGroup) {
      // Off a boundary the claim must match the geometry; the anchored
      // continuation is the interior restart and takes no liberty with
      // the claim at all. The geometry's own start medium rides the
      // refusal for a transport re-anchoring its split.
      return {
        kind: "refused",
        reason: "state-mismatch",
        visits: 0,
        geometryMedium: stateAtStart,
      };
    }
    // The ray starts ON a boundary group with the claim anticipating the
    // crossing (the display march's primary hit): emit the start event,
    // FROM the claimed medium.
    const event = simplicialBoundaryEvent(
      c,
      pose,
      q,
      qd,
      direction,
      { ...startGroup, before: media ? claimed : startGroup.before },
      tMin,
      0,
    );
    if (
      event.kind === "boundary" &&
      tMin === 0 &&
      sameFace(options.previousFace, event.face)
    ) {
      return { kind: "refused", reason: "state-mismatch", visits: 0 };
    }
    return event;
  }
  // Walk the groups after the start; the first medium change is the next
  // event.
  let visits = 0;
  for (let g = startGroupIndex + 1; g < groups.length; g++) {
    const group = groups[g];
    visits++;
    if (group.before === group.after) continue;
    const event = simplicialBoundaryEvent(
      c,
      pose,
      q,
      qd,
      direction,
      group,
      group.t,
      visits,
    );
    if (
      event.kind === "boundary" &&
      group.t === tMin &&
      sameFace(options.previousFace, event.face)
    ) {
      return { kind: "refused", reason: "state-mismatch", visits };
    }
    return event;
  }
  return { kind: "miss", visits };
}

/** The simplicial display marcher's bounded-work estimate: the certified
 * hybrid over the level-1 branch BOXES and — one level in, for every branch
 * within its own refine margin — that branch's children. The bound rides the level boxes, NOT the cells:
 * rotating families admit no invariant simplex (measured), so a union
 * point can sit outside every level-1 cell and a cell-min would overstate
 * the distance. The containment argument is word-shaped instead: any
 * union point `p ∈ U_N` with `w = a·w'` satisfies
 * `p ∈ M_a(U_{N−1}) ⊆ M_a(levelBoxes[N−1])`, so the branch term — the
 * oriented box's max-of-half-space SDF, a lower bound of the distance to
 * its containing region — is a lower bound of `dist(q, p)`, and the global
 * nearest union point lives in some branch whose term the min cannot
 * overstate. The refine-when-close term keeps the seal hazard handled one
 * box up: a branch box's own faces are its SDF's zero set, and the deeper
 * structure (nested strictly inside the box) opens its gaps at those
 * faces, so the plain min would seal every opening at the box face;
 * REPLACING a near box's term by its children's boxes
 * (`M_{a·b}(levelBoxes[N−2])`, which cover `M_a(U_{N−1})` because
 * `U_{N−1} ⊆ ∪_b M_b(levelBoxes[N−2])`) vanishes those zeros inward and
 * keeps the bound. A min over the parent AND its children would not: the
 * children nest inside the parent, so the parent's face zeros survive.
 * The zeros still sit on box faces, not the union's surface — the zero
 * set is NOT only the union's boundary, this field is not a
 * membership oracle, and the transport walks the boundary query above,
 * never this field. The primary rays resolve exact boundaries through the
 * transport, so the box-coarse zero set costs coarser AO/shadow taps and
 * wasted candidate marches, never wrong pixels.
 *
 * Level 1 returns the plain min over the branch boxes (no children to
 * refine into); level 0 the root simplex's own SDF. The refine margin is relative
 * to the branch box's largest half extent (the shipped constant's role,
 * per box, measured in the world frame — `finiteSolidGeneralRefineTau`). */
export function finiteSolidGeneralDisplayDistance(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  p: Vec3,
): number {
  const q = finiteSolidIntrinsicPoint(pose, p);
  const dimension = c.dimension;
  const safety = (value: number): number =>
    value > 0 ? value * SHAPE_MARCH_SAFETY : value;
  if (c.level === 0) {
    const facets = facetsFromVertices(c.rootVertices, dimension);
    if (!facets) return 1e30;
    return safety(simplexSdf(facets, dimension, q));
  }
  // The branch stage: the word-images of levelBoxes[level − 1] — every
  // union point sits inside one of them. Each branch box within its own tau
  // is REPLACED by its children's boxes (the shipped hybrid's term rule): a
  // child box nests inside its parent, so a min over parent AND children
  // would keep the parent's face zeros and refine nothing.
  const inverseMaps = finiteSolidGeneralInverseMaps(c);
  const tau = finiteSolidGeneralRefineTau(c);
  let result = Infinity;
  for (let a = 0; a < c.mapCount; a++) {
    const inv = inverseMaps[a];
    const d = orientedBoxSdf(
      inv.m,
      inv.t,
      c.levelBoxes[c.level - 1],
      dimension,
      q,
    );
    let term = d;
    if (c.level > 1 && d < tau[a]) {
      let refined = Infinity;
      for (let b = 0; b < c.mapCount; b++) {
        // The grandchild's inverse: (M_a ∘ M_b)⁻¹ = M_b⁻¹ ∘ M_a⁻¹ — the
        // walk's own child-inverse step, one level in.
        const grand = childInverse(inverseMaps[b].m, c.mapOffset[b], inv);
        const dChild = orientedBoxSdf(
          grand.m,
          grand.t,
          c.levelBoxes[c.level - 2],
          dimension,
          q,
        );
        if (dChild < refined) refined = dChild;
      }
      term = refined;
    }
    if (term < result) result = term;
  }
  return result === Infinity ? 1e30 : safety(result);
}

/** The per-map inverses `{m⁻¹, −m⁻¹t}` in f64 — the walk's node prune, the
 * display's oriented-box facets and the GPU wire all read these ONE
 * values (the kernel bakes them rather than inverting in f32). */
export function finiteSolidGeneralInverseMaps(
  c: Pick<FiniteSolidGeneralConstruction, "mapMatrix" | "mapOffset">,
): Array<{ m: number[]; t: Vec4 }> {
  return c.mapMatrix.map((m, i) => inverseAffine(m, c.mapOffset[i]));
}

/** The composed child inverse `(parent ∘ M_a)⁻¹ = M_a⁻¹ ∘ parent⁻¹`:
 * `{invM_a·parentInvM, invM_a·(parentInvT − t_a)}` — the walk's node step,
 * shared so the display's grandchild boxes and the DFS round alike. */
function childInverse(
  invMapM: readonly number[],
  mapT: Vec4,
  parent: { m: readonly number[]; t: Vec4 },
): { m: number[]; t: Vec4 } {
  const d: Vec4 = [
    parent.t[0] - mapT[0],
    parent.t[1] - mapT[1],
    parent.t[2] - mapT[2],
    parent.t[3] - mapT[3],
  ];
  return {
    m: multiplyMatrix4(invMapM, parent.m),
    t: applyMatrix4(invMapM, d),
  };
}

/** The display hybrid's per-branch refine margin:
 * FINITE_SOLID_DISPLAY_REFINE_REL of the branch box's largest WORLD half
 * extent — the image parallelepiped's half-edge `half_i·|M_a e_i|` along
 * each pre-image axis (the shipped constant's role, per box; the pre-image
 * box's own extents would over-refine every contracting branch). */
export function finiteSolidGeneralRefineTau(
  c: Pick<
    FiniteSolidGeneralConstruction,
    "dimension" | "level" | "mapMatrix" | "levelBoxes"
  >,
): number[] {
  if (c.level < 2) return c.mapMatrix.map(() => 0);
  const box = c.levelBoxes[c.level - 1];
  return c.mapMatrix.map((m) => {
    let reach = 0;
    for (let axis = 0; axis < c.dimension; axis++) {
      const half = (box.max[axis] - box.min[axis]) / 2;
      const column = Math.hypot(
        m[axis],
        m[4 + axis],
        m[8 + axis],
        c.dimension === 4 ? m[12 + axis] : 0,
      );
      reach = Math.max(reach, half * column);
    }
    return FINITE_SOLID_DISPLAY_REFINE_REL * reach;
  });
}

/** The general construction's marching ball: the farthest corner of
 * `levelBoxes[level]`, which contains the whole level union by
 * construction. NOT the root simplex's vertices: a derived root is not
 * invariant, so a level-N cell can reach outside it. The norm is monotone
 * in each |coordinate|, so the maximizing corner takes each axis's larger
 * magnitude — exact for the box. */
export function finiteSolidGeneralBoundingRadius(
  c: Pick<FiniteSolidGeneralConstruction, "dimension" | "level" | "levelBoxes">,
): number {
  const box = c.levelBoxes[c.level];
  let sum = 0;
  for (let axis = 0; axis < c.dimension; axis++) {
    const reach = Math.max(Math.abs(box.min[axis]), Math.abs(box.max[axis]));
    sum += reach * reach;
  }
  return Math.sqrt(sum);
}

/** The material's own scale H (Beer distance and slab lengths): the
 * largest half extent of `levelBoxes[level]` — the box the whole union
 * sits in, the role the shipped construction's 0.75 plays. */
export function finiteSolidGeneralOpticsRadius(
  c: Pick<FiniteSolidGeneralConstruction, "dimension" | "level" | "levelBoxes">,
): number {
  const box = c.levelBoxes[c.level];
  let half = 0;
  for (let axis = 0; axis < c.dimension; axis++) {
    half = Math.max(half, (box.max[axis] - box.min[axis]) / 2);
  }
  return half;
}

/** Closed point membership in the level union — the primary ray's
 * ray-side state (a point on a shared face reads inside; the boundary
 * group's half-open sweep resolves the event either way). */
export function finiteSolidGeneralContains(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  p: Vec3,
): boolean {
  return (
    finiteSolidGeneralMediumAt(c, pose, p).medium !== FINITE_SOLID_MEDIUM_AIR
  );
}

/** The medium owning a point, and its owning branch (-1 in air): the
 * covering branches by closed membership — the same pruned DFS as the
 * walk, a node skipped when the point lies outside its word-image of the
 * level box, a leaf tested against its own facets — then the owner rule
 * (`generalMediumOf`). The camera's claim and the hit's slot attribution
 * both read this. */
export function finiteSolidGeneralMediumAt(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  p: Vec3,
  media?: FiniteSolidGeneralMedia,
): { medium: number; branch: number } {
  const q = finiteSolidIntrinsicPoint(pose, p);
  const dimension = c.dimension;
  const covered = new Array<number>(c.mapCount).fill(0);
  const inside = (facets: readonly GeneralFacet[] | null): boolean =>
    facets !== null &&
    facets.every((facet) => dotIntrinsic(facet.n, q, dimension) - facet.c <= 0);
  if (c.level === 0) {
    if (inside(facetsFromVertices(c.rootVertices, dimension))) covered[0] = 1;
    return generalMediumOf(covered, media);
  }
  const inBox = (box: { min: Vec4; max: Vec4 }, point: Vec4): boolean => {
    for (let axis = 0; axis < dimension; axis++) {
      if (point[axis] < box.min[axis] || point[axis] > box.max[axis]) {
        return false;
      }
    }
    return true;
  };
  if (!inBox(c.levelBoxes[c.level], q)) return generalMediumOf(covered, media);
  const inverseMaps = finiteSolidGeneralInverseMaps(c);
  // Whether some leaf of the subtree below this node contains the point.
  const walk = (
    matrix: number[],
    offset: Vec4,
    inv: { m: number[]; t: Vec4 },
    depth: number,
  ): boolean => {
    for (let a = 0; a < c.mapCount; a++) {
      const step = composeWordStep(matrix, offset, {
        matrix: c.mapMatrix[a],
        offset: c.mapOffset[a],
      });
      const child = childInverse(inverseMaps[a].m, c.mapOffset[a], inv);
      const childDepth = depth + 1;
      if (childDepth < c.level) {
        const local = applyMatrix4(child.m, q);
        for (let axis = 0; axis < 4; axis++) local[axis] += child.t[axis];
        if (!inBox(c.levelBoxes[c.level - childDepth], local)) continue;
        if (walk(step.matrix, step.offset, child, childDepth)) return true;
        continue;
      }
      const vertices = c.rootVertices.map((v) => {
        const image = applyMatrix4(step.matrix, v);
        return [
          image[0] + step.offset[0],
          image[1] + step.offset[1],
          image[2] + step.offset[2],
          image[3] + step.offset[3],
        ] as Vec4;
      });
      if (inside(facetsFromVertices(vertices, dimension))) return true;
    }
    return false;
  };
  // One walk per BRANCH (the branch's own subtree, prefix = its map), so
  // the owner rule sees every covering branch.
  for (let a = 0; a < c.mapCount; a++) {
    const root = composeWordStep(identityMatrix4(), [0, 0, 0, 0], {
      matrix: c.mapMatrix[a],
      offset: c.mapOffset[a],
    });
    const rootInv = childInverse(inverseMaps[a].m, c.mapOffset[a], {
      m: identityMatrix4(),
      t: [0, 0, 0, 0],
    });
    if (c.level === 1) {
      const vertices = c.rootVertices.map((v) => {
        const image = applyMatrix4(root.matrix, v);
        return [
          image[0] + root.offset[0],
          image[1] + root.offset[1],
          image[2] + root.offset[2],
          image[3] + root.offset[3],
        ] as Vec4;
      });
      if (inside(facetsFromVertices(vertices, dimension))) covered[a] = 1;
      continue;
    }
    const local = applyMatrix4(rootInv.m, q);
    for (let axis = 0; axis < 4; axis++) local[axis] += rootInv.t[axis];
    if (!inBox(c.levelBoxes[c.level - 1], local)) continue;
    if (walk(root.matrix, root.offset, rootInv, 1)) covered[a] = 1;
  }
  return generalMediumOf(covered, media);
}

// ---------------------------------------------------------------------------
// The admission.
// ---------------------------------------------------------------------------

/** One map's fixed point: solve `(I − M)·p = t` — the contraction
 * guarantees the system is non-singular. */
function mapFixedPoint(map: GeneralMap, dimension: 3 | 4): Vec4 | null {
  const a: number[] = [];
  const rhs: number[] = [];
  for (let r = 0; r < dimension; r++) {
    for (let col = 0; col < dimension; col++) {
      a.push((r === col ? 1 : 0) - map.matrix[r * 4 + col]);
    }
    rhs.push(map.offset[r]);
  }
  const x = solveLinear(a, rhs, dimension);
  if (!x || !x.every(Number.isFinite)) return null;
  return [x[0], x[1], x[2], dimension === 4 ? x[3] : 0];
}

/** The affine span of the fixed points: Gram-Schmidt over the difference
 * vectors in map order, a vector dependent when its residual after
 * projecting out the accepted basis falls below 1e-9 of its own norm. */
function affineRank(points: readonly Vec4[], dimension: 3 | 4): number {
  const basis: Vec4[] = [];
  for (let i = 1; i < points.length && basis.length < dimension; i++) {
    const raw: Vec4 = [
      points[i][0] - points[0][0],
      points[i][1] - points[0][1],
      points[i][2] - points[0][2],
      dimension === 4 ? points[i][3] - points[0][3] : 0,
    ];
    const norm = Math.hypot(
      raw[0],
      raw[1],
      raw[2],
      dimension === 4 ? raw[3] : 0,
    );
    if (!(norm > 0)) continue;
    const vector: Vec4 = [...raw];
    for (const unit of basis) {
      const projection = dotIntrinsic(vector, unit, dimension);
      for (let axis = 0; axis < 4; axis++) {
        vector[axis] -= projection * unit[axis];
      }
    }
    const residual = Math.hypot(
      vector[0],
      vector[1],
      vector[2],
      dimension === 4 ? vector[3] : 0,
    );
    if (residual / norm > 1e-9) {
      basis.push([
        vector[0] / residual,
        vector[1] / residual,
        vector[2] / residual,
        dimension === 4 ? vector[3] / residual : 0,
      ]);
    }
  }
  return basis.length;
}

/** The canonical unit directions of a regular `dimension`-simplex: the
 * Householder reflection carrying 𝟙/√(dim+1) onto e₀ maps the standard
 * simplex's vertices `e_k − 𝟙/(dim+1)` (which live in the hyperplane
 * 𝟙^⊥) into R^dimension; the images are pairwise at −1/dimension dot by
 * construction, and the reflection is a fixed closed formula — no basis
 * choice, canonical for every caller. */
function canonicalSimplexDirections(dimension: 3 | 4): Vec4[] {
  const n = dimension + 1;
  const s = Math.sqrt(n);
  const wLen2 = 2 - 2 / s;
  const dirs: Vec4[] = [];
  for (let k = 0; k < n; k++) {
    const d: number[] = new Array<number>(n).fill(-1 / n);
    d[k] += 1;
    // w = 𝟙/√n − e₀; w·d_k = −d_k[0] (the hyperplane points are
    // orthogonal to 𝟙); H d_k = d_k − 2(w·d_k)w/|w|².
    const wDotD = -d[0];
    const image: number[] = [];
    for (let j = 1; j < n; j++) {
      const wj = 1 / s;
      image.push(d[j] - ((2 * wDotD) / wLen2) * wj);
    }
    const scale = Math.sqrt(n / dimension);
    dirs.push([
      image[0] * scale,
      image[1] * scale,
      image[2] * scale,
      dimension === 4 ? image[3] * scale : 0,
    ]);
  }
  return dirs;
}

/** Compose the document's active maps through the shared affine twins —
 * including an authored post-affine, which a post-composed map still
 * carries as a bare affine — and keep the ones the simplicial tree
 * certifies: pure affine structure (the shipped structural refusals),
 * CONTRACTING by the largest singular value, and non-degenerate. */
function collectSimplicialFiniteSolidMaps(
  active: readonly Transform[],
  dimension: 3 | 4,
  reasons: string[],
): GeneralMap[] | null {
  const maps: GeneralMap[] = [];
  for (const transform of active) {
    if (transform.variations && transform.variations.length > 0) {
      reasons.push(
        `map ${transform.id + 1} carries variations; the glass solid is the bare affine contraction tree`,
      );
      return null;
    }
    if (transform.emitter) {
      reasons.push(
        `map ${transform.id + 1} carries an emitter; the glass solid is the bare affine contraction tree`,
      );
      return null;
    }
    if (transform.chaos) {
      reasons.push(
        `map ${transform.id + 1} carries a chaos row; the glass solid has no graph-directed selection`,
      );
      return null;
    }
    let matrix: number[];
    let offset: Vec4;
    if (transform.w) {
      const lifted = toTransform4(transform);
      const a4 = composeAffine4(lifted);
      // A post-composed map is still affine: the authored post rides the
      // composition (the engine applies it after the map's own affine).
      const composed = lifted.post4
        ? composeLinearAffine4(lifted.post4.m, a4)
        : a4;
      matrix = composed.m;
      offset = composed.t;
    } else {
      const a = composeAffine(transform);
      const composed = transform.post
        ? composeLinearAffine(transform.post.m, a)
        : a;
      matrix = embed3Matrix(composed.m);
      offset = [composed.t[0], composed.t[1], composed.t[2], 0];
    }
    const sigmas =
      dimension === 3
        ? singularValues3([
            matrix[0],
            matrix[1],
            matrix[2],
            matrix[4],
            matrix[5],
            matrix[6],
            matrix[8],
            matrix[9],
            matrix[10],
          ])
        : singularValues4(matrix);
    if (!(sigmas.max < 1)) {
      reasons.push(
        `map ${transform.id + 1} does not contract (largest singular value ${sigmas.max}); the glass solid needs every map to shrink`,
      );
      return null;
    }
    if (!(sigmas.min > MAP_TOL)) {
      reasons.push(
        `map ${transform.id + 1} collapses a direction (smallest singular value ${sigmas.min}); a collapsed cell is not a solid`,
      );
      return null;
    }
    maps.push({ matrix, offset });
  }
  return maps;
}

/**
 * The simplicial admission: classify the document's transform system as a
 * simplicial word-tree glass solid at an authored level, or return every
 * reason it is not. Pure; the routing layer layers its own combination
 * refusals (tiling, shape trap, session balloon) on top, the way
 * `surfaceClosedSolidAdmitted` does for the estimator backend.
 */
export function analyzeFiniteSolidGeneral(
  transforms: readonly Transform[],
  finalTransform: Transform | null,
  symmetry: SymmetryParams,
  level: number,
  dimension: 3 | 4,
): FiniteSolidGeneralAnalysis {
  if (
    !Number.isInteger(level) ||
    level < 0 ||
    level > FINITE_SOLID_GENERAL_MAX_LEVEL
  ) {
    return {
      status: "ineligible",
      reasons: [
        `finite-solid level ${level} is outside the certified band 0..${FINITE_SOLID_GENERAL_MAX_LEVEL}`,
      ],
    };
  }
  const active = transforms.filter((t) => (t.weight ?? 1) > 0);
  const reasons: string[] = [];
  if (active.length < 1 || active.length > FINITE_SOLID_GENERAL_MAX_MAPS) {
    reasons.push(
      `the word-tree construction carries 1..${FINITE_SOLID_GENERAL_MAX_MAPS} active maps; this document has ${active.length}`,
    );
    return { status: "ineligible", reasons };
  }
  if (symmetry.order > 1) {
    reasons.push(
      "the kaleidoscope does not compose with a finite cell decomposition (the cells are the un-symmetrized set)",
    );
    return { status: "ineligible", reasons };
  }
  if (finalTransform && !isIdentityAffine(composeAffine(finalTransform))) {
    reasons.push(
      "the final transform warps the cell decomposition (only an untouched identity lens composes)",
    );
    return { status: "ineligible", reasons };
  }
  const maps = collectSimplicialFiniteSolidMaps(active, dimension, reasons);
  if (!maps) {
    return { status: "ineligible", reasons };
  }
  // The fixed points: (I − M)·p = t per map.
  const fixed: Vec4[] = [];
  for (let i = 0; i < maps.length; i++) {
    const p = mapFixedPoint(maps[i], dimension);
    if (!p) {
      reasons.push(
        `map ${i + 1}'s fixed point is not finite; the root simplex has no certified vertices`,
      );
      return { status: "ineligible", reasons };
    }
    fixed.push(p);
  }
  // Full dimension: the attractor must span the construction's own space
  // — a flat span has no interior to glass, and the simplex root would be
  // degenerate.
  if (affineRank(fixed, dimension) < dimension) {
    reasons.push(
      `the maps' fixed points span only ${affineRank(fixed, dimension)} of ${dimension} dimensions; the attractor is flat there and has no solid to glass`,
    );
    return { status: "ineligible", reasons };
  }
  // The root simplex: the fixed points' own hull when it is one simplex and
  // INVARIANT (the tight root — the gasket's own hull — invariance implies
  // containment of the attractor), else the canonical derived bounding
  // simplex built around the INVARIANT BOX. The fallback is measured, not
  // speculative: the viewer's own default system (three of four maps rotate)
  // sends a vertex image ~0.5 outside its fixed points' hull, a 4000-restart
  // search found NO invariant tetrahedron for it, and the bead's
  // "root invariance" admission filter would therefore refuse the very
  // documents the arc must render. The derived root drops the invariance
  // REQUIREMENT entirely: soundness rides the level bounding boxes below
  // (`U_k ⊆ levelBoxes[k]` by construction), so the cells stay simplices and
  // the pruning stays exact for every contracting family.
  let rootVertices: Vec4[];
  let rootKind: "hull" | "derived";
  let hullEligible = false;
  if (fixed.length === dimension + 1) {
    const hullFacets = facetsFromVertices(fixed, dimension);
    const tolerance = 1e-9 * generalCellRadius(fixed, dimension);
    hullEligible = hullFacets !== null;
    for (let i = 0; hullEligible && i < maps.length; i++) {
      for (const vertex of fixed) {
        const image = applyMatrix4(maps[i].matrix, vertex);
        for (let axis = 0; axis < 4; axis++) {
          image[axis] += maps[i].offset[axis];
        }
        for (let k = 0; k < hullFacets!.length; k++) {
          const s =
            dotIntrinsic(hullFacets![k].n, image, dimension) - hullFacets![k].c;
          if (s > tolerance) {
            hullEligible = false;
            break;
          }
        }
      }
    }
  }
  if (hullEligible) {
    rootVertices = fixed.slice();
    rootKind = "hull";
  } else {
    // The derived bounding simplex: a regular simplex around the INVARIANT
    // axis box — the bbox fixed point of the Hutchinson iteration — whose
    // inscribed ball contains that box exactly (inradius = circumradius /
    // dimension). The attractor lies in the box, hence in the simplex, so
    // every level union converges to it from outside.
    const invariantBox = invariantAxisBox(maps, fixed, dimension);
    const centre: Vec4 = [0, 0, 0, 0];
    let halfDiagonal = 0;
    for (let axis = 0; axis < dimension; axis++) {
      centre[axis] = (invariantBox.min[axis] + invariantBox.max[axis]) / 2;
      const half = (invariantBox.max[axis] - invariantBox.min[axis]) / 2;
      halfDiagonal += half * half;
    }
    halfDiagonal = Math.sqrt(halfDiagonal);
    const directions = canonicalSimplexDirections(dimension);
    const circumradius = dimension * halfDiagonal;
    rootVertices = directions.map(
      (u) =>
        [
          centre[0] + circumradius * u[0],
          centre[1] + circumradius * u[1],
          centre[2] + circumradius * u[2],
          dimension === 4 ? centre[3] + circumradius * u[3] : 0,
        ] as Vec4,
    );
    rootKind = "derived";
  }
  const rootFacets = facetsFromVertices(rootVertices, dimension);
  if (!rootFacets) {
    reasons.push(
      "the root simplex is degenerate; the admission cannot certify its facets",
    );
    return { status: "ineligible", reasons };
  }
  const levelBoxes = levelBoxesFor(
    dimension,
    level,
    maps.map((m) => m.matrix),
    maps.map((m) => m.offset),
    rootVertices,
  );
  return {
    status: "eligible",
    reasons: [],
    construction: {
      dimension,
      level,
      mapMatrix: maps.map((m) => m.matrix),
      mapOffset: maps.map((m) => m.offset),
      mapCount: maps.length,
      rootVertices,
      rootKind,
      levelBoxes,
    },
  };
}
