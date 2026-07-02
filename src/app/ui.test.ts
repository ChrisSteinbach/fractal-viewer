// @vitest-environment jsdom
import { Ui } from "./ui";
import type { UiHandlers } from "./ui";
import { initialState } from "./state";
import { defaultTransforms, PRESET_NAMES } from "../fractal/presets";
import { FLAME_PALETTE_IDS } from "../fractal/palette";
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
    onToggleFinalTransform: vi.fn(),
    onFinalTransformGeometry: vi.fn(),
    onTogglePanel: vi.fn(),
    onClosePanel: vi.fn(),
    onEnterFlameRender: vi.fn(),
    onExitFlameRender: vi.fn(),
    onFlameExposureInput: vi.fn(),
    onFlameIterationsInput: vi.fn(),
    onFlameGammaInput: vi.fn(),
    onFlameVibrancyInput: vi.fn(),
    onFlameSupersampleInput: vi.fn(),
    onFlamePaletteChange: vi.fn(),
    onFlameEstimatorRadiusInput: vi.fn(),
    onFlameEstimatorMinimumRadiusInput: vi.fn(),
    onFlameEstimatorCurveInput: vi.fn(),
    onEnterSolidRender: vi.fn(),
    onExitSolidRender: vi.fn(),
    onSolidThresholdInput: vi.fn(),
    onSolidLightAzimuthInput: vi.fn(),
    onSolidLightElevationInput: vi.fn(),
    onSolidAmbientInput: vi.fn(),
    onSolidIterationsInput: vi.fn(),
    onSolidResolutionInput: vi.fn(),
    onSymmetryOrderInput: vi.fn(),
    onSymmetryAxisChange: vi.fn(),
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
    ui.renderTransformList(defaultTransforms(), null, null);

    const buttons = transformButtons();
    expect(buttons).toHaveLength(5);
    expect(buttons[0].textContent).toContain("Camera View");
    expect(buttons[0].classList.contains("selected")).toBe(true);
  });

  it("marks the selected transform and no others", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformList(defaultTransforms(), 2, null);

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
    ui.renderTransformList(defaultTransforms(), null, null);

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
  it("builds position, rotation, scale, weight, and variation controls for the selection", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(defaultTransforms()[0], 0);

    expect(editorGroupTitles()).toEqual([
      "Position",
      "Rotation",
      "Scale",
      "Shear",
      "Weight",
      "Variations",
    ]);
    // 12 axis sliders (4 channels × 3) + 1 weight slider; a plain transform has
    // no variations, so the Variations group adds no range sliders (just a menu).
    expect(editorSliders()).toHaveLength(13);
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

  it("labels shear rows XY/XZ/YZ and reports an edit back, preserving the rest", () => {
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

    const shearXY = editorSlider("Shear XY");
    shearXY.value = "0.5";
    shearXY.dispatchEvent(new Event("input"));

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.shear).toEqual([0.5, 0, 0]);
    expect(geometry.scale).toEqual([0.5, 0.5, 0.5]);
  });

  it("shows the stored weight and reports an edit back as a multiplier", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        weight: 1,
      },
      0,
    );

    const weight = editorSlider("Weight");
    // Log-scaled: the default weight of 1 sits at slider value 0.
    expect(weight.value).toBe("0");

    weight.value = "1"; // 10^1 = 10×
    weight.dispatchEvent(new Event("input"));

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.weight).toBeCloseTo(10);
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
    expect(editorSliders()).toHaveLength(13);

    ui.renderTransformEditor(null, null);
    expect(document.getElementById("transformEditor")?.children).toHaveLength(
      0,
    );
  });
});

describe("Ui final transform", () => {
  const lens: Transform = {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };

  function finalRow(): HTMLButtonElement | undefined {
    return transformButtons().find((b) =>
      b.textContent?.includes("Final Transform"),
    );
  }

  it("reports the lens toggle state on change", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const toggle = document.getElementById(
      "finalTransformToggle",
    ) as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));

    expect(handlers.onToggleFinalTransform).toHaveBeenCalledWith(true);
  });

  it("reflects an enabled lens into the toggle checkbox", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), finalTransform: lens });
    expect(
      (document.getElementById("finalTransformToggle") as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("adds a selectable lens row only when a final transform exists", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());

    ui.renderTransformList(defaultTransforms(), null, null);
    expect(finalRow()).toBeUndefined();

    ui.renderTransformList(defaultTransforms(), null, lens);
    expect(finalRow()).toBeDefined();
  });

  it("selects the final transform when its row is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformList(defaultTransforms(), null, lens);

    finalRow()!.click();
    expect(handlers.onSelect).toHaveBeenCalledWith("final");
  });

  it("edits the final transform without a selection-weight control", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(lens, "final");

    // Same channels as a transform, but no Weight group — a selection weight is
    // meaningless for a map applied to every point.
    expect(editorGroupTitles()).toEqual([
      "Position",
      "Rotation",
      "Scale",
      "Shear",
      "Variations",
    ]);
  });

  it("reports final-transform edits through onFinalTransformGeometry, with no weight", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(lens, "final");

    const scaleX = editorSlider("Scale X");
    scaleX.value = "1.5";
    scaleX.dispatchEvent(new Event("input"));

    expect(handlers.onTransformGeometry).not.toHaveBeenCalled();
    const calls = vi.mocked(handlers.onFinalTransformGeometry).mock.calls;
    expect(calls).toHaveLength(1);
    const geometry = calls[0][0];
    expect(geometry.scale).toEqual([1.5, 1, 1]);
    expect(geometry).not.toHaveProperty("weight");
  });
});

describe("Ui variation editor", () => {
  const plain: Transform = {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  };

  function addSelect(): HTMLSelectElement {
    const select = document.querySelector<HTMLSelectElement>(
      "#transformEditor .variation-add",
    );
    if (!select) throw new Error("No variation-add select");
    return select;
  }

  function lastGeometry(handlers: UiHandlers) {
    const calls = vi.mocked(handlers.onTransformGeometry).mock.calls;
    return calls[calls.length - 1][1];
  }

  it("adds a variation from the dropdown at the default weight, then resets the menu", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(plain, 0);

    const select = addSelect();
    select.value = "spherical";
    select.dispatchEvent(new Event("change"));

    // A weighted row appears at the default weight of 1.
    expect(editorSlider("Variation spherical").value).toBe("1");
    expect(lastGeometry(handlers).variations).toEqual([
      { type: "spherical", weight: 1 },
    ]);
    // The menu snaps back to the placeholder, like the preset menu.
    expect(select.value).toBe("");
  });

  it("reports an edited variation weight back", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      { ...plain, variations: [{ type: "swirl", weight: 1 }] },
      0,
    );

    const slider = editorSlider("Variation swirl");
    slider.value = "0.5";
    slider.dispatchEvent(new Event("input"));

    expect(lastGeometry(handlers).variations).toEqual([
      { type: "swirl", weight: 0.5 },
    ]);
  });

  it("removes a variation, reporting an empty blend", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      { ...plain, variations: [{ type: "bubble", weight: 1 }] },
      0,
    );

    const remove = document.querySelector<HTMLButtonElement>(
      "#transformEditor .variation-remove",
    );
    remove!.click();

    expect(
      document.querySelectorAll("#transformEditor .variation-row"),
    ).toHaveLength(0);
    expect(lastGeometry(handlers).variations).toEqual([]);
  });

  it("excludes an already-added variation from the add menu", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(
      { ...plain, variations: [{ type: "spherical", weight: 1 }] },
      0,
    );

    const options = Array.from(
      document.querySelectorAll<HTMLOptionElement>(
        "#transformEditor .variation-add option",
      ),
    ).map((o) => o.value);
    expect(options).not.toContain("spherical");
    expect(options).toContain(""); // placeholder
    expect(options).toContain("swirl"); // other types still offered
  });
});

describe("Ui flame render controls", () => {
  function renderBtn(): HTMLButtonElement {
    return document.getElementById("renderBtn") as HTMLButtonElement;
  }
  function exitRenderBtn(): HTMLButtonElement {
    return document.getElementById("exitRenderBtn") as HTMLButtonElement;
  }
  function explorerControls(): HTMLElement {
    return document.getElementById("explorerControls") as HTMLElement;
  }
  function flameControls(): HTMLElement {
    return document.getElementById("flameControls") as HTMLElement;
  }

  it("shows the explorer panel and the Render button while inactive", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), flameActive: false });

    expect(explorerControls().classList.contains("hidden")).toBe(false);
    expect(renderBtn().classList.contains("hidden")).toBe(false);
    expect(flameControls().classList.contains("hidden")).toBe(true);
  });

  it("swaps to the flame controls and hides the explorer panel while active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), flameActive: true });

    expect(explorerControls().classList.contains("hidden")).toBe(true);
    expect(renderBtn().classList.contains("hidden")).toBe(true);
    expect(flameControls().classList.contains("hidden")).toBe(false);
  });

  it("names the render mode in the help box while active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), flameActive: true });
    expect(document.getElementById("helpTitle")?.textContent).toBe(
      "Flame Render",
    );
  });

  it("fires onEnterFlameRender when Render Current View is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    renderBtn().click();
    expect(handlers.onEnterFlameRender).toHaveBeenCalledOnce();
  });

  it("fires onExitFlameRender when Back to Explorer is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    exitRenderBtn().click();
    expect(handlers.onExitFlameRender).toHaveBeenCalledOnce();
  });

  it("reflects exposure and iterations into their sliders and labels", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      flame: {
        ...initialState(true).flame,
        exposure: 2.5,
        iterations: 42_000_000,
      },
    });

    const exposureSlider = document.getElementById(
      "flameExposureSlider",
    ) as HTMLInputElement;
    expect(exposureSlider.value).toBe("2.5");
    expect(document.getElementById("flameExposureLabel")?.textContent).toBe(
      "2.50×",
    );

    const iterationsSlider = document.getElementById(
      "flameIterationsSlider",
    ) as HTMLInputElement;
    expect(iterationsSlider.value).toBe("42000000");
    expect(document.getElementById("flameIterationsLabel")?.textContent).toBe(
      "42M iterations",
    );
  });

  it("reports the exposure slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameExposureSlider",
    ) as HTMLInputElement;
    slider.value = "1.75";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onFlameExposureInput).toHaveBeenCalledWith(1.75);
  });

  it("reports the iterations slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameIterationsSlider",
    ) as HTMLInputElement;
    slider.value = "5000000";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onFlameIterationsInput).toHaveBeenCalledWith(5_000_000);
  });

  it("reflects gamma, vibrancy, and supersample into their sliders and labels", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      flame: {
        ...initialState(true).flame,
        gamma: 3.5,
        vibrancy: 0.6,
        supersample: 3,
      },
    });

    expect(
      (document.getElementById("flameGammaSlider") as HTMLInputElement).value,
    ).toBe("3.5");
    expect(document.getElementById("flameGammaLabel")?.textContent).toBe(
      "3.50",
    );

    expect(
      (document.getElementById("flameVibrancySlider") as HTMLInputElement)
        .value,
    ).toBe("0.6");
    expect(document.getElementById("flameVibrancyLabel")?.textContent).toBe(
      "60%",
    );

    expect(
      (document.getElementById("flameSupersampleSlider") as HTMLInputElement)
        .value,
    ).toBe("3");
    expect(
      document.getElementById("flameSupersampleLabel")?.textContent,
    ).toContain("3×");
  });

  it("reports the gamma slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameGammaSlider",
    ) as HTMLInputElement;
    slider.value = "4.5";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onFlameGammaInput).toHaveBeenCalledWith(4.5);
  });

  it("reports the vibrancy slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameVibrancySlider",
    ) as HTMLInputElement;
    slider.value = "0.25";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onFlameVibrancyInput).toHaveBeenCalledWith(0.25);
  });

  it("reports the supersample slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameSupersampleSlider",
    ) as HTMLInputElement;
    slider.value = "3";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onFlameSupersampleInput).toHaveBeenCalledWith(3);
  });

  it("reflects the estimator params into their sliders and labels", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      flame: {
        ...initialState(true).flame,
        estimatorRadius: 9,
        estimatorMinimumRadius: 1.5,
        estimatorCurve: 1.2,
      },
    });

    expect(
      (
        document.getElementById(
          "flameEstimatorRadiusSlider",
        ) as HTMLInputElement
      ).value,
    ).toBe("9");
    expect(
      document.getElementById("flameEstimatorRadiusLabel")?.textContent,
    ).toBe("9.0px");

    expect(
      (
        document.getElementById(
          "flameEstimatorMinimumRadiusSlider",
        ) as HTMLInputElement
      ).value,
    ).toBe("1.5");
    expect(
      document.getElementById("flameEstimatorMinimumRadiusLabel")?.textContent,
    ).toBe("1.5px");

    expect(
      (document.getElementById("flameEstimatorCurveSlider") as HTMLInputElement)
        .value,
    ).toBe("1.2");
    expect(
      document.getElementById("flameEstimatorCurveLabel")?.textContent,
    ).toBe("1.20");
  });

  it("reports the estimator radius slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameEstimatorRadiusSlider",
    ) as HTMLInputElement;
    slider.value = "7.5";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onFlameEstimatorRadiusInput).toHaveBeenCalledWith(7.5);
  });

  it("reports the estimator minimum radius slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameEstimatorMinimumRadiusSlider",
    ) as HTMLInputElement;
    slider.value = "2.5";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onFlameEstimatorMinimumRadiusInput).toHaveBeenCalledWith(
      2.5,
    );
  });

  it("reports the estimator curve slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameEstimatorCurveSlider",
    ) as HTMLInputElement;
    slider.value = "0.8";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onFlameEstimatorCurveInput).toHaveBeenCalledWith(0.8);
  });

  // Guards against the dropdown and the palette registry drifting apart — the
  // options must match FLAME_PALETTES exactly, in order (legacy first).
  it("offers exactly the registered flame palettes, in order", () => {
    const values = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#flamePalette option"),
    ).map((o) => o.value);
    expect(values).toEqual([...FLAME_PALETTE_IDS]);
  });

  it("reflects the palette id into the select", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      flame: { ...initialState(true).flame, paletteId: "aurora" },
    });
    expect(
      (document.getElementById("flamePalette") as HTMLSelectElement).value,
    ).toBe("aurora");
  });

  it("reports the selected palette id on change", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const select = document.getElementById("flamePalette") as HTMLSelectElement;
    select.value = "spectrum";
    select.dispatchEvent(new Event("change"));

    expect(handlers.onFlamePaletteChange).toHaveBeenCalledWith("spectrum");
  });
});

describe("Ui.setFlameProgress", () => {
  it("formats done/budget in millions with a percentage", () => {
    const ui = new Ui(document);
    ui.setFlameProgress(12_345_000, 20_000_000);
    expect(document.getElementById("flameProgress")?.textContent).toBe(
      "12.3M / 20.0M iterations (62%)",
    );
  });

  it("never exceeds 100%, even if done overshoots the budget", () => {
    const ui = new Ui(document);
    ui.setFlameProgress(25_000_000, 20_000_000);
    expect(document.getElementById("flameProgress")?.textContent).toContain(
      "(100%)",
    );
  });
});

describe("Ui.setFlameSupersampleNote", () => {
  function note(): HTMLElement | null {
    return document.getElementById("flameSupersampleNote");
  }

  it("is hidden with empty text by default", () => {
    new Ui(document);
    expect(note()?.classList.contains("hidden")).toBe(true);
    expect(note()?.textContent).toBe("");
  });

  it("shows a reduced-from message and un-hides when passed an effective value", () => {
    const ui = new Ui(document);
    ui.setFlameSupersampleNote(1, 3);
    expect(note()?.classList.contains("hidden")).toBe(false);
    expect(note()?.textContent).toBe(
      "Reduced to 1× (from 3×) to fit available memory.",
    );
  });

  it("hides again when passed null", () => {
    const ui = new Ui(document);
    ui.setFlameSupersampleNote(1, 3);
    ui.setFlameSupersampleNote(null);
    expect(note()?.classList.contains("hidden")).toBe(true);
    expect(note()?.textContent).toBe("");
  });
});

describe("Ui solid render controls", () => {
  function solidBtn(): HTMLButtonElement {
    return document.getElementById("solidBtn") as HTMLButtonElement;
  }
  function exitSolidBtn(): HTMLButtonElement {
    return document.getElementById("exitSolidBtn") as HTMLButtonElement;
  }
  function explorerControls(): HTMLElement {
    return document.getElementById("explorerControls") as HTMLElement;
  }
  function solidControls(): HTMLElement {
    return document.getElementById("solidControls") as HTMLElement;
  }

  it("shows the explorer panel and the Render Solid button while inactive", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), solidActive: false });

    expect(explorerControls().classList.contains("hidden")).toBe(false);
    expect(solidBtn().classList.contains("hidden")).toBe(false);
    expect(solidControls().classList.contains("hidden")).toBe(true);
  });

  it("swaps to the solid controls and hides the explorer panel while active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), solidActive: true });

    expect(explorerControls().classList.contains("hidden")).toBe(true);
    expect(solidBtn().classList.contains("hidden")).toBe(true);
    expect(solidControls().classList.contains("hidden")).toBe(false);
  });

  it("names the render mode in the help box while active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), solidActive: true });
    expect(document.getElementById("helpTitle")?.textContent).toBe(
      "Solid Render",
    );
  });

  it("also hides the Render Current View button while the solid render is active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), solidActive: true });
    expect(
      document.getElementById("renderBtn")?.classList.contains("hidden"),
    ).toBe(true);
  });

  it("fires onEnterSolidRender when Render Solid View is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    solidBtn().click();
    expect(handlers.onEnterSolidRender).toHaveBeenCalledOnce();
  });

  it("fires onExitSolidRender when Back to Explorer is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    exitSolidBtn().click();
    expect(handlers.onExitSolidRender).toHaveBeenCalledOnce();
  });

  it("reflects threshold, light angle/height, and ambient into their sliders and labels", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      solid: {
        ...initialState(true).solid,
        threshold: 0.6,
        lightAzimuth: -45,
        lightElevation: 70,
        ambient: 0.5,
      },
    });

    expect(
      (document.getElementById("solidThresholdSlider") as HTMLInputElement)
        .value,
    ).toBe("0.6");
    expect(document.getElementById("solidThresholdLabel")?.textContent).toBe(
      "0.60",
    );

    expect(
      (document.getElementById("solidLightAzimuthSlider") as HTMLInputElement)
        .value,
    ).toBe("-45");
    expect(document.getElementById("solidLightAzimuthLabel")?.textContent).toBe(
      "-45°",
    );

    expect(
      (document.getElementById("solidLightElevationSlider") as HTMLInputElement)
        .value,
    ).toBe("70");
    expect(
      document.getElementById("solidLightElevationLabel")?.textContent,
    ).toBe("70°");

    expect(
      (document.getElementById("solidAmbientSlider") as HTMLInputElement).value,
    ).toBe("0.5");
    expect(document.getElementById("solidAmbientLabel")?.textContent).toBe(
      "50%",
    );
  });

  it("reports the threshold slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "solidThresholdSlider",
    ) as HTMLInputElement;
    slider.value = "0.45";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onSolidThresholdInput).toHaveBeenCalledWith(0.45);
  });

  it("reports the light azimuth slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "solidLightAzimuthSlider",
    ) as HTMLInputElement;
    slider.value = "-90";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onSolidLightAzimuthInput).toHaveBeenCalledWith(-90);
  });

  it("reports the light elevation slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "solidLightElevationSlider",
    ) as HTMLInputElement;
    slider.value = "35";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onSolidLightElevationInput).toHaveBeenCalledWith(35);
  });

  it("reports the ambient slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "solidAmbientSlider",
    ) as HTMLInputElement;
    slider.value = "0.4";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onSolidAmbientInput).toHaveBeenCalledWith(0.4);
  });

  it("reflects iterations and resolution into their sliders and labels", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      solid: {
        ...initialState(true).solid,
        iterations: 42_000_000,
        resolution: 224,
      },
    });

    expect(
      (document.getElementById("solidIterationsSlider") as HTMLInputElement)
        .value,
    ).toBe("42000000");
    expect(document.getElementById("solidIterationsLabel")?.textContent).toBe(
      "42M iterations",
    );

    expect(
      (document.getElementById("solidResolutionSlider") as HTMLInputElement)
        .value,
    ).toBe("224");
    expect(
      document.getElementById("solidResolutionLabel")?.textContent,
    ).toContain("224³");
  });

  it("reports the iterations slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "solidIterationsSlider",
    ) as HTMLInputElement;
    slider.value = "5000000";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onSolidIterationsInput).toHaveBeenCalledWith(5_000_000);
  });

  it("reports the resolution slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "solidResolutionSlider",
    ) as HTMLInputElement;
    slider.value = "224";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onSolidResolutionInput).toHaveBeenCalledWith(224);
  });
});

describe("Ui.setSolidProgress", () => {
  it("formats done/budget in millions with a percentage", () => {
    const ui = new Ui(document);
    ui.setSolidProgress(12_345_000, 20_000_000);
    expect(document.getElementById("solidProgress")?.textContent).toBe(
      "12.3M / 20.0M iterations (62%)",
    );
  });

  it("never exceeds 100%, even if done overshoots the budget", () => {
    const ui = new Ui(document);
    ui.setSolidProgress(25_000_000, 20_000_000);
    expect(document.getElementById("solidProgress")?.textContent).toContain(
      "(100%)",
    );
  });
});

describe("Ui.setSolidResolutionNote", () => {
  function note(): HTMLElement | null {
    return document.getElementById("solidResolutionNote");
  }

  it("is hidden with empty text by default", () => {
    new Ui(document);
    expect(note()?.classList.contains("hidden")).toBe(true);
    expect(note()?.textContent).toBe("");
  });

  it("shows a reduced-from message and un-hides when passed an effective value", () => {
    const ui = new Ui(document);
    ui.setSolidResolutionNote(128, 192);
    expect(note()?.classList.contains("hidden")).toBe(false);
    expect(note()?.textContent).toBe(
      "Reduced to 128³ (from 192³) to fit available memory.",
    );
  });

  it("hides again when passed null", () => {
    const ui = new Ui(document);
    ui.setSolidResolutionNote(128, 192);
    ui.setSolidResolutionNote(null);
    expect(note()?.classList.contains("hidden")).toBe(true);
    expect(note()?.textContent).toBe("");
  });
});

describe("Ui symmetry controls", () => {
  function note(): HTMLElement | null {
    return document.getElementById("symmetryNote");
  }

  it("reflects order and axis into the slider, label, and select", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      symmetry: { order: 5, axis: "z" },
    });

    expect(
      (document.getElementById("symmetryOrderSlider") as HTMLInputElement)
        .value,
    ).toBe("5");
    expect(document.getElementById("symmetryOrderLabel")?.textContent).toBe(
      "5-fold",
    );
    expect(
      (document.getElementById("symmetryAxis") as HTMLSelectElement).value,
    ).toBe("z");
  });

  it("reports the order slider's numeric value on input", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "symmetryOrderSlider",
    ) as HTMLInputElement;
    slider.value = "6";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onSymmetryOrderInput).toHaveBeenCalledWith(6);
  });

  it("reports the selected axis on change", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const select = document.getElementById("symmetryAxis") as HTMLSelectElement;
    select.value = "x";
    select.dispatchEvent(new Event("change"));

    expect(handlers.onSymmetryAxisChange).toHaveBeenCalledWith("x");
  });

  it("hides the reduction note when the requested order fits under the transform limit", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      symmetry: { order: 9, axis: "y" },
    });

    expect(note()?.classList.contains("hidden")).toBe(true);
    expect(note()?.textContent).toBe("");
  });

  it("shows a reduced-from message when the requested order would exceed the transform limit", () => {
    const ui = new Ui(document);
    // 9-fold over 30 transforms is 270 slots, past the 256-transform cap, so
    // the note should report the largest order that still fits (8).
    const manyTransforms = Array.from(
      { length: 30 },
      () => defaultTransforms()[0],
    );
    ui.updateLabels({
      ...initialState(true),
      transforms: manyTransforms,
      symmetry: { order: 9, axis: "y" },
    });

    expect(note()?.classList.contains("hidden")).toBe(false);
    expect(note()?.textContent).toBe(
      "Reduced to 8-fold (from 9-fold) to fit the 256-transform limit.",
    );
  });
});
