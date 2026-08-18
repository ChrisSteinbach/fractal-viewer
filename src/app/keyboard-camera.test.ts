import {
  cameraKeyAction,
  KEY_DOLLY_STEP,
  KEY_ROTOR_STEP_RAD,
  KEY_SLICE_STEP,
  KEY_STEP_PX,
} from "./keyboard-camera";
import type { CameraKeyContext, CameraKeyInput } from "./keyboard-camera";

function press(
  key: string,
  overrides: Partial<CameraKeyInput> = {},
): CameraKeyInput {
  return { key, shiftKey: false, withChordModifier: false, ...overrides };
}

const FLAT: CameraKeyContext = { fourD: false, sliceOn: false };
const FOUR_D: CameraKeyContext = { fourD: true, sliceOn: false };
const FOUR_D_SLICED: CameraKeyContext = { fourD: true, sliceOn: true };

describe("cameraKeyAction", () => {
  describe("orbit — the plain drag, one key at a time", () => {
    it("maps plain arrows to drag deltas with the drag's own signs", () => {
      expect(cameraKeyAction(press("ArrowRight"), FLAT)).toEqual({
        kind: "orbit",
        dx: KEY_STEP_PX,
        dy: 0,
      });
      expect(cameraKeyAction(press("ArrowLeft"), FLAT)).toEqual({
        kind: "orbit",
        dx: -KEY_STEP_PX,
        dy: 0,
      });
      expect(cameraKeyAction(press("ArrowUp"), FLAT)).toEqual({
        kind: "orbit",
        dx: 0,
        dy: -KEY_STEP_PX,
      });
      expect(cameraKeyAction(press("ArrowDown"), FLAT)).toEqual({
        kind: "orbit",
        dx: 0,
        dy: KEY_STEP_PX,
      });
    });

    it("orbits with plain arrows in the 4D view too — the plain drag orbits there as well", () => {
      expect(cameraKeyAction(press("ArrowLeft"), FOUR_D)).toEqual({
        kind: "orbit",
        dx: -KEY_STEP_PX,
        dy: 0,
      });
    });
  });

  describe("dolly — the wheel notch", () => {
    it("zooms in on + (and its unshifted twin =)", () => {
      expect(cameraKeyAction(press("+"), FLAT)).toEqual({
        kind: "dolly",
        factor: 1 / KEY_DOLLY_STEP,
      });
      expect(cameraKeyAction(press("="), FLAT)).toEqual({
        kind: "dolly",
        factor: 1 / KEY_DOLLY_STEP,
      });
    });

    it("zooms out on - (and its shifted twin _), the exact reciprocal so a round trip returns home", () => {
      expect(cameraKeyAction(press("-"), FLAT)).toEqual({
        kind: "dolly",
        factor: KEY_DOLLY_STEP,
      });
      expect(cameraKeyAction(press("_"), FLAT)).toEqual({
        kind: "dolly",
        factor: KEY_DOLLY_STEP,
      });
    });
  });

  describe("rotor — the Shift-drag and Shift-wheel, 4D only", () => {
    it("Shift+horizontal arrows turn xw with the drag's sign convention", () => {
      expect(
        cameraKeyAction(press("ArrowRight", { shiftKey: true }), FOUR_D),
      ).toEqual({ kind: "rotor", xw: KEY_ROTOR_STEP_RAD, yw: 0, zw: 0 });
      expect(
        cameraKeyAction(press("ArrowLeft", { shiftKey: true }), FOUR_D),
      ).toEqual({ kind: "rotor", xw: -KEY_ROTOR_STEP_RAD, yw: 0, zw: 0 });
    });

    it("Shift+vertical arrows turn yw with the drag's screen-y flip (up is +yw)", () => {
      expect(
        cameraKeyAction(press("ArrowUp", { shiftKey: true }), FOUR_D),
      ).toEqual({ kind: "rotor", xw: 0, yw: KEY_ROTOR_STEP_RAD, zw: 0 });
      expect(
        cameraKeyAction(press("ArrowDown", { shiftKey: true }), FOUR_D),
      ).toEqual({ kind: "rotor", xw: 0, yw: -KEY_ROTOR_STEP_RAD, zw: 0 });
    });

    it("Shift+PageUp/PageDown turn zw with the Shift-wheel's scroll-up-is-+zw convention", () => {
      expect(
        cameraKeyAction(press("PageUp", { shiftKey: true }), FOUR_D),
      ).toEqual({ kind: "rotor", xw: 0, yw: 0, zw: KEY_ROTOR_STEP_RAD });
      expect(
        cameraKeyAction(press("PageDown", { shiftKey: true }), FOUR_D),
      ).toEqual({ kind: "rotor", xw: 0, yw: 0, zw: -KEY_ROTOR_STEP_RAD });
    });

    it("refuses rotor keys in a flat view — exactly the pointer gestures' fourDView gate", () => {
      expect(
        cameraKeyAction(press("ArrowRight", { shiftKey: true }), FLAT),
      ).toBeNull();
      expect(
        cameraKeyAction(press("PageUp", { shiftKey: true }), FLAT),
      ).toBeNull();
    });

    it("plain PageUp/PageDown map to nothing — only the Shift chord is a rotor gesture", () => {
      expect(cameraKeyAction(press("PageUp"), FOUR_D)).toBeNull();
      expect(cameraKeyAction(press("PageDown"), FOUR_D_SLICED)).toBeNull();
    });

    it("the rotor step is the SAME pixel travel as the orbit step through ROTATE_SPEED — the two inputs feel identical by construction", () => {
      expect(KEY_ROTOR_STEP_RAD).toBeCloseTo(KEY_STEP_PX * 0.01, 12);
    });
  });

  describe("slice — the [ / ] nudge", () => {
    it("nudges the w-slice center only while 4D AND the slice is on", () => {
      expect(cameraKeyAction(press("]"), FOUR_D_SLICED)).toEqual({
        kind: "slice",
        delta: KEY_SLICE_STEP,
      });
      expect(cameraKeyAction(press("["), FOUR_D_SLICED)).toEqual({
        kind: "slice",
        delta: -KEY_SLICE_STEP,
      });
    });

    it("refuses the nudge with the slice off — it would edit an invisible number", () => {
      expect(cameraKeyAction(press("["), FOUR_D)).toBeNull();
    });

    it("refuses the nudge in a flat view", () => {
      expect(cameraKeyAction(press("]"), FLAT)).toBeNull();
    });
  });

  describe("Space — the shared auto-motion toggle", () => {
    it("toggles in both dimensions (orbit in 3D, tumble in 4D — one preference, fr-0ya)", () => {
      expect(cameraKeyAction(press(" "), FLAT)).toEqual({
        kind: "toggleMotion",
      });
      expect(cameraKeyAction(press(" "), FOUR_D)).toEqual({
        kind: "toggleMotion",
      });
    });
  });

  describe("refusals", () => {
    it("refuses every chorded key outright — Ctrl/Alt/Meta arrows are browser and OS shortcuts", () => {
      expect(
        cameraKeyAction(press("ArrowLeft", { withChordModifier: true }), FLAT),
      ).toBeNull();
      expect(
        cameraKeyAction(press(" ", { withChordModifier: true }), FOUR_D),
      ).toBeNull();
      expect(
        cameraKeyAction(press("+", { withChordModifier: true }), FOUR_D_SLICED),
      ).toBeNull();
    });

    it("returns null for keys outside the vocabulary, so the caller never preventDefaults them", () => {
      expect(cameraKeyAction(press("a"), FLAT)).toBeNull();
      expect(cameraKeyAction(press("Escape"), FOUR_D_SLICED)).toBeNull();
      expect(cameraKeyAction(press("Tab"), FLAT)).toBeNull();
      expect(cameraKeyAction(press("Home"), FOUR_D)).toBeNull();
    });
  });
});
