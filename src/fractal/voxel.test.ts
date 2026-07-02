import {
  VOXEL_RESOLUTION_STEP,
  accumulateVoxels,
  clampVoxelResolution,
  computeVoxelBounds,
  createVoxelGrid,
  voxelTextureData,
} from "./voxel";
import type { VoxelBounds } from "./voxel";
import { plotPoint, prepareChaosGame, stepOrbit } from "./chaos-game";
import { transformColors } from "./color";
import { mulberry32 } from "./rng";
import { sierpinskiTetrahedron } from "./presets";
import type { Transform, Vec3 } from "./types";

/**
 * A single map that ignores its input and always lands exactly on `point`:
 * scale 0 collapses the linear part to zero, so every orbit step (including
 * warmup) returns `point` unchanged. Lets a test predict exactly which voxel
 * *every* iteration lands in, without hand-simulating the RNG.
 */
function fixedPointSystem(point: Vec3): Transform[] {
  return [{ id: 0, position: point, rotation: [0, 0, 0], scale: [0, 0, 0] }];
}

/** A symmetric cube around the origin, so voxel indices are easy to predict. */
function unitishBounds(half: number): VoxelBounds {
  return { min: [-half, -half, -half], max: [half, half, half] };
}

describe("createVoxelGrid", () => {
  it("starts with every voxel at zero and the orbit not yet started", () => {
    const grid = createVoxelGrid(4, unitishBounds(1));
    expect(grid.size).toBe(4);
    expect(grid.density).toHaveLength(64);
    expect(grid.avgRGB).toHaveLength(192);
    expect(Array.from(grid.density).every((d) => d === 0)).toBe(true);
    expect(grid.maxDensity).toBe(0);
    expect(grid.orbit).toBeNull();
  });
});

describe("computeVoxelBounds", () => {
  it("returns a cube (equal extent on every axis) enclosing the attractor", () => {
    const prepared = prepareChaosGame(sierpinskiTetrahedron());
    const bounds = computeVoxelBounds(prepared, mulberry32(7), 5000);

    const ex = bounds.max[0] - bounds.min[0];
    const ey = bounds.max[1] - bounds.min[1];
    const ez = bounds.max[2] - bounds.min[2];
    expect(ex).toBeGreaterThan(0);
    expect(ex).toBeCloseTo(ey, 12);
    expect(ex).toBeCloseTo(ez, 12);

    // The Sierpinski tetrahedron preset's attractor spans roughly a unit-ish
    // region; the cube must actually cover structure, not collapse to a dot.
    expect(ex).toBeGreaterThan(0.5);
    expect(ex).toBeLessThan(10);
  });

  it("centers a degenerate single-point attractor on that point", () => {
    const prepared = prepareChaosGame(fixedPointSystem([1, 2, 3]));
    const bounds = computeVoxelBounds(prepared, mulberry32(1), 1000);

    expect((bounds.min[0] + bounds.max[0]) / 2).toBeCloseTo(1, 6);
    expect((bounds.min[1] + bounds.max[1]) / 2).toBeCloseTo(2, 6);
    expect((bounds.min[2] + bounds.max[2]) / 2).toBeCloseTo(3, 6);
    // Floored away from zero so the world-to-voxel mapping stays invertible.
    expect(bounds.max[0] - bounds.min[0]).toBeGreaterThan(0);
  });

  it("trims rare outliers instead of stretching the grid to reach them", () => {
    // Two fixed points: one at the origin picked ~99.9% of the time, one far
    // away picked ~0.1% — below the 0.5% quantile trim, so the far point is
    // an outlier the bounds must NOT chase (untrimmed, the attractor would
    // occupy a handful of voxels in a grid stretched to [40, 40, 40]).
    const transforms: Transform[] = [
      { id: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] },
      {
        id: 1,
        position: [40, 40, 40],
        rotation: [0, 0, 0],
        scale: [0, 0, 0],
        weight: 0.001,
      },
    ];
    const prepared = prepareChaosGame(transforms);
    const bounds = computeVoxelBounds(prepared, mulberry32(3), 30_000);

    expect(bounds.max[0]).toBeLessThan(1);
    expect(bounds.min[0]).toBeGreaterThan(-1);
  });
});

describe("accumulateVoxels bucketing", () => {
  it("lands a fixed-point system's every iteration in the predicted voxel", () => {
    const prepared = prepareChaosGame(fixedPointSystem([0, 0, 0]));
    const palette = transformColors(1);
    const grid = createVoxelGrid(4, unitishBounds(1));

    accumulateVoxels(prepared, grid, 10, mulberry32(1), palette);

    // World origin in a [-1, 1] cube of 4 voxels: floor((0 + 1) * 2) = 2 on
    // every axis, x-fastest layout.
    const bucket = 2 * 16 + 2 * 4 + 2;
    expect(grid.density[bucket]).toBe(10);
    expect(grid.maxDensity).toBe(10);
    const total = Array.from(grid.density).reduce((a, b) => a + b, 0);
    expect(total).toBe(10);
  });

  it("holds the running-mean color of a single-transform system at that transform's palette color", () => {
    const prepared = prepareChaosGame(fixedPointSystem([0, 0, 0]));
    const palette = transformColors(1);
    const grid = createVoxelGrid(4, unitishBounds(1));

    accumulateVoxels(prepared, grid, 25, mulberry32(1), palette);

    const bucket = 2 * 16 + 2 * 4 + 2;
    const o = bucket * 3;
    expect(grid.avgRGB[o]).toBeCloseTo(palette[0][0], 6);
    expect(grid.avgRGB[o + 1]).toBeCloseTo(palette[0][1], 6);
    expect(grid.avgRGB[o + 2]).toBeCloseTo(palette[0][2], 6);
  });

  it("skips points outside the bounds without recording anything", () => {
    const prepared = prepareChaosGame(fixedPointSystem([5, 5, 5]));
    const palette = transformColors(1);
    const grid = createVoxelGrid(4, unitishBounds(1));

    accumulateVoxels(prepared, grid, 50, mulberry32(1), palette);

    expect(Array.from(grid.density).every((d) => d === 0)).toBe(true);
    expect(grid.maxDensity).toBe(0);
    // The orbit still advanced — the next chunk resumes from the attractor.
    expect(grid.orbit).toEqual([5, 5, 5]);
  });
});

describe("accumulateVoxels progressive accumulation", () => {
  it("produces the identical grid whether run as one call or resumed across chunks", () => {
    const transforms = sierpinskiTetrahedron();
    const palette = transformColors(transforms.length);
    const bounds = unitishBounds(2);

    const oneShot = createVoxelGrid(8, bounds);
    accumulateVoxels(
      prepareChaosGame(transforms),
      oneShot,
      500,
      mulberry32(42),
      palette,
    );

    const chunked = createVoxelGrid(8, bounds);
    const rng = mulberry32(42);
    const prepared = prepareChaosGame(transforms);
    accumulateVoxels(prepared, chunked, 200, rng, palette);
    accumulateVoxels(prepared, chunked, 300, rng, palette);

    expect(chunked.density).toEqual(oneShot.density);
    expect(chunked.avgRGB).toEqual(oneShot.avgRGB);
    expect(chunked.maxDensity).toBe(oneShot.maxDensity);
    expect(chunked.orbit).toEqual(oneShot.orbit);
  });
});

describe("accumulateVoxels vs. stepOrbit/plotPoint (correctness oracle)", () => {
  it("matches a reference loop built directly from stepOrbit/plotPoint, iteration for iteration", () => {
    // The reference is the tested public stepping API driven by hand,
    // bucketed by the same formula. If accumulateVoxels' inlined copy of
    // stepOrbit/plotPoint ever drifts (a changed escape rule, a reordered
    // rng draw), the two grids diverge and this fails. Variations + a final
    // transform are included so every rng-consuming path is exercised.
    const transforms: Transform[] = sierpinskiTetrahedron().map((t, i) =>
      i === 0
        ? { ...t, variations: [{ type: "sinusoidal" as const, weight: 0.7 }] }
        : t,
    );
    const finalTransform: Transform = {
      id: 0,
      position: [0.1, 0, 0],
      rotation: [0, 0.3, 0],
      scale: [1, 1, 1],
    };
    const palette = transformColors(transforms.length);
    const bounds = unitishBounds(2);
    const size = 8;
    const iterations = 2000;

    const actual = createVoxelGrid(size, bounds);
    accumulateVoxels(
      prepareChaosGame(transforms, finalTransform),
      actual,
      iterations,
      mulberry32(99),
      palette,
    );

    const prepared = prepareChaosGame(transforms, finalTransform);
    const rng = mulberry32(99);
    const expected = createVoxelGrid(size, bounds);
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    for (let i = 0; i < 100; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
    }
    const invCell = size / (bounds.max[0] - bounds.min[0]);
    for (let n = 0; n < iterations; n++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
      const [px, py, pz] = plotPoint(prepared, x, y, z, rng);
      const vx = Math.floor((px - bounds.min[0]) * invCell);
      const vy = Math.floor((py - bounds.min[1]) * invCell);
      const vz = Math.floor((pz - bounds.min[2]) * invCell);
      if (vx < 0 || vx >= size || vy < 0 || vy >= size) continue;
      if (vz < 0 || vz >= size) continue;
      const bucket = vz * size * size + vy * size + vx;
      const d = expected.density[bucket] + 1;
      expected.density[bucket] = d;
      if (d > expected.maxDensity) expected.maxDensity = d;
      const rgb = palette[s.index];
      const o = bucket * 3;
      const inv = 1 / d;
      expected.avgRGB[o] += (rgb[0] - expected.avgRGB[o]) * inv;
      expected.avgRGB[o + 1] += (rgb[1] - expected.avgRGB[o + 1]) * inv;
      expected.avgRGB[o + 2] += (rgb[2] - expected.avgRGB[o + 2]) * inv;
    }

    expect(actual.density).toEqual(expected.density);
    expect(actual.avgRGB).toEqual(expected.avgRGB);
    expect(actual.maxDensity).toBe(expected.maxDensity);
    expect(actual.orbit).toEqual([x, y, z]);
  });
});

describe("voxelTextureData", () => {
  it("packs an empty grid to all-transparent zeros", () => {
    const grid = createVoxelGrid(2, unitishBounds(1));
    const data = voxelTextureData(grid);
    expect(data).toHaveLength(32);
    expect(Array.from(data).every((b) => b === 0)).toBe(true);
  });

  it("packs the hottest voxel to alpha 255 and scales others by log-density", () => {
    const grid = createVoxelGrid(2, unitishBounds(1));
    grid.density[0] = 1;
    grid.density[1] = 9;
    grid.maxDensity = 9;

    const data = voxelTextureData(grid);

    expect(data[3]).toBe(Math.round((Math.log1p(1) / Math.log1p(9)) * 255));
    expect(data[7]).toBe(255);
    // Untouched voxels stay fully transparent.
    expect(data[11]).toBe(0);
    expect(data[15]).toBe(0);
  });

  it("packs a voxel's running-mean color into its RGB bytes", () => {
    const grid = createVoxelGrid(1, unitishBounds(1));
    grid.density[0] = 3;
    grid.maxDensity = 3;
    grid.avgRGB.set([0.5, 0.25, 1]);

    const data = voxelTextureData(grid);

    expect(Array.from(data)).toEqual([128, 64, 255, 255]);
  });
});

describe("clampVoxelResolution", () => {
  it("returns the requested resolution when it fits the voxel budget", () => {
    expect(clampVoxelResolution(192, 256 ** 3)).toBe(192);
  });

  it("steps down to the largest resolution that fits", () => {
    expect(clampVoxelResolution(256, 192 ** 3)).toBe(192);
  });

  it("floors a non-multiple request to the resolution step", () => {
    expect(clampVoxelResolution(200, 256 ** 3)).toBe(192);
  });

  it("never goes below one resolution step, even when nothing fits", () => {
    expect(clampVoxelResolution(256, 10)).toBe(VOXEL_RESOLUTION_STEP);
  });
});
