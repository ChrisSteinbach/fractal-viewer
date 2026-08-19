/**
 * The Save-PNG export progress modal's DOM-free state machine:
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
 * A run may offer a SECOND stop: "stop waiting and deliver what
 * you have", for the one caller whose wait is sitting on a real — coarser —
 * picture rather than on nothing at all. It is optional in the strongest
 * sense: a `begin()` without a `deliverEarly` action shows the modal it
 * always showed, `requestDeliverEarly()` is inert on such a run exactly as
 * `requestCancel()` is on a non-cancellable one, and no caller has to learn
 * the new vocabulary. What the two stops share is the shape — a request,
 * fired at most once, pinning its own note; what separates them is
 * {@link ExportRun.stop}, because "stop and deliver" and "stop and discard"
 * must not arrive at the caller as the same boolean. `cancelled` therefore
 * keeps meaning DISCARD and nothing else: a run stopped for delivery reads
 * `cancelled === false`, so a caller that never heard of the second action
 * behaves exactly as it did.
 *
 * The first stop wins. Whichever request lands first fixes the run's
 * outcome, and every later one is a no-op — the same "fires onCancel
 * exactly once" rule widened by one action, so a caller can read `stop`
 * once and trust it.
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

/** Grace period before a running export shows its modal. Flame and
 * explorer captures finish well inside it, so the common case never flashes a
 * modal at all. */
export const EXPORT_MODAL_GRACE_MS = 400;

/** Predicted cost above which the modal skips the grace period and shows at
 * once: once the caller already has real evidence — a surface
 * export's own estimated cost — that a run will take longer than this,
 * waiting out {@link EXPORT_MODAL_GRACE_MS} on top buys nothing but a
 * silent extra third of a second, and every silent frame on a minutes-long
 * export reads as a hang rather than a wait. Below this threshold
 * (including an absent `predictedMs`) the grace period still applies — an
 * uncertain or missing prediction gets the benefit of the doubt that the
 * run finishes inside it. */
export const EXPORT_MODAL_SLOW_PREDICTION_MS = 1200;

/** How often a visible modal refreshes its elapsed readout, by
 * re-arming itself every tick — see the module doc for why there is no
 * `setInterval` in {@link ExportProgressDeps}. A single bounded GPU
 * submission can go silent for its whole duration with no `report()` at
 * all, so the tick is what proves an indeterminate export is still alive
 * rather than hung; frequent enough to visibly move, coarse enough that an
 * export with nothing else to do isn't spending it on renders no one can
 * perceive. */
export const EXPORT_MODAL_TICK_MS = 250;

/**
 * Percent convention shared with the surface progress row:
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

/** What one freshly shown modal opens with. */
export interface ExportProgressInit {
  title: string;
  detail: string;
  /** False hides the Cancel affordance rather than offering a dead button. */
  cancellable: boolean;
  /** The optional second action, carrying only its label — the
   * click routes back through {@link ExportProgressDriver.requestDeliverEarly}
   * exactly as Cancel routes through `requestCancel`. ABSENT MEANS THE
   * ONE-BUTTON MODAL, unchanged: a view must render nothing extra, and must
   * not offer the action on runs that never earned it. */
  deliverEarly?: { label: string };
}

/** The DOM surface this driver drives. `Ui` satisfies it structurally. */
export interface ExportProgressView {
  /** Mount and show the modal. Called at most once per run — see {@link
   * ExportProgressDriver.begin}. */
  showExportProgress(init: ExportProgressInit): void;
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

/**
 * How a run was stopped, when the user stopped it. `"cancel"` is
 * stop-and-discard — the export ends with no file — and `"deliver"` is
 * stop-and-hand-over, which only a run that offered the second action can
 * ever reach. Both are REQUESTS: the work underneath unwinds at its own
 * pace, and the caller's `end()` is still what closes the modal.
 */
export type ExportStop = "cancel" | "deliver";

/** One in-flight export, as seen by its caller. */
export interface ExportRun {
  /** Latest coverage, 0..1 — or null for honest indeterminate (a single GPU
   * submission cannot report mid-draw percent). Clamped; safe before the
   * modal is visible. */
  report(fraction: number | null): void;
  /** Terminal: hide the modal and drop every timer. Idempotent. */
  end(): void;
  /** True once the user asked to stop AND DISCARD. Deliberately NOT widened
   * to cover {@link ExportStop} `"deliver"`: every existing caller
   * reads this as "throw the export away", so a delivering run must read
   * false here or the file it asked for would be discarded by code that
   * predates the action. */
  readonly cancelled: boolean;
  /** Which stop the user requested, or null while the run is simply going.
   * The FIRST one wins — a later request cannot change it. `cancelled` is
   * exactly `stop === "cancel"`. */
  readonly stop: ExportStop | null;
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
    /** Offer the second stop: a labelled action that ends the wait
     * WITH a picture instead of without one. Omit — the default — and this
     * run has exactly one button, byte for byte the one-button modal that
     * predates it. `onDeliver` is the `onCancel` twin: fired at most once,
     * from {@link ExportProgressDriver.requestDeliverEarly}, to wake
     * whatever the caller has parked. */
    deliverEarly?: { label: string; onDeliver: () => void };
  }): ExportRun;
  /** The view's Cancel/Escape entry point. No-op when nothing is running,
   * the active run is not cancellable, or it has already stopped. */
  requestCancel(): void;
  /** The view's second-action entry point. No-op when nothing is
   * running, the active run never offered the action, or it has already
   * stopped — a run cannot be made to take an outcome it did not offer, the
   * same honesty rule `cancellable: false` states for Cancel. */
  requestDeliverEarly(): void;
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
  /** The second action, or null for the one-button modal. */
  readonly deliverEarly: { label: string; onDeliver: () => void } | null;
  visible: boolean;
  ended: boolean;
  /** Null until a stop request lands; then fixed for the run's life. */
  stop: ExportStop | null;
  /** Latest reported fraction, remembered across the hidden period so the
   * modal's first paint already carries real coverage (see bullet 4 in the
   * modal spec / the module doc). */
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
  // pinned to the stop's own note from the moment a stop request succeeds
  // until end(). Deriving the note from `run.stop` on every push — rather
  // than special-casing report() while stopping — is what makes "further
  // report() calls must not overwrite that note" hold automatically: there
  // is no elapsed branch left for them to reach.
  //
  // The percent is deliberately NOT pinned alongside it. Under "cancel" it
  // keeps describing work still unwinding; under "deliver" the
  // caller has stopped reporting by construction — it took its picture at
  // the press — so the last number stands, which is exactly the coverage of
  // the frame being handed over. The elapsed clock is what had to go: a
  // timer still counting up past a decided outcome reads as a wait that has
  // not been answered.
  function statusOf(run: Run): { pct: number | null; note: string } {
    const pct =
      run.lastFraction === null ? null : formatRenderPercent(run.lastFraction);
    const note =
      run.stop === "cancel"
        ? "Cancelling…"
        : run.stop === "deliver"
          ? "Saving this frame…"
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
    const init: ExportProgressInit = {
      title: run.title,
      detail: run.detail,
      cancellable: run.cancellable,
    };
    // Set only when the run has one, so a view sees the same object shape
    // it always saw for every caller that never asked for the action.
    if (run.deliverEarly) init.deliverEarly = { label: run.deliverEarly.label };
    deps.view.showExportProgress(init);
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
      deliverEarly?: { label: string; onDeliver: () => void };
    }): ExportRun {
      // Defensive: the caller has its own re-entrancy guard, but a
      // leaked grace/tick timer from an abandoned run would be worse than a
      // redundant hide.
      if (current) endRun(current);

      const run: Run = {
        startedAt: deps.now(),
        title: opts.title,
        detail: opts.detail,
        cancellable: opts.cancellable,
        onCancel: opts.onCancel,
        deliverEarly: opts.deliverEarly ?? null,
        visible: false,
        ended: false,
        stop: null,
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
          return run.stop === "cancel";
        },
        get stop(): ExportStop | null {
          return run.stop;
        },
      };
    },

    requestCancel(): void {
      const run = current;
      if (!run || run.ended || run.stop !== null || !run.cancellable) return;
      run.stop = "cancel";
      run.onCancel();
      // No-op while hidden (pushStatus's own guard) — cancelling never
      // shows the modal early; it only pins the note for whenever the
      // modal does appear, now or on the next push.
      pushStatus(run);
    },

    requestDeliverEarly(): void {
      const run = current;
      // The requestCancel guards with the run's own action standing in for
      // `cancellable`: an action the run never offered cannot be taken, and
      // `stop !== null` is what makes the FIRST stop win — a Cancel pressed
      // after this one lands on an outcome already decided, which is the
      // honest answer while the picture is already being encoded.
      if (!run || run.ended || run.stop !== null || !run.deliverEarly) return;
      run.stop = "deliver";
      run.deliverEarly.onDeliver();
      pushStatus(run);
    },

    get active(): boolean {
      return current !== null;
    },
  };
}
