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
 * Build the per-point color buffer for a generated cloud. Each {@link ColorMode}
 * maps a point's transform, height, radius, position, or generation order to an
 * sRGB color, mirroring the original viewer's palettes.
 *
 * The mode dispatch is hoisted outside the loop and each branch writes channels
 * directly into the output `Float32Array`, keeping allocations O(1) per call
 * regardless of point count.
 */
export function buildColors(
  result: ChaosGameResult,
  transforms: Transform[],
  mode: ColorMode,
): Float32Array {
  const { positions, transformIndices, count, bounds } = result;
  const colors = new Float32Array(count * 3);

  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;
  const rangeZ = bounds.maxZ - bounds.minZ || 1;
  const rangeR = bounds.maxR - bounds.minR || 1;

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
        const o = i * 3;
        if (t < 0.5) {
          writeHsl(colors, o, 0.6 - t * 0.4, 0.8, 0.5);
        } else {
          writeHsl(colors, o, 0.2 - (t - 0.5) * 0.4, 0.8, 0.5);
        }
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
        writeHsl(colors, o, t * 0.7, 0.85, 0.55);
      }
      break;
    }
    case "position": {
      // XYZ → RGB.
      for (let i = 0; i < count; i++) {
        const o = i * 3;
        colors[o] = ((positions[o] - bounds.minX) / rangeX) * 0.8 + 0.2;
        colors[o + 1] = ((positions[o + 1] - bounds.minY) / rangeY) * 0.8 + 0.2;
        colors[o + 2] = ((positions[o + 2] - bounds.minZ) / rangeZ) * 0.8 + 0.2;
      }
      break;
    }
    case "iterationAge": {
      // Early iterations magenta, late iterations cyan.
      for (let i = 0; i < count; i++) {
        const t = i / count;
        writeHsl(colors, i * 3, 0.8 - t * 0.3, 0.9, 0.55);
      }
      break;
    }
    case "uniform":
    default: {
      for (let i = 0; i < count * 3; i += 3) {
        colors[i] = 0.4;
        colors[i + 1] = 0.8;
        colors[i + 2] = 1.0;
      }
      break;
    }
  }

  return colors;
}
