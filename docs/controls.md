# Controls

The viewer has two interaction modes. Switch between them from the panel's
**Select to Edit** list: choose **🎥 Camera View** for camera mode, or a specific
**Transform N** to edit that map. The help box (top-left) always shows the active
mode and its gestures, adapting the wording to the device: mouse verbs
("Drag", "Right-drag", "Scroll") on pointer devices, finger gestures on touch.

## Camera mode

Orbit around the fractal without changing it.

| Input            | Action                           |
| ---------------- | -------------------------------- |
| Left-drag        | Orbit (rotate around the target) |
| Right-drag       | Pan (shift the target)           |
| Mouse wheel      | Zoom in / out                    |
| One finger drag  | Orbit                            |
| Two finger drag  | Pan                              |
| Two finger pinch | Zoom                             |

Phi (vertical orbit) is clamped just shy of the poles and the zoom radius is
clamped to `[1, 100]` — see `src/app/orbit.ts`.

## Transform mode

With a transform selected, its **guide box** is highlighted in white and the same
gestures now edit that map. Edits regenerate the fractal live when **Auto-update on
change** is on (otherwise press **Regenerate Points**).

| Input            | Action                                  |
| ---------------- | --------------------------------------- |
| Left-drag        | Move the box on the camera-facing plane |
| Right-drag       | Rotate the box                          |
| Mouse wheel      | Scale the box                           |
| One finger drag  | Move                                    |
| Two finger pinch | Scale (clamped to `[0.05, 2]`)          |
| Two finger twist | Rotate around the vertical axis         |

These gestures are quick but can't reach every degree of freedom (right-drag
rotates only two axes, twist only one, and pinch scales uniformly). For precise,
all-axis control — roll included, plus non-uniform scale — use the **Edit
Transform** sliders that appear in the panel while a transform is selected.

## Panel controls

- **Edit Transform N** — appears under **Select to Edit** while a transform is
  selected: sliders for its position (X/Y/Z), rotation (X/Y/Z, in degrees), and
  scale (X/Y/Z) give exact per-axis control on every device. The sliders track
  the guide box live and stay in sync with the drag gestures above.
- **+ Add / − Remove** — add or remove a transform (at least one always remains).
- **Presets** — a dropdown that replaces the whole system with one of seven named
  fractals: Sierpinski tetrahedron, Menger sponge, spiral, Sierpinski pyramid,
  octahedron flake, or a 12-map icosahedron or 20-map dodecahedron flake.
- **Points** — slider for the point count (0–500k); takes effect on **Regenerate
  Points** (or immediately on other edits when auto-update is on).
- **Point Size** — slider scaling the rendered point size from 0.25× to 4× the
  authored size; applies live (no regenerate) and carries across depth styles.
- **Show guides** — toggle the grid, axes, and transform boxes.
- **Color Mode** — see [architecture.md](architecture.md#color-modes).
- **Color Contrast** — visible for the Height/Radius/Position color modes; a
  log-scale gamma on the normalized coordinate. Left (<1) spreads detail in
  the dense low end, right (>1) in the high end, center = linear.
- **Depth Style** — how the cloud conveys depth: Depth Fade (default), Aerial
  Haze, Glow + Bloom, Depth of Field, or Eye-Dome Lighting.
- **Auto-update on change** — regenerate the cloud on every edit vs. on demand.
- **Save PNG** — download the current frame as a PNG. The image is the bare
  render (fractal and backdrop) without the panel, help box, or vignette, so it
  captures whatever depth style and color mode are active.
- **Final Transform** — _Enable lens (warps the whole cloud)_ turns on a **final
  transform**: one more affine + variation map applied to every point as it is
  plotted, bending the whole attractor at once (the fractal-flame _final xform_;
  see [architecture.md](architecture.md#final-transform)). It appears as a
  **✦ Final Transform** row under **Select to Edit** with the usual
  position/rotation/scale/shear/variation sliders — but no selection weight, which
  is meaningless for a map applied to every point. Untick to remove it.
- **4D — Experimental** — **Pentatope Gasket** / **Double-Rotation Spiral** load
  a _4D_ IFS, shown as a slowly auto-tumbling orthographic projection (an XY+ZW
  double rotation; point color = the rotated 4th coordinate, blue −w → red +w).
  The camera orbits the projection as usual, and Points / Point Size /
  Regenerate / guides / Save PNG stay live; everything that edits or restyles
  the 3D system is hidden, and the view is session-only (never persisted).
  **← Back to 3D** restores the previous scene exactly. See
  [4d-exploration.md](4d-exploration.md) for the design.

## Sharing & persistence

The scene — transforms, the optional final transform, point count and size, color
mode, depth style, and guide visibility — is encoded into the page URL (`#v1=…`)
as you edit, and mirrored to `localStorage`. So:

- **Copy the address bar to share a fractal.** Opening that link recreates the
  exact system; a pasted link takes priority over any locally saved scene.
- **Reloads restore your last scene** even without a link, from `localStorage`.

Camera angle, selection, and panel state are intentionally left out — a shared
link is about the _system_, not where you happened to be looking. See
`src/app/persist.ts` (the codec rejects malformed links rather than throwing).
