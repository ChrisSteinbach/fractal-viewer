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

The panel's categories — **Capture**, **Share**, **Collection**,
**Timeline**, **Transforms**, **Presets**, **Appearance**, **Symmetry**, and
**3D View**/**4D View** — are collapsible sections, and opening one closes
the previous (fr-zoi), so the whole panel stays about one phone-screen tall
instead of demanding a long scroll. The Flame and Solid render modes get the same treatment (fr-99o) —
**Tone** / **Blur** / **Quality** for Flame, **Surface** / **Lighting** /
**Quality** for Solid, with the render's progress readout pinned above the
sections — and the panel remembers which section was open in each mode, so
switching Points ↔ Flame ↔ Solid restores where you were. Scroll swipes that
happen to land on a slider scroll the panel without editing its value;
horizontal drags (and taps) still adjust it as usual. Loading a whole new
system — a preset, Surprise Me, or a gallery load — morphs into place instead
of snapping (see **Presets** below).

- **ⓘ What is this?** (fr-1zb) — right under the panel title: a short
  plain-language explanation of what an iterated function system is and how
  the chaos game draws its attractor (warm-up, escape-reseed and all), with
  further-reading links (Wikipedia's IFS / chaos game / fractal flame
  articles, plus Barnsley's _Fractals Everywhere_) and its own
  **▶ Watch it build** button (below). Escape, the backdrop, or the header ✕
  close it.
- **Edit Transform N** — appears under **Transforms → Select to edit** while a
  transform is selected: sliders for its position (X/Y/Z), rotation (X/Y/Z, in
  degrees), and scale (X/Y/Z) give exact per-axis control on every device. The
  sliders track the guide box live and stay in sync with the drag gestures
  above.
- **+ Add / − Remove** — add or remove a transform (at least one always remains).
- **Presets** — a dropdown that replaces the whole system with a named fractal,
  from the Sierpinski tetrahedron and Menger sponge to the 12-map icosahedron
  and 20-map dodecahedron flakes, plus dedicated **Flame** and **4D** groups.
  Loading one — like Surprise Me and a gallery load — morphs the attractor
  smoothly from the current shape into the new one instead of snapping; the
  OS's reduced-motion preference opts out to the instant snap (fr-a04l).
- **▶ Drift** (fr-wavo) — next to **Surprise Me**: an ambient, ever-evolving
  show for leaving the viewer running (a TV via the PWA, a second screen).
  While drifting, the viewer dwells on the current attractor for about five
  seconds, then glides over about five more into a fresh quality-gated
  Surprise-Me roll, dwells on that, and repeats; the panel closes when the
  show starts so the stage is clear. Every landing is a normal, undoable
  replace-load — the same "replace" checkpoint and camera auto-fit as
  pressing Surprise Me, so undo walks back through the show. It STOPS (never
  pauses) the moment you reach in: any edit to the system or its settings,
  undo/redo, a manual preset / Surprise Me / gallery load, switching to a
  Flame/Solid render, or starting **▶ Watch it build** — while camera drags
  and the auto-orbit / auto-tumble / W-slice view controls leave it running
  (the camera stays independent, as ever). Session-only like auto-orbit and
  auto-tumble — never persisted or shared — and unavailable while the OS
  asks for reduced motion (the disabled button says why): no motion means no
  drift. Between legs the show is fully idle, so it sips battery while
  dwelling; recording a video of a drifting session works as usual.
- **▶ Drift collection** (fr-w2ve) — in the gallery modal's header: the same
  ambient show, but its legs walk YOUR saved collection in gallery order
  (newest first), morphing from one saved system to the next and looping
  back to the first — a slideshow of keepers instead of random rolls. Legs
  are the same undoable replace-loads as clicking a gallery card, except the
  camera auto-fits and follows the morph rather than snapping to each
  entry's saved pose (a manual card click still restores the pose exactly).
  Every entry plays in the mode it was **saved from** (fr-75sq): a
  ✺ flame / ◆ solid entry glides through the point-cloud morph, re-renders
  in its own mode with its own saved render settings, waits for the render
  to complete, lingers a second on the finished image, and moves on — while
  plain (points) entries dwell as the classic morphing cloud, so a mixed
  collection plays as a mixed show. Switching renderers mid-show is a
  look-around, not a stop: the show holds until the entering render
  completes, and the next leg reasserts its own entry's mode; pressing Back
  mid-render resumes after a fresh dwell. Deleting entries mid-show is
  honored on the next leg (an emptied collection ends the show). Everything
  else matches **▶ Drift**: the same stop-on-edit rules, the same **■ Stop
  drifting** toggle, the same reduced-motion unavailability (the button also
  disables while the collection is empty), and it is never persisted.
- **Collection** (fr-cai) — a persistent, multi-slot library of saved systems,
  layered over the same encoded-scene format as the single autosaved scene
  (see **Sharing & persistence** below). Available in every render mode
  (fr-75sq), like Capture and Share. **★ Save to collection** saves the current system
  with a thumbnail of what's actually showing — the live cloud, or the
  flame/solid frame while one of those renders is up — and confirms with a
  toast. A save made from a Flame/Solid render also **tags the entry with
  that mode** (shown as a ✺/◆ glyph on its card): loading it re-enters that
  renderer once the restored cloud lands, and the drift slideshow plays it
  there. The tag lives only in your local collection — share links and the
  autosave stay mode-less (fr-39y). **▦ Gallery (N)** (N tracks the live
  count) opens a modal grid of saved thumbnails; clicking one loads it as a
  whole-system replacement (the same undoable treatment as a preset load or
  Surprise Me) — so you can save a keeper, keep tweaking, and still load it
  back exactly as saved. Like a preset load, it morphs smoothly into the new
  shape rather than snapping. Each card has a ✕ to delete it; Escape, the
  backdrop, or the header ✕ close the modal, and the header's **▶ Drift
  collection** starts the looping slideshow described above.
  **⬇ Back up collection** (fr-de9t) downloads the whole gallery — encoded
  scenes, mode tags, thumbnails — as one JSON backup file (disabled while
  the collection is empty). Restoring goes through **Share**'s **⬆ Import
  file**: merged entries slot into their saved chronological order, ones
  already present are skipped, and the gallery opens to show the result.
  The collection otherwise lives only in this browser profile's
  localStorage — back it up before clearing site data or when moving
  devices.
- **Share** (fr-5mdt) — the current scene as a portable document, plus the
  app's one import door. **🔗 Copy link** copies a shareable `#v1=…` link
  built fresh from the current state, not the (debounced) address bar.
  **⤓ Save scene file** is the link's file counterpart (see below);
  **⤓ Export .flame** writes the system's flat XY shadow as a
  flam3/Apophysis `.flame` file other flame tools can open (see
  [flame-interop.md](flame-interop.md)). **⬆ Import file** — or dropping a
  file anywhere on the page — loads a scene file, imports a `.flame` file,
  merges a collection backup into the gallery, or restores a timeline
  backup (fr-h9rk, replacing the authored timeline — with an Undo toast
  when one was there).
- **Timeline** (fr-8v41) — an authored animation: an ordered sequence of
  keyframes played back as a chain of morphs, the drift show's directed
  counterpart — you decide what plays, in what order, at what pace. Like the
  Collection it is available in every render mode, and it persists in this
  browser profile's localStorage (file backup below). **📍 Add keyframe**
  captures the current view — the system AND the camera pose, plus the 4D
  rotor/slice view for a non-flat system, so a 4D shot is framed exactly as
  authored — as the next step, with a thumbnail of what's actually showing.
  Each step is a frozen, independent copy, not a reference into the
  collection: deleting a gallery entry (or editing onward) can never break a
  saved timeline. The timeline holds 20 keyframes at most, and adding to a
  full one refuses with a toast rather than silently evicting part of an
  authored sequence. Each row shows its thumbnail, two seconds inputs —
  **morph** (how long the glide INTO this keyframe takes, up to 30 s) and
  **hold** (how long to linger on it) — and ↑/↓/✕ to reorder or remove it
  (with an Undo toast: a removed keyframe may be the only copy of its scene
  anywhere); the status line above the rows totals the authored duration
  ("3 keyframes · 0:18"). **▶ Play timeline** morphs from whatever is live
  into keyframe 1, holds, and moves on — each landing the same undoable
  replace-load as a drift leg, so undo walks back through the run; the panel
  closes when playback starts, and starting it ends a running Drift (and
  vice versa — at most one show ever runs). The camera GLIDES to each step's
  saved pose over that step's morph seconds — the author's framing is the
  shot — while a step saved without a pose auto-fits and chases like a drift
  leg, and a 4D step's rotor/slice glides into place the same way. Every
  leg's morph seed derives from the timeline's own stored seed, so the same
  timeline plays the same content stream every time — the deterministic half
  of the export below. Like Drift it STOPS (never pauses) when you reach in:
  any edit, undo/redo, a preset / Surprise Me / gallery load, a manual
  switch to a Flame/Solid render (outside a render keyframe's own hold), or
  starting another show — and every timeline edit (add / remove / reorder /
  retime / import) stops a running playback first, while camera and 4D-view
  drags leave it running (grabbing the camera simply takes over from the
  pose glide). Playback and clip export are unavailable under reduced motion
  (the disabled buttons say why); authoring and backup stay available —
  adding keyframes isn't motion.
  A keyframe added while a Flame/Solid render is showing becomes a **render
  keyframe** (fr-v3au), wearing the gallery's ✺/◆ glyph: on playback its leg
  morphs in as the point cloud, re-enters that renderer on arrival (with the
  render settings it was saved with), and HOLDS the schedule until the
  render converges — the step's hold seconds then dwell on the converged
  image before the next leg departs. Convergence time is content- and
  device-dependent, so once any step is a render keyframe the authored total
  is only a floor — the status line says so with a "+" ("0:18+"). The
  render's accumulator seed is pinned per leg too (fr-4ff7), so the
  converged still is identical run to run, residual noise included.
  **⏺ Export clip** plays the timeline and downloads the result as a video.
  Whenever the browser can encode H.264 (WebCodecs), the export runs OFFLINE
  and frame-exact (fr-92t9): the whole pipeline steps on a virtual clock —
  each frame's morph sample generated at its exact time, at the scene's full
  point count (no need to touch **Morph Detail**), rendered, and encoded to
  a 30 fps MP4 — so a hitch can't drop a frame, the same timeline exports
  the same clip on the same device, and a background tab keeps exporting.
  Render keyframes PARK the virtual clock while their render converges (no
  convergence footage), then dwell the authored hold on the converged still,
  so the clip comes out exactly the authored length (fr-6jic). The button
  turns into the progress readout and the cancel affordance ("⏳ Exporting
  42%") — cancelling (or resizing the window mid-run) still saves the
  partial clip. Without WebCodecs H.264 — or when a manual ● Record video is
  already rolling, which the export adopts — the clip records LIVE off the
  canvas instead: content still seed-deterministic, but frame timing is
  realtime and render keyframes honestly record however long convergence
  took. Either way clips cap at 2:00, and a toast warns up front when the
  authored total exceeds that. **⬇ Back up timeline** (fr-h9rk) downloads
  the whole thing — keyframes, timings, mode tags, and the playback seed, so
  a restored timeline replays (and exports) the very same morphs — as one
  JSON file; restore it with **Share**'s **⬆ Import file** (or drop it onto
  the page), which REPLACES the authored timeline, with an Undo toast when
  there was one.
- **Points** — log-scaled slider for the point count (1k–5M); takes effect on
  **Regenerate Points** (or immediately on other edits when auto-update is on).
- **▶ Watch it build** (fr-1zb) — replays how the chaos game drew the cloud
  that's on screen right now: the same buffer is revealed in generation order
  (no re-roll), one hop at a time at first — a bright spark riding each
  landing — then accelerating through an exponential accretion ramp back to
  the full count, narrated by a caption pill. Ends on its own; any
  regenerate, edit, or render-mode switch cancels it. Works in the 4D
  projection too (the spark rides the tumble). Also reachable from the
  **ⓘ What is this?** dialog. While it plays, the view temporarily switches
  to **By Transform** coloring, shows the guides (transform boxes, grid, and
  axes), and runs the auto-orbit (or, in the 4D projection, the auto-tumble)
  so the drawing is easy to follow — your actual settings are untouched
  underneath and come back exactly as they were when the replay ends or is
  cancelled (fr-hpci).
  Reduced motion keeps that extra spin off. Opening the control panel
  mid-replay cancels the replay too, restoring everything immediately.
- **Morph Detail** (fr-jonj) — how many points the cloud keeps while a system
  morph is in flight (a preset load, Surprise Me, a gallery load, or a Drift
  leg). **Adaptive** (default) sizes each in-between cloud to what this device
  can regenerate in one animation frame — the smoothest motion, but on a big
  scene the morph runs at a small fraction of the settled count, which a
  video recording can crush to near-black. **Dense** asks for several frames'
  worth per update (~8× the light, shape updates ~9×/s), and **Full** runs
  every in-between cloud at the scene's own point count, updating as fast as
  full generations complete — the one to pick when recording a clip of a
  morphing or drifting session. The settled attractor is always full-count
  regardless. Session-only, like auto-update — never persisted.
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
- **⤓ Save scene file** (fr-de9t) — download the current scene as a small JSON
  file: the same document bytes as 🔗 Copy link (camera pose included),
  wrapped in a file envelope instead of a URL, for keeping scenes where a
  link doesn't fit — archives, email attachments, version control. Load one
  back with **⬆ Import file** (see **Share**) or by dropping it anywhere
  on the page.
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
  number of systems in a persistent gallery; reload one from ▦ Gallery — the
  multi-slot counterpart to this single autosaved scene (see **Collection**
  above). 🔗 Copy link (in **Share**) copies a fresh link for the current
  scene, not the (debounced) address bar.
- **Take scenes off this device with files** (fr-de9t). ⤓ Save scene file
  exports the current scene as JSON; ⬇ Back up collection backs up the whole
  gallery; ⬇ Back up timeline (fr-h9rk) backs up the authored animation
  timeline, playback seed included. ⬆ Import file (or dropping a file onto
  the page) loads a scene file, merges a collection backup, or restores a
  timeline — all the localStorage stores above are trapped in one browser
  profile, and these files are how a library survives clearing site data or
  moving devices.

Camera angle, selection, and panel state are intentionally left out — a shared
link is about the _system_, not where you happened to be looking. See
`src/app/persist.ts` (the codec rejects malformed links rather than throwing).
