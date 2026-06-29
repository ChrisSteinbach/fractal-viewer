/** A 3-component vector: `[x, y, z]`. */
export type Vec3 = [number, number, number];

/**
 * One affine map in the iterated function system. Position, rotation (Euler
 * angles in radians, applied in XYZ order), and per-axis scale together define
 * a 4x4 transform — see {@link composeAffine}.
 */
export interface Transform {
  id: number;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

/**
 * The color modes, in UI order. This array is the single source of truth for
 * both the {@link ColorMode} type and the persistence validator
 * (`VALID_COLOR_MODES` in `persist.ts`), so adding a mode is one edit and the
 * runtime guard can never silently drift from the type.
 */
export const COLOR_MODES = [
  "transform",
  "height",
  "radius",
  "position",
  "iterationAge",
  "uniform",
] as const;

/** How point colors are derived from the generated cloud. */
export type ColorMode = (typeof COLOR_MODES)[number];

/** Axis-aligned extent of a point cloud, plus radial extent from the origin. */
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  minR: number;
  maxR: number;
}
