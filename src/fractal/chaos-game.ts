import { applyAffine, composeAffine } from "./affine";
import { composeVariations } from "./variations";
import type { Rng } from "./rng";
import type { Bounds, Transform } from "./types";

/** Result of running the chaos game: a flat point cloud plus metadata. */
export interface ChaosGameResult {
  /** Interleaved xyz positions, length `count * 3`. */
  positions: Float32Array;
  /** Index of the transform that produced each point, length `count`. */
  transformIndices: Uint8Array;
  /** Number of points generated. */
  count: number;
  /** Spatial extent of the cloud, used for normalized coloring. */
  bounds: Bounds;
}

/** Iterations discarded so the orbit settles onto the attractor first. */
const WARMUP_ITERATIONS = 100;
/** Reset to a fresh seed point if a coordinate diverges past this magnitude. */
const ESCAPE_LIMIT = 50;
/** Uint8 transform indices cap the system at 256 maps. */
export const MAX_TRANSFORMS = 256;

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
 * Render an iterated function system with the "chaos game": starting from a
 * random point, repeatedly pick a random transform and apply it, recording each
 * landing spot. The cloud converges on the system's attractor — the fractal.
 *
 * Pass a seeded {@link Rng} for reproducible output (tests); the app passes
 * `Math.random`. Returns an empty result when there are no transforms or no
 * points were requested.
 *
 * An optional `finalTransform` is applied to every point *as it is plotted*
 * (fractal-flame terminology) — a lens over the whole cloud that never feeds
 * back into the orbit. Omit it (or pass `null`) and the loop takes the exact
 * same path, and consumes the RNG identically, as before the feature existed.
 */
export function runChaosGame(
  transforms: Transform[],
  numPoints: number,
  rng: Rng = Math.random,
  finalTransform: Transform | null = null,
): ChaosGameResult {
  if (transforms.length === 0 || numPoints <= 0) {
    return {
      positions: new Float32Array(0),
      transformIndices: new Uint8Array(0),
      count: 0,
      bounds: emptyBounds(),
    };
  }
  if (transforms.length > MAX_TRANSFORMS) {
    throw new RangeError(
      `IFS supports at most ${MAX_TRANSFORMS} transforms, got ${transforms.length}`,
    );
  }

  const affines = transforms.map(composeAffine);
  // Per-transform nonlinear warp, or null for a purely affine map. Every entry
  // is null for the existing presets, so `step` takes the exact same path (and
  // touches the RNG identically) as before variations existed.
  const variations = transforms.map((t) => composeVariations(t.variations));
  // The optional final transform: one more affine + variation map applied only
  // when a point is plotted (below), never fed back into the orbit. Both stay
  // null when absent, so the recording loop keeps the pre-feature code path.
  const finalAffine = finalTransform ? composeAffine(finalTransform) : null;
  const finalWarp = finalTransform
    ? composeVariations(finalTransform.variations)
    : null;
  const positions = new Float32Array(numPoints * 3);
  const transformIndices = new Uint8Array(numPoints);

  // Selection weights. When every weight is 1 (the common case) we keep the
  // original `Math.floor(rng() * n)` draw, so uniform systems consume the RNG
  // identically and render exactly as before. Only a genuinely weighted system
  // pays for the cumulative-weight table + binary search.
  const weights = transforms.map((t) => t.weight ?? 1);
  let totalWeight = 0;
  const cumulative = new Float64Array(weights.length);
  for (let i = 0; i < weights.length; i++) {
    totalWeight += weights[i];
    cumulative[i] = totalWeight;
  }
  const weighted =
    weights.some((w) => w !== 1) &&
    totalWeight > 0 &&
    Number.isFinite(totalWeight);

  // Smallest index whose cumulative weight exceeds `r = rng() * totalWeight`.
  // For all-unit weights this lower-bound search coincides with the uniform
  // draw above, so the two paths agree where they overlap.
  const pickIndex = weighted
    ? (): number => {
        const r = rng() * totalWeight;
        let lo = 0;
        let hi = cumulative.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (r < cumulative[mid]) hi = mid;
          else lo = mid + 1;
        }
        return lo;
      }
    : (): number => Math.floor(rng() * transforms.length);

  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;

  // One chaos-game iteration: hop along a random transform, reseeding if the
  // point escapes to infinity. Returns the chosen transform index.
  //
  // Known caveat: when a point escapes and is reseeded, the returned idx is
  // the transform that TRIGGERED the escape, not one that "placed" the new
  // random seed. The recording loop therefore tags a reseeded point with the
  // escaping transform's index, making its "by transform" color inaccurate.
  // This is intentional — the alternative (retry or skip) adds complexity for
  // a case that is essentially impossible with contractive IFS maps (escape
  // requires a net-expansive application, which a well-formed IFS never
  // produces in steady state). The reseed path is a safety net only.
  const step = (): number => {
    const idx = pickIndex();
    const p = applyAffine(affines[idx], x, y, z);
    const warp = variations[idx];
    if (warp === null) {
      x = p[0];
      y = p[1];
      z = p[2];
    } else {
      // Nonlinear maps can send a point to infinity — or, at a singularity, to
      // NaN. The reseed guard below catches both (NaN fails Number.isFinite),
      // stopping a bad landing from poisoning the rest of the orbit.
      const q = warp(p[0], p[1], p[2], rng);
      x = q[0];
      y = q[1];
      z = q[2];
    }
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      Math.abs(x) > ESCAPE_LIMIT ||
      Math.abs(y) > ESCAPE_LIMIT ||
      Math.abs(z) > ESCAPE_LIMIT
    ) {
      x = rng() - 0.5;
      y = rng() - 0.5;
      z = rng() - 0.5;
    }
    return idx;
  };

  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    step();
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;

  for (let i = 0; i < numPoints; i++) {
    const idx = step();
    // The plotted point is the orbit point, optionally bent by the final
    // transform. The orbit state x/y/z is left untouched, so the lens never
    // feeds back into the iteration.
    let px = x;
    let py = y;
    let pz = z;
    if (finalAffine !== null) {
      const p = applyAffine(finalAffine, x, y, z);
      let fx = p[0];
      let fy = p[1];
      let fz = p[2];
      if (finalWarp !== null) {
        const q = finalWarp(fx, fy, fz, rng);
        fx = q[0];
        fy = q[1];
        fz = q[2];
      }
      // A nonlinear lens can diverge at a singularity; only adopt the bent point
      // while it stayed finite, otherwise plot the un-bent orbit point so a bad
      // landing never writes NaN/Inf into the buffer.
      if (Number.isFinite(fx) && Number.isFinite(fy) && Number.isFinite(fz)) {
        px = fx;
        py = fy;
        pz = fz;
      }
    }
    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
    transformIndices[i] = idx;

    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
    minZ = Math.min(minZ, pz);
    maxZ = Math.max(maxZ, pz);
    const r = Math.sqrt(px * px + py * py + pz * pz);
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
  }

  return {
    positions,
    transformIndices,
    count: numPoints,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ, minR, maxR },
  };
}
