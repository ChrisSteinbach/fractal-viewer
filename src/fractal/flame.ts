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
 * average — `sumRGB / hits` — is the bucket's color). `hits` is a
 * `Float64Array` (not `Float32Array`) because a single hot bucket in a
 * converged render can exceed 2^24, the point past which `Float32` can no
 * longer represent every integer exactly — losing hits there would silently
 * cap the brightest region's density. `sumRGB` stays `Float32Array`: it also
 * accumulates over many additions, but the *visible* output is an 8-bit
 * channel, so `Float32`'s precision loss at large sums is far below what the
 * final image can even display.
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
  sumRGB: Float32Array;
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
    sumRGB: new Float32Array(width * height * 3),
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
 * Minimal tone-mapping controls. Deliberately small: gamma, vibrancy, and
 * supersampling are a later pass (fr-ucs) — this is just enough to make a
 * converging render usable.
 */
export interface TonemapParams {
  /**
   * Brightness multiplier applied to the log-density curve; 1 is neutral.
   * Above 1 pushes more of the image toward full brightness (and lets the
   * hottest buckets clip to white); below 1 darkens the whole image.
   */
  exposure: number;
}

/**
 * Render a {@link FlameHistogram} to an RGBA image (row-major, top row
 * first, matching `ImageData`/canvas conventions): brightness is the
 * log-density of hits, so a bucket with a single hit stays faintly visible
 * instead of vanishing while the hottest bucket anchors the top of the
 * curve — the classic flame tone-map that keeps both a blazing core and
 * wispy, sparsely-visited tendrils legible in one image. Color is each
 * bucket's average accumulated color (`sumRGB / hits`) scaled by that
 * brightness. Buckets with no hits are fully transparent black, so the
 * image composites cleanly over any backdrop.
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

  const { exposure } = params;
  // log1p(hits), not log(hits): finite (and 0) at hits = 0 or 1, so a bucket
  // with a single hit lands near the bottom of the curve instead of at
  // -Infinity or needing a discontinuous special case.
  const logMax = Math.log1p(maxHits);

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (h <= 0) continue;
    const brightness = (Math.log1p(h) / logMax) * exposure;
    const invHits = 1 / h;
    const o = i * 3;
    const oi = i * 4;
    // Uint8ClampedArray rounds and clamps to [0, 255] on assignment, so an
    // over-exposed (>1) or negative channel never needs a manual clamp.
    out[oi] = sumRGB[o] * invHits * brightness * 255;
    out[oi + 1] = sumRGB[o + 1] * invHits * brightness * 255;
    out[oi + 2] = sumRGB[o + 2] * invHits * brightness * 255;
    out[oi + 3] = 255;
  }
  return out;
}
