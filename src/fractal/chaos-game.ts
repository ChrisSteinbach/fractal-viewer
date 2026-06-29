import { applyAffine, composeAffine } from "./affine";
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
 */
export function runChaosGame(
  transforms: Transform[],
  numPoints: number,
  rng: Rng = Math.random,
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
  const positions = new Float32Array(numPoints * 3);
  const transformIndices = new Uint8Array(numPoints);

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
    const idx = Math.floor(rng() * transforms.length);
    const p = applyAffine(affines[idx], x, y, z);
    x = p[0];
    y = p[1];
    z = p[2];
    if (
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
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    transformIndices[i] = idx;

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    const r = Math.sqrt(x * x + y * y + z * z);
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
