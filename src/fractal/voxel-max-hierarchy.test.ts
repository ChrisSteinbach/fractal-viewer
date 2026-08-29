import {
  buildVoxelMaxHierarchy,
  voxelMaxHierarchyByteLength,
  voxelMaxHierarchyNodeAtUv,
  voxelMaxHierarchyNodeBounds,
  voxelMaxHierarchyNodeIsEmpty,
  voxelMaxHierarchyNodeValue,
} from "./voxel-max-hierarchy";
import { samplePackedVoxelDensity } from "./voxel-raymarch";

interface ReferenceLevel {
  size: number;
  cellSpan: number;
  data: Uint8Array;
}

function packedVolume(
  size: number,
  alphaAt: (x: number, y: number, z: number) => number,
): Uint8Array {
  const data = new Uint8Array(size * size * size * 4);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const offset = (x + y * size + z * size * size) * 4;
        // Non-alpha bytes are deliberately nonzero: hierarchy maxima are a
        // density contract and must not accidentally pool an RGB channel.
        data[offset] = (x * 41 + y * 17 + z * 7 + 3) & 0xff;
        data[offset + 1] = (x * 11 + y * 53 + z * 19 + 5) & 0xff;
        data[offset + 2] = (x * 29 + y * 13 + z * 47 + 9) & 0xff;
        data[offset + 3] = alphaAt(x, y, z);
      }
    }
  }
  return data;
}

/** Source texels whose trilinear support meets one base interpolation cell. */
function baseCellSupport(cell: number, sourceSize: number): number[] {
  if (cell === 0) return [0];
  if (cell === sourceSize) return [sourceSize - 1];
  return [cell - 1, cell];
}

function referenceBaseCells(packedRgba: Uint8Array, size: number): Uint8Array {
  const baseSize = size + 1;
  const base = new Uint8Array(baseSize * baseSize * baseSize);
  for (let z = 0; z < baseSize; z++) {
    for (let y = 0; y < baseSize; y++) {
      for (let x = 0; x < baseSize; x++) {
        let max = 0;
        for (const tz of baseCellSupport(z, size)) {
          for (const ty of baseCellSupport(y, size)) {
            for (const tx of baseCellSupport(x, size)) {
              max = Math.max(
                max,
                packedRgba[(tx + ty * size + tz * size * size) * 4 + 3],
              );
            }
          }
        }
        base[x + y * baseSize + z * baseSize * baseSize] = max;
      }
    }
  }
  return base;
}

/**
 * Independent direct pooling reference. Every stored level pools its whole
 * represented base-cell region rather than recursively using the prior one.
 */
function referenceLevels(
  packedRgba: Uint8Array,
  sourceSize: number,
): ReferenceLevel[] {
  const baseSize = sourceSize + 1;
  const base = referenceBaseCells(packedRgba, sourceSize);
  const levels: ReferenceLevel[] = [];
  for (
    let cellSpan = 2, size = Math.ceil(baseSize / cellSpan);
    ;
    cellSpan *= 2, size = Math.ceil(baseSize / cellSpan)
  ) {
    const data = new Uint8Array(size * size * size);
    for (let z = 0; z < size; z++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let max = 0;
          for (
            let bz = z * cellSpan;
            bz < Math.min((z + 1) * cellSpan, baseSize);
            bz++
          ) {
            for (
              let by = y * cellSpan;
              by < Math.min((y + 1) * cellSpan, baseSize);
              by++
            ) {
              for (
                let bx = x * cellSpan;
                bx < Math.min((x + 1) * cellSpan, baseSize);
                bx++
              ) {
                max = Math.max(
                  max,
                  base[bx + by * baseSize + bz * baseSize * baseSize],
                );
              }
            }
          }
          data[x + y * size + z * size * size] = max;
        }
      }
    }
    levels.push({ size, cellSpan, data });
    if (size === 1) return levels;
  }
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("buildVoxelMaxHierarchy layout", () => {
  it("packs deterministic x-fastest levels with exact offsets and byte accounting", () => {
    const size = 4;
    const packed = packedVolume(
      size,
      (x, y, z) => (x * 67 + y * 29 + z * 13) & 0xff,
    );
    const first = buildVoxelMaxHierarchy(packed, size);
    const second = buildVoxelMaxHierarchy(packed, size);
    const reference = referenceLevels(packed, size);

    expect(first).toMatchObject({
      sourceSize: 4,
      byteLength: 36,
      levels: [
        { size: 3, offset: 0, length: 27, cellSpan: 2 },
        { size: 2, offset: 27, length: 8, cellSpan: 4 },
        { size: 1, offset: 35, length: 1, cellSpan: 8 },
      ],
    });
    expect(first.data).toEqual(second.data);
    expect(first.data.length).toBe(first.byteLength);
    expect(first.data).toEqual(
      new Uint8Array(reference.flatMap((level) => [...level.data])),
    );
    expect(voxelMaxHierarchyByteLength(size)).toBe(first.byteLength);
  });

  it("accounts for odd and even source sizes from first pooled cells through the root", () => {
    const expected = new Map([
      [1, { sizes: [1], bytes: 1 }],
      [2, { sizes: [2, 1], bytes: 9 }],
      [3, { sizes: [2, 1], bytes: 9 }],
      [4, { sizes: [3, 2, 1], bytes: 36 }],
      [5, { sizes: [3, 2, 1], bytes: 36 }],
      [6, { sizes: [4, 2, 1], bytes: 73 }],
    ]);

    for (const [size, contract] of expected) {
      const hierarchy = buildVoxelMaxHierarchy(
        packedVolume(size, () => 0),
        size,
      );
      expect(hierarchy.levels.map((level) => level.size)).toEqual(
        contract.sizes,
      );
      expect(hierarchy.byteLength).toBe(contract.bytes);
      expect(voxelMaxHierarchyByteLength(size)).toBe(contract.bytes);
    }
  });

  it("rejects invalid dimensions and undersized RGBA storage", () => {
    for (const size of [0, -1, 1.5, Number.NaN]) {
      expect(() => voxelMaxHierarchyByteLength(size)).toThrow(RangeError);
      expect(() => buildVoxelMaxHierarchy(new Uint8Array(), size)).toThrow(
        RangeError,
      );
    }
    expect(() =>
      buildVoxelMaxHierarchy(new Uint8Array(2 * 2 * 2 * 4 - 1), 2),
    ).toThrow(RangeError);

    const hierarchy = buildVoxelMaxHierarchy(
      packedVolume(2, () => 0),
      2,
    );
    const level = hierarchy.levels[0];
    expect(() => voxelMaxHierarchyNodeAtUv(2, level, [-0.01, 0, 0])).toThrow(
      RangeError,
    );
    expect(() => voxelMaxHierarchyNodeBounds(2, level, [2, 0, 0])).toThrow(
      RangeError,
    );
    expect(() => voxelMaxHierarchyNodeValue(hierarchy, 99, [0, 0, 0])).toThrow(
      RangeError,
    );
    expect(() => voxelMaxHierarchyNodeIsEmpty(256, 0.5)).toThrow(RangeError);
    expect(() => voxelMaxHierarchyNodeIsEmpty(0, Number.NaN)).toThrow(
      RangeError,
    );
  });
});

describe("buildVoxelMaxHierarchy conservative support", () => {
  it("keeps boundary half-cells and the isolated last-corner texel's interpolation halo", () => {
    const size = 4;
    const packed = packedVolume(size, (x, y, z) =>
      x === size - 1 && y === size - 1 && z === size - 1 ? 231 : 0,
    );
    const hierarchy = buildVoxelMaxHierarchy(packed, size);

    // The last texel supports base cells 3 and 4 on every axis. First-level
    // pooling therefore conservatively marks node coordinates 1 and 2, not
    // just the node containing the texel center itself.
    for (let z = 0; z < 3; z++) {
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          expect(voxelMaxHierarchyNodeValue(hierarchy, 0, [x, y, z])).toBe(
            x >= 1 && y >= 1 && z >= 1 ? 231 : 0,
          );
        }
      }
    }
    expect(hierarchy.data[hierarchy.levels.at(-1)!.offset]).toBe(231);
  });

  it("matches direct continuous-cell maxima for a one-texel-thin diagonal", () => {
    const size = 7;
    const packed = packedVolume(size, (x, y, z) =>
      x === y && y === z ? 197 : 0,
    );
    const hierarchy = buildVoxelMaxHierarchy(packed, size);
    const reference = referenceLevels(packed, size);

    expect(hierarchy.levels).toHaveLength(reference.length);
    for (let i = 0; i < reference.length; i++) {
      const level = hierarchy.levels[i];
      expect(level).toMatchObject({
        size: reference[i].size,
        length: reference[i].data.length,
        cellSpan: reference[i].cellSpan,
      });
      expect(
        hierarchy.data.slice(level.offset, level.offset + level.length),
      ).toEqual(reference[i].data);
    }
  });

  it("makes strict-threshold skipping safe at zero, equality, and one", () => {
    expect(voxelMaxHierarchyNodeIsEmpty(0, 0)).toBe(true);
    expect(voxelMaxHierarchyNodeIsEmpty(1, 0)).toBe(false);
    expect(voxelMaxHierarchyNodeIsEmpty(128, 128 / 255)).toBe(true);
    expect(voxelMaxHierarchyNodeIsEmpty(128, 128 / 255 - 1e-6)).toBe(false);
    expect(voxelMaxHierarchyNodeIsEmpty(255, 1)).toBe(true);
    expect(voxelMaxHierarchyNodeIsEmpty(255, 1 - 1e-6)).toBe(false);

    const hierarchy = buildVoxelMaxHierarchy(
      packedVolume(1, () => 128),
      1,
    );
    expect(hierarchy.data).toEqual(new Uint8Array([128]));
  });

  it("bounds randomized trilinear samples by their containing node at every level", () => {
    for (const size of [1, 2, 3, 4, 5, 7]) {
      const random = lcg(0x9e3779b9 ^ size);
      const packed = packedVolume(size, () => Math.floor(random() * 256));
      const hierarchy = buildVoxelMaxHierarchy(packed, size);
      const points = [
        [0, 0, 0],
        [1, 1, 1],
        [0.5 / size, 0.5 / size, 0.5 / size],
        [1 - 0.5 / size, 1 - 0.5 / size, 1 - 0.5 / size],
      ];
      for (let i = 0; i < 256; i++) {
        points.push([random(), random(), random()]);
      }

      for (const uvw of points) {
        const density = samplePackedVoxelDensity(
          {
            data: packed,
            size,
            boundsMin: [0, 0, 0],
            boundsMax: [1, 1, 1],
          },
          uvw as [number, number, number],
        );
        for (
          let levelIndex = 0;
          levelIndex < hierarchy.levels.length;
          levelIndex++
        ) {
          const level = hierarchy.levels[levelIndex];
          const node = voxelMaxHierarchyNodeAtUv(
            size,
            level,
            uvw as [number, number, number],
          );
          const bounds = voxelMaxHierarchyNodeBounds(size, level, node);
          for (let axis = 0; axis < 3; axis++) {
            expect(uvw[axis]).toBeGreaterThanOrEqual(bounds.min[axis]);
            expect(uvw[axis]).toBeLessThanOrEqual(bounds.max[axis]);
          }
          const maxDensity =
            voxelMaxHierarchyNodeValue(hierarchy, levelIndex, node) / 255;
          expect(density).toBeLessThanOrEqual(maxDensity + 1e-12);
        }
      }
    }
  });
});
