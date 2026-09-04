import { applyAffine, composeAffine, rotationMatrixXYZ } from "./affine";
import type { Affine } from "./affine";
import { prepareShapeSampler } from "./shapes";
import type { ShapeSpec } from "./shapes";
import { MissingMeshAssetError } from "./mesh-shapes";
import { composeVariations } from "./variations";
import type { VariationBlend } from "./variations";
import { mulberry32 } from "./rng";
import type { IterationRng, Rng } from "./rng";
import {
  createPointTilingPointsState,
  pointTilingPointsAttemptLimit,
  visitPointTilingPointsAttemptBounded,
} from "./point-tiling";
import type { PointTilingPlan, PointTilingPointsState } from "./point-tiling";
import type {
  Bounds,
  HybridSchedule,
  SymmetryParams,
  Transform,
  Vec3,
} from "./types";

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

/** Points-only tiled recording result. Image positions and canonical source
 * positions are parallel arrays: every image copies the plotted source that
 * supplied its transform/color attribution. */
export interface TiledChaosGameResult extends ChaosGameResult {
  /** Canonical post-schedule/post-lens xyz copied once per emitted image. */
  canonicalPositions: Float32Array;
  /** Bounds of those canonical positions, independent of replicated images. */
  canonicalBounds: Bounds;
  /** Deterministic equal-density selection state at the terminal cap. */
  pointTilingState: PointTilingPointsState;
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

/**
 * Plotted points per chaos SUB-ORBIT under graph-directed selection (chi
 * rows — see {@link systemHasChaos}). With a block-diagonal chi a single
 * orbit NEVER leaves the block its entry pick landed in, and every consumer
 * runs one orbit for its whole output — so without re-fusing, an "isolated"
 * two-system document would render exactly one of its systems. Every
 * chi-consuming loop therefore re-fuses each `CHAOS_SUB_ORBIT_POINTS`
 * plotted points: a fresh seed point drawn from the ITERATION-LOCAL (aux)
 * stream — three draws there, so the primary stream keeps its exactly-one-
 * draw-per-pick rigidity — `prevBase` reset to `-1` (a fresh ENTRY pick),
 * then {@link WARMUP_ITERATIONS} unrecorded warm-up steps, exactly like the
 * run's own opening fuse (flam3's fuse, re-run per batch). 4096 keeps the
 * re-fuse overhead ~2.5% of iterations while sampling every block thousands
 * of times per render.
 *
 * THE ENTRY PICK (prevBase −1) USES THE EXISTING GLOBAL TABLE — a deliberate
 * deviation from "re-pick the entry base uniformly": for unit weights the
 * global table IS the uniform draw (byte-identically), for weighted systems
 * it honors the authored weights (a fern block whose maps sum to weight 100
 * gets its authored share of sub-orbits), and it reaches every
 * positive-weight block with positive probability, which is all the
 * isolation invariant needs. An escape-reseed re-fuses the entry pick the
 * same way (prevBase resets to −1; flam3 re-fuses) without the warm-up —
 * the reseed is a safety net, not a scheduled boundary.
 *
 * The chi-absent path never re-fuses and is byte-identical to before chi
 * existed: same stream, same output, zero extra draws.
 */
export const CHAOS_SUB_ORBIT_POINTS = 4096;

/** `prepareChaosGame`'s default `symmetry`: order 1 is the identity (today's
 * unreplicated system) for any plane, so every existing caller that omits the
 * parameter gets byte-identical behavior. */
const NO_SYMMETRY: SymmetryParams = { order: 1, plane: "xz" };

/**
 * A transform's structural color speed when it authors none
 * (`Transform.colorSpeed` absent): the halfway blend `c ← (c + slot) / 2` that
 * every flame AND solid render used before the field existed (both walk the
 * same coordinate; see `PreparedChaosGame.colorIndex`'s two readers).
 * In flam3 terms this is `color_speed 0.5` ⇔ the legacy `symmetry 0` —
 * flam3's own default too.
 */
export const DEFAULT_COLOR_SPEED = 0.5;

/**
 * The palette slot a transform falls back on when it authors no
 * `Transform.colorIndex`: map `index` of `count` spread evenly over
 * the `[0, 1]` gradient, `0.5` for a lone map (there is no "spread" to speak
 * of, and `0 / 0` would not be one). This is the ONE definition of that
 * derived slot — {@link prepareChaosGame}, `chaos-game-4d.ts`'s
 * {@link import("./chaos-game-4d").prepareChaosGame4}, both WGSL packers
 * (`flame-gpu.ts` / `flame-gpu-4d.ts`), `morph.ts`'s absent-side fallback and
 * the transform editor's readout all resolve through it, so a flame's colors
 * cannot drift between the CPU oracle, the GPU kernel and the UI.
 *
 * `count` is the number of BASE maps — `PreparedChaosGame.baseTransformCount`
 * in 3D and `PreparedChaosGame4.baseTransformCount` in 4D (the 4D path has
 * its own kaleidoscope): every rotated copy of a map shares that map's slot,
 * in either dimension.
 */
export function derivedColorIndex(index: number, count: number): number {
  return count > 1 ? index / (count - 1) : 0.5;
}

/**
 * Resolve one authored chaos-row entry to its consumption value — the ONE
 * definition of the chi domain (see {@link import("./types").Transform.chaos}):
 * absent (an absent row, or a row shorter than the base count) and non-finite
 * both read as `1` (the non-finite arm is defense only — `persist.ts` drops
 * malformed rows before they reach a document), and a finite value clamps to
 * `>= 0` (a negative scale has no probability meaning). The domain lives HERE,
 * at consumption; persist stays faithful, exactly like the fold lengths.
 */
export function resolveChaosEntry(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return value < 0 ? 0 : value;
}

/**
 * Whether a chaos row means anything: padded/truncated to
 * `baseTransformCount` with 1s (flam3's rule), does any resolved entry
 * differ from 1? An absent row, a row of exact 1s, and a row whose only
 * deviations sit PAST the base count are all trivial — they select exactly
 * as no row at all, so consumers (and `persist.ts`'s encoder) treat them
 * identically to absent. The ONE definition; nothing else may re-derive it.
 */
export function chaosRowIsNonTrivial(
  row: readonly number[] | undefined,
  baseTransformCount: number,
): boolean {
  if (row === undefined) return false;
  for (let j = 0; j < baseTransformCount; j++) {
    if (resolveChaosEntry(row[j]) !== 1) return true;
  }
  return false;
}

/**
 * Whether a system carries graph-directed selection at all: any transform's
 * chaos row is non-trivial ({@link chaosRowIsNonTrivial}). The structural
 * parameter type (not `Transform[]`) lets `Transform4` lists — whose rows
 * ride the 3D → 4D lift verbatim — share the one definition. This is the
 * predicate every seam keys on: `prepareChaosGame` builds chi rows exactly
 * when it holds (flam3's `flam3_check_unity_chaos` disabling), the flame
 * worker forces the CPU backend on it, the GPU flame packers throw on it,
 * and the surface/escape/bulb gates refuse on it.
 */
export function systemHasChaos(
  transforms: readonly { chaos?: number[] }[],
): boolean {
  const n = transforms.length;
  for (const t of transforms) {
    if (chaosRowIsNonTrivial(t.chaos, n)) return true;
  }
  return false;
}

/**
 * Whether a transform is a shape EMITTER (see
 * {@link import("./types").Transform.emitter}): a present spec with at
 * least one part. PRESENCE, deliberately not samplability or activity —
 * the ONE predicate every seam keys on (the five surface/escape/bulb
 * gates, the flame worker's CPU force, and `persist.ts`'s encoder read
 * this, `systemHasChaos`'s role one layer over):
 *
 * - SAMPLABILITY is resolved per slot at prepare time instead
 *   ({@link prepareEmitters}' fallback) — deciding it here would run the
 *   sampler's own validation (a gear's seeded Monte-Carlo area measure)
 *   inside gates that fire on every document edit, and an authored spec
 *   the sampler must refuse is an authoring error the gates should
 *   surface rather than silently render past.
 * - ACTIVITY (weight > 0) is deliberately not consulted either — chi's
 *   own convention, and the weight-0 corner is refused conservatively
 *   rather than reasoned about: an all-zero-weight system's selection
 *   degrades to the uniform draw over every map (`prepareChaosGame`'s
 *   `weighted` flag needs a positive total), so even a "never selected"
 *   emitter can fire there.
 */
export function transformHasEmitter(t: { emitter?: ShapeSpec }): boolean {
  return t.emitter !== undefined && t.emitter.parts.length > 0;
}

/**
 * Whether a system carries shape emitters at all: any transform's emitter
 * is present ({@link transformHasEmitter}). The structural parameter type
 * lets `Transform4` lists — whose emitters ride the 3D → 4D lift verbatim
 * — share the one definition, exactly like {@link systemHasChaos}. The
 * final transform never carries one (it sits outside selection), so
 * callers pass the base list alone.
 */
export function systemHasEmitters(
  transforms: readonly { emitter?: ShapeSpec }[],
): boolean {
  for (const t of transforms) {
    if (transformHasEmitter(t)) return true;
  }
  return false;
}

/** A prepared shape-emitter draw. Exported as part of the capability result
 * so consumers that need both the admission answer and the sampler never
 * prepare a gear's measured outline twice. */
export type EmitterSampler = (rng: Rng) => Vec3;

/** Why a present emitter cannot replace its transform's ordinary map step. */
export type EmitterSamplerUnsupportedReason =
  "intersection" | "zero-measure" | "invalid";

/**
 * The one typed capability answer for an emitter spec. `"absent"` includes
 * the document vocabulary's empty-parts identity; `"unsupported"` is the
 * documented plain-transform fallback and names whether the blocker is an
 * SDF-only intersection, a measureless union, or malformed shape state.
 */
export type EmitterSamplerCapability =
  | {
      status: "absent";
      sampler: null;
      reason: null;
      detail: null;
    }
  | {
      status: "sampleable";
      sampler: EmitterSampler;
      reason: null;
      detail: null;
    }
  | {
      status: "unsupported";
      sampler: null;
      reason: EmitterSamplerUnsupportedReason;
      detail: string;
    };

type PresentEmitterSamplerCapability = Exclude<
  EmitterSamplerCapability,
  { status: "absent" }
>;

const ABSENT_EMITTER_SAMPLER: EmitterSamplerCapability = {
  status: "absent",
  sampler: null,
  reason: null,
  detail: null,
};

/** Shape specs are immutable document values in normal app flow. Cache the
 * complete answer by identity so eligibility, UI disclosure, and run
 * preparation can all ask without repeating a gear's seeded measure probe. */
interface CachedEmitterSamplerCapability {
  fingerprint: string;
  capability: PresentEmitterSamplerCapability;
}

const emitterSamplerCapabilityCache = new WeakMap<
  ShapeSpec,
  CachedEmitterSamplerCapability
>();

function emitterSpecFingerprint(spec: ShapeSpec): string | null {
  try {
    return JSON.stringify(spec);
  } catch {
    return null;
  }
}

function emitterSamplerUnsupportedReason(
  detail: string,
): EmitterSamplerUnsupportedReason {
  if (detail.startsWith('shape sampler: an "intersect" part')) {
    return "intersection";
  }
  if (detail.includes("no measure to sample")) return "zero-measure";
  return "invalid";
}

/**
 * Classify and, when possible, prepare one emitter spec. This is deliberately
 * total at the document boundary: malformed imported state becomes a typed
 * unsupported answer rather than escaping as an exception. The sampler and
 * every failure answer are cached by spec identity.
 */
export function emitterSamplerCapability(
  spec: ShapeSpec | undefined,
): EmitterSamplerCapability {
  if (spec === undefined) return ABSENT_EMITTER_SAMPLER;
  if (Array.isArray(spec.parts) && spec.parts.length === 0) {
    return ABSENT_EMITTER_SAMPLER;
  }
  const fingerprint = emitterSpecFingerprint(spec);
  const cached = emitterSamplerCapabilityCache.get(spec);
  if (fingerprint !== null && cached?.fingerprint === fingerprint) {
    return cached.capability;
  }
  let capability: PresentEmitterSamplerCapability;
  try {
    capability = {
      status: "sampleable",
      sampler: prepareShapeSampler(spec),
      reason: null,
      detail: null,
    };
  } catch (error) {
    if (error instanceof MissingMeshAssetError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    capability = {
      status: "unsupported",
      sampler: null,
      reason: emitterSamplerUnsupportedReason(detail),
      detail,
    };
  }
  if (fingerprint !== null) {
    emitterSamplerCapabilityCache.set(spec, { fingerprint, capability });
  }
  return capability;
}

/**
 * Build the per-BASE-map emitter samplers a prepared chaos game carries,
 * or `null` when no transform's emitter yields one — the common case, in
 * which {@link stepOrbit} and every hand-inlined mirror run their
 * pre-emitter paths untouched (zero extra draws, byte-identical output).
 * Indexed by BASE map (`idx % baseTransformCount`), never the expanded
 * slot: a kaleidoscope copy inherits its base map's emitter exactly as it
 * inherits its chi column and color slot.
 *
 * THE FALLBACK RULE: a present emitter whose sampler cannot be prepared —
 * `prepareShapeSampler` throws on an `"intersect"` part (SDF-only spec: no
 * exact per-part sampling scheme exists), on structural violations and on
 * a measureless spec — resolves to `null` and the transform behaves as
 * the PLAIN transform (affine + variations), because sampling is simply
 * impossible for such a spec and a thrown generation would take the whole
 * cloud down for one bad field. Presets never author one; the gates still
 * refuse the document on PRESENCE ({@link transformHasEmitter}'s
 * conservative line). Prepared ONCE per run here — never per step — since
 * a gear spec's volume measure runs a seeded Monte-Carlo integration.
 *
 * Selection-side twin of {@link buildChaosSelection}: shared by
 * `prepareChaosGame` and `chaos-game-4d.ts`'s `prepareChaosGame4` (the
 * shape vocabulary is 3D — the 4D step embeds the sample at `w = 0`), so
 * the two dimensions cannot drift on what an emitter samples.
 */
export function prepareEmitters(
  transforms: readonly { emitter?: ShapeSpec }[],
): (EmitterSampler | null)[] | null {
  let any = false;
  const emitters = transforms.map((t) => {
    if (!transformHasEmitter(t)) return null;
    const capability = emitterSamplerCapability(t.emitter);
    if (capability.status === "sampleable") {
      any = true;
      return capability.sampler;
    }
    // SDF-only / degenerate / malformed spec — the documented
    // plain-transform fallback above.
    return null;
  });
  return any ? emitters : null;
}

/**
 * Derive an emitter step's sampler seed from the orbit stream: EXACTLY ONE
 * `rng()` draw, spread over the full u32 space. The ONE definition of the
 * derivation — {@link stepOrbit}, both dimensions' inlined mirrors and
 * every test replicate through it — so the byte-identity rule holds
 * everywhere: an emitter step costs the PRIMARY stream one draw beyond the
 * selection draw regardless of how many draws the sampler's internal
 * rejection loop spends on the DERIVED `mulberry32(seed)` stream
 * (`prepareShapeSampler` documents unbounded redraws as policy), which is
 * what keeps a morph's pinned-seed pick correspondence intact.
 */
export function emitterSeed(rng: Rng): number {
  return (rng() * 0x100000000) >>> 0;
}

/** A reseedable emitter-sample stream for the hand-inlined hot loops:
 * `reseed(seed)` rewinds it, after which `draw` yields exactly
 * `mulberry32(seed)`'s sequence (`rng.ts`'s algorithm restated so one
 * object serves a whole run — `IterationRng`'s allocation-free shape;
 * pinned equal to `mulberry32` in chaos-game.test.ts). {@link stepOrbit}
 * itself just allocates `mulberry32(emitterSeed(rng))` per emitter step —
 * it already allocates its `OrbitStep` — and the two are draw-for-draw
 * identical. */
export interface EmitterStream {
  reseed(seed: number): void;
  draw: Rng;
}

/** Create an {@link EmitterStream} — one per accumulation run, reseeded per
 * emitter step. */
export function createEmitterStream(): EmitterStream {
  let state = 0;
  return {
    reseed(seed: number): void {
      state = seed >>> 0;
    },
    draw(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** The chi-selection tables a prepared chaos game carries — see
 * {@link PreparedChaosGame.chaosRows} for field-by-field meaning. */
export interface ChaosSelection {
  chaosRows: Float64Array[];
  chaosRowTotals: Float64Array;
  chaosFallbackRows: number[];
}

/**
 * Build the graph-directed selection tables: one cumulative row PER BASE
 * TRANSFORM over the EXPANDED SLOT list, slot `s` in row `i` weighing
 * `slotWeights[s] * chi_i[s % baseTransformCount]` — so a kaleidoscope copy
 * inherits its base map's chi COLUMN exactly as it inherits its weight (and
 * `symmetry.blend`'s copy scaling, already baked into `slotWeights`, rides
 * through untouched). Returns `null` when {@link systemHasChaos} is false:
 * an all-trivial system builds NOTHING and every existing code path runs
 * untouched — flam3's `flam3_check_unity_chaos` disabling.
 *
 * A row whose weighted total is 0 or non-finite (every reachable entry
 * zeroed, or an over/underflow) is recorded in `chaosFallbackRows` and
 * FALLS BACK to the global table for that draw ({@link pickIndex}) —
 * flam3's tolerance, avoiding stuck orbits. Deliberately NO console warning
 * here: this runs inside workers per generation, and UI disclosure of a
 * degenerate row belongs to the chi matrix editor.
 *
 * Selection has no dimension — this is shared by `prepareChaosGame` and
 * `chaos-game-4d.ts`'s `prepareChaosGame4` rather than duplicated, exactly
 * like {@link effectiveSymmetryOrder}.
 */
export function buildChaosSelection(
  transforms: readonly { chaos?: number[] }[],
  slotWeights: readonly number[],
  baseTransformCount: number,
): ChaosSelection | null {
  if (!systemHasChaos(transforms)) return null;
  const transformCount = slotWeights.length;
  const chaosRows: Float64Array[] = [];
  const chaosRowTotals = new Float64Array(baseTransformCount);
  const chaosFallbackRows: number[] = [];
  for (let i = 0; i < baseTransformCount; i++) {
    const chi = transforms[i].chaos;
    const row = new Float64Array(transformCount);
    let total = 0;
    for (let s = 0; s < transformCount; s++) {
      total +=
        slotWeights[s] * resolveChaosEntry(chi?.[s % baseTransformCount]);
      row[s] = total;
    }
    chaosRows.push(row);
    chaosRowTotals[i] = total;
    if (!(total > 0) || !Number.isFinite(total)) chaosFallbackRows.push(i);
  }
  return { chaosRows, chaosRowTotals, chaosFallbackRows };
}

/**
 * Iteration number of plotted point `i` under chi's sub-orbit re-fusing, for
 * an `iterationRng`-driven run ({@link runChaosGame}) — a PURE FUNCTION of
 * the plotted-point index, so two chi-carrying runs under one pinned seed
 * stay point-for-point correspondent for morphs exactly as chi-free runs do.
 * Numbering is consecutive in execution order: the run's own warm-up takes
 * `0..WARMUP_ITERATIONS-1` and sub-orbit 0's points follow (identical to the
 * chi-free numbering), then each later sub-orbit's re-fuse block — one seed
 * iteration ({@link chaosRefuseIteration}) plus `WARMUP_ITERATIONS` warm-up
 * iterations — is numbered consecutively before its points.
 */
export function chaosPointIteration(i: number): number {
  const sub = Math.floor(i / CHAOS_SUB_ORBIT_POINTS);
  return WARMUP_ITERATIONS + i + sub * (WARMUP_ITERATIONS + 1);
}

/**
 * Iteration number of sub-orbit `sub`'s re-fuse SEED draw (`sub >= 1`; the
 * run's own seed is not numbered — it precedes iteration 0, exactly as
 * today). The block's warm-up steps take the `WARMUP_ITERATIONS` numbers
 * immediately after it, then the sub-orbit's first point continues at
 * {@link chaosPointIteration}`(sub * CHAOS_SUB_ORBIT_POINTS)`.
 */
export function chaosRefuseIteration(sub: number): number {
  return (
    chaosPointIteration(sub * CHAOS_SUB_ORBIT_POINTS) - (WARMUP_ITERATIONS + 1)
  );
}

/**
 * The scheduled-hybrid post-word's depth ceiling (see
 * {@link import("./types").HybridSchedule}): the brief's own control range.
 * Deeper words shrink the A-copies below visibility anyway — finite k IS
 * the artwork — so the slider stops here rather than at some engine limit.
 */
export const MAX_SCHEDULE_DEPTH = 5;

/**
 * The prepared post-word stage a {@link PreparedChaosGame} carries when the
 * document authors a {@link import("./types").HybridSchedule}: system B's
 * composed affines plus its own small weight table, in exactly
 * {@link pickIndex}'s uniform-fast-path/weighted conventions so a
 * {@link pickScheduleIndex} draw costs what a transform pick costs. `null`
 * — the common case — is today's plot path byte-identically.
 *
 * B IS AFFINE-ONLY BY CONSTRUCTION (the document rule — see
 * `HybridSchedule`'s doc): {@link prepareSchedule} composes each entry's
 * affine part alone and never builds variation blends, post-rotations or
 * chi rows for B, which is what keeps the post-word one multiply-add per
 * level in every mirror (CPU + WGSL, 3D + 4D) instead of a second full
 * stepper. CHI AND THE SCHEDULE DO NOT INTERACT, by construction rather
 * than by guard: chi shapes which map the ORBIT picks (`pickIndex`'s
 * `prevBase` rows), while the schedule bends the PLOTTED point after the
 * orbit has moved on — a B-pick is never a `prevBase`, and no chi row has a
 * column for a B map. The post-word never feeds back into the orbit and
 * never runs during warm-up (warm-up doesn't plot).
 *
 * RELATION TO CHI (the xaos layer): once graph-directed selection exists, a
 * periodic schedule IS expressible as layered transform copies under a
 * directed chi — but a depth-3 sponge-of-ferns would need 3 x 20 sponge
 * COPIES (60 extra transforms and rows over them) where this stage needs
 * none, which is why the post-word ships as its own mechanism rather than
 * as sugar over chi.
 */
export interface PreparedSchedule {
  /** System B's composed affine per entry, indexed like
   * `schedule.transforms`. */
  affines: Affine[];
  /** Running sum of B weights, {@link pickIndex}'s `cumulative` shape. */
  cumulative: Float64Array;
  /** Sum of all B weights. */
  totalWeight: number;
  /** Whether any B entry has a non-1 weight — selects the weighted draw in
   * {@link pickScheduleIndex}, exactly like `PreparedChaosGame.weighted`. */
  weighted: boolean;
  /** `schedule.transforms.length` — the uniform draw range. */
  count: number;
  /** The word length k: how many B-picks bend each plotted point. */
  depth: number;
}

/**
 * The dimension-free half of preparing a schedule: B's weight table, built
 * exactly the way {@link prepareChaosGame} builds the main table (absent
 * weight means 1; `weighted` only when some weight differs from 1 AND the
 * total is a positive finite number). Shared by {@link prepareSchedule} and
 * `chaos-game-4d.ts`'s `prepareSchedule4` — selection has no dimension,
 * `buildChaosSelection`'s own reasoning — so the two dimensions cannot
 * drift on what a B weight means.
 */
export function buildScheduleTable(
  transforms: readonly { weight?: number }[],
): {
  cumulative: Float64Array;
  totalWeight: number;
  weighted: boolean;
  count: number;
} {
  const count = transforms.length;
  const cumulative = new Float64Array(count);
  let totalWeight = 0;
  let anyNonUnit = false;
  for (let i = 0; i < count; i++) {
    const w = transforms[i].weight ?? 1;
    if (w !== 1) anyNonUnit = true;
    totalWeight += w;
    cumulative[i] = totalWeight;
  }
  const weighted =
    anyNonUnit && totalWeight > 0 && Number.isFinite(totalWeight);
  return { cumulative, totalWeight, weighted, count };
}

/**
 * Whether a document's schedule block means anything — the consumption-side
 * domain, mirroring `resolveChaosEntry`'s split of duties with `persist.ts`
 * (persist stays faithful; the domain lives at the reader): a block is live
 * only with a non-empty B list and an integer depth in
 * 1..{@link MAX_SCHEDULE_DEPTH}. Depth floors/ceilings rather than
 * rejecting (a hand-crafted 7 renders at 5 instead of silently at 0), but 0
 * or below — and a non-finite depth — means ABSENT, the UI's own
 * classic-removal rule.
 */
export function resolveScheduleDepth(
  schedule: HybridSchedule | null | undefined,
): number {
  if (!schedule || schedule.transforms.length === 0) return 0;
  const depth = Math.floor(schedule.depth);
  if (!Number.isFinite(depth) || depth <= 0) return 0;
  return Math.min(depth, MAX_SCHEDULE_DEPTH);
}

/**
 * Compose a document schedule block into the {@link PreparedSchedule} the
 * plot seam consumes, or `null` for an absent/empty block (see
 * {@link resolveScheduleDepth}) — in which case {@link plotPoint} and every
 * hand-inlined mirror run their pre-schedule paths untouched, zero extra
 * draws. Affine-only on purpose: `composeAffine` reads
 * position/rotation/scale/shear, and everything else a stray entry might
 * carry is deliberately not consulted (the document rule strips it anyway).
 */
export function prepareSchedule(
  schedule: HybridSchedule | null | undefined,
): PreparedSchedule | null {
  const depth = resolveScheduleDepth(schedule);
  if (depth === 0 || !schedule) return null;
  const table = buildScheduleTable(schedule.transforms);
  return {
    affines: schedule.transforms.map(composeAffine),
    cumulative: table.cumulative,
    totalWeight: table.totalWeight,
    weighted: table.weighted,
    count: table.count,
    depth,
  };
}

/**
 * Draw one B index from a prepared schedule — {@link pickIndex}'s exact
 * conventions over B's own table: the plain uniform draw when no B weight
 * differs from 1 (RNG-identical to `Math.floor(rng() * count)`), else the
 * lower-bound binary search, EXACTLY ONE `rng()` DRAW either way. The
 * parameter type is structural (the table fields alone) so
 * `chaos-game-4d.ts`'s `PreparedSchedule4` shares this one definition —
 * the pick has no dimension.
 */
export function pickScheduleIndex(
  schedule: {
    cumulative: Float64Array;
    totalWeight: number;
    weighted: boolean;
    count: number;
  },
  rng: Rng,
): number {
  if (!schedule.weighted) {
    return Math.floor(rng() * schedule.count);
  }
  const { cumulative, totalWeight } = schedule;
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

/**
 * Row-major 3x3 rotation by `angle` radians in one of the three w-free
 * coordinate planes — one nonzero Euler angle into {@link rotationMatrixXYZ}
 * gives exactly that, since the other two axes' sin/cos terms all collapse to
 * 0/1. Exported so `surface-de.ts` can sweep kaleidoscope sectors against the
 * exact same matrices {@link prepareChaosGame} rotates copies by (no drift
 * between the plotted set and its distance estimator).
 *
 * ## The axis → plane migration, entry for entry
 *
 * `SymmetryParams` named an AXIS before the kaleidoscope went 4D. A simple
 * rotation fixes the orthogonal complement — an axis in 3D, a plane in 4D —
 * so the same three rotations renamed to the planes they turn IN, and each
 * is the SAME matrix it always was:
 *
 *     legacy axis "x"  →  plane "yz"  =  rotationMatrixXYZ(angle, 0, 0)
 *     legacy axis "y"  →  plane "xz"  =  rotationMatrixXYZ(0, angle, 0)
 *     legacy axis "z"  →  plane "xy"  =  rotationMatrixXYZ(0, 0, angle)
 *
 * so every document predating the migration renders bit-identically (pinned
 * by this module's tests, entry for entry).
 *
 * ## One sign that is NOT `affine4.ts`'s `R_ab`
 *
 * Worth stating outright, because it is a live trap for the 4D generator this
 * vocabulary exists for: `Rotation4`/`rotationMatrix4` define `R_ab(θ)` as
 * rotating `+a` TOWARD `+b`, and "rotation about the `+y` axis" is the
 * right-handed rotation that carries `+z` toward `+x` — i.e. `R_zx(θ)`, which
 * is `R_xz(−θ)`. So of the three:
 *
 *     symmetryRotation("yz", θ) === upper-3x3 of rotationMatrix4({ yz:  θ })
 *     symmetryRotation("xy", θ) === upper-3x3 of rotationMatrix4({ xy:  θ })
 *     symmetryRotation("xz", θ) === upper-3x3 of rotationMatrix4({ xz: −θ })
 *
 * — exactly the `xz: -ry` that `affine4.ts`'s `embedTransform3` already
 * writes when it lifts a 3D Euler triple, for exactly this reason. This
 * function keeps the LEGACY sign in all three planes, because the migration's
 * first phase must not move a single rendered point; a 4D generator built on
 * `rotationMatrix4` has to negate the `xz` angle to agree with it (or adopt
 * this sign), and the tests pin both relations so the choice cannot be made
 * by accident.
 *
 * Throws on a `w`-plane: the 3D chaos game only ever sees w-free planes with
 * twist 0 (`affine4.ts`'s `symmetryIsNonFlat` routes anything else to the 4D
 * path), so reaching here with one is a bug, not a case to degrade.
 */
export function symmetryRotation(
  plane: SymmetryParams["plane"],
  angle: number,
): number[] {
  switch (plane) {
    case "yz":
      return rotationMatrixXYZ(angle, 0, 0);
    case "xz":
      return rotationMatrixXYZ(0, angle, 0);
    case "xy":
      return rotationMatrixXYZ(0, 0, angle);
    default:
      throw new Error(
        `symmetryRotation: "${plane}" mixes w and has no 3x3 — a 4D ` +
          `symmetry plane must route to the 4D path (symmetryIsNonFlat)`,
      );
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
   * The final transform's own post-affine ({@link Transform.post}), or
   * `null` — the lens's map is affine -> variations -> post exactly like a
   * base map's, so {@link plotPoint} applies this after `finalWarp` and
   * Surface's lens inverse un-applies it first. `null` for every lens
   * predating the field and for every absent final transform.
   */
  finalPost: Affine | null;
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
   * Graph-directed selection rows ({@link buildChaosSelection}), or `null`
   * for a system with no non-trivial chi — the common case, in which
   * {@link pickIndex} and every consumer run their pre-chi paths untouched.
   * One cumulative `Float64Array` per BASE transform over the EXPANDED slot
   * list: `chaosRows[prevBase]` is the distribution the next pick draws from
   * when the previously applied base map was `prevBase`.
   */
  chaosRows: Float64Array[] | null;
  /**
   * Per-row weighted totals, indexed by base map — `chaosRows[i]`'s last
   * entry, hoisted so {@link pickIndex} reads one scalar. Non-null exactly
   * when {@link chaosRows} is.
   */
  chaosRowTotals: Float64Array | null;
  /**
   * Base-map indices whose chi row weighted to a 0/non-finite total — those
   * draws fall back to the global table (see {@link buildChaosSelection}).
   * Non-null exactly when {@link chaosRows} is; empty for a healthy matrix.
   * Carried for the UI's future disclosure; no consumer branches on it
   * (pickIndex re-checks the total itself).
   */
  chaosFallbackRows: number[] | null;
  /**
   * Row-major 3x3 rotation applied AFTER a slot's affine + variation output
   * (the kaleidoscope copies), indexed like `affines`/`variations`, or
   * `null` for an unrotated slot — every slot at symmetry order 1, and every
   * copy-0 slot at any order, so the RNG stream and every coordinate stay
   * byte-identical to the pre-symmetry code path exactly where there is
   * nothing to rotate. See {@link stepOrbit}.
   */
  postRotations: (number[] | null)[];
  /**
   * The per-slot POST-AFFINE stage ({@link Transform.post}, flam3's
   * `post=`), indexed like `affines`/`variations` — the composed
   * post of the slot's BASE map, identical across its kaleidoscope copies
   * (the post applies BEFORE the copy rotation, so it carries no
   * copy-dependence of its own), or `null` for a map that authors none —
   * every slot of every document predating the field. Read by
   * {@link stepOrbit} between the variation sum and the post-rotation; an
   * emitter step skips it exactly as it skips the variations (a condensation
   * set is a fixed compact shape — the post is part of the warp pipeline the
   * emitter branch replaces). Surface's inverse descent carries the INVERSE
   * of these (`surface-de.ts`'s per-map post inverses) so the plotted set
   * and the estimated set cannot disagree.
   */
  posts: (Affine | null)[];
  /**
   * The scheduled-hybrid post-word stage ({@link prepareSchedule}), or
   * `null` for a document with no schedule block — the common case, in
   * which {@link plotPoint} and every hand-inlined plot mirror run their
   * pre-schedule paths untouched (zero extra draws, byte-identical output).
   * Consumed at PLOT time only: `depth` picks from B per plotted point,
   * post-word THEN lens, never fed back into the orbit.
   */
  schedule: PreparedSchedule | null;
  /**
   * Per-BASE-map shape-emitter samplers ({@link prepareEmitters}), or
   * `null` for a system with no (samplable) emitter — the common case, in
   * which {@link stepOrbit} and every hand-inlined mirror run their
   * pre-emitter paths untouched. Indexed by `idx % baseTransformCount`
   * (kaleidoscope copies inherit their base's emitter); a `null` ENTRY is
   * the documented plain-transform fallback for a spec the sampler must
   * refuse. Consumed at STEP time: the picked slot's sampler replaces the
   * whole affine + variation application (see {@link stepOrbit}).
   */
  emitters: (((rng: Rng) => Vec3) | null)[] | null;
  /**
   * Resolved flame palette slot per BASE map — length
   * {@link baseTransformCount}, indexed by `idx % baseTransformCount`, never by
   * the expanded slot: every kaleidoscope copy of a map colors as that map.
   * Each entry is the transform's own `colorIndex` when it authors one, else
   * {@link derivedColorIndex}'s even spread. Read by the two structural-
   * coloring hot loops this prepared object drives — `flame.ts`'s
   * `accumulateFlame` and `voxel.ts`'s `accumulateVoxels`, which run the same
   * walk over the same picks — which is why it is resolved once here rather
   * than re-derived per iteration in each of them.
   */
  colorIndex: Float64Array;
  /**
   * Resolved flame color speed per BASE map, the companion to
   * {@link colorIndex}: the transform's own `colorSpeed` or
   * {@link DEFAULT_COLOR_SPEED}. Same indexing, same two readers.
   */
  colorSpeed: Float64Array;
}

/**
 * Compose a transform set — and an optional final-transform lens — into a
 * {@link PreparedChaosGame}: everything about a run that does not change
 * per-iteration. Call once per run and reuse the result for every
 * {@link stepOrbit} / {@link plotPoint} call in that run.
 *
 * `symmetry` (defaults to order 1, the identity) replicates every
 * base map `effectiveSymmetryOrder(symmetry.order, transforms.length)` times,
 * copy `k` rotated by `2π·k / order` in `symmetry.plane` — see
 * {@link stepOrbit} for where that rotation is actually applied. At order 1
 * (any plane) this expansion is a no-op: exactly one (unrotated) copy of each
 * base map, so every existing caller that omits `symmetry` gets a
 * byte-identical `PreparedChaosGame` to before this parameter existed.
 * `symmetry.blend` (default 1) scales the rotated copies' selection
 * weights, continuously fading the kaleidoscope between full strength (1)
 * and bit-identical-to-order-1 (0) — see the weight-table comment below.
 *
 * `schedule` (default `null` — every existing caller) is the scheduled-
 * hybrid post-word block ({@link import("./types").HybridSchedule}),
 * precomposed once here into {@link PreparedChaosGame.schedule} via
 * {@link prepareSchedule}; an absent/empty block prepares to `null` and the
 * whole run is byte-identical to before the parameter existed.
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
  schedule: HybridSchedule | null = null,
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
  // Per-transform POST-AFFINE (flam3's post=), or null — the common case,
  // every document predating the field. The post applies BEFORE the copy
  // rotation, so every kaleidoscope copy of a map carries the SAME entry
  // (copy-major expansion below just repeats it, matching the postRotations
  // layout so both arrays index alike).
  const basePosts = transforms.map((t) => t.post ?? null);
  // The optional final transform: one more affine + variation map applied only
  // when a point is plotted (`plotPoint`), never fed back into the orbit. Both
  // stay null when absent, so `plotPoint` keeps the pre-feature code path.
  const finalAffine = finalTransform ? composeAffine(finalTransform) : null;
  const finalWarp = finalTransform
    ? composeVariations(finalTransform.variations)
    : null;
  const finalPost = finalTransform ? (finalTransform.post ?? null) : null;

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
  const posts: (Affine | null)[] = [];
  for (let k = 0; k < order; k++) {
    const post =
      k === 0
        ? null
        : symmetryRotation(symmetry.plane, (2 * Math.PI * k) / order);
    for (let i = 0; i < baseTransformCount; i++) {
      affines.push(baseAffines[i]);
      variations.push(baseVariations[i]);
      postRotations.push(post);
      posts.push(basePosts[i]);
    }
  }
  const transformCount = affines.length;

  // Selection weights: each slot inherits its BASE map's weight, so
  // pickIndex's draw over the full expanded list gives every copy an equal
  // share of its base map's total probability mass. When every weight is 1
  // (the common case) we keep the original `Math.floor(rng() * n)` draw, so
  // uniform systems consume the RNG identically and render exactly as before.
  // Only a genuinely weighted system pays for the cumulative-weight table +
  // binary search.
  //
  // `symmetry.blend` additionally scales every ROTATED copy's slot
  // (never copy 0), continuously thinning the kaleidoscope: at its default 1
  // the weights — and thus the `weighted` flag and the whole draw — are
  // untouched, and at 0 the copies' zero-width cumulative segments can never
  // win a draw, rendering bit-identically to order 1 (the lower-bound search
  // over uniform base weights lands exactly where the uniform draw does).
  // That continuity is what lets a morph crossfade a kaleidoscope instead of
  // snapping its discrete order (morph.ts).
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
    weights.some((w) => w !== 1) &&
    totalWeight > 0 &&
    Number.isFinite(totalWeight);

  // Graph-directed selection (chi): built ONLY when some row is non-trivial
  // (buildChaosSelection returns null otherwise — flam3_check_unity_chaos),
  // so an all-trivial system allocates nothing and pickIndex's chi branch
  // never engages. Rows weigh the same expanded `weights` the global table
  // just summed, so blend-scaled kaleidoscope copies inherit their base's
  // chi column at their scaled weight.
  const chaos = buildChaosSelection(transforms, weights, baseTransformCount);

  // Flame structural-coloring slots, resolved per BASE map — the
  // kaleidoscope copies deliberately get no entries of their own, since
  // `flame.ts` looks them up by `idx % baseTransformCount`. An all-absent
  // system resolves to exactly the `i / (n - 1)` slot and `0.5` speed the
  // accumulator hard-derived before these fields existed.
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
    finalPost,
    transformCount,
    baseTransformCount,
    weighted,
    cumulative,
    totalWeight,
    chaosRows: chaos ? chaos.chaosRows : null,
    chaosRowTotals: chaos ? chaos.chaosRowTotals : null,
    chaosFallbackRows: chaos ? chaos.chaosFallbackRows : null,
    postRotations,
    posts,
    schedule: prepareSchedule(schedule),
    emitters: prepareEmitters(transforms),
    colorIndex,
    colorSpeed,
  };
}

/**
 * Smallest index whose cumulative weight exceeds `r = rng() * totalWeight`, or
 * the plain uniform draw `Math.floor(rng() * n)` when no transform has a
 * non-1 weight — the fast, RNG-identical path for the common unweighted case
 * (see {@link prepareChaosGame}). For all-unit weights the lower-bound search
 * coincides with the uniform draw, so the two paths agree where they overlap.
 *
 * `prevBase` is the BASE index of the last applied map, for graph-directed
 * selection: when `prepared` carries chi rows AND `prevBase >= 0`, the draw
 * comes from `chaosRows[prevBase]` — the same one-`rng()`-draw lower-bound
 * search, over that row and its own total — so selection reads the row of
 * the FROM map, flam3's convention. `-1` (the default, and every caller
 * predating chi) means "no previous map": the ENTRY pick, which uses the
 * global table below exactly as before. A degenerate row (0/non-finite
 * total — see {@link buildChaosSelection}) also falls THROUGH to the global
 * table for that draw, flam3's stuck-orbit tolerance. EXACTLY ONE `rng()`
 * DRAW ON EVERY PATH — the stream discipline that keeps a chi edit
 * decorrelating a morph no worse than a weight edit does.
 *
 * Exported so a hand-inlined hot loop (see `flame.ts`'s `accumulateFlame`)
 * can pick a transform the exact same way {@link stepOrbit} does, without
 * paying for `stepOrbit`'s per-call `OrbitStep` allocation.
 */
export function pickIndex(
  prepared: PreparedChaosGame,
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

/** The orbit point (and the transform that produced it) after one {@link stepOrbit} call. */
export interface OrbitStep {
  x: number;
  y: number;
  z: number;
  /** Index of the transform that produced this step (see caveat below). */
  index: number;
  /**
   * Whether this step's landing point tripped the escape guard and was
   * reseeded. A chi-threading caller's selection state must then re-fuse:
   * its next `prevBase` is `escaped ? -1 : index` — an escape-reseed re-runs
   * the ENTRY pick (flam3 re-fuses) rather than chaining from the map that
   * triggered the blow-up. Chi-free callers can ignore it.
   */
  escaped: boolean;
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
 * Symmetry: when `prepared` has rotated copies, the picked slot's
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
 * POST-AFFINE: a slot's `posts` entry (flam3's `post=`) applies to the
 * variation sum's output immediately BEFORE the post-rotation, in the
 * non-emitter branch only — emitter steps skip it exactly as they skip the
 * variations (a condensation set is fixed; the post is part of the warp
 * pipeline the emitter branch replaces), while the SYMMETRY rotation still
 * bends an emitted point. `null` entries skip with zero extra work — the
 * identity-skip every mirror shares.
 *
 * `auxRng` is the stream every ITERATION-LOCAL draw comes from —
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
 *
 * `prevBase` is the graph-directed selection state (see {@link pickIndex}):
 * the BASE index of the last applied map, handed straight to the pick. The
 * CALLER threads it — `next = step.escaped ? -1 : step.index` — because an
 * orbit's selection state lives with the orbit point, not the prepared
 * tables. `-1` (the default, and every caller predating chi) is the entry
 * pick; with no chi rows the parameter is inert and every existing caller
 * is byte-identical.
 *
 * EMITTER STEPS (condensation — see {@link PreparedChaosGame.emitters}):
 * when the picked slot's BASE transform carries a prepared emitter, the
 * step IGNORES the incoming point entirely — the new orbit point is the
 * transform's own affine TRS applied to a fresh uniform sample of the
 * shape. The transform's VARIATIONS are deliberately SKIPPED: a
 * condensation set is a fixed compact shape `C₀`, and warping each sample
 * would make the plotted union some other set than `⋃ f_w(C₀)`. Everything
 * after the landing point is the ordinary step: a kaleidoscope copy's
 * post-rotation bends the emitted point (the emitter stamps replicate
 * around the axis), the escape guard still applies, and the emitted point
 * both feeds the orbit and plots through the unchanged plot stage
 * (post-word, lens, colors). RNG: exactly ONE draw from the primary `rng`
 * beyond the pick ({@link emitterSeed}); the sampler's own (unbounded)
 * draws all come from the derived `mulberry32(seed)` stream, so the
 * primary stream's cost per emitter step is constant. Selection is
 * untouched — chi rows and the schedule treat emitter slots like any slot.
 */
export function stepOrbit(
  prepared: PreparedChaosGame,
  x: number,
  y: number,
  z: number,
  rng: Rng,
  auxRng: Rng = rng,
  prevBase = -1,
): OrbitStep {
  const idx = pickIndex(prepared, rng, prevBase);
  const baseIdx = idx % prepared.baseTransformCount;
  const emitter =
    prepared.emitters !== null ? prepared.emitters[baseIdx] : null;
  let nx: number;
  let ny: number;
  let nz: number;
  if (emitter !== null) {
    // Condensation step (see the doc above): pose a fresh shape sample by
    // this slot's affine; the incoming point and the variations are
    // deliberately not consulted.
    const sample = emitter(mulberry32(emitterSeed(rng)));
    const p = applyAffine(
      prepared.affines[idx],
      sample[0],
      sample[1],
      sample[2],
    );
    nx = p[0];
    ny = p[1];
    nz = p[2];
  } else {
    const p = applyAffine(prepared.affines[idx], x, y, z);
    const warp = prepared.variations[idx];
    if (warp === null) {
      nx = p[0];
      ny = p[1];
      nz = p[2];
    } else {
      // Nonlinear maps can send a point to infinity — or, at a singularity,
      // to NaN. The reseed guard below catches both (NaN fails
      // Number.isFinite), stopping a bad landing from poisoning the rest of
      // the orbit.
      const q = warp(p[0], p[1], p[2], auxRng);
      nx = q[0];
      ny = q[1];
      nz = q[2];
    }
    // The slot's POST-AFFINE (flam3's post=), between the variation sum and
    // the symmetry post-rotation — the engine ordering every mirror
    // realizes. `null` (every map that authors none) skips: the affine
    // result passes through untouched, byte-identically. Emitter steps
    // never reach here — their branch above replaces the whole
    // affine+variation application, and the post is part of the pipeline it
    // replaces.
    const post = prepared.posts[idx];
    if (post !== null) {
      const m = post.m;
      const t = post.t;
      const px = m[0] * nx + m[1] * ny + m[2] * nz + t[0];
      const py = m[3] * nx + m[4] * ny + m[5] * nz + t[1];
      const pz = m[6] * nx + m[7] * ny + m[8] * nz + t[2];
      nx = px;
      ny = py;
      nz = pz;
    }
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
  let escaped = false;
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
    escaped = true;
  }
  return {
    x: nx,
    y: ny,
    z: nz,
    index: baseIdx,
    escaped,
  };
}

/**
 * Compute the plotted point for an orbit point: the point itself, optionally
 * bent by the scheduled-hybrid POST-WORD and then — when `prepared` has a
 * final transform — by the final-transform "lens" (fractal-flame
 * terminology: applied only at plot time, never fed back into the orbit; see
 * {@link runChaosGame}). A nonlinear lens can diverge at a singularity; the
 * bent point is only adopted while every coordinate stays finite, otherwise
 * this returns its input unchanged so a bad landing never produces NaN/Inf.
 *
 * THE POST-WORD RUNS FIRST, THEN THE LENS: with a prepared schedule
 * ({@link PreparedSchedule}), `depth` B-maps — each drawn independently by
 * {@link pickScheduleIndex}, EXACTLY ONE draw from the PRIMARY `rng` per
 * level (the pick stream's rigidity rule: `depth` draws exactly when the
 * block is present, zero when absent) — are applied to the plotted point in
 * sequence, and the lens then bends the RESULT. The whole word is computed
 * unconditionally (all `depth` draws happen even if the arithmetic
 * overflows — the draw count must be a pure function of the document, or a
 * morph's pinned-seed correspondence breaks), and the bent point is adopted
 * only while finite, exactly the lens's own rule: on non-finite, the
 * post-word falls back to the point BEFORE the word and the lens applies to
 * that. Affine B-maps draw nothing themselves, so `auxRng` stays the
 * stochastic LENS's stream alone.
 */
export function plotPoint(
  prepared: PreparedChaosGame,
  x: number,
  y: number,
  z: number,
  rng: Rng,
  auxRng: Rng = rng,
): Vec3 {
  const { finalAffine, finalWarp, finalPost, schedule } = prepared;
  let px = x;
  let py = y;
  let pz = z;
  if (schedule !== null) {
    let sx = px;
    let sy = py;
    let sz = pz;
    for (let d = 0; d < schedule.depth; d++) {
      const b = schedule.affines[pickScheduleIndex(schedule, rng)];
      const m = b.m;
      const t = b.t;
      const nx = m[0] * sx + m[1] * sy + m[2] * sz + t[0];
      const ny = m[3] * sx + m[4] * sy + m[5] * sz + t[1];
      const nz = m[6] * sx + m[7] * sy + m[8] * sz + t[2];
      sx = nx;
      sy = ny;
      sz = nz;
    }
    if (Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(sz)) {
      px = sx;
      py = sy;
      pz = sz;
    }
  }
  if (finalAffine === null) return [px, py, pz];
  const p = applyAffine(finalAffine, px, py, pz);
  let fx = p[0];
  let fy = p[1];
  let fz = p[2];
  if (finalWarp !== null) {
    const q = finalWarp(fx, fy, fz, auxRng);
    fx = q[0];
    fy = q[1];
    fz = q[2];
  }
  // The lens's own post-affine, after its variation blend — the same
  // affine -> variations -> post order a base map realizes, one lens over.
  if (finalPost !== null) {
    const m = finalPost.m;
    const t = finalPost.t;
    const gx = m[0] * fx + m[1] * fy + m[2] * fz + t[0];
    const gy = m[3] * fx + m[4] * fy + m[5] * fz + t[1];
    const gz = m[6] * fx + m[7] * fy + m[8] * fz + t[2];
    fx = gx;
    fy = gy;
    fz = gz;
  }
  if (Number.isFinite(fx) && Number.isFinite(fy) && Number.isFinite(fz)) {
    return [fx, fy, fz];
  }
  return [px, py, pz];
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
 * An optional `symmetry` (defaults to order 1, the identity) draws
 * from `effectiveSymmetryOrder(symmetry.order, transforms.length)` rotated
 * copies of the transform set instead of just the base maps — see
 * {@link prepareChaosGame}. `transformIndices` still records the BASE map
 * index regardless, so per-transform coloring is unaffected.
 *
 * An optional `iterationRng` moves every ITERATION-LOCAL draw — a
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
 * An optional `schedule` is the scheduled-hybrid post-word block
 * ({@link import("./types").HybridSchedule}): `depth` random B-maps bend
 * every point as it is plotted, AFTER the orbit and BEFORE the lens — see
 * {@link plotPoint}. Each level draws exactly once from the PRIMARY pick
 * stream, so with an `iterationRng` the pick stream's consumption stays
 * rigid (1 + depth draws per recorded iteration) and morph correspondence
 * survives. Omitted/absent, the loop is byte-identical to before the
 * parameter existed — same stream, same output, zero extra draws.
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
  schedule: HybridSchedule | null = null,
): ChaosGameResult {
  if (transforms.length === 0 || numPoints <= 0) {
    return {
      positions: new Float32Array(0),
      transformIndices: new Uint8Array(0),
      count: 0,
      bounds: emptyBounds(),
    };
  }

  const prepared = prepareChaosGame(
    transforms,
    finalTransform,
    symmetry,
    schedule,
  );

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

  // Graph-directed selection state (see pickIndex/CHAOS_SUB_ORBIT_POINTS).
  // Threaded unconditionally — with chaosRows null, pickIndex ignores it and
  // the update below is inert, so the chi-free path stays byte-identical.
  const chaosOn = prepared.chaosRows !== null;
  let prevBase = -1;

  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    if (iterationRng) iterationRng.begin(i);
    const s = stepOrbit(prepared, x, y, z, rng, aux, prevBase);
    x = s.x;
    y = s.y;
    z = s.z;
    prevBase = s.escaped ? -1 : s.index;
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
  const {
    affines,
    variations,
    postRotations,
    posts,
    finalAffine,
    finalWarp,
    finalPost,
  } = prepared;
  const { baseTransformCount, schedule: preparedSchedule, emitters } = prepared;
  // Emitter-sample stream: one reseedable object per run (allocation-free
  // per step), reseeded from the primary stream by exactly one draw per
  // emitter step — see emitterSeed/createEmitterStream. Inert (never
  // reseeded, never drawn) without emitters.
  const emitterStream = createEmitterStream();
  const emitterDraw = emitterStream.draw;

  for (let i = 0; i < numPoints; i++) {
    // Sub-orbit re-fuse (see CHAOS_SUB_ORBIT_POINTS): every K plotted points
    // under chi, reseed from the aux stream, reset to the entry pick, and
    // warm the fresh orbit up unrecorded — otherwise a block-diagonal chi
    // renders only the block the run's first entry pick landed in. Iteration
    // numbers stay a pure function of the plotted-point index
    // (chaosRefuseIteration / chaosPointIteration), so two chi runs under
    // one pinned seed remain point-for-point correspondent for morphs.
    if (chaosOn && i > 0 && i % CHAOS_SUB_ORBIT_POINTS === 0) {
      const sub = i / CHAOS_SUB_ORBIT_POINTS;
      if (iterationRng) iterationRng.begin(chaosRefuseIteration(sub));
      x = aux() - 0.5;
      y = aux() - 0.5;
      z = aux() - 0.5;
      prevBase = -1;
      for (let k = 0; k < WARMUP_ITERATIONS; k++) {
        if (iterationRng) {
          iterationRng.begin(chaosRefuseIteration(sub) + 1 + k);
        }
        const s = stepOrbit(prepared, x, y, z, rng, aux, prevBase);
        x = s.x;
        y = s.y;
        z = s.z;
        prevBase = s.escaped ? -1 : s.index;
      }
    }
    // --- inlined stepOrbit(prepared, x, y, z, rng, aux) ---------------------
    if (iterationRng) {
      iterationRng.begin(
        chaosOn ? chaosPointIteration(i) : WARMUP_ITERATIONS + i,
      );
    }
    const idx = pickIndex(prepared, rng, prevBase);
    const baseIdx = idx % baseTransformCount;
    const emitter = emitters !== null ? emitters[baseIdx] : null;
    let nx: number;
    let ny: number;
    let nz: number;
    if (emitter !== null) {
      // Condensation step — stepOrbit's emitter branch exactly: one primary
      // seed draw, the sampler on the derived stream, the slot's affine as
      // the shape's pose, incoming point and variations ignored.
      emitterStream.reseed(emitterSeed(rng));
      const sample = emitter(emitterDraw);
      const aff = affines[idx];
      const m = aff.m;
      const t = aff.t;
      nx = m[0] * sample[0] + m[1] * sample[1] + m[2] * sample[2] + t[0];
      ny = m[3] * sample[0] + m[4] * sample[1] + m[5] * sample[2] + t[1];
      nz = m[6] * sample[0] + m[7] * sample[1] + m[8] * sample[2] + t[2];
    } else {
      const aff = affines[idx];
      const m = aff.m;
      const t = aff.t;
      const ax = m[0] * x + m[1] * y + m[2] * z + t[0];
      const ay = m[3] * x + m[4] * y + m[5] * z + t[1];
      const az = m[6] * x + m[7] * y + m[8] * z + t[2];

      const warp = variations[idx];
      if (warp === null) {
        nx = ax;
        ny = ay;
        nz = az;
      } else {
        // Nonlinear maps can send a point to infinity — or, at a
        // singularity, to NaN. The reseed guard below catches both (NaN
        // fails Number.isFinite), stopping a bad landing from poisoning the
        // orbit.
        const q = warp(ax, ay, az, aux);
        nx = q[0];
        ny = q[1];
        nz = q[2];
      }
      // The slot's POST-AFFINE, between the variation sum and the
      // post-rotation — stepOrbit's insertion exactly (this loop is its
      // hand-inlined mirror, pinned by the oracle test). Emitter steps
      // skip it (their branch replaced the pipeline it belongs to).
      const slotPost = posts[idx];
      if (slotPost !== null) {
        const sm = slotPost.m;
        const st = slotPost.t;
        const sx = sm[0] * nx + sm[1] * ny + sm[2] * nz + st[0];
        const sy = sm[3] * nx + sm[4] * ny + sm[5] * nz + st[1];
        const sz = sm[6] * nx + sm[7] * ny + sm[8] * nz + st[2];
        nx = sx;
        ny = sy;
        nz = sz;
      }
    }

    // Symmetry: rotate this slot's FULL affine + variation output —
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

    let escaped = false;
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
      escaped = true;
    }
    x = nx;
    y = ny;
    z = nz;
    // Selection state for the next pick — mirrors stepOrbit's escaped/index
    // contract exactly (an escape-reseed re-fuses the entry pick). Inert
    // without chi rows.
    prevBase = escaped ? -1 : baseIdx;

    // --- inlined plotPoint(prepared, x, y, z, rng, aux) ----------------------
    // The plotted point is the orbit point, optionally bent by the schedule's
    // post-word and then by the final transform. The orbit state x/y/z is
    // left untouched, so neither stage ever feeds back into the iteration.
    let px = x;
    let py = y;
    let pz = z;
    if (preparedSchedule !== null) {
      // The post-word: depth B-picks off the PRIMARY stream (one draw per
      // level, plotPoint's rigidity rule), adopted only while finite.
      let sx = px;
      let sy = py;
      let sz = pz;
      for (let d = 0; d < preparedSchedule.depth; d++) {
        const b =
          preparedSchedule.affines[pickScheduleIndex(preparedSchedule, rng)];
        const bm = b.m;
        const bt = b.t;
        const nx = bm[0] * sx + bm[1] * sy + bm[2] * sz + bt[0];
        const ny = bm[3] * sx + bm[4] * sy + bm[5] * sz + bt[1];
        const nz = bm[6] * sx + bm[7] * sy + bm[8] * sz + bt[2];
        sx = nx;
        sy = ny;
        sz = nz;
      }
      if (Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(sz)) {
        px = sx;
        py = sy;
        pz = sz;
      }
    }
    if (finalAffine !== null) {
      const fm = finalAffine.m;
      const ft = finalAffine.t;
      let fx = fm[0] * px + fm[1] * py + fm[2] * pz + ft[0];
      let fy = fm[3] * px + fm[4] * py + fm[5] * pz + ft[1];
      let fz = fm[6] * px + fm[7] * py + fm[8] * pz + ft[2];
      if (finalWarp !== null) {
        const q = finalWarp(fx, fy, fz, aux);
        fx = q[0];
        fy = q[1];
        fz = q[2];
      }
      // The lens's own post-affine, after its variation blend — plotPoint's
      // lens order exactly.
      if (finalPost !== null) {
        const pm = finalPost.m;
        const pt = finalPost.t;
        const gx = pm[0] * fx + pm[1] * fy + pm[2] * fz + pt[0];
        const gy = pm[3] * fx + pm[4] * fy + pm[5] * fz + pt[1];
        const gz = pm[6] * fx + pm[7] * fy + pm[8] * fz + pt[2];
        fx = gx;
        fy = gy;
        fz = gz;
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
    // The BASE map this slot is a (possibly rotated) copy of — see
    // PreparedChaosGame.baseTransformCount — matching stepOrbit's own
    // OrbitStep.index exactly, including the escape-reseed case (idx is the
    // TRIGGERING transform, fixed before the reseed branch above runs).
    transformIndices[i] = baseIdx;

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

/**
 * Record bounded point-space tiling images without ever feeding an image back
 * into the chaos orbit. The ordinary orbit, scheduled post-word and final lens
 * are identical to {@link runChaosGame}; only the recording sink differs.
 * `numPoints` is an output capacity, while canonical source attempts stop at
 * the shared `8N` cap. Tiling selection consumes no RNG.
 */
export function runChaosGameTiledPoints(
  transforms: Transform[],
  numPoints: number,
  pointTilingPlan: PointTilingPlan,
  rng: Rng = Math.random,
  finalTransform: Transform | null = null,
  symmetry: SymmetryParams = NO_SYMMETRY,
  iterationRng?: IterationRng,
  schedule: HybridSchedule | null = null,
): TiledChaosGameResult {
  if (pointTilingPlan.dimension !== 3) {
    throw new RangeError("3D chaos game requires a 3D point-tiling plan");
  }
  const pointTilingState = createPointTilingPointsState();
  if (transforms.length === 0 || numPoints <= 0) {
    return {
      positions: new Float32Array(0),
      canonicalPositions: new Float32Array(0),
      transformIndices: new Uint8Array(0),
      count: 0,
      bounds: emptyBounds(),
      canonicalBounds: emptyBounds(),
      pointTilingState,
    };
  }

  const prepared = prepareChaosGame(
    transforms,
    finalTransform,
    symmetry,
    schedule,
  );
  const positions = new Float32Array(numPoints * 3);
  const canonicalPositions = new Float32Array(numPoints * 3);
  const transformIndices = new Uint8Array(numPoints);

  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;
  const aux = iterationRng ? iterationRng.draw : rng;
  const chaosOn = prepared.chaosRows !== null;
  let prevBase = -1;

  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    if (iterationRng) iterationRng.begin(i);
    const s = stepOrbit(prepared, x, y, z, rng, aux, prevBase);
    x = s.x;
    y = s.y;
    z = s.z;
    prevBase = s.escaped ? -1 : s.index;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  let canonicalMinX = Infinity;
  let canonicalMaxX = -Infinity;
  let canonicalMinY = Infinity;
  let canonicalMaxY = -Infinity;
  let canonicalMinZ = Infinity;
  let canonicalMaxZ = -Infinity;
  let canonicalMinR = Infinity;
  let canonicalMaxR = -Infinity;

  const {
    affines,
    variations,
    postRotations,
    posts,
    finalAffine,
    finalWarp,
    finalPost,
  } = prepared;
  const { baseTransformCount, schedule: preparedSchedule, emitters } = prepared;
  const emitterStream = createEmitterStream();
  const emitterDraw = emitterStream.draw;
  const attemptLimit = pointTilingPointsAttemptLimit(numPoints);

  for (
    let sourceAttempt = 0;
    sourceAttempt < attemptLimit &&
    pointTilingState.emitted < numPoints &&
    (pointTilingPlan.kind === "finite" ||
      pointTilingState.candidateTests < attemptLimit);
    sourceAttempt++
  ) {
    if (
      chaosOn &&
      sourceAttempt > 0 &&
      sourceAttempt % CHAOS_SUB_ORBIT_POINTS === 0
    ) {
      const sub = sourceAttempt / CHAOS_SUB_ORBIT_POINTS;
      if (iterationRng) iterationRng.begin(chaosRefuseIteration(sub));
      x = aux() - 0.5;
      y = aux() - 0.5;
      z = aux() - 0.5;
      prevBase = -1;
      for (let k = 0; k < WARMUP_ITERATIONS; k++) {
        if (iterationRng) {
          iterationRng.begin(chaosRefuseIteration(sub) + 1 + k);
        }
        const s = stepOrbit(prepared, x, y, z, rng, aux, prevBase);
        x = s.x;
        y = s.y;
        z = s.z;
        prevBase = s.escaped ? -1 : s.index;
      }
    }

    if (iterationRng) {
      iterationRng.begin(
        chaosOn
          ? chaosPointIteration(sourceAttempt)
          : WARMUP_ITERATIONS + sourceAttempt,
      );
    }
    const idx = pickIndex(prepared, rng, prevBase);
    const baseIdx = idx % baseTransformCount;
    const emitter = emitters !== null ? emitters[baseIdx] : null;
    let nx: number;
    let ny: number;
    let nz: number;
    if (emitter !== null) {
      emitterStream.reseed(emitterSeed(rng));
      const sample = emitter(emitterDraw);
      const aff = affines[idx];
      const m = aff.m;
      const t = aff.t;
      nx = m[0] * sample[0] + m[1] * sample[1] + m[2] * sample[2] + t[0];
      ny = m[3] * sample[0] + m[4] * sample[1] + m[5] * sample[2] + t[1];
      nz = m[6] * sample[0] + m[7] * sample[1] + m[8] * sample[2] + t[2];
    } else {
      const aff = affines[idx];
      const m = aff.m;
      const t = aff.t;
      const ax = m[0] * x + m[1] * y + m[2] * z + t[0];
      const ay = m[3] * x + m[4] * y + m[5] * z + t[1];
      const az = m[6] * x + m[7] * y + m[8] * z + t[2];
      const warp = variations[idx];
      if (warp === null) {
        nx = ax;
        ny = ay;
        nz = az;
      } else {
        const q = warp(ax, ay, az, aux);
        nx = q[0];
        ny = q[1];
        nz = q[2];
      }
      // The slot's POST-AFFINE — stepOrbit's insertion exactly (this loop is
      // its hand-inlined mirror). Emitter steps skip it.
      const slotPost = posts[idx];
      if (slotPost !== null) {
        const sm = slotPost.m;
        const st = slotPost.t;
        const sx = sm[0] * nx + sm[1] * ny + sm[2] * nz + st[0];
        const sy = sm[3] * nx + sm[4] * ny + sm[5] * nz + st[1];
        const sz = sm[6] * nx + sm[7] * ny + sm[8] * nz + st[2];
        nx = sx;
        ny = sy;
        nz = sz;
      }
    }

    const post = postRotations[idx];
    if (post !== null) {
      const rx = post[0] * nx + post[1] * ny + post[2] * nz;
      const ry = post[3] * nx + post[4] * ny + post[5] * nz;
      const rz = post[6] * nx + post[7] * ny + post[8] * nz;
      nx = rx;
      ny = ry;
      nz = rz;
    }

    let escaped = false;
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
      escaped = true;
    }
    x = nx;
    y = ny;
    z = nz;
    prevBase = escaped ? -1 : baseIdx;

    let px = x;
    let py = y;
    let pz = z;
    if (preparedSchedule !== null) {
      let sx = px;
      let sy = py;
      let sz = pz;
      for (let d = 0; d < preparedSchedule.depth; d++) {
        const b =
          preparedSchedule.affines[pickScheduleIndex(preparedSchedule, rng)];
        const bm = b.m;
        const bt = b.t;
        const bx = bm[0] * sx + bm[1] * sy + bm[2] * sz + bt[0];
        const by = bm[3] * sx + bm[4] * sy + bm[5] * sz + bt[1];
        const bz = bm[6] * sx + bm[7] * sy + bm[8] * sz + bt[2];
        sx = bx;
        sy = by;
        sz = bz;
      }
      if (Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(sz)) {
        px = sx;
        py = sy;
        pz = sz;
      }
    }
    if (finalAffine !== null) {
      const fm = finalAffine.m;
      const ft = finalAffine.t;
      let fx = fm[0] * px + fm[1] * py + fm[2] * pz + ft[0];
      let fy = fm[3] * px + fm[4] * py + fm[5] * pz + ft[1];
      let fz = fm[6] * px + fm[7] * py + fm[8] * pz + ft[2];
      if (finalWarp !== null) {
        const q = finalWarp(fx, fy, fz, aux);
        fx = q[0];
        fy = q[1];
        fz = q[2];
      }
      // The lens's own post-affine, after its variation blend — plotPoint's
      // lens order exactly.
      if (finalPost !== null) {
        const pm = finalPost.m;
        const pt = finalPost.t;
        const gx = pm[0] * fx + pm[1] * fy + pm[2] * fz + pt[0];
        const gy = pm[3] * fx + pm[4] * fy + pm[5] * fz + pt[1];
        const gz = pm[6] * fx + pm[7] * fy + pm[8] * fz + pt[2];
        fx = gx;
        fy = gy;
        fz = gz;
      }
      if (Number.isFinite(fx) && Number.isFinite(fy) && Number.isFinite(fz)) {
        px = fx;
        py = fy;
        pz = fz;
      }
    }

    let writeIndex = pointTilingState.emitted;
    visitPointTilingPointsAttemptBounded(
      pointTilingPlan,
      px,
      py,
      pz,
      0,
      numPoints - writeIndex,
      pointTilingState,
      (imageX, imageY, imageZ, _imageW, weight) => {
        if (weight !== 1) {
          throw new Error("Points tiling emitted a non-unit image weight");
        }
        const offset = writeIndex * 3;
        positions[offset] = imageX;
        positions[offset + 1] = imageY;
        positions[offset + 2] = imageZ;
        canonicalPositions[offset] = px;
        canonicalPositions[offset + 1] = py;
        canonicalPositions[offset + 2] = pz;
        transformIndices[writeIndex] = baseIdx;
        writeIndex++;

        minX = Math.min(minX, imageX);
        maxX = Math.max(maxX, imageX);
        minY = Math.min(minY, imageY);
        maxY = Math.max(maxY, imageY);
        minZ = Math.min(minZ, imageZ);
        maxZ = Math.max(maxZ, imageZ);
        const imageR = Math.hypot(imageX, imageY, imageZ);
        minR = Math.min(minR, imageR);
        maxR = Math.max(maxR, imageR);
        canonicalMinX = Math.min(canonicalMinX, px);
        canonicalMaxX = Math.max(canonicalMaxX, px);
        canonicalMinY = Math.min(canonicalMinY, py);
        canonicalMaxY = Math.max(canonicalMaxY, py);
        canonicalMinZ = Math.min(canonicalMinZ, pz);
        canonicalMaxZ = Math.max(canonicalMaxZ, pz);
        const sourceR = Math.hypot(px, py, pz);
        canonicalMinR = Math.min(canonicalMinR, sourceR);
        canonicalMaxR = Math.max(canonicalMaxR, sourceR);
      },
    );
    if (writeIndex !== pointTilingState.emitted) {
      throw new Error("Points tiling callback count disagrees with its state");
    }
  }

  const count = pointTilingState.emitted;
  return {
    positions: positions.subarray(0, count * 3),
    canonicalPositions: canonicalPositions.subarray(0, count * 3),
    transformIndices: transformIndices.subarray(0, count),
    count,
    bounds:
      count === 0
        ? emptyBounds()
        : { minX, maxX, minY, maxY, minZ, maxZ, minR, maxR },
    canonicalBounds:
      count === 0
        ? emptyBounds()
        : {
            minX: canonicalMinX,
            maxX: canonicalMaxX,
            minY: canonicalMinY,
            maxY: canonicalMaxY,
            minZ: canonicalMinZ,
            maxZ: canonicalMaxZ,
            minR: canonicalMinR,
            maxR: canonicalMaxR,
          },
    pointTilingState,
  };
}
