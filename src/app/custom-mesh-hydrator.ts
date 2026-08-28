/** Atomic scene dependency barrier for durable custom mesh assets. */
import {
  CUSTOM_MESH_SDF_RESOLUTION,
  MAX_CUSTOM_MESHES_PER_SCENE,
} from "../fractal/custom-mesh";
import {
  MESH_SDF_BAKE_VERSION,
  hasMeshAsset,
  hasMeshSdfBake,
  installCustomMeshAsset,
  installPreparedMeshSdfBake,
  prepareSerializedMeshSdfBake,
  prepareWorkerValidatedCustomMeshAsset,
  touchInstalledCustomMeshAssets,
  type CustomMeshAssetId,
  type MeshSdfBake,
  type PreparedMeshAsset,
  type SerializedMeshSdfBake,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";
import type { SceneSnapshot } from "./persist";
import {
  assertSceneCustomMeshBudget,
  sceneCustomMeshIds,
} from "./scene-mesh-assets";
import type {
  CustomMeshReadResult,
  CustomMeshStore,
} from "./custom-mesh-store";
import {
  rebakeCustomMeshSource,
  validateCustomMeshCache,
} from "./custom-mesh-importer";

export type CustomMeshAssetFailure = "missing" | "corrupt" | "invalid";

export class CustomMeshAssetResolutionError extends Error {
  constructor(
    readonly meshId: CustomMeshAssetId,
    readonly failure: CustomMeshAssetFailure,
    detail: string,
  ) {
    super(`Local mesh ${meshId} is ${failure}: ${detail}`);
    this.name = "CustomMeshAssetResolutionError";
  }
}

export interface CustomMeshAssetReader {
  readSource(
    id: CustomMeshAssetId,
  ): Promise<CustomMeshReadResult<SerializedPreparedMeshAsset>>;
  readBake(
    id: CustomMeshAssetId,
    version: number,
    resolution: number,
  ): Promise<CustomMeshReadResult<SerializedMeshSdfBake>>;
  putBake?(bake: SerializedMeshSdfBake): Promise<void>;
}

interface StagedMeshAsset {
  readonly source: PreparedMeshAsset;
  readonly bake: MeshSdfBake;
  readonly bakeWire: SerializedMeshSdfBake;
}

interface ValidatedMeshWires {
  readonly source: SerializedPreparedMeshAsset;
  readonly bake: SerializedMeshSdfBake;
}

export type CustomMeshHydrationWorker = (
  source: SerializedPreparedMeshAsset,
  bake: SerializedMeshSdfBake | null,
) => Promise<ValidatedMeshWires>;

const browserHydrationWorker: CustomMeshHydrationWorker = (source, bake) =>
  (bake
    ? validateCustomMeshCache(source, bake)
    : rebakeCustomMeshSource(source, CUSTOM_MESH_SDF_RESOLUTION)
  ).promise;

function requireRecord<T>(
  id: CustomMeshAssetId,
  label: string,
  result: CustomMeshReadResult<T>,
): T {
  if (result.status === "found") return result.value;
  if (result.status === "missing") {
    throw new CustomMeshAssetResolutionError(
      id,
      "missing",
      `${label} not found`,
    );
  }
  throw new CustomMeshAssetResolutionError(id, "corrupt", result.reason);
}

async function stageMesh(
  id: CustomMeshAssetId,
  store: CustomMeshAssetReader,
  validateOrBake: CustomMeshHydrationWorker,
): Promise<StagedMeshAsset> {
  const sourceWire = requireRecord(
    id,
    "source geometry",
    await store.readSource(id),
  );
  const bakeRecord = await store.readBake(
    id,
    MESH_SDF_BAKE_VERSION,
    CUSTOM_MESH_SDF_RESOLUTION,
  );
  try {
    let regenerated = bakeRecord.status !== "found";
    let validated: ValidatedMeshWires;
    if (bakeRecord.status === "found") {
      try {
        validated = await validateOrBake(sourceWire, bakeRecord.value);
      } catch {
        regenerated = true;
        validated = await validateOrBake(sourceWire, null);
      }
    } else {
      validated = await validateOrBake(sourceWire, null);
    }
    if (validated.source.id !== id || validated.bake.meshId !== id) {
      throw new RangeError("worker returned a different custom mesh id");
    }
    if (
      validated.bake.version !== MESH_SDF_BAKE_VERSION ||
      validated.bake.resolution !== CUSTOM_MESH_SDF_RESOLUTION
    ) {
      throw new RangeError("worker returned the wrong custom mesh bake format");
    }
    if (regenerated) {
      if (!store.putBake) {
        throw new Error("derived SDF bake cannot be refreshed in this store");
      }
      await store.putBake(validated.bake);
    }
    const source = prepareWorkerValidatedCustomMeshAsset(validated.source);
    const bake = prepareSerializedMeshSdfBake(validated.bake, source);
    return { source, bake, bakeWire: validated.bake };
  } catch (error) {
    throw new CustomMeshAssetResolutionError(
      id,
      "invalid",
      error instanceof Error ? error.message : "validation failed",
    );
  }
}

/** Resolve every dependency before installing any of them. Missing/corrupt
 * entries therefore cannot leave a partially hydrated runtime or permit a
 * caller to commit half of a staged scene. */
export async function hydrateCustomMeshIds(
  ids: readonly CustomMeshAssetId[],
  store: CustomMeshAssetReader,
  validateOrBake: CustomMeshHydrationWorker = browserHydrationWorker,
): Promise<void> {
  const unique = [...new Set(ids)].sort();
  if (unique.length > MAX_CUSTOM_MESHES_PER_SCENE) {
    throw new RangeError(
      `custom mesh dependency set exceeds the ${MAX_CUSTOM_MESHES_PER_SCENE}-mesh budget`,
    );
  }
  // Refresh the target's resident members before installing its missing
  // members. The runtime cache holds two maximum-size scenes, so hydration
  // can never evict either the current scene or a resident part of the target
  // while the atomic barrier is still in flight.
  touchInstalledCustomMeshAssets(unique);
  const missing = unique.filter(
    (id) =>
      !hasMeshAsset(id) || !hasMeshSdfBake(id, CUSTOM_MESH_SDF_RESOLUTION),
  );
  const staged = await Promise.all(
    missing.map((id) => stageMesh(id, store, validateOrBake)),
  );
  const installed = staged.map((asset) => installCustomMeshAsset(asset.source));
  for (let index = 0; index < staged.length; index += 1) {
    const asset = staged[index];
    const installedSource = installed[index];
    const bake =
      installedSource === asset.source
        ? asset.bake
        : prepareSerializedMeshSdfBake(asset.bakeWire, installedSource);
    installPreparedMeshSdfBake(bake);
  }
}

export async function hydrateSceneCustomMeshes(
  snapshot: SceneSnapshot,
  store: CustomMeshStore | CustomMeshAssetReader,
  validateOrBake: CustomMeshHydrationWorker = browserHydrationWorker,
): Promise<void> {
  assertSceneCustomMeshBudget(snapshot);
  await hydrateCustomMeshIds(
    sceneCustomMeshIds(snapshot),
    store,
    validateOrBake,
  );
}
