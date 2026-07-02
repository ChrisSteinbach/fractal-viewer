/**
 * The flame render's Web Worker session state machine (fr-73y): everything
 * `main.ts`'s old `stepFlame` used to do synchronously on the main thread —
 * supersampled accumulation, the proactive + reactive OOM guard, throttled
 * downsample, and live tone-map re-application — now runs here, off the main
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
  clampSupersampleToBudget,
  downsampleFlame,
  tonemapFlame,
  DEFAULT_GAMMA_THRESHOLD,
} from "../fractal/flame";
import type { FlameHistogram, Mat4, TonemapParams } from "../fractal/flame";
import { prepareChaosGame } from "../fractal/chaos-game";
import type { PreparedChaosGame } from "../fractal/chaos-game";
import { transformColors } from "../fractal/color";
import { mulberry32 } from "../fractal/rng";
import type { Rng } from "../fractal/rng";
import type { Transform } from "../fractal/types";

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
    }
  | { type: "setIterationsBudget"; iterations: number }
  | { type: "setExposure"; exposure: number }
  | { type: "setGamma"; gamma: number }
  | { type: "setVibrancy"; vibrancy: number }
  | { type: "setSupersample"; supersample: number };

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
 * with — see its doc for why fixed, not yet density-adaptive (that's fr-17t). */
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
 * the OOM guard, the throttled downsample, and live tone-map re-application.
 * One instance per `start` — a supersample change restarts accumulation
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
    }
  }

  private start(cmd: Extract<FlameWorkerCommand, { type: "start" }>): void {
    this.prepared = prepareChaosGame(cmd.transforms, cmd.finalTransform);
    this.projection = cmd.projection;
    this.palette = transformColors(cmd.transforms.length);
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
      this.displayHistogram = downsampleFlame(
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
}
