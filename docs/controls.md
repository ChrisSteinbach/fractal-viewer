# Controls

Fractal Explorer keeps one selection in the shared **Transforms** section
(its **Select to edit** list): choose **🎥 Camera View** for camera mode, or a
specific **Transform N** to edit that map. The selection and editor stay put
while switching renderers. Canvas guide-box gestures are available only in the
flat **∴ Points** view; Flame, Solid, Surface, and the 4D Points projection keep
the editor selection but route canvas gestures to their own camera/view behavior.
The help box (top-left) always shows the active mode and its gestures, adapting
the wording to the device: mouse verbs
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

### Keyboard

The canvas is a focus target: **Tab** to it (or click it) and the viewpoint is
fully drivable without a pointer — for some users this is the primary path,
not a shortcut layer. Keys act only while the canvas has focus, so they never
fight the panel's own sliders; held keys repeat for continuous motion.

| Key        | Action                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Arrow keys | Orbit (the plain drag, one nudge at a time)                                                                                                   |
| `+` / `-`  | Zoom in / out (one wheel notch each)                                                                                                          |
| Space      | Pause / resume the automatic motion — 3D auto-orbit or 4D auto-tumble, the same shared choice as the panel checkboxes (see **3D View** below) |

Panning stays pointer-only (right-drag / two-finger drag); the orbit + zoom
pair reaches every framing the auto-fit starts from. The key vocabulary lives
in `src/app/keyboard-camera.ts`.

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

With the canvas focused, the same Shift convention carries to the keyboard —
the 4D viewpoint is as pointer-free as the 3D one:

| Key                     | Action                                                         |
| ----------------------- | -------------------------------------------------------------- |
| Shift + ← / →           | Turn the XW plane                                              |
| Shift + ↑ / ↓           | Turn the YW plane                                              |
| Shift + PageUp / PageDn | Turn the ZW plane (the Shift-wheel's job)                      |
| `[` / `]`               | Nudge the **W slice** center (only while the slice is enabled) |

Space toggles the auto-tumble here, exactly as it toggles the auto-orbit on a
flat scene — one shared preference either way.

## Transform mode

With a transform selected in flat Points, its **guide box** is highlighted in
white and the same gestures now edit that map. Edits regenerate the fractal live
when **Auto-update on change** is on (otherwise press **Regenerate Points**).
The selection remains in the panel in every other renderer and in 4D Points,
but no canvas guide is shown or hit-tested there.

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

The panel's active editing categories — including **Transforms**, **Xaos**,
**Hybrid schedule**, **Cloud**, **Color**, **Balloon**, **Atmosphere**, **Symmetry**, and the
contextual renderer inspector — come before **3D View**/**4D View**, then the always-available
workflow sections **Presets**, **Collection**, **Timeline**, **Capture**, and **Share**.
These are collapsible sections, and opening one closes the previous. The collapsed ones
pack into rows of chips rather than stacking, because nine stacked
headers cost 473px of a 727px phone screen before any control was visible.
Measured, that keeps the panel between one and two phone screens rather than
the one it used to claim: 727px with **Color** open, 1336px with
**Transforms** open and a transform selected. The Flame, Solid, and Surface render
modes get the same treatment — **Depth** for Points, **Tone** / **Blur** /
**Quality** for Flame, **Surface** / **Lighting** / **Quality** for Solid, and
**Color** / **Shape copies** or **Shape trap** / **Lighting** / **Floor** for
Surface itself (see **✺ Flame**, **◆ Solid** and **◈ Surface** below) — with a status block
pinned above the sections (a progress readout for Flame/Solid, an instant
hint for Surface), and the panel remembers which contextual section was open
in each mode, so switching Points ↔ Flame ↔ Solid ↔ Surface restores where you
were. **Transforms**, **Xaos**, and **Hybrid schedule** are shared rather than
contextual: their top-level and nested open state, selected map, and authored
values survive every renderer switch.
Scroll swipes that happen to land on a slider scroll the panel without
editing its value; horizontal drags still adjust it as usual. A tap alone
sets nothing — tap-to-set is deliberately absent on touch, since
on a panel of full-width sliders a tap that lands on one is a scroll that
hasn't moved yet far more often than it's an edit, and a drag still reaches
any value the tap could have.
Loading a whole new system — a preset, Surprise Me, or a gallery load —
morphs into place instead of snapping (see **Presets** below).

- **ⓘ What is this?** — right under the panel title: a short
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
- **Xaos** — composes several systems without making every map act on every
  object. **Add system as isolated block** accepts a preset, saved scene, or
  duplicate of the current system, measures both systems' x extents, seats
  the new one beyond the old with a gap, and writes the block-diagonal
  transition rows automatically. **Balance weights so blocks render equally
  dense** is on by default. Each detected block pair then gets a leak dial:
  0% keeps the objects isolated, 1% allows occasional cross-infection, and
  100% merges them. Block structure is derived from the transition matrix;
  if hand edits make a pair non-uniform, the dial says **Customized** rather
  than overwriting or inventing a value. **Advanced: chaos matrix** exposes
  the exact rows-FROM, columns-TO numeric cells with transform color chips,
  an all-zero-row warning, and horizontal scrolling for large systems.
  Editing a row back to all 1s removes it from the document. Points, Solid,
  and both Flame backends honor the same base-map transitions; the Flame GPU
  path carries the previous base map across dispatches and consumes exactly
  one selection draw on xaos, fallback, and ordinary paths alike. Surface
  follows the same support graph in reverse: the outer map chosen by a beam
  chain determines which predecessor maps or emitter shapes may occur next.
  Xaos magnitudes above zero change density but not Surface geometry, while an
  all-zero effective row uses the same global fallback as the point engine.
  The editor remains available while any renderer is showing. A cell commits
  as one edit; a leak dial updates its document value and Points cache while
  dragging, then settles once on release. Flat, Balloon-off Flame and Solid
  restart with the active seed at settlement. A 4D or Balloon accumulation
  stages the change for its next entry because its bounds come from Points.
  Surface re-enters in place with the inspection camera preserved, or exits to
  Points with the analyzer's refusal rather than tracing a graph-blind object.
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
    unconverged frame. **Flame palette (restarts render)** picks the gradient
    (see **Color → Custom** for the shared editor), and it does mean the
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
    **Solid palette (restarts render)** offers the same gradients as the
    flame's, plus **Classic**, which hands coloring back to
    **Color**'s **Color Mode**; the restart is needed because each
    voxel's running mean color already has the old palette in it.
    The shared top-level **Balloon** section carries **Balloon echo**,
    **Balloon palette**, **Balloon size**, **Inflate**, and **Tint** into this
    render without moving or duplicating the editor. Solid remaps each ray
    query through the existing density volume, so these apply live and never
    build or enlarge a second voxel grid. If the current
    density already fills its enclosing-ball centre, the checkbox stays
    checked but disables with an explanatory note: inverting that interior
    would put the camera inside an unbounded solid. A later eligible system
    restores the authored setting automatically.
  - **Lighting** — **Light Angle** (−180°–180°, default 135°) swings a single
    directional light around the shape; **Light Height** (5°–85°, default
    50°) raises it from the horizon — the 5° floor is deliberate, since a
    light at grazing height puts the whole volume in its own shadow; and
    **Ambient** (0–80%, default 25%) sets how bright fully shadowed faces
    stay, topping out below 100% because a full ambient floor would erase
    every shading cue at once. This is Solid's independently persisted voxel-
    material look: all three are plain shader uniforms that redraw only Solid,
    live, without changing the separate Surface lighting state or
    re-accumulating the grid.
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
- **◈ Surface** — a fourth render alongside Flame and Solid: the
  attractor as a true implicit surface, sphere-traced live against an
  analytic distance estimator instead of accumulated from chaos-game
  samples. It needs no worker and no accumulation, so it renders instantly,
  and unlike the flame's frozen still the camera stays live exactly like the
  solid render — orbit, pan, and zoom the tracer from any angle. Detail is
  view-dependent rather than sample-dependent: zoom in and the surface keeps
  resolving finer instead of showing the grain a still would at the same
  zoom. Not every system has a valid distance estimator, so the button
  disables itself whenever any active A
  map (or the final-transform lens) uses variations, is nearly flat
  (scale ≈ 0), or does not contract (scale ≥ 1), and also when the map
  count exceeds the tracer's fixed uniform budget. The complete refusal is
  shown in the status beside the mode switch for keyboard and assistive
  technology, with the tooltip and touch toast as supplements. An ordinary document
  counts its bare active maps; a **Hybrid schedule** counts the physical
  `A | B | emitter` records together against the same 24-slot limit, for
  flat and 4D systems alike (the 4D
  limit was raised from 16 by moving that tracer's per-map arrays into a
  std140 uniform block — the 24-map **24-cell** presets
  surface now). **Symmetry** no longer counts against that budget: the flat
  tracer used to expand each kaleidoscope copy into a map slot of its own,
  so a 4-map system was capped at 6-fold and higher orders disabled the
  button, but the distance estimator now sweeps the symmetry
  sectors around the base maps instead — any order is admissible now, at a
  proportional cost in trace time rather than in slots. High orders do
  soften the estimate (more branches per level than the tracer's beam can
  follow), which can show as faint membranes across the shape's voids.
  A transform with a samplable **shape emitter** is the other supported map
  kind: Surface marches the condensation set `C0 union f_j(A)`, so the
  shipped **Gearworks** and **Star Foundry** presets render the master shape
  and every recursive copy instead of refusing the document. **Shape levels** chooses all depths,
  root only, or a custom inclusive min/max word-depth band (root is 0).
  Emitters do not recurse and their variations are skipped; ordinary maps
  remain the recursive alphabet. In a schedule-free document the 24-slot
  gate therefore counts ordinary maps plus symmetry-expanded emitter
  records; with a schedule, B's supported affine maps sit between those two
  groups. Symmetry copies share the emitter's one color/material slot.
  Unsamplable or nearly-flat emitters,
  emitter-only documents and an emitter on the final transform remain
  refused. In a 4D Surface session the 3D emitter solid is embedded at local
  w=0, so **Slice thickness** is clamped to 0 for condensation geometry.
  A non-trivial **Xaos** matrix adds no map slots: each inverse chain carries
  its current logical-map state and admits only graph predecessors. The root
  is unconstrained, as is a Hybrid schedule's finite B prefix; the first A
  inverse establishes the graph state. Symmetry copies share one state, and
  emitter terminals use that same mask. A zero xaos entry removes geometry
  support for that transition; any positive value restores it regardless of
  magnitude. If the inverse analyzer refuses a xaos document, Surface does
  not fall through to an escape-time tracer that would ignore the graph.
  **Pure-fold maps** are no longer an automatic disqualifier either: a
  map whose variation list is exactly one fold-family entry
  (`boxfold`/`spherefold`/`mandelbox`) is a composition the tracer can
  sweep the inverse branches of, so it stays eligible — a blend (the
  shipped **Fold Lattice** preset pairs `mandelbox` with `linear`) still
  trips the uses-variations reason, since a weighted sum has no
  per-branch inverse. A **pure-fold final transform** is eligible too:
  the lens applies once to each query, so its fold expands
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
  parameterization, weight ~2 — keeps the Surface button enabled
  anyway: such a map has no IFS attractor at all, so Surface marches
  its **escape-time set** instead — the classic ray-marched Mandelbox
  object, in the Mandelbrot form every published render uses,
  disclosed before entry by the status beside the mode switch. The transform's own offset is not
  the escape constant; it shifts the fold's centre, so it deforms the
  object rather than replacing it, and an offset of zero gives the
  textbook Mandelbox at whatever weight the fold carries. This render is cheap —
  ~30 branchless fold iterations per ray step, no branch frontier — and
  the session opens with the camera pulled out to frame the bailout ball
  (the chaos-game cloud such a map produces is escape-reset debris, so
  the explorer camera would otherwise start inside the solid). A **blend** or
  a **final transform** still has no escape-time reading; those keep the
  ordinary eligibility reasons. (A fold that extends into **4D** does have
  one — see the 4D paragraph further down.)
  SEVERAL pure-fold maps do have one, though, and this is where
  the mode stops being a one-map renderer: **the transform list becomes a
  formula chain.** Orbit step `i` applies link `i mod n` — the maps take
  turns, one per step, rather than composing into a single step — with the
  query offset added and the bailout tested after each one. A **pass** is
  one full cycle, so the iteration budget still reads "how many times is
  each link applied": adding a link lengthens the orbit, it does not shorten
  each map's share of it. The tracer carries at most 24 links, the same
  budget the descent's maps ride.

  Every link keeps its **own** map: its own affine part, its own fold weight,
  its own fold kind, and its own fold radii. A chain can therefore mix kinds
  — a mandelbox link beside a box fold — and mix signs, which is what the
  shipped chains do. The **weight** stays the family's real knob at every
  link.

  Three things worth knowing before you build one. Chaining **improves** the
  render rather than straining it: cycling re-floors the estimator's
  derivative at every link, so more links means a tighter bound, and the
  measured bound-violation rate falls from 13.4% for the single map to 4.3%
  at two links and 1.5% at six — the shipped single Mandelbox is the worst
  case in the family, not the safest. It costs far less than the budget
  implies, because every extra link is another chance for the orbit to leave
  the bailout ball: a six-link chain measures 2.4× the single map's cost per
  estimate, not 6×. And a long chain is **less** sensitive per link — moving
  one link's fold displaces the object 3.8-6.4× less than moving the same
  map alone, so per-link edits get finer as the chain grows rather
  than wilder.

  A **kaleidoscope** rides along, and it is a different mechanism here from
  the one the explorer gives you: the query is folded into a single wedge
  once, before the orbit runs, so the result is **dihedral** — mirrors as
  well as rotations — and costs nothing per orbit step. (The chaos game's is
  cyclic, rotations only.) A 3D chain takes a 3D plane; a 4D chain takes any
  of the six, `w`-planes included. Expect little to see from those last
  three, though: a w-plane wedge turns in a plane the rendered slice does not
  lie in, so there is no rosette, and at EVEN order it is a measured no-op —
  1 point in 262144 moved at orders 2/4/6/8, against ~3700 at 3/5 — so a
  w-plane wedge at order 4 is simply the same object without it.

  **A chain need not stay in 3D**. A non-contracting fold — or a
  chain of them — that reaches out of the `w = 0` hyperplane is marched as
  the **W slice** of its 4D escape-time set, the same way a contracting 4D
  system is marched as the slice of its attractor, and the persistent status
  beside the mode switch says which of the two you will enter ("Escape-time render: these
  N maps reach out of the w = 0 hyperplane and do not all contract, so
  Surface marches the w-slice of the escape-time set of the chain they form
  — one link per orbit step — rather than an IFS attractor"). Everything
  above holds one dimension up: same cycling, same per-link offset and
  bailout, same weights and fold lengths, same 24-link budget — and the
  **Quaternion square** becomes the whole quaternion square it is named
  after rather than the 3D restriction of one, four coordinates being its
  home dimension. The differences are three refusals and one
  requirement. A **Mandelbulb power 8** link is not admitted in 4D (the
  triplex power has no fourth coordinate to act on, so a chain holding one
  stays on the 3D escape-time render, which is the better one for it
  anyway); the kaleidoscope's **Twist** is not admitted (a double rotation
  has no wedge to fold the query into, where a plain w-plane wedge is fine);
  and **Slice thickness** stays at 0, because a forward orbit has no
  branches to enumerate and so cannot thread a segment through the fold the
  way the IFS descent can. The requirement is **WebGPU compute** — the 4D
  tracer that runs without it has no forward-orbit path at all — so on a
  machine with no adapter the mode disables itself with that as the reason
  rather than drawing the wrong object, and losing the adapter mid-session
  leaves the mode with a toast saying so.

  **A link need not be a fold.** Two more variations can be a link: the
  **Mandelbulb power 8** (the triplex 8th power, the map the Mandelbulb
  presets iterate) and the **Quaternion square**. So a chain can hold a
  Mandelbox and a Mandelbulb at once, and the objects that come out are not
  variants of either — they are the composition, which is what this mode was
  built toward. The two shipped examples that make the point best are a
  Mandelbox Cube whose faces have grown Mandelbulb skin, and the same two
  maps **in the other order**, which is a pitted sphere covered in
  bulb-shaped craters: link order is a real knob, not a formality.

  A power map alone is not a chain — a lone triplex power is the Mandelbulb
  presets' object and gets their (better) renderer, and a lone quaternion
  square is a smooth, detail-free thing this build deliberately does not
  march. Give either one a fold to work with and it becomes worth marching.

  The one thing to expect: a power map is **steep**. It raises its input to
  the 8th (or the 2nd), so an eighth power fed a radius of 4 returns 65536,
  far outside the bailout ball. That makes a power link's **scale** its
  loudest knob by a long way — much louder than its weight — and the shipped
  hybrids all pre-scale theirs. It is not fragile, though: the orbit adds
  the query point back after _every_ link, which keeps a power link from
  ever seeing a compounded input, and dropping a Mandelbulb next to a
  Mandelbox at scale 1 renders perfectly well (it comes out as a
  constellation of bulb nodules arranged in the fold's symmetry). Scale it
  down and the constellation closes into a crust; scale it far down and the
  set inflates toward the bailout ball and goes featureless, which is the
  same failure a fold weight has at its own extremes.

  The three **Fold Chain** presets in the same menu group are the showcase,
  and they are deliberately a lesson each. **Fold Chain** is a Mandelbox at
  the canonical 2 followed by a box fold at 1.6 through a 20° turn about `y`
  — and the turn is the whole point: axis-aligned, both folds share the
  cube's symmetry group and the second's creases land on the first's, so the
  chain would just be a longer Mandelbox. Turned, the box fold cuts across
  them, and the single map's flanged, ring-eyed body becomes a wider,
  flatter-topped mass carved by coarse voids that run right through it, at
  essentially unchanged density (6.7% of the bailout ball against 7.8%) —
  composition changing the _shape_, not the amount. **Fold Chain Boulder**
  adds a middle link at −1.5, a Mandelbox turned inside out, so the orbit
  re-enters the positive fold's output through an orientation-reversing map
  every pass; it is the densest and roundest of the three, a near-spherical
  mass finely pitted all over. **Fold Chain Flower** is the most instructive:
  it is **the same two links as Fold Chain**, and the only difference is a
  five-fold wedge that ships as part of the composition rather than as a
  setting you found. Five specifically — both links' folds are odd axis by
  axis, so a wedge at order 2 or 4 is a no-op and the preset would silently
  be Fold Chain again. Down its own axis it is a five-petalled flower around
  a ring; obliquely, which is where the session opens, radial fluting on a
  drum — so it is the one of the three that rewards orbiting to the pole.
  The Presets menu's **Escape-time** group — Mandelbox, Mandelbox Rings,
  Mandelbox Cube — are that mode's showcase, and they load
  straight into it. All three are the same single map at three fold
  weights — 2 (the classic knobbly ball), 3 (small lobes in a shell around
  a hollow centre) and −1.5 (a cube with fractal faces). The weight is the
  family's real knob and small moves along it give wholly different
  objects, so the fastest way to see what this mode does is to load one
  and drag the fold weight. Their
  position slider moves the fold's centre, which deforms rather than
  translates.
  The same group's **Mandelbulb**, **Mandelbulb Offset** and **Mandelbulb
  Rotated** are the escape-time family's second object: a single
  map whose only variation is the triplex 8th power, marched the same
  forward way and disclosed before entry by the status beside the mode switch
  ("Mandelbulb render").
  Its two knobs are the map's own — the position slider is a PRE-power
  offset that bites into the bulbs rather than sliding them (zero gives the
  textbook object), and the rotation is a genuinely different family rather
  than a different camera angle, because a rotation applied before the
  power does not commute with it. The power is fixed at 8. The balloon is
  unavailable in a Mandelbulb session for the same measured reason as in a
  Mandelbox one — a filled solid's sphere-inverted echo contains the camera
  — but the ground plane works, and a Mandelbulb on a floor is the mode's
  classic look.
  The group's last three, **Hybrid Chain Cube**, **Hybrid Chain Craters**
  and **Hybrid Chain Quaternion**, are the cross-family chains, and each is
  a different point. _Cube_ is the Mandelbox Cube's own fold weight followed
  by a pre-scaled triplex power: the cube silhouette survives, and its faces
  grow a Mandelbulb's cauliflower skin with circular pits bored into them —
  two named objects, visibly both at once. _Craters_ is the same pair **the
  other way round**, power first, and it is a different object entirely: a
  sphere whose whole surface is bulb-shaped craters. It is also the thinnest
  thing the mode ships — it occupies essentially no volume and still fills a
  fifth of the frame, which is a useful thing to have seen before you judge
  a fractal by how solid it looks. _Quaternion_ is the only place in the app
  a quaternion square is rendered at all; alone the map is smooth and
  featureless, and a fold in front of it is what gives it something to
  resolve. The menu's **Fold Lattice** (formerly labelled Mandelbox)
  is an unrelated eight-map IFS that merely uses the same fold variation.
  **Mandelbox KIFS** in the Presets menu is the pure-fold showcase for the
  IFS-side fold descent and loads straight into Surface mode. Orbiting or tumbling one also starts
  its live preview at the preview ladder's floor rung rather than the
  usual mid-ladder entry — sized so the first frame costs about what a
  fold-free system's does, since a fold descent runs orders of magnitude
  pricier per pixel. Previews are traced as the same bounded scissor
  strips as the settle/capture tiers: a frame too heavy to
  finish inside its per-frame budget presents its partial progress and
  continues across frames instead of handing the GPU one unbounded
  submission — on a device far too slow for the system (a phone on a fold
  preset, software GL) the image fills in progressively and the page
  stays responsive, where it used to wedge the GPU process outright.
  On an especially heavy view, the preview and the full-detail pass can both
  take a long time; a progress row under the Surface hint shows
  how far along each one is ("Preview 43%", "Full detail 0.4%") so you can
  judge whether to wait it out or move the camera on — the render never
  gives up on its own. The preview tier itself is yours to control
  (and deliberately never a patience guess): a **Quick previews**
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
  **W slice** cross-section of the rotor-posed 4D attractor — or, where the
  maps do not contract, of the 4D escape-time set they form instead (above)
  — and the 4D
  pose stays live inside the mode — Shift-drag keeps rotating the hidden
  planes, and the **W slice** slider sweeps the cut through the shape in real
  time. Ambient auto-tumble parks while Surface is open so its repeated frame
  invalidations cannot prevent the progressive render from settling; the
  existing on/off choice takes effect again when you return to Points. (The
  slice toggle's ghosting is a point-cloud affair; the surface mode always
  marches the current slice position.) A **Slice thickness** slider sits under
  it, giving that cut some depth — see the 4D section below. Anisotropic
  (non-uniformly scaled) maps are a
  softer case: the button stays enabled, but the status beside the mode switch
  warns before entry that those maps are marched conservatively — a smaller step size
  that trades some speed to stay a safe, non-overshooting bound. Its contextual
  inspector splits independent concerns into separate sections. **Color** holds a **Color source**
  select — By Transform, the orbit-trap Palette, a Height ramp, a Radius
  ramp, Orbit rings, Orbit sheets, or Shape trap — with a **Surface palette** select underneath
  (the same named gradients as Flame/Solid, the shared **Custom** gradient
  included — see **Color**) that appears for the orbit-trap,
  rings, sheets, and Shape trap sources, plus a **Color speed** slider — orbit-trap
  source only, fading how quickly deeper descent levels blend into the trap
  color. **Lighting** holds **Light Angle**, **Light Height**, **Ambient**, and
  **Environment**.
  This is Surface's independently persisted analytic-material look: every one
  is a plain shader input that updates only Surface, live, without changing
  Solid's lighting. **Environment** is Surface-only: from 0–100% (default
  35%), it tints the light itself toward the **Background**
  gradient, sampled along each point's own shading normal — a two-stop
  sky-above/ground-below environment, so the render sits IN its backdrop
  instead of floating in front of it (a surface facing up over the default
  dark backdrop's blue-ish top stop reads cooler; one facing down reads
  toward the bottom stop). It multiplies the WHOLE light — the **Ambient**
  term and the diffuse-times-shadow term together — not the **Ambient**
  term alone: an earlier cut tinted **Ambient** only and was MEASURED
  indistinguishable from off even at 100%, on both built-in backdrops,
  because **Ambient** is a small share of the light by default and this
  app's dark and haze backdrops sit close enough in hue that a directional
  sample between their two stops barely moves (`docs/surface-glsl-tracers.md`
  carries the numbers). The specular highlight stays untinted at every
  strength, which is what keeps a strongly tinted render from reading
  monochrome instead of lit. The sample is normalized to
  its own brightest channel before blending, so the slider moves HUE only
  and never brightness — it reads on every backdrop, including the
  near-black default where a plain additive light would vanish. It is a
  DIFFERENT knob from **Tint** below in both what it reads and how: **Tint**
  retargets the _fog_ by DEPTH — what distant geometry blends toward as it
  recedes — while **Environment** tints the light itself by shading
  NORMAL, independent of distance. By construction the two compose
  additively, so pushing both to their extremes together is worth checking
  by eye before calling a look finished, rather than assuming
  "backdrop-tinted fog" and "backdrop-lit light" always read as
  complementary. 0% is a bit-exact identity — the pre-Environment neutral
  light — so a link saved before this control existed renders unchanged at
  that setting; the shipped default is deliberately non-zero, so an
  existing shared link now renders with a subtle environment tint, which
  is intended. It does not reach the ◆ Solid render — that raymarcher's
  own module doc records the gap as accepted rather than an oversight.
  The orbit-trap Palette source
  also takes each map's ramp slot from its authored **Color → Index** (see
  **Edit Transform N**) where one is set, spreading maps evenly across the
  gradient otherwise — that one is document data rather than a live shader
  input, so author it in the explorer and then enter the mode. A map's
  per-transform **Speed** does nothing here, and is not the **Color speed**
  slider above, which fades descent levels rather than picks.
  An emitter-backed inverse-descent session gets a **Shape copies** section for
  the **Shape levels** band described above. Forward-orbit sessions replace it
  with a **Shape trap** section and a matching **Shape
  trap** color source. Choose any bundled trap shape or **None**, then set its
  orbit-space size and X/Y/Z position. It uses the same shared catalog listed
  under **Shape → Emitter** below. **Closest approach** shades by the
  nearest pass over the whole orbit; **First crossing** enables the
  **Crossing bar** and colors the first dip below it. **Trap fade** biases
  toward earlier, larger stamps. The shape choice re-enters the surface
  session because it changes generated shader structure; mode also re-enters
  by policy so both engines switch coherently. Pose, size, crossing bar and
  fade remain live. The row appears only for the escape-time and Mandelbulb
  families. **Use as geometry** additionally unions the posed shape into the
  marched object on conformal fold-only escape chains; power-link and
  Mandelbulb sessions keep the color controls but do not offer this geometry
  switch, and inverse-descent Surface routes refuse an authored geometry flag
  rather than ignore it. When that flag is the disclosed refusal, the status
  beside the mode switch offers **Turn trap geometry off**; Shape trap stays
  Surface-only. The recovery uses the same authored edit as the checkbox and
  preserves the trap's color state. **Geometry levels** selects **All**, **Root only**, or **Custom**
  inclusive post-link levels; custom exposes the minimum and maximum sliders
  and stores them as one sorted interval. Toggling geometry or changing its
  band restarts Surface because it changes the distance field. `Mandelbox
Peace` is the color example; `Fold Chain Gear` is the geometry example.
  The shared top-level **Balloon** section carries the same authored object
  into Surface, here traced as real geometry rather than echoed
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
  disclosed budget trade, never a hang. A 4D session traces it too, off
  the same setting: what the tracer inverts there is the
  **W slice** it has just marched, not the 4D set, so the echo is the
  inversion of exactly what is drawn and the two scrub together as you move
  the slice. In a FORWARD-ORBIT session in either dimension — escape-time or
  Mandelbulb — the one authored editor remains in place but disables beside
  its reason, retaining every value for recovery. Those solids are filled all
  the way to the ball's center, so an inverted echo would swallow the camera.
  That gate is about the object, not the dimension. The **Floor** section puts an infinite neutral-gray floor just
  below the shape to catch its shadow — the classic ray-marched-fractal
  grounding, and the scale reference fold monsters otherwise lack. The
  floor is matte-lit by the same **Light Angle** / **Light Height** /
  **Ambient** / **Environment** as the surface (its shading normal is
  straight up, so it takes the **Background**'s top stop), takes a soft
  penumbra shadow plus contact
  occlusion where the shape nears it, is fogged by distance like any hit
  (see **Fog** below), and fades radially into the backdrop so no disc
  edge ever shows; it is one-sided, so a camera below it looks straight
  through. Floor has no object-family refusal: it survives the escape-time
  and Mandelbulb sessions — those solids cast their shadows on it happily —
  and a 4D session drops it under the marched
  **W slice**, where it is an ordinary 3D plane like any other. (An
  off-centre slice shows a smaller shape floating above it, which is
  honest — it _is_ a smaller slice.) It is likewise a recompile-class
  toggle. The two independently persisted flags compose one way only: while
  Balloon is applicable and on in Surface, the **Floor** checkbox stays
  visible but disables beside “Floor unavailable while Balloon encloses this
  Surface.” Its saved check and settings are retained, and return when Balloon
  goes off. A refused escape-time/Mandelbulb Balloon does not gate Floor; the
  floor remains editable and visible there. Expect the floor to
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
  transform is selected and remains there in Points, Flame, Solid, and Surface:
  sliders for its position (X/Y/Z), rotation (X/Y/Z, in degrees), scale
  (X/Y/Z), and shear (XY/XZ/YZ — the affine group's remaining degree of
  freedom, no gesture above reaches it) give exact per-axis control on every
  device. In flat Points the sliders track the guide box live and stay in sync
  with the drag gestures above. Elsewhere the same editor authors the document
  without exposing a stale guide box. Points geometry follows **Auto-update on
  change**. A flat, Balloon-off Flame or Solid restarts once when a slider,
  pointer gesture, or discrete action settles; the restart uses the edited
  document rather than rebuilding on every input tick. Their 4D and Balloon
  routes keep the current accumulation and use geometry on the next entry
  (regenerate Points first when Auto-update is off). Surface re-enters once at
  the same boundary because it derives its own distance estimator directly
  from the document; it preserves the inspection camera, and an edit that
  makes the document unsupported returns to Points with the analyzer reason.
  - **Shape → Emitter** — turns the selected transform into any bundled
    emitter shape, or returns it to an ordinary transform with **None**.
    The shared catalog is **Cog**, **Star**, **Orbit Ring**, **Faceted
    Crystal**, **Heart Prism**, **Trefoil Knot**, **Crescent Moon**,
    **Snowflake Prism**, and **Peace sign**; every entry is also available to
    the shape trap.
    When this map is picked it stamps a fresh point from the chosen shape;
    Position, Rotation, Scale and Shear pose the stamp, while **Weight** sets
    how often it is picked. The transform list names the active shape. For a
    one-step shortcut, **Transforms → Add a shape emitter** creates and selects
    a new shaped map with this group already open. The final-transform
    lens has no Shape group because it is never picked.
  - **Color → Index / Speed** — the flam3 per-xform color pair, one
    group below **Weight**. **Index** sets this map's **By Transform** hue in
    Points, Flame, Solid, and Surface. It also sets the gradient coordinate
    used by Flame, Solid, and an IFS Surface's orbit-trap **Palette** source.
    **Speed** changes only the Flame/Solid gradient walk (`0` keeps the incoming
    color — flam3's "symmetry" xform, which shades without recoloring — and `1`
    snaps straight to the slot); the surface descends a map rather than picking
    one, so there's no per-pick travel there for Speed to control. An Index
    edit recolors a displayed flat or 4D Points cloud immediately only when
    that view's source is **By Transform**. A consuming Flame or Solid restarts
    once after the edit settles and reuses its current seed, so a color
    comparison does not silently resample the geometry. An applicable Surface
    re-enters for a consumed Index: **By Transform** on any supported route,
    or **Palette** on an IFS route; forward-route Palette and live Shape Trap
    use their own coordinates. Speed restarts only a Flame/Solid render using
    a structural gradient palette. Every other context stores the edit for its
    next applicable entry. Both controls start on the value the renderer
    already uses — maps
    spread evenly across the ramp in list order, at speed `0.50` — and stay
    unset until you actually move a slider, so a scene saved before you touch
    them is byte-identical to one saved after. Importing a `.flame`
    (see [flame-interop.md](flame-interop.md)) fills them in from the file's
    own `color` / `color_speed` attributes, which is what makes an imported
    flame keep its authored color structure. The final transform has no Color
    group: it is applied to every plotted point rather than _picked_, so it
    never moves the coordinate.
  - **Finish** — one group below **Color**: how this map's part of the
    surface catches light in a **◈ Surface** render, and nowhere else (the
    cloud, the flame and the solid never read it). Six sliders:
    **Specular** (`0–2`, the highlight's brightness; classic `0.40`),
    **Shininess** (`1–256`, the highlight's tightness — higher is smaller
    and sharper; classic `32`), **Metalness** (`0–1`, the highlight takes on
    the surface's own color; classic `0`), **Reflect** (`0–1`, how much of
    the surroundings the surface mirrors; classic `0`), **Transmit**
    (`0–1`, how much light passes through it as a thin shell; classic `0`)
    and **Metal tint** (`0–1`, how much a metal inherits the transform
    color; classic `1` — Chrome uses `0` for neutral reflections).
    The _classic_ values are exactly the fixed lighting formula every
    Surface render used before the group existed, so a scene that never
    touches it renders byte-for-byte as it always did. At the top of the
    group a **Material** menu offers whole-material starting points —
    **Wood**, **Marble**, **Strata** — each setting the finish AND a
    pattern family together (see the **Pattern** group below); it reads
    **None** when nothing is set (pickable, to clear both) and **Custom**
    (shown, never pickable) when the finish and pattern match no starting
    point. Below it a **bundle** menu offers finish-only named starting
    points — **Classic**, **Matte**, **Satin**, **Plastic**, **Metal**,
    **Chrome**, **Translucent** — and picking one sets all six sliders at
    once; the scene stores the numbers, never the name, so a bundle can be
    retuned in a later version without repainting anything you saved, and
    sliders that match no bundle read **Custom** (shown, never pickable).
    **A metal reads as its surroundings**: raising **Metalness** damps the
    surface's own diffuse colour away and lights it from the backdrop alone,
    so **Metal** and **Chrome** need a bright backdrop to look like metal —
    against the near-black default they render very nearly black, which is
    what a mirror does in an unlit room rather than a fault (the panel's own
    hint says so). Pair them with the **haze** backdrop, or a bright custom
    one. Like the Color pair above and the fold lengths below, each field
    stays **unset** until you move its own slider, and dragging one back to
    its classic value clears it again — the whole finish with it once the
    last field goes, which is also exactly what **Classic** does — so a
    scene you explored and returned from is byte-identical to one that never
    carried a finish, and a bundle stores only the fields that differ from
    classic (**Matte** is a lone `specular: 0`). Every active map's finish
    reaches an IFS surface, 3D or 4D, a kaleidoscope copy or a balloon echo
    included (each shades as the map that produced it). A Weight-0 map is not
    visited, so its controls disable beside a reason while preserving their
    authored values. The **escape-time** and
    **Mandelbulb** surfaces are the exception: they shade the whole object
    with the FIRST active transform's finish, so on a system the Surface
    gate would route there the other transforms' Finish rows are disabled,
    with a note saying why — the rows come back the moment the system routes
    to an IFS surface again, or that transform becomes the head. If Surface is
    wholly ineligible, every map's Finish controls disable beside the full gate
    reason; values remain authored for a later eligible document. The final
    transform has no Finish group: the tracers shade a hit by the map that
    produced it, and the lens is not one. A Finish edit is saved in every
    renderer. When its slot is consumed by the active Surface, that renderer
    re-enters once after the edit settles without resetting the camera;
    elsewhere it shows on the next **◈ Surface** entry. The transform list
    names an authored finish on its row (`Chrome` becomes `Finish: Chrome`) and
    uses `Finish: custom` otherwise.
  - **Pattern** — one group below **Finish**: how this map's part of the
    surface is patterned in a **◈ Surface** render, and nowhere else — the
    albedo texture the lighting then responds to. A **family** menu picks
    the pattern — **None** (no pattern), **Wood** (cylindrical growth
    rings), **Marble** (warped stone veins) or **Strata** (laminar bands) —
    plus an **Axis** menu (X/Y/Z, default Y: the object-space axis the
    pattern's structure runs along), a **Scale** slider and a **Strength**
    slider. Scale is logarithmic over the resolver's whole `0.5–32` span
    (periods across one normalized object-space unit) and defaults per
    family — Wood `3`, Marble `1.35`, Strata `2.6`, each exactly reachable
    on the slider's grid; Strength runs `0–1` and defaults to `1` (the full
    pattern). Like the Finish fields, nothing is stored until you move a
    control: picking a family writes `kind` and `axis` with the defaults
    left unset, a slider dragged back to its default clears it again, and
    returning the family to **None** removes the pattern entirely — so a
    scene you explored and returned from is byte-identical to one that
    never carried a pattern. A pattern family is a DIFFERENT concept from
    the material presets: the **Material** menu in the Finish group sets a
    finish and a pattern family together, but once picked the two are
    independent — any family can pair with any finish, and a pair that
    matches no starting point reads **Custom** in the Material menu while
    the family menu still names it. The same forward-orbit disclosure as
    Finish applies: escape-time and Mandelbulb surfaces pattern the whole
    object with the first active transform's pattern, so on such a system
    the other transforms' Pattern rows are disabled with a note saying why.
    The same whole-Surface and Weight-0 refusals as Finish apply, always beside
    an accessible reason and without clearing authored pattern state. Pattern
    edits are saved in every renderer. A consumed edit re-enters the active
    Surface once after it settles, preserving the inspection camera; otherwise
    it appears on the next Surface entry. The final transform has no Pattern
    group, and the transform list names an authored pattern on its row
    (`Pattern: Wood` at the family's defaults, `Pattern: custom` once tuned
    away from them).
  - **Variations → a fold's own lengths** — a `boxfold`,
    `spherefold` or `mandelbox` row carries the Mandelbox apparatus's three
    lengths nested under its weight slider: **Min radius** and **Fixed
    radius**, the ball fold's inner and outer shell, and **Box limit**, the
    plane each axis reflects off. Only the ones that fold actually reads
    appear — a box fold has no sphere and a sphere fold has no wall — so
    `boxfold` shows one row, `spherefold` two, `mandelbox` all three.
    Defaults are the classic Mandelbox `0.5 / 1 / 1`; the radii run
    `0.01–3` and the wall `0–3`, in steps of `0.005`. A wall of `0` is a
    real fold rather than a broken one: it point-reflects the axis.
    Like the Color pair above, each length stays **unset** until you move
    its own slider, and dragging one back to its default clears it again —
    so a scene saved before you touch them is byte-identical to one saved
    after, and one you explored and returned from is byte-identical to one
    that never carried them. **Min radius** cannot exceed **Fixed radius**
    (past that the ball fold is exactly the identity), so its slider's own
    ceiling is wherever **Fixed radius** currently sits, and pulling
    **Fixed radius** down below it carries it along rather than leaving a
    number on screen the renderer would not use. They bite on every render:
    the cloud, the flame, the solid and the surface trace all read the same
    three lengths. One thing to expect on **Mandelbox KIFS**: the ball
    fold's magnification `fixedRadius² / minRadius²` is exactly what the
    **Surface** gate measures, and that preset sits close enough to the
    line that dropping **Min radius** from `0.500` to below `0.478` hands
    it to the escape-time renderer instead — a different object, which the
    mode's own note says when you enter it. No other shipped system can
    reach that line at all.
- **+ Add / − Remove** — add or remove a transform (at least one always remains).
- **Presets** — a dropdown that replaces the whole system with a named fractal,
  from the Sierpinski tetrahedron and Menger sponge to the 12-map icosahedron
  and 20-map dodecahedron flakes, plus dedicated **Flame** and **4D** groups.
  This Workflow section stays reachable from every renderer. Loading one —
  like Surprise Me or choosing a mutation — first returns to Points and morphs
  the attractor smoothly from the current shape into the new one instead of
  snapping; the OS's reduced-motion preference opts out to the instant snap.
  A renderer-authored preset enters Flame, Solid, or Surface only after that
  new cloud lands, so even two consecutive Surface presets rebuild the second
  session from its own document rather than leaving the old trace on screen.
- **Surprise Me** — rolls a whole new random system rather than a named one:
  two to four maps, a kaleidoscope about 30% of the time, a final-transform
  lens about 25% of the time, and about 25% of rolls 4D (which
  may be 4D kaleidoscopes). Rolls are quality-gated — each candidate is probed
  with a short chaos game and rejected if it collapses to a point, escapes, or
  otherwise fills too little of its own bounds, and the roll retries up to
  forty times. Exhausting all forty is a backstop that measurement says
  effectively never fires; when it does, the best-scoring candidate is used
  rather than nothing. Like a preset it morphs in and is a single undo step.
- **🧬 Mutate** — the middle ground between the sliders and a total
  reroll: a 3×3 modal of small variations _around_ the current system, with the
  system itself pinned in the center for comparison. Eight candidates are
  nudged from it — every field perturbed a little, quality-gated the same way
  Surprise Me's rolls are — and the last cell is a bolder **wild** one that
  also kicks the structure rather than only the numbers. Cells fill in one at a
  time so the modal opens instantly. Clicking one morphs into it as a normal
  undoable load and re-seeds the grid around your pick, so you can keep walking
  outward a step at a time; **↻ Mutate again** rolls eight fresh variations of
  where you are now. Nothing touches the scene until you pick; the chosen cell
  then returns through Points like every other replacement load.
- **▶ Drift** — next to **Surprise Me**: an ambient, ever-evolving
  show for leaving the explorer running (a TV via the PWA, a second screen).
  While drifting, the explorer dwells on the current attractor for about five
  seconds, then glides over about five more into a fresh quality-gated
  Surprise-Me roll, dwells on that, and repeats; the panel closes when the
  show starts so the stage is clear. Starting it from another renderer first
  returns to Points, and every landing is a normal, undoable
  replace-load — the same "replace" checkpoint and camera auto-fit as
  pressing Surprise Me, so undo walks back through the show. It STOPS (never
  pauses) the moment you reach in: any edit to the system or its settings,
  undo/redo, a manual preset / Surprise Me / gallery load, switching to a
  Flame/Solid/Surface render, or starting **▶ Watch it build** — while camera drags
  and the auto-orbit / auto-tumble / W-slice view controls leave it running
  (the camera stays independent, as ever). Session-only like auto-orbit and
  auto-tumble — never persisted or shared — and unavailable while the OS
  asks for reduced motion (the persistent status above the accordion says
  why, and is associated with the disabled button): no motion means no drift.
  Between legs the show is fully idle, so it sips battery while
  dwelling; recording a video of a drifting session works as usual.
- **▶ Drift collection** — in the gallery modal's header: the same
  ambient show, but its legs walk YOUR saved collection in gallery order
  (newest first), morphing from one saved system to the next and looping
  back to the first — a slideshow of keepers instead of random rolls. Legs
  are the same undoable replace-loads as clicking a gallery card, except the
  camera auto-fits and follows the morph rather than snapping to each
  entry's saved pose (a manual card click still restores the pose exactly).
  Every entry plays in the mode it was **saved from**: a
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
  disables while the collection is empty), with either refusal written beside
  the gallery button, and it is never persisted.
- **Collection** — a persistent, multi-slot library of saved systems,
  layered over the same encoded-scene format as the single autosaved scene
  (see **Sharing & persistence** below). Available in every render mode,
  like Capture and Share. **★ Save to collection** saves the current system
  with a thumbnail of what's actually showing — the live cloud, or the
  flame/solid frame while one of those renders is up — and confirms with a
  toast. A save made from a Flame/Solid render also **tags the entry with
  that mode** (shown as a ✺/◆ glyph on its card): loading it re-enters that
  renderer once the restored cloud lands, and the drift slideshow plays it
  there. The tag lives only in your local collection — share links and the
  autosave stay mode-less. **▦ Gallery (N)** (N tracks the live
  count) opens a modal grid of saved thumbnails; clicking one loads it as a
  whole-system replacement (the same undoable treatment as a preset load or
  Surprise Me) — so you can save a keeper, keep tweaking, and still load it
  back exactly as saved. Like a preset load, it morphs smoothly into the new
  shape rather than snapping. Each card has a ✕ to delete it; Escape, the
  backdrop, or the header ✕ close the modal, and the header's **▶ Drift
  collection** starts the looping slideshow described above.
  **⬇ Back up collection** downloads the whole gallery — encoded
  scenes, mode tags, thumbnails — as one JSON backup file (disabled while
  the collection is empty). Restoring goes through **Share**'s **⬆ Import
  file**: merged entries slot into their saved chronological order, ones
  already present are skipped, and the gallery opens to show the result.
  The collection otherwise lives only in this browser profile's
  localStorage — back it up before clearing site data or when moving
  devices.
- **Share** — the current scene as a portable document, plus the
  app's one import door. **🔗 Copy link** copies a shareable `#v1=…` link
  built fresh from the current state, not the (debounced) address bar.
  **⤓ Save scene file** is the link's file counterpart (see below);
  **⤓ Export .flame** writes the system's flat XY shadow as a
  flam3/Apophysis `.flame` file other flame tools can open (see
  [flame-interop.md](flame-interop.md)). **⬆ Import file** — or dropping a
  file anywhere on the page — loads a scene file, imports a `.flame` file,
  merges a collection backup into the gallery, or restores a timeline
  backup (replacing the authored timeline — with an Undo toast
  when one was there).
- **Timeline** — an authored animation: an ordered sequence of
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
  keyframe**, wearing the gallery's ✺/◆ glyph: on playback its leg
  morphs in as the point cloud, re-enters that renderer on arrival (with the
  render settings it was saved with), and HOLDS the schedule until the
  render converges — the step's hold seconds then dwell on the converged
  image before the next leg departs. Convergence time is content- and
  device-dependent, so once any step is a render keyframe the authored total
  is only a floor — the status line says so with a "+" ("0:18+"). The
  render's accumulator seed is pinned per leg too, so the
  converged still is identical run to run, residual noise included.
  **⏺ Export clip** plays the timeline and downloads the result as a video.
  Whenever the browser can encode H.264 (WebCodecs), the export runs OFFLINE
  and frame-exact: the whole pipeline steps on a virtual clock —
  each frame's morph sample generated at its exact time, at the scene's full
  point count (no need to touch **Morph Detail**), rendered, and encoded to
  a 30 fps MP4 — so a hitch can't drop a frame, the same timeline exports
  the same clip on the same device, and a background tab keeps exporting.
  Render keyframes PARK the virtual clock while their render converges (no
  convergence footage), then dwell the authored hold on the converged still,
  so the clip comes out exactly the authored length. The button
  turns into the progress readout and the cancel affordance ("⏳ Exporting
  42%") — cancelling (or resizing the window mid-run) still saves the
  partial clip. Without WebCodecs H.264 — or when a manual ● Record video is
  already rolling, which the export adopts — the clip records LIVE off the
  canvas instead: content still seed-deterministic, but frame timing is
  realtime and render keyframes honestly record however long convergence
  took. Either way clips cap at 2:00, and a toast warns up front when the
  authored total exceeds that. **⬇ Back up timeline** downloads
  the whole thing — keyframes, timings, mode tags, and the playback seed, so
  a restored timeline replays (and exports) the very same morphs — as one
  JSON file; restore it with **Share**'s **⬆ Import file** (or drop it onto
  the page), which REPLACES the authored timeline, with an Undo toast when
  there was one.
- **Points** — log-scaled slider for the point count (1k–5M); takes effect on
  **Regenerate Points** (or immediately on other edits when auto-update is on).
- **▶ Watch it build** — replays how the chaos game drew the cloud
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
  cancelled.
  Reduced motion keeps that extra spin off. Opening the control panel
  mid-replay cancels the replay too, restoring everything immediately.
- **Morph Detail** — how many points the cloud keeps while a system
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
- **Color** (shared Scene / Look section) — remains in the same accordion slot,
  with the same open state, while you switch among Points, Flame, Solid, and
  Surface. A flat system shows **Color Mode**; a non-flat system replaces it
  with **4D Color**. See [architecture.md](architecture.md#color-modes).
  The visible scope note summarizes when an edit is live, re-accumulates, or
  merely prepares authored state for its next consumer. The exact contract is:

  | Active renderer | Flat system                                                                                                                                                            | Non-flat system                                                                                                                                                        |
  | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Points          | **Color Mode**, applicable Ramp/Contrast, and Position Axis Colors update the cached cloud live.                                                                       | **4D Color** and its Radius ramp update the cached projection live.                                                                                                    |
  | Flame           | Flat Flame's Classic look is per-transform, so shared Color edits prepare a later applicable view.                                                                     | With Flame's Classic palette, **4D Color** and its Radius ramp restart only accumulation; another primary palette keeps the edit staged for a later return to Classic. |
  | Solid           | With Solid's Classic palette, the applicable Color Mode, ramp/contrast, and Position Axis Colors restart only voxel accumulation; another primary palette stages them. | With Solid's Classic palette, **4D Color** and its radius ramp restart only voxel accumulation; another primary palette stages them.                                   |
  | Surface         | **Height** and **Radius** sources consume Color ramp palette and Color Contrast live; other sources leave shared Color authored for another consumer.                  | The same: **Height** and **Radius** consume Color ramp palette and Color Contrast live, independent of the 4D Color selection; other sources do not.                   |

  Worker color restarts retain the current geometry, bounds, projection, and
  view; they are not a regenerate or a full render-session re-entry.

- **Color ramp palette** — appears while **Color Mode** is **By Height** or
  **By Radius**, the two modes that _are_ a 1-D ramp — and, in the 4D
  projection, while **4D Color** is **By 4D Radius** — naming the
  gradient those ramps sample. During an active Surface whose color source is
  **Height** or **Radius**, the row remains visible in either dimension even
  when the Points/4D color selection would ordinarily hide it. **Classic**
  (the default) keeps the
  original hand-tuned formulas (height's blue→green→red, radius's warm→cool);
  the seven named gradients — **Spectrum**, **Sunset**, **Dusk**, **Lagoon**,
  **Ember**, **Aurora**, **Moss** — swap in a cosine gradient read at the same
  **Color Contrast**-mapped coordinate, and **Custom** selects your own
  (below). Every applicable consumer in the matrix above resolves this one
  selection, so their ramps cannot drift apart. Switching gradients recolors
  Points or Surface live; an active Classic 4D Flame or applicable Classic Solid
  re-accumulates over its retained geometry.
  Persists in the link and scene file, and the row simply hides again under a
  color mode with no ramp (By Transform, By Position, Uniform Cyan), holding
  your choice for the next time one is active.
- **Custom** — the gradient editor, which opens under whichever
  palette select you set to **Custom**: a preview strip of the gradient, one
  color swatch per stop, and **+ Stop** / **− Stop**. Stops sit evenly across
  the ramp and blend linearly between neighbors; there may be 2 to 8 of them
  and the buttons disable at those bounds. **+ Stop** appends a copy of the
  last color, so the gradient doesn't jump until you recolor the new swatch.
  A scene has exactly ONE shared primary custom gradient, and all five selects
  offering it edit that same one: **Color ramp palette** here, **Flame palette
  (restarts render)** in Flame's **Tone** section, **Solid palette (restarts
  render)** in Solid's **Surface** section, **Surface palette** in Surface's
  **Color** section, and **Backdrop flame palette** for the generated Flame
  background in **Atmosphere**. The effect follows the active
  consumer matrix above: the same shared Custom edit may be live, staged, or
  re-accumulating rather than acquiring a different cost from the editor copy
  used to make it. Each editor says this directly:
  every non-Balloon palette set to Custom uses those stops. Balloon's Custom
  gradient is explicitly Balloon-only and never changes this shared primary
  gradient. A look authored in one render is therefore one select away in the
  others. The first
  select to reach **Custom** seeds the gradient by sampling the palette it just
  replaced, so Custom always opens as a tweakable copy of what was on screen
  rather than a blank ramp; it then survives switching back to a named palette,
  and persists in the link and scene file, so an authored gradient is never
  lost. Four of those selects also keep a **Classic** option that opts out of
  gradients altogether: **Color ramp palette** uses the original hand-tuned
  ramp, **Flame palette (restarts render)** and **Backdrop flame palette** use
  a flat per-map hue, and **Solid palette (restarts render)** uses the
  explorer's own **Color Mode** colors. **Surface palette** has no Classic
  option — it only appears for the color sources that need a gradient, and its
  **By Transform** source is a sibling choice in **Color source** above it.
- **Axis Colors** — appears only while **Color Mode** is **By
  Position**: three pickers naming the color each axis contributes, blended by
  the point's normalized X/Y/Z (so a point near the far X corner reads mostly
  as the X color, one in the middle as the mix). **Reset** restores the classic
  X→red, Y→green, Z→blue mapping, which is also the default. A dark-gray floor
  keeps the near corner of the bounds from fading to black, and colors sharing
  a channel deliberately wash toward their sum near the far corner rather than
  being renormalized. The live cloud, the panel legend's swatches, and the
  Solid render all read the same three colors. Points updates live; an active
  flat Solid using its Classic palette re-accumulates, while every other active
  renderer simply preserves the edit for the next applicable view. The colors
  travel in the link and scene file.
- **Color Contrast** — visible for the Height/Radius/Position color modes; a
  log-scale gamma on the normalized coordinate. Left (<1) spreads detail in
  the dense low end, right (>1) in the high end, center = linear. It also stays
  visible for an active Surface Height/Radius source in either dimension and
  updates that tracer's LUT live.
- **Depth Style** — in Points' **Depth** section, how the cloud conveys depth:
  Depth Fade (default), Aerial
  Haze, Glow + Bloom, Depth of Field, or Eye-Dome Lighting. The backdrop color
  itself is a separate choice — see **Background**, below; Aerial Haze only
  picks the fog treatment now.
- **Glow Brightness** — appears only while **Depth Style** is **Glow +
  Bloom**: a 0.1×–3× manual multiplier on top of that style's automatic
  exposure, which already dims dense clouds and lifts sparse ones so additive
  points don't blow out to white. Reach for it when the automatic choice reads
  too hot or too dim for a particular scene — 1.00× (the default) leaves the
  automatic exposure alone. Applies live, with no regenerate, and persists in
  the link and scene file.
- **Balloon** (shared Scene / Look section) — one canonical editor remains in
  the same accordion position across Points, Flame, Solid, Surface, and 3D/4D
  changes. **Balloon palette** can be selected — including editing its one
  Custom stop list — before the echo is turned on; **Balloon size**,
  **Inflate**, and **Tint** appear only once it is on. Active Points and Solid
  changes are live. Flame on/off and active edits restart/re-accumulate because
  the echo color is baked into its histogram. Surface on/off and active palette
  changes re-enter the render, while size and tint remain live. Dormant palette
  authoring changes only the document. Escape-time/Mandelbulb Surface
  sessions and a Solid whose centre-density probe fails keep authored values
  but disable the editor beside an accessible reason until an eligible session
  returns.

  **Balloon echo** is a second copy of the point cloud,
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
  size are scene content: they persist in the link and scene file. The
  ◆ Solid render samples its one density texture at both the ordinary and
  inverted query, while the ◈ Surface render traces the same balloon as real
  geometry with the fractal's shadows on the cave wall (see their sections
  above — one balloon across every renderer). Echo points fade out as the
  inversion throws them far away — the same horizon the Solid and Surface
  marches cap at, so the renderers agree on where the balloon ends — and the whole thing is a
  re-projection of the cloud already on screen, applied live with no
  regenerate. In a 4D view, each source point takes the same rotor,
  w-ramp and soft-slice path as the main cloud, then its displayed 3D
  projection is inverted. This project-then-invert order makes the cave an
  echo of exactly what is on screen; the full rotation-invariant 4D enclosing
  ball keeps its normalized size stable while the view tumbles. The 4D
  ◆ Solid and ◈ Surface renders follow the matching rule one mode over:
  slice first, then invert the marched 3D query. Solid freezes that slice in
  its voxel grid, but keeps the inversion ball at the 4D origin with the full
  pre-slice cloud radius, so scrubbing the slice never resizes the shell.

- **Background** — the two-stop gradient every render shows behind
  the attractor: **Dark** (the original ground, and the default), **Haze**
  (the cooler, lighter atmosphere Aerial Haze used to force before this
  control existed), **Auto**, which derives a darkened gradient
  from the active render's own palette — the flame/solid/surface palette
  while that render is showing, the color-ramp palette in the Points
  explorer — so the backdrop always harmonizes with the fractal and follows
  palette edits, gradient-editor drags, and render-mode switches live
  (palettes with no gradient, like Classic, keep the Dark ground; the
  derived stops are clamped dark enough that the attractor keeps contrast),
  **Flame**, a dark, defocused one-million-sample flame of the same system
  projected through the current view, with its own **Backdrop flame palette**
  (Spectrum by default, or any preset/Custom gradient),
  or **Custom**, which reveals **Top**/**Bottom** color pickers for an
  authored gradient (landing on Custom from Auto seeds the pickers with the
  derived stops you were just looking at). While auto-orbit or 4D tumble is
  running, the Flame image follows at a bounded cadence: each off-thread
  render must finish, then rests briefly before snapshotting the latest pose,
  so continuous motion cannot starve the worker's debounce or turn it into a
  per-frame job. One backdrop for the whole app —
  Points, Flame, Solid, and Surface all show it, and Save PNG / video
  captures render exactly what's on screen. Depth Fade and Aerial Haze's fog
  also tints toward it, so switching the backdrop re-tints the fog to match
  (the **Fog** and **Tint** controls below set how thick that atmosphere is
  and shift what it fades toward).
  Persists in the link and scene file — Auto persists as the choice, not as
  baked colors, and Flame persists its own palette but not generated image
  bytes, so a shared link keeps tracking its scene and view; a link saved
  before this control existed still renders exactly as it always did — Haze
  if its Depth Style was Aerial, Dark otherwise.
- **Shape** — the backdrop's gradient shape, orthogonal to
  **Background** above: **Vertical** (the default — the original top-to-
  bottom ramp) or **Radial**, a soft vignette centered behind the
  attractor, darkened corners fading toward a lighter glow at the middle.
  Every gradient **Background** choice — Dark, Haze, Auto, or Custom — can be
  either shape, since on all four the derived/authored top stop is the darker one
  and the bottom stop the lighter one, which is exactly what a vignette
  needs; nothing about **Background** itself changes when you switch
  shapes. Reaches the same renders **Background** does (Points, Flame,
  Solid, Surface, and every capture), stays circular as the window resizes
  or an export scales up, and persists in the link and scene file — absent
  (every link saved before this control existed) means Vertical.
- **Fog** — the depth fog's density, 0×–2.50×: how much atmosphere
  sits between you and the shape. 1.00× (the default) is exactly the fixed
  fog the app always had — links and scene files saved before the control
  existed render unchanged — and the slider scales the fog's distance unit
  around that: higher packs the fog tighter around the camera into a thicker
  haze, lower stretches it thin, and 0 turns the renderers' depth fog off
  outright. The Points Balloon's separate safety fade never disappears: it
  stops stretching below 0.15× because it also bounds the sphere inversion's
  otherwise infinite far field. One
  slider reaches every render with depth to convey — the explorer's
  fog-bearing depth styles (Depth Fade and Aerial Haze), the ◆ Solid render
  (which grew true depth fog with this control, so solids read a touch
  hazier than they once did), every ◈ Surface tracer (the 4D slice
  included), and the balloon echo's fade horizon above. The ✺ Flame render
  is a 2D exposure with no depth to fog, and the 4D projection's **Depth
  fade** option is a brightness fade rather than fog, so those main render
  paths stay untouched. When Balloon is on in Points, **Fog** remains live
  for that echo's horizon even under a non-fog depth style or a 4D projection;
  the adjacent scope note makes that partial effect explicit. There is
  deliberately no separate falloff slider: the point
  cloud's fog is a linear near/far band while the solid and surface fogs
  are exponential in the shape's own scale, so no single falloff number
  could mean the same thing across them — density alone covers the useful
  thin-to-thick range. The authored slider stays visible in every renderer:
  it applies live for the consumers above, and otherwise disables beside a
  reason while retaining its saved value. It never restarts a renderer and
  persists in the link and scene file.
- **Tint** — the color half of the atmosphere pair: what the fog
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
  projection's Depth fade dim points rather than blend them). It therefore
  disables even when Balloon alone keeps **Fog** density live, with the same
  adjacent scope note explaining the difference. Like density, it remains
  visible with its saved value in a non-consuming renderer and is live and
  persisted where consumed. A different knob from ◈ Surface's
  **Environment** slider above in both axis and target: **Tint**
  retargets what depth _fog_ blends toward, by distance; **Environment**
  tints the _light_ itself, by shading normal — the two compose
  additively, so both pushed hard together is worth a by-eye check.
- **Auto-update on change** — regenerate the cloud on every edit vs. on demand.
- **Capture size** — in the **Capture** section, the resolution **Save PNG**
  renders at, as a multiple of the screen: **1× (screen)**, **2×**, or **4×
  (print)**. It is a real re-render at that size, not an upscale — the Solid
  and Surface renders re-trace, and changing it while a Flame is up restarts
  that render so it accumulates at the new size and its grain matches the
  output — and a **Save PNG** pressed right after that restart waits for
  the fresh accumulation rather than capturing the explorer.
  Large sizes get clamped: the long side never exceeds 8192px, the
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
  captures whatever depth style and color mode are active. The PNG is
  always the finished render of whatever mode you're in, never a
  stand-in caught from the explorer mid-startup. In the ✺ Flame render
  that means it waits for the accumulation to finish converging,
  disclosing progress and a **Cancel** in its own modal — a flame that
  has already converged still saves instantly, with no modal ever
  showing. **Cancel** abandons the export and saves nothing; the
  accumulation itself carries on, so pressing **Save PNG** again later
  picks up where the render has got to.
- **● Record video** — records the canvas as you drive it: orbit, drag sliders,
  run a Drift or a timeline, and press the button again to finish. While
  rolling it becomes **■ Stop** with the elapsed time, and it stops itself at
  the 2:00 cap. The clip downloads as MP4 where the browser can encode it and
  WebM otherwise, with its duration metadata patched in so players scrub it
  properly. For an authored clip that is frame-exact rather than realtime, use
  **Timeline → ⏺ Export clip** instead.
- **⤓ Save scene file** — download the current scene as a small JSON
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
- **Symmetry** — kaleidoscope replication of the whole attractor:
  **Order** draws every chaos-game point up to 12 times (1 = off), the
  copies rotated evenly in the chosen **Plane** — any of the six coordinate
  planes. XY / XZ / YZ turn in ordinary 3-space; picking XW / YW /
  ZW turns the copies through the fourth axis, which by itself makes the
  system 4D and hands the view to **4D View**'s tumbling projection.
  **Twist** adds the second angle of a 4D double rotation: copy `k` also
  turns `k · twist` sectors in the plane's orthogonal complement, so 0 is a
  simple rotation, any nonzero value is 4D the same way a w-plane is, and 1
  and order−1 are the left/right isoclinic cases. Only `order` distinct
  twists exist, so the value caps itself at order−1 — as you drag, and
  equally when a shared link carries a larger number (the link decoder
  applies the same cap the order itself gets). If
  order × transform count would exceed the 256-transform budget, the persistent
  document status above the accordion names the reduced order that actually
  renders in every mode. The
  whole setting persists in the link, and every render mode — Points,
  Flame, Solid, Surface — renders the same kaleidoscope. The one **Symmetry**
  editor remains reachable while any of those four renderers is inspected.
  In Points, an edit regenerates immediately when **Auto-update on change** is
  on (otherwise use **Regenerate Points**). An active Flame or Solid render
  restarts its accumulation immediately for an edit that stays in the same
  dimension. If an edit switches the system between 3D and 4D, return to
  Points, regenerate, then re-enter the renderer so its fixed dimensional
  snapshot can change. In Surface, the edit applies on the next entry, while
  the Surface button and its adjacent eligibility explanation update
  immediately if the new order, plane, or twist changes what the tracer can
  render.
- **Hybrid schedule** — builds a finite arrangement of one attractor from a
  second transform list: choose a preset or saved scene under **System B**,
  or press **Use current system as B**, then set **Depth** from 1 to 5. Each
  plotted point from the current system A is passed through that many
  independently selected B maps and only then through the final-transform
  lens. B is stored affine-only — position, rotation, scale, shear and
  selection weight; its variations, 4D block, chaos rows and material/color
  fields are deliberately stripped. Depth 0 or **None** removes the entire
  block and restores the classic path without extra random draws. The block
  persists in scene files and shared links; because it stores a snapshot of
  B rather than a live source reference, a reloaded picker says **System B
  (N maps)** instead of claiming it still follows the preset or saved scene
  it came from. The document status above the accordion describes the active
  post-word and remains readable while any renderer is being inspected.

  Points, Flame and Solid apply the finite post-word directly. Surface
  renders the same object by reversing it: the first `k` global descent
  levels use only B's affine inverse maps with symmetry disabled, then the
  ordinary A inverse maps and A's authored symmetry take over. The final
  lens remains outside those levels. Surface accepts an expanding B map — B
  is finite, so it has no contraction requirement — but still requires every
  B map that selection can reach to be invertible (and flat for the 3D
  tracer). A weighted B ignores zero-probability maps; the all-zero-weight
  fallback is the point engine's uniform path and therefore includes every
  B map. An inverse-analysis refusal is terminal for a scheduled Surface
  document: it never falls through to an A-only escape renderer and silently
  drops the composition.

  The one editor stays available in every renderer. Source/snapshot choices
  settle as one edit; Depth updates the document and Points cache while it is
  dragged, then settles once on release. Flat, Balloon-off Flame and Solid
  restart with their active seed. A 4D or Balloon accumulation stages the
  schedule for next entry because its bounds come from Points. Surface
  re-enters with the inspection camera preserved, or exits to Points with the
  analyzer's refusal.

  **Sponge of Ferns** is the shipped showcase: A is Barnsley's fern and B is
  a spread Menger sponge at depth 2. Barnsley's canonical stem has exactly
  zero x scale and cannot be inverted, so this composition alone widens that
  stem to `0.001`; the standalone Barnsley preset remains exact. The widened
  stem is still about 160:1 anisotropic, so Surface reports the showcase as
  degraded and marches at its conservative step-scale floor; point modes do
  not need that approximation for the standalone fern.

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
  colored per the **4D Color** select, spelled out right in the
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
  24-cell edges) through the same rotation. The group is keyed to where its
  systems _live_ — outside the `w = 0` hyperplane — rather than to how they
  render, so it is not an IFS-attractor group by definition: a 4D
  escape-time chain, which ◈ Surface marches as the **W slice** of an
  escape-time set rather than as an attractor (see **◈ Surface** above),
  belongs to it just as much. Or turn any flat system non-flat
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
  session keeps the same slider live but positions a hard,
  zero-thickness cross-section instead — the tracer marches exactly that w,
  with no ghost context and no soft window around it. The slider lands on
  the same physical hyperplane in both views, normalized to
  the cloud's rotated-w support at the current rotation rather than a raw
  world-w value. **Slice thickness** (Surface sessions only) gives
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
  you widen it. Some sessions refuse the slab outright, and there the slider
  stays visible but sits disabled at 0 rather than showing a thickness the
  tracer would ignore: a
  `spherefold` or `mandelbox` branch bends a segment into an arc, so the
  thickened query would no longer be a safe bound (box-fold-only systems keep
  it), and a 4D escape-time chain (see **◈ Surface**) has no branches to
  enumerate at all, so its forward orbit cannot thread a segment in the first
  place. **Slice-relative color** (shown while the slice is on
  and a W-Depth palette is active) recenters the diverging ramp on the slice
  window: inside the slice everything sits near one w, so the faithful
  whole-cloud ramp renders a slice at 0 almost entirely in the palette's
  dim-gray notch — this option spreads the full palette across the visible
  cross-section instead (±2 slice-widths; ghost context beyond that clamps
  to the side colors), changing color only, never the slice's opacity
  window, and carries into the flame/solid renders of that view. **Depth
  fade (dim far points)** attenuates each
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
  (their own 4D accumulators for Flame and Solid, their own 4D tracer for
  Surface; the Surface button still gates on distance-estimator eligibility
  exactly as it does for a flat system, see **◈ Surface** above). Flame and
  Solid _freeze_ the spatial view they start from — one snapshot of the rotor
  and slice window held for the render's whole life — so the tumble parks and
  this section's spatial sliders hide until you return to Points. Shared
  **Color** remains shown: an applicable edit under the worker's Classic palette
  re-accumulates over that retained view, while another primary palette stages
  it. Surface instead keeps the rotor and W slice live per
  frame, so the Shift-drag / Shift-wheel gestures above still steer it and
  the **W slice** position slider stays live and shown unconditionally,
  since the tracer marches a cross-section every frame regardless of any
  toggle — joined there by **Slice thickness**, which is that tracer's
  control alone and appears nowhere else. Ambient auto-tumble is deliberately
  parked: continuous motion would invalidate every frame, hold the progressive
  renderer in preview, and prevent it from settling. Its **Auto-tumble
  (XY+ZW)** and **Tumble speed** rows hide while Surface is open, with an
  in-panel note explaining why; the user's auto-tumble choice is left intact
  and takes effect again on return to Points.
  The **W slice** on/off checkbox hides
  anyway — there's no off state left for it to mean — and so does
  **Slice-relative color**, since the tracer has no w-ramp palette for it to
  remap. What does drop out of the panel is the flat-only look controls:
  **Color Mode** and **Depth Style** are superseded in their **Color** and
  **Depth** sections by **4D
  Color** and **Depth fade** above. **Color Contrast** ordinarily goes with the
  flat selection, but remains visible when an active 4D Surface uses its
  **Height** or **Radius** source, whose live LUT still consumes it.
  **Symmetry** stays put: the 4D chaos game runs its own
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
- **Take scenes off this device with files**. ⤓ Save scene file
  exports the current scene as JSON; ⬇ Back up collection backs up the whole
  gallery; ⬇ Back up timeline backs up the authored animation
  timeline, playback seed included. ⬆ Import file (or dropping a file onto
  the page) loads a scene file, merges a collection backup, or restores a
  timeline — all the localStorage stores above are trapped in one browser
  profile, and these files are how a library survives clearing site data or
  moving devices.

Camera angle, selection, and panel state are intentionally left out — a shared
link is about the _system_, not where you happened to be looking. See
`src/app/persist.ts` (the codec rejects malformed links rather than throwing).
