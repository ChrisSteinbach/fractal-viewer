import {
  buildColorModeLUT,
  LEGACY_POSITION_AXIS_COLORS,
  transformColors,
  W_SIDE_PALETTES,
  wRampColor,
} from "../fractal/color";
import type { PositionAxisColors } from "../fractal/color";
import { buildPaletteLUT, resolvePalette } from "../fractal/palette";
import type { PaletteSelection, PaletteSpec } from "../fractal/palette";
import type { Transform, Vec3, WDepthColorMode } from "../fractal/types";
import { to255 } from "../fractal/vec";
import type { AppState } from "./state";
import { surfaceColorLUT } from "./control-spec";
import { deriveSurfaceEligibility } from "./surface-eligibility";

/**
 * The color legend as DATA: what the panel's unobtrusive key for "what do the
 * current view's colors mean" should show, derived from {@link AppState}
 * alone. `ui.ts` only PAINTS the result — every branch that decides between a
 * gradient bar, a swatch strip and nothing at all lives here, so it is
 * testable without a DOM the way `control-spec.ts` is (see
 * `legend-spec.test.ts`, which carries no jsdom pragma).
 *
 * The three families and their priority order are documented at
 * {@link deriveLegend}.
 */
export type LegendSpec =
  /** Nothing to key — the panel hides the legend outright. */
  | { readonly kind: "hidden" }
  /**
   * A gradient bar with low/mid/high labels (an empty string renders blank).
   * The shared shape of the colorMode ramps, the palette strips, and the 4D
   * w ramp.
   */
  | {
      readonly kind: "bar";
      /** A CSS `linear-gradient(...)` string, ready for `backgroundImage`. */
      readonly gradient: string;
      readonly low: string;
      readonly mid: string;
      readonly high: string;
    }
  /**
   * A strip of discrete color swatches, optionally interleaved with short
   * text labels — the by-transform key (swatches, then a trailing `+N`) and
   * the position mode's axis key (each swatch preceded by its axis letter)
   * are the same strip with different items.
   */
  | { readonly kind: "swatches"; readonly items: readonly LegendSwatchItem[] };

/** One cell of a {@link LegendSpec} swatch strip, in paint order. */
export type LegendSwatchItem =
  /** A short caption — an axis letter, or the "+N" overflow indicator. */
  | { readonly kind: "label"; readonly text: string }
  /** A color chip; `color` is a CSS `rgb()` string. */
  | { readonly kind: "swatch"; readonly color: string };

/**
 * The panel `<select>` that picked a palette. index.html's option labels are
 * the app's single source of palette DISPLAY names, so the derivation asks its
 * caller to read the one that actually picked the palette rather than keeping
 * a second copy of the names that could drift — the ids are the `<select>`
 * element ids `ui.ts` resolves.
 */
export type LegendPaletteControl =
  "flamePalette" | "solidPalette" | "surfacePalette";

/** Everything {@link deriveLegend} reads. */
export interface LegendInputs {
  readonly state: AppState;
  /**
   * Whether the document's system is non-flat, i.e. the points view renders
   * the 4D projection. The CALLER's already-computed answer (`ui.ts`'s
   * `updateLabels` shares one `systemIsNonFlat` across the whole refresh), so
   * the legend and the rest of the panel can never read a different one.
   */
  readonly nonFlat: boolean;
  /**
   * Whether the "Watch it build" showcase is armed. It recolors the DISPLAY by
   * transform without touching the document, so while it runs the legend must
   * narrate the screen rather than the state.
   */
  readonly replayShowcase: boolean;
  /** The human-readable name of `id`, read off the `<select>` that picked it
   * — see {@link LegendPaletteControl}. */
  readonly paletteName: (
    control: LegendPaletteControl,
    id: PaletteSelection,
  ) => string;
}

/**
 * Number of evenly spaced samples used to build the legend's LUT-sampled
 * gradients: the colorMode ramps and the palette strips — more than a coarse
 * 8-stop bar so a non-1 `colorGamma` curve still reads accurately in the
 * legend, not just at its two (always-fixed) endpoints.
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
 * Sample a 256-entry-per-channel RGB LUT into a CSS `linear-gradient` string —
 * shared by the colorMode ramps ({@link legendGradient}) and the palette
 * strips (see {@link buildPaletteLUT}): both renderers' hot loops index the
 * very same LUTs, so sampling them here too is what keeps the legend from ever
 * drifting off the rendered colors. Exported for `ui.ts`'s custom-palette
 * editor strip, which draws the same bar for the gradient being authored.
 */
export function lutGradient(lut: Float32Array): string {
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
 * ramp (or from the current color-contrast setting). The height/radius legend
 * also samples the same rampPalette-aware LUT the renders use (`rampPalette`
 * defaults to `"legacy"`, the built-in ramp), so a gradient-driven ramp legend
 * can't drift either.
 */
function legendGradient(
  mode: "height" | "radius",
  colorGamma: number,
  rampPalette: PaletteSpec,
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
 * Build a 4D projection legend gradient: the diverging signed-w palette that
 * `FOUR_D_VERTEX` (scene.ts) computes in the shader, reproduced stop-for-stop
 * by calling `color.ts`'s {@link wRampColor} — the CPU twin of that in-shader
 * ramp — so the legend can't drift from the render. Both draw the ramp's SHAPE
 * from `wRampColor`'s `W_RAMP_*` constants and the side pair from
 * `W_SIDE_PALETTES`: the same can't-drift fidelity bar the colorMode legend
 * sets by sampling `buildColorModeLUT`. Two deliberate differences from the
 * coordinate ramps: it is signed (diverging around w = 0, our own 3-space),
 * and it does NOT respond to `colorGamma` — the shader never applies it. The
 * shader normalizes by the bounds box's w-support at the CURRENT tumble
 * rotation, so the strip's ends mean "the cloud's current w extremes", not
 * fixed w values — which is why the legend labels the ends with signs, not
 * numbers.
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

/** The named-gradient strip a palette-driven render shows: the palette's own
 * colors, captioned with its display name and no end labels. */
function paletteBar(gradient: string, name: string): LegendSpec {
  return { kind: "bar", gradient, low: "", mid: `${name} palette`, high: "" };
}

/** A coordinate ramp's bar: low/high for height, center/edge for radius —
 * the labels the explorer's colorMode ramps, the 4D radius ramp and the
 * surface tracer's height/radius sources all share. */
function rampBar(gradient: string, mode: "height" | "radius"): LegendSpec {
  const height = mode === "height";
  return {
    kind: "bar",
    gradient,
    low: height ? "low" : "center",
    mid: "",
    high: height ? "high" : "edge",
  };
}

/**
 * The "by transform" strip: one swatch per transform from the very palette
 * the renders use ({@link transformColors}, honoring an authored
 * `colorIndex`), capped at {@link LEGEND_MAX_SWATCHES} with a trailing "+N".
 * Shared by the 3D "By Transform" color mode, the 4D projection's baked
 * transform mode and the surface tracer's transform source, which all use the
 * identical palette.
 */
function transformSwatches(transforms: readonly Transform[]): LegendSpec {
  const count = transforms.length;
  const palette = transformColors(
    count,
    transforms.map((t) => t.colorIndex),
  );
  const items: LegendSwatchItem[] = [];
  const shown = Math.min(count, LEGEND_MAX_SWATCHES);
  for (let i = 0; i < shown; i++) {
    const [r, g, b] = palette[i];
    items.push({ kind: "swatch", color: cssRgb(r, g, b) });
  }
  if (count > LEGEND_MAX_SWATCHES) {
    items.push({ kind: "label", text: `+${count - LEGEND_MAX_SWATCHES}` });
  }
  return { kind: "swatches", items };
}

/**
 * The position mode's key: the three axis colors, each tagged with its axis
 * letter — the live pickers' colors, so the legend can never drift from the
 * rendered mapping (the default identity reads X:red Y:green Z:blue, the old
 * "X→R Y→G Z→B" note as colors).
 */
function axisSwatches(axes: PositionAxisColors): LegendSpec {
  const items: LegendSwatchItem[] = [];
  for (const axis of ["x", "y", "z"] as const) {
    const [r, g, b] = axes[axis];
    items.push({ kind: "label", text: axis.toUpperCase() });
    items.push({ kind: "swatch", color: cssRgb(r, g, b) });
  }
  return { kind: "swatches", items };
}

/**
 * Derive the color legend: an unobtrusive key for what the current view's
 * colors mean. Three families, checked in priority order:
 *
 * - 4D projection (non-flat system): keyed by `state.fourDColor`. The w-depth
 *   modes show their diverging signed-w ramp (see {@link W_RAMP_GRADIENTS})
 *   labeled "−w" / "in our 3-space" / "+w"; the baked "transform" mode shows
 *   the same per-transform swatch strip as the 3D mode of that name (identical
 *   palette); "radius" shows the 3D radius ramp's bar — gamma-neutral, since
 *   the 4D view never applies colorGamma, but rampPalette-aware, exactly like
 *   the bake it keys (`buildColors4`) — labeled center/edge. `colorMode` (even
 *   "uniform") is irrelevant here.
 * - Palette-driven renders — flame always, solid with a non-"legacy"
 *   palette: the active gradient palette's strip sampled from
 *   {@link buildPaletteLUT} (the very table the render's hot loop indexes),
 *   captioned with the palette's display name. The flame "legacy" palette
 *   colors by producing transform along the orbit — no meaningful 1D ramp —
 *   so it shows no legend at all, while solid "legacy" follows
 *   colorMode/colorGamma faithfully and falls through to the family below.
 * - Otherwise the active Color Mode's key: height/radius get a gradient bar
 *   sampled from {@link buildColorModeLUT} (so it can never drift from the
 *   rendered ramp, or from the current color-contrast setting) with low/high
 *   or center/edge labels — sampling the rampPalette-aware LUT, so a
 *   gradient-driven ramp shows its own colors with the same labels; position
 *   shows its three axis colors as X/Y/Z-labeled swatches; transform gets one
 *   swatch per transform; uniform hides the legend (nothing to key).
 */
export function deriveLegend({
  state,
  nonFlat,
  replayShowcase,
  paletteName,
}: LegendInputs): LegendSpec {
  // The "Watch it build" showcase recolors the DISPLAY by transform without
  // touching the document, so while it is armed the legend must narrate the
  // screen, not the state: the same swatch strip both views' own by-transform
  // modes use. Derived here (not pushed from main.ts once at arm time) so any
  // updateLabels sync that runs mid-replay repaints the showcase legend rather
  // than clobbering it.
  if (replayShowcase) return transformSwatches(state.transforms);
  // The legend narrates the ACTIVE RENDER, so the render-mode branches come
  // BEFORE the document-4D-ness one: the surface/flame/solid sessions color by
  // their OWN sources whatever the document's dimension, and the fourDColor
  // legend below describes the POINTS view alone. The old order
  // short-circuited every 4D document into the explorer's −w/+w ramp — a 4D
  // surface session rendered by-transform colors under a w-depth legend that
  // described nothing on screen.
  if (state.renderMode === "surface") {
    const source = state.surface.colorSource;
    if (source === "transform") return transformSwatches(state.transforms);
    // The shape-trap source renders as "transform" wherever the trap is
    // not LIVE — no document block, or a session outside the escape
    // family, whose shaders carry no trap channel (scene.ts's
    // surfaceColorSourceIndex is the one resolution site) — and the
    // legend must narrate the SCREEN, so it takes the same fork. The
    // family question re-derives from the document through the shared
    // eligibility derivation (its kind is the session router's own
    // answer; computeAvailable true because an entered surface session
    // proved whatever availability it needed).
    if (source === "shapeTrap") {
      const kind = state.shapeTrap
        ? deriveSurfaceEligibility(
            state.transforms,
            state.finalTransform ?? null,
            state.symmetry,
            { computeAvailable: true },
            state.schedule ?? null,
          ).kind
        : null;
      if (kind !== "escape" && kind !== "bulb" && kind !== "escape4") {
        return transformSwatches(state.transforms);
      }
    }
    // The key samples the EXACT ramp the tracer samples: surfaceColorLUT
    // is the one definition of what setSurfaceColorLUT uploads
    // (control-spec.ts), so the legend can never drift from the rendered
    // colors — the same no-second-definition discipline as the colorMode
    // ramps below.
    const lut = surfaceColorLUT(state);
    // Unreachable: every non-transform source builds a LUT.
    if (lut === null) return { kind: "hidden" };
    if (
      source === "palette" ||
      source === "rings" ||
      source === "sheets" ||
      source === "shapeTrap"
    ) {
      // rings/sheets/shapeTrap ride the same forward/descent hit-info as
      // palette, just reading a different coordinate off it — same
      // named-gradient legend.
      return paletteBar(
        lutGradient(lut),
        paletteName("surfacePalette", state.surface.paletteId),
      );
    }
    return rampBar(lutGradient(lut), source);
  }

  const render =
    state.renderMode === "flame"
      ? { paletteId: state.flame.paletteId, control: "flamePalette" as const }
      : state.renderMode === "solid"
        ? { paletteId: state.solid.paletteId, control: "solidPalette" as const }
        : null;
  if (render !== null) {
    // `buildPaletteLUT` returning null IS the "no coordinate gradient"
    // signal for "legacy" (see palette.ts) — the same discriminator the
    // renderers use, not a second string compare that could drift.
    const lut = buildPaletteLUT(
      resolvePalette(render.paletteId, state.customPalette),
    );
    if (lut !== null) {
      return paletteBar(
        lutGradient(lut),
        paletteName(render.control, render.paletteId),
      );
    }
    if (state.renderMode === "flame") return { kind: "hidden" };
  }

  if (nonFlat) {
    const mode = state.fourDColor;
    if (mode === "transform") return transformSwatches(state.transforms);
    if (mode === "radius") {
      // The ONE radius ramp (buildColorModeLUT), over 4D distance from the
      // cloud's 4D center. Gamma-neutral: the 4D shader never applies
      // colorGamma, so the legend must not pretend it does. The ramp follows
      // rampPaletteId exactly like the 3D radius mode's — the same
      // rampPalette-aware LUT the explorer bake (buildColors4) and the render
      // workers' own 4D radius LUT sample.
      return rampBar(
        legendGradient(
          "radius",
          1,
          resolvePalette(state.rampPaletteId, state.customPalette),
        ),
        "radius",
      );
    }
    return {
      kind: "bar",
      gradient: W_RAMP_GRADIENTS[mode],
      low: "−w",
      mid: "in our 3-space",
      high: "+w",
    };
  }

  const mode = state.colorMode;
  if (mode === "uniform") return { kind: "hidden" };
  if (mode === "height" || mode === "radius") {
    return rampBar(
      legendGradient(
        mode,
        state.colorGamma,
        resolvePalette(state.rampPaletteId, state.customPalette),
      ),
      mode,
    );
  }
  if (mode === "transform") return transformSwatches(state.transforms);
  // position: the three axis colors, labeled — not a 1-D ramp.
  return axisSwatches(state.positionAxisColors ?? LEGACY_POSITION_AXIS_COLORS);
}
