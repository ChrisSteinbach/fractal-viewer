import { applyAffine, composeAffine } from "./affine";
import type { Affine } from "./affine";
import { composeVariations } from "./variations";
import type { VariationBlend } from "./variations";
import type { Rng } from "./rng";
import type { Bounds, Transform, Vec3 } from "./types";

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

/**
 * Iterations discarded so the orbit settles onto the attractor first. A
 * consumer that drives {@link stepOrbit} itself (rather than through
 * {@link runChaosGame}) must run this many warmup steps before recording, to
 * converge onto the same attractor and stay RNG-identical.
 */
export const WARMUP_ITERATIONS = 100;
/**
 * Reset to a fresh seed point if a coordinate diverges past this magnitude.
 * Exported alongside {@link pickIndex} so a hand-inlined hot loop (see
 * `flame.ts`'s `accumulateFlame`) can replicate `stepOrbit`'s escape check
 * exactly, rather than duplicating (and risking drift from) this threshold.
 */
export const ESCAPE_LIMIT = 50;
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
 * The per-run setup shared by every chaos-game consumer: composed affines and
 * variation blends (one pair per transform), the optional final-transform
 * lens, and the weighted-selection table. Building this once per run — rather
 * than recomputing it every iteration — is what lets both the point-cloud
 * recorder ({@link runChaosGame}) and a future histogram accumulator drive the
 * exact same tested stepping logic ({@link stepOrbit}, {@link plotPoint})
 * while each owns its own tight loop and output sink.
 */
export interface PreparedChaosGame {
  /** Composed affine map per transform, indexed like `transforms`. */
  affines: Affine[];
  /** Composed variation blend per transform, or `null` for a purely affine map. */
  variations: (VariationBlend | null)[];
  /** Composed final-transform affine (the plot-time lens), or `null` when absent. */
  finalAffine: Affine | null;
  /** Composed final-transform variation blend, or `null`. */
  finalWarp: VariationBlend | null;
  /** `transforms.length`, i.e. the draw range for the unweighted uniform pick. */
  transformCount: number;
  /** Whether any transform has a non-1 weight — selects the weighted draw in `pickIndex`. */
  weighted: boolean;
  /** Running sum of weights, indexed like `transforms`; binary-searched when `weighted`. */
  cumulative: Float64Array;
  /** Sum of all transform weights. */
  totalWeight: number;
}

/**
 * Compose a transform set — and an optional final-transform lens — into a
 * {@link PreparedChaosGame}: everything about a run that does not change
 * per-iteration. Call once per run and reuse the result for every
 * {@link stepOrbit} / {@link plotPoint} call in that run.
 *
 * Throws `RangeError` if `transforms.length` exceeds {@link MAX_TRANSFORMS}
 * (the Uint8 transform-index cap).
 */
export function prepareChaosGame(
  transforms: Transform[],
  finalTransform: Transform | null = null,
): PreparedChaosGame {
  if (transforms.length > MAX_TRANSFORMS) {
    throw new RangeError(
      `IFS supports at most ${MAX_TRANSFORMS} transforms, got ${transforms.length}`,
    );
  }

  const affines = transforms.map(composeAffine);
  // Per-transform nonlinear warp, or null for a purely affine map. Every entry
  // is null for the existing presets, so `stepOrbit` takes the exact same path
  // (and touches the RNG identically) as before variations existed.
  const variations = transforms.map((t) => composeVariations(t.variations));
  // The optional final transform: one more affine + variation map applied only
  // when a point is plotted (`plotPoint`), never fed back into the orbit. Both
  // stay null when absent, so `plotPoint` keeps the pre-feature code path.
  const finalAffine = finalTransform ? composeAffine(finalTransform) : null;
  const finalWarp = finalTransform
    ? composeVariations(finalTransform.variations)
    : null;

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

  return {
    affines,
    variations,
    finalAffine,
    finalWarp,
    transformCount: transforms.length,
    weighted,
    cumulative,
    totalWeight,
  };
}

/**
 * Smallest index whose cumulative weight exceeds `r = rng() * totalWeight`, or
 * the plain uniform draw `Math.floor(rng() * n)` when no transform has a
 * non-1 weight — the fast, RNG-identical path for the common unweighted case
 * (see {@link prepareChaosGame}). For all-unit weights the lower-bound search
 * coincides with the uniform draw, so the two paths agree where they overlap.
 *
 * Exported so a hand-inlined hot loop (see `flame.ts`'s `accumulateFlame`)
 * can pick a transform the exact same way {@link stepOrbit} does, without
 * paying for `stepOrbit`'s per-call `OrbitStep` allocation.
 */
export function pickIndex(prepared: PreparedChaosGame, rng: Rng): number {
  if (!prepared.weighted) {
    return Math.floor(rng() * prepared.transformCount);
  }
  const { cumulative, totalWeight } = prepared;
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

/** The orbit point (and the transform that produced it) after one {@link stepOrbit} call. */
export interface OrbitStep {
  x: number;
  y: number;
  z: number;
  /** Index of the transform that produced this step (see caveat below). */
  index: number;
}

/**
 * Advance the chaos-game orbit by one iteration: pick a random transform (per
 * `prepared`'s weights), apply its affine + variation, and reseed if the
 * landing point escapes to infinity. Pure: takes the current orbit point and
 * returns the next one plus the chosen transform index, so a caller — the
 * warmup loop, {@link runChaosGame}'s recording loop, or another consumer
 * entirely — carries the state forward itself.
 *
 * Known caveat: when a point escapes and is reseeded, the returned index is
 * the transform that TRIGGERED the escape, not one that "placed" the new
 * random seed. A caller that tags the reseeded point with this index (e.g.
 * for "by transform" coloring) is therefore slightly inaccurate. This is
 * intentional — the alternative (retry or skip) adds complexity for a case
 * that is essentially impossible with contractive IFS maps (escape requires a
 * net-expansive application, which a well-formed IFS never produces in steady
 * state). The reseed path is a safety net only.
 */
export function stepOrbit(
  prepared: PreparedChaosGame,
  x: number,
  y: number,
  z: number,
  rng: Rng,
): OrbitStep {
  const idx = pickIndex(prepared, rng);
  const p = applyAffine(prepared.affines[idx], x, y, z);
  const warp = prepared.variations[idx];
  let nx: number;
  let ny: number;
  let nz: number;
  if (warp === null) {
    nx = p[0];
    ny = p[1];
    nz = p[2];
  } else {
    // Nonlinear maps can send a point to infinity — or, at a singularity, to
    // NaN. The reseed guard below catches both (NaN fails Number.isFinite),
    // stopping a bad landing from poisoning the rest of the orbit.
    const q = warp(p[0], p[1], p[2], rng);
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
  return { x: nx, y: ny, z: nz, index: idx };
}

/**
 * Compute the plotted point for an orbit point: the point itself, or — when
 * `prepared` has a final transform — that point bent through the
 * final-transform "lens" (fractal-flame terminology: applied only at plot
 * time, never fed back into the orbit; see {@link runChaosGame}). A nonlinear
 * lens can diverge at a singularity; the bent point is only adopted while
 * every coordinate stays finite, otherwise this returns the orbit point
 * unchanged so a bad landing never produces NaN/Inf.
 */
export function plotPoint(
  prepared: PreparedChaosGame,
  x: number,
  y: number,
  z: number,
  rng: Rng,
): Vec3 {
  const { finalAffine, finalWarp } = prepared;
  if (finalAffine === null) return [x, y, z];
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
  if (Number.isFinite(fx) && Number.isFinite(fy) && Number.isFinite(fz)) {
    return [fx, fy, fz];
  }
  return [x, y, z];
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
 *
 * The per-run setup ({@link prepareChaosGame}) and per-iteration stepping
 * ({@link stepOrbit}, {@link plotPoint}) this function drives are exported so
 * another consumer — e.g. a histogram accumulator that needs the same
 * iteration logic but a different sink — can reuse them with its own loop.
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

  const prepared = prepareChaosGame(transforms, finalTransform);

  const positions = new Float32Array(numPoints * 3);
  const transformIndices = new Uint8Array(numPoints);

  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;

  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    const s = stepOrbit(prepared, x, y, z, rng);
    x = s.x;
    y = s.y;
    z = s.z;
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
    const s = stepOrbit(prepared, x, y, z, rng);
    x = s.x;
    y = s.y;
    z = s.z;

    // The plotted point is the orbit point, optionally bent by the final
    // transform. The orbit state x/y/z is left untouched, so the lens never
    // feeds back into the iteration.
    const [px, py, pz] = plotPoint(prepared, x, y, z, rng);

    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
    transformIndices[i] = s.index;

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
