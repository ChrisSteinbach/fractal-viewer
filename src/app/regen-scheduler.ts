/**
 * Coalesces a burst of point-cloud regenerations into at most one run per
 * animation frame (fr-acc). The interactive point cloud is regenerated
 * synchronously on the main thread (`main.ts`'s `regenerate()`); during a
 * guide-box drag or a panel-slider drag the triggering event fires many times
 * per frame, and — before this — each one ran a whole O(numPoints) chaos game,
 * so a single drag stalled the render/input loop with a burst of redundant
 * generations. This collapses a frame's worth of requests into one deferred
 * run: the very next animation frame regenerates once, reflecting the latest
 * state, and every intermediate request within that frame is dropped.
 *
 * Deliberately tiny and dependency-injected (`raf`/`caf`) so the coalescing
 * policy is unit-tested without a browser — the same injected-scheduler
 * discipline `edit-session.ts` uses for its debounced save. Only the
 * high-frequency drag/slider paths schedule through here; the one-shot
 * regenerations (preset load, Surprise Me, undo/redo restore, the explicit
 * Regenerate button, boot) stay synchronous because they read the fresh
 * `lastResult`/`fourDResult` immediately afterward (camera auto-framing), and
 * instead {@link FrameCoalescer.cancel} any pending coalesced run they have
 * just superseded so it can't fire a redundant second time next frame.
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
