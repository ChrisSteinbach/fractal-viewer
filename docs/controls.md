# Controls

The viewer has two interaction modes. Switch between them from the panel's
**Transforms** section (its **Select to edit** list): choose **🎥 Camera View**
for camera mode, or a specific **Transform N** to edit that map. The help box (top-left) always shows the active
mode and its gestures, adapting the wording to the device: mouse verbs
("Drag", "Right-drag", "Scroll") on pointer devices, finger gestures on touch.

## Camera mode

Orbit around the fractal without changing it. While the system is flat, the
camera also orbits by itself — a slow turntable, paused whenever your hand is
on the canvas; see **3D View** below.

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

## 4D projection

While the current system is non-flat (see **4D View** below), the point cloud
renders as a 4D projection; plain gestures still orbit/pan/zoom it exactly as
above. Holding **Shift** retargets the left-drag and the wheel to turn the two
hidden rotation planes instead — Hanson's "rolling ball" scheme, restricted to
coordinate planes:

| Input               | Action                          |
| ------------------- | ------------------------------- |
| Shift + left-drag   | Turn the XW (↔) / YW (↕) planes |
| Shift + mouse wheel | Turn the ZW plane               |

Touch devices have no Shift key, so touch always orbits; turn a map's own
w-planes instead from its **4D** editor group, or sweep **4D View**'s **W
slice** slider.

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

The panel's categories — **Export**, **Transforms**, **Presets**,
**Collection**, **Appearance**, **Symmetry**, and **3D View**/**4D View** — are
collapsible sections, and opening one closes the previous (fr-zoi), so the
whole panel stays about one phone-screen tall instead of demanding a long
scroll. Scroll swipes that happen to land on a slider scroll the panel without
editing its value; horizontal drags (and taps) still adjust it as usual.

- **Edit Transform N** — appears under **Transforms → Select to edit** while a
  transform is selected: sliders for its position (X/Y/Z), rotation (X/Y/Z, in
  degrees), and scale (X/Y/Z) give exact per-axis control on every device. The
  sliders track the guide box live and stay in sync with the drag gestures
  above.
- **+ Add / − Remove** — add or remove a transform (at least one always remains).
- **Presets** — a dropdown that replaces the whole system with a named fractal,
  from the Sierpinski tetrahedron and Menger sponge to the 12-map icosahedron
  and 20-map dodecahedron flakes, plus dedicated **Flame** and **4D** groups.
- **Collection** (fr-cai) — a persistent, multi-slot library of saved systems,
  layered over the same encoded-scene format as the single autosaved scene
  (see **Sharing & persistence** below). Explorer-only — it hides during a
  flame/solid render. **★ Save to collection** saves the current system with a
  thumbnail of the live cloud and confirms with a toast. **▦ Gallery (N)** (N
  tracks the live count) opens a modal grid of saved thumbnails; clicking one
  loads it as a whole-system replacement (the same undoable treatment as a
  preset load or Surprise Me) — so you can save a keeper, keep tweaking, and
  still load it back exactly as saved. Each card has a ✕ to delete it; Escape,
  the backdrop, or the header ✕ close the modal. **🔗 Copy link** copies a
  shareable `#v1=…` link built fresh from the current state, not the
  (debounced) address bar.
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
- **Final-transform lens** — the _(warps the whole cloud)_ checkbox in the
  **Transforms** section turns on a **final transform**: one more affine +
  variation map applied to every point as it is plotted, bending the whole
  attractor at once (the fractal-flame _final xform_;
  see [architecture.md](architecture.md#final-transform)). It appears as a
  **✦ Final Transform** row under **Select to edit** with the usual
  position/rotation/scale/shear/variation sliders — but no selection weight, which
  is meaningless for a map applied to every point. Untick to remove it.
- **3D View** — appears while the current system is _flat_, in the same panel
  spot **4D View** (below) takes over for a non-flat one. **Auto-orbit
  (turntable)** slowly circles the camera around the cloud — one revolution
  every ~52 s at 1× — pausing while any canvas drag is in progress and
  resuming when you let go, and **Orbit speed** scales its rate from 0.1× to
  3×. The pair mirrors the 4D **Auto-tumble** controls exactly: on by default
  (starting paused when the OS asks for reduced motion, as an explicit
  opt-in), session-only (never persisted), and reset to a fresh baseline only
  when the system flips from non-flat to flat or a whole new flat system
  replaces it (preset load / Surprise Me) — never on a later edit, so a
  paused or re-sped orbit survives ordinary parameter tweaks.
- **4D View** — appears once the current system is _non-flat_ (see
  [architecture.md](architecture.md#the-4d-extension)): the point cloud
  becomes an orthographic projection of a slow double rotation (XY+ZW),
  colored per the **4D Color** select (fr-d47), spelled out right in the
  panel: three diverging palettes on the rotated 4th coordinate — **W Depth
  (blue / orange)** (the default), purple / green, or cyan / magenta, cool
  toward −w and warm toward +w — or two rotation-invariant modes, **By
  Transform** and **By 4D Radius (warm→cool)**, which still dim toward gray
  as |w| → 0 so the fourth dimension stays legible either way; the legend
  keys whichever choice is active, and — unlike the tumble/slice view below
  — the choice persists across reloads and shared links. Rendered either way
  with additive translucency so the w-layers a projection folds together
  stay _visible_ and sum toward white where they cross. Load any entry in the
  Presets dropdown's **4D** group to see one immediately — **Pentatope
  Gasket**, **16-Cell Flake**, **Duoprism (3×3)**, **Tesseract Dust**,
  **24-Cell Flake**, **Double-Rotation Spiral**, or **Hyperfern** (Barnsley's
  fern curling through w instead of z); with **Show guides** on, the polytope
  presets tumble their own wireframe (5-cell, 16-cell, duoprism, tesseract,
  24-cell edges) through the same rotation — or turn any flat system non-flat
  yourself: every
  transform's (and the final lens's) editor ends with a collapsed **4D**
  group, with **Position W**, **Scale W** (tracks the map's live mean 3D
  contraction with an "(auto)" marker until set explicitly), and the
  **Rotation XW/YW/ZW** and **Shear XW/YW/ZW** planes editable exactly like
  the 3D sliders — zero every field in the group and the system drops back to
  the 3D path live. **Auto-tumble (XY+ZW)** pauses/resumes the rotation
  (starting paused when the OS asks for reduced motion, though the
  Shift-drag/Shift-wheel gestures above always work regardless) and **Tumble
  speed** scales its rate from 0.1× to 3×. **W slice** carves a soft Gaussian
  cross-section out of the cloud (the rest stays as ghost context), its
  position slider sweeping along w — each position is a genuinely different
  3D fractal. **Slice-relative color** (fr-nn6, shown while the slice is on
  and a W-Depth palette is active) recenters the diverging ramp on the slice
  window: inside the slice everything sits near one w, so the faithful
  whole-cloud ramp renders a slice at 0 almost entirely in the palette's
  dim-gray notch — this option spreads the full palette across the visible
  cross-section instead (±2 slice-widths; ghost context beyond that clamps
  to the side colors), changing color only, never the slice's opacity
  window, and carries into the flame/solid renders of that view. **Depth
  fade (dim far points)** (fr-3e0) attenuates each
  point's contribution with _camera_ distance — the one 3D depth style whose
  mechanism survives the additive blending (fade-to-black is attenuation;
  fading toward a haze color would sum across the stacked w-layers and blow
  out), restoring the camera-z cue the projection otherwise lacks. It is off
  by default because brightness already encodes |w| (dim gray = near our
  3-space), and earns its keep in stills — Save PNG, paused video — where
  motion parallax can't disambiguate depth; unlike the tumble/slice view
  state it persists across reloads and shared links, exactly like **4D
  Color**. The camera orbits the projection as usual, and Points / Point
  Size / Regenerate / guides / Save PNG stay live, as do the transform list
  and every transform's editor; **Color Mode**, **Color Contrast**, **Depth
  Style**, the Flame/Solid Render entries, and **Symmetry** all hide, since
  none of them reach the 4D shader path. The tumble/slice view is
  session-only (never persisted) and resets to a fresh baseline only when the
  system flips from flat to non-flat, or a whole new system replaces it
  (preset load / Surprise Me) — never on a later edit, so an in-progress
  tumble/slice survives ordinary parameter tweaks. See
  [4d-exploration.md](4d-exploration.md) for the design.

## Sharing & persistence

The scene — transforms, the optional final transform, point count and size, color
mode, depth style, and guide visibility — is encoded into the page URL (`#v1=…`)
as you edit, and mirrored to `localStorage`. So:

- **Copy the address bar to share a fractal.** Opening that link recreates the
  exact system; a pasted link takes priority over any locally saved scene.
- **Reloads restore your last scene** even without a link, from `localStorage`.
- **Keep more than one with the Collection.** ★ Save to collection stores any
  number of systems in a persistent gallery; reload one from ▦ Gallery, or
  copy a fresh link for the current scene with 🔗 Copy link — the multi-slot
  counterpart to this single autosaved scene (see **Collection** above).

Camera angle, selection, and panel state are intentionally left out — a shared
link is about the _system_, not where you happened to be looking. See
`src/app/persist.ts` (the codec rejects malformed links rather than throwing).
