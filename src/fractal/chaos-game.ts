import { applyAffine, composeAffine, rotationMatrixXYZ } from "./affine";
import type { Affine } from "./affine";
import { composeVariations } from "./variations";
import type { VariationBlend } from "./variations";
import type { IterationRng, Rng } from "./rng";
import type { Bounds, SymmetryParams, Transform, Vec3 } from "./types";

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

/** `prepareChaosGame`'s default `symmetry`: order 1 is the identity (today's
 * unreplicated system) for any axis, so every existing caller that omits the
 * parameter gets byte-identical behavior. */
const NO_SYMMETRY: SymmetryParams = { order: 1, axis: "y" };

/**
 * Largest symmetry order `<= requestedOrder` (and always `>= 1`) whose
 * expanded transform count (`order * baseTransformCount`) fits within
 * {@link MAX_TRANSFORMS} — the same "ask for N, get the largest N that fits"
 * shape as `flame.ts`'s `clampSupersampleToBudget`. `requestedOrder` is
 * floored to an integer and floored at 1 first, so a fractional or
 * non-finite input degrades gracefully rather than propagating; exported so
 * the UI can show the same "reduced to Nx" fact `prepareChaosGame` itself
 * acts on, without a round trip through a worker (unlike the memory-budget
 * clamps, this is a pure function of already-known state, not a runtime
 * device fact).
 */
export function effectiveSymmetryOrder(
  requestedOrder: number,
  baseTransformCount: number,
): number {
  const requested = Math.max(1, Math.floor(requestedOrder) || 1);
  if (baseTransformCount <= 0) return requested;
  const fits = Math.floor(MAX_TRANSFORMS / baseTransformCount);
  return Math.max(1, Math.min(requested, fits));
}

/** Row-major 3x3 rotation by `angle` radians about a single axis — one
 * nonzero Euler angle into {@link rotationMatrixXYZ} gives exactly that,
 * since the other two axes' sin/cos terms all collapse to 0/1. */
function symmetryRotation(
  axis: SymmetryParams["axis"],
  angle: number,
): number[] {
  switch (axis) {
    case "x":
      return rotationMatrixXYZ(angle, 0, 0);
    case "y":
      return rotationMatrixXYZ(0, angle, 0);
    case "z":
      return rotationMatrixXYZ(0, 0, angle);
  }
}

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
  /**
   * The draw range for the unweighted uniform pick in `pickIndex`: every
   * rotated-copy SLOT, not just the base maps — `baseTransformCount *
   * effectiveSymmetryOrder(...)`. Equal to `baseTransformCount` at symmetry
   * order 1 (see {@link baseTransformCount}).
   */
  transformCount: number;
  /**
   * `transforms.length` — the number of BASE (un-rotated) maps, i.e. the
   * length `affines`/`variations`/`postRotations` would have with no
   * symmetry. A `pickIndex` draw (0..`transformCount` - 1) recovers the
   * "logical" map it came from via `idx % baseTransformCount` — see
   * {@link stepOrbit} — which is what per-transform coloring, the editor's
   * selection, and the flame's `palette` array must key on to keep meaning
   * "logical map" rather than "which kaleidoscope copy". Equal to
   * `transformCount` at symmetry order 1.
   */
  baseTransformCount: number;
  /** Whether any transform has a non-1 weight — selects the weighted draw in `pickIndex`. */
  weighted: boolean;
  /** Running sum of weights, indexed like `transforms`; binary-searched when `weighted`. */
  cumulative: Float64Array;
  /** Sum of all transform weights. */
  totalWeight: number;
  /**
   * Row-major 3x3 rotation applied AFTER a slot's affine + variation output
   * (fr-6im's kaleidoscope copies), indexed like `affines`/`variations`, or
   * `null` for an unrotated slot — every slot at symmetry order 1, and every
   * copy-0 slot at any order, so the RNG stream and every coordinate stay
   * byte-identical to the pre-symmetry code path exactly where there is
   * nothing to rotate. See {@link stepOrbit}.
   */
  postRotations: (number[] | null)[];
}

/**
 * Compose a transform set — and an optional final-transform lens — into a
 * {@link PreparedChaosGame}: everything about a run that does not change
 * per-iteration. Call once per run and reuse the result for every
 * {@link stepOrbit} / {@link plotPoint} call in that run.
 *
 * `symmetry` (fr-6im; defaults to order 1, the identity) replicates every
 * base map `effectiveSymmetryOrder(symmetry.order, transforms.length)` times,
 * copy `k` rotated by `2π·k / order` about `symmetry.axis` — see
 * {@link stepOrbit} for where that rotation is actually applied. At order 1
 * (any axis) this expansion is a no-op: exactly one (unrotated) copy of each
 * base map, so every existing caller that omits `symmetry` gets a
 * byte-identical `PreparedChaosGame` to before this parameter existed.
 *
 * Throws `RangeError` if `transforms.length` exceeds {@link MAX_TRANSFORMS}
 * (the Uint8 transform-index cap) — independent of `symmetry`, which instead
 * silently reduces its own effective order to fit that same cap on the
 * EXPANDED count (see {@link effectiveSymmetryOrder}).
 */
export function prepareChaosGame(
  transforms: Transform[],
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = NO_SYMMETRY,
): PreparedChaosGame {
  if (transforms.length > MAX_TRANSFORMS) {
    throw new RangeError(
      `IFS supports at most ${MAX_TRANSFORMS} transforms, got ${transforms.length}`,
    );
  }

  const baseTransformCount = transforms.length;
  const baseAffines = transforms.map(composeAffine);
  // Per-transform nonlinear warp, or null for a purely affine map. Every entry
  // is null for the existing presets, so `stepOrbit` takes the exact same path
  // (and touches the RNG identically) as before variations existed.
  const baseVariations = transforms.map((t) => composeVariations(t.variations));
  // The optional final transform: one more affine + variation map applied only
  // when a point is plotted (`plotPoint`), never fed back into the orbit. Both
  // stay null when absent, so `plotPoint` keeps the pre-feature code path.
  const finalAffine = finalTransform ? composeAffine(finalTransform) : null;
  const finalWarp = finalTransform
    ? composeVariations(finalTransform.variations)
    : null;

  // Expand into one prepared SLOT per (copy, base map) pair, slot k*n+i —
  // copy 0 first (unrotated), then copy 1, etc. — so `idx % baseTransformCount`
  // always recovers base index i regardless of how many copies exist. Copy 0's
  // rotation is always null (not just an identity matrix) and, at order 1,
  // it's the ONLY copy, so this loop degenerates to exactly the pre-symmetry
  // affines/variations arrays — same values, same order, same RNG behavior.
  const order = effectiveSymmetryOrder(symmetry.order, baseTransformCount);
  const affines: Affine[] = [];
  const variations: (VariationBlend | null)[] = [];
  const postRotations: (number[] | null)[] = [];
  for (let k = 0; k < order; k++) {
    const post =
      k === 0
        ? null
        : symmetryRotation(symmetry.axis, (2 * Math.PI * k) / order);
    for (let i = 0; i < baseTransformCount; i++) {
      affines.push(baseAffines[i]);
      variations.push(baseVariations[i]);
      postRotations.push(post);
    }
  }
  const transformCount = affines.length;

  // Selection weights: each slot inherits its BASE map's weight unchanged, so
  // pickIndex's draw over the full expanded list gives every copy an equal
  // share of its base map's total probability mass. When every weight is 1
  // (the common case) we keep the original `Math.floor(rng() * n)` draw, so
  // uniform systems consume the RNG identically and render exactly as before.
  // Only a genuinely weighted system pays for the cumulative-weight table +
  // binary search.
  const weights = new Array<number>(transformCount);
  for (let s = 0; s < transformCount; s++) {
    weights[s] = transforms[s % baseTransformCount].weight ?? 1;
  }
  let totalWeight = 0;
  const cumulative = new Float64Array(transformCount);
  for (let s = 0; s < transformCount; s++) {
    totalWeight += weights[s];
    cumulative[s] = totalWeight;
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
    transformCount,
    baseTransformCount,
    weighted,
    cumulative,
    totalWeight,
    postRotations,
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
 *
 * Symmetry (fr-6im): when `prepared` has rotated copies, the picked slot's
 * `postRotations` entry — the copy's rotation, applied to the map's FULL
 * affine + variation output — bends the landing point before the escape
 * check, since that rotated point is what actually feeds back into the
 * orbit. `null` (every slot at symmetry order 1, and every unrotated copy-0
 * slot at any order) skips this step entirely, so the RNG stream and every
 * coordinate stay byte-identical to the pre-symmetry code path exactly where
 * there is nothing to rotate. The returned `index` is always the BASE map
 * index (`idx % prepared.baseTransformCount`), never the expanded slot, so
 * per-transform coloring and the editor's selection keep meaning "logical
 * map" regardless of which kaleidoscope copy actually fired.
 *
 * `auxRng` (fr-2wfw) is the stream every ITERATION-LOCAL draw comes from —
 * a stochastic variation's coin flips (`julia`) and the escape-reseed
 * coordinates; the transform pick alone stays on `rng`. It defaults to `rng`
 * itself: the original single-stream behavior, byte-identical for every
 * existing caller. Passing a separate stream makes the primary stream's
 * consumption rigid (exactly one draw per step), so two runs of ε-different
 * systems under the same primary seed keep their pick sequences aligned even
 * when one escapes — or flips a weight-boundary pick onto a
 * differently-drawing map — where the other doesn't, and corresponding
 * points stay corresponding outside a short contraction wake. That
 * correspondence is what the replace-load/drift morph's pinned seed exists
 * to provide (morph-tween.ts); on one shared stream, a single differing draw
 * re-rolls the entire remaining cloud — the morph visibly "boils". See
 * {@link runChaosGame}'s `iterationRng` for the per-iteration discipline the
 * cloud generation layers on top.
 */
export function stepOrbit(
  prepared: PreparedChaosGame,
  x: number,
  y: number,
  z: number,
  rng: Rng,
  auxRng: Rng = rng,
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
    const q = warp(p[0], p[1], p[2], auxRng);
    nx = q[0];
    ny = q[1];
    nz = q[2];
  }
  const post = prepared.postRotations[idx];
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
    nx = auxRng() - 0.5;
    ny = auxRng() - 0.5;
    nz = auxRng() - 0.5;
  }
  return { x: nx, y: ny, z: nz, index: idx % prepared.baseTransformCount };
}

/**
 * Compute the plotted point for an orbit point: the point itself, or — when
 * `prepared` has a final transform — that point bent through the
 * final-transform "lens" (fractal-flame terminology: applied only at plot
 * time, never fed back into the orbit; see {@link runChaosGame}). A nonlinear
 * lens can diverge at a singularity; the bent point is only adopted while
 * every coordinate stays finite, otherwise this returns the orbit point
 * unchanged so a bad landing never produces NaN/Inf.
 *
 * `auxRng` (fr-2wfw) mirrors {@link stepOrbit}'s parameter of the same name:
 * the stream a stochastic lens's own draws come from, defaulting to `rng` —
 * the original single-stream behavior.
 */
export function plotPoint(
  prepared: PreparedChaosGame,
  x: number,
  y: number,
  z: number,
  rng: Rng,
  auxRng: Rng = rng,
): Vec3 {
  const { finalAffine, finalWarp } = prepared;
  if (finalAffine === null) return [x, y, z];
  const p = applyAffine(finalAffine, x, y, z);
  let fx = p[0];
  let fy = p[1];
  let fz = p[2];
  if (finalWarp !== null) {
    const q = finalWarp(fx, fy, fz, auxRng);
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
 * An optional `symmetry` (fr-6im; defaults to order 1, the identity) draws
 * from `effectiveSymmetryOrder(symmetry.order, transforms.length)` rotated
 * copies of the transform set instead of just the base maps — see
 * {@link prepareChaosGame}. `transformIndices` still records the BASE map
 * index regardless, so per-transform coloring is unaffected.
 *
 * An optional `iterationRng` (fr-2wfw) moves every ITERATION-LOCAL draw — a
 * stochastic variation's coin flips, the escape-reseed coordinates — onto a
 * per-iteration stream rewound to `begin(i)` at each iteration, leaving
 * `rng` to serve exactly one draw per transform pick (plus the three seeding
 * the initial point). That rigidity is what keeps two ε-different runs under
 * the same seed point-for-point correspondent — see {@link stepOrbit}'s
 * `auxRng` doc for the failure mode, and `rng.ts`'s {@link IterationRng} for
 * why the local draws key on the iteration NUMBER (a differing escape then
 * cannot offset any other iteration's dice). Omitted, every draw shares
 * `rng` — the original behavior, byte-identical for every existing caller.
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
  symmetry: SymmetryParams = NO_SYMMETRY,
  iterationRng?: IterationRng,
): ChaosGameResult {
  if (transforms.length === 0 || numPoints <= 0) {
    return {
      positions: new Float32Array(0),
      transformIndices: new Uint8Array(0),
      count: 0,
      bounds: emptyBounds(),
    };
  }

  const prepared = prepareChaosGame(transforms, finalTransform, symmetry);

  const positions = new Float32Array(numPoints * 3);
  const transformIndices = new Uint8Array(numPoints);

  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;

  // The iteration-local stream (see the doc above): `aux` is `rng` itself in
  // the default single-stream mode, so every draw below stays byte-identical
  // to the original code; with an `iterationRng`, each iteration — warmup
  // and recording alike, numbered consecutively — rewinds it first.
  const aux = iterationRng ? iterationRng.draw : rng;

  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    if (iterationRng) iterationRng.begin(i);
    const s = stepOrbit(prepared, x, y, z, rng, aux);
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

  // Hand-inlined stepOrbit + plotPoint (mirrors flame.ts's accumulateFlame
  // and voxel.ts's accumulateVoxels): at hundreds of thousands to millions
  // of points, the OrbitStep object and the two Vec3 arrays those functions
  // allocate per call become real GC pressure. Checked against the real
  // stepOrbit/plotPoint by the oracle test in chaos-game.test.ts
  // ("allocation-free oracle"), so the two paths can never silently drift
  // apart.
  const { affines, variations, postRotations, finalAffine, finalWarp } =
    prepared;
  const { baseTransformCount } = prepared;

  for (let i = 0; i < numPoints; i++) {
    // --- inlined stepOrbit(prepared, x, y, z, rng, aux) ---------------------
    if (iterationRng) iterationRng.begin(WARMUP_ITERATIONS + i);
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
      // Nonlinear maps can send a point to infinity — or, at a singularity,
      // to NaN. The reseed guard below catches both (NaN fails
      // Number.isFinite), stopping a bad landing from poisoning the orbit.
      const q = warp(ax, ay, az, aux);
      nx = q[0];
      ny = q[1];
      nz = q[2];
    }

    // Symmetry (fr-6im): rotate this slot's FULL affine + variation output —
    // see stepOrbit, which this mirrors exactly. `null` (order 1, and every
    // unrotated copy-0 slot at any order) skips this, so the orbit stays
    // byte-identical to the pre-symmetry loop exactly where there is nothing
    // to rotate.
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
      nx = aux() - 0.5;
      ny = aux() - 0.5;
      nz = aux() - 0.5;
    }
    x = nx;
    y = ny;
    z = nz;

    // --- inlined plotPoint(prepared, x, y, z, rng, aux) ----------------------
    // The plotted point is the orbit point, optionally bent by the final
    // transform. The orbit state x/y/z is left untouched, so the lens never
    // feeds back into the iteration.
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
        const q = finalWarp(fx, fy, fz, aux);
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

    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
    // The BASE map this slot is a (possibly rotated) copy of (fr-6im) — see
    // PreparedChaosGame.baseTransformCount — matching stepOrbit's own
    // OrbitStep.index exactly, including the escape-reseed case (idx is the
    // TRIGGERING transform, fixed before the reseed branch above runs).
    transformIndices[i] = idx % baseTransformCount;

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
