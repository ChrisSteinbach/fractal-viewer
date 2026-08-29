/**
 * Pure exact-document mutation candidate pipeline for Evolution Lab.
 *
 * The low-level mutation kernel owns only MorphSystem fields. This layer owns
 * the full persisted SceneSnapshot: it defensively clones the parent before
 * mutation, carries every non-kernel field forward, freezes the resulting
 * candidate recursively, and quality-scores that exact frozen authority.
 * Rejected documents are diagnostics only and can never be mistaken for a
 * lineage node.
 */
import {
  MUTATION_DOMAINS,
  mutateSystemSeeded,
  type MutationDomain,
  type SeededMutationAlgorithmVersion,
  type SeededMutationProfile,
  type SeededMutationRequest,
} from "../fractal/mutate-system";
import { MIN_OCCUPIED_CELLS, scoreSystem } from "../fractal/random-system";
import { mulberry32 } from "../fractal/rng";
import type { MorphSystem } from "../fractal/morph";
import type { HybridSchedule, Transform } from "../fractal/types";
import { sceneCustomMeshIds } from "./scene-mesh-assets";
import type { CustomMeshAssetId } from "../fractal/mesh-shapes";
import type { SceneSnapshot } from "./persist";

/** Version boundary for the app-layer probe derivation and acceptance rule. */
export const EVOLUTION_CANDIDATE_QUALITY_VERSION = 1 as const;
export const EVOLUTION_CANDIDATE_QUALITY_PROBES = 2 as const;

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Entry)[]
    ? readonly DeepReadonly<Entry>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ImmutableSceneSnapshot = DeepReadonly<SceneSnapshot>;

/** Canonical profile metadata: defaults made explicit and locks in domain
 * declaration order, independent of caller array ordering or duplicates. */
export interface OwnedSeededMutationProfile {
  readonly wildcard: boolean;
  readonly lockedDomains: readonly MutationDomain[];
}

export interface EvolutionCandidateQuality {
  readonly scores: readonly [number, number];
  readonly minimum: number;
  readonly threshold: number;
  readonly probeVersion: typeof EVOLUTION_CANDIDATE_QUALITY_VERSION;
}

export interface EvolutionMutationCandidate {
  /** Exact authority to preview, encode, add, load, and restore. */
  readonly snapshot: ImmutableSceneSnapshot;
  readonly nodeSeed: number;
  readonly childOrdinal: number;
  readonly algorithmVersion: SeededMutationAlgorithmVersion;
  readonly profile: OwnedSeededMutationProfile;
  readonly quality: EvolutionCandidateQuality;
  /** Sorted content IDs only. The integration layer acquires/releases its
   * bounded runtime leases when the candidate becomes a retained node. */
  readonly resourceIds: readonly CustomMeshAssetId[];
}

export interface EvolutionMutationRejection {
  readonly reason: "quality-below-threshold";
  readonly nodeSeed: number;
  readonly childOrdinal: number;
  readonly algorithmVersion: SeededMutationAlgorithmVersion;
  readonly profile: OwnedSeededMutationProfile;
  readonly quality: EvolutionCandidateQuality;
}

export type EvolutionMutationCandidateResult =
  | {
      readonly accepted: true;
      readonly candidate: EvolutionMutationCandidate;
    }
  | {
      readonly accepted: false;
      readonly rejection: EvolutionMutationRejection;
    };

function freezeRecursively(value: unknown, seen: Set<object>): void {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    return;
  }
  const object = value;
  if (seen.has(object)) return;
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) {
    freezeRecursively((object as Record<PropertyKey, unknown>)[key], seen);
  }
  Object.freeze(object);
}

/** Clone and recursively freeze a complete document, preserving sparse
 * property absence. Exported so lineage roots can use the same ownership
 * boundary as generated candidates. */
export function ownEvolutionSceneSnapshot(
  snapshot: SceneSnapshot,
): ImmutableSceneSnapshot {
  const owned = structuredClone(snapshot);
  freezeRecursively(owned, new Set());
  return owned;
}

function ownProfile(
  profile: SeededMutationProfile | undefined,
): OwnedSeededMutationProfile {
  const requested = new Set(profile?.lockedDomains ?? []);
  const lockedDomains = MUTATION_DOMAINS.filter((domain) =>
    requested.has(domain),
  );
  return Object.freeze({
    wildcard: profile?.wildcard ?? false,
    lockedDomains: Object.freeze(lockedDomains),
  });
}

function validateCoordinates(request: SeededMutationRequest): void {
  if (
    !Number.isInteger(request.nodeSeed) ||
    request.nodeSeed < 0 ||
    request.nodeSeed > 0xffff_ffff
  ) {
    throw new RangeError("Evolution mutation nodeSeed must be a uint32");
  }
  if (!Number.isSafeInteger(request.childOrdinal) || request.childOrdinal < 0) {
    throw new RangeError(
      "Evolution mutation childOrdinal must be a non-negative safe integer",
    );
  }
}

/** Stable dependency-free 32-bit derivation for the strict quality arm. It
 * is intentionally separate from the mutation kernel's domain streams. */
function deriveQualitySeed(parts: readonly (number | string)[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const value = String(part);
    const framed = `${value.length}:${value}`;
    for (let i = 0; i < framed.length; i++) {
      hash ^= framed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function qualityRng(request: SeededMutationRequest, probe: number) {
  return mulberry32(
    deriveQualitySeed([
      "evolution-candidate-quality",
      EVOLUTION_CANDIDATE_QUALITY_VERSION,
      request.algorithmVersion,
      request.nodeSeed,
      request.childOrdinal,
      probe,
    ]),
  );
}

function morphSystemFromSnapshot(
  snapshot: ImmutableSceneSnapshot,
): MorphSystem {
  return {
    transforms: snapshot.transforms as Transform[],
    finalTransform: (snapshot.finalTransform as Transform | undefined) ?? null,
    symmetry: snapshot.symmetry,
    shapeTrap: snapshot.shapeTrap as MorphSystem["shapeTrap"],
    condensationDepthBand: snapshot.condensationDepthBand,
  };
}

function candidateSnapshot(
  parent: ImmutableSceneSnapshot,
  mutated: MorphSystem,
): ImmutableSceneSnapshot {
  const draft = structuredClone(parent) as SceneSnapshot;
  draft.transforms = mutated.transforms;
  draft.symmetry = mutated.symmetry;
  if (parent.finalTransform === undefined) {
    // Preserve both forms of document absence rather than materializing the
    // kernel's null: a truly missing key stays missing, while a caller's own
    // explicitly-undefined key remains explicitly present.
    if (Object.hasOwn(parent, "finalTransform")) {
      draft.finalTransform = undefined;
    } else {
      delete draft.finalTransform;
    }
  } else {
    if (mutated.finalTransform === null) {
      throw new Error("Seeded mutation unexpectedly removed a final transform");
    }
    draft.finalTransform = mutated.finalTransform;
  }
  return ownEvolutionSceneSnapshot(draft);
}

function strictQuality(
  snapshot: ImmutableSceneSnapshot,
  request: SeededMutationRequest,
): EvolutionCandidateQuality {
  const system = morphSystemFromSnapshot(snapshot);
  const schedule = snapshot.schedule ?? null;
  const effectiveSchedule = schedule as unknown as HybridSchedule | null;
  const first = scoreSystem(system, qualityRng(request, 0), effectiveSchedule);
  const second = scoreSystem(system, qualityRng(request, 1), effectiveSchedule);
  const scores: readonly [number, number] = Object.freeze([first, second]);
  return Object.freeze({
    scores,
    minimum: Math.min(first, second),
    threshold: MIN_OCCUPIED_CELLS,
    probeVersion: EVOLUTION_CANDIDATE_QUALITY_VERSION,
  });
}

/**
 * Create one deterministic full-document child. `mutateSystemSeeded` is
 * invoked exactly once for this child ordinal. Schedule, condensation band,
 * shape trap, scene-level appearance/render settings, camera, FourDPose, and
 * every other non-kernel field are carried unchanged into a fresh owned
 * document. Transform appearance follows the kernel's `appearance` lock.
 *
 * Both strict probes score that exact owned document with its effective
 * schedule. A failure returns no snapshot and therefore cannot be admitted as
 * a lineage node. The function does not pin custom meshes or mutate any
 * runtime cache; accepted resource IDs are handed to the caller for bounded
 * lease management on admission.
 */
export function createEvolutionMutationCandidate(
  parentSnapshot: SceneSnapshot,
  request: SeededMutationRequest,
): EvolutionMutationCandidateResult {
  validateCoordinates(request);
  const profile = ownProfile(request.profile);
  const ownedParent = ownEvolutionSceneSnapshot(parentSnapshot);
  const normalizedRequest: SeededMutationRequest = {
    algorithmVersion: request.algorithmVersion,
    nodeSeed: request.nodeSeed,
    childOrdinal: request.childOrdinal,
    profile,
  };
  const mutated = mutateSystemSeeded(
    morphSystemFromSnapshot(ownedParent),
    normalizedRequest,
  );
  const snapshot = candidateSnapshot(ownedParent, mutated);
  const quality = strictQuality(snapshot, normalizedRequest);
  if (quality.minimum < quality.threshold) {
    return Object.freeze({
      accepted: false,
      rejection: Object.freeze({
        reason: "quality-below-threshold",
        nodeSeed: request.nodeSeed,
        childOrdinal: request.childOrdinal,
        algorithmVersion: request.algorithmVersion,
        profile,
        quality,
      }),
    });
  }

  const resourceIds = Object.freeze(
    sceneCustomMeshIds(snapshot as unknown as SceneSnapshot),
  );
  return Object.freeze({
    accepted: true,
    candidate: Object.freeze({
      snapshot,
      nodeSeed: request.nodeSeed,
      childOrdinal: request.childOrdinal,
      algorithmVersion: request.algorithmVersion,
      profile,
      quality,
      resourceIds,
    }),
  });
}
