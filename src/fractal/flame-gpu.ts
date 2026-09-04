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
 *   arrays had always reserved, `bulb` took the count to 17 — widening both
 *   lane arrays by one `vec4`, the smallest step a `vec4` array has — and
 *   the parametric julia family and curl filled the three lanes that rode
 *   spare, landing exactly ON the capacity with no struct widening).
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
import {
  composeAffine,
  composeLinearAffine,
  rotationMatrixXYZ,
} from "./affine";
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
import {
  isFoldVariationType,
  isParametricVariationType,
  resolveCurlParams,
  resolveFoldRadii,
  resolveJuliaParams,
} from "./variations";
import { buildPaletteLUT } from "./palette";
import { mulberry32 } from "./rng";
import { meshAsset } from "./mesh-shapes";
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
 * at once and no system's variation list can force a CPU fallback. The
 * parametric julia family and curl brought the count to 20 — exactly the
 * lane capacity, so the struct did NOT widen for them; a fourth parametric
 * warp would widen both lane arrays and the Slot layout doc with it. */
export const MAX_SLOT_VARIATIONS = 20;

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
  // The parametric julia family and curl — appended after the escape-time
  // maps, their parameters riding the dedicated `varParams` lane (see the
  // Slot layout doc).
  julian: 17,
  juliascope: 18,
  curl: 19,
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
 *   152 emitterOverlapAttempts u32 (the host-packed runtime loop bound,
 *   {@link EMITTER_OVERLAP_ATTEMPTS}) | 156 pad
 *
 * Slot (storage array element, {@link SLOT_STRIDE_BYTES} = 1168 stride);
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
 *   48 postX vec4f (post stage row 0: m0 m1 m2, t0 in .w) | 64 postY | 80 postZ
 *     — the slot's POST stage: the kaleidoscope copy rotation composed with
 *     the base map's own post-affine (`Rot_k ∘ P`) when it authors one, the
 *     rotation alone otherwise; the translation rides the rows' free `.w`
 *     lanes, so the wire did not move when posts arrived. `hasPost = 0`
 *     (the zero default) means no stage at all.
 *   96 varWeights array<vec4f, 5> | 176 varTypes array<vec4u, 5> (20 lanes of
 *   storage, all 20 used — one per {@link VariationType}; the Mandelbox fold
 *   family added `boxfold`/`spherefold`/`mandelbox`, `qsquare` filled the
 *   16 lanes the arrays had always reserved, `bulb` took the count past the
 *   16 four vec4s held, and the parametric julia family and curl filled the
 *   three lanes that rode spare — landing exactly ON the capacity, so the
 *   struct did not widen again)
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
 *   cover every fold a slot can hold where twenty would be needed to
 *   cover every lane.
 *   336 emitterFlag u32 | 340 emitterPartCount u32 | 344 emitterTotalWeight
 *   f32 | 348 emitterFallbackPart u32 — the shape-EMITTER (condensation) block
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
 *     4 gear, 5 catalog mesh; yzw = KIND-DEPENDENT,
 *     `emitterSamplePart`'s own table:
 *     sphere y=radius; box yzw=half; torus y=major z=minor; capsule
 *     yzw=a; gear y=triangle-table offset z=triCount w=halfHeight;
 *     mesh y=triangle-table offset z=triCount)
 *     16 params1 vec4f (capsule: xyz=b, w=radius; gear: radius, tooth.x,
 *     tooth.y, hole; unread by every other kind)
 *     32 poseOffsetScale vec4f (xyz = `ShapePose.offset`, w = resolved
 *     `ShapePose.scale`, absent-means-identity resolved host-side exactly
 *     like `shapes.ts`'s own `resolvePoseScale`/`poseOffset`)
 *     48 rot0 | 64 rot1 | 80 rot2 (the baked 3x3 forward pose rotation —
 *     `rotationMatrixXYZ`'s row-major output verbatim, `shapes.ts`'s
 *     `toWorld` convention and NOT `partSdf`'s transpose, since the
 *     emitter POSES a local-frame sample rather than inverting a query;
 *     absent rotation bakes the identity so the kernel applies it
 *     unconditionally, no branch) — rot0.w doubles as this part's
 *     cumulative weight and, for gear only, rot1.w carries the resolved
 *     sector angle used by its containment SDF (rot2.w stays padding).
 *   MIN-INDEX OVERLAP CORRECTION: a multi-part sample gets at most
 *   {@link EMITTER_OVERLAP_ATTEMPTS} weighted proposals. Each is accepted
 *   only when no earlier analytic/gear part contains it; selected mesh
 *   surfaces are accepted directly and never contain or are contained by
 *   another part, exactly as in `prepareShapeSampler`. Exhausting the
 *   bounded device-safe budget draws
 *   once from `emitterFallbackPart`, the first positive-measure part packed
 *   in the header. For at most eight positive-measure supported parts the
 *   fallback mass is bounded by `(7/8)^64` (about 0.0194%); degenerate
 *   authored measures still rely on the standing CPU/GPU agreement gate.
 *   1120 varParams array<vec4f, 3> — the PARAMETRIC julia family and curl's
 *   AUTHORED parameters, indexed by variation type MINUS 17, i.e.
 *   [julian, juliascope, curl]: (power, dist, unused, unused) for the two
 *   julia types, (c1, c2, unused, unused) for curl. NOT squared — that is
 *   the sphere pair's form, and the julia family's closures consume the
 *   lengths themselves. Indexed by TYPE and not by variation LANE for the
 *   same at-most-one-entry-per-type invariant the fold lane leans on. The
 *   block sits AFTER the emitter block, appended at the struct's end so
 *   every pre-julia offset (the variation lanes, foldRadii, the emitter
 *   block) stays byte-identical — a fourth parametric warp would widen both
 *   lane arrays and the Slot layout doc with it.
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
 * emitterTriangleTable: array<f32> at binding 7 — the common area-CDF table
 * for every triangulated emitter kind. Gear parts carry the existing
 * host-built triangle fan ({@link buildGearTriangleTable}): `triCount`
 * cumulative areas followed by `triCount` flattened `vec2f x 3` records.
 * Mesh parts carry their catalog asset's own triangle measure: the same CDF
 * prefix followed by flattened `vec3f x 3` records. `triCount` and the
 * region start (`kindParams0.y`/`.z`) live on the part, and the part kind
 * decides the 6- versus 9-f32 record stride. A document with neither kind
 * aliases binding 7 to `colors`, as before; the field exposed by
 * {@link PackedGpuSystem} deliberately remains named `gearTable` so this
 * layout extension does not cascade through the backend API.
 *
 * hist: array<atomic<u32>>, `width * height * HIST_U32_PER_BUCKET`,
 * bucket layout as {@link HIST_U32_PER_BUCKET} describes.
 */
export const PARAMS_BYTES = 160;
export const SLOT_STRIDE_BYTES = 1168;
export const CHAIN_STRIDE_BYTES = 32;
export const COLORS_BYTES = 256 * 16;
/** One `EmitterPart`'s stride — 6 vec4f lanes (see the Slot layout doc's
 * `EmitterPart` entry). Exported for `flame-gpu-4d.ts`, which shares this
 * exact part encoding (the shape vocabulary is dimension-free — 3D always
 * — so a 4D slot's emitter block is this module's layout verbatim). */
export const EMITTER_PART_STRIDE_BYTES = 96;
/** Maximum weighted proposals used to reproduce the CPU shape sampler's
 * min-index overlap acceptance without an unbounded device loop. Shared by
 * the 3D and 4D kernel source strings so their termination policy cannot
 * drift. */
export const EMITTER_OVERLAP_ATTEMPTS = 64;
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
  emitterOverlapAttempts: u32,
}

// One condensation-shape part's device data (shapes.ts's ShapePart, module
// doc's Slot entry): a kind-tagged primitive plus its similarity pose,
// baked host-side so the kernel applies rather than resolves it.
// kindParams0.x is the kind tag; the remaining param/padding lanes are
// KIND-/ROLE-DEPENDENT (see emitterSamplePart/emitterPartContains).
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
  emitterFallbackPart: u32,
  emitterParts: array<EmitterPart, ${MAX_SHAPE_PARTS}>,
  // The parametric julia family and curl's authored parameters, indexed by
  // type - 17 ([julian, juliascope, curl]) — (power, dist) for the two
  // julia types, (c1, c2) for curl. Appended AFTER the emitter block so
  // every pre-julia offset stays byte-identical.
  varParams: array<vec4f, 3>,
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
// Shape-emitter triangle tables (module doc's binding-7 entry): gear fans
// and catalog-mesh triangles share this one buffer and frozen binding.
@group(0) @binding(7) var<storage, read> emitterTriangleTable: array<f32>;

// Warmup dispatches run a PLOT=false specialization of this same pipeline —
// iterate the orbit without recording, like the CPU's unrecorded warmup.
override PLOT: bool = true;
// The host specializes this false only when every prepared emitter has at
// most one part. That makes the bounded overlap sampler and its containment
// call graph statically unreachable in the common case, so pipeline
// compilation can eliminate their loop/register cost entirely. The true
// default preserves full semantics for direct consumers of this WGSL.
override MULTI_PART_EMITTERS: bool = true;

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
// CPU's own draw pattern (which includes unbounded rejection loops for the
// torus and gear primitives, and for multi-part overlap correction — see the
// Slot layout doc's EmitterPart entry): UNBOUNDED REJECTION LOOPS ARE
// FORBIDDEN ON DEVICE (a device-hang hazard this codebase treats as a hard
// failure class elsewhere — see strip-planner.ts's i915 preemption notes).
// Primitive sampling below is rejection-free; the union-overlap correction
// uses a hard 64-proposal cap plus one known-positive-measure fallback draw.
// Thus every sampler spends a bounded number of derived draws while matching
// the CPU's target measure up to the documented fallback bias. The device
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
  let total = emitterTriangleTable[tableOffset + triCount - 1u];
  let needle = emitterNext(state) * total;
  var lo = 0u;
  var hi = triCount - 1u;
  loop {
    if (lo >= hi) {
      break;
    }
    let mid = (lo + hi) >> 1u;
    if (needle < emitterTriangleTable[tableOffset + mid]) {
      hi = mid;
    } else {
      lo = mid + 1u;
    }
  }
  let vBase = tableOffset + triCount + lo * 6u;
  let v0 = vec2f(emitterTriangleTable[vBase], emitterTriangleTable[vBase + 1u]);
  let v1 = vec2f(emitterTriangleTable[vBase + 2u], emitterTriangleTable[vBase + 3u]);
  let v2 = vec2f(emitterTriangleTable[vBase + 4u], emitterTriangleTable[vBase + 5u]);
  let su = sqrt(emitterNext(state));
  let u2 = emitterNext(state);
  let aw = 1.0 - su;
  let bw = (1.0 - u2) * su;
  let cw = u2 * su;
  let xy = v0 * aw + v1 * bw + v2 * cw;
  let z = (2.0 * emitterNext(state) - 1.0) * halfHeight;
  return vec3f(xy.x, xy.y, z);
}

// A catalog mesh's area-CDF followed by three 3D vertices per triangle.
// The sqrt-barycentric draw is uniform on the selected triangle; selecting
// through cumulative area therefore samples the whole mesh by surface area.
fn emitterDrawMesh(state: ptr<function, u32>, tableOffset: u32, triCount: u32) -> vec3f {
  let total = emitterTriangleTable[tableOffset + triCount - 1u];
  let needle = emitterNext(state) * total;
  var lo = 0u;
  var hi = triCount - 1u;
  loop {
    if (lo >= hi) {
      break;
    }
    let mid = (lo + hi) >> 1u;
    if (needle < emitterTriangleTable[tableOffset + mid]) {
      hi = mid;
    } else {
      lo = mid + 1u;
    }
  }
  let vBase = tableOffset + triCount + lo * 9u;
  let v0 = vec3f(
    emitterTriangleTable[vBase],
    emitterTriangleTable[vBase + 1u],
    emitterTriangleTable[vBase + 2u],
  );
  let v1 = vec3f(
    emitterTriangleTable[vBase + 3u],
    emitterTriangleTable[vBase + 4u],
    emitterTriangleTable[vBase + 5u],
  );
  let v2 = vec3f(
    emitterTriangleTable[vBase + 6u],
    emitterTriangleTable[vBase + 7u],
    emitterTriangleTable[vBase + 8u],
  );
  let su = sqrt(emitterNext(state));
  let u2 = emitterNext(state);
  return v0 * (1.0 - su) + v1 * ((1.0 - u2) * su) + v2 * (u2 * su);
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
    case 4u: { // gear: kindParams0.y = tableOffset, .z = triCount, .w = halfHeight.
      local = emitterDrawGear(state, u32(part.kindParams0.y), u32(part.kindParams0.z), part.kindParams0.w);
    }
    case 5u: { // mesh: kindParams0.y = tableOffset, .z = triCount.
      local = emitterDrawMesh(state, u32(part.kindParams0.y), u32(part.kindParams0.z));
    }
    default: {
      local = vec3f(0.0);
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

fn emitterSdBox2(p: vec2f, b: vec2f) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

fn emitterSdBox3(p: vec3f, b: vec3f) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec3f(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
}

// shapes.ts's partSdf containment predicate over the generic packed part.
// Sampling uses the FORWARD rotation rows above; containment deliberately
// multiplies by their TRANSPOSE, the inverse of the orthonormal pose.
fn emitterPartContains(part: EmitterPart, world: vec3f) -> bool {
  let kind = u32(part.kindParams0.x);
  if (kind == 5u) { // Meshes carry surface measure and contain no candidate.
    return false;
  }
  let shifted = world - part.poseOffsetScale.xyz;
  let local = vec3f(
    part.rot0.x * shifted.x + part.rot1.x * shifted.y + part.rot2.x * shifted.z,
    part.rot0.y * shifted.x + part.rot1.y * shifted.y + part.rot2.y * shifted.z,
    part.rot0.z * shifted.x + part.rot1.z * shifted.y + part.rot2.z * shifted.z,
  ) / part.poseOffsetScale.w;
  var d = 1.0;
  switch kind {
    case 0u: { // sphere
      d = length(local) - part.kindParams0.y;
    }
    case 1u: { // box
      d = emitterSdBox3(local, part.kindParams0.yzw);
    }
    case 2u: { // torus
      let q = vec2f(length(local.xy) - part.kindParams0.y, local.z);
      d = length(q) - part.kindParams0.z;
    }
    case 3u: { // capsule
      let pa = local - part.kindParams0.yzw;
      let ba = part.params1.xyz - part.kindParams0.yzw;
      let h = clamp(dot(pa, ba) / max(dot(ba, ba), EPS), 0.0, 1.0);
      d = length(pa - ba * h) - part.params1.w;
    }
    case 4u: { // gear: params1 = radius, tooth.xy, hole; rot1.w = sector.
      let lp = length(local.xy);
      let seg = part.rot1.w;
      let a0 = atan2(local.y, local.x) + seg * 0.5;
      let a1 = a0 - seg * floor(a0 / seg) - seg * 0.5;
      let gp = vec2f(cos(a1) * lp - part.params1.x, sin(a1) * lp);
      var g = min(lp - part.params1.x, emitterSdBox2(gp, part.params1.yz));
      if (part.params1.w > 0.0) {
        g = max(g, part.params1.w - lp);
      }
      let wz = abs(local.z) - part.kindParams0.w;
      let outside = max(vec2f(g, wz), vec2f(0.0));
      d = min(max(g, wz), 0.0) + length(outside);
    }
    default: {
      d = 1.0;
    }
  }
  return d <= 0.0;
}

fn emitterPickPart(state: ptr<function, u32>, slotIdx: u32, partCount: u32) -> u32 {
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
  return lo;
}

// One slot's whole emitter sample. The single-part fast path preserves its
// old derived-stream draw sequence exactly. A multi-part slot mirrors the CPU
// sampler's min-index acceptance for at most EMITTER_OVERLAP_ATTEMPTS weighted
// proposals, then terminates with one fresh sample from the host-packed first
// positive-measure part rather than risking an unbounded device loop.
fn emitterSampleSlot(state: ptr<function, u32>, slotIdx: u32) -> vec3f {
  let partCount = slots[slotIdx].emitterPartCount;
  if (!MULTI_PART_EMITTERS || partCount <= 1u) {
    return emitterSamplePart(state, slots[slotIdx].emitterParts[0]);
  }
  // Hoist the host-packed 64 into a function-local countdown. Unlike a WGSL
  // const loop bound, this runtime uniform cannot invite a compiler to unroll
  // the large sampler/containment body 64 times.
  var attemptsLeft = params.emitterOverlapAttempts;
  loop {
    if (attemptsLeft == 0u) {
      break;
    }
    attemptsLeft -= 1u;
    let pick = emitterPickPart(state, slotIdx, partCount);
    let candidate = emitterSamplePart(state, slots[slotIdx].emitterParts[pick]);
    // Surface-measure meshes neither shadow nor are shadowed. Their selected
    // candidate is accepted directly, matching prepareShapeSampler.
    if (u32(slots[slotIdx].emitterParts[pick].kindParams0.x) == 5u) {
      return candidate;
    }
    var shadowed = false;
    for (var earlier = 0u; earlier < pick; earlier++) {
      if (emitterPartContains(slots[slotIdx].emitterParts[earlier], candidate)) {
        shadowed = true;
        break;
      }
    }
    if (!shadowed) {
      return candidate;
    }
  }
  return emitterSamplePart(
    state,
    slots[slotIdx].emitterParts[slots[slotIdx].emitterFallbackPart],
  );
}

// The variation registry (variations.ts's VARIATIONS), case-indexed by
// KERNEL_VARIATION_INDEX. Same 3-D generalization: radial warps use the
// full 3-D radius, angular warps act in the xy-plane and carry z through.
// fr is the fold family's own lane (type - 12), vp the parametric
// julia/curl family's (type - 17); every type ignores the argument(s) it
// does not read.
fn applyVariation(t: u32, p: vec3f, rng: ptr<function, vec2u>, fr: vec3f, vp: vec3f) -> vec3f {
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
    case 17u: { // julian — flam3 var31: a log-spiral sector sweep.
      // vp = (power, dist). Exactly ONE rand01 draw per application — the
      // branch pick, matching the CPU closure's single rng() call, so the
      // two stay draw-compatible (the bench pins statistical agreement over
      // the same stream shape, not the same draws). The angle divides by
      // the signed power and the radius exponent by twice it; both are
      // guarded by the resolver's |power| >= 1e-6 floor, so there is no
      // zero divisor to floor here — no EPS, flam3-verbatim.
      let t = trunc(abs(vp.x) * rand01(rng));
      let theta = (atan2(p.y, p.x) + 2.0 * PI * t) / vp.x;
      let r = pow(p.x * p.x + p.y * p.y, vp.y / (2.0 * vp.x));
      return vec3f(r * cos(theta), r * sin(theta), p.z);
    }
    case 18u: { // juliascope — julian's machinery, angle sign flipped by
      // branch parity (flam3 var33): even branches keep +atan2, odd ones
      // flip to −atan2, both divided by power. One rand01 draw, like julian.
      let t = u32(trunc(abs(vp.x) * rand01(rng)));
      let a = atan2(p.y, p.x);
      let theta = (2.0 * PI * f32(t) + select(a, -a, (t & 1u) == 1u)) / vp.x;
      let r = pow(p.x * p.x + p.y * p.y, vp.y / (2.0 * vp.x));
      return vec3f(r * cos(theta), r * sin(theta), p.z);
    }
    case 19u: { // curl — the complex reciprocal (x+iy) / (1 + c1·z + c2·z²).
      // flam3 var46 term for term; the divisor carries the kernel's own EPS
      // floor (the spherical/horseshoe convention), taking over from flam3's
      // own 1/0 at the exact (−1, 0) the classic c1 = 1, c2 = 0 map sends
      // the divisor to zero at. No RNG.
      let re = 1.0 + vp.x * p.x + vp.y * (p.x * p.x - p.y * p.y);
      let im = vp.x * p.y + 2.0 * vp.y * p.x * p.y;
      let r = 1.0 / (re * re + im * im + EPS);
      return vec3f((p.x * re + p.y * im) * r, (p.y * re - p.x * im) * r, p.z);
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
        // slot and the parametric julia/curl family (17..19) its own; every
        // other type ignores the arguments. Explicit bounds, not unchecked
        // subtraction: 15/16 would index past the fold lanes, and a future
        // kind that satisfied BOTH tests would run both branches — the
        // negative-kind mistake this guard class exists to stop.
        var fi = 0u;
        if (ty >= 12u && ty <= 14u) {
          fi = ty - 12u;
        }
        var pi = 0u;
        if (ty >= 17u && ty <= 19u) {
          pi = ty - 17u;
        }
        acc += w * applyVariation(
          ty,
          a,
          rng,
          slots[slotIdx].foldRadii[fi].xyz,
          slots[slotIdx].varParams[pi].xyz,
        );
      }
      q = acc;
    }
  }
  if (s.hasPost == 1u) {
    // The slot's POST stage — the kaleidoscope copy rotation composed with
    // the base map's own post-affine (flam3's post=) when it authors one,
    // the rotation alone otherwise. The translation rides the rows' free
    // .w lanes (the wire's one post block — see the Slot layout doc); for
    // a rotation-only stage those lanes are zero and the added term is
    // exactly the linear-only apply this block was before posts existed.
    q = vec3f(
      dot(s.postX.xyz, q) + s.postX.w,
      dot(s.postY.xyz, q) + s.postY.w,
      dot(s.postZ.xyz, q) + s.postZ.w,
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

/** Build the active point-tiling specialization without changing the
 * historical exported kernel. The backend calls this only when it also
 * installs the binding-7 plan tail and binding-8 chain-state buffer; absent
 * tiling continues to compile {@link FLAME_GPU_KERNEL_WGSL} literally. */
export function buildFlameGpuPointTilingKernel(
  pointTilingWgsl: string,
): string {
  const bindingMarker =
    "@group(0) @binding(7) var<storage, read> emitterTriangleTable: array<f32>;";
  const plotStartMarker = "      var ci = baseIdx;";
  const plotEndMarker = "    }\n  }\n\n  chains[chainIdx]";
  const bindingAt = FLAME_GPU_KERNEL_WGSL.indexOf(bindingMarker);
  const plotStart = FLAME_GPU_KERNEL_WGSL.indexOf(plotStartMarker);
  const plotEnd = FLAME_GPU_KERNEL_WGSL.indexOf(plotEndMarker, plotStart);
  if (bindingAt < 0 || plotStart < 0 || plotEnd < 0) {
    throw new Error("3D Flame point-tiling kernel markers drifted");
  }
  const withBinding =
    FLAME_GPU_KERNEL_WGSL.slice(0, bindingAt + bindingMarker.length) +
    "\n" +
    pointTilingWgsl +
    FLAME_GPU_KERNEL_WGSL.slice(bindingAt + bindingMarker.length);
  const inserted = withBinding.length - FLAME_GPU_KERNEL_WGSL.length;
  const activePlot = /* wgsl */ `      var ci = baseIdx;
      if (params.colorMode == 1u) {
        ci = min(u32(colorCoord * 256.0), 255u);
      }
      let rgb = colors[ci].xyz;
      let pointTilingState = &pointTilingStates[chainIdx];
      let pointTilingAttempt = pointTilingBegin(
        vec4f(pp, 0.0), pointTilingState, chainIdx,
      );
      for (var pointTilingSample = 0u;
        pointTilingSample < pointTilingAttempt.selected;
        pointTilingSample++) {
        let pointTilingImage = pointTilingImageAt(
          vec4f(pp, 0.0), pointTilingAttempt, pointTilingSample,
        );
        if (pointTilingImage.emitted == 1u) {
          let pointTilingWeightFix = u32(round(
            pointTilingImage.weight * ${WEIGHT_FIXED_POINT_SCALE}.0,
          ));
          depositPoint(pointTilingImage.point.xyz, rgb, pointTilingWeightFix);
          pointTilingRecordEmitted(pointTilingState);
        }
      }
`;
  return (
    withBinding.slice(0, plotStart + inserted) +
    activePlot +
    withBinding.slice(plotEnd + inserted)
  );
}

/**
 * Byte-layout element offsets — 4-byte units into each buffer's combined
 * `Float32Array`/`Uint32Array` view, restating the byte-layout doc comment
 * above (divide any byte offset there by 4). Kept unexported: `flame-gpu.
 * test.ts` pins the CONTRACT (the byte-layout comment) with its own literal
 * offsets rather than importing these, so a mistake here could not
 * coincidentally agree with a matching mistake in the test.
 */
const F32_PER_SLOT = SLOT_STRIDE_BYTES / 4; // 292.
const SLOT_ROW_X = 0;
const SLOT_ROW_Y = 4;
const SLOT_ROW_Z = 8;
const SLOT_POST_X = 12;
const SLOT_POST_Y = 16;
const SLOT_POST_Z = 20;
/**
 * `varWeights: array<vec4f, 5>` — 20 lanes of storage, all 20 used (one per
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
 * are a header vec4 (element 87 is the positive-measure fallback index);
 * `emitterParts` is
 * `{@link MAX_SHAPE_PARTS}` contiguous {@link EMITTER_PART_STRIDE_BYTES}
 * (96 B = {@link F32_PER_EMITTER_PART} 24-element) blocks — part `i` at
 * `SLOT_EMITTER_PARTS + i * F32_PER_EMITTER_PART`.
 */
const SLOT_EMITTER_FLAG = 84;
const SLOT_EMITTER_PART_COUNT = 85;
const SLOT_EMITTER_TOTAL_WEIGHT = 86;
const SLOT_EMITTER_FALLBACK_PART = 87;
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
/**
 * `varParams: array<vec4f, 3>` — the parametric julia family and curl's
 * AUTHORED parameters, 12 contiguous elements after the emitter block
 * (byte 1120, the first offset the julia family moved), indexed by
 * variation type MINUS 17, i.e. [julian, juliascope, curl]: (power, dist)
 * for the two julia types, (c1, c2) for curl. The same contiguous-lane
 * reasoning as {@link SLOT_VAR_WEIGHTS}: type `17 + i`'s lane sits at
 * `SLOT_VAR_PARAMS + i * 4`. NOT squared — that is the sphere pair's form,
 * and the julia family's closures consume the lengths themselves.
 */
const SLOT_VAR_PARAMS = 280;

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
const PARAMS_EMITTER_OVERLAP_ATTEMPTS = 38;

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
 * Write one slot's POST stage rows and set `hasPost`. `post === null`
 * (no post stage — copy 0 of a map with no post-affine, or any copy at
 * symmetry order 1 of one) leaves postX/Y/Z and `hasPost` at the
 * `ArrayBuffer`'s zero default — exactly the kernel's "no post" case,
 * mirroring `prepareChaosGame`'s `null` for the same slots.
 *
 * The stage is the COMPOSED post the packer built per copy: the copy
 * rotation (orthogonal, linear-only) applied AFTER the base map's own
 * post-affine — `composeLinearAffine`'s output — so the kernel applies
 * `Rot_k ∘ P` in one block where the CPU oracle applies `P` then `Rot_k`
 * sequentially (the engine ordering). Row `r`'s xyz is the composed
 * matrix's row `r`; its `.w` lane carries the composed translation —
 * the free wire space the Slot layout reserves, which is why the layout
 * did not move when posts arrived. A rotation-only stage packs zero
 * translations, byte-identical to the pre-post wire.
 */
function writeSlotPost(
  f32: Float32Array,
  u32: Uint32Array,
  base: number,
  post: { m: number[]; t: readonly number[] } | null,
): void {
  if (post === null) return;
  const m = post.m;
  const t = post.t;
  f32[base + SLOT_POST_X] = m[0];
  f32[base + SLOT_POST_X + 1] = m[1];
  f32[base + SLOT_POST_X + 2] = m[2];
  f32[base + SLOT_POST_X + 3] = t[0];
  f32[base + SLOT_POST_Y] = m[3];
  f32[base + SLOT_POST_Y + 1] = m[4];
  f32[base + SLOT_POST_Y + 2] = m[5];
  f32[base + SLOT_POST_Y + 3] = t[1];
  f32[base + SLOT_POST_Z] = m[6];
  f32[base + SLOT_POST_Z + 1] = m[7];
  f32[base + SLOT_POST_Z + 2] = m[8];
  f32[base + SLOT_POST_Z + 3] = t[2];
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
    if (isFoldVariationType(v.type)) {
      const r = resolveFoldRadii(v);
      const lane =
        base + SLOT_FOLD_RADII + (KERNEL_VARIATION_INDEX[v.type] - 12) * 4;
      f32[lane] = r.minRadius * r.minRadius;
      f32[lane + 1] = r.fixedRadius * r.fixedRadius;
      f32[lane + 2] = r.boxLimit;
      continue;
    }
    // The parametric julia family and curl's authored parameters, the
    // identical raw-list walk one feature over — keyed by TYPE, NOT
    // squared, and only the two lanes the type actually reads are written.
    if (isParametricVariationType(v.type)) {
      const lane =
        base + SLOT_VAR_PARAMS + (KERNEL_VARIATION_INDEX[v.type] - 17) * 4;
      if (v.type === "curl") {
        const c = resolveCurlParams(v);
        f32[lane] = c.c1;
        f32[lane + 1] = c.c2;
      } else {
        const p = resolveJuliaParams(v.type, v);
        f32[lane] = p.power;
        f32[lane + 1] = p.dist;
      }
      continue;
    }
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

/** One triangulated `EmitterPart`'s region within the shared binding-7
 * buffer: `offset`
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

/** Accumulates every triangulated `EmitterPart` region (gear or mesh) into
 * ONE flat buffer for a whole packed system — {@link packGpuSystem}/
 * `packGpuSystem4` each own one instance for their own kernel's binding 7.
 * The historical public name stays for backend/API compatibility. */
export interface GearTableBuilder {
  floats: number[];
  /** One binding-7 region per resolved mesh content id. Repeated authored
   * parts and symmetry-expanded slots reuse it instead of multiplying the
   * device upload by occurrence count. */
  meshRegionsByContentId: Map<string, GearTableRegion>;
}

export function createGearTableBuilder(): GearTableBuilder {
  return { floats: [], meshRegionsByContentId: new Map() };
}

/** Aggregate binding-7 budget for one packed system. Eight MiB admits all
 * four maximum-size custom meshes with bounded headroom for other regions;
 * occurrence copies are content-deduplicated and consume it only once. */
export const MAX_EMITTER_TRIANGLE_TABLE_BYTES = 8 * 1024 * 1024;
export const MAX_EMITTER_TRIANGLE_TABLE_FLOATS =
  MAX_EMITTER_TRIANGLE_TABLE_BYTES / Float32Array.BYTES_PER_ELEMENT;

function reserveEmitterTriangleTableFloats(
  builder: GearTableBuilder,
  appendCount: number,
): void {
  const nextLength = builder.floats.length + appendCount;
  if (
    !Number.isSafeInteger(appendCount) ||
    appendCount < 0 ||
    !Number.isSafeInteger(nextLength) ||
    nextLength > MAX_EMITTER_TRIANGLE_TABLE_FLOATS
  ) {
    throw new RangeError(
      `shape-emitter triangle table exceeds the aggregate ${MAX_EMITTER_TRIANGLE_TABLE_FLOATS}-float (${MAX_EMITTER_TRIANGLE_TABLE_BYTES}-byte) limit`,
    );
  }
}

/** `null` when nothing was accumulated (no gear or mesh emitter part
 * anywhere in the system) — {@link PackedGpuSystem.gearTable}'s value, the
 * `chaosRows`/echo-colors null-means-alias-an-existing-binding idiom one
 * binding further (binding 7's own doc). */
export function finishGearTableBuilder(
  builder: GearTableBuilder,
): ArrayBuffer | null {
  if (builder.floats.length === 0) return null;
  reserveEmitterTriangleTableFloats(builder, 0);
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
  const triCount = 2 * steps;
  reserveEmitterTriangleTableFloats(builder, triCount * 7);
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
  assertEmitterTableAddressable(offset, triCount);
  for (let k = 0; k < triCount; k++) builder.floats.push(cumAreas[k]);
  for (let k = 0; k < triCount; k++) {
    for (const [x, y] of verts[k]) builder.floats.push(x, y);
  }
  return { offset, triCount, totalArea: running };
}

/** Binding-7 offsets/counts ride f32 lanes in `EmitterPart`. Integers are
 * exact only through 2^24, so fail loudly before a rounded address could
 * make the shader read a neighbouring region. Curated assets sit many
 * orders of magnitude below this ceiling. */
const MAX_EXACT_F32_TABLE_INDEX = 2 ** 24;

function assertEmitterTableAddressable(offset: number, triCount: number): void {
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(triCount) ||
    offset < 0 ||
    triCount < 1 ||
    offset >= MAX_EXACT_F32_TABLE_INDEX ||
    triCount >= MAX_EXACT_F32_TABLE_INDEX
  ) {
    throw new RangeError(
      `shape-emitter triangle table is not exactly f32-addressable (offset ${offset}, triangles ${triCount})`,
    );
  }
}

/** Resolve one catalog or custom mesh through `meshAsset`, then append its
 * prepared area CDF plus indexed 3D triangle vertices to binding 7. The
 * resolved content id owns both products and keys the builder cache, so the
 * point sampler cannot ingest different geometry and repeated occurrences
 * reuse the same table region. The table intentionally expands indexed
 * vertices: the kernel needs one bounded lookup after its CDF search, and a
 * second index buffer would grow the frozen binding layout. */
export function buildMeshTriangleTable(
  prim: Extract<ShapePrimitive, { kind: "mesh" }>,
  builder: GearTableBuilder,
): GearTableRegion {
  const asset = meshAsset(prim.meshId);
  const cached = builder.meshRegionsByContentId.get(asset.id);
  if (cached !== undefined) return cached;
  const triCount = asset.triangles.length;
  if (
    asset.triangleCumulativeAreas.length !== triCount ||
    !(asset.totalArea > 0)
  ) {
    throw new RangeError(
      `mesh ${String(prim.meshId)} has an invalid prepared triangle measure`,
    );
  }
  const offset = builder.floats.length;
  assertEmitterTableAddressable(offset, triCount);
  reserveEmitterTriangleTableFloats(builder, triCount * 10);
  for (const area of asset.triangleCumulativeAreas) builder.floats.push(area);
  for (const triangle of asset.triangles) {
    for (const vertexIndex of triangle) {
      const vertex = asset.vertices[vertexIndex];
      if (!vertex) {
        throw new RangeError(
          `mesh ${String(prim.meshId)} triangle references missing vertex ${vertexIndex}`,
        );
      }
      builder.floats.push(vertex[0], vertex[1], vertex[2]);
    }
  }
  const region = { offset, triCount, totalArea: asset.totalArea };
  builder.meshRegionsByContentId.set(asset.id, region);
  return region;
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
 * with the CPU oracle's about which part is "big". `triangleArea` is a
 * triangulated kind's OWN measured total (for gear, not `shapes.ts`'s
 * private seeded-Monte-Carlo `gearProfileMeasures`, which this module
 * cannot reach), so a gear part's weight here and its device table's own
 * total can never disagree about what "this part's area" means; ignored
 * for every other kind.
 */
export function emitterPartWeight(
  part: ShapePart,
  triangleArea: number,
): number {
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
      volume = Math.max(0, triangleArea * 2 * prim.halfHeight);
      break;
    case "mesh":
      // A mesh emitter samples its authored triangle SURFACE, not a solid
      // volume. Area scales quadratically under the part's uniform pose.
      return Math.max(0, triangleArea) * scale ** 2;
  }
  return volume * scale ** 3;
}

/**
 * Write one `EmitterPart` block (byte-layout doc's `EmitterPart` entry) at
 * `base`: the kind tag plus kind-dependent fields (gear's are a
 * {@link buildGearTriangleTable} region's `offset`/`triCount` plus
 * `halfHeight`, while params1 carries radius/tooth/hole and rot1.w the
 * resolved sector angle for the overlap-containment SDF; the device sampler
 * never re-triangulates, `triangleRegion` non-null exactly for gear/mesh),
 * the baked similarity
 * pose (scale, `rotationMatrixXYZ`'s
 * row-major 3x3 applied FORWARD — `shapes.ts`'s `toWorld` convention, not
 * `partSdf`'s transpose — then offset), and this part's cumulative pick
 * weight in `rot0`'s spare `.w` lane.
 */
export function writeEmitterPart(
  f32: Float32Array,
  base: number,
  part: ShapePart,
  cumWeight: number,
  triangleRegion: GearTableRegion | null,
): void {
  const prim = part.primitive;
  const kp = base + EP_KIND_PARAMS0;
  const p1 = base + EP_PARAMS1;
  let gearSegment = 0;
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
      // The region is built once by the caller's own first pass over
      // parts (writeSlotEmitter/writeSlot4Emitter) — never rebuilt here,
      // since buildGearTriangleTable is not free and its weight is needed
      // ahead of any part's write (cumWeight, above).
      const region = triangleRegion as GearTableRegion;
      f32[kp] = 4;
      f32[kp + 1] = region.offset;
      f32[kp + 2] = region.triCount;
      f32[kp + 3] = prim.halfHeight;
      f32[p1] = prim.radius;
      f32[p1 + 1] = prim.tooth[0];
      f32[p1 + 2] = prim.tooth[1];
      f32[p1 + 3] = prim.hole;
      const teeth = Number.isFinite(prim.teeth)
        ? Math.max(1, Math.round(prim.teeth))
        : 1;
      gearSegment = (2 * Math.PI) / teeth;
      break;
    }
    case "mesh": {
      const region = triangleRegion as GearTableRegion;
      f32[kp] = 5;
      f32[kp + 1] = region.offset;
      f32[kp + 2] = region.triCount;
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
  if (prim.kind === "gear") f32[r1 + 3] = gearSegment;
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
  const triangleRegions: (GearTableRegion | null)[] =
    new Array<GearTableRegion | null>(n);
  const weights = new Array<number>(n);
  let totalWeight = 0;
  for (let i = 0; i < n; i++) {
    const part = spec.parts[i];
    if (part.primitive.kind === "gear") {
      const region = buildGearTriangleTable(part.primitive, gearBuilder);
      triangleRegions[i] = region;
      weights[i] = emitterPartWeight(part, region.totalArea);
    } else if (part.primitive.kind === "mesh") {
      const region = buildMeshTriangleTable(part.primitive, gearBuilder);
      triangleRegions[i] = region;
      weights[i] = emitterPartWeight(part, region.totalArea);
    } else {
      triangleRegions[i] = null;
      weights[i] = emitterPartWeight(part, 0);
    }
    totalWeight += weights[i];
  }
  const fallbackPart = weights.findIndex((weight) => weight > 0);
  if (fallbackPart < 0) {
    throw new Error(
      "packGpuSystem: prepared shape emitter has no positive-measure part",
    );
  }
  u32[base + SLOT_EMITTER_FALLBACK_PART] = fallbackPart;
  f32[base + SLOT_EMITTER_TOTAL_WEIGHT] = totalWeight;
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += weights[i];
    writeEmitterPart(
      f32,
      base + SLOT_EMITTER_PARTS + i * F32_PER_EMITTER_PART,
      spec.parts[i],
      cum,
      triangleRegions[i],
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
  /** True when at least one sampler accepted by `prepareEmitters` has more
   * than one authored part. The backend uses this to retain the bounded
   * overlap path only in pipelines that can actually reach it. */
  multiPartEmitters: boolean;
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
  /** Every gear/mesh emitter part's triangulated table (binding 7's
   * layout; historical field name retained for backend compatibility),
   * concatenated by {@link finishGearTableBuilder}, or `null` when the
   * system has no triangulated emitter part anywhere — the `chaosRows`
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
  const multiPartEmitters =
    emitters !== null &&
    emitters.some(
      (emitter, i) =>
        emitter !== null && (transforms[i].emitter?.parts.length ?? 0) > 1,
    );
  const gearBuilder = createGearTableBuilder();

  // Copy-major expansion: copy 0 (unrotated) first, then copy 1, etc. — see
  // prepareChaosGame's identical loop shape. Each slot's POST stage composes
  // the copy rotation with the base map's own post-affine (`Rot_k ∘ P`, the
  // engine ordering — the kernel applies the block once where the CPU
  // applies `P` then `Rot_k`); a rotation-only slot packs zero translations.
  // EMITTER slots deliberately skip the user post (chaos-game's emitter rule:
  // a condensation set is fixed, the post is part of the warp pipeline the
  // emitter branch replaces — but the copy rotation still bends an emitted
  // point), so their stage is the rotation alone.
  for (let k = 0; k < order; k++) {
    const rot =
      k === 0
        ? null
        : symmetryPostRotation(symmetry.plane, (2 * Math.PI * k) / order);
    for (let i = 0; i < baseTransformCount; i++) {
      const s = k * baseTransformCount + i;
      const base = s * F32_PER_SLOT;
      const affine = baseAffines[i];
      writeSlotRows(slotF32, base, affine.m, affine.t);
      const userPost =
        emitters !== null && emitters[i] !== null ? null : transforms[i].post;
      const stage =
        rot === null
          ? (userPost ?? null)
          : userPost
            ? composeLinearAffine(rot, userPost)
            : { m: rot, t: [0, 0, 0] as const };
      writeSlotPost(slotF32, slotU32, base, stage);
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
  // The lens's own post-affine rides the same post block (hasPost = 1) — the
  // lens's map is affine -> variations -> post exactly like a base map's, so
  // the kernel's applySlot realizes the CPU lens order unchanged. Absent ⇒
  // the slot stays at the `ArrayBuffer`'s zero default — a lens never
  // rotates and (predating posts) never translates either.
  if (finalTransform !== null) {
    const finalBase = transformCount * F32_PER_SLOT;
    const finalAffine = composeAffine(finalTransform);
    writeSlotRows(slotF32, finalBase, finalAffine.m, finalAffine.t);
    writeSlotVariations(slotF32, slotU32, finalBase, finalTransform.variations);
    writeSlotPost(slotF32, slotU32, finalBase, finalTransform.post ?? null);
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
    multiPartEmitters,
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
  // Runtime rather than WGSL-const so software compilers keep the bounded
  // multipart overlap correction as one loop body instead of unrolling 64.
  u32[PARAMS_EMITTER_OVERLAP_ATTEMPTS] = EMITTER_OVERLAP_ATTEMPTS;
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
 * of the kernel's `addU64`. Values through 2^53 are exact; a deliberately
 * adversarial maximum-export tiled render can exceed that while remaining
 * finite with negligible Float64 relative error at that scale.
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
 * `maxHits` and {@link FlameHistogram.hitMass} are both recomputed as the
 * max/sum over every converted bucket in this one pass, exactly like a fresh
 * CPU histogram's own bookkeeping — the mass especially, since
 * `tonemapFlame`'s normalizer is the MEAN deposited density and must be the
 * exact sum of the converted `hits` array.
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
  let hitMass = 0;
  for (let i = 0; i < bucketCount; i++) {
    const w = i * HIST_U32_PER_BUCKET;
    const hitCount =
      combineU64(words[w], words[w + 1]) / WEIGHT_FIXED_POINT_SCALE;
    hits[i] = hitCount;
    if (hitCount > maxHits) maxHits = hitCount;
    hitMass += hitCount;
    const o = i * 3;
    sumRGB[o] = combineU64(words[w + 2], words[w + 3]) / colorScale;
    sumRGB[o + 1] = combineU64(words[w + 4], words[w + 5]) / colorScale;
    sumRGB[o + 2] = combineU64(words[w + 6], words[w + 7]) / colorScale;
  }
  hist.maxHits = maxHits;
  hist.hitMass = hitMass;
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
 * `out`), and `maxHits`/`hitMass` are recomputed as the max/sum over every
 * converted bucket in this pass — the mass being the tone-map's normalizer,
 * summed from the output exactly like `downsampleFlame`'s.
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
  let hitMass = 0;
  for (let i = 0; i < bucketCount; i++) {
    const w = i * 4;
    const hitVal = data[w] / WEIGHT_FIXED_POINT_SCALE;
    hits[i] = hitVal;
    if (hitVal > maxHits) maxHits = hitVal;
    hitMass += hitVal;
    const o = i * 3;
    sumRGB[o] = data[w + 1] / WEIGHT_FIXED_POINT_SCALE;
    sumRGB[o + 1] = data[w + 2] / WEIGHT_FIXED_POINT_SCALE;
    sumRGB[o + 2] = data[w + 3] / WEIGHT_FIXED_POINT_SCALE;
  }
  out.maxHits = maxHits;
  out.hitMass = hitMass;
  return out;
}
