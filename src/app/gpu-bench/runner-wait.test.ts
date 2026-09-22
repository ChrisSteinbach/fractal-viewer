import {
  BACKEND_SMOKE_TIMEOUT_MS,
  BENCH_TIMEOUT_MS,
  type BenchWaitPage,
  type BenchWaitState,
  benchWaitTimeoutMs,
  SHARD_BENCH_TIMEOUT_MS,
  shouldResetWaitOnScenarioCompletion,
  SURFACE_BENCH_TIMEOUT_MS,
  SURFACE_SHADE_AB_TIMEOUT_MS,
  waitForBenchCompletion,
} from "./runner-wait";

function state(
  completedScenarios: string[],
  overrides: Partial<BenchWaitState> = {},
): BenchWaitState {
  return {
    done: false,
    error: null,
    completedScenarios,
    active: null,
    activity: null,
    ...overrides,
  };
}

function fakePage(
  states: BenchWaitState[],
  waitError?: Error,
): {
  page: BenchWaitPage;
  waitForFunction: ReturnType<typeof vi.fn>;
} {
  const remaining = [...states];
  const waitForFunction = vi.fn(async () => {
    if (waitError) throw waitError;
  });
  const evaluate = vi.fn(async () => {
    const next = remaining.shift();
    if (!next) throw new Error("fake page has no state left");
    return next;
  });
  return {
    page: { waitForFunction, evaluate } as unknown as BenchWaitPage,
    waitForFunction,
  };
}

describe("waitForBenchCompletion", () => {
  it("re-arms the full deadline after every completed scenario", async () => {
    const first = state(["sierpinski"], { active: "fern" });
    const second = state(["sierpinski", "fern"], {
      active: "ss1-display-downsample",
    });
    const done = state(["sierpinski", "fern"], { done: true });
    const fake = fakePage([first, second, done]);
    const onScenarioCompleted = vi.fn();

    await expect(
      waitForBenchCompletion(fake.page, {
        timeoutMs: 1_200_000,
        resetOnScenarioCompletion: true,
        onScenarioCompleted,
      }),
    ).resolves.toEqual(done);

    expect(
      fake.waitForFunction.mock.calls.map(
        ([, arg]) => arg.previousCompleted as number,
      ),
    ).toEqual([0, 1, 2]);
    expect(
      fake.waitForFunction.mock.calls.map(
        ([, , options]) => (options as { timeout: number }).timeout,
      ),
    ).toEqual([1_200_000, 1_200_000, 1_200_000]);
    expect(onScenarioCompleted).toHaveBeenNthCalledWith(1, first);
    expect(onScenarioCompleted).toHaveBeenNthCalledWith(2, second);
  });

  it("returns immediately when the page reports a fatal error", async () => {
    const fatal = state([], {
      error: "adapter lost",
      active: "variation-zoo",
    });
    const fake = fakePage([fatal]);

    await expect(
      waitForBenchCompletion(fake.page, {
        timeoutMs: 1_200_000,
        resetOnScenarioCompletion: true,
      }),
    ).resolves.toEqual(fatal);
    expect(fake.waitForFunction).toHaveBeenCalledTimes(1);
  });

  it("keeps a terminal-only whole-run deadline when resets are disabled", async () => {
    const done = state(["sierpinski", "fern"], { done: true });
    const fake = fakePage([done]);

    await expect(
      waitForBenchCompletion(fake.page, {
        timeoutMs: 1_200_000,
        resetOnScenarioCompletion: false,
      }),
    ).resolves.toEqual(done);
    expect(fake.waitForFunction.mock.calls[0]?.[1]).toEqual({
      previousCompleted: 0,
      resetOnScenarioCompletion: false,
    });
  });

  it("names the active scenario and phase when progress stalls", async () => {
    const stalled = state(["sierpinski"], {
      active: "emitter-gearworks",
      activity: "GPU accumulating — 117493 iter/s",
    });
    const timeout = new Error("playwright timeout");
    timeout.name = "TimeoutError";
    const fake = fakePage([stalled], timeout);

    await expect(
      waitForBenchCompletion(fake.page, {
        timeoutMs: 1_200_000,
        resetOnScenarioCompletion: true,
      }),
    ).rejects.toThrow(
      "no scenario completed within 1200000ms; active=emitter-gearworks; activity=GPU accumulating — 117493 iter/s; completed=1",
    );
  });

  it("preserves a browser exit instead of reporting an elapsed stall deadline", async () => {
    const closed = new Error("Target page, context or browser has been closed");
    const fake = fakePage([], closed);

    await expect(
      waitForBenchCompletion(fake.page, {
        timeoutMs: 1_200_000,
        resetOnScenarioCompletion: true,
      }),
    ).rejects.toBe(closed);
  });

  it("fails on navigation even if the replacement page reports done", async () => {
    const fake = fakePage([state([], { done: true, url: "about:blank" })]);

    await expect(
      waitForBenchCompletion(fake.page, {
        timeoutMs: 1_200_000,
        resetOnScenarioCompletion: false,
        expectedUrl: "https://localhost:5173/gpu-bench/index.html?autorun=1",
      }),
    ).rejects.toThrow("benchmark navigated away to about:blank");
  });
});

describe("shouldResetWaitOnScenarioCompletion", () => {
  it("enables rolling progress only for an unsharded flame-only run", () => {
    expect(shouldResetWaitOnScenarioCompletion(false, undefined)).toBe(true);
    expect(shouldResetWaitOnScenarioCompletion(false, "1/12")).toBe(false);
    expect(shouldResetWaitOnScenarioCompletion(true, undefined)).toBe(false);
    expect(shouldResetWaitOnScenarioCompletion(true, "1/12")).toBe(false);
  });
});

describe("benchWaitTimeoutMs", () => {
  const flame = {
    backendSmoke: false,
    surfaceRequested: false,
    surfaceHeavyLeg: false,
  };

  it("keeps the local unsharded flame sweep's 20-minute per-scenario stall deadline", () => {
    expect(benchWaitTimeoutMs({ ...flame, shard: undefined })).toBe(
      BENCH_TIMEOUT_MS,
    );
    expect(BENCH_TIMEOUT_MS).toBe(20 * 60_000);
  });

  it("gives a CI shard its own 30-minute whole-shard cap", () => {
    expect(benchWaitTimeoutMs({ ...flame, shard: "8/34" })).toBe(
      SHARD_BENCH_TIMEOUT_MS,
    );
    expect(SHARD_BENCH_TIMEOUT_MS).toBe(30 * 60_000);
  });

  it("keeps the shard cap under the workflow's 40-minute job guard with room for setup", () => {
    // Setup (checkout, npm ci, browser install, dev server) measured about
    // two minutes; the script must trip first so it names the active phase.
    expect(SHARD_BENCH_TIMEOUT_MS + 5 * 60_000).toBeLessThanOrEqual(
      40 * 60_000,
    );
  });

  it("leaves the surface caps and the backend smoke untouched by sharding", () => {
    for (const shard of [undefined, "1/34"]) {
      expect(
        benchWaitTimeoutMs({ ...flame, surfaceRequested: true, shard }),
      ).toBe(SURFACE_BENCH_TIMEOUT_MS);
      expect(
        benchWaitTimeoutMs({
          ...flame,
          surfaceRequested: true,
          surfaceHeavyLeg: true,
          shard,
        }),
      ).toBe(SURFACE_SHADE_AB_TIMEOUT_MS);
      expect(benchWaitTimeoutMs({ ...flame, backendSmoke: true, shard })).toBe(
        BACKEND_SMOKE_TIMEOUT_MS,
      );
    }
  });
});
