/**
 * Point-space tiling decision sheet.
 *
 * This is the executable argument for the forward-sampled tiling contract in
 * `docs/tiling-contract.md`. It deliberately lives ahead of the runtime
 * module: the local matrix/cell expansion is the exhaustive candidate whose
 * selected policy is implemented by `src/fractal/point-tiling.ts`.
 *
 * QUESTION. How can Points, Flame, the generated Flame backdrop and genuine
 * 4D Sampled Solid render
 *
 *   finite:  G · (A ∩ C ∩ clip)
 *   lattice: L · (A ∩ ball(0,R) ∩ clip)
 *
 * after the ordinary orbit's schedule and final lens, without folding an
 * orbit point, feeding an image back, consuming a primary RNG draw, or
 * multiplying work by F4's order / every visible lattice cell?
 *
 * CANDIDATES. The sheet compares exhaustive replication, complete-orbit
 * output budgeting, one-image cycling, acceptance-credit stratified fanout,
 * and a Points-only equal-density realization. Finite Points use an integer
 * stabilizer-proportional quota plus image cycling; lattice Points sample the
 * proposal CDF and thin by V/u. Every stochastic-looking choice below is an
 * explicit deterministic cursor; the chaos stream is not consulted.
 * Accumulation samples retain inverse-inclusion weights, and histogram
 * comparisons are normalized so brightness cannot disguise missing detail.
 *
 * CARRIER QUESTION. The existing 4D point/flame projection has a 0.06 ghost
 * floor, so a displayed-3D carrier leaves infinitely many raw-w lattice
 * images visible. This sheet compares that failure with a rotation-invariant
 * raw-space radial carrier. The selected carrier reuses Surface's measured
 * 8R -> 10R multiplier pair, but evaluates radius before 4D view reduction;
 * its cell list and smoothstep weight are therefore invariant under every
 * supported rotor.
 *
 * PREDECLARED LIMITS. These constants are the decision, not values tuned from
 * the assertions at the bottom:
 *
 * - 16,384 independent points measure canonical acceptance here; production
 *   needs no acceptance pilot because each attempted source earns one fanout
 *   credit and accepted sources can spend only banked credit;
 * - Points: finite groups emit at most 256 equal-weight images per accepted
 *   source; lattices test one CDF proposal per accepted source and thin it by
 *   V/u; source attempts and lattice proposal tests each stop at 8× requested,
 *   while output arrays never exceed the authored point count;
 * - Flame CPU/WebGPU, its backdrop, and pre-projection 4D Solid: at most 32
 *   image deposits per accepted source; authored iteration budgets continue
 *   to count primary orbit steps;
 * - a resolved plan carries at most 1,152 F4 matrices or 739 tight radial
 *   lattice cells at the imported mathematical minimum cellScale=1, below
 *   256KiB even as f64 matrices plus u16 indices;
 * - empty/underfilled is a result, never permission to emit the untiled point.
 *
 * MEASURED VERDICT (Node 22, 2026-09-01). Canonical acceptance was exactly
 * 1/order for all six groups. Equal-density finite Points matched the weighted
 * F4 estimator exactly: 98.2% reference occupancy at L1 0.0484, versus 97.5%
 * / L1 0.1195 for complete-orbit budgeting and 29.8% / L1 0.8885 for one-image
 * cycling. A B4 wall got 128 equal dots against a generic source's 256, exactly
 * its 192/384 orbit ratio. Proposal-CDF thinning filled 4,096 equal lattice
 * dots in 5,008/5,555 tests in 3D/4D, retaining 70.1%/63.7% occupancy at L1
 * 0.2242/0.2895; the weighted comparators retained 74.4%/68.7% at L1
 * 0.1903/0.2888. Whole and irregularly chunked finite/lattice runs emitted
 * identical sequences. The 32-image accumulation cap retained 89.5% / L1
 * 0.1551 in F4; its acceptance credit held cumulative deposits <= attempts.
 * Tight 10R plans held 97/739 cells at minimum scale in 3D/4D. Raw-4D carrier
 * membership changed zero times under the adversarial rotor (max fade delta
 * 2.78e-15), while the projected alternative exposed 9/17/33 ghosted raw-w
 * cells as its sampled window grew. Every simple-wall orbit was exactly half
 * the group order.
 *
 * Run:
 *   npx vitest run --config scripts/vitest.harness.config.ts \
 *     scripts/point-tiling.harness.ts
 */

import { mulberry32 } from "../src/fractal/rng";
import { shapeSdf } from "../src/fractal/shapes";
import type { ShapeSpec } from "../src/fractal/shapes";
import {
  enumerateOrbit,
  FOLD_EPS,
  foldToChamber,
  isInChamber,
  reflectAcrossWall,
  TILING_GROUP_INFO,
} from "../src/fractal/tiling";
import type { TilingGroup, TilingGroupInfo } from "../src/fractal/tiling";
import {
  LATTICE_PRESENTATION_FADE_START_MULT,
  LATTICE_PRESENTATION_RADIUS_MULT,
  latticePresentationVisibility,
} from "../src/fractal/lattice-march";

// ------------------------------------------------------------- frozen policy

const ACCEPTANCE_PILOT_POINTS = 16_384;
const POINT_FANOUT_CAP = 256;
const POINT_ATTEMPT_FACTOR = 8;
const POINT_LATTICE_PROPOSAL_FACTOR = 8;
const ACCUMULATION_FANOUT_CAP = 32;
const PLAN_MEMORY_CAP_BYTES = 256 * 1024;
const MAX_LATTICE_PLAN_CELLS = 739;
const STABILIZER_EPS = 0.5e-9;

const MOTIF_POINTS = 1_024;
const LATTICE_MOTIF_POINTS = 4_096;
const HIST_SIZE = 64;
type Matrix = Float64Array;
type Point = number[];

interface HistogramMetric {
  l1: number;
  rmse: number;
  occupied: number;
  occupiedOfReference: number;
}

interface PolicyRow {
  label: string;
  fanout: number;
  deposits: number;
  sourcePoints: number;
  metric: HistogramMetric;
}

const ANALYTIC_CLIP: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "sphere", radius: 0.55 },
      combine: "union",
    },
  ],
};

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** A stable, well-spread permutation stride, adjusted to be coprime to n. */
function cursorStride(n: number): number {
  if (n <= 1) return 1;
  let stride = Math.max(1, Math.floor(n * 0.6180339887498948));
  while (gcd(stride, n) !== 1) stride++;
  return stride;
}

function identity(dim: number): Matrix {
  const out = new Float64Array(dim * dim);
  for (let i = 0; i < dim; i++) out[i * dim + i] = 1;
  return out;
}

function reflectionMatrix(info: TilingGroupInfo, wall: number): Matrix {
  const dim = info.dim;
  const out = identity(dim);
  const base = wall * dim;
  for (let row = 0; row < dim; row++) {
    for (let col = 0; col < dim; col++) {
      out[row * dim + col] -=
        2 * info.roots[base + row] * info.roots[base + col];
    }
  }
  return out;
}

function multiply(a: Matrix, b: Matrix, dim: number): Matrix {
  const out = new Float64Array(dim * dim);
  for (let row = 0; row < dim; row++) {
    for (let col = 0; col < dim; col++) {
      let sum = 0;
      for (let k = 0; k < dim; k++) {
        sum += a[row * dim + k] * b[k * dim + col];
      }
      out[row * dim + col] = sum;
    }
  }
  return out;
}

function applyMatrix(matrix: Matrix, point: Point, dim: number): Point {
  const out = new Array<number>(dim);
  for (let row = 0; row < dim; row++) {
    let sum = 0;
    for (let col = 0; col < dim; col++) {
      sum += matrix[row * dim + col] * point[col];
    }
    out[row] = sum;
  }
  return out;
}

function matrixNear(a: Matrix, b: Matrix): boolean {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max <= 2e-10;
}

/** Local exhaustive group builder. The production authority lands next. */
function buildGroupMatrices(info: TilingGroupInfo): Matrix[] {
  const dim = info.dim;
  const generators = Array.from({ length: dim }, (_, wall) =>
    reflectionMatrix(info, wall),
  );
  const matrices = [identity(dim)];
  for (let head = 0; head < matrices.length; head++) {
    for (const generator of generators) {
      const next = multiply(matrices[head], generator, dim);
      if (!matrices.some((existing) => matrixNear(existing, next))) {
        matrices.push(next);
      }
    }
  }
  return matrices;
}

function norm(point: Point): number {
  let sum = 0;
  for (const x of point) sum += x * x;
  return Math.sqrt(sum);
}

function normalizeInside(point: Point, radius = 0.92): Point {
  const n = norm(point);
  const scale = n > 0 ? radius / n : 0;
  return point.map((x) => x * scale);
}

/** A deterministic asymmetric motif, folded into the canonical chamber. */
function canonicalMotif(info: TilingGroupInfo, count: number): Point[] {
  const rng = mulberry32(0x7007 + info.order);
  const points: Point[] = [];
  while (points.length < count) {
    const raw = Array.from({ length: info.dim }, (_, axis) => {
      const wave = Math.sin((points.length + 1) * (axis + 2) * 0.731);
      return (rng() - 0.5) * 1.4 + wave * 0.3;
    });
    const radial = 0.18 + 0.78 * ((points.length % 97) / 96);
    const unit = normalizeInside(raw, radial);
    const folded = foldToChamber(
      info,
      unit as [number, number, number] | [number, number, number, number],
      new Array<number>(info.dim).fill(0) as
        [number, number, number] | [number, number, number, number],
    );
    if (folded) points.push(Array.from(folded));
  }
  return points;
}

/** Build a group-balanced source stream whose canonical acceptance is 1/N. */
function balancedSource(
  info: TilingGroupInfo,
  matrices: readonly Matrix[],
  cycles: number,
): Point[] {
  const motif = canonicalMotif(info, cycles);
  const source: Point[] = [];
  for (let cycle = 0; cycle < cycles; cycle++) {
    for (const matrix of matrices) {
      source.push(applyMatrix(matrix, motif[cycle], info.dim));
    }
  }
  return source;
}

function boundaryMask(info: TilingGroupInfo, point: Point): number {
  let mask = 0;
  const tolerance = STABILIZER_EPS * norm(point);
  for (let wall = 0; wall < info.dim; wall++) {
    let dot = 0;
    for (let axis = 0; axis < info.dim; axis++) {
      dot += point[axis] * info.roots[wall * info.dim + axis];
    }
    if (Math.abs(dot) <= tolerance) mask |= 1 << wall;
  }
  return mask;
}

function uniqueImages(
  matrices: readonly Matrix[],
  point: Point,
  dim: number,
): Point[] {
  const out: Point[] = [];
  const eps2 = 1e-18 * Math.max(1, norm(point) ** 2);
  for (const matrix of matrices) {
    const image = applyMatrix(matrix, point, dim);
    if (
      !out.some((existing) => {
        let d2 = 0;
        for (let axis = 0; axis < dim; axis++) {
          const d = image[axis] - existing[axis];
          d2 += d * d;
        }
        return d2 <= eps2;
      })
    ) {
      out.push(image);
    }
  }
  return out;
}

function uniquePointList(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    if (
      !out.some((existing) => {
        let d2 = 0;
        for (let axis = 0; axis < point.length; axis++) {
          const d = point[axis] - existing[axis];
          d2 += d * d;
        }
        return d2 <= 1e-18;
      })
    ) {
      out.push(point);
    }
  }
  return out;
}

function acceptanceFanout(
  accepted: number,
  pilotPoints: number,
  candidateCount: number,
  cap: number,
): number {
  // Laplace smoothing keeps a zero-hit pilot finite and deterministic.
  const estimate = (accepted + 1) / (pilotPoints + 2);
  return Math.min(candidateCount, cap, Math.max(1, Math.round(1 / estimate)));
}

interface CreditTrace {
  fanouts: number[];
  deposits: number;
  remainingCredit: number;
  cursor: number;
}

interface FiniteEqualState {
  imageCursor: number;
  quotaRemainder: number;
  deposits: number;
}

interface FiniteEqualResult {
  histogram: Float64Array;
  emissions: string[];
  state: FiniteEqualState;
}

/**
 * Points-only equal-density realization. Generic sources emit one fixed quota;
 * stabilizers receive that quota in exact proportion to their distinct orbit
 * size through an integer remainder. Every emitted point therefore has unit
 * weight, while a coprime cursor distributes partial orbits without an RNG.
 */
function finiteEqualDensityChunk(
  info: TilingGroupInfo,
  matrices: readonly Matrix[],
  source: readonly Point[],
  requested: number,
  state: FiniteEqualState,
  histogram: Float64Array,
  emissions: string[],
  captureEmissions = false,
): void {
  for (const point of source) {
    if (state.deposits >= requested) return;
    const images =
      boundaryMask(info, point) === 0
        ? matrices.map((matrix) => applyMatrix(matrix, point, info.dim))
        : uniqueImages(matrices, point, info.dim);
    let quota: number;
    if (info.order <= POINT_FANOUT_CAP) {
      quota = images.length;
    } else {
      const numerator = state.quotaRemainder + POINT_FANOUT_CAP * images.length;
      quota = Math.floor(numerator / info.order);
      state.quotaRemainder = numerator - quota * info.order;
    }
    quota = Math.min(quota, requested - state.deposits);
    const stride = cursorStride(images.length);
    for (let sample = 0; sample < quota; sample++) {
      const image =
        images[((state.imageCursor + sample) * stride) % images.length];
      addHistogram(histogram, image, info.dim, 1, 1.2);
      if (captureEmissions) {
        emissions.push(image.map((value) => value.toPrecision(17)).join(","));
      }
    }
    state.imageCursor =
      (state.imageCursor + quota) % Math.max(1, images.length);
    state.deposits += quota;
  }
}

function finiteEqualDensityHistogram(
  info: TilingGroupInfo,
  matrices: readonly Matrix[],
  source: readonly Point[],
  requested = Number.MAX_SAFE_INTEGER,
  captureEmissions = false,
): FiniteEqualResult {
  const histogram = new Float64Array(HIST_SIZE * HIST_SIZE);
  const emissions: string[] = [];
  const state: FiniteEqualState = {
    imageCursor: 0,
    quotaRemainder: 0,
    deposits: 0,
  };
  finiteEqualDensityChunk(
    info,
    matrices,
    source,
    requested,
    state,
    histogram,
    emissions,
    captureEmissions,
  );
  return { histogram, emissions, state };
}

/**
 * Production-shaped bounded fanout accounting. An attempt earns one credit;
 * a rejected source cannot spend it, while an accepted source spends no more
 * than its distinct image count and the renderer burst cap. Consequently
 * cumulative deposits never exceed source attempts, without estimating the
 * acceptance probability or consulting the chaos RNG.
 */
function acceptanceCreditTrace(
  accepted: readonly boolean[],
  candidateCount: number,
  cap: number,
  initial: { credit: number; cursor: number } = { credit: 0, cursor: 0 },
): CreditTrace {
  const fanouts: number[] = [];
  let credit = initial.credit;
  let cursor = initial.cursor;
  let deposits = 0;
  for (const isAccepted of accepted) {
    credit++;
    if (!isAccepted) {
      fanouts.push(0);
      continue;
    }
    const fanout = Math.min(credit, candidateCount, cap);
    credit -= fanout;
    deposits += fanout;
    cursor = (cursor + fanout) % candidateCount;
    fanouts.push(fanout);
  }
  return { fanouts, deposits, remainingCredit: credit, cursor };
}

function project2(point: Point, dim: 3 | 4): [number, number] {
  if (dim === 3) return [point[0], point[2]];
  // A genuine xw rotation before dropping w. The carrier is evaluated on the
  // raw point, so this pose must not change candidate membership or weight.
  const angle = 0.63;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * point[0] - s * point[3], point[2]];
}

function addHistogram(
  histogram: Float64Array,
  point: Point,
  dim: 3 | 4,
  weight: number,
  range: number,
): void {
  const [u, v] = project2(point, dim);
  const x = Math.floor(((u / range + 1) * HIST_SIZE) / 2);
  const y = Math.floor(((v / range + 1) * HIST_SIZE) / 2);
  if (x < 0 || y < 0 || x >= HIST_SIZE || y >= HIST_SIZE) return;
  histogram[x + y * HIST_SIZE] += weight;
}

function histogramMetric(
  actual: Float64Array,
  reference: Float64Array,
): HistogramMetric {
  let sumA = 0;
  let sumR = 0;
  for (let i = 0; i < actual.length; i++) {
    sumA += actual[i];
    sumR += reference[i];
  }
  let l1 = 0;
  let squared = 0;
  let occupied = 0;
  let occupiedReference = 0;
  for (let i = 0; i < actual.length; i++) {
    const a = sumA > 0 ? actual[i] / sumA : 0;
    const r = sumR > 0 ? reference[i] / sumR : 0;
    l1 += Math.abs(a - r);
    squared += (a - r) * (a - r);
    if (a > 1e-7) occupied++;
    if (r > 1e-7) occupiedReference++;
  }
  return {
    l1,
    rmse: Math.sqrt(squared / actual.length),
    occupied,
    occupiedOfReference:
      occupiedReference > 0 ? occupied / occupiedReference : 1,
  };
}

function finiteHistogram(
  info: TilingGroupInfo,
  matrices: readonly Matrix[],
  source: readonly Point[],
  fanout: number,
  sourceLimit = source.length,
): { histogram: Float64Array; deposits: number } {
  const histogram = new Float64Array(HIST_SIZE * HIST_SIZE);
  const n = matrices.length;
  const stride = cursorStride(n);
  let cursor = 0;
  let deposits = 0;
  for (let i = 0; i < Math.min(source.length, sourceLimit); i++) {
    const images =
      boundaryMask(info, source[i]) === 0
        ? matrices.map((matrix) => applyMatrix(matrix, source[i], info.dim))
        : uniqueImages(matrices, source[i], info.dim);
    const k = Math.min(fanout, images.length);
    for (let j = 0; j < k; j++) {
      const index = ((cursor + j) * stride) % images.length;
      // Horvitz-Thompson weight: the bounded sample represents the full
      // distinct orbit, so every visible copy retains the exhaustive
      // source density without requiring exhaustive work.
      addHistogram(histogram, images[index], info.dim, images.length / k, 1.2);
      deposits++;
    }
    cursor = (cursor + k) % Math.max(1, images.length);
  }
  return { histogram, deposits };
}

interface LatticeCell {
  index: number[];
}

function latticeCellPlan(
  dim: 3 | 4,
  cellScale: number,
  outerRadius = LATTICE_PRESENTATION_RADIUS_MULT,
): LatticeCell[] {
  const repeated = dim === 3 ? 2 : 3;
  const maxIndex = Math.floor((outerRadius + 1) / (2 * cellScale));
  const cells: LatticeCell[] = [];
  const radiusInIndexSpace = (outerRadius + 1) / (2 * cellScale);
  const walk = (prefix: number[]): void => {
    if (prefix.length === repeated) {
      const radius2 = prefix.reduce((sum, index) => sum + index * index, 0);
      if (radius2 <= radiusInIndexSpace * radiusInIndexSpace) {
        cells.push({ index: prefix });
      }
      return;
    }
    for (let i = -maxIndex; i <= maxIndex; i++) walk([...prefix, i]);
  };
  walk([]);
  return cells;
}

function latticeImage(
  point: Point,
  cell: LatticeCell,
  dim: 3 | 4,
  cellScale: number,
): Point {
  const out = [...point];
  const axes = dim === 3 ? [0, 2] : [0, 2, 3];
  for (let i = 0; i < axes.length; i++) {
    const index = cell.index[i];
    const source = point[axes[i]];
    out[axes[i]] =
      2 * cellScale * index + (Math.abs(index) % 2 === 0 ? source : -source);
  }
  return out;
}

function latticeCandidates(
  point: Point,
  cells: readonly LatticeCell[],
  dim: 3 | 4,
  cellScale: number,
  fadeStartRadius = LATTICE_PRESENTATION_FADE_START_MULT,
  outerRadius = LATTICE_PRESENTATION_RADIUS_MULT,
): { point: Point; visibility: number }[] {
  const out: { point: Point; visibility: number }[] = [];
  const axes = dim === 3 ? [0, 2] : [0, 2, 3];
  for (const cell of cells) {
    // At a closed cell wall the adjacent odd/even affine-A1 images coincide.
    // Keep the even representative on every stabilized axis.
    if (
      axes.some(
        (axis, i) =>
          Math.abs(Math.abs(point[axis]) - cellScale) <=
            STABILIZER_EPS * cellScale && Math.abs(cell.index[i]) % 2 === 1,
      )
    ) {
      continue;
    }
    const image = latticeImage(point, cell, dim, cellScale);
    const radial = norm(image);
    if (radial > outerRadius) continue;
    const visibility = latticePresentationVisibility(
      radial,
      fadeStartRadius,
      outerRadius,
    );
    if (visibility > 0) out.push({ point: image, visibility });
  }
  return out;
}

function latticeHistogram(
  dim: 3 | 4,
  cellScale: number,
  source: readonly Point[],
  fanout: number,
  fadeStartRadius = LATTICE_PRESENTATION_FADE_START_MULT,
  outerRadius = LATTICE_PRESENTATION_RADIUS_MULT,
): {
  histogram: Float64Array;
  deposits: number;
  minCandidates: number;
  maxCandidates: number;
  meanCandidates: number;
  cells: number;
} {
  const histogram = new Float64Array(HIST_SIZE * HIST_SIZE);
  const cells = latticeCellPlan(dim, cellScale, outerRadius);
  let cursor = 0;
  let deposits = 0;
  let minCandidates = Infinity;
  let maxCandidates = 0;
  let candidateTotal = 0;
  for (const point of source) {
    const candidates = latticeCandidates(
      point,
      cells,
      dim,
      cellScale,
      fadeStartRadius,
      outerRadius,
    );
    minCandidates = Math.min(minCandidates, candidates.length);
    maxCandidates = Math.max(maxCandidates, candidates.length);
    candidateTotal += candidates.length;
    const k = Math.min(fanout, candidates.length);
    const stride = cursorStride(candidates.length);
    for (let j = 0; j < k; j++) {
      const candidate = candidates[((cursor + j) * stride) % candidates.length];
      addHistogram(
        histogram,
        candidate.point,
        dim,
        (candidates.length / k) * candidate.visibility,
        1.1 * outerRadius,
      );
      deposits++;
    }
    cursor = (cursor + k) % Math.max(1, candidates.length);
  }
  return {
    histogram,
    deposits,
    minCandidates,
    maxCandidates,
    meanCandidates: candidateTotal / source.length,
    cells: cells.length,
  };
}

interface LatticeStratifiedResult {
  histogram: Float64Array;
  deposits: number;
  candidateTests: number;
  cells: number;
  upperWeight: number;
}

interface LatticeProposalPlan {
  weighted: { cell: LatticeCell; upper: number }[];
  cumulative: Float64Array;
  upperWeight: number;
}

function latticeProposalPlan(
  dim: 3 | 4,
  cellScale: number,
  fadeStartRadius: number,
  outerRadius: number,
): LatticeProposalPlan {
  const weighted = latticeCellPlan(dim, cellScale, outerRadius)
    .map((cell) => {
      const centreRadius =
        2 * cellScale * Math.sqrt(cell.index.reduce((s, k) => s + k * k, 0));
      const upper = latticePresentationVisibility(
        Math.max(0, centreRadius - 1),
        fadeStartRadius,
        outerRadius,
      );
      return { cell, upper };
    })
    .filter(({ upper }) => upper > 0);
  const cumulative = new Float64Array(weighted.length);
  let upperWeight = 0;
  weighted.forEach(({ upper }, index) => {
    upperWeight += upper;
    cumulative[index] = upperWeight;
  });
  return { weighted, cumulative, upperWeight };
}

function locateCdf(cumulative: Float64Array, target: number): number {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (target < cumulative[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * The selected fixed-work lattice policy. Cell k carries the source-independent
 * visibility ceiling u_k = V(max(0, |centre_k|-R)). Stratification samples
 * that CDF without scanning the cell list per source; the exact point weight
 * v_k then contributes U/K * v_k/u_k. Since v_k <= u_k, outer cells cannot
 * acquire an explosive importance weight.
 */
function latticeStratifiedHistogram(
  dim: 3 | 4,
  cellScale: number,
  source: readonly Point[],
  fanout: number,
  fadeStartRadius = LATTICE_PRESENTATION_FADE_START_MULT,
  outerRadius = LATTICE_PRESENTATION_RADIUS_MULT,
): LatticeStratifiedResult {
  const histogram = new Float64Array(HIST_SIZE * HIST_SIZE);
  const { weighted, cumulative, upperWeight } = latticeProposalPlan(
    dim,
    cellScale,
    fadeStartRadius,
    outerRadius,
  );
  let deposits = 0;
  let candidateTests = 0;
  const phi = 0.6180339887498948;
  source.forEach((point, sourceIndex) => {
    const phase = (sourceIndex * phi) % 1;
    for (let sample = 0; sample < fanout; sample++) {
      const unit = ((sample + phase) / fanout) % 1;
      const selected = weighted[locateCdf(cumulative, unit * upperWeight)];
      candidateTests++;
      const image = latticeImage(point, selected.cell, dim, cellScale);
      const radial = norm(image);
      if (radial > outerRadius) continue;
      const visibility = latticePresentationVisibility(
        radial,
        fadeStartRadius,
        outerRadius,
      );
      if (visibility <= 0) continue;
      addHistogram(
        histogram,
        image,
        dim,
        (upperWeight / fanout) * (visibility / selected.upper),
        1.1 * outerRadius,
      );
      deposits++;
    }
  });
  return {
    histogram,
    deposits,
    candidateTests,
    cells: weighted.length,
    upperWeight,
  };
}

function radicalInverse(index: number, base: number): number {
  let value = index;
  let place = 1 / base;
  let out = 0;
  while (value > 0) {
    out += (value % base) * place;
    value = Math.floor(value / base);
    place /= base;
  }
  return out;
}

interface LatticeEqualState {
  proposalCursor: number;
  candidateTests: number;
  deposits: number;
}

interface LatticeEqualResult {
  histogram: Float64Array;
  emissions: string[];
  state: LatticeEqualState;
  cells: number;
  upperWeight: number;
}

/**
 * Points-only realization of the same proposal CDF without vertex weights.
 * A base-2 cursor selects p(k)=u_k/U and an independent base-3 cursor keeps
 * the proposal iff t < V(image)/u_k. Thus every emitted dot has equal mass,
 * while its density is proportional to the exhaustive fade-weighted images.
 * One proposal per canonical source maximizes source diversity and bounds
 * candidate tests independently of the number of planned lattice cells.
 */
function latticeEqualDensityChunk(
  dim: 3 | 4,
  cellScale: number,
  source: readonly Point[],
  requested: number,
  candidateTestCap: number,
  state: LatticeEqualState,
  histogram: Float64Array,
  emissions: string[],
  fadeStartRadius = LATTICE_PRESENTATION_FADE_START_MULT,
  outerRadius = LATTICE_PRESENTATION_RADIUS_MULT,
): LatticeProposalPlan {
  const plan = latticeProposalPlan(
    dim,
    cellScale,
    fadeStartRadius,
    outerRadius,
  );
  for (const point of source) {
    if (
      state.deposits >= requested ||
      state.candidateTests >= candidateTestCap
    ) {
      return plan;
    }
    const ordinal = state.proposalCursor++;
    state.candidateTests++;
    const proposalUnit = radicalInverse(ordinal + 1, 2);
    const selected =
      plan.weighted[
        locateCdf(plan.cumulative, proposalUnit * plan.upperWeight)
      ];
    const image = latticeImage(point, selected.cell, dim, cellScale);
    const radial = norm(image);
    const visibility =
      radial <= outerRadius
        ? latticePresentationVisibility(radial, fadeStartRadius, outerRadius)
        : 0;
    const thinningUnit = radicalInverse(ordinal + 1, 3);
    if (thinningUnit >= visibility / selected.upper) continue;
    addHistogram(histogram, image, dim, 1, 1.1 * outerRadius);
    emissions.push(
      `${selected.cell.index.join("/")}:${image
        .map((value) => value.toPrecision(17))
        .join(",")}`,
    );
    state.deposits++;
  }
  return plan;
}

function latticeEqualDensityHistogram(
  dim: 3 | 4,
  cellScale: number,
  source: readonly Point[],
  requested: number,
  candidateTestCap = requested * POINT_LATTICE_PROPOSAL_FACTOR,
): LatticeEqualResult {
  const histogram = new Float64Array(HIST_SIZE * HIST_SIZE);
  const emissions: string[] = [];
  const state: LatticeEqualState = {
    proposalCursor: 0,
    candidateTests: 0,
    deposits: 0,
  };
  const plan = latticeEqualDensityChunk(
    dim,
    cellScale,
    source,
    requested,
    candidateTestCap,
    state,
    histogram,
    emissions,
  );
  return {
    histogram,
    emissions,
    state,
    cells: plan.weighted.length,
    upperWeight: plan.upperWeight,
  };
}

function rotateXw(point: Point, angle: number): Point {
  if (point.length !== 4) return [...point];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    c * point[0] - s * point[3],
    point[1],
    point[2],
    s * point[0] + c * point[3],
  ];
}

// --------------------------------------------------------------- decisions

describe("point-space tiling decision", () => {
  it("measures all finite groups and selects bounded stratified fanout", () => {
    const rows: Record<string, unknown>[] = [];
    for (const group of Object.keys(TILING_GROUP_INFO) as TilingGroup[]) {
      const info = TILING_GROUP_INFO[group];
      const t0 = performance.now();
      const matrices = buildGroupMatrices(info);
      const buildMs = performance.now() - t0;
      expect(matrices).toHaveLength(info.order);

      const source = balancedSource(info, matrices, 128);
      const accepted = source.filter((point) =>
        isInChamber(
          info,
          point as [number, number, number] | [number, number, number, number],
        ),
      );
      // Points exactly on a wall have smaller orbits and are deliberately
      // accepted; the generic balanced motif has no boundary stabilizer.
      expect(accepted.length).toBeGreaterThanOrEqual(120);
      expect(accepted.length).toBeLessThanOrEqual(136);
      const measuredAcceptance = accepted.length / source.length;
      const clippedAccepted = accepted.filter(
        (point) => shapeSdf(ANALYTIC_CLIP, point[0], point[1], point[2]) <= 0,
      );

      const motif = canonicalMotif(info, MOTIF_POINTS);
      const exhaustiveStart = performance.now();
      const exhaustive = finiteHistogram(
        info,
        matrices,
        motif,
        matrices.length,
      );
      const exhaustiveMs = performance.now() - exhaustiveStart;
      const oneStart = performance.now();
      const one = finiteHistogram(info, matrices, motif, 1);
      const oneMs = performance.now() - oneStart;
      const pointFanout = acceptanceFanout(
        Math.round(measuredAcceptance * ACCEPTANCE_PILOT_POINTS),
        ACCEPTANCE_PILOT_POINTS,
        matrices.length,
        POINT_FANOUT_CAP,
      );
      const accumulationFanout = acceptanceFanout(
        Math.round(measuredAcceptance * ACCEPTANCE_PILOT_POINTS),
        ACCEPTANCE_PILOT_POINTS,
        matrices.length,
        ACCUMULATION_FANOUT_CAP,
      );
      const pointStart = performance.now();
      const point = finiteHistogram(info, matrices, motif, pointFanout);
      const pointMs = performance.now() - pointStart;
      const equalStart = performance.now();
      const equal = finiteEqualDensityHistogram(
        info,
        matrices,
        motif,
        point.deposits,
      );
      const equalMs = performance.now() - equalStart;
      const accumulationStart = performance.now();
      const accumulation = finiteHistogram(
        info,
        matrices,
        motif,
        accumulationFanout,
      );
      const accumulationMs = performance.now() - accumulationStart;
      const completeSourceLimit = Math.max(
        1,
        Math.floor(point.deposits / matrices.length),
      );
      const complete = finiteHistogram(
        info,
        matrices,
        motif,
        matrices.length,
        completeSourceLimit,
      );
      const policyRows: PolicyRow[] = [
        {
          label: "complete-budget",
          fanout: matrices.length,
          deposits: complete.deposits,
          sourcePoints: completeSourceLimit,
          metric: histogramMetric(complete.histogram, exhaustive.histogram),
        },
        {
          label: "one-image",
          fanout: 1,
          deposits: one.deposits,
          sourcePoints: motif.length,
          metric: histogramMetric(one.histogram, exhaustive.histogram),
        },
        {
          label: "points",
          fanout: pointFanout,
          deposits: point.deposits,
          sourcePoints: motif.length,
          metric: histogramMetric(point.histogram, exhaustive.histogram),
        },
        {
          label: "points-equal-density",
          fanout: Math.min(info.order, POINT_FANOUT_CAP),
          deposits: equal.state.deposits,
          sourcePoints: motif.length,
          metric: histogramMetric(equal.histogram, exhaustive.histogram),
        },
        {
          label: "accumulation",
          fanout: accumulationFanout,
          deposits: accumulation.deposits,
          sourcePoints: motif.length,
          metric: histogramMetric(accumulation.histogram, exhaustive.histogram),
        },
      ];
      const matrixBytes = matrices.length * info.dim * info.dim * 8;
      rows.push({
        group,
        order: info.order,
        acceptance: measuredAcceptance,
        expected: 1 / info.order,
        analyticClipAcceptance: clippedAccepted.length / source.length,
        analyticClipShareOfChamber:
          clippedAccepted.length / Math.max(1, accepted.length),
        buildMs,
        matrixBytes,
        timingMs: {
          exhaustive: exhaustiveMs,
          one: oneMs,
          points: pointMs,
          pointsEqualDensity: equalMs,
          accumulation: accumulationMs,
        },
        gpuShapedDepositsPerPrimaryStep: {
          points: measuredAcceptance * pointFanout,
          accumulation: measuredAcceptance * accumulationFanout,
          maxAcceptedLoop: accumulationFanout,
        },
        policies: policyRows,
      });

      expect(Math.abs(measuredAcceptance - 1 / info.order)).toBeLessThan(0.001);
      expect(pointFanout).toBeLessThanOrEqual(POINT_FANOUT_CAP);
      expect(accumulationFanout).toBeLessThanOrEqual(ACCUMULATION_FANOUT_CAP);
      expect(matrixBytes).toBeLessThanOrEqual(PLAN_MEMORY_CAP_BYTES);
      const pointMetric = policyRows[2].metric;
      const equalMetric = policyRows[3].metric;
      const accumulationMetric = policyRows[4].metric;
      expect(pointMetric.occupiedOfReference).toBeGreaterThan(0.78);
      expect(pointMetric.l1).toBeLessThan(0.55);
      expect(equal.state.deposits).toBe(point.deposits);
      expect(equalMetric.occupiedOfReference).toBeGreaterThan(0.78);
      expect(equalMetric.l1).toBeLessThan(0.55);
      expect(equalMetric.l1).toBeLessThan(pointMetric.l1 + 0.15);
      expect(accumulationMetric.occupiedOfReference).toBeGreaterThan(0.45);
      expect(accumulationMetric.l1).toBeLessThan(0.9);
    }
    console.log("finite fanout rows", JSON.stringify(rows, null, 2));
  });

  it("deduplicates chamber stabilizers instead of brightening walls", () => {
    const rows: Record<string, unknown>[] = [];
    for (const group of Object.keys(TILING_GROUP_INFO) as TilingGroup[]) {
      const info = TILING_GROUP_INFO[group];
      const matrices = buildGroupMatrices(info);
      const generic = canonicalMotif(info, 1)[0];
      for (let wall = 0; wall < info.dim; wall++) {
        const normal = info.roots.slice(
          wall * info.dim,
          wall * info.dim + info.dim,
        );
        let dot = 0;
        for (let axis = 0; axis < info.dim; axis++) {
          dot += generic[axis] * normal[axis];
        }
        const onWall = generic.map((x, axis) => x - dot * normal[axis]);
        const reflected = new Array<number>(info.dim).fill(0);
        reflectAcrossWall(
          onWall as [number, number, number] | [number, number, number, number],
          normal as [number, number, number] | [number, number, number, number],
          reflected as
            [number, number, number] | [number, number, number, number],
        );
        const unique = uniqueImages(matrices, onWall, info.dim);
        const oracle: number[][] = [];
        enumerateOrbit(
          info,
          onWall as [number, number, number] | [number, number, number, number],
          oracle,
        );
        expect(boundaryMask(info, onWall) & (1 << wall)).not.toBe(0);
        expect(unique).toHaveLength(oracle.length);
        expect(unique.length).toBeLessThan(info.order);
        expect(norm(onWall.map((x, axis) => x - reflected[axis]))).toBeLessThan(
          1e-12,
        );
        const nearWall = onWall.map(
          (x, axis) => x + (FOLD_EPS / 2) * normal[axis],
        );
        expect(boundaryMask(info, nearWall) & (1 << wall)).toBe(0);
        expect(uniqueImages(matrices, nearWall, info.dim)).toHaveLength(
          info.order,
        );
        rows.push({ group, wall, orbit: unique.length, order: info.order });
      }
    }
    console.log("boundary stabilizer rows", rows);
  });

  it("bounds lattice cells in both dimensions and keeps raw-4D presentation rotor invariant", () => {
    const rows: Record<string, unknown>[] = [];
    for (const dim of [3, 4] as const) {
      for (const cellScale of [1, 1.25, 4]) {
        const info = dim === 3 ? TILING_GROUP_INFO.a3 : TILING_GROUP_INFO.a4;
        const source = canonicalMotif(info, LATTICE_MOTIF_POINTS);
        const exhaustiveStart = performance.now();
        const exhaustive = latticeHistogram(
          dim,
          cellScale,
          source,
          Number.MAX_SAFE_INTEGER,
        );
        const exhaustiveMs = performance.now() - exhaustiveStart;
        const chosenStart = performance.now();
        const chosen = latticeStratifiedHistogram(dim, cellScale, source, 1);
        const chosenMs = performance.now() - chosenStart;
        const metric = histogramMetric(chosen.histogram, exhaustive.histogram);
        rows.push({
          dim,
          cellScale,
          cells: exhaustive.cells,
          candidates: {
            min: exhaustive.minCandidates,
            mean: exhaustive.meanCandidates,
            max: exhaustive.maxCandidates,
          },
          exhaustiveDeposits: exhaustive.deposits,
          stratifiedDeposits: chosen.deposits,
          stratifiedCandidateTests: chosen.candidateTests,
          upperWeight: chosen.upperWeight,
          planBytes: exhaustive.cells * (dim === 3 ? 2 : 3) * 2,
          timingMs: { exhaustive: exhaustiveMs, stratified: chosenMs },
          gpuShapedDepositsPerPrimaryStep: 1,
          metric,
        });
        expect(exhaustive.cells).toBeLessThanOrEqual(MAX_LATTICE_PLAN_CELLS);
        expect(metric.occupiedOfReference).toBeGreaterThan(0.45);
        expect(metric.l1).toBeLessThan(1.15);
      }
    }

    const source4 = canonicalMotif(TILING_GROUP_INFO.a4, 256);
    const cells4 = latticeCellPlan(4, 1);
    let membershipChanges = 0;
    let visibilityDelta = 0;
    for (const source of source4) {
      const images = latticeCandidates(source, cells4, 4, 1);
      for (const candidate of images) {
        const rotated = rotateXw(candidate.point, 1.173);
        const radial = norm(rotated);
        const rotatedVisibility = latticePresentationVisibility(
          radial,
          LATTICE_PRESENTATION_FADE_START_MULT,
          LATTICE_PRESENTATION_RADIUS_MULT,
        );
        if (radial > LATTICE_PRESENTATION_RADIUS_MULT) membershipChanges++;
        visibilityDelta = Math.max(
          visibilityDelta,
          Math.abs(rotatedVisibility - candidate.visibility),
        );
      }
    }
    // A displayed-3D carrier cannot bound the ghosted projection: all raw-w
    // cell centres project to the same xyz at the identity rotor and retain
    // SLICE_GHOST_FLOOR > 0. Count the linearly growing witness explicitly.
    const projectedGhostWitness = [4, 8, 16].map((halfWindow) => ({
      halfWindow,
      visibleRawWCells: 2 * halfWindow + 1,
      minimumTotalGhostWeight: (2 * halfWindow + 1) * 0.06,
    }));
    expect(membershipChanges).toBe(0);
    expect(visibilityDelta).toBeLessThan(2e-14);
    expect(projectedGhostWitness.map((row) => row.visibleRawWCells)).toEqual([
      9, 17, 33,
    ]);
    const carrierSource = canonicalMotif(
      TILING_GROUP_INFO.a4,
      LATTICE_MOTIF_POINTS,
    );
    const carrierCandidates = [
      { fadeStart: 6, outer: 8 },
      { fadeStart: 8, outer: 10 },
      { fadeStart: 10, outer: 12 },
    ].map(({ fadeStart, outer }) => {
      const measured = latticeStratifiedHistogram(
        4,
        1.25,
        carrierSource,
        1,
        fadeStart,
        outer,
      );
      let histogramMass = 0;
      for (const value of measured.histogram) histogramMass += value;
      return {
        fadeStart,
        outer,
        cells: measured.cells,
        upperWeight: measured.upperWeight,
        histogramMass,
        occupied: measured.histogram.reduce(
          (count, value) => count + (value > 1e-7 ? 1 : 0),
          0,
        ),
      };
    });
    expect(carrierCandidates[0].cells).toBeLessThan(carrierCandidates[1].cells);
    expect(carrierCandidates[1].cells).toBeLessThan(carrierCandidates[2].cells);
    const wall3: Point = [1, 0, 0];
    const nearWall3: Point = [1 - FOLD_EPS / 2, 0, 0];
    const wallCells = latticeCellPlan(3, 1);
    const stabilized = latticeCandidates(wall3, wallCells, 3, 1);
    const nearWallCandidates = latticeCandidates(nearWall3, wallCells, 3, 1);
    const coordinateDedupe = uniquePointList(
      wallCells
        .map((cell) => latticeImage(wall3, cell, 3, 1))
        .filter((point) => norm(point) < LATTICE_PRESENTATION_RADIUS_MULT),
    );
    expect(stabilized).toHaveLength(coordinateDedupe.length);
    expect(
      nearWallCandidates.some(
        ({ point }) => Math.abs(point[0] - (1 + FOLD_EPS / 2)) < 1e-12,
      ),
    ).toBe(true);
    console.log(
      "lattice carrier rows",
      JSON.stringify(
        {
          rows,
          membershipChanges,
          visibilityDelta,
          projectedGhostWitness,
          carrierCandidates,
          wallStabilizer: {
            exhaustive: wallCells.length,
            distinctInCarrier: coordinateDedupe.length,
            selected: stabilized.length,
          },
        },
        null,
        2,
      ),
    );
  });

  it("realizes Points coverage as equal density with chunk-stable cursors", () => {
    const finiteInfo = TILING_GROUP_INFO.b4;
    const finiteMatrices = buildGroupMatrices(finiteInfo);
    const finiteSource = canonicalMotif(finiteInfo, 48);
    const finiteRequested = finiteSource.length * POINT_FANOUT_CAP;
    const finiteWhole = finiteEqualDensityHistogram(
      finiteInfo,
      finiteMatrices,
      finiteSource,
      finiteRequested,
      true,
    );
    const finiteChunkHistogram = new Float64Array(HIST_SIZE * HIST_SIZE);
    const finiteChunkEmissions: string[] = [];
    const finiteChunkState: FiniteEqualState = {
      imageCursor: 0,
      quotaRemainder: 0,
      deposits: 0,
    };
    let finiteOffset = 0;
    for (const size of [1, 7, 13, 2, 25]) {
      finiteEqualDensityChunk(
        finiteInfo,
        finiteMatrices,
        finiteSource.slice(finiteOffset, finiteOffset + size),
        finiteRequested,
        finiteChunkState,
        finiteChunkHistogram,
        finiteChunkEmissions,
        true,
      );
      finiteOffset += size;
    }
    expect(finiteOffset).toBe(finiteSource.length);
    expect(finiteChunkState).toEqual(finiteWhole.state);
    expect(finiteChunkHistogram).toEqual(finiteWhole.histogram);
    expect(finiteChunkEmissions).toEqual(finiteWhole.emissions);

    // A source on one simple wall has half B4's generic orbit. The integer
    // quota makes it contribute half as many equal dots, including when the
    // generic quota is capped below the group order.
    const generic = finiteSource[0];
    const normal = finiteInfo.roots.slice(0, finiteInfo.dim);
    let dot = 0;
    for (let axis = 0; axis < finiteInfo.dim; axis++) {
      dot += generic[axis] * normal[axis];
    }
    const onWall = generic.map((value, axis) => value - dot * normal[axis]);
    const wallOrbit = uniqueImages(
      finiteMatrices,
      onWall,
      finiteInfo.dim,
    ).length;
    const quotaState: FiniteEqualState = {
      imageCursor: 0,
      quotaRemainder: 0,
      deposits: 0,
    };
    const quotaHistogram = new Float64Array(HIST_SIZE * HIST_SIZE);
    const quotaEmissions: string[] = [];
    finiteEqualDensityChunk(
      finiteInfo,
      finiteMatrices,
      [generic],
      Number.MAX_SAFE_INTEGER,
      quotaState,
      quotaHistogram,
      quotaEmissions,
    );
    const genericQuota = quotaState.deposits;
    finiteEqualDensityChunk(
      finiteInfo,
      finiteMatrices,
      [onWall],
      Number.MAX_SAFE_INTEGER,
      quotaState,
      quotaHistogram,
      quotaEmissions,
    );
    const wallQuota = quotaState.deposits - genericQuota;
    expect(wallOrbit).toBe(finiteInfo.order / 2);
    expect(genericQuota).toBe(POINT_FANOUT_CAP);
    expect(wallQuota).toBe(POINT_FANOUT_CAP / 2);

    const latticeRows: Record<string, unknown>[] = [];
    for (const dim of [3, 4] as const) {
      const info = dim === 3 ? TILING_GROUP_INFO.a3 : TILING_GROUP_INFO.a4;
      const referenceSource = canonicalMotif(info, LATTICE_MOTIF_POINTS);
      const proposalSource = canonicalMotif(
        info,
        LATTICE_MOTIF_POINTS * POINT_LATTICE_PROPOSAL_FACTOR,
      );
      const exhaustive = latticeHistogram(
        dim,
        1,
        referenceSource,
        Number.MAX_SAFE_INTEGER,
      );
      const weighted = latticeStratifiedHistogram(dim, 1, referenceSource, 1);
      const equal = latticeEqualDensityHistogram(
        dim,
        1,
        proposalSource,
        LATTICE_MOTIF_POINTS,
      );
      const weightedMetric = histogramMetric(
        weighted.histogram,
        exhaustive.histogram,
      );
      const equalMetric = histogramMetric(
        equal.histogram,
        exhaustive.histogram,
      );
      expect(equal.state.deposits).toBe(LATTICE_MOTIF_POINTS);
      expect(equal.state.candidateTests).toBeLessThanOrEqual(
        LATTICE_MOTIF_POINTS * POINT_LATTICE_PROPOSAL_FACTOR,
      );
      expect(equalMetric.occupiedOfReference).toBeGreaterThan(0.6);
      expect(equalMetric.l1).toBeLessThan(0.55);

      const chunkHistogram = new Float64Array(HIST_SIZE * HIST_SIZE);
      const chunkEmissions: string[] = [];
      const chunkState: LatticeEqualState = {
        proposalCursor: 0,
        candidateTests: 0,
        deposits: 0,
      };
      let offset = 0;
      const chunkSizes = [1, 31, 257, 2_048, 3, 8_191];
      let chunkIndex = 0;
      while (offset < proposalSource.length) {
        const size = chunkSizes[chunkIndex++ % chunkSizes.length];
        latticeEqualDensityChunk(
          dim,
          1,
          proposalSource.slice(offset, offset + size),
          LATTICE_MOTIF_POINTS,
          LATTICE_MOTIF_POINTS * POINT_LATTICE_PROPOSAL_FACTOR,
          chunkState,
          chunkHistogram,
          chunkEmissions,
        );
        offset += size;
      }
      expect(chunkState).toEqual(equal.state);
      expect(chunkHistogram).toEqual(equal.histogram);
      expect(chunkEmissions).toEqual(equal.emissions);
      latticeRows.push({
        dim,
        requested: LATTICE_MOTIF_POINTS,
        weighted: {
          deposits: weighted.deposits,
          candidateTests: weighted.candidateTests,
          metric: weightedMetric,
          perVertexWeightRequired: true,
        },
        equalDensity: {
          deposits: equal.state.deposits,
          candidateTests: equal.state.candidateTests,
          proposalCap: LATTICE_MOTIF_POINTS * POINT_LATTICE_PROPOSAL_FACTOR,
          metric: equalMetric,
          perVertexWeightRequired: false,
        },
      });
    }
    console.log(
      "equal-density Points rows",
      JSON.stringify(
        {
          finite: {
            group: "b4",
            requested: finiteRequested,
            deposits: finiteWhole.state.deposits,
            chunkReplayExact: true,
            genericQuota,
            wallOrbit,
            wallQuota,
          },
          lattice: latticeRows,
          primaryRngDrawsAdded: 0,
        },
        null,
        2,
      ),
    );
  });

  it("freezes attempts, normalization, dense-content and empty-content behavior", () => {
    const denseFanout = acceptanceFanout(
      ACCEPTANCE_PILOT_POINTS,
      ACCEPTANCE_PILOT_POINTS,
      TILING_GROUP_INFO.f4.order,
      POINT_FANOUT_CAP,
    );
    const neutralFanout = acceptanceFanout(
      Math.round(ACCEPTANCE_PILOT_POINTS / TILING_GROUP_INFO.f4.order),
      ACCEPTANCE_PILOT_POINTS,
      TILING_GROUP_INFO.f4.order,
      POINT_FANOUT_CAP,
    );
    const emptyFanout = acceptanceFanout(
      0,
      ACCEPTANCE_PILOT_POINTS,
      TILING_GROUP_INFO.f4.order,
      POINT_FANOUT_CAP,
    );
    const requested = 100_000;
    const attemptCap = requested * POINT_ATTEMPT_FACTOR;
    const nearlyEmptyAcceptance = 1 / (TILING_GROUP_INFO.f4.order * 32);
    const expectedNearlyEmpty = Math.floor(
      attemptCap * nearlyEmptyAcceptance * emptyFanout,
    );
    const denseTrace = acceptanceCreditTrace(
      new Array<boolean>(8_192).fill(true),
      TILING_GROUP_INFO.f4.order,
      ACCUMULATION_FANOUT_CAP,
    );
    const rareTrace = acceptanceCreditTrace(
      Array.from(
        { length: 8_192 },
        (_, index) => index % TILING_GROUP_INFO.f4.order === 0,
      ),
      TILING_GROUP_INFO.f4.order,
      ACCUMULATION_FANOUT_CAP,
    );
    const chunkedPattern = Array.from(
      { length: 8_192 },
      (_, index) => index % 384 === 383,
    );
    const chunkedWhole = acceptanceCreditTrace(
      chunkedPattern,
      TILING_GROUP_INFO.b4.order,
      ACCUMULATION_FANOUT_CAP,
    );
    const chunkedFirst = acceptanceCreditTrace(
      chunkedPattern.slice(0, 4_096),
      TILING_GROUP_INFO.b4.order,
      ACCUMULATION_FANOUT_CAP,
    );
    const chunkedSecond = acceptanceCreditTrace(
      chunkedPattern.slice(4_096),
      TILING_GROUP_INFO.b4.order,
      ACCUMULATION_FANOUT_CAP,
      {
        credit: chunkedFirst.remainingCredit,
        cursor: chunkedFirst.cursor,
      },
    );

    // Inverse-inclusion weights reproduce the exhaustive mass exactly for a
    // finite orbit, independent of selected fanout. Renderers may normalize
    // their completed density field as they already do, but the sampler must
    // not make each copy 1/N as dense as the canonical source.
    for (const fanout of [1, 7, ACCUMULATION_FANOUT_CAP, POINT_FANOUT_CAP]) {
      let mass = 0;
      for (let i = 0; i < fanout; i++) {
        mass += TILING_GROUP_INFO.f4.order / fanout;
      }
      expect(mass).toBeCloseTo(TILING_GROUP_INFO.f4.order, 10);
    }
    expect(denseFanout).toBe(1);
    expect(neutralFanout).toBe(POINT_FANOUT_CAP);
    expect(emptyFanout).toBe(POINT_FANOUT_CAP);
    expect(expectedNearlyEmpty).toBeLessThan(requested);
    expect(attemptCap).toBe(800_000);
    expect(denseTrace.fanouts.every((fanout) => fanout === 1)).toBe(true);
    expect(denseTrace.deposits).toBe(8_192);
    expect(rareTrace.deposits).toBeLessThanOrEqual(8_192);
    expect(Math.max(...rareTrace.fanouts)).toBe(ACCUMULATION_FANOUT_CAP);
    expect(chunkedFirst.deposits).toBeLessThanOrEqual(4_096);
    expect(chunkedFirst.deposits + chunkedSecond.deposits).toBe(
      chunkedWhole.deposits,
    );
    expect(chunkedSecond.remainingCredit).toBe(chunkedWhole.remainingCredit);
    expect(chunkedSecond.cursor).toBe(chunkedWhole.cursor);
    console.log("bounded-result policy", {
      measurementPoints: ACCEPTANCE_PILOT_POINTS,
      points: {
        requested,
        attemptCap,
        fanoutCap: POINT_FANOUT_CAP,
        denseFanout,
        neutralFanout,
        emptyPilotFanout: emptyFanout,
        nearlyEmptyAcceptance,
        expectedNearlyEmpty,
        result:
          expectedNearlyEmpty === 0
            ? "empty"
            : expectedNearlyEmpty < requested
              ? "underfilled"
              : "complete",
      },
      accumulators: {
        fanoutCap: ACCUMULATION_FANOUT_CAP,
        primaryIterationBudgetUnchanged: true,
        denseDepositsPerAttempt: denseTrace.deposits / 8_192,
        rareDepositsPerAttempt: rareTrace.deposits / 8_192,
        maxAcceptedBurst: Math.max(...rareTrace.fanouts),
        cumulativeDepositsNeverExceedAttempts: true,
        cursorAndCreditPersistAcrossChunks: true,
        finiteMassPerAcceptedSource: TILING_GROUP_INFO.f4.order,
        densityNormalization: "existing completed-field maximum",
      },
      primaryRngDrawsAdded: 0,
    });
  });
});
