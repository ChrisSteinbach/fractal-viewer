import { runOfflineExport, type OfflineExportDeps } from "./offline-export";

/** Scripted deps: logs every call in order, runs until `stopAfterSteps`
 * stepFrame calls have completed (simulating the player's `done` landing
 * inside that step), and lets individual tests override any dep. */
function makeDeps(
  overrides: Partial<OfflineExportDeps> & { stopAfterSteps?: number } = {},
): { deps: OfflineExportDeps; log: string[] } {
  const log: string[] = [];
  let steps = 0;
  let running = true;
  const stopAfterSteps = overrides.stopAfterSteps ?? Infinity;
  const deps: OfflineExportDeps = {
    startMs: 1000,
    frameMs: 100,
    maxFrames: 1000,
    totalFrames: 1000,
    stepFrame: (nowMs) => {
      steps++;
      log.push(`step@${String(nowMs)}`);
      if (steps >= stopAfterSteps) running = false;
      return Promise.resolve();
    },
    running: () => running,
    renderFrame: (nowMs) => log.push(`render@${String(nowMs)}`),
    encodeFrame: (index) => {
      log.push(`encode#${String(index)}`);
      return Promise.resolve();
    },
    onProgress: (done, total) =>
      log.push(`progress:${String(done)}/${String(total)}`),
    yieldToUi: () => {
      log.push("yield");
      return Promise.resolve();
    },
    ...overrides,
  };
  return { deps, log };
}

describe("runOfflineExport", () => {
  it("steps, renders, encodes, and reports each frame in order at exact virtual times", async () => {
    const { deps, log } = makeDeps({ stopAfterSteps: 3, totalFrames: 2 });

    const run = await runOfflineExport(deps);

    // Two full frames at t=1000 and t=1100; the third step learns the run
    // ended, so frame 2 is never rendered or encoded.
    expect(log).toEqual([
      "step@1000",
      "render@1000",
      "encode#0",
      "progress:1/2",
      "yield",
      "step@1100",
      "render@1100",
      "encode#1",
      "progress:2/2",
      "yield",
      "step@1200",
    ]);
    expect(run).toEqual({ frames: 2, capped: false });
  });

  it("captures nothing when the run is already over before frame 0", async () => {
    const { deps, log } = makeDeps({ running: () => false });

    const run = await runOfflineExport(deps);

    expect(log).toEqual([]);
    expect(run).toEqual({ frames: 0, capped: false });
  });

  it("does not step again after a stop lands between frames", async () => {
    // The stop arrives during the yield after frame 0 — the loop's
    // condition check must catch it without ticking the virtual clock once
    // more.
    let running = true;
    const { deps, log } = makeDeps({
      running: () => running,
      yieldToUi: () => {
        log.push("yield");
        running = false;
        return Promise.resolve();
      },
    });
    const run = await runOfflineExport(deps);

    expect(log).toEqual([
      "step@1000",
      "render@1000",
      "encode#0",
      "progress:1/1000",
      "yield",
    ]);
    expect(run).toEqual({ frames: 1, capped: false });
  });

  it("cuts at maxFrames and reports the cap when the playback outlives it", async () => {
    const { deps, log } = makeDeps({ maxFrames: 2, totalFrames: 2 });

    const run = await runOfflineExport(deps);

    expect(log.filter((e) => e.startsWith("step"))).toEqual([
      "step@1000",
      "step@1100",
    ]);
    expect(run).toEqual({ frames: 2, capped: true });
  });

  it("a natural end on the run's last step is not reported as capped", async () => {
    // The player's done lands inside step 2 with maxFrames 2: the loop
    // exits by the running() check, not the cap — running() is false, so
    // capped must be too.
    const { deps } = makeDeps({ maxFrames: 3, stopAfterSteps: 3 });

    const run = await runOfflineExport(deps);

    expect(run).toEqual({ frames: 2, capped: false });
  });

  it("awaits the encoder before advancing the clock (backpressure)", async () => {
    // encode#0 resolves only when released; no second stepFrame may run
    // before that.
    const log: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { deps } = makeDeps({ maxFrames: 2 });
    const slowDeps: OfflineExportDeps = {
      ...deps,
      stepFrame: (nowMs) => {
        log.push(`step@${String(nowMs)}`);
        return Promise.resolve();
      },
      encodeFrame: (index) => {
        log.push(`encode#${String(index)}`);
        return index === 0 ? gate : Promise.resolve();
      },
    };

    const runPromise = runOfflineExport(slowDeps);
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(["step@1000", "encode#0"]);

    release?.();
    await runPromise;
    expect(log).toEqual(["step@1000", "encode#0", "step@1100", "encode#1"]);
  });

  it("propagates an encoder failure without capturing further frames", async () => {
    const { deps, log } = makeDeps({
      encodeFrame: (index) => {
        log.push(`encode#${String(index)}`);
        return Promise.reject(new Error("hardware encoder died"));
      },
    });

    await expect(runOfflineExport(deps)).rejects.toThrow(
      "hardware encoder died",
    );
    expect(log.filter((e) => e.startsWith("step"))).toEqual(["step@1000"]);
    expect(log.filter((e) => e.startsWith("progress"))).toEqual([]);
  });
});
