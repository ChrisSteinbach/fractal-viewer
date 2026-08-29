/**
 * Pure CPU empty-space traversal for Solid's source-volume primary ray.
 *
 * The max hierarchy changes only HOW the fixed sample lattice is traversed;
 * it never changes that lattice. An empty node advances by a whole number of
 * original strides, leaving the next lattice point to be considered normally.
 * Every density test and crossing refinement uses `samplePackedVoxelDensity`,
 * so hits remain directly comparable with `raymarchPackedVoxelDensity`.
 *
 * Query-space balloon union is deliberately outside this module: its inverted
 * field extends beyond the source AABB and needs a separately proved bound.
 */
import {
  VOXEL_MAX_HIERARCHY_TRAVERSAL_CELL_SPAN,
  voxelMaxHierarchyNodeAtUv,
  voxelMaxHierarchyNodeBounds,
  voxelMaxHierarchyNodeValue,
} from "./voxel-max-hierarchy";
import type { VoxelMaxHierarchy } from "./voxel-max-hierarchy";
import {
  samplePackedVoxelDensity,
  VOXEL_RAYMARCH_REFINE_STEPS,
} from "./voxel-raymarch";
import type {
  PackedVoxelDensityVolume,
  VoxelDensityRay,
  VoxelDensityRayHit,
  VoxelDensityRayMiss,
  VoxelDensityRaymarchOptions,
  VoxelDensitySample,
} from "./voxel-raymarch";
import type { Vec3 } from "./types";

/** Counters kept separate from hit evidence for benchmark-friendly reporting. */
export interface AcceleratedVoxelTraversalStats {
  /** Original fixed-lattice positions consumed, including the hit position. */
  latticeSteps: number;
  /** Fixed-lattice positions certified outside without trilinear sampling. */
  skippedSamples: number;
  /** Number of contiguous hierarchy-certified advances. */
  skipRanges: number;
  /** Hierarchy max nodes tested while locating empty space. */
  hierarchyNodeTests: number;
  /** Ordinary fixed-lattice density reads (including the eventual hit). */
  primaryDensitySamples: number;
  /** Lazy read of a certified previous sample needed for crossing evidence. */
  evidenceDensitySamples: number;
  /** Bisection density reads after a hit. */
  refinementDensitySamples: number;
  /** All trilinear density reads made by this traversal. */
  densitySamples: number;
}

interface WithTraversalStats {
  traversal: AcceleratedVoxelTraversalStats;
}

export type AcceleratedVoxelDensityRayResult =
  | (VoxelDensityRayHit & WithTraversalStats)
  | (VoxelDensityRayMiss & WithTraversalStats);

/**
 * Select the fixed traversal level. Small source grids may end before span
 * 16; in that case their coarsest (largest-span) available level is used.
 */
export function voxelAccelerationLevelIndex(
  hierarchy: VoxelMaxHierarchy,
): number {
  if (hierarchy.levels.length === 0) {
    throw new RangeError("voxel hierarchy must contain a root level");
  }
  const exact = hierarchy.levels.findIndex(
    (level) => level.cellSpan === VOXEL_MAX_HIERARCHY_TRAVERSAL_CELL_SPAN,
  );
  if (exact >= 0) return exact;
  let selected = 0;
  for (let index = 1; index < hierarchy.levels.length; index++) {
    if (
      hierarchy.levels[index].cellSpan <=
        VOXEL_MAX_HIERARCHY_TRAVERSAL_CELL_SPAN &&
      hierarchy.levels[index].cellSpan > hierarchy.levels[selected].cellSpan
    ) {
      selected = index;
    }
  }
  return selected;
}

function validateVolume(volume: PackedVoxelDensityVolume): Vec3 {
  const { size, data, boundsMin, boundsMax } = volume;
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError("voxel volume size must be a positive integer");
  }
  if (data.length < size * size * size * 4) {
    throw new RangeError(
      "voxel volume data is shorter than size^3 RGBA texels",
    );
  }
  const extent: Vec3 = [
    boundsMax[0] - boundsMin[0],
    boundsMax[1] - boundsMin[1],
    boundsMax[2] - boundsMin[2],
  ];
  if (extent.some((value) => !Number.isFinite(value) || !(value > 0))) {
    throw new RangeError(
      "voxel volume bounds must have positive finite extent",
    );
  }
  return extent;
}

function validateHierarchy(
  hierarchy: VoxelMaxHierarchy,
  sourceSize: number,
): void {
  if (hierarchy.sourceSize !== sourceSize) {
    throw new RangeError("voxel hierarchy source size does not match volume");
  }
  if (hierarchy.levels.length === 0) {
    throw new RangeError("voxel hierarchy must contain a root level");
  }
  if (
    hierarchy.byteLength !== hierarchy.data.byteLength ||
    hierarchy.levels.some(
      (level) =>
        !Number.isInteger(level.size) ||
        level.size <= 0 ||
        !Number.isInteger(level.offset) ||
        level.offset < 0 ||
        level.length !== level.size ** 3 ||
        level.offset + level.length > hierarchy.data.length ||
        !Number.isInteger(level.cellSpan) ||
        level.cellSpan < 2,
    )
  ) {
    throw new RangeError("voxel hierarchy layout is invalid");
  }
}

function validateOptions(options: VoxelDensityRaymarchOptions): {
  threshold: number;
  marchSteps: number;
  phase: number;
  refinementSteps: number;
} {
  const { threshold, marchSteps } = options;
  const phase = options.phase ?? 0;
  const refinementSteps =
    options.refinementSteps ?? VOXEL_RAYMARCH_REFINE_STEPS;
  if (!Number.isFinite(threshold)) {
    throw new RangeError("voxel threshold must be finite");
  }
  if (!Number.isInteger(marchSteps) || marchSteps <= 0) {
    throw new RangeError("voxel marchSteps must be a positive integer");
  }
  if (!Number.isFinite(phase) || phase < 0 || phase >= 1) {
    throw new RangeError("voxel march phase must be in [0, 1)");
  }
  if (!Number.isInteger(refinementSteps) || refinementSteps < 0) {
    throw new RangeError(
      "voxel refinementSteps must be a non-negative integer",
    );
  }
  return { threshold, marchSteps, phase, refinementSteps };
}

function normalizedDirection(direction: Vec3): Vec3 {
  const length = Math.hypot(...direction);
  if (!Number.isFinite(length) || !(length > 0)) {
    throw new RangeError("voxel ray direction must be finite and non-zero");
  }
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

function intersectBounds(
  origin: Vec3,
  direction: Vec3,
  min: Vec3,
  max: Vec3,
): { tNear: number; tFar: number } | null {
  let tNear = -Infinity;
  let tFar = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const d = direction[axis];
    if (d === 0) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
      continue;
    }
    const a = (min[axis] - origin[axis]) / d;
    const b = (max[axis] - origin[axis]) / d;
    tNear = Math.max(tNear, Math.min(a, b));
    tFar = Math.min(tFar, Math.max(a, b));
    if (tNear > tFar) return null;
  }
  tNear = Math.max(tNear, 0);
  return tFar > 0 && tNear <= tFar ? { tNear, tFar } : null;
}

function pointOnRay(origin: Vec3, direction: Vec3, t: number): Vec3 {
  return [
    origin[0] + direction[0] * t,
    origin[1] + direction[1] * t,
    origin[2] + direction[2] * t,
  ];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function textureRay(
  volume: PackedVoxelDensityVolume,
  extent: Vec3,
  origin: Vec3,
  direction: Vec3,
): { origin: Vec3; direction: Vec3 } {
  return {
    origin: [
      (origin[0] - volume.boundsMin[0]) / extent[0],
      (origin[1] - volume.boundsMin[1]) / extent[1],
      (origin[2] - volume.boundsMin[2]) / extent[2],
    ],
    direction: [
      direction[0] / extent[0],
      direction[1] / extent[1],
      direction[2] / extent[2],
    ],
  };
}

function uvAt(ray: { origin: Vec3; direction: Vec3 }, t: number): Vec3 {
  // AABB arithmetic can put a conceptual boundary point a few ulps outside;
  // clamping restores the normalized texture-domain point the shader samples.
  return [
    clamp01(ray.origin[0] + ray.direction[0] * t),
    clamp01(ray.origin[1] + ray.direction[1] * t),
    clamp01(ray.origin[2] + ray.direction[2] * t),
  ];
}

function nodeExitT(
  ray: { origin: Vec3; direction: Vec3 },
  bounds: { min: Vec3; max: Vec3 },
): number {
  let exit = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const d = ray.direction[axis];
    if (d > 0) exit = Math.min(exit, (bounds.max[axis] - ray.origin[axis]) / d);
    else if (d < 0)
      exit = Math.min(exit, (bounds.min[axis] - ray.origin[axis]) / d);
  }
  return exit;
}

function traversalStats(
  latticeSteps: number,
  skippedSamples: number,
  skipRanges: number,
  hierarchyNodeTests: number,
  primaryDensitySamples: number,
  evidenceDensitySamples: number,
  refinementDensitySamples: number,
): AcceleratedVoxelTraversalStats {
  return {
    latticeSteps,
    skippedSamples,
    skipRanges,
    hierarchyNodeTests,
    primaryDensitySamples,
    evidenceDensitySamples,
    refinementDensitySamples,
    densitySamples:
      primaryDensitySamples + evidenceDensitySamples + refinementDensitySamples,
  };
}

/**
 * Traverse the ordinary source-volume Solid ray with conservative hierarchy
 * skips while preserving the reference marcher's original fixed lattice.
 */
export function raymarchPackedVoxelDensityAccelerated(
  volume: PackedVoxelDensityVolume,
  hierarchy: VoxelMaxHierarchy,
  ray: VoxelDensityRay,
  options: VoxelDensityRaymarchOptions,
): AcceleratedVoxelDensityRayResult {
  const extent = validateVolume(volume);
  validateHierarchy(hierarchy, volume.size);
  const { threshold, marchSteps, phase, refinementSteps } =
    validateOptions(options);
  const direction = normalizedDirection(ray.direction);
  if (ray.origin.some((value) => !Number.isFinite(value))) {
    throw new RangeError("voxel ray origin must be finite");
  }

  const interval = intersectBounds(
    ray.origin,
    direction,
    volume.boundsMin,
    volume.boundsMax,
  );
  if (interval === null) {
    return {
      hit: false,
      reason: "bounds",
      interval: null,
      stepSize: 0,
      marchSamples: 0,
      traversal: traversalStats(0, 0, 0, 0, 0, 0, 0),
    };
  }

  const stepSize = (interval.tFar - interval.tNear) / marchSteps;
  const uvRay = textureRay(volume, extent, ray.origin, direction);
  const traversalLevelIndex = voxelAccelerationLevelIndex(hierarchy);
  const traversalLevel = hierarchy.levels[traversalLevelIndex];
  let t = interval.tNear + stepSize * phase;
  let latticeIndex = 0;
  let previousT: number | null = null;
  let previousSample: VoxelDensitySample | null = null;
  let skippedSamples = 0;
  let skipRanges = 0;
  let hierarchyNodeTests = 0;
  let primaryDensitySamples = 0;
  let evidenceDensitySamples = 0;
  let occupiedNodeExitT = -Infinity;

  while (latticeIndex < marchSteps) {
    if (t > occupiedNodeExitT) {
      const uv = uvAt(uvRay, t);
      const node = voxelMaxHierarchyNodeAtUv(volume.size, traversalLevel, uv);
      const maxAlpha = voxelMaxHierarchyNodeValue(
        hierarchy,
        traversalLevelIndex,
        node,
      );
      hierarchyNodeTests++;
      const exitT = nodeExitT(
        uvRay,
        voxelMaxHierarchyNodeBounds(volume.size, traversalLevel, node),
      );
      // Deliberately use the CPU oracle's double comparison here. The GPU
      // helper frounds both operands; a threshold infinitesimally below an
      // alpha byte is a CPU hit even when both values round to one f32.
      if (maxAlpha / 255 <= threshold) {
        const remaining = marchSteps - latticeIndex;
        const stridesToExit =
          stepSize > 0
            ? Math.floor(Math.max(0, (exitT - t) / stepSize - 1e-7)) + 1
            : remaining;
        // Preserve the original phase lattice. The tiny stride-relative bias
        // leaves an exact node-boundary sample for reclassification instead
        // of rounding it across the seam; non-boundary samples strictly
        // before the exit are certified and skipped together.
        const skip = Math.min(remaining, Math.max(1, stridesToExit));
        skipRanges++;
        skippedSamples += skip;
        previousSample = null;
        for (let i = 0; i < skip; i++) {
          previousT = t;
          t += stepSize;
          latticeIndex++;
        }
        continue;
      }
      // Occupied nodes cannot certify individual points, but every lattice
      // sample through their inclusive exit bypasses another hierarchy read.
      occupiedNodeExitT = exitT;
    }

    const point = pointOnRay(ray.origin, direction, t);
    const density = samplePackedVoxelDensity(volume, point);
    primaryDensitySamples++;
    if (density > threshold) {
      const firstInside = { t, density };
      let lastOutside: VoxelDensitySample | null = null;
      if (previousT !== null) {
        if (previousSample !== null && previousSample.t === previousT) {
          lastOutside = previousSample;
        } else {
          lastOutside = {
            t: previousT,
            density: samplePackedVoxelDensity(
              volume,
              pointOnRay(ray.origin, direction, previousT),
            ),
          };
          evidenceDensitySamples++;
        }
      }

      let refinedOutside = lastOutside ?? firstInside;
      let refinedInside = firstInside;
      let refinementDensitySamples = 0;
      for (let i = 0; i < refinementSteps; i++) {
        const midT = (refinedOutside.t + refinedInside.t) * 0.5;
        const midDensity = samplePackedVoxelDensity(
          volume,
          pointOnRay(ray.origin, direction, midT),
        );
        const mid = { t: midT, density: midDensity };
        refinementDensitySamples++;
        if (midDensity > threshold) refinedInside = mid;
        else refinedOutside = mid;
      }
      const latticeSteps = latticeIndex + 1;
      return {
        hit: true,
        t: refinedInside.t,
        position: pointOnRay(ray.origin, direction, refinedInside.t),
        density: refinedInside.density,
        ...interval,
        stepSize,
        marchSamples: primaryDensitySamples + evidenceDensitySamples,
        refinementSamples: refinementDensitySamples,
        crossing: {
          firstInside,
          lastOutside,
          refinedOutside,
          refinedInside,
        },
        traversal: traversalStats(
          latticeSteps,
          skippedSamples,
          skipRanges,
          hierarchyNodeTests,
          primaryDensitySamples,
          evidenceDensitySamples,
          refinementDensitySamples,
        ),
      };
    }

    previousT = t;
    previousSample = { t, density };
    t += stepSize;
    latticeIndex++;
  }

  return {
    hit: false,
    reason: "threshold",
    interval,
    stepSize,
    marchSamples: primaryDensitySamples + evidenceDensitySamples,
    traversal: traversalStats(
      latticeIndex,
      skippedSamples,
      skipRanges,
      hierarchyNodeTests,
      primaryDensitySamples,
      evidenceDensitySamples,
      0,
    ),
  };
}
