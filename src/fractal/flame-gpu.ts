/**
 * The WebGPU flame-accumulation backend's PURE side: the WGSL
 * kernel source, its byte-layout contracts, and (below the kernel) the
 * packing/planning/conversion functions that translate between this
 * codebase's plain-object systems and the kernel's flat GPU buffers.
 *
 * Everything in this module is dependency-free and browser-free — plain
 * data in, plain data out — so the layout rules, weight tables, chain
 * seeding, dispatch planning, and histogram conversion are all
 * Vitest-testable (`flame-gpu.test.ts`), exactly like the rest of
 * `src/fractal/`. The one thing that cannot run under Vitest is the WGSL
 * string itself; it is pinned instead by the statistical agreement harness
 * (`src/app/gpu-bench/`, the accumulation spike's equal-N methodology)
 * against `accumulateFlame`, this kernel's line-for-line CPU reference.
 *
 * The kernel is that spike's kernel, productionized. For the blend-less
 * systems that can reach a render worker (see {@link packGpuSystem}'s weight
 * note), parity with `accumulateFlame` (see that function and
 * `chaos-game.ts`'s `stepOrbit`):
 * same uniform/weighted transform pick (lower-bound binary search over
 * cumulative weights) — and, one layer over it, the same graph-directed
 * selection (`pickIndex`'s chi path: the prevBase row draw over
 * `buildChaosSelection`'s own transferred tables, the escape/entry re-fuse,
 * and the `CHAOS_SUB_ORBIT_POINTS` sub-orbit re-fuse, each chain carrying
 * its own selection state exactly as the CPU's histogram carries
 * `orbitPrevBase`/`orbitChaosLeft`) — same affine → blended-variations →
 * symmetry
 * post-rotation step, same escape-reseed limit (written NaN-robustly for
 * f32: WGSL comparisons with NaN are false, so `!(all inside)` catches NaN
 * and ±inf alike), same final-transform adopt-only-if-finite lens, same
 * flam3 color-coordinate walk (its per-map palette slot and blend
 * speed ride the SLOT, resolved host-side by {@link packGpuSystem} through
 * the very same `derivedColorIndex`/`DEFAULT_COLOR_SPEED` `prepareChaosGame`
 * resolves the CPU oracle's with), same NDC → pixel bucketing. Deliberate
 * differences, measured and accepted in the spike's go/no-go
 * (`docs/flame-gpu-accumulation-spike.md`): f32 arithmetic instead of f64,
 * and many independent PCG32 chains instead of one mulberry32 orbit — each
 * chain on its own PCG stream (a per-chain odd increment), so
 * distinct chains walk distinct full-period LCG cycles rather than
 * phase-shifted copies of one shared cycle. The output is a statistically
 * indistinguishable render of the same attractor, not a byte-identical one.
 *
 * **Balloon echo.** When the optional echo block is present, every plotted
 * point is sphere-inverted and deposited once more into this SAME histogram;
 * the normal and echo splats therefore share one density field and one tone
 * map. There is deliberately NO conformal-magnification correction here: a
 * histogram measures density directly, so the changing spacing between
 * inverted samples already is the magnification effect. Nor is there a
 * radial fade: the frozen camera rejects an inversion outside its frustum,
 * and rejected points cannot change that already-frozen frame. Tint is
 * applied only to the echo's color before its second deposit. With no echo
 * block, the uniform weight is zero and the old one-splat path is the exact
 * specialization (the x256 base scale divides out losslessly).
 *
 * Two production changes over the spike kernel:
 *
 * - **64-bit histogram counters.** The spike's single-u32 buckets overflow
 *   a hot bucket's fixed-point color at 2^32/256 ≈ 16.7 M hits — about
 *   three SECONDS of accumulation on a discrete GPU (measured 10 G iter/s
 *   on an RX 7900 XTX). Every channel is now an emulated-u64 lo/hi pair:
 *   `addU64` detects lo-word wraparound via `atomicAdd`'s returned old
 *   value and carries into the hi word (integer atomics commute, so this
 *   is exact regardless of scheduling). A bucket is 8 u32s — 32 bytes,
 *   exactly `flame-worker-core.ts`'s `BYTES_PER_ACCUM_BUCKET`, so the
 *   device-aware accumulation budget transfers to VRAM unchanged.
 * - **All variation lanes.** The editor lets a transform enable every
 *   variation type at once; the spike's 4 lanes would have forced a silent
 *   CPU fallback for variation-heavy systems. Slots now carry
 *   {@link MAX_SLOT_VARIATIONS} (type, weight) lanes — one per
 *   {@link VariationType} (the Mandelbox fold family added
 *   `boxfold`/`spherefold`/`mandelbox`, `qsquare` filled the 16 lanes the
 *   arrays had always reserved, and `bulb` took the count to 17 — widening
 *   both lane arrays by one `vec4`, the smallest step a `vec4` array has, so
 *   three of the 20 lanes now ride spare).
 */
import type { Rng } from "./rng";
import type {
  HybridSchedule,
  SymmetryParams,
  Transform,
  VariationType,
  Vec3,
} from "./types";
import type { Balloon } from "./balloon-de";
import { createFlameHistogram } from "./flame";
import type { FlameHistogram, Mat4 } from "./flame";
import type { PaletteSpec } from "./palette";
// The packing functions appended below the kernel need these value imports,
// which the byte-layout/kernel section above did not — kept as separate
// statements (rather than merged into the type-only imports above) so the
// authored imports above stay untouched.
import { composeAffine, rotationMatrixXYZ } from "./affine";
import {
  CHAOS_SUB_ORBIT_POINTS,
  DEFAULT_COLOR_SPEED,
  MAX_TRANSFORMS,
  WARMUP_ITERATIONS,
  buildChaosSelection,
  buildScheduleTable,
  derivedColorIndex,
  effectiveSymmetryOrder,
  prepareEmitters,
  resolveScheduleDepth,
} from "./chaos-game";
import type { ChaosSelection } from "./chaos-game";
import { transformColors } from "./color";
import { isFoldVariationType, resolveFoldRadii } from "./variations";
import { buildPaletteLUT } from "./palette";
import { mulberry32 } from "./rng";
import { MAX_SHAPE_PARTS } from "./shapes";
import type { ShapePart, ShapePose, ShapePrimitive, ShapeSpec } from "./shapes";

/** Invocations per workgroup; a dispatch is `numChains / WORKGROUP_SIZE`
 * workgroups. 128 measured well on both integrated and discrete GPUs in
 * the accumulation spike; chain counts must be a multiple of this. */
export const WORKGROUP_SIZE = 128;

/** Fixed-point scale for color channels: palette/LUT entries are
 * pre-scaled to `round(channel * 256)` at pack time, so the kernel adds
 * integers and {@link convertGpuHistogram} removes this color scale plus
 * {@link WEIGHT_FIXED_POINT_SCALE} on readback.
 * Quantization is ≤ 1/512 per channel per hit — invisible under the
 * log-density tonemap (measured: bias ≤ 0.065/255 in that spike). */
export const COLOR_FIXED_POINT_SCALE = 256;

/** Fixed-point scale for histogram hit weights. The 3D path did not need a
 * fractional hit before the balloon echo; sharing the 4D path's x256 scale
 * keeps the common histogram/downsample/readback contract single-sourced.
 * A normal hit is exactly 256, and the scale divides out on readback. */
export const WEIGHT_FIXED_POINT_SCALE = 256;

/** Variation (type, weight) lanes per slot — equal to `VARIATION_TYPES.length`
 * (`types.ts`), so a single transform can carry every {@link VariationType}
 * at once and no system's variation list can force a CPU fallback. */
export const MAX_SLOT_VARIATIONS = 17;

/** u32 words per histogram bucket: four emulated-u64 channels —
 * [hitsLo, hitsHi, rLo, rHi, gLo, gHi, bLo, bHi]. */
export const HIST_U32_PER_BUCKET = 8;

/** Bytes per accumulation bucket — deliberately identical to the CPU
 * histogram's (one f64 `hits` + three f64 `sumRGB`), so the worker's
 * device-aware byte budget needs no GPU-specific variant. */
export const BYTES_PER_GPU_BUCKET = HIST_U32_PER_BUCKET * 4;

/**
 * The case indices `applyVariation` switches on — packing maps a
 * transform's `VariationType` strings through this table. Typed as a total
 * Record so adding a variation to `types.ts` without extending the WGSL
 * switch fails to COMPILE here, instead of silently rendering as `linear`.
 */
export const KERNEL_VARIATION_INDEX: Record<VariationType, number> = {
  linear: 0,
  sinusoidal: 1,
  spherical: 2,
  swirl: 3,
  horseshoe: 4,
  polar: 5,
  handkerchief: 6,
  heart: 7,
  disc: 8,
  spiral: 9,
  bubble: 10,
  julia: 11,
  boxfold: 12,
  spherefold: 13,
  mandelbox: 14,
  qsquare: 15,
  bulb: 16,
};

/**
 * Byte-layout contracts (WGSL struct rules; the pack* functions below
 * write ArrayBuffers to match, and `flame-gpu.test.ts` pins them):
 *
 * Params (uniform, {@link PARAMS_BYTES} = 160):
 *   0 projX vec4f | 16 projY vec4f | 32 projW vec4f
 *   48 width u32 | 52 height u32 | 56 transformCount u32 | 60 baseTransformCount u32
 *   64 itersPerInvocation u32 | 68 colorMode u32 (0 legacy, 1 LUT) | 72 weighted u32 | 76 hasFinal u32
 *   80 totalWeight f32 | 84 numChains u32 | 88 echoWeight f32 (zero = off) |
 *   92 echoRho f32 | 96 echoCenterR2 vec4f (center xyz, R squared) |
 *   112 echoTintStrength vec4f (tint rgb, strength) |
 *   128 echoPaletteEnabled u32 | 132 scheduleCount u32 (zero = no post-word) |
 *   136 scheduleDepth u32 | 140 scheduleWeighted u32 |
 *   144 scheduleTotalWeight f32 | 148 chaosEnabled u32 (zero = no chi
 *   rows — binding 6 is then an unread alias, the echoColors idiom) |
 *   152..159 pad
 *
 * Slot (storage array element, {@link SLOT_STRIDE_BYTES} = 1120 stride);
 * slot count = transformCount + 1 + scheduleCount — the expanded transform
 * slots, then the final-transform lens slot (read only when hasFinal = 1,
 * never drawn by the transform pick), then the scheduled-hybrid post-word's
 * B slots (`chaos-game.ts`'s `PreparedSchedule`, affine-only: only
 * rowX/rowY/rowZ and cumWeight are meaningful, everything else stays at the
 * ArrayBuffer's zero default — `applySlot` on one is exactly the plain
 * affine, no variations, no post-rotation, no RNG). B slots start at index
 * `transformCount + 1` and are drawn only by the plot loop's own schedule
 * pick, never by the transform pick:
 *   0 rowX vec4f (m0 m1 m2 t0) | 16 rowY | 32 rowZ
 *   48 postX vec4f (symmetry post-rotation row, w unused) | 64 postY | 80 postZ
 *   96 varWeights array<vec4f, 5> | 176 varTypes array<vec4u, 5> (20 lanes of
 *   storage, 17 used — one per {@link VariationType}; `bulb` took
 *   the count past the 16 four vec4s held, and a vec4 array cannot be widened
 *   by less than four lanes, so three ride spare)
 *   256 varCount u32 | 260 hasPost u32 | 264 cumWeight f32
 *   268 colorIndex f32 | 272 colorSpeed f32 (the flam3 color pair,
 *   resolved per BASE map and written into EVERY kaleidoscope copy of it —
 *   exactly like cumWeight's base-map weight — so the kernel reads
 *   `slots[idx]` with no modulo) | 276..287 trailing pad (three spare words
 *   the 16-byte struct alignment demands once the pair grew the tail past 272)
 *   288 foldRadii array<vec4f, 3> — the fold family's AUTHORED
 *   lengths, indexed by variation type MINUS 12, i.e. [boxfold, spherefold,
 *   mandelbox]: (minRadius^2, fixedRadius^2, boxLimit, unused). SQUARED for
 *   the sphere pair because that is the form `foldVariationFn`'s closure
 *   computes once and the shape `fR2 / clamp(r2, mR2, fR2)` wants. Indexed
 *   by TYPE and not by variation LANE because a transform carries at most
 *   one entry per type (`packVariations`' own invariant), so three lanes
 *   cover every fold a slot can hold where seventeen would be needed to
 *   cover every lane.
 *   336 emitterFlag u32 | 340 emitterPartCount u32 | 344 emitterTotalWeight
 *   f32 | 348 pad — the shape-EMITTER (condensation) block
 *   `writeSlotEmitter` appends, an emitter being per-TRANSFORM data unlike
 *   the fold family's per-TYPE lane (`shapes.ts`'s vocabulary is per-part,
 *   not per-variation-type, so there is no "at most one per type" invariant
 *   to fold through). `emitterFlag` gates `applySlot`'s whole branch, the
 *   `weighted`/`chaosEnabled` idiom: 0 (the `ArrayBuffer`'s zero default,
 *   and every pre-emitter slot) is the byte-identical old path at zero
 *   extra cost beyond the one flag read.
 *   352 emitterParts array<EmitterPart, {@link MAX_SHAPE_PARTS}> (8 x 96 B
 *   = 768 B) — one block per `shapes.ts` `ShapePart`, laid out copy for
 *   copy with `emitterPartCount`/`emitterTotalWeight` above: part `i`'s
 *   cumulative pick weight rides its own `rot0.w` (see `EmitterPart`
 *   below), so a `partCount <= 1` slot (every shipped emitter, including
 *   `GEAR_SHAPE`) never runs the multi-part search at all.
 *   `EmitterPart` (96 B, 6 vec4f lanes):
 *     0 kindParams0 vec4f (x = kind: 0 sphere, 1 box, 2 torus, 3 capsule,
 *     4 gear; yzw = KIND-DEPENDENT, `emitterSamplePart`'s own table:
 *     sphere y=radius; box yzw=half; torus y=major z=minor; capsule
 *     yzw=a; gear y=gearTable offset z=triCount w=halfHeight)
 *     16 params1 vec4f (capsule only: xyz=b, w=radius; unread otherwise)
 *     32 poseOffsetScale vec4f (xyz = `ShapePose.offset`, w = resolved
 *     `ShapePose.scale`, absent-means-identity resolved host-side exactly
 *     like `shapes.ts`'s own `resolvePoseScale`/`poseOffset`)
 *     48 rot0 | 64 rot1 | 80 rot2 (the baked 3x3 forward pose rotation —
 *     `rotationMatrixXYZ`'s row-major output verbatim, `shapes.ts`'s
 *     `toWorld` convention and NOT `partSdf`'s transpose, since the
 *     emitter POSES a local-frame sample rather than inverting a query;
 *     absent rotation bakes the identity so the kernel applies it
 *     unconditionally, no branch) — rot0.w doubles as this part's
 *     cumulative weight (the vec4 lane the 3x3 leaves spare; rot1.w/rot2.w
 *     stay true padding).
 *   THE MIN-INDEX OVERLAP CORRECTION IS NOT REPRODUCED: `shapes.ts`'s
 *   sampler redraws a candidate an earlier part's SDF contains (exact
 *   uniformity on an overlapping union), an UNBOUNDED rejection loop this
 *   kernel's RNG-parity contract forbids on device; this kernel instead
 *   accepts the picked part's own sample unconditionally, so an
 *   overlapping multi-part spec's shared region samples at ELEVATED
 *   density here relative to the CPU oracle. Disclosed, not measured —
 *   every shipped emitter is single-part (`emitterPartCount` 1), where the
 *   search degenerates to picking part 0 and there is no overlap to
 *   correct, so this divergence is unreachable from any preset today.
 *
 * Chain (storage array element, {@link CHAIN_STRIDE_BYTES} = 32 stride):
 *   0 pos vec4f (xyz orbit point, w color coordinate) | 16 aux vec4u (x rng
 *   state, y the chain's odd PCG stream increment, z the graph-directed
 *   selection state word — low 16 bits `prevBase + 1` (0 = no previous map,
 *   the entry pick), high 16 bits the plotted-point count of the current
 *   chaos sub-orbit (both bounded far inside a half: MAX_TRANSFORMS is 256
 *   and CHAOS_SUB_ORBIT_POINTS 4096) — w unused. The +1/count-up encoding
 *   makes the ArrayBuffer's ZERO default exactly a fresh histogram's chi
 *   state (`orbitPrevBase` -1, a full sub-orbit ahead), so `packGpuChains`
 *   writes nothing for it and a chi-free document's chains buffer is
 *   byte-identical to before chi existed)
 *
 * colors: array<vec4u, 256> — legacy palette (entry per base transform) or
 * 256-entry gradient LUT, channels pre-scaled by
 * {@link COLOR_FIXED_POINT_SCALE}; the w lane is unused padding. A separate
 * echoColors table at binding 5 carries the independent balloon LUT; inherit
 * aliases this binding to colors but never reads it.
 *
 * chaosRows: array<f32> at binding 6 — the graph-directed selection rows
 * ({@link packChaosRowsTable}'s layout: per-BASE-row totals, then one
 * cumulative row per base over the EXPANDED slots), read only when
 * `chaosEnabled` is 1. A chi-free document aliases this binding to `colors`
 * exactly as an echo-less one aliases binding 5 — bound but never read.
 *
 * emitterGearTable: array<f32> at binding 7 — every gear-kind
 * `EmitterPart`'s host-triangulated triangle-fan CDF
 * ({@link buildGearTriangleTable}), concatenated back to back: one part's
 * region is `triCount` cumulative areas (ascending, `emitterDrawGear`'s
 * binary search) followed by `triCount` vertex triples (6 f32 each, a
 * flattened `vec2f x 3`) — `triCount` and the region's own start
 * (`kindParams0.y`/`.z`) live on the part, so no separate offset table is
 * needed. A document with no gear-shaped emitter part anywhere aliases this
 * binding to `colors`, exactly as an echo/chi-free document aliases
 * bindings 5/6 — bound but never read, since every slot's own
 * `emitterFlag`/part `kind` already gate whether the kernel ever indexes
 * it (no separate params-level flag exists for this binding, unlike
 * `chaosEnabled`: the gate is inherently per-slot already).
 *
 * hist: array<atomic<u32>>, `width * height * HIST_U32_PER_BUCKET`,
 * bucket layout as {@link HIST_U32_PER_BUCKET} describes.
 */
export const PARAMS_BYTES = 160;
export const SLOT_STRIDE_BYTES = 1120;
export const CHAIN_STRIDE_BYTES = 32;
export const COLORS_BYTES = 256 * 16;
/** One `EmitterPart`'s stride — 6 vec4f lanes (see the Slot layout doc's
 * `EmitterPart` entry). Exported for `flame-gpu-4d.ts`, which shares this
 * exact part encoding (the shape vocabulary is dimension-free — 3D always
 * — so a 4D slot's emitter block is this module's layout verbatim). */
export const EMITTER_PART_STRIDE_BYTES = 96;
/** Byte offset of Params.itersPerInvocation — the one field the driver
 * rewrites mid-session (warmup and final partial dispatches). */
export const PARAMS_ITERS_OFFSET_BYTES = 64;

/** The GPU counterpart of `chaos-game.ts`'s WARMUP_ITERATIONS semantics:
 * every chain runs this many unrecorded steps (the PLOT=false pipeline)
 * once per accumulation, so recording starts on the attractor — and, since
 * the chi lift, the same constant is the per-chain re-fuse warm-up length
 * interpolated into the kernel below. Same constant, per chain instead of
 * per orbit. */
export { WARMUP_ITERATIONS };

export const FLAME_GPU_KERNEL_WGSL = /* wgsl */ `
const ESCAPE_LIMIT: f32 = 50.0;
const PI: f32 = 3.14159265358979;
const EPS: f32 = 1e-12;

struct Params {
  projX: vec4f,
  projY: vec4f,
  projW: vec4f,
  width: u32,
  height: u32,
  transformCount: u32,
  baseTransformCount: u32,
  itersPerInvocation: u32,
  colorMode: u32,
  weighted: u32,
  hasFinal: u32,
  totalWeight: f32,
  numChains: u32,
  echoWeight: f32,
  echoRho: f32,
  echoCenterR2: vec4f,
  echoTintStrength: vec4f,
  echoPaletteEnabled: u32,
  scheduleCount: u32,
  scheduleDepth: u32,
  scheduleWeighted: u32,
  scheduleTotalWeight: f32,
  chaosEnabled: u32,
}

// One condensation-shape part's device data (shapes.ts's ShapePart, module
// doc's Slot entry): a kind-tagged primitive plus its similarity pose,
// baked host-side so the kernel applies rather than resolves it.
// kindParams0.x is the kind tag; the remaining six param lanes and rot0.w
// are KIND-/ROLE-DEPENDENT (see emitterSamplePart/emitterSampleSlot).
struct EmitterPart {
  kindParams0: vec4f,
  params1: vec4f,
  poseOffsetScale: vec4f,
  rot0: vec4f,
  rot1: vec4f,
  rot2: vec4f,
}

struct Slot {
  rowX: vec4f,
  rowY: vec4f,
  rowZ: vec4f,
  postX: vec4f,
  postY: vec4f,
  postZ: vec4f,
  varWeights: array<vec4f, 5>,
  varTypes: array<vec4u, 5>,
  varCount: u32,
  hasPost: u32,
  cumWeight: f32,
  colorIndex: f32,
  colorSpeed: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
  // The fold family's authored lengths, indexed by type - 12
  // ([boxfold, spherefold, mandelbox]) — (minRadius^2, fixedRadius^2,
  // boxLimit, unused). A transform carries at most one entry per type, so
  // three lanes cover every fold a slot can hold.
  foldRadii: array<vec4f, 3>,
  // Shape-emitter (condensation) block — writeSlotEmitter, module doc's
  // Slot entry. emitterFlag gates applySlot's whole branch (the
  // weighted/chaosEnabled idiom): 0, the ArrayBuffer's zero default and
  // every pre-emitter slot, is the byte-identical old path.
  emitterFlag: u32,
  emitterPartCount: u32,
  emitterTotalWeight: f32,
  _emitterPad: f32,
  emitterParts: array<EmitterPart, ${MAX_SHAPE_PARTS}>,
}

// "aux", not "meta": meta is a WGSL reserved identifier.
struct Chain {
  pos: vec4f,
  aux: vec4u,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> slots: array<Slot>;
@group(0) @binding(2) var<storage, read> colors: array<vec4u, 256>;
@group(0) @binding(3) var<storage, read_write> chains: array<Chain>;
@group(0) @binding(4) var<storage, read_write> hist: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read> echoColors: array<vec4u, 256>;
// Graph-directed selection rows (packChaosRowsTable's layout: per-BASE-row
// totals, then one cumulative row per base over the EXPANDED slots), read
// only when params.chaosEnabled is 1; a chi-free document aliases this
// binding to colors exactly as an echo-less one aliases binding 5.
@group(0) @binding(6) var<storage, read> chaosRows: array<f32>;
// Shape-emitter gear tables (module doc's binding-7 entry;
// buildGearTriangleTable/emitterDrawGear) — a document with no gear-shaped
// emitter part aliases this binding to colors, the same idiom.
@group(0) @binding(7) var<storage, read> emitterGearTable: array<f32>;

// Warmup dispatches run a PLOT=false specialization of this same pipeline —
// iterate the orbit without recording, like the CPU's unrecorded warmup.
override PLOT: bool = true;

// Emulated-u64 accumulate: add v to the lo word and carry into the hi word
// when lo wrapped. atomicAdd returns the PRE-add value, so "old > max - v"
// is exactly "old + v overflowed u32". Both adds commute with every other
// chain's, so the (lo, hi) pair is exact regardless of scheduling — the
// production fix for the spike kernel's 16.7M-hit fixed-point ceiling.
fn addU64(base: u32, v: u32) {
  let old = atomicAdd(&hist[base], v);
  if (old > 0xFFFFFFFFu - v) {
    atomicAdd(&hist[base + 1u], 1u);
  }
}

// One weighted splat into the shared histogram. Both the ordinary point and
// its optional balloon echo pass through this function, which mechanically
// prevents a second accumulation/tone-map path from creeping in.
fn depositPoint(p: vec3f, rgb: vec3u, weightFix: u32) {
  let cw = dot(params.projW.xyz, p) + params.projW.w;
  if (cw <= 0.0) {
    return;
  }
  let ndcX = (dot(params.projX.xyz, p) + params.projX.w) / cw;
  let ndcY = (dot(params.projY.xyz, p) + params.projY.w) / cw;
  let col = i32(floor((ndcX + 1.0) * 0.5 * f32(params.width)));
  let row = i32(floor((1.0 - ndcY) * 0.5 * f32(params.height)));
  if (col < 0 || col >= i32(params.width) || row < 0 || row >= i32(params.height)) {
    return;
  }
  let bucket = (u32(row) * params.width + u32(col)) * 8u;
  addU64(bucket, weightFix);
  addU64(bucket + 2u, rgb.x * weightFix);
  addU64(bucket + 4u, rgb.y * weightFix);
  addU64(bucket + 6u, rgb.z * weightFix);
}

// PCG-RXS-M-XS 32 with per-chain streams: rng.x the mutable state, rng.y the
// chain's odd LCG increment — PCG's stream selector. A shared
// increment would put every chain on the SAME full-period 2^32 cycle
// (Hull–Dobell: c odd, a = 1 mod 4), making chains phase-shifted copies of
// one sequence that replay each other's draws wherever their states drift
// near; distinct odd increments select distinct cycles, so chains are
// genuinely independent. Only .x advances — .y is read-only here.
fn pcgNext(rng: ptr<function, vec2u>) -> u32 {
  let s = (*rng).x * 747796405u + (*rng).y;
  (*rng).x = s;
  let word = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (word >> 22u) ^ word;
}

// [0, 1): top 24 bits are exact in f32, so the result is strictly below 1
// (f32(u32max) would round UP to 2^32 and return exactly 1.0).
fn rand01(rng: ptr<function, vec2u>) -> f32 {
  return f32(pcgNext(rng) >> 8u) * (1.0 / 16777216.0);
}

// --- shape emitter (condensation) sampling ----------------------------
//
// chaos-game.ts's contract: an emitter step draws EXACTLY ONE value from
// the PRIMARY stream (emitterSeed) to seed a DERIVED stream, and the
// sampler spends UNBOUNDEDLY from that derived stream alone — so the
// primary stream's cost per emitter step stays constant regardless of what
// the sampler does. Below that seed draw, this kernel does NOT mirror the
// CPU's own draw pattern (which includes an unbounded rejection loop for
// the torus and gear primitives, and for multi-part overlap correction —
// see the Slot layout doc's EmitterPart entry): REJECTION LOOPS ARE
// FORBIDDEN ON DEVICE (an unbounded or data-dependent retry is a device-hang
// hazard this codebase treats as a hard failure class elsewhere — see
// strip-planner.ts's i915 preemption notes), so every sampler below is a
// FIXED, bounded number of derived draws that reproduces the CPU's target
// MEASURE (uniform by volume/area) through a different, rejection-free
// algorithm rather than the CPU's own accept-reject one. The device
// sampler's individual POINTS therefore do not match the CPU's draw for
// draw — exactly the module doc's standing "statistically indistinguishable
// render, not a byte-identical one" contract one layer further in.

// chaos-game.ts's createEmitterStream (mulberry32), restated for a single
// u32 state — the DERIVED stream, kept separate from the primary PCG
// stream (pcgNext/rand01) above. Output normalization mirrors rand01's own
// top-24-bit convention (guaranteeing strictly < 1) rather than
// mulberry32's raw /2^32 division — not required to be bit-exact with the
// CPU's derived stream (see this section's own doc).
fn emitterNext(state: ptr<function, u32>) -> f32 {
  *state = (*state) + 0x6d2b79f5u;
  let seed = *state;
  var t: u32 = (seed ^ (seed >> 15u)) * (1u | seed);
  t = (t + ((t ^ (t >> 7u)) * (61u | t))) ^ t;
  return f32((t ^ (t >> 14u)) >> 8u) * (1.0 / 16777216.0);
}

// shapes.ts's drawBall: cbrt-radius, cosine-uniform direction — exact,
// constant-draw (3), no rejection; WGSL has no cbrt, but the argument is
// always >= 0 (emitterNext's range), so pow(x, 1/3) is exact for it.
fn emitterDrawBall(state: ptr<function, u32>) -> vec3f {
  let r = pow(emitterNext(state), 1.0 / 3.0);
  let ct = 2.0 * emitterNext(state) - 1.0;
  let st = sqrt(max(0.0, 1.0 - ct * ct));
  let ph = 2.0 * PI * emitterNext(state);
  return vec3f(r * st * cos(ph), r * st * sin(ph), r * ct);
}

fn emitterDrawSphere(state: ptr<function, u32>, radius: f32) -> vec3f {
  return emitterDrawBall(state) * radius;
}

fn emitterDrawBox(state: ptr<function, u32>, half: vec3f) -> vec3f {
  return vec3f(
    (2.0 * emitterNext(state) - 1.0) * half.x,
    (2.0 * emitterNext(state) - 1.0) * half.y,
    (2.0 * emitterNext(state) - 1.0) * half.z,
  );
}

// shapes.ts's torus sampler draws (theta, rho-quantile) exactly as below,
// then ACCEPT-REJECTS phi against the (major + rho*cos(phi)) volume
// weight — forbidden on device (this section's doc). The conditional
// density of phi given rho is (1 + e*cos(phi)) / (2*PI), e = rho/major;
// its CDF phi + e*sin(phi) = 2*PI*u is Kepler's equation, inverted here
// by a FIXED six-step Newton iteration from the mean-anomaly guess
// (standard practice for this exact equation, and reliable over this
// domain's e in [0, 1]) instead of rho's rejection loop — constant draws
// (3), zero rejection, matching the sampler's MEASURE rather than its
// algorithm.
fn emitterDrawTorus(state: ptr<function, u32>, major: f32, minor: f32) -> vec3f {
  let th = 2.0 * PI * emitterNext(state);
  let rho = minor * sqrt(emitterNext(state));
  let e = clamp(rho / max(major, 1e-9), 0.0, 1.0);
  let m = 2.0 * PI * emitterNext(state);
  var phi = m;
  for (var i = 0u; i < 6u; i++) {
    let f = phi + e * sin(phi) - m;
    let fp = 1.0 + e * cos(phi);
    phi = phi - f / max(fp, 1e-6);
  }
  let rad = major + rho * cos(phi);
  return vec3f(rad * cos(th), rad * sin(th), rho * sin(phi));
}

// shapes.ts's capsule sampler: one draw picks the cylinder body vs. the
// two end caps (weighted by volume — the caps are one full ball split by
// the axial plane, exactly like the CPU closure), each branch constant-draw
// and rejection-free already, so this needs no restatement beyond the
// orthonormal basis (wz, u, v) — cheap to re-derive on device from (a, b)
// rather than a third host-precomputed field.
fn emitterDrawCapsule(state: ptr<function, u32>, a: vec3f, b: vec3f, r: f32) -> vec3f {
  let ba = b - a;
  let len = length(ba);
  var wz = vec3f(0.0, 0.0, 1.0);
  if (len > 0.0) {
    wz = ba / len;
  }
  var pick = vec3f(1.0, 0.0, 0.0);
  if (abs(wz.x) >= 0.9) {
    pick = vec3f(0.0, 1.0, 0.0);
  }
  var u = cross(wz, pick);
  u = u / length(u);
  let v = cross(wz, u);
  let vCyl = PI * r * r * len;
  let vCaps = (4.0 / 3.0) * PI * r * r * r;
  if (emitterNext(state) * (vCyl + vCaps) < vCyl) {
    let t = emitterNext(state) * len;
    let rho = r * sqrt(emitterNext(state));
    let phi = 2.0 * PI * emitterNext(state);
    return a + wz * t + u * (rho * cos(phi)) + v * (rho * sin(phi));
  }
  let bp = emitterDrawBall(state) * r;
  var end = a;
  if (dot(bp, wz) >= 0.0) {
    end = b;
  }
  return end + bp;
}

// The gear profile's host-triangulated triangle-fan CDF
// (buildGearTriangleTable, module doc's binding-7 entry): draw picks a
// triangle by cumulative area (bounded binary search, pickSlot's own
// idiom), then an exact uniform point within it via the standard
// sqrt-barycentric construction — constant draws (4), zero rejection.
fn emitterDrawGear(state: ptr<function, u32>, tableOffset: u32, triCount: u32, halfHeight: f32) -> vec3f {
  let total = emitterGearTable[tableOffset + triCount - 1u];
  let needle = emitterNext(state) * total;
  var lo = 0u;
  var hi = triCount - 1u;
  loop {
    if (lo >= hi) {
      break;
    }
    let mid = (lo + hi) >> 1u;
    if (needle < emitterGearTable[tableOffset + mid]) {
      hi = mid;
    } else {
      lo = mid + 1u;
    }
  }
  let vBase = tableOffset + triCount + lo * 6u;
  let v0 = vec2f(emitterGearTable[vBase], emitterGearTable[vBase + 1u]);
  let v1 = vec2f(emitterGearTable[vBase + 2u], emitterGearTable[vBase + 3u]);
  let v2 = vec2f(emitterGearTable[vBase + 4u], emitterGearTable[vBase + 5u]);
  let su = sqrt(emitterNext(state));
  let u2 = emitterNext(state);
  let aw = 1.0 - su;
  let bw = (1.0 - u2) * su;
  let cw = u2 * su;
  let xy = v0 * aw + v1 * bw + v2 * cw;
  let z = (2.0 * emitterNext(state) - 1.0) * halfHeight;
  return vec3f(xy.x, xy.y, z);
}

// Dispatch one EmitterPart's own primitive sampler (its LOCAL-frame draw),
// then pose it exactly as shapes.ts's toWorld: scale, then rotate
// (part.rot0..2's baked row-major 3x3 — toWorld's FORWARD application, not
// partSdf's transpose), then offset.
fn emitterSamplePart(state: ptr<function, u32>, part: EmitterPart) -> vec3f {
  let kind = u32(part.kindParams0.x);
  var local: vec3f;
  switch kind {
    case 0u: { // sphere: kindParams0.y = radius.
      local = emitterDrawSphere(state, part.kindParams0.y);
    }
    case 1u: { // box: kindParams0.yzw = half extents.
      local = emitterDrawBox(state, part.kindParams0.yzw);
    }
    case 2u: { // torus: kindParams0.y = major, .z = minor.
      local = emitterDrawTorus(state, part.kindParams0.y, part.kindParams0.z);
    }
    case 3u: { // capsule: kindParams0.yzw = a, params1.xyz = b, .w = radius.
      local = emitterDrawCapsule(state, part.kindParams0.yzw, part.params1.xyz, part.params1.w);
    }
    default: { // 4u gear: kindParams0.y = tableOffset, .z = triCount, .w = halfHeight.
      local = emitterDrawGear(state, u32(part.kindParams0.y), u32(part.kindParams0.z), part.kindParams0.w);
    }
  }
  let scaled = local * part.poseOffsetScale.w;
  let rotated = vec3f(
    dot(part.rot0.xyz, scaled),
    dot(part.rot1.xyz, scaled),
    dot(part.rot2.xyz, scaled),
  );
  return rotated + part.poseOffsetScale.xyz;
}

// One slot's whole emitter sample: pick a part by volume-weighted
// cumulative search (partCount <= 1 skips the search entirely — the common
// case, GEAR_SHAPE and every shipped emitter included), then that part's
// own sampler + pose. Deliberately does NOT reproduce shapes.ts's
// min-index-acceptance overlap correction — see the Slot layout doc's
// EmitterPart entry for why (an unbounded rejection loop) and its measured
// scope (unreachable while every shipped emitter is single-part).
fn emitterSampleSlot(state: ptr<function, u32>, slotIdx: u32) -> vec3f {
  let partCount = slots[slotIdx].emitterPartCount;
  var pick = 0u;
  if (partCount > 1u) {
    let needle = emitterNext(state) * slots[slotIdx].emitterTotalWeight;
    var lo = 0u;
    var hi = partCount - 1u;
    loop {
      if (lo >= hi) {
        break;
      }
      let mid = (lo + hi) >> 1u;
      if (needle < slots[slotIdx].emitterParts[mid].rot0.w) {
        hi = mid;
      } else {
        lo = mid + 1u;
      }
    }
    pick = lo;
  }
  return emitterSamplePart(state, slots[slotIdx].emitterParts[pick]);
}

// The variation registry (variations.ts's VARIATIONS), case-indexed by
// KERNEL_VARIATION_INDEX. Same 3-D generalization: radial warps use the
// full 3-D radius, angular warps act in the xy-plane and carry z through.
fn applyVariation(t: u32, p: vec3f, rng: ptr<function, vec2u>, fr: vec3f) -> vec3f {
  switch t {
    case 0u: { // linear
      return p;
    }
    case 1u: { // sinusoidal
      return sin(p);
    }
    case 2u: { // spherical
      let c = 1.0 / (dot(p, p) + EPS);
      return p * c;
    }
    case 3u: { // swirl
      let r2 = dot(p, p);
      let s = sin(r2);
      let c = cos(r2);
      return vec3f(p.x * s - p.y * c, p.x * c + p.y * s, p.z);
    }
    case 4u: { // horseshoe
      let c = 1.0 / (length(p.xy) + EPS);
      return vec3f(c * (p.x - p.y) * (p.x + p.y), c * 2.0 * p.x * p.y, p.z);
    }
    case 5u: { // polar
      let rp = length(p.xy);
      return vec3f(atan2(p.y, p.x) / PI, rp - 1.0, p.z);
    }
    case 6u: { // handkerchief
      let rp = length(p.xy);
      let th = atan2(p.y, p.x);
      return vec3f(rp * sin(th + rp), rp * cos(th - rp), p.z);
    }
    case 7u: { // heart
      let rp = length(p.xy);
      let th = atan2(p.y, p.x);
      return vec3f(rp * sin(th * rp), -rp * cos(th * rp), p.z);
    }
    case 8u: { // disc
      let rp = length(p.xy);
      let th = atan2(p.y, p.x) / PI;
      let pr = PI * rp;
      return vec3f(th * sin(pr), th * cos(pr), p.z);
    }
    case 9u: { // spiral
      let rp = length(p.xy);
      let c = 1.0 / (rp + EPS);
      let th = atan2(p.y, p.x);
      return vec3f(c * (cos(th) + sin(rp)), c * (sin(th) - cos(rp)), p.z);
    }
    case 10u: { // bubble
      let c = 4.0 / (dot(p, p) + 4.0);
      return p * c;
    }
    case 11u: { // julia — draws one bit, like the CPU's rng() < 0.5.
      let rq = sqrt(length(p.xy));
      var th = atan2(p.y, p.x) / 2.0;
      if (rand01(rng) >= 0.5) {
        th += PI;
      }
      return vec3f(rq * cos(th), rq * sin(th), p.z);
    }
    case 12u: { // boxfold — per-axis reflection off the |t| = fr.z planes.
      return 2.0 * clamp(p, vec3f(-fr.z), vec3f(fr.z)) - p;
    }
    case 13u: { // spherefold — ball fold, fr = (mR2, fR2, wall).
      return p * (fr.y / clamp(dot(p, p), fr.x, fr.y));
    }
    case 14u: { // mandelbox — spherefold after boxfold, one variation.
      let b = 2.0 * clamp(p, vec3f(-fr.z), vec3f(fr.z)) - p;
      return b * (fr.y / clamp(dot(b, b), fr.x, fr.y));
    }
    case 15u: { // qsquare — quaternion square on w = 0; p.x is the real part.
      return vec3f(p.x * p.x - p.y * p.y - p.z * p.z, 2.0 * p.x * p.y, 2.0 * p.x * p.z);
    }
    case 16u: { // bulb — White/Nylander triplex 8th power, z the polar axis.
      // variations.ts's triplexPow8 term for term: Chebyshev T8/U7 in z/r
      // (homogenised) for the polar angle, three complex squarings for the
      // azimuth. No trig, so no acos/atan2 in the inner loop.
      let a = p.x * p.x + p.y * p.y;
      let r2 = a + p.z * p.z;
      let z2 = p.z * p.z;
      let r4 = r2 * r2;
      let zOut = 128.0 * z2 * z2 * z2 * z2 - 256.0 * z2 * z2 * z2 * r2 + 160.0 * z2 * z2 * r4 - 32.0 * z2 * r4 * r2 + r4 * r4;
      let s = 128.0 * z2 * z2 * z2 * p.z - 192.0 * z2 * z2 * p.z * r2 + 80.0 * z2 * p.z * r4 - 8.0 * p.z * r4 * r2;
      let rho = sqrt(a);
      let inv = select(0.0, 1.0 / rho, rho > 0.0);
      let u1 = p.x * inv;
      let v1 = p.y * inv;
      let u2 = u1 * u1 - v1 * v1;
      let v2 = 2.0 * u1 * v1;
      let u4 = u2 * u2 - v2 * v2;
      let v4 = 2.0 * u2 * v2;
      let u8 = u4 * u4 - v4 * v4;
      let v8 = 2.0 * u4 * v4;
      return vec3f(rho * s * u8, rho * s * v8, zOut);
    }
    default: {
      return p;
    }
  }
}

// One slot's full map: affine, then the weighted variation blend (left to
// right, so stochastic variations consume the RNG in list order), then the
// symmetry post-rotation. Mirrors accumulateFlame's inlined stepOrbit body —
// including its emitter (condensation) branch: when this slot's BASE
// transform carries a prepared emitter, the incoming point p and the
// variation blend are IGNORED and the new point is a fresh shape sample
// posed by this slot's OWN affine rows (stepOrbit's applyAffine(prepared.
// affines[idx], sample)), consuming exactly one primary rng draw beyond
// the transform pick regardless of what the sampler spends (emitterNext's
// own doc). Post-rotation is unconditional either way — a kaleidoscope
// copy's post-rotation bends an emitted point exactly as it bends a
// warped one.
fn applySlot(slotIdx: u32, p: vec3f, rng: ptr<function, vec2u>) -> vec3f {
  let s = slots[slotIdx];
  var q: vec3f;
  if (s.emitterFlag == 1u) {
    // pcgNext, not rand01: the seed wants the PRIMARY stream's full 32-bit
    // spread (emitterSeed's own CPU-side draw is full-width), where rand01's
    // f32 conversion only carries the top 24 bits.
    var derived = pcgNext(rng);
    let sample = emitterSampleSlot(&derived, slotIdx);
    q = vec3f(
      dot(s.rowX.xyz, sample) + s.rowX.w,
      dot(s.rowY.xyz, sample) + s.rowY.w,
      dot(s.rowZ.xyz, sample) + s.rowZ.w,
    );
  } else {
    let a = vec3f(
      dot(s.rowX.xyz, p) + s.rowX.w,
      dot(s.rowY.xyz, p) + s.rowY.w,
      dot(s.rowZ.xyz, p) + s.rowZ.w,
    );
    q = a;
    if (s.varCount > 0u) {
      var acc = vec3f(0.0);
      for (var v = 0u; v < s.varCount; v++) {
        // Lane reads go through the STORAGE REFERENCE (slots[slotIdx]), not
        // the value copy in "s": dynamically indexing an array inside a
        // let-bound composite VALUE is a spot where WGSL implementations
        // disagree (Tint accepts it; Naga/Firefox is stricter) — indexing
        // through a reference is unambiguously valid everywhere. The re-read
        // stays in cache; "s" still serves every constant-index field.
        let w = slots[slotIdx].varWeights[v >> 2u][v & 3u];
        let ty = slots[slotIdx].varTypes[v >> 2u][v & 3u];
        // The fold family (12..14) reads its own authored lengths off the
        // slot; every other type ignores the argument. Explicit bounds, not
        // an unchecked ty - 12u: the two escape-time maps sit at 15/16 and
        // would index past the three lanes.
        var fi = 0u;
        if (ty >= 12u && ty <= 14u) {
          fi = ty - 12u;
        }
        acc += w * applyVariation(ty, a, rng, slots[slotIdx].foldRadii[fi].xyz);
      }
      q = acc;
    }
  }
  if (s.hasPost == 1u) {
    q = vec3f(
      dot(s.postX.xyz, q),
      dot(s.postY.xyz, q),
      dot(s.postZ.xyz, q),
    );
  }
  return q;
}

// --- pickIndex (chaos-game.ts): the chi row draw when rows are present and
// the chain has a previous base, else uniform draw or weighted lower bound —
// the whole selection in ONE function so the main loop and the re-fuse
// warm-up cannot drift. EXACTLY ONE rand01 draw on every path (pickIndex's
// stream discipline), the same lower-bound search convention over each
// cumulative table, and pickIndex's degenerate-row tolerance: a row whose
// stored total is 0 — the packer transfers the oracle's own
// chaosFallbackRows decision as exactly that — falls through to the global
// table, one draw either way. prevBasePlus1 is the chi selection state's +1
// encoding (0 = no previous map, the entry pick, which uses the global
// table exactly as before chi existed). Row i's total sits at chaosRows[i];
// its cumulative row over the EXPANDED slots starts at
// baseTransformCount + i * transformCount (see the chaosRows layout doc).
fn pickSlot(rng: ptr<function, vec2u>, prevBasePlus1: u32) -> u32 {
  if (params.chaosEnabled == 1u && prevBasePlus1 != 0u) {
    let rowIdx = prevBasePlus1 - 1u;
    let rowTotal = chaosRows[rowIdx];
    if (rowTotal > 0.0) {
      let needle = rand01(rng) * rowTotal;
      let rowBase = params.baseTransformCount + rowIdx * params.transformCount;
      var lo = 0u;
      var hi = params.transformCount - 1u;
      loop {
        if (lo >= hi) {
          break;
        }
        let mid = (lo + hi) >> 1u;
        if (needle < chaosRows[rowBase + mid]) {
          hi = mid;
        } else {
          lo = mid + 1u;
        }
      }
      return lo;
    }
  }
  let r = rand01(rng);
  if (params.weighted == 1u) {
    // "needle", not "target": target is a WGSL reserved identifier.
    let needle = r * params.totalWeight;
    var lo = 0u;
    var hi = params.transformCount - 1u;
    loop {
      if (lo >= hi) {
        break;
      }
      let mid = (lo + hi) >> 1u;
      if (needle < slots[mid].cumWeight) {
        hi = mid;
      } else {
        lo = mid + 1u;
      }
    }
    return lo;
  }
  return min(u32(r * f32(params.transformCount)), params.transformCount - 1u);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn accumulate(@builtin(global_invocation_id) gid: vec3u) {
  let chainIdx = gid.x;
  if (chainIdx >= params.numChains) {
    return;
  }
  var pos = chains[chainIdx].pos.xyz;
  var colorCoord = chains[chainIdx].pos.w;
  var rng = chains[chainIdx].aux.xy;
  // Graph-directed selection state (aux.z — see the Chain layout doc): low
  // half prevBase + 1 (0 = the entry pick), high half the current chaos
  // sub-orbit's plotted-point count. A packed chain's zeroed word is
  // exactly a fresh histogram's state. Dead registers without chi rows.
  var chiPrev = chains[chainIdx].aux.z & 0xFFFFu;
  var chiSub = chains[chainIdx].aux.z >> 16u;

  for (var n = 0u; n < params.itersPerInvocation; n++) {
    // Sub-orbit re-fuse (chaos-game.ts's CHAOS_SUB_ORBIT_POINTS) —
    // accumulateFlame's chi block, per chain: every K PLOTTED points,
    // reseed the orbit from the one stream, reset to the entry pick, and
    // warm the fresh orbit up unrecorded, or a block-diagonal chi would
    // render only each chain's first block. The count-up twin of the CPU's
    // countdown, gated on PLOT exactly as the CPU counts recorded
    // iterations only — the backend's warmup dispatches never advance it.
    // The warm-up steps are EXTRA work beyond itersPerInvocation, mirroring
    // the CPU's own unrecorded loop; the color walk stays untouched during
    // them (stepOrbit never blends c) and resets to 0.5 after, exactly the
    // CPU order.
    if (PLOT && params.chaosEnabled == 1u) {
      if (chiSub >= ${CHAOS_SUB_ORBIT_POINTS}u) {
        pos = vec3f(rand01(&rng) - 0.5, rand01(&rng) - 0.5, rand01(&rng) - 0.5);
        chiPrev = 0u;
        for (var k = 0u; k < ${WARMUP_ITERATIONS}u; k++) {
          let wIdx = pickSlot(&rng, chiPrev);
          var wp = applySlot(wIdx, pos, &rng);
          if (!(abs(wp.x) <= ESCAPE_LIMIT && abs(wp.y) <= ESCAPE_LIMIT && abs(wp.z) <= ESCAPE_LIMIT)) {
            wp = vec3f(rand01(&rng) - 0.5, rand01(&rng) - 0.5, rand01(&rng) - 0.5);
            chiPrev = 0u;
          } else {
            chiPrev = wIdx % params.baseTransformCount + 1u;
          }
          pos = wp;
        }
        if (params.colorMode == 1u) {
          colorCoord = 0.5;
        }
        chiSub = 0u;
      }
      chiSub = chiSub + 1u;
    }

    // --- pickIndex (chaos-game.ts): uniform draw, or weighted lower bound —
    // and, since the chi lift, the prevBase row draw ahead of both; see
    // pickSlot above.
    let idx = pickSlot(&rng, chiPrev);
    // The BASE map this slot is a (possibly rotated) copy of — accumulateFlame's
    // own idx % baseTransformCount, kept here as the legacy per-transform
    // palette's lookup key at the bottom of the loop. The structural walk just
    // below needs no such fold: packGpuSystem already wrote base map i's color
    // pair into EVERY copy's slot (see the byte-layout doc).
    let baseIdx = idx % params.baseTransformCount;

    // Structural coloring: blend the color coordinate toward this transform's
    // palette slot, at this transform's own speed, BEFORE stepping — exactly
    // accumulateFlame's c = c * (1 - speed) + slot * speed, term for
    // term, and consuming no RNG so the orbit stays identical either way. At
    // the default speed 0.5 this is bit-identical to the halfway blend it
    // replaces: halving is exact in binary FP, so both forms round exactly
    // once, on the same sum.
    if (params.colorMode == 1u) {
      let speed = slots[idx].colorSpeed;
      colorCoord = colorCoord * (1.0 - speed) + slots[idx].colorIndex * speed;
    }

    var np = applySlot(idx, pos, &rng);

    // Escape-reseed, NaN-robust (see the module doc). An escape re-fuses
    // the chi selection state to the entry pick; otherwise the map that
    // produced this step becomes the next pick's prevBase — stepOrbit's
    // escaped/index contract exactly. chiPrev is dead state without chi
    // rows (pickSlot never reads it), so the unguarded update costs a
    // register write and changes nothing.
    if (!(abs(np.x) <= ESCAPE_LIMIT && abs(np.y) <= ESCAPE_LIMIT && abs(np.z) <= ESCAPE_LIMIT)) {
      np = vec3f(rand01(&rng) - 0.5, rand01(&rng) - 0.5, rand01(&rng) - 0.5);
      if (params.colorMode == 1u) {
        colorCoord = 0.5;
      }
      chiPrev = 0u;
    } else {
      chiPrev = baseIdx + 1u;
    }
    pos = np;

    if (PLOT) {
      var pp = pos;
      // Scheduled-hybrid post-word (chaos-game.ts's plotPoint, post-word
      // THEN lens): scheduleDepth B-picks — each ONE rand01 draw, exactly
      // the CPU's primary-stream rigidity — bending the plotted point
      // through the B slots appended after the lens slot. applySlot on a B
      // slot is the plain affine (varCount 0, hasPost 0 — see the Slot
      // layout doc), so no extra RNG is consumed beyond the picks. Adopted
      // only while finite (the lens's own < 1e30 f32 stand-in); on
      // overflow the word falls back to the pre-word point, exactly the
      // CPU rule. Zero draws and byte-identical behavior at depth 0.
      if (params.scheduleDepth > 0u) {
        let schedBase = params.transformCount + 1u;
        var sp = pp;
        for (var d = 0u; d < params.scheduleDepth; d++) {
          let sr = rand01(&rng);
          var si: u32;
          if (params.scheduleWeighted == 1u) {
            let sNeedle = sr * params.scheduleTotalWeight;
            var sLo = 0u;
            var sHi = params.scheduleCount - 1u;
            loop {
              if (sLo >= sHi) {
                break;
              }
              let sMid = (sLo + sHi) >> 1u;
              if (sNeedle < slots[schedBase + sMid].cumWeight) {
                sHi = sMid;
              } else {
                sLo = sMid + 1u;
              }
            }
            si = sLo;
          } else {
            si = min(u32(sr * f32(params.scheduleCount)), params.scheduleCount - 1u);
          }
          sp = applySlot(schedBase + si, sp, &rng);
        }
        if (abs(sp.x) < 1e30 && abs(sp.y) < 1e30 && abs(sp.z) < 1e30) {
          pp = sp;
        }
      }
      if (params.hasFinal == 1u) {
        // The lens bends the (possibly post-word-bent) plotted point — pp,
        // which IS pos when no schedule is present.
        let f = applySlot(params.transformCount, pp, &rng);
        // CPU adopts the lensed point only when all coordinates are finite;
        // < 1e30 is the f32 stand-in (inf and NaN both fail it).
        if (abs(f.x) < 1e30 && abs(f.y) < 1e30 && abs(f.z) < 1e30) {
          pp = f;
        }
      }
      var ci = baseIdx;
      if (params.colorMode == 1u) {
        ci = min(u32(colorCoord * 256.0), 255u);
      }
      let rgb = colors[ci].xyz;
      depositPoint(pp, rgb, ${WEIGHT_FIXED_POINT_SCALE}u);

      if (params.echoWeight > 0.0) {
        let d = pp - params.echoCenterR2.xyz;
        // The explorer shader's f32 centre floor, deliberately NOT the CPU
        // oracle's 1e-12*rho: f32 rounding around c is much larger.
        let centerFloor = 1e-6 * params.echoRho;
        let r2 = max(dot(d, d), centerFloor * centerFloor);
        let inv = params.echoCenterR2.xyz + (params.echoCenterR2.w / r2) * d;
        var echoBase = rgb;
        if (params.echoPaletteEnabled == 1u) {
          let u = clamp(length(d) / params.echoRho, 0.0, 1.0);
          let li = min(u32(u * 256.0), 255u);
          echoBase = echoColors[li].xyz;
        }
        let echoRgb = vec3u(round(mix(
          vec3f(echoBase),
          params.echoTintStrength.xyz * ${COLOR_FIXED_POINT_SCALE}.0,
          params.echoTintStrength.w,
        )));
        let echoWeightFix = u32(round(params.echoWeight * ${WEIGHT_FIXED_POINT_SCALE}.0));
        depositPoint(inv, echoRgb, echoWeightFix);
      }
    }
  }

  chains[chainIdx].pos = vec4f(pos, colorCoord);
  chains[chainIdx].aux.x = rng.x;
  // Chi selection state rides the chain across dispatches exactly as the
  // CPU's rides the histogram (orbitPrevBase/orbitChaosLeft), so the
  // re-fuse cadence is independent of dispatch boundaries. Guarded so a
  // chi-free document's chains buffer stays byte-identical in VRAM too.
  if (params.chaosEnabled == 1u) {
    chains[chainIdx].aux.z = (chiSub << 16u) | chiPrev;
  }
}
`;

/**
 * Byte-layout element offsets — 4-byte units into each buffer's combined
 * `Float32Array`/`Uint32Array` view, restating the byte-layout doc comment
 * above (divide any byte offset there by 4). Kept unexported: `flame-gpu.
 * test.ts` pins the CONTRACT (the byte-layout comment) with its own literal
 * offsets rather than importing these, so a mistake here could not
 * coincidentally agree with a matching mistake in the test.
 */
const F32_PER_SLOT = SLOT_STRIDE_BYTES / 4; // 280.
const SLOT_ROW_X = 0;
const SLOT_ROW_Y = 4;
const SLOT_ROW_Z = 8;
const SLOT_POST_X = 12;
const SLOT_POST_Y = 16;
const SLOT_POST_Z = 20;
/**
 * `varWeights: array<vec4f, 5>` — 20 lanes of storage, 17 used (one per
 * {@link VariationType}). A storage-buffer
 * `array<vec4, N>` has no inter-element padding (each `vec4` is already
 * 16-byte aligned, exactly its own size), so 5 consecutive vec4s are 20
 * CONTIGUOUS elements and lane `v` sits at `SLOT_VAR_WEIGHTS + v` directly —
 * matching the WGSL side's `varWeights[v >> 2u][v & 3u]` (vec4 index `v / 4`,
 * component `v % 4`, which is exactly linear index `v` again once the array
 * is flattened).
 */
const SLOT_VAR_WEIGHTS = 24;
/** `varTypes: array<vec4u, 5>` — same contiguous-lane reasoning as {@link SLOT_VAR_WEIGHTS}. */
const SLOT_VAR_TYPES = 44;
const SLOT_VAR_COUNT = 64;
const SLOT_HAS_POST = 65;
const SLOT_CUM_WEIGHT = 66;
/** The flam3 color pair, resolved per BASE map and replicated across its
 * kaleidoscope copies (see {@link packGpuSystem}) — the kernel's structural
 * walk reads them straight off the picked slot. */
const SLOT_COLOR_INDEX = 67;
const SLOT_COLOR_SPEED = 68;
// Elements 69-71 are Slot's trailing pad, left at the ArrayBuffer's zero
// default.
/**
 * `foldRadii: array<vec4f, 3>` — 12 lanes, indexed by variation
 * type MINUS 12, i.e. [boxfold, spherefold, mandelbox]. The same contiguous
 * reasoning as {@link SLOT_VAR_WEIGHTS}: three consecutive vec4s are 12
 * contiguous elements, so fold `i` sits at `SLOT_FOLD_RADII + i * 4`.
 */
const SLOT_FOLD_RADII = 72;
/**
 * Shape-emitter (condensation) block — `writeSlotEmitter`, byte-layout
 * doc's Slot entry. `emitterFlag`/`emitterPartCount`/`emitterTotalWeight`
 * are a header vec4 (element 87 its trailing pad); `emitterParts` is
 * `{@link MAX_SHAPE_PARTS}` contiguous {@link EMITTER_PART_STRIDE_BYTES}
 * (96 B = {@link F32_PER_EMITTER_PART} 24-element) blocks — part `i` at
 * `SLOT_EMITTER_PARTS + i * F32_PER_EMITTER_PART`.
 */
const SLOT_EMITTER_FLAG = 84;
const SLOT_EMITTER_PART_COUNT = 85;
const SLOT_EMITTER_TOTAL_WEIGHT = 86;
const SLOT_EMITTER_PARTS = 88;
/** One `EmitterPart`'s element offsets within its own 24-element block
 * (see {@link EMITTER_PART_STRIDE_BYTES}'s WGSL `EmitterPart` doc): two
 * kind-tagged param vec4s, the pose offset+scale vec4, then the baked 3x3
 * forward rotation across three vec4 rows — row 0's spare `.w` doubles as
 * this part's cumulative pick weight ({@link EP_ROT0} `+ 3`). */
const F32_PER_EMITTER_PART = EMITTER_PART_STRIDE_BYTES / 4; // 24.
const EP_KIND_PARAMS0 = 0;
const EP_PARAMS1 = 4;
const EP_POSE_OFFSET_SCALE = 8;
const EP_ROT0 = 12;
const EP_ROT1 = 16;
const EP_ROT2 = 20;

const F32_PER_CHAIN = CHAIN_STRIDE_BYTES / 4; // 8.
const CHAIN_POS = 0; // pos.xyzw: x, y, z, colorCoord.
const CHAIN_AUX_X = 4; // aux.x: rng state.
// aux.y: odd PCG stream increment. aux.z is the chi selection state word
// (see the Chain layout doc), whose zero default IS the fresh entry-pick
// state — so the packer writes nothing for it; aux.w unused, left zeroed.
const CHAIN_AUX_INC = 5;

/** Entries in the `colors` LUT/palette table — always the full 256, however
 * many are actually meaningful (see {@link packGpuSystem}'s `colorMode`). */
const COLOR_LUT_ENTRIES = 256;
/** `colors: array<vec4u, 256>` — 4 u32 lanes per entry (r, g, b, unused pad). */
const U32_PER_COLOR = 4;

const PARAMS_PROJ_X = 0;
const PARAMS_PROJ_Y = 4;
const PARAMS_PROJ_W = 8;
const PARAMS_WIDTH = 12;
const PARAMS_HEIGHT = 13;
const PARAMS_TRANSFORM_COUNT = 14;
const PARAMS_BASE_TRANSFORM_COUNT = 15;
// Reuse the exported byte offset (rather than a fresh literal) so the two
// can never silently drift apart — this is the one field the driver
// rewrites mid-session (see PARAMS_ITERS_OFFSET_BYTES's own doc).
const PARAMS_ITERS_PER_INVOCATION = PARAMS_ITERS_OFFSET_BYTES / 4;
const PARAMS_COLOR_MODE = 17;
const PARAMS_WEIGHTED = 18;
const PARAMS_HAS_FINAL = 19;
const PARAMS_TOTAL_WEIGHT = 20;
const PARAMS_NUM_CHAINS = 21;
const PARAMS_ECHO_WEIGHT = 22;
const PARAMS_ECHO_RHO = 23;
const PARAMS_ECHO_CENTER_R2 = 24;
const PARAMS_ECHO_TINT_STRENGTH = 28;
const PARAMS_ECHO_PALETTE_ENABLED = 32;
const PARAMS_SCHEDULE_COUNT = 33;
const PARAMS_SCHEDULE_DEPTH = 34;
const PARAMS_SCHEDULE_WEIGHTED = 35;
const PARAMS_SCHEDULE_TOTAL_WEIGHT = 36;
const PARAMS_CHAOS_ENABLED = 37;

/**
 * `chaos-game.ts`'s `symmetryRotation`, restated here (a deliberate
 * restatement — see the module doc's "restated, not imported" note): one
 * nonzero Euler angle for the requested w-free plane, matching
 * `prepareChaosGame`'s per-copy post-rotation exactly, including the plane →
 * Euler mapping the 4D kaleidoscope's axis migration pins there
 * (`yz`/`xz`/`xy` ← the legacy `x`/`y`/`z`, same matrices, same signs).
 *
 * Throws on a `w`-plane for the same reason the oracle does: this kernel is
 * the 3D flame's, and a 4D symmetry routes to `flame-gpu-4d.ts` instead.
 */
function symmetryPostRotation(
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
        `symmetryPostRotation: "${plane}" mixes w and has no 3x3 — a 4D ` +
          `symmetry plane must route to the 4D kernel`,
      );
  }
}

/**
 * Write one slot's affine rows ({@link SLOT_ROW_X} et al.) from a
 * `composeAffine` result: row `r`'s xyz is `m`'s row `r`, its w is `t[r]` —
 * the exact `m · p + t` `applyAffine` computes, restated as three
 * dot-product-ready vec4 rows for the kernel's `applySlot`.
 */
function writeSlotRows(
  f32: Float32Array,
  base: number,
  m: number[],
  t: readonly number[],
): void {
  f32[base + SLOT_ROW_X] = m[0];
  f32[base + SLOT_ROW_X + 1] = m[1];
  f32[base + SLOT_ROW_X + 2] = m[2];
  f32[base + SLOT_ROW_X + 3] = t[0];
  f32[base + SLOT_ROW_Y] = m[3];
  f32[base + SLOT_ROW_Y + 1] = m[4];
  f32[base + SLOT_ROW_Y + 2] = m[5];
  f32[base + SLOT_ROW_Y + 3] = t[1];
  f32[base + SLOT_ROW_Z] = m[6];
  f32[base + SLOT_ROW_Z + 1] = m[7];
  f32[base + SLOT_ROW_Z + 2] = m[8];
  f32[base + SLOT_ROW_Z + 3] = t[2];
}

/**
 * Write a copy's post-rotation rows and set `hasPost`. `post === null`
 * (copy 0, or any copy at symmetry order 1) leaves postX/Y/Z and `hasPost`
 * at the `ArrayBuffer`'s zero default — exactly the kernel's "no rotation"
 * case, mirroring `prepareChaosGame`'s `null` for the same slots.
 */
function writeSlotPost(
  f32: Float32Array,
  u32: Uint32Array,
  base: number,
  post: number[] | null,
): void {
  if (post === null) return;
  f32[base + SLOT_POST_X] = post[0];
  f32[base + SLOT_POST_X + 1] = post[1];
  f32[base + SLOT_POST_X + 2] = post[2];
  f32[base + SLOT_POST_Y] = post[3];
  f32[base + SLOT_POST_Y + 1] = post[4];
  f32[base + SLOT_POST_Y + 2] = post[5];
  f32[base + SLOT_POST_Z] = post[6];
  f32[base + SLOT_POST_Z + 1] = post[7];
  f32[base + SLOT_POST_Z + 2] = post[8];
  u32[base + SLOT_HAS_POST] = 1;
}

/**
 * `composeVariations`' filter (drop non-finite or zero weight) restated over
 * a transform's raw `Variation[]`, since the kernel wants (type, weight)
 * lanes rather than `composeVariations`' compiled closure. Order is
 * preserved — matching `composeVariations`' left-to-right RNG-consumption
 * order in the kernel's `applySlot` loop — and dropped entries are
 * compacted out rather than left as gaps.
 *
 * Throws `RangeError` if more than {@link MAX_SLOT_VARIATIONS} survive the
 * filter. Defensive: the lane count IS `VariationType`'s member count, and a
 * transform carries at most one entry per type (see `types.ts`'s `Variation`
 * for the convention and its enforcers — of which `morph.ts`'s type-keyed
 * union and `persist.ts`'s decode cap are the two that matter here),
 * so every legal transform already fits; this only fires if that union ever
 * grows without a matching bump to the Slot layout.
 *
 * Exported for `flame-gpu-4d.ts`: a variation list is
 * dimension-free data (`Variation[]` is shared by `Transform` and
 * `Transform4`), so the 4D packer reuses this filter/index mapping verbatim
 * rather than restating it.
 */
export function packVariations(variations: Transform["variations"]): {
  types: number[];
  weights: number[];
} {
  const active = (variations ?? []).filter(
    (v) => Number.isFinite(v.weight) && v.weight !== 0,
  );
  if (active.length > MAX_SLOT_VARIATIONS) {
    throw new RangeError(
      `packGpuSystem: transform has ${active.length} active variations, but a Slot carries at most MAX_SLOT_VARIATIONS (${MAX_SLOT_VARIATIONS})`,
    );
  }
  return {
    types: active.map((v) => KERNEL_VARIATION_INDEX[v.type]),
    weights: active.map((v) => v.weight),
  };
}

/**
 * Write a slot's variation lanes ({@link SLOT_VAR_WEIGHTS} / {@link
 * SLOT_VAR_TYPES}, {@link SLOT_VAR_COUNT}) from a transform's raw variation
 * list — see {@link packVariations}. An empty/absent list leaves every lane
 * and `varCount` at the `ArrayBuffer`'s zero default, which the kernel's
 * `applySlot` reads as "skip the blend, keep the affine result" (guarded by
 * `s.varCount > 0u`).
 */
function writeSlotVariations(
  f32: Float32Array,
  u32: Uint32Array,
  base: number,
  variations: Transform["variations"],
): void {
  const { types, weights } = packVariations(variations);
  for (const v of variations ?? []) {
    // The fold family's authored lengths, in the SQUARED form
    // `foldVariationFn`'s closure computes once — one lane per fold TYPE,
    // which is exact because a transform carries at most one entry per
    // type. Written straight from the raw list rather than from the
    // filtered lanes above: a zero-weight entry is dropped from the blend
    // either way, and keying on type means the two loops need not agree
    // about index.
    if (!isFoldVariationType(v.type)) continue;
    const r = resolveFoldRadii(v);
    const lane =
      base + SLOT_FOLD_RADII + (KERNEL_VARIATION_INDEX[v.type] - 12) * 4;
    f32[lane] = r.minRadius * r.minRadius;
    f32[lane + 1] = r.fixedRadius * r.fixedRadius;
    f32[lane + 2] = r.boxLimit;
  }
  for (let v = 0; v < types.length; v++) {
    f32[base + SLOT_VAR_WEIGHTS + v] = weights[v];
    u32[base + SLOT_VAR_TYPES + v] = types[v];
  }
  u32[base + SLOT_VAR_COUNT] = types.length;
}

// ------------------------------------------------------- shape emitters
//
// Everything below is DIMENSION-FREE (the shape vocabulary is 3D always —
// shapes.ts's own parity statement): flame-gpu-4d.ts's writeSlot4Emitter
// calls these directly rather than restating them, exactly like
// packChaosRowsTable/packVariations/writeColorEntry above.

/** One gear-kind `EmitterPart`'s region within the shared
 * `emitterGearTable` buffer (byte-layout doc's binding-7 entry): `offset`
 * is where its `triCount` cumulative areas start (its `triCount` vertex
 * triples follow immediately after — `emitterDrawGear`'s own layout).
 * `totalArea` is the region's own measured total — `buildGearTriangleTable`'s
 * last cumulative entry, carried out so {@link emitterPartWeight} and the
 * device table's own total can never disagree about what this part's area
 * is. */
export interface GearTableRegion {
  offset: number;
  triCount: number;
  totalArea: number;
}

/** Accumulates every gear-kind `EmitterPart`'s triangulated region into
 * ONE flat buffer for a whole packed system — {@link packGpuSystem}/
 * `packGpuSystem4` each own one instance for their own kernel's binding 7;
 * {@link finishGearTableBuilder} converts it once, after every slot in
 * that system has been packed. */
export interface GearTableBuilder {
  floats: number[];
}

export function createGearTableBuilder(): GearTableBuilder {
  return { floats: [] };
}

/** `null` when nothing was accumulated (no gear-shaped emitter part
 * anywhere in the system) — {@link PackedGpuSystem.gearTable}'s value, the
 * `chaosRows`/echo-colors null-means-alias-an-existing-binding idiom one
 * binding further (binding 7's own doc). */
export function finishGearTableBuilder(
  builder: GearTableBuilder,
): ArrayBuffer | null {
  if (builder.floats.length === 0) return null;
  return new Float32Array(builder.floats).buffer;
}

/**
 * Restates `shapes.ts`'s private `gearProfileSdf` (the module doc's
 * "restated, not imported" pattern — `symmetryPostRotation`'s own
 * precedent above), operation for operation, PURELY to triangulate the
 * profile host-side ({@link buildGearTriangleTable}); the CPU sampler's
 * own algorithm (`shapes.ts`'s `prepareShapeSampler`) is untouched and
 * stays the oracle the agreement gate pins against.
 */
function gearProfileSdfForTable(
  teeth: number,
  radius: number,
  tooth0: number,
  tooth1: number,
  hole: number,
  px: number,
  py: number,
): number {
  const t = Number.isFinite(teeth) ? Math.max(1, Math.round(teeth)) : 1;
  const seg = (2 * Math.PI) / t;
  const lp = Math.hypot(px, py);
  const a0 = Math.atan2(py, px) + seg * 0.5;
  const a1 = a0 - seg * Math.floor(a0 / seg) - seg * 0.5;
  const gx = Math.cos(a1) * lp - radius;
  const gy = Math.sin(a1) * lp;
  const dx = Math.abs(gx) - tooth0;
  const dy = Math.abs(gy) - tooth1;
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  const boxD = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0);
  let d = Math.min(lp - radius, boxD);
  if (hole > 0) d = Math.max(d, hole - lp);
  return d;
}

function emitterTriangleArea(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): number {
  return (
    Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
  );
}

/** Angular resolution for {@link buildGearTriangleTable}'s outer
 * boundary — scales with tooth count (so a many-toothed gear's teeth stay
 * resolved) inside a floor/ceiling that bounds the device table's size. */
const GEAR_TABLE_MIN_STEPS = 64;
const GEAR_TABLE_MAX_STEPS = 512;
const GEAR_TABLE_STEPS_PER_TOOTH = 16;
/** Bisection iterations for the outer-boundary root find — 40 halvings
 * narrows any realistic bracket to far past f32 precision. */
const GEAR_TABLE_BISECT_ITERATIONS = 40;

/**
 * Triangulate a gear primitive's solid 2D profile (byte-layout doc's
 * binding-7 entry) into a triangle-fan CDF: {@link GEAR_TABLE_MIN_STEPS}..
 * {@link GEAR_TABLE_MAX_STEPS} outer-boundary points found by BISECTION
 * against {@link gearProfileSdfForTable} — robust, because the whole body
 * disc up to `radius` is inside the profile at every angle by
 * construction (so `radius` is always a valid "inside" low bracket) and a
 * tooth-box corner bounds the farthest possible point (a valid "outside"
 * high one) — paired with the inner hole circle (radius 0 when `hole` is
 * absent, which collapses every "inner" triangle to zero area: a plain
 * fan falls out of this quad-strip construction rather than needing its
 * own branch) into `2 * steps` triangles, APPENDED to `builder` as
 * [cumulative areas ascending, then `2 * steps` vertex triples] —
 * `emitterDrawGear`'s own layout. Deterministic (no RNG, unlike
 * `shapes.ts`'s seeded-Monte-Carlo area measure, which this module cannot
 * reach — it is private): two calls on the same primitive always agree
 * bit for bit.
 */
export function buildGearTriangleTable(
  prim: Extract<ShapePrimitive, { kind: "gear" }>,
  builder: GearTableBuilder,
): GearTableRegion {
  const teeth = Number.isFinite(prim.teeth)
    ? Math.max(1, Math.round(prim.teeth))
    : 1;
  const steps = Math.max(
    GEAR_TABLE_MIN_STEPS,
    Math.min(GEAR_TABLE_MAX_STEPS, teeth * GEAR_TABLE_STEPS_PER_TOOTH),
  );
  const innerR = prim.hole > 0 ? prim.hole : 0;
  const outerR = prim.radius + prim.tooth[0];
  const searchHi = Math.hypot(outerR, prim.tooth[1]) * 1.001;
  const outer: [number, number][] = new Array<[number, number]>(steps);
  for (let i = 0; i < steps; i++) {
    const theta = (2 * Math.PI * i) / steps;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    let lo = prim.radius;
    let hi = searchHi;
    for (let iter = 0; iter < GEAR_TABLE_BISECT_ITERATIONS; iter++) {
      const mid = (lo + hi) / 2;
      const d = gearProfileSdfForTable(
        teeth,
        prim.radius,
        prim.tooth[0],
        prim.tooth[1],
        prim.hole,
        mid * ct,
        mid * st,
      );
      if (d <= 0) lo = mid;
      else hi = mid;
    }
    outer[i] = [lo * ct, lo * st];
  }
  const triCount = 2 * steps;
  const cumAreas = new Array<number>(triCount);
  const verts: [number, number][][] = new Array<[number, number][]>(triCount);
  let running = 0;
  for (let i = 0; i < steps; i++) {
    const j = (i + 1) % steps;
    const thetaI = (2 * Math.PI * i) / steps;
    const thetaJ = (2 * Math.PI * j) / steps;
    const innerI: [number, number] = [
      innerR * Math.cos(thetaI),
      innerR * Math.sin(thetaI),
    ];
    const innerJ: [number, number] = [
      innerR * Math.cos(thetaJ),
      innerR * Math.sin(thetaJ),
    ];
    running += emitterTriangleArea(innerI, innerJ, outer[i]);
    cumAreas[2 * i] = running;
    verts[2 * i] = [innerI, innerJ, outer[i]];
    running += emitterTriangleArea(innerJ, outer[j], outer[i]);
    cumAreas[2 * i + 1] = running;
    verts[2 * i + 1] = [innerJ, outer[j], outer[i]];
  }
  const offset = builder.floats.length;
  for (let k = 0; k < triCount; k++) builder.floats.push(cumAreas[k]);
  for (let k = 0; k < triCount; k++) {
    for (const [x, y] of verts[k]) builder.floats.push(x, y);
  }
  return { offset, triCount, totalArea: running };
}

/** Restates `shapes.ts`'s private `resolvePoseScale`: non-finite or
 * non-positive resolves to the identity (that module's pose-domain rule). */
function resolveEmitterPoseScale(pose: ShapePose | undefined): number {
  const s = pose?.scale;
  return typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 1;
}

/** Restates `shapes.ts`'s private `poseOffset`'s VALUE (not its skip
 * optimization, which only matters for codegen): absent is the identity
 * offset. */
function resolveEmitterOffset(pose: ShapePose | undefined): Vec3 {
  return pose?.offset ?? [0, 0, 0];
}

/** Restates `shapes.ts`'s private `poseRotation`, baked as an explicit
 * row-major 3x3 (the identity when absent/zero, `rotationMatrixXYZ`'s own
 * output otherwise) rather than returning `null`: the device applies this
 * matrix unconditionally (byte-layout doc's `EmitterPart` entry), so an
 * identity must be a real matrix, not a skipped step. */
function resolveEmitterRotation(pose: ShapePose | undefined): number[] {
  const r = pose?.rotate;
  if (!r || (r[0] === 0 && r[1] === 0 && r[2] === 0)) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  return rotationMatrixXYZ(r[0], r[1], r[2]);
}

/**
 * Restates `shapes.ts`'s private `primitiveVolume(prim) * scale ** 3` —
 * the SAME weight `prepareShapeSampler` gives each part in its
 * volume-proportional pick, so this packer's multi-part search agrees
 * with the CPU oracle's about which part is "big". `gearArea` is
 * {@link buildGearTriangleTable}'s OWN measured total (not `shapes.ts`'s
 * private seeded-Monte-Carlo `gearProfileMeasures`, which this module
 * cannot reach), so a gear part's weight here and its device table's own
 * total can never disagree about what "this part's area" means; ignored
 * for every other kind.
 */
export function emitterPartWeight(part: ShapePart, gearArea: number): number {
  const prim = part.primitive;
  const scale = resolveEmitterPoseScale(part.pose);
  let volume: number;
  switch (prim.kind) {
    case "sphere":
      volume = Math.max(0, (4 / 3) * Math.PI * prim.radius ** 3);
      break;
    case "box":
      volume = Math.max(0, 8 * prim.half[0] * prim.half[1] * prim.half[2]);
      break;
    case "torus":
      volume = Math.max(
        0,
        2 * Math.PI * Math.PI * prim.major * prim.minor ** 2,
      );
      break;
    case "capsule": {
      const len = Math.hypot(
        prim.b[0] - prim.a[0],
        prim.b[1] - prim.a[1],
        prim.b[2] - prim.a[2],
      );
      const r = Math.max(0, prim.radius);
      volume = Math.PI * r * r * len + (4 / 3) * Math.PI * r ** 3;
      break;
    }
    case "gear":
      volume = Math.max(0, gearArea * 2 * prim.halfHeight);
      break;
  }
  return volume * scale ** 3;
}

/**
 * Write one `EmitterPart` block (byte-layout doc's `EmitterPart` entry) at
 * `base`: the kind tag + up to seven kind-dependent params (gear's are a
 * {@link buildGearTriangleTable} region's `offset`/`triCount` plus
 * `halfHeight` — never the raw teeth/radius/tooth/hole; the device sampler
 * never re-triangulates, `gearRegion` non-null exactly when `part.primitive.
 * kind === "gear"`), the baked similarity pose (scale, `rotationMatrixXYZ`'s
 * row-major 3x3 applied FORWARD — `shapes.ts`'s `toWorld` convention, not
 * `partSdf`'s transpose — then offset), and this part's cumulative pick
 * weight in `rot0`'s spare `.w` lane.
 */
export function writeEmitterPart(
  f32: Float32Array,
  base: number,
  part: ShapePart,
  cumWeight: number,
  gearRegion: GearTableRegion | null,
): void {
  const prim = part.primitive;
  const kp = base + EP_KIND_PARAMS0;
  const p1 = base + EP_PARAMS1;
  switch (prim.kind) {
    case "sphere":
      f32[kp] = 0;
      f32[kp + 1] = prim.radius;
      break;
    case "box":
      f32[kp] = 1;
      f32[kp + 1] = prim.half[0];
      f32[kp + 2] = prim.half[1];
      f32[kp + 3] = prim.half[2];
      break;
    case "torus":
      f32[kp] = 2;
      f32[kp + 1] = prim.major;
      f32[kp + 2] = prim.minor;
      break;
    case "capsule":
      f32[kp] = 3;
      f32[kp + 1] = prim.a[0];
      f32[kp + 2] = prim.a[1];
      f32[kp + 3] = prim.a[2];
      f32[p1] = prim.b[0];
      f32[p1 + 1] = prim.b[1];
      f32[p1 + 2] = prim.b[2];
      f32[p1 + 3] = prim.radius;
      break;
    case "gear": {
      // gearRegion is built once by the caller's own first pass over
      // parts (writeSlotEmitter/writeSlot4Emitter) — never rebuilt here,
      // since buildGearTriangleTable is not free and its weight is needed
      // ahead of any part's write (cumWeight, above).
      const region = gearRegion as GearTableRegion;
      f32[kp] = 4;
      f32[kp + 1] = region.offset;
      f32[kp + 2] = region.triCount;
      f32[kp + 3] = prim.halfHeight;
      break;
    }
  }
  const offset = resolveEmitterOffset(part.pose);
  const scale = resolveEmitterPoseScale(part.pose);
  const po = base + EP_POSE_OFFSET_SCALE;
  f32[po] = offset[0];
  f32[po + 1] = offset[1];
  f32[po + 2] = offset[2];
  f32[po + 3] = scale;
  const rot = resolveEmitterRotation(part.pose);
  const r0 = base + EP_ROT0;
  f32[r0] = rot[0];
  f32[r0 + 1] = rot[1];
  f32[r0 + 2] = rot[2];
  f32[r0 + 3] = cumWeight;
  const r1 = base + EP_ROT1;
  f32[r1] = rot[3];
  f32[r1 + 1] = rot[4];
  f32[r1 + 2] = rot[5];
  const r2 = base + EP_ROT2;
  f32[r2] = rot[6];
  f32[r2 + 1] = rot[7];
  f32[r2 + 2] = rot[8];
}

/**
 * Write one slot's emitter block (byte-layout doc's Slot entry) from the
 * BASE map's raw `ShapeSpec`, or leave it at the `ArrayBuffer`'s zero
 * default when `spec` is `undefined` — the caller (`packGpuSystem`) passes
 * `undefined` for every transform `prepareEmitters` didn't return a
 * sampler for (absent field OR the unsamplable-spec fallback), which is
 * how this packer and the CPU oracle can never disagree about WHICH
 * transforms are emitters, even though they don't share the sampling code
 * itself (see the Slot layout doc's min-index-overlap note). Every gear
 * part triangulates exactly once (a first pass computes every part's
 * weight — gear's from its own fresh table — before any part is written,
 * since `cumWeight` needs every earlier part's weight already summed).
 */
function writeSlotEmitter(
  f32: Float32Array,
  u32: Uint32Array,
  base: number,
  spec: ShapeSpec | undefined,
  gearBuilder: GearTableBuilder,
): void {
  if (spec === undefined) return;
  const n = Math.min(spec.parts.length, MAX_SHAPE_PARTS);
  if (n <= 0) return;
  u32[base + SLOT_EMITTER_FLAG] = 1;
  u32[base + SLOT_EMITTER_PART_COUNT] = n;
  const gearRegions: (GearTableRegion | null)[] =
    new Array<GearTableRegion | null>(n);
  const weights = new Array<number>(n);
  let totalWeight = 0;
  for (let i = 0; i < n; i++) {
    const part = spec.parts[i];
    if (part.primitive.kind === "gear") {
      const region = buildGearTriangleTable(part.primitive, gearBuilder);
      gearRegions[i] = region;
      weights[i] = emitterPartWeight(part, region.totalArea);
    } else {
      gearRegions[i] = null;
      weights[i] = emitterPartWeight(part, 0);
    }
    totalWeight += weights[i];
  }
  f32[base + SLOT_EMITTER_TOTAL_WEIGHT] = totalWeight;
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += weights[i];
    writeEmitterPart(
      f32,
      base + SLOT_EMITTER_PARTS + i * F32_PER_EMITTER_PART,
      spec.parts[i],
      cum,
      gearRegions[i],
    );
  }
}

/**
 * Write one `colors` entry: channels pre-scaled by
 * {@link COLOR_FIXED_POINT_SCALE} and rounded to the nearest integer, so the
 * kernel's `addU64` only ever adds integers (see {@link convertGpuHistogram}
 * for the inverse on readback). The w lane is left at the `ArrayBuffer`'s
 * zero default (unused padding).
 *
 * Exported for `flame-gpu-4d.ts`: the `colors` table's entry layout
 * (and its fixed-point scale) is identical one dimension up, so the 4D
 * packer writes its LUT/palette entries through this same helper.
 */
export function writeColorEntry(
  colorsU32: Uint32Array,
  index: number,
  r: number,
  g: number,
  b: number,
): void {
  const o = index * U32_PER_COLOR;
  colorsU32[o] = Math.round(r * COLOR_FIXED_POINT_SCALE);
  colorsU32[o + 1] = Math.round(g * COLOR_FIXED_POINT_SCALE);
  colorsU32[o + 2] = Math.round(b * COLOR_FIXED_POINT_SCALE);
}

/** Pack one already-resolved 256-entry RGB LUT into the GPU colors-table
 * layout without involving the primary flame palette. */
export function packGpuColorLUT(lut: Float32Array): ArrayBuffer {
  if (lut.length !== COLOR_LUT_ENTRIES * 3) {
    throw new RangeError(
      `packGpuColorLUT: expected ${COLOR_LUT_ENTRIES * 3} values, got ${lut.length}`,
    );
  }
  const colors = new ArrayBuffer(COLORS_BYTES);
  const colorsU32 = new Uint32Array(colors);
  for (let i = 0; i < COLOR_LUT_ENTRIES; i++) {
    writeColorEntry(colorsU32, i, lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]);
  }
  return colors;
}

/**
 * A chaos-game system in exactly the shape {@link packGpuSystem} needs — the
 * GPU counterpart of the arguments `prepareChaosGame` (`transforms`,
 * `finalTransform`, `symmetry`) and `accumulateFlame` (`palette`/`colorLUT`,
 * folded here into one `palette`) take.
 */
export interface GpuFlameSystemSpec {
  transforms: Transform[];
  finalTransform: Transform | null;
  symmetry: SymmetryParams;
  /** `"legacy"` selects the kernel's per-(base)transform color mode
   * (`colorMode` 0); anything else selects the 256-entry gradient LUT mode
   * (`colorMode` 1) — see `palette.ts`'s `buildPaletteLUT`. */
  palette: PaletteSpec;
  /** The scheduled-hybrid post-word block ({@link HybridSchedule}) — B's
   * affine-only maps appended as extra slots after the lens slot, drawn by
   * the kernel's plot-time schedule pick. Absent/`null`/empty is the
   * byte-identical no-post-word path (zero extra slots, `scheduleDepth`
   * 0). */
  schedule?: HybridSchedule | null;
}

/**
 * {@link packGpuSystem}'s result: the packed GPU buffers plus the scalar
 * fields {@link packGpuParams} needs to describe them — split out rather
 * than forcing the caller to re-derive `transformCount`/`weighted`/etc. from
 * raw bytes.
 */
export interface PackedGpuSystem {
  /** `(transformCount + 1 + scheduleCount) * SLOT_STRIDE_BYTES` — one slot
   * per expanded (copy, base transform) pair, plus the final-transform lens
   * slot, plus the schedule's B slots (see the byte-layout doc). */
  slots: ArrayBuffer;
  /** {@link COLORS_BYTES} — always the full 256-entry table, however many
   * entries are actually meaningful (see `colorMode`). */
  colors: ArrayBuffer;
  /** Expanded slot count feeding the kernel's `pickIndex` — `order *
   * baseTransformCount`. */
  transformCount: number;
  baseTransformCount: number;
  weighted: boolean;
  totalWeight: number;
  colorMode: 0 | 1;
  hasFinal: boolean;
  /** B slot count — 0 exactly when the spec carries no live schedule. */
  scheduleCount: number;
  /** The post-word's depth k (0 = no post-word), through the ONE shared
   * `resolveScheduleDepth` domain. */
  scheduleDepth: number;
  /** B's own weighted-draw flag/total — `buildScheduleTable`'s, the same
   * table the CPU's `prepareSchedule` builds. */
  scheduleWeighted: boolean;
  scheduleTotalWeight: number;
  /** The graph-directed selection rows ({@link packChaosRowsTable}'s
   * layout — `buildChaosSelection`'s own numbers, transferred), or `null`
   * for a system with no non-trivial chi row — in which case the kernel's
   * chi branch never engages (`chaosEnabled` 0) and the backend aliases
   * binding 6 exactly as an echo-less one aliases binding 5. */
  chaosRows: ArrayBuffer | null;
  /** Every gear-shaped emitter part's triangulated table
   * ({@link buildGearTriangleTable}, byte-layout doc's binding-7 entry),
   * concatenated by {@link finishGearTableBuilder}, or `null` when the
   * system has no gear-shaped emitter part anywhere — the `chaosRows`
   * `null`-means-alias-an-existing-binding idiom one binding further. */
  gearTable: ArrayBuffer | null;
}

/**
 * Pack a {@link GpuFlameSystemSpec} into the kernel's Slot storage buffer and
 * 256-entry colors buffer — the flat-buffer restatement of `chaos-game.ts`'s
 * `prepareChaosGame` expansion and `flame.ts`'s `accumulateFlame` weight/
 * color handling (the spike's packing, ported to this module's
 * {@link MAX_SLOT_VARIATIONS}-variation-lane, 64-bit-histogram Slot layout —
 * see the module doc for what changed and why).
 *
 * Throws `RangeError` if `transforms.length` exceeds `MAX_TRANSFORMS` — same
 * check and message shape as `prepareChaosGame`.
 *
 * **Geometric expansion** mirrors `prepareChaosGame` exactly: `order =
 * effectiveSymmetryOrder(symmetry.order, baseTransformCount)`, then slot `k *
 * baseTransformCount + i` (copy-major: every copy's base maps together, copy
 * 0 first) holds base map `i`'s affine and its OWN variation list (each copy
 * re-derives the same base transform independently, rather than sharing one
 * packed instance — a deliberate, harmless redundancy that mirrors
 * `prepareChaosGame` sharing one composed affine/variation BY REFERENCE
 * across copies), plus copy `k`'s post-rotation: `null`/zeroed for `k = 0`,
 * `rotationMatrixXYZ` in `symmetry.plane` by `2π·k / order` otherwise (see
 * {@link symmetryPostRotation}) — `hasPost` is set only in the latter case.
 *
 * **Weights**: slot `s`'s weight is `transforms[s % baseTransformCount]
 * .weight ?? 1` (every copy of a base map shares its weight), `cumWeight` is
 * the running sum, and `weighted` uses the same
 * `some(weight !== 1) && totalWeight > 0 && Number.isFinite(totalWeight)`
 * test as `prepareChaosGame`. The one deliberate divergence is documented
 * beside the table below: this packer does not apply `symmetry.blend` to
 * rotated copies.
 *
 * **Color slots**: every slot also carries the flam3 pair the
 * kernel's structural walk blends with — `colorIndex` (the transform's own, or
 * `derivedColorIndex(i, baseTransformCount)`'s even spread) and `colorSpeed`
 * (its own, or `DEFAULT_COLOR_SPEED`). Both are resolved from the BASE map and
 * written into EVERY copy of it, exactly as the weights are, which is what
 * lets the kernel read `slots[idx]` with no `% baseTransformCount` fold —
 * while still coloring each kaleidoscope copy as the map it is a copy of, the
 * property `accumulateFlame` gets from indexing its own tables by `baseIdx`.
 * The final-lens slot is never picked, so its pair stays at the
 * `ArrayBuffer`'s zero default.
 *
 * **Final transform**: one extra slot at index `transformCount` (never drawn
 * by `pickIndex`, since `params.transformCount` bounds that search) carrying
 * the final transform's affine + variations, with `hasPost` left at 0 (a
 * lens never rotates). Absent ⇒ the slot stays at the `ArrayBuffer`'s zero
 * default and `hasFinal` is `false`.
 *
 * **Colors**: `palette === "legacy"` packs `transformColors(baseTransformCount,
 * colorIndexes)` (one entry per BASE map, `colorMode = 0`) — each map's
 * authored `colorIndex` picks its hue exactly like the CPU legacy
 * path, since the shader only ever indexes this precomputed table, never
 * computes a hue itself; anything else packs the 256-entry
 * `buildPaletteLUT(palette)` gradient (`colorMode = 1`). Either way each
 * channel goes through {@link writeColorEntry}'s fixed-point scale.
 */
export function packGpuSystem(spec: GpuFlameSystemSpec): PackedGpuSystem {
  const { transforms, finalTransform, symmetry, palette } = spec;
  if (transforms.length > MAX_TRANSFORMS) {
    throw new RangeError(
      `IFS supports at most ${MAX_TRANSFORMS} transforms, got ${transforms.length}`,
    );
  }
  // The scheduled-hybrid post-word, through the ONE shared consumption
  // domain (`resolveScheduleDepth`) so the CPU oracle and this packer can
  // never disagree on when a block is live.
  const schedule = spec.schedule ?? null;
  const scheduleDepth = resolveScheduleDepth(schedule);
  const scheduleTransforms =
    scheduleDepth > 0 && schedule ? schedule.transforms : [];
  const scheduleCount = scheduleTransforms.length;

  const baseTransformCount = transforms.length;
  const baseAffines = transforms.map(composeAffine);
  const order = effectiveSymmetryOrder(symmetry.order, baseTransformCount);
  const transformCount = order * baseTransformCount;
  const hasFinal = finalTransform !== null;

  const slots = new ArrayBuffer(
    (transformCount + 1 + scheduleCount) * SLOT_STRIDE_BYTES,
  );
  const slotF32 = new Float32Array(slots);
  const slotU32 = new Uint32Array(slots);

  // Selection weights over the EXPANDED slots (never the final slot, which
  // pickIndex never draws): every slot inherits its base map's weight,
  // defaulting to 1. This deliberately differs from prepareChaosGame only
  // when symmetry.blend is present: the CPU clamps that field to [0, 1] and
  // scales every ROTATED copy, while this table leaves all copies at full
  // weight. `blend` exists only on intermediate morph samples, which render
  // as points, and the flame-worker command carries no such field. A manual
  // flame switch snaps that display tween and immediately packs the document,
  // which was already replaced with the blend-less endpoint; a saved
  // flame-mode hint enters only when the terminal cloud request lands. Thus
  // every system on the shipped GPU-flame path has blend's default 1, where
  // the two tables agree exactly.
  const weights = new Array<number>(transformCount);
  for (let s = 0; s < transformCount; s++) {
    weights[s] = transforms[s % baseTransformCount].weight ?? 1;
  }
  let totalWeight = 0;
  const cumWeights = new Float64Array(transformCount);
  for (let s = 0; s < transformCount; s++) {
    totalWeight += weights[s];
    cumWeights[s] = totalWeight;
  }
  const weighted =
    weights.some((w) => w !== 1) &&
    totalWeight > 0 &&
    Number.isFinite(totalWeight);

  // Graph-directed selection (chi): the CPU oracle's OWN prepared tables —
  // buildChaosSelection over the same expanded `weights` this packer just
  // summed, exactly as prepareChaosGame builds them (null for an
  // all-trivial system, flam3's flam3_check_unity_chaos disabling) —
  // transferred into the kernel's flat storage array rather than
  // recomputed, the escape lane's precedent: the packer ships its oracle's
  // numbers so the two sides cannot disagree.
  const chaos = buildChaosSelection(transforms, weights, baseTransformCount);

  // Flame structural-coloring pair per BASE map, resolved through
  // the SAME two definitions prepareChaosGame resolves the CPU oracle's with,
  // so an absent field cannot mean one thing here and another there. The
  // expansion below writes each base map's pair into every copy of it (see
  // this function's doc).
  const colorIndices = transforms.map(
    (t, i) => t.colorIndex ?? derivedColorIndex(i, baseTransformCount),
  );
  const colorSpeeds = transforms.map(
    (t) => t.colorSpeed ?? DEFAULT_COLOR_SPEED,
  );

  // Shape emitters (condensation): chaos-game.ts's prepareEmitters is the
  // ONE definition of which BASE transforms are (samplable) emitters — the
  // unsamplable-spec fallback lives there, so calling it here rather than
  // re-deriving "is this spec samplable" is what keeps this packer and the
  // CPU oracle from ever disagreeing about which slots are one (see
  // writeSlotEmitter's doc). gearBuilder accumulates every gear-shaped
  // part's table for the WHOLE system into ONE buffer (binding 7).
  const emitters = prepareEmitters(transforms);
  const gearBuilder = createGearTableBuilder();

  // Copy-major expansion: copy 0 (unrotated) first, then copy 1, etc. — see
  // prepareChaosGame's identical loop shape.
  for (let k = 0; k < order; k++) {
    const post =
      k === 0
        ? null
        : symmetryPostRotation(symmetry.plane, (2 * Math.PI * k) / order);
    for (let i = 0; i < baseTransformCount; i++) {
      const s = k * baseTransformCount + i;
      const base = s * F32_PER_SLOT;
      const affine = baseAffines[i];
      writeSlotRows(slotF32, base, affine.m, affine.t);
      writeSlotPost(slotF32, slotU32, base, post);
      writeSlotVariations(slotF32, slotU32, base, transforms[i].variations);
      slotF32[base + SLOT_CUM_WEIGHT] = cumWeights[s];
      slotF32[base + SLOT_COLOR_INDEX] = colorIndices[i];
      slotF32[base + SLOT_COLOR_SPEED] = colorSpeeds[i];
      writeSlotEmitter(
        slotF32,
        slotU32,
        base,
        emitters !== null && emitters[i] !== null
          ? transforms[i].emitter
          : undefined,
        gearBuilder,
      );
    }
  }

  // The final-transform lens: one extra slot, never chosen by pickIndex
  // (params.transformCount bounds that search), read only when hasFinal = 1.
  // hasPost stays 0 (the ArrayBuffer's zero default) — a lens never rotates.
  if (finalTransform !== null) {
    const finalBase = transformCount * F32_PER_SLOT;
    const finalAffine = composeAffine(finalTransform);
    writeSlotRows(slotF32, finalBase, finalAffine.m, finalAffine.t);
    writeSlotVariations(slotF32, slotU32, finalBase, finalTransform.variations);
  }

  // The schedule's B slots, appended after the lens slot: affine rows +
  // cumWeight only (B is affine-only by the document rule — see
  // `HybridSchedule` — so no variation lanes, no post-rotation, no color
  // pair; the zero defaults make `applySlot` on one exactly the plain
  // affine). The weight table is the ONE shared `buildScheduleTable`, so
  // the kernel's weighted schedule draw and the CPU's `pickScheduleIndex`
  // read the same numbers.
  const scheduleTable = buildScheduleTable(scheduleTransforms);
  for (let i = 0; i < scheduleCount; i++) {
    const base = (transformCount + 1 + i) * F32_PER_SLOT;
    const affine = composeAffine(scheduleTransforms[i]);
    writeSlotRows(slotF32, base, affine.m, affine.t);
    slotF32[base + SLOT_CUM_WEIGHT] = scheduleTable.cumulative[i];
  }

  const colors = new ArrayBuffer(COLORS_BYTES);
  const colorsU32 = new Uint32Array(colors);
  const colorMode: 0 | 1 = palette === "legacy" ? 0 : 1;
  if (colorMode === 0) {
    // Named `transformPalette`, not `palette` — the spec's own `palette` is
    // in scope here, and a same-named inner local would be easy to misread
    // even though this legacy branch never touches the outer one. Authored
    // colorIndexes ride the same `transforms` already in scope for
    // the affine/variation packing above — the shader itself never computes
    // a hue; it only indexes this precomputed table, so this one call site
    // is the whole GPU-side fix.
    const transformPalette = transformColors(
      baseTransformCount,
      transforms.map((t) => t.colorIndex),
    );
    for (let i = 0; i < transformPalette.length; i++) {
      const [r, g, b] = transformPalette[i];
      writeColorEntry(colorsU32, i, r, g, b);
    }
  } else {
    const lut = buildPaletteLUT(palette);
    // Only "legacy" (handled above) ever returns null — see palette.ts.
    if (!lut) {
      throw new Error(
        "packGpuSystem: buildPaletteLUT returned null for a non-legacy palette",
      );
    }
    for (let i = 0; i < COLOR_LUT_ENTRIES; i++) {
      writeColorEntry(colorsU32, i, lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]);
    }
  }

  return {
    slots,
    colors,
    transformCount,
    baseTransformCount,
    weighted,
    totalWeight,
    colorMode,
    hasFinal,
    scheduleCount,
    scheduleDepth,
    scheduleWeighted: scheduleTable.weighted,
    scheduleTotalWeight: scheduleTable.totalWeight,
    chaosRows: chaos
      ? packChaosRowsTable(chaos, transformCount, baseTransformCount)
      : null,
    gearTable: finishGearTableBuilder(gearBuilder),
  };
}

/**
 * Pack `buildChaosSelection`'s prepared tables into the kernel's flat
 * `chaosRows` storage array — TRANSFERRED, never recomputed (the escape
 * lane's precedent: the packer ships its oracle's own numbers so the two
 * sides cannot disagree). Layout, in f32 elements:
 *
 *   [0 .. baseTransformCount)                    per-row totals, by BASE map
 *   [baseTransformCount + i * transformCount + s]  row i's cumulative entry s
 *
 * Rows are `buildChaosSelection`'s own cumulative `Float64Array`s over the
 * EXPANDED slot list, narrowed to f32 by the store (narrowing is monotone,
 * so the kernel's lower-bound search convention stays valid on the narrowed
 * row). A row the oracle recorded in `chaosFallbackRows` stores total 0 —
 * the kernel's `rowTotal > 0.0` test is then exactly `pickIndex`'s
 * degenerate-row decision, transferred rather than re-derived in f32 — with
 * ONE narrowing guard on top: a total whose f32 form is non-finite (an
 * authored-weight overflow past f32 range that the oracle's f64 test cannot
 * see) also stores 0, falling back to the global table — the conservative
 * direction `pickIndex` already takes for a row it cannot trust.
 *
 * Exported for `flame-gpu-4d.ts`: selection has no dimension
 * (`buildChaosSelection`'s own reasoning), so the 4D packer writes its
 * table through this same helper — and for the packing tests, which pin
 * the transfer against the oracle's arrays on a fixture.
 */
export function packChaosRowsTable(
  selection: ChaosSelection,
  transformCount: number,
  baseTransformCount: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(
    (baseTransformCount + baseTransformCount * transformCount) * 4,
  );
  const f32 = new Float32Array(buf);
  const fallback = new Set(selection.chaosFallbackRows);
  for (let i = 0; i < baseTransformCount; i++) {
    const total = selection.chaosRowTotals[i];
    f32[i] =
      !fallback.has(i) && Number.isFinite(Math.fround(total)) ? total : 0;
    const row = selection.chaosRows[i];
    const rowBase = baseTransformCount + i * transformCount;
    for (let s = 0; s < transformCount; s++) {
      f32[rowBase + s] = row[s];
    }
  }
  return buf;
}

/**
 * One chain's seed draw, in the EXACT order {@link packGpuChains} documents
 * — factored out so that order is stated exactly once: `pos.xyz` from
 * `rng() - 0.5` each (`accumulateFlame`'s fresh-orbit convention), the color
 * coordinate set to `0.5` directly (flam3's initial midpoint —
 * `FlameHistogram`'s own default — with no draw), then one uniform 32-bit
 * draw for the kernel's own per-chain PCG32 seed, then one more forced odd
 * (`(draw << 1) | 1`, PCG's stream-selector convention) for the chain's
 * private LCG increment — distinct streams, not phase shifts of one shared
 * cycle.
 */
function writeChainSeed(
  f32: Float32Array,
  u32: Uint32Array,
  base: number,
  rng: Rng,
): void {
  f32[base + CHAIN_POS] = rng() - 0.5;
  f32[base + CHAIN_POS + 1] = rng() - 0.5;
  f32[base + CHAIN_POS + 2] = rng() - 0.5;
  f32[base + CHAIN_POS + 3] = 0.5;
  u32[base + CHAIN_AUX_X] = Math.floor(rng() * 0x100000000) >>> 0;
  u32[base + CHAIN_AUX_INC] =
    ((Math.floor(rng() * 0x100000000) << 1) | 1) >>> 0;
}

/**
 * Seed `numChains` independent GPU orbits from `mulberry32(seed)` — the
 * multi-chain counterpart to `accumulateFlame`'s single fresh-start orbit.
 * Every chain continues the SAME `rng` instance in sequence (see
 * {@link writeChainSeed} for the exact per-chain draw order), so the whole
 * buffer is one deterministic sequence — reproducible in tests with no GPU
 * involved — rather than `numChains` independently-seeded (and therefore
 * correlated) streams.
 * On the GPU side each chain also carries its own odd PCG increment, so
 * distinct chains advance distinct full-period streams.
 */
export function packGpuChains(numChains: number, seed: number): ArrayBuffer {
  const rng = mulberry32(seed);
  const buf = new ArrayBuffer(numChains * CHAIN_STRIDE_BYTES);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  for (let c = 0; c < numChains; c++) {
    writeChainSeed(f32, u32, c * F32_PER_CHAIN, rng);
  }
  return buf;
}

/** The GPU packer's structural view of `flame.ts`'s balloon-echo option.
 * Kept as a plain data interface so the browser driver can pass the CPU
 * option through without adapting it or duplicating any semantics. */
export interface GpuFlameBalloonEchoFields {
  balloon: Balloon;
  tint: Vec3;
  tintStrength: number;
  weight: number;
}

/**
 * {@link packGpuParams}'s input: plain scalar fields for every Params
 * uniform the kernel reads once per dispatch (see the byte-layout doc
 * comment above). `projection`/`width`/`height` are the same camera/target
 * arguments `accumulateFlame` takes; the rest come straight out of a
 * {@link PackedGpuSystem} plus the caller's chain-count/dispatch choices.
 */
export interface GpuParamsFields {
  projection: Mat4;
  width: number;
  height: number;
  transformCount: number;
  baseTransformCount: number;
  itersPerInvocation: number;
  colorMode: 0 | 1;
  weighted: boolean;
  hasFinal: boolean;
  totalWeight: number;
  numChains: number;
  /** Omitted is the byte-identical one-splat path. Tint affects only the
   * optional second splat; the primary color table is never rewritten. */
  echo?: GpuFlameBalloonEchoFields;
  /** Whether binding 5 carries an independent echo-only LUT. */
  echoPalette: boolean;
  /** The scheduled-hybrid post-word's scalar four, straight off
   * {@link PackedGpuSystem} — count/depth 0 (the packed default for a
   * schedule-less spec) is the byte-identical no-post-word path. */
  scheduleCount: number;
  scheduleDepth: number;
  scheduleWeighted: boolean;
  scheduleTotalWeight: number;
  /** Whether the packed system carries chi rows
   * (`PackedGpuSystem.chaosRows !== null`) — gates the kernel's whole chi
   * path. False is the byte-identical pre-chi params block (the flag's
   * word sits in what was trailing pad). */
  chaosEnabled: boolean;
}

/**
 * Pack the Params uniform buffer ({@link PARAMS_BYTES} long) — every field at
 * the byte offset the layout doc comment above documents. `projX`/`projY`
 * come from `projection[0..7]` and `projW` from `projection[12..15]`; row 2
 * (clip Z, `projection[8..11]`) is never read — exactly like
 * `accumulateFlame` (the histogram accumulates density, it doesn't
 * depth-sort).
 *
 * There is deliberately no `colorDenom` here any more: the gradient
 * slot a base map maps to is no longer a uniform-wide `i / (n - 1)` division
 * the kernel redoes per iteration, but a per-slot value {@link packGpuSystem}
 * resolves — so the uniform lost the field rather than carrying a value with
 * no reader. `baseTransformCount` stays: the legacy per-transform palette path
 * still folds the picked slot back onto its base map with it.
 */
export function packGpuParams(fields: GpuParamsFields): ArrayBuffer {
  const buf = new ArrayBuffer(PARAMS_BYTES);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  const { projection } = fields;
  for (let i = 0; i < 4; i++) {
    f32[PARAMS_PROJ_X + i] = projection[i];
    f32[PARAMS_PROJ_Y + i] = projection[4 + i];
    f32[PARAMS_PROJ_W + i] = projection[12 + i];
  }
  u32[PARAMS_WIDTH] = fields.width;
  u32[PARAMS_HEIGHT] = fields.height;
  u32[PARAMS_TRANSFORM_COUNT] = fields.transformCount;
  u32[PARAMS_BASE_TRANSFORM_COUNT] = fields.baseTransformCount;
  u32[PARAMS_ITERS_PER_INVOCATION] = fields.itersPerInvocation;
  u32[PARAMS_COLOR_MODE] = fields.colorMode;
  u32[PARAMS_WEIGHTED] = fields.weighted ? 1 : 0;
  u32[PARAMS_HAS_FINAL] = fields.hasFinal ? 1 : 0;
  f32[PARAMS_TOTAL_WEIGHT] = fields.totalWeight;
  u32[PARAMS_NUM_CHAINS] = fields.numChains;
  u32[PARAMS_ECHO_PALETTE_ENABLED] = fields.echoPalette ? 1 : 0;
  u32[PARAMS_SCHEDULE_COUNT] = fields.scheduleCount;
  u32[PARAMS_SCHEDULE_DEPTH] = fields.scheduleDepth;
  u32[PARAMS_SCHEDULE_WEIGHTED] = fields.scheduleWeighted ? 1 : 0;
  f32[PARAMS_SCHEDULE_TOTAL_WEIGHT] = fields.scheduleTotalWeight;
  u32[PARAMS_CHAOS_ENABLED] = fields.chaosEnabled ? 1 : 0;
  const echo = fields.echo;
  if (echo) {
    f32[PARAMS_ECHO_WEIGHT] = echo.weight;
    f32[PARAMS_ECHO_RHO] = echo.balloon.rho;
    f32[PARAMS_ECHO_CENTER_R2] = echo.balloon.center[0];
    f32[PARAMS_ECHO_CENTER_R2 + 1] = echo.balloon.center[1];
    f32[PARAMS_ECHO_CENTER_R2 + 2] = echo.balloon.center[2];
    f32[PARAMS_ECHO_CENTER_R2 + 3] = echo.balloon.R * echo.balloon.R;
    f32[PARAMS_ECHO_TINT_STRENGTH] = echo.tint[0];
    f32[PARAMS_ECHO_TINT_STRENGTH + 1] = echo.tint[1];
    f32[PARAMS_ECHO_TINT_STRENGTH + 2] = echo.tint[2];
    f32[PARAMS_ECHO_TINT_STRENGTH + 3] = echo.tintStrength;
  }
  return buf;
}

/**
 * {@link planGpuDispatches}'s result: the dispatch geometry plus the total
 * iteration count it actually retires (see that function's doc for why this
 * can exceed the request).
 */
export interface GpuDispatchPlan {
  itersPerInvocation: number;
  dispatches: number;
  iterations: number;
}

/**
 * Turn "advance about `requestedIterations` more iterations" into concrete
 * dispatch geometry: every invocation runs `itersPerInvocation` steps of
 * EVERY chain, so one `dispatchWorkgroups` call retires `numChains *
 * itersPerInvocation` iterations, and `dispatches` such calls retire
 * `iterations = numChains * itersPerInvocation * dispatches` in total.
 *
 * Contract:
 * - `iterations >= requestedIterations` always — a budget is a MINIMUM, so
 *   this never under-runs it.
 * - `itersPerInvocation` is always in `[1, maxItersPerInvocation]`.
 * - When the request fits in a single dispatch at the driver's own per-
 *   invocation cap (`requestedIterations <= numChains *
 *   maxItersPerInvocation`), this uses exactly one dispatch, with
 *   `itersPerInvocation = ceil(requestedIterations / numChains)` — the
 *   smallest per-invocation count that still covers the request in one
 *   dispatch. The overshoot (`iterations - requestedIterations`) is then
 *   strictly less than `numChains` (the standard `ceil` bound) — at most a
 *   fraction of one extra iteration per chain.
 * - Otherwise (the request needs more than one dispatch even at
 *   `maxItersPerInvocation`), `itersPerInvocation = maxItersPerInvocation`
 *   and `dispatches = ceil(requestedIterations / (numChains *
 *   maxItersPerInvocation))` — the fewest dispatches that cover the request
 *   at the widest per-invocation stride.
 * - `requestedIterations <= 0` degrades to the smallest possible unit of
 *   work — `itersPerInvocation = 1`, `dispatches = 1` — rather than a zero-
 *   or negative-sized dispatch.
 */
export function planGpuDispatches(
  requestedIterations: number,
  numChains: number,
  maxItersPerInvocation: number,
): GpuDispatchPlan {
  if (requestedIterations <= 0) {
    return { itersPerInvocation: 1, dispatches: 1, iterations: numChains };
  }
  const singleDispatchCapacity = numChains * maxItersPerInvocation;
  if (requestedIterations <= singleDispatchCapacity) {
    const itersPerInvocation = Math.ceil(requestedIterations / numChains);
    return {
      itersPerInvocation,
      dispatches: 1,
      iterations: numChains * itersPerInvocation,
    };
  }
  const dispatches = Math.ceil(requestedIterations / singleDispatchCapacity);
  return {
    itersPerInvocation: maxItersPerInvocation,
    dispatches,
    iterations: numChains * maxItersPerInvocation * dispatches,
  };
}

/**
 * Combine an emulated-u64 (lo, hi) word pair into a JS number — the inverse
 * of the kernel's `addU64`. Exact for any value a `Float64` can represent
 * (up to 2^53), which covers every count/sum this histogram will see this
 * side of geological time (see the module doc's "~three SECONDS" ceiling the
 * OLD single-u32 counters hit — this emulated-u64 scheme is the fix).
 */
function combineU64(lo: number, hi: number): number {
  return lo + hi * 2 ** 32;
}

/**
 * Convert a GPU readback of the `hist` storage buffer into a
 * {@link FlameHistogram} — the inverse of the kernel's fixed-point/
 * emulated-u64 accumulation (see the byte-layout doc comment's `hist` entry
 * and the kernel's `addU64`). `words` must be exactly `width * height *
 * HIST_U32_PER_BUCKET` long; throws `RangeError` (naming both the actual and
 * expected length) otherwise.
 *
 * Per bucket: `hits` divides by {@link WEIGHT_FIXED_POINT_SCALE}, and each
 * `sumRGB` channel divides by that scale times
 * {@link COLOR_FIXED_POINT_SCALE}. This is the exact inverse of the kernel's
 * weighted deposit; a normal one-splat hit carries exactly 256 and therefore
 * converts to the same integer hit/color values as before the echo existed.
 * `maxHits` is recomputed as the max over every converted bucket, exactly
 * like a fresh CPU histogram's own bookkeeping.
 *
 * Pass `out` to convert into an existing histogram instead of allocating —
 * the same contract as `downsampleFlame`'s `out`: dimensions must match (or
 * `RangeError`), and every bucket is unconditionally overwritten, so a dirty
 * reuse reads identically to a fresh allocation. Omit it to allocate a fresh
 * one via `createFlameHistogram`.
 *
 * Like `viewFlameHistogram`'s wrapped histograms, the result's `orbit` /
 * `orbitColor` are meaningless filler — a GPU accumulation has no single CPU
 * orbit to resume (many independent chains, not one orbit; see the module
 * doc), so nothing should ever read them. They are left at whatever
 * `createFlameHistogram` defaults to, or a reused `out`'s stale value.
 */
export function convertGpuHistogram(
  words: Uint32Array,
  width: number,
  height: number,
  out?: FlameHistogram,
): FlameHistogram {
  const bucketCount = width * height;
  const expectedLength = bucketCount * HIST_U32_PER_BUCKET;
  if (words.length !== expectedLength) {
    throw new RangeError(
      `convertGpuHistogram: expected ${expectedLength} words for ${width}x${height} at ${HIST_U32_PER_BUCKET} words/bucket, got ${words.length}`,
    );
  }
  if (out && (out.width !== width || out.height !== height)) {
    throw new RangeError(
      `convertGpuHistogram: out histogram is ${out.width}x${out.height}, but ${width}x${height} was requested`,
    );
  }
  const hist = out ?? createFlameHistogram(width, height);
  const { hits, sumRGB } = hist;
  const colorScale = COLOR_FIXED_POINT_SCALE * WEIGHT_FIXED_POINT_SCALE;
  let maxHits = 0;
  for (let i = 0; i < bucketCount; i++) {
    const w = i * HIST_U32_PER_BUCKET;
    const hitCount =
      combineU64(words[w], words[w + 1]) / WEIGHT_FIXED_POINT_SCALE;
    hits[i] = hitCount;
    if (hitCount > maxHits) maxHits = hitCount;
    const o = i * 3;
    sumRGB[o] = combineU64(words[w + 2], words[w + 3]) / colorScale;
    sumRGB[o + 1] = combineU64(words[w + 4], words[w + 5]) / colorScale;
    sumRGB[o + 2] = combineU64(words[w + 6], words[w + 7]) / colorScale;
  }
  hist.maxHits = maxHits;
  return hist;
}

// ---------------------------------------------------------------------------
// Progressive display downsample: a two-pass separable Gaussian
// compute filter that mirrors `flame.ts`'s `downsampleFlame` in structure,
// not just in spirit — see that function's doc for the CPU algorithm this
// restates. Moves the PROGRESSIVE (not-yet-finished) redisplay's downsample
// onto the GPU, over the RESIDENT histogram buffer, so a redisplay tick
// reads back only a display-resolution f32 histogram (ss^2 * 2x smaller than
// today's full-histogram-then-CPU-downsample readback) instead of the whole
// accumulation buffer. The finished frame keeps the full readback + CPU
// `adaptiveDownsampleFlame` path untouched (a per-cell-adaptive radius has no
// separable two-pass equivalent — see that function's own doc for why).
//
// SEPARABILITY: `downsampleFlame`'s 2-D Gaussian gather looks inseparable at
// first glance (a fixed radius PER AXIS, summed over a rectangular footprint
// with edge clipping) — but the edge clipping is itself rectangular (an
// output cell's surviving source taps are exactly "sx in bounds" AND "sy in
// bounds", independently per axis), so the 2-D weight sum factors EXACTLY as
// (sum of in-bounds kernelY values) * (sum of in-bounds kernelX values). That
// means the two-pass version below (an X pass, pooling each row's columns
// into an `intermediate` buffer, then a Y pass, pooling `intermediate`'s rows
// into the final `display` buffer, dividing by the precomputed column/row
// weight sums) computes the exact same normalized result as the one-pass CPU
// gather, not an approximation of it (modulo f32 vs f64 rounding — see the
// precision note below).
//
// f32 vs the CPU oracle's f64: taps, kernel weights, and weight-sum
// reciprocals are all f32 here (the CPU accumulation histogram stays
// emulated-u64 exact; only the DOWNSAMPLE arithmetic narrows to f32). This
// gives ~1e-6 relative error against `downsampleFlame` — invisible under the
// log-density tonemap, and pinned within tolerance by the agreement harness
// (`src/app/gpu-bench/`, whose display-downsample leg compares
// `snapshotDisplay` against `downsampleFlame` fed the SAME resident
// histogram, so tight tolerances are valid there).

/**
 * Restates `flame.ts`'s private (unexported) `MIN_FILTER_SIGMA` — the
 * downsample kernel's sigma floor, in output pixels, for a `filterRadius` of
 * 0 or smaller. Not imported because that module must not change to add an
 * export just for this (see this module's own doc for the broader "restated,
 * not imported" pattern — `symmetryPostRotation` does the same for
 * `chaos-game.ts`'s private `symmetryRotation`); kept in sync by hand, and by
 * the agreement harness's downsample part, which would show a kernel-shape
 * mismatch against `downsampleFlame` if the two ever drifted.
 */
const MIN_FILTER_SIGMA = 1e-3;

/** Workgroup size (both dimensions) for {@link FLAME_GPU_DOWNSAMPLE_WGSL}'s
 * two entry points — 2D, not 1D, because a 1D dispatch's single-dimension
 * workgroup count can overflow `maxComputeWorkgroupsPerDimension` at 4K *
 * 3x-supersample accumulation sizes; 16x16 keeps both dispatch dimensions an
 * order of magnitude under that ceiling at every accumulation size this app
 * permits. */
export const DOWNSAMPLE_WORKGROUP_SIZE = 16;

/**
 * Byte layout of the downsample uniform (DownsampleParams, {@link
 * DOWNSAMPLE_PARAMS_BYTES} = 40) — every field a plain u32 (no vec4s, so no
 * 16-byte-alignment padding is needed; see {@link packGpuDownsample}):
 *   0 srcW | 4 srcH | 8 outW | 12 outH | 16 scaleX | 20 scaleY
 *   24 radiusX | 28 radiusY | 32 kernelYOffset | 36 colWeightSumOffset
 *
 * `kernelYOffset`/`colWeightSumOffset` index into the packed `weights` array
 * {@link packGpuDownsample} returns (element offsets, not bytes) —
 * `rowWeightSumOffset` is not itself stored; the kernel derives it as
 * `colWeightSumOffset + outW` (both already in hand), one add instead of a
 * fourth stored offset.
 */
export const DOWNSAMPLE_PARAMS_BYTES = 40;

const DP_SRC_W = 0;
const DP_SRC_H = 1;
const DP_OUT_W = 2;
const DP_OUT_H = 3;
const DP_SCALE_X = 4;
const DP_SCALE_Y = 5;
const DP_RADIUS_X = 6;
const DP_RADIUS_Y = 7;
const DP_KERNEL_Y_OFFSET = 8;
const DP_COL_WEIGHT_SUM_OFFSET = 9;

export const FLAME_GPU_DOWNSAMPLE_WGSL = /* wgsl */ `
struct DownsampleParams {
  srcW: u32,
  srcH: u32,
  outW: u32,
  outH: u32,
  scaleX: u32,
  scaleY: u32,
  radiusX: u32,
  radiusY: u32,
  kernelYOffset: u32,
  colWeightSumOffset: u32,
}

@group(0) @binding(0) var<uniform> dparams: DownsampleParams;
@group(0) @binding(1) var<storage, read> srcHist: array<u32>;
@group(0) @binding(2) var<storage, read> dweights: array<f32>;
@group(0) @binding(3) var<storage, read_write> intermediate: array<f32>;
@group(0) @binding(4) var<storage, read_write> displayHist: array<f32>;

// u64 (lo, hi) -> f32 — the same combination convertGpuHistogram does in JS
// (combineU64), narrowed to f32 for the downsample's own arithmetic (see the
// module doc's precision note). Color channels additionally scale by
// COLOR_FIXED_POINT_SCALE's reciprocal at the SAME point convertGpuHistogram
// divides, so the two pipelines (readback-then-CPU-downsample vs this
// resident-buffer path) agree modulo f32 rounding.
fn u64ToF32(lo: u32, hi: u32) -> f32 {
  return f32(hi) * 4294967296.0 + f32(lo);
}

// Pass 1: pool each output COLUMN's contributing source columns, for every
// SOURCE row — one invocation per (ox, sy). Unnormalized (see the module
// doc's separability paragraph): the column weight sum is divided out in
// pass 2, once per output cell instead of once per source tap here.
@compute @workgroup_size(${DOWNSAMPLE_WORKGROUP_SIZE}, ${DOWNSAMPLE_WORKGROUP_SIZE})
fn downsampleX(@builtin(global_invocation_id) gid: vec3u) {
  let ox = gid.x;
  let sy = gid.y;
  if (ox >= dparams.outW || sy >= dparams.srcH) {
    return;
  }
  let baseX = i32(ox * dparams.scaleX);
  let radiusX = i32(dparams.radiusX);
  var hits: f32 = 0.0;
  var r: f32 = 0.0;
  var g: f32 = 0.0;
  var b: f32 = 0.0;
  let rowBase = sy * dparams.srcW;
  for (var i = -radiusX; i <= radiusX; i++) {
    let sx = baseX + i;
    if (sx < 0 || sx >= i32(dparams.srcW)) {
      continue;
    }
    let weight = dweights[u32(i + radiusX)];
    let bucket = (rowBase + u32(sx)) * 8u;
    hits += weight * u64ToF32(srcHist[bucket], srcHist[bucket + 1u]);
    r += weight * u64ToF32(srcHist[bucket + 2u], srcHist[bucket + 3u]) * (1.0 / 256.0);
    g += weight * u64ToF32(srcHist[bucket + 4u], srcHist[bucket + 5u]) * (1.0 / 256.0);
    b += weight * u64ToF32(srcHist[bucket + 6u], srcHist[bucket + 7u]) * (1.0 / 256.0);
  }
  let o = (sy * dparams.outW + ox) * 4u;
  intermediate[o] = hits;
  intermediate[o + 1u] = r;
  intermediate[o + 2u] = g;
  intermediate[o + 3u] = b;
}

// Pass 2: pool each output ROW's contributing intermediate rows, for every
// OUTPUT column — one invocation per (ox, oy) — and normalize by the
// precomputed column/row weight-sum reciprocals (see packGpuDownsample's
// doc). The CPU oracle's weightSum === 0 defensive branch has no
// counterpart here: it is unreachable (the center tap, i = j = 0, is always
// in-bounds, since baseX/baseY are themselves in-bounds source coordinates),
// so colWeightSum[ox] and rowWeightSum[oy] are always strictly positive —
// see downsampleFlame's own comment making the same argument.
@compute @workgroup_size(${DOWNSAMPLE_WORKGROUP_SIZE}, ${DOWNSAMPLE_WORKGROUP_SIZE})
fn downsampleY(@builtin(global_invocation_id) gid: vec3u) {
  let ox = gid.x;
  let oy = gid.y;
  if (ox >= dparams.outW || oy >= dparams.outH) {
    return;
  }
  let baseY = i32(oy * dparams.scaleY);
  let radiusY = i32(dparams.radiusY);
  var hits: f32 = 0.0;
  var r: f32 = 0.0;
  var g: f32 = 0.0;
  var b: f32 = 0.0;
  for (var j = -radiusY; j <= radiusY; j++) {
    let sy = baseY + j;
    if (sy < 0 || sy >= i32(dparams.srcH)) {
      continue;
    }
    let weight = dweights[dparams.kernelYOffset + u32(j + radiusY)];
    let o = (u32(sy) * dparams.outW + ox) * 4u;
    hits += weight * intermediate[o];
    r += weight * intermediate[o + 1u];
    g += weight * intermediate[o + 2u];
    b += weight * intermediate[o + 3u];
  }
  let norm = dweights[dparams.colWeightSumOffset + ox] *
    dweights[dparams.colWeightSumOffset + dparams.outW + oy];
  let o = (oy * dparams.outW + ox) * 4u;
  displayHist[o] = hits * norm;
  displayHist[o + 1u] = r * norm;
  displayHist[o + 2u] = g * norm;
  displayHist[o + 3u] = b * norm;
}
`;

/**
 * {@link packGpuDownsample}'s result: the uniform bytes plus the packed
 * kernel/weight-sum-reciprocal table {@link FLAME_GPU_DOWNSAMPLE_WGSL}'s two
 * passes read.
 */
export interface PackedGpuDownsample {
  /** {@link DOWNSAMPLE_PARAMS_BYTES}-byte uniform buffer contents. */
  params: ArrayBuffer;
  /**
   * kernelX, kernelY, colWeightSum⁻¹[outW], rowWeightSum⁻¹[outH], packed
   * back to back in that order (offsets: kernelX at 0; the rest at the
   * `params` buffer's `kernelYOffset`/`colWeightSumOffset` fields, with
   * rowWeightSum⁻¹ immediately following colWeightSum⁻¹ at
   * `colWeightSumOffset + outW`).
   */
  weights: Float32Array<ArrayBuffer>;
}

/**
 * Pack the uniform + weight table for the two-pass separable GPU downsample
 * — the exact kernel `downsampleFlame` (`flame.ts`, lines ~620-745)
 * computes, restated as two 1-D passes (see {@link FLAME_GPU_DOWNSAMPLE_WGSL}'s
 * doc for why that restatement is exact, not approximate). `srcW`/`srcH` are
 * the ACCUMULATION resolution (display size x effective supersample);
 * `outW`/`outH` the DISPLAY resolution; both ratios (`scaleX`/`scaleY`) must
 * be exact positive integers — `downsampleFlame`'s own contract (see its
 * `RangeError` guard) — unchecked here since every caller already satisfies
 * it via the accumulator's own `width * supersample` sizing.
 *
 * Kernel derivation mirrors the CPU oracle field for field: `phase = 0.5 *
 * (scale - 1)`, `sigma = max(filterRadius, MIN_FILTER_SIGMA) * scale`,
 * `radius = max(1, ceil(3 * sigma))`, `kernel[k + radius] = exp(-(k - phase)^2
 * / (2 * sigma^2))` for `k` in `[-radius, radius]` — computed with the same
 * `Math.exp` calls the oracle uses, so the only divergence from
 * `downsampleFlame` is the f32 narrowing this table (and the WGSL side
 * reading it) both apply (see the module doc's precision note).
 *
 * `colWeightSum[ox]`/`rowWeightSum[oy]` are the per-column/per-row sums of
 * in-bounds kernel weights (the separability factorization — see the module
 * doc) — accumulated in a plain (f64) JS number, then stored as the
 * RECIPROCAL in f32, so `downsampleY` multiplies instead of dividing per
 * output cell. Every output column/row has at least one in-bounds tap (the
 * center, `i = j = 0`, since `ox * scaleX`/`oy * scaleY` are themselves
 * in-bounds source coordinates), so both sums are always strictly positive —
 * no divide-by-zero guard needed, unlike `downsampleFlame`'s own (defensive,
 * practically unreachable) `weightSum > 0` branch.
 */
export function packGpuDownsample(
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  filterRadius: number,
): PackedGpuDownsample {
  const scaleX = srcW / outW;
  const scaleY = srcH / outH;
  const phaseX = 0.5 * (scaleX - 1);
  const phaseY = 0.5 * (scaleY - 1);
  const sigmaX = Math.max(filterRadius, MIN_FILTER_SIGMA) * scaleX;
  const sigmaY = Math.max(filterRadius, MIN_FILTER_SIGMA) * scaleY;
  const radiusX = Math.max(1, Math.ceil(sigmaX * 3));
  const radiusY = Math.max(1, Math.ceil(sigmaY * 3));

  const kernelXLength = 2 * radiusX + 1;
  const kernelYLength = 2 * radiusY + 1;
  const kernelYOffset = kernelXLength;
  const colWeightSumOffset = kernelYOffset + kernelYLength;
  const rowWeightSumOffset = colWeightSumOffset + outW;
  const weights = new Float32Array(rowWeightSumOffset + outH);

  for (let k = -radiusX; k <= radiusX; k++) {
    const d = k - phaseX;
    weights[k + radiusX] = Math.exp(-(d * d) / (2 * sigmaX * sigmaX));
  }
  for (let k = -radiusY; k <= radiusY; k++) {
    const d = k - phaseY;
    weights[kernelYOffset + k + radiusY] = Math.exp(
      -(d * d) / (2 * sigmaY * sigmaY),
    );
  }

  for (let ox = 0; ox < outW; ox++) {
    const baseX = ox * scaleX;
    let sum = 0;
    for (let i = -radiusX; i <= radiusX; i++) {
      const sx = baseX + i;
      if (sx < 0 || sx >= srcW) continue;
      sum += weights[i + radiusX];
    }
    weights[colWeightSumOffset + ox] = 1 / sum;
  }
  for (let oy = 0; oy < outH; oy++) {
    const baseY = oy * scaleY;
    let sum = 0;
    for (let j = -radiusY; j <= radiusY; j++) {
      const sy = baseY + j;
      if (sy < 0 || sy >= srcH) continue;
      sum += weights[kernelYOffset + j + radiusY];
    }
    weights[rowWeightSumOffset + oy] = 1 / sum;
  }

  const params = new ArrayBuffer(DOWNSAMPLE_PARAMS_BYTES);
  const u32 = new Uint32Array(params);
  u32[DP_SRC_W] = srcW;
  u32[DP_SRC_H] = srcH;
  u32[DP_OUT_W] = outW;
  u32[DP_OUT_H] = outH;
  u32[DP_SCALE_X] = scaleX;
  u32[DP_SCALE_Y] = scaleY;
  u32[DP_RADIUS_X] = radiusX;
  u32[DP_RADIUS_Y] = radiusY;
  u32[DP_KERNEL_Y_OFFSET] = kernelYOffset;
  u32[DP_COL_WEIGHT_SUM_OFFSET] = colWeightSumOffset;

  return { params, weights };
}

/**
 * Convert a {@link FLAME_GPU_DOWNSAMPLE_WGSL} `displayHist` readback —
 * interleaved f32 `[hits, r, g, b]` per bucket, ALREADY normalized (unlike
 * {@link convertGpuHistogram}'s emulated-u64 accumulation buckets) — into an
 * existing {@link FlameHistogram}. `out` is mandatory (not optional): unlike
 * `convertGpuHistogram`, every caller already owns a specific display-slot
 * histogram to reuse (the GPU downsample's whole point is never allocating
 * a fresh one per redisplay tick) — see `flame-worker-core.ts`'s
 * `FlameAccumBackend.snapshotDisplay` doc. Every bucket is unconditionally
 * overwritten (the same dirty-reuse contract as `convertGpuHistogram`'s
 * `out`), and `maxHits` is recomputed as the max over every converted
 * bucket.
 *
 * Throws `RangeError` (naming both the actual and expected length/dims) on a
 * `data` length mismatch or an `out` dimension mismatch — same shape as
 * `convertGpuHistogram`'s own checks.
 */
export function convertGpuDisplayHistogram(
  data: Float32Array,
  width: number,
  height: number,
  out: FlameHistogram,
): FlameHistogram {
  const bucketCount = width * height;
  const expectedLength = bucketCount * 4;
  if (data.length !== expectedLength) {
    throw new RangeError(
      `convertGpuDisplayHistogram: expected ${expectedLength} floats for ${width}x${height} at 4 floats/bucket, got ${data.length}`,
    );
  }
  if (out.width !== width || out.height !== height) {
    throw new RangeError(
      `convertGpuDisplayHistogram: out histogram is ${out.width}x${out.height}, but ${width}x${height} was requested`,
    );
  }
  const { hits, sumRGB } = out;
  let maxHits = 0;
  for (let i = 0; i < bucketCount; i++) {
    const w = i * 4;
    const hitVal = data[w] / WEIGHT_FIXED_POINT_SCALE;
    hits[i] = hitVal;
    if (hitVal > maxHits) maxHits = hitVal;
    const o = i * 3;
    sumRGB[o] = data[w + 1] / WEIGHT_FIXED_POINT_SCALE;
    sumRGB[o + 1] = data[w + 2] / WEIGHT_FIXED_POINT_SCALE;
    sumRGB[o + 2] = data[w + 3] / WEIGHT_FIXED_POINT_SCALE;
  }
  out.maxHits = maxHits;
  return out;
}
