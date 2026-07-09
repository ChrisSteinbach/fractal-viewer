import { createFrameCoalescer, type FrameCoalescer } from "./regen-scheduler";

/**
 * A fake animation-frame clock: `raf` queues a callback under an incrementing
 * handle instead of waiting for a real frame, `flushFrame` fires whatever is
 * queued (one frame's worth), and `cancelled` records every handle passed to
 * `caf` — so a test can drive the coalescing policy deterministically with no
 * browser. `runs` counts how many times the coalesced work actually executed.
 */
function harness(onRun?: (coalescer: FrameCoalescer) => void): {
  coalescer: FrameCoalescer;
  runs: () => number;
  cancelled: number[];
  pendingCount: () => number;
  flushFrame: () => void;
} {
  let nextHandle = 1;
  let queued: { handle: number; cb: () => void } | null = null;
  const cancelled: number[] = [];
  let runs = 0;
  const coalescer: FrameCoalescer = createFrameCoalescer(
    () => {
      runs++;
      onRun?.(coalescer);
    },
    (cb) => {
      const handle = nextHandle++;
      queued = { handle, cb };
      return handle;
    },
    (handle) => {
      cancelled.push(handle);
      if (queued?.handle === handle) queued = null;
    },
  );
  return {
    coalescer,
    runs: () => runs,
    cancelled,
    pendingCount: () => (queued ? 1 : 0),
    flushFrame: () => {
      const q = queued;
      queued = null;
      q?.cb();
    },
  };
}

describe("createFrameCoalescer", () => {
  it("collapses a burst of schedule() calls in one frame into a single run", () => {
    const h = harness();

    // A drag firing many events before the frame boundary.
    h.coalescer.schedule();
    h.coalescer.schedule();
    h.coalescer.schedule();
    expect(h.runs()).toBe(0); // nothing runs synchronously.

    h.flushFrame();
    expect(h.runs()).toBe(1); // ...and only once for the whole burst.
  });

  it("reschedules after a frame runs, so a later burst runs again", () => {
    const h = harness();

    h.coalescer.schedule();
    h.flushFrame();
    expect(h.runs()).toBe(1);

    h.coalescer.schedule();
    h.flushFrame();
    expect(h.runs()).toBe(2);
  });

  it("cancel() drops a pending run so it never fires", () => {
    const h = harness();

    h.coalescer.schedule();
    h.coalescer.cancel();
    expect(h.cancelled).toHaveLength(1);
    expect(h.pendingCount()).toBe(0);

    h.flushFrame();
    expect(h.runs()).toBe(0);
  });

  it("cancel() with nothing pending is a no-op (never calls caf)", () => {
    const h = harness();

    h.coalescer.cancel();
    expect(h.cancelled).toHaveLength(0);
  });

  it("schedule() after a cancel() arms a fresh frame", () => {
    const h = harness();

    h.coalescer.schedule();
    h.coalescer.cancel();
    h.coalescer.schedule();
    h.flushFrame();

    expect(h.runs()).toBe(1);
  });

  it("a run() that cancels re-entrantly (the regenerate() path) does not double-cancel", () => {
    // Mirrors the app: the coalesced work is regenerate(), which calls
    // cancel() at its top. Since the frame is cleared before run() fires, that
    // re-entrant cancel must see nothing pending and touch caf zero times.
    const h = harness((coalescer) => coalescer.cancel());

    h.coalescer.schedule();
    h.flushFrame();

    expect(h.runs()).toBe(1);
    expect(h.cancelled).toHaveLength(0); // nothing pending when the re-entrant cancel ran.
  });
});
