/**
 * The fractal-flame renderer's pure core: accumulate chaos-game iterations
 * into a 2D histogram (hit count + summed color per pixel bucket) and
 * tone-map that histogram to a displayable image. No Three.js, no DOM — the
 * app layer (`src/app/scene.ts`) supplies a frozen camera's projection
 * matrix as plain numbers and uploads the tone-mapped image to a texture.
 *
 * `accumulateFlame` drives the exact same stepping logic as the point-cloud
 * path (`stepOrbit` / `plotPoint` from `chaos-game.ts`) but hand-inlines
 * their bodies into one allocation-free loop: at the hundreds of millions of
 * iterations a converged flame needs, the objects and arrays those functions
 * allocate per call (an `OrbitStep`, `applyAffine`'s returned `Vec3`,
 * `plotPoint`'s returned `Vec3`) become real GC pressure inside a
 * `requestAnimationFrame` budget. The inlined loop is checked against the
 * real `stepOrbit`/`plotPoint` by an oracle test in `flame.test.ts` — see
 * "matches stepOrbit/plotPoint exactly" — so the two paths can never
 * silently drift apart.
 */
import {
  ESCAPE_LIMIT,
  WARMUP_ITERATIONS,
  pickIndex,
  stepOrbit,
} from "./chaos-game";
import type { PreparedChaosGame } from "./chaos-game";
import type { Rng } from "./rng";
import type { Vec3 } from "./types";

/**
 * A 4x4 matrix, row-major and flattened: `m[0..3]` is row 0, `m[4..7]` row 1,
 * `m[8..11]` row 2, `m[12..15]` row 3 (`m[r * 4 + c]` is row `r`, column `c`).
 * Applying it to a point computes clip-space `(cx, cy, cz, cw) = m · (x, y,
 * z, 1)`. `accumulateFlame` expects the camera's combined `projection *
 * view` matrix, so `cw` is positive exactly when the point is in front of
 * the camera (standard OpenGL/Three.js clip space).
 *
 * Plain `number[]`, not Three.js's `Matrix4` (which stores column-major, the
 * transpose of this) — `src/fractal/` stays dependency-free, so the app
 * layer is responsible for extracting and transposing the camera matrix
 * (`Matrix4.clone().transpose().elements` does exactly that).
 */
export type Mat4 = number[];

/**
 * A 2D density accumulation: one bucket per pixel of the target image, each
 * tracking how many iterations landed there and their summed color (so the
 * average — `sumRGB / hits` — is the bucket's color). Both `hits` and
 * `sumRGB` are `Float64Array`, not `Float32Array`, because a single hot
 * bucket in a converged render can exceed 2^24 — the point past which
 * `Float32` can no longer represent every integer exactly, and, worse, where
 * its ULP exceeds 1: once `sumRGB[o]` (which accumulates an O(1) palette
 * channel per hit) passes that magnitude in `Float32`, `+=` increments
 * smaller than the local ULP round away to a complete no-op, so the sum
 * *stops growing* while `hits` (correctly `Float64`) keeps climbing —
 * `sumRGB / hits` then systematically undershoots, desaturating and
 * darkening exactly the hottest, most-converged bucket toward black. That
 * is precisely the region this renderer (and the higher iteration counts
 * fr-73y will push toward) is built to render brightest, so the extra
 * memory (~2x `sumRGB`'s share — roughly 66 MB total at 1920x1080) buys
 * correctness where it matters most, not just cosmetic precision.
 *
 * Pass a histogram back into {@link accumulateFlame} to keep converging it —
 * see {@link createFlameHistogram} and {@link accumulateFlame}'s `orbit`
 * field for how a chunked render resumes.
 */
export interface FlameHistogram {
  width: number;
  height: number;
  /** Hit count per bucket, row-major (`row * width + col`), length `width * height`. */
  hits: Float64Array;
  /** Summed color per bucket, interleaved RGB, length `width * height * 3`. */
  sumRGB: Float64Array;
  /** Highest hit count seen in any bucket so far — anchors {@link tonemapFlame}'s log-density curve. */
  maxHits: number;
  /**
   * Orbit continuation point: where the chaos-game iterator left off. Not
   * part of the image — internal iterator state that lets a chunked,
   * progressive render (repeated {@link accumulateFlame} calls passing the
   * same histogram back in) resume the exact same orbit instead of
   * restarting — and rewarming — it every chunk.
   */
  orbit: Vec3;
}

/** A fresh, empty histogram: every bucket at zero hits, ready to accumulate into. */
export function createFlameHistogram(
  width: number,
  height: number,
): FlameHistogram {
  return {
    width,
    height,
    hits: new Float64Array(width * height),
    sumRGB: new Float64Array(width * height * 3),
    maxHits: 0,
    orbit: [0, 0, 0],
  };
}

/** Color for a transform index outside `palette` — shouldn't happen; mirrors `buildColors`' fallback. */
const FALLBACK_COLOR: Vec3 = [1, 1, 1];

/**
 * Accumulate `iterations` more chaos-game steps into a 2D histogram, seen
 * through a frozen camera. Each plotted point (`stepOrbit` + `plotPoint`,
 * exactly as the point-cloud path computes them) is projected by `projection`
 * (clip space, perspective-divided to NDC) and, if it lands in front of the
 * camera and inside the `width` x `height` frame, increments that pixel's
 * hit count and adds `palette[transformIndex]` to its color sum.
 *
 * **Progressive**: pass the histogram returned by a previous call back in as
 * `histogram` to keep converging the same image — the orbit resumes from
 * exactly where it left off (see {@link FlameHistogram.orbit}), so splitting
 * a run into chunks (e.g. one per animation frame) produces the identical
 * result as running all the iterations at once, given the same `rng`
 * *instance* threaded through every call. Omit `histogram` to start a fresh
 * one: a new random seed point is drawn from `rng` and warmed up for
 * {@link WARMUP_ITERATIONS} steps first (unrecorded), exactly like
 * `runChaosGame`, so the orbit is already on the attractor before anything
 * is plotted.
 *
 * Pass a seeded {@link Rng} for reproducible output (tests); the app passes
 * `Math.random`.
 */
export function accumulateFlame(
  prepared: PreparedChaosGame,
  projection: Mat4,
  width: number,
  height: number,
  iterations: number,
  rng: Rng,
  palette: Vec3[],
  histogram?: FlameHistogram,
): FlameHistogram {
  if (projection.length !== 16) {
    throw new RangeError(
      `accumulateFlame: projection must have 16 entries (row-major 4x4), got ${projection.length}`,
    );
  }
  const hist = histogram ?? createFlameHistogram(width, height);
  if (hist.width !== width || hist.height !== height) {
    throw new RangeError(
      `accumulateFlame: histogram is ${hist.width}x${hist.height}, but ${width}x${height} was requested`,
    );
  }

  const { affines, variations, finalAffine, finalWarp } = prepared;
  const { hits, sumRGB } = hist;
  let maxHits = hist.maxHits;

  let x: number;
  let y: number;
  let z: number;
  if (histogram === undefined) {
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
    [x, y, z] = hist.orbit;
  }

  // Row-major projection rows: X and Y (the NDC x/y numerators) and W (the
  // clip-space homogeneous coordinate, whose sign is "in front of the
  // camera" — see the Mat4 doc comment). Row 2 (clip Z) is never read: the
  // histogram accumulates density, it doesn't depth-sort.
  const rx0 = projection[0];
  const rx1 = projection[1];
  const rx2 = projection[2];
  const rx3 = projection[3];
  const ry0 = projection[4];
  const ry1 = projection[5];
  const ry2 = projection[6];
  const ry3 = projection[7];
  const rw0 = projection[12];
  const rw1 = projection[13];
  const rw2 = projection[14];
  const rw3 = projection[15];

  for (let n = 0; n < iterations; n++) {
    // --- inlined stepOrbit(prepared, x, y, z, rng) ------------------------
    const idx = pickIndex(prepared, rng);
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

    // --- project through the frozen camera and bucket -----------------------
    const cw = rw0 * px + rw1 * py + rw2 * pz + rw3;
    if (cw <= 0) continue; // behind (or exactly at) the camera.
    const cx = rx0 * px + rx1 * py + rx2 * pz + rx3;
    const cy = ry0 * px + ry1 * py + ry2 * pz + ry3;
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    const col = Math.floor((ndcX + 1) * 0.5 * width);
    // NDC Y points up; pixel row 0 is the top of the image, so flip.
    const row = Math.floor((1 - ndcY) * 0.5 * height);
    if (col < 0 || col >= width || row < 0 || row >= height) continue;

    const bucket = row * width + col;
    const hit = ++hits[bucket];
    if (hit > maxHits) maxHits = hit;
    const rgb = palette[idx] ?? FALLBACK_COLOR;
    const o = bucket * 3;
    sumRGB[o] += rgb[0];
    sumRGB[o + 1] += rgb[1];
    sumRGB[o + 2] += rgb[2];
  }

  hist.orbit = [x, y, z];
  hist.maxHits = maxHits;
  return hist;
}

/**
 * Recommended `gammaThreshold` (see {@link TonemapParams}) when the app
 * doesn't expose it as its own control — flam3 uses a value in this
 * neighborhood as an internal noise-suppression constant rather than
 * something users routinely tune.
 */
export const DEFAULT_GAMMA_THRESHOLD = 0.01;

/**
 * Tone-mapping controls: `exposure` alone was enough to make a converging
 * render usable (fr-o7s); `gamma`, `gammaThreshold`, and `vibrancy` (fr-ucs)
 * add the rest of the classic flame "punchy, painterly" look on top.
 */
export interface TonemapParams {
  /**
   * Brightness multiplier applied to the final color; 1 is neutral. Above 1
   * pushes more of the image toward full brightness (and lets the hottest
   * buckets clip to white); below 1 darkens the whole image.
   */
  exposure: number;
  /**
   * Reshapes the normalized [0, 1] log-density curve by `density **
   * (1/gamma)`; 1 leaves the log-density curve exactly as fr-o7s shipped it
   * (no reshaping — the collapse point every gamma-related test is pinned
   * to). Above 1 pushes faint, sparsely-visited detail brighter relative to
   * the hottest buckets — the "punchy" flame look; below 1 does the reverse.
   */
  gamma: number;
  /**
   * Below this normalized density, the gamma curve is replaced by a straight
   * line through the origin, slope-matched to `density ** (1/gamma)` at the
   * threshold (so there is no kink). `density ** (1/gamma)` has infinite
   * slope at density = 0 whenever gamma > 1, so without this a single stray
   * hit in an otherwise-empty bucket — exactly what fills a not-yet-converged
   * progressive render — gets blown out into a bright speckle. Has no effect
   * when `gamma` is 1 (see {@link DEFAULT_GAMMA_THRESHOLD}).
   */
  gammaThreshold: number;
  /**
   * How much of the final color comes from the density-scaled accumulated
   * hue (1) vs. a flat `gamma`-only curve on the raw averaged color that
   * ignores density entirely (0); fractional values blend the two. 1 is the
   * collapse point — today's color exactly, scaled purely by density.
   */
  vibrancy: number;
}

/**
 * Render a {@link FlameHistogram} to an RGBA image (row-major, top row
 * first, matching `ImageData`/canvas conventions): brightness is the
 * log-density of hits, so a bucket with a single hit stays faintly visible
 * instead of vanishing while the hottest bucket anchors the top of the
 * curve — the classic flame tone-map that keeps both a blazing core and
 * wispy, sparsely-visited tendrils legible in one image. `gamma` reshapes
 * that curve and `vibrancy` blends the density-scaled color against a flat
 * gamma-only one (see {@link TonemapParams}). Buckets with no hits are fully
 * transparent black, so the image composites cleanly over any backdrop.
 *
 * At `gamma: 1, vibrancy: 1` this is byte-for-byte the fr-o7s tone-map (see
 * "collapses to the pre-fr-ucs tonemap" in flame.test.ts) — every term the
 * new controls introduce provably reduces to a no-op at that point (`x ** 1
 * === x`, `0 * anything-finite === 0`, `1 * x === x`), so existing renders
 * and every fr-o7s-era test stay pixel-identical without needing a
 * gamma/vibrancy-aware special case.
 *
 * Pure, and does one pass over `width * height` (independent of how many
 * iterations are behind the histogram) — safe to call every frame while a
 * render converges.
 */
export function tonemapFlame(
  histogram: FlameHistogram,
  params: TonemapParams,
): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, hits, sumRGB, maxHits } = histogram;
  const out = new Uint8ClampedArray(width * height * 4);
  if (maxHits <= 0) return out; // Nothing accumulated yet — fully transparent.

  const { exposure, gamma, gammaThreshold, vibrancy } = params;
  const invGamma = 1 / gamma;
  const flatness = 1 - vibrancy;
  // Slope of `x ** invGamma` at x = gammaThreshold: self-division, so this is
  // exactly 1 at gamma = 1 regardless of gammaThreshold, which is what keeps
  // the linear branch below agreeing with the power branch at the collapse
  // point (see the doc comment above).
  const thresholdSlope =
    gammaThreshold > 0 ? gammaThreshold ** invGamma / gammaThreshold : 1;
  // log1p(hits), not log(hits): finite (and 0) at hits = 0 or 1, so a bucket
  // with a single hit lands near the bottom of the curve instead of at
  // -Infinity or needing a discontinuous special case.
  const logMax = Math.log1p(maxHits);

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (h <= 0) continue;
    const density = Math.log1p(h) / logMax;
    // Gamma-reshape the log-density curve; linear below gammaThreshold so a
    // lone hit's infinite-slope singularity at density = 0 never blows out
    // into a bright speckle (see TonemapParams.gammaThreshold). density is
    // always >= 0, so when gammaThreshold <= 0 this always takes the power
    // branch — the linear branch is only ever reached for a positive
    // threshold, exactly as intended.
    const alpha =
      density >= gammaThreshold
        ? density ** invGamma
        : density * thresholdSlope;
    // glow bundles exposure into the density term the same way the pre-fr-ucs
    // formula's `brightness` did (`density * exposure`) — precomputing it
    // this way, rather than multiplying exposure in afterward, is what makes
    // the vivid branch below reduce to the exact pre-fr-ucs expression at
    // gamma = 1 (see the doc comment above), not just a numerically close one.
    const glow = alpha * exposure;
    const invHits = 1 / h;
    const o = i * 3;
    const oi = i * 4;

    // avg is always >= 0 in practice (palette colors are sRGB in [0, 1] — see
    // hslToRgb — so sumRGB only ever accumulates non-negative values); the
    // clamp is a defensive guard so a negative/garbage channel can never
    // reach `** invGamma` and produce a silently-clamped-to-black NaN instead
    // of a loud failure.
    const r = Math.max(0, sumRGB[o] * invHits);
    const g = Math.max(0, sumRGB[o + 1] * invHits);
    const b = Math.max(0, sumRGB[o + 2] * invHits);

    // vivid: the density-scaled accumulated color (today's look). flat: a
    // gamma-only curve on the raw averaged color, ignoring density — the
    // desaturated-toward-white-in-dense-areas alternative vibrancy blends
    // against. At vibrancy = 1, `flatness` is exactly 0 and `flat`'s own
    // value (always finite) is multiplied away without affecting the result.
    // Uint8ClampedArray rounds and clamps to [0, 255] on assignment, so an
    // over-exposed (>1) or negative channel never needs a manual clamp.
    out[oi] =
      (vibrancy * (r * glow) + flatness * r ** invGamma * exposure) * 255;
    out[oi + 1] =
      (vibrancy * (g * glow) + flatness * g ** invGamma * exposure) * 255;
    out[oi + 2] =
      (vibrancy * (b * glow) + flatness * b ** invGamma * exposure) * 255;
    out[oi + 3] = 255;
  }
  return out;
}

/** Floor for the downsample kernel's sigma, in output pixels — keeps the
 * Gaussian's denominator away from zero for a `filterRadius` of 0 (or
 * smaller), giving a narrow-but-well-defined kernel instead of a divide. */
const MIN_FILTER_SIGMA = 1e-3;

/**
 * Combine an oversampled {@link FlameHistogram} into a `outWidth x
 * outHeight` one: the linear-domain supersample downfilter that MUST run
 * before {@link tonemapFlame} — see that function's doc for why filtering
 * has to happen on raw `hits`/`sumRGB`, not on the tone-mapped image
 * (averaging Monte-Carlo sample counts is only statistically meaningful
 * before the nonlinear log/gamma compression).
 *
 * Every output cell pools the oversampled cells within `filterRadius`
 * *output* pixels of its center, weighted by a Gaussian, as independent
 * weighted SUMS — `hits` and `sumRGB` are pooled separately and each divided
 * by the same per-cell weight total once at the end. This never pre-averages
 * a source cell's color before pooling (dividing by *its own* hit count),
 * which would mis-weight a sparse-but-bright source cell against a
 * dense-but-dim one; `tonemapFlame`'s own `sumRGB / hits` divide happens
 * downstream, unchanged, on these pooled totals.
 *
 * The kernel is precomputed once per call (not per output cell — every
 * output cell uses the identical weight-by-offset shape, just recentered),
 * so the hot part of this function is plain multiply-adds over a small
 * typed-array kernel, not a `Math.exp` call per source cell. Cells beyond
 * the histogram's edge are simply skipped and the surviving weights
 * renormalized (dividing by *their own* sum, not the theoretical full-kernel
 * sum), so a bucket near the border isn't darkened for lack of neighbors.
 *
 * `filterRadius` is FIXED for every output cell — a plain reconstruction /
 * antialiasing filter, not density-adaptive. fr-17t generalizes this to a
 * per-cell radius driven by local density (flam3's "density estimation");
 * when it lands it will very likely replace this function's fixed radius
 * with a computed one rather than sit beside it, since the two differ only
 * in how the radius is chosen.
 *
 * `oversized`'s dimensions must be an exact positive-integer multiple of
 * `outWidth` / `outHeight` in each axis (the app always accumulates at
 * `outWidth * supersample` x `outHeight * supersample` for exactly this
 * reason). Throws `RangeError` otherwise.
 */
export function downsampleFlame(
  oversized: FlameHistogram,
  outWidth: number,
  outHeight: number,
  filterRadius: number,
): FlameHistogram {
  const {
    width: srcWidth,
    height: srcHeight,
    hits: srcHits,
    sumRGB: srcRGB,
  } = oversized;
  if (
    outWidth <= 0 ||
    outHeight <= 0 ||
    srcWidth % outWidth !== 0 ||
    srcHeight % outHeight !== 0
  ) {
    throw new RangeError(
      `downsampleFlame: source ${srcWidth}x${srcHeight} is not a positive-integer multiple of target ${outWidth}x${outHeight}`,
    );
  }
  const scaleX = srcWidth / outWidth;
  const scaleY = srcHeight / outHeight;
  const out = createFlameHistogram(outWidth, outHeight);
  const { hits: dstHits, sumRGB: dstRGB } = out;

  // An output cell's footprint center sits at a CONSTANT fractional offset
  // from its nearest source-cell grid line, the same for every output cell
  // on that axis (e.g. exactly half a source cell for an even supersample
  // factor, exactly on a source cell for an odd one — the surrounding
  // "+0.5 ... -0.5" cancels to a whole number for every cell but the
  // leftover phase term). Baking that phase into the precomputed kernel
  // (rather than rounding each cell's center to its nearest source cell)
  // keeps every output cell exactly correctly weighted, not just
  // approximately so.
  const phaseX = 0.5 * (scaleX - 1);
  const phaseY = 0.5 * (scaleY - 1);
  const sigmaX = Math.max(filterRadius, MIN_FILTER_SIGMA) * scaleX;
  const sigmaY = Math.max(filterRadius, MIN_FILTER_SIGMA) * scaleY;
  const radiusX = Math.max(1, Math.ceil(sigmaX * 3));
  const radiusY = Math.max(1, Math.ceil(sigmaY * 3));

  const kernelX = new Float64Array(2 * radiusX + 1);
  for (let k = -radiusX; k <= radiusX; k++) {
    const d = k - phaseX;
    kernelX[k + radiusX] = Math.exp(-(d * d) / (2 * sigmaX * sigmaX));
  }
  const kernelY = new Float64Array(2 * radiusY + 1);
  for (let k = -radiusY; k <= radiusY; k++) {
    const d = k - phaseY;
    kernelY[k + radiusY] = Math.exp(-(d * d) / (2 * sigmaY * sigmaY));
  }

  let maxHits = 0;
  for (let oy = 0; oy < outHeight; oy++) {
    const baseY = oy * scaleY; // exact integer: the output cell's home row.
    for (let ox = 0; ox < outWidth; ox++) {
      const baseX = ox * scaleX; // exact integer: the output cell's home column.

      let weightSum = 0;
      let hitSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      for (let j = -radiusY; j <= radiusY; j++) {
        const sy = baseY + j;
        if (sy < 0 || sy >= srcHeight) continue;
        const wy = kernelY[j + radiusY];
        const rowBase = sy * srcWidth;
        for (let i = -radiusX; i <= radiusX; i++) {
          const sx = baseX + i;
          if (sx < 0 || sx >= srcWidth) continue;
          const weight = wy * kernelX[i + radiusX];
          const bucket = rowBase + sx;
          weightSum += weight;
          hitSum += weight * srcHits[bucket];
          const so = bucket * 3;
          rSum += weight * srcRGB[so];
          gSum += weight * srcRGB[so + 1];
          bSum += weight * srcRGB[so + 2];
        }
      }

      // weightSum is always > 0 in practice (the center tap, j = i = 0, is
      // always in-bounds since baseX/baseY are themselves in-bounds source
      // coordinates) — guarded anyway as a safety net, matching this
      // codebase's habit of guarding "essentially impossible" cases rather
      // than assuming them away.
      if (weightSum > 0) {
        const norm = 1 / weightSum;
        const hVal = hitSum * norm;
        const dstBucket = oy * outWidth + ox;
        dstHits[dstBucket] = hVal;
        const dOff = dstBucket * 3;
        dstRGB[dOff] = rSum * norm;
        dstRGB[dOff + 1] = gSum * norm;
        dstRGB[dOff + 2] = bSum * norm;
        if (hVal > maxHits) maxHits = hVal;
      }
    }
  }

  out.maxHits = maxHits;
  // The oversized accumulator is the real progressive state (see
  // FlameHistogram.orbit) — this filtered view is a display-only derivative
  // that must never be fed back into accumulateFlame, so its own orbit is
  // meaningless; leave it at createFlameHistogram's zero default rather than
  // copying a value nothing should ever read.
  return out;
}
