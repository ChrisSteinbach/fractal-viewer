import { transformColors } from "../fractal/color";
import type { ColorMode, Transform, Vec3 } from "../fractal/types";
import { clone3, to255 } from "../fractal/vec";
import type { Preset } from "../fractal/presets";
import type { AppState, RenderStyle } from "./state";
import {
  MOBILE_BREAKPOINT,
  MIN_GUIDE_SCALE,
  MAX_GUIDE_SCALE,
} from "./constants";

export type { Preset };

/** The position/rotation/scale triple a transform editor edits. */
type Geometry = Pick<Transform, "position" | "rotation" | "scale">;

export interface UiHandlers {
  onAdd: () => void;
  onRemove: () => void;
  onPreset: (preset: Preset) => void;
  onNumPointsInput: (value: number) => void;
  onPointSizeInput: (value: number) => void;
  onRegenerate: () => void;
  onSavePng: () => void;
  onToggleGuides: (checked: boolean) => void;
  onColorMode: (mode: ColorMode) => void;
  onRenderStyle: (style: RenderStyle) => void;
  onToggleAutoUpdate: (checked: boolean) => void;
  onSelect: (index: number | null) => void;
  /** A panel slider edited the selected transform's geometry. */
  onTransformGeometry: (index: number, geometry: Geometry) => void;
  onTogglePanel: () => void;
  onClosePanel: () => void;
}

/**
 * Whether the primary input is a mouse, so the help box can show mouse verbs
 * ("Drag", "Scroll") instead of "1 finger / 2 fingers". Guarded for jsdom and
 * any environment without `matchMedia`, where it falls back to touch wording.
 */
function usesMouse(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches === true
  );
}

interface TransformButtonOptions {
  selected: boolean;
  accent: string;
  title: string;
  lines: string[];
  onClick: () => void;
}

/** Axis labels for the three rows in every editor group. */
const AXES = ["X", "Y", "Z"] as const;

/** Which geometry channel a group of editor sliders edits. */
type Channel = "position" | "rotation" | "scale";

/**
 * Per-channel slider config. The model is stored in {@link Transform} units
 * (radians for rotation), but the sliders and readouts work in friendlier
 * display units (degrees) — `toSlider`/`fromSlider` convert between them and
 * `format` renders the readout.
 */
interface ChannelSpec {
  title: string;
  min: number;
  max: number;
  step: number;
  toSlider: (model: number) => number;
  fromSlider: (slider: number) => number;
  format: (model: number) => string;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Fold an angle into (−180°, 180°] so drag-accumulated values still read sanely. */
function wrapDegrees(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

function displayDegrees(rad: number): number {
  return Math.round(wrapDegrees(radToDeg(rad)));
}

// Scale bounds share the guide-box clamp (MIN/MAX_GUIDE_SCALE) used in interactions.ts.
const CHANNELS: Record<Channel, ChannelSpec> = {
  position: {
    title: "Position",
    min: -3,
    max: 3,
    step: 0.01,
    toSlider: (v) => v,
    fromSlider: (v) => v,
    format: (v) => v.toFixed(2),
  },
  rotation: {
    title: "Rotation",
    min: -180,
    max: 180,
    step: 1,
    toSlider: displayDegrees,
    fromSlider: degToRad,
    format: (v) => `${displayDegrees(v)}°`,
  },
  scale: {
    title: "Scale",
    min: MIN_GUIDE_SCALE,
    max: MAX_GUIDE_SCALE,
    step: 0.01,
    toSlider: (v) => v,
    fromSlider: (v) => v,
    format: (v) => v.toFixed(2),
  },
};

const CHANNEL_ORDER: Channel[] = ["position", "rotation", "scale"];

interface AxisControl {
  slider: HTMLInputElement;
  readout: HTMLElement;
}

/** Live handles into a built editor so external edits can re-sync the sliders. */
interface EditorState {
  index: number;
  geometry: { position: Vec3; rotation: Vec3; scale: Vec3 };
  controls: Record<Channel, AxisControl[]>;
}

/**
 * Owns the control panel and the dynamic transform list. All DOM is built with
 * `createElement`/`textContent` (never `innerHTML`) so user-influenced strings
 * can never be interpreted as markup.
 */
export class Ui {
  private readonly doc: Document;
  private readonly mouse = usesMouse();
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
  private readonly savePngBtn: HTMLButtonElement;
  private readonly numPointsLabel: HTMLElement;
  private readonly numPointsSlider: HTMLInputElement;
  private readonly pointSizeLabel: HTMLElement;
  private readonly pointSizeSlider: HTMLInputElement;
  private readonly showGuides: HTMLInputElement;
  private readonly colorMode: HTMLSelectElement;
  private readonly renderStyle: HTMLSelectElement;
  private readonly autoUpdate: HTMLInputElement;
  private readonly transformEditor: HTMLElement;

  private editor: EditorState | null = null;

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
    this.savePngBtn = this.byId("savePngBtn");
    this.numPointsLabel = this.byId("numPointsLabel");
    this.numPointsSlider = this.byId("numPointsSlider");
    this.pointSizeLabel = this.byId("pointSizeLabel");
    this.pointSizeSlider = this.byId("pointSizeSlider");
    this.showGuides = this.byId("showGuides");
    this.colorMode = this.byId("colorMode");
    this.renderStyle = this.byId("renderStyle");
    this.autoUpdate = this.byId("autoUpdate");
    this.transformEditor = this.byId("transformEditor");
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
    this.savePngBtn.addEventListener("click", () => handlers.onSavePng());
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
      this.setHelpLines(
        this.mouse
          ? ["Drag: Orbit", "Right-drag: Pan", "Scroll: Zoom"]
          : ["1 finger: Rotate", "2 fingers: Pan/Zoom"],
      );
    } else {
      this.helpTitle.textContent = `Transform ${state.selectedTransform + 1}`;
      this.setHelpLines(
        this.mouse
          ? ["Drag: Move", "Right-drag: Rotate", "Scroll: Scale"]
          : ["1 finger: Move", "Pinch: Scale", "Twist: Rotate"],
      );
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
        lines: [
          this.mouse
            ? "Drag to orbit · scroll to zoom"
            : "Drag to orbit · pinch to zoom",
        ],
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

  /**
   * Show per-axis sliders for the selected transform, or clear them in camera
   * mode. Rebuilds when the selection changes; otherwise re-syncs the existing
   * sliders so drag edits and slider edits stay in step.
   */
  renderTransformEditor(
    transform: Transform | null,
    index: number | null,
  ): void {
    if (!transform || index === null) {
      this.transformEditor.replaceChildren();
      this.editor = null;
      return;
    }
    if (!this.editor || this.editor.index !== index) {
      this.buildEditor(transform, index);
    } else {
      this.syncEditor(transform);
    }
  }

  private buildEditor(transform: Transform, index: number): void {
    this.transformEditor.replaceChildren();

    const heading = this.doc.createElement("h3");
    heading.textContent = `Edit Transform ${index + 1}`;
    this.transformEditor.appendChild(heading);

    const geometry = {
      position: clone3(transform.position),
      rotation: clone3(transform.rotation),
      scale: clone3(transform.scale),
    };
    const controls: Record<Channel, AxisControl[]> = {
      position: [],
      rotation: [],
      scale: [],
    };

    for (const channel of CHANNEL_ORDER) {
      const spec = CHANNELS[channel];
      const group = this.doc.createElement("div");
      group.className = "editor-group";

      const title = this.doc.createElement("div");
      title.className = "editor-group-title";
      title.textContent = spec.title;
      group.appendChild(title);

      AXES.forEach((axisLabel, axis) => {
        const model = geometry[channel][axis];

        const row = this.doc.createElement("div");
        row.className = "editor-row";

        const name = this.doc.createElement("span");
        name.className = "axis";
        name.textContent = axisLabel;

        const slider = this.doc.createElement("input");
        slider.type = "range";
        slider.min = String(spec.min);
        slider.max = String(spec.max);
        slider.step = String(spec.step);
        slider.value = String(spec.toSlider(model));
        slider.setAttribute("aria-label", `${spec.title} ${axisLabel}`);

        const readout = this.doc.createElement("span");
        readout.className = "value";
        readout.textContent = spec.format(model);

        slider.addEventListener("input", () =>
          this.onAxisInput(channel, axis, Number(slider.value)),
        );

        row.append(name, slider, readout);
        group.appendChild(row);
        controls[channel].push({ slider, readout });
      });

      this.transformEditor.appendChild(group);
    }

    this.editor = { index, geometry, controls };
  }

  private syncEditor(transform: Transform): void {
    const editor = this.editor;
    if (!editor) return;
    editor.geometry = {
      position: clone3(transform.position),
      rotation: clone3(transform.rotation),
      scale: clone3(transform.scale),
    };
    for (const channel of CHANNEL_ORDER) {
      const spec = CHANNELS[channel];
      editor.controls[channel].forEach((control, axis) => {
        const model = editor.geometry[channel][axis];
        control.slider.value = String(spec.toSlider(model));
        control.readout.textContent = spec.format(model);
      });
    }
  }

  private onAxisInput(
    channel: Channel,
    axis: number,
    sliderValue: number,
  ): void {
    const editor = this.editor;
    if (!editor) return;
    const spec = CHANNELS[channel];
    const model = spec.fromSlider(sliderValue);
    editor.geometry[channel][axis] = model;
    editor.controls[channel][axis].readout.textContent = spec.format(model);
    this.handlers?.onTransformGeometry(editor.index, {
      position: clone3(editor.geometry.position),
      rotation: clone3(editor.geometry.rotation),
      scale: clone3(editor.geometry.scale),
    });
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
