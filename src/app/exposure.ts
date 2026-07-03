/**
 * Density-adaptive brightness factor for the glow render style.
 *
 * Projects the bounding sphere onto the screen to estimate point density,
 * then returns a scaling factor that dims dense clouds and brightens sparse
 * ones so overlapping additive points don't saturate to white.
 *
 * @module
 */

/**
 * Calibration density (points per pixel) at which the exposure factor is
 * exactly 1 — i.e. the glow material keeps its authored opacity unchanged.
 * Tuned so the Radiolarian preset at its natural framing preserves the
 * "luminous stardust" appearance from fr-x2z.
 */
export const CALIBRATION_DENSITY = 0.5;

/**
 * Compute a per-frame brightness multiplier for the glow material.
 *
 * @param numPoints       Rendered point count (`lastResult.count`).
 * @param boundsRadiusWorld  Half the bounding-box diagonal (world units).
 * @param cameraDistance   Distance from camera to the cloud centre.
 * @param fovYRadians      Vertical field-of-view in radians.
 * @param viewportHeightPx Canvas height in CSS pixels.
 * @returns A factor in [0.05, 1.5]; 1 at the calibration density.
 */
export function glowExposure(
  numPoints: number,
  boundsRadiusWorld: number,
  cameraDistance: number,
  fovYRadians: number,
  viewportHeightPx: number,
): number {
  // Guard against degenerate inputs that would produce NaN or Infinity.
  if (
    !Number.isFinite(numPoints) ||
    !Number.isFinite(boundsRadiusWorld) ||
    !Number.isFinite(cameraDistance) ||
    !Number.isFinite(fovYRadians) ||
    !Number.isFinite(viewportHeightPx) ||
    cameraDistance <= 0 ||
    fovYRadians <= 0 ||
    viewportHeightPx <= 0 ||
    boundsRadiusWorld <= 0 ||
    numPoints <= 0
  ) {
    return 1;
  }

  const halfTan = Math.tan(fovYRadians * 0.5);
  if (halfTan <= 0 || !Number.isFinite(halfTan)) return 1;

  // Projected bounding-sphere radius in pixels.
  const rpx =
    (boundsRadiusWorld / (cameraDistance * halfTan)) * (viewportHeightPx * 0.5);

  // Screen coverage (px²) and density (points / px²).
  const area = Math.PI * rpx * rpx;
  const density = numPoints / Math.max(area, 1);

  const factor = (CALIBRATION_DENSITY / density) ** 0.6;
  return Math.max(0.05, Math.min(1.5, factor));
}
