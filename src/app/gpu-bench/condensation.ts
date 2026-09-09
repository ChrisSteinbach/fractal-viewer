import type { ShapeSpec } from "../../fractal/shapes";
import type { SurfaceDE } from "../../fractal/surface-de";
import type { SurfaceDE4 } from "../../fractal/surface-de-4d";

/**
 * The code-generated half of a condensation surface kernel. The numeric
 * emitter poses and depth band stay in the packed DE buffers; only shape
 * programs and their stable shade selectors belong in shader source.
 */
export interface SurfaceCondensationKernelSpec {
  mapCount: number;
  emitters: readonly { shape: ShapeSpec; shadeIndex: number }[];
}

/**
 * Project a built condensation DE onto the exact input expected by the WGSL
 * generator. Keeping this projection beside the bench makes its dedicated
 * Gearworks eval/march legs follow the same host contract as production.
 */
export function surfaceCondensationKernelSpec(
  de: Pick<SurfaceDE | SurfaceDE4, "maps" | "condensation">,
): SurfaceCondensationKernelSpec {
  const condensation = de.condensation;
  if (!condensation || condensation.emitters.length === 0) {
    throw new Error("surface condensation bench fixture has no emitters");
  }
  return {
    mapCount: de.maps.length,
    emitters: condensation.emitters.map((emitter) => ({
      shape: emitter.shape,
      shadeIndex: emitter.shadeIndex,
    })),
  };
}
