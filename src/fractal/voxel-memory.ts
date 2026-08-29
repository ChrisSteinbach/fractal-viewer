import { voxelMaxHierarchyByteLength } from "./voxel-max-hierarchy";
import { VOXEL_RESOLUTION_STEP } from "./voxel";

/** Bytes retained for each voxel's accumulation count. */
export const VOXEL_DENSITY_BYTES_PER_VOXEL = Float32Array.BYTES_PER_ELEMENT;

/** Bytes retained for each voxel's three-channel running mean color. */
export const VOXEL_AVG_RGB_BYTES_PER_VOXEL = 3 * Float32Array.BYTES_PER_ELEMENT;

/** Bytes transiently allocated while packing the transferable RGBA8 volume. */
export const VOXEL_TEXTURE_BYTES_PER_VOXEL = 4;

/** Exact worker peak represented by the proactive resolution guard. */
export interface VoxelResolutionMemory {
  densityBytes: number;
  avgRgbBytes: number;
  textureRgbaBytes: number;
  maxHierarchyBytes: number;
  peakBytes: number;
}

function voxelCount(size: number): number {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError("voxel resolution must be a positive integer");
  }
  const count = size * size * size;
  if (!Number.isSafeInteger(count)) {
    throw new RangeError("voxel resolution exceeds safe byte accounting");
  }
  return count;
}

/**
 * Exact peak while a worker pack is ready to transfer: the retained Float32
 * density and running RGB grids, the RGBA8 texture, and its compact max-alpha
 * hierarchy all coexist at that point.
 */
export function voxelResolutionMemory(size: number): VoxelResolutionMemory {
  const count = voxelCount(size);
  const densityBytes = count * VOXEL_DENSITY_BYTES_PER_VOXEL;
  const avgRgbBytes = count * VOXEL_AVG_RGB_BYTES_PER_VOXEL;
  const textureRgbaBytes = count * VOXEL_TEXTURE_BYTES_PER_VOXEL;
  const maxHierarchyBytes = voxelMaxHierarchyByteLength(size);
  const peakBytes =
    densityBytes + avgRgbBytes + textureRgbaBytes + maxHierarchyBytes;
  if (!Number.isSafeInteger(peakBytes)) {
    throw new RangeError("voxel resolution exceeds safe byte accounting");
  }
  return {
    densityBytes,
    avgRgbBytes,
    textureRgbaBytes,
    maxHierarchyBytes,
    peakBytes,
  };
}

/** Exact peak bytes used by one resolution, convenient for budget policies. */
export function voxelResolutionMemoryByteLength(size: number): number {
  return voxelResolutionMemory(size).peakBytes;
}

/**
 * Largest stepped resolution at or below `requested` whose exact worker peak
 * fits `maxBytes`. As with the legacy voxel-count clamp, the step itself is a
 * hard minimum and is returned even when a smaller-than-minimum budget is
 * supplied; allocation failure remains the final runtime fallback.
 */
export function clampVoxelResolutionToMemoryBudget(
  requested: number,
  maxBytes: number,
): number {
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new RangeError(
      "requested voxel resolution must be positive and finite",
    );
  }
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new RangeError("voxel memory budget must be non-negative and finite");
  }
  const start = Math.max(
    VOXEL_RESOLUTION_STEP,
    Math.floor(requested / VOXEL_RESOLUTION_STEP) * VOXEL_RESOLUTION_STEP,
  );
  for (
    let size = start;
    size > VOXEL_RESOLUTION_STEP;
    size -= VOXEL_RESOLUTION_STEP
  ) {
    if (voxelResolutionMemoryByteLength(size) <= maxBytes) return size;
  }
  return VOXEL_RESOLUTION_STEP;
}
