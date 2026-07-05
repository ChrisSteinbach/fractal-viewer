# Beyond Three Dimensions: 4D IFS Exploration

Status: design exploration (2026-07). The smallest proof-of-payoff spike
(**fr-cbg**) and its full productization (**fr-bf6**) have since shipped —
see the 2026-07-05 addendum, §8 — though §§3–4's parallel-mode plan below is
superseded by the unified design that actually landed. This note exists so
the analysis doesn't have to be re-derived if/when the n ≥ 5 question comes
up again.

## Verdict

Extending the viewer past 3D is **productive at exactly n = 4, for points
mode**, and unproductive as a general n-D feature. The math is nearly free —
the pure core has already paid for most of it — and point clouds are the rare
rendering primitive that survives extra dimensions. The genuinely expensive
parts are the two UI problems: _seeing_ a 4D cloud and _steering_ 4D
transforms. Beyond n = 4 the parameter count grows quadratically while every
new degree of freedom funnels indistinguishably through the same 3D
projection; n ≥ 5 is a math exercise wearing a UI.

## 1. The math barely resists

**The chaos game is dimension-blind.** `stepOrbit` is "pick a weighted map,
apply matrix + translation, escape-check, reseed" — nothing 3-specific except
the unrolled coordinates. Per-point cost goes from 9 multiplies to 16.
Attractor existence (Hutchinson's theorem) holds in any complete metric space.

**The `Transform` parameterization is already dimension-complete.**
`composeAffine` builds `M = R · diag(scale) · U` (`src/fractal/affine.ts`) —
orthogonal × upper-triangular, i.e. a **QR decomposition**. QR exists in every
dimension and reaches the whole affine group in every dimension:

| n   | position | scale | rotation | shear | total | affine group dim (n² + n) |
| --- | -------- | ----- | -------- | ----- | ----- | ------------------------- |
| 3   | 3        | 3     | 3        | 3     | 12    | 12                        |
| 4   | 4        | 4     | 6        | 6     | 20    | 20                        |
| 5   | 5        | 5     | 10       | 10    | 30    | 30                        |

**Rotations live in planes, not around axes.** "Rotation about x" is really
rotation _in the yz-plane_; `rotationMatrixXYZ` is already "one angle per
coordinate plane, composed in a fixed order". In 4D that becomes six angles —
the familiar three (YZ, ZX, XY) plus three new ones (XW, YW, ZW) — composed in
a fixed, documented order (the generalized Euler / Givens decomposition of
SO(n), which has n(n−1)/2 plane angles). The _axis_ picture is what dies: only
at n = 3 does the number of planes equal the number of axes. Consequences:

- A simple rotation fixes an (n−2)-dimensional subspace: an axis in 3D, a
  _plane_ in 4D. The kaleidoscope feature's `SymmetryAxis` becomes a symmetry
  plane (six coordinate planes to choose from).
- 4D admits **double rotations** — two independent planes turning at once
  (e.g. XY and ZW) with no fixed direction at all; equal angles make it
  _isoclinic_. These have no 3D counterpart and are the source of the most
  striking 4D motion.

**The variations already contain their own 4D recipe.** `variations.ts`
documents the exact convention used to lift Draves' planar flame formulas to
3D: radial warps (`spherical`, `bubble`, `swirl`'s radius) use the full
radius, angular warps act in the xy-plane and carry z through unchanged. The
identical convention carries w through unchanged. We committed to the
generalization scheme once already.

**Mechanical bits.** The escape check gains `|w|`; reseeding draws four
coordinates; `Bounds` gains `minW`/`maxW` and the radial extent becomes the 4D
radius. A pleasant accident: the 4D radius is invariant under the 4D view
rotation, so auto-framing (fr-0b8) can frame to `maxR` once and never needs to
re-run as the user tumbles the cloud. (w-_color_, by contrast, outgrew the
invariant radius: anisotropic clouds washed out toward gray, so the shader now
normalizes by the bounds box's rotation-covariant support in the rotated-w
direction — fr-9bk.)

## 2. Seeing it: projection

Point clouds are the one rendering primitive that generalizes — no meshes,
normals, or 3D-specific lighting. This app is in the rare genre where 4D is
cheap.

**Keep the points in 4D on the GPU.** Positions stay an xyz attribute; add a
`w` float attribute. A 4D linear rotation is exactly a `mat4`, which is a
native uniform type — apply it in the vertex shader (`onBeforeCompile` on the
points material), project orthographically by dropping the rotated w, and feed
xyz into the normal camera pipeline. Orbiting in 4D is then **one uniform
update**: the chaos game never re-runs and no CPU pass touches the buffers. (A
4D perspective projection — divide by `d − w` — is a later variant;
orthographic first.)

**w as color.** A `"w"` entry in `COLOR_MODES` is the cheapest, most effective
display of the fourth dimension, and it composes with the color legend
(fr-dsz) and the coordinate-mode gamma slider (fr-8sk). One subtlety: once the
4D rotation lives in a shader uniform, the rotated w only exists in the
shader, so w-coloring must be shader-side too (mix palette endpoints by
normalized w) — CPU-baked color attributes would go stale the moment the
rotation uniform changes.

**Slice softly, never hard.** The fraction of chaos-game points within ε of a
hyperplane scales like ε: a 1%-thick hard slice of a 10M-point cloud keeps
~100k points — starvation. Instead, modulate opacity by a Gaussian in
`abs(w − c)` in the shader and put `c` on a slider. It reads like
depth-of-field in the fourth dimension, wastes nothing, and sweeping `c` is
free (another uniform).

## 3. Steering it: manipulation

Three levels, from storage to gesture.

**Parameters (persistence + sliders).** Per transform: rotation becomes six
plane angles, position/scale become 4-vectors, shear becomes the six
above-diagonal entries of `U` — 20 numbers total (vs 12). The panel must group
them: the familiar three rotations in one row, a collapsed "4D" row for
XW/YW/ZW, likewise for w-position/-scale. Ungrouped, the editor sprawls.

**Composition and animation.** At exactly n = 4 there is a gift: SO(4) is a
**pair of unit quaternions** acting as `x ↦ p·x·q̄` (reading the point as a
quaternion). Composing rotations = two quaternion multiplies; interpolating =
two slerps; accumulating drag deltas has no gimbal artifacts; an isoclinic
rotation is a single factor. Use pairs internally for interaction and
animation, converting to the six angles only at the UI/persistence boundary.
(The dimension-generic version is geometric-algebra rotors — ten Bosch's
n-dimensional rigid-body treatment — but at n = 4 quaternion pairs are the
same object in cheaper clothing.)

**Gestures.** A mouse drag has 2 DOF, and raycasts can only hit the
_projected_ 3D scene. So: leave every existing gesture untouched, operating on
the projection, and add exactly one modifier that retargets a drag to the new
planes — drag-x → XW, drag-y → YW, wheel → ZW (Hanson's "rolling ball" scheme
restricted to coordinate planes). One convention serves both orbiting the 4D
view and rotating a selected transform. And ship the zero-UI option first: a
slow **auto-tumble** (XY + ZW double rotation) needs no interaction design and
_is_ the demo.

## 4. Codebase impact map

| Area                       | Change                                                                       | Notes                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fractal/affine.ts`        | parallel `Affine4` path: 4×4 from six plane angles, scale, translation       | keep the 3D path byte-identical; shear later                                                                                                              |
| `fractal/chaos-game.ts`    | 4D step/escape/bounds/plot                                                   | house style is hand-unrolled hot loops (flame inlines `stepOrbit`), so a dedicated Vec4 path beats an n-generic abstraction                               |
| `fractal/types.ts`         | `Vec4`, rotation/shear arity, `Bounds` + w                                   | a v2 of the `Transform` shape                                                                                                                             |
| `fractal/variations.ts`    | apply the documented scheme with w carried through                           | radial warps use the full 4D radius                                                                                                                       |
| `fractal/color.ts`         | `"w"` color mode                                                             | shader-side when the rotation is shader-side                                                                                                              |
| `fractal/presets.ts`       | pentatope gasket, tesseract flake, double-rotation spiral                    | 3D presets embed at w = 0                                                                                                                                 |
| `fractal/random-system.ts` | 4D "surprise" with the same contraction heuristics                           | later                                                                                                                                                     |
| `app/scene.ts`             | w attribute, `mat4` rotation uniform, slice uniforms                         | `onBeforeCompile`                                                                                                                                         |
| `app/orbit.ts`             | unchanged                                                                    | the 3D camera orbits the projection; 4D view rotation is separate state (a quaternion pair)                                                               |
| `app/persist.ts`           | v2 hash with a `dims` field; v1 decodes as 3D                                | the strict decoder was built for this — **superseded by §8 (fr-bf6)**: shipped as an additive `w` block inside the existing v1 codec, no `dims`/v2 needed |
| `app/ui.ts`                | grouped/collapsible 4D parameter rows                                        | the real cost — **superseded by §8 (fr-bf6)**: shipped as one collapsed 4D group in the existing editor, not a parallel one                               |
| `app/interactions.ts`      | modifier-retargeted drags; guide boxes become projected tesseract wireframes | raycast the projection as today                                                                                                                           |
| flame / voxel workers      | must be generalized in lockstep, or gated "3D only"                          | voxel could consume the projected cloud but re-voxelizes per 4D rotation; flame's inlined loop needs real work                                            |

## 5. Why cap at n = 4

- Parameters per transform: 12 → 20 → 30 → 42. Quadratic.
- Every plane beyond the six of 4D funnels through the same 3D projection;
  their effects stop being visually distinguishable.
- Presets, gesture vocabulary, and human intuition all decay at once; 4D is
  the last dimension with a graspable story (planes, double rotations, one
  extra color axis).

## 6. Why bother at all

A single 4D system is a **continuous family of 3D fractals**. Sweep the slice
position, or turn one XW angle, and the attractor morphs through shapes no
rigid 3D motion could connect — slices and projections of a self-similar 4D
set are generally _not_ self-similar themselves, so there is genuinely new
structure the whole way through. Showcase presets:

- **Pentatope (5-cell) gasket** — five maps, scale ½, at the vertices of the
  4-simplex; the true successor of the Sierpinski tetrahedron (Hausdorff
  dimension log 5 / log 2 ≈ 2.32).
- **Double-rotation spiral** — contract + rotate XY and ZW at incommensurate
  angles; a structure with no 3D counterpart whatsoever.

It is also near-virgin territory: 4D fractals in the wild are almost all
quaternion Julia sets; interactive 4D _IFS_ toys effectively don't exist.

## 7. The spike (fr-cbg)

Smallest slice that proves the payoff — points mode only:

1. 4D core path: compose a 4×4 affine from six plane angles + scale +
   translate (no shear yet); 4D `stepOrbit` with escape/reseed/bounds;
   pentatope preset (+ optionally the double-rotation spiral); unit tests.
2. Rendering: w vertex attribute; 4D rotation as a `mat4` uniform in the
   vertex shader; orthographic drop-w; in-shader w-coloring.
3. A slow auto-tumble (XY + ZW).
4. Stretch: soft slice — Gaussian opacity in `abs(w − c)`, slider for `c`.

Out of scope: editing UI, persistence, flame/voxel, drag gestures, symmetry.
Success criterion: the pentatope gasket tumbling smoothly with w-color, the 3D
shape visibly flowing through non-rigid changes.

## 8. Addendum (2026-07-05): the unification pivot (fr-bf6)

§§3–4 above describe the plan as it stood when this note was written: a parallel
`Transform4`/`Affine4` system the user explicitly enters and exits, a v2
persistence format keyed on a `dims` field, and a grouped-but-separate 4D
parameter editor costed as "the real cost." The spike (§7) shipped as
**fr-cbg**, followed by **fr-hy8** (shear, variations, and a 4D final-transform
lens, completing `Transform4`'s parameterization) — but the productization
epic, **fr-bf6**, rejected the parallel-mode plan outright rather than building
it. Recorded here so the "why" doesn't have to be reconstructed from the git
log:

- **A unified model, not a mode.** `Transform` gained one optional field,
  `w?: WExtension` (`position?`, `scale?`, `rotation?: {xw,yw,zw}`,
  `shear?: {xw,yw,zw}` — `fractal/types.ts`), rather than a second
  `Transform4[]` system living beside it. An absent `w` block (or one with
  every field absent or exactly `0`) means the map is flat in the `w = 0`
  slice; an absent `w.scale` specifically means DERIVED — recomputed at lift
  time as the map's mean spatial contraction, so it tracks later 3D scale
  edits instead of freezing a value true only when `w` was first touched.
  "4D" is now `!systemIsFlat(transforms)` (`affine4.ts`), a property derived
  from `state.transforms` every generation, never a stored mode flag — no
  mode field on `AppState`, no entry/exit action, and no separate
  `fourDSystem` to fall out of sync with the real one. The lift
  (`toTransform4`) is `embedTransform3`'s pre-existing `w = 0` embedding
  (built across fr-2ou/fr-hy8, untouched by fr-bf6) plus a sparse splice of
  whatever `w` overrides a transform carries.
- **Persistence: additive, not v2.** The `dims`-field v2 hash design never got
  built and is now dead. `persist.ts` instead threads an optional `w` block
  through the EXISTING `#v1` codec, field-for-field matching `WExtension` and
  clamped against the same `MIN`/`MAX_W_*` constants the editor sliders read
  (`state.ts`). Every pre-4D link keeps decoding exactly as before, and
  `encodeTransform` canonicalizes through `isFlatTransform` so an all-flat
  system's bytes stay byte-identical to a pre-4D one, not merely compatible
  with it.
- **One editor, not a parallel one.** The grouped/collapsible 4D rows this
  table costed as "the real cost" shipped as exactly that and nothing more: a
  single collapsed `<details>` "4D" group at the end of the existing
  per-transform (and final-lens) editor — Position W, Scale W, Rotation
  XW/YW/ZW, Shear XW/YW/ZW — with no second editor, no per-map "Map" dropdown,
  and no session-only panel bridging to a throwaway `Transform4`. Every write
  is sparse, so zeroing every row in the group returns the system to the 3D
  path live.
- **Presets as data.** The pentatope gasket and the double-rotation spiral
  (§6) are ordinary `Transform[]` factories in `presets.ts` whose maps carry a
  `w` block, joining the Presets dropdown under a "4D" `<optgroup>` beside
  every 3D preset — not a separate entry point, and not the one-way "Current
  System → 4D" embed button this section anticipated needing (that button,
  and the mode's entry/exit machinery generally, never shipped and so needed
  no deprecation).
- **DECISION, recorded:** flame, solid, and symmetry stay 3D-only and gate on
  flatness — their controls hide, rather than generalize, whenever
  `systemIsNonFlat` holds. This is the resolution this table's "flame / voxel
  workers" row left open. Voxel-of-the-current-projection (re-voxelizing per
  tumble orientation) remains a possible future nicety, not a commitment.

See `affine4.ts`, `chaos-game-4d.ts`, `variations4.ts`, `rotor4.ts`, and
`architecture.md`'s "The 4D extension" section for the shipped implementation
this addendum summarizes.

## References

- A. Hanson, _Visualizing Quaternions_ — and his 4D visualization work, the
  source of the "rolling ball" n-D rotation controls.
- M. ten Bosch, _N-Dimensional Rigid Body Dynamics_ (SIGGRAPH 2020) — rotor
  (geometric algebra) treatment of n-D rotation.
- S. Draves & E. Reckase, _The Fractal Flame Algorithm_ — source of the
  variation functions already borrowed in `variations.ts`.
