/**
 * Solid balloon acceptance sheet: measurements for the query-space echo in
 * `voxel-material.ts`.
 *
 * This is the measurement counterpart of the query-space implementation in
 * `voxel-material.ts`.  It deliberately voxelizes the attractor ONCE, then
 * samples those same packed RGBA8 bytes at `p` and at the sphere-inverted
 * query `I(p)`.  A second echo grid would answer a different question and is
 * specifically not built here.
 *
 * The two sections measure the two acceptance risks:
 *
 *  1. CENTRE REFUSAL. Every shipped preset is routed through the same 3D/4D
 *     flatness decision as the app, the same seeded bounds pilot and voxel
 *     accumulator, and the same RGBA8 pack + WebGL-coordinate trilinear alpha
 *     sample as `FractalScene.setVoxelGrid`.  3D uses Three.js's enclosing-ball
 *     recipe (bbox centre, exact farthest delivered point); 4D uses the
 *     required `balloonBall4` semantics (origin, exact maximum visible 4D
 *     radius), independent of the sliced grid.  An alpha strictly above the
 *     live 0.30 isosurface refuses the balloon because that occupied centre
 *     inverts toward the camera at infinity.
 *
 *  2. MARCH PRICE. On matched source-fit pinhole rays, a CPU mirror counts the
 *     ordinary box march and the balloon's ten-rho horizon march.  It reports
 *     both loop iterations (the horizon's real ALU/control-flow price) and
 *     actual in-volume texture fetches (outside queries return zero BEFORE a
 *     fetch, just like the shader).  The `upperStepRatio` column is the shader's
 *     analytic worst-case `(uMarchSteps + echoSteps) / uMarchSteps`; the
 *     measured mean/p95 columns include early hits and box-miss rays.  This is
 *     machine-independent work accounting, not a claim about wall time on a
 *     particular GPU.
 *
 * QUICK deterministic sweep (the default):
 *
 *   npx vitest run --config scripts/vitest.harness.config.ts \
 *     scripts/solid-balloon.harness.ts
 *
 * Production-resolution refusal confirmation used for the recorded verdict:
 *
 *   CENTER_RES=192 CENTER_ITERATIONS=20000000 CENTER_CLOUD=500000 \
 *   npx vitest run --config scripts/vitest.harness.config.ts \
 *     scripts/solid-balloon.harness.ts -t probes
 *
 * Production-resolution matched-ray cost + weight confirmation:
 *
 *   CENTER_RES=192 CENTER_ITERATIONS=20000000 CENTER_CLOUD=500000 \
 *   npx vitest run --config scripts/vitest.harness.config.ts \
 *     scripts/solid-balloon.harness.ts -t prices
 *
 * Env knobs (quick defaults shown):
 *   CENTER_RES=64 CENTER_ITERATIONS=500000 CENTER_CLOUD=100000
 *   CENTER_PRESETS=<all shipped presets> MARCH_PRESETS=default,hyperfern
 *   MARCH_WIDTH=64 MARCH_HEIGHT=48
 *
 * MEASURED VERDICT (2026-08-24, production command above, seed 0x5011d):
 * refusal at threshold 0.30 is required for pyramid (.50764), dyedSpiral
 * (.48610), juliaPinwheel (.33586), mandelboxRings (.99334), foldChain
 * (.43077), foldChainFlower (.43077), pentatope 4D at the ORIGIN (.69202),
 * doubleRotation 4D (.53023), woodGrain 4D (.99276), and sixteenCell 4D
 * (.87384).  Hyperfern 4D is the near control at .11039.  Weight 1 is not a
 * copied brightness constant: it
 * preserves the source field's isosurface.  A weight <= threshold makes every
 * echo incapable of crossing the strict hit test; any intermediate weight
 * merely changes the echo's contour to threshold/weight and still cannot make
 * all occupied centres safe.  Refusal and weight are therefore separate
 * decisions.  On the same two safe fixtures at the in-frame 0.5x gate,
 * strict shell-attributed ray coverage at weights .35/.5/.75/1 was
 * 4.8/17.4/20.2/21.4% (default) and 0/6.9/50.5/55.9% (hyperfern 4D): full
 * weight is the most legible candidate as well as the only one preserving the
 * source isovalue.  At the shipped 1.6x rest radius, total off/on loop ceilings
 * were 220/2374 (10.79x) for default and 220/1829 (8.31x) for hyperfern;
 * matched mean-step ratios were 29.09x/9.56x and bounded-fetch ratios
 * 16.13x/6.75x.  The primary half retains the legacy interval, step count,
 * jitter phase, and identical in-box sample result; it lost zero matched
 * source hits.  Only the echo half pays the horizon.
 */
import { systemPartsAreNonFlat, toTransform4 } from "../src/fractal/affine4";
import { prepareChaosGame, runChaosGame } from "../src/fractal/chaos-game";
import { prepareChaosGame4, runChaosGame4 } from "../src/fractal/chaos-game-4d";
import { transformColors } from "../src/fractal/color";
import { framingBounds, framingRadius4 } from "../src/app/framing-bounds";
import { fitRadius } from "../src/app/orbit";
import {
  PRESET_NAMES,
  presetTransforms,
  type Preset,
} from "../src/fractal/presets";
import { composeRotorProjection4 } from "../src/fractal/project4";
import { iterationRng, mulberry32 } from "../src/fractal/rng";
import type { Bounds, SymmetryParams, Vec3 } from "../src/fractal/types";
import {
  accumulateVoxels,
  computeVoxelBounds,
  createVoxelGrid,
  voxelTextureData,
  type VoxelBounds,
} from "../src/fractal/voxel";
import {
  accumulateVoxels4,
  computeVoxelBounds4,
} from "../src/fractal/voxel-4d";
import {
  BALLOON_FAR_CAP_RHO,
  buildBalloonFromBall,
  type Balloon,
} from "../src/fractal/balloon-de";
import {
  marchStepsForGrid,
  sampleVoxelAlpha,
  SOLID_BALLOON_ECHO_WEIGHT,
  solidBalloonCenterIsEmpty,
} from "../src/app/voxel-material";
import { fourDFramingBounds } from "../src/app/camera-tween";

const CLOUD_SEED = 0x5e17;
const VOXEL_SEED = 0x5011d;
const ITERATION_SEED_XOR = 0x9e3779b9;
const THRESHOLD = 0.3;
const FOV_Y = Math.PI / 3;
const ASPECT = 4 / 3;
const SYMMETRY: SymmetryParams = { order: 1, plane: "xz" };

// prettier-ignore
const IDENTITY_ROTOR = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const VIEW_4D = {
  invWAmp: 1,
  sliceOn: false,
  sliceCenter: 0,
  sliceWidth: 1,
  sliceRelativeColor: false,
};

const EXPECTED_REFUSALS = new Set<Preset>([
  "pyramid",
  "dyedSpiral",
  "juliaPinwheel",
  "mandelboxRings",
  "foldChain",
  "foldChainFlower",
  "pentatope",
  "doubleRotation",
  "woodGrain",
  "sixteenCell",
]);

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer, not ${raw}`);
  }
  return value;
}

function presetsFromEnv(name: string, fallback: readonly Preset[]): Preset[] {
  const raw = process.env[name];
  if (!raw) return [...fallback];
  const known = new Set<string>(PRESET_NAMES);
  return raw.split(",").map((entry) => {
    const preset = entry.trim();
    if (!known.has(preset))
      throw new Error(`${name}: unknown preset ${preset}`);
    return preset as Preset;
  });
}

const CENTER_RES = positiveInt("CENTER_RES", 64);
const CENTER_ITERATIONS = positiveInt("CENTER_ITERATIONS", 500_000);
const CENTER_CLOUD = positiveInt("CENTER_CLOUD", 100_000);
const CENTER_PRESETS = presetsFromEnv("CENTER_PRESETS", PRESET_NAMES);
const MARCH_PRESETS = presetsFromEnv("MARCH_PRESETS", ["default", "hyperfern"]);
const MARCH_WIDTH = positiveInt("MARCH_WIDTH", 64);
const MARCH_HEIGHT = positiveInt("MARCH_HEIGHT", 48);

interface SourceBall {
  center: Vec3;
  radius: number;
}

interface Fixture {
  preset: Preset;
  dimension: "3D" | "4D";
  data: Uint8Array;
  size: number;
  bounds: VoxelBounds;
  ball: SourceBall;
  frameBounds: Bounds;
}

function pointBall(positions: Float32Array): SourceBall {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxX = Math.max(maxX, positions[i]);
    maxY = Math.max(maxY, positions[i + 1]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const center: Vec3 = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  let radiusSq = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - center[0];
    const dy = positions[i + 1] - center[1];
    const dz = positions[i + 2] - center[2];
    radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
  }
  return { center, radius: Math.sqrt(radiusSq) };
}

function buildFixture(preset: Preset): Fixture {
  const transforms = presetTransforms(preset);
  const fourD = systemPartsAreNonFlat(transforms, null, SYMMETRY);
  const cloudRng = mulberry32(CLOUD_SEED);
  const cloudIterations = iterationRng(CLOUD_SEED ^ ITERATION_SEED_XOR);
  const voxelRng = mulberry32(VOXEL_SEED);

  if (!fourD) {
    const cloud = runChaosGame(
      transforms,
      CENTER_CLOUD,
      cloudRng,
      null,
      SYMMETRY,
      cloudIterations,
    );
    const ball = pointBall(cloud.positions);
    const frameBounds = framingBounds(cloud.positions, cloud.count);
    const prepared = prepareChaosGame(transforms, null, SYMMETRY);
    const bounds = computeVoxelBounds(prepared, voxelRng);
    const grid = createVoxelGrid(CENTER_RES, bounds);
    accumulateVoxels(
      prepared,
      grid,
      CENTER_ITERATIONS,
      voxelRng,
      transformColors(transforms.length),
    );
    return {
      preset,
      dimension: "3D",
      data: voxelTextureData(grid),
      size: CENTER_RES,
      bounds,
      ball,
      frameBounds,
    };
  }

  const transforms4 = transforms.map(toTransform4);
  const cloud = runChaosGame4(
    transforms4,
    CENTER_CLOUD,
    cloudRng,
    null,
    SYMMETRY,
    cloudIterations,
  );
  const prepared = prepareChaosGame4(transforms4, null, SYMMETRY);
  const rotorProjection = composeRotorProjection4(IDENTITY_ROTOR, cloud.center);
  const bounds = computeVoxelBounds4(
    prepared,
    rotorProjection,
    VIEW_4D,
    voxelRng,
  );
  const grid = createVoxelGrid(CENTER_RES, bounds);
  accumulateVoxels4(
    prepared,
    grid,
    CENTER_ITERATIONS,
    voxelRng,
    rotorProjection,
    VIEW_4D,
    { kind: "transform", palette: transformColors(transforms.length) },
  );
  const frameRadius = framingRadius4(
    cloud.positions,
    cloud.w,
    cloud.count,
    cloud.center,
  );
  return {
    preset,
    dimension: "4D",
    data: voxelTextureData(grid),
    size: CENTER_RES,
    bounds,
    // Slice THEN invert around balloonBall4's origin/full-visible ball.
    ball: {
      center: [0, 0, 0],
      radius: cloud.originRadius,
    },
    frameBounds: fourDFramingBounds(cloud.center, frameRadius),
  };
}

function centerAlpha(fixture: Fixture): number {
  return sampleVoxelAlpha(
    fixture.data,
    fixture.size,
    fixture.bounds.min,
    fixture.bounds.max,
    fixture.ball.center,
  );
}

interface Sample {
  alpha: number;
  fetched: boolean;
}

/** Allocation-free CPU twin of boundedVolumeSample's alpha read. */
function boundedAlpha(
  fixture: Fixture,
  x: number,
  y: number,
  z: number,
): Sample {
  const { data, size, bounds } = fixture;
  const ux = (x - bounds.min[0]) / (bounds.max[0] - bounds.min[0]);
  const uy = (y - bounds.min[1]) / (bounds.max[1] - bounds.min[1]);
  const uz = (z - bounds.min[2]) / (bounds.max[2] - bounds.min[2]);
  if (ux < 0 || ux > 1 || uy < 0 || uy > 1 || uz < 0 || uz > 1) {
    return { alpha: 0, fetched: false };
  }

  const xx = ux * size - 0.5;
  const yy = uy * size - 0.5;
  const zz = uz * size - 0.5;
  const xLo = Math.floor(xx);
  const yLo = Math.floor(yy);
  const zLo = Math.floor(zz);
  const x0 = Math.max(0, Math.min(size - 1, xLo));
  const x1 = Math.max(0, Math.min(size - 1, xLo + 1));
  const y0 = Math.max(0, Math.min(size - 1, yLo));
  const y1 = Math.max(0, Math.min(size - 1, yLo + 1));
  const z0 = Math.max(0, Math.min(size - 1, zLo));
  const z1 = Math.max(0, Math.min(size - 1, zLo + 1));
  const tx = xx - xLo;
  const ty = yy - yLo;
  const tz = zz - zLo;
  const alpha = (xi: number, yi: number, zi: number): number =>
    data[(xi + yi * size + zi * size * size) * 4 + 3] / 255;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const z0y0 = lerp(alpha(x0, y0, z0), alpha(x1, y0, z0), tx);
  const z0y1 = lerp(alpha(x0, y1, z0), alpha(x1, y1, z0), tx);
  const z1y0 = lerp(alpha(x0, y0, z1), alpha(x1, y0, z1), tx);
  const z1y1 = lerp(alpha(x0, y1, z1), alpha(x1, y1, z1), tx);
  return {
    alpha: lerp(lerp(z0y0, z0y1, ty), lerp(z1y0, z1y1, ty), tz),
    fetched: true,
  };
}

function boxIntersect(fixture: Fixture, ro: Vec3, rd: Vec3): [number, number] {
  let near = -Infinity;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const t0 = (fixture.bounds.min[axis] - ro[axis]) / rd[axis];
    const t1 = (fixture.bounds.max[axis] - ro[axis]) / rd[axis];
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
  }
  return [near, far];
}

interface MarchResult {
  steps: number;
  fetches: number;
  hit: boolean;
  shell: boolean;
  tHit: number;
}

interface OnMarchResult extends MarchResult {
  limit: number;
  primaryHit: boolean;
}

function marchOff(fixture: Fixture, ro: Vec3, rd: Vec3): MarchResult {
  const [boxNear, boxFar] = boxIntersect(fixture, ro, rd);
  let t = Math.max(boxNear, 0);
  if (boxNear > boxFar || boxFar <= 0) {
    return { steps: 0, fetches: 0, hit: false, shell: false, tHit: Infinity };
  }
  const limit = marchStepsForGrid(fixture.size);
  const dt = (boxFar - t) / limit;
  // Fixed half-stride instead of the shader's per-pixel hash: the accounting
  // compares matched rays, not dither quality.
  t += dt * 0.5;
  for (let step = 1; step <= limit; step++, t += dt) {
    if (
      boundedAlpha(
        fixture,
        ro[0] + rd[0] * t,
        ro[1] + rd[1] * t,
        ro[2] + rd[2] * t,
      ).alpha > THRESHOLD
    ) {
      return { steps: step, fetches: step, hit: true, shell: false, tHit: t };
    }
  }
  return {
    steps: limit,
    fetches: limit,
    hit: false,
    shell: false,
    tHit: Infinity,
  };
}

function marchEcho(
  fixture: Fixture,
  balloon: Balloon,
  ro: Vec3,
  rd: Vec3,
  weight = SOLID_BALLOON_ECHO_WEIGHT,
): MarchResult & { limit: number } {
  const dxCam = ro[0] - balloon.center[0];
  const dyCam = ro[1] - balloon.center[1];
  const dzCam = ro[2] - balloon.center[2];
  const tFar =
    Math.hypot(dxCam, dyCam, dzCam) + BALLOON_FAR_CAP_RHO * balloon.rho;
  const baseSteps = marchStepsForGrid(fixture.size);
  const span = Math.max(
    fixture.bounds.max[0] - fixture.bounds.min[0],
    fixture.bounds.max[1] - fixture.bounds.min[1],
    fixture.bounds.max[2] - fixture.bounds.min[2],
  );
  const limit = Math.min(
    8192,
    Math.max(baseSteps, Math.ceil((tFar * baseSteps) / span)),
  );
  const dt = tFar / limit;
  let t = dt * 0.5;
  let fetches = 0;
  for (let step = 1; step <= limit; step++, t += dt) {
    const px = ro[0] + rd[0] * t;
    const py = ro[1] + rd[1] * t;
    const pz = ro[2] + rd[2] * t;
    const dx = px - balloon.center[0];
    const dy = py - balloon.center[1];
    const dz = pz - balloon.center[2];
    const floor = 1e-6 * balloon.rho;
    const r2 = Math.max(dx * dx + dy * dy + dz * dz, floor * floor);
    const scale = (balloon.R * balloon.R) / r2;
    const echo = boundedAlpha(
      fixture,
      balloon.center[0] + scale * dx,
      balloon.center[1] + scale * dy,
      balloon.center[2] + scale * dz,
    );
    if (echo.fetched) fetches++;
    const weightedEcho = weight * echo.alpha;
    if (weightedEcho > THRESHOLD) {
      return {
        steps: step,
        fetches,
        hit: true,
        shell: true,
        tHit: t,
        limit,
      };
    }
  }
  return {
    steps: limit,
    fetches,
    hit: false,
    shell: false,
    tHit: Infinity,
    limit,
  };
}

function marchOn(
  fixture: Fixture,
  balloon: Balloon,
  ro: Vec3,
  rd: Vec3,
  weight = SOLID_BALLOON_ECHO_WEIGHT,
): OnMarchResult {
  // Mirrors the resolved on-program's two independent arms: the original
  // primary AABB march keeps its exact interval/phase, while only the echo
  // pays the far horizon. The earliest hit is the union.
  const primary = marchOff(fixture, ro, rd);
  const echo = marchEcho(fixture, balloon, ro, rd, weight);
  return {
    steps: primary.steps + echo.steps,
    fetches: primary.fetches + echo.fetches,
    hit: primary.hit || echo.hit,
    shell: echo.hit && echo.tHit < primary.tHit,
    tHit: Math.min(primary.tHit, echo.tHit),
    limit: marchStepsForGrid(fixture.size) + echo.limit,
    primaryHit: primary.hit,
  };
}

function percentile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function measureMarch(fixture: Fixture): Record<string, string | number> {
  const balloon = buildBalloonFromBall(fixture.ball, 1.6);
  const cameraDistance = fitRadius(fixture.frameBounds, FOV_Y, ASPECT);
  const ro: Vec3 = [
    fixture.ball.center[0],
    fixture.ball.center[1],
    fixture.ball.center[2] + cameraDistance,
  ];
  const tanY = Math.tan(FOV_Y / 2);
  const off: MarchResult[] = [];
  const on: OnMarchResult[] = [];
  for (let y = 0; y < MARCH_HEIGHT; y++) {
    for (let x = 0; x < MARCH_WIDTH; x++) {
      const sx = (((x + 0.5) / MARCH_WIDTH) * 2 - 1) * tanY * ASPECT;
      const sy = (1 - ((y + 0.5) / MARCH_HEIGHT) * 2) * tanY;
      const invLength = 1 / Math.hypot(sx, sy, 1);
      const rd: Vec3 = [sx * invLength, sy * invLength, -invLength];
      off.push(marchOff(fixture, ro, rd));
      on.push(marchOn(fixture, balloon, ro, rd));
    }
  }
  const mean = (values: number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const offSteps = off.map((result) => result.steps).sort((a, b) => a - b);
  const onSteps = on.map((result) => result.steps).sort((a, b) => a - b);
  const offFetches = off.map((result) => result.fetches);
  const onFetches = on.map((result) => result.fetches);
  const baseLimit = marchStepsForGrid(fixture.size);
  const balloonLimit = on[0].limit;
  return {
    preset: fixture.preset,
    dim: fixture.dimension,
    rays: off.length,
    offHitPct: (
      (100 * off.filter((result) => result.hit).length) /
      off.length
    ).toFixed(1),
    onHitPct: (
      (100 * on.filter((result) => result.hit).length) /
      on.length
    ).toFixed(1),
    offMeanSteps: mean(offSteps).toFixed(1),
    onMeanSteps: mean(onSteps).toFixed(1),
    meanStepRatio: (mean(onSteps) / Math.max(mean(offSteps), 1)).toFixed(2),
    offP95Steps: percentile(offSteps, 0.95),
    onP95Steps: percentile(onSteps, 0.95),
    meanFetchRatio: (mean(onFetches) / Math.max(mean(offFetches), 1)).toFixed(
      2,
    ),
    lostPrimaryHits: off.filter(
      (result, index) => result.hit && !on[index].primaryHit,
    ).length,
    offLimit: baseLimit,
    onLimit: balloonLimit,
    upperStepRatio: (balloonLimit / baseLimit).toFixed(2),
  };
}

function measureWeights(fixture: Fixture): Record<string, string | number>[] {
  // The persisted 1.6x rest shell can sit entirely outside a source-fit
  // frustum (especially for the fern).  Weight cannot be judged on invisible
  // pixels, so use the established 0.5x functional gate while the cost row
  // above retains the shipped 1.6x rest pose.
  const balloon = buildBalloonFromBall(fixture.ball, 0.5);
  const cameraDistance = fitRadius(fixture.frameBounds, FOV_Y, ASPECT);
  const ro: Vec3 = [
    fixture.ball.center[0],
    fixture.ball.center[1],
    fixture.ball.center[2] + cameraDistance,
  ];
  const tanY = Math.tan(FOV_Y / 2);
  return [0.35, 0.5, 0.75, 1].map((weight) => {
    const results: OnMarchResult[] = [];
    for (let y = 0; y < MARCH_HEIGHT; y++) {
      for (let x = 0; x < MARCH_WIDTH; x++) {
        const sx = (((x + 0.5) / MARCH_WIDTH) * 2 - 1) * tanY * ASPECT;
        const sy = (1 - ((y + 0.5) / MARCH_HEIGHT) * 2) * tanY;
        const invLength = 1 / Math.hypot(sx, sy, 1);
        results.push(
          marchOn(
            fixture,
            balloon,
            ro,
            [sx * invLength, sy * invLength, -invLength],
            weight,
          ),
        );
      }
    }
    const mean = (key: "steps" | "fetches"): number =>
      results.reduce((sum, result) => sum + result[key], 0) / results.length;
    return {
      preset: fixture.preset,
      dim: fixture.dimension,
      weight,
      effectiveEchoThreshold: (THRESHOLD / weight).toFixed(3),
      hitPct: (
        (100 * results.filter((result) => result.hit).length) /
        results.length
      ).toFixed(1),
      shellHitPct: (
        (100 * results.filter((result) => result.shell).length) /
        results.length
      ).toFixed(1),
      meanSteps: mean("steps").toFixed(1),
      meanFetches: mean("fetches").toFixed(1),
    };
  });
}

describe("Solid balloon acceptance measurements", () => {
  it("probes the packed density at every selected shipped preset's dimension-correct balloon centre", () => {
    const rows: Record<string, string | number>[] = [];
    const refused: Preset[] = [];
    for (const preset of CENTER_PRESETS) {
      const fixture = buildFixture(preset);
      const alpha = centerAlpha(fixture);
      const available = solidBalloonCenterIsEmpty(alpha, THRESHOLD);
      if (!available) refused.push(preset);
      rows.push({
        preset,
        dim: fixture.dimension,
        center: fixture.dimension === "4D" ? "origin" : "cloud bbox",
        alpha: alpha.toFixed(5),
        verdict: available ? "allow" : "REFUSE",
      });
    }
    console.log(
      `[solid-balloon] centre sweep ${CENTER_RES}^3 / ${CENTER_ITERATIONS} voxel iterations / ${CENTER_CLOUD} cloud points`,
    );
    console.table(rows);

    const expected = CENTER_PRESETS.filter((preset) =>
      EXPECTED_REFUSALS.has(preset),
    );
    expect(refused).toEqual(expected);
  });

  it("prices the source-box march against the ten-rho balloon horizon on matched rays", () => {
    const fixtures = MARCH_PRESETS.map((preset) => {
      const fixture = buildFixture(preset);
      expect(solidBalloonCenterIsEmpty(centerAlpha(fixture), THRESHOLD)).toBe(
        true,
      );
      return fixture;
    });
    const rows = fixtures.map(measureMarch);
    console.log(
      `[solid-balloon] matched-ray march ${MARCH_WIDTH}x${MARCH_HEIGHT}, threshold ${THRESHOLD}, radius 1.6x`,
    );
    console.table(rows);
    for (const row of rows) {
      expect(Number(row.onLimit)).toBeGreaterThan(Number(row.offLimit));
      expect(Number(row.meanStepRatio)).toBeGreaterThan(1);
      expect(Number(row.lostPrimaryHits)).toBe(0);
    }

    const weightRows = fixtures.flatMap(measureWeights);
    console.log(
      "[solid-balloon] density-weight sweep at the 0.5x in-frame gate (shellHitPct is strict echo attribution)",
    );
    console.table(weightRows);
    for (const fixture of fixtures) {
      const selected = weightRows.filter(
        (row) => row.preset === fixture.preset,
      );
      for (let i = 1; i < selected.length; i++) {
        expect(Number(selected[i].shellHitPct)).toBeGreaterThanOrEqual(
          Number(selected[i - 1].shellHitPct),
        );
      }
      expect(Number(selected.at(-1)?.shellHitPct)).toBeGreaterThan(
        Number(selected[0].shellHitPct),
      );
    }
  });
});
