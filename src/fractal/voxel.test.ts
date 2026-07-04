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
import {
  UNIFORM_POINT_COLOR,
  buildColorModeLUT,
  transformColors,
} from "./color";
import { buildPaletteLUT } from "./palette";
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

/** A symmetric cube around the origin, so voxel indices are easy to predict;
 * color extents match the cube (radius 0..half) so mode tests can compute
 * their expected normalized coordinates by hand. */
function unitishBounds(half: number): VoxelBounds {
  return {
    min: [-half, -half, -half],
    max: [half, half, half],
    color: {
      minX: -half,
      maxX: half,
      minY: -half,
      maxY: half,
      minZ: -half,
      maxZ: half,
      minR: 0,
      maxR: half,
    },
  };
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
    // The color coordinate starts mid-gradient (flam3's convention).
    expect(grid.orbitColor).toBe(0.5);
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

  it("reports the attractor's own trimmed extents for color normalization", () => {
    const prepared = prepareChaosGame(fixedPointSystem([1, 2, 3]));
    const bounds = computeVoxelBounds(prepared, mulberry32(5), 1000);

    // A single-point attractor: every extent collapses onto the point.
    expect(bounds.color.minY).toBeCloseTo(2, 9);
    expect(bounds.color.maxY).toBeCloseTo(2, 9);
    expect(bounds.color.minX).toBeCloseTo(1, 9);
    expect(bounds.color.maxZ).toBeCloseTo(3, 9);
    const r = Math.sqrt(1 + 4 + 9);
    expect(bounds.color.minR).toBeCloseTo(r, 9);
    expect(bounds.color.maxR).toBeCloseTo(r, 9);
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

describe("accumulateVoxels color modes (fr-c1d)", () => {
  it("colors by the height ramp at the point's normalized height", () => {
    const prepared = prepareChaosGame(fixedPointSystem([0, 0, 0]));
    const grid = createVoxelGrid(4, unitishBounds(1));

    accumulateVoxels(
      prepared,
      grid,
      10,
      mulberry32(1),
      transformColors(1),
      "height",
    );

    // y = 0 in a [-1, 1] color range: t = 0.5 → LUT index (0.5*255+0.5)|0.
    const lut = buildColorModeLUT("height");
    const li = ((0.5 * 255 + 0.5) | 0) * 3;
    const o = (2 * 16 + 2 * 4 + 2) * 3;
    expect(grid.avgRGB[o]).toBeCloseTo(lut[li], 6);
    expect(grid.avgRGB[o + 1]).toBeCloseTo(lut[li + 1], 6);
    expect(grid.avgRGB[o + 2]).toBeCloseTo(lut[li + 2], 6);
  });

  it("colors by the radius ramp at the point's normalized radius", () => {
    const prepared = prepareChaosGame(fixedPointSystem([0.5, 0, 0]));
    const grid = createVoxelGrid(4, unitishBounds(1));

    accumulateVoxels(
      prepared,
      grid,
      10,
      mulberry32(1),
      transformColors(1),
      "radius",
    );

    // r = 0.5 with color extents 0..1: t = 0.5. Voxel: x floor(1.5*2)=3, y=z=2.
    const lut = buildColorModeLUT("radius");
    const li = ((0.5 * 255 + 0.5) | 0) * 3;
    const o = (2 * 16 + 2 * 4 + 3) * 3;
    expect(grid.avgRGB[o]).toBeCloseTo(lut[li], 6);
    expect(grid.avgRGB[o + 1]).toBeCloseTo(lut[li + 1], 6);
    expect(grid.avgRGB[o + 2]).toBeCloseTo(lut[li + 2], 6);
  });

  it("colors by normalized position mapped into the compressed RGB range", () => {
    const prepared = prepareChaosGame(fixedPointSystem([0, 0, 0]));
    const grid = createVoxelGrid(4, unitishBounds(1));

    accumulateVoxels(
      prepared,
      grid,
      10,
      mulberry32(1),
      transformColors(1),
      "position",
    );

    // Every axis: t = 0.5 → 0.5 * 0.8 + 0.2 = 0.6, matching buildColors.
    const o = (2 * 16 + 2 * 4 + 2) * 3;
    expect(grid.avgRGB[o]).toBeCloseTo(0.6, 6);
    expect(grid.avgRGB[o + 1]).toBeCloseTo(0.6, 6);
    expect(grid.avgRGB[o + 2]).toBeCloseTo(0.6, 6);
  });

  it("colors uniform mode with the explorer's flat cyan", () => {
    const prepared = prepareChaosGame(fixedPointSystem([0, 0, 0]));
    const grid = createVoxelGrid(4, unitishBounds(1));

    accumulateVoxels(
      prepared,
      grid,
      10,
      mulberry32(1),
      transformColors(1),
      "uniform",
    );

    const o = (2 * 16 + 2 * 4 + 2) * 3;
    expect(grid.avgRGB[o]).toBeCloseTo(UNIFORM_POINT_COLOR[0], 6);
    expect(grid.avgRGB[o + 1]).toBeCloseTo(UNIFORM_POINT_COLOR[1], 6);
    expect(grid.avgRGB[o + 2]).toBeCloseTo(UNIFORM_POINT_COLOR[2], 6);
  });

  it("leaves the orbit (and thus density) byte-identical across color modes", () => {
    // Coloring must never consume rng: the same seed has to trace the same
    // attractor regardless of how it is painted.
    const transforms = sierpinskiTetrahedron();
    const palette = transformColors(transforms.length);
    const run = (mode: "transform" | "height"): Float32Array => {
      const grid = createVoxelGrid(8, unitishBounds(2));
      accumulateVoxels(
        prepareChaosGame(transforms),
        grid,
        1000,
        mulberry32(42),
        palette,
        mode,
      );
      return grid.density;
    };
    expect(run("height")).toEqual(run("transform"));
  });
});

describe("accumulateVoxels color contrast (fr-8sk)", () => {
  it("reshapes height-mode colors without changing density at all", () => {
    const prepared = prepareChaosGame(fixedPointSystem([0, 0, 0]));
    const palette = transformColors(1);

    const linear = createVoxelGrid(4, unitishBounds(1));
    accumulateVoxels(prepared, linear, 10, mulberry32(1), palette, "height");

    const contrasty = createVoxelGrid(4, unitishBounds(1));
    accumulateVoxels(
      prepared,
      contrasty,
      10,
      mulberry32(1),
      palette,
      "height",
      undefined,
      2,
    );

    // Gamma repaints, but must never touch which voxels were hit.
    expect(contrasty.density).toEqual(linear.density);
    expect(contrasty.avgRGB).not.toEqual(linear.avgRGB);
  });

  it("reshapes position-mode colors without changing density at all", () => {
    const prepared = prepareChaosGame(fixedPointSystem([0.5, 0, 0]));
    const palette = transformColors(1);

    const linear = createVoxelGrid(4, unitishBounds(1));
    accumulateVoxels(prepared, linear, 10, mulberry32(1), palette, "position");

    const contrasty = createVoxelGrid(4, unitishBounds(1));
    accumulateVoxels(
      prepared,
      contrasty,
      10,
      mulberry32(1),
      palette,
      "position",
      undefined,
      2,
    );

    expect(contrasty.density).toEqual(linear.density);
    expect(contrasty.avgRGB).not.toEqual(linear.avgRGB);
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

  it("matches a reference loop that tracks the color coordinate the same way (colorLUT, fr-1kt)", () => {
    // The colorLUT counterpart to the oracle above: the color coordinate `c`
    // rides the orbit (init 0.5, blended halfway toward the picked
    // transform's slot each step) and indexes the gradient. Because updating
    // `c` consumes no rng, the orbit — and thus `density` — is byte-identical
    // to the no-colorLUT path; only avgRGB differs, and this pins it to the
    // same rule the inlined loop uses.
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
    const colorLUT = buildPaletteLUT("spectrum");
    if (!colorLUT) throw new Error("spectrum should have a LUT");
    const bounds = unitishBounds(2);
    const size = 8;
    const iterations = 2000;
    const n = transforms.length;

    const prepared = prepareChaosGame(transforms, finalTransform);
    const actual = createVoxelGrid(size, bounds);
    accumulateVoxels(
      prepared,
      actual,
      iterations,
      mulberry32(99),
      palette,
      "transform",
      colorLUT,
    );

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
    let c = 0.5;
    for (let n2 = 0; n2 < iterations; n2++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
      const slot = n > 1 ? s.index / (n - 1) : 0.5;
      c = (c + slot) / 2;
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
      const li = Math.min(255, (c * 256) | 0) * 3;
      const o = bucket * 3;
      const inv = 1 / d;
      expected.avgRGB[o] += (colorLUT[li] - expected.avgRGB[o]) * inv;
      expected.avgRGB[o + 1] +=
        (colorLUT[li + 1] - expected.avgRGB[o + 1]) * inv;
      expected.avgRGB[o + 2] +=
        (colorLUT[li + 2] - expected.avgRGB[o + 2]) * inv;
    }
    expected.orbit = [x, y, z];
    expected.orbitColor = c;

    expect(actual.density).toEqual(expected.density);
    expect(actual.avgRGB).toEqual(expected.avgRGB);
    expect(actual.maxDensity).toBe(expected.maxDensity);
    expect(actual.orbit).toEqual(expected.orbit);
    expect(actual.orbitColor).toBe(expected.orbitColor);
  });

  it("matches the same oracle when the prepared system has rotated copies (fr-6im)", () => {
    // Same shape as the plain oracle above, but `prepared` is built with
    // symmetry: stepOrbit already rotates a picked slot's full affine +
    // variation output (see chaos-game.test.ts), so if accumulateVoxels'
    // hand-inlined loop ever drifts from that — including its post-rotation
    // and BASE-index handling for "By Transform" coloring — this is what
    // catches it.
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
    const symmetry = { order: 4 as const, axis: "y" as const };
    const palette = transformColors(transforms.length);
    const bounds = unitishBounds(3);
    const size = 8;
    const iterations = 2000;

    const prepared = prepareChaosGame(transforms, finalTransform, symmetry);
    const actual = createVoxelGrid(size, bounds);
    accumulateVoxels(prepared, actual, iterations, mulberry32(99), palette);

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
      // s.index is already the BASE map (see chaos-game.ts's stepOrbit), so
      // this indexes `palette` (sized to transforms.length) exactly like the
      // no-symmetry oracle above.
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

  it("matches the structural-coloring (colorLUT) oracle when the prepared system has rotated copies (fr-1kt + fr-6im)", () => {
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
    const symmetry = { order: 4 as const, axis: "y" as const };
    const palette = transformColors(transforms.length);
    const colorLUT = buildPaletteLUT("ember");
    if (!colorLUT) throw new Error("ember should have a LUT");
    const bounds = unitishBounds(3);
    const size = 8;
    const iterations = 2000;
    // BASE count — colorDenom keys on this, not the expanded slot count (see
    // voxel.ts's accumulateVoxels), so every rotated copy of a base map
    // repeats that map's gradient slot instead of smearing across copies.
    const n = transforms.length;

    const prepared = prepareChaosGame(transforms, finalTransform, symmetry);
    const actual = createVoxelGrid(size, bounds);
    accumulateVoxels(
      prepared,
      actual,
      iterations,
      mulberry32(99),
      palette,
      "transform",
      colorLUT,
    );

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
    let c = 0.5;
    for (let n2 = 0; n2 < iterations; n2++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
      const slot = n > 1 ? s.index / (n - 1) : 0.5;
      c = (c + slot) / 2;
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
      const li = Math.min(255, (c * 256) | 0) * 3;
      const o = bucket * 3;
      const inv = 1 / d;
      expected.avgRGB[o] += (colorLUT[li] - expected.avgRGB[o]) * inv;
      expected.avgRGB[o + 1] +=
        (colorLUT[li + 1] - expected.avgRGB[o + 1]) * inv;
      expected.avgRGB[o + 2] +=
        (colorLUT[li + 2] - expected.avgRGB[o + 2]) * inv;
    }
    expected.orbit = [x, y, z];
    expected.orbitColor = c;

    expect(actual.density).toEqual(expected.density);
    expect(actual.avgRGB).toEqual(expected.avgRGB);
    expect(actual.maxDensity).toBe(expected.maxDensity);
    expect(actual.orbit).toEqual(expected.orbit);
    expect(actual.orbitColor).toBe(expected.orbitColor);
  });

  it("produces a differently-shaped grid than the same seed without symmetry", () => {
    const transforms = sierpinskiTetrahedron();
    const palette = transformColors(transforms.length);
    const bounds = unitishBounds(3);
    const size = 8;
    const iterations = 2000;

    const withoutSymmetry = accumulateVoxels(
      prepareChaosGame(transforms),
      createVoxelGrid(size, bounds),
      iterations,
      mulberry32(1),
      palette,
    );
    const withSymmetry = accumulateVoxels(
      prepareChaosGame(transforms, null, { order: 5, axis: "x" }),
      createVoxelGrid(size, bounds),
      iterations,
      mulberry32(1),
      palette,
    );

    expect(Array.from(withSymmetry.density)).not.toEqual(
      Array.from(withoutSymmetry.density),
    );
  });
});

describe("accumulateVoxels structural coloring (colorLUT, fr-1kt)", () => {
  it("threads the color coordinate across chunks (progressive == single-shot)", () => {
    const transforms = sierpinskiTetrahedron();
    const palette = transformColors(transforms.length);
    const colorLUT = buildPaletteLUT("lagoon");
    if (!colorLUT) throw new Error("lagoon should have a LUT");
    const bounds = unitishBounds(2);
    const size = 8;

    const chunkedRng = mulberry32(11);
    const prepared = prepareChaosGame(transforms);
    const chunked = createVoxelGrid(size, bounds);
    accumulateVoxels(
      prepared,
      chunked,
      400,
      chunkedRng,
      palette,
      "transform",
      colorLUT,
    );
    accumulateVoxels(
      prepared,
      chunked,
      600,
      chunkedRng,
      palette,
      "transform",
      colorLUT,
    );

    const singleShot = createVoxelGrid(size, bounds);
    accumulateVoxels(
      prepareChaosGame(transforms),
      singleShot,
      1000,
      mulberry32(11),
      palette,
      "transform",
      colorLUT,
    );

    expect(chunked.avgRGB).toEqual(singleShot.avgRGB);
    expect(chunked.orbitColor).toBe(singleShot.orbitColor);
  });

  it("colors by the gradient instead of colorMode, without changing the orbit", () => {
    const transforms = sierpinskiTetrahedron();
    const bounds = unitishBounds(2);
    const size = 8;

    const legacy = createVoxelGrid(size, bounds);
    accumulateVoxels(
      prepareChaosGame(transforms),
      legacy,
      1000,
      mulberry32(3),
      transformColors(transforms.length),
      "height",
    );
    // The no-colorLUT path never touches the color coordinate.
    expect(legacy.orbitColor).toBe(0.5);

    const colorLUT = buildPaletteLUT("aurora");
    if (!colorLUT) throw new Error("aurora should have a LUT");
    const colored = createVoxelGrid(size, bounds);
    accumulateVoxels(
      prepareChaosGame(transforms),
      colored,
      1000,
      mulberry32(3),
      transformColors(transforms.length),
      "height",
      colorLUT,
    );

    expect(colored.orbitColor).not.toBe(0.5);
    // Same seed, same orbit → identical density whether or not a LUT is
    // supplied, regardless of colorMode.
    expect(colored.density).toEqual(legacy.density);
    // ...but the accumulated colors differ (gradient vs colorMode ramp).
    expect(colored.avgRGB).not.toEqual(legacy.avgRGB);
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
