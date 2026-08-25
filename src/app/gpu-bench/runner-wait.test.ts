import {
  type BenchWaitPage,
  type BenchWaitState,
  shouldResetWaitOnScenarioCompletion,
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
    const fake = fakePage([stalled], new Error("playwright timeout"));

    await expect(
      waitForBenchCompletion(fake.page, {
        timeoutMs: 1_200_000,
        resetOnScenarioCompletion: true,
      }),
    ).rejects.toThrow(
      "no scenario completed within 1200000ms; active=emitter-gearworks; activity=GPU accumulating — 117493 iter/s; completed=1",
    );
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
