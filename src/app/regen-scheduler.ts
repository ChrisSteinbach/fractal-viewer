/**
 * Coalesces a burst of point-cloud regenerations into at most one run per
 * animation frame (fr-acc). During a guide-box drag or a panel-slider drag
 * the triggering event fires many times per frame; this collapses a frame's
 * worth of requests into one deferred run — the very next animation frame
 * regenerates once, reflecting the latest state, and every intermediate
 * request within that frame is dropped.
 *
 * Originally this was the only thing standing between a drag and a whole
 * synchronous O(numPoints) chaos game per input event. Generation now runs
 * in a Web Worker (fr-5kx; see `cloud-generator.ts`), so per-frame this
 * bounds request-building and postMessage traffic — and in the generator's
 * synchronous fallback mode (worker failed to load or crashed) it is once
 * again all that stops a drag from running a full generation per event.
 *
 * Deliberately tiny and dependency-injected (`raf`/`caf`) so the coalescing
 * policy is unit-tested without a browser — the same injected-scheduler
 * discipline `edit-session.ts` uses for its debounced save. Only the
 * high-frequency drag/slider paths schedule through here; the one-shot
 * regenerations (preset load, Surprise Me, undo/redo restore, the explicit
 * Regenerate button) call `regenerate()` directly, which instead
 * {@link FrameCoalescer.cancel}s any pending coalesced run it has just
 * superseded so that run can't fire a redundant second request next frame.
 */
export interface FrameCoalescer {
  /**
   * Request a run at the next animation frame. Idempotent within a frame: if a
   * run is already pending, this is a no-op, so N calls in one frame produce
   * exactly one run.
   */
  schedule(): void;
  /**
   * Drop a pending run without executing it — called by a synchronous
   * regeneration that has already produced a fresher result, so the queued
   * frame doesn't run the (now-stale) generation a second time.
   */
  cancel(): void;
}

/**
 * Build a {@link FrameCoalescer} that defers `run` to the next frame via the
 * injected `raf` (and cancels via `caf`). The real app passes
 * `requestAnimationFrame`/`cancelAnimationFrame`; tests pass a fake clock.
 */
export function createFrameCoalescer(
  run: () => void,
  raf: (cb: () => void) => number,
  caf: (handle: number) => void,
): FrameCoalescer {
  // The pending frame handle, or null when nothing is scheduled.
  let handle: number | null = null;
  return {
    schedule(): void {
      if (handle !== null) return; // already pending this frame — coalesce.
      handle = raf(() => {
        // Clear BEFORE running so a synchronous `cancel()` from inside `run`
        // (regenerate() cancels any pending coalesced run) sees nothing
        // pending and can't double-cancel a frame that is already firing.
        handle = null;
        run();
      });
    },
    cancel(): void {
      if (handle === null) return;
      caf(handle);
      handle = null;
    },
  };
}
