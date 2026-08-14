# Architecture

Fractal Explorer renders an **Iterated Function System (IFS)** with the _chaos game_
and draws the result as a Three.js point cloud. The code splits cleanly into a
pure, dependency-free core (`src/fractal/`) and a rendering/UI layer (`src/app/`).

## The chaos game

An IFS is a small set of contractive affine maps `f₁, … , fₙ`. Its **attractor**
is the unique set `A` satisfying `A = ⋃ᵢ fᵢ(A)`. The chaos game approximates `A`
cheaply:

1. Start from an arbitrary point `p`.
2. Pick a map `fᵢ` at random and set `p ← fᵢ(p)`.
3. Plot `p` and repeat.

After a short **warm-up** (the first 100 iterations are discarded so the orbit
settles onto the attractor), every subsequent point lands on — or vanishingly
close to — `A`. With four corner-contraction maps you get a Sierpinski
tetrahedron; with the 20 edge maps of a subdivided cube you get a Menger sponge.

`runChaosGame(transforms, numPoints, rng, finalTransform?)` in
`src/fractal/chaos-game.ts` implements exactly this. It:

- composes each transform once into an `Affine` (see below),
- iterates, writing interleaved `xyz` into a `Float32Array`,
- records which transform produced each point (`Uint8Array`, hence the 256-map
  cap, `MAX_TRANSFORMS`),
- **reseeds** the point to a fresh random spot if a coordinate escapes past ±50
  (guards against non-contractive user edits diverging to infinity),
- tracks the cloud's bounding box and radial extent for normalized coloring.

The RNG is injected, so passing a seeded `mulberry32` (from `rng.ts`) makes a run
fully reproducible — which is what the tests rely on.

## Affine transforms

Each `Transform` is a position, an Euler rotation (radians, **XYZ order**), and a
per-axis scale — the same representation Three.js uses for an `Object3D`.
`composeAffine` turns it into `M = T · R · S`, stored as a row-major 3×3 linear
part plus a translation, and `applyAffine` computes `M · p`:

```
applyAffine(t, p) = position + R · (scale ⊙ p)
```

`rotationMatrixXYZ` reproduces `THREE.Matrix4.makeRotationFromEuler` for
`order = "XYZ"` element-for-element, so the math here matches what the guide boxes
do on the GPU and the fractal looks identical to the original standalone version.
`affine.test.ts` pins this down with identity, single-axis 90° rotations, scale,
translation, and a composed case against hand-computed values.

## Nonlinear variations

Strict affine maps only ever produce self-similar, straight-edged attractors.
**Variations** are nonlinear functions applied to a transform's point _after_
its affine part, warping space into flowing, organic, "impossible" shapes.
`variations.ts` holds seventeen as pure `(x, y, z, rng) → [x, y, z]` functions: a
dozen classics borrowed from Draves & Reckase's _fractal flame_ algorithm
(`spherical`, `swirl`, `bubble`, `julia`, …), plus a third family — the
Mandelbox folds — covered below.

A transform carries an optional `variations: { type, weight }[]`. Its post-affine
point is the **weighted blend** `Σ weight · V(type)` — flame semantics, so the
weights are free strengths, not a normalized mix. `composeVariations` compiles a
list into one blend function, returning `null` when there is nothing to apply
(no list, or every weight zero). That `null` is the fast path: every existing
preset has no variations, so `runChaosGame` takes the identical affine-only code
path and consumes the RNG exactly as before — old scenes render byte-for-byte
unchanged.

The classic variations are planar; each is generalized to 3-D consistently
(radial warps use the full `x²+y²+z²`, angular warps act in the xy-plane and
carry `z`). Nonlinear maps can diverge or hit a singularity, so every function is
kept total with a small `EPS` floor on its divisors, and the chaos game's escape
check also reseeds on any **non-finite** coordinate — one bad landing can never
poison the rest of the orbit with `NaN`. `variations.test.ts` covers the math and
the totality guarantee; `chaos-game.test.ts` covers finiteness, seed-determinism
(including the stochastic `julia`), and that a variation actually moves points.

A third family, the **Mandelbox folds** (`boxfold`/`spherefold`/`mandelbox`,
fr-p7nu), is natively 3-D rather than a lift of a planar formula: `boxfold`
reflects each axis back off the `|t| = 1` planes (`2·clamp(t, −1, 1) − t`,
continuous at the fold), `spherefold` is the classic Mandelbox ball fold —
scaling by `1/clamp(r², 0.25, 1)`, the clamp floor doing double duty as the
totality guard — and `mandelbox` composes the two as `sphereFold(boxFold(p))`,
its own variation because blending is a weighted **sum**: no combination of
`boxfold` and `spherefold` weights can express a composition. The variation's
`weight` plays the classic Mandelbox scale `s` (`s·sphereFold(boxFold(p))`;
weight 2 reproduces the canonical step).

The `radiolarian` and `swirl` presets showcase the feature (`mandelbox` showcases
the fold family); the transform editor's **Variations** group adds/removes/weights
them live. A map whose variation list is exactly one fold-family entry is also the
one nonlinear case the surface distance estimator can descend — see **The surface
distance estimator** below (fr-5rvk).

One variation renders a wholly different fractal on its own, unblended: `julia`
on a single transform translated by `−c` performs exact Inverse Iteration for the
classic 2-D Julia set of `z² + c` (fr-7u8t.1) — a fractal with no self-similar
IFS structure of its own, found "for free" in the existing variation vocabulary
rather than designed in. The `julia`/`juliaDust` presets showcase it, one a
genuinely connected curve (Douady's rabbit) and one an unambiguous Cantor
dust; see `docs/julia-sets.md` for the recipe, why two presets, and the
harmonic-measure coverage bias IIM inherits.

## Final transform

A **final transform** (the fractal-flame _final xform_) is one more affine +
variation map — a `Transform` like any other — applied to every point _as it is
plotted_, never fed back into the orbit. It acts as a lens over the whole cloud:
the same `spherical` inversion that turns a triangular gasket into interlocking
bubbles can bend an entire attractor at once.

`runChaosGame` takes it as an optional fourth argument, composed once into its own
`Affine` + variation blend. In the recording loop it maps the orbit point to the
_plotted_ point while the orbit state `x/y/z` is left untouched — so the lens
changes only what is drawn (and the bounding box tracked over it), not the
iteration. Omitted (or `null`), the loop takes the exact same path and consumes
the RNG identically, so lens-free scenes stay byte-for-byte unchanged. Because a
nonlinear lens can still diverge, a non-finite result falls back to the un-bent
point rather than writing `NaN`/`Inf` into the buffer.

Being a global effect, the lens lives in `AppState.finalTransform` (not the
transform array) and persists across preset loads like `colorMode` /
`renderStyle`. The panel's **Final-transform lens** toggle enables a default (identity,
no-op) lens and reveals it as a `"final"` row in the edit list; selecting it opens
the ordinary transform editor, minus the selection **Weight** (meaningless for a
map applied to every point). `chaos-game.test.ts` pins the plot-time-only
semantics — a pure-affine lens leaves the transform indices identical and each
plotted point is the orbit point run through it — plus finiteness at a singularity
and seed-determinism with a stochastic lens.

## Color modes

`buildColors(result, transforms, mode)` in `color.ts` produces a parallel
`Float32Array` of per-point RGB. The five modes:

| Mode        | Mapping                                             |
| ----------- | --------------------------------------------------- |
| `transform` | one hue per map (evenly spaced)                     |
| `height`    | y normalized → blue → green → red                   |
| `radius`    | distance from origin → warm (inner) to cool (outer) |
| `position`  | normalized xyz → rgb (axis colors pickable, fr-8k7) |
| `uniform`   | constant cyan `(0.4, 0.8, 1.0)`                     |

`hslToRgb` matches `THREE.Color.setHSL`'s algorithm. The renderer runs with
**color management disabled** (`THREE.ColorManagement.enabled = false` in
`scene.ts`), so these authored sRGB values are sent to the GPU verbatim instead of
being round-tripped through linear space — a predictable, testable pipeline.

The `height`/`radius`/`position` modes additionally take a **color contrast**
exponent (fr-8sk, `colorModeUsesGamma`): each mode's normalized coordinate `t`
is reshaped to `t ** colorGamma` before mapping to a color (1 = linear, today's
mapping; below 1 spreads out the low end of the range, above 1 the high end).
The solid render's voxel LUT (`buildColorModeLUT` in `voxel.ts`) is built with
the exact same gamma, so a converged solid's colors and the live explorer's
point colors can never drift apart.

The `height`/`radius` ramps' colors themselves are also swappable (fr-3b6,
`colorModeUsesRampPalette`): a scene-level **ramp palette** selection
(`AppState.rampPaletteId` — a `palette.ts` preset, the user's custom gradient,
or the default `"legacy"` built-in ramps) makes both ramps sample the chosen
gradient at the same gamma-mapped coordinate instead of the built-in HSL
formulas. One definition again: `writePaletteRampColor` in `color.ts` is
shared by `buildColors`' branches and `buildColorModeLUT`, so the explorer's
points, the solid render's colorMode-driven voxels, and the panel legend all
recolor together. Since fr-6ue the 4D projection's "By 4D Radius" mode follows
the same selection.

The `position` mode is not a 1-D ramp (a 256×3 LUT indexes one coordinate;
position has three), so instead of the ramp palette it takes three
user-pickable **axis colors** (fr-8k7, `AppState.positionAxisColors`): each
channel becomes `min(1, 0.2 + 0.8 · (tx·A + ty·B + tz·C))` over the
gamma-mapped normalized coordinates — a dark-gray base plus the
coordinate-weighted blend, so no corner of the bounds fades to black. The
default (field absent) is the legacy identity `A,B,C = red, green, blue`,
which reduces the blend to the original `t·0.8 + 0.2` per channel exactly.
Axis colors that share channels can clip toward their sum near the far corner
of the bounds — deliberate: a directional normalization was rejected because
it collapses the diagonal brightness dimension (see fr-8k7's notes). One
definition again: `writePositionColor` in `color.ts` is shared by
`buildColors`' position branch and the solid render's `accumulateVoxels`, and
the panel legend shows the live axis colors as X/Y/Z swatches.

## Data flow

```
                 ┌──────────────── src/fractal (pure) ────────────────┐
 presets.ts ──▶ transforms ──▶ runChaosGame ──▶ result ──▶ buildColors ──▶ colors
                 └───────────────────┬───────────────────────┬─────────┘
                                     │ positions             │ colors
                                     ▼                        ▼
 main.ts  ──────────────────▶  scene.setPoints(positions, colors)  ──▶  WebGL
   ▲   │                              ▲
   │   │ state (reducers)             │ applyCamera(orbit) each frame
   │   ▼                              │
  ui.ts ◀── handlers ──┐         interactions.ts ──▶ orbit / guide-box edits
   (panel + list)      └───────────── user input ──────────────┘
```

The boxed `src/fractal` segment above — `runChaosGame` through
`buildColors` — executes inside `cloud-worker.ts` (`cloud-worker-core.ts`'s
`generateCloud`), reached by `cloud-generator.ts` posting a request from the
main thread, not inline where this diagram might suggest. The worker
transfers `positions`/`colors` (and, on the 4D path, `w`) back as zero-copy
buffers; it's `main.ts`'s arrival handler, `applyCloudResult`, that actually
calls `scene.setPoints`, not `regenerate()` itself. The one exception is the
very first generation at boot, which runs `generateCloud` synchronously
(`generateSync`) so first paint isn't a worker round-trip behind. See "Render
workers & cross-origin isolation" below for the cloud worker's transport and
fallback design.

`main.ts` holds the single `AppState`, mutates it only through the pure reducers
in `state.ts`, and after each change calls the relevant refreshers
(`regenerate` → re-run the chaos game; `refreshGuides` → rebuild the wireframe
boxes; `refreshUi` → update labels and the transform list). The animation loop
applies the orbit camera, retightens the fog, and renders.

## The 4D extension

Every `Transform` can carry an optional `w?: WExtension` block (`fractal/types.ts`):
a `w` position, an independent `w` scale, and the three rotation/shear planes that
mix `w` into the other three coordinates (`xw`, `yw`, `zw`). A block that's absent,
or present with every field absent or exactly `0`, means the map lives flat in the
`w = 0` slice — the same absent-means-identity convention `weight`/`shear`/
`variations` already use. `w.scale` defaults to DERIVED rather than `1`: left
unset, it's recomputed at lift time as the map's mean spatial contraction
`(|sx|+|sy|+|sz|)/3`, so it keeps tracking later scale edits instead of freezing a
value that was only ever true once. `affine4.ts`'s `isFlatTransform`/`systemIsFlat`
turn this into a predicate over a whole system, and `state.ts`'s `systemIsNonFlat`
extends it to the final transform (per its own enabled semantics) — together this
is the entire definition of "4D": a property DERIVED from `state.transforms` /
`state.finalTransform`, not a stored mode.

`toTransform4` lifts a `Transform` into a `Transform4` — 4 position + 4 scale + up
to 6 rotation planes + 6 shear planes + variations + weight, the full
20-dimensional affine group of ℝ⁴ one dimension up from `Transform`'s 12 — by
starting from `embedTransform3`'s `w = 0` embedding (built across the earlier
fr-2ou/fr-hy8 spikes, untouched by the unification) and splicing in whatever `w`
overrides the transform carries. The embed rewrites `composeAffine`'s Euler-XYZ
rotation as three of `Transform4`'s six plane angles (`{ yz: rx, xz: −ry, xy: rz }`
— the sign flip on `xz` corrects for `RY`'s opposite handedness from the `R_xz`
plane convention), agreeing with `rotationMatrixXYZ` to within floating-point
rounding (tests pin it at 1e-12) while keeping the embedding's `w` row/column
exactly `[0,0,0,1]`, and carries shear/variations across unchanged — so a lifted
3D system's `w = 0` slice renders as its source 3D fractal. The splice itself is
sparse: a transform with no `w` block returns exactly `embedTransform3(t)`, same
shape, same absent fields, which is what lets `w.scale` keep meaning "derived"
until a user or a preset actually sets it.

`chaos-game-4d.ts`'s `runChaosGame4` is the 4D sibling of `runChaosGame`: the same
warm-up/escape/reseed/bounds shape extended to four coordinates, the same
per-transform nonlinear-variation blend, and the same optional plot-time
final-transform lens as the 3D path. Its own header explains why it's a
hand-unrolled DUPLICATE rather than an n-generic abstraction over the 3D path —
the hot loop rewards branch-predictable, register-friendly, unrolled coordinates
over a dimension-generic one — sharing only the genuinely-common constants
(`WARMUP_ITERATIONS`, `ESCAPE_LIMIT`, `MAX_TRANSFORMS`). `variations4.ts` lifts the
same seventeen variation functions `variations.ts` documents, by the identical
convention one dimension up (angular warps carry `z` AND `w` through unchanged;
radial warps and `swirl` use the full 4D radius `x²+y²+z²+w²`; the fold family
treats `w` exactly like a spatial axis, so `boxfold` reflects all four axes and
`spherefold`/`mandelbox` invert through the full 4D radius), with an anchor
property stronger than the rotation embed's: at `w = 0` every lifted function
reproduces its 3D counterpart bit-for-bit (not just to rounding), so an embedded
3D system's `w = 0` slice warps exactly like the native 3D path.

`main.ts`'s `regenerate()` is where the two paths fork — though since fr-5kx it
only decides which path to REQUEST, not run it. It computes
`systemIsNonFlat(state)` once per generation and stamps the result onto the
request's `fourD` field (`cloudParams`), then hands the request to
`cloudGenerator` (`cloud-generator.ts`) instead of calling the chaos game
directly. A flat request takes the untouched `runChaosGame` path inside the
worker (or synchronously on the main thread, in the boot/fallback cases),
byte-identical to before this feature existed; a non-flat one lifts every
transform (and the enabled final transform, if any) through `toTransform4` —
now done worker-side, inside `cloud-worker-core.ts`'s `generateCloud` — and
runs `runChaosGame4` instead, uploaded with `scene.setPoints4` rather than
`scene.setPoints` once the result arrives.

`viewIs4D` — the cached flatness flag the hot paths (the animation loop, the
interaction callbacks, guide-box suppression) read instead of re-deriving
`systemIsNonFlat` every frame or pointer move — is now written by the arrival
handler, `applyCloudResult`, rather than by `regenerate()` itself, so it always
matches the DISPLAYED cloud rather than the most recently requested one: during
the brief in-flight window after an edit flips flatness, the view deliberately
stays with the old cloud. The "fresh visit" resets (`resetFourDView` /
`resetAutoOrbitView`) and the camera auto-fit move with it: `regenerate`'s
`replaced`/`fit` arguments ride the request (OR-merged across a coalesce, so a
superseded preset load's intent survives into whichever request actually runs
— see `cloud-generator.ts`) and fire from `applyCloudResult` once that
request's result lands. Point color is a separate concern from generating the
cloud — see below. Rotational symmetry was once 3D-only by the same recorded
decision (fr-bf6) that kept flame and solid flat, its control hidden whenever
the system was non-flat; fr-q0h6 overturned that last holdout: `runChaosGame4`
now has a kaleidoscope stage of its own (copies rotate in any of the six
coordinate planes, optionally with a `twist` — a double rotation), a w-plane or
nonzero twist by itself makes the system 4D (`affine4.ts`'s
`symmetryIsNonFlat`), and the Symmetry controls stay put. The flame and solid
renders left the same decision earlier with their 4D variants (fr-5b3/fr-4wd),
covered under "The flame still and the solid voxel render" below.

Seeing the result is a separate concern from generating it. `scene.ts` renders a
non-flat cloud with a dedicated shader material: the vertex shader rotates each
point about the cloud's 4D center by a `uRot4` uniform, drops the rotated `w` to
project orthographically, and colors the point according to the panel's **4D
Color** select (fr-d47). Three of its five modes are diverging palettes on the
signed rotated `w` — blue/orange (the default), purple/green, or cyan/magenta,
each a `{neg, pos}` pair in `color.ts`'s `W_SIDE_PALETTES` fed to the shader as
uniforms — toward `−w`/`+w`; the other two swap in a rotation-invariant
per-point color instead, baked once per generation into a color attribute by
`color.ts`'s `buildColors4` (by producing transform, or by 4D distance from the
cloud's 4D center). Either way the signed rotated `w` — which picks the
diverging side and, in every mode, drives the dim gray notch near `w = 0` — is
normalized by the cloud's 4D bounding box's support in the rotated-w direction
(`rotor4.ts`'s `wSupport`, rotation-covariant so anisotropic clouds never wash
out toward gray), so the fourth dimension stays legible in brightness no matter
which mode is active. The projection renders with additive blending so the
several w-layers an orthographic projection folds onto the same screen pixel stay
visible and sum toward white where they overlap, instead of the nearest layer
hiding the rest. `uRot4` is driven from `rotor4.ts`, which represents the
accumulated 4D VIEW rotation as a pair of unit quaternions (`RotorPair`) — the
SO(4)-as-quaternion-pair identity `x ↦ p·x·q̄` — rather than an accumulated matrix,
so the slow auto-tumble and the Shift-drag/Shift-wheel gestures
(`interactions.ts`) can compose new deltas on top and renormalize cheaply over an
arbitrarily long session; it never touches the chaos game itself, which composes
`rotationMatrix4` once per transform at generation time instead. This view
state — the rotor pair, tumble on/off and speed, and an optional soft w-slice (a
Gaussian opacity window around a chosen `w`, so a cross-section fades in without
hard-culling the points outside it, with an opt-in slice-relative recolor that
recenters the w-ramp palettes on the slice window — `project4.ts`'s
`sliceColorRemap`, fr-nn6) — is session-only and resets to a fresh
baseline only on a flat-to-non-flat transition or a whole-system replacement,
never on an ordinary parameter edit. The 4D presets (`pentatope`,
`doubleRotation`, and the fr-zde wave — `tesseract`, `sixteenCell`,
`twentyFourCell`, `duoprism`, `hyperfern` — all in `presets.ts`; the earlier
standalone `presets4.ts` is gone, merged into the same factory record every
other preset lives in) span static polytope flakes and dynamic w-rotation
systems, and each polytope preset also carries a legibility scaffold
(`PRESET_SCAFFOLDS`) — its own wireframe edges, tumbled through the identical
rotation so the projection's motion reads as genuinely 4D at a glance.

## Scene persistence

`persist.ts` keeps the explorer share-ready. The persistent subset of `AppState`
(transforms, point count/size, color mode, color contrast, depth style, guide
visibility) is serialized to a compact `v1=<base64url>` payload and written to
both the URL hash (`history.replaceState`, so edits don't pile up in the
back-button stack) and `localStorage`, debounced so slider drags don't thrash.
On load the hash wins over storage — a pasted link beats the last local
session.

`decodeScene` is the one place that ingests untrusted input (a URL someone
pastes), so it is a strict, **never-throwing** boundary: it rejects an unknown
version, bad base64/JSON, the wrong transform shape, or an unknown color/depth
enum, and clamps numeric ranges. Storage and location are injected, so the codec
is unit-tested with no real browser.

`collection.ts` (fr-cai) layers a second, user-driven path over the same codec.
Where `persist.ts` autosaves the single current scene, `collection.ts` keeps a
multi-slot library — any number of saved `encodeScene` strings, each paired
with a small JPEG thumbnail, under its own `localStorage` key — so saving or
deleting a kept discovery never disturbs the live scene or its undo history.
Loading an entry from the collection is a whole-system replacement, the same
treatment a preset load gets, which is what makes it non-destructive: keep a
discovery, keep tweaking, and it's still there to load back.

## The flame still and the solid voxel render

Beyond the live point cloud, a converged system can be committed to one of
three on-demand renders. Two of them — the flame still and the solid voxel
render, this section's subject — accumulate their result from hundreds of
millions of chaos-game iterations; the third, the surface distance
estimator (below), needs no accumulation and completes instantly. All three
replay the identical chaos game (or, for the surface render, its analytic
equivalent) — same transforms, variations, final-transform lens, symmetry —
and present the result differently. The four renderers are one **render
mode** axis (fr-39y): a session-only `renderMode: "points" | "flame" |
"solid" | "surface"` in `AppState` (never persisted — the app always boots
into the points explorer), switched from a single segmented control at the
top of the panel, so any pair of them is a direct switch, never a round-trip
through the explorer. A preset can declare the mode it was authored to
showcase (`PRESET_RENDER_HINTS` — the "Flame" optgroup's
Radiolarian/Swirl/Dyed Spiral, and the "Escape-time" group's Mandelboxes
and Mandelbulbs),
which `main.ts` applies when the freshly loaded system's cloud lands,
snapping the camera fit first so the flame's frozen projection frames the
new attractor. Two sibling side tables ride the same lookup (fr-7u8t.1):
`PRESET_FINALS` gives a preset the final-transform LENS it was composed
around — and, absent, CLEARS whatever lens the session had, so one preset's
lens can never re-pose the next one's attractor — and `PRESET_PALETTES`
gives a flame showcase the built-in palette it was chosen with. The flame and solid renders each run in their own Web Worker
(see "Render workers" below) so their hundreds of millions of iterations
never touch the main thread; the surface render, covered in its own section
below, needs neither.

`render-session.ts` factors out what the two modes share: a `RenderSession` owns
the worker lifecycle (`enter` / `exit` / a defensive `terminate`) and a
**first-frame gate** — `main.ts`'s animation loop keeps drawing the ordinary
explorer until the worker's first frame arrives, then swaps the canvas over, so
entering a render never flashes empty. What differs stays in `main.ts`. The
flame **freezes** the view: the 3D scene stops drawing and pointer gestures are
blocked (the still belongs to one fixed camera), and once the first image lands
the canvas shows only a full-screen flame quad. The solid keeps the **live**
orbit camera every frame and raymarches a world-space volume, so its result is
still something you fly around.

**The flame still** (`flame.ts`) is the fractal-flame image proper: a 2-D
histogram, one bucket per display pixel, accumulating a **hit count** and a
**summed color** (`FlameHistogram`), then tone-mapped to an image. Its buckets
are `Float64Array`, not `Float32` — a converged bucket's summed color can climb
past 2²⁴ and silently stop growing in f32 while its hit count keeps rising,
desaturating exactly the brightest region. `tonemapFlame` sends accumulated
density through a `log1p(hits) / log1p(maxHits)` curve under four controls:
`exposure`, `gamma` (with a `gammaThreshold` below which a linear chord replaces
the power curve, so lone speckles don't blow up), and `vibrancy` (density-scaled
color vs. a flat gamma curve) — collapsing byte-for-byte to the pre-gamma
tone-map at `gamma: 1, vibrancy: 1`. Supersampled buckets are boxed down each
frame by the cheap fixed-radius `downsampleFlame`; a finished or paused render
can also run `adaptiveDownsampleFlame`, the flam3 density-estimation filter whose
per-cell blur radius widens where samples are sparse. Handing a previous
histogram back resumes the orbit exactly, so a render refines progressively
rather than restarting.

Flame color comes from `palette.ts`: Inigo-Quilez cosine gradients
(`channel(t) = a + b·cos(2π(c·t + d))`), precomputed once per render into a flat
256×3 LUT by `buildPaletteLUT`. A structural color coordinate rides the orbit —
nudged toward the chosen transform's palette slot each step, consuming no
RNG — and indexes that LUT, so orbit-adjacent points share a hue (flam3-style
structural coloring). Both ends of that nudge are per-transform (fr-hiyu,
flam3's `color`/`color_speed`): a map's optional `colorIndex` names its slot and
its optional `colorSpeed` says how far the coordinate travels toward it
(`c ← c·(1 - speed) + colorIndex·speed`). Absent, they derive to the even spread
`i / (n - 1)` and a halfway `0.5` — the fixed behaviour that predated the fields,
bit for bit — so authored color structure survives a `.flame` round trip while
every existing scene renders unchanged. The surface render's orbit-trap
palette source reads that same authored `colorIndex` (fr-c6yd); `colorSpeed`,
a per-pick quantity, stops at the flame and the solid grid — the surface has
no pick to carry it. The sentinel `"legacy"` palette opts out of the gradient
for a flat per-transform hue. The same palettes serve the solid render — and,
since fr-3b6, the explorer's height/radius ramp recolor (see **Color modes**).
A user-authored **custom palette** (fr-55k) joins the presets as 2–8 evenly
spaced sRGB stops sampled piecewise-linearly into the same LUT, so it flows
through the CPU accumulators, the WGSL kernels' packed color table, and the
legend identically; the scene codec persists it as `#rrggbb` strings, and the
gradient editor under either palette select edits the one scene-wide slot.

**The solid voxel render** (`voxel.ts`) trades the 2-D histogram for a
world-space **3-D density grid**. An affine IFS carries no analytic distance
field to raymarch, so the solid render marches _measured_ density — the chaos
game's own per-voxel hit counts — paying the convergence cost once rather than
per view. `computeVoxelBounds` sizes the grid from a pilot orbit using trimmed
per-axis quantiles (robust to a stray variation outlier), cubed and padded; each
voxel keeps a hit count plus a **running-mean** color (accurate in f32 without
the flame's f64 trick). Color tracks the live point cloud exactly — the same
`colorMode` formulas and the same `colorGamma` contrast exponent, baked once into
a `buildColorModeLUT`, so a solidified attractor can never drift in hue from the
explorer it was captured from — or a palette gradient, as in the flame.
`voxelTextureData` packs the grid into an RGBA8 volume: color in RGB,
**log-normalized density in alpha** via the same `log1p` curve the flame
tone-maps with, so "solid enough to cross the isosurface" and "bright in a flame
of the same system" line up.

`voxel-material.ts` is the GPU side — a Three.js GLSL3 `ShaderMaterial` (one
of four places Three.js appears in the shipped app, alongside `scene.ts`,
`interactions.ts`, and the surface render's own `surface-material.ts`, below)
that raymarches the volume behind a full-screen quad:
reconstruct each pixel's camera ray, intersect the grid's box, march from a
dithered start until density crosses the threshold, bisect to localize the
isosurface, then shade it from a central-difference density gradient with a hard
shadow ray, a short ambient-occlusion tap, and Blinn-Phong lighting. Threshold,
light direction, and ambient are plain uniforms `scene.ts` pushes live, so those
controls re-render with no worker round-trip — which is also why the solid worker
needs no SharedArrayBuffer fast path (nothing on the main thread is tone-mapping),
unlike the flame.

Both renders extend to 4D (fr-5b3/fr-4wd). There is no separate 4D worker: the
flame and solid `start` commands each carry an optional `fourD` block whose mere
presence flips the session onto the 4D chaos game and `accumulateFlame4` /
`accumulateVoxels4`. That block is a **frozen snapshot** of the current 4D view,
captured the instant Render is clicked — the accumulated rotor, the cloud's 4D
center and rotated-w support, the slice window (`sliceOn` / `sliceCenter` /
`sliceWidth`) and its optional slice-relative recolor, and the lifted
`Transform4`s. It stays valid for the render's whole life for nothing: the
animation loop early-returns past the tumble step while a render is active, so
the frozen rotor simply never advances. The 4D flame rides the same WebGPU path
as the 3D one (fr-e26; see "GPU accumulation backend"), with `accumulateFlame4`
as its CPU oracle and fallback.

One asymmetry is deliberate: the **soft w-slice floor**. The point cloud and the
flame both slice with a small `SLICE_GHOST_FLOOR` (`0.06`, the single source of
truth in `project4.ts`), so geometry outside the slice window still registers as
faint ghost context in the additive render — the flame renders _the current
view_, ghosts included. The solid render slices with a floor of **`0`** instead:
an out-of-slice voxel contributes nothing, because a solid isosurface has no
translucency to fade a 6% pedestal into and would just fog the whole projection
with dross nobody asked to see solidified.

## The surface distance estimator

A converged system can also be rendered a fourth way (epic fr-7jlk): as a
true implicit surface, sphere-traced against an analytic **distance
estimator** (DE) instead of accumulated from chaos-game samples. The chaos
game applies every map FORWARD — pick `fᵢ` at random, plot `fᵢ(p)` — while a
DE runs the maps BACKWARD from an arbitrary query point, descending whichever
inverse image lands nearest the origin and tracking the accumulated
contraction so the final distance can be un-scaled once the descent bottoms
out: the classic KIFS `dr *= scale` bookkeeping, generalized from a set of
maps that fold onto themselves to an arbitrary IFS. `src/fractal/
surface-de.ts`'s `buildSurfaceDE` precomputes the inverse of every active map
— symmetry-expanded exactly like the chaos game's own kaleidoscope copies —
plus a seeded probe of the attractor's bounding radius and a pre-inverted
final-transform lens; `estimateDistance` is the descent itself, following
the two nearest inverse images at each level (the fr-v6yg width-2 beam)
plus up to two more that hold the rank-3/4 candidates while they stay
in-sphere (fr-jkpn's validity slots — in-sphere branches carry no positive
certificate, so before the slots a level with three or more simultaneous
in-sphere branches silently dropped the excess and measurably overshot),
while folding in a certified lower bound from every non-descended sibling
that escaped the bounding sphere, so the march crosses voids quickly
instead of stalling and the estimate stays tight near the surface without
needing the full exponential branch tree. The production estimator —
`estimateDistanceRefined`, the one the GLSL tracer mirrors — additionally
spends one extra Hutchinson level on each folded sibling certificate
(fr-1z6p, fr-beck's 4D ghost-eliminator ported back down): a barely-escaped
sibling otherwise freezes a near-zero bound the marcher false-hits,
rendering smooth "balloon" membranes across attractor voids (measured on
the default, sierpinski, pyramid, and jerusalem presets; refinement drives
every measured void false-hit to zero, and a fold-time laziness guard —
skip any fold whose plain certificate already fails to beat the running
min, bit-exact since refinement only raises certificates — keeps the cost
at ~2-4x inverse applications). See that module's doc comment for the
bound's derivation and the measured tables.

Whether a valid DE exists at all — and how fast it can be marched — turns on
**conformality**. For an invertible affine map with linear part `M`,
`dist(p, f(A)) ≥ sigma_min(M) · dist(f⁻¹(p), A)`, where `sigma_min` is `M`'s
smallest singular value: an EQUALITY for a conformal map (rotation/reflection
plus uniform scale), and a genuine but progressively looser LOWER bound as a
map's per-axis scales pull apart (anisotropy). That is exactly why
`analyzeSurfaceSystem` gates eligibility the way it does — the sigma_min
bound is exact for conformal maps, so an all-conformal system marches at full
step; conservative for anisotropic ones, so the tracer only backs off its
step size rather than risk piercing the surface; and intractable for
nonlinear variations, which have no closed-form inverse for any bound to be
stated in terms of — so a system using variations is ineligible outright
(one exception below, fr-5rvk), alongside one whose maps don't contract
(Hutchinson's condition for the attractor to exist in the first place, and
for the descent to terminate). A
system extending into 4D is not a disqualifier but a route: it gets the
DE's 4D twin (two paragraphs down) instead of this 3D one.

The one exception is a **pure-fold map** (fr-5rvk): a map whose variation
list is exactly one active fold-family entry (`boxfold`/`spherefold`/
`mandelbox`) composes a genuine function `w·V(Mp + t)`, not a sum — unlike a
blend, which has no branch decomposition and stays ineligible forever — and
each fold is piecewise affine-or-conformal, so its inverse decomposes into
per-cell branches that are all sound to enumerate unconditionally (a dropped
cell intersection only shrinks a lower-bound term): 27 branches for
`boxfold`'s per-axis reflections, 3 for `spherefold`'s outer/inner/mid
pieces, 81 for `mandelbox`'s composition of the two. `spherefold`'s mid
branch — a unit-sphere inversion — defeats the "inverse maps expand, so
wanderers escape" argument the affine descent's terminals rest on, so every
candidate also carries a region floor, a certified bound on distance to its
own branch's output region, that catches the spurious never-escaping chains
the inversion would otherwise spawn. Because a fold map can leave dozens of
branches simultaneously in-sphere, the descent runs a width-12 frontier in
place of the affine ladder's four beam slots (see `surface-de.ts`'s module
doc for the full argument and measured numbers). Eligibility itself gates on
the composite Lipschitz bound `|w|·L_V·sigma_max(M) < 0.999` (`L = 1` for
`boxfold`'s isometries, `L = 4` for the families carrying `spherefold`'s ×4
inner branch), so a fold map can read contractive in the editor yet fail the
gate — and, the other way, a small enough weight can rescue an expanding
affine part. The shipped Fold Lattice preset's `mandelbox` + `linear` blend
still reads "uses variations" under this rule. A pure-fold FINAL transform
is eligible since fr-g58b: the lens applies once, so its branches expand
into one round of root descents through the untouched cores
(`descendLens`), with no contraction gate — an un-iterated map needs none.
**Mandelbox KIFS** — twelve maps,
each exactly one fold entry — is the pure-fold showcase, and its preset
loads straight into Surface mode.

`src/app/surface-material.ts` is the GLSL sphere-tracer, and it mirrors
`surface-de.ts`'s `estimateDistanceRefined` line for line — the same
symmetry-expanded inverse maps, sigma_min values, and bounding radii packed
into fixed-size uniform arrays (capped at 24 slots) instead of JS objects,
running the identical refined beam-descent loop per ray step. Since fr-5rvk
that mirror is two compiled variants behind a `SURFACE_FOLDS` define — the
affine-ladder body unchanged, or a fold-frontier body mirroring the oracle's
`descendFold` — flipped by `setSurfaceSystem` in a rare, session-set-scale
program rebuild, never per frame. It is the same
CPU-oracle-to-GPU mirror discipline as `flame.ts` <-> `flame-gpu.ts`: the
tested, dependency-free module is the source of truth, and the shader is a
hand-kept-in-lockstep port, not an independent implementation. Unlike the
flame/solid renders, there is no accumulation to converge, so the mode reuses
their `RenderSession` enter/exit/first-frame-gate machinery but with a
no-op worker stub in place of a real one — the tracer's one render call
against the live camera IS the first frame, and every orbit/zoom afterward
just repeats that same call, exactly like the solid render's raymarcher
re-running each frame against its density grid, only here against an
analytic field that has no convergence to wait on.

Two fr-55r5 speedups shave that per-ray cost without touching the oracle
discipline. The march hands its own acceptance epsilon to the DE as an
early-out **cutoff** (part 1): the descent stops the moment its bound is
provably below the hit threshold — at or above the cutoff the returned value
is the full-descent result bit for bit, so step sizes never drift, and
fr-zkt2 added the value-exact twin exit that fires unconditionally once the
running min reaches the depth-0 sphere floor. fr-7xgi pinned that acceptance
epsilon itself to the full-resolution frame in every tier: the interaction
preview tier (`render-tier.ts`) used to scale it down with its own smaller
buffer, and at a fold system's coarse rungs that epsilon crossed the fold
DE's loose-but-valid plateau band (region floors read as low as 0.13 DE/D
near fold faces), rendering whole box-face shells as phantom geometry — a
preview may coarsen sampling, never acceptance. And an
**empty-space-skipping grid** (part 2): on every 3D surface-session enter, a
dedicated worker runs
`src/fractal/surface-grid.ts` — pricing each cell with a per-system estimator
(fr-aj4w's `surfaceGridEstimator`: the PLAIN one for fold systems, matching
what the fold GLSL tracer itself marches and measured ~1.5x cheaper with
near-identical floor quality, REFINED for affine) at the centers of a 64-cube
ceiling over the traced sphere, cutoff `cellRadius`, each cell storing the
descent value minus the cell half-diagonal, floored into f32 so quantization
can never round a bound upward. A fold build can still cost up to ~40x an
affine one at the same resolution, and the offline exporter's per-keyframe
await turns an unbounded build into an export stall rather than mere
background heat, so the worker times a measured pilot z-layer first and lets
`pickSurfaceGridResolution` downshift through a 64/48/32 ladder to fit a
3-second budget — floored at 32 rather than skipped outright, since a coarse
grid still beats gridless marching on exactly the systems expensive enough to
need one. Because distance fields are 1-Lipschitz, that stored floor is valid
from ANYWHERE in the cell, so the march samples the uploaded 3D texture
(NEAREST — interpolating neighbors' floors would not be a bound) before paying
a descent: a floor above the pixel epsilon is simultaneously a no-hit proof
and a safe stride. The grid is a session-scoped pure enhancement — latest-wins
by request id across session boundaries, no sync fallback (a lost worker just
means gridless, correct, slower marching), no 4D twin (the live rotor/slice
would invalidate a precomputed cube every frame) — and the offline exporter
awaits the build per surface keyframe so frame-exact clips never depend on how
fast the worker finished. Measured on SwiftShader at identical poses:
settled-frame trace time -13% on the default system, -8% on the void-poor
Menger sponge, with grid-vs-gridless frame diffs statistically identical to
run-to-run noise.

The same picture carries one dimension up (fr-vxoj, built on the fr-beck
spike's measured GO verdict). `src/fractal/surface-de-4d.ts` is
`surface-de.ts` with four coordinates: the sigma_min inequality is
dimension-free, so the whole descent transfers verbatim; the singular values
need a deterministic cyclic-Jacobi eigen-solve where 3D had a closed form;
and the kaleidoscope rides the same sector SWEEP as 3D's (fr-u91x lifted
fr-x029's expansion-to-sweep swap one dimension up: the descent turns each
chain point through the kaleidoscope's sectors instead of storing a composed
matrix per copy, so symmetry order costs descent time rather than slots),
leaving slots input maps 1:1 against the same 24-slot cap 3D uses, at any
order.
Those mat4-sized slots did start at 16, because in the DEFAULT uniform block
24 of them would have claimed 192 of the 224 fragment uniform vectors WebGL2
merely guarantees; fr-dqlq moved the per-map arrays into a std140 uniform
BLOCK — 2688 bytes of a guaranteed 16KB, budgeted separately from the default
block — which put the 24-map **24-cell** presets in reach and left the cap a
question of per-ray descent cost rather than uniform space. What the app
marches is never the full 4D attractor but its
`w = sliceCenter` SLICE. A certified 4D DE lower-bounds slice distance for
free — distance to a subset only grows — but the spike measured the plain
bound reading as ghostly bulges near off-slice structure (structure close in
4D but not on the slice), traced 100% to shallow, barely-escaped sibling
certificates; `estimateDistance4Refined` spends one extra Hutchinson level
on exactly those certificates at fold time, which measurably eliminated
every ghost (0.0% ghost hits on all slices measured) while preserving
validity. `src/app/surface-material-4d.ts` mirrors it under the same
lockstep-oracle discipline, with one live-view difference from every other
4D render: the SO(4) rotor and w-slice arrive as per-frame uniforms — a
rotation is an isometry, so the marched field is just
`DE4(rotorInv · (p, w0))` and step sizes, normals, and validity survive
untouched — meaning the pose stays exactly as live as the camera (tumble,
Shift-drag, and slice sweeps all keep working inside the mode), where
flame/solid-4D freeze theirs at session start because a pose change would
invalidate their accumulated content. Since fr-dlxh's 4D cut the same
estimator ALSO lives in `src/fractal/surface-de-gpu.ts` as the compute
kernel's fourth core (`core:"affine4"`), and PLAIN 4D surface sessions
(symmetry order 1) prefer `src/app/surface-compute.ts`'s WebGPU
renderer wherever an adapter exists — the rotor/slice ride every frame
spec (`view4`, re-read from the same scene state `setSurface4View`
maintains), so the live-pose discipline survives the seam — leaving
this fragment tracer as their fallback arm (`?surfacegl` / no adapter /
device loss). Kaleidoscope 4D stays HERE by measured verdict: the WGSL
sector sweep ran ~35x slower than this tracer's at order 6 (fr-b72d),
the same shape-keyed routing 3D uses between its affine and fold
classes.

That slice has a **thickness** (fr-wa6o). At the shipped default of 0 it is
the zero-thickness hyperplane described above, value for value. Above 0 the
query stops being the point `(p, w0)` and becomes the SEGMENT spanning
`|w - w0| <= h`, so the mode renders the projected shadow of a SLAB
`A ∩ {|w - w0| <= h}` rather than a cross-section — the same contract, one
dimension of the query thickened: a conservative lower bound whose zero set
is exactly "the segment meets the attractor". It works because affine maps
take segments to segments, so the descent carries one extra 4-vector (the
segment's half-extent, moved by each inverse map's linear part alone) and
every `|q| - R` ball certificate becomes a segment-to-centre distance; the
beam, the validity slots, the refined certificates, the terminal bound, the
sphere floor and the final-transform lens are all structurally untouched.
The extent GROWS down the descent — inverse maps expand — but only as fast
as the chain's contraction shrinks (`chainScale · |e| <= h`), so a slab
certificate sits within `h` of the point certificate it replaces and the
bound never degenerates. The slider is deliberately capped at half the
attractor's w-support: a sphere tracer stops at the first surface, so an
unbounded thickness would render only the projection's outer silhouette —
which is what SOLID mode already is. What the slab buys over Solid is
analytic detail with no grid ceiling, and the interesting regime is
thin-to-medium.

## Render workers & cross-origin isolation

Two of the app's three on-demand renders — the fractal-flame still and the
solid voxel view; the surface render, covered above, traces its frames
workerless and only borrows one for the optional empty-space grid
(`surface-grid-worker.ts`) — each run in a dedicated Web Worker
(`flame-worker.ts` / `voxel-worker.ts`) so hundreds of millions of
chaos-game iterations never touch the main thread. The workers are thin
`postMessage` glue around plain-Vitest-testable session state machines
(`flame-worker-core.ts` / `voxel-worker-core.ts`).

A third worker, `cloud-worker.ts` (fr-5kx), generates the live point cloud
itself — the PRIMARY interactive view, not an on-demand still, so it runs from
boot rather than being entered/exited from the panel. Its shape differs from
the flame/voxel workers as much as its purpose: no session state machine
streaming chunked partial results, just a single one-shot request → response
(`cloud-worker-core.ts`'s `generateCloud`, computed fresh per call), with the
at-most-one-in-flight / latest-wins pump living on the main thread in
`cloud-generator.ts` rather than in the worker. fr-acc's rAF coalescer
(`regen-scheduler.ts`) still fronts it — collapsing a drag/slider burst to one
request per animation frame — and fr-acc's other surviving piece, the
allocation-free hand-inlined chaos-game recording loop, now runs inside the
worker's `generateCloud` instead of synchronously on the main thread; together
the two bound staleness to about one generation behind the live state, no
matter how fast the input events arrive.

Transport is postMessage transfer, never SharedArrayBuffer: unlike the flame's
tone-map, which re-reads its shared histogram buckets every frame, a cloud
result is consumed exactly once — uploaded to the GPU and discarded — so
there's nothing repeated for a shared buffer to pay for. And because the live
cloud IS the app, unlike the optional flame/solid overlays, `cloud-generator.ts`
carries a permanent synchronous fallback — the very same `generateCloud` run
inline on the main thread — for when the worker can't be created, fails to
load, or crashes, so a dead worker degrades to janky-but-correct rather than a
dead app. Boot's first generation deliberately takes that same synchronous
path too, not as a fallback but by design, so first paint already shows a
cloud instead of a blank frame behind a worker round-trip.

The flame worker's transport has two flavors:

- **SharedArrayBuffer (fast path)** — when the page is cross-origin isolated,
  the main thread allocates two SAB-backed display-resolution histogram slots;
  the worker downsamples into them alternately (a double buffer) and each
  update crosses as a scalars-only notification. The main thread tone-maps a
  live view of the shared buckets itself, so exposure/gamma/vibrancy sliders
  re-render instantly with no worker round trip.
- **postMessage transfer (fallback)** — without isolation the worker tone-maps
  and transfers a display-resolution RGBA image per update, exactly the
  original design.

Isolation needs `Cross-Origin-Opener-Policy` + `Cross-Origin-Embedder-Policy`
headers, which GitHub Pages cannot send. In dev, Vite's server sends them
natively (see `vite.config.ts`). In production, a hand-written service worker
(`src/app/sw/sw.ts`, built via vite-plugin-pwa's `injectManifest`) composes the
Workbox precache with a COOP/COEP response rewrap in a single fetch handler —
one handler because only the first `respondWith` on an event wins, and cache
hits must be rewrapped too or isolation would break exactly when offline. A
first-ever visit necessarily loads before any service worker controls the page,
so `register-sw.ts` reloads such a page once as soon as the worker claims it
(and never again — a sessionStorage marker prevents loops where isolation can't
work, and the app then simply stays on the transfer fallback). The service
worker lives in its own tiny TypeScript program (`src/app/sw/tsconfig.json`)
because its WebWorker lib conflicts with the app's DOM lib.

The reload is not free, though: anything the in-page session did inside
that window is lost unless it already lives somewhere the reloaded page
reads back on its own. The scene document does — `persist.ts` writes
every edit into the `#v1=` hash and `fractal-viewer:scene` localStorage
as it happens, so the reloaded page's boot restores it verbatim — but
`AppState.renderMode` does not, because it is session-only by design
(`state.ts`): a first-visit user who picked a Flame-group preset, or
switched render mode by hand, inside the reload window used to come back
in the Points explorer with no trace of the choice, because the restore
is a plain scene load and the preset's render-mode hint never re-fires
(fr-su3r). `registerServiceWorker` now takes an `onBeforeIsolationReload`
hook, fired in the instant before the reload — never the update reload
below — with any throw swallowed, since isolation matters more than the
carried state. `main.ts`'s hook flushes the debounced edit session first, so
the hash holds the CURRENT document rather than whatever survived the save
delay, then writes the live render mode through `isolation-handoff.ts`'s
`saveIsolationHandoff`: a one-load-wide sessionStorage bridge, distinct
from but riding alongside the loop-guard marker above, that the next boot
reads back with `consumeIsolationHandoff`'s read-and-clear — so no later,
unrelated reload can re-arm a stale mode — and applies it once the boot
cloud and the camera framing have settled. The same fix moves registration
earlier too: a page that wants the isolation reload now registers immediately
instead of waiting for `load`, because that load is disposable anyway,
so the sooner the worker claims it and the reload fires, the smaller the
window in which interaction can be lost; an already-isolated page keeps
the original `load` timing, since it never reloads at all.

Neither everyday local surface forced that window open before fr-su3r.
`npm run dev` never reaches this code path at all — `register-sw.ts`
registers no service worker in dev, which gets COOP/COEP natively from
Vite's dev-server headers instead (above). `npm run preview` deliberately
withholds those headers so the reload dance CAN fire against it
(`vite.config.ts`), but the window it opens is real, unthrottled localhost
timing, gone between registration and reload before a person — let alone a
script — could act inside it. `scripts/isolation-reload.verify.mjs` is
what actually closes that gap: it serves the production build over a
plain static server with no COOP/COEP and deliberately delays `sw.js`'s
response, widening the reload window on demand so an action taken inside
it — like the render-mode switch this bug lost — can be reproduced and
checked deterministically instead of by timing luck.

A later deploy's worker no longer takes over an already-open tab uninvited —
it waits, since `skipWaiting()` now only runs once a page posts the worker a
`SKIP_WAITING` message. `register-sw.ts` detects that waiting worker (at
registration, via `updatefound`, and via a `registration.update()` check
whenever the tab becomes visible again) and the app shows the dismissible
"new version" banner; reloading is the user's choice, applied by posting
`SKIP_WAITING` and reloading once on the resulting `controllerchange`. An
ignored banner costs nothing — the old worker keeps serving the old precache,
so the old build's content-hashed chunk URLs (the flame/voxel/cloud workers)
can no longer 404 mid-session. If another tab accepts instead, the remaining tabs
get the same banner via the replaced-controller path (fr-k1z, fr-o13).

## GPU accumulation backend

Accumulation itself — not just display — is backend-pluggable (fr-npb): a
`FlameAccumBackend` seam in `flame-worker-core.ts` lets the flame worker
session drive either the CPU chaos-game loop (`accumulateFlame`, unchanged)
or a WebGPU compute-shader backend, chosen per render behind a
`navigator.gpu` capability check (on phones too since fr-hs9's on-device
validation), with CPU as the universal fallback and the ground truth the GPU
path is
measured against. The WGSL kernel and its pure packing/dispatch-planning/
histogram-conversion layer live in `src/fractal/flame-gpu.ts` (dependency-free
and Vitest-tested, like the rest of `src/fractal/`); `src/app/
flame-gpu-backend.ts` drives it from inside the worker behind the
`FlameAccumBackend` seam. The kernel is a line-for-line WGSL port of
`accumulateFlame`'s inlined stepping logic (same transform pick, affine/
variation/symmetry math, escape-reseed, final-transform lens, color walk),
diverging only where GPU execution forces it: f32 instead of f64, and many
independent per-chain PCG32 streams instead of one mulberry32 orbit — so its
output is a statistically indistinguishable render of the same attractor, not
a byte-identical one.

That distinction is pinned by a standing statistical-agreement harness: a
dev-only benchmark/comparison page (`src/app/gpu-bench/`) and its headless
runner (`scripts/gpu-flame-bench.mjs`, `npm run bench:gpu`) accumulate the
same system on both backends from the same seed-class and check the CPU/GPU
renders agree within measured thresholds, exiting non-zero if they don't —
the same page also doubles as the phone-benchmarking path, since it works
interactively over the LAN like any other dev page. CI runs the whole sweep
on every push/PR (fr-jnu): the `gpu-agreement` job executes the real WGSL
kernels on SwiftShader (Chromium's bundled software Vulkan, so no GPU runner
is needed), with the runner treating a skipped comparison (no WebGPU
adapter) as a failure rather than a pass. The scenario list includes a
"variation zoo" (3D and 4D) that enables all twelve classic variation types
across three maps plus a final-transform lens, so every hand-written WGSL
variation formula — not just the handful the showcase presets use — is
compared against `variations.ts`/`variations4.ts` on every CI run; a separate
"fold zoo" (3D and 4D, fr-p7nu) pins the three-member Mandelbox fold family
(`boxfold`/`spherefold`/`mandelbox`) against the same oracles. vitest
separately pins the WGSL switch's case numbering to `KERNEL_VARIATION_INDEX`
statically. See `docs/spike-fr-53k-gpu-flame-accum.md` for the original
spike's go/no-go decision and measured numbers.

Agreement is necessary but not sufficient — a render that matches the CPU
oracle can still have its tab OOM-killed or thermally throttled under
sustained load on a memory- and heat-constrained phone. That survival check is
a separate on-device soak: `scripts/gpu-flame-soak.mjs` attaches to the phone's
live Chrome over the DevTools Protocol (`adb forward` + `connectOverCDP`) and,
alongside `adb shell`, samples the app's own backend/clamp/error notices,
`/proc/meminfo` MemAvailable (the real OOM oracle — `performance.memory` can't
see the GPU storage or MAP_READ staging buffers), SoC temperature, and a
low-memory-killer / device-lost logcat scan while you drive a full-res render
by hand over the LAN. fr-7su's run (arm valhall, Android 10) passed cleanly:
minutes of continuous GPU accumulation with no thermal/memory kill, the GPU
path running _cooler_ than the CPU fallback it offloads, and — the device's
`maxStorageBufferBindingSize` binding at 256 MiB — a graceful limit-guard CPU
fallback once supersampling pushes the histogram past that ceiling
(`flame-gpu-backend.ts`).

The 4D flame render takes the same GPU path (fr-e26): `src/fractal/
flame-gpu-4d.ts` lifts the kernel one dimension — 4x4+translation affines,
the `variations4` registry, the 20-coefficient rotor+camera projection, the
four `FourDRenderColor` modes, and the soft w-slice's fractional weights
carried through the integer histogram as a x256 fixed-point factor —
mirroring `accumulateFlame4` the way the 3D kernel mirrors `accumulateFlame`.
Both kernels share one driver (`flame-gpu-backend.ts`'s program-parameterized
setup), one worker loop (`runChunk` drives 3D and 4D sessions alike through
the same `FlameAccumBackend` seam and GPU-failure ratchet), and one resident
display-downsample pipeline (the filter is linear, so the 4D buckets' extra
fixed-point factor just divides out on readback). The gpu-bench page's 4D
scenarios pin it against `accumulateFlame4` across all four color modes and
both slice states.

## Why this split?

Putting the IFS math, color mapping, presets, RNG, orbit camera, and state
reducers in pure modules means the parts worth testing are tested with fast,
deterministic unit tests and no WebGL context. Three.js and the DOM — which need a
real browser to mean anything — are kept thin and verified by running the app.
