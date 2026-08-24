import { systemPartsAreNonFlat } from "../fractal/affine4";
import { appendTransform, defaultTransforms } from "../fractal/presets";
import { isLegacyPositionAxisColors } from "../fractal/color";
import type { PositionAxisColors } from "../fractal/color";
import {
  CUSTOM_PALETTE_ID,
  FLAME_PALETTE_IDS,
  MAX_CUSTOM_PALETTE_STOPS,
  MIN_CUSTOM_PALETTE_STOPS,
  resolvePalette,
  seedCustomStops,
} from "../fractal/palette";
import type {
  CustomPalette,
  FlamePaletteId,
  PaletteSelection,
  PaletteSpec,
  RgbStop,
} from "../fractal/palette";
import type { Rng } from "../fractal/rng";
import { MAX_SCHEDULE_DEPTH } from "../fractal/chaos-game";
import { resolveBackground } from "./background";
import type {
  BackgroundGradient,
  BackgroundMode,
  BackgroundParams,
  BackgroundShape,
} from "./background";
import type {
  ColorMode,
  FourDColorMode,
  HybridSchedule,
  SymmetryPlane,
  SymmetryParams,
  Transform,
} from "../fractal/types";
import { clamp } from "../fractal/vec";
import { VOXEL_RESOLUTION_STEP } from "../fractal/voxel";

/**
 * Balloon-only palette sentinel: keep each renderer's existing balloon color
 * path exactly as-is. This is deliberately distinct from the primary
 * palettes' `"legacy"` sentinel — that value names renderer-specific coloring,
 * while the balloon needs one shared, renderer-neutral instruction to inherit
 * whichever base color its current arm already produced.
 */
export const BALLOON_PALETTE_INHERIT = "inherit";

/**
 * What the shared balloon palette controls store. The actual gradient choices
 * are the registered built-ins except `"legacy"` (which has no LUT), plus the
 * independently-authored Custom slot and the balloon-only Inherit sentinel.
 */
export type BalloonPaletteSelection =
  typeof BALLOON_PALETTE_INHERIT | Exclude<PaletteSelection, "legacy">;

/**
 * Every balloon palette choice in UI order. Single source of truth for the
 * mirrored Points/Flame/Surface selects and persistence validation.
 */
export const BALLOON_PALETTE_IDS: readonly BalloonPaletteSelection[] = [
  BALLOON_PALETTE_INHERIT,
  ...FLAME_PALETTE_IDS.filter(
    (id): id is Exclude<FlamePaletteId, "legacy"> => id !== "legacy",
  ),
  CUSTOM_PALETTE_ID,
];

/** The legacy-preserving default for every new or decoded document. */
export const DEFAULT_BALLOON_PALETTE: BalloonPaletteSelection =
  BALLOON_PALETTE_INHERIT;

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
 * The unified render-mode axis: WHICH of the three sibling renderers
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
export const RENDER_MODES = ["points", "flame", "solid", "surface"] as const;

export type RenderMode = (typeof RENDER_MODES)[number];

/**
 * The user's morph-detail preference: how a system morph's
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
 * The Save-PNG export-size multipliers: the drawing-buffer
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
   * 1 = neutral (the original curve, unchanged). Applied live over the
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
   * Structural-coloring palette (see `palette.ts`). A cosine-gradient
   * id paints continuous color along the orbit; `"legacy"` keeps the original
   * per-transform-hue coloring; `"custom"` selects the user-authored
   * gradient in {@link AppState.customPalette}. Defaults to a gradient
   * ({@link DEFAULT_FLAME_PALETTE}) — an absent or unrecognized decoded value
   * falls back to the same default (see `persist.ts`). Changing it restarts
   * accumulation — the accumulated color sums bake in the palette, so there
   * is nothing to keep (see `main.ts`).
   */
  paletteId: PaletteSelection;
}

/**
 * Settings for the solid render (`src/fractal/voxel.ts` + the GPU
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
   * Structural-coloring palette (shares the flame render's
   * `PaletteSelection` union — see `palette.ts`). A cosine-gradient id
   * paints continuous color along the orbit, overriding colorMode entirely;
   * `"legacy"` keeps the colorMode-driven coloring; `"custom"` selects the
   * user-authored gradient in {@link AppState.customPalette}. Defaults to a
   * gradient ({@link DEFAULT_SOLID_PALETTE}) — an absent or unrecognized
   * decoded value falls back to the same default (see `persist.ts`).
   * Changing it restarts accumulation — the accumulated avgRGB bakes in the
   * palette, so there is nothing to keep (see `main.ts`).
   */
  paletteId: PaletteSelection;
}

/**
 * The surface render's base-color source (see
 * {@link SurfaceParams.colorSource}). `"transform"` keys each map's own
 * By-Transform color, exactly like the explorer's colorMode of the same
 * name; `"palette"` paints an orbit-trap coordinate through a cosine-gradient
 * palette — the flame's structural-coloring idea (`palette.ts`), one
 * dimension over; `"height"`/`"radius"` reuse the explorer's ONE ramp
 * definition (`color.ts`'s `buildColorModeLUT`), the same ramp the solid
 * render's `"legacy"`-palette path and the panel legend already share;
 * `"rings"` is the classic geometric orbit trap — the descent's
 * closest radial approach to the attractor's center, painted through the
 * same palette as `"palette"`, reading as concentric structure-following
 * shells; `"sheets"` is its plane-trap sibling — the descent's closest
 * approach to the attractor frame's y = 0 plane, through the same palette,
 * reading as nested laminar bands cutting across the structure. (An
 * escape-depth source was tried here first and swapped out pre-release:
 * on uniform-contraction systems the escape level is pinned by the hit
 * epsilon, not local structure, and it rendered one flat hue.)
 *
 * This array is the single source of truth for the {@link SurfaceColorSource}
 * type and the persistence validator (`VALID_SURFACE_COLOR_SOURCES` in
 * `persist.ts`) — the same discipline {@link RENDER_STYLES}/
 * {@link MORPH_DETAILS} use above. The surface tracer's GLSL `uColorSource`
 * uniform (`surface-material.ts`) currently dispatches on this exact 0-5
 * order, so keep it append-only unless that shader dispatch moves too.
 */
export const SURFACE_COLOR_SOURCES = [
  "transform",
  "palette",
  "height",
  "radius",
  "rings",
  "sheets",
] as const;

export type SurfaceColorSource = (typeof SURFACE_COLOR_SOURCES)[number];

/** Authorable floor appearance. The pattern is evaluated in world space,
 * scaled from the surface session's certified visible ball, so resizing the
 * panel never changes the material. */
export const SURFACE_FLOOR_PATTERNS = ["solid", "checker"] as const;
export type SurfaceFloorPattern = (typeof SURFACE_FLOOR_PATTERNS)[number];

/**
 * Settings for the surface render (the sphere-traced implicit
 * surface — `surface-material.ts`'s GLSL tracer over `surface-de.ts`'s
 * analytic distance estimator). Persists as a render-settings block like
 * {@link FlameParams}/{@link SolidParams}, independent of whether the render
 * is active.
 *
 * Every field here is a LIVE GPU uniform: the tracer has no accumulation to
 * restart at all (unlike the flame's histogram or the solid render's voxel
 * grid), so every change — including `colorSource`/`paletteId` — takes
 * effect the very next frame, at full frame rate, with nothing to re-run.
 */
export interface SurfaceParams {
  /** Light's horizontal angle in degrees. Same physical meaning as
   * {@link SolidParams.lightAzimuth} — `PARAM.surfaceLightAzimuth` reuses its
   * `MIN_SOLID_LIGHT_AZIMUTH`/`MAX_SOLID_LIGHT_AZIMUTH` range. Live-reactive
   * (see the interface doc). */
  lightAzimuth: number;
  /** Light's height above the horizon in degrees. Same physical meaning as
   * {@link SolidParams.lightElevation} — `PARAM.surfaceLightElevation`
   * reuses its `MIN_SOLID_LIGHT_ELEVATION`/`MAX_SOLID_LIGHT_ELEVATION` range.
   * Live-reactive. */
  lightElevation: number;
  /** Fill-light floor in [0, 1]: how bright fully shadowed/occluded surfaces
   * stay. Same physical meaning as {@link SolidParams.ambient} —
   * `PARAM.surfaceAmbient` reuses its `MIN_SOLID_AMBIENT`/`MAX_SOLID_AMBIENT`
   * range. Live-reactive. */
  ambient: number;
  /**
   * Base-color source — see {@link SurfaceColorSource} for what
   * each value means. Live-reactive, like every field here.
   */
  colorSource: SurfaceColorSource;
  /**
   * Structural-coloring palette for the `"palette"` colorSource (shares
   * the flame render's `PaletteSelection` union — see `palette.ts`),
   * sampled along the orbit-trap coordinate. `"custom"` selects the
   * user-authored gradient in {@link AppState.customPalette}. Defaults to
   * {@link DEFAULT_SOLID_PALETTE} — the same gradient the solid render
   * defaults to, reused rather than redeclared, so a fresh session's two
   * converging renders share one default look; an absent or unrecognized
   * decoded value falls back to the same default (see `persist.ts`). Inert
   * while `colorSource` isn't `"palette"`, but stored regardless so it's
   * ready the moment the user switches to it. Live-reactive, unlike
   * {@link FlameParams.paletteId}/{@link SolidParams.paletteId}: there is no
   * accumulation for the old palette to be baked into, so nothing restarts.
   */
  paletteId: PaletteSelection;
  /**
   * Per-level decay of the `"palette"` source's orbit-trap blend weight —
   * flam3's "color speed" one render over; see
   * {@link DEFAULT_SURFACE_COLOR_SPEED} for the endpoints. Inert for every
   * other colorSource, but stored regardless (like {@link paletteId}).
   * Live-reactive.
   */
  colorSpeed: number;
  /**
   * Environment-light strength in [0, 1]: how far the surface
   * render's LIGHT is tinted toward the backdrop sampled along the shading
   * normal, hue only (never brightness) — the render sits IN its background
   * instead of floating in front of it. 0 is the bit-exact identity of the
   * neutral light it replaced. Specular is outside the product on purpose.
   * The default ({@link DEFAULT_SURFACE_ENV_LIGHT}) is deliberately
   * NON-zero, so this is a look change for existing shared links — that
   * is intended, the feature ships on. Live-reactive, like every field
   * here.
   */
  envLight: number;
  /** Solid or world-space checker floor. */
  floorPattern: SurfaceFloorPattern;
  /** Checker cell width as a fraction of the session ball radius. */
  floorTileScale: number;
  /** Emitted floor radiance in linear light. Zero is the legacy floor. */
  floorEmission: number;
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
  /**
   * Optional scheduled-hybrid post-word block (`types.ts`'s
   * {@link HybridSchedule}): after each plotted point and BEFORE the lens,
   * `depth` random maps from system B bend the point — "a Menger sponge
   * made of ferns". Omitted ⇒ today's behavior byte-identically, and the
   * one writer ({@link setSchedule}) stores absent for depth 0 / empty B —
   * the classic-removal rule — with entries stripped to affine-only. Scene
   * content: persists, rides shared links, and a preset load clears it
   * unless the preset's own `PRESET_SCHEDULES` entry says otherwise
   * (`PRESET_FINALS`' absent-means-clear rule). It deliberately does NOT
   * interpolate in a morph (`lerpSystem` never sees it): a replace-load
   * applies the TARGET's block from the leg's first generation, exactly
   * where the background SHAPE pops.
   */
  schedule?: HybridSchedule;
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
   * How the 4D projection view colors points: a diverging signed-w
   * palette or a baked structural mode — see `fractal/types.ts`'s
   * {@link FourDColorMode} and `color.ts`'s `buildColors4`. Persists like
   * `colorMode` / `renderStyle` (NOT session-only, unlike the tumble/slice
   * view state), and is simply inert while the system is flat — exactly as
   * `colorMode` is inert while it is non-flat.
   */
  fourDColor: FourDColorMode;
  /**
   * Camera-depth fade for the 4D projection view: dim each point's
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
   * height/radius/position color modes (see `color.ts`'s
   * `colorModeUsesGamma`): `t' = t ** colorGamma`. `1` = linear (today's
   * mapping, unreshaped). Persists like `colorMode` / `renderStyle` /
   * `glowBrightness` — not session-only.
   */
  colorGamma: number;
  /**
   * Which gradient palette the height/radius color-mode ramps sample —
   * everywhere the ONE ramp definition flows: the explorer's
   * point colors (`buildColors`), the solid render's `"legacy"`-palette
   * colorMode path (`accumulateVoxels`), and the panel legend, all via
   * `color.ts`'s `buildColorModeLUT`. The 4D projection's
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
   * Whether the adaptive-resolution governor may trade render
   * resolution for frame rate under sustained slow frames. Session-only,
   * like {@link autoUpdate}: never persisted — it describes THIS device's
   * headroom, not the scene, and a shared link must not carry one machine's
   * compromise to another.
   */
  adaptiveResolution: boolean;
  /**
   * Whether the explorer's "Balloon echo" is showing: a second
   * point cloud sharing the main cloud's own geometry, sphere-inverted
   * about its enclosing ball — see `scene.ts`'s `syncBalloonEchoUniforms`
   * and `fractal/balloon-de.ts`'s module doc for the inversion math.
   * Persisted scene content (the balloon epic's "mode
   * persists" acceptance) — the same treatment as {@link background}/
   * {@link renderStyle}, NOT session-only like {@link adaptiveResolution}:
   * the balloon is part of what a shared link shows. `persist.ts`'s
   * decoder is tolerant, like `background`'s (an absent/malformed value
   * quietly falls back to off), so a link predating the field still opens
   * with the balloon off, exactly as it always rendered.
   */
  balloonEcho: boolean;
  /**
   * The balloon echo's radius, as a NORMALIZED multiple of the cloud's own
   * enclosing-ball radius (`rMult = 1` touches the attractor's extent —
   * see `fractal/balloon-de.ts`'s `buildBalloon`, whose `rMult` carries the
   * same meaning). Persisted alongside {@link balloonEcho}
   * — a shared link carries the cave at the size it was authored — and
   * still live per-frame-updatable exactly as before: the "Inflate" replay
   * (`main.ts`'s `onBalloonInflate`) sweeps it every tick via direct
   * reducer + scene calls that bypass the persisted control pipeline
   * entirely (no undo checkpoint or debounced save per sweep frame —
   * exactly like a camera drag: the motion itself is unrecorded, and only
   * wherever the value is LEFT rides the next ordinary debounced save, the
   * same "live per-frame, persisted at rest" shape the orbit camera's own
   * saved pose already has). Range/default single-sourced through
   * {@link PARAM.balloonRadius}; 1.6 sits past the attractor's own extent,
   * the "rest" pose where the echo has fully turned into an enclosing cave.
   */
  balloonRadius: number;
  /**
   * The one palette selection shared by the balloon in Points, Flame, and
   * Surface. {@link BALLOON_PALETTE_INHERIT} preserves each arm's existing
   * base-color path exactly; a gradient choice recolors only balloon-attributed
   * samples/shell terms before {@link balloonTint} is applied. Persisted scene
   * content, with missing/legacy/malformed values decoding back to Inherit.
   */
  balloonPaletteId: BalloonPaletteSelection;
  /**
   * The balloon's independently-authored Custom gradient. It is deliberately
   * separate from {@link customPalette}: editing or selecting one slot must
   * never mutate the other. Optional until the balloon palette first selects
   * Custom, and retained while unselected so an authored gradient survives a
   * round trip through Inherit or a built-in palette.
   */
  balloonCustomPalette?: CustomPalette;
  /**
   * The balloon echo/surface-balloon shell's tint color, a
   * `#rrggbb` hex string paired with {@link balloonTintStrength} — ONE
   * setting across BOTH balloon arms, the explorer's {@link balloonEcho}
   * Points echo (`scene.ts`'s `BALLOON_ECHO_VERTEX`) and the surface
   * inverted-union shell (`fractal/balloon-de.ts`, `surface-material.ts`/
   * `-4d.ts`, `fractal/surface-de-gpu.ts`). Every arm computes
   * `mix(base, balloonTint, balloonTintStrength)` on the shell's BASE
   * COLOUR, before lighting/intensity — see {@link DEFAULT_BALLOON_TINT} for
   * why black — so the shell still shades as geometry instead of
   * flattening into a flat-lit decal. Persisted scene content, the same
   * treatment as {@link balloonEcho}/{@link fogTint}: authored appearance a
   * shared link carries, never a viewer pref. Range/default single-sourced
   * through {@link DEFAULT_BALLOON_TINT}; `persist.ts`'s decoder is
   * tolerant like `fogTint`'s (a malformed value quietly drops the field),
   * so a link predating the tint pair still opens with the shell untinted,
   * exactly as it always rendered.
   */
  balloonTint: string;
  /**
   * The balloon tint's blend weight, `[0, 1]` — see
   * {@link balloonTint} for the colour it blends toward. `0` — the default
   * — is the untinted identity: every arm's
   * `mix(base, balloonTint, balloonTintStrength)` collapses to `base`
   * unchanged, so today's balloon rendering is byte-identical in every arm
   * and both dimensions regardless of what `balloonTint` decodes to.
   * Range/default single-sourced through {@link PARAM}.balloonTintStrength.
   * Persists like {@link balloonRadius} — not session-only.
   */
  balloonTintStrength: number;
  /**
   * Save-PNG export resolution as a multiple of the screen's —
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
  /** Surface render settings; persists independent of {@link renderMode},
   * like {@link solid}. */
  surface: SurfaceParams;
  /**
   * Which renderer is displaying the attractor — see
   * {@link RENDER_MODES}. Session-only, like `selectedTransform` /
   * `autoUpdate`: never persisted, so the app always boots into the
   * `"points"` explorer (see `persist.ts`'s `SceneSnapshot`, which omits
   * this field). The flame/solid/surface render SETTINGS ({@link flame} /
   * {@link solid} / {@link surface}) persist independently of it.
   */
  renderMode: RenderMode;
  /**
   * Rotational/mirror symmetry: replicate `transforms` into rotated
   * copies for every render — see `fractal/types.ts`'s `SymmetryParams`.
   * Unlike {@link renderMode} this is NOT session-only:
   * it persists like `colorMode` / `renderStyle`, and it shapes the live
   * explorer's point cloud too, not just the flame/solid renders — `main.ts`'s
   * `regenerate()` threads it into `runChaosGame`.
   */
  symmetry: SymmetryParams;
  /**
   * Manual brightness multiplier for the glow render style:
   * multiplies the density-adaptive auto-exposure every frame (see
   * `main.ts`'s `animate` and `exposure.ts`'s `glowExposure`). Persists like
   * `colorMode` / `renderStyle` / `symmetry` — not session-only, and not
   * nested under a render-settings block like `flame` / `solid` since it has
   * no other fields.
   */
  glowBrightness: number;
  /**
   * The one user-authored gradient slot, shared by the flame and
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
   * The position color mode's three user-picked axis colors (see
   * `color.ts`'s `writePositionColor`). Absent = the legacy XYZ→RGB identity
   * mapping — kept absent rather than storing the identity explicitly, so
   * "absent = legacy" stays the one discriminator and default scenes keep
   * their short URLs (the reducer normalizes an exact identity back to
   * absent). Persists like `customPalette` — optional, written only when
   * present.
   */
  positionAxisColors?: PositionAxisColors;
  /**
   * The scene backdrop (see `background.ts`): the gradient or generated flame
   * image every renderer draws behind the attractor. Persists like `colorMode`
   * / `renderStyle`; only the mode and the gradient modes' authored slots are
   * document state — a generated flame bitmap is transient and regenerated
   * from the system. `persist.ts` omits the pristine default so never-touched
   * scenes keep their short URLs, and decodes an absent field per the LEGACY
   * coupling (haze for an aerial-style document, dark otherwise) so links
   * predating the field render exactly as they always did. The `custom` and
   * `shape` slots survive while the flame mode is selected, exactly like
   * {@link customPalette} surviving while unselected.
   */
  background: BackgroundParams;
  /**
   * Depth-fog density multiplier: scales the fog DISTANCE UNIT for
   * both the point explorer's depthFade/aerial styles (`scene.ts`'s
   * `updateFog`, a plain `THREE.Fog`), every surface tracer (GLSL
   * `uFogDensity` in `surface-material.ts`/`surface-material-4d.ts`, WGSL
   * `params.fogDensity` in `fractal/surface-de-gpu.ts`), and the solid
   * render's voxel raymarcher (`voxel-material.ts`'s own `uFogDensity`) —
   * plus the balloon echo's own radial fade, which shares the same
   * distance-unit intuition (see `scene.ts`'s `syncBalloonEchoUniforms`).
   * Flame carries no fog term and is unaffected. `1` reproduces the
   * pre-control fog rendering exactly — the fixed band every renderer shipped
   * with before this control existed; `0` disables depth fog for the
   * fog-bearing styles (the balloon's far cap then shows as a hard horizon
   * instead of fading to background — deliberate). Top-level rather than
   * nested under {@link AppState.surface} because it spans multiple render
   * modes, the same shape as {@link glowBrightness}. Persists like
   * `glowBrightness` — not session-only.
   */
  fogDensity: number;
  /**
   * Depth-fog tint: a `#rrggbb` color, paired with
   * {@link fogTintStrength}, that shifts what the depth fog blends toward.
   * Every fog-bearing renderer {@link fogDensity} reaches computes
   * `mix(derivedTarget, fogTint, fogTintStrength)` — see `scene.ts`'s
   * `setFogTint` (the points explorer's `applyFogColor`) and the GLSL/WGSL
   * `uFogTint`/`uFogTintStrength` pair in `surface-material.ts`/
   * `surface-material-4d.ts`/`voxel-material.ts`. `derivedTarget` is applied
   * FIRST and stays each renderer's own — the backdrop-midpoint fog color
   * for the points explorer, the sampled per-pixel backdrop
   * gradient for the surface/solid shaders — so the tint applies AFTER that
   * derivation rather than replacing it, and editing the background stays
   * meaningful instead of fighting a baked-in tint target. `#ffffff` is the
   * default — see {@link fogTintStrength} for why the PAIR (not this field
   * alone) is what reproduces the pre-control fog rendering exactly. Top-level
   * rather than nested under {@link AppState.surface}, the same multi-mode
   * reason as {@link fogDensity}. Persists like `fogDensity` — not
   * session-only.
   */
  fogTint: string;
  /**
   * Depth-fog tint blend weight, `[0, 1]` — see {@link fogTint}
   * for the color it blends toward. `0` is the untinted identity: every
   * fog-bearing renderer's `mix(derivedTarget, fogTint, fogTintStrength)`
   * collapses to `derivedTarget` unchanged, bit-exact with the pre-control
   * fog rendering — so an absent document, or one predating these controls,
   * decodes to this default regardless of what `fogTint` decodes to.
   * Range/default single-sourced through {@link PARAM}.fogTintStrength.
   * Persists like `fogDensity` — not session-only.
   */
  fogTintStrength: number;
  /**
   * Whether the surface render's ground plane is showing: an
   * infinite floor beneath the session ball, catching the fractal's
   * penumbra shadow — see `scene.ts`'s `setSurfaceGroundPlane` and
   * `surface-material.ts`'s `SurfaceGroundPlaneSpec`/WGSL `PLANE` arm.
   * Surface-mode only, render-side — unlike {@link balloonEcho} this has no
   * explorer-echo presence in the points render. {@link balloonEcho} takes
   * precedence while both are on: the two never compile/pack together
   * (`surface-de-gpu.ts`'s `groundPlane`+`balloon` exclusion), so `main.ts`
   * resolves the plane flag down to `state.groundPlane && !state.balloonEcho`
   * at the one place both reads happen. Persisted scene content, the same
   * treatment as `balloonEcho`/`fogDensity` — a shared link carries the
   * floor at the state it was authored. `persist.ts`'s decoder is tolerant,
   * like `balloonEcho`'s (an absent/malformed value quietly falls back to
   * off), so a link predating the field still opens with the floor off,
   * exactly as it always rendered.
   */
  groundPlane: boolean;
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
 * GPU accumulation measures ~10G iterations/sec on discrete GPUs (the
 * accumulation spike's addendum), so billion-iteration budgets stay
 * interactive. 2B stays under 2^31, so the value is int32-safe everywhere
 * (worker messages, GPU dispatch counts, etc.) without needing a separate
 * "GPU mode" ceiling.
 */
export const MAX_FLAME_ITERATIONS = 2_000_000_000;
/**
 * Detents for the flame Quality slider (`index.html`'s
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
 * that leaves the original log-density curve unreshaped; 2.4 pushes
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
 * Defaults for the adaptive density-estimation blur (see
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
 * Default flame palette: the classic full-spectrum cosine gradient,
 * so the first flame a user ever renders shows the iridescent structural
 * coloring the feature exists for rather than the flat per-transform hues of
 * `"legacy"`. Both the fresh-session default AND `persist.ts`'s decode
 * fallback for an absent or unrecognized `paletteId`.
 */
export const DEFAULT_FLAME_PALETTE: FlamePaletteId = "spectrum";
/**
 * Solid render defaults and ranges. 192^3 is the detail/memory
 * sweet spot (a 256^3 grid is ~2.4x the memory and allocation risk for a
 * modest sharpness gain); the worker's own byte budget may still clamp the
 * top of this range on constrained devices (see `voxel-worker-core.ts`).
 *
 * The ceiling (512) matches the desktop budget ceiling: 512^3 x 20
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
/** Per-level decay of the surface render's orbit-trap color blend —
 * flam3's "color speed", one render over. 0.5 is the classic
 * halving the blend shipped with; 0 paints each top-level copy a
 * single pure color; 1 weighs every descent level equally (maximum
 * blending). */
export const DEFAULT_SURFACE_COLOR_SPEED = 0.5;
export const MIN_SURFACE_COLOR_SPEED = 0;
export const MAX_SURFACE_COLOR_SPEED = 1;
/** Environment-light strength: how far the surface render's light
 * is tinted toward the backdrop sampled along the shading normal. 0 is a
 * bit-exact identity — the neutral light it replaced. The default is
 * deliberately NON-zero, so this is a look change for scenes encoded before
 * the control existed: an existing shared link renders slightly differently
 * now, and that is intended — the feature ships on.
 *
 * 0.35 IS A MEASURED VALUE, not a guess. The first cut tinted the AMBIENT
 * term alone and was measured INVISIBLE at strength 1 — the maximum — on
 * both built-in backdrops (headless SwiftShader A/B on mandelboxKifs;
 * docs/surface-glsl-tracers.md carries the numbers). Ambient is a quarter
 * of the light and the dark/haze stop pairs are near the same hue, so
 * restricting the tint to it left nothing to see. Tinting the whole lit
 * term reads at this strength without swamping the albedo. */
export const DEFAULT_SURFACE_ENV_LIGHT = 0.35;
export const MIN_SURFACE_ENV_LIGHT = 0;
export const MAX_SURFACE_ENV_LIGHT = 1;
export const DEFAULT_SURFACE_FLOOR_TILE_SCALE = 0.64;
export const MIN_SURFACE_FLOOR_TILE_SCALE = 0.1;
export const MAX_SURFACE_FLOOR_TILE_SCALE = 2;
export const DEFAULT_SURFACE_FLOOR_EMISSION = 0;
export const MIN_SURFACE_FLOOR_EMISSION = 0;
export const MAX_SURFACE_FLOOR_EMISSION = 4;
/**
 * Default solid-render palette: the same spectrum gradient as
 * {@link DEFAULT_FLAME_PALETTE}, for one coherent default look across both
 * converging renders. Like the flame default, this is both the
 * fresh-session default AND `persist.ts`'s decode fallback for an absent or
 * unrecognized `paletteId`.
 */
export const DEFAULT_SOLID_PALETTE: FlamePaletteId = "spectrum";
/**
 * Default ramp palette for the explorer's height/radius color modes
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
 * 12 is the ceiling because `effectiveSymmetryOrder` in `chaos-game.ts`
 * already clamps the actually-used order down to fit `MAX_TRANSFORMS` (256),
 * and 12 is exactly enough for e.g. a 20-map preset's 12-fold symmetry
 * (20*12=240<=256) without silently losing a value a shared URL might carry.
 * The UI slider spans this same range — it used to cap at 9,
 * so a shared link at 10-12 was silently rewritten the moment the slider
 * was touched.
 */
export const MAX_SYMMETRY_ORDER = 12;
/**
 * The plane the kaleidoscope turns in by default. `"xz"` is the
 * legacy default axis `"y"` under the new vocabulary — the SAME rotation
 * (see `chaos-game.ts`'s `symmetryRotation`), so this default did not move
 * when the field was renamed. Both the fresh-session default AND
 * `persist.ts`'s decode fallback for an absent/unrecognized `plane` (and for
 * an unrecognized legacy `axis`).
 */
export const DEFAULT_SYMMETRY_PLANE: SymmetryPlane = "xz";
/**
 * The kaleidoscope's default TWIST: `0`, a simple rotation — what
 * every document written before the field existed means, and the only value
 * the 3D paths ever see. Ranges `[0, MAX_SYMMETRY_ORDER - 1]` because copy
 * `k`'s second angle is `2π·k·twist / order`, so `order` twists is a full
 * turn and only values below the order are distinct; `persist.ts` tightens
 * the ceiling to the DOCUMENT's own order on decode.
 */
export const DEFAULT_SYMMETRY_TWIST = 0;
export const MIN_SYMMETRY_TWIST = 0;
export const MAX_SYMMETRY_TWIST = MAX_SYMMETRY_ORDER - 1;
/**
 * Manual brightness multiplier for the glow render style, applied on
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
 * Color-contrast exponent defaults and range — see
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
 * Default 4D color mode: the original diverging blue/orange w
 * ramp, so pre-existing scenes (whose links never carried the field) render
 * exactly as before this option existed.
 */
export const DEFAULT_FOUR_D_COLOR: FourDColorMode = "wBlueOrange";
/**
 * 4D per-map extension ranges — see `fractal/types.ts`'s
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
 * `w.scale`'s bounds apply to its MAGNITUDE only: the sign is
 * a 4D reflection, expressed in the editor as a magnitude slider plus a
 * Mirror W toggle (the 3D scale channel's pattern one dimension up) and
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
 * Balloon echo radius range/default — see
 * {@link AppState.balloonRadius}. Persisted scene content: `persist.ts`
 * clamps a decoded value into this exact range via {@link PARAM}, the same
 * clamp {@link setBalloonRadius} applies to a live edit. The numbers
 * themselves predate persistence and need no revisiting:
 * {@link DEFAULT_BALLOON_RADIUS} (1.6) sits past the attractor's own
 * extent (`rMult = 1` touches it) — the "rest" pose the Inflate replay
 * (`main.ts`) sweeps toward. The floor (0.05) is a visibly crumpled
 * near-center ball; the ceiling (2.5) keeps the echo's shell comfortably
 * inside `BALLOON_FAR_CAP_RHO`'s march cap (`fractal/balloon-de.ts`) at
 * every slider position.
 */
export const DEFAULT_BALLOON_RADIUS = 1.6;
export const MIN_BALLOON_RADIUS = 0.05;
export const MAX_BALLOON_RADIUS = 2.5;
/**
 * Balloon tint default — see {@link AppState.balloonTint}. At
 * {@link DEFAULT_BALLOON_TINT_STRENGTH} (0) the colour is inert whatever it
 * is, exactly as {@link DEFAULT_FOG_TINT}'s own doc says of white, so this
 * value is chosen for what it does at NONZERO strength rather than for the
 * identity: `mix(base, black, s)` is `base * (1 - s)`, so the strength
 * slider ALONE reads as a DIMMER until the user picks a colour. That is the
 * "dimmer" half of the balloon-tint ask, bought from the tint pair instead
 * of a third slider — and it is why promoting `scene.ts`'s
 * `BALLOON_ECHO_DIM` was refused: one shared brightness field would have
 * had to carry two different "today" values (0.5 in the additive-points
 * echo, 1.0 in the lit-surface shell), so no single default could be
 * byte-identical in both arms, where strength 0 is.
 */
export const DEFAULT_BALLOON_TINT = "#000000";
/**
 * Balloon tint blend strength range/default — see
 * {@link AppState.balloonTintStrength}. `0` is the untinted identity:
 * `mix(base, balloonTint, 0)` is exactly `base` in every arm, matching
 * today's balloon rendering bit-exactly regardless of what
 * {@link DEFAULT_BALLOON_TINT} decodes to — the same shape as
 * {@link DEFAULT_FOG_TINT_STRENGTH}. `1` fully replaces the shell's base
 * colour with {@link AppState.balloonTint}.
 */
export const DEFAULT_BALLOON_TINT_STRENGTH = 0;
export const MIN_BALLOON_TINT_STRENGTH = 0;
export const MAX_BALLOON_TINT_STRENGTH = 1;
/**
 * Depth-fog density range/default — see
 * {@link AppState.fogDensity}. `1` is the neutral default: it reproduces the
 * fixed fog band every renderer used before this control existed — the
 * points explorer's `updateFog` arithmetic is unchanged at `d = 1`, and the
 * GLSL/WGSL fog terms multiply the traveled distance by density INSIDE the
 * term, so `1` is an identity multiply there too. `0` disables depth fog
 * outright (see `scene.ts`'s `updateFog` for how the fog-bearing styles
 * honor that without touching `setRenderStyle`'s own fog on/off switching).
 * `2.5` thickens the atmosphere to a still-legible haze rather than a total
 * whiteout.
 */
export const DEFAULT_FOG_DENSITY = 1;
export const MIN_FOG_DENSITY = 0;
export const MAX_FOG_DENSITY = 2.5;
/**
 * Fog tint default — see {@link AppState.fogTint}. White is the
 * identity color: paired with {@link DEFAULT_FOG_TINT_STRENGTH} (0), the
 * `mix` every fog-bearing renderer applies collapses to its own derived
 * target regardless of `fogTint`'s exact value, so this is what an
 * absent document — or one predating these controls — decodes to.
 */
export const DEFAULT_FOG_TINT = "#ffffff";
/**
 * Fog tint strength range/default — see
 * {@link AppState.fogTintStrength}. `0` is the untinted identity: every
 * fog-bearing renderer's blend collapses to its own derived target
 * unchanged, matching the pre-control fog rendering bit-exactly. `1` fully
 * replaces the derived target with {@link AppState.fogTint}.
 */
export const DEFAULT_FOG_TINT_STRENGTH = 0;
export const MIN_FOG_TINT_STRENGTH = 0;
export const MAX_FOG_TINT_STRENGTH = 1;

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
  // Surface render lighting is the SAME physical quantity as the
  // solid render's lighting just above (a horizontal light angle, a height
  // above the horizon, a fill-light floor) — these three reuse the solid
  // MIN_/MAX_/DEFAULT_ constants directly rather than redeclaring identical
  // ranges under a new name.
  surfaceLightAzimuth: {
    min: MIN_SOLID_LIGHT_AZIMUTH,
    max: MAX_SOLID_LIGHT_AZIMUTH,
    default: DEFAULT_SOLID_LIGHT_AZIMUTH,
  },
  surfaceLightElevation: {
    min: MIN_SOLID_LIGHT_ELEVATION,
    max: MAX_SOLID_LIGHT_ELEVATION,
    default: DEFAULT_SOLID_LIGHT_ELEVATION,
  },
  surfaceAmbient: {
    min: MIN_SOLID_AMBIENT,
    max: MAX_SOLID_AMBIENT,
    default: DEFAULT_SOLID_AMBIENT,
  },
  surfaceColorSpeed: {
    min: MIN_SURFACE_COLOR_SPEED,
    max: MAX_SURFACE_COLOR_SPEED,
    default: DEFAULT_SURFACE_COLOR_SPEED,
  },
  surfaceEnvLight: {
    min: MIN_SURFACE_ENV_LIGHT,
    max: MAX_SURFACE_ENV_LIGHT,
    default: DEFAULT_SURFACE_ENV_LIGHT,
  },
  surfaceFloorTileScale: {
    min: MIN_SURFACE_FLOOR_TILE_SCALE,
    max: MAX_SURFACE_FLOOR_TILE_SCALE,
    default: DEFAULT_SURFACE_FLOOR_TILE_SCALE,
  },
  surfaceFloorEmission: {
    min: MIN_SURFACE_FLOOR_EMISSION,
    max: MAX_SURFACE_FLOOR_EMISSION,
    default: DEFAULT_SURFACE_FLOOR_EMISSION,
  },
  symmetryOrder: {
    min: MIN_SYMMETRY_ORDER,
    max: MAX_SYMMETRY_ORDER,
    default: DEFAULT_SYMMETRY_ORDER,
    round: true,
  },
  symmetryTwist: {
    min: MIN_SYMMETRY_TWIST,
    max: MAX_SYMMETRY_TWIST,
    default: DEFAULT_SYMMETRY_TWIST,
    round: true,
  },
  glowBrightness: {
    min: MIN_GLOW_BRIGHTNESS,
    max: MAX_GLOW_BRIGHTNESS,
    default: DEFAULT_GLOW_BRIGHTNESS,
  },
  balloonRadius: {
    min: MIN_BALLOON_RADIUS,
    max: MAX_BALLOON_RADIUS,
    default: DEFAULT_BALLOON_RADIUS,
  },
  balloonTintStrength: {
    min: MIN_BALLOON_TINT_STRENGTH,
    max: MAX_BALLOON_TINT_STRENGTH,
    default: DEFAULT_BALLOON_TINT_STRENGTH,
  },
  fogDensity: {
    min: MIN_FOG_DENSITY,
    max: MAX_FOG_DENSITY,
    default: DEFAULT_FOG_DENSITY,
  },
  fogTintStrength: {
    min: MIN_FOG_TINT_STRENGTH,
    max: MAX_FOG_TINT_STRENGTH,
    default: DEFAULT_FOG_TINT_STRENGTH,
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
    balloonEcho: false,
    balloonRadius: DEFAULT_BALLOON_RADIUS,
    balloonPaletteId: DEFAULT_BALLOON_PALETTE,
    balloonTint: DEFAULT_BALLOON_TINT,
    balloonTintStrength: DEFAULT_BALLOON_TINT_STRENGTH,
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
    surface: {
      lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
      lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
      ambient: DEFAULT_SOLID_AMBIENT,
      colorSource: "transform",
      paletteId: DEFAULT_SOLID_PALETTE,
      colorSpeed: DEFAULT_SURFACE_COLOR_SPEED,
      envLight: DEFAULT_SURFACE_ENV_LIGHT,
      floorPattern: "solid",
      floorTileScale: DEFAULT_SURFACE_FLOOR_TILE_SCALE,
      floorEmission: DEFAULT_SURFACE_FLOOR_EMISSION,
    },
    renderMode: "points",
    symmetry: { order: DEFAULT_SYMMETRY_ORDER, plane: DEFAULT_SYMMETRY_PLANE },
    glowBrightness: DEFAULT_GLOW_BRIGHTNESS,
    background: { mode: "dark" },
    fogDensity: DEFAULT_FOG_DENSITY,
    fogTint: DEFAULT_FOG_TINT,
    fogTintStrength: DEFAULT_FOG_TINT_STRENGTH,
    groundPlane: false,
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
 * see `WExtension`'s docs). The single editor (`ui.ts`) always
 * emits every other field but includes `w` only when its own working copy is
 * non-empty, so an ordinary edit that never touched the 4D group carries no
 * `w` key at all — this spread then leaves an existing `w` block untouched.
 * Full replacement, never a field-by-field merge, happens only when the
 * caller actually supplies a `w`.
 *
 * The two optional structural-color fields ride the same discipline: the
 * editor emits `colorIndex`/`colorSpeed` only once their sliders have actually
 * been moved, so this spread preserves absence — which is what keeps an
 * unauthored map on its derived palette slot through any other edit.
 */
export function updateTransform(
  state: AppState,
  index: number,
  geometry: Pick<
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

/**
 * Strip one system-B entry to the affine-only shape the schedule stores
 * (`types.ts`'s {@link HybridSchedule}: position/rotation/scale, shear when
 * non-zero, weight when non-1 — no variations, no `w`, no chaos, no
 * color/finish fields). The one strip definition every B producer funnels
 * through ({@link setSchedule} applies it to whatever source the picker
 * chose), so a preset, a saved scene and a current-system snapshot all
 * store the identical vocabulary and `persist.ts`'s affine-only codec leg
 * never meets a field it would drop.
 */
export function stripScheduleTransform(t: Transform, id: number): Transform {
  const stripped: Transform = {
    id,
    position: [...t.position],
    rotation: [...t.rotation],
    scale: [...t.scale],
  };
  if (t.shear && t.shear.some((v) => v !== 0)) stripped.shear = [...t.shear];
  if (t.weight !== undefined && t.weight !== 1) stripped.weight = t.weight;
  return stripped;
}

/**
 * Install/replace the scheduled-hybrid post-word block, or clear it with
 * `null`. THE DOCUMENT RULE LIVES HERE: entries are stripped to affine-only
 * ({@link stripScheduleTransform}), depth floors to an integer and clamps
 * into 1..{@link MAX_SCHEDULE_DEPTH}, and a depth of 0 or below — or an
 * empty B list — stores ABSENT (`undefined`, the classic-removal rule), so
 * the persisted snapshot of an unauthored scene stays byte-identical and
 * `chaos-game.ts`'s `resolveScheduleDepth` can never see a half-formed
 * block from this app's own state.
 */
export function setSchedule(
  state: AppState,
  schedule: { transforms: Transform[]; depth: number } | null,
): AppState {
  if (!schedule || schedule.transforms.length === 0) {
    return { ...state, schedule: undefined };
  }
  const depth = Math.min(
    Math.floor(Number.isFinite(schedule.depth) ? schedule.depth : 0),
    MAX_SCHEDULE_DEPTH,
  );
  if (depth <= 0) return { ...state, schedule: undefined };
  return {
    ...state,
    schedule: {
      transforms: schedule.transforms.map(stripScheduleTransform),
      depth,
    },
  };
}

/**
 * Move the schedule's depth slider: re-installs the current block at the
 * new depth through {@link setSchedule}'s one domain (so 0 removes the
 * block — the classic-removal rule — and out-of-range clamps). A no-op
 * without a block: depth is a property OF the post-word, and there is
 * nothing for a bare depth to mean before a B system is chosen.
 */
export function setScheduleDepth(state: AppState, depth: number): AppState {
  if (!state.schedule) return state;
  return setSchedule(state, { ...state.schedule, depth });
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
 * Set how the 4D projection colors points. Not clamped — it is an
 * enum (see `fractal/types.ts`'s `FourDColorMode`), and the UI only offers
 * valid values (persistence validates untrusted input in `decodeScene`), like
 * {@link setSymmetryPlane}.
 */
export function setFourDColor(
  state: AppState,
  fourDColor: FourDColorMode,
): AppState {
  return { ...state, fourDColor };
}

/** Toggle the 4D projection's camera-depth fade — see
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
 * Set the height/radius ramps' gradient palette. Not clamped — it
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
 * Set the position color mode's axis colors. Setting the exact
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

/** Toggle the balloon echo. Session-only, like
 * {@link setAdaptiveResolution}. */
export function setBalloonEcho(
  state: AppState,
  balloonEcho: boolean,
): AppState {
  return { ...state, balloonEcho };
}

/** Set the balloon echo's normalized radius, clamped to
 * {@link PARAM}.balloonRadius's range. */
export function setBalloonRadius(
  state: AppState,
  balloonRadius: number,
): AppState {
  return {
    ...state,
    balloonRadius: clampToSpec(PARAM.balloonRadius, balloonRadius),
  };
}

/**
 * Select the shared balloon palette without touching any primary-fractal
 * palette selection or its {@link AppState.customPalette} payload. A first
 * switch to Custom seeds the balloon's own slot from the built-in gradient
 * being replaced. Inherit has no single gradient to sample — its color source
 * differs by renderer — so that transition deliberately seeds Spectrum, the
 * app's established total-function fallback for a palette with no LUT.
 */
export function setBalloonPaletteId(
  state: AppState,
  balloonPaletteId: BalloonPaletteSelection,
): AppState {
  const seedFrom: PaletteSelection =
    state.balloonPaletteId === BALLOON_PALETTE_INHERIT
      ? DEFAULT_FLAME_PALETTE
      : state.balloonPaletteId;
  return {
    ...state,
    balloonPaletteId,
    ...(balloonPaletteId === CUSTOM_PALETTE_ID &&
    state.balloonCustomPalette === undefined
      ? { balloonCustomPalette: { stops: seedCustomStops(seedFrom) } }
      : {}),
  };
}

/**
 * Replace only the balloon's Custom gradient, applying the same bounds,
 * finite-value validation, copying, and channel clamping as the primary
 * custom-palette reducer. Invalid input is a no-op.
 */
export function setBalloonCustomPaletteStops(
  state: AppState,
  stops: readonly RgbStop[],
): AppState {
  const cleaned = sanitizeCustomPaletteStops(stops);
  return cleaned === null
    ? state
    : { ...state, balloonCustomPalette: { stops: cleaned } };
}

/**
 * Set the balloon tint color — see {@link AppState.balloonTint}.
 * Strict, like {@link setFogTint}: this reducer's own input IS the raw
 * string, so it is the validation boundary rather than a caller upstream of
 * it. Normalizes to lowercase; a string that doesn't match `#rrggbb`
 * (case-insensitive) leaves state unchanged, mirroring `decodeScene`'s own
 * quiet-reject contract for a malformed value one layer out.
 */
export function setBalloonTint(state: AppState, balloonTint: string): AppState {
  if (!/^#[0-9a-f]{6}$/i.test(balloonTint)) return state;
  return { ...state, balloonTint: balloonTint.toLowerCase() };
}

/**
 * Set the balloon tint's blend strength, clamped to
 * {@link PARAM}.balloonTintStrength's range — see
 * {@link AppState.balloonTintStrength} for what `0`/`1` mean.
 */
export function setBalloonTintStrength(
  state: AppState,
  balloonTintStrength: number,
): AppState {
  return {
    ...state,
    balloonTintStrength: clampToSpec(
      PARAM.balloonTintStrength,
      balloonTintStrength,
    ),
  };
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
 * A fresh switch TO {@link CUSTOM_PALETTE_ID} — `customPalette` not
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
 * Switch which renderer displays the attractor — see
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
 * A fresh switch TO {@link CUSTOM_PALETTE_ID} — `customPalette` not
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

/** Set the surface render's light horizontal angle (degrees), clamped.
 * Live-reactive — see {@link SurfaceParams}'s doc: unlike the solid render's
 * identically-named setter, the surface tracer has no accumulation to
 * restart at all. */
export function setSurfaceLightAzimuth(
  state: AppState,
  lightAzimuth: number,
): AppState {
  return {
    ...state,
    surface: {
      ...state.surface,
      lightAzimuth: clampToSpec(PARAM.surfaceLightAzimuth, lightAzimuth),
    },
  };
}

/** Set the surface render's light height above the horizon (degrees),
 * clamped. Live-reactive like {@link setSurfaceLightAzimuth}. */
export function setSurfaceLightElevation(
  state: AppState,
  lightElevation: number,
): AppState {
  return {
    ...state,
    surface: {
      ...state.surface,
      lightElevation: clampToSpec(PARAM.surfaceLightElevation, lightElevation),
    },
  };
}

/** Set the surface render's fill-light floor, clamped. Live-reactive like
 * {@link setSurfaceLightAzimuth}. */
export function setSurfaceAmbient(state: AppState, ambient: number): AppState {
  return {
    ...state,
    surface: {
      ...state.surface,
      ambient: clampToSpec(PARAM.surfaceAmbient, ambient),
    },
  };
}

/** Set the surface render's orbit-trap color speed, clamped.
 * Live-reactive like {@link setSurfaceLightAzimuth}. */
export function setSurfaceColorSpeed(
  state: AppState,
  colorSpeed: number,
): AppState {
  return {
    ...state,
    surface: {
      ...state.surface,
      colorSpeed: clampToSpec(PARAM.surfaceColorSpeed, colorSpeed),
    },
  };
}

/** Set the surface render's environment-light strength, clamped.
 * Live-reactive like {@link setSurfaceLightAzimuth}. */
export function setSurfaceEnvLight(
  state: AppState,
  envLight: number,
): AppState {
  return {
    ...state,
    surface: {
      ...state.surface,
      envLight: clampToSpec(PARAM.surfaceEnvLight, envLight),
    },
  };
}

export function setSurfaceFloorPattern(
  state: AppState,
  floorPattern: SurfaceFloorPattern,
): AppState {
  return { ...state, surface: { ...state.surface, floorPattern } };
}

export function setSurfaceFloorTileScale(
  state: AppState,
  floorTileScale: number,
): AppState {
  return {
    ...state,
    surface: {
      ...state.surface,
      floorTileScale: clampToSpec(PARAM.surfaceFloorTileScale, floorTileScale),
    },
  };
}

export function setSurfaceFloorEmission(
  state: AppState,
  floorEmission: number,
): AppState {
  return {
    ...state,
    surface: {
      ...state.surface,
      floorEmission: clampToSpec(PARAM.surfaceFloorEmission, floorEmission),
    },
  };
}

/**
 * Set the surface render's base-color source — see
 * {@link SurfaceColorSource}. Not clamped — it is an enum, and the UI only
 * offers valid values (persistence validates untrusted input in
 * `decodeScene`), like {@link setFourDColor}'s sibling enum field. Unlike a
 * flame/solid palette switch, there is no accumulation for the old source to
 * be baked into, so this is live-reactive: nothing restarts.
 */
export function setSurfaceColorSource(
  state: AppState,
  colorSource: SurfaceColorSource,
): AppState {
  return { ...state, surface: { ...state.surface, colorSource } };
}

/**
 * Set the surface render's structural-coloring palette (shares
 * the flame render's `PaletteSelection` union — see `palette.ts`). Not
 * clamped — it is an enum, and the UI only offers valid ids (persistence
 * validates untrusted input in `decodeScene`). Live-reactive, unlike
 * {@link setFlamePaletteId}/{@link setSolidPaletteId}: the surface tracer
 * has no accumulation for the old palette to be baked into, so nothing
 * restarts.
 *
 * A fresh switch TO {@link CUSTOM_PALETTE_ID} — `customPalette` not
 * yet set — seeds it from the palette being REPLACED (the previous
 * `surface.paletteId`), via `palette.ts`'s {@link seedCustomStops}, exactly
 * like {@link setFlamePaletteId}/{@link setSolidPaletteId}. Picking a preset
 * id, or re-picking Custom when a payload already exists, leaves
 * `customPalette` untouched.
 */
export function setSurfacePaletteId(
  state: AppState,
  paletteId: PaletteSelection,
): AppState {
  return {
    ...state,
    surface: { ...state.surface, paletteId },
    ...(paletteId === CUSTOM_PALETTE_ID && state.customPalette === undefined
      ? { customPalette: { stops: seedCustomStops(state.surface.paletteId) } }
      : {}),
  };
}

/**
 * Replace the user-authored gradient's stops — the gradient editor's
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
  const cleaned = sanitizeCustomPaletteStops(stops);
  return cleaned === null
    ? state
    : { ...state, customPalette: { stops: cleaned } };
}

/** Shared live-editor validation for the primary and balloon custom slots. */
function sanitizeCustomPaletteStops(
  stops: readonly RgbStop[],
): RgbStop[] | null {
  if (stops.length < MIN_CUSTOM_PALETTE_STOPS) return null;
  const trimmed = stops.slice(0, MAX_CUSTOM_PALETTE_STOPS);
  if (trimmed.some((stop) => stop.some((channel) => !Number.isFinite(channel))))
    return null;
  const cleaned: RgbStop[] = trimmed.map(([r, g, b]): RgbStop => [
    clamp(r, 0, 1),
    clamp(g, 0, 1),
    clamp(b, 0, 1),
  ]);
  return cleaned;
}

/**
 * Whether the CURRENT system needs the 4D projection view — the derived
 * condition that makes "4D" a property of `state.transforms` /
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
  return systemPartsAreNonFlat(
    state.transforms,
    state.finalTransform ?? null,
    state.symmetry,
  );
}

/**
 * The twist rule — clamp to the spec, cap at the symmetry block's OWN order's
 * last distinct value (`order` twists is a full turn), and store `0` as an
 * ABSENT field — applied to `symmetry`. ONE definition, shared by both setters
 * that can move it: {@link setSymmetryTwist} sets it, and
 * {@link setSymmetryOrder} re-applies it to the twist already stored, since a
 * cap written against the order at the time of the edit stops holding the
 * moment the order moves.
 */
function withSymmetryTwist(
  symmetry: SymmetryParams,
  twist: number,
): SymmetryParams {
  const clamped = Math.min(
    clampToSpec(PARAM.symmetryTwist, twist),
    symmetry.order - 1,
  );
  const { twist: _dropped, ...rest } = symmetry;
  return clamped === 0 ? rest : { ...rest, twist: clamped };
}

/**
 * Set the kaleidoscope's replica count, rounded to the nearest integer and
 * clamped to a sane range, exactly like {@link setFlameSupersample}. Persists
 * and reshapes the live explorer's point cloud as well as the flame/solid
 * renders — see {@link AppState.symmetry}.
 *
 * LOWERING THE ORDER RE-CAPS THE TWIST it is already carrying, by
 * the same {@link withSymmetryTwist} rule {@link setSymmetryTwist} applies —
 * absent stays absent, and a twist that caps to `0` DROPS to absent exactly as
 * that setter would leave it. Without this, `{order: 12, twist: 7}` lowered to
 * order 3 kept a twist no twist edit could have produced (the slider's own max
 * is a static `MAX_SYMMETRY_ORDER - 1`, so nothing else recomputes it), which
 * the live chaos game rendered while `persist.ts`'s decoder capped it back to
 * `order - 1` on the way in: the scene on screen and the scene that was
 * saved/shared/reloaded/undone were different attractors.
 */
export function setSymmetryOrder(state: AppState, order: number): AppState {
  const symmetry = {
    ...state.symmetry,
    order: clampToSpec(PARAM.symmetryOrder, order),
  };
  return {
    ...state,
    symmetry: withSymmetryTwist(symmetry, symmetry.twist ?? 0),
  };
}

/**
 * Set the plane the kaleidoscope's copies rotate in. Not clamped — it is
 * an enum (see `fractal/types.ts`'s `SymmetryPlane`), and the UI only offers
 * valid values (persistence validates untrusted input in `decodeScene`), like
 * {@link setFlamePaletteId}.
 *
 * A `w`-plane makes the system 4D (`affine4.ts`'s `symmetryIsNonFlat`), so
 * this is one of the few settings that can flip {@link systemIsNonFlat}
 * without touching a transform.
 */
export function setSymmetryPlane(
  state: AppState,
  plane: SymmetryPlane,
): AppState {
  return { ...state, symmetry: { ...state.symmetry, plane } };
}

/**
 * Set the kaleidoscope's twist — the second angle of a 4D double rotation, in
 * sectors (see `SymmetryParams.twist`). Rounded and clamped like
 * {@link setSymmetryOrder}, then additionally capped at the CURRENT order's
 * last distinct value (`order - 1`): `order` twists is a full turn, so higher
 * values only restate lower ones. `0` — a simple rotation — is stored as an
 * ABSENT field, so a system that never twists keeps the exact object shape it
 * had before the field existed.
 *
 * Like {@link setSymmetryPlane}, a nonzero twist makes the system 4D.
 */
export function setSymmetryTwist(state: AppState, twist: number): AppState {
  return { ...state, symmetry: withSymmetryTwist(state.symmetry, twist) };
}

/**
 * The palette the `"auto"` backdrop tracks: the ACTIVE render's
 * own palette select — the flame/solid/surface `paletteId` while that
 * render is showing, else the explorer's {@link AppState.rampPaletteId}.
 * Deliberately COARSE: it reads only {@link AppState.renderMode}, never the
 * color mode / color source that decides whether the palette is visible in
 * the current frame, so the backdrop has one stable answer per render mode
 * instead of re-deriving on every color-mode flip. (The explorer's default
 * ramp is `"legacy"` — no gradient — so a fresh scene's auto backdrop is
 * the dark ground until a palette actually enters the picture.)
 */
export function activeScenePalette(state: AppState): PaletteSpec {
  const id =
    state.renderMode === "flame"
      ? state.flame.paletteId
      : state.renderMode === "solid"
        ? state.solid.paletteId
        : state.renderMode === "surface"
          ? state.surface.paletteId
          : state.rampPaletteId;
  return resolvePalette(id, state.customPalette);
}

/**
 * Resolve the balloon-only gradient for renderer consumers. `null` is the
 * explicit Inherit signal; every concrete selection resolves through the
 * balloon's independent Custom slot and can be passed directly to the shared
 * palette LUT builders.
 */
export function resolveBalloonPalette(state: AppState): PaletteSpec | null {
  return state.balloonPaletteId === BALLOON_PALETTE_INHERIT
    ? null
    : resolvePalette(state.balloonPaletteId, state.balloonCustomPalette);
}

/**
 * Resolve the generated Flame backdrop's own authored palette. Unlike
 * {@link activeScenePalette}, this never follows the renderer currently in
 * front of the backdrop: a points renderer whose ramp is `"legacy"` must not
 * force the decorative flame back to per-transform coloring. An absent field
 * is the persisted-default shorthand for {@link DEFAULT_FLAME_PALETTE}.
 */
export function resolveFlameBackdropPalette(state: AppState): PaletteSpec {
  return resolvePalette(
    state.background.flamePaletteId ?? DEFAULT_FLAME_PALETTE,
    state.customPalette,
  );
}

/**
 * The one state-aware gradient/placeholder backdrop resolution:
 * `resolveBackground`
 * with the {@link activeScenePalette} supplied, so `"auto"` derives from
 * what the scene is actually showing. Every consumer that holds an
 * {@link AppState} resolves through THIS (main.ts's pushes, the
 * custom-slot seeding below); the palette-less `resolveBackground` overload
 * stays only for callers with no state in hand. In `"flame"` mode this is the
 * dark placeholder, not the generated bitmap (which is transient render
 * state).
 */
export function resolveSceneBackground(state: AppState): BackgroundGradient {
  return resolveBackground(state.background, activeScenePalette(state));
}

/**
 * Set which backdrop the scene renders — see
 * {@link AppState.background}. Not clamped — it is an enum (see
 * `background.ts`'s `BACKGROUND_MODES`), and the UI only offers valid values
 * (persistence validates untrusted input in `decodeScene`), like
 * {@link setRenderStyle}.
 *
 * A fresh switch TO `"custom"` — no authored gradient yet — seeds the custom
 * slot from the backdrop being REPLACED (the resolved stops of the previous
 * mode, an `"auto"` predecessor's derived stops included), so
 * Custom starts as a tweakable copy of the current look: the exact
 * {@link setFlamePaletteId}/`seedCustomStops` discipline, applied to the
 * backdrop. Picking a built-in or generated mode, or re-picking Custom when a
 * payload already exists, leaves the authored slot untouched — selecting a
 * backdrop must never clear authored colors. Since a generated image is not a
 * two-stop gradient, switching from Flame to a never-authored Custom slot
 * seeds the dark placeholder returned by {@link resolveSceneBackground}.
 */
export function setBackgroundMode(
  state: AppState,
  mode: BackgroundMode,
): AppState {
  const seed =
    mode === "custom" && state.background.custom === undefined
      ? { custom: resolveSceneBackground(state) }
      : {};
  return { ...state, background: { ...state.background, mode, ...seed } };
}

/**
 * Replace the custom backdrop's authored gradient — both color
 * pickers funnel through this one reducer with the whole new stop pair.
 * Never clamped: the UI's `<input type="color">` → `hexToRgb` path can only
 * produce valid 0..1 channels (the {@link setPositionAxisColors} contract),
 * and persistence re-validates untrusted input in `decodeScene`. Leaves
 * `mode` untouched — the pickers are only reachable while Custom is
 * selected, and an edit to the slot while it isn't selected is inert but
 * stored, like any other render-settings edit.
 */
export function setBackgroundCustom(
  state: AppState,
  custom: BackgroundGradient,
): AppState {
  return { ...state, background: { ...state.background, custom } };
}

/**
 * Set the backdrop's gradient SHAPE — orthogonal to `mode` (see
 * {@link BackgroundParams.shape}). Not clamped, same enum discipline as
 * {@link setBackgroundMode} (`background-shape.ts`'s `BACKGROUND_SHAPES`;
 * persistence validates untrusted input). Leaves `mode`/`custom` untouched.
 */
export function setBackgroundShape(
  state: AppState,
  shape: BackgroundShape,
): AppState {
  return { ...state, background: { ...state.background, shape } };
}

/**
 * Set the generated Flame backdrop's structural-coloring palette. The value
 * remains authored when another background mode is selected. A first switch
 * to Custom seeds the app's shared custom-gradient slot from the backdrop
 * palette being replaced, matching the full Flame/Solid palette controls.
 */
export function setBackgroundFlamePaletteId(
  state: AppState,
  flamePaletteId: PaletteSelection,
): AppState {
  const previous = state.background.flamePaletteId ?? DEFAULT_FLAME_PALETTE;
  return {
    ...state,
    background: { ...state.background, flamePaletteId },
    ...(flamePaletteId === CUSTOM_PALETTE_ID &&
    state.customPalette === undefined
      ? { customPalette: { stops: seedCustomStops(previous) } }
      : {}),
  };
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

/**
 * Set the depth-fog density multiplier, clamped to
 * {@link PARAM}.fogDensity's range — see {@link AppState.fogDensity} for
 * what `0`/`1` mean.
 */
export function setFogDensity(state: AppState, fogDensity: number): AppState {
  return {
    ...state,
    fogDensity: clampToSpec(PARAM.fogDensity, fogDensity),
  };
}

/**
 * Set the fog tint color — see {@link AppState.fogTint}. Strict,
 * unlike `setPositionAxisColors`/`setBackgroundCustom` (which trust an
 * already-parsed `<input type="color">` → `hexToRgb` value): this reducer's
 * own input IS the raw string, so it is the validation boundary rather than
 * a caller upstream of it. Normalizes to lowercase; a string that doesn't
 * match `#rrggbb` (case-insensitive) leaves state unchanged, mirroring
 * `decodeScene`'s own quiet-reject contract for a malformed value one layer
 * out.
 */
export function setFogTint(state: AppState, fogTint: string): AppState {
  if (!/^#[0-9a-f]{6}$/i.test(fogTint)) return state;
  return { ...state, fogTint: fogTint.toLowerCase() };
}

/**
 * Set the fog tint's blend strength, clamped to
 * {@link PARAM}.fogTintStrength's range — see {@link AppState.fogTintStrength}
 * for what `0`/`1` mean.
 */
export function setFogTintStrength(
  state: AppState,
  fogTintStrength: number,
): AppState {
  return {
    ...state,
    fogTintStrength: clampToSpec(PARAM.fogTintStrength, fogTintStrength),
  };
}

/**
 * Toggle the surface ground plane — see
 * {@link AppState.groundPlane}. No validation boundary needed: unlike
 * `setFogTint`'s raw-string input, this reducer's own parameter is already
 * the checkbox's `boolean`.
 */
export function setGroundPlane(
  state: AppState,
  groundPlane: boolean,
): AppState {
  return { ...state, groundPlane };
}
