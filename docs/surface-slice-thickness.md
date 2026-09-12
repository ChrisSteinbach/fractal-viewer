# Surface slice thickness through folds and tiling

## Current behavior

Surface keeps **W position** live but disables **Slice thickness** when the
4D estimator cannot carry its query segment. This includes spherefold or
Mandelbox in a recursive map or final transform, swirl finals, condensation,
forward escape-time systems, and either Space tiling arm. The corresponding
CPU entries and GPU packers enforce the restriction independently of the UI.

These are missing combinations, not a reason to remove thickness from the
product. This investigation does **not** enable them. The finite reflection
prototype below establishes a bounded route toward one lift; the nonlinear
prototype establishes a more accurate reference and exposes the work that a
renderer integration must accommodate.

The initial report was reproduced on 12 September 2026 with a fresh production
build and a verified hardware Intel Iris Xe WebGPU adapter. A Mandelbox final,
A4 reflection tiling, and their combination all completed distinct renders
at W positions 0 and 0.25. Each kept the position field enabled and disabled
the thickness field with its existing adjacent explanation. This was a
position-liveness check, not qualification of a new thickness implementation.

## Why the existing segment cannot simply pass through

For the displayed point `p`, thickness queries the segment
`S = {(p, w0) + s e : -1 <= s <= 1}` in the inverse-rotated 4D frame.
Distance from `S` to the set lower-bounds distance to its projected slab.
Affine inverses, including individual boxfold branches, preserve segments.
A spherefold inversion curves them. Finite reflection tiling is piecewise
linear and can bend a segment whenever it crosses a reflection hyperplane.

The older `slab-ball-slack.harness.ts` compares the shipped segment with the
whole-query relaxation `max(0, DE(center) - |e|)`. That relaxation is a valid
bound but introduces thickness in spatial directions too. Its measured loss
of fractal detail remains a reason not to ship that formula as a slab.

## A continuous adaptive reference

`scripts/slab-adaptive.harness.ts` subdivides the **original** segment. Every
point evaluation therefore keeps the complete nonlinear lens and tiling in
their existing order; it never substitutes the chord of an inverted segment.

For an interval centered at `q` with half-length `r`, its certificate is

```text
L = max(0, DE(q) - r)
```

For every point `x` in that interval, the triangle inequality gives
`dist(x, A) >= dist(q, A) - |x-q| >= DE(q) - r`. The minimum certificate over
a complete interval cover is a lower bound on `dist(S, A)`. This argument
requires the point estimator's existing distance-bound contract, **not** a
new assumption that its returned field is 1-Lipschitz. It consequently does
not certify the heuristic escape-time family, which this sheet does not run.

The minimum sampled DE value is an **acceptance witness**, not an upper bound
on true distance. The solver refines until its certificate is close to one
of those witnesses. Within four pixel epsilons, the allowed gap is 1/16
of the current pixel epsilon; farther away it grows continuously toward a
25% relative gap, permitting cheaper, still conservative strides. The
threshold `witness - tolerance(witness)` is nondecreasing, so finding a
smaller witness never invalidates an earlier pruning decision. Normal
probes use the same rule with a fixed study epsilon of `0.002R`. That
probe choice is not a production shading contract.

Unlike subtracting the entire slab thickness, the unresolved spatial
relaxation now shrinks with the requested tolerance. The method inherits the
existing point estimator's hit approximation, so agreement with another
finite-depth estimator is a comparison, not independent set-membership proof.
Analytic segment-to-ball tests check the bound and absolute error independently,
including a sphere obtained using the shared 4D inversion-ball identity.
Zero thickness returns the point result exactly, including negative values.

Work exhaustion is a distinct `complete: false` result. It is never accepted
as a surface hit or a background miss. The rendering study throws if that
result appears instead of drawing a partial calculation.

## Exact finite reflection pieces

All reflection hyperplanes are represented by the group orbits of the simple
roots. Antipodal normals describe the same hyperplane. A straight segment
crosses each hyperplane at most once; sorting its crossing parameters divides
it into pieces on which the fold is one isometry. Folding each piece's ends
therefore gives its full straight image.

This construction has a geometric cap, independent of pixel resolution:

| Group | Reflection hyperplanes | Maximum pieces |
| ----- | ---------------------: | -------------: |
| A3    |                      6 |              7 |
| B3    |                      9 |             10 |
| H3    |                     15 |             16 |
| A4    |                     10 |             11 |
| B4    |                     16 |             17 |
| F4    |                     24 |             25 |

The prototype checks each piece's interior against the existing point fold
and checks segment distance against an independently enumerated orbit of a
canonical point. It exercises all six groups, preserving the shared 3D/4D
reflection algebra even though Surface thickness itself is a 4D view feature.
The tolerance includes the existing point fold's `FOLD_EPS` allowance.

For an unclipped finite tiling over a segment-capable IFS, the minimum of the
existing DE over these pieces is a conservative slab estimator. The prototype
does not pass a segment through a spherefold or a Mandelbox final. It also
does **not** qualify clips: separately minimizing the DE and clip SDF can
select different W positions and falsely admit geometry. A clip needs its
intersection evaluated on the same query pieces. Lattice walls require their
own crossing enumeration and work bound; the finite-root table is not that
enumeration.

## Measured comparison

Run the following on its own to avoid distorting CPU costs:

```bash
SLAB_SIZE=64 npx vitest run --config scripts/vitest.harness.config.ts scripts/slab-adaptive.harness.ts
```

The shared `de-preview.ts` marcher produces the contact sheet and records
primary-ray exhaustion. Output lives under the ignored `scripts/out/slab-adaptive/`.
Columns are centre slice, whole-slab ball relaxation, adaptive interval
reference, and the existing segment or exact finite split when available.
Black fourth panels explicitly mean that there is no such reference.

The 64×64 study uses one fixed W-mixing rotation, `w0 = 0.08R`, and world
half-thickness `h = 0.25R`. These are fractions of the DE's full visible
radius, **not** claims about the UI's normalized slider value. Ambient
occlusion and shadow are disabled to isolate geometry. All six fixtures
rendered and finished without exhausted primary rays.

On an Intel Core i7-1165G7, Node 22.23.2, 12 September 2026:

| Fixture                   | Centre hits | Ball hits | Adaptive hits | Segment / split hits | Adaptive calls per query, median / p99 / max |
| ------------------------- | ----------: | --------: | ------------: | -------------------: | -------------------------------------------: |
| Affine 16-cell flake      |         298 |      1584 |           714 |                  700 |                               21 / 101 / 191 |
| Boxfold final             |          47 |      1497 |           114 |                  119 |                                11 / 75 / 151 |
| Mandelbox final           |         356 |      1812 |           858 |                    — |                               37 / 157 / 435 |
| A4 tiling                 |         147 |      1468 |           501 |                  496 |                               17 / 149 / 295 |
| A4 + Mandelbox final      |         167 |      1812 |           379 |                    — |                               33 / 131 / 317 |
| Recursive spherefold pair |          90 |      1812 |           313 |                    — |                               33 / 257 / 439 |

Adaptive/segment hit-mask IoU was 0.9804 for the affine flake and 0.9098 for
the boxfold final. Adaptive/exact-split IoU was 0.9900 for A4 tiling. These
are small-raster comparisons at one pose and thickness, not a release matrix.
The adaptive nonlinear rows retain internal structure where the ball arm
fills the marching ball, but have no exact slab reference in this study.

The A4 exact split used a median/p99/max of **3/7/10** core queries and 42,215
core calls for the panel, versus 411,527 point-core calls for adaptive sampling.
Illustrative serial CPU times were 0.52s and 4.90s. The Mandelbox-final adaptive
panel used 1,143,096 core calls and took about 45s against 0.81s for its centre
slice. These timings are CPU study observations; no WebGPU timing, occupancy,
shader-link, or watchdog conclusion follows from them.

There is also a deterministic cost adversary: a segment parallel to an exact
flat surface at distance 0.01, with half-length 0.5. Absolute tolerances of
`1e-3`, `1e-4`, and `1e-5` require 1,023, 16,383, and 131,071 point calls.
A 255-call cap fails all three honestly. Accurate generic subdivision thus
has no small, resolution-independent call cap. Dropping the unfinished
intervals or accepting their loose lower bounds would undo the accuracy
argument.

## Remaining implementation

Finite wall splitting is a qualified CPU prototype for **unclipped,
segment-capable** content. Production work still needs the shared finite and
lattice segment vocabulary, clip intersections, CPU tiled scalar/refined/march
entries, both WGSL 4D descent cores, the supported GLSL 4D arm, and hit
attribution that remaps the winning piece's `sStar` into the original slab.
Then the routing and controls can admit the qualified combinations. The
existing tiling wire need not move merely to bake finite mirror constants.

Nonlinear support needs a separately qualified query representation or
bounded continuation for generic subdivision. A direction-preserving curve
enclosure through inversion is a candidate; the old whole-ball relaxation
is not its accuracy evidence. Recursive folds and final lenses must both be
covered, including authored radii/posts and composition with tiling. A generic
fallback must suspend unfinished work through normal, AO and lighting probes
as well as primary rays; a work cap must never fabricate a hit or a miss.

CPU agreement, renderer work bounds, slice-dependent colors, live edits,
reloads and exports remain unqualified for either lift. The shipping guards
therefore remain in place. The investigation establishes concrete next work,
not a new permanent refusal and not restored user-visible thickness.
