// @vitest-environment jsdom
import { Ui } from "./ui";
import type { UiHandlers } from "./ui";
import {
  FLAME_ITERATION_DETENTS,
  initialState,
  MAX_COLOR_GAMMA,
  MORPH_DETAILS,
  PARAM,
  setFlamePaletteId,
  setSolidPaletteId,
} from "./state";
import type { AppState, ParamSpec } from "./state";
import { applyScalarControl } from "./control-spec";
import type { ScalarControlSpec } from "./control-spec";
import { defaultTransforms, PRESET_NAMES } from "../fractal/presets";
import {
  CUSTOM_PALETTE_ID,
  FLAME_PALETTE_IDS,
  MAX_CUSTOM_PALETTE_STOPS,
  MIN_CUSTOM_PALETTE_STOPS,
  buildPaletteLUT,
} from "../fractal/palette";
import type { RgbStop } from "../fractal/palette";
import {
  buildColorModeLUT,
  LEGACY_POSITION_AXIS_COLORS,
} from "../fractal/color";
import { to255 } from "../fractal/vec";
import { FOUR_D_COLOR_MODES } from "../fractal/types";
import type { Transform } from "../fractal/types";
// Load the production markup itself so the Ui↔DOM contract has one source of
// truth: the constructor throws on any missing element, so renaming or removing
// one in index.html fails these tests instead of silently breaking the app.
import indexHtml from "./index.html?raw";

function noopHandlers(): UiHandlers {
  return {
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onPreset: vi.fn(),
    onSurprise: vi.fn(),
    onDriftToggle: vi.fn(),
    onScalarControl: vi.fn(),
    onRegenerate: vi.fn(),
    onSavePng: vi.fn(),
    onRecordVideoToggle: vi.fn(),
    onSaveToCollection: vi.fn(),
    onOpenGallery: vi.fn(),
    onDriftCollection: vi.fn(),
    onLoadFromCollection: vi.fn(),
    onDeleteFromCollection: vi.fn(),
    onCopyLink: vi.fn(),
    onSelect: vi.fn(),
    onTransformGeometry: vi.fn(),
    onToggleFinalTransform: vi.fn(),
    onFinalTransformGeometry: vi.fn(),
    onTogglePanel: vi.fn(),
    onClosePanel: vi.fn(),
    onRenderMode: vi.fn(),
    onAutoOrbitToggle: vi.fn(),
    onAutoOrbitSpeedInput: vi.fn(),
    onFourDSliceToggle: vi.fn(),
    onFourDSliceInput: vi.fn(),
    onFourDSliceRelColorToggle: vi.fn(),
    onFourDTumbleToggle: vi.fn(),
    onFourDTumbleSpeedInput: vi.fn(),
    onWatchBuild: vi.fn(),
    onCustomPaletteStops: vi.fn(),
    onPositionAxisColors: vi.fn(),
  };
}

/** noopHandlers plus a live scalar pipeline: onScalarControl threads each
 * table-driven edit through applyScalarControl into a local AppState, so
 * tests assert on the state outcome (the behavior), not on which callback
 * carried which value. */
function scalarHandlers(initial: AppState = initialState(true)): {
  handlers: UiHandlers;
  current: () => AppState;
} {
  let state = initial;
  const handlers: UiHandlers = {
    ...noopHandlers(),
    onScalarControl: (spec: ScalarControlSpec, raw: string | boolean) => {
      state = applyScalarControl(state, spec, raw);
    },
  };
  return { handlers, current: () => state };
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

/** Grab one Scale mirror toggle by its aria-label, e.g. "Mirror Scale Y". */
function mirrorButton(label: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `#transformEditor button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`No mirror toggle labelled "${label}"`);
  return button;
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

  it("shows the full scale triple once any axis differs", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        // chiralLace's actual (mirrored, anisotropic) scale (presets.ts).
        scale: [0.54, -0.5, 0.46],
      },
      {
        id: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      },
    ];
    ui.renderTransformList(transforms, null, null);

    // Index 0 after the camera row is the first transform, index 1 the second.
    const buttons = transformButtons();
    expect(buttons[1].textContent).toContain("Scale: [0.54, -0.50, 0.46]");
    expect(buttons[2].textContent).toContain("Scale: 0.50");
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
  it("applies the slider's value to state.pointSize on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "pointSizeSlider",
    ) as HTMLInputElement;
    slider.value = "1.75";
    slider.dispatchEvent(new Event("input"));

    expect(current().pointSize).toBe(1.75);
  });
});

describe("Ui morph detail select (fr-jonj)", () => {
  // Guards against the dropdown and MORPH_DETAILS drifting apart — the
  // options must match exactly, in order (the fourDColor discipline).
  it("offers exactly MORPH_DETAILS, in order", () => {
    const values = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#morphDetail option"),
    ).map((o) => o.value);
    expect(values).toEqual([...MORPH_DETAILS]);
  });

  it("applies a selection to state through the scalar-control table", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const select = document.getElementById("morphDetail") as HTMLSelectElement;
    select.value = "full";
    select.dispatchEvent(new Event("change"));

    expect(current().morphDetail).toBe("full");
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
  it("state.colorGamma reaches MAX_COLOR_GAMMA at the far right", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "colorGammaSlider",
    ) as HTMLInputElement;
    slider.value = "1";
    slider.dispatchEvent(new Event("input"));

    expect(current().colorGamma).toBe(MAX_COLOR_GAMMA);
  });

  it("state.colorGamma is exactly neutral 1 at the center", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "colorGammaSlider",
    ) as HTMLInputElement;
    slider.value = "0";
    slider.dispatchEvent(new Event("input"));

    expect(current().colorGamma).toBe(1);
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

  it("shows X/Y/Z-labeled axis swatches for position mode", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "position" });

    expect(legend().classList.contains("hidden")).toBe(false);
    expect(legendBar().classList.contains("hidden")).toBe(true);
    expect(legendSwatches().classList.contains("hidden")).toBe(false);
    const letters = Array.from(
      legendSwatches().querySelectorAll(".legend-more"),
    ).map((el) => el.textContent);
    expect(letters).toEqual(["X", "Y", "Z"]);
    const swatches = Array.from(
      legendSwatches().querySelectorAll<HTMLElement>(".legend-swatch"),
    ).map((el) => el.style.backgroundColor);
    expect(swatches).toEqual([
      "rgb(255, 0, 0)",
      "rgb(0, 255, 0)",
      "rgb(0, 0, 255)",
    ]);
  });

  it("the axis swatches follow custom axis colors", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "position",
      positionAxisColors: {
        x: [1, 0.5, 0],
        y: [0, 0.5, 1],
        z: [0.2, 0.4, 0.6],
      },
    });

    const swatches = Array.from(
      legendSwatches().querySelectorAll<HTMLElement>(".legend-swatch"),
    ).map((el) => el.style.backgroundColor);
    expect(swatches).toEqual([
      "rgb(255, 128, 0)",
      "rgb(0, 128, 255)",
      "rgb(51, 102, 153)",
    ]);
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
      renderMode: "flame" as const,
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
      renderMode: "flame" as const,
      // Not "spectrum": its c coefficients (palette.ts) are all integers, so
      // the cosine ramp is exactly periodic and t=0/t=1 land on the identical
      // color — useless for an endpoint-ordering assertion below. "ember" has
      // a non-integer c on two channels, so its ends genuinely differ.
      flame: { ...initialState(true).flame, paletteId: "ember" },
    });

    expect(legend().classList.contains("hidden")).toBe(false);
    expect(legendBar().classList.contains("hidden")).toBe(false);
    expect(legendSwatches().classList.contains("hidden")).toBe(true);
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

  it("shows the ramp palette's own colors in the height legend when rampPaletteId is a gradient, with low/high labels unchanged", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      rampPaletteId: "legacy",
    });
    const legacyBackground = legendBar().style.backgroundImage;

    // "ember" (not "spectrum"): its non-integer c coefficients on two
    // channels (palette.ts) are what give the flame palette legend test
    // above a genuine endpoint order too — same reason it applies here.
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      rampPaletteId: "ember",
    });

    expect(legendLabelLow().textContent).toBe("low");
    expect(legendLabelHigh().textContent).toBe("high");
    const background = legendBar().style.backgroundImage;
    expect(background).not.toBe(legacyBackground);

    // Endpoints derived from the same rampPalette-aware LUT the height mode
    // now samples (buildColorModeLUT's third argument), in left-to-right
    // order — the fr-dsz can't-drift bar, extended to fr-3b6's gradient ramps.
    const lut = buildColorModeLUT("height", 1, "ember");
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
      renderMode: "flame" as const,
    });
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
    });
    expect(legend().classList.contains("hidden")).toBe(false);
  });

  it("shows the active palette strip while the solid render uses a gradient palette", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      renderMode: "solid" as const,
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
      renderMode: "solid" as const,
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
      renderMode: "solid" as const,
      solid: { ...initialState(true).solid, paletteId: "legacy" },
    });
    expect(legend().classList.contains("hidden")).toBe(false);
    // Legacy solid follows colorMode/colorGamma exactly, so this is still the
    // height ramp's own low/high label, not a palette caption.
    expect(legendLabelLow().textContent).toBe("low");

    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      renderMode: "solid" as const,
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
      renderMode: "solid" as const,
      solid: { ...initialState(true).solid, paletteId: "aurora" },
    });
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
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
    expect(legendLabelLow().textContent).toBe("−w");
    expect(legendLabelMid().textContent).toBe("in our 3-space");
    expect(legendLabelHigh().textContent).toBe("+w");

    // Hardcoded on purpose: since fr-d47 the side COLORS are shared DATA
    // (color.ts's W_SIDE_PALETTES.wBlueOrange, fed to both the shader's
    // uSideNeg/uSidePos uniforms and this legend) so they can't drift from
    // each other — but the ramp's SHAPE is still hand-mirrored from
    // FOUR_D_VERTEX's GLSL (scene.ts), which a TS test cannot import: the
    // 0.38 gray baseline, the 0.6 magnitude exponent, and the 0.30 + 0.70
    // brightness scale. At s = −1 the shader yields the pure blue side
    // (0.30, 0.60, 1.00), at s = +1 the pure orange side (1.00, 0.50, 0.18),
    // and at s = 0 the dim gray notch 0.38 * 0.30 = 0.114 per channel. If
    // either the shared palette or the GLSL ramp shape changes, this test
    // must change with it — that is the keep-in-sync contract.
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

  // Guards against the dropdown and FOUR_D_COLOR_MODES (fr-d47) drifting
  // apart — the options must match exactly, in order.
  it("offers exactly FOUR_D_COLOR_MODES, in order", () => {
    const values = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#fourDColor option"),
    ).map((o) => o.value);
    expect(values).toEqual([...FOUR_D_COLOR_MODES]);
  });

  it("shows the purple/green w ramp for the wPurpleGreen 4D color mode", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...fourDState(), fourDColor: "wPurpleGreen" });

    expect(legendBar().classList.contains("hidden")).toBe(false);
    expect(legendLabelLow().textContent).toBe("−w");
    expect(legendLabelMid().textContent).toBe("in our 3-space");
    expect(legendLabelHigh().textContent).toBe("+w");

    // Hardcoded on purpose, exactly like the wBlueOrange test above: these
    // pin color.ts's W_SIDE_PALETTES.wPurpleGreen data AND the ramp's
    // mirrored GLSL shape constants (0.38 gray, ^0.6, 0.30 + 0.70).
    const background = legendBar().style.backgroundImage;
    const purple = "rgb(158, 97, 255)";
    const gray = "rgb(29, 29, 29)";
    const green = "rgb(102, 242, 89)";
    expect(background).toContain(purple);
    expect(background).toContain(gray);
    expect(background).toContain(green);
    expect(background.indexOf(purple)).toBeLessThan(background.indexOf(gray));
    expect(background.indexOf(gray)).toBeLessThan(background.indexOf(green));
  });

  it("shows the cyan/magenta w ramp for the wCyanMagenta 4D color mode", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...fourDState(), fourDColor: "wCyanMagenta" });

    expect(legendBar().classList.contains("hidden")).toBe(false);
    expect(legendLabelLow().textContent).toBe("−w");
    expect(legendLabelMid().textContent).toBe("in our 3-space");
    expect(legendLabelHigh().textContent).toBe("+w");

    // Hardcoded on purpose, same rationale as the other two w-depth ramps.
    const background = legendBar().style.backgroundImage;
    const cyan = "rgb(51, 217, 242)";
    const gray = "rgb(29, 29, 29)";
    const magenta = "rgb(255, 77, 191)";
    expect(background).toContain(cyan);
    expect(background).toContain(gray);
    expect(background).toContain(magenta);
    expect(background.indexOf(cyan)).toBeLessThan(background.indexOf(gray));
    expect(background.indexOf(gray)).toBeLessThan(background.indexOf(magenta));
  });

  it("shows a swatch strip, one per transform, for the 4D transform color mode", () => {
    const ui = new Ui(document);
    const state = { ...fourDState(), fourDColor: "transform" as const };
    ui.updateLabels(state);

    expect(legend().classList.contains("hidden")).toBe(false);
    expect(legendBar().classList.contains("hidden")).toBe(true);
    expect(legendSwatches().classList.contains("hidden")).toBe(false);
    expect(legendSwatches().querySelectorAll(".legend-swatch")).toHaveLength(
      state.transforms.length,
    );
  });

  it("shows the radius gradient bar for the 4D radius color mode, unaffected by color contrast", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...fourDState(), fourDColor: "radius" });

    expect(legendBar().classList.contains("hidden")).toBe(false);
    expect(legendLabelLow().textContent).toBe("center");
    expect(legendLabelHigh().textContent).toBe("edge");

    const neutral = legendBar().style.backgroundImage;
    ui.updateLabels({
      ...fourDState(),
      fourDColor: "radius",
      colorGamma: MAX_COLOR_GAMMA,
    });
    // Gamma-neutral contract: the 4D view never applies colorGamma, so the
    // baked radius ramp must not react to it either — mirrors the w-ramp's
    // own "keeps the 4D w ramp fixed as color contrast changes" test above.
    expect(legendBar().style.backgroundImage).toBe(neutral);
  });

  it("shows the ramp palette's own colors in the 4D radius legend when rampPaletteId is a gradient (fr-6ue)", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...fourDState(),
      fourDColor: "radius",
      rampPaletteId: "legacy",
    });
    const legacyBackground = legendBar().style.backgroundImage;

    // "ember" again for a genuine endpoint order — same reason as the flat
    // height legend test above (its non-integer c coefficients on two
    // channels give distinct low/high colors).
    ui.updateLabels({
      ...fourDState(),
      fourDColor: "radius",
      rampPaletteId: "ember",
    });

    expect(legendLabelLow().textContent).toBe("center");
    expect(legendLabelHigh().textContent).toBe("edge");
    const background = legendBar().style.backgroundImage;
    expect(background).not.toBe(legacyBackground);

    // Endpoints derived from the same rampPalette-aware LUT the 4D radius
    // bake now samples (buildColorModeLUT's third argument), gamma pinned to
    // 1 — the 4D view never applies colorGamma.
    const lut = buildColorModeLUT("radius", 1, "ember");
    const lowRgb = lutRgb(lut, 0);
    const highRgb = lutRgb(lut, 255);
    expect(background).toContain(lowRgb);
    expect(background).toContain(highRgb);
    expect(background.indexOf(lowRgb)).toBeLessThan(
      background.indexOf(highRgb),
    );
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

describe("Ui drift button", () => {
  function driftBtn(): HTMLButtonElement {
    return document.getElementById("driftBtn") as HTMLButtonElement;
  }

  it("fires onDriftToggle when Drift is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    driftBtn().click();
    expect(handlers.onDriftToggle).toHaveBeenCalledOnce();
  });

  it("swaps the drift button between idle and stop states", () => {
    const ui = new Ui(document);

    ui.setDriftActive(true);
    expect(driftBtn().textContent).toBe("■ Stop drifting");
    expect(driftBtn().getAttribute("aria-pressed")).toBe("true");
    expect(driftBtn().classList.contains("btn-blue")).toBe(true);
    expect(driftBtn().classList.contains("btn-ghost")).toBe(false);

    ui.setDriftActive(false);
    expect(driftBtn().textContent).toBe("▶ Drift");
    expect(driftBtn().getAttribute("aria-pressed")).toBe("false");
    expect(driftBtn().classList.contains("btn-ghost")).toBe(true);
    expect(driftBtn().classList.contains("btn-blue")).toBe(false);
  });

  it("disables the drift button with an explanation under reduced motion, and restores the authored title when available", () => {
    const ui = new Ui(document);
    const authoredTitle = driftBtn().title;

    ui.setDriftAvailable(false);
    expect(driftBtn().disabled).toBe(true);
    expect(driftBtn().title).toBe(
      "Unavailable: your system asks for reduced motion",
    );

    ui.setDriftAvailable(true);
    expect(driftBtn().disabled).toBe(false);
    expect(driftBtn().title).toBe(authoredTitle);
  });
});

describe("Ui undo/redo controls", () => {
  function undoBtn(): HTMLButtonElement {
    return document.getElementById("undoBtn") as HTMLButtonElement;
  }
  function redoBtn(): HTMLButtonElement {
    return document.getElementById("redoBtn") as HTMLButtonElement;
  }

  it("starts with both buttons disabled, from the markup", () => {
    new Ui(document);
    expect(undoBtn().disabled).toBe(true);
    expect(redoBtn().disabled).toBe(true);
  });

  it("enables undo and leaves redo disabled when only undo is available", () => {
    const ui = new Ui(document);
    ui.setUndoRedo(true, false);
    expect(undoBtn().disabled).toBe(false);
    expect(redoBtn().disabled).toBe(true);
  });

  it("enables redo and leaves undo disabled when only redo is available", () => {
    const ui = new Ui(document);
    ui.setUndoRedo(false, true);
    expect(undoBtn().disabled).toBe(true);
    expect(redoBtn().disabled).toBe(false);
  });

  it("fires onUndo when Undo is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    // Disabled buttons (the markup's starting state) don't dispatch clicks.
    ui.setUndoRedo(true, true);
    undoBtn().click();
    expect(handlers.onUndo).toHaveBeenCalledOnce();
  });

  it("fires onRedo when Redo is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.setUndoRedo(true, true);
    redoBtn().click();
    expect(handlers.onRedo).toHaveBeenCalledOnce();
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

describe("Ui record video button", () => {
  function recordVideoBtn(): HTMLButtonElement {
    return document.getElementById("recordVideoBtn") as HTMLButtonElement;
  }

  it("hides the record video button when capture is unsupported", () => {
    new Ui(document);
    expect(recordVideoBtn().classList.contains("hidden")).toBe(true);
  });

  it("swaps the record button between record and stop states", () => {
    const ui = new Ui(document);

    ui.setRecordingState("0:07");
    expect(recordVideoBtn().textContent).toBe("■ Stop 0:07");
    expect(recordVideoBtn().classList.contains("btn-red")).toBe(true);
    expect(recordVideoBtn().classList.contains("btn-ghost")).toBe(false);

    ui.setRecordingState(null);
    expect(recordVideoBtn().textContent).toBe("● Record video");
    expect(recordVideoBtn().classList.contains("btn-ghost")).toBe(true);
    expect(recordVideoBtn().classList.contains("btn-red")).toBe(false);
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

  it("renders a mirrored (negative) scale as a magnitude slider with its mirror toggle pressed", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        // chiralLace's actual scale (presets.ts): a mirrored Y with unequal
        // magnitudes on the other two axes.
        scale: [0.54, -0.5, 0.46],
      },
      0,
    );

    expect(editorSlider("Scale Y").value).toBe("0.5");
    expect(editorReadout("Scale Y").textContent).toBe("-0.50");
    expect(mirrorButton("Mirror Scale Y").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(mirrorButton("Mirror Scale X").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("preserves the mirror when dragging a mirrored axis's scale slider", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.54, -0.5, 0.46],
      },
      0,
    );

    const scaleY = editorSlider("Scale Y");
    scaleY.value = "0.6";
    scaleY.dispatchEvent(new Event("input"));

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.scale).toEqual([0.54, -0.6, 0.46]);
  });

  it("flips one axis's scale sign when its mirror toggle is clicked", () => {
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

    mirrorButton("Mirror Scale X").click();

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.scale).toEqual([-0.5, 0.5, 0.5]);
    expect(mirrorButton("Mirror Scale X").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(editorReadout("Scale X").textContent).toBe("-0.50");
    expect(editorSlider("Scale X").value).toBe("0.5");
  });

  it("clears the mirror when a pressed toggle is clicked again", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [-0.5, 0.5, 0.5],
      },
      0,
    );

    mirrorButton("Mirror Scale X").click();

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.scale).toEqual([0.5, 0.5, 0.5]);
    expect(mirrorButton("Mirror Scale X").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("re-syncs the mirror toggles when the selection's scale sign changes externally", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const base: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    };
    ui.renderTransformEditor(base, 0);
    // Same index → no rebuild, just a re-sync (guide-box drag / undo path).
    ui.renderTransformEditor({ ...base, scale: [0.5, -0.5, 0.5] }, 0);

    expect(mirrorButton("Mirror Scale Y").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(editorSlider("Scale Y").value).toBe("0.5");
    expect(editorReadout("Scale Y").textContent).toBe("-0.50");
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

  it("renders a mirrored (negative) Scale W as a magnitude slider with the Mirror W toggle pressed", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor({ ...flat, w: { scale: -0.5 } }, 0);

    expect(editorSlider("Scale W").value).toBe("0.5");
    expect(editorReadout("Scale W").textContent).toBe("-0.50");
    expect(mirrorButton("Mirror Scale W").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("preserves the 4D mirror when dragging the Scale W slider", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor({ ...flat, w: { scale: -0.5 } }, 0);

    const scaleW = editorSlider("Scale W");
    scaleW.value = "0.9";
    scaleW.dispatchEvent(new Event("input"));

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.w).toStrictEqual({ scale: -0.9 });
    expect(editorReadout("Scale W").textContent).toBe("-0.90");
  });

  it("flips Scale W's sign without touching its magnitude when Mirror W is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor({ ...flat, w: { scale: 0.9 } }, 0);

    mirrorButton("Mirror Scale W").click();

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.w).toStrictEqual({ scale: -0.9 });
    expect(mirrorButton("Mirror Scale W").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(editorReadout("Scale W").textContent).toBe("-0.90");
    expect(editorSlider("Scale W").value).toBe("0.9");
  });

  it("materializes the negated derived mean as an explicit Scale W when Mirror W is clicked while auto", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    // (0.2 + 0.5 + 0.8) / 3 = 0.5, shown as "0.50 (auto)" until touched.
    ui.renderTransformEditor({ ...flat, scale: [0.2, 0.5, 0.8] }, 0);

    mirrorButton("Mirror Scale W").click();

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.w).toStrictEqual({ scale: -0.5 });
    expect(editorReadout("Scale W").textContent).toBe("-0.50");
    expect(mirrorButton("Mirror Scale W").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("clears the 4D mirror when the pressed Mirror W toggle is clicked again", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor({ ...flat, w: { scale: -0.5 } }, 0);

    mirrorButton("Mirror Scale W").click();

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.w).toStrictEqual({ scale: 0.5 });
    expect(mirrorButton("Mirror Scale W").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("re-syncs the Mirror W toggle when the selection's w.scale changes externally", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor({ ...flat, w: { scale: 0.5 } }, 0);
    // Same index → no rebuild, just a re-sync (undo / external edit path).
    ui.renderTransformEditor({ ...flat, w: { scale: -0.5 } }, 0);

    expect(mirrorButton("Mirror Scale W").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(editorSlider("Scale W").value).toBe("0.5");
    expect(editorReadout("Scale W").textContent).toBe("-0.50");
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

describe("Ui render mode switch (fr-39y)", () => {
  function modeBtn(mode: "points" | "flame" | "solid"): HTMLButtonElement {
    const id = {
      points: "modePointsBtn",
      flame: "modeFlameBtn",
      solid: "modeSolidBtn",
    }[mode];
    return document.getElementById(id) as HTMLButtonElement;
  }
  function renderModeSwitch(): HTMLElement {
    return document.getElementById("renderModeSwitch") as HTMLElement;
  }
  function explorerControls(): HTMLElement {
    return document.getElementById("explorerControls") as HTMLElement;
  }
  function flameControls(): HTMLElement {
    return document.getElementById("flameControls") as HTMLElement;
  }
  function solidControls(): HTMLElement {
    return document.getElementById("solidControls") as HTMLElement;
  }

  it("fires onRenderMode with the flame mode when the flame segment is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    modeBtn("flame").click();
    expect(handlers.onRenderMode).toHaveBeenCalledWith("flame");
  });

  it("fires onRenderMode with the solid mode when the solid segment is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    modeBtn("solid").click();
    expect(handlers.onRenderMode).toHaveBeenCalledWith("solid");
  });

  // Fires even for the segment that's already active (index.html boots with
  // Points pressed) — the click listener carries no active-mode guard.
  it("fires onRenderMode with the points mode when the points segment is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    modeBtn("points").click();
    expect(handlers.onRenderMode).toHaveBeenCalledWith("points");
  });

  function byId(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
  }

  it("shows only the flame controls and marks the flame segment active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), renderMode: "flame" });

    expect(explorerControls().classList.contains("hidden")).toBe(true);
    expect(flameControls().classList.contains("hidden")).toBe(false);
    expect(solidControls().classList.contains("hidden")).toBe(true);
    expect(byId("undoRedoRow").classList.contains("hidden")).toBe(true);
    expect(byId("flameStatus").classList.contains("hidden")).toBe(false);
    expect(byId("solidStatus").classList.contains("hidden")).toBe(true);
    expect(modeBtn("flame").classList.contains("active")).toBe(true);
    expect(modeBtn("flame").getAttribute("aria-pressed")).toBe("true");
    expect(modeBtn("points").getAttribute("aria-pressed")).toBe("false");
  });

  it("shows only the solid controls and marks the solid segment active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), renderMode: "solid" });

    expect(explorerControls().classList.contains("hidden")).toBe(true);
    expect(solidControls().classList.contains("hidden")).toBe(false);
    expect(flameControls().classList.contains("hidden")).toBe(true);
    expect(byId("undoRedoRow").classList.contains("hidden")).toBe(true);
    expect(byId("solidStatus").classList.contains("hidden")).toBe(false);
    expect(byId("flameStatus").classList.contains("hidden")).toBe(true);
    expect(modeBtn("solid").classList.contains("active")).toBe(true);
    expect(modeBtn("solid").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the explorer and marks the points segment active by default", () => {
    const ui = new Ui(document);
    ui.updateLabels(initialState(true));

    expect(explorerControls().classList.contains("hidden")).toBe(false);
    expect(flameControls().classList.contains("hidden")).toBe(true);
    expect(solidControls().classList.contains("hidden")).toBe(true);
    expect(byId("undoRedoRow").classList.contains("hidden")).toBe(false);
    expect(byId("flameStatus").classList.contains("hidden")).toBe(true);
    expect(byId("solidStatus").classList.contains("hidden")).toBe(true);
    expect(modeBtn("points").classList.contains("active")).toBe(true);
    expect(modeBtn("points").getAttribute("aria-pressed")).toBe("true");
  });

  // The accordion reads correctly only if nothing floats between section
  // headers (fr-374p): content wedged between two collapsed <summary> rows
  // looks like the open content of the section above it. So the mode
  // containers hold accordion sections and nothing else — each mode's
  // non-section content (Undo/Redo, the flame/solid status text) lives above
  // the first section, right after the render-mode switch.
  it("keeps every non-section block above the first accordion section", () => {
    for (const containerId of [
      "explorerControls",
      "flameControls",
      "solidControls",
    ]) {
      const children = Array.from(byId(containerId).children);
      expect(children.length).toBeGreaterThan(0);
      for (const child of children) {
        expect(
          child.matches("details.panel-section"),
          `#${containerId} > ${child.tagName.toLowerCase()} floats between accordion sections`,
        ).toBe(true);
      }
    }

    const firstSection = document.querySelector("#panel details.panel-section");
    for (const floatingId of ["undoRedoRow", "flameStatus", "solidStatus"]) {
      const position = byId(floatingId).compareDocumentPosition(firstSection!);
      expect(
        position & Node.DOCUMENT_POSITION_FOLLOWING,
        `#${floatingId} must precede the accordion`,
      ).toBeTruthy();
    }
  });

  // The refactor's whole point (fr-39y): the segmented control itself is
  // never hidden by updateLabels, so flame<->solid is a direct switch rather
  // than a round-trip through Points.
  it("keeps the segmented control usable during a render, for a direct flame<->solid switch", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), renderMode: "flame" });

    expect(renderModeSwitch().classList.contains("hidden")).toBe(false);
    expect(document.body.contains(modeBtn("solid"))).toBe(true);
    expect(modeBtn("solid").disabled).toBe(false);
  });
});

describe("Ui flame render controls", () => {
  it("names the render mode in the help box while active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), renderMode: "flame" });
    expect(document.getElementById("helpTitle")?.textContent).toBe(
      "Flame Render",
    );
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

    // 42M is not itself a detent (fr-79p): its nearest in log space is the
    // 5e7 detent (index 5), so the slider thumb snaps there for display while
    // the label keeps showing the exact stored value.
    const iterationsSlider = document.getElementById(
      "flameIterationsSlider",
    ) as HTMLInputElement;
    expect(iterationsSlider.value).toBe("5");
    expect(document.getElementById("flameIterationsLabel")?.textContent).toBe(
      "42.0M iterations",
    );
  });

  it("reflects a GPU-scale iteration budget in billions in the Quality label (fr-79p)", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      flame: {
        ...initialState(true).flame,
        iterations: 2_000_000_000,
      },
    });

    expect(
      (document.getElementById("flameIterationsSlider") as HTMLInputElement)
        .value,
    ).toBe("10");
    expect(document.getElementById("flameIterationsLabel")?.textContent).toBe(
      "2B iterations",
    );
  });

  it("applies the exposure slider's value to state.flame.exposure on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameExposureSlider",
    ) as HTMLInputElement;
    slider.value = "1.75";
    slider.dispatchEvent(new Event("input"));

    expect(current().flame.exposure).toBe(1.75);
  });

  it("applies the slider's detent index to state.flame.iterations on input (fr-79p)", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameIterationsSlider",
    ) as HTMLInputElement;
    slider.value = "3"; // detent index 3 -> FLAME_ITERATION_DETENTS[3]
    slider.dispatchEvent(new Event("input"));

    expect(current().flame.iterations).toBe(FLAME_ITERATION_DETENTS[3]);
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

  it("applies the gamma slider's value to state.flame.gamma on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameGammaSlider",
    ) as HTMLInputElement;
    slider.value = "4.5";
    slider.dispatchEvent(new Event("input"));

    expect(current().flame.gamma).toBe(4.5);
  });

  it("applies the vibrancy slider's value to state.flame.vibrancy on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameVibrancySlider",
    ) as HTMLInputElement;
    slider.value = "0.25";
    slider.dispatchEvent(new Event("input"));

    expect(current().flame.vibrancy).toBe(0.25);
  });

  it("applies the supersample slider's value to state.flame.supersample on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameSupersampleSlider",
    ) as HTMLInputElement;
    slider.value = "3";
    slider.dispatchEvent(new Event("input"));

    expect(current().flame.supersample).toBe(3);
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

  it("applies the estimator radius slider's value to state.flame.estimatorRadius on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameEstimatorRadiusSlider",
    ) as HTMLInputElement;
    slider.value = "7.5";
    slider.dispatchEvent(new Event("input"));

    expect(current().flame.estimatorRadius).toBe(7.5);
  });

  it("applies the estimator minimum radius slider's value to state.flame.estimatorMinimumRadius on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameEstimatorMinimumRadiusSlider",
    ) as HTMLInputElement;
    slider.value = "2.5";
    slider.dispatchEvent(new Event("input"));

    expect(current().flame.estimatorMinimumRadius).toBe(2.5);
  });

  it("applies the estimator curve slider's value to state.flame.estimatorCurve on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "flameEstimatorCurveSlider",
    ) as HTMLInputElement;
    slider.value = "0.8";
    slider.dispatchEvent(new Event("input"));

    expect(current().flame.estimatorCurve).toBe(0.8);
  });

  // Guards against the dropdown and the palette registry drifting apart — the
  // options must match FLAME_PALETTES exactly, in order (legacy first),
  // followed by the Custom sentinel (fr-55k) last.
  it("offers exactly the registered flame palettes plus Custom, in order", () => {
    const values = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#flamePalette option"),
    ).map((o) => o.value);
    expect(values).toEqual([...FLAME_PALETTE_IDS, CUSTOM_PALETTE_ID]);
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

  it("applies the selected palette id to state.flame.paletteId on change", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const select = document.getElementById("flamePalette") as HTMLSelectElement;
    // Not "spectrum": that's the default since fr-9mw, so setting it
    // wouldn't prove the change handler actually applies a new value.
    select.value = "sunset";
    select.dispatchEvent(new Event("change"));

    expect(current().flame.paletteId).toBe("sunset");
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

  it("formats a >= 1e9 budget in billions, done still in millions (fr-79p)", () => {
    const ui = new Ui(document);
    ui.setFlameProgress(843_200_000, 2_000_000_000);
    expect(document.getElementById("flameProgress")?.textContent).toBe(
      "843.2M / 2B iterations (42%)",
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

describe("Ui.setFlameBackendNote", () => {
  function note(): HTMLElement | null {
    return document.getElementById("flameBackendNote");
  }

  it("is hidden with empty text by default", () => {
    new Ui(document);
    expect(note()?.classList.contains("hidden")).toBe(true);
    expect(note()?.textContent).toBe("");
  });

  it("shows a GPU accumulation message with the adapter label and un-hides", () => {
    const ui = new Ui(document);
    ui.setFlameBackendNote("gpu", "Apple M2");
    expect(note()?.classList.contains("hidden")).toBe(false);
    expect(note()?.textContent).toBe("GPU accumulation (Apple M2)");
  });

  it("omits the parenthetical when no adapter label is given", () => {
    const ui = new Ui(document);
    ui.setFlameBackendNote("gpu");
    expect(note()?.textContent).toBe("GPU accumulation");
  });

  it("shows a CPU accumulation message, ignoring any adapter label", () => {
    const ui = new Ui(document);
    ui.setFlameBackendNote("cpu");
    expect(note()?.textContent).toBe("CPU accumulation");
  });

  it("hides again when passed null", () => {
    const ui = new Ui(document);
    ui.setFlameBackendNote("gpu", "Apple M2");
    ui.setFlameBackendNote(null);
    expect(note()?.classList.contains("hidden")).toBe(true);
    expect(note()?.textContent).toBe("");
  });
});

describe("Ui solid render controls", () => {
  it("names the render mode in the help box while active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), renderMode: "solid" });
    expect(document.getElementById("helpTitle")?.textContent).toBe(
      "Solid Render",
    );
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

  it("applies the threshold slider's value to state.solid.threshold on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "solidThresholdSlider",
    ) as HTMLInputElement;
    slider.value = "0.45";
    slider.dispatchEvent(new Event("input"));

    expect(current().solid.threshold).toBe(0.45);
  });

  it("applies the light azimuth slider's value to state.solid.lightAzimuth on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "solidLightAzimuthSlider",
    ) as HTMLInputElement;
    slider.value = "-90";
    slider.dispatchEvent(new Event("input"));

    expect(current().solid.lightAzimuth).toBe(-90);
  });

  it("applies the light elevation slider's value to state.solid.lightElevation on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "solidLightElevationSlider",
    ) as HTMLInputElement;
    slider.value = "35";
    slider.dispatchEvent(new Event("input"));

    expect(current().solid.lightElevation).toBe(35);
  });

  it("applies the ambient slider's value to state.solid.ambient on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "solidAmbientSlider",
    ) as HTMLInputElement;
    slider.value = "0.4";
    slider.dispatchEvent(new Event("input"));

    expect(current().solid.ambient).toBe(0.4);
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

  it("applies the iterations slider's value to state.solid.iterations on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "solidIterationsSlider",
    ) as HTMLInputElement;
    slider.value = "5000000";
    slider.dispatchEvent(new Event("input"));

    expect(current().solid.iterations).toBe(5_000_000);
  });

  it("applies the resolution slider's value to state.solid.resolution on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "solidResolutionSlider",
    ) as HTMLInputElement;
    slider.value = "224";
    slider.dispatchEvent(new Event("input"));

    expect(current().solid.resolution).toBe(224);
  });

  // Followed by the Custom sentinel (fr-55k) last, mirroring #flamePalette.
  it("offers exactly the registered palettes plus Custom, in order", () => {
    const values = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#solidPalette option"),
    ).map((o) => o.value);
    expect(values).toEqual([...FLAME_PALETTE_IDS, CUSTOM_PALETTE_ID]);
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

  it("applies the selected palette id to state.solid.paletteId on change", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const select = document.getElementById("solidPalette") as HTMLSelectElement;
    // Not "spectrum": that's the default since fr-9mw, so setting it
    // wouldn't prove the change handler actually applies a new value.
    select.value = "sunset";
    select.dispatchEvent(new Event("change"));

    expect(current().solid.paletteId).toBe("sunset");
  });
});

describe("custom palette editor (fr-55k)", () => {
  it("hides the flame custom-palette row while the palette is a preset id", () => {
    const ui = new Ui(document);
    ui.updateLabels(initialState(true));
    expect(
      document
        .getElementById("flameCustomPaletteRow")
        ?.classList.contains("hidden"),
    ).toBe(true);
  });

  it("shows the flame custom-palette row once flame.paletteId is custom", () => {
    const ui = new Ui(document);
    ui.updateLabels(setFlamePaletteId(initialState(true), "custom"));
    expect(
      document
        .getElementById("flameCustomPaletteRow")
        ?.classList.contains("hidden"),
    ).toBe(false);
  });

  it("renders one color input per stop with hex values matching the stops", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      flame: { ...initialState(true).flame, paletteId: "custom" },
      customPalette: {
        stops: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
    });

    const values = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        "#flameCustomPaletteStops input[type='color']",
      ),
    ).map((input) => input.value);
    expect(values).toEqual(["#ff0000", "#00ff00"]);
  });

  it("calls onCustomPaletteStops with the whole parsed stop list when a stop is recolored", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.updateLabels({
      ...initialState(true),
      flame: { ...initialState(true).flame, paletteId: "custom" },
      customPalette: {
        stops: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
    });

    const [first] = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        "#flameCustomPaletteStops input[type='color']",
      ),
    );
    first.value = "#0000ff";
    // The recolor listener is delegated on the stops container, so the event
    // must bubble to be seen.
    first.dispatchEvent(new Event("input", { bubbles: true }));

    expect(handlers.onCustomPaletteStops).toHaveBeenCalledWith([
      [0, 0, 1],
      [0, 1, 0],
    ]);
  });

  it("calls onCustomPaletteStops with the last stop duplicated when + Stop is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.updateLabels({
      ...initialState(true),
      flame: { ...initialState(true).flame, paletteId: "custom" },
      customPalette: {
        stops: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
    });

    document.getElementById("flameCustomPaletteAdd")?.click();

    expect(handlers.onCustomPaletteStops).toHaveBeenCalledWith([
      [1, 0, 0],
      [0, 1, 0],
      [0, 1, 0],
    ]);
  });

  it("calls onCustomPaletteStops with the last stop dropped when − Stop is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.updateLabels({
      ...initialState(true),
      flame: { ...initialState(true).flame, paletteId: "custom" },
      customPalette: {
        stops: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      },
    });

    document.getElementById("flameCustomPaletteRemove")?.click();

    expect(handlers.onCustomPaletteStops).toHaveBeenCalledWith([
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  it("disables + Stop once the palette already has MAX_CUSTOM_PALETTE_STOPS stops", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      flame: { ...initialState(true).flame, paletteId: "custom" },
      customPalette: {
        stops: Array.from(
          { length: MAX_CUSTOM_PALETTE_STOPS },
          (_, i): RgbStop => [i / (MAX_CUSTOM_PALETTE_STOPS - 1), 0, 0],
        ),
      },
    });

    expect(
      (document.getElementById("flameCustomPaletteAdd") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("disables − Stop once the palette is down to MIN_CUSTOM_PALETTE_STOPS stops", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      flame: { ...initialState(true).flame, paletteId: "custom" },
      customPalette: {
        stops: Array.from(
          { length: MIN_CUSTOM_PALETTE_STOPS },
          (_, i): RgbStop => [i / (MIN_CUSTOM_PALETTE_STOPS - 1), 0, 0],
        ),
      },
    });

    expect(
      (document.getElementById("flameCustomPaletteRemove") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("sets the strip's inline background to a CSS gradient", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      flame: { ...initialState(true).flame, paletteId: "custom" },
      customPalette: {
        stops: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
    });

    expect(
      document.getElementById("flameCustomPaletteStrip")?.style.background,
    ).toContain("linear-gradient");
  });

  it("shows the solid custom-palette row keyed on solid.paletteId, independent of flame", () => {
    const ui = new Ui(document);
    ui.updateLabels(setSolidPaletteId(initialState(true), "custom"));
    expect(
      document
        .getElementById("solidCustomPaletteRow")
        ?.classList.contains("hidden"),
    ).toBe(false);
    expect(
      document
        .getElementById("flameCustomPaletteRow")
        ?.classList.contains("hidden"),
    ).toBe(true);
  });
});

describe("Ui ramp palette (fr-3b6)", () => {
  function el(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
  }

  // Mirrors the flame/solid palette select coverage above: the options must
  // match FLAME_PALETTE_IDS exactly, in order, followed by the Custom
  // sentinel — the ramp select shares the same registry.
  it("offers exactly the registered flame palettes plus Custom, in order", () => {
    const values = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#rampPalette option"),
    ).map((o) => o.value);
    expect(values).toEqual([...FLAME_PALETTE_IDS, CUSTOM_PALETTE_ID]);
  });

  // Unlike the flame/solid selects ("By Transform (legacy)" / "By Color Mode
  // (legacy)"), the ramp select's legacy option names the built-in ramps
  // directly — there is no separate colorMode-driven look to defer to here.
  it("labels the legacy option 'Built-in ramp'", () => {
    const legacyOption = document.querySelector<HTMLOptionElement>(
      '#rampPalette option[value="legacy"]',
    );
    expect(legacyOption?.textContent).toBe("Built-in ramp");
  });

  it("is hidden while the color mode is transform", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "transform" });
    expect(el("rampPaletteRow").classList.contains("hidden")).toBe(true);
  });

  it("is shown while the color mode is height", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "height" });
    expect(el("rampPaletteRow").classList.contains("hidden")).toBe(false);
  });

  it("is shown while the color mode is radius", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "radius" });
    expect(el("rampPaletteRow").classList.contains("hidden")).toBe(false);
  });

  it("is hidden while the color mode is position", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "position" });
    expect(el("rampPaletteRow").classList.contains("hidden")).toBe(true);
  });

  it("is hidden while the color mode is uniform", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "uniform" });
    expect(el("rampPaletteRow").classList.contains("hidden")).toBe(true);
  });

  // Since fr-6ue, non-flat visibility keys on fourDColor === "radius", not on
  // colorMode — the default fourDColor ("wBlueOrange") still hides here.
  it("is hidden while non-flat with a w-depth 4D color mode, even with colorMode height", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      transforms: nonFlatTransforms(),
    });
    expect(el("rampPaletteRow").classList.contains("hidden")).toBe(true);
  });

  it("is shown while non-flat once fourDColor is radius, whatever colorMode says (fr-6ue)", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "transform",
      transforms: nonFlatTransforms(),
      fourDColor: "radius",
    });
    // colorMode "transform" would hide the row in flat view (see the
    // "is hidden while the color mode is transform" test above) — showing
    // here proves the non-flat gate reads fourDColor instead of colorMode.
    expect(el("rampPaletteRow").classList.contains("hidden")).toBe(false);
  });

  it("sits statically beneath the flat/4D color-select pair — no re-homing (fr-15g)", () => {
    const ui = new Ui(document);
    // Flat: Color Mode shows, 4D Color hides; the ramp row sits after the
    // pair, inside Appearance.
    ui.updateLabels({ ...initialState(true), colorMode: "height" });
    expect(el("rampPaletteRow").previousElementSibling).toBe(
      el("fourDColorRow"),
    );
    expect(el("rampPaletteRow").closest("details")?.id).toBe(
      "appearanceSection",
    );
    expect(el("fourDColorRow").classList.contains("hidden")).toBe(true);

    // Non-flat: the visible select flips; the ramp row itself never moves —
    // the exclusive-open accordion's gate/gated co-location (fr-6ue) holds
    // statically because exactly one of the pair shows per view.
    ui.updateLabels({
      ...initialState(true),
      transforms: nonFlatTransforms(),
      fourDColor: "radius",
    });
    expect(el("rampPaletteRow").previousElementSibling).toBe(
      el("fourDColorRow"),
    );
    expect(el("fourDColorRow").classList.contains("hidden")).toBe(false);
    expect(el("colorModeRow").classList.contains("hidden")).toBe(true);
  });

  it("shows the ramp custom-palette row once rampPaletteId is custom, with stops reflecting state.customPalette", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      rampPaletteId: "custom",
      customPalette: {
        stops: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
    });

    expect(el("rampCustomPaletteRow").classList.contains("hidden")).toBe(false);
    const values = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        "#rampCustomPaletteStops input[type='color']",
      ),
    ).map((input) => input.value);
    expect(values).toEqual(["#ff0000", "#00ff00"]);
  });

  it("keeps the ramp custom-palette row hidden while rampPaletteId is a preset id", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      rampPaletteId: "spectrum",
    });
    expect(el("rampCustomPaletteRow").classList.contains("hidden")).toBe(true);
  });

  it("shows the ramp custom-stop editor in the 4D view when fourDColor is radius and rampPaletteId is custom (fr-6ue)", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      transforms: nonFlatTransforms(),
      fourDColor: "radius",
      rampPaletteId: "custom",
      customPalette: {
        stops: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
    });

    expect(el("rampCustomPaletteRow").classList.contains("hidden")).toBe(false);
  });

  it("does not show the flame/solid custom-palette rows just because rampPaletteId is custom", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "height",
      rampPaletteId: "custom",
      customPalette: {
        stops: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
    });

    expect(el("flameCustomPaletteRow").classList.contains("hidden")).toBe(true);
    expect(el("solidCustomPaletteRow").classList.contains("hidden")).toBe(true);
  });
});

describe("position axis colors row (fr-8k7)", () => {
  function el(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
  }

  it("shows the row only for the position color mode", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "height" });
    expect(el("positionColorsRow").classList.contains("hidden")).toBe(true);

    ui.updateLabels({ ...initialState(true), colorMode: "position" });
    expect(el("positionColorsRow").classList.contains("hidden")).toBe(false);
  });

  it("hides the row while the system is non-flat", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "position",
      transforms: nonFlatTransforms(),
    });
    expect(el("positionColorsRow").classList.contains("hidden")).toBe(true);
  });

  it("reflects the state's axis colors into the pickers", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "position",
      positionAxisColors: {
        x: [1, 0.5, 0],
        y: [0, 0.5, 1],
        z: [0.2, 0.4, 0.6],
      },
    });

    expect((el("positionAxisX") as HTMLInputElement).value).toBe("#ff8000");
    expect((el("positionAxisY") as HTMLInputElement).value).toBe("#0080ff");
    expect((el("positionAxisZ") as HTMLInputElement).value).toBe("#336699");
  });

  it("reports an axis-picker edit as the full parsed triple", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.updateLabels({ ...initialState(true), colorMode: "position" });

    const y = el("positionAxisY") as HTMLInputElement;
    y.value = "#123456";
    // The listener is delegated on the row, so the event must bubble.
    y.dispatchEvent(new Event("input", { bubbles: true }));

    expect(handlers.onPositionAxisColors).toHaveBeenCalledWith({
      x: [1, 0, 0],
      y: [0x12 / 255, 0x34 / 255, 0x56 / 255],
      z: [0, 0, 1],
    });
  });

  it("reset reports the exact legacy identity", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "position",
      positionAxisColors: {
        x: [1, 0.5, 0],
        y: [0, 0.5, 1],
        z: [0.2, 0.4, 0.6],
      },
    });

    el("positionColorsReset").click();

    expect(handlers.onPositionAxisColors).toHaveBeenCalledWith(
      LEGACY_POSITION_AXIS_COLORS,
    );
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

  it("shows the 4D controls and hides symmetry/color/style for a non-flat system — the render mode switch stays (fr-5b3/fr-4wd)", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), transforms: nonFlatTransforms() });

    expect(el("fourDControls").classList.contains("hidden")).toBe(false);
    // All three render modes stay reachable on a non-flat system — the
    // segmented control is a view-independent switch, unlike the retired
    // flame/solid entry islands it replaced.
    expect(el("renderModeSwitch").classList.contains("hidden")).toBe(false);
    expect(el("colorModeRow").classList.contains("hidden")).toBe(true);
    expect(el("renderStyleRow").classList.contains("hidden")).toBe(true);
    expect(el("symmetrySection").classList.contains("hidden")).toBe(true);
  });

  // The 4D look controls live in Appearance beside their flat siblings
  // (fr-15g) — color is an Appearance concern in both views; the 4D View
  // section keeps only the spatial tumble/slice controls.
  it("shows the 4D Color and depth-fade rows in Appearance only while non-flat (fr-15g)", () => {
    const ui = new Ui(document);

    ui.updateLabels(initialState(true));
    expect(el("fourDColorRow").classList.contains("hidden")).toBe(true);
    expect(el("fourDDepthFadeRow").classList.contains("hidden")).toBe(true);

    ui.updateLabels({ ...initialState(true), transforms: nonFlatTransforms() });
    expect(el("fourDColorRow").classList.contains("hidden")).toBe(false);
    expect(el("fourDDepthFadeRow").classList.contains("hidden")).toBe(false);
    expect(el("fourDColorRow").closest("details")?.id).toBe(
      "appearanceSection",
    );
    expect(el("fourDDepthFadeRow").closest("details")?.id).toBe(
      "appearanceSection",
    );
    expect(el("fourDControls").contains(el("fourDColorRow"))).toBe(false);
  });

  // The 3D View block (auto-orbit, fr-1yn) is the flat-system counterpart of
  // the 4D block: exactly one of the two shows outside a render, and both
  // hide while a render freezes the view's automatic motion.
  it("shows the 3D auto-orbit block only for a flat system outside a render", () => {
    const ui = new Ui(document);
    const flat = initialState(true);

    ui.updateLabels(flat);
    expect(el("threeDControls").classList.contains("hidden")).toBe(false);

    ui.updateLabels({ ...flat, transforms: nonFlatTransforms() });
    expect(el("threeDControls").classList.contains("hidden")).toBe(true);

    ui.updateLabels({ ...flat, renderMode: "flame" as const });
    expect(el("threeDControls").classList.contains("hidden")).toBe(true);

    ui.updateLabels({ ...flat, renderMode: "solid" as const });
    expect(el("threeDControls").classList.contains("hidden")).toBe(true);
  });

  // The 4D view (rotor + slice) is frozen into an active render's worker
  // snapshot (main.ts's fourDRenderSnapshot), so its controls hide during a
  // render exactly like the editing controls do.
  it("hides the 4D tumble/slice controls while a render is active on a non-flat system", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };

    ui.updateLabels({ ...nonFlat, renderMode: "flame" as const });
    expect(el("fourDControls").classList.contains("hidden")).toBe(true);
    expect(el("flameControls").classList.contains("hidden")).toBe(false);

    ui.updateLabels({ ...nonFlat, renderMode: "solid" as const });
    expect(el("fourDControls").classList.contains("hidden")).toBe(true);
    expect(el("solidControls").classList.contains("hidden")).toBe(false);

    ui.updateLabels(nonFlat);
    expect(el("fourDControls").classList.contains("hidden")).toBe(false);
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
    // The list and editor live inside the Transforms accordion section
    // (fr-zoi), so its visibility is theirs.
    expect(el("transformsSection").classList.contains("hidden")).toBe(false);
    expect(el("transformList").closest("details")?.id).toBe(
      "transformsSection",
    );
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
    expect(el("renderModeSwitch").classList.contains("hidden")).toBe(false);
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

  it("fires onFourDSliceRelColorToggle with the checkbox state", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const toggle = el("fourDSliceRelColorToggle") as HTMLInputElement;

    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));

    expect(handlers.onFourDSliceRelColorToggle).toHaveBeenCalledWith(true);
  });

  it("resetFourDSlice unchecks the slice-relative color option", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const toggle = el("fourDSliceRelColorToggle") as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));

    ui.resetFourDSlice();

    expect(toggle.checked).toBe(false);
  });

  it("updateLabels hides the slice-relative color row for the baked 4D color modes and shows it for the w-depth modes", () => {
    const ui = new Ui(document);

    ui.updateLabels({ ...initialState(true), fourDColor: "transform" });
    expect(el("fourDSliceRelColorRow").classList.contains("hidden")).toBe(true);

    ui.updateLabels({ ...initialState(true), fourDColor: "radius" });
    expect(el("fourDSliceRelColorRow").classList.contains("hidden")).toBe(true);

    ui.updateLabels({ ...initialState(true), fourDColor: "wBlueOrange" });
    expect(el("fourDSliceRelColorRow").classList.contains("hidden")).toBe(
      false,
    );
  });
});

describe("Ui 4D depth-fade control (fr-3e0)", () => {
  function toggle(): HTMLInputElement {
    return document.getElementById("fourDDepthFadeToggle") as HTMLInputElement;
  }

  it("applies the checkbox state to state.fourDDepthFade on change", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    toggle().checked = true;
    toggle().dispatchEvent(new Event("change"));

    expect(current().fourDDepthFade).toBe(true);
  });

  // Unlike the session-only slice/tumble toggles, the fade is part of the
  // persisted scene document — so updateLabels must reflect a restored state
  // (boot from a shared link, undo/redo) back into the checkbox.
  it("syncs the checkbox from state via updateLabels", () => {
    const ui = new Ui(document);

    ui.updateLabels({ ...initialState(true), fourDDepthFade: true });
    expect(toggle().checked).toBe(true);

    ui.updateLabels(initialState(true));
    expect(toggle().checked).toBe(false);
  });
});

describe("Ui 3D auto-orbit controls (fr-1yn)", () => {
  function el(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
  }

  it("hides the speed row and fires the handler when auto-orbit is toggled off", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const toggle = el("autoOrbitToggle") as HTMLInputElement;

    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));

    expect(handlers.onAutoOrbitToggle).toHaveBeenCalledWith(false);
    expect(el("autoOrbitRow").classList.contains("hidden")).toBe(true);
  });

  it("fires onAutoOrbitSpeedInput with the slider's numeric value and updates the label", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const slider = el("autoOrbitSpeedSlider") as HTMLInputElement;

    slider.value = "2.5";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onAutoOrbitSpeedInput).toHaveBeenCalledWith(2.5);
    expect(el("autoOrbitSpeedLabel").textContent).toBe("2.5×");
  });

  it("resetAutoOrbit(true) checks the toggle, shows the row, and resets the slider to 1.0×", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const toggle = el("autoOrbitToggle") as HTMLInputElement;
    const slider = el("autoOrbitSpeedSlider") as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    slider.value = "2.5";
    slider.dispatchEvent(new Event("input"));

    ui.resetAutoOrbit(true);

    expect(toggle.checked).toBe(true);
    expect(el("autoOrbitRow").classList.contains("hidden")).toBe(false);
    expect(slider.value).toBe("1");
    expect(el("autoOrbitSpeedLabel").textContent).toBe("1.0×");
  });

  it("resetAutoOrbit(false) unchecks the toggle, hides the row, and resets the slider to 1.0×", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const toggle = el("autoOrbitToggle") as HTMLInputElement;
    const slider = el("autoOrbitSpeedSlider") as HTMLInputElement;
    slider.value = "2.5";
    slider.dispatchEvent(new Event("input"));

    ui.resetAutoOrbit(false);

    expect(toggle.checked).toBe(false);
    expect(el("autoOrbitRow").classList.contains("hidden")).toBe(true);
    expect(slider.value).toBe("1");
    expect(el("autoOrbitSpeedLabel").textContent).toBe("1.0×");
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

  it("applies the order slider's value to state.symmetry.order on input", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "symmetryOrderSlider",
    ) as HTMLInputElement;
    slider.value = "6";
    slider.dispatchEvent(new Event("input"));

    expect(current().symmetry.order).toBe(6);
  });

  it("applies the selected axis to state.symmetry.axis on change", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const select = document.getElementById("symmetryAxis") as HTMLSelectElement;
    select.value = "x";
    select.dispatchEvent(new Event("change"));

    expect(current().symmetry.axis).toBe("x");
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

// fr-2v7: index.html's slider min/max are single-sourced from state.ts's PARAM
// table. This pins every DIRECTLY-mapped slider (HTML range == the parameter's
// value range) against its spec, so editing a range in one place without the
// other fails here. Excluded on purpose (their HTML range is a mapping DOMAIN,
// not the parameter's value range — see control-spec.ts): numPointsSlider and
// colorGammaSlider carry a log-scale position, flameIterationsSlider a detent
// index, and symmetryOrderSlider's max is deliberately capped below its spec.
describe("index.html slider ranges match PARAM (fr-2v7)", () => {
  const doc = new DOMParser().parseFromString(indexHtml, "text/html");
  const attr = (id: string, name: string): string => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(`No #${id} in index.html`);
    const value = el.getAttribute(name);
    if (value === null) throw new Error(`#${id} has no ${name} attribute`);
    return value;
  };

  const DIRECT: ReadonlyArray<[string, ParamSpec]> = [
    ["pointSizeSlider", PARAM.pointSize],
    ["glowBrightnessSlider", PARAM.glowBrightness],
    ["flameExposureSlider", PARAM.flameExposure],
    ["flameGammaSlider", PARAM.flameGamma],
    ["flameVibrancySlider", PARAM.flameVibrancy],
    ["flameEstimatorRadiusSlider", PARAM.estimatorRadius],
    ["flameEstimatorMinimumRadiusSlider", PARAM.estimatorMinimumRadius],
    ["flameEstimatorCurveSlider", PARAM.estimatorCurve],
    ["flameSupersampleSlider", PARAM.flameSupersample],
    ["solidThresholdSlider", PARAM.solidThreshold],
    ["solidLightAzimuthSlider", PARAM.solidLightAzimuth],
    ["solidLightElevationSlider", PARAM.solidLightElevation],
    ["solidAmbientSlider", PARAM.solidAmbient],
    ["solidIterationsSlider", PARAM.solidIterations],
    ["solidResolutionSlider", PARAM.solidResolution],
  ];

  it.each(DIRECT)("%s min/max match its ParamSpec", (id, spec) => {
    expect(attr(id, "min")).toBe(String(spec.min));
    expect(attr(id, "max")).toBe(String(spec.max));
  });

  it("solidResolutionSlider step matches PARAM.solidResolution.snap", () => {
    expect(attr("solidResolutionSlider", "step")).toBe(
      String(PARAM.solidResolution.snap),
    );
  });
});

// fr-zoi: the panel's categories are an exclusive-open accordion of native
// <details name="panel-section"> — one shared name, so the browser closes the
// rest when one opens. These pin the markup contract that behavior rides on;
// jsdom doesn't enforce the exclusivity itself, real browsers do.
describe("panel accordion sections (fr-zoi)", () => {
  const sections = (): HTMLDetailsElement[] =>
    Array.from(
      document.querySelectorAll<HTMLDetailsElement>(
        "#panel details.panel-section",
      ),
    );

  it("every section joins the one exclusive name group and has a summary", () => {
    expect(sections().length).toBeGreaterThanOrEqual(7);
    for (const section of sections()) {
      expect(section.getAttribute("name")).toBe("panel-section");
      expect(section.querySelector("summary")).not.toBeNull();
    }
  });

  it("boots with exactly one section open — Presets", () => {
    const open = sections().filter((section) => section.open);
    expect(open.map((section) => section.id)).toEqual(["presetSection"]);
  });

  // fr-99o: each render mode remembers its own open section; switching modes
  // restores it (defaults: Presets / Tone / Surface). jsdom doesn't enforce
  // the name-group exclusivity — real browsers close the others — so these
  // assert only what Ui itself does: open the target on a mode change.
  const details = (id: string): HTMLDetailsElement => {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLDetailsElement))
      throw new Error(`No <details> #${id}`);
    return el;
  };

  it("entering flame mode opens its Tone section", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), renderMode: "flame" });
    expect(details("flameToneSection").open).toBe(true);
  });

  it("entering solid mode opens its Surface section", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), renderMode: "solid" });
    expect(details("solidSurfaceSection").open).toBe(true);
  });

  it("returning to points restores the explorer's section", () => {
    const ui = new Ui(document);
    const state = initialState(true);
    ui.updateLabels({ ...state, renderMode: "flame" });
    // In a real browser the name group closes Presets when Tone opens;
    // simulate that half of the exchange.
    details("presetSection").open = false;
    ui.updateLabels(state);
    expect(details("presetSection").open).toBe(true);
  });

  it("does not force a section back open while the mode is unchanged", () => {
    const ui = new Ui(document);
    const flame = { ...initialState(true), renderMode: "flame" as const };
    ui.updateLabels(flame);
    details("flameToneSection").open = false; // user collapses it
    ui.updateLabels({ ...flame });
    expect(details("flameToneSection").open).toBe(false);
  });

  it("closes the outgoing mode's section when the new mode has nothing to restore", () => {
    const ui = new Ui(document);
    const state = initialState(true);
    // Deliberately collapse the explorer's open section. jsdom doesn't fire
    // toggle on .open changes, so dispatch it as a browser would.
    const presets = details("presetSection");
    presets.open = false;
    presets.dispatchEvent(new Event("toggle"));

    ui.updateLabels({ ...state, renderMode: "flame" }); // Tone opens
    expect(details("flameToneSection").open).toBe(true);
    ui.updateLabels(state); // points remembers "collapsed everything"

    expect(details("flameToneSection").open).toBe(false);
    expect(presets.open).toBe(false);
  });

  it("keeps the editor's 4D disclosure out of the accordion group", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      },
      0,
    );

    const editorDetails = document.querySelector<HTMLDetailsElement>(
      "#transformEditor details",
    );
    expect(editorDetails).not.toBeNull();
    // The 4D group nests INSIDE the Transforms section; a details name group
    // must not contain nested members, so sharing "panel-section" would hand
    // browsers an invalid group (and the exclusivity would misfire).
    expect(editorDetails?.getAttribute("name")).toBeNull();
  });
});

describe("Ui panel accordion re-anchor (fr-dd4b)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Programmatically open a closed section and fire its toggle — the same
   * event chain updateLabels' per-mode accordion restore produces — with the
   * panel's open class set or not. jsdom implements neither
   * requestAnimationFrame nor scrollIntoView, so both are stubbed (the rAF
   * synchronously, so the re-anchor callback has run by the return).
   */
  function toggleSectionWithPanel(
    panelOpen: boolean,
  ): ReturnType<typeof vi.fn> {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    document.getElementById("panel")?.classList.toggle("open", panelOpen);
    const section = document.getElementById(
      "collectionSection",
    ) as HTMLDetailsElement;
    const summary = section.querySelector("summary") as HTMLElement;
    const scrolled = vi.fn();
    (summary as { scrollIntoView?: unknown }).scrollIntoView = scrolled;
    section.open = true;
    section.dispatchEvent(new Event("toggle"));
    return scrolled;
  }

  it("re-anchors the opened section's summary while the panel is open", () => {
    expect(toggleSectionWithPanel(true)).toHaveBeenCalledTimes(1);
  });

  it("never scrolls while the panel is closed — a phone would pan the page toward the off-screen panel", () => {
    expect(toggleSectionWithPanel(false)).not.toHaveBeenCalled();
  });
});

describe("Ui collection gallery", () => {
  const saved = (
    id: string,
    thumbnail = "data:image/jpeg;base64,x",
    createdAt = 1_700_000_000_000,
  ) => ({ id, encoded: `v1=${id}`, thumbnail, createdAt });

  const cards = () => document.querySelectorAll("#galleryGrid .gallery-card");

  it("opens the modal with one card per saved scene", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openGallery([saved("a"), saved("b")]);
    expect(
      document.getElementById("galleryModal")?.classList.contains("hidden"),
    ).toBe(false);
    expect(cards()).toHaveLength(2);
  });

  it("shows the empty-state and no cards for an empty collection", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openGallery([]);
    expect(
      document.getElementById("galleryEmpty")?.classList.contains("hidden"),
    ).toBe(false);
    expect(cards()).toHaveLength(0);
  });

  it("renders a thumbnail img when present and a placeholder when blank", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openGallery([
      saved("withThumb", "data:image/jpeg;base64,abc"),
      saved("noThumb", ""),
    ]);
    const [first, second] = cards();
    expect(first.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/jpeg;base64,abc",
    );
    expect(second.querySelector("img")).toBeNull();
    expect(second.querySelector(".gallery-card-noimg")).not.toBeNull();
  });

  it("captions a saved-from-a-renderer entry with its mode glyph (fr-75sq)", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openGallery([
      { ...saved("flameScene"), mode: "flame" as const },
      { ...saved("solidScene"), mode: "solid" as const },
      saved("pointsScene"),
    ]);
    const captions = Array.from(
      document.querySelectorAll("#galleryGrid .gallery-card-caption"),
    ).map((el) => el.textContent ?? "");
    expect(captions[0]).toMatch(/^✺ /);
    expect(captions[1]).toMatch(/^◆ /);
    expect(captions[2]).not.toMatch(/^[✺◆]/);
  });

  it("fires onLoadFromCollection with the scene id when a card is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.openGallery([saved("target")]);
    document
      .querySelector<HTMLButtonElement>("#galleryGrid .gallery-card-load")
      ?.click();
    expect(handlers.onLoadFromCollection).toHaveBeenCalledWith("target");
  });

  it("fires onDeleteFromCollection, not onLoadFromCollection, when a card's ✕ is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.openGallery([saved("doomed")]);
    document
      .querySelector<HTMLButtonElement>("#galleryGrid .gallery-card-delete")
      ?.click();
    expect(handlers.onDeleteFromCollection).toHaveBeenCalledWith("doomed");
    expect(handlers.onLoadFromCollection).not.toHaveBeenCalled();
  });

  it("reflects the saved count on the gallery button", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.setCollectionCount(7);
    expect(document.getElementById("collectionCount")?.textContent).toBe("7");
  });

  it("closeGallery hides the modal again", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openGallery([saved("a")]);
    ui.closeGallery();
    expect(
      document.getElementById("galleryModal")?.classList.contains("hidden"),
    ).toBe(true);
  });
});

describe("Ui about dialog", () => {
  function aboutBtn(): HTMLButtonElement {
    return document.getElementById("aboutBtn") as HTMLButtonElement;
  }
  function aboutModal(): HTMLElement {
    return document.getElementById("aboutModal") as HTMLElement;
  }
  function aboutCloseBtn(): HTMLButtonElement {
    return document.getElementById("aboutCloseBtn") as HTMLButtonElement;
  }
  function aboutBackdrop(): HTMLElement {
    return document.getElementById("aboutBackdrop") as HTMLElement;
  }
  function aboutWatchBtn(): HTMLButtonElement {
    return document.getElementById("aboutWatchBtn") as HTMLButtonElement;
  }
  function watchBuildBtn(): HTMLButtonElement {
    return document.getElementById("watchBuildBtn") as HTMLButtonElement;
  }
  function pressEscape(): void {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  }

  it("opens the dialog when the panel's about link is clicked", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    aboutBtn().click();
    expect(aboutModal().classList.contains("hidden")).toBe(false);
  });

  it("closes the dialog when its ✕ is clicked", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openAbout();
    aboutCloseBtn().click();
    expect(aboutModal().classList.contains("hidden")).toBe(true);
  });

  it("closes the dialog when the backdrop is clicked", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openAbout();
    aboutBackdrop().click();
    expect(aboutModal().classList.contains("hidden")).toBe(true);
  });

  it("closes the dialog on Escape while it is open", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openAbout();
    pressEscape();
    expect(aboutModal().classList.contains("hidden")).toBe(true);
  });

  it("rebinds Escape on a reopen after a close", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openAbout();
    ui.closeAbout();
    ui.openAbout();
    pressEscape();
    expect(aboutModal().classList.contains("hidden")).toBe(true);
  });

  it("does not throw when Escape is pressed before the dialog has ever been opened", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    expect(() => pressEscape()).not.toThrow();
  });

  it("fires onWatchBuild from both the dialog's button and the panel's button", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    aboutWatchBtn().click();
    watchBuildBtn().click();

    expect(handlers.onWatchBuild).toHaveBeenCalledTimes(2);
  });
});

describe("Ui replay caption", () => {
  function replayCaption(): HTMLElement {
    return document.getElementById("replayCaption") as HTMLElement;
  }

  it("sets the pill's text and reveals it", () => {
    const ui = new Ui(document);
    ui.setReplayCaption("Point 1 of 500");
    expect(replayCaption().textContent).toBe("Point 1 of 500");
    expect(replayCaption().classList.contains("hidden")).toBe(false);
  });

  it("hides the pill when passed null", () => {
    const ui = new Ui(document);
    ui.setReplayCaption("Point 1 of 500");
    ui.setReplayCaption(null);
    expect(replayCaption().classList.contains("hidden")).toBe(true);
  });
});
