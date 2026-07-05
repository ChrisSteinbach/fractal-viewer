// @vitest-environment jsdom
import { Ui } from "./ui";
import type { UiHandlers } from "./ui";
import { initialState, MAX_COLOR_GAMMA } from "./state";
import { defaultTransforms, PRESET_NAMES } from "../fractal/presets";
import { FLAME_PALETTE_IDS, buildPaletteLUT } from "../fractal/palette";
import { buildColorModeLUT } from "../fractal/color";
import { to255 } from "../fractal/vec";
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
    onSurprise: vi.fn(),
    onNumPointsInput: vi.fn(),
    onPointSizeInput: vi.fn(),
    onGlowBrightnessInput: vi.fn(),
    onRegenerate: vi.fn(),
    onSavePng: vi.fn(),
    onToggleGuides: vi.fn(),
    onColorMode: vi.fn(),
    onColorGammaInput: vi.fn(),
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
    onSolidPaletteChange: vi.fn(),
    onSolidIterationsInput: vi.fn(),
    onSolidResolutionInput: vi.fn(),
    onSymmetryOrderInput: vi.fn(),
    onSymmetryAxisChange: vi.fn(),
    onFourDSliceToggle: vi.fn(),
    onFourDSliceInput: vi.fn(),
    onFourDTumbleToggle: vi.fn(),
    onFourDTumbleSpeedInput: vi.fn(),
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

/** The value readout immediately following an editor slider (see
 * editorSlider above) — the two are always built as adjacent siblings. */
function editorReadout(label: string): HTMLElement {
  const readout = editorSlider(label).nextElementSibling;
  if (!(readout instanceof HTMLElement)) {
    throw new Error(`No readout following the slider labelled "${label}"`);
  }
  return readout;
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

describe("Ui glow brightness slider", () => {
  function glowBrightnessRow(): HTMLElement {
    return document.getElementById("glowBrightnessRow") as HTMLElement;
  }

  it("is hidden while the render style is not glow", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), renderStyle: "depthFade" });
    expect(glowBrightnessRow().classList.contains("hidden")).toBe(true);
  });

  it("is shown while the render style is glow", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), renderStyle: "glow" });
    expect(glowBrightnessRow().classList.contains("hidden")).toBe(false);
  });
});

describe("Ui color contrast slider", () => {
  function colorGammaRow(): HTMLElement {
    return document.getElementById("colorGammaRow") as HTMLElement;
  }

  it("is hidden while the color mode is transform", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "transform" });
    expect(colorGammaRow().classList.contains("hidden")).toBe(true);
  });

  it("is hidden while the color mode is uniform", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "uniform" });
    expect(colorGammaRow().classList.contains("hidden")).toBe(true);
  });

  it("is shown while the color mode is height", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "height" });
    expect(colorGammaRow().classList.contains("hidden")).toBe(false);
  });

  // The slider element holds a log-scale POSITION in [-1, 1], not the gamma —
  // these pin the two ends of that contract: full right is MAX_COLOR_GAMMA,
  // dead center is exactly neutral 1 (no float fuzz — 5 ** 0 === 1), so the
  // default slider state can never drift the persisted gamma off its
  // backwards-compatible linear value.
  it("reports MAX_COLOR_GAMMA when dragged to the far right", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "colorGammaSlider",
    ) as HTMLInputElement;
    slider.value = "1";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onColorGammaInput).toHaveBeenCalledWith(MAX_COLOR_GAMMA);
  });

  it("reports exactly neutral gamma 1 at the slider's center", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "colorGammaSlider",
    ) as HTMLInputElement;
    slider.value = "0";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onColorGammaInput).toHaveBeenCalledWith(1);
  });
});

describe("Ui color legend (fr-dsz)", () => {
  function legend(): HTMLElement {
    return document.getElementById("legend") as HTMLElement;
  }
  function legendBar(): HTMLElement {
    return document.getElementById("legendBar") as HTMLElement;
  }
  function legendLabelLow(): HTMLElement {
    return document.getElementById("legendLabelLow") as HTMLElement;
  }
  function legendLabelMid(): HTMLElement {
    return document.getElementById("legendLabelMid") as HTMLElement;
  }
  function legendLabelHigh(): HTMLElement {
    return document.getElementById("legendLabelHigh") as HTMLElement;
  }
  function legendSwatches(): HTMLElement {
    return document.getElementById("legendSwatches") as HTMLElement;
  }
  function legendText(): HTMLElement {
    return document.getElementById("legendText") as HTMLElement;
  }
  /** The CSS `rgb()` string for LUT entry `index` (0-255) — the same
   * byte-conversion the legend itself uses (color management is disabled,
   * so these bytes match the rendered cloud exactly). */
  function lutRgb(lut: Float32Array, index: number): string {
    const o = index * 3;
    return `rgb(${to255(lut[o])}, ${to255(lut[o + 1])}, ${to255(lut[o + 2])})`;
  }

  it("shows a gradient bar for height mode, blue at the low end and red at the high end", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "height" });

    expect(legend().classList.contains("hidden")).toBe(false);
    expect(legendBar().classList.contains("hidden")).toBe(false);
    expect(legendSwatches().classList.contains("hidden")).toBe(true);
    expect(legendText().classList.contains("hidden")).toBe(true);
    expect(legendLabelLow().textContent).toBe("low");
    expect(legendLabelHigh().textContent).toBe("high");

    // Endpoints derived from the shared ramp (color.ts's writeHeightColor via
    // buildColorModeLUT) rather than hardcoded, so a ramp tweak can't leave
    // this assertion silently checking the wrong colors.
    const lut = buildColorModeLUT("height", 1);
    const background = legendBar().style.backgroundImage;
    const lowRgb = lutRgb(lut, 0);
    const highRgb = lutRgb(lut, 255);
    expect(background).toContain(lowRgb);
    expect(background).toContain(highRgb);
    // Not just present — in this order. A flipped (high→low) gradient would
    // still contain both colors, so containment alone can't catch that.
    expect(background.indexOf(lowRgb)).toBeLessThan(
      background.indexOf(highRgb),
    );
  });

  it("shows a gradient bar for radius mode, warm at the center and cool at the edge", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "radius" });

    expect(legendBar().classList.contains("hidden")).toBe(false);
    expect(legendLabelLow().textContent).toBe("center");
    expect(legendLabelHigh().textContent).toBe("edge");

    const lut = buildColorModeLUT("radius", 1);
    const background = legendBar().style.backgroundImage;
    const centerRgb = lutRgb(lut, 0);
    const edgeRgb = lutRgb(lut, 255);
    expect(background).toContain(centerRgb);
    expect(background).toContain(edgeRgb);
    // Not just present — in this order. A flipped (edge→center) gradient
    // would still contain both colors, so containment alone can't catch that.
    expect(background.indexOf(centerRgb)).toBeLessThan(
      background.indexOf(edgeRgb),
    );
  });

  it("reshapes a mid gradient stop under a non-1 colorGamma while the endpoints stay fixed", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      colorGamma: 1,
    });
    const neutralBackground = legendBar().style.backgroundImage;

    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      colorGamma: 3,
    });
    const gammaBackground = legendBar().style.backgroundImage;

    // The bar as a whole looks different under the reshaped ramp…
    expect(gammaBackground).not.toBe(neutralBackground);
    // …but applyColorGamma always fixes t=0 and t=1, so the two endpoint
    // colors are identical regardless of gamma — only the interior moves.
    const lut = buildColorModeLUT("height", 1);
    expect(gammaBackground).toContain(lutRgb(lut, 0));
    expect(gammaBackground).toContain(lutRgb(lut, 255));
  });

  it("shows text instead of a bar for position mode", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "position" });

    expect(legendBar().classList.contains("hidden")).toBe(true);
    expect(legendSwatches().classList.contains("hidden")).toBe(true);
    expect(legendText().classList.contains("hidden")).toBe(false);
    expect(legendText().textContent).toBe("X→R Y→G Z→B");
  });

  it("shows one swatch per transform, tracking transforms.length after add/remove", () => {
    const ui = new Ui(document);
    const three = Array.from({ length: 3 }, () => defaultTransforms()[0]);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "transform",
      transforms: three,
    });
    expect(legendSwatches().querySelectorAll(".legend-swatch")).toHaveLength(3);

    const five = Array.from({ length: 5 }, () => defaultTransforms()[0]);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "transform",
      transforms: five,
    });
    expect(legendSwatches().querySelectorAll(".legend-swatch")).toHaveLength(5);

    const two = Array.from({ length: 2 }, () => defaultTransforms()[0]);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "transform",
      transforms: two,
    });
    expect(legendSwatches().querySelectorAll(".legend-swatch")).toHaveLength(2);
  });

  it("caps transform swatches at 12 and folds the rest into a '+N' indicator", () => {
    const ui = new Ui(document);
    const thirteen = Array.from({ length: 13 }, () => defaultTransforms()[0]);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "transform",
      transforms: thirteen,
    });

    expect(legendSwatches().querySelectorAll(".legend-swatch")).toHaveLength(
      12,
    );
    expect(legendSwatches().querySelector(".legend-more")?.textContent).toBe(
      "+1",
    );
  });

  it("hides the legend entirely for uniform coloring", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "uniform" });
    expect(legend().classList.contains("hidden")).toBe(true);
  });

  it("hides the legend while a flame render uses the legacy palette", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      flameActive: true,
      flame: { ...initialState(true).flame, paletteId: "legacy" },
    });
    // Legacy flame color is per-producing-transform along the orbit — not a
    // 1D ramp — so there is no strip the legend could truthfully draw.
    expect(legend().classList.contains("hidden")).toBe(true);
  });

  it("shows the active palette strip while a flame render uses a gradient palette", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      // uniform would hide the colorMode legend — proving the palette strip
      // doesn't come from colorMode at all.
      colorMode: "uniform",
      flameActive: true,
      // Not "spectrum": its c coefficients (palette.ts) are all integers, so
      // the cosine ramp is exactly periodic and t=0/t=1 land on the identical
      // color — useless for an endpoint-ordering assertion below. "ember" has
      // a non-integer c on two channels, so its ends genuinely differ.
      flame: { ...initialState(true).flame, paletteId: "ember" },
    });

    expect(legend().classList.contains("hidden")).toBe(false);
    expect(legendBar().classList.contains("hidden")).toBe(false);
    expect(legendSwatches().classList.contains("hidden")).toBe(true);
    expect(legendText().classList.contains("hidden")).toBe(true);
    expect(legendLabelLow().textContent).toBe("");
    expect(legendLabelMid().textContent).toBe("Ember palette");
    expect(legendLabelHigh().textContent).toBe("");

    // Endpoints derived from the very LUT the flame render indexes
    // (buildPaletteLUT), in left-to-right order — the fr-dsz can't-drift bar.
    const lut = buildPaletteLUT("ember");
    if (lut === null) throw new Error("ember must have a LUT");
    const background = legendBar().style.backgroundImage;
    const lowRgb = lutRgb(lut, 0);
    const highRgb = lutRgb(lut, 255);
    expect(background).toContain(lowRgb);
    expect(background).toContain(highRgb);
    expect(background.indexOf(lowRgb)).toBeLessThan(
      background.indexOf(highRgb),
    );
  });

  it("shows the legend again after returning from a flame render", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      flameActive: true,
    });
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      flameActive: false,
    });
    expect(legend().classList.contains("hidden")).toBe(false);
  });

  it("shows the active palette strip while the solid render uses a gradient palette", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      solidActive: true,
      solid: { ...initialState(true).solid, paletteId: "aurora" },
    });

    // voxel.ts's accumulateVoxels colors from the palette's LUT instead of
    // colorMode once a non-"legacy" palette is picked — so the legend shows
    // that palette's strip, named, rather than the colorMode ramp.
    expect(legend().classList.contains("hidden")).toBe(false);
    expect(legendBar().classList.contains("hidden")).toBe(false);
    expect(legendLabelMid().textContent).toBe("Aurora palette");
    expect(legendLabelLow().textContent).toBe("");
    expect(legendLabelHigh().textContent).toBe("");
  });

  it("keeps the legend visible and accurate while the solid render is active with the legacy palette", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      solidActive: true,
      solid: { ...initialState(true).solid, paletteId: "legacy" },
    });
    // The "legacy" solid palette follows colorMode/colorGamma exactly, so
    // the legend (and its gradient bar) stays accurate here.
    expect(legend().classList.contains("hidden")).toBe(false);
    expect(legendBar().classList.contains("hidden")).toBe(false);
  });

  it("swaps the colorMode legend for the palette strip when the solid palette leaves legacy", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      solidActive: true,
      solid: { ...initialState(true).solid, paletteId: "legacy" },
    });
    expect(legend().classList.contains("hidden")).toBe(false);
    // Legacy solid follows colorMode/colorGamma exactly, so this is still the
    // height ramp's own low/high label, not a palette caption.
    expect(legendLabelLow().textContent).toBe("low");

    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      solidActive: true,
      solid: { ...initialState(true).solid, paletteId: "spectrum" },
    });
    expect(legend().classList.contains("hidden")).toBe(false);
    expect(legendLabelMid().textContent).toBe("Spectrum palette");
    expect(legendLabelLow().textContent).toBe("");
  });

  it("shows the legend again after returning from a solid render", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      solidActive: true,
      solid: { ...initialState(true).solid, paletteId: "aurora" },
    });
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      solidActive: false,
      solid: { ...initialState(true).solid, paletteId: "aurora" },
    });
    expect(legend().classList.contains("hidden")).toBe(false);
  });

  /** A state whose first transform carries a non-trivial `w` block, making
   * the system non-flat (affine4.ts's isFlatTransform) and routing the view
   * to the 4D projection. */
  function fourDState(): ReturnType<typeof initialState> {
    const state = initialState(true);
    const [first, ...rest] = state.transforms;
    return {
      ...state,
      transforms: [{ ...first, w: { position: 0.5 } }, ...rest],
    };
  }

  it("shows the diverging w ramp with signed end labels for a 4D system", () => {
    const ui = new Ui(document);
    ui.updateLabels(fourDState());

    expect(legend().classList.contains("hidden")).toBe(false);
    expect(legendBar().classList.contains("hidden")).toBe(false);
    expect(legendSwatches().classList.contains("hidden")).toBe(true);
    expect(legendText().classList.contains("hidden")).toBe(true);
    expect(legendLabelLow().textContent).toBe("−w");
    expect(legendLabelMid().textContent).toBe("in our 3-space");
    expect(legendLabelHigh().textContent).toBe("+w");

    // Hardcoded on purpose: these pin the legend to FOUR_D_VERTEX's GLSL
    // constants (scene.ts), which a TS test cannot import. At s = −1 the
    // shader yields the pure blue side (0.30, 0.60, 1.00), at s = +1 the
    // pure orange side (1.00, 0.50, 0.18), and at s = 0 the dim gray notch
    // 0.38 * 0.30 = 0.114 per channel. If the shader palette changes, this
    // test must change with it — that is the keep-in-sync contract.
    const background = legendBar().style.backgroundImage;
    const blue = "rgb(77, 153, 255)";
    const gray = "rgb(29, 29, 29)";
    const orange = "rgb(255, 128, 46)";
    expect(background).toContain(blue);
    expect(background).toContain(gray);
    expect(background).toContain(orange);
    expect(background.indexOf(blue)).toBeLessThan(background.indexOf(gray));
    expect(background.indexOf(gray)).toBeLessThan(background.indexOf(orange));
  });

  it("shows the 4D legend even in uniform color mode", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...fourDState(), colorMode: "uniform" });
    // The 4D view colors by the rotated w in-shader; colorMode — including
    // uniform's "nothing to key" — simply doesn't apply.
    expect(legend().classList.contains("hidden")).toBe(false);
    expect(legendLabelMid().textContent).toBe("in our 3-space");
  });

  it("keeps the 4D w ramp fixed as color contrast changes", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...fourDState(), colorGamma: 1 });
    const neutral = legendBar().style.backgroundImage;
    ui.updateLabels({ ...fourDState(), colorGamma: MAX_COLOR_GAMMA });
    // Unlike the height/radius ramps (fr-8sk), the shader never applies
    // colorGamma to the w palette — the legend must not pretend it does.
    expect(legendBar().style.backgroundImage).toBe(neutral);
  });

  it("clears the 4D labels when the system returns to flat", () => {
    const ui = new Ui(document);
    ui.updateLabels(fourDState());
    ui.updateLabels({ ...initialState(true), colorMode: "height" });
    expect(legendLabelLow().textContent).toBe("low");
    expect(legendLabelMid().textContent).toBe("");
    expect(legendLabelHigh().textContent).toBe("high");
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

describe("Ui surprise button", () => {
  function surpriseBtn(): HTMLButtonElement {
    return document.getElementById("surpriseBtn") as HTMLButtonElement;
  }

  it("fires onSurprise when Surprise Me is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    surpriseBtn().click();
    expect(handlers.onSurprise).toHaveBeenCalledOnce();
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
      "4D",
      "Position W",
      "Scale W",
      "Rotation W",
      "Shear W",
    ]);
    // 12 axis sliders (4 channels × 3) + 1 weight slider + 8 in the 4D group
    // (Position W, Scale W, 3 Rotation W, 3 Shear W — always built, just
    // collapsed for a w-less transform like this one); a plain transform has
    // no variations, so the Variations group adds no range sliders (just a menu).
    expect(editorSliders()).toHaveLength(21);
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
    expect(editorSliders()).toHaveLength(21);

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
    // meaningless for a map applied to every point. The 4D group is still
    // there, though (fr-bf6.3): both editors get it.
    expect(editorGroupTitles()).toEqual([
      "Position",
      "Rotation",
      "Scale",
      "Shear",
      "Variations",
      "4D",
      "Position W",
      "Scale W",
      "Rotation W",
      "Shear W",
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

// The collapsed "4D" group (fr-bf6.3): the single UI that can create or edit
// a transform's optional `w` extension (see fractal/types.ts's WExtension).
describe("Ui 4D group", () => {
  const flat: Transform = {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  };

  function fourDDetails(): HTMLDetailsElement {
    const details = document.querySelector<HTMLDetailsElement>(
      "#transformEditor details",
    );
    if (!details) throw new Error("No 4D <details> group in the editor");
    return details;
  }

  it("renders closed for a transform with no w block", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(flat, 0);
    expect(fourDDetails().open).toBe(false);
  });

  it("renders open for a transform that already has a w block", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor({ ...flat, w: { position: 0.5 } }, 0);
    expect(fourDDetails().open).toBe(true);
  });

  it("gives the final transform's editor the 4D group too", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(flat, "final");
    expect(document.querySelector("#transformEditor details")).not.toBeNull();
  });

  it("emits a w of exactly { position } when Position W moves, with no other fields materialized", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(flat, 0);

    const positionW = editorSlider("Position W");
    positionW.value = "0.75";
    positionW.dispatchEvent(new Event("input"));

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.w).toStrictEqual({ position: 0.75 });
  });

  it("keeps an explicit zero present rather than pruning it", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor({ ...flat, w: { position: 0.5 } }, 0);

    const positionW = editorSlider("Position W");
    positionW.value = "0";
    positionW.dispatchEvent(new Event("input"));

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.w).toStrictEqual({ position: 0 });
  });

  it("converts a Rotation W slider from degrees to radians and leaves w.scale absent", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(flat, 0);

    const rotationXW = editorSlider("Rotation XW");
    rotationXW.value = "90";
    rotationXW.dispatchEvent(new Event("input"));

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.w?.rotation?.xw).toBeCloseTo(Math.PI / 2);
    expect(geometry.w?.rotation?.yw).toBeUndefined();
    expect(geometry.w?.scale).toBeUndefined();
  });

  it("writes an explicit Shear W field sparsely, alongside no rotation", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(flat, 0);

    const shearXW = editorSlider("Shear XW");
    shearXW.value = "1.2";
    shearXW.dispatchEvent(new Event("input"));

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.w).toStrictEqual({ shear: { xw: 1.2 } });
  });

  it("shows the derived mean scale with an auto marker until Scale W is moved", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor({ ...flat, scale: [0.2, 0.5, 0.8] }, 0);

    // (0.2 + 0.5 + 0.8) / 3 = 0.5
    expect(editorSlider("Scale W").value).toBe("0.5");
    expect(editorReadout("Scale W").textContent).toBe("0.50 (auto)");
  });

  it("drops the auto marker and reports the explicit value once Scale W moves", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor({ ...flat, scale: [0.2, 0.5, 0.8] }, 0);

    const scaleW = editorSlider("Scale W");
    scaleW.value = "0.9";
    scaleW.dispatchEvent(new Event("input"));

    expect(editorReadout("Scale W").textContent).toBe("0.90");
    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.w).toStrictEqual({ scale: 0.9 });
  });

  it("tracks the derived Scale W live as the 3D scale changes while still auto", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor({ ...flat, scale: [0.5, 0.5, 0.5] }, 0);

    const scaleX = editorSlider("Scale X");
    scaleX.value = "1"; // mean now (1 + 0.5 + 0.5) / 3 = 0.6667
    scaleX.dispatchEvent(new Event("input"));

    expect(Number(editorSlider("Scale W").value)).toBeCloseTo(2 / 3);
    expect(editorReadout("Scale W").textContent).toBe("0.67 (auto)");
  });

  it("stops tracking the derived scale once Scale W has been set explicitly", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor({ ...flat, scale: [0.5, 0.5, 0.5] }, 0);

    const scaleW = editorSlider("Scale W");
    scaleW.value = "0.9";
    scaleW.dispatchEvent(new Event("input"));

    const scaleX = editorSlider("Scale X");
    scaleX.value = "1";
    scaleX.dispatchEvent(new Event("input"));

    expect(editorReadout("Scale W").textContent).toBe("0.90");
    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[1][1];
    expect(geometry.w).toStrictEqual({ scale: 0.9 });
  });

  it("emits no w key at all for an ordinary position edit on a w-less transform", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(flat, 0);

    const positionX = editorSlider("Position X");
    positionX.value = "1";
    positionX.dispatchEvent(new Event("input"));

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect("w" in geometry).toBe(false);
  });

  it("re-syncs the 4D sliders when the transform changes under the same selection", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor({ ...flat, w: { position: 0.2 } }, 0);
    // Same index → no rebuild; reflects an external change to w (e.g. a
    // preset swap wouldn't hit this path, but a stable-selection re-render
    // should still pick up whatever the current transform carries).
    ui.renderTransformEditor({ ...flat, w: { position: 0.9 } }, 0);

    expect(editorSlider("Position W").value).toBe("0.9");
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
  function flameEntry(): HTMLElement {
    return document.getElementById("flameEntry") as HTMLElement;
  }
  function flameControls(): HTMLElement {
    return document.getElementById("flameControls") as HTMLElement;
  }

  it("shows the explorer panel and the Render button while inactive", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), flameActive: false });

    expect(explorerControls().classList.contains("hidden")).toBe(false);
    expect(flameEntry().classList.contains("hidden")).toBe(false);
    expect(flameControls().classList.contains("hidden")).toBe(true);
  });

  it("swaps to the flame controls and hides the explorer panel while active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), flameActive: true });

    expect(explorerControls().classList.contains("hidden")).toBe(true);
    expect(flameEntry().classList.contains("hidden")).toBe(true);
    expect(flameControls().classList.contains("hidden")).toBe(false);
  });

  it("hides the Flame Render heading along with its button while active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), flameActive: true });

    expect(flameEntry().querySelector("h3")?.textContent).toBe("Flame Render");
    expect(flameEntry().classList.contains("hidden")).toBe(true);
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
      "12.3M / 20.0M iterations (61%)",
    );
  });

  it("never exceeds 100%, even if done overshoots the budget", () => {
    const ui = new Ui(document);
    ui.setFlameProgress(25_000_000, 20_000_000);
    expect(document.getElementById("flameProgress")?.textContent).toContain(
      "(100%)",
    );
  });

  it("does not claim 100% for a nearly-done progressive frame (fr-99z)", () => {
    const ui = new Ui(document);
    ui.setFlameProgress(19_950_000, 20_000_000); // 99.75% — would round to 100.
    expect(document.getElementById("flameProgress")?.textContent).toContain(
      "(99%)",
    );
  });

  it("clears the estimating busy state set by setFlameEstimating (fr-99z)", () => {
    const ui = new Ui(document);
    ui.setFlameEstimating();

    ui.setFlameProgress(20_000_000, 20_000_000);

    const progress = document.getElementById("flameProgress");
    expect(progress?.classList.contains("flame-progress-estimating")).toBe(
      false,
    );
    expect(progress?.textContent).toBe("20.0M / 20.0M iterations (100%)");
  });
});

describe("Ui.setFlameEstimating", () => {
  it("shows the busy label and adds the estimating modifier class (fr-99z)", () => {
    const ui = new Ui(document);
    ui.setFlameEstimating();

    const progress = document.getElementById("flameProgress");
    expect(progress?.textContent).toBe("applying density estimate…");
    expect(progress?.classList.contains("flame-progress-estimating")).toBe(
      true,
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
  function solidEntry(): HTMLElement {
    return document.getElementById("solidEntry") as HTMLElement;
  }
  function solidControls(): HTMLElement {
    return document.getElementById("solidControls") as HTMLElement;
  }

  it("shows the explorer panel and the Render Solid button while inactive", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), solidActive: false });

    expect(explorerControls().classList.contains("hidden")).toBe(false);
    expect(solidEntry().classList.contains("hidden")).toBe(false);
    expect(solidControls().classList.contains("hidden")).toBe(true);
  });

  it("swaps to the solid controls and hides the explorer panel while active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), solidActive: true });

    expect(explorerControls().classList.contains("hidden")).toBe(true);
    expect(solidEntry().classList.contains("hidden")).toBe(true);
    expect(solidControls().classList.contains("hidden")).toBe(false);
  });

  it("hides the Solid Render heading along with its button while active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), solidActive: true });

    expect(solidEntry().querySelector("h3")?.textContent).toBe("Solid Render");
    expect(solidEntry().classList.contains("hidden")).toBe(true);
  });

  it("names the render mode in the help box while active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), solidActive: true });
    expect(document.getElementById("helpTitle")?.textContent).toBe(
      "Solid Render",
    );
  });

  it("also hides the Flame Render heading and button while the solid render is active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), solidActive: true });
    expect(
      document.getElementById("flameEntry")?.classList.contains("hidden"),
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

  it("offers exactly the registered palettes, in order", () => {
    const values = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#solidPalette option"),
    ).map((o) => o.value);
    expect(values).toEqual([...FLAME_PALETTE_IDS]);
  });

  it("reflects the palette id into the select", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      solid: { ...initialState(true).solid, paletteId: "aurora" },
    });
    expect(
      (document.getElementById("solidPalette") as HTMLSelectElement).value,
    ).toBe("aurora");
  });

  it("reports the selected palette id on change", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const select = document.getElementById("solidPalette") as HTMLSelectElement;
    select.value = "spectrum";
    select.dispatchEvent(new Event("change"));

    expect(handlers.onSolidPaletteChange).toHaveBeenCalledWith("spectrum");
  });
});

// "4D" is a DERIVED property of the system (fr-bf6): there is no fourDActive
// flag to flip in AppState anymore, so these tests build a state whose
// transform list actually carries a non-trivial `w` block — exactly what
// systemIsNonFlat (and so the panel gating) reads.
function nonFlatTransforms(): Transform[] {
  return [{ ...defaultTransforms()[0], w: { position: 0.5 } }];
}

describe("Ui 4D view gating (fr-bf6)", () => {
  function el(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
  }

  it("hides the 4D controls for a flat system", () => {
    const ui = new Ui(document);
    ui.updateLabels(initialState(true));

    expect(el("fourDControls").classList.contains("hidden")).toBe(true);
  });

  // The panel's own heading tells the truth per generation (fr-9uw): the
  // system's dimensionality is a live property since fr-bf6, not a fixed
  // claim about the app.
  it("titles the panel by the system's dimensionality", () => {
    const ui = new Ui(document);

    ui.updateLabels(initialState(true));
    expect(el("panelTitle").textContent).toBe("3D IFS Fractal");

    ui.updateLabels({ ...initialState(true), transforms: nonFlatTransforms() });
    expect(el("panelTitle").textContent).toBe("4D IFS Fractal");

    ui.updateLabels(initialState(true));
    expect(el("panelTitle").textContent).toBe("3D IFS Fractal");
  });

  it("shows the 4D controls and hides flame/solid/symmetry/color/style for a non-flat system", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), transforms: nonFlatTransforms() });

    expect(el("fourDControls").classList.contains("hidden")).toBe(false);
    expect(el("flameEntry").classList.contains("hidden")).toBe(true);
    expect(el("solidEntry").classList.contains("hidden")).toBe(true);
    expect(el("colorModeRow").classList.contains("hidden")).toBe(true);
    expect(el("renderStyleRow").classList.contains("hidden")).toBe(true);
    expect(el("symmetrySection").classList.contains("hidden")).toBe(true);
  });

  // The crucial inversion from the old 4D MODE (fr-bf6): unlike the retired
  // fourDActive flag, which hid the whole editing surface, a non-flat system
  // keeps its presets/transform-list/editor exactly as live and visible as a
  // flat one — only the controls that are genuinely inert while viewing the
  // 4D shader path hide (see the previous test).
  it("keeps the presets block, transform list, and editor visible for a non-flat system", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), transforms: nonFlatTransforms() });

    expect(el("presetSection").classList.contains("hidden")).toBe(false);
    expect(el("transformsSection").classList.contains("hidden")).toBe(false);
    expect(el("transformEditSection").classList.contains("hidden")).toBe(false);
  });

  it("keeps the point-size, regenerate, and guides controls live for a non-flat system", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), transforms: nonFlatTransforms() });

    // explorerControls stays visible (its wrapper is not hidden), so the
    // kept-live controls inside it remain interactive.
    expect(el("explorerControls").classList.contains("hidden")).toBe(false);
    expect(el("pointSizeSlider").classList.contains("hidden")).toBe(false);
    expect(el("regenerateBtn").classList.contains("hidden")).toBe(false);
    expect(el("showGuides").classList.contains("hidden")).toBe(false);
  });

  it("restores flame/solid/color/style controls once the system is flat again", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), transforms: nonFlatTransforms() });
    ui.updateLabels(initialState(true));

    expect(el("fourDControls").classList.contains("hidden")).toBe(true);
    expect(el("flameEntry").classList.contains("hidden")).toBe(false);
    expect(el("solidEntry").classList.contains("hidden")).toBe(false);
    expect(el("colorModeRow").classList.contains("hidden")).toBe(false);
    expect(el("renderStyleRow").classList.contains("hidden")).toBe(false);
    expect(el("symmetrySection").classList.contains("hidden")).toBe(false);
  });

  it("shows the color legend's diverging w ramp for a non-flat system", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      transforms: nonFlatTransforms(),
    });
    // fr-a3q: a non-flat system routes the legend to the 4D projection's
    // diverging w ramp instead of hiding it — colorMode is irrelevant here
    // (color comes from the rotated w in-shader). See the full w-ramp
    // assertions in the "Ui color legend (fr-dsz)" describe block.
    expect(el("legend").classList.contains("hidden")).toBe(false);
    expect(el("legendLabelMid").textContent).toBe("in our 3-space");
  });

  it("names the 4D projection in the help box for a non-flat system", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), transforms: nonFlatTransforms() });
    expect(document.getElementById("helpTitle")?.textContent).toBe(
      "4D Projection",
    );
  });

  // Unlike the old 4D mode (which forced selectedTransform back to camera
  // mode on entry), a non-flat system's transform list stays selectable — but
  // there is still no draggable guide box in the projection, so the canvas
  // help text stays the 4D one regardless of which transform is selected.
  it("keeps the 4D projection help text even with a transform selected", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      transforms: nonFlatTransforms(),
      selectedTransform: 0,
    });
    expect(document.getElementById("helpTitle")?.textContent).toBe(
      "4D Projection",
    );
  });
});

describe("Ui 4D slice controls (fr-6x2)", () => {
  function el(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
  }

  it("reveals the slice-position row and fires the handler when the w-slice is toggled on", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const toggle = el("fourDSliceToggle") as HTMLInputElement;

    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));

    expect(handlers.onFourDSliceToggle).toHaveBeenCalledWith(true);
    expect(el("fourDSliceRow").classList.contains("hidden")).toBe(false);
  });

  it("fires onFourDSliceInput with the slider's numeric value and updates the label", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const slider = el("fourDSliceSlider") as HTMLInputElement;

    slider.value = "-0.35";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onFourDSliceInput).toHaveBeenCalledWith(-0.35);
    expect(el("fourDSliceLabel").textContent).toBe("-0.35");
  });

  it("resetFourDSlice unchecks the toggle, hides the row, and recenters the slider", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const toggle = el("fourDSliceToggle") as HTMLInputElement;
    const slider = el("fourDSliceSlider") as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    slider.value = "0.8";
    slider.dispatchEvent(new Event("input"));

    ui.resetFourDSlice();

    expect(toggle.checked).toBe(false);
    expect(el("fourDSliceRow").classList.contains("hidden")).toBe(true);
    expect(slider.value).toBe("0");
    expect(el("fourDSliceLabel").textContent).toBe("0.00");
  });
});

describe("Ui 4D tumble controls (fr-woc)", () => {
  function el(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
  }

  it("hides the speed row and fires the handler when auto-tumble is toggled off", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const toggle = el("fourDTumbleToggle") as HTMLInputElement;

    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));

    expect(handlers.onFourDTumbleToggle).toHaveBeenCalledWith(false);
    expect(el("fourDTumbleRow").classList.contains("hidden")).toBe(true);
  });

  it("fires onFourDTumbleSpeedInput with the slider's numeric value and updates the label", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const slider = el("fourDTumbleSpeedSlider") as HTMLInputElement;

    slider.value = "2.5";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onFourDTumbleSpeedInput).toHaveBeenCalledWith(2.5);
    expect(el("fourDTumbleSpeedLabel").textContent).toBe("2.5×");
  });

  it("resetFourDTumble(true) checks the toggle, shows the row, and resets the slider to 1.0×", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const toggle = el("fourDTumbleToggle") as HTMLInputElement;
    const slider = el("fourDTumbleSpeedSlider") as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    slider.value = "2.5";
    slider.dispatchEvent(new Event("input"));

    ui.resetFourDTumble(true);

    expect(toggle.checked).toBe(true);
    expect(el("fourDTumbleRow").classList.contains("hidden")).toBe(false);
    expect(slider.value).toBe("1");
    expect(el("fourDTumbleSpeedLabel").textContent).toBe("1.0×");
  });

  it("resetFourDTumble(false) unchecks the toggle, hides the row, and resets the slider to 1.0×", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const toggle = el("fourDTumbleToggle") as HTMLInputElement;
    const slider = el("fourDTumbleSpeedSlider") as HTMLInputElement;
    slider.value = "2.5";
    slider.dispatchEvent(new Event("input"));

    ui.resetFourDTumble(false);

    expect(toggle.checked).toBe(false);
    expect(el("fourDTumbleRow").classList.contains("hidden")).toBe(true);
    expect(slider.value).toBe("1");
    expect(el("fourDTumbleSpeedLabel").textContent).toBe("1.0×");
  });
});

describe("Ui.setSolidProgress", () => {
  it("formats done/budget in millions with a percentage", () => {
    const ui = new Ui(document);
    ui.setSolidProgress(12_345_000, 20_000_000);
    expect(document.getElementById("solidProgress")?.textContent).toBe(
      "12.3M / 20.0M iterations (61%)",
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
