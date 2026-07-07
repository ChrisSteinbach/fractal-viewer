import type { ChaosGameResult } from "./chaos-game";
import type { ChaosGame4Result } from "./chaos-game-4d";
import type {
  ColorMode,
  FourDAttributeColorMode,
  FourDColorMode,
  Transform,
  Vec3,
  WDepthColorMode,
} from "./types";

function hue2rgb(q: number, p: number, t: number): number {
  let h = t;
  if (h < 0) h += 1;
  if (h > 1) h -= 1;
  if (h < 1 / 6) return q + (p - q) * 6 * h;
  if (h < 1 / 2) return p;
  if (h < 2 / 3) return q + (p - q) * 6 * (2 / 3 - h);
  return q;
}

/**
 * HSL → sRGB, matching the algorithm `THREE.Color.setHSL` uses. `h` wraps to
 * `[0, 1)`; `s` and `l` are clamped to `[0, 1]`. Returned channels are sRGB in
 * `[0, 1]` and fed straight to the point cloud (the renderer runs with color
 * management off, so authored colors display as-is).
 */
export function hslToRgb(h: number, s: number, l: number): Vec3 {
  const hue = ((h % 1) + 1) % 1;
  const sat = Math.min(1, Math.max(0, s));
  const lum = Math.min(1, Math.max(0, l));
  if (sat === 0) return [lum, lum, lum];
  const p = lum <= 0.5 ? lum * (1 + sat) : lum + sat - lum * sat;
  const q = 2 * lum - p;
  return [
    hue2rgb(q, p, hue + 1 / 3),
    hue2rgb(q, p, hue),
    hue2rgb(q, p, hue - 1 / 3),
  ];
}

/**
 * Internal hot-path variant: write HSL → sRGB directly into `out` at byte
 * offset `o` (i.e. out[o], out[o+1], out[o+2]) with no intermediate array
 * allocation. Identical math to `hslToRgb`.
 */
function writeHsl(
  out: Float32Array,
  o: number,
  h: number,
  s: number,
  l: number,
): void {
  const hue = ((h % 1) + 1) % 1;
  const sat = Math.min(1, Math.max(0, s));
  const lum = Math.min(1, Math.max(0, l));
  if (sat === 0) {
    out[o] = lum;
    out[o + 1] = lum;
    out[o + 2] = lum;
    return;
  }
  const p = lum <= 0.5 ? lum * (1 + sat) : lum + sat - lum * sat;
  const q = 2 * lum - p;
  out[o] = hue2rgb(q, p, hue + 1 / 3);
  out[o + 1] = hue2rgb(q, p, hue);
  out[o + 2] = hue2rgb(q, p, hue - 1 / 3);
}

/** Evenly spaced hues, one per transform — the "by transform" palette. */
export function transformColors(count: number): Vec3[] {
  const colors: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    colors.push(hslToRgb(i / count, 0.8, 0.6));
  }
  return colors;
}

/**
 * The "by height" ramp at normalized height `t` in [0, 1] — blue (low) →
 * green (mid) → red (high) — written into `out` at offset `o`. The ONE
 * definition of the ramp: `buildColors`' height branch and
 * {@link buildColorModeLUT} both call this, so the explorer's point colors
 * and the solid render's voxel colors can never drift apart.
 */
function writeHeightColor(out: Float32Array, o: number, t: number): void {
  if (t < 0.5) {
    writeHsl(out, o, 0.6 - t * 0.4, 0.8, 0.5);
  } else {
    writeHsl(out, o, 0.2 - (t - 0.5) * 0.4, 0.8, 0.5);
  }
}

/** The "by radius" ramp at normalized radius `t` in [0, 1] — inner = warm,
 * outer = cool. Single definition, shared exactly like the height ramp. */
function writeRadiusColor(out: Float32Array, o: number, t: number): void {
  writeHsl(out, o, t * 0.7, 0.85, 0.55);
}

/** The "uniform" mode's cyan, shared by `buildColors` and the solid render. */
export const UNIFORM_POINT_COLOR: Vec3 = [0.4, 0.8, 1.0];

/** How "by position" maps a normalized coordinate to a channel: compressed
 * into [0.2, 1.0] so no axis ever fades fully to black. Shared constants for
 * the same no-drift reason as the ramp writers. */
export const POSITION_COLOR_SCALE = 0.8;
export const POSITION_COLOR_OFFSET = 0.2;

/**
 * Apply the color-contrast exponent (fr-8sk) to a normalized coordinate `t`
 * that is expected to sit in `[0, 1]`: `t' = t ** colorGamma`. `colorGamma <
 * 1` spreads out the low end of the distribution (more contrast among
 * sparse/faint values), `> 1` spreads the high end; the endpoints `t = 0` and
 * `t = 1` are fixed either way. `colorGamma === 1` (the default) skips the
 * `**` call entirely and returns `t` unchanged, so that path is guaranteed
 * bit-identical to the pre-gamma code and pays nothing for the feature.
 *
 * Clamps to `[0, 1]` before raising to a non-1 power: `t` can drift a hair
 * outside that range (e.g. `buildColors`' bounds are float64 but the plotted
 * positions are read back from a `Float32Array`, so the point that defined
 * the bound can round to a value a hair past it) — harmless when `t` is only
 * ever blended linearly, as every ramp here was before this feature, but a
 * barely-negative base raised to a fractional power is `NaN`.
 */
function applyColorGamma(t: number, colorGamma: number): number {
  if (colorGamma === 1) return t;
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c ** colorGamma;
}

/**
 * A 256-entry interleaved-RGB lookup table over the height or radius ramp —
 * for hot loops that need a ramp color per iteration without `writeHsl`'s
 * trigonometry-free-but-branchy work in the inner loop (the solid render's
 * `accumulateVoxels`). Entry `i` is the ramp at `t = (i / 255) ** colorGamma`
 * (see {@link applyColorGamma}; `colorGamma` defaults to `1`, today's linear
 * mapping); quantizing to 256 steps matches the flame's palette LUT precision.
 *
 * `colorGamma` MUST be the same value the caller's `buildColors` uses for the
 * same render (see {@link colorModeUsesGamma}) — this LUT and `buildColors`'
 * height/radius branches are the ONE ramp definition, shared so the solid
 * render's voxel colors and the explorer's point colors can never drift apart.
 */
export function buildColorModeLUT(
  mode: "height" | "radius",
  colorGamma = 1,
): Float32Array {
  const lut = new Float32Array(256 * 3);
  const write = mode === "height" ? writeHeightColor : writeRadiusColor;
  for (let i = 0; i < 256; i++) {
    write(lut, i * 3, applyColorGamma(i / 255, colorGamma));
  }
  return lut;
}

/**
 * Build the per-point color buffer for a generated cloud. Each {@link ColorMode}
 * maps a point's transform, height, radius, position, or generation order to an
 * sRGB color, mirroring the original viewer's palettes.
 *
 * The mode dispatch is hoisted outside the loop and each branch writes channels
 * directly into the output `Float32Array`, keeping allocations O(1) per call
 * regardless of point count.
 *
 * `colorGamma` (fr-8sk) is a contrast exponent applied to the normalized
 * coordinate in the `"height"`/`"radius"`/`"position"` modes — see
 * {@link colorModeUsesGamma} and {@link applyColorGamma} for the exact
 * mapping and its `NaN`-avoiding clamp. `1` (the default) is neutral —
 * today's linear mapping, applied via a short-circuit that never calls `**`
 * — and `"transform"`/`"uniform"` ignore it entirely, having no coordinate
 * to reshape.
 */
export function buildColors(
  result: ChaosGameResult,
  transforms: Transform[],
  mode: ColorMode,
  colorGamma = 1,
): Float32Array {
  const { positions, transformIndices, count, bounds } = result;
  const colors = new Float32Array(count * 3);

  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;
  const rangeZ = bounds.maxZ - bounds.minZ || 1;
  const rangeR = bounds.maxR - bounds.minR || 1;
  const g = colorGamma;

  switch (mode) {
    case "transform": {
      const tColors = transformColors(transforms.length);
      for (let i = 0; i < count; i++) {
        const rgb = tColors[transformIndices[i]] ?? [1, 1, 1];
        const o = i * 3;
        colors[o] = rgb[0];
        colors[o + 1] = rgb[1];
        colors[o + 2] = rgb[2];
      }
      break;
    }
    case "height": {
      // Blue (low) → green (mid) → red (high).
      for (let i = 0; i < count; i++) {
        const py = positions[i * 3 + 1];
        const t = (py - bounds.minY) / rangeY;
        writeHeightColor(colors, i * 3, applyColorGamma(t, g));
      }
      break;
    }
    case "radius": {
      // Inner = warm, outer = cool.
      for (let i = 0; i < count; i++) {
        const o = i * 3;
        const px = positions[o];
        const py = positions[o + 1];
        const pz = positions[o + 2];
        const r = Math.sqrt(px * px + py * py + pz * pz);
        const t = (r - bounds.minR) / rangeR;
        writeRadiusColor(colors, o, applyColorGamma(t, g));
      }
      break;
    }
    case "position": {
      // XYZ → RGB. Gamma is applied to each normalized coordinate BEFORE the
      // compressed-range scale/offset, exactly like the height/radius ramps.
      for (let i = 0; i < count; i++) {
        const o = i * 3;
        const tx = applyColorGamma((positions[o] - bounds.minX) / rangeX, g);
        const ty = applyColorGamma(
          (positions[o + 1] - bounds.minY) / rangeY,
          g,
        );
        const tz = applyColorGamma(
          (positions[o + 2] - bounds.minZ) / rangeZ,
          g,
        );
        colors[o] = tx * POSITION_COLOR_SCALE + POSITION_COLOR_OFFSET;
        colors[o + 1] = ty * POSITION_COLOR_SCALE + POSITION_COLOR_OFFSET;
        colors[o + 2] = tz * POSITION_COLOR_SCALE + POSITION_COLOR_OFFSET;
      }
      break;
    }
    case "uniform":
    default: {
      const [ur, ug, ub] = UNIFORM_POINT_COLOR;
      for (let i = 0; i < count * 3; i += 3) {
        colors[i] = ur;
        colors[i + 1] = ug;
        colors[i + 2] = ub;
      }
      break;
    }
  }

  return colors;
}

/** True for the color modes that normalize a point coordinate against the
 * cloud bounds — the modes the color-contrast (gamma) control applies to.
 * Single source of truth: the UI's slider-row visibility keys on this. */
export function colorModeUsesGamma(mode: ColorMode): boolean {
  return mode === "height" || mode === "radius" || mode === "position";
}

/**
 * The diverging side-color pairs for the 4D projection's "w depth" color
 * modes (fr-d47): `neg` tints the −w side of our 3-space, `pos` the +w side,
 * and the shader mixes either toward a dim gray notch as |rotated w| → 0
 * (scene.ts's `FOUR_D_VERTEX`). Every pair keeps the original blue/orange
 * ramp's conventions: the cool color sits on −w, and the pair's additive sum
 * pushes toward white, so genuine 4D self-overlap still flags itself in a
 * color no single point can have. Plain data rather than GLSL constants, so
 * the shader uniforms (scene.ts), the panel legend (ui.ts), and the tests all
 * read the ONE definition and can never drift on the palette itself — only
 * the ramp's shape constants remain mirrored in GLSL (see ui.ts's
 * `wRampGradient`).
 */
export const W_SIDE_PALETTES: Record<
  WDepthColorMode,
  { neg: Vec3; pos: Vec3 }
> = {
  wBlueOrange: { neg: [0.3, 0.6, 1.0], pos: [1.0, 0.5, 0.18] },
  wPurpleGreen: { neg: [0.62, 0.38, 1.0], pos: [0.4, 0.95, 0.35] },
  wCyanMagenta: { neg: [0.2, 0.85, 0.95], pos: [1.0, 0.3, 0.75] },
};

/**
 * True for the 4D color modes that bake a per-point color attribute
 * ({@link buildColors4}) rather than coloring purely in-shader from the
 * rotated w. Single source of truth for the bake-vs-uniform dispatch
 * (main.ts's `applyFourDColor`); the type-guard return narrows the mode for
 * `buildColors4`'s signature on one side and `W_SIDE_PALETTES` lookups on the
 * other.
 */
export function fourDColorNeedsAttribute(
  mode: FourDColorMode,
): mode is FourDAttributeColorMode {
  return mode === "transform" || mode === "radius";
}

/**
 * Build the per-point color-attribute buffer for the 4D projection's baked
 * color modes (fr-d47) — the modes whose color does NOT depend on the live 4D
 * view rotation and so can be computed once per generation:
 *
 * - `"transform"`: the same evenly-spaced-hue palette as the 3D "By
 *   Transform" mode ({@link transformColors}), keyed by the transform that
 *   produced each point. Rotation-invariant by construction.
 * - `"radius"`: the same warm→cool ramp as the 3D "By Radius" mode (the ONE
 *   ramp definition, via {@link buildColorModeLUT}'s radius writer), over
 *   each point's 4D Euclidean distance from the cloud's 4D `center`,
 *   normalized against the actual min→max distance range the way
 *   `buildColors`' radius branch normalizes — so the full ramp is always in
 *   play (the fr-9bk spirit). A 4D view rotation about `center` preserves
 *   every such distance, so the baked colors stay honest at every tumble
 *   angle.
 *
 * The shader treats the baked color exactly like a w-depth side color — it
 * still mixes toward the dim gray notch as |rotated w| → 0 (scene.ts's
 * `FOUR_D_VERTEX`) — so the fourth dimension stays legible in brightness
 * while hue carries the structural information. The w-depth modes never call
 * this; their color is a pure function of the rotated w and lives entirely in
 * the shader (see {@link W_SIDE_PALETTES}).
 *
 * `colorGamma` deliberately does not apply: the 4D view hides the contrast
 * control and never applied gamma to color (see ui.ts's legend contract).
 */
export function buildColors4(
  result: ChaosGame4Result,
  transformCount: number,
  mode: FourDAttributeColorMode,
): Float32Array {
  const { positions, w, transformIndices, count, center } = result;
  const colors = new Float32Array(count * 3);

  if (mode === "transform") {
    const tColors = transformColors(transformCount);
    for (let i = 0; i < count; i++) {
      const rgb = tColors[transformIndices[i]] ?? [1, 1, 1];
      const o = i * 3;
      colors[o] = rgb[0];
      colors[o + 1] = rgb[1];
      colors[o + 2] = rgb[2];
    }
    return colors;
  }

  // radius: two passes — distances (tracking min/max) first, then colors —
  // with the same degenerate-range `|| 1` guard as buildColors.
  const dist = new Float32Array(count);
  let minD = Infinity;
  let maxD = -Infinity;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - center[0];
    const dy = positions[i * 3 + 1] - center[1];
    const dz = positions[i * 3 + 2] - center[2];
    const dw = w[i] - center[3];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
    dist[i] = d;
    if (d < minD) minD = d;
    if (d > maxD) maxD = d;
  }
  const range = maxD - minD || 1;
  for (let i = 0; i < count; i++) {
    writeRadiusColor(colors, i * 3, (dist[i] - minD) / range);
  }
  return colors;
}
