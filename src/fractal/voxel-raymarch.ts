/**
 * Pure CPU reference for the Solid renderer's packed-density isosurface.
 *
 * This deliberately mirrors the simple, unaccelerated primary march in
 * `app/voxel-material.ts`: intersect the source AABB, take a fixed number of
 * phase-shifted samples, accept only density STRICTLY above the threshold,
 * then bisect the last-outside/first-inside interval. It is an oracle for
 * testing faster traversals, not a second rendering path.
 */
import type { Vec3 } from "./types";

/** The Solid shader currently performs five crossing-refinement bisections. */
export const VOXEL_RAYMARCH_REFINE_STEPS = 5;

/** RGBA8 volume produced by `voxelTextureData`, with x-fastest texel layout. */
export interface PackedVoxelDensityVolume {
  data: Uint8Array;
  size: number;
  boundsMin: Vec3;
  boundsMax: Vec3;
}

export interface VoxelDensityRay {
  origin: Vec3;
  /** Need not be normalized; the shader normalizes its reconstructed ray. */
  direction: Vec3;
}

export interface VoxelDensitySample {
  /** World-space distance along the normalized ray. */
  t: number;
  density: number;
}

export interface VoxelDensityCrossingEvidence {
  /** The first fixed-stride sample whose density was strictly above level. */
  firstInside: VoxelDensitySample;
  /** Null when the very first in-box sample was already inside. */
  lastOutside: VoxelDensitySample | null;
  /** Final non-inside endpoint after refinement (or the collapsed hit sample). */
  refinedOutside: VoxelDensitySample;
  /** Final strictly-inside endpoint; this is the reported hit. */
  refinedInside: VoxelDensitySample;
}

export interface VoxelDensityRayHit {
  hit: true;
  /** Refined first-inside distance and corresponding world-space point. */
  t: number;
  position: Vec3;
  density: number;
  tNear: number;
  tFar: number;
  stepSize: number;
  marchSamples: number;
  refinementSamples: number;
  crossing: VoxelDensityCrossingEvidence;
}

export interface VoxelDensityRayMiss {
  hit: false;
  reason: "bounds" | "threshold";
  /** Clipped in-front-of-camera interval; null when the ray misses the box. */
  interval: { tNear: number; tFar: number } | null;
  stepSize: number;
  marchSamples: number;
}

export type VoxelDensityRayResult = VoxelDensityRayHit | VoxelDensityRayMiss;

export interface VoxelDensityRaymarchOptions {
  /** Isosurface level in normalized packed-alpha units. */
  threshold: number;
  /** Fixed primary sample budget, corresponding to shader `uMarchSteps`. */
  marchSteps: number;
  /**
   * Fraction of one stride added to the box entry. The shader supplies its
   * per-pixel hash here; explicit input keeps oracle tests deterministic.
   */
  phase?: number;
  /** Defaults to the shader's five bisections. */
  refinementSteps?: number;
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
  if (extent.some((v) => !Number.isFinite(v) || !(v > 0))) {
    throw new RangeError(
      "voxel volume bounds must have positive finite extent",
    );
  }
  return extent;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function samplePackedAlphaUnchecked(
  volume: PackedVoxelDensityVolume,
  extent: Vec3,
  p: Vec3,
): number {
  const { data, size, boundsMin } = volume;
  const axis = (world: number, min: number, span: number) => {
    // WebGL normalized texture coordinates address texel centers at
    // (i + 0.5) / size. Clamp the integer taps exactly like ClampToEdge.
    const x = ((world - min) / span) * size - 0.5;
    const lo = Math.floor(x);
    return {
      lo: clamp(lo, 0, size - 1),
      hi: clamp(lo + 1, 0, size - 1),
      f: x - lo,
    };
  };
  const x = axis(p[0], boundsMin[0], extent[0]);
  const y = axis(p[1], boundsMin[1], extent[1]);
  const z = axis(p[2], boundsMin[2], extent[2]);
  const alpha = (ix: number, iy: number, iz: number): number =>
    data[(ix + iy * size + iz * size * size) * 4 + 3] / 255;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const z0y0 = lerp(alpha(x.lo, y.lo, z.lo), alpha(x.hi, y.lo, z.lo), x.f);
  const z0y1 = lerp(alpha(x.lo, y.hi, z.lo), alpha(x.hi, y.hi, z.lo), x.f);
  const z1y0 = lerp(alpha(x.lo, y.lo, z.hi), alpha(x.hi, y.lo, z.hi), x.f);
  const z1y1 = lerp(alpha(x.lo, y.hi, z.hi), alpha(x.hi, y.hi, z.hi), x.f);
  return lerp(lerp(z0y0, z0y1, y.f), lerp(z1y0, z1y1, y.f), z.f);
}

/**
 * Trilinearly reconstruct normalized packed alpha using the Solid texture's
 * texel-center coordinates and ClampToEdge sampler state.
 */
export function samplePackedVoxelDensity(
  volume: PackedVoxelDensityVolume,
  p: Vec3,
): number {
  return samplePackedAlphaUnchecked(volume, validateVolume(volume), p);
}

/**
 * Bounded form used by Solid's balloon refusal/query semantics: an
 * out-of-volume position is empty rather than a clamped boundary texel.
 */
export function sampleVoxelAlpha(
  data: Uint8Array,
  size: number,
  boundsMin: Vec3,
  boundsMax: Vec3,
  p: Vec3,
): number {
  const volume = { data, size, boundsMin, boundsMax };
  let extent: Vec3;
  try {
    extent = validateVolume(volume);
  } catch {
    // Preserve the defensive zero returned by the pre-oracle helper used by
    // scene wiring while the pure oracle itself rejects malformed inputs.
    return 0;
  }
  if (p.some((v, axis) => v < boundsMin[axis] || v > boundsMax[axis])) {
    return 0;
  }
  return samplePackedAlphaUnchecked(volume, extent, p);
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

/**
 * Reference fixed-step raymarch through the trilinearly reconstructed packed
 * density. The returned bracket and sample counts make hit/miss equivalence
 * diagnosable when an accelerated marcher is compared with this oracle.
 */
export function raymarchPackedVoxelDensity(
  volume: PackedVoxelDensityVolume,
  ray: VoxelDensityRay,
  options: VoxelDensityRaymarchOptions,
): VoxelDensityRayResult {
  const extent = validateVolume(volume);
  const direction = normalizedDirection(ray.direction);
  if (ray.origin.some((v) => !Number.isFinite(v))) {
    throw new RangeError("voxel ray origin must be finite");
  }
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
    };
  }

  const stepSize = (interval.tFar - interval.tNear) / marchSteps;
  let t = interval.tNear + stepSize * phase;
  let previous: VoxelDensitySample | null = null;
  let firstInside: VoxelDensitySample | null = null;
  let marchSamples = 0;
  for (let i = 0; i < marchSteps; i++) {
    const density = samplePackedAlphaUnchecked(
      volume,
      extent,
      pointOnRay(ray.origin, direction, t),
    );
    marchSamples++;
    if (density > threshold) {
      firstInside = { t, density };
      break;
    }
    previous = { t, density };
    t += stepSize;
  }

  if (firstInside === null) {
    return {
      hit: false,
      reason: "threshold",
      interval,
      stepSize,
      marchSamples,
    };
  }

  // The shader initializes tPrev to the first sample. If that sample is
  // already inside, refinement therefore collapses to the hit rather than
  // inventing an outside endpoint at the AABB entry.
  const lastOutside = previous;
  let refinedOutside = previous ?? firstInside;
  let refinedInside = firstInside;
  let refinementSamples = 0;
  for (let i = 0; i < refinementSteps; i++) {
    const midT = (refinedOutside.t + refinedInside.t) * 0.5;
    const midDensity = samplePackedAlphaUnchecked(
      volume,
      extent,
      pointOnRay(ray.origin, direction, midT),
    );
    const mid = { t: midT, density: midDensity };
    refinementSamples++;
    if (midDensity > threshold) refinedInside = mid;
    else refinedOutside = mid;
  }

  return {
    hit: true,
    t: refinedInside.t,
    position: pointOnRay(ray.origin, direction, refinedInside.t),
    density: refinedInside.density,
    ...interval,
    stepSize,
    marchSamples,
    refinementSamples,
    crossing: {
      firstInside,
      lastOutside,
      refinedOutside,
      refinedInside,
    },
  };
}
