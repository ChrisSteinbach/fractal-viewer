import { appendTransform, defaultTransforms } from "../fractal/presets";
import type { Rng } from "../fractal/rng";
import type { ColorMode, Transform } from "../fractal/types";

/**
 * How the point cloud conveys depth. `depthFade` is the original look (fog to
 * the dark background); the rest are experiments compared via the UI switcher.
 * Kept here (a plain string union, no Three.js) so state stays pure and
 * `scene.ts` maps each style to a renderer configuration.
 */
export type RenderStyle = "depthFade" | "aerial" | "glow" | "dof" | "edl";

/** Snapshot of everything the UI and renderer need to draw a frame. */
export interface AppState {
  transforms: Transform[];
  numPoints: number;
  /** Index into `transforms`, or `null` for camera (orbit) mode. */
  selectedTransform: number | null;
  showGuides: boolean;
  colorMode: ColorMode;
  renderStyle: RenderStyle;
  autoUpdate: boolean;
  panelOpen: boolean;
}

/** An IFS needs at least one map. */
export const MIN_TRANSFORMS = 1;
export const DEFAULT_NUM_POINTS = 100_000;

export function initialState(panelOpen: boolean): AppState {
  return {
    transforms: defaultTransforms(),
    numPoints: DEFAULT_NUM_POINTS,
    selectedTransform: null,
    showGuides: true,
    colorMode: "transform",
    renderStyle: "depthFade",
    autoUpdate: true,
    panelOpen,
  };
}

export function addTransform(
  state: AppState,
  rng: Rng = Math.random,
): AppState {
  return { ...state, transforms: appendTransform(state.transforms, rng) };
}

export function removeTransform(state: AppState): AppState {
  if (state.transforms.length <= MIN_TRANSFORMS) return state;
  const transforms = state.transforms.slice(0, -1);
  // Drop the selection if it pointed at the transform we just removed.
  const selectedTransform =
    state.selectedTransform === state.transforms.length - 1
      ? null
      : state.selectedTransform;
  return { ...state, transforms, selectedTransform };
}

export function selectTransform(
  state: AppState,
  index: number | null,
): AppState {
  return { ...state, selectedTransform: index };
}

/** Replace the whole system (presets) and return to camera mode. */
export function setTransforms(
  state: AppState,
  transforms: Transform[],
): AppState {
  return { ...state, transforms, selectedTransform: null };
}

/** Update a single transform's geometry, preserving its id. */
export function updateTransform(
  state: AppState,
  index: number,
  geometry: Pick<Transform, "position" | "rotation" | "scale">,
): AppState {
  const transforms = state.transforms.map((t, i) =>
    i === index ? { ...t, ...geometry } : t,
  );
  return { ...state, transforms };
}

export function setNumPoints(state: AppState, numPoints: number): AppState {
  return { ...state, numPoints };
}

export function setColorMode(state: AppState, colorMode: ColorMode): AppState {
  return { ...state, colorMode };
}

export function setRenderStyle(
  state: AppState,
  renderStyle: RenderStyle,
): AppState {
  return { ...state, renderStyle };
}

export function setShowGuides(state: AppState, showGuides: boolean): AppState {
  return { ...state, showGuides };
}

export function setAutoUpdate(state: AppState, autoUpdate: boolean): AppState {
  return { ...state, autoUpdate };
}

export function setPanelOpen(state: AppState, panelOpen: boolean): AppState {
  return { ...state, panelOpen };
}
