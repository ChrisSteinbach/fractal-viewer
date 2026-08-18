// @vitest-environment jsdom
import { installSliderScrollGuard } from "./slider-scroll-guard";

// jsdom has no PointerEvent constructor; the guard only reads plain
// properties off the events, so a generic Event with the fields assigned
// behaves identically to the real thing. Cancelable because a real
// pointerdown is.
function pointerEvent(
  type: string,
  props: {
    pointerType?: string;
    pointerId?: number;
    clientX?: number;
    clientY?: number;
  } = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerType: "touch",
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    ...props,
  });
  return event;
}

/** A panel holding one guarded slider, with `input`/`change` counters
 * attached. jsdom does no layout, so the track geometry is stubbed: the
 * slider occupies client x `left` .. `left + width`. */
function setup(opts: {
  min: string;
  max: string;
  step?: string;
  value: string;
  left: number;
  width: number;
  disabled?: boolean;
}): {
  panel: HTMLElement;
  slider: HTMLInputElement;
  inputs: ReturnType<typeof vi.fn>;
  changes: ReturnType<typeof vi.fn>;
} {
  document.body.replaceChildren();
  const panel = document.createElement("div");
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = opts.min;
  slider.max = opts.max;
  if (opts.step !== undefined) slider.step = opts.step;
  slider.value = opts.value;
  slider.disabled = opts.disabled ?? false;
  slider.getBoundingClientRect = () => ({
    x: opts.left,
    y: 0,
    left: opts.left,
    right: opts.left + opts.width,
    top: 0,
    bottom: 20,
    width: opts.width,
    height: 20,
    toJSON: () => ({}),
  });
  panel.appendChild(slider);
  document.body.appendChild(panel);
  installSliderScrollGuard(panel);

  const inputs = vi.fn();
  const changes = vi.fn();
  slider.addEventListener("input", inputs);
  slider.addEventListener("change", changes);
  return { panel, slider, inputs, changes };
}

describe("installSliderScrollGuard (fr-xu4u)", () => {
  it("leaves the value and the edit pipeline completely alone when a touch scroll starts on a slider", () => {
    const { slider, inputs, changes } = setup({
      min: "0",
      max: "2.5",
      step: "0.05",
      value: "1",
      left: 0,
      width: 300,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 150, clientY: 400 }),
    );
    for (const clientY of [380, 340, 300, 260, 220]) {
      slider.dispatchEvent(
        pointerEvent("pointermove", { clientX: 151, clientY }),
      );
    }
    slider.dispatchEvent(pointerEvent("pointercancel")); // Chromium claimed the pan

    expect(slider.value).toBe("1");
    expect(inputs).not.toHaveBeenCalled();
    expect(changes).not.toHaveBeenCalled();
  });

  it("hides the slider from Blink's touchstart handler, and gives it back the same frame", async () => {
    const { slider } = setup({
      min: "0",
      max: "4",
      value: "1",
      left: 0,
      width: 200,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 50, clientY: 10 }),
    );
    expect(slider.disabled).toBe(true); // touchstart's default handler skips it

    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(slider.disabled).toBe(false);
  });

  it("gives the slider back at the end of a gesture even if no frame ran", () => {
    const { slider } = setup({
      min: "0",
      max: "4",
      value: "1",
      left: 0,
      width: 200,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 50, clientY: 10 }),
    );
    slider.dispatchEvent(pointerEvent("pointercancel"));

    expect(slider.disabled).toBe(false);
  });

  it("writes the value the finger is over once a drag passes the horizontal slop", () => {
    const { slider, inputs } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 100, clientY: 10 }),
    );
    slider.dispatchEvent(
      pointerEvent("pointermove", { clientX: 150, clientY: 12 }),
    );

    expect(slider.value).toBe("3"); // 150/200 of [0, 4]
    expect(inputs).toHaveBeenCalledTimes(1);
  });

  it("does not move the value for a wobble shorter than the slop", () => {
    const { slider, inputs } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 100, clientY: 10 }),
    );
    slider.dispatchEvent(
      pointerEvent("pointermove", { clientX: 107, clientY: 10 }), // 7px < 8px
    );

    expect(slider.value).toBe("1");
    expect(inputs).not.toHaveBeenCalled();
  });

  it("does not set a value on a plain tap (tap-to-set is gone on touch)", () => {
    const { slider, inputs, changes } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 180, clientY: 10 }),
    );
    slider.dispatchEvent(pointerEvent("pointerup", { clientX: 180 }));

    expect(slider.value).toBe("1");
    expect(inputs).not.toHaveBeenCalled();
    expect(changes).not.toHaveBeenCalled();
  });

  it("quantizes to the slider's own step", () => {
    const { slider } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 100, clientY: 10 }),
    );
    slider.dispatchEvent(
      pointerEvent("pointermove", { clientX: 133, clientY: 10 }),
    );

    expect(slider.value).toBe("2.65"); // raw 2.66 -> nearest 0.05, noise-free
  });

  it("clamps to min and max when the finger runs off either end of the track", () => {
    const { slider } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 100,
      width: 200,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 200, clientY: 10 }),
    );
    slider.dispatchEvent(
      pointerEvent("pointermove", { clientX: -40, clientY: 10 }), // past the left end
    );
    expect(slider.value).toBe("0");

    slider.dispatchEvent(
      pointerEvent("pointermove", { clientX: 900, clientY: 10 }), // past the right end
    );
    expect(slider.value).toBe("4");
  });

  it("fires input once per step crossed, not once per move", () => {
    const { slider, inputs } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 100, clientY: 10 }),
    );
    slider.dispatchEvent(pointerEvent("pointermove", { clientX: 150 }));
    slider.dispatchEvent(pointerEvent("pointermove", { clientX: 151 })); // same 0.05 step

    expect(slider.value).toBe("3");
    expect(inputs).toHaveBeenCalledTimes(1);
  });

  it("fires the trailing change on release that commit-on-release specs need (fr-2c27)", () => {
    const { slider, changes } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 100, clientY: 10 }),
    );
    slider.dispatchEvent(pointerEvent("pointermove", { clientX: 150 }));
    expect(changes).not.toHaveBeenCalled(); // not mid-drag
    slider.dispatchEvent(pointerEvent("pointerup", { clientX: 150 }));

    expect(changes).toHaveBeenCalledTimes(1);
  });

  it("ignores mouse pointers so desktop click-to-jump and drag stay native", () => {
    const { slider, inputs } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", {
        pointerType: "mouse",
        clientX: 100,
        clientY: 10,
      }),
    );
    slider.dispatchEvent(
      pointerEvent("pointermove", { pointerType: "mouse", clientX: 150 }),
    );

    expect(slider.disabled).toBe(false); // never hidden from the native drag
    expect(slider.value).toBe("1"); // which is what would own this
    expect(inputs).not.toHaveBeenCalled();
  });

  it("leaves a disabled slider entirely alone, and still disabled", async () => {
    const { slider, inputs } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
      disabled: true,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 100, clientY: 10 }),
    );
    slider.dispatchEvent(pointerEvent("pointermove", { clientX: 150 }));
    slider.dispatchEvent(pointerEvent("pointerup", { clientX: 150 }));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(slider.value).toBe("1");
    expect(slider.disabled).toBe(true); // the guard never re-enables it
    expect(inputs).not.toHaveBeenCalled();
  });

  it("ignores a second finger's moves during a drag (pinch-zoom over the panel)", () => {
    const { slider } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 10 }),
    );
    slider.dispatchEvent(
      pointerEvent("pointermove", { pointerId: 2, clientX: 20, clientY: 10 }),
    );

    expect(slider.value).toBe("1");
  });

  it("ignores a second finger's down mid-drag instead of handing it the gesture", () => {
    const { panel, slider, changes } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
    });
    const second = document.createElement("input");
    second.type = "range";
    second.min = "0";
    second.max = "10";
    second.value = "5";
    panel.appendChild(second);

    // Finger A is mid-drag...
    slider.dispatchEvent(
      pointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 10 }),
    );
    slider.dispatchEvent(
      pointerEvent("pointermove", { pointerId: 1, clientX: 150 }),
    );
    // ...when finger B lands on another slider.
    second.dispatchEvent(
      pointerEvent("pointerdown", { pointerId: 2, clientX: 20, clientY: 10 }),
    );

    // A keeps writing, and A's lift still fires the trailing change.
    slider.dispatchEvent(
      pointerEvent("pointermove", { pointerId: 1, clientX: 180 }),
    );
    expect(slider.value).toBe("3.6");
    slider.dispatchEvent(
      pointerEvent("pointerup", { pointerId: 1, clientX: 180 }),
    );
    expect(changes).toHaveBeenCalledTimes(1);
    // Wiring pin only: jsdom implements no slider touchstart default action,
    // so this cannot prove B's tap-jump was suppressed — the disabled-flip
    // test below pins that side, and the real proof is
    // scripts/panel-touch-scroll.verify.mjs on real Chromium.
    expect(second.value).toBe("5");
  });

  it("hides a second finger's slider from the touchstart handler even while refusing its gesture", async () => {
    const { panel, slider } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
    });
    const second = document.createElement("input");
    second.type = "range";
    second.min = "0";
    second.max = "10";
    second.value = "5";
    panel.appendChild(second);

    slider.dispatchEvent(
      pointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 10 }),
    );
    second.dispatchEvent(
      pointerEvent("pointerdown", { pointerId: 2, clientX: 20, clientY: 10 }),
    );
    // The suppression flip landed before the refusal, so Blink's touchstart
    // handler (dispatched after pointerdown) will skip B's slider.
    expect(second.disabled).toBe(true);

    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(second.disabled).toBe(false); // given back the same frame

    // And the refusal held: B never adopted the gesture.
    second.dispatchEvent(
      pointerEvent("pointermove", { pointerId: 2, clientX: 60, clientY: 10 }),
    );
    expect(second.value).toBe("5");
  });

  it("recovers when the dragged slider is removed mid-gesture, adopting the next touch", () => {
    const { panel, slider } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 10 }),
    );
    slider.dispatchEvent(
      pointerEvent("pointermove", { pointerId: 1, clientX: 150 }),
    );
    expect(slider.value).toBe("3");

    // The transform editor rebuilds mid-drag: the dragged slider leaves the
    // DOM, and the finger's lift lands where the panel never sees it.
    panel.replaceChildren();
    const rebuilt = document.createElement("input");
    rebuilt.type = "range";
    rebuilt.min = "0";
    rebuilt.max = "10";
    rebuilt.value = "5";
    rebuilt.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      right: 200,
      top: 0,
      bottom: 20,
      width: 200,
      height: 20,
      toJSON: () => ({}),
    });
    panel.appendChild(rebuilt);

    // A fresh touch is adopted, not refused by the wedged gesture.
    rebuilt.dispatchEvent(
      pointerEvent("pointerdown", { pointerId: 2, clientX: 100, clientY: 10 }),
    );
    rebuilt.dispatchEvent(
      pointerEvent("pointermove", { pointerId: 2, clientX: 160, clientY: 10 }),
    );
    expect(rebuilt.value).toBe("8"); // 160/200 of [0, 10]
  });

  it("does not end the drag when a second finger lifts elsewhere on the panel", () => {
    const { panel, slider, changes } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
    });

    slider.dispatchEvent(
      pointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 10 }),
    );
    slider.dispatchEvent(
      pointerEvent("pointermove", { pointerId: 1, clientX: 150 }),
    );

    // A second finger taps the panel background mid-drag.
    panel.dispatchEvent(
      pointerEvent("pointerdown", { pointerId: 2, clientX: 10, clientY: 300 }),
    );
    panel.dispatchEvent(
      pointerEvent("pointerup", { pointerId: 2, clientX: 10 }),
    );
    expect(changes).not.toHaveBeenCalled(); // the drag is not committed early

    // The first finger is still driving, through to its own release.
    slider.dispatchEvent(
      pointerEvent("pointermove", { pointerId: 1, clientX: 180 }),
    );
    expect(slider.value).toBe("3.6");
    slider.dispatchEvent(
      pointerEvent("pointerup", { pointerId: 1, clientX: 180 }),
    );
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it("guards sliders added after installation (the dynamic editor rows)", () => {
    const { panel } = setup({
      min: "0",
      max: "4",
      step: "0.05",
      value: "1",
      left: 0,
      width: 200,
    });
    const late = document.createElement("input");
    late.type = "range";
    late.min = "0";
    late.max = "10";
    late.value = "5";
    late.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      right: 200,
      top: 0,
      bottom: 20,
      width: 200,
      height: 20,
      toJSON: () => ({}),
    });
    panel.appendChild(late);

    late.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 100, clientY: 400 }),
    );
    late.dispatchEvent(
      pointerEvent("pointermove", { clientX: 101, clientY: 240 }),
    );
    late.dispatchEvent(pointerEvent("pointercancel"));

    expect(late.value).toBe("5");
  });
});
