/**
 * Shared UI/interaction constants.
 *
 * These are UI and interaction concerns — they do NOT belong in src/fractal/.
 */

/** Below this viewport width the panel starts closed and floats over a scrim. */
export const MOBILE_BREAKPOINT = 640;

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
