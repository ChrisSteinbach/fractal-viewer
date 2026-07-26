import {
  buildSurfaceGrid,
  buildSurfaceGridSlab,
  floorToF32,
  surfaceGridSpec,
} from "./surface-grid";
import type { SurfaceGrid, SurfaceGridSpec } from "./surface-grid";
import { buildSurfaceDE } from "./surface-de";
import { runChaosGame } from "./chaos-game";
import type { ChaosGameResult } from "./chaos-game";
import { sierpinskiTetrahedron } from "./presets";
import { mulberry32 } from "./rng";
import type { Transform, Vec3 } from "./types";

/** Sierpinski tetrahedron with an anisotropic y-scale (0.25 instead of the
 * uniform 0.5) — mirrors `surface-de.test.ts`'s own `anisotropicSierpinski`,
 * duplicated locally since that file's helpers are not exported. The class
 * where deep certificates behave worst, per that module's doc. */
function anisotropicSierpinski(): Transform[] {
  return sierpinskiTetrahedron().map((t): Transform => ({
    ...t,
    scale: [0.5, 0.25, 0.5],
  }));
}

/** Flat index into a `resolution`-cube {@link SurfaceGrid.values}, matching
 * the module's own `x + resolution * (y + resolution * z)` layout. */
function cellIndex(
  resolution: number,
  ix: number,
  iy: number,
  iz: number,
): number {
  return ix + resolution * (iy + resolution * iz);
}

/** Cell axis index nearest `coord`, clamped to a valid `[0, resolution)`
 * slot — a point exactly on (or numerically just past) the cube's boundary
 * still lands in its edge cell instead of falling off the array. */
function clampIndex(i: number, resolution: number): number {
  return Math.min(resolution - 1, Math.max(0, i));
}

/** Flat index of the cell containing point `p` of `grid`. */
function containingCell(grid: SurfaceGrid, p: Vec3): number {
  const { resolution, halfExtent } = grid;
  const cell = (2 * halfExtent) / resolution;
  const ix = clampIndex(Math.floor((p[0] + halfExtent) / cell), resolution);
  const iy = clampIndex(Math.floor((p[1] + halfExtent) / cell), resolution);
  const iz = clampIndex(Math.floor((p[2] + halfExtent) / cell), resolution);
  return cellIndex(resolution, ix, iy, iz);
}

/** Brute-force nearest distance from `p` to any point of a sampled cloud —
 * an upper bound on the true attractor distance, checked below against the
 * grid's conservative lower bound. Independent of the module under test,
 * mirroring `surface-de.test.ts`'s own `nearestDistance`. */
function nearestDistance(cloud: ChaosGameResult, p: Vec3): number {
  let best = Infinity;
  const { positions, count } = cloud;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - p[0];
    const dy = positions[i * 3 + 1] - p[1];
    const dz = positions[i * 3 + 2] - p[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** Uniform-random point inside grid cell `(ix, iy, iz)` of `spec`. */
function randomPointInCell(
  spec: SurfaceGridSpec,
  ix: number,
  iy: number,
  iz: number,
  rng: () => number,
): Vec3 {
  const cell = (2 * spec.halfExtent) / spec.resolution;
  const cx = -spec.halfExtent + (ix + 0.5) * cell;
  const cy = -spec.halfExtent + (iy + 0.5) * cell;
  const cz = -spec.halfExtent + (iz + 0.5) * cell;
  return [
    cx + (rng() - 0.5) * cell,
    cy + (rng() - 0.5) * cell,
    cz + (rng() - 0.5) * cell,
  ];
}

/**
 * The module's core conservativeness claim, brute-forced against a sampled
 * cloud: every POSITIVE stored floor must be `<=` the true nearest-cloud
 * distance from a random point drawn from inside that floor's own cell (a
 * cloud sample upper-bounds the true attractor distance, and a positive
 * floor lower-bounds it — see `surface-grid.ts`'s module doc). Draws random
 * cells until `targetDraws` positive ones have been exercised or
 * `maxAttempts` random cells have been tried; returns how many positive
 * draws it actually managed, so callers can assert that count stays well
 * clear of zero — the check would pass vacuously against an all-zero grid
 * otherwise.
 */
function checkStoredFloorsAgainstCloud(
  grid: SurfaceGrid,
  cloud: ChaosGameResult,
  rng: () => number,
  targetDraws = 150,
  maxAttempts = 20000,
): number {
  const { resolution, values } = grid;
  let positiveDraws = 0;
  for (
    let attempt = 0;
    attempt < maxAttempts && positiveDraws < targetDraws;
    attempt++
  ) {
    const ix = Math.floor(rng() * resolution);
    const iy = Math.floor(rng() * resolution);
    const iz = Math.floor(rng() * resolution);
    const stored = values[cellIndex(resolution, ix, iy, iz)];
    if (stored <= 0) continue;
    positiveDraws++;
    const p = randomPointInCell(grid, ix, iy, iz, rng);
    expect(stored).toBeLessThanOrEqual(nearestDistance(cloud, p));
  }
  return positiveDraws;
}

describe("surfaceGridSpec", () => {
  it("sizes the cube to cover everything the tracer can sample", () => {
    const plain = buildSurfaceDE(sierpinskiTetrahedron());
    expect(surfaceGridSpec(plain, 8).halfExtent).toBe(
      plain.visibleBoundingRadius * 1.03,
    );

    // A modest expanding final-transform lens: visibleBoundingRadius then
    // grows past the raw attractor's boundingRadius, and the spec has to
    // track the VISIBLE radius, not the raw one.
    const finalTransform: Transform = {
      id: 99,
      position: [0.3, -0.2, 0.1],
      rotation: [0.4, 0.2, -0.3],
      scale: [1.2, 1.2, 1.2],
    };
    const lensed = buildSurfaceDE(sierpinskiTetrahedron(), finalTransform);
    expect(lensed.visibleBoundingRadius).toBeGreaterThan(lensed.boundingRadius);
    expect(surfaceGridSpec(lensed, 8).halfExtent).toBe(
      lensed.visibleBoundingRadius * 1.03,
    );
  });
});

describe("floorToF32", () => {
  it("never exceeds its input and stays within one ulp", () => {
    const scratchF32 = new Float32Array(1);
    const scratchU32 = new Uint32Array(scratchF32.buffer);
    /** Float32 bit-pattern successor of `f` — the step opposite
     * `floorToF32`'s internal one-ulp-down, used only here to pin the
     * "within one ulp" property independently of that implementation: by
     * construction, the largest float32 `<= v` has no other float32
     * between it and `v`, so `v` must be strictly less than that value's
     * successor. */
    function nextF32(f: number): number {
      scratchF32[0] = f;
      scratchU32[0] += 1;
      return scratchF32[0];
    }

    const values = [0, 1e-40, 1 / 3, Math.PI, 1e6 * (1 / 3), 0.5];
    for (const v of values) {
      const floored = floorToF32(v);
      expect(floored).toBeLessThanOrEqual(v);
      expect(Math.fround(floored)).toBe(floored);
      expect(v).toBeLessThan(nextF32(floored));
    }
  });
});

describe("stored floors never exceed the true distance", () => {
  it("holds against a brute-force nearest-cloud-point check on sierpinskiTetrahedron", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(1));
    const grid = buildSurfaceGrid(de, 12);
    const positiveDraws = checkStoredFloorsAgainstCloud(
      grid,
      cloud,
      mulberry32(2024),
    );
    expect(positiveDraws).toBeGreaterThan(30);
  });
});

describe("stored floors stay conservative on harder systems", () => {
  it("holds on an anisotropic sierpinski (scale [0.5, 0.25, 0.5]), the class where deep certificates behave worst", () => {
    const transforms = anisotropicSierpinski();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(1));
    const grid = buildSurfaceGrid(de, 12);
    const positiveDraws = checkStoredFloorsAgainstCloud(
      grid,
      cloud,
      mulberry32(4242),
    );
    expect(positiveDraws).toBeGreaterThan(30);
  });

  it("holds on a kaleidoscope build (order 3, axis z)", () => {
    const transforms = sierpinskiTetrahedron();
    const symmetry = { order: 3, axis: "z" } as const;
    const de = buildSurfaceDE(transforms, null, symmetry);
    const cloud = runChaosGame(
      transforms,
      20000,
      mulberry32(1),
      null,
      symmetry,
    );
    const grid = buildSurfaceGrid(de, 12);
    const positiveDraws = checkStoredFloorsAgainstCloud(
      grid,
      cloud,
      mulberry32(5150),
    );
    expect(positiveDraws).toBeGreaterThan(30);
  });
});

describe("cells containing attractor samples", () => {
  it("store exactly 0", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(3));
    const grid = buildSurfaceGrid(de, 12);
    for (let i = 0; i < 200; i++) {
      const idx = Math.floor((i / 200) * cloud.count);
      const p: Vec3 = [
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ];
      // Their center is within cellRadius of the attractor (the sample
      // itself sits inside the cell), so the descent's value cannot clear
      // the cutoff — equality at the boundary also lands 0 (see the module
      // doc's cutoff paragraph).
      expect(grid.values[containingCell(grid, p)]).toBe(0);
    }
  });
});

describe("the central void", () => {
  it("stores a positive skip at resolution 12", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const grid = buildSurfaceGrid(de, 12);
    // The centroid void `estimateDistance` is pinned against directly in
    // surface-de.test.ts ("crosses the central void rather than stalling
    // at a non-positive bound"): [0, -0.1, 0]. Pinning a positive value
    // here — not just checking >= 0 — is what keeps this test from passing
    // against a grid of all zeros.
    const idx = containingCell(grid, [0, -0.1, 0]);
    expect(grid.values[idx]).toBeGreaterThan(0);
  });
});

describe("slab builds", () => {
  it("compose to the full build bit for bit", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const resolution = 8;
    const spec = surfaceGridSpec(de, resolution);
    const full = buildSurfaceGrid(de, resolution);

    const slabbed = new Float32Array(resolution ** 3);
    buildSurfaceGridSlab(de, spec, 0, 3, slabbed);
    buildSurfaceGridSlab(de, spec, 3, 8, slabbed);

    expect(Array.from(slabbed)).toEqual(Array.from(full.values));
  });
});

describe("cells fully outside the traced sphere", () => {
  it("store 0 without costing a descent", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const resolution = 8;
    const grid = buildSurfaceGrid(de, resolution);
    const r = resolution - 1;
    // The design (skipping the estimator call entirely for these cells) is
    // not observable from the stored value alone — pinned in the module
    // doc instead — so this only asserts the value every outer-corner cell
    // has to land on regardless.
    const corners: Array<[number, number, number]> = [
      [0, 0, 0],
      [r, 0, 0],
      [0, r, 0],
      [0, 0, r],
      [r, r, r],
    ];
    for (const [x, y, z] of corners) {
      expect(grid.values[cellIndex(resolution, x, y, z)]).toBe(0);
    }
  });
});

describe("buildSurfaceGrid", () => {
  it("is deterministic", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const a = buildSurfaceGrid(de, 8);
    const b = buildSurfaceGrid(de, 8);
    expect(Array.from(a.values)).toEqual(Array.from(b.values));
  });
});
