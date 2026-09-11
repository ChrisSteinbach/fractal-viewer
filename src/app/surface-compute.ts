/**
 * WebGPU compute renderer for fold, escape, bulb and 4D surface sessions
 * (`{kind:"ifs"|"escape"|"bulb"|"escape4"|"ifs4"}`) — the app integration
 * of the WGSL kernel spike's measured verdict: the march
 * kernel traces mandelboxKifs at ~49µs/ray on the same hardware where the
 * WebGL fragment tracer is unbounded (>1300µs/ray), and compiles in
 * ~0.1-0.3s where the fold GLSL links in ~25s on Mesa (the entry cliff
 * behind the kernel-confirmed i915 preemption hang).
 *
 * A frame is TWO pipelines (an ifs4 session holds two PAIRS: a slab-free
 * variant serves every sliceHalfW=0 frame at a measured 2.2-2.4x kernel
 * discount, the full slab pair any h > 0 frame), both bounded by
 * construction (no submission ever outruns the i915 watchdog): MARCH
 * passes advance every active ray by `stepsThisPass` DE steps (the
 * bench's proven register-light kernel, ray derivation swapped to the
 * GLSL tracer's unproject), with the active list compacted host-side
 * between them FROM 4 B PER ACTIVE RAY (the march status side-channel:
 * the march writes each dispatched ray's status to its own slot in the
 * list being rebuilt, so the sweep no longer reads the whole 16 B/ray
 * states buffer back to look at one field of it — the frame's states
 * never leave the device now, and the terminal tally is kept as rays
 * leave the list); rays that turn terminal join the SHADE QUEUES drained
 * in host-sized batches through the shade kernel (the GLSL tracer's full
 * shading, mirrored term for term). The split is a measured verdict, not
 * taste: shading a freshly-hit ray costs ~40 zero-cutoff on-surface DE
 * evals, and the v1 megakernel — which shaded rays inside whichever march
 * pass terminated them — measured 1.1-5.3s per pass on Iris and LOST THE
 * DEVICE at full depth/budgets (the i915 watchdog through the shading
 * door).
 *
 * Shade batches are sized in HIT units, not ray units (the probe-width
 * verdict's second lesson): only HIT rays pay the on-surface probe evals
 * — miss/exhausted rays write one background pixel — and the queue
 * arrives in scanline order, so cost is spatially CLUSTERED. The original
 * ray-unit doubling grew batch capacity across a run of ~free misses and
 * then submitted thousands of rays straight into a hit band (~108 ms/hit
 * measured full-width near-surface on Iris) — several seconds past the
 * ~7.5 s i915 preemption watchdog, five kernel-confirmed GPU HANGs (ecode
 * 12:1:85dcfffb) in one bench session, and reactive quartering can only
 * react AFTER the killing batch. Now misses drain WHOLE — one dispatch
 * per sweep, no cost cap, since one background write per ray is not a
 * cost to model — and hit batches are sized predictively from a two-term
 * cost model, `intercept + n·marginal` ({@link ShadeHitCost},
 * {@link shadeHitBatchSize}), under a slow-growing capacity cap
 * ({@link nextShadeBatchSize}) that bounds the first encounter with an
 * unmeasured-cost region. THE TWO TERMS ARE THE POINT: a shade dispatch's
 * wall time is flat in its width to at least eight workgroups on Iris, so
 * charging a whole submission's time to its ray count read LATENCY as
 * per-hit work and the sizer walked itself down to the floor — the
 * settle-park trapdoor at every width below the occupancy knee rather
 * than only at n=1.
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
 * of pure helpers (seed tiling, pass sizing) that carry unit tests.
 *
 * Failure taxonomy follows flame-gpu-backend.ts: a context with no usable
 * WebGPU throws {@link SurfaceComputeUnavailableError} (the session routes
 * to the WebGL tracer — THE fallback); anything else (WGSL compile, device
 * creation) is a plain rejection the session treats the same way. The
 * renderer never attempts its own fallback. `device.lost` latches
 * {@link SurfaceComputeRenderer.lost} and fires `onLost` once — the session
 * re-enters via the WebGL path.
 */

import {
  backgroundShapeCode,
  DEFAULT_BACKGROUND_SHAPE,
  DEFAULT_BACKGROUND_SHAPE_CENTER,
  type BackgroundShapeSpec,
} from "../fractal/background-shape";
import type { BulbDE } from "../fractal/bulb-de";
import type { EscapeDE } from "../fractal/escape-de";
import { resolveShapeTrap } from "../fractal/shape-trap";
import type { ResolvedShapeTrap } from "../fractal/shape-trap";
import type { EscapeDE4 } from "../fractal/escape-de-4d";
import {
  shapeMeshIds,
  shapeSpecsMeshIds,
  type ShapeSpec,
} from "../fractal/shapes";
import { activeMeshSdfAtlas } from "../fractal/mesh-sdf-atlas-cache";
import type { MeshAssetId } from "../fractal/mesh-shapes";
import { latticePresentationPolicyOf } from "../fractal/lattice-march";
import {
  isResolvedLatticeTiling,
  resolveTiling,
  type ResolvedTiling,
} from "../fractal/tiling";
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
  packSurfaceGpuSeed,
  packSurfaceGpuShade,
  packSurfaceGpuShadeMaps,
  SURFACE_GPU_LENS4_POST_BYTES,
  SURFACE_GPU_LENS_POST_BYTES,
  SURFACE_GPU_MAP_VEC4,
  SURFACE_GPU_PARAMS4_BALLOON_BYTES,
  SURFACE_GPU_PARAMS4_BALLOON_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS4_BYTES,
  SURFACE_GPU_PARAMS4_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS4_ESCAPE_BYTES,
  SURFACE_GPU_PARAMS4_LENS_BYTES,
  SURFACE_GPU_PARAMS4_PLANE_BYTES,
  SURFACE_GPU_PARAMS4_PLANE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS4_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS4_TRAP_BYTES,
  SURFACE_GPU_PARAMS_BALLOON_BYTES,
  SURFACE_GPU_PARAMS_BALLOON_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS_BYTES,
  SURFACE_GPU_PARAMS_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS_PLANE_BYTES,
  SURFACE_GPU_PARAMS_PLANE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS_PLANE_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS_SCHEDULE_BYTES,
  SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_BYTES,
  SURFACE_GPU_PARAMS_TRAP_BYTES,
  SURFACE_GPU_CHAOS_BYTES,
  SURFACE_GPU_RAY_ACTIVE,
  SURFACE_GPU_RAY_EXHAUSTED,
  SURFACE_GPU_RAY_HIT,
  SURFACE_GPU_RAY_MISS,
  SURFACE_GPU_RAY_PLANE,
  SURFACE_GPU_SEED_PARAMS_BYTES,
  SURFACE_GPU_SEED_WORKGROUP_SIZE,
  SURFACE_GPU_SHADE_BYTES,
  SURFACE_GPU_SHADE_LIGHTING_BYTES,
  SURFACE_GPU_SHADE_LIGHTING_PHASE_OFFSET,
  SURFACE_GPU_SHADE_PATTERN_BYTES,
  SURFACE_GPU_TILING_BYTES,
  surfaceComputeSeedWgsl,
  surfaceDeKernelWgsl,
} from "../fractal/surface-de-gpu";
import {
  deHasFolds,
  SURFACE_FOLD_BEAM_WIDTH,
  type SurfaceDE,
} from "../fractal/surface-de";
import type { SurfaceDE4 } from "../fractal/surface-de-4d";
import type { SurfaceMaterialSlots } from "../fractal/surface-material-wire";
import {
  cloneSurfaceLighting,
  resolveSurfaceLighting,
  SURFACE_LIGHTING_MAX_MEDIUM_SAMPLES,
  surfaceLightingLanes,
  surfaceLightingRuntime,
  type SurfaceLighting,
  type SurfaceLightingRuntime,
} from "../fractal/surface-lighting";
import {
  sampleTraceBackgroundImage,
  type TraceBackgroundImage,
} from "../fractal/surface-background-layer";
import { deHasFolds4, slabExact4 } from "../fractal/surface-de-4d";
import { SURFACE_LENS_SWIRL } from "../fractal/swirl-lens";
import type { ShapeTrap, Vec3 } from "../fractal/types";
import { clamp } from "../fractal/vec";
import { webgpuAdapterStatus } from "./render-backend";

type SurfaceComputeTraceSink = (line: string) => void;

let surfaceComputeTrace: SurfaceComputeTraceSink | null = null;

/** Opt-in frame-loop tracing: captured once per frame at start. */
export function setSurfaceComputeTrace(
  sink: SurfaceComputeTraceSink | null,
): void {
  surfaceComputeTrace = sink;
}

/**
 * Debug-only pins on the frame loop's three sizing dials, read once per
 * frame exactly like the trace sink above: `?surfacemarchchunk=N` forces
 * every march slice to N rays, `?surfacemarchsteps=S` forces the per-ray
 * step budget to S, and `?surfaceshadehits=H` forces every HIT shade
 * batch to H hits — each in place of the measured estimate that normally
 * picks it.
 *
 * THEY EXIST BECAUSE A SIZER CANNOT OTHERWISE BE ASKED ITS OWN QUESTION.
 * Both sizers price a dispatch per unit of work, and a per-unit cost is
 * only meaningful where a dispatch has no large fixed cost — the defect
 * the two-term cost model found on the shade side, where the same
 * statistic was measuring the wrong quantity outright. Deciding that
 * means pricing cost against WIDTH, and the widths a sizer picks are
 * picked BY the estimate under test: "THE TABLE ALONE PROVES NOTHING"
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
 * something to leave in a URL. `?surfacesamples=N` and
 * `?surfacemaxrays=N` are the same shape of escape hatch. Unlike the
 * app's own shareable links, which ride the `#v1=` hash, a diagnostic pin
 * rides a plain query param, so a hostile page can hand a victim a
 * `?surfacemarchsteps=` link and a click into Surface mode buys a single
 * watchdog-tripping dispatch — which is why
 * {@link SURFACE_COMPUTE_MARCH_STEPS_PIN_CAP} bounds this one pin below
 * whatever the sizer would otherwise allow.
 */
/**
 * `?surfacefencegroup=N` — how many dispatches one
 * `onSubmittedWorkDone` round-trip may stand behind, in place of
 * {@link SURFACE_COMPUTE_FENCE_GROUP_MAX} and
 * {@link SURFACE_COMPUTE_FENCE_GROUP_MS} together.
 *
 * IT IS THE FOURTH PIN AND THE ONLY ONE THAT IS ALSO A BEFORE/AFTER
 * SWITCH: `?surfacefencegroup=1` fences every dispatch, which is exactly
 * the loop that shipped before grouping, so the grouping's own A/B runs
 * on ONE build against ONE scene rather than against a remembered number
 * from another checkout. The width pins above cannot do that for their
 * features; this one can, and the measured rows in
 * `docs/surface-compute-renderer.md` were taken through it.
 *
 * The bound it leaves is CANCELLATION DEBT, not the watchdog: every
 * dispatch is still its own submission and still sized by its own model,
 * so a large pin buys a longer queue of individually bounded work rather
 * than one unbounded piece — a laggier Escape, not a hung compositor.
 * Progressive presents and the frame budget still close a group early
 * whatever the pin says.
 */
let surfaceComputeFenceGroupPin: number | null = null;
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
  fenceGroup?: number | null;
}): void {
  surfaceComputeFenceGroupPin = positivePin(pins.fenceGroup);
  surfaceComputeMarchChunkPin = positivePin(pins.marchChunk);
  surfaceComputeMarchStepsPin = positivePin(pins.marchSteps);
  surfaceComputeShadeHitsPin = positivePin(pins.shadeHits);
}

/** Threads per workgroup — the kernel spike's measured winner (private
 * frontier, stage-1 prune only; wg size itself measured a non-factor, 64
 * matches the
 * bench's private-variant default). */
export const SURFACE_COMPUTE_WORKGROUP_SIZE = 64;

/** Frontier width for the shade kernel's PROBE evals — the normal/shadow/
 * AO taps, the probe-width lever: they light a hit the full-width march
 * already certified, never decide geometry, so they ride the width-1
 * greedy descent. MEASURED VERDICT (gpu-bench shade A/B leg, real Iris
 * Xe, mandelboxKifs 96x54, identical 660-hit sets): full-width probe
 * shading 740 s/frame vs 31 s at width 1 (23.8x, thermally understated),
 * and at the hit-dominated near pose the full-width arm cannot even
 * converge a 900 s budget — while the images are eyeball-identical
 * (differences are a slight lightening of deep-crease shadow/AO from the
 * greedy DE's overshoot; 8.1% of pixels differ by >8/255, mean 23.5 on
 * those, no structural artifacts). Rerun via
 * `npm run bench:surface -- --display=:0 --surface-shade-width=1`. */
export const SURFACE_COMPUTE_SHADE_DE_WIDTH = 1;

/** Per-pass GPU-time target the adaptive `stepsThisPass` doubles toward —
 * the bench host loop's own pacing constant. Far under the ~7.5s i915
 * preemption watchdog while keeping pass overhead amortized. */
export const SURFACE_COMPUTE_PASS_TARGET_MS = 250;

/** Cap on DE steps a single dispatch may advance a ray — the bench's own
 * bound; with the full march budget at 160 a frame is never more than a
 * few dozen passes. */
export const SURFACE_COMPUTE_MAX_STEPS_PER_PASS = 32;

/** Ceiling on {@link surfaceComputeMarchStepsPin}: unlike the chunk and
 * hit pins, marchSteps has no downstream `Math.min` — it seeds
 * `stepsThisPass` directly, which rides unmodified into `writeParams` as
 * a per-dispatch DE-steps-per-ray count, so an unclamped pin is the one
 * URL-reachable path past every other sizing dial's safety machinery and
 * into the i915 watchdog. Anchored to a generous multiple of
 * {@link SURFACE_COMPUTE_MAX_STEPS_PER_PASS} — the adaptive scheduler's
 * own ceiling on that same `stepsThisPass` quantity — rather than picked
 * fresh: 128x is a few thousand, far past any legitimate experiment (the
 * full march budget is ~160 steps/ray, spread across many dispatches) and
 * far short of the millions a watchdog trip needed. */
export const SURFACE_COMPUTE_MARCH_STEPS_PIN_CAP =
  SURFACE_COMPUTE_MAX_STEPS_PER_PASS * 128;

/** Default interval between progressive presents of a long frame. */
export const SURFACE_COMPUTE_PROGRESS_MS = 500;

/**
 * How much MEASURED work one fence may stand behind — the compute arm's
 * `SURFACE_STRIP_FENCE_GROUP_MS`, and deliberately the same number,
 * because it is the same trade already made once on the WebGL arm: every
 * sync point on a stack costs the same tax REGARDLESS of the work behind
 * it, so the only lever on that tax is how much work each one carries.
 *
 * WHY IT IS NOT ZERO AND NOT INFINITE. A fenced null dispatch costs
 * 100.960 ms in Firefox against 3.265 ms in Chrome (measured, one real
 * AMD RX 7900 XTX, hardware adapters confirmed in both), and after
 * {@link surfaceComputeDispatchWorkMs} took that constant out of every
 * SIZING decision, what was left of Firefox's 8-11x against Chrome was
 * the per-fence price itself: 150 fences x ~100 ms against a 13.2 s
 * frame. Fencing every dispatch prices a queue-limited sliver — a march
 * tail slice, a free batch that paints backdrop, a hit batch the sweep
 * could only half fill — at a full round-trip for nearly no work.
 * Grouping to a work target fixes exactly those and leaves an expensive
 * dispatch alone: a lane whose dispatches MEASURE at the pass target
 * closes its group at one ({@link surfaceComputeFenceGroupSize}).
 *
 * WHAT IT TRADES AGAINST is why the group is bounded by three things and
 * not just this one. Each dispatch is still its own SUBMISSION, so the
 * i915 preemption boundary is untouched — a group is a fence, not a wider
 * dispatch. But the queued work is cancellation debt and it is present
 * debt, so `runFrame` closes a group early at whichever comes first: this
 * target, {@link SURFACE_COMPUTE_FENCE_GROUP_MAX} dispatches, or the time
 * left before the next progressive present (or the frame budget) falls
 * due.
 */
export const SURFACE_COMPUTE_FENCE_GROUP_MS = 300;

/**
 * Dispatches one fence may stand behind whatever they measure — and THIS
 * IS NOT A TUNING CONSTANT, it is a MEASURED BROWSER CEILING.
 *
 * **FIREFOX LOSES ITS DEVICE AT FOUR.** Measured on this repository's AMD
 * RX 7900 XTX on `DISPLAY=:0`, the fence gate's own fixture, production
 * build: with four or more dispatches queued behind one
 * `onSubmittedWorkDone`, the settle frame's first march sweep raises
 * `Uncaptured WebGPU error: Not enough memory left`, the device is lost,
 * and the session falls back to the WebGL tracer — reproduced at 4 and at
 * 6, and clean at 1, 2 and 3.
 *
 * IT IS A VOLUME, NOT A COUNT, and the earlier reading of this same
 * failure — that it counted DISPATCHES, or the two small writes each one
 * stages — is REFUTED by the app-free reproduction in
 * `scripts/webgpu-staging-ceiling.repro.mjs`. Those two writes add
 * nothing: 0/20 dead with them, 0/20 without. Grow them to 4 MB at the
 * SAME dispatch count and it is 13/20, so the exhausted quantity is the
 * `writeBuffer` STAGING outstanding when the fence falls due — and a
 * frame's own PREFILL dominated it. `runFrame` used to stage `color`,
 * `layer` and `states` once per frame, 24 B/ray unlit and 36 B/ray lit:
 * 5.5 and 8.3 MB at 640x360, 22 and 33 MB at 1280x720, MEGABYTES against
 * the dispatches' 128 KB. Firefox reclaims that staging only on a 100 ms poll
 * (`WebGPUParent`'s `POLL_TIME_MS`, the same tick this repository already
 * measured as its fence round-trip), so a wider group is a longer HOLD
 * rather than a bigger count — the same 8 MB kills 7/20 behind a group of
 * four and 0/20 behind a group of one. The failure is a RATE, so "clean
 * at three" was one run of a cell and never a property of three; and
 * losing the device costs a compute-only session (fold-shaped or
 * escape-shaped 4D) its Surface renderer outright, with no way back — a
 * killed device does not come back in that tab (0 of 20 recoveries, at
 * 3 s as at 0).
 *
 * Chrome tolerates eight — the WebGL arm's own
 * `SURFACE_STRIP_FENCE_GROUP_MAX` — and gains nothing measurable from
 * them, so the cap is the SMALLEST stack's rather than a compromise
 * between them. THE FRAME PREFILL IS NOW SEEDED ON THE DEVICE — one
 * `seedFrame` dispatch (`surface-de-gpu.ts`'s `surfaceComputeSeedWgsl`)
 * replaces the three staged uploads — so the quantity that set this cap is
 * no longer queued. THE CAP IS STILL TWO: removing the cause does not
 * measure what the cap can now be, and raising it waits on the fence gate
 * and the staging repro re-run in the app on Firefox. The ray lists that
 * still scale with the raster are bounded per group by
 * {@link SURFACE_COMPUTE_FENCE_GROUP_STAGED_BYTES}, the second closing rule
 * and what should make raising this safe at any raster. Measured rows:
 * `docs/surface-compute-renderer.md`.
 */
export const SURFACE_COMPUTE_FENCE_GROUP_MAX = 2;

/** The gamma both tracers encode their output with (surface-material.ts's
 * `pow(linBase * lit, 1/2.2)` and its WGSL mirror). Supersampling's
 * averaging has to undo it before summing and reapply it after, or
 * antialiased
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
 * Where inside its pixel sample `s` aims.
 *
 * Sample 0 is the pixel CENTRE exactly, so a supersampled job's first
 * pass reproduces the pre-supersampling frame value for value and every
 * later pass only refines it. The rest walk the R2 low-discrepancy
 * sequence (Roberts' generalized golden ratio) from that centre: a fixed,
 * seedless, well-distributed 2D stratification that needs no state, gives
 * the same offsets for the same `s` on every device, and — unlike a
 * jittered grid — is progressive, so stopping after any number of samples
 * still leaves an evenly covered pixel.
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
    out[p] = Math.round(255 * Math.pow(clamp(accum[a] * inv, 0, 1), invGamma));
    out[p + 1] = Math.round(
      255 * Math.pow(clamp(accum[a + 1] * inv, 0, 1), invGamma),
    );
    out[p + 2] = Math.round(
      255 * Math.pow(clamp(accum[a + 2] * inv, 0, 1), invGamma),
    );
    out[p + 3] = alpha[p + 3];
  }
  return out;
}

/** Encode one linear HDR readback for presentation. The GPU values remain
 * unclipped until the progressive sample mean is formed; RGBA8 conversion
 * never feeds back into lighting accumulation. */
export function encodeSurfaceComputeHdr(
  linear: Float32Array,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(linear.length);
  const invGamma = 1 / SURFACE_OUTPUT_GAMMA;
  for (let p = 0; p < out.length; p += 4) {
    for (let c = 0; c < 3; c++) {
      out[p + c] = Math.round(
        255 * Math.pow(clamp(linear[p + c], 0, 1), invGamma),
      );
    }
    out[p + 3] = 255;
  }
  return out;
}

/** Decode the exact integer diagnostic carried in HDR.w by lighting kernels. */
export function surfaceComputeLightingVisibility(linear: Float32Array): {
  exhausted: number;
  invalid: number;
} {
  let exhausted = 0;
  let invalid = 0;
  for (let p = 3; p < linear.length; p += 4) {
    const packed = linear[p];
    if (!Number.isFinite(packed)) {
      invalid++;
      continue;
    }
    exhausted += packed % 65536;
    invalid += Math.floor(packed / 65536);
  }
  return { exhausted, invalid };
}

/** Fold one packed layer sample into the supersample accumulators. RGB are
 * scalar coefficients and sum arithmetically. Alpha is monotonic signed CoC,
 * so the nearest COVERED sample wins; uncovered sentinel 255 never masks a
 * real surface and an all-uncovered pixel remains 255. Exported as the small
 * pure seam that pins this presentation-metadata rule without a GPU. */
export function foldSurfaceComputeLayerSample(
  accum: Float32Array,
  frontmostCoc: Uint8Array,
  layer: Uint8Array,
): void {
  for (let i = 0, p = 0, a = 0; i < frontmostCoc.length; i++, p += 4, a += 3) {
    accum[a] += layer[p];
    accum[a + 1] += layer[p + 1];
    accum[a + 2] += layer[p + 2];
    if (layer[p] > 0 && layer[p + 3] < frontmostCoc[i]) {
      frontmostCoc[i] = layer[p + 3];
    }
  }
}

/** Average packed layer-sidecar RGB bytes in their own scalar space and
 * attach the front-most signed CoC selected by
 * {@link foldSurfaceComputeLayerSample}. */
export function encodeSurfaceComputeLayerMean(
  accum: Float32Array,
  taken: number,
  frontmostCoc: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(frontmostCoc.length * 4);
  const inv = 1 / taken;
  for (let i = 0, p = 0, a = 0; i < frontmostCoc.length; i++, p += 4, a += 3) {
    out[p] = Math.round(accum[a] * inv);
    out[p + 1] = Math.round(accum[a + 1] * inv);
    out[p + 2] = Math.round(accum[a + 2] * inv);
    out[p + 3] = frontmostCoc[i];
  }
  return out;
}

/** A context with no usable WebGPU at all (`navigator.gpu` missing, or no
 * compatible adapter) — the session's signal to route to the WebGL tracer
 * without noting an error. */
export class SurfaceComputeUnavailableError extends Error {}

/**
 * A raster this device cannot allocate a frame's buffers for: past its
 * own `maxBufferSize`/`maxStorageBufferBindingSize`, or refused by the
 * allocator. Thrown BEFORE the kernels ever see it, because WebGPU does
 * not throw here on its own — an over-limit `createBuffer` returns an
 * INVALID buffer plus a validation error, and the first thing that
 * rejects is the staging `mapAsync`, whose "Invalid buffer" says nothing
 * about the size that caused it (the field report that found this, from a
 * 4x export).
 */
export class SurfaceComputeFrameSizeError extends Error {}

/**
 * What one compute session traces: an IFS attractor descent (the fold and
 * fold-lens classes, `SurfaceDE` frozen at enter), an escape-time forward
 * orbit (`EscapeDE`, the systems `analyzeEscapeSystem` admits — the IFS
 * gate's complement), a Mandelbulb forward orbit (`BulbDE`, the systems
 * `analyzeBulbSystem` admits; structurally the escape kind one formula
 * over, so every branch below that names "escape" names this too), or a
 * 4D IFS descent (`SurfaceDE4`, the 4D cut — the systems
 * `analyzeSurfaceSystem4` admits; its rotor/slice VIEW is per-frame SPEC
 * state, never frozen here). The kind picks the kernel core, the params
 * packer and the maps buffer's layout; everything else — the bounded
 * march/shade host loop, the progressive presents, the failure ladder —
 * is shared.
 *
 * A fifth kind: a 4D escape-time forward orbit (`EscapeDE4`, the systems
 * `analyzeEscapeSystem4` admits — the 4D IFS gate's complement), which is
 * the first target that is BOTH forward and 4D. It takes the ifs4 kind's
 * per-frame `view4` and its `GpuMap4` maps layout, and the escape kind's
 * everything-else.
 *
 * An `ifs`/`ifs4` target's `balloon` flag, lifted to 4D with the rest,
 * compiles the kernels with the balloon inverted-union wrapper over
 * whichever core/lens the DE picks; the live balloon parameters then ride
 * every frame's spec (`SurfaceComputeFrameSpec.balloon` — the R slider's
 * live-per-frame door, view4's discipline). No FORWARD kind ever sets it
 * (the codegen throws for all three: a filled solid's echo swallows the
 * camera — the balloon's measured verdict for the escape solid,
 * re-measured on the Mandelbulb).
 */
export type SurfaceComputeTarget =
  | {
      kind: "ifs";
      de: SurfaceDE;
      balloon?: boolean;
      groundPlane?: boolean;
      tiling?: ResolvedTiling;
    }
  | {
      kind: "escape";
      de: EscapeDE;
      groundPlane?: boolean;
      tiling?: ResolvedTiling;
      /** The shape-trap channel's CREATE-TIME geometry (`AppState.shapeTrap`'s
       * shape): compiles the trap accumulator + baked SDF into the kernels
       * and grows their params struct; the LIVE pose/mode block then rides
       * every frame's spec (`SurfaceComputeFrameSpec.shapeTrap`). The three
       * FORWARD kinds only — the trap is the escape family's color channel
       * (the codegen throws for every descent core). */
      shapeTrap?: ShapeSpec;
      /** Optional marching use of that same baked shape. The live pose rides
       * the frame trap block; only the normalized enable/band compile here. */
      shapeTrapGeometry?: Pick<
        ResolvedShapeTrap,
        "geometry" | "geometryLevelMin" | "geometryLevelMax"
      >;
    }
  | {
      kind: "bulb";
      de: BulbDE;
      groundPlane?: boolean;
      tiling?: ResolvedTiling;
      shapeTrap?: ShapeSpec;
      shapeTrapGeometry?: Pick<
        ResolvedShapeTrap,
        "geometry" | "geometryLevelMin" | "geometryLevelMax"
      >;
    }
  | {
      kind: "escape4";
      de: EscapeDE4;
      groundPlane?: boolean;
      tiling?: ResolvedTiling;
      shapeTrap?: ShapeSpec;
      shapeTrapGeometry?: Pick<
        ResolvedShapeTrap,
        "geometry" | "geometryLevelMin" | "geometryLevelMax"
      >;
    }
  | {
      kind: "ifs4";
      de: SurfaceDE4;
      balloon?: boolean;
      groundPlane?: boolean;
      tiling?: ResolvedTiling;
    };

/** The FORWARD-orbit kinds (escape, bulb, escape4): a forward orbit
 * rather than an inverse descent, so no descent lens and no frontier
 * width — and the same session-shaping consequences everywhere the host
 * loop asks "is this a descent?". Named once so a fourth forward core
 * cannot be added to one branch and missed in another.
 *
 * NOT "no maps buffer": the two ESCAPE kinds carry their formula chain on
 * the maps binding, so every maps-shaped branch names them before it
 * reaches this predicate — bulb is the one bindingless
 * kind. */
export function isForwardTarget(target: SurfaceComputeTarget): target is
  | {
      kind: "escape";
      de: EscapeDE;
      groundPlane?: boolean;
      shapeTrap?: ShapeSpec;
      shapeTrapGeometry?: Pick<
        ResolvedShapeTrap,
        "geometry" | "geometryLevelMin" | "geometryLevelMax"
      >;
    }
  | {
      kind: "bulb";
      de: BulbDE;
      groundPlane?: boolean;
      shapeTrap?: ShapeSpec;
      shapeTrapGeometry?: Pick<
        ResolvedShapeTrap,
        "geometry" | "geometryLevelMin" | "geometryLevelMax"
      >;
    }
  | {
      kind: "escape4";
      de: EscapeDE4;
      groundPlane?: boolean;
      shapeTrap?: ShapeSpec;
      shapeTrapGeometry?: Pick<
        ResolvedShapeTrap,
        "geometry" | "geometryLevelMin" | "geometryLevelMax"
      >;
    } {
  return (
    target.kind === "escape" ||
    target.kind === "bulb" ||
    target.kind === "escape4"
  );
}

/** Built-in mesh assets whose conservative atlas the frozen session reads. */
export function surfaceComputeTargetMeshIds(
  target: SurfaceComputeTarget,
): MeshAssetId[] {
  if (isForwardTarget(target)) {
    return target.shapeTrap ? shapeMeshIds(target.shapeTrap) : [];
  }
  const shapes =
    target.de.condensation?.emitters.map((emitter) => emitter.shape) ?? [];
  return shapeSpecsMeshIds(shapes);
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
  | {
      kind: "escape4";
      de: EscapeDE4;
      groundPlane?: boolean;
      shapeTrap?: ShapeSpec;
    } {
  return target.kind === "ifs4" || target.kind === "escape4";
}

/** Everything one frame needs beyond the session-frozen DE: raster size,
 * camera, tier budgets, live lighting/color params. Assembled by scene.ts
 * (`surfaceComputeFrameSpec`) so the eps discipline stays in one place:
 * `acceptPixelEps` derives from the NATIVE buffer height (a preview
 * coarsens sampling, never acceptance), `tracePixelEps` from the
 * trace raster's own height (dither + normal probe scale). */
export interface SurfaceComputeFrameSpec {
  width: number;
  height: number;
  /** Column-major inverse(projection * view) — THREE.Matrix4.elements of
   * the exact matrix the GLSL tracer gets as uInvProjView. */
  invProjView: Float32Array;
  camPos: Vec3;
  /** Normalized camera forward in world space. The shade kernel projects
   * covered hit positions onto it to derive camera-space depth. */
  camForward: Vec3;
  /** Camera-space depth of the active Surface framing/enclosing-ball centre. */
  focusDepth: number;
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
  /** Optional authored lighting. Presence is a session compile gate; values
   * are live and copied when renderFrame is requested. */
  lighting?: SurfaceLighting;
  /** Shared quality policy from surfaceLightingRuntime. The renderer owns
   * phase scheduling and advances sampleIndex for every progressive sample. */
  lightingRuntime?: SurfaceLightingRuntime;
  /** Immutable, top-origin authored image used directly by lit rays. The
   * full-image coordinates also apply when this frame is a capture band. */
  lightingBackground?: TraceBackgroundImage;
  /** Environment-light strength — the ShadeParams tail (module doc in
   * `fractal/surface-de-gpu.ts`): how far the shade kernel's AMBIENT term
   * is tinted toward the backdrop sampled along the normal. Optional so
   * callers predating this feature (gpu-bench's spec literals) keep
   * compiling; absent/0 is the bit-exact untinted
   * identity, matching {@link packSurfaceGpuShade}'s own default. */
  envLight?: number;
  /** The scene backdrop's two gradient stops — the pair the GLSL tracers
   * carry as uBgTop/uBgBottom, fed to the shade kernel's miss/fog
   * gradient AND the device-side frame seed (both read ShadeParams),
   * re-read per spec assembly like the lighting. */
  bgTop: Vec3;
  bgBottom: Vec3;
  /** The traced raster's pixel offset within, and pixel size of, the FULL
   * image — `fractal/background-shape.ts`'s coordinate contract,
   * forwarded to the shade kernel's `bgOffset`/`bgExtent`, which the
   * device-side frame seed reads too. OPTIONAL here,
   * unlike {@link packSurfaceGpuShade}'s own required fields: the
   * renderer knows the frame's own raster, so an absent pair defaults to
   * offset `(0, 0)` and extent equal to `(width, height)` above — an
   * ordinary frame — which is what keeps gpu-bench's spec literals
   * compiling unchanged. A capture band passes both explicitly. */
  bgOffset?: [number, number];
  bgExtent?: [number, number];
  /** The shared background shape — `fractal/background-shape.ts`'s
   * `BackgroundShapeSpec`, forwarded to the shade kernel's
   * `bgShape`/`bgCenter`/`bgScale`, which the device-side frame seed
   * reads too. OPTIONAL, same
   * discipline as `bgOffset`/`bgExtent`: absent defaults to `{kind:
   * "linear"}`, keeping gpu-bench's spec literals compiling unchanged. A
   * radial shape's `scale` must already be `backgroundRadialScale` of the
   * FULL image `bgExtent` names — see `scene.ts`'s
   * `surfaceComputeFrameSpecAt`. */
  bgShape?: BackgroundShapeSpec;
  /** Index into SURFACE_COLOR_SOURCES — the shader's dispatch integer. */
  colorSource: number;
  colorSpeed: number;
  /** 256x4 RGBA bytes (scene.ts's Uint8-quantized ramp), or null for the
   * transform color source (a white LUT is bound, never sampled). */
  lut: Uint8Array | null;
  /** Monotonic version so the renderer re-uploads the LUT texture only
   * when the ramp actually changed. */
  lutVersion: number;
  /** Independent balloon 256x4 RGBA palette bytes. `null`/absent is explicit
   * inherit; non-balloon targets ignore it and allocate no second texture. */
  balloonLut?: Uint8Array | null;
  /** Monotonic balloon-LUT revision, independent of the primary surface LUT. */
  balloonLutVersion?: number;
  dither: boolean;
  /** The 4D session's LIVE view: the same (rotor, w0, sliceHalfW) triple
   * `setSurfaceView4` receives, re-read from scene state at every spec
   * assembly — the spec is rebuilt per renderFrame, which is exactly what
   * keeps the rotor/slice as live as the camera. REQUIRED for an `ifs4`
   * target (runFrame throws without it — a 4D frame with no pose is a
   * contract bug, not a default); ignored for
   * the 3D kinds. */
  view4?: SurfaceGpu4View;
  /** The balloon session's LIVE inverted-union parameters:
   * `buildBalloon`'s convention — center + MARGINED rho (the bound's
   * divisor), R in world units — plus the march far cap
   * (`BALLOON_FAR_CAP_RHO · raw ball radius`). Re-read from scene state
   * at every spec assembly so the R slider is live per-frame, exactly
   * view4's rotor/slice discipline across the WebGPU seam. REQUIRED when
   * the session's target was created with `balloon: true` (runFrame
   * throws without it — the balloon kernel's params struct is 320 bytes
   * and has no meaningful default); ignored otherwise. */
  balloon?: { center: Vec3; rho: number; R: number; far: number };
  /** Depth-fog density multiplier — the WGSL params struct's former pad1
   * slot (module doc in `fractal/surface-de-gpu.ts`), re-read from scene
   * state at every spec assembly like the rest of this interface.
   * Defaults to 1 (the fixed fog it replaced) when omitted,
   * matching {@link SurfaceGpuRunParams.fogDensity}'s own default. */
  fogDensity?: number;
  /** Fog tint color — the ShadeParams tail (module doc in
   * `fractal/surface-de-gpu.ts`): the shade kernel's fog blends toward
   * mix(bg, fogTint, fogTintStrength); re-read from scene state at every
   * spec assembly like fogDensity. Defaults to [1, 1, 1] when omitted,
   * matching {@link packSurfaceGpuShade}'s own default. */
  fogTint?: Vec3;
  /** Fog tint strength, 0..1 — 0 (the default when omitted, matching
   * {@link packSurfaceGpuShade}) is the identity: fog toward the pixel's
   * own backdrop color alone; misses keep the pure untinted
   * backdrop either way. */
  fogTintStrength?: number;
  /** The balloon echo's tint color — the ShadeParams tail (module doc in
   * `fractal/surface-de-gpu.ts`): a SHELL hit's base albedo mixes toward
   * it before lighting, so the inverted copy reads as an echo rather than
   * as more of the same object. Re-read from scene state at every spec
   * assembly like fogTint. Defaults to [0, 0, 0] when omitted, matching
   * {@link packSurfaceGpuShade}'s own default — the document's
   * `DEFAULT_BALLOON_TINT`, black, which is what makes the strength
   * slider alone a dimmer. Unread by a session
   * whose target was created without `balloon: true`. */
  balloonTint?: Vec3;
  /** The balloon echo's tint strength, 0..1 — 0 (the default when
   * omitted, matching {@link packSurfaceGpuShade}) is the identity,
   * `mix(x, y, 0)` = x, so an unset pair renders the pre-tint frame byte
   * for byte. The kernel gates it per-ray on the union argmin, so a
   * FRACTAL-term hit is untouched at any strength. */
  balloonTintStrength?: number;
  /** The session's unified per-slot materials — CREATE-TIME state (the
   * `create()` opts' `materials`, packed into the shadeMaps buffer once),
   * disclosed on the spec so the offline force-frame memo key
   * (`surface-force-frame-key.ts`) changes when a timeline leg's document
   * authors different finish or pattern fields under a parked camera. The
   * renderer itself deliberately never reads it — a material edit reaches a live session
   * through the same session re-enter a color edit takes — so this is
   * `lutVersion`'s role without the counter: the values themselves are
   * the version. Absent exactly when the session compiled the classic
   * (material-less) kernels, matching the packer's absent default. */
  materials?: SurfaceMaterialSlots;
  /** Ground plane block — REQUIRED whenever the session's target carried
   * `groundPlane: true` (the kernels' 336-byte params struct has no
   * meaningful default; view4/balloon's required-throw discipline),
   * ignored otherwise. Re-derived from scene state at every
   * spec assembly like the balloon block. */
  groundPlane?: SurfaceGpuGroundPlane;
  /** The shape-trap DOCUMENT block — REQUIRED whenever the session's
   * target carried `shapeTrap` (the trap-grown params struct has no
   * meaningful default; the balloon's required-throw discipline), ignored
   * otherwise. The whole block rather than pre-resolved numbers: the LIVE
   * half (pose/mode/threshold/fade) is resolved at pack through
   * `resolveShapeTrap` — the one domain — and the SHAPE half, though
   * create-time on the renderer, rides along so the offline force-frame
   * memo key sees a shape swap under a parked camera
   * (surface-force-frame-key.ts's hazard doc). Re-read from scene state at
   * every spec assembly, so a trap pose slider is live per frame. */
  shapeTrap?: ShapeTrap;
}

export interface SurfaceComputeFrameOptions {
  /** Wall-clock cap for the whole frame; rays still active when it runs
   * out keep their device-seeded backdrop and the frame reports
   * `truncated`. */
  budgetMs?: number;
  /** This frame is an off-canvas CAPTURE (a Save-PNG tile), not the live
   * pane: it neither seeds from the last live frame nor becomes the seed
   * for the next one. Both directions would be wrong — an export traces a
   * different raster (and, tiled, a BAND of a different image), and it
   * needs no seed at all, having no wall budget to leave rays
   * unresolved by. */
  capture?: boolean;
  /** Progressive present: called with the immutable legacy RGBA reference
   * plus its packed RGBA layer sidecar at most
   * every `progressIntervalMs` while rays are still marching. `done` /
   * `total` are ray-work tallies from `surfaceComputeProgressDone`: a
   * ray's march half accrues CONTINUOUSLY with its consumed steps and
   * lands in full on going terminal; the shade half lands once its pixel
   * is shaded. The render-backend disclosure hook: main.ts drives the
   * surface progress row from them, so a compute settle reports honest
   * coverage the way the WebGL strip path's `surfaceRenderProgress()`
   * does. `done` may be fractional. */
  onProgress?: (
    pixels: Uint8Array,
    layers: Uint8Array,
    done: number,
    total: number,
  ) => void;
  progressIntervalMs?: number;
  /**
   * Samples per pixel. `1` — the default and every preview's value — is
   * the pre-supersampling path, call for call.
   *
   * WHY IT IS N FRAMES AND NOT N RAYS. Supersampling measured the
   * escape-time speckle as sub-pixel structure the marcher cannot reach:
   * partial coverage at 16 spp is 8-13% of the object's pixels against a
   * unit sphere's 1.31%, and its exponent against output resolution is
   * -0.21..-0.36 where the sphere measures the perimeter law at -0.98, so
   * no viewport resolves it. The fix is samples, not pixels. Widening a
   * frame to N rays per pixel would multiply the eight per-ray buffers and
   * meet the device ray ceiling N times sooner; tracing N FRAMES at N
   * sub-pixel offsets and averaging costs the same GPU work, keeps every
   * buffer and every watchdog bound exactly as measured, and makes the
   * result PROGRESSIVE — sample 0 is the pre-supersampling image,
   * arriving when it always did, and each later one only improves it. A
   * superseded job keeps the samples it finished.
   */
  samples?: number;
}

export interface SurfaceComputeFrame {
  /** RGBA8, row 0 = bottom (the kernel's py=0 row is ndcY=-1), matching
   * an unflipped DataTexture under the shared blit quad. */
  pixels: Uint8Array;
  /** RGBA8 presentation sidecar, row order matching {@link pixels}: R
   * coverage, G fog, B beta, A signed CoC (focus 128, near-to-far monotonic;
   * uncovered/active/miss/exhausted 255). `pixels` stays the byte-identical
   * traced reference; presentation may combine the pair without retracing. */
  layers: Uint8Array;
  width: number;
  height: number;
  wallMs: number;
  /** Measured compute-submission time (excludes readbacks) — the honest
   * cost sample for the preview governor. */
  gpuMs: number;
  /** March / shade portions of {@link gpuMs} — the probe-width verdict
   * split: shading dominance is the measured lever the shade probe width
   * targets, so the two costs stay separately visible. */
  marchMs: number;
  shadeMs: number;
  passes: number;
  truncated: boolean;
  /** Final ray-status tallies — how the frame's rays ended (`active` is
   * nonzero only on truncated frames). Field-debuggability: an
   * exhausted-dominated frame means the march budget ran dry, a
   * miss-dominated one that rays left the visible sphere; `plane` counts
   * misses the march classified onto the ground plane (always 0 without a
   * plane target). Kept as rays LEAVE the active list — `active` is the
   * remainder — where it used to be a
   * final scan of a ray-state buffer the frame loop no longer reads. */
  counts: {
    hit: number;
    miss: number;
    exhausted: number;
    active: number;
    plane: number;
  };
  /** Bottom-row-first raster indices for every terminal exhausted ray. */
  exhaustedIndices: readonly number[];
  /** Conservative visibility refusals over completed lighting samples.
   * Recorded by the lit shader without another per-ray storage buffer. */
  lightingVisibility?: { exhausted: number; invalid: number };
}

/** Internal sample payload: retained until runSamples has added its raw
 * radiance, never reconstructed from the clipped presentation pixels. */
interface SurfaceComputeSample extends SurfaceComputeFrame {
  linearPixels?: Float32Array;
}

/** One dispatch of the frame seed: the pixel its workgroup (0, 0) starts at
 * and its 2D workgroup counts. */
export interface SurfaceComputeSeedDispatch {
  originX: number;
  originY: number;
  groupsX: number;
  groupsY: number;
}

/**
 * The frame seed's dispatches (`surface-de-gpu.ts`'s
 * `surfaceComputeSeedWgsl`, which writes `color`, `layer` and `states` on
 * the device) for a `width x height` raster: ONE 2D dispatch of
 * {@link SURFACE_GPU_SEED_WORKGROUP_SIZE}-square workgroups, tiled only
 * where a side would need more than the device's
 * `maxComputeWorkgroupsPerDimension` — 1,048,560 pixels a side at the spec
 * minimum, so every real raster is one tile. An empty raster needs none.
 * Pure, so the tiling arithmetic is unit-tested.
 */
export function surfaceComputeSeedDispatches(
  width: number,
  height: number,
  limits: { maxComputeWorkgroupsPerDimension: number },
): SurfaceComputeSeedDispatch[] {
  const edge = SURFACE_GPU_SEED_WORKGROUP_SIZE;
  const tile =
    Math.max(1, Math.floor(limits.maxComputeWorkgroupsPerDimension)) * edge;
  const dispatches: SurfaceComputeSeedDispatch[] = [];
  for (let originY = 0; originY < height; originY += tile) {
    for (let originX = 0; originX < width; originX += tile) {
      dispatches.push({
        originX,
        originY,
        groupsX: Math.ceil(Math.min(tile, width - originX) / edge),
        groupsY: Math.ceil(Math.min(tile, height - originY) / edge),
      });
    }
  }
  return dispatches;
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
 * in one bounded dispatch once the measured cost allows it. Hit-only
 * since the free/hit drain split: the FREE queue has no cost model to cap
 * (see the free-batch comment in `runFrame`), and one constant standing
 * for both queues is
 * what let a MEAN over them be read as a finding. */
export const SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH = 4096;

/** First hit-batch CAPACITY of a frame — deliberately minimal: even at
 * the worst per-hit cost measured on Iris (~250 ms full-width probes at a
 * near-surface silhouette), one workgroup's worth of hits stays well
 * under the ~7.5 s i915 watchdog while the frame's first measurements
 * come in (the wall doesn't scale with batch size inside a workgroup —
 * see {@link shadeHitBatchSize}). Floored at
 * {@link SURFACE_COMPUTE_WORKGROUP_SIZE} rather than lower: starting
 * below one workgroup couldn't reduce per-submission wall either, and it
 * only kept the first hit batches measuring in the degenerate regime that
 * fed the old floor's trapdoor.
 *
 * THIS IS ALSO THE WHOLE COST PRIOR. A frame opens with an EMPTY cost
 * model ({@link ShadeHitCost} zeroed) rather than a pessimistic per-hit
 * guess, because a prior on top of this cap could only make the first
 * batches smaller than one workgroup — which the floor forbids anyway —
 * while costing the frame a long climb back out of it (the old 20 ms/hit
 * prior decayed at 0.4 per dispatch and held ~7 dispatches at the floor
 * before the measurements it was guarding against could speak).
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
 * that much anyway, which is the settle-park trapdoor rebuilt inside its
 * own replacement. That squeeze has to sit OUTSIDE the range real scenes
 * measure in, and mandelboxKifs — the hardest scene this project has —
 * measures its intercept between 430 and 960 ms. At 1 s the squeeze bit
 * that scene directly (its allowance fell to 38 ms and the sizer floored
 * at one workgroup while a 500-hit batch would have cost 4% more); at 2 s
 * it does not bite until a dispatch's FIXED cost alone is a watchdog
 * conversation, where declining to add work is the right
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
 * what the two-term model shipped, that is 512 hits on every scene in the
 * project; at 7 it is 3584. Read as an UPPER BOUND: the marginal's decay
 * floor takes the ratio below the pivot whenever a dispatch measures
 * under half its prediction, which a queue-limited sliver reaches
 * routinely, and the width then lands under it — the shipped kaleido4
 * settle reports 3583 at its widest and a 2464 mean. That is the same
 * non-answer about the scene from a different arbitrary number, and it
 * errs narrow.
 *
 * SEVEN, MEASURED (real Iris Xe / Mesa 25.2.8, kaleido4 — two maps at
 * kaleidoscope order 6 — 1024x640, production build, identity rotor, one
 * fresh session per cell, hit batch FORCED via `?surfaceshadehits=N` so
 * the width is independent of the model under test). One settle frame
 * shades the same ~32.3k hits at every width, so ms/frame is the
 * comparison:
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
 * terminals (the ground plane queues them WITH the hits, and they shade
 * analytically) landing on a model converged to expensive fold hits reads
 * as exactly that surprise — and it is the probe-width lesson's "a cheap
 * run inflates the capacity a hit band then pays" re-opened one level up,
 * in the cost model rather than in the queue. Halving bounds the next
 * batch at twice the last, which is the rate the capacity ladder already
 * enforces, and it costs nothing measured: the marginal's per-dispatch
 * moves during a real convergence are a few percent (169.9 -> 159.9 µs
 * over the whole
 * boxfold-pair climb). */
export const SURFACE_COMPUTE_SHADE_MARGINAL_DECAY = 0.5;

/** Batch width at which one hit-dispatch measurement is half about the
 * per-dispatch INTERCEPT and half about the per-hit MARGINAL cost — the
 * attribution pivot in {@link nextShadeHitCost}. 512 = eight workgroups,
 * which is where the two-term model measured the cost-vs-width curve
 * still flat on Iris Xe (87.2 -> 136.2 ms per dispatch while hits per
 * dispatch rose ~11x): below it a measurement is nearly all fixed cost,
 * above it the marginal term is what moved.
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
 * The hit-shade cost model: `cost(n) = intercept + n·marginal`, in µs,
 * for a dispatch of `n` HIT rays.
 *
 * The two terms are physically different things and conflating them is
 * the defect this type exists to name. `interceptUs` is what a dispatch
 * costs before any width — the batch's DEEPEST ray, since lanes run in
 * parallel across EUs, so a 16-hit batch and a 512-hit batch of the same
 * scanline band cost about the same. `marginalUs` is what each extra hit
 * adds once past that. The model's own run measured the intercept at ~88
 * ms and the marginal at ~0.15 ms/hit on the boxfold pair: dividing a
 * whole submission's time by its ray count called that 5.2 ms PER HIT at
 * n=16, the sizer divided the pass target by the inflated number, picked
 * another small batch, and re-measured the same inflation — the
 * settle-park trapdoor at every width below the occupancy knee rather
 * than only at n=1.
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
 * leaves ~225 ms of hits to buy). Above it, it is the whole point of the
 * two-term model — spend on hits in proportion to the fixed cost already
 * being spent: a dispatch whose intercept alone is 400 ms cannot be made
 * cheaper by shrinking it, so refusing to widen it past the pass target
 * buys no safety and costs an order of throughput (64 hits for 432 ms
 * against 800 hits for 800 ms — the same work ~12x faster).
 *
 * K IS {@link SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST} AND IT IS A
 * WIDTH, not a ratio the scene has any say in — see that constant for the
 * identity that makes it one, and for the measured table that picked 7.
 * The model as first shipped used 1, which held every scene in the
 * project at 512 hits per dispatch and, on the one measured here, made
 * 90% of every hit dispatch fixed cost.
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
 * The leading fence(s) a calibration issues and does NOT hand to
 * {@link surfaceComputeFenceRoundTripMs} — they exist to put every COUNTED
 * probe at the phase a real dispatch actually lands at, rather than at a
 * cold, random phase of Firefox's polling tick.
 *
 * MEASURED (`scripts/webgpu-fence-phase.repro.mjs`, 20 reps, real AMD RX
 * 7900 XTX): a session's very first-ever fence lands at a roughly uniform
 * phase of Firefox's ~100 ms `onSubmittedWorkDone` poll (min/median/max
 * 11/54.5/99 ms), while every fence submitted right after one that just
 * resolved must wait a near-full tick (99/100/112 ms) — it starts right
 * after the tick fired. So a probe run that starts timing on the very
 * first dispatch samples a DIFFERENT, faster population than the one
 * every real frame-loop dispatch belongs to. One throwaway fence is
 * enough to land the session on that same tick-aligned phase, so the
 * count stays 1: its own timing is discarded, not averaged away.
 */
export const SURFACE_COMPUTE_FENCE_ALIGNMENT_PROBES = 1;

/**
 * How many COUNTED null dispatches a session times, after the alignment
 * fence(s) above, to learn its own fence round-trip. Small, because the
 * calibration is paid at the very latency it is measuring — MEASURED at
 * five probes: ~12 ms on Chrome and ~0.50 s on Firefox, once per session,
 * against the minutes the subtraction saves there; the alignment fence
 * adds one more round-trip to each. More than one, because {@link surfaceComputeFenceRoundTripMs}
 * still takes the MINIMUM of the counted probes for jitter — the
 * alignment fence removes the one high-variance draw (a cold fence at a
 * random tick phase) a smaller count used to need, but does not make the
 * counted probes identical.
 */
export const SURFACE_COMPUTE_FENCE_PROBES = 5;

/**
 * The session's fence round-trip from its calibration probes: the
 * MINIMUM of the COUNTED probes — every sample after the leading
 * {@link SURFACE_COMPUTE_FENCE_ALIGNMENT_PROBES} alignment fence(s),
 * which this function discards unconditionally — not the median or the
 * mean, because the two directions of error here are not symmetric.
 *
 * UNDER-stating the round-trip leaves part of a fixed cost in the number
 * the models read, which is the bug this whole path exists to shrink and
 * is bounded by how much was left. OVER-stating it is the dangerous
 * direction: {@link surfaceComputeDispatchWorkMs} floors at zero, so an
 * over-stated constant makes every dispatch read cheaper than it was, and
 * {@link nextShadeHitCost} takes that reading DIRECTLY — once the model
 * is calibrated the capacity ladder above it binds nothing, so on that
 * path there is no doubling-per-dispatch pace protecting anything, only
 * {@link SURFACE_COMPUTE_SHADE_MARGINAL_DECAY}'s halving per update.
 *
 * THE LEADING PROBE USED TO BE COUNTED, AND IT WAS A DIFFERENT
 * POPULATION. Firefox resolves `onSubmittedWorkDone` only on a ~100 ms
 * polling tick (Mozilla bug 1870699), not at submit time. A session's
 * very first fence is submitted at whatever random phase of that tick the
 * app happens to reach it — MEASURED roughly uniform on (0, 100] — while
 * every fence submitted right after one that just resolved must wait a
 * near-full tick (~99-112 ms), because it starts right after the tick
 * fired. Timing probes back-to-back from a cold start therefore drew
 * probe #1 from the FAST population and every later probe from the SLOW
 * one, and the minimum of the run was overwhelmingly probe #1's
 * random-phase draw rather than a stable platform constant — CONFIRMED
 * both app-free (`scripts/webgpu-fence-phase.repro.mjs`: probe #1 was the
 * minimum of the first five probes in 20/20 reps) and in-app
 * (`scripts/surface-fence-cost.verify.mjs`: probe #1 was the reported
 * minimum in all 9 runs, including one calibration of
 * 16.42 ms against four neighboring probes at 100.1-100.6 ms whose
 * under-subtraction pinned a lit capacity ladder at the one-workgroup
 * floor for a 121,519 ms settle). So the statistic was sampling a
 * DIFFERENT population from the one it gets subtracted from —
 * {@link SURFACE_COMPUTE_FENCE_ALIGNMENT_PROBES} fixes that upstream, by
 * paying one throwaway fence before any COUNTED probe, so every counted
 * sample lands at the same tick-aligned phase a real dispatch does.
 *
 * THE BOUND THAT MAKES SUBTRACTING A ~FULL TICK SAFE: a tick-aligned probe
 * (near-zero host delay) is the LARGEST fence a tick-aligned dispatch can
 * ever be charged, so the aligned minimum cannot exceed one tick. A real
 * dispatch that lands with some host delay `d` after the previous fence
 * reads up to `d` cheaper than that minimum, so
 * `workMs = max(0, wallMs - fenceMs)` under-reads true work by less than
 * one tick — the residue this file has always claimed is "bounded by one
 * fence quantum" (see {@link surfaceComputeDispatchWorkMs}), now actually
 * true of the population being measured, where a random-phase draw could
 * previously leave up to a whole extra tick in every reading.
 *
 * The probes are still back-to-back on a COLD device on a session's first
 * frame, so the outliers a small COUNTED sample really carries are HIGH
 * ones — exactly the ones a median admits and a minimum rejects. The
 * floor is also the honest quantity: the round-trip is a per-fence price
 * every dispatch pays at least once, so the smallest pure round-trip
 * observed is the most that can be attributed to it without attributing
 * work.
 *
 * An empty COUNTED sample set — no samples at all, or only the alignment
 * probe(s) — means "not measured", which is a zero subtraction and
 * therefore exactly today's behaviour. Pure so the choice of statistic is
 * unit-tested.
 */
export function surfaceComputeFenceRoundTripMs(
  samples: readonly number[],
): number {
  const counted = samples.slice(SURFACE_COMPUTE_FENCE_ALIGNMENT_PROBES);
  if (counted.length === 0) return 0;
  return Math.max(0, Math.min(...counted));
}

/**
 * THE ONE CHOKEPOINT between a measured dispatch and every SIZING
 * decision: the wall time with the session's own fence round-trip taken
 * out, so a per-fence constant cannot be read as the cost of the work
 * behind it.
 *
 * WHY IT EXISTS. The frame loop times its dispatches across its own
 * `device.queue.onSubmittedWorkDone()`, so the fence latency is inside
 * the number (one fence per GROUP of them, since grouping — see
 * {@link surfaceComputeFenceGroupSize}). MEASURED on one real AMD RX 7900 XTX, hardware adapters
 * confirmed in both browsers: a fenced null dispatch costs 100.960 ms in
 * Firefox against 3.265 ms in Chrome — Firefox's round 100 ms suggesting
 * the promise resolves on a polling tick, so the price is per fence
 * whatever sits behind it. Fed raw to the CAPS, which compare a TOTAL
 * dispatch time against a budget, that constant is fatal rather than
 * merely wasteful — and THE TWO LADDERS FAIL DIFFERENTLY, said here
 * because a first draft of this comment had them failing the same way.
 * The LIT one quarters: no Firefox dispatch comes in under
 * {@link nextLightingRayCap}'s 50 ms target, so `Math.floor(cap / 4)`
 * walks it down to {@link SURFACE_COMPUTE_WORKGROUP_SIZE} and pins it
 * there for the life of the session. The UNLIT hit ladder cannot be
 * quartered by a fence this size at all — {@link nextShadeBatchSize}
 * quarters past `budgetMs * 2` and {@link shadeHitBudgetUs}'s own floor
 * is {@link SURFACE_COMPUTE_PASS_TARGET_MS}, so that would take a fence
 * over 250 ms — it STALLS instead: a dispatch that fit its budget reads
 * over it, the capacity never doubles, and the whole drain runs at
 * {@link SURFACE_COMPUTE_SHADE_HIT_CAP_START}. Either way one full-pane
 * pass turns Chrome's few hundred dispatches into tens of thousands,
 * each paying another ~100 ms.
 *
 * THIS IS `strip-planner.ts`'S `SURFACE_STRIP_SYNC_TAX_MS` ONE ENGINE
 * OVER, and that file's record says a flat subtraction was not enough on
 * its own there — a single ms/px term absorbs whatever fixed cost the
 * constant under-states, a one-way ratchet into a 1 px absorbing state.
 * The compute arm's answer is narrower because the shape is: the hit
 * queue ALREADY carries the two-term model that file had to grow
 * ({@link nextShadeHitCost}), so the residue lands in the intercept and
 * sizing reads the marginal alone. The march's own model is single-term
 * (µs per ray·step) and does absorb it, but shrinking dilutes nothing
 * there — {@link SURFACE_COMPUTE_MARCH_CHUNK_MIN} floors the slice, and a
 * bigger slice spreads the same residue over more ray·steps, so the term
 * FALLS as the chunk grows instead of ratcheting.
 *
 * THE FLOOR IS ZERO, so the case to be careful of is an OVER-stated
 * `fenceMs`, and the pacing that bounds it is weaker than it first looks:
 * the two capacity ladders may only double per dispatch, but a calibrated
 * {@link nextShadeHitCost} reads this number directly and the ladder
 * above it then binds nothing, so on that path the only rate limit is
 * {@link SURFACE_COMPUTE_SHADE_MARGINAL_DECAY}'s halving per update. That
 * is why {@link surfaceComputeFenceRoundTripMs} takes the MINIMUM of its
 * probes rather than their middle: the error belongs on the
 * under-subtracting side, which costs throughput and nothing else. Under
 * a polling-tick fence the subtraction under-states what it removes
 * anyway (a dispatch is charged the tick it lands in, less one whole
 * tick), so the residue is bounded by one fence quantum. The march's
 * single-term EMA carries 0.6 of its previous value, so even a run of
 * under-fence measurements needs ~18 slices to walk the chunk sizer out
 * to its guard. Pure so the clamp is unit-tested.
 */
export function surfaceComputeDispatchWorkMs(
  wallMs: number,
  fenceMs: number,
): number {
  return Math.max(0, wallMs - fenceMs);
}

/**
 * HOW MANY DISPATCHES ONE FENCE MAY STAND BEHIND, from the only evidence
 * that means anything here: what a dispatch of this LANE was last MEASURED
 * to cost, with its fence taken out.
 *
 * IT IS NOT A PREDICTION, and that is the correction this function's own
 * first draft needed. Both schedulers SIZE a dispatch to hit a target —
 * {@link marchChunkFor} divides the pass target by the per-ray·step EMA,
 * {@link shadeHitBatchSize} divides the hit allowance by the marginal — so
 * a dispatch's model-predicted cost is that target BY CONSTRUCTION and
 * carries no information at all. MEASURED on Firefox at 640x360: every
 * march slice of a settle predicted exactly 250.0 ms while measuring
 * 26-29 ms of fence-free work, so a group sized off the prediction closed
 * at two dispatches on a lane where eight were affordable.
 *
 * SO THE INPUT IS THE LANE'S RUNNING MAXIMUM per-dispatch work this frame,
 * doubled to price the queued cancellation debt — this is
 * `surfaceComputeLightingFenceGroup` from the removed participating
 * medium, constant for constant, and its reasoning holds unchanged: a
 * running MAX can only ever be raised by a later, slower dispatch, which
 * is the safe direction for a decision about how much work to queue. The
 * maximum is per FRAME, so an expensive band cannot pin the group size for
 * a session.
 *
 * `null` — no dispatch of this lane has come back yet — returns 1: THE
 * PILOT. No group is built on a cost this frame has not measured, so a
 * cold or badly scaled lane misprices at most one dispatch's worth of
 * queued work rather than {@link SURFACE_COMPUTE_FENCE_GROUP_MAX}.
 *
 * `remainingMs` is the CALLER's ceiling — the time before the next
 * progressive present falls due, or before the frame budget cuts,
 * whichever is nearer. Queued work is present debt as well as
 * cancellation debt: the screen has to keep developing through a long
 * drain and a budget cut has to be able to land, so a caller with nothing
 * left to spend gets a group of one, which is the pre-grouping loop
 * exactly. Pure so all three bounds are unit-tested.
 */
export function surfaceComputeFenceGroupSize(
  peakDispatchWorkMs: number | null,
  remainingMs = Infinity,
  maxDispatches = SURFACE_COMPUTE_FENCE_GROUP_MAX,
): number {
  if (
    peakDispatchWorkMs === null ||
    !Number.isFinite(peakDispatchWorkMs) ||
    peakDispatchWorkMs < 0
  ) {
    return 1;
  }
  return Math.max(
    1,
    Math.min(
      maxDispatches,
      Math.floor(
        Math.min(SURFACE_COMPUTE_FENCE_GROUP_MS, remainingMs) /
          Math.max(0.01, 2 * peakDispatchWorkMs),
      ),
    ),
  );
}

/**
 * THE SECOND WAY A FENCE GROUP CLOSES: the bytes it has STAGED. A group
 * closes once what it has put through `queue.writeBuffer`/`writeTexture`
 * since its last fence — params blocks, ray lists, the frame's own uniforms
 * and textures, anything — reaches this, whatever the dispatch count or the
 * measured work would still allow.
 *
 * WHY BYTES. The app-free repro's rows, twenty reps a cell on Firefox
 * (`docs/surface-compute-renderer.md`, "It is a VOLUME, not a count"): C,
 * four dispatches staging two 16 KB writes each, dies 0/20; D, the same
 * group plus 8 MB, 7/20; E, that 8 MB behind a group of ONE, 0/20; F, 32 MB
 * across four dispatches, 13/20. Staged volume held behind one fence is
 * the killer. The device seed removed the frame prefill but not the ray
 * lists: a march slice's list and the shade FREE queue, which drains whole
 * (3.7 MB at 1280x720), both still scale with the raster. This bound is
 * what should let {@link SURFACE_COMPUTE_FENCE_GROUP_MAX} rise safely at
 * any raster.
 *
 * IT ONLY EVER MAKES A GROUP SMALLER, NEVER EMPTY, AND SKIPS NO FENCE: a
 * dispatch whose own writes pass the ceiling still goes out, as a group of
 * one (row E). 1 MiB keeps the grouping this work was built for — two
 * 16 KB dispatches are 3% of it — while sitting far below row D's 8 MB.
 * What no group rule can fix is row G: one dispatch whose OWN list is tens
 * of megabytes (4K-class rasters) stages that much behind its own fence.
 */
export const SURFACE_COMPUTE_FENCE_GROUP_STAGED_BYTES = 1 << 20;

/**
 * Must the open fence group close before `nextBytes` more are staged —
 * {@link SURFACE_COMPUTE_FENCE_GROUP_STAGED_BYTES}'s rule. Asked twice per
 * dispatch: BEFORE staging its writes (`nextBytes` = its params block plus
 * ray list), so a big write never joins a group already holding staging;
 * and AFTER submitting it (`nextBytes` = 0), so a group that has reached
 * the ceiling closes at once. An EMPTY group never closes, which is what
 * sends an oversized dispatch out alone. Pure so the rule is unit-tested.
 */
export function surfaceComputeFenceGroupStagedFull(
  groupDispatches: number,
  stagedBytes: number,
  nextBytes = 0,
  ceilingBytes = SURFACE_COMPUTE_FENCE_GROUP_STAGED_BYTES,
): boolean {
  return groupDispatches > 0 && stagedBytes + nextBytes >= ceilingBytes;
}

/**
 * THE PER-DISPATCH SHARE of one fence group's fence-free work: an EQUAL
 * split, said out loud because a group measures ONE time for N pieces of
 * work and every capacity ladder below still judges a single dispatch
 * against a budget.
 *
 * WHY EQUAL IS THE RIGHT SPLIT FOR A LADDER. The alternative — split by
 * each member's predicted cost — asks the model to say which member was
 * expensive, which is precisely what the group did not measure; it would
 * make the evidence a restatement of the prediction. An equal split
 * claims nothing beyond the group's own average, and both ladders are
 * coarse instruments (a doubling, or a quartering past twice budget) that
 * an average serves honestly. The members of a group are also nearly
 * always the same width — a drain sizes every batch from the same sizer
 * state, a sweep slices from the same EMA — with the queue-limited tail
 * the one exception, and the queue-limited rule already forbids THAT
 * member from growing a capacity.
 *
 * WHAT DOES NOT USE THIS. The two-term cost model does not need a share
 * at all: {@link nextShadeHitCost} takes the group's dispatch COUNT and
 * fits `d·intercept + N·marginal` to the one measurement, which is exact
 * at any mix of widths. And the march's per-ray·step EMA reads the
 * group's aggregate rate (its work over its total ray·steps), which is
 * what one dispatch of the same total rays would have given. So the equal
 * split is the ladders' number alone — it is not a general attribution
 * rule, and nothing here should grow into one.
 */
export function surfaceComputeGroupDispatchMs(
  groupWorkMs: number,
  dispatches: number,
): number {
  return groupWorkMs / Math.max(1, dispatches);
}

/**
 * Adaptive hit-batch CAPACITY: grow while hit batches come in under the
 * budget they were sized for, QUARTER on a big overshoot. This is the
 * slow-trust bound layered over {@link shadeHitBatchSize}'s cost
 * prediction: a width the model has never priced can only be reached by
 * doubling through widths it has, so the climb out of an EMPTY model
 * cannot jump straight to the ceiling. The floor is one workgroup, never
 * lower — see {@link shadeHitBatchSize} for why a sub-workgroup capacity
 * buys no submission-wall safety.
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
 * at whatever width cost 125 ms — ~256 hits on the measured scene,
 * against a measured optimum of ~1050.) Pure so the safety bias is
 * unit-tested.
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
 * Predictive hit-batch sizing, corrected by the two-term cost model: as
 * many hits as the measured MARGINAL cost says fit the dispatch budget
 * once the intercept is paid, clamped by the slow-trust capacity cap and
 * floored at one WORKGROUP rather than one hit.
 *
 * Sub-workgroup batches buy zero watchdog safety: GPU cost inside a
 * single workgroup ({@link SURFACE_COMPUTE_WORKGROUP_SIZE} threads) is
 * depth-dominated, not width-dominated — a dispatch of 64 independent
 * rays costs about as much wall time as a dispatch of 1, since lanes run
 * in parallel across EUs — so shrinking below one workgroup only
 * multiplies the number of worst-ray-cost submissions without shrinking
 * any single one of them. The model's measurement is that the same
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
 * Fold one measured hit dispatch into the cost model.
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
 * measured in the cost-model simulation at a 19x marginal lift and a 16x
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
 * WHAT THE SPLIT CANNOT DO, and the width fix had to prove before it
 * could believe it: IT NEVER IDENTIFIES THE TWO TERMS. Unclamped, this
 * function preserves `interceptUs = PIVOT · marginalUs` IDENTICALLY. From
 * a zeroed model, one update at width n gives `I = (1−w)C` and `m =
 * wC/n`, so `I/m = n(1−w)/w = n·(P/(n+P))·((n+P)/n) = P`; and if `I =
 * P·m` already, then `I' / m' = (I + Ps/(n+P)) / (m + s/(n+P)) = P` for
 * ANY surprise s and any width n. Two parameters, one measurement, an
 * exact fit — so the RATIO is set by the attribution weight alone and the
 * data only ever moves the scale.
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
 * sizer against the width fix's own kaleido4 curve with its own drain
 * pattern: the ratio leaves P after one such pair and settles around
 * 250-310, and the width the sizer asks for lands in 1764-3584 rather
 * than pinned at `K·P`.
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
 * the width it names is the CONSTANT's, not the scene's. The two-term
 * model read that branch as "spend as much again on hits as the fixed
 * cost", which is true of the model and says nothing about the machine;
 * the width fix measured the machine and found the resulting 512 hits
 * leaving 90% of every dispatch on fixed cost, four and a half times
 * slower than the same frame at 3690. So the constant is now chosen as a
 * width and measured as one.
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
  /** How many DISPATCHES that one measurement covers — a fence group's
   * members, since a group measures once for all of them
   * ({@link surfaceComputeFenceGroupSize}). `hits` is then the group's
   * TOTAL hits and the model fitted is `d·intercept + N·marginal`, which
   * is the honest statement of what was measured: d fixed costs were
   * paid and N hits were shaded. One dispatch — the default — is the
   * original function character for character.
   *
   * EVERY PROPERTY ABOVE SURVIVES THE GENERALIZATION, which is why it is
   * a parameter rather than a second function. The fit stays EXACT
   * (`d·I' + N·m' = measured`, since the intercept absorbs `(1−w)s/d` on
   * each of d dispatches and the marginal `w·s/N` on each of N hits), and
   * the ratio invariant is untouched: with `w = N/(N + d·PIVOT)`,
   * `I/m = PIVOT` is preserved identically, exactly as it is at d = 1
   * (and the clamps break it in the same reachable way — see the
   * queue-limited paragraph above, which a group does not change).
   *
   * AND AT EQUAL WIDTHS IT IS THE SAME ANSWER as folding each member
   * separately at {@link surfaceComputeGroupDispatchMs}'s equal share:
   * substituting `N = d·n` and `measured = d·(C/d)` gives `w` and both
   * updates back unchanged, so the two readings of a uniform group agree
   * by algebra and not by luck. Unequal widths are where they part, and
   * the joint fit is the one that does not have to guess. */
  dispatches = 1,
): ShadeHitCost {
  const d = Math.max(1, dispatches);
  const n = Math.max(1, hits);
  const surpriseUs = measuredUs - (d * cost.interceptUs + n * cost.marginalUs);
  const w = n / (n + d * SURFACE_COMPUTE_SHADE_COST_PIVOT);
  return {
    interceptUs: Math.max(0, cost.interceptUs + ((1 - w) * surpriseUs) / d),
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
 * carrier so a supersampling job can hand it to the next pass. See the
 * `sizer` declaration in `runFrame` for why that carry is sound
 * for passes of one job and for nothing else. */
interface ShadeSizerState {
  cost: ShadeHitCost;
  cap: number;
  /** Medium dispatches ride the frame loop's SHARED fence groups
   * ({@link surfaceComputeFenceGroupSize}) on their own `medium` lane, so
   * the group size reads that lane's per-frame running maximum and its
   * pilot is the shared one (a lane with no measurement yet fences one
   * dispatch at a time). No private lighting fence group survives.
   *
   * `surfaceCost`/`mediumCost` are LIVE: every lit hit dispatch feeds the
   * first and every medium fence group the second, both through
   * `nextShadeHitCost`, so `surfaceComputeLightingRayBatch` sizes on this
   * scene rather than on a fixed conservative width. They were inert
   * placeholders until MEASURED (real RX 7900 XTX, cathedral, 4096 rays,
   * one sample, width forced offline): one medium dispatch costs
   * `5.63 ms + 2.04 us/ray`, so at the one-workgroup width that shipped,
   * 97.7% of every medium dispatch was fixed cost and the settle ran
   * 17.7x longer than the same pixels at 4096. `lastCellMs` is the most
   * recent medium group's PER-DISPATCH fence-free cost — the ladder's
   * evidence, where the lane's running max would freeze the climb after
   * one slow group. */
  lighting?: {
    lastCellMs: number;
    surfaceCost: ShadeHitCost;
    mediumCost: ShadeHitCost;
    rayCap: number;
  };
}

export const SURFACE_COMPUTE_LIGHTING_MAX_DISPATCH_RAYS = 4096;
const SURFACE_COMPUTE_LIGHTING_DISPATCH_TARGET_MS = 50;

/** Separate terminal and complete-cell-sweep economics; the more expensive
 * model bounds the ray width. A wider dispatch still has one cell/light per
 * invocation, and starts a fresh individually fenced medium pilot. */
export function surfaceComputeLightingRayBatch(
  surfaceCost: ShadeHitCost,
  mediumCost: ShadeHitCost | null,
  cap: number,
  /** Medium rays per batch ray — 1 unless `?surfacemediumstride` filters
   * the sweep, when the medium model's affordable width (in MEDIUM rays)
   * converts to batch rays through it. */
  mediumRaysPerBatchRay = 1,
): number {
  const affordable = (cost: ShadeHitCost): number =>
    (SURFACE_COMPUTE_LIGHTING_DISPATCH_TARGET_MS * 1000 - cost.interceptUs) /
    Math.max(1, cost.marginalUs);
  const width = Math.min(
    cap,
    SURFACE_COMPUTE_LIGHTING_MAX_DISPATCH_RAYS,
    affordable(surfaceCost),
    mediumCost
      ? affordable(mediumCost) / Math.max(1e-6, mediumRaysPerBatchRay)
      : Infinity,
  );
  return Math.max(
    SURFACE_COMPUTE_WORKGROUP_SIZE,
    Math.floor(width / SURFACE_COMPUTE_WORKGROUP_SIZE) *
      SURFACE_COMPUTE_WORKGROUP_SIZE,
  );
}

/**
 * The LIT capacity ladder: how fast the lit hit width may climb, paced by
 * the worst single DISPATCH the last batch produced — its phase-0 shading
 * or its slowest medium cell, whichever hurt more — against
 * {@link SURFACE_COMPUTE_LIGHTING_DISPATCH_TARGET_MS}.
 *
 * It exists for the same reason {@link nextShadeBatchSize} does one queue
 * over: the two-term model sizes, the ladder paces the climb, so a scene
 * nobody has measured cannot go from one workgroup to
 * {@link SURFACE_COMPUTE_LIGHTING_MAX_DISPATCH_RAYS} on a single cheap
 * dispatch. Doubling on evidence and quartering on a 2x overrun are that
 * file's shape deliberately, not a second set of dials.
 *
 * WHY THE CLIMB IS WORTH PACING AT ALL, measured (real AMD RX 7900 XTX,
 * production build, cathedral, 64x64 = 4096 rays, one sample, one fresh
 * session per width, lit width forced through `?surfaceshadehits=N`):
 *
 *     width               64      256     1024     4096
 *     ms/medium disp   5.756    7.200    9.880   13.978
 *     medium disps      4288     1088      288       96
 *     settle          27.22s    8.76s    3.29s    1.54s
 *
 * The fit over that lever is `5.63 ms + 2.04 us/ray`, so at the ONE
 * WORKGROUP this path used to be pinned to, 97.7% of every medium
 * dispatch was fixed cost — 64 invocations do not begin to fill the
 * machine — and a 64x width bought only 2.4x the dispatch for a 17.7x
 * settle. Coverage was identical (3840 covered / 256 miss / 0 exhausted)
 * at every width: this is scheduling, and the image does not change.
 * Pure so the safety bias is unit-tested.
 */
export function nextLightingRayCap(
  current: number,
  worstDispatchMs: number,
): number {
  if (
    worstDispatchMs < SURFACE_COMPUTE_LIGHTING_DISPATCH_TARGET_MS &&
    current < SURFACE_COMPUTE_LIGHTING_MAX_DISPATCH_RAYS
  ) {
    return Math.min(current * 2, SURFACE_COMPUTE_LIGHTING_MAX_DISPATCH_RAYS);
  }
  if (worstDispatchMs > SURFACE_COMPUTE_LIGHTING_DISPATCH_TARGET_MS * 2) {
    return Math.max(SURFACE_COMPUTE_WORKGROUP_SIZE, Math.floor(current / 4));
  }
  return current;
}

/**
 * MEASUREMENT-ONLY EXPERIMENT LEVERS for the participating medium's cost.
 * Page-load URL pins in the style of `?surfaceshadehits=` and
 * `?surfacesamples=`; nothing ships them, and both absent is the restored
 * medium exactly.
 *
 * `?surfacemediumcells=N` (1..32) — medium cells per progressive pass, in
 * place of both the motion 8 and the parked 32. The cells are DISTINCT
 * STRATA across a job: an `S`-pass job partitions each camera segment into
 * `N·S` equal cells, pass `k` visits cells `j·S + k` for `j < N` (so every
 * pass spans the whole segment, interleaved with the others), and the
 * in-scatter is weighted by `S` so the job's linear mean sums every one of
 * the `N·S` cells exactly once. Compute engine only.
 *
 * `?surfacemediumstride=K` (>= 1) — the medium sweep runs only for
 * terminals whose FULL-IMAGE pixel has `x % K == 0 && y % K == 0`. Every
 * terminal still gets its phase-0 shading; the others get no medium
 * contribution and nothing is upsampled, so this prices the COST side of a
 * 1/K² medium raster only. The terminal list is filtered on the host
 * before the sweep, so the medium dispatches' width and workgroup count
 * are the smaller population's.
 */
let surfaceComputeMediumCellsPin: number | null = null;
let surfaceComputeMediumStridePin: number | null = null;

/** See {@link surfaceComputeMediumCellsPin}. Null/absent leaves the
 * restored medium untouched. */
export function setSurfaceComputeMediumExperimentPins(pins: {
  cells?: number | null;
  stride?: number | null;
}): void {
  const cells = positivePin(pins.cells);
  surfaceComputeMediumCellsPin =
    cells === null
      ? null
      : Math.min(cells, SURFACE_LIGHTING_MAX_MEDIUM_SAMPLES);
  surfaceComputeMediumStridePin = positivePin(pins.stride);
}

/** The medium cell a pass visits for its `slot`-th per-pass cell under
 * `?surfacemediumcells` — distinct strata across an `sampleCount`-pass job
 * (see {@link surfaceComputeMediumCellsPin}). Pure so the indexing is
 * unit-tested. */
export function surfaceComputeMediumCellIndex(
  slot: number,
  sampleOrdinal: number,
  sampleCount: number,
): number {
  const passes = Math.max(1, Math.floor(sampleCount));
  return slot * passes + (((sampleOrdinal % passes) + passes) % passes);
}

/** Whether a ray's full-image pixel is on the `?surfacemediumstride`
 * lattice. Pure so the filter is unit-tested. */
export function surfaceComputeMediumStrideKeeps(
  ray: number,
  rasterWidth: number,
  bgOffset: readonly [number, number],
  stride: number,
): boolean {
  const x = (ray % rasterWidth) + bgOffset[0];
  const y = Math.floor(ray / rasterWidth) + bgOffset[1];
  return x % stride === 0 && y % stride === 0;
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
 * since the march status side-channel landed: nothing reads it back. */
export const SURFACE_COMPUTE_RAY_STATE_BYTES = 16;

/** Bytes of GPU buffer ONE ray costs a frame, across all eight per-ray
 * buffers: states 16 + active 4 + color 4 + stagingColor 4 + layer 4 +
 * stagingLayer 4 + status 4 + stagingStatus 4. Was 36 immediately before
 * the background-composite sidecar; the earlier status-side-channel change
 * had cut 44 to 36 by trading the 16 B/ray states staging twin for a 4 B/ray
 * status side-channel and its own twin. */
export const SURFACE_COMPUTE_RAY_BYTES = 44;

/** Authored lighting replaces color and stagingColor by vec4f radiance;
 * all six other per-ray buffers keep their frozen layout. */
export const SURFACE_COMPUTE_LIGHTING_RAY_BYTES = 68;

/** Byte count as MiB, for the size errors' messages. */
function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Rays ONE dispatch may cover on a device with these limits. Every
 * dispatch this module issues is one-dimensional — `ceil(count /
 * SURFACE_COMPUTE_WORKGROUP_SIZE)` workgroups along x — so
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
 * limits, in rays. `states` is both the widest per-ray buffer and a bound
 * STORAGE buffer, so it meets whichever ceiling is lower — and it is the
 * binding ceiling that decides, which is why the status side-channel's
 * cheaper readback (one 4 B/ray status buffer in place of the 16 B/ray
 * staging twin) cuts a frame's total commitment without moving this
 * bound. Pure so the arithmetic behind a refusal is unit-tested.
 *
 * DELIBERATELY NOT MET AGAINST {@link surfaceComputeMaxDispatchRays},
 * even though that one is the lower of the two on a spec-minimum device:
 * a frame's rays are a MEMORY question and a dispatch's are a
 * SUBMISSION-SHAPE one, and folding the smaller in here would make a 4K
 * pane (8.3M rays, inside a spec-minimum 128 MiB binding) fit one rung
 * softer for a ceiling no single piece of work has to meet. Every
 * dispatch this loop issues is sized at its own site, and clamps there.
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
 * Rays one CAPTURE tile may cost, however much the device would allow. A
 * frame's buffers are 44 B/ray and its host mirrors another ~28 B/ray, so
 * an untiled 4x export of a 1920x1057 pane (32.5M rays) commits ~1.43 GB
 * of GPU memory plus its host mirrors and reads back up to 130 MB of ray status per march sweep
 * (a flat 520 MB of ray STATE before the status side-channel) — a device
 * that reports gigabytes of `maxBufferSize` will still refuse or thrash.
 * At this cap a tile is ~176 MB of GPU buffers, comfortably above the live
 * rasters the same code paths run all session (a 1920x1057 pane is 2.0M
 * rays), so tiling costs an export nothing it was not already paying per
 * frame.
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
 * Shrink a raster to fit a device's own frame ceiling, keeping its
 * aspect. The live pane cannot tile the way a capture can — one frame IS the
 * image — so an enormous drawing buffer (a hidpi 5K desktop) that would
 * overrun {@link surfaceComputeMaxFrameRays} traces slightly soft and
 * blits up, the preview tier's own mechanism, instead of failing to
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
 * Ray-work `done` tally for a settle's progress report.
 *
 * A ray's unit of progress splits half march, half shade: the march half
 * accrues CONTINUOUSLY as the ray consumes its step budget, lands in full
 * on going terminal, and the shade half lands when the pixel is shaded.
 * Counting only shaded rays displayed a heavy frame's whole first march
 * sweep as 0% for a minute of honest work, then read the cheap miss-drain
 * as a sprint; crediting only TERMINAL rays (the first fix) still parked
 * a fully in-sphere pose at a low pct through its long first sweep — no
 * ray terminates until deep into the step budget, so the sweep's real
 * work stayed invisible. Sub-ray credit is exact host-side bookkeeping,
 * no extra readback: the kernel's march loop breaks only on terminal
 * transitions, so a still-ACTIVE ray has consumed exactly the steps the
 * host issued to it (`sweepSteps`, plus `stepsThisPass` for the `sliced`
 * rays the current sweep has already dispatched), never more than
 * `marchSteps` by the exhaustion rule.
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
 * Everything {@link SurfaceComputeRenderer}'s constructor needs, built up
 * by the (long) {@link SurfaceComputeRenderer.buildOnDevice} driver. The
 * same shape `GpuFlameBackendInit` takes one module over, and for the
 * same two reasons: there are enough GPU resources here that positional
 * arguments would be unreadable, and a NAMED init object is an injection
 * point — `surface-compute.test.ts` drives this renderer's
 * deferred-teardown state machine over a fake device through it, which a
 * private constructor behind an adapter-acquiring `create()` offered no
 * way to reach. Production code still arrives through
 * {@link SurfaceComputeRenderer.create}, never by naming this type.
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
  /** ifs4 only: the slab-free kernel pair every sliceHalfW=0 frame rides
   * — null for every other target kind. */
  marchPipelineNoSlab: GPUComputePipeline | null;
  shadePipelineNoSlab: GPUComputePipeline | null;
  /** The frame seed (`surfaceComputeSeedWgsl`, lighting variant matching the
   * session's compile gate): writes `color`/`layer`/`states` on the device
   * so no frame stages them through the queue. */
  seedPipeline: GPUComputePipeline;
  seedLayout: GPUBindGroupLayout;
  /** The seed's 16-byte `SeedParams` uniform. */
  seedBuf: GPUBuffer;
  paramsBuf: GPUBuffer;
  shadeBuf: GPUBuffer;
  mapsBuf: GPUBuffer;
  shadeMapsBuf: GPUBuffer;
  lutTex: GPUTexture;
  /** Balloon-only LUT, allocated only for a target compiled with balloon. */
  balloonLutTex?: GPUTexture | null;
  /** Mesh-only conservative R32F atlas at frozen binding 11. */
  meshSdfTex?: GPUTexture | null;
  /** Lighting-only full-image backdrop texture, initially a valid 1x1. */
  lightingBackgroundTex?: GPUTexture | null;
  /** Session compile gate and color-buffer ABI; absent retains RGBA8. */
  lighting?: boolean;
  lutSamp: GPUSampler;
  /** Adapter label from create()'s requestAdapter — surfaced in the UI's
   * backend disclosure; undefined when the adapter offered no
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
  /** Packed RGBA8 presentation sidecar: coverage/fog/beta/signed-CoC. */
  layer: GPUBuffer;
  /** The march status side-channel: one `u32` per ACTIVE-LIST SLOT,
   * written by every march dispatch and read back once per sweep. */
  status: GPUBuffer;
  stagingStatus: GPUBuffer;
  stagingColor: GPUBuffer;
  stagingLayer: GPUBuffer;
  marchBindGroup: GPUBindGroup;
  shadeBindGroup: GPUBindGroup;
  /** The frame seed's bind group: rebuilt with the shade one, since both
   * bind the lighting background texture. */
  seedBindGroup: GPUBindGroup;
}

export class SurfaceComputeRenderer {
  /** Cheap sync routing predicate — a context without `navigator.gpu`
   * never even attempts {@link create}. */
  static supported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.gpu;
  }

  private static adapterProbe: Promise<boolean> | null = null;

  /** Cached one-shot adapter probe: whether `requestAdapter()` actually
   * yields an adapter in this context. {@link supported} alone admits
   * contexts that EXPOSE `navigator.gpu` with no working adapter behind
   * it — modern Firefox ships the object ahead of per-platform support —
   * and fold-4D routing has no fallback arm to absorb that late surprise:
   * entry was admitted, create() failed, and the mode exited on a toast
   * the user can miss ("no preview ever appears"). Boot fires this probe
   * and latches the same one-way routing block a failed create() would
   * have set, so the eligibility gate refuses fold-4D up front with the
   * honest note instead. The probed adapter is discarded — {@link create}
   * requests its own; same
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
    opts: {
      shadeDeWidth?: number;
      /** Unified per-slot materials (`surface-slots.ts`'s
       * `surfaceSlotMaterials`), or null/absent for classic+none —
       * THE COMPILE GATES: non-null packs the stride-3 shadeMaps buffer,
       * while its independent finish/pattern flags drive codegen;
       * absent compiles literally today's program text (the caller
       * decides through the shared slot resolver, since parametric finish
       * is value- not byte-identical at the classic lanes). Must
       * cover every color slot when present — the packer throws on a
       * mismatch. Forward targets pass ONE slot, chosen by the shared
       * first-positive-weight rule (their kernels' `firstChoice` is 0).
       * CREATE-TIME state, like the
       * colors beside it: a material edit reaches a live session through
       * the same session re-enter a color edit takes. */
      materials?: SurfaceMaterialSlots | null;
      lighting?: boolean;
    } = {},
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
    // conservative spec minimums — the flame accumulation spike's lesson.
    // A full-resolution settle's state buffer (16 bytes/ray) fits the
    // 128MiB default comfortably, but pass the adapter's real ceiling
    // anyway so a hi-res export never trips a limit the hardware doesn't
    // have.
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    // Capture the adapter's identity before the reference is dropped —
    // the renderer discloses label + software verdict to the UI (the
    // shared render-backend derivation, same as the flame worker's; the
    // older spec kept `isFallbackAdapter` on the adapter itself).
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
        opts.materials ?? null,
        opts.lighting ?? false,
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
    materials: SurfaceMaterialSlots | null,
    lighting = false,
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
    const targetHasLensPost =
      !isForwardTarget(target) &&
      (target.de.foldFinal?.postInvM ?? null) !== null;
    const compileEntry = async (
      mode: "march" | "shade",
      slabExt: boolean,
    ): Promise<GPUShaderModule> => {
      const module = device.createShaderModule({
        code: surfaceDeKernelWgsl({
          mode,
          rays: mode === "march" ? "unproject" : undefined,
          // The march writes each dispatched ray's post-pass status to
          // its own ACTIVE-LIST SLOT, which is the only field the sweep's
          // rebuild reads — 4 B per active ray in place of the whole 16
          // B/ray states buffer.
          statusOut: mode === "march",
          // The DE picks the descent core exactly as the CPU estimators
          // route — fold base maps march the wide frontier, fold-free
          // ones the width-4 refined ladder (width/shadeDeWidth are inert
          // there) — and a fold FINAL lens wraps either core in
          // descendLens's branch sweep. An escape target takes the
          // forward-orbit core instead (no lens — the escape gate refuses
          // final transforms). A 4D target routes the SAME way one
          // dimension up — fold base maps the fold4 frontier, fold-free
          // ones the affine4 ladder, and a 4D fold FINAL wraps either in
          // descendLens4's sweep.
          core:
            target.kind === "escape"
              ? "escape"
              : target.kind === "escape4"
                ? // The escape orbit one dimension up — 4D tail
                  // and GpuMap4 maps, forward orbit and no frontier.
                  "escape4"
                : target.kind === "bulb"
                  ? // The Mandelbulb's forward triplex-power orbit
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
          lensPost: targetHasLensPost,
          // A balloon ifs/ifs4 target compiles the inverted-union wrapper
          // over whichever core+lens the DE picked; the FORWARD kinds
          // never set the flag (their codegen throws are the backstop).
          balloon:
            (target.kind === "ifs" || target.kind === "ifs4") &&
            target.balloon === true,
          // The ground plane compiles into every kind — the classic
          // Mandelbox/Mandelbulb floor, and the floor under a w-slice —
          // and a balloon+plane target is a caller bug the codegen
          // rejects loudly.
          groundPlane: target.groundPlane === true,
          // Tiling KIND and CLIP are frozen with the session like the
          // estimator core. A lattice scale may change live afterward: it
          // alters only h in the params tail, while this generated source
          // depends on the lattice discriminator and baked clip alone.
          tiling: target.tiling ?? null,
          // The shape-trap channel — FORWARD kinds only (the target union
          // carries the field nowhere else). Baked geometry: the create-time
          // decision, so a shape edit re-enters the session with fresh
          // kernels while pose/mode edits ride the live params block.
          shapeTrap: isForwardTarget(target)
            ? (target.shapeTrap ?? null)
            : null,
          shapeTrapGeometry: isForwardTarget(target)
            ? (target.shapeTrapGeometry ?? null)
            : null,
          // Condensation geometry belongs to the inverse-descent family.
          // Pass the analyzer's already-expanded emitter records straight
          // through so codegen, params packing, and map packing validate one
          // wire contract and bake one SDF per unique shade suffix.
          condensation: !isForwardTarget(target)
            ? target.de.condensation
              ? {
                  mapCount: target.de.maps.length,
                  emitters: target.de.condensation.emitters,
                }
              : null
            : null,
          // A hybrid surface packs the scheduled affine B suffix directly
          // after the recursive A maps. The live depth and per-level bounds
          // stay in params, while these creation-time counts select the
          // scheduled descent source and its physical map ranges.
          schedule: !isForwardTarget(target)
            ? target.de.schedule &&
              target.de.schedule.depth > 0 &&
              target.de.schedule.maps.length > 0
              ? {
                  mapCount: target.de.maps.length,
                  scheduleMapCount: target.de.schedule.maps.length,
                }
              : null
            : null,
          chaos: !isForwardTarget(target)
            ? target.de.chaos
              ? {
                  activeStateCount: target.de.chaos.activeStateCount,
                  predecessorMasks: target.de.chaos.predecessorMasks,
                }
              : null
            : null,
          width: SURFACE_FOLD_BEAM_WIDTH,
          shadeDeWidth: mode === "shade" ? shadeDeWidth : undefined,
          workgroupSize: SURFACE_COMPUTE_WORKGROUP_SIZE,
          sharedFrontier: false,
          bnbStage2: false,
          // The slab half-extent registers cost the affine4 kernel a
          // measured 2.2-2.4x at EVERY kaleidoscope order on Iris
          // (occupancy — they are live whether or not the slab is on), so
          // an ifs4 session compiles BOTH variants and runFrame picks per
          // frame by the live sliceHalfW. Inert for every other core.
          slabExt,
          // Independent per-slot material gates made real on this engine
          // (create()'s opts doc). Structurally inert in march mode
          // — the march never reads shadeMaps — so one flag serves both
          // kernels of the pair.
          finish: materials?.finish ?? false,
          lighting,
          pattern: materials?.pattern ?? false,
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
    const targetMeshIds = surfaceComputeTargetMeshIds(target);
    const targetHasMesh = targetMeshIds.length > 0;
    const meshTextureLayoutEntry: GPUBindGroupLayoutEntry = {
      binding: 11,
      visibility: GPUShaderStage.COMPUTE,
      texture: { sampleType: "unfilterable-float", viewDimension: "3d" },
    };
    // March (rays:"unproject") binds params/maps/active/states + the
    // shade uniform (invProjView + dither knobs only) + the status
    // side-channel at 5.
    const marchLayout = device.createBindGroupLayout({
      entries: [
        bufferEntry(0, "uniform"),
        bufferEntry(1, "read-only-storage"),
        bufferEntry(2, "read-only-storage"),
        bufferEntry(3, "storage"),
        bufferEntry(4, "uniform"),
        bufferEntry(5, "storage"),
        ...(targetHasMesh ? [meshTextureLayoutEntry] : []),
      ],
    });
    const targetHasBalloon =
      (target.kind === "ifs" || target.kind === "ifs4") &&
      target.balloon === true;
    const targetHasCondensation =
      (target.kind === "ifs" || target.kind === "ifs4") &&
      (target.de.condensation?.emitters.length ?? 0) > 0;
    const targetHasSchedule =
      (target.kind === "ifs" || target.kind === "ifs4") &&
      (target.de.schedule?.depth ?? 0) > 0 &&
      (target.de.schedule?.maps.length ?? 0) > 0;
    const targetHasChaos =
      (target.kind === "ifs" || target.kind === "ifs4") &&
      (target.de.chaos?.activeStateCount ?? 0) > 0;
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
        bufferEntry(9, "storage"),
        ...(lighting
          ? [
              {
                binding: 12,
                visibility: GPUShaderStage.COMPUTE,
                texture: { sampleType: "float" as const },
              },
            ]
          : []),
        ...(targetHasBalloon
          ? [
              {
                binding: 10,
                visibility: GPUShaderStage.COMPUTE,
                texture: { sampleType: "float" as const },
              },
            ]
          : []),
        ...(targetHasMesh ? [meshTextureLayoutEntry] : []),
      ],
    });
    // An ifs4 target compiles a SECOND, slab-free kernel pair beside the
    // full one: the shipped slider position is sliceHalfW 0, where the
    // slab pair's ext registers are pure occupancy tax. Both pairs share
    // the explicit bind group layouts below, so bind groups stay
    // variant-agnostic and runFrame's pick is a pipeline handle. A
    // !slabExact4 system (spherefold/mandelbox folds) can NEVER take a
    // slab query — the packer throws on sliceHalfW > 0 and the app clamps
    // the thickness slider — so its ONE pair compiles slab-free outright
    // and the A/B pair is skipped.
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
    // The frame seed: writes color/layer/states on the device, so no frame
    // stages them through the queue (surfaceComputeSeedWgsl's doc). Its
    // bindings reuse the shade kernel's numbers; the lit variant adds the
    // backdrop image and the sampler that reads it.
    const seedLayout = device.createBindGroupLayout({
      entries: [
        bufferEntry(0, "uniform"),
        bufferEntry(3, "storage"),
        bufferEntry(4, "uniform"),
        bufferEntry(6, "storage"),
        bufferEntry(9, "storage"),
        ...(lighting
          ? [
              {
                binding: 8,
                visibility: GPUShaderStage.COMPUTE,
                sampler: { type: "filtering" as const },
              },
              {
                binding: 12,
                visibility: GPUShaderStage.COMPUTE,
                texture: { sampleType: "float" as const },
              },
            ]
          : []),
      ],
    });
    const seedModule = device.createShaderModule({
      code: surfaceComputeSeedWgsl({ lighting }),
    });
    const seedErrors = (await seedModule.getCompilationInfo()).messages.filter(
      (m) => m.type === "error",
    );
    if (seedErrors.length > 0) {
      throw new Error(
        `Surface compute: seed WGSL compile failed:\n${seedErrors
          .map((m) => `${String(m.lineNum)}:${String(m.linePos)}: ${m.message}`)
          .join("\n")}`,
      );
    }
    const seedPipeline = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [seedLayout] }),
      compute: { module: seedModule, entryPoint: "seedFrame" },
    });

    const baseParamsBufferSize = isFourDTarget(target)
      ? targetHasSchedule
        ? targetHasCondensation
          ? targetHasBalloon
            ? SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_CONDENSATION_BYTES
            : target.groundPlane === true
              ? SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CONDENSATION_BYTES
              : SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_BYTES
          : targetHasBalloon
            ? SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_BYTES
            : target.groundPlane === true
              ? SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_BYTES
              : SURFACE_GPU_PARAMS4_SCHEDULE_BYTES
        : targetHasCondensation
          ? targetHasBalloon
            ? SURFACE_GPU_PARAMS4_BALLOON_CONDENSATION_BYTES
            : target.groundPlane === true
              ? SURFACE_GPU_PARAMS4_PLANE_CONDENSATION_BYTES
              : SURFACE_GPU_PARAMS4_CONDENSATION_BYTES
          : target.kind === "ifs4" && target.balloon === true
            ? SURFACE_GPU_PARAMS4_BALLOON_BYTES
            : target.kind === "escape4" && target.shapeTrap !== undefined
              ? // The trap block at the frozen 624, past the
                // unconditionally declared plane region — the 3D trap
                // sizing one dimension up.
                SURFACE_GPU_PARAMS4_TRAP_BYTES
              : target.groundPlane === true
                ? SURFACE_GPU_PARAMS4_PLANE_BYTES
                : target.kind === "escape4"
                  ? // The escape4 variant block is the lens4
                    // block's own region, so its size is the lens size.
                    SURFACE_GPU_PARAMS4_ESCAPE_BYTES
                  : target.de.foldFinal !== null || targetHasChaos
                    ? // A fold FINAL grows the params with
                      // the lens block past the 4D tail; a chaos
                      // session shares that base because its masks
                      // append after the unconditionally declared
                      // lens4 region (chaos bytes added below).
                      SURFACE_GPU_PARAMS4_LENS_BYTES
                    : SURFACE_GPU_PARAMS4_BYTES
      : targetHasSchedule
        ? targetHasCondensation
          ? targetHasBalloon
            ? SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_CONDENSATION_BYTES
            : target.groundPlane === true
              ? SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CONDENSATION_BYTES
              : SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_BYTES
          : targetHasBalloon
            ? SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_BYTES
            : target.groundPlane === true
              ? SURFACE_GPU_PARAMS_PLANE_SCHEDULE_BYTES
              : SURFACE_GPU_PARAMS_SCHEDULE_BYTES
        : targetHasCondensation
          ? targetHasBalloon
            ? SURFACE_GPU_PARAMS_BALLOON_CONDENSATION_BYTES
            : target.groundPlane === true
              ? SURFACE_GPU_PARAMS_PLANE_CONDENSATION_BYTES
              : SURFACE_GPU_PARAMS_CONDENSATION_BYTES
          : target.kind === "ifs" && target.balloon === true
            ? // The balloon kernel's params struct appends the balloon
              // block at the frozen offset 288 (272 before the lens-fold
              // quartet took that slot).
              SURFACE_GPU_PARAMS_BALLOON_BYTES
            : isForwardTarget(target) && target.shapeTrap !== undefined
              ? // A trap kernel's struct appends the trap block past the
                // (unconditionally declared) plane region — one size
                // whether or not the session has a floor.
                SURFACE_GPU_PARAMS_TRAP_BYTES
              : target.groundPlane === true
                ? // The plane kernel's struct appends the
                  // plane block at the same frozen offset (the two are
                  // mutually exclusive by the codegen throw).
                  SURFACE_GPU_PARAMS_PLANE_BYTES
                : SURFACE_GPU_PARAMS_BYTES;
    const paramsBufferSize =
      baseParamsBufferSize +
      (targetHasChaos ? SURFACE_GPU_CHAOS_BYTES : 0) +
      (target.tiling ? SURFACE_GPU_TILING_BYTES : 0) +
      (targetHasLensPost
        ? isFourDTarget(target)
          ? SURFACE_GPU_LENS4_POST_BYTES
          : SURFACE_GPU_LENS_POST_BYTES
        : 0);
    const paramsBuf = device.createBuffer({
      // Hybrid schedules append their live depth/map-range/bound block after
      // the legacy variant regions. Use the matching host allocation for
      // every balloon/plane/condensation combination; schedule-off sizes stay
      // exactly on the frozen ABI above.
      size: paramsBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const shadeBuf = device.createBuffer({
      // A patterned session's shade struct declares the calibration quartet
      // at 224 (SURFACE_GPU_SHADE_PATTERN_BYTES); the march struct still
      // ends at 224, and one buffer serves both pipelines of the pair — a
      // struct never reads past its own size, so binding the larger buffer
      // to the march pipeline is valid.
      size: lighting
        ? SURFACE_GPU_SHADE_LIGHTING_BYTES
        : materials?.pattern
          ? SURFACE_GPU_SHADE_PATTERN_BYTES
          : SURFACE_GPU_SHADE_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Re-wrapped copies: the kernel packers' bare Float32Array types
    // (ArrayBufferLike-backed) don't satisfy writeBuffer's non-shared
    // buffer requirement — the bench's own idiom. The BULB kernel never
    // DECLARES the maps binding, but the explicit bind group layouts
    // below keep entry 1 (a layout may carry entries a shader ignores),
    // so that target binds one zero stride there rather than forking
    // every layout/bind-group path. The ESCAPE kernel DOES read it (one
    // GpuMap per chain link, the document's transform list being the
    // formula sequence). A 4D target packs the GpuMap4 layout (144-byte
    // stride: eight vec4s for the fold lanes, nine with the authored fold
    // radii; its own field contract).
    const mapsData =
      target.kind === "escape"
        ? new Float32Array(packEscapeGpuMaps(target.de))
        : target.kind === "escape4"
          ? // The same chain one dimension up, in the GpuMap4
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
      packSurfaceGpuShadeMaps(
        colors,
        trapIndices,
        materials?.slots ?? undefined,
      ),
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
    const balloonLutTex = targetHasBalloon
      ? device.createTexture({
          size: { width: 256, height: 1 },
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        })
      : null;
    if (balloonLutTex) {
      device.queue.writeTexture(
        { texture: balloonLutTex },
        WHITE_LUT,
        { bytesPerRow: 256 * 4 },
        { width: 256, height: 1 },
      );
    }
    const meshAtlas = targetHasMesh ? activeMeshSdfAtlas(targetMeshIds) : null;
    const meshSdfTex = meshAtlas
      ? device.createTexture({
          size: {
            width: meshAtlas.width,
            height: meshAtlas.height,
            depthOrArrayLayers: meshAtlas.depth,
          },
          dimension: "3d",
          format: "r32float",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        })
      : null;
    if (meshAtlas && meshSdfTex) {
      device.queue.writeTexture(
        { texture: meshSdfTex },
        meshAtlas.values,
        {
          bytesPerRow: meshAtlas.width * Float32Array.BYTES_PER_ELEMENT,
          rowsPerImage: meshAtlas.height,
        },
        {
          width: meshAtlas.width,
          height: meshAtlas.height,
          depthOrArrayLayers: meshAtlas.depth,
        },
      );
    }
    const lutSamp = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    const lightingBackgroundTex = lighting
      ? device.createTexture({
          size: { width: 1, height: 1 },
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        })
      : null;
    if (lightingBackgroundTex) {
      device.queue.writeTexture(
        { texture: lightingBackgroundTex },
        new Uint8Array([0, 0, 0, 255]),
        { bytesPerRow: 4 },
        { width: 1, height: 1 },
      );
    }

    const seedBuf = device.createBuffer({
      size: SURFACE_GPU_SEED_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
      seedPipeline,
      seedLayout,
      seedBuf,
      paramsBuf,
      shadeBuf,
      mapsBuf,
      shadeMapsBuf,
      lutTex,
      balloonLutTex,
      meshSdfTex,
      lightingBackgroundTex,
      lighting,
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
   * The largest raster this device can trace as ONE frame, in rays —
   * {@link surfaceComputeMaxFrameRays} of its real limits. Callers that
   * own the raster read it: captures TILE against it
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
   * NOT "device gone": with a frame still parked on live submitted GPU
   * work, the real `device.destroy()` is deferred until
   * {@link framesInFlight} drains to zero. See {@link deviceDestroyed}
   * for
   * the device's actual state. */
  private destroyed = false;
  /** True once `device.destroy()` has actually run. Both {@link destroy}
   * (nothing was in flight) and {@link releaseFrame} (the last in-flight
   * frame just unwound) can reach the real teardown, and since `destroyed`
   * alone no longer tells the two apart, this is the guard that keeps
   * either path from calling `device.destroy()` a second time. */
  private deviceDestroyed = false;
  private frameToken = 0;
  /** The session's own fence round-trip in ms, measured once by the first
   * frame's calibration probes and subtracted from every later dispatch
   * before a sizing model sees it — {@link surfaceComputeDispatchWorkMs}
   * for what that buys and why it is measured per SESSION rather than
   * assumed per browser. `null` means "not calibrated yet", which is a
   * zero subtraction. */
  private fenceMs: number | null = null;
  /** Frames between their {@link renderFrame} call and their final
   * unwind. A frame parks on LIVE submitted GPU work (`mapAsync` over a
   * submitted `copyBufferToBuffer`, `onSubmittedWorkDone` over a
   * submitted dispatch), and destroying the device out from under one of
   * those takes the whole browser process down on Firefox — so
   * {@link destroy} hands the real teardown to whichever frame unwinds
   * last instead of running
   * it out from under a live await. */
  private framesInFlight = 0;
  /** Serializes frames: they share buffers and staging maps, so two pass
   * loops must never interleave. */
  private chain: Promise<unknown> = Promise.resolve();
  private frame: FrameBuffers | null = null;
  /** {@link runFrame}'s identity active list, contents pass-invariant, so
   * it is cached at exact size and refilled only when the raster changes.
   * Nothing writes into it once built: the pass loop reads `active` and
   * rebinds its local at each sweep's rebuild. (The ray STATES are seeded on
   * the device instead — {@link SurfaceComputeRendererInit.seedPipeline}.) */
  private activeSeed: Uint32Array<ArrayBuffer> | null = null;
  /** {@link runSamples}' supersampling accumulators, zero-filled per job —
   * the sibling of scene.ts's `beginSurfaceSamples` reuse. */
  private sampleAccum: Float32Array | null = null;
  private sampleLayerAccum: Float32Array | null = null;
  private sampleCoc: Uint8Array | null = null;
  private uploadedLutVersion: number | null = null;
  private uploadedBalloonLutVersion: number | null = null;
  private readonly device: GPUDevice;
  private readonly target: SurfaceComputeTarget;
  private readonly marchPipeline: GPUComputePipeline;
  private readonly marchLayout: GPUBindGroupLayout;
  private readonly shadePipeline: GPUComputePipeline;
  private readonly shadeLayout: GPUBindGroupLayout;
  /** ifs4 only: the slab-free kernel pair every sliceHalfW=0 frame rides
   * — null for every other target kind. */
  private readonly marchPipelineNoSlab: GPUComputePipeline | null;
  private readonly shadePipelineNoSlab: GPUComputePipeline | null;
  /** See {@link SurfaceComputeRendererInit.seedPipeline}. */
  private readonly seedPipeline: GPUComputePipeline;
  private readonly seedLayout: GPUBindGroupLayout;
  private readonly seedBuf: GPUBuffer;
  private readonly paramsBuf: GPUBuffer;
  private readonly shadeBuf: GPUBuffer;
  private readonly mapsBuf: GPUBuffer;
  private readonly shadeMapsBuf: GPUBuffer;
  private readonly lutTex: GPUTexture;
  private readonly balloonLutTex: GPUTexture | null;
  private readonly meshSdfTex: GPUTexture | null;
  private lightingBackgroundTex: GPUTexture | null;
  private lightingBackgroundSize: [number, number] = [1, 1];
  private uploadedLightingBackground: TraceBackgroundImage | null = null;
  private readonly lighting: boolean;
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
    this.seedPipeline = init.seedPipeline;
    this.seedLayout = init.seedLayout;
    this.seedBuf = init.seedBuf;
    this.paramsBuf = init.paramsBuf;
    this.shadeBuf = init.shadeBuf;
    this.mapsBuf = init.mapsBuf;
    this.shadeMapsBuf = init.shadeMapsBuf;
    this.lutTex = init.lutTex;
    this.balloonLutTex = init.balloonLutTex ?? null;
    this.meshSdfTex = init.meshSdfTex ?? null;
    this.lightingBackgroundTex = init.lightingBackgroundTex ?? null;
    this.lighting = init.lighting ?? false;
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
    // A queued frame must retain the rig authored at request time; mutable
    // nested light/medium arrays must not follow a later UI edit. Backdrop
    // images already carry the immutable content/revision contract.
    const snapshot = spec.lighting
      ? {
          ...spec,
          lighting: cloneSurfaceLighting(spec.lighting),
          ...(spec.lightingRuntime
            ? { lightingRuntime: { ...spec.lightingRuntime } }
            : {}),
        }
      : spec;
    const token = ++this.frameToken;
    // Counted from here to the .finally below, whatever the outcome —
    // this is the span destroy() waits out before it is safe to actually
    // tear the device down.
    this.framesInFlight++;
    const run = this.chain
      .then(() =>
        this.runSamples(token, snapshot, opts).catch((error: unknown) => {
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
   * The supersampling wrapper: `opts.samples` passes of {@link runFrame}
   * at {@link subPixelSample} offsets, averaged in LINEAR light. At
   * `samples <= 1` it is {@link runFrame} itself, call for call.
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
   * supersampling, so the caller can never end up with less than it used
   * to get. A TRUNCATED sample (a wall budget cut mid-pass) ends the
   * refinement too: its unresolved pixels still carry the frame seed's
   * uncovered backdrop, so folding it in would dilute the mean with
   * pixels that were never traced.
   */
  private async runSamples(
    token: number,
    spec: SurfaceComputeFrameSpec,
    opts: SurfaceComputeFrameOptions,
  ): Promise<SurfaceComputeFrame | null> {
    const samples = Math.max(1, Math.floor(opts.samples ?? 1));
    if (samples === 1) return this.runFrame(token, spec, opts);
    const rays = spec.width * spec.height;
    const accum =
      this.sampleAccum?.length === rays * 3
        ? this.sampleAccum.fill(0)
        : (this.sampleAccum = new Float32Array(rays * 3));
    const layerAccum =
      this.sampleLayerAccum?.length === rays * 3
        ? this.sampleLayerAccum.fill(0)
        : (this.sampleLayerAccum = new Float32Array(rays * 3));
    const frontmostCoc =
      this.sampleCoc?.length === rays
        ? this.sampleCoc.fill(255)
        : (this.sampleCoc = new Uint8Array(rays).fill(255));
    let taken = 0;
    let out: SurfaceComputeFrame | null = null;
    let wallMs = 0;
    let gpuMs = 0;
    let lightingExhausted = 0;
    let lightingInvalid = 0;
    // ONE hit-shade sizer for the whole job. Every pass here traces the
    // SAME pose at the SAME raster with the SAME DE — only the sub-pixel
    // offset moves — so the cost model pass 0 measured is exactly the
    // model passes 1..N-1 need, and re-deriving it from one workgroup
    // each time costs the job N climbs for one frame's worth of
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
              ? (pixels, layers, done, total) => {
                  opts.onProgress?.(pixels, layers, done, total * samples);
                }
              : undefined,
        },
        subPixelSample(s),
        jobSizer,
        s,
        samples,
      );
      if (!frame) break;
      wallMs += frame.wallMs;
      gpuMs += frame.gpuMs;
      if (s > 0 && frame.truncated) break;
      lightingExhausted += frame.lightingVisibility?.exhausted ?? 0;
      lightingInvalid += frame.lightingVisibility?.invalid ?? 0;
      const px = frame.pixels;
      const layers = frame.layers;
      for (let i = 0, p = 0, a = 0; i < rays; i++, p += 4, a += 3) {
        accum[a] += frame.linearPixels?.[p] ?? SRGB_TO_LINEAR[px[p]];
        accum[a + 1] +=
          frame.linearPixels?.[p + 1] ?? SRGB_TO_LINEAR[px[p + 1]];
        accum[a + 2] +=
          frame.linearPixels?.[p + 2] ?? SRGB_TO_LINEAR[px[p + 2]];
      }
      foldSurfaceComputeLayerSample(layerAccum, frontmostCoc, layers);
      taken++;
      if (s === 0) {
        // Pass 0 IS the pre-supersampling frame — hand it back untouched
        // (its own runFrame already presented its partials), so a job
        // superseded here delivers exactly what this
        // renderer delivered before supersampling existed.
        out = { ...frame, wallMs, gpuMs };
      } else {
        const mean = encodeLinearMean(accum, taken, px);
        const layerMean = encodeSurfaceComputeLayerMean(
          layerAccum,
          taken,
          frontmostCoc,
        );
        out = { ...frame, pixels: mean, layers: layerMean, wallMs, gpuMs };
        // The completed mean is what later samples present; their in-flight
        // prefill remains deliberately uncovered background.
        opts.onProgress?.(mean, layerMean, taken * rays, samples * rays);
      }
      if (out && this.lighting)
        out.lightingVisibility = {
          exhausted: lightingExhausted,
          invalid: lightingInvalid,
        };
      if (frame.truncated) break;
    }
    return out;
  }

  /** Supersede any in-flight and queued frames — they resolve null at
   * their next await. */
  cancel(): void {
    this.frameToken++;
  }

  /** Update the one live field of an existing lattice target. Pipelines and
   * buffer sizes are unchanged because kind and clip stay frozen; the next
   * frame's params pack reads the new canonical `h`. Cancel first so an
   * in-flight multi-pass frame cannot mix two cell sizes. */
  setLatticeScale(cellScale: number): void {
    const current = this.target.tiling;
    if (!current || !isResolvedLatticeTiling(current)) return;
    const next = resolveTiling(
      {
        kind: "lattice",
        cellScale,
        ...(current.clip ? { clip: current.clip } : {}),
      },
      current.radius,
      latticePresentationPolicyOf(current.presentation),
    );
    if (!next || !isResolvedLatticeTiling(next)) {
      throw new Error("Surface compute: failed to resolve live lattice scale");
    }
    if (next.h === current.h) return;
    this.cancel();
    this.target.tiling = next;
  }

  /** Cancel, then tear the device down — immediately if nothing is in
   * flight, or deferred to {@link releaseFrame} if a frame is still
   * parked on live submitted GPU work. Destroying the device under a
   * pending `mapAsync`/`onSubmittedWorkDone` takes the whole browser
   * process down on Firefox, so this hands the real `device.destroy()`
   * call to whichever frame unwinds last rather than running it out from
   * under one; the token bump below already guarantees no NEW work gets
   * submitted meanwhile, so the only cost of waiting is one device
   * outliving its session by the length of one in-flight frame. Safe to
   * call twice — the early return below means a second call during that
   * deferred window is a no-op and will NOT retry the teardown, which is
   * fine only because the FIRST call already committed it to
   * {@link releaseFrame}. `onLost` does not fire for a deliberate
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
   * this is the last one out and owes the deferred teardown. */
  private releaseFrame(): void {
    this.framesInFlight--;
    if (this.framesInFlight === 0 && this.destroyed) this.destroyDevice();
  }

  /** The actual `GPUDevice.destroy()` call, behind the one-shot
   * {@link deviceDestroyed} guard: reachable from both {@link destroy}
   * (idle — nothing was in flight) and {@link releaseFrame} (busy —
   * something was, and just finished), and since `destroyed` alone no
   * longer distinguishes those two calls from the outside, the guard is
   * what keeps them from ever destroying the
   * device twice. */
  private destroyDevice(): void {
    if (this.deviceDestroyed) return;
    this.deviceDestroyed = true;
    this.device.destroy();
  }

  /**
   * {@link ensureFrameBuffers} with the device's own verdict attached. A
   * frame's eight per-ray buffers are the only allocation that scales with
   * the caller's raster, and WebGPU reports both ways it can fail WITHOUT
   * throwing: an over-limit size is a validation error returning an
   * invalid buffer, an exhausted allocator an out-of-memory one. Either
   * way the first REJECTION comes from a staging `mapAsync` several
   * awaits later ("Invalid buffer" — the field report), so the size that
   * caused it is checked up front and the scopes convert what is left
   * into an error that names it.
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
          `(${mib(rays * (this.lighting ? SURFACE_COMPUTE_LIGHTING_RAY_BYTES : SURFACE_COMPUTE_RAY_BYTES))} of buffers) failed: ` +
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
      this.frame.layer,
      this.frame.status,
      this.frame.stagingStatus,
      this.frame.stagingColor,
      this.frame.stagingLayer,
    ]) {
      b.destroy();
    }
    this.frame = null;
  }

  private ensureFrameBuffers(rays: number): FrameBuffers {
    if (this.frame && this.frame.rays >= rays) return this.frame;
    this.releaseFrameBuffers();
    const device = this.device;
    // The states buffer is no longer a COPY_SRC — nothing reads it back.
    // The host's per-sweep question is one field of it, and the march
    // answers that directly through `status`.
    const states = device.createBuffer({
      size: rays * SURFACE_COMPUTE_RAY_STATE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const active = device.createBuffer({
      size: rays * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const color = device.createBuffer({
      size: rays * (this.lighting ? 16 : 4),
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
    const layer = device.createBuffer({
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
      size: rays * (this.lighting ? 16 : 4),
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const stagingLayer = device.createBuffer({
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
        ...(this.meshSdfTex
          ? [
              {
                binding: 11,
                resource: this.meshSdfTex.createView({ dimension: "3d" }),
              },
            ]
          : []),
      ],
    });
    const shadeBindGroup = this.createShadeBindGroup(
      active,
      states,
      color,
      layer,
    );
    // After the march and shade groups, so their creation order is unchanged.
    const seedBindGroup = this.createSeedBindGroup(states, color, layer);
    this.frame = {
      rays,
      states,
      active,
      color,
      layer,
      status,
      stagingStatus,
      stagingColor,
      stagingLayer,
      marchBindGroup,
      shadeBindGroup,
      seedBindGroup,
    };
    return this.frame;
  }

  private createShadeBindGroup(
    active: GPUBuffer,
    states: GPUBuffer,
    color: GPUBuffer,
    layer: GPUBuffer,
  ): GPUBindGroup {
    return this.device.createBindGroup({
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
        { binding: 9, resource: { buffer: layer } },
        ...(this.lightingBackgroundTex
          ? [{ binding: 12, resource: this.lightingBackgroundTex.createView() }]
          : []),
        ...(this.balloonLutTex
          ? [
              {
                binding: 10,
                resource: this.balloonLutTex.createView(),
              },
            ]
          : []),
        ...(this.meshSdfTex
          ? [
              {
                binding: 11,
                resource: this.meshSdfTex.createView({ dimension: "3d" }),
              },
            ]
          : []),
      ],
    });
  }

  /** Called only inside the serialized frame span, after all earlier GPU
   * work unwound. Replacing a texture rebuilds the two bind groups that bind
   * it — the shade group and the frame seed's. Returns the bytes it staged
   * through `writeTexture` (0 when nothing changed), which count toward the
   * first fence group's staged-bytes bound. */
  private prepareLightingBackground(
    image: TraceBackgroundImage | undefined,
  ): number {
    if (!image || !this.lighting) return 0;
    const previous = this.uploadedLightingBackground;
    if (
      previous &&
      previous.width === image.width &&
      previous.height === image.height &&
      previous.revision === image.revision &&
      previous.rgba === image.rgba
    )
      return 0;
    // Reuse the shared image validator before allocation/upload.
    sampleTraceBackgroundImage(image, 0.5, 0.5);
    if (
      image.width > this.device.limits.maxTextureDimension2D ||
      image.height > this.device.limits.maxTextureDimension2D
    ) {
      throw new SurfaceComputeFrameSizeError(
        "Surface compute: lighting background exceeds the device texture limit",
      );
    }
    if (
      this.lightingBackgroundSize[0] !== image.width ||
      this.lightingBackgroundSize[1] !== image.height
    ) {
      this.lightingBackgroundTex?.destroy();
      this.lightingBackgroundTex = this.device.createTexture({
        size: { width: image.width, height: image.height },
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.lightingBackgroundSize = [image.width, image.height];
      if (this.frame) {
        const frame = this.frame;
        frame.shadeBindGroup = this.createShadeBindGroup(
          frame.active,
          frame.states,
          frame.color,
          frame.layer,
        );
        frame.seedBindGroup = this.createSeedBindGroup(
          frame.states,
          frame.color,
          frame.layer,
        );
      }
    }
    if (!this.lightingBackgroundTex)
      throw new Error(
        "Surface compute: lighting background texture is missing",
      );
    this.device.queue.writeTexture(
      { texture: this.lightingBackgroundTex },
      new Uint8Array(image.rgba),
      { bytesPerRow: image.width * 4 },
      { width: image.width, height: image.height },
    );
    this.uploadedLightingBackground = image;
    return image.rgba.byteLength;
  }

  /** The frame seed's bind group, at the shade kernel's binding numbers
   * (`surfaceComputeSeedWgsl`'s doc). It binds the session's own shade
   * uniform, and — lit — the same backdrop texture and sampler the shade
   * group does, so {@link prepareLightingBackground} rebuilds both. */
  private createSeedBindGroup(
    states: GPUBuffer,
    color: GPUBuffer,
    layer: GPUBuffer,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.seedLayout,
      entries: [
        { binding: 0, resource: { buffer: this.seedBuf } },
        { binding: 3, resource: { buffer: states } },
        { binding: 4, resource: { buffer: this.shadeBuf } },
        { binding: 6, resource: { buffer: color } },
        { binding: 9, resource: { buffer: layer } },
        ...(this.lightingBackgroundTex
          ? [
              { binding: 8, resource: this.lutSamp },
              {
                binding: 12,
                resource: this.lightingBackgroundTex.createView(),
              },
            ]
          : []),
      ],
    });
  }

  /** Copy the immutable reference and its layer sidecar in one submission,
   * then map both staging buffers together. Their row/ray order is identical
   * by construction, so callers always receive an aligned pair. */
  private async readbackFrame(
    color: GPUBuffer,
    stagingColor: GPUBuffer,
    layer: GPUBuffer,
    stagingLayer: GPUBuffer,
    bytes: number,
    colorBytes = bytes,
  ): Promise<[ArrayBuffer, ArrayBuffer]> {
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(color, 0, stagingColor, 0, colorBytes);
    encoder.copyBufferToBuffer(layer, 0, stagingLayer, 0, bytes);
    this.device.queue.submit([encoder.finish()]);
    return Promise.all([
      this.drainStaging(stagingColor, colorBytes),
      this.drainStaging(stagingLayer, bytes),
    ]);
  }

  /** Map, copy out and unmap a staging buffer whose bytes are ALREADY on
   * the queue — the march statuses arrive that way, one copy per slice
   * riding the slice's own submission, so the sweep pays one `mapAsync`
   * round trip rather than one per slice. `mapAsync` queues behind
   * everything already submitted, which is the same ordering
   * guarantee {@link readbackFrame} leans on. */
  private async drainStaging(
    staging: GPUBuffer,
    bytes: number,
  ): Promise<ArrayBuffer> {
    await staging.mapAsync(GPUMapMode.READ, 0, bytes);
    // Copy out BEFORE unmap(): unmap() detaches the range getMappedRange()
    // views, and a throw between map and unmap would leave the buffer
    // wedged mapped for every later mapAsync.
    try {
      return staging.getMappedRange(0, bytes).slice(0);
    } finally {
      staging.unmap();
    }
  }

  private async runFrame(
    token: number,
    spec: SurfaceComputeFrameSpec,
    opts: SurfaceComputeFrameOptions,
    /** This pass's sub-pixel sample position. The default is the pixel
     * centre — the value every ray derivation used to hardcode — so
     * a single-sample frame is the pre-supersampling one. */
    pixelJitter: [number, number] = [0.5, 0.5],
    /** The supersampling job's shared hit-shade sizer state, mutated in
     * place so each pass starts where the last one converged.
     * Absent = a fresh model and a one-workgroup capacity. */
    jobSizer?: ShadeSizerState,
    sampleIndex = 0,
    /** How many passes the job this frame belongs to runs — only the
     * `?surfacemediumcells` experiment lever reads it. */
    sampleCount = 1,
  ): Promise<SurfaceComputeSample | null> {
    const trace = surfaceComputeTrace;
    // Read once per frame beside the trace sink, so a pin can never change
    // under a frame that is already scheduling against it (see
    // {@link surfaceComputeMarchChunkPin}).
    const marchChunkPin = surfaceComputeMarchChunkPin;
    const marchStepsPin = surfaceComputeMarchStepsPin;
    const shadeHitsPin = surfaceComputeShadeHitsPin;
    const mediumCellsPin = surfaceComputeMediumCellsPin;
    const mediumStridePin = surfaceComputeMediumStridePin;
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
    if (this.lighting !== (spec.lighting !== undefined)) {
      throw new Error(
        "Surface compute: lighting presence must match the session compile gate",
      );
    }
    const lighting = spec.lighting
      ? resolveSurfaceLighting(spec.lighting)
      : undefined;
    const runtime = lighting
      ? {
          ...(spec.lightingRuntime ??
            surfaceLightingRuntime(lighting, {
              interaction: Number.isFinite(budgetMs),
              dimension: isFourDTarget(this.target) ? 4 : 3,
              boundingRadius: this.target.de.boundingRadius,
            })),
          sampleIndex: (spec.lightingRuntime?.sampleIndex ?? 0) + sampleIndex,
          cellStart: 0,
          cellCount: 1,
          phase: 0 as const,
          lightIndex: -1,
        }
      : undefined;
    // Read the same clamped runtime lanes the shader receives; hostile or
    // manually constructed frame specs cannot multiply host dispatch loops.
    const lightingLanes = lighting
      ? surfaceLightingLanes(lighting, runtime)
      : undefined;
    const mediumCells =
      lighting?.medium && lighting.medium.density > 0
        ? (mediumCellsPin ?? lightingLanes![41])
        : 0;
    const mediumLights = mediumCells > 0 ? lighting!.lights.length : 0;
    // `?surfacemediumcells`: the job's pass count S, so pass k's N cells are
    // strata k, k+S, k+2S, ... of an N·S-cell partition. Null = restored.
    const mediumStrataPasses =
      mediumLights > 0 && mediumCellsPin !== null
        ? Math.max(1, Math.floor(sampleCount))
        : null;
    if (
      mediumLights > 0 &&
      (mediumCellsPin !== null || mediumStridePin !== null)
    ) {
      tr(
        `medium experiment cellsPerPass=${mediumCells} strata=${mediumCells * (mediumStrataPasses ?? 1)} pass=${sampleIndex}/${mediumStrataPasses ?? 1} stride=${mediumStridePin ?? 1}`,
      );
    }
    const colorBytes = rays * (this.lighting ? 16 : 4);
    /** Bytes put through `queue.writeBuffer`/`writeTexture` since the last
     * fence — the fence group's second closing rule
     * ({@link surfaceComputeFenceGroupStagedFull}). Everything this frame
     * stages goes through {@link stage} or adds itself here. */
    let stagedBytes = this.prepareLightingBackground(spec.lightingBackground);
    const stage = (
      buffer: GPUBuffer,
      data: ArrayBuffer | ArrayBufferView<ArrayBuffer>,
    ): void => {
      device.queue.writeBuffer(buffer, 0, data);
      stagedBytes += data.byteLength;
    };
    /** Stage the participating medium's dispatch-phase lane
     * (cell start, cell count, phase, light) ahead of the submission that
     * reads it. */
    const stagePhase = (
      cell: number,
      count: number,
      phase: number,
      light: number,
    ): void => {
      device.queue.writeBuffer(
        this.shadeBuf,
        SURFACE_GPU_SHADE_LIGHTING_PHASE_OFFSET,
        new Float32Array([cell, count, phase, light]),
      );
      stagedBytes += 16;
    };
    const buffers = await this.allocateFrameBuffers(rays);
    if (token !== this.frameToken || this.isLost || this.destroyed) return null;

    // An absent bgOffset/bgExtent means an ordinary frame — this raster
    // IS the full image (module doc on SurfaceComputeFrameSpec).
    const bgOffset: [number, number] = spec.bgOffset ?? [0, 0];
    const bgExtent: [number, number] = spec.bgExtent ?? [width, height];
    // An absent bgShape means linear, the shape that shipped first.
    const bgShape: BackgroundShapeSpec = spec.bgShape ?? {
      kind: DEFAULT_BACKGROUND_SHAPE,
    };
    const bgCenter: [number, number] =
      bgShape.center ?? DEFAULT_BACKGROUND_SHAPE_CENTER;
    const bgScale: [number, number] = bgShape.scale ?? [1, 1];

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
      stagedBytes += 256 * 4;
    }
    if (
      this.balloonLutTex &&
      spec.balloonLut &&
      (spec.balloonLutVersion ?? 0) !== this.uploadedBalloonLutVersion
    ) {
      device.queue.writeTexture(
        { texture: this.balloonLutTex },
        new Uint8Array(spec.balloonLut),
        { bytesPerRow: 256 * 4 },
        { width: 256, height: 1 },
      );
      this.uploadedBalloonLutVersion = spec.balloonLutVersion ?? 0;
      stagedBytes += 256 * 4;
    }
    const shadePack = packSurfaceGpuShade({
      invProjView: spec.invProjView,
      lightDir: spec.lightDir,
      ambient: spec.ambient,
      lighting,
      lightingRuntime: runtime,
      lightingBackground: this.lighting && !!spec.lightingBackground,
      bgTop: spec.bgTop,
      bgBottom: spec.bgBottom,
      colorSpeed: spec.colorSpeed,
      tracePixelEps: spec.tracePixelEps,
      colorSource: spec.colorSource,
      shadowSteps: spec.shadowSteps,
      aoTaps: spec.aoTaps,
      dither: spec.dither,
      balloonPalette: this.balloonLutTex !== null && !!spec.balloonLut,
      fogTint: spec.fogTint,
      fogTintStrength: spec.fogTintStrength,
      // Ground and balloon kernels are mutually exclusive. Reuse the
      // balloon tint tail for the floor's shading-only appearance so the
      // frozen ShadeParams layout does not grow: (tile, emission, pattern).
      balloonTint: spec.groundPlane
        ? [
            spec.groundPlane.tileScale ?? 0.64,
            spec.groundPlane.emission ?? 0,
            spec.groundPlane.pattern ?? 0,
          ]
        : spec.balloonTint,
      balloonTintStrength: spec.balloonTintStrength,
      // The pattern arm's native-carrier calibration, present exactly
      // when the session compiled the pattern gate — the shade struct's
      // conditional member at 224 (the buffer was sized 240 above).
      patternCalibration:
        spec.materials?.pattern === true
          ? [
              spec.materials.patternCalibration.ringsLow,
              spec.materials.patternCalibration.ringsInvSpan,
              spec.materials.patternCalibration.sheetsLow,
              spec.materials.patternCalibration.sheetsInvSpan,
            ]
          : undefined,
      pixelJitter,
      envStrength: spec.envLight,
      bgOffset,
      bgExtent,
      bgCenter,
      bgScale,
      bgShape: backgroundShapeCode(bgShape.kind),
    });
    if (mediumStrataPasses !== null) {
      // `?surfacemediumcells`: the segment is partitioned into N·S cells
      // (lane 10.y, deliberately past the lanes' 32 clamp — the WGSL phase-1
      // loop has no constant bound), and the in-scatter is weighted by S
      // through the medium tint (lane 8.xyz), which only the in-scatter term
      // reads, so the job's linear mean sums every cell exactly once.
      const lanes = new Float32Array(shadePack);
      const base = SURFACE_GPU_SHADE_PATTERN_BYTES / 4;
      lanes[base + 41] = mediumCells * mediumStrataPasses;
      for (let c = 0; c < 3; c++) lanes[base + 32 + c] *= mediumStrataPasses;
    }
    stage(this.shadeBuf, shadePack);
    // Composite-layer seed contract: rays still ACTIVE at a budget cut are
    // uncovered background in BOTH buffers. A prior frame's RGB cannot be
    // paired with coverage zero under this frame's background reference:
    // the first edit would apply the wrong delta to stale geometry. The
    // layer describes this frame's CURRENT trace — uncovered, unfogged and
    // wholly background-responsive (beta 1) until a ray reaches a terminal
    // shade — so a truncated frame's active metadata cannot masquerade as
    // the previous frame's settled geometry. Every ray starts ACTIVE and
    // unmarched.
    //
    // All three are written ON THE DEVICE by the seed kernel, which reads
    // the shade uniform staged just above. Staging them through writeBuffer
    // (24 B/ray unlit, 36 lit) is the volume that exhausts Firefox's device
    // ({@link SURFACE_COMPUTE_FENCE_GROUP_MAX}). The submission lands ahead
    // of the first march in queue order, so every readback sees seeded
    // values, and rides the first fence rather than paying its own; nothing
    // awaits between the token check above and these submits.
    for (const tile of surfaceComputeSeedDispatches(
      width,
      height,
      device.limits,
    )) {
      stage(
        this.seedBuf,
        packSurfaceGpuSeed(width, height, tile.originX, tile.originY),
      );
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.seedPipeline);
      pass.setBindGroup(0, buffers.seedBindGroup);
      pass.dispatchWorkgroups(tile.groupsX, tile.groupsY);
      pass.end();
      device.queue.submit([encoder.finish()]);
    }

    let active: Uint32Array<ArrayBuffer>;
    if (this.activeSeed !== null && this.activeSeed.length === rays) {
      active = this.activeSeed;
    } else {
      active = new Uint32Array(rays);
      for (let i = 0; i < rays; i++) active[i] = i;
      this.activeSeed = active;
    }
    // Rays that turned terminal in a march pass, awaiting a shade batch.
    // The QUEUES are the v2 architecture's point: shading a freshly-HIT
    // ray costs ~40 zero-cutoff on-surface DE evals — orders of
    // magnitude more than a march step — and letting it ride the march
    // pass that terminated it measured 1.1-5.3s submissions and a real
    // device loss on Iris (the i915 watchdog through the shading door).
    // Hits and misses queue SEPARATELY because their costs differ by
    // those same orders of magnitude and the arrival order is
    // scanline-coherent: a shared ray-unit queue let miss runs inflate
    // the batch size that a following hit band then paid — the module
    // doc's five kernel- confirmed GPU hangs. Host-sized pure batches
    // keep every shading submission bounded in the unit that actually
    // costs.
    let shadeHitQueue: number[] = [];
    let shadeFreeQueue: number[] = [];
    // Empty mist regions cannot authorize wider geometry batches.
    const lightingCovered = this.lighting ? new Uint8Array(rays) : null;
    // The one pin with no downstream Math.min (see the chunk and hit
    // pins' own consumption sites below), so it is clamped here — the
    // one place a pin value becomes stepsThisPass — rather than left to
    // grow into a per-dispatch step count a hostile URL could pick.
    let stepsThisPass = Math.min(
      marchStepsPin ?? 1,
      SURFACE_COMPUTE_MARCH_STEPS_PIN_CAP,
    );
    // Sub-ray credit bookkeeping: march steps issued to every surviving
    // active ray by COMPLETED sweeps, and how many of the current
    // sweep's rays have been dispatched so far (those hold stepsThisPass
    // steps more). Exact for still-active rays — the kernel's march loop
    // exits early only on terminal transitions.
    let sweepSteps = 0;
    let sweepSliced = 0;
    // The hit-shade cost model and its capacity ladder. A supersampling
    // JOB hands the same carrier to every pass: passes 1..N-1 differ
    // from pass 0 by a sub-pixel offset and NOTHING else — same pose,
    // same raster, same DE, same hits — so re-learning the model from
    // one workgroup eight times over is eight ramps paid for one frame's
    // worth of information. A single-sample frame gets a fresh model,
    // which is where the ladder's first-encounter bound belongs.
    const sizer: ShadeSizerState = jobSizer ?? {
      cost: initialShadeHitCost(),
      cap: SURFACE_COMPUTE_SHADE_HIT_CAP_START,
    };
    const lightingSizer = this.lighting
      ? (sizer.lighting ??= {
          surfaceCost: initialShadeHitCost(),
          mediumCost: initialShadeHitCost(),
          lastCellMs: 0,
          // One workgroup until the frame's own dispatches say a wider one
          // fits — {@link nextLightingRayCap}. `?surfaceshadehits=N` FIXES
          // the width instead, which is the offline lever a two-term fit
          // needs (`nextShadeHitCost`'s own record: "over a WIDE lever or
          // not at all") and is how this path's terms were identified.
          rayCap: shadeHitsPin ?? SURFACE_COMPUTE_WORKGROUP_SIZE,
        })
      : null;
    // A fold FINAL lens multiplies every march step by its branch sweep
    // — 27 boxfold / 3 spherefold / 81 mandelbox branches around the
    // core, discounted /8 for the prunes' measured-typical survival
    // (surfaceDescentCostWeight's factor, surface-de.ts) — so
    // first-slice sizing starts from a proportionally raised prior and
    // stays watchdog-safe before the EMA takes over. The SHADE side
    // carries no prior at all (see SURFACE_COMPUTE_SHADE_HIT_CAP_START):
    // its first batch is one workgroup whatever a prior would have said,
    // so scaling one only lengthened the climb back out. (Both FORWARD
    // kinds scale nothing: the orbit is phone-cheap — the bulb measured
    // 3.5x CHEAPER per eval than the fold mode (bulb-de.ts's verdict) —
    // and the pessimistic base prior only errs toward smaller first
    // slices. Affine 4D targets scale nothing either — the affine4
    // ladder starts from the same pessimistic base prior the 3D affine
    // class would. FOLD-shaped 4D targets scale: the base
    // prior absorbed the 3D fold class's 27/81-branch fans, and the 4D
    // fans are 3x wider — 81 boxfold / 243 mandelbox — so the first
    // slice scales by maxFan/27 (spherefold's 3 stays at the floor); a
    // 4D fold FINAL multiplies its own fan/8 exactly like the 3D lens.)
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
      (lensKind === undefined || lensKind === SURFACE_LENS_SWIRL
        ? 1
        : Math.max(
            1,
            (lensFan4 ?? (lensKind === 1 ? 27 : lensKind === 2 ? 3 : 81)) / 8,
          ));
    // The balloon union pays the inverted shell eval on top of the
    // fractal term — the balloon spike measured rest-state march steps
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
    // A plane session's spec must carry the live floor block
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
    // The trap session's live block, resolved once per frame — a
    // trap-kernel frame spec must carry the document block (the trap-grown
    // params struct has no meaningful default; the balloon's required-throw
    // discipline). A trap-free session ignores any stray spec.shapeTrap —
    // its buffer never grew.
    const shapeTrap =
      isForwardTarget(target) && target.shapeTrap !== undefined
        ? (() => {
            const st = spec.shapeTrap;
            if (!st) {
              throw new Error(
                "Surface compute: a shape-trap frame spec must carry shapeTrap",
              );
            }
            return resolveShapeTrap(st);
          })()
        : null;
    const packParams: (run: SurfaceGpuRunParams) => ArrayBuffer =
      target.kind === "escape"
        ? (run) =>
            packEscapeGpuParams(
              target.de,
              run,
              groundPlane,
              shapeTrap,
              target.tiling ?? null,
            )
        : target.kind === "escape4"
          ? (run) =>
              packEscape4GpuParams(
                target.de,
                view4!,
                run,
                groundPlane,
                shapeTrap,
                target.tiling ?? null,
              )
          : target.kind === "bulb"
            ? // The escape packer's twin — one asymmetry, and it
              // is inside packBulbGpuParams: the ORBIT bailout and the
              // QUERY-space marching ball are different numbers for this
              // object, so the frozen radii take the latter.
              (run) =>
                packBulbGpuParams(
                  target.de,
                  run,
                  groundPlane,
                  shapeTrap,
                  target.tiling ?? null,
                )
            : target.kind === "ifs4"
              ? (() => {
                  // A balloon 4D session's spec must carry the live balloon
                  // block, exactly as a 3D one's does.
                  if (target.balloon === true) {
                    const balloon = spec.balloon;
                    if (!balloon) {
                      throw new Error(
                        "Surface compute: a balloon frame spec must carry balloon",
                      );
                    }
                    return (run: SurfaceGpuRunParams) =>
                      packSurface4GpuParams(
                        target.de,
                        view4!,
                        run,
                        balloon,
                        null,
                        target.tiling ?? null,
                      );
                  }
                  return (run: SurfaceGpuRunParams) =>
                    packSurface4GpuParams(
                      target.de,
                      view4!,
                      run,
                      null,
                      groundPlane,
                      target.tiling ?? null,
                    );
                })()
              : (() => {
                  // A balloon session's spec must carry the live balloon
                  // block (the R slider's per-frame door — view4's
                  // required-throw discipline; the 320-byte kernel struct
                  // has no meaningful default). A no-balloon session ignores
                  // any stray spec.balloon — its buffer is 288 bytes.
                  if (target.balloon === true) {
                    const balloon = spec.balloon;
                    if (!balloon) {
                      throw new Error(
                        "Surface compute: a balloon frame spec must carry balloon",
                      );
                    }
                    return (run: SurfaceGpuRunParams) =>
                      packSurfaceGpuParams(
                        target.de,
                        run,
                        balloon,
                        null,
                        target.tiling ?? null,
                      );
                  }
                  return (run: SurfaceGpuRunParams) =>
                    packSurfaceGpuParams(
                      target.de,
                      run,
                      null,
                      groundPlane,
                      target.tiling ?? null,
                    );
                })();
    // An ifs4 frame at the shipped sliceHalfW 0 rides the slab-free
    // kernel pair (measured 2.2-2.4x cheaper at every kaleidoscope order
    // — the slab's ext registers are occupancy tax even when dynamically
    // dead); any h > 0 frame takes the full slab pair. Per frame, not
    // per session — the thickness slider is live and can cross 0
    // mid-session. Non-ifs4 targets carry no noslab pair, so they always
    // resolve to the main one. The h = 0 outputs are bit-identical
    // between the pairs (segmentRadius4 at e = 0 IS length(q)), pinned
    // by the bench's aff4 sweep agreement gate.
    const slabFrame = (spec.view4?.sliceHalfW ?? 0) > 0;
    const marchPipeline =
      !slabFrame && this.marchPipelineNoSlab !== null
        ? this.marchPipelineNoSlab
        : this.marchPipeline;
    const shadePipeline =
      !slabFrame && this.shadePipelineNoSlab !== null
        ? this.shadePipelineNoSlab
        : this.shadePipeline;
    /** One dispatch's params block, packed but not yet staged —
     * `stageDispatch` below decides whether a fence must come first. */
    const packRunParams = (itemCount: number, steps: number): ArrayBuffer => {
      const run: SurfaceGpuRunParams = {
        itemCount,
        stepsThisPass: steps,
        marchSteps: spec.marchSteps,
        maxDepth: spec.maxDepth,
        hitFloor: spec.hitFloor,
        cutoff: 0,
        footprint: 0,
        fogDensity: spec.fogDensity,
        focusDepth: spec.focusDepth,
        pose: {
          ro: spec.camPos,
          right: [1, 0, 0],
          up: [0, 1, 0],
          fwd: spec.camForward,
          tanHalf: 0,
          aspect: width / Math.max(1, height),
          rasterWidth: width,
          rasterHeight: height,
          // The ACCEPTANCE slope: eps = max(pixelEps * t, hitFloorEps) in
          // the kernel's march — native-height derived, tier-independent.
          pixelEps: spec.acceptPixelEps,
        },
      };
      return packParams(run);
    };
    const submitDispatch = (
      pipeline: GPUComputePipeline,
      bindGroup: GPUBindGroup,
      count: number,
      /** A device-local copy appended to the SAME submission — the
       * march slice's `count` statuses, staged at the slice's own
       * offset in the sweep's readback. Riding the dispatch costs no
       * extra submission and no extra fence; it lands in the measured
       * pass time, which is the honest place for it (a `count`-word
       * copy
       * against a `count`×`stepsThisPass` DE march). */
      copyAfter?: { src: GPUBuffer; dst: GPUBuffer; dstOffset: number },
    ): number => {
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
      return t0;
    };
    /**
     * THE SESSION'S OWN FENCE ROUND-TRIP, measured once and thereafter
     * subtracted from every dispatch the sizers read
     * ({@link surfaceComputeDispatchWorkMs}). A NULL dispatch — this
     * frame's real pipeline and bind group at ZERO workgroups, so it is a
     * genuine submit-and-fence with no GPU work, no side effect and no
     * dependence on what the params buffer happens to hold — repeated
     * {@link SURFACE_COMPUTE_FENCE_ALIGNMENT_PROBES} +
     * {@link SURFACE_COMPUTE_FENCE_PROBES} times: the leading alignment
     * probe(s) put every later probe at the phase a real dispatch actually
     * lands at, and only {@link surfaceComputeFenceRoundTripMs} gets to
     * see which is which (it discards the leading one(s) itself — see its
     * own doc for the tick-phase finding this fixes).
     *
     * MEASURED rather than assumed per browser: the constant is the
     * PLATFORM's (~2.4 ms Chrome, ~100 ms Firefox, same AMD adapter, same
     * build, measured by this very probe) and this renderer has no
     * business hard-coding either. It is paid INSIDE the frame's own
     * in-flight accounting so {@link destroy} still drains it, the token
     * is re-checked between probes so cancellation stays responsive, and
     * it hangs off the first real dispatch rather than the top of
     * `runFrame` so a frame that never reaches one — the params-write
     * seam the tiling tests stop at — never pays for it either.
     *
     * Returns false when the frame was cancelled mid-calibration.
     */
    const ensureFenceCalibrated = async (
      pipeline: GPUComputePipeline,
      bindGroup: GPUBindGroup,
    ): Promise<boolean> => {
      if (this.fenceMs !== null) return true;
      const probes: number[] = [];
      const totalProbes =
        SURFACE_COMPUTE_FENCE_ALIGNMENT_PROBES + SURFACE_COMPUTE_FENCE_PROBES;
      for (let i = 0; i < totalProbes; i++) {
        const t0 = submitDispatch(pipeline, bindGroup, 0);
        await device.queue.onSubmittedWorkDone();
        if (token !== this.frameToken || this.isLost || this.destroyed) {
          return false;
        }
        probes.push(performance.now() - t0);
      }
      // Each probe paid a real fence, so nothing staged before them is
      // still outstanding.
      stagedBytes = 0;
      this.fenceMs = surfaceComputeFenceRoundTripMs(probes);
      // The trace lists EVERY timed probe, the alignment one included —
      // cheap context for reading a session's own calibration.
      // `surfaceComputeFenceRoundTripMs` is what discards the leading
      // one(s), not this line.
      tr(
        `fence calibrated ms=${this.fenceMs.toFixed(2)} probes=${probes
          .map((ms) => ms.toFixed(2))
          .join(",")}`,
      );
      return true;
    };

    // balloonCostScale: the balloon spike's march-step numbers (the
    // prior comment above `balloonCostScale`).
    let rayStepEmaUs =
      SURFACE_COMPUTE_INITIAL_RAY_STEP_US * lensCostScale * balloonCostScale;
    /**
     * THE FENCE GROUP: what has been SUBMITTED since the last fence and
     * what each of those dispatches still owes its model.
     *
     * Every dispatch is still its own submission — the i915 preemption
     * boundary, and the reason `submitDispatch` is untouched — but the
     * `onSubmittedWorkDone` round-trip is paid once per GROUP, because
     * that round-trip costs the same whatever stands behind it — this
     * session's own calibration probes say how much, and the two
     * browsers this project measures differ by more than an order of
     * magnitude. A group is a fence, not a wider dispatch.
     *
     * The record is what the flush needs and nothing more: a march slice
     * owes the per-ray·step EMA its ray·steps, a hit batch owes
     * {@link nextShadeHitCost} its width and the two capacity ladders the
     * budget it was sized against plus whether the queue could even fill
     * it. A FREE batch owes nothing — it has no cost model, and its GPU
     * time is a background write per ray.
     */
    type PendingDispatch =
      | { kind: "march"; rays: number; steps: number }
      | {
          kind: "shade";
          free: boolean;
          hits: number;
          /** What the sizer ASKED for, against which `hits` says whether
           * this batch was queue-limited — the evidence rule the capacity
           * ladders below turn on. */
          wanted: number;
          budgetMs: number;
        }
      | {
          /** One participating-medium (cell, light) submission over a
           * batch's terminals. Its own LANE: a medium group never shares a
           * fence with shade or march work, so the tally, the group size
           * and the medium cost model each read medium time alone. */
          kind: "medium";
          rays: number;
          cell: number;
          light: number;
        };
    let pending: PendingDispatch[] = [];
    /** `performance.now()` at the group's FIRST submit — the group's wall
     * clock is measured from there across the one fence, so it is the
     * honest "time the frame spent on this group". */
    let groupStart = 0;
    /** Fences actually paid, the instrument this grouping exists to move
     * (a frame's dispatch count is unchanged by design). */
    let fences = 0;
    /**
     * THE EVIDENCE THE GROUP SIZE IS BUILT ON: each lane's running MAXIMUM
     * fence-free work per dispatch, this frame
     * ({@link surfaceComputeFenceGroupSize}). `null` until that lane's
     * first group comes back, which is the PILOT — one dispatch, one
     * fence, no group built on a cost nothing has measured.
     *
     * PER FRAME, not per session: a frame is one pose at one raster, so
     * its dispatches are comparable to each other in a way another
     * frame's are not, and an expensive band cannot pin the group size
     * for the life of a session. A shade group reads the HIT lane — a
     * free batch has no cost of its own to contribute, and pricing the
     * group by the hits it also carries is the conservative direction.
     */
    let marchPeakWorkMs: number | null = null;
    let hitPeakWorkMs: number | null = null;
    /** The medium lane's running maximum, on the same per-frame rule. */
    let mediumPeakWorkMs: number | null = null;
    /** The medium lane's own tally for the frame-done trace line. */
    let mediumGpuMs = 0;
    let mediumDispatchCount = 0;
    let mediumFences = 0;
    /** Lit-ladder evidence from hit groups whose batch still owes its
     * medium sweep. The restored medium paced the lit width by the worst
     * SINGLE submission a batch produced — phase 0 or its slowest medium
     * cell — so the step waits until that sweep has been measured. */
    let deferredLitLadder: { shareMs: number; limited: boolean }[] = [];
    /** `?surfacemediumstride`: the last batch's kept-terminal fraction,
     * seeded at the nominal 1/K². 1 (and unread) without the lever. */
    let mediumRayFraction =
      mediumStridePin === null ? 1 : 1 / (mediumStridePin * mediumStridePin);

    /** Submit one dispatch into the current group. Returns false only
     * when the frame was cancelled during the session's one-time fence
     * calibration. */
    const queueDispatch = async (
      pipeline: GPUComputePipeline,
      bindGroup: GPUBindGroup,
      count: number,
      record: PendingDispatch,
      copyAfter?: { src: GPUBuffer; dst: GPUBuffer; dstOffset: number },
    ): Promise<boolean> => {
      if (!(await ensureFenceCalibrated(pipeline, bindGroup))) return false;
      const t0 = submitDispatch(pipeline, bindGroup, count, copyAfter);
      if (pending.length === 0) groupStart = t0;
      pending.push(record);
      passes++;
      return true;
    };

    /** Must the group close now? `limitMs` is what the CALLER has left to
     * spend before the next progressive present (or the frame budget)
     * falls due — see {@link surfaceComputeFenceGroupSize}. */
    const groupClosed = (limitMs: number): boolean => {
      if (pending.length === 0) return false;
      // The staged-bytes bound comes first and binds under a pin too: it
      // only ever shrinks a group, and it is what makes a raised count
      // safe at any raster (SURFACE_COMPUTE_FENCE_GROUP_STAGED_BYTES).
      if (surfaceComputeFenceGroupStagedFull(pending.length, stagedBytes)) {
        return true;
      }
      // A pin names a COUNT outright, so it stands in for the measured
      // sizing entirely — `=1` is one fence per dispatch, the loop
      // exactly as it ran before grouping.
      const pin = surfaceComputeFenceGroupPin;
      if (pin !== null) return pending.length >= pin;
      const lane =
        pending[0].kind === "march"
          ? marchPeakWorkMs
          : pending[0].kind === "medium"
            ? mediumPeakWorkMs
            : hitPeakWorkMs;
      return pending.length >= surfaceComputeFenceGroupSize(lane, limitMs);
    };

    /** What THIS group has left to spend: the time before the next
     * progressive present falls due, or before the frame budget cuts,
     * whichever is nearer. Both are debts the queued work delays — the
     * screen has to keep developing through a long drain, and a budget
     * cut has to be able to land — so whichever runs out first closes the
     * group. A caller with no present to make and no budget has
     * `Infinity` and is bounded by the work target and the count alone. */
    const groupLimitMs = (): number =>
      Math.min(
        opts.onProgress
          ? progressMs - (performance.now() - lastProgress)
          : Infinity,
        budgetMs - (performance.now() - wallStart),
      );

    /**
     * Fence the group, then hand its ONE measurement to the models the
     * dispatches behind it belong to. Returns false when the frame was
     * cancelled (the caller returns null, exactly as a null dispatch
     * timing used to mean).
     *
     * THE SUBTRACTION IS ONE FENCE PER GROUP, not one per dispatch: the
     * group paid a single round-trip, so a single round-trip is what
     * comes out ({@link surfaceComputeDispatchWorkMs}).
     *
     * THE TALLY IS WALL CLOCK — a fence the frame really waited on is
     * time the frame really spent — while everything that SIZES anything
     * reads the fence-free work. That split is unchanged; what changed is
     * the unit it is measured over.
     *
     * THE ATTRIBUTION, spelled out because a group measures one time for
     * N pieces of work:
     *
     * - the march's per-ray·step EMA takes the group's AGGREGATE rate,
     *   its work over its total ray·steps, which is what one dispatch of
     *   the same total rays would have given. One measurement, one EMA
     *   update;
     * - the hit queue's two-term model takes the group as a group —
     *   `d` dispatches and `N` hits fitted jointly, which is exact at any
     *   mix of widths ({@link nextShadeHitCost}'s `dispatches`);
     * - the two capacity LADDERS judge one dispatch against a budget, so
     *   they get {@link surfaceComputeGroupDispatchMs}'s equal share, once
     *   per member, in submit order — the ladder paces the climb per
     *   DISPATCH because the watchdog sees dispatches, and folding a
     *   group into a single ladder step would slow the climb out of the
     *   cold cap by the group size;
     * - a FREE batch is attributed ZERO and feeds nothing. That is not a
     *   convenience: its shade-entry exit is two lines (evaluate the
     *   backdrop ramp at this pixel, store it), so what a free dispatch
     *   costs really is the submission and the fence rather than work,
     *   which is the whole reason the queues are split. A group of
     *   nothing BUT free batches has no priced member, so its work is
     *   shared over the frees for the trace's sake alone.
     */
    const flushGroup = async (): Promise<boolean> => {
      if (pending.length === 0) return true;
      await device.queue.onSubmittedWorkDone();
      if (token !== this.frameToken || this.isLost || this.destroyed) {
        return false;
      }
      const group = pending;
      pending = [];
      // The fence released everything staged ahead of it.
      stagedBytes = 0;
      fences++;
      const wallMs = performance.now() - groupStart;
      const workMs = surfaceComputeDispatchWorkMs(wallMs, this.fenceMs ?? 0);
      gpuMs += wallMs;
      // A GROUP IS HOMOGENEOUS by construction, which is what lets one
      // tally lane take its whole wall: the sweep closes its group at the
      // end of the active list (the status readback cannot run behind
      // unfenced work) and the drain closes its own when the queues empty
      // or the HOLD breaks out, so a march slice and a shade batch can
      // never share a fence. Free and hit batches DO share one — same
      // lane, same tally — and the attribution below is what keeps them
      // apart where it matters.
      if (group[0].kind === "march") {
        marchGpuMs += wallMs;
        let raySteps = 0;
        for (const d of group) {
          if (d.kind === "march") raySteps += d.rays * Math.max(1, d.steps);
        }
        const usPerRayStep = (workMs * 1000) / Math.max(1, raySteps);
        // BOTH currencies, per dispatch, exactly as the ungrouped line
        // carried them: `ms` is this member's share of the group's WALL
        // (a fence the frame really waited on is time the frame really
        // spent) and `work` its share with that one fence taken out.
        const marchWallShare = surfaceComputeGroupDispatchMs(
          wallMs,
          group.length,
        );
        const marchWorkShare = surfaceComputeGroupDispatchMs(
          workMs,
          group.length,
        );
        for (const d of group) {
          if (d.kind !== "march") continue;
          tr(
            `march END ms=${marchWallShare.toFixed(1)} work=${marchWorkShare.toFixed(1)} len=${d.rays} steps=${d.steps}`,
          );
        }
        // ONCE PER MEMBER, not once per group, at the group's aggregate
        // rate: the measurement covers d dispatches' worth of ray·steps,
        // so it is d dispatches' worth of evidence, and folding it in
        // once would slow the EMA's convergence — and with it
        // marchChunkFor's climb — by the group size. MEASURED on Chrome,
        // where a single fold per group turned a 141-dispatch settle into
        // a 210-dispatch one at the same wall time: more, smaller slices,
        // each still paying a submission.
        for (let i = 0; i < group.length; i++) {
          rayStepEmaUs = rayStepEmaUs * 0.6 + usPerRayStep * 0.4;
        }
        marchPeakWorkMs = Math.max(marchPeakWorkMs ?? 0, marchWorkShare);
        tr(
          `fence march dispatches=${group.length} wall=${wallMs.toFixed(1)} work=${workMs.toFixed(1)} perDispatch=${marchWorkShare.toFixed(1)} peak=${marchPeakWorkMs.toFixed(1)} emaUs=${rayStepEmaUs.toFixed(3)}`,
        );
        return true;
      }
      if (group[0].kind === "medium") {
        // The restored medium counted its time inside the SHADE total;
        // it still does, so `shadeMs` means what it meant when the 95%
        // figure was taken, and the medium lane is ALSO tallied apart.
        shadeGpuMs += wallMs;
        mediumGpuMs += wallMs;
        mediumDispatchCount += group.length;
        mediumFences++;
        let totalRays = 0;
        for (const d of group) if (d.kind === "medium") totalRays += d.rays;
        const mediumWorkShare = surfaceComputeGroupDispatchMs(
          workMs,
          group.length,
        );
        // The ladder's evidence: this group's per-dispatch fence-free
        // work (the restored medium read raw wall here; the calibrated
        // fence is main's rule for every sizer).
        lightingSizer!.lastCellMs = mediumWorkShare;
        // The medium's own two-term model, fitted jointly over the group's
        // d dispatches and N rays ({@link nextShadeHitCost}'s
        // `dispatches`) — at equal widths the same answer as folding the
        // per-dispatch share, which is what the restored loop did.
        lightingSizer!.mediumCost = nextShadeHitCost(
          lightingSizer!.mediumCost,
          totalRays,
          workMs * 1000,
          group.length,
        );
        mediumPeakWorkMs = Math.max(mediumPeakWorkMs ?? 0, mediumWorkShare);
        // The restored gate's format first (cinematic-lighting.verify.mjs
        // parses it), then the fence-group instruments' shape.
        tr(
          `medium END dispatches=${group.length} ms=${wallMs.toFixed(2)} work=${workMs.toFixed(2)} rays=${totalRays}`,
        );
        tr(
          `fence medium dispatches=${group.length} wall=${wallMs.toFixed(1)} work=${workMs.toFixed(1)} perDispatch=${mediumWorkShare.toFixed(1)} peak=${mediumPeakWorkMs.toFixed(1)} rays=${totalRays}`,
        );
        return true;
      }
      shadeGpuMs += wallMs;
      const shade = group.filter(
        (d): d is Extract<PendingDispatch, { kind: "shade" }> =>
          d.kind === "shade",
      );
      const hits = shade.filter((d) => !d.free);
      const priced = hits.length > 0 ? hits : shade;
      const shareMs = surfaceComputeGroupDispatchMs(workMs, priced.length);
      const shareWallMs = surfaceComputeGroupDispatchMs(wallMs, priced.length);
      for (const d of shade) {
        const own = priced.includes(d);
        tr(
          `shade END ms=${(own ? shareWallMs : 0).toFixed(1)} work=${(own ? shareMs : 0).toFixed(1)} isFree=${d.free} len=${d.hits}`,
        );
      }
      if (hits.length > 0) {
        let totalHits = 0;
        for (const d of hits) totalHits += d.hits;
        // Hit economics only — free batches would just dilute the model
        // toward zero and re-open the miss-inflated-capacity hole.
        sizer.cost = nextShadeHitCost(
          sizer.cost,
          totalHits,
          workMs * 1000,
          hits.length,
        );
        for (const d of hits) {
          // A QUEUE-LIMITED batch (the sweep had fewer hits than the
          // sizer asked for) may shrink the capacity but never grow it:
          // coming in under budget on a batch that could not be any wider
          // is not evidence that a wider one would fit. That is the
          // probe-width lesson — miss runs inflating a capacity a hit
          // band then paid — in the one place it can still happen now the
          // queues are split.
          const grown = nextShadeBatchSize(sizer.cap, shareMs, d.budgetMs);
          sizer.cap = d.hits < d.wanted ? Math.min(sizer.cap, grown) : grown;
        }
        tr(
          `shade cost→${sizer.cost.interceptUs.toFixed(0)}+n*${sizer.cost.marginalUs.toFixed(1)}us cap→${sizer.cap}`,
        );
        if (lightingSizer && shadeHitsPin === null) {
          // The lit lanes, on the same evidence rule as the unlit one
          // above: a QUEUE-LIMITED batch may shrink the capacity and
          // never grow it, because coming in under budget on a batch
          // that could not be wider is not evidence that a wider one
          // fits. A pinned width is the offline lever and is left alone.
          lightingSizer.surfaceCost = nextShadeHitCost(
            lightingSizer.surfaceCost,
            totalHits,
            workMs * 1000,
            hits.length,
          );
          for (const d of hits) {
            if (mediumLights > 0) {
              // The batch's medium sweep has not run yet; its step waits
              // for the worst single submission that sweep produces.
              deferredLitLadder.push({
                shareMs,
                limited: d.hits < d.wanted,
              });
              continue;
            }
            // The watchdog sees dispatches, not groups, so the ladder is
            // paced by this dispatch's own attributed time.
            const litGrown = nextLightingRayCap(lightingSizer.rayCap, shareMs);
            lightingSizer.rayCap =
              d.hits < d.wanted
                ? Math.min(lightingSizer.rayCap, litGrown)
                : litGrown;
          }
          tr(
            `lit cost surf→${lightingSizer.surfaceCost.interceptUs.toFixed(0)}+n*${lightingSizer.surfaceCost.marginalUs.toFixed(1)}us ` +
              `med→${lightingSizer.mediumCost.interceptUs.toFixed(0)}+n*${lightingSizer.mediumCost.marginalUs.toFixed(1)}us rayCap→${lightingSizer.rayCap}`,
          );
        }
        hitPeakWorkMs = Math.max(hitPeakWorkMs ?? 0, shareMs);
      }
      tr(
        `fence shade dispatches=${group.length} hitDispatches=${hits.length} wall=${wallMs.toFixed(1)} work=${workMs.toFixed(1)} perDispatch=${shareMs.toFixed(1)} peak=${(hitPeakWorkMs ?? 0).toFixed(1)}`,
      );
      return true;
    };

    // The device's own ceiling on ONE dispatch — the last clamp on both
    // sizing paths below, above whatever their cost model asked for. See
    // {@link surfaceComputeMaxDispatchRays}.
    const maxDispatchRays = surfaceComputeMaxDispatchRays(device.limits);

    // Progress presents fire BETWEEN bounded pieces of work — march
    // slices and shade batches alike — never only at iteration ends: a
    // full-depth shade drain can grind for minutes, and the whole point
    // of progressive presents is that the screen develops through it.
    const maybePresent = async (): Promise<boolean> => {
      if (!opts.onProgress) return true;
      if (performance.now() - lastProgress < progressMs) return true;
      tr("present readback BEGIN");
      const [partialBytes, partialLayerBytes] = await this.readbackFrame(
        buffers.color,
        buffers.stagingColor,
        buffers.layer,
        buffers.stagingLayer,
        rays * 4,
        colorBytes,
      );
      const partial = this.lighting
        ? encodeSurfaceComputeHdr(new Float32Array(partialBytes))
        : new Uint8Array(partialBytes);
      const partialLayers = new Uint8Array(partialLayerBytes);
      tr("present readback END");
      if (token !== this.frameToken || this.isLost || this.destroyed) {
        return false;
      }
      lastProgress = performance.now();
      // March credit accrues per consumed step, shade credit on shaded
      // pixels — surfaceComputeProgressDone owns the formula and the
      // monotonicity argument.
      opts.onProgress(
        partial,
        partialLayers,
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

    /**
     * Stage one dispatch's params block and ray list — fencing the open
     * group FIRST when adding them would carry its staged bytes to
     * {@link SURFACE_COMPUTE_FENCE_GROUP_STAGED_BYTES}, so a raster-sized
     * list never joins a group already holding staging (the rule's
     * pre-check; `groupClosed` is its post-check). An empty group is never
     * fenced here, so an oversized dispatch still goes out, alone. Returns
     * false when the frame was cancelled during that fence or its present.
     */
    const stageDispatch = async (
      itemCount: number,
      steps: number,
      list: Uint32Array<ArrayBuffer>,
    ): Promise<boolean> => {
      const params = packRunParams(itemCount, steps);
      const nextBytes = params.byteLength + list.byteLength;
      if (
        surfaceComputeFenceGroupStagedFull(
          pending.length,
          stagedBytes,
          nextBytes,
        )
      ) {
        tr(`fence staged=${stagedBytes} next=${nextBytes}`);
        if (!(await flushGroup())) return false;
        if (!(await maybePresent())) return false;
      }
      stage(this.paramsBuf, params);
      stage(buffers.active, list);
      return true;
    };

    // The frame's terminal tally, accumulated as each sweep classifies
    // its rays — the whole-states scan that used to produce it needed a
    // readback this loop no longer pays for.
    const counts = { hit: 0, miss: 0, exhausted: 0, active: 0, plane: 0 };
    const exhaustedIndices: number[] = [];
    tr(
      `frame start rays=${rays} marchSteps=${spec.marchSteps} budgetMs=${budgetMs} fenceMs=${(this.fenceMs ?? 0).toFixed(2)} shadeCost0=${sizer.cost.interceptUs.toFixed(0)}+n*${sizer.cost.marginalUs.toFixed(1)}us rayStepEmaUs0=${rayStepEmaUs} shadeHitCap0=${sizer.cap}`,
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
            if (!(await flushGroup())) return null;
            truncated = true;
            tr("budget truncated (march)");
            break outer;
          }
          // marchChunkPin carries no cap of its own — the two terms below
          // already bound whatever it asks for (a ray count, unlike the
          // steps pin's per-ray work), so an unclamped parse is not a
          // hazard here.
          const chunk = Math.min(
            marchChunkPin ?? marchChunkFor(rayStepEmaUs, stepsThisPass),
            active.length - offset,
            maxDispatchRays,
          );
          if (!Number.isFinite(chunk) || chunk <= 0) {
            tr(`ANOMALY march chunk=${chunk} emaUs=${rayStepEmaUs}`);
          }
          const slice = active.subarray(offset, offset + chunk);
          if (!(await stageDispatch(slice.length, stepsThisPass, slice))) {
            return null;
          }
          tr(
            `march BEGIN offset=${offset} chunk=${chunk} len=${slice.length} steps=${stepsThisPass} emaUs=${rayStepEmaUs.toFixed(3)} active=${active.length}`,
          );
          if (
            !(await queueDispatch(
              marchPipeline,
              buffers.marchBindGroup,
              slice.length,
              { kind: "march", rays: slice.length, steps: stepsThisPass },
              // This slice's statuses, staged where the sweep's rebuild
              // expects them — the kernel writes slot-relative
              // (`statusOut[gid]`), so slice k's answers land at k's own
              // offset and one map at the sweep's end reads the lot.
              // Queue writes and their following submissions are ordered,
              // so a LATER slice in the same group cannot overtake this
              // copy of the status buffer it is about to overwrite.
              {
                src: buffers.status,
                dst: buffers.stagingStatus,
                dstOffset: offset * 4,
              },
            ))
          ) {
            return null;
          }
          offset += chunk;
          sweepSliced = offset;
          // The sweep's own end closes the group whatever it holds: the
          // status readback below cannot run behind unfenced work, and a
          // present between sweeps is the cadence this loop promises.
          if (offset >= active.length || groupClosed(groupLimitMs())) {
            if (!(await flushGroup())) return null;
            if (!(await maybePresent())) return null;
          }
        }
        if (!(await flushGroup())) return null;
        // 4 B per ACTIVE ray, already staged by the slices' own
        // submissions — where this used to read the WHOLE 16 B/ray states
        // buffer back every sweep, active list or not, to look at one
        // field of it. The saving compounds as the sweep count rises: a
        // raster too big to sweep whole holds stepsThisPass at 1, so a
        // full-tier settle is up to `marchSteps` sweeps, and each one
        // used to cost the frame's entire ray state.
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
            if (lightingCovered) lightingCovered[ray] = 1;
            // Plane rays are priced WITH the hits — a floor pixel pays
            // the penumbra-shadow/AO probe evals a hit pays (within
            // its corridor gates), nothing like a miss's one
            // background write; the hit EMA's slow-trust policy
            // absorbs the remaining within-band spread, and the
            // original 100-1000x miss/hit bimodality that forced the
            // queue split never recurs.
            shadeHitQueue.push(ray);
          } else {
            if (rayStatus === SURFACE_GPU_RAY_MISS) counts.miss++;
            else if (rayStatus === SURFACE_GPU_RAY_EXHAUSTED) {
              counts.exhausted++;
              exhaustedIndices.push(ray);
            }
            // A mist ray pays visibility marches even if its primary ray
            // missed. Keep it under the same bounded dispatch cap as hits.
            if (mediumLights > 0) shadeHitQueue.push(ray);
            else shadeFreeQueue.push(ray);
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
          if (!(await flushGroup())) return null;
          truncated = true;
          tr("budget truncated (shade)");
          break outer;
        }
        // Free rays (miss/exhausted) first, ALL OF THEM IN ONE DISPATCH —
        // and presents fill the backdrop before the hit grind starts.
        //
        // The free queue has no cost model to cap because there is no
        // cost to model: every exit the shade entry offers a non-HIT
        // status is the same two lines — evaluate the backdrop ramp at
        // this pixel's row, store it — so a free batch's GPU time is its
        // (tiny) memory traffic plus the per-submission wall, and the
        // wall is the whole of it at any batch size worth naming.
        // MEASURED at the flat 4096 this used to share with the hit
        // queue: 3.2 ms per dispatch, 2492 dispatches, 8.0 s of a 35 s
        // settle spent painting backdrop — ~307 submissions per
        // full-resolution frame times the 8 supersampling passes. Nothing
        // in that number is work.
        //
        // The i915 hangs behind the hit queue's slow-trust sizing do not
        // reach here: they were HIT batches sized in RAY units, where one
        // ray's probe evals can cost 100 ms. The only ceiling a free batch
        // has to meet is the device's own dispatch one.
        const isFree = shadeFreeQueue.length > 0;
        // The budget this batch is SIZED for, kept for the capacity
        // ladder below: the growth threshold has to be the number the
        // sizer aimed at, not a fixed constant.
        const hitBudgetMs = shadeHitBudgetUs(sizer.cost.interceptUs) / 1000;
        // shadeHitsPin is unclamped at parse too, but it names a HIT
        // COUNT, not per-ray work, so maxDispatchRays below already
        // bounds it exactly like the free queue's batch size — no
        // separate cap needed, unlike marchStepsPin
        // ({@link SURFACE_COMPUTE_MARCH_STEPS_PIN_CAP}).
        const batchSize = isFree
          ? Math.min(shadeFreeQueue.length, maxDispatchRays)
          : Math.min(
              this.lighting
                ? Math.min(
                    shadeHitsPin ?? Infinity,
                    surfaceComputeLightingRayBatch(
                      lightingSizer!.surfaceCost,
                      mediumLights > 0 ? lightingSizer!.mediumCost : null,
                      lightingSizer!.rayCap,
                      mediumRayFraction,
                    ),
                  )
                : (shadeHitsPin ?? shadeHitBatchSize(sizer.cost, sizer.cap)),
              maxDispatchRays,
            );
        // HOLD a partial hit batch for the next sweep's hits rather than
        // paying a whole dispatch's fixed cost for it. The intercept is
        // the same whether a dispatch carries 15 hits or 1000 — ~88 ms
        // measured on the boxfold pair, ~480 ms on mandelboxKifs — and a
        // sweep hands over its hits a few hundred at a time, so draining
        // to empty after every sweep spent a frame's fixed costs several
        // times over (MEASURED: 6 hit dispatches per settle frame where
        // the sizer had priced 2-3, every one of the extras a
        // queue-limited sliver).
        //
        // TWO BOUNDS keep it from becoming a stall. The march must still
        // be able to ADD to the queue — once the active list is empty
        // nothing more is coming, and the outer loop's own condition
        // means the queue always drains before the frame ends. And no hit
        // waits longer than one progressive-present interval: the screen
        // has to keep developing, which is the whole reason presents fire
        // between bounded pieces at all. Rays held over a budget cut keep
        // their seed pixels — uncovered backdrop in both the colour and
        // layer buffers, the composite-layer seed contract at the top of
        // runFrame — never a previous frame's shading.
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
        if (!Number.isFinite(batchSize) || batch.length === 0) {
          tr(
            `ANOMALY shade isFree=${isFree} batchSize=${batchSize} len=${batch.length} cost=${sizer.cost.interceptUs}+n*${sizer.cost.marginalUs} cap=${sizer.cap}`,
          );
        }
        tr(
          `shade BEGIN isFree=${isFree} hitQ=${shadeHitQueue.length} freeQ=${shadeFreeQueue.length} batchSize=${batchSize} len=${batch.length} interceptUs=${sizer.cost.interceptUs.toFixed(0)} marginalUs=${sizer.cost.marginalUs.toFixed(1)} budgetMs=${hitBudgetMs.toFixed(0)} cap=${sizer.cap}`,
        );
        if (!(await stageDispatch(batch.length, 0, batch))) return null;
        if (this.lighting) {
          // Phase 0 initializes each terminal's transmitted surface or
          // background radiance; a medium sweep below adds to it in place.
          stagePhase(0, 1, 0, -1);
        }
        if (
          !(await queueDispatch(
            shadePipeline,
            buffers.shadeBindGroup,
            batch.length,
            {
              kind: "shade",
              free: isFree,
              hits: batch.length,
              wanted: batchSize,
              budgetMs: hitBudgetMs,
            },
          ))
        ) {
          return null;
        }
        if (!(this.lighting && mediumLights > 0)) {
          // The queues advance at SUBMIT time — a later batch in the same
          // group must not re-send rays this one already took — while every
          // model and ladder waits for the group's one measurement.
          if (isFree) shadeFreeQueue = shadeFreeQueue.slice(batch.length);
          else {
            shadeHitQueue = shadeHitQueue.slice(batch.length);
            lastHitDispatch = performance.now();
          }
          // Draining the queues closes the group: the outer loop is about
          // to march again (a different pipeline, a different tally lane),
          // and nothing more is coming to fill this fence.
          if (
            (shadeHitQueue.length === 0 && shadeFreeQueue.length === 0) ||
            groupClosed(groupLimitMs())
          ) {
            if (!(await flushGroup())) return null;
            if (!(await maybePresent())) return null;
          }
        } else {
          // A GROUP IS HOMOGENEOUS: phase 0 is fenced before the medium
          // lane opens its own group, so each lane's tally takes its own
          // wall and the shade models read phase 0 alone — which is what
          // the restored loop's individually timed phase-0 dispatch fed
          // them. Each following submission adds one cell and one emitter,
          // leaving HDR in place and a cancellation door between groups.
          if (!(await flushGroup())) return null;
          // `?surfacemediumstride`: the sweep's terminal list is filtered
          // on the HOST, before any medium submission, so its dispatches'
          // width and workgroup count are the kept population's. Every
          // terminal already had phase 0 above; the rest get no medium.
          let mediumList = batch;
          if (mediumStridePin !== null) {
            mediumList = batch.filter((ray) =>
              surfaceComputeMediumStrideKeeps(
                ray,
                width,
                bgOffset,
                mediumStridePin,
              ),
            );
            tr(
              `medium stride=${mediumStridePin} kept=${mediumList.length}/${batch.length}`,
            );
            if (mediumList.length > 0) {
              mediumRayFraction = mediumList.length / batch.length;
              if (!(await stageDispatch(mediumList.length, 0, mediumList))) {
                return null;
              }
            }
          }
          const mediumDispatches =
            mediumList.length > 0 ? mediumCells * mediumLights : 0;
          for (let index = 0; index < mediumDispatches; index++) {
            if (performance.now() - wallStart > budgetMs) {
              if (!(await flushGroup())) return null;
              truncated = true;
              tr("budget truncated (medium)");
              break outer;
            }
            const slot = Math.floor(index / mediumLights);
            const cell =
              mediumStrataPasses === null
                ? slot
                : surfaceComputeMediumCellIndex(
                    slot,
                    sampleIndex,
                    mediumStrataPasses,
                  );
            const light = index % mediumLights;
            stagePhase(cell, 1, 1, light);
            if (
              !(await queueDispatch(
                shadePipeline,
                buffers.shadeBindGroup,
                mediumList.length,
                { kind: "medium", rays: mediumList.length, cell, light },
              ))
            ) {
              return null;
            }
            // Queue writes and their following submissions are ordered;
            // the sweep's end fences whatever is left, so no medium work
            // outlives its batch into a present, a new active list or a
            // teardown.
            if (index === mediumDispatches - 1 || groupClosed(groupLimitMs())) {
              if (!(await flushGroup())) return null;
              if (!(await maybePresent())) return null;
            }
          }
          if (lightingSizer && shadeHitsPin === null) {
            // The worst SINGLE submission this batch produced — its
            // phase-0 shading or its last medium group's per-dispatch
            // share. The watchdog sees dispatches, not batches.
            for (const step of deferredLitLadder) {
              const litGrown = nextLightingRayCap(
                lightingSizer.rayCap,
                Math.max(
                  step.shareMs,
                  mediumDispatches > 0 ? lightingSizer.lastCellMs : 0,
                ),
              );
              lightingSizer.rayCap = step.limited
                ? Math.min(lightingSizer.rayCap, litGrown)
                : litGrown;
            }
            tr(`lit rayCap→${lightingSizer.rayCap} after medium`);
          }
          deferredLitLadder = [];
          // Credit a ray's shade half only once every medium cell is done.
          if (isFree) shadeFreeQueue = shadeFreeQueue.slice(batch.length);
          else {
            shadeHitQueue = shadeHitQueue.slice(batch.length);
            lastHitDispatch = performance.now();
          }
        }
      }
      // The HOLD above breaks out with hits still queued and possibly a
      // group still open; the march is next, so close it here.
      if (!(await flushGroup())) return null;
    }

    tr("final readback BEGIN");
    const [pixelBytes, layerBytes] = await this.readbackFrame(
      buffers.color,
      buffers.stagingColor,
      buffers.layer,
      buffers.stagingLayer,
      rays * 4,
      colorBytes,
    );
    const linearPixels = this.lighting
      ? new Float32Array(pixelBytes)
      : undefined;
    const pixels = linearPixels
      ? encodeSurfaceComputeHdr(linearPixels)
      : new Uint8Array(pixelBytes);
    const layers = new Uint8Array(layerBytes);
    if (token !== this.frameToken || this.isLost || this.destroyed) return null;
    // The tally is kept as rays LEAVE the active list, so it needs no
    // final pass over the ray states (there is none to read). ACTIVE is
    // what is left over — rays a budget cut stranded mid-march, rays no
    // sweep ever classified, and (unreachably) any status outside the
    // vocabulary, which is exactly what the whole-buffer scan used to
    // count as active.
    counts.active =
      rays - counts.hit - counts.miss - counts.exhausted - counts.plane;
    tr(
      `frame done passes=${passes} fences=${fences} truncated=${truncated} hit=${counts.hit} miss=${counts.miss} exhausted=${counts.exhausted} active=${counts.active} plane=${counts.plane}` +
        (mediumLights > 0
          ? ` mediumDispatches=${mediumDispatchCount} mediumFences=${mediumFences} mediumMs=${mediumGpuMs.toFixed(1)} marchMs=${marchGpuMs.toFixed(1)} shadeMs=${shadeGpuMs.toFixed(1)}`
          : ""),
    );
    return {
      pixels,
      layers,
      ...(linearPixels
        ? {
            linearPixels,
            lightingVisibility: surfaceComputeLightingVisibility(linearPixels),
          }
        : {}),
      width,
      height,
      wallMs: performance.now() - wallStart,
      gpuMs,
      marchMs: marchGpuMs,
      shadeMs: shadeGpuMs,
      passes,
      truncated,
      counts,
      exhaustedIndices,
    };
  }
}
