/**
 * The headless runner's completion wait, kept outside its `.mjs` entry point
 * so the progress/deadline policy is unit-testable without launching Chrome.
 *
 * The flame agreement sweep publishes one result only after a whole scenario
 * finishes. For an unsharded local sweep, each increase in that result count
 * proves the page is still making useful progress and re-arms the same stall
 * deadline. CI shards deliberately opt out: their 20-minute deadline remains
 * a cap on the whole shard so the script still trips before the workflow's
 * 40-minute runaway guard. Surface runs also opt out because their progress is
 * published through `surfaceDe`, not the scenario array.
 */

export interface BenchWaitState {
  done: boolean;
  error: string | null;
  completedScenarios: string[];
  active: string | null;
  activity: string | null;
}

export interface BenchWaitPage {
  waitForFunction(
    predicate: (arg: {
      previousCompleted: number;
      resetOnScenarioCompletion: boolean;
    }) => boolean,
    arg: {
      previousCompleted: number;
      resetOnScenarioCompletion: boolean;
    },
    options: { timeout: number; polling: number },
  ): Promise<unknown>;
  evaluate<T>(pageFunction: () => T): Promise<T>;
}

export interface BenchWaitOptions {
  timeoutMs: number;
  resetOnScenarioCompletion: boolean;
  onScenarioCompleted?: (state: BenchWaitState) => void;
}

/** Only the local flame-only sweep has an open-ended healthy total runtime. */
export function shouldResetWaitOnScenarioCompletion(
  surfaceRequested: boolean,
  shard: string | undefined,
): boolean {
  return !surfaceRequested && shard === undefined;
}

async function readBenchWaitState(
  page: BenchWaitPage,
): Promise<BenchWaitState> {
  return page.evaluate(() => ({
    done: window.__BENCH_DONE__ === true,
    error: window.__BENCH_ERROR__ ?? null,
    completedScenarios:
      window.__BENCH_RESULTS__?.scenarios.map((scenario) => scenario.name) ??
      [],
    active: window.__BENCH_ACTIVE__ ?? null,
    activity:
      document.getElementById("activityLabel")?.textContent?.trim() || null,
  }));
}

function timeoutMessage(
  timeoutMs: number,
  resetOnScenarioCompletion: boolean,
  state: BenchWaitState | null,
): string {
  const wait = resetOnScenarioCompletion
    ? `no scenario completed within ${String(timeoutMs)}ms`
    : `benchmark did not finish within ${String(timeoutMs)}ms`;
  if (!state) return wait;

  const active = state.active ? `; active=${state.active}` : "";
  const activity = state.activity ? `; activity=${state.activity}` : "";
  const completed = `; completed=${String(state.completedScenarios.length)}`;
  return `${wait}${active}${activity}${completed}`;
}

/**
 * Wait until the page finishes or reports a fatal error. When requested, a
 * completed flame scenario re-arms `timeoutMs`; total healthy sweep time may
 * therefore exceed the deadline, while one stuck scenario still fails within
 * the same interval and the error names the page's active scenario/phase.
 */
export async function waitForBenchCompletion(
  page: BenchWaitPage,
  options: BenchWaitOptions,
): Promise<BenchWaitState> {
  let previousCompleted = 0;

  for (;;) {
    try {
      await page.waitForFunction(
        ({
          previousCompleted: completedBeforeWait,
          resetOnScenarioCompletion,
        }) =>
          window.__BENCH_DONE__ === true ||
          window.__BENCH_ERROR__ !== undefined ||
          (resetOnScenarioCompletion &&
            (window.__BENCH_RESULTS__?.scenarios.length ?? 0) >
              completedBeforeWait),
        {
          previousCompleted,
          resetOnScenarioCompletion: options.resetOnScenarioCompletion,
        },
        { timeout: options.timeoutMs, polling: 250 },
      );
    } catch (cause) {
      let state: BenchWaitState | null = null;
      try {
        state = await readBenchWaitState(page);
      } catch {
        // The page/browser may itself have disappeared. Preserve the original
        // wait failure and report the deadline even without page context.
      }
      throw new Error(
        timeoutMessage(
          options.timeoutMs,
          options.resetOnScenarioCompletion,
          state,
        ),
        { cause },
      );
    }

    const state = await readBenchWaitState(page);
    if (state.done || state.error !== null) return state;

    if (
      !options.resetOnScenarioCompletion ||
      state.completedScenarios.length <= previousCompleted
    ) {
      throw new Error(
        "benchmark wait woke without completion, error, or scenario progress",
      );
    }

    previousCompleted = state.completedScenarios.length;
    options.onScenarioCompleted?.(state);
  }
}
