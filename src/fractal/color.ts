import type { ChaosGameResult } from "./chaos-game";
import type { ColorMode, Transform, Vec3 } from "./types";

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

/** Evenly spaced hues, one per transform — the "by transform" palette. */
export function transformColors(count: number): Vec3[] {
  const colors: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    colors.push(hslToRgb(i / count, 0.8, 0.6));
  }
  return colors;
}

/**
 * Build the per-point color buffer for a generated cloud. Each {@link ColorMode}
 * maps a point's transform, height, radius, position, or generation order to an
 * sRGB color, mirroring the original viewer's palettes.
 */
export function buildColors(
  result: ChaosGameResult,
  transforms: Transform[],
  mode: ColorMode,
): Float32Array {
  const { positions, transformIndices, count, bounds } = result;
  const colors = new Float32Array(count * 3);
  const tColors =
    mode === "transform" ? transformColors(transforms.length) : [];

  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;
  const rangeZ = bounds.maxZ - bounds.minZ || 1;
  const rangeR = bounds.maxR - bounds.minR || 1;

  for (let i = 0; i < count; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];
    const rgb = colorForPoint(mode, {
      px,
      py,
      pz,
      index: i,
      count,
      bounds,
      rangeX,
      rangeY,
      rangeZ,
      rangeR,
      tColor: tColors[transformIndices[i]],
    });
    colors[i * 3] = rgb[0];
    colors[i * 3 + 1] = rgb[1];
    colors[i * 3 + 2] = rgb[2];
  }
  return colors;
}

interface PointColorContext {
  px: number;
  py: number;
  pz: number;
  index: number;
  count: number;
  bounds: ChaosGameResult["bounds"];
  rangeX: number;
  rangeY: number;
  rangeZ: number;
  rangeR: number;
  tColor: Vec3 | undefined;
}

function colorForPoint(mode: ColorMode, ctx: PointColorContext): Vec3 {
  const { px, py, pz, bounds } = ctx;
  switch (mode) {
    case "transform":
      return ctx.tColor ?? [1, 1, 1];
    case "height": {
      // Blue (low) → green (mid) → red (high).
      const t = (py - bounds.minY) / ctx.rangeY;
      return t < 0.5
        ? hslToRgb(0.6 - t * 0.4, 0.8, 0.5)
        : hslToRgb(0.2 - (t - 0.5) * 0.4, 0.8, 0.5);
    }
    case "radius": {
      // Inner = warm, outer = cool.
      const r = Math.sqrt(px * px + py * py + pz * pz);
      const t = (r - bounds.minR) / ctx.rangeR;
      return hslToRgb(t * 0.7, 0.85, 0.55);
    }
    case "position": {
      // XYZ → RGB.
      const rx = (px - bounds.minX) / ctx.rangeX;
      const gy = (py - bounds.minY) / ctx.rangeY;
      const bz = (pz - bounds.minZ) / ctx.rangeZ;
      return [rx * 0.8 + 0.2, gy * 0.8 + 0.2, bz * 0.8 + 0.2];
    }
    case "iterationAge": {
      // Early iterations magenta, late iterations cyan.
      const t = ctx.index / ctx.count;
      return hslToRgb(0.8 - t * 0.3, 0.9, 0.55);
    }
    case "uniform":
    default:
      return [0.4, 0.8, 1.0];
  }
}
