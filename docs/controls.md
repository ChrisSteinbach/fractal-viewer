# Controls

Fractal Explorer has two interaction modes. Switch between them from the panel's
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
instead of demanding a long scroll. The Flame, Solid, and Surface render
modes get the same treatment (fr-99o) — **Tone** / **Blur** / **Quality** for
Flame, **Surface** / **Lighting** / **Quality** for Solid, and **Surface
Look** for Surface itself (see **✺ Flame**, **◆ Solid** and **◈ Surface**
below) — with a status block
pinned above the sections (a progress readout for Flame/Solid, an instant
hint for Surface), and the panel remembers which section was open in each
mode, so switching Points ↔ Flame ↔ Solid ↔ Surface restores where you were.
Scroll swipes that happen to land on a slider scroll the panel without
editing its value; horizontal drags (and taps) still adjust it as usual.
Loading a whole new system — a preset, Surprise Me, or a gallery load —
morphs into place instead of snapping (see **Presets** below).

- **ⓘ What is this?** (fr-1zb) — right under the panel title: a short
  plain-language explanation of what an iterated function system is and how
  the chaos game draws its attractor (warm-up, escape-reseed and all), with
  further-reading links (Wikipedia's IFS / chaos game / fractal flame
  articles, plus Barnsley's _Fractals Everywhere_) and its own
  **▶ Watch it build** button (below). Escape, the backdrop, or the header ✕
  close it.
- **Render mode** — the segmented switch directly below picks what draws the
  current system: **∴ Points** (the live, interactive cloud), **✺ Flame**,
  **◆ Solid**, or **◈ Surface**. Each of the three renders brings its own
  accordion sections and a status block, all described below. The mode itself
  is session-only and never rides in a link, so a shared scene or scene file
  always opens in Points — a **Collection** entry or a timeline keyframe can
  still be _tagged_ with the mode it was saved from, which is what re-enters
  the renderer on load (see those sections). If the browser turns out to be
  rasterizing WebGL in software instead of on the GPU, a warning at the top of
  the panel names the renderer in every mode: everything still works, but
  renders run 10–50× slower, and the fix is usually a browser GPU setting
  rather than anything in the app.
- **✺ Flame** — the classic fractal-flame exposure: millions of chaos-game
  samples accumulated into a histogram, then tone-mapped into a soft, glowing
  image. The camera _freezes_ on entry — the render converges through the view
  you left — so switch back to **∴ Points** to keep exploring. A status block
  above the sections counts progress ("12.4M / 20.0M iterations (62%)"), says
  **applying density estimate…** while the blur pass re-runs, and names the
  engine doing the accumulating: the GPU (with the adapter's name where the
  browser reports one) or the CPU, saying which way it fell back when the GPU
  was tried and refused.
  - **Tone** — **Exposure** (0.2×–4×), **Gamma** (1–6, default 2.4) and
    **Vibrancy** (0–100%) all re-map the histogram that is already
    accumulated, so each applies instantly and none costs a restart. Gamma
    reshapes the density curve: 1 is the raw curve, and raising it — 2.4 by
    default — lifts faint structure toward the brightest buckets, the punchy
    flame look. Exposure then multiplies the color that curve produced, so it
    brightens or dims the finished image. Vibrancy fades between
    the density-scaled color at 100% and a flat, density-blind one at 0. The
    very lowest densities ride a straight line instead of the curve, so a
    single stray early sample can't flare into a bright speckle on an
    unconverged frame. **Palette (restarts render)** picks the gradient (see
    **Appearance → Custom** for the shared editor), and it does mean the
    restart: the accumulated color sums have the old palette baked into them.
  - **Blur** — flam3's _density estimation_, which smooths sparse regions
    while leaving converged ones sharp. Every output cell picks its own blur
    radius from how many samples landed there: **Blur Radius** (1–15px,
    default 6) is the widest, used where almost nothing landed; **Sharp
    Radius** (0–15px, default 0) is the floor it narrows to once a cell is
    well sampled; and **Blur Falloff** (0.1–3, default 0.4) is how fast it
    travels between the two as the count climbs — below 1 leaves some
    smoothing on middling cells, above 1 snaps to the floor after a handful
    of hits. All three re-run only that one pass over the existing histogram,
    never a re-accumulation, and a change made while a render is still
    converging takes effect when it finishes. (Sharp Radius may be dragged
    above Blur Radius, but nothing comes of it — the render caps it there.)
  - **Quality** — the **Quality** slider steps a 1-2-5 ladder of iteration
    budgets from 1M to 2B (default 20.0M). Raising it _extends_ the run in
    place instead of starting over, so a converged flame can always be pushed
    further; lowering it below what has already accumulated finishes the
    render where it stands. **Supersample (restarts render)** (1×–3×, default
    2×) accumulates into a correspondingly larger histogram and downfilters it
    for every displayed frame, trading memory and time for smoother edges —
    and when the requested factor doesn't fit in memory a note under the
    slider says what it was reduced to.
- **◆ Solid** — the attractor as a lit, shadowed solid: the chaos game fills a
  cubic density grid and a raymarcher lifts a surface out of it, colored by
  the explorer's **Color Mode** or by a gradient. Unlike the flame's frozen
  still the camera stays live while it converges, and the surface and lighting
  controls react at full frame rate. Its status block counts the same way
  ("12.3M / 20.0M iterations (61%)"); until the worker's first grid lands there
  is nothing in the volume for rays to hit, so the point cloud deliberately
  stays on screen rather than flashing an empty frame at you.
  - **Surface** — **Surface Level** (0.02–0.95, default 0.30) is where the
    surface is cut through the density, measured on a log scale so that a
    given level lines up with what reads as "bright" in a Flame of the same
    system. Lower values wrap the shape around fainter, sparser hits —
    bulkier, noisier, diffuse edges included; higher values keep only the
    densest core, crisper but liable to thin fine structure away entirely.
    **Palette (restarts render)** offers the same gradients as the flame's,
    plus **By Color Mode (legacy)**, which hands coloring back to
    **Appearance**'s **Color Mode**; the restart is needed because each
    voxel's running mean color already has the old palette in it.
  - **Lighting** — **Light Angle** (−180°–180°, default 135°) swings a single
    directional light around the shape; **Light Height** (5°–85°, default
    50°) raises it from the horizon — the 5° floor is deliberate, since a
    light at grazing height puts the whole volume in its own shadow; and
    **Ambient** (0–80%, default 25%) sets how bright fully shadowed faces
    stay, topping out below 100% because a full ambient floor would erase
    every shading cue at once. All three are plain shader uniforms, so they
    redraw instantly with nothing to re-accumulate.
  - **Quality** — **Quality** (1M–100M iterations, default 20M) behaves like
    the flame's: raise it and accumulation continues past what already looked
    done, lower it and the render finishes where it stands. **Detail
    (restarts render)** (64³–512³ in steps of 32, default 192³) is the grid's
    voxels per axis, and its restart is the heaviest kind: the whole render
    session is torn down and begun again, because a grid's dimensions are
    fixed when it is allocated and nothing can be reused. Cost grows with the _cube_ of that
    number, which is why 192³ is the shipped detail-vs-memory compromise and
    256³ already costs about 2.4× the memory; when the requested size doesn't
    fit, a note under the slider says what was built instead.
- **◈ Surface** (fr-7jlk) — a fourth render alongside Flame and Solid: the
  attractor as a true implicit surface, sphere-traced live against an
  analytic distance estimator instead of accumulated from chaos-game
  samples. It needs no worker and no accumulation, so it renders instantly,
  and unlike the flame's frozen still the camera stays live exactly like the
  solid render — orbit, pan, and zoom the tracer from any angle. Detail is
  view-dependent rather than sample-dependent: zoom in and the surface keeps
  resolving finer instead of showing the grain a still would at the same
  zoom. Not every system has a valid distance estimator, so the button
  disables itself — with the reason in its tooltip — whenever any active
  map (or the final-transform lens) uses variations, is nearly flat
  (scale ≈ 0), or does not contract (scale ≥ 1), and also when the map
  count exceeds the tracer's fixed uniform budget: the bare active-map
  count against a 24-map limit, for flat and 4D systems alike (the 4D
  limit was raised from 16 by fr-dqlq, which moved that tracer's per-map
  arrays into a std140 uniform block — the 24-map **24-cell** presets
  surface now). **Symmetry** no longer counts against that budget: the flat
  tracer used to expand each kaleidoscope copy into a map slot of its own,
  so a 4-map system was capped at 6-fold and higher orders disabled the
  button, but fr-x029 made the distance estimator sweep the symmetry
  sectors around the base maps instead — any order is admissible now, at a
  proportional cost in trace time rather than in slots. High orders do
  soften the estimate (more branches per level than the tracer's beam can
  follow), which can show as faint membranes across the shape's voids.
  **Pure-fold maps** are no longer an automatic disqualifier either
  (fr-5rvk): a map whose variation list is exactly one fold-family entry
  (`boxfold`/`spherefold`/`mandelbox`) is a composition the tracer can
  sweep the inverse branches of, so it stays eligible — a blend (the
  shipped **Mandelbox** preset pairs `mandelbox` with `linear`) still
  trips the uses-variations reason, since a weighted sum has no
  per-branch inverse. A **pure-fold final transform** is eligible too
  (fr-g58b): the lens applies once to each query, so its fold expands
  into one round of branch root descents around the untouched estimator
  — Surprise Me's boxfold-final rolls now surface-render, and a fold
  lens over an affine base costs only a few times an ordinary trace
  (the branch prunes carry the rest), far below an iterated fold
  system's frontier. No contraction requirement applies to the lens
  (an un-iterated map needs none), but blended final lists stay out.
  For iterated fold maps the contraction check changes shape too: the
  whole weighted fold must contract, not just
  its affine part, so a fold map can look tame in the editor yet still
  trip the does-not-contract reason — and, the other way, a small enough
  weight can rescue an affine part that would otherwise read as expanding.
  A single pure-fold map that does NOT contract — the canonical Mandelbox
  parameterization, weight ~2 — keeps the Surface button enabled anyway
  (fr-kltj): such a map has no IFS attractor at all, so Surface marches
  its **escape-time set** instead (the classic ray-marched Mandelbox
  object, Julia-form: the transform's own offset plays the role of the
  constant), disclosed by the mode's status note. This render is cheap —
  ~30 branchless fold iterations per ray step, no branch frontier — and
  the session opens with the camera pulled out to frame the bailout ball
  (the chaos-game cloud such a map produces is escape-reset debris, so
  the explorer camera would otherwise start inside the solid). Multi-map,
  blended, kaleidoscoped or final-transform systems have no escape-time
  reading; they keep the ordinary eligibility reasons.
  **Mandelbox KIFS** in the Presets menu is the pure-fold showcase and
  loads straight into Surface mode. Orbiting or tumbling one also starts
  its live preview at the preview ladder's floor rung rather than the
  usual mid-ladder entry — sized so the first frame costs about what a
  fold-free system's does, since a fold descent runs orders of magnitude
  pricier per pixel. Previews are traced as the same bounded scissor
  strips as the settle/capture tiers (fr-du81): a frame too heavy to
  finish inside its per-frame budget presents its partial progress and
  continues across frames instead of handing the GPU one unbounded
  submission — on a device far too slow for the system (a phone on a fold
  preset, software GL) the image fills in progressively and the page
  stays responsive, where it used to wedge the GPU process outright.
  On an especially heavy view, the preview and the full-detail pass can both
  take a long time; a progress row under the Surface hint (fr-zx34) shows
  how far along each one is ("Preview 43%", "Full detail 0.4%") so you can
  judge whether to wait it out or move the camera on — the render never
  gives up on its own. The preview tier itself is yours to control
  (fr-37c6, and deliberately never a patience guess): a **Quick previews**
  checkbox above the progress row turns it off wholesale — the view then
  holds its last frame while you move and the full render starts the
  moment you stop, developing progressively over the held image (worth
  trying on machines whose previews come out coarse, like a slow WebGPU
  stack; flipping it off mid-grind takes effect immediately). It is a
  per-browser preference, remembered on this device and never carried by a
  shared link. With previews on, a grinding preview shows a one-shot
  **Skip preview — full detail now** button under the progress row that
  abandons just that preview and starts the full render at once — the next
  move previews as usual. **Save PNG** refuses nothing and guesses at no
  patience of yours: its modal discloses how much of the frame is
  resolved and its **Cancel** stops the work within a tick, however long
  the capture would otherwise take. The
  first fold surface entry of a session also compiles the fold tracer
  program — a one-off measured at ~25s on Mesa/Iris (the browser caches
  the compiled program afterwards) — which now happens while the explorer
  stays on screen, compiled in the driver's background threads where it
  offers them (`KHR_parallel_shader_compile`); on drivers without the
  extension the stall still exists but lands before the mode's first
  frame rather than inside it. A system extending into 4D is not a blocker but a different
  tracer: the mode marches the
  **W slice** cross-section of the rotor-posed 4D attractor, and the 4D
  pose stays live inside the mode — the tumble keeps turning, Shift-drag
  keeps rotating the hidden planes, and the **W slice** slider sweeps the
  cut through the shape in real time. (The slice toggle's ghosting is a
  point-cloud affair; the surface mode always marches the current slice
  position.) A **Slice thickness** slider (fr-wa6o) sits under it, giving
  that cut some depth — see the 4D section below. Anisotropic
  (non-uniformly scaled) maps are a
  softer case: the button stays enabled, but the mode's own status note
  warns that those maps are marched conservatively — a smaller step size
  that trades some speed to stay a safe, non-overshooting bound. Its own
  **Surface Look** section holds the mode's live look: a **Color source**
  select — By Transform, the orbit-trap Palette, a Height ramp, a Radius
  ramp, Orbit rings, or Orbit sheets — with a **Palette** select underneath
  (the same named gradients as Flame/Solid, the shared **Custom** gradient
  included — see **Appearance**) that appears for the orbit-trap,
  rings, and sheets sources, plus a **Color speed** slider — orbit-trap
  source only, fading how quickly deeper descent levels blend into the trap
  color — and **Light Angle**, **Light Height**, and **Ambient** sliders.
  Every one of them is a plain shader input, so dragging any of them
  re-renders instantly with nothing to restart. The orbit-trap Palette source
  also takes each map's ramp slot from its authored **Color → Index** (see
  **Edit Transform N**) where one is set, spreading maps evenly across the
  gradient otherwise — that one is document data rather than a live shader
  input, so author it in the explorer and then enter the mode. A map's
  per-transform **Speed** does nothing here, and is not the **Color speed**
  slider above, which fades descent levels rather than picks.
  Two persisted scene toggles round out the section. **Balloon** (fr-5wlv)
  — with its **Balloon size** slider and **Inflate** button — is the same
  balloon as **Appearance**'s **Balloon echo** below (one setting, shared
  across renderers), here traced as real geometry rather than echoed
  points: the scene becomes the union of the attractor and its
  sphere-inverted copy, so the fractal sits at the center of an enclosing
  cave whose wall is itself, turned inside out — with its own shadows
  falling onto that wall. The wall receives shadows but never casts them:
  an enclosing shell that cast shadows would occlude the light and black
  out the whole scene. Rays that clear both surfaces still show the
  ordinary **Background**. Ticking the box re-enters the render session
  (a recompile-class change, not the look sliders' instant response), but
  the size slider stays live per frame exactly like the 4D rotor —
  dragging it, or pressing **Inflate**, renders as the interaction tier's
  previews and settles once parked. The full-size poses settle within the
  render's ordinary budgets; a slider parked mid-inflation (well below
  1×) on a heavy lens system may settle with its deepest creases soft — a
  disclosed budget trade, never a hang. The rows hide in a live 4D
  surface session (the balloon is 3D-only for now) and for an escape-time
  session, where the balloon isn't just unavailable but permanently
  inert: the escape solid is filled all the way to the ball's center, so
  its inverted echo would swallow the camera, and that render stays
  plain. **Floor** (fr-rhn5) puts an infinite neutral-gray floor just
  below the shape to catch its shadow — the classic ray-marched-fractal
  grounding, and the scale reference fold monsters otherwise lack. The
  floor is matte-lit by the same **Light Angle** / **Light Height** /
  **Ambient** as the surface, takes a soft penumbra shadow plus contact
  occlusion where the shape nears it, is fogged by distance like any hit
  (see **Fog** below), and fades radially into the backdrop so no disc
  edge ever shows; it is one-sided, so a camera below it looks straight
  through. Unlike the balloon it survives the escape-time session —
  the Mandelbox solid casts its shadow on it happily — hiding only in a
  live 4D surface session; it is likewise a recompile-class toggle, and
  the two compose one way only: while both are ticked the **Balloon**
  wins (there is no horizon to stand a floor on inside a closed shell),
  and the floor returns when the balloon goes off. Expect the floor to
  cost something on heavy fold systems — every pixel of floor used to be
  a cheap background miss and now pays a shadow march against the fractal
  — absorbed by the same bounded-progress machinery as every other
  expensive surface frame. **Save PNG**
  captures it at the chosen **Capture size** exactly like the solid render — a fresh,
  higher-resolution trace, not an upscale — and ★ Save to collection /
  📍 Add keyframe tag the saved
  entry with the Surface mode exactly like Flame/Solid, so loading it, or a
  timeline leg reaching it, re-enters the tracer. A Surface keyframe still
  HOLDS the timeline's schedule at launch like a Flame/Solid one, but
  because the render is instant rather than accumulating, the hold resolves
  the moment the tracer lands — there's no convergence wait to sit through.
- **Edit Transform N** — appears under **Transforms → Select to edit** while a
  transform is selected: sliders for its position (X/Y/Z), rotation (X/Y/Z, in
  degrees), and scale (X/Y/Z) give exact per-axis control on every device. The
  sliders track the guide box live and stay in sync with the drag gestures
  above.
  - **Color → Index / Speed** (fr-hiyu) — the flam3 per-xform color pair, one
    group below **Weight**. **Index** is the palette slot this map pulls the
    flame's structural color coordinate toward; **Speed** is how far each pick
    moves it (`0` keeps the incoming color — flam3's "symmetry" xform, which
    shades without recoloring — and `1` snaps straight to the slot). **Index**
    bites on a **Flame** or **Solid** render, and also the **Surface** render's
    orbit-trap **Palette** color source; **Speed** stays **Flame**/**Solid**
    only — the surface descends a map rather than picking one, so there's no
    per-pick travel there for Speed to control. All of it needs a gradient
    palette active. Both start on the value the renderer already uses — maps
    spread evenly across the ramp in list order, at speed `0.50` — and stay
    unset until you actually move a slider, so a scene saved before you touch
    them is byte-identical to one saved after. Importing a `.flame`
    (see [flame-interop.md](flame-interop.md)) fills them in from the file's
    own `color` / `color_speed` attributes, which is what makes an imported
    flame keep its authored color structure. The final transform has no Color
    group: it is applied to every plotted point rather than _picked_, so it
    never moves the coordinate.
- **+ Add / − Remove** — add or remove a transform (at least one always remains).
- **Presets** — a dropdown that replaces the whole system with a named fractal,
  from the Sierpinski tetrahedron and Menger sponge to the 12-map icosahedron
  and 20-map dodecahedron flakes, plus dedicated **Flame** and **4D** groups.
  Loading one — like Surprise Me and a gallery load — morphs the attractor
  smoothly from the current shape into the new one instead of snapping; the
  OS's reduced-motion preference opts out to the instant snap (fr-a04l).
- **Surprise Me** — rolls a whole new random system rather than a named one:
  two to four maps, a kaleidoscope about 30% of the time, a final-transform
  lens about 25% of the time, and about 25% of rolls 4D (which since fr-msw5
  may be 4D kaleidoscopes). Rolls are quality-gated — each candidate is probed
  with a short chaos game and rejected if it collapses to a point, escapes, or
  otherwise fills too little of its own bounds, and the roll retries up to
  forty times. Exhausting all forty is a backstop that measurement says
  effectively never fires; when it does, the best-scoring candidate is used
  rather than nothing. Like a preset it morphs in and is a single undo step.
- **🧬 Mutate** (fr-3vly) — the middle ground between the sliders and a total
  reroll: a 3×3 modal of small variations _around_ the current system, with the
  system itself pinned in the center for comparison. Eight candidates are
  nudged from it — every field perturbed a little, quality-gated the same way
  Surprise Me's rolls are — and the last cell is a bolder **wild** one that
  also kicks the structure rather than only the numbers. Cells fill in one at a
  time so the modal opens instantly. Clicking one morphs into it as a normal
  undoable load and re-seeds the grid around your pick, so you can keep walking
  outward a step at a time; **↻ Mutate again** rolls eight fresh variations of
  where you are now. Nothing touches the scene until you pick.
- **▶ Drift** (fr-wavo) — next to **Surprise Me**: an ambient, ever-evolving
  show for leaving the explorer running (a TV via the PWA, a second screen).
  While drifting, the explorer dwells on the current attractor for about five
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
- **Adaptive resolution** — on by default: when frames get slow the explorer
  quietly draws at a lower internal resolution and scales it up, stepping down
  a five-rung ladder to half linear resolution at worst. Recovery is
  deliberately unhurried — one rung back only after frames have been
  comfortably fast for a few seconds, so the picture can't flap between
  sharpness levels — which means climbing back from the floor takes on the
  order of ten seconds of easy frames. Untick it to pin full resolution and
  accept the frame rate, e.g. while judging fine detail. It never scales
  exports, a rolling video capture, or the Flame render (whose accumulation
  buffer is sized separately), and the Surface render ignores it entirely —
  that mode has its own preview/settle ladder. The Solid render's raymarch
  _is_ governed, so a slow solid trace goes soft before it goes choppy; its
  voxel grid is unaffected either way (see **Detail**). Session-only: it is a
  device preference, so it never rides in a link or scene file.
- **Color Mode** — see [architecture.md](architecture.md#color-modes).
- **Ramp Palette** (fr-3b6) — appears while **Color Mode** is **By Height** or
  **By Radius**, the two modes that _are_ a 1-D ramp — and, in the 4D
  projection, while **4D Color** is **By 4D Radius** (fr-6ue) — naming the
  gradient those ramps sample. **Built-in ramp** (the default) keeps the
  original hand-tuned formulas (height's blue→green→red, radius's warm→cool);
  the seven named gradients — **Spectrum**, **Sunset**, **Dusk**, **Lagoon**,
  **Ember**, **Aurora**, **Moss** — swap in a cosine gradient read at the same
  **Color Contrast**-mapped coordinate, and **Custom** selects your own
  (below). The live cloud, the panel legend, and the Solid render — wherever
  it takes its color from **Color Mode**, i.e. with its own **Palette** left
  on **By Color Mode (legacy)** — all sample the one selection, so they can
  never drift apart. Switching gradients recolors the cloud already on screen,
  like **Color Mode** and **Color Contrast**; it is never a regenerate.
  Persists in the link and scene file, and the row simply hides again under a
  color mode with no ramp (By Transform, By Position, Uniform Cyan), holding
  your choice for the next time one is active.
- **Custom** — the gradient editor (fr-55k), which opens under whichever
  palette select you set to **Custom**: a preview strip of the gradient, one
  color swatch per stop, and **+ Stop** / **− Stop**. Stops sit evenly across
  the ramp and blend linearly between neighbors; there may be 2 to 8 of them
  and the buttons disable at those bounds. **+ Stop** appends a copy of the
  last color, so the gradient doesn't jump until you recolor the new swatch.
  A scene has exactly ONE custom gradient, and all four selects offering it
  edit that same one: **Ramp Palette** here, **Palette (restarts render)** in
  Flame's **Tone** section and in Solid's **Surface** section (those two
  restart the accumulation, as their labels say, where this one and the
  surface tracer's apply live), and **Palette** in **Surface Look**. A look
  authored in one render is therefore one select away in the others. The first
  select to reach **Custom** seeds the gradient by sampling the palette it just
  replaced, so Custom always opens as a tweakable copy of what was on screen
  rather than a blank ramp; it then survives switching back to a named palette,
  and persists in the link and scene file, so an authored gradient is never
  lost. Three of those selects also keep a legacy option that opts out of
  gradients altogether: **Built-in ramp** here, **By Transform (legacy)** in
  Flame (a flat per-map hue instead of a coordinate-driven gradient), and **By
  Color Mode (legacy)** in Solid (the explorer's own **Color Mode** colors).
  **Surface Look**'s select has none — it only appears for the color sources
  that need a gradient, and its **By Transform** source is a sibling choice in
  **Color source** above it.
- **Axis Colors** (fr-8k7) — appears only while **Color Mode** is **By
  Position**: three pickers naming the color each axis contributes, blended by
  the point's normalized X/Y/Z (so a point near the far X corner reads mostly
  as the X color, one in the middle as the mix). **Reset** restores the classic
  X→red, Y→green, Z→blue mapping, which is also the default. A dark-gray floor
  keeps the near corner of the bounds from fading to black, and colors sharing
  a channel deliberately wash toward their sum near the far corner rather than
  being renormalized. The live cloud, the panel legend's swatches, and the
  Solid render all read the same three colors, and they travel in the link and
  scene file.
- **Color Contrast** — visible for the Height/Radius/Position color modes; a
  log-scale gamma on the normalized coordinate. Left (<1) spreads detail in
  the dense low end, right (>1) in the high end, center = linear.
- **Depth Style** — how the cloud conveys depth: Depth Fade (default), Aerial
  Haze, Glow + Bloom, Depth of Field, or Eye-Dome Lighting. The backdrop color
  itself is a separate choice — see **Background**, below; Aerial Haze only
  picks the fog treatment now.
- **Glow Brightness** (fr-8b1) — appears only while **Depth Style** is **Glow +
  Bloom**: a 0.1×–3× manual multiplier on top of that style's automatic
  exposure, which already dims dense clouds and lifts sparse ones so additive
  points don't blow out to white. Reach for it when the automatic choice reads
  too hot or too dim for a particular scene — 1.00× (the default) leaves the
  automatic exposure alone. Applies live, with no regenerate, and persists in
  the link and scene file.
- **Balloon echo** (fr-5wlv) — a second copy of the point cloud,
  sphere-inverted through a balloon centered on the attractor, enclosing the
  whole scene: the fractal you're orbiting sits inside a cave whose wall is
  itself, turned inside out. The **Balloon size** slider and **Inflate**
  button appear once the echo is on. **Balloon size** is the balloon's
  radius in multiples of the attractor's own extent — at 1.00× it just
  touches the shape, the default 1.60× rests past it (the enclosing-cave
  pose), and small values crumple the echo into a dense ball at the center;
  sweeping the slider plays the whole inversion continuously, the copies
  exchanging sides as it passes through the shape. **Inflate** replays that
  as an animation — from a crumpled 0.05× ball out to the 1.60× rest pose
  over about nine seconds (turning the echo on first if it was off; under
  reduced motion it lands on the rest pose immediately), and grabbing the
  slider mid-sweep stops the animation where it is. The sweep itself
  is session-only view motion — never an undo step — but the toggle and the
  size are scene content: they persist in the link and scene file, and the
  ◈ Surface render traces the very same balloon as real geometry with the
  fractal's shadows on the cave wall (see **◈ Surface** above — one
  balloon, two renderers). Echo points fade out as the inversion throws
  them far away — the same horizon the surface march caps at, so the two
  renderers agree on where the balloon ends — and the whole thing is a
  re-projection of the cloud already on screen, applied live with no
  regenerate. The row hides while the system is non-flat: the 4D
  projection's stored coordinates predate its rotation, so there is no
  meaningful place to invert them from.
- **Background** (fr-5ps1) — the two-stop gradient every render shows behind
  the attractor: **Dark** (the original ground, and the default), **Haze**
  (the cooler, lighter atmosphere Aerial Haze used to force before this
  control existed), **Auto** (fr-mz2u), which derives a darkened gradient
  from the active render's own palette — the flame/solid/surface palette
  while that render is showing, the color-ramp palette in the Points
  explorer — so the backdrop always harmonizes with the fractal and follows
  palette edits, gradient-editor drags, and render-mode switches live
  (palettes with no gradient, like Classic, keep the Dark ground; the
  derived stops are clamped dark enough that the attractor keeps contrast),
  or **Custom**, which reveals **Top**/**Bottom** color pickers for an
  authored gradient (landing on Custom from Auto seeds the pickers with the
  derived stops you were just looking at). One backdrop for the whole app —
  Points, Flame, Solid, and Surface all show it, and Save PNG / video
  captures render exactly what's on screen. Depth Fade and Aerial Haze's fog
  also tints toward it, so switching the backdrop re-tints the fog to match
  (the **Fog** and **Tint** controls below set how thick that atmosphere is
  and shift what it fades toward).
  Persists in the link and scene file — Auto persists as the choice, not as
  baked colors, so a shared link keeps tracking its scene's palette; a link
  saved before this control existed still renders exactly as it always did —
  Haze if its Depth Style was Aerial, Dark otherwise.
- **Fog** (fr-5h5d) — the depth fog's density, 0×–2.50×: how much atmosphere
  sits between you and the shape. 1.00× (the default) is exactly the fixed
  fog the app always had — links and scene files saved before the control
  existed render unchanged — and the slider scales the fog's distance unit
  around that: higher packs the fog tighter around the camera into a thicker
  haze, lower stretches it thin, and 0 turns depth fog off outright. One
  slider reaches every render with depth to convey — the explorer's
  fog-bearing depth styles (Depth Fade and Aerial Haze), the ◆ Solid render
  (which grew true depth fog with this control, so solids read a touch
  hazier than they once did), every ◈ Surface tracer (the 4D slice
  included), and the balloon echo's fade horizon above. The ✺ Flame render
  is a 2D exposure with no depth to fog, and the 4D projection's **Depth
  fade** option is a brightness fade rather than a fog, so those two stay
  untouched. There is deliberately no separate falloff slider: the point
  cloud's fog is a linear near/far band while the solid and surface fogs
  are exponential in the shape's own scale, so no single falloff number
  could mean the same thing across them — density alone covers the useful
  thin-to-thick range. Applies live everywhere (never a restart), and
  persists in the link and scene file.
- **Tint** (fr-5h5d) — the color half of the atmosphere pair: what the fog
  fades things toward. Fog normally fades toward a color derived from the
  **Background**, which is what keeps fogged geometry looking
  veiled by what's actually behind it; the tint pulls that derived target
  toward your chosen color by the strength percentage — 0% (the default)
  leaves the derivation alone, 100% fades fully to the tint, so a red tint
  at depth reads as warm murk no matter the backdrop. Because the tint
  applies _after_ the backdrop derivation, editing **Background** keeps a
  tinted atmosphere meaningful rather than silently overriding it. It
  reaches the same renders as **Fog** above, minus the two brightness fades
  that have no color to shift (the balloon echo's horizon and the 4D
  projection's Depth fade dim points rather than blend them). Live and
  persisted, like the density.
- **Auto-update on change** — regenerate the cloud on every edit vs. on demand.
- **Capture size** — in the **Capture** section, the resolution **Save PNG**
  renders at, as a multiple of the screen: **1× (screen)**, **2×**, or **4×
  (print)**. It is a real re-render at that size, not an upscale — the Solid
  and Surface renders re-trace, and changing it while a Flame is up restarts
  that render so it accumulates at the new size and its grain matches the
  output. Large sizes get clamped: the long side never exceeds 8192px, the
  device's own texture limit can cut it further, and a live flame is capped
  again by its accumulation memory. A Surface render on the WebGPU tracer
  is not clamped by GPU memory, though: a big export traces in horizontal
  bands sized to what the device can hold and assembles them, so 4× is a
  matter of waiting (the modal's percentage counts the bands) rather than
  of what fits. While a video recording is rolling, Save
  PNG is pinned to 1× whatever this says — resizing the shared canvas
  mid-stream would break the capture.
- **Save PNG** — download the current frame as a PNG. The image is the bare
  render (fractal and backdrop) without the panel, help box, or vignette, so it
  captures whatever depth style and color mode are active.
- **● Record video** — records the canvas as you drive it: orbit, drag sliders,
  run a Drift or a timeline, and press the button again to finish. While
  rolling it becomes **■ Stop** with the elapsed time, and it stops itself at
  the 2:00 cap. The clip downloads as MP4 where the browser can encode it and
  WebM otherwise, with its duration metadata patched in so players scrub it
  properly. For an authored clip that is frame-exact rather than realtime, use
  **Timeline → ⏺ Export clip** instead.
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
- **Symmetry** (fr-6im) — kaleidoscope replication of the whole attractor:
  **Order** draws every chaos-game point up to 12 times (1 = off), the
  copies rotated evenly in the chosen **Plane** — any of the six coordinate
  planes (fr-q0h6). XY / XZ / YZ turn in ordinary 3-space; picking XW / YW /
  ZW turns the copies through the fourth axis, which by itself makes the
  system 4D and hands the view to **4D View**'s tumbling projection.
  **Twist** adds the second angle of a 4D double rotation: copy `k` also
  turns `k · twist` sectors in the plane's orthogonal complement, so 0 is a
  simple rotation, any nonzero value is 4D the same way a w-plane is, and 1
  and order−1 are the left/right isoclinic cases. Only `order` distinct
  twists exist, so the value caps itself at order−1 — as you drag, and
  equally when a shared link carries a larger number (the link decoder
  applies the same cap the order itself gets). If
  order × transform count would exceed the 256-transform budget, a note
  under the sliders names the reduced order that actually renders. The
  whole setting persists in the link, and every render mode — Points,
  Flame, Solid, Surface — renders the same kaleidoscope.
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
  3D fractal. That's the point cloud's picture specifically: a Surface
  session (fr-b30z) keeps the same slider live but positions a hard,
  zero-thickness cross-section instead — the tracer marches exactly that w,
  with no ghost context and no soft window around it. Since fr-33yb the
  slider lands on the same physical hyperplane in both views, normalized to
  the cloud's rotated-w support at the current rotation rather than a raw
  world-w value. **Slice thickness** (fr-wa6o, Surface sessions only) gives
  that razor-thin cut some depth: at 0 — where it starts — the render is
  the pure cross-section described above, everything exactly at one w;
  raise it and the tracer instead renders everything lying within that much
  of the slice plane on either side, all of it projected down into the same
  3D view. Thin-to-medium settings are where the interesting shapes live —
  a hair of thickness thickens a wispy cross-section into something solid
  and reveals how the structure leans through w, while the top of the range
  (0.5 = half the shape's w-extent to each side, so the whole thing when
  centered) piles so much of the object into one image that the detail
  fills in. It is not free: a thicker slab is more surface for the marcher
  to find, so expect the preview and the full-detail pass to take longer as
  you widen it. **Slice-relative color** (fr-nn6, shown while the slice is on
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
  and every transform's editor — and so does the render-mode switch: Flame,
  Solid, and Surface all render a non-flat system on their own 4D paths
  (fr-5b3/fr-4wd for the flame and solid accumulators, fr-vxoj for the
  tracer; the Surface button still gates on distance-estimator eligibility
  exactly as it does for a flat system, see **◈ Surface** above). Flame and
  Solid _freeze_ the view they start from — one snapshot of the rotor, the
  slice window, and the **4D Color** choice, held for the render's whole
  life — so the tumble parks and this section's sliders hide until you
  return to Points. Surface instead keeps the rotor and W slice live per
  frame, so the auto-tumble goes on turning under the tracer and the
  Shift-drag / Shift-wheel gestures above still steer it — and this
  section's own controls stay reachable there too (fr-b30z), rather than
  hiding with the rest: **Auto-tumble (XY+ZW)** and **Tumble speed** behave
  exactly as in Points, and the **W slice** position slider stays live and
  shown unconditionally, since the tracer marches a cross-section every
  frame regardless of any toggle — joined there by **Slice thickness**
  (fr-wa6o), which is that tracer's control alone and appears nowhere else.
  The **W slice** on/off checkbox hides
  anyway — there's no off state left for it to mean — and so does
  **Slice-relative color**, since the tracer has no w-ramp palette for it to
  remap. What does drop out of the panel is the flat-only look controls:
  **Color Mode** and **Depth Style** are superseded in place by **4D
  Color** and **Depth fade** above, and **Color
  Contrast** goes with them (it tunes the height / radius / position ramps,
  none of which are in play once 4D Color owns the coloring).
  **Symmetry** stays put (fr-q0h6): the 4D chaos game runs its own
  kaleidoscope stage, so Order, Plane, and Twist keep editing the live
  projection — and the frozen flame/solid snapshots and the live surface
  tracer render the same kaleidoscope (see **Symmetry** above). The
  tumble/slice view is session-only (never persisted) and resets to
  a fresh baseline only when the system flips from flat to non-flat, or a
  whole new system replaces it (preset load / Surprise Me) — never on a
  later edit, so an in-progress tumble/slice survives ordinary parameter
  tweaks. See
  [4d-exploration.md](4d-exploration.md) for the design.

## Sharing & persistence

The scene — transforms, the optional final transform, point count and size, color
mode, depth style, backdrop and atmosphere (fog, balloon, and floor included),
and guide visibility — is encoded into the page URL (`#v1=…`)
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
