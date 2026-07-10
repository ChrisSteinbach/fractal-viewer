# Architecture

Fractal Viewer renders an **Iterated Function System (IFS)** with the _chaos game_
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
do on the GPU and the fractal looks identical to the original standalone viewer.
`affine.test.ts` pins this down with identity, single-axis 90° rotations, scale,
translation, and a composed case against hand-computed values.

## Nonlinear variations

Strict affine maps only ever produce self-similar, straight-edged attractors.
**Variations** — borrowed from Draves & Reckase's _fractal flame_ algorithm —
are nonlinear functions applied to a transform's point _after_ its affine part,
warping space into flowing, organic, "impossible" shapes. `variations.ts` holds
a dozen classics (`spherical`, `swirl`, `bubble`, `julia`, …) as pure
`(x, y, z, rng) → [x, y, z]` functions.

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

The `radiolarian` and `swirl` presets showcase the feature; the transform editor's
**Variations** group adds/removes/weights them live.

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
`renderStyle`. The panel's **Final Transform** toggle enables a default (identity,
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
| `position`  | normalized xyz → rgb                                |
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

As of fr-5kx, the boxed `src/fractal` segment above — `runChaosGame` through
`buildColors` — no longer runs where this diagram might suggest: it executes
inside `cloud-worker.ts` (`cloud-worker-core.ts`'s `generateCloud`), reached by
`cloud-generator.ts` posting a request from the main thread. The worker
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
same twelve variation functions `variations.ts` documents, by the identical
convention one dimension up (angular warps carry `z` AND `w` through unchanged;
radial warps and `swirl` use the full 4D radius `x²+y²+z²+w²`), with an anchor
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
cloud — see below. Rotational symmetry stays 3D-only by design — a recorded
decision (fr-bf6), not an oversight, and the 4D chaos game genuinely has no
kaleidoscope-symmetry step — so its control simply hides whenever the system is
non-flat. The flame and solid renders were once 3D-only under that same
reasoning but have since gained 4D variants (fr-5b3/fr-4wd), covered under "The
flame still and the solid voxel render" below.

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

`persist.ts` keeps the viewer share-ready. The persistent subset of `AppState`
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

Beyond the live point cloud, a converged system can be committed to one of two
heavier, on-demand renders. Both replay the identical chaos game — same
transforms, variations, final-transform lens, symmetry — but accumulate its
plotted points into a different structure and present the result differently.
Each is session-only state (`flameActive` / `solidActive` in `AppState`, never
persisted), toggled from the panel, and each runs in its own Web Worker
(see "Render workers" below) so its hundreds of millions of iterations never
touch the main thread.

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
nudged halfway toward the chosen transform's palette slot each step, consuming no
RNG — and indexes that LUT, so orbit-adjacent points share a hue (flam3-style
structural coloring). The sentinel `"legacy"` palette opts out of the gradient
for a flat per-transform hue. The same palettes serve the solid render.

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

`voxel-material.ts` is the GPU side — a Three.js GLSL3 `ShaderMaterial` (the
third place Three.js appears in the shipped app, alongside `scene.ts` and
`interactions.ts`) that raymarches the volume behind a full-screen quad:
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

## Render workers & cross-origin isolation

The two on-demand renderers (the fractal-flame still and the solid voxel view)
each run in a dedicated Web Worker (`flame-worker.ts` / `voxel-worker.ts`) so
hundreds of millions of chaos-game iterations never touch the main thread. The
workers are thin `postMessage` glue around plain-Vitest-testable session state
machines (`flame-worker-core.ts` / `voxel-worker-core.ts`).

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
dead viewer. Boot's first generation deliberately takes that same synchronous
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
runner (`scripts/gpu-flame-bench.mjs`) accumulate the same system on both
backends from the same seed-class and check the CPU/GPU renders agree within
measured thresholds, exiting non-zero (CI-able) if they don't — the same page
also doubles as the phone-benchmarking path, since it works interactively
over the LAN like any other dev page. See `docs/spike-fr-53k-gpu-flame-accum.md`
for the original spike's go/no-go decision and measured numbers.

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
