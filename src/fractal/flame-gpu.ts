/**
 * The WebGPU flame-accumulation backend's PURE side (fr-npb): the WGSL
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
 * (`src/app/gpu-bench/`, fr-53k's equal-N methodology) against
 * `accumulateFlame`, this kernel's line-for-line CPU reference.
 *
 * The kernel is fr-53k's spike kernel, productionized. Parity with
 * `accumulateFlame` (see that function and `chaos-game.ts`'s `stepOrbit`):
 * same uniform/weighted transform pick (lower-bound binary search over
 * cumulative weights), same affine → blended-variations → symmetry
 * post-rotation step, same escape-reseed limit (written NaN-robustly for
 * f32: WGSL comparisons with NaN are false, so `!(all inside)` catches NaN
 * and ±inf alike), same final-transform adopt-only-if-finite lens, same
 * flam3 color-coordinate walk, same NDC → pixel bucketing. Deliberate
 * differences, measured and accepted in fr-53k's go/no-go
 * (`docs/spike-fr-53k-gpu-flame-accum.md`): f32 arithmetic instead of f64,
 * and many independent PCG32 chains instead of one mulberry32 orbit — each
 * chain on its own PCG stream (a per-chain odd increment, fr-8xn), so
 * distinct chains walk distinct full-period LCG cycles rather than
 * phase-shifted copies of one shared cycle. The output is a statistically
 * indistinguishable render of the same attractor, not a byte-identical one.
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
 * - **All 12 variation lanes.** The editor lets a transform enable every
 *   variation type at once; the spike's 4 lanes would have forced a silent
 *   CPU fallback for variation-heavy systems. Slots now carry
 *   {@link MAX_SLOT_VARIATIONS} = 12 (type, weight) lanes.
 */
import type { Rng } from "./rng";
import type { SymmetryParams, Transform, VariationType } from "./types";
import { createFlameHistogram } from "./flame";
import type { FlameHistogram, Mat4 } from "./flame";
import type { FlamePaletteId } from "./palette";
// The packing functions appended below the kernel need these value imports,
// which the byte-layout/kernel section above did not — kept as separate
// statements (rather than merged into the type-only imports above) so the
// authored imports above stay untouched.
import { composeAffine, rotationMatrixXYZ } from "./affine";
import { MAX_TRANSFORMS, effectiveSymmetryOrder } from "./chaos-game";
import { transformColors } from "./color";
import { buildPaletteLUT } from "./palette";
import { mulberry32 } from "./rng";

/** Invocations per workgroup; a dispatch is `numChains / WORKGROUP_SIZE`
 * workgroups. 128 measured well on both integrated and discrete GPUs in
 * fr-53k; chain counts must be a multiple of this. */
export const WORKGROUP_SIZE = 128;

/** Fixed-point scale for color channels: palette/LUT entries are
 * pre-scaled to `round(channel * 256)` at pack time, so the kernel adds
 * integers and {@link convertGpuHistogram} divides once on readback.
 * Quantization is ≤ 1/512 per channel per hit — invisible under the
 * log-density tonemap (measured: bias ≤ 0.065/255 in fr-53k). */
export const COLOR_FIXED_POINT_SCALE = 256;

/** Variation (type, weight) lanes per slot — every {@link VariationType}
 * at once, so no system's variation list can force a CPU fallback. */
export const MAX_SLOT_VARIATIONS = 12;

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
};

/**
 * Byte-layout contracts (WGSL struct rules; the pack* functions below
 * write ArrayBuffers to match, and `flame-gpu.test.ts` pins them):
 *
 * Params (uniform, {@link PARAMS_BYTES} = 96):
 *   0 projX vec4f | 16 projY vec4f | 32 projW vec4f
 *   48 width u32 | 52 height u32 | 56 transformCount u32 | 60 baseTransformCount u32
 *   64 itersPerInvocation u32 | 68 colorMode u32 (0 legacy, 1 LUT) | 72 weighted u32 | 76 hasFinal u32
 *   80 totalWeight f32 | 84 colorDenom f32 | 88 numChains u32 | 92 pad
 *
 * Slot (storage array element, {@link SLOT_STRIDE_BYTES} = 208 stride);
 * slot count = transformCount + 1, the last being the final-transform lens
 * (read only when hasFinal = 1, never drawn by the transform pick):
 *   0 rowX vec4f (m0 m1 m2 t0) | 16 rowY | 32 rowZ
 *   48 postX vec4f (symmetry post-rotation row, w unused) | 64 postY | 80 postZ
 *   96 varWeights array<vec4f, 3> | 144 varTypes array<vec4u, 3>
 *   192 varCount u32 | 196 hasPost u32 | 200 cumWeight f32 | 204 pad
 *
 * Chain (storage array element, {@link CHAIN_STRIDE_BYTES} = 32 stride):
 *   0 pos vec4f (xyz orbit point, w color coordinate) | 16 aux vec4u (x rng
 *   state, y the chain's odd PCG stream increment)
 *
 * colors: array<vec4u, 256> — legacy palette (entry per base transform) or
 * 256-entry gradient LUT, channels pre-scaled by
 * {@link COLOR_FIXED_POINT_SCALE}; the w lane is unused padding.
 *
 * hist: array<atomic<u32>>, `width * height * HIST_U32_PER_BUCKET`,
 * bucket layout as {@link HIST_U32_PER_BUCKET} describes.
 */
export const PARAMS_BYTES = 96;
export const SLOT_STRIDE_BYTES = 208;
export const CHAIN_STRIDE_BYTES = 32;
export const COLORS_BYTES = 256 * 16;
/** Byte offset of Params.itersPerInvocation — the one field the driver
 * rewrites mid-session (warmup and final partial dispatches). */
export const PARAMS_ITERS_OFFSET_BYTES = 64;

/** The GPU counterpart of `chaos-game.ts`'s WARMUP_ITERATIONS semantics:
 * every chain runs this many unrecorded steps (the PLOT=false pipeline)
 * once per accumulation, so recording starts on the attractor. Same
 * constant, per chain instead of per orbit. */
export { WARMUP_ITERATIONS } from "./chaos-game";

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
  colorDenom: f32,
  numChains: u32,
  _pad: u32,
}

struct Slot {
  rowX: vec4f,
  rowY: vec4f,
  rowZ: vec4f,
  postX: vec4f,
  postY: vec4f,
  postZ: vec4f,
  varWeights: array<vec4f, 3>,
  varTypes: array<vec4u, 3>,
  varCount: u32,
  hasPost: u32,
  cumWeight: f32,
  _pad: f32,
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

// PCG-RXS-M-XS 32 with per-chain streams: rng.x the mutable state, rng.y the
// chain's odd LCG increment — PCG's stream selector (fr-8xn). A shared
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

// The variation registry (variations.ts's VARIATIONS), case-indexed by
// KERNEL_VARIATION_INDEX. Same 3-D generalization: radial warps use the
// full 3-D radius, angular warps act in the xy-plane and carry z through.
fn applyVariation(t: u32, p: vec3f, rng: ptr<function, vec2u>) -> vec3f {
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
    default: {
      return p;
    }
  }
}

// One slot's full map: affine, then the weighted variation blend (left to
// right, so stochastic variations consume the RNG in list order), then the
// symmetry post-rotation. Mirrors accumulateFlame's inlined stepOrbit body.
fn applySlot(slotIdx: u32, p: vec3f, rng: ptr<function, vec2u>) -> vec3f {
  let s = slots[slotIdx];
  let a = vec3f(
    dot(s.rowX.xyz, p) + s.rowX.w,
    dot(s.rowY.xyz, p) + s.rowY.w,
    dot(s.rowZ.xyz, p) + s.rowZ.w,
  );
  var q = a;
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
      acc += w * applyVariation(ty, a, rng);
    }
    q = acc;
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

@compute @workgroup_size(${WORKGROUP_SIZE})
fn accumulate(@builtin(global_invocation_id) gid: vec3u) {
  let chainIdx = gid.x;
  if (chainIdx >= params.numChains) {
    return;
  }
  var pos = chains[chainIdx].pos.xyz;
  var colorCoord = chains[chainIdx].pos.w;
  var rng = chains[chainIdx].aux.xy;

  for (var n = 0u; n < params.itersPerInvocation; n++) {
    // --- pickIndex (chaos-game.ts): uniform draw, or weighted lower bound.
    var idx: u32;
    let r = rand01(&rng);
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
      idx = lo;
    } else {
      idx = min(u32(r * f32(params.transformCount)), params.transformCount - 1u);
    }
    let baseIdx = idx % params.baseTransformCount;

    // Structural coloring: blend the color coordinate halfway toward this
    // transform's slot BEFORE stepping, exactly like accumulateFlame.
    if (params.colorMode == 1u) {
      var slotCoord = 0.5;
      if (params.colorDenom > 0.0) {
        slotCoord = f32(baseIdx) / params.colorDenom;
      }
      colorCoord = (colorCoord + slotCoord) * 0.5;
    }

    var np = applySlot(idx, pos, &rng);

    // Escape-reseed, NaN-robust (see the module doc).
    if (!(abs(np.x) <= ESCAPE_LIMIT && abs(np.y) <= ESCAPE_LIMIT && abs(np.z) <= ESCAPE_LIMIT)) {
      np = vec3f(rand01(&rng) - 0.5, rand01(&rng) - 0.5, rand01(&rng) - 0.5);
      if (params.colorMode == 1u) {
        colorCoord = 0.5;
      }
    }
    pos = np;

    if (PLOT) {
      var pp = pos;
      if (params.hasFinal == 1u) {
        let f = applySlot(params.transformCount, pos, &rng);
        // CPU adopts the lensed point only when all coordinates are finite;
        // < 1e30 is the f32 stand-in (inf and NaN both fail it).
        if (abs(f.x) < 1e30 && abs(f.y) < 1e30 && abs(f.z) < 1e30) {
          pp = f;
        }
      }
      // Project through the frozen camera and bucket — same rows, same
      // floor/flip conventions as accumulateFlame.
      let cw = dot(params.projW.xyz, pp) + params.projW.w;
      if (cw > 0.0) {
        let ndcX = (dot(params.projX.xyz, pp) + params.projX.w) / cw;
        let ndcY = (dot(params.projY.xyz, pp) + params.projY.w) / cw;
        let col = i32(floor((ndcX + 1.0) * 0.5 * f32(params.width)));
        let row = i32(floor((1.0 - ndcY) * 0.5 * f32(params.height)));
        if (col >= 0 && col < i32(params.width) && row >= 0 && row < i32(params.height)) {
          let bucket = (u32(row) * params.width + u32(col)) * 8u;
          addU64(bucket, 1u);
          var ci = baseIdx;
          if (params.colorMode == 1u) {
            ci = min(u32(colorCoord * 256.0), 255u);
          }
          let rgb = colors[ci];
          addU64(bucket + 2u, rgb.x);
          addU64(bucket + 4u, rgb.y);
          addU64(bucket + 6u, rgb.z);
        }
      }
    }
  }

  chains[chainIdx].pos = vec4f(pos, colorCoord);
  chains[chainIdx].aux.x = rng.x;
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
const F32_PER_SLOT = SLOT_STRIDE_BYTES / 4; // 52.
const SLOT_ROW_X = 0;
const SLOT_ROW_Y = 4;
const SLOT_ROW_Z = 8;
const SLOT_POST_X = 12;
const SLOT_POST_Y = 16;
const SLOT_POST_Z = 20;
/**
 * `varWeights: array<vec4f, 3>`. A storage-buffer `array<vec4, N>` has no
 * inter-element padding (each `vec4` is already 16-byte aligned, exactly its
 * own size), so 3 consecutive vec4s are 12 CONTIGUOUS elements and lane `v`
 * sits at `SLOT_VAR_WEIGHTS + v` directly — matching the WGSL side's
 * `varWeights[v >> 2u][v & 3u]` (vec4 index `v / 4`, component `v % 4`,
 * which is exactly linear index `v` again once the array is flattened).
 */
const SLOT_VAR_WEIGHTS = 24;
/** `varTypes: array<vec4u, 3>` — same contiguous-lane reasoning as {@link SLOT_VAR_WEIGHTS}. */
const SLOT_VAR_TYPES = 36;
const SLOT_VAR_COUNT = 48;
const SLOT_HAS_POST = 49;
const SLOT_CUM_WEIGHT = 50;
// Element 51 is Slot's trailing pad, left at the ArrayBuffer's zero default.

const F32_PER_CHAIN = CHAIN_STRIDE_BYTES / 4; // 8.
const CHAIN_POS = 0; // pos.xyzw: x, y, z, colorCoord.
const CHAIN_AUX_X = 4; // aux.x: rng state.
const CHAIN_AUX_INC = 5; // aux.y: odd PCG stream increment (aux.zw unused, left zeroed).

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
const PARAMS_COLOR_DENOM = 21;
const PARAMS_NUM_CHAINS = 22;
// Element 23 is Params' trailing pad.

/**
 * `chaos-game.ts`'s private `symmetryRotation`, restated here since only
 * `rotationMatrixXYZ` (not that helper) is exported: one nonzero Euler angle
 * on the requested axis, matching `prepareChaosGame`'s per-copy post-rotation
 * exactly.
 */
function symmetryPostRotation(
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
 * filter. Defensive: `VariationType` has exactly {@link MAX_SLOT_VARIATIONS}
 * members (one per variation — see `types.ts`), so every legal transform
 * already fits; this only fires if that union ever grows without a matching
 * bump to the Slot layout.
 *
 * Exported (fr-e26) for `flame-gpu-4d.ts`: a variation list is
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
  for (let v = 0; v < types.length; v++) {
    f32[base + SLOT_VAR_WEIGHTS + v] = weights[v];
    u32[base + SLOT_VAR_TYPES + v] = types[v];
  }
  u32[base + SLOT_VAR_COUNT] = types.length;
}

/**
 * Write one `colors` entry: channels pre-scaled by
 * {@link COLOR_FIXED_POINT_SCALE} and rounded to the nearest integer, so the
 * kernel's `addU64` only ever adds integers (see {@link convertGpuHistogram}
 * for the inverse on readback). The w lane is left at the `ArrayBuffer`'s
 * zero default (unused padding).
 *
 * Exported (fr-e26) for `flame-gpu-4d.ts`: the `colors` table's entry layout
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

/**
 * A chaos-game system in exactly the shape {@link packGpuSystem} needs — the
 * GPU counterpart of the arguments `prepareChaosGame` (`transforms`,
 * `finalTransform`, `symmetry`) and `accumulateFlame` (`palette`/`colorLUT`,
 * folded here into one `paletteId`) take.
 */
export interface GpuFlameSystemSpec {
  transforms: Transform[];
  finalTransform: Transform | null;
  symmetry: SymmetryParams;
  /** `"legacy"` selects the kernel's per-(base)transform color mode
   * (`colorMode` 0); any other id selects the 256-entry gradient LUT mode
   * (`colorMode` 1) — see `palette.ts`'s `buildPaletteLUT`. */
  paletteId: FlamePaletteId;
}

/**
 * {@link packGpuSystem}'s result: the packed GPU buffers plus the scalar
 * fields {@link packGpuParams} needs to describe them — split out rather
 * than forcing the caller to re-derive `transformCount`/`weighted`/etc. from
 * raw bytes.
 */
export interface PackedGpuSystem {
  /** `(transformCount + 1) * SLOT_STRIDE_BYTES` — one slot per expanded
   * (copy, base transform) pair, plus the final-transform lens slot. */
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
  /** `baseTransformCount - 1`, or `0` for a single-transform system — the
   * divisor `accumulateFlame` uses to map a base transform index to its
   * `[0, 1]` gradient slot. */
  colorDenom: number;
  colorMode: 0 | 1;
  hasFinal: boolean;
}

/**
 * Pack a {@link GpuFlameSystemSpec} into the kernel's Slot storage buffer and
 * 256-entry colors buffer — the flat-buffer restatement of `chaos-game.ts`'s
 * `prepareChaosGame` expansion and `flame.ts`'s `accumulateFlame` weight/
 * color handling (fr-53k's spike packing, ported to this module's
 * 12-variation-lane, 64-bit-histogram Slot layout — see the module doc for
 * what changed and why).
 *
 * Throws `RangeError` if `transforms.length` exceeds `MAX_TRANSFORMS` — same
 * check and message shape as `prepareChaosGame`.
 *
 * **Expansion** mirrors `prepareChaosGame` exactly: `order =
 * effectiveSymmetryOrder(symmetry.order, baseTransformCount)`, then slot `k *
 * baseTransformCount + i` (copy-major: every copy's base maps together, copy
 * 0 first) holds base map `i`'s affine and its OWN variation list (each copy
 * re-derives the same base transform independently, rather than sharing one
 * packed instance — a deliberate, harmless redundancy that mirrors
 * `prepareChaosGame` sharing one composed affine/variation BY REFERENCE
 * across copies), plus copy `k`'s post-rotation: `null`/zeroed for `k = 0`,
 * `rotationMatrixXYZ` about `symmetry.axis` by `2π·k / order` otherwise (see
 * {@link symmetryPostRotation}) — `hasPost` is set only in the latter case.
 *
 * **Weights**: slot `s`'s weight is `transforms[s % baseTransformCount]
 * .weight ?? 1` (every copy of a base map shares its weight), `cumWeight` is
 * the running sum, and `weighted` is true under the exact same condition
 * `prepareChaosGame` uses (`some weight !== 1 && totalWeight > 0 &&
 * Number.isFinite(totalWeight)`) — so the kernel's weighted/uniform pick
 * branch agrees with the CPU's bit for bit.
 *
 * **Final transform**: one extra slot at index `transformCount` (never drawn
 * by `pickIndex`, since `params.transformCount` bounds that search) carrying
 * the final transform's affine + variations, with `hasPost` left at 0 (a
 * lens never rotates). Absent ⇒ the slot stays at the `ArrayBuffer`'s zero
 * default and `hasFinal` is `false`.
 *
 * **Colors**: `paletteId === "legacy"` packs `transformColors
 * (baseTransformCount)` (one entry per BASE map, `colorMode = 0`); any other
 * id packs the 256-entry `buildPaletteLUT(paletteId)` gradient (`colorMode =
 * 1`). Either way each channel goes through {@link writeColorEntry}'s
 * fixed-point scale.
 */
export function packGpuSystem(spec: GpuFlameSystemSpec): PackedGpuSystem {
  const { transforms, finalTransform, symmetry, paletteId } = spec;
  if (transforms.length > MAX_TRANSFORMS) {
    throw new RangeError(
      `IFS supports at most ${MAX_TRANSFORMS} transforms, got ${transforms.length}`,
    );
  }

  const baseTransformCount = transforms.length;
  const baseAffines = transforms.map(composeAffine);
  const order = effectiveSymmetryOrder(symmetry.order, baseTransformCount);
  const transformCount = order * baseTransformCount;
  const hasFinal = finalTransform !== null;

  const slots = new ArrayBuffer((transformCount + 1) * SLOT_STRIDE_BYTES);
  const slotF32 = new Float32Array(slots);
  const slotU32 = new Uint32Array(slots);

  // Selection weights over the EXPANDED slots (never the final slot, which
  // pickIndex never draws) — same rule as prepareChaosGame: each slot
  // inherits its base map's weight, defaulting to 1.
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

  // Copy-major expansion: copy 0 (unrotated) first, then copy 1, etc. — see
  // prepareChaosGame's identical loop shape.
  for (let k = 0; k < order; k++) {
    const post =
      k === 0
        ? null
        : symmetryPostRotation(symmetry.axis, (2 * Math.PI * k) / order);
    for (let i = 0; i < baseTransformCount; i++) {
      const s = k * baseTransformCount + i;
      const base = s * F32_PER_SLOT;
      const affine = baseAffines[i];
      writeSlotRows(slotF32, base, affine.m, affine.t);
      writeSlotPost(slotF32, slotU32, base, post);
      writeSlotVariations(slotF32, slotU32, base, transforms[i].variations);
      slotF32[base + SLOT_CUM_WEIGHT] = cumWeights[s];
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

  const colors = new ArrayBuffer(COLORS_BYTES);
  const colorsU32 = new Uint32Array(colors);
  const colorMode: 0 | 1 = paletteId === "legacy" ? 0 : 1;
  if (colorMode === 0) {
    const palette = transformColors(baseTransformCount);
    for (let i = 0; i < palette.length; i++) {
      const [r, g, b] = palette[i];
      writeColorEntry(colorsU32, i, r, g, b);
    }
  } else {
    const lut = buildPaletteLUT(paletteId);
    // Only "legacy" (handled above) ever returns null — see palette.ts.
    if (!lut) {
      throw new Error(
        `packGpuSystem: buildPaletteLUT(${paletteId}) returned null unexpectedly`,
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
    colorDenom: baseTransformCount > 1 ? baseTransformCount - 1 : 0,
    colorMode,
    hasFinal,
  };
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
 * cycle (fr-8xn).
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
 * distinct chains advance distinct full-period streams (fr-8xn).
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
  colorDenom: number;
  numChains: number;
}

/**
 * Pack the Params uniform buffer ({@link PARAMS_BYTES} long) — every field at
 * the byte offset the layout doc comment above documents. `projX`/`projY`
 * come from `projection[0..7]` and `projW` from `projection[12..15]`; row 2
 * (clip Z, `projection[8..11]`) is never read — exactly like
 * `accumulateFlame` (the histogram accumulates density, it doesn't
 * depth-sort).
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
  f32[PARAMS_COLOR_DENOM] = fields.colorDenom;
  u32[PARAMS_NUM_CHAINS] = fields.numChains;
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
 * Per bucket: `hits = hitsLo + hitsHi * 2^32`, and each `sumRGB` channel is
 * the same lo/hi combination divided by {@link COLOR_FIXED_POINT_SCALE} —
 * the exact inverse of {@link writeColorEntry}'s `Math.round(channel *
 * COLOR_FIXED_POINT_SCALE)`. `maxHits` is recomputed as the max over every
 * converted bucket, exactly like a fresh CPU histogram's own bookkeeping.
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
  let maxHits = 0;
  for (let i = 0; i < bucketCount; i++) {
    const w = i * HIST_U32_PER_BUCKET;
    const hitCount = combineU64(words[w], words[w + 1]);
    hits[i] = hitCount;
    if (hitCount > maxHits) maxHits = hitCount;
    const o = i * 3;
    sumRGB[o] =
      combineU64(words[w + 2], words[w + 3]) / COLOR_FIXED_POINT_SCALE;
    sumRGB[o + 1] =
      combineU64(words[w + 4], words[w + 5]) / COLOR_FIXED_POINT_SCALE;
    sumRGB[o + 2] =
      combineU64(words[w + 6], words[w + 7]) / COLOR_FIXED_POINT_SCALE;
  }
  hist.maxHits = maxHits;
  return hist;
}

// ---------------------------------------------------------------------------
// Progressive display downsample (fr-ee9): a two-pass separable Gaussian
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
 * the agreement harness (Part 4 of fr-ee9), which would show a kernel-shape
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
 * (fr-ee9) — the exact kernel `downsampleFlame` (`flame.ts`, lines ~620-745)
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
 * histogram to reuse (fr-ee9's whole point is never allocating a fresh one
 * per redisplay tick) — see `flame-worker-core.ts`'s `FlameAccumBackend.
 * snapshotDisplay` doc. Every bucket is unconditionally overwritten (the
 * same dirty-reuse contract as `convertGpuHistogram`'s `out`), and `maxHits`
 * is recomputed as the max over every converted bucket.
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
    const hitVal = data[w];
    hits[i] = hitVal;
    if (hitVal > maxHits) maxHits = hitVal;
    const o = i * 3;
    sumRGB[o] = data[w + 1];
    sumRGB[o + 1] = data[w + 2];
    sumRGB[o + 2] = data[w + 3];
  }
  out.maxHits = maxHits;
  return out;
}
