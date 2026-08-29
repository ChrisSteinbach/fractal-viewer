import {
  raymarchPackedVoxelDensity,
  samplePackedVoxelDensity,
  sampleVoxelAlpha,
} from "./voxel-raymarch";
import type { PackedVoxelDensityVolume } from "./voxel-raymarch";

function xRampVolume(): PackedVoxelDensityVolume {
  const data = new Uint8Array(2 * 2 * 2 * 4);
  for (let z = 0; z < 2; z++) {
    for (let y = 0; y < 2; y++) {
      data[(0 + y * 2 + z * 4) * 4 + 3] = 0;
      data[(1 + y * 2 + z * 4) * 4 + 3] = 255;
    }
  }
  return {
    data,
    size: 2,
    boundsMin: [0, 0, 0],
    boundsMax: [2, 2, 2],
  };
}

describe("samplePackedVoxelDensity", () => {
  it("uses WebGL texel centers, x-fastest layout, and trilinear reconstruction", () => {
    const data = new Uint8Array(2 * 2 * 2 * 4);
    for (let i = 0; i < 8; i++) data[i * 4 + 3] = i * 20;
    const volume = {
      data,
      size: 2,
      boundsMin: [0, 0, 0],
      boundsMax: [2, 2, 2],
    } satisfies PackedVoxelDensityVolume;

    expect(samplePackedVoxelDensity(volume, [0.5, 0.5, 0.5])).toBe(0);
    expect(samplePackedVoxelDensity(volume, [1.5, 1.5, 1.5])).toBe(140 / 255);
    expect(samplePackedVoxelDensity(volume, [1, 1, 1])).toBeCloseTo(
      70 / 255,
      12,
    );
  });

  it("exposes ClampToEdge sampling separately from bounded outside-zero queries", () => {
    const volume = xRampVolume();

    expect(samplePackedVoxelDensity(volume, [3, 1, 1])).toBe(1);
    expect(
      sampleVoxelAlpha(
        volume.data,
        volume.size,
        volume.boundsMin,
        volume.boundsMax,
        [3, 1, 1],
      ),
    ).toBe(0);
  });
});

describe("raymarchPackedVoxelDensity", () => {
  it("mirrors strict threshold crossing and five-step shader refinement", () => {
    const result = raymarchPackedVoxelDensity(
      xRampVolume(),
      { origin: [-1, 1, 1], direction: [2, 0, 0] },
      { threshold: 0.5, marchSteps: 4 },
    );

    expect(result.hit).toBe(true);
    if (!result.hit) return;
    expect(result.tNear).toBe(1);
    expect(result.tFar).toBe(3);
    expect(result.stepSize).toBe(0.5);
    expect(result.marchSamples).toBe(4);
    expect(result.refinementSamples).toBe(5);
    // The stride sample at world x=1 has density exactly 0.5 and is outside:
    // the shader's isosurface test is strict `>` rather than `>=`.
    expect(result.crossing.lastOutside).toEqual({ t: 2, density: 0.5 });
    expect(result.crossing.firstInside).toEqual({ t: 2.5, density: 1 });
    expect(result.crossing.refinedOutside.density).toBe(0.5);
    expect(result.t).toBe(2.015625);
    expect(result.position).toEqual([1.015625, 1, 1]);
    expect(result.density).toBe(0.515625);
  });

  it("makes the renderer's jitter phase explicit and deterministic", () => {
    const result = raymarchPackedVoxelDensity(
      xRampVolume(),
      { origin: [-1, 1, 1], direction: [1, 0, 0] },
      {
        threshold: 0.5,
        marchSteps: 4,
        phase: 0.5,
        refinementSteps: 0,
      },
    );

    expect(result.hit).toBe(true);
    if (!result.hit) return;
    expect(result.crossing.lastOutside).toEqual({ t: 1.75, density: 0.25 });
    expect(result.crossing.firstInside).toEqual({ t: 2.25, density: 0.75 });
    expect(result.t).toBe(2.25);
  });

  it("reports a collapsed bracket when the first in-box sample is inside", () => {
    const result = raymarchPackedVoxelDensity(
      xRampVolume(),
      { origin: [1.25, 1, 1], direction: [1, 0, 0] },
      { threshold: 0.5, marchSteps: 4 },
    );

    expect(result.hit).toBe(true);
    if (!result.hit) return;
    expect(result.t).toBe(0);
    expect(result.crossing.lastOutside).toBeNull();
    expect(result.crossing.refinedOutside).toEqual(
      result.crossing.refinedInside,
    );
  });

  it("distinguishes a box miss from an in-box threshold miss", () => {
    const volume = xRampVolume();
    const boundsMiss = raymarchPackedVoxelDensity(
      volume,
      { origin: [-1, 3, 1], direction: [1, 0, 0] },
      { threshold: 0.5, marchSteps: 4 },
    );
    const thresholdMiss = raymarchPackedVoxelDensity(
      volume,
      { origin: [-1, 1, 1], direction: [1, 0, 0] },
      { threshold: 1, marchSteps: 4 },
    );

    expect(boundsMiss).toMatchObject({
      hit: false,
      reason: "bounds",
      interval: null,
      marchSamples: 0,
    });
    expect(thresholdMiss).toMatchObject({
      hit: false,
      reason: "threshold",
      interval: { tNear: 1, tFar: 3 },
      marchSamples: 4,
    });
  });
});
