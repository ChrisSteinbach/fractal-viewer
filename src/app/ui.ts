import { meanContraction } from "../fractal/affine4";
import { effectiveSymmetryOrder, MAX_TRANSFORMS } from "../fractal/chaos-game";
import {
  buildColorModeLUT,
  colorModeUsesGamma,
  colorModeUsesRampPalette,
  fourDColorNeedsAttribute,
  LEGACY_POSITION_AXIS_COLORS,
  transformColors,
  W_SIDE_PALETTES,
  wRampColor,
} from "../fractal/color";
import type { PositionAxisColors } from "../fractal/color";
import {
  buildPaletteLUT,
  CUSTOM_PALETTE_ID,
  hexToRgb,
  MAX_CUSTOM_PALETTE_STOPS,
  MIN_CUSTOM_PALETTE_STOPS,
  resolvePalette,
  rgbToHex,
} from "../fractal/palette";
import type {
  CustomPalette,
  PaletteSelection,
  PaletteSpec,
  RgbStop,
} from "../fractal/palette";
import { VARIATION_TYPES } from "../fractal/types";
import type {
  Transform,
  Variation,
  VariationType,
  Vec3,
  WDepthColorMode,
  WExtension,
} from "../fractal/types";
import { clone3, to255 } from "../fractal/vec";
import type { Preset } from "../fractal/presets";
import type { SavedScene } from "./collection";
import type { AppState, RenderMode } from "./state";
import {
  RENDER_MODES,
  MAX_W_ANGLE,
  MAX_W_POSITION,
  MAX_W_SCALE,
  MAX_W_SHEAR,
  MIN_W_ANGLE,
  MIN_W_POSITION,
  MIN_W_SCALE,
  MIN_W_SHEAR,
  systemIsNonFlat,
} from "./state";
import { formatIterationCount, SCALAR_CONTROLS } from "./control-spec";
import type { ScalarControlSpec } from "./control-spec";
import {
  MOBILE_BREAKPOINT,
  MIN_GUIDE_SCALE,
  MAX_GUIDE_SCALE,
} from "./constants";
import { videoCaptureSupported } from "./recorder";
import { installSliderScrollGuard } from "./slider-scroll-guard";

export type { Preset };

/** The geometry (and weight/variations) a transform editor edits. `w` is the
 * optional 4D extension (fr-bf6.3, see `types.ts`'s `WExtension`) — included
 * here so the single editor can be the one UI that creates/edits it, but see
 * {@link Ui.emitGeometry} for why it's only ever present on the emitted
 * object when the working copy actually has one. */
type Geometry = Pick<
  Transform,
  "position" | "rotation" | "scale" | "weight" | "shear" | "variations" | "w"
>;

/** The final transform's geometry — the same, minus the selection weight, which
 * is meaningless for a map applied to every point. */
type FinalGeometry = Omit<Geometry, "weight">;

/** The current edit target: a transform index, the final transform, or none. */
type EditTarget = number | "final" | null;

export interface UiHandlers {
  onAdd: () => void;
  onRemove: () => void;
  /** Step the scene document back one edit burst. */
  onUndo: () => void;
  /** Step the scene document forward one edit burst. */
  onRedo: () => void;
  onPreset: (preset: Preset) => void;
  /** "Surprise Me" was clicked: roll a fresh random IFS and load it like a preset. */
  onSurprise: () => void;
  /** "▶ Drift" was clicked: toggle the ambient drift show (fr-wavo) —
   * session-only, like the auto-orbit/tumble motion; main.ts owns the policy. */
  onDriftToggle: () => void;
  /**
   * A table-driven scalar control changed (see control-spec.ts's
   * SCALAR_CONTROLS): `raw` is the element's `value` string (range/select)
   * or `checked` flag (checkbox), applied via `applyScalarControl`.
   * Per-control semantics — which edits restart accumulation, which are
   * live-reactive, which forward to a render worker — are documented on the
   * spec entries themselves.
   *
   * `phase` (fr-2c27) distinguishes the live "input" stream (fired on every
   * tick while a range drags, or once for a select/checkbox's own change)
   * from a range spec's trailing "commit" — fired once on release for specs
   * that declare `ValueControlSpec.commit`, alongside (not instead of) the
   * ordinary input events the drag already sent. Defaults to "input" so
   * every other call site is unaffected.
   */
  onScalarControl: (
    spec: ScalarControlSpec,
    raw: string | boolean,
    phase?: "input" | "commit",
  ) => void;
  onRegenerate: () => void;
  onSavePng: () => void;
  onRecordVideoToggle: () => void;
  /** "★ Save to collection" was clicked: snapshot the current scene into the
   * saved-scene collection (fr-cai). */
  onSaveToCollection: () => void;
  /** "▦ Gallery" was clicked: open the saved-scene gallery modal. The app
   * hands the current collection back via {@link Ui.openGallery}. */
  onOpenGallery: () => void;
  /** The gallery modal's "▶ Drift collection" was clicked: start the drift
   * show over the saved collection instead of random rolls (fr-w2ve) —
   * main.ts owns the playlist policy, like onDriftToggle. */
  onDriftCollection: () => void;
  /** A gallery thumbnail was clicked: load that saved scene by its id
   * (whole-system replacement, like a preset load). */
  onLoadFromCollection: (id: string) => void;
  /** A gallery card's ✕ was clicked: delete that saved scene by its id. */
  onDeleteFromCollection: (id: string) => void;
  /** "🔗 Copy link" was clicked: copy a shareable URL of the current scene. */
  onCopyLink: () => void;
  onSelect: (index: EditTarget) => void;
  /** A panel slider edited the selected transform's geometry. */
  onTransformGeometry: (index: number, geometry: Geometry) => void;
  /** The lens toggle was flipped: enable a default final transform, or clear it. */
  onToggleFinalTransform: (checked: boolean) => void;
  /** A panel slider edited the final transform's geometry. */
  onFinalTransformGeometry: (geometry: FinalGeometry) => void;
  onTogglePanel: () => void;
  onClosePanel: () => void;
  /**
   * A render-mode segment was clicked (fr-39y): switch which renderer
   * displays the attractor — `"points"` returns to the live explorer,
   * `"flame"` freezes the camera and starts a flame render, `"solid"` starts
   * accumulating the density volume (camera stays live). Fires for the
   * already-active segment too; the app treats that as a no-op.
   */
  onRenderMode: (mode: RenderMode) => void;
  /** The 3D auto-orbit (fr-1yn) was paused or resumed — the camera-side
   * sibling of {@link onFourDTumbleToggle}. */
  onAutoOrbitToggle: (checked: boolean) => void;
  /** The 3D orbit-speed slider moved: `value` is the rate multiplier (×). */
  onAutoOrbitSpeedInput: (value: number) => void;
  /** The 4D soft w-slice (fr-6x2) was toggled on or off. */
  onFourDSliceToggle: (checked: boolean) => void;
  /** The 4D slice-position slider moved: `value` is the slice center in
   * signed normalized rotated-w units, [-1, 1]. */
  onFourDSliceInput: (value: number) => void;
  /** The slice-relative color option (fr-nn6) was toggled — recenter the
   * w-ramp color modes' diverging palette on the slice window. Session-only
   * view state, exactly like the slice toggle/position above. */
  onFourDSliceRelColorToggle: (checked: boolean) => void;
  /** The 4D auto-tumble was paused or resumed (fr-woc). */
  onFourDTumbleToggle: (checked: boolean) => void;
  /** The 4D tumble-speed slider moved: `value` is the rate multiplier (×). */
  onFourDTumbleSpeedInput: (value: number) => void;
  /** "▶ Watch it build" was clicked (in the About dialog or the panel):
   * replay how the chaos game accretes the current cloud, point by point. */
  onWatchBuild: () => void;
  /** The gradient editor (fr-55k) changed the custom palette's stop list —
   * a recolor, an added stop, or a removed stop; `stops` is the editor's
   * whole new list, parsed and ready for `setCustomPaletteStops`. */
  onCustomPaletteStops: (stops: RgbStop[]) => void;
  /** The position mode's axis-color pickers changed (fr-8k7) — `colors` is
   * the full x/y/z triple as parsed from the three inputs; the Reset button
   * sends the exact legacy identity (the reducer normalizes it to absent). */
  onPositionAxisColors: (colors: PositionAxisColors) => void;
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
  /**
   * Convert a slider reading back to a model value. `current` is the axis's
   * model value before this drag: the scale channel needs it to re-apply the
   * model's existing sign to the slider's magnitude-only reading (fr-lca —
   * see the Scale entry in {@link CHANNELS}), since otherwise every drag
   * would silently clear a mirror. Every other channel's slider already
   * carries the signed (or angular) model value directly, so their
   * `fromSlider` ignores the second parameter — fewer parameters than the
   * type declares is valid TypeScript.
   */
  fromSlider: (slider: number, current: number) => number;
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
// The scale sliders are magnitude-only; the sign lives on the Mirror toggles (fr-lca).
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
    toSlider: (v) => Math.abs(v),
    fromSlider: (v, current) => (current < 0 ? -v : v),
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
 * Deep-copy a transform's optional `w` extension (fr-bf6.3, see `types.ts`'s
 * `WExtension`) so the editor's mutable working copy and the transform's own
 * stored one never alias — the `w`-shaped counterpart to `clone3` for the
 * plain Vec3 channels (position/rotation/scale/shear). `undefined` in,
 * `undefined` out; only fields actually present are copied, so a sparse block
 * stays exactly as sparse in the copy.
 */
function cloneW(w: WExtension | undefined): WExtension | undefined {
  if (!w) return undefined;
  const clone: WExtension = {};
  if (w.position !== undefined) clone.position = w.position;
  if (w.scale !== undefined) clone.scale = w.scale;
  if (w.rotation) clone.rotation = { ...w.rotation };
  if (w.shear) clone.shear = { ...w.shear };
  return clone;
}

/** The three w-mixing planes shared by `WExtension.rotation`/`.shear` (see
 * `types.ts`'s `Rotation4`/`Shear4`), in the 4D group's row order. One array
 * drives both the Rotation W and Shear W row-builders below since the two
 * genuinely share the same three plane keys. */
const W_PLANES = ["xw", "yw", "zw"] as const;
const W_PLANE_LABELS = ["XW", "YW", "ZW"];

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

/** The list row's scale line: one number while uniform, the full triple
 * once any axis differs — an anisotropic or mirrored scale (fr-lca) would
 * otherwise masquerade as a plain uniform contraction. */
function scaleSummary(scale: Vec3): string {
  const [x, y, z] = scale;
  if (x === y && y === z) return x.toFixed(2);
  return `[${scale.map((v) => v.toFixed(2)).join(", ")}]`;
}

/**
 * Number of evenly spaced samples used to build the legend's LUT-sampled
 * gradients (fr-dsz): the colorMode ramps and, since fr-a3q, the palette
 * strips — more than a coarse 8-stop bar so a non-1 `colorGamma` curve
 * (fr-8sk) still reads accurately in the legend, not just at its two
 * (always-fixed) endpoints.
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
 * Sample a 256-entry-per-channel RGB LUT into a CSS `linear-gradient` string
 * — shared by the colorMode ramps ({@link legendGradient}) and, since
 * fr-a3q, the palette strips (see {@link buildPaletteLUT}): both renderers'
 * hot loops index the very same LUTs, so sampling them here too is what
 * keeps the legend from ever drifting off the rendered colors.
 */
function lutGradient(lut: Float32Array): string {
  const stops: string[] = [];
  for (let i = 0; i < LEGEND_GRADIENT_STOPS; i++) {
    const lutIndex = Math.round((i / (LEGEND_GRADIENT_STOPS - 1)) * 255);
    const o = lutIndex * 3;
    stops.push(cssRgb(lut[o], lut[o + 1], lut[o + 2]));
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/**
 * Build the legend's CSS `linear-gradient` for the height/radius color modes
 * by sampling {@link buildColorModeLUT} — the same lookup table the solid
 * render's hot loop uses, so the legend bar can never drift from the actual
 * ramp (or from the current color-contrast setting). Since fr-3b6 the
 * height/radius legend also samples the same rampPalette-aware LUT the
 * renders use (`rampPalette` defaults to `"legacy"`, the built-in ramp), so a
 * gradient-driven ramp legend can't drift either.
 */
function legendGradient(
  mode: "height" | "radius",
  colorGamma: number,
  rampPalette: PaletteSpec = "legacy",
): string {
  return lutGradient(buildColorModeLUT(mode, colorGamma, rampPalette));
}

/**
 * Stops in the 4D legend's diverging w ramp. Unlike the LUT gradients this
 * count must be ODD so `s = 0` lands exactly on a stop: the ramp's defining
 * feature is the dim desaturated notch at w = 0, and with an even count CSS's
 * linear interpolation would bridge straight over it. 33 (~4px per stop on
 * the 140px bar) also keeps the steep `|s|^0.6` sides honest, where 16 stops
 * would visibly overshoot the curve.
 */
const W_RAMP_STOPS = 33;

/**
 * Build a 4D projection legend gradient (fr-a3q): the diverging signed-w
 * palette that `FOUR_D_VERTEX` (scene.ts) computes in the shader, reproduced
 * stop-for-stop by calling `color.ts`'s {@link wRampColor} — the CPU twin of
 * that in-shader ramp — so the legend can't drift from the render. Since
 * fr-3o2 both draw the ramp's SHAPE from `wRampColor`'s `W_RAMP_*` constants
 * and (since fr-d47) the side pair from `W_SIDE_PALETTES`: the same can't-drift
 * fidelity bar the colorMode legend sets by sampling `buildColorModeLUT`. Two
 * deliberate differences from the coordinate ramps: it is signed (diverging
 * around w = 0, our own 3-space), and it does NOT respond to `colorGamma` —
 * the shader never applies it. Since fr-9bk the shader normalizes by the
 * bounds box's w-support at the CURRENT tumble rotation, so the strip's ends
 * mean "the cloud's current w extremes", not fixed w values — which is why the
 * legend labels the ends with signs, not numbers.
 */
function wRampGradient(neg: Vec3, pos: Vec3): string {
  const side = { neg, pos };
  const stops: string[] = [];
  for (let i = 0; i < W_RAMP_STOPS; i++) {
    const s = (i / (W_RAMP_STOPS - 1)) * 2 - 1;
    const [r, g, b] = wRampColor(s, side);
    stops.push(cssRgb(r, g, b));
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/** One prebuilt legend gradient per w-depth palette — the ramps are fixed, so
 * they're computed once at module load like the old single W_RAMP_GRADIENT. */
const W_RAMP_GRADIENTS: Record<WDepthColorMode, string> = {
  wBlueOrange: wRampGradient(
    W_SIDE_PALETTES.wBlueOrange.neg,
    W_SIDE_PALETTES.wBlueOrange.pos,
  ),
  wPurpleGreen: wRampGradient(
    W_SIDE_PALETTES.wPurpleGreen.neg,
    W_SIDE_PALETTES.wPurpleGreen.pos,
  ),
  wCyanMagenta: wRampGradient(
    W_SIDE_PALETTES.wCyanMagenta.neg,
    W_SIDE_PALETTES.wCyanMagenta.pos,
  ),
};

/**
 * The human-readable name for a palette id, read from the panel `<select>`
 * that picked it — index.html's option labels are the app's single source of
 * palette display names (ui.test.ts pins the option values to
 * `FLAME_PALETTE_IDS`), so the legend reuses them instead of introducing a
 * second copy that could drift. Falls back to the raw id if the option is
 * ever missing — which today also covers the `"custom"` sentinel (fr-55k),
 * until index.html carries a Custom `<option>` of its own (a later change).
 */
function paletteDisplayName(
  select: HTMLSelectElement,
  id: PaletteSelection,
): string {
  for (const option of Array.from(select.options)) {
    if (option.value === id) return (option.textContent ?? "").trim() || id;
  }
  return id;
}

interface AxisControl {
  slider: HTMLInputElement;
  readout: HTMLElement;
}

/**
 * Live handles into the collapsed "4D" group's eight rows (fr-bf6.3) — one
 * per {@link WExtension} field, since unlike the plain Vec3 channels each
 * binds to an independently-optional field rather than a shared indexed
 * array. Rotation/Shear W hold their XW/YW/ZW rows in that order.
 */
interface FourDControls {
  positionW: AxisControl;
  scaleW: AxisControl;
  /** The Scale W group's mirror toggle (fr-icy): pressed ⇔ the explicit
   * `w.scale` is negative. Never pressed while auto — the derived mean is
   * always positive. */
  mirrorW: HTMLButtonElement;
  rotationW: AxisControl[];
  shearW: AxisControl[];
}

/** One toggle in a {@link Ui.buildMirrorRow} "Mirror" row. */
interface MirrorToggleSpec {
  /** Button text, e.g. "X" or "W". */
  label: string;
  /** Accessible name, e.g. "Mirror Scale X" / "Mirror Scale W". */
  ariaLabel: string;
  /** Initial pressed state: whether the component is currently negative. */
  pressed: boolean;
  onToggle: () => void;
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
    /** Working copy of the transform's optional 4D extension (fr-bf6.3);
     * `undefined` exactly when the transform has none AND the user hasn't
     * touched the 4D group yet — see {@link Ui.mutateW}/{@link Ui.emitGeometry}. */
    w: WExtension | undefined;
  };
  controls: Record<Channel, AxisControl[]>;
  /** The Scale group's per-axis mirror toggles (fr-lca): pressed ⇔ that
   * axis's scale is negative (a reflection). */
  mirror: HTMLButtonElement[];
  /** The selection-weight control, or `null` for the final transform (no weight). */
  weightControl: AxisControl | null;
  /** Working copy of the transform's variation blend, edited in place. */
  variations: Variation[];
  /** Container the variation rows are (re)built into on add/remove. */
  variationList: HTMLElement;
  /** The "add variation" dropdown, whose options exclude already-added types. */
  variationAdd: HTMLSelectElement;
  /** The collapsed "4D" group's row controls (fr-bf6.3) — always built,
   * whether or not this transform currently carries a `w` block. */
  fourD: FourDControls;
}

/** How long a plain {@link Ui.flashToast} confirmation stays on screen. */
const TOAST_DURATION_MS = 1800;

/** How long a {@link Ui.flashToast} carrying an {@link ToastAction} stays on
 * screen (fr-ifts) — longer than a plain confirmation's {@link
 * TOAST_DURATION_MS} so there's time to notice the action and react, not
 * just read the message. */
const TOAST_ACTION_DURATION_MS = 6000;

/** An optional call-to-action rendered inside a {@link Ui.flashToast} — e.g.
 * "Undo" after a destructive delete (fr-ifts). Clicking it runs `onAction`
 * and hides the toast immediately, without waiting for the auto-hide timer. */
interface ToastAction {
  label: string;
  onAction: () => void;
}

/**
 * Compact "Jul 9, 14:32" label for a saved scene's `createdAt`, used as the
 * gallery card caption and its accessible name. Locale-formatted (the browser's
 * own month names / time format), so no hand-rolled date strings to maintain.
 */
function galleryTimestamp(ms: number): string {
  const date = new Date(ms);
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day}, ${time}`;
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
  /** The panel's own heading. Since fr-bf6 the system's dimensionality is a
   * live property, so the title tells the truth per generation — "3D IFS
   * Fractal" for a flat system, "4D IFS Fractal" once any map's `w`
   * extension is in play (fr-9uw). */
  private readonly panelTitle: HTMLElement;
  private readonly helpText: HTMLElement;
  private readonly pointCount: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly legendBar: HTMLElement;
  private readonly legendLabels: HTMLElement;
  private readonly legendLabelLow: HTMLElement;
  private readonly legendLabelMid: HTMLElement;
  private readonly legendLabelHigh: HTMLElement;
  private readonly legendSwatches: HTMLElement;
  /** While true, {@link updateLegend} shows the by-transform swatch strip
   * regardless of the state's color mode — the "Watch it build" showcase's
   * display-only recolor (fr-hpci). Set/cleared by main.ts as the showcase
   * arms/disarms, each followed by an updateLabels sync. */
  private replayShowcaseLegend = false;
  private readonly menuToggle: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly transformCount: HTMLElement;
  private readonly transformList: HTMLElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly removeBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly presetSelect: HTMLSelectElement;
  private readonly surpriseBtn: HTMLButtonElement;
  private readonly driftBtn: HTMLButtonElement;
  private readonly driftTitle: string;
  private readonly regenerateBtn: HTMLButtonElement;
  private readonly savePngBtn: HTMLButtonElement;
  private readonly recordVideoBtn: HTMLButtonElement;

  // Saved-scene collection (fr-cai): the panel's Save/Gallery/Copy-link
  // buttons, the gallery-count readout, and the gallery modal + its parts.
  private readonly saveCollectionBtn: HTMLButtonElement;
  private readonly galleryBtn: HTMLButtonElement;
  private readonly copyLinkBtn: HTMLButtonElement;
  private readonly collectionCount: HTMLElement;
  private readonly galleryModal: HTMLElement;
  private readonly galleryBackdrop: HTMLElement;
  private readonly galleryCloseBtn: HTMLButtonElement;
  private readonly galleryDriftBtn: HTMLButtonElement;
  private readonly galleryDriftTitle: string;
  private readonly galleryGrid: HTMLElement;
  private readonly galleryEmpty: HTMLElement;
  /** Inputs to the "▶ Drift collection" disabled state, remembered so either
   * one changing (reduced motion via {@link setDriftAvailable}, emptiness via
   * {@link renderGallery}) can re-derive it — see syncGalleryDriftBtn. */
  private driftAvailable = true;
  private gallerySceneCount = 0;
  private readonly toast: HTMLElement;

  // "What is this?" About dialog (fr-1zb): mirrors the gallery modal's own
  // shape (open button, backdrop, close button). aboutWatchBtn and
  // watchBuildBtn are the two "▶ Watch it build" entry points — the About
  // dialog and the Appearance panel — both firing the same onWatchBuild
  // handler; replayCaption is the narration pill main.ts drives during the
  // replay via setReplayCaption.
  private readonly aboutBtn: HTMLButtonElement;
  private readonly aboutModal: HTMLElement;
  private readonly aboutBackdrop: HTMLElement;
  private readonly aboutCloseBtn: HTMLButtonElement;
  private readonly aboutWatchBtn: HTMLButtonElement;
  private readonly watchBuildBtn: HTMLButtonElement;
  private readonly replayCaption: HTMLElement;

  private readonly glowBrightnessRow: HTMLElement;
  private readonly colorGammaRow: HTMLElement;
  private readonly rampPaletteRow: HTMLElement;
  private readonly positionColorsRow: HTMLElement;
  private readonly positionAxisInputs: {
    x: HTMLInputElement;
    y: HTMLInputElement;
    z: HTMLInputElement;
  };
  private readonly positionColorsResetBtn: HTMLElement;
  private readonly symmetryNote: HTMLElement;
  private readonly finalTransformToggle: HTMLInputElement;
  private readonly transformEditor: HTMLElement;

  private readonly explorerControls: HTMLElement;
  /** The render-mode segmented control's three buttons (fr-39y), keyed by the
   * mode each one switches to — the single entry/exit surface that replaced
   * the flame/solid modal islands' four separate buttons. */
  private readonly modeButtons: Record<RenderMode, HTMLButtonElement>;
  // The mode-scoped blocks that are NOT part of any accordion section
  // (fr-374p): Points' Undo/Redo row and the flame/solid hint + progress
  // status blocks. They sit above ALL the sections in index.html — floating
  // content wedged between two collapsed section headers reads as the open
  // content of the header above it — and each shows/hides with its render
  // mode exactly like the section containers below.
  private readonly undoRedoRow: HTMLElement;
  private readonly flameStatus: HTMLElement;
  private readonly solidStatus: HTMLElement;
  private readonly flameControls: HTMLElement;
  private readonly flameSupersampleNote: HTMLElement;
  private readonly flameBackendNote: HTMLElement;
  private readonly flameProgress: HTMLElement;

  private readonly solidControls: HTMLElement;
  private readonly solidResolutionNote: HTMLElement;
  private readonly solidProgress: HTMLElement;

  // 3D VIEW controls (fr-1yn): the auto-orbit turntable — the 3D sibling of
  // the 4D auto-tumble below, same session-only checkbox + speed-row pattern,
  // shown exactly when the 4D block is not (flat system, no render active).
  private readonly threeDControls: HTMLElement;
  private readonly autoOrbitToggle: HTMLInputElement;
  private readonly autoOrbitRow: HTMLElement;
  private readonly autoOrbitSpeedSlider: HTMLInputElement;
  private readonly autoOrbitSpeedLabel: HTMLElement;

  // 4D VIEW controls (fr-cbg/fr-woc/fr-6x2). "4D" is a DERIVED property of the
  // system now (fr-bf6, see affine4.ts's systemIsFlat/state.ts's
  // systemIsNonFlat) rather than a mode with its own entry/exit button, so only
  // the tumble/slice block remains here; its visibility (and the sub-blocks
  // that hide alongside it — see updateLabels) is a VIEW gate keyed on that
  // same non-flatness, not a separate on/off the user toggles.
  private readonly fourDControls: HTMLElement;
  private readonly fourDSliceToggle: HTMLInputElement;
  private readonly fourDSliceRow: HTMLElement;
  private readonly fourDSliceSlider: HTMLInputElement;
  private readonly fourDSliceLabel: HTMLElement;
  // Slice-relative color (fr-nn6): lives inside fourDSliceRow (so it hides
  // with the slice), with its own row element hidden for the baked fr-d47
  // modes — the remap only touches the w-ramp palettes (see updateLabels).
  private readonly fourDSliceRelColorToggle: HTMLInputElement;
  private readonly fourDSliceRelColorRow: HTMLElement;
  // Auto-tumble pause/resume + speed (fr-woc): same session-only pattern as
  // the slice controls above.
  private readonly fourDTumbleToggle: HTMLInputElement;
  private readonly fourDTumbleRow: HTMLElement;
  private readonly fourDTumbleSpeedSlider: HTMLInputElement;
  private readonly fourDTumbleSpeedLabel: HTMLElement;
  private readonly colorModeRow: HTMLElement;
  /** The 4D Color select's wrapper — {@link colorModeRow}'s non-flat sibling
   * in the Appearance section: exactly one of the pair shows, and
   * `#rampPaletteRow` sits statically beneath them (fr-15g; the fr-6ue
   * gate/gated co-location with no DOM re-homing). */
  private readonly fourDColorRow: HTMLElement;
  /** The 4D depth-fade toggle's wrapper — renderStyleRow's non-flat sibling
   * in the Appearance section (fr-15g). */
  private readonly fourDDepthFadeRow: HTMLElement;
  private readonly renderStyleRow: HTMLElement;
  private readonly symmetrySection: HTMLElement;

  /**
   * The table-driven scalar controls (see control-spec.ts's SCALAR_CONTROLS),
   * bound to their live elements once in the constructor — replacing the old
   * per-control element fields. The constructor loop throws on any missing
   * element (via {@link byId}), so ui.test.ts's index.html coverage test
   * still guards every table id.
   */
  private readonly scalars = new Map<
    string,
    {
      spec: ScalarControlSpec;
      input: HTMLInputElement | HTMLSelectElement;
      label: HTMLElement | null;
    }
  >();

  /** The gradient-stop editor rows shown under the flame/solid/ramp palette
   * `<select>`s once set to Custom (fr-55k; the ramp row since fr-3b6): a
   * live gradient strip preview, one `<input type="color">` per stop, and the
   * add/remove-stop buttons. All three editors read/write the SAME shared
   * `AppState.customPalette` slot (see {@link syncCustomPaletteEditors}) —
   * only which row is visible differs, keyed on that palette select's own
   * paletteId (flame/solid) or `rampPaletteId` (ramp). */
  private readonly customPaletteEditors: Record<
    "flame" | "solid" | "ramp",
    {
      row: HTMLElement;
      strip: HTMLElement;
      stops: HTMLElement;
      add: HTMLButtonElement;
      remove: HTMLButtonElement;
    }
  >;

  /** Which accordion section is open, remembered per render mode (fr-99o) so
   * switching Points ↔ Flame ↔ Solid restores each mode's working section
   * instead of landing on an all-collapsed panel. `""` = the user
   * deliberately collapsed everything in that mode. Session-only, like
   * `renderMode` itself. */
  private readonly openSectionByMode: Record<RenderMode, string> = {
    points: "presetSection",
    flame: "flameToneSection",
    solid: "solidSurfaceSection",
  };

  /** The render mode {@link updateLabels} last saw — its change is what
   * triggers the accordion restore above. */
  private sectionMode: RenderMode = "points";

  private editor: EditorState | null = null;

  /** Pending {@link flashToast} auto-hide, cleared/rearmed on each toast. */
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  /** Escape-to-close for the gallery, attached to the document only while the
   * modal is open (see {@link openGallery}/{@link closeGallery}) so it never
   * lingers or double-binds. An arrow field so add/removeEventListener share
   * one stable reference. */
  private readonly onGalleryKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.closeGallery();
  };

  /** Escape-to-close for the About dialog (fr-1zb), the same
   * attached-only-while-open discipline as {@link onGalleryKeydown}. */
  private readonly onAboutKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.closeAbout();
  };

  constructor(doc: Document = document) {
    this.doc = doc;
    this.helpTitle = this.byId("helpTitle");
    this.panelTitle = this.byId("panelTitle");
    this.helpText = this.byId("helpText");
    this.pointCount = this.byId("pointCount");
    this.legend = this.byId("legend");
    this.legendBar = this.byId("legendBar");
    this.legendLabels = this.byId("legendLabels");
    this.legendLabelLow = this.byId("legendLabelLow");
    this.legendLabelMid = this.byId("legendLabelMid");
    this.legendLabelHigh = this.byId("legendLabelHigh");
    this.legendSwatches = this.byId("legendSwatches");
    this.menuToggle = this.byId("menuToggle");
    this.backdrop = this.byId("backdrop");
    this.panel = this.byId("panel");
    this.transformCount = this.byId("transformCount");
    this.transformList = this.byId("transformList");
    this.addBtn = this.byId("addBtn");
    this.removeBtn = this.byId("removeBtn");
    this.undoBtn = this.byId("undoBtn");
    this.redoBtn = this.byId("redoBtn");
    this.presetSelect = this.byId("presetSelect");
    this.surpriseBtn = this.byId("surpriseBtn");
    this.driftBtn = this.byId("driftBtn");
    this.driftTitle = this.driftBtn.title;
    this.regenerateBtn = this.byId("regenerateBtn");
    this.savePngBtn = this.byId("savePngBtn");
    this.recordVideoBtn = this.byId("recordVideoBtn");
    this.recordVideoBtn.classList.toggle("hidden", !videoCaptureSupported());
    this.saveCollectionBtn = this.byId("saveCollectionBtn");
    this.galleryBtn = this.byId("galleryBtn");
    this.copyLinkBtn = this.byId("copyLinkBtn");
    this.collectionCount = this.byId("collectionCount");
    this.galleryModal = this.byId("galleryModal");
    this.galleryBackdrop = this.byId("galleryBackdrop");
    this.galleryCloseBtn = this.byId("galleryCloseBtn");
    this.galleryDriftBtn = this.byId("galleryDriftBtn");
    this.galleryDriftTitle = this.galleryDriftBtn.title;
    this.galleryGrid = this.byId("galleryGrid");
    this.galleryEmpty = this.byId("galleryEmpty");
    this.toast = this.byId("toast");
    this.aboutBtn = this.byId("aboutBtn");
    this.aboutModal = this.byId("aboutModal");
    this.aboutBackdrop = this.byId("aboutBackdrop");
    this.aboutCloseBtn = this.byId("aboutCloseBtn");
    this.aboutWatchBtn = this.byId("aboutWatchBtn");
    this.watchBuildBtn = this.byId("watchBuildBtn");
    this.replayCaption = this.byId("replayCaption");
    this.glowBrightnessRow = this.byId("glowBrightnessRow");
    this.colorGammaRow = this.byId("colorGammaRow");
    this.rampPaletteRow = this.byId("rampPaletteRow");
    this.positionColorsRow = this.byId("positionColorsRow");
    this.positionAxisInputs = {
      x: this.byId("positionAxisX"),
      y: this.byId("positionAxisY"),
      z: this.byId("positionAxisZ"),
    };
    this.positionColorsResetBtn = this.byId("positionColorsReset");
    this.symmetryNote = this.byId("symmetryNote");
    this.finalTransformToggle = this.byId("finalTransformToggle");
    this.transformEditor = this.byId("transformEditor");
    this.explorerControls = this.byId("explorerControls");
    this.modeButtons = {
      points: this.byId("modePointsBtn"),
      flame: this.byId("modeFlameBtn"),
      solid: this.byId("modeSolidBtn"),
    };
    this.undoRedoRow = this.byId("undoRedoRow");
    this.flameStatus = this.byId("flameStatus");
    this.solidStatus = this.byId("solidStatus");
    this.flameControls = this.byId("flameControls");
    this.flameSupersampleNote = this.byId("flameSupersampleNote");
    this.flameBackendNote = this.byId("flameBackendNote");
    this.flameProgress = this.byId("flameProgress");
    this.solidControls = this.byId("solidControls");
    this.solidResolutionNote = this.byId("solidResolutionNote");
    this.solidProgress = this.byId("solidProgress");
    this.fourDControls = this.byId("fourDControls");
    this.fourDSliceToggle = this.byId("fourDSliceToggle");
    this.fourDSliceRow = this.byId("fourDSliceRow");
    this.fourDSliceSlider = this.byId("fourDSliceSlider");
    this.fourDSliceLabel = this.byId("fourDSliceLabel");
    this.fourDSliceRelColorToggle = this.byId("fourDSliceRelColorToggle");
    this.fourDSliceRelColorRow = this.byId("fourDSliceRelColorRow");
    this.threeDControls = this.byId("threeDControls");
    this.autoOrbitToggle = this.byId("autoOrbitToggle");
    this.autoOrbitRow = this.byId("autoOrbitRow");
    this.autoOrbitSpeedSlider = this.byId("autoOrbitSpeedSlider");
    this.autoOrbitSpeedLabel = this.byId("autoOrbitSpeedLabel");
    this.fourDTumbleToggle = this.byId("fourDTumbleToggle");
    this.fourDTumbleRow = this.byId("fourDTumbleRow");
    this.fourDTumbleSpeedSlider = this.byId("fourDTumbleSpeedSlider");
    this.fourDTumbleSpeedLabel = this.byId("fourDTumbleSpeedLabel");
    this.colorModeRow = this.byId("colorModeRow");
    this.fourDColorRow = this.byId("fourDColorRow");
    this.fourDDepthFadeRow = this.byId("fourDDepthFadeRow");
    this.renderStyleRow = this.byId("renderStyleRow");
    this.symmetrySection = this.byId("symmetrySection");
    for (const spec of SCALAR_CONTROLS) {
      this.scalars.set(spec.id, {
        spec,
        input: this.byId(spec.id),
        label: spec.label ? this.byId(spec.label.id) : null,
      });
    }
    this.customPaletteEditors = {
      flame: {
        row: this.byId("flameCustomPaletteRow"),
        strip: this.byId("flameCustomPaletteStrip"),
        stops: this.byId("flameCustomPaletteStops"),
        add: this.byId("flameCustomPaletteAdd"),
        remove: this.byId("flameCustomPaletteRemove"),
      },
      solid: {
        row: this.byId("solidCustomPaletteRow"),
        strip: this.byId("solidCustomPaletteStrip"),
        stops: this.byId("solidCustomPaletteStops"),
        add: this.byId("solidCustomPaletteAdd"),
        remove: this.byId("solidCustomPaletteRemove"),
      },
      ramp: {
        row: this.byId("rampCustomPaletteRow"),
        strip: this.byId("rampCustomPaletteStrip"),
        stops: this.byId("rampCustomPaletteStops"),
        add: this.byId("rampCustomPaletteAdd"),
        remove: this.byId("rampCustomPaletteRemove"),
      },
    };

    // Panel accordion (fr-zoi): the sections are exclusive-open
    // <details name="panel-section"> groups, so the browser owns which one is
    // open (plus the keyboard/AT semantics). Ui adds just two things on top:
    // the per-render-mode memory of the open section (fr-99o — recorded here,
    // restored in updateLabels), and a scroll re-anchor, because when the
    // section that just auto-closed sat ABOVE the tapped one, the collapse
    // shifts the tapped summary up — on a phone, clean out of view.
    for (const section of Array.from(
      this.panel.querySelectorAll<HTMLDetailsElement>("details.panel-section"),
    )) {
      section.addEventListener("toggle", () => {
        if (!section.open) {
          // A deliberate collapse (nothing left open) clears the mode's
          // memory; the auto-close half of an exclusive switch does not,
          // because the newly-opened section is already open in the DOM by
          // the time either element's toggle event fires.
          if (
            this.openSectionByMode[this.sectionMode] === section.id &&
            !this.panel.querySelector("details.panel-section[open]")
          ) {
            this.openSectionByMode[this.sectionMode] = "";
          }
          return;
        }
        this.openSectionByMode[this.sectionMode] = section.id;
        const summary = section.querySelector("summary");
        // jsdom implements neither requestAnimationFrame (without
        // pretendToBeVisual) nor scrollIntoView — and this is polish, not
        // correctness, so skip it quietly where it's unavailable.
        if (typeof summary?.scrollIntoView !== "function") return;
        this.doc.defaultView?.requestAnimationFrame?.(() => {
          // Re-anchor only while the panel is actually on screen (fr-dd4b).
          // This toggle also fires for PROGRAMMATIC opens — updateLabels'
          // per-mode accordion restore — which the drift show triggers on
          // every flame/solid leg with the panel closed, i.e. parked
          // off-screen at translateX(100%). scrollIntoView would then ask
          // the browser to reveal an off-screen-right element, and phone
          // browsers oblige by panning the viewport toward it (~86vw, the
          // panel's mobile width) — shoving the whole app off-screen until
          // a reload. A tap on a summary, the case this anchor exists for,
          // can only ever happen with the panel open. Checked at rAF time,
          // not toggle time: the panel could close in between.
          if (!this.panel.classList.contains("open")) return;
          summary.scrollIntoView({ block: "nearest" });
        });
      });
    }

    // A vertical scroll swipe that lands on a slider must not edit it — see
    // slider-scroll-guard.ts for the full story (fr-zoi).
    installSliderScrollGuard(this.panel);
  }

  /** The live input element behind a table-driven control, for the few spots
   * outside the generic sync that need the element itself (e.g. the legend's
   * palette display names). Throws on an unknown id — a table id typo is a
   * programming error, same contract as {@link byId}. */
  private scalarInput(id: string): HTMLInputElement | HTMLSelectElement {
    const bound = this.scalars.get(id);
    if (!bound) throw new Error(`No scalar control spec for #${id}`);
    return bound.input;
  }

  /** {@link scalarInput} narrowed to a `<select>` (for `.options` access). */
  private scalarSelect(id: string): HTMLSelectElement {
    const input = this.scalarInput(id);
    if (!(input instanceof HTMLSelectElement)) {
      throw new Error(`Scalar control #${id} is not a <select>`);
    }
    return input;
  }

  private byId<T extends HTMLElement>(id: string): T {
    const el = this.doc.getElementById(id);
    if (!el) throw new Error(`Missing required element #${id}`);
    return el as T;
  }

  /**
   * Read a gradient editor's current stop list from its `stops` container, in
   * DOM order (fr-55k) — shared by the delegated recolor listener and the
   * add/remove button handlers below, all of which need "the stops as they
   * stand right now" before computing their own edit. Returns `null` if any
   * child color input's value fails to parse, so the delegated listener can
   * ignore the whole event rather than act on a partial read; this can't
   * actually happen for a real `<input type="color">`, whose value is always
   * a well-formed `#rrggbb`.
   */
  private readCustomPaletteStops(container: HTMLElement): RgbStop[] | null {
    const stops: RgbStop[] = [];
    for (const input of Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="color"]'),
    )) {
      const stop = hexToRgb(input.value);
      if (!stop) return null;
      stops.push(stop);
    }
    return stops;
  }

  /** Read the three axis-color pickers as a PositionAxisColors, or null if any
   * fails to parse (can't happen for a real <input type="color"> — same
   * defensive contract as readCustomPaletteStops). */
  private readPositionAxisColors(): PositionAxisColors | null {
    const x = hexToRgb(this.positionAxisInputs.x.value);
    const y = hexToRgb(this.positionAxisInputs.y.value);
    const z = hexToRgb(this.positionAxisInputs.z.value);
    if (!x || !y || !z) return null;
    return { x, y, z };
  }

  bind(handlers: UiHandlers): void {
    this.handlers = handlers;
    this.menuToggle.addEventListener("click", () => handlers.onTogglePanel());
    this.backdrop.addEventListener("click", () => handlers.onClosePanel());
    this.addBtn.addEventListener("click", () => handlers.onAdd());
    this.removeBtn.addEventListener("click", () => handlers.onRemove());
    this.undoBtn.addEventListener("click", () => handlers.onUndo());
    this.redoBtn.addEventListener("click", () => handlers.onRedo());
    // The preset menu acts as a one-shot action list: fire the chosen preset,
    // then snap back to the placeholder so it never implies a persistent mode.
    this.presetSelect.addEventListener("change", () => {
      const preset = this.presetSelect.value;
      this.presetSelect.value = "";
      if (preset) handlers.onPreset(preset as Preset);
    });
    this.surpriseBtn.addEventListener("click", () => handlers.onSurprise());
    this.driftBtn.addEventListener("click", () => handlers.onDriftToggle());
    this.regenerateBtn.addEventListener("click", () => handlers.onRegenerate());
    this.savePngBtn.addEventListener("click", () => handlers.onSavePng());
    this.recordVideoBtn.addEventListener("click", () =>
      handlers.onRecordVideoToggle(),
    );
    this.saveCollectionBtn.addEventListener("click", () =>
      handlers.onSaveToCollection(),
    );
    this.galleryBtn.addEventListener("click", () => handlers.onOpenGallery());
    this.galleryDriftBtn.addEventListener("click", () =>
      handlers.onDriftCollection(),
    );
    this.copyLinkBtn.addEventListener("click", () => handlers.onCopyLink());
    // Closing the gallery is a pure view concern (no app state to update), so
    // the Ui owns it directly rather than routing through a handler — the ✕,
    // the backdrop, and Escape (bound only while open) all just closeGallery().
    this.galleryCloseBtn.addEventListener("click", () => this.closeGallery());
    this.galleryBackdrop.addEventListener("click", () => this.closeGallery());
    // The About dialog (fr-1zb) is the same kind of pure view concern:
    // opening it needs no handler (the dialog is static content), and
    // closing it mirrors the gallery's ✕/backdrop/Escape trio exactly.
    this.aboutBtn.addEventListener("click", () => this.openAbout());
    this.aboutCloseBtn.addEventListener("click", () => this.closeAbout());
    this.aboutBackdrop.addEventListener("click", () => this.closeAbout());
    // Two entry points for the same replay — the About dialog's own button
    // and the Appearance panel's — both fire the one handler.
    this.aboutWatchBtn.addEventListener("click", () => handlers.onWatchBuild());
    this.watchBuildBtn.addEventListener("click", () => handlers.onWatchBuild());
    // Every table-driven scalar control (see control-spec.ts) shares one
    // listener shape: read the element's raw value/checked and hand it, with
    // its spec, to the app's single scalar pipeline. Sliders report "input"
    // (live while dragging); selects and checkboxes report "change".
    for (const { spec, input } of this.scalars.values()) {
      const event = spec.kind === "range" ? "input" : "change";
      input.addEventListener(event, () =>
        handlers.onScalarControl(
          spec,
          spec.kind === "checkbox" && input instanceof HTMLInputElement
            ? input.checked
            : input.value,
        ),
      );
      // Commit-on-release (fr-2c27): a range spec that declares `commit`
      // ALSO gets the trailing "change" event a range input fires once the
      // drag ends — reported as the "commit" phase, on top of (not instead
      // of) the "input" listener above, which already covered every tick
      // during the drag itself.
      if (spec.kind === "range" && spec.commit) {
        input.addEventListener("change", () =>
          handlers.onScalarControl(spec, input.value, "commit"),
        );
      }
    }
    this.finalTransformToggle.addEventListener("change", () =>
      handlers.onToggleFinalTransform(this.finalTransformToggle.checked),
    );
    for (const mode of RENDER_MODES) {
      this.modeButtons[mode].addEventListener("click", () =>
        handlers.onRenderMode(mode),
      );
    }
    this.autoOrbitToggle.addEventListener("change", () => {
      const on = this.autoOrbitToggle.checked;
      // Same "row hides with its toggle" pattern as the 4D tumble below
      // (orbit state is session-only and never enters AppState).
      this.autoOrbitRow.classList.toggle("hidden", !on);
      handlers.onAutoOrbitToggle(on);
    });
    this.autoOrbitSpeedSlider.addEventListener("input", () => {
      const value = Number(this.autoOrbitSpeedSlider.value);
      this.autoOrbitSpeedLabel.textContent = `${value.toFixed(1)}×`;
      handlers.onAutoOrbitSpeedInput(value);
    });
    this.fourDTumbleToggle.addEventListener("change", () => {
      const on = this.fourDTumbleToggle.checked;
      // The speed slider only means anything while the tumble is running —
      // same "row hides with its toggle" pattern as the slice below (tumble
      // state is session-only and never enters AppState).
      this.fourDTumbleRow.classList.toggle("hidden", !on);
      handlers.onFourDTumbleToggle(on);
    });
    this.fourDTumbleSpeedSlider.addEventListener("input", () => {
      const value = Number(this.fourDTumbleSpeedSlider.value);
      this.fourDTumbleSpeedLabel.textContent = `${value.toFixed(1)}×`;
      handlers.onFourDTumbleSpeedInput(value);
    });
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
    this.fourDSliceRelColorToggle.addEventListener("change", () =>
      handlers.onFourDSliceRelColorToggle(
        this.fourDSliceRelColorToggle.checked,
      ),
    );
    // Custom palette gradient editor (fr-55k; the ramp row since fr-3b6): the
    // flame/solid/ramp rows share this same wiring, each against its own DOM
    // elements. The recolor listener is delegated on the `stops` container
    // (rather than bound per input) so it survives syncCustomPaletteEditors
    // rebuilding the inputs on an add/remove.
    for (const kind of ["flame", "solid", "ramp"] as const) {
      const editor = this.customPaletteEditors[kind];
      editor.stops.addEventListener("input", () => {
        const stops = this.readCustomPaletteStops(editor.stops);
        if (stops) handlers.onCustomPaletteStops(stops);
      });
      editor.add.addEventListener("click", () => {
        const stops = this.readCustomPaletteStops(editor.stops);
        if (!stops || stops.length >= MAX_CUSTOM_PALETTE_STOPS) return;
        handlers.onCustomPaletteStops([...stops, stops[stops.length - 1]]);
      });
      editor.remove.addEventListener("click", () => {
        const stops = this.readCustomPaletteStops(editor.stops);
        if (!stops || stops.length <= MIN_CUSTOM_PALETTE_STOPS) return;
        handlers.onCustomPaletteStops(stops.slice(0, -1));
      });
    }
    // Position axis colors (fr-8k7): three pickers report as one triple —
    // the app state is the triple, so a drag in any one picker re-reads all
    // three, exactly like the gradient editor reads its whole stop list.
    this.positionColorsRow.addEventListener("input", () => {
      const colors = this.readPositionAxisColors();
      if (colors) handlers.onPositionAxisColors(colors);
    });
    this.positionColorsResetBtn.addEventListener("click", () =>
      handlers.onPositionAxisColors(LEGACY_POSITION_AXIS_COLORS),
    );
  }

  /** Reset the 4D slice controls to off/centered — called on every 4D entry so
   * a slice left behind by the previous visit never silently applies. The
   * slice-relative color option (fr-nn6) resets with it: it's slice view
   * state, and the fresh-visit default is the faithful whole-cloud ramp. */
  resetFourDSlice(): void {
    this.fourDSliceToggle.checked = false;
    this.fourDSliceRow.classList.add("hidden");
    this.fourDSliceSlider.value = "0";
    this.fourDSliceLabel.textContent = "0.00";
    this.fourDSliceRelColorToggle.checked = false;
  }

  /** Reset the auto-orbit controls on every fresh visit to the 3D view — `on`
   * is false under prefers-reduced-motion (where the orbit starts paused but
   * stays available as an explicit opt-in) or when the user's sticky toggle
   * choice says so (fr-g98; mirrors {@link resetFourDTumble}). */
  resetAutoOrbit(on: boolean): void {
    this.autoOrbitToggle.checked = on;
    this.autoOrbitRow.classList.toggle("hidden", !on);
    this.autoOrbitSpeedSlider.value = "1";
    this.autoOrbitSpeedLabel.textContent = "1.0×";
  }

  /** Reset the 4D tumble controls on every 4D entry — `on` is false under
   * prefers-reduced-motion (where the tumble starts paused but stays available
   * as an explicit opt-in) or when the user's sticky toggle choice says so
   * (fr-g98). */
  resetFourDTumble(on: boolean): void {
    this.fourDTumbleToggle.checked = on;
    this.fourDTumbleRow.classList.toggle("hidden", !on);
    this.fourDTumbleSpeedSlider.value = "1";
    this.fourDTumbleSpeedLabel.textContent = "1.0×";
  }

  /** Reflect scalar state into labels, inputs, the help box, and the panel. */
  updateLabels(state: AppState): void {
    this.transformCount.textContent = String(state.transforms.length);
    this.removeBtn.disabled = state.transforms.length <= 1;
    // One table-driven sync for every scalar control (see control-spec.ts's
    // SCALAR_CONTROLS): the element's value/checked from the spec's `read`,
    // the readout text from its `label` — replacing the old per-control
    // lines. Kind discriminates the spec union; the instanceof narrows the
    // element to match (a checkbox spec is always bound to an <input>).
    for (const { spec, input, label } of this.scalars.values()) {
      if (spec.kind === "checkbox") {
        if (input instanceof HTMLInputElement) input.checked = spec.read(state);
      } else {
        input.value = spec.read(state);
      }
      if (spec.label && label) label.textContent = spec.label.text(state);
    }
    this.syncCustomPaletteEditors(state);
    // The slice-relative option (fr-nn6) only touches the w-ramp palettes, so
    // its row hides under the baked fr-d47 modes — the same single source of
    // truth (color.ts) the shader's bake-vs-uniform dispatch keys on.
    this.fourDSliceRelColorRow.classList.toggle(
      "hidden",
      fourDColorNeedsAttribute(state.fourDColor),
    );

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

    // The render-mode segmented control (fr-39y) is the panel's one fixed
    // switch between the three sibling renderers; each mode's own params
    // show beneath it. Reflect the active segment…
    for (const mode of RENDER_MODES) {
      const active = state.renderMode === mode;
      this.modeButtons[mode].classList.toggle("active", active);
      this.modeButtons[mode].setAttribute("aria-pressed", String(active));
    }
    // …and swap in the active mode's controls. A flame/solid render takes
    // over the panel — editing controls that can't affect the in-progress
    // render would just be confusing — but the segmented control itself stays,
    // so flame↔solid is a direct switch, not a round-trip through Points.
    const rendering = state.renderMode !== "points";
    // "4D" is a DERIVED property of the system (fr-bf6, see affine4.ts's
    // systemIsFlat via state.ts's systemIsNonFlat), NOT a fourth render mode —
    // so this is a VIEW gate, orthogonal to the segmented control above.
    // The presets block, transform list, and editor all STAY VISIBLE and live
    // for a non-flat system exactly as for a flat one — only the controls
    // that are genuinely meaningless while viewing the 4D shader path
    // (symmetry, color mode/contrast, depth style — none of them reach the 4D
    // projection or its own w-driven coloring) hide; their 4D look siblings
    // (the 4D Color and depth-fade rows) swap into the same Appearance slots
    // (fr-15g), and the 4D View section's tumble/slice block replaces the 3D
    // View block. All three render modes stay available while
    // non-flat (fr-5b3/fr-4wd): the flame/solid renders snapshot the frozen
    // 4D view and run their own 4D accumulators. The tumble/slice block hides
    // while a render is active for the same reason the editing controls do —
    // the view (rotor + slice) is frozen into the render's worker snapshot,
    // so its controls couldn't affect it.
    const nonFlat = systemIsNonFlat(state);
    this.panelTitle.textContent = nonFlat ? "4D IFS Fractal" : "3D IFS Fractal";
    this.explorerControls.classList.toggle("hidden", rendering);
    this.flameControls.classList.toggle("hidden", state.renderMode !== "flame");
    this.solidControls.classList.toggle("hidden", state.renderMode !== "solid");
    // …including each mode's non-section block above the accordion (fr-374p):
    // the Undo/Redo row belongs to the explorer (a mid-render undo couldn't
    // affect the frozen render, same reason the editing controls hide), and
    // the flame/solid status blocks belong to their renders.
    this.undoRedoRow.classList.toggle("hidden", rendering);
    this.flameStatus.classList.toggle("hidden", state.renderMode !== "flame");
    this.solidStatus.classList.toggle("hidden", state.renderMode !== "solid");
    this.fourDControls.classList.toggle("hidden", !nonFlat || rendering);
    // The 3D View block (auto-orbit, fr-1yn) is the flat-system counterpart of
    // the 4D block: exactly one of the two shows outside a render. It hides
    // during renders for the same frozen-view reason (the flame freezes the
    // camera outright; the solid render keeps manual gestures but animate()'s
    // early return stops the automatic motion, so the controls would be inert).
    this.threeDControls.classList.toggle("hidden", nonFlat || rendering);
    this.colorModeRow.classList.toggle("hidden", nonFlat);
    // The 4D look rows are the non-flat replacements for the color-mode and
    // depth-style rows (fr-15g): color is an Appearance concern in both
    // views, so the pair swaps in place rather than living in the 4D View
    // section (which keeps only the spatial tumble/slice controls).
    this.fourDColorRow.classList.toggle("hidden", !nonFlat);
    this.fourDDepthFadeRow.classList.toggle("hidden", !nonFlat);
    this.renderStyleRow.classList.toggle("hidden", nonFlat);
    this.symmetrySection.classList.toggle("hidden", nonFlat);
    // The manual brightness override only means anything for the glow render
    // style, so — like the flame/solid sub-panels above — it's hidden whenever
    // that style isn't the active one (and always while non-flat, since
    // renderStyle itself never reaches the 4D projection either).
    this.glowBrightnessRow.classList.toggle(
      "hidden",
      nonFlat || state.renderStyle !== "glow",
    );
    // The ramp palette only means anything for the modes that ARE a 1-D ramp:
    // the flat view's height/radius color modes (fr-3b6; narrower than the
    // contrast slider's gating, see color.ts's colorModeUsesRampPalette) and
    // the 4D projection's "By 4D Radius" mode, which follows the same
    // selection (fr-6ue). It is ONE row (select + custom-stop editor) serving
    // both views: it sits statically beneath the flat/4D color-select pair,
    // exactly one of which is visible per view (fr-15g), so it is always
    // directly under the select that gates it — the exclusive-open accordion
    // demands gate and gated share a section, and the static Appearance
    // layout satisfies that without the old DOM re-homing.
    this.rampPaletteRow.classList.toggle(
      "hidden",
      nonFlat
        ? state.fourDColor !== "radius"
        : !colorModeUsesRampPalette(state.colorMode),
    );
    // Contrast only means anything for the coordinate-normalized color modes
    // (and never while non-flat, whose color comes straight from the rotated
    // 4th coordinate in-shader instead of colorMode).
    this.colorGammaRow.classList.toggle(
      "hidden",
      nonFlat || !colorModeUsesGamma(state.colorMode),
    );
    // The axis pickers only mean anything for the position mode (and never
    // while non-flat, where colorMode itself is inert) — same gating family
    // as the contrast slider, narrower condition.
    this.positionColorsRow.classList.toggle(
      "hidden",
      nonFlat || state.colorMode !== "position",
    );
    // Sync the pickers to state — only write on change, like
    // syncCustomPaletteEditors' recolor path, so a mid-drag picker isn't
    // clobbered by its own input event's resulting state update.
    const axes = state.positionAxisColors ?? LEGACY_POSITION_AXIS_COLORS;
    for (const axis of ["x", "y", "z"] as const) {
      const hex = rgbToHex(axes[axis]);
      const input = this.positionAxisInputs[axis];
      if (input.value !== hex) input.value = hex;
    }
    // Accordion restore (fr-99o): entering a render mode re-opens the section
    // the user last had open there (defaults: Presets / Tone / Surface — see
    // openSectionByMode). Setting .open trips the details name-group
    // exclusivity, so the previous mode's section closes by itself. Runs
    // after the visibility gating above so the hidden check reads this
    // update's state, and only on an actual mode change so a collapse the
    // user makes within a mode is respected until they leave it.
    if (state.renderMode !== this.sectionMode) {
      this.sectionMode = state.renderMode;
      const remembered = this.openSectionByMode[state.renderMode];
      const target = remembered ? this.doc.getElementById(remembered) : null;
      if (
        target instanceof HTMLDetailsElement &&
        !target.classList.contains("hidden")
      ) {
        target.open = true;
      } else {
        // Nothing to restore (the user had collapsed everything here, or the
        // remembered section is gated away): close the outgoing mode's
        // section ourselves — normally the exclusivity does it — so no
        // hidden-open state lingers behind the swapped panel. The close
        // can't clear the outgoing mode's memory: the toggle handler checks
        // against the CURRENT mode, which this switch already changed.
        for (const open of Array.from(
          this.panel.querySelectorAll<HTMLDetailsElement>(
            "details.panel-section[open]",
          ),
        )) {
          open.open = false;
        }
      }
    }
    this.updateLegend(state, nonFlat);

    if (state.renderMode === "flame") {
      this.helpTitle.textContent = "Flame Render";
      this.setHelpLines(["Rendering the frozen camera view…"]);
    } else if (state.renderMode === "solid") {
      // Unlike the flame's frozen view, the solid render's volume is
      // world-space: the camera stays fully interactive while it converges.
      this.helpTitle.textContent = "Solid Render";
      this.setHelpLines(
        this.mouse
          ? ["Drag: Orbit", "Right-drag: Pan", "Scroll: Zoom"]
          : ["1 finger: Rotate", "2 fingers: Pan/Zoom"],
      );
    } else if (nonFlat) {
      // The 4D projection tumbles on its own (pause/speed in the panel); the
      // camera orbits the projected cloud exactly like camera mode, and Shift
      // retargets drag/scroll to the hidden w-planes (fr-woc) — the help box
      // is the most visible gesture surface, so the Shift line lives here as
      // well as in the panel hint. Touch has no Shift; it keeps the orbit
      // lines only. Takes priority over a transform/final-lens selection
      // (fr-bf6, unlike the OLD 4D mode's forced-null selection) — there is no
      // draggable guide box in the projection no matter which transform is
      // selected in the (still-live) list, so the canvas gesture is always
      // this one; only the panel's own editor responds to the selection.
      this.helpTitle.textContent = "4D Projection";
      this.setHelpLines(
        this.mouse
          ? [
              "Auto-tumbling 4D IFS",
              "Drag: Orbit",
              "Scroll: Zoom",
              "Shift-drag: Turn XW/YW",
              "Shift-scroll: Turn ZW",
            ]
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
    this.menuToggle.setAttribute(
      "aria-label",
      state.panelOpen ? "Close controls" : "Open controls",
    );
  }

  /**
   * Sync the flame/solid/ramp gradient-stop editors (fr-55k; the ramp row
   * since fr-3b6) to `state.customPalette`, called from {@link updateLabels}
   * right after the table-driven scalar sync loop. Three rows now: the
   * flame/solid rows show only while their OWN render's palette select is on
   * {@link CUSTOM_PALETTE_ID}; the ramp row additionally sits INSIDE
   * `#rampPaletteRow`, so the per-view ramp-mode gating {@link updateLabels}
   * applies to that container (flat: `colorModeUsesRampPalette`; non-flat:
   * `fourDColor === "radius"`, fr-6ue) composes on top of the isCustom
   * gating handled here — both must hold for the ramp editor to actually
   * show. All three edit the same shared slot (see
   * `state.ts`'s `AppState.customPalette`), so switching which one is
   * "custom" never loses an in-progress edit. The stop inputs are only
   * rebuilt when their count changes (add/remove, or a fresh seed) — an
   * ordinary recolor instead updates each input's value in place, so it
   * never clobbers a color picker mid-drag with a redundant write.
   */
  private syncCustomPaletteEditors(state: AppState): void {
    const paletteIdByKind: Record<
      "flame" | "solid" | "ramp",
      PaletteSelection
    > = {
      flame: state.flame.paletteId,
      solid: state.solid.paletteId,
      ramp: state.rampPaletteId,
    };
    for (const kind of ["flame", "solid", "ramp"] as const) {
      const editor = this.customPaletteEditors[kind];
      const isCustom = paletteIdByKind[kind] === CUSTOM_PALETTE_ID;
      editor.row.classList.toggle("hidden", !isCustom);
      if (!isCustom) continue;

      // Safe: resolvePalette always returns a CustomPalette (never a bare
      // FlamePaletteId) when the selection is CUSTOM_PALETTE_ID — see its doc.
      const resolved = resolvePalette(
        CUSTOM_PALETTE_ID,
        state.customPalette,
      ) as CustomPalette;
      const { stops } = resolved;

      const inputs = Array.from(
        editor.stops.querySelectorAll<HTMLInputElement>('input[type="color"]'),
      );
      if (inputs.length !== stops.length) {
        editor.stops.replaceChildren();
        stops.forEach((stop, i) => {
          const input = this.doc.createElement("input");
          input.type = "color";
          input.value = rgbToHex(stop);
          // The swatch is the input's whole visible face — no room for a
          // text label, so name it for assistive tech instead.
          input.setAttribute("aria-label", `Color stop ${i + 1}`);
          editor.stops.appendChild(input);
        });
      } else {
        inputs.forEach((input, i) => {
          const hex = rgbToHex(stops[i]);
          if (input.value !== hex) input.value = hex;
        });
      }

      // Safe: buildPaletteLUT only returns null for the "legacy" sentinel,
      // never for a CustomPalette payload.
      editor.strip.style.background = lutGradient(buildPaletteLUT(resolved)!);
      editor.add.disabled = stops.length >= MAX_CUSTOM_PALETTE_STOPS;
      editor.remove.disabled = stops.length <= MIN_CUSTOM_PALETTE_STOPS;
    }
  }

  setPointCount(count: number): void {
    this.pointCount.textContent = `${count.toLocaleString()} pts`;
  }

  /**
   * Reflect undo/redo availability (disabled ⇔ nothing to step to). Driven by
   * main.ts's history stacks rather than AppState — the stacks are session-only
   * and live outside the state object, like the 4D tumble clock.
   */
  setUndoRedo(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  /** Reflect recorder state on the record button; null label means idle. */
  setRecordingState(elapsedLabel: string | null): void {
    const recording = elapsedLabel !== null;
    this.recordVideoBtn.textContent = recording
      ? `■ Stop ${elapsedLabel}`
      : "● Record video";
    this.recordVideoBtn.classList.toggle("btn-ghost", !recording);
    this.recordVideoBtn.classList.toggle("btn-red", recording);
  }

  /** Reflect whether the ambient drift show is running on the Drift toggle
   * (fr-wavo): lit + "stop" affordance while active, ghost otherwise. */
  setDriftActive(on: boolean): void {
    this.driftBtn.textContent = on ? "■ Stop drifting" : "▶ Drift";
    this.driftBtn.setAttribute("aria-pressed", String(on));
    this.driftBtn.classList.toggle("btn-ghost", !on);
    this.driftBtn.classList.toggle("btn-blue", on);
  }

  /** Enable/disable the Drift toggle for the OS reduced-motion preference
   * (fr-wavo): no motion means no drift, so the button explains itself
   * instead of silently doing nothing. */
  setDriftAvailable(available: boolean): void {
    this.driftAvailable = available;
    this.syncGalleryDriftBtn();
    this.driftBtn.disabled = !available;
    this.driftBtn.title = available
      ? this.driftTitle
      : "Unavailable: your system asks for reduced motion";
  }

  /** Reflect the saved-scene count on the "▦ Gallery (N)" button (fr-cai). */
  setCollectionCount(count: number): void {
    this.collectionCount.textContent = String(count);
  }

  /** Open the gallery modal over `scenes` (newest-first) and arm Escape-to-close. */
  openGallery(scenes: SavedScene[]): void {
    this.renderGallery(scenes);
    this.galleryModal.classList.remove("hidden");
    this.doc.addEventListener("keydown", this.onGalleryKeydown);
  }

  /** Hide the gallery modal and drop its Escape listener. Idempotent. */
  closeGallery(): void {
    this.galleryModal.classList.add("hidden");
    this.doc.removeEventListener("keydown", this.onGalleryKeydown);
  }

  /** Open the "What is this?" dialog and arm Escape-to-close. */
  openAbout(): void {
    this.aboutModal.classList.remove("hidden");
    this.doc.addEventListener("keydown", this.onAboutKeydown);
  }

  /** Hide the "What is this?" dialog and drop its Escape listener. Idempotent. */
  closeAbout(): void {
    this.aboutModal.classList.add("hidden");
    this.doc.removeEventListener("keydown", this.onAboutKeydown);
  }

  /** Show the "Watch it build" narration pill, or hide it with null. */
  setReplayCaption(text: string | null): void {
    if (text === null) {
      this.replayCaption.classList.add("hidden");
      return;
    }
    this.replayCaption.textContent = text;
    this.replayCaption.classList.remove("hidden");
  }

  /**
   * (Re)build the gallery grid from `scenes` (newest-first). Called by
   * {@link openGallery} and again after a delete so the open modal refreshes
   * in place. Each card is a thumbnail "load" button with a timestamp caption
   * plus a corner ✕ delete; all DOM is built with `createElement`, never
   * `innerHTML`, so a saved `thumbnail`/`id` can never be interpreted as
   * markup (they set `img.src` / drive `textContent` only).
   */
  renderGallery(scenes: SavedScene[]): void {
    this.gallerySceneCount = scenes.length;
    this.syncGalleryDriftBtn();
    this.galleryGrid.replaceChildren();
    this.galleryEmpty.classList.toggle("hidden", scenes.length > 0);
    for (const scene of scenes) {
      this.galleryGrid.appendChild(this.galleryCard(scene));
    }
  }

  /**
   * Derive the "▶ Drift collection" button's disabled state from its two
   * remembered inputs (fr-w2ve): the drift show's reduced-motion
   * availability (shared with the panel's Drift toggle) and whether there is
   * anything saved to loop over — with a title that says which one is the
   * reason, mirroring how the Drift toggle explains itself.
   */
  private syncGalleryDriftBtn(): void {
    const empty = this.gallerySceneCount === 0;
    this.galleryDriftBtn.disabled = !this.driftAvailable || empty;
    this.galleryDriftBtn.title = !this.driftAvailable
      ? "Unavailable: your system asks for reduced motion"
      : empty
        ? "Save a system or two first — the show loops through this collection"
        : this.galleryDriftTitle;
  }

  private galleryCard(scene: SavedScene): HTMLElement {
    const label = galleryTimestamp(scene.createdAt);
    // A saved-from-a-renderer entry (fr-75sq) wears its mode on the caption
    // with the segmented control's own glyphs, so a mixed gallery reads at a
    // glance which cards are flame/solid stills. Points entries stay bare.
    const modeCaption =
      scene.mode === "flame" ? "✺ " : scene.mode === "solid" ? "◆ " : "";
    const modeAria = scene.mode === undefined ? "" : ` (${scene.mode} render)`;
    const card = this.doc.createElement("div");
    card.className = "gallery-card";

    const load = this.doc.createElement("button");
    load.type = "button";
    load.className = "gallery-card-load";
    load.setAttribute(
      "aria-label",
      `Load saved system from ${label}${modeAria}`,
    );
    load.addEventListener("click", () =>
      this.handlers?.onLoadFromCollection(scene.id),
    );

    if (scene.thumbnail) {
      const img = this.doc.createElement("img");
      img.src = scene.thumbnail;
      img.alt = "";
      img.loading = "lazy";
      load.appendChild(img);
    } else {
      // Capture failed at save time — a neutral placeholder still reads as "a
      // saved system" and stays clickable.
      const placeholder = this.doc.createElement("div");
      placeholder.className = "gallery-card-noimg";
      placeholder.textContent = "◆";
      load.appendChild(placeholder);
    }

    const caption = this.doc.createElement("div");
    caption.className = "gallery-card-caption";
    caption.textContent = `${modeCaption}${label}`;
    load.appendChild(caption);
    card.appendChild(load);

    const del = this.doc.createElement("button");
    del.type = "button";
    del.className = "gallery-card-delete";
    del.textContent = "✕";
    del.setAttribute("aria-label", `Delete saved system from ${label}`);
    // A sibling of the load button (not nested), so its click never reaches
    // the load handler — no stopPropagation needed.
    del.addEventListener("click", () =>
      this.handlers?.onDeleteFromCollection(scene.id),
    );
    card.appendChild(del);

    return card;
  }

  /**
   * Flash a brief bottom-center confirmation ("Saved to collection", "Link
   * copied"), auto-hiding after {@link TOAST_DURATION_MS} — or, given an
   * `action` (e.g. "Undo" after a destructive delete, fr-ifts), after the
   * longer {@link TOAST_ACTION_DURATION_MS} instead. Re-arming (any fresh
   * call, action or not) cancels the previous hide and rebuilds the toast's
   * content from scratch, so rapid actions don't leave it stuck or
   * flickering and a stale action button from a PRIOR toast can never
   * linger into a plain one. Clicking the action runs `onAction` and hides
   * the toast immediately, ahead of its own timer.
   */
  flashToast(message: string, action?: ToastAction): void {
    this.toast.replaceChildren(this.doc.createTextNode(message));
    if (action) this.toast.appendChild(this.buildToastActionButton(action));
    this.toast.classList.remove("hidden");
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(
      () => this.hideToast(),
      action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS,
    );
  }

  /** The `<button>` inside an action toast (see {@link flashToast}) — a
   * plain `.toast-action` element styled in style.css, built fresh per
   * flashToast call so it never outlives the toast that created it. */
  private buildToastActionButton(action: ToastAction): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      this.hideToast();
      action.onAction();
    });
    return button;
  }

  /** Hide the toast now and cancel any pending auto-hide — shared by the
   * timer's own trailing edge and the action button's immediate dismiss. */
  private hideToast(): void {
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toast.classList.add("hidden");
    this.toastTimer = null;
  }

  /**
   * Reflect the color legend (fr-dsz, fr-a3q): an unobtrusive key for what
   * the current view's colors mean. Three families, checked in priority
   * order:
   *
   * - 4D projection (non-flat system): keyed by `state.fourDColor` (fr-d47).
   *   The w-depth modes show their diverging signed-w ramp (see
   *   {@link W_RAMP_GRADIENTS}) labeled "−w" / "in our 3-space" / "+w"; the
   *   baked "transform" mode shows the same per-transform swatch strip as the
   *   3D mode of that name (identical palette); "radius" shows the 3D radius
   *   ramp's bar — gamma-neutral, since the 4D view never applies colorGamma,
   *   but rampPalette-aware since fr-6ue, exactly like the bake it keys
   *   (`buildColors4`) — labeled center/edge. `colorMode` (even "uniform")
   *   is irrelevant here.
   * - Palette-driven renders — flame always, solid with a non-"legacy"
   *   palette: the active gradient palette's strip sampled from
   *   {@link buildPaletteLUT} (the very table the render's hot loop indexes),
   *   captioned with the palette's display name. The flame "legacy" palette
   *   colors by producing transform along the orbit — no meaningful 1D ramp —
   *   so it shows no legend at all, while solid "legacy" follows
   *   colorMode/colorGamma faithfully and falls through to the family below.
   * - Otherwise the active Color Mode's key: height/radius get a gradient
   *   bar sampled from {@link buildColorModeLUT} (so it can never drift from
   *   the rendered ramp, or from the current color-contrast setting) with
   *   low/high or center/edge labels — since fr-3b6 sampling the
   *   rampPalette-aware LUT, so a gradient-driven ramp shows its own colors
   *   with the same labels; position shows its three axis colors as
   *   X/Y/Z-labeled swatches (fr-8k7); transform gets one swatch per
   *   transform; uniform hides the legend (nothing to key).
   *
   * Takes the caller's already-computed `nonFlat` (see `updateLabels`) rather
   * than recomputing `systemIsNonFlat` here, so the two never risk reading a
   * different answer within the same refresh.
   */
  private updateLegend(state: AppState, nonFlat: boolean): void {
    // The "Watch it build" showcase (fr-hpci) recolors the DISPLAY by
    // transform without touching the document, so while it is armed the
    // legend must narrate the screen, not the state: the same swatch strip
    // both views' own by-transform modes use. Folded here (not pushed from
    // main.ts once at arm time) so any updateLabels sync that runs
    // mid-replay repaints the showcase legend rather than clobbering it.
    if (this.replayShowcaseLegend) {
      this.showLegendSwatchStrip(state.transforms.length);
      return;
    }
    if (nonFlat) {
      const mode = state.fourDColor;
      if (mode === "transform") {
        this.showLegendSwatchStrip(state.transforms.length);
        return;
      }
      if (mode === "radius") {
        // The ONE radius ramp (buildColorModeLUT), over 4D distance from the
        // cloud's 4D center. Gamma-neutral: the 4D shader never applies
        // colorGamma, so the legend must not pretend it does. Since fr-6ue
        // the ramp follows rampPaletteId exactly like the 3D radius mode's —
        // the same rampPalette-aware LUT the explorer bake (buildColors4)
        // and the render workers' own 4D radius LUT sample.
        this.showLegendBar(
          legendGradient(
            "radius",
            1,
            resolvePalette(state.rampPaletteId, state.customPalette),
          ),
          "center",
          "",
          "edge",
        );
        return;
      }
      this.showLegendBar(W_RAMP_GRADIENTS[mode], "−w", "in our 3-space", "+w");
      return;
    }

    const render =
      state.renderMode === "flame"
        ? {
            paletteId: state.flame.paletteId,
            select: this.scalarSelect("flamePalette"),
          }
        : state.renderMode === "solid"
          ? {
              paletteId: state.solid.paletteId,
              select: this.scalarSelect("solidPalette"),
            }
          : null;
    if (render !== null) {
      // `buildPaletteLUT` returning null IS the "no coordinate gradient"
      // signal for "legacy" (see palette.ts) — the same discriminator the
      // renderers use, not a second string compare that could drift.
      const lut = buildPaletteLUT(
        resolvePalette(render.paletteId, state.customPalette),
      );
      if (lut !== null) {
        const name = paletteDisplayName(render.select, render.paletteId);
        this.showLegendBar(lutGradient(lut), "", `${name} palette`, "");
        return;
      }
      if (state.renderMode === "flame") {
        this.legend.classList.add("hidden");
        return;
      }
    }

    const mode = state.colorMode;
    if (mode === "uniform") {
      this.legend.classList.add("hidden");
      return;
    }
    if (mode === "height" || mode === "radius") {
      this.showLegendBar(
        legendGradient(
          mode,
          state.colorGamma,
          resolvePalette(state.rampPaletteId, state.customPalette),
        ),
        mode === "height" ? "low" : "center",
        "",
        mode === "height" ? "high" : "edge",
      );
      return;
    }
    if (mode === "transform") {
      this.showLegendSwatchStrip(state.transforms.length);
      return;
    }
    // position: the three axis colors, labeled — not a 1-D ramp.
    this.showLegendAxisSwatches(
      state.positionAxisColors ?? LEGACY_POSITION_AXIS_COLORS,
    );
  }

  /** Arm/disarm the replay showcase's legend presentation (fr-hpci) — see
   * {@link replayShowcaseLegend}. Recorded only; the caller's updateLabels
   * sync repaints. */
  setReplayShowcaseLegend(on: boolean): void {
    this.replayShowcaseLegend = on;
  }

  /** Show the legend as the per-transform swatch strip, hiding the bar
   * variant — shared by the 3D "By Transform" color mode and the 4D
   * projection's baked transform mode (fr-d47), which use the identical
   * {@link transformColors} palette. */
  private showLegendSwatchStrip(count: number): void {
    this.legend.classList.remove("hidden");
    this.legendBar.classList.add("hidden");
    this.legendLabels.classList.add("hidden");
    this.legendSwatches.classList.remove("hidden");
    this.renderLegendSwatches(count);
  }

  /** Show the legend as a gradient bar with low/mid/high labels (empty
   * strings render as blank), hiding the swatch variant — the shared shape
   * of the colorMode ramps, the palette strips, and the 4D w ramp. */
  private showLegendBar(
    gradient: string,
    low: string,
    mid: string,
    high: string,
  ): void {
    this.legend.classList.remove("hidden");
    this.legendBar.classList.remove("hidden");
    this.legendLabels.classList.remove("hidden");
    this.legendSwatches.classList.add("hidden");
    this.legendBar.style.backgroundImage = gradient;
    this.legendLabelLow.textContent = low;
    this.legendLabelMid.textContent = mid;
    this.legendLabelHigh.textContent = high;
  }

  /** Show the legend as the position mode's three axis colors, each tagged
   * with its axis letter (fr-8k7) — the live pickers' colors, so the legend
   * can never drift from the rendered mapping (the default identity reads
   * X:red Y:green Z:blue, the old "X→R Y→G Z→B" note as colors). */
  private showLegendAxisSwatches(axes: PositionAxisColors): void {
    this.legend.classList.remove("hidden");
    this.legendBar.classList.add("hidden");
    this.legendLabels.classList.add("hidden");
    this.legendSwatches.classList.remove("hidden");
    this.legendSwatches.replaceChildren();
    for (const axis of ["x", "y", "z"] as const) {
      const letter = this.doc.createElement("span");
      letter.className = "legend-more";
      letter.textContent = axis.toUpperCase();
      this.legendSwatches.appendChild(letter);
      const [r, g, b] = axes[axis];
      const swatch = this.doc.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = cssRgb(r, g, b);
      this.legendSwatches.appendChild(swatch);
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
    const done = formatIterationCount(iterationsDone);
    const budget = formatIterationCount(iterationsBudget);
    this.flameProgress.classList.remove("flame-progress-estimating");
    this.flameProgress.textContent = `${done} / ${budget} iterations (${pct}%)`;
    this.flameProgress.style.setProperty("--progress", `${pct}%`);
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

  /**
   * Which accumulation engine is driving the current flame render (fr-npb)
   * — reflects the worker's one-time-per-backend `"backend"` event (see
   * `flame-worker-core.ts`'s `FlameAccumBackend`), so a GPU render (or a
   * mid-session fallback to CPU) is visible rather than silent. `adapter`
   * is whatever label the GPU backend factory discovered (e.g. a
   * `GPUAdapterInfo` description); omitted for the CPU backend, or a GPU one
   * with no better label to offer. `detail` (fr-2w5) is a short
   * why-am-I-on-CPU annotation ("GPU failed", "WebGPU unavailable") shown
   * when the CPU backend is a FALLBACK rather than the natural choice —
   * the one-word answer that makes a field report of "it says CPU"
   * diagnosable. `null` hides the note, mirroring
   * {@link setFlameSupersampleNote}'s contract (cleared at the start of
   * every render, before the fresh worker reports its own).
   */
  setFlameBackendNote(
    backend: "gpu" | "cpu" | null,
    adapter?: string,
    detail?: string,
  ): void {
    if (backend === null) {
      this.flameBackendNote.textContent = "";
      this.flameBackendNote.classList.add("hidden");
      return;
    }
    this.flameBackendNote.textContent =
      backend === "gpu"
        ? `GPU accumulation${adapter ? ` (${adapter})` : ""}`
        : `CPU accumulation${detail ? ` — ${detail}` : ""}`;
    this.flameBackendNote.classList.remove("hidden");
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
    this.solidProgress.style.setProperty("--progress", `${pct}%`);
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
            `Scale: ${scaleSummary(t.scale)}`,
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
    heading.className = "editor-title";
    heading.textContent =
      target === "final" ? "Final Transform" : `Edit Transform ${target + 1}`;
    this.transformEditor.appendChild(heading);

    const geometry = {
      position: clone3(transform.position),
      rotation: clone3(transform.rotation),
      scale: clone3(transform.scale),
      shear: clone3(transform.shear ?? [0, 0, 0]),
      weight: transform.weight ?? 1,
      w: cloneW(transform.w),
    };
    const controls: Record<Channel, AxisControl[]> = {
      position: [],
      rotation: [],
      scale: [],
      shear: [],
    };
    let mirror: HTMLButtonElement[] = [];

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

      if (channel === "scale") {
        mirror = this.buildMirrorRow(
          group,
          AXES.map((axisLabel, axis) => ({
            label: axisLabel,
            ariaLabel: `Mirror Scale ${axisLabel}`,
            pressed: geometry.scale[axis] < 0,
            onToggle: () => this.onMirrorToggle(axis),
          })),
        );
      }

      this.transformEditor.appendChild(group);
    }

    // The selection weight is meaningless for a lens applied to every point, so
    // the final transform's editor omits it.
    const weightControl =
      target === "final" ? null : this.buildWeightControl(geometry.weight);
    const { list, add } = this.buildVariationsGroup();
    // Placed last (after Variations): a deliberate choice to leave the
    // existing layout for every ordinary (flat) transform undisturbed — this
    // is purely an opt-in extension appended at the end, always built (never
    // conditionally omitted) so add/remove/selection keep working uniformly
    // whether or not this transform (or system) is currently non-flat.
    const fourD = this.buildFourDGroup(transform);

    this.editor = {
      target,
      geometry,
      controls,
      mirror,
      weightControl,
      variations: (transform.variations ?? []).map((v) => ({ ...v })),
      variationList: list,
      variationAdd: add,
      fourD,
    };
    this.renderVariationRows();
    this.refreshAddOptions();
  }

  /** Build a Scale group's "Mirror" row of aria-pressed toggle buttons —
   * pressed means the corresponding scale component is negative (a
   * reflection). Shared by the 3D Scale group's X/Y/Z toggles (fr-lca) and
   * the 4D group's single Scale W toggle (fr-icy). The scale sliders carry
   * pure magnitude, so these toggles are the editor's only way to create or
   * clear a mirror. */
  private buildMirrorRow(
    group: HTMLElement,
    toggles: MirrorToggleSpec[],
  ): HTMLButtonElement[] {
    const row = this.doc.createElement("div");
    row.className = "editor-row mirror-row";

    const name = this.doc.createElement("span");
    name.className = "axis";
    name.textContent = "Mirror";

    const buttons = toggles.map((spec) => {
      const button = this.doc.createElement("button");
      button.type = "button";
      button.className = "mirror-btn";
      button.textContent = spec.label;
      button.setAttribute("aria-label", spec.ariaLabel);
      button.title = "Reflect this axis (negative scale)";
      button.setAttribute("aria-pressed", String(spec.pressed));
      button.addEventListener("click", spec.onToggle);
      return button;
    });

    row.append(name, ...buttons);
    group.appendChild(row);
    return buttons;
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

  /**
   * Build one row of the 4D group: the same shape as the per-axis rows the
   * Position/Rotation/Scale/Shear loop and {@link buildWeightControl} build
   * (axis label, slider, live readout) — factored out here because each of
   * the eight 4D rows binds to a different, independently-optional field of
   * a transform's `w` block (see `WExtension`) rather than a shared indexed
   * array, so the generic per-channel loop above doesn't fit them directly.
   */
  private buildFourDRow(
    container: HTMLElement,
    axisLabel: string,
    ariaLabel: string,
    min: number,
    max: number,
    step: number,
    initialModel: number,
    toSlider: (model: number) => number,
    fromSlider: (slider: number) => number,
    format: (model: number) => string,
    onModelChange: (model: number) => void,
  ): AxisControl {
    const row = this.doc.createElement("div");
    row.className = "editor-row";

    const name = this.doc.createElement("span");
    name.className = "axis";
    name.textContent = axisLabel;

    const slider = this.doc.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(toSlider(initialModel));
    slider.setAttribute("aria-label", ariaLabel);

    const readout = this.doc.createElement("span");
    readout.className = "value";
    readout.textContent = format(initialModel);

    slider.addEventListener("input", () => {
      const model = fromSlider(Number(slider.value));
      readout.textContent = format(model);
      onModelChange(model);
    });

    row.append(name, slider, readout);
    container.appendChild(row);
    return { slider, readout };
  }

  /** Append a titled sub-group (a plain div, NOT collapsible on its own) to
   * `details` — the 4D group's internal structure mirrors the outer editor's
   * own group-title-then-rows pattern, just nested one level inside the
   * `<details>` so Position W/Scale W/Rotation W/Shear W stay visually
   * distinct from one another. */
  private appendFourDSubGroup(
    details: HTMLElement,
    title: string,
  ): HTMLElement {
    const group = this.doc.createElement("div");
    group.className = "editor-group";
    const heading = this.doc.createElement("div");
    heading.className = "editor-group-title";
    heading.textContent = title;
    group.appendChild(heading);
    details.appendChild(group);
    return group;
  }

  /**
   * Build the collapsed "4D" group (fr-bf6.3): the only UI that can create or
   * edit a transform's optional `w` extension (see `types.ts`'s
   * `WExtension`). Always built — never conditionally omitted — so every
   * other editor interaction keeps working uniformly whether or not this
   * particular transform is currently non-flat.
   *
   * `<details>`'s native open/closed state is the entire "collapsed by
   * default" affordance: open only when `transform.w` is already present
   * (regardless of whether it happens to be flat/trivial), so a system
   * authored via preset or URL hash shows its 4D values immediately instead
   * of hiding them a click away. Only {@link buildEditor} (a fresh selection)
   * decides this — {@link syncFourDControls} never touches `.open`, so a
   * user's manual toggle is never fought mid-session.
   */
  private buildFourDGroup(transform: Transform): FourDControls {
    const details = this.doc.createElement("details");
    details.className = "editor-group";
    details.open = transform.w !== undefined;

    const summary = this.doc.createElement("summary");
    summary.className = "editor-group-title";
    summary.textContent = "4D";
    details.appendChild(summary);

    const w = transform.w;

    const positionGroup = this.appendFourDSubGroup(details, "Position W");
    const positionW = this.buildFourDRow(
      positionGroup,
      "W",
      "Position W",
      MIN_W_POSITION,
      MAX_W_POSITION,
      0.01,
      w?.position ?? 0,
      (v) => v,
      (v) => v,
      (v) => v.toFixed(2),
      (model) => {
        this.mutateW((block) => {
          block.position = model;
        });
        this.emitGeometry();
      },
    );

    const scaleGroup = this.appendFourDSubGroup(details, "Scale W");
    const scaleWAuto = w?.scale === undefined;
    const scaleWInitial = w?.scale ?? meanContraction(transform.scale);
    const scaleW = this.buildFourDRow(
      scaleGroup,
      "W",
      "Scale W",
      MIN_W_SCALE,
      MAX_W_SCALE,
      0.01,
      scaleWInitial,
      (v) => Math.abs(v),
      // Magnitude-only slider (fr-icy — fr-lca's scale-channel treatment one
      // dimension up): re-apply the sign of the CURRENT model value, read at
      // input time. buildFourDRow's input listener calls fromSlider BEFORE
      // onModelChange writes the new value, so this sees the pre-drag sign;
      // unset (auto) means the derived mean, which is always positive.
      (v) => ((this.editor?.geometry.w?.scale ?? 1) < 0 ? -v : v),
      (v) => v.toFixed(2),
      (model) => {
        this.mutateW((block) => {
          block.scale = model;
        });
        this.emitGeometry();
      },
    );
    // The row above always formats as a plain number — patch in the "(auto)"
    // marker here, once, for the derived starting value. The row's own
    // listener (buildFourDRow) already reformats with the plain `format` the
    // instant the user actually moves it, so nothing else needs to know
    // about the marker; {@link refreshScaleWIfAuto} re-applies it live while
    // a 3D scale slider moves and this one stays untouched.
    if (scaleWAuto) {
      scaleW.readout.textContent = `${scaleWInitial.toFixed(2)} (auto)`;
    }

    // The Scale W slider above is magnitude-only (fr-icy), so this single
    // toggle is the editor's only way to create or clear a 4D reflection —
    // the exact counterpart of the 3D Scale group's Mirror row (fr-lca).
    const [mirrorW] = this.buildMirrorRow(scaleGroup, [
      {
        label: "W",
        ariaLabel: "Mirror Scale W",
        pressed: scaleWInitial < 0,
        onToggle: () => this.onMirrorWToggle(),
      },
    ]);

    // Rotation/Shear W share the same three plane keys (see W_PLANES) and the
    // same MIN_W_ANGLE/MAX_W_ANGLE range persist.ts clamps against on decode
    // (state.ts's doc) — deriving the slider's degree bounds from those
    // radian constants, rather than repeating -180/180 as a bare literal,
    // keeps the wire format and this widget sharing one source.
    const rotationGroup = this.appendFourDSubGroup(details, "Rotation W");
    const minAngleDeg = radToDeg(MIN_W_ANGLE);
    const maxAngleDeg = radToDeg(MAX_W_ANGLE);
    const rotationW = W_PLANES.map((plane, i) =>
      this.buildFourDRow(
        rotationGroup,
        W_PLANE_LABELS[i],
        `Rotation ${W_PLANE_LABELS[i]}`,
        minAngleDeg,
        maxAngleDeg,
        1,
        w?.rotation?.[plane] ?? 0,
        displayDegrees,
        degToRad,
        (v) => `${displayDegrees(v)}°`,
        (model) => {
          this.mutateW((block) => {
            const rotation: NonNullable<WExtension["rotation"]> =
              block.rotation ?? {};
            rotation[plane] = model;
            block.rotation = rotation;
          });
          this.emitGeometry();
        },
      ),
    );

    const shearGroup = this.appendFourDSubGroup(details, "Shear W");
    const shearW = W_PLANES.map((plane, i) =>
      this.buildFourDRow(
        shearGroup,
        W_PLANE_LABELS[i],
        `Shear ${W_PLANE_LABELS[i]}`,
        MIN_W_SHEAR,
        MAX_W_SHEAR,
        0.01,
        w?.shear?.[plane] ?? 0,
        (v) => v,
        (v) => v,
        (v) => v.toFixed(2),
        (model) => {
          this.mutateW((block) => {
            const shear: NonNullable<WExtension["shear"]> = block.shear ?? {};
            shear[plane] = model;
            block.shear = shear;
          });
          this.emitGeometry();
        },
      ),
    );

    this.transformEditor.appendChild(details);
    return { positionW, scaleW, mirrorW, rotationW, shearW };
  }

  /**
   * Ensure the working `w` block exists, then run `mutate` to set exactly the
   * one field the fired slider owns — the sparse-write contract (fr-bf6.3):
   * untouched fields must never be materialized, since their absence is what
   * keeps an unrelated edit from dragging a flat transform's `w` into
   * existence, and what lets `w.scale` keep meaning "derived" until the user
   * actually sets it (see `WExtension.scale`'s doc).
   */
  private mutateW(mutate: (w: WExtension) => void): void {
    const editor = this.editor;
    if (!editor) return;
    const w: WExtension = editor.geometry.w ?? {};
    mutate(w);
    editor.geometry.w = w;
  }

  /**
   * Keep the Scale W row tracking the live mean 3D contraction while
   * `w.scale` is UNSET (see `WExtension.scale`'s doc) — called after every 3D
   * scale slider edit; a no-op once the user has set an explicit Scale W,
   * since then it no longer derives from the 3D scale at all.
   */
  private refreshScaleWIfAuto(): void {
    const editor = this.editor;
    if (!editor || editor.geometry.w?.scale !== undefined) return;
    const derived = meanContraction(editor.geometry.scale);
    editor.fourD.scaleW.slider.value = String(derived);
    editor.fourD.scaleW.readout.textContent = `${derived.toFixed(2)} (auto)`;
  }

  /** Re-sync the 4D group's sliders/readouts to the current working geometry
   * — the fr-bf6.3 counterpart to the Position/Rotation/Scale/Shear loop and
   * the weight control's own re-sync in {@link syncEditor}. Never touches the
   * `<details>` open/closed state — see {@link buildFourDGroup}'s doc. */
  private syncFourDControls(): void {
    const editor = this.editor;
    if (!editor) return;
    const { w } = editor.geometry;
    const { fourD } = editor;

    const posV = w?.position ?? 0;
    fourD.positionW.slider.value = String(posV);
    fourD.positionW.readout.textContent = posV.toFixed(2);

    const scaleAuto = w?.scale === undefined;
    const scaleV = w?.scale ?? meanContraction(editor.geometry.scale);
    fourD.scaleW.slider.value = String(Math.abs(scaleV));
    fourD.scaleW.readout.textContent = scaleAuto
      ? `${scaleV.toFixed(2)} (auto)`
      : scaleV.toFixed(2);
    fourD.mirrorW.setAttribute("aria-pressed", String(scaleV < 0));

    W_PLANES.forEach((plane, i) => {
      const rad = w?.rotation?.[plane] ?? 0;
      fourD.rotationW[i].slider.value = String(displayDegrees(rad));
      fourD.rotationW[i].readout.textContent = `${displayDegrees(rad)}°`;
    });
    W_PLANES.forEach((plane, i) => {
      const val = w?.shear?.[plane] ?? 0;
      fourD.shearW[i].slider.value = String(val);
      fourD.shearW[i].readout.textContent = val.toFixed(2);
    });
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
      w: cloneW(transform.w),
    };
    for (const channel of CHANNEL_ORDER) {
      const spec = CHANNELS[channel];
      editor.controls[channel].forEach((control, axis) => {
        const model = editor.geometry[channel][axis];
        control.slider.value = String(spec.toSlider(model));
        control.readout.textContent = spec.format(model);
      });
    }
    editor.mirror.forEach((button, axis) => {
      button.setAttribute(
        "aria-pressed",
        String(editor.geometry.scale[axis] < 0),
      );
    });
    if (editor.weightControl) {
      const { weight } = editor.geometry;
      editor.weightControl.slider.value = String(weightToSlider(weight));
      editor.weightControl.readout.textContent = weight.toFixed(2);
    }
    this.syncFourDControls();

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
    const model = spec.fromSlider(sliderValue, editor.geometry[channel][axis]);
    editor.geometry[channel][axis] = model;
    editor.controls[channel][axis].readout.textContent = spec.format(model);
    // Scale W tracks the live mean 3D contraction while unset (see
    // WExtension.scale's doc) — keep it in sync with every 3D scale edit.
    if (channel === "scale") this.refreshScaleWIfAuto();
    this.emitGeometry();
  }

  /** Flip one axis's scale sign (fr-lca). No refreshScaleWIfAuto here: the
   * derived Scale W is the MEAN of the |components|, unchanged by a sign
   * flip. */
  private onMirrorToggle(axis: number): void {
    const editor = this.editor;
    if (!editor) return;
    const model = -editor.geometry.scale[axis];
    editor.geometry.scale[axis] = model;
    editor.controls.scale[axis].readout.textContent =
      CHANNELS.scale.format(model);
    editor.mirror[axis].setAttribute("aria-pressed", String(model < 0));
    this.emitGeometry();
  }

  /** Flip Scale W's sign (fr-icy) — the 4D group's counterpart to
   * {@link onMirrorToggle}. While `w.scale` is unset (auto), this negates the
   * DERIVED mean and materializes it as the explicit value, exactly like a
   * slider nudge would: "derived but mirrored" isn't representable in the
   * sparse model, whose absent-scale state always means the positive mean
   * (see `WExtension.scale`). */
  private onMirrorWToggle(): void {
    const editor = this.editor;
    if (!editor) return;
    const current =
      editor.geometry.w?.scale ?? meanContraction(editor.geometry.scale);
    const model = -current;
    this.mutateW((block) => {
      block.scale = model;
    });
    editor.fourD.scaleW.slider.value = String(Math.abs(model));
    editor.fourD.scaleW.readout.textContent = model.toFixed(2);
    editor.fourD.mirrorW.setAttribute("aria-pressed", String(model < 0));
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
      // Sparse by construction (fr-bf6.3): only include `w` when the working
      // copy actually has one, so a transform the user never touched the 4D
      // group on emits geometry with NO `w` key at all — not `undefined`,
      // not `{}` — keeping it byte-identical through an unrelated edit (see
      // WExtension's docs: absence is the flat/identity state). Cloned again
      // here (like the plain Vec3 channels above) so the emitted object never
      // aliases the editor's own live-mutated working copy.
      ...(editor.geometry.w !== undefined
        ? { w: cloneW(editor.geometry.w) }
        : {}),
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
