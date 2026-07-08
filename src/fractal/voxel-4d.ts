/**
 * The 4D twin of `voxel.ts`'s `computeVoxelBounds`/`accumulateVoxels`
 * (fr-4wd): voxelizes a 4D chaos-game orbit — rotated by a frozen-at-render-
 * entry rotor about the cloud's 4D center and orthographically projected to
 * 3D (drop the rotated w) — into the SAME world-space {@link VoxelGrid} the
 * 3D path fills, weighted by the soft w-slice window when it is on, so the
 * solid render "solidifies the current w-slice" while the camera itself
 * stays live (only the tumble freezes — see `chaos-game-4d.ts`'s
 * `PreparedChaosGame4` and `project4.ts`'s `RotorProjection4`/`FourDView`).
 *
 * Mirrors `flame-4d.ts`'s `accumulateFlame4` for the hand-inlined hot loop
 * (pick/affine/warp/escape-reseed, the frozen rotor projection, the
 * structural color coordinate) and `voxel.ts`'s `accumulateVoxels` for the
 * voxel-grid bucketing and running-mean color — see each function's doc
 * below for the specific deviations from those two templates.
 */
import { ESCAPE_LIMIT, WARMUP_ITERATIONS } from "./chaos-game";
import { pickIndex4, plotPoint4, stepOrbit4 } from "./chaos-game-4d";
import type { PreparedChaosGame4 } from "./chaos-game-4d";
import { wRampColor } from "./color";
import type { FourDRenderColor } from "./color";
import type { FourDView, RotorProjection4 } from "./project4";
import { sliceColorRemap, sliceWeight } from "./project4";
import { BOUNDS_MARGIN, BOUNDS_QUANTILE, VOXEL_BOUNDS_SAMPLES } from "./voxel";
import type { VoxelBounds, VoxelGrid } from "./voxel";
import type { Rng } from "./rng";
import type { Vec3 } from "./types";

/** Color for a transform outside `palette` — shouldn't happen; mirrors
 * `flame-4d.ts`'s `FALLBACK_COLOR` and `voxel.ts`'s own fallback. */
const FALLBACK_COLOR: Vec3 = [1, 1, 1];

/**
 * Pure (floor-0) slice weight a sample must clear to participate in
 * {@link computeVoxelBounds4}'s quantile trim (fr-4wd) — well above the
 * flame/point-cloud's 0.06 ghost floor, so genuinely faint ghost context
 * doesn't drag the trim back out toward the whole cloud.
 */
const SLICE_TRIM_THRESHOLD = 0.05;

/**
 * Minimum fraction of pilot samples that must clear {@link SLICE_TRIM_THRESHOLD}
 * before the trim actually restricts itself to them — below this, a slice
 * has been pushed so far past the cloud's w-range that "the samples that
 * qualify" is a statistically meaningless handful (or zero), and trimming to
 * just those would produce a degenerate (or wildly wrong) cube instead of a
 * merely-uninteresting one.
 */
const SLICE_TRIM_MIN_FRACTION = 0.01;

/**
 * The 4D twin of `voxel.ts`'s `computeVoxelBounds`: estimate the world-space
 * cube enclosing the ROTOR-PROJECTED attractor by running a short pilot
 * orbit — warmed up and sampled exactly like `computeVoxelBounds` (via the
 * real, non-inlined {@link stepOrbit4}/{@link plotPoint4}, so the pilot
 * plots through the final transform's lens exactly like the 3D pilot does)
 * — and taking per-axis trimmed quantiles of each sample's PROJECTED 3D
 * point (`rotorProj`'s `px`/`py`/`pz` rows) rather than the raw 4D orbit
 * point.
 *
 * Each sample's normalized signed-w signal `s = clamp(sRaw * view.invWAmp,
 * -1, 1)` (`rotorProj`'s `sRaw` row) is also computed — see `project4.ts`'s
 * `RotorProjection4` doc for the row layout.
 *
 * **Slice-aware trimming (fr-4wd)**: when `view.sliceOn`, the quantile trim
 * considers ONLY samples whose PURE Gaussian slice weight
 * ({@link sliceWeight} with `floor = 0`, unlike the flame/point-cloud's 0.06
 * ghost floor) is at least {@link SLICE_TRIM_THRESHOLD} — so the grid's
 * resolution hugs the structure actually visible in the current slice
 * instead of being stretched to cover ghost context nobody can see solidified.
 * If fewer than {@link SLICE_TRIM_MIN_FRACTION} of samples qualify (a slice
 * centered far outside the cloud's w-range), the trim falls back to EVERY
 * sample — the same bounds a `sliceOn: false` run would produce — rather
 * than risk a degenerate cube built from a statistically meaningless
 * handful of samples.
 *
 * The returned {@link VoxelBounds.color} mirrors the 3D function's own: the
 * un-cubed, un-padded trimmed extents, computed over the exact sample set
 * the trim used (the filtered subset, or every sample on the `sliceOn:
 * false` / fallback path).
 *
 * Consumes `rng` (the pilot is a real orbit); callers wanting the subsequent
 * accumulation to be reproducible should treat the bounds pass as part of
 * the same seeded run, exactly as `computeVoxelBounds` documents.
 */
export function computeVoxelBounds4(
  prepared: PreparedChaosGame4,
  rotorProj: RotorProjection4,
  view: FourDView,
  rng: Rng,
  samples: number = VOXEL_BOUNDS_SAMPLES,
): VoxelBounds {
  const allX = new Float64Array(samples);
  const allY = new Float64Array(samples);
  const allZ = new Float64Array(samples);
  const allR = new Float64Array(samples);
  // Only populated when the slice is on — see this function's doc.
  const weights = view.sliceOn ? new Float64Array(samples) : null;

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
  for (let i = 0; i < samples; i++) {
    const step = stepOrbit4(prepared, x, y, z, w, rng);
    x = step.x;
    y = step.y;
    z = step.z;
    w = step.w;
    const [px, py, pz, pw] = plotPoint4(prepared, x, y, z, w, rng);

    const projX =
      rotorProj[0] * px +
      rotorProj[1] * py +
      rotorProj[2] * pz +
      rotorProj[3] * pw +
      rotorProj[4];
    const projY =
      rotorProj[5] * px +
      rotorProj[6] * py +
      rotorProj[7] * pz +
      rotorProj[8] * pw +
      rotorProj[9];
    const projZ =
      rotorProj[10] * px +
      rotorProj[11] * py +
      rotorProj[12] * pz +
      rotorProj[13] * pw +
      rotorProj[14];
    allX[i] = projX;
    allY[i] = projY;
    allZ[i] = projZ;
    allR[i] = Math.sqrt(projX * projX + projY * projY + projZ * projZ);

    if (weights !== null) {
      const sRaw =
        rotorProj[15] * px +
        rotorProj[16] * py +
        rotorProj[17] * pz +
        rotorProj[18] * pw +
        rotorProj[19];
      const sScaled = sRaw * view.invWAmp;
      const s = sScaled < -1 ? -1 : sScaled > 1 ? 1 : sScaled;
      weights[i] = sliceWeight(s, view.sliceCenter, view.sliceWidth, 0);
    }
  }

  // Pick the trim-participant sample set — see this function's doc.
  let xs: Float64Array;
  let ys: Float64Array;
  let zs: Float64Array;
  let rs: Float64Array;
  if (weights === null) {
    xs = allX;
    ys = allY;
    zs = allZ;
    rs = allR;
  } else {
    let qualifying = 0;
    for (let i = 0; i < samples; i++) {
      if (weights[i] >= SLICE_TRIM_THRESHOLD) qualifying++;
    }
    if (qualifying >= samples * SLICE_TRIM_MIN_FRACTION) {
      xs = new Float64Array(qualifying);
      ys = new Float64Array(qualifying);
      zs = new Float64Array(qualifying);
      rs = new Float64Array(qualifying);
      let j = 0;
      for (let i = 0; i < samples; i++) {
        if (weights[i] < SLICE_TRIM_THRESHOLD) continue;
        xs[j] = allX[i];
        ys[j] = allY[i];
        zs[j] = allZ[i];
        rs[j] = allR[i];
        j++;
      }
    } else {
      // Fallback: too few samples are actually visible in this slice to
      // trim against meaningfully — use every sample, exactly like a
      // sliceOn: false run.
      xs = allX;
      ys = allY;
      zs = allZ;
      rs = allR;
    }
  }

  xs.sort();
  ys.sort();
  zs.sort();
  rs.sort();
  const n = xs.length;
  const lo = Math.floor(BOUNDS_QUANTILE * n);
  const hi = Math.max(lo, n - 1 - lo);

  const cx = (xs[lo] + xs[hi]) / 2;
  const cy = (ys[lo] + ys[hi]) / 2;
  const cz = (zs[lo] + zs[hi]) / 2;
  const half = Math.max(
    ((xs[hi] - xs[lo]) / 2) * (1 + BOUNDS_MARGIN),
    ((ys[hi] - ys[lo]) / 2) * (1 + BOUNDS_MARGIN),
    ((zs[hi] - zs[lo]) / 2) * (1 + BOUNDS_MARGIN),
    1e-6,
  );

  return {
    min: [cx - half, cy - half, cz - half],
    max: [cx + half, cy + half, cz + half],
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
 * Accumulate `iterations` more 4D chaos-game steps into a {@link VoxelGrid},
 * seen through a frozen 4D rotor (world-space, camera-independent — see this
 * module's doc). The 4D twin of `voxel.ts`'s `accumulateVoxels`, driving
 * `chaos-game-4d.ts`'s `PreparedChaosGame4` and hand-inlining
 * `stepOrbit4`/`plotPoint4`'s bodies exactly like `flame-4d.ts`'s
 * `accumulateFlame4` does (pick/affine/warp/escape-reseed, resetting the
 * structural color coordinate `c` to `0.5` on an escape-reseed) — see that
 * function for the full picture of the hot loop this mirrors.
 *
 * **Projection**: each plotted (post-lens) 4D point is projected through
 * `rotorProj` (see `project4.ts`'s `RotorProjection4`) to a 3D point plus a
 * raw signed-w signal `sRaw`, exactly like `accumulateFlame4`; `s = clamp(sRaw
 * * view.invWAmp, -1, 1)` is the normalized signal the soft w-slice and the
 * `"wRamp"` color kind both key on.
 *
 * **The soft w-slice uses a floor of 0, UNLIKE the flame's 0.06 ghost-context
 * floor**: the ghost floor is a display affordance of the additive point/
 * flame view (an out-of-slice point still contributes a faint visible
 * trace); a solid isosurface has no translucency to fall back on, so a flat
 * 6% density pedestal across the whole projection would pollute it instead.
 * `weight = view.sliceOn ? sliceWeight(s, view.sliceCenter, view.sliceWidth,
 * 0) : 1`. Points whose weight is below `1e-3` are skipped ENTIRELY — no
 * bucket math, no color computation — since they would round away to
 * nothing in the packed texture anyway; this is a perf guard for the (common,
 * with a narrow slice) case where most of the orbit lands outside it.
 *
 * **Voxel bucketing** mirrors `accumulateVoxels`' index math and
 * out-of-bounds skip exactly, but each hit adds the (possibly fractional)
 * `weight` to `density` rather than a flat `1` — `Float32Array` handles a
 * fractional accumulator fine. `avgRGB` stays a running mean, now weighted:
 * with `newDensity` the post-`+=` density, `avg += (rgb - avg) * (weight /
 * newDensity)` — at `weight` ≡ `1` (every unsliced hit) this is exactly
 * `avg += (rgb - avg) / newDensity`, the unweighted 3D running mean.
 *
 * **Coloring** dispatches on {@link FourDRenderColor} exactly like
 * `accumulateFlame4`: `"structural"` indexes `color.lut` at the orbit-riding
 * coordinate `c`; `"wRamp"` calls {@link wRampColor}; `"transform"` is
 * `color.palette[idx]` (the RAW picked transform index — 4D has no
 * kaleidoscope symmetry, so no base-map modulo to recover), falling back to
 * `[1, 1, 1]` for an out-of-range index; `"radius"` indexes `color.lut` at
 * the plotted point's 4D Euclidean distance from `color.center`, normalized
 * over `[color.minD, color.maxD]` with the same round-to-nearest 256-step
 * convention `voxel.ts` already uses for its own radius/height ramps.
 *
 * **Progressive**: pass the same grid back in to keep converging it — the
 * orbit (`grid.orbit`/`grid.orbitW`) and its color coordinate
 * (`grid.orbitColor`) resume from where they left off, so a chunked render
 * produces the identical grid to one long call, given the same `rng`
 * *instance* threaded through every call — exactly like `accumulateVoxels`.
 * A fresh grid (`orbit` `null`) draws a new random 4D seed point and warms it
 * up for `WARMUP_ITERATIONS` steps first (via the real, non-inlined
 * {@link stepOrbit4}), exactly like `accumulateFlame4`'s fresh-histogram path.
 *
 * Pass a seeded {@link Rng} for reproducible output (tests); the worker
 * passes a `mulberry32` seeded by the start command.
 */
export function accumulateVoxels4(
  prepared: PreparedChaosGame4,
  grid: VoxelGrid,
  iterations: number,
  rng: Rng,
  rotorProj: RotorProjection4,
  view: FourDView,
  color: FourDRenderColor,
): VoxelGrid {
  const { affines, variations, finalAffine, finalWarp, transformCount } =
    prepared;
  const { size, density, avgRGB } = grid;
  let maxDensity = grid.maxDensity;

  // Structural coloring (mirrors accumulateFlame4's colorLUT path exactly —
  // see FourDRenderColor's doc): `structural` gates both the per-step update
  // below and the escape-reseed reset. `colorDenom` is `n - 1` (0 for a
  // single-transform system, which pins the coordinate at 0.5) — keyed on
  // the raw `transformCount`, since 4D has no symmetry-expanded copies to
  // collapse back to a base index.
  const structural = color.kind === "structural";
  const colorDenom = transformCount > 1 ? transformCount - 1 : 0;
  let c = grid.orbitColor;

  const minX = grid.bounds.min[0];
  const minY = grid.bounds.min[1];
  const minZ = grid.bounds.min[2];
  // Bounds are always a non-degenerate cube (computeVoxelBounds4 floors the
  // half-extent away from zero), so these are finite and positive.
  const invCellX = size / (grid.bounds.max[0] - minX);
  const invCellY = size / (grid.bounds.max[1] - minY);
  const invCellZ = size / (grid.bounds.max[2] - minZ);
  const sizeSq = size * size;

  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (grid.orbit === null) {
    x = rng() - 0.5;
    y = rng() - 0.5;
    z = rng() - 0.5;
    w = rng() - 0.5;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const step = stepOrbit4(prepared, x, y, z, w, rng);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
    }
  } else {
    [x, y, z] = grid.orbit;
    w = grid.orbitW;
  }

  const { invWAmp, sliceOn, sliceCenter, sliceWidth } = view;
  // The slice-relative w-ramp recolor (fr-nn6) — identity (0, 1) unless the
  // slice is on and the option was chosen, so the wRamp branch below applies
  // it unconditionally (see sliceColorRemap's doc).
  const { shift: colorShift, invScale: colorInvScale } = sliceColorRemap(view);
  // Below this weight, a point's contribution would round away to nothing in
  // the packed texture — skip it entirely rather than pay for bucket math
  // and a color computation nobody will ever see (see this function's doc).
  const SKIP_WEIGHT = 1e-3;

  for (let n = 0; n < iterations; n++) {
    // --- inlined stepOrbit4(prepared, x, y, z, w, rng) ---------------------
    const idx = pickIndex4(prepared, rng);
    // Blend the color coordinate halfway toward this transform's slot,
    // BEFORE applying its affine — mirrors accumulateFlame4's ordering
    // exactly. No rng is consumed, so the orbit (and `density`) is identical
    // whether or not structural coloring is in play.
    if (structural) {
      const slot = colorDenom > 0 ? idx / colorDenom : 0.5;
      c = (c + slot) * 0.5;
    }
    const aff = affines[idx];
    const m = aff.m;
    const t = aff.t;
    const ax = m[0] * x + m[1] * y + m[2] * z + m[3] * w + t[0];
    const ay = m[4] * x + m[5] * y + m[6] * z + m[7] * w + t[1];
    const az = m[8] * x + m[9] * y + m[10] * z + m[11] * w + t[2];
    const aw = m[12] * x + m[13] * y + m[14] * z + m[15] * w + t[3];

    const warp = variations[idx];
    let nx: number;
    let ny: number;
    let nz: number;
    let nw: number;
    if (warp === null) {
      nx = ax;
      ny = ay;
      nz = az;
      nw = aw;
    } else {
      const q = warp(ax, ay, az, aw, rng);
      nx = q[0];
      ny = q[1];
      nz = q[2];
      nw = q[3];
    }

    if (
      !Number.isFinite(nx) ||
      !Number.isFinite(ny) ||
      !Number.isFinite(nz) ||
      !Number.isFinite(nw) ||
      Math.abs(nx) > ESCAPE_LIMIT ||
      Math.abs(ny) > ESCAPE_LIMIT ||
      Math.abs(nz) > ESCAPE_LIMIT ||
      Math.abs(nw) > ESCAPE_LIMIT
    ) {
      nx = rng() - 0.5;
      ny = rng() - 0.5;
      nz = rng() - 0.5;
      nw = rng() - 0.5;
      // The orbit restarts, so its color coordinate does too.
      if (structural) c = 0.5;
    }
    x = nx;
    y = ny;
    z = nz;
    w = nw;

    // --- inlined plotPoint4(prepared, x, y, z, w, rng) ---------------------
    let px = x;
    let py = y;
    let pz = z;
    let pw = w;
    if (finalAffine !== null) {
      const fm = finalAffine.m;
      const ft = finalAffine.t;
      let fx = fm[0] * x + fm[1] * y + fm[2] * z + fm[3] * w + ft[0];
      let fy = fm[4] * x + fm[5] * y + fm[6] * z + fm[7] * w + ft[1];
      let fz = fm[8] * x + fm[9] * y + fm[10] * z + fm[11] * w + ft[2];
      let fw = fm[12] * x + fm[13] * y + fm[14] * z + fm[15] * w + ft[3];
      if (finalWarp !== null) {
        const q = finalWarp(fx, fy, fz, fw, rng);
        fx = q[0];
        fy = q[1];
        fz = q[2];
        fw = q[3];
      }
      if (
        Number.isFinite(fx) &&
        Number.isFinite(fy) &&
        Number.isFinite(fz) &&
        Number.isFinite(fw)
      ) {
        px = fx;
        py = fy;
        pz = fz;
        pw = fw;
      }
    }

    // --- project through the frozen rotor and weigh by the w-slice --------
    const projX =
      rotorProj[0] * px +
      rotorProj[1] * py +
      rotorProj[2] * pz +
      rotorProj[3] * pw +
      rotorProj[4];
    const projY =
      rotorProj[5] * px +
      rotorProj[6] * py +
      rotorProj[7] * pz +
      rotorProj[8] * pw +
      rotorProj[9];
    const projZ =
      rotorProj[10] * px +
      rotorProj[11] * py +
      rotorProj[12] * pz +
      rotorProj[13] * pw +
      rotorProj[14];
    const sRaw =
      rotorProj[15] * px +
      rotorProj[16] * py +
      rotorProj[17] * pz +
      rotorProj[18] * pw +
      rotorProj[19];
    const sScaled = sRaw * invWAmp;
    const s = sScaled < -1 ? -1 : sScaled > 1 ? 1 : sScaled;
    // Floor 0 — UNLIKE the flame's 0.06 ghost floor. See this function's doc.
    const weight = sliceOn ? sliceWeight(s, sliceCenter, sliceWidth, 0) : 1;
    if (weight < SKIP_WEIGHT) continue;

    // --- bucket into the voxel grid ----------------------------------------
    const vx = Math.floor((projX - minX) * invCellX);
    if (vx < 0 || vx >= size) continue;
    const vy = Math.floor((projY - minY) * invCellY);
    if (vy < 0 || vy >= size) continue;
    const vz = Math.floor((projZ - minZ) * invCellZ);
    if (vz < 0 || vz >= size) continue;

    const bucket = vz * sizeSq + vy * size + vx;
    const d = density[bucket] + weight;
    density[bucket] = d;
    if (d > maxDensity) maxDensity = d;

    let r: number;
    let g: number;
    let b: number;
    switch (color.kind) {
      case "structural": {
        // c is in [0, 1]; the min guards the c === 1 edge (256 -> 255).
        const li = Math.min(255, (c * 256) | 0) * 3;
        r = color.lut[li];
        g = color.lut[li + 1];
        b = color.lut[li + 2];
        break;
      }
      case "wRamp": {
        // The optional slice-relative remap of s (fr-nn6) — wRampColor's own
        // clamp bounds the rescaled signal, exactly like the raw s's.
        const rgb = wRampColor((s - colorShift) * colorInvScale, color.side);
        r = rgb[0];
        g = rgb[1];
        b = rgb[2];
        break;
      }
      case "transform": {
        const rgb = color.palette[idx] ?? FALLBACK_COLOR;
        r = rgb[0];
        g = rgb[1];
        b = rgb[2];
        break;
      }
      case "radius": {
        const dx = px - color.center[0];
        const dy = py - color.center[1];
        const dz = pz - color.center[2];
        const dw = pw - color.center[3];
        const d4 = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
        const range = color.maxD - color.minD || 1;
        const t = (d4 - color.minD) / range;
        // Same 256-step rounding convention as voxel.ts's accumulateVoxels
        // ramp lookup (clamp then round-to-nearest, not floor).
        const li = (t <= 0 ? 0 : t >= 1 ? 255 : (t * 255 + 0.5) | 0) * 3;
        r = color.lut[li];
        g = color.lut[li + 1];
        b = color.lut[li + 2];
        break;
      }
    }
    const o = bucket * 3;
    // Weighted running mean: at weight === 1 (every unsliced hit),
    // weight / d === 1 / d, exactly voxel.ts's unweighted running-mean
    // update — see this function's doc.
    const invWeight = weight / d;
    avgRGB[o] += (r - avgRGB[o]) * invWeight;
    avgRGB[o + 1] += (g - avgRGB[o + 1]) * invWeight;
    avgRGB[o + 2] += (b - avgRGB[o + 2]) * invWeight;
  }

  grid.orbit = [x, y, z];
  grid.orbitW = w;
  grid.orbitColor = c;
  grid.maxDensity = maxDensity;
  return grid;
}
