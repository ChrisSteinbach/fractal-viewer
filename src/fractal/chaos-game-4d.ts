import {
  applyAffine4,
  composeAffine4,
  symmetryRotation4,
  toTransform4,
} from "./affine4";
import type { Affine4 } from "./affine4";
import {
  CHAOS_SUB_ORBIT_POINTS,
  DEFAULT_COLOR_SPEED,
  ESCAPE_LIMIT,
  MAX_TRANSFORMS,
  WARMUP_ITERATIONS,
  buildChaosSelection,
  buildScheduleTable,
  chaosPointIteration,
  chaosRefuseIteration,
  derivedColorIndex,
  effectiveSymmetryOrder,
  pickScheduleIndex,
  resolveScheduleDepth,
} from "./chaos-game";
import { composeVariations4 } from "./variations4";
import type { VariationBlend4 } from "./variations4";
import type { IterationRng, Rng } from "./rng";
import type {
  Bounds4,
  HybridSchedule,
  SymmetryParams,
  Transform4,
  Vec4,
} from "./types";

/**
 * # 4D chaos game (born as a points-mode spike; variations, shear and the
 * lens followed, then the prepared seams the 4D renders needed)
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
 * identically, as before those were added (the blend/lens are `null`).
 *
 * It carries the kaleidoscope too (`symmetry`, defaulting to the order-1
 * identity): a 4D simple rotation fixes a PLANE where a 3D one fixes an
 * axis, and 4D additionally admits the DOUBLE rotation a
 * {@link SymmetryParams.twist} asks for — two orthogonal planes turning at
 * once, which has no 3D counterpart. `affine4.ts`'s {@link symmetryRotation4}
 * generates both, and reproduces the 3D `symmetryRotation` entry for entry on
 * the three w-free planes at twist 0, so a flat system's kaleidoscope survives
 * being routed through this path unchanged.
 *
 * For the 4D flame/solid renders, the per-run setup and per-iteration
 * stepping are hoisted into their own exported seams —
 * {@link prepareChaosGame4}, {@link pickIndex4},
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
   * amplitude.
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
  /** Exact maximum distance from the 4D ORIGIN over every emitted point.
   * Unlike {@link radius}, this is the origin-centred full-cloud ball the
   * Solid balloon needs to mirror `balloonBall4`: slice-independent, so its
   * shell cannot pulse or resize with the frozen slice snapshot. Computed in
   * the same second pass as `radius`, with no extra worker traversal. */
  originRadius: number;
}

/** {@link prepareChaosGame4}'s default `symmetry`, mirroring `chaos-game.ts`'s
 * `NO_SYMMETRY`: order 1 is the identity (today's unreplicated system) for any
 * plane and any twist, so every existing caller that omits the parameter gets
 * byte-identical behavior. */
const NO_SYMMETRY4: SymmetryParams = { order: 1, plane: "xz" };

/**
 * The prepared post-word stage one dimension up — `chaos-game.ts`'s
 * `PreparedSchedule` with 4D affines. The weight table fields are
 * STRUCTURALLY the 3D shape on purpose: `pickScheduleIndex` (the one shared
 * pick — selection has no dimension) reads them directly, so a system and
 * its 4D lift draw B identically.
 */
export interface PreparedSchedule4 {
  /** System B's composed 4D affine per entry — the document's flat 3D maps
   * lifted through `toTransform4` once at prepare (see
   * {@link prepareSchedule4}). */
  affines: Affine4[];
  /** Running sum of B weights — `pickScheduleIndex`'s `cumulative` shape. */
  cumulative: Float64Array;
  /** Sum of all B weights. */
  totalWeight: number;
  /** Whether any B entry has a non-1 weight. */
  weighted: boolean;
  /** `schedule.transforms.length` — the uniform draw range. */
  count: number;
  /** The word length k. */
  depth: number;
}

/**
 * Compose the DOCUMENT's schedule block into a 4D prepared stage, or `null`
 * for an absent/empty block — `chaos-game.ts`'s `prepareSchedule` one
 * dimension up. The wire stays one shape for both paths (the cloud
 * request's own rule): B is authored as flat 3D `Transform`s, and this lift
 * runs `toTransform4` ONCE at prepare — a flat B embeds with `w` riding
 * through untouched (scaled by the embed's derived `scale_w`, exactly as
 * any flat map lifts), so the post-word bends the 4D plotted point without
 * collapsing its `w`. The weight table is built by the ONE shared
 * `buildScheduleTable`, and the depth domain by the ONE shared
 * `resolveScheduleDepth`, so the two dimensions cannot disagree on what a
 * block means.
 */
export function prepareSchedule4(
  schedule: HybridSchedule | null | undefined,
): PreparedSchedule4 | null {
  const depth = resolveScheduleDepth(schedule);
  if (depth === 0 || !schedule) return null;
  const table = buildScheduleTable(schedule.transforms);
  return {
    affines: schedule.transforms.map((t) => composeAffine4(toTransform4(t))),
    cumulative: table.cumulative,
    totalWeight: table.totalWeight,
    weighted: table.weighted,
    count: table.count,
    depth,
  };
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
    originRadius: 0,
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
  /**
   * The draw range for the unweighted uniform pick in {@link pickIndex4}:
   * every rotated-copy SLOT, not just the base maps — `baseTransformCount *
   * effectiveSymmetryOrder(...)`. Equal to `baseTransformCount` at symmetry
   * order 1 (see {@link baseTransformCount}).
   */
  transformCount: number;
  /**
   * `transforms.length` — the number of BASE (un-rotated) maps, i.e. the
   * length `affines`/`variations`/`postRotations` would have with no
   * symmetry. A {@link pickIndex4} draw (0..`transformCount` - 1) recovers
   * the "logical" map it came from via `idx % baseTransformCount` — see
   * {@link stepOrbit4} — which is what per-transform coloring and the
   * editor's selection must key on to keep meaning "logical map" rather than
   * "which kaleidoscope copy". Equal to `transformCount` at symmetry order 1.
   */
  baseTransformCount: number;
  /** Whether any transform has a non-1 weight — selects the weighted draw in {@link pickIndex4}. */
  weighted: boolean;
  /** Running sum of weights, indexed like `transforms`; binary-searched when `weighted`. */
  cumulative: Float64Array;
  /** Sum of all transform weights. */
  totalWeight: number;
  /**
   * Graph-directed selection rows, or `null` for a system with no
   * non-trivial chi — `chaos-game.ts`'s `PreparedChaosGame.chaosRows`
   * verbatim (selection is dimension-agnostic; both prepares build these
   * through the ONE shared `buildChaosSelection`).
   */
  chaosRows: Float64Array[] | null;
  /** Per-row weighted totals — see `PreparedChaosGame.chaosRowTotals`. */
  chaosRowTotals: Float64Array | null;
  /** Degenerate-row record — see `PreparedChaosGame.chaosFallbackRows`. */
  chaosFallbackRows: number[] | null;
  /**
   * Row-major 4x4 rotation applied AFTER a slot's affine + variation output
   * (the 4D kaleidoscope copies — `chaos-game.ts`'s 3x3
   * `PreparedChaosGame.postRotations` one dimension up), indexed like
   * `affines`/`variations`, or `null` for an unrotated slot — every slot at
   * symmetry order 1, and every copy-0 slot at any order, so the RNG stream
   * and every coordinate stay byte-identical to the pre-symmetry code path
   * exactly where there is nothing to rotate. See {@link stepOrbit4}.
   */
  postRotations: (number[] | null)[];
  /**
   * The scheduled-hybrid post-word stage ({@link prepareSchedule4}), or
   * `null` for a document with no schedule block — `chaos-game.ts`'s
   * `PreparedChaosGame.schedule` one dimension up, consumed at PLOT time
   * only by {@link plotPoint4} and the hand-inlined 4D mirrors.
   */
  schedule: PreparedSchedule4 | null;
  /**
   * Resolved flame palette slot per BASE map — length
   * {@link baseTransformCount}, indexed by `idx % baseTransformCount`, never
   * by the expanded slot: every kaleidoscope copy of a map colors as that
   * map. Each entry is the transform's own `colorIndex` or `chaos-game.ts`'s
   * `derivedColorIndex` spread; read by the two structural-coloring hot loops
   * this prepared object drives — `flame-4d.ts`'s `accumulateFlame4` and
   * `voxel-4d.ts`'s `accumulateVoxels4`.
   */
  colorIndex: Float64Array;
  /**
   * Resolved flame color speed per BASE map, the companion to
   * {@link colorIndex}: the transform's own `colorSpeed` or `chaos-game.ts`'s
   * `DEFAULT_COLOR_SPEED`. Same indexing, same two readers.
   */
  colorSpeed: Float64Array;
}

/**
 * Compose a 4D transform set — and an optional final-transform lens — into a
 * {@link PreparedChaosGame4}: everything about a run that does not change
 * per-iteration. Call once per run and reuse the result for every
 * {@link stepOrbit4} / {@link plotPoint4} call in that run. Mirrors
 * `chaos-game.ts`'s `prepareChaosGame` one dimension up.
 *
 * `symmetry` (defaults to order 1, the identity) replicates every
 * base map `effectiveSymmetryOrder(symmetry.order, transforms.length)` times,
 * copy `k` rotated by `2π·k / order` in `symmetry.plane` — plus
 * `2π·k·twist / order` in the plane orthogonal to it, the second angle of a 4D
 * DOUBLE rotation (`affine4.ts`'s {@link symmetryRotation4}). See
 * {@link stepOrbit4} for where that rotation is actually applied. At order 1
 * (any plane, any twist) this expansion is a no-op: exactly one (unrotated)
 * copy of each base map, so every existing caller that omits `symmetry` gets a
 * byte-identical `PreparedChaosGame4` to before this parameter existed.
 * `symmetry.blend` (default 1) scales the rotated copies' selection
 * weights, continuously fading the kaleidoscope between full strength (1) and
 * bit-identical-to-order-1 (0) — see the weight-table comment below.
 *
 * `schedule` (default `null`) is the scheduled-hybrid post-word block —
 * the DOCUMENT's flat 3D form, lifted here through {@link prepareSchedule4}
 * (the cloud request's own one-wire-shape rule); an absent/empty block
 * prepares to `null` and the whole run is byte-identical to before the
 * parameter existed.
 *
 * Throws `RangeError` if `transforms.length` exceeds {@link MAX_TRANSFORMS}
 * (the Uint8 transform-index cap), matching `prepareChaosGame`'s message text
 * exactly — and, like it, independent of `symmetry`, which instead silently
 * reduces its own effective order to fit that same cap on the EXPANDED count
 * (see {@link effectiveSymmetryOrder}).
 */
export function prepareChaosGame4(
  transforms: Transform4[],
  finalTransform: Transform4 | null = null,
  symmetry: SymmetryParams = NO_SYMMETRY4,
  schedule: HybridSchedule | null = null,
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
  const baseTransformCount = transforms.length;
  const baseAffines: Affine4[] = transforms.map(composeAffine4);
  const baseVariations: (VariationBlend4 | null)[] = transforms.map((t) =>
    composeVariations4(t.variations),
  );

  // The optional plot-time lens: one more affine + variation blend applied only
  // when a point is recorded, never fed back into the orbit. Both stay `null`
  // when there is no final transform, so `plotPoint4` keeps the pre-lens path.
  const finalAffine = finalTransform ? composeAffine4(finalTransform) : null;
  const finalWarp = finalTransform
    ? composeVariations4(finalTransform.variations)
    : null;

  // Expand into one prepared SLOT per (copy, base map) pair, slot k*n+i —
  // copy 0 first (unrotated), then copy 1, etc. — so `idx % baseTransformCount`
  // always recovers base index i regardless of how many copies exist. Copy 0's
  // rotation is always null (not just an identity matrix) and, at order 1,
  // it's the ONLY copy, so this loop degenerates to exactly the pre-symmetry
  // affines/variations arrays — same values, same order, same RNG behavior.
  const order = effectiveSymmetryOrder(symmetry.order, baseTransformCount);
  const twist = symmetry.twist ?? 0;
  const affines: Affine4[] = [];
  const variations: (VariationBlend4 | null)[] = [];
  const postRotations: (number[] | null)[] = [];
  for (let k = 0; k < order; k++) {
    const post =
      k === 0
        ? null
        : symmetryRotation4(symmetry.plane, (2 * Math.PI * k) / order, twist);
    for (let i = 0; i < baseTransformCount; i++) {
      affines.push(baseAffines[i]);
      variations.push(baseVariations[i]);
      postRotations.push(post);
    }
  }
  const transformCount = affines.length;

  // Weighted-selection table (see `chaos-game.ts`'s `pickIndex` for the same
  // discipline): each slot inherits its BASE map's weight, so `pickIndex4`'s
  // draw over the full expanded list gives every copy an equal share of its
  // base map's total probability mass. When every weight is 1 we keep the
  // plain uniform `Math.floor(rng() * n)` draw, so a uniform system consumes
  // the RNG identically to the obvious code; only a genuinely weighted system
  // pays for the cumulative table + binary search.
  //
  // `symmetry.blend` additionally scales every ROTATED copy's slot
  // (never copy 0), continuously thinning the kaleidoscope: at its default 1
  // the weights — and thus the `weighted` flag and the whole draw — are
  // untouched, and at 0 the copies' zero-width cumulative segments can never
  // win a draw, rendering bit-identically to order 1 (the lower-bound search
  // over uniform base weights lands exactly where the uniform draw does).
  const copyBlend = Math.min(1, Math.max(0, symmetry.blend ?? 1));
  const weights = new Array<number>(transformCount);
  for (let s = 0; s < transformCount; s++) {
    const base = transforms[s % baseTransformCount].weight ?? 1;
    weights[s] = s < baseTransformCount ? base : base * copyBlend;
  }
  let totalWeight = 0;
  const cumulative = new Float64Array(transformCount);
  for (let s = 0; s < transformCount; s++) {
    totalWeight += weights[s];
    cumulative[s] = totalWeight;
  }
  const weighted =
    weights.some((wt) => wt !== 1) &&
    totalWeight > 0 &&
    Number.isFinite(totalWeight);

  // Graph-directed selection (chi), through the ONE shared
  // buildChaosSelection — a Transform4's row rides the 3D → 4D lift
  // verbatim, and selection has no dimension, so sharing the builder is
  // what keeps a system and its lift drawing from the same graph.
  const chaos = buildChaosSelection(transforms, weights, baseTransformCount);

  // Flame structural-coloring slots, resolved per BASE map — the
  // kaleidoscope copies deliberately get no entries of their own, since
  // `flame-4d.ts` looks them up by `idx % baseTransformCount`.
  const colorIndex = new Float64Array(baseTransformCount);
  const colorSpeed = new Float64Array(baseTransformCount);
  for (let i = 0; i < baseTransformCount; i++) {
    colorIndex[i] =
      transforms[i].colorIndex ?? derivedColorIndex(i, baseTransformCount);
    colorSpeed[i] = transforms[i].colorSpeed ?? DEFAULT_COLOR_SPEED;
  }

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
    chaosRows: chaos ? chaos.chaosRows : null,
    chaosRowTotals: chaos ? chaos.chaosRowTotals : null,
    chaosFallbackRows: chaos ? chaos.chaosFallbackRows : null,
    postRotations,
    schedule: prepareSchedule4(schedule),
    colorIndex,
    colorSpeed,
  };
}

/**
 * Smallest index whose cumulative weight exceeds `r = rng() * totalWeight`, or
 * the plain uniform draw `Math.floor(rng() * n)` when no transform has a
 * non-1 weight — the fast, RNG-identical path for the common unweighted case
 * (see {@link prepareChaosGame4}). Mirrors `chaos-game.ts`'s `pickIndex`
 * exactly, one dimension up (the pick itself has no dimension — it only ever
 * touches `prepared.transformCount`/`cumulative`/`totalWeight`), including
 * `prevBase`: the graph-directed row draw, the degenerate-row fallback, and
 * the exactly-one-`rng()`-draw discipline are that function's, word for word
 * — see its doc.
 *
 * Exported so a future hand-inlined 4D hot loop (a `flame-gpu.ts`-style
 * accumulator) can pick a transform the exact same way {@link stepOrbit4}
 * does, without paying for `stepOrbit4`'s per-call `OrbitStep4` allocation.
 */
export function pickIndex4(
  prepared: PreparedChaosGame4,
  rng: Rng,
  prevBase = -1,
): number {
  const { chaosRows, chaosRowTotals } = prepared;
  if (chaosRows !== null && chaosRowTotals !== null && prevBase >= 0) {
    const rowTotal = chaosRowTotals[prevBase];
    if (rowTotal > 0 && Number.isFinite(rowTotal)) {
      const row = chaosRows[prevBase];
      const r = rng() * rowTotal;
      let lo = 0;
      let hi = row.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (r < row[mid]) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    }
    // Degenerate row: fall through to the global table — one draw either way.
  }
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
  /** Whether this step escape-reseeded — `chaos-game.ts`'s
   * `OrbitStep.escaped`, same chi-threading contract (`next prevBase =
   * escaped ? -1 : index`). Chi-free callers can ignore it. */
  escaped: boolean;
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
 * affine-then-variation order, same post-rotation position, same escape check
 * (now over all four coordinates), same reseed-all-coordinates recovery.
 *
 * Symmetry: when `prepared` has rotated copies, the picked slot's
 * `postRotations` entry — the copy's 4x4 rotation, applied to the map's FULL
 * affine + variation output — bends the landing point before the escape
 * check, since that rotated point is what actually feeds back into the orbit.
 * `null` (every slot at symmetry order 1, and every unrotated copy-0 slot at
 * any order) skips this step entirely, so the RNG stream and every coordinate
 * stay byte-identical to the pre-symmetry code path exactly where there is
 * nothing to rotate. The returned `index` is always the BASE map index
 * (`idx % prepared.baseTransformCount`), never the expanded slot, so
 * per-transform coloring and the editor's selection keep meaning "logical
 * map" regardless of which kaleidoscope copy actually fired.
 *
 * `auxRng` mirrors `stepOrbit`'s parameter of the same name — the
 * stream every iteration-local draw (a stochastic variation's coin flips,
 * the escape-reseed coordinates) comes from, defaulting to `rng` itself (the
 * original single-stream behavior, byte-identical for every existing
 * caller). See that doc for why a separate stream keeps morph samples
 * point-for-point correspondent.
 *
 * `prevBase` mirrors `stepOrbit`'s parameter of the same name — the
 * graph-directed selection state the CALLER threads (`next = step.escaped ?
 * -1 : step.index`); `-1` (the default) is the entry pick, and with no chi
 * rows the parameter is inert.
 */
export function stepOrbit4(
  prepared: PreparedChaosGame4,
  x: number,
  y: number,
  z: number,
  w: number,
  rng: Rng,
  auxRng: Rng = rng,
  prevBase = -1,
): OrbitStep4 {
  const idx = pickIndex4(prepared, rng, prevBase);
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
  const post = prepared.postRotations[idx];
  if (post !== null) {
    const rx = post[0] * nx + post[1] * ny + post[2] * nz + post[3] * nw;
    const ry = post[4] * nx + post[5] * ny + post[6] * nz + post[7] * nw;
    const rz = post[8] * nx + post[9] * ny + post[10] * nz + post[11] * nw;
    const rw = post[12] * nx + post[13] * ny + post[14] * nz + post[15] * nw;
    nx = rx;
    ny = ry;
    nz = rz;
    nw = rw;
  }
  let escaped = false;
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
    escaped = true;
  }
  return {
    x: nx,
    y: ny,
    z: nz,
    w: nw,
    index: idx % prepared.baseTransformCount,
    escaped,
  };
}

/**
 * Compute the plotted point for a 4D orbit point: the point itself,
 * optionally bent by the scheduled-hybrid POST-WORD and then — when
 * `prepared` has a final transform — by the final-transform "lens"
 * (fractal-flame terminology: applied only at plot time, never fed back into
 * the orbit; see {@link runChaosGame4}). Mirrors `chaos-game.ts`'s
 * `plotPoint` one dimension up, stage for stage: the post-word runs FIRST
 * (`depth` B-picks, each EXACTLY ONE draw from the PRIMARY `rng` through the
 * one shared `pickScheduleIndex`, the word computed unconditionally and
 * adopted only while all four coordinates stay finite — on non-finite it
 * falls back to the point BEFORE the word), THEN the lens bends the result,
 * with its own adopt-only-if-finite rule.
 *
 * `auxRng` mirrors `plotPoint`'s parameter of the same name: the
 * stream a stochastic lens's own draws come from, defaulting to `rng` — the
 * original single-stream behavior. Affine B-maps draw nothing themselves.
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
  const { finalAffine, finalWarp, schedule } = prepared;
  let px = x;
  let py = y;
  let pz = z;
  let pw = w;
  if (schedule !== null) {
    let sx = px;
    let sy = py;
    let sz = pz;
    let sw = pw;
    for (let d = 0; d < schedule.depth; d++) {
      const b = schedule.affines[pickScheduleIndex(schedule, rng)];
      const m = b.m;
      const t = b.t;
      const nx = m[0] * sx + m[1] * sy + m[2] * sz + m[3] * sw + t[0];
      const ny = m[4] * sx + m[5] * sy + m[6] * sz + m[7] * sw + t[1];
      const nz = m[8] * sx + m[9] * sy + m[10] * sz + m[11] * sw + t[2];
      const nw = m[12] * sx + m[13] * sy + m[14] * sz + m[15] * sw + t[3];
      sx = nx;
      sy = ny;
      sz = nz;
      sw = nw;
    }
    if (
      Number.isFinite(sx) &&
      Number.isFinite(sy) &&
      Number.isFinite(sz) &&
      Number.isFinite(sw)
    ) {
      px = sx;
      py = sy;
      pz = sz;
      pw = sw;
    }
  }
  if (finalAffine === null) return [px, py, pz, pw];
  const p = applyAffine4(finalAffine, px, py, pz, pw);
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
  return [px, py, pz, pw];
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
 * An optional `symmetry` (defaults to order 1, the identity) draws
 * from `effectiveSymmetryOrder(symmetry.order, transforms.length)` rotated
 * copies of the transform set instead of just the base maps — see
 * {@link prepareChaosGame4}. `transformIndices` still records the BASE map
 * index regardless, so per-transform coloring is unaffected. It sits in the
 * same positional slot `runChaosGame` gives it, so the two signatures stay
 * readable side by side.
 *
 * An optional `iterationRng` moves every iteration-local draw — a
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
  symmetry: SymmetryParams = NO_SYMMETRY4,
  iterationRng?: IterationRng,
  schedule: HybridSchedule | null = null,
): ChaosGame4Result {
  if (transforms.length === 0 || numPoints <= 0) {
    return emptyResult();
  }

  const prepared = prepareChaosGame4(
    transforms,
    finalTransform,
    symmetry,
    schedule,
  );

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

  // Graph-directed selection state — see runChaosGame's identical threading
  // (inert without chi rows, byte-identical stream either way).
  const chaosOn = prepared.chaosRows !== null;
  let prevBase = -1;

  // Warm up so the orbit settles onto the attractor before we start recording.
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    if (iterationRng) iterationRng.begin(i);
    const s = stepOrbit4(prepared, x, y, z, w, rng, aux, prevBase);
    x = s.x;
    y = s.y;
    z = s.z;
    w = s.w;
    prevBase = s.escaped ? -1 : s.index;
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
  const { affines, variations, postRotations, finalAffine, finalWarp } =
    prepared;
  const { baseTransformCount, schedule: preparedSchedule } = prepared;

  for (let i = 0; i < numPoints; i++) {
    // Sub-orbit re-fuse — runChaosGame's chi block, four coordinates (see
    // chaos-game.ts's CHAOS_SUB_ORBIT_POINTS): reseed from the aux stream,
    // reset to the entry pick, warm up unrecorded, iteration numbers a pure
    // function of the plotted-point index.
    if (chaosOn && i > 0 && i % CHAOS_SUB_ORBIT_POINTS === 0) {
      const sub = i / CHAOS_SUB_ORBIT_POINTS;
      if (iterationRng) iterationRng.begin(chaosRefuseIteration(sub));
      x = aux() - 0.5;
      y = aux() - 0.5;
      z = aux() - 0.5;
      w = aux() - 0.5;
      prevBase = -1;
      for (let k = 0; k < WARMUP_ITERATIONS; k++) {
        if (iterationRng) {
          iterationRng.begin(chaosRefuseIteration(sub) + 1 + k);
        }
        const s = stepOrbit4(prepared, x, y, z, w, rng, aux, prevBase);
        x = s.x;
        y = s.y;
        z = s.z;
        w = s.w;
        prevBase = s.escaped ? -1 : s.index;
      }
    }
    // --- inlined stepOrbit4(prepared, x, y, z, w, rng, aux) -----------------
    if (iterationRng) {
      iterationRng.begin(
        chaosOn ? chaosPointIteration(i) : WARMUP_ITERATIONS + i,
      );
    }
    const idx = pickIndex4(prepared, rng, prevBase);
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

    // Symmetry: rotate this slot's FULL affine + variation output —
    // see stepOrbit4, which this mirrors exactly. `null` (order 1, and every
    // unrotated copy-0 slot at any order) skips this, so the orbit stays
    // byte-identical to the pre-symmetry loop exactly where there is nothing
    // to rotate.
    const post = postRotations[idx];
    if (post !== null) {
      const rx = post[0] * nx + post[1] * ny + post[2] * nz + post[3] * nw;
      const ry = post[4] * nx + post[5] * ny + post[6] * nz + post[7] * nw;
      const rz = post[8] * nx + post[9] * ny + post[10] * nz + post[11] * nw;
      const rw = post[12] * nx + post[13] * ny + post[14] * nz + post[15] * nw;
      nx = rx;
      ny = ry;
      nz = rz;
      nw = rw;
    }

    let escaped = false;
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
      escaped = true;
    }
    x = nx;
    y = ny;
    z = nz;
    w = nw;
    // Selection state for the next pick — stepOrbit4's escaped/index
    // contract exactly. Inert without chi rows.
    prevBase = escaped ? -1 : idx % baseTransformCount;

    // --- inlined plotPoint4(prepared, x, y, z, w, rng, aux) -----------------
    // The plotted point is the orbit point, optionally bent by the schedule's
    // post-word and then through the lens (final transform's affine + warp).
    // The orbit state x/y/z/w is left untouched, so neither stage ever feeds
    // back into the iteration.
    let px = x;
    let py = y;
    let pz = z;
    let pw = w;
    if (preparedSchedule !== null) {
      // The post-word: depth B-picks off the PRIMARY stream (one draw per
      // level, plotPoint4's rigidity rule), adopted only while finite.
      let sx = px;
      let sy = py;
      let sz = pz;
      let sw = pw;
      for (let d = 0; d < preparedSchedule.depth; d++) {
        const b =
          preparedSchedule.affines[pickScheduleIndex(preparedSchedule, rng)];
        const bm = b.m;
        const bt = b.t;
        const nx = bm[0] * sx + bm[1] * sy + bm[2] * sz + bm[3] * sw + bt[0];
        const ny = bm[4] * sx + bm[5] * sy + bm[6] * sz + bm[7] * sw + bt[1];
        const nz = bm[8] * sx + bm[9] * sy + bm[10] * sz + bm[11] * sw + bt[2];
        const nw =
          bm[12] * sx + bm[13] * sy + bm[14] * sz + bm[15] * sw + bt[3];
        sx = nx;
        sy = ny;
        sz = nz;
        sw = nw;
      }
      if (
        Number.isFinite(sx) &&
        Number.isFinite(sy) &&
        Number.isFinite(sz) &&
        Number.isFinite(sw)
      ) {
        px = sx;
        py = sy;
        pz = sz;
        pw = sw;
      }
    }
    if (finalAffine !== null) {
      const fm = finalAffine.m;
      const ft = finalAffine.t;
      let fx = fm[0] * px + fm[1] * py + fm[2] * pz + fm[3] * pw + ft[0];
      let fy = fm[4] * px + fm[5] * py + fm[6] * pz + fm[7] * pw + ft[1];
      let fz = fm[8] * px + fm[9] * py + fm[10] * pz + fm[11] * pw + ft[2];
      let fw = fm[12] * px + fm[13] * py + fm[14] * pz + fm[15] * pw + ft[3];
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
    // The BASE map this slot is a (possibly rotated) copy of — see
    // PreparedChaosGame4.baseTransformCount — matching stepOrbit4's own
    // OrbitStep4.index exactly, including the escape-reseed case (idx is the
    // TRIGGERING transform, fixed before the reseed branch above runs).
    transformIndices[i] = idx % baseTransformCount;

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
  let originRadiusSq = 0;
  for (let i = 0; i < numPoints; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];
    const pw = wBuffer[i];
    const dx = px - center[0];
    const dy = py - center[1];
    const dz = pz - center[2];
    const dw = pw - center[3];
    const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
    if (d2 > radiusSq) radiusSq = d2;
    const originD2 = px * px + py * py + pz * pz + pw * pw;
    if (originD2 > originRadiusSq) originRadiusSq = originD2;
  }
  const radius = Math.sqrt(radiusSq);
  const originRadius = Math.sqrt(originRadiusSq);

  return {
    positions,
    w: wBuffer,
    transformIndices,
    count: numPoints,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ, minW, maxW },
    center,
    radius,
    originRadius,
  };
}
