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
 * threshold. Crossing a threshold isn't enough on its own either: the
 * qualifying frames must ACCUMULATE {@link GOVERNOR_DOWN_SUSTAIN_MS} /
 * {@link GOVERNOR_UP_SUSTAIN_MS} of wall-clock frame time before a step
 * actually happens. Sustain is measured in TIME, not sample count, on
 * purpose: samples arrive at the device's own frame rate, so counting them
 * would make the wait scale inversely with how much help is needed — a
 * device producing one frame every three seconds has already sustained three
 * seconds of misery per sample, and a sample-counted sustain would sit
 * through minutes of that before reacting. Recovering resolution
 * deliberately needs a longer sustain than losing it did — an eager recovery
 * would just get knocked back down by the next hiccup. Resolution moves in
 * discrete {@link RESOLUTION_SCALE_STEPS} rather than a continuous scale,
 * because every change re-sizes the drawing buffer and every render target,
 * so {@link GOVERNOR_HOLDOFF_MS} freezes the decision briefly after each
 * step to give that reallocation room to settle before the next one is
 * considered. A dt above {@link GOVERNOR_OUTLIER_MS} — a backgrounded-tab
 * catch-up frame, a GC pause, a generation upload blocking the main thread —
 * is a one-off stall, not sustained load, and is ignored outright rather than
 * smeared into the EMA; but {@link GOVERNOR_OUTLIER_STREAK} of them back to
 * back is not a stall, it's a device where every frame is that bad, and from
 * there they count (clamped) so even catastrophic hardware steps down.
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
/** Accumulated qualifying frame time (ms) required to step down — 1.5s of
 * sustained slow frames, however many samples that takes on this device. */
export const GOVERNOR_DOWN_SUSTAIN_MS = 1500;
/** Accumulated qualifying frame time (ms) required to step up — deliberately
 * twice the way down, so recovery can't flap. */
export const GOVERNOR_UP_SUSTAIN_MS = 3000;
/** Frame time (ms) after any step during which the accruals stay frozen (the
 * EMA still updates): lets the buffer reallocation settle and spaces steps
 * out. */
export const GOVERNOR_HOLDOFF_MS = 500;
/** dt (ms) above this is a one-off stall (background tab catch-up, GC pause,
 * a generation upload), not sustained load: ignored entirely — unless a
 * whole {@link GOVERNOR_OUTLIER_STREAK} of them arrive back to back. */
export const GOVERNOR_OUTLIER_MS = 250;
/**
 * Consecutive outlier-sized dts after which they stop reading as one-off
 * stalls and start counting as sustained load (clamped to
 * {@link GOVERNOR_OUTLIER_MS} so one absurd dt can't warp the EMA). Without
 * this, a device slow enough that EVERY frame exceeds the outlier cutoff —
 * the very hardware this governor exists for — would never step down at
 * all: each miserable frame would be dismissed as a stall. A genuine one-off
 * (tab refocus, one GC pause, one upload) never arrives five deep.
 */
export const GOVERNOR_OUTLIER_STREAK = 5;

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
  let downMs = 0;
  let upMs = 0;
  let holdoffMs = 0;
  let outlierStreak = 0;

  // Commit a step to `newIndex`: clear both accruals and arm the hold-off so
  // the frames right after can't immediately trigger another reallocation.
  function stepTo(newIndex: number): number {
    stepIndex = newIndex;
    downMs = 0;
    upMs = 0;
    holdoffMs = GOVERNOR_HOLDOFF_MS;
    return RESOLUTION_SCALE_STEPS[stepIndex];
  }

  return {
    get scale(): number {
      return RESOLUTION_SCALE_STEPS[stepIndex];
    },

    sample(dtMs: number): number | null {
      // Invalid dt: ignore completely, as if this sample never happened.
      if (!Number.isFinite(dtMs) || dtMs <= 0) {
        return null;
      }
      // Outlier-sized dt: a one-off stall is ignored, but a whole streak of
      // them is a device where every frame is this bad — from then on each
      // one counts as sustained load, clamped to the cutoff so one freak dt
      // (a 30s background-tab catch-up ending a streak) can't warp the EMA
      // or claim half a minute of accrual by itself (see
      // GOVERNOR_OUTLIER_STREAK).
      let dt = dtMs;
      if (dt > GOVERNOR_OUTLIER_MS) {
        outlierStreak++;
        if (outlierStreak < GOVERNOR_OUTLIER_STREAK) return null;
        dt = GOVERNOR_OUTLIER_MS;
      } else {
        outlierStreak = 0;
      }

      ema = ema === null ? dt : ema + GOVERNOR_EMA_ALPHA * (dt - ema);

      // Still settling from the last step: the EMA keeps tracking, but the
      // sustain accruals stay frozen at 0 until the hold-off elapses.
      if (holdoffMs > 0) {
        holdoffMs -= dt;
        return null;
      }

      if (ema > GOVERNOR_DOWN_MS) {
        downMs = Math.min(downMs + dt, GOVERNOR_DOWN_SUSTAIN_MS);
        upMs = 0;
      } else if (ema < GOVERNOR_UP_MS) {
        upMs = Math.min(upMs + dt, GOVERNOR_UP_SUSTAIN_MS);
        downMs = 0;
      } else {
        // Dead band between the two thresholds: neither direction makes
        // progress here — this is what makes the hysteresis work.
        downMs = 0;
        upMs = 0;
      }

      if (
        downMs >= GOVERNOR_DOWN_SUSTAIN_MS &&
        stepIndex < RESOLUTION_SCALE_STEPS.length - 1
      ) {
        return stepTo(stepIndex + 1);
      }
      if (upMs >= GOVERNOR_UP_SUSTAIN_MS && stepIndex > 0) {
        return stepTo(stepIndex - 1);
      }
      return null;
    },

    reset(): void {
      stepIndex = 0;
      ema = null;
      downMs = 0;
      upMs = 0;
      holdoffMs = 0;
      outlierStreak = 0;
    },
  };
}
