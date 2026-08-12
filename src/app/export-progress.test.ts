import {
  createExportProgress,
  formatExportElapsed,
  formatRenderPercent,
  EXPORT_MODAL_GRACE_MS,
  EXPORT_MODAL_SLOW_PREDICTION_MS,
  EXPORT_MODAL_TICK_MS,
} from "./export-progress";
import type { ExportProgressDeps, ExportProgressView } from "./export-progress";

/**
 * A manual clock plus a fake one-shot timer registry, and a view that
 * records every call it receives — enough to drive `createExportProgress`
 * deterministically with no real `setTimeout` and no DOM. `fireTimer(id)`
 * runs and forgets exactly one armed timer, mirroring a real one-shot
 * firing once; `fireAll()` fires every timer armed AT THE MOMENT it's
 * called — a single generation, not a recursive drain, so a self-re-arming
 * tick advances by exactly one tick per call.
 */
function harness(): {
  deps: ExportProgressDeps;
  shows: { title: string; detail: string; cancellable: boolean }[];
  statuses: { pct: number | null; note: string }[];
  hides: number[];
  advance: (ms: number) => void;
  timers: Map<number, { fn: () => void; ms: number }>;
  fireTimer: (id: number) => void;
  fireAll: () => void;
} {
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  const shows: { title: string; detail: string; cancellable: boolean }[] = [];
  const statuses: { pct: number | null; note: string }[] = [];
  const hides: number[] = [];

  const view: ExportProgressView = {
    showExportProgress: (init) => shows.push(init),
    setExportProgress: (status) => statuses.push(status),
    hideExportProgress: () => hides.push(now),
  };

  function fireTimer(id: number): void {
    const timer = timers.get(id);
    if (!timer) return;
    timers.delete(id);
    timer.fn();
  }

  return {
    deps: {
      now: () => now,
      setTimer: (fn, ms) => {
        const id = nextTimerId++;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimer: (id) => {
        timers.delete(id);
      },
      view,
    },
    shows,
    statuses,
    hides,
    advance: (ms: number) => {
      now += ms;
    },
    timers,
    fireTimer,
    fireAll: () => {
      for (const id of Array.from(timers.keys())) fireTimer(id);
    },
  };
}

describe("formatRenderPercent", () => {
  it("floors zero to zero", () => {
    expect(formatRenderPercent(0)).toBe(0);
  });

  it("keeps one decimal below 10 percent", () => {
    expect(formatRenderPercent(0.004)).toBe(0.4);
  });

  it("floors rather than rounds up at a decimal boundary below 10 percent", () => {
    // 0.499% would round to 0.5 under naive rounding; the fr-99z rule floors it.
    expect(formatRenderPercent(0.00499)).toBe(0.4);
  });

  it("floors rather than rounds up crossing a whole-percent boundary", () => {
    // 4.99% would round to 5 under naive rounding; the fr-99z rule floors it to 4.9.
    expect(formatRenderPercent(0.0499)).toBe(4.9);
  });

  it("switches to a whole-number percent at the 10 percent boundary", () => {
    expect(formatRenderPercent(0.1)).toBe(10);
  });

  it("floors a high fraction to a whole-number percent", () => {
    expect(formatRenderPercent(0.999)).toBe(99);
  });

  it("reaches exactly 100 at fraction 1", () => {
    expect(formatRenderPercent(1)).toBe(100);
  });

  it("clamps a negative fraction to 0", () => {
    expect(formatRenderPercent(-1)).toBe(0);
  });

  it("clamps a fraction above 1 to 100", () => {
    expect(formatRenderPercent(2)).toBe(100);
  });
});

describe("formatExportElapsed", () => {
  it("shows 0s at zero elapsed", () => {
    expect(formatExportElapsed(0)).toBe("0s");
  });

  it("rounds a sub-second duration down to 0s", () => {
    expect(formatExportElapsed(999)).toBe("0s");
  });

  it("shows whole seconds under a minute", () => {
    expect(formatExportElapsed(9400)).toBe("9s");
  });

  it("shows 59s just under the minute boundary", () => {
    expect(formatExportElapsed(59_999)).toBe("59s");
  });

  it("switches to m:ss at exactly one minute", () => {
    expect(formatExportElapsed(60_000)).toBe("1:00");
  });

  it("zero-pads seconds inside m:ss", () => {
    expect(formatExportElapsed(62_000)).toBe("1:02");
  });

  it("formats minutes and seconds past the first minute", () => {
    expect(formatExportElapsed(754_000)).toBe("12:34");
  });

  it("switches to h:mm:ss past one hour, zero-padding minutes and seconds", () => {
    expect(formatExportElapsed(3_723_000)).toBe("1:02:03");
  });

  it("clamps a negative elapsed to 0s, as if a backwards clock never happened", () => {
    expect(formatExportElapsed(-500)).toBe("0s");
  });
});

describe("createExportProgress", () => {
  it("shows nothing synchronously when predictedMs is null", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    driver.begin({
      title: "Saving PNG",
      detail: "Tracing at export resolution…",
      predictedMs: null,
      cancellable: true,
      onCancel: () => {},
    });
    expect(h.shows).toEqual([]);
  });

  it("shows nothing synchronously when predictedMs is below the slow-prediction threshold", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    driver.begin({
      title: "Saving PNG",
      detail: "",
      predictedMs: EXPORT_MODAL_SLOW_PREDICTION_MS - 1,
      cancellable: true,
      onCancel: () => {},
    });
    expect(h.shows).toEqual([]);
  });

  it("does not skip the grace period when predictedMs exactly equals the slow threshold", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    driver.begin({
      title: "Saving PNG",
      detail: "",
      predictedMs: EXPORT_MODAL_SLOW_PREDICTION_MS,
      cancellable: true,
      onCancel: () => {},
    });
    expect(h.shows).toEqual([]);
  });

  it("shows the modal once the grace timer fires", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    driver.begin({
      title: "Saving PNG",
      detail: "Tracing…",
      predictedMs: null,
      cancellable: true,
      onCancel: () => {},
    });

    h.advance(EXPORT_MODAL_GRACE_MS);
    h.fireAll();

    expect(h.shows).toEqual([
      { title: "Saving PNG", detail: "Tracing…", cancellable: true },
    ]);
  });

  it("end() inside the grace period never shows the modal and clears the grace timer", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    const run = driver.begin({
      title: "Saving PNG",
      detail: "",
      predictedMs: null,
      cancellable: false,
      onCancel: () => {},
    });
    expect(h.timers.size).toBe(1);

    run.end();

    expect(h.timers.size).toBe(0); // the grace timer was cleared, not left to fire later
    expect(h.shows).toEqual([]); // never shown — no flash
  });

  it("shows immediately, with no grace timer armed, when predictedMs is past the slow threshold", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    driver.begin({
      title: "Saving PNG",
      detail: "Large timeline export",
      predictedMs: EXPORT_MODAL_SLOW_PREDICTION_MS + 1,
      cancellable: true,
      onCancel: () => {},
    });

    expect(h.shows).toEqual([
      {
        title: "Saving PNG",
        detail: "Large timeline export",
        cancellable: true,
      },
    ]);
    // The only timer armed is the visible modal's tick, not a grace delay.
    expect(Array.from(h.timers.values()).map((t) => t.ms)).toEqual([
      EXPORT_MODAL_TICK_MS,
    ]);
  });

  it("shows with the latest fraction reported while hidden, then keeps ticking without further report()", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    const run = driver.begin({
      title: "Saving PNG",
      detail: "",
      predictedMs: null,
      cancellable: true,
      onCancel: () => {},
    });

    run.report(0.2); // remembered, but hidden — nothing pushed yet
    expect(h.statuses).toEqual([]);

    h.advance(EXPORT_MODAL_GRACE_MS);
    h.fireAll(); // grace timer fires: modal shows with the remembered fraction
    expect(h.statuses).toEqual([
      { pct: 20, note: formatExportElapsed(EXPORT_MODAL_GRACE_MS) },
    ]);

    h.advance(EXPORT_MODAL_TICK_MS);
    h.fireAll(); // the tick alone — no further report()
    expect(h.statuses).toEqual([
      { pct: 20, note: formatExportElapsed(EXPORT_MODAL_GRACE_MS) },
      {
        pct: 20,
        note: formatExportElapsed(EXPORT_MODAL_GRACE_MS + EXPORT_MODAL_TICK_MS),
      },
    ]);
  });

  it("report() while visible pushes the formatted percent and elapsed note", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    const run = driver.begin({
      title: "t",
      detail: "d",
      predictedMs: EXPORT_MODAL_SLOW_PREDICTION_MS + 1,
      cancellable: true,
      onCancel: () => {},
    });

    h.advance(2500);
    run.report(0.5);

    expect(h.statuses[h.statuses.length - 1]).toEqual({
      pct: 50,
      note: formatExportElapsed(2500),
    });
  });

  it("report(null) yields the indeterminate pct with the elapsed note still live", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    const run = driver.begin({
      title: "t",
      detail: "d",
      predictedMs: EXPORT_MODAL_SLOW_PREDICTION_MS + 1,
      cancellable: false,
      onCancel: () => {},
    });

    h.advance(9000);
    run.report(null);

    expect(h.statuses[h.statuses.length - 1]).toEqual({
      pct: null,
      note: "9s",
    });
  });

  it("clamps a negative reported fraction to 0", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    const run = driver.begin({
      title: "t",
      detail: "d",
      predictedMs: EXPORT_MODAL_SLOW_PREDICTION_MS + 1,
      cancellable: true,
      onCancel: () => {},
    });

    run.report(-1);

    expect(h.statuses[h.statuses.length - 1].pct).toBe(0);
  });

  it("clamps a reported fraction above 1 to 100", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    const run = driver.begin({
      title: "t",
      detail: "d",
      predictedMs: EXPORT_MODAL_SLOW_PREDICTION_MS + 1,
      cancellable: true,
      onCancel: () => {},
    });

    run.report(2);

    expect(h.statuses[h.statuses.length - 1].pct).toBe(100);
  });

  it("requestCancel() sets cancelled, fires onCancel exactly once, and pins the note through further reports until end()", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    let cancelCount = 0;
    const run = driver.begin({
      title: "t",
      detail: "d",
      predictedMs: EXPORT_MODAL_SLOW_PREDICTION_MS + 1,
      cancellable: true,
      onCancel: () => {
        cancelCount++;
      },
    });

    driver.requestCancel();
    expect(run.cancelled).toBe(true);
    expect(cancelCount).toBe(1);
    expect(h.statuses[h.statuses.length - 1].note).toBe("Cancelling…");

    driver.requestCancel(); // pressed again
    expect(cancelCount).toBe(1);

    run.report(0.9); // must not overwrite the pinned note
    expect(h.statuses[h.statuses.length - 1].note).toBe("Cancelling…");
    expect(h.hides).toEqual([]); // still up — cancelling is not instant

    run.end();
    expect(h.hides.length).toBe(1);
  });

  it("requestCancel() on a non-cancellable run is a no-op", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    let cancelCount = 0;
    const run = driver.begin({
      title: "t",
      detail: "d",
      predictedMs: null,
      cancellable: false,
      onCancel: () => {
        cancelCount++;
      },
    });

    driver.requestCancel();

    expect(run.cancelled).toBe(false);
    expect(cancelCount).toBe(0);
  });

  it("requestCancel() before the grace timer fires still cancels the run without showing the modal", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    let cancelCount = 0;
    const run = driver.begin({
      title: "t",
      detail: "d",
      predictedMs: null,
      cancellable: true,
      onCancel: () => {
        cancelCount++;
      },
    });

    expect(() => driver.requestCancel()).not.toThrow();

    expect(run.cancelled).toBe(true);
    expect(cancelCount).toBe(1);
    expect(h.shows).toEqual([]);
  });

  it("requestCancel() with no active run is a no-op and does not throw", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);

    expect(() => driver.requestCancel()).not.toThrow();
    expect(driver.active).toBe(false);
  });

  it("end() hides a shown modal, clears the tick timer, and is idempotent", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    const run = driver.begin({
      title: "t",
      detail: "d",
      predictedMs: EXPORT_MODAL_SLOW_PREDICTION_MS + 1,
      cancellable: true,
      onCancel: () => {},
    });
    expect(h.timers.size).toBe(1); // the tick timer

    run.end();
    expect(h.hides).toEqual([0]);
    expect(h.timers.size).toBe(0);
    expect(driver.active).toBe(false);

    run.end(); // second call
    expect(h.hides).toEqual([0]); // unchanged
  });

  it("end() on a never-shown run does not call hideExportProgress", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    const run = driver.begin({
      title: "t",
      detail: "d",
      predictedMs: null,
      cancellable: true,
      onCancel: () => {},
    });

    run.end(); // still inside the grace period — the modal never showed

    expect(h.hides).toEqual([]);
  });

  it("begin() ends a still-active previous run before starting the new one", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);
    driver.begin({
      title: "first",
      detail: "",
      predictedMs: EXPORT_MODAL_SLOW_PREDICTION_MS + 1,
      cancellable: true,
      onCancel: () => {},
    });
    expect(h.shows.length).toBe(1);

    driver.begin({
      title: "second",
      detail: "",
      predictedMs: EXPORT_MODAL_SLOW_PREDICTION_MS + 1,
      cancellable: true,
      onCancel: () => {},
    });

    expect(h.hides).toEqual([0]); // the first run's modal was force-hidden
    expect(h.shows.length).toBe(2); // the second run shown fresh
    expect(driver.active).toBe(true);
    // No leaked tick timer from the first run — only the second run's tick is live.
    expect(h.timers.size).toBe(1);
  });

  it("active is true between begin() and end(), false before and after", () => {
    const h = harness();
    const driver = createExportProgress(h.deps);

    expect(driver.active).toBe(false);

    const run = driver.begin({
      title: "t",
      detail: "d",
      predictedMs: null,
      cancellable: true,
      onCancel: () => {},
    });
    expect(driver.active).toBe(true);

    run.end();
    expect(driver.active).toBe(false);
  });
});
