/**
 * The arithmetic behind a capture's cost memory (fr-2q01), pulled out of
 * `scene.ts` so it can be tested without a WebGL context.
 *
 * The solid render's Save-PNG shows an INDETERMINATE modal — one
 * synchronous raymarch cannot report coverage mid-draw and cannot be
 * interrupted — so the only decision left is whether it appears at once
 * or waits out the grace period. That used to be decided by
 * `exportScale > 1`, a heuristic with no view of the viewport: it flashed
 * the modal for ~270ms over a 320x240 scale-2 export that finished in
 * 274ms, while being right about the 1920x1080 case it was written for.
 *
 * Two expressions replace it — remember a completed capture's per-pixel
 * cost, then scale it by the next export's pixel count. Both live here;
 * `scene.ts` keeps the Three.js wiring, the clock and the invalidation
 * rule (see `solidCapturePxCostMs`, whose doc carries the argument for
 * what makes a reading stale).
 */

/**
 * A completed capture's per-pixel cost, or null when the measurement
 * cannot mean anything.
 *
 * Null rather than a number for a non-finite or negative wall (a clock
 * that went backwards) and for a pixel count of zero or less, because the
 * caller's contract is "null = no evidence" and a poisoned reading is
 * worse than none: it would survive until the next capture and decide a
 * modal on arithmetic nobody can defend. A zero-millisecond wall IS
 * meaningful and is kept — a capture too fast for the clock's resolution
 * is exactly the case that should never show a modal.
 */
export function solidCaptureMsPerPx(
  elapsedMs: number,
  pixels: number,
): number | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  if (!Number.isFinite(pixels) || pixels <= 0) return null;
  return elapsedMs / pixels;
}

/**
 * What a capture over `pixels` would cost at `msPerPx`, or null when
 * there is no evidence — null propagates so the caller's "no measurement
 * yet" path is one branch rather than a sentinel comparison.
 *
 * Linear in the pixel count, which is what the march is: the same rays,
 * more of them. The capture's FIXED part — the drawing-buffer resize, the
 * encoder's setup — rides inside the measured ms/px and is therefore
 * charged per pixel, so a 1x measurement predicting a 4x export reads
 * slightly HIGH. That is the harmless direction: it opens a modal the
 * grace period would have opened a moment later anyway, where
 * under-predicting is what leaves a multi-second export silent.
 */
export function predictCaptureMs(
  msPerPx: number | null,
  pixels: number,
): number | null {
  if (msPerPx === null) return null;
  if (!Number.isFinite(pixels) || pixels <= 0) return null;
  return msPerPx * pixels;
}
