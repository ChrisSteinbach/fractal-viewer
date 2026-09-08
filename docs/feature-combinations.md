# Feature-combination audit

The 2026-09-08 audit found one restriction that can be removed with the
existing rendering machinery: **Space tiling now combines with kaleidoscope
Symmetry in Points, Flame, Solid and Surface, in both 3D and 4D.** Both finite
reflection groups and mirrored lattices participate, subject to the chosen
renderer family's existing limits.

Tiling selects and repeats content from the already-symmetrical fractal. Its
nearest-copy argument works for any input set; the operations need not
commute. The previous refusal incorrectly required a stronger property.
The implementation also aligns Surface's automatic clip fit with the
symmetry and schedule used by the other renderers. The [tiling contract](tiling-contract.md#kaleidoscope-composition)
contains the conditional proof, approximation caveats and executable evidence.

## Restrictions found

These are user-visible compatibility or authoring limits, rather than a list
of every internal validation guard. “Promising” describes a research result
or existing implementation support, not a shipped capability.

| Restriction                                                                       | Underlying reason                                                                                                                            | Audit result                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space tiling + kaleidoscope                                                       | Blanket routing refusal despite a sufficient existing composition theorem                                                                    | Removed across both dimensions and all four views.                                                                                                                                                             |
| Space tiling + Balloon                                                            | The inverted set needs a finite enclosing ball and one operation order across renderers                                                      | Finite reflections compose in all four modes in 3D/4D: tile, reduce to the displayed space, then invert. Infinite lattices remain refused.                                                                     |
| Most nonlinear variations in Surface                                              | The inverse IFS descent needs tractable preimages and valid distance scaling; arbitrary blends and stochastic variations do not supply those | Pure swirl **finals** are admitted in both dimensions within an explicit strength limit, using a global inverse certificate and compensated hit tolerance. Recursive nonlinear maps and blends remain refused. |
| Nonlinear IFS content in point-family tiling                                      | Tiling currently borrows its certified origin radius from the Surface IFS builder                                                            | A real limitation beyond Surface rendering itself. Supporting more point sources needs a trustworthy bound or explicit bounded-content semantics.                                                              |
| Emitter-only Surface scenes                                                       | Both analyzers require a recursive map even though root condensation SDF evaluation and empty-map packing exist                              | A strong candidate for another small lift; zero-child, depth-band, schedule and GPU behavior remain to be verified.                                                                                            |
| A thick 4D Surface slice with sphere folds, swirl finals, escape chains or tiling | A straight segment bends into an arc or polyline under these maps; the current segment certificate ceases to apply                           | Needs a different conservative geometric representation. Removing the gate alone would give incorrect distances.                                                                                               |
| Shape-trap Geometry with anisotropic or power escape links                        | The geometry mode's current contract uses conformal copies; its scalar orbit machinery does not certify the broader object                   | Needs a separately defined and measured geometry bound. Color-only traps remain usable.                                                                                                                        |
| A lone Mandelbulb with weighted variation, post, final lens or kaleidoscope       | Dedicated bulb kernel/analyzer limits; some of the same operations already work for power links in escape chains                             | The chain is a useful existing alternative. A lone-map extension needs its own oracle/wire qualification. Triplex powers still have no genuine 4D definition.                                                  |
| Mesh-backed tiling clips                                                          | Tiling wrappers lack mesh-atlas delivery and dispatch                                                                                        | An implementation gap. Mesh support elsewhere in the app does not automatically supply these shader bindings.                                                                                                  |
| Aerial shading in 4D Points                                                       | Additive projected w layers do not have the single front-depth representation the current depth shading assumes                              | A rendering-representation limit, not just a disabled control.                                                                                                                                                 |
| Copy Link for local meshes                                                        | A URL does not carry the local mesh asset payload                                                                                            | Scene-file bundles already supply the portable route. Enabling the button alone would create broken shared scenes.                                                                                             |
| Rich imported palette editing                                                     | Imported ramps retain up to 4,096 entries, but the authored stop editor allows eight; its first edit converts the representation             | The renderer can retain more information than the editor. A richer editing model could remove this fidelity loss.                                                                                              |
| Timeline and collection capacity                                                  | Timeline permits 20 steps with 30-second per-step limits; the collection keeps 60 entries and evicts older ones                              | Product/storage policies, not mathematical limits. Any relaxation should account for storage failure and explicit retention behavior.                                                                          |

The governing code is in [Surface eligibility](../src/app/surface-eligibility.ts),
[3D](../src/fractal/surface-de.ts) and [4D](../src/fractal/surface-de-4d.ts)
estimators, [point tiling resolution](../src/fractal/point-tiling-session.ts),
[Mandelbulb eligibility](../src/fractal/bulb-de.ts),
[palette representation](../src/fractal/palette.ts),
[timeline](../src/app/timeline.ts), [collection](../src/app/collection.ts),
and the [control contract](controls.md).

## Nonlinear final-transform experiment

[The swirl sheet](../scripts/swirl-lens.harness.ts) tests the production
forward variation against an independently written inverse in both dimensions.
Swirl preserves radius and has one inverse xy rotation, carrying z and w.
A global inverse-Lipschitz bound lets the existing Surface estimator remain
inside one wrapper. No new recursive estimator is necessary for this final
transform case.

The prototype passed 60,000 independent point-pair certificate checks, but
its query-dependent denominator expanded the pixel hit tolerance. Fixed
128/512/1024 geometry comparisons exposed detached features in thin 4D
slices even at modest strengths; progressively reducing strength did not
provide a useful qualification.

The supported implementation uses one **global constant** inverse bound,
`G(rho) = 1 + rho² + rho*sqrt(rho²+2)`, for every query. Both the certified
stride and the complete hit tolerance are divided by G. This restores the
raw estimator's acceptance criterion inside its enclosing ball and is
stricter outside; it also composes through post-affines and Balloon. It
preserves the existing estimator's approximations, including its 4D
ambient-distance versus slice-distance limitation.

The pre-swirl enclosing radius is limited to 0.5 in both dimensions.
Variation weight and post-affine scaling act after swirl and cannot bypass
this limit. The [qualification record](swirl-surface-lens.md) carries the
proof, fixed-geometry comparisons, rejected alternatives, frozen wire and
browser/GPU gates. Thick 4D slices, nonlinear recursive maps and blends
remain separate work.

## Finite tiling with Balloon

Finite reflection images preserve the origin radius, so a finite tiled set
can use the existing Balloon inequality with an origin-centred enclosing
ball. This is more precise than treating all tiling as one incompatibility.
The [Balloon oracle](../src/fractal/balloon-de.ts) already explains why a
finite bound is sufficient.

Balloon now wraps the complete tiled estimator in WGSL and GLSL. Both Flame
image visitors add an echo deposit after view reduction; Solid queries the
tiled density underneath inversion; Points installs the certified ball with
the landed geometry before showing its echo. In 4D inversion follows slicing
or projection, so it echoes the object actually displayed. The
[composition record](tiling-contract.md#finite-balloon-composition) carries the
mathematical scope, renderer behavior and qualification.

An infinite lattice's presentation window does not certify the infinite
set's inversion. That combination remains disabled with an adjacent reason
and a usable choice of finite reflections.
