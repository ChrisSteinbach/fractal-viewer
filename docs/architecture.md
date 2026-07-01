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

The `spherical` and `swirl` presets showcase the feature; the transform editor's
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

`main.ts` holds the single `AppState`, mutates it only through the pure reducers
in `state.ts`, and after each change calls the relevant refreshers
(`regenerate` → re-run the chaos game; `refreshGuides` → rebuild the wireframe
boxes; `refreshUi` → update labels and the transform list). The animation loop
applies the orbit camera, retightens the fog, and renders.

## Scene persistence

`persist.ts` keeps the viewer share-ready. The persistent subset of `AppState`
(transforms, point count/size, color mode, depth style, guide visibility) is
serialized to a compact `v1=<base64url>` payload and written to both the URL hash
(`history.replaceState`, so edits don't pile up in the back-button stack) and
`localStorage`, debounced so slider drags don't thrash. On load the hash wins
over storage — a pasted link beats the last local session.

`decodeScene` is the one place that ingests untrusted input (a URL someone
pastes), so it is a strict, **never-throwing** boundary: it rejects an unknown
version, bad base64/JSON, the wrong transform shape, or an unknown color/depth
enum, and clamps numeric ranges. Storage and location are injected, so the codec
is unit-tested with no real browser.

## Why this split?

Putting the IFS math, color mapping, presets, RNG, orbit camera, and state
reducers in pure modules means the parts worth testing are tested with fast,
deterministic unit tests and no WebGL context. Three.js and the DOM — which need a
real browser to mean anything — are kept thin and verified by running the app.
