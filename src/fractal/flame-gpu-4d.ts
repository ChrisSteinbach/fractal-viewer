/**
 * The 4D WebGPU flame-accumulation backend's PURE side (fr-e26): the 4D WGSL
 * kernel source, its byte-layout contracts, and the packing/conversion
 * functions that translate between this codebase's plain-object 4D systems
 * and the kernel's flat GPU buffers. The 4D twin of `flame-gpu.ts`, in the
 * house per-dimension style (`chaos-game-4d.ts`, `flame-4d.ts`,
 * `variations4.ts`): a dedicated, hand-unrolled 4D path that mirrors the 3D
 * module's SHAPE without generalizing it — the genuinely dimension-free
 * pieces ARE imported from there (`WORKGROUP_SIZE`, the histogram bucket
 * layout, `KERNEL_VARIATION_INDEX`, `packVariations`, `writeColorEntry`,
 * `planGpuDispatches`), so the two kernels can never drift on those.
 *
 * Everything in this module is dependency-free and browser-free — plain data
 * in, plain data out — so the layout rules, weight tables, chain seeding,
 * and histogram conversion are all Vitest-testable (`flame-gpu-4d.test.ts`).
 * The WGSL string itself cannot run under Vitest; it is pinned instead by
 * the statistical agreement harness (`src/app/gpu-bench/`, the same equal-N
 * methodology that pins the 3D kernel) against `accumulateFlame4`
 * (`flame-4d.ts`), this kernel's line-for-line CPU reference.
 *
 * Parity with `accumulateFlame4` (see that function and `chaos-game-4d.ts`'s
 * `stepOrbit4`): same uniform/weighted transform pick, same 4x4+t affine →
 * blended-`variations4` step (NO symmetry post-rotation — kaleidoscope
 * symmetry is 3D-only, see `PreparedChaosGame4`'s doc), same escape-reseed
 * limit over all four coordinates (NaN-robust for f32, like the 3D kernel),
 * same final-transform adopt-only-if-finite lens, same 20-coefficient
 * rotor+camera projection rows (`clipX`/`clipY`/`clipW`/`sRaw` — see
 * `project4.ts`'s `composeFlameProjection4`), same soft w-slice Gaussian
 * with the point-cloud ghost floor (0.06), same optional slice-relative
 * w-ramp recolor (fr-nn6 — an affine remap of `s` packed from
 * `project4.ts`'s `sliceColorRemap`, identity when off), and the same four
 * `FourDRenderColor` flavors (`color.ts`). Deliberate differences are the
 * 3D kernel's own, unchanged: f32 arithmetic instead of f64, and many
 * independent PCG32 chains instead of one mulberry32 orbit — statistically
 * the same render, not a byte-identical one.
 *
 * **The one genuinely new mechanism over the 3D kernel: fixed-point slice
 * weighting.** `accumulateFlame4` adds a FRACTIONAL weight per hit
 * (`sliceWeight` ∈ [0.06, 1] when the soft w-slice is on), but the GPU
 * histogram is integer (emulated-u64 atomics — WGSL has no f32 atomics). So
 * every add carries an extra {@link WEIGHT_FIXED_POINT_SCALE} = 256 factor:
 * `hits` buckets accumulate `round(weight * 256)` and color buckets
 * accumulate `rgbFixed * round(weight * 256)` (≤ 256 · 256 = 2^16 per add —
 * far inside u32), and {@link convertGpuHistogram4} divides both back out on
 * readback. Slice off ⇒ `weight = 1` ⇒ the factor is exactly 256 and the
 * quantization error is identically the 3D kernel's (≤ 1/512 per channel per
 * hit); slice on ⇒ the weight itself quantizes to 1/512 too — invisible
 * under the log-density tonemap, and pinned by the agreement harness.
 *
 * The progressive display downsample needs NO 4D variant:
 * `FLAME_GPU_DOWNSAMPLE_WGSL` (flame-gpu.ts) reads the accumulated 2D
 * histogram buckets, which have the identical 8-word layout — only their
 * SCALE differs, and the downsample is linear, so the extra 256 divides out
 * on readback instead ({@link convertGpuDisplayHistogram4}).
 */
import type { Rng } from "./rng";
import type { Transform4 } from "./types";
import { createFlameHistogram } from "./flame";
import type { FlameHistogram } from "./flame";
import type { FourDRenderColor } from "./color";
import { sliceColorRemap } from "./project4";
import type { FourDView } from "./project4";
// Value imports for the packing functions below the kernel — mirrors
// flame-gpu.ts's own split between type-only and value imports.
import { composeAffine4 } from "./affine4";
import { MAX_TRANSFORMS } from "./chaos-game";
import {
  COLOR_FIXED_POINT_SCALE,
  HIST_U32_PER_BUCKET,
  WORKGROUP_SIZE,
  packVariations,
  writeColorEntry,
} from "./flame-gpu";
import { mulberry32 } from "./rng";

/**
 * Fixed-point scale for the soft w-slice weight (see the module doc): the
 * kernel adds `round(weight * 256)` to `hits` and `rgbFixed * round(weight *
 * 256)` to each color channel, and {@link convertGpuHistogram4} divides both
 * back out. 256 quantizes the weight to ≤ 1/512 absolute error per hit —
 * the same bound the 3D kernel's color fixed point already carries.
 */
export const WEIGHT_FIXED_POINT_SCALE = 256;

/**
 * The `colorKind` values the kernel switches on — packing maps a
 * {@link FourDRenderColor}'s `kind` through this table. Typed as a total
 * Record so adding a variant to `FourDRenderColor` without extending the
 * WGSL switch fails to COMPILE here, instead of silently rendering black —
 * the same guard shape as `KERNEL_VARIATION_INDEX` (flame-gpu.ts).
 */
export const KERNEL_COLOR_KIND: Record<FourDRenderColor["kind"], number> = {
  structural: 0,
  wRamp: 1,
  transform: 2,
  radius: 3,
};

/**
 * Byte-layout contracts (WGSL struct rules; the pack* functions below write
 * ArrayBuffers to match, and `flame-gpu-4d.test.ts` pins them):
 *
 * Params4 (uniform, {@link PARAMS4_BYTES} = 208):
 *   0 projX vec4f | 16 projY vec4f | 32 projW vec4f | 48 projS vec4f
 *   64 projC vec4f (the four row constants: x=clipX, y=clipY, z=clipW, w=sRaw)
 *   80 center4 vec4f (radius mode's 4D center; zero otherwise)
 *   96 negColor vec4f | 112 posColor vec4f (wRamp side colors, xyz; zero otherwise)
 *   128 width u32 | 132 height u32 | 136 transformCount u32 | 140 itersPerInvocation u32
 *   144 colorKind u32 ({@link KERNEL_COLOR_KIND}) | 148 weighted u32 | 152 hasFinal u32 | 156 numChains u32
 *   160 totalWeight f32 | 164 colorDenom f32 | 168 invWAmp f32 | 172 sliceOn u32
 *   176 sliceCenter f32 | 180 sliceWidth f32 | 184 minD f32 | 188 invRadiusRange f32
 *   192 sliceColorShift f32 | 196 sliceColorInvScale f32 (the fr-nn6 remap —
 *   `sliceColorRemap`'s (shift, invScale); identity (0, 1) when off) |
 *   200..207 trailing pad (WGSL rounds the struct to its 16-byte alignment)
 *
 * Slot4 (storage array element, {@link SLOT4_STRIDE_BYTES} = 192 stride);
 * slot count = transformCount + 1, the last being the final-transform lens
 * (read only when hasFinal = 1, never drawn by the transform pick). NO
 * symmetry post-rotation rows — kaleidoscope symmetry is 3D-only:
 *   0 rowX vec4f (m0..m3) | 16 rowY (m4..m7) | 32 rowZ (m8..m11) | 48 rowW (m12..m15)
 *   64 trans vec4f (t0..t3)
 *   80 varWeights array<vec4f, 3> | 128 varTypes array<vec4u, 3>
 *   176 varCount u32 | 180 cumWeight f32 | 184 pad | 188 pad
 *
 * Chain4 (storage array element, {@link CHAIN4_STRIDE_BYTES} = 32 stride):
 *   0 pos vec4f (the FULL 4D orbit point — unlike the 3D Chain, no lane is
 *   spare for the color coordinate) | 16 aux vec4u (x rng state, y the color
 *   coordinate BITCAST to u32 — an f32 stored bit-exactly in a u32 lane; the
 *   kernel round-trips it with WGSL `bitcast`, and `packGpuChains4` writes it
 *   through the buffer's own Float32Array view at the same element)
 *
 * colors: array<vec4u, 256> — gradient LUT (structural/radius) or
 * per-transform palette (transform mode), channels pre-scaled by
 * `COLOR_FIXED_POINT_SCALE` via `writeColorEntry`; zeros for wRamp (whose
 * color is computed in-shader from the projected s instead).
 *
 * hist: array<atomic<u32>>, `width * height * HIST_U32_PER_BUCKET`, the SAME
 * 8-word emulated-u64 bucket layout as the 3D kernel — but every value
 * carries the extra {@link WEIGHT_FIXED_POINT_SCALE} factor (see the module
 * doc), so read it back with {@link convertGpuHistogram4}, never
 * `convertGpuHistogram`.
 */
export const PARAMS4_BYTES = 208;
export const SLOT4_STRIDE_BYTES = 192;
export const CHAIN4_STRIDE_BYTES = 32;
/** Byte offset of Params4.itersPerInvocation — the one field the driver
 * rewrites mid-session, exactly like the 3D layout's
 * `PARAMS_ITERS_OFFSET_BYTES`. */
export const PARAMS4_ITERS_OFFSET_BYTES = 140;

export const FLAME_GPU_KERNEL_4D_WGSL = /* wgsl */ `
const ESCAPE_LIMIT: f32 = 50.0;
const PI: f32 = 3.14159265358979;
const EPS: f32 = 1e-12;
// The flame's ghost-context slice floor — flame-4d.ts's SLICE_FLOOR (0.06),
// the point-cloud view's floor, NOT the solid render's 0. Keep in sync.
const SLICE_FLOOR: f32 = 0.06;

struct Params {
  projX: vec4f,
  projY: vec4f,
  projW: vec4f,
  projS: vec4f,
  projC: vec4f,
  center4: vec4f,
  negColor: vec4f,
  posColor: vec4f,
  width: u32,
  height: u32,
  transformCount: u32,
  itersPerInvocation: u32,
  colorKind: u32,
  weighted: u32,
  hasFinal: u32,
  numChains: u32,
  totalWeight: f32,
  colorDenom: f32,
  invWAmp: f32,
  sliceOn: u32,
  sliceCenter: f32,
  sliceWidth: f32,
  minD: f32,
  invRadiusRange: f32,
  sliceColorShift: f32,
  sliceColorInvScale: f32,
}

struct Slot {
  rowX: vec4f,
  rowY: vec4f,
  rowZ: vec4f,
  rowW: vec4f,
  trans: vec4f,
  varWeights: array<vec4f, 3>,
  varTypes: array<vec4u, 3>,
  varCount: u32,
  cumWeight: f32,
  _pad0: u32,
  _pad1: u32,
}

// "aux", not "meta": meta is a WGSL reserved identifier (3D kernel's note).
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

// Emulated-u64 accumulate — identical to the 3D kernel's addU64 (see that
// kernel's doc for the carry-detection argument).
fn addU64(base: u32, v: u32) {
  let old = atomicAdd(&hist[base], v);
  if (old > 0xFFFFFFFFu - v) {
    atomicAdd(&hist[base + 1u], 1u);
  }
}

// PCG-RXS-M-XS 32 — identical to the 3D kernel's.
fn pcgNext(state: ptr<function, u32>) -> u32 {
  let s = *state * 747796405u + 2891336453u;
  *state = s;
  let word = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (word >> 22u) ^ word;
}

// [0, 1) — identical to the 3D kernel's (top 24 bits, strictly below 1).
fn rand01(state: ptr<function, u32>) -> f32 {
  return f32(pcgNext(state) >> 8u) * (1.0 / 16777216.0);
}

// The 4D variation registry (variations4.ts's VARIATIONS4), case-indexed by
// flame-gpu.ts's KERNEL_VARIATION_INDEX — the same table as the 3D kernel,
// lifted per variations4.ts's own convention: radial warps (spherical,
// bubble) and swirl use the FULL 4D radius, angular warps act in the
// xy-plane and carry z AND w through, sinusoidal folds all four axes.
fn applyVariation(t: u32, p: vec4f, state: ptr<function, u32>) -> vec4f {
  switch t {
    case 0u: { // linear
      return p;
    }
    case 1u: { // sinusoidal
      return sin(p);
    }
    case 2u: { // spherical — full 4D radius.
      let c = 1.0 / (dot(p, p) + EPS);
      return p * c;
    }
    case 3u: { // swirl — angle from the FULL 4D squared radius; z, w carried.
      let r2 = dot(p, p);
      let s = sin(r2);
      let c = cos(r2);
      return vec4f(p.x * s - p.y * c, p.x * c + p.y * s, p.z, p.w);
    }
    case 4u: { // horseshoe
      let c = 1.0 / (length(p.xy) + EPS);
      return vec4f(c * (p.x - p.y) * (p.x + p.y), c * 2.0 * p.x * p.y, p.z, p.w);
    }
    case 5u: { // polar
      let rp = length(p.xy);
      return vec4f(atan2(p.y, p.x) / PI, rp - 1.0, p.z, p.w);
    }
    case 6u: { // handkerchief
      let rp = length(p.xy);
      let th = atan2(p.y, p.x);
      return vec4f(rp * sin(th + rp), rp * cos(th - rp), p.z, p.w);
    }
    case 7u: { // heart
      let rp = length(p.xy);
      let th = atan2(p.y, p.x);
      return vec4f(rp * sin(th * rp), -rp * cos(th * rp), p.z, p.w);
    }
    case 8u: { // disc
      let rp = length(p.xy);
      let th = atan2(p.y, p.x) / PI;
      let pr = PI * rp;
      return vec4f(th * sin(pr), th * cos(pr), p.z, p.w);
    }
    case 9u: { // spiral
      let rp = length(p.xy);
      let c = 1.0 / (rp + EPS);
      let th = atan2(p.y, p.x);
      return vec4f(c * (cos(th) + sin(rp)), c * (sin(th) - cos(rp)), p.z, p.w);
    }
    case 10u: { // bubble — full 4D radius.
      let c = 4.0 / (dot(p, p) + 4.0);
      return p * c;
    }
    case 11u: { // julia — draws one bit, like the CPU's rng() < 0.5.
      let rq = sqrt(length(p.xy));
      var th = atan2(p.y, p.x) / 2.0;
      if (rand01(state) >= 0.5) {
        th += PI;
      }
      return vec4f(rq * cos(th), rq * sin(th), p.z, p.w);
    }
    default: {
      return p;
    }
  }
}

// One slot's full map: 4x4 affine + translation, then the weighted variation
// blend (left to right, so stochastic variations consume the RNG in list
// order). No symmetry post-rotation — 4D has none. Mirrors accumulateFlame4's
// inlined stepOrbit4 body.
fn applySlot(slotIdx: u32, p: vec4f, state: ptr<function, u32>) -> vec4f {
  let s = slots[slotIdx];
  let a = vec4f(
    dot(s.rowX, p),
    dot(s.rowY, p),
    dot(s.rowZ, p),
    dot(s.rowW, p),
  ) + s.trans;
  var q = a;
  if (s.varCount > 0u) {
    var acc = vec4f(0.0);
    for (var v = 0u; v < s.varCount; v++) {
      // Lane reads through the STORAGE REFERENCE, not the value copy in
      // "s" — same WGSL-implementation-portability note as the 3D kernel's
      // applySlot.
      let w = slots[slotIdx].varWeights[v >> 2u][v & 3u];
      let ty = slots[slotIdx].varTypes[v >> 2u][v & 3u];
      acc += w * applyVariation(ty, a, state);
    }
    q = acc;
  }
  return q;
}

// The diverging rotated-w ramp — color.ts's wRampColor, mirrored constant
// for constant (the 0.6 exponent, the 0.38 gray notch, the 0.30 + 0.70
// brightness; that function's doc names this kernel's copy in its
// keep-in-sync set). "s" arrives already clamped to [-1, 1].
fn wRampColor(s: f32) -> vec3f {
  let m = pow(abs(s), 0.6);
  let side = select(params.posColor.xyz, params.negColor.xyz, s < 0.0);
  let brightness = 0.3 + 0.7 * m;
  return (vec3f(0.38 * (1.0 - m)) + side * m) * brightness;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn accumulate(@builtin(global_invocation_id) gid: vec3u) {
  let chainIdx = gid.x;
  if (chainIdx >= params.numChains) {
    return;
  }
  var pos = chains[chainIdx].pos;
  var rng = chains[chainIdx].aux.x;
  var colorCoord = bitcast<f32>(chains[chainIdx].aux.y);

  for (var n = 0u; n < params.itersPerInvocation; n++) {
    // --- pickIndex4 (chaos-game-4d.ts): uniform draw, or weighted lower
    // bound over cumulative weights — identical to the 3D kernel's pick
    // (the pick has no dimension), minus the base-map modulo (no symmetry).
    var idx: u32;
    let r = rand01(&rng);
    if (params.weighted == 1u) {
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

    // Structural coloring: blend the color coordinate halfway toward this
    // transform's slot BEFORE stepping, exactly like accumulateFlame4 —
    // keyed on the RAW picked index (no symmetry copies to collapse).
    if (params.colorKind == 0u) {
      var slotCoord = 0.5;
      if (params.colorDenom > 0.0) {
        slotCoord = f32(idx) / params.colorDenom;
      }
      colorCoord = (colorCoord + slotCoord) * 0.5;
    }

    var np = applySlot(idx, pos, &rng);

    // Escape-reseed over all four coordinates, NaN-robust: any NaN lane
    // makes its <= comparison false, so all() fails and the ! reseeds —
    // the vec4 restatement of the 3D kernel's chained-&& form.
    if (!(all(abs(np) <= vec4f(ESCAPE_LIMIT)))) {
      np = vec4f(
        rand01(&rng) - 0.5,
        rand01(&rng) - 0.5,
        rand01(&rng) - 0.5,
        rand01(&rng) - 0.5,
      );
      if (params.colorKind == 0u) {
        colorCoord = 0.5;
      }
    }
    pos = np;

    if (PLOT) {
      var pp = pos;
      if (params.hasFinal == 1u) {
        let f = applySlot(params.transformCount, pos, &rng);
        // CPU adopts the lensed point only when all four coordinates are
        // finite; < 1e30 is the f32 stand-in (inf and NaN both fail it).
        if (all(abs(f) < vec4f(1e30))) {
          pp = f;
        }
      }
      // Project through the frozen rotor+camera composition — the four
      // 5-coefficient rows accumulateFlame4 evaluates (clipX, clipY, clipW,
      // sRaw over (x, y, z, w, 1)), same floor/flip bucketing conventions.
      let cw = dot(params.projW, pp) + params.projC.z;
      if (cw > 0.0) {
        let ndcX = (dot(params.projX, pp) + params.projC.x) / cw;
        let ndcY = (dot(params.projY, pp) + params.projC.y) / cw;
        let col = i32(floor((ndcX + 1.0) * 0.5 * f32(params.width)));
        let row = i32(floor((1.0 - ndcY) * 0.5 * f32(params.height)));
        if (col >= 0 && col < i32(params.width) && row >= 0 && row < i32(params.height)) {
          // The rotor's raw signed-w signal — never perspective-divided —
          // normalized and clamped exactly like the CPU (and the point-cloud
          // shader's s = clamp(q.w * uInvWAmp4, -1, 1)).
          let sRaw = dot(params.projS, pp) + params.projC.w;
          let s = clamp(sRaw * params.invWAmp, -1.0, 1.0);
          // The soft w-slice window at the flame's ghost-context floor —
          // project4.ts's sliceWeight(s, center, width, 0.06).
          var weight = 1.0;
          if (params.sliceOn == 1u) {
            let d = (s - params.sliceCenter) / params.sliceWidth;
            weight = SLICE_FLOOR + (1.0 - SLICE_FLOOR) * exp(-0.5 * d * d);
          }
          // Fixed-point weight (see the module doc): hits carry
          // round(weight * 256), colors carry rgbFixed * that same factor.
          let wFix = u32(round(weight * ${WEIGHT_FIXED_POINT_SCALE}.0));

          let bucket = (u32(row) * params.width + u32(col)) * 8u;
          addU64(bucket, wFix);

          // rgb is the fixed-point (x256) channel triple, whatever the mode
          // — table modes read it pre-scaled from colors[], wRamp computes
          // the f32 color in-shader and quantizes to the same scale.
          var rgb: vec3u;
          switch params.colorKind {
            case 0u: { // structural: the flam3 color-coordinate LUT walk.
              let ci = min(u32(colorCoord * 256.0), 255u);
              rgb = colors[ci].xyz;
            }
            case 1u: { // wRamp: in-shader diverging ramp on s, through the
              // optional slice-relative remap (fr-nn6) — project4.ts's
              // sliceColorRemap, identity (shift 0, invScale 1) when off.
              let sc = clamp(
                (s - params.sliceColorShift) * params.sliceColorInvScale,
                -1.0,
                1.0,
              );
              rgb = vec3u(round(wRampColor(sc) * ${COLOR_FIXED_POINT_SCALE}.0));
            }
            case 2u: { // transform: the picked transform's palette entry.
              rgb = colors[idx].xyz;
            }
            default: { // 3u, radius: 4D distance from center4, LUT-ramped.
              let d4 = distance(pp, params.center4);
              let t = clamp((d4 - params.minD) * params.invRadiusRange, 0.0, 1.0);
              let li = u32(t * 255.0 + 0.5);
              rgb = colors[li].xyz;
            }
          }
          addU64(bucket + 2u, rgb.x * wFix);
          addU64(bucket + 4u, rgb.y * wFix);
          addU64(bucket + 6u, rgb.z * wFix);
        }
      }
    }
  }

  chains[chainIdx].pos = pos;
  chains[chainIdx].aux.x = rng;
  chains[chainIdx].aux.y = bitcast<u32>(colorCoord);
}
`;

/**
 * Byte-layout element offsets — 4-byte units into each buffer's combined
 * `Float32Array`/`Uint32Array` view, restating the byte-layout doc comment
 * above (divide any byte offset there by 4). Kept unexported for the same
 * reason flame-gpu.ts keeps its own: `flame-gpu-4d.test.ts` pins the
 * CONTRACT with its own literal offsets, so a mistake here cannot
 * coincidentally agree with a matching mistake in the test.
 */
const F32_PER_SLOT4 = SLOT4_STRIDE_BYTES / 4; // 48.
const SLOT4_ROW_X = 0;
const SLOT4_ROW_Y = 4;
const SLOT4_ROW_Z = 8;
const SLOT4_ROW_W = 12;
const SLOT4_TRANS = 16;
/** `varWeights: array<vec4f, 3>` — contiguous lanes, same flattening
 * argument as flame-gpu.ts's `SLOT_VAR_WEIGHTS`. */
const SLOT4_VAR_WEIGHTS = 20;
const SLOT4_VAR_TYPES = 32;
const SLOT4_VAR_COUNT = 44;
const SLOT4_CUM_WEIGHT = 45;
// Elements 46-47 are Slot's trailing pads, left at the ArrayBuffer's zero
// default.

const F32_PER_CHAIN4 = CHAIN4_STRIDE_BYTES / 4; // 8.
const CHAIN4_POS = 0; // pos.xyzw: the full 4D orbit point.
const CHAIN4_AUX_RNG = 4; // aux.x: rng state.
/** aux.y: the color coordinate — an f32 written through the buffer's
 * Float32Array view into a u32 lane; the kernel bitcasts it back. */
const CHAIN4_AUX_COLOR = 5;

const PARAMS4_PROJ_X = 0;
const PARAMS4_PROJ_Y = 4;
const PARAMS4_PROJ_W = 8;
const PARAMS4_PROJ_S = 12;
const PARAMS4_PROJ_C = 16;
const PARAMS4_CENTER = 20;
const PARAMS4_NEG_COLOR = 24;
const PARAMS4_POS_COLOR = 28;
const PARAMS4_WIDTH = 32;
const PARAMS4_HEIGHT = 33;
const PARAMS4_TRANSFORM_COUNT = 34;
// Reuse the exported byte offset (rather than a fresh literal) so the two
// can never silently drift apart — the one field the driver rewrites
// mid-session, same discipline as flame-gpu.ts.
const PARAMS4_ITERS_PER_INVOCATION = PARAMS4_ITERS_OFFSET_BYTES / 4;
const PARAMS4_COLOR_KIND = 36;
const PARAMS4_WEIGHTED = 37;
const PARAMS4_HAS_FINAL = 38;
const PARAMS4_NUM_CHAINS = 39;
const PARAMS4_TOTAL_WEIGHT = 40;
const PARAMS4_COLOR_DENOM = 41;
const PARAMS4_INV_W_AMP = 42;
const PARAMS4_SLICE_ON = 43;
const PARAMS4_SLICE_CENTER = 44;
const PARAMS4_SLICE_WIDTH = 45;
const PARAMS4_MIN_D = 46;
const PARAMS4_INV_RADIUS_RANGE = 47;
const PARAMS4_SLICE_COLOR_SHIFT = 48;
const PARAMS4_SLICE_COLOR_INV_SCALE = 49;
// Elements 50-51 are the struct's trailing pad, left at the ArrayBuffer's
// zero default.

/**
 * A 4D chaos-game system in exactly the shape {@link packGpuSystem4} needs —
 * the GPU counterpart of the arguments `prepareChaosGame4` takes, plus the
 * session's already-built {@link FourDRenderColor} (the worker constructs it
 * once per accumulation — see `flame-worker-core.ts`'s `buildFourDColor` —
 * so the packer consumes THAT, rather than restating its palette/LUT
 * dispatch and risking drift).
 */
export interface GpuFlameSystemSpec4 {
  transforms4: Transform4[];
  finalTransform4: Transform4 | null;
  color: FourDRenderColor;
}

/**
 * {@link packGpuSystem4}'s result: the packed GPU buffers plus the scalar
 * fields {@link packGpuParams4} needs to describe them — the 4D counterpart
 * of flame-gpu.ts's `PackedGpuSystem`, minus everything symmetry-related
 * (no `baseTransformCount`, no `colorMode`: the color dispatch is
 * {@link KERNEL_COLOR_KIND}, derived from the {@link FourDRenderColor} both
 * packers consume).
 */
export interface PackedGpuSystem4 {
  /** `(transformCount + 1) * SLOT4_STRIDE_BYTES` — one slot per transform,
   * plus the final-transform lens slot. */
  slots: ArrayBuffer;
  /** flame-gpu.ts's `COLORS_BYTES` — always the full 256-entry table,
   * however many entries are actually meaningful (zeros for wRamp). */
  colors: ArrayBuffer;
  transformCount: number;
  weighted: boolean;
  totalWeight: number;
  /** `transformCount - 1`, or `0` for a single-transform system — the
   * structural mode's slot divisor, keyed on the RAW transform count
   * (accumulateFlame4's own `colorDenom`; no symmetry copies to collapse). */
  colorDenom: number;
  hasFinal: boolean;
}

/** Entries in the `colors` table — same 256 x vec4u shape as the 3D
 * kernel's (see flame-gpu.ts's `COLORS_BYTES`, which sizes the buffer). */
const COLOR_LUT_ENTRIES = 256;
const COLORS4_BYTES = COLOR_LUT_ENTRIES * 16;

/** Color for a transform palette entry past `palette.length` — shouldn't
 * happen (the worker builds the palette at exactly `transformCount`
 * entries); mirrors `accumulateFlame4`'s own `FALLBACK_COLOR` so the two
 * paths degrade identically if it ever does. */
const FALLBACK_COLOR: readonly [number, number, number] = [1, 1, 1];

/**
 * Pack a {@link GpuFlameSystemSpec4} into the kernel's Slot4 storage buffer
 * and 256-entry colors buffer — the flat-buffer restatement of
 * `chaos-game-4d.ts`'s `prepareChaosGame4` composition and `flame-4d.ts`'s
 * `accumulateFlame4` weight/color handling.
 *
 * Throws `RangeError` if `transforms4.length` exceeds `MAX_TRANSFORMS` —
 * same check and message shape as `prepareChaosGame4`.
 *
 * **Slots**: slot `i` holds `composeAffine4(transforms4[i])`'s 4x4 rows +
 * translation and the transform's own variation lanes (flame-gpu.ts's
 * `packVariations` filter — `Variation[]` is dimension-free data). There is
 * no symmetry expansion and no post-rotation rows: 4D has neither.
 *
 * **Weights**: mirror `prepareChaosGame4` exactly — `transforms4[i].weight
 * ?? 1`, `cumWeight` the running sum, `weighted` true under the identical
 * `some(w !== 1) && total > 0 && finite` condition, so the kernel's
 * weighted/uniform pick branch agrees with the CPU's bit for bit.
 *
 * **Final transform**: one extra slot at index `transformCount` (never drawn
 * by the pick, which `params.transformCount` bounds) carrying the lens's
 * affine + variations. Absent ⇒ the slot stays zeroed and `hasFinal` is
 * `false`.
 *
 * **Colors** dispatch on `color.kind` ({@link FourDRenderColor}):
 * `"structural"`/`"radius"` pack the 256-entry `color.lut` gradient;
 * `"transform"` packs `color.palette` (one entry per transform, padded with
 * the white {@link FALLBACK_COLOR} if the palette somehow runs short —
 * mirroring `accumulateFlame4`'s own fallback); `"wRamp"` leaves the table
 * zeroed (its color is computed in-shader from the projected s). Every
 * channel goes through `writeColorEntry`'s fixed-point scale.
 */
export function packGpuSystem4(spec: GpuFlameSystemSpec4): PackedGpuSystem4 {
  const { transforms4, finalTransform4, color } = spec;
  if (transforms4.length > MAX_TRANSFORMS) {
    throw new RangeError(
      `IFS supports at most ${MAX_TRANSFORMS} transforms, got ${transforms4.length}`,
    );
  }

  const transformCount = transforms4.length;
  const hasFinal = finalTransform4 !== null;

  const slots = new ArrayBuffer((transformCount + 1) * SLOT4_STRIDE_BYTES);
  const slotF32 = new Float32Array(slots);
  const slotU32 = new Uint32Array(slots);

  // Selection weights — same rule as prepareChaosGame4 (which the CPU oracle
  // accumulateFlame4 drives through pickIndex4): weight ?? 1 per transform,
  // running cumulative sum, weighted only for a genuinely non-uniform system.
  const weights = transforms4.map((t) => t.weight ?? 1);
  let totalWeight = 0;
  const cumWeights = new Float64Array(transformCount);
  for (let i = 0; i < transformCount; i++) {
    totalWeight += weights[i];
    cumWeights[i] = totalWeight;
  }
  const weighted =
    weights.some((w) => w !== 1) &&
    totalWeight > 0 &&
    Number.isFinite(totalWeight);

  for (let i = 0; i < transformCount; i++) {
    const base = i * F32_PER_SLOT4;
    writeSlot4Affine(slotF32, base, transforms4[i]);
    writeSlot4Variations(slotF32, slotU32, base, transforms4[i].variations);
    slotF32[base + SLOT4_CUM_WEIGHT] = cumWeights[i];
  }

  // The final-transform lens: one extra slot, never chosen by the pick
  // (params.transformCount bounds that search), read only when hasFinal = 1.
  if (finalTransform4 !== null) {
    const finalBase = transformCount * F32_PER_SLOT4;
    writeSlot4Affine(slotF32, finalBase, finalTransform4);
    writeSlot4Variations(
      slotF32,
      slotU32,
      finalBase,
      finalTransform4.variations,
    );
  }

  const colors = new ArrayBuffer(COLORS4_BYTES);
  const colorsU32 = new Uint32Array(colors);
  switch (color.kind) {
    case "structural":
    case "radius": {
      for (let i = 0; i < COLOR_LUT_ENTRIES; i++) {
        writeColorEntry(
          colorsU32,
          i,
          color.lut[i * 3],
          color.lut[i * 3 + 1],
          color.lut[i * 3 + 2],
        );
      }
      break;
    }
    case "transform": {
      for (let i = 0; i < transformCount; i++) {
        const [r, g, b] = color.palette[i] ?? FALLBACK_COLOR;
        writeColorEntry(colorsU32, i, r, g, b);
      }
      break;
    }
    case "wRamp":
      // Computed in-shader from the projected s — the table stays zeroed.
      break;
  }

  return {
    slots,
    colors,
    transformCount,
    weighted,
    totalWeight,
    colorDenom: transformCount > 1 ? transformCount - 1 : 0,
    hasFinal,
  };
}

/**
 * Write one slot's affine rows + translation from a `composeAffine4` result:
 * row `r` is `m`'s row `r` (4 coefficients), `trans` is `t` — the exact
 * `m · p + t` `applyAffine4` computes, restated as four dot-product-ready
 * vec4 rows plus a translation vec4 for the kernel's `applySlot`.
 */
function writeSlot4Affine(
  f32: Float32Array,
  base: number,
  transform: Transform4,
): void {
  const { m, t } = composeAffine4(transform);
  for (let c = 0; c < 4; c++) {
    f32[base + SLOT4_ROW_X + c] = m[c];
    f32[base + SLOT4_ROW_Y + c] = m[4 + c];
    f32[base + SLOT4_ROW_Z + c] = m[8 + c];
    f32[base + SLOT4_ROW_W + c] = m[12 + c];
    f32[base + SLOT4_TRANS + c] = t[c];
  }
}

/**
 * Write a slot's variation lanes from a transform's raw variation list —
 * flame-gpu.ts's `packVariations` filter (dimension-free), written at THIS
 * module's Slot4 offsets. An empty/absent list leaves every lane and
 * `varCount` at the `ArrayBuffer`'s zero default — the kernel's "skip the
 * blend" case, exactly like the 3D packer's own `writeSlotVariations`.
 */
function writeSlot4Variations(
  f32: Float32Array,
  u32: Uint32Array,
  base: number,
  variations: Transform4["variations"],
): void {
  const { types, weights } = packVariations(variations);
  for (let v = 0; v < types.length; v++) {
    f32[base + SLOT4_VAR_WEIGHTS + v] = weights[v];
    u32[base + SLOT4_VAR_TYPES + v] = types[v];
  }
  u32[base + SLOT4_VAR_COUNT] = types.length;
}

/**
 * Seed `numChains` independent 4D GPU orbits from `mulberry32(seed)` — the
 * 4D twin of flame-gpu.ts's `packGpuChains`, one deterministic sequence
 * across the whole buffer. Per chain, in order: `pos.xyzw` from `rng() -
 * 0.5` each (`accumulateFlame4`'s fresh-orbit convention — four draws, one
 * more than 3D), the color coordinate set to `0.5` directly (flam3's
 * initial midpoint, no draw) into the aux.y lane via the buffer's OWN
 * Float32Array view (the kernel bitcasts it back — see the byte-layout doc),
 * then one uniform 32-bit draw for the chain's PCG32 seed.
 */
export function packGpuChains4(numChains: number, seed: number): ArrayBuffer {
  const rng: Rng = mulberry32(seed);
  const buf = new ArrayBuffer(numChains * CHAIN4_STRIDE_BYTES);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  for (let c = 0; c < numChains; c++) {
    const base = c * F32_PER_CHAIN4;
    f32[base + CHAIN4_POS] = rng() - 0.5;
    f32[base + CHAIN4_POS + 1] = rng() - 0.5;
    f32[base + CHAIN4_POS + 2] = rng() - 0.5;
    f32[base + CHAIN4_POS + 3] = rng() - 0.5;
    f32[base + CHAIN4_AUX_COLOR] = 0.5;
    u32[base + CHAIN4_AUX_RNG] = Math.floor(rng() * 0x100000000) >>> 0;
  }
  return buf;
}

/**
 * {@link packGpuParams4}'s input: plain scalar fields for every Params4
 * uniform the kernel reads once per dispatch. `projection` is the
 * 20-coefficient composed rotor+camera affine `accumulateFlame4` takes
 * (`composeFlameProjection4`'s output); `view` and `color` are the SAME
 * frozen-view/color objects the CPU oracle takes, so the two paths cannot
 * disagree on what was rendered. The scalar system fields come straight out
 * of a {@link PackedGpuSystem4} plus the caller's chain-count choice.
 */
export interface GpuParams4Fields {
  /** Row-major 4x5 (20 entries): clipX, clipY, clipW, sRaw rows over
   * `(x, y, z, w, 1)` — see `project4.ts`'s `composeFlameProjection4`. */
  projection: Float64Array;
  width: number;
  height: number;
  transformCount: number;
  itersPerInvocation: number;
  weighted: boolean;
  hasFinal: boolean;
  totalWeight: number;
  colorDenom: number;
  numChains: number;
  view: FourDView;
  color: FourDRenderColor;
}

/**
 * Pack the Params4 uniform buffer ({@link PARAMS4_BYTES} long) — every field
 * at the byte offset the layout doc comment above documents. Throws
 * `RangeError` unless `projection` has exactly 20 entries, mirroring
 * `accumulateFlame4`'s own projection-length guard.
 *
 * Projection rows: row `i`'s four coefficients land in `projX`/`projY`/
 * `projW`/`projS` and its constant in `projC`'s lane `i` — ALL four rows are
 * read (unlike the 3D kernel, which skips camera row 2): the 4D composition
 * never carried a clip-Z row in the first place (see
 * `composeFlameProjection4`'s doc), so its four rows are clipX, clipY,
 * clipW, and the rotor's sRaw signal.
 *
 * Color-mode scalars dispatch on `color.kind` ({@link KERNEL_COLOR_KIND}):
 * `"radius"` packs `center4`/`minD` and `invRadiusRange = 1 / (maxD - minD
 * || 1)` — the reciprocal of `accumulateFlame4`'s own degenerate-range-
 * guarded divisor, so the kernel multiplies where the CPU divides;
 * `"wRamp"` packs the side pair into `negColor`/`posColor` (w lanes unused);
 * the other modes leave those fields zeroed (the kernel never reads them).
 *
 * `sliceColorShift`/`sliceColorInvScale` come from `sliceColorRemap(view)`
 * (fr-nn6) — the identity (0, 1) unless the slice is on with the
 * slice-relative color option chosen, so they are packed unconditionally
 * (only the wRamp color kind reads them).
 */
export function packGpuParams4(fields: GpuParams4Fields): ArrayBuffer {
  const { projection, view, color } = fields;
  if (projection.length !== 20) {
    throw new RangeError(
      `packGpuParams4: projection must have 20 entries (row-major 4x5 rotor+camera), got ${projection.length}`,
    );
  }
  const buf = new ArrayBuffer(PARAMS4_BYTES);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  for (let i = 0; i < 4; i++) {
    f32[PARAMS4_PROJ_X + i] = projection[i];
    f32[PARAMS4_PROJ_Y + i] = projection[5 + i];
    f32[PARAMS4_PROJ_W + i] = projection[10 + i];
    f32[PARAMS4_PROJ_S + i] = projection[15 + i];
  }
  f32[PARAMS4_PROJ_C] = projection[4];
  f32[PARAMS4_PROJ_C + 1] = projection[9];
  f32[PARAMS4_PROJ_C + 2] = projection[14];
  f32[PARAMS4_PROJ_C + 3] = projection[19];

  if (color.kind === "radius") {
    for (let i = 0; i < 4; i++) {
      f32[PARAMS4_CENTER + i] = color.center[i];
    }
    f32[PARAMS4_MIN_D] = color.minD;
    f32[PARAMS4_INV_RADIUS_RANGE] = 1 / (color.maxD - color.minD || 1);
  }
  if (color.kind === "wRamp") {
    for (let i = 0; i < 3; i++) {
      f32[PARAMS4_NEG_COLOR + i] = color.side.neg[i];
      f32[PARAMS4_POS_COLOR + i] = color.side.pos[i];
    }
  }

  u32[PARAMS4_WIDTH] = fields.width;
  u32[PARAMS4_HEIGHT] = fields.height;
  u32[PARAMS4_TRANSFORM_COUNT] = fields.transformCount;
  u32[PARAMS4_ITERS_PER_INVOCATION] = fields.itersPerInvocation;
  u32[PARAMS4_COLOR_KIND] = KERNEL_COLOR_KIND[color.kind];
  u32[PARAMS4_WEIGHTED] = fields.weighted ? 1 : 0;
  u32[PARAMS4_HAS_FINAL] = fields.hasFinal ? 1 : 0;
  u32[PARAMS4_NUM_CHAINS] = fields.numChains;
  f32[PARAMS4_TOTAL_WEIGHT] = fields.totalWeight;
  f32[PARAMS4_COLOR_DENOM] = fields.colorDenom;
  f32[PARAMS4_INV_W_AMP] = view.invWAmp;
  u32[PARAMS4_SLICE_ON] = view.sliceOn ? 1 : 0;
  f32[PARAMS4_SLICE_CENTER] = view.sliceCenter;
  f32[PARAMS4_SLICE_WIDTH] = view.sliceWidth;
  const remap = sliceColorRemap(view);
  f32[PARAMS4_SLICE_COLOR_SHIFT] = remap.shift;
  f32[PARAMS4_SLICE_COLOR_INV_SCALE] = remap.invScale;
  return buf;
}

/** Combine an emulated-u64 (lo, hi) word pair into a JS number — restates
 * flame-gpu.ts's private `combineU64` (one multiply-add; not worth an export
 * — see that module's "restated, not imported" pattern for privates). */
function combineU64(lo: number, hi: number): number {
  return lo + hi * 2 ** 32;
}

/**
 * Convert a 4D-kernel `hist` readback into a {@link FlameHistogram} — the
 * inverse of the kernel's fixed-point/emulated-u64 accumulation. Identical
 * contract to flame-gpu.ts's `convertGpuHistogram` (length/dimension
 * `RangeError`s, unconditional-overwrite `out` reuse, recomputed `maxHits`,
 * meaningless `orbit`/`orbitColor` filler), with the 4D scales: `hits`
 * divides by {@link WEIGHT_FIXED_POINT_SCALE} and each `sumRGB` channel by
 * `COLOR_FIXED_POINT_SCALE * WEIGHT_FIXED_POINT_SCALE` (see the module doc's
 * fixed-point-weight scheme). Both divisors are powers of two, so the
 * division is exact in f64 for any value the emulated-u64 pair can carry.
 */
export function convertGpuHistogram4(
  words: Uint32Array,
  width: number,
  height: number,
  out?: FlameHistogram,
): FlameHistogram {
  const bucketCount = width * height;
  const expectedLength = bucketCount * HIST_U32_PER_BUCKET;
  if (words.length !== expectedLength) {
    throw new RangeError(
      `convertGpuHistogram4: expected ${expectedLength} words for ${width}x${height} at ${HIST_U32_PER_BUCKET} words/bucket, got ${words.length}`,
    );
  }
  if (out && (out.width !== width || out.height !== height)) {
    throw new RangeError(
      `convertGpuHistogram4: out histogram is ${out.width}x${out.height}, but ${width}x${height} was requested`,
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

/**
 * Convert a `FLAME_GPU_DOWNSAMPLE_WGSL` `displayHist` readback taken over a
 * 4D-kernel histogram into an existing {@link FlameHistogram} — the 4D
 * counterpart of flame-gpu.ts's `convertGpuDisplayHistogram`, with the same
 * mandatory-`out`/overwrite/`RangeError` contract. The shared downsample
 * kernel is a LINEAR filter over the resident buckets, so the 4D buckets'
 * extra {@link WEIGHT_FIXED_POINT_SCALE} factor rides through it untouched
 * (the kernel's own 1/256 color scale removes only the
 * `COLOR_FIXED_POINT_SCALE` half); this conversion divides that remaining
 * factor out of all four channels — which is the whole reason the downsample
 * WGSL needs no 4D variant (see the module doc).
 */
export function convertGpuDisplayHistogram4(
  data: Float32Array,
  width: number,
  height: number,
  out: FlameHistogram,
): FlameHistogram {
  const bucketCount = width * height;
  const expectedLength = bucketCount * 4;
  if (data.length !== expectedLength) {
    throw new RangeError(
      `convertGpuDisplayHistogram4: expected ${expectedLength} floats for ${width}x${height} at 4 floats/bucket, got ${data.length}`,
    );
  }
  if (out.width !== width || out.height !== height) {
    throw new RangeError(
      `convertGpuDisplayHistogram4: out histogram is ${out.width}x${out.height}, but ${width}x${height} was requested`,
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
