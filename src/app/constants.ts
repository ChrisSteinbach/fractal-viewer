/**
 * Shared UI/interaction constants.
 *
 * These are UI and interaction concerns — they do NOT belong in src/fractal/.
 */

/** Below this viewport width the panel starts closed and floats over a scrim. */
export const MOBILE_BREAKPOINT = 640;

/**
 * Ceiling on a replace-load morph's INTERMEDIATE generation requests
 * (fr-a04l): each frame of the tween re-runs the chaos game, so a 5M-point
 * scene must never try to animate at full count. Since fr-a5gu the actual
 * per-frame count adapts to measured generation latency (`morph-budget.ts`)
 * and this is only its upper clamp — a device fast enough to generate more
 * than this per frame gains nothing visible from denser intermediates. The
 * morph's terminal sample — the real replaced request — uses the full
 * `numPoints`, so the settled cloud is never degraded.
 */
export const MORPH_MAX_POINTS = 400_000;

/** Minimum guide-box scale when dragging or scaling via the panel editor. */
export const MIN_GUIDE_SCALE = 0.05;

/** Maximum guide-box scale when dragging or scaling via the panel editor. */
export const MAX_GUIDE_SCALE = 2;

/**
 * Backdrop gradient stops, authored in sRGB and rendered verbatim (scene.ts
 * disables THREE.ColorManagement). Single source of truth for the explorer's
 * CanvasTexture backdrops, the fog colors derived from their midpoints
 * (fr-1lj), and the solid raymarcher's miss gradient (voxel-material.ts).
 */
export const DARK_BACKDROP = { top: "#0d0d18", bottom: "#1f2039" } as const;

/** The aerial style's cooler, lighter backdrop. */
export const HAZE_BACKDROP = { top: "#3c4a72", bottom: "#5d6d9b" } as const;

/** Parse a "#rrggbb" hex color to RGB components in [0, 1]. */
export function hexToRgb01(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

/**
 * Whether to request MSAA (`antialias: true`) when creating the WebGL
 * context (fr-rr2m). A context-creation-time decision — WebGL cannot toggle
 * it live, so this is a boot heuristic.
 *
 * MSAA pays off only at low pixel densities: at `dpr >= 2` the drawing
 * buffer already carries 4x the CSS-pixel samples, so geometric aliasing
 * (the guide lines and grid — point sprites barely benefit) is much less
 * visible, while 4x MSAA still multiplies fill/memory cost on exactly the
 * devices that can least afford it (phones and tablets at DPR 2–3). DPR-1
 * desktop displays keep MSAA: aliasing is most visible there and desktop
 * GPUs shrug off the cost. Note the glow and EDL styles render through
 * non-multisampled offscreen targets, so context MSAA never applied to them
 * anyway — only the direct-to-canvas styles (depth fade, DOF, 4D) are
 * affected either way.
 *
 * `override` carries the `?msaa` URL param for on-device A/B profiling:
 * `"0"` forces MSAA off, any other present value (`?msaa`, `?msaa=1`)
 * forces it on, and `null` (param absent) defers to the DPR heuristic.
 */
export function contextAntialias(
  dpr: number,
  override: string | null = null,
): boolean {
  if (override !== null) return override !== "0";
  return dpr < 2;
}
