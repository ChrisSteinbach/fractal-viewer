import { isFlatTransform, systemIsFlat } from "../fractal/affine4";
import { appendTransform, defaultTransforms } from "../fractal/presets";
import { isLegacyPositionAxisColors } from "../fractal/color";
import type { PositionAxisColors } from "../fractal/color";
import {
  CUSTOM_PALETTE_ID,
  MAX_CUSTOM_PALETTE_STOPS,
  MIN_CUSTOM_PALETTE_STOPS,
  seedCustomStops,
} from "../fractal/palette";
import type {
  CustomPalette,
  FlamePaletteId,
  PaletteSelection,
  RgbStop,
} from "../fractal/palette";
import type { Rng } from "../fractal/rng";
import type {
  ColorMode,
  FourDColorMode,
  SymmetryAxis,
  SymmetryParams,
  Transform,
} from "../fractal/types";
import { clamp } from "../fractal/vec";
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
 * The unified render-mode axis (fr-39y): WHICH of the three sibling renderers
 * is displaying the attractor. `"points"` is the live point-cloud explorer —
 * the always-interactive default; `"flame"` and `"solid"` are the two
 * converging render overlays that take its place until the user switches
 * back. One concept, one switch — not two independent booleans — so the UI
 * can present a single segmented control and flame↔solid is a direct switch
 * rather than a round-trip through the explorer.
 *
 * Distinct from {@link RenderStyle}, which picks a LOOK of the `"points"`
 * mode (fog, glow, depth of field, …) and persists with the scene. The
 * render mode is session-only, like the transform selection: never persisted,
 * so the app always boots into the explorer (see `persist.ts`'s
 * `SceneSnapshot`, which omits this field).
 */
export const RENDER_MODES = ["points", "flame", "solid"] as const;

export type RenderMode = (typeof RENDER_MODES)[number];

/**
 * The user's morph-detail preference (fr-jonj): how a system morph's
 * INTERMEDIATE point clouds trade density against shape-update rate. The
 * adaptive budget (`morph-budget.ts`, which implements these semantics)
 * reads fine live, but on a video recording a sparse intermediate cloud
 * encodes to near-black — the glow auto-exposure clamps long before it can
 * compensate a 10×+ density drop, and the solid point style compensates not
 * at all — so the density is user-selectable:
 *
 * - `"adaptive"` — the default: one frame's worth of points per update, the
 *   smoothest motion.
 * - `"dense"` — several frames' worth per update (`MORPH_DENSE_FACTOR`):
 *   markedly brighter, still fluid across a multi-second Drift leg.
 * - `"full"` — every intermediate runs the scene's own point count; the
 *   update rate is whatever full generations cost on this device. What a
 *   recording wants.
 *
 * This array is the single source of truth for the {@link MorphDetail} type,
 * and ui.test.ts pins the panel select's options against it — the same
 * discipline as {@link RENDER_STYLES}. The preference is session-only, like
 * `autoUpdate` / {@link AppState.renderMode}: a viewing preference for THIS
 * device/sitting, not scene content, so `persist.ts`'s `SceneSnapshot`
 * omits it and the app always boots back to `"adaptive"`.
 */
export const MORPH_DETAILS = ["adaptive", "dense", "full"] as const;

export type MorphDetail = (typeof MORPH_DETAILS)[number];

/**
 * The Save-PNG export-size multipliers (fr-2urv): the drawing-buffer
 * resolution Save PNG renders at, as a multiple of the screen's. The
 * device may clamp the resulting size (texture-size / flame-memory
 * ceilings) — see scene.ts and main.ts's flame session start.
 */
export const EXPORT_SCALES = [1, 2, 4] as const;
/** One of {@link EXPORT_SCALES}. */
export type ExportScale = (typeof EXPORT_SCALES)[number];

/**
 * Render-current-view settings for the flame renderer (`src/fractal/flame.ts`).
 * Persists as a render setting like `colorMode` / `renderStyle`, independent
 * of which render mode is currently active (see {@link AppState.renderMode}).
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
   * Structural-coloring palette (fr-6us; see `palette.ts`). A cosine-gradient
   * id paints continuous color along the orbit; `"legacy"` keeps the original
   * per-transform-hue coloring; `"custom"` (fr-55k) selects the user-authored
   * gradient in {@link AppState.customPalette}. Defaults to a gradient
   * ({@link DEFAULT_FLAME_PALETTE}) — an absent or unrecognized decoded value
   * falls back to the same default (see `persist.ts`). Changing it restarts
   * accumulation — the accumulated color sums bake in the palette, so there
   * is nothing to keep (see `main.ts`).
   */
  paletteId: PaletteSelection;
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
   * Structural-coloring palette (fr-1kt; shares fr-6us's `PaletteSelection`
   * union — see `palette.ts`). A cosine-gradient id paints continuous color
   * along the orbit, overriding colorMode entirely; `"legacy"` keeps the
   * colorMode-driven coloring (fr-c1d); `"custom"` (fr-55k) selects the
   * user-authored gradient in {@link AppState.customPalette}. Defaults to a
   * gradient ({@link DEFAULT_SOLID_PALETTE}) — an absent or unrecognized
   * decoded value falls back to the same default (see `persist.ts`).
   * Changing it restarts accumulation — the accumulated avgRGB bakes in the
   * palette, so there is nothing to keep (see `main.ts`).
   */
  paletteId: PaletteSelection;
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
  /**
   * Which gradient palette the height/radius color-mode ramps sample
   * (fr-3b6) — everywhere the ONE ramp definition flows: the explorer's
   * point colors (`buildColors`), the solid render's `"legacy"`-palette
   * colorMode path (`accumulateVoxels`), and the panel legend, all via
   * `color.ts`'s `buildColorModeLUT`. Since fr-6ue the 4D projection's
   * "By 4D Radius" mode follows the same selection — the explorer bake
   * (`buildColors4`), the flame/voxel workers' 4D radius LUT, and the 4D
   * legend. `"legacy"` keeps the built-in ramps; `"custom"` selects the
   * user-authored gradient in {@link AppState.customPalette}, exactly like
   * the flame/solid `paletteId`s. Inert for the modes with no 1-D ramp
   * (transform/position/uniform, and the 4D w-depth/transform modes).
   * Persists like `colorMode` / `colorGamma`.
   */
  rampPaletteId: PaletteSelection;
  renderStyle: RenderStyle;
  autoUpdate: boolean;
  /**
   * Point density for a system morph's intermediate clouds — see
   * {@link MORPH_DETAILS} for the vocabulary and why it exists.
   * Session-only, like {@link autoUpdate}: never persisted.
   */
  morphDetail: MorphDetail;
  /**
   * Whether the adaptive-resolution governor (fr-4lyt) may trade render
   * resolution for frame rate under sustained slow frames. Session-only,
   * like {@link autoUpdate}: never persisted — it describes THIS device's
   * headroom, not the scene, and a shared link must not carry one machine's
   * compromise to another.
   */
  adaptiveResolution: boolean;
  /**
   * Save-PNG export resolution as a multiple of the screen's (fr-2urv) —
   * see {@link EXPORT_SCALES}. Session-only, like {@link adaptiveResolution}:
   * never persisted — it is a device/workflow preference, not the scene, and
   * while a flame render is active it also sets the resolution the whole
   * session accumulates at (a cost a shared link must not carry to another
   * machine).
   */
  exportScale: ExportScale;
  panelOpen: boolean;
  /** Render-current-view settings; persists independent of {@link renderMode}. */
  flame: FlameParams;
  /** Solid render settings; persists independent of {@link renderMode}. */
  solid: SolidParams;
  /**
   * Which renderer is displaying the attractor (fr-39y) — see
   * {@link RENDER_MODES}. Session-only, like `selectedTransform` /
   * `autoUpdate`: never persisted, so the app always boots into the
   * `"points"` explorer (see `persist.ts`'s `SceneSnapshot`, which omits
   * this field). The flame/solid render SETTINGS ({@link flame} /
   * {@link solid}) persist independently of it.
   */
  renderMode: RenderMode;
  /**
   * Rotational/mirror symmetry (fr-6im): replicate `transforms` into rotated
   * copies for every render — see `fractal/types.ts`'s `SymmetryParams`.
   * Unlike {@link renderMode} this is NOT session-only:
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
  /**
   * The one user-authored gradient slot (fr-55k), shared by the flame and
   * solid renders — each opts in independently via its own
   * `paletteId === "custom"`. Absent until a palette select first lands on
   * Custom, at which point {@link setFlamePaletteId}/{@link setSolidPaletteId}
   * seed it from the palette being replaced (see `palette.ts`'s
   * `seedCustomStops`), so Custom starts as a tweakable copy of the current
   * look. Persists like `flame`/`solid` (see `persist.ts`) and survives while
   * unselected, so switching away and back never loses an authored gradient.
   */
  customPalette?: CustomPalette;
  /**
   * The position color mode's three user-picked axis colors (fr-8k7, see
   * `color.ts`'s `writePositionColor`). Absent = the legacy XYZ→RGB identity
   * mapping — kept absent rather than storing the identity explicitly, so
   * "absent = legacy" stays the one discriminator and default scenes keep
   * their short URLs (the reducer normalizes an exact identity back to
   * absent). Persists like `customPalette` — optional, written only when
   * present.
   */
  positionAxisColors?: PositionAxisColors;
}

/** An IFS needs at least one map. */
export const MIN_TRANSFORMS = 1;
export const DEFAULT_NUM_POINTS = 100_000;
export const MAX_NUM_POINTS = 5_000_000;
export const MIN_NUM_POINTS = 1_000;
/** Point-size multiplier; 1 renders each style at its authored size. */
export const DEFAULT_POINT_SIZE = 1;
/**
 * Point-size multiplier bounds. `pointSize` scales each render style's
 * authored base size; below the floor points all but vanish, above the
 * ceiling they bloat into a featureless blob. Matches `index.html`'s
 * `pointSizeSlider` range (pinned by ui.test.ts) — the magic 0.25/4 that used
 * to live inline in `persist.ts`'s decoder.
 */
export const MIN_POINT_SIZE = 0.25;
export const MAX_POINT_SIZE = 4;
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
 * GPU accumulation (fr-npb) measures ~10G iterations/sec on discrete GPUs
 * (fr-53k addendum), so billion-iteration budgets stay interactive (fr-79p).
 * 2B stays under 2^31, so the value is int32-safe everywhere (worker
 * messages, GPU dispatch counts, etc.) without needing a separate "GPU mode"
 * ceiling.
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
 * Default flame palette (fr-6us): the classic full-spectrum cosine gradient,
 * so the first flame a user ever renders shows the iridescent structural
 * coloring the feature exists for rather than the flat per-transform hues of
 * `"legacy"`. Both the fresh-session default AND `persist.ts`'s decode
 * fallback for an absent or unrecognized `paletteId`.
 */
export const DEFAULT_FLAME_PALETTE: FlamePaletteId = "spectrum";
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
 * Default solid-render palette (fr-1kt): the same spectrum gradient as
 * {@link DEFAULT_FLAME_PALETTE}, for one coherent default look across both
 * converging renders. Like the flame default, this is both the
 * fresh-session default AND `persist.ts`'s decode fallback for an absent or
 * unrecognized `paletteId`.
 */
export const DEFAULT_SOLID_PALETTE: FlamePaletteId = "spectrum";
/**
 * Default ramp palette for the explorer's height/radius color modes (fr-3b6)
 * — `"legacy"`, the built-in blue→green→red / warm→cool ramps. Deliberately
 * NOT a gradient, unlike {@link DEFAULT_FLAME_PALETTE} /
 * {@link DEFAULT_SOLID_PALETTE}: the built-in coordinate ramps are a
 * designed default look in their own right, so the gradient override stays
 * opt-in. Both the fresh-session default AND `persist.ts`'s decode fallback
 * for an absent or unrecognized `rampPaletteId`.
 */
export const DEFAULT_RAMP_PALETTE: FlamePaletteId = "legacy";
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
 * Since fr-icy, `w.scale`'s bounds apply to its MAGNITUDE only: the sign is
 * a 4D reflection, expressed in the editor as a magnitude slider plus a
 * Mirror W toggle (fr-lca's scale-channel pattern one dimension up) and
 * preserved by `persist.ts`'s sign-preserving clamp (`decodeWScale`).
 */
export const MIN_W_POSITION = -1.5;
export const MAX_W_POSITION = 1.5;
export const MIN_W_SCALE = 0.05;
export const MAX_W_SCALE = 1.5;
export const MIN_W_ANGLE = -Math.PI;
export const MAX_W_ANGLE = Math.PI;
export const MIN_W_SHEAR = -2;
export const MAX_W_SHEAR = 2;

/**
 * The range knowledge for one tunable numeric parameter, single-sourced so the
 * clamping setters below and `persist.ts`'s strict decode boundary share ONE
 * declaration of each field's bounds (and rounding/snapping behavior) instead
 * of re-inlining `Math.max(MIN, Math.min(MAX, v))` at every site. This extends
 * the codebase's enum single-source discipline (`COLOR_MODES` → type +
 * validator) from strings to numbers: {@link PARAM} is the table, and
 * {@link clampToSpec} is the shared consumer both sides call.
 *
 * The individual `MIN_/MAX_/DEFAULT_` constants above remain the documented,
 * importable home for each literal value (and every existing call site and
 * test keeps using them); {@link PARAM} merely gathers them into the
 * `{ min, max, default, round?, snap? }` shape `clampToSpec` needs, adding the
 * per-field `round`/`snap` behavior that the spec centralizes instead of each
 * setter hard-coding it. No range literal is written twice.
 */
export interface ParamSpec {
  readonly min: number;
  readonly max: number;
  readonly default: number;
  /**
   * Round the clamped result to the nearest integer — for parameters whose
   * state must be whole (iteration budgets, the supersample factor, the
   * symmetry order), matching what those setters did with an outer
   * `Math.round`.
   */
  readonly round?: boolean;
  /**
   * Snap to the nearest multiple of this step BEFORE clamping — the solid
   * grid's voxel step, where memory is O(n³) so only stepped resolutions are
   * offered. Applied first (exactly as `setSolidResolution` did) so the clamp
   * still guarantees the final value lands within `[min, max]`.
   */
  readonly snap?: number;
}

/**
 * Snap (if the spec asks), clamp into `[min, max]`, then round (if the spec
 * asks) — the one clamp implementation every numeric setter and the persist
 * decoders share. Ordering matches the hand-written chains it replaces:
 * `setSolidResolution` snapped to the voxel step and THEN clamped, and the
 * integer setters clamped and THEN rounded.
 */
export function clampToSpec(spec: ParamSpec, value: number): number {
  const snapped =
    spec.snap !== undefined ? Math.round(value / spec.snap) * spec.snap : value;
  const clamped = clamp(snapped, spec.min, spec.max);
  return spec.round ? Math.round(clamped) : clamped;
}

/**
 * Single source of range knowledge for every tunable numeric parameter (see
 * {@link ParamSpec}). Keyed by the parameter name; `state.ts`'s setters and
 * `persist.ts`'s decoders both consume these via {@link clampToSpec}, and
 * `index.html`'s slider `min`/`max` attributes are pinned against the matching
 * entries by a test (see ui.test.ts).
 *
 * `numPoints.min` is `0` — the DATA floor, deliberately below the UI slider's
 * own {@link MIN_NUM_POINTS} (1000) floor: `persist.ts` has always accepted an
 * empty-to-huge cloud from a shared link (pinned by persist.test.ts), and a
 * crafted sub-1000 count survives decode exactly the way an off-detent flame
 * iteration count does — the slider just snaps its thumb for display until the
 * user next drags it. The log-scaled slider needs a positive floor (log 0 is
 * −∞), which is why `MIN_NUM_POINTS` exists as a separate, higher bound.
 */
/**
 * Identity helper that pins each entry's type to {@link ParamSpec} while
 * INFERRING the key set. Typing the values as `ParamSpec` widens `min`/`max`/
 * `default` to plain `number` (the source constants are `const` literals like
 * `2.4`, whose narrow types would otherwise leak through property access and
 * fight ordinary numeric reassignment in the decoders); inferring `K` keeps
 * `PARAM.<name>` typo-checked, unlike a bare `Record<string, ParamSpec>`.
 */
function defineParams<K extends string>(
  specs: Record<K, ParamSpec>,
): Record<K, ParamSpec> {
  return specs;
}

export const PARAM = defineParams({
  numPoints: { min: 0, max: MAX_NUM_POINTS, default: DEFAULT_NUM_POINTS },
  pointSize: {
    min: MIN_POINT_SIZE,
    max: MAX_POINT_SIZE,
    default: DEFAULT_POINT_SIZE,
  },
  colorGamma: {
    min: MIN_COLOR_GAMMA,
    max: MAX_COLOR_GAMMA,
    default: DEFAULT_COLOR_GAMMA,
  },
  flameExposure: {
    min: MIN_FLAME_EXPOSURE,
    max: MAX_FLAME_EXPOSURE,
    default: DEFAULT_FLAME_EXPOSURE,
  },
  flameIterations: {
    min: MIN_FLAME_ITERATIONS,
    max: MAX_FLAME_ITERATIONS,
    default: DEFAULT_FLAME_ITERATIONS,
    round: true,
  },
  flameGamma: {
    min: MIN_FLAME_GAMMA,
    max: MAX_FLAME_GAMMA,
    default: DEFAULT_FLAME_GAMMA,
  },
  flameVibrancy: {
    min: MIN_FLAME_VIBRANCY,
    max: MAX_FLAME_VIBRANCY,
    default: DEFAULT_FLAME_VIBRANCY,
  },
  flameSupersample: {
    min: MIN_FLAME_SUPERSAMPLE,
    max: MAX_FLAME_SUPERSAMPLE,
    default: DEFAULT_FLAME_SUPERSAMPLE,
    round: true,
  },
  estimatorRadius: {
    min: MIN_ESTIMATOR_RADIUS,
    max: MAX_ESTIMATOR_RADIUS,
    default: DEFAULT_ESTIMATOR_RADIUS,
  },
  estimatorMinimumRadius: {
    min: MIN_ESTIMATOR_MINIMUM_RADIUS,
    max: MAX_ESTIMATOR_MINIMUM_RADIUS,
    default: DEFAULT_ESTIMATOR_MINIMUM_RADIUS,
  },
  estimatorCurve: {
    min: MIN_ESTIMATOR_CURVE,
    max: MAX_ESTIMATOR_CURVE,
    default: DEFAULT_ESTIMATOR_CURVE,
  },
  solidResolution: {
    min: MIN_SOLID_RESOLUTION,
    max: MAX_SOLID_RESOLUTION,
    default: DEFAULT_SOLID_RESOLUTION,
    snap: VOXEL_RESOLUTION_STEP,
  },
  solidIterations: {
    min: MIN_SOLID_ITERATIONS,
    max: MAX_SOLID_ITERATIONS,
    default: DEFAULT_SOLID_ITERATIONS,
    round: true,
  },
  solidThreshold: {
    min: MIN_SOLID_THRESHOLD,
    max: MAX_SOLID_THRESHOLD,
    default: DEFAULT_SOLID_THRESHOLD,
  },
  solidLightAzimuth: {
    min: MIN_SOLID_LIGHT_AZIMUTH,
    max: MAX_SOLID_LIGHT_AZIMUTH,
    default: DEFAULT_SOLID_LIGHT_AZIMUTH,
  },
  solidLightElevation: {
    min: MIN_SOLID_LIGHT_ELEVATION,
    max: MAX_SOLID_LIGHT_ELEVATION,
    default: DEFAULT_SOLID_LIGHT_ELEVATION,
  },
  solidAmbient: {
    min: MIN_SOLID_AMBIENT,
    max: MAX_SOLID_AMBIENT,
    default: DEFAULT_SOLID_AMBIENT,
  },
  symmetryOrder: {
    min: MIN_SYMMETRY_ORDER,
    max: MAX_SYMMETRY_ORDER,
    default: DEFAULT_SYMMETRY_ORDER,
    round: true,
  },
  glowBrightness: {
    min: MIN_GLOW_BRIGHTNESS,
    max: MAX_GLOW_BRIGHTNESS,
    default: DEFAULT_GLOW_BRIGHTNESS,
  },
});

export function initialState(panelOpen: boolean): AppState {
  return {
    transforms: defaultTransforms(),
    numPoints: DEFAULT_NUM_POINTS,
    pointSize: DEFAULT_POINT_SIZE,
    selectedTransform: null,
    showGuides: true,
    colorMode: "transform",
    colorGamma: DEFAULT_COLOR_GAMMA,
    rampPaletteId: DEFAULT_RAMP_PALETTE,
    fourDColor: DEFAULT_FOUR_D_COLOR,
    fourDDepthFade: false,
    renderStyle: "depthFade",
    autoUpdate: true,
    morphDetail: "adaptive",
    adaptiveResolution: true,
    exportScale: 1,
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
    solid: {
      resolution: DEFAULT_SOLID_RESOLUTION,
      iterations: DEFAULT_SOLID_ITERATIONS,
      threshold: DEFAULT_SOLID_THRESHOLD,
      lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
      lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
      ambient: DEFAULT_SOLID_AMBIENT,
      paletteId: DEFAULT_SOLID_PALETTE,
    },
    renderMode: "points",
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
  return { ...state, numPoints: clampToSpec(PARAM.numPoints, numPoints) };
}

export function setPointSize(state: AppState, pointSize: number): AppState {
  return { ...state, pointSize: clampToSpec(PARAM.pointSize, pointSize) };
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
  return { ...state, colorGamma: clampToSpec(PARAM.colorGamma, colorGamma) };
}

/**
 * Set the height/radius ramps' gradient palette (fr-3b6). Not clamped — it
 * is an enum (see `palette.ts`), and the UI only offers valid ids
 * (persistence validates untrusted input in `decodeScene`). Recolors the
 * live cloud over the cached run — never a regenerate (see `main.ts`).
 *
 * A fresh switch TO {@link CUSTOM_PALETTE_ID} — `customPalette` not yet set
 * — seeds it from the palette being REPLACED (the previous `rampPaletteId`),
 * via `palette.ts`'s {@link seedCustomStops}, exactly like
 * {@link setFlamePaletteId} / {@link setSolidPaletteId}. Picking a preset
 * id, or re-picking Custom when a payload already exists, leaves
 * `customPalette` untouched.
 */
export function setRampPaletteId(
  state: AppState,
  paletteId: PaletteSelection,
): AppState {
  return {
    ...state,
    rampPaletteId: paletteId,
    ...(paletteId === CUSTOM_PALETTE_ID && state.customPalette === undefined
      ? { customPalette: { stops: seedCustomStops(state.rampPaletteId) } }
      : {}),
  };
}

/**
 * Set the position color mode's axis colors (fr-8k7). Setting the exact
 * legacy identity (see `color.ts`'s `LEGACY_POSITION_AXIS_COLORS`)
 * normalizes back to `undefined` — "absent = legacy" stays the one
 * discriminator, the encoded scene keeps its short URL, and the legacy
 * render path stays byte-identical (the custom blend at the identity is
 * numerically identical anyway). Like `setColorMode`, never clamped:
 * the UI's `<input type="color">` can only produce valid channels, and
 * persistence validates untrusted input in `decodeScene`.
 */
export function setPositionAxisColors(
  state: AppState,
  colors: PositionAxisColors,
): AppState {
  return {
    ...state,
    positionAxisColors: isLegacyPositionAxisColors(colors) ? undefined : colors,
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

export function setMorphDetail(
  state: AppState,
  morphDetail: MorphDetail,
): AppState {
  return { ...state, morphDetail };
}

export function setAdaptiveResolution(
  state: AppState,
  adaptiveResolution: boolean,
): AppState {
  return { ...state, adaptiveResolution };
}

export function setExportScale(
  state: AppState,
  exportScale: ExportScale,
): AppState {
  return { ...state, exportScale };
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
      exposure: clampToSpec(PARAM.flameExposure, exposure),
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
      iterations: clampToSpec(PARAM.flameIterations, iterations),
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
      gamma: clampToSpec(PARAM.flameGamma, gamma),
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
      vibrancy: clampToSpec(PARAM.flameVibrancy, vibrancy),
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
      supersample: clampToSpec(PARAM.flameSupersample, supersample),
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
      estimatorRadius: clampToSpec(PARAM.estimatorRadius, estimatorRadius),
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
      estimatorMinimumRadius: clampToSpec(
        PARAM.estimatorMinimumRadius,
        estimatorMinimumRadius,
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
      estimatorCurve: clampToSpec(PARAM.estimatorCurve, estimatorCurve),
    },
  };
}

/**
 * Set the flame render's structural-coloring palette. Not clamped — it is an
 * enum (see `palette.ts`), and the UI only offers valid ids (persistence
 * validates untrusted input in `decodeScene`). Restarts accumulation in the
 * worker when it changes; see `main.ts`.
 *
 * A fresh switch TO {@link CUSTOM_PALETTE_ID} (fr-55k) — `customPalette` not
 * yet set — seeds it from the palette being REPLACED (the previous
 * `flame.paletteId`), via `palette.ts`'s {@link seedCustomStops}, so Custom
 * starts as a tweakable copy of the look the user was just seeing. Picking a
 * preset id, or re-picking Custom when a payload already exists, leaves
 * `customPalette` untouched — selecting a palette must never clear the one
 * authored-gradient slot.
 */
export function setFlamePaletteId(
  state: AppState,
  paletteId: PaletteSelection,
): AppState {
  return {
    ...state,
    flame: { ...state.flame, paletteId },
    ...(paletteId === CUSTOM_PALETTE_ID && state.customPalette === undefined
      ? { customPalette: { stops: seedCustomStops(state.flame.paletteId) } }
      : {}),
  };
}

/**
 * Switch which renderer displays the attractor (fr-39y) — see
 * {@link AppState.renderMode}. Session-only, like {@link selectTransform}:
 * never an undoable/persisted edit. The enter/exit choreography around a
 * change (spinning render workers up and down) lives in main.ts's
 * `RenderSession`s; this only records the mode.
 */
export function setRenderMode(
  state: AppState,
  renderMode: RenderMode,
): AppState {
  return { ...state, renderMode };
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
  return {
    ...state,
    solid: {
      ...state.solid,
      resolution: clampToSpec(PARAM.solidResolution, resolution),
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
      iterations: clampToSpec(PARAM.solidIterations, iterations),
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
      threshold: clampToSpec(PARAM.solidThreshold, threshold),
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
      lightAzimuth: clampToSpec(PARAM.solidLightAzimuth, lightAzimuth),
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
      lightElevation: clampToSpec(PARAM.solidLightElevation, lightElevation),
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
      ambient: clampToSpec(PARAM.solidAmbient, ambient),
    },
  };
}

/**
 * Set the solid render's structural-coloring palette. Not clamped — it is an
 * enum (see `palette.ts`), and the UI only offers valid ids (persistence
 * validates untrusted input in `decodeScene`). Restarts accumulation in the
 * worker when it changes; see `main.ts`.
 *
 * A fresh switch TO {@link CUSTOM_PALETTE_ID} (fr-55k) — `customPalette` not
 * yet set — seeds it from the palette being REPLACED (the previous
 * `solid.paletteId`), via `palette.ts`'s {@link seedCustomStops}, exactly like
 * {@link setFlamePaletteId}. Picking a preset id, or re-picking Custom when a
 * payload already exists, leaves `customPalette` untouched.
 */
export function setSolidPaletteId(
  state: AppState,
  paletteId: PaletteSelection,
): AppState {
  return {
    ...state,
    solid: { ...state.solid, paletteId },
    ...(paletteId === CUSTOM_PALETTE_ID && state.customPalette === undefined
      ? { customPalette: { stops: seedCustomStops(state.solid.paletteId) } }
      : {}),
  };
}

/**
 * Replace the user-authored gradient's stops (fr-55k) — the gradient editor's
 * add/remove/recolor/reorder edits all funnel through this one reducer,
 * passing their whole new stop list. Never throws: fewer than
 * {@link MIN_CUSTOM_PALETTE_STOPS} isn't a gradient — the UI never actually
 * sends this, so it's a defensive no-op rather than a real path — and a
 * non-finite channel (also not a value the UI's `<input type="color">` →
 * `hexToRgb` path can produce) is likewise rejected; both return `state`
 * unchanged rather than storing garbage. Anything past
 * {@link MAX_CUSTOM_PALETTE_STOPS} is silently truncated first, so a
 * non-finite channel past the limit can't reject a list that would have been
 * fine once trimmed. Every surviving stop is copied into a fresh tuple with
 * each channel clamped to `[0, 1]`. Deliberately leaves `flame.paletteId` /
 * `solid.paletteId` untouched — editing the shared slot while it isn't the
 * active selection on either render is inert, like any other render-settings
 * edit made while a different setting is selected. `persist.ts` re-validates
 * untrusted (URL-hash-decoded) stop data separately; this reducer only guards
 * the live-editor input path.
 */
export function setCustomPaletteStops(
  state: AppState,
  stops: readonly RgbStop[],
): AppState {
  if (stops.length < MIN_CUSTOM_PALETTE_STOPS) return state;
  const trimmed = stops.slice(0, MAX_CUSTOM_PALETTE_STOPS);
  if (trimmed.some((stop) => stop.some((channel) => !Number.isFinite(channel))))
    return state;
  const cleaned: RgbStop[] = trimmed.map(([r, g, b]): RgbStop => [
    clamp(r, 0, 1),
    clamp(g, 0, 1),
    clamp(b, 0, 1),
  ]);
  return { ...state, customPalette: { stops: cleaned } };
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
 * `main.ts`'s `cloudParams` stamps this decision onto each generation
 * request (through {@link systemPartsAreNonFlat}, so a morph sample can
 * route on its own flatness) and caches the arrived result's flag (its
 * `viewIs4D`) rather than re-deriving it in every per-frame or
 * per-pointer-move read; `ui.ts`'s `updateLabels` calls it directly instead
 * (it runs far less often), then passes the one result on to `updateLegend`.
 * Either way there is exactly one formula, so the routing decision, the
 * panel's gating, and the legend can never drift apart.
 */
export function systemIsNonFlat(state: AppState): boolean {
  return systemPartsAreNonFlat(state.transforms, state.finalTransform ?? null);
}

/**
 * {@link systemIsNonFlat}'s underlying formula over bare system parts, for a
 * caller holding a system that is not the live document: a replace-load
 * morph's per-frame samples (fr-a04l) route their generation requests on the
 * SAMPLED system's own flatness, so a flat↔4D morph flips to the 4D path
 * exactly when the interpolated maps first carry live `w` blocks — not when
 * the document does. `null` means "no final transform", matching
 * `MorphSystem`/`CloudRequest`'s vocabulary; the live document's optional
 * field maps through `?? null` above, so there is still exactly one formula.
 */
export function systemPartsAreNonFlat(
  transforms: readonly Transform[],
  finalTransform: Transform | null,
): boolean {
  return (
    !systemIsFlat(transforms) ||
    (finalTransform !== null && !isFlatTransform(finalTransform))
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
      order: clampToSpec(PARAM.symmetryOrder, order),
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
    glowBrightness: clampToSpec(PARAM.glowBrightness, glowBrightness),
  };
}
