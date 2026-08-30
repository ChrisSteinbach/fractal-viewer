/** Session-only layout of the live Points explorer. */
export type PointsViewLayout = "single" | "four";

/** Session-only projection used by the three fixed-axis panes. Current keeps
 * the authored perspective camera in either case. */
export type PointsAxisProjection = "perspective" | "parallel";

/**
 * The three fixed axis views and the existing user-controlled camera view.
 * Rectangles use CSS-pixel, top-left-origin coordinates so the same geometry
 * can drive DOM labels and pointer hit-testing. Scene rendering converts the
 * top coordinate to WebGL's bottom-left-origin viewport at the final step.
 */
export type PointsViewportKind = "x" | "y" | "z" | "current";

export interface PointsViewportRect {
  kind: PointsViewportKind;
  left: number;
  top: number;
  width: number;
  height: number;
  adjustable: boolean;
}

/**
 * Split the panel-uncovered Points workspace into four complete, gap-free
 * rectangles. Odd pixels stay in the right/bottom panes, so the union is
 * always exactly the available workspace and never leaves a stale seam.
 */
export function fourPointsViewports(
  width: number,
  height: number,
  rightInset: number,
): readonly PointsViewportRect[] {
  const fullWidth = Math.max(0, Math.floor(width));
  const fullHeight = Math.max(0, Math.floor(height));
  const inset = Math.max(0, Math.min(Math.floor(rightInset), fullWidth));
  const availableWidth = fullWidth - inset;
  const leftWidth = Math.floor(availableWidth / 2);
  const rightWidth = availableWidth - leftWidth;
  const topHeight = Math.floor(fullHeight / 2);
  const bottomHeight = fullHeight - topHeight;

  return [
    {
      kind: "x",
      left: 0,
      top: 0,
      width: leftWidth,
      height: topHeight,
      adjustable: false,
    },
    {
      kind: "y",
      left: leftWidth,
      top: 0,
      width: rightWidth,
      height: topHeight,
      adjustable: false,
    },
    {
      kind: "z",
      left: 0,
      top: topHeight,
      width: leftWidth,
      height: bottomHeight,
      adjustable: false,
    },
    {
      kind: "current",
      left: leftWidth,
      top: topHeight,
      width: rightWidth,
      height: bottomHeight,
      adjustable: true,
    },
  ];
}

/** Return the pane containing one workspace-local CSS-pixel coordinate. */
export function pointsViewportAt(
  viewports: readonly PointsViewportRect[],
  x: number,
  y: number,
): PointsViewportRect | null {
  return (
    viewports.find(
      (view) =>
        view.width > 0 &&
        view.height > 0 &&
        x >= view.left &&
        x < view.left + view.width &&
        y >= view.top &&
        y < view.top + view.height,
    ) ?? null
  );
}
