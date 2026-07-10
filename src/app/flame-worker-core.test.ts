import {
  accumulateFlame,
  clampSupersampleToBudget,
  createFlameHistogram,
  tonemapFlame,
  viewFlameHistogram,
  DEFAULT_GAMMA_THRESHOLD,
} from "../fractal/flame";
import type { FlameHistogram, Mat4 } from "../fractal/flame";
import { W_SIDE_PALETTES } from "../fractal/color";
import { sierpinskiTetrahedron } from "../fractal/presets";
import type { Transform4 } from "../fractal/types";
import {
  FLAME_FILTER_RADIUS,
  flameAccumBudgetBuckets,
  FlameGpuSizeError,
  FlameGpuUnavailableError,
  FlameWorkerSession,
} from "./flame-worker-core";
import type {
  FlameAccumBackend,
  FlameWorkerCommand,
  FlameWorkerDeps,
  FlameWorkerEvent,
  GpuBackendRequest,
  GpuBackendRequest4,
  SharedFrameBuffers,
} from "./flame-worker-core";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

/** w = 1 always: no perspective divide, matching flame.test.ts's fixture —
 * this module isn't re-testing projection math, just needs a valid Mat4. */
// prettier-ignore
const ORTHOGRAPHIC: Mat4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function startCommand(
  overrides: Partial<Extract<FlameWorkerCommand, { type: "start" }>> = {},
): FlameWorkerCommand {
  return {
    type: "start",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    projection: ORTHOGRAPHIC,
    width: 8,
    height: 8,
    seed: 1,
    requestedSupersample: 1,
    iterationsBudget: 500,
    exposure: 1,
    gamma: 1,
    vibrancy: 1,
    estimatorRadius: 4,
    estimatorMinimumRadius: 0,
    estimatorCurve: 0.4,
    paletteId: "legacy",
    order: 1,
    axis: "y",
    ...overrides,
  };
}

/** Row-major 4x4 identity rotor — an inert 4D tumble (no rotation), for
 * fixtures that don't care about the rotor's own math. */
// prettier-ignore
const IDENTITY_ROTOR4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/** A simple pentatope-ish 4D system: every map contracts all of 4-space
 * toward the same fixed point, converging to (0.5, 0.5, 0.5, 0.5) — the 4D
 * twin of this file's implicit 3D fixture (`sierpinskiTetrahedron`), just
 * simple enough to reason about by hand for a session-level smoke test. */
function makeTransforms4(count: number): Transform4[] {
  return Array.from({ length: count }, (): Transform4 => ({
    position: [0.25, 0.25, 0.25, 0.25],
    scale: [0.5, 0.5, 0.5, 0.5],
  }));
}

/** A ready-to-use `fourD` block (see `FlameWorkerCommand`'s `start` variant)
 * — an inert rotor/center so the projection is "drop w, keep xyz" verbatim,
 * sliceOn false so every point contributes at full weight. Tests that care
 * about a specific field spread over this. */
function defaultFourD(): NonNullable<
  Extract<FlameWorkerCommand, { type: "start" }>["fourD"]
> {
  return {
    transforms4: makeTransforms4(4),
    finalTransform4: null,
    rotor: IDENTITY_ROTOR4,
    center: [0, 0, 0, 0],
    invWAmp: 1,
    sliceOn: false,
    sliceCenter: 0,
    sliceWidth: 1,
    sliceRelativeColor: false,
    colorMode: "wBlueOrange",
    radiusMin: 0,
    radiusMax: 1,
  };
}

/** A manually-stepped scheduler: `schedule` queues instead of running
 * immediately, so a test can interleave other commands between chunks
 * (`step`) or just drain the whole render (`drain`). */
function stepScheduler(): {
  schedule: (fn: () => void) => void;
  step: () => boolean;
  drain: () => void;
} {
  const queue: (() => void)[] = [];
  return {
    schedule: (fn) => queue.push(fn),
    step: () => {
      const fn = queue.shift();
      if (!fn) return false;
      fn();
      return true;
    },
    drain(): void {
      while (this.step()) {
        /* keep going */
      }
    },
  };
}

/**
 * Resolves after a real macrotask boundary — by the time this settles,
 * every microtask queued so far (however many sequential `await`s a fake
 * GPU backend's promise chain took) has fully drained. Only needed by the
 * GPU-backend tests below, whose fakes return REAL promises: a CPU-only
 * run never actually suspends (`flame-worker-core.ts`'s `isPromiseLike`
 * guard skips `await` whenever a backend returns a plain value), so every
 * other test in this file keeps using the synchronous `scheduler.drain()`/
 * `step()` unmodified. A single `await Promise.resolve()` would NOT be
 * enough here: it only guarantees one pending continuation has run, and
 * can resume in the wrong order relative to a multi-step chain (each
 * additional internal `await` re-queues behind whatever this already
 * queued) — a macrotask sidesteps that ordering subtlety entirely, since
 * the platform never runs one until the microtask queue is completely
 * empty.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Drives a session whose current chunk may genuinely suspend (a real GPU
 * factory/backend promise) to completion: step the manual scheduler, let
 * that step's async work fully settle, and repeat until nothing is left to
 * schedule. */
async function drainAsync(
  scheduler: ReturnType<typeof stepScheduler>,
): Promise<void> {
  while (scheduler.step()) {
    await flushMicrotasks();
  }
}

/** A clock that advances by `step` (0 by default — i.e. constant, so
 * elapsed-time-driven chunk adaptation and redisplay throttling are both
 * inert unless a test explicitly wants to exercise them) on every read. */
function fakeClock(step = 0): () => number {
  let t = 0;
  return () => {
    const now = t;
    t += step;
    return now;
  };
}

interface Harness {
  session: FlameWorkerSession;
  events: FlameWorkerEvent[];
  scheduler: ReturnType<typeof stepScheduler>;
}

function harness(
  overrides: Partial<
    Omit<FlameWorkerDeps, "emit" | "schedule"> & { now: () => number }
  > = {},
): Harness {
  const events: FlameWorkerEvent[] = [];
  const scheduler = stepScheduler();
  const session = new FlameWorkerSession({
    now: overrides.now ?? fakeClock(0),
    schedule: scheduler.schedule,
    emit: (event) => events.push(event),
    accumulate: overrides.accumulate,
    maxAccumBuckets: overrides.maxAccumBuckets,
    initialChunkSize: overrides.initialChunkSize,
    createGpuBackend: overrides.createGpuBackend,
    createGpuBackend4: overrides.createGpuBackend4,
    log: overrides.log,
  });
  return { session, events, scheduler };
}

function progressEvents(
  events: FlameWorkerEvent[],
): Extract<FlameWorkerEvent, { type: "progress" }>[] {
  return events.filter((e) => e.type === "progress");
}

function sharedFrameEvents(
  events: FlameWorkerEvent[],
): Extract<FlameWorkerEvent, { type: "sharedFrame" }>[] {
  return events.filter((e) => e.type === "sharedFrame");
}

/** Two real SAB-backed frame slots, exactly as main.ts allocates them (Node
 * exposes SharedArrayBuffer unconditionally — no isolation needed here). */
function makeSharedFrames(
  width: number,
  height: number,
): [SharedFrameBuffers, SharedFrameBuffers] {
  const bytes = Float64Array.BYTES_PER_ELEMENT;
  const frame = (): SharedFrameBuffers => ({
    hits: new Float64Array(new SharedArrayBuffer(width * height * bytes)),
    sumRGB: new Float64Array(new SharedArrayBuffer(width * height * 3 * bytes)),
  });
  return [frame(), frame()];
}

function noteEvents(
  events: FlameWorkerEvent[],
): Extract<FlameWorkerEvent, { type: "supersampleNote" }>[] {
  return events.filter((e) => e.type === "supersampleNote");
}

function estimatingEvents(
  events: FlameWorkerEvent[],
): Extract<FlameWorkerEvent, { type: "estimating" }>[] {
  return events.filter((e) => e.type === "estimating");
}

function backendEvents(
  events: FlameWorkerEvent[],
): Extract<FlameWorkerEvent, { type: "backend" }>[] {
  return events.filter((e) => e.type === "backend");
}

function gpuUnavailableEvents(
  events: FlameWorkerEvent[],
): Extract<FlameWorkerEvent, { type: "gpuUnavailable" }>[] {
  return events.filter((e) => e.type === "gpuUnavailable");
}

// ---------------------------------------------------------------------------
// Basic session lifecycle
// ---------------------------------------------------------------------------

describe("FlameWorkerSession start", () => {
  it("runs to completion and reports the final progress at the full budget", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 500 }));
    scheduler.drain();

    const progress = progressEvents(events);
    expect(progress.length).toBeGreaterThan(0);
    const last = progress[progress.length - 1];
    expect(last.iterationsDone).toBe(500);
    expect(last.iterationsBudget).toBe(500);
    expect(last.width).toBe(8);
    expect(last.height).toBe(8);
    expect(last.image).toHaveLength(8 * 8 * 4);
  });

  it("emits a supersampleNote with a null effective when no clamp is needed", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ requestedSupersample: 1 }));
    scheduler.drain();

    const notes = noteEvents(events);
    expect(notes[0]).toEqual({
      type: "supersampleNote",
      effective: null,
      requested: 1,
    });
  });

  it("accumulates identically for two sessions given the same seed (determinism)", () => {
    const a = harness();
    a.session.handle(startCommand({ seed: 42, iterationsBudget: 800 }));
    a.scheduler.drain();

    const b = harness();
    b.session.handle(startCommand({ seed: 42, iterationsBudget: 800 }));
    b.scheduler.drain();

    const lastA = progressEvents(a.events).at(-1)!;
    const lastB = progressEvents(b.events).at(-1)!;
    expect(Array.from(lastA.image)).toEqual(Array.from(lastB.image));
  });
});

// ---------------------------------------------------------------------------
// Chunking / multi-chunk progression
// ---------------------------------------------------------------------------

describe("FlameWorkerSession chunking", () => {
  it("spans multiple chunks for a budget larger than the initial chunk size, finishing exactly at the budget", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 10 });
    session.handle(startCommand({ iterationsBudget: 35 }));

    let steps = 0;
    while (scheduler.step()) steps++;
    expect(steps).toBeGreaterThan(1); // genuinely spanned more than one chunk (10+10+10+5).

    const last = progressEvents(events).at(-1)!;
    expect(last.iterationsDone).toBe(35);
  });

  it("throttles redisplay: only the first and last chunks report progress when the clock never crosses the interval", () => {
    // A zero-step clock never crosses FLAME_REDISPLAY_INTERVAL_MS, so only
    // the very first chunk (lastDownsampleAt was undefined) and the final
    // one (finished) are ever "due" for a redisplay.
    const { session, events, scheduler } = harness({ initialChunkSize: 10 });
    session.handle(startCommand({ iterationsBudget: 40 }));
    scheduler.drain();

    expect(progressEvents(events)).toHaveLength(2);
  });

  it("redisplays more than just the first and last chunk when the clock keeps crossing the throttle interval", () => {
    // Note: adaptChunkSize clamps up to FLAME_CHUNK_MIN (100,000) as soon as
    // any nonzero elapsed time is observed, regardless of initialChunkSize —
    // that's real production behavior (a faithful adaptive-chunk-size
    // interaction), not a test artifact, so the budget here is large enough
    // to still need several chunks even after that jump.
    const { session, events, scheduler } = harness({
      initialChunkSize: 10,
      now: fakeClock(200), // > FLAME_REDISPLAY_INTERVAL_MS (150) between every chunk.
    });
    session.handle(startCommand({ iterationsBudget: 250_000 }));
    scheduler.drain();

    // Contrasts with the zero-step-clock test above (exactly 2 — first and
    // last only): a clock that keeps crossing the throttle interval must
    // make more than just the bookend chunks "due".
    expect(progressEvents(events).length).toBeGreaterThan(2);
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(250_000);
  });
});

// ---------------------------------------------------------------------------
// Live tone-map params (exposure/gamma/vibrancy)
// ---------------------------------------------------------------------------

describe("FlameWorkerSession live tone-map params", () => {
  it("does not force an extra redisplay while still accumulating — the next naturally-due one picks it up", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 10 });
    session.handle(startCommand({ iterationsBudget: 40 }));
    scheduler.step(); // first chunk: due (lastDownsampleAt was undefined) -> 1 progress event so far.
    expect(progressEvents(events)).toHaveLength(1);

    session.handle({ type: "setExposure", exposure: 2 });
    // A zero-step clock means no chunk before the last is "due" again, so
    // the live param change alone must not have emitted anything extra.
    expect(progressEvents(events)).toHaveLength(1);

    scheduler.drain();
    // The final chunk is always due (finished) — that's the next progress.
    expect(progressEvents(events)).toHaveLength(2);
    const last = progressEvents(events).at(-1)!;
    expect(last.iterationsDone).toBe(40);
  });

  it("re-tone-maps and sends immediately when the param changes after accumulation is done", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 50, exposure: 1 }));
    scheduler.drain();
    const doneCount = progressEvents(events).length;
    expect(doneCount).toBeGreaterThan(0); // budget (50) < initial chunk size -> finished already.

    session.handle({ type: "setExposure", exposure: 3 });
    expect(progressEvents(events)).toHaveLength(doneCount + 1);

    session.handle({ type: "setGamma", gamma: 2 });
    session.handle({ type: "setVibrancy", vibrancy: 0.5 });
    expect(progressEvents(events)).toHaveLength(doneCount + 3);
  });

  it("does not re-accumulate for a live param change once done", () => {
    const calls: number[] = [];
    const countingAccumulate: typeof accumulateFlame = (...args) => {
      calls.push(args[4]); // iterations argument.
      return accumulateFlame(...args);
    };
    const { session } = harness({ accumulate: countingAccumulate });
    session.handle(startCommand({ iterationsBudget: 50 }));
    const callsAfterDone = calls.length;

    session.handle({ type: "setExposure", exposure: 2 });
    expect(calls).toHaveLength(callsAfterDone); // no new accumulate call.
  });
});

// ---------------------------------------------------------------------------
// Iteration budget
// ---------------------------------------------------------------------------

describe("FlameWorkerSession setIterationsBudget", () => {
  it("resumes accumulation when the budget is raised past what had already finished", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 50 }));
    scheduler.drain();
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(50);

    session.handle({ type: "setIterationsBudget", iterations: 120 });
    scheduler.drain();
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(120);
  });

  it("stops cleanly, without an extra accumulate call, when the budget is lowered below what is already scheduled to run", () => {
    // Regression: a chunk already scheduled (via ensureRunning) still fires
    // even after a setIterationsBudget command handled in between — runChunk
    // must re-check done-vs-budget itself, not just trust that
    // iterationsBudget - iterationsDone is still positive (which would go
    // negative here and silently corrupt the progress count instead of just
    // stopping).
    const calls: number[] = [];
    const countingAccumulate: typeof accumulateFlame = (...args) => {
      calls.push(args[4]); // iterations argument.
      return accumulateFlame(...args);
    };
    const { session, events, scheduler } = harness({
      initialChunkSize: 10,
      accumulate: countingAccumulate,
    });
    session.handle(startCommand({ iterationsBudget: 40 }));
    scheduler.step(); // one chunk in (10 done), next chunk already scheduled.
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(10);
    expect(calls).toHaveLength(1);

    session.handle({ type: "setIterationsBudget", iterations: 5 }); // below iterationsDone.
    scheduler.drain(); // the already-scheduled chunk fires, but must no-op.

    expect(calls).toHaveLength(1); // no further (and certainly no negative-count) accumulate call.
  });

  it("reports the finish immediately when the budget is lowered below what has already accumulated (fr-15z)", () => {
    // Lowering the budget below iterationsDone finishes the render on the
    // spot, but no chunk runs to say so — the session must emit the final
    // progress itself, or the label freezes at its pre-change value.
    const { session, events, scheduler } = harness({ initialChunkSize: 10 });
    session.handle(startCommand({ iterationsBudget: 40 }));
    scheduler.step(); // one chunk in (10 done).
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(10);

    session.handle({ type: "setIterationsBudget", iterations: 5 });

    const last = progressEvents(events).at(-1)!;
    expect(last.iterationsDone).toBe(10); // what actually accumulated, unchanged.
    expect(last.iterationsBudget).toBe(5); // the new (already-met) target.
  });

  it("emits an estimating event before the resulting frame when a lowered budget ends the render early (fr-99z)", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 10 });
    session.handle(startCommand({ iterationsBudget: 40 }));
    scheduler.step(); // one chunk in (10 done).

    session.handle({ type: "setIterationsBudget", iterations: 5 });

    const last = events.slice(-2);
    expect(last[0]).toEqual({ type: "estimating" });
    expect(last[1].type).toBe("progress");
  });

  it("applies the finished-frame adaptive estimate when a lowered budget ends the render early", () => {
    // Two sessions identical except for wildly different estimator params,
    // each ended early by lowering the budget below what accumulated: since
    // progressive previews ignore estimator params entirely (pinned by the
    // adaptive-blur suite), differing final images prove the early finish
    // ran the finished-frame adaptive pass, not another cheap preview.
    function earlyFinishImage(estimatorRadius: number): Uint8ClampedArray {
      const { session, events, scheduler } = harness({ initialChunkSize: 10 });
      session.handle(
        startCommand({
          seed: 7,
          iterationsBudget: 40,
          estimatorRadius,
          estimatorMinimumRadius: estimatorRadius,
          estimatorCurve: 1,
        }),
      );
      scheduler.step(); // one chunk in (10 done).
      session.handle({ type: "setIterationsBudget", iterations: 5 });
      return progressEvents(events).at(-1)!.image;
    }
    expect(Array.from(earlyFinishImage(15))).not.toEqual(
      Array.from(earlyFinishImage(1)),
    );
  });

  it("refreshes the label's target when an already-finished render's budget is lowered further", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 50 }));
    scheduler.drain();
    expect(progressEvents(events).at(-1)!.iterationsBudget).toBe(50);

    session.handle({ type: "setIterationsBudget", iterations: 20 });

    const last = progressEvents(events).at(-1)!;
    expect(last.iterationsDone).toBe(50);
    expect(last.iterationsBudget).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Device-aware accumulation budget policy (fr-7c8)
// ---------------------------------------------------------------------------

describe("flameAccumBudgetBuckets", () => {
  /** MiB → buckets, restating the contract: one bucket = 32 bytes (one
   * Float64 hit + three Float64 color channels). */
  const buckets = (mib: number) => Math.floor((mib * 1024 * 1024) / 32);

  it("keeps the flat 300 MiB phone floor on coarse-pointer devices, ignoring reported memory", () => {
    // Flagship phones report the capped deviceMemory maximum of 8 — exactly
    // the devices the conservative floor exists for, so the report is ignored.
    expect(flameAccumBudgetBuckets(8, true)).toBe(buckets(300));
  });

  it("scales the desktop budget with reported device memory", () => {
    expect(flameAccumBudgetBuckets(4, false)).toBe(buckets(1280));
  });

  it("assumes a desktop-class budget when deviceMemory is unavailable (Firefox/Safari)", () => {
    expect(flameAccumBudgetBuckets(undefined, false)).toBe(buckets(2560));
  });

  it("never drops below the phone-safe floor on tiny-memory desktops", () => {
    expect(flameAccumBudgetBuckets(0.25, false)).toBe(buckets(300));
  });

  it("caps the budget even if a future UA reports more than 8 GiB", () => {
    expect(flameAccumBudgetBuckets(64, false)).toBe(buckets(2560));
  });

  it("lets a desktop run 3x supersample on a full 4K drawing buffer", () => {
    // The original complaint (fr-7c8): under the old flat 300 MiB budget a
    // 64 GB desktop with a big monitor couldn't even get 2x.
    const budget = flameAccumBudgetBuckets(8, false);
    expect(clampSupersampleToBudget(3840, 2160, 3, budget)).toBe(3);
  });

  it("still pins a hi-DPI phone to 1x, unchanged from the flat-budget behavior", () => {
    const budget = flameAccumBudgetBuckets(8, true);
    expect(clampSupersampleToBudget(1080, 2340, 3, budget)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Supersample: proactive budget clamp
// ---------------------------------------------------------------------------

describe("FlameWorkerSession proactive supersample budget", () => {
  it("clamps against the start command's own budget when it carries one", () => {
    // Same 10x10 @ 3x geometry as the deps-budget test below, but the budget
    // rides in the start command — the path main.ts actually uses (fr-7c8).
    // Without it, the built-in floor (millions of buckets) would clamp nothing.
    const { session, events, scheduler } = harness();
    session.handle(
      startCommand({
        width: 10,
        height: 10,
        requestedSupersample: 3,
        maxAccumBuckets: 450,
      }),
    );
    scheduler.drain();

    expect(noteEvents(events)[0]).toEqual({
      type: "supersampleNote",
      effective: 2,
      requested: 3,
    });
  });

  it("clamps to the largest supersample that fits a small injected budget", () => {
    // width * height = 100; requested 3x = 900 buckets (too big for a 450
    // budget); 2x = 400 buckets (fits) -> effective 2.
    const { session, events, scheduler } = harness({ maxAccumBuckets: 450 });
    session.handle(
      startCommand({ width: 10, height: 10, requestedSupersample: 3 }),
    );
    scheduler.drain();

    expect(noteEvents(events)[0]).toEqual({
      type: "supersampleNote",
      effective: 2,
      requested: 3,
    });
  });

  it("never clamps below 1x even when the budget is tiny", () => {
    const { session, events, scheduler } = harness({ maxAccumBuckets: 1 });
    session.handle(
      startCommand({ width: 10, height: 10, requestedSupersample: 3 }),
    );
    scheduler.drain();

    expect(noteEvents(events)[0]).toEqual({
      type: "supersampleNote",
      effective: 1,
      requested: 3,
    });
    const last = progressEvents(events).at(-1)!;
    expect(last.width).toBe(10); // display size unaffected by the accumulator clamp.
  });
});

// ---------------------------------------------------------------------------
// Supersample: live setSupersample command
// ---------------------------------------------------------------------------

describe("FlameWorkerSession setSupersample", () => {
  it("restarts accumulation from zero when the effective size actually changes", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 10 });
    session.handle(
      startCommand({ requestedSupersample: 1, iterationsBudget: 40 }),
    );
    scheduler.step();
    scheduler.step(); // partway through, iterationsDone > 0.
    const progressedSoFar = progressEvents(events).at(-1)!.iterationsDone;
    expect(progressedSoFar).toBeGreaterThan(0);
    expect(progressedSoFar).toBeLessThan(40);

    session.handle({ type: "setSupersample", supersample: 2 });
    // A fresh supersampleNote for the restart, and iterationsDone back at 0
    // (visible once the restarted render's first chunk reports progress).
    expect(noteEvents(events)).toHaveLength(2);

    scheduler.drain();
    const last = progressEvents(events).at(-1)!;
    expect(last.iterationsDone).toBe(40); // still reaches the same budget after restarting.
  });

  it("also restarts correctly when the render had already finished (not mid-flight)", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 10 });
    session.handle(
      startCommand({ requestedSupersample: 1, iterationsBudget: 20 }),
    );
    scheduler.drain();
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(20);

    session.handle({ type: "setSupersample", supersample: 2 });
    scheduler.drain();

    const last = progressEvents(events).at(-1)!;
    expect(last.iterationsDone).toBe(20); // reached the same budget again after restarting.
    expect(noteEvents(events)).toHaveLength(2); // start's note, then the restart's.
  });

  it("does not restart when the effective size is unchanged, but still refreshes the note", () => {
    // requested 2x and 3x both clamp to the same 1x under a tiny budget, so
    // switching between them shouldn't restart accumulation.
    const calls: number[] = [];
    const countingAccumulate: typeof accumulateFlame = (...args) => {
      calls.push(args[4]);
      return accumulateFlame(...args);
    };
    const { session, events, scheduler } = harness({
      maxAccumBuckets: 50,
      accumulate: countingAccumulate,
    });
    session.handle(
      startCommand({ width: 10, height: 10, requestedSupersample: 2 }),
    );
    scheduler.drain();
    const callsBefore = calls.length;

    session.handle({ type: "setSupersample", supersample: 3 });
    expect(calls).toHaveLength(callsBefore); // no restart -> no new accumulate call.

    const notes = noteEvents(events);
    expect(notes.at(-1)).toEqual({
      type: "supersampleNote",
      effective: 1,
      requested: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// Palette: live setPalette command (fr-6us)
// ---------------------------------------------------------------------------

describe("FlameWorkerSession setPalette", () => {
  it("restarts a finished render so it re-accumulates in the new palette", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 10 });
    session.handle(startCommand({ iterationsBudget: 20, paletteId: "legacy" }));
    scheduler.drain();
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(20);
    const framesBefore = progressEvents(events).length;

    session.handle({ type: "setPalette", paletteId: "spectrum" });
    scheduler.drain();

    // A finished render produces no more frames on its own; that it climbs back
    // to the budget AND emits new frames proves it reset to zero and re-ran.
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(20);
    expect(progressEvents(events).length).toBeGreaterThan(framesBefore);
  });

  it("colors differently under a gradient palette than legacy for the same seed", () => {
    function finalImage(paletteId: "legacy" | "spectrum"): Uint8ClampedArray {
      const { session, events, scheduler } = harness();
      session.handle(
        startCommand({ seed: 7, iterationsBudget: 500, paletteId }),
      );
      scheduler.drain();
      return progressEvents(events).at(-1)!.image;
    }
    // Same seed → identical orbit and hits; only the baked-in colors differ, so
    // the tone-mapped image must differ once a gradient palette is in play.
    expect(Array.from(finalImage("spectrum"))).not.toEqual(
      Array.from(finalImage("legacy")),
    );
  });
});

// ---------------------------------------------------------------------------
// Symmetry: live setSymmetry command (fr-6im)
// ---------------------------------------------------------------------------

describe("FlameWorkerSession setSymmetry", () => {
  it("runs to completion and reports the final progress when order > 1", () => {
    const { session, events, scheduler } = harness();
    session.handle(
      startCommand({ order: 3, axis: "y", iterationsBudget: 500 }),
    );
    scheduler.drain();

    const progress = progressEvents(events);
    expect(progress.length).toBeGreaterThan(0);
    const last = progress[progress.length - 1];
    expect(last.iterationsDone).toBe(500);
    expect(last.iterationsBudget).toBe(500);
    expect(last.width).toBe(8);
    expect(last.height).toBe(8);
    expect(last.image).toHaveLength(8 * 8 * 4);
  });

  it("restarts accumulation from zero when the order actually changes", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 10 });
    session.handle(startCommand({ order: 1, axis: "y", iterationsBudget: 40 }));
    scheduler.step();
    scheduler.step(); // partway through; the second chunk isn't "due" (clock is frozen), so only one progress event exists so far.
    const framesBeforeRestart = progressEvents(events).length;
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(10);

    session.handle({ type: "setSymmetry", order: 3, axis: "y" });
    scheduler.step(); // the restarted render's first chunk — always "due" (lastDownsampleAt was reset to undefined).
    const afterOneStep = progressEvents(events);
    expect(afterOneStep.length).toBe(framesBeforeRestart + 1); // a genuinely NEW event landed, not just a re-send.
    expect(afterOneStep.at(-1)!.iterationsDone).toBe(10); // exactly one chunk's worth, not 20 -> iterationsDone was reset to 0.

    scheduler.drain();
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(40); // still reaches the same budget after restarting.
  });

  it("restarts accumulation when only the axis changes (order held constant)", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 10 });
    session.handle(startCommand({ order: 3, axis: "y", iterationsBudget: 40 }));
    scheduler.step();
    scheduler.step(); // partway through; only the first chunk's event is visible (see the order-change test above).
    const framesBeforeRestart = progressEvents(events).length;
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(10);

    session.handle({ type: "setSymmetry", order: 3, axis: "z" });
    scheduler.step();
    const afterOneStep = progressEvents(events);
    expect(afterOneStep.length).toBe(framesBeforeRestart + 1);
    expect(afterOneStep.at(-1)!.iterationsDone).toBe(10); // reset to 0, one chunk back in.
  });

  it("does not restart when order and axis are unchanged (no-op guard)", () => {
    const calls: number[] = [];
    const countingAccumulate: typeof accumulateFlame = (...args) => {
      calls.push(args[4]); // iterations argument.
      return accumulateFlame(...args);
    };
    const { session, scheduler } = harness({ accumulate: countingAccumulate });
    session.handle(startCommand({ order: 3, axis: "y", iterationsBudget: 20 }));
    scheduler.drain();
    const callsBefore = calls.length;

    session.handle({ type: "setSymmetry", order: 3, axis: "y" });
    expect(calls).toHaveLength(callsBefore); // no restart -> no new accumulate call.
  });

  it("is a no-op and does not throw when sent before any start", () => {
    const { session, events } = harness();
    expect(() =>
      session.handle({ type: "setSymmetry", order: 3, axis: "y" }),
    ).not.toThrow();
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// OOM guard: reactive ratchet-and-retry
// ---------------------------------------------------------------------------

describe("FlameWorkerSession reactive OOM guard", () => {
  function throwOnceThenRealAccumulate(): {
    accumulate: typeof accumulateFlame;
    calls: { width: number; height: number }[];
  } {
    const calls: { width: number; height: number }[] = [];
    let thrown = false;
    const accumulate: typeof accumulateFlame = (...args) => {
      const [, , width, height] = args;
      calls.push({ width, height });
      if (!thrown) {
        thrown = true;
        throw new Error("simulated allocation failure");
      }
      return accumulateFlame(...args);
    };
    return { accumulate, calls };
  }

  it("ratchets the supersample down by one and retries at the smaller size", () => {
    const { accumulate, calls } = throwOnceThenRealAccumulate();
    const { session, events, scheduler } = harness({ accumulate });
    session.handle(
      startCommand({ width: 10, height: 10, requestedSupersample: 2 }),
    );
    scheduler.drain();

    expect(calls).toEqual([
      { width: 20, height: 20 }, // the failed 2x attempt.
      { width: 10, height: 10 }, // retried at 1x.
    ]);

    const notes = noteEvents(events);
    expect(notes[0]).toEqual({
      type: "supersampleNote",
      effective: null,
      requested: 2,
    }); // first attempt: 2x fit the (default, huge) budget, no clamp noted yet.
    expect(notes[1]).toEqual({
      type: "supersampleNote",
      effective: 1,
      requested: 2,
    }); // learned-from-failure ratchet down to 1x.

    // The retry succeeded and ran to completion.
    const last = progressEvents(events).at(-1)!;
    expect(last.iterationsDone).toBe(500);
  });

  it("gives up and emits an error when even 1x fails", () => {
    const alwaysThrows: typeof accumulateFlame = () => {
      throw new Error("simulated unrecoverable allocation failure");
    };
    const { session, events, scheduler } = harness({
      accumulate: alwaysThrows,
    });
    session.handle(startCommand({ requestedSupersample: 1 }));
    scheduler.drain();

    expect(progressEvents(events)).toHaveLength(0);
    const errors = events.filter((e) => e.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: "error",
      message: "simulated unrecoverable allocation failure",
    });
  });

  it("does not retry a failure once already accumulating (not a fresh start)", () => {
    let calls = 0;
    const failAfterFirstChunk: typeof accumulateFlame = (...args) => {
      calls++;
      if (calls === 1) return accumulateFlame(...args); // first chunk succeeds normally.
      throw new Error("simulated failure resuming an existing histogram");
    };
    const { session, events, scheduler } = harness({
      initialChunkSize: 10,
      accumulate: failAfterFirstChunk,
    });
    session.handle(
      startCommand({ requestedSupersample: 1, iterationsBudget: 40 }),
    );
    scheduler.drain();

    // Not a fresh-start failure (histogram already existed), so this must
    // surface as an error rather than silently retrying forever.
    const errors = events.filter((e) => e.type === "error");
    expect(errors).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Adaptive density-estimation blur (fr-17t): fixed-radius previews, adaptive
// only on the finished frame.
// ---------------------------------------------------------------------------

describe("FlameWorkerSession adaptive density-estimation blur", () => {
  it("ignores estimator params for a progressive (not-yet-finished) preview", () => {
    // Two sessions, identical in every way except wildly different estimator
    // params, each stepped through only its FIRST (not final) chunk: since
    // the progressive-preview path never reads estimatorParams at all (see
    // runChunk's `due` branch), the two images must be byte-identical.
    const a = harness({ initialChunkSize: 10 });
    a.session.handle(
      startCommand({
        seed: 7,
        iterationsBudget: 40,
        estimatorRadius: 1,
        estimatorMinimumRadius: 0,
        estimatorCurve: 1,
      }),
    );
    a.scheduler.step();

    const b = harness({ initialChunkSize: 10 });
    b.session.handle(
      startCommand({
        seed: 7,
        iterationsBudget: 40,
        estimatorRadius: 15,
        estimatorMinimumRadius: 15,
        estimatorCurve: 3,
      }),
    );
    b.scheduler.step();

    const imgA = progressEvents(a.events)[0].image;
    const imgB = progressEvents(b.events)[0].image;
    expect(imgA).toHaveLength(imgB.length);
    expect(Array.from(imgA)).toEqual(Array.from(imgB));
  });

  it("applies estimator params to the finished frame", () => {
    // Same seed and budget, run to completion, differing only in estimator
    // params — a narrow-everywhere run (radius pinned to 1 throughout) must
    // render differently from a wide-and-curved one once the adaptive pass
    // has actually run.
    const a = harness();
    a.session.handle(
      startCommand({
        seed: 7,
        iterationsBudget: 500,
        estimatorRadius: 1,
        estimatorMinimumRadius: 1,
        estimatorCurve: 1,
      }),
    );
    a.scheduler.drain();

    const b = harness();
    b.session.handle(
      startCommand({
        seed: 7,
        iterationsBudget: 500,
        estimatorRadius: 8,
        estimatorMinimumRadius: 0,
        estimatorCurve: 0.3,
      }),
    );
    b.scheduler.drain();

    const imgA = progressEvents(a.events).at(-1)!.image;
    const imgB = progressEvents(b.events).at(-1)!.image;
    expect(Array.from(imgA)).not.toEqual(Array.from(imgB));
  });
});

// ---------------------------------------------------------------------------
// Busy indicator for the adaptive pass (fr-99z): an "estimating" event
// queued right before the synchronous adaptive downsample, so the main
// thread can show a busy label while the worker is still crunching it.
// ---------------------------------------------------------------------------

describe("FlameWorkerSession estimating event", () => {
  it("emits an estimating event before the finished frame's progress event", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 500 }));
    scheduler.drain();

    const estimatingIndex = events.findIndex((e) => e.type === "estimating");
    const progressIndex = events.findIndex((e) => e.type === "progress");
    expect(estimatingIndex).toBeGreaterThanOrEqual(0);
    expect(progressIndex).toBeGreaterThan(estimatingIndex);
  });

  it("does not emit an estimating event for a progressive (not-yet-finished) redisplay", () => {
    // Same setup as the chunking suite's "redisplays more than just the
    // first and last chunk" test (clock crosses the throttle interval every
    // chunk, so several progressive redisplays happen before the budget is
    // met) but stopped short of the budget: since the adaptive pass only
    // ever runs on the finished frame, none of these progressive redisplays
    // should have emitted "estimating".
    const { session, events, scheduler } = harness({
      initialChunkSize: 10,
      now: fakeClock(200), // > FLAME_REDISPLAY_INTERVAL_MS (150) between every chunk.
    });
    session.handle(startCommand({ iterationsBudget: 250_000 }));
    scheduler.step();
    scheduler.step();
    scheduler.step(); // several due redisplays, still short of the budget.

    expect(progressEvents(events).length).toBeGreaterThan(1);
    expect(progressEvents(events).at(-1)!.iterationsDone).toBeLessThan(250_000);
    expect(estimatingEvents(events)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Live estimator params (fr-17t): mirrors "live tone-map params" above, but
// a change re-runs the adaptive downsample itself (not just a re-tonemap of
// the existing displayHistogram), since estimatorParams feed that pass, not
// tonemapFlame. A live change defers that re-estimate through the scheduler
// instead of running it inline, so a burst of these commands from a slider
// drag coalesces into a single adaptive pass rather than one per command
// (fr-3fv) — see setEstimatorParam's doc.
// ---------------------------------------------------------------------------

describe("FlameWorkerSession live estimator params", () => {
  it("does not force an extra redisplay while still accumulating — the next naturally-due one picks it up", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 10 });
    session.handle(startCommand({ iterationsBudget: 40 }));
    scheduler.step(); // first chunk: due (lastDownsampleAt was undefined) -> 1 progress event so far.
    expect(progressEvents(events)).toHaveLength(1);

    session.handle({ type: "setEstimatorRadius", estimatorRadius: 10 });
    // A zero-step clock means no chunk before the last is "due" again, so
    // the live param change alone must not have emitted anything extra.
    expect(progressEvents(events)).toHaveLength(1);

    scheduler.drain();
    // The final chunk is always due (finished) — that's the next progress,
    // and it runs the adaptive pass with the just-set radius.
    expect(progressEvents(events)).toHaveLength(2);
    const last = progressEvents(events).at(-1)!;
    expect(last.iterationsDone).toBe(40);
  });

  it("defers the re-estimate to the next scheduler tick when a param changes after accumulation is done (fr-3fv)", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 50 }));
    scheduler.drain();
    const doneCount = progressEvents(events).length;
    expect(doneCount).toBeGreaterThan(0); // budget (50) < initial chunk size -> finished already.

    session.handle({ type: "setEstimatorRadius", estimatorRadius: 10 });
    // Deferred through the scheduler (fr-3fv), not run inline — handle()
    // itself must not have produced anything synchronously.
    expect(progressEvents(events)).toHaveLength(doneCount);

    scheduler.drain();
    expect(progressEvents(events)).toHaveLength(doneCount + 1);
  });

  it("coalesces a burst of estimator commands into a single adaptive pass (fr-3fv)", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 50 }));
    scheduler.drain();
    const doneProgress = progressEvents(events).length;
    const doneEstimating = estimatingEvents(events).length;

    // All three commands fire before anything is drained — exactly what a
    // fast slider drag looks like from the worker's side.
    session.handle({ type: "setEstimatorRadius", estimatorRadius: 8 });
    session.handle({
      type: "setEstimatorMinimumRadius",
      estimatorMinimumRadius: 0,
    });
    session.handle({ type: "setEstimatorCurve", estimatorCurve: 0.3 });
    scheduler.drain();

    // One coalesced pass, not three — a fixed cost regardless of burst size.
    expect(estimatingEvents(events)).toHaveLength(doneEstimating + 1);
    expect(progressEvents(events)).toHaveLength(doneProgress + 1);
  });

  it("the coalesced pass uses the newest value of every param, not just whichever command triggered it (fr-3fv)", () => {
    // Mirrors "applies estimator params to the finished frame" above: same
    // seed and budget, differing only in HOW the final estimator params are
    // reached — a burst of live commands (session A) vs. starting with them
    // already in place (session B). If the coalesced pass reads the newest
    // value of every field (not just the field named by whichever command
    // happened to trigger the deferred pass), the two must render
    // byte-identical.
    const a = harness();
    a.session.handle(
      startCommand({
        seed: 3,
        iterationsBudget: 500,
        estimatorRadius: 1,
        estimatorMinimumRadius: 1,
        estimatorCurve: 1,
      }),
    );
    a.scheduler.drain();
    a.session.handle({ type: "setEstimatorRadius", estimatorRadius: 8 });
    a.session.handle({
      type: "setEstimatorMinimumRadius",
      estimatorMinimumRadius: 0,
    });
    a.session.handle({ type: "setEstimatorCurve", estimatorCurve: 0.3 });
    a.scheduler.drain();
    const imgA = Array.from(progressEvents(a.events).at(-1)!.image);

    const b = harness();
    b.session.handle(
      startCommand({
        seed: 3,
        iterationsBudget: 500,
        estimatorRadius: 8,
        estimatorMinimumRadius: 0,
        estimatorCurve: 0.3,
      }),
    );
    b.scheduler.drain();
    const imgB = Array.from(progressEvents(b.events).at(-1)!.image);

    expect(imgA).toEqual(imgB);
  });

  it("emits an estimating event immediately before the resulting progress event when a param changes after accumulation is done (fr-99z)", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 50 }));
    scheduler.drain();

    session.handle({ type: "setEstimatorRadius", estimatorRadius: 10 });
    scheduler.drain(); // runs the deferred re-estimate (fr-3fv).

    const last = events.slice(-2);
    expect(last[0]).toEqual({ type: "estimating" });
    expect(last[1].type).toBe("progress");
  });

  it("does not re-accumulate for a live estimator param change once done", () => {
    const calls: number[] = [];
    const countingAccumulate: typeof accumulateFlame = (...args) => {
      calls.push(args[4]); // iterations argument.
      return accumulateFlame(...args);
    };
    const { session, scheduler } = harness({ accumulate: countingAccumulate });
    session.handle(startCommand({ iterationsBudget: 50 }));
    scheduler.drain(); // reach "done" for real before the param change.
    const callsAfterDone = calls.length;

    session.handle({ type: "setEstimatorCurve", estimatorCurve: 2 });
    scheduler.drain(); // runs the deferred re-estimate (fr-3fv) — still no accumulate call.
    expect(calls).toHaveLength(callsAfterDone); // no new accumulate call.
  });

  it("actually changes the rendered image, not just re-sends the same one (proving the downsample itself re-ran)", () => {
    const { session, events, scheduler } = harness();
    session.handle(
      startCommand({
        seed: 3,
        iterationsBudget: 500,
        estimatorRadius: 1,
        estimatorMinimumRadius: 1,
        estimatorCurve: 1,
      }),
    );
    scheduler.drain();
    const finishedImage = Array.from(progressEvents(events).at(-1)!.image);

    session.handle({ type: "setEstimatorRadius", estimatorRadius: 8 });
    session.handle({
      type: "setEstimatorMinimumRadius",
      estimatorMinimumRadius: 0,
    });
    session.handle({ type: "setEstimatorCurve", estimatorCurve: 0.3 });
    scheduler.drain(); // runs the deferred (coalesced) re-estimate (fr-3fv).
    const afterChange = Array.from(progressEvents(events).at(-1)!.image);

    expect(afterChange).not.toEqual(finishedImage);
  });

  it("drops a pending re-estimate when a new render supersedes it (fr-3fv)", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 500 }));
    scheduler.drain();
    const doneEstimating = estimatingEvents(events).length;

    session.handle({ type: "setEstimatorRadius", estimatorRadius: 10 }); // defers a re-estimate.
    session.handle(startCommand({ iterationsBudget: 50 })); // a fresh start — bumps generation.
    scheduler.drain();

    // Only the new render's own finished-frame pass ran — the stale
    // deferred task (still carrying the OLD generation) bailed on the
    // `gen !== this.generation` check instead of wastefully re-running.
    expect(estimatingEvents(events)).toHaveLength(doneEstimating + 1);
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(50);
  });

  it("a budget raise racing the deferred re-estimate still yields the resumed render's finished frame (fr-ee9)", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 10 });
    session.handle(startCommand({ iterationsBudget: 40 }));
    scheduler.drain();
    const doneEstimating = estimatingEvents(events).length;

    session.handle({ type: "setEstimatorRadius", estimatorRadius: 10 }); // defers a re-estimate.
    // Resumes accumulation WITHOUT bumping generation (see that command's
    // own case comment) — the deferred task above must not mistake this for
    // "still the same finished render" and fire early.
    session.handle({ type: "setIterationsBudget", iterations: 80 });
    scheduler.drain();

    // The deferred task bailed on `this.running` (true again mid-resume)
    // rather than running early and prematurely latching `finalFrameDisplayed`
    // (fr-ee9) — only the resumed render's OWN finished-frame pass produced a
    // new estimating event, and the render actually reached the raised budget.
    expect(estimatingEvents(events)).toHaveLength(doneEstimating + 1);
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// Shared-frame transport (fr-96i): `start` carrying SAB-backed slots flips
// the session to downsampling into shared memory and emitting scalars-only
// sharedFrame notifications; the main thread tone-maps the named slot itself.
// ---------------------------------------------------------------------------

describe("FlameWorkerSession shared-frame transport", () => {
  it("emits sharedFrame notifications instead of progress transfers, with the frame in the named slot", () => {
    const frames = makeSharedFrames(8, 8);
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ sharedFrames: frames }));
    scheduler.drain();

    expect(progressEvents(events)).toHaveLength(0); // nothing tone-mapped worker-side.
    const shared = sharedFrameEvents(events);
    expect(shared).toHaveLength(1); // budget (500) < one chunk -> a single, finished frame.
    const frame = shared[0];
    expect(frame.iterationsDone).toBe(500);
    expect(frame.iterationsBudget).toBe(500);
    expect(frame.slot).toBe(0); // the double buffer starts at slot 0.

    // The named slot really holds the downsampled frame, and the event's
    // maxHits is that slot's own peak — together the exact inputs the main
    // thread's tone-map needs.
    const slotHits = frames[frame.slot].hits;
    expect(Math.max(...slotHits)).toBeGreaterThan(0);
    expect(frame.maxHits).toBe(Math.max(...slotHits));
  });

  it("produces the byte-identical image the transfer transport would, for the same seed (oracle)", () => {
    const transfer = harness();
    transfer.session.handle(startCommand({ seed: 42 }));
    transfer.scheduler.drain();
    const transferImage = progressEvents(transfer.events).at(-1)!.image;

    const frames = makeSharedFrames(8, 8);
    const shared = harness();
    shared.session.handle(startCommand({ seed: 42, sharedFrames: frames }));
    shared.scheduler.drain();
    const note = sharedFrameEvents(shared.events).at(-1)!;

    // Reconstruct exactly what main.ts's presentSharedFrame does: a view
    // over the shared buckets plus the notified maxHits, tone-mapped with
    // the same (start-command) params the transfer-mode worker used.
    const image = tonemapFlame(
      viewFlameHistogram(
        8,
        8,
        frames[note.slot].hits,
        frames[note.slot].sumRGB,
        note.maxHits,
      ),
      {
        exposure: 1,
        gamma: 1,
        gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
        vibrancy: 1,
      },
    );
    expect(Array.from(image)).toEqual(Array.from(transferImage));
  });

  it("alternates between the two slots across redisplays, never overwriting the slot it just notified", () => {
    // A clock stepping past the redisplay throttle makes every chunk due, so
    // a multi-chunk render produces a run of sharedFrames; consecutive ones
    // must name different slots (the double buffer's whole guarantee: the
    // main thread can still be reading slot N while N+1 is being written).
    const frames = makeSharedFrames(8, 8);
    const { session, events, scheduler } = harness({
      initialChunkSize: 10,
      now: fakeClock(200),
    });
    session.handle(
      startCommand({ iterationsBudget: 250_000, sharedFrames: frames }),
    );
    scheduler.drain();

    const slots = sharedFrameEvents(events).map((e) => e.slot);
    expect(slots.length).toBeGreaterThan(2);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]).toBe(1 - slots[i - 1]);
    }
  });

  it("rebuilds an estimator change into the OTHER slot, leaving the previous frame intact", () => {
    const frames = makeSharedFrames(8, 8);
    const { session, events, scheduler } = harness();
    session.handle(
      startCommand({
        seed: 3,
        sharedFrames: frames,
        estimatorRadius: 1,
        estimatorMinimumRadius: 1,
        estimatorCurve: 1,
      }),
    );
    scheduler.drain();
    const first = sharedFrameEvents(events).at(-1)!;
    expect(first.slot).toBe(0);
    const firstSlotSnapshot = Array.from(frames[0].hits);

    // ONE command -> exactly one adaptive rebuild, which must land in the
    // other slot (each command cycles the buffer, so a second one would wrap
    // back around to slot 0 — deliberately not sent here).
    session.handle({ type: "setEstimatorRadius", estimatorRadius: 8 });
    scheduler.drain(); // runs the deferred re-estimate (fr-3fv).

    const after = sharedFrameEvents(events).at(-1)!;
    expect(after.slot).toBe(1);
    expect(Array.from(frames[0].hits)).not.toEqual(Array.from(frames[1].hits)); // genuinely different estimates.
    expect(Array.from(frames[0].hits)).toEqual(firstSlotSnapshot); // the previously notified slot was never touched.
  });

  it("re-notifies the same already-built slot when a finished render's budget target changes (fr-15z label parity)", () => {
    const frames = makeSharedFrames(8, 8);
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ sharedFrames: frames }));
    scheduler.drain();
    const finished = sharedFrameEvents(events).at(-1)!;
    expect(finished.iterationsBudget).toBe(500);

    session.handle({ type: "setIterationsBudget", iterations: 20 });

    const relabeled = sharedFrameEvents(events).at(-1)!;
    expect(relabeled.slot).toBe(finished.slot); // nothing re-downsampled — same frame, fresh scalars.
    expect(relabeled.maxHits).toBe(finished.maxHits);
    expect(relabeled.iterationsDone).toBe(500);
    expect(relabeled.iterationsBudget).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// GPU accumulation backend (fr-npb): the pluggable FlameAccumBackend seam —
// a `start`/restart opts in via `gpuPreference: "auto"` plus an injected
// `createGpuBackend` factory; every fake backend below returns REAL promises
// (unlike the CPU path, which never actually suspends — see
// flame-worker-core.ts's `isPromiseLike`), so these tests drive the session
// with `drainAsync`/`flushMicrotasks` instead of the synchronous
// `scheduler.drain()` every other test in this file uses.
// ---------------------------------------------------------------------------

describe("FlameWorkerSession GPU accumulation backend", () => {
  it("accumulates through a GPU backend the factory resolves, snapshotting only on due/finished ticks", async () => {
    let snapshotCalls = 0;
    let accumulateCalls = 0;
    const backend: FlameAccumBackend = {
      kind: "gpu",
      adapterLabel: "Fake Adapter",
      accumulate: async (n) => {
        accumulateCalls++;
        return n;
      },
      snapshot: async () => {
        snapshotCalls++;
        return createFlameHistogram(8, 8);
      },
      destroy: () => {},
    };
    let factoryCalls = 0;
    const createGpuBackend = async (): Promise<FlameAccumBackend> => {
      factoryCalls++;
      return backend;
    };
    const { session, events, scheduler } = harness({ createGpuBackend });
    // A budget spanning several of the (real, 8,000,000-iteration) GPU
    // chunks — large so the render stays genuinely multi-chunk despite the
    // GPU chunk-size bump (see flame-worker-core.ts's runChunk) overriding
    // any small initialChunkSize on the very first GPU chunk.
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 20_000_000 }),
    );
    await drainAsync(scheduler);

    expect(factoryCalls).toBe(1); // one backend for the whole accumulation.
    expect(accumulateCalls).toBe(3); // 8,000,000 + 8,000,000 + 4,000,000.
    expect(backendEvents(events)).toEqual([
      { type: "backend", backend: "gpu", adapter: "Fake Adapter" },
    ]);
    const progress = progressEvents(events);
    expect(progress.at(-1)!.iterationsDone).toBe(20_000_000);
    // A zero-step clock never crosses the redisplay throttle, so only the
    // first chunk (lastDownsampleAt was undefined) and the last (finished)
    // are ever "due" — same throttling contract as the CPU path — even
    // though THREE chunks actually accumulated.
    expect(snapshotCalls).toBe(2);
  });

  it("falls back to CPU when the GPU factory rejects, and never retries it again this session", async () => {
    let factoryCalls = 0;
    const createGpuBackend = async (): Promise<FlameAccumBackend> => {
      factoryCalls++;
      throw new Error("no suitable GPU adapter");
    };
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 500 }),
    );
    await drainAsync(scheduler);

    expect(factoryCalls).toBe(1);
    expect(backendEvents(events)).toEqual([
      { type: "backend", backend: "cpu", adapter: undefined },
    ]);
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(500); // the real CPU accumulate ran.

    // gpuFailed ratchets for the rest of the session — a later restart must
    // not retry the factory.
    session.handle({ type: "setSupersample", supersample: 2 });
    await drainAsync(scheduler);

    expect(factoryCalls).toBe(1);
    expect(backendEvents(events)).toEqual([
      { type: "backend", backend: "cpu", adapter: undefined },
      { type: "backend", backend: "cpu", adapter: undefined }, // the restart re-emits, still cpu.
    ]);
  });

  it("emits gpuUnavailable when the 3D GPU factory rejects, before the CPU fallback runs", async () => {
    const createGpuBackend = async (): Promise<FlameAccumBackend> => {
      throw new Error("no suitable GPU adapter");
    };
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 500 }),
    );
    await drainAsync(scheduler);

    expect(gpuUnavailableEvents(events)).toHaveLength(1);
    // The real CPU accumulate still ran, undeterred by the signal.
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(500);
    expect(backendEvents(events)).toEqual([
      { type: "backend", backend: "cpu", adapter: undefined },
    ]);

    // The signal precedes the CPU backend event, so the host has the reason
    // in hand when the backend note arrives (main.ts's CPU-note annotation).
    const firstBackend = events.findIndex((e) => e.type === "backend");
    const firstUnavailable = events.findIndex(
      (e) => e.type === "gpuUnavailable",
    );
    expect(firstUnavailable).toBeGreaterThanOrEqual(0);
    expect(firstUnavailable).toBeLessThan(firstBackend);
  });

  it("emits gpuUnavailable only once even when a later restart re-attempts a session whose GPU already failed", async () => {
    let factoryCalls = 0;
    const createGpuBackend = async (): Promise<FlameAccumBackend> => {
      factoryCalls++;
      throw new Error("no suitable GPU adapter");
    };
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 500 }),
    );
    await drainAsync(scheduler);

    session.handle({ type: "setSupersample", supersample: 2 });
    await drainAsync(scheduler);

    // The gpuFailed ratchet means neither the factory nor the signal repeats
    // on the restart.
    expect(factoryCalls).toBe(1);
    expect(gpuUnavailableEvents(events)).toHaveLength(1);
  });

  it("does not emit gpuUnavailable when the GPU factory resolves a working backend", async () => {
    const backend: FlameAccumBackend = {
      kind: "gpu",
      adapterLabel: "Fake Adapter",
      accumulate: async (n) => n,
      snapshot: async () => createFlameHistogram(8, 8),
      destroy: () => {},
    };
    const createGpuBackend = async (): Promise<FlameAccumBackend> => backend;
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 500 }),
    );
    await drainAsync(scheduler);

    expect(gpuUnavailableEvents(events)).toHaveLength(0);
  });

  it("retries the GPU factory at supersample 1 when creation size-fails at 2, staying on the GPU (fr-2w5 ladder)", async () => {
    const requestedWidths: number[] = [];
    const workingBackend: FlameAccumBackend = {
      kind: "gpu",
      adapterLabel: "Fake Adapter",
      accumulate: async (n) => n,
      snapshot: async () => createFlameHistogram(8, 8),
      destroy: () => {},
    };
    const createGpuBackend = async (
      request: GpuBackendRequest,
    ): Promise<FlameAccumBackend> => {
      requestedWidths.push(request.width);
      if (request.width > 8) {
        // The 16x16 (2x-supersampled) histogram is "too big for this
        // device" — the classified size failure flame-gpu-backend.ts throws
        // for a device-limit guard or a scoped create-time OOM.
        throw new FlameGpuSizeError("histogram exceeds device limits");
      }
      return workingBackend;
    };
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({
        gpuPreference: "auto",
        requestedSupersample: 2,
        iterationsBudget: 500,
      }),
    );
    await drainAsync(scheduler);

    // 2x failed, 1x succeeded — ON the GPU, never touching CPU: the whole
    // point of the ladder (fr-e07's prescribed real fix). No gpuUnavailable:
    // the GPU did not become unavailable, it just needed a smaller size.
    expect(requestedWidths).toEqual([16, 8]);
    expect(backendEvents(events)).toEqual([
      { type: "backend", backend: "gpu", adapter: "Fake Adapter" },
    ]);
    expect(gpuUnavailableEvents(events)).toHaveLength(0);
    // The supersample note tells the user the render runs at 1x of the 2x
    // they asked for — same note the memory-budget clamp uses.
    expect(noteEvents(events).at(-1)).toEqual({
      type: "supersampleNote",
      effective: 1,
      requested: 2,
    });
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(500);
  });

  it("does not ladder a FlameGpuUnavailableError: no retry, immediate CPU, reason 'no-webgpu'", async () => {
    let factoryCalls = 0;
    const createGpuBackend = async (): Promise<FlameAccumBackend> => {
      factoryCalls++;
      throw new FlameGpuUnavailableError("navigator.gpu is undefined");
    };
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({
        gpuPreference: "auto",
        requestedSupersample: 2,
        iterationsBudget: 500,
      }),
    );
    await drainAsync(scheduler);

    // Even at supersample 2 (ladder headroom available), a context with no
    // WebGPU at all gets no size retries — no size would help. The reason
    // lets the main thread's CPU note say "WebGPU unavailable" rather than
    // the misleading "GPU failed".
    expect(factoryCalls).toBe(1);
    expect(gpuUnavailableEvents(events)).toEqual([
      { type: "gpuUnavailable", reason: "no-webgpu" },
    ]);
    expect(backendEvents(events).map((e) => e.backend)).toEqual(["cpu"]);
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(500);
  });

  it("falls back to CPU at the FULL budgeted supersample after the GPU ladder exhausts (the CPU render regains 2x)", async () => {
    const requestedWidths: number[] = [];
    const createGpuBackend = async (
      request: GpuBackendRequest,
    ): Promise<FlameAccumBackend> => {
      requestedWidths.push(request.width);
      throw new FlameGpuSizeError("histogram exceeds device limits");
    };
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({
        gpuPreference: "auto",
        requestedSupersample: 2,
        iterationsBudget: 500,
      }),
    );
    await drainAsync(scheduler);

    // The ladder tried 2x then 1x on the GPU; even 1x failed, so the session
    // ratchets to CPU — and the CPU accumulation runs at the memory budget's
    // own 2x again (the GPU-learned ceiling must not degrade a render the
    // GPU isn't even doing), which the final supersample note reflects by
    // reporting nothing reduced.
    expect(requestedWidths).toEqual([16, 8]);
    expect(gpuUnavailableEvents(events)).toEqual([
      { type: "gpuUnavailable", reason: "error" },
    ]);
    expect(backendEvents(events).map((e) => e.backend)).toEqual(["cpu"]);
    expect(noteEvents(events).at(-1)).toEqual({
      type: "supersampleNote",
      effective: null,
      requested: 2,
    });
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(500);
  });

  it("retries a mid-render GPU failure at the next supersample down, staying on the GPU", async () => {
    const requestedWidths: number[] = [];
    const failingBackend: FlameAccumBackend = {
      kind: "gpu",
      accumulate: async () => {
        throw new Error("Not enough memory left"); // Firefox's mid-render allocator refusal, verbatim.
      },
      snapshot: async () => createFlameHistogram(16, 16),
      destroy: () => {},
    };
    const workingBackend: FlameAccumBackend = {
      kind: "gpu",
      accumulate: async (n) => n,
      snapshot: async () => createFlameHistogram(8, 8),
      destroy: () => {},
    };
    const createGpuBackend = async (
      request: GpuBackendRequest,
    ): Promise<FlameAccumBackend> => {
      requestedWidths.push(request.width);
      return request.width > 8 ? failingBackend : workingBackend;
    };
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({
        gpuPreference: "auto",
        requestedSupersample: 2,
        iterationsBudget: 500,
      }),
    );
    await drainAsync(scheduler);

    // A mid-render failure at 2x is very often a size/pressure signal
    // (fr-2w5's measurements: create-time scopes can't catch everything,
    // e.g. Firefox's mapAsync-time refusals), so the ladder retries smaller
    // ON the GPU rather than writing it off for the session.
    expect(requestedWidths).toEqual([16, 8]);
    expect(backendEvents(events).map((e) => e.backend)).toEqual(["gpu", "gpu"]);
    expect(gpuUnavailableEvents(events)).toHaveLength(0);
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(500);
  });

  it("refuses a software (fallback-adapter) backend on the device-loss retry when the session had real hardware", async () => {
    let softwareDestroyed = 0;
    const hardwareBackend: FlameAccumBackend = {
      kind: "gpu",
      adapterLabel: "real hw",
      accumulate: async () => {
        throw new Error("device lost"); // the hardware dies immediately.
      },
      snapshot: async () => createFlameHistogram(8, 8),
      destroy: () => {},
    };
    const softwareBackend: FlameAccumBackend = {
      kind: "gpu",
      adapterLabel: "google swiftshader (software)",
      software: true,
      accumulate: async (n) => n,
      snapshot: async () => createFlameHistogram(8, 8),
      destroy: () => {
        softwareDestroyed++;
      },
    };
    let factoryCalls = 0;
    const createGpuBackend = async (): Promise<FlameAccumBackend> => {
      factoryCalls++;
      // Exactly Chrome's post-GPU-process-crash shape (fr-2w5's E4b): the
      // first request gets real hardware; after the crash, requestAdapter
      // silently succeeds with SwiftShader.
      return factoryCalls === 1 ? hardwareBackend : softwareBackend;
    };
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 500 }),
    );
    await drainAsync(scheduler);

    // The device-loss retry got SwiftShader where the session had real
    // hardware — refused (destroyed, never installed) rather than silently
    // rendering 10-100x slower; the session ends on CPU.
    expect(factoryCalls).toBe(2);
    expect(softwareDestroyed).toBe(1);
    expect(backendEvents(events).map((e) => e.backend)).toEqual(["gpu", "cpu"]);
    expect(gpuUnavailableEvents(events)).toEqual([
      { type: "gpuUnavailable", reason: "error" },
    ]);
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(500);
  });

  it("accepts a software backend when it is all the context ever offered (SwiftShader-only machines/CI)", async () => {
    const softwareBackend: FlameAccumBackend = {
      kind: "gpu",
      adapterLabel: "google swiftshader (software)",
      software: true,
      accumulate: async (n) => n,
      snapshot: async () => createFlameHistogram(8, 8),
      destroy: () => {},
    };
    const createGpuBackend = async (): Promise<FlameAccumBackend> =>
      softwareBackend;
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 500 }),
    );
    await drainAsync(scheduler);

    expect(backendEvents(events)).toEqual([
      {
        type: "backend",
        backend: "gpu",
        adapter: "google swiftshader (software)",
      },
    ]);
    expect(gpuUnavailableEvents(events)).toHaveLength(0);
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(500);
  });

  it("emits gpuUnavailable with reason 'error' when GPU accumulate keeps failing mid-render, after one fresh-device retry (fr-2w5)", async () => {
    let accumulateCalls = 0;
    const backend: FlameAccumBackend = {
      kind: "gpu",
      accumulate: async () => {
        accumulateCalls++;
        if (accumulateCalls === 1) return 10; // first chunk succeeds.
        throw new Error("device lost");
      },
      snapshot: async () => createFlameHistogram(8, 8),
      destroy: () => {},
    };
    const createGpuBackend = async (): Promise<FlameAccumBackend> => backend;
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 40 }),
    );
    await drainAsync(scheduler);

    // The create succeeded (gpu), a mid-render failure at supersample 1 gets
    // ONE fresh-device retry (a lost device usually comes back — fr-2w5's
    // E4b), the retry's own first chunk fails too, and only then does the
    // session ratchet to cpu — with reason "error", NOT "no-webgpu": this is
    // the Firefox mid-render OOM shape (a hardware/allocator failure, not a
    // missing API).
    expect(backendEvents(events).map((e) => e.backend)).toEqual([
      "gpu",
      "gpu",
      "cpu",
    ]);
    expect(gpuUnavailableEvents(events)).toHaveLength(1); // once, before the CPU restart.
    expect(gpuUnavailableEvents(events)[0].reason).toBe("error");
  });

  it("emits gpuUnavailable when a GPU snapshot keeps failing mid-render (the Firefox worker-OOM shape), still ending on CPU", async () => {
    const backend: FlameAccumBackend = {
      kind: "gpu",
      accumulate: async (n) => n, // accumulate succeeds...
      snapshot: async () => {
        throw new Error("Mapping WebGPU buffer failed: Invalid buffer"); // ...then the readback OOMs, exactly like the report.
      },
      destroy: () => {},
    };
    const createGpuBackend = async (): Promise<FlameAccumBackend> => backend;
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 40 }),
    );
    await drainAsync(scheduler);

    // gpu, the fresh-device retry's gpu, then the permanent cpu fallback.
    expect(backendEvents(events).map((e) => e.backend)).toEqual([
      "gpu",
      "gpu",
      "cpu",
    ]);
    expect(gpuUnavailableEvents(events)).toHaveLength(1);
    expect(gpuUnavailableEvents(events)[0].reason).toBe("error");
  });

  it("restarts on CPU from scratch when the GPU backend's accumulate rejects mid-run", async () => {
    let accumulateCalls = 0;
    const backend: FlameAccumBackend = {
      kind: "gpu",
      accumulate: async () => {
        accumulateCalls++;
        if (accumulateCalls === 1) return 10; // first chunk succeeds.
        throw new Error("device lost");
      },
      snapshot: async () => createFlameHistogram(8, 8),
      destroy: () => {},
    };
    const createGpuBackend = async (): Promise<FlameAccumBackend> => backend;
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 40 }),
    );
    await drainAsync(scheduler);

    expect(backendEvents(events).map((e) => e.backend)).toEqual([
      "gpu",
      "gpu", // the one fresh-device retry (fr-2w5) — its first chunk fails too.
      "cpu",
    ]);
    // 10 (the GPU chunk that succeeded before the failure) then 40 (the
    // CPU restart running from iterationsDone = 0, not 10 + 40 = 50) — the
    // only way to land on exactly this sequence is a genuine from-scratch
    // restart, not the GPU failure just being papered over. The retry
    // attempt contributes no progress event of its own: its very first
    // accumulate throws.
    expect(progressEvents(events).map((p) => p.iterationsDone)).toEqual([
      10, 40,
    ]);
  });

  it("restarts on CPU from scratch when the GPU backend's snapshot rejects (accumulate having succeeded)", async () => {
    // Regression: a GPU readback can fail on its own — e.g. a device lost
    // between a successful accumulate and this snapshot — independently of
    // accumulate ever failing. Unlike the accumulate rejection above, this
    // failure has to be reached via a DUE tick whose accumulate already
    // succeeded, so it exercises a different escape hatch (the due-branch
    // snapshot await used to sit outside runChunk's try/catch entirely).
    let snapshotCalls = 0;
    const backend: FlameAccumBackend = {
      kind: "gpu",
      accumulate: async () => 10, // always retires exactly 10, regardless of what's requested.
      snapshot: async () => {
        snapshotCalls++;
        if (snapshotCalls === 1) return createFlameHistogram(8, 8); // the first due tick succeeds.
        throw new Error("device lost during readback");
      },
      destroy: () => {},
    };
    const createGpuBackend = async (): Promise<FlameAccumBackend> => backend;
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 40 }),
    );
    // If the snapshot rejection escaped runChunk unhandled, this would
    // surface as an unhandled promise rejection — Vitest fails the test run
    // on those by default, so this drain completing at all is itself part
    // of the proof that the rejection was caught, not just the assertions
    // below.
    await drainAsync(scheduler);

    expect(backendEvents(events).map((e) => e.backend)).toEqual([
      "gpu",
      "gpu", // the one fresh-device retry (fr-2w5) — its first due snapshot fails too.
      "cpu",
    ]);
    // 10 (the one GPU due tick whose snapshot succeeded — chunks 2 and 3
    // aren't due under a zero-step clock) then 40 (the CPU restart running
    // from iterationsDone = 0, not 10 + 40 = 50) — same reset-semantics
    // proof as the accumulate-rejection test above, now for a snapshot
    // failure landing on the FINISHING due tick (accumulate having just
    // succeeded). The retry attempt's own first due tick fails before any
    // progress event.
    expect(progressEvents(events).map((p) => p.iterationsDone)).toEqual([
      10, 40,
    ]);
    expect(events.filter((e) => e.type === "error")).toHaveLength(0); // recovered, not surfaced as a fatal error.
  });

  it("accounts for a backend retiring more than it was asked (overshoot), still finishing", async () => {
    const backend: FlameAccumBackend = {
      kind: "gpu",
      // Always retires 37 MORE than requested — e.g. a dispatch that rounds
      // its chain count up to a workgroup-size multiple.
      accumulate: async (n) => n + 37,
      snapshot: async () => createFlameHistogram(8, 8),
      destroy: () => {},
    };
    const createGpuBackend = async (): Promise<FlameAccumBackend> => backend;
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 20_000_000 }),
    );
    await drainAsync(scheduler);

    const progress = progressEvents(events);
    // Requested chunks are 8,000,000 / 8,000,000 / 3,999,926 (the last one
    // sized to exactly close the remaining gap) — retired 37 more each time,
    // so the running totals below are the SUM of actuals, not requests.
    expect(progress.map((p) => p.iterationsDone)).toEqual([
      8_000_037, 20_000_037,
    ]);
    const last = progress.at(-1)!;
    expect(last.iterationsDone).toBeGreaterThanOrEqual(last.iterationsBudget); // finished, above budget.
    expect(last.iterationsDone).not.toBe(last.iterationsBudget); // genuinely overshot, not coincidentally exact.
  });

  it("discards a stale in-flight chunk when a restart supersedes it, without double-scheduling, and the new accumulation completes normally", async () => {
    const events: FlameWorkerEvent[] = [];
    const scheduler = stepScheduler();
    let scheduleCalls = 0;
    let accumulateCalls = 0;
    let resolveFirstAccumulate: ((value: number) => void) | undefined;
    const backend: FlameAccumBackend = {
      kind: "gpu",
      accumulate: (n) => {
        accumulateCalls++;
        if (accumulateCalls === 1) {
          // Held deliberately — resolved only after the restart below, to
          // prove the stale continuation's eventual result is discarded.
          return new Promise<number>((resolve) => {
            resolveFirstAccumulate = resolve;
          });
        }
        return Promise.resolve(n);
      },
      snapshot: async () => createFlameHistogram(8, 8),
      destroy: () => {},
    };
    const session = new FlameWorkerSession({
      now: fakeClock(0),
      schedule: (fn) => {
        scheduleCalls++;
        scheduler.schedule(fn);
      },
      emit: (event) => events.push(event),
      createGpuBackend: async () => backend,
    });

    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 500 }),
    );
    expect(scheduleCalls).toBe(1); // start's ensureRunning scheduled chunk 1.
    scheduler.step(); // runs chunk 1: backend creation, then the held accumulate call.
    await flushMicrotasks();
    expect(accumulateCalls).toBe(1); // confirms we're genuinely stuck mid-accumulate.

    session.handle({ type: "setSupersample", supersample: 2 }); // supersedes it.
    // The restart's OWN ensureRunning() (inside startAccumulation) no-ops —
    // `running` is still true, since the stale runChunk call above hasn't
    // returned yet — so this must not schedule a second chunk on its own.
    expect(scheduleCalls).toBe(1);

    resolveFirstAccumulate!(10); // let the stale chunk's promise settle.
    await flushMicrotasks();
    // The stale continuation noticed it had been superseded and handed the
    // loop off: exactly one NEW chunk scheduled for the new generation —
    // not zero (dropped forever) and not two (double-scheduled).
    expect(scheduleCalls).toBe(2);

    await drainAsync(scheduler);
    // Reaches exactly 500 (not 510): the discarded stale chunk's "10" never
    // got folded into the new generation's own accumulation.
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(500);
  });

  it("never calls the factory when gpuPreference is off or absent, even if one is provided", () => {
    function run(gpuPreference?: "auto" | "off"): {
      factoryCalls: number;
      events: FlameWorkerEvent[];
    } {
      let factoryCalls = 0;
      const createGpuBackend = async (): Promise<FlameAccumBackend> => {
        factoryCalls++;
        throw new Error("must never be called");
      };
      const { session, events, scheduler } = harness({ createGpuBackend });
      session.handle(startCommand({ iterationsBudget: 500, gpuPreference }));
      scheduler.drain(); // fully synchronous — the CPU path never suspends.
      return { factoryCalls, events };
    }

    const absent = run(undefined);
    expect(absent.factoryCalls).toBe(0);
    expect(backendEvents(absent.events)).toEqual([
      { type: "backend", backend: "cpu", adapter: undefined },
    ]);

    const off = run("off");
    expect(off.factoryCalls).toBe(0);
    expect(backendEvents(off.events)).toEqual([
      { type: "backend", backend: "cpu", adapter: undefined },
    ]);
  });

  it("destroys the previous backend exactly once when a restart replaces it", async () => {
    let destroyCalls = 0;
    const backend: FlameAccumBackend = {
      kind: "gpu",
      accumulate: async (n) => n,
      snapshot: async () => createFlameHistogram(8, 8),
      destroy: () => {
        destroyCalls++;
      },
    };
    const createGpuBackend = async (): Promise<FlameAccumBackend> => backend;
    const { session, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 500 }),
    );
    await drainAsync(scheduler);
    expect(destroyCalls).toBe(0); // finished normally; nothing has replaced it yet.

    session.handle({ type: "setSupersample", supersample: 2 });
    expect(destroyCalls).toBe(1); // destroyed synchronously, inside startAccumulation.

    await drainAsync(scheduler); // let the restarted accumulation run to completion too.
    expect(destroyCalls).toBe(1); // still exactly once.
  });
});

// ---------------------------------------------------------------------------
// GPU progressive display downsample (fr-ee9): the optional
// FlameAccumBackend.snapshotDisplay seam — a GPU backend's progressive
// (not-yet-finished) due ticks prefer it over a full snapshot(), and the
// finalFrameDisplayed latch that keeps the finished-frame adaptive display
// correct even though those progressive ticks never refresh this.histogram.
// Every fake backend below returns REAL promises, like the "GPU accumulation
// backend" suite above, so these tests drive the session with
// drainAsync/flushMicrotasks rather than the synchronous scheduler.drain().
// ---------------------------------------------------------------------------

describe("FlameWorkerSession GPU progressive display (fr-ee9)", () => {
  it("takes the snapshotDisplay path (not snapshot) on a not-yet-finished due tick, landing in the expected shared slot; the finished tick still uses the full snapshot + adaptive estimate", async () => {
    const frames = makeSharedFrames(8, 8);
    let snapshotCalls = 0;
    let snapshotDisplayCalls = 0;
    const backend: FlameAccumBackend = {
      kind: "gpu",
      accumulate: async (n) => n,
      snapshot: async () => {
        snapshotCalls++;
        return createFlameHistogram(8, 8);
      },
      snapshotDisplay: async (out) => {
        snapshotDisplayCalls++;
        out.hits.fill(42);
        out.maxHits = 42;
        return out;
      },
      destroy: () => {},
    };
    const createGpuBackend = async (): Promise<FlameAccumBackend> => backend;
    const { session, events, scheduler } = harness({ createGpuBackend });
    // Same 20,000,000-budget/8,000,000-GPU-chunk shape as the "GPU
    // accumulation backend" suite's own equivalent test: three accumulate
    // calls (8M/8M/4M), but only the FIRST (not finished, due — lastDownsampleAt
    // was undefined) and the LAST (finished) chunks are ever "due" under a
    // zero-step clock.
    session.handle(
      startCommand({
        gpuPreference: "auto",
        iterationsBudget: 20_000_000,
        sharedFrames: frames,
      }),
    );
    await drainAsync(scheduler);

    expect(snapshotDisplayCalls).toBe(1); // the one progressive due tick.
    expect(snapshotCalls).toBe(1); // the one finished due tick — never more.

    const shared = sharedFrameEvents(events);
    expect(shared).toHaveLength(2);
    const progressiveEvent = shared[0];
    expect(progressiveEvent.maxHits).toBe(42);
    expect(Array.from(frames[progressiveEvent.slot].hits)).toEqual(
      new Array(64).fill(42),
    ); // the snapshotDisplay mock's own fill really landed in the named slot.

    // The finished frame still runs the (synchronous, unchunked) adaptive
    // density-estimation pass — fr-17t/fr-99z's "estimating" busy event,
    // queued right before it — even though the progressive tick above never
    // touched that codepath at all (it used snapshotDisplay, not
    // rebuildDisplay).
    expect(estimatingEvents(events)).toHaveLength(1);
    const last2 = events.slice(-2);
    expect(last2[0]).toEqual({ type: "estimating" });
    expect(last2[1].type).toBe("sharedFrame");
  });

  it("restarts on CPU from scratch when the GPU backend's snapshotDisplay rejects on a progressive due tick", async () => {
    let snapshotDisplayCalls = 0;
    const backend: FlameAccumBackend = {
      kind: "gpu",
      accumulate: async () => 10, // always retires exactly 10, regardless of what's requested.
      snapshot: async () => createFlameHistogram(8, 8),
      snapshotDisplay: async () => {
        snapshotDisplayCalls++;
        throw new Error("device lost during display downsample");
      },
      destroy: () => {},
    };
    const createGpuBackend = async (): Promise<FlameAccumBackend> => backend;
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 40 }),
    );
    await drainAsync(scheduler);

    expect(snapshotDisplayCalls).toBe(2); // the first attempt's due tick + the fresh-device retry's (fr-2w5).
    expect(backendEvents(events).map((e) => e.backend)).toEqual([
      "gpu",
      "gpu",
      "cpu",
    ]);
    // Neither GPU attempt's due tick ever reported progress (snapshotDisplay
    // rejected both times, unlike the mirrored snapshot-rejection test,
    // whose accumulate succeeds and reports once before its failing due
    // tick) — so the only progress event at all is the CPU restart's own
    // finish, from scratch.
    expect(progressEvents(events).map((p) => p.iterationsDone)).toEqual([40]);
    expect(events.filter((e) => e.type === "error")).toHaveLength(0); // recovered, not surfaced as a fatal error.
  });

  it("produces the finished adaptive frame via the pending chunk when the budget is lowered below done mid-GPU-render, with FRESH (not stale/missing) data", async () => {
    // Regression test for the stale-histogram hole (fr-ee9): a GPU backend's
    // progressive due ticks never refresh this.histogram (they use
    // snapshotDisplay instead), so setIterationsBudget's lowered-mid-render
    // branch must NOT try to redisplay from it itself — it would either
    // no-op (histogram still null) or, worse, silently show a stale frame
    // from a PREVIOUS finish. The pending (already-scheduled) chunk's own
    // budget-met entry bail is what has to fetch a fresh snapshot instead.
    let snapshotCalls = 0;
    let snapshotDisplayCalls = 0;
    const backend: FlameAccumBackend = {
      kind: "gpu",
      accumulate: async () => 10, // always retires exactly 10 -> forces a second (pending) chunk.
      snapshot: async () => {
        snapshotCalls++;
        // Uniform hits alone would tonemap identically regardless of the
        // absolute count (density normalizes by the histogram's own max) —
        // a distinct COLOR (green, via sumRGB) is what actually makes this
        // call's tone-mapped image distinguishable from snapshotDisplay's
        // (red) fill below.
        const hist = createFlameHistogram(8, 8);
        hist.hits.fill(10);
        for (let i = 0; i < hist.sumRGB.length; i += 3) {
          hist.sumRGB[i + 1] = 10; // pure green.
        }
        hist.maxHits = 10;
        return hist;
      },
      snapshotDisplay: async (out) => {
        snapshotDisplayCalls++;
        out.hits.fill(10);
        for (let i = 0; i < out.sumRGB.length; i += 3) {
          out.sumRGB[i] = 10; // pure red — must never leak into the finished frame.
        }
        out.maxHits = 10;
        return out;
      },
      destroy: () => {},
    };
    const createGpuBackend = async (): Promise<FlameAccumBackend> => backend;
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 40 }),
    );
    scheduler.step(); // chunk 1: 10 done, not finished, due (first chunk) -> snapshotDisplay path.
    await flushMicrotasks();

    expect(snapshotDisplayCalls).toBe(1);
    expect(snapshotCalls).toBe(0); // this.histogram is untouched by the progressive tick.
    expect(progressEvents(events)).toHaveLength(1); // the progressive tick's own send.

    session.handle({ type: "setIterationsBudget", iterations: 5 }); // below iterationsDone(10).
    // GPU (not CPU), so the lowered branch does nothing itself — no new
    // event yet; the already-scheduled chunk 2 is what will finish this.
    expect(progressEvents(events)).toHaveLength(1);
    expect(snapshotCalls).toBe(0);

    scheduler.step(); // the already-scheduled chunk 2 -> the new budget-met entry bail.
    await flushMicrotasks();

    expect(snapshotCalls).toBe(1); // backend.snapshot() called exactly once, by the finish bail.
    const last2 = events.slice(-2);
    expect(last2[0]).toEqual({ type: "estimating" });
    expect(last2[1].type).toBe("progress");
    const finalProgress = progressEvents(events).at(-1)!;
    expect(finalProgress.iterationsDone).toBe(10); // what actually accumulated, unchanged.
    expect(finalProgress.iterationsBudget).toBe(5); // the new (already-met) target.

    // Fresh, not stale/missing: the finished image (from backend.snapshot's
    // green fill) must differ from the progressive tick's own image (from
    // snapshotDisplay's red fill) — proving the finish bail genuinely fetched
    // a NEW snapshot rather than reusing/leaking the progressive one.
    const progressiveImage = Array.from(progressEvents(events)[0].image);
    expect(Array.from(finalProgress.image)).not.toEqual(progressiveImage);
  });

  it("discards a stale in-flight snapshotDisplay when a restart supersedes it, without double-scheduling, and the new accumulation completes normally", async () => {
    const events: FlameWorkerEvent[] = [];
    const scheduler = stepScheduler();
    let scheduleCalls = 0;
    let snapshotDisplayCalls = 0;
    let resolveFirstSnapshotDisplay:
      ((value: FlameHistogram) => void) | undefined;
    const backend: FlameAccumBackend = {
      kind: "gpu",
      accumulate: async (n) => n,
      snapshot: async () => createFlameHistogram(8, 8),
      snapshotDisplay: (out) => {
        snapshotDisplayCalls++;
        if (snapshotDisplayCalls === 1) {
          // Held deliberately — resolved only after the restart below, to
          // prove the stale continuation's eventual result is discarded.
          return new Promise<FlameHistogram>((resolve) => {
            resolveFirstSnapshotDisplay = resolve;
          });
        }
        return Promise.resolve(out);
      },
      destroy: () => {},
    };
    const session = new FlameWorkerSession({
      now: fakeClock(0),
      schedule: (fn) => {
        scheduleCalls++;
        scheduler.schedule(fn);
      },
      emit: (event) => events.push(event),
      createGpuBackend: async () => backend,
    });

    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 20_000_000 }),
    );
    expect(scheduleCalls).toBe(1); // start's ensureRunning scheduled chunk 1.
    scheduler.step(); // runs chunk 1: backend creation, accumulate (not finished, due) -> the held snapshotDisplay call.
    await flushMicrotasks();
    expect(snapshotDisplayCalls).toBe(1); // confirms we're genuinely stuck mid-snapshotDisplay.

    session.handle({ type: "setSupersample", supersample: 2 }); // supersedes it.
    // The restart's OWN ensureRunning() (inside startAccumulation) no-ops —
    // `running` is still true, since the stale runChunk call above hasn't
    // returned yet — so this must not schedule a second chunk on its own.
    expect(scheduleCalls).toBe(1);

    resolveFirstSnapshotDisplay!(createFlameHistogram(8, 8)); // let the stale chunk's promise settle.
    await flushMicrotasks();
    // The stale continuation noticed it had been superseded and handed the
    // loop off: exactly one NEW chunk scheduled for the new generation.
    expect(scheduleCalls).toBe(2);

    await drainAsync(scheduler);
    // Reaches exactly 20,000,000 via the NEW generation's own accumulation —
    // the discarded stale call never fed anything into it.
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(20_000_000);
  });

  it("produces a fresh finished adaptive frame each time: finish, raise budget, finish again (finalFrameDisplayed resets)", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 50 }));
    scheduler.drain();
    const estimatingAfterFirstFinish = estimatingEvents(events).length;
    expect(estimatingAfterFirstFinish).toBeGreaterThan(0);
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(50);

    session.handle({ type: "setIterationsBudget", iterations: 120 });
    scheduler.drain();

    // A second "estimating" event proves the adaptive pass genuinely re-ran
    // for this second finish too — not just silently reusing whatever
    // finalFrameDisplayed's latch left over from the first finish.
    expect(estimatingEvents(events).length).toBeGreaterThan(
      estimatingAfterFirstFinish,
    );
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// 4D flame render (fr-5b3, fr-e26): the `fourD` start-command block drives a
// 4D session through the SAME unified runChunk/FlameAccumBackend seam as a 3D
// one — there is no separate synchronous runChunk4 loop anymore.
// `gpuPreference: "auto"` tries the `createGpuBackend4` factory
// (`flame-gpu-4d.ts`'s WGSL kernel), falling back to Cpu4DFlameBackend on any
// failure and ratcheting `gpuFailed` exactly like the 3D path's
// `createGpuBackend`/`CpuFlameBackend` does; a 4D session never calls the 3D
// factory, and a 3D session never calls the 4D one (see `createBackend`'s
// dimension-aware dispatch). Every other command handler must still behave
// sanely — setSymmetry becomes a no-op (symmetry is 3D-only), setPalette
// still restarts. A plain 3D start (no fourD) must keep behaving exactly as
// every other describe block in this file already proves.
// ---------------------------------------------------------------------------

describe("FlameWorkerSession 4D flame render", () => {
  it("never calls the 3D GPU factory for a 4D session, and — with no createGpuBackend4 wired — runs CPU synchronously, even with gpuPreference auto", () => {
    let factoryCalls = 0;
    const createGpuBackend = async (): Promise<FlameAccumBackend> => {
      factoryCalls++;
      throw new Error("must never be called");
    };
    const { session, events, scheduler } = harness({ createGpuBackend });
    session.handle(
      startCommand({
        fourD: defaultFourD(),
        gpuPreference: "auto",
        iterationsBudget: 500,
      }),
    );
    // Fully synchronous: with no createGpuBackend4 wired, createBackend()
    // returns a Cpu4DFlameBackend directly (not a Promise), so runChunk's
    // isPromiseLike guard never awaits — same discipline as a CPU-only 3D
    // session.
    scheduler.drain();

    expect(factoryCalls).toBe(0);
    expect(backendEvents(events)).toEqual([
      { type: "backend", backend: "cpu", adapter: undefined },
    ]);
  });

  it("calls the 4D GPU factory for a 4D session with gpuPreference auto and passes the session's own geometry/view/color through the request", async () => {
    const fourD = defaultFourD();
    let factory4Calls = 0;
    let capturedRequest: GpuBackendRequest4 | undefined;
    const createGpuBackend4 = async (
      request: GpuBackendRequest4,
    ): Promise<FlameAccumBackend> => {
      factory4Calls++;
      capturedRequest = request;
      return {
        kind: "gpu",
        adapterLabel: "Fake 4D Adapter",
        accumulate: async (n) => n,
        snapshot: async () =>
          createFlameHistogram(request.width, request.height),
        destroy: () => {},
      };
    };
    let factory3Calls = 0;
    const createGpuBackend = async (): Promise<FlameAccumBackend> => {
      factory3Calls++;
      throw new Error("must never be called for a 4D session");
    };
    const { session, events, scheduler } = harness({
      createGpuBackend,
      createGpuBackend4,
    });
    session.handle(
      startCommand({
        fourD,
        gpuPreference: "auto",
        paletteId: "legacy",
        width: 8,
        height: 8,
        requestedSupersample: 2,
        iterationsBudget: 500,
      }),
    );
    await drainAsync(scheduler);

    expect(factory4Calls).toBe(1);
    expect(factory3Calls).toBe(0);
    const request = capturedRequest!;
    expect(request.transforms4).toBe(fourD.transforms4); // same reference, not a copy.
    expect(request.finalTransform4).toBeNull();
    expect(request.projection).toBeInstanceOf(Float64Array);
    expect(request.projection).toHaveLength(20);
    expect(request.view).toEqual({
      invWAmp: 1,
      sliceOn: false,
      sliceCenter: 0,
      sliceWidth: 1,
      sliceRelativeColor: false,
    });
    expect(request.color.kind).toBe("wRamp");
    if (request.color.kind === "wRamp") {
      expect(request.color.side).toEqual(W_SIDE_PALETTES.wBlueOrange);
    }
    // Accumulation size (display x supersample) vs. the fixed display size.
    expect(request.width).toBe(16);
    expect(request.height).toBe(16);
    expect(request.displayWidth).toBe(8);
    expect(request.displayHeight).toBe(8);
    expect(request.progressiveFilterRadius).toBe(FLAME_FILTER_RADIUS);

    expect(backendEvents(events)).toEqual([
      { type: "backend", backend: "gpu", adapter: "Fake 4D Adapter" },
    ]);
    expect(
      progressEvents(events).at(-1)!.iterationsDone,
    ).toBeGreaterThanOrEqual(500);
  });

  it("falls back to Cpu4DFlameBackend and ratchets gpuFailed when the 4D factory rejects", async () => {
    let factory4Calls = 0;
    const createGpuBackend4 = async (): Promise<FlameAccumBackend> => {
      factory4Calls++;
      throw new Error("no suitable GPU adapter");
    };
    const { session, events, scheduler } = harness({ createGpuBackend4 });
    session.handle(
      startCommand({
        fourD: defaultFourD(),
        gpuPreference: "auto",
        iterationsBudget: 500,
      }),
    );
    await drainAsync(scheduler);

    expect(factory4Calls).toBe(1);
    expect(backendEvents(events)).toEqual([
      { type: "backend", backend: "cpu", adapter: undefined },
    ]);
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(500); // the real CPU accumulate ran.

    // gpuFailed ratchets for the rest of the session — a later restart must
    // not retry the 4D factory either.
    session.handle({ type: "setPalette", paletteId: "spectrum" });
    await drainAsync(scheduler);

    expect(factory4Calls).toBe(1);
    expect(backendEvents(events)).toEqual([
      { type: "backend", backend: "cpu", adapter: undefined },
      { type: "backend", backend: "cpu", adapter: undefined }, // the restart re-emits, still cpu.
    ]);
  });

  it("emits gpuUnavailable when the 4D GPU factory rejects", async () => {
    const createGpuBackend4 = async (): Promise<FlameAccumBackend> => {
      throw new Error("no suitable GPU adapter");
    };
    const { session, events, scheduler } = harness({ createGpuBackend4 });
    session.handle(
      startCommand({
        fourD: defaultFourD(),
        gpuPreference: "auto",
        iterationsBudget: 500,
      }),
    );
    await drainAsync(scheduler);

    expect(gpuUnavailableEvents(events)).toHaveLength(1);
  });

  it("a 3D session never calls the 4D factory", async () => {
    let factory3Calls = 0;
    const createGpuBackend = async (): Promise<FlameAccumBackend> => {
      factory3Calls++;
      return {
        kind: "gpu",
        accumulate: async (n) => n,
        snapshot: async () => createFlameHistogram(8, 8),
        destroy: () => {},
      };
    };
    let factory4Calls = 0;
    const createGpuBackend4 = async (): Promise<FlameAccumBackend> => {
      factory4Calls++;
      throw new Error("must never be called for a 3D session");
    };
    const { session, events, scheduler } = harness({
      createGpuBackend,
      createGpuBackend4,
    });
    session.handle(
      startCommand({ gpuPreference: "auto", iterationsBudget: 500 }),
    );
    await drainAsync(scheduler);

    expect(factory3Calls).toBe(1);
    expect(factory4Calls).toBe(0);
    expect(backendEvents(events)).toEqual([
      { type: "backend", backend: "gpu", adapter: undefined },
    ]);
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(500);
  });

  it("produces progress events with a nonempty image for a simple 4D transform fixture", () => {
    const { session, events, scheduler } = harness();
    session.handle(
      startCommand({
        fourD: defaultFourD(),
        width: 16,
        height: 16,
        iterationsBudget: 2000,
      }),
    );
    scheduler.drain();

    const progress = progressEvents(events);
    expect(progress.length).toBeGreaterThan(0);
    const last = progress.at(-1)!;
    expect(last.iterationsDone).toBe(2000);
    expect(last.width).toBe(16);
    expect(last.height).toBe(16);
    expect(last.image).toHaveLength(16 * 16 * 4);
    expect(Array.from(last.image).some((v) => v !== 0)).toBe(true);
  });

  it("setSymmetry on a 4D session is a no-op: no restart, no new backend, no estimating event", () => {
    const { session, events, scheduler } = harness();
    session.handle(
      startCommand({ fourD: defaultFourD(), iterationsBudget: 20 }),
    );
    scheduler.drain();
    const framesBefore = progressEvents(events).length;
    const backendsBefore = backendEvents(events).length;
    const estimatingBefore = estimatingEvents(events).length;
    expect(backendsBefore).toBeGreaterThan(0);

    session.handle({ type: "setSymmetry", order: 3, axis: "z" });

    expect(progressEvents(events)).toHaveLength(framesBefore); // no new frame.
    expect(backendEvents(events)).toHaveLength(backendsBefore); // no restart -> no new backend.
    expect(estimatingEvents(events)).toHaveLength(estimatingBefore); // never re-ran the adaptive pass.
  });

  it("setPalette on a 4D session restarts accumulation and still produces progress", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 10 });
    session.handle(
      startCommand({
        fourD: defaultFourD(),
        iterationsBudget: 20,
        paletteId: "legacy",
      }),
    );
    scheduler.drain();
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(20);
    const framesBefore = progressEvents(events).length;
    const backendsBefore = backendEvents(events).length;

    session.handle({ type: "setPalette", paletteId: "spectrum" });
    scheduler.drain();

    // A finished render produces no more frames on its own; that it climbs
    // back to the budget AND emits new frames (and a new backend) proves it
    // reset to zero and re-ran, exactly like the 3D setPalette restart.
    expect(progressEvents(events).at(-1)!.iterationsDone).toBe(20);
    expect(progressEvents(events).length).toBeGreaterThan(framesBefore);
    expect(backendEvents(events).length).toBeGreaterThan(backendsBefore);
  });

  it("a 3D start (no fourD) is unaffected: behaves exactly as every other test in this file", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 500 }));
    scheduler.drain();

    const last = progressEvents(events).at(-1)!;
    expect(last.iterationsDone).toBe(500);
    expect(backendEvents(events)).toEqual([
      { type: "backend", backend: "cpu", adapter: undefined },
    ]);
  });
});

// ---------------------------------------------------------------------------
// fr-ul2 throughput instrumentation wiring (the meter's own math is covered by
// flame-perf.test.ts — these pin that the session actually drives it, and only
// when opted in). A large fixed clock step makes a single chunk's summed
// wall+gap cross the meter's window, so one render is enough to emit.
// ---------------------------------------------------------------------------

describe("FlameWorkerSession instrumentation", () => {
  it("logs a throughput summary when the start command opts into instrument", () => {
    const logs: string[] = [];
    const { session, scheduler } = harness({
      now: fakeClock(2000),
      log: (message) => logs.push(message),
    });
    session.handle(startCommand({ instrument: true, iterationsBudget: 500 }));
    scheduler.drain();

    // A CPU render (no GPU factory) still reports its accumulate/readback/gap
    // split — the meter is backend-agnostic.
    expect(logs.some((m) => m.includes("flame perf"))).toBe(true);
    expect(logs.some((m) => m.includes("[cpu]"))).toBe(true);
  });

  it("logs nothing extra when instrument is absent (the production default)", () => {
    const logs: string[] = [];
    const { session, scheduler } = harness({
      now: fakeClock(2000),
      log: (message) => logs.push(message),
    });
    session.handle(startCommand({ iterationsBudget: 500 }));
    scheduler.drain();

    // No instrument flag: the meter is never constructed, so the loop's guarded
    // clock reads and the summary log never happen.
    expect(logs.some((m) => m.includes("flame perf"))).toBe(false);
  });
});
