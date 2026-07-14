/**
 * Outlier-robust bounds for the camera fit/chase to FRAME (fr-3xfk): per-axis
 * trimmed quantiles of the delivered point cloud, baked worker-side onto
 * every `CloudResult` (`cloud-worker-core.ts`'s `generateCloud` attaches
 * `frameBounds`/`frameRadius`) and read by main.ts's `attractorFramingBounds`,
 * which `camera-tween.ts`'s glide/chase actually frame — and, since fr-2b82,
 * by main.ts's glow-exposure block, whose points-per-pixel estimate likewise
 * wants the box where the mass actually is (the raw box's outlier inflation
 * under-estimated density and over-brightened the glow). The true min/max
 * `bounds` on the same result stays untouched and keeps driving everything
 * that must cover every point instead of merely look good on screen: color
 * normalization and the 4D frustum-culling sphere.
 *
 * The problem this fixes: a nonlinear variation can fling an isolated point
 * far off the attractor's actual shape before `stepOrbit`'s escape guard
 * reseeds it (`chaos-game.ts`). Framing the raw min/max lets a single such
 * straggler blow the fit out until the real structure occupies a sliver of
 * the frame — the worst measured case landed the fit 6.6× too far away.
 * `voxel.ts`'s `computeVoxelBounds` hit the identical problem sizing the
 * solid render's grid and fixed it the same way: sort samples per axis and
 * take a small trimmed quantile instead of the true extremes (see that
 * function's doc — it's the prior art this module follows, right down to the
 * index arithmetic).
 *
 * Unlike `computeVoxelBounds`, which spends a dedicated pilot orbit, this
 * reads the cloud generation ALREADY produced — a strided subsample of it,
 * not a fresh run. Chaos-game points decorrelate within a handful of
 * iterations, so a ~`FRAMING_SAMPLE_TARGET`-point stride sample is
 * statistically representative of the whole cloud (measured seed-to-seed fit
 * spread is ~1.4% at 4096 samples on the boot system) while keeping the cost
 * negligible — including on `cloud-generator.ts`'s main-thread synchronous
 * fallback, where this runs inline on the same frame as everything else.
 *
 * On the morph chase (`camera-tween.ts`'s `track`): quantiles of a stride
 * sample are far more frame-to-frame stable than a raw min/max, which one
 * stray point anywhere in a freshly-sampled intermediate cloud can kick. The
 * chase's own low-pass (`CAMERA_TRACK_TAU_MS`) further smooths whatever
 * wobble is left, so no extra smoothing belongs here.
 */
import type { Bounds, Vec4 } from "../fractal/types";

/**
 * Fraction of samples trimmed from EACH tail before taking the extent —
 * numerically the same 0.5%-per-tail trim as `voxel.ts`'s `BOUNDS_QUANTILE`
 * (same outlier statistics motivate it), but deliberately its OWN constant
 * rather than a shared import: the voxel grid's trim clips structure
 * permanently once the volume is baked, while a too-tight camera fit is
 * merely a zoom-out away, so the two are free to drift apart if one is later
 * tuned without the other.
 */
export const FRAMING_QUANTILE = 0.005;

/**
 * Target size of the strided subsample (see the module doc for why a stride
 * sample suffices in place of the full cloud). For a cloud at least this
 * large the actual sample count lands between `FRAMING_SAMPLE_TARGET` and
 * `2 * FRAMING_SAMPLE_TARGET - 1` (the stride is an integer, so it can
 * undershoot the target divisor slightly); a smaller cloud is sampled in
 * full.
 */
export const FRAMING_SAMPLE_TARGET = 4096;

/** The all-zero `Bounds` returned for an empty cloud — matches what
 * `runChaosGame` itself returns for zero points. */
function emptyBounds(): Bounds {
  return {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    minZ: 0,
    maxZ: 0,
    minR: 0,
    maxR: 0,
  };
}

/**
 * Per-axis (and radial) trimmed-quantile bounds of a delivered 3D cloud's
 * interleaved `positions` (length `count * 3`) — the box the camera fit
 * FRAMES (see the module doc). `minR`/`maxR` are the trimmed version of the
 * exact same statistic as `ChaosGameResult.bounds`'s `minR`/`maxR`: distance
 * from the ORIGIN, not from the box center.
 *
 * Reads a stride sample of ~`FRAMING_SAMPLE_TARGET` points rather than every
 * point (see the module doc), sorts each axis independently, and returns the
 * `FRAMING_QUANTILE`-trimmed extremes — the same index convention as
 * `voxel.ts`'s `computeVoxelBounds`.
 *
 * Returns the all-zero `Bounds` for `count <= 0`, matching what
 * `runChaosGame` returns for an empty run; `orbit.ts`'s `fitRadius` already
 * treats a degenerate box as "fall back to the boot radius", so an empty
 * cloud lands on a sane default fit rather than a divide-by-zero.
 */
export function framingBounds(positions: Float32Array, count: number): Bounds {
  if (count <= 0) return emptyBounds();

  const stride = Math.max(1, Math.floor(count / FRAMING_SAMPLE_TARGET));
  const n = Math.floor((count - 1) / stride) + 1;

  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const zs = new Float64Array(n);
  const rs = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const i = s * stride;
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    xs[s] = x;
    ys[s] = y;
    zs[s] = z;
    rs[s] = Math.sqrt(x * x + y * y + z * z);
  }
  // Typed-array sort's default comparator is numeric ascending (unlike
  // Array.prototype.sort's lexicographic default) — exactly what a quantile
  // lookup needs.
  xs.sort();
  ys.sort();
  zs.sort();
  rs.sort();

  const lo = Math.floor(FRAMING_QUANTILE * n);
  const hi = Math.max(lo, n - 1 - lo);

  return {
    minX: xs[lo],
    maxX: xs[hi],
    minY: ys[lo],
    maxY: ys[hi],
    minZ: zs[lo],
    maxZ: zs[hi],
    minR: rs[lo],
    maxR: rs[hi],
  };
}

/**
 * Top-trimmed quantile of the 4D Euclidean distance from `center` over a
 * delivered 4D cloud (interleaved `positions` xyz plus the separate `w`
 * buffer) — the 4D twin of {@link framingBounds}, but a single radius rather
 * than a per-axis box.
 *
 * A per-axis box is the wrong shape for the 4D fit: the 4D view tumbles by
 * rotating about `center` itself (`scene.ts`'s `uCenter4`), and a rotation
 * about `center` preserves every point's distance FROM `center` while it does
 * NOT preserve a per-axis box's alignment (a box that snugly fits the
 * pre-tumble cloud generally doesn't fit the same cloud post-tumble). A
 * distance quantile is rotation-invariant — valid at every tumble angle —
 * exactly where a per-axis quantile box would need recomputing as the view
 * turns. `ChaosGame4Result.radius` is already the EXACT max distance from
 * `center` (feeding the frustum-culling sphere and w-color normalization,
 * both of which must cover every point, outliers included); this is that
 * same statistic, trimmed, and used only for the fit.
 *
 * Only the upper tail is trimmed
 * (`n - 1 - floor(FRAMING_QUANTILE * n)`, one-sided): a distance-from-center
 * has no meaningful lower tail — the closest points already cluster near
 * `center`, they are never the outliers — so trimming a "bottom" would just
 * shrink the sample for no benefit.
 *
 * Returns `0` for `count <= 0`, matching `runChaosGame4`'s empty-result
 * radius.
 */
export function framingRadius4(
  positions: Float32Array,
  w: Float32Array,
  count: number,
  center: Vec4,
): number {
  if (count <= 0) return 0;

  const stride = Math.max(1, Math.floor(count / FRAMING_SAMPLE_TARGET));
  const n = Math.floor((count - 1) / stride) + 1;

  const ds = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const i = s * stride;
    const dx = positions[i * 3] - center[0];
    const dy = positions[i * 3 + 1] - center[1];
    const dz = positions[i * 3 + 2] - center[2];
    const dw = w[i] - center[3];
    ds[s] = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
  }
  ds.sort();

  return ds[Math.max(0, n - 1 - Math.floor(FRAMING_QUANTILE * n))];
}
