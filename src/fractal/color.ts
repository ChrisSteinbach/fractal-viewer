import type { ChaosGameResult } from "./chaos-game";
import type { Bounds, ColorMode, Transform, Vec3 } from "./types";

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
 * A cloud's bounds pre-reduced to the axis minimums and non-zero spans the
 * position-normalized color modes need. Each `range*` is `max - min` with a
 * `|| 1` guard so a degenerate (zero-extent) axis never divides by zero — it
 * collapses every point on that axis to `t = 0` instead. Built once per
 * consumer ({@link buildColors}' recolor pass, the flame accumulate loop) so
 * {@link writePointColor} stays a few multiply-adds per point with no
 * per-point `max - min || 1` recompute.
 */
export interface ColorSpan {
  minX: number;
  minY: number;
  minZ: number;
  minR: number;
  rangeX: number;
  rangeY: number;
  rangeZ: number;
  rangeR: number;
}

/** Reduce {@link Bounds} to the {@link ColorSpan} {@link writePointColor} indexes by. */
export function colorSpan(bounds: Bounds): ColorSpan {
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    minZ: bounds.minZ,
    minR: bounds.minR,
    rangeX: bounds.maxX - bounds.minX || 1,
    rangeY: bounds.maxY - bounds.minY || 1,
    rangeZ: bounds.maxZ - bounds.minZ || 1,
    rangeR: bounds.maxR - bounds.minR || 1,
  };
}

/**
 * Write the sRGB color a single plotted point `(px, py, pz)` gets under a
 * position-based {@link ColorMode} into `out[o..o+2]` — the exact ramps
 * {@link buildColors} paints the point cloud with, factored out so the flame
 * renderer (`flame.ts`'s `accumulateFlame`) colors identically and the two
 * views can never drift apart (fr-6do explorer↔flame parity). Allocation-free
 * (writes channels in place, no intermediate `Vec3`) so the flame hot loop can
 * call it per iteration.
 *
 * `"transform"` is deliberately excluded: it colors by the *producing
 * transform's* palette entry, not by a point + bounds, so both callers
 * dispatch it themselves before reaching here.
 */
export function writePointColor(
  out: Float32Array,
  o: number,
  mode: Exclude<ColorMode, "transform">,
  px: number,
  py: number,
  pz: number,
  span: ColorSpan,
): void {
  switch (mode) {
    case "height": {
      // Blue (low) → green (mid) → red (high).
      const t = (py - span.minY) / span.rangeY;
      if (t < 0.5) {
        writeHsl(out, o, 0.6 - t * 0.4, 0.8, 0.5);
      } else {
        writeHsl(out, o, 0.2 - (t - 0.5) * 0.4, 0.8, 0.5);
      }
      break;
    }
    case "radius": {
      // Inner = warm, outer = cool.
      const r = Math.sqrt(px * px + py * py + pz * pz);
      const t = (r - span.minR) / span.rangeR;
      writeHsl(out, o, t * 0.7, 0.85, 0.55);
      break;
    }
    case "position": {
      // XYZ → RGB.
      out[o] = ((px - span.minX) / span.rangeX) * 0.8 + 0.2;
      out[o + 1] = ((py - span.minY) / span.rangeY) * 0.8 + 0.2;
      out[o + 2] = ((pz - span.minZ) / span.rangeZ) * 0.8 + 0.2;
      break;
    }
    case "uniform":
    default: {
      out[o] = 0.4;
      out[o + 1] = 0.8;
      out[o + 2] = 1.0;
      break;
    }
  }
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

  if (mode === "transform") {
    const tColors = transformColors(transforms.length);
    for (let i = 0; i < count; i++) {
      const rgb = tColors[transformIndices[i]] ?? [1, 1, 1];
      const o = i * 3;
      colors[o] = rgb[0];
      colors[o + 1] = rgb[1];
      colors[o + 2] = rgb[2];
    }
    return colors;
  }

  // Every non-transform mode is a pure function of a point + the cloud's
  // bounds, so it shares one per-point writer with the flame renderer (see
  // writePointColor) — the mode dispatch stays hoisted out of the loop inside
  // that switch, and the span is reduced once here.
  const span = colorSpan(bounds);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    writePointColor(
      colors,
      o,
      mode,
      positions[o],
      positions[o + 1],
      positions[o + 2],
      span,
    );
  }

  return colors;
}
