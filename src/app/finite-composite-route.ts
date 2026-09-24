/**
 * The GLASS SOLID's COMPOSITE ROUTE: which general Glass solid sessions
 * render their OPAQUE maps as the true IFS ATTRACTOR (the composite kernel,
 * `surface-finite-composite-gpu.ts`) rather than as the word tree's level-N
 * cells. Pure, so the decision tests without a device; main.ts's finite
 * arm is one call into this.
 *
 * THE RULE: glass maps render as cells (the glass the transport walks, its
 * subtree the medium), and every other map renders as the attractor —
 * exactly when the block has BOTH a glass map and an opaque one. The two
 * ends keep the cells, each for its own reason:
 *
 * - NO GLASS MAP: the whole level-N solid, opaque. The block authors that
 *   solid, and a document that wants the attractor alone is the ordinary
 *   Surface render with the block removed — rerouting here would hand the
 *   session to another family behind the panel's back.
 * - NO OPAQUE MAP: every subtree is glass, so there is no attractor term
 *   (the composite refuses an empty branch table).
 *
 * And ONE REFUSAL, disclosed rather than silent: the composite's descent
 * is the ordinary Surface render's, so it inherits that render's admission
 * — the IFS gate (`analyzeSurfaceSystem` / `analyzeSurfaceSystem4`) and its
 * 24-map packing cap (`SURFACE_GPU_UNIFORM_MAP_SLOTS`). A block past either
 * keeps its opaque maps as cells and says so.
 */

import {
  buildFiniteSolidOpaqueContent,
  type FiniteSolidOpaqueBranch,
} from "../fractal/finite-solid-composite";
import type {
  FiniteSolidGeneralConstruction,
  FiniteSolidGeneralMedia,
} from "../fractal/finite-solid";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  type SurfaceDE,
} from "../fractal/surface-de";
import {
  analyzeSurfaceSystem4,
  buildSurfaceDE4,
  type SurfaceDE4,
} from "../fractal/surface-de-4d";
import { SURFACE_GPU_UNIFORM_MAP_SLOTS } from "../fractal/surface-de-gpu";
import type { SymmetryParams, Transform } from "../fractal/types";

/** The routed composite: the attractor's estimator (the SAME document
 * whose maps the construction bakes) and its opaque branches. */
export type FiniteCompositeRoute =
  | { dimension: 3; de: SurfaceDE; branches: FiniteSolidOpaqueBranch[] }
  | { dimension: 4; de: SurfaceDE4; branches: FiniteSolidOpaqueBranch[] };

export type FiniteCompositeDecision =
  | { kind: "composite"; route: FiniteCompositeRoute }
  /** Cells throughout — no glass map, or no opaque one. */
  | { kind: "cells" }
  /** The opaque maps stay cells because the attractor's estimator refuses;
   * `reason` is the disclosure. */
  | { kind: "refused"; reason: string };

/** Why a composite fell back to cells, shared by the session toast and the
 * tests. */
export const FINITE_COMPOSITE_MAP_CAP_REASON = `the attractor render packs at most ${String(SURFACE_GPU_UNIFORM_MAP_SLOTS)} maps`;

/**
 * Decide the composite for a general construction under its media codes
 * (`finiteSolidGeneralMediaCodes`: 0 opaque, >0 glass). `transforms` and the
 * rest are the document the construction was admitted from; the estimator
 * is built from the same arguments the ordinary Surface render passes.
 */
export function decideFiniteComposite(
  construction: FiniteSolidGeneralConstruction,
  media: FiniteSolidGeneralMedia,
  transforms: Transform[],
  finalTransform: Transform | null,
  symmetry: SymmetryParams,
): FiniteCompositeDecision {
  const glass = media.some((code) => code !== 0);
  const opaque = media.some((code) => code === 0);
  if (!glass || !opaque) return { kind: "cells" };
  if (construction.mapCount > SURFACE_GPU_UNIFORM_MAP_SLOTS) {
    return { kind: "refused", reason: FINITE_COMPOSITE_MAP_CAP_REASON };
  }
  const fourD = construction.dimension === 4;
  const analysis = fourD
    ? analyzeSurfaceSystem4(transforms, finalTransform, null, symmetry)
    : analyzeSurfaceSystem(transforms, finalTransform, null, symmetry);
  if (analysis.status === "ineligible") {
    return {
      kind: "refused",
      reason: `the attractor has no surface estimator (${analysis.reasons.join("; ")})`,
    };
  }
  const de = fourD
    ? buildSurfaceDE4(transforms, finalTransform, symmetry)
    : buildSurfaceDE(transforms, finalTransform, symmetry);
  // The descent's maps must be the construction's, one for one — the
  // kernel's branch table indexes both with one map index.
  if (de.maps.length !== construction.mapCount) {
    return {
      kind: "refused",
      reason: `the attractor's ${String(de.maps.length)} maps do not match the solid's ${String(construction.mapCount)}`,
    };
  }
  const content = buildFiniteSolidOpaqueContent(construction, media, de);
  return {
    kind: "composite",
    route:
      content.dimension === 4
        ? { dimension: 4, de: content.de, branches: content.branches }
        : { dimension: 3, de: content.de, branches: content.branches },
  };
}
