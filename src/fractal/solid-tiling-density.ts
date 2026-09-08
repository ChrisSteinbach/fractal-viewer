import { shapeSdf } from "./shapes";
import { foldToChamber, type ResolvedFiniteTiling } from "./tiling";
import type { Vec3 } from "./types";
import { sampleVoxelAlpha } from "./voxel-raymarch";

/**
 * CPU authority for the finite Solid material's density query, including its
 * Balloon centre probe. Fold then clip before reading the canonical volume;
 * reads outside that volume are zero, exactly as in the shader.
 *
 * Balloon calls this field at p and I(p), so the fold is UNDER inversion.
 * 4D images are already projected into the installed volume and pass null:
 * no material-space fold may run after that dimensional reduction. Infinite
 * lattices are deliberately outside this helper's Balloon-safe domain.
 */
export function sampleSolidTiledVoxelAlpha(
  data: Uint8Array,
  size: number,
  boundsMin: Vec3,
  boundsMax: Vec3,
  p: Vec3,
  tiling: ResolvedFiniteTiling | null,
): number {
  if (!tiling) return sampleVoxelAlpha(data, size, boundsMin, boundsMax, p);
  if (tiling.info.dim !== 3) {
    throw new RangeError(
      "Solid density queries cannot fold a projected 4D volume",
    );
  }
  const q: Vec3 = [0, 0, 0];
  if (!foldToChamber(tiling.info, p, q)) return 0;
  if (tiling.clip && shapeSdf(tiling.clip, ...q) > 0) return 0;
  return sampleVoxelAlpha(data, size, boundsMin, boundsMax, q);
}
