/**
 * The scene backdrop's GRADIENT SHAPE: "given a pixel, what is the mix
 * parameter between the two stops" — as opposed to `background.ts`'s
 * "given a mode, what are the two stops". Before this module the shape was
 * written down SIX times: a canvas 2D linear gradient (`scene.ts`), a
 * byte-identical `mix(uBgBottom, uBgTop, clamp(vUv.y, 0.0, 1.0))` in three
 * GLSL fragment shaders, a WGSL row form in the compute kernel, a TS mirror
 * (`buildSurfaceComputeBackground`) obliged to stay byte-for-byte the WGSL,
 * plus `surfaceComputeBandStops` — the shape's AFFINE INVERSE, and only
 * expressible at all because a linear shape restricted to a sub-rectangle is
 * still linear. This module is the ONE definition every mirror consumes.
 *
 * `"radial"` is the second entry in {@link BACKGROUND_SHAPES}: a soft
 * vignette, `t = smoothstep` of the normalized distance from a
 * host-computed `center` scaled by a host-computed `scale` so the shape
 * stays circular in PIXELS rather than in normalized image space (see
 * {@link backgroundRadialScale}). It is a SHAPE, not a fifth
 * `background.ts` mode — every color mode (`dark`/`haze`/`auto`/`custom`)
 * can be linear or radial, so `BackgroundGradient` stays the two-stop pair
 * it always was and `resolveBackground`'s vocabulary is untouched.
 * `top`/`bottom` keep their names under radial too: `bottom` is the stop at
 * `t = 0` (the image CENTRE) and `top` the stop at `t = 1` (the far
 * corners). On every shipped backdrop that puts the LIGHTER stop at the
 * centre and the darker one at the corners — dark's `top` #0d0d18 is darker
 * than its `bottom` #1f2039, haze's `top` #3c4a72 is darker than its
 * `bottom` #5d6d9b, and `autoBackground` (`background.ts`) deliberately
 * "keeps the house darker-top-lighter-bottom shape" — so the vertical
 * ramp's own two-stop authoring already reads as a vignette once its shape
 * turns radial; nothing needed inverting.
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

/** The shipped shapes, in `backgroundShapeCode`'s index order. A future shape
 * APPENDS here — never inserts, since the numeric code is read by shader
 * mirrors that must not have an existing shape's code move. */
export const BACKGROUND_SHAPES = ["linear", "radial"] as const;

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

/** The vignette's default centre — normalized full-image coordinates, the
 * image's own middle. */
export const DEFAULT_BACKGROUND_SHAPE_CENTER: [number, number] = [0.5, 0.5];

/**
 * The shape as a shader/host evaluator sees it: a numeric kind plus
 * whatever geometry a non-linear shape needs to read. ONE object shape
 * rather than a discriminated union — `"linear"` ignores `center`/`scale`
 * — so every mirror threads the same `{kind, center, scale}` regardless of
 * which shape it resolves to. `center`/`scale` are HOST-COMPUTED and
 * passed down rather than re-derived per mirror (see
 * {@link backgroundRadialScale}): a shader body has no notion of "the full
 * image's pixel size" to derive `scale` from on its own, and re-deriving it
 * per mirror is exactly the drift this module exists to prevent. Absent
 * `center`/`scale` default to {@link DEFAULT_BACKGROUND_SHAPE_CENTER} and
 * `[1, 1]` respectively — a caller building a `"radial"` spec should always
 * supply real ones (a `[1, 1]` scale renders correctly only on a square
 * image).
 */
export interface BackgroundShapeSpec {
  kind: BackgroundShape;
  center?: [number, number];
  scale?: [number, number];
}

/**
 * The per-axis scale a radial shape needs so its `t = 1` contour lands
 * EXACTLY on the far corners of a `width x height` image and stays
 * CIRCULAR in pixels rather than elliptical in normalized image space:
 * `scale = (width, height) / (0.5 * sqrt(width^2 + height^2))`, i.e. each
 * axis is normalized by half the image's diagonal. At the centre-anchored
 * default `center = (0.5, 0.5)`, every one of the four corners sits at
 * normalized distance exactly `0.5 * sqrt(width^2 + height^2)` from the
 * centre in PIXELS — dividing both axes by that one shared length is what
 * makes `length((p - center) * scale)` read 1 at every corner regardless
 * of aspect ratio, and a caller repainting a non-square RASTER (a viewport
 * resize, a capture band's full image) simply recomputes this from that
 * raster's own `width`/`height`.
 */
export function backgroundRadialScale(
  width: number,
  height: number,
): [number, number] {
  const halfDiagonal = 0.5 * Math.sqrt(width * width + height * height);
  return [width / halfDiagonal, height / halfDiagonal];
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
 * `mix(uBgBottom, uBgTop, clamp(vUv.y, 0.0, 1.0))` mirrors exactly. Radial
 * is a smoothstep of the (clamped) normalized distance from `center` scaled
 * by `scale` — see {@link backgroundRadialScale} for why per-axis scaling
 * keeps the shape circular in pixels; the smoothstep is this project's own
 * easing polynomial (`BackgroundTween` uses the identical `t*t*(3-2t)`),
 * chosen so the vignette reads as a SOFT glow rather than a hard disc.
 */
export function backgroundShapeT(
  u: number,
  v: number,
  shape: BackgroundShapeSpec,
): number {
  switch (shape.kind) {
    case "linear":
      return clamp(v, 0, 1);
    case "radial": {
      const [cx, cy] = shape.center ?? DEFAULT_BACKGROUND_SHAPE_CENTER;
      const [sx, sy] = shape.scale ?? [1, 1];
      const dx = (u - cx) * sx;
      const dy = (v - cy) * sy;
      const r = clamp(Math.sqrt(dx * dx + dy * dy), 0, 1);
      return r * r * (3 - 2 * r);
    }
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
 *
 * Radial has no closed form (the smoothstep of a radial distance has no
 * elementary antiderivative over a rectangle at arbitrary aspect), so its
 * mean is the AREA-WEIGHTED average of `t` over a deterministic fixed
 * `MEAN_GRID x MEAN_GRID` grid of pixel-centre sample points in normalized
 * coordinates — pure and stable across calls, unlike a call through
 * `backgroundColorAt(u, 0.5, ...)`, which reads `t` at one point rather than
 * integrating it.
 */
const MEAN_GRID = 64;

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
    case "radial": {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < MEAN_GRID; j++) {
        const v = (j + 0.5) / MEAN_GRID;
        for (let i = 0; i < MEAN_GRID; i++) {
          const u = (i + 0.5) / MEAN_GRID;
          const [rf, gf, bf] = backgroundColorAt(u, v, stops, shape);
          r += rf;
          g += gf;
          b += bf;
        }
      }
      const n = MEAN_GRID * MEAN_GRID;
      return [r / n, g / n, b / n];
    }
  }
}

/**
 * One shader dialect's spelling for the emitted `backgroundShapeT` function
 * — `language` picks the signature grammar (GLSL: return-type-first; WGSL:
 * `fn … -> …`), `vec2`/`float` are the dialect's type spellings, and `field`
 * is the accessor the radial branch's uniforms/params read through (GLSL:
 * `uBgCenter`; WGSL: `shade.bgCenter`) — read by {@link backgroundShapeBody}.
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
 * The shared function BODY — ONE template both dialects emit from, so the
 * two shader mirrors cannot drift on the ARITHMETIC. It is
 * dialect-PARAMETERIZED rather than one literal constant: the radial
 * branch reads `shape`/`center`/`scale` through each dialect's own
 * {@link BackgroundShapeDialect.field} accessor, and GLSL's flat uniforms
 * cannot share a spelling with WGSL's `shade.` struct field (`uBgCenter` vs
 * `shade.bgCenter`) — the two emitted bodies are therefore NOT
 * byte-identical text. Three more differences are already-dialect tokens
 * this module carries for every shape: the LOCAL DECLARATION keyword
 * (GLSL's type-prefixed `float r = …` has no WGSL equivalent — WGSL
 * declares locals `let r = …`, type inferred), the `float`/`f32` type
 * spelling ({@link BackgroundShapeDialect.float}, used only in the
 * signature once the declaration itself stopped needing it), and WGSL's
 * mandatory `u` suffix on an unsigned integer literal (`shade.bgShape ==
 * 1u` vs `uBgShape == 1`). Everything else, radial arithmetic included, is
 * the same characters in both. A test pins that the two bodies match once
 * those per-dialect tokens are normalized away, so a future edit to the
 * shared math cannot silently diverge between dialects.
 *
 * Comment kept to one short line: `surface-material-4d.ts` has only ~2.8 KB
 * of headroom under the `SURFACE_GLSL_STRIP_BYTES` 64 KB source-size cliff.
 */
function backgroundShapeBody(dialect: BackgroundShapeDialect): string {
  const isWgsl = dialect.language === "wgsl";
  const one = isWgsl ? "1u" : "1";
  const decl = isWgsl ? "let r" : `${dialect.float} r`;
  return `
  // Shared body — see backgroundShapeT in background-shape.ts.
  if (${dialect.field("Shape")} == ${one}) {
    ${decl} = clamp(length((p - ${dialect.field("Center")}) * ${dialect.field("Scale")}), 0.0, 1.0);
    return r * r * (3.0 - 2.0 * r);
  }
  return clamp(p.y, 0.0, 1.0);
`;
}

function backgroundShapeSignature(dialect: BackgroundShapeDialect): string {
  return dialect.language === "glsl"
    ? `${dialect.float} backgroundShapeT(${dialect.vec2} p)`
    : `fn backgroundShapeT(p: ${dialect.vec2}) -> ${dialect.float}`;
}

/**
 * Emit `backgroundShapeT` as source text in one dialect — the signature from
 * {@link backgroundShapeSignature}, the body from {@link backgroundShapeBody}.
 * `BACKGROUND_SHAPE_GLSL`/`_WGSL` splice straight into
 * `surface-material.ts`/`surface-material-4d.ts`'s GLSL and
 * `surface-de-gpu.ts`'s WGSL respectively.
 */
export function backgroundShapeSource(dialect: BackgroundShapeDialect): string {
  return `${backgroundShapeSignature(dialect)} {${backgroundShapeBody(dialect)}}\n`;
}
