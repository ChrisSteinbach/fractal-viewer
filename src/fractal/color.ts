import type { ChaosGameResult } from "./chaos-game";
import type { ChaosGame4Result } from "./chaos-game-4d";
import { buildPaletteLUT } from "./palette";
import type { PaletteSpec, RgbStop } from "./palette";
import type {
  Bounds,
  Bounds4,
  ColorMode,
  FourDAttributeColorMode,
  FourDColorMode,
  Transform,
  Vec3,
  Vec4,
  WDepthColorMode,
} from "./types";

/**
 * Optional point-aligned geometry which owns the structural color of a 3D
 * output cloud. Plot-time image layers such as space tiling can move a point
 * without changing the canonical source whose Height/Radius/Position color it
 * carries; callers retain that source position and its normalization bounds
 * here while the ordinary result continues to own output positions and
 * transform provenance.
 */
export interface PointColorSource3D {
  positions: Float32Array;
  bounds: Bounds;
}

/** Raw-4D twin of {@link PointColorSource3D}. The separate `w` lane and
 * canonical center preserve `buildColors4`'s rotation-invariant 4D Radius
 * semantics independently of a plot-time image's raw xyzw position. */
export interface PointColorSource4D {
  positions: Float32Array;
  w: Float32Array;
  bounds: Bounds4;
  center: Vec4;
}

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

/**
 * Evenly spaced hues, one per transform — the "by transform" palette: the
 * explorer's "By Transform" point-cloud/solid mode, the legend and
 * transform-list swatches, the surface tracers' By Transform slot colors
 * (`surface-slots.ts`'s `surfaceSlotColors`), mutation thumbnails, and both
 * flame kernels' legacy (non-gradient) per-transform color.
 *
 * `colorIndexes` lets a map's authored {@link Transform.colorIndex}
 * pick its position on the hue wheel instead of the even `i / count` spread —
 * agreeing with `surface-slots.ts`'s `surfaceTrapIndices`, which already lets
 * an authored `colorIndex` win over its own derived spread for the orbit-trap
 * coordinate. Entry `i` is `colorIndexes?.[i] ?? i / count`, so an absent
 * array, or an absent/undefined entry within it, reproduces the old even
 * spread exactly — every scene authored before the field existed has no
 * `colorIndex` anywhere, so this is byte-for-byte unchanged for it.
 * `colorIndex` is cyclic on `[0, 1]` like any hue (`hslToRgb` wraps), so an
 * authored `1` reads as hue `0`; two maps authoring the same value
 * legitimately land on the same hue (flam3 semantics — matching how the
 * structural color walk already treats a shared `colorIndex`).
 */
export function transformColors(
  count: number,
  colorIndexes?: readonly (number | undefined)[],
): Vec3[] {
  const colors: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const hue = colorIndexes?.[i] ?? i / count;
    colors.push(hslToRgb(hue, 0.8, 0.6));
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

/**
 * The palette-driven counterpart of {@link writeHeightColor} /
 * {@link writeRadiusColor}: paints `paletteLUT`'s color at normalized
 * coordinate `t` into `out` at offset `o`, indexing with the same
 * `(t * 256) | 0` bucketing the flame/voxel structural hot loops use for
 * palette LUTs (see `flame.ts`'s `accumulateFlame`) — but clamped at BOTH
 * ends, unlike that sibling's top-only `Math.min(255, …)`: this function's
 * `t` is a caller-normalized coordinate that can legitimately
 * land outside `[0, 1]` (`buildColors`' height/radius branches normalize
 * against float64-accumulated bounds while positions round-trip through a
 * Float32Array — see {@link applyColorGamma}'s doc — and `buildColors4`'s
 * radius branch never clamps `t` at all), where flame.ts's `c` is built to
 * already sit in `[0, 1]`. An unclamped low end indexed `paletteLUT` at a
 * negative offset — `undefined`, which writes `NaN` into every channel
 * below; voxel.ts:601's ramp branch clamps both ends for the identical
 * reason. The ONE palette-ramp definition: `buildColors`' height/radius
 * branches and {@link buildColorModeLUT} both call this, exactly as the
 * built-in ramps share `writeHeightColor`/`writeRadiusColor`, so the
 * explorer's points, the solid render's voxels, and the legend can never
 * drift apart.
 */
function writePaletteRampColor(
  out: Float32Array,
  o: number,
  t: number,
  paletteLUT: Float32Array,
): void {
  // Clamp both ends: NaN fails both comparisons and falls to `(t * 256) | 0`,
  // which ToInt32 makes 0 — the same low-end index as t <= 0, not a
  // propagated NaN.
  const p = (t <= 0 ? 0 : t >= 1 ? 255 : (t * 256) | 0) * 3;
  out[o] = paletteLUT[p];
  out[o + 1] = paletteLUT[p + 1];
  out[o + 2] = paletteLUT[p + 2];
}

/** The "uniform" mode's cyan, shared by `buildColors` and the solid render. */
export const UNIFORM_POINT_COLOR: Vec3 = [0.4, 0.8, 1.0];

/** How "by position" maps a normalized coordinate to a channel: compressed
 * into [0.2, 1.0] so no axis ever fades fully to black. Shared constants for
 * the same no-drift reason as the ramp writers. */
export const POSITION_COLOR_SCALE = 0.8;
export const POSITION_COLOR_OFFSET = 0.2;

/**
 * The "by position" mode's three user-pickable axis colors: the point's
 * gamma-mapped normalized coordinates weight a blend of one sRGB
 * color per axis (see {@link writePositionColor}) instead of the hardcoded
 * axis→channel identity. Absent everywhere it is optional
 * (`buildColors` / `accumulateVoxels` / `AppState.positionAxisColors`) means
 * the legacy XYZ→RGB mapping, whose colors are exactly
 * {@link LEGACY_POSITION_AXIS_COLORS}.
 */
export interface PositionAxisColors {
  readonly x: RgbStop;
  readonly y: RgbStop;
  readonly z: RgbStop;
}

/**
 * The complete resolved Scene / Look color payload shared by the Points
 * explorer and the two accumulation workers. Both dimensional branches ride
 * one atomic command so changing any visible color control can never restart
 * a worker with stale sibling inputs. `rampPalette` is already resolved: a
 * Custom selection carries its stop payload rather than the UI-only
 * `"custom"` sentinel.
 *
 * Workers retain both branches even while their primary structural palette
 * overrides this legacy-color path. That dormant staging matters when a
 * later primary-palette edit returns to legacy coloring within the same
 * render session.
 */
export interface RenderColorInputs {
  readonly flat: {
    readonly colorMode: ColorMode;
    readonly colorGamma: number;
    readonly rampPalette: PaletteSpec;
    readonly positionAxisColors?: PositionAxisColors;
  };
  readonly fourD: {
    readonly colorMode: FourDColorMode;
    readonly colorGamma: number;
    readonly rampPalette: PaletteSpec;
    readonly positionAxisColors?: PositionAxisColors;
  };
}

/** Structural equality for a resolved palette payload. Worker messages clone
 * Custom objects, so reference equality would turn an unrelated color edit
 * into a false ramp change and an unnecessary accumulation restart. A ramp
 * payload compares the same way — element by element — rather than by any
 * content hash: 768 float comparisons per check is noise next to the cost of
 * a false accumulation restart, and the historical hazard was forgetting the
 * variant existed, not the compare's cost. A ramp and a stops palette are
 * different payloads even when they would sample to the same gradient. */
function samePaletteSpec(a: PaletteSpec, b: PaletteSpec): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  const aIsRamp = "kind" in a;
  const bIsRamp = "kind" in b;
  if (aIsRamp !== bIsRamp) return false;
  const aList = aIsRamp ? a.entries : a.stops;
  const bList = bIsRamp ? b.entries : b.stops;
  if (aList.length !== bList.length) return false;
  return aList.every(
    (stop, i) =>
      stop[0] === bList[i][0] &&
      stop[1] === bList[i][1] &&
      stop[2] === bList[i][2],
  );
}

function samePositionAxisColors(
  a: PositionAxisColors | undefined,
  b: PositionAxisColors | undefined,
): boolean {
  const left = a ?? LEGACY_POSITION_AXIS_COLORS;
  const right = b ?? LEGACY_POSITION_AXIS_COLORS;
  const sameStop = (left: RgbStop, right: RgbStop) =>
    left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
  return (
    sameStop(left.x, right.x) &&
    sameStop(left.y, right.y) &&
    sameStop(left.z, right.z)
  );
}

/** Whether two atomic payloads produce the same flat legacy-color output.
 * Dormant sibling values deliberately do not count: changing a ramp while
 * By Transform is active must stage it without discarding accumulation. */
export function sameFlatRenderColorInputs(
  a: RenderColorInputs["flat"],
  b: RenderColorInputs["flat"],
): boolean {
  if (a.colorMode !== b.colorMode) return false;
  switch (b.colorMode) {
    case "height":
    case "radius":
      return (
        a.colorGamma === b.colorGamma &&
        samePaletteSpec(a.rampPalette, b.rampPalette)
      );
    case "position":
      return (
        a.colorGamma === b.colorGamma &&
        samePositionAxisColors(a.positionAxisColors, b.positionAxisColors)
      );
    case "transform":
    case "uniform":
      return true;
  }
}

/** 4D counterpart of {@link sameFlatRenderColorInputs}. Dormant sibling
 * values are staged without invalidating an accumulation, exactly like the
 * flat branch: Height/Radius read contrast + ramp, Position reads contrast +
 * axis colors, and the w-depth/Transform/Uniform modes ignore all three. */
export function sameFourDRenderColorInputs(
  a: RenderColorInputs["fourD"],
  b: RenderColorInputs["fourD"],
): boolean {
  if (a.colorMode !== b.colorMode) return false;
  switch (b.colorMode) {
    case "height":
    case "radius":
      return (
        (a.colorGamma ?? 1) === (b.colorGamma ?? 1) &&
        samePaletteSpec(a.rampPalette, b.rampPalette)
      );
    case "position":
      return (
        (a.colorGamma ?? 1) === (b.colorGamma ?? 1) &&
        samePositionAxisColors(a.positionAxisColors, b.positionAxisColors)
      );
    case "wBlueOrange":
    case "wPurpleGreen":
    case "wCyanMagenta":
    case "transform":
    case "uniform":
      return true;
  }
}

/**
 * The axis colors that reproduce the legacy XYZ→RGB position mapping (each
 * axis feeds exactly its own channel): {@link writePositionColor} over these
 * is numerically identical to the hardcoded legacy loop. The UI's axis
 * pickers default to these, and `state.ts`'s reducer normalizes an
 * exact match back to `undefined` so "absent = legacy" stays the one
 * discriminator (and default scenes keep their short URLs).
 */
export const LEGACY_POSITION_AXIS_COLORS: PositionAxisColors = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

/** True when `colors` is exactly the legacy identity mapping (see
 * {@link LEGACY_POSITION_AXIS_COLORS}) — the reducer's normalize check. */
export function isLegacyPositionAxisColors(
  colors: PositionAxisColors,
): boolean {
  const { x, y, z } = LEGACY_POSITION_AXIS_COLORS;
  return (
    colors.x[0] === x[0] &&
    colors.x[1] === x[1] &&
    colors.x[2] === x[2] &&
    colors.y[0] === y[0] &&
    colors.y[1] === y[1] &&
    colors.y[2] === y[2] &&
    colors.z[0] === z[0] &&
    colors.z[1] === z[1] &&
    colors.z[2] === z[2]
  );
}

/**
 * The custom-axis-color counterpart of the legacy XYZ→RGB position
 * mapping, written into `out` at offset `o`. Per channel:
 *
 *   channel = min(1, OFFSET + SCALE * (tx*Ax + ty*Bx + tz*Cx))
 *
 * — a dark-gray base ({@link POSITION_COLOR_OFFSET}, so no corner of the
 * bounds fades to black, generalizing the legacy compression's intent) plus
 * the coordinate-weighted blend of the three axis colors, scaled by
 * {@link POSITION_COLOR_SCALE}. With {@link LEGACY_POSITION_AXIS_COLORS} each
 * axis feeds exactly its own channel and this reduces to the legacy
 * `t * SCALE + OFFSET` per channel.
 *
 * `tx`/`ty`/`tz` are the caller's normalized (and already gamma-mapped)
 * coordinates, exactly like the ramp writers take a post-gamma `t`. Axis
 * colors that share channels can push the blend past 1 where the attractor
 * nears the far corner of its bounds — the min() clip keeps the color valid
 * (three saturated colors wash toward their sum there, the user's own palette
 * choice; a directional normalization was rejected because it collapses the
 * diagonal brightness dimension entirely). The clip is REQUIRED
 * on the solid path: `voxelTextureData` packs mean colors straight into a
 * wrapping `Uint8Array`.
 *
 * The ONE custom-position definition: `buildColors`' position branch and the
 * solid render's `accumulateVoxels` (`voxel.ts`) both call this, exactly as
 * the ramps share `writeHeightColor`/`writeRadiusColor`, so the explorer's
 * points and the solid render's voxels can never drift apart.
 */
export function writePositionColor(
  out: Float32Array,
  o: number,
  tx: number,
  ty: number,
  tz: number,
  axes: PositionAxisColors,
): void {
  const { x, y, z } = axes;
  const r =
    POSITION_COLOR_OFFSET +
    POSITION_COLOR_SCALE * (tx * x[0] + ty * y[0] + tz * z[0]);
  const g =
    POSITION_COLOR_OFFSET +
    POSITION_COLOR_SCALE * (tx * x[1] + ty * y[1] + tz * z[1]);
  const b =
    POSITION_COLOR_OFFSET +
    POSITION_COLOR_SCALE * (tx * x[2] + ty * y[2] + tz * z[2]);
  out[o] = r > 1 ? 1 : r;
  out[o + 1] = g > 1 ? 1 : g;
  out[o + 2] = b > 1 ? 1 : b;
}

/**
 * Apply the color-contrast exponent to a normalized coordinate `t` that is
 * expected to sit in `[0, 1]`: `t' = t ** colorGamma`. `colorGamma <
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
 *
 * `rampPalette` swaps the built-in ramp for a gradient palette —
 * `"legacy"` (the default) keeps the built-in writers bit-identically; a
 * non-legacy spec makes entry `i` {@link writePaletteRampColor} at the same
 * gamma-mapped `t`. With `colorGamma` at its default of `1`, the palette path
 * is an identity resample of {@link buildPaletteLUT}'s own table — entry `j`
 * maps back to palette entry `j`.
 */
export function buildColorModeLUT(
  mode: "height" | "radius",
  colorGamma = 1,
  rampPalette: PaletteSpec = "legacy",
): Float32Array {
  const paletteLUT = buildPaletteLUT(rampPalette);
  const lut = new Float32Array(256 * 3);
  const write = mode === "height" ? writeHeightColor : writeRadiusColor;
  for (let i = 0; i < 256; i++) {
    const t = applyColorGamma(i / 255, colorGamma);
    if (paletteLUT === null) write(lut, i * 3, t);
    else writePaletteRampColor(lut, i * 3, t, paletteLUT);
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
 * `colorGamma` is a contrast exponent applied to the normalized
 * coordinate in the `"height"`/`"radius"`/`"position"` modes — see
 * {@link colorModeUsesGamma} and {@link applyColorGamma} for the exact
 * mapping and its `NaN`-avoiding clamp. `1` (the default) is neutral —
 * today's linear mapping, applied via a short-circuit that never calls `**`
 * — and `"transform"`/`"uniform"` ignore it entirely, having no coordinate
 * to reshape.
 *
 * `rampPalette` applies ONLY to the height/radius modes, replacing
 * the built-in ramp with the gradient palette sampled at the same
 * gamma-mapped coordinate; `"legacy"` (the default) is bit-identical to
 * before the parameter existed.
 *
 * `positionAxisColors` applies ONLY to the `"position"` mode,
 * replacing the hardcoded axis→channel identity with the coordinate-weighted
 * blend of three user-picked axis colors (see {@link writePositionColor});
 * absent (the default) keeps the legacy XYZ→RGB loop bit-identically, the
 * same two-loop-variant convention as `rampPalette`.
 */
export function buildColors(
  result: ChaosGameResult,
  transforms: Transform[],
  mode: ColorMode,
  colorGamma = 1,
  rampPalette: PaletteSpec = "legacy",
  positionAxisColors?: PositionAxisColors,
  source?: PointColorSource3D,
): Float32Array {
  const { transformIndices, count } = result;
  const positions = source?.positions ?? result.positions;
  const bounds = source?.bounds ?? result.bounds;
  const colors = new Float32Array(count * 3);

  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;
  const rangeZ = bounds.maxZ - bounds.minZ || 1;
  const rangeR = bounds.maxR - bounds.minR || 1;
  const g = colorGamma;

  switch (mode) {
    case "transform": {
      const tColors = transformColors(
        transforms.length,
        transforms.map((t) => t.colorIndex),
      );
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
      // Blue (low) → green (mid) → red (high). The palette LUT is built once
      // per call (not per point) and the null-check hoisted out of the loop
      // — two branch-free loop variants, mirroring how the function already
      // keeps every other mode's loop branch-free. The `paletteLUT === null`
      // ("legacy") loop is the built-in ramp.
      const paletteLUT = buildPaletteLUT(rampPalette);
      if (paletteLUT === null) {
        for (let i = 0; i < count; i++) {
          const py = positions[i * 3 + 1];
          const t = (py - bounds.minY) / rangeY;
          writeHeightColor(colors, i * 3, applyColorGamma(t, g));
        }
      } else {
        for (let i = 0; i < count; i++) {
          const py = positions[i * 3 + 1];
          const t = (py - bounds.minY) / rangeY;
          writePaletteRampColor(
            colors,
            i * 3,
            applyColorGamma(t, g),
            paletteLUT,
          );
        }
      }
      break;
    }
    case "radius": {
      // Inner = warm, outer = cool. Same hoisted-LUT, two-loop-variant shape
      // as the height case above, for the same reason.
      const paletteLUT = buildPaletteLUT(rampPalette);
      if (paletteLUT === null) {
        for (let i = 0; i < count; i++) {
          const o = i * 3;
          const px = positions[o];
          const py = positions[o + 1];
          const pz = positions[o + 2];
          const r = Math.sqrt(px * px + py * py + pz * pz);
          const t = (r - bounds.minR) / rangeR;
          writeRadiusColor(colors, o, applyColorGamma(t, g));
        }
      } else {
        for (let i = 0; i < count; i++) {
          const o = i * 3;
          const px = positions[o];
          const py = positions[o + 1];
          const pz = positions[o + 2];
          const r = Math.sqrt(px * px + py * py + pz * pz);
          const t = (r - bounds.minR) / rangeR;
          writePaletteRampColor(colors, o, applyColorGamma(t, g), paletteLUT);
        }
      }
      break;
    }
    case "position": {
      // XYZ → RGB. Gamma is applied to each normalized coordinate BEFORE the
      // compressed-range scale/offset, exactly like the height/radius ramps.
      // Two loop variants hoisted like the height/radius cases above: the
      // `positionAxisColors === undefined` (legacy) loop is the identity
      // XYZ→RGB mapping; custom axis colors take the shared
      // writePositionColor blend instead.
      if (positionAxisColors === undefined) {
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
      } else {
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
          writePositionColor(colors, o, tx, ty, tz, positionAxisColors);
        }
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

/** True for the color modes whose ramp can be palette-driven —
 * deliberately narrower than {@link colorModeUsesGamma} (position normalizes
 * coordinates but is XYZ→RGB, not a 1-D ramp). Single source of truth for the
 * UI's ramp-palette row visibility and main.ts's custom-stop recolor guard. */
export function colorModeUsesRampPalette(mode: ColorMode): boolean {
  return mode === "height" || mode === "radius";
}

/**
 * The diverging side-color pairs for the 4D projection's "w depth" color
 * modes: `neg` tints the −w side of our 3-space, `pos` the +w side, and the
 * shader mixes either toward a dim gray notch as |rotated w| → 0
 * (scene.ts's `FOUR_D_VERTEX`). Every pair keeps the original blue/orange
 * ramp's conventions: the cool color sits on −w, and the pair's additive sum
 * pushes toward white, so genuine 4D self-overlap still flags itself in a
 * color no single point can have. Plain data rather than GLSL constants, so
 * the shader uniforms (scene.ts), the panel legend (ui.ts), and the tests all
 * read the ONE definition and can never drift on the palette itself; the
 * ramp's SHAPE constants are shared the same way (see
 * {@link W_RAMP_EXPONENT}).
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
 * The diverging w-ramp's SHAPE constants — the single source of truth
 * for the ramp math that {@link wRampColor} runs on the CPU and that the GLSL
 * point shader (`scene.ts`'s `FOUR_D_VERTEX`) and WGSL flame kernel
 * (`flame-gpu-4d.ts`) each interpolate into their shader strings, so the four
 * copies can no longer drift the way the hand-mirrored constants once did:
 *
 * - {@link W_RAMP_EXPONENT} — the magnitude curve `m = |s|^exp`; the sub-unity
 *   exponent lifts the mid-range so heavy-tailed w-distributions don't wash out
 *   to gray after the support normalization spreads them over `[-1, 1]`.
 * - {@link W_RAMP_GRAY} — the dim gray notch the ramp mixes toward at `w ≈ 0`,
 *   the part of the cloud passing through our own 3-space.
 * - {@link W_RAMP_BRIGHTNESS_FLOOR} — the brightness at `w ≈ 0`; brightness
 *   ramps `floor + (1 − floor) · m` to full at the w extremes.
 */
export const W_RAMP_EXPONENT = 0.6;
export const W_RAMP_GRAY = 0.38;
export const W_RAMP_BRIGHTNESS_FLOOR = 0.3;

/**
 * CPU twin of the FOUR_D_VERTEX diverging-w ramp (`scene.ts`): clamp `s` to
 * `[-1, 1]`; magnitude `m = |s|^`{@link W_RAMP_EXPONENT}; pick `side.neg` for
 * `s < 0` else `side.pos`; mix that side color with the {@link W_RAMP_GRAY}
 * notch by `m`, then scale by brightness `floor + (1 − floor) · m` from
 * {@link W_RAMP_BRIGHTNESS_FLOOR} — component-wise `(gray · (1 − m) + side_i ·
 * m) · brightness`. For wherever a rotated-w color needs computing off the
 * GPU — the solid (voxel) render has no shader to color in, unlike the flame
 * and point-cloud paths; `ui.ts`'s `wRampGradient` legend also samples it.
 *
 * Reads the shared SHAPE constants above and the side PALETTE from
 * {@link W_SIDE_PALETTES}, so it cannot drift from the shaders that interpolate
 * the same constants nor from the legend that calls this function.
 */
export function wRampColor(s: number, side: { neg: Vec3; pos: Vec3 }): Vec3 {
  const clamped = s < -1 ? -1 : s > 1 ? 1 : s;
  const m = Math.abs(clamped) ** W_RAMP_EXPONENT;
  const sideColor = clamped < 0 ? side.neg : side.pos;
  const brightness =
    W_RAMP_BRIGHTNESS_FLOOR + (1 - W_RAMP_BRIGHTNESS_FLOOR) * m;
  return [
    (W_RAMP_GRAY * (1 - m) + sideColor[0] * m) * brightness,
    (W_RAMP_GRAY * (1 - m) + sideColor[1] * m) * brightness,
    (W_RAMP_GRAY * (1 - m) + sideColor[2] * m) * brightness,
  ];
}

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
  return (
    mode === "transform" ||
    mode === "height" ||
    mode === "radius" ||
    mode === "position" ||
    mode === "uniform"
  );
}

/** 4D counterpart of {@link colorModeUsesGamma}. */
export function fourDColorModeUsesGamma(mode: FourDColorMode): boolean {
  return mode === "height" || mode === "radius" || mode === "position";
}

/** 4D counterpart of {@link colorModeUsesRampPalette}. */
export function fourDColorModeUsesRampPalette(mode: FourDColorMode): boolean {
  return mode === "height" || mode === "radius";
}

/**
 * Build the per-point color-attribute buffer for the 4D projection's baked
 * color modes — the modes whose color does NOT depend on the live 4D view
 * rotation and so can be computed once per generation:
 *
 * - `"transform"`: the same evenly-spaced-hue palette as the 3D "By
 *   Transform" mode ({@link transformColors}), keyed by the transform that
 *   produced each point. Rotation-invariant by construction. `colorIndexes`
 *   threads each BASE transform's authored {@link Transform.colorIndex}
 *   through to {@link transformColors} exactly like `buildColors`' own
 *   `"transform"` branch; absent (or an absent entry within it) keeps the
 *   derived `i / count` spread.
 * - `"height"` / `"position"`: the 3D modes' exact raw-XYZ semantics over
 *   {@link ChaosGame4Result.bounds}. They deliberately ignore `w` and the
 *   live view rotor, so color stays attached to the authored fractal while
 *   it tumbles. Position accepts the same custom axis colors.
 * - `"uniform"`: every point receives {@link UNIFORM_POINT_COLOR}.
 * - `"radius"`: the same ramp as the 3D "By Radius" mode (the ONE ramp
 *   definition — `writeRadiusColor`, or {@link writePaletteRampColor} under a
 *   non-`"legacy"` `rampPalette`), over each point's 4D Euclidean distance
 *   from the cloud's 4D `center`, normalized against the actual min→max
 *   distance range the way `buildColors`' radius branch normalizes — so the
 *   full ramp is always in play, the same reason the w-color signal
 *   normalizes per rotation rather than by the invariant 4D radius. A 4D
 *   view rotation about `center` preserves every such distance, so the baked
 *   colors stay honest at every tumble angle.
 *
 * The shader treats the baked color exactly like a w-depth side color — it
 * still mixes toward the dim gray notch as |rotated w| → 0 (scene.ts's
 * `FOUR_D_VERTEX`) — so the fourth dimension stays legible in brightness
 * while hue carries the structural information. The w-depth modes never call
 * this; their color is a pure function of the rotated w and lives entirely in
 * the shader (see {@link W_SIDE_PALETTES}).
 *
 * `rampPalette` is the Height/Radius counterpart of `buildColors`'
 * parameter of the same name: the same `rampPaletteId` selection recolors the
 * 3D height/radius ramps and this 4D one, so a system going 4D never drops
 * the user's chosen gradient. `"legacy"` (the default) is bit-identical to
 * before the parameter existed; Transform/Position/Uniform ignore it.
 *
 * `colorGamma` is the same contrast exponent Height/Radius/Position use in
 * 3D. The neutral default short-circuits the power exactly as there.
 */
export function buildColors4(
  result: ChaosGame4Result,
  transformCount: number,
  mode: FourDAttributeColorMode,
  rampPalette: PaletteSpec = "legacy",
  colorIndexes?: readonly (number | undefined)[],
  colorGamma = 1,
  positionAxisColors?: PositionAxisColors,
  source?: PointColorSource4D,
): Float32Array {
  const { transformIndices, count } = result;
  const positions = source?.positions ?? result.positions;
  const w = source?.w ?? result.w;
  const center = source?.center ?? result.center;
  const bounds = source?.bounds ?? result.bounds;
  const colors = new Float32Array(count * 3);

  if (mode === "transform") {
    const tColors = transformColors(transformCount, colorIndexes);
    for (let i = 0; i < count; i++) {
      const rgb = tColors[transformIndices[i]] ?? [1, 1, 1];
      const o = i * 3;
      colors[o] = rgb[0];
      colors[o + 1] = rgb[1];
      colors[o + 2] = rgb[2];
    }
    return colors;
  }

  if (mode === "uniform") {
    const [r, g, b] = UNIFORM_POINT_COLOR;
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      colors[o] = r;
      colors[o + 1] = g;
      colors[o + 2] = b;
    }
    return colors;
  }

  if (mode === "height") {
    const rangeY = bounds.maxY - bounds.minY || 1;
    const paletteLUT = buildPaletteLUT(rampPalette);
    for (let i = 0; i < count; i++) {
      const t = applyColorGamma(
        (positions[i * 3 + 1] - bounds.minY) / rangeY,
        colorGamma,
      );
      if (paletteLUT === null) writeHeightColor(colors, i * 3, t);
      else writePaletteRampColor(colors, i * 3, t, paletteLUT);
    }
    return colors;
  }

  if (mode === "position") {
    const rangeX = bounds.maxX - bounds.minX || 1;
    const rangeY = bounds.maxY - bounds.minY || 1;
    const rangeZ = bounds.maxZ - bounds.minZ || 1;
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const tx = applyColorGamma(
        (positions[o] - bounds.minX) / rangeX,
        colorGamma,
      );
      const ty = applyColorGamma(
        (positions[o + 1] - bounds.minY) / rangeY,
        colorGamma,
      );
      const tz = applyColorGamma(
        (positions[o + 2] - bounds.minZ) / rangeZ,
        colorGamma,
      );
      if (positionAxisColors === undefined) {
        colors[o] = tx * POSITION_COLOR_SCALE + POSITION_COLOR_OFFSET;
        colors[o + 1] = ty * POSITION_COLOR_SCALE + POSITION_COLOR_OFFSET;
        colors[o + 2] = tz * POSITION_COLOR_SCALE + POSITION_COLOR_OFFSET;
      } else {
        writePositionColor(colors, o, tx, ty, tz, positionAxisColors);
      }
    }
    return colors;
  }

  // radius: two passes — distances (tracking min/max) first, then colors —
  // with the same degenerate-range `|| 1` guard as buildColors, and the same
  // hoisted-LUT two-loop-variant shape as its radius branch (the
  // `paletteLUT === null` loop is the built-in ramp).
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
  const paletteLUT = buildPaletteLUT(rampPalette);
  if (paletteLUT === null) {
    for (let i = 0; i < count; i++) {
      writeRadiusColor(
        colors,
        i * 3,
        applyColorGamma((dist[i] - minD) / range, colorGamma),
      );
    }
  } else {
    for (let i = 0; i < count; i++) {
      writePaletteRampColor(
        colors,
        i * 3,
        applyColorGamma((dist[i] - minD) / range, colorGamma),
        paletteLUT,
      );
    }
  }
  return colors;
}

/**
 * The "Watch it build" replay's spotlight-phase dimmer: given the fully
 * revealed cloud's by-transform colors ({@link buildColors}'s
 * `"transform"` mode or {@link buildColors4}'s), dim every point EXCEPT those
 * produced by transform `keep`, isolating that one map's landings. What that
 * spotlight traces out is a shrunken copy of the whole attractor — the
 * self-similarity identity A = ⋃ fᵢ(A) that the chaos game is built on — so
 * cycling `keep` through each transform is a visual proof of the identity,
 * one map at a time.
 *
 * Works over either {@link buildColors}'s or {@link buildColors4}'s output —
 * both are a flat `count * 3` RGB buffer keyed by the same per-point `transformIndices`
 * the chaos-game results carry, so this one function serves both the 3D and
 * 4D transform-mode replay. Pure: returns a new buffer, never mutates
 * `colors` or `transformIndices`. A `keep` value absent from
 * `transformIndices` (e.g. a stale index after an edit) simply dims every
 * point — there's no special-case fallback because there's no "wrong" input
 * to fall back from.
 */
export function dimColorsExcept(
  colors: Float32Array,
  transformIndices: Uint8Array,
  count: number,
  keep: number,
  dim: number,
): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    if (transformIndices[i] === keep) {
      out[o] = colors[o];
      out[o + 1] = colors[o + 1];
      out[o + 2] = colors[o + 2];
    } else {
      out[o] = colors[o] * dim;
      out[o + 1] = colors[o + 1] * dim;
      out[o + 2] = colors[o + 2] * dim;
    }
  }
  return out;
}

/**
 * How the 4D flame and solid renders color each plotted point/voxel (moved
 * here from `flame-4d.ts` so both accumulators, and neither's name, own it):
 *
 * - `"structural"`: the cosine-palette path, identical semantics to
 *   `accumulateFlame`'s `colorLUT` mode — an orbit-riding coordinate `c`
 *   blended toward the picked transform's palette slot at that transform's own
 *   color speed every step (`c ← c·(1 - speed) + slot·speed`, both resolved
 *   by `prepareChaosGame4` from the optional `colorIndex`/
 *   `colorSpeed`, absent ⇒ the derived `idx / (n - 1)` spread and a halfway
 *   `0.5`), escape-reseed resetting it to `0.5`, indexing `lut` (a `256 * 3`
 *   `buildPaletteLUT` table). Keyed on the BASE map index
 *   (`idx % baseTransformCount`) exactly like the 3D path, so every
 *   kaleidoscope copy of a map shares that map's slot; equal to the picked
 *   index at symmetry order 1.
 * - `"wRamp"`: the diverging rotated-w ramp ({@link wRampColor}) evaluated on
 *   the per-point normalized signed-w signal `s` — the "legacy" dispatch for
 *   whichever `wBlueOrange`/`wPurpleGreen`/`wCyanMagenta` mode the explorer
 *   had active.
 * - `"transform"`: `palette[baseIdx]` (the picked transform's hue, from
 *   {@link transformColors}, keyed on the same base-map index) — the "legacy"
 *   dispatch for the explorer's "By
 *   Transform" 4D color mode ({@link buildColors4}'s `"transform"` branch),
 *   falling back to `[1, 1, 1]` for an out-of-range index (shouldn't happen;
 *   mirrors `buildColors4`).
 * - `"height"`: the 3D height ramp over raw authored Y, normalized against
 *   the entry cloud's raw bounds. `"position"` likewise uses raw authored
 *   XYZ and the shared axis-color blend. Neither follows the view rotor.
 * - `"uniform"`: {@link UNIFORM_POINT_COLOR}, with no coordinate input.
 * - `"radius"`: the 3D radius ramp LUT ({@link buildColorModeLUT}, built at
 *   the explorer's own `rampPalette` and contrast, exactly like
 *   {@link buildColors4}'s
 *   `"radius"` branch), indexed by the plotted point's
 *   4D Euclidean distance from `center`, normalized over `[minD, maxD]` — the
 *   "legacy" dispatch for the explorer's "By 4D Radius" mode. `minD`/`maxD`
 *   are the explorer's own cloud's min/max 4D distance from its center
 *   (`ChaosGame4Result`), computed by the main thread — NOT recomputed from
 *   the accumulator's own (much larger, and differently distributed)
 *   accumulated sample.
 */
export type FourDRenderColor =
  | { kind: "structural"; lut: Float32Array }
  | { kind: "wRamp"; side: { neg: Vec3; pos: Vec3 } }
  | { kind: "transform"; palette: Vec3[] }
  | { kind: "height"; lut: Float32Array; minY: number; maxY: number }
  | {
      kind: "radius";
      lut: Float32Array;
      center: Vec4;
      minD: number;
      maxD: number;
    }
  | {
      kind: "position";
      min: Vec3;
      max: Vec3;
      colorGamma: number;
      axisColors?: PositionAxisColors;
    }
  | { kind: "uniform"; color: Vec3 };
