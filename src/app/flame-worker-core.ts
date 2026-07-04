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
import { transformColors } from "../fractal/color";
import { buildPaletteLUT } from "../fractal/palette";
import type { FlamePaletteId } from "../fractal/palette";
import { mulberry32 } from "../fractal/rng";
import type { Rng } from "../fractal/rng";
import type { SymmetryAxis, Transform } from "../fractal/types";

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
  | { type: "error"; message: string }
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

/** Fixed reconstruction-filter radius (display pixels) `downsampleFlame` blurs
 * PROGRESSIVE (not-yet-finished) frames with in `runChunk` — see its doc for
 * why fixed rather than density-adaptive. The finished frame instead gets
 * `adaptiveDownsampleFlame` (fr-17t), which has no equivalent fixed-radius
 * constant since its whole point is a radius computed per cell. */
const FLAME_FILTER_RADIUS = 0.4;
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
  /** Fallback budget for starts that don't carry one — see FlameWorkerDeps. */
  private readonly defaultMaxAccumBuckets: number;
  /** The budget the CURRENT session runs under: the `start` command's
   * device-aware value (see {@link flameAccumBudgetBuckets}), or the
   * fallback when the command carried none. */
  private maxAccumBuckets: number;
  private readonly initialChunkSize: number;

  private prepared: PreparedChaosGame | null = null;
  private projection: Mat4 | null = null;
  private palette: ReturnType<typeof transformColors> = [];
  /** Gradient lookup table for structural coloring, or `null` for the
   * per-transform `"legacy"` palette — see `flame.ts`'s `accumulateFlame`. */
  private colorLUT: Float32Array | null = null;
  /** The raw (un-rotated) transforms/finalTransform from the last "start" —
   * retained so setSymmetry can re-prepare with a NEW symmetry without the
   * main thread resending the whole transform list. */
  private baseTransforms: Transform[] = [];
  private baseFinalTransform: Transform | null = null;
  /** The symmetry actually baked into `this.prepared` right now — lets
   * setSymmetry no-op a repeat value instead of restarting for nothing (the
   * order slider fires "input" continuously while dragging, and can report
   * the same integer step's value more than once in a row — the same class of
   * problem computeEffectiveSupersample's restart guard handles). */
  private symmetryOrder = 1;
  private symmetryAxis: SymmetryAxis = "y";
  private rng: Rng = Math.random;

  /** The real progressive accumulator, at accumWidth x accumHeight (display
   * size x effective supersample). */
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
  private chunkSize: number;
  /** True while a chunk is scheduled or in flight — guards against
   * double-scheduling the loop (e.g. a `setIterationsBudget` bump arriving
   * while a chunk is already pending). */
  private running = false;

  constructor(deps: FlameWorkerDeps) {
    this.now = deps.now;
    this.schedule = deps.schedule;
    this.emit = deps.emit;
    this.accumulate = deps.accumulate ?? accumulateFlame;
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
          this.ensureRunning(); // resume if this raised the budget past iterationsDone.
        } else if (wasFinished) {
          // Already finished before this change, so the frame on screen is
          // already the adaptive finished one — only the label's target is
          // now stale (fr-15z). Re-send (a cheap re-tonemap in transfer
          // mode, a scalars-only re-notification in shared mode) so it
          // reads 100% against the new budget.
          this.redisplayNow();
        } else {
          // Lowered to/below the accumulated count mid-render: that finishes
          // the render on the spot, but no chunk will run to say so — the
          // already-scheduled one bails silently in runChunk — so the label
          // would freeze at its last value (fr-15z) and the display would
          // keep the cheap progressive filter instead of the finished-frame
          // adaptive estimate. Finish here: adaptive pass + final progress.
          this.redisplayWithFreshEstimate();
        }
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
    this.startAccumulation(cmd.requestedSupersample);
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
    this.histogram = null;
    this.displayHistogram = null;
    this.iterationsDone = 0;
    this.lastDownsampleAt = undefined;
    this.chunkSize = this.initialChunkSize;
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

  private setEstimatorParam<K extends keyof DensityEstimatorParams>(
    key: K,
    value: DensityEstimatorParams[K],
  ): void {
    this.estimatorParams = { ...this.estimatorParams, [key]: value };
    // Unlike tonemapParams (re-read fresh by sendProgress on every send, so
    // just resending picks up a live change), estimatorParams only feeds the
    // adaptive downsample baked into `displayHistogram` by `runChunk`'s
    // finished branch — resending as-is would just re-tonemap the OLD
    // estimate. While still accumulating, that finished branch hasn't run
    // yet and will read estimatorParams fresh when it does, so nothing else
    // to do here. Once finished, nothing will ever rebuild displayHistogram
    // again on its own — this is the only thing that will, so redo the
    // (done-frame-only, not re-chunked) adaptive pass against the histogram
    // already in hand now, rather than re-accumulating from scratch.
    if (!this.running) this.redisplayWithFreshEstimate();
  }

  private setSupersample(requested: number): void {
    if (!this.prepared || !this.projection) return; // no active session yet.
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
    if (!this.prepared || !this.projection) return; // no active session yet.
    this.colorLUT = buildPaletteLUT(paletteId);
    // sumRGB has the old palette's colors baked into it, so — unlike a
    // tone-map param — this can't be re-applied to the existing accumulation;
    // it has to accumulate afresh. Same restart path setSupersample uses (the
    // size is unchanged, so this reallocates an identical-size histogram).
    this.startAccumulation(
      this.lastRequestedSupersample ?? this.effectiveSupersample,
    );
  }

  private setSymmetry(order: number, axis: SymmetryAxis): void {
    if (!this.prepared || !this.projection) return; // no active session yet.
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
    if (this.running) return;
    if (!this.prepared || !this.projection) return;
    if (this.iterationsDone >= this.iterationsBudget) return;
    this.running = true;
    this.schedule(() => this.runChunk());
  }

  private runChunk(): void {
    const prepared = this.prepared;
    const projection = this.projection;
    // Re-checked here, not just in ensureRunning's gate before scheduling:
    // a chunk already scheduled runs regardless of what happens in between
    // (JS is single-threaded, but a `setIterationsBudget` command handled
    // before this chunk fires doesn't retroactively unschedule it), so a
    // budget LOWERED below iterationsDone in the meantime must stop here —
    // otherwise `iterationsBudget - iterationsDone` below goes negative and
    // silently corrupts the progress count instead of just finishing.
    if (
      !prepared ||
      !projection ||
      this.iterationsDone >= this.iterationsBudget
    ) {
      this.running = false;
      return;
    }

    const chunk = Math.min(
      this.chunkSize,
      this.iterationsBudget - this.iterationsDone,
    );
    // Only the FIRST accumulate call for a given histogram allocates (inside
    // accumulateFlame) — a later call resuming an already-allocated
    // histogram isn't expected to newly fail for memory reasons, so only a
    // fresh-start failure gets the shrink-and-retry treatment below;
    // anything else is a real bug and should surface, not be swallowed.
    const wasFreshStart = this.histogram === null;
    const t0 = this.now();
    let histogram: FlameHistogram;
    try {
      histogram = this.accumulate(
        prepared,
        projection,
        this.accumWidth,
        this.accumHeight,
        chunk,
        this.rng,
        this.palette,
        this.histogram ?? undefined,
        this.colorLUT ?? undefined,
      );
    } catch (e) {
      this.running = false;
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
    this.histogram = histogram;

    const t1 = this.now();
    this.iterationsDone += chunk;
    this.adaptChunkSize(t1 - t0);

    const finished = this.iterationsDone >= this.iterationsBudget;
    const due =
      finished ||
      this.lastDownsampleAt === undefined ||
      t1 - this.lastDownsampleAt >= FLAME_REDISPLAY_INTERVAL_MS;
    if (due) {
      this.rebuildDisplay(finished);
      this.lastDownsampleAt = t1;
      this.sendProgress();
    }

    if (finished) {
      this.running = false;
    } else {
      this.schedule(() => this.runChunk());
    }
  }

  private adaptChunkSize(elapsed: number): void {
    if (elapsed <= 0) return;
    // Damped multiplicative correction (capped to 0.5x-2x per chunk) so one
    // slow chunk (e.g. a GC pause) doesn't overcorrect wildly.
    const scale = Math.min(2, Math.max(0.5, FLAME_FRAME_BUDGET_MS / elapsed));
    this.chunkSize = Math.round(
      Math.min(
        FLAME_CHUNK_MAX,
        Math.max(FLAME_CHUNK_MIN, this.chunkSize * scale),
      ),
    );
  }

  /**
   * Rebuild `displayHistogram` from the current (full-resolution)
   * `histogram` into the next {@link displaySlots} target. `adaptive` picks
   * the filter: the full density-estimation pass (fr-17t) is O(width *
   * height * radius^2) and not chunked — cheap enough to pay ONCE on the
   * finished frame, but not on every throttled progressive redisplay while
   * still accumulating (that loop's whole reason to be throttled at all).
   * The cheap fixed-radius filter covers every preview tick instead; see
   * `downsampleFlame`'s and `adaptiveDownsampleFlame`'s docs for why the
   * two coexist rather than one replacing the other.
   */
  private rebuildDisplay(adaptive: boolean): void {
    if (!this.histogram) return;
    // Queued ahead of the synchronous pass below (fr-99z) so the main thread
    // sees it while the worker is still crunching, not after — see the
    // FlameWorkerEvent variant's doc. Progressive redisplays (adaptive ===
    // false) never take long enough to need this.
    if (adaptive) this.emit({ type: "estimating" });
    this.lastDisplaySlot = this.nextDisplaySlot;
    const out = this.displaySlots[this.nextDisplaySlot];
    this.nextDisplaySlot =
      (this.nextDisplaySlot + 1) % this.displaySlots.length;
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
   * itself, not just the tone-map applied after it. */
  private redisplayWithFreshEstimate(): void {
    if (!this.histogram) return;
    this.rebuildDisplay(true);
    this.sendProgress();
  }
}
