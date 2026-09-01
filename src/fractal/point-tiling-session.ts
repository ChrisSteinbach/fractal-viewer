import { chamberContentFit, poseTilingForContent } from "./chamber-content";
import { resolvePointTilingPlan, type PointTilingPlan } from "./point-tiling";
import { shapeMeshIds } from "./shapes";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  surfaceOriginVisibleRadius,
} from "./surface-de";
import { analyzeSurfaceSystem4, buildSurfaceDE4 } from "./surface-de-4d";
import {
  isLatticeTilingSpec,
  resolveTiling,
  TILING_GROUP_INFO,
  type ResolvedTiling,
  type TilingSpec,
} from "./tiling";
import type { HybridSchedule, SymmetryParams, Transform } from "./types";

export interface PointTilingSessionOff {
  status: "off";
  plan: null;
  resolved: null;
  note: null;
}

export interface PointTilingSessionRefused {
  status: "refused";
  plan: null;
  resolved: null;
  note: string;
}

export interface PointTilingSessionActive {
  status: "active";
  plan: PointTilingPlan;
  resolved: ResolvedTiling;
  note: null;
  originVisibleRadius: number;
}

export type PointTilingSessionResolution =
  PointTilingSessionOff | PointTilingSessionRefused | PointTilingSessionActive;

const OFF: PointTilingSessionOff = {
  status: "off",
  plan: null,
  resolved: null,
  note: null,
};

function refused(note: string): PointTilingSessionRefused {
  return { status: "refused", plan: null, resolved: null, note };
}

/**
 * Resolve the worker-local legality and runtime state for one Points request.
 * The result is intentionally an in-process contract: callers keep the typed
 * arrays and cached matrix references in the worker and never clone a
 * resolved plan through a message boundary. Tiling resolves before the
 * caller constructs its chaos-game RNG, so the classic stream stays
 * byte-identical when the document has no tiling block or is refused.
 *
 * Document incompatibilities are classified before estimator construction.
 * Throws after those gates are programming-invariant failures (for example a
 * malformed lattice scalar or an impossible plan closure), not user-facing
 * refusal transitions.
 */
export function resolvePointTilingSession(
  transforms: Transform[],
  finalTransform: Transform | null,
  symmetry: SymmetryParams,
  schedule: HybridSchedule | null,
  tiling: TilingSpec | null,
  balloonEcho: boolean,
  fourD: boolean,
): PointTilingSessionResolution {
  if (!tiling) return OFF;

  if (balloonEcho) {
    return refused(
      "Point tiling is unavailable with Balloon; turn Balloon off.",
    );
  }
  if (symmetry.order > 1) {
    return refused(
      "Point tiling is unavailable with kaleidoscope symmetry above order 1; set Order to 1.",
    );
  }
  if (tiling.clip && shapeMeshIds(tiling.clip).length > 0) {
    return refused(
      "Point tiling clips must use analytic shapes; remove the mesh-backed clip.",
    );
  }
  if (!isLatticeTilingSpec(tiling)) {
    const info = TILING_GROUP_INFO[tiling.group];
    const dimension = fourD ? 4 : 3;
    if (info.dim !== dimension) {
      return refused(
        `${info.id.toUpperCase()} point tiling is ${info.dim}D, but the active point cloud is ${dimension}D.`,
      );
    }
  }

  const analysis = fourD
    ? analyzeSurfaceSystem4(transforms, finalTransform, schedule)
    : analyzeSurfaceSystem(transforms, finalTransform, schedule);
  if (analysis.status === "ineligible") {
    return refused(
      `Point tiling requires an inverse-IFS attractor; ${analysis.reasons.join(
        "; ",
      )}. Forward escape-time and Mandelbulb point clouds are reset debris, not tileable set samples.`,
    );
  }

  const de = fourD
    ? buildSurfaceDE4(transforms, finalTransform, symmetry, { schedule })
    : buildSurfaceDE(transforms, finalTransform, symmetry, { schedule });
  const originVisibleRadius = surfaceOriginVisibleRadius(de);
  const rawResolved = resolveTiling(tiling, originVisibleRadius);
  if (!rawResolved) {
    throw new Error("point tiling session: live tiling resolved to null");
  }
  const fit = chamberContentFit(
    transforms,
    finalTransform,
    rawResolved,
    fourD,
    symmetry,
    schedule,
  );
  const resolved = poseTilingForContent(rawResolved, fit);
  const plan = resolvePointTilingPlan(resolved, fourD ? 4 : 3);
  if (!plan) {
    throw new Error("point tiling session: live tiling produced no point plan");
  }
  return {
    status: "active",
    plan,
    resolved,
    note: null,
    originVisibleRadius,
  };
}
