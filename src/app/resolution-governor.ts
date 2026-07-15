/**
 * Adaptive render-resolution governor (fr-4lyt): watches the wall-clock gap
 * between consecutively RENDERED animation frames and decides when weak
 * hardware should trade pixel count for frame rate — and when it has earned
 * that resolution back.
 *
 * The problem being solved: point count and render style are tuned against a
 * capable GPU, and the app has no reliable a-priori signal for "this device
 * is slow" — phones, integrated graphics, and throttled laptops vary far more
 * than any fixed budget can anticipate. The only trustworthy signal is the
 * frame time the device actually produces once it's rendering. This module
 * turns a stream of measured dt samples into a resolution-scale decision the
 * same way `morph-budget.ts` turns measured generation latency into a
 * point-count decision: main.ts's animate loop feeds every rendered frame's
 * dt to {@link ResolutionGovernor.sample} and applies whatever scale comes
 * back to the renderer's drawing-buffer size.
 *
 * How: an exponential moving average of dt smooths over one-off jitter (a GC
 * pause, a single dropped frame) so the decision reacts to SUSTAINED
 * slowness rather than a blip. {@link GOVERNOR_DOWN_MS} and
 * {@link GOVERNOR_UP_MS} bound a dead band the EMA can sit in without either
 * direction making progress — the hysteresis that keeps the scale from
 * flapping between two steps when the frame time hovers near a single
 * threshold. Crossing a threshold isn't enough on its own either:
 * {@link GOVERNOR_DOWN_SUSTAIN} / {@link GOVERNOR_UP_SUSTAIN} consecutive
 * qualifying samples are required before a step actually happens, and
 * recovering resolution deliberately needs many more sustained-fast samples
 * than losing it did — an eager recovery would just get knocked back down by
 * the next hiccup. Resolution moves in discrete
 * {@link RESOLUTION_SCALE_STEPS} rather than a continuous scale, because
 * every change re-sizes the drawing buffer and every render target, so
 * {@link GOVERNOR_HOLDOFF} freezes the decision for a few samples after each
 * step to give that reallocation room to settle before the next one is
 * considered. A dt above {@link GOVERNOR_OUTLIER_MS} — a backgrounded-tab
 * catch-up frame, a GC pause, a generation upload blocking the main thread —
 * is a one-off stall, not sustained load, and is ignored outright rather than
 * smeared into the EMA.
 *
 * Pure and clock-free like `exposure.ts` and `morph-budget.ts`: dt arrives as
 * a plain number the caller measured against its own clock, so tests drive
 * the governor directly with synthetic samples — no fake timers, no
 * `requestAnimationFrame`.
 */

/** Resolution scale ladder, full resolution first. Discrete steps with
 * hysteresis (rather than a continuous scale) so every change is worth its
 * buffer reallocation — each step re-sizes the drawing buffer and every
 * render target. 0.5 is the floor: quarter the pixels of full scale. */
export const RESOLUTION_SCALE_STEPS = [1, 0.85, 0.7, 0.6, 0.5] as const;

/** EMA smoothing factor for frame dt. */
export const GOVERNOR_EMA_ALPHA = 0.1;
/** EMA above this (ms) counts toward stepping resolution DOWN — two missed
 * 60 Hz vsyncs; a deliberately 30 fps-capped device (~33.3ms) sits just
 * under it and is left alone. */
export const GOVERNOR_DOWN_MS = 34;
/** EMA below this (ms) counts toward stepping back UP (~50+ fps). */
export const GOVERNOR_UP_MS = 20;
/** Consecutive qualifying samples required to step down (~0.75s at 60fps). */
export const GOVERNOR_DOWN_SUSTAIN = 45;
/** Consecutive qualifying samples required to step up — deliberately slower
 * than the way down (~3s at 60fps) so recovery can't flap. */
export const GOVERNOR_UP_SUSTAIN = 180;
/** Samples after any step during which the counters stay frozen (the EMA
 * still updates): lets the buffer reallocation settle and spaces steps out. */
export const GOVERNOR_HOLDOFF = 30;
/** dt (ms) above this is a one-off stall (background tab catch-up, GC pause,
 * a generation upload), not sustained load: ignored entirely. */
export const GOVERNOR_OUTLIER_MS = 250;

export interface ResolutionGovernor {
  /** Current scale — the last value {@link sample} returned, 1 initially. */
  readonly scale: number;
  /**
   * Feed the elapsed ms between two consecutively RENDERED frames. Returns
   * the new scale when this sample tips a step (already reflected in
   * {@link scale}), else null.
   */
  sample(dtMs: number): number | null;
  /** Forget all timing state and return to full resolution (scale 1). */
  reset(): void;
}

/**
 * Create a governor starting at full resolution (scale 1) with no timing
 * history — the same state {@link ResolutionGovernor.reset} returns to.
 */
export function createResolutionGovernor(): ResolutionGovernor {
  let stepIndex = 0;
  let ema: number | null = null;
  let downStreak = 0;
  let upStreak = 0;
  let holdoff = 0;

  // Commit a step to `newIndex`: clear both streaks and arm the hold-off so
  // the next few samples can't immediately trigger another reallocation.
  function stepTo(newIndex: number): number {
    stepIndex = newIndex;
    downStreak = 0;
    upStreak = 0;
    holdoff = GOVERNOR_HOLDOFF;
    return RESOLUTION_SCALE_STEPS[stepIndex];
  }

  return {
    get scale(): number {
      return RESOLUTION_SCALE_STEPS[stepIndex];
    },

    sample(dtMs: number): number | null {
      // Invalid or one-off-stall dt: ignore completely, as if this sample
      // never happened — no EMA update, no counter movement.
      if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > GOVERNOR_OUTLIER_MS) {
        return null;
      }

      ema = ema === null ? dtMs : ema + GOVERNOR_EMA_ALPHA * (dtMs - ema);

      // Still settling from the last step: the EMA keeps tracking, but the
      // sustain counters stay frozen at 0 until the hold-off elapses.
      if (holdoff > 0) {
        holdoff--;
        return null;
      }

      if (ema > GOVERNOR_DOWN_MS) {
        downStreak = Math.min(downStreak + 1, GOVERNOR_DOWN_SUSTAIN);
        upStreak = 0;
      } else if (ema < GOVERNOR_UP_MS) {
        upStreak = Math.min(upStreak + 1, GOVERNOR_UP_SUSTAIN);
        downStreak = 0;
      } else {
        // Dead band between the two thresholds: neither direction makes
        // progress here — this is what makes the hysteresis work.
        downStreak = 0;
        upStreak = 0;
      }

      if (
        downStreak >= GOVERNOR_DOWN_SUSTAIN &&
        stepIndex < RESOLUTION_SCALE_STEPS.length - 1
      ) {
        return stepTo(stepIndex + 1);
      }
      if (upStreak >= GOVERNOR_UP_SUSTAIN && stepIndex > 0) {
        return stepTo(stepIndex - 1);
      }
      return null;
    },

    reset(): void {
      stepIndex = 0;
      ema = null;
      downStreak = 0;
      upStreak = 0;
      holdoff = 0;
    },
  };
}
