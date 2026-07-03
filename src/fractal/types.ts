/** A 3-component vector: `[x, y, z]`. */
export type Vec3 = [number, number, number];

/**
 * The nonlinear variation functions, in UI order. Borrowed from the fractal
 * flame algorithm: each warps space in a distinctive way *after* a transform's
 * affine part, turning the strictly self-similar IFS into flowing, organic
 * shapes. `linear` is the identity (the plain affine result), included so it can
 * be blended in alongside the others.
 *
 * This array is the single source of truth for both the {@link VariationType}
 * type and the persistence validator (`VALID_VARIATION_TYPES` in `persist.ts`)
 * *and* the function registry (`VARIATIONS` in `variations.ts`, a
 * `Record<VariationType, …>` so every name here must have an implementation), so
 * adding a variation is one edit and none of those can silently drift apart.
 */
export const VARIATION_TYPES = [
  "linear",
  "sinusoidal",
  "spherical",
  "swirl",
  "horseshoe",
  "polar",
  "handkerchief",
  "heart",
  "disc",
  "spiral",
  "bubble",
  "julia",
] as const;

/** One nonlinear warp a transform can apply after its affine part. */
export type VariationType = (typeof VARIATION_TYPES)[number];

/**
 * A single weighted variation. A transform's post-affine point is the weighted
 * sum `Σ weight · V(type)` over its variations (flame-style blending), so a map
 * can mix, say, mostly `spherical` with a little `swirl`. Weight 0 disables the
 * variation; the weights are *not* normalised — they are free strengths.
 */
export interface Variation {
  type: VariationType;
  weight: number;
}

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
  /**
   * Relative selection weight for the chaos game. The iterator picks each map
   * with probability proportional to its weight, so a frond map at weight 12 is
   * drawn ~12× as often as a leaflet at weight 1. Omitted ⇒ 1, and a system
   * whose weights are all 1 samples uniformly exactly as before.
   */
  weight?: number;
  /**
   * Optional shear `[xy, xz, yz]`, a unit upper-triangular factor `U` applied as
   * `M = R · diag(scale) · U`. Rotation + per-axis scale alone can only produce
   * orthogonal-column maps; shear supplies the remaining 3 degrees of freedom,
   * so position/rotation/scale/shear together express *any* affine map. Omitted
   * ⇒ no shear, leaving existing systems unchanged.
   */
  shear?: Vec3;
  /**
   * Optional nonlinear variations blended in after the affine part (see
   * {@link Variation} and `variations.ts`). Omitted or empty ⇒ the map stays
   * purely affine, leaving every existing system byte-for-byte unchanged.
   */
  variations?: Variation[];
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

/**
 * Axes {@link SymmetryParams} can rotate copies about. This array is the
 * single source of truth for both the {@link SymmetryAxis} type and the
 * persistence validator (`VALID_SYMMETRY_AXES` in `persist.ts`), so adding an
 * axis is one edit and the runtime guard can never silently drift from the
 * type.
 */
export const SYMMETRY_AXES = ["x", "y", "z"] as const;

/** One axis a kaleidoscope's rotated copies can turn about. */
export type SymmetryAxis = (typeof SYMMETRY_AXES)[number];

/**
 * Rotational/mirror symmetry (fr-6im): replicate the whole transform set
 * `order` times, each copy rotated by an additional `2π / order` about
 * `axis`, producing a kaleidoscope — see `chaos-game.ts`'s
 * `prepareChaosGame`. `order: 1` is the identity regardless of `axis`: today's
 * system, unreplicated.
 */
export interface SymmetryParams {
  /** Number of rotated copies, including the unrotated original. `1` = off. */
  order: number;
  /** Axis the copies are rotated about. */
  axis: SymmetryAxis;
}
