/** A 3-component vector: `[x, y, z]`. */
export type Vec3 = [number, number, number];

/** A 4-component vector: `[x, y, z, w]` (the 4D spike — see `affine4.ts`). */
export type Vec4 = [number, number, number, number];

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
  /**
   * Optional 4D extension (see {@link WExtension}): the degrees of freedom
   * that let this map act in 4-space — a `w` position, an independent `w`
   * scale, and the three w-mixing rotation/shear planes — without promoting
   * the map to a full {@link Transform4}. This is what makes "4D" a property
   * of a SYSTEM (some transform's `w` block is present and non-trivial)
   * rather than a separate mode the whole system opts into. Omitted (or
   * present with every field absent/exactly `0`) ⇒ the map lives flat in the
   * `w = 0` slice, leaving existing systems byte-for-byte unchanged — the
   * same absent-means-identity convention as {@link Transform.weight}/
   * {@link Transform.shear}/{@link Transform.variations}. See `affine4.ts`'s
   * `isFlatTransform`/`systemIsFlat` (the flatness predicates) and
   * `toTransform4` (the lift that splices these overrides onto
   * `embedTransform3`'s embedding).
   */
  w?: WExtension;
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

/**
 * How the 4D projection view colors points (fr-d47), in UI order. Same
 * single-source pattern as {@link COLOR_MODES}: this array drives the
 * {@link FourDColorMode} type and the persistence validator
 * (`VALID_FOUR_D_COLOR_MODES` in `persist.ts`), so adding a mode is one edit.
 * The `w…` entries are diverging palettes on the signed rotated 4th
 * coordinate, colored purely in-shader (see `color.ts`'s `W_SIDE_PALETTES`
 * and scene.ts's `FOUR_D_VERTEX`); `transform` and `radius` bake a
 * rotation-invariant per-point color attribute instead (`color.ts`'s
 * `buildColors4`).
 */
export const FOUR_D_COLOR_MODES = [
  "wBlueOrange",
  "wPurpleGreen",
  "wCyanMagenta",
  "transform",
  "radius",
] as const;

/** How the 4D projection derives point colors. */
export type FourDColorMode = (typeof FOUR_D_COLOR_MODES)[number];

/** The {@link FourDColorMode}s that color in-shader from the signed rotated
 * w — the diverging "w depth" palettes (see `color.ts`'s `W_SIDE_PALETTES`). */
export type WDepthColorMode = Exclude<FourDColorMode, "transform" | "radius">;

/** The {@link FourDColorMode}s that bake a rotation-invariant per-point color
 * attribute on the CPU (see `color.ts`'s `buildColors4`) — the complement of
 * {@link WDepthColorMode}. */
export type FourDAttributeColorMode = Extract<
  FourDColorMode,
  "transform" | "radius"
>;

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

/**
 * Rotation of a 4D map (fr-cbg spike), one optional angle in radians per
 * coordinate plane. A 4D rotation has SIX independent planes (vs. three axes in
 * 3D — in 4D you rotate *in a plane*, not *about an axis*): the three planes of
 * the embedded 3D space (`xy`, `xz`, `yz`) plus the three that mix in the fourth
 * coordinate (`xw`, `yw`, `zw`). Each field is the angle of `R_ab` as defined in
 * `affine4.ts` (rotating the `+a` axis toward `+b`). A missing/undefined field is
 * exactly 0 — see {@link Transform4}. All absent ⇒ the identity rotation.
 */
export interface Rotation4 {
  xy?: number;
  xz?: number;
  yz?: number;
  xw?: number;
  yw?: number;
  zw?: number;
}

/**
 * Shear of a 4D map (fr-hy8): the six above-diagonal entries of a 4x4 unit
 * upper-triangular matrix `U`, the direct 4D extension of {@link Transform.shear}
 * (a `Vec3` `[xy, xz, yz]` in 3D). Each field `ab` sits at row `index(a)`, column
 * `index(b)` of `U` (with `x=0, y=1, z=2, w=3`), row-major:
 *
 *     U = | 1 xy xz xw |
 *         | 0  1 yz yw |
 *         | 0  0  1 zw |
 *         | 0  0  0  1 |
 *
 * The three 3D-plane entries (`xy`, `xz`, `yz`) occupy exactly the slots
 * `affine.ts`'s `shearMatrix` fills from a `Vec3`; the three `w`-column entries
 * (`xw`, `yw`, `zw`) are the new degrees of freedom the fourth coordinate adds.
 * A missing/undefined field is exactly 0 — mirroring {@link Rotation4}. All
 * absent ⇒ the identity (no shear). `U` is right-multiplied into `R·diag(scale)`
 * — see `affine4.ts` (`composeAffine4`).
 */
export interface Shear4 {
  xy?: number;
  xz?: number;
  yz?: number;
  xw?: number;
  yw?: number;
  zw?: number;
}

/**
 * Optional 4D extension a {@link Transform} can carry (its `w` field): the
 * degrees of freedom that let a 3D map act in 4-space — a translation along
 * `w`, an independent `w` scale, and the three w-mixing rotation/shear planes
 * — without promoting the map to a full {@link Transform4}. This is what lets
 * "4D" be a property of a SYSTEM (some transform's `w` block is present and
 * non-trivial) rather than a separate mode the whole system opts into — see
 * `affine4.ts`'s `isFlatTransform`/`systemIsFlat` (the flatness predicates)
 * and `toTransform4` (the lift that applies these overrides on top of
 * `embedTransform3`'s `w = 0` embedding).
 *
 * The rotation/shear fields are literally `Pick`s of {@link Rotation4}'s and
 * {@link Shear4}'s w-mixing entries, so their meaning is exactly the `R_ab`/
 * `U` convention documented there — this block never invents its own angle or
 * shear semantics, it just exposes the three w-planes each already defines.
 * Every field is independently optional, and absent ⇒ its embed default (see
 * each field below); a block with every field absent, or present and exactly
 * `0`, is equivalent to no block at all.
 */
export interface WExtension {
  /** The fourth position coordinate, `t_w`. Absent ⇒ `0`, the `w = 0` slice. */
  position?: number;
  /**
   * The fourth scale factor, `scale_w`. Absent ⇒ DERIVED — recomputed at lift
   * time as the map's mean spatial contraction `(|sx|+|sy|+|sz|)/3` (the same
   * value a plain 3D embed gets), rather than materialised once, so `scale_w`
   * keeps tracking later scale-X/Y/Z edits instead of freezing a stale mean.
   * Set it explicitly to pin `scale_w` independent of the 3D scale.
   */
  scale?: number;
  /**
   * The three w-mixing rotation planes (`R_ab` convention — see
   * {@link Rotation4}): rotating `+x`/`+y`/`+z` toward `+w`. A missing field
   * is exactly 0, matching {@link Rotation4} itself.
   */
  rotation?: Pick<Rotation4, "xw" | "yw" | "zw">;
  /**
   * The three w-column entries of {@link Shear4}'s unit upper-triangular `U`.
   * A missing field is exactly 0, matching {@link Shear4} itself.
   */
  shear?: Pick<Shear4, "xw" | "yw" | "zw">;
}

/**
 * One affine map of a 4D IFS (fr-cbg spike; completed in fr-hy8). With shear and
 * variations it now parameterizes the FULL 20-dimensional affine group of R⁴ —
 * 4 position + 4 scale + 6 rotation ({@link Rotation4}) + 6 shear
 * ({@link Shear4}) — the exact `M = R · diag(scale) · U` (QR-style) picture of
 * the 3D {@link Transform} one dimension up, plus the same post-affine nonlinear
 * {@link Variation} blend. Every field but `position`/`scale` is optional and
 * absent ⇒ its identity, so a plain contraction stays a two-field object and
 * embeds/composes bit-identically. See `affine4.ts` (`composeAffine4`) and
 * `chaos-game-4d.ts`.
 */
export interface Transform4 {
  position: Vec4;
  scale: Vec4;
  /** Plane rotation; omitted ⇒ no rotation (identity linear part before scale). */
  rotation?: Rotation4;
  /**
   * Unit upper-triangular shear factor `U`, right-multiplied as
   * `M = R · diag(scale) · U` (see {@link Shear4}); omitted ⇒ no shear. The 4D
   * analogue of {@link Transform.shear}, completing the affine parameterization.
   */
  shear?: Shear4;
  /**
   * Nonlinear variations blended in after the affine part, same
   * weighted-sum semantics as {@link Transform.variations} (see
   * `variations4.ts`). Omitted or empty ⇒ the map stays purely affine.
   */
  variations?: Variation[];
  /**
   * Relative selection weight for the 4D chaos game, mirroring
   * {@link Transform.weight}. Omitted ⇒ 1.
   */
  weight?: number;
}

/** Axis-aligned extent of a 4D point cloud (the 4D analogue of {@link Bounds}). */
export interface Bounds4 {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  minW: number;
  maxW: number;
}
