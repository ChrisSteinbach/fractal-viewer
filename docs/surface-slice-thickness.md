# Surface slice thickness through folds and tiling

## Current behavior

The CPU oracle and the WebGPU compute kernels both answer slab queries for
spherefold and Mandelbox systems (recursive maps and final lenses alike)
with the **bounded midpoint cover** below, and the app routes the
combination: `main.ts` sets the panel's thickness availability from
`slabSupported4`, and an untiled nonlinear 4D session compiles the cover
kernel (`slabCover: true` in `surface-de-gpu.ts`) beside its h=0 point
kernel. The remaining refusals are swirl finals, condensation, forward
escape-time systems, and both Space tiling arms; the CPU entries, the GPU
packers, and the UI enforce each independently, and the panel names the
refusing branch.

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

## The WGSL cover

`surface-de-gpu.ts` mirrors the cover for the two 4D descent cores
(`affine4`, `fold4`) under the codegen option `slabCover`, which requires
`slabExt` and refuses the tiling composition (tiled 4D slabs are refused at
pack, so no legal pipeline could be fed one). The composed descent — the
core alone, or the core under its `descendLens4` fold-final wrapper — is
generated as the POINT estimator behind an external view lift and renamed
`surfaceDECovered`; an appended `surfaceDE` wrapper owns the public name,
seeds `q0 = rotorInv(pIn, w0)` and `e = rotorInvWCol4() * sliceHalfW`, and
returns

```text
max(0, min_i DE_point(q0 + s_i e) - |e| / SLAB_COVER_PIECES)
```

with `s_i` the same equally spaced midpoints the CPU uses. Sampling in the
view frame and lifting per sample is exactly the CPU's attractor-frame
sampling (`rotorInv` is linear), and under a fold final the min over the
wrapper's branches commutes with the min over pieces, so the two engines
evaluate the same object. The hit-info twin runs the point VALUE descent at
each sample to find the argmin, then asks the covered hit-info once at the
winning sample, overwriting `sStar` with that piece's parameter so radius
and pattern coloring ride the slab location that actually won (the no-lens
pattern source is recomputed at the winning sample; a fold final keeps its
own resolved branch tuple). Zero thickness takes the point body, and the
`sliceHalfW == 0` rows are pinned BIT-EXACT against the `slabExt: false`
point kernel. The cutoff contract survives: each sample receives
`cutoff + halfPiece`. `packSurface4GpuParams` now throws only where the CPU
entries refuse (`slabSupported4`: swirl final or condensation), and the
app's `canSlab`/`slabCover` derivation comes from the same predicate.

**THE SHADING TAPS RIDE A ONE-PIECE COVER PROBE.** The first app-path
measurement (below) showed the 16-piece cover on every normal/AO/shadow tap
was the cost, not the march: shade mode under `slabCover` therefore emits a
dedicated `surfaceDEProbe` whose cover is a SINGLE piece,
`max(0, DE(mid) - |e|)`. That is still a sound lower bound over the whole
segment by the triangle inequality — deliberately loose — and it is the
same "never decides geometry" trade the measured width-1 frontier probe
already makes (`SURFACE_COMPUTE_SHADE_DE_WIDTH`). A frontier cover probes
its existing width-1 point body; the affine ladder probes the refined one.
This is the fix that took the fold-final class from unusable to shippable
(below); it changes lighting taps only, so the value/agreement rows above
are untouched.

`npm run bench:surface`'s M5b leg pins the mirror against the CPU oracle on
two fixture families at h = 0, 0.10R and 0.25R under two pose rotors: the
recursive spherefold pair (`fold4` core, plain oracle) and a mandelbox
FINAL over `pentatope` (`affine4` core under the lens, refined oracle, the
lens post included). Measured on real hardware (Intel Iris Xe, bundled
Chrome 151, 14 September 2026), 700 queries per row:

| Fixture           | h      | Core    | fail | maxAbsErr | p99AbsErr | excluded |
| ----------------- | ------ | ------- | ---: | --------: | --------: | -------: |
| cover4SpherePair  | 0      | fold4   |    0 |    3.5e-7 |    2.7e-7 |        0 |
| cover4SpherePair  | 0.10 R | fold4   |    0 |    3.8e-7 |    2.9e-7 |        0 |
| cover4SpherePair  | 0.25 R | fold4   |    0 |    3.4e-7 |    2.8e-7 |        0 |
| cover4MandelFinal | 0      | affine4 |    0 |    4.4e-7 |    3.1e-7 |        0 |
| cover4MandelFinal | 0.10 R | affine4 |    0 |    4.4e-7 |    3.4e-7 |        0 |
| cover4MandelFinal | 0.25 R | affine4 |    0 |    3.7e-7 |    2.6e-7 |        0 |

The per-row tolerance floor is `2e-4 R`, so the measured error sits about
three orders below it. The h=0 identity cross-checks report
`mismatches=0, maxDelta=0` for both families. The same run also exercised
the app's compute path end to end on ifs4/fold4 sessions (the cover pair
compiles; the h=0 frame picks the point kernel), and those compute-frame
rows passed. One negative result to disclose: every full bench run on this
machine ended in a `device-unreliable` verdict — three real-driver runs
lost the device at `compute frame swirl lens4SwirlPostOverFold`, an
untouched leg whose session compiles exactly as it did before this work,
and SwiftShader runs lost it earlier still (including a stashed, unmodified
baseline), so the crash is this machine's, not a cover result. The cover
rows above are recorded before the loss and the leg itself reported
`fail=0`/`excluded=0` in every run.

The per-ray cost is 16 point descents wherever the slab is live, plus the
hit-info attribution's 16-sample argmin per shaded hit. MEASURED IN THE APP
on the Iris Xe, 1024x640, through `scripts/surface-4d-lift.verify.mjs`'s
thickness phase, before and after the one-piece shading probe: with every
tap paying the full cover, a mandelbox FINAL over pentatope was still on its
first full-detail sample after 30 minutes (`?surfacesamples=1`, progress
92%) — hours for the default settle. With the probe, the same scene's point
entry settles in 6.5 s, ONE cover sample completes in 60.0 s, and the
default 8-sample settle completes (one run measured 1915 s, including a
~25-minute driver stall between passes 5 and 6; the samples that ran clean
were ~60 s each). The recursive spherefold pair settles comfortably either
way. The browser gate now loads both cover scenes with `surfacesamples=1`
(its own wall clock, disclosed in its header) and requires a COMPLETED
settle at the thicker view, so the fold-final class is gated end to end
rather than at preview level. The fence-cost gate now has a `--cover4` arm
and PASSED on a cover-live session (Iris Xe, Chrome, production build):
all 101 fence groups priced from the GPU instrument (`ts=on`, 0 wall), a
2.36 ms round-trip, the hit cap climbed 64 → 4096, 372 hits per hit
dispatch, settle frame 6450 ms — the 16x work changed constants, not the
ladder/fence shape. What remains on the cost front is the Firefox arm and
the teardown gate on a cover session: the Playwright Firefox build is not
installed on this machine, so those wait for a box that has it.

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
0.91-0.96. These are CPU card counts at one pose and thickness; the GPU
mirror's own agreement rows are in the next section, and its interactive
dispatch/watchdog behaviour on a cover-live session is still to be gated.

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

The CPU oracle and the WGSL mirror are complete and tested for the
nonlinear systems: exact segment arithmetic for affine/boxfold, the bounded
midpoint cover for spherefold and Mandelbox (recursive maps AND final
lenses) on both engines, bit-exact zero thickness on both, the cutoff
contract through the cover, and routing/UI that admits the combination.
What remains:

- **Cost qualification.** The shading-tap fix shipped (one-piece cover
  probe, measured above), and the fence-cost gate's `--cover4` arm PASSED
  on Chrome — ladder and grouping intact under the 16x work. Still owed:
  the same arm on Firefox and `scripts/surface-teardown.verify.mjs` on a
  cover session — both need a machine with the Playwright Firefox build.
  If those object, the remaining levers are quality/cost decisions, not
  soundness ones: fewer pieces (measured IoU 0.67-0.84 at 8), scale pieces
  with thickness, or the per-system thickness cap the earlier study
  discussed.
- **Tiling composition.** Tiled 4D sessions still clamp thickness to zero;
  finite pieces need the split/cover composition and lattice walls need
  crossing enumeration (the tiling child's work).
- **Browser matrix.** The lift gate now gates both cover classes end to
  end (enter, row enabled, invalidation, completed settle, draw) at
  `surfacesamples=1`. Still owed: several thicknesses and rotor poses,
  zero-thickness identity, authored radii/posts, reloads and captures on
  the engines, including the Mandelbox-plus-tiling acceptance case the
  epic names, plus panel-gate coverage for the new availability set.

CPU agreement and the heavy-class cost fix are done; the fence/teardown
gates and the full browser matrix are the halves still missing.
