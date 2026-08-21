import { transformColors } from "../fractal/color";
import {
  resolveSurfaceMaterial,
  surfaceMaterialUsesFinish,
  surfaceMaterialUsesPattern,
  type SurfaceMaterialSlots,
} from "../fractal/surface-material-wire";
import type { SurfaceNativeCalibration } from "../fractal/surface-pattern";
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
 * from scalar uniforms rather than expanding them into slots — so
 * a kaleidoscope copy is shaded by the base map it sweeps around, for free.
 */
export interface SurfaceSlot {
  readonly baseIndex: number;
}

/** The synthetic one-slot wire used by every forward-orbit surface core
 * (escape, bulb and escape4): the first positive-weight transform, falling
 * back to head index 0 for hostile/all-zero input. Color and material callers
 * share this selector so their slot-0 meanings cannot drift. */
export function surfaceForwardSlot(
  transforms: readonly Transform[],
): SurfaceSlot {
  return {
    baseIndex: Math.max(
      0,
      transforms.findIndex((transform) => (transform.weight ?? 1) > 0),
    ),
  };
}

/**
 * Per-slot "By Transform" colors: each slot takes its base map's hue from
 * `color.ts`'s {@link transformColors}, the same palette — keyed on the same
 * authored transform count — that colors the explorer's point cloud and the
 * legend, so a map is the same color in the tracer as in the cloud it was
 * framed from. This palette honors each map's authored
 * {@link Transform.colorIndex} over the even hue spread, exactly like
 * {@link surfaceTrapIndices} below already lets an authored `colorIndex` win
 * over its own derived spread — By Transform and the orbit-trap coordinate
 * now share the same authored-wins rule.
 */
export function surfaceSlotColors(
  transforms: readonly Transform[],
  maps: readonly SurfaceSlot[],
): Vec3[] {
  const palette = transformColors(
    transforms.length,
    transforms.map((t) => t.colorIndex),
  );
  return maps.map((m) => palette[m.baseIndex]);
}

/**
 * Per-slot orbit-trap palette coordinates: where on the gradient each slot
 * pulls a hit's trap color. The tracer weights these down the winning descent
 * chain (top level dominates, decayed per level by the Surface Look "Color
 * speed" slider) and uses the normalized result as the LUT coordinate — but
 * only under the "Palette" color source; every other source ignores them.
 *
 * A map's authored {@link Transform.colorIndex} wins, so the flam3
 * per-xform `color` that already steers the flame and solid renders steers
 * this one too, imported `.flame` files included. Absent — the documented
 * meaning of the optional field — the slot falls back to the even spread over
 * the authored maps that the surface has always used, leaving every existing
 * scene byte-identical.
 *
 * That fallback is written here rather than delegating to `chaos-game.ts`'s
 * `derivedColorIndex` on purpose: the two agree for every `n > 1` and diverge
 * at `n === 1`, where the flame's convention parks a lone map mid-ramp (`0.5`)
 * and the surface's parks it at the ramp start (`0`). Adopting the flame's
 * would repaint every existing single-map surface scene — and a single map is
 * exactly the fold shape this mode exists for. Authoring a `colorIndex` is now
 * the way to move such a system off slot 0, which is the point of the
 * authored-wins rule.
 *
 * There is deliberately no `colorSpeed` twin. That field is how far a PICK
 * moves the structural color coordinate, and the surface never picks a map —
 * it descends one. The Surface Look panel's own "Color speed" slider is a
 * different quantity entirely (per-descent-level trap decay).
 */
export function surfaceTrapIndices(
  transforms: readonly Transform[],
  maps: readonly SurfaceSlot[],
): number[] {
  const denom = Math.max(1, transforms.length - 1);
  return maps.map(
    (m) => transforms[m.baseIndex].colorIndex ?? m.baseIndex / denom,
  );
}

/**
 * Resolve one material per DE slot and both independent compile gates in one
 * pass. This is the sole transform-to-material derivation: finish and pattern
 * can no longer be routed or packed by setters that overwrite each other's
 * shared B lane.
 *
 * `baseIndex`-keyed exactly like colors/traps above, so weight-zero transforms
 * do not force either gate and kaleidoscope copies inherit their base map's
 * material. `null` is the exact classic+none route: GLSL keeps its old source
 * and WGSL keeps its old stride-1 shadeMaps bytes. A non-null wire is present
 * when EITHER gate is authored; pattern-only therefore gets stride 3 while
 * `finish` remains false and the fixed classic lighting formula stays live.
 */
export function surfaceSlotMaterials(
  transforms: readonly Transform[],
  maps: readonly SurfaceSlot[],
  patternCalibration?: SurfaceNativeCalibration,
): SurfaceMaterialSlots | null {
  let finish = false;
  let pattern = false;
  const slots = maps.map((m) => {
    const transform = transforms[m.baseIndex];
    const material = resolveSurfaceMaterial(
      transform.finish,
      transform.surfacePattern,
    );
    finish ||= surfaceMaterialUsesFinish(material);
    pattern ||= surfaceMaterialUsesPattern(material);
    return material;
  });
  if (pattern) {
    if (!patternCalibration) {
      throw new TypeError(
        "patterned surface slots require their built DE's native calibration",
      );
    }
    return { slots, finish, pattern: true, patternCalibration };
  }
  return finish ? { slots, finish: true, pattern: false } : null;
}
