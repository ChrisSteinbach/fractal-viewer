import { meanContraction } from "../fractal/affine4";
import {
  DEFAULT_COLOR_SPEED,
  derivedColorIndex,
  effectiveSymmetryOrder,
  MAX_TRANSFORMS,
  prepareChaosGame,
  resolveChaosEntry,
} from "../fractal/chaos-game";
import {
  colorModeUsesGamma,
  colorModeUsesRampPalette,
  fourDColorNeedsAttribute,
  LEGACY_POSITION_AXIS_COLORS,
  transformColors,
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
  RgbStop,
} from "../fractal/palette";
import { VARIATION_TYPES } from "../fractal/types";
import type { ShapeSpec } from "../fractal/shapes";
import { CLASSIC_FOLD_RADII, isFoldVariationType } from "../fractal/variations";
import {
  CLASSIC_SURFACE_FINISH,
  isClassicSurfaceFinish,
  resolveSurfaceFinish,
} from "../fractal/surface-finish";
import type { ResolvedSurfaceFinish } from "../fractal/surface-finish";
import {
  PATTERN_DEFAULT_SCALE,
  resolveSurfacePattern,
  SURFACE_PATTERN_AXES,
  SURFACE_PATTERN_DEFAULT_AXIS,
  SURFACE_PATTERN_DEFAULT_STRENGTH,
  SURFACE_PATTERN_KINDS,
} from "../fractal/surface-pattern";
import type {
  ResolvedSurfacePattern,
  SurfacePattern,
  SurfacePatternAxis,
  SurfacePatternKind,
} from "../fractal/surface-pattern";
import type {
  SurfaceFinish,
  Transform,
  Variation,
  VariationType,
  Vec3,
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
  DEFAULT_FLAME_PALETTE,
  RENDER_MODES,
  MAX_W_ANGLE,
  MAX_W_POSITION,
  MAX_W_SCALE,
  MAX_W_SHEAR,
  MIN_W_ANGLE,
  MIN_W_POSITION,
  MIN_W_SCALE,
  MIN_W_SHEAR,
  detectXaosBlocks,
  detectXaosLeaks,
  resolveBalloonPalette,
  systemIsNonFlat,
} from "./state";
import type { XaosLeak } from "./state";
import {
  formatIterationCount,
  SCALAR_CONTROLS,
  shapeTrapGeometryBandMode,
} from "./control-spec";
import type { ScalarControlSpec } from "./control-spec";
import {
  surfaceTrapGeometryRestriction,
  type SurfaceEligibilityRecovery,
  type SurfaceRouteKind,
} from "./surface-eligibility";
import {
  BALLOON_CENTRE_REFUSAL_REASON,
  resolvePanelApplicability,
  type PanelApplicability,
  type PanelContext,
  type SurfaceSessionKind,
} from "./panel-applicability";
import { deriveLegend, lutGradient } from "./legend-spec";
import type { LegendPaletteControl, LegendSpec } from "./legend-spec";
import {
  MOBILE_BREAKPOINT,
  MIN_GUIDE_SCALE,
  MAX_GUIDE_SCALE,
} from "./constants";
import type { ExportProgressInit } from "./export-progress";
import { videoCaptureSupported } from "./recorder";
import { offlineExportSupported } from "./video-encode";
import { installSliderScrollGuard } from "./slider-scroll-guard";
import {
  BUNDLED_EMITTER_SHAPES,
  BUNDLED_TRAP_SHAPES,
  bundledEmitterForShape,
  bundledShapeEntry,
  bundledShapeOptionLabel,
  type BundledEmitterKind,
  type BundledShapeDefinition,
} from "./bundled-shapes";

export type { Preset };
export type { SurfaceSessionKind } from "./panel-applicability";

/** The geometry (and weight/variations) a transform editor edits. `w` is the
 * optional 4D extension (see `types.ts`'s `WExtension`) — included here so
 * the single editor can be the one UI that creates/edits it, but see
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
  | "finish"
  | "surfacePattern"
>;

/** The final transform's geometry — the same, minus the fields that only mean
 * something for a map the chaos game PICKS: the selection weight, and the two
 * structural-color fields, which move the color coordinate on each pick. A
 * lens applied to every plotted point has neither — nor a surface finish:
 * the tracers shade a hit by the SLOT that produced it, and a lens is not a
 * slot (it is applied over every slot's output), so nothing would ever read
 * one authored there. */
type FinalGeometry = Omit<
  Geometry,
  "weight" | "colorIndex" | "colorSpeed" | "finish" | "surfacePattern"
>;

/** The current edit target: a transform index, the final transform, or none. */
type EditTarget = number | "final" | null;

export interface UiHandlers {
  onAdd: () => void;
  /** Add and select a new transform carrying the chosen built-in shape. */
  onAddEmitter: (kind: BundledEmitterKind) => void;
  onRemove: () => void;
  /** Step the scene document back one edit burst. */
  onUndo: () => void;
  /** Step the scene document forward one edit burst. */
  onRedo: () => void;
  onPreset: (preset: Preset) => void;
  /**
   * The Hybrid schedule section's System B picker changed: `source` is
   * `""` (None — remove the block), `"preset:<key>"` (a preset menu entry)
   * or `"saved:<id>"` (a saved-scene collection entry). main.ts resolves
   * the source's transforms and installs their stripped affine part via
   * `state.ts`'s `setSchedule` — an ordinary undoable document edit.
   */
  onScheduleSource: (source: string) => void;
  /** The Hybrid schedule's "Use current system as B" button was clicked:
   * snapshot the live transform list (stripped to its affine part) as B. */
  onScheduleSnapshot: () => void;
  /** The Hybrid schedule's depth slider moved: an integer 0..5, where 0
   * removes the block (the classic-removal rule). */
  onScheduleDepth: (depth: number) => void;
  /**
   * The Xaos section's "+ Add as block" button was clicked: `source` is
   * `"__duplicate"` (clone the current system), `"preset:<key>"`, or
   * `"saved:<id>"` — the Hybrid schedule picker's own vocabulary, read off
   * the same select. `balanceWeights` is the checkbox's checked state. The
   * app resolves the source, measures both systems' extent, and appends
   * the block-structured result through `state.ts`'s `appendXaosBlock` —
   * refusing (a toast, nothing appended) past the transform cap.
   */
  onXaosAddBlock: (source: string, balanceWeights: boolean) => void;
  /** A Xaos matrix cell committed a new chi value — `fromIndex`/`toIndex`
   * are transform indices (row = FROM map, column = TO map, matching
   * `chaos-game.ts`'s `Transform.chaos` convention), `value` the raw typed
   * number (already validated finite and non-negative; a bad edit never
   * reaches here — the cell restores its previous display instead). */
  onXaosCell: (fromIndex: number, toIndex: number, value: number) => void;
  /** The Xaos leak dial for one block pair moved — `blockA`/`blockB` are
   * the transform indices `detectXaosLeaks` grouped, `leak` the dial's
   * value. `phase` mirrors {@link onScalarControl}'s: "input" fires on
   * every drag tick (live, no matrix rebuild), "commit" once on release
   * (when the matrix/leak rows resync). */
  onXaosLeak: (
    blockA: number[],
    blockB: number[],
    leak: number,
    phase: "input" | "commit",
  ) => void;
  /** "Surprise Me" was clicked: roll a fresh random IFS and load it like a preset. */
  onSurprise: () => void;
  /** "🧬 Mutate" was clicked: open the mutation-grid modal. The app builds
   * the candidates and fills the cells via {@link Ui.openMutations} /
   * {@link Ui.setMutationCell}. */
  onOpenMutations: () => void;
  /** A mutation cell was clicked: load candidate `index` (0..7) — a normal
   * undoable replace-load, morphing in like Surprise Me — after which the
   * app re-seeds the grid around the pick. */
  onMutationPick: (index: number) => void;
  /** The mutation modal's "↻ Mutate again" was clicked: roll eight fresh
   * candidates from the same current system. */
  onMutateAgain: () => void;
  /** "▶ Drift" was clicked: toggle the ambient drift show — session-only, like
   * the auto-orbit/tumble motion; main.ts owns the policy. */
  onDriftToggle: () => void;
  /**
   * A table-driven scalar control changed (see control-spec.ts's
   * SCALAR_CONTROLS): `raw` is the element's `value` string (range/select)
   * or `checked` flag (checkbox), applied via `applyScalarControl`.
   * Per-control semantics — which edits restart accumulation, which are
   * live-reactive, which forward to a render worker — are documented on the
   * spec entries themselves.
   *
   * `phase` distinguishes the live "input" stream (fired on every
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
   * a JSON file — the file counterpart of "🔗 Copy link". */
  onSaveSceneFile: () => void;
  /** "⤓ Export .flame" was clicked: download the system's XY shadow as a
   * flam3/Apophysis .flame file (`flame-file.ts`). */
  onSaveFlameFile: () => void;
  /** "★ Save to collection" was clicked: snapshot the current scene into the
   * saved-scene collection. */
  onSaveToCollection: () => void;
  /** "▦ Gallery" was clicked: open the saved-scene gallery modal. The app
   * hands the current collection back via {@link Ui.openGallery}. */
  onOpenGallery: () => void;
  /** The gallery modal's "▶ Drift collection" was clicked: start the drift
   * show over the saved collection instead of random rolls — main.ts owns
   * the playlist policy, like onDriftToggle. */
  onDriftCollection: () => void;
  /** A gallery thumbnail was clicked: load that saved scene by its id
   * (whole-system replacement, like a preset load). */
  onLoadFromCollection: (id: string) => void;
  /** A gallery card's ✕ was clicked: delete that saved scene by its id. */
  onDeleteFromCollection: (id: string) => void;
  /** "📍 Add keyframe" was clicked: append the current view — scene
   * document + camera pose + a thumbnail of what's showing — to the
   * animation timeline. */
  onTimelineAddKeyframe: () => void;
  /** "▶ Play timeline" / "■ Stop" was clicked: toggle timeline playback —
   * session-only motion like the drift show; main.ts owns the policy. */
  onTimelinePlayToggle: () => void;
  /** "⏺ Export clip" was clicked: play the timeline while recording the
   * canvas to a downloadable video clip. */
  onTimelineExport: () => void;
  /** The export progress modal's Cancel button was clicked, or Escape was
   * pressed while it was open, cancellable, and the ONLY open modal (a
   * stacked Escape belongs to the dialog beneath): abort the in-flight
   * capture. Both routes land here rather than a bare hideExportProgress() —
   * the modal has no ✕ or backdrop close, since an accidental dismissal must
   * not silently abandon a multi-minute export. */
  onExportCancel: () => void;
  /** The export progress modal's second action was clicked: stop waiting for
   * the render to finish and save the picture as it stands. Shown only for a
   * run that offered it — see {@link Ui.showExportProgress}'s `deliverEarly`
   * — and deliberately NOT on the Escape route, which stays cancel-only. */
  onExportDeliverEarly: () => void;
  /** "⬇ Back up timeline" was clicked: download the authored timeline —
   * keyframe steps + the playback determinism seed — as a JSON backup file,
   * the timeline counterpart of {@link onExportCollection}. */
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
   * collection as a JSON backup file. */
  onExportCollection: () => void;
  /** An import file arrived — picked through "⬆ Import file"'s hidden
   * input, or dropped anywhere on the page (main.ts owns the drop
   * listeners): a scene file to load, a collection backup to merge, or a
   * timeline backup to restore. Reading and validating the untrusted bytes
   * is the app's job (`scene-file.ts`'s `decodeImportFile`), not this
   * layer's. */
  onImportFile: (file: File) => void;
  onSelect: (index: EditTarget) => void;
  /** A panel slider edited the selected transform's geometry. */
  onTransformGeometry: (index: number, geometry: Geometry) => void;
  /** Set or clear the selected transform's condensation shape. */
  onTransformEmitter: (index: number, kind: BundledEmitterKind | null) => void;
  /** The lens toggle was flipped: enable a default final transform, or clear it. */
  onToggleFinalTransform: (checked: boolean) => void;
  /** A panel slider edited the final transform's geometry. */
  onFinalTransformGeometry: (geometry: FinalGeometry) => void;
  onTogglePanel: () => void;
  onClosePanel: () => void;
  /**
   * A render-mode segment was clicked: switch which renderer displays the
   * attractor — `"points"` returns to the live explorer, `"flame"` freezes
   * the camera and starts a flame render, `"solid"` starts accumulating the
   * density volume (camera stays live). Fires for the already-active segment
   * too; the app treats that as a no-op.
   */
  onRenderMode: (mode: RenderMode) => void;
  /** The 3D auto-orbit was paused or resumed — the camera-side
   * sibling of {@link onFourDTumbleToggle}. */
  onAutoOrbitToggle: (checked: boolean) => void;
  /** The surface mode's "Quick previews" checkbox was flipped: `false` =
   * invalidations never trace the preview tier — the pane holds its last
   * frame while the view moves and the full render starts on park. A
   * per-browser viewer pref (like the motion toggles' autoMotion), and
   * flipping it off mid-grind takes effect immediately. */
  onSurfacePreviewToggle: (checked: boolean) => void;
  /** The progress row's "Skip preview" button was clicked: abandon the
   * in-flight preview and start the full-detail render of this view now.
   * One-shot — the next move previews as usual. */
  onSurfaceSkipPreview: () => void;
  /** The 3D orbit-speed slider moved: `value` is the rate multiplier (×). */
  onAutoOrbitSpeedInput: (value: number) => void;
  /** The 4D soft w-slice was toggled on or off. */
  onFourDSliceToggle: (checked: boolean) => void;
  /** The 4D slice-position slider moved: `value` is the slice center in
   * signed normalized rotated-w units, [-1, 1]. */
  onFourDSliceInput: (value: number) => void;
  /** The 4D slice-thickness slider moved: `value` is the slab's
   * HALF-thickness in the same normalized rotated-w units as
   * {@link onFourDSliceInput}'s center, [0, 0.5]. Surface-only — the row
   * is shown exactly in a live 4D surface session (see
   * {@link Ui.syncFourDViewRows}), whose tracer renders everything within
   * that much of the slice plane instead of the plane alone. */
  onFourDSliceThicknessInput: (value: number) => void;
  /** The slice-relative color option was toggled — recenter the w-ramp
   * color modes' diverging palette on the slice window. Session-only view
   * state, exactly like the slice toggle/position above. */
  onFourDSliceRelColorToggle: (checked: boolean) => void;
  /** The 4D auto-tumble was paused or resumed. */
  onFourDTumbleToggle: (checked: boolean) => void;
  /** The 4D tumble-speed slider moved: `value` is the rate multiplier (×). */
  onFourDTumbleSpeedInput: (value: number) => void;
  /** "▶ Watch it build" was clicked (in the About dialog or the panel):
   * replay how the chaos game accretes the current cloud, point by point. */
  onWatchBuild: () => void;
  /** "Inflate" was clicked: sweep the balloon echo's radius from a
   * crumpled ball out to its rest size, turning the echo on first if it
   * wasn't already. */
  onBalloonInflate: () => void;
  /** The gradient editor changed the custom palette's stop list — a
   * recolor, an added stop, or a removed stop; `stops` is the editor's
   * whole new list, parsed and ready for `setCustomPaletteStops`. */
  onCustomPaletteStops: (stops: RgbStop[]) => void;
  /** A mirrored balloon gradient editor changed its whole independent stop
   * list. This must never route through {@link onCustomPaletteStops}: the
   * primary and balloon Custom slots are separate document content. */
  onBalloonCustomPaletteStops: (stops: RgbStop[]) => void;
  /** The position mode's axis-color pickers changed — `colors` is the full
   * x/y/z triple as parsed from the three inputs; the Reset button sends the
   * exact legacy identity (the reducer normalizes it to absent). */
  onPositionAxisColors: (colors: PositionAxisColors) => void;
  /** The custom backdrop's top/bottom pickers changed — `custom` is the
   * full stop pair as parsed from the two inputs, ready for
   * `setBackgroundCustom`. Only reachable while the Background select sits
   * on Custom (the row is hidden otherwise). */
  onBackgroundCustom: (custom: BackgroundGradient) => void;
  /** The fog tint color picker changed — `hex` is the input's raw
   * `#rrggbb` value, ready for `setFogTint` (the reducer, not this
   * callback, is the validation boundary). The strength half of the pair
   * is table-driven (see control-spec.ts's `fogTintStrength` entry); this
   * callback only carries the bespoke color picker, like
   * `onBackgroundCustom` above. */
  onFogTint: (hex: string) => void;
  /** A balloon tint color picker changed — `hex` is the input's raw
   * `#rrggbb` value, ready for `setBalloonTint` (the reducer, not this
   * callback, is the validation boundary). ONE handler serves the Points,
   * Flame, Solid, and Surface pickers — one state field seen from four render modes,
   * exactly like `onFogTint` above. The strength half of the pair is
   * table-driven by each panel's scalar entry in control-spec.ts. */
  onBalloonTint: (hex: string) => void;
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
   * model's existing sign to the slider's magnitude-only reading (see the
   * Scale entry in {@link CHANNELS}), since otherwise every drag would
   * silently clear a mirror. Every other channel's slider already carries
   * the signed (or angular) model value directly, so their `fromSlider`
   * ignores the second parameter — fewer parameters than the type declares
   * is valid TypeScript.
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

// Scale bounds share the guide-box clamp (MIN/MAX_GUIDE_SCALE) used in
// interactions.ts. The scale sliders are magnitude-only; the sign lives on the
// Mirror toggles.
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

/** Shared `<details name>` for the transform editor's groups, so opening one
 * closes the rest — the same exclusive-accordion idiom the panel's outer
 * sections use, one level in. */
const EDITOR_GROUP_NAME = "transform-editor-group";

/** The group a fresh selection opens when the user has expressed no
 * preference and the transform is flat. */
const DEFAULT_EDITOR_GROUP = "Position";

/**
 * Deep-copy a transform's optional `w` extension (see `types.ts`'s
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

/** Sparse clone of a transform's optional finish — {@link cloneW}'s
 * shape: `undefined` stays `undefined`, and only the fields actually
 * present are copied (the object is flat, so a spread is exact). */
function cloneFinish(
  finish: SurfaceFinish | undefined,
): SurfaceFinish | undefined {
  return finish === undefined ? undefined : { ...finish };
}

/** Sparse clone of a transform's optional surface pattern —
 * {@link cloneFinish}'s twin (the object is flat, so a spread is exact). */
function cloneSurfacePattern(
  pattern: SurfacePattern | undefined,
): SurfacePattern | undefined {
  return pattern === undefined ? undefined : { ...pattern };
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
 * Variation blend-weight slider bounds. Linear (not log like selection
 * weight): a variation's strength reads naturally as a `-2…2` coefficient.
 * Negative weights are real objects, not degenerate ones — the classic
 * Mandelbox is `s = -1.5`, and reflection blends need `w < 0` — so the slider
 * reaches them directly instead of leaving them URL/`.flame`-import-only. `0`
 * contributes nothing but keeps the row; removal is the row's × button.
 */
const VARIATION_WEIGHT_MIN = -2;
const VARIATION_WEIGHT_MAX = 2;
const DEFAULT_VARIATION_WEIGHT = 1;

/** The fold family's three authored lengths. */
type FoldRadiusKey = "minRadius" | "fixedRadius" | "boxLimit";

/**
 * Which of the three lengths each fold actually READS. A box fold has no
 * sphere and a sphere fold has no wall, and a sweep measured exactly that:
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

/** The surface finish's six authored fields, in row order. */
type FinishKey = keyof ResolvedSurfaceFinish;

const FINISH_FIELDS: readonly FinishKey[] = [
  "specular",
  "shininess",
  "metalness",
  "reflect",
  "transmit",
  "reflectionTint",
];

const FINISH_LABELS: Record<FinishKey, string> = {
  specular: "Specular",
  shininess: "Shininess",
  metalness: "Metalness",
  reflect: "Reflect",
  transmit: "Transmit",
  reflectionTint: "Metal tint",
};

const FINISH_TITLES: Record<FinishKey, string> = {
  specular:
    "Highlight brightness — the Blinn-Phong specular strength. Classic 0.4; past it is an overdriven highlight.",
  shininess:
    "Highlight tightness — the Blinn-Phong exponent. Higher is a smaller, sharper highlight. Classic 32.",
  metalness:
    "How much this map's surface reads as metal: its highlight takes on the surface color. Classic 0.",
  reflect:
    "How much of the surroundings the surface mirrors — the environment reflection. Classic 0.",
  transmit:
    "How much light passes through as a thin shell — the transmission. Classic 0.",
  reflectionTint:
    "How much a metal inherits the transform color. Chrome uses 0 for neutral reflections; colored Metal uses 1.",
};

/**
 * Finish slider bounds. Four of the six are the fields' own `[0, 1]`
 * authored span (`surface-finish.ts`'s resolver clamps there too, so the
 * slider never shows a number the tracer is not using). `specular` reaches
 * 2 — five times the classic highlight, already a glare — and `shininess`
 * runs `1..256` in whole steps, a spread wide enough for the broad matte
 * lobe at one end and a pinpoint at the other. STEPS MATTER HERE: every
 * classic value and every bundle value below is exactly representable on
 * its slider's step, which is what lets a drag back to classic REMOVE the
 * field (see {@link Ui.writeFinishField}) rather than leave it authored
 * one quantum off.
 */
const FINISH_RANGES: Record<
  FinishKey,
  { min: number; max: number; step: number }
> = {
  specular: { min: 0, max: 2, step: 0.01 },
  shininess: { min: 1, max: 256, step: 1 },
  metalness: { min: 0, max: 1, step: 0.01 },
  reflect: { min: 0, max: 1, step: 0.01 },
  transmit: { min: 0, max: 1, step: 0.01 },
  reflectionTint: { min: 0, max: 1, step: 0.01 },
};

/** Readout text for one finish field: whole numbers for the exponent, two
 * decimals for the four unit-ish scalars. */
function formatFinishValue(key: FinishKey, value: number): string {
  return key === "shininess" ? value.toFixed(0) : value.toFixed(2);
}

/**
 * Does `value` sit on this field's CLASSIC value, to within half a slider
 * step? Half a step is the widest tolerance that cannot confuse two
 * adjacent slider positions — and the comparison has to tolerate SOMETHING,
 * because a slider's `value` string round-trips through `Number()` and a
 * bundle's value through the persist layer's rounding, and an exact `===`
 * against `0.4` would leave a field authored at the classic value one ULP
 * off, which is not "absent" on the wire.
 */
function finishFieldIsClassic(key: FinishKey, value: number): boolean {
  return (
    Math.abs(value - CLASSIC_SURFACE_FINISH[key]) < FINISH_RANGES[key].step / 2
  );
}

/**
 * A named finish bundle — UI VOCABULARY ONLY. Picking one SETS the six
 * sliders; the document stores the six numbers and never the name, so a
 * bundle can be retuned later without repainting any saved scene (a scene
 * authored under the old tuning keeps the old numbers and simply reads as
 * Custom afterwards). "Classic" is the bundle whose values are the absent
 * state's — applying it through the per-field write rule removes every
 * field, which is how the select returns a document to byte-identity with
 * one that never authored a finish, without a special case.
 */
interface FinishBundle {
  id: string;
  label: string;
  finish: ResolvedSurfaceFinish;
}

const FINISH_BUNDLES: readonly FinishBundle[] = [
  { id: "classic", label: "Classic", finish: CLASSIC_SURFACE_FINISH },
  {
    id: "matte",
    label: "Matte",
    finish: {
      specular: 0,
      shininess: 32,
      metalness: 0,
      reflect: 0,
      transmit: 0,
      reflectionTint: 1,
    },
  },
  {
    id: "satin",
    label: "Satin",
    finish: {
      specular: 0.25,
      shininess: 8,
      metalness: 0,
      reflect: 0.08,
      transmit: 0,
      reflectionTint: 1,
    },
  },
  {
    id: "plastic",
    label: "Plastic",
    finish: {
      specular: 0.6,
      shininess: 48,
      metalness: 0,
      reflect: 0.12,
      transmit: 0,
      reflectionTint: 1,
    },
  },
  {
    id: "metal",
    label: "Metal",
    finish: {
      specular: 0.8,
      shininess: 24,
      metalness: 1,
      reflect: 0.45,
      transmit: 0,
      reflectionTint: 1,
    },
  },
  {
    id: "chrome",
    label: "Chrome",
    finish: {
      specular: 1,
      shininess: 96,
      metalness: 1,
      reflect: 0.9,
      transmit: 0,
      reflectionTint: 0,
    },
  },
  {
    id: "translucent",
    label: "Translucent",
    finish: {
      specular: 1,
      shininess: 128,
      metalness: 0,
      reflect: 0.5,
      transmit: 0.35,
      reflectionTint: 1,
    },
  },
];

/** The select's value while the six sliders match no bundle. */
const FINISH_CUSTOM_ID = "custom";

/**
 * Which bundle, if any, these six RESOLVED values are — every field within
 * half its slider step of the bundle's (the same tolerance as
 * {@link finishFieldIsClassic}, for the same round-trip reason). Resolved
 * rather than raw on purpose: a document carrying `{specular: 0}` alone
 * resolves to Matte's six numbers exactly, and must read "Matte", not
 * "Custom", because storing classic-valued fields as ABSENCE is how the
 * write rule keeps documents minimal.
 */
function finishBundleOf(
  finish: SurfaceFinish | undefined,
): FinishBundle | null {
  const resolved = resolveSurfaceFinish(finish);
  return (
    FINISH_BUNDLES.find((bundle) =>
      FINISH_FIELDS.every(
        (key) =>
          Math.abs(resolved[key] - bundle.finish[key]) <
          FINISH_RANGES[key].step / 2,
      ),
    ) ?? null
  );
}

/**
 * The list row's finish line — present only for a finish that RESOLVES away
 * from classic (the same predicate the tracers' compile gate reads), named
 * by bundle where the six numbers are one, "custom" otherwise. A finish
 * authored at the classic values by hand is real data but renders nothing
 * different, so the row says nothing — it is the frame, not the key, the
 * line describes.
 */
function finishSummary(t: Transform): string[] {
  if (isClassicSurfaceFinish(t.finish)) return [];
  const bundle = finishBundleOf(t.finish);
  return [`Finish: ${bundle ? bundle.label : "custom"}`];
}

// ------------------------------------------------------------- the pattern

/** The family select's value while the transform authors no pattern. */
const PATTERN_FAMILY_NONE = "none";

const PATTERN_KIND_LABELS: Record<SurfacePatternKind, string> = {
  wood: "Wood",
  marble: "Marble",
  strata: "Strata",
};

const PATTERN_AXIS_LABELS: Record<SurfacePatternAxis, string> = {
  x: "X",
  y: "Y",
  z: "Z",
};

/** Strength slider bounds — the resolver's own `[0, 1]` authored span
 * (surface-pattern.ts clamps there too, so the slider never shows a number
 * the tracer is not using). The 0.01 step sits on the wire's 0.0001
 * strength quantum grid (surface-material-wire.ts's
 * SURFACE_PATTERN_WIRE_STRENGTH_QUANTUM) and makes the default 1 exactly
 * representable — the same "STEPS MATTER" rule FINISH_RANGES documents. */
const PATTERN_STRENGTH_MIN = 0;
const PATTERN_STRENGTH_MAX = 1;
const PATTERN_STRENGTH_STEP = 0.01;
/** Half a strength slider step — the finish's {@link finishFieldIsClassic}
 * tolerance, for the same round-trip reason. */
const PATTERN_STRENGTH_TOLERANCE = PATTERN_STRENGTH_STEP / 2;

/**
 * The scale slider's position grid, in scale units. A logarithmic slider
 * CANNOT be uniform and still land on the accepted prototype defaults — 3,
 * 1.35 and 2.6 (surface-pattern.ts's {@link PATTERN_DEFAULT_SCALE}, the exact
 * values the verifiers author) are not commensurable on any uniform log
 * grid — so the grid is the uniform log2 sequence `0.5 · 2^(k/16)` over the
 * resolver's whole `[0.5, 32]` span (surface-pattern.ts's
 * SURFACE_PATTERN_SCALE_MIN/MAX) with each default REPLACING the grid point
 * nearest it (all three sit within 0.4% of one, so the replacement is
 * imperceptible and the grid stays monotonically sorted). Every position is
 * therefore exactly representable, and a value's returned-to default is an
 * EXACT grid point — the fold radii' own "back to the classic value removes
 * the field" discipline, at log resolution.
 */
const PATTERN_SCALE_GRID: readonly number[] = (() => {
  const grid = Array.from({ length: 97 }, (_, k) => 0.5 * 2 ** (k / 16));
  const oct = (scale: number): number => Math.log2(scale / 0.5);
  for (const defaultScale of Object.values(PATTERN_DEFAULT_SCALE)) {
    let nearest = 0;
    for (let i = 1; i < grid.length; i++) {
      if (
        Math.abs(oct(grid[i]) - oct(defaultScale)) <
        Math.abs(oct(grid[nearest]) - oct(defaultScale))
      ) {
        nearest = i;
      }
    }
    grid[nearest] = defaultScale;
  }
  return grid;
})();

/** The scale slider's position for a scale value — the nearest grid
 * position, in octaves (log2), since the grid is log-spaced. Hostile
 * out-of-domain input clamps into the grid's own span first. */
function patternScaleToSlider(scale: number): number {
  if (!Number.isFinite(scale)) return 0;
  const clamped = Math.max(
    PATTERN_SCALE_GRID[0],
    Math.min(PATTERN_SCALE_GRID[PATTERN_SCALE_GRID.length - 1], scale),
  );
  const oct = (s: number): number => Math.log2(s / 0.5);
  const target = oct(clamped);
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < PATTERN_SCALE_GRID.length; i++) {
    const distance = Math.abs(oct(PATTERN_SCALE_GRID[i]) - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** The scale value at a slider position — the grid itself. */
function patternScaleFromSlider(position: number): number {
  const index = Math.max(
    0,
    Math.min(PATTERN_SCALE_GRID.length - 1, Math.round(position)),
  );
  return PATTERN_SCALE_GRID[index];
}

/** Half a slider step, in octaves, around a family's default scale — the
 * scale analogue of {@link finishFieldIsClassic}'s half-step tolerance
 * (the grid's octave spacing varies because the defaults displaced their
 * nearest grid points, so the tolerance is read off the grid rather than
 * assumed constant). */
function patternScaleToleranceOctaves(kind: SurfacePatternKind): number {
  const oct = (s: number): number => Math.log2(s / 0.5);
  const index = PATTERN_SCALE_GRID.indexOf(PATTERN_DEFAULT_SCALE[kind]);
  if (index < 0) return 0;
  const left =
    index > 0
      ? oct(PATTERN_SCALE_GRID[index]) - oct(PATTERN_SCALE_GRID[index - 1])
      : Infinity;
  const right =
    index < PATTERN_SCALE_GRID.length - 1
      ? oct(PATTERN_SCALE_GRID[index + 1]) - oct(PATTERN_SCALE_GRID[index])
      : Infinity;
  return Math.min(left, right) / 2;
}

/** Is `scale` this family's default, within half a slider step? */
function patternScaleIsDefault(
  scale: number,
  kind: SurfacePatternKind,
): boolean {
  if (!Number.isFinite(scale)) return false;
  return (
    Math.abs(Math.log2(scale / PATTERN_DEFAULT_SCALE[kind])) <=
    patternScaleToleranceOctaves(kind)
  );
}

/** The material menu's value while the current finish+pattern is the
 * all-clear state (classic finish, no pattern) — and what picking it
 * restores. */
const MATERIAL_NONE_ID = "none";

/** The material menu's value while the current finish+pattern matches no
 * starting point — a disabled option, so it can be shown but never picked. */
const MATERIAL_CUSTOM_ID = "custom";

/**
 * A material starting point — UI VOCABULARY ONLY, the pattern sibling of a
 * finish bundle. Picking one SETS the finish fields and the pattern
 * (family + axis + scale + strength); the document stores the numbers and
 * never the name, so a starting point can be retuned later without
 * repainting any saved scene (a scene authored under the old tuning keeps
 * the old numbers and simply reads as Custom afterwards). DISTINCT FROM THE
 * PATTERN FAMILY: "Strata the material" pairs the strata family with a
 * matte finish, and a preset is the only place the two are tied — once
 * picked, any family can pair with any finish, and a pair that is nobody's
 * preset reads Custom in this menu while the family menu still names it.
 */
interface MaterialPreset {
  id: string;
  label: string;
  /** The lighting finish this material starts from — each is one of the
   * Finish group's own named bundles (the lookup keeps the two tables from
   * drifting), so picking a material also reads that bundle in the bundle
   * menu. */
  finish: ResolvedSurfaceFinish;
  /** The pattern this material starts from — each family at its own
   * defaults (axis y, the family's default scale, strength 1), so the
   * stored surfacePattern is exactly `{kind, axis}`. */
  pattern: ResolvedSurfacePattern;
}

/** Look a finish bundle up by id, for the material presets below. */
function finishBundleValue(id: string): ResolvedSurfaceFinish {
  const bundle = FINISH_BUNDLES.find((entry) => entry.id === id);
  if (!bundle) throw new Error(`Unknown finish bundle ${id}`);
  return bundle.finish;
}

/** The three material starting points, in menu order. */
const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  {
    id: "wood",
    label: "Wood",
    finish: finishBundleValue("satin"),
    pattern: {
      kind: "wood",
      axis: SURFACE_PATTERN_DEFAULT_AXIS,
      scale: PATTERN_DEFAULT_SCALE.wood,
      strength: SURFACE_PATTERN_DEFAULT_STRENGTH,
    },
  },
  {
    id: "marble",
    label: "Marble",
    finish: finishBundleValue("plastic"),
    pattern: {
      kind: "marble",
      axis: SURFACE_PATTERN_DEFAULT_AXIS,
      scale: PATTERN_DEFAULT_SCALE.marble,
      strength: SURFACE_PATTERN_DEFAULT_STRENGTH,
    },
  },
  {
    id: "strata",
    label: "Strata",
    finish: finishBundleValue("matte"),
    pattern: {
      kind: "strata",
      axis: SURFACE_PATTERN_DEFAULT_AXIS,
      scale: PATTERN_DEFAULT_SCALE.strata,
      strength: SURFACE_PATTERN_DEFAULT_STRENGTH,
    },
  },
];

/** The all-clear pseudo-preset: classic finish and no pattern. A material
 * preset match returns it rather than `null`, so a caller cannot confuse
 * "nothing is authored" (the menu reads its pickable "None") with
 * "something is authored but it is nobody's preset" (the disabled
 * "Custom"). */
const MATERIAL_NONE: MaterialPreset = {
  id: MATERIAL_NONE_ID,
  label: "None",
  finish: CLASSIC_SURFACE_FINISH,
  pattern: {
    kind: "none",
    axis: SURFACE_PATTERN_DEFAULT_AXIS,
    scale: 1,
    strength: 0,
  },
};

/**
 * Which material starting point, if any, these RESOLVED finish+pattern
 * values are — the finish's {@link finishBundleOf} tolerance on both sides:
 * every finish field within half its slider step of the preset's, the
 * family and axis exact, and the scale/strength within half their slider
 * step of the family defaults (the presets are the families at their own
 * defaults). The all-clear state (classic finish, no pattern) returns the
 * "None" pseudo-preset — the menu's pickable clear option — and `null` is
 * the disabled "Custom" everywhere else. Resolved rather than raw on
 * purpose, exactly like {@link finishBundleOf}: a sparse
 * `{kind: "wood", axis: "y"}` IS the wood preset's pattern, and must read
 * "Wood", not "Custom".
 */
function materialPresetOf(
  finish: SurfaceFinish | undefined,
  pattern: SurfacePattern | undefined,
): MaterialPreset | null {
  const resolvedFinish = resolveSurfaceFinish(finish);
  const resolvedPattern = resolveSurfacePattern(pattern);
  if (
    isClassicSurfaceFinish(resolvedFinish) &&
    resolvedPattern.kind === "none"
  ) {
    return MATERIAL_NONE;
  }
  return (
    MATERIAL_PRESETS.find(
      (preset) =>
        FINISH_FIELDS.every(
          (key) =>
            Math.abs(resolvedFinish[key] - preset.finish[key]) <
            FINISH_RANGES[key].step / 2,
        ) &&
        preset.pattern.kind === resolvedPattern.kind &&
        preset.pattern.axis === resolvedPattern.axis &&
        // The equality above guarantees a real family by the time this
        // runs (no preset is kind none), so the cast only satisfies TS.
        patternScaleIsDefault(
          resolvedPattern.scale,
          preset.pattern.kind as SurfacePatternKind,
        ) &&
        Math.abs(resolvedPattern.strength - preset.pattern.strength) <=
          PATTERN_STRENGTH_TOLERANCE,
    ) ?? null
  );
}

/**
 * The list row's pattern line — present only for a pattern that RESOLVES to
 * a family (the predicate the tracers' compile gate reads), named by the
 * family where the pattern sits at the family's OWN defaults (axis y, the
 * family's default scale, strength 1 — the exact state a material starting
 * point or a fresh family pick produces) and "custom" once any of them is
 * tuned away — the finish row's named-vs-custom shape one feature over. A
 * pattern whose family is tuned is still the family on screen; the row
 * says "custom" because it is no longer any starting point's numbers.
 */
function patternSummary(t: Transform): string[] {
  const resolved = resolveSurfacePattern(t.surfacePattern);
  if (resolved.kind === "none") return [];
  const atDefaults =
    resolved.axis === SURFACE_PATTERN_DEFAULT_AXIS &&
    patternScaleIsDefault(resolved.scale, resolved.kind) &&
    Math.abs(resolved.strength - SURFACE_PATTERN_DEFAULT_STRENGTH) <=
      PATTERN_STRENGTH_TOLERANCE;
  return atDefaults
    ? [`Pattern: ${PATTERN_KIND_LABELS[resolved.kind]}`]
    : ["Pattern: custom"];
}

/** The forward-orbit routes — the escape-time chain in either dimension and
 * the Mandelbulb — which shade the WHOLE object with ONE finish, the first
 * active transform's (main.ts's `escapeSlotFinish`, the kernels'
 * `firstChoice` 0). Every other route shades each hit by the slot that
 * produced it, so every transform's finish reaches the frame. */
function routeShadesHeadOnly(kind: SurfaceRouteKind | null): boolean {
  return kind === "escape" || kind === "bulb" || kind === "escape4";
}

/** The HEAD transform of a forward-orbit session — the first with a
 * positive weight, clamped at 0 exactly as main.ts's `escapeSlotFinish` and
 * `escapeSlotColor` clamp it, so the panel disables the rows that session
 * would ignore and no others. */
function forwardHeadIndex(transforms: readonly Transform[]): number {
  return Math.max(
    0,
    transforms.findIndex((t) => (t.weight ?? 1) > 0),
  );
}

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
 * fold's three lengths have no row of their own, but this predicate
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

type EmitterSelectValue = "" | BundledEmitterKind | "custom";

/** Resolve a document emitter to the editor's small built-in vocabulary.
 * `custom` preserves a valid authored/shared ShapeSpec without pretending the
 * compact first-cut editor can reproduce it. */
function emitterSelectValue(
  emitter: ShapeSpec | undefined,
): EmitterSelectValue {
  if (!emitter) return "";
  return bundledEmitterForShape(emitter)?.kind ?? "custom";
}

/** One concise shape line for a transform-list row. */
function emitterSummary(t: Transform): string[] {
  if (!t.emitter) return [];
  const bundled = bundledEmitterForShape(t.emitter);
  return [`Shape: ${bundled?.label ?? "Authored"}`];
}

/**
 * The list row's structural-color lines — one per field this map
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
 * once any axis differs — an anisotropic or mirrored scale would
 * otherwise masquerade as a plain uniform contraction. */
function scaleSummary(scale: Vec3): string {
  const [x, y, z] = scale;
  if (x === y && y === z) return x.toFixed(2);
  return `[${scale.map((v) => v.toFixed(2)).join(", ")}]`;
}

/** A Xaos leak dial's readout: a percentage, one decimal only where the
 * whole-percent rounding would hide it (so the fern|sponge presets' own
 * 1% leak reads as "1%", not "1.0%", while a 0.3% hand-tune still shows). */
function formatXaosLeak(value: number): string {
  const pct = value * 100;
  const rounded = Math.round(pct * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

/**
 * The human-readable name for a palette id, read from the panel `<select>`
 * that picked it — index.html's option labels are the app's single source of
 * palette display names (ui.test.ts pins the option values to
 * `FLAME_PALETTE_IDS`), so the legend reuses them instead of introducing a
 * second copy that could drift. Falls back to the raw id if the option is
 * ever missing — which today also covers the `"custom"` sentinel, until
 * index.html carries a Custom `<option>` of its own (a later change).
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
 * Live handles into the collapsed "4D" group's eight rows — one per
 * {@link WExtension} field, since unlike the plain Vec3 channels each
 * binds to an independently-optional field rather than a shared indexed
 * array. Rotation/Shear W hold their XW/YW/ZW rows in that order.
 */
interface FourDControls {
  positionW: AxisControl;
  scaleW: AxisControl;
  /** The Scale W group's mirror toggle: pressed ⇔ the explicit `w.scale`
   * is negative. Never pressed while auto — the derived mean is always
   * positive. */
  mirrorW: HTMLButtonElement;
  rotationW: AxisControl[];
  shearW: AxisControl[];
}

/**
 * Live handles into the "Color" group's two rows, plus the fallback
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

/**
 * Live handles into the "Finish" group: the material starting-point menu,
 * the bundle select, the six rows, and the head-only disclosure line the
 * forward-orbit routes reveal.
 */
interface FinishControls {
  /** The `<details>` group itself — the disclosure dims it as a whole. */
  group: HTMLElement;
  /** The material starting-point select: a material preset id,
   * {@link MATERIAL_NONE_ID} for the all-clear state, or
   * {@link MATERIAL_CUSTOM_ID} (a disabled option, so it can be shown but
   * never picked). */
  material: HTMLSelectElement;
  /** The named-bundle select: a bundle id, or {@link FINISH_CUSTOM_ID}
   * (a disabled option, so it can be shown but never picked). */
  bundle: HTMLSelectElement;
  rows: Record<FinishKey, AxisControl>;
  /** The "only the first transform's finish is read" line — hidden unless
   * the document routes to a forward-orbit surface session AND this is
   * not its head transform. */
  note: HTMLElement;
}

/**
 * Live handles into the "Pattern" group: the family and axis selects, the
 * scale/strength rows, and the head-only disclosure line — the Finish
 * group's shape one feature over.
 */
interface PatternControls {
  /** The `<details>` group itself — the disclosure dims it as a whole. */
  group: HTMLElement;
  /** The family select: {@link PATTERN_FAMILY_NONE}, or a family id. */
  family: HTMLSelectElement;
  /** The axis select: `x`, `y` or `z`. */
  axis: HTMLSelectElement;
  /** The logarithmic scale row (periods across one normalized
   * object-space unit). */
  scale: AxisControl;
  /** The strength row (patterned-albedo blend, `0..1`). */
  strength: AxisControl;
  /** The "only the first transform's pattern is read" line — hidden
   * unless the document routes to a forward-orbit surface session AND
   * this is not its head transform. */
  note: HTMLElement;
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
    /** Working copy of the transform's optional 4D extension; `undefined`
     * exactly when the transform has none AND the user hasn't touched the 4D
     * group yet — see {@link Ui.mutateW}/{@link Ui.emitGeometry}. */
    w: WExtension | undefined;
    /** Working copy of the transform's optional palette slot; `undefined`
     * exactly when the transform authors none AND the user hasn't moved the
     * Index slider yet — the same sparse discipline as `w` above, and for the
     * same reason (see {@link Ui.emitGeometry}). The rows still DISPLAY the
     * derived fallback meanwhile; only this working copy is empty. */
    colorIndex: number | undefined;
    /** Working copy of the transform's optional color speed —
     * {@link colorIndex}'s twin in every respect. */
    colorSpeed: number | undefined;
    /** Working copy of the transform's optional surface finish — a CLONE
     * of the document's object (the finish rows mutate it in place, and
     * the document's transform must never be), `undefined` exactly when
     * the transform authors no field. The same sparse discipline as
     * `colorIndex`, applied per FIELD: a field exists here only once its
     * own slider moved off classic, and leaves again when it returns
     * there (see {@link Ui.writeFinishField}). */
    finish: SurfaceFinish | undefined;
    /** Working copy of the transform's optional surface pattern — a CLONE
     * of the document's object, `undefined` exactly when the transform
     * authors none AND the user hasn't picked a family yet. The sparse
     * discipline as `finish`, applied at the object level: the object
     * materializes when a family is picked (its `kind` and `axis` leaves
     * are required by the document model) and vanishes again when the
     * family returns to none, while `scale`/`strength` ride the finish
     * fields' per-field rule (see {@link Ui.writePatternFamily}). */
    surfacePattern: SurfacePattern | undefined;
  };
  /**
   * Has the user moved a finish slider or picked a bundle since this
   * editor was built or last synced? Until then the emitted geometry
   * carries NO `finish` key at all, so `state.ts`'s merging
   * `updateTransform` leaves the document's own finish alone through any
   * other edit. Once touched, the working copy is emitted even when EMPTY
   * — as an explicit `finish: undefined`, the `setFinalTransform` clearing
   * idiom — because that merge is the only route by which dragging the last
   * field back to classic can REMOVE the document's key. Reset on sync:
   * after one, the working copy IS the document again.
   */
  finishTouched: boolean;
  /**
   * The pattern counterpart of {@link finishTouched}: until the user picks
   * a family (or a material starting point), the emitted geometry carries
   * NO `surfacePattern` key at all, and once touched the working copy is
   * emitted even when EMPTY — as an explicit `surfacePattern: undefined`
   * — because returning the family to none has to REMOVE the document's
   * own key through the same merge. Reset on sync, exactly like
   * `finishTouched`.
   */
  patternTouched: boolean;
  controls: Record<Channel, AxisControl[]>;
  /** The Scale group's per-axis mirror toggles: pressed ⇔ that axis's
   * scale is negative (a reflection). */
  mirror: HTMLButtonElement[];
  /** The selection-weight control, or `null` for the final transform (no weight). */
  weightControl: AxisControl | null;
  /** The condensation-shape picker, or `null` for the final transform. */
  emitterSelect: HTMLSelectElement | null;
  /** The "Color" group's rows, or `null` for the final transform —
   * which is never PICKED, so it never moves the color coordinate. */
  colorControls: ColorControls | null;
  /** The "Finish" group, or `null` for the final transform — the lens is
   * not a shading slot, so no tracer reads a finish authored on it. */
  finishControls: FinishControls | null;
  /** The "Pattern" group, or `null` for the final transform — the lens is
   * not a shading slot, so no tracer reads a pattern authored on it. */
  patternControls: PatternControls | null;
  /** Working copy of the transform's variation blend, edited in place. */
  variations: Variation[];
  /** Container the variation rows are (re)built into on add/remove. */
  variationList: HTMLElement;
  /** The "add variation" dropdown, whose options exclude already-added types. */
  variationAdd: HTMLSelectElement;
  /** The collapsed "4D" group's row controls — always built, whether
   * or not this transform currently carries a `w` block. */
  fourD: FourDControls;
}

/** How long a plain {@link Ui.flashToast} confirmation stays on screen. */
const TOAST_DURATION_MS = 1800;

/** The auto-hide countdown for a {@link Ui.flashToast} carrying an
 * {@link ToastAction} — paused while hovered or focused, restarted in
 * full on leave — longer than a plain confirmation's
 * {@link TOAST_DURATION_MS} so there's time to notice the action and
 * react, not just read the message. */
const TOAST_ACTION_DURATION_MS = 6000;

/** An optional call-to-action rendered inside a {@link Ui.flashToast} — e.g.
 * "Undo" after a destructive delete. Clicking it runs `onAction` and hides the
 * toast immediately, without waiting for the auto-hide timer. */
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
 * What counts as a Tab stop inside a modal: the standard focusable set, with
 * `[tabindex="-1"]` excluded because a programmatic focus target is not one.
 */
const MODAL_FOCUSABLE_SELECTOR =
  'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The Tab ring of an open modal, in DOM order: every focusable it
 * currently holds that a user could actually reach.
 *
 * COMPUTED PER CALL, never snapshotted at open, because two of the four modals
 * fill themselves AFTER opening — the gallery renders (and re-renders, after a
 * delete) its cards, and the mutation grid enables its eight cells as
 * thumbnails land — so a ring frozen at trap time would tab around content
 * that is visibly on screen.
 *
 * Visibility is the `hidden` CLASS, this project's one display-toggle idiom
 * (`style.css`'s `.hidden { display: none }`), checked up the ancestor chain
 * to and including the modal itself, plus the `hidden` attribute for
 * completeness. Deliberately NOT `offsetParent`/`getComputedStyle`: jsdom
 * loads no stylesheet and lays nothing out, so a geometric check would read
 * every element invisible and silently empty the ring in the very tests that
 * gate this. An element the document has REMOVED is absent from the query
 * already, which is how the export modal's detached second action
 * stays out of the ring with no flag to consult.
 */
function modalFocusRing(modal: HTMLElement): HTMLElement[] {
  const found = modal.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR);
  return Array.from(found).filter((el) => {
    // `disabled` is a reflected boolean attribute on every element type that
    // has it, so the attribute and the property cannot disagree.
    if (el.hasAttribute("disabled") || el.hasAttribute("hidden")) return false;
    for (let node: HTMLElement | null = el; node; node = node.parentElement) {
      if (node.classList.contains("hidden")) return false;
      if (node === modal) break;
    }
    return true;
  });
}

/**
 * One entry in {@link Ui}'s modal stack — what
 * `trapModalFocus`/`releaseModalFocus` push and pop, and what the shared
 * `onModalStackKeydown` listener reads. `onEscape` is the one place a
 * modal's Escape behavior can differ: the three dismissible dialogs close
 * themselves unconditionally, while the export modal — which ships with
 * no ✕ and no bound backdrop by design, so an accidental dismissal can
 * never abandon a multi-minute export — instead defers to whatever
 * `showExportProgress` armed it with.
 */
interface ModalStackEntry {
  modal: HTMLElement;
  onEscape: () => void;
}

/**
 * The four coarse boundaries {@link Ui.setFlameProgress}/
 * {@link Ui.setSolidProgress}/{@link Ui.setSurfaceProgress} announce through
 * the hidden `renderProgressAnnouncer` live region — four utterances per
 * render, not the hundreds a live region wired straight to the visible
 * per-repaint readout would produce.
 */
const PROGRESS_ANNOUNCE_QUARTILES = [25, 50, 75, 100] as const;

/**
 * The highest {@link PROGRESS_ANNOUNCE_QUARTILES} boundary at or below `pct`,
 * or 0 if `pct` hasn't reached 25 yet.
 */
function highestProgressQuartile(pct: number): number {
  let reached = 0;
  for (const q of PROGRESS_ANNOUNCE_QUARTILES) {
    if (pct >= q) reached = q;
  }
  return reached;
}

/**
 * Shared quartile-announce decision for {@link Ui.setFlameProgress}/
 * {@link Ui.setSolidProgress}/{@link Ui.setSurfaceProgress}: `armed` is the
 * highest quartile already announced this render (0 = none), kept on the
 * caller's own per-mode field. Returns `armed` unchanged and a null `text`
 * for the common case — a repaint that hasn't crossed a new boundary — or
 * the boundary just crossed plus its speech text. A pct that skips a
 * boundary (20% -> 60%) reports only the HIGHEST one newly crossed (50, not
 * 25 then 50), since `highestProgressQuartile` always returns the top of
 * the ladder at or below `pct`.
 */
function crossedProgressQuartile(
  modeLabel: string,
  pct: number,
  armed: number,
): { armed: number; text: string | null } {
  const reached = highestProgressQuartile(pct);
  if (reached <= armed) return { armed, text: null };
  return { armed: reached, text: `${modeLabel} render, ${reached} percent` };
}

/**
 * Pulls the engine token ("WebGPU", "WebGPU (software)", "WebGL") out of a
 * surface progress label for {@link Ui.setSurfaceProgress}'s one-shot
 * live-region announcement. main.ts's syncSurfaceProgress always writes
 * "<Preview|Full detail> · <engine>" (see its setSurfaceProgress call
 * sites) — the part after the separator is the engine. Returns null for a
 * label with no " · " (defensive; every real caller includes one).
 */
function surfaceProgressEngine(label: string): string | null {
  const sep = label.indexOf(" · ");
  return sep === -1 ? null : label.slice(sep + 3);
}

/**
 * Owns the control panel and the dynamic transform list. All DOM is built with
 * `createElement`/`textContent` (never `innerHTML`) so user-influenced strings
 * can never be interpreted as markup.
 *
 * `index.html` owns each control's conceptual home and order; this class owns
 * runtime applicability and disclosure across renderer, dimension, and
 * session-kind consumers. Keep those concerns aligned with the control's
 * lifetime and live/restart/next-entry/refused behavior as specified in
 * `docs/panel-ia.md`.
 */
export class Ui {
  private readonly doc: Document;
  private readonly mouse = usesMouse();
  private handlers: UiHandlers | null = null;

  private readonly helpTitle: HTMLElement;
  /** The panel's own heading. The system's dimensionality is a live
   * property, so the title tells the truth per generation — "3D IFS
   * Fractal" for a flat system, "4D IFS Fractal" once any map's `w`
   * extension is in play. */
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
   * display-only recolor. Set/cleared by main.ts as the showcase
   * arms/disarms, each followed by an updateLabels sync. */
  private replayShowcaseLegend = false;
  private readonly menuToggle: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly transformCount: HTMLElement;
  private readonly transformList: HTMLElement;
  private readonly addBtn: HTMLButtonElement;
  private readonly addEmitterSelect: HTMLSelectElement;
  private readonly removeBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly presetSelect: HTMLSelectElement;
  private readonly surpriseBtn: HTMLButtonElement;
  private readonly driftBtn: HTMLButtonElement;
  private readonly driftTitle: string;
  /** The reason-in-prose sibling of {@link driftTitle}'s disabled
   * swap — see {@link setDriftAvailable}. */
  private readonly driftNote: HTMLElement;
  private readonly regenerateBtn: HTMLButtonElement;
  private readonly savePngBtn: HTMLButtonElement;
  /** "⤓ Save PNG"'s authored title, restored once a capture finishes — the
   * disabled-while-busy state swaps in a why-explaining one, the same
   * self-explaining pattern as {@link exportCollectionTitle}. */
  private readonly savePngTitle: string;
  private readonly recordVideoBtn: HTMLButtonElement;
  private readonly saveSceneFileBtn: HTMLButtonElement;
  private readonly saveFlameFileBtn: HTMLButtonElement;

  // Saved-scene collection: the panel's Save/Gallery/Copy-link buttons, the
  // gallery-count readout, and the gallery modal + its parts — plus the
  // file backup/restore trio (export, import, and the hidden file input the
  // import button opens).
  private readonly saveCollectionBtn: HTMLButtonElement;
  private readonly galleryBtn: HTMLButtonElement;
  private readonly copyLinkBtn: HTMLButtonElement;
  private readonly exportCollectionBtn: HTMLButtonElement;
  /** "⬇ Back up collection"'s authored title, restored whenever the button
   * re-enables — the disabled state swaps in a why-explaining one, the same
   * self-explaining pattern as {@link syncGalleryDriftBtn}. */
  private readonly exportCollectionTitle: string;
  /** The reason-in-prose sibling of {@link exportCollectionTitle}'s
   * disabled swap — see {@link setCollectionCount}. */
  private readonly exportCollectionNote: HTMLElement;
  private readonly importFileBtn: HTMLButtonElement;
  private readonly importFileInput: HTMLInputElement;
  private readonly collectionCount: HTMLElement;
  private readonly galleryModal: HTMLElement;
  private readonly galleryBackdrop: HTMLElement;
  private readonly galleryCloseBtn: HTMLButtonElement;
  private readonly galleryDriftBtn: HTMLButtonElement;
  private readonly galleryDriftTitle: string;
  /** Modal-local disabled reason for {@link galleryDriftBtn}; the page-level
   * driftNote sits outside an aria-modal dialog's accessible scope. */
  private readonly galleryDriftNote: HTMLElement;
  private readonly galleryGrid: HTMLElement;
  private readonly galleryEmpty: HTMLElement;
  /** Inputs to the "▶ Drift collection" disabled state, remembered so either
   * one changing (reduced motion via {@link setDriftAvailable}, emptiness via
   * {@link renderGallery}) can re-derive it — see syncGalleryDriftBtn. */
  private driftAvailable = true;
  private gallerySceneCount = 0;
  private readonly toast: HTMLElement;

  // Animation timeline: an always-applicable authoring section like
  // Collection/Export (adding a keyframe works from a flame/solid render too).
  // Play/Export mirror the Drift toggle's
  // lit/self-explaining-disabled-title pattern — see syncTimelineButtons.
  private readonly timelineAddBtn: HTMLButtonElement;
  private readonly timelinePlayBtn: HTMLButtonElement;
  private readonly timelinePlayTitle: string;
  private readonly timelineExportBtn: HTMLButtonElement;
  private readonly timelineExportTitle: string;
  /** The reason-in-prose sibling SHARED by {@link timelinePlayTitle}'s and
   * {@link timelineExportTitle}'s disabled swaps — see
   * {@link syncTimelineButtons}. One note is safe because the two buttons
   * are never disabled for different reasons at once. */
  private readonly timelineNote: HTMLElement;
  private readonly exportTimelineBtn: HTMLButtonElement;
  /** "⬇ Back up timeline"'s authored title, restored whenever the button
   * re-enables — the disabled state swaps in a why-explaining one, the same
   * self-explaining pattern as {@link exportCollectionTitle}. */
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
  /** Non-null while the offline frame-exact export runs: the progress
   * fragment the Export button shows — and the signal that the button
   * is currently the run's CANCEL affordance rather than a start
   * ({@link setTimelineExportProgress}). */
  private timelineExportProgress: string | null = null;

  // Mutation grid: the Presets section's "🧬 Mutate" button and the 3×3 modal
  // it opens — the gallery modal's chrome with a fixed grid of candidate
  // cells the app fills progressively (setMutationCell). DOM order is 0..8
  // with the CENTER (4) an inert current-system cell; candidate index i
  // (0..7) maps around it.
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

  // "What is this?" About dialog: mirrors the gallery modal's own shape
  // (open button, backdrop, close button). aboutWatchBtn and watchBuildBtn
  // are the two "▶ Watch it build" entry points — the About dialog and the
  // Cloud section — both firing the same onWatchBuild handler;
  // replayCaption is the narration pill main.ts drives during the replay
  // via setReplayCaption.
  private readonly aboutBtn: HTMLButtonElement;
  private readonly aboutModal: HTMLElement;
  private readonly aboutBackdrop: HTMLElement;
  private readonly aboutCloseBtn: HTMLButtonElement;
  private readonly aboutWatchBtn: HTMLButtonElement;
  private readonly watchBuildBtn: HTMLButtonElement;
  private readonly replayCaption: HTMLElement;

  // Export progress modal: a BLOCKING modal shown for the duration of a
  // Save PNG capture, reusing the gallery modal's chrome. Unlike the three
  // modals above, closing it is not a pure view concern — Cancel has to
  // abort real GPU work — so it has no bare close*() method; see
  // showExportProgress/setExportProgress/hideExportProgress below.
  private readonly exportModal: HTMLElement;
  private readonly exportTitle: HTMLElement;
  private readonly exportDetail: HTMLElement;
  private readonly exportProgress: HTMLElement;
  private readonly exportCancelBtn: HTMLButtonElement;
  /** The optional second action — "stop waiting and save what's there".
   * DETACHED from the document, not merely hidden, whenever the run in
   * flight did not offer it: an action nobody is being offered must not be
   * tabbable, queryable, or readable as a stale label. Held here across
   * those absences, re-inserted by {@link showExportProgress}, whose `init`
   * also writes the label — the app owns the words. `isConnected` is
   * therefore the single source of truth for "is it on offer", with no
   * mirrored flag to drift from it. */
  private readonly exportDeliverBtn: HTMLButtonElement;
  /** Whether the in-flight capture can be cancelled — mirrored from the
   * last {@link showExportProgress} call, since the export modal's Escape
   * action (armed there) needs it after the fact. Cancel has no
   * {@link exportDeliverBtn}-style absence: it is the one button the dialog
   * always has a place for, so it hides in place, which is also what keeps
   * it out of {@link modalFocusRing}'s answer with no flag for the ring to
   * consult. */
  private exportCancellable = false;

  /**
   * Where focus goes when an open modal closes, keyed by the modal it belongs
   * to — see {@link trapModalFocus}/{@link releaseModalFocus}.
   *
   * Per-modal rather than one shared slot because these dialogs can stack: an
   * export starting over an open gallery must restore ITS opener when it
   * closes and leave the gallery's alone, where a single field would have the
   * two overwrite each other and strand focus on the wrong side of a scrim.
   */
  private readonly modalOpeners = new Map<HTMLElement, HTMLElement>();

  /**
   * Every currently open modal, oldest first — pushed by
   * {@link trapModalFocus}, popped by {@link releaseModalFocus}, and read
   * by the shared `onModalStackKeydown` listener below, which is attached
   * to the document only while this is non-empty. Replaces four hand-copied
   * per-modal Escape/Tab handlers (the pairwise `exportModalOpen`/
   * `siblingModalOpen` guards) with one rule a fifth dialog can join by
   * calling {@link trapModalFocus} like the rest, instead of by copying a
   * guard into four places. {@link modalOpeners} is this structure's twin —
   * same key, different lifetime rule (an opener is only recorded from
   * OUTSIDE the modal) — and both are maintained exclusively inside
   * trapModalFocus/releaseModalFocus: edit one there without visiting the
   * other and they drift.
   */
  private readonly modalStack: ModalStackEntry[] = [];

  private readonly glowBrightnessRow: HTMLElement;
  // The balloon echo's dependent rows wait for state.balloonEcho. The
  // checkbox input itself is table-driven (see SCALAR_CONTROLS);
  // balloonInflateButton's click is bespoke, like watchBuildBtn.
  private readonly balloonRadiusRow: HTMLElement;
  private readonly balloonInflateButton: HTMLButtonElement;
  /** The balloon echo's tint picker — same shape as fogTintColorInput
   * below: the strength slider beside it is table-driven
   * (SCALAR_CONTROLS's `balloonTintStrength` entry), so only the color
   * input needs its own reference here. balloonTintRow hides/shows exactly
   * with balloonRadiusRow (state.balloonEcho) — see the row toggles in
   * updateLabels. */
  private readonly balloonTintRow: HTMLElement;
  private readonly balloonTintColorInput: HTMLInputElement;
  private readonly colorGammaRow: HTMLElement;
  private readonly rampPaletteRow: HTMLElement;
  private readonly positionColorsRow: HTMLElement;
  private readonly positionAxisInputs: {
    x: HTMLInputElement;
    y: HTMLInputElement;
    z: HTMLInputElement;
  };
  private readonly positionColorsResetBtn: HTMLElement;
  /** The gradient-shape row is inert for the per-pixel flame backdrop and
   * hides while that image source is selected. Its authored state remains in
   * AppState and returns when a gradient mode is selected again. */
  private readonly backgroundShapeRow: HTMLElement;
  /** The generated Flame backdrop's own palette row. Unlike the gradient
   * shape, it shows only while the image-backed mode is selected. */
  private readonly backgroundFlamePaletteRow: HTMLElement;
  private readonly backgroundCustomRow: HTMLElement;
  private readonly backgroundInputs: {
    top: HTMLInputElement;
    bottom: HTMLInputElement;
  };
  /** The fog tint's bespoke color picker — the strength slider beside it
   * is table-driven (see SCALAR_CONTROLS's `fogTintStrength` entry), so
   * only the color input needs its own reference here, unlike
   * `backgroundInputs`' pair. */
  private readonly fogTintColorInput: HTMLInputElement;
  private readonly symmetryNote: HTMLElement;
  /** The Hybrid schedule section's controls — see the UiHandlers schedule
   * trio for the contract each drives. */
  private readonly scheduleSource: HTMLSelectElement;
  private readonly scheduleInstalledOption: HTMLOptionElement;
  private readonly scheduleSourceSaved: HTMLOptGroupElement;
  private readonly scheduleSnapshotBtn: HTMLButtonElement;
  private readonly scheduleDepthSlider: HTMLInputElement;
  private readonly scheduleDepthLabel: HTMLElement;
  private readonly scheduleNote: HTMLElement;
  /** The Xaos section's controls — see the UiHandlers Xaos trio for the
   * contract each drives. `xaosAddSource` shares the schedule picker's
   * exact vocabulary (its Presets group is cloned from the same
   * `presetSelect`, one `"__duplicate"` sentinel added on top);
   * `xaosLeakRows`/`xaosMatrixContainer` are rebuilt wholesale by
   * {@link renderXaosSection} rather than diffed — the document (chi rows)
   * drives them, like the transform list. */
  private readonly xaosAddSource: HTMLSelectElement;
  private readonly xaosAddSourceSaved: HTMLOptGroupElement;
  private readonly xaosBalanceWeights: HTMLInputElement;
  private readonly xaosAddBtn: HTMLButtonElement;
  private readonly xaosLeakRows: HTMLElement;
  private readonly xaosMatrixNote: HTMLElement;
  private readonly xaosMatrixContainer: HTMLElement;
  private readonly finalTransformToggle: HTMLInputElement;
  private readonly transformEditor: HTMLElement;

  /** Top-level sections whose current behavior is mode-contextual. They are
   * direct siblings in index.html's one #panelSections strip: each section,
   * rather than a layout wrapper, owns its visibility. This preserves the
   * pre-migration control placement while the panel-ia work rehomes features
   * by conceptual family. */
  private readonly pointsSections: readonly HTMLDetailsElement[];
  private readonly flameSections: readonly HTMLDetailsElement[];
  private readonly solidSections: readonly HTMLDetailsElement[];
  private readonly surfaceLookSection: HTMLDetailsElement;
  /** The shared Atmosphere section's two mode-sensitive subsets: Points-only
   * depth/balloon effects, and fog (all modes except Flame). */
  private readonly pointsAtmosphereControls: HTMLElement;
  private readonly fogControls: HTMLElement;
  /** The render-mode segmented control's three buttons, keyed by the mode
   * each one switches to — the single entry/exit surface that replaced the
   * flame/solid modal islands' four separate buttons. */
  private readonly modeButtons: Record<RenderMode, HTMLButtonElement>;
  /** Device-level software-rasterizer warning (see
   * {@link setSoftwareRendererNote}) — sits OUTSIDE every mode-scoped block
   * below, so it stays visible across a render-mode switch instead of
   * disappearing with whichever status section owned it. */
  private readonly softwareRendererNote: HTMLElement;
  /**
   * Render-progress announcer: ONE shared visually-hidden live region for
   * all three progress-bearing render modes below — flame, solid and surface
   * are mutually exclusive (only one render mode is ever active), so there
   * is no cross-mode collision to arbitrate. The visible
   * flameProgress/solidProgress/surfaceProgress readouts stay bare, non-live
   * text on purpose (see each setter's own doc); this element instead gets
   * text authored FOR SPEECH ("Flame render, 50 percent"), written at coarse
   * quartile boundaries only — see setFlameProgress/setSolidProgress/
   * setSurfaceProgress and {@link crossedProgressQuartile}.
   */
  private readonly renderProgressAnnouncer: HTMLElement;
  /**
   * The highest quartile already announced THIS render (0 = none yet), one
   * per progress-bearing mode — armed back to 0 whenever that mode's setter
   * sees its own reset signal (flame/solid: `iterationsDone` 0; surface:
   * `null`), exactly mirroring how the visible readout itself resets, so a
   * restart re-arms the announcer instead of finding every boundary already
   * "reached" by the render it replaced.
   */
  private flameAnnouncedQuartile = 0;
  private solidAnnouncedQuartile = 0;
  private surfaceAnnouncedQuartile = 0;
  /**
   * Surface-only one-shots, on a DIFFERENT cadence from the quartile fields
   * above: a cheap system's preview/settle job can complete within a single
   * frame, so re-arming per JOB (as the quartile above does, via
   * setSurfaceProgress's `null` reset) would re-announce the engine dozens of
   * times over one drag. `surfaceAnnouncedEngine` instead remembers the
   * last-announced value and announces again only on an actual change (e.g. a
   * mid-session compute -> WebGL fallback) — never reset by `null`.
   * `surfaceAntialiasingAnnounced` is a rising-edge flag on the OPPOSITE
   * cadence: it clears on every `null` and on every progress update whose
   * detail stops mentioning it (supersampling's cadence is silent through pass
   * 1 of 8), so each new settle's antialiasing phase earns its own one-shot.
   */
  private surfaceAnnouncedEngine: string | null = null;
  private surfaceAntialiasingAnnounced = false;
  // The render-mode blocks that are NOT part of any accordion section. They
  // sit above ALL the sections in index.html: floating content wedged between
  // two collapsed headers reads as the open content of the header above it.
  // Undo/Redo is also in that fixed strip, but needs no reference here because
  // it remains available in every mode, matching the always-live shortcuts.
  private readonly flameStatus: HTMLElement;
  private readonly solidStatus: HTMLElement;
  private readonly flameSupersampleNote: HTMLElement;
  private readonly flameBackendNote: HTMLElement;
  private readonly flameProgress: HTMLElement;
  // Flame's third view of the shared balloon fields. The scalar inputs are
  // table-driven; the Inflate button and tint-color picker share the two
  // bespoke handlers used by their Points/Surface siblings (the handler
  // itself gives Flame its one-restart rest-pose behavior).
  private readonly flameBalloonRadiusRow: HTMLElement;
  private readonly flameBalloonInflateButton: HTMLButtonElement;
  private readonly flameBalloonTintRow: HTMLElement;
  private readonly flameBalloonTintColorInput: HTMLInputElement;

  private readonly solidResolutionNote: HTMLElement;
  private readonly solidProgress: HTMLElement;
  // Solid's view of the shared balloon fields. Its query-space remap is live,
  // so the radius row and tint picker use the same bespoke handlers as Points
  // and Surface without rebuilding the one accumulated voxel grid.
  private readonly solidBalloonCheckbox: HTMLInputElement;
  private readonly solidBalloonNote: HTMLElement;
  private readonly solidBalloonRadiusRow: HTMLElement;
  private readonly solidBalloonInflateButton: HTMLButtonElement;
  private readonly solidBalloonTintRow: HTMLElement;
  private readonly solidBalloonTintColorInput: HTMLInputElement;
  /** Whether the active Solid session's centre-density probe permits the
   * query-space echo. Session routing owns this transient result; it is not
   * authored AppState and never changes the shared checkbox value. */
  private solidBalloonAvailable = true;

  // The surface render's mode-gated status block contains its hint and trace
  // progress (see setSurfaceProgress). The document-derived eligibility note
  // sits beside the mode switch instead, so it remains readable before entry.
  // The mode button carries the gate and describes itself with that note.
  private readonly surfaceStatus: HTMLElement;
  private readonly surfaceNote: HTMLElement;
  /** Gate-level escape hatch shown only when the analyzer says disabling the
   * authored trap geometry resolves the refusal. Never part of Surface Look. */
  private readonly surfaceEligibilityRecoveryBtn: HTMLButtonElement;
  private readonly surfaceProgress: HTMLElement;
  // The preview tier under user control: the quick-previews checkbox is a
  // per-BROWSER viewer pref main.ts seeds at boot
  // (setSurfacePreviewToggle), and the skip button is the one-shot escape
  // from a grinding preview — shown exactly while setSurfaceProgress
  // reports a skippable phase, hidden with the row.
  private readonly surfacePreviewToggle: HTMLInputElement;
  private readonly surfaceSkipPreviewBtn: HTMLButtonElement;
  // The surface render's own settings block: lighting sliders plus the
  // base-color source/palette selects, the same mode-section pattern one
  // render mode over. surfacePaletteRow additionally gates on colorSource
  // being "palette", "rings", or "sheets" (all three sample the
  // user-selected palette) — like glowBrightnessRow's renderStyle gate.
  // surfaceColorSpeedRow gates more narrowly, on exactly "palette": color
  // speed shapes only that source's orbit-trap blend.
  private readonly surfacePaletteRow: HTMLElement;
  private readonly surfaceColorSpeedRow: HTMLElement;
  // The surface balloon rows, 3D and 4D alike. A FORWARD-ORBIT session in
  // either dimension REFUSES the authored top-level capability visibly: the
  // checkbox stays checked but disables beside its reason, while dependent
  // rows hide. A 4D IFS session balloons exactly like a 3D one, so the old
  // fourDSurfaceLive gate is gone. The radius row additionally waits for the
  // balloon itself, mirroring the explorer pair. Its own Inflate button binds
  // the SAME handler as the Points and Flame buttons — one shared command
  // with mode-specific motion. See docs/panel-ia.md.
  private readonly surfaceBalloonRow: HTMLElement;
  private readonly surfaceBalloonCheckbox: HTMLInputElement;
  private readonly surfaceBalloonNote: HTMLElement;
  /** Condensation level-band controls, visible only for an emitter-backed
   * IFS Surface session. */
  private readonly surfaceCondensationRow: HTMLElement;
  private readonly surfaceCondensationCustom: HTMLElement;
  // The shape trap's rows — the balloon's COMPLEMENT: visible exactly for
  // the forward-orbit (escape-family) session kinds, where the balloon
  // rows hide (see updateLabels' toggle and its comment).
  private readonly surfaceTrapRow: HTMLElement;
  private readonly surfaceTrapControls: HTMLElement;
  private readonly surfaceTrapThresholdRow: HTMLElement;
  /** Geometry is the trap block's optional distance-union use. Its row is
   * limited to conformal fold-only escape sessions; its level controls wait
   * for the checkbox, and the endpoint pair for Custom. */
  private readonly surfaceTrapGeometryRow: HTMLElement;
  private readonly surfaceTrapGeometryLevels: HTMLElement;
  private readonly surfaceTrapGeometryCustom: HTMLElement;
  /** Palette/editor container: eligible whenever the surface balloon itself
   * is eligible, even while the balloon is currently off. */
  private readonly surfaceBalloonPaletteRow: HTMLElement;
  private readonly surfaceBalloonRadiusRow: HTMLElement;
  private readonly surfaceBalloonInflateButton: HTMLButtonElement;
  /** The surface balloon's tint picker — same state field as the Points and
   * Flame inputs above (one balloon, three renderers). Hidden
   * exactly like surfaceBalloonRadiusRow: under a forward-orbit session in
   * either dimension, or while the balloon itself is off. */
  private readonly surfaceBalloonTintRow: HTMLElement;
  private readonly surfaceBalloonTintColorInput: HTMLInputElement;

  // The floor checkbox is valid for every Surface session kind and dimension.
  // These three rows are its dependent settings and hide while it is off.
  private readonly surfaceGroundPlaneDependentRows: readonly HTMLElement[];

  // 3D VIEW controls: the auto-orbit turntable — the 3D sibling of the 4D
  // auto-tumble below, same session-only checkbox + speed-row pattern, shown
  // exactly when the 4D block is not (flat system, no render active).
  private readonly threeDControls: HTMLElement;
  private readonly autoOrbitToggle: HTMLInputElement;
  private readonly autoOrbitRow: HTMLElement;
  private readonly autoOrbitSpeedSlider: HTMLInputElement;
  private readonly autoOrbitSpeedLabel: HTMLElement;

  // 4D VIEW controls. "4D" is a DERIVED property of the system now (see
  // affine4.ts's systemIsFlat/state.ts's systemIsNonFlat) rather than a mode
  // with its own entry/exit button, so only the tumble/slice block remains
  // here; its visibility (and the sub-blocks that hide alongside it — see
  // updateLabels) is a VIEW gate keyed on that same non-flatness, not a
  // separate on/off the user toggles.
  private readonly fourDControls: HTMLElement;
  private readonly fourDSliceToggle: HTMLInputElement;
  private readonly fourDSliceToggleRow: HTMLElement;
  private readonly fourDSliceRow: HTMLElement;
  private readonly fourDSliceSlider: HTMLInputElement;
  private readonly fourDSliceLabel: HTMLElement;
  // Slice thickness: lives inside fourDSliceRow like the rel-color row
  // below, but with the OPPOSITE surface gate — a slab only means something
  // to the tracer that marches one, so its row shows exactly in a live 4D
  // surface session (see syncFourDViewRows).
  private readonly fourDSliceThicknessRow: HTMLElement;
  private readonly fourDSliceThicknessSlider: HTMLInputElement;
  private readonly fourDSliceThicknessLabel: HTMLElement;
  // Slice-relative color: lives inside fourDSliceRow (so it hides with the
  // slice), with its own row element hidden for the baked 4D color modes — the
  // remap only touches the w-ramp palettes (see updateLabels).
  private readonly fourDSliceRelColorToggle: HTMLInputElement;
  private readonly fourDSliceRelColorRow: HTMLElement;
  /** True while the panel is showing a LIVE 4D surface session: a non-flat
   * system in Surface mode, where the tracer re-poses the rotor and
   * re-marches the w slice every frame. It changes what the slice block
   * means, so {@link syncFourDViewRows} keys on it — see updateLabels. */
  private fourDSurfaceLive = false;
  /** False while the live 4D surface session cannot take a slab at all,
   * for either of two reasons the row's own tooltip distinguishes: its
   * fold set breaks segment exactness (spherefold and mandelbox branches
   * take segments to arcs), or it is an ESCAPE-TIME session, whose
   * forward orbit has no branch enumeration to thread a segment through
   * at any fold family. Either way the session clamps the slab to 0. The
   * thickness row stays VISIBLE and DISABLES with the reason — a
   * silently vanishing control reads as "impossible, no idea why".
   * Session-scoped, set by main.ts's routing; true outside such
   * sessions. */
  private fourDSlabAvailable = true;
  /**
   * The ACTIVE surface session's shape: `"escape"` for the escape-time fold
   * render and `"bulb"` for the Mandelbulb — the two FORWARD-ORBIT objects,
   * filled solids whose interior reaches the ball centre, so scene.ts nulls
   * the ball (the measured degeneracy, re-measured on the bulb) and the
   * balloon is permanently inert for both — `"ifs"` for every ordinary IFS or
   * live 4D session, `null` outside a surface session (or before the routing
   * decision lands). Session-scoped like {@link fourDSlabAvailable}, set by
   * main.ts's own routing at surfaceSession.start() and reset on session end —
   * NOT document-derived like {@link fourDSurfaceLive} above, since "would
   * this document route to escape" needs the same analysis main.ts's routing
   * already ran; read by updateLabels alongside fourDSurfaceLive to gate the
   * balloon rows.
   */
  private surfaceSessionKind: SurfaceSessionKind | null = null;
  /** Last document context reflected by updateLabels. Session routing can
   * update Surface's duplicated Balloon row immediately between refreshes. */
  private panelContext: PanelContext = {
    renderMode: "points",
    dimension: "flat",
    surfaceKind: null,
  };
  /**
   * Where the DOCUMENT would route if Surface were entered now — the gate's
   * own `kind`, pushed with every {@link setSurfaceEligibility}. This, and
   * not {@link surfaceSessionKind}, drives the finish rows' head-only
   * disclosure: the transform editor lives inside the explorer controls,
   * which hide for the whole of a surface session (and entry drops the
   * selection), so a session-scoped flag could never be seen from a row
   * that exists only in Points mode. The gate re-derives on every edit,
   * drags included, so the rows tell the truth about the session the NEXT
   * click into Surface would start.
   */
  private surfaceRouteKind: SurfaceRouteKind | null = null;
  /** The first positively-weighted transform — the one finish a
   * forward-orbit session reads (see {@link forwardHeadIndex}); refreshed
   * with every transform-list render, the panel's feed of the whole set. */
  private forwardHead = 0;
  // Auto-tumble pause/resume + speed: same session-only pattern as the
  // slice controls above. The toggle's own wrapper row hides — with the
  // speed row — in a live 4D surface session, where the ambient tumble
  // is PARKED (see syncFourDViewRows).
  private readonly fourDTumbleToggle: HTMLInputElement;
  private readonly fourDTumbleToggleRow: HTMLElement;
  private readonly fourDTumbleRow: HTMLElement;
  private readonly fourDSurfaceMotionHint: HTMLElement;
  private readonly fourDTumbleSpeedSlider: HTMLInputElement;
  private readonly fourDTumbleSpeedLabel: HTMLElement;
  /** Is the projection ACTUALLY tumbling right now (main.ts's
   * `fourDView.tumbleOn`, whose default this matches)? Mirrored here because
   * the canvas help box names the motion and would otherwise claim a tumble
   * that is parked. Deliberately not the checkbox — unlike `sliceOn` (see
   * updateLabels' syncFourDViewRows call), the control is not the truth: a
   * build replay's showcase forces the tumble on for its duration WITHOUT
   * touching the user's control (main.ts's replayShowcase), and the help box
   * describes the canvas, not the panel. Kept in step by
   * {@link setFourDTumbleActive}, {@link resetFourDTumble}, and the toggle's
   * own change handler. */
  private fourDTumbleActive = true;
  private readonly colorModeRow: HTMLElement;
  /** The 4D Color select's wrapper — {@link colorModeRow}'s non-flat sibling
   * in the Color section: exactly one of the pair shows, and
   * `#rampPaletteRow` sits statically beneath them (gate and gated
   * co-located, with no DOM re-homing). */
  private readonly fourDColorRow: HTMLElement;
  /** The 4D depth-fade toggle's wrapper — renderStyleRow's non-flat sibling
   * in the Atmosphere section. */
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

  /** The gradient-stop editor rows shown under the background/flame/solid/surface/ramp
   * palette `<select>`s once set to Custom: a live gradient strip preview,
   * one `<input type="color">` per stop, and the add/remove-stop buttons.
   * All five editors read/write the SAME shared `AppState.customPalette`
   * slot (see {@link syncCustomPaletteEditors}) — only which row is visible
   * differs, keyed on that palette select's own paletteId
   * (background/flame/solid/surface) or \`rampPaletteId\` (ramp). */
  private readonly customPaletteEditors: Record<
    "background" | "flame" | "solid" | "surface" | "ramp",
    {
      row: HTMLElement;
      strip: HTMLElement;
      stops: HTMLElement;
      add: HTMLButtonElement;
      remove: HTMLButtonElement;
    }
  >;

  /** Three mirrored views of the balloon's independent Custom slot. */
  private readonly balloonCustomPaletteEditors: Record<
    "points" | "flame" | "surface",
    {
      row: HTMLElement;
      strip: HTMLElement;
      stops: HTMLElement;
      add: HTMLButtonElement;
      remove: HTMLButtonElement;
    }
  >;

  /** Per-mode fallback for the accordion when the previously open section is
   * no longer applicable after a renderer switch. A still-visible open
   * section wins and survives the switch; otherwise this restores the mode's
   * last contextual choice/default. `""` = the user deliberately collapsed
   * everything in that mode. Session-only, like `renderMode` itself. */
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
   * Session memory of which transform-editor group is open. Every
   * fresh selection restores it, so tuning Rotation across several transforms
   * doesn't mean reopening the group at each one.
   *
   * `null` = the user has never chosen, which is where the 4D group's own rule
   * still applies: a transform that already carries a `w` extension opens on
   * "4D", so a system authored by preset or URL hash shows its 4D values
   * instead of hiding them a click away. Once a choice exists it wins — the
   * same "never fight a manual toggle mid-session" line that rule was written
   * on.
   */
  private editorOpenGroup: string | null = null;

  /** Pending {@link flashToast} auto-hide, cleared/rearmed on each toast. */
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  // The auto-hide pause (WCAG 2.2.1): while the pointer is over the toast
  // or focus is inside it (Tab reaches an action toast's Undo), the
  // countdown holds — the actionable toast is the ONLY recovery path
  // after a collection/keyframe delete, and 6s is not enough to hear the
  // announcement, navigate there and press it. Leaving re-arms a full
  // countdown. Both flags reset on every fresh toast and on hide, so a
  // boundary event a browser drops (an element hidden under a parked
  // pointer fires no mouseleave) can never wedge a later toast open.
  private toastHovered = false;
  private toastFocused = false;

  /**
   * The single document keydown listener behind every modal,
   * attached only while {@link modalStack} is non-empty — armed by
   * {@link trapModalFocus}, dropped by {@link releaseModalFocus} — so it
   * never lingers or double-binds. Replaces four hand-copied per-modal
   * handlers that each restated the stacking rule with a pairwise
   * `exportModalOpen()`/`siblingModalOpen()` guard.
   *
   * Escape and Tab read OPPOSITE ends of {@link modalStack}, which is that
   * same stacking rule generalized rather than flattened. Tab is the
   * shared focus trap ({@link cycleModalFocus}) and always cycles the
   * NEWEST entry's ring: once the export modal stacks over a sibling, it is
   * what the user is actually looking at, and the only one Tab may reach.
   * Escape always goes to the OLDEST entry instead: a sibling's
   * Escape-to-close must survive a multi-minute export stacked above it —
   * the exact accident that rule fixed, where an Escape aimed at the
   * sibling used to also abort the export. Because the export modal can
   * only ever stack OVER an already-open sibling, never under one —
   * opening a sibling needs a button the export modal's own focus trap and
   * full-viewport backdrop (unbound, but still there to catch every click)
   * put out of reach while it is up — the oldest entry is always that
   * sibling when one is open, and the export modal itself otherwise. So the
   * export entry's own Escape action (armed in {@link showExportProgress})
   * needs no sibling check of its own: it is only ever consulted when it IS
   * the oldest entry, i.e. when there is no sibling left to defer to.
   */
  private readonly onModalStackKeydown = (e: KeyboardEvent): void => {
    if (this.modalStack.length === 0) return;
    if (e.key === "Escape") {
      this.modalStack[0].onEscape();
      return;
    }
    if (e.key === "Tab") {
      this.cycleModalFocus(
        this.modalStack[this.modalStack.length - 1].modal,
        e,
      );
    }
  };

  /** Whether the blocking export modal is on screen — read off the
   * `hidden` class, this project's one display idiom, like
   * {@link mutationsOpen}. {@link releaseModalFocus} is its one remaining
   * reader (the shared modal stack retired the keydown handlers' own
   * copies): it still needs to know whether export sits above the modal
   * that is closing, to hand off its opener rather than restore focus
   * behind a scrim. */
  private exportModalOpen(): boolean {
    return !this.exportModal.classList.contains("hidden");
  }

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
    this.addEmitterSelect = this.byId("addEmitterSelect");
    this.appendBundledShapeOptions(
      this.addEmitterSelect,
      BUNDLED_EMITTER_SHAPES,
    );
    this.removeBtn = this.byId("removeBtn");
    this.undoBtn = this.byId("undoBtn");
    this.redoBtn = this.byId("redoBtn");
    this.presetSelect = this.byId("presetSelect");
    this.surpriseBtn = this.byId("surpriseBtn");
    this.driftBtn = this.byId("driftBtn");
    this.driftTitle = this.driftBtn.title;
    this.driftNote = this.byId("driftNote");
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
    this.exportCollectionNote = this.byId("exportCollectionNote");
    this.importFileBtn = this.byId("importFileBtn");
    this.importFileInput = this.byId("importFileInput");
    this.collectionCount = this.byId("collectionCount");
    this.galleryModal = this.byId("galleryModal");
    this.galleryBackdrop = this.byId("galleryBackdrop");
    this.galleryCloseBtn = this.byId("galleryCloseBtn");
    this.galleryDriftBtn = this.byId("galleryDriftBtn");
    this.galleryDriftTitle = this.galleryDriftBtn.title;
    this.galleryDriftNote = this.byId("galleryDriftNote");
    this.galleryGrid = this.byId("galleryGrid");
    this.galleryEmpty = this.byId("galleryEmpty");
    this.timelineAddBtn = this.byId("timelineAddBtn");
    this.timelinePlayBtn = this.byId("timelinePlayBtn");
    this.timelinePlayTitle = this.timelinePlayBtn.title;
    this.timelineExportBtn = this.byId("timelineExportBtn");
    this.timelineExportTitle = this.timelineExportBtn.title;
    this.timelineNote = this.byId("timelineNote");
    this.exportTimelineBtn = this.byId("exportTimelineBtn");
    this.exportTimelineTitle = this.exportTimelineBtn.title;
    // Visible when EITHER capture path exists: the realtime MediaRecorder
    // capture, or the offline frame-exact WebCodecs export — main.ts's
    // onTimelineExport routes between them.
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
    // Pause-on-hover/focus: the element is permanent, so the four
    // listeners bind once here rather than per flashToast. mouseenter only
    // ever fires on an actionable toast — the plain one keeps
    // `pointer-events: none` (see .toast/.toast-actionable in style.css) —
    // while focusin covers the keyboard route to the action button.
    this.toast.addEventListener("mouseenter", () => this.holdToast("hover"));
    this.toast.addEventListener("mouseleave", () => this.releaseToast("hover"));
    this.toast.addEventListener("focusin", () => this.holdToast("focus"));
    this.toast.addEventListener("focusout", () => this.releaseToast("focus"));
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
    // ...and straight back out. index.html declares the button so the
    // dialog's full vocabulary — both its actions, in their order, with
    // their classes — stays readable in the markup; this makes the DEFAULT
    // state the true one. showExportProgress re-inserts it for a run that
    // offers the action, and takes it out again for one that does not.
    this.exportDeliverBtn.remove();
    this.glowBrightnessRow = this.byId("glowBrightnessRow");
    this.balloonRadiusRow = this.byId("balloonRadiusRow");
    this.balloonInflateButton = this.byId("balloonInflateButton");
    this.balloonTintRow = this.byId("balloonTintRow");
    this.balloonTintColorInput = this.byId("balloonTintColor");
    this.colorGammaRow = this.byId("colorGammaRow");
    this.rampPaletteRow = this.byId("rampPaletteRow");
    this.positionColorsRow = this.byId("positionColorsRow");
    this.positionAxisInputs = {
      x: this.byId("positionAxisX"),
      y: this.byId("positionAxisY"),
      z: this.byId("positionAxisZ"),
    };
    this.positionColorsResetBtn = this.byId("positionColorsReset");
    this.backgroundShapeRow = this.byId("backgroundShapeRow");
    this.backgroundFlamePaletteRow = this.byId("backgroundFlamePaletteRow");
    this.backgroundCustomRow = this.byId("backgroundCustomRow");
    this.backgroundInputs = {
      top: this.byId("backgroundTop"),
      bottom: this.byId("backgroundBottom"),
    };
    this.fogTintColorInput = this.byId("fogTintColor");
    this.symmetryNote = this.byId("symmetryNote");
    this.scheduleSource = this.byId("scheduleSource");
    this.scheduleSourceSaved = this.byId("scheduleSourceSaved");
    this.scheduleSnapshotBtn = this.byId("scheduleSnapshotBtn");
    this.scheduleDepthSlider = this.byId("scheduleDepthSlider");
    this.scheduleDepthLabel = this.byId("scheduleDepthLabel");
    this.scheduleNote = this.byId("scheduleNote");
    // The sentinel the picker shows while a block is installed (the
    // document stores B's MAPS, not their source, so no source name can be
    // honestly re-selected after a reload/undo).
    const installedOption =
      this.scheduleSource.querySelector<HTMLOptionElement>(
        'option[value="__installed"]',
      );
    if (!installedOption) {
      throw new Error("Missing #scheduleSource option __installed");
    }
    this.scheduleInstalledOption = installedOption;
    // The Presets group clones the preset menu's own entries — index.html's
    // option list stays the single source of preset display names (the
    // same list ui.test.ts pins against PRESET_NAMES) — value-prefixed so
    // main.ts can tell a preset source from a saved-scene one.
    const schedulePresetsGroup = this.byId<HTMLOptGroupElement>(
      "scheduleSourcePresets",
    );
    for (const option of Array.from(
      this.presetSelect.querySelectorAll("option"),
    )) {
      if (!option.value) continue;
      const clone = this.doc.createElement("option");
      clone.value = `preset:${option.value}`;
      clone.textContent = option.textContent;
      schedulePresetsGroup.appendChild(clone);
    }
    this.xaosAddSource = this.byId("xaosAddSource");
    this.xaosAddSourceSaved = this.byId("xaosAddSourceSaved");
    this.xaosBalanceWeights = this.byId("xaosBalanceWeights");
    this.xaosAddBtn = this.byId("xaosAddBtn");
    this.xaosLeakRows = this.byId("xaosLeakRows");
    this.xaosMatrixNote = this.byId("xaosMatrixNote");
    this.xaosMatrixContainer = this.byId("xaosMatrixContainer");
    // The Xaos picker's Presets group is the schedule picker's own clone
    // loop, restated: index.html's option list stays the single source of
    // preset display names, and the same value prefix (`preset:<key>`)
    // lets main.ts share one resolver between both pickers.
    const xaosPresetsGroup = this.byId<HTMLOptGroupElement>(
      "xaosAddSourcePresets",
    );
    for (const option of Array.from(
      this.presetSelect.querySelectorAll("option"),
    )) {
      if (!option.value) continue;
      const clone = this.doc.createElement("option");
      clone.value = `preset:${option.value}`;
      clone.textContent = option.textContent;
      xaosPresetsGroup.appendChild(clone);
    }
    this.finalTransformToggle = this.byId("finalTransformToggle");
    this.transformEditor = this.byId("transformEditor");
    this.pointsSections = [
      this.byId<HTMLDetailsElement>("transformsSection"),
      this.byId<HTMLDetailsElement>("xaosSection"),
      this.byId<HTMLDetailsElement>("presetSection"),
      this.byId<HTMLDetailsElement>("cloudSection"),
      this.byId<HTMLDetailsElement>("colorSection"),
      this.byId<HTMLDetailsElement>("symmetrySection"),
      this.byId<HTMLDetailsElement>("scheduleSection"),
    ];
    this.flameSections = [
      this.byId<HTMLDetailsElement>("flameToneSection"),
      this.byId<HTMLDetailsElement>("flameBlurSection"),
      this.byId<HTMLDetailsElement>("flameQualitySection"),
    ];
    this.solidSections = [
      this.byId<HTMLDetailsElement>("solidSurfaceSection"),
      this.byId<HTMLDetailsElement>("solidLightingSection"),
      this.byId<HTMLDetailsElement>("solidQualitySection"),
    ];
    this.surfaceLookSection =
      this.byId<HTMLDetailsElement>("surfaceLookSection");
    this.pointsAtmosphereControls = this.byId("pointsAtmosphereControls");
    this.fogControls = this.byId("fogControls");
    this.modeButtons = {
      points: this.byId("modePointsBtn"),
      flame: this.byId("modeFlameBtn"),
      solid: this.byId("modeSolidBtn"),
      surface: this.byId("modeSurfaceBtn"),
    };
    this.softwareRendererNote = this.byId("softwareRendererNote");
    this.renderProgressAnnouncer = this.byId("renderProgressAnnouncer");
    this.flameStatus = this.byId("flameStatus");
    this.solidStatus = this.byId("solidStatus");
    this.surfaceStatus = this.byId("surfaceStatus");
    this.surfaceNote = this.byId("surfaceNote");
    this.surfaceEligibilityRecoveryBtn = this.byId(
      "surfaceEligibilityRecoveryBtn",
    );
    this.surfaceProgress = this.byId("surfaceProgress");
    this.surfacePreviewToggle = this.byId("surfacePreviewToggle");
    this.surfaceSkipPreviewBtn = this.byId("surfaceSkipPreviewBtn");
    this.flameSupersampleNote = this.byId("flameSupersampleNote");
    this.flameBackendNote = this.byId("flameBackendNote");
    this.flameProgress = this.byId("flameProgress");
    this.flameBalloonRadiusRow = this.byId("flameBalloonRadiusRow");
    this.flameBalloonInflateButton = this.byId("flameBalloonInflateButton");
    this.flameBalloonTintRow = this.byId("flameBalloonTintRow");
    this.flameBalloonTintColorInput = this.byId("flameBalloonTintColor");
    this.solidResolutionNote = this.byId("solidResolutionNote");
    this.solidProgress = this.byId("solidProgress");
    this.solidBalloonCheckbox = this.byId("solidBalloonCheckbox");
    this.solidBalloonNote = this.byId("solidBalloonNote");
    this.solidBalloonRadiusRow = this.byId("solidBalloonRadiusRow");
    this.solidBalloonInflateButton = this.byId("solidBalloonInflateButton");
    this.solidBalloonTintRow = this.byId("solidBalloonTintRow");
    this.solidBalloonTintColorInput = this.byId("solidBalloonTintColor");
    this.surfacePaletteRow = this.byId("surfacePaletteRow");
    this.surfaceColorSpeedRow = this.byId("surfaceColorSpeedRow");
    this.surfaceBalloonRow = this.byId("surfaceBalloonRow");
    this.surfaceBalloonCheckbox = this.byId("surfaceBalloonCheckbox");
    this.surfaceBalloonNote = this.byId("surfaceBalloonNote");
    this.surfaceCondensationRow = this.byId("surfaceCondensationRow");
    this.surfaceCondensationCustom = this.byId("surfaceCondensationCustom");
    this.surfaceTrapRow = this.byId("surfaceTrapRow");
    this.surfaceTrapControls = this.byId("surfaceTrapControls");
    this.surfaceTrapThresholdRow = this.byId("surfaceTrapThresholdRow");
    this.surfaceTrapGeometryRow = this.byId("surfaceTrapGeometryRow");
    this.surfaceTrapGeometryLevels = this.byId("surfaceTrapGeometryLevels");
    this.surfaceTrapGeometryCustom = this.byId("surfaceTrapGeometryCustom");
    this.surfaceBalloonPaletteRow = this.byId("surfaceBalloonPaletteRow");
    this.surfaceBalloonRadiusRow = this.byId("surfaceBalloonRadiusRow");
    this.surfaceBalloonInflateButton = this.byId("surfaceBalloonInflateButton");
    this.surfaceBalloonTintRow = this.byId("surfaceBalloonTintRow");
    this.surfaceBalloonTintColorInput = this.byId("surfaceBalloonTintColor");
    this.surfaceGroundPlaneDependentRows = [
      this.byId("surfaceFloorPatternRow"),
      this.byId("surfaceFloorTileScaleRow"),
      this.byId("surfaceFloorEmissionRow"),
    ];
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
    this.fourDSurfaceMotionHint = this.byId("fourDSurfaceMotionHint");
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
    this.appendBundledShapeOptions(
      this.scalarSelect("surfaceTrapShape"),
      BUNDLED_TRAP_SHAPES,
      "custom",
    );
    this.customPaletteEditors = {
      background: {
        row: this.byId("backgroundCustomPaletteRow"),
        strip: this.byId("backgroundCustomPaletteStrip"),
        stops: this.byId("backgroundCustomPaletteStops"),
        add: this.byId("backgroundCustomPaletteAdd"),
        remove: this.byId("backgroundCustomPaletteRemove"),
      },
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
    this.balloonCustomPaletteEditors = {
      points: {
        row: this.byId("balloonCustomPaletteRow"),
        strip: this.byId("balloonCustomPaletteStrip"),
        stops: this.byId("balloonCustomPaletteStops"),
        add: this.byId("balloonCustomPaletteAdd"),
        remove: this.byId("balloonCustomPaletteRemove"),
      },
      flame: {
        row: this.byId("flameBalloonCustomPaletteRow"),
        strip: this.byId("flameBalloonCustomPaletteStrip"),
        stops: this.byId("flameBalloonCustomPaletteStops"),
        add: this.byId("flameBalloonCustomPaletteAdd"),
        remove: this.byId("flameBalloonCustomPaletteRemove"),
      },
      surface: {
        row: this.byId("surfaceBalloonCustomPaletteRow"),
        strip: this.byId("surfaceBalloonCustomPaletteStrip"),
        stops: this.byId("surfaceBalloonCustomPaletteStops"),
        add: this.byId("surfaceBalloonCustomPaletteAdd"),
        remove: this.byId("surfaceBalloonCustomPaletteRemove"),
      },
    };

    // Panel accordion: the sections are exclusive-open <details
    // name="panel-section"> groups, so the browser owns which one is open
    // (plus the keyboard/AT semantics). Ui adds just two things on top: the
    // per-render-mode memory of the open section (recorded here, restored in
    // updateLabels), and a scroll re-anchor, because when the section that
    // just auto-closed sat ABOVE the tapped one, the collapse shifts the
    // tapped summary up — on a phone, clean out of view.
    for (const section of Array.from(
      this.panel.querySelectorAll<HTMLDetailsElement>("details.panel-section"),
    )) {
      section.addEventListener("toggle", () => {
        if (!section.open) {
          // A deliberate collapse (nothing left open) clears the mode's
          // memory; the auto-close half of an exclusive switch does not,
          // because the newly-opened section is already open in the DOM by
          // the time either element's toggle event fires. Nor does an
          // applicability close: updateLabels leaves .hidden on the section,
          // preserving its contextual memory for when that mode returns.
          if (
            !section.classList.contains("hidden") &&
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
          // Re-anchor only while the panel is actually on screen. This
          // toggle also fires for PROGRAMMATIC opens — updateLabels'
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

    // A vertical scroll swipe that lands on a slider must not edit it, and it
    // does not even try: the guard PREVENTS the tap-jump rather than undoing
    // it afterwards, and drives the touch drag itself as the price. See
    // slider-scroll-guard.ts for the full story, including why the obvious
    // preventDefault does not work.
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

  /** Insert registry-backed options immediately before an optional sentinel.
   * Static markup owns only classic/custom values, so an obsolete hard-coded
   * bundled option remains visible as a duplicate and fails the exact-option
   * contract tests instead of silently drifting from the registry. */
  private appendBundledShapeOptions(
    select: HTMLSelectElement,
    entries: readonly BundledShapeDefinition[],
    beforeValue?: string,
  ): void {
    const before = beforeValue
      ? Array.from(select.options).find(
          (option) => option.value === beforeValue,
        )
      : undefined;
    for (const entry of entries) {
      const option = this.doc.createElement("option");
      option.value = entry.kind;
      option.textContent = bundledShapeOptionLabel(entry);
      select.insertBefore(option, before ?? null);
    }
  }

  private byId<T extends HTMLElement>(id: string): T {
    const el = this.doc.getElementById(id);
    if (!el) throw new Error(`Missing required element #${id}`);
    return el as T;
  }

  /**
   * Read a gradient editor's current stop list from its `stops` container, in
   * DOM order — shared by the delegated recolor listener and the add/remove
   * button handlers below, all of which need "the stops as they stand right
   * now" before computing their own edit. Returns `null` if any child color
   * input's value fails to parse, so the delegated listener can ignore the
   * whole event rather than act on a partial read; this can't actually happen
   * for a real `<input type="color">`, whose value is always a well-formed
   * `#rrggbb`.
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
   * over. */
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
    this.addEmitterSelect.addEventListener("change", () => {
      const entry = bundledShapeEntry(this.addEmitterSelect.value);
      this.addEmitterSelect.value = "";
      if (entry?.emitter) handlers.onAddEmitter(entry.kind);
    });
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
    // The Hybrid schedule trio: the picker's value goes to the handler
    // verbatim (updateLabels re-syncs it to the document's own state — the
    // "__installed" sentinel or None — after the edit lands), the snapshot
    // button and depth slider are direct forwards.
    this.scheduleSource.addEventListener("change", () => {
      handlers.onScheduleSource(this.scheduleSource.value);
    });
    this.scheduleSnapshotBtn.addEventListener("click", () =>
      handlers.onScheduleSnapshot(),
    );
    this.scheduleDepthSlider.addEventListener("input", () => {
      handlers.onScheduleDepth(Number(this.scheduleDepthSlider.value));
    });
    // The Xaos "Add as block" button reads the picker + checkbox directly
    // (no change listener on the select itself — unlike the schedule
    // picker, a Xaos source choice is not applied until this click, so the
    // gesture reads as "pick, then confirm" rather than "pick = apply").
    this.xaosAddBtn.addEventListener("click", () => {
      handlers.onXaosAddBlock(
        this.xaosAddSource.value,
        this.xaosBalanceWeights.checked,
      );
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
    // Timeline: the three top-level actions are parameterless, like
    // Surprise Me / Drift — row-level actions (remove/move/timing) are
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
    // The mutation grid: opening and re-rolling go through the app (it
    // owns the candidates); closing mirrors the gallery's pure-view
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
    // The About dialog is the same kind of pure view concern: opening
    // it needs no handler (the dialog is static content), and closing
    // it mirrors the gallery's ✕/backdrop/Escape trio exactly.
    this.aboutBtn.addEventListener("click", () => this.openAbout());
    this.aboutCloseBtn.addEventListener("click", () => this.closeAbout());
    this.aboutBackdrop.addEventListener("click", () => this.closeAbout());
    // Two entry points for the same replay — the About dialog's own button
    // and the Cloud section's — both fire the one handler.
    this.aboutWatchBtn.addEventListener("click", () => handlers.onWatchBuild());
    this.watchBuildBtn.addEventListener("click", () => handlers.onWatchBuild());
    // The export progress modal deliberately does NOT mirror the
    // ✕/backdrop/Escape trio above: index.html wires no ✕ and leaves the
    // backdrop unbound (an accidental dismissal must not silently abandon a
    // multi-minute export), and Cancel is not a pure view concern like
    // closeGallery/closeAbout/closeMutations — it has to abort real GPU
    // work, so the click (and the Escape action showExportProgress arms)
    // route through the app via onExportCancel instead of a bare
    // hideExportProgress() call.
    this.exportCancelBtn.addEventListener("click", () =>
      handlers.onExportCancel(),
    );
    // Same reasoning for the second action: it ends a real wait and commits
    // to a file, so it routes through the app rather than the view.
    this.exportDeliverBtn.addEventListener("click", () =>
      handlers.onExportDeliverEarly(),
    );
    // The balloon echo's "Inflate" replay — a bespoke button like
    // watchBuildBtn above, not a table-driven scalar control. The surface
    // Flame, Solid, and Surface each expose their own Inflate button through
    // the exact SAME handler — one radius field and four mode-aware entry points.
    this.balloonInflateButton.addEventListener("click", () =>
      handlers.onBalloonInflate(),
    );
    this.flameBalloonInflateButton.addEventListener("click", () =>
      handlers.onBalloonInflate(),
    );
    this.solidBalloonInflateButton.addEventListener("click", () =>
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
      // Commit-on-release: a range spec that declares `commit` ALSO gets
      // the trailing "change" event a range input fires once the drag ends
      // — reported as the "commit" phase, on top of (not instead of) the
      // "input" listener above, which already covered every tick during
      // the drag itself.
      if (spec.kind === "range" && spec.commit) {
        input.addEventListener("change", () =>
          handlers.onScalarControl(spec, input.value, "commit"),
        );
      }
    }
    // Recovery uses the SAME table-driven checkbox path as a manual edit, so
    // reducer, undo/save, eligibility refresh and renderer effects cannot
    // drift. The app handler runs synchronously; once it re-enables Surface,
    // hand focus to the action's destination.
    this.surfaceEligibilityRecoveryBtn.addEventListener("click", () => {
      const input = this.scalarInput("surfaceTrapGeometryCheckbox");
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("Surface trap Geometry is not a checkbox");
      }
      if (input.checked) input.click();
      this.modeButtons.surface.focus();
    });
    this.finalTransformToggle.addEventListener("change", () =>
      handlers.onToggleFinalTransform(this.finalTransformToggle.checked),
    );
    for (const mode of RENDER_MODES) {
      this.modeButtons[mode].addEventListener("click", () =>
        handlers.onRenderMode(mode),
      );
    }
    // The adjacent live-region note is the modality-independent refusal path.
    // A disabled segment still swallows clicks, while pointer events ARE
    // dispatched for disabled form controls, so touch also gets a transient
    // toast as a supplement to the persistent note and hover tooltip.
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
      // also keeps the surface-mode gate honest.
      this.syncFourDViewRows();
      // Set BEFORE the handler: main.ts answers this one with an
      // updateLabels, which reads the flag to word the help box.
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
    // Custom palette gradient editor: the background/flame/solid/surface/ramp rows share
    // this same wiring, each against its own DOM elements. The recolor
    // listener is delegated on the `stops` container (rather than bound per
    // input) so it survives syncCustomPaletteEditors rebuilding the inputs on
    // an add/remove.
    for (const kind of [
      "background",
      "flame",
      "solid",
      "surface",
      "ramp",
    ] as const) {
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
    // Balloon Custom has the same editor mechanics but an intentionally
    // separate callback and document slot. Each mirrored editor reports the
    // whole balloon stop list; none can mutate the primary Custom gradient.
    for (const kind of ["points", "flame", "surface"] as const) {
      const editor = this.balloonCustomPaletteEditors[kind];
      editor.stops.addEventListener("input", () => {
        const stops = this.readCustomPaletteStops(editor.stops);
        if (stops) handlers.onBalloonCustomPaletteStops(stops);
      });
      editor.add.addEventListener("click", () => {
        const stops = this.readCustomPaletteStops(editor.stops);
        if (!stops || stops.length >= MAX_CUSTOM_PALETTE_STOPS) return;
        handlers.onBalloonCustomPaletteStops([
          ...stops,
          stops[stops.length - 1],
        ]);
      });
      editor.remove.addEventListener("click", () => {
        const stops = this.readCustomPaletteStops(editor.stops);
        if (!stops || stops.length <= MIN_CUSTOM_PALETTE_STOPS) return;
        handlers.onBalloonCustomPaletteStops(stops.slice(0, -1));
      });
    }
    // Position axis colors: three pickers report as one triple — the app
    // state is the triple, so a drag in any one picker re-reads all three,
    // exactly like the gradient editor reads its whole stop list.
    this.positionColorsRow.addEventListener("input", () => {
      const colors = this.readPositionAxisColors();
      if (colors) handlers.onPositionAxisColors(colors);
    });
    this.positionColorsResetBtn.addEventListener("click", () =>
      handlers.onPositionAxisColors(LEGACY_POSITION_AXIS_COLORS),
    );
    // Custom backdrop stops: two pickers report as one pair — the app state
    // is the pair, so a drag in either re-reads both, exactly like the
    // position axis row just above.
    this.backgroundCustomRow.addEventListener("input", () => {
      const custom = this.readBackgroundCustom();
      if (custom) handlers.onBackgroundCustom(custom);
    });
    // Fog tint color: bound to the single picker itself, not the row —
    // unlike the pair above, there is no sibling input to jointly
    // re-read, and the row also hosts the table-driven strength slider,
    // whose own "input" events must not re-trigger this handler.
    this.fogTintColorInput.addEventListener("input", () => {
      handlers.onFogTint(this.fogTintColorInput.value);
    });
    // Balloon tint color: ONE handler serves all four pickers — the Points,
    // Flame, Solid, and Surface sections expose the same state field in their own
    // render modes (fogTintColorInput's precedent just above, tripled).
    // Each row also hosts its own table-driven strength slider, whose
    // "input" events must not re-trigger this handler — so, like
    // fogTintColorInput, these bind to the picker itself, not the row.
    this.balloonTintColorInput.addEventListener("input", () => {
      handlers.onBalloonTint(this.balloonTintColorInput.value);
    });
    this.flameBalloonTintColorInput.addEventListener("input", () => {
      handlers.onBalloonTint(this.flameBalloonTintColorInput.value);
    });
    this.solidBalloonTintColorInput.addEventListener("input", () => {
      handlers.onBalloonTint(this.solidBalloonTintColorInput.value);
    });
    this.surfaceBalloonTintColorInput.addEventListener("input", () => {
      handlers.onBalloonTint(this.surfaceBalloonTintColorInput.value);
    });
  }

  /** Reflect a 4D slice state in the panel controls — how a restored
   * document's saved 4D pose, applied to the view out from under the UI
   * (main.ts's applyFourDPose), keeps the panel truthful. The position row
   * shows/hides with the toggle exactly as its change handler does;
   * `thickness` rides along, since a saved pose carries one whether or not
   * the session it lands in is showing that row. */
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
   * A LIVE 4D surface session has no slice choice to offer. That
   * tracer marches a `w = w0` cross-section unconditionally — `sliceOn`
   * never reaches it (main.ts pushes only `sliceCenter`/`sliceThickness`
   * into `setSurface4View`) — so the toggle would be a lie, while the
   * position slider is the mode's defining parameter and the one control
   * that makes its continuous family of 3D fractals reachable. Hide the
   * toggle, show the slider regardless.
   *
   * The thickness slider is that toggle's exact complement: the
   * slab it widens is a property of the tracer's own distance estimator, so
   * it shows ONLY in a live surface session. The point cloud's slice has a
   * fixed Gaussian width of its own that this control does not touch.
   *
   * The TUMBLE rows hide whole in that session too: the ambient
   * tumble PARKS there — every tick would invalidate the frame and pin the
   * tier scheduler in preview, so the settle could never arm — and a
   * visible toggle whose motion never happens reads as a broken view. The
   * user's checkbox state survives untouched for the projection view.
   */
  private syncFourDViewRows(): void {
    const sliceOn = this.fourDSliceToggle.checked;
    const tumbleOn = this.fourDTumbleToggle.checked;
    this.fourDSurfaceMotionHint.classList.toggle(
      "hidden",
      !this.fourDSurfaceLive,
    );
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
    // the slab — a silently vanishing control reads as "impossible, no
    // idea why", where the truth is a per-fold-family soundness rule the
    // user can act on (boxfold keeps the slab).
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
    // TWO SESSIONS REFUSE THE SLAB AND THEY OWE DIFFERENT REASONS. The IFS
    // descent refuses it per FOLD FAMILY — a spherefold's inversion branch
    // bends a segment into an arc — so a box-fold-only system keeps it, which
    // is a knob the user can act on. A 4D escape-time session refuses it at
    // every fold family, because a forward orbit has no branch enumeration at
    // all: the box fold that rescues the descent is exactly the one that turns
    // a segment into a bent polyline here. Handing the descent's reason to an
    // escape session would tell a box-fold-only chain to do the thing it is
    // already doing.
    this.fourDSliceThicknessRow.title = !slabRefused
      ? ""
      : this.surfaceSessionKind === "escape"
        ? "Slab thickness is unavailable in the escape-time render: its " +
          "orbit runs the maps FORWARD, with no branches to thread a " +
          "segment through, so a slab has no certificate at any fold " +
          "family. The IFS surface render keeps it."
        : "Slab thickness is unavailable with sphere folds: the slab's " +
          "segment certificates are unsound under the spherefold's " +
          "inversion branch (mandelbox includes it). Box-fold-only systems " +
          "keep the slab.";
  }

  /** Whether the live 4D surface session can take a slab at all (see
   * {@link fourDSlabAvailable}) — main.ts sets it from `slabExact4` at
   * session routing and resets it true on session end. */
  setFourDSlabAvailable(available: boolean): void {
    if (this.fourDSlabAvailable === available) return;
    this.fourDSlabAvailable = available;
    this.syncFourDViewRows();
  }

  /** Which shape the active surface session actually routed to (see
   * {@link surfaceSessionKind}) — main.ts sets it once per
   * surfaceSession.start() branch and resets it to `null` on session end,
   * mirroring {@link setFourDSlabAvailable}'s own routing-pushed pattern.
   * The checkbox already carries the last state reflected by updateLabels,
   * so the refusal can update immediately; the caller's established refreshUi
   * after routing then reconciles it with the newest document state. */
  setSurfaceSessionKind(kind: SurfaceSessionKind | null): void {
    this.surfaceSessionKind = kind;
    this.panelContext = { ...this.panelContext, surfaceKind: kind };
    this.syncSurfaceBalloonRows(
      resolvePanelApplicability("balloon", {
        ...this.panelContext,
        // A non-null kind arrives from an active Surface session. Use that
        // renderer immediately; updateLabels will reconcile the full context.
        renderMode: kind === null ? this.panelContext.renderMode : "surface",
      }),
    );
  }

  /** Apply the active Solid session's centre-density refusal result. The
   * authored balloon flag remains checked while refused so switching to an
   * eligible system restores the user's intent rather than erasing it. */
  setSolidBalloonAvailable(available: boolean): void {
    this.solidBalloonAvailable = available;
    this.syncSolidBalloonRows();
  }

  /** Reconcile the transient Solid eligibility result with the shared
   * checkbox value most recently reflected by updateLabels. */
  private syncSolidBalloonRows(): void {
    const refused = !this.solidBalloonAvailable;
    const showDependent = !refused && this.solidBalloonCheckbox.checked;
    this.solidBalloonCheckbox.disabled = refused;
    this.solidBalloonRadiusRow.classList.toggle("hidden", !showDependent);
    this.solidBalloonTintRow.classList.toggle("hidden", !showDependent);
    this.solidBalloonNote.textContent = refused
      ? BALLOON_CENTRE_REFUSAL_REASON
      : "";
    this.solidBalloonNote.classList.toggle("hidden", !refused);
  }

  /** Apply Surface's forward-orbit refusal without erasing the shared authored
   * flag. The checkbox remains discoverable; palette/radius/tint are dependent
   * controls and hide until the capability is usable again. */
  private syncSurfaceBalloonRows(applicability: PanelApplicability): void {
    const enabled = applicability.kind === "enabled";
    const refused = applicability.kind === "disabled";
    const showDependent = enabled && this.surfaceBalloonCheckbox.checked;
    this.surfaceBalloonRow.classList.toggle(
      "hidden",
      applicability.kind === "hidden",
    );
    this.surfaceBalloonCheckbox.disabled = refused;
    this.surfaceBalloonPaletteRow.classList.toggle("hidden", !enabled);
    this.surfaceBalloonRadiusRow.classList.toggle("hidden", !showDependent);
    this.surfaceBalloonTintRow.classList.toggle("hidden", !showDependent);
    this.surfaceBalloonNote.textContent = refused ? applicability.reason : "";
    this.surfaceBalloonNote.classList.toggle("hidden", !refused);
  }

  /** Reset the 4D slice controls to off/centered — called on every 4D entry so
   * a slice left behind by the previous visit never silently applies. The
   * slice-relative color option resets with it: it's slice view state, and the
   * fresh-visit default is the faithful whole-cloud ramp. So does the slab
   * thickness, whose fresh-visit default is the zero-thickness
   * cross-section. */
  resetFourDSlice(): void {
    this.setFourDSlice(false, 0, false, 0);
  }

  /** Reset the auto-orbit controls on every fresh visit to the 3D view — `on`
   * is false under prefers-reduced-motion (where the orbit starts paused but
   * stays available as an explicit opt-in) or when the user's sticky toggle
   * choice says so (mirrors {@link resetFourDTumble}). */
  resetAutoOrbit(on: boolean): void {
    this.autoOrbitToggle.checked = on;
    this.autoOrbitRow.classList.toggle("hidden", !on);
    this.autoOrbitSpeedSlider.value = "1";
    this.autoOrbitSpeedLabel.textContent = "1.0×";
  }

  /** Reset the 4D tumble controls on every 4D entry — `on` is false under
   * prefers-reduced-motion (where the tumble starts paused but stays available
   * as an explicit opt-in) or when the user's sticky toggle choice says so. */
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
   * touching the user's checkbox (see {@link fourDTumbleActive}).
   * Wording-only: callers refresh the help box with the {@link updateLabels}
   * they already run. */
  setFourDTumbleActive(on: boolean): void {
    this.fourDTumbleActive = on;
  }

  /** Reflect an auto-motion flip that came from the CANVAS (the Space key)
   * rather than the panel checkbox: exactly the DOM-side recording the
   * change listeners perform before their handlers fire — checked state,
   * row visibility, the help-box flag — and deliberately NOT
   * {@link resetAutoOrbit}/{@link resetFourDTumble}, whose fresh-visit
   * semantics would also stomp a user-chosen speed back to 1.0x. The
   * caller (main.ts's onToggleAutoMotion) then runs the same handler logic
   * the checkbox change would have, so the two input paths stay one
   * path. */
  setAutoMotionToggle(fourD: boolean, on: boolean): void {
    if (fourD) {
      this.fourDTumbleToggle.checked = on;
      this.syncFourDViewRows();
      this.fourDTumbleActive = on;
    } else {
      this.autoOrbitToggle.checked = on;
      this.autoOrbitRow.classList.toggle("hidden", !on);
    }
  }

  /** Reflect scalar state into labels, inputs, the help box, and the panel. */
  updateLabels(state: AppState): void {
    this.transformCount.textContent = String(state.transforms.length);
    const transformLimitReached = state.transforms.length >= MAX_TRANSFORMS;
    this.addBtn.disabled = transformLimitReached;
    this.addEmitterSelect.disabled = transformLimitReached;
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
    this.syncBalloonCustomPaletteEditors(state);

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

    // The Hybrid schedule rows reflect the DOCUMENT's block: the picker
    // shows the installed sentinel (the document stores B's maps, not
    // their source, so no source name can honestly survive a
    // reload/undo), the depth slider the block's depth (0 = absent), and
    // the note names the composition and its Surface cost profile.
    const schedule = state.schedule;
    this.scheduleInstalledOption.hidden = schedule === undefined;
    if (schedule) {
      this.scheduleInstalledOption.textContent = `System B (${schedule.transforms.length} maps)`;
      this.scheduleSource.value = "__installed";
      this.scheduleDepthSlider.value = String(schedule.depth);
      this.scheduleDepthLabel.textContent = String(schedule.depth);
      this.scheduleNote.textContent =
        `Each plotted point is bent through ${schedule.depth} random ` +
        `B-map${schedule.depth === 1 ? "" : "s"} — the depth-${schedule.depth} ` +
        `B-arrangement of the attractor. Points, flame and solid render ` +
        `the composition; Surface follows the same finite B prefix when ` +
        `all participating maps support inverse descent.`;
      this.scheduleNote.classList.remove("hidden");
    } else {
      this.scheduleSource.value = "";
      this.scheduleDepthSlider.value = "0";
      this.scheduleDepthLabel.textContent = "off";
      this.scheduleNote.textContent = "";
      this.scheduleNote.classList.add("hidden");
    }

    this.finalTransformToggle.checked = state.finalTransform !== undefined;

    // The render-mode segmented control is the panel's one fixed switch
    // between the three sibling renderers; each mode's own params show
    // beneath it. Reflect the active segment…
    for (const mode of RENDER_MODES) {
      const active = state.renderMode === mode;
      this.modeButtons[mode].classList.toggle("active", active);
      this.modeButtons[mode].setAttribute("aria-pressed", String(active));
    }
    // …and swap in the active mode's sections. A flame/solid render takes
    // over the panel — editing controls that can't affect the in-progress
    // render would just be confusing — but the segmented control itself stays,
    // so flame↔solid is a direct switch, not a round-trip through Points.
    // Atmosphere is the deliberate exception: its one shared section remains
    // reachable and exposes only rows the current renderer actually uses.
    const rendering = state.renderMode !== "points";
    // "4D" is a DERIVED property of the system (see affine4.ts's systemIsFlat
    // via state.ts's systemIsNonFlat), NOT a fourth render mode — so this is a
    // VIEW gate, orthogonal to the segmented control above. The presets block,
    // transform list, and editor all STAY VISIBLE and live for a non-flat
    // system exactly as for a flat one — only the controls that are genuinely
    // meaningless while viewing the 4D shader path (color mode/contrast, depth
    // style — neither reaches the 4D projection or its own w-driven coloring;
    // symmetry, by contrast, stays put — the 4D chaos game has a kaleidoscope
    // stage of its own) hide; their 4D look siblings (the 4D Color and
    // depth-fade rows) replace them in the corresponding Color and Atmosphere
    // sections, and the 4D View section's tumble/slice block replaces the 3D
    // View block. All four render
    // modes stay available while non-flat: the flame/solid renders snapshot
    // the frozen 4D view and run their own 4D accumulators, and the surface
    // tracer poses the 4D attractor live. The tumble/slice block hides under
    // the FROZEN renders for the same reason the editing controls do — the
    // view (rotor + slice) is baked into their worker snapshot, so its
    // controls couldn't affect it — but NOT under a live 4D surface session,
    // where the tracer re-poses and re-marches every frame and those are the
    // only controls that reach it.
    const nonFlat = systemIsNonFlat(state);
    const panelContext: PanelContext = {
      renderMode: state.renderMode,
      dimension: nonFlat ? "nonFlat" : "flat",
      surfaceKind: this.surfaceSessionKind,
    };
    this.panelContext = panelContext;
    const frozenRender =
      state.renderMode === "flame" || state.renderMode === "solid";
    // A non-flat system in Surface mode is always the 4D tracer: the session
    // routes on this same predicate (main.ts's systemPartsAreNonFlat branch),
    // ahead of the flat-only escape-time and fold/affine paths.
    this.fourDSurfaceLive = nonFlat && state.renderMode === "surface";
    this.panelTitle.textContent = nonFlat ? "4D IFS Fractal" : "3D IFS Fractal";
    for (const section of this.pointsSections) {
      section.classList.toggle("hidden", rendering);
    }
    this.pointsAtmosphereControls.classList.toggle("hidden", rendering);
    this.fogControls.classList.toggle("hidden", state.renderMode === "flame");
    for (const section of this.flameSections) {
      section.classList.toggle("hidden", state.renderMode !== "flame");
    }
    this.flameBalloonRadiusRow.classList.toggle("hidden", !state.balloonEcho);
    this.flameBalloonTintRow.classList.toggle("hidden", !state.balloonEcho);
    for (const section of this.solidSections) {
      section.classList.toggle("hidden", state.renderMode !== "solid");
    }
    // Solid's query-space echo is dimension-independent, but a session whose
    // centre-density probe refuses it temporarily disables the checkbox and
    // hides the dependent rows without mutating the shared authored flag.
    this.syncSolidBalloonRows();
    const surfaceInspectorApplicability = resolvePanelApplicability(
      "surfaceInspector",
      panelContext,
    );
    this.surfaceLookSection.classList.toggle(
      "hidden",
      surfaceInspectorApplicability.kind !== "enabled",
    );
    // The surface palette select means anything for "palette", "rings",
    // "sheets" and "shapeTrap" — all four sample the user-selected palette
    // — like glowBrightnessRow, hidden whenever none of those is active.
    this.surfacePaletteRow.classList.toggle(
      "hidden",
      state.surface.colorSource !== "palette" &&
        state.surface.colorSource !== "rings" &&
        state.surface.colorSource !== "sheets" &&
        state.surface.colorSource !== "shapeTrap",
    );
    // The color-speed slider only shapes the "palette" source's orbit-trap
    // blend weight — inert for rings/sheets (a different coordinate off
    // the same descent) and every other source, so it hides unless
    // "palette" is exactly the active one.
    this.surfaceColorSpeedRow.classList.toggle(
      "hidden",
      state.surface.colorSource !== "palette",
    );
    // Forward-orbit Surface sessions preserve the authored balloon while
    // visibly refusing it; eligible sessions show only the dependent rows
    // whose parent state makes them meaningful. The 4D dimension gate is
    // gone: a 4D IFS session balloons exactly like a 3D one.
    this.syncSurfaceBalloonRows(
      resolvePanelApplicability("balloon", panelContext),
    );
    for (const row of this.surfaceGroundPlaneDependentRows) {
      row.classList.toggle("hidden", !state.groundPlane);
    }
    // The shape trap independently states the same forward-orbit consumer
    // set; it is not inferred from Balloon's complementary refusal. Sub-rows
    // still wait for authored feature predicates below.
    const surfaceTrapApplicability = resolvePanelApplicability(
      "surfaceTrap",
      panelContext,
    );
    this.surfaceTrapRow.classList.toggle(
      "hidden",
      surfaceTrapApplicability.kind !== "enabled",
    );
    this.surfaceTrapControls.classList.toggle("hidden", !state.shapeTrap);
    this.surfaceTrapThresholdRow.classList.toggle(
      "hidden",
      state.shapeTrap?.mode !== "threshold",
    );
    // Color trapping is valid on every forward-orbit object. Geometry is
    // narrower: only a conformal fold-only escape chain has the derivative
    // contract needed to pull a posed SDF back into the distance union. Keep
    // the color controls reachable on bulbs/power/anisotropic chains while
    // hiding the inapplicable geometry switch itself.
    const trapGeometryRestriction = state.shapeTrap
      ? surfaceTrapGeometryRestriction(state.transforms, nonFlat)
      : null;
    const trapGeometryApplicability = resolvePanelApplicability(
      "surfaceTrapGeometry",
      panelContext,
    );
    const trapGeometryRelevant =
      state.shapeTrap !== undefined &&
      trapGeometryApplicability.kind === "enabled" &&
      trapGeometryRestriction === null;
    this.surfaceTrapGeometryRow.classList.toggle(
      "hidden",
      !trapGeometryRelevant,
    );
    this.surfaceTrapGeometryLevels.classList.toggle(
      "hidden",
      !trapGeometryRelevant || state.shapeTrap?.geometry !== true,
    );
    this.surfaceTrapGeometryCustom.classList.toggle(
      "hidden",
      !trapGeometryRelevant ||
        state.shapeTrap?.geometry !== true ||
        shapeTrapGeometryBandMode(state) !== "custom",
    );
    const condensationApplicability = resolvePanelApplicability(
      "surfaceCondensation",
      panelContext,
    );
    const condensationLive =
      condensationApplicability.kind === "enabled" &&
      state.transforms.some(
        (transform) =>
          (transform.weight ?? 1) > 0 && transform.emitter !== undefined,
      );
    this.surfaceCondensationRow.classList.toggle("hidden", !condensationLive);
    this.surfaceCondensationCustom.classList.toggle(
      "hidden",
      !condensationLive ||
        state.condensationDepthBand?.maxDepth === 0 ||
        state.condensationDepthBand === undefined,
    );
    // …including each render's status block above the accordion. Undo/Redo
    // remains visible in the shared strip because both the buttons and their
    // keyboard shortcuts time-travel the document in every mode.
    this.flameStatus.classList.toggle("hidden", state.renderMode !== "flame");
    this.solidStatus.classList.toggle("hidden", state.renderMode !== "solid");
    this.surfaceStatus.classList.toggle(
      "hidden",
      state.renderMode !== "surface",
    );
    this.fourDControls.classList.toggle("hidden", !nonFlat || frozenRender);
    // The slice and tumble rows read differently in a live surface session —
    // see syncFourDViewRows. Both toggles are session-only view state the UI
    // owns, so the checkboxes themselves are the truth it re-applies.
    this.syncFourDViewRows();
    // The slice-relative option only touches the w-ramp palettes, so its row
    // hides under the baked 4D color modes — the same single source of truth
    // (color.ts) the shader's bake-vs-uniform dispatch keys on — and under a
    // live surface session, whose tracer has no w ramp at all (its color
    // sources are by-transform / palette / height / 4D radius / rings /
    // sheets, none of which the remap touches).
    this.fourDSliceRelColorRow.classList.toggle(
      "hidden",
      this.fourDSurfaceLive || fourDColorNeedsAttribute(state.fourDColor),
    );
    // The 3D View block (auto-orbit) is the flat-system counterpart of the 4D
    // block: exactly one of the two shows outside a render. It hides during
    // renders for the same frozen-view reason (the flame freezes the camera
    // outright; the solid render keeps manual gestures but animate()'s early
    // return stops the automatic motion, so the controls would be inert).
    this.threeDControls.classList.toggle("hidden", nonFlat || rendering);
    this.colorModeRow.classList.toggle("hidden", nonFlat);
    // The 4D look rows are the non-flat replacements for the color-mode and
    // depth-style rows: color stays in the Color section in both views, so
    // the pair swaps in place rather than living in the 4D View section
    // (which keeps only the spatial tumble/slice controls).
    this.fourDColorRow.classList.toggle("hidden", !nonFlat);
    this.fourDDepthFadeRow.classList.toggle("hidden", !nonFlat);
    this.renderStyleRow.classList.toggle("hidden", nonFlat);
    // The Symmetry section deliberately does NOT gate on `nonFlat`: every
    // render path sweeps or expands the kaleidoscope for a 4D system too, so
    // the controls stay editable — and the old "parked kaleidoscope" note died
    // with the hiding, since no authored symmetry is inert anymore (a w-plane
    // or twist makes the system itself 4D). The manual brightness override
    // only means anything for the glow render style, so — like the flame/solid
    // sub-panels above — it's hidden whenever that style isn't the active one
    // (and always while non-flat, since renderStyle itself never reaches the
    // 4D projection either).
    this.glowBrightnessRow.classList.toggle(
      "hidden",
      nonFlat || state.renderStyle !== "glow",
    );
    // The balloon echo follows the projected cloud in either dimension. Its
    // radius slider + Inflate button wait only for the echo itself to be on.
    this.balloonRadiusRow.classList.toggle("hidden", !state.balloonEcho);
    // The balloon tint waits for the echo itself, exactly like
    // balloonRadiusRow above — same gate, same reason.
    this.balloonTintRow.classList.toggle("hidden", !state.balloonEcho);
    // The ramp palette only means anything for the modes that ARE a 1-D ramp:
    // the flat view's height/radius color modes (narrower than the contrast
    // slider's gating, see color.ts's colorModeUsesRampPalette) and the 4D
    // projection's "By 4D Radius" mode, which follows the same selection. It
    // is ONE row (select + custom-stop editor) serving both views: it sits
    // statically beneath the flat/4D color-select pair, exactly one of which
    // is visible per view, so it is always directly under the select that
    // gates it. That true dependent relationship keeps the rows together in
    // Color; top-level accordion exclusivity does not determine their
    // conceptual placement.
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
    // The gradient shape has no meaning for the Flame backdrop's per-pixel
    // image. Hide the row while that mode is selected without clearing its
    // authored value — switching back restores the same shape.
    this.backgroundShapeRow.classList.toggle(
      "hidden",
      state.background.mode === "flame",
    );
    this.backgroundFlamePaletteRow.classList.toggle(
      "hidden",
      state.background.mode !== "flame",
    );
    // The custom backdrop pickers: shown only while the Background select
    // sits on Custom (therefore hidden for Flame too); synced to the resolved
    // stops with the same only-write-on-change guard as the axis pickers above.
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
    // The fog tint picker: synced the same only-write-on-change way as the
    // backdrop pickers just above — state already holds the hex string
    // directly (no rgbToHex conversion needed), so a gallery load or undo
    // moves the swatch instead of leaving it stale.
    if (this.fogTintColorInput.value !== state.fogTint) {
      this.fogTintColorInput.value = state.fogTint;
    }
    // The balloon tint pickers: synced the same only-write-on-change way as
    // fogTintColorInput just above, to ALL inputs — the Points, Flame, Solid,
    // and Surface sections show the SAME state.balloonTint through four DOM
    // elements, so a gallery load or undo must move whichever are stale.
    if (this.balloonTintColorInput.value !== state.balloonTint) {
      this.balloonTintColorInput.value = state.balloonTint;
    }
    if (this.flameBalloonTintColorInput.value !== state.balloonTint) {
      this.flameBalloonTintColorInput.value = state.balloonTint;
    }
    if (this.solidBalloonTintColorInput.value !== state.balloonTint) {
      this.solidBalloonTintColorInput.value = state.balloonTint;
    }
    if (this.surfaceBalloonTintColorInput.value !== state.balloonTint) {
      this.surfaceBalloonTintColorInput.value = state.balloonTint;
    }
    // Accordion applicability/restore runs after every section-level gate
    // above. Close anything now hidden, even when applicability changed
    // without a mode switch; a hidden section must never remain open. On a
    // mode switch, an open section that remains visible survives — sharedness
    // is derived from current applicability, not a hardcoded family/id list.
    // Only when none survives do we restore the destination mode's remembered
    // contextual section/default (see openSectionByMode). A remembered `""`
    // leaves the destination deliberately all-collapsed.
    const openSections = Array.from(
      this.panel.querySelectorAll<HTMLDetailsElement>(
        "details.panel-section[open]",
      ),
    );
    const stillApplicable = openSections.find(
      (section) => !section.classList.contains("hidden"),
    );
    for (const open of openSections) {
      if (open.classList.contains("hidden")) open.open = false;
    }

    if (state.renderMode !== this.sectionMode) {
      this.sectionMode = state.renderMode;
      if (stillApplicable) {
        // It is now the destination mode's active section too. Recording it
        // keeps a later deliberate collapse meaningful: collapsed-all must
        // clear this mode instead of resurrecting its older fallback.
        this.openSectionByMode[state.renderMode] = stillApplicable.id;
      } else {
        const remembered = this.openSectionByMode[state.renderMode];
        const target = remembered ? this.doc.getElementById(remembered) : null;
        if (
          target instanceof HTMLDetailsElement &&
          !target.classList.contains("hidden")
        ) {
          target.open = true;
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
      // retargets drag/scroll to the hidden w-planes — the help box is the
      // most visible gesture surface, so the Shift line lives here as well as
      // in the panel hint. Touch has no Shift; it keeps the orbit lines only.
      // Takes priority over a transform/final-lens selection (unlike the OLD
      // 4D mode's forced-null selection) — there is no draggable guide box in
      // the projection no matter which transform is selected in the
      // (still-live) list, so the canvas gesture is always this one; only the
      // panel's own editor responds to the selection.
      this.helpTitle.textContent = "4D Projection";
      // The opening line describes the cloud rather than a gesture, so it has
      // to track the tumble: a parked projection that still claimed to be
      // tumbling read as a broken view, and the paused wording points back at
      // the control that parked it just as the running one introduces the
      // motion.
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
   * Sync the background/flame/solid/surface/ramp gradient-stop editors to
   * `state.customPalette`, called from {@link updateLabels} right after the
   * table-driven scalar sync loop. Five rows now: the background editor shows
   * only while the Flame backdrop owns a Custom palette; flame/solid rows show
   * only while their OWN render's palette select is on
   * {@link CUSTOM_PALETTE_ID}; the surface and ramp rows additionally sit
   * INSIDE a gated container (`#surfacePaletteRow`, hidden unless the
   * surface colorSource is one of the three that sample the user palette —
   * `palette`/`rings`/`sheets`; `#rampPaletteRow`, the per-view ramp-mode
   * gating — flat: `colorModeUsesRampPalette`; non-flat: `fourDColor ===
   * "radius"`), so {@link updateLabels}' container gating composes on top
   * of the isCustom gating handled here — both must hold for those editors
   * to actually show. All four edit the same shared slot (see `state.ts`'s
   * `AppState.customPalette`), so switching which one is "custom" never
   * loses an in-progress edit. The stop inputs are only rebuilt when their
   * count changes (add/remove, or a fresh seed) — an ordinary recolor
   * instead updates each input's value in place, so it never clobbers a
   * color picker mid-drag with a redundant write.
   */
  private syncCustomPaletteEditors(state: AppState): void {
    const paletteIdByKind: Record<
      "background" | "flame" | "solid" | "surface" | "ramp",
      PaletteSelection
    > = {
      background: state.background.flamePaletteId ?? DEFAULT_FLAME_PALETTE,
      flame: state.flame.paletteId,
      solid: state.solid.paletteId,
      surface: state.surface.paletteId,
      ramp: state.rampPaletteId,
    };
    for (const kind of [
      "background",
      "flame",
      "solid",
      "surface",
      "ramp",
    ] as const) {
      const editor = this.customPaletteEditors[kind];
      const isCustom =
        paletteIdByKind[kind] === CUSTOM_PALETTE_ID &&
        (kind !== "background" || state.background.mode === "flame");
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

  /**
   * Sync the three balloon-only gradient editors. Their visibility follows
   * only the shared balloon palette selection — never `balloonEcho` — so a
   * Custom look can be authored while the balloon is off. Surface eligibility
   * is an outer-container gate applied in {@link updateLabels}.
   */
  private syncBalloonCustomPaletteEditors(state: AppState): void {
    const isCustom = state.balloonPaletteId === CUSTOM_PALETTE_ID;
    for (const kind of ["points", "flame", "surface"] as const) {
      const editor = this.balloonCustomPaletteEditors[kind];
      editor.row.classList.toggle("hidden", !isCustom);
      if (!isCustom) continue;

      // The selection check above excludes resolveBalloonPalette's null arm.
      const resolved = resolveBalloonPalette(state) as CustomPalette;
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
          input.setAttribute("aria-label", `Balloon color stop ${i + 1}`);
          editor.stops.appendChild(input);
        });
      } else {
        inputs.forEach((input, i) => {
          const hex = rgbToHex(stops[i]);
          if (input.value !== hex) input.value = hex;
        });
      }

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

  /**
   * Write `text` into a frequently refreshed live region only when it differs
   * from what the note already shows. Shared by {@link surfaceNote},
   * {@link driftNote}, {@link galleryDriftNote},
   * {@link exportCollectionNote} and {@link timelineNote}: their setters can
   * re-run on every document drag/panel refresh/timeline edit/collection
   * change whether or not the reason changed. A plain
   * textContent write would re-announce unchanged prose to a screen reader.
   *
   * Honest scope note (wave-5 review): two of the latter four notes live inside
   * collapsible accordion sections, and a closed `<details>`' content is
   * not exposed to AT — a reason written while its section is closed is
   * not announced, and this guard means opening the section does not
   * re-write it either. That matches the file's existing in-section notes
   * (flameSupersampleNote, solidResolutionNote), and the note is ordinary
   * VISIBLE prose beside the button whenever the section is open — the
   * discoverability half of the fix, which is the half a hover-only
   * title never had. Announce-on-change is the bonus for the open case,
   * not the load-bearing channel.
   */
  private setReasonNote(note: HTMLElement, text: string): void {
    if (note.textContent !== text) note.textContent = text;
  }

  /**
   * Repopulate the Hybrid schedule picker's Saved scenes group — one
   * option per collection entry, value `saved:<id>` (the same id
   * `onLoadFromCollection` addresses). main.ts calls this at boot and
   * after every collection mutation, so the picker tracks the gallery
   * without rebuilding on every updateLabels tick (an open dropdown must
   * not have its options replaced under the pointer).
   */
  setScheduleSavedScenes(entries: { id: string; createdAt: number }[]): void {
    this.scheduleSourceSaved.textContent = "";
    for (const entry of entries) {
      const option = this.doc.createElement("option");
      option.value = `saved:${entry.id}`;
      // The gallery card's own caption format — a saved scene has no name,
      // so its timestamp is its identity there and here alike.
      option.textContent = galleryTimestamp(entry.createdAt);
      this.scheduleSourceSaved.appendChild(option);
    }
  }

  /** {@link setScheduleSavedScenes}'s twin for the Xaos "Add system as
   * isolated block" picker — same entries, same `saved:<id>` value shape,
   * kept as a second call rather than one shared option list because the
   * two pickers are independent DOM (a Xaos pick is read on button click,
   * never applied on change). main.ts calls both from the one collection
   * refresh. */
  setXaosAddSourceSavedScenes(
    entries: { id: string; createdAt: number }[],
  ): void {
    this.xaosAddSourceSaved.textContent = "";
    for (const entry of entries) {
      const option = this.doc.createElement("option");
      option.value = `saved:${entry.id}`;
      option.textContent = galleryTimestamp(entry.createdAt);
      this.xaosAddSourceSaved.appendChild(option);
    }
  }

  /** Snap the Xaos source picker back to its placeholder — called after a
   * successful (or refused) "+ Add as block", the preset picker's own
   * one-shot-action reset. */
  resetXaosAddSource(): void {
    this.xaosAddSource.value = "";
  }

  /** Reflect whether the ambient drift show is running on the Drift
   * toggle: lit + "stop" affordance while active, ghost otherwise. */
  setDriftActive(on: boolean): void {
    this.driftBtn.textContent = on ? "■ Stop drifting" : "▶ Drift";
    this.driftBtn.setAttribute("aria-pressed", String(on));
    this.driftBtn.classList.toggle("btn-ghost", !on);
    this.driftBtn.classList.toggle("btn-blue", on);
  }

  /** Enable/disable the Drift toggle for the OS reduced-motion
   * preference: no motion means no drift, so the button explains itself
   * instead of silently doing nothing. Native `disabled` pulls the button
   * out of the tab ring, so the title-only explanation is hover-only.
   * {@link driftNote} mirrors the same reason in the always-applicable
   * document-status area and aria-describedby associates it with the button. */
  setDriftAvailable(available: boolean): void {
    this.driftAvailable = available;
    this.syncGalleryDriftBtn();
    this.driftBtn.disabled = !available;
    this.driftBtn.title = available
      ? this.driftTitle
      : "Unavailable: your system asks for reduced motion";
    this.setReasonNote(
      this.driftNote,
      available ? "" : "Unavailable: your system asks for reduced motion.",
    );
  }

  /** Reflect the saved-scene count on the "▦ Gallery (N)" button — and on
   * "⬇ Back up collection"'s enabled state: an empty collection has
   * nothing to back up, and the swapped-in title says so instead of
   * leaving a dead button unexplained, the same self-explaining pattern as
   * {@link syncGalleryDriftBtn}. {@link exportCollectionNote} mirrors the
   * same reason in prose beside the button — see
   * {@link setDriftAvailable}'s doc comment for why. */
  setCollectionCount(count: number): void {
    this.collectionCount.textContent = String(count);
    this.exportCollectionBtn.disabled = count === 0;
    this.exportCollectionBtn.title =
      count === 0
        ? "Nothing saved yet — ★ Save to collection first"
        : this.exportCollectionTitle;
    this.setReasonNote(
      this.exportCollectionNote,
      count === 0 ? "Nothing saved yet — ★ Save to collection first." : "",
    );
  }

  /**
   * Arm the focus trap on a modal that has just been un-hidden:
   * remember what the user was on so {@link releaseModalFocus} can hand it
   * back, push it onto {@link modalStack} so the shared
   * `onModalStackKeydown` listener knows it is open — arming the listener
   * itself on the first push — then move focus INSIDE the dialog.
   *
   * All four modals declare `role="dialog" aria-modal="true"`, which tells
   * assistive technology the page behind the scrim is inert. Three of them
   * used to declare it and then do nothing about it — focus stayed on the
   * button that had opened the dialog and Tab walked straight into that
   * supposedly inert page — so this and {@link cycleModalFocus} are the two
   * halves of making the promise true.
   *
   * `dismiss` is the control the caller wants focus to land on, and every
   * modal passes its dismissive one (✕, or the export modal's Cancel) rather
   * than letting the ring's first member decide: Enter on a dialog that just
   * appeared under the user's hands must not commit to anything — a file, a
   * drift show, or a re-roll. It falls back to the first ring member when that
   * control is not on offer this time — or to the dialog box itself
   * (tabindex="-1") when the ring is empty.
   *
   * `onEscape` is this modal's whole Escape behavior (see
   * {@link ModalStackEntry}) — for the export modal, a closure that reads
   * {@link exportCancellable} fresh at Escape time rather than a value
   * snapshotted now, so a run that becomes cancellable mid-flight needs no
   * re-arming.
   *
   * The opener is only recorded from OUTSIDE the modal, so re-showing an
   * already-open dialog (the export modal does exactly this when a run
   * restarts) refreshes nothing and keeps the original opener — and, for the
   * same reason, does not push a second stack entry: a modal already on
   * {@link modalStack} keeps its place instead of gaining a duplicate, which
   * would leave one release call's worth of it still on the stack.
   */
  private trapModalFocus(
    modal: HTMLElement,
    dismiss: HTMLElement | undefined,
    onEscape: () => void,
  ): void {
    const opener = this.doc.activeElement;
    if (opener instanceof HTMLElement && !modal.contains(opener)) {
      this.modalOpeners.set(modal, opener);
    }
    if (!this.modalStack.some((entry) => entry.modal === modal)) {
      if (this.modalStack.length === 0) {
        this.doc.addEventListener("keydown", this.onModalStackKeydown);
      } else if (modal !== this.exportModal) {
        // Tripwire, not a behavior change: onModalStackKeydown's
        // Escape-to-oldest routing rests on the invariant that the export
        // modal is the ONLY one that ever stacks over another (every
        // sibling opener is pointer- and focus-unreachable while any modal
        // is up). Nothing structural enforces that — so if a future dialog
        // breaks it, say so out loud instead of letting Escape silently
        // close an invisible bottom modal.
        console.warn(
          "Modal stacked over an open sibling — Escape routing assumes only the export modal does this; revisit onModalStackKeydown.",
        );
      }
      this.modalStack.push({ modal, onEscape });
    }
    const ring = modalFocusRing(modal);
    const target = dismiss && ring.includes(dismiss) ? dismiss : ring[0];
    // One modal DOES ship with an empty ring: the points-arm export modal
    // — cancellable:false hides Cancel, and no run without a wait offers
    // the early-save action — so fall back to the dialog box itself
    // (tabindex="-1" in index.html) rather than leaving focus outside a
    // dialog that declares the page behind it inert.
    (target ?? this.modalDialog(modal))?.focus();
  }

  /** The modal's dialog box — the empty-ring focus fallback. All four
   * modals share the `.gallery-dialog` chrome; only the export modal's
   * carries the `tabindex="-1"` that makes the focus() land (a plain div's
   * focus() is a no-op), and only it can have an empty ring. */
  private modalDialog(modal: HTMLElement): HTMLElement | null {
    return modal.querySelector<HTMLElement>(".gallery-dialog");
  }

  /**
   * Hand focus back to whatever opened `modal`, completing the trap
   * {@link trapModalFocus} armed — otherwise closing a dialog drops focus on
   * the body and a keyboard user restarts their tab walk from the top of the
   * page. Also pops `modal`'s entry out of {@link modalStack},
   * BY IDENTITY rather than a blind top-pop — releasing a non-top modal (a
   * sibling closing out from under the still-open export modal, exactly the
   * case two paragraphs down) must remove its OWN entry and leave the rest
   * of the stack untouched — and drops the shared `onModalStackKeydown`
   * listener once the stack empties, mirroring the attach in
   * {@link trapModalFocus}.
   *
   * An opener the document no longer holds — a gallery card deleted from under
   * its own modal, a button a render-mode change rebuilt — forfeits the
   * restore rather than throwing. Idempotent and safe on a modal that was
   * never open, so every close path (✕, backdrop, Escape, the export modal's
   * Cancel) can call it unconditionally.
   *
   * A sibling closed UNDER the still-open export modal (an
   * Escape aimed at the gallery while the export runs above it) must not
   * yank focus out to a control behind two scrims; focus stays where the top
   * dialog trapped it. When the export modal's own recorded opener sat
   * inside the modal that just closed, it inherits the closing modal's
   * opener, so the eventual unwind still lands on something visible.
   */
  private releaseModalFocus(modal: HTMLElement): void {
    const opener = this.modalOpeners.get(modal);
    this.modalOpeners.delete(modal);
    const stackIndex = this.modalStack.findIndex(
      (entry) => entry.modal === modal,
    );
    if (stackIndex >= 0) {
      this.modalStack.splice(stackIndex, 1);
      if (this.modalStack.length === 0) {
        this.doc.removeEventListener("keydown", this.onModalStackKeydown);
      }
    }
    if (modal !== this.exportModal && this.exportModalOpen()) {
      const above = this.modalOpeners.get(this.exportModal);
      if (opener && above && modal.contains(above)) {
        this.modalOpeners.set(this.exportModal, opener);
      }
      return;
    }
    if (opener?.isConnected) opener.focus();
  }

  /**
   * Keep Tab inside `modal`'s ring, wrapping at both ends — the Tab
   * half of the trap, shared by the one document keydown handler
   * (`onModalStackKeydown`) on behalf of whichever modal is
   * newest on {@link modalStack}; Escape is that handler's own concern and
   * nothing to do with this method.
   *
   * Focus outside the ring (the modal opened over the page, or the focused
   * element was removed under it — a deleted gallery card) is pulled to the
   * first member rather than stepped from a position it does not have.
   *
   * An EMPTY ring (the points-arm export modal) still owns the
   * Tab: park focus on the dialog box instead of returning the keystroke to
   * the browser, which would walk it into the inert page behind the scrim.
   */
  private cycleModalFocus(modal: HTMLElement, e: KeyboardEvent): void {
    const ring = modalFocusRing(modal);
    if (ring.length === 0) {
      e.preventDefault();
      this.modalDialog(modal)?.focus();
      return;
    }
    e.preventDefault();
    const active = this.doc.activeElement;
    const at = active instanceof HTMLElement ? ring.indexOf(active) : -1;
    if (at < 0) {
      ring[0].focus();
      return;
    }
    const step = e.shiftKey ? -1 : 1;
    ring[(at + step + ring.length) % ring.length].focus();
  }

  /** Open the gallery modal over `scenes` (newest-first), arm Escape-to-close
   * and trap focus in the dialog. */
  openGallery(scenes: SavedScene[]): void {
    this.renderGallery(scenes);
    this.galleryModal.classList.remove("hidden");
    this.trapModalFocus(this.galleryModal, this.galleryCloseBtn, () =>
      this.closeGallery(),
    );
  }

  /** Hide the gallery modal, drop its {@link modalStack} entry and restore
   * focus to whatever opened it — skipped while the export modal still
   * stands above (see releaseModalFocus). Idempotent. */
  closeGallery(): void {
    this.galleryModal.classList.add("hidden");
    this.releaseModalFocus(this.galleryModal);
  }

  /** Open the "What is this?" dialog, arm Escape-to-close and trap focus. */
  openAbout(): void {
    this.aboutModal.classList.remove("hidden");
    this.trapModalFocus(this.aboutModal, this.aboutCloseBtn, () =>
      this.closeAbout(),
    );
  }

  /** Hide the "What is this?" dialog, drop its {@link modalStack} entry and
   * restore focus to whatever opened it — skipped while the export modal
   * still stands above (see releaseModalFocus). Idempotent. */
  closeAbout(): void {
    this.aboutModal.classList.add("hidden");
    this.releaseModalFocus(this.aboutModal);
  }

  /** Open the mutation-grid modal with all nine cells reset to placeholders,
   * arm Escape-to-close and trap focus. The app fills the cells as it builds
   * candidates — {@link setMutationCurrent} / {@link setMutationCell} — and
   * the ring is recomputed per keystroke, so a cell enabled after open is
   * tabbable. */
  openMutations(): void {
    this.resetMutationCells();
    this.mutationModal.classList.remove("hidden");
    this.trapModalFocus(this.mutationModal, this.mutationCloseBtn, () =>
      this.closeMutations(),
    );
  }

  /** Hide the mutation modal, drop its {@link modalStack} entry and restore
   * focus to whatever opened it — skipped while the export modal still
   * stands above (see releaseModalFocus). Idempotent. */
  closeMutations(): void {
    this.mutationModal.classList.add("hidden");
    this.releaseModalFocus(this.mutationModal);
  }

  /** Whether the mutation modal is on screen. The app's progressive cell
   * builder checks this each step so closing the modal ends the build. */
  mutationsOpen(): boolean {
    return !this.mutationModal.classList.contains("hidden");
  }

  /** Show the blocking export modal: a Save PNG capture is starting and may
   * run for minutes on a surface render with no other feedback otherwise on
   * screen. `cancellable: false` states honestly that the work cannot be
   * interrupted — a single GPU submission cannot be stopped mid-draw — and
   * HIDES the Cancel button rather than offering a dead one. `deliverEarly`
   * is the second action under the same rule: absent — every caller but the
   * flame Save-PNG's wait — leaves the modal with exactly one button, and
   * its label comes from the app because only the app knows what the early
   * picture will be. Arms the shared focus trap ({@link trapModalFocus},
   * released on {@link hideExportProgress}) with this modal's one
   * non-uniform Escape action: cancel, and ONLY while
   * {@link exportCancellable} — never the early-save action, which a stray
   * Escape must never commit to — and resets the readout to 0% so a new run
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
    // Cancel keeps the opening focus wherever it exists: Enter on a modal
    // that just appeared under the user's hands must not commit to a file.
    // Off-offer, the shared trap falls back to the ring's first member —
    // the early-save action when that is the only button up — or to the
    // dialog box itself when the run put up none.
    this.trapModalFocus(this.exportModal, this.exportCancelBtn, () => {
      if (this.exportCancellable) this.handlers?.onExportCancel();
    });
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

  /** Hide the modal, drop its {@link modalStack} entry, restore focus.
   * Idempotent. */
  hideExportProgress(): void {
    if (this.exportModal.classList.contains("hidden")) return;
    this.exportModal.classList.add("hidden");
    // The early-save action belongs to the run that offered it, so it goes
    // out with that run rather than waiting for the next
    // showExportProgress to decide: nothing is offering it in between, and
    // MEASURED — a browser run caught the leftover from a flame export
    // still sitting in the page during a solid one, which is the exact
    // "hidden is not absent" hole this detach discipline exists to close.
    this.exportDeliverBtn.remove();
    // Clear text too, not just hide: a stale percent left in textContent
    // reads as a live render to settle-scraping harnesses.
    this.exportProgress.textContent = "";
    this.exportProgress.style.setProperty("--progress", "0%");
    this.exportProgress.classList.remove("flame-progress-estimating");
    this.releaseModalFocus(this.exportModal);
  }

  /** Reflect a capture in flight on the Save PNG button: the modal's
   * scrim blocks it once shown, but the grace period leaves a window
   * where a second press would start a second capture. */
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
   * remembered inputs: the drift show's reduced-motion availability (shared
   * with the panel's Drift toggle) and whether there is anything saved to
   * loop over — with a title that says which one is the reason, mirroring
   * how the Drift toggle explains itself. The modal-local adjacent note is
   * load-bearing visible prose because the disabled button leaves the tab ring.
   */
  private syncGalleryDriftBtn(): void {
    const empty = this.gallerySceneCount === 0;
    this.galleryDriftBtn.disabled = !this.driftAvailable || empty;
    this.galleryDriftBtn.title = !this.driftAvailable
      ? "Unavailable: your system asks for reduced motion"
      : empty
        ? "Save a system or two first — the show loops through this collection"
        : this.galleryDriftTitle;
    this.setReasonNote(
      this.galleryDriftNote,
      !this.driftAvailable
        ? "Unavailable: your system asks for reduced motion."
        : empty
          ? "Save a system or two first — the show loops through this collection."
          : "",
    );
  }

  private galleryCard(scene: SavedScene): HTMLElement {
    const label = galleryTimestamp(scene.createdAt);
    // A saved-from-a-renderer entry wears its mode on the caption with the
    // segmented control's own glyphs, so a mixed gallery reads at a glance
    // which cards are flame/solid stills. Points entries stay bare.
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
   * (Re)build the timeline rows in playback order: called by main.ts at boot
   * and after every timeline edit (add/remove/move/retime). `durationLabel`
   * arrives preformatted (e.g. "0:18") — main.ts owns formatting the summed
   * morph/hold milliseconds into a clock label. All DOM is built with
   * `createElement`, never `innerHTML` — the same stance as
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
      // A keyframe captured from a flame/solid/surface render plays back
      // in that renderer and holds until it converges (the surface render
      // converges instantly) — flagged with the same glyph vocabulary as
      // galleryCard's mode caption. A plain (points) step gets no element
      // at all.
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
   * `label.timeline-step-timing`. Committing an empty or non-finite value
   * restores the input's displayed seconds from `currentMs` instead of
   * calling `onCommit` — the row undoes the bad edit in place rather than
   * ever sending a garbage value on; range clamping is the store's job
   * (`timeline.ts`'s `clampMs`), so the min/max attributes here are just
   * affordance. */
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
   * Play button: "■ Stop" + pressed + blue while playback runs, "▶ Play
   * timeline" + ghost otherwise. */
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

  /** Reflect the offline frame-exact export's progress on the Export
   * button: non-null (e.g. "42%") relabels it "⏳ Exporting 42%" and
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
   * any of them changes. {@link timelineNote} mirrors the same reason in
   * prose beside the pair, in the SAME priority order as the two title
   * derivations below so it can never disagree with what they show — see
   * {@link setDriftAvailable}'s doc comment for why a note is needed at
   * all, and {@link timelineNote}'s own doc comment for why one shared note
   * is safe for two buttons. */
  private syncTimelineButtons(): void {
    const empty = this.timelineStepCount === 0;
    // "⬇ Back up timeline" only needs something to write: a pure data
    // read, so neither reduced motion nor a running playback disables it —
    // the emptiness-only rule "⬇ Back up collection" follows
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

    // Mid-offline-export the button is the run's cancel affordance:
    // always enabled, whatever the availability/active flags say (the
    // run being active is exactly why it must stay clickable).
    if (this.timelineExportProgress !== null) {
      this.timelineExportBtn.disabled = false;
      this.timelineExportBtn.title =
        "Stop exporting — the partial clip still saves";
      // Mid-export neither button is stuck-disabled-unexplained: Export is
      // the run's own cancel affordance (forced enabled just above) and
      // Play reads "■ Stop" the whole run (main.ts's startTimelinePlayback
      // sets timelineActive before the first setTimelineExportProgress
      // call, and nothing clears it before the last) — so its own
      // `!timelineActive && …` disabled check above is already false.
      this.setReasonNote(this.timelineNote, "");
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
    this.setReasonNote(
      this.timelineNote,
      !this.timelineAvailable
        ? "Unavailable: your system asks for reduced motion."
        : empty
          ? "Add a keyframe or two first."
          : this.timelineActive
            ? "Export is unavailable while the timeline is playing — stop first."
            : "",
    );
  }

  /**
   * Flash a brief bottom-center confirmation ("Saved to collection", "Link
   * copied"), auto-hiding after {@link TOAST_DURATION_MS} — or, given an
   * `action` (e.g. "Undo" after a destructive delete), after the longer
   * {@link TOAST_ACTION_DURATION_MS} instead — unless the pointer or focus
   * is holding it open: hover/focusin pause the countdown and leaving
   * restarts it in full. Re-arming (any fresh call, action or not) cancels
   * the previous hide and rebuilds the toast's content from scratch, so
   * rapid actions don't leave it stuck or flickering and a stale action
   * button from a PRIOR toast can never linger into a plain one. Clicking
   * the action runs `onAction` and hides the toast immediately, ahead of
   * its own timer.
   */
  flashToast(message: string, action?: ToastAction): void {
    this.toast.replaceChildren(this.doc.createTextNode(message));
    if (action) this.toast.appendChild(this.buildToastActionButton(action));
    // An actionable toast opts its whole pill back into pointer events
    // (style.css's .toast-actionable) so mousing toward Undo pauses the
    // countdown; a plain toast stays click-through.
    this.toast.classList.toggle("toast-actionable", action !== undefined);
    this.toast.classList.remove("hidden");
    // A fresh toast starts a fresh countdown — but hover is RE-PROBED from
    // the live hit-test state, never assumed gone: an actionable toast
    // replacing a hovered actionable toast fires no new mouseenter (the
    // pointer never crossed the pill's boundary), and a blind reset dropped
    // the hold and auto-hid the new Undo under the user's own pointer.
    // Focus IS reset: replaceChildren above destroyed any focused action
    // button without a focusout, and a stale focus flag would wedge
    // releaseToast into never re-arming — which is the staleness the old
    // blind reset existed to prevent. A toast born held arms no timer;
    // releaseToast starts the full countdown when the pointer leaves.
    this.toastHovered = this.toast.matches(":hover");
    this.toastFocused = false;
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = this.toastHovered
      ? null
      : setTimeout(
          () => this.hideToast(),
          action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS,
        );
  }

  /** Hold the toast open: the pointer entered it, or focus landed inside it
   * — reading or reaching for the action must not race the auto-hide.
   * Cancels the pending hide; {@link releaseToast} re-arms it. */
  private holdToast(via: "hover" | "focus"): void {
    if (via === "hover") this.toastHovered = true;
    else this.toastFocused = true;
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
  }

  /** The pointer left the toast, or focus did: once NEITHER holds it and it
   * is still on screen, restart the full countdown ({@link holdToast}'s
   * other half). The timer-already-armed guard keeps a stray boundary event
   * from stacking a second timer. */
  private releaseToast(via: "hover" | "focus"): void {
    if (via === "hover") this.toastHovered = false;
    else this.toastFocused = false;
    if (this.toastHovered || this.toastFocused) return;
    if (this.toast.classList.contains("hidden")) return;
    if (this.toastTimer !== null) return;
    this.toastTimer = setTimeout(
      () => this.hideToast(),
      this.toastIsActionable() ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS,
    );
  }

  /** Whether the on-screen toast currently carries an action button — read
   * straight off the rendered DOM rather than a duplicate field: the button's
   * presence IS what makes a toast actionable, so it cannot drift from itself
   * the way a separately-set flag could. The `.toast-actionable` CLASS is not
   * it — that class exists for style.css's pointer-events opt-in and is its
   * own derivation of the same fact, one {@link releaseToast} must not
   * round-trip through. */
  private toastIsActionable(): boolean {
    return this.toast.querySelector(".toast-action") !== null;
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
   * timer's own trailing edge and the action button's immediate dismiss.
   * Clears the pause flags too: a hidden toast can fire no leave events, so
   * flags left set would hold the NEXT toast open forever. */
  private hideToast(): void {
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toast.classList.add("hidden");
    this.toastTimer = null;
    this.toastHovered = false;
    this.toastFocused = false;
  }

  /**
   * Reflect the color legend: an unobtrusive key for what
   * the current view's colors mean. WHICH key is `legend-spec.ts`'s
   * {@link deriveLegend} — a pure derivation off state, where the three
   * families and their priority order are documented; this method only
   * gathers the two things state cannot answer and paints the result.
   *
   * Takes the caller's already-computed `nonFlat` (see `updateLabels`) rather
   * than recomputing `systemIsNonFlat` here, so the two never risk reading a
   * different answer within the same refresh.
   */
  private updateLegend(state: AppState, nonFlat: boolean): void {
    this.paintLegend(
      deriveLegend({
        state,
        nonFlat,
        replayShowcase: this.replayShowcaseLegend,
        paletteName: (control: LegendPaletteControl, id) =>
          paletteDisplayName(this.scalarSelect(control), id),
      }),
    );
  }

  /** Arm/disarm the replay showcase's legend presentation — see
   * {@link replayShowcaseLegend}. Recorded only; the caller's
   * updateLabels sync repaints. */
  setReplayShowcaseLegend(on: boolean): void {
    this.replayShowcaseLegend = on;
  }

  /**
   * Paint a {@link LegendSpec} — the whole of the panel's legend behavior
   * that touches the DOM. Every decision (which family, which gradient,
   * which labels) was made by {@link deriveLegend}; nothing here reads state.
   *
   * The hidden and swatch cases deliberately leave the bar's gradient and
   * labels alone — only a bar repaints them, and it always writes all three
   * labels, so no stale "in our 3-space" can outlive the ramp it described.
   */
  private paintLegend(spec: LegendSpec): void {
    if (spec.kind === "hidden") {
      this.legend.classList.add("hidden");
      return;
    }
    const isBar = spec.kind === "bar";
    this.legend.classList.remove("hidden");
    this.legendBar.classList.toggle("hidden", !isBar);
    this.legendLabels.classList.toggle("hidden", !isBar);
    this.legendSwatches.classList.toggle("hidden", isBar);
    if (spec.kind === "bar") {
      this.legendBar.style.backgroundImage = spec.gradient;
      this.legendLabelLow.textContent = spec.low;
      this.legendLabelMid.textContent = spec.mid;
      this.legendLabelHigh.textContent = spec.high;
      return;
    }
    this.legendSwatches.replaceChildren();
    for (const item of spec.items) {
      const span = this.doc.createElement("span");
      if (item.kind === "label") {
        span.className = "legend-more";
        span.textContent = item.text;
      } else {
        span.className = "legend-swatch";
        span.style.backgroundColor = item.color;
      }
      this.legendSwatches.appendChild(span);
    }
  }

  /** Reflect flame-render progress as an iteration count and percentage.
   * Also clears the busy state {@link setFlameEstimating} set — every
   * `progress`/`sharedFrame` event from the worker is what ends an
   * "estimating" spell, whichever one arrives next. */
  setFlameProgress(iterationsDone: number, iterationsBudget: number): void {
    // floor, not round: a 99.7%-done progressive frame must not claim
    // "(100%)" — reading 100% while the image is still not final is exactly
    // the ambiguity the busy indicator exists to remove.
    const pct =
      iterationsBudget > 0
        ? Math.min(100, Math.floor((iterationsDone / iterationsBudget) * 100))
        : 100;
    const done = formatIterationCount(iterationsDone);
    const budget = formatIterationCount(iterationsBudget);
    this.flameProgress.classList.remove("flame-progress-estimating");
    this.flameProgress.textContent = `${done} / ${budget} iterations (${pct}%)`;
    this.flameProgress.style.setProperty("--progress", `${pct}%`);
    this.announceFlameProgress(pct);
  }

  /**
   * The live-region half of {@link setFlameProgress}: announces only a
   * newly crossed {@link PROGRESS_ANNOUNCE_QUARTILES} boundary. `pct <= 0`
   * is this readout's own reset signal — a fresh session's
   * `setFlameProgress(0, budget)` (see main.ts's flame `resetProgress`) and
   * the worker's mid-session "restarted" event both call it that way — so
   * it re-arms the quartile rather than being treated as a crossing, and
   * clears the announcer text too: a render that restarts right after
   * reaching (say) 25% and lands on 25% again must still mutate the live
   * region, and an unchanged string is not guaranteed to re-announce.
   */
  private announceFlameProgress(pct: number): void {
    if (pct <= 0) {
      this.flameAnnouncedQuartile = 0;
      this.renderProgressAnnouncer.textContent = "";
      return;
    }
    const { armed, text } = crossedProgressQuartile(
      "Flame",
      pct,
      this.flameAnnouncedQuartile,
    );
    this.flameAnnouncedQuartile = armed;
    if (text !== null) this.renderProgressAnnouncer.textContent = text;
  }

  /**
   * Busy indicator for the worker's synchronous adaptive density-estimation
   * pass: shown right when the worker posts `estimating`, i.e. while it is
   * still crunching that multi-second pass with no other feedback otherwise on
   * screen. Cleared by the next {@link setFlameProgress} call, which the
   * following `progress`/`sharedFrame` event always triggers.
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
   * requested value unclamped, to clear the note.
   *
   * TEXT ALONE drives visibility here and in the four sibling status notes:
   * the element stays rendered — never `.hidden` — because a live region
   * entering the accessibility tree already populated announces unreliably,
   * and this note is re-cleared at every render start, so populate-then-unhide
   * was its only path. style.css's `:empty` rule collapses the cleared state.
   */
  setFlameSupersampleNote(effective: number | null, requested?: number): void {
    if (effective === null) {
      this.flameSupersampleNote.textContent = "";
      return;
    }
    this.flameSupersampleNote.textContent =
      requested !== undefined
        ? `Reduced to ${effective}× (from ${requested}×) to fit available memory.`
        : `Reduced to ${effective}× to fit available memory.`;
  }

  /**
   * Which accumulation engine is driving the current flame render — reflects
   * the worker's one-time-per-backend `"backend"` event (see
   * `flame-worker-core.ts`'s `FlameAccumBackend`), so a GPU render (or a
   * mid-session fallback to CPU) is visible rather than silent. `adapter` is
   * whatever label the GPU backend factory discovered (e.g. a `GPUAdapterInfo`
   * description); omitted for the CPU backend, or a GPU one with no better
   * label to offer. `detail` is a short why-am-I-on-CPU annotation ("GPU
   * failed", "WebGPU unavailable") shown when the CPU backend is a FALLBACK
   * rather than the natural choice — the one-word answer that makes a field
   * report of "it says CPU" diagnosable. `software` is the worker backend
   * event's own GPUAdapterInfo fallback/SwiftShader tell, escalating this
   * note's tier: true swaps the note's class from informational
   * `.flame-note-info` to warning `.flame-note` — software rasterization must
   * not pass as a normal backend note. The swap runs on every non-null call
   * (not just the software→hardware transition), so a later hardware backend
   * note un-escalates cleanly. `null` clears the note, mirroring
   * {@link setFlameSupersampleNote}'s contract (cleared at the start of every
   * render, before the fresh worker reports its own) — the tier classes are
   * left alone on that path, since an empty note shows neither way. Text alone
   * drives visibility (see {@link setFlameSupersampleNote}): the element stays
   * rendered so the live region actually announces the restart-time CPU
   * fallback.
   */
  setFlameBackendNote(
    backend: "gpu" | "cpu" | null,
    adapter?: string,
    detail?: string,
    software = false,
  ): void {
    if (backend === null) {
      this.flameBackendNote.textContent = "";
      return;
    }
    this.flameBackendNote.textContent =
      backend === "gpu"
        ? `GPU accumulation${adapter ? ` (${adapter})` : ""}`
        : `CPU accumulation${detail ? ` — ${detail}` : ""}`;
    this.flameBackendNote.classList.toggle("flame-note", software);
    this.flameBackendNote.classList.toggle("flame-note-info", !software);
  }

  /**
   * Device-level software-rasterizer warning: unlike the per-mode notes
   * elsewhere in this file, this one sits OUTSIDE every render mode (see
   * `softwareRendererNote`'s placement in index.html, ahead of `flameStatus`)
   * because a silently software-rendered session — the trigger incident was a
   * browser-blocklisted GPU — is exactly as misleading in Points as it is in
   * Flame or Surface. Warning-tier `.flame-note` (red, `var(--bad)`) per the
   * style.css contract: software rasterization standing in for the real GPU is
   * a "not quite what you asked for" condition, not a routine informational
   * note. A runtime, device-dependent fact that isn't part of `AppState`, so —
   * like {@link setFlameBackendNote} — this is a targeted setter main.ts calls
   * directly rather than something `updateLabels` derives. `null` clears the
   * note; text alone drives visibility (see {@link setFlameSupersampleNote}).
   */
  setSoftwareRendererNote(text: string | null): void {
    this.softwareRendererNote.textContent = text ?? "";
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
    this.announceSolidProgress(pct);
  }

  /** The live-region half of {@link setSolidProgress} — see
   * {@link announceFlameProgress}, its mirror. */
  private announceSolidProgress(pct: number): void {
    if (pct <= 0) {
      this.solidAnnouncedQuartile = 0;
      this.renderProgressAnnouncer.textContent = "";
      return;
    }
    const { armed, text } = crossedProgressQuartile(
      "Solid",
      pct,
      this.solidAnnouncedQuartile,
    );
    this.solidAnnouncedQuartile = armed;
    if (text !== null) this.renderProgressAnnouncer.textContent = text;
  }

  /**
   * Reflect whether the resolution slider's requested value had to be reduced
   * to fit the worker's memory budget — the solid render's counterpart to
   * {@link setFlameSupersampleNote}, with the same `null`-clears contract and
   * the same text-driven visibility.
   */
  setSolidResolutionNote(effective: number | null, requested?: number): void {
    if (effective === null) {
      this.solidResolutionNote.textContent = "";
      return;
    }
    this.solidResolutionNote.textContent =
      requested !== undefined
        ? `Reduced to ${effective}³ (from ${requested}³) to fit available memory.`
        : `Reduced to ${effective}³ to fit available memory.`;
  }

  /**
   * Reflect the surface render's marchability (from `analyzeSurfaceSystem` +
   * the uniform-array cap): `ineligible` disables the mode button and mirrors
   * its complete reason into the persistent adjacent note; `degraded` keeps
   * it enabled and shows the analyzer's exact detail before entry (which may
   * describe an alternate valid object, not merely reduced fidelity);
   * `eligible` restores the default affordance and clears stale text. main.ts
   * recomputes this on every document change, including drag ticks, so the
   * equality-guarded note never chatters when its text is unchanged.
   */
  setSurfaceEligibility(
    status: "eligible" | "degraded" | "ineligible",
    detail: string | null,
    kind: SurfaceRouteKind | null = null,
    recovery: SurfaceEligibilityRecovery | null = null,
  ): void {
    const button = this.modeButtons.surface;
    const blocked = status === "ineligible";
    const refusal = `Surface render unavailable: ${detail ?? "not marchable"}`;
    const noteText = blocked
      ? refusal
      : status === "degraded" && detail
        ? detail
        : "";
    button.disabled = blocked;
    button.title = blocked ? refusal : "Sphere-traced surface of the attractor";
    // Text alone drives visibility; the element stays rendered so the live
    // region announces transitions and remains outside hidden mode content.
    this.setReasonNote(this.surfaceNote, noteText);
    this.surfaceEligibilityRecoveryBtn.classList.toggle(
      "hidden",
      !blocked || recovery !== "disableShapeTrapGeometry",
    );
    // The route kind reaches the transform editor's Finish group (see
    // surfaceRouteKind's doc): re-applied to a live editor here because the
    // gate refresh runs AFTER the editor build on every refresh path.
    this.surfaceRouteKind = kind;
    this.applyMaterialDisclosure();
  }

  /**
   * Reflect the surface trace's coverage: heavy fold poses grind their
   * preview/settle strip jobs for seconds to MINUTES, and the mode's verdict
   * is to never give up on a frame — this row is what lets the user decide
   * whether the pose is worth the wait. Same text-plus-underline idiom as
   * {@link setFlameProgress}; `null` hides the row (instant renders and
   * settled frames, the common case, never show it). Unlike the flame/solid
   * rows it hides rather than parking at 0%, because most surface renders
   * finish within a frame or two and a permanent "0%" would read as a stuck
   * render. POSE-derived and polled from the render loop — never shares
   * {@link setSurfaceEligibility}'s document-derived note element. `detail`
   * is a fallback-reason token ("compute failed" / "compute unavailable")
   * appended TRAILING after the percentage, so the engine token and
   * percentage stay the prominent read — the render-backend disclosure's
   * legibility lesson: the eye catches leading tokens.
   *
   * `skippable` shows the one-shot "Skip preview" button under the row —
   * main.ts passes it exactly while a preview is grinding (the phase with a
   * full render to skip TO): a WebGL preview strip job, or the compute path's
   * unbudgeted completion pass. The button hides with the row, and settles
   * never show it (there is nothing after a settle to skip to).
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
      // reads as a live percent to settle-scraping harnesses.
      this.surfaceProgress.textContent = "";
      this.surfaceProgress.classList.add("hidden");
      this.surfaceProgress.style.setProperty("--progress", "0%");
      this.announceSurfaceProgress(null);
      return;
    }
    this.surfaceProgress.textContent = `${progress.label} ${String(progress.pct)}%${progress.detail ? ` — ${progress.detail}` : ""}`;
    this.surfaceProgress.style.setProperty(
      "--progress",
      `${String(progress.pct)}%`,
    );
    this.surfaceProgress.classList.remove("hidden");
    this.announceSurfaceProgress(progress);
  }

  /**
   * The live-region half of {@link setSurfaceProgress}. `null` is
   * this row's own reset signal (mirrors flame/solid's `pct <= 0` — see
   * {@link announceFlameProgress}): re-arms the quartile and the
   * antialiasing one-shot for whichever preview/settle job comes next, and
   * clears the announcer so a re-armed render landing on the same quartile
   * still mutates the live region. The engine one-shot deliberately does
   * NOT reset here — see {@link surfaceAnnouncedEngine}'s field doc: a
   * cheap system can cycle null -> 100% -> null once a frame during a drag,
   * and re-announcing "using WebGPU" on every one of those jobs would be
   * exactly the chatter this feature exists to avoid.
   *
   * A single call can have up to three genuinely new facts to speak (engine
   * first seen or changed, antialiasing just started, a quartile just
   * crossed) — collected and spoken as ONE utterance rather than raced as
   * three separate writes to the shared announcer.
   */
  private announceSurfaceProgress(
    progress: { label: string; pct: number; detail?: string } | null,
  ): void {
    if (progress === null) {
      // Re-arm for the next job — but unlike flame/solid's reset, do NOT
      // clear the announcer text (wave-5 review finding): surface nulls
      // arrive a frame after a settle completes, so a clear here wiped the
      // just-written "100 percent" before a screen reader could dequeue
      // the polite utterance — the one boundary that says the picture is
      // done. The text persists until the next genuinely new utterance
      // overwrites it; the narrow cost is that a later settle crossing the
      // SAME quartile as the last text written is not re-spoken, which is
      // the lesser loss by far.
      this.surfaceAnnouncedQuartile = 0;
      this.surfaceAntialiasingAnnounced = false;
      return;
    }
    const toAnnounce: string[] = [];
    const engine = surfaceProgressEngine(progress.label);
    if (engine !== null && engine !== this.surfaceAnnouncedEngine) {
      this.surfaceAnnouncedEngine = engine;
      toAnnounce.push(`Surface render, using ${engine}`);
    }
    const antialiasing =
      progress.detail?.includes("antialiasing pass") ?? false;
    if (antialiasing && !this.surfaceAntialiasingAnnounced) {
      toAnnounce.push("Surface render, antialiasing passes underway");
    }
    this.surfaceAntialiasingAnnounced = antialiasing;
    // Quartiles speak for FULL-DETAIL jobs only (wave-5 review finding):
    // preview jobs recycle continuously under auto-orbit/auto-tumble — a
    // motion that never parks would otherwise cross 25/50/75/100 per
    // preview, forever, which is the exact chatter this feature exists to
    // prevent. The settle is the render whose progress means something to
    // wait for, and it only runs on a parked view.
    if (progress.label.startsWith("Full detail")) {
      const { armed, text } = crossedProgressQuartile(
        "Surface",
        progress.pct,
        this.surfaceAnnouncedQuartile,
      );
      this.surfaceAnnouncedQuartile = armed;
      if (text !== null) toAnnounce.push(text);
    }
    if (toAnnounce.length > 0) {
      this.renderProgressAnnouncer.textContent = toAnnounce.join(". ");
    }
  }

  /** Seed the "Quick previews" checkbox from the stored viewer pref at boot
   * — the checkbox itself is the live source of truth afterward, so this is
   * a one-time write, not a sync. */
  setSurfacePreviewToggle(on: boolean): void {
    this.surfacePreviewToggle.checked = on;
  }

  /**
   * Rebuild the "select to edit" list: a camera row, one row per transform,
   * and — when a final transform is enabled — a lens row at the bottom.
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

    // The list render is the panel's feed of the WHOLE transform set, so
    // it is where the forward-orbit head is read off (a weight edit can move
    // it); the finish disclosure re-applies in case the editor is live.
    this.forwardHead = forwardHeadIndex(transforms);
    this.applyMaterialDisclosure();

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
            ...emitterSummary(t),
            ...colorSummary(t),
            ...finishSummary(t),
            ...patternSummary(t),
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

  /**
   * Rebuild the Xaos section's document-driven half — the leak-dial rows
   * and the matrix table — from the current transform list. Called from
   * `refreshUi()` (add/remove/preset/undo-redo/select — the discrete
   * edits, exactly like {@link renderTransformList}), NEVER from
   * `updateLabels()` alone: that runs on every scalar-slider "input" tick
   * across the WHOLE panel (`onScalarControl`'s own doc), and rebuilding a
   * 24-square matrix on every tick of an unrelated fog/glow/exposure drag
   * would be wasted work on every one of them. Cell commits and leak-dial
   * drags call this themselves (via `onXaosCell`/`onXaosLeak`'s main.ts
   * wiring) exactly when a rebuild is safe — see the Advanced matrix's own
   * `change`-not-`input` choice below.
   */
  renderXaosSection(transforms: Transform[]): void {
    const blocks = detectXaosBlocks(transforms);
    const leaks = detectXaosLeaks(transforms, blocks);
    const palette = transformColors(
      transforms.length,
      transforms.map((t) => t.colorIndex),
    );
    this.renderXaosLeakRows(blocks, leaks, palette);
    this.renderXaosMatrix(transforms, palette);
  }

  /** One small color-coded chip, `legend-spec.ts`'s swatch reused to key a
   * matrix row/column or a leak-row block against the transform list's own
   * accent colors ({@link transformColors}). */
  private xaosChip(rgb: Vec3): HTMLElement {
    const chip = this.doc.createElement("span");
    chip.className = "legend-swatch xaos-chip";
    chip.style.background = `rgb(${to255(rgb[0])}, ${to255(rgb[1])}, ${to255(rgb[2])})`;
    return chip;
  }

  /**
   * The leak-dial rows: one per block pair from {@link detectXaosLeaks},
   * "the isolated → 1% → full-merge continuum as one slider before anyone
   * opens the matrix" (fr-wo2j.6's design). Hidden entirely with fewer
   * than two blocks (an untouched, or fully merged, system) — there is no
   * pair to dial. A pair whose cross entries are not a single uniform
   * value (`XaosLeak.value === null`, a hand edit) reads as "Customized"
   * rather than guessing a slider position that isn't really there.
   */
  private renderXaosLeakRows(
    blocks: number[][],
    leaks: XaosLeak[],
    palette: Vec3[],
  ): void {
    this.xaosLeakRows.replaceChildren();
    if (blocks.length < 2) {
      this.xaosLeakRows.classList.add("hidden");
      return;
    }
    this.xaosLeakRows.classList.remove("hidden");
    for (const leak of leaks) {
      const row = this.doc.createElement("div");
      row.className = "editor-row xaos-leak-row";

      const label = this.doc.createElement("span");
      label.className = "xaos-leak-label";
      label.appendChild(this.xaosChip(palette[leak.blockA[0]]));
      label.appendChild(this.doc.createTextNode("↔"));
      label.appendChild(this.xaosChip(palette[leak.blockB[0]]));
      row.appendChild(label);

      if (leak.value === null) {
        const note = this.doc.createElement("span");
        note.className = "xaos-leak-note";
        note.textContent = "Customized — edit the matrix below";
        row.appendChild(note);
      } else {
        const slider = this.doc.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "1";
        slider.step = "0.01";
        slider.value = String(Math.min(1, Math.max(0, leak.value)));
        slider.setAttribute(
          "aria-label",
          `Leak between the block starting at transform ${leak.blockA[0] + 1} ` +
            `and the block starting at transform ${leak.blockB[0] + 1}`,
        );
        const readout = this.doc.createElement("span");
        readout.className = "value";
        readout.textContent = formatXaosLeak(leak.value);
        slider.addEventListener("input", () => {
          const value = Number(slider.value);
          readout.textContent = formatXaosLeak(value);
          this.handlers?.onXaosLeak(leak.blockA, leak.blockB, value, "input");
        });
        slider.addEventListener("change", () => {
          this.handlers?.onXaosLeak(
            leak.blockA,
            leak.blockB,
            Number(slider.value),
            "commit",
          );
        });
        row.appendChild(slider);
        row.appendChild(readout);
      }
      this.xaosLeakRows.appendChild(row);
    }
  }

  /**
   * The n×n chi matrix, behind the Advanced disclosure: rows = FROM map,
   * columns = TO map (`chaos-game.ts`'s `Transform.chaos` convention),
   * every cell a NUMERIC input rather than a slider — a grid of two dozen
   * or more tiny range thumbs is exactly the tap-jump/pan hazard
   * `slider-scroll-guard.ts` exists to police, and a plain number input
   * sidesteps the question outright (fr-wo2j.6's own touch-hazard note).
   * Cells commit on `change` (blur/Enter), not `input`: the matrix rebuilds
   * itself on every commit (to refresh the leak rows and the degenerate-row
   * warnings, which a single cell edit can change), and rebuilding on
   * every keystroke would tear the focused input out from under the
   * user's cursor. The diagonal (a map re-selecting itself) is a normal,
   * editable cell — flam3 allows and uses self-transitions — with only a
   * faint background as a reading aid for a big grid.
   *
   * Wrapped in its own horizontal-scroll container: usable at 24+ maps
   * (the shipped fern|sponge presets' size) without pretending an n×n grid
   * scales to the 256-transform cap.
   */
  private renderXaosMatrix(transforms: Transform[], palette: Vec3[]): void {
    const n = transforms.length;
    this.xaosMatrixContainer.replaceChildren();
    if (n < 2) {
      this.xaosMatrixNote.textContent =
        "Add a second transform to author selection rows between maps.";
      this.xaosMatrixNote.classList.remove("hidden");
      return;
    }
    this.xaosMatrixNote.textContent = "";
    this.xaosMatrixNote.classList.add("hidden");

    // The engine's own degenerate-row table (chaosFallbackRows — an
    // all-zero-after-weighting row silently falls back to the global pick
    // table): read off a real prepareChaosGame rather than re-deriving the
    // weighting here, so this warning can never drift from what actually
    // renders.
    const fallbackRows = new Set(
      prepareChaosGame(transforms).chaosFallbackRows ?? [],
    );

    const scroll = this.doc.createElement("div");
    scroll.className = "xaos-matrix-scroll";

    const table = this.doc.createElement("table");
    table.className = "xaos-matrix-table";
    table.setAttribute(
      "aria-label",
      "Xaos matrix: rows are the map just applied, columns are the map picked next",
    );

    const thead = this.doc.createElement("thead");
    const headRow = this.doc.createElement("tr");
    headRow.appendChild(this.doc.createElement("th"));
    for (let j = 0; j < n; j++) {
      const th = this.doc.createElement("th");
      th.className = "xaos-matrix-col-head";
      th.appendChild(this.xaosChip(palette[j]));
      th.appendChild(this.doc.createTextNode(String(j + 1)));
      headRow.appendChild(th);
    }
    headRow.appendChild(this.doc.createElement("th"));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = this.doc.createElement("tbody");
    for (let i = 0; i < n; i++) {
      const tr = this.doc.createElement("tr");
      const rowHead = this.doc.createElement("th");
      rowHead.className = "xaos-matrix-row-head";
      rowHead.appendChild(this.xaosChip(palette[i]));
      rowHead.appendChild(this.doc.createTextNode(String(i + 1)));
      tr.appendChild(rowHead);

      for (let j = 0; j < n; j++) {
        const td = this.doc.createElement("td");
        td.className =
          i === j ? "xaos-matrix-cell diagonal" : "xaos-matrix-cell";
        const input = this.doc.createElement("input");
        input.type = "number";
        input.className = "xaos-matrix-input";
        input.min = "0";
        input.max = "2";
        input.step = "0.01";
        const previous = resolveChaosEntry(transforms[i].chaos?.[j]);
        input.value = String(previous);
        input.setAttribute(
          "aria-label",
          `Chi from transform ${i + 1} to transform ${j + 1}`,
        );
        input.addEventListener("change", () => {
          const raw = Number(input.value);
          if (input.value === "" || !Number.isFinite(raw) || raw < 0) {
            input.value = String(previous);
            return;
          }
          this.handlers?.onXaosCell(i, j, raw);
        });
        td.appendChild(input);
        tr.appendChild(td);
      }

      const warn = this.doc.createElement("td");
      warn.className = "xaos-matrix-warn";
      if (fallbackRows.has(i)) {
        warn.textContent = "⚠ all-zero — falls back to the global table";
      }
      tr.appendChild(warn);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    scroll.appendChild(table);
    this.xaosMatrixContainer.appendChild(scroll);
  }

  private transformButton(options: TransformButtonOptions): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.className = options.selected
      ? "transform-btn selected"
      : "transform-btn";
    // The selection state, exposed to assistive tech — the render-mode
    // switch's aria-pressed pattern. Kept live for free: the list is
    // rebuilt from scratch on every selection change.
    button.setAttribute("aria-pressed", String(options.selected));
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
   * group's derived palette slot is a property of the map's
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
   * Create one collapsible editor group. The editor measured 786px
   * of the Transforms section's 1253px on a 393x727 phone — two and a half
   * screens for one selected transform, and nearly every pixel of it a live
   * slider a thumb has to cross to scroll past. Only one group is ever being
   * edited at a time, so they collapse into an exclusive sub-accordion under
   * one shared `name`.
   *
   * The 4D group was already exactly this shape; the other seven
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

    // The final transform omits Weight, Shape, Color, Finish and Pattern (see
    // below), so a remembered choice of any would build an editor with
    // nothing open at all.
    const remembered =
      target === "final" &&
      (this.editorOpenGroup === "Weight" ||
        this.editorOpenGroup === "Shape" ||
        this.editorOpenGroup === "Color" ||
        this.editorOpenGroup === "Finish" ||
        this.editorOpenGroup === "Pattern")
        ? null
        : this.editorOpenGroup;
    // Resolved per build and deliberately NOT written back to
    // `editorOpenGroup`: leaving the field null until a real user toggle keeps
    // the 4D group's rule alive for every 4D transform selected before then,
    // not just the first one the session happens to build.
    const openGroup =
      remembered ??
      (transform.emitter !== undefined
        ? "Shape"
        : transform.w !== undefined
          ? "4D"
          : DEFAULT_EDITOR_GROUP);

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
      // Copied RAW, unresolved: `undefined` here is the transform's real
      // state — "authors none, so the renderers derive it" — and keeping it
      // that way is what lets an unrelated edit round-trip a map without
      // materializing either key. The rows resolve for DISPLAY only; see
      // buildColorControls.
      colorIndex: transform.colorIndex,
      colorSpeed: transform.colorSpeed,
      // Raw presence like the color pair, but CLONED: the finish rows edit
      // this object in place, and the document's own must stay untouched
      // until the edit is emitted through the handler.
      finish: cloneFinish(transform.finish),
      // The pattern's own clone — see {@link cloneSurfacePattern}.
      surfacePattern: cloneSurfacePattern(transform.surfacePattern),
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
    // A condensation shape belongs to the picked map, never the final lens.
    // Keep it beside Weight: Weight controls how often this map emits the
    // selected shape, while the ordinary TRS groups above pose it.
    const emitterSelect =
      target === "final"
        ? null
        : this.buildEmitterGroup(transform.emitter, target, openGroup);
    // Color sits directly below Weight and above Variations: the two
    // per-map structural-color fields belong beside the other whole-map
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
    // Finish sits directly below Color: the other whole-map property a
    // RENDERER reads off this map (the surface tracers shade a hit by the
    // slot that produced it), beside the two the chaos game reads when it
    // picks it, and above the per-variation warp parameters. Omitted for
    // the final transform — see FinalGeometry.
    const finishControls =
      target === "final"
        ? null
        : this.buildFinishControls(
            geometry.finish,
            geometry.surfacePattern,
            openGroup,
          );
    // Pattern sits directly below Finish: the other per-map property a
    // RENDERER reads off this map (the surface tracers pattern a hit by the
    // slot that produced it, right where the albedo enters the shade chain),
    // and the group the Finish group's Material menu reaches down into.
    // Omitted for the final transform — see FinalGeometry.
    const patternControls =
      target === "final"
        ? null
        : this.buildPatternControls(geometry.surfacePattern, openGroup);
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
      finishTouched: false,
      patternTouched: false,
      controls,
      mirror,
      weightControl,
      emitterSelect,
      colorControls,
      finishControls,
      patternControls,
      variations: (transform.variations ?? []).map((v) => ({ ...v })),
      variationList: list,
      variationAdd: add,
      fourD,
    };
    this.renderVariationRows();
    this.refreshAddOptions();
    // The rows were built from the working copy already; this applies the
    // head-only disclosure and the family-none enablement, which need
    // `this.editor` to exist.
    this.applyMaterialDisclosure();
  }

  /** Build a Scale group's "Mirror" row of aria-pressed toggle buttons —
   * pressed means the corresponding scale component is negative (a
   * reflection). Shared by the 3D Scale group's X/Y/Z toggles and the 4D
   * group's single Scale W toggle. The scale sliders carry pure magnitude,
   * so these toggles are the editor's only way to create or clear a
   * mirror. */
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

  /** Build the selected map's condensation-shape picker. Choosing a shape
   * turns this map into a fixed-shape emitter; the existing TRS controls pose
   * it and Weight controls its selection probability. */
  private buildEmitterGroup(
    emitter: ShapeSpec | undefined,
    target: number,
    openGroup: string,
  ): HTMLSelectElement {
    const group = this.createEditorGroup("Shape", openGroup);

    const hint = this.doc.createElement("p");
    hint.className = "flame-hint";
    hint.textContent = `Stamp ${BUNDLED_EMITTER_SHAPES.map((entry) => entry.label).join(" or ")} whenever this transform is picked. Position, Rotation and Scale pose it; Weight controls how often it appears.`;

    const label = this.doc.createElement("label");
    label.className = "select-label";
    label.textContent = "Emitter";

    const select = this.doc.createElement("select");
    select.setAttribute("aria-label", "Shape emitter");
    const choices: readonly (readonly [EmitterSelectValue, string])[] = [
      ["", "None (ordinary transform)"],
      ...BUNDLED_EMITTER_SHAPES.map(
        (entry) => [entry.kind, bundledShapeOptionLabel(entry)] as const,
      ),
      ["custom", "Authored shape"],
    ];
    for (const [value, text] of choices) {
      const option = this.doc.createElement("option");
      option.value = value;
      option.textContent = text;
      if (value === "custom") option.hidden = true;
      select.appendChild(option);
    }
    select.value = emitterSelectValue(emitter);
    select.addEventListener("change", () => {
      const value = select.value;
      if (!value) {
        this.handlers?.onTransformEmitter(target, null);
        return;
      }
      if (value === "custom") return;
      const entry = bundledShapeEntry(value);
      if (entry?.emitter) {
        this.handlers?.onTransformEmitter(target, entry.kind);
      }
    });

    label.appendChild(select);
    group.append(hint, label);
    this.transformEditor.appendChild(group);
    return select;
  }

  /**
   * Build the "Color" group: the two per-map structural-color
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

    // The two fields do not share one reach. Index also steers a Surface
    // render, but only under its Palette (orbit-trap) color source —
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
   * Build the "Finish" group: a scope hint, the material starting-point
   * select, the named-bundle select, and one row per field of the
   * transform's optional surface finish (`types.ts`'s `SurfaceFinish`) —
   * the fold's authored lengths' construction
   * ({@link appendFoldRadiusRows}) one level up, on the transform rather
   * than a variation, because a finish is a property of the MAP's part of
   * the surface, not of a warp it applies.
   *
   * The same two rules keep "absent means classic BYTE-IDENTICALLY" true
   * through an editing session: a field is written into the document ONLY
   * once its own slider moves (opening the group, picking the transform, or
   * moving a neighbouring slider materializes nothing), and a slider dragged
   * back to its classic value REMOVES the field again — the whole `finish`
   * object with it once the last field goes. The bundle select is UI
   * vocabulary over the same six sliders: picking one sets all six through
   * the very same write rule, so "Classic" clears the finish outright and
   * every other bundle stores only the fields that differ from classic.
   *
   * The MATERIAL select sits above the bundles: a material starting point
   * (Wood/Marble/Strata, see {@link MATERIAL_PRESETS}) sets the six finish
   * sliders AND the pattern group below through the same per-field rule,
   * "None" clears both, and it reads back whichever starting point the
   * current finish+pattern IS — "Custom" (disabled, so it can be shown but
   * never chosen) when they are nobody's, exactly like the bundle select
   * one row down.
   *
   * The rows display the RESOLVED value while a field is absent (the classic
   * number `surface-finish.ts`'s resolver would use), exactly as the Color
   * rows display the derived palette slot — only the working copy is empty.
   */
  private buildFinishControls(
    finish: SurfaceFinish | undefined,
    pattern: SurfacePattern | undefined,
    openGroup: string,
  ): FinishControls {
    const group = this.createEditorGroup("Finish", openGroup);

    // The scope note, in the Color group's hint idiom: every other render
    // mode ignores a finish, and a slider that moves nothing on screen would
    // otherwise teach that the group is broken.
    const hint = this.doc.createElement("p");
    hint.className = "flame-hint";
    // A metal reads as its environment. Point users at the authorable room
    // input that gives a mirror recognizable structure on the shipped dark
    // backdrop, and state the intentional Metal/Chrome tint distinction.
    hint.textContent =
      "Surface renders only: how this map's part of the surface catches light. The Material menu sets a finish and a pattern family together; a bundle sets all six controls; Classic clears them. Metal keeps the transform tint; Chrome stays neutral. Turn on Floor and Floor light to give reflections room structure.";
    group.appendChild(hint);

    // The forward-orbit disclosure — hidden until applyMaterialDisclosure
    // finds the document routing to an escape-time chain or a Mandelbulb
    // with this transform not at its head.
    const note = this.doc.createElement("p");
    note.className = "flame-hint finish-note hidden";
    note.textContent =
      "Escape-time and Mandelbulb surfaces shade the whole object with the FIRST active transform's finish, so this one is not read there. It still applies to an IFS surface.";
    group.appendChild(note);

    // The material select acts like a preset menu over the finish AND the
    // pattern group: a pick sets both, and it REFLECTS them — reading
    // "None" (the all-clear state, pickable to clear both) when nothing is
    // authored, a starting point's name when the current finish+pattern is
    // one, and the disabled "Custom" whenever the two are nobody's preset
    // (see materialPresetOf). The pattern family and the material preset
    // are deliberately DIFFERENT concepts: the preset ties a family to a
    // finish, and the two come apart the moment either side is retuned.
    const material = this.doc.createElement("select");
    material.className = "finish-material";
    material.setAttribute("aria-label", "Material");
    material.title =
      "Material starting points that set the finish and the pattern family together — the scene stores the numbers, never the name.";
    const materialNone = this.doc.createElement("option");
    materialNone.value = MATERIAL_NONE_ID;
    materialNone.textContent = "None";
    material.appendChild(materialNone);
    for (const preset of MATERIAL_PRESETS) {
      const option = this.doc.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      material.appendChild(option);
    }
    const materialCustom = this.doc.createElement("option");
    materialCustom.value = MATERIAL_CUSTOM_ID;
    materialCustom.textContent = "Custom";
    materialCustom.disabled = true;
    material.appendChild(materialCustom);
    material.addEventListener("change", () =>
      this.onMaterialChange(material.value),
    );
    group.appendChild(material);

    // The bundle select acts like the Presets menu over these six rows: a
    // pick sets them all. Unlike the variation-add menu it does NOT snap
    // back to a placeholder — it REFLECTS the rows, reading "Custom"
    // (disabled, so it can be shown but never chosen) whenever the six
    // values are nobody's bundle.
    const bundle = this.doc.createElement("select");
    bundle.className = "finish-bundle";
    bundle.setAttribute("aria-label", "Finish bundle");
    bundle.title =
      "Named starting points for the six controls below — the scene stores the numbers, never the name.";
    for (const entry of FINISH_BUNDLES) {
      const option = this.doc.createElement("option");
      option.value = entry.id;
      option.textContent = entry.label;
      bundle.appendChild(option);
    }
    const custom = this.doc.createElement("option");
    custom.value = FINISH_CUSTOM_ID;
    custom.textContent = "Custom";
    custom.disabled = true;
    bundle.appendChild(custom);
    bundle.addEventListener("change", () =>
      this.onFinishBundleChange(bundle.value),
    );
    group.appendChild(bundle);

    const resolved = resolveSurfaceFinish(finish);
    const rows = {} as Record<FinishKey, AxisControl>;
    for (const key of FINISH_FIELDS) {
      const range = FINISH_RANGES[key];
      const row = this.doc.createElement("div");
      row.className = "editor-row finish-row";

      const name = this.doc.createElement("span");
      name.className = "axis";
      name.textContent = FINISH_LABELS[key];

      const slider = this.doc.createElement("input");
      slider.type = "range";
      slider.min = String(range.min);
      slider.max = String(range.max);
      slider.step = String(range.step);
      slider.value = String(resolved[key]);
      slider.setAttribute(
        "aria-label",
        `Finish ${FINISH_LABELS[key].toLowerCase()}`,
      );
      slider.title = FINISH_TITLES[key];

      const readout = this.doc.createElement("span");
      readout.className = "value";
      readout.textContent = formatFinishValue(key, resolved[key]);

      slider.addEventListener("input", () =>
        this.onFinishInput(key, Number(slider.value)),
      );

      row.append(name, slider, readout);
      group.appendChild(row);
      rows[key] = { slider, readout };
    }
    this.syncFinishBundleSelect(bundle, finish);
    material.value =
      materialPresetOf(finish, pattern)?.id ?? MATERIAL_CUSTOM_ID;

    this.transformEditor.appendChild(group);
    return { group, material, bundle, rows, note };
  }

  /** Point the bundle select at whichever bundle the working copy IS, or at
   * the disabled "Custom" entry when it is nobody's. */
  private syncFinishBundleSelect(
    bundle: HTMLSelectElement,
    finish: SurfaceFinish | undefined,
  ): void {
    bundle.value = finishBundleOf(finish)?.id ?? FINISH_CUSTOM_ID;
  }

  /** Point the material select at whichever starting point the current
   * finish+pattern working copies ARE — "None" for the all-clear state,
   * a preset's id, or the disabled "Custom" when the pair is nobody's. */
  private syncMaterialSelect(): void {
    const editor = this.editor;
    if (!editor || !editor.finishControls) return;
    editor.finishControls.material.value =
      materialPresetOf(editor.geometry.finish, editor.geometry.surfacePattern)
        ?.id ?? MATERIAL_CUSTOM_ID;
  }

  /** Re-sync the Finish group's rows and selects to the working copy — the
   * finish counterpart to the Color rows' re-sync in {@link syncEditor}. */
  private syncFinishControls(): void {
    const editor = this.editor;
    if (!editor || !editor.finishControls) return;
    const { rows, bundle } = editor.finishControls;
    const resolved = resolveSurfaceFinish(editor.geometry.finish);
    for (const key of FINISH_FIELDS) {
      rows[key].slider.value = String(resolved[key]);
      rows[key].readout.textContent = formatFinishValue(key, resolved[key]);
    }
    this.syncFinishBundleSelect(bundle, editor.geometry.finish);
    this.syncMaterialSelect();
    this.applyMaterialDisclosure();
  }

  /**
   * Disable the Finish and Pattern groups — and say why — on a transform
   * whose material the surface session this document would start could
   * never read: the forward-orbit routes (the escape-time chain in either
   * dimension, the Mandelbulb) shade AND pattern the WHOLE object with the
   * first active transform's and nobody else's. Disclosure rather than
   * pretence: an enabled slider that moved nothing would teach that the
   * feature is broken. The rows stay editable everywhere else, including on
   * the head transform of such a document, and the document keeps whatever
   * it carries — routing is a property of the system and a weight edit can
   * hand the head to another map, at which point its rows re-enable through
   * the same call. The pattern group's axis/scale/strength additionally
   * disable while the family is none (there is no pattern to orient or
   * scale yet) — the family select itself stays live, and the disclosure
   * dims the whole group as well.
   */
  private applyMaterialDisclosure(): void {
    const editor = this.editor;
    if (!editor) return;
    const headOnly =
      routeShadesHeadOnly(this.surfaceRouteKind) &&
      editor.target !== this.forwardHead;
    if (editor.finishControls) {
      const { group, material, bundle, rows, note } = editor.finishControls;
      material.disabled = headOnly;
      bundle.disabled = headOnly;
      for (const key of FINISH_FIELDS) rows[key].slider.disabled = headOnly;
      note.classList.toggle("hidden", !headOnly);
      group.classList.toggle("material-inert", headOnly);
    }
    if (editor.patternControls) {
      const { group, family, axis, scale, strength, note } =
        editor.patternControls;
      const hasFamily = family.value !== PATTERN_FAMILY_NONE;
      family.disabled = headOnly;
      axis.disabled = headOnly || !hasFamily;
      scale.slider.disabled = headOnly || !hasFamily;
      strength.slider.disabled = headOnly || !hasFamily;
      note.classList.toggle("hidden", !headOnly);
      group.classList.toggle("material-inert", headOnly);
    }
  }

  /**
   * The ONE write into the finish working copy — {@link appendFoldRadiusRows}'
   * `write` one level up: a value on the field's classic number (within half
   * a slider step, see {@link finishFieldIsClassic}) DELETES the field, and
   * deleting the last field drops the whole object, so a finish explored and
   * returned from leaves the transform exactly as it found it. Any other
   * value materializes the field (and the object, if this is its first).
   * Marks the group touched either way — see EditorState.finishTouched for
   * why a removal has to be emitted rather than merely omitted.
   */
  private writeFinishField(key: FinishKey, value: number): void {
    const editor = this.editor;
    if (!editor) return;
    editor.finishTouched = true;
    if (finishFieldIsClassic(key, value)) {
      const finish = editor.geometry.finish;
      if (!finish) return;
      delete finish[key];
      if (Object.keys(finish).length === 0) editor.geometry.finish = undefined;
    } else {
      (editor.geometry.finish ??= {})[key] = value;
    }
  }

  /** One finish slider moved: write exactly its field, refresh its readout
   * and the bundle and material selects (the six — and the pattern beside
   * them — may now be, or no longer be, a bundle or a starting point),
   * and emit. */
  private onFinishInput(key: FinishKey, value: number): void {
    const editor = this.editor;
    if (!editor || !editor.finishControls) return;
    this.writeFinishField(key, value);
    editor.finishControls.rows[key].readout.textContent = formatFinishValue(
      key,
      value,
    );
    this.syncFinishBundleSelect(
      editor.finishControls.bundle,
      editor.geometry.finish,
    );
    this.syncMaterialSelect();
    this.emitGeometry();
  }

  /** A bundle was picked: set all six sliders through the per-field write
   * rule (so Classic removes everything and no bundle stores a classic-valued
   * field), refresh the rows, and emit once. The disabled Custom option can
   * never arrive here; an unknown id is ignored rather than guessed at. */
  private onFinishBundleChange(id: string): void {
    const editor = this.editor;
    if (!editor || !editor.finishControls) return;
    const entry = FINISH_BUNDLES.find((bundle) => bundle.id === id);
    if (!entry) return;
    for (const key of FINISH_FIELDS) {
      this.writeFinishField(key, entry.finish[key]);
    }
    this.syncFinishControls();
    this.emitGeometry();
  }

  /** A material starting point was picked: set the finish fields and the
   * pattern through the SAME per-field/object write rules the sliders use
   * (so a wood starting point stores only `{kind: "wood", axis: "y"}`
   * plus the satin finish's non-classic fields — the family defaults and
   * the classic values stay ABSENT), refresh both groups, and emit once.
   * "None" clears both through the same rules (every finish field back at
   * classic removes the finish, the family back at none removes the
   * pattern). The disabled Custom option can never arrive here; an unknown
   * id is ignored rather than guessed at. */
  private onMaterialChange(id: string): void {
    const editor = this.editor;
    if (!editor || !editor.finishControls) return;
    if (id === MATERIAL_NONE_ID) {
      for (const key of FINISH_FIELDS) {
        this.writeFinishField(key, CLASSIC_SURFACE_FINISH[key]);
      }
      this.writePatternFamily(PATTERN_FAMILY_NONE);
    } else {
      const preset = MATERIAL_PRESETS.find((entry) => entry.id === id);
      if (!preset) return;
      for (const key of FINISH_FIELDS) {
        this.writeFinishField(key, preset.finish[key]);
      }
      this.writePatternFamily(preset.pattern.kind);
      this.writePatternAxis(preset.pattern.axis);
      this.writePatternScale(preset.pattern.scale);
      this.writePatternStrength(preset.pattern.strength);
    }
    this.syncFinishControls();
    this.syncPatternControls();
    this.emitGeometry();
  }

  /**
   * The ONE write into the pattern working copy's FAMILY — the finish's
   * {@link writeFinishField} one feature over, at the object level.
   * Picking a family materializes the object (the document model requires
   * `kind` and `axis` whenever `surfacePattern` exists, so a fresh pick
   * starts at the default axis with both numerics absent — their family
   * defaults resolve). Returning the family to NONE deletes the whole
   * object, so a pattern explored and returned from leaves the transform
   * exactly as it found it. Marks the group touched either way — see
   * EditorState.patternTouched for why a removal has to be emitted rather
   * than merely omitted.
   */
  private writePatternFamily(
    kind: SurfacePatternKind | typeof PATTERN_FAMILY_NONE,
  ): void {
    const editor = this.editor;
    if (!editor) return;
    editor.patternTouched = true;
    if (kind === PATTERN_FAMILY_NONE) {
      editor.geometry.surfacePattern = undefined;
      return;
    }
    const pattern =
      editor.geometry.surfacePattern ??
      (editor.geometry.surfacePattern = {
        kind,
        axis: SURFACE_PATTERN_DEFAULT_AXIS,
      });
    pattern.kind = kind;
  }

  /** Write the pattern's axis — a REQUIRED leaf of the document model, so
   * it is written whenever it changes (there is no "back to the default
   * removes it" for the object's spine; absence belongs to the whole
   * pattern). Only reachable while a family is active. */
  private writePatternAxis(axis: SurfacePatternAxis): void {
    const editor = this.editor;
    const pattern = editor?.geometry.surfacePattern;
    if (!pattern) return;
    editor.patternTouched = true;
    pattern.axis = axis;
  }

  /** Write the pattern's scale — the finish rule's per-field discipline:
   * a value on the CURRENT family's default scale (within half a slider
   * step) DELETES the field, so the slider rides the resolver's family
   * defaults exactly. Only reachable while a family is active. */
  private writePatternScale(scale: number): void {
    const editor = this.editor;
    const pattern = editor?.geometry.surfacePattern;
    if (!pattern) return;
    editor.patternTouched = true;
    if (patternScaleIsDefault(scale, pattern.kind)) {
      delete pattern.scale;
    } else {
      pattern.scale = scale;
    }
  }

  /** Write the pattern's strength — {@link writePatternScale}'s twin: a
   * value on the default strength 1 (within half a slider step) DELETES
   * the field. Only reachable while a family is active. */
  private writePatternStrength(strength: number): void {
    const editor = this.editor;
    const pattern = editor?.geometry.surfacePattern;
    if (!pattern) return;
    editor.patternTouched = true;
    if (
      Math.abs(strength - SURFACE_PATTERN_DEFAULT_STRENGTH) <=
      PATTERN_STRENGTH_TOLERANCE
    ) {
      delete pattern.strength;
    } else {
      pattern.strength = strength;
    }
  }

  /** The family select changed: write exactly the family (a pick
   * materializes `{kind, axis}`; none removes the whole pattern), refresh
   * the group and the material select (the pick may now be, or no longer
   * be, a starting point's pattern side), and emit. An unknown id is
   * ignored rather than guessed at. */
  private onPatternFamilyInput(value: string): void {
    const editor = this.editor;
    if (!editor || !editor.patternControls) return;
    if (value === PATTERN_FAMILY_NONE) {
      this.writePatternFamily(PATTERN_FAMILY_NONE);
    } else if (SURFACE_PATTERN_KINDS.includes(value as SurfacePatternKind)) {
      this.writePatternFamily(value as SurfacePatternKind);
    } else {
      return;
    }
    this.syncPatternControls();
    this.syncMaterialSelect();
    this.emitGeometry();
  }

  /** The axis select changed: write exactly the axis, refresh the material
   * select, and emit. */
  private onPatternAxisInput(value: string): void {
    const editor = this.editor;
    if (!editor || !editor.patternControls) return;
    if (!SURFACE_PATTERN_AXES.includes(value as SurfacePatternAxis)) return;
    this.writePatternAxis(value as SurfacePatternAxis);
    this.syncMaterialSelect();
    this.emitGeometry();
  }

  /** The scale slider moved (already mapped through the grid): write
   * exactly the scale — removing it when it lands back on the family
   * default — refresh the readout and the material select, and emit. */
  private onPatternScaleInput(scale: number): void {
    const editor = this.editor;
    if (!editor || !editor.patternControls) return;
    this.writePatternScale(scale);
    editor.patternControls.scale.readout.textContent = scale.toFixed(2);
    this.syncMaterialSelect();
    this.emitGeometry();
  }

  /** The strength slider moved — {@link onPatternScaleInput}'s twin. */
  private onPatternStrengthInput(strength: number): void {
    const editor = this.editor;
    if (!editor || !editor.patternControls) return;
    this.writePatternStrength(strength);
    editor.patternControls.strength.readout.textContent = strength.toFixed(2);
    this.syncMaterialSelect();
    this.emitGeometry();
  }

  /**
   * Build the "Pattern" group: a scope hint, the family and axis selects,
   * and the scale/strength rows — the Finish group's structure one feature
   * over (the sibling `surfacePattern` block of `types.ts`'s
   * `SurfaceFinish`, see surface-pattern.ts). The family select is the
   * block's spine: picking one materializes the pattern object, and
   * returning it to none removes the pattern outright (see
   * {@link writePatternFamily}); the axis select and both sliders disable
   * until a family is active (there is no pattern to orient or scale yet),
   * and the scale slider is the LOGARITHMIC one the resolver's domain
   * needs — its position grid (see {@link PATTERN_SCALE_GRID}) is exactly
   * representable for every family default.
   *
   * The rows display the RESOLVED value while a leaf is absent (the family
   * default `surface-pattern.ts`'s resolver would use) — the Finish rows'
   * classic-number idiom — and the family/axis selects display the
   * resolved kind/axis the same way; only the working copy is empty.
   */
  private buildPatternControls(
    pattern: SurfacePattern | undefined,
    openGroup: string,
  ): PatternControls {
    const group = this.createEditorGroup("Pattern", openGroup);

    // The scope note, in the Finish hint's idiom: every other render mode
    // ignores a pattern, and a control that moves nothing on screen would
    // otherwise teach that the group is broken.
    const hint = this.doc.createElement("p");
    hint.className = "flame-hint";
    hint.textContent =
      "Surface renders only: how this map's part of the surface is patterned — its albedo texture, under the lighting. A family picks the pattern; None clears it. The Finish group's Material menu sets a family and a finish together.";
    group.appendChild(hint);

    // The forward-orbit disclosure — hidden until applyMaterialDisclosure
    // finds the document routing to an escape-time chain or a Mandelbulb
    // with this transform not at its head.
    const note = this.doc.createElement("p");
    note.className = "flame-hint pattern-note hidden";
    note.textContent =
      "Escape-time and Mandelbulb surfaces pattern the whole object with the FIRST active transform's, so this one is not read there. It still applies to an IFS surface.";
    group.appendChild(note);

    // The family select is the block's spine: it reflects the resolved
    // kind, and picking one is what materializes the pattern (see
    // writePatternFamily). Unlike the Finish group's selects it has a
    // pickable "None" — the family's absent state, the exact analogue of
    // the bundle select's "Classic".
    const family = this.doc.createElement("select");
    family.className = "pattern-family";
    family.setAttribute("aria-label", "Pattern family");
    family.title =
      "Which pattern covers this map's part of the surface: wood, marble or strata. None removes the pattern.";
    const familyNone = this.doc.createElement("option");
    familyNone.value = PATTERN_FAMILY_NONE;
    familyNone.textContent = "None";
    family.appendChild(familyNone);
    for (const kind of SURFACE_PATTERN_KINDS) {
      const option = this.doc.createElement("option");
      option.value = kind;
      option.textContent = PATTERN_KIND_LABELS[kind];
      family.appendChild(option);
    }
    family.addEventListener("change", () =>
      this.onPatternFamilyInput(family.value),
    );
    group.appendChild(family);

    // The axis select — a required leaf of the document model (see
    // writePatternAxis), disabled until a family is active.
    const axis = this.doc.createElement("select");
    axis.className = "pattern-axis";
    axis.setAttribute("aria-label", "Pattern axis");
    axis.title =
      "Which object-space axis the pattern's structure runs along. Y is the default.";
    for (const value of SURFACE_PATTERN_AXES) {
      const option = this.doc.createElement("option");
      option.value = value;
      option.textContent = PATTERN_AXIS_LABELS[value];
      axis.appendChild(option);
    }
    axis.addEventListener("change", () => this.onPatternAxisInput(axis.value));
    group.appendChild(axis);

    const resolved = resolveSurfacePattern(pattern);
    // Seed the two selects from the resolved document (the sliders below
    // are already seeded from the same `resolved`) — the Finish group's
    // syncFinishBundleSelect at build, so the family-none enablement and
    // the disclosure read the right state before the first sync.
    family.value = resolved.kind;
    axis.value = resolved.axis;

    // The scale row: periods across one normalized object-space unit, on
    // the logarithmic position grid (see PATTERN_SCALE_GRID). The slider
    // carries a POSITION while the readout carries the MODEL value, the
    // 4D rows' toSlider/fromSlider shape — so an authored value that is
    // not a grid point (a morph's, say) still reads honestly, and snaps
    // to the grid the moment the user drags.
    const scaleRow = this.doc.createElement("div");
    scaleRow.className = "editor-row pattern-row";
    const scaleName = this.doc.createElement("span");
    scaleName.className = "axis";
    scaleName.textContent = "Scale";
    const scaleSlider = this.doc.createElement("input");
    scaleSlider.type = "range";
    scaleSlider.min = "0";
    scaleSlider.max = String(PATTERN_SCALE_GRID.length - 1);
    scaleSlider.step = "1";
    scaleSlider.value = String(patternScaleToSlider(resolved.scale));
    scaleSlider.setAttribute("aria-label", "Pattern scale");
    scaleSlider.title =
      "Periods across one normalized object-space unit, on a logarithmic slider. Wood 3, Marble 1.35, Strata 2.6 by default.";
    const scaleReadout = this.doc.createElement("span");
    scaleReadout.className = "value";
    scaleReadout.textContent = resolved.scale.toFixed(2);
    scaleSlider.addEventListener("input", () =>
      this.onPatternScaleInput(
        patternScaleFromSlider(Number(scaleSlider.value)),
      ),
    );
    scaleRow.append(scaleName, scaleSlider, scaleReadout);
    group.appendChild(scaleRow);
    const scale: AxisControl = { slider: scaleSlider, readout: scaleReadout };

    // The strength row: the patterned-albedo blend, `0..1` at the wire's
    // own 0.01 UI step (see PATTERN_STRENGTH_STEP), default 1.
    const strengthRow = this.doc.createElement("div");
    strengthRow.className = "editor-row pattern-row";
    const strengthName = this.doc.createElement("span");
    strengthName.className = "axis";
    strengthName.textContent = "Strength";
    const strengthSlider = this.doc.createElement("input");
    strengthSlider.type = "range";
    strengthSlider.min = String(PATTERN_STRENGTH_MIN);
    strengthSlider.max = String(PATTERN_STRENGTH_MAX);
    strengthSlider.step = String(PATTERN_STRENGTH_STEP);
    strengthSlider.value = String(resolved.strength);
    strengthSlider.setAttribute("aria-label", "Pattern strength");
    strengthSlider.title =
      "How much the pattern replaces the surface's own albedo: 0 leaves it unchanged, 1 is the full pattern. Default 1.";
    const strengthReadout = this.doc.createElement("span");
    strengthReadout.className = "value";
    strengthReadout.textContent = resolved.strength.toFixed(2);
    strengthSlider.addEventListener("input", () =>
      this.onPatternStrengthInput(Number(strengthSlider.value)),
    );
    strengthRow.append(strengthName, strengthSlider, strengthReadout);
    group.appendChild(strengthRow);
    const strength: AxisControl = {
      slider: strengthSlider,
      readout: strengthReadout,
    };

    this.transformEditor.appendChild(group);
    return { group, family, axis, scale, strength, note };
  }

  /** Re-sync the Pattern group's selects and rows to the working copy —
   * the Finish group's {@link syncFinishControls} one feature over, and
   * the row-refresh half of {@link applyMaterialDisclosure}'s enablement
   * (which this calls). */
  private syncPatternControls(): void {
    const editor = this.editor;
    if (!editor || !editor.patternControls) return;
    const { family, axis, scale, strength } = editor.patternControls;
    const resolved = resolveSurfacePattern(editor.geometry.surfacePattern);
    family.value = resolved.kind;
    axis.value = resolved.axis;
    scale.slider.value = String(patternScaleToSlider(resolved.scale));
    scale.readout.textContent = resolved.scale.toFixed(2);
    strength.slider.value = String(resolved.strength);
    strength.readout.textContent = resolved.strength.toFixed(2);
    this.applyMaterialDisclosure();
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
   * The fold's three authored lengths, as rows nested under their
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
   * Build the collapsed "4D" group: the only UI that can create or
   * edit a transform's optional `w` extension (see `types.ts`'s
   * `WExtension`). Always built — never conditionally omitted — so every
   * other editor interaction keeps working uniformly whether or not this
   * particular transform is currently non-flat.
   *
   * This was the editor's only collapsible group until all eight became
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
      // Magnitude-only slider (the Scale group's own channel treatment one
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

    // The Scale W slider above is magnitude-only, so this single toggle is
    // the editor's only way to create or clear a 4D reflection — the exact
    // counterpart of the 3D Scale group's Mirror row.
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
   * one field the fired slider owns — the sparse-write contract: untouched
   * fields must never be materialized, since their absence is what keeps an
   * unrelated edit from dragging a flat transform's `w` into existence, and
   * what lets `w.scale` keep meaning "derived" until the user actually sets
   * it (see `WExtension.scale`'s doc).
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
   * — the 4D counterpart to the Position/Rotation/Scale/Shear loop and the
   * weight control's own re-sync in {@link syncEditor}. Never touches the
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
      finish: cloneFinish(transform.finish),
      surfacePattern: cloneSurfacePattern(transform.surfacePattern),
    };
    // The working copy IS the document again, so the finish and pattern
    // keys go back to riding only on presence (see EditorState.finishTouched
    // / patternTouched).
    editor.finishTouched = false;
    editor.patternTouched = false;
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
    if (editor.emitterSelect) {
      editor.emitterSelect.value = emitterSelectValue(transform.emitter);
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
    this.syncFinishControls();
    this.syncPatternControls();
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

  /** Flip one axis's scale sign. No refreshScaleWIfAuto here: the
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

  /** Flip Scale W's sign — the 4D group's counterpart to
   * {@link onMirrorToggle}. While `w.scale` is unset (auto), this negates
   * the DERIVED mean and materializes it as the explicit value, exactly
   * like a slider nudge would: "derived but mirrored" isn't representable
   * in the sparse model, whose absent-scale state always means the
   * positive mean (see `WExtension.scale`). */
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
   * Author this map's palette slot. Writing the working copy is exactly what
   * MATERIALIZES the optional field: until a slider fires this, the row has
   * only been displaying `chaos-game.ts`'s derived slot and the transform
   * carries no `colorIndex` key at all (see {@link buildColorControls} and
   * {@link emitGeometry}).
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
      // Sparse by construction: only include `w` when the working copy
      // actually has one, so a transform the user never touched the 4D group
      // on emits geometry with NO `w` key at all — not `undefined`, not `{}`
      // — keeping it byte-identical through an unrelated edit (see
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
        // Sparse exactly like `w` above, and load-bearing for the same
        // reason: these keys are emitted ONLY once the user has moved their
        // slider. Selecting a map, dragging its guide box, or editing any
        // other row leaves an unauthored map with NO colorIndex / colorSpeed
        // key — `state.ts`'s updateTransform merges, so an absent key
        // preserves absence, and absence is what keeps the derived slot (and
        // every scene saved before this field existed) byte-identical
        // through the round trip. See `types.ts`'s field docs.
        ...(editor.geometry.colorIndex !== undefined
          ? { colorIndex: editor.geometry.colorIndex }
          : {}),
        ...(editor.geometry.colorSpeed !== undefined
          ? { colorSpeed: editor.geometry.colorSpeed }
          : {}),
        // Sparse like the pair above while the group is untouched. Once a
        // finish slider or the bundle select has fired, the working copy is
        // the truth — and an EMPTY one is emitted as an explicit
        // `finish: undefined` rather than omitted, because omission would
        // leave the document's old finish in place under updateTransform's
        // merge, and dragging the last field back to classic has to REMOVE
        // the key (persist writes nothing for an undefined finish, so the
        // saved scene is byte-identical to one that never authored it).
        // See EditorState.finishTouched.
        ...(editor.geometry.finish !== undefined
          ? { finish: cloneFinish(editor.geometry.finish) }
          : editor.finishTouched
            ? { finish: undefined }
            : {}),
        // The pattern's twin: the object materializes only once a family
        // (or a material starting point) is picked, and once touched an
        // EMPTY working copy is emitted as an explicit
        // `surfacePattern: undefined` so returning the family to none
        // REMOVES the document's own key through the same merge. See
        // EditorState.patternTouched.
        ...(editor.geometry.surfacePattern !== undefined
          ? {
              surfacePattern: cloneSurfacePattern(
                editor.geometry.surfacePattern,
              ),
            }
          : editor.patternTouched
            ? { surfacePattern: undefined }
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
