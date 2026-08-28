/** Durable/runtime transfer barrier for portable custom-mesh bundles. */
import {
  CUSTOM_MESH_SDF_RESOLUTION,
  MAX_CUSTOM_MESHES_PER_SCENE,
} from "../fractal/custom-mesh";
import {
  hasMeshAsset,
  installCustomMeshAsset,
  installPreparedMeshSdfBake,
  installSerializedCustomMeshAsset,
  prepareSerializedMeshSdfBake,
  prepareWorkerValidatedCustomMeshAsset,
  type CustomMeshAssetId,
  type MeshSdfBake,
  type PreparedMeshAsset,
  type SerializedMeshSdfBake,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";
import { rebakeCustomMeshSource } from "./custom-mesh-importer";
import type {
  CustomMeshPutResult,
  CustomMeshReadResult,
  CustomMeshSourceAndBake,
} from "./custom-mesh-store";

export interface PortableMeshSourceReader {
  readSource(
    id: CustomMeshAssetId,
  ): Promise<CustomMeshReadResult<SerializedPreparedMeshAsset>>;
}

export interface PortableMeshImportStore {
  putSourcesAndInitialBakes(
    entries: readonly CustomMeshSourceAndBake[],
  ): Promise<readonly CustomMeshPutResult[]>;
}

export interface ValidatedPortableMeshSource {
  readonly source: SerializedPreparedMeshAsset;
  readonly bake: SerializedMeshSdfBake;
}

export type PortableMeshSourceValidator = (
  source: SerializedPreparedMeshAsset,
) => Promise<ValidatedPortableMeshSource>;

/** Each validation also constructs a BVH and a 64^3 bake. Keep CPU and peak
 * allocation bounded even though the manifest itself permits four sources. */
export const PORTABLE_MESH_VALIDATION_CONCURRENCY = 2;

export class PortableMeshImportCancelledError extends Error {
  constructor() {
    super("Portable mesh import was superseded");
    this.name = "PortableMeshImportCancelledError";
  }
}

const browserSourceValidator: PortableMeshSourceValidator = (source) =>
  rebakeCustomMeshSource(source, CUSTOM_MESH_SDF_RESOLUTION).promise;

function uniquePortableIds(
  ids: readonly CustomMeshAssetId[],
): CustomMeshAssetId[] {
  const unique = [...new Set(ids)].sort();
  if (unique.length > MAX_CUSTOM_MESHES_PER_SCENE) {
    throw new RangeError(
      `portable bundle exceeds the ${MAX_CUSTOM_MESHES_PER_SCENE}-mesh asset budget`,
    );
  }
  return unique;
}

/** Read one independently owned, digest-checked source wire per referenced id.
 * Collection/timeline callers pass their aggregate reference union, so an
 * export never succeeds with a dependency that exists only in one profile. */
export async function readPortableCustomMeshSources(
  ids: readonly CustomMeshAssetId[],
  store: PortableMeshSourceReader,
): Promise<SerializedPreparedMeshAsset[]> {
  const unique = uniquePortableIds(ids);
  return Promise.all(
    unique.map(async (id) => {
      const result = await store.readSource(id);
      if (result.status === "found") {
        if (result.value.id !== id) {
          throw new Error(`Local mesh ${id} source geometry has the wrong id`);
        }
        return result.value;
      }
      if (result.status === "missing") {
        throw new Error(`Local mesh ${id} source geometry is missing`);
      }
      throw new Error(
        `Local mesh ${id} source geometry is corrupt: ${result.reason}`,
      );
    }),
  );
}

interface StagedPortableMesh {
  readonly prepared: PreparedMeshAsset;
  readonly bake: MeshSdfBake;
  readonly sourceWire: SerializedPreparedMeshAsset;
  readonly bakeWire: SerializedMeshSdfBake;
}

/** Validate and bake every manifest source before mutating IndexedDB or the
 * runtime registries, commit every source+bake in one durable transaction,
 * and only then install the complete staged set. Document publication belongs
 * after this promise resolves. */
export async function importPortableCustomMeshSources(
  sources: readonly SerializedPreparedMeshAsset[],
  store: PortableMeshImportStore,
  validate: PortableMeshSourceValidator = browserSourceValidator,
  stillCurrent: () => boolean = () => true,
): Promise<void> {
  const requireCurrent = (): void => {
    if (!stillCurrent()) throw new PortableMeshImportCancelledError();
  };
  requireCurrent();
  const ids = sources.map((source) => source.id);
  const unique = uniquePortableIds(ids);
  if (unique.length !== sources.length) {
    throw new RangeError("portable mesh manifest contains duplicate assets");
  }

  const validated: ValidatedPortableMeshSource[] = [];
  for (
    let offset = 0;
    offset < sources.length;
    offset += PORTABLE_MESH_VALIDATION_CONCURRENCY
  ) {
    requireCurrent();
    validated.push(
      ...(await Promise.all(
        sources
          .slice(offset, offset + PORTABLE_MESH_VALIDATION_CONCURRENCY)
          .map((source) => validate(source)),
      )),
    );
    requireCurrent();
  }
  const staged: StagedPortableMesh[] = validated.map(
    ({ source, bake }, index) => {
      const expectedId = sources[index].id;
      if (source.id !== expectedId || bake.meshId !== expectedId) {
        throw new RangeError(
          "mesh worker returned a different portable asset id",
        );
      }
      const prepared = prepareWorkerValidatedCustomMeshAsset(source);
      // An already-installed source is immutable too. This call compares its
      // full geometry without mutating the registry when it already exists.
      const bakeSource = hasMeshAsset(source.id)
        ? installSerializedCustomMeshAsset(source)
        : prepared;
      const preparedBake = prepareSerializedMeshSdfBake(bake, bakeSource);
      return {
        prepared,
        bake: preparedBake,
        sourceWire: source,
        bakeWire: bake,
      };
    },
  );

  requireCurrent();
  await store.putSourcesAndInitialBakes(
    staged.map(({ sourceWire: source, bakeWire: bake }) => ({ source, bake })),
  );
  requireCurrent();

  for (const asset of staged) {
    const installed = installCustomMeshAsset(asset.prepared);
    const bake =
      installed === asset.prepared
        ? asset.bake
        : prepareSerializedMeshSdfBake(asset.bakeWire, installed);
    installPreparedMeshSdfBake(bake);
  }
}
