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
  /**
   * The 4D orbit's fourth-coordinate continuation (fr-5b3) — `flame-4d.ts`'s
   * `accumulateFlame4` twin of {@link orbit}'s `x`/`y`/`z`, kept here (rather
   * than a fourth slot on `orbit` itself) so `orbit` stays exactly the `Vec3`
   * every 3D caller already expects. Used ONLY by `accumulateFlame4`; stays at
   * its `0` default on the 3D path (`accumulateFlame` never reads or writes
   * it), so nothing here changes for any existing caller.
   */
  orbitW: number;
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
    orbitW: 0,
  };
}

/**
 * Wrap externally-owned bucket arrays as a {@link FlameHistogram} — the
 * shared-memory counterpart to {@link createFlameHistogram}. Exists for the
 * flame worker's SharedArrayBuffer transport (fr-96i), where `hits`/`sumRGB`
 * are views over memory shared between the worker (which downsamples into
 * them) and the main thread (which tone-maps straight out of them): both
 * sides need the same wrapper, and neither should have to know that `orbit`/
 * `orbitColor` are meaningless filler on a display-only histogram (see
 * `downsampleFlame`'s closing comment for why).
 */
export function viewFlameHistogram(
  width: number,
  height: number,
  hits: Float64Array,
  sumRGB: Float64Array,
  maxHits: number,
): FlameHistogram {
  return {
    width,
    height,
    hits,
    sumRGB,
    maxHits,
    orbit: [0, 0, 0],
    orbitColor: 0.5,
    orbitW: 0,
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
 * Accumulate `iterations` more chaos-game steps into a 2D histogram, seen
 * through a frozen camera. Each plotted point (`stepOrbit` + `plotPoint`,
 * exactly as the point-cloud path computes them) is projected by `projection`
 * (clip space, perspective-divided to NDC) and, if it lands in front of the
 * camera and inside the `width` x `height` frame, increments that pixel's
 * hit count and adds a color to its color sum.
 *
 * **Coloring** has two modes (fr-6us). By default the added color is
 * `palette[transformIndex]` — the flat per-transform hue ("legacy"). Pass a
 * `colorLUT` (a `256 * 3` interleaved RGB table from `palette.ts`'s
 * `buildPaletteLUT`) to switch to flam3-style structural coloring instead: a
 * color coordinate `c` in `[0, 1]` rides along the orbit — initialised to
 * `0.5` and, each step, blended halfway toward the picked transform's slot
 * (`c = (c + i / (n - 1)) / 2`, or `0.5` for a single-transform system) — and
 * the LUT color at `c` is accumulated, so color flows continuously along the
 * structure. Updating `c` consumes NO `rng`, so a given seed produces the
 * byte-identical *orbit* (and thus identical `hits`) whether or not a
 * `colorLUT` is supplied; only the color sums differ. An escape-reseed resets
 * `c` to `0.5` alongside the point. `palette` is still required (and used when
 * `colorLUT` is omitted).
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
 * **Symmetry** (fr-6im): when `prepared` was built with rotated copies (see
 * `chaos-game.ts`'s `prepareChaosGame`), this hand-inlined loop mirrors
 * `stepOrbit`'s handling exactly — the picked slot's rotation bends the
 * orbit-feedback point, and `palette`/the colorLUT slot both key on the
 * BASE map a slot is a copy of, never the expanded slot — so a converged
 * flame render shows the same kaleidoscope as the live point cloud.
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

  const { affines, variations, postRotations, finalAffine, finalWarp } =
    prepared;
  const { baseTransformCount } = prepared;
  const { hits, sumRGB } = hist;
  let maxHits = hist.maxHits;

  // Structural coloring (fr-6us): when a colorLUT is supplied, `c` rides the
  // orbit and indexes the gradient; otherwise every `colorLUT !== undefined`
  // branch below is skipped and the per-transform `palette` path runs
  // unchanged. `colorDenom` is `n - 1` (0 for a single-transform system, which
  // pins the coordinate at 0.5) — the divisor mapping a transform index to its
  // [0, 1] color slot. Keyed on `baseTransformCount`, not `transformCount`
  // (fr-6im): with symmetry, every rotated copy of a base map shares that
  // map's slot, so the gradient repeats around the kaleidoscope instead of
  // smearing continuously across copies that are geometrically the same map.
  const colorDenom = baseTransformCount > 1 ? baseTransformCount - 1 : 0;
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
    // The BASE map this slot is a (possibly rotated) copy of (fr-6im) — see
    // PreparedChaosGame.baseTransformCount. Equal to `idx` at symmetry order
    // 1. Anything keyed to "which logical map" (the color slot below, and the
    // legacy `palette` lookup at the bottom of the loop) uses this, never the
    // raw expanded `idx`.
    const baseIdx = idx % baseTransformCount;
    // Blend the color coordinate halfway toward this transform's slot. No rng
    // is consumed, so the orbit (and `hits`) stays identical to the legacy path.
    if (colorLUT !== undefined) {
      const slot = colorDenom > 0 ? baseIdx / colorDenom : 0.5;
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
      // The orbit restarts, so its color coordinate does too.
      if (colorLUT !== undefined) c = 0.5;
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
    if (colorLUT !== undefined) {
      // c is in [0, 1]; the min guards the c === 1 edge (256 -> 255).
      const li = Math.min(255, (c * 256) | 0) * 3;
      sumRGB[o] += colorLUT[li];
      sumRGB[o + 1] += colorLUT[li + 1];
      sumRGB[o + 2] += colorLUT[li + 2];
    } else {
      const rgb = palette[baseIdx] ?? FALLBACK_COLOR;
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
 *
 * Pass `out` (dimensions must be exactly `outWidth` x `outHeight`; throws
 * `RangeError` otherwise) to write the result into an existing histogram
 * instead of allocating a fresh one — every bucket is fully overwritten, so
 * a dirty `out` is fine. This is what lets the flame worker reuse one
 * display-resolution histogram across progressive redisplays (instead of
 * churning a multi-megabyte allocation per tick) and, in shared-memory mode
 * (fr-96i), downsample straight into SharedArrayBuffer-backed buckets the
 * main thread tone-maps from with no copy in between.
 */
export function downsampleFlame(
  oversized: FlameHistogram,
  outWidth: number,
  outHeight: number,
  filterRadius: number,
  out?: FlameHistogram,
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
  if (out && (out.width !== outWidth || out.height !== outHeight)) {
    throw new RangeError(
      `downsampleFlame: out histogram is ${out.width}x${out.height}, but ${outWidth}x${outHeight} was requested`,
    );
  }
  const scaleX = srcWidth / outWidth;
  const scaleY = srcHeight / outHeight;
  const target = out ?? createFlameHistogram(outWidth, outHeight);
  const { hits: dstHits, sumRGB: dstRGB } = target;

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
      const dstBucket = oy * outWidth + ox;
      const dOff = dstBucket * 3;
      if (weightSum > 0) {
        const norm = 1 / weightSum;
        const hVal = hitSum * norm;
        dstHits[dstBucket] = hVal;
        dstRGB[dOff] = rSum * norm;
        dstRGB[dOff + 1] = gSum * norm;
        dstRGB[dOff + 2] = bSum * norm;
        if (hVal > maxHits) maxHits = hVal;
      } else {
        // A skipped cell must still be WRITTEN now that `out` can be a reused
        // (dirty) histogram — a fresh allocation showed 0 here for free, and
        // reuse must be indistinguishable from that, not leak a stale bucket.
        dstHits[dstBucket] = 0;
        dstRGB[dOff] = 0;
        dstRGB[dOff + 1] = 0;
        dstRGB[dOff + 2] = 0;
      }
    }
  }

  target.maxHits = maxHits;
  // The oversized accumulator is the real progressive state (see
  // FlameHistogram.orbit) — this filtered view is a display-only derivative
  // that must never be fed back into accumulateFlame, so its own orbit is
  // meaningless; leave whatever is there (createFlameHistogram's zero default,
  // or a reused out's old filler) rather than maintaining a value nothing
  // should ever read.
  return target;
}

/**
 * Controls for {@link adaptiveDownsampleFlame}'s per-cell blur radius —
 * flam3's "density estimation" parameters.
 */
export interface DensityEstimatorParams {
  /** Blur radius (output pixels) for a cell with ~zero local density — the
   * widest the kernel ever gets, filling gaps in sparse/noisy regions. */
  estimatorRadius: number;
  /** Floor for the radius a densely-sampled cell narrows to; 0 leaves
   * well-sampled regions pin-sharp. Clamped to `estimatorRadius` if given a
   * larger value, so "minimum" can never exceed "maximum". */
  estimatorMinimumRadius: number;
  /** Shapes how quickly the radius narrows as a cell's own hit count grows
   * (see {@link adaptiveDownsampleFlame}'s doc for the exact curve —
   * `estimatorRadius / count ** estimatorCurve`, flam3's own formula and
   * parameter). Below 1, the radius narrows gently with count, so even
   * moderately-sampled cells keep some smoothing; above 1, it collapses to
   * `estimatorMinimumRadius` after just a few hits. flam3-ish values sit
   * around 0.3-0.6. */
  estimatorCurve: number;
}

/** Steps (in output pixels) between distinct precomputed kernel radii in
 * {@link adaptiveDownsampleFlame} — see its doc for why radii are quantized
 * into a small cache instead of every cell building its own kernel. */
const RADIUS_QUANTUM = 0.5;

/** Side length (source cells) of one occupancy tile in
 * {@link adaptiveDownsampleFlame}'s empty-footprint skip — see the
 * summed-area-table paragraph in its doc. Small enough that a tile is a
 * fine-grained emptiness probe, large enough that the table stays tiny
 * (~1/256th of the histogram's cell count). */
const OCCUPANCY_TILE = 16;

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
 * exactly the densest, most important part of the image (a high sample count
 * is what maps to `estimatorMinimumRadius` in the first place). 0.3 keeps the
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
 * 2. Map that count to a radius the way flam3 does — `estimatorRadius /
 *    max(1, count) ** estimatorCurve`, clamped to `[estimatorMinimumRadius,
 *    estimatorRadius]`. The count is the cell's own ABSOLUTE sample count,
 *    because that is what Monte-Carlo noise actually depends on (relative
 *    error falls as `1 / sqrt(count)`): a few hundred hits is a clean signal
 *    worth keeping sharp no matter how much hotter the image's hottest
 *    bucket happens to be. Normalizing against the histogram's peak instead
 *    (as this function originally did — fr-rq6) puts nearly every cell of a
 *    log-distributed histogram far below the max, so the whole image—
 *    converged structure included — got near-`estimatorRadius` blur, turning
 *    the finished frame into a featureless smear (and, since wide kernels
 *    ran everywhere, taking minutes to do it).
 * 3. Gather a Gaussian kernel of THAT radius. Building one with `Math.exp`
 *    fresh for every one of `width * height` cells would dominate the cost,
 *    so radii are quantized to the nearest {@link RADIUS_QUANTUM} output
 *    pixels and cached — a real render needs at most a few dozen distinct
 *    radius classes regardless of image size, turning "exp per cell" into
 *    "array lookup per cell, exp per class".
 *
 * Cells whose entire kernel footprint is provably empty are skipped outright
 * (their output written as zeros — exactly what gathering would produce):
 * a summed-area table over coarse {@link OCCUPANCY_TILE}-sized occupancy
 * tiles answers "any hits within this bounding box?" in O(1), so the empty
 * background — often most of a flame's frame, and always requesting the
 * widest kernel — costs a table lookup instead of a widest-kernel gather.
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
 * sparse image with hits scattered everywhere, every cell requesting the
 * widest kernel and no footprint empty enough to skip) — expensive enough
 * that it belongs on a finished/paused render, not every progressive frame;
 * see the worker's `runChunk` for how the two functions divide that work.
 * In practice the absolute-count radius mapping keeps converged structure on
 * small kernels and the occupancy skip makes empty background ~free, so a
 * typical finished frame costs a small multiple of a fixed-radius pass.
 *
 * `oversized`'s dimensions must be an exact positive-integer multiple of
 * `outWidth` / `outHeight`, exactly like `downsampleFlame`. Throws
 * `RangeError` otherwise.
 *
 * `out` reuses an existing `outWidth` x `outHeight` histogram instead of
 * allocating (throws `RangeError` on a size mismatch), with every bucket
 * fully overwritten — same contract, and same shared-memory/allocation-churn
 * reasoning, as `downsampleFlame`'s `out`.
 */
export function adaptiveDownsampleFlame(
  oversized: FlameHistogram,
  outWidth: number,
  outHeight: number,
  params: DensityEstimatorParams,
  out?: FlameHistogram,
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
      `adaptiveDownsampleFlame: source ${srcWidth}x${srcHeight} is not a positive-integer multiple of target ${outWidth}x${outHeight}`,
    );
  }
  if (out && (out.width !== outWidth || out.height !== outHeight)) {
    throw new RangeError(
      `adaptiveDownsampleFlame: out histogram is ${out.width}x${out.height}, but ${outWidth}x${outHeight} was requested`,
    );
  }
  const scaleX = srcWidth / outWidth;
  const scaleY = srcHeight / outHeight;
  const target = out ?? createFlameHistogram(outWidth, outHeight);
  const { hits: dstHits, sumRGB: dstRGB } = target;

  const estimatorRadius = Math.max(0, params.estimatorRadius);
  // Never let "minimum" exceed "maximum", regardless of how the caller's
  // sliders happen to be set relative to each other.
  const estimatorMinimumRadius = Math.min(
    estimatorRadius,
    Math.max(0, params.estimatorMinimumRadius),
  );
  const estimatorCurve = params.estimatorCurve;

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

  // Occupancy summed-area table (see the doc's skip paragraph): occ[(ty + 1)
  // * satStride + (tx + 1)] holds the number of occupied (any-hits) tiles in
  // the rectangle of tiles from (0, 0) through (tx, ty) inclusive, with a
  // zero border row/column so queries never need edge special cases. Built
  // in one O(srcWidth * srcHeight) scan + one O(tiles) prefix pass — trivial
  // next to even a single widest-kernel gather row.
  const tilesX = Math.ceil(srcWidth / OCCUPANCY_TILE);
  const tilesY = Math.ceil(srcHeight / OCCUPANCY_TILE);
  const satStride = tilesX + 1;
  const occupancy = new Int32Array(satStride * (tilesY + 1));
  for (let sy = 0; sy < srcHeight; sy++) {
    const rowBase = sy * srcWidth;
    const tileRow = (((sy / OCCUPANCY_TILE) | 0) + 1) * satStride;
    for (let sx = 0; sx < srcWidth; sx++) {
      if (srcHits[rowBase + sx] > 0) {
        occupancy[tileRow + ((sx / OCCUPANCY_TILE) | 0) + 1] = 1;
      }
    }
  }
  for (let ty = 1; ty <= tilesY; ty++) {
    for (let tx = 1; tx <= tilesX; tx++) {
      const i = ty * satStride + tx;
      occupancy[i] +=
        occupancy[i - 1] +
        occupancy[i - satStride] -
        occupancy[i - satStride - 1];
    }
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
      // Step 2: map the cell's own absolute count to a radius (see the doc's
      // ALGORITHM section for why absolute, not relative-to-peak — fr-rq6).
      // max(1, count) keeps an empty cell at exactly the widest radius
      // instead of dividing by 0 ** curve.
      const radius = Math.min(
        estimatorRadius,
        Math.max(
          estimatorMinimumRadius,
          estimatorRadius / Math.max(1, localCount) ** estimatorCurve,
        ),
      );

      // Step 3: gather the (cached-by-quantized-radius) kernel.
      const { kernelX, kernelY, radiusX, radiusY } = kernelFor(radius);

      // Empty-footprint skip: if no occupancy tile overlapping the kernel's
      // bounding box holds any hits, gathering would sum zeros — write the
      // zeros directly (a reused `out` may be dirty; see downsampleFlame).
      const dstBucket = oy * outWidth + ox;
      const dOff = dstBucket * 3;
      if (localCount <= 0) {
        const txLo = (Math.max(0, baseX - radiusX) / OCCUPANCY_TILE) | 0;
        const tyLo = (Math.max(0, baseY - radiusY) / OCCUPANCY_TILE) | 0;
        const txHi =
          ((Math.min(srcWidth - 1, baseX + radiusX) / OCCUPANCY_TILE) | 0) + 1;
        const tyHi =
          ((Math.min(srcHeight - 1, baseY + radiusY) / OCCUPANCY_TILE) | 0) + 1;
        const occupied =
          occupancy[tyHi * satStride + txHi] -
          occupancy[tyLo * satStride + txHi] -
          occupancy[tyHi * satStride + txLo] +
          occupancy[tyLo * satStride + txLo];
        if (occupied === 0) {
          dstHits[dstBucket] = 0;
          dstRGB[dOff] = 0;
          dstRGB[dOff + 1] = 0;
          dstRGB[dOff + 2] = 0;
          continue;
        }
      }

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
        dstHits[dstBucket] = hVal;
        dstRGB[dOff] = rSum * norm;
        dstRGB[dOff + 1] = gSum * norm;
        dstRGB[dOff + 2] = bSum * norm;
        if (hVal > maxHits) maxHits = hVal;
      } else {
        // Written, not skipped, for reused-out parity — see downsampleFlame.
        dstHits[dstBucket] = 0;
        dstRGB[dOff] = 0;
        dstRGB[dOff + 1] = 0;
        dstRGB[dOff + 2] = 0;
      }
    }
  }

  target.maxHits = maxHits;
  // Same non-answer as downsampleFlame's — see its doc — this is a
  // display-only derivative, never fed back into accumulateFlame.
  return target;
}
