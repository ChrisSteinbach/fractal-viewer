import { accumulateVoxels4, computeVoxelBounds4 } from "./voxel-4d";
import { BOUNDS_MARGIN, BOUNDS_QUANTILE, createVoxelGrid } from "./voxel";
import type { VoxelBounds } from "./voxel";
import { WARMUP_ITERATIONS } from "./chaos-game";
import { plotPoint4, prepareChaosGame4, stepOrbit4 } from "./chaos-game-4d";
import { rotationMatrix4, toTransform4 } from "./affine4";
import {
  buildColorModeLUT,
  transformColors,
  wRampColor,
  W_SIDE_PALETTES,
} from "./color";
import type { FourDRenderColor } from "./color";
import { buildPaletteLUT } from "./palette";
import { composeRotorProjection4 } from "./project4";
import type { FourDView, RotorProjection4 } from "./project4";
import { pentatope } from "./presets";
import { mulberry32 } from "./rng";
import type { Transform4, Vec4 } from "./types";

/** A single map that ignores its input and always lands exactly on `point`:
 * scale 0 collapses the linear part to zero, so every orbit step (including
 * warmup) returns `point` unchanged — the 4D twin of `voxel.test.ts`'s
 * `fixedPointSystem`. */
function fixedPointSystem4(point: Vec4): Transform4[] {
  return [{ position: point, scale: [0, 0, 0, 0] }];
}

/** The pentatope gasket, embedded flat (w = 0) via `toTransform4`, but
 * weighted unevenly (1..5) so the "weighted" pick path in `pickIndex4` is
 * genuinely exercised — mirrors `flame-4d.test.ts`'s own fixture. */
function weightedPentatope(): Transform4[] {
  return pentatope()
    .map(toTransform4)
    .map((t, i) => ({ ...t, weight: i + 1 }));
}

/** A symmetric cube around the origin, so voxel indices are easy to predict —
 * the 4D twin of `voxel.test.ts`'s `unitishBounds`. */
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

/** Row-major 4x4 identity rotor — no rotation, so the rotor-projection step
 * degenerates to "drop w, keep xyz", exactly like an inert 4D view. */
// prettier-ignore
const IDENTITY_ROTOR = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/** The identity-rotor-about-the-origin projection: `(x, y, z, w, 1) -> (x,
 * y, z, w)` verbatim (`px = x`, `py = y`, `pz = z`, `sRaw = w`) — for tests
 * that aren't exercising the rotor/center math itself. */
const FLAT_ROTOR_PROJ: RotorProjection4 = composeRotorProjection4(
  IDENTITY_ROTOR,
  [0, 0, 0, 0],
);

const FLAT_VIEW: FourDView = {
  invWAmp: 1,
  sliceOn: false,
  sliceCenter: 0,
  sliceWidth: 1,
};

describe("accumulateVoxels4 vs. stepOrbit4/plotPoint4 (correctness oracle)", () => {
  it("matches a reference loop built directly from stepOrbit4/plotPoint4 and the two-step rotor projection, iteration for iteration", () => {
    // A genuinely 4D weighted system (varying weights) with a final
    // transform that mixes x into w (real w-spread), projected by hand via
    // the documented two-step rotor math (rotate about center, drop w, add
    // back xyz) with a non-identity rotor and nonzero center — mirrors
    // flame-4d.test.ts's own oracle one render-target up.
    const transforms4 = weightedPentatope();
    const finalTransform4: Transform4 = {
      position: [0.15, -0.1, 0.05, 0.2],
      scale: [1.1, 1.1, 1.1, 1.1],
      rotation: { xw: 0.25, yz: 0.4 },
    };
    const prepared = prepareChaosGame4(transforms4, finalTransform4);
    const palette = transformColors(transforms4.length);
    const bounds = unitishBounds(3);
    const size = 8;
    const iterations = 2000;
    const seed = 42;

    const rotor = rotationMatrix4({ xw: 0.35, yw: -0.2, xy: 0.15 });
    const center: Vec4 = [0.05, -0.03, 0.02, 0.1];
    const rotorProj = composeRotorProjection4(rotor, center);
    // sliceOn: false — the slice/ghost-floor weighting has its own dedicated
    // tests below (fixed-point systems, immune to the ULP noise a real
    // weighted Gaussian would introduce over thousands of iterations); this
    // oracle isolates the projection/plot/pick/bucketing math, weight 1
    // always — see flame-4d.test.ts's oracle for the same reasoning.
    const view: FourDView = {
      invWAmp: 0.8,
      sliceOn: false,
      sliceCenter: 0.1,
      sliceWidth: 0.6,
    };

    const actual = accumulateVoxels4(
      prepared,
      createVoxelGrid(size, bounds),
      iterations,
      mulberry32(seed),
      rotorProj,
      view,
      { kind: "transform", palette },
    );

    const rng = mulberry32(seed);
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    let w = rng() - 0.5;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const step = stepOrbit4(prepared, x, y, z, w, rng);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
    }
    const expected = createVoxelGrid(size, bounds);
    const invCell = size / (bounds.max[0] - bounds.min[0]);
    for (let i = 0; i < iterations; i++) {
      const step = stepOrbit4(prepared, x, y, z, w, rng);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
      const [px, py, pz, pw] = plotPoint4(prepared, x, y, z, w, rng);

      // Two-step rotor projection, exactly as project4.ts documents:
      // q = R * (v - center); p = q.xyz + center.xyz; sRaw = q.w.
      const vx = px - center[0];
      const vy = py - center[1];
      const vz = pz - center[2];
      const vw = pw - center[3];
      const qx = rotor[0] * vx + rotor[1] * vy + rotor[2] * vz + rotor[3] * vw;
      const qy = rotor[4] * vx + rotor[5] * vy + rotor[6] * vz + rotor[7] * vw;
      const qz =
        rotor[8] * vx + rotor[9] * vy + rotor[10] * vz + rotor[11] * vw;
      const projX = qx + center[0];
      const projY = qy + center[1];
      const projZ = qz + center[2];

      const bx = Math.floor((projX - bounds.min[0]) * invCell);
      if (bx < 0 || bx >= size) continue;
      const by = Math.floor((projY - bounds.min[1]) * invCell);
      if (by < 0 || by >= size) continue;
      const bz = Math.floor((projZ - bounds.min[2]) * invCell);
      if (bz < 0 || bz >= size) continue;

      const bucket = bz * size * size + by * size + bx;
      const weight = 1; // sliceOn is false above.
      const d = expected.density[bucket] + weight;
      expected.density[bucket] = d;
      if (d > expected.maxDensity) expected.maxDensity = d;
      const rgb = palette[step.index] ?? [1, 1, 1];
      const o = bucket * 3;
      const invWeight = weight / d;
      expected.avgRGB[o] += (rgb[0] - expected.avgRGB[o]) * invWeight;
      expected.avgRGB[o + 1] += (rgb[1] - expected.avgRGB[o + 1]) * invWeight;
      expected.avgRGB[o + 2] += (rgb[2] - expected.avgRGB[o + 2]) * invWeight;
    }
    expected.orbit = [x, y, z];
    expected.orbitW = w;

    expect(actual.density).toEqual(expected.density);
    expect(actual.avgRGB).toEqual(expected.avgRGB);
    expect(actual.maxDensity).toBe(expected.maxDensity);
    expect(actual.orbit).toEqual(expected.orbit);
    expect(actual.orbitW).toBe(expected.orbitW);
    // Not a vacuous comparison of all-zero grids.
    expect(actual.maxDensity).toBeGreaterThan(0);
  });
});

describe("accumulateVoxels4 determinism", () => {
  it("produces identical grids for the same seed", () => {
    const prepared = prepareChaosGame4(weightedPentatope());
    const color: FourDRenderColor = {
      kind: "transform",
      palette: transformColors(5),
    };
    const bounds = unitishBounds(6);
    const a = accumulateVoxels4(
      prepared,
      createVoxelGrid(8, bounds),
      2000,
      mulberry32(5),
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      color,
    );
    const b = accumulateVoxels4(
      prepared,
      createVoxelGrid(8, bounds),
      2000,
      mulberry32(5),
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      color,
    );
    expect(a.density).toEqual(b.density);
    expect(a.avgRGB).toEqual(b.avgRGB);
    expect(a.orbit).toEqual(b.orbit);
    expect(a.orbitW).toBe(b.orbitW);
  });

  it("differs for a different seed", () => {
    const prepared = prepareChaosGame4(weightedPentatope());
    const color: FourDRenderColor = {
      kind: "transform",
      palette: transformColors(5),
    };
    const bounds = unitishBounds(6);
    const a = accumulateVoxels4(
      prepared,
      createVoxelGrid(8, bounds),
      2000,
      mulberry32(5),
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      color,
    );
    const b = accumulateVoxels4(
      prepared,
      createVoxelGrid(8, bounds),
      2000,
      mulberry32(6),
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      color,
    );
    expect(Array.from(a.density)).not.toEqual(Array.from(b.density));
  });
});

describe("accumulateVoxels4 progressive accumulation", () => {
  it("produces the identical grid whether run as one call or resumed across chunks (pins orbit/orbitW/orbitColor)", () => {
    const prepared = prepareChaosGame4(weightedPentatope());
    const color: FourDRenderColor = {
      kind: "transform",
      palette: transformColors(5),
    };
    const bounds = unitishBounds(6);
    const size = 8;

    const oneShot = accumulateVoxels4(
      prepared,
      createVoxelGrid(size, bounds),
      1000,
      mulberry32(11),
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      color,
    );

    const chunkedRng = mulberry32(11);
    const chunked = createVoxelGrid(size, bounds);
    accumulateVoxels4(
      prepared,
      chunked,
      400,
      chunkedRng,
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      color,
    );
    accumulateVoxels4(
      prepared,
      chunked,
      600,
      chunkedRng,
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      color,
    );

    expect(chunked.density).toEqual(oneShot.density);
    expect(chunked.avgRGB).toEqual(oneShot.avgRGB);
    expect(chunked.maxDensity).toBe(oneShot.maxDensity);
    expect(chunked.orbit).toEqual(oneShot.orbit);
    expect(chunked.orbitW).toBe(oneShot.orbitW);
    expect(chunked.orbitColor).toBe(oneShot.orbitColor);
  });
});

describe("accumulateVoxels4 bucketing and the w-slice (fr-4wd)", () => {
  it("lands a fixed-point system's every iteration in the predicted voxel", () => {
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    const grid = createVoxelGrid(4, unitishBounds(1));

    accumulateVoxels4(
      prepared,
      grid,
      10,
      mulberry32(1),
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      { kind: "transform", palette: transformColors(1) },
    );

    // World origin in a [-1, 1] cube of 4 voxels: floor((0 + 1) * 2) = 2 on
    // every axis, x-fastest layout — same as voxel.test.ts's 3D fixture.
    const bucket = 2 * 16 + 2 * 4 + 2;
    expect(grid.density[bucket]).toBe(10);
    expect(grid.maxDensity).toBe(10);
    const total = Array.from(grid.density).reduce((a, b) => a + b, 0);
    expect(total).toBe(10);
  });

  it("skips every point (density stays 0) when its slice weight underflows below the 1e-3 gate", () => {
    // A fixed point AT the rotor's pivot (the origin) has sRaw = q.w = 0
    // exactly, ~20 slice-widths from sliceCenter = 1, which underflows the
    // pure (floor-0) Gaussian to exactly 0 in double precision — see
    // flame-4d.test.ts's identical reasoning for its own ghost-floor test.
    // Floor 0 (unlike the flame's 0.06) means the weight is 0, not just
    // small, so every point is skipped entirely.
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    const grid = createVoxelGrid(4, unitishBounds(1));
    const view: FourDView = {
      invWAmp: 1,
      sliceOn: true,
      sliceCenter: 1,
      sliceWidth: 0.05,
    };

    accumulateVoxels4(
      prepared,
      grid,
      10,
      mulberry32(1),
      FLAT_ROTOR_PROJ,
      view,
      {
        kind: "transform",
        palette: transformColors(1),
      },
    );

    expect(Array.from(grid.density).every((d) => d === 0)).toBe(true);
    expect(grid.maxDensity).toBe(0);
    // The orbit still advances even though every point was skipped.
    expect(grid.orbit).toEqual([0, 0, 0]);
    expect(grid.orbitW).toBe(0);
  });

  it("lands density exactly at the iteration count when s sits exactly at the slice center (weight === 1)", () => {
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    const grid = createVoxelGrid(4, unitishBounds(1));
    const view: FourDView = {
      invWAmp: 1,
      sliceOn: true,
      sliceCenter: 0,
      sliceWidth: 0.5,
    };

    accumulateVoxels4(
      prepared,
      grid,
      10,
      mulberry32(1),
      FLAT_ROTOR_PROJ,
      view,
      {
        kind: "transform",
        palette: transformColors(1),
      },
    );

    const bucket = 2 * 16 + 2 * 4 + 2;
    expect(grid.density[bucket]).toBe(10);
    expect(grid.maxDensity).toBe(10);
  });
});

describe("accumulateVoxels4 weighted running-mean color (fr-4wd)", () => {
  it("reduces exactly to the unweighted 3D-style running mean when the slice is off", () => {
    // Two transforms that both collapse to the SAME fixed point (scale 0)
    // but are picked with different indices, so the structural color
    // coordinate `c` evolves differently each iteration even though every
    // point lands in the exact same voxel — a single-transform fixed point
    // can never vary `s`/its color at all, so this is what actually
    // exercises the weighted running-mean update.
    const point: Vec4 = [0, 0, 0, 0];
    const transforms4: Transform4[] = [
      { position: point, scale: [0, 0, 0, 0] },
      { position: point, scale: [0, 0, 0, 0] },
    ];
    const prepared = prepareChaosGame4(transforms4);
    const lut = buildPaletteLUT("spectrum");
    if (!lut) throw new Error("spectrum should have a LUT");
    const bounds = unitishBounds(1);
    const size = 4;
    const iterations = 50;

    const actual = accumulateVoxels4(
      prepared,
      createVoxelGrid(size, bounds),
      iterations,
      mulberry32(3),
      FLAT_ROTOR_PROJ,
      FLAT_VIEW, // sliceOn: false -> weight is always 1.
      { kind: "structural", lut },
    );

    // Hand-computed reference using the UNWEIGHTED 3D formula
    // (`avg += (c - avg) / d`, `voxel.ts`'s own accumulateVoxels) over the
    // identical sequence of picked transforms — weight is always 1 with the
    // slice off, so the weighted and unweighted formulas must agree exactly.
    const rng = mulberry32(3);
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    let w = rng() - 0.5;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const step = stepOrbit4(prepared, x, y, z, w, rng);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
    }
    const expected = createVoxelGrid(size, bounds);
    const invCell = size / (bounds.max[0] - bounds.min[0]);
    let c = 0.5;
    for (let i = 0; i < iterations; i++) {
      const step = stepOrbit4(prepared, x, y, z, w, rng);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
      const slot = step.index / 1; // colorDenom = transformCount - 1 = 1.
      c = (c + slot) * 0.5;

      const vx = Math.floor((x - bounds.min[0]) * invCell);
      const vy = Math.floor((y - bounds.min[1]) * invCell);
      const vz = Math.floor((z - bounds.min[2]) * invCell);
      const bucket = vz * size * size + vy * size + vx;
      const weight = 1;
      const d = expected.density[bucket] + weight;
      expected.density[bucket] = d;
      if (d > expected.maxDensity) expected.maxDensity = d;
      const li = Math.min(255, (c * 256) | 0) * 3;
      const o = bucket * 3;
      const invWeight = weight / d;
      expected.avgRGB[o] += (lut[li] - expected.avgRGB[o]) * invWeight;
      expected.avgRGB[o + 1] +=
        (lut[li + 1] - expected.avgRGB[o + 1]) * invWeight;
      expected.avgRGB[o + 2] +=
        (lut[li + 2] - expected.avgRGB[o + 2]) * invWeight;
    }
    expected.orbit = [x, y, z];
    expected.orbitW = w;
    expected.orbitColor = c;

    expect(actual.density).toEqual(expected.density);
    expect(actual.avgRGB).toEqual(expected.avgRGB);
    expect(actual.maxDensity).toBe(expected.maxDensity);
    expect(actual.orbit).toEqual(expected.orbit);
    expect(actual.orbitW).toBe(expected.orbitW);
    expect(actual.orbitColor).toBe(expected.orbitColor);
  });
});

describe("computeVoxelBounds4", () => {
  it("centers a degenerate single-point attractor on its projected xyz, dropping w, under the identity rotor", () => {
    const prepared = prepareChaosGame4(fixedPointSystem4([1, 2, 3, 4]));
    const bounds = computeVoxelBounds4(
      prepared,
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      mulberry32(1),
      1000,
    );

    expect((bounds.min[0] + bounds.max[0]) / 2).toBeCloseTo(1, 6);
    expect((bounds.min[1] + bounds.max[1]) / 2).toBeCloseTo(2, 6);
    expect((bounds.min[2] + bounds.max[2]) / 2).toBeCloseTo(3, 6);
    // Floored away from zero so the world-to-voxel mapping stays invertible.
    expect(bounds.max[0] - bounds.min[0]).toBeGreaterThan(0);
  });

  it("matches a direct computation of the trimmed quantiles for a flat embedded system under the identity rotor", () => {
    const transforms4 = weightedPentatope();
    const prepared = prepareChaosGame4(transforms4);
    const samples = 2000;
    const seed = 9;

    const bounds = computeVoxelBounds4(
      prepared,
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      mulberry32(seed),
      samples,
    );

    // Direct computation: identity rotor about the origin, sliceOn false —
    // the rotor projection degenerates to "drop w, keep xyz" verbatim, so
    // this is just the 3D pilot's own trimmed-quantile math over the SAME
    // warmed-up, plotPoint4-lensed orbit computeVoxelBounds4 drives.
    const rng = mulberry32(seed);
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    let w = rng() - 0.5;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const step = stepOrbit4(prepared, x, y, z, w, rng);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
    }
    const xs = new Float64Array(samples);
    const ys = new Float64Array(samples);
    const zs = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
      const step = stepOrbit4(prepared, x, y, z, w, rng);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
      const [px, py, pz] = plotPoint4(prepared, x, y, z, w, rng);
      xs[i] = px;
      ys[i] = py;
      zs[i] = pz;
    }
    xs.sort();
    ys.sort();
    zs.sort();
    const lo = Math.floor(BOUNDS_QUANTILE * samples);
    const hi = Math.max(lo, samples - 1 - lo);
    const cx = (xs[lo] + xs[hi]) / 2;
    const cy = (ys[lo] + ys[hi]) / 2;
    const cz = (zs[lo] + zs[hi]) / 2;
    const half = Math.max(
      ((xs[hi] - xs[lo]) / 2) * (1 + BOUNDS_MARGIN),
      ((ys[hi] - ys[lo]) / 2) * (1 + BOUNDS_MARGIN),
      ((zs[hi] - zs[lo]) / 2) * (1 + BOUNDS_MARGIN),
      1e-6,
    );

    expect(bounds.min[0]).toBeCloseTo(cx - half, 9);
    expect(bounds.max[0]).toBeCloseTo(cx + half, 9);
    expect(bounds.min[1]).toBeCloseTo(cy - half, 9);
    expect(bounds.max[1]).toBeCloseTo(cy + half, 9);
    expect(bounds.min[2]).toBeCloseTo(cz - half, 9);
    expect(bounds.max[2]).toBeCloseTo(cz + half, 9);
  });

  it("shrinks the cube toward the currently-visible slice for a system with real w-spread", () => {
    // The final transform's xw rotation mixes the underlying spatial spread
    // into the plotted w, so the system has genuine (not just embed-derived)
    // w variation for the slice to actually restrict against.
    const transforms4 = weightedPentatope();
    const finalTransform4: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [1, 1, 1, 1],
      rotation: { xw: 0.9 },
    };
    const prepared = prepareChaosGame4(transforms4, finalTransform4);
    const samples = 4000;
    const seed = 21;

    const unsliced = computeVoxelBounds4(
      prepared,
      FLAT_ROTOR_PROJ,
      { invWAmp: 1, sliceOn: false, sliceCenter: 0, sliceWidth: 1 },
      mulberry32(seed),
      samples,
    );
    const sliced = computeVoxelBounds4(
      prepared,
      FLAT_ROTOR_PROJ,
      { invWAmp: 1, sliceOn: true, sliceCenter: 0.8, sliceWidth: 0.15 },
      mulberry32(seed),
      samples,
    );

    const unslicedExtent = unsliced.max[0] - unsliced.min[0];
    const slicedExtent = sliced.max[0] - sliced.min[0];
    expect(slicedExtent).toBeLessThan(unslicedExtent);
  });

  it("falls back to every sample (matching sliceOn: false bounds exactly) when the slice sits far outside the cloud", () => {
    const transforms4 = weightedPentatope();
    const finalTransform4: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [1, 1, 1, 1],
      rotation: { xw: 0.9 },
    };
    const prepared = prepareChaosGame4(transforms4, finalTransform4);
    const samples = 4000;
    const seed = 21;

    const unsliced = computeVoxelBounds4(
      prepared,
      FLAT_ROTOR_PROJ,
      { invWAmp: 1, sliceOn: false, sliceCenter: 0, sliceWidth: 1 },
      mulberry32(seed),
      samples,
    );
    // s is always clamped into [-1, 1], so a center of 50 is many widths
    // away from every sample regardless of the system — fewer than 1%
    // (here, zero) qualify, so the fallback takes over.
    const farSlice = computeVoxelBounds4(
      prepared,
      FLAT_ROTOR_PROJ,
      { invWAmp: 1, sliceOn: true, sliceCenter: 50, sliceWidth: 0.1 },
      mulberry32(seed),
      samples,
    );

    expect(farSlice).toEqual(unsliced);
  });
});

describe("accumulateVoxels4 color kinds", () => {
  const bounds = unitishBounds(1);
  const size = 4;
  // World origin in a [-1, 1] cube of 4 voxels, x-fastest layout — every
  // fixture below lands its single point at the exact origin in xyz (the
  // identity rotor about the origin leaves it untouched), so every test
  // shares this same landing bucket.
  const bucket = 2 * 16 + 2 * 4 + 2;

  it("structural: pins the LUT color at c = 0.5 (a single-transform system stays pinned there)", () => {
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    const lut = new Float32Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      lut[i * 3] = i / 255;
      lut[i * 3 + 1] = 0;
      lut[i * 3 + 2] = 1 - i / 255;
    }
    const grid = accumulateVoxels4(
      prepared,
      createVoxelGrid(size, bounds),
      1,
      mulberry32(1),
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      { kind: "structural", lut },
    );
    const li = 128 * 3; // (0.5 * 256) | 0 = 128.
    const o = bucket * 3;
    expect(grid.avgRGB[o]).toBe(lut[li]);
    expect(grid.avgRGB[o + 1]).toBe(lut[li + 1]);
    expect(grid.avgRGB[o + 2]).toBe(lut[li + 2]);
  });

  it("wRamp: matches wRampColor at the point's normalized signed-w signal", () => {
    // Fixed point at w = 0.5, identity rotor about the origin, invWAmp = 1:
    // sRaw = 0.5 exactly, so s = 0.5.
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0.5]));
    const side = W_SIDE_PALETTES.wBlueOrange;
    const grid = accumulateVoxels4(
      prepared,
      createVoxelGrid(size, bounds),
      1,
      mulberry32(1),
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      { kind: "wRamp", side },
    );
    const expected = wRampColor(0.5, side);
    const o = bucket * 3;
    // toBeCloseTo, not toBe: avgRGB is a Float32Array (voxel.ts's own
    // memory-saving choice — see VoxelGrid's doc), so storing a float64
    // wRampColor result rounds it to float32 precision.
    expect(grid.avgRGB[o]).toBeCloseTo(expected[0], 6);
    expect(grid.avgRGB[o + 1]).toBeCloseTo(expected[1], 6);
    expect(grid.avgRGB[o + 2]).toBeCloseTo(expected[2], 6);
  });

  it("transform: pins palette[idx] for the single transform that fired", () => {
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    const palette = transformColors(1);
    const grid = accumulateVoxels4(
      prepared,
      createVoxelGrid(size, bounds),
      1,
      mulberry32(1),
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      { kind: "transform", palette },
    );
    const expected = palette[0];
    const o = bucket * 3;
    // toBeCloseTo, not toBe — see the wRamp test above for why (Float32
    // avgRGB rounds the float64 palette color).
    expect(grid.avgRGB[o]).toBeCloseTo(expected[0], 6);
    expect(grid.avgRGB[o + 1]).toBeCloseTo(expected[1], 6);
    expect(grid.avgRGB[o + 2]).toBeCloseTo(expected[2], 6);
  });

  it("radius: pins the radius-ramp LUT at the point's normalized 4D distance from color.center", () => {
    const prepared = prepareChaosGame4(fixedPointSystem4([0, 0, 0, 0]));
    const lut = buildColorModeLUT("radius", 1);
    const grid = accumulateVoxels4(
      prepared,
      createVoxelGrid(size, bounds),
      1,
      mulberry32(1),
      FLAT_ROTOR_PROJ,
      FLAT_VIEW,
      { kind: "radius", lut, center: [1, 0, 0, 0], minD: 0, maxD: 2 },
    );
    // d4 = distance((0,0,0,0), (1,0,0,0)) = 1; t = (1 - 0) / (2 - 0) = 0.5;
    // li = (0.5 * 255 + 0.5) | 0 = 128 (round-to-nearest — voxel.ts's convention).
    const li = 128 * 3;
    const o = bucket * 3;
    expect(grid.avgRGB[o]).toBe(lut[li]);
    expect(grid.avgRGB[o + 1]).toBe(lut[li + 1]);
    expect(grid.avgRGB[o + 2]).toBe(lut[li + 2]);
  });
});
