import type { RenderMode } from "./state";

/** The system axis used by panel applicability. This is deliberately not a
 * render mode: flat and non-flat documents can be inspected by every mode. */
export type PanelDimension = "flat" | "nonFlat";

/** Which object an active Surface session is actually marching. Keep this
 * separate from SurfaceRouteKind: active-session applicability and predicted
 * next-entry routing are different facts. */
export type SurfaceSessionKind = "ifs" | "escape" | "bulb";

export interface PanelContext {
  renderMode: RenderMode;
  dimension: PanelDimension;
  /** `null` means that Surface has not routed an active session. */
  surfaceKind: SurfaceSessionKind | null;
}

export interface ConsumerClause {
  renderModes?: readonly RenderMode[];
  dimensions?: readonly PanelDimension[];
  surfaceKinds?: readonly (SurfaceSessionKind | null)[];
}

/** Clauses are OR alternatives; fields inside one clause are AND constraints.
 * An omitted field is a wildcard, while an explicit `null` Surface kind means
 * pre-routing and never acts as a wildcard. */
export type ConsumerSpec = readonly ConsumerClause[];

export type PanelApplicability =
  | { kind: "enabled" }
  | { kind: "hidden" }
  | { kind: "disabled"; reason: string };

type InapplicableResult = Exclude<PanelApplicability, { kind: "enabled" }>;

interface PanelApplicabilitySpec {
  consumers: ConsumerSpec;
  otherwise: InapplicableResult;
}

export function matchesPanelConsumers(
  context: PanelContext,
  consumers: ConsumerSpec,
): boolean {
  return consumers.some(
    (clause) =>
      (clause.renderModes === undefined ||
        clause.renderModes.includes(context.renderMode)) &&
      (clause.dimensions === undefined ||
        clause.dimensions.includes(context.dimension)) &&
      (clause.surfaceKinds === undefined ||
        clause.surfaceKinds.includes(context.surfaceKind)),
  );
}

/** One refusal, one explanation in Solid and Surface: both reject the
 * sphere-inverted echo precisely when the rendered solid reaches the ball
 * centre. See docs/panel-ia.md's disable-with-adjacent-reason contract. */
export const BALLOON_CENTRE_REFUSAL_REASON =
  "Balloon unavailable — this solid fills its enclosing-ball centre.";

/** Semantic applicability for the first foundation controls. Document and
 * runtime predicates (emitter weight, authored traps, conformal folds) remain
 * with their feature owner and compose with this three-axis answer in ui.ts. */
export const PANEL_APPLICABILITY_SPECS = {
  surfaceInspector: {
    consumers: [{ renderModes: ["surface"] }],
    otherwise: { kind: "hidden" },
  },
  balloon: {
    consumers: [
      { renderModes: ["points", "flame", "solid"] },
      { renderModes: ["surface"], surfaceKinds: [null, "ifs"] },
    ],
    otherwise: {
      kind: "disabled",
      reason: BALLOON_CENTRE_REFUSAL_REASON,
    },
  },
  surfaceTrap: {
    consumers: [{ renderModes: ["surface"], surfaceKinds: ["escape", "bulb"] }],
    otherwise: { kind: "hidden" },
  },
  surfaceCondensation: {
    consumers: [{ renderModes: ["surface"], surfaceKinds: ["ifs"] }],
    otherwise: { kind: "hidden" },
  },
  surfaceTrapGeometry: {
    consumers: [{ renderModes: ["surface"], surfaceKinds: ["escape"] }],
    otherwise: { kind: "hidden" },
  },
} as const satisfies Record<string, PanelApplicabilitySpec>;

export type PanelApplicabilityId = keyof typeof PANEL_APPLICABILITY_SPECS;

export function resolvePanelApplicability(
  id: PanelApplicabilityId,
  context: PanelContext,
): PanelApplicability {
  const spec: PanelApplicabilitySpec = PANEL_APPLICABILITY_SPECS[id];
  return matchesPanelConsumers(context, spec.consumers)
    ? { kind: "enabled" }
    : spec.otherwise;
}
