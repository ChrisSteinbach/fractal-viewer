/**
 * The 4D WebGPU flame-accumulation backend's PURE side: the 4D WGSL
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
 * For the blend-less systems that can reach a render worker (see
 * {@link packGpuSystem4}'s weight note), parity with `accumulateFlame4` (see
 * that function and `chaos-game-4d.ts`'s `stepOrbit4`): same
 * uniform/weighted transform pick, same 4x4+t affine →
 * blended-`variations4` → kaleidoscope post-rotation step (the 4D
 * symmetry expansion `prepareChaosGame4` performs, packed here exactly as
 * `flame-gpu.ts` packs the 3D one: copy-major slots `k · baseTransformCount +
 * i`, each carrying its copy's 4x4 rotation and a `hasPost` flag), same
 * escape-reseed
 * limit over all four coordinates (NaN-robust for f32, like the 3D kernel),
 * same final-transform adopt-only-if-finite lens, same 20-coefficient
 * rotor+camera projection rows (`clipX`/`clipY`/`clipW`/`sRaw` — see
 * `project4.ts`'s `composeFlameProjection4`), same soft w-slice Gaussian
 * with the point-cloud ghost floor (0.06), same optional slice-relative
 * w-ramp recolor (an affine remap of `s` packed from
 * `project4.ts`'s `sliceColorRemap`, identity when off), the same structural
 * color walk over a per-slot palette index and blend speed (resolved
 * host-side by {@link packGpuSystem4} through `chaos-game.ts`'s
 * `derivedColorIndex`/`DEFAULT_COLOR_SPEED`, the very definitions
 * `prepareChaosGame4` resolves the CPU oracle's with), and the same four
 * `FourDRenderColor` flavors (`color.ts`). Deliberate differences are the
 * 3D kernel's own, unchanged: f32 arithmetic instead of f64, and many
 * independent PCG32 chains instead of one mulberry32 orbit (each on its own
 * per-chain stream — see the 3D kernel's pcgNext doc) —
 * statistically the same render, not a byte-identical one.
 *
 * The optional balloon follows the 4D Points arm's settled PROJECT THEN
 * INVERT semantic: evaluate the plotted 4D point through the frozen rotor to
 * the visible 3D point, sphere-invert that point, then pass the result through
 * the frozen camera. Projecting a 4D inversion would be a different object.
 * Like the 3D histogram twin, the echo is one extra weighted splat into the
 * SAME buckets, with echo-only tint, no radial fade, and deliberately no
 * conformal-magnification term — histogram density already measures how the
 * inversion spreads samples.
 *
 * **Weighted histogram mechanism.** `accumulateFlame4` adds a FRACTIONAL
 * slice weight per hit
 * (`sliceWeight` ∈ [0.06, 1] when the soft w-slice is on), but the GPU
 * histogram is integer (emulated-u64 atomics — WGSL has no f32 atomics).
 * Both dimensions now carry {@link WEIGHT_FIXED_POINT_SCALE} = 256 because
 * the 3D balloon echo is fractional too; here
 * `hits` buckets accumulate `round(weight * 256)` and color buckets
 * accumulate `rgbFixed * round(weight * 256)` (≤ 256 · 256 = 2^16 per add —
 * far inside u32), and {@link convertGpuHistogram4} divides both back out on
 * readback. Slice off ⇒ `weight = 1` ⇒ the factor is exactly 256 and the
 * quantization error is identically the 3D kernel's (≤ 1/512 per channel per
 * hit); slice on ⇒ the weight itself quantizes to 1/512 too — invisible
 * under the log-density tonemap, and pinned by the agreement harness.
 *
 * The progressive display downsample needs NO 4D variant:
 * `FLAME_GPU_DOWNSAMPLE_WGSL` (flame-gpu.ts) reads the same scaled 8-word
 * histogram layout in both dimensions. The dimension-named converter stays
 * as the public 4D seam even though its scale is now shared.
 */
import type { Rng } from "./rng";
import type { SymmetryParams, Transform4 } from "./types";
import { createFlameHistogram } from "./flame";
import type { FlameHistogram, Mat4 } from "./flame";
import type { FourDRenderColor } from "./color";
import { W_RAMP_BRIGHTNESS_FLOOR, W_RAMP_EXPONENT, W_RAMP_GRAY } from "./color";
import { sliceColorRemap, SLICE_GHOST_FLOOR } from "./project4";
import type { FourDView, RotorProjection4 } from "./project4";
// Value imports for the packing functions below the kernel — mirrors
// flame-gpu.ts's own split between type-only and value imports.
import { composeAffine4, symmetryRotation4 } from "./affine4";
import {
  DEFAULT_COLOR_SPEED,
  MAX_TRANSFORMS,
  derivedColorIndex,
  effectiveSymmetryOrder,
} from "./chaos-game";
import {
  COLOR_FIXED_POINT_SCALE,
  HIST_U32_PER_BUCKET,
  KERNEL_VARIATION_INDEX,
  WEIGHT_FIXED_POINT_SCALE,
  WORKGROUP_SIZE,
  packVariations,
  writeColorEntry,
} from "./flame-gpu";
import type { GpuFlameBalloonEchoFields } from "./flame-gpu";
import { mulberry32 } from "./rng";
import { isFoldVariationType, resolveFoldRadii } from "./variations";

/**
 * Fixed-point scale for the soft w-slice weight (see the module doc): the
 * kernel adds `round(weight * 256)` to `hits` and `rgbFixed * round(weight *
 * 256)` to each color channel, and {@link convertGpuHistogram4} divides both
 * back out. 256 quantizes the weight to ≤ 1/512 absolute error per hit —
 * the same bound the 3D kernel's color fixed point already carries.
 */
export { WEIGHT_FIXED_POINT_SCALE } from "./flame-gpu";

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
 * Params4 (uniform, {@link PARAMS4_BYTES} = 368):
 *   0 projX vec4f | 16 projY vec4f | 32 projW vec4f | 48 projS vec4f
 *   64 projC vec4f (the four row constants: x=clipX, y=clipY, z=clipW, w=sRaw)
 *   80 center4 vec4f (radius mode's 4D center; zero otherwise)
 *   96 negColor vec4f | 112 posColor vec4f (wRamp side colors, xyz; zero otherwise)
 *   128 width u32 | 132 height u32 | 136 transformCount u32 | 140 baseTransformCount u32
 *   144 itersPerInvocation u32 | 148 colorKind u32 ({@link KERNEL_COLOR_KIND}) | 152 weighted u32 | 156 hasFinal u32
 *   160 numChains u32 | 164 totalWeight f32 | 168 invWAmp f32 | 172 sliceOn u32
 *   176 sliceCenter f32 | 180 sliceWidth f32 | 184 minD f32 | 188 invRadiusRange f32
 *   192 sliceColorShift f32 | 196 sliceColorInvScale f32 (the slice-relative
 *   remap — `sliceColorRemap`'s (shift, invScale); identity (0, 1) when
 *   off) |
 *   200 echoWeight f32 (zero = off) | 204 echoRho f32 |
 *   208 echoProjX vec4f | 224 echoProjY | 240 echoProjZ (rotor-projected
 *   visible-3D coefficients over the raw plotted vec4) |
 *   256 echoProjC vec4f (xyz constants, w unused) |
 *   272 echoCameraX vec4f | 288 echoCameraY | 304 echoCameraW |
 *   320 echoCenterR2 vec4f (visible-3D center xyz, R squared) |
 *   336 echoTintStrength vec4f (tint rgb, strength) |
 *   352 echoPaletteEnabled u32 | 356..367 pad
 *
 * Slot4 (storage array element, {@link SLOT4_STRIDE_BYTES} = 336 stride);
 * slot count = transformCount + 1, the last being the final-transform lens
 * (read only when hasFinal = 1, never drawn by the transform pick). The
 * post-rotation rows sit where the 3D Slot's do — right after the affine
 * block, before the variation lanes — but are FOUR full rows, every lane
 * used (a 4D symmetry copy is a 4x4, where 3D's is a 3x3 in three vec4s
 * with a spare `.w`):
 *   0 rowX vec4f (m0..m3) | 16 rowY (m4..m7) | 32 rowZ (m8..m11) | 48 rowW (m12..m15)
 *   64 trans vec4f (t0..t3)
 *   80 postX vec4f (symmetry post-rotation row 0) | 96 postY | 112 postZ | 128 postW
 *   144 varWeights array<vec4f, 5> | 224 varTypes array<vec4u, 5> (20 lanes of
 *   storage, 17 used — one per `VariationType`; `bulb` took the
 *   count past the 16 four vec4s held, and a vec4 array cannot be widened by
 *   less than four lanes, so three ride spare)
 *   304 varCount u32 | 308 hasPost u32 | 312 cumWeight f32
 *   316 colorIndex f32 | 320 colorSpeed f32 (the flam3 color pair,
 *   resolved per BASE map and written into EVERY kaleidoscope copy of it —
 *   exactly like cumWeight's base-map weight — so the kernel reads
 *   `slots[idx]` with no modulo) | 324..335 trailing pad
 *   336 foldRadii array<vec4f, 3> — the 3D Slot's lane verbatim:
 *   the fold family's AUTHORED lengths indexed by variation type MINUS 12
 *   ([boxfold, spherefold, mandelbox]), (minRadius^2, fixedRadius^2,
 *   boxLimit, unused). Shared meaning across the two kernels for the same
 *   reason `variations4.ts` imports `resolveFoldRadii` rather than
 *   restating it: what an absent field means must have ONE answer, or a 3D
 *   system and its 4D lift render different objects.
 *
 * The stride arithmetic: the pre-symmetry 224 was exactly 14 x 16
 * with no slack — the flam3 color pair had already taken this struct's last
 * two pad words — so the four `vec4f` rows (+64) and `hasPost` (+4) had
 * nowhere to hide. 224 + 68 = 292 bytes of content, and WGSL rounds a struct
 * up to its own alignment (16, from the `vec4f`s), so 292 -> 304 with three
 * trailing pad words. Repurposing a lane instead was not available: unlike
 * the 3D rows, a 4D post-rotation row has no unused `.w`. A later pass
 * added a 17th `VariationType` (`bulb`), which does not fit 16 lanes: both
 * lane arrays grew by one `vec4` (+32 bytes, the smallest step available),
 * so content runs to 324 and the struct rounds 324 -> 336, keeping the same
 * three trailing pad words.
 *
 * Chain4 (storage array element, {@link CHAIN4_STRIDE_BYTES} = 32 stride):
 *   0 pos vec4f (the FULL 4D orbit point — unlike the 3D Chain, no lane is
 *   spare for the color coordinate) | 16 aux vec4u (x rng state, y the color
 *   coordinate BITCAST to u32 — an f32 stored bit-exactly in a u32 lane; the
 *   kernel round-trips it with WGSL `bitcast`, and `packGpuChains4` writes it
 *   through the buffer's own Float32Array view at the same element, z the
 *   chain's odd PCG stream increment)
 *
 * colors: array<vec4u, 256> — gradient LUT (structural/radius) or
 * per-transform palette (transform mode), channels pre-scaled by
 * `COLOR_FIXED_POINT_SCALE` via `writeColorEntry`; zeros for wRamp (whose
 * color is computed in-shader from the projected s instead). The independent
 * balloon LUT is the separate echoColors table at binding 5.
 *
 * hist: array<atomic<u32>>, `width * height * HIST_U32_PER_BUCKET`, the SAME
 * scaled 8-word emulated-u64 bucket layout as the 3D kernel. The backend
 * still reads it through the dimension-named {@link convertGpuHistogram4}
 * seam.
 */
export const PARAMS4_BYTES = 368;
export const SLOT4_STRIDE_BYTES = 384;
export const CHAIN4_STRIDE_BYTES = 32;
/** Byte offset of Params4.itersPerInvocation — the one field the driver
 * rewrites mid-session, exactly like the 3D layout's
 * `PARAMS_ITERS_OFFSET_BYTES`. */
export const PARAMS4_ITERS_OFFSET_BYTES = 144;

export const FLAME_GPU_KERNEL_4D_WGSL = /* wgsl */ `
const ESCAPE_LIMIT: f32 = 50.0;
const PI: f32 = 3.14159265358979;
const EPS: f32 = 1e-12;
// The flame's ghost-context slice floor — project4.ts's SLICE_GHOST_FLOOR
// (the point-cloud view's floor, NOT the solid render's 0), interpolated in.
const SLICE_FLOOR: f32 = ${SLICE_GHOST_FLOOR};

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
  baseTransformCount: u32,
  itersPerInvocation: u32,
  colorKind: u32,
  weighted: u32,
  hasFinal: u32,
  numChains: u32,
  totalWeight: f32,
  invWAmp: f32,
  sliceOn: u32,
  sliceCenter: f32,
  sliceWidth: f32,
  minD: f32,
  invRadiusRange: f32,
  sliceColorShift: f32,
  sliceColorInvScale: f32,
  echoWeight: f32,
  echoRho: f32,
  echoProjX: vec4f,
  echoProjY: vec4f,
  echoProjZ: vec4f,
  echoProjC: vec4f,
  echoCameraX: vec4f,
  echoCameraY: vec4f,
  echoCameraW: vec4f,
  echoCenterR2: vec4f,
  echoTintStrength: vec4f,
  echoPaletteEnabled: u32,
}

struct Slot {
  rowX: vec4f,
  rowY: vec4f,
  rowZ: vec4f,
  rowW: vec4f,
  trans: vec4f,
  postX: vec4f,
  postY: vec4f,
  postZ: vec4f,
  postW: vec4f,
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
  // The 3D Slot's fold lane verbatim — the fold family's authored
  // lengths indexed by type - 12, (minRadius^2, fixedRadius^2, boxLimit).
  foldRadii: array<vec4f, 3>,
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
@group(0) @binding(5) var<storage, read> echoColors: array<vec4u, 256>;

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

fn depositClip(clipX: f32, clipY: f32, clipW: f32, rgb: vec3u, weightFix: u32) {
  if (clipW <= 0.0 || weightFix == 0u) {
    return;
  }
  let ndcX = clipX / clipW;
  let ndcY = clipY / clipW;
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

fn depositPrimary(p: vec4f, rgb: vec3u, weightFix: u32) {
  depositClip(
    dot(params.projX, p) + params.projC.x,
    dot(params.projY, p) + params.projC.y,
    dot(params.projW, p) + params.projC.z,
    rgb,
    weightFix,
  );
}

fn depositEcho(p: vec3f, rgb: vec3u, weightFix: u32) {
  depositClip(
    dot(params.echoCameraX.xyz, p) + params.echoCameraX.w,
    dot(params.echoCameraY.xyz, p) + params.echoCameraY.w,
    dot(params.echoCameraW.xyz, p) + params.echoCameraW.w,
    rgb,
    weightFix,
  );
}

// PCG-RXS-M-XS 32 with per-chain streams — identical to the 3D kernel's
// (see its stream-selector doc); here the odd increment rides in
// aux.z, since aux.y already carries the bitcast color coordinate.
fn pcgNext(rng: ptr<function, vec2u>) -> u32 {
  let s = (*rng).x * 747796405u + (*rng).y;
  (*rng).x = s;
  let word = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (word >> 22u) ^ word;
}

// [0, 1) — identical to the 3D kernel's (top 24 bits, strictly below 1).
fn rand01(rng: ptr<function, vec2u>) -> f32 {
  return f32(pcgNext(rng) >> 8u) * (1.0 / 16777216.0);
}

// The 4D variation registry (variations4.ts's VARIATIONS4), case-indexed by
// flame-gpu.ts's KERNEL_VARIATION_INDEX — the same table as the 3D kernel,
// lifted per variations4.ts's own convention: radial warps (spherical,
// bubble) and swirl use the FULL 4D radius, angular warps act in the
// xy-plane and carry z AND w through, sinusoidal folds all four axes.
fn applyVariation(t: u32, p: vec4f, rng: ptr<function, vec2u>, fr: vec3f) -> vec4f {
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
      if (rand01(rng) >= 0.5) {
        th += PI;
      }
      return vec4f(rq * cos(th), rq * sin(th), p.z, p.w);
    }
    case 12u: { // boxfold — per-axis reflection off the |t| = fr.z planes.
      return 2.0 * clamp(p, vec4f(-fr.z), vec4f(fr.z)) - p;
    }
    case 13u: { // spherefold — ball fold, fr = (mR2, fR2, wall).
      return p * (fr.y / clamp(dot(p, p), fr.x, fr.y));
    }
    case 14u: { // mandelbox — spherefold after boxfold, one variation.
      let b = 2.0 * clamp(p, vec4f(-fr.z), vec4f(fr.z)) - p;
      return b * (fr.y / clamp(dot(b, b), fr.x, fr.y));
    }
    case 15u: { // qsquare — quaternion square; p.x is the real part, p.yzw = (i, j, k).
      return vec4f(p.x * p.x - dot(p.yzw, p.yzw), 2.0 * p.x * p.yzw);
    }
    case 16u: { // bulb — triplex 8th power on x/y/z, w carried through.
      // variations4.ts's bulb term for term: triplex numbers have no 4D
      // structure, so the fourth coordinate rides along untouched, exactly
      // as it does for the angular warps.
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
      return vec4f(rho * s * u8, rho * s * v8, zOut, p.w);
    }
    default: {
      return p;
    }
  }
}

// One slot's full map: 4x4 affine + translation, then the weighted variation
// blend (left to right, so stochastic variations consume the RNG in list
// order), then the kaleidoscope post-rotation. Mirrors accumulateFlame4's
// inlined stepOrbit4 body.
fn applySlot(slotIdx: u32, p: vec4f, rng: ptr<function, vec2u>) -> vec4f {
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
      // The fold family's own lengths, the 3D kernel's selection
      // verbatim — explicit bounds because 15/16 would index past the
      // three lanes.
      var fi = 0u;
      if (ty >= 12u && ty <= 14u) {
        fi = ty - 12u;
      }
      acc += w * applyVariation(ty, a, rng, slots[slotIdx].foldRadii[fi].xyz);
    }
    q = acc;
  }
  if (s.hasPost == 1u) {
    q = vec4f(
      dot(s.postX, q),
      dot(s.postY, q),
      dot(s.postZ, q),
      dot(s.postW, q),
    );
  }
  return q;
}

// The diverging rotated-w ramp — color.ts's wRampColor, with the shape
// constants (exponent, gray notch, brightness floor) interpolated from its
// W_RAMP_* exports so this kernel's copy can't drift from the CPU
// twin. "s" arrives already clamped to [-1, 1].
fn wRampColor(s: f32) -> vec3f {
  let m = pow(abs(s), ${W_RAMP_EXPONENT});
  let side = select(params.posColor.xyz, params.negColor.xyz, s < 0.0);
  let brightness = ${W_RAMP_BRIGHTNESS_FLOOR} + ${1 - W_RAMP_BRIGHTNESS_FLOOR} * m;
  return (vec3f(${W_RAMP_GRAY} * (1.0 - m)) + side * m) * brightness;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn accumulate(@builtin(global_invocation_id) gid: vec3u) {
  let chainIdx = gid.x;
  if (chainIdx >= params.numChains) {
    return;
  }
  var pos = chains[chainIdx].pos;
  var rng = chains[chainIdx].aux.xz;
  var colorCoord = bitcast<f32>(chains[chainIdx].aux.y);

  for (var n = 0u; n < params.itersPerInvocation; n++) {
    // --- pickIndex4 (chaos-game-4d.ts): uniform draw, or weighted lower
    // bound over cumulative weights — identical to the 3D kernel's pick
    // (the pick has no dimension), over the symmetry-EXPANDED slots.
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

    // Structural coloring: blend the color coordinate toward this transform's
    // palette slot, at this transform's own speed, BEFORE stepping — exactly
    // accumulateFlame4's c = c * (1 - speed) + slot * speed, term for
    // term, and consuming no RNG so the orbit stays identical either way.
    // The pair is read straight off the picked slot with no base-map fold —
    // packGpuSystem4 writes each BASE map's pair into every kaleidoscope copy
    // of it, exactly as the 3D packer does.
    if (params.colorKind == 0u) {
      let speed = slots[idx].colorSpeed;
      colorCoord = colorCoord * (1.0 - speed) + slots[idx].colorIndex * speed;
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
      // Color and slice weight belong to the PLOTTED source point, not to
      // whichever of its two projected splats happens to be in-frame. Compute
      // them once, then feed primary and echo into the same histogram.
      let sRaw = dot(params.projS, pp) + params.projC.w;
      let s = clamp(sRaw * params.invWAmp, -1.0, 1.0);
      var weight = 1.0;
      if (params.sliceOn == 1u) {
        let d = (s - params.sliceCenter) / params.sliceWidth;
        weight = SLICE_FLOOR + (1.0 - SLICE_FLOOR) * exp(-0.5 * d * d);
      }

      var rgb: vec3u;
      switch params.colorKind {
        case 0u: { // structural: the flam3 color-coordinate LUT walk.
          let ci = min(u32(colorCoord * 256.0), 255u);
          rgb = colors[ci].xyz;
        }
        case 1u: { // wRamp: in-shader diverging ramp on s.
          let sc = clamp(
            (s - params.sliceColorShift) * params.sliceColorInvScale,
            -1.0,
            1.0,
          );
          rgb = vec3u(round(wRampColor(sc) * ${COLOR_FIXED_POINT_SCALE}.0));
        }
        case 2u: { // transform: picked slot's BASE-map palette entry.
          rgb = colors[idx % params.baseTransformCount].xyz;
        }
        default: { // 3u, radius: source point's 4D distance.
          let d4 = distance(pp, params.center4);
          let t = clamp((d4 - params.minD) * params.invRadiusRange, 0.0, 1.0);
          let li = u32(t * 255.0 + 0.5);
          rgb = colors[li].xyz;
        }
      }

      let wFix = u32(round(weight * ${WEIGHT_FIXED_POINT_SCALE}.0));
      depositPrimary(pp, rgb, wFix);

      if (params.echoWeight > 0.0) {
        // PROJECT THEN INVERT: these three rows produce the exact visible-3D
        // point the main 4D view draws before its camera is applied.
        let source = vec3f(
          dot(params.echoProjX, pp) + params.echoProjC.x,
          dot(params.echoProjY, pp) + params.echoProjC.y,
          dot(params.echoProjZ, pp) + params.echoProjC.z,
        );
        let d = source - params.echoCenterR2.xyz;
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
        let echoWeightFix = u32(round(
          weight * params.echoWeight * ${WEIGHT_FIXED_POINT_SCALE}.0,
        ));
        depositEcho(inv, echoRgb, echoWeightFix);
      }
    }
  }

  chains[chainIdx].pos = pos;
  chains[chainIdx].aux.x = rng.x;
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
const F32_PER_SLOT4 = SLOT4_STRIDE_BYTES / 4; // 96.
const SLOT4_ROW_X = 0;
const SLOT4_ROW_Y = 4;
const SLOT4_ROW_Z = 8;
const SLOT4_ROW_W = 12;
const SLOT4_TRANS = 16;
/** The four rows of a kaleidoscope copy's 4x4 post-rotation —
 * every lane used, unlike the 3D Slot's three rows with a spare `.w`. */
const SLOT4_POST_X = 20;
const SLOT4_POST_Y = 24;
const SLOT4_POST_Z = 28;
const SLOT4_POST_W = 32;
/** `varWeights: array<vec4f, 5>` — 20 lanes of storage, 17 used (one per
 * `VariationType`) — contiguous lanes, same
 * flattening argument as flame-gpu.ts's `SLOT_VAR_WEIGHTS`. */
const SLOT4_VAR_WEIGHTS = 36;
const SLOT4_VAR_TYPES = 56;
const SLOT4_VAR_COUNT = 76;
const SLOT4_HAS_POST = 77;
const SLOT4_CUM_WEIGHT = 78;
/** The flam3 color pair, resolved per BASE map and replicated across
 * its kaleidoscope copies (see {@link packGpuSystem4}) — the kernel's
 * structural walk reads them straight off the picked slot. */
const SLOT4_COLOR_INDEX = 79;
const SLOT4_COLOR_SPEED = 80;
// Elements 81-83 are Slot4's trailing pad, left at the ArrayBuffer's zero
// default.
/** `foldRadii: array<vec4f, 3>` — the 3D Slot's lane verbatim,
 * indexed by variation type MINUS 12; fold `i` sits at
 * `SLOT4_FOLD_RADII + i * 4`. */
const SLOT4_FOLD_RADII = 84;

const F32_PER_CHAIN4 = CHAIN4_STRIDE_BYTES / 4; // 8.
const CHAIN4_POS = 0; // pos.xyzw: the full 4D orbit point.
const CHAIN4_AUX_RNG = 4; // aux.x: rng state.
/** aux.y: the color coordinate — an f32 written through the buffer's
 * Float32Array view into a u32 lane; the kernel bitcasts it back. */
const CHAIN4_AUX_COLOR = 5;
const CHAIN4_AUX_INC = 6; // aux.z: odd PCG stream increment (aux.w unused, left zeroed).

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
const PARAMS4_BASE_TRANSFORM_COUNT = 35;
// Reuse the exported byte offset (rather than a fresh literal) so the two
// can never silently drift apart — the one field the driver rewrites
// mid-session, same discipline as flame-gpu.ts.
const PARAMS4_ITERS_PER_INVOCATION = PARAMS4_ITERS_OFFSET_BYTES / 4;
const PARAMS4_COLOR_KIND = 37;
const PARAMS4_WEIGHTED = 38;
const PARAMS4_HAS_FINAL = 39;
const PARAMS4_NUM_CHAINS = 40;
const PARAMS4_TOTAL_WEIGHT = 41;
const PARAMS4_INV_W_AMP = 42;
const PARAMS4_SLICE_ON = 43;
const PARAMS4_SLICE_CENTER = 44;
const PARAMS4_SLICE_WIDTH = 45;
const PARAMS4_MIN_D = 46;
const PARAMS4_INV_RADIUS_RANGE = 47;
const PARAMS4_SLICE_COLOR_SHIFT = 48;
const PARAMS4_SLICE_COLOR_INV_SCALE = 49;
const PARAMS4_ECHO_WEIGHT = 50;
const PARAMS4_ECHO_RHO = 51;
const PARAMS4_ECHO_PROJ_X = 52;
const PARAMS4_ECHO_PROJ_Y = 56;
const PARAMS4_ECHO_PROJ_Z = 60;
const PARAMS4_ECHO_PROJ_C = 64;
const PARAMS4_ECHO_CAMERA_X = 68;
const PARAMS4_ECHO_CAMERA_Y = 72;
const PARAMS4_ECHO_CAMERA_W = 76;
const PARAMS4_ECHO_CENTER_R2 = 80;
const PARAMS4_ECHO_TINT_STRENGTH = 84;
const PARAMS4_ECHO_PALETTE_ENABLED = 88;

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
  /** Kaleidoscope symmetry — see `chaos-game-4d.ts`'s
   * `prepareChaosGame4`, whose expansion this packer restates. Order 1 (any
   * plane, any twist) packs exactly one unrotated copy of each base map, i.e.
   * the pre-symmetry buffers byte for byte. */
  symmetry: SymmetryParams;
  color: FourDRenderColor;
}

/**
 * {@link packGpuSystem4}'s result: the packed GPU buffers plus the scalar
 * fields {@link packGpuParams4} needs to describe them — the 4D counterpart
 * of flame-gpu.ts's `PackedGpuSystem`, minus its `colorMode` (the color
 * dispatch here is {@link KERNEL_COLOR_KIND}, derived from the
 * {@link FourDRenderColor} both packers consume).
 */
export interface PackedGpuSystem4 {
  /** `(transformCount + 1) * SLOT4_STRIDE_BYTES` — one slot per expanded
   * (copy, base transform) pair, plus the final-transform lens slot. */
  slots: ArrayBuffer;
  /** flame-gpu.ts's `COLORS_BYTES` — always the full 256-entry table,
   * however many entries are actually meaningful (zeros for wRamp). */
  colors: ArrayBuffer;
  /** Expanded slot count feeding the kernel's pick — `order *
   * baseTransformCount`. */
  transformCount: number;
  /** `transforms4.length`: the number of BASE (un-rotated) maps, which the
   * kernel folds a picked slot back onto for the `"transform"` color mode
   * Equal to `transformCount` at symmetry order 1. */
  baseTransformCount: number;
  weighted: boolean;
  totalWeight: number;
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
 * **Geometric expansion** mirrors `prepareChaosGame4` exactly: `order =
 * effectiveSymmetryOrder(symmetry.order, baseTransformCount)`, then slot `k *
 * baseTransformCount + i` (copy-major: every copy's base maps together, copy
 * 0 first) holds base map `i`'s affine rows + translation and its OWN
 * variation lanes (flame-gpu.ts's `packVariations` filter — `Variation[]` is
 * dimension-free data), plus copy `k`'s post-rotation: zeroed for `k = 0`,
 * `affine4.ts`'s `symmetryRotation4(symmetry.plane, 2π·k / order,
 * symmetry.twist)` otherwise — the very generator `prepareChaosGame4` rotates
 * its own copies by, imported rather than restated. `hasPost` is set only in
 * the latter case.
 *
 * **Weights**: at the default symmetry blend, this matches
 * `prepareChaosGame4`'s expanded table — slot `s`'s weight is
 * `transforms4[s % baseTransformCount].weight ?? 1` (every copy of a base map
 * shares its weight), `cumWeight` the running sum, and `weighted` true under
 * the identical `some(w !== 1) && total > 0 && finite` condition.
 * `prepareChaosGame4` additionally scales rotated copies by
 * `symmetry.blend` clamped to [0, 1]; this packer deliberately does not. That
 * field exists only on in-flight morph samples, whose legs render as point
 * clouds, and the flame-worker command carries no such field. Before a flame
 * session packs, state is already the endpoint: a manual mode switch snaps
 * the tween first, while a saved-mode hint enters when the terminal request
 * lands. Thus no partial blend reaches this packer through the render path.
 *
 * **Color slots**: each slot also carries the flam3 pair the
 * kernel's structural walk blends with — `colorIndex` (the transform's own, or
 * `chaos-game.ts`'s `derivedColorIndex(i, baseTransformCount)` even spread) and
 * `colorSpeed` (its own, or `DEFAULT_COLOR_SPEED`) — resolved through exactly
 * the definitions `prepareChaosGame4` resolves `PreparedChaosGame4`'s with,
 * from the BASE map and written into EVERY copy of it, which is what lets the
 * kernel read `slots[idx]` with no `% baseTransformCount` fold while still
 * coloring each kaleidoscope copy as the map it copies. The final-lens slot
 * is never picked, so its pair stays at the `ArrayBuffer`'s zero default.
 *
 * **Final transform**: one extra slot at index `transformCount` (never drawn
 * by the pick, which `params.transformCount` bounds) carrying the lens's
 * affine + variations, with `hasPost` left at 0 (a lens never rotates).
 * Absent ⇒ the slot stays zeroed and `hasFinal` is `false`.
 *
 * **Colors** dispatch on `color.kind` ({@link FourDRenderColor}):
 * `"structural"`/`"radius"` pack the 256-entry `color.lut` gradient;
 * `"transform"` packs `color.palette` (one entry per BASE map — the kernel
 * folds a picked slot back with `idx % baseTransformCount` — padded with the
 * white {@link FALLBACK_COLOR} if the palette somehow runs short, mirroring
 * `accumulateFlame4`'s own fallback); `"wRamp"` leaves the table zeroed (its
 * color is computed in-shader from the projected s). Every channel goes
 * through `writeColorEntry`'s fixed-point scale.
 */
export function packGpuSystem4(spec: GpuFlameSystemSpec4): PackedGpuSystem4 {
  const { transforms4, finalTransform4, symmetry, color } = spec;
  if (transforms4.length > MAX_TRANSFORMS) {
    throw new RangeError(
      `IFS supports at most ${MAX_TRANSFORMS} transforms, got ${transforms4.length}`,
    );
  }

  const baseTransformCount = transforms4.length;
  const order = effectiveSymmetryOrder(symmetry.order, baseTransformCount);
  const transformCount = order * baseTransformCount;
  const hasFinal = finalTransform4 !== null;

  const slots = new ArrayBuffer((transformCount + 1) * SLOT4_STRIDE_BYTES);
  const slotF32 = new Float32Array(slots);
  const slotU32 = new Uint32Array(slots);

  // Selection weights over the EXPANDED slots (never the final slot, which
  // the pick never draws): each slot inherits its base map's weight,
  // defaulting to 1. Unlike prepareChaosGame4, this deliberately does not
  // scale rotated copies by symmetry.blend; the function doc above records
  // the render-path boundary that makes that safe.
  const weights = new Array<number>(transformCount);
  for (let s = 0; s < transformCount; s++) {
    weights[s] = transforms4[s % baseTransformCount].weight ?? 1;
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

  // Flame structural-coloring pair per BASE map, resolved through
  // the SAME two definitions prepareChaosGame4 resolves the CPU oracle's
  // with. The expansion below writes each base map's pair into every copy of
  // it (see this function's doc).
  const colorIndices = transforms4.map(
    (t, i) => t.colorIndex ?? derivedColorIndex(i, baseTransformCount),
  );
  const colorSpeeds = transforms4.map(
    (t) => t.colorSpeed ?? DEFAULT_COLOR_SPEED,
  );

  // Copy-major expansion: copy 0 (unrotated) first, then copy 1, etc. — see
  // prepareChaosGame4's identical loop shape.
  const twist = symmetry.twist ?? 0;
  for (let k = 0; k < order; k++) {
    const post =
      k === 0
        ? null
        : symmetryRotation4(symmetry.plane, (2 * Math.PI * k) / order, twist);
    for (let i = 0; i < baseTransformCount; i++) {
      const s = k * baseTransformCount + i;
      const base = s * F32_PER_SLOT4;
      writeSlot4Affine(slotF32, base, transforms4[i]);
      writeSlot4Post(slotF32, slotU32, base, post);
      writeSlot4Variations(slotF32, slotU32, base, transforms4[i].variations);
      slotF32[base + SLOT4_CUM_WEIGHT] = cumWeights[s];
      slotF32[base + SLOT4_COLOR_INDEX] = colorIndices[i];
      slotF32[base + SLOT4_COLOR_SPEED] = colorSpeeds[i];
    }
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
      // One entry per BASE map — accumulateFlame4 indexes its own palette by
      // `idx % baseTransformCount`, and the kernel folds identically.
      for (let i = 0; i < baseTransformCount; i++) {
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
    baseTransformCount,
    weighted,
    totalWeight,
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
 * Write a kaleidoscope copy's post-rotation rows and set `hasPost` — the 4D
 * twin of flame-gpu.ts's `writeSlotPost`, with four FULL rows instead of
 * three xyz ones. `post === null` (copy 0, or any copy at symmetry order 1)
 * leaves postX/Y/Z/W and `hasPost` at the `ArrayBuffer`'s zero default —
 * exactly the kernel's "no rotation" case, mirroring `prepareChaosGame4`'s
 * `null` for the same slots.
 */
function writeSlot4Post(
  f32: Float32Array,
  u32: Uint32Array,
  base: number,
  post: number[] | null,
): void {
  if (post === null) return;
  for (let c = 0; c < 4; c++) {
    f32[base + SLOT4_POST_X + c] = post[c];
    f32[base + SLOT4_POST_Y + c] = post[4 + c];
    f32[base + SLOT4_POST_Z + c] = post[8 + c];
    f32[base + SLOT4_POST_W + c] = post[12 + c];
  }
  u32[base + SLOT4_HAS_POST] = 1;
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
  // The fold family's authored lengths, keyed by TYPE — the 3D
  // packer's loop verbatim (see writeSlotVariations for why it walks the
  // raw list rather than the filtered lanes).
  for (const v of variations ?? []) {
    if (!isFoldVariationType(v.type)) continue;
    const r = resolveFoldRadii(v);
    const lane =
      base + SLOT4_FOLD_RADII + (KERNEL_VARIATION_INDEX[v.type] - 12) * 4;
    f32[lane] = r.minRadius * r.minRadius;
    f32[lane + 1] = r.fixedRadius * r.fixedRadius;
    f32[lane + 2] = r.boxLimit;
  }
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
 * then one uniform 32-bit draw for the chain's PCG32 seed, then one more
 * forced odd (`(draw << 1) | 1`) for its PCG stream increment into aux.z —
 * the 3D packer's exact convention (see `writeChainSeed`'s doc).
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
    u32[base + CHAIN4_AUX_INC] =
      ((Math.floor(rng() * 0x100000000) << 1) | 1) >>> 0;
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
  /** The EXPANDED slot count the pick searches — `PackedGpuSystem4`'s own. */
  transformCount: number;
  /** The BASE map count the kernel folds a picked slot onto for the
   * `"transform"` color mode — `PackedGpuSystem4`'s own. */
  baseTransformCount: number;
  itersPerInvocation: number;
  weighted: boolean;
  hasFinal: boolean;
  totalWeight: number;
  numChains: number;
  view: FourDView;
  color: FourDRenderColor;
  /** Optional second splat into the same histogram. When present, the two
   * uncomposed projection stages below are required because inversion sits
   * between them (project 4D to visible 3D, invert, then camera-project). */
  echo?: GpuFlameBalloonEchoFields;
  rotorProjection?: RotorProjection4;
  cameraProjection?: Mat4;
  /** Whether binding 5 carries an independent echo-only LUT. */
  echoPalette: boolean;
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
 * — the identity (0, 1) unless the slice is on with the
 * slice-relative color option chosen, so they are packed unconditionally
 * (only the wRamp color kind reads them).
 *
 * There is deliberately no `colorDenom` here any more, for the same
 * reason its 3D sibling lost one: the structural mode's gradient slot is a
 * per-slot value {@link packGpuSystem4} resolves, not a uniform-wide `i /
 * (n - 1)` division the kernel redoes per iteration.
 */
export function packGpuParams4(fields: GpuParams4Fields): ArrayBuffer {
  const { projection, view, color } = fields;
  if (projection.length !== 20) {
    throw new RangeError(
      `packGpuParams4: projection must have 20 entries (row-major 4x5 rotor+camera), got ${projection.length}`,
    );
  }
  if (fields.echo && fields.rotorProjection?.length !== 20) {
    throw new RangeError(
      `packGpuParams4: balloon echo requires rotorProjection with 20 entries, got ${fields.rotorProjection?.length ?? 0}`,
    );
  }
  if (fields.echo && fields.cameraProjection?.length !== 16) {
    throw new RangeError(
      `packGpuParams4: balloon echo requires cameraProjection with 16 entries, got ${fields.cameraProjection?.length ?? 0}`,
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
  u32[PARAMS4_BASE_TRANSFORM_COUNT] = fields.baseTransformCount;
  u32[PARAMS4_ITERS_PER_INVOCATION] = fields.itersPerInvocation;
  u32[PARAMS4_COLOR_KIND] = KERNEL_COLOR_KIND[color.kind];
  u32[PARAMS4_WEIGHTED] = fields.weighted ? 1 : 0;
  u32[PARAMS4_HAS_FINAL] = fields.hasFinal ? 1 : 0;
  u32[PARAMS4_NUM_CHAINS] = fields.numChains;
  f32[PARAMS4_TOTAL_WEIGHT] = fields.totalWeight;
  f32[PARAMS4_INV_W_AMP] = view.invWAmp;
  u32[PARAMS4_SLICE_ON] = view.sliceOn ? 1 : 0;
  f32[PARAMS4_SLICE_CENTER] = view.sliceCenter;
  f32[PARAMS4_SLICE_WIDTH] = view.sliceWidth;
  const remap = sliceColorRemap(view);
  f32[PARAMS4_SLICE_COLOR_SHIFT] = remap.shift;
  f32[PARAMS4_SLICE_COLOR_INV_SCALE] = remap.invScale;
  u32[PARAMS4_ECHO_PALETTE_ENABLED] = fields.echoPalette ? 1 : 0;

  const echo = fields.echo;
  if (echo) {
    const rotorProjection = fields.rotorProjection!;
    const cameraProjection = fields.cameraProjection!;
    f32[PARAMS4_ECHO_WEIGHT] = echo.weight;
    f32[PARAMS4_ECHO_RHO] = echo.balloon.rho;
    for (let i = 0; i < 4; i++) {
      f32[PARAMS4_ECHO_PROJ_X + i] = rotorProjection[i];
      f32[PARAMS4_ECHO_PROJ_Y + i] = rotorProjection[5 + i];
      f32[PARAMS4_ECHO_PROJ_Z + i] = rotorProjection[10 + i];
      f32[PARAMS4_ECHO_CAMERA_X + i] = cameraProjection[i];
      f32[PARAMS4_ECHO_CAMERA_Y + i] = cameraProjection[4 + i];
      f32[PARAMS4_ECHO_CAMERA_W + i] = cameraProjection[12 + i];
    }
    f32[PARAMS4_ECHO_PROJ_C] = rotorProjection[4];
    f32[PARAMS4_ECHO_PROJ_C + 1] = rotorProjection[9];
    f32[PARAMS4_ECHO_PROJ_C + 2] = rotorProjection[14];
    f32[PARAMS4_ECHO_CENTER_R2] = echo.balloon.center[0];
    f32[PARAMS4_ECHO_CENTER_R2 + 1] = echo.balloon.center[1];
    f32[PARAMS4_ECHO_CENTER_R2 + 2] = echo.balloon.center[2];
    f32[PARAMS4_ECHO_CENTER_R2 + 3] = echo.balloon.R * echo.balloon.R;
    f32[PARAMS4_ECHO_TINT_STRENGTH] = echo.tint[0];
    f32[PARAMS4_ECHO_TINT_STRENGTH + 1] = echo.tint[1];
    f32[PARAMS4_ECHO_TINT_STRENGTH + 2] = echo.tint[2];
    f32[PARAMS4_ECHO_TINT_STRENGTH + 3] = echo.tintStrength;
  }
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
