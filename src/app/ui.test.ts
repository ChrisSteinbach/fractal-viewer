// @vitest-environment jsdom
import { Ui } from "./ui";
import type { UiHandlers } from "./ui";
import {
  EXPORT_SCALES,
  FLAME_ITERATION_DETENTS,
  initialState,
  MAX_COLOR_GAMMA,
  MORPH_DETAILS,
  PARAM,
  setBackgroundMode,
  setFlamePaletteId,
  setSolidPaletteId,
  setSurfaceColorSource,
  setSurfacePaletteId,
  setSymmetryOrder,
  SURFACE_COLOR_SOURCES,
} from "./state";
import type { AppState, ParamSpec } from "./state";
import { BACKGROUND_MODES } from "./background";
import { BACKGROUND_SHAPES } from "../fractal/background-shape";
import { applyScalarControl } from "./control-spec";
import type { ScalarControlSpec } from "./control-spec";
import { defaultTransforms, PRESET_NAMES } from "../fractal/presets";
import {
  CUSTOM_PALETTE_ID,
  FLAME_PALETTE_IDS,
  MAX_CUSTOM_PALETTE_STOPS,
  MIN_CUSTOM_PALETTE_STOPS,
} from "../fractal/palette";
import type { RgbStop } from "../fractal/palette";
import {
  buildColorModeLUT,
  LEGACY_POSITION_AXIS_COLORS,
} from "../fractal/color";
import { to255 } from "../fractal/vec";
import { FOUR_D_COLOR_MODES, SYMMETRY_PLANES } from "../fractal/types";
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
    onOpenMutations: vi.fn(),
    onMutationPick: vi.fn(),
    onMutateAgain: vi.fn(),
    onDriftToggle: vi.fn(),
    onScalarControl: vi.fn(),
    onRegenerate: vi.fn(),
    onSavePng: vi.fn(),
    onRecordVideoToggle: vi.fn(),
    onSaveSceneFile: vi.fn(),
    onSaveFlameFile: vi.fn(),
    onSaveToCollection: vi.fn(),
    onOpenGallery: vi.fn(),
    onDriftCollection: vi.fn(),
    onLoadFromCollection: vi.fn(),
    onDeleteFromCollection: vi.fn(),
    onTimelineAddKeyframe: vi.fn(),
    onTimelinePlayToggle: vi.fn(),
    onTimelineExport: vi.fn(),
    onExportCancel: vi.fn(),
    onExportDeliverEarly: vi.fn(),
    onExportTimeline: vi.fn(),
    onTimelineRemoveStep: vi.fn(),
    onTimelineMoveStep: vi.fn(),
    onTimelineStepTiming: vi.fn(),
    onCopyLink: vi.fn(),
    onExportCollection: vi.fn(),
    onImportFile: vi.fn(),
    onSelect: vi.fn(),
    onTransformGeometry: vi.fn(),
    onToggleFinalTransform: vi.fn(),
    onFinalTransformGeometry: vi.fn(),
    onTogglePanel: vi.fn(),
    onClosePanel: vi.fn(),
    onRenderMode: vi.fn(),
    onAutoOrbitToggle: vi.fn(),
    onAutoOrbitSpeedInput: vi.fn(),
    onSurfacePreviewToggle: vi.fn(),
    onSurfaceSkipPreview: vi.fn(),
    onFourDSliceToggle: vi.fn(),
    onFourDSliceInput: vi.fn(),
    onFourDSliceThicknessInput: vi.fn(),
    onFourDSliceRelColorToggle: vi.fn(),
    onFourDTumbleToggle: vi.fn(),
    onFourDTumbleSpeedInput: vi.fn(),
    onWatchBuild: vi.fn(),
    onBalloonInflate: vi.fn(),
    onCustomPaletteStops: vi.fn(),
    onPositionAxisColors: vi.fn(),
    onBackgroundCustom: vi.fn(),
    onFogTint: vi.fn(),
    onBalloonTint: vi.fn(),
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

// Parsed once here at module scope instead of once per test (~433 tests):
// importNode below always deep-clones, so this cached template is never
// mutated by a test, and re-parsing the same 63KB string per test bought
// nothing but the parse cost itself.
const parsed = new DOMParser().parseFromString(indexHtml, "text/html");

beforeEach(() => {
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

describe("surface color source menu", () => {
  // Guards against the <option> list and SURFACE_COLOR_SOURCES drifting
  // apart — nothing previously pinned this select, so a new source added to
  // one but not the other would go unnoticed. Order matters here (unlike the
  // preset menu check above): surface-material.ts's GLSL uColorSource
  // dispatch depends on SURFACE_COLOR_SOURCES' exact index order.
  it("offers exactly the registered surface color sources, in order", () => {
    const values = Array.from(
      document.querySelectorAll<HTMLOptionElement>(
        "#surfaceColorSource option",
      ),
    ).map((o) => o.value);
    expect(values).toEqual([...SURFACE_COLOR_SOURCES]);
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

  it("lists the structural-color fields only for a map that authors them", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        colorIndex: 0.25,
        colorSpeed: 0,
      },
      {
        id: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      },
    ];
    ui.renderTransformList(transforms, null, null);

    const buttons = transformButtons();
    expect(buttons[1].textContent).toContain("Color: 0.25");
    expect(buttons[1].textContent).toContain("Color speed: 0.00");
    // The second map rides the derived slot and the default speed, which are
    // not authoring — nothing to report, exactly like an omitted weight.
    expect(buttons[2].textContent).not.toContain("Color");
  });

  // The selection used to live in className alone — a screen reader heard
  // five identical unnamed-state buttons. aria-pressed is the render-mode
  // switch's pattern, kept live by the full rebuild per change.
  it("exposes the selection to ARIA via aria-pressed on every row", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformList(defaultTransforms(), 2, null);

    const pressed = transformButtons().map((b) =>
      b.getAttribute("aria-pressed"),
    );
    // Camera row, then transforms 1–4: index 2 → the fourth button.
    expect(pressed).toEqual(["false", "false", "false", "true", "false"]);
  });

  it("marks the selected final-transform row pressed too", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const lens: Transform = {
      id: 99,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    ui.renderTransformList(defaultTransforms(), "final", lens);

    const buttons = transformButtons();
    const last = buttons[buttons.length - 1];
    expect(last.textContent).toContain("Final Transform");
    expect(last.getAttribute("aria-pressed")).toBe("true");
    expect(
      buttons.filter((b) => b.getAttribute("aria-pressed") === "true"),
    ).toHaveLength(1);
  });

  it("the list container is a labelled group", () => {
    const list = document.getElementById("transformList");
    expect(list?.getAttribute("role")).toBe("group");
    const title = document.getElementById(
      list?.getAttribute("aria-labelledby") ?? "",
    );
    expect(title?.textContent?.trim()).toBe("Select to edit");
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

describe("Ui scalar control commit phase", () => {
  it("a range with a declared commit reports the commit phase on change, on top of input", () => {
    const onScalarControl = vi.fn();
    const ui = new Ui(document);
    ui.bind({ ...noopHandlers(), onScalarControl });
    const slider = document.getElementById(
      "numPointsSlider",
    ) as HTMLInputElement;

    slider.value = "500";
    slider.dispatchEvent(new Event("input"));
    slider.dispatchEvent(new Event("change"));

    expect(onScalarControl).toHaveBeenCalledTimes(2);
    expect(onScalarControl).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "numPointsSlider" }),
      "500",
    );
    expect(onScalarControl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "numPointsSlider" }),
      "500",
      "commit",
    );
  });

  it("a range with no declared commit reports nothing extra on change", () => {
    const onScalarControl = vi.fn();
    const ui = new Ui(document);
    ui.bind({ ...noopHandlers(), onScalarControl });
    const slider = document.getElementById(
      "pointSizeSlider",
    ) as HTMLInputElement;
    slider.value = "1.5";
    slider.dispatchEvent(new Event("input"));
    onScalarControl.mockClear();

    slider.dispatchEvent(new Event("change"));

    expect(onScalarControl).not.toHaveBeenCalled();
  });
});

describe("Ui morph detail select", () => {
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

describe("Ui export size select", () => {
  // Guards against the dropdown and EXPORT_SCALES drifting apart — the
  // options must match exactly, in order (the morphDetail discipline).
  it("offers exactly EXPORT_SCALES, in order", () => {
    const values = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#exportScale option"),
    ).map((o) => o.value);
    expect(values).toEqual(EXPORT_SCALES.map(String));
  });

  it("applies a selection to state through the scalar-control table", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const select = document.getElementById("exportScale") as HTMLSelectElement;
    select.value = "4";
    select.dispatchEvent(new Event("change"));

    expect(current().exportScale).toBe(4);
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

describe("Ui balloon echo radius row", () => {
  function balloonEchoRow(): HTMLElement {
    return document.getElementById("balloonEchoRow") as HTMLElement;
  }

  function balloonRadiusRow(): HTMLElement {
    return document.getElementById("balloonRadiusRow") as HTMLElement;
  }

  it("is hidden while the balloon echo is off", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), balloonEcho: false });
    expect(balloonRadiusRow().classList.contains("hidden")).toBe(true);
  });

  it("is shown while the balloon echo is on", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), balloonEcho: true });
    expect(balloonRadiusRow().classList.contains("hidden")).toBe(false);
  });

  it("keeps the checkbox available for a non-flat system while the echo is off", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      transforms: nonFlatTransforms(),
      balloonEcho: false,
    });

    expect(balloonEchoRow().classList.contains("hidden")).toBe(false);
    expect(balloonRadiusRow().classList.contains("hidden")).toBe(true);
  });

  it("shows both balloon rows for a non-flat system while the echo is on", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      transforms: nonFlatTransforms(),
      balloonEcho: true,
    });

    expect(balloonEchoRow().classList.contains("hidden")).toBe(false);
    expect(balloonRadiusRow().classList.contains("hidden")).toBe(false);
  });

  it("fires onBalloonInflate when the Inflate button is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    (
      document.getElementById("balloonInflateButton") as HTMLButtonElement
    ).click();

    expect(handlers.onBalloonInflate).toHaveBeenCalledTimes(1);
  });
});

describe("Ui surface balloon rows", () => {
  function surfaceBalloonRow(): HTMLElement {
    return document.getElementById("surfaceBalloonRow") as HTMLElement;
  }
  function surfaceBalloonRadiusRow(): HTMLElement {
    return document.getElementById("surfaceBalloonRadiusRow") as HTMLElement;
  }

  it("hides the radius row while the balloon is off", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
      balloonEcho: false,
    });
    expect(surfaceBalloonRow().classList.contains("hidden")).toBe(false);
    expect(surfaceBalloonRadiusRow().classList.contains("hidden")).toBe(true);
  });

  it("shows the radius row while the balloon is on", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
      balloonEcho: true,
    });
    expect(surfaceBalloonRadiusRow().classList.contains("hidden")).toBe(false);
  });

  it("keeps both rows in a live 4D surface session — the balloon lifts to 4D", () => {
    // The dimension gate is GONE: a 4D IFS session composes the balloon
    // wrapper over its own core exactly as a 3D one does, so the only
    // thing that hides these rows is a FORWARD-orbit session (below).
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
      transforms: nonFlatTransforms(),
      balloonEcho: true,
    });
    expect(surfaceBalloonRow().classList.contains("hidden")).toBe(false);
    expect(surfaceBalloonRadiusRow().classList.contains("hidden")).toBe(false);
  });

  it("keeps both rows for a non-flat system OUTSIDE surface mode", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      transforms: nonFlatTransforms(),
      balloonEcho: true,
    });
    expect(surfaceBalloonRow().classList.contains("hidden")).toBe(false);
    expect(surfaceBalloonRadiusRow().classList.contains("hidden")).toBe(false);
  });

  it("hides both rows when the active surface session is escape-shaped", () => {
    // The balloon is permanently inert for the escape solid — main.ts
    // pushes the session's actual routing decision via
    // setSurfaceSessionKind, independent of fourDSurfaceLive's own
    // document-derived gate.
    const ui = new Ui(document);
    ui.setSurfaceSessionKind("escape");
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
      balloonEcho: true,
    });
    expect(surfaceBalloonRow().classList.contains("hidden")).toBe(true);
    expect(surfaceBalloonRadiusRow().classList.contains("hidden")).toBe(true);
  });

  it("shows both rows again once the session kind resets off escape", () => {
    const ui = new Ui(document);
    ui.setSurfaceSessionKind("escape");
    ui.setSurfaceSessionKind("ifs");
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
      balloonEcho: true,
    });
    expect(surfaceBalloonRow().classList.contains("hidden")).toBe(false);
    expect(surfaceBalloonRadiusRow().classList.contains("hidden")).toBe(false);
  });

  it("hides both rows when the active surface session is a Mandelbulb", () => {
    // Measured, not inherited: the Mandelbulb's interior reaches the ball
    // centre exactly as the escape solid's does, so its echo swallows the
    // camera and every ray hits at t ~ 0 (measured: union DE at the
    // session's own opening eye is exactly 0 at R = 0.35 and 0.9). Same
    // treatment as the escape kind, for the same reason.
    const ui = new Ui(document);
    ui.setSurfaceSessionKind("bulb");
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
      balloonEcho: true,
    });
    expect(surfaceBalloonRow().classList.contains("hidden")).toBe(true);
    expect(surfaceBalloonRadiusRow().classList.contains("hidden")).toBe(true);
  });

  it("fires onBalloonInflate when the surface Inflate button is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    (
      document.getElementById(
        "surfaceBalloonInflateButton",
      ) as HTMLButtonElement
    ).click();

    expect(handlers.onBalloonInflate).toHaveBeenCalledTimes(1);
  });
});

describe("Ui balloon tint", () => {
  function balloonTintRow(): HTMLElement {
    return document.getElementById("balloonTintRow") as HTMLElement;
  }
  function surfaceBalloonTintRow(): HTMLElement {
    return document.getElementById("surfaceBalloonTintRow") as HTMLElement;
  }
  function el(id: string): HTMLInputElement {
    return document.getElementById(id) as HTMLInputElement;
  }

  it("hides the Points tint row while the balloon echo is off", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), balloonEcho: false });
    expect(balloonTintRow().classList.contains("hidden")).toBe(true);
  });

  it("shows the Points tint row while the balloon echo is on", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), balloonEcho: true });
    expect(balloonTintRow().classList.contains("hidden")).toBe(false);
  });

  it("hides the Surface tint row while the balloon is off", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
      balloonEcho: false,
    });
    expect(surfaceBalloonTintRow().classList.contains("hidden")).toBe(true);
  });

  it("shows the Surface tint row while the balloon is on", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
      balloonEcho: true,
    });
    expect(surfaceBalloonTintRow().classList.contains("hidden")).toBe(false);
  });

  it("hides the Surface tint row for an escape surface session even with the balloon on", () => {
    // Mirrors surfaceBalloonRadiusRow's own test above: the balloon is
    // permanently inert for the escape solid, and the tint row rides the
    // exact same surfaceBalloonHidden gate as the radius row.
    const ui = new Ui(document);
    ui.setSurfaceSessionKind("escape");
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
      balloonEcho: true,
    });
    expect(surfaceBalloonTintRow().classList.contains("hidden")).toBe(true);
  });

  it("hides the Surface tint row for a Mandelbulb surface session even with the balloon on", () => {
    const ui = new Ui(document);
    ui.setSurfaceSessionKind("bulb");
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
      balloonEcho: true,
    });
    expect(surfaceBalloonTintRow().classList.contains("hidden")).toBe(true);
  });

  it("reports a Points picker edit as the raw hex value", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.updateLabels(initialState(true));

    const input = el("balloonTintColor");
    input.value = "#336699";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(handlers.onBalloonTint).toHaveBeenCalledWith("#336699");
  });

  it("reports a Surface picker edit as the raw hex value through the SAME handler", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.updateLabels(initialState(true));

    const input = el("surfaceBalloonTintColor");
    input.value = "#996633";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(handlers.onBalloonTint).toHaveBeenCalledWith("#996633");
  });

  it("reflects a non-default balloonTint into BOTH pickers (gallery loads/undo move the swatch)", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), balloonTint: "#336699" });
    expect(el("balloonTintColor").value).toBe("#336699");
    expect(el("surfaceBalloonTintColor").value).toBe("#336699");
  });

  it("names both color inputs for assistive tech (their labels carry no text)", () => {
    new Ui(document);
    expect(el("balloonTintColor").getAttribute("aria-label")).toBe(
      "Balloon echo tint color",
    );
    expect(el("surfaceBalloonTintColor").getAttribute("aria-label")).toBe(
      "Balloon echo tint color",
    );
  });
});

describe("Ui surface ground plane row", () => {
  function surfaceGroundPlaneRow(): HTMLElement {
    return document.getElementById("surfaceGroundPlaneRow") as HTMLElement;
  }

  it("shows the row for an ifs surface session", () => {
    const ui = new Ui(document);
    ui.setSurfaceSessionKind("ifs");
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
    });
    expect(surfaceGroundPlaneRow().classList.contains("hidden")).toBe(false);
  });

  it("shows the row for an escape surface session too — unlike the balloon row, which hides there", () => {
    const ui = new Ui(document);
    ui.setSurfaceSessionKind("escape");
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
    });
    expect(surfaceGroundPlaneRow().classList.contains("hidden")).toBe(false);
  });

  it("shows the row for a Mandelbulb session too — the floor survives where the balloon degenerates", () => {
    const ui = new Ui(document);
    ui.setSurfaceSessionKind("bulb");
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
    });
    expect(surfaceGroundPlaneRow().classList.contains("hidden")).toBe(false);
  });

  it("shows the row in a live 4D surface session too — the floor lifts to 4D", () => {
    // The w-slice the floor drops under is an ordinary 3D object, so the
    // row now carries no gate at all: every session kind, both dimensions.
    const ui = new Ui(document);
    ui.setSurfaceSessionKind("ifs");
    ui.updateLabels({
      ...initialState(true),
      renderMode: "surface" as const,
      transforms: nonFlatTransforms(),
    });
    expect(surfaceGroundPlaneRow().classList.contains("hidden")).toBe(false);
  });

  it("keeps the row stable OUTSIDE surface mode", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      transforms: nonFlatTransforms(),
    });
    expect(surfaceGroundPlaneRow().classList.contains("hidden")).toBe(false);
  });
});

describe("Ui surface palette row", () => {
  function surfacePaletteRow(): HTMLElement {
    return document.getElementById("surfacePaletteRow") as HTMLElement;
  }

  it('is hidden while the surface colorSource is not "palette"', () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      surface: { ...initialState(true).surface, colorSource: "height" },
    });
    expect(surfacePaletteRow().classList.contains("hidden")).toBe(true);
  });

  it('is shown while the surface colorSource is "palette"', () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      surface: { ...initialState(true).surface, colorSource: "palette" },
    });
    expect(surfacePaletteRow().classList.contains("hidden")).toBe(false);
  });

  it('is shown while the surface colorSource is "rings"', () => {
    // rings/sheets ride the same user-selected palette as "palette" — just a
    // different orbit-trap coordinate off the same descent — so the palette
    // picker must stay reachable for all three.
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      surface: { ...initialState(true).surface, colorSource: "rings" },
    });
    expect(surfacePaletteRow().classList.contains("hidden")).toBe(false);
  });

  it('is shown while the surface colorSource is "sheets"', () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      surface: { ...initialState(true).surface, colorSource: "sheets" },
    });
    expect(surfacePaletteRow().classList.contains("hidden")).toBe(false);
  });
});

describe("Ui surface color speed row", () => {
  function surfaceColorSpeedRow(): HTMLElement {
    return document.getElementById("surfaceColorSpeedRow") as HTMLElement;
  }

  it('is shown while the surface colorSource is "palette"', () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      surface: { ...initialState(true).surface, colorSource: "palette" },
    });
    expect(surfaceColorSpeedRow().classList.contains("hidden")).toBe(false);
  });

  it('is hidden while the surface colorSource is "rings"', () => {
    // Unlike surfacePaletteRow, the color-speed slider shapes only the
    // "palette" source's own orbit-trap blend weight — inert for rings/sheets
    // (a different coordinate off the same descent), so it hides for them.
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      surface: { ...initialState(true).surface, colorSource: "rings" },
    });
    expect(surfaceColorSpeedRow().classList.contains("hidden")).toBe(true);
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
  // neutral value.
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

describe("Ui color legend painting", () => {
  // WHICH legend a state calls for — the family, the gradient, the labels —
  // is `legend-spec.ts`'s `deriveLegend`, covered without a DOM at all in
  // legend-spec.test.ts. What is left here is the PAINTING: that the panel
  // shows the spec it was handed, that the palette captions come from
  // index.html's own option labels, and that a repaint leaves nothing stale.
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
    return `rgb(${to255(lut[index * 3])}, ${to255(lut[index * 3 + 1])}, ${to255(
      lut[index * 3 + 2],
    )})`;
  }
  /** A state whose first transform carries a non-trivial `w` block, making
   * the system non-flat (affine4.ts's isFlatTransform) and routing the view
   * to the 4D projection. */
  function fourDState(): AppState {
    const state = initialState(true);
    const [first, ...rest] = state.transforms;
    return {
      ...state,
      transforms: [{ ...first, w: { position: 0.5 } }, ...rest],
    };
  }

  it("paints a gradient bar with its three labels, hiding the swatch strip", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "height" });

    expect(legend().classList.contains("hidden")).toBe(false);
    expect(legendBar().classList.contains("hidden")).toBe(false);
    expect(legendSwatches().classList.contains("hidden")).toBe(true);
    expect(legendLabelLow().textContent).toBe("low");
    expect(legendLabelMid().textContent).toBe("");
    expect(legendLabelHigh().textContent).toBe("high");

    // The bar carries the derived gradient itself, endpoints derived from
    // the shared ramp (buildColorModeLUT) rather than hardcoded.
    const lut = buildColorModeLUT("height", 1);
    const background = legendBar().style.backgroundImage;
    expect(background).toContain(lutRgb(lut, 0));
    expect(background).toContain(lutRgb(lut, 255));
  });

  it("paints a swatch strip as labeled spans, hiding the bar", () => {
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

  it("hides the legend entirely for uniform coloring", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), colorMode: "uniform" });
    expect(legend().classList.contains("hidden")).toBe(true);
  });

  it("captions a palette bar with index.html's own option label", () => {
    // index.html's option text is the app's single source of palette display
    // names — the one input `deriveLegend` cannot derive, so this is where
    // the `<select>` lookup is pinned.
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      colorMode: "uniform",
      renderMode: "flame" as const,
      flame: { ...initialState(true).flame, paletteId: "ember" },
    });

    expect(legend().classList.contains("hidden")).toBe(false);
    expect(legendLabelMid().textContent).toBe("Ember palette");
  });

  it("clears the previous family's labels when the legend family changes", () => {
    const ui = new Ui(document);
    ui.updateLabels(fourDState());
    ui.updateLabels({ ...initialState(true), colorMode: "height" });
    expect(legendLabelLow().textContent).toBe("low");
    expect(legendLabelMid().textContent).toBe("");
    expect(legendLabelHigh().textContent).toBe("high");
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

  // Guards against the dropdown and FOUR_D_COLOR_MODES drifting apart
  // — the options must match exactly, in order.
  it("offers exactly FOUR_D_COLOR_MODES, in order", () => {
    const values = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#fourDColor option"),
    ).map((o) => o.value);
    expect(values).toEqual([...FOUR_D_COLOR_MODES]);
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
  it("builds position, rotation, scale, weight, color, finish, and variation controls for the selection", () => {
    const transforms = defaultTransforms();
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(transforms[0], 0, transforms.length);

    expect(editorGroupTitles()).toEqual([
      "Position",
      "Rotation",
      "Scale",
      "Shear",
      "Weight",
      "Color",
      "Finish",
      "Pattern",
      "Variations",
      "4D",
      "Position W",
      "Scale W",
      "Rotation W",
      "Shear W",
    ]);
    // 12 axis sliders (4 channels × 3) + 1 weight slider + 2 color sliders
    // (Index, Speed) + 6 finish sliders + 2 pattern sliders (Scale,
    // Strength) + 8 in the 4D group (Position W, Scale W, 3 Rotation W,
    // 3 Shear W — always built, just collapsed for a w-less transform like
    // this one); a plain transform has no variations, so the Variations
    // group adds no range sliders (just a menu).
    expect(editorSliders()).toHaveLength(31);
  });

  it("opens only Position for a flat transform", () => {
    const transforms = defaultTransforms();
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(transforms[0], 0, transforms.length);

    const open = [
      ...document.querySelectorAll<HTMLDetailsElement>(
        "#transformEditor details[open]",
      ),
    ].map((d) => d.querySelector("summary")?.textContent);
    expect(open).toEqual(["Position"]);
  });

  it("groups every editor section under one exclusive disclosure name", () => {
    const transforms = defaultTransforms();
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(transforms[0], 0, transforms.length);

    // The ten top-level groups; the 4D sub-groups stay plain divs, since a
    // second level of exclusivity inside 4D would close Position W to read
    // Rotation W.
    const names = [
      ...document.querySelectorAll<HTMLDetailsElement>(
        "#transformEditor > details",
      ),
    ].map((d) => d.getAttribute("name"));
    expect(names).toHaveLength(10);
    expect(new Set(names).size).toBe(1);
  });

  it("keeps the group the user opened when the selection changes", () => {
    const transforms = defaultTransforms();
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(transforms[0], 0, transforms.length);

    // jsdom implements neither the exclusive-name behaviour nor the implicit
    // toggle event, so opening a group by hand is spelled out: the browser
    // would close Position itself and fire both events.
    const rotation = [
      ...document.querySelectorAll<HTMLDetailsElement>(
        "#transformEditor > details",
      ),
    ].find((d) => d.querySelector("summary")?.textContent === "Rotation");
    rotation!.open = true;
    rotation!.dispatchEvent(new Event("toggle"));

    ui.renderTransformEditor(transforms[1], 1, transforms.length);

    const open = [
      ...document.querySelectorAll<HTMLDetailsElement>(
        "#transformEditor details[open]",
      ),
    ].map((d) => d.querySelector("summary")?.textContent);
    expect(open).toEqual(["Rotation"]);
  });

  it("falls back to Position when the remembered group has no final-transform counterpart", () => {
    const transforms = defaultTransforms();
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(transforms[0], 0, transforms.length);

    const color = [
      ...document.querySelectorAll<HTMLDetailsElement>(
        "#transformEditor > details",
      ),
    ].find((d) => d.querySelector("summary")?.textContent === "Color");
    color!.open = true;
    color!.dispatchEvent(new Event("toggle"));

    // The final transform builds no Color group — a lens applied to every
    // point has no per-map color — so the remembered choice cannot be honored.
    ui.renderTransformEditor(transforms[0], "final", transforms.length);

    const open = [
      ...document.querySelectorAll<HTMLDetailsElement>(
        "#transformEditor details[open]",
      ),
    ].map((d) => d.querySelector("summary")?.textContent);
    expect(open).toEqual(["Position"]);
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
      1,
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
      1,
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
      1,
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
      1,
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
      1,
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
      1,
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
      1,
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
    ui.renderTransformEditor(base, 0, 1);
    // Same index → no rebuild, just a re-sync (guide-box drag / undo path).
    ui.renderTransformEditor({ ...base, scale: [0.5, -0.5, 0.5] }, 0, 1);

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
      1,
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
      1,
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
    ui.renderTransformEditor(base, 0, 1);
    // Same index → no rebuild; a drag moved X, so that slider should follow.
    ui.renderTransformEditor({ ...base, position: [1, 0, 0] }, 0, 1);

    expect(editorSlider("Position X").value).toBe("1");
  });

  it("clears the editor in camera mode", () => {
    const transforms = defaultTransforms();
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(transforms[0], 0, transforms.length);
    expect(editorSliders()).toHaveLength(31);

    ui.renderTransformEditor(null, null, 1);
    expect(document.getElementById("transformEditor")?.children).toHaveLength(
      0,
    );
  });
});

describe("Ui transform color editor", () => {
  /** A map that authors neither optional color field — the overwhelmingly
   * common case, and the one whose absence has to survive every round trip. */
  const unauthored: Transform = {
    id: 1,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  };

  it("shows the derived palette slot for a map that authors none", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    // Map 1 of a four-map system: chaos-game.ts spreads the slots evenly, so
    // this one falls on 1/3 — the value the flame kernels themselves use.
    ui.renderTransformEditor(unauthored, 1, 4);

    expect(editorReadout("Color index").textContent).toBe("0.33");
    expect(Number(editorSlider("Color index").value)).toBeCloseTo(1 / 3, 2);
  });

  it("shows the default color speed for a map that authors none", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(unauthored, 1, 4);

    expect(editorReadout("Color speed").textContent).toBe("0.50");
  });

  it("shows an authored palette slot instead of the derived one", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor({ ...unauthored, colorIndex: 0.8 }, 1, 4);

    expect(editorReadout("Color index").textContent).toBe("0.80");
  });

  it("omits the Color group for the final transform", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    // The lens is applied to every plotted point and is never PICKED, so it
    // never moves the color coordinate — a pair of sliders here would be dead.
    ui.renderTransformEditor({ ...unauthored, id: 0 }, "final", 4);

    expect(editorGroupTitles()).not.toContain("Color");
    expect(
      document.querySelector(
        "#transformEditor input[aria-label='Color index']",
      ),
    ).toBeNull();
  });

  it("authors colorIndex on the transform when the Index slider moves", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(unauthored, 1, 4);

    const index = editorSlider("Color index");
    index.value = "0.75";
    index.dispatchEvent(new Event("input"));

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.colorIndex).toBe(0.75);
    expect(editorReadout("Color index").textContent).toBe("0.75");
  });

  it("authors colorSpeed independently of the palette slot", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(unauthored, 1, 4);

    const speed = editorSlider("Color speed");
    speed.value = "0";
    speed.dispatchEvent(new Event("input"));

    // Pinning the coordinate (flam3's "symmetry" xform) must not drag the
    // still-derived slot along into the document.
    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.colorSpeed).toBe(0);
    expect(geometry).not.toHaveProperty("colorIndex");
  });

  it("leaves both color keys absent when an unrelated axis is edited", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(unauthored, 1, 4);

    const positionX = editorSlider("Position X");
    positionX.value = "0.4";
    positionX.dispatchEvent(new Event("input"));

    // Absence is load-bearing (types.ts): displaying the derived slot must
    // never materialize it, or every edited scene would start carrying color
    // fields it never authored — and would stop tracking the derived spread.
    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry).not.toHaveProperty("colorIndex");
    expect(geometry).not.toHaveProperty("colorSpeed");
  });

  it("emits nothing when a transform is merely selected and deselected", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(unauthored, 1, 4);
    ui.renderTransformEditor(null, null, 4);

    expect(handlers.onTransformGeometry).not.toHaveBeenCalled();
  });

  it("returns the Index row to the derived slot when an undo drops the key", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor({ ...unauthored, colorIndex: 0.8 }, 1, 4);
    // Same index → no rebuild, just a re-sync (the undo / guide-drag path).
    ui.renderTransformEditor(unauthored, 1, 4);

    expect(editorReadout("Color index").textContent).toBe("0.33");
  });

  it("re-resolves the derived slot when the system's map count changes", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(unauthored, 1, 4);
    // A map was removed elsewhere in the system: the selection didn't move,
    // but map 1 of 3 now sits halfway along the ramp instead of a third.
    ui.renderTransformEditor(unauthored, 1, 3);

    expect(editorReadout("Color index").textContent).toBe("0.50");
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
    ui.renderTransformEditor(lens, "final", 1);

    // Same channels as a transform, but no Weight group — a selection weight
    // is meaningless for a map applied to every point. The 4D group is still
    // there, though: both editors get it.
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
    ui.renderTransformEditor(lens, "final", 1);

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
    ui.renderTransformEditor(plain, 0, 1);

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

  it("adds a fold variation carrying none of its optional lengths, so it renders as the classic Mandelbox", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(plain, 0, 1);

    const select = addSelect();
    select.value = "mandelbox";
    select.dispatchEvent(new Event("change"));

    // Absent means the classic 0.5 / 1 / 1, so a freshly added fold must
    // not materialize them — the add-dropdown has no opinion about the
    // fold's apparatus.
    expect(lastGeometry(handlers).variations).toEqual([
      { type: "mandelbox", weight: 1 },
    ]);
  });

  it("picks up a fold length that changed under a stable selection, instead of writing the stale one back", () => {
    // The editor keeps a WORKING COPY of the variation list and emits it on
    // the next edit, refreshing it only when the incoming list differs. A
    // comparison that only looked at type and weight would call these two
    // renders equal — and the weight drag below would then silently revert
    // `minRadius` to 0.3. A morph, an undo or a timeline leg all change a
    // radius under a stable selection, and none of them touches the fold's
    // own rows.
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const at = (minRadius: number): Transform => ({
      ...plain,
      variations: [{ type: "mandelbox", weight: 2, minRadius }],
    });
    ui.renderTransformEditor(at(0.3), 0, 1);
    ui.renderTransformEditor(at(0.4), 0, 1);

    const slider = editorSlider("Variation mandelbox");
    slider.value = "1.5";
    slider.dispatchEvent(new Event("input"));

    expect(lastGeometry(handlers).variations).toEqual([
      { type: "mandelbox", weight: 1.5, minRadius: 0.4 },
    ]);
  });

  it("offers only the lengths a fold actually reads", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const labelsFor = (type: "boxfold" | "spherefold" | "mandelbox") => {
      ui.renderTransformEditor(
        { ...plain, variations: [{ type, weight: 1 }] },
        0,
        1,
      );
      return Array.from(
        document.querySelectorAll<HTMLElement>(
          "#transformEditor .variation-fold-row .axis",
        ),
      ).map((el) => el.textContent);
    };
    // A box fold has no sphere and a sphere fold has no wall (measured: a
    // box-fold link's mR/fR are inert).
    expect(labelsFor("boxfold")).toEqual(["Box limit"]);
    expect(labelsFor("spherefold")).toEqual(["Min radius", "Fixed radius"]);
    expect(labelsFor("mandelbox")).toEqual([
      "Min radius",
      "Fixed radius",
      "Box limit",
    ]);
  });

  it("seeds each length from the document, and from the classic value where the document is silent", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      {
        ...plain,
        variations: [{ type: "mandelbox", weight: 1, fixedRadius: 1.5 }],
      },
      0,
      1,
    );
    expect(editorSlider("Mandelbox fixed radius").value).toBe("1.5");
    expect(editorSlider("Mandelbox min radius").value).toBe("0.5");
    expect(editorSlider("Mandelbox box limit").value).toBe("1");
  });

  it("writes a length into the document only once its own slider moves", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      { ...plain, variations: [{ type: "mandelbox", weight: 1 }] },
      0,
      1,
    );

    const slider = editorSlider("Mandelbox min radius");
    slider.value = "0.3";
    slider.dispatchEvent(new Event("input"));

    // Only the length that moved: the other two stay ABSENT, which is what
    // keeps "absent means the classic values byte-identically" true.
    expect(lastGeometry(handlers).variations).toEqual([
      { type: "mandelbox", weight: 1, minRadius: 0.3 },
    ]);
  });

  it("removes a length dragged back to its classic value, returning the document to its unparameterized form", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      {
        ...plain,
        variations: [{ type: "spherefold", weight: 1, minRadius: 0.3 }],
      },
      0,
      1,
    );

    const slider = editorSlider("Spherefold min radius");
    slider.value = "0.5";
    slider.dispatchEvent(new Event("input"));

    expect(lastGeometry(handlers).variations).toEqual([
      { type: "spherefold", weight: 1 },
    ]);
  });

  it("carries the min radius down when the fixed radius drops below it — the fold's own domain, not a silent clamp", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      {
        ...plain,
        variations: [{ type: "spherefold", weight: 1, minRadius: 0.9 }],
      },
      0,
      1,
    );

    const fixed = editorSlider("Spherefold fixed radius");
    fixed.value = "0.6";
    fixed.dispatchEvent(new Event("input"));

    const min = editorSlider("Spherefold min radius");
    expect(min.value).toBe("0.6");
    expect(min.max).toBe("0.6");
    expect(lastGeometry(handlers).variations).toEqual([
      { type: "spherefold", weight: 1, minRadius: 0.6, fixedRadius: 0.6 },
    ]);
  });

  it("reports an edited variation weight back", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      { ...plain, variations: [{ type: "swirl", weight: 1 }] },
      0,
      1,
    );

    const slider = editorSlider("Variation swirl");
    slider.value = "0.5";
    slider.dispatchEvent(new Event("input"));

    expect(lastGeometry(handlers).variations).toEqual([
      { type: "swirl", weight: 0.5 },
    ]);
  });

  it("lets the variation weight slider reach -2 and reports a negative weight back", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      { ...plain, variations: [{ type: "swirl", weight: 1 }] },
      0,
      1,
    );

    const slider = editorSlider("Variation swirl");
    expect(slider.min).toBe("-2");
    expect(slider.max).toBe("2");

    slider.value = "-1.5";
    slider.dispatchEvent(new Event("input"));

    expect(lastGeometry(handlers).variations).toEqual([
      { type: "swirl", weight: -1.5 },
    ]);
  });

  it("renders an out-of-band negative variation weight from the document instead of pinning at zero", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      { ...plain, variations: [{ type: "swirl", weight: -1.5 }] },
      0,
      1,
    );

    const slider = editorSlider("Variation swirl");
    expect(slider.value).toBe("-1.5");
    expect(editorReadout("Variation swirl").textContent).toBe("-1.50");
  });

  it("removes a variation, reporting an empty blend", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      { ...plain, variations: [{ type: "bubble", weight: 1 }] },
      0,
      1,
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
      1,
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

// The "Finish" group: the single UI that can create or edit a transform's
// optional surface `finish` (see fractal/types.ts's SurfaceFinish). The
// contract under test is the fold-length rows' one level up: a field is
// written only once its own slider moves, a slider back on classic REMOVES
// it, and the document a user explored and returned from is byte-identical
// to one that never carried a finish.
describe("Ui finish editor", () => {
  const plain: Transform = {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  };

  function bundleSelect(): HTMLSelectElement {
    const select = document.querySelector<HTMLSelectElement>(
      "#transformEditor .finish-bundle",
    );
    if (!select) throw new Error("No finish-bundle select");
    return select;
  }

  function finishNote(): HTMLElement {
    const note = document.querySelector<HTMLElement>(
      "#transformEditor .finish-note",
    );
    if (!note) throw new Error("No finish-note");
    return note;
  }

  function lastGeometry(handlers: UiHandlers) {
    const calls = vi.mocked(handlers.onTransformGeometry).mock.calls;
    return calls[calls.length - 1][1];
  }

  function drag(label: string, value: string): void {
    const slider = editorSlider(label);
    slider.value = value;
    slider.dispatchEvent(new Event("input"));
  }

  function pickBundle(id: string): void {
    const select = bundleSelect();
    select.value = id;
    select.dispatchEvent(new Event("change"));
  }

  it("offers the six fields at their classic values for a map that authors none, reading Classic", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(plain, 0, 1);

    // The rows DISPLAY the classic numbers the resolver would use (the
    // Color rows' derived-slot idiom); only the working copy is empty.
    expect(editorSlider("Finish specular").value).toBe("0.4");
    expect(editorSlider("Finish shininess").value).toBe("32");
    expect(editorSlider("Finish metalness").value).toBe("0");
    expect(editorSlider("Finish reflect").value).toBe("0");
    expect(editorSlider("Finish transmit").value).toBe("0");
    expect(editorReadout("Finish shininess").textContent).toBe("32");
    expect(bundleSelect().value).toBe("classic");
  });

  it("seeds each row from the document, and from the classic value where the document is silent", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(
      { ...plain, finish: { metalness: 1, reflect: 0.45 } },
      0,
      1,
    );
    expect(editorSlider("Finish metalness").value).toBe("1");
    expect(editorSlider("Finish reflect").value).toBe("0.45");
    expect(editorSlider("Finish specular").value).toBe("0.4");
    expect(editorSlider("Finish shininess").value).toBe("32");
  });

  it("emits no finish key at all for an unrelated edit on a map that authors none", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(plain, 0, 1);

    const scaleX = editorSlider("Scale X");
    scaleX.value = "0.7";
    scaleX.dispatchEvent(new Event("input"));

    // Not `undefined`, not `{}`: NO key — building the group and displaying
    // the classic numbers materializes nothing.
    expect(lastGeometry(handlers)).not.toHaveProperty("finish");
  });

  it("writes a field into the document only once its own slider moves", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(plain, 0, 1);

    drag("Finish metalness", "0.6");

    // Only the field that moved: the other four stay ABSENT, which is what
    // keeps "absent means the classic values byte-identically" true.
    expect(lastGeometry(handlers).finish).toEqual({ metalness: 0.6 });
    expect(editorReadout("Finish metalness").textContent).toBe("0.60");
  });

  it("carries an authored field through an unrelated edit, untouched and un-materialized beyond itself", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor({ ...plain, finish: { reflect: 0.3 } }, 0, 1);

    drag("Finish specular", "1.2");
    const scaleX = editorSlider("Scale X");
    scaleX.value = "0.7";
    scaleX.dispatchEvent(new Event("input"));

    expect(lastGeometry(handlers).finish).toEqual({
      reflect: 0.3,
      specular: 1.2,
    });
  });

  it("removes a field dragged back to its classic value", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      { ...plain, finish: { specular: 1, metalness: 0.5 } },
      0,
      1,
    );

    drag("Finish specular", "0.4");

    expect(lastGeometry(handlers).finish).toEqual({ metalness: 0.5 });
  });

  it("removes the whole finish when its last field returns to classic, emitting the removal explicitly", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor({ ...plain, finish: { shininess: 96 } }, 0, 1);

    drag("Finish shininess", "32");

    // The key is PRESENT and undefined, not omitted: state.ts's
    // updateTransform merges the emitted geometry over the transform, so an
    // omitted key would leave the document's `{shininess: 96}` in place.
    // persist writes nothing for an undefined finish, so the saved scene is
    // byte-identical to one that never authored a finish.
    const geometry = lastGeometry(handlers);
    expect(geometry).toHaveProperty("finish");
    expect(geometry.finish).toBeUndefined();
    expect(bundleSelect().value).toBe("classic");
  });

  it("never leaves the document's own finish object mutated", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const finish = { metalness: 0.5 };
    ui.renderTransformEditor({ ...plain, finish }, 0, 1);

    drag("Finish metalness", "0.9");
    drag("Finish reflect", "0.2");

    // The editor edits a CLONE and hands back another: the document's own
    // object is untouched by the drag, and the emitted one is not aliased
    // to the working copy either.
    expect(finish).toEqual({ metalness: 0.5 });
    const emitted = lastGeometry(handlers).finish;
    drag("Finish reflect", "0.7");
    expect(emitted).toEqual({ metalness: 0.9, reflect: 0.2 });
  });

  it("sets all six sliders from a bundle, storing only the fields that differ from classic", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(plain, 0, 1);

    pickBundle("chrome");

    // Chrome is (1, 96, 1, 0.9, 0): four fields away from classic and
    // transmit on it — which the per-field write rule stores as ABSENCE, so
    // the document resolves to the bundle's six numbers exactly while
    // carrying no classic-valued key.
    expect(lastGeometry(handlers).finish).toEqual({
      specular: 1,
      shininess: 96,
      metalness: 1,
      reflect: 0.9,
      reflectionTint: 0,
    });
    expect(editorSlider("Finish specular").value).toBe("1");
    expect(editorSlider("Finish shininess").value).toBe("96");
    expect(editorSlider("Finish metalness").value).toBe("1");
    expect(editorSlider("Finish reflect").value).toBe("0.9");
    expect(editorSlider("Finish transmit").value).toBe("0");
    expect(editorReadout("Finish reflect").textContent).toBe("0.90");
    expect(bundleSelect().value).toBe("chrome");
    expect(vi.mocked(handlers.onTransformGeometry)).toHaveBeenCalledTimes(1);
  });

  it("replaces a custom finish wholesale when a bundle is picked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      { ...plain, finish: { transmit: 0.9, metalness: 0.2 } },
      0,
      1,
    );

    pickBundle("matte");

    // Matte is specular 0 and the rest classic: the stray transmit and
    // metalness go, not merely the fields Matte happens to differ on.
    expect(lastGeometry(handlers).finish).toEqual({ specular: 0 });
    expect(bundleSelect().value).toBe("matte");
  });

  it("removes the finish entirely when Classic is picked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      {
        ...plain,
        finish: {
          specular: 0.9,
          shininess: 96,
          reflect: 0.35,
          transmit: 0.75,
        },
      },
      0,
      1,
    );

    pickBundle("classic");

    const geometry = lastGeometry(handlers);
    expect(geometry).toHaveProperty("finish");
    expect(geometry.finish).toBeUndefined();
    expect(editorSlider("Finish specular").value).toBe("0.4");
    expect(editorSlider("Finish transmit").value).toBe("0");
    expect(bundleSelect().value).toBe("classic");
  });

  it("reads the bundle a document's numbers are, on build and after a drag, and Custom otherwise", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    // Translucent stored minimally (transmit, reflect, specular and
    // shininess differ from classic; metalness does not) still reads as
    // Translucent.
    ui.renderTransformEditor(
      {
        ...plain,
        finish: {
          specular: 1,
          shininess: 128,
          reflect: 0.5,
          transmit: 0.35,
        },
      },
      0,
      1,
    );
    expect(bundleSelect().value).toBe("translucent");

    drag("Finish reflect", "0.35");
    expect(bundleSelect().value).toBe("custom");
    // The synthetic entry can be shown but never chosen.
    const custom = bundleSelect().querySelector<HTMLOptionElement>(
      "option[value='custom']",
    );
    expect(custom?.disabled).toBe(true);

    drag("Finish reflect", "0.5");
    expect(bundleSelect().value).toBe("translucent");
  });

  it("keeps every bundle and every classic value on its slider's step, so a pick is exactly reversible", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(plain, 0, 1);

    const ids = [...bundleSelect().options]
      .filter((o) => !o.disabled)
      .map((o) => o.value);
    expect(ids).toEqual([
      "classic",
      "matte",
      "satin",
      "plastic",
      "metal",
      "chrome",
      "translucent",
    ]);
    for (const id of ids) {
      pickBundle(id);
      expect(bundleSelect().value).toBe(id);
      // Each slider's value survives the round trip through the slider's own
      // step (jsdom does not quantize, but the app's sliders do): every
      // bundle number is a multiple of its row's step.
      for (const label of [
        "Finish specular",
        "Finish metalness",
        "Finish reflect",
        "Finish transmit",
      ]) {
        const v = Number(editorSlider(label).value);
        expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-9);
      }
      expect(
        Number.isInteger(Number(editorSlider("Finish shininess").value)),
      ).toBe(true);
    }
    pickBundle("classic");
    expect(lastGeometry(handlers).finish).toBeUndefined();
  });

  it("omits the Finish group for the final transform", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    // The lens is not a shading slot: the tracers shade a hit by the base
    // map that produced it, so nothing would ever read a finish authored
    // on the final transform.
    ui.renderTransformEditor(plain, "final", 1);

    expect(editorGroupTitles()).not.toContain("Finish");
    expect(
      document.querySelector("#transformEditor .finish-bundle"),
    ).toBeNull();
  });

  it("picks up a finish that changed under a stable selection, instead of writing the stale one back", () => {
    // An undo back past the first finish edit returns a transform with the
    // key gone; the working copy has to forget it too, or the next unrelated
    // edit would write it back.
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor({ ...plain, finish: { metalness: 1 } }, 0, 1);
    ui.renderTransformEditor(plain, 0, 1);

    expect(editorSlider("Finish metalness").value).toBe("0");
    expect(bundleSelect().value).toBe("classic");
    const scaleX = editorSlider("Scale X");
    scaleX.value = "0.7";
    scaleX.dispatchEvent(new Event("input"));
    expect(lastGeometry(handlers)).not.toHaveProperty("finish");
  });

  it("names an authored finish on the transform list row, by bundle where it is one", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformList(
      [
        plain,
        { ...plain, id: 1, finish: { specular: 0 } },
        { ...plain, id: 2, finish: { reflect: 0.5 } },
        // Authored AT classic: real data, but renders nothing different,
        // so the row says nothing.
        { ...plain, id: 3, finish: { specular: 0.4 } },
      ],
      null,
      null,
    );
    const rows = [
      ...document.querySelectorAll<HTMLElement>(
        "#transformList .transform-btn",
      ),
    ].map((b) => b.textContent ?? "");
    // Row 0 is the camera card.
    expect(rows[1]).not.toContain("Finish");
    expect(rows[2]).toContain("Finish: Matte");
    expect(rows[3]).toContain("Finish: custom");
    expect(rows[4]).not.toContain("Finish");
  });

  describe("forward-orbit disclosure", () => {
    // An escape-time or Mandelbulb surface shades the WHOLE object with the
    // first active transform's finish (main.ts's escapeSlotFinish, the
    // kernels' firstChoice 0). The gate's route kind reaches the panel with
    // every eligibility refresh, and the rows it would skip say so.
    const two: Transform[] = [plain, { ...plain, id: 1, position: [1, 0, 0] }];

    function finishInputsDisabled(): boolean[] {
      return [
        bundleSelect().disabled,
        ...[
          "Finish specular",
          "Finish shininess",
          "Finish metalness",
          "Finish reflect",
          "Finish transmit",
        ].map((label) => editorSlider(label).disabled),
      ];
    }

    it("disables a non-head transform's finish rows on an escape-shaped document, with the reason shown", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      ui.renderTransformList(two, 1, null);
      ui.renderTransformEditor(two[1], 1, 2);
      ui.setSurfaceEligibility("eligible", null, "escape");

      expect(finishInputsDisabled()).toEqual([
        true,
        true,
        true,
        true,
        true,
        true,
      ]);
      expect(finishNote().classList.contains("hidden")).toBe(false);
      expect(finishNote().textContent).toMatch(/FIRST active transform/);
    });

    it("keeps the head transform's rows live on the same document", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      ui.renderTransformList(two, 0, null);
      ui.renderTransformEditor(two[0], 0, 2);
      ui.setSurfaceEligibility("eligible", null, "bulb");

      expect(finishInputsDisabled()).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
      expect(finishNote().classList.contains("hidden")).toBe(true);
    });

    it("treats the first POSITIVELY weighted transform as the head, as the session does", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      const weighted: Transform[] = [{ ...two[0], weight: 0 }, two[1]];
      ui.renderTransformList(weighted, 1, null);
      ui.renderTransformEditor(weighted[1], 1, 2);
      ui.setSurfaceEligibility("eligible", null, "escape4");

      expect(finishInputsDisabled()).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
    });

    it("re-enables the rows when the document routes back to an IFS surface, and applies to a later-built editor", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      ui.renderTransformList(two, 1, null);
      ui.setSurfaceEligibility("eligible", null, "escape");
      // Built AFTER the gate pushed its kind: the disclosure applies at
      // build, not only on the next refresh.
      ui.renderTransformEditor(two[1], 1, 2);
      expect(bundleSelect().disabled).toBe(true);

      ui.setSurfaceEligibility("eligible", null, "ifs");
      expect(finishInputsDisabled()).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
      expect(finishNote().classList.contains("hidden")).toBe(true);

      // An ineligible document routes nowhere, and a refusal is not a
      // reason to grey the rows — the gate's own note carries that.
      ui.setSurfaceEligibility("ineligible", "not marchable", null);
      expect(bundleSelect().disabled).toBe(false);
    });
  });
});

// The "Pattern" group: the single UI that can create or edit a transform's
// optional `surfacePattern` (see fractal/types.ts's SurfacePattern), the
// finish group's sibling one feature over. The contract under test is the
// finish's own: nothing is written until a control moves, a family pick
// materializes the object, returning the family to none removes it, and
// the document a user explored and returned from is byte-identical to one
// that never carried a pattern.
describe("Ui pattern editor", () => {
  const plain: Transform = {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  };

  function patternFamilySelect(): HTMLSelectElement {
    const select = document.querySelector<HTMLSelectElement>(
      "#transformEditor .pattern-family",
    );
    if (!select) throw new Error("No pattern-family select");
    return select;
  }

  function patternAxisSelect(): HTMLSelectElement {
    const select = document.querySelector<HTMLSelectElement>(
      "#transformEditor .pattern-axis",
    );
    if (!select) throw new Error("No pattern-axis select");
    return select;
  }

  function patternNote(): HTMLElement {
    const note = document.querySelector<HTMLElement>(
      "#transformEditor .pattern-note",
    );
    if (!note) throw new Error("No pattern-note");
    return note;
  }

  function lastGeometry(handlers: UiHandlers) {
    const calls = vi.mocked(handlers.onTransformGeometry).mock.calls;
    return calls[calls.length - 1][1];
  }

  function drag(label: string, value: string): void {
    const slider = editorSlider(label);
    slider.value = value;
    slider.dispatchEvent(new Event("input"));
  }

  function pickFamily(id: string): void {
    const select = patternFamilySelect();
    select.value = id;
    select.dispatchEvent(new Event("change"));
  }

  function pickAxis(id: string): void {
    const select = patternAxisSelect();
    select.value = id;
    select.dispatchEvent(new Event("change"));
  }

  // The log grid's position for a scale value — the same construction the
  // slider uses, so tests can drive positions without importing the
  // private helper.
  function scalePosition(scale: number): number {
    const grid = Array.from({ length: 97 }, (_, k) => 0.5 * 2 ** (k / 16));
    const oct = (s: number) => Math.log2(s / 0.5);
    let best = 0;
    for (let i = 1; i < grid.length; i++) {
      if (
        Math.abs(oct(grid[i]) - oct(scale)) <
        Math.abs(oct(grid[best]) - oct(scale))
      ) {
        best = i;
      }
    }
    return best;
  }

  it("offers a Pattern group with family None, and disables the axis/scale/strength rows until a family is picked", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(plain, 0, 1);

    expect(editorGroupTitles()).toContain("Pattern");
    expect(patternFamilySelect().value).toBe("none");
    // With no family there is no pattern to orient or scale: the rows are
    // disabled (the family select stays live), while still displaying the
    // values the resolver would use.
    expect(patternAxisSelect().disabled).toBe(true);
    expect(editorSlider("Pattern scale").disabled).toBe(true);
    expect(editorSlider("Pattern strength").disabled).toBe(true);
    expect(editorReadout("Pattern scale").textContent).toBe("1.00");
    expect(editorReadout("Pattern strength").textContent).toBe("0.00");
  });

  it("seeds the rows from the document, and from the family defaults where the document is silent", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(
      {
        ...plain,
        surfacePattern: { kind: "wood", axis: "z", scale: 4, strength: 0.5 },
      },
      0,
      1,
    );
    expect(patternFamilySelect().value).toBe("wood");
    expect(patternAxisSelect().value).toBe("z");
    expect(patternAxisSelect().disabled).toBe(false);
    expect(editorSlider("Pattern scale").disabled).toBe(false);
    expect(editorSlider("Pattern scale").value).toBe(String(scalePosition(4)));
    expect(editorReadout("Pattern scale").textContent).toBe("4.00");
    expect(editorSlider("Pattern strength").value).toBe("0.5");
    expect(editorReadout("Pattern strength").textContent).toBe("0.50");

    // A sparse document resolves to its family's own defaults.
    ui.renderTransformEditor(
      { ...plain, surfacePattern: { kind: "marble", axis: "y" } },
      0,
      1,
    );
    expect(patternFamilySelect().value).toBe("marble");
    expect(editorReadout("Pattern scale").textContent).toBe("1.35");
    expect(editorReadout("Pattern strength").textContent).toBe("1.00");
  });

  it("emits no surfacePattern key at all for an unrelated edit on a map that authors none", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(plain, 0, 1);

    const scaleX = editorSlider("Scale X");
    scaleX.value = "0.7";
    scaleX.dispatchEvent(new Event("input"));

    // Not `undefined`, not `{}`: NO key — building the group and displaying
    // the resolved values materializes nothing.
    expect(lastGeometry(handlers)).not.toHaveProperty("surfacePattern");
  });

  it("materializes exactly {kind, axis} when a family is picked, leaving the defaults absent", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(plain, 0, 1);

    pickFamily("wood");

    // The family defaults (axis y, scale 3, strength 1) are ABSENT: the
    // resolver supplies them, which is what keeps the stored document
    // minimal.
    expect(lastGeometry(handlers).surfacePattern).toEqual({
      kind: "wood",
      axis: "y",
    });
    expect(editorSlider("Pattern scale").disabled).toBe(false);
    expect(editorSlider("Pattern strength").disabled).toBe(false);
    expect(patternAxisSelect().disabled).toBe(false);
    expect(editorReadout("Pattern scale").textContent).toBe("3.00");
    expect(editorReadout("Pattern strength").textContent).toBe("1.00");
  });

  it("carries authored scale and strength through a family switch, with the defaults staying absent", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      { ...plain, surfacePattern: { kind: "wood", axis: "x", scale: 2.2 } },
      0,
      1,
    );

    pickFamily("marble");

    // The authored axis and scale survive the family switch untouched; only
    // the family leaf changes. The displayed scale stays the authored 2.2,
    // not marble's 1.35 — the rows show the RESOLVED value.
    expect(lastGeometry(handlers).surfacePattern).toEqual({
      kind: "marble",
      axis: "x",
      scale: 2.2,
    });
    expect(editorReadout("Pattern scale").textContent).toBe("2.20");

    // A sparse pattern instead follows the NEW family's default on the rows.
    ui.renderTransformEditor(
      { ...plain, surfacePattern: { kind: "wood", axis: "y" } },
      0,
      1,
    );
    expect(editorReadout("Pattern scale").textContent).toBe("3.00");
    pickFamily("strata");
    expect(editorReadout("Pattern scale").textContent).toBe("2.60");
    expect(lastGeometry(handlers).surfacePattern).toEqual({
      kind: "strata",
      axis: "y",
    });
  });

  it("writes scale sparsely and removes it when it returns to the family default", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      { ...plain, surfacePattern: { kind: "wood", axis: "y", scale: 4 } },
      0,
      1,
    );

    // Position 50 is the grid value 0.5·2^(50/16) ≈ 4.36 (no default
    // displaced it), off wood's default 3.
    drag("Pattern scale", "50");
    expect(lastGeometry(handlers).surfacePattern).toEqual({
      kind: "wood",
      axis: "y",
      scale: 0.5 * 2 ** (50 / 16),
    });

    // Position 41 IS wood's default scale 3 (the grid's nearest point was
    // replaced by the default): landing on it removes the leaf.
    drag("Pattern scale", "41");
    expect(lastGeometry(handlers).surfacePattern).toEqual({
      kind: "wood",
      axis: "y",
    });
  });

  it("writes strength sparsely and removes it at the default 1", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      {
        ...plain,
        surfacePattern: { kind: "strata", axis: "y", strength: 0.5 },
      },
      0,
      1,
    );

    drag("Pattern strength", "0.8");
    expect(lastGeometry(handlers).surfacePattern).toEqual({
      kind: "strata",
      axis: "y",
      strength: 0.8,
    });
    expect(editorReadout("Pattern strength").textContent).toBe("0.80");

    drag("Pattern strength", "1");
    expect(lastGeometry(handlers).surfacePattern).toEqual({
      kind: "strata",
      axis: "y",
    });
  });

  it("writes the axis through its select, keeping it present even at the default y", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      { ...plain, surfacePattern: { kind: "marble", axis: "y" } },
      0,
      1,
    );

    pickAxis("z");
    expect(lastGeometry(handlers).surfacePattern).toEqual({
      kind: "marble",
      axis: "z",
    });

    // Axis is a REQUIRED leaf of the document model — unlike scale and
    // strength there is no absent state to return to, so y is stored.
    pickAxis("y");
    expect(lastGeometry(handlers).surfacePattern).toEqual({
      kind: "marble",
      axis: "y",
    });
  });

  it("removes the whole surfacePattern when the family returns to none, emitting the removal explicitly", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      {
        ...plain,
        surfacePattern: { kind: "wood", axis: "z", scale: 4, strength: 0.5 },
      },
      0,
      1,
    );

    pickFamily("none");

    // The key is PRESENT and undefined, not omitted: state.ts's
    // updateTransform merges the emitted geometry over the transform, so an
    // omitted key would leave the document's old pattern in place. persist
    // writes nothing for an undefined surfacePattern, so the saved scene is
    // byte-identical to one that never authored a pattern.
    const geometry = lastGeometry(handlers);
    expect(geometry).toHaveProperty("surfacePattern");
    expect(geometry.surfacePattern).toBeUndefined();
    expect(patternFamilySelect().value).toBe("none");
    expect(patternAxisSelect().disabled).toBe(true);
    expect(editorSlider("Pattern scale").disabled).toBe(true);
  });

  it("never leaves the document's own surfacePattern object mutated", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const pattern = { kind: "wood" as const, axis: "y" as const, scale: 4 };
    ui.renderTransformEditor({ ...plain, surfacePattern: pattern }, 0, 1);

    drag("Pattern scale", "50");

    // The editor edits a CLONE and hands back another: the document's own
    // object is untouched by the drag, and the already-emitted object is
    // not aliased to the working copy either — the second drag changes the
    // working copy, not the clone the first drag handed out.
    expect(pattern).toEqual({ kind: "wood", axis: "y", scale: 4 });
    const emitted = lastGeometry(handlers).surfacePattern;
    drag("Pattern scale", "55");
    expect(emitted).toEqual({
      kind: "wood",
      axis: "y",
      scale: 0.5 * 2 ** (50 / 16),
    });
    expect(lastGeometry(handlers).surfacePattern).toEqual({
      kind: "wood",
      axis: "y",
      scale: 0.5 * 2 ** (55 / 16),
    });
  });

  it("omits the Pattern group for the final transform", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    // The lens is not a shading slot: the tracers pattern a hit by the base
    // map that produced it, so nothing would ever read a pattern authored
    // on the final transform.
    ui.renderTransformEditor(plain, "final", 1);

    expect(editorGroupTitles()).not.toContain("Pattern");
    expect(
      document.querySelector("#transformEditor .pattern-family"),
    ).toBeNull();
    expect(
      document.querySelector("#transformEditor .finish-material"),
    ).toBeNull();
  });

  it("builds the Pattern group for a 4D transform too", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    // A 4D transform is an ordinary transform with a `w` block — the same
    // single editor serves both dimensions, so the block must exist there.
    ui.renderTransformEditor({ ...plain, w: { position: 0.5 } }, 0, 1);

    expect(editorGroupTitles()).toContain("Pattern");
    expect(patternFamilySelect()).not.toBeNull();
  });

  it("picks up a pattern that changed under a stable selection, instead of writing the stale one back", () => {
    // An undo back past the first pattern edit returns a transform with the
    // key gone; the working copy has to forget it too, or the next unrelated
    // edit would write it back.
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      { ...plain, surfacePattern: { kind: "wood", axis: "y" } },
      0,
      1,
    );
    ui.renderTransformEditor(plain, 0, 1);

    expect(patternFamilySelect().value).toBe("none");
    const scaleX = editorSlider("Scale X");
    scaleX.value = "0.7";
    scaleX.dispatchEvent(new Event("input"));
    expect(lastGeometry(handlers)).not.toHaveProperty("surfacePattern");
  });

  it("names an authored pattern on the transform list row, by family at the family defaults and custom otherwise", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformList(
      [
        plain,
        // At the family's defaults — exactly what a family pick or a
        // material starting point stores.
        { ...plain, id: 1, surfacePattern: { kind: "wood", axis: "y" } },
        // Axis off the default: no starting point's numbers.
        { ...plain, id: 2, surfacePattern: { kind: "marble", axis: "z" } },
        // Strength explicitly at the default still names the family.
        {
          ...plain,
          id: 3,
          surfacePattern: { kind: "strata", axis: "y", strength: 1 },
        },
        // Scale tuned away from the family default.
        {
          ...plain,
          id: 4,
          surfacePattern: { kind: "wood", axis: "y", scale: 4 },
        },
      ],
      null,
      null,
    );
    const rows = [
      ...document.querySelectorAll<HTMLElement>(
        "#transformList .transform-btn",
      ),
    ].map((b) => b.textContent ?? "");
    // Row 0 is the camera card.
    expect(rows[1]).not.toContain("Pattern");
    expect(rows[2]).toContain("Pattern: Wood");
    expect(rows[3]).toContain("Pattern: custom");
    expect(rows[4]).toContain("Pattern: Strata");
    expect(rows[5]).toContain("Pattern: custom");
  });

  describe("forward-orbit disclosure", () => {
    // An escape-time or Mandelbulb surface shades AND patterns the WHOLE
    // object with the first active transform's material (main.ts's
    // escapeSlotMaterials, the kernels' firstChoice 0). The gate's route
    // kind reaches the panel with every eligibility refresh, and the rows
    // it would skip say so — the Finish group's own disclosure, one feature
    // over.
    const two: Transform[] = [
      { ...plain, surfacePattern: { kind: "wood", axis: "y" } },
      {
        ...plain,
        id: 1,
        position: [1, 0, 0],
        surfacePattern: { kind: "wood", axis: "y" },
      },
    ];

    function patternInputsDisabled(): boolean[] {
      return [
        patternFamilySelect().disabled,
        patternAxisSelect().disabled,
        editorSlider("Pattern scale").disabled,
        editorSlider("Pattern strength").disabled,
      ];
    }

    it("disables a non-head transform's pattern rows on an escape-shaped document, with the reason shown", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      ui.renderTransformList(two, 1, null);
      ui.renderTransformEditor(two[1], 1, 2);
      ui.setSurfaceEligibility("eligible", null, "escape");

      expect(patternInputsDisabled()).toEqual([true, true, true, true]);
      expect(patternNote().classList.contains("hidden")).toBe(false);
      expect(patternNote().textContent).toMatch(/FIRST active transform/);
    });

    it("keeps the head transform's rows live on the same document", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      ui.renderTransformList(two, 0, null);
      ui.renderTransformEditor(two[0], 0, 2);
      ui.setSurfaceEligibility("eligible", null, "bulb");

      expect(patternInputsDisabled()).toEqual([false, false, false, false]);
      expect(patternNote().classList.contains("hidden")).toBe(true);
    });

    it("re-enables the rows when the document routes back to an IFS surface, and applies to a later-built editor", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      ui.renderTransformList(two, 1, null);
      ui.setSurfaceEligibility("eligible", null, "escape");
      // Built AFTER the gate pushed its kind: the disclosure applies at
      // build, not only on the next refresh.
      ui.renderTransformEditor(two[1], 1, 2);
      expect(patternFamilySelect().disabled).toBe(true);

      ui.setSurfaceEligibility("eligible", null, "ifs");
      expect(patternInputsDisabled()).toEqual([false, false, false, false]);
      expect(patternNote().classList.contains("hidden")).toBe(true);

      // An ineligible document routes nowhere, and a refusal is not a
      // reason to grey the rows — the gate's own note carries that.
      ui.setSurfaceEligibility("ineligible", "not marchable", null);
      expect(patternFamilySelect().disabled).toBe(false);
    });
  });
});

// The material starting points (Wood/Marble/Strata): a second select in the
// Finish group that sets the finish AND the pattern family together — the
// document stores only the numbers, never the name, and the two concepts
// (material preset, pattern family) stay deliberately distinct.
describe("Ui material starting points", () => {
  const plain: Transform = {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  };

  function materialSelect(): HTMLSelectElement {
    const select = document.querySelector<HTMLSelectElement>(
      "#transformEditor .finish-material",
    );
    if (!select) throw new Error("No finish-material select");
    return select;
  }

  function patternFamilySelect(): HTMLSelectElement {
    const select = document.querySelector<HTMLSelectElement>(
      "#transformEditor .pattern-family",
    );
    if (!select) throw new Error("No pattern-family select");
    return select;
  }

  function lastGeometry(handlers: UiHandlers) {
    const calls = vi.mocked(handlers.onTransformGeometry).mock.calls;
    return calls[calls.length - 1][1];
  }

  function pickMaterial(id: string): void {
    const select = materialSelect();
    select.value = id;
    select.dispatchEvent(new Event("change"));
  }

  function pickFamily(id: string): void {
    const select = patternFamilySelect();
    select.value = id;
    select.dispatchEvent(new Event("change"));
  }

  function drag(label: string, value: string): void {
    const slider = editorSlider(label);
    slider.value = value;
    slider.dispatchEvent(new Event("input"));
  }

  it("reads None for the all-clear state and Custom whenever either side deviates", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(plain, 0, 1);
    expect(materialSelect().value).toBe("none");

    // A finish alone is nobody's material.
    ui.renderTransformEditor({ ...plain, finish: { specular: 0.9 } }, 0, 1);
    expect(materialSelect().value).toBe("custom");

    // A pattern alone is nobody's material either (the strata preset pairs
    // the family with a matte finish, and this finish is classic).
    ui.renderTransformEditor(
      { ...plain, surfacePattern: { kind: "strata", axis: "y" } },
      0,
      1,
    );
    expect(materialSelect().value).toBe("custom");
  });

  it("picking Wood sets the documented finish and pattern, storing values only", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(plain, 0, 1);

    pickMaterial("wood");

    // Wood = the Satin finish (the three fields that differ from classic)
    // + the wood pattern at its own defaults (so only kind and axis are
    // stored). One emit for the whole pick.
    const geometry = lastGeometry(handlers);
    expect(geometry.finish).toEqual({
      specular: 0.25,
      shininess: 8,
      reflect: 0.08,
    });
    expect(geometry.surfacePattern).toEqual({ kind: "wood", axis: "y" });
    expect(materialSelect().value).toBe("wood");
    // The finish half reads as its own bundle, and the pattern half as its
    // family.
    expect(
      document.querySelector<HTMLSelectElement>(
        "#transformEditor .finish-bundle",
      )?.value,
    ).toBe("satin");
    expect(patternFamilySelect().value).toBe("wood");
    expect(editorReadout("Pattern scale").textContent).toBe("3.00");
    expect(vi.mocked(handlers.onTransformGeometry)).toHaveBeenCalledTimes(1);
  });

  it("replaces a custom finish and pattern wholesale when a material is picked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      {
        ...plain,
        finish: { transmit: 0.9, metalness: 0.2 },
        surfacePattern: { kind: "marble", axis: "z", scale: 7, strength: 0.4 },
      },
      0,
      1,
    );

    pickMaterial("strata");

    // Strata = the Matte finish (specular 0 is its only non-classic field)
    // + the strata pattern at its defaults: the stray marble axis, scale
    // and strength go, not merely the fields the preset happens to differ
    // on.
    const geometry = lastGeometry(handlers);
    expect(geometry.finish).toEqual({ specular: 0 });
    expect(geometry.surfacePattern).toEqual({ kind: "strata", axis: "y" });
    expect(materialSelect().value).toBe("strata");
  });

  it("None clears both the finish and the surfacePattern, emitting both removals explicitly", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(
      {
        ...plain,
        finish: { specular: 0.9 },
        surfacePattern: { kind: "wood", axis: "y" },
      },
      0,
      1,
    );

    pickMaterial("none");

    const geometry = lastGeometry(handlers);
    expect(geometry).toHaveProperty("finish");
    expect(geometry.finish).toBeUndefined();
    expect(geometry).toHaveProperty("surfacePattern");
    expect(geometry.surfacePattern).toBeUndefined();
    expect(materialSelect().value).toBe("none");
    expect(
      document.querySelector<HTMLSelectElement>(
        "#transformEditor .finish-bundle",
      )?.value,
    ).toBe("classic");
    expect(patternFamilySelect().value).toBe("none");
  });

  it("reads Custom when a material's constants change on either side, and the preset again when restored", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(plain, 0, 1);
    pickMaterial("wood");
    expect(materialSelect().value).toBe("wood");

    // Tune the pattern scale off wood's default 3: nobody's preset now.
    drag("Pattern scale", "50");
    expect(materialSelect().value).toBe("custom");
    expect(patternFamilySelect().value).toBe("wood");

    // Back to the default 3 (position 41 IS the wood default): wood again.
    drag("Pattern scale", "41");
    expect(materialSelect().value).toBe("wood");

    // Tune the finish half instead: custom again.
    drag("Finish specular", "0.7");
    expect(materialSelect().value).toBe("custom");
    drag("Finish specular", "0.25");
    expect(materialSelect().value).toBe("wood");
  });

  it("keeps a pattern family distinct from the material preset", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(plain, 0, 1);
    pickMaterial("wood");

    // Swap the family under a wood material: the material menu reads
    // Custom (marble pattern + satin finish is nobody's preset) while the
    // family menu names Marble and the finish half keeps reading Satin —
    // a preset may pair any family with any finish.
    pickFamily("marble");
    expect(materialSelect().value).toBe("custom");
    expect(patternFamilySelect().value).toBe("marble");
    expect(
      document.querySelector<HTMLSelectElement>(
        "#transformEditor .finish-bundle",
      )?.value,
    ).toBe("satin");
  });

  it("keeps the finish bundles working alongside the material menu", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(plain, 0, 1);
    pickMaterial("wood");

    // Picking a bundle only touches the finish half: the pattern survives,
    // and the material menu reads Custom (chrome + wood pattern is
    // nobody's preset).
    const bundle = document.querySelector<HTMLSelectElement>(
      "#transformEditor .finish-bundle",
    );
    bundle!.value = "chrome";
    bundle!.dispatchEvent(new Event("change"));
    expect(materialSelect().value).toBe("custom");
    expect(patternFamilySelect().value).toBe("wood");
  });
});

// The collapsed "4D" group: the single UI that can create or edit a
// transform's optional `w` extension (see fractal/types.ts's WExtension).
describe("Ui 4D group", () => {
  const flat: Transform = {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  };

  function fourDDetails(): HTMLDetailsElement {
    // Every editor group is a <details>, so this has to name the one it
    // wants rather than take the first.
    const details = [
      ...document.querySelectorAll<HTMLDetailsElement>(
        "#transformEditor details",
      ),
    ].find((d) => d.querySelector("summary")?.textContent === "4D");
    if (!details) throw new Error("No 4D <details> group in the editor");
    return details;
  }

  it("renders closed for a transform with no w block", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(flat, 0, 1);
    expect(fourDDetails().open).toBe(false);
  });

  it("renders open for a transform that already has a w block", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor({ ...flat, w: { position: 0.5 } }, 0, 1);
    expect(fourDDetails().open).toBe(true);
  });

  it("gives the final transform's editor the 4D group too", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor(flat, "final", 1);
    expect(document.querySelector("#transformEditor details")).not.toBeNull();
  });

  it("emits a w of exactly { position } when Position W moves, with no other fields materialized", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor(flat, 0, 1);

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
    ui.renderTransformEditor({ ...flat, w: { position: 0.5 } }, 0, 1);

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
    ui.renderTransformEditor(flat, 0, 1);

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
    ui.renderTransformEditor(flat, 0, 1);

    const shearXW = editorSlider("Shear XW");
    shearXW.value = "1.2";
    shearXW.dispatchEvent(new Event("input"));

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect(geometry.w).toStrictEqual({ shear: { xw: 1.2 } });
  });

  it("shows the derived mean scale with an auto marker until Scale W is moved", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor({ ...flat, scale: [0.2, 0.5, 0.8] }, 0, 1);

    // (0.2 + 0.5 + 0.8) / 3 = 0.5
    expect(editorSlider("Scale W").value).toBe("0.5");
    expect(editorReadout("Scale W").textContent).toBe("0.50 (auto)");
  });

  it("drops the auto marker and reports the explicit value once Scale W moves", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTransformEditor({ ...flat, scale: [0.2, 0.5, 0.8] }, 0, 1);

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
    ui.renderTransformEditor({ ...flat, scale: [0.5, 0.5, 0.5] }, 0, 1);

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
    ui.renderTransformEditor({ ...flat, scale: [0.5, 0.5, 0.5] }, 0, 1);

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
    ui.renderTransformEditor({ ...flat, w: { scale: -0.5 } }, 0, 1);

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
    ui.renderTransformEditor({ ...flat, w: { scale: -0.5 } }, 0, 1);

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
    ui.renderTransformEditor({ ...flat, w: { scale: 0.9 } }, 0, 1);

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
    ui.renderTransformEditor({ ...flat, scale: [0.2, 0.5, 0.8] }, 0, 1);

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
    ui.renderTransformEditor({ ...flat, w: { scale: -0.5 } }, 0, 1);

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
    ui.renderTransformEditor({ ...flat, w: { scale: 0.5 } }, 0, 1);
    // Same index → no rebuild, just a re-sync (undo / external edit path).
    ui.renderTransformEditor({ ...flat, w: { scale: -0.5 } }, 0, 1);

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
    ui.renderTransformEditor(flat, 0, 1);

    const positionX = editorSlider("Position X");
    positionX.value = "1";
    positionX.dispatchEvent(new Event("input"));

    const geometry = vi.mocked(handlers.onTransformGeometry).mock.calls[0][1];
    expect("w" in geometry).toBe(false);
  });

  it("re-syncs the 4D sliders when the transform changes under the same selection", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTransformEditor({ ...flat, w: { position: 0.2 } }, 0, 1);
    // Same index → no rebuild; reflects an external change to w (e.g. a
    // preset swap wouldn't hit this path, but a stable-selection re-render
    // should still pick up whatever the current transform carries).
    ui.renderTransformEditor({ ...flat, w: { position: 0.9 } }, 0, 1);

    expect(editorSlider("Position W").value).toBe("0.9");
  });
});

describe("Ui render mode switch", () => {
  function modeBtn(
    mode: "points" | "flame" | "solid" | "surface",
  ): HTMLButtonElement {
    const id = {
      points: "modePointsBtn",
      flame: "modeFlameBtn",
      solid: "modeSolidBtn",
      surface: "modeSurfaceBtn",
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
  function surfaceControls(): HTMLElement {
    return document.getElementById("surfaceControls") as HTMLElement;
  }
  function atmosphereControls(): HTMLElement {
    return document.getElementById("atmosphereControls") as HTMLElement;
  }

  it("fires onRenderMode with the flame mode when the flame segment is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    modeBtn("flame").click();
    expect(handlers.onRenderMode).toHaveBeenCalledWith("flame");
  });

  it("toasts the gate reason when a disabled Surface segment is tapped", () => {
    // The tooltip is hover-only — touch would learn nothing. Pointer events
    // are still dispatched for disabled controls, so the tap surfaces the
    // reason as a toast (see the bind() listener).
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.setSurfaceEligibility("ineligible", "map 1 uses variations");
    modeBtn("surface").dispatchEvent(
      new Event("pointerdown", { bubbles: true }),
    );
    const toast = document.getElementById("toast") as HTMLElement;
    expect(toast.classList.contains("hidden")).toBe(false);
    expect(toast.textContent).toContain("map 1 uses variations");
  });

  it("stays silent on pointerdown while the Surface segment is enabled", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.setSurfaceEligibility("eligible", null);
    modeBtn("surface").dispatchEvent(
      new Event("pointerdown", { bubbles: true }),
    );
    const toast = document.getElementById("toast") as HTMLElement;
    expect(toast.classList.contains("hidden")).toBe(true);
  });

  it("fires onRenderMode with the solid mode when the solid segment is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    modeBtn("solid").click();
    expect(handlers.onRenderMode).toHaveBeenCalledWith("solid");
  });

  it("fires onRenderMode with the surface mode when the surface segment is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    modeBtn("surface").click();
    expect(handlers.onRenderMode).toHaveBeenCalledWith("surface");
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

  it("shows the flame controls and marks the flame segment active", () => {
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

  it("shows the solid controls and marks the solid segment active", () => {
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

  it("shows the surface controls and marks the surface segment active", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), renderMode: "surface" });

    expect(explorerControls().classList.contains("hidden")).toBe(true);
    expect(surfaceControls().classList.contains("hidden")).toBe(false);
    expect(flameControls().classList.contains("hidden")).toBe(true);
    expect(solidControls().classList.contains("hidden")).toBe(true);
    expect(byId("undoRedoRow").classList.contains("hidden")).toBe(true);
    expect(byId("surfaceStatus").classList.contains("hidden")).toBe(false);
    expect(byId("flameStatus").classList.contains("hidden")).toBe(true);
    expect(byId("solidStatus").classList.contains("hidden")).toBe(true);
    expect(modeBtn("surface").classList.contains("active")).toBe(true);
    expect(modeBtn("surface").getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps one shared Atmosphere section live and exposes only renderer-relevant rows", () => {
    const ui = new Ui(document);
    const state = initialState(true);
    const atmosphere = byId("atmosphereSection");

    expect(atmosphereControls().contains(atmosphere)).toBe(true);
    expect(explorerControls().contains(atmosphere)).toBe(false);
    expect(surfaceControls().contains(atmosphere)).toBe(false);

    ui.updateLabels({ ...state, renderMode: "surface" });
    expect(atmosphereControls().classList.contains("hidden")).toBe(false);
    expect(byId("explorerSecondaryControls").classList.contains("hidden")).toBe(
      true,
    );
    expect(byId("pointsAtmosphereControls").classList.contains("hidden")).toBe(
      true,
    );
    expect(byId("backgroundRow").classList.contains("hidden")).toBe(false);
    expect(byId("fogControls").classList.contains("hidden")).toBe(false);

    ui.updateLabels({ ...state, renderMode: "solid" });
    expect(atmosphereControls().classList.contains("hidden")).toBe(false);
    expect(byId("pointsAtmosphereControls").classList.contains("hidden")).toBe(
      true,
    );
    expect(byId("fogControls").classList.contains("hidden")).toBe(false);

    ui.updateLabels({ ...state, renderMode: "flame" });
    expect(atmosphereControls().classList.contains("hidden")).toBe(false);
    expect(byId("pointsAtmosphereControls").classList.contains("hidden")).toBe(
      true,
    );
    expect(byId("backgroundRow").classList.contains("hidden")).toBe(false);
    expect(byId("fogControls").classList.contains("hidden")).toBe(true);

    ui.updateLabels(state);
    expect(byId("explorerSecondaryControls").classList.contains("hidden")).toBe(
      false,
    );
    expect(byId("pointsAtmosphereControls").classList.contains("hidden")).toBe(
      false,
    );
    expect(byId("fogControls").classList.contains("hidden")).toBe(false);
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
  // headers: content wedged between two collapsed <summary> rows looks like
  // the open content of the section above it. So the mode containers hold
  // accordion sections and nothing else — each mode's non-section content
  // (Undo/Redo, the flame/solid status text) lives above the first section,
  // right after the render-mode switch.
  it("keeps every non-section block above the first accordion section", () => {
    for (const containerId of [
      "explorerControls",
      "atmosphereControls",
      "explorerSecondaryControls",
      "flameControls",
      "solidControls",
      "surfaceControls",
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
    for (const floatingId of [
      "undoRedoRow",
      "flameStatus",
      "solidStatus",
      "surfaceStatus",
    ]) {
      const position = byId(floatingId).compareDocumentPosition(firstSection!);
      expect(
        position & Node.DOCUMENT_POSITION_FOLLOWING,
        `#${floatingId} must precede the accordion`,
      ).toBeTruthy();
    }
  });

  // The refactor's whole point: the segmented control itself is never hidden
  // by updateLabels, so flame<->solid is a direct switch rather than a
  // round-trip through Points.
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

    // 42M is not itself a detent: its nearest in log space is the 5e7 detent
    // (index 5), so the slider thumb snaps there for display while the label
    // keeps showing the exact stored value.
    const iterationsSlider = document.getElementById(
      "flameIterationsSlider",
    ) as HTMLInputElement;
    expect(iterationsSlider.value).toBe("5");
    expect(document.getElementById("flameIterationsLabel")?.textContent).toBe(
      "42.0M iterations",
    );
  });

  it("reflects a GPU-scale iteration budget in billions in the Quality label", () => {
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

  it("applies the slider's detent index to state.flame.iterations on input", () => {
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
  // followed by the Custom sentinel last.
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
    // Not "spectrum": that's the default, so setting it wouldn't prove the
    // change handler actually applies a new value.
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

  it("does not claim 100% for a nearly-done progressive frame", () => {
    const ui = new Ui(document);
    ui.setFlameProgress(19_950_000, 20_000_000); // 99.75% — would round to 100.
    expect(document.getElementById("flameProgress")?.textContent).toContain(
      "(99%)",
    );
  });

  it("formats a >= 1e9 budget in billions, done still in millions", () => {
    const ui = new Ui(document);
    ui.setFlameProgress(843_200_000, 2_000_000_000);
    expect(document.getElementById("flameProgress")?.textContent).toBe(
      "843.2M / 2B iterations (42%)",
    );
  });

  it("clears the estimating busy state set by setFlameEstimating", () => {
    const ui = new Ui(document);
    ui.setFlameEstimating();

    ui.setFlameProgress(20_000_000, 20_000_000);

    const progress = document.getElementById("flameProgress");
    expect(progress?.classList.contains("flame-progress-estimating")).toBe(
      false,
    );
    expect(progress?.textContent).toBe("20.0M / 20.0M iterations (100%)");
  });

  it("writes the percentage to the --progress custom property", () => {
    const ui = new Ui(document);
    ui.setFlameProgress(12_345_000, 20_000_000);
    const progress = document.getElementById("flameProgress");
    expect(progress?.style.getPropertyValue("--progress")).toBe("61%");
  });

  it("resets --progress to 0% when called with no iterations done", () => {
    const ui = new Ui(document);
    ui.setFlameProgress(20_000_000, 20_000_000);
    ui.setFlameProgress(0, 20_000_000);
    const progress = document.getElementById("flameProgress");
    expect(progress?.style.getPropertyValue("--progress")).toBe("0%");
  });
});

describe("Ui.setFlameEstimating", () => {
  it("shows the busy label and adds the estimating modifier class", () => {
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

  it("starts empty, rendered (never .hidden)", () => {
    new Ui(document);
    expect(note()?.textContent).toBe("");
    expect(note()?.classList.contains("hidden")).toBe(false);
  });

  it("shows a reduced-from message when passed an effective value", () => {
    const ui = new Ui(document);
    ui.setFlameSupersampleNote(1, 3);
    expect(note()?.textContent).toBe(
      "Reduced to 1× (from 3×) to fit available memory.",
    );
  });

  it("clears back to empty text on null, the element staying rendered", () => {
    const ui = new Ui(document);
    ui.setFlameSupersampleNote(1, 3);
    ui.setFlameSupersampleNote(null);
    expect(note()?.textContent).toBe("");
    // Visibility is text-driven: the live region must stay in the
    // accessibility tree so the NEXT clamp message actually announces.
    expect(note()?.classList.contains("hidden")).toBe(false);
  });
});

describe("Ui.setFlameBackendNote", () => {
  function note(): HTMLElement | null {
    return document.getElementById("flameBackendNote");
  }

  it("starts empty, rendered (never .hidden)", () => {
    new Ui(document);
    expect(note()?.textContent).toBe("");
    expect(note()?.classList.contains("hidden")).toBe(false);
  });

  it("shows a GPU accumulation message with the adapter label", () => {
    const ui = new Ui(document);
    ui.setFlameBackendNote("gpu", "Apple M2");
    expect(note()?.textContent).toBe("GPU accumulation (Apple M2)");
    expect(note()?.classList.contains("hidden")).toBe(false);
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

  it("clears back to empty text on null, the element staying rendered", () => {
    const ui = new Ui(document);
    ui.setFlameBackendNote("gpu", "Apple M2");
    ui.setFlameBackendNote(null);
    expect(note()?.textContent).toBe("");
    // Text-driven visibility: the restart-time clear must leave the
    // live region in the accessibility tree, or the fresh worker's
    // backend report announces unreliably.
    expect(note()?.classList.contains("hidden")).toBe(false);
  });

  it("escalates to the warning tier for a software adapter", () => {
    const ui = new Ui(document);
    ui.setFlameBackendNote(
      "gpu",
      "fallback adapter (software)",
      undefined,
      true,
    );
    expect(note()?.textContent).toBe(
      "GPU accumulation (fallback adapter (software))",
    );
    expect(note()?.classList.contains("flame-note")).toBe(true);
    expect(note()?.classList.contains("flame-note-info")).toBe(false);
  });

  it("returns to the info tier when a later backend is hardware", () => {
    const ui = new Ui(document);
    ui.setFlameBackendNote(
      "gpu",
      "fallback adapter (software)",
      undefined,
      true,
    );
    ui.setFlameBackendNote("gpu", "Apple M2");
    expect(note()?.classList.contains("flame-note-info")).toBe(true);
    expect(note()?.classList.contains("flame-note")).toBe(false);
  });
});

describe("Ui.setSoftwareRendererNote", () => {
  function note(): HTMLElement | null {
    return document.getElementById("softwareRendererNote");
  }

  it("starts empty, rendered (never .hidden)", () => {
    new Ui(document);
    expect(note()?.textContent).toBe("");
    expect(note()?.classList.contains("hidden")).toBe(false);
  });

  it("shows the text, keeping the warning-tier class", () => {
    const ui = new Ui(document);
    ui.setSoftwareRendererNote(
      "Software rendering (SwiftShader) — expect low performance.",
    );
    expect(note()?.classList.contains("flame-note")).toBe(true);
    expect(note()?.textContent).toBe(
      "Software rendering (SwiftShader) — expect low performance.",
    );
  });

  it("clears back to empty text on null, the element staying rendered", () => {
    const ui = new Ui(document);
    ui.setSoftwareRendererNote("Software rendering (SwiftShader).");
    ui.setSoftwareRendererNote(null);
    expect(note()?.textContent).toBe("");
    expect(note()?.classList.contains("hidden")).toBe(false);
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

  // Followed by the Custom sentinel last, mirroring #flamePalette.
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
    // Not "spectrum": that's the default, so setting it wouldn't prove the
    // change handler actually applies a new value.
    select.value = "sunset";
    select.dispatchEvent(new Event("change"));

    expect(current().solid.paletteId).toBe("sunset");
  });
});

describe("custom palette editor", () => {
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

  it("shows the surface custom-palette editor once surface.paletteId is custom", () => {
    const ui = new Ui(document);
    ui.updateLabels(setSurfacePaletteId(initialState(true), "custom"));
    expect(
      document
        .getElementById("surfaceCustomPaletteRow")
        ?.classList.contains("hidden"),
    ).toBe(false);
  });

  it("keeps the surface editor's CONTAINER gated on the orbit-trap colorSource", () => {
    // The editor row itself keys on paletteId, but it sits inside
    // #surfacePaletteRow, which updateLabels hides unless the colorSource is
    // "palette" — both gates must hold for the editor to actually show.
    const ui = new Ui(document);
    const custom = setSurfacePaletteId(initialState(true), "custom");
    ui.updateLabels(setSurfaceColorSource(custom, "palette"));
    expect(
      document
        .getElementById("surfacePaletteRow")
        ?.classList.contains("hidden"),
    ).toBe(false);
    ui.updateLabels(setSurfaceColorSource(custom, "transform"));
    expect(
      document
        .getElementById("surfacePaletteRow")
        ?.classList.contains("hidden"),
    ).toBe(true);
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

describe("Ui ramp palette", () => {
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

  // Non-flat visibility keys on fourDColor === "radius", not on
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

  it("is shown while non-flat once fourDColor is radius, whatever colorMode says", () => {
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

  it("sits statically beneath the flat/4D color-select pair — no re-homing", () => {
    const ui = new Ui(document);
    // Flat: Color Mode shows, 4D Color hides; the ramp row sits after the
    // pair, inside Appearance.
    ui.updateLabels({ ...initialState(true), colorMode: "height" });
    expect(el("rampPaletteRow").previousElementSibling).toBe(
      el("fourDColorRow"),
    );
    expect(el("rampPaletteRow").closest("details")?.id).toBe("colorSection");
    expect(el("fourDColorRow").classList.contains("hidden")).toBe(true);

    // Non-flat: the visible select flips; the ramp row itself never moves —
    // the exclusive-open accordion's gate/gated co-location holds
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

  it("shows the ramp custom-stop editor in the 4D view when fourDColor is radius and rampPaletteId is custom", () => {
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

describe("position axis colors row", () => {
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

// "4D" is a DERIVED property of the system: there is no fourDActive flag
// to flip in AppState anymore, so these tests build a state whose
// transform list actually carries a non-trivial `w` block — exactly what
// systemIsNonFlat (and so the panel gating) reads.
function nonFlatTransforms(): Transform[] {
  return [{ ...defaultTransforms()[0], w: { position: 0.5 } }];
}

describe("Ui 4D view gating", () => {
  function el(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
  }

  it("hides the 4D controls for a flat system", () => {
    const ui = new Ui(document);
    ui.updateLabels(initialState(true));

    expect(el("fourDControls").classList.contains("hidden")).toBe(true);
  });

  // The panel's own heading tells the truth per generation: the
  // system's dimensionality is a live property, not a fixed claim
  // about the app.
  it("titles the panel by the system's dimensionality", () => {
    const ui = new Ui(document);

    ui.updateLabels(initialState(true));
    expect(el("panelTitle").textContent).toBe("3D IFS Fractal");

    ui.updateLabels({ ...initialState(true), transforms: nonFlatTransforms() });
    expect(el("panelTitle").textContent).toBe("4D IFS Fractal");

    ui.updateLabels(initialState(true));
    expect(el("panelTitle").textContent).toBe("3D IFS Fractal");
  });

  it("shows the 4D controls and hides color/style — but keeps Symmetry — for a non-flat system; the render mode switch stays", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), transforms: nonFlatTransforms() });

    expect(el("fourDControls").classList.contains("hidden")).toBe(false);
    // All three render modes stay reachable on a non-flat system — the
    // segmented control is a view-independent switch, unlike the retired
    // flame/solid entry islands it replaced.
    expect(el("renderModeSwitch").classList.contains("hidden")).toBe(false);
    expect(el("colorModeRow").classList.contains("hidden")).toBe(true);
    expect(el("renderStyleRow").classList.contains("hidden")).toBe(true);
    // The Symmetry section used to hide here too; every render path sweeps
    // or expands the kaleidoscope for a 4D system, so its controls stay
    // editable.
    expect(el("symmetrySection").classList.contains("hidden")).toBe(false);
  });

  // The 4D look controls live in Appearance beside their flat siblings
  // — color is an Appearance concern in both views; the 4D View
  // section keeps only the spatial tumble/slice controls.
  it("shows the 4D Color and depth-fade rows in Appearance only while non-flat", () => {
    const ui = new Ui(document);

    ui.updateLabels(initialState(true));
    expect(el("fourDColorRow").classList.contains("hidden")).toBe(true);
    expect(el("fourDDepthFadeRow").classList.contains("hidden")).toBe(true);

    ui.updateLabels({ ...initialState(true), transforms: nonFlatTransforms() });
    expect(el("fourDColorRow").classList.contains("hidden")).toBe(false);
    expect(el("fourDDepthFadeRow").classList.contains("hidden")).toBe(false);
    expect(el("fourDColorRow").closest("details")?.id).toBe("colorSection");
    expect(el("fourDDepthFadeRow").closest("details")?.id).toBe(
      "atmosphereSection",
    );
    expect(el("fourDControls").contains(el("fourDColorRow"))).toBe(false);
  });

  // The 3D View block (auto-orbit) is the flat-system counterpart of the
  // 4D block: exactly one of the two shows outside a render, and both
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

  // Flame and solid freeze the 4D view (rotor + slice) into their active
  // render's worker snapshot (main.ts's fourDRenderSnapshot), so its controls
  // hide during those FROZEN renders exactly like the editing controls do. A
  // live 4D surface session is different: its tracer re-poses the view every
  // frame instead of freezing it — see the "Ui 4D surface session controls"
  // tests below.
  it("hides the 4D tumble/slice controls while a FROZEN render is active on a non-flat system", () => {
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

  // The crucial inversion from the old 4D MODE: unlike the retired
  // fourDActive flag, which hid the whole editing surface, a non-flat system
  // keeps its presets/transform-list/editor exactly as live and visible as a
  // flat one — only the controls that are genuinely inert while viewing the
  // 4D shader path hide (see the previous test).
  it("keeps the presets block, transform list, and editor visible for a non-flat system", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), transforms: nonFlatTransforms() });

    expect(el("presetSection").classList.contains("hidden")).toBe(false);
    // The list and editor live inside the Transforms accordion section, so
    // its visibility is theirs.
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
    // A non-flat system routes the legend to the 4D projection's diverging
    // w ramp instead of hiding it — colorMode is irrelevant here (color
    // comes from the rotated w in-shader). See the full w-ramp assertions
    // in the "Ui color legend" describe block.
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

  // The opening help-box line names the tumble motion instead of asserting
  // it unconditionally, so it has to track fourDTumbleActive (default true,
  // mirroring main.ts's fourDView.tumbleOn) rather than being a fixed
  // string.
  it("opens the help box on the auto-tumbling line by default", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), transforms: nonFlatTransforms() });

    expect(el("helpText").firstElementChild?.textContent).toBe(
      "Auto-tumbling 4D IFS",
    );
  });

  it("switches the help box to the paused line after resetFourDTumble(false)", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };

    ui.resetFourDTumble(false);
    ui.updateLabels(nonFlat);

    expect(el("helpText").firstElementChild?.textContent).toBe(
      "4D IFS (tumble paused)",
    );
    // The rest of the canvas hint has to survive the wording change
    // untouched, so a future rewrite can't silently drop the gesture lines.
    expect(
      Array.from(el("helpText").children).map((line) => line.textContent),
    ).toEqual([
      "4D IFS (tumble paused)",
      "1 finger: Rotate",
      "2 fingers: Pan/Zoom",
    ]);
  });

  // Regression test for the real user path: unchecking the panel's own
  // toggle has to repaint the help box, not just flip fourDTumbleActive
  // silently.
  it("re-words the help box when the tumble checkbox is unchecked", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };
    ui.bind({
      ...noopHandlers(),
      onFourDTumbleToggle: () => ui.updateLabels(nonFlat),
    });
    ui.updateLabels(nonFlat);

    (el("fourDTumbleToggle") as HTMLInputElement).checked = false;
    el("fourDTumbleToggle").dispatchEvent(new Event("change"));

    expect(el("helpText").firstElementChild?.textContent).toBe(
      "4D IFS (tumble paused)",
    );
  });

  // The build-replay showcase forces the tumble on for its duration via
  // setFourDTumbleActive without ever touching the user's checkbox, so the
  // help box has to believe the override, not the untouched control.
  it("words the help box as auto-tumbling when setFourDTumbleActive(true) overrides an unchecked checkbox", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };

    ui.resetFourDTumble(false);
    ui.setFourDTumbleActive(true);
    ui.updateLabels(nonFlat);

    expect(el("helpText").firstElementChild?.textContent).toBe(
      "Auto-tumbling 4D IFS",
    );
    expect((el("fourDTumbleToggle") as HTMLInputElement).checked).toBe(false);
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

// A live 4D surface session is the one case where the 4D View block's slice
// controls stay meaningful DURING a render: unlike flame/solid, which freeze
// the rotor/slice into a worker snapshot, the surface tracer re-poses the
// rotor and re-marches the w slice every frame (main.ts's setSurface4View),
// so the sliders are the only controls that reach it. The cross-section
// itself is unconditional in that mode — `sliceOn` never reaches the tracer
// (main.ts pushes only `sliceCenter` into setSurface4View) — so the on/off
// toggle would be a lie there, while the position slider is the mode's
// defining control; slice-relative color only remaps the w-depth palette the
// tracer doesn't have, so it hides too. The TUMBLE half is the exception:
// the ambient tumble parks in surface mode (its every tick would pin the
// tier scheduler in preview and the settle could never arm), so its controls
// hide whole — the user's checkbox state surviving for the projection view.
describe("Ui 4D surface session controls", () => {
  function el(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
  }

  it("keeps the 4D View block visible for a non-flat system in surface mode", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };

    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    expect(el("fourDControls").classList.contains("hidden")).toBe(false);
  });

  it("hides the W-slice on/off toggle in a live 4D surface session", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };

    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    expect(el("fourDSliceToggleRow").classList.contains("hidden")).toBe(true);
  });

  it("shows the slice position slider in a live 4D surface session even with the toggle unchecked", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };
    (el("fourDSliceToggle") as HTMLInputElement).checked = false;

    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    expect(el("fourDSliceRow").classList.contains("hidden")).toBe(false);
  });

  // fourDColorNeedsAttribute (color.ts) is false for the w-depth modes, so
  // "wBlueOrange" is a value the baked-mode gate alone would SHOW — asserting
  // it in both modes here makes the surface-only hide the visible contrast,
  // not a restatement of the baked-mode gate covered above.
  it("hides slice-relative color in a live 4D surface session", () => {
    const ui = new Ui(document);
    const nonFlat = {
      ...initialState(true),
      transforms: nonFlatTransforms(),
      fourDColor: "wBlueOrange" as const,
    };

    ui.updateLabels(nonFlat);
    expect(el("fourDSliceRelColorRow").classList.contains("hidden")).toBe(
      false,
    );

    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });
    expect(el("fourDSliceRelColorRow").classList.contains("hidden")).toBe(true);
  });

  // main.ts's syncFourDSliceUi path: a timeline pose glide can land while the
  // panel is already showing a live surface session, calling setFourDSlice
  // directly rather than going through updateLabels. It must not re-hide the
  // position slider out from under that session.
  it("keeps the slice position slider visible when a pose glide lands mid-surface-session", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };
    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    ui.setFourDSlice(false, 0.4, false, 0);

    expect(el("fourDSliceRow").classList.contains("hidden")).toBe(false);
    expect((el("fourDSliceSlider") as HTMLInputElement).value).toBe("0.4");
  });

  // The slice-thickness slider is the exact complement of the W-slice on/off
  // toggle above: the slab it widens is a property of the tracer's own
  // distance estimator, so it appears only where that tracer runs. Points'
  // slice is a fixed-width Gaussian this control never touches.
  it("shows the slice thickness slider in a live 4D surface session", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };

    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    expect(el("fourDSliceThicknessRow").classList.contains("hidden")).toBe(
      false,
    );
  });

  it("hides the slice thickness slider for a 4D point-cloud view with the slice on", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };
    (el("fourDSliceToggle") as HTMLInputElement).checked = true;

    ui.updateLabels(nonFlat);

    // The slice row itself is open here — only the thickness sub-row hides,
    // so this can't pass by the whole block being hidden.
    expect(el("fourDSliceRow").classList.contains("hidden")).toBe(false);
    expect(el("fourDSliceThicknessRow").classList.contains("hidden")).toBe(
      true,
    );
  });

  it("re-hides the slice thickness slider after leaving surface mode", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };
    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    ui.updateLabels(nonFlat);

    expect(el("fourDSliceThicknessRow").classList.contains("hidden")).toBe(
      true,
    );
  });

  it("keeps the slice thickness slider visible when a pose glide lands mid-surface-session", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };
    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    ui.setFourDSlice(false, 0, false, 0.25);

    expect(el("fourDSliceThicknessRow").classList.contains("hidden")).toBe(
      false,
    );
  });

  // Two sessions refuse the slab and they owe DIFFERENT reasons. The
  // descent refuses it per fold family (a spherefold bends a segment into
  // an arc), so a box-fold-only system keeps it — a knob the user can act
  // on. A 4D escape-time session refuses it at every fold family, because
  // its forward orbit has no branches to thread a segment through, and
  // handing it the descent's wording would tell a box-fold-only chain to
  // do what it is already doing.
  it("gives an escape-time session its own slab reason, not the sphere-fold one", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };
    ui.setSurfaceSessionKind("escape");
    ui.setFourDSlabAvailable(false);
    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    const title = el("fourDSliceThicknessRow").title;
    expect(title).toContain("escape-time render");
    expect(title).toContain("FORWARD");
    expect(title).not.toContain("sphere folds");
  });

  it("keeps the sphere-fold slab reason for an IFS session", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };
    ui.setSurfaceSessionKind("ifs");
    ui.setFourDSlabAvailable(false);
    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    const title = el("fourDSliceThicknessRow").title;
    expect(title).toContain("sphere folds");
    expect(title).not.toContain("escape-time render");
  });

  it("clears the slab reason once a session can take one", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };
    ui.setSurfaceSessionKind("ifs");
    ui.setFourDSlabAvailable(true);
    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    expect(el("fourDSliceThicknessRow").title).toBe("");
    expect((el("fourDSliceThicknessSlider") as HTMLInputElement).disabled).toBe(
      false,
    );
  });

  it("restores the normal points-mode slice behavior after leaving surface mode", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };
    (el("fourDSliceToggle") as HTMLInputElement).checked = false;
    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    ui.updateLabels(nonFlat);

    expect(el("fourDSliceToggleRow").classList.contains("hidden")).toBe(false);
    expect(el("fourDSliceRow").classList.contains("hidden")).toBe(true);
  });

  // The ambient tumble PARKS in surface mode (main.ts skips the tick —
  // every one would invalidate the frame and pin the tier scheduler in
  // preview, so the settle could never arm), and a visible toggle whose
  // motion never happens reads as a broken view — both tumble rows hide.
  it("hides the auto-tumble toggle and speed rows in a live 4D surface session", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };
    (el("fourDTumbleToggle") as HTMLInputElement).checked = true;

    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    expect(el("fourDTumbleToggleRow").classList.contains("hidden")).toBe(true);
    expect(el("fourDTumbleRow").classList.contains("hidden")).toBe(true);
  });

  it("restores the tumble controls — checkbox state untouched — after leaving surface mode", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };
    (el("fourDTumbleToggle") as HTMLInputElement).checked = true;
    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    ui.updateLabels(nonFlat);

    expect(el("fourDTumbleToggleRow").classList.contains("hidden")).toBe(false);
    expect(el("fourDTumbleRow").classList.contains("hidden")).toBe(false);
    expect((el("fourDTumbleToggle") as HTMLInputElement).checked).toBe(true);
  });

  it("keeps the speed row hidden after surface mode when the user's tumble toggle was off", () => {
    const ui = new Ui(document);
    const nonFlat = { ...initialState(true), transforms: nonFlatTransforms() };
    (el("fourDTumbleToggle") as HTMLInputElement).checked = false;
    ui.updateLabels({ ...nonFlat, renderMode: "surface" as const });

    ui.updateLabels(nonFlat);

    expect(el("fourDTumbleToggleRow").classList.contains("hidden")).toBe(false);
    expect(el("fourDTumbleRow").classList.contains("hidden")).toBe(true);
  });

  // Guards against the gate keying on render mode alone rather than the
  // non-flat predicate main.ts actually routes a surface session on.
  it("keeps the 4D block hidden for a flat system in surface mode", () => {
    const ui = new Ui(document);

    ui.updateLabels({ ...initialState(true), renderMode: "surface" as const });

    expect(el("fourDControls").classList.contains("hidden")).toBe(true);
  });
});

describe("Ui 4D slice controls", () => {
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

  it("fires onFourDSliceThicknessInput with the slider's numeric value and updates the label", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const slider = el("fourDSliceThicknessSlider") as HTMLInputElement;

    slider.value = "0.25";
    slider.dispatchEvent(new Event("input"));

    expect(handlers.onFourDSliceThicknessInput).toHaveBeenCalledWith(0.25);
    expect(el("fourDSliceThicknessLabel").textContent).toBe("0.25");
  });

  it("setFourDSlice syncs the thickness slider and its label to a restored pose", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());

    ui.setFourDSlice(false, 0, false, 0.3);

    expect((el("fourDSliceThicknessSlider") as HTMLInputElement).value).toBe(
      "0.3",
    );
    expect(el("fourDSliceThicknessLabel").textContent).toBe("0.30");
  });

  it("resetFourDSlice returns the thickness slider to a zero-thickness slice", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const slider = el("fourDSliceThicknessSlider") as HTMLInputElement;
    slider.value = "0.4";
    slider.dispatchEvent(new Event("input"));

    ui.resetFourDSlice();

    expect(slider.value).toBe("0");
    expect(el("fourDSliceThicknessLabel").textContent).toBe("0.00");
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

describe("Ui 4D depth-fade control", () => {
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

describe("Ui 3D auto-orbit controls", () => {
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

describe("Ui 4D tumble controls", () => {
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

  it("writes the percentage to the --progress custom property", () => {
    const ui = new Ui(document);
    ui.setSolidProgress(12_345_000, 20_000_000);
    const progress = document.getElementById("solidProgress");
    expect(progress?.style.getPropertyValue("--progress")).toBe("61%");
  });

  it("resets --progress to 0% when called with no iterations done", () => {
    const ui = new Ui(document);
    ui.setSolidProgress(20_000_000, 20_000_000);
    ui.setSolidProgress(0, 20_000_000);
    const progress = document.getElementById("solidProgress");
    expect(progress?.style.getPropertyValue("--progress")).toBe("0%");
  });
});

describe("Ui.setSolidResolutionNote", () => {
  function note(): HTMLElement | null {
    return document.getElementById("solidResolutionNote");
  }

  it("starts empty, rendered (never .hidden)", () => {
    new Ui(document);
    expect(note()?.textContent).toBe("");
    expect(note()?.classList.contains("hidden")).toBe(false);
  });

  it("shows a reduced-from message when passed an effective value", () => {
    const ui = new Ui(document);
    ui.setSolidResolutionNote(128, 192);
    expect(note()?.textContent).toBe(
      "Reduced to 128³ (from 192³) to fit available memory.",
    );
  });

  it("clears back to empty text on null, the element staying rendered", () => {
    const ui = new Ui(document);
    ui.setSolidResolutionNote(128, 192);
    ui.setSolidResolutionNote(null);
    expect(note()?.textContent).toBe("");
    expect(note()?.classList.contains("hidden")).toBe(false);
  });
});

describe("Ui.setSurfaceProgress", () => {
  function progress(): HTMLElement | null {
    return document.getElementById("surfaceProgress");
  }

  it("is hidden by default (index.html ships it hidden)", () => {
    new Ui(document);
    expect(progress()?.classList.contains("hidden")).toBe(true);
  });

  it("shows the label and percentage and un-hides", () => {
    const ui = new Ui(document);
    ui.setSurfaceProgress({ label: "Full detail · WebGPU", pct: 51 });
    expect(progress()?.classList.contains("hidden")).toBe(false);
    expect(progress()?.textContent).toBe("Full detail · WebGPU 51%");
    expect(progress()?.style.getPropertyValue("--progress")).toBe("51%");
  });

  it("appends a trailing fallback-reason detail after the percentage", () => {
    const ui = new Ui(document);
    ui.setSurfaceProgress({
      label: "Full detail · WebGL",
      pct: 12,
      detail: "compute failed",
    });
    expect(progress()?.textContent).toBe(
      "Full detail · WebGL 12% — compute failed",
    );
    expect(progress()?.style.getPropertyValue("--progress")).toBe("12%");
  });

  it("passes a fractional percentage through unrounded", () => {
    const ui = new Ui(document);
    ui.setSurfaceProgress({ label: "Preview · WebGL", pct: 0.4 });
    expect(progress()?.textContent).toBe("Preview · WebGL 0.4%");
  });

  it("hides again and resets --progress to 0% when passed null", () => {
    const ui = new Ui(document);
    ui.setSurfaceProgress({ label: "Full detail · WebGPU", pct: 51 });
    ui.setSurfaceProgress(null);
    expect(progress()?.classList.contains("hidden")).toBe(true);
    expect(progress()?.style.getPropertyValue("--progress")).toBe("0%");
  });

  it("clears textContent when passed null, not just hiding", () => {
    const ui = new Ui(document);
    ui.setSurfaceProgress({ label: "Full detail · WebGPU", pct: 99 });
    ui.setSurfaceProgress(null);
    expect(progress()?.textContent).toBe("");
  });

  function skipButton(): HTMLElement | null {
    return document.getElementById("surfaceSkipPreviewBtn");
  }

  it("shows the Skip button only for a skippable phase", () => {
    const ui = new Ui(document);
    ui.setSurfaceProgress({
      label: "Preview · WebGL",
      pct: 3,
      skippable: true,
    });
    expect(skipButton()?.classList.contains("hidden")).toBe(false);
    ui.setSurfaceProgress({ label: "Full detail · WebGL", pct: 3 });
    expect(skipButton()?.classList.contains("hidden")).toBe(true);
  });

  it("hides the Skip button when the row hides", () => {
    const ui = new Ui(document);
    ui.setSurfaceProgress({
      label: "Preview · WebGL",
      pct: 3,
      skippable: true,
    });
    ui.setSurfaceProgress(null);
    expect(skipButton()?.classList.contains("hidden")).toBe(true);
  });

  it("fires onSurfaceSkipPreview when the Skip button is clicked", () => {
    const ui = new Ui(document);
    const handlers = noopHandlers();
    ui.bind(handlers);
    ui.setSurfaceProgress({
      label: "Preview · WebGL",
      pct: 3,
      skippable: true,
    });
    (skipButton() as HTMLButtonElement).click();
    expect(handlers.onSurfaceSkipPreview).toHaveBeenCalledTimes(1);
  });
});

describe("Ui surface quick-previews toggle", () => {
  function toggle(): HTMLInputElement {
    return document.getElementById("surfacePreviewToggle") as HTMLInputElement;
  }

  it("ships checked (previews on) in the markup", () => {
    new Ui(document);
    expect(toggle().checked).toBe(true);
  });

  it("fires onSurfacePreviewToggle with the new checked state", () => {
    const ui = new Ui(document);
    const handlers = noopHandlers();
    ui.bind(handlers);
    toggle().checked = false;
    toggle().dispatchEvent(new Event("change"));
    expect(handlers.onSurfacePreviewToggle).toHaveBeenCalledWith(false);
  });

  it("setSurfacePreviewToggle seeds the checkbox without firing the handler", () => {
    const ui = new Ui(document);
    const handlers = noopHandlers();
    ui.bind(handlers);
    ui.setSurfacePreviewToggle(false);
    expect(toggle().checked).toBe(false);
    expect(handlers.onSurfacePreviewToggle).not.toHaveBeenCalled();
  });
});

describe("Ui symmetry controls", () => {
  function note(): HTMLElement | null {
    return document.getElementById("symmetryNote");
  }

  it("reflects order and plane into the slider, label, and select", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      symmetry: { order: 5, plane: "xy" },
    });

    expect(
      (document.getElementById("symmetryOrderSlider") as HTMLInputElement)
        .value,
    ).toBe("5");
    expect(document.getElementById("symmetryOrderLabel")?.textContent).toBe(
      "5-fold",
    );
    expect(
      (document.getElementById("symmetryPlane") as HTMLSelectElement).value,
    ).toBe("xy");
  });

  it("offers all six coordinate planes in the plane select, w-planes included", () => {
    const select = document.getElementById(
      "symmetryPlane",
    ) as HTMLSelectElement;

    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      ...SYMMETRY_PLANES,
    ]);
  });

  it("reflects the twist into its slider and label, showing 0 for an absent twist", () => {
    const ui = new Ui(document);
    const slider = document.getElementById(
      "symmetryTwistSlider",
    ) as HTMLInputElement;
    const label = document.getElementById("symmetryTwistLabel");

    ui.updateLabels({
      ...initialState(true),
      symmetry: { order: 6, plane: "xy", twist: 2 },
    });
    expect(slider.value).toBe("2");
    expect(label?.textContent).toBe("2");

    // An absent twist is the stored form of 0 (see setSymmetryTwist).
    ui.updateLabels({
      ...initialState(true),
      symmetry: { order: 6, plane: "xy" },
    });
    expect(slider.value).toBe("0");
    expect(label?.textContent).toBe("0");
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

  it("applies the selected plane to state.symmetry.plane on change", () => {
    const { handlers, current } = scalarHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    const select = document.getElementById(
      "symmetryPlane",
    ) as HTMLSelectElement;
    select.value = "yz";
    select.dispatchEvent(new Event("change"));

    expect(current().symmetry.plane).toBe("yz");
  });

  it("applies the twist slider's value to state.symmetry.twist through its clamping reducer", () => {
    // Order 4 first, so the reducer's own order-1 cap is what the assertion
    // exercises: the slider's static 0..11 range never clamps for it.
    const { handlers, current } = scalarHandlers(
      setSymmetryOrder(initialState(true), 4),
    );
    const ui = new Ui(document);
    ui.bind(handlers);

    const slider = document.getElementById(
      "symmetryTwistSlider",
    ) as HTMLInputElement;
    slider.value = "2";
    slider.dispatchEvent(new Event("input"));
    expect(current().symmetry.twist).toBe(2);

    // Out of range for the CURRENT order: setSymmetryTwist caps at
    // order - 1, the single source of twist clamping (the slider max stays
    // static at MAX_SYMMETRY_ORDER - 1).
    slider.value = "9";
    slider.dispatchEvent(new Event("input"));
    expect(current().symmetry.twist).toBe(3);
  });

  it("hides the reduction note when the requested order fits under the transform limit", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      symmetry: { order: 9, plane: "xz" },
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
      symmetry: { order: 9, plane: "xz" },
    });

    expect(note()?.classList.contains("hidden")).toBe(false);
    expect(note()?.textContent).toBe(
      "Reduced to 8-fold (from 9-fold) to fit the 256-transform limit.",
    );
  });
});

// index.html's slider min/max are single-sourced from state.ts's PARAM table.
// This pins every DIRECTLY-mapped slider (HTML range == the parameter's value
// range) against its spec, so editing a range in one place without the other
// fails here. Excluded on purpose (their HTML range is a mapping DOMAIN, not
// the parameter's value range — see control-spec.ts): numPointsSlider and
// colorGammaSlider carry a log-scale position and flameIterationsSlider a
// detent index. symmetryOrderSlider joined the direct set once its max stopped
// being capped below its spec (which silently rewrote shared 10-12 links), and
// symmetryTwistSlider's static range IS its spec — the tighter order-dependent
// cap lives in setSymmetryTwist alone.
describe("index.html slider ranges match PARAM", () => {
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
    ["balloonRadiusSlider", PARAM.balloonRadius],
    ["surfaceBalloonRadiusSlider", PARAM.balloonRadius],
    ["fogSlider", PARAM.fogDensity],
    ["fogTintStrength", PARAM.fogTintStrength],
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
    ["surfaceLightAzimuthSlider", PARAM.surfaceLightAzimuth],
    ["surfaceLightElevationSlider", PARAM.surfaceLightElevation],
    ["surfaceAmbientSlider", PARAM.surfaceAmbient],
    ["surfaceEnvLightSlider", PARAM.surfaceEnvLight],
    ["surfaceColorSpeedSlider", PARAM.surfaceColorSpeed],
    ["symmetryOrderSlider", PARAM.symmetryOrder],
    ["symmetryTwistSlider", PARAM.symmetryTwist],
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

// The panel's categories are an exclusive-open accordion of native <details
// name="panel-section"> — one shared name, so the browser closes the rest
// when one opens. These pin the markup contract that behavior rides on; jsdom
// doesn't enforce the exclusivity itself, real browsers do.
describe("panel accordion sections", () => {
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

  // Each render mode remembers its own open section; switching modes
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

  it("entering surface mode opens its Surface Look section", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), renderMode: "surface" });
    expect(details("surfaceLookSection").open).toBe(true);
  });

  it("restores Atmosphere as Surface's remembered shared section", () => {
    const ui = new Ui(document);
    const points = initialState(true);
    const surface = { ...points, renderMode: "surface" as const };
    ui.updateLabels(surface);

    // Simulate the native exclusive-name exchange when the user opens the
    // shared Atmosphere section in Surface mode. jsdom does not close the
    // previously open details element itself.
    details("surfaceLookSection").open = false;
    const atmosphere = details("atmosphereSection");
    atmosphere.open = true;
    atmosphere.dispatchEvent(new Event("toggle"));

    ui.updateLabels(points);
    atmosphere.open = false; // the browser closes it when Presets reopens
    ui.updateLabels(surface);

    expect(atmosphere.open).toBe(true);
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

  it("keeps the editor's disclosures out of any enclosing accordion group", () => {
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
      1,
    );

    const editorDetails = [
      ...document.querySelectorAll<HTMLDetailsElement>(
        "#transformEditor details",
      ),
    ];
    expect(editorDetails.length).toBeGreaterThan(0);

    // The editor's groups nest INSIDE the Transforms section, and a details
    // name group must not contain nested members — sharing a name with any
    // ancestor disclosure would hand browsers an invalid group and make the
    // exclusivity misfire. The groups have a name of their own, so assert
    // the actual spec rule rather than "no name at all": no editor
    // disclosure may share a name with a disclosure that contains it.
    for (const details of editorDetails) {
      const name = details.getAttribute("name");
      expect(name).not.toBeNull();
      const clash = details.parentElement?.closest(`details[name="${name}"]`);
      expect(clash).toBeFalsy();
    }
  });
});

describe("Ui panel accordion re-anchor", () => {
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

  it("captions a saved-from-a-renderer entry with its mode glyph", () => {
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

describe("Ui timeline section", () => {
  const step = (id: string, thumbnail = "", morphMs = 4000, holdMs = 2000) => ({
    id,
    encoded: `v1=${id}`,
    thumbnail,
    morphMs,
    holdMs,
  });

  function addBtn(): HTMLButtonElement {
    return document.getElementById("timelineAddBtn") as HTMLButtonElement;
  }
  function playBtn(): HTMLButtonElement {
    return document.getElementById("timelinePlayBtn") as HTMLButtonElement;
  }
  function exportBtn(): HTMLButtonElement {
    return document.getElementById("timelineExportBtn") as HTMLButtonElement;
  }
  function exportTimelineBtn(): HTMLButtonElement {
    return document.getElementById("exportTimelineBtn") as HTMLButtonElement;
  }
  function status(): HTMLElement {
    return document.getElementById("timelineStatus") as HTMLElement;
  }
  function empty(): HTMLElement {
    return document.getElementById("timelineEmpty") as HTMLElement;
  }
  function rows(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(".timeline-step"));
  }
  function timingInputs(row: HTMLElement): HTMLInputElement[] {
    return Array.from(
      row.querySelectorAll<HTMLInputElement>("input[type='number']"),
    );
  }

  it("renders one row per step, the first row's thumbnail, and the timing inputs in seconds", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.renderTimeline(
      [step("a", "data:image/jpeg;base64,aaa", 4000, 2000), step("b")],
      "0:06",
    );

    expect(rows()).toHaveLength(2);
    expect(rows()[0].querySelector("img")?.getAttribute("src")).toBe(
      "data:image/jpeg;base64,aaa",
    );
    const [morphInput, holdInput] = timingInputs(rows()[0]);
    expect(morphInput.value).toBe("4");
    expect(holdInput.value).toBe("2");
  });

  it("shows the empty hint, hides the status line, and disables Play/Export for an empty timeline", () => {
    const ui = new Ui(document);
    ui.renderTimeline([], "0:00");

    expect(empty().classList.contains("hidden")).toBe(false);
    expect(status().classList.contains("hidden")).toBe(true);
    expect(playBtn().disabled).toBe(true);
    expect(exportBtn().disabled).toBe(true);
  });

  it("shows a keyframe count and the given duration label, with Play enabled", () => {
    const ui = new Ui(document);
    ui.renderTimeline([step("a"), step("b")], "0:12");

    expect(empty().classList.contains("hidden")).toBe(true);
    expect(status().classList.contains("hidden")).toBe(false);
    expect(status().textContent).toBe("2 keyframes · 0:12");
    expect(playBtn().disabled).toBe(false);
  });

  it("fires onTimelineAddKeyframe when the Add button is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    addBtn().click();
    expect(handlers.onTimelineAddKeyframe).toHaveBeenCalledOnce();
  });

  it("commits an edited morph seconds input as milliseconds", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTimeline([step("a")], "0:06");

    const [morphInput] = timingInputs(rows()[0]);
    morphInput.value = "2.5";
    morphInput.dispatchEvent(new Event("change"));

    expect(handlers.onTimelineStepTiming).toHaveBeenCalledWith("a", {
      morphMs: 2500,
    });
  });

  it("commits an edited hold seconds input as milliseconds", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTimeline([step("a")], "0:06");

    const [, holdInput] = timingInputs(rows()[0]);
    holdInput.value = "3";
    holdInput.dispatchEvent(new Event("change"));

    expect(handlers.onTimelineStepTiming).toHaveBeenCalledWith("a", {
      holdMs: 3000,
    });
  });

  it("restores the displayed value and fires nothing when a timing input commits empty", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTimeline([step("a", "", 4000, 2000)], "0:06");

    const [morphInput] = timingInputs(rows()[0]);
    morphInput.value = "";
    morphInput.dispatchEvent(new Event("change"));

    expect(morphInput.value).toBe("4");
    expect(handlers.onTimelineStepTiming).not.toHaveBeenCalled();
  });

  it("disables the first row's ↑ and the last row's ↓, and fires onTimelineMoveStep(-1) from a middle row's ↑", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTimeline([step("a"), step("b"), step("c")], "0:18");

    const [first, middle, last] = rows();
    expect(
      first.querySelector<HTMLButtonElement>(
        '[aria-label="Move keyframe 1 earlier"]',
      )?.disabled,
    ).toBe(true);
    expect(
      last.querySelector<HTMLButtonElement>(
        '[aria-label="Move keyframe 3 later"]',
      )?.disabled,
    ).toBe(true);

    middle
      .querySelector<HTMLButtonElement>(
        '[aria-label="Move keyframe 2 earlier"]',
      )
      ?.click();
    expect(handlers.onTimelineMoveStep).toHaveBeenCalledWith("b", -1);
  });

  it("fires onTimelineRemoveStep when a row's ✕ is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTimeline([step("a")], "0:06");

    rows()[0]
      .querySelector<HTMLButtonElement>(".timeline-step-delete")
      ?.click();
    expect(handlers.onTimelineRemoveStep).toHaveBeenCalledWith("a");
  });

  it("swaps the Play button to Stop and disables Export while active, then restores both", () => {
    const ui = new Ui(document);
    ui.renderTimeline([step("a")], "0:06");

    ui.setTimelineActive(true);
    expect(playBtn().textContent).toBe("■ Stop");
    expect(exportBtn().disabled).toBe(true);

    ui.setTimelineActive(false);
    expect(playBtn().textContent).toBe("▶ Play timeline");
    expect(exportBtn().disabled).toBe(false);
  });

  it("disables Play and Export with the reduced-motion title even with steps rendered", () => {
    const ui = new Ui(document);
    ui.renderTimeline([step("a")], "0:06");

    ui.setTimelineAvailable(false);

    expect(playBtn().disabled).toBe(true);
    expect(playBtn().title).toBe(
      "Unavailable: your system asks for reduced motion",
    );
    expect(exportBtn().disabled).toBe(true);
    expect(exportBtn().title).toBe(
      "Unavailable: your system asks for reduced motion",
    );
  });

  it("renders the ◆ placeholder instead of an img when a keyframe's thumbnail is blank", () => {
    const ui = new Ui(document);
    ui.renderTimeline([step("a", "")], "0:06");

    expect(rows()[0].querySelector("img")).toBeNull();
    expect(rows()[0].querySelector(".timeline-step-noimg")?.textContent).toBe(
      "◆",
    );
  });

  it("wears a mode glyph for a flame/solid keyframe", () => {
    const ui = new Ui(document);
    ui.renderTimeline(
      [
        { ...step("a"), mode: "flame" as const },
        { ...step("b"), mode: "solid" as const },
      ],
      "0:12",
    );

    expect(rows()[0].querySelector(".timeline-step-mode")?.textContent).toBe(
      "✺",
    );
    expect(rows()[1].querySelector(".timeline-step-mode")?.textContent).toBe(
      "◆",
    );
  });

  it("renders no mode glyph for a plain (points) keyframe", () => {
    const ui = new Ui(document);
    ui.renderTimeline([step("a")], "0:06");

    expect(rows()[0].querySelector(".timeline-step-mode")).toBeNull();
  });

  it("fires onExportTimeline when ⬇ Back up timeline is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.renderTimeline([step("a")], "0:06");

    exportTimelineBtn().click();

    expect(handlers.onExportTimeline).toHaveBeenCalledOnce();
  });

  it("disables ⬇ Back up timeline only while the timeline is empty", () => {
    const ui = new Ui(document);
    const authoredTitle = exportTimelineBtn().title;

    ui.renderTimeline([], "0:00");
    expect(exportTimelineBtn().disabled).toBe(true);
    expect(exportTimelineBtn().title).toBe(
      "Add a keyframe first — there's nothing to back up yet",
    );

    ui.renderTimeline([step("a")], "0:06");
    expect(exportTimelineBtn().disabled).toBe(false);
    expect(exportTimelineBtn().title).toBe(authoredTitle);
  });

  it("keeps ⬇ Back up timeline enabled during playback and under reduced motion — a data read, not motion", () => {
    const ui = new Ui(document);
    ui.renderTimeline([step("a")], "0:06");

    ui.setTimelineActive(true);
    ui.setTimelineAvailable(false);

    expect(exportTimelineBtn().disabled).toBe(false);
  });
});

describe("Ui file import/export", () => {
  it("fires onSaveSceneFile when ⤓ Save scene file is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    document.getElementById("saveSceneFileBtn")?.click();
    expect(handlers.onSaveSceneFile).toHaveBeenCalledTimes(1);
  });

  it("fires onSaveFlameFile when ⤓ Export .flame is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    document.getElementById("saveFlameFileBtn")?.click();
    expect(handlers.onSaveFlameFile).toHaveBeenCalledTimes(1);
  });

  it("accepts .flame files in the import picker", () => {
    new Ui(document);
    const accept =
      document.getElementById("importFileInput")?.getAttribute("accept") ?? "";
    expect(accept).toContain(".json");
    expect(accept).toContain(".flame");
  });

  it("fires onExportCollection when ⬇ Back up collection is clicked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.setCollectionCount(1);
    document.getElementById("exportCollectionBtn")?.click();
    expect(handlers.onExportCollection).toHaveBeenCalledTimes(1);
  });

  it("disables ⬇ Back up collection at count zero with an explanatory title, re-enabling on a save", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const btn = document.getElementById(
      "exportCollectionBtn",
    ) as HTMLButtonElement;
    const authoredTitle = btn.title;

    ui.setCollectionCount(0);
    expect(btn.disabled).toBe(true);
    expect(btn.title).not.toBe(authoredTitle);

    ui.setCollectionCount(3);
    expect(btn.disabled).toBe(false);
    expect(btn.title).toBe(authoredTitle);
  });

  it("⬆ Import file opens the hidden picker", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const input = document.getElementById(
      "importFileInput",
    ) as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");
    document.getElementById("importFileBtn")?.click();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("hands the picked file to onImportFile and resets the input so the same file can be re-picked", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const input = document.getElementById(
      "importFileInput",
    ) as HTMLInputElement;
    const file = new File(["{}"], "backup.json", { type: "application/json" });
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });

    input.dispatchEvent(new Event("change"));

    expect(handlers.onImportFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe("");
  });

  it("does not fire onImportFile when the picker is dismissed with no file", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    const input = document.getElementById(
      "importFileInput",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [], configurable: true });

    input.dispatchEvent(new Event("change"));

    expect(handlers.onImportFile).not.toHaveBeenCalled();
  });
});

describe("Ui mutation grid", () => {
  const SIZE = 4;
  const pixels = () => new Uint8ClampedArray(SIZE * SIZE * 4);
  const cells = () =>
    Array.from(document.querySelectorAll("#mutationGrid .mutation-cell"));

  it("opens with nine placeholder cells: eight disabled buttons around an inert 'current' center", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openMutations();
    expect(
      document.getElementById("mutationModal")?.classList.contains("hidden"),
    ).toBe(false);
    const all = cells();
    expect(all).toHaveLength(9);
    const buttons = all.filter((el) => el instanceof HTMLButtonElement);
    expect(buttons).toHaveLength(8);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    const center = all[4];
    expect(center).not.toBeInstanceOf(HTMLButtonElement);
    expect(center.querySelector(".mutation-cell-tag")?.textContent).toBe(
      "current",
    );
  });

  it("setMutationCell enables the cell and a click fires onMutationPick with the candidate index", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.openMutations();
    ui.setMutationCell(4, pixels(), SIZE, false);
    // Candidate 4 sits AFTER the center, at DOM position 5.
    const cell = cells()[5] as HTMLButtonElement;
    expect(cell.disabled).toBe(false);
    expect(cell.querySelector("canvas")).not.toBeNull();
    cell.click();
    expect(handlers.onMutationPick).toHaveBeenCalledWith(4);
  });

  it("a still-unfilled cell stays disabled and never fires a pick", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.openMutations();
    const cell = cells()[0] as HTMLButtonElement;
    cell.click();
    expect(handlers.onMutationPick).not.toHaveBeenCalled();
  });

  it("tags the wildcard cell", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openMutations();
    ui.setMutationCell(7, pixels(), SIZE, true);
    const cell = cells()[8];
    expect(cell.querySelector(".mutation-cell-tag")?.textContent).toBe("wild");
  });

  it("resetMutationCells returns every cell to a disabled placeholder", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openMutations();
    ui.setMutationCell(0, pixels(), SIZE, false);
    ui.resetMutationCells();
    const cell = cells()[0] as HTMLButtonElement;
    expect(cell.disabled).toBe(true);
    expect(cell.querySelector("canvas")).toBeNull();
  });

  it("the Mutate button fires onOpenMutations and 'Mutate again' fires onMutateAgain", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    document.getElementById("mutateBtn")?.click();
    expect(handlers.onOpenMutations).toHaveBeenCalledTimes(1);
    document.getElementById("mutationAgainBtn")?.click();
    expect(handlers.onMutateAgain).toHaveBeenCalledTimes(1);
  });

  it("closeMutations hides the modal and mutationsOpen reflects it", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openMutations();
    expect(ui.mutationsOpen()).toBe(true);
    ui.closeMutations();
    expect(ui.mutationsOpen()).toBe(false);
    expect(
      document.getElementById("mutationModal")?.classList.contains("hidden"),
    ).toBe(true);
  });
});

describe("Ui toast", () => {
  function toastEl(): HTMLElement {
    return document.getElementById("toast") as HTMLElement;
  }

  it("shows a plain message with no action button", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());

    ui.flashToast("Saved to collection");

    expect(toastEl().classList.contains("hidden")).toBe(false);
    expect(toastEl().textContent).toBe("Saved to collection");
    expect(toastEl().querySelector(".toast-action")).toBeNull();
  });

  it("renders an action button labeled from the action, alongside the message", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());

    ui.flashToast("Deleted from collection", {
      label: "Undo",
      onAction: vi.fn(),
    });

    expect(toastEl().firstChild?.textContent).toBe("Deleted from collection");
    const button = toastEl().querySelector<HTMLButtonElement>(".toast-action");
    expect(button?.textContent).toBe("Undo");
  });

  it("clicking the action button fires onAction and hides the toast immediately", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const onAction = vi.fn();
    ui.flashToast("Deleted from collection", { label: "Undo", onAction });

    toastEl().querySelector<HTMLButtonElement>(".toast-action")?.click();

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(toastEl().classList.contains("hidden")).toBe(true);
  });

  it("a later plain toast leaves no stale action button behind from a prior action toast", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.flashToast("Deleted from collection", {
      label: "Undo",
      onAction: vi.fn(),
    });

    ui.flashToast("Saved to collection");

    expect(toastEl().querySelector(".toast-action")).toBeNull();
    expect(toastEl().textContent).toBe("Saved to collection");
  });

  it("only an action toast opts its pill into pointer events", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());

    ui.flashToast("Saved to collection");
    expect(toastEl().classList.contains("toast-actionable")).toBe(false);

    ui.flashToast("Deleted", { label: "Undo", onAction: vi.fn() });
    expect(toastEl().classList.contains("toast-actionable")).toBe(true);

    ui.flashToast("Saved to collection");
    expect(toastEl().classList.contains("toast-actionable")).toBe(false);
  });

  describe("auto-hide pause on hover and focus", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function hover(): void {
      toastEl().dispatchEvent(new MouseEvent("mouseenter"));
    }
    function unhover(): void {
      toastEl().dispatchEvent(new MouseEvent("mouseleave"));
    }
    function focusAction(): void {
      toastEl()
        .querySelector(".toast-action")
        ?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    }
    function blurAction(): void {
      toastEl()
        .querySelector(".toast-action")
        ?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    }

    it("a plain toast still auto-hides after its 1.8s window", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      ui.flashToast("Saved to collection");

      vi.advanceTimersByTime(1799);
      expect(toastEl().classList.contains("hidden")).toBe(false);
      vi.advanceTimersByTime(1);
      expect(toastEl().classList.contains("hidden")).toBe(true);
    });

    it("an untouched action toast still auto-hides after its 6s window", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      ui.flashToast("Deleted", { label: "Undo", onAction: vi.fn() });

      vi.advanceTimersByTime(5999);
      expect(toastEl().classList.contains("hidden")).toBe(false);
      vi.advanceTimersByTime(1);
      expect(toastEl().classList.contains("hidden")).toBe(true);
    });

    it("hovering holds the toast open indefinitely; leaving restarts the countdown", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      ui.flashToast("Deleted", { label: "Undo", onAction: vi.fn() });

      hover();
      vi.advanceTimersByTime(60_000);
      expect(toastEl().classList.contains("hidden")).toBe(false);

      unhover();
      vi.advanceTimersByTime(5999);
      expect(toastEl().classList.contains("hidden")).toBe(false);
      vi.advanceTimersByTime(1);
      expect(toastEl().classList.contains("hidden")).toBe(true);
    });

    it("focus inside the toast holds it open; focus leaving restarts the countdown", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      ui.flashToast("Deleted", { label: "Undo", onAction: vi.fn() });

      focusAction();
      vi.advanceTimersByTime(60_000);
      expect(toastEl().classList.contains("hidden")).toBe(false);

      blurAction();
      vi.advanceTimersByTime(6000);
      expect(toastEl().classList.contains("hidden")).toBe(true);
    });

    it("hover and focus hold independently — both must clear before the countdown resumes", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      ui.flashToast("Deleted", { label: "Undo", onAction: vi.fn() });

      hover();
      focusAction();
      unhover();
      vi.advanceTimersByTime(60_000);
      expect(toastEl().classList.contains("hidden")).toBe(false);

      blurAction();
      vi.advanceTimersByTime(6000);
      expect(toastEl().classList.contains("hidden")).toBe(true);
    });

    it("an actionable toast replacing a hovered one keeps the hold (re-probed, not reset)", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      ui.flashToast("Deleted from collection", {
        label: "Undo",
        onAction: vi.fn(),
      });
      hover();
      // The pointer never leaves the pill while the replacement lands, so no
      // new mouseenter will ever fire — flashToast must re-probe the live
      // :hover state instead of blind-resetting it, or the new Undo auto-
      // hides under the user's own pointer. jsdom has no hit-testing, so the
      // probe is stubbed to answer what a real browser would.
      const probe = vi.spyOn(toastEl(), "matches").mockReturnValue(true);
      ui.flashToast("Keyframe removed", { label: "Undo", onAction: vi.fn() });
      probe.mockRestore();

      vi.advanceTimersByTime(60_000);
      expect(toastEl().classList.contains("hidden")).toBe(false);

      unhover();
      vi.advanceTimersByTime(5999);
      expect(toastEl().classList.contains("hidden")).toBe(false);
      vi.advanceTimersByTime(1);
      expect(toastEl().classList.contains("hidden")).toBe(true);
    });

    it("a stale hold from a vanished toast cannot wedge the next one open", () => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      ui.flashToast("Deleted", { label: "Undo", onAction: vi.fn() });
      hover();
      // The action dismisses the toast under the pointer — no mouseleave
      // will ever fire for it.
      toastEl().querySelector<HTMLButtonElement>(".toast-action")?.click();
      expect(toastEl().classList.contains("hidden")).toBe(true);

      ui.flashToast("Saved to collection");

      vi.advanceTimersByTime(1800);
      expect(toastEl().classList.contains("hidden")).toBe(true);
    });
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

describe("Ui export progress modal", () => {
  function exportModal(): HTMLElement {
    return document.getElementById("exportModal") as HTMLElement;
  }
  function exportTitle(): HTMLElement {
    return document.getElementById("exportTitle") as HTMLElement;
  }
  function exportDetail(): HTMLElement {
    return document.getElementById("exportDetail") as HTMLElement;
  }
  function exportProgress(): HTMLElement {
    return document.getElementById("exportProgress") as HTMLElement;
  }
  function exportCancelBtn(): HTMLButtonElement {
    return document.getElementById("exportCancelBtn") as HTMLButtonElement;
  }
  /** The early-save second action, or null when it is not on offer — it is
   * DETACHED rather than hidden, so absence is the document's answer. */
  function exportDeliverBtn(): HTMLButtonElement | null {
    return document.getElementById(
      "exportDeliverBtn",
    ) as HTMLButtonElement | null;
  }
  function exportBackdrop(): HTMLElement {
    const backdrop = exportModal().querySelector(".gallery-backdrop");
    if (!(backdrop instanceof HTMLElement)) {
      throw new Error("No backdrop under #exportModal");
    }
    return backdrop;
  }
  function savePngBtn(): HTMLButtonElement {
    return document.getElementById("savePngBtn") as HTMLButtonElement;
  }
  function pressEscape(): void {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  }

  it("is hidden in the shipped markup", () => {
    new Ui(document);
    expect(exportModal().classList.contains("hidden")).toBe(true);
  });

  it("showExportProgress un-hides it and writes title + detail", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());

    ui.showExportProgress({
      title: "Saving PNG",
      detail: "1920×1080 · 4×",
      cancellable: true,
    });

    expect(exportModal().classList.contains("hidden")).toBe(false);
    expect(exportTitle().textContent).toBe("Saving PNG");
    expect(exportDetail().textContent).toBe("1920×1080 · 4×");
  });

  it("shows the Cancel button when cancellable, hides it when not", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());

    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });
    expect(exportCancelBtn().classList.contains("hidden")).toBe(false);

    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: false,
    });
    expect(exportCancelBtn().classList.contains("hidden")).toBe(true);
  });

  it('setExportProgress writes "43% · 12s" and sets --progress to 43%', () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    ui.setExportProgress({ pct: 43, note: "12s" });

    expect(exportProgress().textContent).toBe("43% · 12s");
    expect(exportProgress().style.getPropertyValue("--progress")).toBe("43%");
  });

  it("pct: null shows the note alone, sets --progress to 0%, and adds the busy pulse", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    ui.setExportProgress({ pct: null, note: "estimating…" });

    expect(exportProgress().textContent).toBe("estimating…");
    expect(exportProgress().style.getPropertyValue("--progress")).toBe("0%");
    expect(
      exportProgress().classList.contains("flame-progress-estimating"),
    ).toBe(true);
  });

  it("a non-null pct after a null one removes the busy pulse", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });
    ui.setExportProgress({ pct: null, note: "estimating…" });

    ui.setExportProgress({ pct: 10, note: "3s" });

    expect(
      exportProgress().classList.contains("flame-progress-estimating"),
    ).toBe(false);
  });

  it("Cancel click fires onExportCancel exactly once", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    exportCancelBtn().click();

    expect(handlers.onExportCancel).toHaveBeenCalledTimes(1);
  });

  it("fires onExportCancel on Escape while open", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    pressEscape();

    expect(handlers.onExportCancel).toHaveBeenCalledTimes(1);
  });

  it("does not fire onExportCancel on Escape when the run is not cancellable", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: false,
    });

    pressEscape();

    expect(handlers.onExportCancel).not.toHaveBeenCalled();
  });

  it("takes the second action out of the document at construction", () => {
    // The shipped markup declares it; a Ui that has never shown a modal must
    // still not have it in the page.
    new Ui(document);

    expect(exportDeliverBtn()).toBeNull();
  });

  it("leaves the second action out of the document for a run that did not offer one", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());

    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    expect(exportDeliverBtn()).toBeNull();
  });

  it("puts the second action into the dialog, before Cancel, with the caller's own label", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());

    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
      deliverEarly: { label: "Save now (rough)" },
    });

    const btn = exportDeliverBtn();
    expect(btn?.textContent).toBe("Save now (rough)");
    expect(btn?.nextElementSibling).toBe(exportCancelBtn());
  });

  it("takes the second action back out on the next run that does not offer it", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
      deliverEarly: { label: "Save now (rough)" },
    });

    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    expect(exportDeliverBtn()).toBeNull();
  });

  it("takes the second action out again when the modal hides, not just on the next run", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
      deliverEarly: { label: "Save now (rough)" },
    });

    ui.hideExportProgress();

    // Between runs nothing is offering it, so nothing may be able to find it.
    expect(exportDeliverBtn()).toBeNull();
  });

  it("re-offers the second action on a later run after one that did not", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
      deliverEarly: { label: "Save now (rough)" },
    });
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
      deliverEarly: { label: "Save now (rough)" },
    });

    expect(exportDeliverBtn()?.nextElementSibling).toBe(exportCancelBtn());
  });

  it("second-action click fires onExportDeliverEarly, not onExportCancel", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
      deliverEarly: { label: "Save now (rough)" },
    });

    exportDeliverBtn()?.click();

    expect(handlers.onExportDeliverEarly).toHaveBeenCalledTimes(1);
    expect(handlers.onExportCancel).not.toHaveBeenCalled();
  });

  it("Escape stays cancel-only while the second action is on offer", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
      deliverEarly: { label: "Save now (rough)" },
    });

    pressEscape();

    // An accidental Escape must not commit a deliberately coarser PNG.
    expect(handlers.onExportCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onExportDeliverEarly).not.toHaveBeenCalled();
  });

  it("opens with Cancel focused even when the second action is offered", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());

    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
      deliverEarly: { label: "Save now (rough)" },
    });

    expect(document.activeElement).toBe(exportCancelBtn());
  });

  it("Tab reaches the second action instead of pinning to Cancel", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
      deliverEarly: { label: "Save now (rough)" },
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));

    expect(document.activeElement).toBe(exportDeliverBtn());
  });

  it("Tab still pins to Cancel when no second action is offered", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));

    expect(document.activeElement).toBe(exportCancelBtn());
  });

  it("clicking the backdrop does not close the modal", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    exportBackdrop().click();

    expect(exportModal().classList.contains("hidden")).toBe(false);
    expect(handlers.onExportCancel).not.toHaveBeenCalled();
  });

  it("hideExportProgress hides it, clears textContent, and resets --progress to 0%", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });
    ui.setExportProgress({ pct: 77, note: "1s" });

    ui.hideExportProgress();

    expect(exportModal().classList.contains("hidden")).toBe(true);
    expect(exportProgress().textContent).toBe("");
    expect(exportProgress().style.getPropertyValue("--progress")).toBe("0%");
  });

  it("does not fire onExportCancel on Escape after hide, and does not throw before the modal was ever opened", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);

    expect(() => pressEscape()).not.toThrow();

    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });
    ui.hideExportProgress();
    pressEscape();

    expect(handlers.onExportCancel).not.toHaveBeenCalled();
  });

  it("rebinds Escape on a reopen after a close", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });
    ui.hideExportProgress();

    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });
    pressEscape();

    expect(handlers.onExportCancel).toHaveBeenCalledTimes(1);
  });

  it("showExportProgress resets a stale readout from a previous run to 0%", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });
    ui.setExportProgress({ pct: 91, note: "almost done" });

    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    expect(exportProgress().textContent).toBe("0%");
    expect(exportProgress().style.getPropertyValue("--progress")).toBe("0%");
  });

  it("setSavePngBusy(true) disables Save PNG with a title; false restores it", () => {
    const ui = new Ui(document);
    const originalTitle = savePngBtn().title;

    ui.setSavePngBusy(true);
    expect(savePngBtn().disabled).toBe(true);
    expect(savePngBtn().title).not.toBe(originalTitle);
    expect(savePngBtn().title.length).toBeGreaterThan(0);

    ui.setSavePngBusy(false);
    expect(savePngBtn().disabled).toBe(false);
    expect(savePngBtn().title).toBe(originalTitle);
  });
});

// All four dialogs declare role="dialog" aria-modal="true", which tells
// assistive technology the page behind the scrim is inert. These pin the other
// half of that promise: focus goes in on open, Tab stays inside, and the opener
// gets it back on close, whichever way the dialog was dismissed.
describe("Ui modal focus trap", () => {
  const saved = (id: string) => ({
    id,
    encoded: `v1=${id}`,
    thumbnail: "data:image/jpeg;base64,x",
    createdAt: 1_700_000_000_000,
  });

  function el(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) throw new Error(`No #${id} in index.html`);
    return found;
  }

  function pressTab(shiftKey = false): void {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey }),
    );
  }

  function pressEscape(): void {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  }

  /** The gallery cards' own buttons in DOM order (load, ✕, load, ✕, …) — the
   * tail of the dialog's Tab ring, and the part that only exists after a
   * render. */
  function cardButtons(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        "#galleryGrid .gallery-card-load, #galleryGrid .gallery-card-delete",
      ),
    );
  }

  it("moves focus into the gallery dialog instead of leaving it on the opener", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    el("galleryBtn").focus();

    ui.openGallery([saved("a"), saved("b")]);

    expect(el("galleryModal").contains(document.activeElement)).toBe(true);
    // The ✕, not the dialog's first Tab stop: Enter on a dialog that just
    // appeared under the user's hands must not launch the drift show sitting
    // beside it — the export modal's Cancel-first rule, one dialog over.
    expect(document.activeElement).toBe(el("galleryCloseBtn"));
  });

  it("Tab on the gallery ring's last member wraps around to its first", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openGallery([saved("a"), saved("b")]);
    const buttons = cardButtons();
    buttons[buttons.length - 1].focus();

    pressTab();

    // ▶ Drift collection leads the dialog's DOM order; the cards trail it.
    expect(document.activeElement).toBe(el("galleryDriftBtn"));
  });

  it("Shift+Tab on the gallery ring's first member wraps around to its last", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openGallery([saved("a"), saved("b")]);
    el("galleryDriftBtn").focus();

    pressTab(true);

    const buttons = cardButtons();
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it("takes cards rendered after the open into the ring — it is read at keydown, not at trap time", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openGallery([]);
    // An empty collection is one Tab stop: the ✕, with drift disabled.
    pressTab();
    expect(document.activeElement).toBe(el("galleryCloseBtn"));

    ui.renderGallery([saved("fresh")]);
    pressTab();

    expect(document.activeElement).toBe(cardButtons()[0]);
  });

  it("Escape hands focus back to the button that opened the gallery", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const opener = el("galleryBtn");
    opener.focus();
    ui.openGallery([saved("a")]);

    pressEscape();

    expect(document.activeElement).toBe(opener);
  });

  it("the gallery's ✕ hands focus back to the button that opened it", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const opener = el("galleryBtn");
    opener.focus();
    ui.openGallery([saved("a")]);

    el("galleryCloseBtn").click();

    expect(document.activeElement).toBe(opener);
  });

  it("moves focus into the About dialog on open", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    el("aboutBtn").focus();

    ui.openAbout();

    expect(el("aboutModal").contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(el("aboutCloseBtn"));
  });

  it("Shift+Tab from the About dialog's ✕ wraps to the last of its links", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openAbout();

    pressTab(true);

    const links = document.querySelectorAll("#aboutModal .about-links a");
    expect(document.activeElement).toBe(links[links.length - 1]);
  });

  it("the About backdrop hands focus back to the control that opened it", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const opener = el("aboutBtn");
    opener.focus();
    ui.openAbout();

    el("aboutBackdrop").click();

    expect(document.activeElement).toBe(opener);
  });

  it("moves focus into the mutation dialog on open", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    el("mutateBtn").focus();

    ui.openMutations();

    expect(el("mutationModal").contains(document.activeElement)).toBe(true);
    // Not "↻ Mutate again", which leads the DOM: an accidental Enter would
    // re-roll the eight candidates the user opened the grid to look at.
    expect(document.activeElement).toBe(el("mutationCloseBtn"));
  });

  it("Escape hands focus back to the button that opened the mutation grid", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const opener = el("mutateBtn");
    opener.focus();
    ui.openMutations();

    pressEscape();

    expect(document.activeElement).toBe(opener);
  });

  it("takes a mutation cell into the ring once its thumbnail enables it", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openMutations();
    // Placeholders are disabled, so the ring is ↻ Mutate again + ✕ only.
    pressTab();
    expect(document.activeElement).toBe(el("mutationAgainBtn"));

    ui.setMutationCell(0, new Uint8ClampedArray(4 * 4 * 4), 4, false);
    el("mutationCloseBtn").focus();
    pressTab();

    const cells = document.querySelectorAll("#mutationGrid .mutation-cell");
    expect(document.activeElement).toBe(cells[0]);
  });

  it("never lands on or tabs to a control the dialog has hidden", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    // An uncancellable run hides Cancel in place (it is the one button the
    // dialog always has a place for) and offers the early-save action instead,
    // so the ring is that action alone — the shared visibility filter standing
    // in for the export modal's own cancellable flag.
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: false,
      deliverEarly: { label: "Save now (rough)" },
    });

    expect(document.activeElement).toBe(el("exportDeliverBtn"));

    pressTab();
    expect(document.activeElement).toBe(el("exportDeliverBtn"));
    pressTab(true);
    expect(document.activeElement).toBe(el("exportDeliverBtn"));
  });

  it("hideExportProgress hands focus back to the button that started the export", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const opener = el("savePngBtn");
    opener.focus();
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    ui.hideExportProgress();

    expect(document.activeElement).toBe(opener);
  });

  it("keeps the original opener when a run re-shows the export modal over itself", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const opener = el("savePngBtn");
    opener.focus();
    // The Export-size restart path: show, then show again without a hide, so
    // the live activeElement is the modal's own Cancel button.
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    ui.hideExportProgress();

    expect(document.activeElement).toBe(opener);
  });

  it("gives each stacked dialog its own opener back", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    el("galleryBtn").focus();
    ui.openGallery([saved("a")]);
    el("savePngBtn").focus();
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    ui.hideExportProgress();
    expect(document.activeElement).toBe(el("savePngBtn"));

    ui.closeGallery();
    expect(document.activeElement).toBe(el("galleryBtn"));
  });

  it("forfeits the restore rather than throwing when the opener has left the document", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    const opener = el("galleryBtn");
    opener.focus();
    ui.openGallery([saved("a")]);
    opener.remove();

    expect(() => ui.closeGallery()).not.toThrow();
  });

  // The export modal can stack over a sibling (a Save PNG's 400ms grace
  // window leaves the gallery opener live), and both keydown handlers hear
  // every document keydown. Escape used to close the gallery AND silently
  // abort the multi-minute export; Tab ran both focus cycles.
  it("Escape under a stacked export modal closes only the gallery — the export keeps running", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.openGallery([saved("a")]);
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    pressEscape();

    expect(el("galleryModal").classList.contains("hidden")).toBe(true);
    expect(el("exportModal").classList.contains("hidden")).toBe(false);
    expect(handlers.onExportCancel).not.toHaveBeenCalled();

    // Detach this Ui's document keydown listener: `document` outlives the
    // per-test body reset, and a listener left behind with its export modal
    // open would consume a later test's Escape.
    ui.hideExportProgress();
  });

  it("Tab while stacked cycles only the topmost (export) ring", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openGallery([saved("a"), saved("b")]);
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });
    expect(document.activeElement).toBe(el("exportCancelBtn"));

    // The export ring is its lone Cancel — a cycle stays put. Without the
    // topmost guard the gallery's handler would also step ITS ring and drag
    // focus onto a card behind the export scrim.
    pressTab();
    expect(document.activeElement).toBe(el("exportCancelBtn"));
    pressTab(true);
    expect(document.activeElement).toBe(el("exportCancelBtn"));

    ui.hideExportProgress();
    ui.closeGallery();
  });

  it("closing the gallery under the export modal leaves focus trapped in the export dialog", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    el("galleryBtn").focus();
    ui.openGallery([saved("a")]);
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    pressEscape();

    expect(el("exportModal").contains(document.activeElement)).toBe(true);

    ui.hideExportProgress();
  });

  it("the export modal inherits the closed gallery's opener, so the unwind lands somewhere visible", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    el("galleryBtn").focus();
    ui.openGallery([saved("a")]);
    // The export modal's recorded opener is the gallery's ✕ — an element
    // whose dialog is about to close under it.
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });
    pressEscape();

    ui.hideExportProgress();

    expect(document.activeElement).toBe(el("galleryBtn"));
  });

  // The points-arm export run (cancellable:false, no second action) is the
  // one modal that ships with an EMPTY focus ring — Cancel hidden, the
  // early-save button detached — so the trap falls back to the dialog box
  // itself (tabindex="-1").
  function exportDialog(): HTMLElement {
    const dialog = el("exportModal").querySelector(".gallery-dialog");
    if (!(dialog instanceof HTMLElement)) {
      throw new Error("No .gallery-dialog under #exportModal");
    }
    return dialog;
  }

  it("focuses the dialog box itself when the export ring is empty", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    el("savePngBtn").focus();

    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: false,
    });

    expect(document.activeElement).toBe(exportDialog());

    ui.hideExportProgress();
  });

  it("Tab stays parked on the dialog while the export ring is empty", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: false,
    });

    pressTab();
    expect(document.activeElement).toBe(exportDialog());
    pressTab(true);
    expect(document.activeElement).toBe(exportDialog());

    ui.hideExportProgress();
  });

  it("closing the gallery under a points-arm export keeps focus inside the export dialog", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    el("galleryBtn").focus();
    ui.openGallery([saved("a")]);
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: false,
    });
    expect(document.activeElement).toBe(exportDialog());

    pressEscape();

    expect(el("galleryModal").classList.contains("hidden")).toBe(true);
    // Base behavior dropped focus to body here for the seconds of encode;
    // the dialog target keeps the keyboard user inside the top dialog.
    expect(el("exportModal").contains(document.activeElement)).toBe(true);

    ui.hideExportProgress();
  });

  // The four pairwise Escape/Tab handlers collapsed into one stack-driven
  // listener. The two tests above only ever stack the gallery under the
  // export modal — this pins that the rule genuinely generalizes, rather
  // than the gallery having been special-cased, by repeating it for a
  // different sibling.
  it("Escape under a stacked export modal closes only the About dialog — the export keeps running", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.openAbout();
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });

    pressEscape();

    expect(el("aboutModal").classList.contains("hidden")).toBe(true);
    expect(el("exportModal").classList.contains("hidden")).toBe(false);
    expect(handlers.onExportCancel).not.toHaveBeenCalled();

    ui.hideExportProgress();
  });

  // The stack's own new property: releasing the topmost entry must hand
  // Tab back to whatever is left, not leave it wired to the popped entry
  // and not silently drop the shared listener while a sibling is still
  // open.
  it("releasing the export modal hands Tab back to the sibling still on the stack", () => {
    const ui = new Ui(document);
    ui.bind(noopHandlers());
    ui.openGallery([saved("a"), saved("b")]);
    ui.showExportProgress({
      title: "Saving PNG",
      detail: "",
      cancellable: true,
    });
    expect(document.activeElement).toBe(el("exportCancelBtn"));

    ui.hideExportProgress();
    pressTab();

    expect(document.activeElement).toBe(cardButtons()[0]);

    ui.closeGallery();
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

describe("background select menu", () => {
  // Guards against the <option> list and BACKGROUND_MODES drifting apart —
  // the same discipline as the surface color source menu above.
  // background.ts documents this array as the single source of truth for
  // the select's options, built-ins before the authored Custom slot, so the
  // pin is order-sensitive rather than a sorted set-equality check.
  it("offers exactly the registered background modes, in order", () => {
    const values = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#background option"),
    ).map((o) => o.value);
    expect(values).toEqual([...BACKGROUND_MODES]);
  });
});

describe("background shape select menu", () => {
  // Same discipline as the background mode menu above, pinned against
  // BACKGROUND_SHAPES (fractal/background-shape.ts) rather than
  // BACKGROUND_MODES — the shape is a separate, orthogonal vocabulary.
  it("offers exactly the registered background shapes, in order", () => {
    const values = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#backgroundShape option"),
    ).map((o) => o.value);
    expect(values).toEqual([...BACKGROUND_SHAPES]);
  });
});

describe("Ui background backdrop row", () => {
  function backgroundCustomRow(): HTMLElement {
    return document.getElementById("backgroundCustomRow") as HTMLElement;
  }
  function el(id: string): HTMLInputElement {
    return document.getElementById(id) as HTMLInputElement;
  }

  it("is hidden for a default (dark) background", () => {
    const ui = new Ui(document);
    ui.updateLabels(initialState(true));
    expect(backgroundCustomRow().classList.contains("hidden")).toBe(true);
  });

  it('stays hidden once the background mode is "auto"', () => {
    const ui = new Ui(document);
    ui.updateLabels(setBackgroundMode(initialState(true), "auto"));
    expect(backgroundCustomRow().classList.contains("hidden")).toBe(true);
  });

  it('is shown once the background mode is "custom"', () => {
    const ui = new Ui(document);
    ui.updateLabels(setBackgroundMode(initialState(true), "custom"));
    expect(backgroundCustomRow().classList.contains("hidden")).toBe(false);
  });

  it("reflects a custom background's stops into the pickers", () => {
    const ui = new Ui(document);
    ui.updateLabels({
      ...initialState(true),
      background: {
        mode: "custom",
        custom: { top: [0.2, 0.4, 0.6], bottom: [1, 0.5, 0] },
      },
    });

    expect(el("backgroundTop").value).toBe("#336699");
    expect(el("backgroundBottom").value).toBe("#ff8000");
  });

  it("reports a picker edit as the full parsed top/bottom pair", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.updateLabels({
      ...initialState(true),
      background: {
        mode: "custom",
        custom: { top: [0, 0, 0], bottom: [1, 1, 1] },
      },
    });

    const top = el("backgroundTop");
    top.value = "#336699";
    // The listener is delegated on the row, so the event must bubble — the
    // positionColorsRow discipline, one row over.
    top.dispatchEvent(new Event("input", { bubbles: true }));

    expect(handlers.onBackgroundCustom).toHaveBeenCalledWith({
      top: [0x33 / 255, 0x66 / 255, 0x99 / 255],
      bottom: [1, 1, 1],
    });
  });
});

describe("Ui fog tint row", () => {
  function el(id: string): HTMLInputElement {
    return document.getElementById(id) as HTMLInputElement;
  }

  it("defaults the color picker to white", () => {
    const ui = new Ui(document);
    ui.updateLabels(initialState(true));
    expect(el("fogTintColor").value).toBe("#ffffff");
  });

  it("reflects a non-default fogTint into the picker (gallery loads/undo move the swatch)", () => {
    const ui = new Ui(document);
    ui.updateLabels({ ...initialState(true), fogTint: "#336699" });
    expect(el("fogTintColor").value).toBe("#336699");
  });

  it("reports a picker edit as the raw hex value", () => {
    const handlers = noopHandlers();
    const ui = new Ui(document);
    ui.bind(handlers);
    ui.updateLabels(initialState(true));

    const input = el("fogTintColor");
    input.value = "#336699";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(handlers.onFogTint).toHaveBeenCalledWith("#336699");
  });

  it("never hides the row (unlike the gated backdrop custom row)", () => {
    const ui = new Ui(document);
    ui.updateLabels(initialState(true));
    expect(
      document.getElementById("fogTintRow")?.classList.contains("hidden"),
    ).toBe(false);
  });

  // The wrapping <label>s carry no text (the row's "Tint 0%" title is a
  // sibling span outside both), so without these the inputs are unnamed
  // color/slider controls to a screen reader.
  it("names both inputs for assistive tech (their labels carry no text)", () => {
    new Ui(document);
    expect(el("fogTintColor").getAttribute("aria-label")).toBe(
      "Fog tint color",
    );
    expect(el("fogTintStrength").getAttribute("aria-label")).toBe(
      "Fog tint strength",
    );
  });
});

describe("canvas viewport accessible name", () => {
  // The identity lives on the CANVAS — scene.ts injects it with tabIndex 0
  // and an instructive aria-label that teaches the camera keys (verified
  // in a real browser; scene.ts is outside jsdom's reach). What this suite
  // CAN pin is the container side of that contract: the earlier role="img"
  // wrapper must stay GONE, because role="img" prunes its subtree from the
  // accessibility tree — re-adding it would leave the focusable canvas
  // taking keyboard focus with no announced name at all.
  it("leaves #container role-less so the focusable canvas inside it keeps its own name", () => {
    const container = document.getElementById("container");
    expect(container?.getAttribute("role")).toBeNull();
    expect(container?.getAttribute("aria-label")).toBeNull();
  });
});

describe("page landmark structure", () => {
  it("wraps the viewport in a <main> landmark, ids untouched", () => {
    const container = document.getElementById("container");
    expect(container?.parentElement?.tagName).toBe("MAIN");
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });

  it("exposes the panel as a named region landmark, id untouched", () => {
    const panel = document.getElementById("panel");
    expect(panel?.getAttribute("role")).toBe("region");
    expect(panel?.getAttribute("aria-label")).toBe("Controls");
  });
});

describe("page-level heading", () => {
  it("ships exactly one h1, ahead of every h2", () => {
    const headings = Array.from(document.querySelectorAll("h1, h2"));
    const h1s = headings.filter((h) => h.tagName === "H1");
    expect(h1s).toHaveLength(1);
    expect(headings[0]).toBe(h1s[0]);
    expect(h1s[0].textContent).toBe("4D Fractal Explorer");
    // Visually hidden, not display-hidden: it must stay in the
    // accessibility tree (`.hidden` would take it out of both).
    expect(h1s[0].classList.contains("visually-hidden")).toBe(true);
    expect(h1s[0].classList.contains("hidden")).toBe(false);
  });
});

describe("mid-session status notes are live regions", () => {
  // These five populate/change mid-session via targeted setters (software-
  // renderer detection, CPU fallback on a flame restart, memory clamps, the
  // surface degraded note) — a few times per session, never per frame. The
  // slider-coupled #symmetryNote is deliberately absent: it rewrites on
  // every drag tick, which a live region would announce as chatter.
  const NOTE_IDS = [
    "softwareRendererNote",
    "flameBackendNote",
    "surfaceNote",
    "flameSupersampleNote",
    "solidResolutionNote",
  ];

  it.each(NOTE_IDS)("announces #%s to assistive tech when it changes", (id) => {
    const note = document.getElementById(id);
    expect(note?.getAttribute("role")).toBe("status");
    expect(note?.getAttribute("aria-live")).toBe("polite");
  });

  // A live region ENTERING the accessibility tree already populated
  // announces unreliably, so the five ship rendered — populated then
  // un-hidden is exactly the path this rules out.
  it.each(NOTE_IDS)("ships #%s rendered, not display-hidden", (id) => {
    expect(document.getElementById(id)?.classList.contains("hidden")).toBe(
      false,
    );
  });

  // The full show→clear cycle for every note, the surface one included
  // (its setter is setSurfaceEligibility, which has no describe of its
  // own): text is the ONLY thing that changes — the element never leaves
  // the accessibility tree at either end of the cycle.
  it.each([
    [
      "softwareRendererNote",
      (ui: Ui) => ui.setSoftwareRendererNote("Software rendering."),
      (ui: Ui) => ui.setSoftwareRendererNote(null),
    ],
    [
      "flameBackendNote",
      (ui: Ui) => ui.setFlameBackendNote("cpu", undefined, "GPU failed"),
      (ui: Ui) => ui.setFlameBackendNote(null),
    ],
    [
      "surfaceNote",
      (ui: Ui) =>
        ui.setSurfaceEligibility("degraded", "marched conservatively"),
      (ui: Ui) => ui.setSurfaceEligibility("eligible", null),
    ],
    [
      "flameSupersampleNote",
      (ui: Ui) => ui.setFlameSupersampleNote(1, 3),
      (ui: Ui) => ui.setFlameSupersampleNote(null),
    ],
    [
      "solidResolutionNote",
      (ui: Ui) => ui.setSolidResolutionNote(128, 192),
      (ui: Ui) => ui.setSolidResolutionNote(null),
    ],
  ] as const)(
    "toggles #%s by text alone through a show→clear cycle",
    (id, show, clear) => {
      const ui = new Ui(document);
      ui.bind(noopHandlers());
      const note = document.getElementById(id);

      show(ui);
      expect(note?.textContent).not.toBe("");
      expect(note?.classList.contains("hidden")).toBe(false);

      clear(ui);
      expect(note?.textContent).toBe("");
      expect(note?.classList.contains("hidden")).toBe(false);
    },
  );
});

// The render-progress announcer. Its closest relative is the "mid-session
// status notes are live regions" block above — same
// role="status"/aria-live="polite" idiom, same rendered-not-hidden shape —
// but this element's TEXT is authored for speech rather than mirrored from a
// prose note, and it is throttled to coarse quartile boundaries
// (25/50/75/100) rather than announcing every setter call, so its behavior
// gets its own block instead of joining that one's it.each table.
describe("Ui render-progress announcer", () => {
  function announcer(): HTMLElement | null {
    return document.getElementById("renderProgressAnnouncer");
  }

  it("ships as a live region, rendered and empty from the start", () => {
    new Ui(document);
    expect(announcer()?.getAttribute("role")).toBe("status");
    expect(announcer()?.getAttribute("aria-live")).toBe("polite");
    expect(announcer()?.classList.contains("visually-hidden")).toBe(true);
    expect(announcer()?.textContent).toBe("");
  });

  // Requirement (1) of the decided design: the bare "42%" readouts must NOT
  // become live themselves — only this separate hidden element speaks.
  it.each(["flameProgress", "solidProgress", "surfaceProgress"])(
    "leaves the visible #%s readout with no live region of its own",
    (id) => {
      new Ui(document);
      const el = document.getElementById(id);
      expect(el?.hasAttribute("aria-live")).toBe(false);
      expect(el?.hasAttribute("role")).toBe(false);
    },
  );

  it("a flame march through 0..100 announces exactly four times, in order", () => {
    const ui = new Ui(document);
    const announcements: string[] = [];
    let last = announcer()?.textContent ?? "";
    for (let done = 0; done <= 100; done++) {
      ui.setFlameProgress(done, 100);
      const text = announcer()?.textContent ?? "";
      if (text !== last) announcements.push(text);
      last = text;
    }
    expect(announcements).toEqual([
      "Flame render, 25 percent",
      "Flame render, 50 percent",
      "Flame render, 75 percent",
      "Flame render, 100 percent",
    ]);
  });

  it("rapid small increments inside one quartile announce nothing new", () => {
    const ui = new Ui(document);
    ui.setFlameProgress(50, 100);
    expect(announcer()?.textContent).toBe("Flame render, 50 percent");
    for (const done of [51, 55, 60, 65, 70, 74]) {
      ui.setFlameProgress(done, 100);
    }
    expect(announcer()?.textContent).toBe("Flame render, 50 percent");
  });

  it("a jump that skips a boundary announces only the highest quartile newly crossed", () => {
    const ui = new Ui(document);
    ui.setFlameProgress(20, 100); // still under 25%: nothing yet
    expect(announcer()?.textContent).toBe("");
    ui.setFlameProgress(60, 100); // crosses 25 AND 50 in one call
    expect(announcer()?.textContent).toBe("Flame render, 50 percent");
  });

  it("a restart (iterationsDone back to 0) re-arms the quartile for the next render", () => {
    const ui = new Ui(document);
    ui.setFlameProgress(100, 100);
    expect(announcer()?.textContent).toBe("Flame render, 100 percent");
    ui.setFlameProgress(0, 100); // the worker's "restarted" event, or a fresh session
    expect(announcer()?.textContent).toBe("");
    ui.setFlameProgress(25, 100);
    expect(announcer()?.textContent).toBe("Flame render, 25 percent");
  });

  it("Solid announces at the same coarse boundaries, with its own wording and reset", () => {
    const ui = new Ui(document);
    ui.setSolidProgress(24_000_000, 100_000_000);
    expect(announcer()?.textContent).toBe("");
    ui.setSolidProgress(25_000_000, 100_000_000);
    expect(announcer()?.textContent).toBe("Solid render, 25 percent");
    ui.setSolidProgress(75_000_000, 100_000_000); // skips 50: only the highest crossed
    expect(announcer()?.textContent).toBe("Solid render, 75 percent");
    ui.setSolidProgress(0, 100_000_000); // restart re-arms, like flame's
    expect(announcer()?.textContent).toBe("");
    ui.setSolidProgress(50_000_000, 100_000_000);
    expect(announcer()?.textContent).toBe("Solid render, 50 percent");
  });

  it("Surface announces at the same coarse boundaries, with its own wording", () => {
    const ui = new Ui(document);
    ui.setSurfaceProgress({ label: "Full detail · WebGL", pct: 12 });
    expect(announcer()?.textContent).toBe("Surface render, using WebGL");
    ui.setSurfaceProgress({ label: "Full detail · WebGL", pct: 30 });
    expect(announcer()?.textContent).toBe("Surface render, 25 percent");
  });

  it("a hidden row (null) re-arms Surface's quartile WITHOUT wiping the last utterance — the settle's own completion must survive the null that follows it a frame later", () => {
    const ui = new Ui(document);
    ui.setSurfaceProgress({ label: "Full detail · WebGL", pct: 100 });
    expect(announcer()?.textContent).toContain("Surface render, 100 percent");
    ui.setSurfaceProgress(null); // arrives ~one rAF after completion (wave-5 review)
    // NOT cleared: a clear here raced screen readers' polite queue and
    // dropped the one boundary that says the picture is done.
    expect(announcer()?.textContent).toContain("Surface render, 100 percent");
    // ...but the ladder re-armed: the next settle's own crossings speak.
    ui.setSurfaceProgress({ label: "Full detail · WebGL", pct: 30 });
    expect(announcer()?.textContent).toContain("Surface render, 25 percent");
  });

  it("preview jobs never announce quartiles — auto-motion recycles previews forever, and each would otherwise cross the whole ladder (wave-5 review)", () => {
    const ui = new Ui(document);
    ui.setSurfaceProgress({ label: "Preview · WebGPU", pct: 5 }); // spends the engine one-shot
    ui.setSurfaceProgress({ label: "Preview · WebGPU", pct: 60 });
    ui.setSurfaceProgress({ label: "Preview · WebGPU", pct: 100 });
    expect(announcer()?.textContent).toBe("Surface render, using WebGPU");
  });

  // The two surface-only one-shots: the engine token and the
  // antialiasing phase, both embedded in setSurfaceProgress's
  // label/detail rather than broken out as their own fields — see
  // surfaceProgressEngine and the "antialiasing pass" substring check.
  describe("surface engine/antialiasing one-shots", () => {
    it("announces the engine once, not on every later progress update", () => {
      const ui = new Ui(document);
      ui.setSurfaceProgress({ label: "Preview · WebGPU", pct: 5 });
      expect(announcer()?.textContent).toBe("Surface render, using WebGPU");
      ui.setSurfaceProgress({ label: "Preview · WebGPU", pct: 6 });
      ui.setSurfaceProgress({ label: "Full detail · WebGPU", pct: 8 });
      expect(announcer()?.textContent).toBe("Surface render, using WebGPU");
    });

    it("re-announces only when the engine actually changes", () => {
      const ui = new Ui(document);
      ui.setSurfaceProgress({ label: "Preview · WebGPU", pct: 5 });
      // e.g. a mid-session compute -> WebGL fallback (device loss, create() failure).
      ui.setSurfaceProgress({ label: "Full detail · WebGL", pct: 8 });
      expect(announcer()?.textContent).toBe("Surface render, using WebGL");
    });

    it("does not repeat the engine across separate jobs in the same session", () => {
      const ui = new Ui(document);
      ui.setSurfaceProgress({ label: "Preview · WebGPU", pct: 15 });
      ui.setSurfaceProgress(null); // job settles/hides (text persists, wave-5 review)
      ui.setSurfaceProgress({ label: "Preview · WebGPU", pct: 10 }); // a fresh job, same engine
      // The engine utterance from the FIRST job still stands — the fresh
      // job added nothing new, which is the point: no repeat.
      expect(announcer()?.textContent).toBe("Surface render, using WebGPU");
    });

    it("announces the antialiasing phase once when it first appears, not once per pass", () => {
      const ui = new Ui(document);
      ui.setSurfaceProgress({ label: "Full detail · WebGPU", pct: 5 }); // spends the engine one-shot
      ui.setSurfaceProgress(null); // re-arms quartile + antialiasing (text persists)
      ui.setSurfaceProgress({ label: "Full detail · WebGPU", pct: 20 }); // pass 1 is silent
      expect(announcer()?.textContent).toBe("Surface render, using WebGPU"); // the standing utterance; nothing new spoken
      ui.setSurfaceProgress({
        label: "Full detail · WebGPU",
        pct: 24,
        detail: "antialiasing pass 2/8",
      });
      expect(announcer()?.textContent).toBe(
        "Surface render, antialiasing passes underway",
      );
      ui.setSurfaceProgress({
        label: "Full detail · WebGPU",
        pct: 24.5,
        detail: "antialiasing pass 3/8",
      });
      // Still under the 25% quartile and already announced once: no repeat.
      expect(announcer()?.textContent).toBe(
        "Surface render, antialiasing passes underway",
      );
    });

    it("re-arms the antialiasing one-shot for a fresh settle after the row hides", () => {
      const ui = new Ui(document);
      ui.setSurfaceProgress({
        label: "Full detail · WebGPU",
        pct: 24,
        detail: "antialiasing pass 2/8",
      });
      expect(announcer()?.textContent).toContain(
        "antialiasing passes underway",
      );
      ui.setSurfaceProgress(null); // settle finishes, row hides
      ui.setSurfaceProgress({
        label: "Full detail · WebGPU",
        pct: 24,
        detail: "antialiasing pass 2/8",
      }); // a new settle after a further camera move, same shape
      expect(announcer()?.textContent).toBe(
        "Surface render, antialiasing passes underway",
      );
    });

    it("combines an engine one-shot and a quartile crossing from one call into one utterance", () => {
      const ui = new Ui(document);
      ui.setSurfaceProgress({ label: "Full detail · WebGPU", pct: 30 });
      expect(announcer()?.textContent).toBe(
        "Surface render, using WebGPU. Surface render, 25 percent",
      );
    });
  });
});

// Native `disabled` pulls a button out of the tab ring, so the existing
// title-only disabled reason (hover-only) is invisible to a keyboard/AT
// user. driftBtn, exportCollectionBtn and the timelinePlayBtn/
// timelineExportBtn pair each grow a role="status"/aria-live="polite" note
// beside them — the "mid-session status notes are live regions" idiom above
// — mirroring the same reason in prose. Unlike that block's five notes,
// these three setters (setDriftAvailable, setCollectionCount,
// syncTimelineButtons via renderTimeline/setTimelineActive/
// setTimelineAvailable/setTimelineExportProgress) re-run on every panel
// refresh/timeline edit/collection change rather than only at a meaningful
// transition, so each also gets a no-chatter pin: repeating the same
// disabled state must not rewrite (and therefore not re-announce) the note.
describe("disabled-reason notes for keyboard/AT users", () => {
  it.each(["driftNote", "exportCollectionNote", "timelineNote"])(
    "ships #%s as a role=status/aria-live=polite region, rendered and empty",
    (id) => {
      const note = document.getElementById(id);
      expect(note?.getAttribute("role")).toBe("status");
      expect(note?.getAttribute("aria-live")).toBe("polite");
      expect(note?.classList.contains("hidden")).toBe(false);
      expect(note?.textContent).toBe("");
    },
  );

  describe("driftBtn / driftNote", () => {
    function btn(): HTMLButtonElement {
      return document.getElementById("driftBtn") as HTMLButtonElement;
    }
    function note(): HTMLElement {
      return document.getElementById("driftNote") as HTMLElement;
    }

    it("writes the reduced-motion reason into the note when disabled, alongside the existing title swap", () => {
      const ui = new Ui(document);
      ui.setDriftAvailable(false);
      expect(note().textContent).toBe(
        "Unavailable: your system asks for reduced motion.",
      );
      expect(btn().title).toBe(
        "Unavailable: your system asks for reduced motion",
      );
    });

    it("clears the note when re-enabled, restoring the authored title", () => {
      const ui = new Ui(document);
      const authoredTitle = btn().title;
      ui.setDriftAvailable(false);
      ui.setDriftAvailable(true);
      expect(note().textContent).toBe("");
      expect(btn().disabled).toBe(false);
      expect(btn().title).toBe(authoredTitle);
    });

    it("does not rewrite the note when the disabled state repeats (no chatter)", () => {
      const ui = new Ui(document);
      ui.setDriftAvailable(false);
      let mutations = 0;
      const observer = new MutationObserver((records) => {
        mutations += records.length;
      });
      observer.observe(note(), {
        childList: true,
        characterData: true,
        subtree: true,
      });

      ui.setDriftAvailable(false); // e.g. a later syncMotionAvailability with no real change

      observer.disconnect();
      expect(mutations).toBe(0);
      expect(note().textContent).toBe(
        "Unavailable: your system asks for reduced motion.",
      );
    });
  });

  describe("exportCollectionBtn / exportCollectionNote", () => {
    function btn(): HTMLButtonElement {
      return document.getElementById(
        "exportCollectionBtn",
      ) as HTMLButtonElement;
    }
    function note(): HTMLElement {
      return document.getElementById("exportCollectionNote") as HTMLElement;
    }

    it("writes the empty-collection reason into the note at count zero, alongside the existing title swap", () => {
      const ui = new Ui(document);
      ui.setCollectionCount(0);
      expect(note().textContent).toBe(
        "Nothing saved yet — ★ Save to collection first.",
      );
      expect(btn().title).toBe(
        "Nothing saved yet — ★ Save to collection first",
      );
    });

    it("clears the note once a scene is saved, restoring the authored title", () => {
      const ui = new Ui(document);
      const authoredTitle = btn().title;
      ui.setCollectionCount(0);
      ui.setCollectionCount(1);
      expect(note().textContent).toBe("");
      expect(btn().disabled).toBe(false);
      expect(btn().title).toBe(authoredTitle);
    });

    it("does not rewrite the note when count zero repeats across refreshes (no chatter)", () => {
      const ui = new Ui(document);
      ui.setCollectionCount(0);
      let mutations = 0;
      const observer = new MutationObserver((records) => {
        mutations += records.length;
      });
      observer.observe(note(), {
        childList: true,
        characterData: true,
        subtree: true,
      });

      ui.setCollectionCount(0); // e.g. an unrelated refreshUi with the same count

      observer.disconnect();
      expect(mutations).toBe(0);
      expect(note().textContent).toBe(
        "Nothing saved yet — ★ Save to collection first.",
      );
    });
  });

  describe("timelinePlayBtn / timelineExportBtn shared timelineNote", () => {
    const step = (id: string) => ({
      id,
      encoded: `v1=${id}`,
      thumbnail: "",
      morphMs: 4000,
      holdMs: 2000,
    });

    function playBtn(): HTMLButtonElement {
      return document.getElementById("timelinePlayBtn") as HTMLButtonElement;
    }
    function exportBtn(): HTMLButtonElement {
      return document.getElementById("timelineExportBtn") as HTMLButtonElement;
    }
    function note(): HTMLElement {
      return document.getElementById("timelineNote") as HTMLElement;
    }

    it("writes the reduced-motion reason for both buttons, alongside their title swaps", () => {
      const ui = new Ui(document);
      ui.renderTimeline([step("a")], "0:06");
      ui.setTimelineAvailable(false);
      expect(note().textContent).toBe(
        "Unavailable: your system asks for reduced motion.",
      );
      expect(playBtn().title).toBe(
        "Unavailable: your system asks for reduced motion",
      );
      expect(exportBtn().title).toBe(
        "Unavailable: your system asks for reduced motion",
      );
    });

    it("writes the empty-timeline reason when there are no keyframes yet", () => {
      const ui = new Ui(document);
      ui.renderTimeline([], "0:00");
      expect(note().textContent).toBe("Add a keyframe or two first.");
    });

    it("names Export specifically once playback starts, since Play stays enabled as Stop", () => {
      const ui = new Ui(document);
      ui.renderTimeline([step("a")], "0:06");
      ui.setTimelineActive(true);
      expect(playBtn().disabled).toBe(false);
      expect(exportBtn().disabled).toBe(true);
      expect(note().textContent).toBe(
        "Export is unavailable while the timeline is playing — stop first.",
      );
    });

    it("clears the note once both buttons are usable again", () => {
      const ui = new Ui(document);
      ui.renderTimeline([], "0:00");
      ui.renderTimeline([step("a")], "0:06");
      expect(note().textContent).toBe("");
      expect(playBtn().disabled).toBe(false);
    });

    it("clears the note mid-export, when Export is force-enabled as the run's own cancel affordance", () => {
      const ui = new Ui(document);
      ui.renderTimeline([step("a")], "0:06");
      ui.setTimelineActive(true);
      expect(note().textContent).not.toBe("");

      ui.setTimelineExportProgress("10%");

      expect(exportBtn().disabled).toBe(false);
      expect(note().textContent).toBe("");
    });

    it("does not rewrite the note when an unrelated timeline edit repeats the same reason (no chatter)", () => {
      const ui = new Ui(document);
      ui.renderTimeline([], "0:00");
      let mutations = 0;
      const observer = new MutationObserver((records) => {
        mutations += records.length;
      });
      observer.observe(note(), {
        childList: true,
        characterData: true,
        subtree: true,
      });

      ui.renderTimeline([], "0:00"); // still empty — a redundant re-render

      observer.disconnect();
      expect(mutations).toBe(0);
      expect(note().textContent).toBe("Add a keyframe or two first.");
    });
  });
});
