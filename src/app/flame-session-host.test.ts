import { createFlameHistogram } from "../fractal/flame";
import type { Mat4 } from "../fractal/flame";
import { sierpinskiTetrahedron } from "../fractal/presets";
import { createLocalFlameSessionHost } from "./flame-session-host";
import type {
  FlameAccumBackend,
  FlameWorkerCommand,
  FlameWorkerEvent,
} from "./flame-worker-core";

// ---------------------------------------------------------------------------
// Test harness — deliberately self-contained (not imported from
// flame-worker-core.test.ts, whose helpers are that file's own private
// scope): this module tests the HOST's routing/timing/disposal glue, not
// FlameWorkerSession's accumulation logic, so only a tiny slice of that
// other file's fixture is needed here. `probeWorkerWebGpu` is browser-only
// glue (spawns a real Worker) and is deliberately NOT unit-tested — see its
// own doc comment in flame-session-host.ts.
// ---------------------------------------------------------------------------

/** w = 1 always: no perspective divide — this module isn't re-testing
 * projection math, just needs a valid Mat4. */
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

/** A manually-stepped scheduler — the same shape as flame-worker-core.
 * test.ts's own `stepScheduler`, duplicated rather than imported (see the
 * module doc above) — so a test drives the session deterministically
 * instead of depending on real setTimeout timing. */
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

/** A constant clock (elapsed time always reads as 0) — this file never
 * exercises chunk-size adaptation or redisplay throttling, so there is
 * nothing for a non-zero step to usefully drive here. */
function fakeClock(): () => number {
  return () => 0;
}

/** Real macrotask boundary: by the time this resolves, every microtask
 * queued so far — including the host's own `queueMicrotask`-deferred event
 * deliveries — has fully drained. See flame-worker-core.test.ts's
 * `flushMicrotasks` for the fuller reasoning (identical here). */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function progressEvents(
  events: FlameWorkerEvent[],
): Extract<FlameWorkerEvent, { type: "progress" }>[] {
  return events.filter((e) => e.type === "progress");
}

// ---------------------------------------------------------------------------

describe("createLocalFlameSessionHost", () => {
  it("routes a posted start command to the session and delivers progress events through onEvent", async () => {
    const events: FlameWorkerEvent[] = [];
    const scheduler = stepScheduler();
    const host = createLocalFlameSessionHost((event) => events.push(event), {
      schedule: scheduler.schedule,
      now: fakeClock(),
    });

    host.post(startCommand({ iterationsBudget: 500 }));
    scheduler.drain(); // the CPU-only accumulation never suspends (gpuPreference defaults to "off").
    await flushMicrotasks(); // let every queued onEvent delivery fire.

    const progress = progressEvents(events);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)!.iterationsDone).toBe(500);
  });

  it("never delivers an event synchronously from inside post() (no reentrancy into the caller)", () => {
    const events: FlameWorkerEvent[] = [];
    const scheduler = stepScheduler();
    const host = createLocalFlameSessionHost((event) => events.push(event), {
      schedule: scheduler.schedule,
      now: fakeClock(),
    });

    // `start` emits a "supersampleNote" SYNCHRONOUSLY inside startAccumulation
    // — i.e. during handle() itself, before any chunk is even scheduled. If
    // `emit` delivered directly instead of via queueMicrotask, this array
    // would already be non-empty right here, before the scheduler has run
    // at all.
    host.post(startCommand({ requestedSupersample: 1 }));
    expect(events).toHaveLength(0);
  });

  it("drops every event and no-ops further commands once terminated", async () => {
    const events: FlameWorkerEvent[] = [];
    const scheduler = stepScheduler();
    const host = createLocalFlameSessionHost((event) => events.push(event), {
      schedule: scheduler.schedule,
      now: fakeClock(),
    });

    host.post(startCommand({ iterationsBudget: 500 }));
    scheduler.drain(); // completes the render, queuing its events as pending microtasks.

    host.terminate();
    // The events above were already QUEUED (as pending microtasks) before
    // terminate() ran — proving the `closed` check has to live INSIDE the
    // queueMicrotask callback, not just at the top of post(), since post()
    // was never called again after this point.
    await flushMicrotasks();
    expect(events).toHaveLength(0);

    host.post({ type: "setExposure", exposure: 2 }); // must no-op outright.
    await flushMicrotasks();
    expect(events).toHaveLength(0);
  });

  it("releases the GPU backend when terminated", async () => {
    let destroyCalls = 0;
    const backend: FlameAccumBackend = {
      kind: "gpu",
      accumulate: async (n) => n,
      snapshot: async () => createFlameHistogram(8, 8),
      destroy: () => {
        destroyCalls++;
      },
    };
    const scheduler = stepScheduler();
    const host = createLocalFlameSessionHost(() => {}, {
      schedule: scheduler.schedule,
      now: fakeClock(),
      createGpuBackend: async () => backend,
    });

    host.post(startCommand({ gpuPreference: "auto", iterationsBudget: 500 }));
    scheduler.step(); // kicks off backend creation.
    await flushMicrotasks(); // let it settle so the session actually holds the backend.
    expect(destroyCalls).toBe(0);

    host.terminate();
    expect(destroyCalls).toBe(1); // released synchronously, not deferred like event delivery.
  });
});
