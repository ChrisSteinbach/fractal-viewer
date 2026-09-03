/** Scene-level mesh dependency collection and aggregate budget checks. */
import {
  CUSTOM_MESH_SDF_RESOLUTION,
  MAX_CUSTOM_MESHES_PER_SCENE,
  MAX_CUSTOM_MESH_SDF_VOXELS,
} from "../fractal/custom-mesh";
import {
  isCustomMeshAssetId,
  type CustomMeshAssetId,
  type MeshAssetId,
} from "../fractal/mesh-shapes";
import { shapeMeshIds, type ShapeSpec } from "../fractal/shapes";
import type { Transform } from "../fractal/types";
import type { SceneSnapshot } from "./persist";

function transformShapes(transforms: readonly Transform[]): ShapeSpec[] {
  return transforms.flatMap((transform) =>
    transform.emitter ? [transform.emitter] : [],
  );
}

/** Every mesh reference in a document, de-duplicated and deterministically
 * ordered so the result is also suitable for dense scene-local slots. */
export function sceneMeshIds(snapshot: SceneSnapshot): MeshAssetId[] {
  const shapes: ShapeSpec[] = [
    ...transformShapes(snapshot.transforms),
    ...(snapshot.finalTransform?.emitter
      ? [snapshot.finalTransform.emitter]
      : []),
    ...(snapshot.schedule ? transformShapes(snapshot.schedule.transforms) : []),
    ...(snapshot.shapeTrap ? [snapshot.shapeTrap.shape] : []),
  ];
  const ids = new Set<MeshAssetId>();
  for (const shape of shapes) {
    for (const id of shapeMeshIds(shape)) ids.add(id);
  }
  return [...ids].sort();
}

export function sceneCustomMeshIds(
  snapshot: SceneSnapshot,
): CustomMeshAssetId[] {
  return sceneMeshIds(snapshot).filter(isCustomMeshAssetId);
}

export function sceneHasCustomMeshes(snapshot: SceneSnapshot): boolean {
  return sceneCustomMeshIds(snapshot).length > 0;
}

/** Enforce this release's explicit active custom-asset cap before a staged
 * snapshot or newly imported part is allowed to replace current state. */
export function assertSceneCustomMeshBudget(snapshot: SceneSnapshot): void {
  const count = sceneCustomMeshIds(snapshot).length;
  if (count > MAX_CUSTOM_MESHES_PER_SCENE) {
    throw new RangeError(
      `Scene uses ${count} custom meshes; the active limit is ${MAX_CUSTOM_MESHES_PER_SCENE}`,
    );
  }
  if (count * CUSTOM_MESH_SDF_RESOLUTION ** 3 > MAX_CUSTOM_MESH_SDF_VOXELS) {
    throw new RangeError(
      "Scene exceeds the active custom-mesh SDF voxel budget",
    );
  }
}
