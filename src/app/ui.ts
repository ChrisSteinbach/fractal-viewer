import { effectiveSymmetryOrder, MAX_TRANSFORMS } from "../fractal/chaos-game";
import { isEmbeddable3 } from "../fractal/affine4";
import {
  buildColorModeLUT,
  colorModeUsesGamma,
  transformColors,
} from "../fractal/color";
import type { FlamePaletteId } from "../fractal/palette";
import { VARIATION_TYPES } from "../fractal/types";
import type {
  ColorMode,
  SymmetryAxis,
  Transform,
  Variation,
  VariationType,
  Vec3,
} from "../fractal/types";
import { clone3, to255 } from "../fractal/vec";
import type { Preset } from "../fractal/presets";
import type { AppState, RenderStyle } from "./state";
import { MAX_COLOR_GAMMA, MAX_NUM_POINTS, MIN_NUM_POINTS } from "./state";
import {
  MOBILE_BREAKPOINT,
  MIN_GUIDE_SCALE,
  MAX_GUIDE_SCALE,
} from "./constants";

export type { Preset };

/** The geometry (and weight/variations) a transform editor edits. */
type Geometry = Pick<
  Transform,
  "position" | "rotation" | "scale" | "weight" | "shear" | "variations"
>;

/** The final transform's geometry — the same, minus the selection weight, which
 * is meaningless for a map applied to every point. */
type FinalGeometry = Omit<Geometry, "weight">;

/** The current edit target: a transform index, the final transform, or none. */
type EditTarget = number | "final" | null;

/**
 * The five NEW degrees of freedom a 4D map exposes over its embedded 3D self
 * (fr-2ou): the fourth position/scale component and the three `w`-mixing
 * rotation planes. The familiar x/y/z params are edited in the 3D editor before
 * embedding, so they are deliberately absent here.
 */
export type FourDEditParam = "posW" | "scaleW" | "xw" | "yw" | "zw";

/**
 * A 4D map's editable `w`-parameters, projected out of a `Transform4` for the
 * in-4D editor (see {@link Ui.renderFourDEditor}). The three plane angles are in
 * RADIANS (the same unit `Transform4.rotation` stores); the editor's sliders
 * display them as degrees.
 */
export interface FourDMapParams {
  posW: number;
  scaleW: number;
  xw: number;
  yw: number;
  zw: number;
}

export interface UiHandlers {
  onAdd: () => void;
  onRemove: () => void;
  onPreset: (preset: Preset) => void;
  /** "Surprise Me" was clicked: roll a fresh random IFS and load it like a preset. */
  onSurprise: () => void;
  onNumPointsInput: (value: number) => void;
  onPointSizeInput: (value: number) => void;
  /** The glow-brightness slider changed — a manual multiplier on top of the
   * glow render's per-frame auto-exposure (see main.ts's `animate`). Only
   * shown while `renderStyle === "glow"`. */
  onGlowBrightnessInput: (value: number) => void;
  onRegenerate: () => void;
  onSavePng: () => void;
  onToggleGuides: (checked: boolean) => void;
  onColorMode: (mode: ColorMode) => void;
  /** The color-contrast slider changed (fr-8sk) — the value passed is the
   * actual gamma, already converted from the slider's log-scale position.
   * Only shown while the active color mode is height/radius/position. */
  onColorGammaInput: (value: number) => void;
  onRenderStyle: (style: RenderStyle) => void;
  onToggleAutoUpdate: (checked: boolean) => void;
  onSelect: (index: EditTarget) => void;
  /** A panel slider edited the selected transform's geometry. */
  onTransformGeometry: (index: number, geometry: Geometry) => void;
  /** The lens toggle was flipped: enable a default final transform, or clear it. */
  onToggleFinalTransform: (checked: boolean) => void;
  /** A panel slider edited the final transform's geometry. */
  onFinalTransformGeometry: (geometry: FinalGeometry) => void;
  onTogglePanel: () => void;
  onClosePanel: () => void;
  /** "Render Current View" was clicked: freeze the camera and start a flame render. */
  onEnterFlameRender: () => void;
  /** "Back to Explorer" was clicked: discard the in-progress render. */
  onExitFlameRender: () => void;
  onFlameExposureInput: (value: number) => void;
  onFlameIterationsInput: (value: number) => void;
  onFlameGammaInput: (value: number) => void;
  onFlameVibrancyInput: (value: number) => void;
  /** The supersample slider changed — the app restarts accumulation. */
  onFlameSupersampleInput: (value: number) => void;
  /** The palette dropdown changed — the app restarts accumulation (the
   * accumulated color sums bake in the palette). */
  onFlamePaletteChange: (paletteId: FlamePaletteId) => void;
  /** Adaptive density-estimation blur (fr-17t) sliders — live-reactive like
   * gamma/vibrancy: re-run just the finished-frame adaptive pass, never a
   * re-accumulate. */
  onFlameEstimatorRadiusInput: (value: number) => void;
  onFlameEstimatorMinimumRadiusInput: (value: number) => void;
  onFlameEstimatorCurveInput: (value: number) => void;
  /** "Render Solid View" was clicked: start accumulating the density volume
   * (the camera stays LIVE, unlike the flame render). */
  onEnterSolidRender: () => void;
  /** The solid render's "Back to Explorer" was clicked. */
  onExitSolidRender: () => void;
  /** Surface/lighting sliders — pure GPU uniforms, live at full frame rate. */
  onSolidThresholdInput: (value: number) => void;
  onSolidLightAzimuthInput: (value: number) => void;
  onSolidLightElevationInput: (value: number) => void;
  onSolidAmbientInput: (value: number) => void;
  /** The solid palette dropdown changed — the app restarts accumulation (the
   * accumulated colors bake in the palette). */
  onSolidPaletteChange: (paletteId: FlamePaletteId) => void;
  onSolidIterationsInput: (value: number) => void;
  /** The resolution slider changed — the app restarts accumulation. */
  onSolidResolutionInput: (value: number) => void;
  /** The symmetry order slider changed — reshapes the live point cloud (and
   * any active flame/solid render), not just a render-only setting. */
  onSymmetryOrderInput: (value: number) => void;
  /** The symmetry axis dropdown changed — same reach as
   * {@link onSymmetryOrderInput}. */
  onSymmetryAxisChange: (axis: SymmetryAxis) => void;
  /** A 4D-system button was clicked (fr-cbg spike): enter the 4D projection
   * view on the chosen preset system. */
  onEnterFourD: (kind: "pentatope" | "spiral") => void;
  /** The 4D projection's "Back to 3D" button was clicked. */
  onExitFourD: () => void;
  /** The 4D soft w-slice (fr-6x2) was toggled on or off. */
  onFourDSliceToggle: (checked: boolean) => void;
  /** The 4D slice-position slider moved: `value` is the slice center in
   * signed normalized rotated-w units, [-1, 1]. */
  onFourDSliceInput: (value: number) => void;
  /** "Current System → 4D" was clicked (fr-2ou): embed the live 3D system at
   * w = 0 and enter the 4D projection on it. */
  onEmbedCurrentSystem: () => void;
  /** The 4D editor's Map dropdown changed: `index` is the 0-based map to edit. */
  onFourDMapSelect: (index: number) => void;
  /** A 4D per-map param slider moved (fr-2ou). For `posW`/`scaleW`, `value` is
   * the raw slider number; for the `xw`/`yw`/`zw` rotation planes, `value` is in
   * RADIANS — the slider shows degrees and the Ui converts here, mirroring the
   * 3D rotation editor's degree→radian boundary. */
  onFourDParamInput: (param: FourDEditParam, value: number) => void;
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
type Channel = "position" | "rotation" | "scale" | "shear";

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
  /** Row labels; defaults to the X/Y/Z axes when omitted (shear uses XY/XZ/YZ). */
  axisLabels?: readonly [string, string, string];
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
  shear: {
    title: "Shear",
    min: -2,
    max: 2,
    step: 0.01,
    toSlider: (v) => v,
    fromSlider: (v) => v,
    format: (v) => v.toFixed(2),
    axisLabels: ["XY", "XZ", "YZ"],
  },
};

const CHANNEL_ORDER: Channel[] = ["position", "rotation", "scale", "shear"];

/**
 * The weight editor is log-scaled, so the slider sits at centre for the default
 * weight of 1 and reaches both rare (~0.05) and dominant (~20) maps without
 * crowding the low end. Stored as a plain multiplier on {@link Transform}.
 */
const WEIGHT_MIN = 0.05;
const WEIGHT_MAX = 20;
function weightToSlider(weight: number): number {
  return Math.log10(Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, weight)));
}
function sliderToWeight(slider: number): number {
  return 10 ** slider;
}

/**
 * Point-count slider: log-scaled so the low end (1k–100k) has fine control
 * while the top end (100k–5M) is still reachable without a 5000-step slider.
 * The HTML range goes 0–1000; these helpers convert between that and real
 * point counts.
 */
const NUM_POINTS_SLIDER_MAX = 1000;
const LOG_MIN = Math.log(MIN_NUM_POINTS);
const LOG_MAX = Math.log(MAX_NUM_POINTS);
function numPointsToSlider(n: number): number {
  const clamped = Math.max(MIN_NUM_POINTS, Math.min(MAX_NUM_POINTS, n));
  return (
    ((Math.log(clamped) - LOG_MIN) / (LOG_MAX - LOG_MIN)) *
    NUM_POINTS_SLIDER_MAX
  );
}
function sliderToNumPoints(s: number): number {
  const t = s / NUM_POINTS_SLIDER_MAX;
  // Round to the nearest 1000 so the label reads cleanly.
  return Math.round(Math.exp(LOG_MIN + t * (LOG_MAX - LOG_MIN)) / 1000) * 1000;
}

/**
 * Log-scale mapping for the color-contrast slider (fr-8sk): position `v` in
 * `[-1, 1]` maps to gamma in `[MIN_COLOR_GAMMA, MAX_COLOR_GAMMA]` via
 * `MAX_COLOR_GAMMA ** v`. Works because `MIN_COLOR_GAMMA === 1 /
 * MAX_COLOR_GAMMA`, which puts neutral gamma `1.0` exactly at the slider's
 * center (`v = 0`) and mirrors the low/high halves logarithmically, so
 * "spread the low end" and "spread the high end" get equal-feeling ranges of
 * travel either side of neutral.
 */
function sliderToColorGamma(v: number): number {
  return MAX_COLOR_GAMMA ** v;
}
function colorGammaToSlider(gamma: number): number {
  return Math.log(gamma) / Math.log(MAX_COLOR_GAMMA);
}

/**
 * Variation blend-weight slider bounds. Linear (not log like selection weight):
 * a variation's strength reads naturally as a `0…2` coefficient, with 0 meaning
 * "remove it" — which is exactly what the row's × button does.
 */
const VARIATION_WEIGHT_MIN = 0;
const VARIATION_WEIGHT_MAX = 2;
const DEFAULT_VARIATION_WEIGHT = 1;

/** Title-case a variation type for display, e.g. "handkerchief" → "Handkerchief". */
function variationLabel(type: VariationType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Structural equality for a variation list, so the editor only rebuilds on real change. */
function variationsEqual(a: Variation[], b: Variation[]): boolean {
  return (
    a.length === b.length &&
    a.every((v, i) => v.type === b[i].type && v.weight === b[i].weight)
  );
}

/** One "Var: …" line naming a transform's active variations, for the list row. */
function variationSummary(t: Transform): string[] {
  const active = (t.variations ?? []).filter((v) => v.weight !== 0);
  if (active.length === 0) return [];
  return [`Var: ${active.map((v) => v.type).join(", ")}`];
}

/**
 * Number of evenly spaced {@link buildColorModeLUT} samples used to build the
 * legend's CSS gradient (fr-dsz) — more than a coarse 8-stop bar so a non-1
 * `colorGamma` curve (fr-8sk) still reads accurately in the legend, not just
 * at its two (always-fixed) endpoints.
 */
const LEGEND_GRADIENT_STOPS = 16;

/** Cap on individual swatches shown in the "by transform" legend before the
 * remainder folds into a single "+N" indicator — an uncapped strip would
 * grow arbitrarily wide for a many-transform system. */
const LEGEND_MAX_SWATCHES = 12;

/** Format a normalized `[0, 1]` sRGB triple as a CSS `rgb()` string. Color
 * management is disabled (`scene.ts`), so these byte values match the
 * rendered cloud exactly. */
function cssRgb(r: number, g: number, b: number): string {
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

/**
 * Build the legend's CSS `linear-gradient` for the height/radius color modes
 * by sampling {@link buildColorModeLUT} — the same lookup table the solid
 * render's hot loop uses, so the legend bar can never drift from the actual
 * ramp (or from the current color-contrast setting).
 */
function legendGradient(mode: "height" | "radius", colorGamma: number): string {
  const lut = buildColorModeLUT(mode, colorGamma);
  const stops: string[] = [];
  for (let i = 0; i < LEGEND_GRADIENT_STOPS; i++) {
    const lutIndex = Math.round((i / (LEGEND_GRADIENT_STOPS - 1)) * 255);
    const o = lutIndex * 3;
    stops.push(cssRgb(lut[o], lut[o + 1], lut[o + 2]));
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

interface AxisControl {
  slider: HTMLInputElement;
  readout: HTMLElement;
}

/** Live handles into a built editor so external edits can re-sync the sliders. */
interface EditorState {
  /** What the editor edits: a transform index or the final transform. */
  target: number | "final";
  geometry: {
    position: Vec3;
    rotation: Vec3;
    scale: Vec3;
    shear: Vec3;
    weight: number;
  };
  controls: Record<Channel, AxisControl[]>;
  /** The selection-weight control, or `null` for the final transform (no weight). */
  weightControl: AxisControl | null;
  /** Working copy of the transform's variation blend, edited in place. */
  variations: Variation[];
  /** Container the variation rows are (re)built into on add/remove. */
  variationList: HTMLElement;
  /** The "add variation" dropdown, whose options exclude already-added types. */
  variationAdd: HTMLSelectElement;
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
  private readonly legend: HTMLElement;
  private readonly legendBar: HTMLElement;
  private readonly legendLabels: HTMLElement;
  private readonly legendLabelLow: HTMLElement;
  private readonly legendLabelHigh: HTMLElement;
  private readonly legendSwatches: HTMLElement;
  private readonly legendText: HTMLElement;
  private readonly menuToggle: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly panelClose: HTMLElement;
  private readonly transformCount: HTMLElement;
  private readonly transformList: HTMLElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly removeBtn: HTMLButtonElement;
  private readonly presetSelect: HTMLSelectElement;
  private readonly surpriseBtn: HTMLButtonElement;
  private readonly regenerateBtn: HTMLButtonElement;
  private readonly savePngBtn: HTMLButtonElement;
  private readonly numPointsLabel: HTMLElement;
  private readonly numPointsSlider: HTMLInputElement;
  private readonly pointSizeLabel: HTMLElement;
  private readonly pointSizeSlider: HTMLInputElement;
  private readonly glowBrightnessRow: HTMLElement;
  private readonly glowBrightnessLabel: HTMLElement;
  private readonly glowBrightnessSlider: HTMLInputElement;
  private readonly colorGammaRow: HTMLElement;
  private readonly colorGammaLabel: HTMLElement;
  private readonly colorGammaSlider: HTMLInputElement;
  private readonly showGuides: HTMLInputElement;
  private readonly colorMode: HTMLSelectElement;
  private readonly renderStyle: HTMLSelectElement;
  private readonly autoUpdate: HTMLInputElement;
  private readonly symmetryOrderLabel: HTMLElement;
  private readonly symmetryOrderSlider: HTMLInputElement;
  private readonly symmetryAxisSelect: HTMLSelectElement;
  private readonly symmetryNote: HTMLElement;
  private readonly finalTransformToggle: HTMLInputElement;
  private readonly transformEditor: HTMLElement;

  private readonly explorerControls: HTMLElement;
  private readonly flameEntry: HTMLElement;
  private readonly renderBtn: HTMLButtonElement;
  private readonly flameControls: HTMLElement;
  private readonly flameExposureLabel: HTMLElement;
  private readonly flameExposureSlider: HTMLInputElement;
  private readonly flameIterationsLabel: HTMLElement;
  private readonly flameIterationsSlider: HTMLInputElement;
  private readonly flameGammaLabel: HTMLElement;
  private readonly flameGammaSlider: HTMLInputElement;
  private readonly flameVibrancyLabel: HTMLElement;
  private readonly flameVibrancySlider: HTMLInputElement;
  private readonly flameSupersampleLabel: HTMLElement;
  private readonly flameSupersampleSlider: HTMLInputElement;
  private readonly flameSupersampleNote: HTMLElement;
  private readonly flamePalette: HTMLSelectElement;
  private readonly flameEstimatorRadiusLabel: HTMLElement;
  private readonly flameEstimatorRadiusSlider: HTMLInputElement;
  private readonly flameEstimatorMinimumRadiusLabel: HTMLElement;
  private readonly flameEstimatorMinimumRadiusSlider: HTMLInputElement;
  private readonly flameEstimatorCurveLabel: HTMLElement;
  private readonly flameEstimatorCurveSlider: HTMLInputElement;
  private readonly flameProgress: HTMLElement;
  private readonly exitRenderBtn: HTMLButtonElement;

  private readonly solidEntry: HTMLElement;
  private readonly solidBtn: HTMLButtonElement;
  private readonly solidControls: HTMLElement;
  private readonly solidThresholdLabel: HTMLElement;
  private readonly solidThresholdSlider: HTMLInputElement;
  private readonly solidLightAzimuthLabel: HTMLElement;
  private readonly solidLightAzimuthSlider: HTMLInputElement;
  private readonly solidLightElevationLabel: HTMLElement;
  private readonly solidLightElevationSlider: HTMLInputElement;
  private readonly solidAmbientLabel: HTMLElement;
  private readonly solidAmbientSlider: HTMLInputElement;
  private readonly solidPalette: HTMLSelectElement;
  private readonly solidIterationsLabel: HTMLElement;
  private readonly solidIterationsSlider: HTMLInputElement;
  private readonly solidResolutionLabel: HTMLElement;
  private readonly solidResolutionSlider: HTMLInputElement;
  private readonly solidResolutionNote: HTMLElement;
  private readonly solidProgress: HTMLElement;
  private readonly exitSolidBtn: HTMLButtonElement;

  // 4D projection view (fr-cbg spike). The entry block + its two system
  // buttons, the in-4D controls block + its exit button, and the explorer
  // sub-blocks hidden while 4D is active (wrappers added to index.html so each
  // block hides cleanly — see updateLabels).
  private readonly fourDEntry: HTMLElement;
  private readonly pentatopeButton: HTMLButtonElement;
  private readonly spiral4Button: HTMLButtonElement;
  private readonly fourDControls: HTMLElement;
  private readonly exitFourDButton: HTMLButtonElement;
  private readonly fourDSliceToggle: HTMLInputElement;
  private readonly fourDSliceRow: HTMLElement;
  private readonly fourDSliceSlider: HTMLInputElement;
  private readonly fourDSliceLabel: HTMLElement;
  // "Current System → 4D" entry button + its "why disabled" note (fr-2ou).
  private readonly embed3Button: HTMLButtonElement;
  private readonly embed3Note: HTMLElement;
  // In-4D per-map editor (fr-2ou): the Map select and the five w-param sliders.
  private readonly fourDMapSelect: HTMLSelectElement;
  private readonly fourDPosWSlider: HTMLInputElement;
  private readonly fourDPosWLabel: HTMLElement;
  private readonly fourDScaleWSlider: HTMLInputElement;
  private readonly fourDScaleWLabel: HTMLElement;
  private readonly fourDRotXWSlider: HTMLInputElement;
  private readonly fourDRotXWLabel: HTMLElement;
  private readonly fourDRotYWSlider: HTMLInputElement;
  private readonly fourDRotYWLabel: HTMLElement;
  private readonly fourDRotZWSlider: HTMLInputElement;
  private readonly fourDRotZWLabel: HTMLElement;
  private readonly transformsSection: HTMLElement;
  private readonly presetSection: HTMLElement;
  private readonly colorModeRow: HTMLElement;
  private readonly renderStyleRow: HTMLElement;
  private readonly symmetrySection: HTMLElement;
  private readonly transformEditSection: HTMLElement;

  private editor: EditorState | null = null;

  constructor(doc: Document = document) {
    this.doc = doc;
    this.helpTitle = this.byId("helpTitle");
    this.helpText = this.byId("helpText");
    this.pointCount = this.byId("pointCount");
    this.legend = this.byId("legend");
    this.legendBar = this.byId("legendBar");
    this.legendLabels = this.byId("legendLabels");
    this.legendLabelLow = this.byId("legendLabelLow");
    this.legendLabelHigh = this.byId("legendLabelHigh");
    this.legendSwatches = this.byId("legendSwatches");
    this.legendText = this.byId("legendText");
    this.menuToggle = this.byId("menuToggle");
    this.backdrop = this.byId("backdrop");
    this.panel = this.byId("panel");
    this.panelClose = this.byId("panelClose");
    this.transformCount = this.byId("transformCount");
    this.transformList = this.byId("transformList");
    this.addBtn = this.byId("addBtn");
    this.removeBtn = this.byId("removeBtn");
    this.presetSelect = this.byId("presetSelect");
    this.surpriseBtn = this.byId("surpriseBtn");
    this.regenerateBtn = this.byId("regenerateBtn");
    this.savePngBtn = this.byId("savePngBtn");
    this.numPointsLabel = this.byId("numPointsLabel");
    this.numPointsSlider = this.byId("numPointsSlider");
    this.pointSizeLabel = this.byId("pointSizeLabel");
    this.pointSizeSlider = this.byId("pointSizeSlider");
    this.glowBrightnessRow = this.byId("glowBrightnessRow");
    this.glowBrightnessLabel = this.byId("glowBrightnessLabel");
    this.glowBrightnessSlider = this.byId("glowBrightnessSlider");
    this.colorGammaRow = this.byId("colorGammaRow");
    this.colorGammaLabel = this.byId("colorGammaLabel");
    this.colorGammaSlider = this.byId("colorGammaSlider");
    this.showGuides = this.byId("showGuides");
    this.colorMode = this.byId("colorMode");
    this.renderStyle = this.byId("renderStyle");
    this.autoUpdate = this.byId("autoUpdate");
    this.symmetryOrderLabel = this.byId("symmetryOrderLabel");
    this.symmetryOrderSlider = this.byId("symmetryOrderSlider");
    this.symmetryAxisSelect = this.byId("symmetryAxis");
    this.symmetryNote = this.byId("symmetryNote");
    this.finalTransformToggle = this.byId("finalTransformToggle");
    this.transformEditor = this.byId("transformEditor");
    this.explorerControls = this.byId("explorerControls");
    this.flameEntry = this.byId("flameEntry");
    this.renderBtn = this.byId("renderBtn");
    this.flameControls = this.byId("flameControls");
    this.flameExposureLabel = this.byId("flameExposureLabel");
    this.flameExposureSlider = this.byId("flameExposureSlider");
    this.flameIterationsLabel = this.byId("flameIterationsLabel");
    this.flameIterationsSlider = this.byId("flameIterationsSlider");
    this.flameGammaLabel = this.byId("flameGammaLabel");
    this.flameGammaSlider = this.byId("flameGammaSlider");
    this.flameVibrancyLabel = this.byId("flameVibrancyLabel");
    this.flameVibrancySlider = this.byId("flameVibrancySlider");
    this.flameSupersampleLabel = this.byId("flameSupersampleLabel");
    this.flameSupersampleSlider = this.byId("flameSupersampleSlider");
    this.flameSupersampleNote = this.byId("flameSupersampleNote");
    this.flamePalette = this.byId("flamePalette");
    this.flameEstimatorRadiusLabel = this.byId("flameEstimatorRadiusLabel");
    this.flameEstimatorRadiusSlider = this.byId("flameEstimatorRadiusSlider");
    this.flameEstimatorMinimumRadiusLabel = this.byId(
      "flameEstimatorMinimumRadiusLabel",
    );
    this.flameEstimatorMinimumRadiusSlider = this.byId(
      "flameEstimatorMinimumRadiusSlider",
    );
    this.flameEstimatorCurveLabel = this.byId("flameEstimatorCurveLabel");
    this.flameEstimatorCurveSlider = this.byId("flameEstimatorCurveSlider");
    this.flameProgress = this.byId("flameProgress");
    this.exitRenderBtn = this.byId("exitRenderBtn");
    this.solidEntry = this.byId("solidEntry");
    this.solidBtn = this.byId("solidBtn");
    this.solidControls = this.byId("solidControls");
    this.solidThresholdLabel = this.byId("solidThresholdLabel");
    this.solidThresholdSlider = this.byId("solidThresholdSlider");
    this.solidLightAzimuthLabel = this.byId("solidLightAzimuthLabel");
    this.solidLightAzimuthSlider = this.byId("solidLightAzimuthSlider");
    this.solidLightElevationLabel = this.byId("solidLightElevationLabel");
    this.solidLightElevationSlider = this.byId("solidLightElevationSlider");
    this.solidAmbientLabel = this.byId("solidAmbientLabel");
    this.solidAmbientSlider = this.byId("solidAmbientSlider");
    this.solidPalette = this.byId("solidPalette");
    this.solidIterationsLabel = this.byId("solidIterationsLabel");
    this.solidIterationsSlider = this.byId("solidIterationsSlider");
    this.solidResolutionLabel = this.byId("solidResolutionLabel");
    this.solidResolutionSlider = this.byId("solidResolutionSlider");
    this.solidResolutionNote = this.byId("solidResolutionNote");
    this.solidProgress = this.byId("solidProgress");
    this.exitSolidBtn = this.byId("exitSolidBtn");
    this.fourDEntry = this.byId("fourDEntry");
    this.pentatopeButton = this.byId("pentatopeButton");
    this.spiral4Button = this.byId("spiral4Button");
    this.fourDControls = this.byId("fourDControls");
    this.exitFourDButton = this.byId("exitFourDButton");
    this.fourDSliceToggle = this.byId("fourDSliceToggle");
    this.fourDSliceRow = this.byId("fourDSliceRow");
    this.fourDSliceSlider = this.byId("fourDSliceSlider");
    this.fourDSliceLabel = this.byId("fourDSliceLabel");
    this.embed3Button = this.byId("embed3Button");
    this.embed3Note = this.byId("embed3Note");
    this.fourDMapSelect = this.byId("fourDMapSelect");
    this.fourDPosWSlider = this.byId("fourDPosWSlider");
    this.fourDPosWLabel = this.byId("fourDPosWLabel");
    this.fourDScaleWSlider = this.byId("fourDScaleWSlider");
    this.fourDScaleWLabel = this.byId("fourDScaleWLabel");
    this.fourDRotXWSlider = this.byId("fourDRotXWSlider");
    this.fourDRotXWLabel = this.byId("fourDRotXWLabel");
    this.fourDRotYWSlider = this.byId("fourDRotYWSlider");
    this.fourDRotYWLabel = this.byId("fourDRotYWLabel");
    this.fourDRotZWSlider = this.byId("fourDRotZWSlider");
    this.fourDRotZWLabel = this.byId("fourDRotZWLabel");
    this.transformsSection = this.byId("transformsSection");
    this.presetSection = this.byId("presetSection");
    this.colorModeRow = this.byId("colorModeRow");
    this.renderStyleRow = this.byId("renderStyleRow");
    this.symmetrySection = this.byId("symmetrySection");
    this.transformEditSection = this.byId("transformEditSection");
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
    this.surpriseBtn.addEventListener("click", () => handlers.onSurprise());
    this.regenerateBtn.addEventListener("click", () => handlers.onRegenerate());
    this.savePngBtn.addEventListener("click", () => handlers.onSavePng());
    this.numPointsSlider.addEventListener("input", () =>
      handlers.onNumPointsInput(
        sliderToNumPoints(Number(this.numPointsSlider.value)),
      ),
    );
    this.pointSizeSlider.addEventListener("input", () =>
      handlers.onPointSizeInput(Number(this.pointSizeSlider.value)),
    );
    this.glowBrightnessSlider.addEventListener("input", () =>
      handlers.onGlowBrightnessInput(Number(this.glowBrightnessSlider.value)),
    );
    this.colorGammaSlider.addEventListener("input", () =>
      handlers.onColorGammaInput(
        sliderToColorGamma(Number(this.colorGammaSlider.value)),
      ),
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
    this.symmetryOrderSlider.addEventListener("input", () =>
      handlers.onSymmetryOrderInput(Number(this.symmetryOrderSlider.value)),
    );
    this.symmetryAxisSelect.addEventListener("change", () =>
      handlers.onSymmetryAxisChange(
        this.symmetryAxisSelect.value as SymmetryAxis,
      ),
    );
    this.finalTransformToggle.addEventListener("change", () =>
      handlers.onToggleFinalTransform(this.finalTransformToggle.checked),
    );
    this.renderBtn.addEventListener("click", () =>
      handlers.onEnterFlameRender(),
    );
    this.exitRenderBtn.addEventListener("click", () =>
      handlers.onExitFlameRender(),
    );
    this.flameExposureSlider.addEventListener("input", () =>
      handlers.onFlameExposureInput(Number(this.flameExposureSlider.value)),
    );
    this.flameIterationsSlider.addEventListener("input", () =>
      handlers.onFlameIterationsInput(Number(this.flameIterationsSlider.value)),
    );
    this.flameGammaSlider.addEventListener("input", () =>
      handlers.onFlameGammaInput(Number(this.flameGammaSlider.value)),
    );
    this.flameVibrancySlider.addEventListener("input", () =>
      handlers.onFlameVibrancyInput(Number(this.flameVibrancySlider.value)),
    );
    this.flameSupersampleSlider.addEventListener("input", () =>
      handlers.onFlameSupersampleInput(
        Number(this.flameSupersampleSlider.value),
      ),
    );
    this.flamePalette.addEventListener("change", () =>
      handlers.onFlamePaletteChange(this.flamePalette.value as FlamePaletteId),
    );
    this.flameEstimatorRadiusSlider.addEventListener("input", () =>
      handlers.onFlameEstimatorRadiusInput(
        Number(this.flameEstimatorRadiusSlider.value),
      ),
    );
    this.flameEstimatorMinimumRadiusSlider.addEventListener("input", () =>
      handlers.onFlameEstimatorMinimumRadiusInput(
        Number(this.flameEstimatorMinimumRadiusSlider.value),
      ),
    );
    this.flameEstimatorCurveSlider.addEventListener("input", () =>
      handlers.onFlameEstimatorCurveInput(
        Number(this.flameEstimatorCurveSlider.value),
      ),
    );
    this.solidBtn.addEventListener("click", () =>
      handlers.onEnterSolidRender(),
    );
    this.exitSolidBtn.addEventListener("click", () =>
      handlers.onExitSolidRender(),
    );
    this.solidThresholdSlider.addEventListener("input", () =>
      handlers.onSolidThresholdInput(Number(this.solidThresholdSlider.value)),
    );
    this.solidLightAzimuthSlider.addEventListener("input", () =>
      handlers.onSolidLightAzimuthInput(
        Number(this.solidLightAzimuthSlider.value),
      ),
    );
    this.solidLightElevationSlider.addEventListener("input", () =>
      handlers.onSolidLightElevationInput(
        Number(this.solidLightElevationSlider.value),
      ),
    );
    this.solidAmbientSlider.addEventListener("input", () =>
      handlers.onSolidAmbientInput(Number(this.solidAmbientSlider.value)),
    );
    this.solidPalette.addEventListener("change", () =>
      handlers.onSolidPaletteChange(this.solidPalette.value as FlamePaletteId),
    );
    this.solidIterationsSlider.addEventListener("input", () =>
      handlers.onSolidIterationsInput(Number(this.solidIterationsSlider.value)),
    );
    this.solidResolutionSlider.addEventListener("input", () =>
      handlers.onSolidResolutionInput(Number(this.solidResolutionSlider.value)),
    );
    this.pentatopeButton.addEventListener("click", () =>
      handlers.onEnterFourD("pentatope"),
    );
    this.spiral4Button.addEventListener("click", () =>
      handlers.onEnterFourD("spiral"),
    );
    this.exitFourDButton.addEventListener("click", () =>
      handlers.onExitFourD(),
    );
    this.fourDSliceToggle.addEventListener("change", () => {
      const on = this.fourDSliceToggle.checked;
      // The position slider only means anything while the slice is on — a
      // pure view reveal, so the UI owns it (slice state is session-only and
      // never enters AppState).
      this.fourDSliceRow.classList.toggle("hidden", !on);
      handlers.onFourDSliceToggle(on);
    });
    this.fourDSliceSlider.addEventListener("input", () => {
      const value = Number(this.fourDSliceSlider.value);
      this.fourDSliceLabel.textContent = value.toFixed(2);
      handlers.onFourDSliceInput(value);
    });
    this.embed3Button.addEventListener("click", () =>
      handlers.onEmbedCurrentSystem(),
    );
    this.fourDMapSelect.addEventListener("change", () =>
      handlers.onFourDMapSelect(Number(this.fourDMapSelect.value)),
    );
    this.fourDPosWSlider.addEventListener("input", () => {
      const value = Number(this.fourDPosWSlider.value);
      this.fourDPosWLabel.textContent = value.toFixed(2);
      handlers.onFourDParamInput("posW", value);
    });
    this.fourDScaleWSlider.addEventListener("input", () => {
      const value = Number(this.fourDScaleWSlider.value);
      this.fourDScaleWLabel.textContent = value.toFixed(2);
      handlers.onFourDParamInput("scaleW", value);
    });
    // Rotation sliders show degrees but the handler (and Transform4) wants
    // radians — convert here, exactly as the 3D rotation editor does.
    this.fourDRotXWSlider.addEventListener("input", () => {
      const deg = Number(this.fourDRotXWSlider.value);
      this.fourDRotXWLabel.textContent = `${deg}°`;
      handlers.onFourDParamInput("xw", degToRad(deg));
    });
    this.fourDRotYWSlider.addEventListener("input", () => {
      const deg = Number(this.fourDRotYWSlider.value);
      this.fourDRotYWLabel.textContent = `${deg}°`;
      handlers.onFourDParamInput("yw", degToRad(deg));
    });
    this.fourDRotZWSlider.addEventListener("input", () => {
      const deg = Number(this.fourDRotZWSlider.value);
      this.fourDRotZWLabel.textContent = `${deg}°`;
      handlers.onFourDParamInput("zw", degToRad(deg));
    });
  }

  /** Reset the 4D slice controls to off/centered — called on every 4D entry so
   * a slice left behind by the previous visit never silently applies. */
  resetFourDSlice(): void {
    this.fourDSliceToggle.checked = false;
    this.fourDSliceRow.classList.add("hidden");
    this.fourDSliceSlider.value = "0";
    this.fourDSliceLabel.textContent = "0.00";
  }

  /**
   * (Re)build the in-4D per-map editor (fr-2ou): rebuild the Map dropdown as
   * "Map 1"…"Map N", select `selected`, and fill the five w-param sliders +
   * labels from `maps[selected]`. Called by main.ts on 4D entry and whenever
   * the selected map changes — NOT on a slider edit, since the sliders are
   * already the live source of that value. Rotation angles arrive in radians
   * and are shown as degrees, matching the 3D rotation editor.
   */
  renderFourDEditor(maps: FourDMapParams[], selected: number): void {
    this.fourDMapSelect.replaceChildren();
    maps.forEach((_, i) => {
      const option = this.doc.createElement("option");
      option.value = String(i);
      option.textContent = `Map ${i + 1}`;
      this.fourDMapSelect.appendChild(option);
    });
    this.fourDMapSelect.value = String(selected);

    const map = maps[selected];
    if (!map) return; // defensive: a 4D system always has ≥ 1 map.
    this.fourDPosWSlider.value = String(map.posW);
    this.fourDPosWLabel.textContent = map.posW.toFixed(2);
    this.fourDScaleWSlider.value = String(map.scaleW);
    this.fourDScaleWLabel.textContent = map.scaleW.toFixed(2);
    this.fourDRotXWSlider.value = String(displayDegrees(map.xw));
    this.fourDRotXWLabel.textContent = `${displayDegrees(map.xw)}°`;
    this.fourDRotYWSlider.value = String(displayDegrees(map.yw));
    this.fourDRotYWLabel.textContent = `${displayDegrees(map.yw)}°`;
    this.fourDRotZWSlider.value = String(displayDegrees(map.zw));
    this.fourDRotZWLabel.textContent = `${displayDegrees(map.zw)}°`;
  }

  /** Reflect scalar state into labels, inputs, the help box, and the panel. */
  updateLabels(state: AppState): void {
    this.transformCount.textContent = String(state.transforms.length);
    this.removeBtn.disabled = state.transforms.length <= 1;
    this.numPointsLabel.textContent = state.numPoints.toLocaleString();
    this.numPointsSlider.value = String(numPointsToSlider(state.numPoints));
    this.pointSizeLabel.textContent = `${state.pointSize.toFixed(2)}×`;
    this.pointSizeSlider.value = String(state.pointSize);
    this.glowBrightnessLabel.textContent = `${state.glowBrightness.toFixed(2)}×`;
    this.glowBrightnessSlider.value = String(state.glowBrightness);
    this.colorGammaLabel.textContent = state.colorGamma.toFixed(2);
    this.colorGammaSlider.value = String(colorGammaToSlider(state.colorGamma));
    this.colorMode.value = state.colorMode;
    this.renderStyle.value = state.renderStyle;
    this.showGuides.checked = state.showGuides;
    this.autoUpdate.checked = state.autoUpdate;

    this.symmetryOrderSlider.value = String(state.symmetry.order);
    this.symmetryOrderLabel.textContent = `${state.symmetry.order}-fold`;
    this.symmetryAxisSelect.value = state.symmetry.axis;
    const effectiveOrder = effectiveSymmetryOrder(
      state.symmetry.order,
      state.transforms.length,
    );
    if (effectiveOrder !== state.symmetry.order) {
      this.symmetryNote.textContent = `Reduced to ${effectiveOrder}-fold (from ${state.symmetry.order}-fold) to fit the ${MAX_TRANSFORMS}-transform limit.`;
      this.symmetryNote.classList.remove("hidden");
    } else {
      this.symmetryNote.textContent = "";
      this.symmetryNote.classList.add("hidden");
    }

    this.finalTransformToggle.checked = state.finalTransform !== undefined;

    this.flameExposureLabel.textContent = `${state.flame.exposure.toFixed(2)}×`;
    this.flameExposureSlider.value = String(state.flame.exposure);
    this.flameIterationsLabel.textContent = `${(
      state.flame.iterations / 1_000_000
    ).toFixed(0)}M iterations`;
    this.flameIterationsSlider.value = String(state.flame.iterations);

    this.flameGammaLabel.textContent = state.flame.gamma.toFixed(2);
    this.flameGammaSlider.value = String(state.flame.gamma);
    this.flameVibrancyLabel.textContent = `${Math.round(state.flame.vibrancy * 100)}%`;
    this.flameVibrancySlider.value = String(state.flame.vibrancy);
    this.flameSupersampleLabel.textContent = `${state.flame.supersample}×`;
    this.flameSupersampleSlider.value = String(state.flame.supersample);
    this.flamePalette.value = state.flame.paletteId;

    this.flameEstimatorRadiusLabel.textContent = `${state.flame.estimatorRadius.toFixed(1)}px`;
    this.flameEstimatorRadiusSlider.value = String(state.flame.estimatorRadius);
    this.flameEstimatorMinimumRadiusLabel.textContent = `${state.flame.estimatorMinimumRadius.toFixed(1)}px`;
    this.flameEstimatorMinimumRadiusSlider.value = String(
      state.flame.estimatorMinimumRadius,
    );
    this.flameEstimatorCurveLabel.textContent =
      state.flame.estimatorCurve.toFixed(2);
    this.flameEstimatorCurveSlider.value = String(state.flame.estimatorCurve);

    this.solidThresholdLabel.textContent = state.solid.threshold.toFixed(2);
    this.solidThresholdSlider.value = String(state.solid.threshold);
    this.solidLightAzimuthLabel.textContent = `${Math.round(state.solid.lightAzimuth)}°`;
    this.solidLightAzimuthSlider.value = String(state.solid.lightAzimuth);
    this.solidLightElevationLabel.textContent = `${Math.round(state.solid.lightElevation)}°`;
    this.solidLightElevationSlider.value = String(state.solid.lightElevation);
    this.solidAmbientLabel.textContent = `${Math.round(state.solid.ambient * 100)}%`;
    this.solidAmbientSlider.value = String(state.solid.ambient);
    this.solidPalette.value = state.solid.paletteId;
    this.solidIterationsLabel.textContent = `${(
      state.solid.iterations / 1_000_000
    ).toFixed(0)}M iterations`;
    this.solidIterationsSlider.value = String(state.solid.iterations);
    this.solidResolutionLabel.textContent = `${state.solid.resolution}³`;
    this.solidResolutionSlider.value = String(state.solid.resolution);

    // Either render mode takes over the panel — editing controls that can't
    // affect the in-progress render would just be confusing. The three
    // non-explorer modes (flame, solid, 4D) are mutually exclusive by
    // construction: each mode's entry button is hidden while any other is
    // active.
    const rendering = state.flameActive || state.solidActive;
    const fourD = state.fourDActive;
    // A flame/solid render replaces the WHOLE explorer; the 4D projection keeps
    // a few live controls (points/size/regenerate/guides) but hides everything
    // that edits or restyles the 3D system. So explorerControls itself hides
    // only for a render, while the 4D-hidden sub-blocks below add `fourD`.
    this.explorerControls.classList.toggle("hidden", rendering);
    this.flameEntry.classList.toggle("hidden", rendering || fourD);
    this.solidEntry.classList.toggle("hidden", rendering || fourD);
    this.fourDEntry.classList.toggle("hidden", rendering || fourD);
    this.flameControls.classList.toggle("hidden", !state.flameActive);
    this.solidControls.classList.toggle("hidden", !state.solidActive);
    this.fourDControls.classList.toggle("hidden", !fourD);
    // 3D-editing / restyling sub-blocks: hidden while the 4D projection is up
    // (they'd edit a system that isn't on screen). They already vanish during a
    // flame/solid render by sitting inside the hidden explorerControls, so
    // `fourD` is the only extra condition each needs here.
    this.transformsSection.classList.toggle("hidden", fourD);
    // The whole Presets block (heading, 3D preset select, Surprise Me): a 3D
    // preset can't load into the 4D projection, and a visible-but-inert
    // control would just look broken.
    this.presetSection.classList.toggle("hidden", fourD);
    this.colorModeRow.classList.toggle("hidden", fourD);
    this.renderStyleRow.classList.toggle("hidden", fourD);
    this.symmetrySection.classList.toggle("hidden", fourD);
    this.transformEditSection.classList.toggle("hidden", fourD);
    // The manual brightness override only means anything for the glow render
    // style, so — like the flame/solid sub-panels above — it's hidden whenever
    // that style isn't the active one (and always in 4D).
    this.glowBrightnessRow.classList.toggle(
      "hidden",
      fourD || state.renderStyle !== "glow",
    );
    // Contrast only means anything for the coordinate-normalized color modes
    // (and never in 4D, whose color comes straight from the 4th coordinate).
    this.colorGammaRow.classList.toggle(
      "hidden",
      fourD || !colorModeUsesGamma(state.colorMode),
    );
    // "Current System → 4D" embeds the live 3D system at w = 0, which
    // embedTransform3 refuses for shear/variations — so disable it (with a
    // one-line note) whenever any current transform isn't embeddable, and let
    // that track live edits (this runs on every refresh). Skipped during a
    // flame/solid render, when the whole 4D entry block is hidden anyway.
    if (!rendering) {
      const embeddable = state.transforms.every(isEmbeddable3);
      this.embed3Button.disabled = !embeddable;
      this.embed3Note.classList.toggle("hidden", embeddable);
    }
    this.updateLegend(state);

    if (state.flameActive) {
      this.helpTitle.textContent = "Flame Render";
      this.setHelpLines(["Rendering the frozen camera view…"]);
    } else if (state.solidActive) {
      // Unlike the flame's frozen view, the solid render's volume is
      // world-space: the camera stays fully interactive while it converges.
      this.helpTitle.textContent = "Solid Render";
      this.setHelpLines(
        this.mouse
          ? ["Drag: Orbit", "Right-drag: Pan", "Scroll: Zoom"]
          : ["1 finger: Rotate", "2 fingers: Pan/Zoom"],
      );
    } else if (state.fourDActive) {
      // The 4D projection auto-tumbles on its own; the camera orbits the
      // projected cloud exactly like camera mode.
      this.helpTitle.textContent = "4D Projection";
      this.setHelpLines(
        this.mouse
          ? ["Auto-tumbling 4D IFS", "Drag: Orbit", "Scroll: Zoom"]
          : ["Auto-tumbling 4D IFS", "1 finger: Rotate", "2 fingers: Pan/Zoom"],
      );
    } else if (state.selectedTransform === null) {
      this.helpTitle.textContent = "Camera Mode";
      this.setHelpLines(
        this.mouse
          ? ["Drag: Orbit", "Right-drag: Pan", "Scroll: Zoom"]
          : ["1 finger: Rotate", "2 fingers: Pan/Zoom"],
      );
    } else if (state.selectedTransform === "final") {
      // The lens has no draggable guide box, so the canvas keeps orbiting the
      // camera; the panel sliders do the editing.
      this.helpTitle.textContent = "Final Transform";
      this.setHelpLines(
        this.mouse
          ? ["A lens on the whole cloud", "Drag: Orbit", "Scroll: Zoom"]
          : [
              "A lens on the whole cloud",
              "1 finger: Rotate",
              "2 fingers: Pan/Zoom",
            ],
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

  /**
   * Reflect the color legend (fr-dsz): an unobtrusive key for what the active
   * Color Mode's colors mean. Height/radius get a gradient bar sampled from
   * {@link buildColorModeLUT} (so it can never drift from the rendered ramp,
   * or from the current color-contrast setting) with low/high or
   * center/edge labels; position gets a short axis-mapping note instead of a
   * bar (the mapping is xyz→rgb, not a single ramp); transform gets one
   * swatch per transform. Hidden entirely for uniform coloring (nothing to
   * key), while a flame render is active (it colors by palette, not by Color
   * Mode), and while the solid render is active with a non-"legacy" palette
   * (voxel.ts's accumulateVoxels then colors from that palette's LUT instead
   * of colorMode, exactly like the flame case — but solid's `"legacy"`
   * palette DOES follow colorMode/colorGamma faithfully, so the legend stays
   * accurate and visible for that one case).
   */
  private updateLegend(state: AppState): void {
    const mode = state.colorMode;
    const hidden =
      mode === "uniform" ||
      state.flameActive ||
      // The 4D projection colors by its 4th coordinate in-shader (see
      // scene.ts), not by any Color Mode, so this legend can't describe it.
      state.fourDActive ||
      (state.solidActive && state.solid.paletteId !== "legacy");
    this.legend.classList.toggle("hidden", hidden);
    if (hidden) return;

    const isGradient = mode === "height" || mode === "radius";
    this.legendBar.classList.toggle("hidden", !isGradient);
    this.legendLabels.classList.toggle("hidden", !isGradient);
    this.legendSwatches.classList.toggle("hidden", mode !== "transform");
    this.legendText.classList.toggle("hidden", mode !== "position");

    if (mode === "height" || mode === "radius") {
      this.legendBar.style.backgroundImage = legendGradient(
        mode,
        state.colorGamma,
      );
      this.legendLabelLow.textContent = mode === "height" ? "low" : "center";
      this.legendLabelHigh.textContent = mode === "height" ? "high" : "edge";
    } else if (mode === "position") {
      this.legendText.textContent = "X→R Y→G Z→B";
    } else if (mode === "transform") {
      this.renderLegendSwatches(state.transforms.length);
    }
  }

  /** Rebuild the "by transform" swatch strip from the current palette,
   * capped at {@link LEGEND_MAX_SWATCHES} with a trailing "+N" indicator. */
  private renderLegendSwatches(count: number): void {
    this.legendSwatches.replaceChildren();
    const palette = transformColors(count);
    const shown = Math.min(count, LEGEND_MAX_SWATCHES);
    for (let i = 0; i < shown; i++) {
      const [r, g, b] = palette[i];
      const swatch = this.doc.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = cssRgb(r, g, b);
      this.legendSwatches.appendChild(swatch);
    }
    if (count > LEGEND_MAX_SWATCHES) {
      const more = this.doc.createElement("span");
      more.className = "legend-more";
      more.textContent = `+${count - LEGEND_MAX_SWATCHES}`;
      this.legendSwatches.appendChild(more);
    }
  }

  /** Reflect flame-render progress as an iteration count and percentage.
   * Also clears the busy state {@link setFlameEstimating} set — every
   * `progress`/`sharedFrame` event from the worker is what ends an
   * "estimating" spell (fr-99z), whichever one arrives next. */
  setFlameProgress(iterationsDone: number, iterationsBudget: number): void {
    // floor, not round: a 99.7%-done progressive frame must not claim
    // "(100%)" — reading 100% while the image is still not final is exactly
    // the ambiguity fr-99z exists to remove.
    const pct =
      iterationsBudget > 0
        ? Math.min(100, Math.floor((iterationsDone / iterationsBudget) * 100))
        : 100;
    const done = (iterationsDone / 1_000_000).toFixed(1);
    const budget = (iterationsBudget / 1_000_000).toFixed(1);
    this.flameProgress.classList.remove("flame-progress-estimating");
    this.flameProgress.textContent = `${done}M / ${budget}M iterations (${pct}%)`;
  }

  /**
   * Busy indicator for the worker's synchronous adaptive density-estimation
   * pass (fr-99z): shown right when the worker posts `estimating`, i.e.
   * while it is still crunching that multi-second pass with no other
   * feedback otherwise on screen. Cleared by the next {@link setFlameProgress}
   * call, which the following `progress`/`sharedFrame` event always triggers.
   */
  setFlameEstimating(): void {
    this.flameProgress.textContent = "applying density estimate…";
    this.flameProgress.classList.add("flame-progress-estimating");
  }

  /**
   * Reflect whether the supersample slider's requested value had to be
   * reduced to stay under the accumulation memory budget (see the flame
   * worker's `clampSupersampleToBudget` use in `flame-worker-core.ts`) — a
   * runtime, device-dependent fact that
   * isn't part of AppState, so (like {@link setFlameProgress}) this is a
   * targeted setter main.ts calls directly rather than something
   * `updateLabels` derives from state. Pass `null` when running at the
   * requested value unclamped, to hide the note.
   */
  setFlameSupersampleNote(effective: number | null, requested?: number): void {
    if (effective === null) {
      this.flameSupersampleNote.textContent = "";
      this.flameSupersampleNote.classList.add("hidden");
      return;
    }
    this.flameSupersampleNote.textContent =
      requested !== undefined
        ? `Reduced to ${effective}× (from ${requested}×) to fit available memory.`
        : `Reduced to ${effective}× to fit available memory.`;
    this.flameSupersampleNote.classList.remove("hidden");
  }

  /** Reflect solid-render progress, mirroring {@link setFlameProgress}. */
  setSolidProgress(iterationsDone: number, iterationsBudget: number): void {
    const pct =
      iterationsBudget > 0
        ? Math.min(100, Math.floor((iterationsDone / iterationsBudget) * 100))
        : 100;
    const done = (iterationsDone / 1_000_000).toFixed(1);
    const budget = (iterationsBudget / 1_000_000).toFixed(1);
    this.solidProgress.textContent = `${done}M / ${budget}M iterations (${pct}%)`;
  }

  /**
   * Reflect whether the resolution slider's requested value had to be reduced
   * to fit the worker's memory budget — the solid render's counterpart to
   * {@link setFlameSupersampleNote}, with the same `null`-hides contract.
   */
  setSolidResolutionNote(effective: number | null, requested?: number): void {
    if (effective === null) {
      this.solidResolutionNote.textContent = "";
      this.solidResolutionNote.classList.add("hidden");
      return;
    }
    this.solidResolutionNote.textContent =
      requested !== undefined
        ? `Reduced to ${effective}³ (from ${requested}³) to fit available memory.`
        : `Reduced to ${effective}³ to fit available memory.`;
    this.solidResolutionNote.classList.remove("hidden");
  }

  /**
   * Rebuild the "select to edit" list: a camera row, one row per transform, and
   * — when a final transform is enabled — a lens row at the bottom.
   */
  renderTransformList(
    transforms: Transform[],
    selected: EditTarget,
    finalTransform: Transform | null,
  ): void {
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
            ...(t.weight !== undefined && t.weight !== 1
              ? [`Weight: ${t.weight.toFixed(2)}`]
              : []),
            ...variationSummary(t),
          ],
          onClick: () => this.handlers?.onSelect(i),
        }),
      );
    });

    // The lens is a global effect with no palette slot, so it gets its own
    // distinct accent and sits apart from the numbered maps.
    if (finalTransform) {
      this.transformList.appendChild(
        this.transformButton({
          selected: selected === "final",
          accent: "#c084fc",
          title: "✦ Final Transform",
          lines: [
            "Lens over the whole cloud",
            ...variationSummary(finalTransform),
          ],
          onClick: () => this.handlers?.onSelect("final"),
        }),
      );
    }
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
  renderTransformEditor(transform: Transform | null, target: EditTarget): void {
    if (!transform || target === null) {
      this.transformEditor.replaceChildren();
      this.editor = null;
      return;
    }
    if (!this.editor || this.editor.target !== target) {
      this.buildEditor(transform, target);
    } else {
      this.syncEditor(transform);
    }
  }

  private buildEditor(transform: Transform, target: number | "final"): void {
    this.transformEditor.replaceChildren();

    const heading = this.doc.createElement("h3");
    heading.textContent =
      target === "final" ? "Final Transform" : `Edit Transform ${target + 1}`;
    this.transformEditor.appendChild(heading);

    const geometry = {
      position: clone3(transform.position),
      rotation: clone3(transform.rotation),
      scale: clone3(transform.scale),
      shear: clone3(transform.shear ?? [0, 0, 0]),
      weight: transform.weight ?? 1,
    };
    const controls: Record<Channel, AxisControl[]> = {
      position: [],
      rotation: [],
      scale: [],
      shear: [],
    };

    for (const channel of CHANNEL_ORDER) {
      const spec = CHANNELS[channel];
      const group = this.doc.createElement("div");
      group.className = "editor-group";

      const title = this.doc.createElement("div");
      title.className = "editor-group-title";
      title.textContent = spec.title;
      group.appendChild(title);

      const axisLabels = spec.axisLabels ?? AXES;
      axisLabels.forEach((axisLabel, axis) => {
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

    // The selection weight is meaningless for a lens applied to every point, so
    // the final transform's editor omits it.
    const weightControl =
      target === "final" ? null : this.buildWeightControl(geometry.weight);
    const { list, add } = this.buildVariationsGroup();

    this.editor = {
      target,
      geometry,
      controls,
      weightControl,
      variations: (transform.variations ?? []).map((v) => ({ ...v })),
      variationList: list,
      variationAdd: add,
    };
    this.renderVariationRows();
    this.refreshAddOptions();
  }

  /** Build the single-value weight control in its own group below the axes. */
  private buildWeightControl(weight: number): AxisControl {
    const group = this.doc.createElement("div");
    group.className = "editor-group";

    const title = this.doc.createElement("div");
    title.className = "editor-group-title";
    title.textContent = "Weight";
    group.appendChild(title);

    const row = this.doc.createElement("div");
    row.className = "editor-row";

    const name = this.doc.createElement("span");
    name.className = "axis";
    name.textContent = "×";

    const slider = this.doc.createElement("input");
    slider.type = "range";
    slider.min = String(weightToSlider(WEIGHT_MIN));
    slider.max = String(weightToSlider(WEIGHT_MAX));
    slider.step = "0.01";
    slider.value = String(weightToSlider(weight));
    slider.setAttribute("aria-label", "Weight");

    const readout = this.doc.createElement("span");
    readout.className = "value";
    readout.textContent = weight.toFixed(2);

    slider.addEventListener("input", () =>
      this.onWeightInput(Number(slider.value)),
    );

    row.append(name, slider, readout);
    group.appendChild(row);
    this.transformEditor.appendChild(group);

    return { slider, readout };
  }

  /**
   * Build the "Variations" group: a title, the (initially empty) row list, and
   * the add-variation dropdown. Rows themselves are filled by
   * {@link renderVariationRows} once the editor state exists.
   */
  private buildVariationsGroup(): {
    list: HTMLElement;
    add: HTMLSelectElement;
  } {
    const group = this.doc.createElement("div");
    group.className = "editor-group";

    const title = this.doc.createElement("div");
    title.className = "editor-group-title";
    title.textContent = "Variations";
    group.appendChild(title);

    const list = this.doc.createElement("div");
    list.className = "variation-list";
    group.appendChild(list);

    // Acts as a one-shot action like the preset menu: pick a type to add it,
    // then snap back to the placeholder.
    const add = this.doc.createElement("select");
    add.className = "variation-add";
    add.setAttribute("aria-label", "Add variation");
    add.addEventListener("change", () => {
      const type = add.value;
      add.value = "";
      if (type) this.addVariation(type as VariationType);
    });
    group.appendChild(add);

    this.transformEditor.appendChild(group);
    return { list, add };
  }

  /** Rebuild the variation rows from `editor.variations` (called on add/remove). */
  private renderVariationRows(): void {
    const editor = this.editor;
    if (!editor) return;
    editor.variationList.replaceChildren();
    editor.variations.forEach((variation, i) => {
      const row = this.doc.createElement("div");
      row.className = "editor-row variation-row";

      const name = this.doc.createElement("span");
      name.className = "axis";
      name.textContent = variationLabel(variation.type);

      const slider = this.doc.createElement("input");
      slider.type = "range";
      slider.min = String(VARIATION_WEIGHT_MIN);
      slider.max = String(VARIATION_WEIGHT_MAX);
      slider.step = "0.05";
      slider.value = String(variation.weight);
      slider.setAttribute("aria-label", `Variation ${variation.type}`);

      const readout = this.doc.createElement("span");
      readout.className = "value";
      readout.textContent = variation.weight.toFixed(2);

      const remove = this.doc.createElement("button");
      remove.type = "button";
      remove.className = "variation-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${variation.type}`);

      slider.addEventListener("input", () => {
        const weight = Number(slider.value);
        editor.variations[i].weight = weight;
        readout.textContent = weight.toFixed(2);
        this.emitGeometry();
      });
      remove.addEventListener("click", () => this.removeVariation(i));

      row.append(name, slider, readout, remove);
      editor.variationList.appendChild(row);
    });
  }

  /** Repopulate the add-dropdown with the variation types not already applied. */
  private refreshAddOptions(): void {
    const editor = this.editor;
    if (!editor) return;
    const used = new Set(editor.variations.map((v) => v.type));
    editor.variationAdd.replaceChildren();

    const placeholder = this.doc.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Add variation…";
    editor.variationAdd.appendChild(placeholder);

    for (const type of VARIATION_TYPES) {
      if (used.has(type)) continue;
      const option = this.doc.createElement("option");
      option.value = type;
      option.textContent = variationLabel(type);
      editor.variationAdd.appendChild(option);
    }
    editor.variationAdd.value = "";
  }

  private addVariation(type: VariationType): void {
    const editor = this.editor;
    if (!editor) return;
    editor.variations.push({ type, weight: DEFAULT_VARIATION_WEIGHT });
    this.renderVariationRows();
    this.refreshAddOptions();
    this.emitGeometry();
  }

  private removeVariation(index: number): void {
    const editor = this.editor;
    if (!editor) return;
    editor.variations.splice(index, 1);
    this.renderVariationRows();
    this.refreshAddOptions();
    this.emitGeometry();
  }

  private syncEditor(transform: Transform): void {
    const editor = this.editor;
    if (!editor) return;
    editor.geometry = {
      position: clone3(transform.position),
      rotation: clone3(transform.rotation),
      scale: clone3(transform.scale),
      shear: clone3(transform.shear ?? [0, 0, 0]),
      weight: transform.weight ?? 1,
    };
    for (const channel of CHANNEL_ORDER) {
      const spec = CHANNELS[channel];
      editor.controls[channel].forEach((control, axis) => {
        const model = editor.geometry[channel][axis];
        control.slider.value = String(spec.toSlider(model));
        control.readout.textContent = spec.format(model);
      });
    }
    if (editor.weightControl) {
      const { weight } = editor.geometry;
      editor.weightControl.slider.value = String(weightToSlider(weight));
      editor.weightControl.readout.textContent = weight.toFixed(2);
    }

    // Variations rarely change under a stable selection (drags don't touch
    // them), so only rebuild the rows when they actually differ.
    const incoming = transform.variations ?? [];
    if (!variationsEqual(incoming, editor.variations)) {
      editor.variations = incoming.map((v) => ({ ...v }));
      this.renderVariationRows();
      this.refreshAddOptions();
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
    this.emitGeometry();
  }

  private onWeightInput(sliderValue: number): void {
    const editor = this.editor;
    // The weight slider only exists for a numbered transform, so its control is
    // always present when this fires; the guard just satisfies the nullable type.
    if (!editor || !editor.weightControl) return;
    const weight = sliderToWeight(sliderValue);
    editor.geometry.weight = weight;
    editor.weightControl.readout.textContent = weight.toFixed(2);
    this.emitGeometry();
  }

  /** Push the editor's current geometry back to the matching handler — the final
   * transform gets no selection weight, a regular transform does. */
  private emitGeometry(): void {
    const editor = this.editor;
    if (!editor) return;
    const base = {
      position: clone3(editor.geometry.position),
      rotation: clone3(editor.geometry.rotation),
      scale: clone3(editor.geometry.scale),
      shear: clone3(editor.geometry.shear),
      variations: editor.variations.map((v) => ({ ...v })),
    };
    if (editor.target === "final") {
      this.handlers?.onFinalTransformGeometry(base);
    } else {
      this.handlers?.onTransformGeometry(editor.target, {
        ...base,
        weight: editor.geometry.weight,
      });
    }
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
