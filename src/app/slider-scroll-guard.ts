/**
 * fr-zoi: keep panel scrolling from editing sliders.
 *
 * The panel's range inputs get `touch-action: pan-y` (style.css), so a
 * vertical touch drag that happens to start on a slider scrolls the panel —
 * but Blink commits the slider's tap-jump as the POINTERDOWN default action,
 * before anyone can know whether the gesture is a slide or a scroll. The
 * result (verified against real Chromium under the fr-zoi touch harness) is
 * the exact mobile complaint: the panel scrolls AND the value silently jumps
 * to wherever the finger first landed on the track.
 *
 * This guard undoes that jump once the gesture reveals itself as a scroll:
 *
 * - `pointerdown` (delegated, so the dynamically-built transform-editor
 *   sliders are covered too) runs during dispatch — BEFORE the default
 *   action moves the thumb — and snapshots the pre-gesture value.
 * - `pointercancel` is Chromium's "the browser claimed this gesture for
 *   panning" signal (it fires even when the panel has no room to scroll):
 *   restore the snapshot and re-fire `input` so app state resyncs exactly
 *   like a user edit.
 * - `pointerup` ends a genuine slide or tap — the jump was the intent, keep
 *   it — EXCEPT a gesture that never left the vertical axis, which was a
 *   scroll attempt on an engine that ends pans without `pointercancel`.
 *
 * Mouse pointers are ignored outright: a mouse drag can never become a
 * scroll, so the native click-to-jump behavior stays untouched on desktop.
 */

/** A slide must move at least this many px horizontally to count as one. */
const SLIDE_SLOP_PX = 8;

/** A vertical move shorter than this is a tap, not a scroll attempt. */
const SCROLL_INTENT_PX = 12;

interface ActiveGesture {
  slider: HTMLInputElement;
  /** The value before the pointerdown default action jumped the thumb. */
  value: string;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

/** Install the guard on the panel root. Idempotent per element in practice —
 * call it once from Ui's constructor. */
export function installSliderScrollGuard(panel: HTMLElement): void {
  let active: ActiveGesture | null = null;

  const sliderFrom = (target: EventTarget | null): HTMLInputElement | null => {
    if (!(target instanceof Element)) return null;
    const el = target.closest('input[type="range"]');
    return el instanceof HTMLInputElement ? el : null;
  };

  const restore = (): void => {
    if (!active) return;
    const { slider, value } = active;
    active = null;
    if (slider.value === value) return;
    slider.value = value;
    // Sliders report edits via "input" (see Ui.bind), so re-firing it routes
    // the restore through the same scalar/editor pipeline as the jump did.
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  };

  /** Gesture over without a pointercancel: keep a slide/tap, undo a
   * pure-vertical scroll attempt. */
  const finish = (): void => {
    if (!active) return;
    const adx = Math.abs(active.lastX - active.startX);
    const ady = Math.abs(active.lastY - active.startY);
    if (adx < SLIDE_SLOP_PX && ady > SCROLL_INTENT_PX) restore();
    else active = null;
  };

  panel.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    const slider = sliderFrom(e.target);
    if (!slider) return;
    active = {
      slider,
      value: slider.value,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
    };
  });

  panel.addEventListener(
    "touchmove",
    (e) => {
      const touch = e.touches[0];
      if (!active || !touch) return;
      active.lastX = touch.clientX;
      active.lastY = touch.clientY;
    },
    { passive: true },
  );

  panel.addEventListener("pointercancel", restore);
  panel.addEventListener("pointerup", finish);
  // Safety net: some engines skip pointerup after a claimed pan; touchend
  // still fires. finish() is a no-op if pointerup already ran.
  panel.addEventListener("touchend", finish, { passive: true });
}
