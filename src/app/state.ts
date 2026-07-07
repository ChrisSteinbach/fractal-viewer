import { isFlatTransform, systemIsFlat } from "../fractal/affine4";
import { appendTransform, defaultTransforms } from "../fractal/presets";
import type { FlamePaletteId } from "../fractal/palette";
import type { Rng } from "../fractal/rng";
import type {
  ColorMode,
  FourDColorMode,
  SymmetryAxis,
  SymmetryParams,
  Transform,
} from "../fractal/types";
import { VOXEL_RESOLUTION_STEP } from "../fractal/voxel";

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
 * Settings for the solid render (fr-v4f; `src/fractal/voxel.ts` + the GPU
 * raymarcher in `scene.ts`). Persists as a render-settings block like
 * {@link FlameParams}, independent of whether a render is active.
 */
export interface SolidParams {
  /**
   * Voxels per axis of the density grid. Memory and detail are O(n^3), so
   * this is stepped in multiples of `VOXEL_RESOLUTION_STEP`; changing it
   * restarts accumulation (the grid's dimensions change, nothing to keep).
   */
  resolution: number;
  /** Total chaos-game iterations to accumulate before the grid is "done". */
  iterations: number;
  /**
   * Isosurface level on the log-normalized density in [0, 1]: lower carves
   * the surface out of fainter density (bulkier, noisier), higher keeps only
   * the hottest structure (thinner, crisper). A GPU uniform — live-reactive
   * at full frame rate, never re-accumulates.
   */
  threshold: number;
  /** Light's horizontal angle in degrees. Live-reactive like `threshold`. */
  lightAzimuth: number;
  /** Light's height above the horizon in degrees. Live-reactive. */
  lightElevation: number;
  /** Fill-light floor in [0, 1]: how bright fully shadowed/occluded surfaces
   * stay. Live-reactive. */
  ambient: number;
  /**
   * Structural-coloring palette (fr-1kt; shares fr-6us's `FlamePaletteId`
   * enum — see `palette.ts`). `"legacy"` (the default) keeps the existing
   * colorMode-driven coloring (fr-c1d), so existing scenes/renders are
   * unchanged; a cosine-gradient id paints continuous color along the orbit
   * instead, overriding colorMode entirely. Changing it restarts
   * accumulation — the accumulated avgRGB bakes in the palette, so there is
   * nothing to keep (see `main.ts`).
   */
  paletteId: FlamePaletteId;
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
  /**
   * How the 4D projection view colors points (fr-d47): a diverging signed-w
   * palette or a baked structural mode — see `fractal/types.ts`'s
   * {@link FourDColorMode} and `color.ts`'s `buildColors4`. Persists like
   * `colorMode` / `renderStyle` (NOT session-only, unlike the tumble/slice
   * view state), and is simply inert while the system is flat — exactly as
   * `colorMode` is inert while it is non-flat.
   */
  fourDColor: FourDColorMode;
  /**
   * Camera-depth fade for the 4D projection view (fr-3e0): dim each point's
   * additive contribution with camera distance, restoring the camera-z cue
   * the 4D path otherwise lacks (the 3D "Depth Style" never reaches it — see
   * `scene.ts`'s render()/setRenderStyle guards). Opt-in (default off)
   * because the 4D shader already spends luminance on |w| — dim gray means
   * "near our 3-space" — so a distance fade makes dimness ambiguous; its
   * value is stills (PNG capture / paused video), where motion parallax
   * can't disambiguate depth. A look preference, so it persists like
   * `fourDColor` (NOT session-only, unlike the tumble/slice view state) and
   * is simply inert while the system is flat.
   */
  fourDDepthFade: boolean;
  /**
   * Contrast exponent applied to the normalized coordinate in the
   * height/radius/position color modes (fr-8sk, see `color.ts`'s
   * `colorModeUsesGamma`): `t' = t ** colorGamma`. `1` = linear (today's
   * mapping, unreshaped). Persists like `colorMode` / `renderStyle` /
   * `glowBrightness` — not session-only.
   */
  colorGamma: number;
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
  /** Solid render settings; persists independent of {@link solidActive}. */
  solid: SolidParams;
  /**
   * Whether the solid (lit voxel) render is showing in place of the live
   * point cloud. Session-only and never persisted, exactly like
   * {@link flameActive} — the app always boots into the explorer.
   */
  solidActive: boolean;
  /**
   * Rotational/mirror symmetry (fr-6im): replicate `transforms` into rotated
   * copies for every render — see `fractal/types.ts`'s `SymmetryParams`.
   * Unlike {@link flameActive} / {@link solidActive} this is NOT session-only:
   * it persists like `colorMode` / `renderStyle`, and it shapes the live
   * explorer's point cloud too, not just the flame/solid renders — `main.ts`'s
   * `regenerate()` threads it into `runChaosGame`.
   */
  symmetry: SymmetryParams;
  /**
   * Manual brightness multiplier for the glow render style (fr-8b1):
   * multiplies the density-adaptive auto-exposure every frame (see
   * `main.ts`'s `animate` and `exposure.ts`'s `glowExposure`). Persists like
   * `colorMode` / `renderStyle` / `symmetry` — not session-only, and not
   * nested under a render-settings block like `flame` / `solid` since it has
   * no other fields.
   */
  glowBrightness: number;
}

/** An IFS needs at least one map. */
export const MIN_TRANSFORMS = 1;
export const DEFAULT_NUM_POINTS = 100_000;
export const MAX_NUM_POINTS = 5_000_000;
export const MIN_NUM_POINTS = 1_000;
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
/**
 * GPU accumulation (fr-npb) measured ~10G iterations/sec on discrete GPUs
 * (fr-53k addendum), so billion-iteration budgets are now interactive rather
 * than the multi-minute CPU wait they used to imply — this ceiling was raised
 * from the CPU-era 100M accordingly (fr-79p). 2B stays under 2^31, so the
 * value is int32-safe everywhere (worker messages, GPU dispatch counts, etc.)
 * without needing a separate "GPU mode" ceiling.
 */
export const MAX_FLAME_ITERATIONS = 2_000_000_000;
/**
 * Detents for the flame Quality slider (fr-79p; `index.html`'s
 * `flameIterationsSlider`), which carries a detent INDEX rather than a raw
 * iteration count — see {@link nearestFlameIterationDetentIndex}. A linear,
 * 1M-step slider spanning [{@link MIN_FLAME_ITERATIONS},
 * {@link MAX_FLAME_ITERATIONS}] would squeeze the entire CPU-practical range
 * (1-100M) into the first ~5% of the slider's travel, since the GPU-practical
 * range now reaches all the way to 2B. A 1-2-5 preferred-number series (the
 * same progression multimeter dials and camera apertures use) instead keeps
 * every decade reachable in the same handful of detents, so both a CPU user
 * dialing in ~20M and a GPU user dialing in ~2B get comparably fine control.
 *
 * First entry equals {@link MIN_FLAME_ITERATIONS}, last equals
 * {@link MAX_FLAME_ITERATIONS}; {@link DEFAULT_FLAME_ITERATIONS} (20M) is
 * `FLAME_ITERATION_DETENTS[4]` — `index.html`'s slider hardcodes that index as
 * its default `value`, guarded by a state.test.ts assertion so the two can
 * never silently drift apart.
 */
export const FLAME_ITERATION_DETENTS = [
  1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000,
  100_000_000, 200_000_000, 500_000_000, 1_000_000_000, 2_000_000_000,
] as const;

/**
 * Index of the {@link FLAME_ITERATION_DETENTS} entry closest to `iterations`
 * in LOG space (comparing `|log(iterations) - log(detent)|`, not the raw
 * difference) — log space is what makes a 1-2-5 series feel evenly spaced
 * along the slider, so "nearest" has to be measured the same way an equal
 * step of slider travel is: multiplicatively. Out-of-range input falls out
 * naturally to the first/last index (the nearest detent in log-distance to
 * anything below {@link MIN_FLAME_ITERATIONS} is always the smallest detent,
 * and symmetrically for anything above {@link MAX_FLAME_ITERATIONS}), so
 * there's no separate clamp step.
 *
 * A persisted or shared scene can carry a non-detent value (e.g. an old
 * scene's 37M, from before this slider existed) — `state.flame.iterations`
 * keeps that exact value; only the slider's displayed thumb position snaps to
 * the nearest detent (see `ui.ts`'s `updateLabels`), and the exact value
 * survives until the user actually moves the slider.
 *
 * Non-finite or non-positive input cannot reach this function in practice:
 * every caller clamps through {@link setFlameIterations} first, which pins to
 * [{@link MIN_FLAME_ITERATIONS}, {@link MAX_FLAME_ITERATIONS}] before this
 * ever runs — so, unlike the setters below, this does not defend against
 * `NaN`/`Infinity`/`<= 0`.
 */
export function nearestFlameIterationDetentIndex(iterations: number): number {
  const target = Math.log(iterations);
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < FLAME_ITERATION_DETENTS.length; i++) {
    const distance = Math.abs(target - Math.log(FLAME_ITERATION_DETENTS[i]));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}
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
 * does not prevent an OOM on a hi-DPI display; the flame worker's
 * device-aware byte-budget guard does that (see `flame-worker-core.ts`'s
 * `flameAccumBudgetBuckets` + `clampSupersampleToBudget`).
 */
export const MAX_FLAME_SUPERSAMPLE = 3;
/**
 * Defaults for the adaptive density-estimation blur (fr-17t; see
 * `flame.ts`'s `DensityEstimatorParams`). estimatorCurve's range and default
 * follow that type's doc ("flam3-ish values sit around 0.3-0.6"); the MIN is
 * a small positive floor, not 0 — `count ** 0` is 1 regardless of count,
 * which would pin every cell at the widest radius and make the whole
 * "adaptive" part of the pass inert.
 */
export const DEFAULT_ESTIMATOR_RADIUS = 6;
export const MIN_ESTIMATOR_RADIUS = 1;
export const MAX_ESTIMATOR_RADIUS = 15;
/** 0 = pin-sharp where well-sampled, flam3's usual choice and this app's default. */
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
 * Solid render (fr-v4f) defaults and ranges. 192^3 is the detail/memory
 * sweet spot (a 256^3 grid is ~2.4x the memory and allocation risk for a
 * modest sharpness gain); the worker's own byte budget may still clamp the
 * top of this range on constrained devices (see `voxel-worker-core.ts`).
 *
 * The ceiling (512) matches the desktop budget ceiling (fr-8x7): 512^3 x 20
 * bytes/voxel = 2.5 GiB, exactly `voxelAccumBudgetVoxels`'s
 * `VOXEL_ACCUM_MAX_BYTES` in `voxel-worker-core.ts`, so a desktop reporting
 * (or assumed to have, per that function) 8+ GiB can run the slider's full
 * range untouched. Weaker devices asking for more than their own budget are
 * proactively clamped by the worker (`clampVoxelResolution`) and shown the
 * "Reduced to N³" note (`resolutionNote`).
 */
export const DEFAULT_SOLID_RESOLUTION = 192;
export const MIN_SOLID_RESOLUTION = 64;
export const MAX_SOLID_RESOLUTION = 512;
/** Same iteration economics as the flame: the grid has a comparable bucket
 * count to a 2D histogram, so the same default converges similarly fast. */
export const DEFAULT_SOLID_ITERATIONS = 20_000_000;
export const MIN_SOLID_ITERATIONS = 1_000_000;
export const MAX_SOLID_ITERATIONS = 100_000_000;
/** Low enough that mid-density structure survives, high enough that a lone
 * stray hit doesn't read as a solid floating speck. */
export const DEFAULT_SOLID_THRESHOLD = 0.3;
export const MIN_SOLID_THRESHOLD = 0.02;
export const MAX_SOLID_THRESHOLD = 0.95;
export const DEFAULT_SOLID_LIGHT_AZIMUTH = 135;
export const MIN_SOLID_LIGHT_AZIMUTH = -180;
export const MAX_SOLID_LIGHT_AZIMUTH = 180;
/** Elevation floors at 5° (not 0°): a perfectly horizontal light makes the
 * shadow ray graze the whole volume and everything reads as shadowed. */
export const DEFAULT_SOLID_LIGHT_ELEVATION = 50;
export const MIN_SOLID_LIGHT_ELEVATION = 5;
export const MAX_SOLID_LIGHT_ELEVATION = 85;
/** Capped at 0.8, not 1: full ambient would erase the diffuse term (and with
 * it every cue this mode exists to provide). */
export const DEFAULT_SOLID_AMBIENT = 0.25;
export const MIN_SOLID_AMBIENT = 0;
export const MAX_SOLID_AMBIENT = 0.8;
/**
 * Default solid-render palette. `"legacy"` is the colorMode-driven coloring
 * that predates this feature (fr-1kt), so a scene that predates it (or a
 * fresh one) renders exactly as before until the user picks a gradient
 * palette.
 */
export const DEFAULT_SOLID_PALETTE: FlamePaletteId = "legacy";
/** 1 = off: today's unreplicated system, unchanged until symmetry is turned on. */
export const DEFAULT_SYMMETRY_ORDER = 1;
export const MIN_SYMMETRY_ORDER = 1;
/**
 * Deliberately WIDER than the UI slider will expose (the slider caps at 9,
 * a practical range) — 12 is the ceiling because `effectiveSymmetryOrder` in
 * `chaos-game.ts` already clamps the actually-used order down to fit
 * `MAX_TRANSFORMS` (256), and 12 is exactly enough for e.g. a 20-map preset's
 * 12-fold symmetry (20*12=240<=256) without silently losing a value a shared
 * URL might carry. So this stored/persisted value has its own, more generous
 * ceiling than the slider widget does.
 */
export const MAX_SYMMETRY_ORDER = 12;
export const DEFAULT_SYMMETRY_AXIS: SymmetryAxis = "y";
/**
 * Manual brightness multiplier for the glow render style (fr-8b1), applied on
 * top of the density-adaptive auto-exposure computed every frame in
 * `main.ts` (see `exposure.ts`'s `glowExposure`). Local density can vary by
 * orders of magnitude in ways that the coarse, average-density estimate can't
 * see, so this is the user's manual override; 1 = neutral (auto-exposure
 * alone, unchanged).
 */
export const DEFAULT_GLOW_BRIGHTNESS = 1;
export const MIN_GLOW_BRIGHTNESS = 0.1;
export const MAX_GLOW_BRIGHTNESS = 3;
/**
 * Color-contrast exponent (fr-8sk) defaults and range — see
 * `AppState.colorGamma`. `1` is neutral (today's linear mapping).
 * Log-symmetric around 1 (`MIN_COLOR_GAMMA === 1 / MAX_COLOR_GAMMA`) so the
 * UI's log-scale slider puts neutral exactly at its center; 5 is generous
 * enough to sharply favor either end of a coordinate's range without ever
 * fully collapsing the other end to a single color.
 */
export const DEFAULT_COLOR_GAMMA = 1;
export const MIN_COLOR_GAMMA = 0.2;
export const MAX_COLOR_GAMMA = 5;
/**
 * Default 4D color mode (fr-d47): the original diverging blue/orange w
 * ramp, so pre-existing scenes (whose links never carried the field) render
 * exactly as before this option existed.
 */
export const DEFAULT_FOUR_D_COLOR: FourDColorMode = "wBlueOrange";
/**
 * 4D per-map extension (fr-cbg spike) ranges — see `fractal/types.ts`'s
 * `WExtension`. Nothing in THIS module uses them yet: `persist.ts` imports
 * them now to clamp `w` fields on decode, and the upcoming single-editor task
 * will import these same constants for its own sliders, so the wire format
 * and the widget that edits it share one source and can never drift apart.
 *
 * `MIN`/`MAX_W_POSITION`, `_SCALE`, and `_ANGLE` are the retired 4D per-map
 * editor's slider ranges (`index.html`'s `fourDPosWSlider`/`fourDScaleWSlider`
 * /`fourDRotXWSlider` (`YW`/`ZW`)): position ±1.5, scale 0.05-1.5, and the
 * three w-mixing plane angles ±180° — stored here in radians (±π), matching
 * how every other angle in this codebase is represented once off a slider.
 * `MIN`/`MAX_W_SHEAR` has no retired slider to inherit from, so it instead
 * matches the 3D shear channel's own range (`ui.ts`'s `CHANNELS.shear`, ±2).
 */
export const MIN_W_POSITION = -1.5;
export const MAX_W_POSITION = 1.5;
export const MIN_W_SCALE = 0.05;
export const MAX_W_SCALE = 1.5;
export const MIN_W_ANGLE = -Math.PI;
export const MAX_W_ANGLE = Math.PI;
export const MIN_W_SHEAR = -2;
export const MAX_W_SHEAR = 2;

export function initialState(panelOpen: boolean): AppState {
  return {
    transforms: defaultTransforms(),
    numPoints: DEFAULT_NUM_POINTS,
    pointSize: DEFAULT_POINT_SIZE,
    selectedTransform: null,
    showGuides: true,
    colorMode: "transform",
    colorGamma: DEFAULT_COLOR_GAMMA,
    fourDColor: DEFAULT_FOUR_D_COLOR,
    fourDDepthFade: false,
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
    solid: {
      resolution: DEFAULT_SOLID_RESOLUTION,
      iterations: DEFAULT_SOLID_ITERATIONS,
      threshold: DEFAULT_SOLID_THRESHOLD,
      lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
      lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
      ambient: DEFAULT_SOLID_AMBIENT,
      paletteId: DEFAULT_SOLID_PALETTE,
    },
    solidActive: false,
    symmetry: { order: DEFAULT_SYMMETRY_ORDER, axis: DEFAULT_SYMMETRY_AXIS },
    glowBrightness: DEFAULT_GLOW_BRIGHTNESS,
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

/**
 * Update a single transform's geometry, preserving its id. A plain object
 * spread over the patch: every field genuinely PRESENT on `geometry`
 * replaces the transform's own, including `w` (the optional 4D extension,
 * fr-bf6.3 — see `WExtension`'s docs). The single editor (`ui.ts`) always
 * emits every other field but includes `w` only when its own working copy is
 * non-empty, so an ordinary edit that never touched the 4D group carries no
 * `w` key at all — this spread then leaves an existing `w` block untouched.
 * Full replacement, never a field-by-field merge, happens only when the
 * caller actually supplies a `w`.
 */
export function updateTransform(
  state: AppState,
  index: number,
  geometry: Pick<
    Transform,
    "position" | "rotation" | "scale" | "weight" | "shear" | "variations" | "w"
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

/**
 * Set how the 4D projection colors points (fr-d47). Not clamped — it is an
 * enum (see `fractal/types.ts`'s `FourDColorMode`), and the UI only offers
 * valid values (persistence validates untrusted input in `decodeScene`), like
 * {@link setSymmetryAxis}.
 */
export function setFourDColor(
  state: AppState,
  fourDColor: FourDColorMode,
): AppState {
  return { ...state, fourDColor };
}

/** Toggle the 4D projection's camera-depth fade (fr-3e0) — see
 * {@link AppState.fourDDepthFade}. */
export function setFourDDepthFade(
  state: AppState,
  fourDDepthFade: boolean,
): AppState {
  return { ...state, fourDDepthFade };
}

/**
 * Set the color-contrast exponent, clamped to a sane range. Reshapes the
 * height/radius/position color modes' normalized-coordinate mapping (see
 * `color.ts`'s `buildColors`); meaningless for `"transform"`/`"uniform"`, but
 * stored regardless so it's ready the moment the user switches back to a
 * mode it applies to.
 */
export function setColorGamma(state: AppState, colorGamma: number): AppState {
  return {
    ...state,
    colorGamma: Math.max(
      MIN_COLOR_GAMMA,
      Math.min(MAX_COLOR_GAMMA, colorGamma),
    ),
  };
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

/**
 * Set the solid render's grid resolution, snapped to the voxel step and
 * clamped to a sane range. Like {@link setFlameSupersample} this is NOT
 * live-reactive: it changes the grid's dimensions, so `main.ts` restarts
 * accumulation when it actually changes.
 */
export function setSolidResolution(
  state: AppState,
  resolution: number,
): AppState {
  const snapped =
    Math.round(resolution / VOXEL_RESOLUTION_STEP) * VOXEL_RESOLUTION_STEP;
  return {
    ...state,
    solid: {
      ...state.solid,
      resolution: Math.max(
        MIN_SOLID_RESOLUTION,
        Math.min(MAX_SOLID_RESOLUTION, snapped),
      ),
    },
  };
}

/**
 * Set the solid render's iteration budget, clamped to a sane range. Live-
 * reactive exactly like {@link setFlameIterations}: raising it mid-render
 * lets accumulation continue past what had looked "done".
 */
export function setSolidIterations(
  state: AppState,
  iterations: number,
): AppState {
  return {
    ...state,
    solid: {
      ...state.solid,
      iterations: Math.round(
        Math.max(
          MIN_SOLID_ITERATIONS,
          Math.min(MAX_SOLID_ITERATIONS, iterations),
        ),
      ),
    },
  };
}

/** Set the solid render's isosurface level, clamped to a sane range. A GPU
 * uniform — live-reactive at full frame rate, never re-accumulates. */
export function setSolidThreshold(
  state: AppState,
  threshold: number,
): AppState {
  return {
    ...state,
    solid: {
      ...state.solid,
      threshold: Math.max(
        MIN_SOLID_THRESHOLD,
        Math.min(MAX_SOLID_THRESHOLD, threshold),
      ),
    },
  };
}

/** Set the light's horizontal angle (degrees), clamped. Live-reactive like
 * {@link setSolidThreshold}. */
export function setSolidLightAzimuth(
  state: AppState,
  lightAzimuth: number,
): AppState {
  return {
    ...state,
    solid: {
      ...state.solid,
      lightAzimuth: Math.max(
        MIN_SOLID_LIGHT_AZIMUTH,
        Math.min(MAX_SOLID_LIGHT_AZIMUTH, lightAzimuth),
      ),
    },
  };
}

/** Set the light's height above the horizon (degrees), clamped. Live-reactive
 * like {@link setSolidThreshold}. */
export function setSolidLightElevation(
  state: AppState,
  lightElevation: number,
): AppState {
  return {
    ...state,
    solid: {
      ...state.solid,
      lightElevation: Math.max(
        MIN_SOLID_LIGHT_ELEVATION,
        Math.min(MAX_SOLID_LIGHT_ELEVATION, lightElevation),
      ),
    },
  };
}

/** Set the solid render's fill-light floor, clamped. Live-reactive like
 * {@link setSolidThreshold}. */
export function setSolidAmbient(state: AppState, ambient: number): AppState {
  return {
    ...state,
    solid: {
      ...state.solid,
      ambient: Math.max(
        MIN_SOLID_AMBIENT,
        Math.min(MAX_SOLID_AMBIENT, ambient),
      ),
    },
  };
}

/**
 * Set the solid render's structural-coloring palette. Not clamped — it is an
 * enum (see `palette.ts`), and the UI only offers valid ids (persistence
 * validates untrusted input in `decodeScene`). Restarts accumulation in the
 * worker when it changes; see `main.ts`.
 */
export function setSolidPaletteId(
  state: AppState,
  paletteId: FlamePaletteId,
): AppState {
  return { ...state, solid: { ...state.solid, paletteId } };
}

/** Enter or exit the solid render (session-only, like {@link setFlameActive}). */
export function setSolidActive(
  state: AppState,
  solidActive: boolean,
): AppState {
  return { ...state, solidActive };
}

/**
 * Whether the CURRENT system needs the 4D projection view — the derived
 * condition (fr-bf6) that makes "4D" a property of `state.transforms` /
 * `state.finalTransform` rather than a separate mode the user enters/exits
 * (see `affine4.ts`'s `systemIsFlat`/`isFlatTransform`, the underlying
 * flatness predicates). The final transform counts only per its own enabled
 * semantics: a disabled lens (`finalTransform` undefined) never makes an
 * otherwise-flat system non-flat, but an enabled one is checked exactly like
 * any numbered transform.
 *
 * `main.ts`'s `regenerate()` calls this once per generation and caches the
 * result (its `viewIs4D`) rather than re-deriving it in every per-frame or
 * per-pointer-move read; `ui.ts`'s `updateLabels` calls it directly instead
 * (it runs far less often), then passes the one result on to `updateLegend`.
 * Either way there is exactly one formula, so the routing decision, the
 * panel's gating, and the legend can never drift apart.
 */
export function systemIsNonFlat(state: AppState): boolean {
  return (
    !systemIsFlat(state.transforms) ||
    (state.finalTransform !== undefined &&
      !isFlatTransform(state.finalTransform))
  );
}

/**
 * Set the kaleidoscope's replica count, rounded to the nearest integer and
 * clamped to a sane range, exactly like {@link setFlameSupersample}. Persists
 * and reshapes the live explorer's point cloud as well as the flame/solid
 * renders — see {@link AppState.symmetry}.
 */
export function setSymmetryOrder(state: AppState, order: number): AppState {
  return {
    ...state,
    symmetry: {
      ...state.symmetry,
      order: Math.round(
        Math.max(MIN_SYMMETRY_ORDER, Math.min(MAX_SYMMETRY_ORDER, order)),
      ),
    },
  };
}

/**
 * Set the axis the kaleidoscope's copies rotate about. Not clamped — it is
 * an enum (see `fractal/types.ts`'s `SymmetryAxis`), and the UI only offers
 * valid values (persistence validates untrusted input in `decodeScene`), like
 * {@link setFlamePaletteId}.
 */
export function setSymmetryAxis(state: AppState, axis: SymmetryAxis): AppState {
  return { ...state, symmetry: { ...state.symmetry, axis } };
}

/**
 * Set the glow render's manual brightness override, clamped to a sane range.
 * Multiplies the density-adaptive auto-exposure every frame (see
 * `main.ts`'s `animate` and `exposure.ts`'s `glowExposure`) rather than
 * replacing it, so the auto-exposure's coarse density compensation and this
 * slider's fine manual control combine.
 */
export function setGlowBrightness(
  state: AppState,
  glowBrightness: number,
): AppState {
  return {
    ...state,
    glowBrightness: Math.max(
      MIN_GLOW_BRIGHTNESS,
      Math.min(MAX_GLOW_BRIGHTNESS, glowBrightness),
    ),
  };
}
