/**
 * The Save-PNG export progress modal's DOM-free state machine (fr-7mfx):
 * decides WHEN a running export earns a blocking modal, WHAT the modal
 * reads while it's up, and routes the modal's Cancel button back to the
 * export in flight. `Ui` (the DOM side) and `main.ts` (the wiring) are
 * built against this module's surface; this file owns only the policy.
 *
 * The problem being solved: a surface export can trace at export resolution
 * for minutes with zero feedback today — the tab just looks hung. But a
 * modal that showed for EVERY export would punish the common case instead:
 * flame and explorer captures finish in tens of milliseconds, so a modal
 * that flashed on and off for those would be pure noise. `begin()` never
 * shows anything the instant it's called unless the caller already has
 * evidence the run will be slow (`predictedMs` past
 * {@link EXPORT_MODAL_SLOW_PREDICTION_MS}); otherwise it waits out a short
 * {@link EXPORT_MODAL_GRACE_MS} grace period and shows only if the run is
 * still going. A run that ends inside the grace period is invisible from
 * the outside — no `showExportProgress` call ever happens — the same
 * never-flash discipline as `render-tier.ts`'s settle timer.
 *
 * Once visible, the modal is driven two ways: `report()` pushes fresh
 * coverage as the caller measures it (or `null` for the honest
 * indeterminate state a single unbounded GPU submission cannot avoid), and
 * a self-re-arming {@link EXPORT_MODAL_TICK_MS} timer keeps the elapsed
 * readout moving even when no report ever arrives — an indeterminate
 * export must still look alive, not stalled.
 *
 * Cancellation is a REQUEST, not an instant stop: a bounded GPU pass
 * already submitted cannot be interrupted mid-draw, so `requestCancel()`
 * flips `cancelled`, fires `onCancel` exactly once, and pins the modal's
 * note to "Cancelling…" until the caller's own `end()` — never earlier,
 * and never overwritten by a `report()` that arrives while the real work
 * is still unwinding underneath it.
 *
 * Pure and DOM-free like `render-tier.ts` and `drift-policy.ts`: every
 * effect — the clock, the timer primitive, and the view itself — arrives
 * through {@link ExportProgressDeps}, so this module is unit-tested with a
 * manual clock and a fake timer registry, no `window.setTimeout` and no
 * `Ui`. `setTimer`/`clearTimer` model `window.setTimeout`/`clearTimeout`
 * exactly (a numeric id), including for the REPEATING tick: there is no
 * `setInterval` in the dep surface, so the tick re-arms a fresh one-shot
 * from inside its own callback, the same way `main.ts` will wire it.
 */

/** Grace period before a running export shows its modal (fr-7mfx). Flame and
 * explorer captures finish well inside it, so the common case never flashes a
 * modal at all. */
export const EXPORT_MODAL_GRACE_MS = 400;

/** Predicted cost above which the modal skips the grace period and shows at
 * once (fr-7mfx): once the caller already has real evidence — a surface
 * export's own estimated cost — that a run will take longer than this,
 * waiting out {@link EXPORT_MODAL_GRACE_MS} on top buys nothing but a
 * silent extra third of a second, and every silent frame on a minutes-long
 * export reads as a hang rather than a wait. Below this threshold
 * (including an absent `predictedMs`) the grace period still applies — an
 * uncertain or missing prediction gets the benefit of the doubt that the
 * run finishes inside it. */
export const EXPORT_MODAL_SLOW_PREDICTION_MS = 1200;

/** How often a visible modal refreshes its elapsed readout (fr-7mfx), by
 * re-arming itself every tick — see the module doc for why there is no
 * `setInterval` in {@link ExportProgressDeps}. A single bounded GPU
 * submission can go silent for its whole duration with no `report()` at
 * all, so the tick is what proves an indeterminate export is still alive
 * rather than hung; frequent enough to visibly move, coarse enough that an
 * export with nothing else to do isn't spending it on renders no one can
 * perceive. */
export const EXPORT_MODAL_TICK_MS = 250;

/**
 * Percent convention shared with the surface progress row (the fr-99z rule):
 * FLOOR, never round — a rounded 100% while work is still landing reads as a
 * finished render that hasn't finished — and one decimal below 10% so a slow
 * start still visibly moves. Input is clamped to [0, 1].
 */
export function formatRenderPercent(fraction: number): number {
  const pctRaw = Math.min(1, Math.max(0, fraction)) * 100;
  return pctRaw < 10 ? Math.floor(pctRaw * 10) / 10 : Math.floor(pctRaw);
}

/**
 * Elapsed wall time as a compact human string: "0s", "9s", "59s", "1:00",
 * "12:34", "1:02:03". Sub-second rounds down to "0s" — the readout only
 * needs to prove the export hasn't stalled, not to the millisecond. Seconds
 * are zero-padded inside "m:ss" and "h:mm:ss" (the leading minutes/hours
 * component never is). Negative input clamps to zero rather than printing a
 * negative duration.
 */
export function formatExportElapsed(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  if (minutes > 0) return `${minutes}:${pad2(seconds)}`;
  return `${seconds}s`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** The DOM surface this driver drives. `Ui` satisfies it structurally. */
export interface ExportProgressView {
  /** Mount and show the modal. Called at most once per run — see {@link
   * ExportProgressDriver.begin}. */
  showExportProgress(init: {
    title: string;
    detail: string;
    cancellable: boolean;
  }): void;
  /** Refresh the visible modal's readout. Never called before `show`, never
   * called again after `hide`. */
  setExportProgress(status: { pct: number | null; note: string }): void;
  /** Unmount the modal. Only ever called for a run that actually showed
   * one. */
  hideExportProgress(): void;
}

/** Everything {@link createExportProgress} needs from the app, injected so
 * the modal's timing policy stays pure and testable (the edit-session.ts /
 * drift-policy.ts pattern). */
export interface ExportProgressDeps {
  /** Wall clock, e.g. `Date.now`. Read once per run to fix its start time,
   * and again on every status push to compute elapsed. */
  now: () => number;
  /** Arm a one-shot timer, e.g. `window.setTimeout`. Drives both the grace
   * delay and the repeating tick — see the module doc for why there is no
   * `setInterval` in this surface. */
  setTimer: (fn: () => void, ms: number) => number;
  /** Cancel a timer armed by `setTimer`, e.g. `window.clearTimeout`. Always
   * called with an id this driver itself armed. */
  clearTimer: (id: number) => void;
  /** The DOM surface this driver drives. */
  view: ExportProgressView;
}

/** One in-flight export, as seen by its caller. */
export interface ExportRun {
  /** Latest coverage, 0..1 — or null for honest indeterminate (a single GPU
   * submission cannot report mid-draw percent). Clamped; safe before the
   * modal is visible. */
  report(fraction: number | null): void;
  /** Terminal: hide the modal and drop every timer. Idempotent. */
  end(): void;
  /** True once the user asked to stop. The caller polls this. */
  readonly cancelled: boolean;
}

/** Drives the export progress modal: when it shows, what it reads, and
 * where its Cancel button leads. */
export interface ExportProgressDriver {
  /** Start a run. `predictedMs` is measured evidence when the caller has any,
   * else null; `cancellable: false` states honestly that the work cannot be
   * interrupted, and hides the Cancel affordance rather than offering a dead
   * button. */
  begin(opts: {
    title: string;
    detail: string;
    predictedMs: number | null;
    cancellable: boolean;
    onCancel: () => void;
  }): ExportRun;
  /** The view's Cancel/Escape entry point. No-op when nothing is running or
   * the active run is not cancellable. */
  requestCancel(): void;
  /** Whether a run is in flight (the re-entrancy guard's question). */
  readonly active: boolean;
}

/** One run's mutable state, private to {@link createExportProgress}. A
 * fresh object per `begin()` call (never reused across runs) so a handle
 * returned by an earlier `begin()` stays safely inert — `ended` true,
 * every method a no-op — even after a later run has superseded it. */
interface Run {
  readonly startedAt: number;
  readonly title: string;
  readonly detail: string;
  readonly cancellable: boolean;
  readonly onCancel: () => void;
  visible: boolean;
  ended: boolean;
  cancelled: boolean;
  /** Latest reported fraction, remembered across the hidden period so the
   * modal's first paint already carries real coverage (see bullet 4 in the
   * fr-7mfx spec / the module doc). */
  lastFraction: number | null;
  graceTimerId: number | null;
  tickTimerId: number | null;
}

/**
 * Create a driver with no run in flight ({@link ExportProgressDriver.active}
 * is false until the first `begin()`).
 */
export function createExportProgress(
  deps: ExportProgressDeps,
): ExportProgressDriver {
  let current: Run | null = null;

  // The status a visible modal shows RIGHT NOW: the elapsed note ordinarily,
  // pinned to "Cancelling…" from the moment requestCancel() succeeds until
  // end(). Deriving the note from `run.cancelled` on every push — rather
  // than special-casing report() while cancelling — is what makes "further
  // report() calls must not overwrite that note" hold automatically: there
  // is no elapsed branch left for them to reach.
  function statusOf(run: Run): { pct: number | null; note: string } {
    const pct =
      run.lastFraction === null ? null : formatRenderPercent(run.lastFraction);
    const note = run.cancelled
      ? "Cancelling…"
      : formatExportElapsed(deps.now() - run.startedAt);
    return { pct, note };
  }

  function pushStatus(run: Run): void {
    // Hidden: nothing to push yet, but lastFraction was already updated by
    // the caller, so the eventual show still opens on real coverage. Ended:
    // a stale report() from a handle the caller kept past end() must not
    // resurrect a status push on a modal that is already gone.
    if (!run.visible || run.ended) return;
    deps.view.setExportProgress(statusOf(run));
  }

  function armTick(run: Run): void {
    run.tickTimerId = deps.setTimer(() => {
      run.tickTimerId = null;
      if (run.ended) return;
      pushStatus(run);
      armTick(run);
    }, EXPORT_MODAL_TICK_MS);
  }

  function showNow(run: Run): void {
    if (run.ended || run.visible) return;
    run.visible = true;
    deps.view.showExportProgress({
      title: run.title,
      detail: run.detail,
      cancellable: run.cancellable,
    });
    pushStatus(run);
    armTick(run);
  }

  function endRun(run: Run): void {
    if (run.ended) return;
    run.ended = true;
    if (run.graceTimerId !== null) {
      deps.clearTimer(run.graceTimerId);
      run.graceTimerId = null;
    }
    if (run.tickTimerId !== null) {
      deps.clearTimer(run.tickTimerId);
      run.tickTimerId = null;
    }
    if (run.visible) deps.view.hideExportProgress();
    if (current === run) current = null;
  }

  return {
    begin(opts: {
      title: string;
      detail: string;
      predictedMs: number | null;
      cancellable: boolean;
      onCancel: () => void;
    }): ExportRun {
      // Defensive (fr-7mfx): the caller has its own re-entrancy guard, but a
      // leaked grace/tick timer from an abandoned run would be worse than a
      // redundant hide.
      if (current) endRun(current);

      const run: Run = {
        startedAt: deps.now(),
        title: opts.title,
        detail: opts.detail,
        cancellable: opts.cancellable,
        onCancel: opts.onCancel,
        visible: false,
        ended: false,
        cancelled: false,
        lastFraction: null,
        graceTimerId: null,
        tickTimerId: null,
      };
      current = run;

      const showsAtOnce =
        opts.predictedMs !== null &&
        opts.predictedMs > EXPORT_MODAL_SLOW_PREDICTION_MS;
      if (showsAtOnce) {
        showNow(run);
      } else {
        run.graceTimerId = deps.setTimer(() => {
          run.graceTimerId = null;
          showNow(run);
        }, EXPORT_MODAL_GRACE_MS);
      }

      return {
        report(fraction: number | null): void {
          run.lastFraction = fraction;
          pushStatus(run);
        },
        end(): void {
          endRun(run);
        },
        get cancelled(): boolean {
          return run.cancelled;
        },
      };
    },

    requestCancel(): void {
      const run = current;
      if (!run || run.ended || run.cancelled || !run.cancellable) return;
      run.cancelled = true;
      run.onCancel();
      // No-op while hidden (pushStatus's own guard) — cancelling never
      // shows the modal early; it only pins the note for whenever the
      // modal does appear, now or on the next push.
      pushStatus(run);
    },

    get active(): boolean {
      return current !== null;
    },
  };
}
