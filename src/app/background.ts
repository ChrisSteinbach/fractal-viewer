/**
 * The scene backdrop: a two-stop vertical gradient every renderer
 * shows behind the attractor — the explorer's CanvasTexture, the flame
 * composite, the voxel/surface tracers' miss gradient (their `uBgTop`/
 * `uBgBottom` uniforms), and the WebGPU compute kernels' shade params.
 *
 * This module is the ONE definition of what a background choice means in
 * colors: `resolveBackground` turns the persisted {@link BackgroundParams}
 * into the concrete `(top, bottom)` stop pair, and every consumer — scene
 * push, captures, the compute frame spec, and the morph-leg crossfade —
 * resolves through it, so no two renderers can disagree about the backdrop.
 *
 * The vocabulary is deliberately an extensible id list: the palette-linked
 * `"auto"` mode ({@link autoBackground}) was added to it, and any curated
 * preset would ride this same `(top, bottom)` plumbing.
 * `persist.ts` decodes an unknown id to the legacy default rather than
 * rejecting, so links written by future builds degrade gracefully in this
 * one.
 *
 * Pure: no Three.js, no DOM. Colors are `RgbStop` tuples (0..1 channels,
 * `palette.ts`'s convention, matching `positionAxisColors`).
 */
import type { BackgroundShape } from "../fractal/background-shape";
import type { PaletteSpec, RgbStop } from "../fractal/palette";
import { buildPaletteLUT } from "../fractal/palette";
import { DARK_BACKDROP, HAZE_BACKDROP, hexToRgb01 } from "./constants";

export type { BackgroundShape } from "../fractal/background-shape";

/**
 * The Background select's positions: the two built-in backdrops the app has
 * always had — `"dark"` (every render style's original ground) and `"haze"`
 * (the cooler, lighter atmosphere the aerial style used to force) — plus
 * `"auto"`, the palette-derived backdrop (see {@link autoBackground}), and
 * `"custom"`, the user-authored two-stop gradient (a single flat color =
 * top equals bottom). Single source of truth for the {@link BackgroundMode}
 * type, the UI select's options (pinned by ui.test.ts) and the persistence
 * validator (`persist.ts`) — the `RENDER_STYLES` discipline.
 */
export const BACKGROUND_MODES = ["dark", "haze", "auto", "custom"] as const;

export type BackgroundMode = (typeof BACKGROUND_MODES)[number];

/** A resolved backdrop: the two gradient stops, top and bottom of frame. */
export interface BackgroundGradient {
  top: RgbStop;
  bottom: RgbStop;
}

/**
 * The persisted background choice (see {@link AppState.background} in
 * `state.ts`). `custom` is the authored gradient slot: absent until the
 * select first lands on Custom (which seeds it from the backdrop being
 * replaced — the `customPalette` discipline), then kept while unselected so
 * switching away and back never loses authored colors. `"auto"` persists as
 * the MODE alone: the derived colors are never baked into the
 * document, so palette edits keep tracking after a link round-trip.
 *
 * `shape` is ORTHOGONAL to `mode`: it picks the GRADIENT SHAPE
 * (`fractal/background-shape.ts`'s vocabulary — linear ramp or radial
 * vignette) that the two `mode`-derived stops are painted through, so every
 * mode can be linear or radial and a palette-linked `"auto"` backdrop gets
 * a vignette for free. Absent means `"linear"`, matching
 * `DEFAULT_BACKGROUND_SHAPE` — every document predating this field is
 * unmoved.
 */
export interface BackgroundParams {
  mode: BackgroundMode;
  custom?: BackgroundGradient;
  shape?: BackgroundShape;
}

/** The dark backdrop with no authored custom slot — `scene.ts`'s construction
 * placeholder, resolved before boot pushes the real document's choice. NOT the
 * fresh-scene default it once claimed to be: `state.ts`'s `initialState`
 * carries its own literal, and this constant has no other consumer, so
 * changing it here would move nothing. */
export const DEFAULT_BACKGROUND: BackgroundParams = { mode: "dark" };

/** The built-in backdrops as resolved stops — `constants.ts`'s authored hex
 * pairs, converted once. */
const DARK_GRADIENT: BackgroundGradient = {
  top: hexToRgb01(DARK_BACKDROP.top),
  bottom: hexToRgb01(DARK_BACKDROP.bottom),
};
const HAZE_GRADIENT: BackgroundGradient = {
  top: hexToRgb01(HAZE_BACKDROP.top),
  bottom: hexToRgb01(HAZE_BACKDROP.bottom),
};

/**
 * The `"auto"` derivation's tuning, exported so the tests pin the
 * CONTRACT (luminance bands, sample positions) rather than magic numbers —
 * re-tuning the look is a one-object edit that can't silently drift from
 * what the tests assert.
 *
 * The curve: sample the palette's LUT at `topT`/`bottomT` (t = 0 is the
 * palette's own first stop; a quarter of the way in stays hue-adjacent for
 * the cosine presets' full-cycle sweeps, and lands exactly on stop 1 of a
 * five-stop custom gradient), then darken each sample to `darken ×` its
 * luma, clamped into that stop's luminance band. The two bands are DISJOINT
 * (top's max below bottom's min) and bracket the built-in dark backdrop's
 * own luma pair, so a derived backdrop always keeps the house
 * darker-top-lighter-bottom shape and never gets bright enough to wash out
 * the attractor — the issue's floor/ceiling contrast clamp. `desaturate`
 * then eases the scaled color toward neutral gray so a saturated palette
 * yields a backdrop, not a glow. A sample below `blackFloor` luma carries no
 * usable hue (scaling near-noise up would invent one), so it lands on
 * neutral gray at the band's floor — an all-black custom palette derives a
 * quiet neutral ground rather than garbage.
 */
export const AUTO_BACKGROUND_TUNING = {
  topT: 0,
  bottomT: 0.25,
  darken: 0.35,
  top: { min: 0.03, max: 0.06 },
  bottom: { min: 0.075, max: 0.14 },
  desaturate: 0.25,
  blackFloor: 0.02,
} as const;

/**
 * Rec. 709 luma: the perceptual-weight sum over the sRGB components AS
 * STORED — deliberately gamma-naive, like every other color computation in
 * this app (color management is disabled; authored sRGB renders verbatim).
 * A brightness heuristic for the auto backdrop's clamps, not colorimetry.
 */
export function luma709(stop: RgbStop): number {
  return 0.2126 * stop[0] + 0.7152 * stop[1] + 0.0722 * stop[2];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** One derived stop — see {@link AUTO_BACKGROUND_TUNING} for the curve. */
function deriveAutoStop(
  lut: Float32Array,
  t: number,
  band: { min: number; max: number },
): RgbStop {
  const o = Math.round(t * 255) * 3;
  const sample: RgbStop = [lut[o], lut[o + 1], lut[o + 2]];
  const luma = luma709(sample);
  if (luma < AUTO_BACKGROUND_TUNING.blackFloor) {
    return [band.min, band.min, band.min];
  }
  const target = Math.min(
    band.max,
    Math.max(band.min, luma * AUTO_BACKGROUND_TUNING.darken),
  );
  const scale = target / luma;
  const d = AUTO_BACKGROUND_TUNING.desaturate;
  const channel = (v: number): number => {
    // Two-product lerp toward the target-luma gray (buildCustomPaletteLUT's
    // exactness argument): desaturation never drifts the endpoint values.
    return clamp01(v * scale) * (1 - d) + target * d;
  };
  return [channel(sample[0]), channel(sample[1]), channel(sample[2])];
}

/**
 * The palette-linked backdrop: derive `(top, bottom)` stops from
 * the active palette's own LUT — the same `buildPaletteLUT` output the
 * renderers sample, so the backdrop is guaranteed to echo exactly the
 * gradient on screen, custom stops included. See
 * {@link AUTO_BACKGROUND_TUNING} for the darkening curve. `"legacy"` has no
 * gradient to echo (`buildPaletteLUT` returns `null`), so it keeps the dark
 * backdrop — the app's original ground under its original coloring.
 */
export function autoBackground(palette: PaletteSpec): BackgroundGradient {
  const lut = buildPaletteLUT(palette);
  if (lut === null) return DARK_GRADIENT;
  return {
    top: deriveAutoStop(
      lut,
      AUTO_BACKGROUND_TUNING.topT,
      AUTO_BACKGROUND_TUNING.top,
    ),
    bottom: deriveAutoStop(
      lut,
      AUTO_BACKGROUND_TUNING.bottomT,
      AUTO_BACKGROUND_TUNING.bottom,
    ),
  };
}

/**
 * Resolve a background choice to its concrete gradient stops. `"custom"`
 * returns the authored slot; a custom mode with no payload (unreachable
 * through the reducer/decoder, which both guarantee a payload before the
 * mode) falls back to the dark backdrop rather than throwing — the same
 * defensive stance as `persist.ts`'s quiet fallbacks. `"auto"`
 * derives from the caller's active palette ({@link autoBackground}); callers
 * with no palette in hand (boot placeholders, the hidden custom-picker sync)
 * get the same dark fallback — `state.ts`'s `resolveSceneBackground` is the
 * form that always supplies one.
 */
export function resolveBackground(
  params: BackgroundParams,
  palette?: PaletteSpec,
): BackgroundGradient {
  if (params.mode === "custom") return params.custom ?? DARK_GRADIENT;
  if (params.mode === "auto") {
    return palette === undefined ? DARK_GRADIENT : autoBackground(palette);
  }
  return params.mode === "haze" ? HAZE_GRADIENT : DARK_GRADIENT;
}

/** Exact-equality on two gradients — the "did the backdrop actually move"
 * gate for scene pushes and tween arming. */
export function backgroundGradientsEqual(
  a: BackgroundGradient,
  b: BackgroundGradient,
): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.top[i] !== b.top[i] || a.bottom[i] !== b.bottom[i]) return false;
  }
  return true;
}

/**
 * Interpolate two backdrops per channel, endpoint-exact at t ≤ 0 / t ≥ 1
 * (`morph.ts`'s `lerpSystem` contract). Plain sRGB-component lerp on
 * purpose: authored colors render verbatim in this app (color management is
 * disabled), and the canvas gradient between the two stops interpolates the
 * same way, so a crossfade midpoint is a plausible backdrop in its own
 * right.
 */
export function lerpBackground(
  a: BackgroundGradient,
  b: BackgroundGradient,
  t: number,
): BackgroundGradient {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const mix = (x: number, y: number): number => x + (y - x) * t;
  return {
    top: [
      mix(a.top[0], b.top[0]),
      mix(a.top[1], b.top[1]),
      mix(a.top[2], b.top[2]),
    ],
    bottom: [
      mix(a.bottom[0], b.bottom[0]),
      mix(a.bottom[1], b.bottom[1]),
      mix(a.bottom[2], b.bottom[2]),
    ],
  };
}

/** One in-flight background crossfade — see {@link BackgroundTween.sample}. */
export interface BackgroundSample {
  gradient: BackgroundGradient;
  /** True on the tween's last sample; the tween deactivates after it. */
  final: boolean;
}

/**
 * The backdrop's replace-load crossfade: a timeline/drift leg or
 * gallery load that morphs the system also fades the background from the
 * pre-load backdrop to the target document's, over the same duration —
 * the fourth motion beside the system morph, the camera glide and the 4D
 * rotor glide. Smoothstep easing to match the morph tween's feel.
 *
 * Same poll shape as `morph-tween.ts`: `start` arms it, `sample(now)`
 * returns the frame's gradient while active (`final: true` on the exact
 * target, then idle), `cancel` discards it. Times come from the caller's
 * clock — main.ts's `nowMs()`, so offline export's virtual clock drives it
 * deterministically (the offline-export contract the other tweens honor).
 *
 * The SHAPE is deliberately NOT part of what this tween
 * interpolates — a shape has no meaningful midpoint between "linear" and
 * "radial". During a crossfade the COLORS fade through this class exactly
 * as before, and the caller switches the scene's shape to the target
 * document's at the START of the leg (main.ts's `pushBackground`), so the
 * vignette geometry (or its absence) never blends, only pops at the leg's
 * first frame.
 */
export class BackgroundTween {
  private from: BackgroundGradient | null = null;
  private to: BackgroundGradient | null = null;
  private startMs = 0;
  private durationMs = 0;

  /** Arm a crossfade from `from` to `to` over `durationMs`, starting `now`.
   * A non-positive duration lands on the target at the next sample. */
  start(
    from: BackgroundGradient,
    to: BackgroundGradient,
    durationMs: number,
    now: number,
  ): void {
    this.from = from;
    this.to = to;
    this.startMs = now;
    this.durationMs = Math.max(0, durationMs);
  }

  active(): boolean {
    return this.to !== null;
  }

  /** Discard any in-flight crossfade without sampling it. */
  cancel(): void {
    this.from = null;
    this.to = null;
  }

  /** The frame's backdrop while a crossfade is in flight, else `null`. */
  sample(now: number): BackgroundSample | null {
    if (this.from === null || this.to === null) return null;
    const t =
      this.durationMs <= 0
        ? 1
        : Math.min(1, (now - this.startMs) / this.durationMs);
    if (t >= 1) {
      const gradient = this.to;
      this.cancel();
      return { gradient, final: true };
    }
    const eased = t * t * (3 - 2 * t);
    return {
      gradient: lerpBackground(this.from, this.to, eased),
      final: false,
    };
  }
}
