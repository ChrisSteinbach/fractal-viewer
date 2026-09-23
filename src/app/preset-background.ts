import type { Preset } from "../fractal/presets";
import type { BackgroundParams } from "./background";
import type { AppState } from "./state";

/** The glass compositions' bright studio gradient, inherited from the Glass
 * emitter starters rather than the study's directional softbox environment.
 * Its colors use the scene wire's RGB-byte quantization, so loading a
 * preset and reloading its share link use exactly the same stops. Each call
 * owns its color arrays. The checker floor supplies the high-contrast rear
 * structure; these stops keep grazing reflections and upper paths legible. */
export function createGlassStudioBackground(): BackgroundParams {
  return {
    mode: "custom",
    shape: "linear",
    custom: {
      top: [205 / 255, 214 / 255, 225 / 255],
      bottom: [148 / 255, 154 / 255, 168 / 255],
    },
  };
}

/** Backgrounds belong to Scene / Look, so this side table stays beside the
 * app's background vocabulary rather than making the pure fractal presets
 * depend on app types. Like PRESET_SURFACE_ROOMS, absent means leave the
 * user's setting alone. Factories prevent edits from changing a later load. */
export const PRESET_BACKGROUNDS: Partial<
  Record<Preset, () => BackgroundParams>
> = {
  glassMenger: createGlassStudioBackground,
  glassMenger4: createGlassStudioBackground,
  glassPearls: createGlassStudioBackground,
  glassPearls4: createGlassStudioBackground,
};

/** Install the composition's active backdrop while retaining unrelated
 * dormant settings, such as the generated Flame backdrop's own palette. */
export function applyPresetBackground(
  state: AppState,
  preset: Preset,
): AppState {
  const background = PRESET_BACKGROUNDS[preset]?.();
  return background
    ? { ...state, background: { ...state.background, ...background } }
    : state;
}
