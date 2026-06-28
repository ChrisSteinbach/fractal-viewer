import { transformColors } from "../fractal/color";
import type { ColorMode, Transform } from "../fractal/types";
import type { AppState, RenderStyle } from "./state";

export type Preset =
  | "sierpinski"
  | "menger"
  | "spiral"
  | "pyramid"
  | "octahedron"
  | "icosahedron"
  | "dodecahedron";

export interface UiHandlers {
  onAdd: () => void;
  onRemove: () => void;
  onPreset: (preset: Preset) => void;
  onNumPointsInput: (value: number) => void;
  onPointSizeInput: (value: number) => void;
  onRegenerate: () => void;
  onToggleGuides: (checked: boolean) => void;
  onColorMode: (mode: ColorMode) => void;
  onRenderStyle: (style: RenderStyle) => void;
  onToggleAutoUpdate: (checked: boolean) => void;
  onSelect: (index: number | null) => void;
  onTogglePanel: () => void;
  onClosePanel: () => void;
}

/** Below this viewport width the panel floats over a dimmed backdrop. */
const MOBILE_BREAKPOINT = 640;

interface TransformButtonOptions {
  selected: boolean;
  accent: string;
  title: string;
  lines: string[];
  onClick: () => void;
}

/**
 * Owns the control panel and the dynamic transform list. All DOM is built with
 * `createElement`/`textContent` (never `innerHTML`) so user-influenced strings
 * can never be interpreted as markup.
 */
export class Ui {
  private readonly doc: Document;
  private handlers: UiHandlers | null = null;

  private readonly helpTitle: HTMLElement;
  private readonly helpText: HTMLElement;
  private readonly pointCount: HTMLElement;
  private readonly menuToggle: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly panelClose: HTMLElement;
  private readonly transformCount: HTMLElement;
  private readonly transformList: HTMLElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly removeBtn: HTMLButtonElement;
  private readonly presetSelect: HTMLSelectElement;
  private readonly regenerateBtn: HTMLButtonElement;
  private readonly numPointsLabel: HTMLElement;
  private readonly numPointsSlider: HTMLInputElement;
  private readonly pointSizeLabel: HTMLElement;
  private readonly pointSizeSlider: HTMLInputElement;
  private readonly showGuides: HTMLInputElement;
  private readonly colorMode: HTMLSelectElement;
  private readonly renderStyle: HTMLSelectElement;
  private readonly autoUpdate: HTMLInputElement;

  constructor(doc: Document = document) {
    this.doc = doc;
    this.helpTitle = this.byId("helpTitle");
    this.helpText = this.byId("helpText");
    this.pointCount = this.byId("pointCount");
    this.menuToggle = this.byId("menuToggle");
    this.backdrop = this.byId("backdrop");
    this.panel = this.byId("panel");
    this.panelClose = this.byId("panelClose");
    this.transformCount = this.byId("transformCount");
    this.transformList = this.byId("transformList");
    this.addBtn = this.byId("addBtn");
    this.removeBtn = this.byId("removeBtn");
    this.presetSelect = this.byId("presetSelect");
    this.regenerateBtn = this.byId("regenerateBtn");
    this.numPointsLabel = this.byId("numPointsLabel");
    this.numPointsSlider = this.byId("numPointsSlider");
    this.pointSizeLabel = this.byId("pointSizeLabel");
    this.pointSizeSlider = this.byId("pointSizeSlider");
    this.showGuides = this.byId("showGuides");
    this.colorMode = this.byId("colorMode");
    this.renderStyle = this.byId("renderStyle");
    this.autoUpdate = this.byId("autoUpdate");
  }

  private byId<T extends HTMLElement>(id: string): T {
    const el = this.doc.getElementById(id);
    if (!el) throw new Error(`Missing required element #${id}`);
    return el as T;
  }

  bind(handlers: UiHandlers): void {
    this.handlers = handlers;
    this.menuToggle.addEventListener("click", () => handlers.onTogglePanel());
    this.panelClose.addEventListener("click", () => handlers.onClosePanel());
    this.backdrop.addEventListener("click", () => handlers.onClosePanel());
    this.addBtn.addEventListener("click", () => handlers.onAdd());
    this.removeBtn.addEventListener("click", () => handlers.onRemove());
    // The preset menu acts as a one-shot action list: fire the chosen preset,
    // then snap back to the placeholder so it never implies a persistent mode.
    this.presetSelect.addEventListener("change", () => {
      const preset = this.presetSelect.value;
      this.presetSelect.value = "";
      if (preset) handlers.onPreset(preset as Preset);
    });
    this.regenerateBtn.addEventListener("click", () => handlers.onRegenerate());
    this.numPointsSlider.addEventListener("input", () =>
      handlers.onNumPointsInput(Number(this.numPointsSlider.value)),
    );
    this.pointSizeSlider.addEventListener("input", () =>
      handlers.onPointSizeInput(Number(this.pointSizeSlider.value)),
    );
    this.showGuides.addEventListener("change", () =>
      handlers.onToggleGuides(this.showGuides.checked),
    );
    this.colorMode.addEventListener("change", () =>
      handlers.onColorMode(this.colorMode.value as ColorMode),
    );
    this.renderStyle.addEventListener("change", () =>
      handlers.onRenderStyle(this.renderStyle.value as RenderStyle),
    );
    this.autoUpdate.addEventListener("change", () =>
      handlers.onToggleAutoUpdate(this.autoUpdate.checked),
    );
  }

  /** Reflect scalar state into labels, inputs, the help box, and the panel. */
  updateLabels(state: AppState): void {
    this.transformCount.textContent = String(state.transforms.length);
    this.removeBtn.disabled = state.transforms.length <= 1;
    this.numPointsLabel.textContent = state.numPoints.toLocaleString();
    this.numPointsSlider.value = String(state.numPoints);
    this.pointSizeLabel.textContent = `${state.pointSize.toFixed(2)}×`;
    this.pointSizeSlider.value = String(state.pointSize);
    this.colorMode.value = state.colorMode;
    this.renderStyle.value = state.renderStyle;
    this.showGuides.checked = state.showGuides;
    this.autoUpdate.checked = state.autoUpdate;

    if (state.selectedTransform === null) {
      this.helpTitle.textContent = "Camera Mode";
      this.setHelpLines(["1 finger: Rotate", "2 fingers: Pan/Zoom"]);
    } else {
      this.helpTitle.textContent = `Transform ${state.selectedTransform + 1}`;
      this.setHelpLines(["1 finger: Move", "Pinch: Scale", "Twist: Rotate"]);
    }

    this.panel.classList.toggle("open", state.panelOpen);
    this.backdrop.classList.toggle(
      "visible",
      state.panelOpen && window.innerWidth <= MOBILE_BREAKPOINT,
    );
    this.menuToggle.textContent = state.panelOpen ? "✕" : "☰";
  }

  setPointCount(count: number): void {
    this.pointCount.textContent = `${count.toLocaleString()} pts`;
  }

  /** Rebuild the "select to edit" list: a camera row plus one row per transform. */
  renderTransformList(transforms: Transform[], selected: number | null): void {
    this.transformList.replaceChildren();
    this.transformList.appendChild(
      this.transformButton({
        selected: selected === null,
        accent: "#60a5fa",
        title: "🎥 Camera View",
        lines: ["Drag to orbit, pinch to zoom"],
        onClick: () => this.handlers?.onSelect(null),
      }),
    );

    const palette = transformColors(transforms.length);
    transforms.forEach((t, i) => {
      const [r, g, b] = palette[i];
      const accent = `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
      this.transformList.appendChild(
        this.transformButton({
          selected: selected === i,
          accent,
          title: `Transform ${i + 1}`,
          lines: [
            `Pos: [${t.position.map((v) => v.toFixed(2)).join(", ")}]`,
            `Scale: ${t.scale[0].toFixed(2)}`,
          ],
          onClick: () => this.handlers?.onSelect(i),
        }),
      );
    });
  }

  private transformButton(options: TransformButtonOptions): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.className = options.selected
      ? "transform-btn selected"
      : "transform-btn";
    button.style.borderLeftColor = options.accent;

    const name = this.doc.createElement("div");
    name.className = "name";
    name.textContent = options.title;
    button.appendChild(name);

    for (const line of options.lines) {
      const div = this.doc.createElement("div");
      div.textContent = line;
      button.appendChild(div);
    }

    button.addEventListener("click", options.onClick);
    return button;
  }

  private setHelpLines(lines: string[]): void {
    this.helpText.replaceChildren();
    for (const line of lines) {
      const div = this.doc.createElement("div");
      div.textContent = line;
      this.helpText.appendChild(div);
    }
  }
}

function to255(channel: number): number {
  return Math.round(channel * 255);
}
