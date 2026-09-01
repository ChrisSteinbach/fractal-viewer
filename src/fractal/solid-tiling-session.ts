import { chamberContentFit, poseTilingForContent } from "./chamber-content";
import { shapeMeshIds } from "./shapes";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  surfaceOriginVisibleRadius,
} from "./surface-de";
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
  resolved: null;
  originVisibleRadius: null;
  note: null;
}

export interface SolidTilingSessionRefused {
  status: "refused";
  resolved: null;
  originVisibleRadius: null;
  note: string;
}

export interface SolidTilingSessionActive {
  status: "active";
  resolved: ResolvedTiling;
  originVisibleRadius: number;
  note: null;
}

export type SolidTilingSessionResolution =
  SolidTilingSessionOff | SolidTilingSessionRefused | SolidTilingSessionActive;

const OFF: SolidTilingSessionOff = {
  status: "off",
  resolved: null,
  originVisibleRadius: null,
  note: null,
};

function refused(note: string): SolidTilingSessionRefused {
  return { status: "refused", resolved: null, originVisibleRadius: null, note };
}

/**
 * Resolve the material-local legality and runtime state for one Solid
 * session. The voxel worker's density volume is camera-independent and
 * tiling edits never restart it, so this resolution — and its refusal
 * reasons — are exactly what the panel's Solid disclosure mirrors, and the
 * material arm is installed/cleared from it on session entry and on every
 * tiling/balloon/symmetry edit.
 *
 * Document incompatibilities are classified before estimator construction,
 * mirroring `point-tiling-session.ts`'s order. Refusals follow the frozen
 * combination matrix (`docs/tiling-contract.md`): the volume bakes the
 * kaleidoscope into the attractor, so symmetry order > 1 and balloon have
 * no canonical chamber content; a mesh-backed clip cannot be tested in the
 * query fold; a 4D document's voxel volume is a 3D slice, so no 4D fold
 * can act on it (the 4D lift's representation is an open decision); and a
 * forward escape-time/bulb volume is reset debris, not a sample of the
 * Surface set. Only an inverse-IFS attractor is tileable — the same gate
 * the point family's session resolves against.
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
  if (!tiling) return OFF;

  if (balloonEcho) {
    return refused(
      "Solid tiling is unavailable with Balloon; turn Balloon off.",
    );
  }
  if (symmetry.order > 1) {
    return refused(
      "Solid tiling is unavailable with kaleidoscope symmetry above order 1; set Order to 1.",
    );
  }
  if (tiling.clip && shapeMeshIds(tiling.clip).length > 0) {
    return refused(
      "Solid tiling clips must use analytic shapes; remove the mesh-backed clip.",
    );
  }
  if (nonFlat) {
    // The voxel worker accumulates the 3D slice of the 4D attractor; a 4D
    // group or lattice cannot fold the w the volume already discarded, and
    // the dimensional-parity rule makes 3D groups on a 4D document equally
    // refused. The 4D Solid lift's representation is an open decision.
    return refused(
      "4D Solid tiling is not shipped yet; it lands with the 4D Solid lift.",
    );
  }
  if (
    !isLatticeTilingSpec(tiling) &&
    TILING_GROUP_INFO[tiling.group].dim !== 3
  ) {
    return refused(
      `${TILING_GROUP_INFO[tiling.group].id.toUpperCase()} is a ${TILING_GROUP_INFO[tiling.group].dim}D group, but this Solid render is 3D.`,
    );
  }

  const analysis = analyzeSurfaceSystem(transforms, finalTransform, schedule);
  if (analysis.status === "ineligible") {
    return refused(
      `Solid tiling requires an inverse-IFS attractor; ${analysis.reasons.join(
        "; ",
      )}. Forward escape-time and Mandelbulb voxel volumes are reset debris, not tileable set samples.`,
    );
  }

  const de = buildSurfaceDE(transforms, finalTransform, symmetry, { schedule });
  const originVisibleRadius = surfaceOriginVisibleRadius(de);
  const rawResolved = resolveTiling(tiling, originVisibleRadius);
  if (!rawResolved) {
    throw new Error("solid tiling session: live tiling resolved to null");
  }
  const fit = chamberContentFit(
    transforms,
    finalTransform,
    rawResolved,
    false,
    symmetry,
    schedule,
  );
  const resolved = poseTilingForContent(rawResolved, fit);
  return {
    status: "active",
    resolved,
    originVisibleRadius,
    note: null,
  };
}
