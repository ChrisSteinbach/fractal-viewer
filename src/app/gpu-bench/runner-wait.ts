/**
 * The headless runner's completion wait, kept outside its `.mjs` entry point
 * so the progress/deadline policy is unit-testable without launching Chrome.
 *
 * The flame agreement sweep publishes one result only after a whole scenario
 * finishes. For an unsharded local sweep, each increase in that result count
 * proves the page is still making useful progress and re-arms the same stall
 * deadline. CI shards deliberately opt out: their 30-minute deadline
 * ({@link SHARD_BENCH_TIMEOUT_MS}) remains a cap on the whole shard so the
 * script still trips before the workflow's 40-minute runaway guard. Surface runs also opt out because their progress is
 * published through `surfaceDe`, not the scenario array.
 */

export interface BenchWaitState {
  done: boolean;
  error: string | null;
  completedScenarios: string[];
  active: string | null;
  activity: string | null;
  url?: string;
}

export interface BenchWaitPage {
  waitForFunction(
    predicate: (arg: {
      previousCompleted: number;
      resetOnScenarioCompletion: boolean;
      expectedUrl?: string;
    }) => boolean,
    arg: {
      previousCompleted: number;
      resetOnScenarioCompletion: boolean;
      expectedUrl?: string;
    },
    options: { timeout: number; polling: number },
  ): Promise<unknown>;
  evaluate<T>(pageFunction: () => T): Promise<T>;
}

export interface BenchWaitOptions {
  timeoutMs: number;
  resetOnScenarioCompletion: boolean;
  expectedUrl?: string;
  onScenarioCompleted?: (state: BenchWaitState) => void;
}

/**
 * Flame HANG detector, not an agreement budget. An unsharded local sweep
 * re-arms this deadline whenever a scenario finishes, so roster growth can
 * lengthen a healthy run without making a genuinely stuck scenario take
 * longer to name. Raised from 10 to 20 minutes when a fourteenth scenario
 * (`xform-color`) landed; the rolling local policy arrived at 23 scenarios.
 */
export const BENCH_TIMEOUT_MS = 20 * 60_000;

/**
 * The sharded (CI) flame run's whole-shard cap. Since the roster went to one
 * scenario per shard, this caps ONE scenario plus the standalone ss=1 and
 * adaptive-display checks, so it is still a hang detector and not an
 * agreement budget. Split off {@link BENCH_TIMEOUT_MS} at 30 minutes because
 * the 20 it inherited was being tripped by a HEALTHY shard:
 * `tiling-multisystem-3d` runs its 50,331,648-iteration GPU equal-N pass at
 * about 54.5K iterations/s on SwiftShader (923 s on its own), and three of
 * its last five CI runs hit 20 minutes with the scenario already complete
 * and the standalone checks active; the passing ones measured 17m50s of page
 * work (`docs/gpu-agreement-ci.md`). 30 leaves that shard about 10 minutes of
 * margin and stays under the workflow's 40-minute job guard with setup, so
 * the script still trips first and names the active phase.
 */
export const SHARD_BENCH_TIMEOUT_MS = 30 * 60_000;

/** Wait cap when a surface flag is present: the surface timing matrix (many
 * kernel configs, multi-pass marches, a per-config wall cap of its own) can
 * legitimately run far past the flame sweep's own wait. */
export const SURFACE_BENCH_TIMEOUT_MS = 30 * 60_000;

/** Wait cap when the shade A/B leg (or the 4D kernel-cost sweep) is requested
 * on top: its full-width BASELINE arms are the whole point of the comparison
 * and measured up to ~10-15 minutes EACH on Iris (two poses), on top of leg
 * B's own budget; a 30-minute ceiling measured a timeout mid-leg. */
export const SURFACE_SHADE_AB_TIMEOUT_MS = 60 * 60_000;

/** The backend smoke's cap: one tiny accumulation, so anything longer is a
 * hang. */
export const BACKEND_SMOKE_TIMEOUT_MS = 5 * 60_000;

/** The runner's wait cap for one invocation, picked from what was asked. */
export function benchWaitTimeoutMs(run: {
  backendSmoke: boolean;
  surfaceRequested: boolean;
  surfaceHeavyLeg: boolean;
  shard: string | undefined;
}): number {
  if (run.backendSmoke) return BACKEND_SMOKE_TIMEOUT_MS;
  if (run.surfaceRequested)
    return run.surfaceHeavyLeg
      ? SURFACE_SHADE_AB_TIMEOUT_MS
      : SURFACE_BENCH_TIMEOUT_MS;
  return run.shard !== undefined ? SHARD_BENCH_TIMEOUT_MS : BENCH_TIMEOUT_MS;
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
    url: location.href,
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
          expectedUrl,
        }) =>
          (expectedUrl !== undefined && location.href !== expectedUrl) ||
          window.__BENCH_DONE__ === true ||
          window.__BENCH_ERROR__ !== undefined ||
          (resetOnScenarioCompletion &&
            (window.__BENCH_RESULTS__?.scenarios.length ?? 0) >
              completedBeforeWait),
        {
          previousCompleted,
          resetOnScenarioCompletion: options.resetOnScenarioCompletion,
          expectedUrl: options.expectedUrl,
        },
        { timeout: options.timeoutMs, polling: 250 },
      );
    } catch (cause) {
      // A closed/crashed browser rejects immediately. Calling that a stall
      // falsely reports that the entire deadline elapsed and hides the useful
      // transport error behind a timeout message.
      if (!(cause instanceof Error) || cause.name !== "TimeoutError") {
        throw cause;
      }
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
    if (
      options.expectedUrl !== undefined &&
      state.url !== options.expectedUrl
    ) {
      throw new Error(
        `benchmark navigated away to ${state.url ?? "unknown URL"}`,
      );
    }
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
