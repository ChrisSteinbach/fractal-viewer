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
 * Transport is postMessage TRANSFER, not SharedArrayBuffer: SAB needs
 * cross-origin isolation (COOP/COEP), which GitHub Pages — this app's deploy
 * target — cannot set at all (see fr-73y's design notes). So this session
 * keeps the big supersampled histogram entirely to itself and only ever
 * hands the main thread a small, already-downsampled-and-tone-mapped
 * display-resolution RGBA image per update.
 */
import {
  accumulateFlame,
  adaptiveDownsampleFlame,
  clampSupersampleToBudget,
  downsampleFlame,
  tonemapFlame,
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
import type { Bounds, ColorMode, Transform } from "../fractal/types";

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

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
      iterationsBudget: number;
      exposure: number;
      gamma: number;
      vibrancy: number;
      /** Initial {@link DensityEstimatorParams} — see that type's doc. */
      estimatorRadius: number;
      estimatorMinimumRadius: number;
      estimatorCurve: number;
      /** Structural-coloring palette (fr-6us); `"legacy"` = per-transform hue.
       * Only applies when `colorMode` is `"transform"`. */
      paletteId: FlamePaletteId;
      /** The explorer's color mode, frozen at render time (fr-6do). Non-
       * transform modes color each point by `bounds` instead of the palette,
       * mirroring the point cloud. */
      colorMode: ColorMode;
      /** The frozen cloud's bounds — normalizes the non-transform color modes
       * so the flame reproduces the explorer's exact colors (see `color.ts`'s
       * `writePointColor`). */
      bounds: Bounds;
    }
  | { type: "setIterationsBudget"; iterations: number }
  | { type: "setExposure"; exposure: number }
  | { type: "setGamma"; gamma: number }
  | { type: "setVibrancy"; vibrancy: number }
  | { type: "setSupersample"; supersample: number }
  | { type: "setEstimatorRadius"; estimatorRadius: number }
  | { type: "setEstimatorMinimumRadius"; estimatorMinimumRadius: number }
  | { type: "setEstimatorCurve"; estimatorCurve: number }
  | { type: "setPalette"; paletteId: FlamePaletteId };

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
      type: "supersampleNote";
      /** Maps directly onto `Ui.setFlameSupersampleNote`'s own signature. */
      effective: number | null;
      requested?: number;
    }
  | { type: "error"; message: string };

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
  /** Defaults to the real (300 MiB-derived) bucket budget; overridable so a
   * test can trigger the proactive `clampSupersampleToBudget` guard with
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
/**
 * Memory ceiling for one accumulation histogram's `hits` + `sumRGB` combined.
 * 300 MiB is chosen to comfortably survive on a memory-constrained phone
 * (this app is explicitly served to phones) while still allowing normal
 * desktop supersampling in the common case — see `clampSupersampleToBudget`'s
 * use in `startAccumulation` for the proactive guard this enables, and
 * `runChunk`'s accumulate try/catch for the reactive one that backs it up.
 */
const MAX_FLAME_ACCUM_BYTES = 300 * 1024 * 1024;
const MAX_FLAME_ACCUM_BUCKETS = Math.floor(
  MAX_FLAME_ACCUM_BYTES / BYTES_PER_ACCUM_BUCKET,
);

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
  private readonly maxAccumBuckets: number;
  private readonly initialChunkSize: number;

  private prepared: PreparedChaosGame | null = null;
  private projection: Mat4 | null = null;
  private palette: ReturnType<typeof transformColors> = [];
  /** Gradient lookup table for structural coloring, or `null` for the
   * per-transform `"legacy"` palette — see `flame.ts`'s `accumulateFlame`. */
  private colorLUT: Float32Array | null = null;
  /** Explorer color mode + the frozen cloud's bounds (fr-6do): drive the
   * non-transform (height/radius/position/uniform) coloring so the flame
   * matches the point cloud. Both are captured at `start` and never change for
   * the session's life (the explorer's controls are hidden while rendering). */
  private colorMode: ColorMode = "transform";
  private bounds: Bounds | undefined;
  private rng: Rng = Math.random;

  /** The real progressive accumulator, at accumWidth x accumHeight (display
   * size x effective supersample). */
  private histogram: FlameHistogram | null = null;
  /** Display-resolution derivative, refreshed on the cadence `runChunk`
   * decides — never fed back into `accumulateFlame` (see `downsampleFlame`). */
  private displayHistogram: FlameHistogram | null = null;

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
    this.maxAccumBuckets = deps.maxAccumBuckets ?? MAX_FLAME_ACCUM_BUCKETS;
    this.initialChunkSize = deps.initialChunkSize ?? FLAME_CHUNK_INITIAL;
    this.chunkSize = this.initialChunkSize;
  }

  /** Dispatch one command from the main thread. */
  handle(command: FlameWorkerCommand): void {
    switch (command.type) {
      case "start":
        this.start(command);
        break;
      case "setIterationsBudget":
        this.iterationsBudget = command.iterations;
        this.ensureRunning(); // resume if this raised the budget past iterationsDone.
        break;
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
    }
  }

  private start(cmd: Extract<FlameWorkerCommand, { type: "start" }>): void {
    this.prepared = prepareChaosGame(cmd.transforms, cmd.finalTransform);
    this.projection = cmd.projection;
    this.palette = transformColors(cmd.transforms.length);
    // null for "legacy" — accumulateFlame then colors by transform (palette).
    this.colorLUT = buildPaletteLUT(cmd.paletteId);
    this.colorMode = cmd.colorMode;
    this.bounds = cmd.bounds;
    this.rng = mulberry32(cmd.seed);
    this.width = cmd.width;
    this.height = cmd.height;
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
        this.colorMode,
        this.bounds,
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
      // The full adaptive pass (fr-17t) is O(width * height * radius^2) and
      // not chunked — cheap enough to pay ONCE on the finished frame, but
      // not on every throttled progressive redisplay while still
      // accumulating (this loop's whole reason to be throttled at all). The
      // cheap fixed-radius filter covers every preview tick instead; see
      // `downsampleFlame`'s and `adaptiveDownsampleFlame`'s docs for why
      // the two coexist rather than one replacing the other.
      this.displayHistogram = finished
        ? adaptiveDownsampleFlame(
            this.histogram,
            this.width,
            this.height,
            this.estimatorParams,
          )
        : downsampleFlame(
            this.histogram,
            this.width,
            this.height,
            FLAME_FILTER_RADIUS,
          );
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

  private sendProgress(): void {
    if (!this.displayHistogram) return;
    const image = tonemapFlame(this.displayHistogram, this.tonemapParams);
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

  /** Rebuilds `displayHistogram` from the current (full-resolution)
   * `histogram` via the adaptive pass with the latest `estimatorParams`, and
   * sends it — the finished-frame counterpart to `redisplayNow`'s "just
   * re-tonemap what's already there", used when the thing that changed
   * affects the downsample itself, not just the tone-map applied after it. */
  private redisplayWithFreshEstimate(): void {
    if (!this.histogram) return;
    this.displayHistogram = adaptiveDownsampleFlame(
      this.histogram,
      this.width,
      this.height,
      this.estimatorParams,
    );
    this.sendProgress();
  }
}
