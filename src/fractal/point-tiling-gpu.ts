import {
  MAX_EMITTER_TRIANGLE_TABLE_BYTES,
  writeEmitterPart,
} from "./flame-gpu";
import {
  POINT_TILING_ACCUMULATION_FANOUT_CAP,
  POINT_TILING_PLAN_MEMORY_CAP_BYTES,
  POINT_TILING_STABILIZER_REL_EPS,
  pointTilingCursorStride,
} from "./point-tiling";
import type { LatticePointTilingCdf, PointTilingPlan } from "./point-tiling";
import type { ShapeSpec } from "./shapes";
import { FOLD_EPS } from "./tiling";

/** One active chain's accumulator-only state at binding 8. Keeping this in
 * its own buffer preserves both established 32-byte orbit-chain wires: the
 * 3D chain has only one spare word and the 4D chain has none. */
export const POINT_TILING_GPU_STATE_STRIDE_BYTES = 32;

/** Binding 7 retains its 8 MiB emitter allowance and gains one complete
 * point-plan allowance plus a small fixed header/clip margin. */
export const POINT_TILING_GPU_AUX_MAX_BYTES =
  MAX_EMITTER_TRIANGLE_TABLE_BYTES +
  POINT_TILING_PLAN_MEMORY_CAP_BYTES +
  4 * 1024;

/** F4 is the largest supported finite group. Lattice importance splats are
 * smaller than 740 because visibility never exceeds its proposal ceiling. */
export const POINT_TILING_GPU_MAX_SPLAT_WEIGHT = 1152;
export const POINT_TILING_GPU_WEIGHT_SCALE = 256;
export const POINT_TILING_GPU_COLOR_SCALE = 256;
export const POINT_TILING_GPU_MAX_WEIGHT_FIX =
  POINT_TILING_GPU_MAX_SPLAT_WEIGHT * POINT_TILING_GPU_WEIGHT_SCALE;
export const POINT_TILING_GPU_MAX_COLOR_ADD =
  POINT_TILING_GPU_MAX_WEIGHT_FIX * POINT_TILING_GPU_COLOR_SCALE;

export const POINT_TILING_GPU_HEADER_FLOATS = 16;
export const POINT_TILING_GPU_DIRECTORY_FLOATS = 4;
export const POINT_TILING_GPU_LATTICE_RECORD_FLOATS = 6;
export const POINT_TILING_GPU_CLIP_PART_FLOATS = 24;
/** Four f32 rounding units cover input quantization plus the short dot-product
 * chain. This is added to, never substituted for, the canonical tight
 * stabilizer epsilon; it is still smaller than the chamber fold tolerance. */
export const POINT_TILING_GPU_F32_ROUNDING_REL_EPS = 4 * 2 ** -23;

const U32_RANGE = 0x1_0000_0000;
const GOLDEN_U32 = 0x9e37_79b1;

export interface QuantizedPointTilingCdf {
  /** Exclusive endpoints and interval masses, represented as exact numeric
   * f32 hi16/lo16 pairs. The final endpoint is (65536, 0) = 2^32. */
  endpointsHi: Uint32Array;
  endpointsLo: Uint32Array;
  massesHi: Uint32Array;
  massesLo: Uint32Array;
}

/** Quantize a strictly positive CPU CDF without ever collapsing an interval.
 * Monotone rounding reserves one tick for every remaining proposal and fixes
 * the final endpoint at exactly 2^32. */
export function quantizePointTilingCdf(
  cdf: LatticePointTilingCdf,
): QuantizedPointTilingCdf {
  const count = cdf.cumulative.length;
  if (count === 0) {
    throw new RangeError("point tiling GPU CDF must contain a proposal");
  }
  const endpointsHi = new Uint32Array(count);
  const endpointsLo = new Uint32Array(count);
  const massesHi = new Uint32Array(count);
  const massesLo = new Uint32Array(count);
  let previous = 0;
  for (let index = 0; index < count; index++) {
    const remaining = count - index - 1;
    const endpoint =
      index === count - 1
        ? U32_RANGE
        : Math.min(
            U32_RANGE - remaining,
            Math.max(
              previous + 1,
              Math.round(cdf.cumulative[index] * U32_RANGE),
            ),
          );
    const mass = endpoint - previous;
    if (!(mass >= 1) || endpoint > U32_RANGE) {
      throw new RangeError("point tiling GPU CDF quantization lost mass");
    }
    endpointsHi[index] = Math.floor(endpoint / 0x1_0000);
    endpointsLo[index] = endpoint % 0x1_0000;
    massesHi[index] = Math.floor(mass / 0x1_0000);
    massesLo[index] = mass % 0x1_0000;
    previous = endpoint;
  }
  return { endpointsHi, endpointsLo, massesHi, massesLo };
}

/** Exact u32 arithmetic mirror of the shader's K-way stratified target.
 * Exported so tests can compare every legal K against a BigInt oracle. */
export function pointTilingGpuStratumTarget(
  phase: number,
  sample: number,
  selected: number,
): number {
  const p = phase >>> 0;
  if (
    !Number.isInteger(sample) ||
    !Number.isInteger(selected) ||
    selected < 1 ||
    selected > POINT_TILING_ACCUMULATION_FANOUT_CAP ||
    sample < 0 ||
    sample >= selected
  ) {
    throw new RangeError("invalid point tiling GPU stratum");
  }
  if (selected === 1) return p;
  const q = Math.floor(U32_RANGE / selected);
  const r = U32_RANGE % selected;
  const phaseQ = Math.floor(p / selected);
  const phaseR = p % selected;
  return (
    (sample * q + phaseQ + Math.floor((phaseR + sample * r) / selected)) >>> 0
  );
}

export interface PackedGpuPointTiling {
  /** Existing emitter floats followed by the aligned point-plan tail. */
  auxTable: ArrayBuffer;
  /** Baked into the active kernel source; always four-float aligned. */
  baseFloat: number;
  kind: 1 | 2;
  dimension: 3 | 4;
  /** Zero-initialized binding-8 allocation, one state per orbit chain. */
  stateBytes: number;
  /** Largest mathematically possible lattice splat in this packed plan. */
  maxLatticeWeight: number;
}

/** Defend the public GPU factory seam as well as the UI resolver. The active
 * kernel replaces the historical plot adapter wholesale, so accepting one of
 * these combinations here would silently drop authored geometry. */
export function assertGpuPointTilingCompatibility(
  plan: PointTilingPlan,
  dimension: 3 | 4,
  symmetryOrder: number,
  balloonActive: boolean,
): void {
  if (plan.dimension !== dimension) {
    throw new RangeError(
      `point tiling GPU plan dimension ${plan.dimension} does not match ${dimension}D kernel`,
    );
  }
  if (symmetryOrder > 1) {
    throw new RangeError(
      "point tiling GPU cannot compose with kaleidoscope order greater than 1",
    );
  }
  if (balloonActive) {
    throw new RangeError("point tiling GPU cannot compose with balloon echo");
  }
}

function appendClip(
  floats: number[],
  clip: ShapeSpec | undefined,
  baseFloat: number,
): number {
  if (!clip) return 0;
  const offset = baseFloat + floats.length;
  for (const part of clip.parts) {
    const packed = new Float32Array(POINT_TILING_GPU_CLIP_PART_FLOATS);
    // Mesh clips were refused while resolving the shared point plan. A dummy
    // region supplies the gear writer's sampling-only fields; membership uses
    // the analytic params and never touches binding-7 triangle geometry.
    writeEmitterPart(packed, 0, part, 0, {
      offset: 0,
      triCount: 0,
      totalArea: 0,
    });
    packed[23] = part.combine === "intersect" ? 1 : 0;
    for (const value of packed) floats.push(value);
  }
  return offset;
}

function assertExactFloatIndex(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 0x1_000000) {
    throw new RangeError(
      `point tiling GPU auxiliary index ${value} is not an exact f32 integer`,
    );
  }
}

/** Append one resolved point-image plan to binding 7. Absent plans bypass
 * this function entirely so the old emitter buffer remains the literal old
 * allocation. */
export function packGpuPointTiling(
  plan: PointTilingPlan,
  emitterTable: ArrayBuffer | null,
  chainCount: number,
): PackedGpuPointTiling {
  if (!Number.isSafeInteger(chainCount) || chainCount <= 0) {
    throw new RangeError("point tiling GPU chain count must be positive");
  }
  const emitterFloats = emitterTable ? new Float32Array(emitterTable) : null;
  const baseFloat = ((emitterFloats?.length ?? 0) + 3) & ~3;
  // Build only the small plan tail as JS numbers. Copying an 8 MiB emitter
  // prefix through Array.from would transiently expand every f32 into a JS
  // number on every restart.
  const floats: number[] = [];
  const absoluteOffset = () => baseFloat + floats.length;
  for (let i = 0; i < POINT_TILING_GPU_HEADER_FLOATS; i++) floats.push(0);

  const clip = plan.tiling.clip;
  const clipOffset = appendClip(floats, clip, baseFloat);
  let rootOffset = 0;
  let wallCount = 0;
  let matrixOffset = 0;
  let matrixCount = 0;
  let directoryOffset: number;
  let maskCount: number;
  let cellsOffset = 0;
  let cellCount = 0;
  let maxLatticeWeight = 0;

  if (plan.kind === "finite") {
    rootOffset = absoluteOffset();
    wallCount = plan.tiling.info.dim;
    for (const value of plan.tiling.info.roots) floats.push(Math.fround(value));
    matrixOffset = absoluteOffset();
    matrixCount = plan.matrices.length;
    for (const matrix of plan.matrices) {
      for (const value of matrix) floats.push(Math.fround(value));
    }
    directoryOffset = absoluteOffset();
    maskCount = plan.representativesByWallMask.length;
    for (let i = 0; i < maskCount * POINT_TILING_GPU_DIRECTORY_FLOATS; i++) {
      floats.push(0);
    }
    for (let mask = 0; mask < maskCount; mask++) {
      const representatives = plan.representativesByWallMask[mask];
      const offset = absoluteOffset();
      for (const matrixIndex of representatives) floats.push(matrixIndex);
      const d =
        directoryOffset - baseFloat + mask * POINT_TILING_GPU_DIRECTORY_FLOATS;
      floats[d] = offset;
      floats[d + 1] = representatives.length;
      floats[d + 2] = pointTilingCursorStride(representatives.length);
    }
  } else {
    cellsOffset = absoluteOffset();
    cellCount = plan.upper.length;
    for (const cell of plan.cells) floats.push(cell);
    directoryOffset = absoluteOffset();
    maskCount = plan.cdfByWallMask.length;
    for (let i = 0; i < maskCount * POINT_TILING_GPU_DIRECTORY_FLOATS; i++) {
      floats.push(0);
    }
    for (let mask = 0; mask < maskCount; mask++) {
      const cdf = plan.cdfByWallMask[mask];
      const quantized = quantizePointTilingCdf(cdf);
      const offset = absoluteOffset();
      for (let proposal = 0; proposal < cdf.cellOrdinals.length; proposal++) {
        const cell = cdf.cellOrdinals[proposal];
        const massTicks =
          quantized.massesHi[proposal] * 0x1_0000 +
          quantized.massesLo[proposal];
        // Selection follows the quantized CDF, so importance correction must
        // use that same proposal probability rather than the ideal f64 one.
        // visibility <= upper[cell] gives an executable per-splat ceiling.
        maxLatticeWeight = Math.max(
          maxLatticeWeight,
          (plan.upper[cell] * U32_RANGE) / massTicks,
        );
        floats.push(
          cell,
          quantized.endpointsHi[proposal],
          quantized.endpointsLo[proposal],
          quantized.massesHi[proposal],
          quantized.massesLo[proposal],
          Math.fround(plan.upper[cell]),
        );
      }
      const d =
        directoryOffset - baseFloat + mask * POINT_TILING_GPU_DIRECTORY_FLOATS;
      floats[d] = offset;
      floats[d + 1] = cdf.cellOrdinals.length;
      floats[d + 2] = Math.fround(cdf.upperTotal);
    }
    if (!(maxLatticeWeight < 740)) {
      throw new RangeError(
        `point tiling GPU lattice weight bound ${maxLatticeWeight} is not below 740`,
      );
    }
  }

  const header = 0;
  floats[header] = plan.kind === "finite" ? 1 : 2;
  floats[header + 1] = plan.dimension;
  floats[header + 2] = clipOffset;
  floats[header + 3] = clip?.parts.length ?? 0;
  floats[header + 4] = rootOffset;
  floats[header + 5] = wallCount;
  floats[header + 6] = matrixOffset;
  floats[header + 7] = matrixCount;
  floats[header + 8] = directoryOffset;
  floats[header + 9] = maskCount;
  floats[header + 10] = cellsOffset;
  floats[header + 11] = cellCount;
  if (plan.kind === "lattice") {
    floats[header + 12] = Math.fround(plan.tiling.radius);
    floats[header + 13] = Math.fround(plan.tiling.h);
    floats[header + 14] = Math.fround(plan.tiling.presentation.fadeStartRadius);
    floats[header + 15] = Math.fround(plan.tiling.presentation.outerRadius);
  }

  assertExactFloatIndex(baseFloat);
  assertExactFloatIndex(baseFloat + floats.length - 1);
  for (let index = 0; index < floats.length; index++) {
    if (
      !Number.isFinite(floats[index]) ||
      !Number.isFinite(Math.fround(floats[index]))
    ) {
      throw new RangeError(
        `point tiling GPU auxiliary value ${index} is not finite f32`,
      );
    }
  }
  if (plan.kind === "lattice") {
    const requiredPositive = [
      plan.tiling.radius,
      plan.tiling.h,
      plan.tiling.presentation.outerRadius,
    ];
    if (requiredPositive.some((value) => !(Math.fround(value) > 0))) {
      throw new RangeError(
        "point tiling GPU lattice radii must remain positive finite f32",
      );
    }
  }
  const byteLength =
    (baseFloat + floats.length) * Float32Array.BYTES_PER_ELEMENT;
  if (byteLength > POINT_TILING_GPU_AUX_MAX_BYTES) {
    throw new RangeError(
      `point tiling GPU auxiliary table needs ${byteLength} bytes, cap is ${POINT_TILING_GPU_AUX_MAX_BYTES}`,
    );
  }
  if (
    POINT_TILING_GPU_MAX_WEIGHT_FIX > 0xffff_ffff ||
    POINT_TILING_GPU_MAX_COLOR_ADD > 0xffff_ffff
  ) {
    throw new RangeError("point tiling GPU fixed-point add exceeds u32");
  }

  const auxTable = new Float32Array(baseFloat + floats.length);
  if (emitterFloats) auxTable.set(emitterFloats);
  auxTable.set(floats, baseFloat);
  return {
    auxTable: auxTable.buffer,
    baseFloat,
    kind: plan.kind === "finite" ? 1 : 2,
    dimension: plan.dimension,
    stateBytes: chainCount * POINT_TILING_GPU_STATE_STRIDE_BYTES,
    maxLatticeWeight,
  };
}

/** Shared vec4 point-image implementation inserted only into active tiling
 * kernels. Both dimensions consume this exact text; their plot adapters own
 * projection, slice/color attribution, and the final histogram deposit. */
export function pointTilingGpuWgsl(packed: PackedGpuPointTiling): string {
  const dimension = packed.dimension;
  const repeatedAxes = dimension === 3 ? 2 : 3;
  return /* wgsl */ `
struct PointTilingChainState {
  counters0: vec4u,
  counters1: vec4u,
}

struct PointTilingAttempt {
  selected: u32,
  cursor: u32,
  mask: u32,
  candidates: u32,
}

struct PointTilingImage {
  point: vec4f,
  weight: f32,
  emitted: u32,
}

@group(0) @binding(8) var<storage, read_write> pointTilingStates: array<PointTilingChainState>;

const POINT_TILING_BASE: u32 = ${packed.baseFloat}u;
const POINT_TILING_KIND: u32 = ${packed.kind}u;
const POINT_TILING_DIMENSION: u32 = ${dimension}u;
const POINT_TILING_REPEATED_AXES: u32 = ${repeatedAxes}u;
const POINT_TILING_FANOUT_CAP: u32 = ${POINT_TILING_ACCUMULATION_FANOUT_CAP}u;
const POINT_TILING_GOLDEN: u32 = ${GOLDEN_U32}u;
const POINT_TILING_STABILIZER_EPS: f32 = ${POINT_TILING_STABILIZER_REL_EPS};
const POINT_TILING_F32_ROUNDING_EPS: f32 = ${POINT_TILING_GPU_F32_ROUNDING_REL_EPS};
const POINT_TILING_FOLD_EPS: f32 = ${FOLD_EPS};

fn pointTilingHeader(field: u32) -> f32 {
  return emitterTriangleTable[POINT_TILING_BASE + field];
}

fn pointTilingAuxU(offset: u32) -> u32 {
  return u32(emitterTriangleTable[offset]);
}

fn pointTilingClipPart(offset: u32) -> EmitterPart {
  return EmitterPart(
    vec4f(
      emitterTriangleTable[offset], emitterTriangleTable[offset + 1u],
      emitterTriangleTable[offset + 2u], emitterTriangleTable[offset + 3u]
    ),
    vec4f(
      emitterTriangleTable[offset + 4u], emitterTriangleTable[offset + 5u],
      emitterTriangleTable[offset + 6u], emitterTriangleTable[offset + 7u]
    ),
    vec4f(
      emitterTriangleTable[offset + 8u], emitterTriangleTable[offset + 9u],
      emitterTriangleTable[offset + 10u], emitterTriangleTable[offset + 11u]
    ),
    vec4f(
      emitterTriangleTable[offset + 12u], emitterTriangleTable[offset + 13u],
      emitterTriangleTable[offset + 14u], emitterTriangleTable[offset + 15u]
    ),
    vec4f(
      emitterTriangleTable[offset + 16u], emitterTriangleTable[offset + 17u],
      emitterTriangleTable[offset + 18u], emitterTriangleTable[offset + 19u]
    ),
    vec4f(
      emitterTriangleTable[offset + 20u], emitterTriangleTable[offset + 21u],
      emitterTriangleTable[offset + 22u], emitterTriangleTable[offset + 23u]
    ),
  );
}

fn pointTilingClipContains(point: vec4f) -> bool {
  let count = u32(pointTilingHeader(3u));
  if (count == 0u) {
    return true;
  }
  var offset = u32(pointTilingHeader(2u));
  var part = pointTilingClipPart(offset);
  var inside = emitterPartContains(part, point.xyz);
  for (var index = 1u; index < count; index++) {
    offset = offset + ${POINT_TILING_GPU_CLIP_PART_FLOATS}u;
    part = pointTilingClipPart(offset);
    let partInside = emitterPartContains(part, point.xyz);
    if (part.rot2.w > 0.5) {
      inside = inside && partInside;
    } else {
      inside = inside || partInside;
    }
  }
  return inside;
}

fn pointTilingRootPairing(wall: u32, point: vec4f) -> f32 {
  let roots = u32(pointTilingHeader(4u));
  let base = roots + wall * POINT_TILING_DIMENSION;
  var pairing = emitterTriangleTable[base] * point.x
    + emitterTriangleTable[base + 1u] * point.y
    + emitterTriangleTable[base + 2u] * point.z;
  if (POINT_TILING_DIMENSION == 4u) {
    pairing = pairing + emitterTriangleTable[base + 3u] * point.w;
  }
  return pairing;
}

fn pointTilingRootMagnitude(wall: u32, point: vec4f) -> f32 {
  let roots = u32(pointTilingHeader(4u));
  let base = roots + wall * POINT_TILING_DIMENSION;
  var magnitude = abs(emitterTriangleTable[base] * point.x)
    + abs(emitterTriangleTable[base + 1u] * point.y)
    + abs(emitterTriangleTable[base + 2u] * point.z);
  if (POINT_TILING_DIMENSION == 4u) {
    magnitude = magnitude + abs(emitterTriangleTable[base + 3u] * point.w);
  }
  return magnitude;
}

fn pointTilingMask(point: vec4f) -> u32 {
  var mask = 0u;
  if (POINT_TILING_KIND == 1u) {
    let walls = u32(pointTilingHeader(5u));
    for (var wall = 0u; wall < walls; wall++) {
      let tolerance = POINT_TILING_STABILIZER_EPS * length(point)
        + POINT_TILING_F32_ROUNDING_EPS * pointTilingRootMagnitude(wall, point);
      if (abs(pointTilingRootPairing(wall, point)) <= tolerance) {
        mask = mask | (1u << wall);
      }
    }
    return mask;
  }
  let h = pointTilingHeader(13u);
  let tightTolerance = POINT_TILING_STABILIZER_EPS * abs(h);
  let xTolerance = tightTolerance
    + POINT_TILING_F32_ROUNDING_EPS * max(abs(point.x), abs(h));
  let zTolerance = tightTolerance
    + POINT_TILING_F32_ROUNDING_EPS * max(abs(point.z), abs(h));
  if (abs(abs(point.x) - h) <= xTolerance) { mask = mask | 1u; }
  if (abs(abs(point.z) - h) <= zTolerance) { mask = mask | 2u; }
  let wTolerance = tightTolerance
    + POINT_TILING_F32_ROUNDING_EPS * max(abs(point.w), abs(h));
  if (POINT_TILING_DIMENSION == 4u && abs(abs(point.w) - h) <= wTolerance) {
    mask = mask | 4u;
  }
  return mask;
}

fn pointTilingContains(point: vec4f) -> bool {
  if (!(all(abs(point) < vec4f(1e30)))) {
    return false;
  }
  if (POINT_TILING_KIND == 1u) {
    let walls = u32(pointTilingHeader(5u));
    for (var wall = 0u; wall < walls; wall++) {
      if (pointTilingRootPairing(wall, point) < -POINT_TILING_FOLD_EPS) {
        return false;
      }
    }
  } else {
    let radius = pointTilingHeader(12u);
    if (dot(point, point) > radius * radius) {
      return false;
    }
  }
  return pointTilingClipContains(point);
}

fn pointTilingDirectory(mask: u32) -> vec4f {
  let directory = u32(pointTilingHeader(8u));
  let offset = directory + mask * ${POINT_TILING_GPU_DIRECTORY_FLOATS}u;
  return vec4f(
    emitterTriangleTable[offset], emitterTriangleTable[offset + 1u],
    emitterTriangleTable[offset + 2u], emitterTriangleTable[offset + 3u]
  );
}

fn pointTilingBegin(
  point: vec4f,
  state: ptr<storage, PointTilingChainState, read_write>,
  chainIndex: u32,
) -> PointTilingAttempt {
  (*state).counters0.z = (*state).counters0.z + 1u;
  (*state).counters0.x = (*state).counters0.x + 1u;
  if (!pointTilingContains(point)) {
    return PointTilingAttempt(0u, (*state).counters0.y + chainIndex, 0u, 0u);
  }
  let mask = pointTilingMask(point);
  let directory = pointTilingDirectory(mask);
  let candidates = u32(directory.y);
  let selected = min(min((*state).counters0.x, candidates), POINT_TILING_FANOUT_CAP);
  let storedCursor = (*state).counters0.y;
  let cursor = storedCursor + chainIndex;
  (*state).counters0.x = (*state).counters0.x - selected;
  (*state).counters0.y = storedCursor + selected;
  (*state).counters0.w = (*state).counters0.w + 1u;
  (*state).counters1.x = (*state).counters1.x + selected;
  return PointTilingAttempt(selected, cursor, mask, candidates);
}

fn pointTilingTarget(phase: u32, sample: u32, selected: u32) -> u32 {
  if (selected == 1u) { return phase; }
  let q = 0xffffffffu / selected;
  let qRemainder = 0xffffffffu % selected;
  let qAdjusted = q + select(0u, 1u, qRemainder + 1u == selected);
  let r = (qRemainder + 1u) % selected;
  let phaseQ = phase / selected;
  let phaseR = phase % selected;
  return sample * qAdjusted + phaseQ + (phaseR + sample * r) / selected;
}

fn pointTilingEndpointAfter(record: u32, stratum: u32) -> bool {
  let hi = pointTilingAuxU(record + 1u);
  let lo = pointTilingAuxU(record + 2u);
  let targetHi = stratum >> 16u;
  let targetLo = stratum & 0xffffu;
  return hi > targetHi || (hi == targetHi && lo > targetLo);
}

fn pointTilingLatticeVisibility(point: vec4f) -> f32 {
  let radial = length(point);
  let fadeStart = pointTilingHeader(14u);
  let outer = pointTilingHeader(15u);
  if (fadeStart >= outer) {
    return select(0.0, 1.0, radial <= outer);
  }
  let x = clamp((radial - fadeStart) / (outer - fadeStart), 0.0, 1.0);
  return 1.0 - x * x * (3.0 - 2.0 * x);
}

fn pointTilingImageAt(
  source: vec4f,
  attempt: PointTilingAttempt,
  sample: u32,
) -> PointTilingImage {
  let directory = pointTilingDirectory(attempt.mask);
  if (POINT_TILING_KIND == 1u) {
    let stride = u32(directory.z);
    let ordinal = (((attempt.cursor % attempt.candidates) + sample) * stride)
      % attempt.candidates;
    let matrixIndex = pointTilingAuxU(u32(directory.x) + ordinal);
    let matrices = u32(pointTilingHeader(6u));
    let base = matrices + matrixIndex * POINT_TILING_DIMENSION * POINT_TILING_DIMENSION;
    var image = vec4f(0.0);
    image.x = emitterTriangleTable[base] * source.x
      + emitterTriangleTable[base + 1u] * source.y
      + emitterTriangleTable[base + 2u] * source.z;
    image.y = emitterTriangleTable[base + POINT_TILING_DIMENSION] * source.x
      + emitterTriangleTable[base + POINT_TILING_DIMENSION + 1u] * source.y
      + emitterTriangleTable[base + POINT_TILING_DIMENSION + 2u] * source.z;
    image.z = emitterTriangleTable[base + 2u * POINT_TILING_DIMENSION] * source.x
      + emitterTriangleTable[base + 2u * POINT_TILING_DIMENSION + 1u] * source.y
      + emitterTriangleTable[base + 2u * POINT_TILING_DIMENSION + 2u] * source.z;
    if (POINT_TILING_DIMENSION == 4u) {
      image.x = image.x + emitterTriangleTable[base + 3u] * source.w;
      image.y = image.y + emitterTriangleTable[base + POINT_TILING_DIMENSION + 3u] * source.w;
      image.z = image.z + emitterTriangleTable[base + 2u * POINT_TILING_DIMENSION + 3u] * source.w;
      image.w = emitterTriangleTable[base + 3u * POINT_TILING_DIMENSION] * source.x
        + emitterTriangleTable[base + 3u * POINT_TILING_DIMENSION + 1u] * source.y
        + emitterTriangleTable[base + 3u * POINT_TILING_DIMENSION + 2u] * source.z
        + emitterTriangleTable[base + 3u * POINT_TILING_DIMENSION + 3u] * source.w;
    }
    return PointTilingImage(image, f32(attempt.candidates) / f32(attempt.selected), 1u);
  }

  let phase = attempt.cursor * POINT_TILING_GOLDEN;
  let stratum = pointTilingTarget(phase, sample, attempt.selected);
  var low = 0u;
  var high = attempt.candidates - 1u;
  loop {
    if (low >= high) { break; }
    let middle = (low + high) >> 1u;
    let record = u32(directory.x) + middle * ${POINT_TILING_GPU_LATTICE_RECORD_FLOATS}u;
    if (pointTilingEndpointAfter(record, stratum)) { high = middle; }
    else { low = middle + 1u; }
  }
  let record = u32(directory.x) + low * ${POINT_TILING_GPU_LATTICE_RECORD_FLOATS}u;
  let cell = pointTilingAuxU(record);
  let cells = u32(pointTilingHeader(10u));
  let cellBase = cells + cell * POINT_TILING_REPEATED_AXES;
  let h = pointTilingHeader(13u);
  var image = source;
  let kx = i32(emitterTriangleTable[cellBase]);
  let kz = i32(emitterTriangleTable[cellBase + 1u]);
  image.x = 2.0 * h * f32(kx) + select(source.x, -source.x, (abs(kx) & 1) == 1);
  image.z = 2.0 * h * f32(kz) + select(source.z, -source.z, (abs(kz) & 1) == 1);
  if (POINT_TILING_DIMENSION == 4u) {
    let kw = i32(emitterTriangleTable[cellBase + 2u]);
    image.w = 2.0 * h * f32(kw) + select(source.w, -source.w, (abs(kw) & 1) == 1);
  }
  let visibility = pointTilingLatticeVisibility(image);
  if (visibility <= 0.0) {
    return PointTilingImage(image, 0.0, 0u);
  }
  let massTicks = f32(pointTilingAuxU(record + 3u)) * 65536.0
    + f32(pointTilingAuxU(record + 4u));
  let weight = visibility * 4294967296.0 / massTicks / f32(attempt.selected);
  return PointTilingImage(image, weight, 1u);
}

fn pointTilingRecordEmitted(
  state: ptr<storage, PointTilingChainState, read_write>,
) {
  (*state).counters1.y = (*state).counters1.y + 1u;
}
`;
}
