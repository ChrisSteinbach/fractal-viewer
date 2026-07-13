import { applyAffine4, composeAffine4 } from "./affine4";
import type { Affine4 } from "./affine4";
import { ESCAPE_LIMIT, MAX_TRANSFORMS, WARMUP_ITERATIONS } from "./chaos-game";
import { composeVariations4 } from "./variations4";
import type { VariationBlend4 } from "./variations4";
import type { IterationRng, Rng } from "./rng";
import type { Bounds4, Transform4, Vec4 } from "./types";

/**
 * # 4D chaos game (fr-cbg spike; variations + lens in fr-hy8; prepared seams
 * in fr-5b3)
 *
 * A dedicated, self-contained 4D path that mirrors the SHAPE of
 * `chaos-game.ts`'s {@link import("./chaos-game").runChaosGame} but does not try
 * to share its code. The house style deliberately prefers a hand-unrolled path
 * per dimension over an `n`-generic abstraction: the inner loop is the hottest
 * code in the app, and an unrolled 4-coordinate step (no arrays, no dimension
 * loop) stays branch-predictable and lets V8 keep the orbit in registers — the
 * same reason `chaos-game.ts` unrolls its 3-coordinate step. So this file
 * intentionally duplicates the escape/reseed and weighted-pick logic rather than
 * generalising `chaos-game.ts`. The few genuinely-shared *constants*
 * (`WARMUP_ITERATIONS`, `ESCAPE_LIMIT`, `MAX_TRANSFORMS`) ARE imported from
 * there, so the two paths can never drift on those.
 *
 * The path carries the same nonlinear apparatus the 3D path has: per-transform
 * {@link composeVariations4} blends (applied after each map's affine, before the
 * escape check) and an optional plot-time final-transform lens — so an embedded
 * 3D system reproduces its warps and lens faithfully. A system with no
 * variations and no lens takes the exact same code path, and consumes the RNG
 * identically, as before those were added (the blend/lens are `null`). Symmetry
 * is still 3D-only.
 *
 * As of fr-5b3 (the 4D flame/solid renders), the per-run setup and per-iteration stepping are hoisted
 * into their own exported seams — {@link prepareChaosGame4}, {@link pickIndex4},
 * {@link stepOrbit4}, {@link plotPoint4} — the 4D twins of `chaos-game.ts`'s
 * `prepareChaosGame`/`pickIndex`/`stepOrbit`/`plotPoint`. This is what lets a
 * future 4D histogram accumulator (a `flame-gpu.ts`-style hand-inlined hot loop)
 * drive the exact same tested stepping logic {@link runChaosGame4} does, rather
 * than duplicating it a third time. `runChaosGame4` itself is refactored to call
 * these seams, but its RNG consumption order is unchanged bit-for-bit — see the
 * golden-pin regression test in `chaos-game-4d.test.ts`.
 */

/**
 * Result of running the 4D chaos game: the cloud split into a shader-ready
 * interleaved `xyz` buffer and a separate `w` buffer, plus bounds and a framing
 * sphere.
 */
export interface ChaosGame4Result {
  /** Interleaved xyz positions, length `count * 3` (shader-ready as-is). */
  positions: Float32Array;
  /**
   * The fourth coordinate per point, length `count`. Kept SEPARATE from
   * `positions` so the scene can upload it as its own vertex attribute with
   * zero repacking — the renderer colours by `w` while positioning by `xyz`.
   */
  w: Float32Array;
  /** Index of the transform that produced each point, length `count`. */
  transformIndices: Uint8Array;
  /** Number of points generated. */
  count: number;
  /**
   * Axis-aligned extent of the cloud (all four coordinates). The box's
   * half-extents also drive the shader's rotation-covariant w-colour
   * amplitude (fr-9bk).
   */
  bounds: Bounds4;
  /** Center of the bounds box. */
  center: Vec4;
  /**
   * EXACT maximum Euclidean 4D distance from {@link center} over every emitted
   * point (not the box half-diagonal bound). Rotation-invariant under any 4D
   * view rotation about `center`, so a bounding sphere of this radius stays
   * valid — and the camera can frame it once — at every tumble angle without
   * re-running as the view turns (frustum culling in `setPoints4`, framing in
   * `main.ts`'s `fourDFramingBounds`).
   */
  radius: number;
}

function emptyBounds4(): Bounds4 {
  return {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    minZ: 0,
    maxZ: 0,
    minW: 0,
    maxW: 0,
  };
}

function emptyResult(): ChaosGame4Result {
  return {
    positions: new Float32Array(0),
    w: new Float32Array(0),
    transformIndices: new Uint8Array(0),
    count: 0,
    bounds: emptyBounds4(),
    center: [0, 0, 0, 0],
    radius: 0,
  };
}

/**
 * The per-run setup shared by every 4D chaos-game consumer — the 4D twin of
 * `chaos-game.ts`'s {@link import("./chaos-game").PreparedChaosGame}: composed
 * affines and variation blends (one pair per transform), the optional
 * final-transform lens, and the weighted-selection table. Building this once
 * per run — rather than recomputing it every iteration — is what lets both the
 * point-cloud recorder ({@link runChaosGame4}) and a future 4D histogram
 * accumulator drive the exact same tested stepping logic ({@link stepOrbit4},
 * {@link plotPoint4}) while each owns its own tight loop and output sink.
 *
 * UNLIKE {@link import("./chaos-game").PreparedChaosGame}, there is no
 * `postRotations`/`baseTransformCount` here: kaleidoscope symmetry (fr-6im) is
 * still 3D-only, so there is no expanded-copy bookkeeping to carry — every
 * slot IS a base transform, one-to-one with `transforms`.
 */
export interface PreparedChaosGame4 {
  /** Composed affine map per transform, indexed like `transforms`. */
  affines: Affine4[];
  /** Composed variation blend per transform, or `null` for a purely affine map. */
  variations: (VariationBlend4 | null)[];
  /** Composed final-transform affine (the plot-time lens), or `null` when absent. */
  finalAffine: Affine4 | null;
  /** Composed final-transform variation blend, or `null`. */
  finalWarp: VariationBlend4 | null;
  /** `transforms.length` — the draw range for the unweighted uniform pick in {@link pickIndex4}. */
  transformCount: number;
  /** Whether any transform has a non-1 weight — selects the weighted draw in {@link pickIndex4}. */
  weighted: boolean;
  /** Running sum of weights, indexed like `transforms`; binary-searched when `weighted`. */
  cumulative: Float64Array;
  /** Sum of all transform weights. */
  totalWeight: number;
}

/**
 * Compose a 4D transform set — and an optional final-transform lens — into a
 * {@link PreparedChaosGame4}: everything about a run that does not change
 * per-iteration. Call once per run and reuse the result for every
 * {@link stepOrbit4} / {@link plotPoint4} call in that run. Mirrors
 * `chaos-game.ts`'s `prepareChaosGame` one dimension up (see
 * {@link PreparedChaosGame4} for the one structural difference: no symmetry).
 *
 * Throws `RangeError` if `transforms.length` exceeds {@link MAX_TRANSFORMS}
 * (the Uint8 transform-index cap), matching `prepareChaosGame`'s message text
 * exactly.
 */
export function prepareChaosGame4(
  transforms: Transform4[],
  finalTransform: Transform4 | null = null,
): PreparedChaosGame4 {
  if (transforms.length > MAX_TRANSFORMS) {
    throw new RangeError(
      `IFS supports at most ${MAX_TRANSFORMS} transforms, got ${transforms.length}`,
    );
  }

  // Compose every affine once up front (never per-iteration). Alongside each,
  // its nonlinear variation blend or `null` for a purely-affine map — every
  // entry is `null` for the existing presets, so those take the exact same
  // (RNG-identical) path as before variations existed.
  const affines: Affine4[] = transforms.map(composeAffine4);
  const variations: (VariationBlend4 | null)[] = transforms.map((t) =>
    composeVariations4(t.variations),
  );
  const transformCount = affines.length;

  // The optional plot-time lens: one more affine + variation blend applied only
  // when a point is recorded, never fed back into the orbit. Both stay `null`
  // when there is no final transform, so `plotPoint4` keeps the pre-lens path.
  const finalAffine = finalTransform ? composeAffine4(finalTransform) : null;
  const finalWarp = finalTransform
    ? composeVariations4(finalTransform.variations)
    : null;

  // Weighted-selection table (see `chaos-game.ts`'s `pickIndex` for the same
  // discipline): when every weight is 1 we keep the plain uniform
  // `Math.floor(rng() * n)` draw in `pickIndex4`, so a uniform system consumes
  // the RNG identically to the obvious code; only a genuinely weighted system
  // pays for the cumulative table + binary search.
  const weights = transforms.map((t) => t.weight ?? 1);
  let totalWeight = 0;
  const cumulative = new Float64Array(transformCount);
  for (let i = 0; i < transformCount; i++) {
    totalWeight += weights[i];
    cumulative[i] = totalWeight;
  }
  const weighted =
    weights.some((wt) => wt !== 1) &&
    totalWeight > 0 &&
    Number.isFinite(totalWeight);

  return {
    affines,
    variations,
    finalAffine,
    finalWarp,
    transformCount,
    weighted,
    cumulative,
    totalWeight,
  };
}

/**
 * Smallest index whose cumulative weight exceeds `r = rng() * totalWeight`, or
 * the plain uniform draw `Math.floor(rng() * n)` when no transform has a
 * non-1 weight — the fast, RNG-identical path for the common unweighted case
 * (see {@link prepareChaosGame4}). Mirrors `chaos-game.ts`'s `pickIndex`
 * exactly, one dimension up (the pick itself has no dimension — it only ever
 * touches `prepared.transformCount`/`cumulative`/`totalWeight`).
 *
 * Exported so a future hand-inlined 4D hot loop (a `flame-gpu.ts`-style
 * accumulator) can pick a transform the exact same way {@link stepOrbit4}
 * does, without paying for `stepOrbit4`'s per-call `OrbitStep4` allocation.
 */
export function pickIndex4(prepared: PreparedChaosGame4, rng: Rng): number {
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

/** The orbit point (and the transform that produced it) after one {@link stepOrbit4} call. */
export interface OrbitStep4 {
  x: number;
  y: number;
  z: number;
  w: number;
  /** Index of the transform that produced this step (see `stepOrbit`'s caveat
   * about the escape-reseed case — the same caveat applies here). */
  index: number;
}

/**
 * Advance the 4D chaos-game orbit by one iteration: pick a random transform
 * (per `prepared`'s weights), apply its affine + variation, and reseed all
 * four coordinates if the landing point escapes to infinity. Pure: takes the
 * current orbit point and returns the next one plus the chosen transform
 * index, so a caller — the warmup loop, {@link runChaosGame4}'s recording
 * loop, or a future 4D histogram accumulator — carries the state forward
 * itself.
 *
 * Mirrors `chaos-game.ts`'s `stepOrbit` one dimension up: same pick, same
 * affine-then-variation order, same escape check (now over all four
 * coordinates), same reseed-all-coordinates recovery. There is no
 * symmetry/postRotation step (4D has none — see {@link PreparedChaosGame4}),
 * and `index` is always the raw picked index (no base-map modulo, since there
 * are no expanded kaleidoscope copies to recover from).
 *
 * `auxRng` (fr-2wfw) mirrors `stepOrbit`'s parameter of the same name — the
 * stream every iteration-local draw (a stochastic variation's coin flips,
 * the escape-reseed coordinates) comes from, defaulting to `rng` itself (the
 * original single-stream behavior, byte-identical for every existing
 * caller). See that doc for why a separate stream keeps morph samples
 * point-for-point correspondent.
 */
export function stepOrbit4(
  prepared: PreparedChaosGame4,
  x: number,
  y: number,
  z: number,
  w: number,
  rng: Rng,
  auxRng: Rng = rng,
): OrbitStep4 {
  const idx = pickIndex4(prepared, rng);
  const p = applyAffine4(prepared.affines[idx], x, y, z, w);
  const warp = prepared.variations[idx];
  let nx: number;
  let ny: number;
  let nz: number;
  let nw: number;
  if (warp === null) {
    nx = p[0];
    ny = p[1];
    nz = p[2];
    nw = p[3];
  } else {
    // Nonlinear maps can send a point to infinity — or, at a singularity, to
    // NaN. The reseed guard below catches both (NaN fails Number.isFinite),
    // stopping a bad landing from poisoning the rest of the orbit.
    const q = warp(p[0], p[1], p[2], p[3], auxRng);
    nx = q[0];
    ny = q[1];
    nz = q[2];
    nw = q[3];
  }
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
    nx = auxRng() - 0.5;
    ny = auxRng() - 0.5;
    nz = auxRng() - 0.5;
    nw = auxRng() - 0.5;
  }
  return { x: nx, y: ny, z: nz, w: nw, index: idx };
}

/**
 * Compute the plotted point for a 4D orbit point: the point itself, or — when
 * `prepared` has a final transform — that point bent through the
 * final-transform "lens" (fractal-flame terminology: applied only at plot
 * time, never fed back into the orbit; see {@link runChaosGame4}). Mirrors
 * `chaos-game.ts`'s `plotPoint` one dimension up: a nonlinear lens can diverge
 * at a singularity, so the bent point is only adopted while every one of the
 * four coordinates stays finite, otherwise this returns the orbit point
 * unchanged so a bad landing never produces NaN/Inf.
 *
 * `auxRng` (fr-2wfw) mirrors `plotPoint`'s parameter of the same name: the
 * stream a stochastic lens's own draws come from, defaulting to `rng` — the
 * original single-stream behavior.
 */
export function plotPoint4(
  prepared: PreparedChaosGame4,
  x: number,
  y: number,
  z: number,
  w: number,
  rng: Rng,
  auxRng: Rng = rng,
): Vec4 {
  const { finalAffine, finalWarp } = prepared;
  if (finalAffine === null) return [x, y, z, w];
  const p = applyAffine4(finalAffine, x, y, z, w);
  let fx = p[0];
  let fy = p[1];
  let fz = p[2];
  let fw = p[3];
  if (finalWarp !== null) {
    const q = finalWarp(fx, fy, fz, fw, auxRng);
    fx = q[0];
    fy = q[1];
    fz = q[2];
    fw = q[3];
  }
  if (
    Number.isFinite(fx) &&
    Number.isFinite(fy) &&
    Number.isFinite(fz) &&
    Number.isFinite(fw)
  ) {
    return [fx, fy, fz, fw];
  }
  return [x, y, z, w];
}

/**
 * Run a 4D iterated function system with the chaos game — the 4D sibling of
 * {@link import("./chaos-game").runChaosGame}. Starting from a random seed
 * point, repeatedly pick a random transform (weighted by
 * {@link Transform4.weight}), apply its composed affine and then its nonlinear
 * {@link composeVariations4} blend, and record each landing spot; the cloud
 * converges on the system's 4D attractor.
 *
 * An optional `finalTransform` is applied to every point *as it is plotted*
 * (fractal-flame terminology) — a lens over the whole cloud that never feeds
 * back into the orbit, exactly like the 3D path's final transform. Omit it (or
 * pass `null`) and the recording loop takes the same path, and consumes the RNG
 * identically, as without it.
 *
 * Pass a seeded {@link Rng} for reproducible output (tests); the app passes
 * `Math.random`. Returns an empty result (zero-length arrays, zero bounds,
 * origin center, radius 0) when there are no transforms or no points requested,
 * mirroring the 3D path — this early return happens BEFORE
 * {@link prepareChaosGame4} is called, so an empty system never pays for (or
 * risks) the `MAX_TRANSFORMS` check on an empty array. Throws `RangeError`
 * past {@link MAX_TRANSFORMS} (the Uint8 transform-index cap) via
 * {@link prepareChaosGame4}.
 *
 * An optional `iterationRng` (fr-2wfw) moves every iteration-local draw — a
 * stochastic variation's coin flips, the escape-reseed coordinates — onto a
 * per-iteration stream, mirroring `runChaosGame`'s parameter of the same
 * name; see that doc (and `rng.ts`'s `IterationRng`) for the
 * morph-correspondence rationale. Omitted, every draw shares `rng` — the
 * original behavior, byte-identical for every existing caller.
 *
 * The per-run setup ({@link prepareChaosGame4}) and per-iteration stepping
 * ({@link stepOrbit4}, {@link plotPoint4}) this function drives are exported so
 * another consumer — e.g. a future 4D histogram accumulator that needs the
 * same iteration logic but a different sink — can reuse them with its own
 * loop.
 */
export function runChaosGame4(
  transforms: Transform4[],
  numPoints: number,
  rng: Rng = Math.random,
  finalTransform: Transform4 | null = null,
  iterationRng?: IterationRng,
): ChaosGame4Result {
  if (transforms.length === 0 || numPoints <= 0) {
    return emptyResult();
  }

  const prepared = prepareChaosGame4(transforms, finalTransform);

  const positions = new Float32Array(numPoints * 3);
  const wBuffer = new Float32Array(numPoints);
  const transformIndices = new Uint8Array(numPoints);

  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;
  let w = rng() - 0.5;

  // The iteration-local stream (see the doc above): `aux` is `rng` itself in
  // the default single-stream mode, so every draw below stays byte-identical
  // to the original code; with an `iterationRng`, each iteration — warmup
  // and recording alike, numbered consecutively — rewinds it first.
  const aux = iterationRng ? iterationRng.draw : rng;

  // Warm up so the orbit settles onto the attractor before we start recording.
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    if (iterationRng) iterationRng.begin(i);
    const s = stepOrbit4(prepared, x, y, z, w, rng, aux);
    x = s.x;
    y = s.y;
    z = s.z;
    w = s.w;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minW = Infinity;
  let maxW = -Infinity;

  // Hand-inlined stepOrbit4 + plotPoint4 (mirrors flame-4d.ts's
  // accumulateFlame4 and voxel-4d.ts's accumulateVoxels4): at hundreds of
  // thousands to millions of points, the OrbitStep4 object and the two Vec4
  // arrays those functions allocate per call become real GC pressure.
  // Checked against the real stepOrbit4/plotPoint4 by the oracle test in
  // chaos-game-4d.test.ts ("allocation-free oracle"), so the two paths can
  // never silently drift apart.
  const { affines, variations, finalAffine, finalWarp } = prepared;

  for (let i = 0; i < numPoints; i++) {
    // --- inlined stepOrbit4(prepared, x, y, z, w, rng, aux) -----------------
    if (iterationRng) iterationRng.begin(WARMUP_ITERATIONS + i);
    const idx = pickIndex4(prepared, rng);
    const aff = affines[idx];
    const m = aff.m;
    const t = aff.t;
    const ax = m[0] * x + m[1] * y + m[2] * z + m[3] * w + t[0];
    const ay = m[4] * x + m[5] * y + m[6] * z + m[7] * w + t[1];
    const az = m[8] * x + m[9] * y + m[10] * z + m[11] * w + t[2];
    const aw = m[12] * x + m[13] * y + m[14] * z + m[15] * w + t[3];

    const warp = variations[idx];
    let nx: number;
    let ny: number;
    let nz: number;
    let nw: number;
    if (warp === null) {
      nx = ax;
      ny = ay;
      nz = az;
      nw = aw;
    } else {
      // Nonlinear maps can send a point to infinity — or, at a singularity,
      // to NaN. The reseed guard below catches both (NaN fails
      // Number.isFinite), stopping a bad landing from poisoning the orbit.
      const q = warp(ax, ay, az, aw, aux);
      nx = q[0];
      ny = q[1];
      nz = q[2];
      nw = q[3];
    }

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
      nx = aux() - 0.5;
      ny = aux() - 0.5;
      nz = aux() - 0.5;
      nw = aux() - 0.5;
    }
    x = nx;
    y = ny;
    z = nz;
    w = nw;

    // --- inlined plotPoint4(prepared, x, y, z, w, rng, aux) -----------------
    // The plotted point is the orbit point, optionally bent through the lens
    // (final transform's affine + warp). The orbit state x/y/z/w is left
    // untouched, so the lens never feeds back into the iteration.
    let px = x;
    let py = y;
    let pz = z;
    let pw = w;
    if (finalAffine !== null) {
      const fm = finalAffine.m;
      const ft = finalAffine.t;
      let fx = fm[0] * x + fm[1] * y + fm[2] * z + fm[3] * w + ft[0];
      let fy = fm[4] * x + fm[5] * y + fm[6] * z + fm[7] * w + ft[1];
      let fz = fm[8] * x + fm[9] * y + fm[10] * z + fm[11] * w + ft[2];
      let fw = fm[12] * x + fm[13] * y + fm[14] * z + fm[15] * w + ft[3];
      if (finalWarp !== null) {
        const q = finalWarp(fx, fy, fz, fw, aux);
        fx = q[0];
        fy = q[1];
        fz = q[2];
        fw = q[3];
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

    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
    wBuffer[i] = pw;
    // 4D has no symmetry-expanded copies (see PreparedChaosGame4's doc), so
    // the recorded index is always the raw picked slot — matching
    // stepOrbit4's own OrbitStep4.index exactly, including the
    // escape-reseed case (idx is the TRIGGERING transform, fixed before the
    // reseed branch above runs).
    transformIndices[i] = idx;

    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz;
    if (pz > maxZ) maxZ = pz;
    if (pw < minW) minW = pw;
    if (pw > maxW) maxW = pw;
  }

  const center: Vec4 = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
    (minW + maxW) / 2,
  ];

  // Second pass: the EXACT max Euclidean distance from center (see `radius`
  // doc). Reads the Float32-rounded values we actually emitted, so the radius
  // genuinely bounds the stored cloud rather than the pre-rounding orbit.
  let radiusSq = 0;
  for (let i = 0; i < numPoints; i++) {
    const dx = positions[i * 3] - center[0];
    const dy = positions[i * 3 + 1] - center[1];
    const dz = positions[i * 3 + 2] - center[2];
    const dw = wBuffer[i] - center[3];
    const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
    if (d2 > radiusSq) radiusSq = d2;
  }
  const radius = Math.sqrt(radiusSq);

  return {
    positions,
    w: wBuffer,
    transformIndices,
    count: numPoints,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ, minW, maxW },
    center,
    radius,
  };
}
