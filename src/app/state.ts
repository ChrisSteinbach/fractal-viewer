import { appendTransform, defaultTransforms } from "../fractal/presets";
import type { Rng } from "../fractal/rng";
import type { ColorMode, Transform } from "../fractal/types";

/**
 * How the point cloud conveys depth. `depthFade` is the original look (fog to
 * the dark background); the rest are experiments compared via the UI switcher.
 * Kept here (plain strings, no Three.js) so state stays pure and `scene.ts`
 * maps each style to a renderer configuration.
 *
 * This array is the single source of truth for both the {@link RenderStyle}
 * type and the persistence validator (`VALID_RENDER_STYLES` in `persist.ts`),
 * so adding a style is one edit and the runtime guard can never silently drift
 * from the type.
 */
export const RENDER_STYLES = [
  "depthFade",
  "aerial",
  "glow",
  "dof",
  "edl",
] as const;

export type RenderStyle = (typeof RENDER_STYLES)[number];

/**
 * Render-current-view settings for the flame renderer (`src/fractal/flame.ts`).
 * Persists as a render setting like `colorMode` / `renderStyle`, independent
 * of whether a render is currently active (see {@link AppState.flameActive}).
 */
export interface FlameParams {
  /** Brightness multiplier over the log-density tone-map; 1 = neutral. */
  exposure: number;
  /** Total chaos-game iterations to accumulate before a render is "done". */
  iterations: number;
  /**
   * Gamma-reshapes the log-density curve (see `flame.ts`'s `TonemapParams`);
   * 1 = neutral (fr-o7s's original curve, unchanged). Applied live over the
   * current accumulation — never needs a re-accumulate.
   */
  gamma: number;
  /**
   * Blends density-scaled color (1) against a flat gamma-only color that
   * ignores density (0) — see `TonemapParams`. Applied live, like `gamma`.
   */
  vibrancy: number;
  /**
   * Linear supersample factor: accumulates into a `supersample`x-larger
   * histogram (in each axis), then downfilters it to display resolution
   * every frame for antialiasing (see `flame.ts`'s `downsampleFlame`).
   * Changing it mid-render restarts accumulation — the histogram's
   * dimensions change, so there is nothing to keep.
   */
  supersample: number;
}

/** Snapshot of everything the UI and renderer need to draw a frame. */
export interface AppState {
  transforms: Transform[];
  /**
   * Optional final transform (fractal-flame "final xform"): an affine +
   * variation lens applied to every point as it is plotted, never fed back into
   * the orbit. Omitted ⇒ no lens. Being a global effect it persists across
   * preset loads, like `colorMode` / `renderStyle`.
   */
  finalTransform?: Transform;
  numPoints: number;
  /** Multiplier on each render style's base point size; 1 = as authored. */
  pointSize: number;
  /**
   * The edit target: an index into `transforms`, `"final"` for the final
   * transform, or `null` for camera (orbit) mode.
   */
  selectedTransform: number | "final" | null;
  showGuides: boolean;
  colorMode: ColorMode;
  renderStyle: RenderStyle;
  autoUpdate: boolean;
  panelOpen: boolean;
  /** Render-current-view settings; persists independent of {@link flameActive}. */
  flame: FlameParams;
  /**
   * Whether the flame render-current-view overlay is showing (in place of the
   * live point cloud). Session-only, like `selectedTransform` /
   * `autoUpdate` — never persisted, so the app always boots into the
   * explorer (see `persist.ts`'s `SceneSnapshot`, which omits this field).
   */
  flameActive: boolean;
}

/** An IFS needs at least one map. */
export const MIN_TRANSFORMS = 1;
export const DEFAULT_NUM_POINTS = 100_000;
/** Point-size multiplier; 1 renders each style at its authored size. */
export const DEFAULT_POINT_SIZE = 1;
/** Neutral brightness multiplier for a freshly started flame render. */
export const DEFAULT_FLAME_EXPOSURE = 1;
/**
 * Default iteration budget for a full flame render: enough for a
 * reasonably converged image within a few seconds on typical hardware
 * (chunked across animation frames — see `main.ts`), without the tab
 * stalling on an unbounded accumulation.
 */
export const DEFAULT_FLAME_ITERATIONS = 20_000_000;
export const MIN_FLAME_EXPOSURE = 0.2;
export const MAX_FLAME_EXPOSURE = 4;
export const MIN_FLAME_ITERATIONS = 1_000_000;
export const MAX_FLAME_ITERATIONS = 100_000_000;
/** Neutral gamma — fr-o7s's original log-density curve, unreshaped. */
export const DEFAULT_FLAME_GAMMA = 2.4;
export const MIN_FLAME_GAMMA = 1;
export const MAX_FLAME_GAMMA = 6;
/** Fully density-scaled color — today's look, before vibrancy existed. */
export const DEFAULT_FLAME_VIBRANCY = 1;
export const MIN_FLAME_VIBRANCY = 0;
export const MAX_FLAME_VIBRANCY = 1;
/** No supersampling — accumulate straight at display resolution. */
export const DEFAULT_FLAME_SUPERSAMPLE = 2;
export const MIN_FLAME_SUPERSAMPLE = 1;
/** Memory is O(supersample^2): a Float64 hits + Float64x3 sumRGB bucket is 32
 * bytes, so 3x at 1080p is already ~373 MB — capped well short of where a
 * casual slider drag could exhaust a phone's memory. */
export const MAX_FLAME_SUPERSAMPLE = 3;

export function initialState(panelOpen: boolean): AppState {
  return {
    transforms: defaultTransforms(),
    numPoints: DEFAULT_NUM_POINTS,
    pointSize: DEFAULT_POINT_SIZE,
    selectedTransform: null,
    showGuides: true,
    colorMode: "transform",
    renderStyle: "depthFade",
    autoUpdate: true,
    panelOpen,
    flame: {
      exposure: DEFAULT_FLAME_EXPOSURE,
      iterations: DEFAULT_FLAME_ITERATIONS,
      gamma: DEFAULT_FLAME_GAMMA,
      vibrancy: DEFAULT_FLAME_VIBRANCY,
      supersample: DEFAULT_FLAME_SUPERSAMPLE,
    },
    flameActive: false,
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
  index: number | "final" | null,
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
  geometry: Pick<
    Transform,
    "position" | "rotation" | "scale" | "weight" | "shear" | "variations"
  >,
): AppState {
  const transforms = state.transforms.map((t, i) =>
    i === index ? { ...t, ...geometry } : t,
  );
  return { ...state, transforms };
}

/**
 * Enable/replace the final transform, or clear it with `null`. Stored as
 * `undefined` when cleared so it drops out of the persisted snapshot entirely.
 */
export function setFinalTransform(
  state: AppState,
  finalTransform: Transform | null,
): AppState {
  return { ...state, finalTransform: finalTransform ?? undefined };
}

export function setNumPoints(state: AppState, numPoints: number): AppState {
  return { ...state, numPoints };
}

export function setPointSize(state: AppState, pointSize: number): AppState {
  return { ...state, pointSize };
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

/** Set the flame render's brightness multiplier, clamped to a sane range. */
export function setFlameExposure(state: AppState, exposure: number): AppState {
  return {
    ...state,
    flame: {
      ...state.flame,
      exposure: Math.max(
        MIN_FLAME_EXPOSURE,
        Math.min(MAX_FLAME_EXPOSURE, exposure),
      ),
    },
  };
}

/**
 * Set the flame render's iteration budget, clamped to a sane range. Live-
 * reactive: raising it while a render is in progress lets accumulation
 * continue past what had looked "done" (see `main.ts`'s render loop).
 */
export function setFlameIterations(
  state: AppState,
  iterations: number,
): AppState {
  return {
    ...state,
    flame: {
      ...state.flame,
      iterations: Math.round(
        Math.max(
          MIN_FLAME_ITERATIONS,
          Math.min(MAX_FLAME_ITERATIONS, iterations),
        ),
      ),
    },
  };
}

/** Set the flame render's gamma curve, clamped to a sane range. Live-reactive
 * (re-tonemaps the existing accumulation, never re-accumulates). */
export function setFlameGamma(state: AppState, gamma: number): AppState {
  return {
    ...state,
    flame: {
      ...state.flame,
      gamma: Math.max(MIN_FLAME_GAMMA, Math.min(MAX_FLAME_GAMMA, gamma)),
    },
  };
}

/** Set the flame render's vibrancy blend, clamped to [0, 1]. Live-reactive,
 * like {@link setFlameGamma}. */
export function setFlameVibrancy(state: AppState, vibrancy: number): AppState {
  return {
    ...state,
    flame: {
      ...state.flame,
      vibrancy: Math.max(
        MIN_FLAME_VIBRANCY,
        Math.min(MAX_FLAME_VIBRANCY, vibrancy),
      ),
    },
  };
}

/**
 * Set the flame render's supersample factor, rounded to the nearest integer
 * and clamped to a sane range. Unlike gamma/vibrancy/exposure this is NOT
 * live-reactive: it changes the accumulated histogram's dimensions, so
 * `main.ts` restarts accumulation from scratch when this actually changes.
 */
export function setFlameSupersample(
  state: AppState,
  supersample: number,
): AppState {
  return {
    ...state,
    flame: {
      ...state.flame,
      supersample: Math.round(
        Math.max(
          MIN_FLAME_SUPERSAMPLE,
          Math.min(MAX_FLAME_SUPERSAMPLE, supersample),
        ),
      ),
    },
  };
}

/** Enter or exit the flame render-current-view overlay (session-only). */
export function setFlameActive(
  state: AppState,
  flameActive: boolean,
): AppState {
  return { ...state, flameActive };
}
