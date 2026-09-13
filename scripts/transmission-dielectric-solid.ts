/**
 * Exact finite ternary-cell solids for the dielectric experiment.
 *
 * These are new, closed finite solids rather than membership interpretations
 * of a public fractal distance estimate. The 3D rule is the preset Menger
 * construction. Its native-4D twin keeps a ternary child when at most one of
 * its four coordinates is the middle child. Terminal cells are filled.
 *
 * Boundary traversal uses integer cell occupancy and analytic grid planes.
 * There is no distance epsilon: only numerically equal crossing times tie.
 * Consequently a positive interval represented by the arithmetic is never
 * merged away. CPU f64 and GPU f32 can still classify a ray differently when
 * a crossing lies within their respective rounding resolution of a corner.
 */
import { rotationMatrix4 } from "../src/fractal/affine4";
import type { Vec3 } from "./de-preview";

export type DielectricDimension = 3 | 4;
export type DielectricDepth = 0 | 2 | 3;
export type Vec4 = [number, number, number, number];
export type RotorRows = [Vec4, Vec4, Vec4, Vec4];

export interface DielectricSolidFixture {
  name: string;
  dimension: DielectricDimension;
  depth: DielectricDepth;
  halfExtent: number;
  /** Row-major world/slice -> intrinsic transform. */
  rotorRows: RotorRows;
  /** Displayed affine slice is rotorRows * [x,y,z,slice]. */
  slice: number;
  /** Maximum number of finest-grid cells a boundary query may classify. */
  visitCap: number;
}

export interface DielectricFace {
  axis: number;
  /** Finest-grid plane in [0, 3^depth]. */
  planeIndex: number;
  depth: number;
}

export interface DielectricBoundaryAnchor {
  /** Intrinsic hit with every crossed component snapped to its grid plane. */
  intrinsicPoint: Vec4;
  /** Bit i is set for every axis crossed at the same numeric t. */
  planeMask: number;
  /** Finest-grid plane per masked axis; -1 for an unmasked axis. */
  planeIndices: [number, number, number, number];
}

export interface DielectricBoundary {
  kind: "boundary";
  t: number;
  entering: boolean;
  outwardNormal: Vec3;
  intrinsicAxis: number;
  faceSign: -1 | 1;
  face: DielectricFace;
  anchor: DielectricBoundaryAnchor;
  visits: number;
}

export interface DielectricMiss {
  kind: "miss";
  visits: number;
}

export type DielectricRefusalReason =
  | "visit-cap"
  | "invalid-input"
  | "state-mismatch"
  | "ambiguous-anchor"
  | "nonmonotone-crossing"
  | "degenerate-projected-normal";

export interface DielectricRefusal {
  kind: "refused";
  reason: DielectricRefusalReason;
  visits: number;
}

export type DielectricBoundaryResult =
  DielectricBoundary | DielectricMiss | DielectricRefusal;

export interface NextBoundaryOptions {
  /** Medium ownership immediately after tMin along this ray. */
  inside: boolean;
  tMin?: number;
  /** Only this same face may be suppressed, and only exactly at tMin. */
  previousFace?: DielectricFace;
}

export interface AnchoredBoundaryOptions {
  /** Medium ownership immediately after the anchored boundary. */
  inside: boolean;
  /** Authoritative intrinsic origin returned by the preceding boundary. */
  anchor: DielectricBoundaryAnchor;
}

export interface DielectricCell {
  index: number[];
  center: number[];
  half: number;
}

const IDENTITY_ROWS: RotorRows = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];

export const DIELECTRIC_HALF_EXTENT = 0.75;
export const DIELECTRIC_HYPER_ROTATION = Object.freeze({
  xw: 0.57,
  yw: -0.31,
});
export const DIELECTRIC_HYPER_SLICE = 0.18;

function rowsFromFlat(flat: readonly number[]): RotorRows {
  return [0, 1, 2, 3].map((row) =>
    [0, 1, 2, 3].map((column) => Math.fround(flat[row * 4 + column])),
  ) as RotorRows;
}

/** Frozen f32 rows consumed in this order by both the CPU and GPU contracts. */
export const DIELECTRIC_HYPER_ROTOR_ROWS = rowsFromFlat(
  rotationMatrix4(DIELECTRIC_HYPER_ROTATION),
);

function maximumCellVisits(dimension: DielectricDimension, depth: number) {
  const gridSize = 3 ** depth;
  return dimension * (gridSize - 1) + 1;
}

export function makeDielectricSolidFixture(
  dimension: DielectricDimension,
  depth: DielectricDepth,
): DielectricSolidFixture {
  return {
    name:
      dimension === 3
        ? `CONNECTED FINITE MENGER D${depth}`
        : `CONNECTED FINITE HYPER-MENGER D${depth}`,
    dimension,
    depth,
    halfExtent: DIELECTRIC_HALF_EXTENT,
    rotorRows:
      dimension === 3
        ? (IDENTITY_ROWS.map((row) => [...row]) as RotorRows)
        : (DIELECTRIC_HYPER_ROTOR_ROWS.map((row) => [...row]) as RotorRows),
    slice: dimension === 3 ? 0 : DIELECTRIC_HYPER_SLICE,
    visitCap: maximumCellVisits(dimension, depth),
  };
}

export const DIELECTRIC_SOLID_FIXTURES = Object.freeze({
  mengerD0: makeDielectricSolidFixture(3, 0),
  mengerD2: makeDielectricSolidFixture(3, 2),
  mengerD3: makeDielectricSolidFixture(3, 3),
  hyperMengerD0: makeDielectricSolidFixture(4, 0),
  hyperMengerD2: makeDielectricSolidFixture(4, 2),
  hyperMengerD3: makeDielectricSolidFixture(4, 3),
});

/** Fixed scalar rays for CPU/WGSL boundary-table agreement. */
export const DIELECTRIC_GEOMETRY_CONTROL_RAYS = Object.freeze([
  {
    name: "box-axis-3d",
    fixture: "mengerD0" as const,
    origin: [0.17, 0.11, 2] as Vec3,
    direction: [0, 0, -1] as Vec3,
    inside: false,
  },
  {
    name: "box-oblique-3d",
    fixture: "mengerD0" as const,
    origin: [1.8, 0.21, 0.13] as Vec3,
    direction: [-1, 0.04, -0.03] as Vec3,
    inside: false,
  },
  {
    name: "menger-crossings-3d",
    fixture: "mengerD2" as const,
    origin: [2, 0, 0.6] as Vec3,
    direction: [-1, 0, 0] as Vec3,
    inside: false,
  },
  {
    name: "hyper-menger-crossings-4d",
    fixture: "hyperMengerD2" as const,
    origin: [0.18, 0, 2] as Vec3,
    direction: [0.04, -0.025, -1] as Vec3,
    inside: false,
  },
]);

export const DIELECTRIC_TRANSPORT_CONTROL_INPUTS = Object.freeze({
  iorIdentity: {
    incident: [0.5, 0, -Math.sqrt(0.75)] as Vec3,
    outwardNormal: [0, 0, 1] as Vec3,
    fromIor: 1,
    toIor: 1,
  },
  airToGlass30Degrees: {
    incident: [0.5, 0, -Math.sqrt(0.75)] as Vec3,
    outwardNormal: [0, 0, 1] as Vec3,
    fromIor: 1,
    toIor: 1.5,
  },
  glassToAirTir50Degrees: {
    incident: [
      Math.sin((50 * Math.PI) / 180),
      0,
      Math.cos((50 * Math.PI) / 180),
    ] as Vec3,
    outwardNormal: [0, 0, 1] as Vec3,
    fromIor: 1.5,
    toIor: 1,
  },
  beer: { absorptionPerRadius: 0.8, distance: 0.5, radius: 1.5 },
});

function validFixture(fixture: DielectricSolidFixture): boolean {
  return (
    (fixture.dimension === 3 || fixture.dimension === 4) &&
    (fixture.depth === 0 || fixture.depth === 2 || fixture.depth === 3) &&
    Number.isFinite(fixture.halfExtent) &&
    fixture.halfExtent > 0 &&
    Number.isFinite(fixture.slice) &&
    Number.isInteger(fixture.visitCap) &&
    fixture.visitCap > 0 &&
    fixture.rotorRows.length === 4 &&
    fixture.rotorRows.every(
      (row) => row.length === 4 && row.every(Number.isFinite),
    )
  );
}

export function dielectricIntrinsicPoint(
  fixture: DielectricSolidFixture,
  point: Vec3,
): Vec4 {
  const p: Vec4 = [point[0], point[1], point[2], fixture.slice];
  return fixture.rotorRows.map((row) =>
    row.reduce((sum, value, axis) => sum + value * p[axis], 0),
  ) as Vec4;
}

export function dielectricIntrinsicDirection(
  fixture: DielectricSolidFixture,
  direction: Vec3,
): Vec4 {
  return fixture.rotorRows.map(
    (row) =>
      row[0] * direction[0] + row[1] * direction[1] + row[2] * direction[2],
  ) as Vec4;
}

/** Occupancy of one finest-grid cell. Indices outside the root are empty. */
export function dielectricCellOccupied(
  fixture: DielectricSolidFixture,
  index: readonly number[],
): boolean {
  const gridSize = 3 ** fixture.depth;
  for (let axis = 0; axis < fixture.dimension; axis++)
    if (
      !Number.isInteger(index[axis]) ||
      index[axis] < 0 ||
      index[axis] >= gridSize
    )
      return false;
  for (let level = 0, divisor = gridSize / 3; level < fixture.depth; level++) {
    let middles = 0;
    for (let axis = 0; axis < fixture.dimension; axis++)
      if (Math.floor(index[axis] / divisor) % 3 === 1) middles++;
    if (middles > 1) return false;
    divisor /= 3;
  }
  return true;
}

function candidateCellIndices(
  coordinate: number,
  halfExtent: number,
  gridSize: number,
): number[] {
  if (coordinate < -halfExtent || coordinate > halfExtent) return [];
  const width = (2 * halfExtent) / gridSize;
  const u = (coordinate + halfExtent) / width;
  if (u <= 0) return [0];
  if (u >= gridSize) return [gridSize - 1];
  const lower = Math.floor(u);
  return u === lower ? [lower - 1, lower] : [lower];
}

/**
 * Closed-set membership. On a numerically exact grid plane, either adjacent
 * retained cell owns the point. This differs deliberately from ray-side
 * occupancy, which selects the infinitesimal forward side of a ray.
 */
export function dielectricContains(
  fixture: DielectricSolidFixture,
  point: Vec3,
): boolean {
  if (!validFixture(fixture) || !point.every(Number.isFinite)) return false;
  const q = dielectricIntrinsicPoint(fixture, point);
  const gridSize = 3 ** fixture.depth;
  const candidates = Array.from({ length: fixture.dimension }, (_, axis) =>
    candidateCellIndices(q[axis], fixture.halfExtent, gridSize),
  );
  if (candidates.some((axis) => axis.length === 0)) return false;
  const index = Array<number>(fixture.dimension).fill(0);
  const search = (axis: number): boolean => {
    if (axis === fixture.dimension)
      return dielectricCellOccupied(fixture, index);
    for (const candidate of candidates[axis]) {
      index[axis] = candidate;
      if (search(axis + 1)) return true;
    }
    return false;
  };
  return search(0);
}

function raySideCellIndex(
  coordinate: number,
  direction: number,
  halfExtent: number,
  gridSize: number,
): number {
  const width = (2 * halfExtent) / gridSize;
  const u = (coordinate + halfExtent) / width;
  if (u <= 0) return direction < 0 ? -1 : 0;
  if (u >= gridSize) return direction > 0 ? gridSize : gridSize - 1;
  const lower = Math.floor(u);
  if (u === lower && direction < 0) return lower - 1;
  // A ray coincident with a grid plane uses its upper half-open cell. This is
  // deterministic one-sided ownership, not closed membership of the plane.
  return lower;
}

/** Occupancy an infinitesimal positive distance along direction from point. */
export function dielectricRaySideOccupancy(
  fixture: DielectricSolidFixture,
  point: Vec3,
  direction: Vec3,
): boolean {
  if (
    !validFixture(fixture) ||
    !point.every(Number.isFinite) ||
    !direction.every(Number.isFinite)
  )
    return false;
  const q = dielectricIntrinsicPoint(fixture, point);
  const qd = dielectricIntrinsicDirection(fixture, direction);
  const gridSize = 3 ** fixture.depth;
  const index = Array.from({ length: fixture.dimension }, (_, axis) =>
    raySideCellIndex(q[axis], qd[axis], fixture.halfExtent, gridSize),
  );
  return dielectricCellOccupied(fixture, index);
}

function sameFace(a: DielectricFace | undefined, b: DielectricFace) {
  return (
    a !== undefined &&
    a.axis === b.axis &&
    a.planeIndex === b.planeIndex &&
    a.depth === b.depth
  );
}

function chooseAxis(axes: readonly number[], qd: Vec4): number {
  let chosen = axes[0];
  for (const axis of axes)
    if (Math.abs(qd[axis]) > Math.abs(qd[chosen])) chosen = axis;
  return chosen;
}

function boundaryFor(
  fixture: DielectricSolidFixture,
  qOrigin: Vec4,
  t: number,
  entering: boolean,
  axis: number,
  crossedAxes: readonly number[],
  planeIndices: readonly number[],
  qd: Vec4,
  visits: number,
): DielectricBoundary | DielectricRefusal {
  const planeIndex = planeIndices[axis];
  const directionSign = qd[axis] > 0 ? 1 : -1;
  const faceSign = (entering ? -directionSign : directionSign) as -1 | 1;
  const row = fixture.rotorRows[axis];
  const magnitude = Math.hypot(row[0], row[1], row[2]);
  if (!(magnitude > 0) || !Number.isFinite(magnitude))
    return {
      kind: "refused",
      reason: "degenerate-projected-normal",
      visits,
    };
  const intrinsicPoint = qOrigin.map(
    (value, intrinsicAxis) => value + t * qd[intrinsicAxis],
  ) as Vec4;
  let planeMask = 0;
  const anchorPlanes: [number, number, number, number] = [-1, -1, -1, -1];
  const width = (2 * fixture.halfExtent) / 3 ** fixture.depth;
  for (const crossedAxis of crossedAxes) {
    const crossedPlane = planeIndices[crossedAxis];
    planeMask |= 1 << crossedAxis;
    anchorPlanes[crossedAxis] = crossedPlane;
    intrinsicPoint[crossedAxis] = -fixture.halfExtent + crossedPlane * width;
  }
  return {
    kind: "boundary",
    t,
    entering,
    outwardNormal: [
      (faceSign * row[0]) / magnitude,
      (faceSign * row[1]) / magnitude,
      (faceSign * row[2]) / magnitude,
    ],
    intrinsicAxis: axis,
    faceSign,
    face: { axis, planeIndex, depth: fixture.depth },
    anchor: { intrinsicPoint, planeMask, planeIndices: anchorPlanes },
    visits,
  };
}

interface RootClip {
  enter: number;
  exit: number;
  enterAxes: number[];
}

function clipRoot(
  fixture: DielectricSolidFixture,
  q: Vec4,
  qd: Vec4,
): RootClip | null {
  let enter = -Infinity;
  let exit = Infinity;
  let enterAxes: number[] = [];
  for (let axis = 0; axis < fixture.dimension; axis++) {
    if (qd[axis] === 0) {
      if (q[axis] < -fixture.halfExtent || q[axis] > fixture.halfExtent)
        return null;
      continue;
    }
    const a = (-fixture.halfExtent - q[axis]) / qd[axis];
    const b = (fixture.halfExtent - q[axis]) / qd[axis];
    const near = Math.min(a, b);
    const far = Math.max(a, b);
    if (near > enter) {
      enter = near;
      enterAxes = [axis];
    } else if (near === enter) enterAxes.push(axis);
    exit = Math.min(exit, far);
    if (exit < enter) return null;
  }
  return { enter, exit, enterAxes };
}

/**
 * Returns the next exact occupancy transition of the finite cell union.
 * Crossing-time ties are exact numeric equality and all tied axes advance
 * atomically. At a nondifferentiable corner, the normal uses the tied axis
 * with largest |intrinsic direction|, then the lowest axis.
 */
export function dielectricNextBoundary(
  fixture: DielectricSolidFixture,
  origin: Vec3,
  direction: Vec3,
  options: NextBoundaryOptions,
): DielectricBoundaryResult {
  return dielectricNextBoundaryInternal(fixture, origin, direction, options);
}

/**
 * Secondary traversal whose intrinsic anchor is authoritative. The world hit
 * is deliberately absent from this API, so rounded display coordinates cannot
 * silently replace the canonical boundary origin.
 */
export function dielectricNextBoundaryFromAnchor(
  fixture: DielectricSolidFixture,
  direction: Vec3,
  options: AnchoredBoundaryOptions,
): DielectricBoundaryResult {
  return dielectricNextBoundaryInternal(fixture, [0, 0, 0], direction, options);
}

function dielectricNextBoundaryInternal(
  fixture: DielectricSolidFixture,
  origin: Vec3,
  direction: Vec3,
  options: NextBoundaryOptions & { anchor?: DielectricBoundaryAnchor },
): DielectricBoundaryResult {
  const tMin = options.tMin ?? 0;
  const anchor = options.anchor;
  if (
    !validFixture(fixture) ||
    typeof options.inside !== "boolean" ||
    (!anchor && !origin.every(Number.isFinite)) ||
    !direction.every(Number.isFinite) ||
    !(Math.hypot(...direction) > 0) ||
    !Number.isFinite(tMin) ||
    tMin < 0 ||
    (anchor !== undefined &&
      (tMin !== 0 ||
        options.previousFace !== undefined ||
        !anchor.intrinsicPoint.every(Number.isFinite) ||
        !Number.isInteger(anchor.planeMask) ||
        anchor.planeMask <= 0 ||
        (anchor.planeMask & ~((1 << fixture.dimension) - 1)) !== 0 ||
        anchor.planeIndices.length !== 4 ||
        anchor.planeIndices.some((value, axis) =>
          (anchor.planeMask & (1 << axis)) !== 0
            ? !Number.isInteger(value) ||
              value < 0 ||
              value > 3 ** fixture.depth
            : value !== -1,
        ) ||
        anchor.intrinsicPoint.some((value, axis) => {
          const masked = (anchor.planeMask & (1 << axis)) !== 0;
          return masked
            ? value !==
                -fixture.halfExtent +
                  anchor.planeIndices[axis] *
                    ((2 * fixture.halfExtent) / 3 ** fixture.depth)
            : axis < fixture.dimension &&
                (value < -fixture.halfExtent || value > fixture.halfExtent);
        })))
  )
    return { kind: "refused", reason: "invalid-input", visits: 0 };
  const q = anchor
    ? ([...anchor.intrinsicPoint] as Vec4)
    : dielectricIntrinsicPoint(fixture, origin);
  const qd = dielectricIntrinsicDirection(fixture, direction);
  const clip = clipRoot(fixture, q, qd);
  if (!clip) return { kind: "miss", visits: 0 };
  const start = Math.max(tMin, clip.enter);
  if (!(clip.exit > start)) return { kind: "miss", visits: 0 };
  const gridSize = 3 ** fixture.depth;
  const width = (2 * fixture.halfExtent) / gridSize;
  const qStart = q.map((value, axis) => value + start * qd[axis]) as Vec4;
  const index = Array.from({ length: fixture.dimension }, (_, axis) =>
    raySideCellIndex(qStart[axis], qd[axis], fixture.halfExtent, gridSize),
  );
  if (anchor) {
    for (let axis = 0; axis < fixture.dimension; axis++) {
      if ((anchor.planeMask & (1 << axis)) === 0) continue;
      if (qd[axis] === 0)
        return { kind: "refused", reason: "ambiguous-anchor", visits: 0 };
      index[axis] =
        qd[axis] > 0
          ? anchor.planeIndices[axis]
          : anchor.planeIndices[axis] - 1;
    }
  }
  if (
    !anchor &&
    options.previousFace?.depth === fixture.depth &&
    qd[options.previousFace.axis] !== 0
  ) {
    const axis = options.previousFace.axis;
    const plane = -fixture.halfExtent + options.previousFace.planeIndex * width;
    const faceT = (plane - q[axis]) / qd[axis];
    // Face identity affects the side only when its analytic crossing is
    // exactly tMin. This repairs reconstruction of a non-binary grid point
    // without suppressing any nearby positive interval.
    if (faceT === tMin)
      index[axis] =
        qd[axis] > 0
          ? options.previousFace.planeIndex
          : options.previousFace.planeIndex - 1;
  }
  let visits = 0;
  let sideInside = dielectricCellOccupied(fixture, index);
  if (index.every((value) => value >= 0 && value < gridSize)) visits++;
  const mediumInside = options.inside;

  if (sideInside !== mediumInside) {
    if (anchor) return { kind: "refused", reason: "state-mismatch", visits };
    let axes: number[];
    if (start === clip.enter) axes = clip.enterAxes;
    else {
      axes = [];
      for (let axis = 0; axis < fixture.dimension; axis++) {
        const u = (qStart[axis] + fixture.halfExtent) / width;
        if (u === Math.round(u) && qd[axis] !== 0) axes.push(axis);
      }
    }
    if (axes.length === 0)
      return { kind: "refused", reason: "state-mismatch", visits };
    const axis = chooseAxis(axes, qd);
    const planeIndices = Array<number>(fixture.dimension).fill(-1);
    for (const crossedAxis of axes)
      planeIndices[crossedAxis] = Math.round(
        (qStart[crossedAxis] + fixture.halfExtent) / width,
      );
    const event = boundaryFor(
      fixture,
      q,
      start,
      sideInside,
      axis,
      axes,
      planeIndices,
      qd,
      visits,
    );
    if (event.kind === "refused") return event;
    if (start === tMin && sameFace(options.previousFace, event.face))
      return { kind: "refused", reason: "state-mismatch", visits };
    return event;
  }

  while (true) {
    let nextT = Infinity;
    const crossingT = Array<number>(fixture.dimension).fill(Infinity);
    for (let axis = 0; axis < fixture.dimension; axis++) {
      if (qd[axis] === 0) continue;
      const planeIndex = qd[axis] > 0 ? index[axis] + 1 : index[axis];
      const plane = -fixture.halfExtent + planeIndex * width;
      crossingT[axis] = (plane - q[axis]) / qd[axis];
      nextT = Math.min(nextT, crossingT[axis]);
    }
    if (!Number.isFinite(nextT)) return { kind: "miss", visits };
    if (nextT < start)
      return { kind: "refused", reason: "nonmonotone-crossing", visits };
    const axes = crossingT
      .map((value, axis) => ({ value, axis }))
      .filter(({ value }) => value === nextT)
      .map(({ axis }) => axis);
    const oldIndex = [...index];
    for (const axis of axes) index[axis] += qd[axis] > 0 ? 1 : -1;
    const inRoot = index.every((value) => value >= 0 && value < gridSize);
    if (inRoot) {
      if (visits >= fixture.visitCap)
        return { kind: "refused", reason: "visit-cap", visits };
      visits++;
    }
    const nextInside = inRoot && dielectricCellOccupied(fixture, index);
    if (nextInside !== sideInside) {
      const axis = chooseAxis(axes, qd);
      const planeIndices = Array<number>(fixture.dimension).fill(-1);
      for (const crossedAxis of axes)
        planeIndices[crossedAxis] =
          qd[crossedAxis] > 0
            ? oldIndex[crossedAxis] + 1
            : oldIndex[crossedAxis];
      const event = boundaryFor(
        fixture,
        q,
        nextT,
        nextInside,
        axis,
        axes,
        planeIndices,
        qd,
        visits,
      );
      if (event.kind === "refused") return event;
      if (sideInside !== mediumInside)
        return { kind: "refused", reason: "state-mismatch", visits };
      if (nextT === tMin && sameFace(options.previousFace, event.face))
        return { kind: "refused", reason: "state-mismatch", visits };
      return event;
    }
    sideInside = nextInside;
    if (!inRoot) return { kind: "miss", visits };
  }
}

/** Enumerates terminal boxes for small exhaustive reference controls only. */
export function dielectricTerminalCells(
  fixture: DielectricSolidFixture,
): DielectricCell[] {
  if (!validFixture(fixture)) throw new Error("Invalid dielectric fixture");
  const gridSize = 3 ** fixture.depth;
  const width = (2 * fixture.halfExtent) / gridSize;
  const index = Array<number>(fixture.dimension).fill(0);
  const cells: DielectricCell[] = [];
  const visit = (axis: number) => {
    if (axis < fixture.dimension) {
      for (let value = 0; value < gridSize; value++) {
        index[axis] = value;
        visit(axis + 1);
      }
      return;
    }
    if (!dielectricCellOccupied(fixture, index)) return;
    cells.push({
      index: [...index],
      center: index.map((value) => -fixture.halfExtent + (value + 0.5) * width),
      half: width / 2,
    });
  };
  visit(0);
  return cells;
}

/** Exact vertex enumeration of the root cube intersected by the fixed slice. */
export function dielectricDisplayedRootYBounds(
  fixture: DielectricSolidFixture,
): { minimum: number; maximum: number } {
  if (!validFixture(fixture)) throw new Error("Invalid dielectric fixture");
  const half = fixture.halfExtent;
  if (fixture.dimension === 3) return { minimum: -half, maximum: half };
  // With orthogonal row matrix M, displayed v=M^T q. The slice constraint is
  // v.w=column_w(M) dot q. A clipped-hypercube vertex fixes three q axes.
  const sliceColumn = fixture.rotorRows.map((row) => row[3]);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let freeAxis = 0; freeAxis < 4; freeAxis++) {
    if (sliceColumn[freeAxis] === 0) continue;
    for (let signs = 0; signs < 8; signs++) {
      const q: Vec4 = [0, 0, 0, 0];
      let bit = 0;
      let fixedSlice = 0;
      for (let axis = 0; axis < 4; axis++) {
        if (axis === freeAxis) continue;
        q[axis] = (signs & (1 << bit++)) === 0 ? -half : half;
        fixedSlice += sliceColumn[axis] * q[axis];
      }
      q[freeAxis] = (fixture.slice - fixedSlice) / sliceColumn[freeAxis];
      if (q[freeAxis] < -half || q[freeAxis] > half) continue;
      const displayedY = q.reduce(
        (sum, value, axis) => sum + value * fixture.rotorRows[axis][1],
        0,
      );
      minimum = Math.min(minimum, displayedY);
      maximum = Math.max(maximum, displayedY);
    }
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum))
    throw new Error("The selected 4D slice does not intersect the root");
  return { minimum, maximum };
}

export interface DielectricRefraction {
  tir: boolean;
  direction: Vec3;
}

/** Independent unit-vector Snell/TIR oracle; normal points material -> air. */
export function dielectricRefract(
  incident: Vec3,
  outwardNormal: Vec3,
  fromIor: number,
  toIor: number,
): DielectricRefraction {
  const incidentLength = Math.hypot(...incident);
  const normalLength = Math.hypot(...outwardNormal);
  if (
    !(incidentLength > 0) ||
    !(normalLength > 0) ||
    ![...incident, ...outwardNormal, fromIor, toIor].every(Number.isFinite) ||
    !(fromIor > 0) ||
    !(toIor > 0)
  )
    throw new Error(
      "Refraction inputs must be finite with positive lengths/IORs",
    );
  const i = incident.map((value) => value / incidentLength) as Vec3;
  const outward = outwardNormal.map((value) => value / normalLength) as Vec3;
  const against =
    i[0] * outward[0] + i[1] * outward[1] + i[2] * outward[2] < 0
      ? outward
      : (outward.map((value) => -value) as Vec3);
  const cosI = -(i[0] * against[0] + i[1] * against[1] + i[2] * against[2]);
  const eta = fromIor / toIor;
  const sinT2 = eta * eta * Math.max(0, 1 - cosI * cosI);
  let direction: Vec3;
  if (sinT2 > 1) {
    direction = i.map(
      (value, axis) => value + 2 * cosI * against[axis],
    ) as Vec3;
    return { tir: true, direction };
  }
  const cosT = Math.sqrt(Math.max(0, 1 - sinT2));
  direction = i.map(
    (value, axis) => eta * value + (eta * cosI - cosT) * against[axis],
  ) as Vec3;
  const length = Math.hypot(...direction);
  return {
    tir: false,
    direction: direction.map((value) => value / length) as Vec3,
  };
}

export function dielectricBeerThroughput(
  absorptionPerRadius: number,
  distance: number,
  radius: number,
): number {
  if (
    ![absorptionPerRadius, distance, radius].every(Number.isFinite) ||
    absorptionPerRadius < 0 ||
    distance < 0 ||
    !(radius > 0)
  )
    throw new Error(
      "Beer inputs must be finite and non-negative with radius > 0",
    );
  return Math.exp((-absorptionPerRadius * distance) / radius);
}

/** 96-byte uniform layout shared with the GPU experiment. */
export const DIELECTRIC_SOLID_PACKED_BYTES = 96;

export function packDielectricSolidFixture(
  fixture: DielectricSolidFixture,
): ArrayBuffer {
  if (!validFixture(fixture)) throw new Error("Invalid dielectric fixture");
  const buffer = new ArrayBuffer(DIELECTRIC_SOLID_PACKED_BYTES);
  const u32 = new Uint32Array(buffer);
  const f32 = new Float32Array(buffer);
  u32[0] = fixture.dimension;
  u32[1] = fixture.depth;
  u32[2] = 3 ** fixture.depth;
  u32[3] = fixture.visitCap;
  f32[4] = fixture.halfExtent;
  f32[5] = fixture.slice;
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 4; column++)
      f32[8 + row * 4 + column] = fixture.rotorRows[row][column];
  return buffer;
}

/**
 * Shared WGSL declarations and scalar occupancy helpers. The GPU experiment
 * imports this source and owns its transport loop. Boundary control flow is
 * pinned against `dielectricNextBoundary` by the scalar harness before image
 * interpretation; result/reason numeric values are intentionally explicit.
 */
export const DIELECTRIC_SOLID_WGSL = /* wgsl */ `
struct DielectricSolidFixture {
  counts: vec4<u32>, // dimension, depth, gridSize, visitCap
  shape: vec4<f32>,  // halfExtent, slice, reserved, reserved
  row0: vec4<f32>,
  row1: vec4<f32>,
  row2: vec4<f32>,
  row3: vec4<f32>,
};

const DIELECTRIC_RESULT_BOUNDARY: u32 = 1u;
const DIELECTRIC_RESULT_MISS: u32 = 2u;
const DIELECTRIC_RESULT_REFUSED: u32 = 3u;
const DIELECTRIC_REFUSAL_VISIT_CAP: u32 = 1u;
const DIELECTRIC_REFUSAL_STATE_MISMATCH: u32 = 2u;
const DIELECTRIC_REFUSAL_NONMONOTONE: u32 = 3u;
const DIELECTRIC_REFUSAL_DEGENERATE_NORMAL: u32 = 4u;
const DIELECTRIC_REFUSAL_AMBIGUOUS_ANCHOR: u32 = 5u;
const DIELECTRIC_REFUSAL_INVALID_INPUT: u32 = 6u;

struct DielectricBoundaryResult {
  kind: u32,
  reason: u32,
  visits: u32,
  entering: u32,
  t: f32,
  axis: u32,
  planeIndex: i32,
  faceSign: f32,
  outwardNormal: vec3<f32>,
  planeMask: u32,
  planeIndices: vec4<i32>,
  intrinsicPoint: vec4<f32>,
};

fn dielectricRow(f: DielectricSolidFixture, axis: u32) -> vec4<f32> {
  if (axis == 0u) { return f.row0; }
  if (axis == 1u) { return f.row1; }
  if (axis == 2u) { return f.row2; }
  return f.row3;
}

fn dielectricPoint(f: DielectricSolidFixture, p: vec3<f32>) -> vec4<f32> {
  let v = vec4<f32>(p, f.shape.y);
  return vec4<f32>(dot(f.row0, v), dot(f.row1, v), dot(f.row2, v), dot(f.row3, v));
}

fn dielectricDirection(f: DielectricSolidFixture, d: vec3<f32>) -> vec4<f32> {
  let v = vec4<f32>(d, 0.0);
  return vec4<f32>(dot(f.row0, v), dot(f.row1, v), dot(f.row2, v), dot(f.row3, v));
}

fn dielectricCellOccupied(f: DielectricSolidFixture, cell: vec4<i32>) -> bool {
  let dimension = f.counts.x;
  let gridSize = i32(f.counts.z);
  for (var axis = 0u; axis < dimension; axis++) {
    if (cell[axis] < 0 || cell[axis] >= gridSize) { return false; }
  }
  var divisor = gridSize / 3;
  for (var level = 0u; level < f.counts.y; level++) {
    var middles = 0u;
    for (var axis = 0u; axis < dimension; axis++) {
      if ((cell[axis] / divisor) % 3 == 1) { middles += 1u; }
    }
    if (middles > 1u) { return false; }
    divisor /= 3;
  }
  return true;
}

fn dielectricResult(kind: u32, reason: u32, visits: u32) -> DielectricBoundaryResult {
  return DielectricBoundaryResult(
    kind, reason, visits, 0u, 0.0, 0u, 0, 0.0, vec3<f32>(0.0),
    0u, vec4<i32>(-1), vec4<f32>(0.0),
  );
}

fn dielectricSideIndex(q: f32, d: f32, halfExtent: f32, gridSize: i32) -> i32 {
  let width = 2.0 * halfExtent / f32(gridSize);
  let u = (q + halfExtent) / width;
  if (u <= 0.0) { return select(0, -1, d < 0.0); }
  if (u >= f32(gridSize)) { return select(gridSize - 1, gridSize, d > 0.0); }
  let lower = i32(floor(u));
  if (u == f32(lower) && d < 0.0) { return lower - 1; }
  return lower;
}

fn dielectricChooseAxis(mask: u32, qd: vec4<f32>, dimension: u32) -> u32 {
  var chosen = 0u;
  var best = -1.0;
  for (var axis = 0u; axis < dimension; axis++) {
    if ((mask & (1u << axis)) != 0u && abs(qd[axis]) > best) {
      chosen = axis;
      best = abs(qd[axis]);
    }
  }
  return chosen;
}

fn dielectricBoundary(
  f: DielectricSolidFixture,
  qOrigin: vec4<f32>,
  t: f32,
  entering: bool,
  axis: u32,
  planeMask: u32,
  planeIndices: vec4<i32>,
  qd: vec4<f32>,
  visits: u32,
) -> DielectricBoundaryResult {
  let planeIndex = planeIndices[axis];
  let directionSign = select(-1.0, 1.0, qd[axis] > 0.0);
  let faceSign = select(directionSign, -directionSign, entering);
  let projected = dielectricRow(f, axis).xyz;
  let magnitude = length(projected);
  if (!(magnitude > 0.0)) {
    return dielectricResult(
      DIELECTRIC_RESULT_REFUSED,
      DIELECTRIC_REFUSAL_DEGENERATE_NORMAL,
      visits,
    );
  }
  var intrinsicPoint = qOrigin + t * qd;
  for (var crossedAxis = 0u; crossedAxis < f.counts.x; crossedAxis++) {
    if ((planeMask & (1u << crossedAxis)) != 0u) {
      intrinsicPoint[crossedAxis] =
        -f.shape.x + f32(planeIndices[crossedAxis]) *
        (2.0 * f.shape.x / f32(f.counts.z));
    }
  }
  return DielectricBoundaryResult(
    DIELECTRIC_RESULT_BOUNDARY,
    0u,
    visits,
    select(0u, 1u, entering),
    t,
    axis,
    planeIndex,
    faceSign,
    faceSign * projected / magnitude,
    planeMask,
    planeIndices,
    intrinsicPoint,
  );
}

/**
 * GPU mirror of dielectricNextBoundary. Exact f32 equality is the tie rule;
 * An anchor supplies the canonical intrinsic hit for secondary traversal.
 * The previous face fallback suppresses only a crossing exactly at tMin.
 */
fn dielectricNextBoundaryRaw(
  f: DielectricSolidFixture,
  origin: vec3<f32>,
  direction: vec3<f32>,
  mediumInsideInput: u32,
  tMin: f32,
  previousAxis: i32,
  previousPlane: i32,
  hasPrevious: u32,
  anchorPoint: vec4<f32>,
  anchorPlaneMask: u32,
  anchorPlaneIndices: vec4<i32>,
  hasAnchor: u32,
) -> DielectricBoundaryResult {
  let dimension = f.counts.x;
  let gridSize = i32(f.counts.z);
  let halfExtent = f.shape.x;
  let width = 2.0 * halfExtent / f32(gridSize);
  if (hasAnchor != 0u) {
    let validMask = (1u << dimension) - 1u;
    if (anchorPlaneMask == 0u || (anchorPlaneMask & ~validMask) != 0u) {
      return dielectricResult(
        DIELECTRIC_RESULT_REFUSED,
        DIELECTRIC_REFUSAL_INVALID_INPUT,
        0u,
      );
    }
    for (var axis = 0u; axis < 4u; axis++) {
      let masked = (anchorPlaneMask & (1u << axis)) != 0u;
      if (masked) {
        if (anchorPlaneIndices[axis] < 0 || anchorPlaneIndices[axis] > gridSize ||
            anchorPoint[axis] != -halfExtent + f32(anchorPlaneIndices[axis]) * width) {
          return dielectricResult(
            DIELECTRIC_RESULT_REFUSED,
            DIELECTRIC_REFUSAL_INVALID_INPUT,
            0u,
          );
        }
      } else if (anchorPlaneIndices[axis] != -1 ||
                 (axis < dimension &&
                  (anchorPoint[axis] < -halfExtent || anchorPoint[axis] > halfExtent))) {
        return dielectricResult(
          DIELECTRIC_RESULT_REFUSED,
          DIELECTRIC_REFUSAL_INVALID_INPUT,
          0u,
        );
      }
    }
  }
  let q = select(dielectricPoint(f, origin), anchorPoint, hasAnchor != 0u);
  let qd = dielectricDirection(f, direction);
  var enter = -3.402823466e+38;
  var exit = 3.402823466e+38;
  var enterMask = 0u;
  for (var axis = 0u; axis < dimension; axis++) {
    if (qd[axis] == 0.0) {
      if (q[axis] < -halfExtent || q[axis] > halfExtent) {
        return dielectricResult(DIELECTRIC_RESULT_MISS, 0u, 0u);
      }
      continue;
    }
    let a = (-halfExtent - q[axis]) / qd[axis];
    let b = (halfExtent - q[axis]) / qd[axis];
    let near = min(a, b);
    let far = max(a, b);
    if (near > enter) {
      enter = near;
      enterMask = 1u << axis;
    } else if (near == enter) {
      enterMask |= 1u << axis;
    }
    exit = min(exit, far);
    if (exit < enter) {
      return dielectricResult(DIELECTRIC_RESULT_MISS, 0u, 0u);
    }
  }
  let effectiveTMin = select(tMin, 0.0, hasAnchor != 0u);
  let start = max(effectiveTMin, enter);
  if (!(exit > start)) {
    return dielectricResult(DIELECTRIC_RESULT_MISS, 0u, 0u);
  }
  let qStart = q + start * qd;
  var cell = vec4<i32>(0);
  for (var axis = 0u; axis < dimension; axis++) {
    cell[axis] = dielectricSideIndex(qStart[axis], qd[axis], halfExtent, gridSize);
  }
  if (hasAnchor != 0u) {
    for (var axis = 0u; axis < dimension; axis++) {
      if ((anchorPlaneMask & (1u << axis)) == 0u) { continue; }
      if (qd[axis] == 0.0) {
        return dielectricResult(
          DIELECTRIC_RESULT_REFUSED,
          DIELECTRIC_REFUSAL_AMBIGUOUS_ANCHOR,
          0u,
        );
      }
      cell[axis] = select(
        anchorPlaneIndices[axis] - 1,
        anchorPlaneIndices[axis],
        qd[axis] > 0.0,
      );
    }
  }
  if (hasAnchor == 0u && hasPrevious != 0u && previousAxis >= 0 && qd[u32(previousAxis)] != 0.0) {
    let axis = u32(previousAxis);
    let plane = -halfExtent + f32(previousPlane) * width;
    let faceT = (plane - q[axis]) / qd[axis];
    if (faceT == effectiveTMin) {
      cell[axis] = select(previousPlane - 1, previousPlane, qd[axis] > 0.0);
    }
  }
  var inRoot = true;
  for (var axis = 0u; axis < dimension; axis++) {
    inRoot = inRoot && cell[axis] >= 0 && cell[axis] < gridSize;
  }
  var visits = select(0u, 1u, inRoot);
  var sideInside = inRoot && dielectricCellOccupied(f, cell);
  let mediumInside = mediumInsideInput != 0u;

  if (sideInside != mediumInside) {
    if (hasAnchor != 0u) {
      return dielectricResult(
        DIELECTRIC_RESULT_REFUSED,
        DIELECTRIC_REFUSAL_STATE_MISMATCH,
        visits,
      );
    }
    var mask = 0u;
    if (start == enter) {
      mask = enterMask;
    } else {
      for (var axis = 0u; axis < dimension; axis++) {
        let u = (qStart[axis] + halfExtent) / width;
        if (u == round(u) && qd[axis] != 0.0) { mask |= 1u << axis; }
      }
    }
    if (mask == 0u) {
      return dielectricResult(
        DIELECTRIC_RESULT_REFUSED,
        DIELECTRIC_REFUSAL_STATE_MISMATCH,
        visits,
      );
    }
    let axis = dielectricChooseAxis(mask, qd, dimension);
    var planeIndices = vec4<i32>(-1);
    for (var crossedAxis = 0u; crossedAxis < dimension; crossedAxis++) {
      if ((mask & (1u << crossedAxis)) != 0u) {
        planeIndices[crossedAxis] =
          i32(round((qStart[crossedAxis] + halfExtent) / width));
      }
    }
    let planeIndex = planeIndices[axis];
    let samePrevious = hasPrevious != 0u &&
      start == effectiveTMin && previousAxis == i32(axis) && previousPlane == planeIndex;
    if (samePrevious) {
      return dielectricResult(
        DIELECTRIC_RESULT_REFUSED,
        DIELECTRIC_REFUSAL_STATE_MISMATCH,
        visits,
      );
    }
    return dielectricBoundary(
      f, q, start, sideInside, axis, mask, planeIndices, qd, visits,
    );
  }

  for (var iteration = 0u; iteration < 512u; iteration++) {
    var crossings = vec4<f32>(3.402823466e+38);
    var nextT = 3.402823466e+38;
    for (var axis = 0u; axis < dimension; axis++) {
      if (qd[axis] == 0.0) { continue; }
      let planeIndex = select(cell[axis], cell[axis] + 1, qd[axis] > 0.0);
      let plane = -halfExtent + f32(planeIndex) * width;
      crossings[axis] = (plane - q[axis]) / qd[axis];
      nextT = min(nextT, crossings[axis]);
    }
    if (nextT == 3.402823466e+38) {
      return dielectricResult(DIELECTRIC_RESULT_MISS, 0u, visits);
    }
    if (nextT < start) {
      return dielectricResult(
        DIELECTRIC_RESULT_REFUSED,
        DIELECTRIC_REFUSAL_NONMONOTONE,
        visits,
      );
    }
    var crossingMask = 0u;
    let oldCell = cell;
    for (var axis = 0u; axis < dimension; axis++) {
      if (crossings[axis] == nextT) {
        crossingMask |= 1u << axis;
        cell[axis] += select(-1, 1, qd[axis] > 0.0);
      }
    }
    inRoot = true;
    for (var axis = 0u; axis < dimension; axis++) {
      inRoot = inRoot && cell[axis] >= 0 && cell[axis] < gridSize;
    }
    if (inRoot) {
      if (visits >= f.counts.w) {
        return dielectricResult(
          DIELECTRIC_RESULT_REFUSED,
          DIELECTRIC_REFUSAL_VISIT_CAP,
          visits,
        );
      }
      visits += 1u;
    }
    let nextInside = inRoot && dielectricCellOccupied(f, cell);
    if (nextInside != sideInside) {
      let axis = dielectricChooseAxis(crossingMask, qd, dimension);
      var planeIndices = vec4<i32>(-1);
      for (var crossedAxis = 0u; crossedAxis < dimension; crossedAxis++) {
        if ((crossingMask & (1u << crossedAxis)) != 0u) {
          planeIndices[crossedAxis] = select(
            oldCell[crossedAxis],
            oldCell[crossedAxis] + 1,
            qd[crossedAxis] > 0.0,
          );
        }
      }
      let planeIndex = planeIndices[axis];
      let samePrevious = hasAnchor == 0u && hasPrevious != 0u && nextT == effectiveTMin &&
        previousAxis == i32(axis) && previousPlane == planeIndex;
      if (samePrevious) {
        return dielectricResult(
          DIELECTRIC_RESULT_REFUSED,
          DIELECTRIC_REFUSAL_STATE_MISMATCH,
          visits,
        );
      }
      if (sideInside != mediumInside) {
        return dielectricResult(
          DIELECTRIC_RESULT_REFUSED,
          DIELECTRIC_REFUSAL_STATE_MISMATCH,
          visits,
        );
      }
      return dielectricBoundary(
        f, q, nextT, nextInside, axis, crossingMask, planeIndices, qd, visits,
      );
    }
    sideInside = nextInside;
    if (!inRoot) { return dielectricResult(DIELECTRIC_RESULT_MISS, 0u, visits); }
  }
  return dielectricResult(DIELECTRIC_RESULT_REFUSED, DIELECTRIC_REFUSAL_VISIT_CAP, visits);
}

fn dielectricNextBoundary(
  f: DielectricSolidFixture,
  origin: vec3<f32>,
  direction: vec3<f32>,
  mediumInside: u32,
  tMin: f32,
  previousAxis: i32,
  previousPlane: i32,
  hasPrevious: u32,
) -> DielectricBoundaryResult {
  return dielectricNextBoundaryRaw(
    f, origin, direction, mediumInside, tMin,
    previousAxis, previousPlane, hasPrevious,
    vec4<f32>(0.0), 0u, vec4<i32>(-1), 0u,
  );
}

fn dielectricNextBoundaryFromAnchor(
  f: DielectricSolidFixture,
  direction: vec3<f32>,
  mediumInside: u32,
  anchorPoint: vec4<f32>,
  anchorPlaneMask: u32,
  anchorPlaneIndices: vec4<i32>,
) -> DielectricBoundaryResult {
  return dielectricNextBoundaryRaw(
    f, vec3<f32>(0.0), direction, mediumInside, 0.0,
    -1, -1, 0u,
    anchorPoint, anchorPlaneMask, anchorPlaneIndices, 1u,
  );
}
`;
