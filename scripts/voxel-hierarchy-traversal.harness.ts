/**
 * Deterministic work-count model for a single-level Solid max hierarchy.
 *
 * This is deliberately not a wall-clock GPU claim. It mirrors the production
 * primary march's fixed 220-sample lattice, including its per-pixel phase, and
 * counts the two texture operations an accelerated shader would perform:
 * nearest R8 hierarchy reads and trilinear RGBA8 volume reads. Empty nodes
 * advance by whole lattice steps to the conservative node exit; occupied
 * nodes cache that exit, so they pay one hierarchy read rather than one per
 * volume sample. Exact first-hit sample equivalence is asserted against the
 * unaccelerated lattice for every ray.
 *
 * Run:
 *   npx vitest run --config scripts/vitest.harness.config.ts \
 *     scripts/voxel-hierarchy-traversal.harness.ts
 */
import { describe, expect, it } from "vitest";

import { marchStepsForGrid } from "../src/app/voxel-material";
import {
  buildVoxelMaxHierarchy,
  type VoxelMaxHierarchy,
  type VoxelMaxHierarchyLevel,
} from "../src/fractal/voxel-max-hierarchy";
import { samplePackedVoxelDensity } from "../src/fractal/voxel-raymarch";

const SIZE = 192;
const WIDTH = 64;
const HEIGHT = 48;
const THRESHOLD = 0.3;
const SPANS = [8, 16, 32] as const;

type Profile = "sparse" | "dense" | "nonlinear";

interface RayLattice {
  readonly u: number;
  readonly v: number;
  readonly phase: number;
  readonly density: Float32Array;
  readonly firstHit: number;
  readonly baselineReads: number;
}

interface TraversalCounts {
  hierarchyReads: number;
  volumeReads: number;
  skippedSamples: number;
  hitMismatches: number;
}

function hash(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function packedVolume(profile: Profile): Uint8Array {
  const data = new Uint8Array(SIZE ** 3 * 4);
  for (let z = 0; z < SIZE; z++) {
    const pz = ((z + 0.5) / SIZE) * 2 - 1;
    for (let y = 0; y < SIZE; y++) {
      const py = ((y + 0.5) / SIZE) * 2 - 1;
      for (let x = 0; x < SIZE; x++) {
        const px = ((x + 0.5) / SIZE) * 2 - 1;
        let occupied: boolean;
        switch (profile) {
          case "dense":
            occupied = true;
            break;
          case "sparse": {
            const a = Math.hypot(px + 0.46, py - 0.12, pz + 0.2) < 0.075;
            const b = Math.hypot(px - 0.28, py + 0.34, pz - 0.31) < 0.055;
            const c = Math.hypot(px - 0.12, py - 0.4, pz + 0.43) < 0.04;
            occupied = a || b || c;
            break;
          }
          case "nonlinear": {
            // A thin three-turn warped ring: representative of a nonlinear
            // attractor whose occupied support bends through otherwise empty
            // volume rather than a hierarchy-friendly axis-aligned solid.
            const radius = Math.hypot(px, py);
            const angle = Math.atan2(py, px);
            const warpedZ = 0.32 * Math.sin(angle * 3 + radius * 4);
            occupied = Math.hypot(radius - 0.58, pz - warpedZ) < 0.035;
            break;
          }
        }
        if (occupied) data[(x + y * SIZE + z * SIZE * SIZE) * 4 + 3] = 255;
      }
    }
  }
  return data;
}

function rayLattices(data: Uint8Array): RayLattice[] {
  const steps = marchStepsForGrid(SIZE);
  const volume = {
    data,
    size: SIZE,
    boundsMin: [0, 0, 0] as [number, number, number],
    boundsMax: [1, 1, 1] as [number, number, number],
  };
  const rays: RayLattice[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = (x + 0.5) / WIDTH;
      const v = (y + 0.5) / HEIGHT;
      const phase = hash(x + 0.5, y + 0.5);
      const density = new Float32Array(steps);
      let firstHit = -1;
      for (let sample = 0; sample < steps; sample++) {
        const w = (phase + sample) / steps;
        density[sample] = samplePackedVoxelDensity(volume, [u, v, w]);
        if (firstHit < 0 && density[sample] > THRESHOLD) firstHit = sample;
      }
      rays.push({
        u,
        v,
        phase,
        density,
        firstHit,
        baselineReads: firstHit < 0 ? steps : firstHit + 1,
      });
    }
  }
  return rays;
}

function baseCellAtUv(uv: number): number {
  return Math.max(0, Math.min(SIZE, Math.floor(uv * SIZE + 0.5)));
}

function nodeCoordinate(uv: number, level: VoxelMaxHierarchyLevel): number {
  return Math.min(
    level.size - 1,
    Math.floor(baseCellAtUv(uv) / level.cellSpan),
  );
}

function nodeUpperUv(node: number, level: VoxelMaxHierarchyLevel): number {
  const firstCell = node * level.cellSpan;
  const lastCell = Math.min(SIZE, firstCell + level.cellSpan - 1);
  return lastCell === SIZE ? 1 : (lastCell + 0.5) / SIZE;
}

function nodeMax(
  hierarchy: VoxelMaxHierarchy,
  level: VoxelMaxHierarchyLevel,
  x: number,
  y: number,
  z: number,
): number {
  return hierarchy.data[
    level.offset + x + y * level.size + z * level.size * level.size
  ];
}

function traverse(
  rays: readonly RayLattice[],
  hierarchy: VoxelMaxHierarchy,
  level: VoxelMaxHierarchyLevel,
): TraversalCounts {
  const steps = marchStepsForGrid(SIZE);
  const dt = 1 / steps;
  const counts: TraversalCounts = {
    hierarchyReads: 0,
    volumeReads: 0,
    skippedSamples: 0,
    hitMismatches: 0,
  };

  for (const ray of rays) {
    const nodeX = nodeCoordinate(ray.u, level);
    const nodeY = nodeCoordinate(ray.v, level);
    let sample = 0;
    let occupiedUntil = -Infinity;
    let acceleratedHit = -1;
    while (sample < steps) {
      const w = (ray.phase + sample) * dt;
      if (w > occupiedUntil) {
        const nodeZ = nodeCoordinate(w, level);
        counts.hierarchyReads++;
        const maxAlpha = nodeMax(hierarchy, level, nodeX, nodeY, nodeZ);
        const upper = nodeUpperUv(nodeZ, level);
        if (Math.fround(maxAlpha / 255) <= Math.fround(THRESHOLD)) {
          // Advance to the first fixed-lattice sample not conservatively
          // inside this node. The tiny quotient bias makes an exact boundary
          // land and re-check rather than risk rounding one sample beyond it.
          const quotient = Math.max(0, (upper - w) / dt - 1e-7);
          const advance = Math.max(1, Math.floor(quotient) + 1);
          counts.skippedSamples += Math.min(advance, steps - sample);
          sample += advance;
          continue;
        }
        occupiedUntil = upper;
      }

      counts.volumeReads++;
      if (ray.density[sample] > THRESHOLD) {
        acceleratedHit = sample;
        break;
      }
      sample++;
    }
    if (acceleratedHit !== ray.firstHit) counts.hitMismatches++;
  }
  return counts;
}

describe("single-level Solid hierarchy traversal", () => {
  it("prices span 8/16/32 on matched sparse, dense, and nonlinear rays", () => {
    const rows: Record<string, string | number>[] = [];
    for (const profile of ["sparse", "dense", "nonlinear"] as const) {
      const data = packedVolume(profile);
      const hierarchy = buildVoxelMaxHierarchy(data, SIZE);
      const rays = rayLattices(data);
      const baselineReads = rays.reduce(
        (sum, ray) => sum + ray.baselineReads,
        0,
      );
      const hits = rays.filter((ray) => ray.firstHit >= 0).length;

      for (const span of SPANS) {
        const level = hierarchy.levels.find(
          (candidate) => candidate.cellSpan === span,
        );
        expect(level).toBeDefined();
        const counts = traverse(rays, hierarchy, level!);
        expect(counts.hitMismatches).toBe(0);
        expect(counts.volumeReads).toBeLessThanOrEqual(baselineReads);
        expect(counts.hierarchyReads).toBeLessThanOrEqual(baselineReads);
        rows.push({
          profile,
          span,
          nodes: `${level!.size}³`,
          levelKiB: (level!.length / 1024).toFixed(2),
          rays: rays.length,
          hits,
          baselineRGBA: baselineReads,
          acceleratedRGBA: counts.volumeReads,
          hierarchyR8: counts.hierarchyReads,
          rgbaSavedPct: (
            (1 - counts.volumeReads / baselineReads) *
            100
          ).toFixed(1),
          totalFetchRatio: (
            (counts.volumeReads + counts.hierarchyReads) /
            baselineReads
          ).toFixed(3),
          hierarchyPerRay: (counts.hierarchyReads / rays.length).toFixed(2),
          hitMismatches: counts.hitMismatches,
        });
      }
    }

    console.log(
      `\nSingle-level fixed-lattice model: ${SIZE}³, ${WIDTH}x${HEIGHT} orthographic rays, ${marchStepsForGrid(SIZE)} steps, threshold ${THRESHOLD}`,
    );
    console.log(
      "totalFetchRatio weights nearest R8 and trilinear RGBA8 equally; real GPU timing must decide their actual relative cost.",
    );
    console.table(rows);
    expect(rows).toHaveLength(9);
  });
});
