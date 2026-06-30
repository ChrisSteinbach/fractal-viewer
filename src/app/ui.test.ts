// @vitest-environment jsdom
import { Ui } from "./ui";
import type { UiHandlers } from "./ui";
import { initialState } from "./state";
import { defaultTransforms, PRESET_NAMES } from "../fractal/presets";
import type { Transform } from "../fractal/types";
// Load the production markup itself so the Ui↔DOM contract has one source of
// truth: the constructor throws on any missing element, so renaming or removing
// one in index.html fails these tests instead of silently breaking the app.
import indexHtml from "./index.html?raw";

function noopHandlers(): UiHandlers {
  return {
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onPreset: vi.fn(),
    onNumPointsInput: vi.fn(),
    onPointSizeInput: vi.fn(),
    onRegenerate: vi.fn(),
    onSavePng: vi.fn(),
    onToggleGuides: vi.fn(),
    onColorMode: vi.fn(),
    onRenderStyle: vi.fn(),
    onToggleAutoUpdate: vi.fn(),
    onSelect: vi.fn(),
    onTransformGeometry: vi.fn(),
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

function editorSliders(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(
      "#transformEditor input[type='range']",
    ),
  );
}

/** Grab one editor slider by its aria-label, e.g. "Rotation Y" — stable across
 * group reordering, unlike a positional index. */
function editorSlider(label: string): HTMLInputElement {
  const slider = document.querySelector<HTMLInputElement>(
    `#transformEditor input[aria-label="${label}"]`,
  );
  if (!slider) throw new Error(`No editor slider labelled "${label}"`);
  return slider;
}

function editorGroupTitles(): string[] {
  return Array.from(
    document.querySelectorAll("#transformEditor .editor-group-title"),
  ).map((el) => el.textContent ?? "");
}

beforeEach(() => {
  const parsed = new DOMParser().parseFromString(indexHtml, "text/html");
  document.body.replaceChildren();
  for (const node of Array.from(parsed.body.children)) {
    // Skip the module script tag — we exercise Ui, not the app bootstrap.
    if (node.tagName === "SCRIPT") continue;
    document.body.appendChild(document.importNode(node, true));
  }
});

describe("Ui construction", () => {
  it("binds to every element the real index.html provides", () => {
    expect(() => new Ui(document)).not.toThrow();
  });
});

describe("preset menu", () => {
  // Guards against the menu and the preset registry drifting apart — e.g. a
  // startup or new system that has no <option> and so can never be selected.
  it("offers exactly the registered presets", () => {
    const values = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#presetSelect option"),
    )
      .map((o) => o.value)
      .filter((v) => v !== "");
    expect(values.sort()).toEqual([...PRESET_NAMES].sort());
  });
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

describe("Ui.renderTransformEditor", () => {
  it("builds position, rotation, and scale sliders for the selected transform", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(defaultTransforms()[0], 0);

    expect(editorGroupTitles()).toEqual(["Position", "Rotation", "Scale"]);
    expect(editorSliders()).toHaveLength(9);
  });

  it("shows the stored rotation radians as degrees", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, Math.PI / 4, 0],
        scale: [0.5, 0.5, 0.5],
      },
      0,
    );

    expect(editorSlider("Rotation Y").value).toBe("45");
  });

  it("reports an edited rotation axis back in radians, preserving the rest", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      {
        id: 0,
        position: [0.5, 0.5, 0.5],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      },
      0,
    );

    const rotationY = editorSlider("Rotation Y");
    rotationY.value = "90";
    rotationY.dispatchEvent(new Event("input"));

    const calls = vi.mocked(handlers.onTransformGeometry).mock.calls;
    expect(calls).toHaveLength(1);
    const [index, geometry] = calls[0];
    expect(index).toBe(0);
    expect(geometry.rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(geometry.rotation[0]).toBe(0);
    expect(geometry.position).toEqual([0.5, 0.5, 0.5]);
    expect(geometry.scale).toEqual([0.5, 0.5, 0.5]);
  });

  it("supports non-uniform scale", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      },
      0,
    );

    const scaleX = editorSlider("Scale X");
    scaleX.value = "1.2";
    scaleX.dispatchEvent(new Event("input"));

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.scale).toEqual([1.2, 0.5, 0.5]);
  });

  it("re-syncs the sliders when the transform changes under the same selection", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const base: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    };
    ui.renderTransformEditor(base, 0);
    // Same index → no rebuild; a drag moved X, so that slider should follow.
    ui.renderTransformEditor({ ...base, position: [1, 0, 0] }, 0);

    expect(editorSlider("Position X").value).toBe("1");
  });

  it("clears the editor in camera mode", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(defaultTransforms()[0], 0);
    expect(editorSliders()).toHaveLength(9);

    ui.renderTransformEditor(null, null);
    expect(document.getElementById("transformEditor")?.children).toHaveLength(
      0,
    );
  });
});
