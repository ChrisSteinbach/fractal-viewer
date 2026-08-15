/**
 * fr-xu4u: keep panel scrolling from editing sliders — by never editing them.
 *
 * The panel's range inputs get `touch-action: pan-y` (style.css), so a
 * vertical touch drag that happens to start on a slider scrolls the panel —
 * but Blink commits the slider's tap-jump before anyone can know whether the
 * gesture is a slide or a scroll. The result is the exact mobile complaint:
 * the panel scrolls AND the value silently jumps to wherever the finger first
 * landed on the track.
 *
 * fr-zoi REPAIRED that after the fact — snapshot the value on pointerdown,
 * restore it once the browser claimed the gesture for panning. Measured
 * against real Chromium (scripts/panel-touch-scroll.verify.mjs), the repair
 * still let the jump commit mid-gesture (fogSlider 1 -> 1.25 from a centre
 * start, 1 -> 0 from a left-edge start, its [0, 2.5] track position exactly)
 * and fired `input` TWICE — once for the jump, once for the restore. Both
 * trips run the real edit pipeline: edit-session burst coalescing, a possible
 * history checkpoint, a cloud regeneration request — for a gesture the user
 * meant as a scroll. So the guard PREVENTS the jump instead.
 *
 * WHICH DEFAULT ACTION THE JUMP IS, measured rather than assumed — fr-zoi's
 * own doc said pointerdown, and that is wrong. Under a CDP touch swipe the
 * value is still untouched when `touchstart` is DISPATCHED and already jumped
 * by the first `pointermove`, so the jump is the TOUCHSTART default action
 * (Blink's SliderContainerElement::HandleTouchEvent), and `preventDefault()`
 * on pointerdown does not stop it — measured, with the cancel landing
 * (`defaultPrevented` true at the document) and the value moving 1 -> 1.25
 * anyway. Four candidate suppressions were measured against one vertical
 * swipe; only the last does the job:
 *
 * - `preventDefault()` on touchstart: kills the jump AND the pan (scroll
 *   delta 0px where every other arm scrolled -135px). Cancelling a touchstart
 *   cancels scrolling with it, which is the whole reason `touch-action`
 *   exists.
 * - `stopImmediatePropagation()` on touchstart: no effect (jump 1 -> 1.25).
 *   Blink runs default handlers after dispatch regardless of propagation.
 * - `pointer-events: none` on the thumb and track pseudo-elements: no effect.
 *   The slider CONTAINER handles the touch, not the thumb.
 * - `disabled` flipped on for the length of that one handler: jump gone, pan
 *   intact (-135px), zero events. `IsDisabledFormControl()` is the touch
 *   handler's own first check, and pointerdown is dispatched BEFORE
 *   touchstart, so the flip is already visible to it.
 *
 * Hence `suppress()`. The flip is undone in a `requestAnimationFrame`
 * callback, which runs before that frame paints — so the disabled look never
 * reaches the screen, and the window is one frame rather than the whole
 * gesture. Blink does not re-arm its own slide when the input comes back
 * (measured: an L-shaped gesture — scroll 150px, then 120px sideways — leaves
 * the value untouched and fires nothing, where the same gesture on the
 * unguarded build jumps at touchstart).
 *
 * The flip is also the WHOLE mechanism: an A/B of the same four gestures
 * against builds with and without a `preventDefault()` on pointerdown came out
 * identical to the event (tap and drag both 0 `mousedown`, 0 `click`, same
 * values), so the cancel is not here. Suppressing the compatibility mouse
 * events a tap synthesizes sounds like a second door into the native drag,
 * and measurably is not one.
 *
 * Suppressing the jump takes the native touch drag with it, so the guard now
 * OWNS that drag:
 *
 * - `pointerdown` (delegated, so the dynamically-built transform-editor
 *   sliders are covered too) captures the pointer and suppresses the jump.
 * - Once the gesture crosses SLIDE_SLOP_PX of horizontal travel, every move
 *   writes whatever value the pointer's x names on the track and fires
 *   `input` per actual change — the event Ui.bind listens to, so a touch drag
 *   reaches the same scalar/editor pipeline a mouse drag does. `pointerup`
 *   after any write fires the trailing `change` that a native drag ends with:
 *   fr-2c27's commit-on-release specs hang off it (numPointsSlider defers its
 *   whole regeneration there), and assigning `value` from script fires
 *   nothing by itself. Measured on the same 200px drag: guard-driven 10
 *   `input` + 1 `change` against the native 16 + 2, landing one step apart
 *   (2.10 against 2.15 — the thumb inset valueAt() documents).
 * - A gesture that never crosses that slop leaves the value untouched
 *   entirely — zero events, no pipeline trip. Tap-to-set is the price, and
 *   the point: on a panel of full-width sliders a tap that lands on one is a
 *   scroll that has not moved yet far more often than it is an edit, and a
 *   drag still reaches any value the tap could have.
 *
 * Mouse pointers are ignored outright: a mouse drag can never become a
 * scroll, so the native click-to-jump and drag stay untouched on desktop
 * (measured identical to the unguarded build, 2.15 at 6 `input` + 1 `change`).
 */

/** Horizontal travel that turns a touch gesture into a slide. */
const SLIDE_SLOP_PX = 8;

/** HTML's own defaults for a range input whose attribute is absent or
 * unparseable. */
const DEFAULT_MIN = 0;
const DEFAULT_MAX = 100;
const DEFAULT_STEP = 1;

interface ActiveGesture {
  slider: HTMLInputElement;
  /** The one pointer driving this gesture; later fingers are ignored. */
  pointerId: number;
  startX: number;
  /** Set once the gesture crosses SLIDE_SLOP_PX — from there on it writes. */
  sliding: boolean;
  /** Set once a write actually landed — drives the trailing "change". */
  edited: boolean;
  /** Set while this guard, and not the app, is holding the slider disabled. */
  suppressed: boolean;
}

/** A range attribute as a number, falling back when it is absent or not a
 * valid floating-point number (`Number("")` is 0, hence the emptiness test). */
function attrNumber(raw: string, fallback: number): number {
  const parsed = Number(raw);
  return raw.trim() !== "" && Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The value that client-x `x` names on `slider`'s track — quantized to the
 * slider's own `step` from its `min`, clamped to `[min, max]`, and formatted
 * as the attribute string. Null when there is nothing to map onto (a
 * zero-width or unmeasured rect).
 *
 * The track is approximated as the slider's whole border box. The real one is
 * inset by half a thumb width at each end, because it is the thumb's CENTRE
 * that carries the value — but the panel leaves the thumb to the UA
 * (`accent-color` and nothing else, style.css), so its width is not knowable
 * from script and a pixel guess read off one browser's default stylesheet
 * would be wrong on every other engine. The approximation costs
 * `thumbWidth * (fraction - 0.5)`: zero at mid-track, at most half a thumb at
 * the ends — where the value clamps to min/max anyway, so both extremes stay
 * exactly reachable, which is the property worth keeping. Measured against
 * the native drag it replaces, that is one step of 0.05 at fraction ~0.73 of
 * a panel-width fog slider.
 */
function valueAt(slider: HTMLInputElement, x: number): string | null {
  const rect = slider.getBoundingClientRect();
  if (!(rect.width > 0)) return null;

  const min = attrNumber(slider.min, DEFAULT_MIN);
  // A max below min collapses the range onto min, per the HTML spec.
  const max = Math.max(attrNumber(slider.max, DEFAULT_MAX), min);
  // step="any" means continuous — no quantization at all. Anything else that
  // is not a positive number falls back to the spec default.
  const stepAttr = slider.step.trim().toLowerCase();
  const parsedStep = attrNumber(stepAttr, DEFAULT_STEP);
  const step = stepAttr === "any" ? 0 : parsedStep > 0 ? parsedStep : 1;

  // Left-to-right only: nothing in the app sets `dir` or `direction`
  // (index.html, style.css), so an RTL branch here would be dead code.
  const fraction = Math.min(Math.max((x - rect.left) / rect.width, 0), 1);
  const raw = min + fraction * (max - min);
  const quantized =
    step > 0 ? min + Math.round((raw - min) / step) * step : raw;
  const clamped = Math.min(Math.max(quantized, min), max);
  // toPrecision drops the binary-float noise the quantization introduces
  // (step 0.05 otherwise lands "1.2000000000000002" in the document).
  return String(Number(clamped.toPrecision(12)));
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

  /** Hide the slider from the touchstart default handler about to run — see
   * the module doc for why this, and why one frame is long enough. */
  const suppress = (gesture: ActiveGesture): void => {
    gesture.slider.disabled = true;
    gesture.suppressed = true;
    requestAnimationFrame(() => release(gesture));
  };

  /** Undo `suppress`, once, and never for a slider the app itself disabled. */
  const release = (gesture: ActiveGesture): void => {
    if (!gesture.suppressed) return;
    gesture.suppressed = false;
    gesture.slider.disabled = false;
  };

  /** Write the value the pointer is over, if it differs from the current one
   * (a drag along one step must not spam the edit pipeline). */
  const write = (gesture: ActiveGesture, x: number): void => {
    const next = valueAt(gesture.slider, x);
    if (next === null || gesture.slider.value === next) return;
    gesture.slider.value = next;
    gesture.edited = true;
    gesture.slider.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const end = (): void => {
    if (!active) return;
    const gesture = active;
    active = null;
    // Belt and braces: the rAF has long since run on any frame that painted,
    // but a gesture that ends while frames are throttled must not leave the
    // control disabled.
    release(gesture);
    if (gesture.edited) {
      gesture.slider.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  panel.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse") return;
      const slider = sliderFrom(e.target);
      if (!slider || slider.disabled) return;
      active = {
        slider,
        pointerId: e.pointerId,
        startX: e.clientX,
        sliding: false,
        edited: false,
        suppressed: false,
      };
      // Keeps the rest of the gesture addressed to the slider once the finger
      // leaves it. Optional call: jsdom has no pointer capture, and without
      // it the delegated listeners still see every move over the panel.
      slider.setPointerCapture?.(e.pointerId);
      suppress(active);
    },
    // Nothing here cancels anything: the jump is suppressed by `suppress`,
    // and a cancelled pointerdown was measured to buy nothing (module doc).
    { passive: true },
  );

  panel.addEventListener("pointermove", (e) => {
    if (!active || e.pointerId !== active.pointerId) return;
    if (!active.sliding) {
      if (Math.abs(e.clientX - active.startX) < SLIDE_SLOP_PX) return;
      active.sliding = true;
    }
    write(active, e.clientX);
  });

  panel.addEventListener("pointerup", end);
  // Chromium's "the browser claimed this gesture for panning" signal — the
  // scroll case, which by construction has written nothing.
  panel.addEventListener("pointercancel", end);
}
