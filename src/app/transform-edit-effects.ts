import { systemPartsAreNonFlat } from "../fractal/affine4";
import type { PaletteSelection } from "../fractal/palette";
import type {
  ColorMode,
  FourDColorMode,
  HybridSchedule,
  SymmetryParams,
  Transform,
} from "../fractal/types";
import type { RenderMode, SurfaceColorSource } from "./state";
import type {
  SurfaceEligibilityResult,
  SurfaceRouteKind,
} from "./surface-eligibility";
import { surfaceForwardSlot } from "./surface-slots";

/** The scene-document subset whose composition editors can change or reroute. */
export interface TransformEditSnapshot {
  readonly transforms: readonly Transform[];
  readonly finalTransform?: Transform | null;
  readonly symmetry: SymmetryParams;
  readonly schedule?: HybridSchedule | null;
}

/**
 * A semantic transform-editor delta. The five content flags are independent:
 * a material starting point, for example, can change both finish and pattern
 * in one edit. Geometry deliberately excludes those four per-map appearance
 * fields, so a color/material-only edit never inherits regeneration cost.
 *
 * The index lists use the NEXT document's transform order. They let Surface
 * distinguish a live IFS slot or forward-route head from authored state that
 * the active route does not read. Topology changes are geometry and therefore
 * do not need a synthetic appearance index for a newly added/removed map.
 */
export interface TransformEditDelta {
  readonly geometry: boolean;
  readonly colorIndex: boolean;
  readonly colorSpeed: boolean;
  readonly finish: boolean;
  readonly pattern: boolean;
  readonly dimensionChanged: boolean;
  readonly colorIndexTransforms: readonly number[];
  readonly colorSpeedTransforms: readonly number[];
  readonly finishTransforms: readonly number[];
  readonly patternTransforms: readonly number[];
}

export type PointsTransformEditEffect =
  "none" | "recolor-flat" | "recolor-4d" | "regenerate";

export type ActiveTransformEditEffect =
  "none" | "restart-flame" | "restart-solid" | "reenter-surface" | "next-entry";

export interface TransformEditPlan {
  /** Work that keeps the cached Points view ready, even behind another mode. */
  readonly points: PointsTransformEditEffect;
  /** Work for the renderer currently on the canvas. */
  readonly active: ActiveTransformEditEffect;
  /** Geometry can cross a Surface analyzer seam synchronously. */
  readonly refreshSurfaceEligibility: boolean;
  /** A color-only Flame/Solid restart must not roll new stochastic geometry. */
  readonly reuseActiveSeed: boolean;
  /** A transform-driven Surface re-entry must not refit a navigated camera. */
  readonly preserveSurfaceView: boolean;
}

export interface TransformEditSurfaceContext {
  readonly eligibility: Pick<SurfaceEligibilityResult, "status" | "kind">;
  readonly colorSource: SurfaceColorSource;
  /** Whether the authored shape-trap block can be live on a forward route. */
  readonly shapeTrapActive: boolean;
}

/** Current state needed to turn a document delta into renderer work. */
export interface TransformEditPlanContext {
  readonly document: TransformEditSnapshot;
  /** Dimension of the cached point cloud, used by Points recoloring. */
  readonly displayedNonFlat: boolean;
  /** Dimension snapshotted by the active Flame/Solid accumulation session. */
  readonly activeRenderNonFlat: boolean;
  /** False while an authored geometry edit has no matching cloud/support yet. */
  readonly pointSupportCurrent: boolean;
  readonly renderMode: RenderMode;
  readonly autoUpdate: boolean;
  readonly balloonEcho: boolean;
  readonly colorMode: ColorMode;
  readonly fourDColor: FourDColorMode;
  readonly flamePaletteId: PaletteSelection;
  readonly solidPaletteId: PaletteSelection;
  readonly surface: TransformEditSurfaceContext;
}

/** Plain document values only: arrays and objects, with no prototypes/DOM. */
function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null) return false;
  if (typeof right !== "object" || right === null) return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((value, index) => structurallyEqual(value, right[index]))
    );
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        structurallyEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

/** Every per-map field that changes orbit/support rather than appearance. */
function transformGeometry(transform: Transform): object {
  return {
    position: transform.position,
    rotation: transform.rotation,
    scale: transform.scale,
    // The editor's full geometry emission materializes these three classic
    // defaults during an otherwise appearance-only edit. Compare their
    // renderer meanings, not sparse storage, or the first Color/Finish edit
    // would be misclassified as geometry and regenerate/restart everything.
    weight: transform.weight ?? 1,
    shear: transform.shear ?? [0, 0, 0],
    variations: transform.variations ?? [],
    w: transform.w,
    chaos: transform.chaos,
    emitter: transform.emitter,
  };
}

function finalGeometry(transform: Transform | null): object | null {
  return transform === null
    ? null
    : { id: transform.id, ...transformGeometry(transform) };
}

function matchingPreviousTransforms(
  previous: readonly Transform[],
): ReadonlyMap<number, Transform> {
  return new Map(previous.map((transform) => [transform.id, transform]));
}

function changedTransformIndices(
  previousById: ReadonlyMap<number, Transform>,
  next: readonly Transform[],
  field: "colorIndex" | "colorSpeed" | "finish" | "surfacePattern",
): number[] {
  const changed: number[] = [];
  next.forEach((transform, index) => {
    const old = previousById.get(transform.id);
    // Adding/removing/replacing a map is already a geometry edit. Appearance
    // deltas name edits to a surviving map so route-slot gating stays exact.
    if (!old) return;
    if (!structurallyEqual(old[field], transform[field])) changed.push(index);
  });
  return changed;
}

/**
 * Classify a whole-document previous -> next transform edit. Matching by id
 * keeps a pure reorder a topology edit instead of falsely reporting every
 * moved map's appearance fields as edited.
 */
export function classifyTransformEdit(
  previous: TransformEditSnapshot,
  next: TransformEditSnapshot,
): TransformEditDelta {
  const previousById = matchingPreviousTransforms(previous.transforms);
  const topologyChanged =
    previous.transforms.length !== next.transforms.length ||
    previous.transforms.some(
      (transform, index) => transform.id !== next.transforms[index]?.id,
    );
  const mapGeometryChanged = next.transforms.some((transform) => {
    const old = previousById.get(transform.id);
    return old
      ? !structurallyEqual(transformGeometry(old), transformGeometry(transform))
      : false;
  });
  const previousFinal = previous.finalTransform ?? null;
  const nextFinal = next.finalTransform ?? null;
  const geometry =
    topologyChanged ||
    mapGeometryChanged ||
    !structurallyEqual(
      finalGeometry(previousFinal),
      finalGeometry(nextFinal),
    ) ||
    !structurallyEqual(previous.symmetry, next.symmetry) ||
    !structurallyEqual(previous.schedule ?? null, next.schedule ?? null);

  const colorIndexTransforms = changedTransformIndices(
    previousById,
    next.transforms,
    "colorIndex",
  );
  const colorSpeedTransforms = changedTransformIndices(
    previousById,
    next.transforms,
    "colorSpeed",
  );
  const finishTransforms = changedTransformIndices(
    previousById,
    next.transforms,
    "finish",
  );
  const patternTransforms = changedTransformIndices(
    previousById,
    next.transforms,
    "surfacePattern",
  );
  const previousNonFlat = systemPartsAreNonFlat(
    previous.transforms,
    previousFinal,
    previous.symmetry,
  );
  const nextNonFlat = systemPartsAreNonFlat(
    next.transforms,
    nextFinal,
    next.symmetry,
  );

  return {
    geometry,
    colorIndex: colorIndexTransforms.length > 0,
    colorSpeed: colorSpeedTransforms.length > 0,
    finish: finishTransforms.length > 0,
    pattern: patternTransforms.length > 0,
    dimensionChanged: previousNonFlat !== nextNonFlat,
    colorIndexTransforms,
    colorSpeedTransforms,
    finishTransforms,
    patternTransforms,
  };
}

function paletteIsStructural(palette: PaletteSelection): boolean {
  return palette !== "legacy";
}

function flameConsumesColor(
  delta: TransformEditDelta,
  context: TransformEditPlanContext,
  nonFlat: boolean,
): boolean {
  const structural = paletteIsStructural(context.flamePaletteId);
  if (delta.colorSpeed && structural) return true;
  if (!delta.colorIndex) return false;
  if (structural) return true;
  // Flat Flame's legacy lane always shades by producing transform. In 4D,
  // the shared 4D Color selection replaces that lane unless it is Transform.
  return !nonFlat || context.fourDColor === "transform";
}

function solidConsumesColor(
  delta: TransformEditDelta,
  context: TransformEditPlanContext,
  nonFlat: boolean,
): boolean {
  const structural = paletteIsStructural(context.solidPaletteId);
  if (delta.colorSpeed && structural) return true;
  if (!delta.colorIndex) return false;
  if (structural) return true;
  return nonFlat
    ? context.fourDColor === "transform"
    : context.colorMode === "transform";
}

function surfaceTransformIndices(
  transforms: readonly Transform[],
  kind: SurfaceRouteKind,
): number[] {
  if (kind === "ifs" || kind === "ifs4") {
    const indices: number[] = [];
    transforms.forEach((transform, index) => {
      if ((transform.weight ?? 1) > 0) indices.push(index);
    });
    return indices;
  }
  return transforms.length > 0
    ? [surfaceForwardSlot(transforms).baseIndex]
    : [];
}

function intersects(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.some((value) => right.includes(value));
}

function surfaceConsumesAppearance(
  delta: TransformEditDelta,
  context: TransformEditPlanContext,
): boolean {
  const { eligibility } = context.surface;
  if (eligibility.status === "ineligible" || eligibility.kind === null) {
    return false;
  }
  const slots = surfaceTransformIndices(
    context.document.transforms,
    eligibility.kind,
  );
  const materialChanged =
    intersects(delta.finishTransforms, slots) ||
    intersects(delta.patternTransforms, slots);
  if (materialChanged) return true;

  // By Transform reads slot hues in every route. Palette reads authored trap
  // indices only in inverse-descent IFS routes; forward routes use their own
  // continuous orbit coordinate and a synthetic trap index of zero.
  const indexChanged = intersects(delta.colorIndexTransforms, slots);
  if (!indexChanged) return false;
  const colorSource = effectiveSurfaceColorSource(context.surface);
  if (colorSource === "transform") return true;
  return (
    colorSource === "palette" &&
    (eligibility.kind === "ifs" || eligibility.kind === "ifs4")
  );
}

/**
 * Resolve Surface's authored shape-trap source exactly like Scene: it exists
 * only on a live forward escape-family route and otherwise truthfully falls
 * back to By Transform.
 */
export function effectiveSurfaceColorSource(
  surface: TransformEditSurfaceContext,
): SurfaceColorSource {
  if (
    surface.colorSource === "shapeTrap" &&
    !(
      surface.shapeTrapActive &&
      (surface.eligibility.kind === "escape" ||
        surface.eligibility.kind === "bulb" ||
        surface.eligibility.kind === "escape4")
    )
  ) {
    return "transform";
  }
  return surface.colorSource;
}

/** Turn a classified edit into the minimum truthful renderer work. */
export function planTransformEdit(
  delta: TransformEditDelta,
  context: TransformEditPlanContext,
): TransformEditPlan {
  const nextNonFlat = systemPartsAreNonFlat(
    context.document.transforms,
    context.document.finalTransform ?? null,
    context.document.symmetry,
  );
  let points: PointsTransformEditEffect = "none";
  if (delta.geometry) {
    if (context.autoUpdate) points = "regenerate";
  } else if (delta.colorIndex) {
    if (context.displayedNonFlat && context.fourDColor === "transform") {
      points = "recolor-4d";
    } else if (!context.displayedNonFlat && context.colorMode === "transform") {
      points = "recolor-flat";
    }
  }

  let active: ActiveTransformEditEffect = "none";
  if (delta.geometry) {
    if (context.renderMode === "surface") {
      // Surface derives its DE, bounds, Balloon and material lanes directly
      // from the post-edit document. It never waits on the Points cloud.
      active = "reenter-surface";
    } else if (context.renderMode !== "points") {
      const needsFreshPointSupport =
        context.activeRenderNonFlat ||
        nextNonFlat ||
        delta.dimensionChanged ||
        context.balloonEcho;
      if (needsFreshPointSupport) {
        active = "next-entry";
      } else if (context.renderMode === "flame") {
        active = "restart-flame";
      } else if (context.renderMode === "solid") {
        active = "restart-solid";
      } else {
        active = "reenter-surface";
      }
    }
  } else {
    // A pure appearance edit preserves support only when no earlier geometry
    // edit is still staged/in flight. Flat non-Balloon Flame/Solid can derive
    // their own fresh support, but 4D snapshots and every Balloon route would
    // otherwise combine the new document with cached cloud bounds/ball.
    const appearanceNeedsStagedSupport =
      !context.pointSupportCurrent &&
      (context.activeRenderNonFlat || nextNonFlat || context.balloonEcho);
    if (
      context.renderMode === "flame" &&
      flameConsumesColor(delta, context, context.activeRenderNonFlat)
    ) {
      active = appearanceNeedsStagedSupport ? "next-entry" : "restart-flame";
    } else if (
      context.renderMode === "solid" &&
      solidConsumesColor(delta, context, context.activeRenderNonFlat)
    ) {
      active = appearanceNeedsStagedSupport ? "next-entry" : "restart-solid";
    } else if (
      context.renderMode === "surface" &&
      surfaceConsumesAppearance(delta, context)
    ) {
      active = "reenter-surface";
    }
  }

  return {
    points,
    active,
    refreshSurfaceEligibility: delta.geometry,
    reuseActiveSeed:
      !delta.geometry &&
      (active === "restart-flame" || active === "restart-solid"),
    // A settled transform edit is part of one continuous inspection gesture.
    // Re-entry may rebuild Surface, but must not reset the camera after every
    // slider release or discrete material/geometry action.
    preserveSurfaceView: active === "reenter-surface",
  };
}
