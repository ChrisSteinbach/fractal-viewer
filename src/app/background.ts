/**
 * The scene backdrop (fr-5ps1): a two-stop vertical gradient every renderer
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
 * The vocabulary is deliberately an extensible id list: fr-mz2u adds a
 * palette-linked `"auto"` mode and fr-4vi7 curated presets, all riding this
 * same `(top, bottom)` plumbing. `persist.ts` decodes an unknown id to the
 * legacy default rather than rejecting, so links written by those future
 * builds degrade gracefully in this one.
 *
 * Pure: no Three.js, no DOM. Colors are `RgbStop` tuples (0..1 channels,
 * `palette.ts`'s convention, matching `positionAxisColors`).
 */
import type { RgbStop } from "../fractal/palette";
import { DARK_BACKDROP, HAZE_BACKDROP, hexToRgb01 } from "./constants";

/**
 * The Background select's positions (fr-5ps1): the two built-in backdrops the
 * app has always had — `"dark"` (every render style's original ground) and
 * `"haze"` (the cooler, lighter atmosphere the aerial style used to force) —
 * plus `"custom"`, the user-authored two-stop gradient (a single flat color =
 * top equals bottom). Single source of truth for the {@link BackgroundMode}
 * type, the UI select's options (pinned by ui.test.ts) and the persistence
 * validator (`persist.ts`) — the `RENDER_STYLES` discipline.
 */
export const BACKGROUND_MODES = ["dark", "haze", "custom"] as const;

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
 * switching away and back never loses authored colors.
 */
export interface BackgroundParams {
  mode: BackgroundMode;
  custom?: BackgroundGradient;
}

/** A fresh scene's background: the dark backdrop, no authored custom slot. */
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
 * Resolve a background choice to its concrete gradient stops. `"custom"`
 * returns the authored slot; a custom mode with no payload (unreachable
 * through the reducer/decoder, which both guarantee a payload before the
 * mode) falls back to the dark backdrop rather than throwing — the same
 * defensive stance as `persist.ts`'s quiet fallbacks.
 */
export function resolveBackground(
  params: BackgroundParams,
): BackgroundGradient {
  if (params.mode === "custom") return params.custom ?? DARK_GRADIENT;
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
 * The backdrop's replace-load crossfade (fr-5ps1): a timeline/drift leg or
 * gallery load that morphs the system also fades the background from the
 * pre-load backdrop to the target document's, over the same duration —
 * the fourth motion beside the system morph, the camera glide and the 4D
 * rotor glide. Smoothstep easing to match the morph tween's feel.
 *
 * Same poll shape as `morph-tween.ts`: `start` arms it, `sample(now)`
 * returns the frame's gradient while active (`final: true` on the exact
 * target, then idle), `cancel` discards it. Times come from the caller's
 * clock — main.ts's `nowMs()`, so offline export's virtual clock drives it
 * deterministically (the fr-92t9 contract the other tweens honor).
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
