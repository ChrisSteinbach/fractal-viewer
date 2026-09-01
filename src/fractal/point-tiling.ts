import {
  LATTICE_PRESENTATION_FADE_START_MULT,
  LATTICE_PRESENTATION_RADIUS_MULT,
  latticePresentationVisibility,
} from "./lattice-march";
import { shapeSdf } from "./shapes";
import type { ShapeSpec } from "./shapes";
import {
  FOLD_EPS,
  isCanonicalResolvedLatticeTiling,
  isResolvedLatticeTiling,
  TILING_GROUP_INFO,
} from "./tiling";
import type {
  ResolvedFiniteTiling,
  ResolvedLatticeTiling,
  ResolvedTiling,
  TilingGroupInfo,
} from "./tiling";

/**
 * Pure runtime authority for plot-time space-tiling images. Surface folds
 * queries; forward-sampled renderers instead filter an already plotted source
 * point into canonical content and emit images which never feed back into the
 * orbit. The frozen construction and measured budgets live in
 * `docs/tiling-contract.md` Phase 3.
 *
 * This module deliberately accepts no RNG. Finite selection walks a coprime
 * permutation and lattice selection stratifies a source-independent CPU CDF;
 * both advance an explicit u32 cursor which callers persist across chunks or
 * dispatches. Image callbacks receive scalars, so neither exhaustive nor
 * bounded hot iteration allocates per image.
 */

export const POINT_TILING_POINTS_FANOUT_CAP = 256;
export const POINT_TILING_ACCUMULATION_FANOUT_CAP = 32;
export const POINT_TILING_POINTS_ATTEMPT_FACTOR = 8;
export const POINT_TILING_PLAN_MEMORY_CAP_BYTES = 256 * 1024;
export const POINT_TILING_MAX_LATTICE_CELLS = 739;
/** Worst continuous-CDF proposal mass which a K=1 wrapping-u32 phase grid
 * may not sample. K strata reduce the bound by K. */
export const POINT_TILING_MAX_LATTICE_CURSOR_MASS_ERROR =
  POINT_TILING_MAX_LATTICE_CELLS / 0x1_0000_0000;

const MATRIX_NEAR_EPS = 2e-10;
const MATRIX_KEY_SCALE = 1e8;
/** Coordinate equality for coincident boundary images. This is deliberately
 * much tighter than FOLD_EPS: that constant admits f32 chamber jitter and is
 * not evidence that two set images coincide. */
export const POINT_TILING_STABILIZER_REL_EPS = 0.5e-9;
const GOLDEN_U32 = 0x9e3779b1;
const U32_RANGE = 0x1_0000_0000;

export type PointTilingDimension = 3 | 4;
export type PointTilingStatus = "complete" | "underfilled" | "empty";

/** One emitted raw image. In 3D `w` is exactly zero. In 4D these are raw xyzw
 * coordinates whose origin-centred carrier/coverage is already evaluated;
 * consumers rotate, project, and slice afterward with the tiled pivot fixed
 * at the origin. `candidate` is the finite matrix index or lattice cell
 * ordinal, useful for agreement gates but not color attribution: renderers
 * copy canonical-source metadata. */
export type PointTilingImageVisitor = (
  x: number,
  y: number,
  z: number,
  w: number,
  weight: number,
  candidate: number,
) => void;

export interface PointTilingCursorState {
  /** Banked source-attempt credit. Acceptances spend at most the caller cap. */
  credit: number;
  /** Explicit wrapping-u32 selection cursor, suitable for a later WGSL twin. */
  cursor: number;
  attempts: number;
  accepted: number;
  selected: number;
  emitted: number;
}

/** Serializable Points-only equal-density state. `cursor` is a wrapping u32:
 * a finite image ordinal or the last lattice base-2/base-3 proposal ordinal.
 * `candidateTests` counts lattice proposals; finite output is counted directly
 * by `emitted`. */
export interface PointTilingPointsState {
  cursor: number;
  quotaRemainder: number;
  attempts: number;
  accepted: number;
  candidateTests: number;
  emitted: number;
}

export interface FinitePointTilingPlan {
  kind: "finite";
  dimension: PointTilingDimension;
  tiling: ResolvedFiniteTiling;
  /** Cached deterministic BFS closure, identity first. Treat entries read-only. */
  matrices: readonly Float64Array[];
  /** Right-coset representatives indexed by the active-simple-wall bit mask. */
  representativesByWallMask: readonly Uint16Array[];
  memoryBytes: number;
}

export interface LatticePointTilingCdf {
  /** Ordinals into the plan's flattened `cells` table. */
  cellOrdinals: Uint16Array;
  /** Strictly increasing f64 CPU CDF; the final live entry is exactly 1.
   * A later GPU packer owns and must prove its quantized representation. */
  cumulative: Float64Array;
  /** Sum of the exact CPU ceilings retained in this proposal table. */
  upperTotal: number;
}

export interface LatticePointTilingPlan {
  kind: "lattice";
  dimension: PointTilingDimension;
  tiling: ResolvedLatticeTiling;
  repeatedAxes: 2 | 3;
  /** Signed integer tuples, flattened by cell then repeated axis. */
  cells: Int16Array;
  /** Source-independent exact CPU visibility ceiling. */
  upper: Float64Array;
  /** CDF variants for every x/z[/w] canonical-wall stabilizer mask. */
  cdfByWallMask: readonly LatticePointTilingCdf[];
  memoryBytes: number;
}

/**
 * A consumer-specific lattice proposal over the SAME raw cells as a
 * {@link LatticePointTilingPlan}. The plan's `upper` table remains the
 * source-independent presentation ceiling; this object only changes how a
 * bounded consumer spends its samples. One CDF per canonical-wall mask keeps
 * the plan's exact stabilizer de-duplication on measure-zero seam sources.
 *
 * A proposal may be empty for every mask. That is a real bounded result (for
 * example, a settled 4D slice which cannot see any carrier cell), never a
 * reason to fall back to untiled output.
 */
export interface LatticePointTilingProposal {
  cdfByWallMask: readonly LatticePointTilingCdf[];
}

export type PointTilingPlan = FinitePointTilingPlan | LatticePointTilingPlan;

interface FiniteGroupCache {
  matrices: readonly Float64Array[];
  representativesByWallMask: readonly Uint16Array[];
  memoryBytes: number;
}

const FINITE_GROUP_CACHE = new Map<string, FiniteGroupCache>();

function identity(dimension: number): Float64Array {
  const matrix = new Float64Array(dimension * dimension);
  for (let axis = 0; axis < dimension; axis++) {
    matrix[axis * dimension + axis] = 1;
  }
  return matrix;
}

function reflectionMatrix(info: TilingGroupInfo, wall: number): Float64Array {
  const matrix = identity(info.dim);
  const base = wall * info.dim;
  for (let row = 0; row < info.dim; row++) {
    for (let column = 0; column < info.dim; column++) {
      matrix[row * info.dim + column] -=
        2 * info.roots[base + row] * info.roots[base + column];
    }
  }
  return matrix;
}

function multiplyMatrices(
  a: Float64Array,
  b: Float64Array,
  dimension: number,
): Float64Array {
  const product = new Float64Array(dimension * dimension);
  for (let row = 0; row < dimension; row++) {
    for (let column = 0; column < dimension; column++) {
      let value = 0;
      for (let inner = 0; inner < dimension; inner++) {
        value += a[row * dimension + inner] * b[inner * dimension + column];
      }
      product[row * dimension + column] = value;
    }
  }
  return product;
}

function matricesNear(a: Float64Array, b: Float64Array): boolean {
  for (let index = 0; index < a.length; index++) {
    if (Math.abs(a[index] - b[index]) > MATRIX_NEAR_EPS) return false;
  }
  return true;
}

function matrixKey(matrix: Float64Array): string {
  let key = "";
  for (let index = 0; index < matrix.length; index++) {
    if (index !== 0) key += ",";
    key += String(Math.round(matrix[index] * MATRIX_KEY_SCALE));
  }
  return key;
}

function matrixIndex(
  matrix: Float64Array,
  matrices: readonly Float64Array[],
  indexByKey: ReadonlyMap<string, readonly number[]>,
): number {
  const bucket = indexByKey.get(matrixKey(matrix));
  if (bucket) {
    for (const index of bucket) {
      if (matricesNear(matrix, matrices[index])) return index;
    }
  }
  // A rounded key may straddle its last decimal at the closure boundary.
  // This slow fallback runs only while constructing a cached plan.
  for (let index = 0; index < matrices.length; index++) {
    if (matricesNear(matrix, matrices[index])) return index;
  }
  return -1;
}

function buildMatrixIndex(
  matrices: readonly Float64Array[],
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (let index = 0; index < matrices.length; index++) {
    const key = matrixKey(matrices[index]);
    const bucket = result.get(key);
    if (bucket) bucket.push(index);
    else result.set(key, [index]);
  }
  return result;
}

function buildGroupMatrices(info: TilingGroupInfo): {
  matrices: Float64Array[];
  generators: Float64Array[];
} {
  const generators = Array.from({ length: info.dim }, (_, wall) =>
    reflectionMatrix(info, wall),
  );
  const matrices = [identity(info.dim)];
  for (let head = 0; head < matrices.length; head++) {
    for (const generator of generators) {
      const next = multiplyMatrices(matrices[head], generator, info.dim);
      if (!matrices.some((matrix) => matricesNear(matrix, next))) {
        matrices.push(next);
        if (matrices.length > info.order) {
          throw new Error(
            `point tiling: ${info.id} matrix closure exceeded order ${info.order}`,
          );
        }
      }
    }
  }
  if (matrices.length !== info.order) {
    throw new Error(
      `point tiling: ${info.id} matrix closure has ${matrices.length} elements, expected ${info.order}`,
    );
  }
  return { matrices, generators };
}

function subgroupIndices(
  info: TilingGroupInfo,
  wallMask: number,
  matrices: readonly Float64Array[],
  generators: readonly Float64Array[],
  indexByKey: ReadonlyMap<string, readonly number[]>,
): number[] {
  const seen = new Uint8Array(matrices.length);
  const subgroup = [0];
  seen[0] = 1;
  for (let head = 0; head < subgroup.length; head++) {
    for (let wall = 0; wall < info.dim; wall++) {
      if ((wallMask & (1 << wall)) === 0) continue;
      const product = multiplyMatrices(
        matrices[subgroup[head]],
        generators[wall],
        info.dim,
      );
      const index = matrixIndex(product, matrices, indexByKey);
      if (index < 0) {
        throw new Error(`point tiling: ${info.id} subgroup escaped closure`);
      }
      if (seen[index] === 0) {
        seen[index] = 1;
        subgroup.push(index);
      }
    }
  }
  return subgroup;
}

function cosetRepresentatives(
  info: TilingGroupInfo,
  wallMask: number,
  matrices: readonly Float64Array[],
  generators: readonly Float64Array[],
  indexByKey: ReadonlyMap<string, readonly number[]>,
): Uint16Array {
  const subgroup = subgroupIndices(
    info,
    wallMask,
    matrices,
    generators,
    indexByKey,
  );
  const claimed = new Uint8Array(matrices.length);
  const representatives: number[] = [];
  for (let group = 0; group < matrices.length; group++) {
    if (claimed[group] !== 0) continue;
    representatives.push(group);
    for (const stabilizer of subgroup) {
      const product = multiplyMatrices(
        matrices[group],
        matrices[stabilizer],
        info.dim,
      );
      const index = matrixIndex(product, matrices, indexByKey);
      if (index < 0) {
        throw new Error(`point tiling: ${info.id} coset escaped closure`);
      }
      claimed[index] = 1;
    }
  }
  if (representatives.length * subgroup.length !== matrices.length) {
    throw new Error(
      `point tiling: ${info.id} stabilizer cosets do not partition G`,
    );
  }
  return Uint16Array.from(representatives);
}

function finiteGroupCache(info: TilingGroupInfo): FiniteGroupCache {
  const cached = FINITE_GROUP_CACHE.get(info.id);
  if (cached) return cached;
  const { matrices, generators } = buildGroupMatrices(info);
  const indexByKey = buildMatrixIndex(matrices);
  const representativesByWallMask = Array.from(
    { length: 1 << info.dim },
    (_, wallMask) =>
      cosetRepresentatives(info, wallMask, matrices, generators, indexByKey),
  );
  const memoryBytes =
    matrices.reduce((bytes, matrix) => bytes + matrix.byteLength, 0) +
    representativesByWallMask.reduce(
      (bytes, representatives) => bytes + representatives.byteLength,
      0,
    );
  if (memoryBytes > POINT_TILING_PLAN_MEMORY_CAP_BYTES) {
    throw new Error(
      `point tiling: ${info.id} plan requires ${memoryBytes} bytes, cap is ${POINT_TILING_PLAN_MEMORY_CAP_BYTES}`,
    );
  }
  const result: FiniteGroupCache = {
    matrices: Object.freeze(matrices),
    representativesByWallMask: Object.freeze(representativesByWallMask),
    memoryBytes,
  };
  FINITE_GROUP_CACHE.set(info.id, result);
  return result;
}

function assertAnalyticClip(clip: ShapeSpec | undefined): void {
  if (!clip) return;
  if (clip.parts.some((part) => part.primitive.kind === "mesh")) {
    throw new Error(
      "point tiling: mesh-backed clips are refused; canonical membership supports analytic clips only",
    );
  }
  // Validate the flat CSG structure now rather than during the first hot query.
  shapeSdf(clip, 0, 0, 0);
}

function validateFiniteTiling(
  tiling: ResolvedFiniteTiling,
  dimension: PointTilingDimension,
): void {
  const canonical = TILING_GROUP_INFO[tiling.group];
  if (tiling.info !== canonical) {
    throw new Error(
      "point tiling: finite tiling must carry its canonical TILING_GROUP_INFO entry",
    );
  }
  if (tiling.info.dim !== dimension) {
    throw new Error(
      `point tiling: ${tiling.group} is ${tiling.info.dim}D, not ${dimension}D`,
    );
  }
  assertAnalyticClip(tiling.clip);
}

function validateLatticeTiling(tiling: ResolvedLatticeTiling): void {
  if (!isCanonicalResolvedLatticeTiling(tiling)) {
    throw new Error(
      "point tiling: lattice plan requires the canonical resolveTiling result",
    );
  }
  if (
    tiling.presentation.fadeStartRadius !==
      tiling.radius * LATTICE_PRESENTATION_FADE_START_MULT ||
    tiling.presentation.outerRadius !==
      tiling.radius * LATTICE_PRESENTATION_RADIUS_MULT
  ) {
    throw new Error(
      "point tiling: point-family lattice presentation is frozen at 8R -> 10R",
    );
  }
  assertAnalyticClip(tiling.clip);
}

function repeatedAxes(dimension: PointTilingDimension): 2 | 3 {
  return dimension === 3 ? 2 : 3;
}

function cellIndexAt(
  cells: Int16Array,
  repeated: number,
  cell: number,
  axis: number,
): number {
  return cells[cell * repeated + axis];
}

function cellIsStabilizedDuplicate(
  cells: Int16Array,
  repeated: number,
  cell: number,
  wallMask: number,
): boolean {
  for (let axis = 0; axis < repeated; axis++) {
    if (
      (wallMask & (1 << axis)) !== 0 &&
      Math.abs(cellIndexAt(cells, repeated, cell, axis)) % 2 === 1
    ) {
      return true;
    }
  }
  return false;
}

function buildLatticeCdf(
  cells: Int16Array,
  proposalWeight: Float64Array,
  repeated: number,
  wallMask: number,
  allowEmpty = false,
): LatticePointTilingCdf {
  const ordinals: number[] = [];
  for (let cell = 0; cell < proposalWeight.length; cell++) {
    if (cellIsStabilizedDuplicate(cells, repeated, cell, wallMask)) continue;
    if (proposalWeight[cell] <= 0) continue;
    ordinals.push(cell);
  }
  if (ordinals.length === 0) {
    if (!allowEmpty) {
      throw new Error("point tiling: lattice proposal CDF has no finite mass");
    }
    return {
      cellOrdinals: new Uint16Array(0),
      cumulative: new Float64Array(0),
      upperTotal: 0,
    };
  }
  // Add ceilings from smallest to largest. With at most 739 terms, every
  // positive addend remains representable relative to the partial f64 sum;
  // this retains tiny carrier-edge mass without a zero-width CPU interval.
  // The u32 phase-grid discrepancy is separately bounded by the exported
  // POINT_TILING_MAX_LATTICE_CURSOR_MASS_ERROR. Cell ordinal breaks equal-
  // weight ties deterministically.
  ordinals.sort((a, b) => proposalWeight[a] - proposalWeight[b] || a - b);
  let upperTotal = 0;
  for (const cell of ordinals) upperTotal += proposalWeight[cell];
  if (!(upperTotal > 0) || !Number.isFinite(upperTotal)) {
    throw new Error("point tiling: lattice proposal CDF has no finite mass");
  }
  const cumulative = new Float64Array(ordinals.length);
  let running = 0;
  let previous = 0;
  for (let index = 0; index < ordinals.length; index++) {
    running += proposalWeight[ordinals[index]];
    const normalized = running / upperTotal;
    if (!(normalized > previous)) {
      throw new Error("point tiling: lattice proposal CDF lost positive mass");
    }
    cumulative[index] = normalized;
    previous = normalized;
  }
  return {
    cellOrdinals: Uint16Array.from(ordinals),
    cumulative,
    upperTotal,
  };
}

/**
 * Build a bounded lattice proposal by multiplying the plan's exact
 * presentation ceilings by one non-negative consumer ceiling per cell.
 * Products below `minimumProduct` are omitted; equality stays live. The
 * caller proves those omitted products cannot pass its own contribution
 * gate. Empty per-mask tables are deliberately valid.
 */
export function createLatticePointTilingProposal(
  plan: LatticePointTilingPlan,
  multipliers: Float64Array,
  minimumProduct = 0,
): LatticePointTilingProposal {
  if (multipliers.length !== plan.upper.length) {
    throw new RangeError(
      `point tiling: lattice proposal has ${multipliers.length} multipliers for ${plan.upper.length} cells`,
    );
  }
  if (!Number.isFinite(minimumProduct) || minimumProduct < 0) {
    throw new RangeError(
      "point tiling: lattice proposal minimum product must be finite and non-negative",
    );
  }
  const products = new Float64Array(plan.upper.length);
  for (let cell = 0; cell < products.length; cell++) {
    const multiplier = multipliers[cell];
    if (!Number.isFinite(multiplier) || multiplier < 0) {
      throw new RangeError(
        "point tiling: lattice proposal multipliers must be finite and non-negative",
      );
    }
    const product = plan.upper[cell] * multiplier;
    products[cell] = product < minimumProduct ? 0 : product;
  }
  return {
    cdfByWallMask: Object.freeze(
      Array.from({ length: 1 << plan.repeatedAxes }, (_, mask) =>
        buildLatticeCdf(plan.cells, products, plan.repeatedAxes, mask, true),
      ),
    ),
  };
}

function buildLatticePlan(
  tiling: ResolvedLatticeTiling,
  dimension: PointTilingDimension,
): LatticePointTilingPlan {
  validateLatticeTiling(tiling);
  const repeated = repeatedAxes(dimension);
  const { radius, h, presentation } = tiling;
  const indexRadius = (presentation.outerRadius + radius) / (2 * h);
  const maxIndex = Math.floor(indexRadius);
  const tuples: number[] = [];
  const prefix = new Int16Array(repeated);
  const walk = (axis: number): void => {
    if (axis === repeated) {
      let radiusSquared = 0;
      for (let i = 0; i < repeated; i++) {
        radiusSquared += prefix[i] * prefix[i];
      }
      if (radiusSquared <= indexRadius * indexRadius) {
        for (let i = 0; i < repeated; i++) tuples.push(prefix[i]);
      }
      return;
    }
    for (let index = -maxIndex; index <= maxIndex; index++) {
      prefix[axis] = index;
      walk(axis + 1);
    }
  };
  walk(0);
  if (tuples.length / repeated > POINT_TILING_MAX_LATTICE_CELLS) {
    throw new Error(
      `point tiling: lattice plan has ${tuples.length / repeated} cells, cap is ${POINT_TILING_MAX_LATTICE_CELLS}`,
    );
  }
  const allCells = Int16Array.from(tuples);
  const allUpper = new Float64Array(tuples.length / repeated);
  const liveOrdinals: number[] = [];
  for (let cell = 0; cell < allUpper.length; cell++) {
    let indexRadiusSquared = 0;
    for (let axis = 0; axis < repeated; axis++) {
      const index = cellIndexAt(allCells, repeated, cell, axis);
      indexRadiusSquared += index * index;
    }
    const centerRadius = 2 * h * Math.sqrt(indexRadiusSquared);
    const lowerRadius = Math.max(0, centerRadius - radius);
    const upper = latticePresentationVisibility(
      lowerRadius,
      presentation.fadeStartRadius,
      presentation.outerRadius,
    );
    if (upper > 0) {
      liveOrdinals.push(cell);
      allUpper[cell] = upper;
    }
  }
  const cells = new Int16Array(liveOrdinals.length * repeated);
  const upper = new Float64Array(liveOrdinals.length);
  for (let target = 0; target < liveOrdinals.length; target++) {
    const source = liveOrdinals[target];
    for (let axis = 0; axis < repeated; axis++) {
      cells[target * repeated + axis] = cellIndexAt(
        allCells,
        repeated,
        source,
        axis,
      );
    }
    upper[target] = allUpper[source];
  }
  if (upper.length > POINT_TILING_MAX_LATTICE_CELLS) {
    throw new Error(
      "point tiling: live lattice CDF exceeds the frozen cell cap",
    );
  }
  const cdfByWallMask = Array.from({ length: 1 << repeated }, (_, mask) =>
    buildLatticeCdf(cells, upper, repeated, mask),
  );
  const memoryBytes =
    cells.byteLength +
    upper.byteLength +
    cdfByWallMask.reduce(
      (bytes, cdf) =>
        bytes + cdf.cellOrdinals.byteLength + cdf.cumulative.byteLength,
      0,
    );
  if (memoryBytes > POINT_TILING_PLAN_MEMORY_CAP_BYTES) {
    throw new Error(
      `point tiling: lattice plan requires ${memoryBytes} bytes, cap is ${POINT_TILING_PLAN_MEMORY_CAP_BYTES}`,
    );
  }
  return {
    kind: "lattice",
    dimension,
    tiling,
    repeatedAxes: repeated,
    cells,
    upper,
    cdfByWallMask: Object.freeze(cdfByWallMask),
    memoryBytes,
  };
}

/** Resolve the one pure point-image plan. Absent tiling returns before any
 * cache lookup or allocation, preserving the classic caller path. */
export function resolvePointTilingPlan(
  tiling: ResolvedTiling | null | undefined,
  dimension: PointTilingDimension,
): PointTilingPlan | null {
  if (!tiling) return null;
  if (isResolvedLatticeTiling(tiling)) {
    return buildLatticePlan(tiling, dimension);
  }
  validateFiniteTiling(tiling, dimension);
  const cached = finiteGroupCache(tiling.info);
  return {
    kind: "finite",
    dimension,
    tiling,
    matrices: cached.matrices,
    representativesByWallMask: cached.representativesByWallMask,
    memoryBytes: cached.memoryBytes,
  };
}

function clipContains(
  clip: ShapeSpec | undefined,
  x: number,
  y: number,
  z: number,
): boolean {
  return !clip || shapeSdf(clip, x, y, z) <= 0;
}

function rootPairing(
  info: TilingGroupInfo,
  wall: number,
  x: number,
  y: number,
  z: number,
  w: number,
): number {
  const base = wall * info.dim;
  return (
    info.roots[base] * x +
    info.roots[base + 1] * y +
    info.roots[base + 2] * z +
    (info.dim === 4 ? info.roots[base + 3] * w : 0)
  );
}

function finiteStabilizerMask(
  info: TilingGroupInfo,
  x: number,
  y: number,
  z: number,
  w: number,
): number {
  let mask = 0;
  const tolerance =
    POINT_TILING_STABILIZER_REL_EPS *
    (info.dim === 4 ? Math.hypot(x, y, z, w) : Math.hypot(x, y, z));
  for (let wall = 0; wall < info.dim; wall++) {
    const pairing = rootPairing(info, wall, x, y, z, w);
    if (Math.abs(pairing) <= tolerance) mask |= 1 << wall;
  }
  return mask;
}

function finiteChamberContains(
  info: TilingGroupInfo,
  x: number,
  y: number,
  z: number,
  w: number,
): boolean {
  for (let wall = 0; wall < info.dim; wall++) {
    if (rootPairing(info, wall, x, y, z, w) < -FOLD_EPS) return false;
  }
  return true;
}

function latticeStabilizerMask(
  plan: LatticePointTilingPlan,
  x: number,
  z: number,
  w: number,
): number {
  const { h } = plan.tiling;
  const tolerance = POINT_TILING_STABILIZER_REL_EPS * Math.abs(h);
  let mask = 0;
  if (Math.abs(Math.abs(x) - h) <= tolerance) mask |= 1;
  if (Math.abs(Math.abs(z) - h) <= tolerance) mask |= 2;
  if (plan.dimension === 4 && Math.abs(Math.abs(w) - h) <= tolerance) {
    mask |= 4;
  }
  return mask;
}

/** Canonical-source membership, after the caller's schedule and final lens. */
export function pointTilingContains(
  plan: PointTilingPlan,
  x: number,
  y: number,
  z: number,
  w: number,
): boolean {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z) ||
    (plan.dimension === 4 && !Number.isFinite(w))
  ) {
    return false;
  }
  if (plan.kind === "finite") {
    return (
      finiteChamberContains(plan.tiling.info, x, y, z, w) &&
      clipContains(plan.tiling.clip, x, y, z)
    );
  }
  const radiusSquared =
    x * x + y * y + z * z + (plan.dimension === 4 ? w * w : 0);
  return (
    radiusSquared <= plan.tiling.radius * plan.tiling.radius &&
    clipContains(plan.tiling.clip, x, y, z)
  );
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x;
}

/** Coprime walk used by every bounded finite-image consumer. Exported for
 * the GPU tail packer so the CPU visitor and both kernels share the stride
 * instead of independently solving the same permutation. */
export function pointTilingCursorStride(count: number): number {
  if (count <= 1) return 1;
  let stride = Math.max(1, Math.floor(count * 0.6180339887498948));
  while (gcd(stride, count) !== 1) stride++;
  return stride;
}

function visitFiniteMatrix(
  matrix: Float64Array,
  dimension: PointTilingDimension,
  sourceX: number,
  sourceY: number,
  sourceZ: number,
  sourceW: number,
  weight: number,
  candidate: number,
  visitor: PointTilingImageVisitor,
): void {
  const x =
    matrix[0] * sourceX +
    matrix[1] * sourceY +
    matrix[2] * sourceZ +
    (dimension === 4 ? matrix[3] * sourceW : 0);
  const row1 = dimension;
  const y =
    matrix[row1] * sourceX +
    matrix[row1 + 1] * sourceY +
    matrix[row1 + 2] * sourceZ +
    (dimension === 4 ? matrix[row1 + 3] * sourceW : 0);
  const row2 = dimension * 2;
  const z =
    matrix[row2] * sourceX +
    matrix[row2 + 1] * sourceY +
    matrix[row2 + 2] * sourceZ +
    (dimension === 4 ? matrix[row2 + 3] * sourceW : 0);
  let w = 0;
  if (dimension === 4) {
    const row3 = 12;
    w =
      matrix[row3] * sourceX +
      matrix[row3 + 1] * sourceY +
      matrix[row3 + 2] * sourceZ +
      matrix[row3 + 3] * sourceW;
  }
  visitor(x, y, z, w, weight, candidate);
}

function latticeCoordinate(source: number, index: number, h: number): number {
  return 2 * h * index + (Math.abs(index) % 2 === 0 ? source : -source);
}

function rawRadius(
  dimension: PointTilingDimension,
  x: number,
  y: number,
  z: number,
  w: number,
): number {
  return dimension === 4 ? Math.hypot(x, y, z, w) : Math.hypot(x, y, z);
}

/** Shared 3D/raw-4D 8R -> 10R coverage evaluation. */
export function pointTilingLatticeVisibility(
  plan: LatticePointTilingPlan,
  radialDistance: number,
): number {
  return latticePresentationVisibility(
    radialDistance,
    plan.tiling.presentation.fadeStartRadius,
    plan.tiling.presentation.outerRadius,
  );
}

/** Exhaustive set oracle. It filters canonical membership and invokes one
 * allocation-free callback per distinct raw image. */
export function visitPointTilingImagesExhaustive(
  plan: PointTilingPlan,
  sourceX: number,
  sourceY: number,
  sourceZ: number,
  sourceW: number,
  visitor: PointTilingImageVisitor,
): number {
  if (!pointTilingContains(plan, sourceX, sourceY, sourceZ, sourceW)) return 0;
  if (plan.kind === "finite") {
    const mask = finiteStabilizerMask(
      plan.tiling.info,
      sourceX,
      sourceY,
      sourceZ,
      sourceW,
    );
    const representatives = plan.representativesByWallMask[mask];
    for (const matrixIndex of representatives) {
      visitFiniteMatrix(
        plan.matrices[matrixIndex],
        plan.dimension,
        sourceX,
        sourceY,
        sourceZ,
        sourceW,
        1,
        matrixIndex,
        visitor,
      );
    }
    return representatives.length;
  }
  const mask = latticeStabilizerMask(plan, sourceX, sourceZ, sourceW);
  let emitted = 0;
  for (let cell = 0; cell < plan.upper.length; cell++) {
    if (cellIsStabilizedDuplicate(plan.cells, plan.repeatedAxes, cell, mask)) {
      continue;
    }
    const x = latticeCoordinate(
      sourceX,
      cellIndexAt(plan.cells, plan.repeatedAxes, cell, 0),
      plan.tiling.h,
    );
    const y = sourceY;
    const z = latticeCoordinate(
      sourceZ,
      cellIndexAt(plan.cells, plan.repeatedAxes, cell, 1),
      plan.tiling.h,
    );
    const w =
      plan.dimension === 4
        ? latticeCoordinate(
            sourceW,
            cellIndexAt(plan.cells, plan.repeatedAxes, cell, 2),
            plan.tiling.h,
          )
        : 0;
    const radial = rawRadius(plan.dimension, x, y, z, w);
    if (radial > plan.tiling.presentation.outerRadius) continue;
    const visibility = pointTilingLatticeVisibility(plan, radial);
    if (visibility <= 0) continue;
    visitor(x, y, z, w, visibility, cell);
    emitted++;
  }
  return emitted;
}

export function createPointTilingCursorState(): PointTilingCursorState {
  return {
    credit: 0,
    cursor: 0,
    attempts: 0,
    accepted: 0,
    selected: 0,
    emitted: 0,
  };
}

export function createPointTilingPointsState(): PointTilingPointsState {
  return {
    cursor: 0,
    quotaRemainder: 0,
    attempts: 0,
    accepted: 0,
    candidateTests: 0,
    emitted: 0,
  };
}

function validatePointsState(state: PointTilingPointsState): void {
  if (!Number.isSafeInteger(state.cursor) || state.cursor < 0) {
    throw new RangeError(
      "point tiling: Points cursor must be a non-negative integer",
    );
  }
  if (state.cursor > 0xffff_ffff) {
    throw new RangeError("point tiling: Points cursor must be a u32");
  }
  if (!Number.isSafeInteger(state.quotaRemainder) || state.quotaRemainder < 0) {
    throw new RangeError(
      "point tiling: Points quota remainder must be a non-negative safe integer",
    );
  }
  if (!Number.isSafeInteger(state.attempts) || state.attempts < 0) {
    throw new RangeError(
      "point tiling: Points attempts must be a non-negative safe integer",
    );
  }
  if (!Number.isSafeInteger(state.accepted) || state.accepted < 0) {
    throw new RangeError(
      "point tiling: Points accepted must be a non-negative safe integer",
    );
  }
  if (!Number.isSafeInteger(state.candidateTests) || state.candidateTests < 0) {
    throw new RangeError(
      "point tiling: Points candidate tests must be a non-negative safe integer",
    );
  }
  if (!Number.isSafeInteger(state.emitted) || state.emitted < 0) {
    throw new RangeError(
      "point tiling: Points emitted must be a non-negative safe integer",
    );
  }
}

function validateCursorState(state: PointTilingCursorState): void {
  if (!Number.isSafeInteger(state.credit) || state.credit < 0) {
    throw new RangeError(
      "point tiling: credit must be a non-negative safe integer",
    );
  }
  if (!Number.isSafeInteger(state.cursor) || state.cursor < 0) {
    throw new RangeError("point tiling: cursor must be a non-negative integer");
  }
  if (!Number.isSafeInteger(state.attempts) || state.attempts < 0) {
    throw new RangeError(
      "point tiling: attempts must be a non-negative safe integer",
    );
  }
  if (!Number.isSafeInteger(state.accepted) || state.accepted < 0) {
    throw new RangeError(
      "point tiling: accepted must be a non-negative safe integer",
    );
  }
  if (!Number.isSafeInteger(state.selected) || state.selected < 0) {
    throw new RangeError(
      "point tiling: selected must be a non-negative safe integer",
    );
  }
  if (!Number.isSafeInteger(state.emitted) || state.emitted < 0) {
    throw new RangeError(
      "point tiling: emitted must be a non-negative safe integer",
    );
  }
  if (state.cursor > 0xffff_ffff) {
    throw new RangeError("point tiling: cursor must be a u32");
  }
}

function locateCdf(cumulative: Float64Array, target: number): number {
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (target < cumulative[middle]) high = middle;
    else low = middle + 1;
  }
  return low;
}

function visitFiniteBounded(
  plan: FinitePointTilingPlan,
  sourceX: number,
  sourceY: number,
  sourceZ: number,
  sourceW: number,
  selected: number,
  cursor: number,
  visitor: PointTilingImageVisitor,
): number {
  const mask = finiteStabilizerMask(
    plan.tiling.info,
    sourceX,
    sourceY,
    sourceZ,
    sourceW,
  );
  const representatives = plan.representativesByWallMask[mask];
  const stride = pointTilingCursorStride(representatives.length);
  const weight = representatives.length / selected;
  for (let sample = 0; sample < selected; sample++) {
    const ordinal =
      (((cursor % representatives.length) + sample) * stride) %
      representatives.length;
    const matrixIndex = representatives[ordinal];
    visitFiniteMatrix(
      plan.matrices[matrixIndex],
      plan.dimension,
      sourceX,
      sourceY,
      sourceZ,
      sourceW,
      weight,
      matrixIndex,
      visitor,
    );
  }
  return selected;
}

function u32Phase(cursor: number): number {
  return Math.imul(cursor, GOLDEN_U32) >>> 0;
}

function radicalInverseU32(value: number, base: 2 | 3): number {
  let remaining = value >>> 0;
  let place = 1 / base;
  let result = 0;
  while (remaining > 0) {
    result += (remaining % base) * place;
    remaining = Math.floor(remaining / base);
    place /= base;
  }
  return result;
}

function visitLatticeBounded(
  plan: LatticePointTilingPlan,
  sourceX: number,
  sourceY: number,
  sourceZ: number,
  sourceW: number,
  selected: number,
  cursor: number,
  visitor: PointTilingImageVisitor,
  cdf: LatticePointTilingCdf,
): number {
  const phase = u32Phase(cursor) / U32_RANGE;
  let emitted = 0;
  for (let sample = 0; sample < selected; sample++) {
    const unit = (sample + phase) / selected;
    const proposal = locateCdf(cdf.cumulative, unit);
    const cell = cdf.cellOrdinals[proposal];
    const x = latticeCoordinate(
      sourceX,
      cellIndexAt(plan.cells, plan.repeatedAxes, cell, 0),
      plan.tiling.h,
    );
    const y = sourceY;
    const z = latticeCoordinate(
      sourceZ,
      cellIndexAt(plan.cells, plan.repeatedAxes, cell, 1),
      plan.tiling.h,
    );
    const w =
      plan.dimension === 4
        ? latticeCoordinate(
            sourceW,
            cellIndexAt(plan.cells, plan.repeatedAxes, cell, 2),
            plan.tiling.h,
          )
        : 0;
    const radial = rawRadius(plan.dimension, x, y, z, w);
    if (radial > plan.tiling.presentation.outerRadius) continue;
    const visibility = pointTilingLatticeVisibility(plan, radial);
    if (visibility <= 0) continue;
    const previous = proposal === 0 ? 0 : cdf.cumulative[proposal - 1];
    const probability = cdf.cumulative[proposal] - previous;
    const weight = visibility / (probability * selected);
    visitor(x, y, z, w, weight, cell);
    emitted++;
  }
  return emitted;
}

function visitFinitePoints(
  plan: FinitePointTilingPlan,
  sourceX: number,
  sourceY: number,
  sourceZ: number,
  sourceW: number,
  quota: number,
  state: PointTilingPointsState,
  visitor: PointTilingImageVisitor,
): number {
  const mask = finiteStabilizerMask(
    plan.tiling.info,
    sourceX,
    sourceY,
    sourceZ,
    sourceW,
  );
  const representatives = plan.representativesByWallMask[mask];
  const stride = pointTilingCursorStride(representatives.length);
  for (let sample = 0; sample < quota; sample++) {
    const ordinal =
      (((state.cursor % representatives.length) + sample) * stride) %
      representatives.length;
    const matrixIndex = representatives[ordinal];
    visitFiniteMatrix(
      plan.matrices[matrixIndex],
      plan.dimension,
      sourceX,
      sourceY,
      sourceZ,
      sourceW,
      1,
      matrixIndex,
      visitor,
    );
  }
  state.cursor = (state.cursor + quota) >>> 0;
  return quota;
}

function visitLatticePoints(
  plan: LatticePointTilingPlan,
  sourceX: number,
  sourceY: number,
  sourceZ: number,
  sourceW: number,
  state: PointTilingPointsState,
  visitor: PointTilingImageVisitor,
): number {
  const mask = latticeStabilizerMask(plan, sourceX, sourceZ, sourceW);
  const cdf = plan.cdfByWallMask[mask];
  const ordinal = (state.cursor + 1) >>> 0;
  state.cursor = ordinal;
  state.candidateTests++;
  const proposal = locateCdf(cdf.cumulative, radicalInverseU32(ordinal, 2));
  const cell = cdf.cellOrdinals[proposal];
  const x = latticeCoordinate(
    sourceX,
    cellIndexAt(plan.cells, plan.repeatedAxes, cell, 0),
    plan.tiling.h,
  );
  const y = sourceY;
  const z = latticeCoordinate(
    sourceZ,
    cellIndexAt(plan.cells, plan.repeatedAxes, cell, 1),
    plan.tiling.h,
  );
  const w =
    plan.dimension === 4
      ? latticeCoordinate(
          sourceW,
          cellIndexAt(plan.cells, plan.repeatedAxes, cell, 2),
          plan.tiling.h,
        )
      : 0;
  const radial = rawRadius(plan.dimension, x, y, z, w);
  if (radial > plan.tiling.presentation.outerRadius) return 0;
  const visibility = pointTilingLatticeVisibility(plan, radial);
  if (visibility <= 0) return 0;
  if (radicalInverseU32(ordinal, 3) >= visibility / plan.upper[cell]) return 0;
  visitor(x, y, z, w, 1, cell);
  return 1;
}

/** Points-only equal-density attempt. The caller owns the total output,
 * source-attempt, and lattice-proposal caps and passes its remaining output
 * capacity. A zero capacity is a no-op. Finite groups emit an exact integer
 * stabilizer-proportional quota; lattices test one base-2 proposal and thin it
 * with the paired base-3 coordinate. Every callback weight is literally one,
 * and no chaos RNG is accepted or consumed. */
export function visitPointTilingPointsAttemptBounded(
  plan: PointTilingPlan,
  sourceX: number,
  sourceY: number,
  sourceZ: number,
  sourceW: number,
  outputRemaining: number,
  state: PointTilingPointsState,
  visitor: PointTilingImageVisitor,
): number {
  if (!Number.isSafeInteger(outputRemaining) || outputRemaining < 0) {
    throw new RangeError(
      "point tiling: Points output capacity must be a non-negative safe integer",
    );
  }
  validatePointsState(state);
  if (plan.kind === "finite") {
    if (
      (plan.tiling.info.order <= POINT_TILING_POINTS_FANOUT_CAP &&
        state.quotaRemainder !== 0) ||
      state.quotaRemainder >= plan.tiling.info.order
    ) {
      throw new RangeError(
        "point tiling: Points quota remainder is invalid for the finite group",
      );
    }
  } else if (state.quotaRemainder !== 0) {
    throw new RangeError(
      "point tiling: lattice Points state cannot carry a finite quota remainder",
    );
  }
  if (outputRemaining === 0) return 0;
  if (
    state.attempts === Number.MAX_SAFE_INTEGER ||
    state.accepted === Number.MAX_SAFE_INTEGER ||
    state.emitted === Number.MAX_SAFE_INTEGER ||
    (plan.kind === "lattice" &&
      state.candidateTests === Number.MAX_SAFE_INTEGER)
  ) {
    throw new RangeError("point tiling: Points counters exceed safe integers");
  }
  state.attempts++;
  if (!pointTilingContains(plan, sourceX, sourceY, sourceZ, sourceW)) return 0;
  state.accepted++;
  let emitted: number;
  if (plan.kind === "finite") {
    const mask = finiteStabilizerMask(
      plan.tiling.info,
      sourceX,
      sourceY,
      sourceZ,
      sourceW,
    );
    const candidates = plan.representativesByWallMask[mask].length;
    let quota: number;
    if (plan.tiling.info.order <= POINT_TILING_POINTS_FANOUT_CAP) {
      quota = candidates;
    } else {
      const numerator =
        state.quotaRemainder + POINT_TILING_POINTS_FANOUT_CAP * candidates;
      quota = Math.floor(numerator / plan.tiling.info.order);
      state.quotaRemainder = numerator - quota * plan.tiling.info.order;
    }
    quota = Math.min(quota, candidates, outputRemaining);
    if (state.emitted > Number.MAX_SAFE_INTEGER - quota) {
      throw new RangeError(
        "point tiling: Points emitted counter exceeds safe integer",
      );
    }
    emitted = visitFinitePoints(
      plan,
      sourceX,
      sourceY,
      sourceZ,
      sourceW,
      quota,
      state,
      visitor,
    );
  } else {
    emitted = visitLatticePoints(
      plan,
      sourceX,
      sourceY,
      sourceZ,
      sourceW,
      state,
      visitor,
    );
  }
  state.emitted += emitted;
  return emitted;
}

/** One production-shaped, allocation-free source attempt. Every attempt banks
 * one credit; an accepted source spends at most `fanoutCap`, leaving any
 * remainder for later acceptances. The return value is emitted callbacks;
 * membership and selection deltas remain in caller-owned `state`. */
export function visitPointTilingAttemptBounded(
  plan: PointTilingPlan,
  sourceX: number,
  sourceY: number,
  sourceZ: number,
  sourceW: number,
  fanoutCap: number,
  state: PointTilingCursorState,
  visitor: PointTilingImageVisitor,
  latticeProposal?: LatticePointTilingProposal,
): number {
  if (!Number.isSafeInteger(fanoutCap) || fanoutCap <= 0) {
    throw new RangeError("point tiling: fanoutCap must be a positive integer");
  }
  validateCursorState(state);
  if (plan.kind === "finite" && latticeProposal !== undefined) {
    throw new RangeError(
      "point tiling: a lattice proposal cannot select finite-group images",
    );
  }
  if (
    state.credit === Number.MAX_SAFE_INTEGER ||
    state.attempts === Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError("point tiling: attempt counters exceed safe integers");
  }
  state.attempts++;
  state.credit++;
  if (!pointTilingContains(plan, sourceX, sourceY, sourceZ, sourceW)) {
    return 0;
  }
  if (state.accepted === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("point tiling: accepted counter exceeds safe integer");
  }
  let candidates: number;
  let latticeCdf: LatticePointTilingCdf | undefined;
  if (plan.kind === "finite") {
    const mask = finiteStabilizerMask(
      plan.tiling.info,
      sourceX,
      sourceY,
      sourceZ,
      sourceW,
    );
    candidates = plan.representativesByWallMask[mask].length;
  } else {
    const mask = latticeStabilizerMask(plan, sourceX, sourceZ, sourceW);
    latticeCdf = (latticeProposal ?? plan).cdfByWallMask[mask];
    if (!latticeCdf) {
      throw new RangeError(
        "point tiling: lattice proposal is missing a stabilizer-mask CDF",
      );
    }
    candidates = latticeCdf.cellOrdinals.length;
  }
  const selected = Math.min(state.credit, candidates, fanoutCap);
  if (
    state.selected > Number.MAX_SAFE_INTEGER - selected ||
    state.emitted > Number.MAX_SAFE_INTEGER - selected
  ) {
    throw new RangeError(
      "point tiling: cumulative counters exceed safe integers",
    );
  }
  state.accepted++;
  state.credit -= selected;
  const emitted =
    plan.kind === "finite"
      ? visitFiniteBounded(
          plan,
          sourceX,
          sourceY,
          sourceZ,
          sourceW,
          selected,
          state.cursor,
          visitor,
        )
      : visitLatticeBounded(
          plan,
          sourceX,
          sourceY,
          sourceZ,
          sourceW,
          selected,
          latticeProposal === undefined
            ? state.cursor
            : (state.cursor + selected) >>> 0,
          visitor,
          latticeCdf!,
        );
  state.cursor = (state.cursor + selected) >>> 0;
  state.selected += selected;
  state.emitted += emitted;
  return emitted;
}

export function pointTilingPointsAttemptLimit(requested: number): number {
  if (!Number.isSafeInteger(requested) || requested < 0) {
    throw new RangeError(
      "point tiling: requested point count must be a non-negative safe integer",
    );
  }
  const limit = requested * POINT_TILING_POINTS_ATTEMPT_FACTOR;
  if (!Number.isSafeInteger(limit)) {
    throw new RangeError(
      "point tiling: point attempt limit exceeds safe integer",
    );
  }
  return limit;
}

export function pointTilingStatus(
  requested: number,
  produced: number,
): PointTilingStatus {
  if (
    !Number.isSafeInteger(requested) ||
    requested < 0 ||
    !Number.isSafeInteger(produced) ||
    produced < 0
  ) {
    throw new RangeError(
      "point tiling: requested and produced counts must be non-negative safe integers",
    );
  }
  if (produced >= requested) return "complete";
  if (produced === 0) return "empty";
  return "underfilled";
}
