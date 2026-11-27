// @vitest-environment jsdom
import { installColorPickerAnchor, PICKER_WIDTH } from "./color-picker-anchor";

// jsdom has neither layout nor showPicker, so both are supplied here.
const opened: HTMLInputElement[] = [];
HTMLInputElement.prototype.showPicker = function (this: HTMLInputElement) {
  opened.push(this);
};
installColorPickerAnchor(document);

function swatchAt(left: number, top: number): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "color";
  input.getBoundingClientRect = () => new DOMRect(left, top, 36, 26);
  document.body.appendChild(input);
  return input;
}

/** False when the swatch's own native picker was suppressed. */
function click(input: HTMLInputElement): boolean {
  return input.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

describe("color picker anchor", () => {
  beforeEach(() => {
    opened.length = 0;
    document.body.replaceChildren();
  });

  it("leaves a swatch with room for its picker alone", () => {
    expect(click(swatchAt(100, 100))).toBe(true);
    expect(opened).toHaveLength(0);
  });

  it("opens from inside the window for a swatch at the right edge", () => {
    expect(click(swatchAt(window.innerWidth - 40, 100))).toBe(false);
    expect(parseFloat(opened[0].style.left)).toBe(
      window.innerWidth - PICKER_WIDTH,
    );
  });

  it("raises the anchor for a swatch at the bottom edge", () => {
    click(swatchAt(100, window.innerHeight - 30));
    expect(parseFloat(opened[0].style.top)).toBeLessThan(
      window.innerHeight - 30,
    );
  });

  it.each(["input", "change"])(
    "relays the picked color to the swatch as a bubbling %s",
    (type) => {
      const swatch = swatchAt(window.innerWidth - 40, 100);
      const seen: string[] = [];
      document.body.addEventListener(
        type,
        (event) => seen.push((event.target as HTMLInputElement).value),
        { once: false },
      );
      click(swatch);
      opened[0].value = "#123456";
      opened[0].dispatchEvent(new Event(type, { bubbles: true }));
      expect(seen).toEqual(["#123456"]);
    },
  );

  it("keeps one stand-in across repeated opens", () => {
    const swatch = swatchAt(window.innerWidth - 40, 100);
    click(swatch);
    click(swatch);
    expect(document.querySelectorAll('input[type="color"]')).toHaveLength(2);
  });
});
