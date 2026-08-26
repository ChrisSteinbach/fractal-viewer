import { describe, expect, it } from "vitest";
import {
  activeMeshSdfAtlas,
  canonicalMeshSdfAtlasIds,
} from "./mesh-sdf-atlas-cache";
import { MESH_ASSET_IDS, meshAssetCatalogIndex } from "./mesh-shapes";

describe("active mesh SDF atlas cache", () => {
  it("canonicalizes a de-duplicated active set in stable catalog order", () => {
    const reversedTwice = [...MESH_ASSET_IDS, ...MESH_ASSET_IDS].reverse();
    expect(canonicalMeshSdfAtlasIds(reversedTwice)).toEqual(MESH_ASSET_IDS);
  });

  it("reuses one compact atlas for equivalent sets and preserves catalog dispatch ids", () => {
    const reversedTwice = [...MESH_ASSET_IDS, ...MESH_ASSET_IDS].reverse();
    const atlas = activeMeshSdfAtlas(reversedTwice, 8);
    expect(activeMeshSdfAtlas(MESH_ASSET_IDS, 8)).toBe(atlas);
    expect(atlas.depth).toBe(MESH_ASSET_IDS.length * 8);
    expect(atlas.values).toHaveLength(MESH_ASSET_IDS.length * 8 ** 3);
    expect(
      atlas.entries.map(({ meshId, catalogIndex, zOffset }) => ({
        meshId,
        catalogIndex,
        zOffset,
      })),
    ).toEqual(
      MESH_ASSET_IDS.map((meshId, slabIndex) => ({
        meshId,
        catalogIndex: meshAssetCatalogIndex(meshId),
        zOffset: slabIndex * 8,
      })),
    );
  });

  it("refuses an empty active set instead of allocating the atlas fallback slab", () => {
    expect(() => activeMeshSdfAtlas([], 8)).toThrow(/at least one asset/);
  });
});
