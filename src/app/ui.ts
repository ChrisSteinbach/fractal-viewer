import { meanContraction } from "../fractal/affine4";
import {
  DEFAULT_COLOR_SPEED,
  derivedColorIndex,
  effectiveSymmetryOrder,
  MAX_TRANSFORMS,
} from "../fractal/chaos-game";
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
import { CLASSIC_FOLD_RADII, isFoldVariationType } from "../fractal/variations";
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
import type { TimelineStep } from "./timeline";
import type { AppState, RenderMode } from "./state";
import { resolveBackground } from "./background";
import type { BackgroundGradient } from "./background";
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
import {
  formatIterationCount,
  SCALAR_CONTROLS,
  surfaceColorLUT,
} from "./control-spec";
import type { ScalarControlSpec } from "./control-spec";
import {
  MOBILE_BREAKPOINT,
  MIN_GUIDE_SCALE,
  MAX_GUIDE_SCALE,
} from "./constants";
import type { ExportProgressInit } from "./export-progress";
import { videoCaptureSupported } from "./recorder";
import { offlineExportSupported } from "./video-encode";
import { installSliderScrollGuard } from "./slider-scroll-guard";

export type { Preset };

/**
 * Which object a live surface session is actually marching (fr-5wlv.6,
 * widened by fr-tdin) — the routing decision main.ts made at
 * `surfaceSession.start()`, pushed in so the panel's rows can tell the
 * truth about what applies. `"ifs"` is the inverse-descent attractor
 * (3D or 4D); `"escape"` and `"bulb"` are the two FORWARD-ORBIT
 * escape-time objects, which share every panel consequence — see
 * {@link Ui.setSurfaceSessionKind}.
 */
export type SurfaceSessionKind = "ifs" | "escape" | "bulb";

/** The geometry (and weight/variations) a transform editor edits. `w` is the
 * optional 4D extension (fr-bf6.3, see `types.ts`'s `WExtension`) — included
 * here so the single editor can be the one UI that creates/edits it, but see
 * {@link Ui.emitGeometry} for why it's only ever present on the emitted
 * object when the working copy actually has one. */
type Geometry = Pick<
  Transform,
  | "position"
  | "rotation"
  | "scale"
  | "weight"
  | "shear"
  | "variations"
  | "w"
  | "colorIndex"
  | "colorSpeed"
>;

/** The final transform's geometry — the same, minus the fields that only mean
 * something for a map the chaos game PICKS: the selection weight, and the two
 * structural-color fields (fr-hiyu), which move the color coordinate on each
 * pick. A lens applied to every plotted point has neither. */
type FinalGeometry = Omit<Geometry, "weight" | "colorIndex" | "colorSpeed">;

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
  /** "🧬 Mutate" was clicked (fr-3vly): open the mutation-grid modal. The app
   * builds the candidates and fills the cells via {@link Ui.openMutations} /
   * {@link Ui.setMutationCell}. */
  onOpenMutations: () => void;
  /** A mutation cell was clicked: load candidate `index` (0..7) — a normal
   * undoable replace-load, morphing in like Surprise Me — after which the
   * app re-seeds the grid around the pick. */
  onMutationPick: (index: number) => void;
  /** The mutation modal's "↻ Mutate again" was clicked: roll eight fresh
   * candidates from the same current system. */
  onMutateAgain: () => void;
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
  /** "⤓ Save scene file" was clicked: download the current scene document as
   * a JSON file (fr-de9t) — the file counterpart of "🔗 Copy link". */
  onSaveSceneFile: () => void;
  /** "⤓ Export .flame" was clicked: download the system's XY shadow as a
   * flam3/Apophysis .flame file (fr-8uy5, `flame-file.ts`). */
  onSaveFlameFile: () => void;
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
  /** "📍 Add keyframe" was clicked (fr-8v41): append the current view —
   * scene document + camera pose + a thumbnail of what's showing — to the
   * animation timeline. */
  onTimelineAddKeyframe: () => void;
  /** "▶ Play timeline" / "■ Stop" was clicked: toggle timeline playback —
   * session-only motion like the drift show; main.ts owns the policy. */
  onTimelinePlayToggle: () => void;
  /** "⏺ Export clip" was clicked: play the timeline while recording the
   * canvas to a downloadable video clip (fr-8v41). */
  onTimelineExport: () => void;
  /** The export progress modal's Cancel button was clicked, or Escape was
   * pressed while it was open and cancellable (fr-7mfx): abort the
   * in-flight capture. Both routes land here rather than a bare
   * hideExportProgress() — the modal has no ✕ or backdrop close, since an
   * accidental dismissal must not silently abandon a multi-minute export. */
  onExportCancel: () => void;
  /** The export progress modal's second action was clicked (fr-2fbs): stop
   * waiting for the render to finish and save the picture as it stands.
   * Shown only for a run that offered it — see
   * {@link Ui.showExportProgress}'s `deliverEarly` — and deliberately NOT on
   * the Escape route, which stays cancel-only. */
  onExportDeliverEarly: () => void;
  /** "⬇ Back up timeline" was clicked (fr-h9rk): download the authored
   * timeline — keyframe steps + the playback determinism seed — as a JSON
   * backup file, the timeline counterpart of {@link onExportCollection}. */
  onExportTimeline: () => void;
  /** A timeline row's ✕ was clicked: remove that keyframe by its id. */
  onTimelineRemoveStep: (id: string) => void;
  /** A timeline row's ↑/↓ was clicked: move that keyframe one slot earlier
   * (-1) or later (+1) in playback order. */
  onTimelineMoveStep: (id: string, delta: -1 | 1) => void;
  /** A timeline row's morph/hold seconds input committed a new value —
   * already parsed and converted to MILLISECONDS; only the edited field is
   * present. Non-numeric input never reaches this (the row restores itself). */
  onTimelineStepTiming: (
    id: string,
    timing: { morphMs?: number; holdMs?: number },
  ) => void;
  /** "🔗 Copy link" was clicked: copy a shareable URL of the current scene. */
  onCopyLink: () => void;
  /** "⬇ Back up collection" was clicked: download the whole saved-scene
   * collection as a JSON backup file (fr-de9t). */
  onExportCollection: () => void;
  /** An import file arrived (fr-de9t) — picked through "⬆ Import file"'s
   * hidden input, or dropped anywhere on the page (main.ts owns the drop
   * listeners): a scene file to load, a collection backup to merge, or a
   * timeline backup to restore. Reading and validating the untrusted bytes
   * is the app's job (`scene-file.ts`'s `decodeImportFile`), not this
   * layer's. */
  onImportFile: (file: File) => void;
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
  /** The surface mode's "Quick previews" checkbox was flipped (fr-37c6):
   * `false` = invalidations never trace the preview tier — the pane holds
   * its last frame while the view moves and the full render starts on park.
   * A per-browser viewer pref (like the motion toggles' autoMotion), and
   * flipping it off mid-grind takes effect immediately. */
  onSurfacePreviewToggle: (checked: boolean) => void;
  /** The progress row's "Skip preview" button was clicked (fr-37c6):
   * abandon the in-flight preview and start the full-detail render of this
   * view now. One-shot — the next move previews as usual. */
  onSurfaceSkipPreview: () => void;
  /** The 3D orbit-speed slider moved: `value` is the rate multiplier (×). */
  onAutoOrbitSpeedInput: (value: number) => void;
  /** The 4D soft w-slice (fr-6x2) was toggled on or off. */
  onFourDSliceToggle: (checked: boolean) => void;
  /** The 4D slice-position slider moved: `value` is the slice center in
   * signed normalized rotated-w units, [-1, 1]. */
  onFourDSliceInput: (value: number) => void;
  /** The 4D slice-thickness slider moved (fr-wa6o): `value` is the slab's
   * HALF-thickness in the same normalized rotated-w units as
   * {@link onFourDSliceInput}'s center, [0, 0.5]. Surface-only — the row is
   * shown exactly in a live 4D surface session (see
   * {@link Ui.syncFourDViewRows}), whose tracer renders everything within
   * that much of the slice plane instead of the plane alone. */
  onFourDSliceThicknessInput: (value: number) => void;
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
  /** "Inflate" was clicked (fr-5wlv.2): sweep the balloon echo's radius
   * from a crumpled ball out to its rest size, turning the echo on first
   * if it wasn't already. */
  onBalloonInflate: () => void;
  /** The gradient editor (fr-55k) changed the custom palette's stop list —
   * a recolor, an added stop, or a removed stop; `stops` is the editor's
   * whole new list, parsed and ready for `setCustomPaletteStops`. */
  onCustomPaletteStops: (stops: RgbStop[]) => void;
  /** The position mode's axis-color pickers changed (fr-8k7) — `colors` is
   * the full x/y/z triple as parsed from the three inputs; the Reset button
   * sends the exact legacy identity (the reducer normalizes it to absent). */
  onPositionAxisColors: (colors: PositionAxisColors) => void;
  /** The custom backdrop's top/bottom pickers changed (fr-5ps1) — `custom`
   * is the full stop pair as parsed from the two inputs, ready for
   * `setBackgroundCustom`. Only reachable while the Background select sits
   * on Custom (the row is hidden otherwise). */
  onBackgroundCustom: (custom: BackgroundGradient) => void;
  /** The fog tint color picker changed (fr-5h5d) — `hex` is the input's raw
   * `#rrggbb` value, ready for `setFogTint` (the reducer, not this
   * callback, is the validation boundary). The strength half of the pair
   * is table-driven (see control-spec.ts's `fogTintStrength` entry); this
   * callback only carries the bespoke color picker, like
   * `onBackgroundCustom` above. */
  onFogTint: (hex: string) => void;
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

/** Shared `<details name>` for the transform editor's groups (fr-64ku), so
 * opening one closes the rest — the same exclusive-accordion idiom the panel's
 * outer sections use, one level in. */
const EDITOR_GROUP_NAME = "transform-editor-group";

/** The group a fresh selection opens when the user has expressed no
 * preference and the transform is flat. */
const DEFAULT_EDITOR_GROUP = "Position";

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
 * a variation's strength reads naturally as a `-2…2` coefficient. Negative
 * weights are real objects, not degenerate ones — the classic Mandelbox is
 * `s = -1.5`, and reflection blends need `w < 0` (fr-64k0) — so the slider
 * reaches them directly instead of leaving them URL/`.flame`-import-only.
 * `0` contributes nothing but keeps the row; removal is the row's × button.
 */
const VARIATION_WEIGHT_MIN = -2;
const VARIATION_WEIGHT_MAX = 2;
const DEFAULT_VARIATION_WEIGHT = 1;

/** The fold family's three authored lengths (fr-s9ll). */
type FoldRadiusKey = "minRadius" | "fixedRadius" | "boxLimit";

/**
 * Which of the three lengths each fold actually READS. A box fold has no
 * sphere and a sphere fold has no wall, and fr-77oy measured exactly that:
 * "a box-fold link's mR/fR are inert, so a per-variation schema hands
 * boxfold two fields it cannot use". Handing them to the user anyway would
 * be worse than handing them nothing — a control that does not move the
 * picture teaches that the group does not work.
 */
const FOLD_RADIUS_FIELDS: Record<
  "boxfold" | "spherefold" | "mandelbox",
  FoldRadiusKey[]
> = {
  boxfold: ["boxLimit"],
  spherefold: ["minRadius", "fixedRadius"],
  mandelbox: ["minRadius", "fixedRadius", "boxLimit"],
};

const FOLD_RADIUS_LABELS: Record<FoldRadiusKey, string> = {
  minRadius: "Min radius",
  fixedRadius: "Fixed radius",
  boxLimit: "Box limit",
};

/**
 * Fold-length slider bounds. The two SPHERE radii are lengths in the fold's
 * own u-space, floored well above `variations.ts`'s relative domain floor —
 * the magnification is `fR²/mR²`, so the bottom of this range is already a
 * 22500x fold and nothing below it is a picture. The BOX wall floors at 0
 * instead, which is a real authored fold rather than a degenerate one:
 * `2·clamp(t, 0, 0) − t = −t` is a point reflection (`resolveFoldRadii`
 * keeps it deliberately).
 *
 * The min-radius ceiling is NOT `FOLD_RADIUS_MAX`: the fold's domain is
 * `0 < mR <= fR`, so that slider's own max is the current fixed radius and
 * moves with it. Enforced in the row rather than left to
 * `resolveFoldRadii`'s clamp, so the readout never shows a length the
 * renderer is not using.
 */
const FOLD_RADIUS_MIN = 0.01;
const FOLD_RADIUS_MAX = 3;
const BOX_LIMIT_MIN = 0;
const BOX_LIMIT_MAX = 3;
const FOLD_RADIUS_STEP = 0.005;

/**
 * Display names for variation types whose identifier does not title-case into
 * readable English. Only types that need it appear here; everything else
 * falls through to {@link variationLabel}'s title-case, which is why the
 * existing names are untouched.
 */
const VARIATION_LABELS: Partial<Record<VariationType, string>> = {
  qsquare: "Quaternion square",
  bulb: "Mandelbulb power 8",
};

/** Title-case a variation type for display, e.g. "handkerchief" → "Handkerchief". */
function variationLabel(type: VariationType): string {
  return VARIATION_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Structural equality for a variation list, so the editor only rebuilds on
 * real change.
 *
 * It compares EVERY persisted field, not only the ones the rows render. The
 * fold's three lengths (fr-s9ll) have no row of their own, but this predicate
 * also decides whether the editor's WORKING COPY is refreshed from the
 * document — and the working copy is what the next slider drag emits back. A
 * comparison that ignored them would let a morph, an undo or a timeline leg
 * change a radius under a stable selection, leave the working copy holding
 * the old one, and silently revert the author's value on the next unrelated
 * edit.
 */
function variationsEqual(a: Variation[], b: Variation[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (v, i) =>
        v.type === b[i].type &&
        v.weight === b[i].weight &&
        v.minRadius === b[i].minRadius &&
        v.fixedRadius === b[i].fixedRadius &&
        v.boxLimit === b[i].boxLimit,
    )
  );
}

/** One "Var: …" line naming a transform's active variations, for the list row. */
function variationSummary(t: Transform): string[] {
  const active = (t.variations ?? []).filter((v) => v.weight !== 0);
  if (active.length === 0) return [];
  return [`Var: ${active.map((v) => v.type).join(", ")}`];
}

/**
 * The list row's structural-color lines (fr-hiyu) — one per field this map
 * actually AUTHORS (`Transform.colorIndex` / `Transform.colorSpeed`), none for
 * the overwhelmingly common map that authors neither.
 *
 * Presence alone is the test, where the weight line above also excludes the
 * default value: an absent color field's default is not a constant but is
 * DERIVED (`chaos-game.ts`'s `derivedColorIndex` spreads the map by its
 * position in the system), so there is no fixed value to compare against —
 * and an authored index that happens to equal today's derived slot is still
 * authored, pinning that slot against a later add/remove that would move it.
 */
function colorSummary(t: Transform): string[] {
  const lines: string[] = [];
  if (t.colorIndex !== undefined) {
    lines.push(`Color: ${t.colorIndex.toFixed(2)}`);
  }
  if (t.colorSpeed !== undefined) {
    lines.push(`Color speed: ${t.colorSpeed.toFixed(2)}`);
  }
  return lines;
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

/**
 * Live handles into the "Color" group's two rows (fr-hiyu), plus the fallback
 * the Index row displays while the transform authors none.
 */
interface ColorControls {
  /** The palette-slot row — `Transform.colorIndex`. */
  index: AxisControl;
  /** The blend-fraction row — `Transform.colorSpeed`. */
  speed: AxisControl;
  /**
   * What the Index row shows while `colorIndex` is absent: `chaos-game.ts`'s
   * {@link derivedColorIndex} for this map's slot in the system. Re-resolved
   * on every sync rather than fixed at build time, because it depends on how
   * many maps the SYSTEM has — an add or remove moves it without the
   * selection moving. (Speed's fallback is the constant
   * {@link DEFAULT_COLOR_SPEED}, so it needs no such slot here.)
   */
  derivedIndex: number;
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
    /** Working copy of the transform's optional palette slot (fr-hiyu);
     * `undefined` exactly when the transform authors none AND the user hasn't
     * moved the Index slider yet — the same sparse discipline as `w` above,
     * and for the same reason (see {@link Ui.emitGeometry}). The rows still
     * DISPLAY the derived fallback meanwhile; only this working copy is
     * empty. */
    colorIndex: number | undefined;
    /** Working copy of the transform's optional color speed (fr-hiyu) —
     * {@link colorIndex}'s twin in every respect. */
    colorSpeed: number | undefined;
  };
  controls: Record<Channel, AxisControl[]>;
  /** The Scale group's per-axis mirror toggles (fr-lca): pressed ⇔ that
   * axis's scale is negative (a reflection). */
  mirror: HTMLButtonElement[];
  /** The selection-weight control, or `null` for the final transform (no weight). */
  weightControl: AxisControl | null;
  /** The "Color" group's rows (fr-hiyu), or `null` for the final transform —
   * which is never PICKED, so it never moves the color coordinate. */
  colorControls: ColorControls | null;
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
  /** "⤓ Save PNG"'s authored title, restored once a capture finishes — the
   * disabled-while-busy state swaps in a why-explaining one (fr-7mfx), the
   * same self-explaining pattern as {@link exportCollectionTitle}. */
  private readonly savePngTitle: string;
  private readonly recordVideoBtn: HTMLButtonElement;
  private readonly saveSceneFileBtn: HTMLButtonElement;
  private readonly saveFlameFileBtn: HTMLButtonElement;

  // Saved-scene collection (fr-cai): the panel's Save/Gallery/Copy-link
  // buttons, the gallery-count readout, and the gallery modal + its parts —
  // plus the fr-de9t file backup/restore trio (export, import, and the
  // hidden file input the import button opens).
  private readonly saveCollectionBtn: HTMLButtonElement;
  private readonly galleryBtn: HTMLButtonElement;
  private readonly copyLinkBtn: HTMLButtonElement;
  private readonly exportCollectionBtn: HTMLButtonElement;
  /** "⬇ Back up collection"'s authored title, restored whenever the button
   * re-enables — the disabled state swaps in a why-explaining one, the same
   * self-explaining pattern as {@link syncGalleryDriftBtn}. */
  private readonly exportCollectionTitle: string;
  private readonly importFileBtn: HTMLButtonElement;
  private readonly importFileInput: HTMLInputElement;
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

  // Animation timeline (fr-8v41): the panel's own authoring section, outside
  // #explorerControls like Collection/Export (adding a keyframe works from a
  // flame/solid render too). Play/Export mirror the Drift toggle's
  // lit/self-explaining-disabled-title pattern — see syncTimelineButtons.
  private readonly timelineAddBtn: HTMLButtonElement;
  private readonly timelinePlayBtn: HTMLButtonElement;
  private readonly timelinePlayTitle: string;
  private readonly timelineExportBtn: HTMLButtonElement;
  private readonly timelineExportTitle: string;
  private readonly exportTimelineBtn: HTMLButtonElement;
  /** "⬇ Back up timeline"'s authored title, restored whenever the button
   * re-enables — the disabled state swaps in a why-explaining one, the same
   * self-explaining pattern as {@link exportCollectionTitle} (fr-h9rk). */
  private readonly exportTimelineTitle: string;
  private readonly timelineStatus: HTMLElement;
  private readonly timelineList: HTMLElement;
  private readonly timelineEmpty: HTMLElement;
  /** Inputs to the Play/Export buttons' disabled state (see
   * syncTimelineButtons): reduced-motion availability
   * ({@link setTimelineAvailable}), whether playback is running
   * ({@link setTimelineActive}), and whether there's anything to play
   * ({@link renderTimeline}). */
  private timelineAvailable = true;
  private timelineActive = false;
  private timelineStepCount = 0;
  /** Non-null while the offline frame-exact export runs (fr-92t9): the
   * progress fragment the Export button shows — and the signal that the
   * button is currently the run's CANCEL affordance rather than a start
   * ({@link setTimelineExportProgress}). */
  private timelineExportProgress: string | null = null;

  // Mutation grid (fr-3vly): the Presets section's "🧬 Mutate" button and the
  // 3×3 modal it opens — the gallery modal's chrome with a fixed grid of
  // candidate cells the app fills progressively (setMutationCell). DOM order
  // is 0..8 with the CENTER (4) an inert current-system cell; candidate
  // index i (0..7) maps around it.
  private readonly mutateBtn: HTMLButtonElement;
  private readonly mutationModal: HTMLElement;
  private readonly mutationBackdrop: HTMLElement;
  private readonly mutationCloseBtn: HTMLButtonElement;
  private readonly mutationAgainBtn: HTMLButtonElement;
  private readonly mutationGrid: HTMLElement;
  /** The eight candidate cell buttons, by candidate index; rebuilt by
   * {@link resetMutationCells}. */
  private mutationCells: HTMLButtonElement[] = [];
  /** The inert center cell showing the system being mutated. */
  private mutationCenter: HTMLElement | null = null;

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

  // Export progress modal (fr-7mfx): a BLOCKING modal shown for the
  // duration of a Save PNG capture, reusing the gallery modal's chrome.
  // Unlike the three modals above, closing it is not a pure view concern —
  // Cancel has to abort real GPU work — so it has no bare close*() method;
  // see showExportProgress/setExportProgress/hideExportProgress below.
  private readonly exportModal: HTMLElement;
  private readonly exportTitle: HTMLElement;
  private readonly exportDetail: HTMLElement;
  private readonly exportProgress: HTMLElement;
  private readonly exportCancelBtn: HTMLButtonElement;
  /** The optional second action (fr-2fbs) — "stop waiting and save what's
   * there". DETACHED from the document, not merely hidden, whenever the run
   * in flight did not offer it: an action nobody is being offered must not
   * be tabbable, queryable, or readable as a stale label. Held here across
   * those absences, re-inserted by {@link showExportProgress}, whose `init`
   * also writes the label — the app owns the words. `isConnected` is
   * therefore the single source of truth for "is it on offer", with no
   * mirrored flag to drift from it. */
  private readonly exportDeliverBtn: HTMLButtonElement;
  /** Whether the in-flight capture can be cancelled — mirrored from the last
   * {@link showExportProgress} call, since {@link onExportKeydown} and
   * {@link hideExportProgress}'s focus restore both need it after the fact.
   * Cancel has no {@link exportDeliverBtn}-style absence: it is the one
   * button the dialog always has a place for, so it hides in place. */
  private exportCancellable = false;
  /** The element focused just before {@link showExportProgress} opened the
   * modal, restored by {@link hideExportProgress}. */
  private exportPreviousFocus: HTMLElement | null = null;

  private readonly glowBrightnessRow: HTMLElement;
  // The balloon echo's rows (fr-5wlv.2) — the checkbox row hides while the
  // system is non-flat (the echo is 3D-view-only, like Render Style above),
  // and the radius row additionally waits for state.balloonEcho. The
  // checkbox input itself is table-driven (see SCALAR_CONTROLS);
  // balloonInflateButton's click is bespoke, like watchBuildBtn.
  private readonly balloonEchoRow: HTMLElement;
  private readonly balloonRadiusRow: HTMLElement;
  private readonly balloonInflateButton: HTMLButtonElement;
  private readonly colorGammaRow: HTMLElement;
  private readonly rampPaletteRow: HTMLElement;
  private readonly positionColorsRow: HTMLElement;
  private readonly positionAxisInputs: {
    x: HTMLInputElement;
    y: HTMLInputElement;
    z: HTMLInputElement;
  };
  private readonly positionColorsResetBtn: HTMLElement;
  private readonly backgroundCustomRow: HTMLElement;
  private readonly backgroundInputs: {
    top: HTMLInputElement;
    bottom: HTMLInputElement;
  };
  /** The fog tint's bespoke color picker (fr-5h5d) — the strength slider
   * beside it is table-driven (see SCALAR_CONTROLS's `fogTintStrength`
   * entry), so only the color input needs its own reference here, unlike
   * `backgroundInputs`' pair. */
  private readonly fogTintColorInput: HTMLInputElement;
  private readonly symmetryNote: HTMLElement;
  private readonly finalTransformToggle: HTMLInputElement;
  private readonly transformEditor: HTMLElement;

  private readonly explorerControls: HTMLElement;
  /** The render-mode segmented control's three buttons (fr-39y), keyed by the
   * mode each one switches to — the single entry/exit surface that replaced
   * the flame/solid modal islands' four separate buttons. */
  private readonly modeButtons: Record<RenderMode, HTMLButtonElement>;
  /** fr-tmgf: device-level software-rasterizer warning (see
   * {@link setSoftwareRendererNote}) — sits OUTSIDE every mode-scoped block
   * below, so it stays visible across a render-mode switch instead of
   * disappearing with whichever status section owned it. */
  private readonly softwareRendererNote: HTMLElement;
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

  // The surface render's status block (epic fr-7jlk): a hint paragraph, a
  // note line (degraded-march notice while active), and the trace-progress
  // row (fr-zx34, see setSurfaceProgress). The mode button itself carries
  // the eligibility gate — see setSurfaceEligibility.
  private readonly surfaceStatus: HTMLElement;
  private readonly surfaceNote: HTMLElement;
  private readonly surfaceProgress: HTMLElement;
  // The preview tier under user control (fr-37c6): the quick-previews
  // checkbox is a per-BROWSER viewer pref main.ts seeds at boot
  // (setSurfacePreviewToggle), and the skip button is the one-shot escape
  // from a grinding preview — shown exactly while setSurfaceProgress
  // reports a skippable phase, hidden with the row.
  private readonly surfacePreviewToggle: HTMLInputElement;
  private readonly surfaceSkipPreviewBtn: HTMLButtonElement;
  // The surface render's own settings block (fr-7jlk v2): lighting sliders
  // plus the base-color source/palette selects, the same solidControls
  // pattern one render mode over. surfacePaletteRow additionally gates on
  // colorSource being "palette", "rings", or "sheets" (fr-rl4b: all three
  // sample the user-selected palette) — like glowBrightnessRow's renderStyle
  // gate. surfaceColorSpeedRow (fr-rl4b) gates more narrowly, on exactly
  // "palette": color speed shapes only that source's orbit-trap blend.
  private readonly surfaceControls: HTMLElement;
  private readonly surfacePaletteRow: HTMLElement;
  private readonly surfaceColorSpeedRow: HTMLElement;
  // The surface balloon rows (fr-5wlv.4): 3D-surface-only this cut — the
  // variant exists only in the 3D material, so both hide under a live 4D
  // surface session (fourDSurfaceLive) and under either forward-orbit one
  // (surfaceSessionKind, fr-5wlv.6 + fr-tdin — the balloon is permanently
  // inert there, not just momentarily unavailable like the 4D case); the
  // radius
  // row additionally waits for the balloon itself, mirroring the explorer
  // pair (fr-5wlv.2). Its own Inflate button (fr-5wlv.6) binds the SAME
  // handler as the explorer's balloonInflateButton — one sweep, one
  // handler, two entry points.
  private readonly surfaceBalloonRow: HTMLElement;
  private readonly surfaceBalloonRadiusRow: HTMLElement;
  private readonly surfaceBalloonInflateButton: HTMLButtonElement;

  // The surface ground plane row (fr-rhn5): unlike the balloon rows above,
  // visible for EVERY 3D surfaceSessionKind — the floor survives where the
  // balloon degenerates (fr-5wlv.4's measured escape-solid interior
  // swallowing the camera, and fr-tdin's identical measurement on the
  // Mandelbulb, never applied to a flat plane) — and hidden only under a
  // live 4D surface session (fourDSurfaceLive). Its
  // checkbox is table-driven (see SCALAR_CONTROLS's surfaceGroundPlaneCheckbox
  // entry), so only the row itself needs a reference here.
  private readonly surfaceGroundPlaneRow: HTMLElement;

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
  private readonly fourDSliceToggleRow: HTMLElement;
  private readonly fourDSliceRow: HTMLElement;
  private readonly fourDSliceSlider: HTMLInputElement;
  private readonly fourDSliceLabel: HTMLElement;
  // Slice thickness (fr-wa6o): lives inside fourDSliceRow like the rel-color
  // row below, but with the OPPOSITE surface gate — a slab only means
  // something to the tracer that marches one, so its row shows exactly in a
  // live 4D surface session (see syncFourDViewRows).
  private readonly fourDSliceThicknessRow: HTMLElement;
  private readonly fourDSliceThicknessSlider: HTMLInputElement;
  private readonly fourDSliceThicknessLabel: HTMLElement;
  // Slice-relative color (fr-nn6): lives inside fourDSliceRow (so it hides
  // with the slice), with its own row element hidden for the baked fr-d47
  // modes — the remap only touches the w-ramp palettes (see updateLabels).
  private readonly fourDSliceRelColorToggle: HTMLInputElement;
  private readonly fourDSliceRelColorRow: HTMLElement;
  /** True while the panel is showing a LIVE 4D surface session (fr-b30z):
   * a non-flat system in Surface mode, where the tracer re-poses the rotor
   * and re-marches the w slice every frame. It changes what the slice block
   * means, so {@link syncFourDViewRows} keys on it — see updateLabels. */
  private fourDSurfaceLive = false;
  /** False while the live 4D surface session's fold set breaks segment
   * exactness (fr-rsp6 × fr-wa6o: spherefold/mandelbox branches take
   * segments to arcs, so the session clamps the slab to 0) — the
   * thickness row hides rather than showing a slider the session ignores.
   * Session-scoped, set by main.ts's routing; true outside such sessions. */
  private fourDSlabAvailable = true;
  /**
   * The ACTIVE surface session's shape (fr-5wlv.6): `"escape"` for the
   * escape-time fold render (fr-kltj) and `"bulb"` for the Mandelbulb
   * (fr-tdin) — the two FORWARD-ORBIT objects, filled solids whose
   * interior reaches the ball centre, so scene.ts nulls the ball
   * (fr-5wlv.4's measured degeneracy, re-measured on the bulb by
   * fr-tdin) and the balloon is permanently inert for both — `"ifs"` for
   * every ordinary IFS or live 4D session, `null` outside a surface
   * session (or before the routing decision lands). Session-scoped like
   * {@link fourDSlabAvailable}, set by main.ts's own routing at
   * surfaceSession.start() and reset on session end — NOT document-derived
   * like {@link fourDSurfaceLive} above, since "would this document route
   * to escape" needs the same analysis main.ts's routing already ran; read
   * by updateLabels alongside fourDSurfaceLive to gate the balloon rows.
   */
  private surfaceSessionKind: SurfaceSessionKind | null = null;
  // Auto-tumble pause/resume + speed (fr-woc): same session-only pattern as
  // the slice controls above. The toggle's own wrapper row (fr-osgs) hides —
  // with the speed row — in a live 4D surface session, where the ambient
  // tumble is PARKED (see syncFourDViewRows).
  private readonly fourDTumbleToggle: HTMLInputElement;
  private readonly fourDTumbleToggleRow: HTMLElement;
  private readonly fourDTumbleRow: HTMLElement;
  private readonly fourDTumbleSpeedSlider: HTMLInputElement;
  private readonly fourDTumbleSpeedLabel: HTMLElement;
  /** Is the projection ACTUALLY tumbling right now (main.ts's
   * `fourDView.tumbleOn`, whose default this matches)? Mirrored here because
   * the canvas help box names the motion (fr-k9nx) and would otherwise claim
   * a tumble that is parked. Deliberately not the checkbox — unlike `sliceOn`
   * (see updateLabels' syncFourDViewRows call), the control is not the truth:
   * a build replay's showcase forces the tumble on for its duration WITHOUT
   * touching the user's control (main.ts's replayShowcase), and the help box
   * describes the canvas, not the panel. Kept in step by
   * {@link setFourDTumbleActive}, {@link resetFourDTumble}, and the toggle's
   * own change handler. */
  private fourDTumbleActive = true;
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

  /** The gradient-stop editor rows shown under the flame/solid/surface/ramp
   * palette `<select>`s once set to Custom (fr-55k; the ramp row since
   * fr-3b6, the surface row since fr-ibcm): a live gradient strip preview,
   * one `<input type="color">` per stop, and the add/remove-stop buttons.
   * All four editors read/write the SAME shared `AppState.customPalette`
   * slot (see {@link syncCustomPaletteEditors}) — only which row is visible
   * differs, keyed on that palette select's own paletteId
   * (flame/solid/surface) or `rampPaletteId` (ramp). */
  private readonly customPaletteEditors: Record<
    "flame" | "solid" | "surface" | "ramp",
    {
      row: HTMLElement;
      strip: HTMLElement;
      stops: HTMLElement;
      add: HTMLButtonElement;
      remove: HTMLButtonElement;
    }
  >;

  /** Which accordion section is open, remembered per render mode (fr-99o) so
   * switching Points ↔ Flame ↔ Solid ↔ Surface restores each mode's working
   * section instead of landing on an all-collapsed panel. `""` = the user
   * deliberately collapsed everything in that mode. Session-only, like
   * `renderMode` itself. */
  private readonly openSectionByMode: Record<RenderMode, string> = {
    points: "presetSection",
    flame: "flameToneSection",
    solid: "solidSurfaceSection",
    surface: "surfaceLookSection",
  };

  /** The render mode {@link updateLabels} last saw — its change is what
   * triggers the accordion restore above. */
  private sectionMode: RenderMode = "points";

  private editor: EditorState | null = null;

  /**
   * Session memory of which transform-editor group is open (fr-64ku). Every
   * fresh selection restores it, so tuning Rotation across several transforms
   * doesn't mean reopening the group at each one.
   *
   * `null` = the user has never chosen, which is where fr-bf6.3's rule still
   * applies: a transform that already carries a `w` extension opens on "4D",
   * so a system authored by preset or URL hash shows its 4D values instead of
   * hiding them a click away. Once a choice exists it wins — the same "never
   * fight a manual toggle mid-session" line that rule was written on.
   */
  private editorOpenGroup: string | null = null;

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

  /** Escape-to-close for the mutation grid (fr-3vly), same discipline as
   * {@link onGalleryKeydown}. */
  private readonly onMutationKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.closeMutations();
  };

  /** Escape-and-Tab handling for the export modal (fr-7mfx), attached only
   * while it is open — same discipline as {@link onGalleryKeydown}. Escape
   * routes to the app's cancel (real GPU work must stop) and to nothing
   * else: fr-2fbs's second action saves a deliberately coarser picture, so
   * a stray Escape must never fire it. Tab cycles the buttons the run
   * actually offered — one of them, usually, which reproduces the original
   * pin — because a blocking dialog must not let focus wander into the page
   * it is blocking, and equally must not strand a keyboard user outside an
   * action it is offering. */
  private readonly onExportKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      if (this.exportCancellable) this.handlers?.onExportCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const ring: HTMLButtonElement[] = [];
    if (this.exportDeliverBtn.isConnected) ring.push(this.exportDeliverBtn);
    if (this.exportCancellable) ring.push(this.exportCancelBtn);
    if (ring.length === 0) return;
    e.preventDefault();
    const at = ring.indexOf(this.doc.activeElement as HTMLButtonElement);
    if (at < 0) {
      // Focus is somewhere else entirely (the modal opened over the page, or
      // a focused element was removed): pull it back into the ring.
      ring[0].focus();
      return;
    }
    const step = e.shiftKey ? -1 : 1;
    ring[(at + step + ring.length) % ring.length].focus();
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
    this.savePngTitle = this.savePngBtn.title;
    this.recordVideoBtn = this.byId("recordVideoBtn");
    this.recordVideoBtn.classList.toggle("hidden", !videoCaptureSupported());
    this.saveSceneFileBtn = this.byId("saveSceneFileBtn");
    this.saveFlameFileBtn = this.byId("saveFlameFileBtn");
    this.saveCollectionBtn = this.byId("saveCollectionBtn");
    this.galleryBtn = this.byId("galleryBtn");
    this.copyLinkBtn = this.byId("copyLinkBtn");
    this.exportCollectionBtn = this.byId("exportCollectionBtn");
    this.exportCollectionTitle = this.exportCollectionBtn.title;
    this.importFileBtn = this.byId("importFileBtn");
    this.importFileInput = this.byId("importFileInput");
    this.collectionCount = this.byId("collectionCount");
    this.galleryModal = this.byId("galleryModal");
    this.galleryBackdrop = this.byId("galleryBackdrop");
    this.galleryCloseBtn = this.byId("galleryCloseBtn");
    this.galleryDriftBtn = this.byId("galleryDriftBtn");
    this.galleryDriftTitle = this.galleryDriftBtn.title;
    this.galleryGrid = this.byId("galleryGrid");
    this.galleryEmpty = this.byId("galleryEmpty");
    this.timelineAddBtn = this.byId("timelineAddBtn");
    this.timelinePlayBtn = this.byId("timelinePlayBtn");
    this.timelinePlayTitle = this.timelinePlayBtn.title;
    this.timelineExportBtn = this.byId("timelineExportBtn");
    this.timelineExportTitle = this.timelineExportBtn.title;
    this.exportTimelineBtn = this.byId("exportTimelineBtn");
    this.exportTimelineTitle = this.exportTimelineBtn.title;
    // Visible when EITHER capture path exists: the realtime MediaRecorder
    // capture, or the offline frame-exact WebCodecs export (fr-92t9) —
    // main.ts's onTimelineExport routes between them.
    this.timelineExportBtn.classList.toggle(
      "hidden",
      !videoCaptureSupported() && !offlineExportSupported(),
    );
    this.timelineStatus = this.byId("timelineStatus");
    this.timelineList = this.byId("timelineList");
    this.timelineEmpty = this.byId("timelineEmpty");
    this.mutateBtn = this.byId("mutateBtn");
    this.mutationModal = this.byId("mutationModal");
    this.mutationBackdrop = this.byId("mutationBackdrop");
    this.mutationCloseBtn = this.byId("mutationCloseBtn");
    this.mutationAgainBtn = this.byId("mutationAgainBtn");
    this.mutationGrid = this.byId("mutationGrid");
    this.toast = this.byId("toast");
    this.aboutBtn = this.byId("aboutBtn");
    this.aboutModal = this.byId("aboutModal");
    this.aboutBackdrop = this.byId("aboutBackdrop");
    this.aboutCloseBtn = this.byId("aboutCloseBtn");
    this.aboutWatchBtn = this.byId("aboutWatchBtn");
    this.watchBuildBtn = this.byId("watchBuildBtn");
    this.replayCaption = this.byId("replayCaption");
    this.exportModal = this.byId("exportModal");
    this.exportTitle = this.byId("exportTitle");
    this.exportDetail = this.byId("exportDetail");
    this.exportProgress = this.byId("exportProgress");
    this.exportCancelBtn = this.byId("exportCancelBtn");
    this.exportDeliverBtn = this.byId("exportDeliverBtn");
    // ...and straight back out (fr-2fbs). index.html declares the button so
    // the dialog's full vocabulary — both its actions, in their order, with
    // their classes — stays readable in the markup; this makes the DEFAULT
    // state the true one. showExportProgress re-inserts it for a run that
    // offers the action, and takes it out again for one that does not.
    this.exportDeliverBtn.remove();
    this.glowBrightnessRow = this.byId("glowBrightnessRow");
    this.balloonEchoRow = this.byId("balloonEchoRow");
    this.balloonRadiusRow = this.byId("balloonRadiusRow");
    this.balloonInflateButton = this.byId("balloonInflateButton");
    this.colorGammaRow = this.byId("colorGammaRow");
    this.rampPaletteRow = this.byId("rampPaletteRow");
    this.positionColorsRow = this.byId("positionColorsRow");
    this.positionAxisInputs = {
      x: this.byId("positionAxisX"),
      y: this.byId("positionAxisY"),
      z: this.byId("positionAxisZ"),
    };
    this.positionColorsResetBtn = this.byId("positionColorsReset");
    this.backgroundCustomRow = this.byId("backgroundCustomRow");
    this.backgroundInputs = {
      top: this.byId("backgroundTop"),
      bottom: this.byId("backgroundBottom"),
    };
    this.fogTintColorInput = this.byId("fogTintColor");
    this.symmetryNote = this.byId("symmetryNote");
    this.finalTransformToggle = this.byId("finalTransformToggle");
    this.transformEditor = this.byId("transformEditor");
    this.explorerControls = this.byId("explorerControls");
    this.modeButtons = {
      points: this.byId("modePointsBtn"),
      flame: this.byId("modeFlameBtn"),
      solid: this.byId("modeSolidBtn"),
      surface: this.byId("modeSurfaceBtn"),
    };
    this.softwareRendererNote = this.byId("softwareRendererNote");
    this.undoRedoRow = this.byId("undoRedoRow");
    this.flameStatus = this.byId("flameStatus");
    this.solidStatus = this.byId("solidStatus");
    this.surfaceStatus = this.byId("surfaceStatus");
    this.surfaceNote = this.byId("surfaceNote");
    this.surfaceProgress = this.byId("surfaceProgress");
    this.surfacePreviewToggle = this.byId("surfacePreviewToggle");
    this.surfaceSkipPreviewBtn = this.byId("surfaceSkipPreviewBtn");
    this.flameControls = this.byId("flameControls");
    this.flameSupersampleNote = this.byId("flameSupersampleNote");
    this.flameBackendNote = this.byId("flameBackendNote");
    this.flameProgress = this.byId("flameProgress");
    this.solidControls = this.byId("solidControls");
    this.solidResolutionNote = this.byId("solidResolutionNote");
    this.solidProgress = this.byId("solidProgress");
    this.surfaceControls = this.byId("surfaceControls");
    this.surfacePaletteRow = this.byId("surfacePaletteRow");
    this.surfaceColorSpeedRow = this.byId("surfaceColorSpeedRow");
    this.surfaceBalloonRow = this.byId("surfaceBalloonRow");
    this.surfaceBalloonRadiusRow = this.byId("surfaceBalloonRadiusRow");
    this.surfaceBalloonInflateButton = this.byId("surfaceBalloonInflateButton");
    this.surfaceGroundPlaneRow = this.byId("surfaceGroundPlaneRow");
    this.fourDControls = this.byId("fourDControls");
    this.fourDSliceToggle = this.byId("fourDSliceToggle");
    this.fourDSliceToggleRow = this.byId("fourDSliceToggleRow");
    this.fourDSliceRow = this.byId("fourDSliceRow");
    this.fourDSliceSlider = this.byId("fourDSliceSlider");
    this.fourDSliceLabel = this.byId("fourDSliceLabel");
    this.fourDSliceThicknessRow = this.byId("fourDSliceThicknessRow");
    this.fourDSliceThicknessSlider = this.byId("fourDSliceThicknessSlider");
    this.fourDSliceThicknessLabel = this.byId("fourDSliceThicknessLabel");
    this.fourDSliceRelColorToggle = this.byId("fourDSliceRelColorToggle");
    this.fourDSliceRelColorRow = this.byId("fourDSliceRelColorRow");
    this.threeDControls = this.byId("threeDControls");
    this.autoOrbitToggle = this.byId("autoOrbitToggle");
    this.autoOrbitRow = this.byId("autoOrbitRow");
    this.autoOrbitSpeedSlider = this.byId("autoOrbitSpeedSlider");
    this.autoOrbitSpeedLabel = this.byId("autoOrbitSpeedLabel");
    this.fourDTumbleToggle = this.byId("fourDTumbleToggle");
    this.fourDTumbleToggleRow = this.byId("fourDTumbleToggleRow");
    this.fourDTumbleRow = this.byId("fourDTumbleRow");
    this.fourDTumbleSpeedSlider = this.byId("fourDTumbleSpeedSlider");
    this.fourDTumbleSpeedLabel = this.byId("fourDTumbleSpeedLabel");
    this.colorModeRow = this.byId("colorModeRow");
    this.fourDColorRow = this.byId("fourDColorRow");
    this.fourDDepthFadeRow = this.byId("fourDDepthFadeRow");
    this.renderStyleRow = this.byId("renderStyleRow");
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
      surface: {
        row: this.byId("surfaceCustomPaletteRow"),
        strip: this.byId("surfaceCustomPaletteStrip"),
        stops: this.byId("surfaceCustomPaletteStops"),
        add: this.byId("surfaceCustomPaletteAdd"),
        remove: this.byId("surfaceCustomPaletteRemove"),
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

    // A vertical scroll swipe that lands on a slider must not edit it, and
    // since fr-xu4u it does not even try: the guard PREVENTS the tap-jump
    // where fr-zoi undid it afterwards, and drives the touch drag itself
    // as the price. See slider-scroll-guard.ts for the full story,
    // including why the obvious preventDefault does not work.
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

  /** Read the two backdrop pickers as a BackgroundGradient, or null if
   * either fails to parse — the readPositionAxisColors contract, one row
   * over (fr-5ps1). */
  private readBackgroundCustom(): BackgroundGradient | null {
    const top = hexToRgb(this.backgroundInputs.top.value);
    const bottom = hexToRgb(this.backgroundInputs.bottom.value);
    if (!top || !bottom) return null;
    return { top, bottom };
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
    this.saveSceneFileBtn.addEventListener("click", () =>
      handlers.onSaveSceneFile(),
    );
    this.saveFlameFileBtn.addEventListener("click", () =>
      handlers.onSaveFlameFile(),
    );
    this.saveCollectionBtn.addEventListener("click", () =>
      handlers.onSaveToCollection(),
    );
    this.exportCollectionBtn.addEventListener("click", () =>
      handlers.onExportCollection(),
    );
    // "⬆ Import file" just opens the hidden picker; the input's change event
    // is what carries the chosen file to the app. The value reset lets the
    // SAME file be picked twice in a row (change wouldn't re-fire on an
    // unchanged value) — e.g. import a backup, delete an entry, re-import.
    this.importFileBtn.addEventListener("click", () =>
      this.importFileInput.click(),
    );
    this.importFileInput.addEventListener("change", () => {
      const file = this.importFileInput.files?.[0];
      this.importFileInput.value = "";
      if (file) handlers.onImportFile(file);
    });
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
    // Timeline (fr-8v41): the three top-level actions are parameterless,
    // like Surprise Me / Drift — row-level actions (remove/move/timing) are
    // wired per-row in renderTimeline instead.
    this.timelineAddBtn.addEventListener("click", () =>
      handlers.onTimelineAddKeyframe(),
    );
    this.timelinePlayBtn.addEventListener("click", () =>
      handlers.onTimelinePlayToggle(),
    );
    this.timelineExportBtn.addEventListener("click", () =>
      handlers.onTimelineExport(),
    );
    this.exportTimelineBtn.addEventListener("click", () =>
      handlers.onExportTimeline(),
    );
    // The mutation grid (fr-3vly): opening and re-rolling go through the app
    // (it owns the candidates); closing mirrors the gallery's pure-view
    // ✕/backdrop/Escape trio.
    this.mutateBtn.addEventListener("click", () => handlers.onOpenMutations());
    this.mutationAgainBtn.addEventListener("click", () =>
      handlers.onMutateAgain(),
    );
    this.mutationCloseBtn.addEventListener("click", () =>
      this.closeMutations(),
    );
    this.mutationBackdrop.addEventListener("click", () =>
      this.closeMutations(),
    );
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
    // The export progress modal (fr-7mfx) deliberately does NOT mirror the
    // ✕/backdrop/Escape trio above: index.html wires no ✕ and leaves the
    // backdrop unbound (an accidental dismissal must not silently abandon a
    // multi-minute export), and Cancel is not a pure view concern like
    // closeGallery/closeAbout/closeMutations — it has to abort real GPU
    // work, so the click (and onExportKeydown's Escape) route through the
    // app via onExportCancel instead of a bare hideExportProgress() call.
    this.exportCancelBtn.addEventListener("click", () =>
      handlers.onExportCancel(),
    );
    // Same reasoning for fr-2fbs's second action: it ends a real wait and
    // commits to a file, so it routes through the app rather than the view.
    this.exportDeliverBtn.addEventListener("click", () =>
      handlers.onExportDeliverEarly(),
    );
    // The balloon echo's "Inflate" replay (fr-5wlv.2) — a bespoke button
    // like watchBuildBtn above, not a table-driven scalar control. The
    // surface balloon's own Inflate button (fr-5wlv.6) fires the exact
    // SAME handler — one sweep, one radius field, two renderers' buttons.
    this.balloonInflateButton.addEventListener("click", () =>
      handlers.onBalloonInflate(),
    );
    this.surfaceBalloonInflateButton.addEventListener("click", () =>
      handlers.onBalloonInflate(),
    );
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
    // A disabled Surface segment swallows clicks silently, and its
    // reason-carrying tooltip is hover-only — invisible on touch. Pointer
    // events, unlike click/mouse events, ARE still dispatched for disabled
    // form controls, so the tap is heard here and the tooltip text becomes
    // a toast: every input modality learns WHY the mode is unavailable.
    this.modeButtons.surface.addEventListener("pointerdown", () => {
      const surface = this.modeButtons.surface;
      if (surface.disabled && surface.title) this.flashToast(surface.title);
    });
    this.autoOrbitToggle.addEventListener("change", () => {
      const on = this.autoOrbitToggle.checked;
      // Same "row hides with its toggle" pattern as the 4D tumble below
      // (orbit state is session-only and never enters AppState).
      this.autoOrbitRow.classList.toggle("hidden", !on);
      handlers.onAutoOrbitToggle(on);
    });
    this.surfacePreviewToggle.addEventListener("change", () => {
      handlers.onSurfacePreviewToggle(this.surfacePreviewToggle.checked);
    });
    this.surfaceSkipPreviewBtn.addEventListener("click", () => {
      handlers.onSurfaceSkipPreview();
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
      // state is session-only and never enters AppState); the shared sync
      // also keeps the surface-mode gate honest (fr-osgs).
      this.syncFourDViewRows();
      // Set BEFORE the handler: main.ts answers this one with an
      // updateLabels, which reads the flag to word the help box (fr-k9nx).
      this.fourDTumbleActive = on;
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
      this.syncFourDViewRows();
      handlers.onFourDSliceToggle(on);
    });
    this.fourDSliceSlider.addEventListener("input", () => {
      const value = Number(this.fourDSliceSlider.value);
      this.fourDSliceLabel.textContent = value.toFixed(2);
      handlers.onFourDSliceInput(value);
    });
    this.fourDSliceThicknessSlider.addEventListener("input", () => {
      const value = Number(this.fourDSliceThicknessSlider.value);
      this.fourDSliceThicknessLabel.textContent = value.toFixed(2);
      handlers.onFourDSliceThicknessInput(value);
    });
    this.fourDSliceRelColorToggle.addEventListener("change", () =>
      handlers.onFourDSliceRelColorToggle(
        this.fourDSliceRelColorToggle.checked,
      ),
    );
    // Custom palette gradient editor (fr-55k; the ramp row since fr-3b6, the
    // surface row since fr-ibcm): the flame/solid/surface/ramp rows share
    // this same wiring, each against its own DOM elements. The recolor
    // listener is delegated on the `stops` container (rather than bound per
    // input) so it survives syncCustomPaletteEditors rebuilding the inputs
    // on an add/remove.
    for (const kind of ["flame", "solid", "surface", "ramp"] as const) {
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
    // Custom backdrop stops (fr-5ps1): two pickers report as one pair — the
    // app state is the pair, so a drag in either re-reads both, exactly like
    // the position axis row just above.
    this.backgroundCustomRow.addEventListener("input", () => {
      const custom = this.readBackgroundCustom();
      if (custom) handlers.onBackgroundCustom(custom);
    });
    // Fog tint color (fr-5h5d): bound to the single picker itself, not the
    // row — unlike the pair above, there is no sibling input to jointly
    // re-read, and the row also hosts the table-driven strength slider,
    // whose own "input" events must not re-trigger this handler.
    this.fogTintColorInput.addEventListener("input", () => {
      handlers.onFogTint(this.fogTintColorInput.value);
    });
  }

  /** Reflect a 4D slice state in the panel controls (fr-pnek) — how a
   * restored document's saved 4D pose, applied to the view out from under
   * the UI (main.ts's applyFourDPose), keeps the panel truthful. The
   * position row shows/hides with the toggle exactly as its change handler
   * does; `thickness` (fr-wa6o) rides along, since a saved pose carries one
   * whether or not the session it lands in is showing that row. */
  setFourDSlice(
    on: boolean,
    center: number,
    relColor: boolean,
    thickness: number,
  ): void {
    this.fourDSliceToggle.checked = on;
    this.syncFourDViewRows();
    this.fourDSliceSlider.value = String(center);
    this.fourDSliceLabel.textContent = center.toFixed(2);
    this.fourDSliceThicknessSlider.value = String(thickness);
    this.fourDSliceThicknessLabel.textContent = thickness.toFixed(2);
    this.fourDSliceRelColorToggle.checked = relColor;
  }

  /**
   * Show or hide the 4D View rows for the mode the panel is in, reading the
   * toggles' own live `checked` state. Normally the position slider rides
   * the W-slice toggle and the speed slider rides the tumble toggle — pure
   * view reveals the UI owns, since both are session-only and never enter
   * AppState.
   *
   * A LIVE 4D surface session (fr-b30z) has no slice choice to offer. That
   * tracer marches a `w = w0` cross-section unconditionally — `sliceOn`
   * never reaches it (main.ts pushes only `sliceCenter`/`sliceThickness`
   * into `setSurface4View`) — so the toggle would be a lie, while the
   * position slider is the mode's defining parameter and the one control
   * that makes its continuous family of 3D fractals reachable. Hide the
   * toggle, show the slider regardless.
   *
   * The thickness slider (fr-wa6o) is that toggle's exact complement: the
   * slab it widens is a property of the tracer's own distance estimator, so
   * it shows ONLY in a live surface session. The point cloud's slice has a
   * fixed Gaussian width of its own that this control does not touch.
   *
   * The TUMBLE rows hide whole in that session too (fr-osgs): the ambient
   * tumble PARKS there — every tick would invalidate the frame and pin the
   * tier scheduler in preview, so the settle could never arm — and a
   * visible toggle whose motion never happens reads as a broken view. The
   * user's checkbox state survives untouched for the projection view.
   */
  private syncFourDViewRows(): void {
    const sliceOn = this.fourDSliceToggle.checked;
    const tumbleOn = this.fourDTumbleToggle.checked;
    this.fourDTumbleToggleRow.classList.toggle("hidden", this.fourDSurfaceLive);
    this.fourDTumbleRow.classList.toggle(
      "hidden",
      this.fourDSurfaceLive || !tumbleOn,
    );
    this.fourDSliceToggleRow.classList.toggle("hidden", this.fourDSurfaceLive);
    this.fourDSliceRow.classList.toggle(
      "hidden",
      !this.fourDSurfaceLive && !sliceOn,
    );
    // The thickness row stays VISIBLE in every live 4D surface session
    // and DISABLES with the reason when the session's fold set refuses
    // the slab (fr-rsp6 × fr-wa6o) — a silently vanishing control reads
    // as "impossible, no idea why", where the truth is a per-fold-family
    // soundness rule the user can act on (boxfold keeps the slab).
    this.fourDSliceThicknessRow.classList.toggle(
      "hidden",
      !this.fourDSurfaceLive,
    );
    const slabRefused = this.fourDSurfaceLive && !this.fourDSlabAvailable;
    this.fourDSliceThicknessSlider.disabled = slabRefused;
    if (slabRefused) {
      // The session clamps the slab to 0 whatever the thumb says — show
      // the clamped truth rather than a lying nonzero thumb. (Thickness
      // is session view state; resetFourDSlice zeroes it on every 4D
      // entry anyway, so no user-authored value is being discarded.)
      this.fourDSliceThicknessSlider.value = "0";
      this.fourDSliceThicknessLabel.textContent = "0.00";
    }
    this.fourDSliceThicknessRow.title = slabRefused
      ? "Slab thickness is unavailable with sphere folds: the slab's " +
        "segment certificates are unsound under the spherefold's " +
        "inversion branch (mandelbox includes it). Box-fold-only systems " +
        "keep the slab."
      : "";
  }

  /** fr-rsp6: whether the live 4D surface session can take a slab at all
   * (see {@link fourDSlabAvailable}) — main.ts sets it from `slabExact4`
   * at session routing and resets it true on session end. */
  setFourDSlabAvailable(available: boolean): void {
    if (this.fourDSlabAvailable === available) return;
    this.fourDSlabAvailable = available;
    this.syncFourDViewRows();
  }

  /** fr-5wlv.6: which shape the active surface session actually routed to
   * (see {@link surfaceSessionKind}) — main.ts sets it once per
   * surfaceSession.start() branch and resets it to `null` on session end,
   * mirroring {@link setFourDSlabAvailable}'s own routing-pushed pattern.
   * Unlike that setter, this one does not self-sync: the gated rows also
   * depend on `state.balloonEcho`, which this class doesn't cache, so the
   * caller's next `updateLabels` call (already the established pattern —
   * main.ts's refreshUi runs right after every surface routing decision)
   * is what actually applies it. */
  setSurfaceSessionKind(kind: SurfaceSessionKind | null): void {
    this.surfaceSessionKind = kind;
  }

  /** Reset the 4D slice controls to off/centered — called on every 4D entry so
   * a slice left behind by the previous visit never silently applies. The
   * slice-relative color option (fr-nn6) resets with it: it's slice view
   * state, and the fresh-visit default is the faithful whole-cloud ramp.
   * So does the slab thickness (fr-wa6o), whose fresh-visit default is the
   * zero-thickness cross-section. */
  resetFourDSlice(): void {
    this.setFourDSlice(false, 0, false, 0);
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
    this.syncFourDViewRows();
    this.fourDTumbleSpeedSlider.value = "1";
    this.fourDTumbleSpeedLabel.textContent = "1.0×";
    this.fourDTumbleActive = on;
  }

  /** Mirror a tumble on/off that did NOT come from the panel control — today
   * only the build replay's showcase, which forces the projection to tumble
   * for the replay and puts the prior flag back afterwards without ever
   * touching the user's checkbox (fr-k9nx; see {@link fourDTumbleActive}).
   * Wording-only: callers refresh the help box with the {@link updateLabels}
   * they already run. */
  setFourDTumbleActive(on: boolean): void {
    this.fourDTumbleActive = on;
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
    // (color mode/contrast, depth style — neither reaches the 4D projection
    // or its own w-driven coloring; symmetry, by contrast, stays put since
    // fr-q0h6 gave the 4D chaos game its own kaleidoscope stage) hide; their
    // 4D look siblings
    // (the 4D Color and depth-fade rows) swap into the same Appearance slots
    // (fr-15g), and the 4D View section's tumble/slice block replaces the 3D
    // View block. All four render modes stay available while
    // non-flat: the flame/solid renders snapshot the frozen 4D view and run
    // their own 4D accumulators (fr-5b3/fr-4wd), and the surface tracer poses
    // the 4D attractor live (fr-vxoj). The tumble/slice block hides under the
    // FROZEN renders for the same reason the editing controls do — the view
    // (rotor + slice) is baked into their worker snapshot, so its controls
    // couldn't affect it — but NOT under a live 4D surface session (fr-b30z),
    // where the tracer re-poses and re-marches every frame and those are the
    // only controls that reach it.
    const nonFlat = systemIsNonFlat(state);
    const frozenRender =
      state.renderMode === "flame" || state.renderMode === "solid";
    // A non-flat system in Surface mode is always the 4D tracer: the session
    // routes on this same predicate (main.ts's systemPartsAreNonFlat branch),
    // ahead of the flat-only escape-time and fold/affine paths.
    this.fourDSurfaceLive = nonFlat && state.renderMode === "surface";
    this.panelTitle.textContent = nonFlat ? "4D IFS Fractal" : "3D IFS Fractal";
    this.explorerControls.classList.toggle("hidden", rendering);
    this.flameControls.classList.toggle("hidden", state.renderMode !== "flame");
    this.solidControls.classList.toggle("hidden", state.renderMode !== "solid");
    this.surfaceControls.classList.toggle(
      "hidden",
      state.renderMode !== "surface",
    );
    // The surface palette select means anything for "palette", "rings", and
    // "sheets" (fr-rl4b) — all three sample the user-selected palette —
    // like glowBrightnessRow, hidden whenever none of those three is active.
    this.surfacePaletteRow.classList.toggle(
      "hidden",
      state.surface.colorSource !== "palette" &&
        state.surface.colorSource !== "rings" &&
        state.surface.colorSource !== "sheets",
    );
    // The color-speed slider (fr-rl4b) only shapes the "palette" source's
    // orbit-trap blend weight — inert for rings/sheets (a different
    // coordinate off the same descent) and every other source, so it hides
    // unless "palette" is exactly the active one.
    this.surfaceColorSpeedRow.classList.toggle(
      "hidden",
      state.surface.colorSource !== "palette",
    );
    // The surface balloon (fr-5wlv.4) is 3D-only this cut — the variant
    // exists only in the 3D material — so both rows hide under a live 4D
    // surface session, AND under either FORWARD-ORBIT one (fr-5wlv.6,
    // fr-tdin: the balloon is PERMANENTLY inert for those filled solids,
    // not just unavailable like the 4D case — see surfaceSessionKind's
    // own doc); the radius row additionally waits for the balloon itself
    // to be on, mirroring the explorer pair (fr-5wlv.2). The surface
    // section as a whole already gates on renderMode above.
    const surfaceBalloonHidden =
      this.fourDSurfaceLive ||
      this.surfaceSessionKind === "escape" ||
      this.surfaceSessionKind === "bulb";
    this.surfaceBalloonRow.classList.toggle("hidden", surfaceBalloonHidden);
    this.surfaceBalloonRadiusRow.classList.toggle(
      "hidden",
      surfaceBalloonHidden || !state.balloonEcho,
    );
    // The surface ground plane (fr-rhn5) is 3D-only like the balloon above,
    // so it hides under a live 4D surface session too — but unlike the
    // balloon it is NOT permanently inert for the forward-orbit solids
    // (the floor survives where the balloon degenerates, scene.ts's
    // enterSurfaceComputeForwardSession — a plane under a Mandelbox or a
    // Mandelbulb is the mode's classic look), so it stays visible for
    // EVERY 3D surfaceSessionKind and does not share
    // surfaceBalloonHidden's forward-kind gate.
    this.surfaceGroundPlaneRow.classList.toggle(
      "hidden",
      this.fourDSurfaceLive,
    );
    // …including each mode's non-section block above the accordion (fr-374p):
    // the Undo/Redo row belongs to the explorer (a mid-render undo couldn't
    // affect the frozen render, same reason the editing controls hide), and
    // the flame/solid status blocks belong to their renders.
    this.undoRedoRow.classList.toggle("hidden", rendering);
    this.flameStatus.classList.toggle("hidden", state.renderMode !== "flame");
    this.solidStatus.classList.toggle("hidden", state.renderMode !== "solid");
    this.surfaceStatus.classList.toggle(
      "hidden",
      state.renderMode !== "surface",
    );
    this.fourDControls.classList.toggle("hidden", !nonFlat || frozenRender);
    // The slice and tumble rows read differently in a live surface session
    // — see syncFourDViewRows. Both toggles are session-only view state the
    // UI owns, so the checkboxes themselves are the truth it re-applies.
    this.syncFourDViewRows();
    // The slice-relative option (fr-nn6) only touches the w-ramp palettes, so
    // its row hides under the baked fr-d47 modes — the same single source of
    // truth (color.ts) the shader's bake-vs-uniform dispatch keys on — and
    // under a live surface session, whose tracer has no w ramp at all (its
    // color sources are by-transform / palette / height / 4D radius / rings /
    // sheets, none of which the remap touches).
    this.fourDSliceRelColorRow.classList.toggle(
      "hidden",
      this.fourDSurfaceLive || fourDColorNeedsAttribute(state.fourDColor),
    );
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
    // The Symmetry section deliberately does NOT gate on `nonFlat` (fr-q0h6
    // P6): every render path sweeps or expands the kaleidoscope for a 4D
    // system too, so the controls stay editable — and fr-5gxn's "parked
    // kaleidoscope" note died with the hiding, since no authored symmetry is
    // inert anymore (a w-plane or twist makes the system itself 4D).
    // The manual brightness override only means anything for the glow render
    // style, so — like the flame/solid sub-panels above — it's hidden whenever
    // that style isn't the active one (and always while non-flat, since
    // renderStyle itself never reaches the 4D projection either).
    this.glowBrightnessRow.classList.toggle(
      "hidden",
      nonFlat || state.renderStyle !== "glow",
    );
    // The balloon echo (fr-5wlv.2) is 3D-view-only for this cut — the 4D
    // projection's position attribute holds pre-rotation coords the
    // inversion can't meaningfully remap (scene.ts hides the echo object
    // there too) — so the whole control hides while non-flat, like Render
    // Style above. The radius slider + Inflate button additionally wait
    // for the echo itself to be on.
    this.balloonEchoRow.classList.toggle("hidden", nonFlat);
    this.balloonRadiusRow.classList.toggle(
      "hidden",
      nonFlat || !state.balloonEcho,
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
    // The custom backdrop pickers (fr-5ps1): shown only while the Background
    // select sits on Custom; synced to the resolved stops with the same
    // only-write-on-change guard as the axis pickers above.
    this.backgroundCustomRow.classList.toggle(
      "hidden",
      state.background.mode !== "custom",
    );
    const backdrop = resolveBackground(state.background);
    for (const stop of ["top", "bottom"] as const) {
      const hex = rgbToHex(backdrop[stop]);
      const input = this.backgroundInputs[stop];
      if (input.value !== hex) input.value = hex;
    }
    // The fog tint picker (fr-5h5d): synced the same only-write-on-change
    // way as the backdrop pickers just above — state already holds the hex
    // string directly (no rgbToHex conversion needed), so a gallery load or
    // undo moves the swatch instead of leaving it stale.
    if (this.fogTintColorInput.value !== state.fogTint) {
      this.fogTintColorInput.value = state.fogTint;
    }
    // Accordion restore (fr-99o): entering a render mode re-opens the section
    // the user last had open there (defaults: Presets / Tone / Surface /
    // Surface Look — see openSectionByMode). Setting .open trips the details
    // name-group
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
    } else if (state.renderMode === "surface") {
      // The surface DE is world-space like the solid volume — same live
      // camera, same gesture lines.
      this.helpTitle.textContent = "Surface Render";
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
      // The opening line describes the cloud rather than a gesture, so it has
      // to track the tumble (fr-k9nx): a parked projection that still claimed
      // to be tumbling read as a broken view, and the paused wording points
      // back at the control that parked it just as the running one introduces
      // the motion.
      const subject = this.fourDTumbleActive
        ? "Auto-tumbling 4D IFS"
        : "4D IFS (tumble paused)";
      this.setHelpLines(
        this.mouse
          ? [
              subject,
              "Drag: Orbit",
              "Scroll: Zoom",
              "Shift-drag: Turn XW/YW",
              "Shift-scroll: Turn ZW",
            ]
          : [subject, "1 finger: Rotate", "2 fingers: Pan/Zoom"],
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
   * Sync the flame/solid/surface/ramp gradient-stop editors (fr-55k; the
   * ramp row since fr-3b6, the surface row since fr-ibcm) to
   * `state.customPalette`, called from {@link updateLabels} right after the
   * table-driven scalar sync loop. Four rows now: the flame/solid rows show
   * only while their OWN render's palette select is on
   * {@link CUSTOM_PALETTE_ID}; the surface and ramp rows additionally sit
   * INSIDE a gated container (`#surfacePaletteRow`, hidden unless the
   * surface colorSource is one of the three that sample the user palette —
   * `palette`/`rings`/`sheets`, fr-rl4b; `#rampPaletteRow`, the
   * per-view ramp-mode gating — flat: `colorModeUsesRampPalette`; non-flat:
   * `fourDColor === "radius"`, fr-6ue), so {@link updateLabels}' container
   * gating composes on top of the isCustom gating handled here — both must
   * hold for those editors to actually show. All four edit the same shared
   * slot (see `state.ts`'s `AppState.customPalette`), so switching which
   * one is "custom" never loses an in-progress edit. The stop inputs are
   * only rebuilt when their count changes (add/remove, or a fresh seed) —
   * an ordinary recolor instead updates each input's value in place, so it
   * never clobbers a color picker mid-drag with a redundant write.
   */
  private syncCustomPaletteEditors(state: AppState): void {
    const paletteIdByKind: Record<
      "flame" | "solid" | "surface" | "ramp",
      PaletteSelection
    > = {
      flame: state.flame.paletteId,
      solid: state.solid.paletteId,
      surface: state.surface.paletteId,
      ramp: state.rampPaletteId,
    };
    for (const kind of ["flame", "solid", "surface", "ramp"] as const) {
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

  /** Reflect the saved-scene count on the "▦ Gallery (N)" button (fr-cai) —
   * and on "⬇ Back up collection"'s enabled state (fr-de9t): an empty
   * collection has nothing to back up, and the swapped-in title says so
   * instead of leaving a dead button unexplained, the same self-explaining
   * pattern as {@link syncGalleryDriftBtn}. */
  setCollectionCount(count: number): void {
    this.collectionCount.textContent = String(count);
    this.exportCollectionBtn.disabled = count === 0;
    this.exportCollectionBtn.title =
      count === 0
        ? "Nothing saved yet — ★ Save to collection first"
        : this.exportCollectionTitle;
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

  /** Open the mutation-grid modal (fr-3vly) with all nine cells reset to
   * placeholders, and arm Escape-to-close. The app fills the cells as it
   * builds candidates — {@link setMutationCurrent} / {@link setMutationCell}. */
  openMutations(): void {
    this.resetMutationCells();
    this.mutationModal.classList.remove("hidden");
    this.doc.addEventListener("keydown", this.onMutationKeydown);
  }

  /** Hide the mutation modal and drop its Escape listener. Idempotent. */
  closeMutations(): void {
    this.mutationModal.classList.add("hidden");
    this.doc.removeEventListener("keydown", this.onMutationKeydown);
  }

  /** Whether the mutation modal is on screen. The app's progressive cell
   * builder checks this each step so closing the modal ends the build. */
  mutationsOpen(): boolean {
    return !this.mutationModal.classList.contains("hidden");
  }

  /** Show the blocking export modal (fr-7mfx): a Save PNG capture is
   * starting and may run for minutes on a surface render with no other
   * feedback otherwise on screen. `cancellable: false` states honestly that
   * the work cannot be interrupted — a single GPU submission cannot be
   * stopped mid-draw — and HIDES the Cancel button rather than offering a
   * dead one. `deliverEarly` is the fr-2fbs second action under the same
   * rule: absent — every caller but the flame Save-PNG's wait — leaves the
   * modal with exactly one button, and its label comes from the app because
   * only the app knows what the early picture will be. Arms Escape/Tab
   * handling, remembers the currently focused element to restore on
   * {@link hideExportProgress}, and resets the readout to 0% so a new run
   * never opens showing the previous run's number. */
  showExportProgress(init: ExportProgressInit): void {
    this.exportTitle.textContent = init.title;
    this.exportDetail.textContent = init.detail;
    this.exportCancellable = init.cancellable;
    this.exportCancelBtn.classList.toggle("hidden", !init.cancellable);
    // Both branches are idempotent: `before` on an already-placed node is a
    // move to where it already is, `remove` on a detached one does nothing.
    if (init.deliverEarly) {
      this.exportDeliverBtn.textContent = init.deliverEarly.label;
      this.exportCancelBtn.before(this.exportDeliverBtn);
    } else {
      this.exportDeliverBtn.remove();
    }
    this.exportProgress.classList.remove("flame-progress-estimating");
    this.exportProgress.textContent = "0%";
    this.exportProgress.style.setProperty("--progress", "0%");
    this.exportModal.classList.remove("hidden");
    this.doc.addEventListener("keydown", this.onExportKeydown);
    this.exportPreviousFocus =
      this.doc.activeElement instanceof HTMLElement
        ? this.doc.activeElement
        : null;
    // Cancel keeps the opening focus wherever it exists: Enter on a modal
    // that just appeared under the user's hands must not commit to a file.
    if (init.cancellable) this.exportCancelBtn.focus();
    else if (this.exportDeliverBtn.isConnected) this.exportDeliverBtn.focus();
  }

  /** Update the readout. `pct: null` is the honest indeterminate state: the
   * bar drops to 0 and the row takes the `.flame-progress-estimating` pulse
   * (the codebase's one busy affordance), showing `note` alone. */
  setExportProgress(status: { pct: number | null; note: string }): void {
    if (status.pct === null) {
      this.exportProgress.classList.add("flame-progress-estimating");
      this.exportProgress.style.setProperty("--progress", "0%");
      this.exportProgress.textContent = status.note;
      return;
    }
    this.exportProgress.classList.remove("flame-progress-estimating");
    this.exportProgress.style.setProperty(
      "--progress",
      `${String(status.pct)}%`,
    );
    this.exportProgress.textContent = `${String(status.pct)}% · ${status.note}`;
  }

  /** Hide the modal, drop the Escape/Tab listener, restore focus. Idempotent. */
  hideExportProgress(): void {
    if (this.exportModal.classList.contains("hidden")) return;
    this.exportModal.classList.add("hidden");
    this.doc.removeEventListener("keydown", this.onExportKeydown);
    // The fr-2fbs action belongs to the run that offered it, so it goes out
    // with that run rather than waiting for the next showExportProgress to
    // decide: nothing is offering it in between, and MEASURED — a browser
    // run caught the leftover from a flame export still sitting in the
    // page during a solid one, which is the exact "hidden is not absent"
    // hole this detach discipline exists to close.
    this.exportDeliverBtn.remove();
    // Clear text too, not just hide: a stale percent left in textContent
    // reads as a live render to settle-scraping harnesses (fr-d6g5).
    this.exportProgress.textContent = "";
    this.exportProgress.style.setProperty("--progress", "0%");
    this.exportProgress.classList.remove("flame-progress-estimating");
    const restoreFocus = this.exportPreviousFocus;
    this.exportPreviousFocus = null;
    if (restoreFocus?.isConnected) restoreFocus.focus();
  }

  /** Reflect a capture in flight on the Save PNG button (fr-7mfx): the
   * modal's scrim blocks it once shown, but the grace period leaves a
   * window where a second press would start a second capture. */
  setSavePngBusy(busy: boolean): void {
    this.savePngBtn.disabled = busy;
    this.savePngBtn.title = busy
      ? "Already exporting — wait for it to finish"
      : this.savePngTitle;
  }

  /**
   * Rebuild the 3×3 mutation grid as placeholders: an inert "current" center
   * (DOM position 4) plus eight disabled candidate buttons, enabled as their
   * thumbnails land ({@link setMutationCell}). Called on open and again on
   * every re-seed (a pick or "↻ Mutate again"). All DOM via createElement,
   * like {@link renderGallery}.
   */
  resetMutationCells(): void {
    this.mutationCells = [];
    this.mutationGrid.replaceChildren();
    for (let dom = 0; dom < 9; dom++) {
      if (dom === 4) {
        const center = this.doc.createElement("div");
        center.className = "mutation-cell mutation-cell-current";
        center.append(this.mutationPlaceholder(), this.mutationTag("current"));
        this.mutationCenter = center;
        this.mutationGrid.appendChild(center);
        continue;
      }
      const index = dom < 4 ? dom : dom - 1;
      const cell = this.doc.createElement("button");
      cell.type = "button";
      cell.className = "mutation-cell";
      cell.disabled = true;
      cell.setAttribute("aria-label", `Load mutation ${index + 1}`);
      cell.appendChild(this.mutationPlaceholder());
      cell.addEventListener("click", () =>
        this.handlers?.onMutationPick(index),
      );
      this.mutationCells[index] = cell;
      this.mutationGrid.appendChild(cell);
    }
  }

  /** Fill the center cell with the current system's thumbnail. */
  setMutationCurrent(
    pixels: Uint8ClampedArray<ArrayBuffer>,
    size: number,
  ): void {
    this.mutationCenter?.replaceChildren(
      this.thumbCanvas(pixels, size),
      this.mutationTag("current"),
    );
  }

  /** Fill candidate cell `index` (0..7) and enable its button; `wild` tags
   * the grid's one bolder wildcard mutation. */
  setMutationCell(
    index: number,
    pixels: Uint8ClampedArray<ArrayBuffer>,
    size: number,
    wild: boolean,
  ): void {
    const cell = this.mutationCells[index];
    if (!cell) return;
    cell.replaceChildren(this.thumbCanvas(pixels, size));
    if (wild) {
      cell.appendChild(this.mutationTag("wild"));
      cell.setAttribute("aria-label", `Load wildcard mutation ${index + 1}`);
    }
    cell.disabled = false;
  }

  private mutationPlaceholder(): HTMLElement {
    const empty = this.doc.createElement("div");
    empty.className = "mutation-cell-empty";
    empty.textContent = "…";
    return empty;
  }

  private mutationTag(text: string): HTMLElement {
    const tag = this.doc.createElement("span");
    tag.className = "mutation-cell-tag";
    tag.textContent = text;
    return tag;
  }

  /** Paint an RGBA pixel buffer (mutation-thumbs.ts's output) into a fresh
   * square canvas. jsdom — the DOM test environment — has no 2d context, so
   * the canvas simply stays blank there. */
  private thumbCanvas(
    pixels: Uint8ClampedArray<ArrayBuffer>,
    size: number,
  ): HTMLCanvasElement {
    const canvas = this.doc.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.putImageData(new ImageData(pixels, size, size), 0, 0);
    return canvas;
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
      scene.mode === "flame"
        ? "✺ "
        : scene.mode === "solid"
          ? "◆ "
          : scene.mode === "surface"
            ? "◈ "
            : "";
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
   * (Re)build the timeline rows in playback order (fr-8v41): called by
   * main.ts at boot and after every timeline edit (add/remove/move/retime).
   * `durationLabel` arrives preformatted (e.g. "0:18") — main.ts owns
   * formatting the summed morph/hold milliseconds into a clock label. All DOM
   * is built with `createElement`, never `innerHTML` — the same stance as
   * {@link renderGallery}: a step's thumbnail only ever sets `img.src`, and
   * its id only ever rides a closure, never markup.
   */
  renderTimeline(steps: TimelineStep[], durationLabel: string): void {
    this.timelineStepCount = steps.length;
    this.timelineEmpty.classList.toggle("hidden", steps.length > 0);
    this.timelineStatus.classList.toggle("hidden", steps.length === 0);
    if (steps.length > 0) {
      const n = steps.length;
      this.timelineStatus.textContent = `${n} keyframe${n === 1 ? "" : "s"} · ${durationLabel}`;
    } else {
      this.timelineStatus.textContent = "";
    }
    this.timelineList.replaceChildren(
      ...steps.map((step, i) => this.timelineRow(step, i, steps.length)),
    );
    this.syncTimelineButtons();
  }

  /** Build one {@link renderTimeline} row for `step` at position `i`
   * (0-based) of `total` rows — the display number, the disabled-arrow
   * ends, and the two timing inputs all key off these. */
  private timelineRow(
    step: TimelineStep,
    i: number,
    total: number,
  ): HTMLElement {
    const n = i + 1;
    const row = this.doc.createElement("div");
    row.className = "timeline-step";

    const index = this.doc.createElement("span");
    index.className = "timeline-step-index";
    index.textContent = String(n);
    row.appendChild(index);

    if (step.thumbnail) {
      const img = this.doc.createElement("img");
      img.className = "timeline-step-thumb";
      img.src = step.thumbnail;
      img.alt = "";
      img.loading = "lazy";
      row.appendChild(img);
    } else {
      // Capture failed, or the step predates thumbnails — a neutral
      // placeholder still reads as "a keyframe" and keeps the row's layout,
      // the same stance as renderGallery's card placeholder.
      const placeholder = this.doc.createElement("div");
      placeholder.className = "timeline-step-noimg";
      placeholder.textContent = "◆";
      row.appendChild(placeholder);
    }

    if (step.mode !== undefined) {
      // A keyframe captured from a flame/solid/surface render (fr-v3au)
      // plays back in that renderer and holds until it converges (the
      // surface render converges instantly) — flagged with the same glyph
      // vocabulary as galleryCard's mode caption (fr-75sq). A plain
      // (points) step gets no element at all.
      const mode = this.doc.createElement("span");
      mode.className = "timeline-step-mode";
      mode.textContent =
        step.mode === "flame" ? "✺" : step.mode === "solid" ? "◆" : "◈";
      mode.title = `Plays as a ${step.mode} render — playback holds until it converges`;
      mode.setAttribute("role", "img");
      mode.setAttribute("aria-label", `${step.mode} render keyframe`);
      row.appendChild(mode);
    }

    row.appendChild(
      this.timelineTimingInput(
        "morph",
        step.morphMs,
        "Seconds the morph into this keyframe takes",
        `Morph seconds into keyframe ${n}`,
        (morphMs) => this.handlers?.onTimelineStepTiming(step.id, { morphMs }),
      ),
    );
    row.appendChild(
      this.timelineTimingInput(
        "hold",
        step.holdMs,
        "Seconds to hold on this keyframe before moving on",
        `Hold seconds on keyframe ${n}`,
        (holdMs) => this.handlers?.onTimelineStepTiming(step.id, { holdMs }),
      ),
    );

    const actions = this.doc.createElement("div");
    actions.className = "timeline-step-actions";

    const up = this.doc.createElement("button");
    up.type = "button";
    up.className = "timeline-step-btn";
    up.textContent = "↑";
    up.setAttribute("aria-label", `Move keyframe ${n} earlier`);
    up.disabled = i === 0;
    up.addEventListener("click", () =>
      this.handlers?.onTimelineMoveStep(step.id, -1),
    );
    actions.appendChild(up);

    const down = this.doc.createElement("button");
    down.type = "button";
    down.className = "timeline-step-btn";
    down.textContent = "↓";
    down.setAttribute("aria-label", `Move keyframe ${n} later`);
    down.disabled = i === total - 1;
    down.addEventListener("click", () =>
      this.handlers?.onTimelineMoveStep(step.id, 1),
    );
    actions.appendChild(down);

    const remove = this.doc.createElement("button");
    remove.type = "button";
    remove.className = "timeline-step-btn timeline-step-delete";
    remove.textContent = "✕";
    remove.setAttribute("aria-label", `Remove keyframe ${n}`);
    remove.addEventListener("click", () =>
      this.handlers?.onTimelineRemoveStep(step.id),
    );
    actions.appendChild(remove);

    row.appendChild(actions);
    return row;
  }

  /** One morph/hold `<input type="number">`, wrapped in its labeled
   * `label.timeline-step-timing` (fr-8v41). Committing an empty or
   * non-finite value restores the input's displayed seconds from
   * `currentMs` instead of calling `onCommit` — the row undoes the bad edit
   * in place rather than ever sending a garbage value on; range clamping is
   * the store's job (`timeline.ts`'s `clampMs`), so the min/max attributes
   * here are just affordance. */
  private timelineTimingInput(
    fieldLabel: "morph" | "hold",
    currentMs: number,
    title: string,
    ariaLabel: string,
    onCommit: (ms: number) => void,
  ): HTMLElement {
    const wrapper = this.doc.createElement("label");
    wrapper.className = "timeline-step-timing";
    wrapper.appendChild(this.doc.createTextNode(fieldLabel));

    const input = this.doc.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "30";
    input.step = "0.5";
    input.value = String(currentMs / 1000);
    input.title = title;
    input.setAttribute("aria-label", ariaLabel);
    input.addEventListener("change", () => {
      const secs = Number(input.value);
      if (input.value === "" || !Number.isFinite(secs)) {
        input.value = String(currentMs / 1000);
        return;
      }
      onCommit(Math.round(secs * 1000));
    });
    wrapper.appendChild(input);
    return wrapper;
  }

  /** Mirror {@link setDriftActive}'s lit/"stop"-affordance shape for the
   * Play button (fr-8v41): "■ Stop" + pressed + blue while playback runs,
   * "▶ Play timeline" + ghost otherwise. */
  setTimelineActive(on: boolean): void {
    this.timelineActive = on;
    this.timelinePlayBtn.textContent = on ? "■ Stop" : "▶ Play timeline";
    this.timelinePlayBtn.setAttribute("aria-pressed", String(on));
    this.timelinePlayBtn.classList.toggle("btn-ghost", !on);
    this.timelinePlayBtn.classList.toggle("btn-blue", on);
    this.syncTimelineButtons();
  }

  /** Enable/disable timeline PLAYBACK for the OS reduced-motion preference —
   * mirrors {@link setDriftAvailable}. "📍 Add keyframe" is unaffected:
   * authoring isn't motion. */
  setTimelineAvailable(available: boolean): void {
    this.timelineAvailable = available;
    this.syncTimelineButtons();
  }

  /** Reflect the offline frame-exact export's progress on the Export button
   * (fr-92t9): non-null (e.g. "42%") relabels it "⏳ Exporting 42%" and
   * keeps it ENABLED as the run's cancel affordance (main.ts routes the
   * click to a stop; the partial clip still saves); null restores the
   * ordinary label and disabled-state derivation. */
  setTimelineExportProgress(progress: string | null): void {
    this.timelineExportProgress = progress;
    this.timelineExportBtn.textContent =
      progress === null ? "⏺ Export clip" : `⏳ Exporting ${progress}`;
    this.syncTimelineButtons();
  }

  /** Self-explaining disabled-state derivation for Play/Export — the
   * `syncGalleryDriftBtn` pattern: each button's `disabled` and `title` are
   * re-derived from the remembered availability/active/count flags whenever
   * any of them changes. */
  private syncTimelineButtons(): void {
    const empty = this.timelineStepCount === 0;
    // "⬇ Back up timeline" only needs something to write (fr-h9rk): a pure
    // data read, so neither reduced motion nor a running playback disables
    // it — the emptiness-only rule "⬇ Back up collection" follows
    // (setCollectionCount), unlike its Play/Export-clip neighbors below.
    this.exportTimelineBtn.disabled = empty;
    this.exportTimelineBtn.title = empty
      ? "Add a keyframe first — there's nothing to back up yet"
      : this.exportTimelineTitle;

    this.timelinePlayBtn.disabled =
      !this.timelineActive && (!this.timelineAvailable || empty);
    this.timelinePlayBtn.title = !this.timelineAvailable
      ? "Unavailable: your system asks for reduced motion"
      : empty
        ? "Add a keyframe or two first"
        : this.timelinePlayTitle;

    // Mid-offline-export (fr-92t9) the button is the run's cancel
    // affordance: always enabled, whatever the availability/active flags
    // say (the run being active is exactly why it must stay clickable).
    if (this.timelineExportProgress !== null) {
      this.timelineExportBtn.disabled = false;
      this.timelineExportBtn.title =
        "Stop exporting — the partial clip still saves";
      return;
    }
    this.timelineExportBtn.disabled =
      !this.timelineAvailable || empty || this.timelineActive;
    this.timelineExportBtn.title = !this.timelineAvailable
      ? "Unavailable: your system asks for reduced motion"
      : empty
        ? "Add a keyframe or two first"
        : this.timelineActive
          ? "Already playing — stop first"
          : this.timelineExportTitle;
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
      this.showLegendSwatchStrip(state.transforms);
      return;
    }
    // The legend narrates the ACTIVE RENDER, so the render-mode branches
    // come BEFORE the document-4D-ness one (fr-skhv round 2): the surface/
    // flame/solid sessions color by their OWN sources whatever the
    // document's dimension, and the fourDColor legend below describes the
    // POINTS view alone. The old order short-circuited every 4D document
    // into the explorer's −w/+w ramp — a 4D surface session rendered
    // by-transform colors under a w-depth legend that described nothing on
    // screen.
    if (state.renderMode === "surface") {
      const source = state.surface.colorSource;
      if (source === "transform") {
        this.showLegendSwatchStrip(state.transforms);
        return;
      }
      // The key samples the EXACT ramp the tracer samples: surfaceColorLUT
      // is the one definition of what setSurfaceColorLUT uploads
      // (control-spec.ts), so the legend can never drift from the rendered
      // colors — the same no-second-definition discipline as the colorMode
      // ramps below.
      const lut = surfaceColorLUT(state);
      if (lut === null) {
        // Unreachable: every non-transform source builds a LUT.
        this.legend.classList.add("hidden");
        return;
      }
      if (source === "palette" || source === "rings" || source === "sheets") {
        // rings/sheets (fr-rl4b) ride the same descent hit-info as palette,
        // just reading a different coordinate off it — same named-gradient
        // legend.
        const name = paletteDisplayName(
          this.scalarSelect("surfacePalette"),
          state.surface.paletteId,
        );
        this.showLegendBar(lutGradient(lut), "", `${name} palette`, "");
        return;
      }
      this.showLegendBar(
        lutGradient(lut),
        source === "height" ? "low" : "center",
        "",
        source === "height" ? "high" : "edge",
      );
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

    if (nonFlat) {
      const mode = state.fourDColor;
      if (mode === "transform") {
        this.showLegendSwatchStrip(state.transforms);
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
      this.showLegendSwatchStrip(state.transforms);
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
   * {@link transformColors} palette. Takes the full transform list, not just
   * a count, so an authored `colorIndex` (fr-axxl) reaches the palette. */
  private showLegendSwatchStrip(transforms: readonly Transform[]): void {
    this.legend.classList.remove("hidden");
    this.legendBar.classList.add("hidden");
    this.legendLabels.classList.add("hidden");
    this.legendSwatches.classList.remove("hidden");
    this.renderLegendSwatches(transforms);
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
  private renderLegendSwatches(transforms: readonly Transform[]): void {
    this.legendSwatches.replaceChildren();
    const count = transforms.length;
    const palette = transformColors(
      count,
      transforms.map((t) => t.colorIndex),
    );
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
   * diagnosable. `software` (fr-tmgf) is the worker backend event's own
   * GPUAdapterInfo fallback/SwiftShader tell, escalating this note's tier:
   * true swaps the note's class from informational `.flame-note-info` to
   * warning `.flame-note` — software rasterization must not pass as a
   * normal backend note. The swap runs on every non-null call (not just
   * the software→hardware transition), so a later hardware backend note
   * un-escalates cleanly. `null` hides the note, mirroring
   * {@link setFlameSupersampleNote}'s contract (cleared at the start of
   * every render, before the fresh worker reports its own) — classes are
   * left alone on that path, since hidden is hidden either way.
   */
  setFlameBackendNote(
    backend: "gpu" | "cpu" | null,
    adapter?: string,
    detail?: string,
    software = false,
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
    this.flameBackendNote.classList.toggle("flame-note", software);
    this.flameBackendNote.classList.toggle("flame-note-info", !software);
    this.flameBackendNote.classList.remove("hidden");
  }

  /**
   * Device-level software-rasterizer warning (fr-tmgf): unlike the
   * per-mode notes elsewhere in this file, this one sits OUTSIDE every
   * render mode (see `softwareRendererNote`'s placement in index.html,
   * ahead of `flameStatus`) because a silently software-rendered session
   * — the trigger incident was a browser-blocklisted GPU — is exactly as
   * misleading in Points as it is in Flame or Surface. Warning-tier
   * `.flame-note` (red, `var(--bad)`) per the style.css contract:
   * software rasterization standing in for the real GPU is a "not quite
   * what you asked for" condition, not a routine informational note. A
   * runtime, device-dependent fact that isn't part of `AppState`, so —
   * like {@link setFlameBackendNote} — this is a targeted setter main.ts
   * calls directly rather than something `updateLabels` derives. `null`
   * hides the note.
   */
  setSoftwareRendererNote(text: string | null): void {
    if (text === null) {
      this.softwareRendererNote.textContent = "";
      this.softwareRendererNote.classList.add("hidden");
      return;
    }
    this.softwareRendererNote.textContent = text;
    this.softwareRendererNote.classList.remove("hidden");
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
   * Reflect the surface render's marchability (epic fr-7jlk, from
   * `analyzeSurfaceSystem` + the uniform-array cap): `ineligible` disables
   * the mode button outright with the reason in its tooltip (the mode
   * physically can't run — no valid distance estimator); `degraded` keeps it
   * enabled but shows `detail` as an in-mode note (anisotropic maps marched
   * conservatively); `eligible` restores the default affordance. main.ts
   * recomputes this on every document change, so the button tracks edits
   * live — including while some other render is active.
   */
  setSurfaceEligibility(
    status: "eligible" | "degraded" | "ineligible",
    detail: string | null,
  ): void {
    const button = this.modeButtons.surface;
    const blocked = status === "ineligible";
    button.disabled = blocked;
    button.title = blocked
      ? `Surface render unavailable: ${detail ?? "not marchable"}`
      : "Sphere-traced surface of the attractor";
    if (status === "degraded" && detail) {
      this.surfaceNote.textContent = detail;
      this.surfaceNote.classList.remove("hidden");
    } else {
      this.surfaceNote.textContent = "";
      this.surfaceNote.classList.add("hidden");
    }
  }

  /**
   * Reflect the surface trace's coverage (fr-zx34): heavy fold poses grind
   * their preview/settle strip jobs for seconds to MINUTES, and the mode's
   * verdict is to never give up on a frame — this row is what lets the
   * user decide whether the pose is worth the wait. Same text-plus-underline
   * idiom as {@link setFlameProgress}; `null` hides the row (instant
   * renders and settled frames, the common case, never show it). Unlike
   * the flame/solid rows it hides rather than parking at 0%, because
   * most surface renders finish within a frame or two and a permanent
   * "0%" would read as a stuck render. POSE-derived and polled from the
   * render loop — never shares {@link setSurfaceEligibility}'s
   * document-derived note element. `detail` (fr-tmgf) is a fallback-reason
   * token ("compute failed" / "compute unavailable") appended TRAILING
   * after the percentage, so the engine token and percentage stay the
   * prominent read — the fr-tmgf legibility lesson: the eye catches
   * leading tokens.
   *
   * `skippable` (fr-37c6) shows the one-shot "Skip preview" button under
   * the row — main.ts passes it exactly while a preview is grinding (the
   * phase with a full render to skip TO): a WebGL preview strip job, or
   * the compute path's unbudgeted completion pass (fr-ud7n). The button
   * hides with the row, and settles never show it (there is nothing after
   * a settle to skip to).
   */
  setSurfaceProgress(
    progress: {
      label: string;
      pct: number;
      detail?: string;
      skippable?: boolean;
    } | null,
  ): void {
    this.surfaceSkipPreviewBtn.classList.toggle(
      "hidden",
      progress?.skippable !== true,
    );
    if (progress === null) {
      // Clear text too, not just hide: a stale "99%" left in textContent
      // reads as a live percent to settle-scraping harnesses (fr-d6g5).
      this.surfaceProgress.textContent = "";
      this.surfaceProgress.classList.add("hidden");
      this.surfaceProgress.style.setProperty("--progress", "0%");
      return;
    }
    this.surfaceProgress.textContent = `${progress.label} ${String(progress.pct)}%${progress.detail ? ` — ${progress.detail}` : ""}`;
    this.surfaceProgress.style.setProperty(
      "--progress",
      `${String(progress.pct)}%`,
    );
    this.surfaceProgress.classList.remove("hidden");
  }

  /** Seed the "Quick previews" checkbox from the stored viewer pref at boot
   * (fr-37c6) — the checkbox itself is the live source of truth afterward,
   * so this is a one-time write, not a sync. */
  setSurfacePreviewToggle(on: boolean): void {
    this.surfacePreviewToggle.checked = on;
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

    const palette = transformColors(
      transforms.length,
      transforms.map((t) => t.colorIndex),
    );
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
            ...colorSummary(t),
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
   *
   * `transformCount` is how many base maps the system holds — everything else
   * the editor shows is a property of the transform itself, but the Color
   * group's derived palette slot (fr-hiyu) is a property of the map's
   * position among ALL of them (`chaos-game.ts`'s `derivedColorIndex`), so it
   * has to be passed in rather than inferred here. Required, not defaulted:
   * a silently-assumed count would render a plausible but wrong slot.
   */
  renderTransformEditor(
    transform: Transform | null,
    target: EditTarget,
    transformCount: number,
  ): void {
    if (!transform || target === null) {
      this.transformEditor.replaceChildren();
      this.editor = null;
      return;
    }
    if (!this.editor || this.editor.target !== target) {
      this.buildEditor(transform, target, transformCount);
    } else {
      this.syncEditor(transform, transformCount);
    }
  }

  /**
   * Create one collapsible editor group (fr-64ku). The editor measured 786px
   * of the Transforms section's 1253px on a 393x727 phone — two and a half
   * screens for one selected transform, and nearly every pixel of it a live
   * slider a thumb has to cross to scroll past. Only one group is ever being
   * edited at a time, so they collapse into an exclusive sub-accordion under
   * one shared `name`.
   *
   * The 4D group (fr-bf6.3) was already exactly this shape; the other seven
   * join it. Sharing the `name` is also what folds 4D's bespoke
   * open-when-`w`-is-present rule into a single decision — under exclusivity
   * at most one group can win, so the choice has to be made in one place
   * ({@link buildEditor}) rather than per group.
   */
  private createEditorGroup(title: string, openGroup: string): HTMLElement {
    const group = this.doc.createElement("details");
    group.className = "editor-group";
    // setAttribute, not `.name`: the property reached lib.dom later than the
    // attribute reached browsers, and only the attribute drives exclusivity.
    group.setAttribute("name", EDITOR_GROUP_NAME);
    group.open = title === openGroup;

    const summary = this.doc.createElement("summary");
    summary.className = "editor-group-title";
    summary.textContent = title;
    group.appendChild(summary);

    // Only opens are recorded. The exclusive accordion closes the outgoing
    // group in the same turn, and reacting to that close would race the
    // incoming group's own toggle for the last word.
    group.addEventListener("toggle", () => {
      if (group.open) this.editorOpenGroup = title;
    });
    return group;
  }

  private buildEditor(
    transform: Transform,
    target: number | "final",
    transformCount: number,
  ): void {
    this.transformEditor.replaceChildren();

    // The final transform omits Weight and Color (see below), so a remembered
    // choice of either would build an editor with nothing open at all.
    const remembered =
      target === "final" &&
      (this.editorOpenGroup === "Weight" || this.editorOpenGroup === "Color")
        ? null
        : this.editorOpenGroup;
    // Resolved per build and deliberately NOT written back to
    // `editorOpenGroup`: leaving the field null until a real user toggle keeps
    // fr-bf6.3's rule alive for every 4D transform selected before then, not
    // just the first one the session happens to build.
    const openGroup =
      remembered ?? (transform.w !== undefined ? "4D" : DEFAULT_EDITOR_GROUP);

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
      // Copied RAW, unresolved (fr-hiyu): `undefined` here is the transform's
      // real state — "authors none, so the renderers derive it" — and keeping
      // it that way is what lets an unrelated edit round-trip a map without
      // materializing either key. The rows resolve for DISPLAY only; see
      // buildColorControls.
      colorIndex: transform.colorIndex,
      colorSpeed: transform.colorSpeed,
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
      const group = this.createEditorGroup(spec.title, openGroup);

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
      target === "final"
        ? null
        : this.buildWeightControl(geometry.weight, openGroup);
    // Color sits directly below Weight and above Variations (fr-hiyu): the
    // two per-map structural-color fields belong beside the other whole-map
    // property the chaos game reads when it PICKS this map, not among the
    // geometry channels. Omitted for the final transform for that same
    // reason — see buildColorControls.
    const colorControls =
      target === "final"
        ? null
        : this.buildColorControls(
            target,
            transformCount,
            geometry.colorIndex,
            geometry.colorSpeed,
            openGroup,
          );
    const { list, add } = this.buildVariationsGroup(openGroup);
    // Placed last (after Variations): a deliberate choice to leave the
    // existing layout for every ordinary (flat) transform undisturbed — this
    // is purely an opt-in extension appended at the end, always built (never
    // conditionally omitted) so add/remove/selection keep working uniformly
    // whether or not this transform (or system) is currently non-flat.
    const fourD = this.buildFourDGroup(transform, openGroup);

    this.editor = {
      target,
      geometry,
      controls,
      mirror,
      weightControl,
      colorControls,
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
  private buildWeightControl(weight: number, openGroup: string): AxisControl {
    const group = this.createEditorGroup("Weight", openGroup);

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
   * Build the "Color" group (fr-hiyu): the two per-map structural-color
   * fields — the palette slot this map pulls the color coordinate toward
   * (`Transform.colorIndex`, flam3's per-xform `color`) and how far each pick
   * moves it (`Transform.colorSpeed`, flam3's `color_speed`). Both the flame
   * and the solid render walk that coordinate when a gradient palette is
   * active (`flame.ts` / `voxel.ts` and their 4D twins); the surface render
   * reads the same `colorIndex` slot too, under its orbit-trap "Palette"
   * color source, but `colorSpeed` never reaches it — the surface descends a
   * map rather than picking one, so it has nothing to walk with. A system
   * authored here colors identically in all three, wherever a gradient
   * palette applies.
   *
   * Both rows show the RESOLVED value, so the user reads what the renderer
   * actually uses rather than a blank: the authored number when there is one,
   * else the fallback the kernels themselves apply — `chaos-game.ts`'s
   * {@link derivedColorIndex} and {@link DEFAULT_COLOR_SPEED}, called here
   * rather than re-derived, so the editor cannot drift from the CPU oracle,
   * the WGSL kernels, `morph.ts` or `.flame` export. Displaying a value is
   * NOT authoring one: the transform keeps neither key until a slider
   * actually moves (see {@link emitGeometry}), because `types.ts` makes
   * absence load-bearing — it is what keeps existing saved scenes
   * byte-identical and keeps morph/mutate/persist on their documented absent
   * paths.
   *
   * Linear sliders, unlike the log-scaled weight above: both fields are
   * positions in `[0, 1]` — a slot on the gradient and a blend fraction — not
   * magnitudes spanning orders of magnitude. The `0.01` step matches the
   * two-decimal readouts exactly, so the thumb never sits somewhere the
   * number doesn't say.
   *
   * Built only for a numbered transform. The final transform is applied to
   * every plotted point and is never PICKED, so it never moves the color
   * coordinate — showing it a dead pair of sliders would be a lie, the same
   * reason its editor omits the selection weight.
   */
  private buildColorControls(
    target: number,
    transformCount: number,
    colorIndex: number | undefined,
    colorSpeed: number | undefined,
    openGroup: string,
  ): ColorControls {
    const group = this.createEditorGroup("Color", openGroup);

    // The two fields do not share one reach (fr-c6yd). Index also steers a
    // Surface render, but only under its Palette (orbit-trap) color source —
    // `surface-slots.ts`'s `surfaceTrapIndices` reads the authored slot there
    // without walking it, since the surface descends a map rather than picking
    // one. Speed stays narrower: it only moves the coordinate in a Flame or
    // Solid render with a gradient palette active, the two that actually walk
    // it (`flame.ts`'s accumulateFlame and `voxel.ts`'s accumulateVoxels, plus
    // their 4D twins) — and nothing else on screen would say so. The group is
    // NOT hidden by render mode, though: it is document data that also arrives
    // by `.flame` import, so it stays visible and editable wherever the user
    // is, and a one-line note in the panel's existing hint idiom (the dim
    // `.flame-hint` paragraph index.html uses for the render-mode and 4D
    // notes) carries the caveat instead.
    const hint = this.doc.createElement("p");
    hint.className = "flame-hint";
    hint.textContent =
      "Gradient palettes only: Index is the ramp slot this map pulls toward, in Flame, Solid and Surface's Palette source; Speed is how far each pick moves — Flame and Solid only.";
    group.appendChild(hint);

    const derivedIndex = derivedColorIndex(target, transformCount);
    const index = this.buildColorRow(
      group,
      "Index",
      "Color index",
      "Palette slot this map pulls the color toward. Unset ⇒ spread evenly by map order.",
      colorIndex ?? derivedIndex,
      (value) => this.onColorIndexInput(value),
    );
    const speed = this.buildColorRow(
      group,
      "Speed",
      "Color speed",
      "How far each pick moves the color toward this map's slot: 0 keeps the incoming color, 1 snaps to the slot.",
      colorSpeed ?? DEFAULT_COLOR_SPEED,
      (value) => this.onColorSpeedInput(value),
    );

    this.transformEditor.appendChild(group);
    return { index, speed, derivedIndex };
  }

  /**
   * One row of the {@link buildColorControls} group — the same shape as the
   * per-axis rows and {@link buildWeightControl} (label, slider, live
   * readout), with two differences the Color rows need: a `title` tooltip
   * (each field's meaning is not guessable from a one-word label), and the
   * `color-row` class that widens the label column, which is sized for
   * single-letter axis names.
   *
   * Slider units ARE model units here (no `toSlider`/`fromSlider` pair like
   * the weight and 4D rows carry) — both fields are already the `[0, 1]`
   * numbers `Transform` stores.
   */
  private buildColorRow(
    group: HTMLElement,
    label: string,
    ariaLabel: string,
    title: string,
    initial: number,
    onInput: (value: number) => void,
  ): AxisControl {
    const row = this.doc.createElement("div");
    row.className = "editor-row color-row";

    const name = this.doc.createElement("span");
    name.className = "axis";
    name.textContent = label;

    const slider = this.doc.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.value = String(initial);
    slider.setAttribute("aria-label", ariaLabel);
    slider.title = title;

    const readout = this.doc.createElement("span");
    readout.className = "value";
    readout.textContent = initial.toFixed(2);

    slider.addEventListener("input", () => onInput(Number(slider.value)));

    row.append(name, slider, readout);
    group.appendChild(row);
    return { slider, readout };
  }

  /**
   * Build the "Variations" group: a title, the (initially empty) row list, and
   * the add-variation dropdown. Rows themselves are filled by
   * {@link renderVariationRows} once the editor state exists.
   */
  private buildVariationsGroup(openGroup: string): {
    list: HTMLElement;
    add: HTMLSelectElement;
  } {
    const group = this.createEditorGroup("Variations", openGroup);

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
      if (isFoldVariationType(variation.type)) {
        this.appendFoldRadiusRows(variation.type, i);
      }
    });
  }

  /**
   * The fold's three authored lengths (fr-s9ll), as rows nested under their
   * own variation's weight row — only the ones that fold reads
   * ({@link FOLD_RADIUS_FIELDS}).
   *
   * A length is written into the document ONLY once its slider moves, and
   * dragging one back to its classic value REMOVES it again. That is what
   * keeps `types.ts`'s "absent means the classic Mandelbox values
   * BYTE-IDENTICALLY" true through an editing session: opening the editor
   * on an old scene, or touching a neighbouring control, leaves an
   * unparameterized fold with no keys at all — not three keys that happen
   * to hold the defaults.
   */
  private appendFoldRadiusRows(
    type: "boxfold" | "spherefold" | "mandelbox",
    index: number,
  ): void {
    const editor = this.editor;
    if (!editor) return;
    const valueOf = (key: FoldRadiusKey): number =>
      editor.variations[index][key] ?? CLASSIC_FOLD_RADII[key];
    const write = (key: FoldRadiusKey, value: number): void => {
      if (value === CLASSIC_FOLD_RADII[key]) {
        delete editor.variations[index][key];
      } else {
        editor.variations[index][key] = value;
      }
    };
    const minRow: { slider: HTMLInputElement; readout: HTMLElement }[] = [];
    // The fold's domain is 0 < mR <= fR: lowering the fixed radius past the
    // min radius carries the min radius down with it, rather than leaving a
    // readout the estimator would silently clamp.
    const followFixedRadius = (): void => {
      const row = minRow[0];
      if (!row) return;
      const fR = valueOf("fixedRadius");
      row.slider.max = String(fR);
      if (valueOf("minRadius") > fR) {
        write("minRadius", fR);
        row.slider.value = String(fR);
        row.readout.textContent = fR.toFixed(3);
      }
    };
    for (const key of FOLD_RADIUS_FIELDS[type]) {
      const row = this.doc.createElement("div");
      row.className = "editor-row variation-row variation-fold-row";

      const name = this.doc.createElement("span");
      name.className = "axis";
      name.textContent = FOLD_RADIUS_LABELS[key];

      const slider = this.doc.createElement("input");
      slider.type = "range";
      slider.min = String(key === "boxLimit" ? BOX_LIMIT_MIN : FOLD_RADIUS_MIN);
      slider.max = String(
        key === "boxLimit"
          ? BOX_LIMIT_MAX
          : key === "minRadius"
            ? valueOf("fixedRadius")
            : FOLD_RADIUS_MAX,
      );
      slider.step = String(FOLD_RADIUS_STEP);
      slider.value = String(valueOf(key));
      slider.setAttribute(
        "aria-label",
        `${variationLabel(type)} ${FOLD_RADIUS_LABELS[key].toLowerCase()}`,
      );

      const readout = this.doc.createElement("span");
      readout.className = "value";
      readout.textContent = valueOf(key).toFixed(3);

      slider.addEventListener("input", () => {
        const value = Number(slider.value);
        write(key, value);
        readout.textContent = value.toFixed(3);
        if (key === "fixedRadius") followFixedRadius();
        this.emitGeometry();
      });

      row.append(name, slider, readout);
      if (key === "minRadius") minRow.push({ slider, readout });
      editor.variationList.appendChild(row);
    }
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
   * This was the editor's only collapsible group until fr-64ku made all eight
   * collapsible and exclusive, so the open/closed decision moved out to
   * {@link buildEditor} — under one shared `name` only one group can win, and
   * that has to be decided in one place. The rule this group contributed
   * survives there: `transform.w` already present (flat/trivial or not) opens
   * 4D, so a system authored via preset or URL hash shows its 4D values
   * instead of hiding them a click away. Only a fresh selection decides —
   * {@link syncFourDControls} never touches `.open`, so a user's manual
   * toggle is never fought mid-session.
   */
  private buildFourDGroup(
    transform: Transform,
    openGroup: string,
  ): FourDControls {
    const details = this.createEditorGroup("4D", openGroup);

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

  private syncEditor(transform: Transform, transformCount: number): void {
    const editor = this.editor;
    if (!editor) return;
    editor.geometry = {
      position: clone3(transform.position),
      rotation: clone3(transform.rotation),
      scale: clone3(transform.scale),
      shear: clone3(transform.shear ?? [0, 0, 0]),
      weight: transform.weight ?? 1,
      w: cloneW(transform.w),
      // Raw again (see buildEditor): an undo back past the first Color edit
      // returns a transform with the keys gone, and the working copy has to
      // forget them too or the next unrelated edit would write them back.
      colorIndex: transform.colorIndex,
      colorSpeed: transform.colorSpeed,
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
    // The `typeof` narrows what the group's existence already guarantees (it
    // is built only for a numbered target) — and the derived slot is
    // re-resolved rather than reused, because adding or removing a map moves
    // every OTHER map's slot without moving the selection.
    if (editor.colorControls && typeof editor.target === "number") {
      const color = editor.colorControls;
      color.derivedIndex = derivedColorIndex(editor.target, transformCount);
      const index = editor.geometry.colorIndex ?? color.derivedIndex;
      color.index.slider.value = String(index);
      color.index.readout.textContent = index.toFixed(2);
      const speed = editor.geometry.colorSpeed ?? DEFAULT_COLOR_SPEED;
      color.speed.slider.value = String(speed);
      color.speed.readout.textContent = speed.toFixed(2);
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

  /**
   * Author this map's palette slot (fr-hiyu). Writing the working copy is
   * exactly what MATERIALIZES the optional field: until a slider fires this,
   * the row has only been displaying `chaos-game.ts`'s derived slot and the
   * transform carries no `colorIndex` key at all (see
   * {@link buildColorControls} and {@link emitGeometry}).
   */
  private onColorIndexInput(value: number): void {
    const editor = this.editor;
    // The Color rows only exist for a numbered transform, so their controls
    // are always present when this fires; the guard satisfies the nullable type.
    if (!editor || !editor.colorControls) return;
    editor.geometry.colorIndex = value;
    editor.colorControls.index.readout.textContent = value.toFixed(2);
    this.emitGeometry();
  }

  /** Author this map's color speed — {@link onColorIndexInput}'s twin, and
   * likewise the only path that materializes the key. */
  private onColorSpeedInput(value: number): void {
    const editor = this.editor;
    if (!editor || !editor.colorControls) return;
    editor.geometry.colorSpeed = value;
    editor.colorControls.speed.readout.textContent = value.toFixed(2);
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
        // Sparse exactly like `w` above (fr-hiyu), and load-bearing for the
        // same reason: these keys are emitted ONLY once the user has moved
        // their slider. Selecting a map, dragging its guide box, or editing
        // any other row leaves an unauthored map with NO colorIndex /
        // colorSpeed key — `state.ts`'s updateTransform merges, so an absent
        // key preserves absence, and absence is what keeps the derived slot
        // (and every scene saved before this field existed) byte-identical
        // through the round trip. See `types.ts`'s field docs.
        ...(editor.geometry.colorIndex !== undefined
          ? { colorIndex: editor.geometry.colorIndex }
          : {}),
        ...(editor.geometry.colorSpeed !== undefined
          ? { colorSpeed: editor.geometry.colorSpeed }
          : {}),
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
