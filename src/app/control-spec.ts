import type {
  ColorMode,
  FourDColorMode,
  ShapeTrap,
  ShapeTrapMode,
  SymmetryPlane,
} from "../fractal/types";
import { DEFAULT_SHAPE_TRAP_THRESHOLD } from "../fractal/shape-trap";
import { buildColorModeLUT } from "../fractal/color";
import { buildPaletteLUT, resolvePalette } from "../fractal/palette";
import type { PaletteSelection } from "../fractal/palette";
import type { FlameWorkerCommand } from "./flame-worker-core";
import type { VoxelWorkerCommand } from "./voxel-worker-core";
import { hexToRgb01 } from "./constants";
import {
  bundledShapeEntry,
  bundledTrapForShape,
  type BundledTrapKind,
} from "./bundled-shapes";
import {
  DEFAULT_FLAME_PALETTE,
  DEFAULT_SOLID_PALETTE,
  FLAME_ITERATION_DETENTS,
  MAX_COLOR_GAMMA,
  MAX_NUM_POINTS,
  MIN_NUM_POINTS,
  nearestFlameIterationDetentIndex,
  resolveBalloonPalette,
  setAdaptiveResolution,
  setAutoUpdate,
  setBackgroundFlamePaletteId,
  setBackgroundMode,
  setBackgroundShape,
  setBalloonEcho,
  setBalloonPaletteId,
  setBalloonRadius,
  setBalloonTintStrength,
  setColorGamma,
  setCondensationDepthBand,
  setColorMode,
  setExportScale,
  setFlameEstimatorCurve,
  setFlameEstimatorMinimumRadius,
  setFlameEstimatorRadius,
  setFlameExposure,
  setFlameGamma,
  setFlameIterations,
  setFlamePaletteId,
  setFlameSupersample,
  setFlameVibrancy,
  setFogDensity,
  setFogTintStrength,
  setFourDColor,
  setFourDDepthFade,
  setGlowBrightness,
  setGroundPlane,
  setMorphDetail,
  setNumPoints,
  setPointSize,
  setRampPaletteId,
  setRenderStyle,
  setShowGuides,
  setSolidAmbient,
  setSolidIterations,
  setSolidLightAzimuth,
  setSolidLightElevation,
  setSolidPaletteId,
  setSolidResolution,
  setSolidThreshold,
  setSurfaceAmbient,
  setSurfaceColorSource,
  setSurfaceColorSpeed,
  setSurfaceEnvLight,
  setSurfaceFloorEmission,
  setSurfaceFloorPattern,
  setSurfaceFloorTileScale,
  setSurfaceLightAzimuth,
  setSurfaceLightElevation,
  setSurfacePaletteId,
  setShapeTrap,
  systemIsNonFlat,
  updateShapeTrap,
  setSymmetryPlane,
  setSymmetryOrder,
  setSymmetryTwist,
} from "./state";
import type {
  AppState,
  BalloonPaletteSelection,
  ExportScale,
  MorphDetail,
  RenderStyle,
  SolidParams,
  SurfaceColorSource,
  SurfaceFloorPattern,
  SurfaceParams,
} from "./state";
import type { BackgroundMode, BackgroundShape } from "./background";

/** One definition of the Surface sources that sample `surface.paletteId`.
 * Shared by LUT construction and the bespoke Custom-stop effect in main.ts so
 * adding a source cannot leave a live Surface session with a stale LUT. */
export function surfaceColorSourceUsesOwnPalette(
  source: SurfaceColorSource,
): boolean {
  return (
    source === "palette" ||
    source === "rings" ||
    source === "sheets" ||
    source === "shapeTrap"
  );
}

/**
 * Declarative specs for the panel's SIMPLE SCALAR controls: every static
 * slider/select/checkbox that binds one `index.html` input to one `AppState`
 * field, with an optional readout label, an optional view guard, and optional
 * post-apply side effects (scene pushes, render-worker forwards). From this
 * one table:
 *
 * - `Ui` derives its element lookups (the constructor still throws on a
 *   missing element, so ui.test.ts's index.html coverage test keeps its
 *   teeth), its listener registrations, and its `updateLabels` sync.
 * - `main.ts` derives the single generic handler: view guard →
 *   `beginSceneEdit` for document edits → {@link applyScalarControl} →
 *   label sync → the spec's {@link ControlEffect}.
 *
 * Adding a new scalar setting is one entry here plus one `index.html` row. The
 * bespoke dynamic widgets — the transform list/editor, variation rows, the 4D
 * editor group, the legend, and the session-only orbit/tumble/slice view
 * controls (which bind to main.ts closure state, not AppState) — stay
 * hand-built in ui.ts. Slider min/max/step still live on each `index.html`
 * row, but their ranges are now single-sourced by state.ts's `PARAM` table and
 * pinned against it by a ui.test.ts test — the log-scaled point count /
 * color-contrast sliders and the detent-indexed flame quality slider map their
 * own domains onto those ranges via the helpers below.
 *
 * This table owns scalar binding and effects, not panel placement. Before an
 * entry is added or moved, classify its conceptual home, consumers, lifetime,
 * and edit behavior under the four-family contract in `docs/panel-ia.md`.
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
 * Log-scale mapping for the color-contrast slider: position `v` in `[-1, 1]`
 * maps to gamma in `[MIN_COLOR_GAMMA, MAX_COLOR_GAMMA]` via `MAX_COLOR_GAMMA
 * ** v`. Works because `MIN_COLOR_GAMMA === 1 / MAX_COLOR_GAMMA`, which puts
 * neutral gamma `1.0` exactly at the slider's center (`v = 0`) and mirrors
 * the low/high halves logarithmically, so "spread the low end" and "spread
 * the high end" get equal-feeling ranges of travel either side of neutral.
 */
function sliderToColorGamma(v: number): number {
  return MAX_COLOR_GAMMA ** v;
}
function colorGammaToSlider(gamma: number): number {
  return Math.log(gamma) / Math.log(MAX_COLOR_GAMMA);
}

/**
 * Format an iteration count for display: millions with one decimal below 1e9 —
 * the flame progress line's long-standing look, e.g. "20.0M" — and billions
 * with up to two decimals at 1e9 and above, trailing zeros (and a bare
 * trailing dot) trimmed, e.g. "1.5B", "2B". Without the billions branch a
 * GPU-scale budget would print as an unreadable "2000.0M"; a display concern,
 * not app state, so it lives here rather than state.ts. Shared by the flame
 * Quality label below and ui.ts's `setFlameProgress` — the solid render is
 * CPU-only and out of scope, so `setSolidProgress` keeps its own
 * plain-millions format.
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
  /** The surface tracer's live uniforms — lighting + color-source
   * dispatch, all read every frame; see {@link SurfaceParams}. */
  setSurfaceParams(params: SurfaceParams): void;
  /** The surface tracer's 256x3 color LUT for the palette/height/radius
   * colorSources (see {@link surfaceColorLUT}) — uploaded once per change,
   * unlike `setSurfaceParams`' every-frame uniforms. */
  setSurfaceColorLUT(lut: Float32Array): void;
  /** Toggle the balloon echo — see `scene.ts`'s
   * `setBalloonEchoEnabled`. */
  setBalloonEchoEnabled(on: boolean): void;
  /** Set the balloon echo's normalized radius — see `scene.ts`'s
   * `setBalloonEchoRadius`. Also called every tick of the "Inflate" sweep
   * (`main.ts`'s `onBalloonInflate`), so it must stay cheap when the value
   * hasn't actually changed (the scene method's own equality guard). */
  setBalloonEchoRadius(rMult: number): void;
  /** Set the SURFACE balloon's normalized radius — see `scene.ts`'s
   * `setSurfaceBalloonRadius`, whose uniform-only cheap path makes it
   * safe per drag tick. The on/off TOGGLE has no scene effect here on
   * purpose: it is applied by the surface session re-enter
   * (`restartSurfaceRender`), which re-derives routing + grid + variant +
   * uniforms from state in one sweep. */
  setSurfaceBalloonRadius(rMult: number): void;
  /** Store the document's shape-trap block — the trap sliders' live
   * cheap path (uniforms / next frame spec, no recompile); see
   * `scene.ts`'s `setSurfaceShapeTrap`. */
  setSurfaceShapeTrap(trap: ShapeTrap | null): void;
  /** Set the balloon tint — `tint` an rgb01 tuple, `strength` its 0..1
   * blend weight; see `scene.ts`'s `setBalloonTint`. ONE method for the
   * Points, Solid, and Surface scene renderers; the one shared editor reaches
   * the same state/push. Uniform/spec writes only — unlike Surface's on/off
   * toggle this needs no session re-enter, because tint lives inside the
   * already-compiled SURFACE_BALLOON arm. */
  setBalloonTint(tint: [number, number, number], strength: number): void;
  /** Replace the balloon-only LUT in the Points, Solid, and Surface scene
   * arms. `null` is the explicit Inherit signal. */
  setBalloonPalette(lut: Float32Array | null): void;
  /** Set the depth-fog density multiplier — see `scene.ts`'s
   * `setFogDensity`. Pushes the GLSL/WGSL uniform on both surface tracers
   * and re-derives the points explorer's fog band and the balloon echo's
   * radial fade, all from the one stored value. */
  setFogDensity(v: number): void;
  /** Set the fog tint — `tint` an rgb01 tuple, `strength` its 0..1 blend
   * weight; see `scene.ts`'s `setFogTint`. Pushes
   * `uFogTint`/`uFogTintStrength` to both surface tracers and the solid
   * render's voxel raymarcher, then re-derives the points explorer's fog
   * color — the same push-to-both pattern as {@link setFogDensity}. */
  setFogTint(tint: [number, number, number], strength: number): void;
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
  /**
   * Re-derive the Surface mode button's eligibility gate from the current
   * document — for effects whose edit can move the system across an
   * analyzer seam without passing through main.ts's refreshUi: the
   * symmetry controls flip the document's flatness (a w-plane or a twist)
   * and close the Mandelbulb arm (order > 1). Cheap per input event —
   * `deriveSurfaceEligibility` is the probe-free marchability arithmetic
   * plus a few DOM writes on the mode button.
   */
  refreshSurfaceEligibility(): void;
  /** Rebuild the 3D cloud's color buffer over the cached chaos-game run
   * (never re-runs the game). */
  recolor(): void;
  /** Re-point the 4D shader's color source, re-baking the per-point
   * attribute for the baked modes — the 4D sibling of `recolor`. */
  applyFourDColor(): void;
  /** Restart the whole solid render session (a fresh worker, exactly like a
   * Render click) — the resolution slider's only path to a new grid while
   * active, since a grid's dimensions are fixed at allocation. */
  restartSolidRender(): void;
  /** Restart the whole flame render session — the Export-size select's only
   * path to a new accumulation while a flame render is active, since the
   * histogram/shared-frame dimensions are fixed at `start`; the flame twin
   * of {@link restartSolidRender}. */
  restartFlameRender(): void;
  /** Re-enter the surface session so a variant-level change — the balloon
   * toggle — recompiles and reroutes cleanly (compute vs WebGL, grid vs
   * gridless, SURFACE_BALLOON on the material); a no-op outside surface
   * mode. The surface sibling of {@link restartFlameRender}. */
  restartSurfaceRender(): void;
  /**
   * Apply the CURRENT `state.background` source to every renderer: a resolved
   * gradient for the gradient modes, or coordination of the transient image
   * source for Flame. An app-level callback rather than a
   * {@link ControlSceneEffects} method on purpose: main.ts owns the live
   * backdrop value (the crossfade tween interpolates from it), so every push
   * must route through its one owner — a direct scene call here would desync
   * the tween's `from` endpoint.
   */
  applyBackground(): void;
  /**
   * Re-derive the `"auto"` backdrop after an edit that may have moved the
   * palette it tracks — the palette selects call this beside their own
   * forwards. A guarded no-op for every other background mode, and
   * value-guarded in main.ts, so calling it for an INACTIVE render's palette
   * costs nothing; same one-owner routing as {@link applyBackground}.
   */
  trackAutoBackground(): void;
  /**
   * Cancel an in-flight "Inflate" sweep (`main.ts`'s `onBalloonInflate`),
   * if one is running. The balloon echo's checkbox and radius-slider
   * effects call this so a genuine user edit — drag the slider, or turn the
   * echo off — takes over from the replay instead of being overwritten by
   * its next tick. Safe to call with no sweep active (a no-op). The sweep's
   * OWN per-frame push writes state/scene directly rather than through this
   * table's `onScalarControl` pipeline, so it can never reach (and cancel)
   * itself.
   */
  cancelBalloonSweep(): void;
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
  /**
   * Commit-on-release effect: fired once when a range's drag ENDS — the
   * input's `change` event — unlike `effect`, which fires on every `input`
   * event during the drag itself. For a control whose live `effect` is
   * deliberately absent (or deliberately cheap) because its true cost
   * belongs at the end of the gesture, not on every intermediate tick — e.g.
   * numPointsSlider deferring the actual regenerate to release. Only
   * meaningful for `kind: "range"`: a `select`/checkbox already reports a
   * single settled `change` with nothing to distinguish it from, so they
   * have no equivalent. main.ts's onScalarControl runs `commit` INSTEAD of
   * `apply`/`effect` on the commit phase — the drag's own `input` events
   * already applied the settled value, so commit never re-applies state or
   * cuts a second undo checkpoint.
   */
  commit?: ControlEffect;
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

/** Symmetry's panel-IA record (`docs/panel-ia.md`): Scene / Look; consumed by
 * Points, Flame, Solid and Surface in both dimensions; document lifetime;
 * Points regeneration under auto-update, Flame/Solid accumulation restart
 * within their fixed session dimension, and next-entry Surface with an
 * immediate eligibility refresh. A dimensionality-changing edit is authored
 * now but requires Points regeneration before render re-entry. Shared by
 * order, plane and twist. */
const symmetryEffect: ControlEffect = (state, fx, previous) => {
  fx.regenerateIfAutoUpdate();
  // The kaleidoscope moves the Surface gate: a w-plane or a twist makes
  // the document 4D, and any order above 1 closes the Mandelbulb arm —
  // and this pipeline deliberately never runs a full refreshUi, so the
  // button would otherwise go stale until the next unrelated edit.
  fx.refreshSurfaceEligibility();
  // Render workers snapshot their dimension at entry. A symmetry edit that
  // crosses 3D <-> 4D therefore cannot be represented by setSymmetry: a 3D
  // worker would deliberately fall back to identity, while an immediate full
  // restart would still snapshot the old, not-yet-regenerated Points view.
  // Keep the existing frame intact and let the adjacent panel hint direct the
  // user through Points regeneration before re-entry. Same-dimension edits
  // retain the cheap live accumulation restart below.
  if (systemIsNonFlat(state) !== systemIsNonFlat(previous)) return;
  const command = {
    type: "setSymmetry",
    order: state.symmetry.order,
    plane: state.symmetry.plane,
    // Only a 4D session can express a twist, but the command shape is
    // one wire — a 3D session simply prepares w-free copies from it.
    twist: state.symmetry.twist ?? 0,
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

/** The surface tracer's lighting sliders — pure GPU uniforms, live at full
 * frame rate exactly like {@link solidParamsEffect}'s, but with no
 * accumulation behind them at all (see `SurfaceParams`'s doc). */
const surfaceParamsEffect: ControlEffect = (state, fx) => {
  fx.scene.setSurfaceParams(state.surface);
};

/** The trap's live-half push (scale/position/threshold/fade): rewrite the
 * scene's stored block — uniforms on the GLSL arm, the next frame spec on
 * compute — with no recompile (the shared Balloon radius's cheap path). */
const shapeTrapLiveEffect: ControlEffect = (state, fx) => {
  fx.scene.setSurfaceShapeTrap(state.shapeTrap ?? null);
};

/** Patch one component of the trap's position through the block's one
 * normalization domain (state.ts's updateShapeTrap). */
function updateShapeTrapPosition(
  state: AppState,
  axis: 0 | 1 | 2,
  value: number,
): AppState {
  if (!state.shapeTrap) return state;
  const position: [number, number, number] = [
    state.shapeTrap.position?.[0] ?? 0,
    state.shapeTrap.position?.[1] ?? 0,
    state.shapeTrap.position?.[2] ?? 0,
  ];
  position[axis] = value;
  return updateShapeTrap(state, { position });
}

/**
 * The surface tracer's color LUT for whichever `colorSource` needs
 * one — pure so `main.ts` (at session start) and this module's own
 * `surfaceColorSource`/`surfacePalette` effects below can rebuild it without
 * touching Three.js. `null` for `"transform"`, which has no LUT at all: the
 * tracer reads each slot's own `uMapColor` instead (see
 * `surface-material.ts`).
 *
 * `"palette"`, `"rings"`, `"sheets"`, and `"shapeTrap"` are the Surface
 * sources that sample its own palette selection. The trap-derived sources
 * read different coordinates off the same descent/forward-orbit hit info, but
 * all resolve
 * `state.surface.paletteId` through the shared custom-palette bridge
 * ({@link resolvePalette}), exactly like the flame/solid palette effects
 * below. {@link buildPaletteLUT} returns `null` only for the `"legacy"`
 * sentinel (see `palette.ts`) — a value the surface palette `<select>` never
 * actually offers (its options mirror `solidPalette`'s minus `"legacy"`),
 * but a decoded/shared scene could still carry one; falling back to
 * {@link DEFAULT_SOLID_PALETTE} (the surface render's own default, reused
 * from the solid render rather than redeclared) keeps this function honest
 * for that case, and a hard-coded white LUT is the last-resort guarantee
 * this never returns `null` for a source that needs one.
 *
 * `"height"`/`"radius"` reuse the explorer's ONE ramp definition
 * ({@link buildColorModeLUT}), gamma included — the same ramp the panel
 * legend and the solid render's `"legacy"`-palette path already share.
 */
export function surfaceColorLUT(state: AppState): Float32Array | null {
  const { colorSource } = state.surface;
  if (colorSource === "transform") return null;
  if (colorSource === "height" || colorSource === "radius") {
    return buildColorModeLUT(
      colorSource,
      state.colorGamma,
      resolvePalette(state.rampPaletteId, state.customPalette),
    );
  }
  if (!surfaceColorSourceUsesOwnPalette(colorSource)) return null;
  // Own-palette sources: an orbit/shape-trap-derived coordinate through the
  // Surface renderer's user-selected palette.
  const lut =
    buildPaletteLUT(
      resolvePalette(state.surface.paletteId, state.customPalette),
    ) ??
    buildPaletteLUT(resolvePalette(DEFAULT_SOLID_PALETTE, state.customPalette));
  if (lut) return lut;
  // Unreachable in practice (DEFAULT_SOLID_PALETTE names a real gradient,
  // never "legacy"), but buildPaletteLUT's own signature admits null, so
  // this keeps the function total: never null for a LUT-needing source.
  return new Float32Array(256 * 3).fill(1);
}

/**
 * Push the settled balloon palette to the active renderer that consumes it.
 * The document remains editable while the balloon is off, but that state is
 * inert until a later enable rebuilds the active arm from current state.
 * Points/Solid update live, Flame owns its accumulation restart inside the
 * worker command, and Surface re-enters its progressive session.
 *
 * Exported for the bespoke balloon Custom editor in main.ts, whose stop-list
 * callback uses the same effect as the one scalar palette select.
 */
export function applyBalloonPaletteEffects(
  state: AppState,
  fx: ControlEffects,
): void {
  if (!state.balloonEcho) return;

  const palette = applyBalloonPaletteToScene(state, fx);
  if (state.renderMode === "flame") {
    fx.postFlame(
      palette === null
        ? { type: "setBalloonPalette" }
        : { type: "setBalloonPalette", palette },
    );
  }
  if (state.renderMode === "surface") fx.restartSurfaceRender();
}

/** Install the document choice in the persistent Points/Solid/Surface scene.
 * Also used when enabling a palette authored while Balloon was off. */
function applyBalloonPaletteToScene(
  state: AppState,
  fx: ControlEffects,
): ReturnType<typeof resolveBalloonPalette> {
  const palette = resolveBalloonPalette(state);
  fx.scene.setBalloonPalette(
    palette === null ? null : buildPaletteLUT(palette),
  );
  return palette;
}

/** A select `change` that did not change the settled id is renderer-inert. */
const balloonPaletteEffect: ControlEffect = (state, fx, previous) => {
  if (state.balloonPaletteId === previous.balloonPaletteId) return;
  applyBalloonPaletteEffects(state, fx);
};

export const SCALAR_CONTROLS: readonly ScalarControlSpec[] = [
  // ——— Explorer: appearance ———
  {
    kind: "range",
    id: "numPointsSlider",
    label: { id: "numPointsLabel", text: (s) => s.numPoints.toLocaleString() },
    read: (s) => String(numPointsToSlider(s.numPoints)),
    apply: (s, raw) => setNumPoints(s, sliderToNumPoints(Number(raw))),
    // No live effect: regenerating on every "input" tick during the drag
    // would run a full chaos game per tick. Deferred to release instead
    // — see `commit`.
    commit: (s, fx) => fx.regenerateIfAutoUpdate(),
  },
  {
    // Morph detail: point density for a system morph's intermediate clouds
    // — see state.ts's MORPH_DETAILS for the vocabulary and morph-budget.ts
    // for the semantics. Session preference like autoUpdate (never enters
    // the scene document). No effect: the next morph intermediate's request
    // reads the settled state (main.ts's cloudParams).
    kind: "select",
    id: "morphDetail",
    persisted: false,
    read: (s) => s.morphDetail,
    apply: (s, raw) => setMorphDetail(s, raw as MorphDetail),
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
    // The glow-brightness slider — a manual multiplier on top of the glow
    // render's per-frame auto-exposure. Only shown while `renderStyle ===
    // "glow"` (see ui.ts's glowBrightnessRow gating). No effect needed:
    // main.ts's animate() reads state.glowBrightness as a multiplier
    // every frame.
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
    // The ramp-palette select: swaps the height/radius color-mode ramps'
    // built-in colors for a gradient palette (see color.ts's
    // buildColorModeLUT). Live in BOTH views (no `view` guard): the 4D
    // projection's "By 4D Radius" mode follows the same selection, so the
    // one row sits statically beneath the flat/4D color-select pair in the
    // Color section (see ui.ts's rampPaletteRow gating). Recolors the
    // live cloud over the cached run — like colorMode/colorGamma, never a
    // regenerate; recolor/applyFourDColor each no-op in the other view, so
    // exactly the displayed cloud re-bakes. No worker forward: the
    // flame/solid renders snapshot it at entry (main.ts's
    // fourDRenderSnapshot / the voxel start's rampPalette) and this row is
    // unreachable while a render is active.
    kind: "select",
    id: "rampPalette",
    read: (s) => s.rampPaletteId,
    apply: (s, raw) => setRampPaletteId(s, raw as PaletteSelection),
    effect: (s, fx) => {
      fx.recolor();
      fx.applyFourDColor();
      fx.trackAutoBackground();
    },
  },
  {
    // The color-contrast slider — `apply` converts the slider's log-scale
    // position to the actual gamma. Only shown while the active color
    // mode is height/radius/position (see ui.ts's colorGammaRow).
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
    // The Background select: which gradient or transient image source every
    // renderer shows — see background.ts. No `view` guard: the backdrop
    // applies to the 4D projection exactly like the 3D explorer. Landing on
    // Custom seeds the authored slot from the backdrop being replaced (see
    // setBackgroundMode); the custom color pickers themselves are a bespoke
    // ui.ts row (onBackgroundCustom), like the position axis colors.
    kind: "select",
    id: "background",
    read: (s) => s.background.mode,
    apply: (s, raw) => setBackgroundMode(s, raw as BackgroundMode),
    effect: (s, fx) => fx.applyBackground(),
  },
  {
    // The Shape select: the backdrop's gradient SHAPE — linear ramp or radial
    // vignette — orthogonal to the Background select's gradient choices (see
    // background.ts's BackgroundParams doc), and hidden while Flame selects a
    // per-pixel image. Same no-`view`-guard, same fx.applyBackground() push:
    // one shared effect moves both mode and shape edits through the app's
    // backdrop coordinator, which reads the shape off state itself.
    kind: "select",
    id: "backgroundShape",
    read: (s) => s.background.shape ?? "linear",
    apply: (s, raw) => setBackgroundShape(s, raw as BackgroundShape),
    effect: (s, fx) => fx.applyBackground(),
  },
  {
    // The generated backdrop owns its palette instead of borrowing whichever
    // renderer happens to be active. The row is visible only in Flame
    // background mode (ui.ts), but the authored value persists dormantly.
    // trackAutoBackground is also the app's guarded decorative-Flame refresh
    // coordinator, despite its historical name.
    kind: "select",
    id: "backgroundFlamePalette",
    read: (s) => s.background.flamePaletteId ?? DEFAULT_FLAME_PALETTE,
    apply: (s, raw) => setBackgroundFlamePaletteId(s, raw as PaletteSelection),
    effect: (s, fx) => fx.trackAutoBackground(),
  },
  {
    // The Fog slider's four-property record (docs/panel-ia.md): authored
    // Scene / Look document state, consumed live by flat Points Depth Fade /
    // Aerial Haze, Solid, every Surface tracer, and the Points Balloon's
    // bounded fade horizon. Flame, non-flat Points, and the other flat Points
    // styles have no main-cloud fog consumer; ui.ts keeps the authored row
    // visible but disables it beside its scope reason, except that an enabled
    // Points Balloon keeps density live for its horizon.
    kind: "range",
    id: "fogSlider",
    label: { id: "fogLabel", text: (s) => `${s.fogDensity.toFixed(2)}×` },
    read: (s) => String(s.fogDensity),
    apply: (s, raw) => setFogDensity(s, Number(raw)),
    effect: (s, fx) => fx.scene.setFogDensity(s.fogDensity),
  },
  {
    // The fog TINT strength: the blend-weight half of the same authored Look
    // pair, live for the main fog consumers above but NOT for Balloon's
    // brightness-only horizon. ui.ts therefore gates it independently of
    // fogSlider. The color half is a bespoke picker (ui.ts's onFogTint), like
    // the backdrop stops — this entry only carries the 0..1 strength slider,
    // converting the paired hex color to rgb01 at the point of use rather
    // than storing it twice.
    kind: "range",
    id: "fogTintStrength",
    label: {
      id: "fogTintLabel",
      text: (s) => `${Math.round(s.fogTintStrength * 100)}%`,
    },
    read: (s) => String(s.fogTintStrength),
    apply: (s, raw) => setFogTintStrength(s, Number(raw)),
    effect: (s, fx) =>
      fx.scene.setFogTint(hexToRgb01(s.fogTint), s.fogTintStrength),
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
  {
    // The adaptive-resolution governor's opt-out: like autoUpdate, a
    // session-only preference describing THIS device's headroom, not the
    // scene, so it never enters the encoded document. No effect: main.ts's
    // animate loop reads state.adaptiveResolution directly every frame
    // (governResolution) — there is nothing to forward or re-render here.
    kind: "checkbox",
    id: "adaptiveResolutionCheckbox",
    persisted: false,
    read: (s) => s.adaptiveResolution,
    apply: (s, checked) => setAdaptiveResolution(s, checked),
  },
  {
    // The balloon echo checkbox: PERSISTED — the balloon graduates from
    // session-only view toggle to scene content, so a checkbox edit now
    // cuts an undo checkpoint and a debounced save like any other
    // appearance control. Applies both the enabled flag AND the current
    // radius so switching on shows the echo at the slider's authored size,
    // not whatever the scene's last (or never-set) radius happened to be.
    // cancelBalloonSweep takes over from an in-flight Inflate replay — see
    // its doc; this only ever runs from the DOM checkbox's own "change"
    // event — the sweep's own per-tick reducer calls write state/scene
    // directly and so never reach (or persist through) this table-driven
    // pipeline at all.
    kind: "checkbox",
    id: "balloonEchoCheckbox",
    read: (s) => s.balloonEcho,
    apply: (s, checked) => setBalloonEcho(s, checked),
    effect: (s, fx) => {
      if (s.balloonEcho) applyBalloonPaletteToScene(s, fx);
      fx.scene.setBalloonEchoEnabled(s.balloonEcho);
      fx.scene.setBalloonEchoRadius(s.balloonRadius);
      fx.cancelBalloonSweep();
      if (s.renderMode === "flame") fx.restartFlameRender();
      if (s.renderMode === "surface") fx.restartSurfaceRender();
    },
  },
  {
    // One shared editor owns this selection. Unlike radius/tint, the row
    // stays reachable while the balloon is off so a look can be prepared
    // before enabling it; the shared effect's off guard keeps that authoring
    // renderer-inert until then.
    kind: "select",
    id: "balloonPalette",
    read: (s) => s.balloonPaletteId,
    apply: (s, raw) => setBalloonPaletteId(s, raw as BalloonPaletteSelection),
    effect: balloonPaletteEffect,
  },
  {
    // The balloon echo's radius slider — a plain 1:1 numeric mapping like
    // pointSizeSlider, persisted like the checkbox above. Live effect
    // (unlike numPointsSlider's deferred commit): re-inverting the shared
    // point buffer through the shader is a uniform write, not a
    // regenerate, so every drag tick can push it — each tick coalesces
    // into the drag's one undo checkpoint exactly like pointSizeSlider's
    // own live effect. The Inflate sweep (onBalloonInflate/tickLogic)
    // moves this same field every frame via its own direct reducer + scene
    // calls, bypassing this table entirely — the sweep itself is never an
    // undoable/saved edit, only wherever it settles rides the next
    // ordinary debounced save.
    kind: "range",
    id: "balloonRadiusSlider",
    label: {
      id: "balloonRadiusLabel",
      text: (s) => `${s.balloonRadius.toFixed(2)}×`,
    },
    read: (s) => String(s.balloonRadius),
    apply: (s, raw) => setBalloonRadius(s, Number(raw)),
    effect: (s, fx) => {
      fx.scene.setBalloonEchoRadius(s.balloonRadius);
      fx.scene.setSurfaceBalloonRadius(s.balloonRadius);
      fx.cancelBalloonSweep();
      if (s.renderMode === "flame") fx.restartFlameRender();
    },
  },
  {
    // Independent balloon color: the blend-weight half of the echo's own
    // tint pair, next to balloonRadiusSlider above. The color half is a
    // bespoke picker (ui.ts's onBalloonTint),
    // like fogTintStrength's onFogTint above — this entry only carries the
    // 0..1 strength slider, converting the paired hex color to rgb01 at the
    // point of use rather than storing it twice.
    kind: "range",
    id: "balloonTintStrength",
    label: {
      id: "balloonTintLabel",
      text: (s) => `${Math.round(s.balloonTintStrength * 100)}%`,
    },
    read: (s) => String(s.balloonTintStrength),
    apply: (s, raw) => setBalloonTintStrength(s, Number(raw)),
    effect: (s, fx) => {
      fx.scene.setBalloonTint(hexToRgb01(s.balloonTint), s.balloonTintStrength);
      if (s.renderMode === "flame") fx.restartFlameRender();
    },
  },
  // ——— Export ———
  {
    // Save-PNG export size: a session preference like autoUpdate /
    // adaptiveResolution (never enters the scene document — and for flame it
    // sets the LIVE render's cost, which a shared link must not carry to
    // another machine). Points/solid read it at capture time (main.ts's
    // onSavePng), so no effect there; an ACTIVE flame render accumulates at
    // the export size and must re-accumulate at the new one — its
    // histogram/shared-frame dims are fixed at start, like the solid grid —
    // hence the restart on a real change, mirroring solidResolutionSlider.
    kind: "select",
    id: "exportScale",
    persisted: false,
    read: (s) => String(s.exportScale),
    apply: (s, raw) => setExportScale(s, Number(raw) as ExportScale),
    effect: (s, fx, previous) => {
      if (s.renderMode === "flame" && s.exportScale !== previous.exportScale) {
        fx.restartFlameRender();
      }
    },
  },
  // ——— Symmetry (live in BOTH views: the 4D chaos game has a post-rotation
  // stage of its own, and a w-plane or nonzero twist makes the system itself
  // 4D, so no authored kaleidoscope is ever inert) ———
  {
    kind: "range",
    id: "symmetryOrderSlider",
    label: {
      id: "symmetryOrderLabel",
      text: (s) => `${s.symmetry.order}-fold`,
    },
    read: (s) => String(s.symmetry.order),
    apply: (s, raw) => setSymmetryOrder(s, Number(raw)),
    effect: symmetryEffect,
  },
  {
    // The plane the kaleidoscope turns in (renamed from the axis it turned
    // about) — all six coordinate planes; picking a w-plane is one of the
    // few edits that flips systemIsNonFlat without touching a transform
    // (`affine4.ts`'s `symmetryIsNonFlat`).
    kind: "select",
    id: "symmetryPlane",
    read: (s) => s.symmetry.plane,
    apply: (s, raw) => setSymmetryPlane(s, raw as SymmetryPlane),
    effect: symmetryEffect,
  },
  {
    // The kaleidoscope's twist: the second angle of a 4D double rotation,
    // in whole sectors — 0 is a simple rotation, anything else makes the
    // system 4D like a w-plane does. The slider's range is the STATIC `[0,
    // MAX_SYMMETRY_ORDER - 1]` span; `setSymmetryTwist` is the single
    // INTERACTIVE clamp (down to the CURRENT order's last distinct value,
    // `order - 1`); a loaded document meets the same `[0, order)` policy
    // in `persist.ts`'s decoder — the mirror of `order`'s own decode-time
    // clamp — so out-of-range values never reach state from either door.
    kind: "range",
    id: "symmetryTwistSlider",
    label: {
      id: "symmetryTwistLabel",
      text: (s) => String(s.symmetry.twist ?? 0),
    },
    read: (s) => String(s.symmetry.twist ?? 0),
    apply: (s, raw) => setSymmetryTwist(s, Number(raw)),
    effect: symmetryEffect,
  },
  // ——— 4D look (non-flat systems only; each row lives beside its flat
  // sibling in the Color or Depth section) ———
  {
    // The 4D color select — re-points the 4D shader's color source (and
    // re-bakes the attribute for the baked modes) without re-running the
    // chaos game.
    kind: "select",
    id: "fourDColor",
    view: "nonFlat",
    read: (s) => s.fourDColor,
    apply: (s, raw) => setFourDColor(s, raw as FourDColorMode),
    effect: (s, fx) => fx.applyFourDColor(),
  },
  {
    // The 4D camera-depth fade. Unlike the session-only slice/tumble
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
    // The Quality slider carries a detent INDEX, not the raw count: a
    // persisted/shared scene can hold a non-detent value (e.g. an old
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
    apply: (s, raw) => setFlamePaletteId(s, raw as PaletteSelection),
    effect: (s, fx) => {
      fx.postFlame({
        type: "setPalette",
        palette: resolvePalette(s.flame.paletteId, s.customPalette),
      });
      fx.trackAutoBackground();
    },
  },
  // Adaptive density-estimation blur sliders — live-reactive like
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
    apply: (s, raw) => setSolidPaletteId(s, raw as PaletteSelection),
    effect: (s, fx) => {
      fx.postVoxel({
        type: "setPalette",
        palette: resolvePalette(s.solid.paletteId, s.customPalette),
      });
      fx.trackAutoBackground();
    },
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
      if (
        s.renderMode === "solid" &&
        s.solid.resolution !== previous.solid.resolution
      ) {
        fx.restartSolidRender();
      }
    },
  },
  // ——— Surface render ———
  // Every field is a live GPU uniform (see SurfaceParams's doc): unlike the
  // flame/solid siblings above, NOTHING here ever restarts a worker or an
  // accumulation — there is none. The lighting sliders just forward the
  // settled params; the two color controls additionally rebuild the LUT
  // (surfaceColorLUT), pushing it only when the source actually needs one.
  {
    kind: "range",
    id: "surfaceLightAzimuthSlider",
    label: {
      id: "surfaceLightAzimuthLabel",
      text: (s) => `${Math.round(s.surface.lightAzimuth)}°`,
    },
    read: (s) => String(s.surface.lightAzimuth),
    apply: (s, raw) => setSurfaceLightAzimuth(s, Number(raw)),
    effect: surfaceParamsEffect,
  },
  {
    kind: "range",
    id: "surfaceLightElevationSlider",
    label: {
      id: "surfaceLightElevationLabel",
      text: (s) => `${Math.round(s.surface.lightElevation)}°`,
    },
    read: (s) => String(s.surface.lightElevation),
    apply: (s, raw) => setSurfaceLightElevation(s, Number(raw)),
    effect: surfaceParamsEffect,
  },
  {
    kind: "range",
    id: "surfaceAmbientSlider",
    label: {
      id: "surfaceAmbientLabel",
      text: (s) => `${Math.round(s.surface.ambient * 100)}%`,
    },
    read: (s) => String(s.surface.ambient),
    apply: (s, raw) => setSurfaceAmbient(s, Number(raw)),
    effect: surfaceParamsEffect,
  },
  {
    kind: "range",
    id: "surfaceEnvLightSlider",
    label: {
      id: "surfaceEnvLightLabel",
      text: (s) => `${Math.round(s.surface.envLight * 100)}%`,
    },
    read: (s) => String(s.surface.envLight),
    apply: (s, raw) => setSurfaceEnvLight(s, Number(raw)),
    effect: surfaceParamsEffect,
  },
  {
    kind: "select",
    id: "surfaceFloorPatternSelect",
    read: (s) => s.surface.floorPattern,
    apply: (s, raw) => setSurfaceFloorPattern(s, raw as SurfaceFloorPattern),
    effect: surfaceParamsEffect,
  },
  {
    kind: "range",
    id: "surfaceFloorTileScaleSlider",
    label: {
      id: "surfaceFloorTileScaleLabel",
      text: (s) => `${s.surface.floorTileScale.toFixed(2)}×`,
    },
    read: (s) => String(s.surface.floorTileScale),
    apply: (s, raw) => setSurfaceFloorTileScale(s, Number(raw)),
    effect: surfaceParamsEffect,
  },
  {
    kind: "range",
    id: "surfaceFloorEmissionSlider",
    label: {
      id: "surfaceFloorEmissionLabel",
      text: (s) => s.surface.floorEmission.toFixed(2),
    },
    read: (s) => String(s.surface.floorEmission),
    apply: (s, raw) => setSurfaceFloorEmission(s, Number(raw)),
    effect: surfaceParamsEffect,
  },
  {
    // Color speed: per-level decay of the "palette" source's orbit-trap
    // blend weight — flam3's "color speed" one render over. Only shown
    // while colorSource === "palette" (see ui.ts's surfaceColorSpeedRow
    // gating); inert for every other source, but a plain GPU uniform like
    // its surface siblings, so the effect is the same surfaceParamsEffect
    // push regardless.
    kind: "range",
    id: "surfaceColorSpeedSlider",
    label: {
      id: "surfaceColorSpeedLabel",
      text: (s) => `${Math.round(s.surface.colorSpeed * 100)}%`,
    },
    read: (s) => String(s.surface.colorSpeed),
    apply: (s, raw) => setSurfaceColorSpeed(s, Number(raw)),
    effect: surfaceParamsEffect,
  },
  {
    // The surface ground plane checkbox: a persisted Floor toggle for the
    // surface render alone — unlike the Balloon pair above, there is no
    // explorer-echo counterpart in the points render. Ui only disables this
    // authored checkbox while an applicable Surface Balloon encloses it; the
    // reducer remains independent and never clears either flag. Like the
    // shared Balloon checkbox, this is a VARIANT-level change
    // (SURFACE_GROUND_PLANE recompile / compute params-struct size / shade
    // arm), so the effect re-enters the surface session, which re-derives
    // the floor uniforms/kernel choice from state in one sweep — no direct
    // scene call, and no sweep to cancel (the floor has no Inflate replay).
    kind: "checkbox",
    id: "surfaceGroundPlaneCheckbox",
    read: (s) => s.groundPlane,
    apply: (s, checked) => setGroundPlane(s, checked),
    effect: (s, fx) => {
      fx.restartSurfaceRender();
    },
  },
  {
    // Re-points the tracer's base-color dispatch. Unlike the flame/solid
    // palette selects, nothing restarts — there is no accumulation to bake
    // the old source into — so the effect just pushes the settled params
    // AND the LUT the new source needs (surfaceColorLUT returns null for
    // "transform", which has none).
    kind: "select",
    id: "surfaceColorSource",
    read: (s) => s.surface.colorSource,
    apply: (s, raw) => setSurfaceColorSource(s, raw as SurfaceColorSource),
    effect: (s, fx) => {
      fx.scene.setSurfaceParams(s.surface);
      const lut = surfaceColorLUT(s);
      if (lut) fx.scene.setSurfaceColorLUT(lut);
    },
  },
  {
    // Same params+LUT effect as surfaceColorSource above — live-reactive,
    // unlike the flame/solid palette selects, which restart their worker's
    // accumulation because the old palette is baked into it.
    kind: "select",
    id: "surfacePalette",
    read: (s) => s.surface.paletteId,
    apply: (s, raw) => setSurfacePaletteId(s, raw as PaletteSelection),
    effect: (s, fx) => {
      fx.scene.setSurfaceParams(s.surface);
      const lut = surfaceColorLUT(s);
      if (lut) fx.scene.setSurfaceColorLUT(lut);
      fx.trackAutoBackground();
    },
  },
  {
    // Condensation geometry is a Surface-only interpretation of emitter
    // documents. The preset's default is every word depth (absent on the
    // wire); root-only is the useful one-scale shortcut, and Custom exposes
    // the inclusive endpoints. Every change rebuilds the frozen DE/session.
    kind: "select",
    id: "surfaceCondensationBandMode",
    read: (s) => condensationBandMode(s),
    apply: (s, raw) =>
      raw === "all"
        ? setCondensationDepthBand(s, null)
        : raw === "root"
          ? setCondensationDepthBand(s, { maxDepth: 0 })
          : setCondensationDepthBand(
              s,
              s.condensationDepthBand?.maxDepth === 0
                ? { minDepth: 1, maxDepth: 1 }
                : (s.condensationDepthBand ?? {
                    minDepth: 1,
                    maxDepth: 1,
                  }),
            ),
    effect: (_s, fx) => fx.restartSurfaceRender(),
  },
  {
    kind: "range",
    id: "surfaceCondensationMinSlider",
    label: {
      id: "surfaceCondensationMinLabel",
      text: (s) => String(s.condensationDepthBand?.minDepth ?? 1),
    },
    read: (s) => String(s.condensationDepthBand?.minDepth ?? 1),
    apply: (s, raw) =>
      setCondensationDepthBand(s, {
        ...(s.condensationDepthBand ?? { maxDepth: 1 }),
        minDepth: Number(raw),
      }),
    effect: (_s, fx) => fx.restartSurfaceRender(),
  },
  {
    kind: "range",
    id: "surfaceCondensationMaxSlider",
    label: {
      id: "surfaceCondensationMaxLabel",
      text: (s) => String(s.condensationDepthBand?.maxDepth ?? 1),
    },
    read: (s) => String(s.condensationDepthBand?.maxDepth ?? 1),
    apply: (s, raw) =>
      setCondensationDepthBand(s, {
        ...(s.condensationDepthBand ?? { minDepth: 1 }),
        maxDepth: Number(raw),
      }),
    effect: (_s, fx) => fx.restartSurfaceRender(),
  },
  {
    // The shape trap's SHAPE — the built-ins by name, "" = no trap (the
    // classic-removal value: the block leaves the document outright). A
    // block whose spec matches no built-in — a preset's authored pose, a
    // shared link — reads as the hidden "(authored)" sentinel, and
    // re-picking it is a no-op so a sync can never destroy an authored
    // spec. VARIANT-LEVEL: the shape bakes into both engines' programs
    // (surfaceFragmentFor's splice, the kernels' codegen), so the effect
    // re-enters the session, the shared Balloon checkbox's discipline.
    kind: "select",
    id: "surfaceTrapShape",
    read: (s) => shapeTrapSelectValue(s),
    apply: (s, raw) => {
      if (raw === "custom") return s;
      const bundled = bundledShapeEntry(raw);
      return setShapeTrap(s, bundled?.trap ? { shape: bundled.shape } : null);
    },
    effect: (s, fx) => {
      fx.scene.setSurfaceShapeTrap(s.shapeTrap ?? null);
      fx.restartSurfaceRender();
    },
  },
  {
    // Geometry is a second use of the SAME posed shape. Shape and enable flag
    // select the compiled march term; WGSL also bakes the inclusive band,
    // while GLSL uploads it. Pose stays live on both paths, and every topology
    // edit restarts the session. Routing eligibility changes with the flag:
    // only conformal fold chains can use the distance union.
    kind: "checkbox",
    id: "surfaceTrapGeometryCheckbox",
    read: (s) => s.shapeTrap?.geometry === true,
    apply: (s, checked) =>
      s.shapeTrap ? setShapeTrap(s, { ...s.shapeTrap, geometry: checked }) : s,
    effect: (s, fx) => {
      fx.scene.setSurfaceShapeTrap(s.shapeTrap ?? null);
      fx.refreshSurfaceEligibility();
      fx.restartSurfaceRender();
    },
  },
  {
    kind: "select",
    id: "surfaceTrapGeometryBandMode",
    read: (s) => shapeTrapGeometryBandMode(s),
    apply: (s, raw) => {
      if (!s.shapeTrap) return s;
      return raw === "all"
        ? setShapeTrap(s, {
            ...s.shapeTrap,
            geometry: true,
            geometryLevelMin: undefined,
            geometryLevelMax: undefined,
          })
        : raw === "root"
          ? setShapeTrap(s, {
              ...s.shapeTrap,
              geometry: true,
              geometryLevelMin: 0,
              geometryLevelMax: 0,
            })
          : setShapeTrap(s, {
              ...s.shapeTrap,
              geometry: true,
              ...(shapeTrapGeometryBandMode(s) === "root" ||
              (s.shapeTrap.geometryLevelMin === undefined &&
                s.shapeTrap.geometryLevelMax === undefined)
                ? { geometryLevelMin: 1, geometryLevelMax: 1 }
                : {}),
            });
    },
    effect: (s, fx) => {
      fx.scene.setSurfaceShapeTrap(s.shapeTrap ?? null);
      fx.restartSurfaceRender();
    },
  },
  {
    kind: "range",
    id: "surfaceTrapGeometryMinSlider",
    label: {
      id: "surfaceTrapGeometryMinLabel",
      text: (s) => String(s.shapeTrap?.geometryLevelMin ?? 1),
    },
    read: (s) => String(s.shapeTrap?.geometryLevelMin ?? 1),
    apply: (s, raw) =>
      s.shapeTrap
        ? setShapeTrap(s, {
            ...s.shapeTrap,
            geometry: true,
            geometryLevelMin: Number(raw),
            geometryLevelMax: s.shapeTrap.geometryLevelMax ?? 1,
          })
        : s,
    effect: (s, fx) => {
      fx.scene.setSurfaceShapeTrap(s.shapeTrap ?? null);
      fx.restartSurfaceRender();
    },
  },
  {
    kind: "range",
    id: "surfaceTrapGeometryMaxSlider",
    label: {
      id: "surfaceTrapGeometryMaxLabel",
      text: (s) => String(s.shapeTrap?.geometryLevelMax ?? 1),
    },
    read: (s) => String(s.shapeTrap?.geometryLevelMax ?? 1),
    apply: (s, raw) =>
      s.shapeTrap
        ? setShapeTrap(s, {
            ...s.shapeTrap,
            geometry: true,
            geometryLevelMin: s.shapeTrap.geometryLevelMin ?? 1,
            geometryLevelMax: Number(raw),
          })
        : s,
    effect: (s, fx) => {
      fx.scene.setSurfaceShapeTrap(s.shapeTrap ?? null);
      fx.restartSurfaceRender();
    },
  },
  {
    // The trap's live pose half: scale/position/threshold/fade rewrite
    // uniforms (GLSL) or ride the next frame spec (compute) with no
    // recompile — the shared Balloon radius's cheap path.
    kind: "range",
    id: "surfaceTrapScaleSlider",
    label: {
      id: "surfaceTrapScaleLabel",
      text: (s) => `${(s.shapeTrap?.scale ?? 1).toFixed(2)}×`,
    },
    read: (s) => String(s.shapeTrap?.scale ?? 1),
    apply: (s, raw) => updateShapeTrap(s, { scale: Number(raw) }),
    effect: shapeTrapLiveEffect,
  },
  {
    kind: "range",
    id: "surfaceTrapXSlider",
    label: {
      id: "surfaceTrapXLabel",
      text: (s) => (s.shapeTrap?.position?.[0] ?? 0).toFixed(2),
    },
    read: (s) => String(s.shapeTrap?.position?.[0] ?? 0),
    apply: (s, raw) => updateShapeTrapPosition(s, 0, Number(raw)),
    effect: shapeTrapLiveEffect,
  },
  {
    kind: "range",
    id: "surfaceTrapYSlider",
    label: {
      id: "surfaceTrapYLabel",
      text: (s) => (s.shapeTrap?.position?.[1] ?? 0).toFixed(2),
    },
    read: (s) => String(s.shapeTrap?.position?.[1] ?? 0),
    apply: (s, raw) => updateShapeTrapPosition(s, 1, Number(raw)),
    effect: shapeTrapLiveEffect,
  },
  {
    kind: "range",
    id: "surfaceTrapZSlider",
    label: {
      id: "surfaceTrapZLabel",
      text: (s) => (s.shapeTrap?.position?.[2] ?? 0).toFixed(2),
    },
    read: (s) => String(s.shapeTrap?.position?.[2] ?? 0),
    apply: (s, raw) => updateShapeTrapPosition(s, 2, Number(raw)),
    effect: shapeTrapLiveEffect,
  },
  {
    // Min vs first-crossing. On the wire it is a live flag, but the mode
    // re-enters the session by decision (the create-time treatment the
    // shape gets), so the two-mode split never depends on which engine's
    // uniform push happened to land first.
    kind: "select",
    id: "surfaceTrapMode",
    read: (s) => (s.shapeTrap?.mode === "threshold" ? "threshold" : "min"),
    apply: (s, raw) => updateShapeTrap(s, { mode: raw as ShapeTrapMode }),
    effect: (s, fx) => {
      fx.scene.setSurfaceShapeTrap(s.shapeTrap ?? null);
      fx.restartSurfaceRender();
    },
  },
  {
    kind: "range",
    id: "surfaceTrapThresholdSlider",
    label: {
      id: "surfaceTrapThresholdLabel",
      text: (s) =>
        `${Math.round((s.shapeTrap?.threshold ?? DEFAULT_SHAPE_TRAP_THRESHOLD) * 100)}%`,
    },
    read: (s) => String(s.shapeTrap?.threshold ?? DEFAULT_SHAPE_TRAP_THRESHOLD),
    apply: (s, raw) => updateShapeTrap(s, { threshold: Number(raw) }),
    effect: shapeTrapLiveEffect,
  },
  {
    kind: "range",
    id: "surfaceTrapFadeSlider",
    label: {
      id: "surfaceTrapFadeLabel",
      text: (s) => `${Math.round((s.shapeTrap?.fade ?? 0) * 100)}%`,
    },
    read: (s) => String(s.shapeTrap?.fade ?? 0),
    apply: (s, raw) => updateShapeTrap(s, { fade: Number(raw) }),
    effect: shapeTrapLiveEffect,
  },
];

/**
 * The trap shape select's display value — which built-in the document's
 * block IS, by deep spec equality ("" without a block, the hidden
 * "(authored)" sentinel for anything else). Exported for `ui.ts`'s row
 * gating and the spec tests.
 */
export function shapeTrapSelectValue(
  state: AppState,
): "" | BundledTrapKind | "custom" {
  const trap = state.shapeTrap;
  if (!trap) return "";
  return bundledTrapForShape(trap.shape)?.kind ?? "custom";
}

export function condensationBandMode(
  state: AppState,
): "all" | "root" | "custom" {
  const band = state.condensationDepthBand;
  if (!band) return "all";
  return band.minDepth === undefined && band.maxDepth === 0 ? "root" : "custom";
}

/** Display mode for trap geometry's inclusive post-link level band. The
 * all-level default is absent on the normalized wire; 0..0 is the root-only
 * shortcut; every other finite pair uses the endpoint controls. */
export function shapeTrapGeometryBandMode(
  state: AppState,
): "all" | "root" | "custom" {
  const trap = state.shapeTrap;
  if (!trap?.geometry) return "all";
  if (
    trap.geometryLevelMin === undefined &&
    trap.geometryLevelMax === undefined
  ) {
    return "all";
  }
  return (trap.geometryLevelMin ?? 0) === 0 && trap.geometryLevelMax === 0
    ? "root"
    : "custom";
}
