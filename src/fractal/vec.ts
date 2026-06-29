import type { Vec3 } from "./types";

/** Clamp `value` into the closed interval `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Return a shallow copy of a Vec3 tuple. */
export function clone3(v: Vec3): Vec3 {
  return [v[0], v[1], v[2]];
}

/**
 * Scale a normalised sRGB channel `[0, 1]` to an 8-bit integer `[0, 255]`.
 * Used when building CSS `rgb(…)` strings from Vec3 colour values.
 */
export function to255(channel: number): number {
  return Math.round(channel * 255);
}
