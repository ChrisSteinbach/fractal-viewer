/**
 * WebGPU compute renderer for FOLD 3D surface sessions (fr-tzdg) — the
 * integration of fr-q1f8's measured verdict: the WGSL march kernel traces
 * mandelboxKifs at ~49µs/ray on the same hardware where the WebGL
 * fragment tracer is unbounded (>1300µs/ray), and compiles in ~0.1-0.3s
 * where the fold GLSL links in ~25s on Mesa (fr-096u's entry cliff).
 *
 * A frame is TWO pipelines (an ifs4 session holds two PAIRS — fr-d0nn:
 * a slab-free variant serves every sliceHalfW=0 frame at a measured
 * 2.2-2.4x kernel discount, the full fr-wa6o pair any h > 0 frame),
 * both bounded by construction (no submission
 * ever outruns the i915 watchdog): MARCH passes advance every active ray
 * by `stepsThisPass` DE steps (the bench's proven register-light kernel,
 * ray derivation swapped to the GLSL tracer's unproject), with the active
 * list compacted host-side between them FROM 4 B PER ACTIVE RAY (fr-si66:
 * the march writes each dispatched ray's status to its own slot in the
 * list being rebuilt, so the sweep no longer reads the whole 16 B/ray
 * states buffer back to look at one field of it — the frame's states
 * never leave the device now, and the terminal tally is kept as rays
 * leave the list); rays that turn terminal join the
 * SHADE QUEUES drained in host-sized batches through the shade kernel (the
 * GLSL tracer's full shading, mirrored term for term). The split is a
 * measured verdict, not taste: shading a freshly-hit ray costs ~40
 * zero-cutoff on-surface DE evals, and the v1 megakernel — which shaded
 * rays inside whichever march pass terminated them — measured 1.1-5.3s
 * per pass on Iris and LOST THE DEVICE at full depth/budgets (fr-096u's
 * watchdog through the shading door; numbers on the fr-tzdg bead).
 *
 * Shade batches are sized in HIT units, not ray units (fr-p8bc's second
 * lesson): only HIT rays pay the on-surface probe evals — miss/exhausted
 * rays write one background pixel — and the queue arrives in scanline
 * order, so cost is spatially CLUSTERED. The original ray-unit doubling
 * grew batch capacity across a run of ~free misses and then submitted
 * thousands of rays straight into a hit band (~108 ms/hit measured
 * full-width near-surface on Iris) — several seconds past the ~7.5 s
 * i915 preemption watchdog, five kernel-confirmed GPU HANGs (ecode
 * 12:1:85dcfffb) in one bench session, and reactive quartering can only
 * react AFTER the killing batch. Now misses drain WHOLE — one dispatch
 * per sweep, no cost cap, since one background write per ray is not a
 * cost to model (fr-257o) — and hit batches are sized
 * predictively from a two-term cost model, `intercept + n·marginal`
 * ({@link ShadeHitCost}, {@link shadeHitBatchSize}), under a slow-growing
 * capacity cap ({@link nextShadeBatchSize}) that bounds the first
 * encounter with an unmeasured-cost region. THE TWO TERMS ARE THE POINT
 * (fr-2ojg): a shade dispatch's wall time is flat in its width to at
 * least eight workgroups on Iris, so charging a whole submission's time
 * to its ray count read LATENCY as per-hit work and the sizer walked
 * itself down to the floor — fr-d6g5's trapdoor at every width below the
 * occupancy knee rather than only at n=1.
 *
 * Division of labor: this module owns the DEVICE — acquisition, the
 * per-session pipeline (the DE is frozen at session enter, matching the
 * surface session's snapshot semantics), the bounded pass loop, readback —
 * and returns finished RGBA8 frames. scene.ts owns presentation (DataTexture
 * upload + the shared surface blit to the one WebGL canvas, so capture and
 * the recorder keep working unchanged) and assembles frame specs (camera,
 * tier budgets, live SurfaceParams). main.ts owns routing and choreography
 * (preview/settle cadence, fallback to the WebGL tracer).
 *
 * No Three.js here, deliberately: inputs are plain arrays and numbers, so
 * the module's contract is the kernel's byte-layout contract plus a handful
 * of pure helpers (background prefill, pass sizing) that carry unit tests.
 *
 * Failure taxonomy follows flame-gpu-backend.ts: a context with no usable
 * WebGPU throws {@link SurfaceComputeUnavailableError} (the session routes
 * to the WebGL tracer — THE fallback); anything else (WGSL compile, device
 * creation) is a plain rejection the session treats the same way. The
 * renderer never attempts its own fallback. `device.lost` latches
 * {@link SurfaceComputeRenderer.lost} and fires `onLost` once — the session
 * re-enters via the WebGL path.
 */

import type { BulbDE } from "../fractal/bulb-de";
import type { EscapeDE } from "../fractal/escape-de";
import type { EscapeDE4 } from "../fractal/escape-de-4d";
import type {
  SurfaceGpu4View,
  SurfaceGpuGroundPlane,
  SurfaceGpuRunParams,
} from "../fractal/surface-de-gpu";
import {
  packBulbGpuParams,
  packEscape4GpuMaps,
  packEscape4GpuParams,
  packEscapeGpuMaps,
  packEscapeGpuParams,
  packSurface4GpuParams,
  packSurfaceGpuMaps,
  packSurfaceGpuMaps4,
  packSurfaceGpuParams,
  packSurfaceGpuShade,
  packSurfaceGpuShadeMaps,
  SURFACE_GPU_MAP_VEC4,
  SURFACE_GPU_PARAMS4_BALLOON_BYTES,
  SURFACE_GPU_PARAMS4_BYTES,
  SURFACE_GPU_PARAMS4_ESCAPE_BYTES,
  SURFACE_GPU_PARAMS4_LENS_BYTES,
  SURFACE_GPU_PARAMS4_PLANE_BYTES,
  SURFACE_GPU_PARAMS_BALLOON_BYTES,
  SURFACE_GPU_PARAMS_BYTES,
  SURFACE_GPU_PARAMS_PLANE_BYTES,
  SURFACE_GPU_RAY_ACTIVE,
  SURFACE_GPU_RAY_EXHAUSTED,
  SURFACE_GPU_RAY_HIT,
  SURFACE_GPU_RAY_MISS,
  SURFACE_GPU_RAY_PLANE,
  SURFACE_GPU_SHADE_BYTES,
  surfaceDeKernelWgsl,
} from "../fractal/surface-de-gpu";
import {
  deHasFolds,
  SURFACE_FOLD_BEAM_WIDTH,
  type SurfaceDE,
} from "../fractal/surface-de";
import type { SurfaceDE4 } from "../fractal/surface-de-4d";
import { deHasFolds4, slabExact4 } from "../fractal/surface-de-4d";
import type { RgbStop } from "../fractal/palette";
import type { Vec3 } from "../fractal/types";
import { clamp } from "../fractal/vec";
import { webgpuAdapterStatus } from "./render-backend";

type SurfaceComputeTraceSink = (line: string) => void;

let surfaceComputeTrace: SurfaceComputeTraceSink | null = null;

/** Opt-in frame-loop tracing (fr-d6g5): captured once per frame at start. */
export function setSurfaceComputeTrace(
  sink: SurfaceComputeTraceSink | null,
): void {
  surfaceComputeTrace = sink;
}

/**
 * Debug-only pins on the frame loop's three sizing dials (fr-fniy), read
 * once per frame exactly like the trace sink above:
 * `?surfacemarchchunk=N` forces every march slice to N rays,
 * `?surfacemarchsteps=S` forces the per-ray step budget to S, and
 * `?surfaceshadehits=H` forces every HIT shade batch to H hits — each in
 * place of the measured estimate that normally picks it.
 *
 * THEY EXIST BECAUSE A SIZER CANNOT OTHERWISE BE ASKED ITS OWN QUESTION.
 * Both sizers price a dispatch per unit of work, and a per-unit cost is
 * only meaningful where a dispatch has no large fixed cost — the defect
 * fr-2ojg found on the shade side, where the same statistic was measuring
 * the wrong quantity outright. Deciding that means pricing cost against
 * WIDTH, and the widths a sizer picks are picked BY the estimate under
 * test: "THE TABLE ALONE PROVES NOTHING"
 * (docs/surface-compute-renderer.md). A FORCED width is the one lever
 * independent of the model, and until these pins existed the renderer had
 * no such lever at all — every recorded cost-vs-width table in that
 * document is bucketed over widths its own model chose.
 *
 * THEY ARE DIAGNOSTIC KNOBS, NOT BOUNDED ONES, and the bounds they can
 * leave are worth knowing before pointing one at a machine you care
 * about. The WIDTH pins only ever ask for less than the schedule would
 * have allowed on its own — a march slice is still clamped by the
 * remaining active list and the device's dispatch ceiling, a hit batch by
 * the queue and the same ceiling — except that the hit pin deliberately
 * overrides BOTH {@link SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH} and the
 * adaptive capacity, because "is that cap costing us anything" is a
 * question the cap itself would otherwise answer no to; a large enough
 * value therefore buys a single multi-million-hit dispatch and the
 * watchdog conversation that goes with it.
 *
 * The STEPS pin is the one that can ask for MORE. It shrinks the model's
 * march width by the factor it raises the step count, so the pass-target
 * bound rides through — until {@link marchChunkFor}'s
 * {@link SURFACE_COMPUTE_MARCH_CHUNK_MIN} floor takes over, which at a
 * far-field EMA happens around eight steps; past that the width stops
 * compensating and dispatch work grows linearly with the pin. The real
 * bound above it is the kernel's own `steps >= params.marchSteps` break,
 * not the sizer. Both are fine for an instrument run and neither is
 * something to leave in a URL. `?surfacesamples=N` and `?surfacemaxrays=N`
 * are the same shape of escape hatch.
 */
let surfaceComputeMarchChunkPin: number | null = null;
let surfaceComputeMarchStepsPin: number | null = null;
let surfaceComputeShadeHitsPin: number | null = null;

function positivePin(value: number | null | undefined): number | null {
  return value !== null &&
    value !== undefined &&
    Number.isFinite(value) &&
    value >= 1
    ? Math.floor(value)
    : null;
}

/** See {@link surfaceComputeMarchChunkPin}. Any field may be null or
 * absent to leave that dial adaptive. */
export function setSurfaceComputeSchedulePins(pins: {
  marchChunk?: number | null;
  marchSteps?: number | null;
  shadeHits?: number | null;
}): void {
  surfaceComputeMarchChunkPin = positivePin(pins.marchChunk);
  surfaceComputeMarchStepsPin = positivePin(pins.marchSteps);
  surfaceComputeShadeHitsPin = positivePin(pins.shadeHits);
}

/** Threads per workgroup — fr-q1f8's measured winner (private frontier,
 * stage-1 prune only; wg size itself measured a non-factor, 64 matches the
 * bench's private-variant default). */
export const SURFACE_COMPUTE_WORKGROUP_SIZE = 64;

/** Frontier width for the shade kernel's PROBE evals — the normal/shadow/
 * AO taps, fr-p8bc's lever: they light a hit the full-width march already
 * certified, never decide geometry, so they ride the width-1 greedy
 * descent. MEASURED VERDICT (gpu-bench shade A/B leg, real Iris Xe,
 * mandelboxKifs 96x54, identical 660-hit sets): full-width probe shading
 * 740 s/frame vs 31 s at width 1 (23.8x, thermally understated), and at
 * the hit-dominated near pose the full-width arm cannot even converge a
 * 900 s budget — while the images are eyeball-identical (differences are
 * a slight lightening of deep-crease shadow/AO from the greedy DE's
 * overshoot; 8.1% of pixels differ by >8/255, mean 23.5 on those, no
 * structural artifacts). Rerun via
 * `npm run bench:surface -- --display=:0 --surface-shade-width=1`. */
export const SURFACE_COMPUTE_SHADE_DE_WIDTH = 1;

/** Per-pass GPU-time target the adaptive `stepsThisPass` doubles toward —
 * the bench host loop's own pacing constant. Far under the ~7.5s i915
 * preemption watchdog (fr-096u) while keeping pass overhead amortized. */
export const SURFACE_COMPUTE_PASS_TARGET_MS = 250;

/** Cap on DE steps a single dispatch may advance a ray — the bench's own
 * bound; with the full march budget at 160 a frame is never more than a
 * few dozen passes. */
export const SURFACE_COMPUTE_MAX_STEPS_PER_PASS = 32;

/** Default interval between progressive presents of a long frame. */
export const SURFACE_COMPUTE_PROGRESS_MS = 500;

/** The gamma both tracers encode their output with (surface-material.ts's
 * `pow(linBase * lit, 1/2.2)` and its WGSL mirror). fr-vpbq's averaging
 * has to undo it before summing and reapply it after, or antialiased
 * edges come out too dark — the classic non-linear-average bug. */
const SURFACE_OUTPUT_GAMMA = 2.2;

/** Decode table for that gamma: byte -> linear light. 256 entries, so the
 * per-sample accumulation costs a table lookup per channel instead of a
 * `Math.pow` per channel per pixel. */
const SRGB_TO_LINEAR = /* @__PURE__ */ (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    table[i] = Math.pow(i / 255, SURFACE_OUTPUT_GAMMA);
  }
  return table;
})();

/**
 * Where inside its pixel sample `s` aims (fr-vpbq).
 *
 * Sample 0 is the pixel CENTRE exactly, so a supersampled job's first pass
 * reproduces the pre-fr-vpbq frame value for value and every later pass
 * only refines it. The rest walk the R2 low-discrepancy sequence (Roberts'
 * generalized golden ratio) from that centre: a fixed, seedless,
 * well-distributed 2D stratification that needs no state, gives the same
 * offsets for the same `s` on every device, and — unlike a jittered grid —
 * is progressive, so stopping after any number of samples still leaves an
 * evenly covered pixel.
 */
export function subPixelSample(s: number): [number, number] {
  if (s <= 0) return [0.5, 0.5];
  return [
    (0.5 + 0.7548776662466927 * s) % 1,
    (0.5 + 0.569840290998053 * s) % 1,
  ];
}

/** Re-encode a linear-light accumulator as RGBA8, reusing `alpha`'s alpha
 * channel (always opaque, but copied rather than assumed). */
function encodeLinearMean(
  accum: Float32Array,
  taken: number,
  alpha: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(alpha.length);
  const inv = 1 / taken;
  const invGamma = 1 / SURFACE_OUTPUT_GAMMA;
  for (let p = 0, a = 0; p < out.length; p += 4, a += 3) {
    out[p] = Math.round(255 * Math.pow(accum[a] * inv, invGamma));
    out[p + 1] = Math.round(255 * Math.pow(accum[a + 1] * inv, invGamma));
    out[p + 2] = Math.round(255 * Math.pow(accum[a + 2] * inv, invGamma));
    out[p + 3] = alpha[p + 3];
  }
  return out;
}

/** A context with no usable WebGPU at all (`navigator.gpu` missing, or no
 * compatible adapter) — the session's signal to route to the WebGL tracer
 * without noting an error. */
export class SurfaceComputeUnavailableError extends Error {}

/**
 * A raster this device cannot allocate a frame's buffers for (fr-biox):
 * past its own `maxBufferSize`/`maxStorageBufferBindingSize`, or refused
 * by the allocator. Thrown BEFORE the kernels ever see it, because WebGPU
 * does not throw here on its own — an over-limit `createBuffer` returns an
 * INVALID buffer plus a validation error, and the first thing that rejects
 * is the staging `mapAsync`, whose "Invalid buffer" says nothing about the
 * size that caused it (the fr-biox field report, from a 4x export).
 */
export class SurfaceComputeFrameSizeError extends Error {}

/**
 * What one compute session traces (fr-dlxh): an IFS attractor descent
 * (the fr-tzdg/fr-55s1 fold and fold-lens classes, `SurfaceDE` frozen at
 * enter), an escape-time forward orbit (`EscapeDE`, the systems
 * `analyzeEscapeSystem` admits — the IFS gate's complement), a
 * Mandelbulb forward orbit (`BulbDE`, the systems `analyzeBulbSystem`
 * admits — fr-tdin; structurally the escape kind one formula over, so
 * every branch below that names "escape" names this too), or a 4D IFS
 * descent (`SurfaceDE4`, the fr-dlxh 4D cut — the systems
 * `analyzeSurfaceSystem4` admits; its rotor/slice VIEW is per-frame SPEC
 * state, never frozen here). The kind picks the kernel core, the params
 * packer and the maps buffer's layout; everything else — the bounded
 * march/shade host loop, the progressive presents, the failure ladder —
 * is shared.
 *
 * A fifth kind since fr-vag4: a 4D escape-time forward orbit
 * (`EscapeDE4`, the systems `analyzeEscapeSystem4` admits — the 4D IFS
 * gate's complement), which is the first target that is BOTH forward and
 * 4D. It takes the ifs4 kind's per-frame `view4` and its `GpuMap4` maps
 * layout, and the escape kind's everything-else.
 *
 * An `ifs`/`ifs4` target's `balloon` flag (fr-5wlv.5, lifted by fr-qxxw)
 * compiles the kernels with the balloon inverted-union wrapper over
 * whichever core/lens the DE picks; the live balloon parameters then ride
 * every frame's spec (`SurfaceComputeFrameSpec.balloon` — the R slider's
 * live-per-frame door, view4's discipline). No FORWARD kind ever sets it
 * (the codegen throws for all three: a filled solid's echo swallows the
 * camera — fr-5wlv.4's measured verdict for the escape solid, re-measured
 * on the Mandelbulb by fr-tdin).
 */
export type SurfaceComputeTarget =
  | { kind: "ifs"; de: SurfaceDE; balloon?: boolean; groundPlane?: boolean }
  | { kind: "escape"; de: EscapeDE; groundPlane?: boolean }
  | { kind: "bulb"; de: BulbDE; groundPlane?: boolean }
  | { kind: "escape4"; de: EscapeDE4; groundPlane?: boolean }
  | {
      kind: "ifs4";
      de: SurfaceDE4;
      balloon?: boolean;
      groundPlane?: boolean;
    };

/** The FORWARD-orbit kinds (fr-dlxh's escape, fr-tdin's bulb, fr-vag4's
 * escape4): a forward orbit rather than an inverse descent, so no descent
 * lens and no frontier width — and the same session-shaping consequences
 * everywhere the host loop asks "is this a descent?". Named once so a
 * fourth forward core cannot be added to one branch and missed in
 * another.
 *
 * NOT "no maps buffer": the two ESCAPE kinds carry their formula chain on
 * the maps binding (fr-s04t, fr-vag4), so every maps-shaped branch names
 * them before it reaches this predicate — bulb is the one bindingless
 * kind. */
export function isForwardTarget(
  target: SurfaceComputeTarget,
): target is
  | { kind: "escape"; de: EscapeDE; groundPlane?: boolean }
  | { kind: "bulb"; de: BulbDE; groundPlane?: boolean }
  | { kind: "escape4"; de: EscapeDE4; groundPlane?: boolean } {
  return (
    target.kind === "escape" ||
    target.kind === "bulb" ||
    target.kind === "escape4"
  );
}

/** The 4D kinds: the ones whose frame spec must carry `view4` (their
 * rotor/slice is per-FRAME state, never frozen at enter) and whose maps
 * ride the `GpuMap4` layout. `escape4` is in both this set and
 * {@link isForwardTarget}. */
export function isFourDTarget(target: SurfaceComputeTarget): target is
  | {
      kind: "ifs4";
      de: SurfaceDE4;
      balloon?: boolean;
      groundPlane?: boolean;
    }
  | { kind: "escape4"; de: EscapeDE4; groundPlane?: boolean } {
  return target.kind === "ifs4" || target.kind === "escape4";
}

/** Everything one frame needs beyond the session-frozen DE: raster size,
 * camera, tier budgets, live lighting/color params. Assembled by scene.ts
 * (`surfaceComputeFrameSpec`) so the eps discipline stays in one place:
 * `acceptPixelEps` derives from the NATIVE buffer height (fr-7xgi — a
 * preview coarsens sampling, never acceptance), `tracePixelEps` from the
 * trace raster's own height (dither + normal probe scale). */
export interface SurfaceComputeFrameSpec {
  width: number;
  height: number;
  /** Column-major inverse(projection * view) — THREE.Matrix4.elements of
   * the exact matrix the GLSL tracer gets as uInvProjView. */
  invProjView: Float32Array;
  camPos: Vec3;
  acceptPixelEps: number;
  tracePixelEps: number;
  /** Tier depth clamp — previewMaxDepth(...) for previews, de.maxDepth
   * for full frames. */
  maxDepth: number;
  marchSteps: number;
  shadowSteps: number;
  aoTaps: number;
  /** Tier hit floor (fraction of boundingRadius) — surface-material.ts's
   * SURFACE_FULL_HIT_FLOOR / SURFACE_PREVIEW_HIT_FLOOR. */
  hitFloor: number;
  lightDir: Vec3;
  ambient: number;
  /** The scene backdrop's two gradient stops (fr-5ps1) — the pair the GLSL
   * tracers carry as uBgTop/uBgBottom, fed to the shade kernel's miss/fog
   * gradient AND the host prefill, re-read per spec assembly like the
   * lighting. */
  bgTop: Vec3;
  bgBottom: Vec3;
  /** Index into SURFACE_COLOR_SOURCES — the shader's dispatch integer. */
  colorSource: number;
  colorSpeed: number;
  /** 256x4 RGBA bytes (scene.ts's Uint8-quantized ramp), or null for the
   * transform color source (a white LUT is bound, never sampled). */
  lut: Uint8Array | null;
  /** Monotonic version so the renderer re-uploads the LUT texture only
   * when the ramp actually changed. */
  lutVersion: number;
  dither: boolean;
  /** The 4D session's LIVE view (fr-dlxh 4D cut): the same (rotor, w0,
   * sliceHalfW) triple `setSurfaceView4` receives, re-read from scene
   * state at every spec assembly — the spec is rebuilt per renderFrame,
   * which is exactly what keeps the rotor/slice as live as the camera.
   * REQUIRED for an `ifs4` target (runFrame throws without it — a 4D
   * frame with no pose is a contract bug, not a default); ignored for
   * the 3D kinds. */
  view4?: SurfaceGpu4View;
  /** The balloon session's LIVE inverted-union parameters (fr-5wlv.5):
   * `buildBalloon`'s convention — center + MARGINED rho (the bound's
   * divisor), R in world units — plus the march far cap
   * (`BALLOON_FAR_CAP_RHO · raw ball radius`). Re-read from scene state
   * at every spec assembly so the R slider is live per-frame, exactly
   * view4's rotor/slice discipline across the WebGPU seam. REQUIRED when
   * the session's target was created with `balloon: true` (runFrame
   * throws without it — the balloon kernel's params struct is 320 bytes
   * and has no meaningful default); ignored otherwise. */
  balloon?: { center: Vec3; rho: number; R: number; far: number };
  /** Depth-fog density multiplier (fr-5h5d) — the WGSL params struct's
   * former pad1 slot (module doc in `fractal/surface-de-gpu.ts`), re-read
   * from scene state at every spec assembly like the rest of this
   * interface. Defaults to 1 (the pre-fr-5h5d fixed fog) when omitted,
   * matching {@link SurfaceGpuRunParams.fogDensity}'s own default. */
  fogDensity?: number;
  /** Fog tint color (fr-5h5d) — the ShadeParams tail (module doc in
   * `fractal/surface-de-gpu.ts`): the shade kernel's fog blends toward
   * mix(bg, fogTint, fogTintStrength); re-read from scene state at every
   * spec assembly like fogDensity. Defaults to [1, 1, 1] when omitted,
   * matching {@link packSurfaceGpuShade}'s own default. */
  fogTint?: Vec3;
  /** Fog tint strength (fr-5h5d), 0..1 — 0 (the default when omitted,
   * matching {@link packSurfaceGpuShade}) is the identity: fog toward
   * the pixel's own backdrop color alone; misses keep the pure untinted
   * backdrop either way. */
  fogTintStrength?: number;
  /** Ground plane block (fr-rhn5) — REQUIRED whenever the session's
   * target carried `groundPlane: true` (the kernels' 336-byte params
   * struct has no meaningful default; view4/balloon's required-throw
   * discipline), ignored otherwise. Re-derived from scene state at every
   * spec assembly like the balloon block. */
  groundPlane?: SurfaceGpuGroundPlane;
}

export interface SurfaceComputeFrameOptions {
  /** Wall-clock cap for the whole frame; rays still active when it runs
   * out keep their background prefill and the frame reports `truncated`. */
  budgetMs?: number;
  /** This frame is an off-canvas CAPTURE (a Save-PNG tile), not the live
   * pane (fr-biox): it neither seeds from the last live frame nor becomes
   * the seed for the next one. Both directions would be wrong — an export
   * traces a different raster (and, tiled, a BAND of a different image),
   * and it needs no seed at all, having no wall budget to leave rays
   * unresolved by. */
  capture?: boolean;
  /** Progressive present: called with a full-frame RGBA snapshot at most
   * every `progressIntervalMs` while rays are still marching. `done` /
   * `total` are ray-work tallies from `surfaceComputeProgressDone`
   * (fr-tdft): a ray's march half accrues CONTINUOUSLY with its consumed
   * steps and lands in full on going terminal; the shade half lands once
   * its pixel is shaded. The fr-tmgf disclosure hook: main.ts drives the
   * surface progress row from them, so a compute settle reports honest
   * coverage the way the WebGL strip path's `surfaceRenderProgress()`
   * does. `done` may be fractional. */
  onProgress?: (pixels: Uint8Array, done: number, total: number) => void;
  progressIntervalMs?: number;
  /**
   * Samples per pixel (fr-vpbq). `1` — the default and every preview's
   * value — is the pre-supersampling path, call for call.
   *
   * WHY IT IS N FRAMES AND NOT N RAYS. fr-vpbq measured the escape-time
   * speckle as sub-pixel structure the marcher cannot reach: partial
   * coverage at 16 spp is 8-13% of the object's pixels against a unit
   * sphere's 1.31%, and its exponent against output resolution is
   * -0.21..-0.36 where the sphere measures the perimeter law at -0.98, so
   * no viewport resolves it. The fix is samples, not pixels. Widening a
   * frame to N rays per pixel would multiply the five per-ray buffers and
   * meet fr-biox's device ray ceiling N times sooner; tracing N FRAMES at
   * N sub-pixel offsets and averaging costs the same GPU work, keeps
   * every buffer and every watchdog bound exactly as measured, and makes
   * the result PROGRESSIVE — sample 0 is the pre-fr-vpbq image, arriving
   * when it always did, and each later one only improves it. A superseded
   * job keeps the samples it finished.
   */
  samples?: number;
}

export interface SurfaceComputeFrame {
  /** RGBA8, row 0 = bottom (the kernel's py=0 row is ndcY=-1), matching
   * an unflipped DataTexture under the shared blit quad. */
  pixels: Uint8Array;
  width: number;
  height: number;
  wallMs: number;
  /** Measured compute-submission time (excludes readbacks) — the honest
   * cost sample for the preview governor. */
  gpuMs: number;
  /** March / shade portions of {@link gpuMs} — the fr-p8bc verdict split:
   * shading dominance is the measured lever the shade probe width
   * targets, so the two costs stay separately visible. */
  marchMs: number;
  shadeMs: number;
  passes: number;
  truncated: boolean;
  /** Final ray-status tallies — how the frame's rays ended (`active` is
   * nonzero only on truncated frames). Field-debuggability: an
   * exhausted-dominated frame means the march budget ran dry, a
   * miss-dominated one that rays left the visible sphere; `plane`
   * (fr-rhn5) counts misses the march classified onto the ground plane
   * (always 0 without a plane target). Kept as rays LEAVE the active list
   * since fr-si66 — `active` is the remainder — where it used to be a
   * final scan of a ray-state buffer the frame loop no longer reads. */
  counts: {
    hit: number;
    miss: number;
    exhausted: number;
    active: number;
    plane: number;
  };
}

/**
 * The background gradient the kernel writes for miss rays, prefilled
 * host-side so rays still ACTIVE at a budget cut present backdrop instead
 * of stale memory (the kernel's documented host contract). Byte-for-byte
 * the kernel's own `pack4x8unorm(mix(bgBottom, bgTop, (py+0.5)/h))`:
 * pack4x8unorm rounds `floor(0.5 + 255*clamp(v))`, which is Math.round on
 * the positive domain — so a truncated frame's active pixels are
 * indistinguishable from its miss pixels.
 */
export function buildSurfaceComputeBackground(
  width: number,
  height: number,
  bgTop: Vec3,
  bgBottom: Vec3,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(width * height * 4);
  for (let py = 0; py < height; py++) {
    const v = clamp((py + 0.5) / height, 0, 1);
    const r = Math.round(
      clamp(bgBottom[0] + (bgTop[0] - bgBottom[0]) * v, 0, 1) * 255,
    );
    const g = Math.round(
      clamp(bgBottom[1] + (bgTop[1] - bgBottom[1]) * v, 0, 1) * 255,
    );
    const b = Math.round(
      clamp(bgBottom[2] + (bgTop[2] - bgBottom[2]) * v, 0, 1) * 255,
    );
    for (let px = 0; px < width; px++) {
      const o = (py * width + px) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Smallest march slice worth its dispatch overhead. */
export const SURFACE_COMPUTE_MARCH_CHUNK_MIN = 4096;

/** Conservative pre-measurement guess of march cost per ray·step (µs) —
 * sizes the very first slice of a frame; the measured EMA takes over from
 * the second slice on. ~8.7µs/ray·step measured far-field on Iris. */
export const SURFACE_COMPUTE_INITIAL_RAY_STEP_US = 10;

/**
 * March slice sizing: how many rays one dispatch may advance by `steps`
 * DE steps to land near the pass target, from the measured per-ray·step
 * EMA. This is what keeps a FULL-RESOLUTION settle's submissions bounded
 * — a 921k-ray raster at ~9µs/ray·step would otherwise hand the driver
 * an ~8s pass (the same watchdog class the shade split fixed). Pure so
 * the bound is unit-tested.
 */
export function marchChunkFor(emaUsPerRayStep: number, steps: number): number {
  const budgetUs = SURFACE_COMPUTE_PASS_TARGET_MS * 1000;
  const rays = Math.floor(
    budgetUs / Math.max(1e-3, emaUsPerRayStep * Math.max(1, steps)),
  );
  return Math.max(SURFACE_COMPUTE_MARCH_CHUNK_MIN, rays);
}

/** HIT shade batch ceiling — plenty to swallow a cheap-probe frame's hits
 * in one bounded dispatch once the measured cost allows it. Hit-only since
 * fr-257o: the FREE queue has no cost model to cap (see the free-batch
 * comment in `runFrame`), and one constant standing for both queues is
 * what let a MEAN over them be read as a finding. */
export const SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH = 4096;

/** First hit-batch CAPACITY of a frame — deliberately minimal: even at the
 * worst per-hit cost measured on Iris (~250 ms full-width probes at a
 * near-surface silhouette), one workgroup's worth of hits stays well under
 * the ~7.5 s i915 watchdog while the frame's first measurements come in
 * (the wall doesn't scale with batch size inside a workgroup — see
 * {@link shadeHitBatchSize}). Floored at
 * {@link SURFACE_COMPUTE_WORKGROUP_SIZE} rather than lower (fr-d6g5):
 * starting below one workgroup couldn't reduce per-submission wall either,
 * and it only kept the first hit batches measuring in the degenerate
 * regime that fed the old floor's trapdoor.
 *
 * THIS IS ALSO THE WHOLE COST PRIOR since fr-2ojg. A frame opens with an
 * EMPTY cost model ({@link ShadeHitCost} zeroed) rather than a pessimistic
 * per-hit guess, because a prior on top of this cap could only make the
 * first batches smaller than one workgroup — which the floor forbids
 * anyway — while costing the frame a long climb back out of it (the old
 * 20 ms/hit prior decayed at 0.4 per dispatch and held ~7 dispatches at
 * the floor before the measurements it was guarding against could speak).
 * The cap ladder is the first-encounter bound; the model is the sizer. */
export const SURFACE_COMPUTE_SHADE_HIT_CAP_START =
  SURFACE_COMPUTE_WORKGROUP_SIZE;

/** Hard ceiling (ms) on the PREDICTED TOTAL cost of one hit dispatch —
 * where {@link shadeHitAllowanceUs}'s latency-bound allowance stops
 * buying hits. 3.75x under the ~7.5 s i915 preemption watchdog, and the
 * frame presents and re-checks its wall budget between dispatches, so
 * being generous here costs at most one dispatch of added cancel latency
 * on a pose about to be abandoned.
 *
 * IT SITS AT 2 s AND NOT 1 s FOR A MEASURED REASON. A ceiling on the
 * total necessarily squeezes the allowance to nothing as the intercept
 * approaches it — the intercept is measured, not chosen, so the only
 * lever left is refusing to put hits in a dispatch that is going to cost
 * that much anyway, which is fr-d6g5's trapdoor rebuilt inside its own
 * replacement. That squeeze has to sit OUTSIDE the range real scenes
 * measure in, and mandelboxKifs — the hardest scene this project has —
 * measures its intercept between 430 and 960 ms. At 1 s the squeeze bit
 * that scene directly (its allowance fell to 38 ms and the sizer floored
 * at one workgroup while a 500-hit batch would have cost 4% more); at
 * 2 s it does not bite until a dispatch's FIXED cost alone is a
 * watchdog conversation, where declining to add work is the right
 * answer rather than a trapdoor. */
export const SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS = 2000;

/**
 * How much MARGINAL work one hit dispatch may carry per unit of the fixed
 * cost it is going to pay anyway — the middle term of
 * {@link shadeHitAllowanceUs}, and the dial that sets the hit batch width
 * on every scene whose fixed cost is worth more than an eighth of the pass
 * target.
 *
 * READ IT AS A WIDTH, NOT AS AN EFFICIENCY, because that is what it is.
 * {@link nextShadeHitCost} preserves `interceptUs = PIVOT · marginalUs`
 * wherever its clamps do not bind — see the proof in that function's doc
 * — so in this branch `allowance / marginal` is `this constant × PIVOT`
 * and nothing about the scene survives into the answer. At 1, which is
 * what fr-2ojg shipped, that is 512 hits on every scene in the project;
 * at 7 it is 3584. Read as an UPPER BOUND: the marginal's decay floor
 * takes the ratio below the pivot whenever a dispatch measures under half
 * its prediction, which a queue-limited sliver reaches routinely, and the
 * width then lands under it — the shipped kaleido4 settle reports 3583 at
 * its widest and a 2464 mean. That is the same non-answer about the scene
 * from a different arbitrary number, and it errs narrow.
 *
 * SEVEN, MEASURED (fr-fniy, real Iris Xe / Mesa 25.2.8, kaleido4 — two
 * maps at kaleidoscope order 6 — 1024x640, production build, identity
 * rotor, one fresh session per cell, hit batch FORCED via
 * `?surfaceshadehits=N` so the width is independent of the model under
 * test). One settle frame shades the same ~32.3k hits at every width, so
 * ms/frame is the comparison:
 *
 *     width      64     256     512    1024    3690   10764
 *     ms/disp   287     313     321     336     395     947
 *     ms/frame  144594  39661   20503   10756   3452    2841
 *     settle    —       —       180.1s  100.1s  40.2s   35.0s
 *
 * A 168x width buys 3.3x the dispatch: the fit over all six widths is
 * `283.1 ms + 64.8 µs/hit`, so at the shipped 512 NINETY PER CENT of every
 * hit dispatch was fixed cost. 7 lands the width at 3584, which is where
 * that curve stops paying — 3690 measured 40.2 s against 10764's 35.0 s,
 * a further 13% for 2.4x the worst dispatch (441.7 ms against 1371.1 ms).
 * AND THE WORST DISPATCH DOES NOT GROW at 7: 441.7 ms against the shipped
 * width's own 397.3 ms, on a scene whose settle fell 4.5x, which is the
 * watchdog question a mean cannot answer.
 *
 * WHAT THE FIXED COST IS, since it is 283 ms rather than a submission's
 * ~1.15 ms: a hit dispatch's wall is its DEEPEST ray's shading chain —
 * ~40 zero-cutoff on-surface DE evals in series — and at kaleidoscope
 * order 6 one such eval is a deep sector-swept beam descent. Lanes run in
 * parallel across EUs, so until the batch is wide enough to fill the
 * machine that chain IS the dispatch. 512 hits is 8 workgroups on a 96-EU
 * part; it does not come close.
 *
 * WHY NOT WIDER STILL, and the answer has TWO halves. The
 * {@link SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS} term already aims a
 * genuinely expensive scene at the ceiling, and this term must not turn a
 * dispatch into a watchdog conversation on a scene nobody has measured.
 * The other half is that `7 · PIVOT` = 3584 is within 14% of
 * {@link SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH} = 4096: at 8, or at any
 * pivot above 585, the CAP becomes the binding constraint instead and
 * these two dials stop meaning what their comments say. Raising either
 * past that is the cap's separate safety argument, with its own
 * measurements. 8·intercept is the predicted total here, so the
 * ceiling still binds first wherever the fixed cost alone exceeds 250 ms —
 * and `mandelboxKifs`, the hardest scene in the project, sits exactly on
 * that boundary. Its own measurement (800x520, a 150 s fixed window, since
 * it does not settle): 387.3 -> 1299.9 hits/s, 3.36x, at a worst dispatch
 * of 2056.5 ms against the old width's 1744.5 — the ceiling's number
 * rather than this constant's, 2.8% over its predicted 2000 ms and 3.6x
 * under the ~7.5 s i915 watchdog.
 */
export const SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST = 7;

/** How far the per-hit MARGINAL estimate may fall on one measurement — a
 * halving, matching the capacity ladder's own doubling rate.
 *
 * The model's optimism needs a rate limit for the same reason its width
 * does. `nextShadeHitCost` clamps the marginal at zero, and zero means
 * FREE: the sizer then asks for the whole capacity on the strength of one
 * cheap dispatch. That is reachable — a wide batch of ground-plane
 * terminals (fr-rhn5 queues them WITH the hits, and they shade
 * analytically) landing on a model converged to expensive fold hits reads
 * as exactly that surprise — and it is fr-p8bc's "a cheap run inflates
 * the capacity a hit band then pays" re-opened one level up, in the cost
 * model rather than in the queue. Halving bounds the next batch at twice
 * the last, which is the rate the capacity ladder already enforces, and
 * it costs nothing measured: the marginal's per-dispatch moves during a
 * real convergence are a few percent (169.9 -> 159.9 µs over the whole
 * boxfold-pair climb). */
export const SURFACE_COMPUTE_SHADE_MARGINAL_DECAY = 0.5;

/** Batch width at which one hit-dispatch measurement is half about the
 * per-dispatch INTERCEPT and half about the per-hit MARGINAL cost — the
 * attribution pivot in {@link nextShadeHitCost}. 512 = eight workgroups,
 * which is where fr-2ojg measured the cost-vs-width curve still flat on
 * Iris Xe (87.2 -> 136.2 ms per dispatch while hits per dispatch rose
 * ~11x): below it a measurement is nearly all fixed cost, above it the
 * marginal term is what moved.
 *
 * IT IS ALSO THE UNIT THE HIT BATCH WIDTH IS COUNTED IN, which is not
 * what the paragraph above would lead anyone to expect and is worth
 * knowing before touching it: {@link nextShadeHitCost} preserves
 * `intercept = this · marginal` wherever its clamps do not bind (proof
 * there), so {@link shadeHitAllowanceUs}'s middle term hands
 * {@link shadeHitBatchSize} up to
 * `SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST` times THIS number of hits.
 * Moving the pivot moves the shipped batch width by the same factor — a
 * second dial on the same quantity, and the one whose doc comment does
 * not say so — until 585, past which
 * {@link SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH} binds instead and moving it
 * does nothing. Change the other one. */
export const SURFACE_COMPUTE_SHADE_COST_PIVOT = 512;

/**
 * The hit-shade cost model (fr-2ojg): `cost(n) = intercept + n·marginal`,
 * in µs, for a dispatch of `n` HIT rays.
 *
 * The two terms are physically different things and conflating them is
 * the defect this type exists to name. `interceptUs` is what a dispatch
 * costs before any width — the batch's DEEPEST ray, since lanes run in
 * parallel across EUs, so a 16-hit batch and a 512-hit batch of the same
 * scanline band cost about the same. `marginalUs` is what each extra hit
 * adds once past that. fr-2ojg measured the intercept at ~88 ms and the
 * marginal at ~0.15 ms/hit on the boxfold pair: dividing a whole
 * submission's time by its ray count called that 5.2 ms PER HIT at n=16,
 * the sizer divided the pass target by the inflated number, picked
 * another small batch, and re-measured the same inflation — fr-d6g5's
 * trapdoor at every width below the occupancy knee rather than only at
 * n=1.
 */
export interface ShadeHitCost {
  /** Fixed per-dispatch cost (µs), independent of batch width. */
  interceptUs: number;
  /** Added cost (µs) per hit beyond the intercept. */
  marginalUs: number;
}

/** A frame opens knowing nothing: both terms zero, so
 * {@link shadeHitBatchSize} asks for everything and
 * {@link SURFACE_COMPUTE_SHADE_HIT_CAP_START} hands it one workgroup.
 * See that constant for why there is no pessimistic prior any more. */
export function initialShadeHitCost(): ShadeHitCost {
  return { interceptUs: 0, marginalUs: 0 };
}

/**
 * GPU time (µs) one hit dispatch may spend on MARGINAL work — hits — on
 * top of the intercept it is going to pay whatever its width.
 *
 * `max(pass target − intercept, K · intercept)`, and never more than
 * {@link SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS} leaves. Below the
 * knee that is the room left inside the pass target (a ~25 ms intercept
 * leaves ~225 ms of hits to buy). Above it, it is the whole point of
 * fr-2ojg — spend on hits in proportion to the fixed cost already being
 * spent: a dispatch whose intercept alone is 400 ms cannot be made
 * cheaper by shrinking it, so refusing to widen it past the pass target
 * buys no safety and costs an order of throughput (64 hits for 432 ms
 * against 800 hits for 800 ms — the same work ~12x faster).
 *
 * K IS {@link SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST} AND IT IS A
 * WIDTH, not a ratio the scene has any say in — see that constant for the
 * identity that makes it one, and for the measured table that picked 7.
 * fr-2ojg shipped 1, which held every scene in the project at 512 hits
 * per dispatch and, on the one measured here, made 90% of every hit
 * dispatch fixed cost.
 *
 * THE CEILING TERM IS THE ONE PLACE THIS CAN STILL SHRINK, and where it
 * sits is the whole of its safety argument — see that constant. It now
 * binds from a fixed cost of 250 ms up rather than 1 s, so the scenes
 * whose dispatches are genuinely expensive are aimed at the ceiling
 * itself, which is the widest thing that was ever safe to ask for.
 */
export function shadeHitAllowanceUs(interceptUs: number): number {
  return Math.max(
    0,
    Math.min(
      SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS * 1000 - interceptUs,
      Math.max(
        SURFACE_COMPUTE_PASS_TARGET_MS * 1000 - interceptUs,
        SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST * interceptUs,
      ),
    ),
  );
}

/** What a hit dispatch sized against {@link shadeHitAllowanceUs} is
 * predicted to cost in total (µs) — the number the capacity ladder judges
 * the measurement against, since a threshold has to be the number the
 * sizer aimed at. */
export function shadeHitBudgetUs(interceptUs: number): number {
  return interceptUs + shadeHitAllowanceUs(interceptUs);
}

/**
 * Adaptive hit-batch CAPACITY: grow while hit batches come in under the
 * budget they were sized for, QUARTER on a big overshoot. This is the
 * slow-trust bound layered over {@link shadeHitBatchSize}'s cost
 * prediction: a width the model has never priced can only be reached by
 * doubling through widths it has, so the climb out of an EMPTY model
 * cannot jump straight to the ceiling. The floor is one workgroup, never
 * lower (fr-d6g5) — see {@link shadeHitBatchSize} for why a
 * sub-workgroup capacity buys no submission-wall safety.
 *
 * WHAT IT DOES NOT BOUND, said plainly because an earlier draft of this
 * comment claimed it did: once the model is calibrated it sizes at or
 * under the budget by construction, so this capacity grows on nearly
 * every dispatch, saturates at
 * {@link SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH}, and thereafter binds
 * nothing — the width is the MODEL's answer, not the ladder's. That is
 * the intended division (the model sizes, the ladder paces the climb),
 * and it means a cost STEP inside a calibrated frame is bounded by the
 * model's own spike response, which is reactive, plus
 * {@link SURFACE_COMPUTE_SHADE_MARGINAL_DECAY} bounding how fast the
 * model may become optimistic in the first place.
 *
 * `budgetMs` is {@link shadeHitBudgetUs}'s answer for the batch being
 * judged, NOT the fixed pass target: the growth threshold has to be the
 * same number the sizer aimed at, or the ladder freezes exactly where the
 * sizer wants to go. (It was `PASS_TARGET / 2`, which pinned the capacity
 * at whatever width cost 125 ms — ~256 hits on the fr-2ojg scene, against
 * a measured optimum of ~1050.) Pure so the safety bias is unit-tested.
 */
export function nextShadeBatchSize(
  current: number,
  lastBatchMs: number,
  budgetMs: number,
): number {
  if (lastBatchMs < budgetMs && current < SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH) {
    return Math.min(current * 2, SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH);
  }
  if (lastBatchMs > budgetMs * 2) {
    return Math.max(SURFACE_COMPUTE_WORKGROUP_SIZE, Math.floor(current / 4));
  }
  return current;
}

/**
 * Predictive hit-batch sizing (fr-p8bc, corrected by fr-2ojg): as many
 * hits as the measured MARGINAL cost says fit the dispatch budget once
 * the intercept is paid, clamped by the slow-trust capacity cap and
 * floored at one WORKGROUP rather than one hit (fr-d6g5).
 *
 * Sub-workgroup batches buy zero watchdog safety: GPU cost inside a
 * single workgroup ({@link SURFACE_COMPUTE_WORKGROUP_SIZE} threads) is
 * depth-dominated, not width-dominated — a dispatch of 64 independent
 * rays costs about as much wall time as a dispatch of 1, since lanes run
 * in parallel across EUs — so shrinking below one workgroup only
 * multiplies the number of worst-ray-cost submissions without shrinking
 * any single one of them. fr-2ojg's measurement is that the same
 * argument holds to at least EIGHT workgroups, which is why the divisor
 * here is the marginal cost and not a whole submission's time over its
 * ray count: the old form charged the intercept to every hit, so the
 * predicted width fell as the batch narrowed and the sizer walked itself
 * down to the floor. Pure so the prediction is unit-tested.
 */
export function shadeHitBatchSize(cost: ShadeHitCost, cap: number): number {
  const byCost = Math.floor(
    shadeHitAllowanceUs(cost.interceptUs) / Math.max(1, cost.marginalUs),
  );
  return Math.max(SURFACE_COMPUTE_WORKGROUP_SIZE, Math.min(cap, byCost));
}

/**
 * Fold one measured hit dispatch into the cost model (fr-2ojg).
 *
 * One observation, two unknowns — so the surprise (measured minus
 * predicted) is SPLIT by how much this width can speak about each term:
 * `w = n / (n + PIVOT)` of it to the marginal, the rest to the intercept.
 * A one-workgroup batch is nearly all fixed cost and moves the intercept;
 * a wide one moves the marginal. Both clamp at zero, and the split is
 * exact-fitting — after the update the model reproduces the measurement
 * at that width — so nothing is double counted in either direction.
 *
 * THE SPIKE RESPONSE SURVIVES the change of shape, which is the safety
 * property the old asymmetric EMA existed for: an expensive band lands as
 * a large positive surprise, most of it at a wide `n` (so most of it in
 * the marginal), and the next batch collapses to the floor in ONE step —
 * measured in the fr-2ojg simulation at a 19x marginal lift and a 16x
 * batch cut from a single 30x-cost dispatch. What does NOT survive is the
 * old slow decay, and deliberately: re-earning a cheap region took ~10
 * dispatches of a frame that only had ~17, so a settle spent most of its
 * hit budget climbing out of readings that were never per-hit costs.
 *
 * THE QUEUE-LIMITED BATCH is the case that most needs the split. A sweep
 * that yields fewer hits than the sizer asked for dispatches a narrow
 * batch whose whole-submission time is dominated by the intercept; the
 * old form read that as an expensive per-hit region and shrank. Here the
 * pivot hands it to the intercept and the next full-width batch is
 * essentially unmoved. Pure so both the split and the clamps are
 * unit-tested.
 *
 * WHAT THE SPLIT CANNOT DO, and fr-fniy had to prove before it could
 * believe it: IT NEVER IDENTIFIES THE TWO TERMS. Unclamped, this function
 * preserves `interceptUs = PIVOT · marginalUs` IDENTICALLY. From a zeroed
 * model, one update at width n gives `I = (1−w)C` and `m = wC/n`, so
 * `I/m = n(1−w)/w = n·(P/(n+P))·((n+P)/n) = P`; and if `I = P·m` already,
 * then `I' / m' = (I + Ps/(n+P)) / (m + s/(n+P)) = P` for ANY surprise s
 * and any width n. Two parameters, one measurement, an exact fit — so the
 * RATIO is set by the attribution weight alone and the data only ever
 * moves the scale.
 *
 * THE CLAMPS BREAK IT, AND ONE OF THEM IS REACHABLE IN ORDINARY
 * OPERATION — said here because a first draft of this comment claimed the
 * identity held "whatever the measurements say", which is false and would
 * mislead exactly the reader it is written for. The marginal's decay floor
 * binds when `m + w·s/n < m·DECAY`, i.e. exactly when a dispatch measures
 * under HALF what the model predicted; the ratio then becomes
 * `2·P·(measured/predicted)`, which is BELOW P for any measurement that
 * triggered it. The intercept's own `max(0, …)` is unreachable from an
 * on-invariant state (it needs a negative measurement) but becomes
 * reachable once the ratio has already fallen.
 *
 * The trigger is the queue-limited batch two paragraphs up, which is
 * normal operation rather than a corner: a sliver of hits lands most of a
 * large positive surprise on the INTERCEPT (small n, small w), and the
 * next full-width batch then measures a fraction of that inflated
 * prediction and trips the floor. MEASURED shape, replaying the shipped
 * sizer against fr-fniy's own kaleido4 curve with its own drain pattern:
 * the ratio leaves P after one such pair and settles around 250-310, and
 * the width the sizer asks for lands in 1764-3584 rather than pinned at
 * `K·P`.
 *
 * SO `K · PIVOT` IS AN UPPER BOUND ON THE WIDTH, NOT A CONSTANT, and the
 * direction of the error is conservative. None of it makes the width any
 * more the SCENE's: `2·P·(measured/predicted)` is as much an artifact of
 * the attribution weight and the decay floor as `P` is. The conclusion is
 * unchanged and if anything stronger — no sizing rule here may be written
 * in terms of `interceptUs` alone.
 *
 * That is not a defect in the model, which predicts the cost at the width
 * it was measured at exactly and predicts a doubling within a factor of
 * two. It is a defect in any SIZING rule written in terms of `intercept`
 * alone: {@link shadeHitAllowanceUs}'s middle term divides an allowance
 * proportional to `I` by `m`, so it returns a constant number of hits and
 * the width it names is the CONSTANT's, not the scene's. fr-2ojg read
 * that branch as "spend as much again on hits as the fixed cost", which
 * is true of the model and says nothing about the machine; fr-fniy
 * measured the machine and found the resulting 512 hits leaving 90% of
 * every dispatch on fixed cost, four and a half times slower than the
 * same frame at 3690. So the constant is now chosen as a width and
 * measured as one.
 *
 * THE REMEDY IS NOT MORE PARAMETERS. Identifying `I` and `m` separately
 * needs two measurements at widths far enough apart to be a lever —
 * exactly the discipline this file's own record demands of a fit ("over a
 * WIDE lever or not at all") — and the sizer visits one width at a time
 * by design. `?surfaceshadehits=N` (see
 * {@link setSurfaceComputeSchedulePins}) is the lever, run offline.
 */
export function nextShadeHitCost(
  cost: ShadeHitCost,
  hits: number,
  measuredUs: number,
): ShadeHitCost {
  const n = Math.max(1, hits);
  const surpriseUs = measuredUs - (cost.interceptUs + n * cost.marginalUs);
  const w = n / (n + SURFACE_COMPUTE_SHADE_COST_PIVOT);
  return {
    interceptUs: Math.max(0, cost.interceptUs + (1 - w) * surpriseUs),
    marginalUs: Math.max(
      0,
      // The rate limit on optimism — see
      // SURFACE_COMPUTE_SHADE_MARGINAL_DECAY. Nothing else stops one
      // cheap dispatch from clamping the marginal to zero, which the
      // sizer reads as "hits are free" and answers with the whole
      // capacity.
      cost.marginalUs * SURFACE_COMPUTE_SHADE_MARGINAL_DECAY,
      cost.marginalUs + (w * surpriseUs) / n,
    ),
  };
}

/** Everything the hit-shade sizer learns during a frame, in one mutable
 * carrier so a supersampling job can hand it to the next pass (fr-2ojg).
 * See the `sizer` declaration in `runFrame` for why that carry is sound
 * for passes of one job and for nothing else. */
interface ShadeSizerState {
  cost: ShadeHitCost;
  cap: number;
}

/** The bench host loop's adaptive pass sizing: double while the last pass
 * came in under target, capped. Pure so the pacing is unit-tested. */
export function nextStepsPerPass(current: number, lastPassMs: number): number {
  if (
    lastPassMs < SURFACE_COMPUTE_PASS_TARGET_MS &&
    current < SURFACE_COMPUTE_MAX_STEPS_PER_PASS
  ) {
    return Math.min(current * 2, SURFACE_COMPUTE_MAX_STEPS_PER_PASS);
  }
  return current;
}

/**
 * Nearest-neighbor resample of the previous frame's pixels into a new
 * raster — the compute path's analogue of the strip settle's
 * preview-seeded target (scene.ts beginSurfaceSettle): unresolved rays
 * show the last known image instead of bare backdrop, so a settle's
 * progressive presents never look WORSE than the preview they follow.
 * Pure so the row mapping (row 0 = bottom on both sides) is unit-tested.
 */
export function resampleSurfacePixels(
  src: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(width * height * 4);
  for (let py = 0; py < height; py++) {
    const sy = Math.min(
      srcHeight - 1,
      Math.floor(((py + 0.5) / height) * srcHeight),
    );
    for (let px = 0; px < width; px++) {
      const sx = Math.min(
        srcWidth - 1,
        Math.floor(((px + 0.5) / width) * srcWidth),
      );
      const s = (sy * srcWidth + sx) * 4;
      const o = (py * width + px) * 4;
      out[o] = src[s];
      out[o + 1] = src[s + 1];
      out[o + 2] = src[s + 2];
      out[o + 3] = src[s + 3];
    }
  }
  return out;
}

/** Bytes the WIDEST per-ray buffer costs (the `vec4f` ray state) — the one
 * a device's buffer/binding ceilings bite first. It has no staging twin
 * since fr-si66: nothing reads it back. */
export const SURFACE_COMPUTE_RAY_STATE_BYTES = 16;

/** Bytes of GPU buffer ONE ray costs a frame, across all six per-ray
 * buffers: states 16 + active 4 + color 4 + stagingColor 4 + status 4 +
 * stagingStatus 4. Was 44 before fr-si66 traded the 16 B/ray states
 * staging twin for a 4 B/ray status side-channel and its own twin. */
export const SURFACE_COMPUTE_RAY_BYTES = 36;

/** Byte count as MiB, for the size errors' messages. */
function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Rays ONE dispatch may cover on a device with these limits (fr-257o).
 * Every dispatch this module issues is one-dimensional —
 * `ceil(count / SURFACE_COMPUTE_WORKGROUP_SIZE)` workgroups along x — so
 * `maxComputeWorkgroupsPerDimension` IS a ray count once multiplied
 * through, and the device is requested without raising that limit (only
 * the two storage ones), which pins it at WebGPU's spec minimum 65535 on
 * every adapter: 4,194,240 rays.
 *
 * BOTH SIZING PATHS CLAMP AT IT, and neither did before. A free shade
 * batch asks for its whole queue by design. A march slice is
 * `min(cost-EMA prediction, active list)`, and the EMA is MEASURED, so a
 * cheap far-field frame drives the prediction above the active list and
 * the whole list goes out as one dispatch. Either is only a problem on a
 * raster bigger than this ceiling — and {@link surfaceComputeMaxFrameRays}
 * of a spec-minimum 128 MiB storage binding is 8.4M rays, twice it, which
 * a hidpi 1440p pane sits inside. WebGPU answers an over-limit
 * `dispatchWorkgroups` with a validation error that invalidates the
 * encoder, so the submission silently does NOTHING and those rays keep
 * whatever their pixels were seeded with: a wrong image, not a crash,
 * which is why it has never been reported. Pure so the arithmetic is
 * unit-tested.
 */
export function surfaceComputeMaxDispatchRays(limits: {
  maxComputeWorkgroupsPerDimension: number;
}): number {
  return Math.max(
    SURFACE_COMPUTE_WORKGROUP_SIZE,
    Math.floor(limits.maxComputeWorkgroupsPerDimension) *
      SURFACE_COMPUTE_WORKGROUP_SIZE,
  );
}

/**
 * The largest raster ONE frame may allocate for on a device with these
 * limits, in rays (fr-biox). `states` is both the widest per-ray buffer
 * and a bound STORAGE buffer, so it meets whichever ceiling is lower —
 * and it is the binding ceiling that decides, which is why fr-si66's
 * cheaper readback (one 4 B/ray status buffer in place of the 16 B/ray
 * staging twin) cuts a frame's total commitment without moving this
 * bound. Pure so the arithmetic behind a refusal is unit-tested.
 *
 * DELIBERATELY NOT MET AGAINST {@link surfaceComputeMaxDispatchRays}
 * (fr-257o), even though that one is the lower of the two on a
 * spec-minimum device: a frame's rays are a MEMORY question and a
 * dispatch's are a SUBMISSION-SHAPE one, and folding the smaller in here
 * would make a 4K pane (8.3M rays, inside a spec-minimum 128 MiB binding)
 * fit one rung softer for a ceiling no single piece of work has to meet.
 * Every dispatch this loop issues is sized at its own site, and clamps
 * there.
 */
export function surfaceComputeMaxFrameRays(limits: {
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
}): number {
  const widest = Math.min(
    limits.maxBufferSize,
    limits.maxStorageBufferBindingSize,
  );
  return Math.max(1, Math.floor(widest / SURFACE_COMPUTE_RAY_STATE_BYTES));
}

/**
 * Rays one CAPTURE tile may cost, however much the device would allow
 * (fr-biox). A frame's buffers are 36 B/ray and its host mirrors another
 * ~24 B/ray, so an untiled 4x export of a 1920x1057 pane (32.5M rays)
 * commits ~1.2 GB of GPU memory and reads back up to 130 MB of ray status
 * per march sweep (a flat 520 MB of ray STATE before fr-si66) — a device
 * that reports gigabytes of `maxBufferSize` will still refuse or thrash.
 * At this cap a tile is ~144 MB of buffers,
 * comfortably above the live rasters the same code paths run all session
 * (a 1920x1057 pane is 2.0M rays), so tiling costs an export nothing it
 * was not already paying per frame.
 */
export const SURFACE_COMPUTE_MAX_TILE_RAYS = 4_000_000;

/**
 * Rows per capture tile: as tall a band as {@link
 * SURFACE_COMPUTE_MAX_TILE_RAYS} and the device's own ceiling allow,
 * BALANCED across the tiles it takes (so the last band is never a
 * one-row remainder, and the export modal's per-tile progress advances
 * evenly). Full-width bands on purpose — rows are the raster's own
 * contiguous unit, so a tile's pixels land in the assembled image with
 * one `set`. Floored at ONE row, which no real device can refuse: an
 * export row is at most EXPORT_MAX_LONG_SIDE rays (~131 KB of ray
 * state) against a `maxStorageBufferBindingSize` whose SPEC MINIMUM is
 * 128 MiB. Pure so the bound is unit-tested.
 */
export function surfaceComputeTileRows(
  width: number,
  height: number,
  maxFrameRays: number,
): number {
  const cap = Math.max(
    1,
    Math.min(maxFrameRays, SURFACE_COMPUTE_MAX_TILE_RAYS),
  );
  const perTile = Math.max(1, Math.floor(cap / Math.max(1, width)));
  if (perTile >= height) return height;
  return Math.ceil(height / Math.ceil(height / perTile));
}

/**
 * The two gradient stops a horizontal BAND of a taller image carries
 * (fr-biox). Every tracer paints its backdrop — and fogs toward it — as
 * `mix(bgBottom, bgTop, (py + 0.5) / rasterHeight)` over its OWN raster,
 * so handing a band the whole image's stops would repeat the full
 * gradient in every tile and band the assembled export. Restricting the
 * stops to the band's own endpoints reproduces the full-image gradient
 * exactly: the pixel-center parameter maps affinely from band to image
 * (`v = bandBottom/fullHeight + u · bandHeight/fullHeight`), so matching
 * the endpoints matches every pixel between them. Pure so that identity
 * is unit-tested.
 */
export function surfaceComputeBandStops(
  bgTop: RgbStop,
  bgBottom: RgbStop,
  bandBottom: number,
  bandHeight: number,
  fullHeight: number,
): { bgTop: Vec3; bgBottom: Vec3 } {
  const at = (row: number): Vec3 => {
    const v = clamp(row / Math.max(1, fullHeight), 0, 1);
    return [
      bgBottom[0] + (bgTop[0] - bgBottom[0]) * v,
      bgBottom[1] + (bgTop[1] - bgBottom[1]) * v,
      bgBottom[2] + (bgTop[2] - bgBottom[2]) * v,
    ];
  };
  return { bgBottom: at(bandBottom), bgTop: at(bandBottom + bandHeight) };
}

/**
 * Shrink a raster to fit a device's own frame ceiling, keeping its aspect
 * (fr-biox). The live pane cannot tile the way a capture can — one frame
 * IS the image — so an enormous drawing buffer (a hidpi 5K desktop) that
 * would overrun {@link surfaceComputeMaxFrameRays} traces slightly soft
 * and blits up, the preview tier's own mechanism, instead of failing to
 * allocate. Pure so the fit is unit-tested.
 */
export function fitSurfaceComputeRaster(
  width: number,
  height: number,
  maxFrameRays: number,
): { width: number; height: number } {
  if (width * height <= maxFrameRays) return { width, height };
  const s = Math.sqrt(maxFrameRays / (width * height));
  let w = Math.max(1, Math.floor(width * s));
  let h = Math.max(1, Math.floor(height * s));
  if (w * h > maxFrameRays) {
    // Only reachable for a ceiling below one row or column of the raster
    // — no real device — but the fit has to hold there too.
    w = Math.max(1, Math.min(w, Math.floor(maxFrameRays / h)));
    h = Math.max(1, Math.min(h, Math.floor(maxFrameRays / w)));
  }
  return { width: w, height: h };
}

/**
 * Ray-work `done` tally for a settle's progress report (fr-tdft).
 *
 * A ray's unit of progress splits half march, half shade: the march half
 * accrues CONTINUOUSLY as the ray consumes its step budget, lands in
 * full on going terminal, and the shade half lands when the pixel is
 * shaded. Counting only shaded rays displayed a heavy frame's whole
 * first march sweep as 0% for a minute of honest work, then read the
 * cheap miss-drain as a sprint; crediting only TERMINAL rays (the first
 * fr-tdft fix) still parked a fully in-sphere pose at a low pct through
 * its long first sweep — no ray terminates until deep into the step
 * budget, so the sweep's real work stayed invisible. Sub-ray credit is
 * exact host-side bookkeeping, no extra readback: the kernel's march
 * loop breaks only on terminal transitions, so a still-ACTIVE ray has
 * consumed exactly the steps the host issued to it (`sweepSteps`, plus
 * `stepsThisPass` for the `sliced` rays the current sweep has already
 * dispatched), never more than `marchSteps` by the exhaustion rule.
 *
 * Monotone by construction: step fractions only grow (capped at 1, and
 * a marching ray's credit never exceeds the terminal half), `active`
 * only shrinks, queues only move rays toward shaded; exactly `rays` at
 * frame completion.
 */
export function surfaceComputeProgressDone(tally: {
  /** Frame ray total. */
  rays: number;
  /** Rays still on the active list. Mid-sweep this includes rays whose
   * terminal status hasn't been read back yet — they credit as marching,
   * an undercount that resolves upward at the sweep's end. */
  active: number;
  /** Terminal rays queued for a shade batch, hits and misses alike. */
  shadeQueued: number;
  /** March steps every active ray received from COMPLETED sweeps. */
  sweepSteps: number;
  /** Active rays the current sweep has already dispatched — they hold
   * `stepsThisPass` steps beyond `sweepSteps`. */
  sliced: number;
  /** Steps the current sweep issues per dispatched ray. */
  stepsThisPass: number;
  /** Per-ray march budget (`spec.marchSteps`). */
  marchSteps: number;
}): number {
  const budget = Math.max(1, tally.marchSteps);
  const before = Math.min(1, tally.sweepSteps / budget);
  const after = Math.min(1, (tally.sweepSteps + tally.stepsThisPass) / budget);
  const marching =
    0.5 * (tally.sliced * after + (tally.active - tally.sliced) * before);
  return tally.rays - tally.active - 0.5 * tally.shadeQueued + marching;
}

const WHITE_LUT = new Uint8Array(256 * 4).fill(255);

/**
 * Everything {@link SurfaceComputeRenderer}'s constructor needs, built up by
 * the (long) {@link SurfaceComputeRenderer.buildOnDevice} driver. The same
 * shape `GpuFlameBackendInit` takes one module over, and for the same two
 * reasons: there are enough GPU resources here that positional arguments
 * would be unreadable, and a NAMED init object is an injection point —
 * `surface-compute.test.ts` drives this renderer's deferred-teardown state
 * machine (fr-uec4) over a fake device through it, which a private
 * constructor behind an adapter-acquiring `create()` offered no way to
 * reach. Production code still arrives through {@link
 * SurfaceComputeRenderer.create}, never by naming this type.
 */
export interface SurfaceComputeRendererInit {
  device: GPUDevice;
  /** Frozen at enter — a system edit re-enters the session rather than
   * retargeting a live renderer (see {@link SurfaceComputeRenderer.create}). */
  target: SurfaceComputeTarget;
  marchPipeline: GPUComputePipeline;
  marchLayout: GPUBindGroupLayout;
  shadePipeline: GPUComputePipeline;
  shadeLayout: GPUBindGroupLayout;
  /** ifs4 only (fr-d0nn): the slab-free kernel pair every sliceHalfW=0
   * frame rides — null for every other target kind. */
  marchPipelineNoSlab: GPUComputePipeline | null;
  shadePipelineNoSlab: GPUComputePipeline | null;
  paramsBuf: GPUBuffer;
  shadeBuf: GPUBuffer;
  mapsBuf: GPUBuffer;
  shadeMapsBuf: GPUBuffer;
  lutTex: GPUTexture;
  lutSamp: GPUSampler;
  /** Adapter label from create()'s requestAdapter (fr-tmgf) — surfaced in
   * the UI's backend disclosure; undefined when the adapter offered no
   * vendor/architecture. */
  adapterLabel?: string;
  /** True when the adapter is a software rasterizer (fallback flag or a
   * SwiftShader-class string tell — see render-backend.ts): the UI's cue to
   * warn rather than let a CPU-rasterized settle pass as the GPU. */
  software: boolean;
}

interface FrameBuffers {
  rays: number;
  states: GPUBuffer;
  active: GPUBuffer;
  color: GPUBuffer;
  /** fr-si66's march status side-channel: one `u32` per ACTIVE-LIST SLOT,
   * written by every march dispatch and read back once per sweep. */
  status: GPUBuffer;
  stagingStatus: GPUBuffer;
  stagingColor: GPUBuffer;
  marchBindGroup: GPUBindGroup;
  shadeBindGroup: GPUBindGroup;
}

export class SurfaceComputeRenderer {
  /** Cheap sync routing predicate — a context without `navigator.gpu`
   * never even attempts {@link create}. */
  static supported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.gpu;
  }

  private static adapterProbe: Promise<boolean> | null = null;

  /** Cached one-shot adapter probe (fr-khxy): whether `requestAdapter()`
   * actually yields an adapter in this context. {@link supported} alone
   * admits contexts that EXPOSE `navigator.gpu` with no working adapter
   * behind it — modern Firefox ships the object ahead of per-platform
   * support — and fold-4D routing has no fallback arm to absorb that
   * late surprise: entry was admitted, create() failed, and the mode
   * exited on a toast the user can miss ("no preview ever appears").
   * Boot fires this probe and latches the same one-way routing block a
   * failed create() would have set, so the eligibility gate refuses
   * fold-4D up front with the honest note instead. The probed adapter
   * is discarded — {@link create} requests its own; same
   * powerPreference so the two answers cannot diverge. */
  static probeAdapter(): Promise<boolean> {
    if (!SurfaceComputeRenderer.supported()) return Promise.resolve(false);
    return (SurfaceComputeRenderer.adapterProbe ??= navigator.gpu
      .requestAdapter({ powerPreference: "high-performance" })
      .then((adapter) => adapter !== null)
      .catch(() => false));
  }

  /**
   * Acquire a device and build the session pipeline for `target` (frozen
   * — a system edit re-enters the session, never retargets a live
   * renderer; an ifs4 target's rotor/slice view is per-frame SPEC state,
   * the one deliberately live input). `colors[j]`/`trapIndices[j]` shade
   * `de.maps[j]` for the IFS kinds (3D and 4D alike) — the same per-slot
   * inputs the GLSL packers take — and slot 0 alone for the escape kind
   * (one map, the GLSL `setEscapeSystem` shape). `opts.shadeDeWidth` overrides the shipped shade probe width
   * ({@link SURFACE_COMPUTE_SHADE_DE_WIDTH}) — the gpu-bench A/B knob,
   * never set by the app; inert for escape (its loop has no width).
   * Rejects with {@link SurfaceComputeUnavailableError} when WebGPU is
   * absent, or a plain error (compile/validation) the caller treats
   * identically: fall back to the WebGL tracer.
   */
  static async create(
    target: SurfaceComputeTarget,
    colors: Vec3[],
    trapIndices: number[],
    opts: { shadeDeWidth?: number } = {},
  ): Promise<SurfaceComputeRenderer> {
    if (!SurfaceComputeRenderer.supported()) {
      throw new SurfaceComputeUnavailableError(
        "Surface compute: WebGPU is not available (navigator.gpu is undefined)",
      );
    }
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) {
      throw new SurfaceComputeUnavailableError(
        "Surface compute: requestAdapter() returned null — no compatible GPU adapter",
      );
    }
    // Without requiredLimits the device silently defaults to WebGPU's
    // conservative spec minimums — the flame backend's fr-53k lesson. A
    // full-resolution settle's state buffer (16 bytes/ray) fits the 128MiB
    // default comfortably, but pass the adapter's real ceiling anyway so a
    // hi-res export never trips a limit the hardware doesn't have.
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    // fr-tmgf: capture the adapter's identity before the reference is
    // dropped — the renderer discloses label + software verdict to the UI
    // (the shared render-backend derivation, same as the flame worker's;
    // the older spec kept `isFallbackAdapter` on the adapter itself).
    const adapterStatus = webgpuAdapterStatus(
      adapter.info,
      (adapter as { isFallbackAdapter?: boolean }).isFallbackAdapter,
    );
    try {
      const renderer = await SurfaceComputeRenderer.buildOnDevice(
        device,
        target,
        colors,
        trapIndices,
        opts.shadeDeWidth ?? SURFACE_COMPUTE_SHADE_DE_WIDTH,
        adapterStatus,
      );
      return renderer;
    } catch (e) {
      // Partial resources die with the device — never leak a live
      // GPUDevice from a failed create (flame-gpu-backend's discipline).
      device.destroy();
      throw e;
    }
  }

  private static async buildOnDevice(
    device: GPUDevice,
    target: SurfaceComputeTarget,
    colors: Vec3[],
    trapIndices: number[],
    shadeDeWidth: number,
    adapterStatus: { label: string | undefined; software: boolean },
  ): Promise<SurfaceComputeRenderer> {
    // The error-scope pair (out-of-memory outside, validation inside):
    // WebGPU's createBuffer never throws on allocation failure — it
    // returns an invalid buffer whose failure would otherwise surface
    // mid-render with a message naming the wrong thing.
    device.pushErrorScope("out-of-memory");
    device.pushErrorScope("validation");

    // TWO pipelines (the measured v2 split — see the module doc): the
    // march kernel is the bench's proven register-light shape with only
    // the ray derivation swapped to the app's unproject, and the shade
    // kernel runs over host-sized batches of terminal rays so no shading
    // submission is ever unbounded.
    const compileEntry = async (
      mode: "march" | "shade",
      slabExt: boolean,
    ): Promise<GPUShaderModule> => {
      const module = device.createShaderModule({
        code: surfaceDeKernelWgsl({
          mode,
          rays: mode === "march" ? "unproject" : undefined,
          // fr-si66: the march writes each dispatched ray's post-pass
          // status to its own ACTIVE-LIST SLOT, which is the only field
          // the sweep's rebuild reads — 4 B per active ray in place of
          // the whole 16 B/ray states buffer.
          statusOut: mode === "march",
          // fr-55s1: the DE picks the descent core exactly as the CPU
          // estimators route — fold base maps march the wide frontier,
          // fold-free ones the width-4 refined ladder (width/shadeDeWidth
          // are inert there) — and a fold FINAL lens wraps either core in
          // descendLens's branch sweep. fr-dlxh: an escape target takes
          // the forward-orbit core instead (no lens — the escape gate
          // refuses final transforms). fr-rsp6: a 4D target routes the
          // SAME way one dimension up — fold base maps the fold4
          // frontier, fold-free ones the affine4 ladder, and a 4D fold
          // FINAL wraps either in descendLens4's sweep.
          core:
            target.kind === "escape"
              ? "escape"
              : target.kind === "escape4"
                ? // fr-vag4: the escape orbit one dimension up — 4D tail
                  // and GpuMap4 maps, forward orbit and no frontier.
                  "escape4"
                : target.kind === "bulb"
                  ? // fr-tdin: the Mandelbulb's forward triplex-power orbit
                    // — the escape core's sibling, and a CORE of its own
                    // rather than a fourth foldKind (surface-de-gpu.ts's
                    // own reasoning: the escape bodies dispatch on
                    // `kind != 2`/`kind != 1`, so an unrecognized kind
                    // would silently run both folds).
                    "bulb"
                  : target.kind === "ifs4"
                    ? deHasFolds4(target.de)
                      ? "fold4"
                      : "affine4"
                    : deHasFolds(target.de)
                      ? "fold"
                      : "affine",
          lens: !isForwardTarget(target) && target.de.foldFinal !== null,
          // fr-5wlv.5, lifted by fr-qxxw: a balloon ifs/ifs4 target
          // compiles the inverted-union wrapper over whichever core+lens
          // the DE picked; the FORWARD kinds never set the flag (their
          // codegen throws are the backstop).
          balloon:
            (target.kind === "ifs" || target.kind === "ifs4") &&
            target.balloon === true,
          // fr-rhn5, lifted by fr-h0c3: the ground plane compiles into
          // every kind — the classic Mandelbox/Mandelbulb floor, and the
          // floor under a w-slice — and a balloon+plane target is a
          // caller bug the codegen rejects loudly.
          groundPlane: target.groundPlane === true,
          width: SURFACE_FOLD_BEAM_WIDTH,
          shadeDeWidth: mode === "shade" ? shadeDeWidth : undefined,
          workgroupSize: SURFACE_COMPUTE_WORKGROUP_SIZE,
          sharedFrontier: false,
          bnbStage2: false,
          // fr-d0nn: the fr-wa6o slab half-extent registers cost the
          // affine4 kernel a measured 2.2-2.4x at EVERY kaleidoscope
          // order on Iris (occupancy — they are live whether or not the
          // slab is on), so an ifs4 session compiles BOTH variants and
          // runFrame picks per frame by the live sliceHalfW. Inert for
          // every other core.
          slabExt,
        }),
      });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((m) => m.type === "error");
      if (errors.length > 0) {
        throw new Error(
          `Surface compute: ${mode} WGSL compile failed:\n${errors
            .map(
              (m) => `${String(m.lineNum)}:${String(m.linePos)}: ${m.message}`,
            )
            .join("\n")}`,
        );
      }
      return module;
    };

    const bufferEntry = (
      binding: number,
      type: GPUBufferBindingType,
    ): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    });
    // March (rays:"unproject") binds params/maps/active/states + the
    // shade uniform (invProjView + dither knobs only) + fr-si66's status
    // side-channel at 5.
    const marchLayout = device.createBindGroupLayout({
      entries: [
        bufferEntry(0, "uniform"),
        bufferEntry(1, "read-only-storage"),
        bufferEntry(2, "read-only-storage"),
        bufferEntry(3, "storage"),
        bufferEntry(4, "uniform"),
        bufferEntry(5, "storage"),
      ],
    });
    const shadeLayout = device.createBindGroupLayout({
      entries: [
        bufferEntry(0, "uniform"),
        bufferEntry(1, "read-only-storage"),
        bufferEntry(2, "read-only-storage"),
        bufferEntry(3, "storage"),
        bufferEntry(4, "uniform"),
        bufferEntry(5, "read-only-storage"),
        bufferEntry(6, "storage"),
        {
          binding: 7,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 8,
          visibility: GPUShaderStage.COMPUTE,
          sampler: { type: "filtering" },
        },
      ],
    });
    // An ifs4 target compiles a SECOND, slab-free kernel pair beside the
    // full one (fr-d0nn): the shipped slider position is sliceHalfW 0,
    // where the slab pair's ext registers are pure occupancy tax. Both
    // pairs share the explicit bind group layouts below, so bind groups
    // stay variant-agnostic and runFrame's pick is a pipeline handle.
    // fr-rsp6: a !slabExact4 system (spherefold/mandelbox folds) can
    // NEVER take a slab query — the packer throws on sliceHalfW > 0 and
    // the app clamps the thickness slider — so its ONE pair compiles
    // slab-free outright and the A/B pair is skipped.
    const canSlab = target.kind !== "ifs4" || slabExact4(target.de);
    const wantNoSlab = target.kind === "ifs4" && canSlab;
    const [marchModule, shadeModule, marchModuleNoSlab, shadeModuleNoSlab] =
      await Promise.all([
        compileEntry("march", canSlab),
        compileEntry("shade", canSlab),
        wantNoSlab ? compileEntry("march", false) : null,
        wantNoSlab ? compileEntry("shade", false) : null,
      ]);
    const marchPipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [marchLayout],
    });
    const shadePipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [shadeLayout],
    });
    const [
      marchPipeline,
      shadePipeline,
      marchPipelineNoSlab,
      shadePipelineNoSlab,
    ] = await Promise.all([
      device.createComputePipelineAsync({
        layout: marchPipelineLayout,
        compute: { module: marchModule, entryPoint: "marchRays" },
      }),
      device.createComputePipelineAsync({
        layout: shadePipelineLayout,
        compute: { module: shadeModule, entryPoint: "shadeRays" },
      }),
      marchModuleNoSlab
        ? device.createComputePipelineAsync({
            layout: marchPipelineLayout,
            compute: { module: marchModuleNoSlab, entryPoint: "marchRays" },
          })
        : null,
      shadeModuleNoSlab
        ? device.createComputePipelineAsync({
            layout: shadePipelineLayout,
            compute: { module: shadeModuleNoSlab, entryPoint: "shadeRays" },
          })
        : null,
    ]);

    const paramsBuf = device.createBuffer({
      // The 4D cores' params carry the 4D variant tail (rotor, sector
      // step, 4D lens, w0/sliceHalfW) past the frozen block, and the
      // shared balloon/plane block past THAT at the frozen 576 — which is
      // why the appended-block arms come first for them, exactly as they
      // do for the 3D cores.
      size: isFourDTarget(target)
        ? target.kind === "ifs4" && target.balloon === true
          ? SURFACE_GPU_PARAMS4_BALLOON_BYTES
          : target.groundPlane === true
            ? SURFACE_GPU_PARAMS4_PLANE_BYTES
            : target.kind === "escape4"
              ? // fr-vag4: the escape4 variant block is the lens4
                // block's own region, so its size is the lens size.
                SURFACE_GPU_PARAMS4_ESCAPE_BYTES
              : target.de.foldFinal !== null
                ? // fr-rsp6 phase 2B: a fold FINAL grows the params with
                  // the lens block past the 4D tail.
                  SURFACE_GPU_PARAMS4_LENS_BYTES
                : SURFACE_GPU_PARAMS4_BYTES
        : target.kind === "ifs" && target.balloon === true
          ? // fr-5wlv.5: the balloon kernel's params struct appends the
            // balloon block at the frozen offset 288 (272 before
            // fr-s9ll's lens-fold quartet took that slot).
            SURFACE_GPU_PARAMS_BALLOON_BYTES
          : target.groundPlane === true
            ? // fr-rhn5: the plane kernel's params struct appends the
              // plane block at the same frozen offset (the two are
              // mutually exclusive by the codegen throw).
              SURFACE_GPU_PARAMS_PLANE_BYTES
            : SURFACE_GPU_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const shadeBuf = device.createBuffer({
      size: SURFACE_GPU_SHADE_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Re-wrapped copies: the kernel packers' bare Float32Array types
    // (ArrayBufferLike-backed) don't satisfy writeBuffer's non-shared
    // buffer requirement — the bench's own idiom. The BULB kernel never
    // DECLARES the maps binding, but the explicit bind group layouts
    // below keep entry 1 (a layout may carry entries a shader ignores),
    // so that target binds one zero stride there rather than
    // forking every layout/bind-group path. The ESCAPE kernel DOES read
    // it (fr-s04t: one GpuMap per chain link, the document's transform
    // list being the formula sequence). A 4D target packs the
    // GpuMap4 layout (144-byte stride: eight vec4s since fr-rsp6's fold
    // lanes, nine since fr-s9ll's authored fold radii; its own field
    // contract).
    const mapsData =
      target.kind === "escape"
        ? new Float32Array(packEscapeGpuMaps(target.de))
        : target.kind === "escape4"
          ? // fr-vag4: the same chain one dimension up, in the GpuMap4
            // layout — named BEFORE isForwardTarget, which no longer
            // implies "bindingless".
            new Float32Array(packEscape4GpuMaps(target.de))
          : isForwardTarget(target)
            ? new Float32Array(SURFACE_GPU_MAP_VEC4 * 4)
            : target.kind === "ifs4"
              ? new Float32Array(packSurfaceGpuMaps4(target.de))
              : new Float32Array(packSurfaceGpuMaps(target.de));
    const mapsBuf = device.createBuffer({
      size: mapsData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(mapsBuf, 0, mapsData);
    const shadeMapsData = new Float32Array(
      packSurfaceGpuShadeMaps(colors, trapIndices),
    );
    const shadeMapsBuf = device.createBuffer({
      size: shadeMapsData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(shadeMapsBuf, 0, shadeMapsData);
    const lutTex = device.createTexture({
      size: { width: 256, height: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: lutTex },
      WHITE_LUT,
      { bytesPerRow: 256 * 4 },
      { width: 256, height: 1 },
    );
    const lutSamp = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    const validation = await device.popErrorScope();
    const oom = await device.popErrorScope();
    const scopeError = validation ?? oom;
    if (scopeError) {
      throw new Error(
        `Surface compute: resource creation failed: ${scopeError.message}`,
      );
    }

    return new SurfaceComputeRenderer({
      device,
      target,
      marchPipeline,
      marchLayout,
      shadePipeline,
      shadeLayout,
      marchPipelineNoSlab,
      shadePipelineNoSlab,
      paramsBuf,
      shadeBuf,
      mapsBuf,
      shadeMapsBuf,
      lutTex,
      lutSamp,
      adapterLabel: adapterStatus.label,
      software: adapterStatus.software,
    });
  }

  /** Latched true by `device.lost` (or {@link destroy}); every later
   * {@link renderFrame} resolves null. */
  get lost(): boolean {
    return this.isLost;
  }

  /**
   * The largest raster this device can trace as ONE frame, in rays
   * (fr-biox) — {@link surfaceComputeMaxFrameRays} of its real limits.
   * Callers that own the raster read it: captures TILE against it
   * ({@link surfaceComputeTileRows}), the live pane FITS to it
   * ({@link fitSurfaceComputeRaster}). A frame past it throws
   * {@link SurfaceComputeFrameSizeError} rather than reaching the
   * kernels.
   */
  get maxFrameRays(): number {
    return surfaceComputeMaxFrameRays(this.device.limits);
  }

  /** Fired once when the device is lost OUTSIDE {@link destroy} — the
   * session's cue to re-enter via the WebGL path. */
  get onLost(): (() => void) | null {
    return this.onLostCb;
  }

  /**
   * An ACCESSOR rather than a plain field because the loss can PRECEDE the
   * assignment: `create()` spends seconds in pipeline compiles (Mesa's own
   * worst case, and exactly when a flaky driver dies), so `device.lost` can
   * already be resolved when the constructor registers its handler — which
   * then runs with no callback to call, and main.ts, whose only reader of
   * this state is `onLost` itself, would never hear about it (a silently
   * dead renderer whose every {@link renderFrame} resolves null: a
   * permanently blank pane, no toast, no WebGL fallback). So a pending loss
   * is DELIVERED here instead. Exactly once across both paths, so
   * re-assigning a callback afterwards is not a second toast-and-re-enter.
   */
  set onLost(cb: (() => void) | null) {
    this.onLostCb = cb;
    if (cb === null || !this.isLost || this.destroyed || this.lossDelivered)
      return;
    this.lossDelivered = true;
    // Never from inside the assignment itself: the handler RE-ENTERS the
    // surface session, and its assigning caller is mid-setup (main.ts marks
    // the session's first frame several statements below this line — on the
    // re-entered WebGL session, which has not drawn anything yet). A
    // microtask is also how the ordinary path arrives, so a delivered loss
    // and a live one look the same from outside.
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.onLostCb?.();
    });
  }

  private onLostCb: (() => void) | null = null;
  /** True once a device loss has been handed to a callback — by the
   * constructor's `device.lost` handler or by the setter above, whichever
   * saw one first. Not "the device was lost" ({@link isLost} is that): a
   * loss observed with no callback registered is still UNDELIVERED, and the
   * next assignment owes it. */
  private lossDelivered = false;

  private isLost = false;
  /** True once {@link destroy} has been called. This is the cancellation
   * signal every in-flight await checks — it means "teardown requested",
   * NOT "device gone" (fr-uec4): with a frame still parked on live
   * submitted GPU work, the real `device.destroy()` is deferred until
   * {@link framesInFlight} drains to zero. See {@link deviceDestroyed} for
   * the device's actual state. */
  private destroyed = false;
  /** True once `device.destroy()` has actually run. Both {@link destroy}
   * (nothing was in flight) and {@link releaseFrame} (the last in-flight
   * frame just unwound) can reach the real teardown, and since `destroyed`
   * alone no longer tells the two apart, this is the guard that keeps
   * either path from calling `device.destroy()` a second time (fr-uec4). */
  private deviceDestroyed = false;
  private frameToken = 0;
  /** Frames between their {@link renderFrame} call and their final unwind.
   * A frame parks on LIVE submitted GPU work (`mapAsync` over a submitted
   * `copyBufferToBuffer`, `onSubmittedWorkDone` over a submitted dispatch),
   * and destroying the device out from under one of those takes the whole
   * browser process down on Firefox (fr-uec4) — so {@link destroy} hands
   * the real teardown to whichever frame unwinds last instead of running
   * it out from under a live await. */
  private framesInFlight = 0;
  /** Serializes frames: they share buffers and staging maps, so two pass
   * loops must never interleave. */
  private chain: Promise<unknown> = Promise.resolve();
  private frame: FrameBuffers | null = null;
  private uploadedLutVersion: number | null = null;
  /** Last completed frame — the seed for the next frame's prefill (see
   * runFrame's seeding comment). */
  private lastFrame: {
    pixels: Uint8Array<ArrayBuffer>;
    width: number;
    height: number;
  } | null = null;
  private background: {
    width: number;
    height: number;
    /** The stops the rows were built from (fr-5ps1) — a live background
     * change/crossfade must invalidate the cache, not just a resize. */
    bgTop: Vec3;
    bgBottom: Vec3;
    rows: Uint8Array<ArrayBuffer>;
  } | null = null;

  private readonly device: GPUDevice;
  private readonly target: SurfaceComputeTarget;
  private readonly marchPipeline: GPUComputePipeline;
  private readonly marchLayout: GPUBindGroupLayout;
  private readonly shadePipeline: GPUComputePipeline;
  private readonly shadeLayout: GPUBindGroupLayout;
  /** ifs4 only (fr-d0nn): the slab-free kernel pair every sliceHalfW=0
   * frame rides — null for every other target kind. */
  private readonly marchPipelineNoSlab: GPUComputePipeline | null;
  private readonly shadePipelineNoSlab: GPUComputePipeline | null;
  private readonly paramsBuf: GPUBuffer;
  private readonly shadeBuf: GPUBuffer;
  private readonly mapsBuf: GPUBuffer;
  private readonly shadeMapsBuf: GPUBuffer;
  private readonly lutTex: GPUTexture;
  private readonly lutSamp: GPUSampler;
  /** See {@link SurfaceComputeRendererInit.adapterLabel}. */
  readonly adapterLabel: string | undefined;
  /** See {@link SurfaceComputeRendererInit.software}. */
  readonly software: boolean;

  /** Public over a NAMED init object rather than private over sixteen
   * positional GPU resources — see {@link SurfaceComputeRendererInit} for
   * why (the flame backend's own constructor shape, and the seam
   * `surface-compute.test.ts` drives the teardown state machine through).
   * Production builds this through {@link create}. */
  constructor(init: SurfaceComputeRendererInit) {
    this.device = init.device;
    this.target = init.target;
    this.marchPipeline = init.marchPipeline;
    this.marchLayout = init.marchLayout;
    this.shadePipeline = init.shadePipeline;
    this.shadeLayout = init.shadeLayout;
    this.marchPipelineNoSlab = init.marchPipelineNoSlab;
    this.shadePipelineNoSlab = init.shadePipelineNoSlab;
    this.paramsBuf = init.paramsBuf;
    this.shadeBuf = init.shadeBuf;
    this.mapsBuf = init.mapsBuf;
    this.shadeMapsBuf = init.shadeMapsBuf;
    this.lutTex = init.lutTex;
    this.lutSamp = init.lutSamp;
    this.adapterLabel = init.adapterLabel;
    this.software = init.software;
    void this.device.lost.then(() => {
      this.isLost = true;
      // No callback yet means UNDELIVERED, not delivered-to-nobody: the
      // setter picks it up (see {@link lossDelivered}).
      if (this.destroyed || this.lossDelivered || this.onLostCb === null)
        return;
      this.lossDelivered = true;
      this.onLostCb();
    });
  }

  /**
   * Trace one frame as bounded compute passes and resolve with its RGBA8
   * pixels — or null when superseded ({@link cancel} or a newer frame),
   * lost, or destroyed. Frames are serialized internally; latest-wins
   * semantics belong to the caller (cancel, then request anew).
   */
  renderFrame(
    spec: SurfaceComputeFrameSpec,
    opts: SurfaceComputeFrameOptions = {},
  ): Promise<SurfaceComputeFrame | null> {
    const token = ++this.frameToken;
    // Counted from here to the .finally below, whatever the outcome — this
    // is the span destroy() waits out before it is safe to actually tear
    // the device down (fr-uec4).
    this.framesInFlight++;
    const run = this.chain
      .then(() =>
        this.runSamples(token, spec, opts).catch((error: unknown) => {
          // A destroyed/lost device rejects in-flight awaits — that is a
          // cancellation, not a render error. Anything else is logged once
          // and degrades to "no frame"; the session's lost-latch (not this
          // path) owns recovery.
          if (!this.destroyed && !this.isLost) {
            console.error("Surface compute frame failed", error);
          }
          return null;
        }),
      )
      .finally(() => {
        this.releaseFrame();
      });
    this.chain = run;
    return run;
  }

  /**
   * The supersampling wrapper (fr-vpbq): `opts.samples` passes of
   * {@link runFrame} at {@link subPixelSample} offsets, averaged in LINEAR
   * light. At `samples <= 1` it is {@link runFrame} itself, call for call.
   *
   * AVERAGING IS LINEAR, NOT sRGB. Both tracers finish with the
   * `pow(lit, 1/2.2)` encode (surface-material.ts's shade path, mirrored
   * in the WGSL), so the bytes coming back are gamma-encoded; averaging
   * them directly is the classic edge-darkening antialiasing bug. Decode
   * through a 256-entry table (exact, free), accumulate, re-encode once
   * per completed sample.
   *
   * A SUPERSEDED JOB KEEPS WHAT IT FINISHED. `runFrame` resolves null the
   * moment the token moves, so a camera nudge mid-refinement returns the
   * mean of the samples already taken rather than throwing them away —
   * and sample 0 alone is exactly the frame this renderer produced before
   * fr-vpbq, so the caller can never end up with less than it used to get.
   * A TRUNCATED sample (a wall budget cut mid-pass) ends the refinement
   * for the same reason: its unresolved pixels still carry the previous
   * mean's prefill, so folding it in would double-count that mean.
   */
  private async runSamples(
    token: number,
    spec: SurfaceComputeFrameSpec,
    opts: SurfaceComputeFrameOptions,
  ): Promise<SurfaceComputeFrame | null> {
    const samples = Math.max(1, Math.floor(opts.samples ?? 1));
    if (samples === 1) return this.runFrame(token, spec, opts);
    const rays = spec.width * spec.height;
    const accum = new Float32Array(rays * 3);
    let taken = 0;
    let out: SurfaceComputeFrame | null = null;
    let wallMs = 0;
    let gpuMs = 0;
    // ONE hit-shade sizer for the whole job (fr-2ojg). Every pass here
    // traces the SAME pose at the SAME raster with the SAME DE — only the
    // sub-pixel offset moves — so the cost model pass 0 measured is
    // exactly the model passes 1..N-1 need, and re-deriving it from one
    // workgroup each time costs the job N climbs for one frame's worth of
    // information. This is the only carry that is sound: across frames
    // the pose can jump, and the capacity ladder's first-encounter bound
    // is precisely what a jumped pose needs.
    const jobSizer: ShadeSizerState = {
      cost: initialShadeHitCost(),
      cap: SURFACE_COMPUTE_SHADE_HIT_CAP_START,
    };
    for (let s = 0; s < samples; s++) {
      const frame = await this.runFrame(
        token,
        spec,
        {
          ...opts,
          // Sample 0 presents its partials exactly as a single-sample
          // frame does — the image has to develop the way it always has —
          // and its ray tallies are stretched over the whole job so the
          // progress row stays monotone across every sample. Later samples
          // present only their finished mean: a partial pass would repaint
          // aliased pixels over the smoothed ones and read as the render
          // getting worse.
          onProgress:
            s === 0 && opts.onProgress
              ? (pixels, done, total) => {
                  opts.onProgress?.(pixels, done, total * samples);
                }
              : undefined,
        },
        subPixelSample(s),
        jobSizer,
      );
      if (!frame) break;
      wallMs += frame.wallMs;
      gpuMs += frame.gpuMs;
      if (s > 0 && frame.truncated) break;
      const px = frame.pixels;
      for (let i = 0, p = 0, a = 0; i < rays; i++, p += 4, a += 3) {
        accum[a] += SRGB_TO_LINEAR[px[p]];
        accum[a + 1] += SRGB_TO_LINEAR[px[p + 1]];
        accum[a + 2] += SRGB_TO_LINEAR[px[p + 2]];
      }
      taken++;
      if (s === 0) {
        // Pass 0 IS the pre-fr-vpbq frame — hand it back untouched (its
        // own runFrame already seeded lastFrame and presented its
        // partials), so a job superseded here delivers exactly what this
        // renderer delivered before supersampling existed.
        out = { ...frame, wallMs, gpuMs };
      } else {
        const mean = encodeLinearMean(accum, taken, px);
        out = { ...frame, pixels: mean, wallMs, gpuMs };
        // The running mean becomes the seed for the next pass's prefill
        // and for the next frame after this job (the strip settle's
        // preview-seeded-target discipline) — never a single pass's own
        // image, which is the noisier picture of the two.
        if (opts.capture !== true) {
          this.lastFrame = {
            pixels: mean,
            width: spec.width,
            height: spec.height,
          };
        }
        opts.onProgress?.(mean, taken * rays, samples * rays);
      }
      if (frame.truncated) break;
    }
    return out;
  }

  /** Supersede any in-flight and queued frames — they resolve null at
   * their next await. */
  cancel(): void {
    this.frameToken++;
  }

  /** Cancel, then tear the device down — immediately if nothing is in
   * flight, or deferred to {@link releaseFrame} if a frame is still parked
   * on live submitted GPU work. Destroying the device under a pending
   * `mapAsync`/`onSubmittedWorkDone` takes the whole browser process down
   * on Firefox (fr-uec4), so this hands the real `device.destroy()` call
   * to whichever frame unwinds last rather than running it out from under
   * one; the token bump below already guarantees no NEW work gets
   * submitted meanwhile, so the only cost of waiting is one device
   * outliving its session by the length of one in-flight frame.
   * Safe to call twice — the early return below means a second call
   * during that deferred window is a no-op and will NOT retry the
   * teardown, which is fine only because the FIRST call already committed
   * it to {@link releaseFrame}. `onLost` does not fire for a deliberate
   * destroy. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.frameToken++;
    if (this.framesInFlight > 0) return;
    this.destroyDevice();
  }

  /** One frame's counted span ({@link renderFrame}) has fully unwound.
   * Releases its claim on the device and, if {@link destroy} came in while
   * it — or a sibling queued behind it on {@link chain} — was still live,
   * this is the last one out and owes the deferred teardown (fr-uec4). */
  private releaseFrame(): void {
    this.framesInFlight--;
    if (this.framesInFlight === 0 && this.destroyed) this.destroyDevice();
  }

  /** The actual `GPUDevice.destroy()` call, behind the one-shot
   * {@link deviceDestroyed} guard (fr-uec4): reachable from both
   * {@link destroy} (idle — nothing was in flight) and
   * {@link releaseFrame} (busy — something was, and just finished), and
   * since `destroyed` alone no longer distinguishes those two calls from
   * the outside, the guard is what keeps them from ever destroying the
   * device twice. */
  private destroyDevice(): void {
    if (this.deviceDestroyed) return;
    this.deviceDestroyed = true;
    this.device.destroy();
  }

  /**
   * {@link ensureFrameBuffers} with the device's own verdict attached
   * (fr-biox). A frame's five per-ray buffers are the only allocation
   * that scales with the caller's raster, and WebGPU reports both ways it
   * can fail WITHOUT throwing: an over-limit size is a validation error
   * returning an invalid buffer, an exhausted allocator an out-of-memory
   * one. Either way the first REJECTION comes from a staging `mapAsync`
   * several awaits later ("Invalid buffer" — the fr-biox report), so the
   * size that caused it is checked up front and the scopes convert what
   * is left into an error that names it.
   *
   * Only the allocating call pays for this: a reused frame (every frame
   * at a steady raster) returns before the scopes are pushed, so the
   * `popErrorScope` round-trip never lands in the per-frame path.
   */
  private async allocateFrameBuffers(rays: number): Promise<FrameBuffers> {
    if (this.frame && this.frame.rays >= rays) return this.frame;
    const cap = this.maxFrameRays;
    if (rays > cap) {
      const limits = this.device.limits;
      throw new SurfaceComputeFrameSizeError(
        `Surface compute: a ${String(rays)}-ray frame needs a ` +
          `${mib(rays * SURFACE_COMPUTE_RAY_STATE_BYTES)} ray-state buffer, ` +
          `past this device's limits (maxStorageBufferBindingSize ` +
          `${mib(limits.maxStorageBufferBindingSize)}, maxBufferSize ` +
          `${mib(limits.maxBufferSize)}) — at most ${String(cap)} rays fit`,
      );
    }
    this.device.pushErrorScope("validation");
    this.device.pushErrorScope("out-of-memory");
    const buffers = this.ensureFrameBuffers(rays);
    const oom = await this.device.popErrorScope();
    const validation = await this.device.popErrorScope();
    const error = oom ?? validation;
    if (error) {
      // The buffers behind an error scope are invalid but still cached,
      // and a later (smaller) frame would happily reuse them — drop them
      // so the next raster allocates fresh.
      this.releaseFrameBuffers();
      throw new SurfaceComputeFrameSizeError(
        `Surface compute: allocating a ${String(rays)}-ray frame ` +
          `(${mib(rays * SURFACE_COMPUTE_RAY_BYTES)} of buffers) failed: ` +
          error.message,
      );
    }
    return buffers;
  }

  private releaseFrameBuffers(): void {
    if (!this.frame) return;
    for (const b of [
      this.frame.states,
      this.frame.active,
      this.frame.color,
      this.frame.status,
      this.frame.stagingStatus,
      this.frame.stagingColor,
    ]) {
      b.destroy();
    }
    this.frame = null;
  }

  private ensureFrameBuffers(rays: number): FrameBuffers {
    if (this.frame && this.frame.rays >= rays) return this.frame;
    this.releaseFrameBuffers();
    const device = this.device;
    // fr-si66: the states buffer is no longer a COPY_SRC — nothing reads
    // it back. The host's per-sweep question is one field of it, and the
    // march answers that directly through `status`.
    const states = device.createBuffer({
      size: rays * SURFACE_COMPUTE_RAY_STATE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const active = device.createBuffer({
      size: rays * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const color = device.createBuffer({
      size: rays * 4,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
    const status = device.createBuffer({
      size: rays * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const stagingStatus = device.createBuffer({
      size: rays * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const stagingColor = device.createBuffer({
      size: rays * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const marchBindGroup = device.createBindGroup({
      layout: this.marchLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: { buffer: this.mapsBuf } },
        { binding: 2, resource: { buffer: active } },
        { binding: 3, resource: { buffer: states } },
        { binding: 4, resource: { buffer: this.shadeBuf } },
        { binding: 5, resource: { buffer: status } },
      ],
    });
    const shadeBindGroup = device.createBindGroup({
      layout: this.shadeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: { buffer: this.mapsBuf } },
        { binding: 2, resource: { buffer: active } },
        { binding: 3, resource: { buffer: states } },
        { binding: 4, resource: { buffer: this.shadeBuf } },
        { binding: 5, resource: { buffer: this.shadeMapsBuf } },
        { binding: 6, resource: { buffer: color } },
        { binding: 7, resource: this.lutTex.createView() },
        { binding: 8, resource: this.lutSamp },
      ],
    });
    this.frame = {
      rays,
      states,
      active,
      color,
      status,
      stagingStatus,
      stagingColor,
      marchBindGroup,
      shadeBindGroup,
    };
    return this.frame;
  }

  private backgroundRows(
    width: number,
    height: number,
    bgTop: Vec3,
    bgBottom: Vec3,
  ): Uint8Array<ArrayBuffer> {
    const cached = this.background;
    if (
      cached &&
      cached.width === width &&
      cached.height === height &&
      cached.bgTop.every((c, i) => c === bgTop[i]) &&
      cached.bgBottom.every((c, i) => c === bgBottom[i])
    ) {
      return cached.rows;
    }
    const rows = buildSurfaceComputeBackground(width, height, bgTop, bgBottom);
    this.background = {
      width,
      height,
      bgTop: [...bgTop],
      bgBottom: [...bgBottom],
      rows,
    };
    return rows;
  }

  private async readback(
    src: GPUBuffer,
    staging: GPUBuffer,
    bytes: number,
  ): Promise<ArrayBuffer> {
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(src, 0, staging, 0, bytes);
    this.device.queue.submit([encoder.finish()]);
    return this.drainStaging(staging, bytes);
  }

  /** Map, copy out and unmap a staging buffer whose bytes are ALREADY on
   * the queue — fr-si66's march statuses arrive that way, one copy per
   * slice riding the slice's own submission, so the sweep pays one
   * `mapAsync` round trip rather than one per slice. `mapAsync` queues
   * behind everything already submitted, which is the same ordering
   * guarantee {@link readback} leans on. */
  private async drainStaging(
    staging: GPUBuffer,
    bytes: number,
  ): Promise<ArrayBuffer> {
    await staging.mapAsync(GPUMapMode.READ, 0, bytes);
    const copy = staging.getMappedRange(0, bytes).slice(0);
    staging.unmap();
    return copy;
  }

  private async runFrame(
    token: number,
    spec: SurfaceComputeFrameSpec,
    opts: SurfaceComputeFrameOptions,
    /** This pass's sub-pixel sample position (fr-vpbq). The default is the
     * pixel centre — the value every ray derivation used to hardcode — so
     * a single-sample frame is the pre-supersampling one. */
    pixelJitter: [number, number] = [0.5, 0.5],
    /** The supersampling job's shared hit-shade sizer state (fr-2ojg),
     * mutated in place so each pass starts where the last one converged.
     * Absent = a fresh model and a one-workgroup capacity. */
    jobSizer?: ShadeSizerState,
  ): Promise<SurfaceComputeFrame | null> {
    const trace = surfaceComputeTrace;
    // Read once per frame beside the trace sink, so a pin can never change
    // under a frame that is already scheduling against it (see
    // {@link surfaceComputeMarchChunkPin}).
    const marchChunkPin = surfaceComputeMarchChunkPin;
    const marchStepsPin = surfaceComputeMarchStepsPin;
    const shadeHitsPin = surfaceComputeShadeHitsPin;
    const traceT0 = performance.now();
    const tr = (line: string): void => {
      trace?.(`[${(performance.now() - traceT0).toFixed(0)}ms] ${line}`);
    };
    if (token !== this.frameToken || this.isLost || this.destroyed) return null;
    const wallStart = performance.now();
    const budgetMs = opts.budgetMs ?? Infinity;
    const progressMs = opts.progressIntervalMs ?? SURFACE_COMPUTE_PROGRESS_MS;
    const { width, height } = spec;
    const rays = width * height;
    const device = this.device;
    const buffers = await this.allocateFrameBuffers(rays);
    if (token !== this.frameToken || this.isLost || this.destroyed) return null;

    if (spec.lutVersion !== this.uploadedLutVersion) {
      device.queue.writeTexture(
        { texture: this.lutTex },
        // Re-wrapped: the spec's bytes are scene.ts's live texture data
        // (ArrayBufferLike-typed); 1KB per ramp change.
        spec.lut ? new Uint8Array(spec.lut) : WHITE_LUT,
        { bytesPerRow: 256 * 4 },
        { width: 256, height: 1 },
      );
      this.uploadedLutVersion = spec.lutVersion;
    }
    device.queue.writeBuffer(
      this.shadeBuf,
      0,
      packSurfaceGpuShade({
        invProjView: spec.invProjView,
        lightDir: spec.lightDir,
        ambient: spec.ambient,
        bgTop: spec.bgTop,
        bgBottom: spec.bgBottom,
        colorSpeed: spec.colorSpeed,
        tracePixelEps: spec.tracePixelEps,
        colorSource: spec.colorSource,
        shadowSteps: spec.shadowSteps,
        aoTaps: spec.aoTaps,
        dither: spec.dither,
        fogTint: spec.fogTint,
        fogTintStrength: spec.fogTintStrength,
        pixelJitter,
      }),
    );
    // Host prefill contract (module doc of surface-de-gpu.ts): rays still
    // ACTIVE at a budget cut (or mid-frame progress presents) keep this
    // seed; the kernel writes every terminal pixel itself. Seeding from
    // the LAST frame — resampled across raster changes — is the strip
    // settle's preview-seeded-target discipline: a frame's presents never
    // look worse than the image they follow. First frame of a session
    // seeds the backdrop gradient, and so does every capture frame
    // (fr-biox: an export tile has no live image to carry).
    const last = opts.capture === true ? null : this.lastFrame;
    device.queue.writeBuffer(
      buffers.color,
      0,
      last === null
        ? this.backgroundRows(width, height, spec.bgTop, spec.bgBottom)
        : last.width === width && last.height === height
          ? last.pixels
          : resampleSurfacePixels(
              last.pixels,
              last.width,
              last.height,
              width,
              height,
            ),
    );
    const states = new Float32Array(rays * 4);
    for (let i = 0; i < rays; i++) states[i * 4] = -1;
    device.queue.writeBuffer(buffers.states, 0, states);

    let active = new Uint32Array(rays);
    for (let i = 0; i < rays; i++) active[i] = i;
    // Rays that turned terminal in a march pass, awaiting a shade batch.
    // The QUEUES are the v2 architecture's point: shading a freshly-HIT
    // ray costs ~40 zero-cutoff on-surface DE evals — orders of magnitude
    // more than a march step — and letting it ride the march pass that
    // terminated it measured 1.1-5.3s submissions and a real device loss
    // on Iris (fr-096u's watchdog through the shading door). Hits and
    // misses queue SEPARATELY because their costs differ by those same
    // orders of magnitude and the arrival order is scanline-coherent: a
    // shared ray-unit queue let miss runs inflate the batch size that a
    // following hit band then paid — the module doc's five kernel-
    // confirmed GPU hangs. Host-sized pure batches keep every shading
    // submission bounded in the unit that actually costs.
    let shadeHitQueue: number[] = [];
    let shadeFreeQueue: number[] = [];
    let stepsThisPass = marchStepsPin ?? 1;
    // fr-tdft sub-ray credit bookkeeping: march steps issued to every
    // surviving active ray by COMPLETED sweeps, and how many of the
    // current sweep's rays have been dispatched so far (those hold
    // stepsThisPass steps more). Exact for still-active rays — the
    // kernel's march loop exits early only on terminal transitions.
    let sweepSteps = 0;
    let sweepSliced = 0;
    // The hit-shade cost model and its capacity ladder. A supersampling
    // JOB hands the same carrier to every pass (fr-2ojg): passes 1..N-1
    // differ from pass 0 by a sub-pixel offset and NOTHING else — same
    // pose, same raster, same DE, same hits — so re-learning the model
    // from one workgroup eight times over is eight ramps paid for one
    // frame's worth of information. A single-sample frame gets a fresh
    // model, which is where the ladder's first-encounter bound belongs.
    const sizer: ShadeSizerState = jobSizer ?? {
      cost: initialShadeHitCost(),
      cap: SURFACE_COMPUTE_SHADE_HIT_CAP_START,
    };
    // fr-55s1 stage D: a fold FINAL lens multiplies every march step by
    // its branch sweep — 27 boxfold / 3 spherefold / 81 mandelbox
    // branches around the core, discounted /8 for the prunes'
    // measured-typical survival (surfaceDescentCostWeight's factor,
    // surface-de.ts) — so first-slice sizing starts from a
    // proportionally raised prior and stays watchdog-safe before the EMA
    // takes over. The SHADE side carries no prior at all since fr-2ojg
    // (see SURFACE_COMPUTE_SHADE_HIT_CAP_START): its first batch is one
    // workgroup whatever a prior would have said, so scaling one only
    // lengthened the climb back out.
    // (Both FORWARD kinds scale nothing: the orbit is phone-cheap — the
    // bulb measured 3.5x CHEAPER per eval than the fold mode
    // (bulb-de.ts's verdict) — and
    // the pessimistic base prior only errs toward smaller first slices.
    // Affine 4D targets scale nothing either — the affine4 ladder starts
    // from the same pessimistic base prior the 3D affine class would.
    // FOLD-shaped 4D targets scale (fr-rsp6): the base prior absorbed
    // the 3D fold class's 27/81-branch fans, and the 4D fans are 3x
    // wider — 81 boxfold / 243 mandelbox — so the first slice scales by
    // maxFan/27 (spherefold's 3 stays at the floor); a 4D fold FINAL
    // multiplies its own fan/8 exactly like the 3D lens.)
    const lensKind = !isForwardTarget(this.target)
      ? this.target.de.foldFinal?.foldKind
      : undefined;
    const lensFan4 =
      this.target.kind === "ifs4" && lensKind !== undefined
        ? lensKind === 1
          ? 81
          : lensKind === 2
            ? 3
            : 243
        : undefined;
    const baseFoldScale =
      this.target.kind === "ifs4"
        ? Math.max(
            1,
            this.target.de.maps.reduce(
              (acc, m) =>
                Math.max(
                  acc,
                  m.foldKind === 1 ? 81 : m.foldKind === 3 ? 243 : 1,
                ),
              1,
            ) / 27,
          )
        : 1;
    const lensCostScale =
      baseFoldScale *
      (lensKind === undefined
        ? 1
        : Math.max(
            1,
            (lensFan4 ?? (lensKind === 1 ? 27 : lensKind === 2 ? 3 : 81)) / 8,
          ));
    // fr-5wlv.5: the balloon union pays the inverted shell eval on top of
    // the fractal term — fr-5wlv.1 measured rest-state march steps
    // x1.25-2.06 over plain (value queries x1.00-1.27) — so the first
    // march slice's prior starts doubled; erring toward smaller first
    // slices is the safe direction, and the EMA takes over from the
    // first measurement.
    const balloonCostScale =
      (this.target.kind === "ifs" || this.target.kind === "ifs4") &&
      this.target.balloon === true
        ? 2
        : 1;
    let passes = 0;
    let gpuMs = 0;
    let marchGpuMs = 0;
    let shadeGpuMs = 0;
    let truncated = false;
    let lastProgress = wallStart;
    // When the last HIT batch went out — the clock the partial-batch hold
    // below is bounded by, so no hit waits longer than one present
    // interval however slowly the sweeps are feeding the queue.
    let lastHitDispatch = wallStart;

    // One packer per frame, kind-routed once: the 4D packer additionally
    // closes over the spec's live view (rotor/slice re-read per frame by
    // scene.ts) — an ifs4 frame without one is a contract bug, thrown
    // loud here rather than defaulted (a 4D frame with no pose has no
    // meaningful default).
    const target = this.target;
    // fr-rhn5: a plane session's spec must carry the live floor block
    // (view4/balloon's required-throw discipline — the 336-byte kernel
    // struct has no meaningful default); a no-plane session ignores any
    // stray spec.groundPlane — its buffer never grew.
    const groundPlane =
      target.groundPlane === true
        ? (() => {
            const gp = spec.groundPlane;
            if (!gp) {
              throw new Error(
                "Surface compute: a ground-plane frame spec must carry groundPlane",
              );
            }
            return gp;
          })()
        : null;
    // The 4D kinds' live view, read once per frame — an ifs4/escape4
    // frame without one is a contract bug, thrown loud rather than
    // defaulted.
    const view4 = isFourDTarget(target)
      ? (() => {
          const v = spec.view4;
          if (!v) {
            throw new Error(
              `Surface compute: an ${target.kind} frame spec must carry view4`,
            );
          }
          return v;
        })()
      : null;
    const packParams: (run: SurfaceGpuRunParams) => ArrayBuffer =
      target.kind === "escape"
        ? (run) => packEscapeGpuParams(target.de, run, groundPlane)
        : target.kind === "escape4"
          ? (run) => packEscape4GpuParams(target.de, view4!, run, groundPlane)
          : target.kind === "bulb"
            ? // fr-tdin: the escape packer's twin — one asymmetry, and it
              // is inside packBulbGpuParams: the ORBIT bailout and the
              // QUERY-space marching ball are different numbers for this
              // object, so the frozen radii take the latter.
              (run) => packBulbGpuParams(target.de, run, groundPlane)
            : target.kind === "ifs4"
              ? (() => {
                  // fr-qxxw: a balloon 4D session's spec must carry the
                  // live balloon block, exactly as a 3D one's does.
                  if (target.balloon === true) {
                    const balloon = spec.balloon;
                    if (!balloon) {
                      throw new Error(
                        "Surface compute: a balloon frame spec must carry balloon",
                      );
                    }
                    return (run: SurfaceGpuRunParams) =>
                      packSurface4GpuParams(target.de, view4!, run, balloon);
                  }
                  return (run: SurfaceGpuRunParams) =>
                    packSurface4GpuParams(
                      target.de,
                      view4!,
                      run,
                      null,
                      groundPlane,
                    );
                })()
              : (() => {
                  // fr-5wlv.5: a balloon session's spec must carry the live
                  // balloon block (the R slider's per-frame door — view4's
                  // required-throw discipline; the 320-byte kernel struct has
                  // no meaningful default). A no-balloon session ignores any
                  // stray spec.balloon — its buffer is 288 bytes.
                  if (target.balloon === true) {
                    const balloon = spec.balloon;
                    if (!balloon) {
                      throw new Error(
                        "Surface compute: a balloon frame spec must carry balloon",
                      );
                    }
                    return (run: SurfaceGpuRunParams) =>
                      packSurfaceGpuParams(target.de, run, balloon);
                  }
                  return (run: SurfaceGpuRunParams) =>
                    packSurfaceGpuParams(target.de, run, null, groundPlane);
                })();
    // fr-d0nn: an ifs4 frame at the shipped sliceHalfW 0 rides the
    // slab-free kernel pair (measured 2.2-2.4x cheaper at every
    // kaleidoscope order — the fr-wa6o ext registers are occupancy tax
    // even when dynamically dead); any h > 0 frame takes the full slab
    // pair. Per frame, not per session — the thickness slider is live
    // and can cross 0 mid-session. Non-ifs4 targets carry no noslab
    // pair, so they always resolve to the main one. The h = 0 outputs
    // are bit-identical between the pairs (segmentRadius4 at e = 0 IS
    // length(q)), pinned by the bench's aff4 sweep agreement gate.
    const slabFrame = (spec.view4?.sliceHalfW ?? 0) > 0;
    const marchPipeline =
      !slabFrame && this.marchPipelineNoSlab !== null
        ? this.marchPipelineNoSlab
        : this.marchPipeline;
    const shadePipeline =
      !slabFrame && this.shadePipelineNoSlab !== null
        ? this.shadePipelineNoSlab
        : this.shadePipeline;
    const writeParams = (itemCount: number, steps: number): void => {
      const run: SurfaceGpuRunParams = {
        itemCount,
        stepsThisPass: steps,
        marchSteps: spec.marchSteps,
        maxDepth: spec.maxDepth,
        hitFloor: spec.hitFloor,
        cutoff: 0,
        footprint: 0,
        fogDensity: spec.fogDensity,
        pose: {
          ro: spec.camPos,
          right: [1, 0, 0],
          up: [0, 1, 0],
          fwd: [0, 0, 1],
          tanHalf: 0,
          aspect: width / Math.max(1, height),
          rasterWidth: width,
          rasterHeight: height,
          // The ACCEPTANCE slope (fr-7xgi): eps = max(pixelEps * t,
          // hitFloorEps) in the kernel's march — native-height derived,
          // tier-independent.
          pixelEps: spec.acceptPixelEps,
        },
      };
      device.queue.writeBuffer(this.paramsBuf, 0, packParams(run));
    };
    const dispatchTimed = async (
      pipeline: GPUComputePipeline,
      bindGroup: GPUBindGroup,
      count: number,
      /** fr-si66: a device-local copy appended to the SAME submission —
       * the march slice's `count` statuses, staged at the slice's own
       * offset in the sweep's readback. Riding the dispatch costs no
       * extra submission and no extra fence; it lands in the measured
       * pass time, which is the honest place for it (a `count`-word copy
       * against a `count`×`stepsThisPass` DE march). */
      copyAfter?: { src: GPUBuffer; dst: GPUBuffer; dstOffset: number },
    ): Promise<number | null> => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(count / SURFACE_COMPUTE_WORKGROUP_SIZE),
      );
      pass.end();
      if (copyAfter) {
        encoder.copyBufferToBuffer(
          copyAfter.src,
          0,
          copyAfter.dst,
          copyAfter.dstOffset,
          count * 4,
        );
      }
      const t0 = performance.now();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      if (token !== this.frameToken || this.isLost || this.destroyed) {
        return null;
      }
      return performance.now() - t0;
    };

    // The device's own ceiling on ONE dispatch (fr-257o) — the last clamp
    // on both sizing paths below, above whatever their cost model asked
    // for. See {@link surfaceComputeMaxDispatchRays}.
    const maxDispatchRays = surfaceComputeMaxDispatchRays(device.limits);

    // Progress presents fire BETWEEN bounded pieces of work — march
    // slices and shade batches alike — never only at iteration ends: a
    // full-depth shade drain can grind for minutes, and the whole point
    // of progressive presents is that the screen develops through it.
    const maybePresent = async (): Promise<boolean> => {
      if (!opts.onProgress) return true;
      if (performance.now() - lastProgress < progressMs) return true;
      tr("present readback BEGIN");
      const partial = new Uint8Array(
        await this.readback(buffers.color, buffers.stagingColor, rays * 4),
      );
      tr("present readback END");
      if (token !== this.frameToken || this.isLost || this.destroyed) {
        return false;
      }
      lastProgress = performance.now();
      // fr-tdft: march credit accrues per consumed step, shade credit on
      // shaded pixels — surfaceComputeProgressDone owns the formula and
      // the monotonicity argument.
      opts.onProgress(
        partial,
        surfaceComputeProgressDone({
          rays,
          active: active.length,
          shadeQueued: shadeHitQueue.length + shadeFreeQueue.length,
          sweepSteps,
          sliced: sweepSliced,
          stepsThisPass,
          marchSteps: spec.marchSteps,
        }),
        rays,
      );
      return true;
    };

    // balloonCostScale: the fr-5wlv.1 march-step numbers (the prior
    // comment above `balloonCostScale`).
    let rayStepEmaUs =
      SURFACE_COMPUTE_INITIAL_RAY_STEP_US * lensCostScale * balloonCostScale;
    // fr-si66: the frame's terminal tally, accumulated as each sweep
    // classifies its rays — the whole-states scan that used to produce it
    // needed a readback this loop no longer pays for.
    const counts = { hit: 0, miss: 0, exhausted: 0, active: 0, plane: 0 };
    tr(
      `frame start rays=${rays} marchSteps=${spec.marchSteps} budgetMs=${budgetMs} shadeCost0=${sizer.cost.interceptUs.toFixed(0)}+n*${sizer.cost.marginalUs.toFixed(1)}us rayStepEmaUs0=${rayStepEmaUs} shadeHitCap0=${sizer.cap}`,
    );
    outer: while (
      active.length > 0 ||
      shadeHitQueue.length > 0 ||
      shadeFreeQueue.length > 0
    ) {
      if (performance.now() - wallStart > budgetMs) {
        truncated = true;
        tr("budget truncated (outer)");
        break;
      }
      if (active.length > 0) {
        // One sweep over the active list, in slices sized from the
        // measured per-ray·step cost so no single submission outruns the
        // pass target — a full-resolution settle is ~200x a preview's
        // rays, and stepsThisPass alone cannot bound it.
        for (let offset = 0; offset < active.length;) {
          if (performance.now() - wallStart > budgetMs) {
            truncated = true;
            tr("budget truncated (march)");
            break outer;
          }
          const chunk = Math.min(
            marchChunkPin ?? marchChunkFor(rayStepEmaUs, stepsThisPass),
            active.length - offset,
            maxDispatchRays,
          );
          if (!Number.isFinite(chunk) || chunk <= 0) {
            tr(`ANOMALY march chunk=${chunk} emaUs=${rayStepEmaUs}`);
          }
          const slice = active.subarray(offset, offset + chunk);
          writeParams(slice.length, stepsThisPass);
          device.queue.writeBuffer(buffers.active, 0, slice);
          tr(
            `march BEGIN offset=${offset} chunk=${chunk} len=${slice.length} steps=${stepsThisPass} emaUs=${rayStepEmaUs.toFixed(3)} active=${active.length}`,
          );
          const marchMs = await dispatchTimed(
            marchPipeline,
            buffers.marchBindGroup,
            slice.length,
            // fr-si66: this slice's statuses, staged where the sweep's
            // rebuild expects them — the kernel writes slot-relative
            // (`statusOut[gid]`), so slice k's answers land at k's own
            // offset and one map at the sweep's end reads the lot.
            {
              src: buffers.status,
              dst: buffers.stagingStatus,
              dstOffset: offset * 4,
            },
          );
          tr(`march END ms=${marchMs === null ? "null" : marchMs.toFixed(1)}`);
          if (marchMs === null) return null;
          gpuMs += marchMs;
          marchGpuMs += marchMs;
          passes++;
          const usPerRayStep =
            (marchMs * 1000) / (slice.length * Math.max(1, stepsThisPass));
          rayStepEmaUs = rayStepEmaUs * 0.6 + usPerRayStep * 0.4;
          offset += chunk;
          sweepSliced = offset;
          if (!(await maybePresent())) return null;
        }
        // fr-si66: 4 B per ACTIVE ray, already staged by the slices' own
        // submissions — where this used to read the WHOLE 16 B/ray states
        // buffer back every sweep, active list or not, to look at one
        // field of it. The saving compounds as the sweep count rises: a
        // raster too big to sweep whole holds stepsThisPass at 1, so a
        // full-tier settle is up to `marchSteps` sweeps, and each one used
        // to cost the frame's entire ray state.
        tr(`status readback BEGIN active=${active.length}`);
        const statusCopy = new Uint32Array(
          await this.drainStaging(buffers.stagingStatus, active.length * 4),
        );
        tr("status readback END");
        if (token !== this.frameToken || this.isLost || this.destroyed) {
          return null;
        }
        const next: number[] = [];
        for (let slot = 0; slot < active.length; slot++) {
          const ray = active[slot];
          const rayStatus = statusCopy[slot];
          if (rayStatus === SURFACE_GPU_RAY_ACTIVE) {
            next.push(ray);
          } else if (
            rayStatus === SURFACE_GPU_RAY_HIT ||
            rayStatus === SURFACE_GPU_RAY_PLANE
          ) {
            if (rayStatus === SURFACE_GPU_RAY_HIT) counts.hit++;
            else counts.plane++;
            // fr-rhn5: plane rays are priced WITH the hits — a floor
            // pixel pays the penumbra-shadow/AO probe evals a hit pays
            // (within its corridor gates), nothing like a miss's one
            // background write; the hit EMA's slow-trust policy absorbs
            // the remaining within-band spread, and the original
            // 100-1000x miss/hit bimodality that forced the queue split
            // never recurs.
            shadeHitQueue.push(ray);
          } else {
            if (rayStatus === SURFACE_GPU_RAY_MISS) counts.miss++;
            else if (rayStatus === SURFACE_GPU_RAY_EXHAUSTED)
              counts.exhausted++;
            shadeFreeQueue.push(ray);
          }
        }
        // Steps grow only while the WHOLE active set fits a single slice
        // — small rasters (previews) climb toward 32 exactly like the
        // bench loop; big rasters stay at fine steps and let the slicing
        // do the bounding (same total work, bounded pieces, presents in
        // between).
        const sweptWhole =
          marchChunkFor(rayStepEmaUs, stepsThisPass) >= active.length;
        // Every surviving ray consumed this sweep's steps; must land
        // BEFORE stepsThisPass may grow for the next sweep.
        sweepSteps += stepsThisPass;
        sweepSliced = 0;
        active = Uint32Array.from(next);
        if (marchStepsPin === null && sweptWhole) {
          stepsThisPass = nextStepsPerPass(stepsThisPass, 0);
        }
        tr(
          `sweep done active=${active.length} hitQ=${shadeHitQueue.length} freeQ=${shadeFreeQueue.length} sweepSteps=${sweepSteps} stepsThisPass=${stepsThisPass}`,
        );
      }
      while (shadeHitQueue.length > 0 || shadeFreeQueue.length > 0) {
        if (performance.now() - wallStart > budgetMs) {
          // Marched-but-unshaded rays keep their seed pixels — the
          // documented truncation contract.
          truncated = true;
          tr("budget truncated (shade)");
          break outer;
        }
        // Free rays (miss/exhausted) first, ALL OF THEM IN ONE DISPATCH
        // (fr-257o) — and presents fill the backdrop before the hit grind
        // starts.
        //
        // The free queue has no cost model to cap because there is no cost
        // to model: every exit the shade entry offers a non-HIT status is
        // the same two lines — evaluate the backdrop ramp at this pixel's
        // row, store it — so a free batch's GPU time is its (tiny) memory
        // traffic plus the per-submission wall, and the wall is the whole
        // of it at any batch size worth naming. MEASURED at the flat 4096
        // this used to share with the hit queue: 3.2 ms per dispatch, 2492
        // dispatches, 8.0 s of a 35 s settle spent painting backdrop —
        // ~307 submissions per full-resolution frame times the 8
        // supersampling passes (fr-vpbq). Nothing in that number is work.
        //
        // The i915 hangs behind the hit queue's slow-trust sizing do not
        // reach here: they were HIT batches sized in RAY units, where one
        // ray's probe evals can cost 100 ms. The only ceiling a free batch
        // has to meet is the device's own dispatch one.
        const isFree = shadeFreeQueue.length > 0;
        // The budget this batch is SIZED for, kept for the capacity
        // ladder below: the growth threshold has to be the number the
        // sizer aimed at, not a fixed constant (fr-2ojg).
        const hitBudgetMs = shadeHitBudgetUs(sizer.cost.interceptUs) / 1000;
        const batchSize = isFree
          ? Math.min(shadeFreeQueue.length, maxDispatchRays)
          : Math.min(
              shadeHitsPin ?? shadeHitBatchSize(sizer.cost, sizer.cap),
              maxDispatchRays,
            );
        // HOLD a partial hit batch for the next sweep's hits rather than
        // paying a whole dispatch's fixed cost for it (fr-2ojg). The
        // intercept is the same whether a dispatch carries 15 hits or
        // 1000 — ~88 ms measured on the boxfold pair, ~480 ms on
        // mandelboxKifs — and a sweep hands over its hits a few hundred
        // at a time, so draining to empty after every sweep spent a
        // frame's fixed costs several times over (MEASURED: 6 hit
        // dispatches per settle frame where the sizer had priced 2-3,
        // every one of the extras a queue-limited sliver).
        //
        // TWO BOUNDS keep it from becoming a stall. The march must still
        // be able to ADD to the queue — once the active list is empty
        // nothing more is coming, and the outer loop's own condition
        // means the queue always drains before the frame ends. And no
        // hit waits longer than one progressive-present interval: the
        // screen has to keep developing, which is the whole reason
        // presents fire between bounded pieces at all. Rays held over a
        // budget cut keep their seed pixels, which for every frame after
        // the first is the previous frame's shading of very nearly the
        // same geometry (fr-f4bx's prefill), not backdrop.
        if (
          !isFree &&
          active.length > 0 &&
          shadeHitQueue.length < batchSize &&
          performance.now() - lastHitDispatch < progressMs
        ) {
          tr(
            `shade HOLD hitQ=${shadeHitQueue.length} want=${batchSize} active=${active.length}`,
          );
          break;
        }
        const batch = Uint32Array.from(
          (isFree ? shadeFreeQueue : shadeHitQueue).slice(0, batchSize),
        );
        if (isFree) {
          shadeFreeQueue = shadeFreeQueue.slice(batch.length);
        } else {
          shadeHitQueue = shadeHitQueue.slice(batch.length);
        }
        if (!Number.isFinite(batchSize) || batch.length === 0) {
          tr(
            `ANOMALY shade isFree=${isFree} batchSize=${batchSize} len=${batch.length} cost=${sizer.cost.interceptUs}+n*${sizer.cost.marginalUs} cap=${sizer.cap}`,
          );
        }
        tr(
          `shade BEGIN isFree=${isFree} hitQ=${shadeHitQueue.length} freeQ=${shadeFreeQueue.length} batchSize=${batchSize} len=${batch.length} interceptUs=${sizer.cost.interceptUs.toFixed(0)} marginalUs=${sizer.cost.marginalUs.toFixed(1)} budgetMs=${hitBudgetMs.toFixed(0)} cap=${sizer.cap}`,
        );
        writeParams(batch.length, 0);
        device.queue.writeBuffer(buffers.active, 0, batch);
        const shadeMs = await dispatchTimed(
          shadePipeline,
          buffers.shadeBindGroup,
          batch.length,
        );
        tr(`shade END ms=${shadeMs === null ? "null" : shadeMs.toFixed(1)}`);
        if (shadeMs === null) return null;
        gpuMs += shadeMs;
        shadeGpuMs += shadeMs;
        passes++;
        if (!isFree) {
          lastHitDispatch = performance.now();
          // Hit economics only — free batches would just dilute the model
          // toward zero and re-open the miss-inflated-capacity hole.
          sizer.cost = nextShadeHitCost(
            sizer.cost,
            batch.length,
            shadeMs * 1000,
          );
          // A QUEUE-LIMITED batch (the sweep had fewer hits than the
          // sizer asked for) may shrink the capacity but never grow it:
          // coming in under budget on a batch that could not be any wider
          // is not evidence that a wider one would fit. That is fr-p8bc's
          // lesson — miss runs inflating a capacity a hit band then paid
          // — in the one place it can still happen now the queues are
          // split.
          const grown = nextShadeBatchSize(sizer.cap, shadeMs, hitBudgetMs);
          sizer.cap =
            batch.length < batchSize ? Math.min(sizer.cap, grown) : grown;
          tr(
            `shade cost→${sizer.cost.interceptUs.toFixed(0)}+n*${sizer.cost.marginalUs.toFixed(1)}us cap→${sizer.cap}`,
          );
        }
        if (!(await maybePresent())) return null;
      }
    }

    tr("final readback BEGIN");
    const pixels = new Uint8Array(
      await this.readback(buffers.color, buffers.stagingColor, rays * 4),
    );
    if (token !== this.frameToken || this.isLost || this.destroyed) return null;
    // fr-si66: the tally is kept as rays LEAVE the active list, so it
    // needs no final pass over the ray states (there is none to read).
    // ACTIVE is what is left over — rays a budget cut stranded mid-march,
    // rays no sweep ever classified, and (unreachably) any status outside
    // the vocabulary, which is exactly what the whole-buffer scan used to
    // count as active.
    counts.active =
      rays - counts.hit - counts.miss - counts.exhausted - counts.plane;
    tr(
      `frame done passes=${passes} truncated=${truncated} hit=${counts.hit} miss=${counts.miss} exhausted=${counts.exhausted} active=${counts.active} plane=${counts.plane}`,
    );
    if (opts.capture !== true) this.lastFrame = { pixels, width, height };
    return {
      pixels,
      width,
      height,
      wallMs: performance.now() - wallStart,
      gpuMs,
      marchMs: marchGpuMs,
      shadeMs: shadeGpuMs,
      passes,
      truncated,
      counts,
    };
  }
}
