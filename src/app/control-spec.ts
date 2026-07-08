import type { ColorMode, FourDColorMode, SymmetryAxis } from "../fractal/types";
import type { FlamePaletteId } from "../fractal/palette";
import type { FlameWorkerCommand } from "./flame-worker-core";
import type { VoxelWorkerCommand } from "./voxel-worker-core";
import {
  FLAME_ITERATION_DETENTS,
  MAX_COLOR_GAMMA,
  MAX_NUM_POINTS,
  MIN_NUM_POINTS,
  nearestFlameIterationDetentIndex,
  setAutoUpdate,
  setColorGamma,
  setColorMode,
  setFlameEstimatorCurve,
  setFlameEstimatorMinimumRadius,
  setFlameEstimatorRadius,
  setFlameExposure,
  setFlameGamma,
  setFlameIterations,
  setFlamePaletteId,
  setFlameSupersample,
  setFlameVibrancy,
  setFourDColor,
  setFourDDepthFade,
  setGlowBrightness,
  setNumPoints,
  setPointSize,
  setRenderStyle,
  setShowGuides,
  setSolidAmbient,
  setSolidIterations,
  setSolidLightAzimuth,
  setSolidLightElevation,
  setSolidPaletteId,
  setSolidResolution,
  setSolidThreshold,
  setSymmetryAxis,
  setSymmetryOrder,
} from "./state";
import type { AppState, RenderStyle, SolidParams } from "./state";

/**
 * Declarative specs for the panel's SIMPLE SCALAR controls (fr-dig): every
 * static slider/select/checkbox that binds one `index.html` input to one
 * `AppState` field, with an optional readout label, an optional view guard,
 * and optional post-apply side effects (scene pushes, render-worker
 * forwards). From this one table:
 *
 * - `Ui` derives its element lookups (the constructor still throws on a
 *   missing element, so ui.test.ts's index.html coverage test keeps its
 *   teeth), its listener registrations, and its `updateLabels` sync.
 * - `main.ts` derives the single generic handler: view guard →
 *   `beginSceneEdit` for document edits → {@link applyScalarControl} →
 *   label sync → the spec's {@link ControlEffect}.
 *
 * Adding a new scalar setting is one entry here plus one `index.html` row.
 * The bespoke dynamic widgets — the transform list/editor, variation rows,
 * the 4D editor group, the legend, and the session-only orbit/tumble/slice
 * view controls (which bind to main.ts closure state, not AppState) — stay
 * hand-built in ui.ts. Slider min/max/step still live on each `index.html`
 * row, but their ranges are now single-sourced by state.ts's `PARAM` table
 * (fr-2v7) and pinned against it by a ui.test.ts test — the log-scaled point
 * count / color-contrast sliders and the detent-indexed flame quality slider
 * map their own domains onto those ranges via the helpers below.
 */

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
 * Format an iteration count for display (fr-79p): millions with one decimal
 * below 1e9 — the flame progress line's long-standing look, e.g. "20.0M" —
 * and billions with up to two decimals at 1e9 and above, trailing zeros (and
 * a bare trailing dot) trimmed, e.g. "1.5B", "2B". Without the billions branch
 * a GPU-scale budget would print as an unreadable "2000.0M"; a display
 * concern, not app state, so it lives here rather than state.ts. Shared by
 * the flame Quality label below and ui.ts's `setFlameProgress` — the solid
 * render is CPU-only and out of scope (fr-79p), so `setSolidProgress` keeps
 * its own plain-millions format.
 */
export function formatIterationCount(n: number): string {
  if (n >= 1_000_000_000) {
    const billions = (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "");
    return `${billions}B`;
  }
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * The scene methods scalar-control effects may touch — a narrow structural
 * subset of `FractalScene` (scene.ts implements it by shape) so this module
 * never imports Three.js and stays unit-testable with a plain mock.
 */
export interface ControlSceneEffects {
  setPointSize(multiplier: number): void;
  setRenderStyle(style: RenderStyle): void;
  setGlowExposure(factor: number): void;
  setGuidesVisible(showGuides: boolean): void;
  setFourDDepthFade(on: boolean): void;
  setSolidParams(params: SolidParams): void;
}

/**
 * The app capabilities a control's post-apply effect may invoke — implemented
 * exactly once in main.ts by closures over the scene, the two render workers,
 * and the regenerate/recolor refreshers. Keeping effects as data here (rather
 * than per-control handler bodies in main.ts) is the point of the table: the
 * per-control worker semantics live next to the control they belong to.
 */
export interface ControlEffects {
  scene: ControlSceneEffects;
  /** Forward a command to the flame render worker (no-op while inactive). */
  postFlame(command: FlameWorkerCommand): void;
  /** Forward a command to the solid render worker (no-op while inactive). */
  postVoxel(command: VoxelWorkerCommand): void;
  /**
   * Re-run the tone-map on the main thread over the live shared flame
   * buckets, when the session is shared-memory — the change lands instantly,
   * even mid-chunk, when the worker couldn't service a command anyway.
   * Returns false when the session isn't shared, so the caller falls back to
   * forwarding a worker command instead (the worker owns the tone-map there).
   */
  presentSharedFlameFrame(): boolean;
  /** `regenerate()` gated on `state.autoUpdate` — for controls that reshape
   * the live point cloud, not just a render-only setting. */
  regenerateIfAutoUpdate(): void;
  /** Rebuild the 3D cloud's color buffer over the cached chaos-game run
   * (never re-runs the game). */
  recolor(): void;
  /** Re-point the 4D shader's color source (fr-d47), re-baking the per-point
   * attribute for the baked modes — the 4D sibling of `recolor`. */
  applyFourDColor(): void;
  /** Restart the whole solid render session (a fresh worker, exactly like a
   * Render click) — the resolution slider's only path to a new grid while
   * active, since a grid's dimensions are fixed at allocation. */
  restartSolidRender(): void;
}

/**
 * A control's post-apply side effects. Runs after the reducer and the label
 * sync, reading the SETTLED state (so a clamping/rounding reducer's value is
 * what gets forwarded, exactly as the hand-written handlers did). `previous`
 * is the pre-edit state, for effects that must fire only on a real change.
 */
export type ControlEffect = (
  state: AppState,
  fx: ControlEffects,
  previous: AppState,
) => void;

interface ScalarControlBase {
  /** id of the control's static input/select element in index.html. */
  id: string;
  /** Optional readout: element id + its text derived from state. */
  label?: { id: string; text(state: AppState): string };
  /**
   * The view whose panel shows this control: its handler no-ops in the other
   * view, belt-and-braces mirroring of the hidden row (see ui.ts's
   * updateLabels gating), so a stray event can't mutate a concern that isn't
   * even on screen. Omitted = live in both views.
   */
  view?: "flat" | "nonFlat";
  /**
   * `false` for AppState fields that never enter the encoded scene document
   * (see persist.ts's SceneSnapshot): no undo checkpoint, no debounced save.
   * Omitted = the edit routes through main.ts's beginSceneEdit.
   */
  persisted?: false;
  /** Post-apply side effects; see {@link ControlEffect}. */
  effect?: ControlEffect;
}

/** A slider or select: the element's string `value` carries the edit. */
export interface ValueControlSpec extends ScalarControlBase {
  kind: "range" | "select";
  /** The element's `value` derived from state (slider mappings included) —
   * the updateLabels sync direction. */
  read(state: AppState): string;
  /** Parse the element's raw `value` and apply the edit through a reducer. */
  apply(state: AppState, raw: string): AppState;
}

/** A checkbox: the element's `checked` flag carries the edit. */
export interface ToggleControlSpec extends ScalarControlBase {
  kind: "checkbox";
  read(state: AppState): boolean;
  apply(state: AppState, checked: boolean): AppState;
}

export type ScalarControlSpec = ValueControlSpec | ToggleControlSpec;

/**
 * Apply a control's raw DOM input (`value` string for range/select, `checked`
 * boolean for checkbox) to state through the spec's own parse + reducer. The
 * kind switch is what lets one `UiHandlers.onScalarControl` callback carry
 * both raw shapes without casts: each branch coerces to the shape its `apply`
 * declares (a no-op for the type the Ui actually sends).
 */
export function applyScalarControl(
  state: AppState,
  spec: ScalarControlSpec,
  raw: string | boolean,
): AppState {
  return spec.kind === "checkbox"
    ? spec.apply(state, raw === true)
    : spec.apply(state, String(raw));
}

/** The symmetry controls reshape the live point cloud (and any active
 * flame/solid render), not just a render-only setting — shared by the order
 * slider and the axis select, whose handlers were identical twins before the
 * table (fr-dig). */
const symmetryEffect: ControlEffect = (state, fx) => {
  fx.regenerateIfAutoUpdate();
  const command = {
    type: "setSymmetry",
    order: state.symmetry.order,
    axis: state.symmetry.axis,
  } as const;
  fx.postFlame(command);
  fx.postVoxel(command);
};

/** Live-reactive flame tone-map params (exposure/gamma/vibrancy): tone-map
 * locally over the shared buckets when the session is shared-memory,
 * otherwise forward the command so the worker re-tone-maps. */
function liveTonemapEffect(
  command: (state: AppState) => FlameWorkerCommand,
): ControlEffect {
  return (state, fx) => {
    if (!fx.presentSharedFlameFrame()) fx.postFlame(command(state));
  };
}

/** Surface/lighting sliders — pure GPU uniforms, live at full frame rate. */
const solidParamsEffect: ControlEffect = (state, fx) => {
  fx.scene.setSolidParams(state.solid);
};

export const SCALAR_CONTROLS: readonly ScalarControlSpec[] = [
  // ——— Explorer: appearance ———
  {
    kind: "range",
    id: "numPointsSlider",
    label: { id: "numPointsLabel", text: (s) => s.numPoints.toLocaleString() },
    read: (s) => String(numPointsToSlider(s.numPoints)),
    apply: (s, raw) => setNumPoints(s, sliderToNumPoints(Number(raw))),
    // No effect: the new count only lands on the next regenerate (the
    // Regenerate button or any geometry edit under auto-update).
  },
  {
    kind: "range",
    id: "pointSizeSlider",
    label: { id: "pointSizeLabel", text: (s) => `${s.pointSize.toFixed(2)}×` },
    read: (s) => String(s.pointSize),
    apply: (s, raw) => setPointSize(s, Number(raw)),
    effect: (s, fx) => fx.scene.setPointSize(s.pointSize),
  },
  {
    // The glow-brightness slider (fr-8b1) — a manual multiplier on top of the
    // glow render's per-frame auto-exposure. Only shown while
    // `renderStyle === "glow"` (see ui.ts's glowBrightnessRow gating). No
    // effect needed: main.ts's animate() reads state.glowBrightness as a
    // multiplier every frame.
    kind: "range",
    id: "glowBrightnessSlider",
    label: {
      id: "glowBrightnessLabel",
      text: (s) => `${s.glowBrightness.toFixed(2)}×`,
    },
    read: (s) => String(s.glowBrightness),
    apply: (s, raw) => setGlowBrightness(s, Number(raw)),
  },
  {
    kind: "select",
    id: "colorMode",
    // colorModeRow hides while non-flat (the shader colors from the rotated
    // w instead) — belt-and-braces.
    view: "flat",
    read: (s) => s.colorMode,
    apply: (s, raw) => setColorMode(s, raw as ColorMode),
    effect: (s, fx) => fx.recolor(),
  },
  {
    // The color-contrast slider (fr-8sk) — `apply` converts the slider's
    // log-scale position to the actual gamma. Only shown while the active
    // color mode is height/radius/position (see ui.ts's colorGammaRow).
    kind: "range",
    id: "colorGammaSlider",
    view: "flat",
    label: { id: "colorGammaLabel", text: (s) => s.colorGamma.toFixed(2) },
    read: (s) => String(colorGammaToSlider(s.colorGamma)),
    apply: (s, raw) => setColorGamma(s, sliderToColorGamma(Number(raw))),
    effect: (s, fx) => fx.recolor(),
  },
  {
    kind: "select",
    id: "renderStyle",
    // renderStyleRow hides while non-flat (the 4D material/render path
    // ignores renderStyle entirely) — belt-and-braces.
    view: "flat",
    read: (s) => s.renderStyle,
    apply: (s, raw) => setRenderStyle(s, raw as RenderStyle),
    effect: (s, fx) => {
      fx.scene.setRenderStyle(s.renderStyle);
      // Reset glow exposure so no stale factor sticks when switching away.
      if (s.renderStyle !== "glow") fx.scene.setGlowExposure(1);
    },
  },
  {
    kind: "checkbox",
    id: "showGuides",
    read: (s) => s.showGuides,
    apply: (s, checked) => setShowGuides(s, checked),
    effect: (s, fx) => fx.scene.setGuidesVisible(s.showGuides),
  },
  {
    // Session preference: autoUpdate never enters the encoded scene document
    // (persist.ts keeps it from `base` on restore), so flipping it is not an
    // undoable/saved edit.
    kind: "checkbox",
    id: "autoUpdate",
    persisted: false,
    read: (s) => s.autoUpdate,
    apply: (s, checked) => setAutoUpdate(s, checked),
  },
  // ——— Symmetry (flat systems only: the 4D chaos game has no symmetry
  // parameter at all, and the section hides while non-flat) ———
  {
    kind: "range",
    id: "symmetryOrderSlider",
    view: "flat",
    label: {
      id: "symmetryOrderLabel",
      text: (s) => `${s.symmetry.order}-fold`,
    },
    read: (s) => String(s.symmetry.order),
    apply: (s, raw) => setSymmetryOrder(s, Number(raw)),
    effect: symmetryEffect,
  },
  {
    kind: "select",
    id: "symmetryAxis",
    view: "flat",
    read: (s) => s.symmetry.axis,
    apply: (s, raw) => setSymmetryAxis(s, raw as SymmetryAxis),
    effect: symmetryEffect,
  },
  // ——— 4D view (non-flat systems only) ———
  {
    // The 4D color select (fr-d47) — re-points the 4D shader's color source
    // (and re-bakes the attribute for the baked modes) without re-running
    // the chaos game.
    kind: "select",
    id: "fourDColor",
    view: "nonFlat",
    read: (s) => s.fourDColor,
    apply: (s, raw) => setFourDColor(s, raw as FourDColorMode),
    effect: (s, fx) => fx.applyFourDColor(),
  },
  {
    // The 4D camera-depth fade (fr-3e0). Unlike the session-only slice/tumble
    // toggles (which stay hand-built in ui.ts), this edits the persisted
    // scene document — it's a look preference like fourDColor's.
    kind: "checkbox",
    id: "fourDDepthFadeToggle",
    view: "nonFlat",
    read: (s) => s.fourDDepthFade,
    apply: (s, checked) => setFourDDepthFade(s, checked),
    effect: (s, fx) => fx.scene.setFourDDepthFade(s.fourDDepthFade),
  },
  // ——— Flame render ———
  {
    kind: "range",
    id: "flameExposureSlider",
    label: {
      id: "flameExposureLabel",
      text: (s) => `${s.flame.exposure.toFixed(2)}×`,
    },
    read: (s) => String(s.flame.exposure),
    apply: (s, raw) => setFlameExposure(s, Number(raw)),
    effect: liveTonemapEffect((s) => ({
      type: "setExposure",
      exposure: s.flame.exposure,
    })),
  },
  {
    // The Quality slider carries a detent INDEX (fr-79p), not the raw count:
    // a persisted/shared scene can hold a non-detent value (e.g. an old
    // scene's 37M), so `read` snaps the thumb to the nearest detent for
    // display while state keeps the exact value until the user actually
    // moves the slider.
    kind: "range",
    id: "flameIterationsSlider",
    label: {
      id: "flameIterationsLabel",
      text: (s) => `${formatIterationCount(s.flame.iterations)} iterations`,
    },
    read: (s) => String(nearestFlameIterationDetentIndex(s.flame.iterations)),
    apply: (s, raw) =>
      setFlameIterations(s, FLAME_ITERATION_DETENTS[Number(raw)]),
    effect: (s, fx) =>
      fx.postFlame({
        type: "setIterationsBudget",
        iterations: s.flame.iterations,
      }),
  },
  {
    kind: "range",
    id: "flameGammaSlider",
    label: { id: "flameGammaLabel", text: (s) => s.flame.gamma.toFixed(2) },
    read: (s) => String(s.flame.gamma),
    apply: (s, raw) => setFlameGamma(s, Number(raw)),
    effect: liveTonemapEffect((s) => ({
      type: "setGamma",
      gamma: s.flame.gamma,
    })),
  },
  {
    kind: "range",
    id: "flameVibrancySlider",
    label: {
      id: "flameVibrancyLabel",
      text: (s) => `${Math.round(s.flame.vibrancy * 100)}%`,
    },
    read: (s) => String(s.flame.vibrancy),
    apply: (s, raw) => setFlameVibrancy(s, Number(raw)),
    effect: liveTonemapEffect((s) => ({
      type: "setVibrancy",
      vibrancy: s.flame.vibrancy,
    })),
  },
  {
    // The supersample slider restarts accumulation: the reducer clamps/
    // rounds, and the worker compares the settled value against its own
    // effective supersample and restarts for us if it actually changed — no
    // need to restart here directly (and regenerate would be premature: the
    // display size hasn't changed, only the accumulator's).
    kind: "range",
    id: "flameSupersampleSlider",
    label: {
      id: "flameSupersampleLabel",
      text: (s) => `${s.flame.supersample}×`,
    },
    read: (s) => String(s.flame.supersample),
    apply: (s, raw) => setFlameSupersample(s, Number(raw)),
    effect: (s, fx) =>
      fx.postFlame({
        type: "setSupersample",
        supersample: s.flame.supersample,
      }),
  },
  {
    // The palette restarts accumulation in the worker (the accumulated color
    // sums bake in the palette); the worker owns that restart, so this just
    // forwards the new palette.
    kind: "select",
    id: "flamePalette",
    read: (s) => s.flame.paletteId,
    apply: (s, raw) => setFlamePaletteId(s, raw as FlamePaletteId),
    effect: (s, fx) =>
      fx.postFlame({ type: "setPalette", paletteId: s.flame.paletteId }),
  },
  // Adaptive density-estimation blur (fr-17t) sliders — live-reactive like
  // gamma/vibrancy: the worker re-runs just the finished-frame adaptive
  // pass, never a re-accumulate.
  {
    kind: "range",
    id: "flameEstimatorRadiusSlider",
    label: {
      id: "flameEstimatorRadiusLabel",
      text: (s) => `${s.flame.estimatorRadius.toFixed(1)}px`,
    },
    read: (s) => String(s.flame.estimatorRadius),
    apply: (s, raw) => setFlameEstimatorRadius(s, Number(raw)),
    effect: (s, fx) =>
      fx.postFlame({
        type: "setEstimatorRadius",
        estimatorRadius: s.flame.estimatorRadius,
      }),
  },
  {
    kind: "range",
    id: "flameEstimatorMinimumRadiusSlider",
    label: {
      id: "flameEstimatorMinimumRadiusLabel",
      text: (s) => `${s.flame.estimatorMinimumRadius.toFixed(1)}px`,
    },
    read: (s) => String(s.flame.estimatorMinimumRadius),
    apply: (s, raw) => setFlameEstimatorMinimumRadius(s, Number(raw)),
    effect: (s, fx) =>
      fx.postFlame({
        type: "setEstimatorMinimumRadius",
        estimatorMinimumRadius: s.flame.estimatorMinimumRadius,
      }),
  },
  {
    kind: "range",
    id: "flameEstimatorCurveSlider",
    label: {
      id: "flameEstimatorCurveLabel",
      text: (s) => s.flame.estimatorCurve.toFixed(2),
    },
    read: (s) => String(s.flame.estimatorCurve),
    apply: (s, raw) => setFlameEstimatorCurve(s, Number(raw)),
    effect: (s, fx) =>
      fx.postFlame({
        type: "setEstimatorCurve",
        estimatorCurve: s.flame.estimatorCurve,
      }),
  },
  // ——— Solid render ———
  {
    kind: "range",
    id: "solidThresholdSlider",
    label: {
      id: "solidThresholdLabel",
      text: (s) => s.solid.threshold.toFixed(2),
    },
    read: (s) => String(s.solid.threshold),
    apply: (s, raw) => setSolidThreshold(s, Number(raw)),
    effect: solidParamsEffect,
  },
  {
    kind: "range",
    id: "solidLightAzimuthSlider",
    label: {
      id: "solidLightAzimuthLabel",
      text: (s) => `${Math.round(s.solid.lightAzimuth)}°`,
    },
    read: (s) => String(s.solid.lightAzimuth),
    apply: (s, raw) => setSolidLightAzimuth(s, Number(raw)),
    effect: solidParamsEffect,
  },
  {
    kind: "range",
    id: "solidLightElevationSlider",
    label: {
      id: "solidLightElevationLabel",
      text: (s) => `${Math.round(s.solid.lightElevation)}°`,
    },
    read: (s) => String(s.solid.lightElevation),
    apply: (s, raw) => setSolidLightElevation(s, Number(raw)),
    effect: solidParamsEffect,
  },
  {
    kind: "range",
    id: "solidAmbientSlider",
    label: {
      id: "solidAmbientLabel",
      text: (s) => `${Math.round(s.solid.ambient * 100)}%`,
    },
    read: (s) => String(s.solid.ambient),
    apply: (s, raw) => setSolidAmbient(s, Number(raw)),
    effect: solidParamsEffect,
  },
  {
    // Like the flame palette: restarts accumulation in the worker (the
    // colors bake into avgRGB); the worker owns that restart.
    kind: "select",
    id: "solidPalette",
    read: (s) => s.solid.paletteId,
    apply: (s, raw) => setSolidPaletteId(s, raw as FlamePaletteId),
    effect: (s, fx) =>
      fx.postVoxel({ type: "setPalette", paletteId: s.solid.paletteId }),
  },
  {
    kind: "range",
    id: "solidIterationsSlider",
    label: {
      id: "solidIterationsLabel",
      text: (s) => `${(s.solid.iterations / 1_000_000).toFixed(0)}M iterations`,
    },
    read: (s) => String(s.solid.iterations),
    apply: (s, raw) => setSolidIterations(s, Number(raw)),
    effect: (s, fx) =>
      fx.postVoxel({
        type: "setIterationsBudget",
        iterations: s.solid.iterations,
      }),
  },
  {
    // The reducer clamps/snaps to the voxel step; unlike the flame's
    // supersample the worker has no live "change resolution" command (a
    // grid's dimensions are fixed at allocation), so a genuine change while
    // active restarts the whole session — hence the previous-state compare.
    kind: "range",
    id: "solidResolutionSlider",
    label: {
      id: "solidResolutionLabel",
      text: (s) => `${s.solid.resolution}³`,
    },
    read: (s) => String(s.solid.resolution),
    apply: (s, raw) => setSolidResolution(s, Number(raw)),
    effect: (s, fx, previous) => {
      if (s.solidActive && s.solid.resolution !== previous.solid.resolution) {
        fx.restartSolidRender();
      }
    },
  },
];
