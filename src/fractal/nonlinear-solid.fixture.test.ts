import { toTransform4 } from "./affine4";
import { transformColors } from "./color";
import { plotPoint, prepareChaosGame, stepOrbit } from "./chaos-game";
import { plotPoint4, prepareChaosGame4, stepOrbit4 } from "./chaos-game-4d";
import { composeRotorProjection4 } from "./project4";
import type { FourDView } from "./project4";
import { mulberry32 } from "./rng";
import type { Transform, Vec3, Vec4 } from "./types";
import {
  accumulateVoxels,
  computeVoxelBounds,
  createVoxelGrid,
  voxelTextureData,
} from "./voxel";
import type { VoxelBounds } from "./voxel";
import { accumulateVoxels4, computeVoxelBounds4 } from "./voxel-4d";

/**
 * A deliberately small nonlinear IFS fixture for render-path regressions.
 * This is the literal two-map swirl-plus-linear reference scene: BOTH maps
 * author that same blend, with asymmetric affine poses and blend strengths.
 * Keeping it at exactly two maps makes a seeded routing trace readable while
 * still exercising nonlinear blending in the real chaos-game and Solid loops.
 */
function canonicalTwoMapSystem(): Transform[] {
  return [
    {
      id: 0,
      position: [-0.34, 0.08, -0.06],
      rotation: [0.11, -0.17, 0.07],
      scale: [0.48, 0.44, 0.42],
      variations: [
        { type: "linear", weight: 0.72 },
        { type: "swirl", weight: 0.28 },
      ],
    },
    {
      id: 1,
      position: [0.36, -0.1, 0.09],
      rotation: [-0.09, 0.19, -0.05],
      scale: [0.45, 0.49, 0.41],
      variations: [
        { type: "linear", weight: 0.78 },
        { type: "swirl", weight: 0.22 },
      ],
    },
  ];
}

/** Separate stochastic coverage: Julia is a plot-time lens so its random
 * half-turn is exercised without changing the canonical scene's two maps or
 * feeding a lens-only perturbation back into their attractor. */
function stochasticJuliaLens(): Transform {
  return {
    id: 2,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "julia", weight: 1 }],
  };
}

const FIXTURE_SEED = 0x51d0cafe;
const BOUNDS_SAMPLES = 4_000;
const VOXEL_ITERATIONS = 2_000;
const VOXEL_SIZE = 16;

// Identity rotation about the origin: project x/y/z unchanged and use w only
// as the signed slice signal. The slice is off in this regression, matching a
// full-cloud 4D Solid render with no view-dependent filtering in the way.
// prettier-ignore
const IDENTITY_ROTOR = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const FLAT_ROTOR_PROJECTION = composeRotorProjection4(
  IDENTITY_ROTOR,
  [0, 0, 0, 0],
);

const FULL_4D_VIEW: FourDView = {
  invWAmp: 1,
  sliceOn: false,
  sliceCenter: 0,
  sliceWidth: 1,
  sliceRelativeColor: false,
};

function fixedBounds(half: number): VoxelBounds {
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

function round(values: readonly number[]): number[] {
  return values.map((value) => Number(value.toFixed(9)));
}

function trace3(seed: number): { indices: number[]; last: number[] } {
  const prepared = prepareChaosGame(canonicalTwoMapSystem());
  const rng = mulberry32(seed);
  let point: Vec3 = [0.125, -0.25, 0.375];
  const indices: number[] = [];
  for (let i = 0; i < 12; i++) {
    const step = stepOrbit(prepared, point[0], point[1], point[2], rng);
    point = [step.x, step.y, step.z];
    indices.push(step.index);
  }
  return { indices, last: round(point) };
}

function traceLifted4(seed: number): {
  indices: number[];
  last: number[];
} {
  const prepared = prepareChaosGame4(canonicalTwoMapSystem().map(toTransform4));
  const rng = mulberry32(seed);
  let point: Vec4 = [0.125, -0.25, 0.375, 0];
  const indices: number[] = [];
  for (let i = 0; i < 12; i++) {
    const step = stepOrbit4(
      prepared,
      point[0],
      point[1],
      point[2],
      point[3],
      rng,
    );
    point = [step.x, step.y, step.z, step.w];
    indices.push(step.index);
  }
  return { indices, last: round(point) };
}

function textureHash(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  return hash >>> 0;
}

describe("canonical two-map linear + swirl Solid fixture", () => {
  it("pins the two-map routing through the real 3D prepare/step seams", () => {
    const transforms = canonicalTwoMapSystem();
    expect(transforms).toHaveLength(2);
    expect(
      transforms.map((transform) =>
        transform.variations?.map((variation) => variation.type),
      ),
    ).toEqual([
      ["linear", "swirl"],
      ["linear", "swirl"],
    ]);

    const first = trace3(FIXTURE_SEED);
    const repeated = trace3(FIXTURE_SEED);

    expect(first).toEqual(repeated);
    expect(first).toEqual({
      // Both nonlinear maps fire; the explicit sequence is the evidence that
      // this exact seed and the ordinary uniform two-map routing stay pinned.
      indices: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1],
      last: [0.400199279, -0.007720836, 0.11471955],
    });
    expect(trace3(FIXTURE_SEED + 1)).not.toEqual(first);
  });

  it("passes the authored maps unchanged through the production 3D voxel path", () => {
    const transforms = canonicalTwoMapSystem();
    const authored = structuredClone(transforms);
    const prepared = prepareChaosGame(transforms);

    expect(prepared.baseTransformCount).toBe(2);
    expect(prepared.variations.every((variation) => variation !== null)).toBe(
      true,
    );

    // This is the same seeded bounds-then-accumulate order the Solid worker
    // uses. In particular no variation is stripped or substituted on entry.
    const rng = mulberry32(FIXTURE_SEED);
    const bounds = computeVoxelBounds(prepared, rng, BOUNDS_SAMPLES);
    const grid = accumulateVoxels(
      prepared,
      createVoxelGrid(VOXEL_SIZE, bounds),
      VOXEL_ITERATIONS,
      rng,
      transformColors(transforms.length),
    );
    const density = Array.from(grid.density);

    expect(transforms).toEqual(authored);
    expect({
      bounds: [...round(bounds.min), ...round(bounds.max)],
      hits: density.reduce((sum, value) => sum + value, 0),
      occupied: density.filter((value) => value > 0).length,
      maxDensity: grid.maxDensity,
      orbit: round(grid.orbit ?? []),
      textureHash: textureHash(voxelTextureData(grid)),
    }).toEqual({
      bounds: [
        -0.456254152, -0.544309861, -0.53880121, 0.564365161, 0.476309453,
        0.481818104,
      ],
      hits: 2_000,
      occupied: 22,
      maxDensity: 252,
      orbit: [0.523486076, 0.038785807, 0.086385718],
      textureHash: 45_303_526,
    });
  });

  it("keeps the same nonlinear blend and routing in its 4D lift and voxelizes it through Solid-4D", () => {
    const transforms = canonicalTwoMapSystem();
    const authored = structuredClone(transforms);
    const lifted = transforms.map(toTransform4);
    const prepared = prepareChaosGame4(lifted);

    expect(lifted.map((transform) => transform.variations)).toEqual(
      transforms.map((transform) => transform.variations),
    );
    expect(prepared.baseTransformCount).toBe(2);
    expect(prepared.variations.every((variation) => variation !== null)).toBe(
      true,
    );

    const trace = traceLifted4(FIXTURE_SEED);
    expect(trace.indices).toEqual(trace3(FIXTURE_SEED).indices);
    expect(trace.last).toEqual([...trace3(FIXTURE_SEED).last, 0]);

    const rng = mulberry32(FIXTURE_SEED);
    const bounds = computeVoxelBounds4(
      prepared,
      FLAT_ROTOR_PROJECTION,
      FULL_4D_VIEW,
      rng,
      BOUNDS_SAMPLES,
    );
    const grid = accumulateVoxels4(
      prepared,
      createVoxelGrid(VOXEL_SIZE, bounds),
      VOXEL_ITERATIONS,
      rng,
      FLAT_ROTOR_PROJECTION,
      FULL_4D_VIEW,
      { kind: "transform", palette: transformColors(lifted.length) },
    );
    const density = Array.from(grid.density);

    expect(transforms).toEqual(authored);
    expect({
      bounds: [...round(bounds.min), ...round(bounds.max)],
      hits: density.reduce((sum, value) => sum + value, 0),
      occupied: density.filter((value) => value > 0).length,
      maxDensity: grid.maxDensity,
      orbit: [...round(grid.orbit ?? []), ...round([grid.orbitW])],
      textureHash: textureHash(voxelTextureData(grid)),
    }).toEqual({
      bounds: [
        -0.456254152, -0.544309861, -0.53880121, 0.564365161, 0.476309453,
        0.481818104,
      ],
      hits: 2_000,
      occupied: 22,
      maxDensity: 252,
      orbit: [-0.099011214, 0.05171465, 0.01952399, 0],
      textureHash: 971_933_182,
    });
  });

  it("covers a stochastic Julia lens separately in the real 3D and 4D plot/voxel paths", () => {
    const transforms = canonicalTwoMapSystem();
    const lens = stochasticJuliaLens();
    const prepared = prepareChaosGame(transforms, lens);
    const lifted = transforms.map(toTransform4);
    const prepared4 = prepareChaosGame4(lifted, toTransform4(lens));

    const plotted = round(
      plotPoint(prepared, 0.3, -0.2, 0.1, mulberry32(FIXTURE_SEED)),
    );
    const plottedAgain = round(
      plotPoint(prepared, 0.3, -0.2, 0.1, mulberry32(FIXTURE_SEED)),
    );
    const plotted4 = round(
      plotPoint4(prepared4, 0.3, -0.2, 0.1, 0, mulberry32(FIXTURE_SEED)),
    );

    expect(plottedAgain).toEqual(plotted);
    expect(plotted).toEqual([0.574697802, -0.174004494, 0.1]);
    expect(plotted4).toEqual([...plotted, 0]);
    expect(
      round(plotPoint(prepared, 0.3, -0.2, 0.1, mulberry32(FIXTURE_SEED + 1))),
    ).not.toEqual(plotted);

    const bounds = fixedBounds(2);
    const palette = transformColors(transforms.length);
    const run3 = (seed: number) =>
      accumulateVoxels(
        prepared,
        createVoxelGrid(8, bounds),
        256,
        mulberry32(seed),
        palette,
      );
    const run4 = (seed: number) =>
      accumulateVoxels4(
        prepared4,
        createVoxelGrid(8, bounds),
        256,
        mulberry32(seed),
        FLAT_ROTOR_PROJECTION,
        FULL_4D_VIEW,
        { kind: "transform", palette },
      );

    const three = voxelTextureData(run3(FIXTURE_SEED));
    const four = voxelTextureData(run4(FIXTURE_SEED));
    expect(textureHash(three)).toBe(3_557_500_977);
    expect(textureHash(four)).toBe(1_102_098_358);
    expect(voxelTextureData(run3(FIXTURE_SEED))).toEqual(three);
    expect(voxelTextureData(run4(FIXTURE_SEED))).toEqual(four);
    expect(voxelTextureData(run3(FIXTURE_SEED + 1))).not.toEqual(three);
    expect(voxelTextureData(run4(FIXTURE_SEED + 1))).not.toEqual(four);
  });
});
