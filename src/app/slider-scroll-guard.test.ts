// @vitest-environment jsdom
import { installSliderScrollGuard } from "./slider-scroll-guard";

// jsdom has no PointerEvent/TouchEvent constructors; the guard only reads
// plain properties off the events, so a generic Event with the fields
// assigned behaves identically to the real thing.
function pointerEvent(
  type: string,
  props: { pointerType?: string; clientX?: number; clientY?: number } = {},
): Event {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerType: "touch", ...props });
  return event;
}

function touchMove(clientX: number, clientY: number): Event {
  const event = new Event("touchmove", { bubbles: true });
  Object.assign(event, { touches: [{ clientX, clientY }] });
  return event;
}

function setup(): { panel: HTMLElement; slider: HTMLInputElement } {
  document.body.replaceChildren();
  const panel = document.createElement("div");
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "4";
  slider.step = "0.05";
  slider.value = "1";
  panel.appendChild(slider);
  document.body.appendChild(panel);
  installSliderScrollGuard(panel);
  return { panel, slider };
}

/** Simulate the browser's pointerdown default action: the tap-jump. The
 * guard's own listener has already run by the time this executes. */
function jumpTo(slider: HTMLInputElement, value: string): void {
  slider.value = value;
}

describe("installSliderScrollGuard (fr-zoi)", () => {
  it("restores the pre-jump value and re-fires input when the browser claims the gesture", () => {
    const { slider } = setup();
    const inputs = vi.fn();
    slider.addEventListener("input", inputs);

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 50, clientY: 10 }),
    );
    jumpTo(slider, "2.1"); // Blink's tap-jump
    slider.dispatchEvent(pointerEvent("pointercancel")); // pan claimed

    expect(slider.value).toBe("1");
    expect(inputs).toHaveBeenCalledTimes(1);
  });

  it("keeps a deliberate horizontal slide", () => {
    const { slider } = setup();

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 50, clientY: 10 }),
    );
    jumpTo(slider, "2.1");
    slider.dispatchEvent(touchMove(110, 12));
    jumpTo(slider, "3.3"); // native drag kept adjusting
    slider.dispatchEvent(pointerEvent("pointerup"));
    slider.dispatchEvent(new Event("touchend", { bubbles: true }));

    expect(slider.value).toBe("3.3");
  });

  it("keeps a plain tap's jump (tap-to-set stays a feature)", () => {
    const { slider } = setup();

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 50, clientY: 10 }),
    );
    jumpTo(slider, "2.1");
    slider.dispatchEvent(pointerEvent("pointerup")); // no movement at all

    expect(slider.value).toBe("2.1");
  });

  it("restores after a pure-vertical gesture even without pointercancel", () => {
    const { slider } = setup();
    const inputs = vi.fn();
    slider.addEventListener("input", inputs);

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 50, clientY: 100 }),
    );
    jumpTo(slider, "2.1");
    slider.dispatchEvent(touchMove(52, 20)); // straight up: adx 2, ady 80
    slider.dispatchEvent(pointerEvent("pointerup")); // engine skipped pointercancel

    expect(slider.value).toBe("1");
    expect(inputs).toHaveBeenCalledTimes(1);
  });

  it("does not re-fire input when the claimed gesture never moved the value", () => {
    const { slider } = setup();
    const inputs = vi.fn();
    slider.addEventListener("input", inputs);

    slider.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 50, clientY: 10 }),
    );
    // No jump (finger landed exactly on the thumb).
    slider.dispatchEvent(pointerEvent("pointercancel"));

    expect(slider.value).toBe("1");
    expect(inputs).not.toHaveBeenCalled();
  });

  it("ignores mouse pointers so desktop click-to-jump stays native", () => {
    const { slider } = setup();

    slider.dispatchEvent(
      pointerEvent("pointerdown", {
        pointerType: "mouse",
        clientX: 50,
        clientY: 10,
      }),
    );
    jumpTo(slider, "2.1");
    slider.dispatchEvent(pointerEvent("pointercancel"));

    expect(slider.value).toBe("2.1");
  });

  it("guards sliders added after installation (the dynamic editor rows)", () => {
    const { panel } = setup();
    const late = document.createElement("input");
    late.type = "range";
    late.min = "0";
    late.max = "10";
    late.value = "5";
    panel.appendChild(late);

    late.dispatchEvent(
      pointerEvent("pointerdown", { clientX: 50, clientY: 10 }),
    );
    jumpTo(late, "9");
    late.dispatchEvent(pointerEvent("pointercancel"));

    expect(late.value).toBe("5");
  });
});
