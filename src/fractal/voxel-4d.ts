/**
 * The 4D twin of `voxel.ts`'s `computeVoxelBounds`/`accumulateVoxels`: it
 * voxelizes a 4D chaos-game orbit — rotated by a frozen-at-render-entry
 * rotor about the cloud's 4D center and orthographically projected to
 * 3D (drop the rotated w) — into the SAME world-space {@link VoxelGrid} the
 * 3D path fills, weighted by the soft w-slice window when it is on, so the
 * solid render "solidifies the current w-slice" while the camera itself
 * stays live (only the tumble freezes — see `chaos-game-4d.ts`'s
 * `PreparedChaosGame4` and `project4.ts`'s `RotorProjection4`/`FourDView`).
 *
 * Mirrors `flame-4d.ts`'s `accumulateFlame4` for the hand-inlined hot loop
 * (pick/affine/warp/symmetry post-rotation/escape-reseed, the frozen rotor
 * projection, the structural color coordinate) and `voxel.ts`'s `accumulateVoxels` for the
 * voxel-grid bucketing and running-mean color — see each function's doc
 * below for the specific deviations from those two templates.
 */
import {
  CHAOS_SUB_ORBIT_POINTS,
  ESCAPE_LIMIT,
  WARMUP_ITERATIONS,
  createEmitterStream,
  emitterSeed,
  pickScheduleIndex,
} from "./chaos-game";
import { pickIndex4, plotPoint4, stepOrbit4 } from "./chaos-game-4d";
import type { PreparedChaosGame4 } from "./chaos-game-4d";
import {
  POSITION_COLOR_OFFSET,
  POSITION_COLOR_SCALE,
  wRampColor,
  writePositionColor,
} from "./color";
import type { FourDRenderColor } from "./color";
import type { FourDView, RotorProjection4 } from "./project4";
import { sliceColorRemap, sliceWeight } from "./project4";
import {
  createLatticePointTilingProposal,
  createPointTilingCursorState,
  POINT_TILING_ACCUMULATION_FANOUT_CAP,
  pointTilingLatticeVisibility,
  visitPointTilingAttemptBounded,
} from "./point-tiling";
import type {
  LatticePointTilingProposal,
  PointTilingPlan,
} from "./point-tiling";
import { BOUNDS_MARGIN, BOUNDS_QUANTILE, VOXEL_BOUNDS_SAMPLES } from "./voxel";
import type { VoxelBounds, VoxelGrid } from "./voxel";
import type { Rng } from "./rng";
import type { Vec3 } from "./types";

/** Color for a transform outside `palette` — shouldn't happen; mirrors
 * `flame-4d.ts`'s `FALLBACK_COLOR` and `voxel.ts`'s own fallback. */
const FALLBACK_COLOR: Vec3 = [1, 1, 1];

/**
 * Pure (floor-0) slice weight a sample must clear to participate in
 * {@link computeVoxelBounds4}'s quantile trim — well above the
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

/** Shared by the settled-view proposal and the actual voxel deposit. */
export const VOXEL4_SKIP_WEIGHT = 1e-3;

/**
 * One worker-local 4D Solid tiling policy, prepared once per settled view and
 * reused by every accumulation chunk. The raw plan is dimension/geometry
 * state; only a lattice's proposal depends on the rotor and slice.
 */
export interface PreparedVoxelPointTiling4 {
  plan: PointTilingPlan;
  originVisibleRadius: number;
  carrierRadius: number;
  latticeProposal?: LatticePointTilingProposal;
}

/**
 * Prepare the selected 4D Solid deposition policy. Finite groups retain the
 * shared estimator verbatim. A lattice reweights its cell proposal by a
 * source-independent ceiling on the settled slice visibility, preserving all
 * stabilizer-mask CDFs in `point-tiling.ts`.
 */
export function prepareVoxelPointTiling4(
  plan: PointTilingPlan,
  originVisibleRadius: number,
  rotorProj: RotorProjection4,
  view: FourDView,
): PreparedVoxelPointTiling4 {
  if (plan.dimension !== 4) {
    throw new RangeError("4D voxel tiling requires a 4D point-tiling plan");
  }
  if (!(originVisibleRadius > 0) || !Number.isFinite(originVisibleRadius)) {
    throw new RangeError(
      "4D voxel tiling requires a positive finite origin radius",
    );
  }
  if (plan.kind === "finite") {
    return {
      plan,
      originVisibleRadius,
      carrierRadius: originVisibleRadius,
    };
  }

  const multipliers = new Float64Array(plan.upper.length);
  if (!view.sliceOn) {
    multipliers.fill(1);
  } else {
    const halfWidth = plan.tiling.radius * view.invWAmp;
    const h2 = 2 * plan.tiling.h;
    for (let cell = 0; cell < plan.upper.length; cell++) {
      const base = cell * plan.repeatedAxes;
      const cellX = h2 * plan.cells[base];
      const cellZ = h2 * plan.cells[base + 1];
      const cellW = h2 * plan.cells[base + 2];
      const sRawCenter =
        rotorProj[15] * cellX +
        rotorProj[17] * cellZ +
        rotorProj[18] * cellW +
        rotorProj[19];
      const center = sRawCenter * view.invWAmp;
      let lo = center - halfWidth;
      let hi = center + halfWidth;
      lo = lo < -1 ? -1 : lo > 1 ? 1 : lo;
      hi = hi < -1 ? -1 : hi > 1 ? 1 : hi;
      if (view.sliceCenter >= lo && view.sliceCenter <= hi) {
        multipliers[cell] = 1;
      } else {
        const nearest =
          Math.abs(lo - view.sliceCenter) < Math.abs(hi - view.sliceCenter)
            ? lo
            : hi;
        multipliers[cell] = sliceWeight(
          nearest,
          view.sliceCenter,
          view.sliceWidth,
          0,
        );
      }
    }
  }
  return {
    plan,
    originVisibleRadius,
    carrierRadius: plan.tiling.presentation.outerRadius,
    latticeProposal: createLatticePointTilingProposal(
      plan,
      multipliers,
      VOXEL4_SKIP_WEIGHT,
    ),
  };
}

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
 * **Slice-aware trimming**: when `view.sliceOn`, the quantile trim
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
  tiling?: PreparedVoxelPointTiling4,
): VoxelBounds {
  if (tiling !== undefined) {
    const half = tiling.carrierRadius;
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
  const allX = new Float64Array(samples);
  const allY = new Float64Array(samples);
  const allZ = new Float64Array(samples);
  const allR = new Float64Array(samples);
  // Only populated when the slice is on — see this function's doc.
  const weights = view.sliceOn ? new Float64Array(samples) : null;

  // Graph-directed selection state — computeVoxelBounds' chi threading one
  // dimension up: a block-diagonal chi pilot must re-fuse or the grid hugs
  // one block and crops the rest. Inert without chi rows.
  const chaosOn = prepared.chaosRows !== null;
  let prevBase = -1;

  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;
  let w = rng() - 0.5;
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    const step = stepOrbit4(prepared, x, y, z, w, rng, rng, prevBase);
    x = step.x;
    y = step.y;
    z = step.z;
    w = step.w;
    prevBase = step.escaped ? -1 : step.index;
  }
  for (let i = 0; i < samples; i++) {
    if (chaosOn && i > 0 && i % CHAOS_SUB_ORBIT_POINTS === 0) {
      x = rng() - 0.5;
      y = rng() - 0.5;
      z = rng() - 0.5;
      w = rng() - 0.5;
      prevBase = -1;
      for (let k = 0; k < WARMUP_ITERATIONS; k++) {
        const step = stepOrbit4(prepared, x, y, z, w, rng, rng, prevBase);
        x = step.x;
        y = step.y;
        z = step.z;
        w = step.w;
        prevBase = step.escaped ? -1 : step.index;
      }
    }
    const step = stepOrbit4(prepared, x, y, z, w, rng, rng, prevBase);
    x = step.x;
    y = step.y;
    z = step.z;
    w = step.w;
    prevBase = step.escaped ? -1 : step.index;
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
 * `accumulateFlame4` does (pick/affine/warp/symmetry post-rotation/
 * escape-reseed, resetting the structural color coordinate `c` to `0.5` on an
 * escape-reseed) — see that
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
 * `color.palette[baseIdx]` (the BASE map index — every kaleidoscope copy
 * colors as the map it copies), falling back to `[1, 1, 1]` for an
 * out-of-range index; `"radius"` indexes `color.lut` at
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
  tiling?: PreparedVoxelPointTiling4,
): VoxelGrid {
  if (tiling !== undefined && tiling.plan.dimension !== 4) {
    throw new RangeError("accumulateVoxels4 requires a 4D point-tiling plan");
  }
  const {
    affines,
    variations,
    postRotations,
    posts,
    finalAffine,
    finalWarp,
    finalPost,
  } = prepared;
  const { baseTransformCount, schedule, emitters } = prepared;
  const { size, density, avgRGB } = grid;
  let maxDensity = grid.maxDensity;
  // Emitter-sample stream — accumulateFlame4's per-run reseedable object,
  // one primary seed draw per emitter step (chaos-game.ts's emitterSeed).
  // Inert without emitters.
  const emitterStream = createEmitterStream();
  const emitterDraw = emitterStream.draw;

  // Structural coloring (mirrors accumulateFlame4's colorLUT path exactly —
  // see FourDRenderColor's doc): `structural` gates both the per-step update
  // below and the escape-reseed reset. The per-map slot and blend speed were
  // resolved once by `prepareChaosGame4`, keyed on the BASE map index so
  // every kaleidoscope copy shares its map's slot — so a
  // 4D system authored for the flame colors identically here.
  const structural = color.kind === "structural";
  const colorSlots = prepared.colorIndex;
  const colorSpeeds = prepared.colorSpeed;
  let c = grid.orbitColor;
  const positionScratch =
    color.kind === "position" && color.axisColors !== undefined
      ? new Float32Array(3)
      : null;

  // Graph-directed selection state, resumed from the grid — see
  // accumulateVoxels' identical threading (chunk-boundary independence via
  // VoxelGrid.orbitPrevBase/orbitChaosLeft; inert without chi rows).
  const chaosOn = prepared.chaosRows !== null;
  let prevBase = grid.orbitPrevBase;
  let chaosLeft = grid.orbitChaosLeft;

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
      const step = stepOrbit4(prepared, x, y, z, w, rng, rng, prevBase);
      x = step.x;
      y = step.y;
      z = step.z;
      w = step.w;
      prevBase = step.escaped ? -1 : step.index;
    }
  } else {
    [x, y, z] = grid.orbit;
    w = grid.orbitW;
  }

  const { invWAmp, sliceOn, sliceCenter, sliceWidth } = view;
  // The slice-relative w-ramp recolor — identity (0, 1) unless the
  // slice is on and the option was chosen, so the wRamp branch below applies
  // it unconditionally (see sliceColorRemap's doc).
  const { shift: colorShift, invScale: colorInvScale } = sliceColorRemap(view);
  const pointTilingState =
    tiling === undefined
      ? undefined
      : (grid.pointTiling ??= createPointTilingCursorState());

  // Tiled images copy source-owned color provenance. W-ramp alone belongs to
  // the raw image's post-tiling signed-w and is resolved inside the visitor.
  let tiledSourceR = 0;
  let tiledSourceG = 0;
  let tiledSourceB = 0;
  const tiledVisitor =
    tiling === undefined
      ? undefined
      : (
          imageX: number,
          imageY: number,
          imageZ: number,
          imageW: number,
          imageWeight: number,
        ): void => {
          const projX =
            rotorProj[0] * imageX +
            rotorProj[1] * imageY +
            rotorProj[2] * imageZ +
            rotorProj[3] * imageW +
            rotorProj[4];
          const projY =
            rotorProj[5] * imageX +
            rotorProj[6] * imageY +
            rotorProj[7] * imageZ +
            rotorProj[8] * imageW +
            rotorProj[9];
          const projZ =
            rotorProj[10] * imageX +
            rotorProj[11] * imageY +
            rotorProj[12] * imageZ +
            rotorProj[13] * imageW +
            rotorProj[14];
          const sRaw =
            rotorProj[15] * imageX +
            rotorProj[16] * imageY +
            rotorProj[17] * imageZ +
            rotorProj[18] * imageW +
            rotorProj[19];
          const sScaled = sRaw * invWAmp;
          const s = sScaled < -1 ? -1 : sScaled > 1 ? 1 : sScaled;
          const slice = sliceOn
            ? sliceWeight(s, sliceCenter, sliceWidth, 0)
            : 1;
          const weight = imageWeight * slice;
          if (tiling.plan.kind === "lattice") {
            // The lattice oracle applies the contribution gate BEFORE
            // importance reweighting. A cell omitted by the proposal has
            // coverage*slice below this same threshold for every source.
            const coverage = pointTilingLatticeVisibility(
              tiling.plan,
              Math.hypot(imageX, imageY, imageZ, imageW),
            );
            if (coverage * slice < VOXEL4_SKIP_WEIGHT) return;
          } else if (weight < VOXEL4_SKIP_WEIGHT) {
            return;
          }

          const vx = Math.floor((projX - minX) * invCellX);
          if (vx < 0 || vx >= size) return;
          const vy = Math.floor((projY - minY) * invCellY);
          if (vy < 0 || vy >= size) return;
          const vz = Math.floor((projZ - minZ) * invCellZ);
          if (vz < 0 || vz >= size) return;

          const bucket = vz * sizeSq + vy * size + vx;
          const d = density[bucket] + weight;
          density[bucket] = d;
          if (d > maxDensity) maxDensity = d;

          let r = tiledSourceR;
          let g = tiledSourceG;
          let b = tiledSourceB;
          if (color.kind === "wRamp") {
            const rgb = wRampColor(
              (s - colorShift) * colorInvScale,
              color.side,
            );
            r = rgb[0];
            g = rgb[1];
            b = rgb[2];
          }
          const offset = bucket * 3;
          const invWeight = weight / d;
          avgRGB[offset] += (r - avgRGB[offset]) * invWeight;
          avgRGB[offset + 1] += (g - avgRGB[offset + 1]) * invWeight;
          avgRGB[offset + 2] += (b - avgRGB[offset + 2]) * invWeight;
        };

  for (let n = 0; n < iterations; n++) {
    // Sub-orbit re-fuse — accumulateVoxels' chi block, four coordinates (see
    // chaos-game.ts's CHAOS_SUB_ORBIT_POINTS): reseed from `rng` (the one
    // stream here), reset to the entry pick, warm up unrecorded through the
    // real stepOrbit4, reset the structural color walk like an
    // escape-reseed's.
    if (chaosOn) {
      if (chaosLeft <= 0) {
        x = rng() - 0.5;
        y = rng() - 0.5;
        z = rng() - 0.5;
        w = rng() - 0.5;
        prevBase = -1;
        for (let k = 0; k < WARMUP_ITERATIONS; k++) {
          const step = stepOrbit4(prepared, x, y, z, w, rng, rng, prevBase);
          x = step.x;
          y = step.y;
          z = step.z;
          w = step.w;
          prevBase = step.escaped ? -1 : step.index;
        }
        if (structural) c = 0.5;
        chaosLeft = CHAOS_SUB_ORBIT_POINTS;
      }
      chaosLeft--;
    }
    // --- inlined stepOrbit4(prepared, x, y, z, w, rng) ---------------------
    const idx = pickIndex4(prepared, rng, prevBase);
    // The BASE map this slot is a (possibly rotated) copy of — see
    // PreparedChaosGame4.baseTransformCount. Equal to `idx` at symmetry order
    // 1. Anything keyed to "which logical map" (the color slot below, and the
    // `palette` lookup further down) uses this, never the raw expanded `idx`.
    const baseIdx = idx % baseTransformCount;
    // Blend the color coordinate toward this transform's slot at this
    // transform's speed, BEFORE applying its affine — mirrors
    // accumulateFlame4's formula and ordering exactly. No rng is consumed, so
    // the orbit (and `density`) is identical whether or not structural
    // coloring is in play.
    if (structural) {
      const speed = colorSpeeds[baseIdx];
      c = c * (1 - speed) + colorSlots[baseIdx] * speed;
    }
    const emitter = emitters !== null ? emitters[baseIdx] : null;
    let nx: number;
    let ny: number;
    let nz: number;
    let nw: number;
    if (emitter !== null) {
      // Condensation step — stepOrbit4's emitter branch exactly: one
      // primary seed draw, the 3D sample embedded at w = 0 (the m[3]/m[7]/
      // m[11]/m[15] column drops out), the slot's 4D affine as the pose.
      emitterStream.reseed(emitterSeed(rng));
      const sample = emitter(emitterDraw);
      const aff = affines[idx];
      const m = aff.m;
      const t = aff.t;
      nx = m[0] * sample[0] + m[1] * sample[1] + m[2] * sample[2] + t[0];
      ny = m[4] * sample[0] + m[5] * sample[1] + m[6] * sample[2] + t[1];
      nz = m[8] * sample[0] + m[9] * sample[1] + m[10] * sample[2] + t[2];
      nw = m[12] * sample[0] + m[13] * sample[1] + m[14] * sample[2] + t[3];
    } else {
      const aff = affines[idx];
      const m = aff.m;
      const t = aff.t;
      const ax = m[0] * x + m[1] * y + m[2] * z + m[3] * w + t[0];
      const ay = m[4] * x + m[5] * y + m[6] * z + m[7] * w + t[1];
      const az = m[8] * x + m[9] * y + m[10] * z + m[11] * w + t[2];
      const aw = m[12] * x + m[13] * y + m[14] * z + m[15] * w + t[3];

      const warp = variations[idx];
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
      // The slot's POST-AFFINE — stepOrbit4's insertion exactly (this loop
      // is its hand-inlined mirror, pinned by the oracle test). Emitter
      // steps skip it.
      const slotPost = posts[idx];
      if (slotPost !== null) {
        const sm = slotPost.m;
        const st = slotPost.t;
        const sx = sm[0] * nx + sm[1] * ny + sm[2] * nz + sm[3] * nw + st[0];
        const sy = sm[4] * nx + sm[5] * ny + sm[6] * nz + sm[7] * nw + st[1];
        const sz = sm[8] * nx + sm[9] * ny + sm[10] * nz + sm[11] * nw + st[2];
        const sw =
          sm[12] * nx + sm[13] * ny + sm[14] * nz + sm[15] * nw + st[3];
        nx = sx;
        ny = sy;
        nz = sz;
        nw = sw;
      }
    }

    // Symmetry: rotate this slot's FULL affine + variation output —
    // see `chaos-game-4d.ts`'s `stepOrbit4`, which this mirrors exactly.
    // `null` (order 1, and every unrotated copy-0 slot at any order) skips
    // this, so the orbit stays byte-identical to the pre-symmetry loop
    // exactly where there is nothing to rotate.
    const post = postRotations[idx];
    if (post !== null) {
      const rx = post[0] * nx + post[1] * ny + post[2] * nz + post[3] * nw;
      const ry = post[4] * nx + post[5] * ny + post[6] * nz + post[7] * nw;
      const rz = post[8] * nx + post[9] * ny + post[10] * nz + post[11] * nw;
      const rw = post[12] * nx + post[13] * ny + post[14] * nz + post[15] * nw;
      nx = rx;
      ny = ry;
      nz = rz;
      nw = rw;
    }

    let escaped = false;
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
      escaped = true;
    }
    x = nx;
    y = ny;
    z = nz;
    w = nw;
    // Selection state for the next pick — stepOrbit4's escaped/index
    // contract exactly. Inert without chi rows.
    prevBase = escaped ? -1 : baseIdx;

    // --- inlined plotPoint4(prepared, x, y, z, w, rng) ---------------------
    // Post-word first, then the lens — chaos-game-4d.ts's plotPoint4 stage
    // for stage (single-stream consumer, so the B-picks draw from `rng`).
    let px = x;
    let py = y;
    let pz = z;
    let pw = w;
    if (schedule !== null) {
      let sx = px;
      let sy = py;
      let sz = pz;
      let sw = pw;
      for (let d = 0; d < schedule.depth; d++) {
        const bAff = schedule.affines[pickScheduleIndex(schedule, rng)];
        const bm = bAff.m;
        const bt = bAff.t;
        const nx = bm[0] * sx + bm[1] * sy + bm[2] * sz + bm[3] * sw + bt[0];
        const ny = bm[4] * sx + bm[5] * sy + bm[6] * sz + bm[7] * sw + bt[1];
        const nz = bm[8] * sx + bm[9] * sy + bm[10] * sz + bm[11] * sw + bt[2];
        const nw =
          bm[12] * sx + bm[13] * sy + bm[14] * sz + bm[15] * sw + bt[3];
        sx = nx;
        sy = ny;
        sz = nz;
        sw = nw;
      }
      if (
        Number.isFinite(sx) &&
        Number.isFinite(sy) &&
        Number.isFinite(sz) &&
        Number.isFinite(sw)
      ) {
        px = sx;
        py = sy;
        pz = sz;
        pw = sw;
      }
    }
    if (finalAffine !== null) {
      const fm = finalAffine.m;
      const ft = finalAffine.t;
      let fx = fm[0] * px + fm[1] * py + fm[2] * pz + fm[3] * pw + ft[0];
      let fy = fm[4] * px + fm[5] * py + fm[6] * pz + fm[7] * pw + ft[1];
      let fz = fm[8] * px + fm[9] * py + fm[10] * pz + fm[11] * pw + ft[2];
      let fw = fm[12] * px + fm[13] * py + fm[14] * pz + fm[15] * pw + ft[3];
      if (finalWarp !== null) {
        const q = finalWarp(fx, fy, fz, fw, rng);
        fx = q[0];
        fy = q[1];
        fz = q[2];
        fw = q[3];
      }
      // The lens's own post-affine, after its variation blend — plotPoint4's
      // lens order exactly.
      if (finalPost !== null) {
        const pm = finalPost.m;
        const pt = finalPost.t;
        const gx = pm[0] * fx + pm[1] * fy + pm[2] * fz + pm[3] * fw + pt[0];
        const gy = pm[4] * fx + pm[5] * fy + pm[6] * fz + pm[7] * fw + pt[1];
        const gz = pm[8] * fx + pm[9] * fy + pm[10] * fz + pm[11] * fw + pt[2];
        const gw =
          pm[12] * fx + pm[13] * fy + pm[14] * fz + pm[15] * fw + pt[3];
        fx = gx;
        fy = gy;
        fz = gz;
        fw = gw;
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

    if (tiling !== undefined) {
      // Resolve canonical-source color once, before any image transform.
      // W-ramp is the deliberate exception and reads the image in the
      // allocation-free visitor above.
      tiledSourceR = 0;
      tiledSourceG = 0;
      tiledSourceB = 0;
      switch (color.kind) {
        case "structural": {
          const li = Math.min(255, (c * 256) | 0) * 3;
          tiledSourceR = color.lut[li];
          tiledSourceG = color.lut[li + 1];
          tiledSourceB = color.lut[li + 2];
          break;
        }
        case "wRamp":
          break;
        case "transform": {
          const rgb = color.palette[baseIdx] ?? FALLBACK_COLOR;
          tiledSourceR = rgb[0];
          tiledSourceG = rgb[1];
          tiledSourceB = rgb[2];
          break;
        }
        case "height": {
          const t = (py - color.minY) / (color.maxY - color.minY || 1);
          const li = (t <= 0 ? 0 : t >= 1 ? 255 : (t * 255 + 0.5) | 0) * 3;
          tiledSourceR = color.lut[li];
          tiledSourceG = color.lut[li + 1];
          tiledSourceB = color.lut[li + 2];
          break;
        }
        case "radius": {
          const dx = px - color.center[0];
          const dy = py - color.center[1];
          const dz = pz - color.center[2];
          const dw = pw - color.center[3];
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
          const t = (distance - color.minD) / (color.maxD - color.minD || 1);
          const li = (t <= 0 ? 0 : t >= 1 ? 255 : (t * 255 + 0.5) | 0) * 3;
          tiledSourceR = color.lut[li];
          tiledSourceG = color.lut[li + 1];
          tiledSourceB = color.lut[li + 2];
          break;
        }
        case "position": {
          const tx0 = (px - color.min[0]) / (color.max[0] - color.min[0] || 1);
          const ty0 = (py - color.min[1]) / (color.max[1] - color.min[1] || 1);
          const tz0 = (pz - color.min[2]) / (color.max[2] - color.min[2] || 1);
          const tx = tx0 <= 0 ? 0 : tx0 >= 1 ? 1 : tx0;
          const ty = ty0 <= 0 ? 0 : ty0 >= 1 ? 1 : ty0;
          const tz = tz0 <= 0 ? 0 : tz0 >= 1 ? 1 : tz0;
          const gx = color.colorGamma === 1 ? tx : tx ** color.colorGamma;
          const gy = color.colorGamma === 1 ? ty : ty ** color.colorGamma;
          const gz = color.colorGamma === 1 ? tz : tz ** color.colorGamma;
          if (color.axisColors === undefined) {
            tiledSourceR = gx * POSITION_COLOR_SCALE + POSITION_COLOR_OFFSET;
            tiledSourceG = gy * POSITION_COLOR_SCALE + POSITION_COLOR_OFFSET;
            tiledSourceB = gz * POSITION_COLOR_SCALE + POSITION_COLOR_OFFSET;
          } else {
            writePositionColor(
              positionScratch!,
              0,
              gx,
              gy,
              gz,
              color.axisColors,
            );
            tiledSourceR = positionScratch![0];
            tiledSourceG = positionScratch![1];
            tiledSourceB = positionScratch![2];
          }
          break;
        }
        case "uniform":
          [tiledSourceR, tiledSourceG, tiledSourceB] = color.color;
          break;
      }
      visitPointTilingAttemptBounded(
        tiling.plan,
        px,
        py,
        pz,
        pw,
        POINT_TILING_ACCUMULATION_FANOUT_CAP,
        pointTilingState!,
        tiledVisitor!,
        tiling.latticeProposal,
      );
      continue;
    }

    // Keep the original no-tiling projection/deposit path textually intact.
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
    if (weight < VOXEL4_SKIP_WEIGHT) continue;

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
        // The optional slice-relative remap of s — wRampColor's own
        // clamp bounds the rescaled signal, exactly like the raw s's.
        const rgb = wRampColor((s - colorShift) * colorInvScale, color.side);
        r = rgb[0];
        g = rgb[1];
        b = rgb[2];
        break;
      }
      case "transform": {
        const rgb = color.palette[baseIdx] ?? FALLBACK_COLOR;
        r = rgb[0];
        g = rgb[1];
        b = rgb[2];
        break;
      }
      case "height": {
        const t = (py - color.minY) / (color.maxY - color.minY || 1);
        const li = (t <= 0 ? 0 : t >= 1 ? 255 : (t * 255 + 0.5) | 0) * 3;
        r = color.lut[li];
        g = color.lut[li + 1];
        b = color.lut[li + 2];
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
      case "position": {
        const tx0 = (px - color.min[0]) / (color.max[0] - color.min[0] || 1);
        const ty0 = (py - color.min[1]) / (color.max[1] - color.min[1] || 1);
        const tz0 = (pz - color.min[2]) / (color.max[2] - color.min[2] || 1);
        const tx = tx0 <= 0 ? 0 : tx0 >= 1 ? 1 : tx0;
        const ty = ty0 <= 0 ? 0 : ty0 >= 1 ? 1 : ty0;
        const tz = tz0 <= 0 ? 0 : tz0 >= 1 ? 1 : tz0;
        const gx = color.colorGamma === 1 ? tx : tx ** color.colorGamma;
        const gy = color.colorGamma === 1 ? ty : ty ** color.colorGamma;
        const gz = color.colorGamma === 1 ? tz : tz ** color.colorGamma;
        if (color.axisColors === undefined) {
          r = gx * POSITION_COLOR_SCALE + POSITION_COLOR_OFFSET;
          g = gy * POSITION_COLOR_SCALE + POSITION_COLOR_OFFSET;
          b = gz * POSITION_COLOR_SCALE + POSITION_COLOR_OFFSET;
        } else {
          writePositionColor(positionScratch!, 0, gx, gy, gz, color.axisColors);
          r = positionScratch![0];
          g = positionScratch![1];
          b = positionScratch![2];
        }
        break;
      }
      case "uniform":
        [r, g, b] = color.color;
        break;
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
  grid.orbitPrevBase = prevBase;
  grid.orbitChaosLeft = chaosLeft;
  grid.maxDensity = maxDensity;
  return grid;
}
