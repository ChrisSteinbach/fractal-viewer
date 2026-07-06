/**
 * SPIKE (fr-53k, throwaway): WGSL compute kernel for GPU flame accumulation.
 *
 * Ports `accumulateFlame`'s hand-inlined chaos-game loop (src/fractal/flame.ts)
 * to a WebGPU compute shader: many independent chains iterate in parallel and
 * scatter into a shared fixed-point histogram with u32 atomics (WGSL has no
 * float atomicAdd).
 *
 * Parity with the CPU loop, and the deliberate differences:
 * - Same stepping semantics: pickIndex (uniform draw / weighted lower-bound
 *   binary search), affine, blended variations, symmetry post-rotation,
 *   escape-reseed at |coord| > 50, final-transform lens adopted only when
 *   finite, identical NDC -> pixel bucketing, flam3 color-coordinate walk.
 * - f32 arithmetic instead of f64. Individual chaotic orbits diverge from the
 *   CPU's immediately; the attractor's *measure* is what the histogram
 *   records, and the comparison harness quantifies the visible difference.
 * - Many short chains with per-chain PCG RNG instead of one mulberry32 orbit.
 *   Same seed-class, different sequence: renders are only statistically
 *   comparable, never byte-identical. Chains warm up once (PLOT=false
 *   pipeline) like the CPU's single 100-iteration warmup.
 * - Histogram buckets are 4 x u32 (hits, r, g, b) with color pre-scaled by
 *   COLOR_FIXED_POINT_SCALE at upload, so the kernel adds integers and the
 *   readback divides once. Channel capacity before overflow:
 *   2^32 / 256 = ~16.7M hits per bucket — the harness watches maxHits.
 * - NaN handling: WGSL comparisons with NaN are false, so the escape test is
 *   written as !(all inside) — a NaN coordinate reseeds, matching the CPU's
 *   !Number.isFinite || |v| > limit check. (Purely-affine systems can only
 *   overflow to inf, which the same test catches.)
 */
import type { VariationType } from "../../fractal/types";

/** Invocations per workgroup; dispatch x = numChains / WORKGROUP_SIZE. */
export const WORKGROUP_SIZE = 128;

/** Fixed-point scale for color channels in the u32 histogram. */
export const COLOR_FIXED_POINT_SCALE = 256;

/** Max variations per transform the Slot layout carries (vec4 lanes). */
export const MAX_SLOT_VARIATIONS = 4;

/**
 * The case indices `applyVariation` switches on — the engine maps a
 * transform's `VariationType` strings through this table when packing slots.
 * Typed as a total Record so a variation added to `types.ts` without a WGSL
 * port fails to compile here instead of silently rendering as `linear`.
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
 * Byte layout contracts (WGSL struct rules; the engine packs ArrayBuffers to
 * match):
 *
 * Params (uniform, 96 bytes):
 *   0 projX vec4f | 16 projY vec4f | 32 projW vec4f
 *   48 width u32 | 52 height u32 | 56 transformCount u32 | 60 baseTransformCount u32
 *   64 itersPerInvocation u32 | 68 colorMode u32 (0 legacy, 1 LUT) | 72 weighted u32 | 76 hasFinal u32
 *   80 totalWeight f32 | 84 colorDenom f32 | 88 numChains u32 | 92 pad
 *
 * Slot (storage array element, 144-byte stride), slot count =
 * transformCount + 1 (the last is the final transform, read only when
 * hasFinal = 1):
 *   0 rowX vec4f (m0 m1 m2 t0) | 16 rowY | 32 rowZ
 *   48 postX vec4f (post-rotation row, w unused) | 64 postY | 80 postZ
 *   96 varWeights vec4f | 112 varTypes vec4u
 *   128 varCount u32 | 132 hasPost u32 | 136 cumWeight f32 | 140 pad
 *
 * Chain (storage array element, 32-byte stride):
 *   0 pos vec4f (xyz orbit point, w color coordinate) | 16 aux vec4u (x rng state)
 *
 * colors: array<vec4u, 256> — palette (legacy: entry per base transform) or
 * LUT (256 gradient entries), channels pre-scaled by COLOR_FIXED_POINT_SCALE.
 *
 * hist: array<atomic<u32>>, width * height * 4 (hits, r, g, b interleaved).
 */
export const FLAME_KERNEL_WGSL = /* wgsl */ `
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
  varWeights: vec4f,
  varTypes: vec4u,
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

// Warmup dispatches run a PLOT=false specialization of the same pipeline —
// iterate the orbit without recording, like the CPU's unrecorded warmup loop.
override PLOT: bool = true;

// PCG-RXS-M-XS 32: one u32 of state per chain, standard for GPU flames.
fn pcgNext(state: ptr<function, u32>) -> u32 {
  let s = *state * 747796405u + 2891336453u;
  *state = s;
  let word = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (word >> 22u) ^ word;
}

// [0, 1): top 24 bits are exact in f32, so the result is strictly below 1
// (f32(u32max) would round UP to 2^32 and return exactly 1.0).
fn rand01(state: ptr<function, u32>) -> f32 {
  return f32(pcgNext(state) >> 8u) * (1.0 / 16777216.0);
}

// The variation registry (variations.ts's VARIATIONS), case-indexed by
// KERNEL_VARIATION_INDEX. Same 3-D generalization: radial warps use the full
// 3-D radius, angular warps act in the xy-plane and carry z through.
fn applyVariation(t: u32, p: vec3f, state: ptr<function, u32>) -> vec3f {
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
      if (rand01(state) >= 0.5) {
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
fn applySlot(slotIdx: u32, p: vec3f, state: ptr<function, u32>) -> vec3f {
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
      acc += s.varWeights[v] * applyVariation(s.varTypes[v], a, state);
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
  var rng = chains[chainIdx].aux.x;

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

    // Escape-reseed, NaN-robust (see module doc).
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
          let bucket = (u32(row) * params.width + u32(col)) * 4u;
          atomicAdd(&hist[bucket], 1u);
          var ci = baseIdx;
          if (params.colorMode == 1u) {
            ci = min(u32(colorCoord * 256.0), 255u);
          }
          let rgb = colors[ci];
          atomicAdd(&hist[bucket + 1u], rgb.x);
          atomicAdd(&hist[bucket + 2u], rgb.y);
          atomicAdd(&hist[bucket + 3u], rgb.z);
        }
      }
    }
  }

  chains[chainIdx].pos = vec4f(pos, colorCoord);
  chains[chainIdx].aux.x = rng;
}
`;
