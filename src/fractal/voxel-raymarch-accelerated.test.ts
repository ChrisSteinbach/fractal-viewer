import {
  buildVoxelMaxHierarchy,
  VOXEL_MAX_HIERARCHY_TRAVERSAL_CELL_SPAN,
} from "./voxel-max-hierarchy";
import type { VoxelMaxHierarchy } from "./voxel-max-hierarchy";
import { raymarchPackedVoxelDensity } from "./voxel-raymarch";
import type {
  PackedVoxelDensityVolume,
  VoxelDensityRay,
  VoxelDensityRaymarchOptions,
} from "./voxel-raymarch";
import {
  raymarchPackedVoxelDensityAccelerated,
  voxelAccelerationLevelIndex,
} from "./voxel-raymarch-accelerated";

function volumeFromAlpha(
  size: number,
  alphaAt: (x: number, y: number, z: number) => number,
): PackedVoxelDensityVolume {
  const data = new Uint8Array(size ** 3 * 4);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        data[(x + y * size + z * size * size) * 4 + 3] = alphaAt(x, y, z);
      }
    }
  }
  return {
    data,
    size,
    boundsMin: [0, 0, 0],
    boundsMax: [1, 1, 1],
  };
}

function expectAgreement(
  volume: PackedVoxelDensityVolume,
  ray: VoxelDensityRay,
  options: VoxelDensityRaymarchOptions,
  hierarchy: VoxelMaxHierarchy = buildVoxelMaxHierarchy(
    volume.data,
    volume.size,
  ),
) {
  const reference = raymarchPackedVoxelDensity(volume, ray, options);
  const accelerated = raymarchPackedVoxelDensityAccelerated(
    volume,
    hierarchy,
    ray,
    options,
  );

  expect(accelerated.hit).toBe(reference.hit);
  expect(accelerated.stepSize).toBe(reference.stepSize);
  expect(accelerated.traversal.latticeSteps).toBe(reference.marchSamples);
  expect(accelerated.marchSamples).toBeLessThanOrEqual(reference.marchSamples);
  if (reference.hit) {
    expect(accelerated.hit).toBe(true);
    if (!accelerated.hit) return accelerated;
    expect(accelerated.tNear).toBe(reference.tNear);
    expect(accelerated.tFar).toBe(reference.tFar);
    expect(accelerated.t).toBe(reference.t);
    expect(accelerated.position).toEqual(reference.position);
    expect(accelerated.density).toBe(reference.density);
    expect(accelerated.refinementSamples).toBe(reference.refinementSamples);
    expect(accelerated.crossing).toEqual(reference.crossing);
  } else {
    expect(accelerated.hit).toBe(false);
    if (accelerated.hit) return accelerated;
    expect(accelerated.reason).toBe(reference.reason);
    expect(accelerated.interval).toEqual(reference.interval);
  }
  expect(accelerated.traversal.densitySamples).toBe(
    accelerated.traversal.primaryDensitySamples +
      accelerated.traversal.evidenceDensitySamples +
      accelerated.traversal.refinementDensitySamples,
  );
  return accelerated;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("raymarchPackedVoxelDensityAccelerated adversarial agreement", () => {
  it("keeps the isolated far-corner boundary halo visible in both ray directions", () => {
    const size = 32;
    const volume = volumeFromAlpha(size, (x, y, z) =>
      x === size - 1 && y === size - 1 && z === size - 1 ? 255 : 0,
    );
    const forward = expectAgreement(
      volume,
      { origin: [-0.25, -0.25, -0.25], direction: [1, 1, 1] },
      { threshold: 0.1, marchSteps: 100, phase: 0.37 },
    );
    const backward = expectAgreement(
      volume,
      { origin: [1.25, 1.25, 1.25], direction: [-1, -1, -1] },
      { threshold: 0.1, marchSteps: 100, phase: 0 },
    );

    expect(forward.hit).toBe(true);
    expect(forward.traversal.skippedSamples).toBeGreaterThan(0);
    // The clamped boundary half-cell is already occupied on entry.
    expect(backward.hit).toBe(true);
    expect(backward.traversal.latticeSteps).toBe(1);
  });

  it("preserves the original phase lattice across empty-node exits near a one-texel band", () => {
    const size = 32;
    const volume = volumeFromAlpha(size, (x) => (x === 24 ? 255 : 0));
    for (const phase of [0, 0.01, 0.49, 0.99]) {
      const result = expectAgreement(
        volume,
        { origin: [-0.2, 0.5, 0.5], direction: [1, 0, 0] },
        { threshold: 0.4, marchSteps: 64, phase },
      );
      expect(result.hit).toBe(true);
      expect(result.traversal.skippedSamples).toBeGreaterThan(0);
    }
  });

  it("does not skip a one-texel-thin diagonal under oblique crossings", () => {
    const size = 8;
    const volume = volumeFromAlpha(size, (x, y, z) =>
      x === y && y === z ? 220 : 0,
    );
    const cases: Array<[VoxelDensityRay, number]> = [
      [{ origin: [-0.3, 0.05, 0.1], direction: [0.5, 0.15, 0.1] }, 0.13],
      [{ origin: [1.3, 0.9, 0.8], direction: [-0.5, -0.1, -0.05] }, 0.61],
      [{ origin: [0.2, -0.4, 0.1], direction: [0.3, 0.9, 0.4] }, 0.92],
    ];
    for (const [ray, phase] of cases) {
      expectAgreement(volume, ray, {
        threshold: 80 / 255,
        marchSteps: 127,
        phase,
      });
    }
  });

  it("uses exact CPU threshold equality rather than f32-collapsing a near hit", () => {
    const volume = volumeFromAlpha(1, () => 128);
    const threshold = 128 / 255 - Number.EPSILON;
    const result = expectAgreement(
      volume,
      { origin: [-1, 0.5, 0.5], direction: [1, 0, 0] },
      { threshold, marchSteps: 4 },
    );

    expect(result.hit).toBe(true);
    expect(result.traversal.skippedSamples).toBe(0);
  });
});

describe("raymarchPackedVoxelDensityAccelerated property agreement", () => {
  it("agrees for seeded sparse and dense volumes, rays, phases, and thresholds", () => {
    const random = lcg(0x517cc1b7);
    for (const size of [3, 7, 17, 32]) {
      for (const density of ["sparse", "dense"] as const) {
        const volume = volumeFromAlpha(size, () => {
          if (density === "sparse" && random() > 0.08) return 0;
          if (density === "dense" && random() > 0.8) return 0;
          return 1 + Math.floor(random() * 255);
        });
        const hierarchy = buildVoxelMaxHierarchy(volume.data, volume.size);
        for (let caseIndex = 0; caseIndex < 48; caseIndex++) {
          const axis = caseIndex % 3;
          const side = caseIndex % 2 === 0 ? -0.25 : 1.25;
          const origin: [number, number, number] = [
            random(),
            random(),
            random(),
          ];
          origin[axis] = side;
          const target: [number, number, number] = [
            random(),
            random(),
            random(),
          ];
          const direction: [number, number, number] = [
            target[0] - origin[0],
            target[1] - origin[1],
            target[2] - origin[2],
          ];
          const thresholds = [0, 0.2, 0.5, 128 / 255, 0.9, 1];
          expectAgreement(
            volume,
            { origin, direction },
            {
              threshold: thresholds[caseIndex % thresholds.length],
              marchSteps: 9 + Math.floor(random() * 111),
              phase: random(),
            },
            hierarchy,
          );
        }
      }
    }
  });
});

describe("raymarchPackedVoxelDensityAccelerated instrumentation", () => {
  it("reports a root skip with zero density reads for a wholly empty ray", () => {
    const volume = volumeFromAlpha(15, () => 0);
    const result = expectAgreement(
      volume,
      { origin: [-1, 0.5, 0.5], direction: [1, 0, 0] },
      { threshold: 0, marchSteps: 64 },
    );

    expect(result).toMatchObject({
      hit: false,
      marchSamples: 0,
      traversal: {
        latticeSteps: 64,
        skippedSamples: 64,
        skipRanges: 1,
        hierarchyNodeTests: 1,
        primaryDensitySamples: 0,
        evidenceDensitySamples: 0,
        refinementDensitySamples: 0,
        densitySamples: 0,
      },
    });
  });

  it("reports sampling and refinement without fabricated skips for a full volume", () => {
    const volume = volumeFromAlpha(8, () => 255);
    const result = expectAgreement(
      volume,
      { origin: [-1, 0.5, 0.5], direction: [1, 0, 0] },
      { threshold: 0.3, marchSteps: 64 },
    );

    expect(result).toMatchObject({
      hit: true,
      marchSamples: 1,
      refinementSamples: 5,
      traversal: {
        latticeSteps: 1,
        skippedSamples: 0,
        skipRanges: 0,
        primaryDensitySamples: 1,
        evidenceDensitySamples: 0,
        refinementDensitySamples: 5,
        densitySamples: 6,
      },
    });
  });

  it("caches an occupied span-16 node instead of hierarchy-testing every dense sample", () => {
    const size = 32;
    // One bright off-ray line keeps every selected x-node occupied; the
    // center ray itself stays exactly zero and must take all 64 samples.
    const volume = volumeFromAlpha(size, (_x, y, z) =>
      y === 20 && z === 20 ? 255 : 0,
    );
    const hierarchy = buildVoxelMaxHierarchy(volume.data, volume.size);
    const levelIndex = voxelAccelerationLevelIndex(hierarchy);
    expect(hierarchy.levels[levelIndex].cellSpan).toBe(
      VOXEL_MAX_HIERARCHY_TRAVERSAL_CELL_SPAN,
    );
    const result = expectAgreement(
      volume,
      { origin: [-1, 0.5, 0.5], direction: [1, 0, 0] },
      { threshold: 0.3, marchSteps: 64 },
      hierarchy,
    );

    expect(result).toMatchObject({
      hit: false,
      traversal: {
        latticeSteps: 64,
        skippedSamples: 0,
        primaryDensitySamples: 64,
      },
    });
    expect(result.traversal.hierarchyNodeTests).toBeLessThanOrEqual(3);
  });

  it("rejects a hierarchy for a different source resolution", () => {
    const volume = volumeFromAlpha(4, () => 0);
    const wrong = volumeFromAlpha(3, () => 0);
    expect(() =>
      raymarchPackedVoxelDensityAccelerated(
        volume,
        buildVoxelMaxHierarchy(wrong.data, wrong.size),
        { origin: [-1, 0.5, 0.5], direction: [1, 0, 0] },
        { threshold: 0.3, marchSteps: 32 },
      ),
    ).toThrow(/source size/);
  });
});
