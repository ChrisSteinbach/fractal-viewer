/**
 * Exact Collection-scene acquisition for Evolution comparison and Breed.
 *
 * This boundary decodes once, immediately takes immutable snapshot ownership,
 * then stages one scene's custom assets behind a lease. It never loads the
 * document into live application state and never invents lineage topology.
 * A successful caller owns `release`; a caller that later discovers its
 * request is stale must invoke it.
 */
import type { CustomMeshAssetId } from "../fractal/mesh-shapes";
import {
  ownEvolutionSceneSnapshot,
  type ImmutableSceneSnapshot,
} from "./evolution-candidate";
import type { EvolutionExternalComparisonEndpointInput } from "./evolution-comparison";
import {
  evolutionSceneContentDigest,
  type SceneContentDigest,
} from "./evolution-crossover";
import { decodeScene, type SceneSnapshot } from "./persist";
import {
  assertSceneCustomMeshBudget,
  sceneCustomMeshIds,
} from "./scene-mesh-assets";

export interface EvolutionCollectionParentSource {
  /** Opaque portable Collection document copied before acquisition begins. */
  readonly encoded: string;
}

export interface EvolutionCollectionParentIdentity {
  /** Unique acquisition lifecycle id; excluded from crossover coordinates. */
  readonly authorityId: string;
  readonly label: string;
}

export interface EvolutionCollectionParentDeps {
  readonly decode?: (encoded: string) => SceneSnapshot | null;
  readonly own?: (snapshot: SceneSnapshot) => ImmutableSceneSnapshot;
  readonly digest?: (
    snapshot: SceneSnapshot | ImmutableSceneSnapshot,
  ) => SceneContentDigest;
  readonly assertBudget?: (
    snapshot: SceneSnapshot | ImmutableSceneSnapshot,
  ) => void;
  readonly resourceIds?: (
    snapshot: SceneSnapshot | ImmutableSceneSnapshot,
  ) => readonly CustomMeshAssetId[];
  readonly pin: (resourceIds: readonly CustomMeshAssetId[]) => () => void;
  /** Hydrates this one parent's dependency set, never a two-parent union. */
  readonly hydrate: (
    resourceIds: readonly CustomMeshAssetId[],
  ) => Promise<void>;
}

export interface AcquiredEvolutionCollectionParent {
  readonly endpoint: EvolutionExternalComparisonEndpointInput;
  readonly resourceIds: readonly CustomMeshAssetId[];
  /** Idempotent lease release. */
  readonly release: () => void;
}

export type EvolutionCollectionParentRefusalCode =
  "invalid-authority" | "decode-failed" | "invalid-scene" | "asset-failed";

export type AcquireEvolutionCollectionParentResult =
  | {
      readonly acquired: true;
      readonly parent: AcquiredEvolutionCollectionParent;
    }
  | {
      readonly acquired: false;
      readonly code: EvolutionCollectionParentRefusalCode;
      readonly detail: string;
    };

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function refusal(
  code: EvolutionCollectionParentRefusalCode,
  message: string,
): AcquireEvolutionCollectionParentResult {
  return Object.freeze({ acquired: false as const, code, detail: message });
}

function idempotent(release: () => void): () => void {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    release();
  };
}

/**
 * Acquire one exact external authority. Replacement policy and stale request
 * tickets belong to the caller: failed acquisition leaves any previous pin
 * untouched, while a stale successful result must be released by its caller.
 */
export async function acquireEvolutionCollectionParent(
  source: EvolutionCollectionParentSource,
  identity: EvolutionCollectionParentIdentity,
  deps: EvolutionCollectionParentDeps,
): Promise<AcquireEvolutionCollectionParentResult> {
  if (
    typeof identity.authorityId !== "string" ||
    identity.authorityId.length === 0 ||
    typeof identity.label !== "string" ||
    identity.label.length === 0
  ) {
    return refusal(
      "invalid-authority",
      "Collection parent authority id and label must be non-empty",
    );
  }
  const encoded = source.encoded;
  const decode = deps.decode ?? decodeScene;
  const decoded = decode(encoded);
  if (decoded === null) {
    return refusal("decode-failed", "Collection scene could not be decoded");
  }

  const own = deps.own ?? ownEvolutionSceneSnapshot;
  const digest =
    deps.digest ??
    ((snapshot: SceneSnapshot | ImmutableSceneSnapshot) =>
      evolutionSceneContentDigest(snapshot));
  const assertBudget =
    deps.assertBudget ??
    ((snapshot: SceneSnapshot | ImmutableSceneSnapshot) =>
      assertSceneCustomMeshBudget(snapshot as SceneSnapshot));
  const collectResourceIds =
    deps.resourceIds ??
    ((snapshot: SceneSnapshot | ImmutableSceneSnapshot) =>
      sceneCustomMeshIds(snapshot as SceneSnapshot));

  let snapshot: ImmutableSceneSnapshot;
  let contentDigest: SceneContentDigest;
  let resourceIds: readonly CustomMeshAssetId[];
  try {
    snapshot = own(decoded);
    contentDigest = digest(snapshot);
    assertBudget(snapshot);
    resourceIds = Object.freeze(
      [...new Set(collectResourceIds(snapshot))].sort(),
    );
  } catch (error) {
    return refusal("invalid-scene", detail(error));
  }

  let release: () => void;
  try {
    release = idempotent(deps.pin(resourceIds));
  } catch (error) {
    return refusal("asset-failed", detail(error));
  }
  try {
    await deps.hydrate(resourceIds);
  } catch (error) {
    release();
    return refusal("asset-failed", detail(error));
  }

  const endpoint = Object.freeze({
    authorityId: identity.authorityId,
    label: identity.label,
    encodedScene: encoded,
    snapshot,
    contentDigest,
  });
  return Object.freeze({
    acquired: true as const,
    parent: Object.freeze({
      endpoint,
      resourceIds,
      release,
    }),
  });
}
