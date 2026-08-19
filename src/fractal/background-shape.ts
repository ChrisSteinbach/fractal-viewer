/**
 * The scene backdrop's GRADIENT SHAPE (fr-xn9s): "given a pixel, what is the
 * mix parameter between the two stops" — as opposed to `background.ts`'s
 * "given a mode, what are the two stops". Before this module the shape was
 * written down SIX times: a canvas 2D linear gradient (`scene.ts`), a
 * byte-identical `mix(uBgBottom, uBgTop, clamp(vUv.y, 0.0, 1.0))` in three
 * GLSL fragment shaders, a WGSL row form in the compute kernel, a TS mirror
 * (`buildSurfaceComputeBackground`) obliged to stay byte-for-byte the WGSL,
 * plus `surfaceComputeBandStops` — the shape's AFFINE INVERSE, and only
 * expressible at all because a linear shape restricted to a sub-rectangle is
 * still linear. This module is the ONE definition every mirror consumes; a
 * later shape (`"radial"`, fr-h3mp) is a second entry in
 * {@link BACKGROUND_SHAPES} plus one branch per function here, not a new
 * mirror.
 *
 * **The coordinate contract.** Every mirror evaluates the shape at
 * FULL-IMAGE normalized coordinates, derived from the pixel it is tracing by
 * {@link backgroundImageUv}:
 *
 *   imageUv = (vec2(px, py) + 0.5 + offset) / extent
 *
 * `offset` is the pixel offset of the raster being traced within the full
 * image; `extent` is the FULL IMAGE's pixel dimensions — not the raster's
 * own. An ordinary frame has `offset = (0, 0)` and `extent` equal to the
 * raster's own size, so `imageUv.y = (py + 0.5) / rasterHeight` —
 * byte-identical to the expression shipping today. A horizontal capture BAND
 * at rows `[bandBottom, bandBottom + h)` of a `fullHeight`-tall image has
 * `offset = (0, bandBottom)` and `extent = (fullWidth, fullHeight)`, so
 * `imageUv.y = (bandBottom + py + 0.5) / fullHeight` — the BIT-IDENTICAL
 * value the full-image trace would compute for that same row.
 *
 * That bit-identity is a DIVISION by the full extent, deliberately, not a
 * multiplication by a precomputed reciprocal: a future edit that "optimizes"
 * this into `* invExtent` would silently break the band-assembly
 * byte-equality the capture path asserts (an `a / b` and an `a * (1 / b)`
 * are not guaranteed to round the same way in IEEE754). It is also why
 * `surfaceComputeBandStops` — the old affine remap of the two stops onto a
 * band's own sub-range — is retired rather than generalized: a radial shape
 * has no two-stop restriction to a sub-rectangle to remap onto in the first
 * place, while re-deriving `imageUv` per pixel from the full extent works
 * for every shape, linear included, with no per-shape band math at all.
 *
 * Pure: no Three.js, no DOM, no imports outside `src/fractal/`.
 */
import { clamp } from "./vec";
import type { RgbStop } from "./palette";

/** The shipped shapes, in `backgroundShapeCode`'s index order. `"radial"`
 * (fr-h3mp) appends here — never inserts, since the numeric code is read by
 * shader mirrors that must not have an existing shape's code move. */
export const BACKGROUND_SHAPES = ["linear"] as const;

export type BackgroundShape = (typeof BACKGROUND_SHAPES)[number];

/** The shape a fresh backdrop resolves to before any authoring exists. */
export const DEFAULT_BACKGROUND_SHAPE: BackgroundShape = "linear";

/** The numeric code a shader mirror packs into its params/uniforms — this
 * module's own list index, so a new entry in {@link BACKGROUND_SHAPES} needs
 * no matching edit here. */
export function backgroundShapeCode(shape: BackgroundShape): number {
  return BACKGROUND_SHAPES.indexOf(shape);
}

/**
 * Two gradient stops, structurally `background.ts`'s `BackgroundGradient`
 * (that module lives in the app layer and cannot be imported from here —
 * `src/fractal/` has no dependency on `src/app/`). Callers there pass their
 * `BackgroundGradient` values straight through; the shapes are structurally
 * identical.
 */
export interface BackgroundStops {
  top: RgbStop;
  bottom: RgbStop;
}

/**
 * The shape as a shader/host evaluator sees it: a numeric kind plus
 * whatever geometry a non-linear shape needs to read (a radial shape will
 * add a center/radius here). Host-computed and passed down rather than
 * re-derived per mirror, so no shader body has to reconstruct it.
 */
export interface BackgroundShapeSpec {
  kind: BackgroundShape;
}

/**
 * A pixel's full-image normalized coordinates — the ONE place the `+ 0.5`
 * pixel-centre convention is written on the host side. See the module doc's
 * coordinate contract for `offset`/`extent` and why this is a division
 * rather than a precomputed-reciprocal multiply.
 */
export function backgroundImageUv(
  px: number,
  py: number,
  offset: readonly [number, number],
  extent: readonly [number, number],
): [number, number] {
  return [
    (px + 0.5 + offset[0]) / extent[0],
    (py + 0.5 + offset[1]) / extent[1],
  ];
}

/**
 * The shape parameter `t` at full-image normalized coordinates `(u, v)` —
 * `mix(bottom, top, t)` is the pixel's color (see {@link backgroundColorAt}).
 * Linear ignores `u` and clamps `v`, matching the shipping
 * `mix(uBgBottom, uBgTop, clamp(vUv.y, 0.0, 1.0))` mirrors exactly.
 */
export function backgroundShapeT(
  u: number,
  v: number,
  shape: BackgroundShapeSpec,
): number {
  switch (shape.kind) {
    case "linear":
      return clamp(v, 0, 1);
  }
}

/** The color at full-image normalized coordinates `(u, v)`:
 * `mix(bottom, top, t)`, per channel, computed the same two-term way every
 * shader mirror does. Only the SHAPE (`t`) is centralized here — the mix
 * itself stays the same three-token expression at every call site. */
export function backgroundColorAt(
  u: number,
  v: number,
  stops: BackgroundStops,
  shape: BackgroundShapeSpec,
): [number, number, number] {
  const t = backgroundShapeT(u, v, shape);
  const { top, bottom } = stops;
  return [
    bottom[0] + (top[0] - bottom[0]) * t,
    bottom[1] + (top[1] - bottom[1]) * t,
    bottom[2] + (top[2] - bottom[2]) * t,
  ];
}

/**
 * The frame's area-weighted MEAN color — the single color a per-pixel
 * background collapses to for a consumer with no per-pixel hook (THREE.Fog
 * carries one scalar color). Linear's mean of `t` over `[0, 1]` is exactly
 * `1/2`, so this is the stops' midpoint via the closed form `(top +
 * bottom) / 2` — NOT `backgroundColorAt(u, 0.5, …)`, whose
 * `bottom + (top - bottom) * 0.5` is not guaranteed bit-identical to
 * `(top + bottom) / 2` in IEEE754 for arbitrary stops. This is the exact
 * expression `backdropMidpoint` used to compute inline; centralizing it here
 * keeps that byte-identity a property of the shape rather than of whichever
 * caller happened to write the fraction out.
 */
export function backgroundMeanColor(
  stops: BackgroundStops,
  shape: BackgroundShapeSpec,
): [number, number, number] {
  switch (shape.kind) {
    case "linear": {
      const { top, bottom } = stops;
      return [
        (top[0] + bottom[0]) / 2,
        (top[1] + bottom[1]) / 2,
        (top[2] + bottom[2]) / 2,
      ];
    }
  }
}

/**
 * One shader dialect's spelling for the emitted `backgroundShapeT` function
 * — `language` picks the signature grammar (GLSL: return-type-first; WGSL:
 * `fn … -> …`), `vec2`/`float` are the dialect's type spellings, and `field`
 * is the accessor a shape's own uniforms/params would read through (GLSL:
 * `uBgCenter`; WGSL: `shade.bgCenter`) — unused by `"linear"`, shipped now
 * so `"radial"` (fr-h3mp) reads its center/radius through the SAME accessor
 * in both dialects rather than inventing a second one.
 */
export interface BackgroundShapeDialect {
  readonly language: "glsl" | "wgsl";
  readonly vec2: string;
  readonly float: string;
  readonly field: (name: string) => string;
}

export const BACKGROUND_SHAPE_GLSL: BackgroundShapeDialect = {
  language: "glsl",
  vec2: "vec2",
  float: "float",
  field: (name) => `uBg${name}`,
};

export const BACKGROUND_SHAPE_WGSL: BackgroundShapeDialect = {
  language: "wgsl",
  vec2: "vec2f",
  float: "f32",
  field: (name) => `shade.bg${name}`,
};

/**
 * The shared function BODY, in ONE constant both dialects emit verbatim —
 * the entire point of this module is that the two shader mirrors cannot
 * drift, so the body text is never written twice. Comment kept to one short
 * line: `surface-material-4d.ts` has only ~3.6 KB of headroom under the
 * `SURFACE_GLSL_STRIP_BYTES` 64 KB source-size cliff.
 */
const BACKGROUND_SHAPE_BODY = `
  // fr-xn9s: shared body — see backgroundShapeT in background-shape.ts.
  return clamp(p.y, 0.0, 1.0);
`;

function backgroundShapeSignature(dialect: BackgroundShapeDialect): string {
  return dialect.language === "glsl"
    ? `${dialect.float} backgroundShapeT(${dialect.vec2} p)`
    : `fn backgroundShapeT(p: ${dialect.vec2}) -> ${dialect.float}`;
}

/**
 * Emit `backgroundShapeT` as source text in one dialect — the signature from
 * {@link backgroundShapeSignature}, the body from the one shared
 * {@link BACKGROUND_SHAPE_BODY} constant. `BACKGROUND_SHAPE_GLSL`/`_WGSL`
 * splice straight into `surface-material.ts`/`surface-material-4d.ts`'s GLSL
 * and `surface-de-gpu.ts`'s WGSL respectively.
 */
export function backgroundShapeSource(dialect: BackgroundShapeDialect): string {
  return `${backgroundShapeSignature(dialect)} {${BACKGROUND_SHAPE_BODY}}\n`;
}
