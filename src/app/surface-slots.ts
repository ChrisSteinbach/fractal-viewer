import { transformColors } from "../fractal/color";
import type { Transform, Vec3 } from "../fractal/types";

/**
 * The two per-slot shading inputs every surface tracer takes alongside its
 * distance estimator: a color per slot for the "By Transform" source, and a
 * palette coordinate per slot for the orbit-trap "Palette" source. Both are
 * pure functions of the document's transforms and the DE's slot list, so
 * `main.ts` computes them once at session enter and `gpu-bench/`'s surface
 * section — which drives the production `SurfaceComputeRenderer` — shares the
 * exact same keying rather than re-deriving it.
 *
 * One pair serves all three tracers (`surface-material.ts`,
 * `surface-material-4d.ts`, `surface-compute.ts`) and both DE shapes: 3D and
 * 4D slots differ in everything except the one field the coloring reads, so
 * the parameter is the structural {@link SurfaceSlot} rather than either
 * concrete map type. (The escape-time variant takes a single flat color and
 * no slots at all — it has no per-map descent to key on.)
 */

/**
 * The one field of a surface DE's slot that the coloring reads: which input
 * transform this slot inverts. It indexes the DOCUMENT's `transforms` array,
 * NOT the slot list — weight-0 maps contribute no slot, so `baseIndex` can be
 * sparse (`[0, 2]` for a middle map at weight 0) and `maps.length` is the
 * wrong denominator for anything keyed on it. Slots are base maps 1:1 in
 * both dimensions — 4D has no kaleidoscope at all, and 3D sweeps its sectors
 * from scalar uniforms rather than expanding them into slots (fr-x029) — so
 * a kaleidoscope copy is shaded by the base map it sweeps around, for free.
 */
export interface SurfaceSlot {
  readonly baseIndex: number;
}

/**
 * Per-slot "By Transform" colors: each slot takes its base map's hue from
 * `color.ts`'s {@link transformColors}, the same palette — keyed on the same
 * authored transform count — that colors the explorer's point cloud and the
 * legend, so a map is the same color in the tracer as in the cloud it was
 * framed from.
 */
export function surfaceSlotColors(
  transforms: readonly Transform[],
  maps: readonly SurfaceSlot[],
): Vec3[] {
  const palette = transformColors(transforms.length);
  return maps.map((m) => palette[m.baseIndex]);
}

/**
 * Per-slot orbit-trap palette coordinates: where on the gradient each slot
 * pulls a hit's trap color. The tracer weights these down the winning descent
 * chain (top level dominates, decayed per level by the Surface Look "Color
 * speed" slider) and uses the normalized result as the LUT coordinate — but
 * only under the "Palette" color source; every other source ignores them.
 *
 * Base map `i` of `n` spreads evenly over the ramp — the flame's
 * `paletteIndex(i, n)` idea, keyed by `baseIndex` so every sector shares its
 * base map's coordinate.
 */
export function surfaceTrapIndices(
  transforms: readonly Transform[],
  maps: readonly SurfaceSlot[],
): number[] {
  const denom = Math.max(1, transforms.length - 1);
  return maps.map((m) => m.baseIndex / denom);
}
