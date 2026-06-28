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

/** How point colors are derived from the generated cloud. */
export type ColorMode =
  "transform" | "height" | "radius" | "position" | "iterationAge" | "uniform";

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
