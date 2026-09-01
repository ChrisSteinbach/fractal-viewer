import { chamberContentFit, poseTilingForContent } from "./chamber-content";
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

export interface SolidTilingSessionOff {
  status: "off";
  application: "material-live" | "worker-baked";
  resolved: null;
  originVisibleRadius: null;
  note: null;
}

export interface SolidTilingSessionRefused {
  status: "refused";
  application: "material-live" | "worker-baked";
  resolved: null;
  originVisibleRadius: null;
  note: string;
}

export interface SolidTilingSessionActive {
  status: "active";
  /** 3D folds material queries live; 4D bakes raw images in the worker. */
  application: "material-live" | "worker-baked";
  resolved: ResolvedTiling;
  originVisibleRadius: number;
  note: null;
}

export type SolidTilingSessionResolution =
  SolidTilingSessionOff | SolidTilingSessionRefused | SolidTilingSessionActive;

function refused(
  note: string,
  application: "material-live" | "worker-baked",
): SolidTilingSessionRefused {
  return {
    status: "refused",
    application,
    resolved: null,
    originVisibleRadius: null,
    note,
  };
}

/**
 * Resolve the legality and application arm for one Solid session. Flat Solid
 * folds material queries over an unchanged canonical volume; 4D Solid bakes
 * bounded raw images into the projected density volume in its worker. The
 * explicit `application` discriminator prevents a 4D result from ever being
 * installed as the rejected post-projection material fold.
 *
 * Document incompatibilities are classified before estimator construction,
 * mirroring `point-tiling-session.ts`'s order. Refusals follow the frozen
 * combination matrix (`docs/tiling-contract.md`): the volume bakes the
 * kaleidoscope into the attractor, so symmetry order > 1 and balloon have
 * no canonical chamber content; a mesh-backed clip cannot be tested in the
 * query fold; and a forward escape-time/bulb volume is reset debris, not a
 * sample of the Surface set. Only an inverse-IFS attractor is tileable — the
 * same gate the point family's session resolves against.
 */
export function resolveSolidTilingSession(
  transforms: Transform[],
  finalTransform: Transform | null,
  symmetry: SymmetryParams,
  schedule: HybridSchedule | null,
  tiling: TilingSpec | null,
  balloonEcho: boolean,
  nonFlat: boolean,
): SolidTilingSessionResolution {
  const application = nonFlat ? "worker-baked" : "material-live";
  if (!tiling) {
    return {
      status: "off",
      application,
      resolved: null,
      originVisibleRadius: null,
      note: null,
    };
  }

  if (balloonEcho) {
    return refused(
      "Solid tiling is unavailable with Balloon; turn Balloon off.",
      application,
    );
  }
  if (symmetry.order > 1) {
    return refused(
      "Solid tiling is unavailable with kaleidoscope symmetry above order 1; set Order to 1.",
      application,
    );
  }
  if (tiling.clip && shapeMeshIds(tiling.clip).length > 0) {
    return refused(
      "Solid tiling clips must use analytic shapes; remove the mesh-backed clip.",
      application,
    );
  }
  if (
    !isLatticeTilingSpec(tiling) &&
    TILING_GROUP_INFO[tiling.group].dim !== (nonFlat ? 4 : 3)
  ) {
    const dimension = nonFlat ? 4 : 3;
    return refused(
      `${TILING_GROUP_INFO[tiling.group].id.toUpperCase()} is a ${TILING_GROUP_INFO[tiling.group].dim}D group, but this Solid render is ${dimension}D.`,
      application,
    );
  }

  const analysis = nonFlat
    ? analyzeSurfaceSystem4(transforms, finalTransform, schedule)
    : analyzeSurfaceSystem(transforms, finalTransform, schedule);
  if (analysis.status === "ineligible") {
    return refused(
      `Solid tiling requires an inverse-IFS attractor; ${analysis.reasons.join(
        "; ",
      )}. Forward escape-time and Mandelbulb voxel volumes are reset debris, not tileable set samples.`,
      application,
    );
  }

  const de = nonFlat
    ? buildSurfaceDE4(transforms, finalTransform, symmetry, { schedule })
    : buildSurfaceDE(transforms, finalTransform, symmetry, { schedule });
  const originVisibleRadius = surfaceOriginVisibleRadius(de);
  const rawResolved = resolveTiling(tiling, originVisibleRadius);
  if (!rawResolved) {
    throw new Error("solid tiling session: live tiling resolved to null");
  }
  const fit = chamberContentFit(
    transforms,
    finalTransform,
    rawResolved,
    nonFlat,
    symmetry,
    schedule,
  );
  const resolved = poseTilingForContent(rawResolved, fit);
  return {
    status: "active",
    application,
    resolved,
    originVisibleRadius,
    note: null,
  };
}
