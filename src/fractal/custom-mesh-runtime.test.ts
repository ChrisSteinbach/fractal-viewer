import {
  hasMeshAsset,
  installCustomMeshAsset,
  MAX_CUSTOM_MESH_RUNTIME_ASSETS,
  meshAsset,
  pinCustomMeshAssets,
  prepareSerializedCustomMeshAsset,
  setPinnedCustomMeshAssets,
  touchInstalledCustomMeshAssets,
  uninstallCustomMeshAsset,
  type CustomMeshAssetId,
  type SerializedPreparedMeshAsset,
} from "./mesh-shapes";

function id(index: number): CustomMeshAssetId {
  return `mesh-sha256-${index.toString(16).padStart(64, "0")}`;
}

function source(index: number): SerializedPreparedMeshAsset {
  return {
    id: id(index),
    name: `Runtime mesh ${index}`,
    vertices: new Float64Array([1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1]),
    triangles: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
  };
}

function install(index: number): void {
  installCustomMeshAsset(prepareSerializedCustomMeshAsset(source(index)));
}

function clean(count = MAX_CUSTOM_MESH_RUNTIME_ASSETS * 2 + 1): void {
  setPinnedCustomMeshAssets([]);
  for (let index = 0; index < count; index += 1) {
    uninstallCustomMeshAsset(id(index));
  }
}

describe("custom mesh runtime retention", () => {
  afterEach(() => clean());

  it("keeps only the two-scene LRU working set", () => {
    for (let index = 0; index < MAX_CUSTOM_MESH_RUNTIME_ASSETS; index += 1) {
      install(index);
    }
    install(MAX_CUSTOM_MESH_RUNTIME_ASSETS);

    expect(hasMeshAsset(id(0))).toBe(false);
    expect(hasMeshAsset(id(1))).toBe(true);
    expect(hasMeshAsset(id(MAX_CUSTOM_MESH_RUNTIME_ASSETS))).toBe(true);
  });

  it("refreshes active entries and never evicts the authored pinned set", () => {
    for (let index = 0; index < MAX_CUSTOM_MESH_RUNTIME_ASSETS; index += 1) {
      install(index);
    }
    setPinnedCustomMeshAssets([id(0)]);
    touchInstalledCustomMeshAssets([id(1)]);
    install(MAX_CUSTOM_MESH_RUNTIME_ASSETS);

    expect(hasMeshAsset(id(0))).toBe(true);
    expect(hasMeshAsset(id(1))).toBe(true);
    expect(hasMeshAsset(id(2))).toBe(false);
  });

  it("does not let incidental geometry lookup diverge from explicit LRU touches", () => {
    for (let index = 0; index < MAX_CUSTOM_MESH_RUNTIME_ASSETS; index += 1) {
      install(index);
    }
    meshAsset(id(0));
    install(MAX_CUSTOM_MESH_RUNTIME_ASSETS);

    expect(hasMeshAsset(id(0))).toBe(false);
  });

  it("bounds concurrent leases and trims their temporary overlap on release", () => {
    const firstSet = Array.from(
      { length: MAX_CUSTOM_MESH_RUNTIME_ASSETS },
      (_, index) => id(index),
    );
    const secondSet = Array.from(
      { length: MAX_CUSTOM_MESH_RUNTIME_ASSETS },
      (_, index) => id(index + MAX_CUSTOM_MESH_RUNTIME_ASSETS),
    );
    for (let index = 0; index < MAX_CUSTOM_MESH_RUNTIME_ASSETS; index += 1) {
      install(index);
    }
    setPinnedCustomMeshAssets(firstSet);
    const release = pinCustomMeshAssets(secondSet);
    const nestedRelease = pinCustomMeshAssets(secondSet);
    for (
      let index = MAX_CUSTOM_MESH_RUNTIME_ASSETS;
      index < MAX_CUSTOM_MESH_RUNTIME_ASSETS * 2;
      index += 1
    ) {
      install(index);
    }

    expect(firstSet.every(hasMeshAsset)).toBe(true);
    expect(secondSet.every(hasMeshAsset)).toBe(true);
    expect(() => pinCustomMeshAssets([id(16)])).toThrow(
      /too many concurrent custom mesh working sets/,
    );

    release();
    release(); // idempotent; the nested lease still owns the set.
    expect(secondSet.every(hasMeshAsset)).toBe(true);
    nestedRelease();
    expect(firstSet.every(hasMeshAsset)).toBe(true);
    expect(secondSet.some(hasMeshAsset)).toBe(false);
  });
});
