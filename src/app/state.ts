import { appendTransform, defaultTransforms } from "../fractal/presets";
import type { FlamePaletteId } from "../fractal/palette";
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
  /**
   * Widest per-cell blur radius (output pixels), used for near-zero-density
   * cells — see `flame.ts`'s `DensityEstimatorParams.estimatorRadius`. Only
   * ever applied to the finished/paused frame (the adaptive pass is too
   * costly to run on every progressive preview); a change while a render is
   * still accumulating takes effect once it finishes, and re-runs just that
   * pass (not a re-accumulate) if it already had.
   */
  estimatorRadius: number;
  /** Narrowest per-cell blur radius, used for fully-sampled cells; 0 leaves
   * them pin-sharp. Live-reactive like `estimatorRadius`. */
  estimatorMinimumRadius: number;
  /** Shapes how quickly the radius narrows as density rises — see
   * `flame.ts`'s `DensityEstimatorParams.estimatorCurve`. Live-reactive like
   * `estimatorRadius`. */
  estimatorCurve: number;
  /**
   * Structural-coloring palette (fr-6us; see `palette.ts`). `"legacy"` (the
   * default) keeps the original per-transform-hue coloring, so existing
   * scenes/renders are unchanged; a cosine-gradient id paints continuous color
   * along the orbit. Changing it restarts accumulation — the accumulated color
   * sums bake in the palette, so there is nothing to keep (see `main.ts`).
   */
  paletteId: FlamePaletteId;
}

/**
 * Settings for the raymarching distance-estimator renderer (fr-yor; the GPU
 * shader lives in `src/app/raymarch-material.ts`, the CPU reference DE in
 * `src/fractal/raymarch.ts`). Persists as a render setting like {@link
 * FlameParams}, independent of whether a raymarch render is currently active
 * (see {@link AppState.raymarchActive}). Unlike the flame renderer these are
 * all live-reactive: the shader re-evaluates the whole field every frame, so
 * changing any of them just re-renders — there is no accumulation to restart.
 */
export interface RaymarchParams {
  /**
   * Mandelbulb exponent (White & Nylander's power-`n` formula). 8 is the
   * classic look; lower powers give blobbier bulbs, higher ones more lobes.
   */
  power: number;
  /**
   * Escape-time iteration budget for the distance estimate — how deep the
   * fractal detail is resolved before a point is taken to be inside the set.
   * Higher is crisper but costlier per ray step.
   */
  iterations: number;
  /**
   * Maximum sphere-tracing steps per primary ray before giving up (a miss).
   * Higher lets grazing rays resolve fine silhouettes at the cost of speed.
   */
  maxSteps: number;
  /** Far cutoff: a ray that marches past this world distance is a miss (sky). */
  maxDistance: number;
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
  /** Raymarch render settings; persists independent of {@link raymarchActive}. */
  raymarch: RaymarchParams;
  /**
   * Whether the raymarch render overlay is showing (in place of the live point
   * cloud). Session-only like {@link flameActive} — never persisted, so the
   * app always boots into the explorer.
   */
  raymarchActive: boolean;
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
/**
 * A moderately "punchy" default — MIN_FLAME_GAMMA (1) is the neutral point
 * that leaves fr-o7s's original log-density curve unreshaped; 2.4 pushes
 * faint/sparse detail brighter, the classic flame look (see TonemapParams.gamma).
 */
export const DEFAULT_FLAME_GAMMA = 2.4;
export const MIN_FLAME_GAMMA = 1;
export const MAX_FLAME_GAMMA = 6;
/** Fully density-scaled color — today's look, before vibrancy existed. */
export const DEFAULT_FLAME_VIBRANCY = 1;
export const MIN_FLAME_VIBRANCY = 0;
export const MAX_FLAME_VIBRANCY = 1;
/** A modest 2x2 antialiasing oversample — MIN_FLAME_SUPERSAMPLE (1) is what
 * "no supersampling, accumulate straight at display resolution" means. */
export const DEFAULT_FLAME_SUPERSAMPLE = 2;
export const MIN_FLAME_SUPERSAMPLE = 1;
/**
 * Memory is O(supersample^2): a Float64 hits + Float64x3 sumRGB bucket is 32
 * bytes, so 3x at a 1920x1080 accumulation target is already ~597 MB — and
 * that target can be considerably larger than the CSS window size, since
 * `flameRenderSize()` returns the devicePixelRatio-scaled drawing buffer
 * (scene.ts caps the ratio at 2x, so a "1080p" *window* can already mean a
 * ~2160p buffer *before* supersample multiplies it again). This cap alone
 * does not prevent an OOM on a hi-DPI display; see `main.ts`'s
 * `clampSupersampleToBudget` use for the byte-budget guard that does.
 */
export const MAX_FLAME_SUPERSAMPLE = 3;
/**
 * Defaults for the adaptive density-estimation blur (fr-17t; see
 * `flame.ts`'s `DensityEstimatorParams`). estimatorCurve's range and default
 * follow that type's doc ("flam3-ish values sit around 0.3-0.6"); the MIN is
 * a small positive floor, not 0 — `(1 - density) ** 0` is 1 regardless of
 * density, which would make the whole "adaptive" part of the pass inert.
 */
export const DEFAULT_ESTIMATOR_RADIUS = 6;
export const MIN_ESTIMATOR_RADIUS = 1;
export const MAX_ESTIMATOR_RADIUS = 15;
/** 0 = pin-sharp at full density, flam3's usual choice and this app's default. */
export const DEFAULT_ESTIMATOR_MINIMUM_RADIUS = 0;
export const MIN_ESTIMATOR_MINIMUM_RADIUS = 0;
export const MAX_ESTIMATOR_MINIMUM_RADIUS = 15;
export const DEFAULT_ESTIMATOR_CURVE = 0.4;
export const MIN_ESTIMATOR_CURVE = 0.1;
export const MAX_ESTIMATOR_CURVE = 3;
/**
 * Default flame palette. `"legacy"` is the pre-fr-6us per-transform-hue
 * coloring, so a scene that predates this feature (or a fresh one) renders
 * exactly as before until the user picks a gradient palette.
 */
export const DEFAULT_FLAME_PALETTE: FlamePaletteId = "legacy";

/**
 * Raymarch defaults + clamps (fr-yor). Power 8 is the canonical Mandelbulb.
 * The rest trade quality for frame rate: the defaults are tuned for a smooth
 * look on a mid-range GPU, and the clamps bound both the shader's fixed loop
 * counts (`maxSteps`, `iterations`) and how far a ray can wander
 * (`maxDistance`).
 */
export const DEFAULT_RAYMARCH_POWER = 8;
export const MIN_RAYMARCH_POWER = 2;
export const MAX_RAYMARCH_POWER = 16;
export const DEFAULT_RAYMARCH_ITERATIONS = 8;
export const MIN_RAYMARCH_ITERATIONS = 1;
export const MAX_RAYMARCH_ITERATIONS = 20;
export const DEFAULT_RAYMARCH_MAX_STEPS = 96;
export const MIN_RAYMARCH_MAX_STEPS = 16;
export const MAX_RAYMARCH_MAX_STEPS = 256;
export const DEFAULT_RAYMARCH_MAX_DISTANCE = 12;
export const MIN_RAYMARCH_MAX_DISTANCE = 2;
export const MAX_RAYMARCH_MAX_DISTANCE = 40;

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
      estimatorRadius: DEFAULT_ESTIMATOR_RADIUS,
      estimatorMinimumRadius: DEFAULT_ESTIMATOR_MINIMUM_RADIUS,
      estimatorCurve: DEFAULT_ESTIMATOR_CURVE,
      paletteId: DEFAULT_FLAME_PALETTE,
    },
    flameActive: false,
    raymarch: {
      power: DEFAULT_RAYMARCH_POWER,
      iterations: DEFAULT_RAYMARCH_ITERATIONS,
      maxSteps: DEFAULT_RAYMARCH_MAX_STEPS,
      maxDistance: DEFAULT_RAYMARCH_MAX_DISTANCE,
    },
    raymarchActive: false,
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

/**
 * Set the flame render's widest adaptive-blur radius, clamped to a sane
 * range. Live-reactive, but only in the sense `main.ts` re-runs the
 * (done-frame-only) adaptive pass against the existing accumulation when the
 * render has already finished — like gamma/vibrancy it never re-accumulates.
 */
export function setFlameEstimatorRadius(
  state: AppState,
  estimatorRadius: number,
): AppState {
  return {
    ...state,
    flame: {
      ...state.flame,
      estimatorRadius: Math.max(
        MIN_ESTIMATOR_RADIUS,
        Math.min(MAX_ESTIMATOR_RADIUS, estimatorRadius),
      ),
    },
  };
}

/** Set the flame render's narrowest adaptive-blur radius, clamped to a sane
 * range. Live-reactive like {@link setFlameEstimatorRadius}. */
export function setFlameEstimatorMinimumRadius(
  state: AppState,
  estimatorMinimumRadius: number,
): AppState {
  return {
    ...state,
    flame: {
      ...state.flame,
      estimatorMinimumRadius: Math.max(
        MIN_ESTIMATOR_MINIMUM_RADIUS,
        Math.min(MAX_ESTIMATOR_MINIMUM_RADIUS, estimatorMinimumRadius),
      ),
    },
  };
}

/** Set the flame render's adaptive-blur falloff curve, clamped to a sane
 * range. Live-reactive like {@link setFlameEstimatorRadius}. */
export function setFlameEstimatorCurve(
  state: AppState,
  estimatorCurve: number,
): AppState {
  return {
    ...state,
    flame: {
      ...state.flame,
      estimatorCurve: Math.max(
        MIN_ESTIMATOR_CURVE,
        Math.min(MAX_ESTIMATOR_CURVE, estimatorCurve),
      ),
    },
  };
}

/**
 * Set the flame render's structural-coloring palette. Not clamped — it is an
 * enum (see `palette.ts`), and the UI only offers valid ids (persistence
 * validates untrusted input in `decodeScene`). Restarts accumulation in the
 * worker when it changes; see `main.ts`.
 */
export function setFlamePaletteId(
  state: AppState,
  paletteId: FlamePaletteId,
): AppState {
  return { ...state, flame: { ...state.flame, paletteId } };
}

/** Enter or exit the flame render-current-view overlay (session-only). */
export function setFlameActive(
  state: AppState,
  flameActive: boolean,
): AppState {
  return { ...state, flameActive };
}

/** Set the Mandelbulb power, clamped to a sane range. Live-reactive: the
 * raymarch shader re-evaluates the field every frame, so no restart is needed. */
export function setRaymarchPower(state: AppState, power: number): AppState {
  return {
    ...state,
    raymarch: {
      ...state.raymarch,
      power: Math.max(MIN_RAYMARCH_POWER, Math.min(MAX_RAYMARCH_POWER, power)),
    },
  };
}

/** Set the DE escape-time iteration budget, rounded to an integer and clamped
 * (it drives a fixed GLSL loop). Live-reactive like {@link setRaymarchPower}. */
export function setRaymarchIterations(
  state: AppState,
  iterations: number,
): AppState {
  return {
    ...state,
    raymarch: {
      ...state.raymarch,
      iterations: Math.round(
        Math.max(
          MIN_RAYMARCH_ITERATIONS,
          Math.min(MAX_RAYMARCH_ITERATIONS, iterations),
        ),
      ),
    },
  };
}

/** Set the max sphere-tracing steps per ray, rounded to an integer and clamped
 * (it drives a fixed GLSL loop). Live-reactive like {@link setRaymarchPower}. */
export function setRaymarchMaxSteps(
  state: AppState,
  maxSteps: number,
): AppState {
  return {
    ...state,
    raymarch: {
      ...state.raymarch,
      maxSteps: Math.round(
        Math.max(
          MIN_RAYMARCH_MAX_STEPS,
          Math.min(MAX_RAYMARCH_MAX_STEPS, maxSteps),
        ),
      ),
    },
  };
}

/** Set the ray far cutoff, clamped to a sane range. Live-reactive like
 * {@link setRaymarchPower}. */
export function setRaymarchMaxDistance(
  state: AppState,
  maxDistance: number,
): AppState {
  return {
    ...state,
    raymarch: {
      ...state.raymarch,
      maxDistance: Math.max(
        MIN_RAYMARCH_MAX_DISTANCE,
        Math.min(MAX_RAYMARCH_MAX_DISTANCE, maxDistance),
      ),
    },
  };
}

/** Enter or exit the raymarch render overlay (session-only). */
export function setRaymarchActive(
  state: AppState,
  raymarchActive: boolean,
): AppState {
  return { ...state, raymarchActive };
}
