// @vitest-environment jsdom
import { enhanceRangeWithNumber } from "./range-number-control";

function range(
  options: {
    min?: number;
    max?: number;
    step?: number;
    value?: number;
    id?: string;
  } = {},
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(options.min ?? 0);
  input.max = String(options.max ?? 10);
  input.step = String(options.step ?? 1);
  input.value = String(options.value ?? 2);
  if (options.id) input.id = options.id;
  document.body.appendChild(input);
  return input;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("enhanceRangeWithNumber", () => {
  it("wraps the supplied range and links both controls to its preserved descriptions and visible error", () => {
    const hint = document.createElement("p");
    hint.id = "timingHint";
    document.body.appendChild(hint);
    const slider = range({ id: "pointSize", value: 2 });
    slider.setAttribute("aria-label", "Point size");
    slider.setAttribute("aria-describedby", "timingHint");

    const control = enhanceRangeWithNumber(slider, {
      min: 0,
      max: 10,
      step: 1,
      onInput: vi.fn(),
    });

    expect(control.pair.className).toBe("range-number-pair");
    expect(control.pair.children).toEqual(
      expect.objectContaining({ length: 3 }),
    );
    expect(control.pair.firstElementChild).toBe(slider);
    expect(control.numberInput.type).toBe("number");
    expect(control.numberInput.className).toBe("range-number-input");
    expect(control.numberInput.id).toBe("pointSizeNumber");
    expect(control.numberInput.getAttribute("aria-label")).toBe(
      "Point size exact value",
    );
    expect(control.error.className).toBe("range-number-error");
    expect(control.error.hidden).toBe(true);
    expect(control.error.getAttribute("role")).toBe("alert");
    expect(slider.getAttribute("aria-describedby")).toBe(
      `timingHint ${control.error.id}`,
    );
    expect(control.numberInput.getAttribute("aria-describedby")).toBe(
      `timingHint ${control.error.id}`,
    );
  });

  it("uses the semantic adapter when a slider input synchronizes the number and callback", () => {
    const slider = range({ min: 0, max: 4, step: 1, value: 1 });
    const onInput = vi.fn();
    const onCommit = vi.fn();
    const control = enhanceRangeWithNumber(slider, {
      min: 1,
      max: 10_000,
      step: 1,
      adapter: {
        rangeToNumber: (raw) => 10 ** raw,
        numberToRange: (value) => Math.log10(value),
      },
      onInput,
      onCommit,
    });

    slider.value = "3";
    slider.dispatchEvent(new Event("input"));

    expect(control.numberInput.value).toBe("1000");
    expect(onInput).toHaveBeenCalledOnce();
    expect(onInput).toHaveBeenCalledWith(1000, "range");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("maps one valid number change to the range, then calls input and commit once in order", () => {
    const slider = range({ min: 0, max: 10, step: 0.1, value: 2 });
    const calls: string[] = [];
    const control = enhanceRangeWithNumber(slider, {
      min: 0,
      max: 100,
      step: 1,
      adapter: {
        rangeToNumber: (raw) => raw * 10,
        numberToRange: (value) => value / 10,
      },
      onInput: (value, source) =>
        calls.push(`input:${String(value)}:${source}`),
      onCommit: (value) => calls.push(`commit:${String(value)}`),
    });

    control.numberInput.value = "37";
    control.numberInput.dispatchEvent(new Event("change"));

    expect(slider.value).toBe("3.7");
    expect(control.numberInput.value).toBe("37");
    expect(calls).toEqual(["input:37:number", "commit:37"]);
  });

  it.each([
    ["", "Enter a number."],
    ["-1", "Enter a value from 0 to 10."],
    ["11", "Enter a value from 0 to 10."],
    ["1.5", "Use increments of 1 from 0."],
    ["3", "Choose one of: 0, 2, 4, 8."],
  ])(
    "rejects the invalid draft %j without callbacks and preserves it",
    (draft, message) => {
      const slider = range({ min: 0, max: 10, value: 2 });
      const onInput = vi.fn();
      const onCommit = vi.fn();
      const control = enhanceRangeWithNumber(slider, {
        min: 0,
        max: 10,
        step: 1,
        allowedValues: draft === "3" ? [0, 2, 4, 8] : undefined,
        onInput,
        onCommit,
      });

      control.numberInput.value = draft;
      control.numberInput.dispatchEvent(new Event("change"));

      expect(control.numberInput.value).toBe(draft);
      expect(slider.value).toBe("2");
      expect(onInput).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
      expect(control.numberInput.getAttribute("aria-invalid")).toBe("true");
      expect(control.numberInput.validationMessage).toBe(message);
      expect(control.error.textContent).toBe(message);
      expect(control.error.hidden).toBe(false);
    },
  );

  it("restores the last accepted value and clears validation on Escape without callbacks", () => {
    const slider = range({ value: 2 });
    const onInput = vi.fn();
    const onCommit = vi.fn();
    const control = enhanceRangeWithNumber(slider, {
      min: 0,
      max: 10,
      step: 1,
      onInput,
      onCommit,
    });
    control.setValue(4);
    control.numberInput.value = "20";
    control.numberInput.dispatchEvent(new Event("change"));
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });

    control.numberInput.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(control.numberInput.value).toBe("4");
    expect(control.numberInput.hasAttribute("aria-invalid")).toBe(false);
    expect(control.numberInput.validationMessage).toBe("");
    expect(control.error.hidden).toBe(true);
    expect(onInput).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("clears a shown error as soon as the draft becomes valid, without applying it", () => {
    const slider = range({ value: 2 });
    const onInput = vi.fn();
    const control = enhanceRangeWithNumber(slider, {
      min: 0,
      max: 10,
      step: 1,
      onInput,
    });
    control.numberInput.value = "20";
    control.numberInput.dispatchEvent(new Event("change"));

    control.numberInput.value = "6";
    control.numberInput.dispatchEvent(new Event("input"));

    expect(control.numberInput.hasAttribute("aria-invalid")).toBe(false);
    expect(control.error.hidden).toBe(true);
    expect(slider.value).toBe("2");
    expect(onInput).not.toHaveBeenCalled();
  });

  it("updates external value, bounds, discrete domain, and disabled state without callbacks", () => {
    const slider = range({ min: 0, max: 10, value: 2 });
    const onInput = vi.fn();
    const onCommit = vi.fn();
    const control = enhanceRangeWithNumber(slider, {
      min: 0,
      max: 10,
      step: 1,
      onInput,
      onCommit,
    });

    control.setValue(6);
    control.setBounds({ min: 4, max: 12, step: 2 });
    control.setAllowedValues([12, 8, 8, 4]);
    control.setDisabled(true);

    expect(control.numberInput.value).toBe("6");
    expect(slider.value).toBe("6");
    expect(control.numberInput.min).toBe("4");
    expect(control.numberInput.max).toBe("12");
    expect(control.numberInput.step).toBe("2");
    expect(slider.disabled).toBe(true);
    expect(control.numberInput.disabled).toBe(true);
    expect(onInput).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();

    control.setDisabled(false);
    control.numberInput.value = "6";
    control.numberInput.dispatchEvent(new Event("change"));
    expect(control.error.textContent).toBe("Choose one of: 4, 8, 12.");
  });

  it("does not blindly mirror a temporary range disabled flip", () => {
    const slider = range();
    const control = enhanceRangeWithNumber(slider, {
      min: 0,
      max: 10,
      step: 1,
      onInput: vi.fn(),
    });

    slider.disabled = true;
    expect(control.numberInput.disabled).toBe(false);
    slider.disabled = false;

    control.setDisabled(true);
    expect(slider.disabled).toBe(true);
    expect(control.numberInput.disabled).toBe(true);
  });

  it("rejects invalid construction and programmatic synchronization contracts", () => {
    const notRange = document.createElement("input");
    document.body.appendChild(notRange);
    expect(() =>
      enhanceRangeWithNumber(notRange, {
        min: 0,
        max: 1,
        step: 1,
        onInput: vi.fn(),
      }),
    ).toThrow(/input\[type=range\]/);

    const slider = range();
    const control = enhanceRangeWithNumber(slider, {
      min: 0,
      max: 10,
      step: 1,
      onInput: vi.fn(),
    });
    expect(() => control.setValue(11)).toThrow(/outside/);
    expect(() => control.setBounds({ min: 0, max: 1, step: 0 })).toThrow(
      /positive/,
    );
    expect(() =>
      enhanceRangeWithNumber(slider, {
        min: 0,
        max: 10,
        step: 1,
        onInput: vi.fn(),
      }),
    ).toThrow(/already/);
  });
});
