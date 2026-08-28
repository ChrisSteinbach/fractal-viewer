import {
  CUSTOM_MESH_SDF_RESOLUTION,
  prepareCustomMeshObj,
} from "../fractal/custom-mesh";
import {
  hasMeshAsset,
  serializePreparedCustomMeshAsset,
  uninstallCustomMeshAsset,
  type CustomMeshAssetId,
} from "../fractal/mesh-shapes";
import { initialState } from "./state";
import { decodeScene, encodeScene, toSnapshot } from "./persist";
import {
  decodeImportFile,
  encodeCollectionFile,
  encodeSceneFile,
} from "./scene-file";
import { sceneCustomMeshIds } from "./scene-mesh-assets";
import {
  encodePortableMeshManifest,
  validatePortableMeshManifest,
} from "./portable-mesh-manifest";
import {
  importPortableCustomMeshSources,
  readPortableCustomMeshSources,
  type PortableMeshImportStore,
} from "./portable-mesh-transfer";
import { prepareCustomMeshWorkerRequest } from "./custom-mesh-worker-core";
import { SceneCollection, type SavedScene } from "./collection";
import { hydrateSceneCustomMeshes } from "./custom-mesh-hydrator";

const TETRA_OBJ = `
o Cross-profile tetra
v 1 1 1
v -1 -1 1
v -1 1 -1
v 1 -1 -1
f 1 3 2
f 1 2 4
f 1 4 3
f 2 3 4
`;

const cleanupIds = new Set<CustomMeshAssetId>();

async function portableSceneFixture() {
  const prepared = await prepareCustomMeshObj(TETRA_OBJ, "cross-profile.obj");
  cleanupIds.add(prepared.id);
  const source = serializePreparedCustomMeshAsset(prepared.asset);
  const snapshot = toSnapshot(initialState(false));
  snapshot.transforms[0] = {
    ...snapshot.transforms[0],
    emitter: {
      parts: [
        {
          primitive: { kind: "mesh", meshId: prepared.id },
          combine: "union",
        },
      ],
    },
  };
  const encoded = encodeScene(snapshot);
  const ids = sceneCustomMeshIds(snapshot);
  const sources = await readPortableCustomMeshSources(ids, {
    readSource: async (id) =>
      id === source.id
        ? { status: "found", value: structuredClone(source) }
        : { status: "missing" },
  });
  const assets = await encodePortableMeshManifest(sources, ids);
  return { assets, encoded, source };
}

function emptyProfileStore(
  writes: Array<{ sourceId: CustomMeshAssetId; resolution: number }>,
): PortableMeshImportStore {
  return {
    putSourcesAndInitialBakes: async (entries) => {
      writes.push(
        ...entries.map(({ source, bake }) => ({
          sourceId: source.id,
          resolution: bake.resolution,
        })),
      );
      return entries.map(() => "stored" as const);
    },
  };
}

async function installDecodedAssets(
  assets: NonNullable<ReturnType<typeof decodeImportFile>>["assets"],
  writes: Array<{ sourceId: CustomMeshAssetId; resolution: number }>,
): Promise<void> {
  if (assets === undefined) throw new Error("expected portable assets");
  const validated = await validatePortableMeshManifest(assets);
  if (validated === null) throw new Error("manifest digest validation failed");
  await importPortableCustomMeshSources(
    validated.sources,
    emptyProfileStore(writes),
    async (source) =>
      prepareCustomMeshWorkerRequest({
        type: "bake",
        jobId: 1,
        source,
        resolution: CUSTOM_MESH_SDF_RESOLUTION,
      }),
  );
}

afterEach(() => {
  for (const id of cleanupIds) uninstallCustomMeshAsset(id);
  cleanupIds.clear();
});

describe("portable custom-mesh cross-profile round trip", () => {
  it("exports a scene and installs its source before the empty profile loads it", async () => {
    const { assets, encoded, source } = await portableSceneFixture();
    const imported = decodeImportFile(encodeSceneFile(encoded, 123, assets));
    if (imported?.kind !== "scene") throw new Error("expected scene bundle");
    expect(hasMeshAsset(source.id)).toBe(false);
    const writes: Array<{ sourceId: CustomMeshAssetId; resolution: number }> =
      [];

    await installDecodedAssets(imported.assets, writes);

    expect(writes).toEqual([
      { sourceId: source.id, resolution: CUSTOM_MESH_SDF_RESOLUTION },
    ]);
    expect(hasMeshAsset(source.id)).toBe(true);
    const snapshot = decodeScene(imported.encoded);
    if (snapshot === null) throw new Error("imported scene did not decode");
    await expect(
      hydrateSceneCustomMeshes(snapshot, {
        readSource: async () => {
          throw new Error("installed portable source should not be reread");
        },
        readBake: async () => {
          throw new Error("installed portable bake should not be reread");
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("exports a collection with one copy of a repeatedly referenced mesh", async () => {
    const { assets, encoded, source } = await portableSceneFixture();
    const secondSnapshot = decodeScene(encoded);
    if (secondSnapshot === null)
      throw new Error("fixture scene did not decode");
    const secondEncoded = encodeScene({
      ...secondSnapshot,
      numPoints: secondSnapshot.numPoints + 1,
    });
    const scenes: SavedScene[] = [
      { id: "a", encoded, thumbnail: "", createdAt: 2 },
      { id: "b", encoded: secondEncoded, thumbnail: "", createdAt: 1 },
    ];
    const text = encodeCollectionFile(scenes, 123, assets);
    const raw = JSON.parse(text) as { assets: { geometries: unknown[] } };
    expect(raw.assets.geometries).toHaveLength(1);
    const imported = decodeImportFile(text);
    if (imported?.kind !== "collection") {
      throw new Error("expected collection bundle");
    }
    const writes: Array<{ sourceId: CustomMeshAssetId; resolution: number }> =
      [];

    await installDecodedAssets(imported.assets, writes);
    const stored = new Map<string, string>();
    const collection = new SceneCollection({
      storage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
      },
      now: () => 10,
    });
    expect(collection.importScenes(imported.scenes)).toBe(2);

    expect(writes).toEqual([
      { sourceId: source.id, resolution: CUSTOM_MESH_SDF_RESOLUTION },
    ]);
    expect(collection.all().map(({ encoded: scene }) => scene)).toEqual([
      encoded,
      secondEncoded,
    ]);
    expect(stored.size).toBe(1);
  });
});
