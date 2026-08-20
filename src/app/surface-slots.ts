import { transformColors } from "../fractal/color";
import {
  isClassicSurfaceFinish,
  resolveSurfaceFinish,
  type ResolvedSurfaceFinish,
} from "../fractal/surface-finish";
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
 * Per-slot surface FINISHES — the third per-slot shading input, beside the
 * colors and trap coordinates above: each slot takes its base map's
 * authored {@link Transform.finish} through `surface-finish.ts`'s
 * `resolveSurfaceFinish`, the one absent-means-classic definition, so an
 * unauthored transform's slot carries the classic lanes explicitly.
 * `baseIndex`-keyed exactly like {@link surfaceSlotColors} and
 * dimension-agnostic for the same reason (a 4D slot differs from a 3D one
 * in everything but the field this reads). Kaleidoscope copies inherit
 * their base map's finish for free — slots are base maps in both
 * dimensions.
 */
export function surfaceSlotFinishes(
  transforms: readonly Transform[],
  maps: readonly SurfaceSlot[],
): ResolvedSurfaceFinish[] {
  return maps.map((m) => resolveSurfaceFinish(transforms[m.baseIndex].finish));
}

/**
 * The finish COMPILE GATE's predicate: does any SLOTTED transform author a
 * finish that resolves away from classic? The parametric shader path is
 * not a byte-identity with the fixed lighting formula (`pow(x, 32.0)`
 * literal against a per-slot value), so an unauthored document must
 * compile literally today's program text — callers pass the slot finishes
 * only when this is true, and `null` otherwise, on BOTH engines (the WGSL
 * `finish` codegen flag and the GLSL `SURFACE_FINISH` define).
 *
 * Keyed on the SLOT list deliberately: a weight-0 transform contributes no
 * slot, so an authored finish on a map the descent never inverts must not
 * force the parametric program — the slot list, not the transform list, is
 * what the tracers shade from.
 */
export function surfaceSlotsAuthorFinish(
  transforms: readonly Transform[],
  maps: readonly SurfaceSlot[],
): boolean {
  return maps.some(
    (m) => !isClassicSurfaceFinish(transforms[m.baseIndex].finish),
  );
}
