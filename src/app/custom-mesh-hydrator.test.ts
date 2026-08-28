import {
  bakePreparedMeshSdf,
  hasMeshAsset,
  prepareSerializedCustomMeshAsset,
  prepareSerializedMeshSdfBake,
  serializeMeshSdfBake,
  serializePreparedCustomMeshAsset,
  uninstallCustomMeshAsset,
  type CustomMeshAssetId,
} from "../fractal/mesh-shapes";
import { prepareCustomMeshObj } from "../fractal/custom-mesh";
import {
  CustomMeshAssetResolutionError,
  hydrateCustomMeshIds,
  type CustomMeshAssetReader,
  type CustomMeshHydrationWorker,
} from "./custom-mesh-hydrator";

const TETRA_OBJ = `
v 1 1 1
v -1 -1 1
v -1 1 -1
v 1 -1 -1
f 1 3 2
f 1 2 4
f 1 4 3
f 2 3 4
`;

const inlineWorker: CustomMeshHydrationWorker = async (
  sourceWire,
  bakeWire,
) => {
  const source = prepareSerializedCustomMeshAsset(sourceWire);
  const bake = bakeWire
    ? prepareSerializedMeshSdfBake(bakeWire, source)
    : bakePreparedMeshSdf(source, 8);
  return {
    source: serializePreparedCustomMeshAsset(source),
    bake: serializeMeshSdfBake(bake),
  };
};

describe("custom mesh hydration barrier", () => {
  it("installs validated source and bake only after the whole set stages", async () => {
    const prepared = await prepareCustomMeshObj(TETRA_OBJ);
    const source = serializePreparedCustomMeshAsset(prepared.asset);
    const bake = serializeMeshSdfBake(bakePreparedMeshSdf(prepared.asset, 8));
    const missing: CustomMeshAssetId = `mesh-sha256-${"f".repeat(64)}`;
    const store: CustomMeshAssetReader = {
      readSource: async (id) =>
        id === source.id
          ? { status: "found", value: source }
          : { status: "missing" },
      readBake: async (id) =>
        id === bake.meshId
          ? { status: "found", value: bake }
          : { status: "missing" },
    };

    await expect(
      hydrateCustomMeshIds([source.id, missing], store, inlineWorker),
    ).rejects.toBeInstanceOf(CustomMeshAssetResolutionError);
    expect(hasMeshAsset(source.id)).toBe(false);

    await hydrateCustomMeshIds([source.id], store, inlineWorker);
    expect(hasMeshAsset(source.id)).toBe(true);
    uninstallCustomMeshAsset(source.id);
  });

  it("rebinds staged bakes when concurrent hydration installs the same id", async () => {
    const prepared = await prepareCustomMeshObj(TETRA_OBJ);
    const source = serializePreparedCustomMeshAsset(prepared.asset);
    const bake = serializeMeshSdfBake(bakePreparedMeshSdf(prepared.asset, 8));
    const store: CustomMeshAssetReader = {
      readSource: async () => ({ status: "found", value: source }),
      readBake: async () => ({ status: "found", value: bake }),
    };

    await Promise.all([
      hydrateCustomMeshIds([source.id], store, inlineWorker),
      hydrateCustomMeshIds([source.id], store, inlineWorker),
    ]);

    expect(hasMeshAsset(source.id)).toBe(true);
    uninstallCustomMeshAsset(source.id);
  });

  it("regenerates and persists a missing derived bake", async () => {
    const prepared = await prepareCustomMeshObj(TETRA_OBJ);
    const source = serializePreparedCustomMeshAsset(prepared.asset);
    let storedBake = null as ReturnType<typeof serializeMeshSdfBake> | null;
    const store: CustomMeshAssetReader = {
      readSource: async () => ({ status: "found", value: source }),
      readBake: async () => ({ status: "missing" }),
      putBake: async (bake) => {
        storedBake = bake;
      },
    };

    await hydrateCustomMeshIds([source.id], store, inlineWorker);

    expect(storedBake?.meshId).toBe(source.id);
    expect(hasMeshAsset(source.id)).toBe(true);
    uninstallCustomMeshAsset(source.id);
  });

  it("rejects aggregate dependency sets above the scene budget before reading storage", async () => {
    const store: CustomMeshAssetReader = {
      readSource: vi.fn(),
      readBake: vi.fn(),
    };
    const ids = Array.from(
      { length: 5 },
      (_, index): CustomMeshAssetId =>
        `mesh-sha256-${String(index).repeat(64)}`,
    );

    await expect(
      hydrateCustomMeshIds(ids, store, inlineWorker),
    ).rejects.toThrow(/4-mesh budget/);
    expect(store.readSource).not.toHaveBeenCalled();
  });
});
