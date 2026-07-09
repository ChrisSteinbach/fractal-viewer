/**
 * The flame render's Web Worker session state machine (fr-73y): everything
 * `main.ts`'s old `stepFlame` used to do synchronously on the main thread —
 * supersampled accumulation, the proactive + reactive OOM guard, throttled
 * downsample, a finished-frame adaptive density-estimation blur (fr-17t),
 * and live tone-map/estimate re-application — now runs here, off the main
 * thread. `flame-worker.ts` is the thin `self.onmessage`/`postMessage` glue
 * that wires a {@link FlameWorkerSession} to the real worker globals; this
 * module touches none of them directly (no `self`, `postMessage`,
 * `performance`, `setTimeout`), which is what makes it plain-Vitest testable
 * with an injected {@link FlameWorkerDeps} instead of a real Worker.
 *
 * Transport comes in two flavors (fr-96i). The upgrade is a
 * **SharedArrayBuffer-backed display histogram**: when the page is
 * cross-origin isolated (COOP/COEP — natively from the dev server's headers,
 * or injected by the service worker in `sw/sw.ts` on hosts like GitHub Pages
 * that can't send them), the main thread passes two SAB-backed
 * display-resolution frame slots in the `start` command; this session
 * downsamples into them alternately (a double buffer, so the slot the main
 * thread last read is never the one being overwritten) and each update
 * crosses as a scalars-only `sharedFrame` notification — the main thread
 * tone-maps straight out of the live shared buckets, which is also what
 * makes exposure/gamma/vibrancy changes land instantly there with no worker
 * round trip. The notification postMessage doubles as the memory-visibility
 * edge for the bucket writes (message delivery happens-after them), so no
 * Atomics are involved. The **fallback** is fr-73y's postMessage TRANSFER:
 * without isolation (SAB is unavailable there at all) the session keeps
 * every histogram to itself and hands the main thread an
 * already-downsampled-and-tone-mapped display-resolution RGBA image per
 * update. Either way the big supersampled accumulator never leaves the
 * worker.
 *
 * Accumulation itself runs through a pluggable {@link FlameAccumBackend}
 * (fr-npb): CPU by default, or — when the `start` command's
 * `gpuPreference` opts in and the real worker wires up a `createGpuBackend`
 * factory — a WebGPU accumulator (`flame-gpu.ts`), which `runChunk` drives
 * through the exact same chunk/redisplay loop and falls back to CPU (once
 * per session — see `gpuFailed`) on any GPU failure. See that interface's
 * doc for the seam's contract.
 */
import {
  accumulateFlame,
  adaptiveDownsampleFlame,
  clampSupersampleToBudget,
  createFlameHistogram,
  downsampleFlame,
  tonemapFlame,
  viewFlameHistogram,
  DEFAULT_GAMMA_THRESHOLD,
} from "../fractal/flame";
import type {
  DensityEstimatorParams,
  FlameHistogram,
  Mat4,
  TonemapParams,
} from "../fractal/flame";
import { prepareChaosGame } from "../fractal/chaos-game";
import type { PreparedChaosGame } from "../fractal/chaos-game";
import { prepareChaosGame4 } from "../fractal/chaos-game-4d";
import type { PreparedChaosGame4 } from "../fractal/chaos-game-4d";
import { accumulateFlame4 } from "../fractal/flame-4d";
import {
  buildColorModeLUT,
  transformColors,
  W_SIDE_PALETTES,
} from "../fractal/color";
import type { FourDRenderColor } from "../fractal/color";
import {
  composeFlameProjection4,
  composeRotorProjection4,
} from "../fractal/project4";
import type { FourDView } from "../fractal/project4";
import { buildPaletteLUT } from "../fractal/palette";
import type { FlamePaletteId } from "../fractal/palette";
import { mulberry32 } from "../fractal/rng";
import type { Rng } from "../fractal/rng";
import { FlamePerfMeter } from "./flame-perf";
import type {
  FourDColorMode,
  SymmetryAxis,
  Transform,
  Transform4,
  Vec3,
  Vec4,
} from "../fractal/types";

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

/**
 * One shared display-resolution frame slot (fr-96i): views over
 * SharedArrayBuffers, allocated by the main thread and handed to the worker
 * in the `start` command (structured clone of a SAB-backed view shares the
 * buffer — nothing is copied or transferred). Same bucket layout as
 * {@link FlameHistogram}'s `hits`/`sumRGB`, at display resolution: that plus
 * a per-notification `maxHits` is everything `tonemapFlame` needs, so the
 * main thread can tone-map a live view of the worker's downsample output.
 */
export interface SharedFrameBuffers {
  /** Hit count per display bucket, row-major, length `width * height`. */
  hits: Float64Array<SharedArrayBuffer>;
  /** Summed color per display bucket, interleaved RGB, length `width * height * 3`. */
  sumRGB: Float64Array<SharedArrayBuffer>;
}

/** Main thread → worker. */
export type FlameWorkerCommand =
  | {
      type: "start";
      transforms: Transform[];
      finalTransform: Transform | null;
      /** Row-major camera projection*view — see `flame.ts`'s `Mat4` doc. */
      projection: Mat4;
      /** Display resolution — fixed for the session's life. */
      width: number;
      height: number;
      /** Explicit numeric seed (not a live `Rng`, which can't cross postMessage) —
       * also makes a render a reproducible pure function of its inputs. */
      seed: number;
      /** Raw (un-clamped) slider value; the session computes its own effective one. */
      requestedSupersample: number;
      /**
       * Accumulation-memory ceiling in buckets, computed by the main thread
       * via {@link flameAccumBudgetBuckets} — the device signals it reads
       * (`navigator.deviceMemory`, pointer coarseness) only exist there.
       * Omitted, the session falls back to the phone-safe floor.
       */
      maxAccumBuckets?: number;
      iterationsBudget: number;
      exposure: number;
      gamma: number;
      vibrancy: number;
      /** Initial {@link DensityEstimatorParams} — see that type's doc. */
      estimatorRadius: number;
      estimatorMinimumRadius: number;
      estimatorCurve: number;
      /** Structural-coloring palette (fr-6us); `"legacy"` = per-transform hue. */
      paletteId: FlamePaletteId;
      /** Kaleidoscope symmetry (fr-6im) — see chaos-game.ts's prepareChaosGame. */
      order: number;
      axis: SymmetryAxis;
      /**
       * Optional 4D flame render (fr-5b3): present when the explorer was in
       * 4D mode when the render was entered. When present, the session
       * drives `chaos-game-4d.ts`'s 4D chaos game and `flame-4d.ts`'s
       * `accumulateFlame4` instead of the 3D path. `transforms`/
       * `finalTransform` above still arrive either way (the main thread
       * always sends both), but are simply unused when this is present.
       * `gpuPreference` applies to 4D sessions too (fr-e26): `"auto"` tries
       * the `createGpuBackend4` factory (`flame-gpu-4d.ts`'s WGSL kernel)
       * with the same fall-back-to-CPU/`gpuFailed`-ratchet discipline as
       * the 3D path.
       */
      fourD?: {
        /** The 4D transform set — see `chaos-game-4d.ts`'s `PreparedChaosGame4`. */
        transforms4: Transform4[];
        finalTransform4: Transform4 | null;
        /** Row-major 4x4 rotor matrix (the `affine4.ts`/`rotationMatrix4`
         * convention), frozen at render entry — see `project4.ts`'s
         * `composeRotorProjection4`. */
        rotor: number[];
        /** The cloud's 4D center (the rotor's pivot) — see
         * `composeRotorProjection4`. */
        center: Vec4;
        /** `1 / wSupport(rotor, halfExtents)` at render entry — see
         * `project4.ts`'s `FourDView.invWAmp` and `rotor4.ts`'s
         * `wSupport`. */
        invWAmp: number;
        /** Whether the soft w-slice is on — `scene.ts`'s `uSliceOn`. */
        sliceOn: boolean;
        /** Slice center in the normalized signed-w signal — `uSliceCenter`. */
        sliceCenter: number;
        /** Slice width — `uSliceWidth`, sent as a plain number (the main
         * thread reads `FOUR_D_SLICE_WIDTH`). */
        sliceWidth: number;
        /** Whether the w-ramp color modes recenter their ramp on the slice
         * window (fr-nn6) — `project4.ts`'s `FourDView.sliceRelativeColor`. */
        sliceRelativeColor: boolean;
        /** The explorer's active 4D color mode — drives the "legacy"
         * palette dispatch (see `color.ts`'s `FourDRenderColor`). */
        colorMode: FourDColorMode;
        /** Min/max 4D distance from `center` over the explorer's own cloud
         * (`ChaosGame4Result`), computed by the main thread — the "radius"
         * color mode's normalization range. */
        radiusMin: number;
        radiusMax: number;
      };
      /**
       * Two SAB-backed display-resolution frame slots (fr-96i), present only
       * when the page is cross-origin isolated (the main thread gates the
       * allocation on `crossOriginIsolated`). Their presence selects the
       * transport: the session downsamples into them alternately and emits
       * `sharedFrame` notifications; omitted, it emits `progress` transfers
       * exactly as before. Two slots — a double buffer — so the slot the
       * main thread was last told to read is never the one the next
       * downsample is concurrently overwriting.
       */
      sharedFrames?: [SharedFrameBuffers, SharedFrameBuffers];
      /**
       * Opt into the WebGPU accumulation backend (fr-npb) when the real
       * worker's `createGpuBackend` factory is wired up: `"auto"` tries GPU
       * first and falls back to CPU (once per session) on any failure;
       * `"off"` — and, deliberately, absent — never attempts it. Absent
       * defaults to `"off"` rather than `"auto"` because a session with no
       * `createGpuBackend` factory at all (every pre-fr-npb caller) must
       * behave exactly as before: this field existing is not itself a
       * signal that GPU is available.
       */
      gpuPreference?: "auto" | "off";
      /**
       * Opt into per-chunk throughput instrumentation (fr-ul2): when true, the
       * session times each accumulation chunk's accumulate / readback / inter-
       * chunk-gap phases and periodically logs a {@link FlamePerfMeter} summary
       * via the `log` dep. Absent/false (production default) leaves the loop
       * byte-for-byte unchanged — every added clock read is guarded — so this
       * is a diagnostics-only opt-in (main.ts wires it to a `?flameperf` URL
       * param, the same shape as `?flamehost`). Exists to pin down the real-app
       * mobile-GPU throughput deficit vs the `/gpu-bench/` raw-kernel number,
       * which the bench can't reproduce because it times `accumulate()` alone
       * (no readback, no scheduling gap — see gpu-bench's `runGpuTimed`).
       */
      instrument?: boolean;
    }
  | { type: "setIterationsBudget"; iterations: number }
  | { type: "setExposure"; exposure: number }
  | { type: "setGamma"; gamma: number }
  | { type: "setVibrancy"; vibrancy: number }
  | { type: "setSupersample"; supersample: number }
  | { type: "setEstimatorRadius"; estimatorRadius: number }
  | { type: "setEstimatorMinimumRadius"; estimatorMinimumRadius: number }
  | { type: "setEstimatorCurve"; estimatorCurve: number }
  | { type: "setPalette"; paletteId: FlamePaletteId }
  | { type: "setSymmetry"; order: number; axis: SymmetryAxis };

/** Worker → main thread. */
export type FlameWorkerEvent =
  | {
      type: "progress";
      iterationsDone: number;
      iterationsBudget: number;
      /** Display-resolution RGBA, transferred (zero-copy) — see `tonemapFlame`. */
      image: Uint8ClampedArray<ArrayBuffer>;
      width: number;
      height: number;
    }
  | {
      /**
       * Shared-memory counterpart to `progress` (fr-96i): the frame is
       * already sitting in one of the `start` command's `sharedFrames`
       * slots, so only scalars cross here — the main thread tone-maps the
       * named slot itself. Delivery of this message is also what guarantees
       * the slot's bucket writes are visible to the main thread.
       */
      type: "sharedFrame";
      /** Index into `sharedFrames` of the slot that was just (re)written. */
      slot: number;
      /** `maxHits` of the display histogram in that slot — the one input
       * `tonemapFlame` needs that doesn't live in the shared arrays. */
      maxHits: number;
      iterationsDone: number;
      iterationsBudget: number;
    }
  | {
      type: "supersampleNote";
      /** Maps directly onto `Ui.setFlameSupersampleNote`'s own signature. */
      effective: number | null;
      requested?: number;
    }
  | {
      /**
       * Which {@link FlameAccumBackend} is driving the CURRENT accumulation
       * (fr-npb) — emitted once per backend creation, i.e. on the first
       * chunk of every `start`/restart (a live `setSupersample`/`setPalette`/
       * `setSymmetry`, or a GPU-failure/OOM-ratchet restart), so the UI's
       * label always reflects the backend actually in use, including across
       * a mid-session fallback. Emitted in EVERY session, not just GPU-
       * attempted ones (a CPU-only session emits `backend: "cpu"` too), so
       * the event is a reliable signal regardless of `gpuPreference`.
       */
      type: "backend";
      backend: "gpu" | "cpu";
      /** Whatever label the backend factory's adapter exposes (e.g. a
       * `GPUAdapterInfo` description) — see {@link FlameAccumBackend.adapterLabel}. */
      adapter?: string;
    }
  | { type: "error"; message: string }
  | {
      /**
       * Emitted when THIS session's WebGPU backend could not be CREATED — the
       * `createGpuBackend`/`createGpuBackend4` factory threw (see
       * {@link createGpuBackendWithFallback}) — immediately before the session
       * ratchets `gpuFailed` and falls back to CPU for the rest of its life.
       * At most once per session (the ratchet means the factory is attempted
       * only once), and NOT emitted for a GPU failure that surfaces mid-render
       * (a failed dispatch/snapshot restarts on CPU in place — see `runChunk`),
       * only for the clean "GPU never came up at all" case.
       *
       * Purely ADVISORY: the session still falls back to CPU entirely on its
       * own, so a host that ignores this event behaves exactly as before. The
       * MAIN thread uses it (fr-e07) to ESCALATE a WORKER-hosted session to the
       * main-thread GPU host ({@link createLocalFlameSessionHost}) when the main
       * thread itself has WebGPU — a real win on a browser/driver where the
       * worker's GPU is flaky but the main thread's works (a transient
       * worker-GPU hiccup on Firefox desktop is what surfaced this). A session
       * that is ALREADY main-thread-hosted has nothing better to escalate to,
       * so main.ts ignores its `gpuUnavailable` and lets the CPU fallback that
       * is already under way stand as the correct final fallback.
       */
      type: "gpuUnavailable";
    }
  | {
      /**
       * Emitted right before the synchronous, unchunked adaptive
       * density-estimation pass (fr-17t) — on the finished frame, and again
       * on every live estimator-param/budget change that re-runs it once
       * done (fr-99z). `postMessage` queues immediately, so this reaches the
       * main thread while the worker is still crunching that pass; the next
       * `progress`/`sharedFrame` event clears whatever busy state it set.
       */
      type: "estimating";
    };

/**
 * Environment the session runs in, injected so the state machine has no
 * direct dependency on worker globals (testable) or on `accumulateFlame`'s
 * real allocation behavior (so a test can simulate an OOM deterministically
 * instead of needing to actually exhaust memory).
 */
export interface FlameWorkerDeps {
  /** Wall-clock time source (`performance.now()` in the real worker). */
  now: () => number;
  /** Schedules `fn` to run, yielding first — `(fn) => setTimeout(fn, 0)` in
   * the real worker — so postMessage/cancel between chunks is possible. */
  schedule: (fn: () => void) => void;
  /** Delivers one event to the main thread (`postMessage` in the real worker). */
  emit: (event: FlameWorkerEvent) => void;
  /** Defaults to the real {@link accumulateFlame}; overridable so a test can
   * force the OOM-retry path without a real allocation failure. */
  accumulate?: typeof accumulateFlame;
  /** Fallback bucket budget for `start` commands that don't carry their own
   * `maxAccumBuckets` (defaults to the phone-safe 300 MiB floor); overridable
   * so a test can trigger the proactive `clampSupersampleToBudget` guard with
   * small, cheap-to-allocate dimensions instead of needing genuinely huge
   * ones to cross the real-world ceiling. */
  maxAccumBuckets?: number;
  /** Defaults to the real (1,000,000) initial chunk size; overridable so a
   * test can force a multi-chunk render (to exercise interleaving a live
   * command mid-accumulation) with a tiny iteration budget instead of
   * needing millions of real iterations to span more than one chunk. */
  initialChunkSize?: number;
  /**
   * Async factory for the WebGPU accumulation backend (fr-npb), tried when
   * a `start`/restart's `gpuPreference` is `"auto"`. Absent — every
   * pre-fr-npb caller, and the real worker until GPU wiring lands there —
   * means CPU-only, unconditionally, regardless of `gpuPreference`: this
   * factory's presence, not the preference field, is what actually gates
   * the attempt. Rejection is non-fatal: `runChunk` falls back to CPU and
   * never retries the factory again this session (see `gpuFailed`).
   */
  createGpuBackend?: (request: GpuBackendRequest) => Promise<FlameAccumBackend>;
  /**
   * The 4D counterpart of {@link createGpuBackend} (fr-e26): tried when a 4D
   * session's `gpuPreference` is `"auto"`, with the same absent-means-CPU
   * and rejection-falls-back semantics. A separate factory (rather than one
   * dimension-switched request) because the two kernels' requests share
   * almost nothing — see {@link GpuBackendRequest4}.
   */
  createGpuBackend4?: (
    request: GpuBackendRequest4,
  ) => Promise<FlameAccumBackend>;
  /** Diagnostic sink for GPU-fallback/failure messages (`console.info` in
   * the real worker); defaults to a no-op so tests stay quiet. */
  log?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Tuning constants — ported unchanged from `main.ts`'s pre-fr-73y `stepFlame`;
// see that history for the reasoning behind each value. Relocated, not
// retuned: nothing about moving this loop off the main thread changes what a
// good chunk size or redisplay cadence is.
// ---------------------------------------------------------------------------

/** Iterations per accumulation chunk; self-tunes toward FLAME_FRAME_BUDGET_MS. */
const FLAME_CHUNK_INITIAL = 1_000_000;
const FLAME_CHUNK_MIN = 100_000;
const FLAME_CHUNK_MAX = 20_000_000;
/** Target wall-clock time per accumulation chunk — keeps chunks short enough
 * that a `setSupersample`/`setExposure`/etc. command is picked up promptly
 * (the worker only checks for a new command between scheduled chunks). */
const FLAME_FRAME_BUDGET_MS = 8;

/**
 * GPU counterparts of the CPU chunk-size constants above (fr-npb) — used by
 * `adaptChunkSize`/`startAccumulation` whenever the CURRENT backend's `kind`
 * is `"gpu"`. An order of magnitude (or more) bigger than the CPU numbers
 * because a GPU dispatch's iteration rate is itself orders of magnitude
 * higher, so a CPU-sized chunk would be gone in a fraction of a millisecond
 * — all overhead, no useful work.
 */
const FLAME_GPU_CHUNK_INITIAL = 8_000_000;
const FLAME_GPU_CHUNK_MIN = 262_144;
const FLAME_GPU_CHUNK_MAX = 536_870_912;
/**
 * Target wall-clock time per GPU accumulation chunk — much larger than
 * {@link FLAME_FRAME_BUDGET_MS}. A GPU chunk's fixed JS/submit overhead
 * (building the bind group, `queue.submit`, the dispatch bookkeeping) is
 * roughly 1-2 ms REGARDLESS of how many iterations the chunk covers, so
 * chasing the CPU's 8 ms target would tax throughput by ~20% just servicing
 * that fixed cost every chunk; 24 ms keeps the tax to roughly 4-8% while
 * still picking up a live command ~40 times a second — plenty responsive
 * (see `FLAME_FRAME_BUDGET_MS`'s doc for why that cadence matters). The MAX
 * above is sized so even a single chunk on a very fast (~10 G
 * iterations/second) discrete GPU comfortably fits within this budget with
 * room to spare, rather than needing a second dispatch mid-budget.
 */
const FLAME_GPU_FRAME_BUDGET_MS = 24;

/** Fixed reconstruction-filter radius (display pixels) `downsampleFlame` blurs
 * PROGRESSIVE (not-yet-finished) frames with in `runChunk` — see its doc for
 * why fixed rather than density-adaptive. The finished frame instead gets
 * `adaptiveDownsampleFlame` (fr-17t), which has no equivalent fixed-radius
 * constant since its whole point is a radius computed per cell. Exported
 * (fr-ee9) so `GpuBackendRequest`'s `progressiveFilterRadius` and the
 * gpu-bench agreement harness both read the SAME value rather than each
 * re-declaring their own copy that could silently drift from this one. */
export const FLAME_FILTER_RADIUS = 0.4;
/** Minimum time between downsample + tone-map + transfer refreshes while
 * actively accumulating. Accumulation itself still runs every scheduled
 * chunk; only the pricier, unchunked downsample pass is throttled. */
const FLAME_REDISPLAY_INTERVAL_MS = 150;

/** Bytes per accumulation bucket: one Float64 `hits` + three Float64 `sumRGB`. */
const BYTES_PER_ACCUM_BUCKET = 32;
const MIB = 1024 * 1024;
/**
 * Phone-safe floor (and no-better-information default) for one accumulation
 * histogram's `hits` + `sumRGB` combined. 300 MiB is chosen to comfortably
 * survive on a memory-constrained phone (this app is explicitly served to
 * phones), where over-committing doesn't fail politely: mobile OSes kill the
 * whole tab before an allocation ever throws, so `runChunk`'s reactive
 * accumulate try/catch never gets a say. Desktops, whose failure mode is a
 * catchable allocation error (or, worst case, swap), get a larger budget via
 * {@link flameAccumBudgetBuckets}.
 */
const FLAME_ACCUM_FLOOR_BYTES = 300 * MIB;
const FLAME_ACCUM_FLOOR_BUCKETS = Math.floor(
  FLAME_ACCUM_FLOOR_BYTES / BYTES_PER_ACCUM_BUCKET,
);
/** Desktop budget scale: accumulation bytes allowed per GiB of *reported*
 * device memory. 320 MiB/GiB lands an 8-GiB report exactly on the ceiling. */
const FLAME_ACCUM_BYTES_PER_GIB = 320 * MIB;
/**
 * Desktop budget ceiling. 2.5 GiB covers the worst realistic ask — 3×
 * supersample of a 4K drawing buffer is ~2.23 GiB — while staying a modest
 * slice of any machine `navigator.deviceMemory` reports as 8 GiB (its cap,
 * meaning "8 or more"). Well under every engine's per-TypedArray limit.
 */
const FLAME_ACCUM_MAX_BYTES = 2560 * MIB;

/**
 * The accumulation-memory budget (in buckets — see
 * {@link BYTES_PER_ACCUM_BUCKET}) for the device we're actually running on,
 * from the two signals only the MAIN thread can read; it computes this and
 * ships the result in the `start` command (fr-7c8). Before this, the budget
 * was a flat 300 MiB sized for phones, which on any display larger than
 * ~1920×1280 device pixels clamped supersampling to 1× no matter how much
 * RAM the machine had — a 64 GB desktop with a 1440p/4K monitor was capped
 * *harder* than a 1080p laptop.
 *
 * - `coarsePointer` (from `matchMedia("(pointer: coarse)")`) marks
 *   phone/tablet-class devices: they keep the flat floor, and their
 *   `deviceMemory` is deliberately IGNORED — flagship phones report the
 *   capped maximum of 8 despite being exactly the devices the conservative
 *   floor exists for (see {@link FLAME_ACCUM_FLOOR_BYTES}).
 * - `deviceMemoryGiB` (`navigator.deviceMemory`: Chromium-only, quantized,
 *   capped at 8) scales the desktop budget. Where it's unavailable
 *   (Firefox/Safari) a fine-pointer device is assumed desktop-class (8):
 *   optimistic, but desktops fail catchably, and a genuinely weaker machine
 *   is still protected by `runChunk`'s reactive OOM fallback plus the
 *   session's learned {@link maxSafeSupersample} ceiling.
 */
export function flameAccumBudgetBuckets(
  deviceMemoryGiB: number | undefined,
  coarsePointer: boolean,
): number {
  if (coarsePointer) return FLAME_ACCUM_FLOOR_BUCKETS;
  const bytes = (deviceMemoryGiB ?? 8) * FLAME_ACCUM_BYTES_PER_GIB;
  const clamped = Math.min(
    FLAME_ACCUM_MAX_BYTES,
    Math.max(FLAME_ACCUM_FLOOR_BYTES, bytes),
  );
  return Math.floor(clamped / BYTES_PER_ACCUM_BUCKET);
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Accumulation backend seam (fr-npb)
// ---------------------------------------------------------------------------

/**
 * One accumulation run's engine — the seam a WebGPU accumulator
 * (`flame-gpu.ts`) plugs into alongside the CPU implementation below. The
 * session (`runChunk`) drives whichever backend is current in chunks and
 * snapshots it on the redisplay cadence; nothing outside this interface
 * (and `createBackend`, which chooses an implementation) knows which engine
 * is actually running.
 *
 * `accumulate`/`snapshot` return a plain value OR a `Promise` of one quite
 * deliberately, not always a `Promise` — see `runChunk`'s `isPromiseLike`
 * guard. The CPU backend below returns synchronously, and `runChunk` only
 * evaluates an `await` when the returned value is ACTUALLY a promise, so a
 * CPU-only accumulation never yields to the microtask queue: it runs one
 * chunk start-to-finish (accumulate, maybe snapshot, maybe schedule the
 * next chunk) in the same synchronous stretch it always has, which is what
 * keeps it byte-identical to before this seam existed and keeps it
 * drivable by a plain synchronous `while` loop (see
 * flame-worker-core.test.ts's `stepScheduler`).
 */
export interface FlameAccumBackend {
  readonly kind: "cpu" | "gpu";
  /**
   * Advance ~`iterations` more steps; returns (or resolves to) the count
   * ACTUALLY retired. The CPU backend retires exactly `iterations`; a GPU
   * backend may retire more (rounding up to its dispatch granularity) but
   * never less — `runChunk` accumulates whatever comes back into
   * `iterationsDone`, so a render can finish slightly ABOVE its budget.
   * May throw/reject; the session owns recovery (see `runChunk`'s catch).
   */
  accumulate(iterations: number): number | Promise<number>;
  /**
   * Everything accumulated so far, as a {@link FlameHistogram}. The CPU
   * backend returns its live accumulator object — the exact same object
   * every call, zero conversion cost. A GPU backend reads its device buffers
   * back and converts them into one. Called only on the redisplay cadence
   * (`runChunk`'s `due` branch) or once more at finish — never per chunk —
   * since a GPU readback is comparatively expensive. May throw/reject (a GPU
   * readback can fail on its own — e.g. a device lost between a successful
   * `accumulate` and this call — independently of `accumulate` ever
   * failing); the session owns recovery, with the same GPU-fallback/CPU-
   * error shape as `accumulate`'s (see `runChunk`'s `due` branch).
   */
  snapshot(): FlameHistogram | Promise<FlameHistogram>;
  /**
   * OPTIONAL (fr-ee9): a progressive-display-resolution downsample WITHOUT a
   * full-histogram readback — a GPU backend runs its downsample compute
   * kernel over the resident accumulation buffer and reads back only a
   * `displayWidth x displayHeight` histogram, instead of `snapshot()`'s full
   * `width x height` one followed by a CPU `downsampleFlame` pass. Display
   * dimensions and filter radius are baked in at backend-creation time (see
   * `GpuBackendRequest`'s `displayWidth`/`displayHeight`/
   * `progressiveFilterRadius`); the caller passes an `out` histogram with
   * EXACTLY those dimensions (one of `runChunk`'s `displaySlots`), and every
   * bucket is unconditionally overwritten (the same dirty-reuse contract as
   * `downsampleFlame`'s own `out`). The CPU backend does NOT implement this
   * — its live accumulator IS already display-cheap to downsample on the
   * main-thread-adjacent worker, so there is no readback to avoid. When
   * present, `runChunk`'s due branch prefers this over `snapshot()` for every
   * NOT-yet-finished redisplay tick; the finished frame always calls
   * `snapshot()` regardless (see that method's doc and `runChunk`'s own).
   */
  snapshotDisplay?(
    out: FlameHistogram,
  ): FlameHistogram | Promise<FlameHistogram>;
  /** Release any resources this backend holds (GPU buffers/pipelines). A
   * no-op for the CPU backend. Idempotent — safe to call more than once
   * (e.g. a generation hand-off destroying an already-orphaned backend). */
  destroy(): void;
  /** Adapter/device label the backend factory discovered (e.g. a
   * `GPUAdapterInfo` description) — surfaced verbatim in the `"backend"`
   * event for the UI to display. `undefined` for the CPU backend, and for
   * any GPU backend that has no better label to offer. */
  readonly adapterLabel?: string;
}

/**
 * Everything a `createGpuBackend` factory needs to stand up one
 * accumulation's worth of GPU state — the GPU counterpart of the fields the
 * CPU backend reads off the session directly (it doesn't need a request
 * object; it closes over the session's own fields instead, since it never
 * crosses an async boundary before its first use).
 */
export interface GpuBackendRequest {
  /** The raw (un-rotated, un-symmetried) transform list — see
   * `FlameWorkerSession.baseTransforms`. */
  transforms: Transform[];
  finalTransform: Transform | null;
  /** Kaleidoscope symmetry (fr-6im) — see `chaos-game.ts`'s `prepareChaosGame`. */
  order: number;
  axis: SymmetryAxis;
  /** Structural-coloring palette (fr-6us); `"legacy"` = per-transform hue. */
  paletteId: FlamePaletteId;
  projection: Mat4;
  /** ACCUMULATION resolution (display size x effective supersample) — NOT
   * the display resolution `start.width`/`height` carry. */
  width: number;
  height: number;
  /**
   * Deterministic per-restart seed, drawn from the session's own (already
   * `start`-seeded) `Rng` at backend-creation time — so it is fully
   * determined by the `start` command's seed, yet distinct for every
   * restart within the session, mirroring how the CPU path's continuing
   * `rng` instance makes each restart's orbit stream distinct too.
   */
  seed: number;
  /**
   * fr-ee9: DISPLAY resolution (the session's fixed `width`/`height` — NOT
   * `width`/`height` above, which are the accumulation size) and the fixed
   * reconstruction-filter radius progressive redisplays blur with — sizes
   * and parameterizes a `snapshotDisplay`-capable backend's downsample
   * pipeline at creation time, once per accumulation.
   */
  displayWidth: number;
  displayHeight: number;
  progressiveFilterRadius: number;
}

/**
 * Everything a `createGpuBackend4` factory needs to stand up one 4D
 * accumulation's worth of GPU state (fr-e26) — the 4D twin of
 * {@link GpuBackendRequest}, carrying exactly what `flame-gpu-4d.ts`'s
 * packers consume. `projection`, `view`, and `color` are the SAME objects
 * the CPU oracle (`accumulateFlame4`, via `Cpu4DFlameBackend`) takes, so
 * the two engines cannot disagree on what is being rendered. There is no
 * symmetry (`order`/`axis`) and no `paletteId`: 4D has no kaleidoscope
 * symmetry, and the palette dispatch is already resolved into `color` by
 * the session's own `buildFourDColor`.
 */
export interface GpuBackendRequest4 {
  /** The raw 4D transform set — see `FlameWorkerSession.baseTransforms4`. */
  transforms4: Transform4[];
  finalTransform4: Transform4 | null;
  /** The 20-coefficient composed rotor+camera affine (`project4.ts`'s
   * `composeFlameProjection4`), row-major 4x5 — the same array
   * `accumulateFlame4` takes. */
  projection: Float64Array;
  /** The frozen 4D view (signed-w normalization + soft slice) — see
   * `project4.ts`'s `FourDView`. */
  view: FourDView;
  /** The session's built {@link FourDRenderColor} — see `buildFourDColor`. */
  color: FourDRenderColor;
  /** ACCUMULATION resolution (display size x effective supersample). */
  width: number;
  height: number;
  /** Deterministic per-restart seed — same contract as
   * {@link GpuBackendRequest.seed}. */
  seed: number;
  /** fr-ee9: display resolution + progressive filter radius — same contract
   * as {@link GpuBackendRequest}'s fields of the same names. */
  displayWidth: number;
  displayHeight: number;
  progressiveFilterRadius: number;
}

/**
 * Resolves `value` immediately if it is already a plain value, or `await`s
 * it if it is genuinely a promise — see {@link FlameAccumBackend}'s doc for
 * why this distinction (rather than an unconditional `await`) is load-
 * bearing: an `async` function's `await` ALWAYS defers to the microtask
 * queue, even for a non-thenable operand, so unconditionally writing `await
 * backend.accumulate(n)` would make every CPU chunk yield once — breaking a
 * synchronous `while` loop's ability to drive a render to completion (its
 * next iteration would find nothing queued yet, since the scheduled
 * continuation is still sitting in the microtask queue). Guarding the
 * `await` so it is only ever textually evaluated for an actual thenable
 * keeps a CPU-only `runChunk` fully synchronous end-to-end, exactly as
 * before this backend seam existed.
 */
function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Promise<T>).then === "function"
  );
}

/**
 * The CPU accumulation backend: wraps today's exact `accumulateFlame` call
 * behind {@link FlameAccumBackend} so the session can drive either engine
 * through one seam. Holds the one thing that makes a chunked render
 * resumable — its own {@link FlameHistogram}, `null` until the first
 * `accumulate` call — plus everything `accumulateFlame` needs that doesn't
 * change chunk to chunk (the prepared geometry, camera, dimensions,
 * palette/colorLUT, and the session's SHARED `Rng` instance: threading the
 * very same live `rng` through every chunk, rather than each backend owning
 * a copy, is what makes a chunked render produce the identical orbit a
 * single unchunked call would).
 */
class CpuFlameBackend implements FlameAccumBackend {
  readonly kind = "cpu" as const;
  private histogram: FlameHistogram | null = null;

  constructor(
    private readonly accumulateFn: typeof accumulateFlame,
    private readonly prepared: PreparedChaosGame,
    private readonly projection: Mat4,
    private readonly width: number,
    private readonly height: number,
    private readonly palette: Vec3[],
    private readonly rng: Rng,
    private readonly colorLUT: Float32Array | null,
  ) {}

  accumulate(iterations: number): number {
    this.histogram = this.accumulateFn(
      this.prepared,
      this.projection,
      this.width,
      this.height,
      iterations,
      this.rng,
      this.palette,
      this.histogram ?? undefined,
      this.colorLUT ?? undefined,
    );
    return iterations; // CPU always retires exactly what it was asked for.
  }

  snapshot(): FlameHistogram {
    // Shouldn't happen: `runChunk` only ever snapshots after at least one
    // successful `accumulate` on this backend. Thrown, not silently
    // defaulted, so a future ordering bug surfaces immediately.
    if (!this.histogram) {
      throw new Error("CpuFlameBackend.snapshot() called before accumulate()");
    }
    return this.histogram;
  }

  destroy(): void {
    // Nothing to release: accumulateFlame only ever touches plain JS
    // objects/typed arrays, which the GC reclaims on its own.
  }
}

/**
 * The CPU 4D accumulation backend (fr-5b3): wraps `flame-4d.ts`'s
 * `accumulateFlame4` in the same shape {@link CpuFlameBackend} wraps
 * `accumulateFlame` in for the 3D path. Driven through the same
 * `FlameWorkerSession.backend` seam and `runChunk` loop as every other
 * engine (fr-e26 — until the 4D GPU kernel existed, this class had its own
 * synchronous `runChunk4` twin); its `accumulate`/`snapshot` return plain
 * values (never promises), so `runChunk`'s `isPromiseLike` guard keeps a
 * CPU-only 4D render exactly as synchronous as it always was. This is both
 * the no-GPU engine and the engine a 4D session falls BACK to when the
 * `createGpuBackend4` factory is absent or fails — the same role
 * `CpuFlameBackend` plays for 3D.
 */
class Cpu4DFlameBackend implements FlameAccumBackend {
  readonly kind = "cpu" as const;
  private histogram: FlameHistogram | null = null;

  constructor(
    private readonly prepared: PreparedChaosGame4,
    private readonly projection: Float64Array,
    private readonly view: FourDView,
    private readonly width: number,
    private readonly height: number,
    private readonly rng: Rng,
    private readonly color: FourDRenderColor,
  ) {}

  accumulate(iterations: number): number {
    this.histogram = accumulateFlame4(
      this.prepared,
      this.projection,
      this.view,
      this.width,
      this.height,
      iterations,
      this.rng,
      this.color,
      this.histogram ?? undefined,
    );
    return iterations; // CPU always retires exactly what it was asked for.
  }

  snapshot(): FlameHistogram {
    // Shouldn't happen: runChunk only ever snapshots after at least one
    // successful accumulate() on this backend — see CpuFlameBackend's own
    // snapshot() for the same discipline.
    if (!this.histogram) {
      throw new Error(
        "Cpu4DFlameBackend.snapshot() called before accumulate()",
      );
    }
    return this.histogram;
  }

  destroy(): void {
    // Nothing to release: accumulateFlame4 only ever touches plain JS
    // objects/typed arrays, which the GC reclaims on its own.
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * One flame render's worker-side session: owns the supersampled accumulator,
 * the OOM guard, the throttled downsample, the finished-frame adaptive
 * density-estimation blur, and live tone-map/estimate re-application. One
 * instance per `start` — a supersample change restarts accumulation
 * in-place (see {@link startAccumulation}), it does not create a new session;
 * the main thread gets a fresh session by terminating the worker and
 * spinning up a new one (see `main.ts`'s `enterFlameMode`/`exitFlameMode`),
 * so there is no `cancel` command here — an in-flight synchronous
 * `accumulateFlame` call can't be interrupted mid-call regardless (workers
 * are single-threaded JS too), and `Worker.terminate()` from the main thread
 * is the only thing that actually stops one immediately.
 */
export class FlameWorkerSession {
  private readonly now: () => number;
  private readonly schedule: (fn: () => void) => void;
  private readonly emit: (event: FlameWorkerEvent) => void;
  private readonly accumulate: typeof accumulateFlame;
  /** Absent = CPU-only regardless of `gpuPreference` — see FlameWorkerDeps. */
  private readonly createGpuBackend?: (
    request: GpuBackendRequest,
  ) => Promise<FlameAccumBackend>;
  /** The 4D factory (fr-e26) — same absent-means-CPU rule, for 4D sessions. */
  private readonly createGpuBackend4?: (
    request: GpuBackendRequest4,
  ) => Promise<FlameAccumBackend>;
  /** Diagnostic sink for GPU-fallback/failure messages — see FlameWorkerDeps. */
  private readonly log: (message: string) => void;
  /** Fallback budget for starts that don't carry one — see FlameWorkerDeps. */
  private readonly defaultMaxAccumBuckets: number;
  /** The budget the CURRENT session runs under: the `start` command's
   * device-aware value (see {@link flameAccumBudgetBuckets}), or the
   * fallback when the command carried none. */
  private maxAccumBuckets: number;
  private readonly initialChunkSize: number;

  private prepared: PreparedChaosGame | null = null;
  private projection: Mat4 | null = null;
  /** True when the current session's `start` carried a `fourD` block — see
   * that field's doc. Set once per `start`; a restart (setSupersample/
   * setPalette) never toggles it, since a session's dimensionality doesn't
   * change mid-life, only a brand-new `start` can. */
  private is4D = false;
  private prepared4: PreparedChaosGame4 | null = null;
  /** The 20-coefficient rotor+camera projection `composeFlameProjection4`
   * builds — resolution-independent (NDC-based), exactly like the 3D
   * path's `projection` above, so it is built ONCE in `start` and reused
   * across every `startAccumulation` restart (a supersample/palette change
   * never rebuilds it, mirroring `projection`'s own lifetime). */
  private projection4: Float64Array | null = null;
  private fourDView: FourDView | null = null;
  private fourDColorMode: FourDColorMode = "wBlueOrange";
  private fourDCenter: Vec4 = [0, 0, 0, 0];
  private fourDRadiusMin = 0;
  private fourDRadiusMax = 1;
  /** Built once per `startAccumulation` (never per chunk — see
   * `buildFourDColor`) from the current `paletteId`/`colorLUT` and the
   * `fourD` block's `colorMode`. `null` for a 3D session. */
  private fourDColor: FourDRenderColor | null = null;
  private palette: ReturnType<typeof transformColors> = [];
  /** Gradient lookup table for structural coloring, or `null` for the
   * per-transform `"legacy"` palette — see `flame.ts`'s `accumulateFlame`. */
  private colorLUT: Float32Array | null = null;
  /** The palette `colorLUT` was built from — `colorLUT` alone loses this
   * (`"legacy"` and any future no-op palette both look like `null`), and a
   * `GpuBackendRequest` needs the id itself, not the CPU-side LUT. */
  private paletteId: FlamePaletteId = "legacy";
  /** The raw (un-rotated) transforms/finalTransform from the last "start" —
   * retained so setSymmetry can re-prepare with a NEW symmetry without the
   * main thread resending the whole transform list. */
  private baseTransforms: Transform[] = [];
  private baseFinalTransform: Transform | null = null;
  /** The raw 4D transform set from the last "start"'s `fourD` block —
   * retained (alongside the composed `prepared4`) because a
   * {@link GpuBackendRequest4} carries the raw transforms; the GPU packer
   * composes its own affines from them, exactly as the 3D path retains
   * `baseTransforms` for `GpuBackendRequest`. Empty for a 3D session. */
  private baseTransforms4: Transform4[] = [];
  private baseFinalTransform4: Transform4 | null = null;
  /** The symmetry actually baked into `this.prepared` right now — lets
   * setSymmetry no-op a repeat value instead of restarting for nothing (the
   * order slider fires "input" continuously while dragging, and can report
   * the same integer step's value more than once in a row — the same class of
   * problem computeEffectiveSupersample's restart guard handles). */
  private symmetryOrder = 1;
  private symmetryAxis: SymmetryAxis = "y";
  private rng: Rng = Math.random;

  /** The current accumulation's engine (fr-npb) — `null` between a
   * `startAccumulation` and the next `runChunk` call, which creates one
   * lazily (GPU creation is async; `startAccumulation`'s callers are all
   * synchronous command handlers, so they can't await it themselves). */
  private backend: FlameAccumBackend | null = null;
  /** Bumped every `startAccumulation` (a restart, in place, of the SAME
   * session) — `runChunk` captures it on entry and re-checks it after every
   * `await`, so a restart that lands while a chunk/backend-creation is in
   * flight is detected and that stale work is discarded rather than
   * clobbering the new accumulation's state (see `runChunk`'s doc). */
  private generation = 0;
  /** Ratchets from `false` to `true` the first time the GPU backend fails
   * (creation or accumulation) and never resets — a device's GPU either
   * works or it doesn't, so there is no point re-attempting the factory
   * after this session has already seen it fail once. */
  private gpuFailed = false;
  /** From the `start` command (see its doc); `"off"` unless the main thread
   * explicitly opts in. Read fresh on every backend creation, so a `start`
   * with no `createGpuBackend` factory wired up (every pre-fr-npb caller)
   * behaves identically regardless of what this says. */
  private gpuPreference: "auto" | "off" = "off";
  /** fr-ul2 throughput instrumentation, all inert unless the `start` command
   * set `instrument` (see its doc). `perf` accumulates per-chunk phase timings
   * and periodically yields a summary to `log`; `lastChunkEndAt` is the clock
   * reading at the previous chunk's end, so the next chunk can attribute the
   * scheduling gap between them. Every clock read that feeds these is guarded
   * by `this.instrument`, so a non-instrumented run's timing is unchanged. */
  private instrument = false;
  private perf: FlamePerfMeter | null = null;
  private lastChunkEndAt: number | undefined = undefined;

  /** The latest accumulation snapshot: CPU backend, the live accumulator
   * object itself (identical semantics to before this backend seam
   * existed, since a chunked CPU accumulate mutates and returns that same
   * object every call — see `CpuFlameBackend`); GPU backend-to-come, the
   * last-converted mirror. Refreshed only on the redisplay cadence
   * (`runChunk`'s `due` branch), same as `displayHistogram` below — every
   * OTHER reader of this field (`redisplayWithFreshEstimate`, the
   * `setIterationsBudget`-lowered path) only ever runs once accumulation
   * has stopped, by which point the terminal chunk's `due` branch (finished
   * is always due) has already refreshed it. At accumWidth x accumHeight
   * (display size x effective supersample). */
  private histogram: FlameHistogram | null = null;
  /** Display-resolution derivative, refreshed on the cadence `runChunk`
   * decides — never fed back into `accumulateFlame` (see `downsampleFlame`).
   * Always points at whichever of {@link displaySlots} was written last;
   * `null` only while nothing has been downsampled yet this accumulation. */
  private displayHistogram: FlameHistogram | null = null;
  /** The display-resolution histogram(s) `rebuildDisplay` cycles through as
   * `downsampleFlame`/`adaptiveDownsampleFlame` `out` targets. Shared mode:
   * the two SAB-backed slots from the `start` command (the double buffer the
   * protocol doc describes). Transfer mode: ONE locally-owned histogram —
   * reused so a progressive render stops churning a display-size Float64
   * allocation every redisplay tick (nobody else ever reads it; the
   * tone-map happens synchronously right after each rebuild). */
  private displaySlots: FlameHistogram[] = [];
  /** Cursor into {@link displaySlots}: which slot the NEXT rebuild writes. */
  private nextDisplaySlot = 0;
  /** Index of the slot written LAST — what a `sharedFrame` notification
   * names, including a re-notification for an already-built frame. */
  private lastDisplaySlot = 0;
  /** True when `start` carried `sharedFrames` — selects which event shape
   * {@link sendProgress} emits. */
  private sharedMode = false;

  /** Display resolution — fixed for the session's life. */
  private width = 0;
  private height = 0;
  private accumWidth = 0;
  private accumHeight = 0;

  /** The effective (post-budget-clamp) supersample factor `histogram` was
   * created at — not necessarily the raw requested value; see
   * `clampSupersampleToBudget`. */
  private effectiveSupersample = 1;
  /** Ratchets DOWN (never up) when an accumulation allocation actually fails
   * at some size — learned once per session: a device's real memory ceiling
   * doesn't improve mid-session, so retrying a size that just failed would
   * just fail again. An extra cap on top of clampSupersampleToBudget's own
   * proactive, estimate-based one. */
  private maxSafeSupersample = Infinity;
  private lastRequestedSupersample: number | undefined;

  private iterationsDone = 0;
  private iterationsBudget = 0;

  private tonemapParams: TonemapParams = {
    exposure: 1,
    gamma: 1,
    gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
    vibrancy: 1,
  };
  /** Only ever read once accumulation is finished (see `runChunk`'s `due`
   * block) — this inline default is overwritten by `start` before that can
   * happen, same as `tonemapParams` above. */
  private estimatorParams: DensityEstimatorParams = {
    estimatorRadius: 0,
    estimatorMinimumRadius: 0,
    estimatorCurve: 1,
  };

  /** undefined until the first downsample+tonemap+transfer of this session,
   * so that first one is never throttled. */
  private lastDownsampleAt: number | undefined;
  /**
   * "The finished-frame adaptive display for the CURRENT accumulation +
   * budget has already been sent" (fr-ee9). Exists because a
   * `snapshotDisplay`-capable (GPU) backend's progressive due ticks
   * deliberately never refresh `this.histogram` (see that method's doc) —
   * so `setIterationsBudget`'s lowered-mid-render branch can no longer
   * safely re-run the finished-frame adaptive pass itself (its only
   * histogram to rebuild from would be null or, worse, STALE from a
   * previous finish). This flag lets that branch do nothing for a non-CPU
   * backend (see its own doc) and instead guards `runChunk`'s budget-met
   * entry bail, which fetches a fresh snapshot and produces the finished
   * frame exactly once per accumulation+budget, no matter how many already-
   * scheduled chunks re-enter after the render is actually done.
   */
  private finalFrameDisplayed = false;
  private chunkSize: number;
  /** True while a chunk is scheduled or in flight — guards against
   * double-scheduling the loop (e.g. a `setIterationsBudget` bump arriving
   * while a chunk is already pending). */
  private running = false;
  /** True while a deferred re-estimate (fr-3fv) is sitting in the schedule
   * queue — guards `setEstimatorParam` against queuing a second one on top
   * of it, which is what lets a burst of live estimator-param commands
   * coalesce into a single adaptive pass instead of one per command (see
   * that method's doc). Cleared when the deferred task actually runs,
   * whether or not it goes on to call `redisplayWithFreshEstimate` — a
   * stale/superseded/still-running bail still means nothing is pending
   * anymore, so the next live change should queue a fresh one. */
  private estimatorRedisplayPending = false;
  /** Set once by {@link dispose} and never cleared (fr-1ib) — unlike a
   * restart (which bumps `generation` to hand the loop off to a NEW
   * accumulation), disposal has nothing to hand off TO: this is what makes
   * both `ensureRunning` and `runChunk`'s own re-check refuse to ever
   * schedule/run another chunk again, including one already sitting in the
   * schedule queue when `dispose()` ran. */
  private disposed = false;

  constructor(deps: FlameWorkerDeps) {
    this.now = deps.now;
    this.schedule = deps.schedule;
    this.emit = deps.emit;
    this.accumulate = deps.accumulate ?? accumulateFlame;
    this.createGpuBackend = deps.createGpuBackend;
    this.createGpuBackend4 = deps.createGpuBackend4;
    this.log = deps.log ?? (() => {});
    this.defaultMaxAccumBuckets =
      deps.maxAccumBuckets ?? FLAME_ACCUM_FLOOR_BUCKETS;
    this.maxAccumBuckets = this.defaultMaxAccumBuckets;
    this.initialChunkSize = deps.initialChunkSize ?? FLAME_CHUNK_INITIAL;
    this.chunkSize = this.initialChunkSize;
  }

  /** Dispatch one command from the main thread. */
  handle(command: FlameWorkerCommand): void {
    switch (command.type) {
      case "start":
        this.start(command);
        break;
      case "setIterationsBudget": {
        const wasFinished = this.iterationsDone >= this.iterationsBudget;
        this.iterationsBudget = command.iterations;
        if (this.iterationsDone < this.iterationsBudget) {
          // Resuming past a prior finish (or past whatever had accumulated)
          // means a new finished frame will eventually be owed again —
          // un-latch the guard (fr-ee9) before ensureRunning() schedules the
          // chunk that will (eventually) produce it.
          this.finalFrameDisplayed = false;
          this.ensureRunning();
        } else if (wasFinished) {
          // Already finished before this change, so the frame on screen is
          // already the adaptive finished one — only the label's target is
          // now stale (fr-15z). Re-send (a cheap re-tonemap in transfer
          // mode, a scalars-only re-notification in shared mode) so it
          // reads 100% against the new budget.
          this.redisplayNow();
        } else if (this.backend?.kind === "cpu" && this.histogram) {
          // Lowered to/below the accumulated count mid-render: that finishes
          // the render on the spot, but no chunk will run to say so — the
          // already-scheduled one bails silently in runChunk — so the label
          // would freeze at its last value (fr-15z) and the display would
          // keep the cheap progressive filter instead of the finished-frame
          // adaptive estimate. Finish here: adaptive pass + final progress —
          // but ONLY for the CPU backend, whose live `this.histogram` is
          // always current (this preserves today's synchronous event timing
          // for CPU exactly).
          this.redisplayWithFreshEstimate();
        }
        // else: a snapshotDisplay-capable (GPU) backend mid-render, or no
        // backend/histogram yet at all. this.histogram here is either null
        // (never refreshed this accumulation — GPU's progressive due ticks
        // deliberately skip it, see FlameAccumBackend.snapshotDisplay's doc)
        // or STALE (left over from a PREVIOUS finish), so redisplaying from
        // it now would either no-op or silently show old data — do nothing
        // here. runChunk's own budget-met entry bail (fr-ee9) is what
        // actually finishes the render in this case: it fetches a fresh
        // `backend.snapshot()` and produces the finished frame instead —
        // mid-render implies `running === true`, so a chunk is always
        // scheduled or in flight, and is therefore guaranteed to reach that
        // bail and run it, exactly once (see `finalFrameDisplayed`'s doc).
        break;
      }
      case "setExposure":
        this.setTonemapParam("exposure", command.exposure);
        break;
      case "setGamma":
        this.setTonemapParam("gamma", command.gamma);
        break;
      case "setVibrancy":
        this.setTonemapParam("vibrancy", command.vibrancy);
        break;
      case "setSupersample":
        this.setSupersample(command.supersample);
        break;
      case "setEstimatorRadius":
        this.setEstimatorParam("estimatorRadius", command.estimatorRadius);
        break;
      case "setEstimatorMinimumRadius":
        this.setEstimatorParam(
          "estimatorMinimumRadius",
          command.estimatorMinimumRadius,
        );
        break;
      case "setEstimatorCurve":
        this.setEstimatorParam("estimatorCurve", command.estimatorCurve);
        break;
      case "setPalette":
        this.setPalette(command.paletteId);
        break;
      case "setSymmetry":
        this.setSymmetry(command.order, command.axis);
        break;
    }
  }

  /**
   * Permanently stop this session and release its backend (fr-1ib) — for a
   * host that runs a session OUTSIDE a dedicated Worker (`flame-session-
   * host.ts`), which has no single call that reclaims a same-thread
   * session's GPU resources the way killing a whole Worker thread does for
   * the worker-hosted case. Bumps `generation` (so a chunk already in
   * flight discovers, on its next check, that it has been superseded — see
   * `runChunk`'s doc) and destroys the current backend (a no-op if none
   * exists yet, e.g. disposing a session that never started). Unlike a
   * restart, there is nothing to hand off TO: `disposed` latches
   * permanently, so neither that hand-off's `ensureRunning()` call nor a
   * chunk already sitting in the schedule queue can ever start another one.
   * Idempotent.
   */
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.backend?.destroy();
    this.backend = null;
  }

  private start(cmd: Extract<FlameWorkerCommand, { type: "start" }>): void {
    this.baseTransforms = cmd.transforms;
    this.baseFinalTransform = cmd.finalTransform;
    this.symmetryOrder = cmd.order;
    this.symmetryAxis = cmd.axis;
    this.prepared = prepareChaosGame(cmd.transforms, cmd.finalTransform, {
      order: cmd.order,
      axis: cmd.axis,
    });
    this.projection = cmd.projection;
    this.palette = transformColors(cmd.transforms.length);
    // null for "legacy" — accumulateFlame then colors by transform (palette).
    this.colorLUT = buildPaletteLUT(cmd.paletteId);
    this.paletteId = cmd.paletteId;
    this.is4D = cmd.fourD !== undefined;
    if (cmd.fourD) {
      const fourD = cmd.fourD;
      this.baseTransforms4 = fourD.transforms4;
      this.baseFinalTransform4 = fourD.finalTransform4;
      this.prepared4 = prepareChaosGame4(
        fourD.transforms4,
        fourD.finalTransform4,
      );
      // Resolution-independent (NDC-based), like the 3D path's own
      // `projection` — built once here and reused across every
      // startAccumulation restart (see `projection4`'s doc).
      this.projection4 = composeFlameProjection4(
        cmd.projection,
        composeRotorProjection4(fourD.rotor, fourD.center),
      );
      this.fourDView = {
        invWAmp: fourD.invWAmp,
        sliceOn: fourD.sliceOn,
        sliceCenter: fourD.sliceCenter,
        sliceWidth: fourD.sliceWidth,
        sliceRelativeColor: fourD.sliceRelativeColor,
      };
      this.fourDColorMode = fourD.colorMode;
      this.fourDCenter = fourD.center;
      this.fourDRadiusMin = fourD.radiusMin;
      this.fourDRadiusMax = fourD.radiusMax;
    } else {
      this.baseTransforms4 = [];
      this.baseFinalTransform4 = null;
      this.prepared4 = null;
      this.projection4 = null;
      this.fourDView = null;
    }
    this.rng = mulberry32(cmd.seed);
    this.width = cmd.width;
    this.height = cmd.height;
    this.sharedMode = cmd.sharedFrames !== undefined;
    this.displaySlots = cmd.sharedFrames
      ? cmd.sharedFrames.map((frame) =>
          viewFlameHistogram(
            cmd.width,
            cmd.height,
            frame.hits,
            frame.sumRGB,
            0,
          ),
        )
      : [createFlameHistogram(cmd.width, cmd.height)];
    this.nextDisplaySlot = 0;
    this.iterationsBudget = cmd.iterationsBudget;
    this.tonemapParams = {
      exposure: cmd.exposure,
      gamma: cmd.gamma,
      gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
      vibrancy: cmd.vibrancy,
    };
    this.estimatorParams = {
      estimatorRadius: cmd.estimatorRadius,
      estimatorMinimumRadius: cmd.estimatorMinimumRadius,
      estimatorCurve: cmd.estimatorCurve,
    };
    this.maxSafeSupersample = Infinity; // a fresh session has no learned ceiling yet.
    this.maxAccumBuckets = cmd.maxAccumBuckets ?? this.defaultMaxAccumBuckets;
    this.gpuPreference = cmd.gpuPreference ?? "off";
    this.instrument = cmd.instrument ?? false;
    this.perf = this.instrument ? new FlamePerfMeter() : null;
    this.lastChunkEndAt = undefined;
    this.startAccumulation(cmd.requestedSupersample);
  }

  /**
   * Whether `start` has populated this session's geometry — 3D `prepared`/
   * `projection`, or (for a 4D session) `prepared4`/`projection4`/
   * `fourDView` — the shared "is there an active session to restart/run"
   * gate `ensureRunning` and every live-command handler use.
   */
  private hasGeometry(): boolean {
    return this.is4D
      ? this.prepared4 !== null &&
          this.projection4 !== null &&
          this.fourDView !== null
      : this.prepared !== null && this.projection !== null;
  }

  /**
   * Build this session's {@link FourDRenderColor} from the CURRENT
   * `paletteId`/`colorLUT` and the `start` command's `fourD` block — called
   * once per `startAccumulation` (never per chunk), so a live `setPalette`
   * rebuilds it fresh on every restart. A non-`"legacy"` `paletteId` always
   * wins (structural coloring, exactly mirroring the 3D path's own
   * `colorLUT !== null` precedence); `"legacy"` dispatches on the
   * explorer's own 4D color mode — see `color.ts`'s `FourDRenderColor` doc
   * for what each variant reproduces.
   */
  private buildFourDColor(): FourDRenderColor {
    if (this.colorLUT !== null) {
      return { kind: "structural", lut: this.colorLUT };
    }
    switch (this.fourDColorMode) {
      case "wBlueOrange":
      case "wPurpleGreen":
      case "wCyanMagenta":
        return { kind: "wRamp", side: W_SIDE_PALETTES[this.fourDColorMode] };
      case "transform":
        return {
          kind: "transform",
          palette: transformColors(this.prepared4?.transformCount ?? 0),
        };
      case "radius":
        return {
          kind: "radius",
          lut: buildColorModeLUT("radius", 1),
          center: this.fourDCenter,
          minD: this.fourDRadiusMin,
          maxD: this.fourDRadiusMax,
        };
    }
  }

  private computeEffectiveSupersample(requested: number): number {
    const budgeted = clampSupersampleToBudget(
      this.width,
      this.height,
      requested,
      this.maxAccumBuckets,
    );
    return Math.min(budgeted, this.maxSafeSupersample);
  }

  /**
   * (Re)size the accumulator for `requested` (clamped to what fits the
   * memory budget) and discard any progress: shared by `start`, a live
   * `setSupersample` command, and the allocation-failure fallback in
   * `runChunk` — all three need a from-scratch histogram at a (possibly new)
   * size. Assumes width/height (the display size) are already set.
   */
  private startAccumulation(requested: number): void {
    const effective = this.computeEffectiveSupersample(requested);
    this.accumWidth = this.width * effective;
    this.accumHeight = this.height * effective;
    this.effectiveSupersample = effective;
    this.lastRequestedSupersample = requested;
    // A restart, in place, of the SAME session (fr-npb) — bump the
    // generation so a `runChunk` already in flight (mid-chunk, or awaiting
    // GPU backend creation) recognizes on its next check that IT has been
    // superseded, and destroy the outgoing backend now rather than leaving
    // that to whichever stale `runChunk` eventually notices (it may never
    // get the chance to — see that method's doc).
    this.generation++;
    this.backend?.destroy();
    this.backend = null;
    this.histogram = null;
    this.displayHistogram = null;
    this.iterationsDone = 0;
    this.lastDownsampleAt = undefined;
    this.finalFrameDisplayed = false;
    // Reset to the CPU initial unconditionally: a backend doesn't exist yet
    // (just destroyed above), so the CPU size is the only sane baseline —
    // `runChunk` bumps this to the GPU initial itself, once, right after it
    // lazily creates a GPU backend (see its doc).
    this.chunkSize = this.initialChunkSize;
    // The color sums a fresh accumulation will produce depend on the
    // CURRENT paletteId/colorMode — rebuilt here (not just in `start`) so a
    // live setPalette's restart picks up the new palette (see
    // buildFourDColor's doc).
    if (this.is4D) {
      this.fourDColor = this.buildFourDColor();
    }
    this.emitSupersampleNote(effective, requested);
    this.ensureRunning();
  }

  private emitSupersampleNote(effective: number, requested: number): void {
    this.emit({
      type: "supersampleNote",
      effective: effective < requested ? effective : null,
      requested,
    });
  }

  private setTonemapParam<K extends keyof TonemapParams>(
    key: K,
    value: TonemapParams[K],
  ): void {
    this.tonemapParams = { ...this.tonemapParams, [key]: value };
    // Transfer mode only, in practice: in shared mode the main thread owns
    // the tone-map and applies these params locally without ever sending a
    // command (see main.ts) — if one arrives anyway, the redisplay below
    // just re-notifies the current slot, which is harmless.
    //
    // While still accumulating, the next naturally-scheduled (throttled)
    // redisplay already reads tonemapParams fresh, so nothing else to do.
    // Once done, nothing else will ever refresh the display again — this is
    // the only thing that will, so do it now.
    if (!this.running) this.redisplayNow();
  }

  /**
   * Unlike tonemapParams (re-read fresh by sendProgress on every send, so
   * just resending picks up a live change), estimatorParams only feeds the
   * adaptive downsample baked into `displayHistogram` by `runChunk`'s
   * finished branch — resending as-is would just re-tonemap the OLD
   * estimate. While still accumulating, that finished branch hasn't run yet
   * and will read estimatorParams fresh when it does, so nothing else to do
   * here. Once finished, nothing will ever rebuild displayHistogram again on
   * its own — this is the only thing that will.
   *
   * That adaptive pass is O(width * height * radius^2) — can take seconds
   * at a wide radius — and dragging an estimator slider posts a BURST of
   * these commands in quick succession. Running the pass synchronously per
   * command makes the visible display lag behind the pointer by (queued
   * commands × pass cost): a one-second drag can queue ~30 of them, each
   * replaying the full pass before the next command is even read (fr-3fv).
   *
   * So instead of running it inline, defer the pass through `schedule`
   * (`(fn) => setTimeout(fn, 0)` in the real hosts) and coalesce with
   * `estimatorRedisplayPending` so a burst only ever has ONE deferred pass
   * outstanding. `estimatorParams` above is still updated eagerly on every
   * call — only the expensive part is deferred. `setTimeout(fn, 0)` lands
   * behind every command already sitting in the session thread's message
   * queue, so by the time the deferred pass fires, the whole burst has
   * already landed in `estimatorParams` — the pass reads it once, at the
   * end, with the NEWEST value of every param, not just whichever command
   * happened to trigger it. Ticks that arrive WHILE a long pass is
   * running queue up behind it the same way: the deferred task clears the
   * flag BEFORE doing the work, so once the pass finishes, the first
   * queued tick re-arms one fresh deferred pass and the rest of the
   * backlog coalesces into it. Net effect: the display lags at most one
   * pass behind the newest params, with no fixed debounce constant to tune
   * and no perceptible added latency when the pass itself is fast.
   *
   * The deferred callback re-validates before doing the expensive work,
   * mirroring `runChunk`'s own supersede discipline: `disposed`/`gen` cover
   * disposal and a restart in the meantime (a DIFFERENT accumulation's own
   * finished branch already reads estimatorParams fresh on its own, so this
   * stale task has nothing useful left to do). `running` additionally
   * covers `setIterationsBudget` resuming accumulation WITHOUT bumping
   * `generation` (see that case's comment) — without this check, a
   * deferred pass firing mid-resume would waste a full pass on a histogram
   * about to be overwritten AND prematurely set `finalFrameDisplayed`
   * (fr-ee9), suppressing the resumed render's own real finished frame.
   */
  private setEstimatorParam<K extends keyof DensityEstimatorParams>(
    key: K,
    value: DensityEstimatorParams[K],
  ): void {
    this.estimatorParams = { ...this.estimatorParams, [key]: value };
    if (this.running || this.estimatorRedisplayPending) return;
    this.estimatorRedisplayPending = true;
    const gen = this.generation;
    this.schedule(() => {
      this.estimatorRedisplayPending = false;
      if (this.disposed || gen !== this.generation || this.running) return;
      this.redisplayWithFreshEstimate();
    });
  }

  private setSupersample(requested: number): void {
    if (!this.hasGeometry()) return; // no active session yet.
    const newEffective = this.computeEffectiveSupersample(requested);
    if (newEffective !== this.effectiveSupersample) {
      this.startAccumulation(requested);
    } else {
      // The effective size didn't change (e.g. two requested values already
      // clamp to the same one), so nothing to restart — but the note's
      // "(from Nx)" wording would otherwise go stale, still naming whatever
      // was requested the last time a restart actually ran.
      this.lastRequestedSupersample = requested;
      this.emitSupersampleNote(newEffective, requested);
    }
  }

  private setPalette(paletteId: FlamePaletteId): void {
    if (!this.hasGeometry()) return; // no active session yet.
    this.colorLUT = buildPaletteLUT(paletteId);
    this.paletteId = paletteId;
    // sumRGB has the old palette's colors baked into it, so — unlike a
    // tone-map param — this can't be re-applied to the existing accumulation;
    // it has to accumulate afresh. Same restart path setSupersample uses (the
    // size is unchanged, so this reallocates an identical-size histogram).
    this.startAccumulation(
      this.lastRequestedSupersample ?? this.effectiveSupersample,
    );
  }

  private setSymmetry(order: number, axis: SymmetryAxis): void {
    if (!this.hasGeometry()) return; // no active session yet.
    // Symmetry (fr-6im) is 3D-only: the UI hides the control while a 4D
    // session is active, but guard here too rather than trust that. A 4D
    // session has no `postRotations`/base-map bookkeeping to rebuild, so
    // there is nothing for this command to actually do.
    if (this.is4D) return;
    if (order === this.symmetryOrder && axis === this.symmetryAxis) return;
    this.symmetryOrder = order;
    this.symmetryAxis = axis;
    this.prepared = prepareChaosGame(
      this.baseTransforms,
      this.baseFinalTransform,
      { order, axis },
    );
    // The accumulated color sums (and the slot layout itself) assume the OLD
    // geometry — symmetry changes which slots exist, not just a tone-map
    // parameter — so, like setPalette, this can't be re-applied to the
    // existing accumulation; it has to accumulate afresh. Same restart path
    // setSupersample/setPalette use (the display size is unchanged, so this
    // reallocates an identical-size histogram).
    this.startAccumulation(
      this.lastRequestedSupersample ?? this.effectiveSupersample,
    );
  }

  private ensureRunning(): void {
    if (this.disposed) return;
    if (this.running) return;
    if (!this.hasGeometry()) return;
    if (this.iterationsDone >= this.iterationsBudget) return;
    this.running = true;
    this.schedule(() => {
      void this.runChunk();
    });
  }

  /**
   * Bring up a backend for the CURRENT accumulation: GPU first when
   * `gpuPreference` is `"auto"`, the session's dimension has a factory
   * wired up, and GPU hasn't already failed this session; CPU otherwise.
   * Dimension-aware (fr-e26): a 4D session tries `createGpuBackend4` and
   * falls back to {@link Cpu4DFlameBackend}, a 3D one tries
   * `createGpuBackend` and falls back to {@link CpuFlameBackend} — one
   * `gpuPreference`/`gpuFailed` discipline over both. Returns the CPU
   * backend DIRECTLY (not wrapped in a `Promise`) whenever GPU isn't
   * attempted — deliberately not declared `async` (which would implicitly
   * wrap every return in a `Promise`, promise-ifying even the all-CPU path
   * and defeating `runChunk`'s `isPromiseLike` guard at the one call site
   * that runs on EVERY first chunk of EVERY accumulation) — so `runChunk`
   * applies the exact same conditional-`await` pattern here as it does for
   * `accumulate`/`snapshot`. The actual GPU attempts (which DO need
   * `async`/`try`/`catch`) live in {@link createGpuBackendWithFallback} /
   * {@link createGpuBackend4WithFallback}.
   *
   * Reads the session's own geometry fields rather than taking them as
   * parameters: it is only ever called synchronously from `runChunk`, after
   * `hasGeometry()` has confirmed the current dimension's fields are
   * populated — and if a restart lands while a (GPU) creation is in flight,
   * `runChunk`'s generation re-check destroys whatever comes back, so a
   * stale read can never be installed.
   */
  private createBackend(): FlameAccumBackend | Promise<FlameAccumBackend> {
    if (this.gpuPreference === "auto" && !this.gpuFailed) {
      if (this.is4D) {
        const gpuFactory4 = this.createGpuBackend4;
        if (gpuFactory4) {
          return this.createGpuBackend4WithFallback(gpuFactory4);
        }
      } else {
        const gpuFactory = this.createGpuBackend;
        if (gpuFactory) {
          return this.createGpuBackendWithFallback(gpuFactory);
        }
      }
    }
    return this.is4D ? this.makeCpu4DBackend() : this.makeCpuBackend();
  }

  /** The genuinely-async half of {@link createBackend}'s 3D branch: try the
   * GPU factory, and on ANY throw/reject, ratchet `gpuFailed` (so this
   * session never retries it) and fall back to CPU. Takes `gpuFactory` as a
   * parameter, already known non-`undefined` by the caller, rather than
   * re-reading `this.createGpuBackend` and asserting it non-null here. */
  private async createGpuBackendWithFallback(
    gpuFactory: (request: GpuBackendRequest) => Promise<FlameAccumBackend>,
  ): Promise<FlameAccumBackend> {
    try {
      return await gpuFactory(this.buildGpuBackendRequest());
    } catch (e) {
      this.gpuFailed = true;
      this.log(
        `Flame: GPU backend unavailable, falling back to CPU (${describeError(e)}).`,
      );
      // Advisory signal for the host BEFORE the CPU fallback below stands: a
      // worker-hosted session's main thread may escalate to its own GPU host
      // instead of accepting CPU (fr-e07). See the event's doc.
      this.emit({ type: "gpuUnavailable" });
      return this.makeCpuBackend();
    }
  }

  /** The 4D twin of {@link createGpuBackendWithFallback} (fr-e26) — same
   * ratchet, same log shape, `Cpu4DFlameBackend` as the fallback. */
  private async createGpuBackend4WithFallback(
    gpuFactory4: (request: GpuBackendRequest4) => Promise<FlameAccumBackend>,
  ): Promise<FlameAccumBackend> {
    try {
      return await gpuFactory4(this.buildGpuBackendRequest4());
    } catch (e) {
      this.gpuFailed = true;
      this.log(
        `Flame: GPU backend unavailable, falling back to CPU (${describeError(e)}).`,
      );
      // Advisory signal for the host BEFORE the CPU fallback below stands: a
      // worker-hosted session's main thread may escalate to its own GPU host
      // instead of accepting CPU (fr-e07). See the event's doc.
      this.emit({ type: "gpuUnavailable" });
      return this.makeCpu4DBackend();
    }
  }

  /** Non-null assertions throughout: only ever called (via
   * {@link createBackend}) after `hasGeometry()` has confirmed the 3D
   * fields are populated — the same "trust `start`'s invariant" discipline
   * this method has always applied to `this.accumWidth`/`this.palette`. */
  private makeCpuBackend(): FlameAccumBackend {
    return new CpuFlameBackend(
      this.accumulate,
      this.prepared!,
      this.projection!,
      this.accumWidth,
      this.accumHeight,
      this.palette,
      this.rng,
      this.colorLUT,
    );
  }

  /** The 4D counterpart of {@link makeCpuBackend} — same non-null-assertion
   * discipline (`hasGeometry()` has confirmed `prepared4`/`projection4`/
   * `fourDView`, and `startAccumulation` populates `fourDColor` alongside
   * them before any chunk can run). */
  private makeCpu4DBackend(): Cpu4DFlameBackend {
    return new Cpu4DFlameBackend(
      this.prepared4!,
      this.projection4!,
      this.fourDView!,
      this.accumWidth,
      this.accumHeight,
      this.rng,
      this.fourDColor!,
    );
  }

  /** Assembles a {@link GpuBackendRequest} from the session's retained
   * "last start" state — see that type's doc for the per-restart `seed`.
   * Same non-null-assertion discipline as {@link makeCpuBackend}, and the
   * same field-free shape as {@link buildGpuBackendRequest4} (fr-e26 made
   * `createBackend` arg-free; a lingering `projection` parameter here would
   * suggest a per-call value where there is only the session's own). */
  private buildGpuBackendRequest(): GpuBackendRequest {
    return {
      transforms: this.baseTransforms,
      finalTransform: this.baseFinalTransform,
      order: this.symmetryOrder,
      axis: this.symmetryAxis,
      paletteId: this.paletteId,
      projection: this.projection!,
      width: this.accumWidth,
      height: this.accumHeight,
      seed: Math.floor(this.rng() * 0x100000000) >>> 0,
      displayWidth: this.width,
      displayHeight: this.height,
      progressiveFilterRadius: FLAME_FILTER_RADIUS,
    };
  }

  /** The 4D twin of {@link buildGpuBackendRequest} (fr-e26). Non-null
   * assertions per {@link makeCpu4DBackend}'s discipline; `fourDColor` is
   * rebuilt by every `startAccumulation`, so the request always carries the
   * CURRENT palette/color-mode dispatch, exactly like the CPU backend. */
  private buildGpuBackendRequest4(): GpuBackendRequest4 {
    return {
      transforms4: this.baseTransforms4,
      finalTransform4: this.baseFinalTransform4,
      projection: this.projection4!,
      view: this.fourDView!,
      color: this.fourDColor!,
      width: this.accumWidth,
      height: this.accumHeight,
      seed: Math.floor(this.rng() * 0x100000000) >>> 0,
      displayWidth: this.width,
      displayHeight: this.height,
      progressiveFilterRadius: FLAME_FILTER_RADIUS,
    };
  }

  /**
   * Advance the current accumulation by one chunk, refresh the display on
   * the throttled cadence, and reschedule until the iteration budget is
   * met. `async` so a GPU backend's genuinely-asynchronous
   * accumulate/snapshot/creation calls can be awaited — but every `await`
   * below is guarded by `isPromiseLike` (see its doc), so a CPU-only
   * accumulation never actually suspends: it runs exactly as synchronously
   * as it did before this backend seam existed, which is what lets
   * flame-worker-core.test.ts's synchronous `scheduler.drain()` keep
   * driving every pre-fr-npb test to completion unmodified — an
   * unconditional `await` here would instead make even a CPU chunk yield to
   * the microtask queue, and a plain synchronous `while` loop can never
   * catch that continuation (see `isPromiseLike`'s doc).
   *
   * Generation handling (fr-npb): `gen` is this call's accumulation
   * identity, captured on entry. Because backend creation and accumulation
   * can both genuinely suspend (the GPU paths), a `setSupersample`/
   * `setPalette`/`setSymmetry`/OOM-ratchet/GPU-failure restart can land on
   * `this` WHILE this call is suspended — `startAccumulation` bumps
   * `this.generation`, destroys `this.backend`, and — because `this.running`
   * is still `true` (this very call hasn't returned yet) — its own
   * `ensureRunning()` no-ops, leaving THIS call as the only thing that will
   * ever reschedule the loop. So every point below that resumes from an
   * `await` re-checks `gen !== this.generation` and, if superseded, cleans
   * up anything only this stale call owns (an orphaned just-created
   * backend nobody has installed yet) and calls `this.running = false;
   * this.ensureRunning();` — which this time actually schedules the new
   * generation's first chunk, hanging the loop off to it rather than
   * letting it die or double-running it.
   */
  private async runChunk(): Promise<void> {
    const gen = this.generation;
    // Re-checked here, not just in ensureRunning's gate before scheduling:
    // a chunk already scheduled runs regardless of what happens in between
    // (JS is single-threaded, but a `setIterationsBudget` command — or a
    // `dispose()` call, fr-1ib — handled before this chunk fires doesn't
    // retroactively unschedule it). `disposed` needs this check for the same
    // reason: without it, a chunk already sitting in the schedule queue when
    // `dispose()` runs would resume here, find `this.backend` null (dispose
    // destroyed and cleared it), and spin up a BRAND NEW backend — exactly
    // the resurrection `dispose()` exists to rule out. `hasGeometry()`
    // covers whichever dimension this session runs in (fr-e26 — this one
    // loop now drives 3D and 4D alike; see `createBackend`).
    if (this.disposed || !this.hasGeometry()) {
      this.running = false;
      return;
    }

    // A budget LOWERED below iterationsDone in the meantime (or one that was
    // never raised past it) must stop here too — without this,
    // `iterationsBudget - iterationsDone` below goes negative and silently
    // corrupts the progress count instead of just finishing. Split out from
    // the disposed/prepared/projection bail above (fr-ee9): unlike those,
    // this case may still owe the finished-frame adaptive display — a
    // snapshotDisplay-capable (GPU) backend's progressive due ticks
    // deliberately never refresh `this.histogram` (see
    // FlameAccumBackend.snapshotDisplay's doc), so `setIterationsBudget`'s
    // lowered-mid-render branch can't safely redisplay from it itself (see
    // that branch's own doc) — THIS pending chunk (guaranteed to run, since
    // mid-render implies `running` was true when the budget changed) is
    // where that finished frame actually gets produced instead.
    // `finalFrameDisplayed` (see its doc) makes this idempotent: a chunk
    // that re-enters here after the render is already fully displayed just
    // bails, without redoing the fetch+rebuild+send.
    if (this.iterationsDone >= this.iterationsBudget) {
      if (!this.finalFrameDisplayed && this.backend !== null) {
        const backend = this.backend;
        let snap: FlameHistogram;
        try {
          const snapResult = backend.snapshot();
          snap = isPromiseLike(snapResult) ? await snapResult : snapResult;
        } catch (e) {
          // Mirrors the due branch's own finished-snapshot catch below
          // exactly (gen-recheck first, then the GPU-ratchet-restart / CPU-
          // error split) — kept as a separate, inline copy rather than a
          // shared helper: the two call sites sit in different control-flow
          // shapes (this one always bails outright; the due branch's falls
          // through to the reschedule-or-stop tail), and threading a helper
          // through both would either flatten that difference back out via
          // an extra tri-state return value or muddy the generation dance
          // this method's own doc describes — inline duplication reads more
          // clearly here than the abstraction would.
          if (gen !== this.generation) {
            this.running = false;
            this.ensureRunning();
            return;
          }
          this.running = false;
          if (backend.kind === "gpu") {
            this.gpuFailed = true;
            this.log(
              `Flame: GPU snapshot failed, restarting on CPU (${describeError(e)}).`,
            );
            this.startAccumulation(
              this.lastRequestedSupersample ?? this.effectiveSupersample,
            );
          } else {
            this.emit({ type: "error", message: describeError(e) });
          }
          return;
        }
        if (gen !== this.generation) {
          this.running = false;
          this.ensureRunning();
          return;
        }
        this.histogram = snap;
        this.rebuildDisplay(true);
        this.sendProgress();
        this.finalFrameDisplayed = true;
      }
      // backend === null here means the budget was lowered before any chunk
      // ever ran this accumulation — nothing has been accumulated yet, so
      // there is nothing to display; bail as today.
      this.running = false;
      return;
    }

    // Lazily bring up this accumulation's backend — not in
    // startAccumulation, which is a synchronous command handler and can't
    // await the (possibly async) GPU factory.
    if (this.backend === null) {
      const createdResult = this.createBackend();
      const created = isPromiseLike(createdResult)
        ? await createdResult
        : createdResult;
      if (gen !== this.generation) {
        // Superseded while the factory was in flight (see this method's
        // doc). Nobody else references `created` — it was never installed
        // as `this.backend` — so release it now rather than leak it (a
        // no-op for CPU, real cleanup for GPU).
        created.destroy();
        this.running = false;
        this.ensureRunning();
        return;
      }
      this.backend = created;
      // A GPU backend just came up: its dispatch granularity dwarfs a CPU
      // chunk (see FLAME_GPU_CHUNK_INITIAL's doc) — bump off the CPU-sized
      // value startAccumulation just reset chunkSize to, rather than wait
      // for adaptChunkSize to climb there one 2x step at a time. The
      // equality check is always true here in practice (backend creation
      // only ever happens immediately after that reset, before anything
      // else can touch chunkSize) — kept explicit rather than unconditional
      // so the intent ("bump only the first GPU chunk after a backend
      // comes up") reads directly at the call site instead of leaning on
      // that ordering invariant silently.
      if (created.kind === "gpu" && this.chunkSize === this.initialChunkSize) {
        this.chunkSize = FLAME_GPU_CHUNK_INITIAL;
      }
      this.emit({
        type: "backend",
        backend: created.kind,
        adapter: created.adapterLabel,
      });
    }
    const backend = this.backend;

    // fr-ul2 instrumentation: this chunk's steady-state start (AFTER any
    // one-time backend creation above, so backend-bring-up cost isn't charged
    // to steady-state throughput) and the scheduling gap since the previous
    // chunk's work ended. Both guarded — a non-instrumented run reads the
    // clock exactly where it always did (t0/t1 around accumulate).
    const tEntry = this.instrument ? this.now() : 0;
    const gapMs =
      this.instrument && this.lastChunkEndAt !== undefined
        ? tEntry - this.lastChunkEndAt
        : 0;

    const chunk = Math.min(
      this.chunkSize,
      this.iterationsBudget - this.iterationsDone,
    );
    // Only the FIRST accumulate call for a given backend allocates (inside
    // accumulateFlame, CPU side) — a later call resuming an already-
    // allocated histogram isn't expected to newly fail for memory reasons,
    // so only a fresh-start failure gets the shrink-and-retry treatment
    // below; anything else is a real bug and should surface, not be
    // swallowed. Still exactly `this.histogram === null`, not something
    // read off the backend: the very first chunk after ANY (re)start is
    // unconditionally "due" (`lastDownsampleAt` is freshly `undefined` — see
    // the `due` computation below), so `this.histogram` is always populated
    // from that very chunk's snapshot before `runChunk` can be called
    // again — this session-level flag has tracked "fresh start" correctly
    // since before the backend seam existed, and still does. (fr-ee9: a
    // snapshotDisplay-capable GPU backend's progressive due ticks now leave
    // `this.histogram` unpopulated instead — see that method's doc — so the
    // "first due chunk populates this.histogram" invariant above no longer
    // holds universally. It still holds everywhere `wasFreshStart` is
    // actually READ, though: this flag is only ever consulted below, in the
    // CPU-only OOM-ratchet catch, which a GPU backend's `accumulate` failure
    // never reaches — it takes the unconditional `backend.kind === "gpu"`
    // branch first, several lines down. CPU backends never have
    // `snapshotDisplay`, so wherever this flag is read, its computation
    // above is unchanged from before fr-ee9.)
    const wasFreshStart = this.histogram === null;
    const t0 = this.now();
    let actual: number;
    try {
      const result = backend.accumulate(chunk);
      actual = isPromiseLike(result) ? await result : result;
    } catch (e) {
      if (gen !== this.generation) {
        // Superseded while accumulating — the new generation already owns
        // its own backend/state; this stale failure carries nothing useful.
        this.running = false;
        this.ensureRunning();
        return;
      }
      this.running = false;
      if (backend.kind === "gpu") {
        // GPU failure recovery is unconditional and unlearned (unlike the
        // CPU ratchet below): a GPU accumulate failure isn't a
        // "this-size-doesn't-fit" signal the way a CPU allocation failure
        // is, so there's no smaller size worth trying first — drop to CPU
        // for the rest of the session and restart the current accumulation
        // there from scratch.
        this.gpuFailed = true;
        this.log(
          `Flame: GPU accumulation failed, restarting on CPU (${describeError(e)}).`,
        );
        this.startAccumulation(
          this.lastRequestedSupersample ?? this.effectiveSupersample,
        );
        return;
      }
      if (wasFreshStart && this.effectiveSupersample > 1) {
        // The proactive budget estimate (clampSupersampleToBudget) wasn't
        // conservative enough for this device at this size — learn that and
        // retry smaller, rather than failing every attempt forever.
        // requested state (the user's slider) is untouched: this is a
        // capability ceiling, not the user's request.
        this.maxSafeSupersample = this.effectiveSupersample - 1;
        this.startAccumulation(
          this.lastRequestedSupersample ?? this.effectiveSupersample,
        );
      } else {
        // Nothing smaller left to fall back to (already at 1x), or this
        // wasn't even a fresh allocation — surface it; the main thread
        // returns to the explorer rather than retrying forever.
        this.emit({ type: "error", message: describeError(e) });
      }
      return;
    }
    if (gen !== this.generation) {
      // Succeeded, but superseded while in flight — discard the result
      // rather than folding a stale generation's work into the new one's
      // iterationsDone/histogram.
      this.running = false;
      this.ensureRunning();
      return;
    }

    const t1 = this.now();
    // `actual`, not `chunk`: a backend may retire MORE than it was asked
    // for (GPU rounds up to its dispatch granularity — see
    // FlameAccumBackend's doc) — iterationsDone may end up slightly ABOVE
    // iterationsBudget, which is fine: the `finished`/`due` checks below
    // only ever compare `>=`.
    this.iterationsDone += actual;
    this.adaptChunkSize(t1 - t0);

    const finished = this.iterationsDone >= this.iterationsBudget;
    const due =
      finished ||
      this.lastDownsampleAt === undefined ||
      t1 - this.lastDownsampleAt >= FLAME_REDISPLAY_INTERVAL_MS;
    // fr-ul2: bracket the WHOLE redisplay (readback + convert + display) so its
    // cost is attributed apart from accumulate. Reading the clock here (not
    // inside the branches) leaves their control flow untouched; a superseded/
    // failed readback returns early and never reaches the meter feed below.
    const tReadback0 = this.instrument && due ? this.now() : 0;
    if (due) {
      if (!finished && backend.snapshotDisplay !== undefined) {
        // GPU progressive display path (fr-ee9): the downsample runs
        // resident on the device, reading back only a display-resolution
        // histogram — no full w*h*ss^2 readback + CPU downsampleFlame every
        // tick (see FlameAccumBackend.snapshotDisplay's doc). `this.histogram`
        // is deliberately NOT refreshed here: only the full-snapshot branch
        // below (which this `!finished` guard always routes away from while
        // a GPU backend is still mid-render) and the budget-met entry bail
        // above ever populate it.
        const out = this.takeDisplaySlot();
        let result: FlameHistogram;
        try {
          const resultOrPromise = backend.snapshotDisplay(out);
          result = isPromiseLike(resultOrPromise)
            ? await resultOrPromise
            : resultOrPromise;
        } catch (e) {
          // Mirrors the full-snapshot catch below (gen-recheck first, then
          // ratchet + restart) but with no CPU flavor to fall through to:
          // `snapshotDisplay` only ever exists on a GPU backend (see that
          // method's doc — the CPU backend never implements it), so
          // unconditionally ratcheting `gpuFailed` here (rather than
          // branching on `backend.kind`, as the other two catches in this
          // method do) is exact, not a simplifying assumption.
          if (gen !== this.generation) {
            this.running = false;
            this.ensureRunning();
            return;
          }
          this.running = false;
          this.gpuFailed = true;
          this.log(
            `Flame: GPU display downsample failed, restarting on CPU (${describeError(e)}).`,
          );
          this.startAccumulation(
            this.lastRequestedSupersample ?? this.effectiveSupersample,
          );
          return;
        }
        if (gen !== this.generation) {
          this.running = false;
          this.ensureRunning();
          return;
        }
        this.displayHistogram = result;
        this.lastDownsampleAt = t1;
        this.sendProgress();
      } else {
        let snap: FlameHistogram;
        try {
          const snapResult = backend.snapshot();
          snap = isPromiseLike(snapResult) ? await snapResult : snapResult;
        } catch (e) {
          // Mirrors the accumulate catch above: a GPU readback can fail on
          // its own (e.g. a device lost between a successful accumulate and
          // this snapshot) independently of accumulate ever failing, and
          // letting that rejection escape `runChunk` unhandled would trip
          // the main thread's generic worker.onerror ("crashed") path
          // instead of the graceful fallback accumulate failures get for the
          // exact same underlying event — inconsistent recovery for the same
          // failure.
          if (gen !== this.generation) {
            this.running = false;
            this.ensureRunning();
            return;
          }
          this.running = false;
          if (backend.kind === "gpu") {
            this.gpuFailed = true;
            this.log(
              `Flame: GPU snapshot failed, restarting on CPU (${describeError(e)}).`,
            );
            this.startAccumulation(
              this.lastRequestedSupersample ?? this.effectiveSupersample,
            );
          } else {
            // CpuFlameBackend.snapshot only throws on a broken invariant (see
            // its doc) — not a retryable/ratchetable condition like the CPU
            // accumulate OOM path above — so there is nothing smaller to try;
            // surface it exactly like the accumulate catch's own CPU branch.
            this.emit({ type: "error", message: describeError(e) });
          }
          return;
        }
        if (gen !== this.generation) {
          this.running = false;
          this.ensureRunning();
          return;
        }
        this.histogram = snap;
        this.rebuildDisplay(finished);
        this.lastDownsampleAt = t1;
        this.sendProgress();
        // This branch IS the finished-frame adaptive display for the current
        // accumulation + budget whenever `finished` (a CPU backend's own
        // ordinary, not-yet-finished progressive due tick also runs this
        // same branch — CPU never has `snapshotDisplay` — but that case
        // isn't the finished frame, hence the guard) — see
        // `finalFrameDisplayed`'s doc.
        if (finished) {
          this.finalFrameDisplayed = true;
        }
      }
    }

    // fr-ul2: feed this chunk's phase timings to the meter and periodically log
    // a summary. Reaching here means the chunk's accumulate (and any due
    // redisplay) both succeeded for the current generation. `now` also stamps
    // the chunk's end so the NEXT chunk can attribute the scheduling gap.
    if (this.instrument && this.perf) {
      const now = this.now();
      const summary = this.perf.record({
        accumulateMs: t1 - t0,
        iterations: actual,
        readbackMs: due ? now - tReadback0 : 0,
        gapMs,
        wallMs: now - tEntry,
        chunkSize: this.chunkSize,
        backendKind: backend.kind,
      });
      if (summary !== null) this.log(summary);
      this.lastChunkEndAt = now;
    }

    if (finished) {
      this.running = false;
    } else {
      this.schedule(() => {
        void this.runChunk();
      });
    }
  }

  private adaptChunkSize(elapsed: number): void {
    if (elapsed <= 0) return;
    // Damped multiplicative correction (capped to 0.5x-2x per chunk) so one
    // slow chunk (e.g. a GC pause) doesn't overcorrect wildly. Target/bounds
    // are picked by the CURRENT backend's kind (see the FLAME_GPU_* consts'
    // doc for why the GPU numbers are so much larger); falls back to the CPU
    // numbers if somehow called with no backend up yet, though in practice
    // this only ever runs right after a successful accumulate, which always
    // has one.
    const gpu = this.backend?.kind === "gpu";
    const budgetMs = gpu ? FLAME_GPU_FRAME_BUDGET_MS : FLAME_FRAME_BUDGET_MS;
    const minChunk = gpu ? FLAME_GPU_CHUNK_MIN : FLAME_CHUNK_MIN;
    const maxChunk = gpu ? FLAME_GPU_CHUNK_MAX : FLAME_CHUNK_MAX;
    const scale = Math.min(2, Math.max(0.5, budgetMs / elapsed));
    this.chunkSize = Math.round(
      Math.min(maxChunk, Math.max(minChunk, this.chunkSize * scale)),
    );
  }

  /**
   * Advance the display-slot cursor and return the slot the caller should
   * write into next — the slot-cycling dance `rebuildDisplay` (the CPU/
   * finished-frame downsample path) and the GPU progressive display path
   * (fr-ee9's `runChunk` due branch) both need identically: cycles
   * {@link displaySlots} (the SAB-backed double buffer in shared mode, or the
   * one locally-owned reused histogram in transfer mode), recording which
   * slot was written last for {@link sendProgress}'s `sharedFrame` notice.
   */
  private takeDisplaySlot(): FlameHistogram {
    this.lastDisplaySlot = this.nextDisplaySlot;
    const out = this.displaySlots[this.nextDisplaySlot];
    this.nextDisplaySlot =
      (this.nextDisplaySlot + 1) % this.displaySlots.length;
    return out;
  }

  /**
   * Rebuild `displayHistogram` from the current (full-resolution)
   * `histogram` into the next {@link displaySlots} target (via
   * {@link takeDisplaySlot}). `adaptive` picks the filter: the full
   * density-estimation pass (fr-17t) is O(width * height * radius^2) and not
   * chunked — cheap enough to pay ONCE on the finished frame, but not on
   * every throttled progressive redisplay while still accumulating (that
   * loop's whole reason to be throttled at all). The cheap fixed-radius
   * filter covers every preview tick instead; see `downsampleFlame`'s and
   * `adaptiveDownsampleFlame`'s docs for why the two coexist rather than one
   * replacing the other.
   */
  private rebuildDisplay(adaptive: boolean): void {
    if (!this.histogram) return;
    // Queued ahead of the synchronous pass below (fr-99z) so the main thread
    // sees it while the worker is still crunching, not after — see the
    // FlameWorkerEvent variant's doc. Progressive redisplays (adaptive ===
    // false) never take long enough to need this.
    if (adaptive) this.emit({ type: "estimating" });
    const out = this.takeDisplaySlot();
    this.displayHistogram = adaptive
      ? adaptiveDownsampleFlame(
          this.histogram,
          this.width,
          this.height,
          this.estimatorParams,
          out,
        )
      : downsampleFlame(
          this.histogram,
          this.width,
          this.height,
          FLAME_FILTER_RADIUS,
          out,
        );
  }

  private sendProgress(): void {
    const display = this.displayHistogram;
    if (!display) return;
    if (this.sharedMode) {
      // The frame is already sitting in the shared slot; only scalars cross.
      // This postMessage is also the memory-visibility edge for the slot's
      // bucket writes — see the module doc.
      this.emit({
        type: "sharedFrame",
        slot: this.lastDisplaySlot,
        maxHits: display.maxHits,
        iterationsDone: this.iterationsDone,
        iterationsBudget: this.iterationsBudget,
      });
      return;
    }
    const image = tonemapFlame(display, this.tonemapParams);
    this.emit({
      type: "progress",
      iterationsDone: this.iterationsDone,
      iterationsBudget: this.iterationsBudget,
      image,
      width: this.width,
      height: this.height,
    });
  }

  private redisplayNow(): void {
    if (this.displayHistogram) this.sendProgress();
  }

  /** Re-runs the adaptive pass over the frame already in hand with the
   * latest `estimatorParams` (into the next display slot), and sends it —
   * the finished-frame counterpart to `redisplayNow`'s "just re-send what's
   * already there", used when the thing that changed affects the downsample
   * itself, not just the tone-map applied after it. Only ever called once
   * accumulation is finished (see call sites — `setEstimatorParam`'s
   * deferred callback re-checks `running`/`generation` itself right before
   * calling this, precisely so that stays true even though the command
   * that queued it may have arrived mid-accumulation), so this IS the
   * finished-frame adaptive display for the current accumulation + budget —
   * set `finalFrameDisplayed` (fr-ee9) accordingly. */
  private redisplayWithFreshEstimate(): void {
    if (!this.histogram) return;
    this.rebuildDisplay(true);
    this.sendProgress();
    this.finalFrameDisplayed = true;
  }
}
