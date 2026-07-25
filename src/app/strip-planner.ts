/**
 * Adaptive scissor-strip planner for the surface render's full-quality
 * traces (fr-sjff / fr-8kup): carves a frame's rows into strips sized so no
 * single GPU submission ever runs unbounded.
 *
 * The problem being solved: close to the viewplane every ray is
 * near-surface and burns the whole march budget of heavy DE calls, so a
 * full-quality frame submitted as ONE draw call can mean tens of seconds of
 * GPU work in a single submission — which trips the driver/browser GPU
 * watchdog, loses the WebGL context, and wedges the GPU process until the
 * browser restarts. The fix is architectural: every full-quality trace goes
 * out as scissored strips with a forced-completion sync between them (a
 * 1x1 readback — a data dependency no driver can fake; `gl.finish()` can
 * return before execution on some command-buffer paths), each sized to
 * roughly {@link STRIP_TARGET_MS} of measured GPU time — bounded
 * submissions the watchdog waves through, on ANY system at ANY zoom.
 *
 * How: the first strip is a cheap {@link STRIP_PROBE_FRACTION} probe (worth
 * a couple of seconds even in pathological close-ups — well under any
 * watchdog). Each subsequent strip scales the previous strip's rows by
 * `STRIP_TARGET_MS / measured`, clamped to {@link STRIP_MAX_GROWTH} per
 * step so one suspiciously-fast measurement can't balloon straight to an
 * unbounded submission. On a light system the probe measures fractions of
 * a millisecond and the growth cap finishes the frame in a handful of
 * submissions (negligible overhead); on a heavy close-up the strips
 * converge to watchdog-safe slices and the caller spreads them across
 * animation frames, keeping the page responsive and the job interruptible.
 *
 * Pure like `render-tier.ts`: the caller renders and measures; the planner
 * only does the arithmetic, so tests drive it with synthetic measurements.
 */

/** Fraction of the frame's rows in the first (probe) strip. Deliberately
 * near-trivial (min 1 row): in the pathological close-up regime a
 * worst-case device can spend whole seconds per few thousand pixels, and
 * the probe is the one strip rendered before ANY measurement exists — it
 * must be a bounded submission on the devices this planner exists for. The
 * measurement it returns calibrates every strip after it. */
export const STRIP_PROBE_FRACTION = 1 / 256;

/** Measured GPU time (ms) each strip aims for. Low enough to stay far from
 * any watchdog and to keep the async settle path's frames responsive; high
 * enough that `gl.finish()` pipeline bubbles stay a small fraction of the
 * work. */
export const STRIP_TARGET_MS = 75;

/** Per-step growth cap on strip rows. A strip measuring near-zero (a light
 * system, or a timer quantization fluke) may grow the next strip at most
 * this much — so one under-measurement can overshoot the target by at most
 * this factor (~600ms at the current target), and reaching full-frame
 * strips on a light system still takes only a few steps. */
export const STRIP_MAX_GROWTH = 8;

export interface StripPlanner {
  /** True once every row has been handed out. */
  readonly done: boolean;
  /**
   * The next strip to render, sized from `prevMs` — the measured cost of
   * the PREVIOUS strip (null for the first call, or when the caller could
   * not measure: the planner then repeats the previous size rather than
   * guessing). Returns null once all rows are planned.
   */
  next(prevMs: number | null): { y: number; rows: number } | null;
}

/** Create a planner over `totalRows` rows (a non-positive total is
 * immediately done). */
export function createStripPlanner(totalRows: number): StripPlanner {
  const total = Math.max(0, Math.floor(totalRows));
  let y = 0;
  let lastRows = 0;

  return {
    get done(): boolean {
      return y >= total;
    },

    next(prevMs: number | null): { y: number; rows: number } | null {
      if (y >= total) return null;
      let rows: number;
      if (lastRows === 0) {
        rows = Math.max(1, Math.round(total * STRIP_PROBE_FRACTION));
      } else {
        const scale =
          prevMs !== null && prevMs > 0
            ? Math.min(STRIP_TARGET_MS / prevMs, STRIP_MAX_GROWTH)
            : 1;
        rows = Math.max(1, Math.round(lastRows * scale));
      }
      rows = Math.min(rows, total - y);
      const strip = { y, rows };
      y += rows;
      lastRows = rows;
      return strip;
    },
  };
}
