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
import { colorSpan, writePointColor } from "./color";
import type { ColorSpan } from "./color";
import type { Rng } from "./rng";
import type { Bounds, ColorMode, Vec3 } from "./types";

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
  /**
   * The orbit's color coordinate (flam3 semantics): a value in `[0, 1]` that
   * blends toward the picked transform's slot each step, indexing a smooth
   * gradient palette when {@link accumulateFlame} is given a `colorLUT`. Kept
   * on the histogram — alongside {@link orbit} — so a chunked render resumes
   * the exact same color walk; only read/written on the `colorLUT` path (it
   * stays at its `0.5` default in the per-transform `"legacy"` mode). NOT
   * folded into `orbit` because it is not a spatial coordinate.
   */
  orbitColor: number;
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
    orbitColor: 0.5,
  };
}

/**
 * Largest integer supersample factor `<= requested` (and always `>= 1`)
 * whose accumulation buckets — `(width * ss) * (height * ss)` — fit within
 * `maxBuckets`. `width`/`height` are the DISPLAY resolution (already
 * whatever the device's pixel ratio made it — see the app layer's
 * `flameRenderSize`), so supersample multiplies an already-device-scaled
 * size; on a hi-DPI display this can demand a single, huge `Float64Array`
 * allocation before the user-chosen supersample factor even applies. This
 * caps that proactively — a fixed byte budget divided among what
 * `createFlameHistogram` actually allocates (`hits` + `sumRGB`, both
 * `Float64`) turns into a bucket-count ceiling the caller passes in.
 *
 * A tiny loop, not a closed-form `sqrt`, because `requested` is always a
 * small integer (a handful at most) in practice — clearer to read as "try
 * each size down from what was asked" than to reason about rounding at a
 * `Math.sqrt` boundary.
 */
export function clampSupersampleToBudget(
  width: number,
  height: number,
  requested: number,
  maxBuckets: number,
): number {
  const start = Math.max(1, Math.floor(requested));
  if (width <= 0 || height <= 0) return start;
  for (let ss = start; ss > 1; ss--) {
    if (width * ss * (height * ss) <= maxBuckets) return ss;
  }
  return 1;
}

/** Color for a transform index outside `palette` — shouldn't happen; mirrors `buildColors`' fallback. */
const FALLBACK_COLOR: Vec3 = [1, 1, 1];

/**
 * Scratch RGB for the non-transform color modes: `writePointColor` writes a
 * point's color here and the hot loop adds it into `sumRGB`. Reused across
 * iterations (and calls — `accumulateFlame` runs to completion synchronously,
 * never re-entrant) so a per-point color costs no allocation, matching the
 * hand-inlined loop's allocation-free discipline.
 */
const modeColorScratch = new Float32Array(3);

/**
 * Defensive fallback for a non-transform `colorMode` called without `bounds`
 * (the app always supplies the frozen cloud's bounds — see `main.ts`). Its
 * zero extents make every `colorSpan` range collapse to 1, so coloring stays
 * finite and deterministic instead of dividing by an absent span.
 */
const EMPTY_BOUNDS: Bounds = {
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
  minZ: 0,
  maxZ: 0,
  minR: 0,
  maxR: 0,
};

/**
 * Accumulate `iterations` more chaos-game steps into a 2D histogram, seen
 * through a frozen camera. Each plotted point (`stepOrbit` + `plotPoint`,
 * exactly as the point-cloud path computes them) is projected by `projection`
 * (clip space, perspective-divided to NDC) and, if it lands in front of the
 * camera and inside the `width` x `height` frame, increments that pixel's
 * hit count and adds a color to its color sum.
 *
 * **Coloring** follows `colorMode` (default `"transform"`), mirroring the
 * explorer's `buildColors` so a render matches the frozen point cloud it was
 * launched from (fr-6do):
 *
 * - `"transform"` — the transform-index coloring (fr-6us). By default the
 *   added color is `palette[transformIndex]` — the flat per-transform hue
 *   ("legacy"). Pass a `colorLUT` (a `256 * 3` interleaved RGB table from
 *   `palette.ts`'s `buildPaletteLUT`) to switch to flam3-style structural
 *   coloring instead: a color coordinate `c` in `[0, 1]` rides along the orbit
 *   — initialised to `0.5` and, each step, blended halfway toward the picked
 *   transform's slot (`c = (c + i / (n - 1)) / 2`, or `0.5` for a
 *   single-transform system) — and the LUT color at `c` is accumulated, so
 *   color flows continuously along the structure. An escape-reseed resets `c`
 *   to `0.5` alongside the point. `colorLUT` is ignored in every other mode.
 * - `"height"` / `"radius"` / `"position"` / `"uniform"` — the plotted point's
 *   color comes from `color.ts`'s shared `writePointColor` (the exact ramps
 *   `buildColors` uses), normalized against `bounds` — pass the same
 *   {@link Bounds} the explorer's cloud produced so the flame reproduces its
 *   colors. `palette`/`colorLUT` are unused here.
 *
 * `palette` is always required (and used for `"transform"` + no `colorLUT`).
 * Coloring never consumes `rng`, so a given seed produces the byte-identical
 * *orbit* (and thus identical `hits`) regardless of `colorMode`/`colorLUT`;
 * only the color sums differ.
 *
 * **Progressive**: pass the histogram returned by a previous call back in as
 * `histogram` to keep converging the same image — the orbit (and its color
 * coordinate) resumes from exactly where it left off (see
 * {@link FlameHistogram.orbit} / {@link FlameHistogram.orbitColor}), so
 * splitting a run into chunks (e.g. one per animation frame) produces the
 * identical result as running all the iterations at once, given the same `rng`
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
  colorLUT?: Float32Array,
  colorMode: ColorMode = "transform",
  bounds?: Bounds,
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

  // Coloring dispatch, hoisted out of the hot loop (fr-6do). `modeColoring` is
  // the position-based path (height/radius/position/uniform), colored per point
  // by the same `writePointColor` the explorer's cloud uses, normalized against
  // `span`. Otherwise we are in the transform path: `structural` picks the
  // fr-6us colorLUT gradient (a color coordinate `c` riding the orbit), and
  // failing that the flat per-transform `palette`. `colorDenom` is `n - 1` (0
  // for a single-transform system, which pins the coordinate at 0.5) — the
  // divisor mapping a transform index to its [0, 1] color slot.
  const modeColoring = colorMode !== "transform";
  const structural = !modeColoring && colorLUT !== undefined;
  const span: ColorSpan | null = modeColoring
    ? colorSpan(bounds ?? EMPTY_BOUNDS)
    : null;
  const colorDenom =
    prepared.transformCount > 1 ? prepared.transformCount - 1 : 0;
  let c = hist.orbitColor;

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
    // Blend the color coordinate halfway toward this transform's slot. No rng
    // is consumed, so the orbit (and `hits`) stays identical to every other path.
    if (structural) {
      const slot = colorDenom > 0 ? idx / colorDenom : 0.5;
      c = (c + slot) * 0.5;
    }
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
      // The orbit restarts, so its color coordinate does too.
      if (structural) c = 0.5;
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
    const o = bucket * 3;
    if (modeColoring) {
      // Position-based mode: color this plotted point exactly as the explorer's
      // cloud would (span is non-null whenever modeColoring is true).
      writePointColor(modeColorScratch, 0, colorMode, px, py, pz, span!);
      sumRGB[o] += modeColorScratch[0];
      sumRGB[o + 1] += modeColorScratch[1];
      sumRGB[o + 2] += modeColorScratch[2];
    } else if (colorLUT !== undefined) {
      // Structural gradient: c is in [0, 1]; the min guards the c === 1 edge
      // (256 -> 255). (`else if` here is exactly `structural` — modeColoring
      // was handled above — but written as the narrowing check so colorLUT is
      // typed non-undefined without an assertion.)
      const li = Math.min(255, (c * 256) | 0) * 3;
      sumRGB[o] += colorLUT[li];
      sumRGB[o + 1] += colorLUT[li + 1];
      sumRGB[o + 2] += colorLUT[li + 2];
    } else {
      const rgb = palette[idx] ?? FALLBACK_COLOR;
      sumRGB[o] += rgb[0];
      sumRGB[o + 1] += rgb[1];
      sumRGB[o + 2] += rgb[2];
    }
  }

  hist.orbit = [x, y, z];
  hist.orbitColor = c;
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
   * line through the origin whose value matches `density ** (1/gamma)`
   * exactly at the threshold (continuous — no jump), though not its slope
   * there (a faint kink, not a discontinuity). `density ** (1/gamma)` has
   * infinite slope at density = 0 whenever gamma > 1, so without even that
   * much, a single stray hit in an otherwise-empty bucket — exactly what
   * fills a not-yet-converged progressive render — gets blown out into a
   * bright speckle. Has no effect when `gamma` is 1 (see
   * {@link DEFAULT_GAMMA_THRESHOLD}).
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
  // Slope of the line from the origin through (gammaThreshold, gammaThreshold
  // ** invGamma) — a chord, not the power curve's own tangent slope at that
  // point, which is what leaves a faint kink there (see the doc comment
  // above). Self-division makes this exactly 1 at gamma = 1 regardless of
  // gammaThreshold, which is what keeps the linear branch below agreeing
  // with the power branch at the collapse point.
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
 * antialiasing filter, not density-adaptive. {@link adaptiveDownsampleFlame}
 * (fr-17t) generalizes this to a per-cell radius driven by local density
 * (flam3's "density estimation") — the two functions COEXIST rather than one
 * replacing the other: this one stays cheap for progressive-preview frames
 * (no per-cell radius/kernel-cache work), while the adaptive one is reserved
 * for a finished/paused render, where its O(width * height * radius^2) cost
 * only has to be paid once. See that function's doc for the full reasoning.
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

/**
 * Controls for {@link adaptiveDownsampleFlame}'s per-cell blur radius —
 * flam3's "density estimation" parameters.
 */
export interface DensityEstimatorParams {
  /** Blur radius (output pixels) for a cell with ~zero local density — the
   * widest the kernel ever gets, filling gaps in sparse/noisy regions. */
  estimatorRadius: number;
  /** Blur radius (output pixels) for a cell at full local density; 0 leaves
   * fully-sampled regions pin-sharp. Clamped to `estimatorRadius` if given a
   * larger value, so "minimum" can never exceed "maximum". */
  estimatorMinimumRadius: number;
  /** Shapes how quickly the radius narrows as density rises from 0 to 1 (see
   * {@link adaptiveDownsampleFlame}'s doc for the exact curve). Below 1,
   * radius stays close to `estimatorRadius` until density is nearly maxed
   * out, then narrows sharply; above 1, it narrows quickly even at modest
   * density and stays close to `estimatorMinimumRadius` the rest of the way.
   * flam3-ish values sit around 0.3-0.6. */
  estimatorCurve: number;
}

/** Steps (in output pixels) between distinct precomputed kernel radii in
 * {@link adaptiveDownsampleFlame} — see its doc for why radii are quantized
 * into a small cache instead of every cell building its own kernel. */
const RADIUS_QUANTUM = 0.5;

/**
 * Floor for {@link adaptiveDownsampleFlame}'s kernel sigma — DELIBERATELY
 * much larger than `downsampleFlame`'s `MIN_FILTER_SIGMA`, and not shared
 * with it, for a real reason, not just belt-and-suspenders:
 * `estimatorMinimumRadius: 0` ("pin-sharp at full density") is an expected,
 * commonly-used setting here, unlike `downsampleFlame`'s `filterRadius`,
 * which is always a fixed non-zero constant in practice (0 only ever occurs
 * in that function's own pass-through unit test).
 *
 * A radius that rounds to (quantizes to) 0 combined with an EVEN supersample
 * factor (phase = 0.5, exactly between two source cells — see the phase
 * comment below) is exactly the failure mode this guards: at
 * `downsampleFlame`'s tiny `1e-3` floor, the Gaussian's weight at the
 * nearest actual grid offset (0.5 cells away, since nothing sits exactly on
 * the phase-shifted peak) underflows to precisely 0.0 in double precision —
 * `weightSum` for that output cell is then also exactly 0, and the
 * `weightSum > 0` guard silently skips writing it, leaving a BLACK HOLE at
 * exactly the densest, most important part of the image (density 1 is what
 * maps to `estimatorMinimumRadius` in the first place). 0.3 keeps the
 * weight at a half-cell offset comfortably away from underflow (`exp(-0.25 /
 * (2 * (0.3 * 2) ** 2))` ~= 0.7, not ~0) while still being narrow enough
 * that "pin-sharp" reads as sharp — this only changes anything for a radius
 * that would otherwise have quantized below 0.3; any real, non-degenerate
 * radius is unaffected (`Math.max(radius, 0.3)` is a no-op once radius
 * clears that bar).
 */
const MIN_ADAPTIVE_FILTER_SIGMA = 0.3;

/**
 * Per-cell-adaptive generalization of {@link downsampleFlame}: instead of one
 * FIXED radius for every output cell, each cell's radius is driven by its
 * OWN local sample density — sparse, noisy regions blur wide (filling gaps,
 * smoothing wispy structure into something legible); dense, well-sampled
 * regions stay pin-sharp. This is flam3's "density estimation," the classic
 * fractal-flame algorithm's signature denoising step, and the reason a
 * converging render visibly sharpens as it accumulates instead of just
 * getting less grainy in place.
 *
 * Same slot in the pipeline as `downsampleFlame` (the linear accumulation
 * domain, before {@link tonemapFlame} — see that function's doc for why),
 * the same weighted-SUM pooling / edge-renormalization discipline, and the
 * same phase-correct kernel centering. The two functions do not layer (this
 * does not run `downsampleFlame` first) — for whichever frame calls it, this
 * replaces it outright, since both do the exact same "combine an oversampled
 * neighborhood into one output cell" job and differ only in how each cell's
 * radius is chosen; see `downsampleFlame`'s own doc for why they coexist as
 * two functions rather than one merging both jobs.
 *
 * ALGORITHM, per output cell:
 * 1. Estimate local density from the cell's own "home block" — the same
 *    `scaleX x scaleY` source-cell footprint `downsampleFlame` treats as one
 *    output cell's 1:1 region — not a single source cell, which on its own
 *    is far too noisy (Monte-Carlo shot noise) to drive a stable radius
 *    choice; summing a small neighborhood first is what flam3 does too.
 * 2. Normalize that count against the histogram's peak (`log1p`, the same
 *    density concept {@link tonemapFlame} already uses, so "well-sampled"
 *    here lines up with "bright" there) and map it to a radius: `1` maps to
 *    `estimatorMinimumRadius`, `0` to `estimatorRadius`, interpolated by
 *    `estimatorCurve` — `estimatorMinimumRadius + (estimatorRadius -
 *    estimatorMinimumRadius) * (1 - density) ** estimatorCurve`.
 * 3. Gather a Gaussian kernel of THAT radius. Building one with `Math.exp`
 *    fresh for every one of `width * height` cells would dominate the cost,
 *    so radii are quantized to the nearest {@link RADIUS_QUANTUM} output
 *    pixels and cached — a real render needs at most a few dozen distinct
 *    radius classes regardless of image size, turning "exp per cell" into
 *    "array lookup per cell, exp per class".
 *
 * Deliberately NOT separable (two 1-D passes): a spatially-varying-width
 * Gaussian isn't exactly separable in the first place (a true two-pass
 * filter assumes the same width at every intermediate position), and the
 * usual "approximate it anyway, same per-cell radius both passes" shortcut
 * trades accuracy for a speed-up this function doesn't need — unlike
 * `downsampleFlame`, this runs once per finished/paused render, not on every
 * progressive frame, so the exact non-separable 2-D gather (reusing
 * `downsampleFlame`'s own proven loop shape) is worth its extra cost here.
 *
 * COST: still O(width * height * radius^2) in the worst case (a maximally
 * sparse image, every cell requesting the widest kernel) — expensive enough
 * that it belongs on a finished/paused render, not every progressive frame;
 * see the worker's `runChunk` for how the two functions divide that work.
 *
 * `oversized`'s dimensions must be an exact positive-integer multiple of
 * `outWidth` / `outHeight`, exactly like `downsampleFlame`. Throws
 * `RangeError` otherwise.
 */
export function adaptiveDownsampleFlame(
  oversized: FlameHistogram,
  outWidth: number,
  outHeight: number,
  params: DensityEstimatorParams,
): FlameHistogram {
  const {
    width: srcWidth,
    height: srcHeight,
    hits: srcHits,
    sumRGB: srcRGB,
    maxHits: srcMaxHits,
  } = oversized;
  if (
    outWidth <= 0 ||
    outHeight <= 0 ||
    srcWidth % outWidth !== 0 ||
    srcHeight % outHeight !== 0
  ) {
    throw new RangeError(
      `adaptiveDownsampleFlame: source ${srcWidth}x${srcHeight} is not a positive-integer multiple of target ${outWidth}x${outHeight}`,
    );
  }
  const scaleX = srcWidth / outWidth;
  const scaleY = srcHeight / outHeight;
  const out = createFlameHistogram(outWidth, outHeight);
  const { hits: dstHits, sumRGB: dstRGB } = out;

  const estimatorRadius = Math.max(0, params.estimatorRadius);
  // Never let "minimum" exceed "maximum", regardless of how the caller's
  // sliders happen to be set relative to each other.
  const estimatorMinimumRadius = Math.min(
    estimatorRadius,
    Math.max(0, params.estimatorMinimumRadius),
  );
  const estimatorCurve = params.estimatorCurve;
  // log1p(0) is 0, so a histogram with no hits anywhere (srcMaxHits <= 0)
  // falls out naturally: every cell's normalizedDensity below is 0 / 0 ->
  // guarded to 0 -> every cell gets the widest (estimatorRadius) kernel,
  // same as downsampleFlame would with nothing to distinguish cells by.
  const logMax = srcMaxHits > 0 ? Math.log1p(srcMaxHits) : 0;

  // The same constant per-axis phase downsampleFlame relies on (see its
  // doc) — every output cell's footprint center sits at this fixed
  // fractional offset from its nearest source-cell grid line, regardless of
  // which cell, so it can be baked into every cached kernel below once.
  const phaseX = 0.5 * (scaleX - 1);
  const phaseY = 0.5 * (scaleY - 1);

  const kernelCache = new Map<
    number,
    {
      kernelX: Float64Array;
      kernelY: Float64Array;
      radiusX: number;
      radiusY: number;
    }
  >();
  function kernelFor(radius: number): {
    kernelX: Float64Array;
    kernelY: Float64Array;
    radiusX: number;
    radiusY: number;
  } {
    const quantized = Math.round(radius / RADIUS_QUANTUM) * RADIUS_QUANTUM;
    const cached = kernelCache.get(quantized);
    if (cached) return cached;
    const sigmaX = Math.max(quantized, MIN_ADAPTIVE_FILTER_SIGMA) * scaleX;
    const sigmaY = Math.max(quantized, MIN_ADAPTIVE_FILTER_SIGMA) * scaleY;
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
    const built = { kernelX, kernelY, radiusX, radiusY };
    kernelCache.set(quantized, built);
    return built;
  }

  let maxHits = 0;
  for (let oy = 0; oy < outHeight; oy++) {
    const baseY = oy * scaleY; // exact integer: the output cell's home row.
    for (let ox = 0; ox < outWidth; ox++) {
      const baseX = ox * scaleX; // exact integer: the output cell's home column.

      // Step 1: local density from this cell's home block, not a single
      // (noisy) source cell.
      let localCount = 0;
      for (let j = 0; j < scaleY; j++) {
        const rowBase = (baseY + j) * srcWidth;
        for (let i = 0; i < scaleX; i++) {
          localCount += srcHits[rowBase + baseX + i];
        }
      }
      // A home block's summed count can exceed the single-cell srcMaxHits,
      // so this is clamped to 1 rather than trusted to land there naturally.
      const normalizedDensity =
        logMax > 0 ? Math.min(1, Math.log1p(localCount) / logMax) : 0;

      // Step 2: map density to a radius.
      const radius =
        estimatorMinimumRadius +
        (estimatorRadius - estimatorMinimumRadius) *
          (1 - normalizedDensity) ** estimatorCurve;

      // Step 3: gather the (cached-by-quantized-radius) kernel.
      const { kernelX, kernelY, radiusX, radiusY } = kernelFor(radius);

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
      // coordinates) — guarded anyway, matching downsampleFlame and this
      // codebase's general habit of guarding "essentially impossible" cases.
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
  // Same non-answer as downsampleFlame's — see its doc — this is a
  // display-only derivative, never fed back into accumulateFlame.
  return out;
}
