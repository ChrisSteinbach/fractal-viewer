# Surface slice thickness through folds and tiling

## Current behavior

The CPU oracle now answers slab queries for spherefold and Mandelbox systems
(recursive maps and final lenses alike) with the **bounded midpoint cover**
below. The production routing has **not** switched yet: `main.ts`, the GPU
packers, and the panel still gate on `slabExact4`, so the user-visible
control keeps its refusal for those systems until the WGSL mirror and the
routing change land. The remaining refusals are swirl finals, condensation,
forward escape-time systems, and both Space tiling arms; the CPU entries,
the GPU packers, and the UI enforce each independently.

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

## The shipped bounded midpoint cover

`src/fractal/surface-de-4d.ts` answers a nonlinear slab query by splitting
the segment into `SLAB_COVER_PIECES` (16) equal pieces, running the POINT
estimator at each piece's midpoint, and returning

```text
min_i max(0, DE(mid_i) - |e| / pieces)
```

Every term is the triangle-inequality certificate above, evaluated over a
COMPLETE partition, so the result is a valid lower bound for **any** piece
count: the count is an accuracy and cost knob, never a soundness one. No
interval can be left unresolved because none is ever dropped — the work is
exactly `pieces` point descents, which is suspension-free and bounded, so
the flat-plane adversary's need for 131071 evaluations at 1e-5 tolerance
becomes a disclosed accuracy limit rather than an unbounded loop. Zero
thickness bypasses the cover entirely (one point query, bit-exact), and
boxfold/affine systems keep the exact segment path. The public entry's
cutoff contract survives: each piece receives `cutoff + pieceHalfLength`, so
a cover that clears the cutoff matches the full cover and a dip implies the
full cover dips.

The single-query alternative — carry a chord plus a controlled error bound
through the inversion (`inversion.ts`'s ball identity plus a sagitta) — was
written, independently pinned, and refuted by measurement. It keeps
direction at each crossing, but the slack compounds across a recursive
fold's many crossings and the certificate collapses to zero over a large
part of the bounding ball:

| Nonlinear fixture         | BALL hits | Adaptive hits | Chord-enclosure hits | Chord-enclosure adaptive IoU |
| ------------------------- | --------: | ------------: | -------------------: | ---------------------------: |
| Recursive spherefold pair |       460 |           149 |                  450 |                        0.331 |
| Mandelbox final           |       460 |           292 |                  448 |                        0.692 |

That is the whole-slab dilation back again: 97-100% of the ball arm's hit
mask. The executed record of the attempt lived in the same commit range and
was dropped from production when the cover shipped.

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
reference, the shipped cover (`COVER`, which IS the public entry), the
piece-count curve (`FIXED4/8/16/32`), and the existing segment or exact
finite split when available.

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

The cover's own 32×32 study on the same machine (Node 22.23.2, 13 September
2026), with `h = 0.25R` and the same pose. Hit counts first, then hit-mask
IoU against the adaptive reference:

| Fixture                   | POINT | BALL | ADAPTIVE | COVER | COVER IoU | FIXED8 IoU | FIXED16 IoU | FIXED32 IoU |
| ------------------------- | ----: | ---: | -------: | ----: | --------: | ---------: | ----------: | ----------: |
| Affine 16-cell flake      |   201 |  460 |       50 |    50 |    1.0000 |          ¹ |           ¹ |           ¹ |
| Boxfold final             |    21 |  399 |       40 |    50 |    1.0000 |          ¹ |           ¹ |           ¹ |
| Mandelbox final           |   173 |  460 |      292 |   324 |    0.9012 |     0.8391 |      0.9012 |      0.9574 |
| A4 tiling (segments)      |    68 |  390 |      153 |     ² |         ² |          ² |           ² |           ² |
| A4 + Mandelbox final      |    75 |  460 |      160 |     ² |         ² |          ² |           ² |           ² |
| Recursive spherefold pair |    77 |  460 |      149 |   178 |    0.8371 |     0.6742 |      0.8371 |      0.9141 |

¹ Affine and boxfold systems run the exact segment path, so `COVER` and
`SEGMENT` are the same call; the IoU-1 row is the cross-check that the
cover did not disturb exactness, and the FIXED arms are the alternative
mechanism's curve, not something those systems would use.
² Tiled sessions still refuse a slab; the tiling child owns that lift.

`COVER` equals `FIXED16` on the nonlinear rows by construction — the public
entry uses `SLAB_COVER_PIECES = 16`. Cost is the piece count in point
descents per query: 68,816 core calls for the Mandelbox-final panel and
63,792 for the spherefold panel, against the adaptive reference's 211,863
and 232,003. The 16-piece count retains most of the reference's structure
(IoU 0.84-0.90) at a third of its cost; 8 pieces is 0.67-0.84 and 32 is
0.91-0.96. These are CPU card counts at one pose and thickness, and the GPU
mirror's own occupancy, dispatch and watchdog limits are still unmeasured.

The A4 exact split used a median/p99/max of **3/7/10** core queries and 42,215
core calls for the panel, versus 411,527 point-core calls for adaptive sampling.
Illustrative serial CPU times were 0.52s and 4.90s. The Mandelbox-final adaptive
panel used 1,143,096 core calls and took about 45s against 0.81s for its centre
slice. These timings are CPU study observations; no WebGPU timing, occupancy,
shader-link, or watchdog conclusion follows from them.

There is also a deterministic cost adversary: a segment parallel to an exact
flat surface at distance 0.01, with half-length 0.5. Absolute tolerances of
`1e-3`, `1e-4`, and `1e-5` require 1,023, 16,383, and 131,071 point calls.
A 255-call cap fails all three honestly. The shipped cover reads this as a
disclosed accuracy limit, not a refusal: sixteen pieces return a valid but
coarse bound in sixteen calls, and a scene whose detail sits at the
1e-5-tolerance scale will render softer than the adaptive reference would.
The cover may never be read as "as accurate as the adaptive solve" — only
as "sound, bounded, and retaining the measured IoU at the shipped count".

## Remaining implementation

The CPU oracle is complete and tested for the nonlinear systems: exact
segment arithmetic for affine/boxfold, the bounded midpoint cover for
spherefold and Mandelbox (recursive maps AND final lenses), bit-exact zero
thickness, and the cutoff contract through the cover. What remains is
production plumbing, and it is deliberately not started until the mirror's
cost is measurable:

- **WGSL 4D cores.** `surface-de-gpu.ts`'s `ifs4` kernels (`affine4`,
  `fold4`, and the `lens4` wrapper) must answer a nonzero `sliceHalfW` for a
  non-`slabExact4` system with the same 16-piece cover: sample the entry
  point along the stored half-extent, run the point core per sample, take
  the min of `d - |e|/16`, and keep the exact segment path for
  `slabExact4` systems unchanged. The packer's `slabExact4` throw and the
  zero-filled params seat are the seams. The per-ray cost is 16x the point
  descent wherever the slab is live, so the compute renderer's dispatch
  sizing, fence groups and the watchdog budgets all need re-measurement on
  a real driver before the UI admits the combination.
- **Routing and controls.** `main.ts`'s `surface4SlabExact`, the panel's
  `setFourDSlabAvailable` reason set, and the compute spec must switch from
  `slabExact4` to `slabSupported4`, with the coverage wording replaced by an
  honest cost/quality note; the GLSL 4D fallback may keep refusing (fold
  sessions are compute-only by construction).
- **Tiling composition.** Tiled 4D sessions still clamp thickness to zero;
  finite pieces need the split/cover composition and lattice walls need
  crossing enumeration (the tiling child's work).
- **Browser matrix.** Enter/settle/draw at several thicknesses and rotor
  poses, zero-thickness identity, authored radii/posts, reloads and
  captures on both engines, including the Mandelbox-plus-tiling acceptance
  case the epic names.

CPU agreement and renderer work bounds are therefore the halves still
missing; the shipping guards stay in place until they land, but the CPU
mechanism itself is no longer a refusal and no longer an experiment.
