/**
 * Conservative empty-space hierarchy for Solid's packed density volume.
 *
 * The renderer reconstructs RGBA8 alpha with hardware trilinear filtering.
 * Inside one interpolation cell that density is a convex combination of its
 * (at most) eight texel values, so its maximum is exactly the maximum corner
 * byte. The texture domain contains `size + 1` such cells per axis: one
 * clamped half-cell at each boundary and `size - 1` full cells between texel
 * centres. This module max-pools those CONTINUOUS cells, rather than merely
 * pooling disjoint texel-centre blocks whose seams would miss shared support.
 *
 * The first stored level covers two interpolation cells per axis. The source
 * RGBA8 volume remains the leaf representation, so omitting the redundant
 * one-byte-per-cell level keeps the added payload close to one seventh of a
 * byte per source voxel. Every later level max-pools 2x2x2 children until one
 * root remains. A node whose normalized max is not strictly above the live
 * threshold certifies its entire represented region as empty without a
 * threshold-specific rebuild.
 *
 * Construction is deliberately all-or-nothing and pure. A caller that cannot
 * allocate the returned byte array catches the allocation failure and omits
 * acceleration; the packed density texture and unaccelerated marcher remain a
 * complete rendering path.
 */

import type { Vec3 } from "./types";

/** Coarse level shared by the CPU oracle, GPU upload, and shader traversal. */
export const VOXEL_MAX_HIERARCHY_TRAVERSAL_CELL_SPAN = 16;

/** One cubic, x-fastest level inside {@link VoxelMaxHierarchy.data}. */
export interface VoxelMaxHierarchyLevel {
  /** Nodes per axis. */
  size: number;
  /** Byte offset of this level in the concatenated payload. */
  offset: number;
  /** `size ** 3`; one max-alpha byte per node. */
  length: number;
  /** Number of base interpolation cells represented per axis by one node. */
  cellSpan: number;
}

/** Compact max-alpha levels ready for an immutable worker transfer. */
export interface VoxelMaxHierarchy {
  sourceSize: number;
  /** Concatenated alpha-only levels, each x-fastest. */
  data: Uint8Array<ArrayBuffer>;
  levels: readonly VoxelMaxHierarchyLevel[];
  /** Exact transferable payload bytes (`data.byteLength`). */
  byteLength: number;
}

export interface VoxelMaxHierarchyNodeBounds {
  /** Inclusive lower normalized texture-domain corner. */
  min: Vec3;
  /** Inclusive upper normalized texture-domain corner. */
  max: Vec3;
}

function positiveIntegerSize(size: number): void {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError("voxel hierarchy size must be a positive integer");
  }
}

function checkedCube(size: number): number {
  const length = size * size * size;
  if (!Number.isSafeInteger(length)) {
    throw new RangeError("voxel hierarchy dimensions exceed safe indexing");
  }
  return length;
}

function hierarchyLayout(size: number): VoxelMaxHierarchyLevel[] {
  positiveIntegerSize(size);
  const baseCells = size + 1;
  if (!Number.isSafeInteger(baseCells)) {
    throw new RangeError("voxel hierarchy dimensions exceed safe indexing");
  }

  const levels: VoxelMaxHierarchyLevel[] = [];
  let cellSpan = 2;
  let offset = 0;
  while (true) {
    const levelSize = Math.ceil(baseCells / cellSpan);
    const length = checkedCube(levelSize);
    if (!Number.isSafeInteger(offset + length)) {
      throw new RangeError("voxel hierarchy payload exceeds safe indexing");
    }
    levels.push({ size: levelSize, offset, length, cellSpan });
    offset += length;
    if (levelSize === 1) break;
    cellSpan *= 2;
  }
  return levels;
}

/** Exact alpha payload size for a `size` cubed source volume. */
export function voxelMaxHierarchyByteLength(size: number): number {
  const levels = hierarchyLayout(size);
  const last = levels[levels.length - 1];
  return last.offset + last.length;
}

function baseCellAtUv(size: number, uv: number): number {
  return Math.max(0, Math.min(size, Math.floor(uv * size + 0.5)));
}

function validUv(uv: Vec3): void {
  if (uv.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RangeError("voxel hierarchy coordinates must be in [0, 1]");
  }
}

/**
 * Locate the hierarchy node containing a normalized texture coordinate.
 * Boundary ties choose the cell on the positive side; both cells contain the
 * shared texel-centre plane and therefore carry a conservative equal bound.
 */
export function voxelMaxHierarchyNodeAtUv(
  sourceSize: number,
  level: VoxelMaxHierarchyLevel,
  uv: Vec3,
): Vec3 {
  positiveIntegerSize(sourceSize);
  validUv(uv);
  return uv.map((value) =>
    Math.min(
      level.size - 1,
      Math.floor(baseCellAtUv(sourceSize, value) / level.cellSpan),
    ),
  ) as Vec3;
}

function baseCellLowerUv(sourceSize: number, cell: number): number {
  return cell === 0 ? 0 : (cell - 0.5) / sourceSize;
}

function baseCellUpperUv(sourceSize: number, cell: number): number {
  return cell === sourceSize ? 1 : (cell + 0.5) / sourceSize;
}

/** Exact continuous texture-domain region represented by one node. */
export function voxelMaxHierarchyNodeBounds(
  sourceSize: number,
  level: VoxelMaxHierarchyLevel,
  node: Vec3,
): VoxelMaxHierarchyNodeBounds {
  positiveIntegerSize(sourceSize);
  if (
    node.some(
      (value) => !Number.isInteger(value) || value < 0 || value >= level.size,
    )
  ) {
    throw new RangeError("voxel hierarchy node is outside its level");
  }
  const axisBounds = (coordinate: number): [number, number] => {
    const firstCell = coordinate * level.cellSpan;
    const lastCell = Math.min(sourceSize, firstCell + level.cellSpan - 1);
    return [
      baseCellLowerUv(sourceSize, firstCell),
      baseCellUpperUv(sourceSize, lastCell),
    ];
  };
  const x = axisBounds(node[0]);
  const y = axisBounds(node[1]);
  const z = axisBounds(node[2]);
  return {
    min: [x[0], y[0], z[0]],
    max: [x[1], y[1], z[1]],
  };
}

/** Read one packed node max with coordinate validation. */
export function voxelMaxHierarchyNodeValue(
  hierarchy: VoxelMaxHierarchy,
  levelIndex: number,
  node: Vec3,
): number {
  const level = hierarchy.levels[levelIndex];
  if (!level) throw new RangeError("voxel hierarchy level does not exist");
  if (
    node.some(
      (value) => !Number.isInteger(value) || value < 0 || value >= level.size,
    )
  ) {
    throw new RangeError("voxel hierarchy node is outside its level");
  }
  return hierarchy.data[
    level.offset +
      node[0] +
      node[1] * level.size +
      node[2] * level.size * level.size
  ];
}

/**
 * Whether a node certifies empty space for the shader's strict `>` hit test.
 * Both operands are rounded to the highp-float values an R8 texture sample
 * and uniform comparison use, preserving equality as safely outside.
 */
export function voxelMaxHierarchyNodeIsEmpty(
  maxAlpha: number,
  threshold: number,
): boolean {
  if (!Number.isInteger(maxAlpha) || maxAlpha < 0 || maxAlpha > 255) {
    throw new RangeError("voxel hierarchy max alpha must be a byte");
  }
  if (!Number.isFinite(threshold)) {
    throw new RangeError("voxel hierarchy threshold must be finite");
  }
  return Math.fround(maxAlpha / 255) <= Math.fround(threshold);
}

/**
 * Build the threshold-independent hierarchy from `voxelTextureData` RGBA8.
 * The source alpha bytes are the exact values hardware reconstructs, so no
 * raw-count/log-normalization approximation enters the certificate.
 */
export function buildVoxelMaxHierarchy(
  packedRgba: Uint8Array,
  size: number,
): VoxelMaxHierarchy {
  positiveIntegerSize(size);
  const sourceTexels = checkedCube(size);
  const sourceBytes = sourceTexels * 4;
  if (!Number.isSafeInteger(sourceBytes) || packedRgba.length < sourceBytes) {
    throw new RangeError(
      "packed voxel texture is shorter than size^3 RGBA texels",
    );
  }

  const levels = hierarchyLayout(size);
  const byteLength = voxelMaxHierarchyByteLength(size);
  const data = new Uint8Array(byteLength);
  const first = levels[0];

  // One first-level node covers two base interpolation cells on each axis.
  // The union of those cells' corner support is a contiguous range of at
  // most three source texels per axis (smaller at the clamped boundaries).
  for (let z = 0; z < first.size; z++) {
    const zCell0 = z * first.cellSpan;
    const zCell1 = Math.min(size, zCell0 + first.cellSpan - 1);
    const z0 = Math.max(0, zCell0 - 1);
    const z1 = Math.min(size - 1, zCell1);
    for (let y = 0; y < first.size; y++) {
      const yCell0 = y * first.cellSpan;
      const yCell1 = Math.min(size, yCell0 + first.cellSpan - 1);
      const y0 = Math.max(0, yCell0 - 1);
      const y1 = Math.min(size - 1, yCell1);
      for (let x = 0; x < first.size; x++) {
        const xCell0 = x * first.cellSpan;
        const xCell1 = Math.min(size, xCell0 + first.cellSpan - 1);
        const x0 = Math.max(0, xCell0 - 1);
        const x1 = Math.min(size - 1, xCell1);
        let maxAlpha = 0;
        for (let sourceZ = z0; sourceZ <= z1; sourceZ++) {
          for (let sourceY = y0; sourceY <= y1; sourceY++) {
            let source = (x0 + sourceY * size + sourceZ * size * size) * 4 + 3;
            for (let sourceX = x0; sourceX <= x1; sourceX++) {
              maxAlpha = Math.max(maxAlpha, packedRgba[source]);
              source += 4;
            }
          }
        }
        data[first.offset + x + y * first.size + z * first.size * first.size] =
          maxAlpha;
      }
    }
  }

  // Later levels are ordinary ceil-edged 2x max reductions over the exact
  // continuous-region maxima immediately below them.
  for (let levelIndex = 1; levelIndex < levels.length; levelIndex++) {
    const previous = levels[levelIndex - 1];
    const level = levels[levelIndex];
    for (let z = 0; z < level.size; z++) {
      for (let y = 0; y < level.size; y++) {
        for (let x = 0; x < level.size; x++) {
          let maxAlpha = 0;
          for (let dz = 0; dz < 2; dz++) {
            const childZ = z * 2 + dz;
            if (childZ >= previous.size) continue;
            for (let dy = 0; dy < 2; dy++) {
              const childY = y * 2 + dy;
              if (childY >= previous.size) continue;
              for (let dx = 0; dx < 2; dx++) {
                const childX = x * 2 + dx;
                if (childX >= previous.size) continue;
                maxAlpha = Math.max(
                  maxAlpha,
                  data[
                    previous.offset +
                      childX +
                      childY * previous.size +
                      childZ * previous.size * previous.size
                  ],
                );
              }
            }
          }
          data[
            level.offset + x + y * level.size + z * level.size * level.size
          ] = maxAlpha;
        }
      }
    }
  }

  return {
    sourceSize: size,
    data,
    levels,
    byteLength: data.byteLength,
  };
}
