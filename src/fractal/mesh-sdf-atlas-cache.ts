/**
 * Active-scene selection and caching for the built-in mesh SDF atlas.
 *
 * `mesh-shapes.ts` owns the bake and atlas layout. Renderers own WHICH
 * assets a frozen scene needs: passing the whole compile-time catalog there
 * makes an unrelated catalog addition tax every mesh-bearing scene. This
 * seam canonicalizes an active id SET in stable catalog order and caches the
 * resulting immutable CPU atlas by `(resolution, ids)`. Shader source and
 * texture upload can therefore ask independently and still receive the exact
 * same slab metadata and values.
 *
 * Empty sets are deliberately refused. Analytic sessions must branch before
 * this function, so they cannot accidentally turn `meshSdfAtlas([])`'s inert
 * one-slab representation into a real 3D texture upload.
 */
import {
  isCatalogMeshAssetId,
  meshAssetCatalogIndex,
  meshSdfAtlas,
  type MeshAssetId,
  type MeshSdfAtlas,
} from "./mesh-shapes";

const atlasCache = new Map<string, MeshSdfAtlas>();
export const MAX_MESH_SDF_ATLAS_CACHE_ENTRIES = 8;

/** De-duplicate ids and order them by their persistence-stable catalog id. */
export function canonicalMeshSdfAtlasIds(
  ids: readonly MeshAssetId[],
): MeshAssetId[] {
  return [...new Set(ids)].sort((a, b) => {
    const aCatalog = isCatalogMeshAssetId(a);
    const bCatalog = isCatalogMeshAssetId(b);
    if (aCatalog && bCatalog) {
      return meshAssetCatalogIndex(a) - meshAssetCatalogIndex(b);
    }
    if (aCatalog) return -1;
    if (bCatalog) return 1;
    return a.localeCompare(b);
  });
}

/** Dense shader selector for one id in the same canonical active set used by
 * the atlas. Refuses a missing id rather than generating a wrong slab call. */
export function meshSdfAtlasShaderIndex(
  ids: readonly MeshAssetId[],
  id: MeshAssetId,
): number {
  const index = canonicalMeshSdfAtlasIds(ids).indexOf(id);
  if (index < 0) throw new RangeError(`mesh ${id} is absent from the atlas`);
  return index;
}

/**
 * The one immutable atlas for a canonical active-id set at one resolution.
 * Callers must keep the empty-set branch outside this function (module doc).
 */
export function activeMeshSdfAtlas(
  ids: readonly MeshAssetId[],
  resolution = 64,
): MeshSdfAtlas {
  const canonicalIds = canonicalMeshSdfAtlasIds(ids);
  if (canonicalIds.length === 0) {
    throw new RangeError("an active mesh SDF atlas needs at least one asset");
  }
  const key = JSON.stringify([resolution, ...canonicalIds]);
  let atlas = atlasCache.get(key);
  if (atlas) {
    // Refresh insertion order: Map's first entry is the LRU victim below.
    atlasCache.delete(key);
    atlasCache.set(key, atlas);
  } else {
    atlas = meshSdfAtlas(canonicalIds, resolution);
    while (atlasCache.size >= MAX_MESH_SDF_ATLAS_CACHE_ENTRIES) {
      const oldest = atlasCache.keys().next().value;
      if (oldest === undefined) break;
      atlasCache.delete(oldest);
    }
    atlasCache.set(key, atlas);
  }
  return atlas;
}
