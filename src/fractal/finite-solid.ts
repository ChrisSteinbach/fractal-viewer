import { composeAffine, isIdentityAffine } from "./affine";
import { composeAffine4, toTransform4 } from "./affine4";
import { hyperMengerSpongeTransforms, mengerSponge } from "./presets";
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
 * THE LEVEL IS AUTHORED, 0..2 (`FINITE_SOLID_MAX_LEVEL`, the proxy's
 * certified band): level 0 the root box, level 1 the 20/48 cells, level 2
 * the 400/2,304-cell study construction. Deeper levels were measured too
 * costly for full-size transport (the study's depth-three finding); the
 * refusal states that rather than silently clamping.
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
  const levelOk =
    typeof level === "number" &&
    Number.isInteger(level) &&
    level >= 0 &&
    level <= FINITE_SOLID_MAX_LEVEL;
  if (!levelOk) {
    reasons.push(
      `the finite-solid level must be an integer in 0..${FINITE_SOLID_MAX_LEVEL}`,
    );
  }
  const shapeKey = "shape" in authored ? authored.shape : undefined;
  const shape: FiniteSolidShape | null =
    shapeKey === "menger" || shapeKey === "hyperMenger" ? shapeKey : null;
  if (shapeKey !== undefined && shape === null) {
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
      shape === null
        ? { kind: "general", level }
        : { kind: "shaped", shape, level },
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
// axis-aligned diagonal contractions; no shared grid exists, so the
// construction is the WORD TREE: the level-N images of the root box under
// the document's maps, every word occupied. The holes are the complement
// BETWEEN cells, not a carved rule.
//
// Disclosed limits of this first lift (each with its admission reason):
// - the maps must compose DIAGONAL affines (no rotation or shear): a
//   rotated map's cell is an oriented box, and the axis-aligned slab,
//   interval and anchor machinery below is the certified v1. The
//   oriented-frame lift is its own follow-up inside the
//   general-construction work, not a silent widening;
// - the maps must CONTRACT (|scale| < 1 on every displayed axis) and keep
//   the root box INVARIANT. The root is the maps' fixed points' bounding
//   box; a map that pushes the box's boundary outside itself breaks the
//   nested level structure the glass displays;
// - adjacency is decided at the declared coordinate envelope. Two cell
//   faces that coincide as reals may differ in the last ulp through
//   different word compositions, and interval endpoints within
//   FINITE_SOLID_GENERAL_TIE_REL merge — a gap below the construction's
//   declared resolution is unrepresentable on the f32 wire the transport
//   rides. The shipped grid path stays exact because its shared planes
//   come from ONE formula, which is why the shipped shapes keep the
//   shipped construction byte for byte and this path serves shape-less
//   documents;
// - the query enumerates the level-N leaves (K^level clips per query —
//   the same order as the shipped interval union's 400/2,304-cell
//   enumeration). This is the f64 REFERENCE; the production walk prunes.
// ---------------------------------------------------------------------------

/** The word-tree construction's map cap — the shipped 4D construction's
 * own map count, so the general path admits at least everything the
 * shipped one does. */
export const FINITE_SOLID_GENERAL_MAX_MAPS = 48;

/** Adjacency's declared resolution: interval endpoints within this
 * relative distance are ONE boundary (the anchor reconstruction's
 * coordinate envelope, promoted from a restart allowance to the
 * construction's declared resolution). A genuine gap below it is
 * unrepresentable on the f32 wire the transport rides. */
export const FINITE_SOLID_GENERAL_TIE_REL = 2 * 2 ** -23;

/** The general construction: cells are the level-`level` images of the
 * root box under the document's own maps. Diagonal per-axis signed scales
 * (reflections keep cells axis-aligned); the 4th slots carry the 4D w
 * axis and are 1/0 in 3D. */
export interface FiniteSolidGeneralConstruction {
  dimension: 3 | 4;
  level: number;
  mapScale: Vec4[];
  mapOffset: Vec4[];
  mapCount: number;
  /** The maps' fixed points' bounding box, verified invariant under every
   * map at admission. */
  rootMin: Vec4;
  rootMax: Vec4;
}

export interface FiniteSolidGeneralAnalysis {
  status: "eligible" | "ineligible";
  reasons: string[];
  construction?: FiniteSolidGeneralConstruction;
}

/** One composed map's diagonal form: signed per-axis scale and offset. */
interface GeneralMap {
  scale: Vec4;
  offset: Vec4;
}

/** Compose the document's active maps through the shared affine twins and
 * keep the ones the word-tree construction certifies: pure affine (the
 * shipped structural refusals), DIAGONAL (an oriented cell frame is the
 * oriented-frame lift, refused here with its reason), contracting on
 * every displayed axis, and non-degenerate. */
function collectGeneralFiniteSolidMaps(
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
    if (transform.post && !isIdentityAffine(transform.post)) {
      reasons.push(
        `map ${transform.id + 1} carries a post-affine; the glass solid is the bare affine contraction tree`,
      );
      return null;
    }
    let m: readonly number[];
    let t: Vec4;
    if (transform.w) {
      const lifted = toTransform4(transform);
      if (lifted.post4) {
        reasons.push(
          `map ${transform.id + 1} carries a 4D post-affine; the glass solid is the bare affine contraction tree`,
        );
        return null;
      }
      const a4 = composeAffine4(lifted);
      m = a4.m;
      t = a4.t;
    } else {
      const a = composeAffine(transform);
      m = a.m;
      t = [a.t[0], a.t[1], a.t[2], 0];
    }
    const size = dimension;
    const scale = [1, 1, 1, 1] as Vec4;
    const offset = [0, 0, 0, 0] as Vec4;
    for (let axis = 0; axis < size; axis++) {
      scale[axis] = m[axis * size + axis];
      offset[axis] = t[axis];
      for (let col = 0; col < size; col++) {
        if (col === axis) continue;
        if (Math.abs(m[axis * size + col]) > MAP_TOL) {
          reasons.push(
            `map ${transform.id + 1} rotates or shears (off-diagonal ${m[axis * size + col]} on axis ${axis}); the axis-aligned construction refuses it until the oriented-frame lift`,
          );
          return null;
        }
      }
      if (!(Math.abs(scale[axis]) < 1)) {
        reasons.push(
          `map ${transform.id + 1} does not contract on axis ${axis} (scale ${scale[axis]}); the glass solid needs every map to shrink`,
        );
        return null;
      }
      if (Math.abs(scale[axis]) <= MAP_TOL) {
        reasons.push(
          `map ${transform.id + 1} degenerates on axis ${axis} (scale ${scale[axis]}); a collapsed cell is not a solid`,
        );
        return null;
      }
    }
    maps.push({ scale, offset });
  }
  return maps;
}

/** The general admission: the document's own maps as a word-tree glass
 * solid. The structural refusals match the shipped construction's (pure
 * affine, order-1 symmetry, identity lens); the numeric checks are the
 * general ones — contraction, diagonal composition, root invariance. */
export function analyzeFiniteSolidGeneral(
  transforms: readonly Transform[],
  finalTransform: Transform | null,
  symmetry: SymmetryParams,
  level: number,
  dimension: 3 | 4,
): FiniteSolidGeneralAnalysis {
  if (!Number.isInteger(level) || level < 0 || level > FINITE_SOLID_MAX_LEVEL) {
    return {
      status: "ineligible",
      reasons: [
        `finite-solid level ${level} is outside the certified band 0..${FINITE_SOLID_MAX_LEVEL}`,
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
  const maps = collectGeneralFiniteSolidMaps(active, dimension, reasons);
  if (!maps) {
    return { status: "ineligible", reasons };
  }
  // The root box: the maps' fixed points' bounding box. For a diagonal
  // contraction x -> s·x + t the fixed point is t / (1 - s).
  const rootMin = [0, 0, 0, 0] as Vec4;
  const rootMax = [0, 0, 0, 0] as Vec4;
  for (let axis = 0; axis < dimension; axis++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const map of maps) {
      const fixed = map.offset[axis] / (1 - map.scale[axis]);
      if (!Number.isFinite(fixed)) {
        reasons.push(
          `map fixed point on axis ${axis} is not finite; the root box has no certified extent`,
        );
        return { status: "ineligible", reasons };
      }
      lo = Math.min(lo, fixed);
      hi = Math.max(hi, fixed);
    }
    rootMin[axis] = lo;
    rootMax[axis] = hi;
  }
  // Invariance: every map keeps the root box inside itself, so the level
  // images nest and the glass reads as one recursive solid. A violation
  // beyond the round-trip tolerance refuses (never clamps).
  for (let i = 0; i < maps.length; i++) {
    const map = maps[i];
    for (let axis = 0; axis < dimension; axis++) {
      const s = map.scale[axis];
      const o = map.offset[axis];
      const lo = o + s * rootMin[axis];
      const hi = o + s * rootMax[axis];
      if (Math.min(lo, hi) < rootMin[axis] - MAP_TOL) {
        reasons.push(
          `map ${i + 1} pushes the root box ${Math.min(lo, hi) - rootMin[axis]} below its lower bound on axis ${axis}; the level images do not nest`,
        );
        return { status: "ineligible", reasons };
      }
      if (Math.max(lo, hi) > rootMax[axis] + MAP_TOL) {
        reasons.push(
          `map ${i + 1} pushes the root box ${Math.max(lo, hi) - rootMax[axis]} above its upper bound on axis ${axis}; the level images do not nest`,
        );
        return { status: "ineligible", reasons };
      }
    }
  }
  return {
    status: "eligible",
    reasons: [],
    construction: {
      dimension,
      level,
      mapScale: maps.map((m) => m.scale),
      mapOffset: maps.map((m) => m.offset),
      mapCount: maps.length,
      rootMin,
      rootMax,
    },
  };
}

/** One leaf's clip: the word's box against the intrinsic ray, with the
 * binding axes at each end (the atomic-event candidates). */
interface GeneralLeafInterval {
  enter: number;
  exit: number;
  enterAxes: number[];
  exitAxes: number[];
  /** The word's map indices, depth = level entries. */
  word: number[];
}

function clipGeneralLeaf(
  c: FiniteSolidGeneralConstruction,
  word: number[],
  scale: Vec4,
  offset: Vec4,
  q: Vec4,
  qd: Vec4,
): GeneralLeafInterval | null {
  let enter = -Infinity;
  let exit = Infinity;
  let enterAxes: number[] = [];
  let exitAxes: number[] = [];
  for (let axis = 0; axis < c.dimension; axis++) {
    const s = scale[axis];
    const lo0 = offset[axis] + s * c.rootMin[axis];
    const hi0 = offset[axis] + s * c.rootMax[axis];
    const lo = Math.min(lo0, hi0);
    const hi = Math.max(lo0, hi0);
    const d = qd[axis];
    if (d === 0) {
      if (q[axis] < lo || q[axis] > hi) return null;
      continue;
    }
    const ta = (lo - q[axis]) / d;
    const tb = (hi - q[axis]) / d;
    const near = Math.min(ta, tb);
    const far = Math.max(ta, tb);
    if (near > enter) {
      enter = near;
      enterAxes = [axis];
    } else if (near === enter) {
      enterAxes.push(axis);
    }
    if (far < exit) {
      exit = far;
      exitAxes = [axis];
    } else if (far === exit) {
      exitAxes.push(axis);
    }
  }
  if (!(exit > enter)) return null;
  return { enter, exit, enterAxes, exitAxes, word };
}

/** Every level-N leaf's interval against the intrinsic ray, word attached.
 * K^level entries — the reference enumeration the production walk prunes. */
function enumerateGeneralLeaves(
  c: FiniteSolidGeneralConstruction,
  q: Vec4,
  qd: Vec4,
): GeneralLeafInterval[] {
  const leaves: GeneralLeafInterval[] = [];
  const scale: Vec4 = [1, 1, 1, 1];
  const offset: Vec4 = [0, 0, 0, 0];
  const word: number[] = [];
  const walk = (depth: number): void => {
    if (depth === c.level) {
      const leaf = clipGeneralLeaf(c, [...word], scale, offset, q, qd);
      if (leaf) leaves.push(leaf);
      return;
    }
    for (let a = 0; a < c.mapCount; a++) {
      const s = c.mapScale[a];
      const t = c.mapOffset[a];
      for (let axis = 0; axis < 4; axis++) {
        offset[axis] += scale[axis] * t[axis];
        scale[axis] *= s[axis];
      }
      word.push(a);
      walk(depth + 1);
      word.pop();
      for (let axis = 0; axis < 4; axis++) {
        scale[axis] /= s[axis];
        offset[axis] -= scale[axis] * t[axis];
      }
    }
  };
  walk(0);
  return leaves;
}

function generalTieAbs(t: number): number {
  return FINITE_SOLID_GENERAL_TIE_REL * Math.max(1, Math.abs(t));
}

/** The word's box (axis-aligned in intrinsic space) as center + per-axis
 * half, for membership clamps and the display hybrid. */
function generalLeafBox(
  c: FiniteSolidGeneralConstruction,
  word: readonly number[],
): { center: Vec4; half: Vec4 } {
  const scale: Vec4 = [1, 1, 1, 1];
  const offset: Vec4 = [0, 0, 0, 0];
  for (const a of word) {
    const s = c.mapScale[a];
    const t = c.mapOffset[a];
    for (let axis = 0; axis < 4; axis++) {
      offset[axis] += scale[axis] * t[axis];
      scale[axis] *= s[axis];
    }
  }
  const center = [0, 0, 0, 0] as Vec4;
  const half = [0, 0, 0, 0] as Vec4;
  for (let axis = 0; axis < 4; axis++) {
    const lo = offset[axis] + scale[axis] * c.rootMin[axis];
    const hi = offset[axis] + scale[axis] * c.rootMax[axis];
    center[axis] = (lo + hi) / 2;
    half[axis] = Math.abs(hi - lo) / 2;
  }
  return { center, half };
}

/** The exact interval union along the ray: the leaves' intervals merged
 * with the declared-resolution tie (endpoints within the envelope are ONE
 * boundary — a shared face's two sides, computed through different word
 * compositions, must not read as a phantom gap). */
export function finiteSolidGeneralIntervals(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  dir: Vec3,
): Array<{ enter: number; exit: number }> {
  const q = finiteSolidIntrinsicPoint(pose, origin);
  const qd = finiteSolidIntrinsicDirection(pose, dir);
  const leaves = enumerateGeneralLeaves(c, q, qd);
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
}

/** The word-tree boundary query — the shipped DDA's event taxonomy over
 * the document's own cell tree. The medium flips where the leaves'
 * interval union's coverage crosses zero; tied endpoints (a shared face's
 * two sides, or an exact corner across cells) are ONE atomic event with
 * the span-projected normal, so an interior shared face is traversed
 * silently and a genuine gap fires the honest exit/enter pair. */
export function finiteSolidGeneralNextBoundary(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  direction: Vec3,
  options: FiniteSolidNextBoundaryOptions,
): FiniteSolidBoundaryResult {
  if (
    !validGeneralConstruction(c) ||
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
 * origin). The anchor's word names the post-incident cell; the masked
 * axes name the incident faces. */
export function finiteSolidGeneralNextBoundaryFromAnchor(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  direction: Vec3,
  options: { inside: boolean; anchor: FiniteSolidAnchor },
): FiniteSolidBoundaryResult {
  if (!validGeneralConstruction(c) || !validGeneralAnchor(c, options.anchor)) {
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
  });
}

function validGeneralConstruction(c: FiniteSolidGeneralConstruction): boolean {
  return (
    (c.dimension === 3 || c.dimension === 4) &&
    Number.isInteger(c.level) &&
    c.level >= 0 &&
    c.level <= FINITE_SOLID_MAX_LEVEL &&
    Number.isInteger(c.mapCount) &&
    c.mapCount >= 1 &&
    c.mapCount <= FINITE_SOLID_GENERAL_MAX_MAPS &&
    c.mapScale.length === c.mapCount &&
    c.mapOffset.length === c.mapCount &&
    c.rootMin.every(Number.isFinite) &&
    c.rootMax.every(Number.isFinite)
  );
}

/** The anchor's word must name real maps at the construction's depth, and
 * the masked faces must be the leaf box's own sides. */
function validGeneralAnchor(
  c: FiniteSolidGeneralConstruction,
  anchor: FiniteSolidAnchor,
): boolean {
  if (!anchor.intrinsicPoint.every(Number.isFinite)) return false;
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
  let masked = 0;
  for (let axis = 0; axis < 4; axis++) {
    if ((anchor.planeMask & (1 << axis)) === 0) {
      if (anchor.planeIndices[axis] !== -1) return false;
      continue;
    }
    masked++;
    const side = anchor.planeIndices[axis];
    if (axis >= c.dimension) return false;
    if (side !== 0 && side !== 1) return false;
  }
  return masked > 0;
}

/** The anchor's leaf box, from the anchor's word. */
function anchorLeafBox(
  c: FiniteSolidGeneralConstruction,
  anchor: FiniteSolidAnchor,
): { center: Vec4; half: Vec4 } {
  const word: number[] = [];
  for (let slot = 0; slot < c.level; slot++)
    word.push(anchor.cellIndices[slot]);
  return generalLeafBox(c, word);
}

function finiteSolidGeneralNextBoundaryInternal(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  origin: Vec3,
  direction: Vec3,
  options: FiniteSolidNextBoundaryOptions & { anchor?: FiniteSolidAnchor },
): FiniteSolidBoundaryResult {
  const anchor = options.anchor;
  const tMin = options.tMin ?? 0;
  const q = anchor
    ? ([...anchor.intrinsicPoint] as Vec4)
    : finiteSolidIntrinsicPoint(pose, origin);
  const qd = finiteSolidIntrinsicDirection(pose, direction);
  // The anchor's word is authoritative for its own faces: snap the masked
  // coordinates onto the leaf's canonical face planes and clamp the rest
  // into the leaf box under the declared envelope — the shipped
  // reconstruction's discipline, one tree up.
  if (anchor) {
    const box = anchorLeafBox(c, anchor);
    const halfMax = Math.max(
      ...box.half.slice(0, c.dimension).map((h) => Math.abs(h)),
    );
    const envelope = FINITE_SOLID_GENERAL_TIE_REL * halfMax;
    for (let axis = 0; axis < c.dimension; axis++) {
      const lower = box.center[axis] - box.half[axis];
      const upper = box.center[axis] + box.half[axis];
      if ((anchor.planeMask & (1 << axis)) !== 0) {
        q[axis] = anchor.planeIndices[axis] === 0 ? lower : upper;
      } else if (q[axis] < lower) {
        if (lower - q[axis] > envelope) {
          return { kind: "refused", reason: "invalid-input", visits: 0 };
        }
        q[axis] = lower;
      } else if (q[axis] > upper) {
        if (q[axis] - upper > envelope) {
          return { kind: "refused", reason: "invalid-input", visits: 0 };
        }
        q[axis] = upper;
      }
    }
  }
  const leaves = enumerateGeneralLeaves(c, q, qd);
  // Endpoint sweep with the declared-resolution ties: consecutive
  // endpoints within the tie of a group's first endpoint are ONE boundary
  // group. The union's coverage crosses zero exactly at a medium flip; a
  // group with net zero (a shared face's exit tied with the neighbor's
  // entry) is traversed silently.
  const endpoints: Array<{
    t: number;
    delta: number;
    leaf: GeneralLeafInterval;
    axes: number[];
  }> = [];
  for (const leaf of leaves) {
    endpoints.push({ t: leaf.enter, delta: 1, leaf, axes: leaf.enterAxes });
    endpoints.push({ t: leaf.exit, delta: -1, leaf, axes: leaf.exitAxes });
  }
  endpoints.sort((a, b) => a.t - b.t);
  interface GeneralGroup {
    t: number;
    before: number;
    after: number;
    faces: Array<{ leaf: GeneralLeafInterval; axes: number[] }>;
  }
  const groups: GeneralGroup[] = [];
  let coverage = 0;
  let i = 0;
  while (i < endpoints.length) {
    const groupT = endpoints[i].t;
    const tie = generalTieAbs(groupT);
    const faces: Array<{ leaf: GeneralLeafInterval; axes: number[] }> = [];
    let net = 0;
    while (i < endpoints.length && endpoints[i].t - groupT <= tie) {
      net += endpoints[i].delta;
      faces.push({ leaf: endpoints[i].leaf, axes: endpoints[i].axes });
      i++;
    }
    const before = coverage;
    coverage += net;
    groups.push({ t: groupT, before, after: coverage, faces });
  }
  // The state at tMin: the last group at or before it (within that
  // group's tie); its after-coverage owns the point (half-open, the
  // entering side — the shipped ray-side convention).
  let startGroupIndex = -1;
  for (let g = 0; g < groups.length; g++) {
    if (groups[g].t <= tMin + generalTieAbs(groups[g].t)) startGroupIndex = g;
    else break;
  }
  const stateAtStart = startGroupIndex >= 0 ? groups[startGroupIndex].after : 0;
  const mediumInside = options.inside;
  const stateMatches = stateAtStart > 0 === mediumInside;
  const startGroup = startGroupIndex >= 0 ? groups[startGroupIndex] : undefined;
  const atStartGroup =
    startGroup !== undefined &&
    Math.abs(startGroup.t - tMin) <= generalTieAbs(startGroup.t);
  if (!stateMatches) {
    if (anchor || !atStartGroup) {
      // Off a boundary the claim must match the geometry; the anchored
      // continuation is the interior restart and takes no liberty with
      // the claim at all.
      return { kind: "refused", reason: "state-mismatch", visits: 0 };
    }
    // The ray starts ON a boundary group with the claim anticipating the
    // crossing (the display march's primary hit): emit the start event.
    const event = generalBoundaryEvent(
      c,
      pose,
      q,
      qd,
      direction,
      startGroup,
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
  // Walk the groups after the start; the first zero-crossing of the
  // coverage is the next medium flip. A tied group with net zero (an
  // interior shared face) leaves the coverage unchanged and is traversed
  // without an event — the exact behavior the grid DDA gets from its
  // discrete neighbor step.
  let visits = 0;
  for (let g = startGroupIndex + 1; g < groups.length; g++) {
    const group = groups[g];
    visits++;
    const flips =
      (group.before === 0 && group.after > 0) ||
      (group.before > 0 && group.after === 0);
    if (!flips) continue;
    const event = generalBoundaryEvent(
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

/** The boundary event from one tied endpoint group. The entering side is
 * the group's after-coverage (the actual geometry, never the claim); the
 * tied faces' span carries the projected normal; the anchor names the
 * incident leaf (its canonical faces are the restart's snap target). */
function generalBoundaryEvent(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  q: Vec4,
  qd: Vec4,
  direction: Vec3,
  group: {
    t: number;
    before: number;
    after: number;
    faces: Array<{ leaf: GeneralLeafInterval; axes: number[] }>;
  },
  t: number,
  visits: number,
): FiniteSolidBoundary | FiniteSolidRefusal {
  const entering = group.after > 0;
  const crossedAxes = group.faces.flatMap((f) => f.axes);
  const planeMask = crossedAxes.reduce((mask, axis) => mask | (1 << axis), 0);
  const outwardNormal = finiteSolidBoundaryNormal(
    pose,
    c.dimension,
    direction,
    planeMask,
    entering,
  );
  if (!outwardNormal) {
    return { kind: "refused", reason: "degenerate-projected-normal", visits };
  }
  const axis = chooseAxis(crossedAxes, qd);
  const directionSign = qd[axis] > 0 ? 1 : -1;
  const faceSign = (entering ? -directionSign : directionSign) as -1 | 1;
  // The anchor names the INCIDENT leaf — the leaf whose face was crossed
  // (the entered leaf on an entry, the exited leaf on an exit). Its
  // canonical planes are what the anchored restart snaps onto; the
  // half-open sweep from that point suppresses the incident face without
  // a special flag.
  const incident = group.faces[0].leaf;
  const cellIndices: [number, number, number, number] = [-1, -1, -1, -1];
  for (let slot = 0; slot < incident.word.length; slot++) {
    cellIndices[slot] = incident.word[slot];
  }
  // The crossed face's side within the leaf's own box: an entry through a
  // positive-direction ray meets the min face; an exit the max face — and
  // the ray direction flips both.
  const anchorPlanes: [number, number, number, number] = [-1, -1, -1, -1];
  for (const crossedAxis of crossedAxes) {
    anchorPlanes[crossedAxis] = entering !== qd[crossedAxis] > 0 ? 1 : 0;
  }
  const intrinsicPoint = q.map(
    (value, intrinsicAxis) => value + t * qd[intrinsicAxis],
  ) as Vec4;
  // Snap the crossed coordinates onto the incident leaf's canonical face
  // planes; clamp the rest into the leaf box under the declared envelope.
  const box = generalLeafBox(c, incident.word);
  const halfMax = Math.max(
    ...box.half.slice(0, c.dimension).map((h) => Math.abs(h)),
  );
  const envelope = FINITE_SOLID_GENERAL_TIE_REL * halfMax;
  for (const crossedAxis of crossedAxes) {
    intrinsicPoint[crossedAxis] =
      anchorPlanes[crossedAxis] === 0
        ? box.center[crossedAxis] - box.half[crossedAxis]
        : box.center[crossedAxis] + box.half[crossedAxis];
  }
  for (let intrinsicAxis = 0; intrinsicAxis < c.dimension; intrinsicAxis++) {
    if ((planeMask & (1 << intrinsicAxis)) !== 0) continue;
    const lower = box.center[intrinsicAxis] - box.half[intrinsicAxis];
    const upper = box.center[intrinsicAxis] + box.half[intrinsicAxis];
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
    face: { axis, planeIndex: anchorPlanes[axis], level: c.level },
    anchor: {
      intrinsicPoint,
      planeMask,
      planeIndices: anchorPlanes,
      cellIndices,
    },
    visits,
  };
}

/** One box's exact SDF with per-axis extents (the word-tree's cells are
 * boxes, not cubes): positive outside, negative inside, zero on the
 * boundary; inside it is the deepest gap's negation. */
function generalBoxSdf(
  center: Vec4,
  half: Vec4,
  p: Vec4,
  dimension: number,
): number {
  let outsideSquared = 0;
  let inside = -Infinity;
  for (let axis = 0; axis < dimension; axis++) {
    const gap = Math.abs(p[axis] - center[axis]) - half[axis];
    outsideSquared += Math.max(0, gap) ** 2;
    inside = Math.max(inside, gap);
  }
  return Math.sqrt(outsideSquared) + Math.min(0, inside);
}

/**
 * The word-tree display marcher's bounded-work estimate: the certified
 * hybrid of the level-1 boxes and — one level in — the nearest box's
 * children. `finiteSolidDisplayDistance`'s argument carries over verbatim:
 * a box CONTAINS its subtree's part of the union, so its SDF is a lower
 * bound of the distance to that part, and the global nearest union point
 * lives in some box whose term the min cannot overstate — a march step can
 * never skip the surface. The refine-when-close term exists for the same
 * seal hazard the shipped hybrid names: a level-1 box's own faces are its
 * SDF's zero set, and the deeper structure pierces those faces (a gap
 * between children opens exactly at the parent's face), so the plain min
 * would seal every opening at its mouth plane. Refining the nearest box
 * into its K children (all of them — the word tree carves no rule holes)
 * vanishes those zeros on the children's own faces and keeps the bound.
 * Interior shared child faces also read 0; the zero set is NOT only the
 * union's boundary, and this field is not a membership oracle — the
 * transport walks the boundary query above, never this field.
 *
 * Level 1 returns the plain min (the boxes ARE the union); level 0 the
 * root box. The refine margin is relative to the refined box's largest
 * half-extent (the shipped constant's role, per box).
 */
export function finiteSolidGeneralDisplayDistance(
  c: FiniteSolidGeneralConstruction,
  pose: FiniteSolidPose,
  p: Vec3,
): number {
  const q = finiteSolidIntrinsicPoint(pose, p);
  const dimension = c.dimension;
  if (c.level === 0) {
    const center = [0, 0, 0, 0] as Vec4;
    const half = [0, 0, 0, 0] as Vec4;
    for (let axis = 0; axis < 4; axis++) {
      center[axis] = (c.rootMin[axis] + c.rootMax[axis]) / 2;
      half[axis] = Math.abs(c.rootMax[axis] - c.rootMin[axis]) / 2;
    }
    const d = generalBoxSdf(center, half, q, dimension);
    return d > 0 ? d * SHAPE_MARCH_SAFETY : d;
  }
  const childBox = (word: number[]): { center: Vec4; half: Vec4 } =>
    generalLeafBox(c, word);
  let best = Infinity;
  let bestWord: number[] | null = null;
  for (let a = 0; a < c.mapCount; a++) {
    const box = childBox([a]);
    const d = generalBoxSdf(box.center, box.half, q, dimension);
    if (d < best) {
      best = d;
      bestWord = [a];
    }
  }
  if (c.level === 1 || bestWord === null) {
    return best > 0 ? best * SHAPE_MARCH_SAFETY : best;
  }
  // Refine the nearest level-1 box into its children when the estimate is
  // within the margin of that box's own surface.
  const nearestBox = childBox(bestWord);
  const halfMax = Math.max(
    ...nearestBox.half.slice(0, dimension).map((h) => Math.abs(h)),
  );
  if (!(best < FINITE_SOLID_DISPLAY_REFINE_REL * halfMax)) {
    return best > 0 ? best * SHAPE_MARCH_SAFETY : best;
  }
  let refined = Infinity;
  for (let a = 0; a < c.mapCount; a++) {
    const box = childBox([...bestWord, a]);
    const d = generalBoxSdf(box.center, box.half, q, dimension);
    if (d < refined) refined = d;
  }
  const result = Math.min(best, refined);
  return result > 0 ? result * SHAPE_MARCH_SAFETY : result;
}
