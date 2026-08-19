// @vitest-environment jsdom
import { attachInteractions, resizeGuideComponent } from "./interactions";
import type { InteractionsHandle } from "./interactions";
import { MIN_GUIDE_SCALE, MAX_GUIDE_SCALE } from "./constants";
import type { OrbitCamera } from "./orbit";
import type { FractalScene } from "./scene";

describe("resizeGuideComponent", () => {
  it("multiplies a positive component by the factor", () => {
    expect(resizeGuideComponent(0.5, 1.05)).toBeCloseTo(0.525);
  });

  it("preserves a mirrored (negative) component's sign", () => {
    expect(resizeGuideComponent(-0.5, 1.05)).toBeCloseTo(-0.525);
  });

  it("clamps the grown magnitude to the guide ceiling on both signs", () => {
    expect(resizeGuideComponent(1.95, 1.2)).toBe(MAX_GUIDE_SCALE);
    expect(resizeGuideComponent(-1.95, 1.2)).toBe(-MAX_GUIDE_SCALE);
  });

  it("clamps the shrunk magnitude to the guide floor on both signs", () => {
    expect(resizeGuideComponent(0.06, 0.5)).toBe(MIN_GUIDE_SCALE);
    expect(resizeGuideComponent(-0.06, 0.5)).toBe(-MIN_GUIDE_SCALE);
  });

  it("grows a zero component to the positive floor", () => {
    expect(resizeGuideComponent(0, 1.05)).toBe(MIN_GUIDE_SCALE);
  });
});

/** attachInteractions against a minimal fake scene — camera mode by default,
 * or a transform drag when `selected` names an index: the paths under test
 * never reach the raycaster, the camera or a real guide cube (guideCube
 * yields null, so a transform drag latches but edits nothing), so a bare
 * canvas element and a spy orbit are the whole world. Listeners attach for
 * the page lifetime by design; each call gets its own closure, so stacking
 * them across tests is harmless. */
function setupInteractions(
  opts: {
    selected?: number;
    frozen?: boolean;
    fourD?: boolean;
    sliceOn?: boolean;
  } = {},
): {
  canvas: HTMLCanvasElement;
  rotate: ReturnType<typeof vi.fn>;
  dolly: ReturnType<typeof vi.fn>;
  onFourDRotate: ReturnType<typeof vi.fn>;
  onFourDSliceNudge: ReturnType<typeof vi.fn>;
  onToggleAutoMotion: ReturnType<typeof vi.fn>;
  handle: InteractionsHandle;
} {
  document.body.replaceChildren();
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const rotate = vi.fn();
  const dolly = vi.fn();
  const onFourDRotate = vi.fn();
  const onFourDSliceNudge = vi.fn();
  const onToggleAutoMotion = vi.fn();
  const orbit = {
    target: [0, 0, 0],
    rotate,
    panBy: vi.fn(),
    dolly,
  } as unknown as OrbitCamera;
  const handle = attachInteractions(
    { canvas, camera: {}, guideCube: () => null } as unknown as FractalScene,
    orbit,
    {
      selectedTransform: () => opts.selected ?? null,
      onTransformChange: vi.fn(),
      frozen: () => opts.frozen ?? false,
      fourDView: () => opts.fourD ?? false,
      onFourDRotate,
      fourDSliceOn: () => opts.sliceOn ?? false,
      onFourDSliceNudge,
      onToggleAutoMotion,
    },
  );
  return {
    canvas,
    rotate,
    dolly,
    onFourDRotate,
    onFourDSliceNudge,
    onToggleAutoMotion,
    handle,
  };
}

// jsdom has no TouchEvent constructor; the handlers only read `touches` off
// the event, so a generic Event with the list assigned behaves identically.
function touchEvent(
  type: string,
  touches: { clientX: number; clientY: number }[],
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { touches });
  return event;
}

describe("attachInteractions mouse latch release", () => {
  it("releases the drag latch on window blur so auto-orbit can resume (focus steal mid-hold)", () => {
    const { canvas, handle } = setupInteractions();
    canvas.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 50 }),
    );
    expect(handle.gestureActive()).toBe(true);

    window.dispatchEvent(new Event("blur"));

    expect(handle.gestureActive()).toBe(false);
  });

  it("keeps a normal drag latched and rotating while the button stays down", () => {
    const { canvas, rotate, handle } = setupInteractions();
    canvas.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 50 }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 1, clientX: 60, clientY: 55 }),
    );

    expect(rotate).toHaveBeenCalledWith(10, 5);
    expect(handle.gestureActive()).toBe(true);

    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(handle.gestureActive()).toBe(false);
  });

  it("drops a latch that survived a missed mouseup instead of orbiting a button-less mouse", () => {
    const { canvas, rotate, handle } = setupInteractions();
    canvas.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 50 }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 0, clientX: 200, clientY: 200 }),
    );

    expect(rotate).not.toHaveBeenCalled();
    expect(handle.gestureActive()).toBe(false);
  });

  it("releases a mouse transform-drag latch on a button-less move instead of tracking the hover", () => {
    const { canvas, handle } = setupInteractions({ selected: 0 });
    canvas.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, clientX: 50, clientY: 50 }),
    );
    expect(handle.gestureActive()).toBe(true);

    document.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 0, clientX: 120, clientY: 90 }),
    );

    expect(handle.gestureActive()).toBe(false);
  });

  it("keeps a live touch orbit latched through a stray button-less mousemove", () => {
    const { canvas, handle } = setupInteractions();
    canvas.dispatchEvent(
      touchEvent("touchstart", [{ clientX: 50, clientY: 50 }]),
    );
    expect(handle.gestureActive()).toBe(true);

    // A touchscreen-laptop mouse (or palm brush) moves with no button down.
    document.dispatchEvent(
      new MouseEvent("mousemove", { buttons: 0, clientX: 200, clientY: 200 }),
    );

    expect(handle.gestureActive()).toBe(true);
  });
});

describe("attachInteractions camera keys", () => {
  function key(
    canvas: HTMLCanvasElement,
    key: string,
    init: KeyboardEventInit = {},
  ): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key,
      cancelable: true,
      ...init,
    });
    canvas.dispatchEvent(event);
    return event;
  }

  it("plain arrows orbit through the same rotate the drag uses, and consume the key", () => {
    const { canvas, rotate } = setupInteractions();
    const event = key(canvas, "ArrowRight");
    expect(rotate).toHaveBeenCalledTimes(1);
    const [dx, dy] = rotate.mock.calls[0] as [number, number];
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBe(0);
    expect(event.defaultPrevented).toBe(true);
  });

  it("+ and - dolly like wheel notches", () => {
    const { canvas, dolly } = setupInteractions();
    key(canvas, "+");
    key(canvas, "-");
    expect(dolly).toHaveBeenCalledTimes(2);
    const zoomIn = dolly.mock.calls[0][0] as number;
    const zoomOut = dolly.mock.calls[1][0] as number;
    expect(zoomIn).toBeLessThan(1);
    expect(zoomOut * zoomIn).toBeCloseTo(1, 12); // a round trip returns home
  });

  it("Shift+arrows ride the SAME onFourDRotate wire as the Shift-drag while 4D", () => {
    const { canvas, onFourDRotate, rotate } = setupInteractions({
      fourD: true,
    });
    key(canvas, "ArrowUp", { shiftKey: true });
    expect(onFourDRotate).toHaveBeenCalledTimes(1);
    expect(onFourDRotate.mock.calls[0][0]).toMatchObject({ xw: 0, zw: 0 });
    expect(
      (onFourDRotate.mock.calls[0][0] as { yw: number }).yw,
    ).toBeGreaterThan(0);
    expect(rotate).not.toHaveBeenCalled();
  });

  it("an unhandled key is left alone — not consumed, nothing called", () => {
    const { canvas, rotate, dolly, onToggleAutoMotion } = setupInteractions();
    const event = key(canvas, "Tab");
    expect(event.defaultPrevented).toBe(false);
    expect(rotate).not.toHaveBeenCalled();
    expect(dolly).not.toHaveBeenCalled();
    expect(onToggleAutoMotion).not.toHaveBeenCalled();
  });

  it("Space toggles auto-motion and consumes the key so the page never scrolls", () => {
    const { canvas, onToggleAutoMotion } = setupInteractions();
    const event = key(canvas, " ");
    expect(onToggleAutoMotion).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("[ and ] nudge the slice only while the slice is on", () => {
    const off = setupInteractions({ fourD: true, sliceOn: false });
    key(off.canvas, "[");
    expect(off.onFourDSliceNudge).not.toHaveBeenCalled();

    const on = setupInteractions({ fourD: true, sliceOn: true });
    key(on.canvas, "]");
    expect(on.onFourDSliceNudge).toHaveBeenCalledTimes(1);
    expect(on.onFourDSliceNudge.mock.calls[0][0] as number).toBeGreaterThan(0);
  });

  it("frozen() blocks every key exactly as it blocks drags — a flame render's camera cannot drift", () => {
    const { canvas, rotate, dolly, onToggleAutoMotion } = setupInteractions({
      frozen: true,
    });
    key(canvas, "ArrowLeft");
    key(canvas, "+");
    key(canvas, " ");
    expect(rotate).not.toHaveBeenCalled();
    expect(dolly).not.toHaveBeenCalled();
    expect(onToggleAutoMotion).not.toHaveBeenCalled();
  });

  it("chorded arrows pass through untouched — Alt+Left must stay history-back", () => {
    const { canvas, rotate } = setupInteractions();
    const event = key(canvas, "ArrowLeft", { altKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(rotate).not.toHaveBeenCalled();
  });
});
