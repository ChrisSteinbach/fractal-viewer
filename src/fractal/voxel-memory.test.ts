import {
  VOXEL_AVG_RGB_BYTES_PER_VOXEL,
  VOXEL_DENSITY_BYTES_PER_VOXEL,
  VOXEL_TEXTURE_BYTES_PER_VOXEL,
  clampVoxelResolutionToMemoryBudget,
  voxelResolutionMemory,
  voxelResolutionMemoryByteLength,
} from "./voxel-memory";

const MIB = 1024 * 1024;

describe("voxelResolutionMemory", () => {
  it("accounts for retained Float32 density/RGB, transient RGBA8, and the exact hierarchy", () => {
    const size = 64;
    const count = size ** 3;
    expect(voxelResolutionMemory(size)).toEqual({
      densityBytes: count * VOXEL_DENSITY_BYTES_PER_VOXEL,
      avgRgbBytes: count * VOXEL_AVG_RGB_BYTES_PER_VOXEL,
      textureRgbaBytes: count * VOXEL_TEXTURE_BYTES_PER_VOXEL,
      maxHierarchyBytes: 41_740,
      peakBytes: 5_284_620,
    });
  });

  it.each([
    [64, 41_740, 5_284_620],
    [96, 135_887, 17_830_607],
    [128, 316_365, 42_259_405],
    [160, 611_206, 82_531_206],
    [192, 1_048_560, 142_606_320],
    [224, 1_656_439, 226_444_919],
    [256, 2_463_054, 338_007_374],
    [288, 3_496_315, 481_253_755],
    [320, 4_784_487, 660_144_487],
    [352, 6_355_474, 878_639_634],
    [384, 8_237_617, 1_140_699_697],
    [416, 10_458_674, 1_450_284_594],
    [448, 13_047_064, 1_811_354_904],
    [480, 16_030_535, 2_227_870_535],
    [512, 19_437_647, 2_703_792_207],
  ])(
    "pins the exact stepped %i-cubed peak (%i hierarchy bytes)",
    (size, maxHierarchyBytes, peakBytes) => {
      expect(voxelResolutionMemory(size)).toMatchObject({
        maxHierarchyBytes,
        peakBytes,
      });
      expect(voxelResolutionMemoryByteLength(size)).toBe(peakBytes);
    },
  );

  it("rejects dimensions whose accounting would be ambiguous or unsafe", () => {
    expect(() => voxelResolutionMemory(0)).toThrow(RangeError);
    expect(() => voxelResolutionMemory(1.5)).toThrow(RangeError);
    expect(() => voxelResolutionMemory(Number.MAX_SAFE_INTEGER)).toThrow(
      RangeError,
    );
  });
});

describe("clampVoxelResolutionToMemoryBudget", () => {
  it("makes the hierarchy overhead visible at the old nominal policy boundaries", () => {
    expect(clampVoxelResolutionToMemoryBudget(512, 320 * MIB)).toBe(224);
    expect(clampVoxelResolutionToMemoryBudget(512, 2_560 * MIB)).toBe(480);
  });

  it("accepts a step at its exact peak and rejects it when one byte short", () => {
    const bytes256 = voxelResolutionMemoryByteLength(256);
    const bytes512 = voxelResolutionMemoryByteLength(512);
    expect(clampVoxelResolutionToMemoryBudget(512, bytes256)).toBe(256);
    expect(clampVoxelResolutionToMemoryBudget(512, bytes256 - 1)).toBe(224);
    expect(clampVoxelResolutionToMemoryBudget(512, bytes512)).toBe(512);
    expect(clampVoxelResolutionToMemoryBudget(512, bytes512 - 1)).toBe(480);
  });

  it("floors the request to the shared 32-resolution step", () => {
    expect(
      clampVoxelResolutionToMemoryBudget(511, Number.MAX_SAFE_INTEGER),
    ).toBe(480);
    expect(clampVoxelResolutionToMemoryBudget(64, 0)).toBe(32);
  });

  it("rejects invalid requests and budgets", () => {
    expect(() => clampVoxelResolutionToMemoryBudget(0, 1)).toThrow(RangeError);
    expect(() => clampVoxelResolutionToMemoryBudget(64, -1)).toThrow(
      RangeError,
    );
    expect(() => clampVoxelResolutionToMemoryBudget(64, Infinity)).toThrow(
      RangeError,
    );
  });
});
