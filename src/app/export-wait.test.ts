import {
  createExportWait,
  EXPORT_RENDER_STOPPED_NOTE,
  EXPORT_SAVE_EARLY_LABEL,
} from "./export-wait";
import type { ExportWaitDeps, ExportWaitMode } from "./export-wait";
import type { ExportRun, ExportStop } from "./export-progress";
import { RenderSession } from "./render-session";

/**
 * The app's live signals as one mutable `world` plus a manual render-signal
 * park/wake pair — enough to drive `createExportWait` deterministically
 * with no sessions, no workers and no DOM. `signal()` mirrors main.ts's
 * `notifyRenderSignal` exactly (drain the waiter list, single generation),
 * and the SAME function is handed in as the `notifyRenderSignal` dep, the
 * way main.ts wires the early-save press's wake. `parked()` counts waits
 * currently sitting on `nextRenderSignal`.
 */
function harness(): {
  deps: ExportWaitDeps;
  world: {
    flameComplete: boolean;
    flameCoverage: number;
    firstFrame: Record<ExportWaitMode, boolean>;
    mode: string;
  };
  signal: () => void;
  parked: () => number;
} {
  const world = {
    flameComplete: false,
    flameCoverage: 0,
    firstFrame: { flame: false, solid: false, surface: false },
    mode: "flame",
  };
  let waiters: (() => void)[] = [];
  const signal = (): void => {
    const wakes = waiters;
    waiters = [];
    for (const wake of wakes) wake();
  };
  return {
    deps: {
      flameComplete: () => world.flameComplete,
      flameCoverage: () => world.flameCoverage,
      hasFirstFrame: (mode) => world.firstFrame[mode],
      renderMode: () => world.mode,
      nextRenderSignal: () =>
        new Promise<void>((resolve) => {
          waiters.push(resolve);
        }),
      notifyRenderSignal: signal,
    },
    world,
    signal,
    parked: () => waiters.length,
  };
}

/** A minimal {@link ExportRun} whose stop the test presses directly —
 * mirroring the real run's contract (the first stop is terminal here by
 * each test pressing at most once; `cancelled` is exactly
 * `stop === "cancel"`). `reports` records every coverage push the wait
 * makes. */
function stubRun(): {
  run: ExportRun;
  reports: (number | null)[];
  press: (stop: ExportStop) => void;
} {
  const reports: (number | null)[] = [];
  let stop: ExportStop | null = null;
  return {
    run: {
      report: (fraction) => {
        reports.push(fraction);
      },
      end: () => {},
      get cancelled() {
        return stop === "cancel";
      },
      get stop() {
        return stop;
      },
    },
    reports,
    press: (s) => {
      stop = s;
    },
  };
}

/** Flush enough microtasks for the awaitReady loop to run to its next park
 * (or to resolution) — each park cycle costs one promise-resolution hop. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("createExportWait: awaitReady", () => {
  it("resolves immediately, disclosing nothing, when the render is already exportable", async () => {
    const h = harness();
    h.world.mode = "solid";
    h.world.firstFrame.solid = true;
    const { run, reports } = stubRun();
    let outcome: string | null | undefined;

    void createExportWait(h.deps)
      .planRenderWait("solid")
      .awaitReady(run)
      .then((v) => {
        outcome = v;
      });
    await settle();

    expect(outcome).toBeNull();
    expect(reports).toEqual([]);
    expect(h.parked()).toBe(0);
  });

  it("parks on render signals until the solid grid lands, reporting the honest indeterminate percent", async () => {
    const h = harness();
    h.world.mode = "solid";
    const { run, reports } = stubRun();
    let outcome: string | null | undefined;

    void createExportWait(h.deps)
      .planRenderWait("solid")
      .awaitReady(run)
      .then((v) => {
        outcome = v;
      });
    await settle();
    expect(outcome).toBeUndefined();
    // A signal with nothing changed re-parks: the wait re-checks and waits on.
    h.signal();
    await settle();
    expect(outcome).toBeUndefined();
    h.world.firstFrame.solid = true;
    h.signal();
    await settle();

    expect(outcome).toBeNull();
    // A solid grid arrives whole, so every disclosure was the modal's
    // indeterminate state — one per turn the wait sat through.
    expect(reports).toEqual([null, null]);
  });

  it("waits for the replacement Solid grid after a settled generation is invalidated", async () => {
    const h = harness();
    h.world.mode = "solid";
    const session = new RenderSession<never>({
      start: () => ({ post: () => undefined, terminate: () => undefined }),
      clearNotes: () => undefined,
      resetProgress: () => undefined,
      activate: () => undefined,
      deactivate: () => undefined,
    });
    session.enter();
    session.markFirstFrame();
    session.invalidateFirstFrame();
    h.deps.hasFirstFrame = () => session.hasFirstFrame;
    const { run, reports } = stubRun();
    let outcome: string | null | undefined;

    void createExportWait(h.deps)
      .planRenderWait("solid")
      .awaitReady(run)
      .then((value) => {
        outcome = value;
      });
    await settle();

    expect(outcome).toBeUndefined();
    expect(reports).toEqual([null]);
    session.markFirstFrame();
    h.signal();
    await settle();

    expect(outcome).toBeNull();
  });

  it("parks on the surface session's first frame the same way", async () => {
    const h = harness();
    h.world.mode = "surface";
    const { run, reports } = stubRun();
    let outcome: string | null | undefined;

    void createExportWait(h.deps)
      .planRenderWait("surface")
      .awaitReady(run)
      .then((v) => {
        outcome = v;
      });
    await settle();
    expect(outcome).toBeUndefined();
    h.world.firstFrame.surface = true;
    h.signal();
    await settle();

    expect(outcome).toBeNull();
    expect(reports).toEqual([null]);
  });

  it("reports the flame's own coverage fraction on every turn of an unmet budget", async () => {
    const h = harness();
    h.world.flameCoverage = 0.25;
    const { run, reports } = stubRun();
    let outcome: string | null | undefined;

    void createExportWait(h.deps)
      .planRenderWait("flame")
      .awaitReady(run)
      .then((v) => {
        outcome = v;
      });
    await settle();
    h.world.flameCoverage = 0.5;
    h.signal();
    await settle();
    h.world.flameComplete = true;
    h.signal();
    await settle();

    expect(outcome).toBeNull();
    expect(reports).toEqual([0.25, 0.5]);
  });

  it("resolves the stopped note, verbatim, when the user leaves the mode mid-wait", async () => {
    const h = harness();
    h.world.mode = "flame";
    const { run } = stubRun();
    let outcome: string | null | undefined;

    void createExportWait(h.deps)
      .planRenderWait("flame")
      .awaitReady(run)
      .then((v) => {
        outcome = v;
      });
    await settle();
    h.world.mode = "points";
    h.signal();
    await settle();

    expect(outcome).toBe("Render stopped — no PNG saved");
    expect(outcome).toBe(EXPORT_RENDER_STOPPED_NOTE);
  });

  it("a cancel resolves null — the outcome is the caller's to report", async () => {
    const h = harness();
    h.world.mode = "solid";
    const { run, press } = stubRun();
    let outcome: string | null | undefined;

    void createExportWait(h.deps)
      .planRenderWait("solid")
      .awaitReady(run)
      .then((v) => {
        outcome = v;
      });
    await settle();
    press("cancel");
    h.signal();
    await settle();

    // Null, not the stopped note: run.cancelled is checked ahead of the
    // mode-exit abort, and the caller reads run.cancelled itself.
    expect(outcome).toBeNull();
  });
});

describe("createExportWait: planRenderWait per-mode affordances", () => {
  it("solid and surface plans carry no deliverEarly action at all", () => {
    const wait = createExportWait(harness().deps);

    // ABSENT rather than undefined-valued, so no view can offer the
    // action by finding the key.
    expect("deliverEarly" in wait.planRenderWait("solid")).toBe(false);
    expect("deliverEarly" in wait.planRenderWait("surface")).toBe(false);
  });

  it("the flame plan offers the early save under its exact label", () => {
    const plan = createExportWait(harness().deps).planRenderWait("flame");

    expect(plan.deliverEarly?.label).toBe("Save now (rough)");
    expect(plan.deliverEarly?.label).toBe(EXPORT_SAVE_EARLY_LABEL);
    // Nothing has been delivered early before the wait even runs.
    expect(plan.deliverEarly?.taken()).toBe(false);
  });
});

describe("createExportWait: the early save", () => {
  it("the press latches across the restart gap and is honored only once this session's first frame lands", async () => {
    const h = harness();
    // The Export-size restart gap (the fall-through bug's headline case):
    // budget unmet AND no first frame — the canvas still holds the
    // PREVIOUS session's picture at the PREVIOUS session's size.
    const { run, press } = stubRun();
    const plan = createExportWait(h.deps).planRenderWait("flame");
    let outcome: string | null | undefined;

    void plan.awaitReady(run).then((v) => {
      outcome = v;
    });
    await settle();
    // The press: latch the stop, then wake the parked wait exactly as the
    // modal's button does.
    press("deliver");
    plan.deliverEarly?.onDeliver();
    await settle();
    // Latched, not honored: no frame of this session exists yet, so
    // delivering now would save the previous session's canvas.
    expect(outcome).toBeUndefined();
    h.world.firstFrame.flame = true;
    h.signal();
    await settle();

    expect(outcome).toBeNull();
    expect(plan.deliverEarly?.taken()).toBe(true);
  });

  it("ties go to the budget: a render finishing in the same turn as the press saves the finished picture", async () => {
    const h = harness();
    h.world.firstFrame.flame = true;
    const { run, press } = stubRun();
    const plan = createExportWait(h.deps).planRenderWait("flame");
    let outcome: string | null | undefined;

    void plan.awaitReady(run).then((v) => {
      outcome = v;
    });
    await settle();
    // The budget lands in the same turn as the press: the loop re-checks
    // readiness FIRST, so the finished render wins the race.
    press("deliver");
    h.world.flameComplete = true;
    plan.deliverEarly?.onDeliver();
    await settle();

    expect(outcome).toBeNull();
    // Not labelled rough: the save that happened is the ordinary complete
    // one, whatever was pressed.
    expect(plan.deliverEarly?.taken()).toBe(false);
  });

  it("a deliver press with a first frame already up resolves at once with taken() true", async () => {
    const h = harness();
    h.world.firstFrame.flame = true;
    const { run, press } = stubRun();
    const plan = createExportWait(h.deps).planRenderWait("flame");
    let outcome: string | null | undefined;

    void plan.awaitReady(run).then((v) => {
      outcome = v;
    });
    await settle();
    press("deliver");
    plan.deliverEarly?.onDeliver();
    await settle();

    expect(outcome).toBeNull();
    expect(plan.deliverEarly?.taken()).toBe(true);
  });

  it("a cancel on the flame plan is a discard, never an early save", async () => {
    const h = harness();
    h.world.firstFrame.flame = true;
    const { run, press } = stubRun();
    const plan = createExportWait(h.deps).planRenderWait("flame");
    let outcome: string | null | undefined;

    void plan.awaitReady(run).then((v) => {
      outcome = v;
    });
    await settle();
    press("cancel");
    h.signal();
    await settle();

    expect(outcome).toBeNull();
    expect(plan.deliverEarly?.taken()).toBe(false);
  });

  it("the press's own wake reaches the parked wait through the render signal", async () => {
    const h = harness();
    const { run } = stubRun();
    const plan = createExportWait(h.deps).planRenderWait("flame");

    void plan.awaitReady(run).then(() => {});
    await settle();
    expect(h.parked()).toBe(1);
    // onDeliver IS the injected notifyRenderSignal: the parked wait wakes
    // without any render event of its own arriving.
    plan.deliverEarly?.onDeliver();
    await settle();

    // The wait woke, re-checked (no stop was pressed, nothing ready) and
    // parked again — the wake itself is what this pins.
    expect(h.parked()).toBe(1);
  });
});
