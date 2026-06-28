// @vitest-environment jsdom
import { Ui } from "./ui";
import type { UiHandlers } from "./ui";
import { initialState } from "./state";
import { defaultTransforms } from "../fractal/presets";

const FIXTURE = `
<div id="helpTitle"></div>
<div id="helpText"></div>
<div id="pointCount"></div>
<button id="menuToggle"></button>
<div id="backdrop"></div>
<div id="panel">
  <button id="panelClose"></button>
  <span id="transformCount"></span>
  <button id="addBtn"></button>
  <button id="removeBtn"></button>
  <select id="presetSelect">
    <option value="" selected>Load a preset…</option>
    <option value="sierpinski">Sierpinski Tetrahedron</option>
    <option value="dodecahedron">Dodecahedron (20)</option>
  </select>
  <span id="numPointsLabel"></span>
  <input id="numPointsSlider" type="range" min="0" max="500000" value="100000" />
  <span id="pointSizeLabel"></span>
  <input id="pointSizeSlider" type="range" min="0.25" max="4" step="0.05" value="1" />
  <button id="regenerateBtn"></button>
  <input id="showGuides" type="checkbox" checked />
  <select id="colorMode">
    <option value="transform">By Transform</option>
    <option value="uniform">Uniform</option>
  </select>
  <select id="renderStyle">
    <option value="depthFade">Depth Fade</option>
    <option value="glow">Glow + Bloom</option>
  </select>
  <input id="autoUpdate" type="checkbox" checked />
  <div id="transformList"></div>
</div>`;

function noopHandlers(): UiHandlers {
  return {
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onPreset: vi.fn(),
    onNumPointsInput: vi.fn(),
    onPointSizeInput: vi.fn(),
    onRegenerate: vi.fn(),
    onToggleGuides: vi.fn(),
    onColorMode: vi.fn(),
    onRenderStyle: vi.fn(),
    onToggleAutoUpdate: vi.fn(),
    onSelect: vi.fn(),
    onTogglePanel: vi.fn(),
    onClosePanel: vi.fn(),
  };
}

function transformButtons(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      "#transformList .transform-btn",
    ),
  );
}

beforeEach(() => {
  const parsed = new DOMParser().parseFromString(
    `<body>${FIXTURE}</body>`,
    "text/html",
  );
  document.body.replaceChildren();
  for (const node of Array.from(parsed.body.children)) {
    document.body.appendChild(document.importNode(node, true));
  }
});

describe("Ui.renderTransformList", () => {
  it("renders a camera row plus one row per transform", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformList(defaultTransforms(), null);

    const buttons = transformButtons();
    expect(buttons).toHaveLength(5);
    expect(buttons[0].textContent).toContain("Camera View");
    expect(buttons[0].classList.contains("selected")).toBe(true);
  });

  it("marks the selected transform and no others", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformList(defaultTransforms(), 2);

    const selected = transformButtons().filter((b) =>
      b.classList.contains("selected"),
    );
    expect(selected).toHaveLength(1);
    // Index 2 → third transform → fourth button (after the camera row).
    expect(transformButtons()[3].classList.contains("selected")).toBe(true);
  });

  it("invokes onSelect with the row's index (null for camera)", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformList(defaultTransforms(), null);

    transformButtons()[1].click();
    expect(handlers.onSelect).toHaveBeenCalledWith(0);
    transformButtons()[0].click();
    expect(handlers.onSelect).toHaveBeenCalledWith(null);
  });
});

describe("Ui.updateLabels", () => {
  it("shows the transform count and disables remove at the minimum", () => {
    const ui = new Ui(document);
    const single = initialState(true);
    ui.updateLabels({
      ...single,
      transforms: [single.transforms[0]],
      selectedTransform: null,
    });

    expect(document.getElementById("transformCount")?.textContent).toBe("1");
    const remove = document.getElementById("removeBtn") as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
  });

  it("names the selected transform in the help box", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), selectedTransform: 1 });
    expect(document.getElementById("helpTitle")?.textContent).toBe(
      "Transform 2",
    );
  });

  it("reflects the point size as a multiplier and into the slider", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), pointSize: 2.5 });

    expect(document.getElementById("pointSizeLabel")?.textContent).toBe(
      "2.50×",
    );
    const slider = document.getElementById(
      "pointSizeSlider",
    ) as HTMLInputElement;
    expect(slider.value).toBe("2.5");
  });
});

describe("Ui point size slider", () => {
  it("reports the slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "pointSizeSlider",
    ) as HTMLInputElement;
    slider.value = "1.75";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onPointSizeInput).toHaveBeenCalledWith(1.75);
  });
});

describe("Ui preset menu", () => {
  it("fires onPreset for the chosen value, then resets to the placeholder", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const select = document.getElementById("presetSelect") as HTMLSelectElement;
    select.value = "dodecahedron";
    select.dispatchEvent(new Event("change"));

    expect(handlers.onPreset).toHaveBeenCalledWith("dodecahedron");
    // Snaps back so the menu reads as an action, not a persistent mode.
    expect(select.value).toBe("");
  });

  it("ignores reselecting the placeholder", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const select = document.getElementById("presetSelect") as HTMLSelectElement;
    select.value = "";
    select.dispatchEvent(new Event("change"));

    expect(handlers.onPreset).not.toHaveBeenCalled();
  });
});

describe("Ui.setPointCount", () => {
  it("formats the count with a 'pts' suffix", () => {
    const ui = new Ui(document);
    ui.setPointCount(100000);
    expect(document.getElementById("pointCount")?.textContent).toBe(
      `${(100000).toLocaleString()} pts`,
    );
  });
});
