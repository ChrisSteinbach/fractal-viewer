/** Strict exact-document candidate gate layered over crossover-v1. */
import { MIN_OCCUPIED_CELLS } from "../fractal/random-system";
import { mulberry32 } from "../fractal/rng";
import {
  evaluateEvolutionCandidateQuality,
  type EvolutionCandidateQuality,
  type ImmutableSceneSnapshot,
} from "./evolution-candidate";
import {
  CROSSOVER_ALGORITHM_VERSION,
  createEvolutionCrossoverAttempt,
  evolutionCrossoverStreamSeed,
  prepareEvolutionCrossover,
  type EvolutionCrossoverAttempt,
  type EvolutionCrossoverCoordinates,
  type EvolutionCrossoverParentInput,
  type EvolutionCrossoverPairingKind,
  type EvolutionCrossoverPreflightOptions,
  type EvolutionCrossoverRefusal,
  type EvolutionTopologyV1,
  type SceneContentDigest,
} from "./evolution-crossover";
import {
  evaluateEvolutionSurfaceAdmission,
  type EvolutionSurfaceAdmission,
} from "./evolution-surface-constraint";
import type { SurfaceEligibilityResult } from "./surface-eligibility";
import type { CustomMeshAssetId } from "../fractal/mesh-shapes";

/** Fixed reproduction budget for crossover-v1, not a caller preference. */
export const CROSSOVER_V1_MAX_ATTEMPTS = 8 as const;

export interface EvolutionCrossoverCandidateRequest {
  readonly algorithmVersion: typeof CROSSOVER_ALGORITHM_VERSION;
  readonly nodeSeed: number;
  readonly childOrdinal: number;
  readonly surfaceRequired: boolean;
}

/** Exact JSON-shaped neutral Surface result retained in lineage provenance. */
export type EvolutionCrossoverProfileSurfaceEligibility = Readonly<{
  status: SurfaceEligibilityResult["status"];
  note: string | null;
  kind: SurfaceEligibilityResult["kind"];
  recovery?: SurfaceEligibilityResult["recovery"];
}>;

export interface EvolutionCrossoverProfileV1 {
  readonly algorithmVersion: typeof CROSSOVER_ALGORITHM_VERSION;
  readonly primaryContentDigest: SceneContentDigest;
  readonly secondaryContentDigest: SceneContentDigest;
  readonly nodeSeed: number;
  readonly childOrdinal: number;
  readonly acceptedAttempt: number;
  readonly pairingKind: EvolutionCrossoverPairingKind;
  readonly topologyToken: string;
  readonly topologySlotKeys: readonly string[];
  readonly qualityProbeVersion: number;
  readonly qualityScores: readonly [number, number];
  readonly surfaceRequired: boolean;
  readonly surfaceEligibility: EvolutionCrossoverProfileSurfaceEligibility | null;
}

export interface EvolutionCrossoverCandidate {
  readonly snapshot: ImmutableSceneSnapshot;
  readonly topology: EvolutionTopologyV1;
  readonly resourceIds: readonly CustomMeshAssetId[];
  readonly quality: EvolutionCandidateQuality;
  readonly surfaceEligibility: EvolutionCrossoverProfileSurfaceEligibility | null;
  readonly profile: EvolutionCrossoverProfileV1;
}

export type EvolutionCrossoverAttemptFailure =
  | {
      readonly attempt: number;
      readonly reason: "kernel-refusal";
      readonly refusal: EvolutionCrossoverRefusal;
    }
  | {
      readonly attempt: number;
      readonly reason: "quality-below-threshold";
      readonly quality: EvolutionCandidateQuality;
    }
  | {
      readonly attempt: number;
      readonly reason: "quality-error";
      readonly detail: string;
    }
  | {
      readonly attempt: number;
      readonly reason: "surface-incompatible";
      readonly eligibility: SurfaceEligibilityResult;
    };

export type EvolutionCrossoverCandidateRejection =
  | {
      readonly reason: "preflight-refusal";
      readonly refusal: EvolutionCrossoverRefusal;
    }
  | {
      readonly reason: "attempts-exhausted";
      readonly algorithmVersion: typeof CROSSOVER_ALGORITHM_VERSION;
      readonly nodeSeed: number;
      readonly childOrdinal: number;
      readonly surfaceRequired: boolean;
      readonly attempts: readonly EvolutionCrossoverAttemptFailure[];
    };

export type EvolutionCrossoverCandidateResult =
  | { readonly accepted: true; readonly candidate: EvolutionCrossoverCandidate }
  | {
      readonly accepted: false;
      readonly rejection: EvolutionCrossoverCandidateRejection;
    };

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function coordinates(
  request: EvolutionCrossoverCandidateRequest,
  attempt: number,
): EvolutionCrossoverCoordinates {
  return Object.freeze({
    algorithmVersion: request.algorithmVersion,
    nodeSeed: request.nodeSeed,
    childOrdinal: request.childOrdinal,
    attempt,
  });
}

function qualityForAttempt(
  attempt: EvolutionCrossoverAttempt,
  prepared: Parameters<typeof evolutionCrossoverStreamSeed>[0],
): EvolutionCandidateQuality {
  return evaluateEvolutionCandidateQuality(attempt.snapshot, (probe) =>
    mulberry32(
      evolutionCrossoverStreamSeed(
        prepared,
        attempt.coordinates,
        `quality:${probe}`,
      ),
    ),
  );
}

function ownEligibility(
  admission: EvolutionSurfaceAdmission,
): EvolutionCrossoverProfileSurfaceEligibility | null {
  if (admission.eligibility === null) return null;
  return Object.freeze({ ...admission.eligibility });
}

function validateRequest(
  request: EvolutionCrossoverCandidateRequest,
): EvolutionCrossoverRefusal | null {
  if (request.algorithmVersion !== CROSSOVER_ALGORITHM_VERSION) {
    return Object.freeze({
      code: "invalid-coordinates",
      detail: "unsupported crossover algorithm version",
    });
  }
  if (
    !Number.isInteger(request.nodeSeed) ||
    request.nodeSeed < 0 ||
    request.nodeSeed > 0xffff_ffff
  ) {
    return Object.freeze({
      code: "invalid-coordinates",
      detail: "nodeSeed must be a uint32",
    });
  }
  if (
    !Number.isSafeInteger(request.childOrdinal) ||
    request.childOrdinal < 0 ||
    Object.is(request.childOrdinal, -0)
  ) {
    return Object.freeze({
      code: "invalid-coordinates",
      detail: "childOrdinal must be a canonical non-negative safe integer",
    });
  }
  if (typeof request.surfaceRequired !== "boolean") {
    return Object.freeze({
      code: "invalid-coordinates",
      detail: "surfaceRequired must be boolean",
    });
  }
  return null;
}

/**
 * Build attempts in ascending order and return the first document that passes
 * both strict scheduled quality probes and the optional capability-neutral
 * Surface gate. Rejected attempts expose diagnostics only; no rejected
 * snapshot escapes this function and no graph/resource side effect occurs.
 */
export function createEvolutionCrossoverCandidate(
  primary: EvolutionCrossoverParentInput,
  secondary: EvolutionCrossoverParentInput,
  request: EvolutionCrossoverCandidateRequest,
  preflightOptions: EvolutionCrossoverPreflightOptions = {},
): EvolutionCrossoverCandidateResult {
  const requestRefusal = validateRequest(request);
  if (requestRefusal) {
    return Object.freeze({
      accepted: false,
      rejection: Object.freeze({
        reason: "preflight-refusal",
        refusal: requestRefusal,
      }),
    });
  }
  const preflight = prepareEvolutionCrossover(
    primary,
    secondary,
    preflightOptions,
  );
  if (!preflight.accepted) {
    return Object.freeze({
      accepted: false,
      rejection: Object.freeze({
        reason: "preflight-refusal",
        refusal: preflight.refusal,
      }),
    });
  }
  const failures: EvolutionCrossoverAttemptFailure[] = [];
  for (
    let attemptIndex = 0;
    attemptIndex < CROSSOVER_V1_MAX_ATTEMPTS;
    attemptIndex += 1
  ) {
    const built = createEvolutionCrossoverAttempt(
      preflight.prepared,
      coordinates(request, attemptIndex),
    );
    if (!built.accepted) {
      failures.push(
        Object.freeze({
          attempt: attemptIndex,
          reason: "kernel-refusal",
          refusal: built.refusal,
        }),
      );
      continue;
    }
    let quality: EvolutionCandidateQuality;
    try {
      quality = qualityForAttempt(built.attempt, preflight.prepared);
    } catch (error) {
      failures.push(
        Object.freeze({
          attempt: attemptIndex,
          reason: "quality-error",
          detail: detail(error),
        }),
      );
      continue;
    }
    if (quality.minimum < MIN_OCCUPIED_CELLS) {
      failures.push(
        Object.freeze({
          attempt: attemptIndex,
          reason: "quality-below-threshold",
          quality,
        }),
      );
      continue;
    }
    const admission = evaluateEvolutionSurfaceAdmission(
      built.attempt.snapshot as unknown as Parameters<
        typeof evaluateEvolutionSurfaceAdmission
      >[0],
      request.surfaceRequired,
    );
    if (!admission.admitted) {
      failures.push(
        Object.freeze({
          attempt: attemptIndex,
          reason: "surface-incompatible",
          eligibility: Object.freeze({ ...admission.eligibility }),
        }),
      );
      continue;
    }
    const surfaceEligibility = ownEligibility(admission);
    const profile: EvolutionCrossoverProfileV1 = Object.freeze({
      algorithmVersion: CROSSOVER_ALGORITHM_VERSION,
      primaryContentDigest: built.attempt.primaryContentDigest,
      secondaryContentDigest: built.attempt.secondaryContentDigest,
      nodeSeed: request.nodeSeed >>> 0,
      childOrdinal: request.childOrdinal,
      acceptedAttempt: attemptIndex,
      pairingKind: built.attempt.pairing.kind,
      topologyToken: built.attempt.topology.token,
      topologySlotKeys: built.attempt.topology.slotKeys,
      qualityProbeVersion: quality.probeVersion,
      qualityScores: quality.scores,
      surfaceRequired: request.surfaceRequired,
      surfaceEligibility,
    });
    return Object.freeze({
      accepted: true,
      candidate: Object.freeze({
        snapshot: built.attempt.snapshot,
        topology: built.attempt.topology,
        resourceIds: built.attempt.resourceIds,
        quality,
        surfaceEligibility,
        profile,
      }),
    });
  }
  return Object.freeze({
    accepted: false,
    rejection: Object.freeze({
      reason: "attempts-exhausted",
      algorithmVersion: CROSSOVER_ALGORITHM_VERSION,
      nodeSeed: request.nodeSeed >>> 0,
      childOrdinal: request.childOrdinal,
      surfaceRequired: request.surfaceRequired,
      attempts: Object.freeze(failures),
    }),
  });
}
