/**
 * The canvas keyboard vocabulary (fr-vja8.37): a pure map from a keydown on
 * the FOCUSED canvas to a typed camera/view action, so the viewpoint —
 * 3D orbit and, per the dimensional-parity rule, the 4D rotor/slice — is
 * reachable without a pointer (WCAG 2.1.1; the document was always
 * keyboard-editable through the panel sliders, but directed VIEWPOINT
 * control had no pointer-free path at all).
 *
 * Pure and DOM-free, tested exhaustively; `interactions.ts` owns the one
 * thin listener that calls this and applies the action. Scoping the
 * listener to the canvas element (focusable since this feature) is the
 * whole collision story: unmodified arrows on a focused `<input
 * type=range>` adjust the slider natively and Space activates a focused
 * button — binding globally would need a target guard stricter than the
 * undo handler's, where a canvas-scoped listener needs none.
 *
 * The vocabulary deliberately MIRRORS the pointer gestures rather than
 * inventing a second grammar: plain arrows = the plain drag (orbit),
 * Shift+arrows = the Shift-drag (rotor xw/yw), Shift+PageUp/Down = the
 * Shift-wheel (rotor zw), +/- = the wheel (dolly, same 1.1 notch), [ / ] =
 * the w-slice slider (same 0.01-per-step grain, x2 for key travel), Space =
 * the auto-motion toggle both panel checkboxes drive (the 3D orbit / 4D
 * tumble shared preference, fr-0ya). Rotor/slice actions are only produced
 * while the view is non-flat, exactly as the pointer gestures gate on
 * `fourDView()` — in a flat view those keys fall through unhandled (and
 * unprevented, so the page keeps its own semantics for them).
 *
 * A held key repeats at the OS rate, so per-press steps are sized for
 * continuous feel under repeat: {@link KEY_STEP_PX} matches ~28 px of drag
 * per repeat (at `ROTATE_SPEED` 0.01 rad/px that is ~0.28 rad/s at a
 * typical 30 Hz repeat — the same order as a slow deliberate drag), and the
 * rotor step derives from the SAME pixel constant through the SAME
 * `ROTATE_SPEED`, so orbiting and w-turning feel identical, which is the
 * point of mirroring the gestures.
 */
import { ROTATE_SPEED } from "./orbit";

/** Screen-pixels-of-drag equivalent applied per keypress (and per key
 * repeat) — the one feel constant both the orbit and rotor steps derive
 * from. */
export const KEY_STEP_PX = 28;

/** Radians per keypress for the rotor planes: the same travel a
 * {@link KEY_STEP_PX}-pixel Shift-drag produces. */
export const KEY_ROTOR_STEP_RAD = KEY_STEP_PX * ROTATE_SPEED;

/** Dolly factor per keypress — one wheel notch exactly (interactions.ts's
 * 1.1/0.9 asymmetry is the wheel's own; keys use the reciprocal pair so a
 * +/- round trip returns to the starting radius). */
export const KEY_DOLLY_STEP = 1.1;

/** Normalized rotated-w units per slice keypress — two ticks of the panel
 * slider's own 0.01 step, so key travel is usable under repeat while the
 * slider keeps the finer grain. */
export const KEY_SLICE_STEP = 0.02;

/** What the caller must know about the view for the mapping to gate the 4D
 * half exactly as the pointer gestures do. */
export interface CameraKeyContext {
  /** The view is showing the 4D projection (main.ts's derived `viewIs4D`). */
  fourD: boolean;
  /** The w-slice is enabled — [ / ] nudge its center only then; nudging a
   * disabled slice would edit an invisible number. */
  sliceOn: boolean;
}

export type CameraKeyAction =
  /** Orbit by a screen-space drag delta (feed to `OrbitCamera.rotate`). */
  | { kind: "orbit"; dx: number; dy: number }
  /** Multiply the orbit radius (feed to `OrbitCamera.dolly`). */
  | { kind: "dolly"; factor: number }
  /** Turn the 4D view's rotor planes, radians (the `onFourDRotate` wire). */
  | { kind: "rotor"; xw: number; yw: number; zw: number }
  /** Nudge the w-slice center by a normalized delta. */
  | { kind: "slice"; delta: number }
  /** Toggle the shared auto-motion preference (orbit in 3D, tumble in 4D). */
  | { kind: "toggleMotion" };

/** The subset of a KeyboardEvent the mapping reads — structural, so tests
 * need no DOM. */
export interface CameraKeyInput {
  key: string;
  shiftKey: boolean;
  /** Any of Ctrl/Alt/Meta held: the mapping refuses the chord outright so
   * it can never shadow a browser or OS shortcut (Ctrl+ArrowLeft is
   * word-wise caret movement, Alt+ArrowLeft is history back...). */
  withChordModifier: boolean;
  /** The event is an OS key-repeat of a still-held key. Repeat IS the
   * continuous-motion feature for every movement key — but a repeating
   * TOGGLE would flip auto-motion at the repeat rate (a flicker storm
   * writing the viewer pref dozens of times a second), so Space acts on
   * the initial press only. */
  repeat: boolean;
}

/**
 * Map one keydown to its action, or `null` for "not ours" — the caller
 * preventDefaults exactly when an action is returned, so unhandled keys
 * keep their page semantics (arrows scroll, Space scrolls) and handled
 * ones do not.
 */
export function cameraKeyAction(
  input: CameraKeyInput,
  ctx: CameraKeyContext,
): CameraKeyAction | null {
  if (input.withChordModifier) return null;
  const { key, shiftKey } = input;

  // Initial press only — see CameraKeyInput.repeat. Returning null for the
  // repeats leaves them unprevented, which is safe here: the page cannot
  // scroll (body is overflow: hidden), so a held Space has no default
  // action to suppress.
  if (key === " ") return input.repeat ? null : { kind: "toggleMotion" };

  // The wheel pair. Shifted "=" produces "+" on most layouts; accept both
  // so the user need not reason about which physical key is "plus".
  if (key === "+" || key === "=")
    return { kind: "dolly", factor: 1 / KEY_DOLLY_STEP };
  if (key === "-" || key === "_")
    return { kind: "dolly", factor: KEY_DOLLY_STEP };

  if (shiftKey && ctx.fourD) {
    // The Shift-drag one key at a time. Signs mirror moveCamera's mapping:
    // dragging toward +screen-x rolls +x into +w (ArrowRight = +xw), and
    // the screen-y flip that gives drag-up +yw makes ArrowUp +yw here.
    if (key === "ArrowLeft")
      return { kind: "rotor", xw: -KEY_ROTOR_STEP_RAD, yw: 0, zw: 0 };
    if (key === "ArrowRight")
      return { kind: "rotor", xw: KEY_ROTOR_STEP_RAD, yw: 0, zw: 0 };
    if (key === "ArrowUp")
      return { kind: "rotor", xw: 0, yw: KEY_ROTOR_STEP_RAD, zw: 0 };
    if (key === "ArrowDown")
      return { kind: "rotor", xw: 0, yw: -KEY_ROTOR_STEP_RAD, zw: 0 };
    // The Shift-wheel: scroll-up rolls +z into +w, so PageUp is +zw.
    if (key === "PageUp")
      return { kind: "rotor", xw: 0, yw: 0, zw: KEY_ROTOR_STEP_RAD };
    if (key === "PageDown")
      return { kind: "rotor", xw: 0, yw: 0, zw: -KEY_ROTOR_STEP_RAD };
  }

  if (!shiftKey) {
    // The plain drag. orbit.rotate() SUBTRACTS dx from theta, so a
    // positive dx pans the view left-to-right exactly as a rightward drag
    // does; ArrowRight hands the camera the drag a rightward pull gives.
    if (key === "ArrowLeft") return { kind: "orbit", dx: -KEY_STEP_PX, dy: 0 };
    if (key === "ArrowRight") return { kind: "orbit", dx: KEY_STEP_PX, dy: 0 };
    if (key === "ArrowUp") return { kind: "orbit", dx: 0, dy: -KEY_STEP_PX };
    if (key === "ArrowDown") return { kind: "orbit", dx: 0, dy: KEY_STEP_PX };
  }

  if (ctx.fourD && ctx.sliceOn) {
    if (key === "[") return { kind: "slice", delta: -KEY_SLICE_STEP };
    if (key === "]") return { kind: "slice", delta: KEY_SLICE_STEP };
  }

  return null;
}
