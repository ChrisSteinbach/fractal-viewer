import { toTransform4 } from "./affine4";
import { prepareChaosGame } from "./chaos-game";
import { prepareChaosGame4 } from "./chaos-game-4d";
import {
  UNIFORM_POINT_COLOR,
  W_SIDE_PALETTES,
  buildColorModeLUT,
  transformColors,
  type FourDRenderColor,
} from "./color";
import { buildPaletteLUT } from "./palette";
import { composeRotorProjection4, type FourDView } from "./project4";
import { pentatope, sierpinskiTetrahedron } from "./presets";
import { mulberry32 } from "./rng";
import type { Vec3 } from "./types";
import {
  accumulateVoxels,
  createVoxelGrid,
  voxelTextureData,
  type VoxelBounds,
  type VoxelGrid,
} from "./voxel";
import { accumulateVoxels4 } from "./voxel-4d";

const SIZE = 8;
const ITERATIONS = 2_048;
const SEED = 0x51d;

const BOUNDS: VoxelBounds = {
  min: [-2, -2, -2],
  max: [2, 2, 2],
  color: {
    minX: -2,
    maxX: 2,
    minY: -2,
    maxY: 2,
    minZ: -2,
    maxZ: 2,
    minR: 0,
    maxR: 2,
  },
};

const AXIS_COLORS = {
  x: [0.2, 0.8, 0.4] as Vec3,
  y: [1, 0.2, 0.1] as Vec3,
  z: [0.1, 0.4, 1] as Vec3,
};

// prettier-ignore
const IDENTITY_ROTOR = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const ROTOR_PROJECTION = composeRotorProjection4(IDENTITY_ROTOR, [0, 0, 0, 0]);
const VIEW: FourDView = {
  invWAmp: 1,
  sliceOn: false,
  sliceCenter: 0,
  sliceWidth: 1,
  sliceRelativeColor: false,
};

/** Compact byte-exact fingerprint for a typed payload. */
function fingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function floatFingerprint(values: Float32Array): string {
  return fingerprint(
    new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
  );
}

function alphaBytes(grid: VoxelGrid): Uint8Array {
  const packed = voxelTextureData(grid);
  const alpha = new Uint8Array(grid.density.length);
  for (let i = 0; i < alpha.length; i++) alpha[i] = packed[i * 4 + 3];
  return alpha;
}

describe("Solid voxel payload contract", () => {
  it("keeps one density scalar plus running RGB, packed into one RGBA8 volume", () => {
    const grid = createVoxelGrid(SIZE, BOUNDS);

    expect(Object.keys(grid)).toEqual([
      "size",
      "bounds",
      "density",
      "avgRGB",
      "maxDensity",
      "orbit",
      "orbitColor",
      "orbitW",
      "orbitPrevBase",
      "orbitChaosLeft",
    ]);
    expect(grid.density).toBeInstanceOf(Float32Array);
    expect(grid.density).toHaveLength(SIZE ** 3);
    expect(grid.avgRGB).toBeInstanceOf(Float32Array);
    expect(grid.avgRGB).toHaveLength(SIZE ** 3 * 3);
    expect(voxelTextureData(grid)).toHaveLength(SIZE ** 3 * 4);
  });

  it("keeps 3D density invariant and the representative legacy/color payloads byte-stable", () => {
    const transforms = sierpinskiTetrahedron();
    const prepared = prepareChaosGame(transforms);
    const palette = transformColors(transforms.length);
    const orbitLut = buildPaletteLUT("aurora")!;

    const render = (
      mode: "transform" | "height" | "radius" | "position" | "uniform",
      colorLut?: Float32Array,
      rampPalette: "legacy" | "ember" = "legacy",
    ) =>
      accumulateVoxels(
        prepared,
        createVoxelGrid(SIZE, BOUNDS),
        ITERATIONS,
        mulberry32(SEED),
        palette,
        mode,
        colorLut,
        1,
        rampPalette,
        mode === "position" ? AXIS_COLORS : undefined,
      );

    const grids = {
      byTransform: render("transform"),
      legacyRamp: render("height"),
      selectedRamp: render("radius", undefined, "ember"),
      position: render("position"),
      uniform: render("uniform"),
      orbitPalette: render("transform", orbitLut),
    };
    const baseline = grids.byTransform;

    for (const grid of Object.values(grids)) {
      expect(grid.density).toEqual(baseline.density);
      expect(grid.maxDensity).toBe(baseline.maxDensity);
      expect(alphaBytes(grid)).toEqual(alphaBytes(baseline));
    }

    expect(
      Object.fromEntries(
        Object.entries(grids).map(([name, grid]) => [
          name,
          {
            runningRgb: floatFingerprint(grid.avgRGB),
            rgba8: fingerprint(voxelTextureData(grid)),
          },
        ]),
      ),
    ).toEqual({
      byTransform: { runningRgb: "298f2b9a", rgba8: "c5f0dce0" },
      legacyRamp: { runningRgb: "66ec284e", rgba8: "c912a95a" },
      selectedRamp: { runningRgb: "68df0905", rgba8: "27b4c499" },
      position: { runningRgb: "7fec5cff", rgba8: "182db62e" },
      uniform: { runningRgb: "c5c8bd1d", rgba8: "ce2d4b17" },
      orbitPalette: { runningRgb: "42f3e8d0", rgba8: "21b7cb88" },
    });
  });

  it("keeps 4D weighted density invariant and its representative color payloads byte-stable", () => {
    const transforms4 = pentatope().map(toTransform4);
    const prepared = prepareChaosGame4(transforms4);
    const palette = transformColors(transforms4.length);
    const legacyHeight = buildColorModeLUT("height");
    const selectedRadius = buildColorModeLUT("radius", 1, "ember");
    const orbitLut = buildPaletteLUT("aurora")!;

    const render = (color: FourDRenderColor) =>
      accumulateVoxels4(
        prepared,
        createVoxelGrid(SIZE, BOUNDS),
        ITERATIONS,
        mulberry32(SEED),
        ROTOR_PROJECTION,
        VIEW,
        color,
      );

    const grids = {
      legacyWRamp: render({
        kind: "wRamp",
        side: W_SIDE_PALETTES.wBlueOrange,
      }),
      byTransform: render({ kind: "transform", palette }),
      legacyRamp: render({
        kind: "height",
        lut: legacyHeight,
        minY: -2,
        maxY: 2,
      }),
      selectedRamp: render({
        kind: "radius",
        lut: selectedRadius,
        center: [0, 0, 0, 0],
        minD: 0,
        maxD: 2,
      }),
      position: render({
        kind: "position",
        min: BOUNDS.min,
        max: BOUNDS.max,
        colorGamma: 1,
        axisColors: AXIS_COLORS,
      }),
      uniform: render({ kind: "uniform", color: UNIFORM_POINT_COLOR }),
      orbitPalette: render({ kind: "structural", lut: orbitLut }),
    };
    const baseline = grids.byTransform;

    for (const grid of Object.values(grids)) {
      expect(grid.density).toEqual(baseline.density);
      expect(grid.maxDensity).toBe(baseline.maxDensity);
      expect(alphaBytes(grid)).toEqual(alphaBytes(baseline));
    }

    expect(
      Object.fromEntries(
        Object.entries(grids).map(([name, grid]) => [
          name,
          {
            runningRgb: floatFingerprint(grid.avgRGB),
            rgba8: fingerprint(voxelTextureData(grid)),
          },
        ]),
      ),
    ).toEqual({
      legacyWRamp: { runningRgb: "987f42ec", rgba8: "b8378a36" },
      byTransform: { runningRgb: "a0acf38d", rgba8: "167e8ecb" },
      legacyRamp: { runningRgb: "9ab7bc62", rgba8: "ec468478" },
      selectedRamp: { runningRgb: "789e7fbe", rgba8: "62e37bbb" },
      position: { runningRgb: "f4e2f5ad", rgba8: "a9a7bb92" },
      uniform: { runningRgb: "385c833d", rgba8: "7c7c506e" },
      orbitPalette: { runningRgb: "e6f87db7", rgba8: "de21534c" },
    });
  });
});
