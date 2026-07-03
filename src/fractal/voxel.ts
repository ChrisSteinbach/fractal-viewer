/**
 * The solid render's pure core (fr-v4f): accumulate chaos-game iterations
 * into a 3D density voxel grid and pack that grid into RGBA8 3D-texture data
 * for a GPU raymarcher. No Three.js, no DOM — the app layer uploads the
 * packed bytes as a `Data3DTexture` and marches an isosurface through it
 * (gradient normals, shadow ray, ambient occlusion — see
 * `src/app/voxel-material.ts`).
 *
 * This exists because the affine IFS has no analytic distance estimator to
 * raymarch (the reason fr-yor was rejected): the only way to give the user's
 * actual attractor lit, shadowed surfaces is to march *measured density* —
 * the chaos game's own hit counts — instead of a distance function. The grid
 * is world-space and camera-independent, so once accumulated the lit fractal
 * can be re-rendered from any angle in realtime; convergence cost is paid
 * once, not per view.
 *
 * `accumulateVoxels` drives the exact same stepping logic as the point-cloud
 * and flame paths (`stepOrbit` / `plotPoint` from `chaos-game.ts`) but
 * hand-inlines their bodies into one allocation-free loop, for the same
 * reason `accumulateFlame` does: at tens of millions of iterations the
 * per-call allocations become real GC pressure. The inlined loop is checked
 * against the real `stepOrbit`/`plotPoint` by an oracle test in
 * `voxel.test.ts` so the two paths can never silently drift apart.
 */
import {
  ESCAPE_LIMIT,
  WARMUP_ITERATIONS,
  pickIndex,
  stepOrbit,
  plotPoint,
} from "./chaos-game";
import type { PreparedChaosGame } from "./chaos-game";
import {
  POSITION_COLOR_OFFSET,
  POSITION_COLOR_SCALE,
  UNIFORM_POINT_COLOR,
  buildColorModeLUT,
} from "./color";
import type { Rng } from "./rng";
import type { Bounds, ColorMode, Vec3 } from "./types";

/** World-space cube the voxel grid covers (equal extent per axis, so voxels
 * are isotropic and the raymarcher's gradient normals aren't skewed). */
export interface VoxelBounds {
  min: Vec3;
  max: Vec3;
  /**
   * The attractor's own trimmed extents (per-axis plus radial), BEFORE the
   * cube-ification and margin that shape `min`/`max`. Color modes normalize
   * against these — the same way `buildColors` normalizes against the point
   * cloud's `ChaosGameResult.bounds` — so a flat attractor's height ramp
   * spans its real y-range, not the (much taller) cube the grid needs.
   */
  color: Bounds;
}

/**
 * Sample count for {@link computeVoxelBounds}' pilot run — enough that the
 * trimmed quantiles are stable for every preset, cheap enough (a fraction of
 * one accumulation chunk) that the bounds pass is unnoticeable.
 */
export const VOXEL_BOUNDS_SAMPLES = 30_000;

/** Fraction of samples trimmed from EACH tail before taking the extent. A
 * nonlinear variation can fling isolated points far off the attractor (see
 * `stepOrbit`'s escape guard); untrimmed, one such outlier would stretch the
 * grid until the actual structure occupies a handful of voxels. */
const BOUNDS_QUANTILE = 0.005;

/** Padding applied to the trimmed half-extent so the isosurface (and its
 * gradient-sampling neighborhood) never sits exactly on the grid boundary. */
const BOUNDS_MARGIN = 0.05;

/**
 * Estimate the world-space cube enclosing the attractor by running a short
 * pilot orbit (warmed up exactly like `runChaosGame`) and taking per-axis
 * trimmed quantiles of the plotted points — robust to the isolated outliers
 * a nonlinear variation can produce, unlike a plain min/max. The extents are
 * then cubed (largest axis wins, centered per axis) so voxels are isotropic,
 * and padded by a small margin.
 *
 * Consumes `rng` (the pilot is a real orbit); callers wanting the subsequent
 * accumulation to be reproducible should treat the bounds pass as part of
 * the same seeded run, exactly as the worker does.
 */
export function computeVoxelBounds(
  prepared: PreparedChaosGame,
  rng: Rng,
  samples: number = VOXEL_BOUNDS_SAMPLES,
): VoxelBounds {
  const xs = new Float64Array(samples);
  const ys = new Float64Array(samples);
  const zs = new Float64Array(samples);
  const rs = new Float64Array(samples);

  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    const s = stepOrbit(prepared, x, y, z, rng);
    x = s.x;
    y = s.y;
    z = s.z;
  }
  for (let i = 0; i < samples; i++) {
    const s = stepOrbit(prepared, x, y, z, rng);
    x = s.x;
    y = s.y;
    z = s.z;
    const [px, py, pz] = plotPoint(prepared, x, y, z, rng);
    xs[i] = px;
    ys[i] = py;
    zs[i] = pz;
    rs[i] = Math.sqrt(px * px + py * py + pz * pz);
  }

  xs.sort();
  ys.sort();
  zs.sort();
  rs.sort();
  const lo = Math.floor(BOUNDS_QUANTILE * samples);
  const hi = Math.max(lo, samples - 1 - lo);

  const cx = (xs[lo] + xs[hi]) / 2;
  const cy = (ys[lo] + ys[hi]) / 2;
  const cz = (zs[lo] + zs[hi]) / 2;
  // Largest trimmed half-extent across the axes, padded, floored away from
  // zero so a degenerate system (e.g. a single fixed point) still yields a
  // valid, invertible world-to-voxel mapping.
  const half = Math.max(
    ((xs[hi] - xs[lo]) / 2) * (1 + BOUNDS_MARGIN),
    ((ys[hi] - ys[lo]) / 2) * (1 + BOUNDS_MARGIN),
    ((zs[hi] - zs[lo]) / 2) * (1 + BOUNDS_MARGIN),
    1e-6,
  );

  return {
    min: [cx - half, cy - half, cz - half],
    max: [cx + half, cy + half, cz + half],
    // The un-cubed, un-padded trimmed extents — what color normalization
    // wants (see the VoxelBounds.color doc).
    color: {
      minX: xs[lo],
      maxX: xs[hi],
      minY: ys[lo],
      maxY: ys[hi],
      minZ: zs[lo],
      maxZ: zs[hi],
      minR: rs[lo],
      maxR: rs[hi],
    },
  };
}

/**
 * A 3D density accumulation: `size ** 3` voxels covering `bounds`, each
 * tracking how many iterations landed in it plus the running-mean color of
 * those hits.
 *
 * `density` is `Float32Array`, not `Float64Array` like the flame's `hits`:
 * a Float32 counts exactly up to 2^24 (~16.7M) hits per voxel, after which
 * `++` silently stalls. Reaching that takes 16.7M hits in ONE voxel — only a
 * near-degenerate system at the maximum budget gets close — and the failure
 * mode is merely a capped brightness input to a *log*-normalized texture
 * channel, not the systematic color skew that forced the flame to Float64
 * (see `FlameHistogram`). Halving the memory of the largest allocation in
 * the app is worth that corner.
 *
 * `avgRGB` is a per-voxel RUNNING MEAN (`avg += (c - avg) / n`), not a sum:
 * an incremental mean stays accurate in Float32 (its update shrinks as 1/n,
 * so once the mean has converged, dropped updates no longer matter), whereas
 * a Float32 *sum* divided by a growing count systematically undershoots — the
 * exact flame bug its Float64 `sumRGB` exists to prevent, avoided here for a
 * third of the memory.
 */
export interface VoxelGrid {
  /** Voxels per axis; the grid is always cubic. */
  size: number;
  bounds: VoxelBounds;
  /** Hit count per voxel, x-fastest (`x + y*size + z*size*size` — WebGL 3D
   * texture layout), length `size ** 3`. */
  density: Float32Array;
  /** Running-mean color per voxel, interleaved RGB, length `size ** 3 * 3`. */
  avgRGB: Float32Array;
  /** Highest per-voxel count so far — anchors {@link voxelTextureData}'s
   * log-density normalization. */
  maxDensity: number;
  /**
   * Orbit continuation point, or `null` before the first accumulation —
   * {@link accumulateVoxels} seeds and warms up a fresh orbit exactly like
   * `runChaosGame` when this is `null`, and resumes it otherwise, so a
   * chunked render matches a single long call given the same `rng` instance.
   */
  orbit: Vec3 | null;
}

/** A fresh, empty grid over `bounds`: every voxel at zero, orbit not started. */
export function createVoxelGrid(size: number, bounds: VoxelBounds): VoxelGrid {
  return {
    size,
    bounds,
    density: new Float32Array(size * size * size),
    avgRGB: new Float32Array(size * size * size * 3),
    maxDensity: 0,
    orbit: null,
  };
}

/** Grid resolutions are multiples of this, so the UI slider, the budget
 * clamp, and the OOM fallback all step through the same sizes. */
export const VOXEL_RESOLUTION_STEP = 32;

/**
 * Largest multiple-of-{@link VOXEL_RESOLUTION_STEP} resolution `<= requested`
 * (and always `>= VOXEL_RESOLUTION_STEP`) whose voxel count fits within
 * `maxVoxels` — the proactive memory guard, mirroring the flame's
 * `clampSupersampleToBudget`: grid memory is O(resolution^3), so an
 * unclamped slider value can demand hundreds of MB in one allocation on a
 * memory-constrained phone.
 */
export function clampVoxelResolution(
  requested: number,
  maxVoxels: number,
): number {
  const start = Math.max(
    VOXEL_RESOLUTION_STEP,
    Math.floor(requested / VOXEL_RESOLUTION_STEP) * VOXEL_RESOLUTION_STEP,
  );
  for (
    let size = start;
    size > VOXEL_RESOLUTION_STEP;
    size -= VOXEL_RESOLUTION_STEP
  ) {
    if (size * size * size <= maxVoxels) return size;
  }
  return VOXEL_RESOLUTION_STEP;
}

/** Color for a transform index outside `palette` — shouldn't happen; mirrors
 * `accumulateFlame`'s fallback. */
const FALLBACK_R = 1;
const FALLBACK_G = 1;
const FALLBACK_B = 1;

// Integer codes for the color-mode dispatch inside accumulateVoxels' hot
// loop — a couple of compares per iteration instead of string equality.
const MODE_TRANSFORM = 0;
const MODE_HEIGHT = 1;
const MODE_RADIUS = 2;
const MODE_POSITION = 3;
const MODE_UNIFORM = 4;

function colorModeCode(mode: ColorMode): number {
  switch (mode) {
    case "height":
      return MODE_HEIGHT;
    case "radius":
      return MODE_RADIUS;
    case "position":
      return MODE_POSITION;
    case "uniform":
      return MODE_UNIFORM;
    default:
      return MODE_TRANSFORM;
  }
}

/**
 * Accumulate `iterations` more chaos-game steps into a voxel grid. Each
 * plotted point (`stepOrbit` + `plotPoint`, exactly as the point-cloud and
 * flame paths compute them) that lands inside `grid.bounds` increments its
 * voxel's hit count and folds the point's color into that voxel's
 * running-mean color; points outside the bounds are skipped, exactly like a
 * flame point outside the frame.
 *
 * **Coloring** follows the explorer's `colorMode` (fr-c1d), using the exact
 * hue formulas `buildColors` uses (shared via `color.ts`, so the two can't
 * drift): `"transform"` (the default) is `palette[transformIndex]`;
 * `"height"`/`"radius"` index the shared ramp at the point's normalized
 * coordinate; `"position"` maps normalized xyz to rgb; `"uniform"` is the
 * flat cyan. Normalization uses {@link VoxelBounds.color} — the attractor's
 * own trimmed extents, the voxel counterpart of `buildColors`' cloud bounds.
 * Coloring never touches `rng`, so a given seed produces the byte-identical
 * orbit (and thus identical `density`) in every mode.
 *
 * **Progressive**: pass the same grid back in to keep converging it — the
 * orbit resumes from where it left off (see {@link VoxelGrid.orbit}), so a
 * chunked render (one call per worker chunk) produces the identical grid to
 * one long call, given the same `rng` *instance* threaded through every
 * call. A fresh grid (orbit `null`) draws a new random seed point and warms
 * it up for {@link WARMUP_ITERATIONS} steps first (unrecorded), exactly like
 * `runChaosGame`.
 *
 * **Symmetry** (fr-6im): when `prepared` was built with rotated copies (see
 * `chaos-game.ts`'s `prepareChaosGame`), this hand-inlined loop mirrors
 * `stepOrbit`'s handling exactly — the picked slot's rotation bends the
 * orbit-feedback point, and the `"transform"` coloring keys on the BASE map a
 * slot is a copy of, never the expanded slot — so a converged solid shows the
 * same kaleidoscope as the live point cloud and a flame render of it.
 *
 * Pass a seeded {@link Rng} for reproducible output (tests); the worker
 * passes a `mulberry32` seeded by the start command.
 */
export function accumulateVoxels(
  prepared: PreparedChaosGame,
  grid: VoxelGrid,
  iterations: number,
  rng: Rng,
  palette: Vec3[],
  colorMode: ColorMode = "transform",
): VoxelGrid {
  const { affines, variations, postRotations, finalAffine, finalWarp } =
    prepared;
  const { baseTransformCount } = prepared;
  const { size, density, avgRGB } = grid;
  let maxDensity = grid.maxDensity;

  // Color-mode dispatch, hoisted like buildColors': an integer code, a
  // prebuilt ramp LUT for height/radius (256 entries once per call, not
  // per iteration), and precomputed normalization factors. The `|| 1`
  // degenerate-range guard mirrors buildColors'.
  const mode = colorModeCode(colorMode);
  const lut =
    mode === MODE_HEIGHT || mode === MODE_RADIUS
      ? buildColorModeLUT(mode === MODE_HEIGHT ? "height" : "radius")
      : null;
  const cb = grid.bounds.color;
  const cMinX = cb.minX;
  const cMinY = cb.minY;
  const cMinZ = cb.minZ;
  const cMinR = cb.minR;
  const invRangeX = 1 / (cb.maxX - cb.minX || 1);
  const invRangeY = 1 / (cb.maxY - cb.minY || 1);
  const invRangeZ = 1 / (cb.maxZ - cb.minZ || 1);
  const invRangeR = 1 / (cb.maxR - cb.minR || 1);
  const [uniR, uniG, uniB] = UNIFORM_POINT_COLOR;

  const minX = grid.bounds.min[0];
  const minY = grid.bounds.min[1];
  const minZ = grid.bounds.min[2];
  // Bounds are always a non-degenerate cube (computeVoxelBounds floors the
  // half-extent away from zero), so these are finite and positive.
  const invCellX = size / (grid.bounds.max[0] - minX);
  const invCellY = size / (grid.bounds.max[1] - minY);
  const invCellZ = size / (grid.bounds.max[2] - minZ);
  const sizeSq = size * size;

  let x: number;
  let y: number;
  let z: number;
  if (grid.orbit === null) {
    x = rng() - 0.5;
    y = rng() - 0.5;
    z = rng() - 0.5;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
    }
  } else {
    [x, y, z] = grid.orbit;
  }

  for (let n = 0; n < iterations; n++) {
    // --- inlined stepOrbit(prepared, x, y, z, rng) ------------------------
    const idx = pickIndex(prepared, rng);
    // The BASE map this slot is a (possibly rotated) copy of (fr-6im) — see
    // PreparedChaosGame.baseTransformCount. Equal to `idx` at symmetry order
    // 1. The "By Transform" coloring below keys on this, never the raw
    // expanded `idx`, so it keeps meaning "logical map" (and stays in range
    // for `palette`, which is sized to the base count).
    const baseIdx = idx % baseTransformCount;
    const aff = affines[idx];
    const m = aff.m;
    const t = aff.t;
    const ax = m[0] * x + m[1] * y + m[2] * z + t[0];
    const ay = m[3] * x + m[4] * y + m[5] * z + t[1];
    const az = m[6] * x + m[7] * y + m[8] * z + t[2];

    const warp = variations[idx];
    let nx: number;
    let ny: number;
    let nz: number;
    if (warp === null) {
      nx = ax;
      ny = ay;
      nz = az;
    } else {
      const q = warp(ax, ay, az, rng);
      nx = q[0];
      ny = q[1];
      nz = q[2];
    }

    // Symmetry (fr-6im): rotate this slot's FULL affine + variation output —
    // see `chaos-game.ts`'s `stepOrbit`, which this mirrors exactly. `null`
    // (order 1, and every unrotated copy-0 slot at any order) skips this, so
    // the orbit stays byte-identical to the pre-symmetry loop exactly where
    // there is nothing to rotate.
    const post = postRotations[idx];
    if (post !== null) {
      const rx = post[0] * nx + post[1] * ny + post[2] * nz;
      const ry = post[3] * nx + post[4] * ny + post[5] * nz;
      const rz = post[6] * nx + post[7] * ny + post[8] * nz;
      nx = rx;
      ny = ry;
      nz = rz;
    }

    if (
      !Number.isFinite(nx) ||
      !Number.isFinite(ny) ||
      !Number.isFinite(nz) ||
      Math.abs(nx) > ESCAPE_LIMIT ||
      Math.abs(ny) > ESCAPE_LIMIT ||
      Math.abs(nz) > ESCAPE_LIMIT
    ) {
      nx = rng() - 0.5;
      ny = rng() - 0.5;
      nz = rng() - 0.5;
    }
    x = nx;
    y = ny;
    z = nz;

    // --- inlined plotPoint(prepared, x, y, z, rng) -------------------------
    let px = x;
    let py = y;
    let pz = z;
    if (finalAffine !== null) {
      const fm = finalAffine.m;
      const ft = finalAffine.t;
      let fx = fm[0] * x + fm[1] * y + fm[2] * z + ft[0];
      let fy = fm[3] * x + fm[4] * y + fm[5] * z + ft[1];
      let fz = fm[6] * x + fm[7] * y + fm[8] * z + ft[2];
      if (finalWarp !== null) {
        const q = finalWarp(fx, fy, fz, rng);
        fx = q[0];
        fy = q[1];
        fz = q[2];
      }
      if (Number.isFinite(fx) && Number.isFinite(fy) && Number.isFinite(fz)) {
        px = fx;
        py = fy;
        pz = fz;
      }
    }

    // --- bucket into the voxel grid ----------------------------------------
    const vx = Math.floor((px - minX) * invCellX);
    if (vx < 0 || vx >= size) continue;
    const vy = Math.floor((py - minY) * invCellY);
    if (vy < 0 || vy >= size) continue;
    const vz = Math.floor((pz - minZ) * invCellZ);
    if (vz < 0 || vz >= size) continue;

    const bucket = vz * sizeSq + vy * size + vx;
    const d = density[bucket] + 1;
    density[bucket] = d;
    if (d > maxDensity) maxDensity = d;

    let r: number;
    let g: number;
    let b: number;
    if (mode === MODE_TRANSFORM) {
      const rgb = palette[baseIdx];
      r = rgb === undefined ? FALLBACK_R : rgb[0];
      g = rgb === undefined ? FALLBACK_G : rgb[1];
      b = rgb === undefined ? FALLBACK_B : rgb[2];
    } else if (lut !== null) {
      // height or radius: the shared ramp at the normalized coordinate.
      // Unlike buildColors' exact point-cloud bounds, the trimmed pilot
      // extents CAN be (slightly) exceeded by a live point, so clamp t.
      const t =
        mode === MODE_HEIGHT
          ? (py - cMinY) * invRangeY
          : (Math.sqrt(px * px + py * py + pz * pz) - cMinR) * invRangeR;
      const li = (t <= 0 ? 0 : t >= 1 ? 255 : (t * 255 + 0.5) | 0) * 3;
      r = lut[li];
      g = lut[li + 1];
      b = lut[li + 2];
    } else if (mode === MODE_POSITION) {
      const tx = (px - cMinX) * invRangeX;
      const ty = (py - cMinY) * invRangeY;
      const tz = (pz - cMinZ) * invRangeZ;
      r =
        (tx <= 0 ? 0 : tx >= 1 ? 1 : tx) * POSITION_COLOR_SCALE +
        POSITION_COLOR_OFFSET;
      g =
        (ty <= 0 ? 0 : ty >= 1 ? 1 : ty) * POSITION_COLOR_SCALE +
        POSITION_COLOR_OFFSET;
      b =
        (tz <= 0 ? 0 : tz >= 1 ? 1 : tz) * POSITION_COLOR_SCALE +
        POSITION_COLOR_OFFSET;
    } else {
      r = uniR;
      g = uniG;
      b = uniB;
    }
    const o = bucket * 3;
    const inv = 1 / d;
    avgRGB[o] += (r - avgRGB[o]) * inv;
    avgRGB[o + 1] += (g - avgRGB[o + 1]) * inv;
    avgRGB[o + 2] += (b - avgRGB[o + 2]) * inv;
  }

  grid.orbit = [x, y, z];
  grid.maxDensity = maxDensity;
  return grid;
}

/**
 * Pack a {@link VoxelGrid} into RGBA8 3D-texture bytes (x-fastest, matching
 * the grid's own layout): RGB is the voxel's running-mean color, A is its
 * log-normalized density — `log1p(count) / log1p(maxDensity)`, the same
 * curve `tonemapFlame` brightens by, so "solid" on the GPU's isosurface
 * threshold lines up with "bright" in a flame of the same system. Empty
 * voxels are fully transparent black; a grid with nothing accumulated yet
 * packs to all zeros (the raymarcher then hits nothing and shows only the
 * backdrop).
 *
 * Allocates the output (the worker transfers it to the main thread per
 * update, so the buffer must be fresh each call).
 */
export function voxelTextureData(grid: VoxelGrid): Uint8Array<ArrayBuffer> {
  const { density, avgRGB, maxDensity } = grid;
  const out = new Uint8Array(density.length * 4);
  if (maxDensity <= 0) return out;

  const invLogMax = 1 / Math.log1p(maxDensity);
  for (let i = 0; i < density.length; i++) {
    const d = density[i];
    if (d <= 0) continue;
    const o = i * 4;
    const s = i * 3;
    // Math.round + the [0,1] inputs keep every channel in byte range without
    // an explicit clamp: avgRGB is a mean of sRGB palette channels in [0,1],
    // and log1p(d) <= log1p(maxDensity) by construction.
    out[o] = Math.round(avgRGB[s] * 255);
    out[o + 1] = Math.round(avgRGB[s + 1] * 255);
    out[o + 2] = Math.round(avgRGB[s + 2] * 255);
    out[o + 3] = Math.round(Math.log1p(d) * invLogMax * 255);
  }
  return out;
}
