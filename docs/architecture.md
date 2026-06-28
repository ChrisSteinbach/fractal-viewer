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

`runChaosGame(transforms, numPoints, rng)` in `src/fractal/chaos-game.ts`
implements exactly this. It:

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

## Color modes

`buildColors(result, transforms, mode)` in `color.ts` produces a parallel
`Float32Array` of per-point RGB. The six modes:

| Mode           | Mapping                                             |
| -------------- | --------------------------------------------------- |
| `transform`    | one hue per map (evenly spaced)                     |
| `height`       | y normalized → blue → green → red                   |
| `radius`       | distance from origin → warm (inner) to cool (outer) |
| `position`     | normalized xyz → rgb                                |
| `iterationAge` | generation order → magenta (early) to cyan (late)   |
| `uniform`      | constant cyan `(0.4, 0.8, 1.0)`                     |

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

## Why this split?

Putting the IFS math, color mapping, presets, RNG, orbit camera, and state
reducers in pure modules means the parts worth testing are tested with fast,
deterministic unit tests and no WebGL context. Three.js and the DOM — which need a
real browser to mean anything — are kept thin and verified by running the app.
