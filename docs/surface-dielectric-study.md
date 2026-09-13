# Closed-solid dielectric experiment

The owner rejected the full-size layered/bent comparison on 13 September
2026: the images were indistinct, noisy and unconvincing as glass. The
[rejected GPU comparison](transmission-gpu-images.md) remains reproducible.
Faster execution did not fix its appearance.

This replacement experiment is confined to scripts. It tests whether actual
dielectric interfaces on explicitly closed finite fractal solids provide a
useful appearance in both 3D and a native 4D slice. It changes the optical
geometry as well as transport, so matching opaque views must accompany the
glass images. It does not interpret the public distance estimators as signed
interior distances or silently change an existing scene's geometry.

## Owner decision and continuation

On 13 September 2026, Chris Steinbach selected the completed finite-solid
3D/4D comparison below as the appearance to keep:

> Finally something interesting! Whether this comes close to real glass or not
> is immaterial. It looks good!

The selected model uses intrinsic dielectric refraction and reflection on the
finite Menger and posed hyper-Menger slice. Visible bending remains essential;
physical realism is no longer an acceptance requirement. This supersedes the
earlier layered-transparency selection, whose rendered result was rejected.

The [appearance record](../scripts/transmission-dielectric-appearance-review.json)
pins the source and both main PNG hashes listed below. The offline review only
shows this owner selection when those hashes match; future changed images do
not inherit it automatically. The existing images establish the visual target
for further performance work in both dimensions.

Appearance selection does not waive the previously chosen waiting-time,
128 MiB additional-state or correct-completion requirements. Preview speed,
responsive scheduling, peak allocation accounting, window/export invariants
and broader scene/pose coverage still need qualification before production
integration. Physical-realism comparisons and another aesthetic selection of
these same images are not prerequisites for that work.

This research checkpoint is in
[PR #412](https://github.com/ChrisSteinbach/fractal-viewer/pull/412), on
`research/surface-transmission-qualification`. It changes harnesses and
evidence, with no production renderer, panel or scene-document changes. The
comparison and all six target-size measurements are complete; their
reproduction commands and limitations are below. Remaining implementation
work is tracked in the project's issue tracker, rather than in a second
handoff task list.

## Current full-size result

The new [1024×1024 comparison](../scripts/out/transmission-dielectric-review.html)
contains one glass image per dimension and matching opaque controls. Every
row completes all 1,048,576 pixels and 4,194,304 samples without unresolved
or non-finite samples, traversal failures or resource caps. All twenty-two
current-source GPU controls pass on quiet RX 7900 XTX / Chromium hardware.

| Glass scene                 | Produce and save PNG | Tile submission/readback | Maximum omitted contribution per pixel | Known allocation plan |
| --------------------------- | -------------------: | -----------------------: | -------------------------------------: | --------------------: |
| 3D finite Menger            |             86.486 s |                 85.668 s |                         0.000973849907 |          78,603,932 B |
| Posed 4D hyper-Menger slice |             59.348 s |                 58.469 s |                         0.000970051391 |          78,651,190 B |

Both omitted-contribution maxima are below 1/1024 in the largest linear RGB
channel. This bounds discarded optical branches, not all floating-point or
antialiasing error. The practical timing starts immediately before the browser
render call and ends after return, decoding, PNG encoding and file write; it
excludes browser startup and later JSON checkpoint serialization. Each row
also runs the research controls. The allocation plan fits 128 MiB; browser,
driver-private and JS overhead are not measured as a total peak.

The source hash is
`81e436ecd7d0167048decf6de23ced1244e28bb2f76e64a473d50823223328a6`.
The complete report is
`scripts/out/transmission-dielectric-gpu/actual-1024x1024-all.json`.
The main PNG hashes are
`780aa05ecb45648659c3afb6768cc5c14454ea35df46752124082a3366906e62`
(3D) and
`c67a7cab367e6985c35010e30a3f24ae60d118f6476d158a2b7cd376aee8bc0c`
(4D). The opaque images complete with zero residual in 4.651 and 3.482
seconds respectively.

This delivers the owner-selected appearance and actual dielectric transport
on these two finite solids. General fractal coverage, interactive scheduling,
full application integration and production qualification remain outstanding.

## Selected desktop waiting targets

All six final-source stage measurements complete every sample with zero
unresolved rays, invalid samples or resource caps; all twenty-two GPU
controls pass. The practical time includes the browser render call, its
research controls, readback, return and PNG encoding/write. Browser startup
and later report serialization are excluded.

| Image size            | Selected target |         3D Menger |   Posed 4D slice |
| --------------------- | --------------: | ----------------: | ---------------: |
| 256×144 preview       |             1 s |  5.203 s — misses | 3.435 s — misses |
| 512×288 settled image |            10 s | 10.239 s — misses |  6.229 s — meets |
| 1920×1080 export      |           120 s | 101.601 s — meets | 68.406 s — meets |

The full-HD originals are available for
[3D](../scripts/out/transmission-dielectric-gpu/menger3-glass-1920x1080.png)
and [4D](../scripts/out/transmission-dielectric-gpu/hyper4-glass-1920x1080.png).
Their known allocation plans are 122,735,074 and 122,788,343 bytes, below
134,217,728 bytes. Driver-private, browser and JS overhead remain unmeasured;
this is not a certification of total peak process memory. Maximum omitted
per-pixel contributions are 0.000972737 and 0.000968995 respectively.

The renderer therefore meets the selected **export-time target for these
finite scenes**, while it fails the preview target in both dimensions and
the settled-image target in 3D. This is a no-go for claiming the complete
selected experience. Interactive responsiveness, total-state measurement,
window/export invariants and general fractal coverage still require separate
qualification. Maximum measured tile submission/readback spans reach
2.865 seconds in the full-HD 3D run; a completed image does not prove a
responsive application.

Individual records are
`scripts/out/transmission-dielectric-gpu/target-{256x144,512x288,1920x1080}-{menger,hyper4}-glass.json`.
They retain source hash
`81e436ecd7d0167048decf6de23ced1244e28bb2f76e64a473d50823223328a6`.
Reproduce with the same launcher, `--mode=glass`, the stated width/height and
`--fixture=menger3` or `--fixture=hyper4`; give each run its own `--output`
name to preserve the main comparison report.

## Why the previous model was insufficient

The previous bending model displaced the world-space ray origin sideways
while retaining its direction. It did query the procedural floor from that
displaced ray, so it could reveal newly exposed floor geometry. It did not
track entry into and exit from a refractive medium, or trace a reflected
scene. Its clearance-derived optical increments were not attenuation over
the distance travelled through a glass body. Its visible sampling sensitivity
and numerical refusals are recorded in the rejected comparison's documents.

Established dielectric implementations make those missing features explicit.
Mandelbulber's pinned
[ray recursion implementation](https://github.com/buddhi1980/mandelbulber2/blob/109fd69ae62f81ef199575d201a7f381fa5a5744/mandelbulber2/opencl/engines/ray_recursion.cl#L380-L490)
tracks the medium, refracts and reflects rays, and handles total internal
reflection. Its
[interior shading](https://github.com/buddhi1980/mandelbulber2/blob/109fd69ae62f81ef199575d201a7f381fa5a5744/mandelbulber2/opencl/engines/ray_recursion.cl#L855-L1005)
includes attenuation through the material. PBRT's
[dielectric model](https://pbr-book.org/4ed/Reflection_Models/Dielectric_BSDF)
provides the physical reference for Fresnel splitting and refraction.
These sources guide an independent implementation; they do not certify an
interior definition for this application's generic fractal estimators.

A concrete appearance reference is Krzysztof Marczak's
[Menger Sponge made of glass](https://www.deviantart.com/krzysztofmarczak/art/Menger-Sponge-made-of-glass-517763835).
The author describes a 1920×1080 Mandelbulber image using reflection,
refraction and two lights inside the fractal. This is an external visual
reference, not a matched scene, timing benchmark or asset used by the
experiment.

## Explicit geometry

The shared definition is
[`transmission-dielectric-solid.ts`](../scripts/transmission-dielectric-solid.ts).
Terminal cells are filled, and the union is closed. Both constructions split
each axis into thirds and retain a child when at most one coordinate is the
middle third at each level:

| Scene                   | Main depth | Children per level | Root half extent |
| ----------------------- | ---------: | -----------------: | ---------------: |
| Finite Menger, 3D       |          2 |                 20 |             0.75 |
| Finite hyper-Menger, 4D |          2 |                 48 |             0.75 |

The 3D normalization matches maps of scale 1/3 with offsets of 0 or ±0.5:
`H = H/3 + 0.5`, hence `H = 0.75`. Adjacent children touch. The hyper-Menger
uses the same normalization in four dimensions and is a new construction,
not the existing Mandelbox or Tesseract scene. Its displayed object is the
intersection of that 4D solid with a nonzero slice after rotations mixing
`xw` and `yw`. A connected 4D object need not have a connected 3D slice.
The initial depth-three full-tree candidate was too costly in the bounded
work study below. The next comparison explicitly uses coarser depth-two
geometry: 400 terminal cells in 3D and 2,304 in 4D, with nine cells across
each intrinsic axis. The image raster remains 1024×1024. Depth-zero boxes
provide simple controls; depth-three definitions remain available for the
detail and work studies.

Boundary queries traverse the finite ternary grid and report only transitions
between occupied and empty cells. Shared internal cell faces are suppressed.
The normal of a displayed 4D boundary is the normalized 3D part of the
corresponding world-to-intrinsic matrix row, with the outward sign. The normal
is therefore a normal of the displayed slice.

This is an exact finite-cell construction in real arithmetic, with explicit
floating-point limitations. Simultaneous crossings have a deterministic tie
rule; a corner does not possess a unique smooth surface normal. Positive
intervals are not deliberately merged by a world-space optical epsilon.
Boundary state and repeated-face handling must survive secondary rays; a
query failure is unresolved work and must not become a background hit.
Secondary rays carry the boundary's intrinsic intersection and the integer
planes of every exactly tied crossing. The next query uses that recorded
intersection and post-incident integer cell indices to choose its starting
cell. Uncrossed axes preserve their cell ownership when a secondary ray turns;
crossed axes choose ownership from the new direction. The outermost grid planes
are exactly the declared root endpoints in both arithmetic mirrors.
Re-transforming a rounded displayed
hit would lose the boundary identity and can immediately hit the same face
again. Tangent or otherwise ambiguous medium ownership must remain explicit.

## Transport and review contract

The new comparison must trace Snell refraction at entry and exit, Fresnel
reflection, total internal reflection and Beer attenuation over interior
path length. A clean procedural studio supplies large visible reflected
features and real rear geometry. Deterministic antialiasing avoids adding
Monte Carlo grain to the comparison.
Reflected rays query the fractal again, including reflections from an air-side
interface; sampling only the studio would omit reflections of other lobes.

Finite work is qualified by either exact completion or an explicit upper
bound on the omitted radiance. That bound must account for the sum of all
discarded branches and the maximum scene radiance. Interface, stack or
traversal exhaustion remains unresolved. A per-branch cutoff alone is not
a bound on the final image error.

The owner review requires actual images of at least 1024×1024 in both
dimensions, with matching opaque controls, natural-size original PNG links,
source and image hashes, and measured timing. Diagnostic images must not
overwrite the main review. GPU and host allocation categories must be
reported against the selected 128 MiB additional-state limit; driver-private
storage must not be labelled measured from a source-level allocation count.

The owner selected this experiment's appearance. Production material,
document, panel and renderer integration remain unqualified. Its finite depth,
altered geometry, precision, approximation and performance limits accompany
the images.

## Scalar controls

`transmission-dielectric-solid.harness.ts` passes eight tests. They check the
terminal-cell counts, the actual 3D Menger preset's depth-zero, two and three
construction, exhaustive depth-two ray intervals in both dimensions, touching
cells and positive gaps, inside rays, projected slice normals and corner
policy. The continuation controls preserve the authoritative intrinsic anchor
when the accompanying displayed hit is rounded to f32 or perturbed by one
ULP. Invalid anchor state, tangent ambiguity and traversal exhaustion refuse
explicitly. Independent Snell, total-internal-reflection, identity and Beer
controls cover the optical arithmetic. Exact tied-edge controls check the
reflected and transmitted medium ownership in both dimensions.

The depth-three solids contain 8,000 and 110,592 terminal cells, but the
renderer does not allocate a leaf list. A straight segment visits at most 79
finest-grid cells in 3D and 105 in 4D. These are boundary-query bounds, not
bounds on the number of reflected or refracted paths.

The posed 4D root slice's minimum displayed y is −0.8451981338. The studio
floor at −0.95 has 0.1048018662 clearance from the whole root slice and hence
from every retained cell. The generated scalar report records the complete
rotor rows and control inputs.

Reproduce the scalar controls with:

```bash
npx vitest run --config scripts/vitest.harness.config.ts scripts/transmission-dielectric-solid.harness.ts
```

Reports are written under `scripts/out/transmission-dielectric-solid-*.json`.
These checks establish the finite scalar construction; actual GPU agreement,
image completion, appearance and performance require their own evidence.

## Initial GPU and tree-cost result

The initial GPU baseline at `c23439f` passed all eleven current-source
physics/boundary controls on verified quiet RX 7900 XTX hardware. Its
64×64 Menger depth-three glass diagnostic correctly refused: 1,574 of 4,096
pixels contained unresolved work; 6,096 of 16,384 samples were unresolved.
The maximum recorded omitted-radiance bound was 3.99916744, against
0.0009765625. The initial failure counter combined traversal refusals and
path/interface/stack limits; it does not identify the cause of each failure.

The diagnostic's tile encode/submit/map wall time was 32.7 ms and its shader
pipeline setup was 225.8 ms. Its known cross-process allocation plan was
4,768,898 bytes. This is a capped diagnostic, not a complete image timing or
an achieved performance target. Its source hashes and full report are in
`scripts/out/transmission-dielectric-gpu/diagnostic-64x64-menger-glass.json`.

The scalar tree study found that ordinary depth-three rays required thousands
of reflected/refracted paths even before their summed discarded contribution
met the error limit. Raising the initial work guards alone could not qualify
them: the completed, uncapped samples still exceeded the residual limit.
Extrapolating that work from the capped GPU diagnostic suggests the finer
candidate is unlikely to meet the selected waiting target with this method;
no full-size depth-three performance result was measured.

The next experiment uses **depth-two residual replay**. Each sample first
traces with a radiance cutoff of `1 / (1024 * 64)`, sums the max-channel bound
of every discarded branch, and accepts only a finite, cap-free result whose
sum is at most `1/1024`. Otherwise it halves the cutoff and repeats. The
environment bound appears once in each branch bound. Fixed replay, path,
interface and live-stack guards remain unresolved outcomes.

The limit is on the **omitted contribution per pixel, in the largest linear
RGB channel**, after averaging the four sample bounds. It does not sum image
pixels together or change with raster dimensions. It also does not certify
floating-point intersection error, all antialiasing error, or appearance.
Image-wide totals are instruments, not additional error gates.

The executable scalar work record is
[`transmission-dielectric-tree.harness.ts`](../scripts/transmission-dielectric-tree.harness.ts).
Its four depth-two representative rays accept on replay indices 1, 2, 0
and 0 (Menger centre/lower, hyper-Menger centre/lower; index zero is the
initial cutoff). Three of the four depth-three representatives refuse under
the same replay guards; the fourth accepts at index three. This samples work
and residual accounting, not every pixel of either fixture.

```bash
npx vitest run --config scripts/vitest.harness.config.ts scripts/transmission-dielectric-tree.harness.ts
```

A subsequent 64×64 GPU diagnostic separated the initial refusal reasons.
It found no DDA traversal refusals, one sample with an unexpected inside
miss, 544 samples hitting the stack guard, 183 the interface guard and 6,095
the processed-path guard (categories overlap). The processed-path guard
dominates, but the inside miss remains a separate geometry investigation.
The report is
`scripts/out/transmission-dielectric-gpu/diagnostic-64x64-menger-glass-reasons.json`.

## Corrected depth-two diagnostic

The first depth-two replay exposed a concrete f32 boundary-state defect: an
uncrossed coordinate rounded onto a neighbouring cell's plane, and an outer
grid endpoint rounded beyond the root clipping extent. Preserving the recorded
cell indices and using the declared root endpoints removes those failures in
the repeated diagnostic. The scalar harness carries the reproduced witness;
the emitted GPU controls also check the otherwise inactive fourth cell lane
in 3D anchors.

The replay's live stack now has 24 entries. With maximum scene radiance 4,
the last cutoff is 2^-21. Processing the weaker child first permits at most
22 strict weak-child descents above that cutoff, requiring 23 live entries;
the allocation has one spare. Beer attenuation only reduces energy, and total
internal reflection produces one child. The scalar tree harness checks this
calculation.

On 13 September 2026, source hash
`6a5fddde72f233d9cd1582302c0ece31989b93d4e289e4b7738fdd9560584b1c`
passed all eleven GPU controls on quiet RX 7900 XTX hardware. Both corrected
64×64 diagnostics had zero traversal, unexpected inside-miss or stack
failures. Menger completed 4,092 of 4,096 pixels; four reached the 4,096-path
work guard. The posed 4D slice completed 4,070 pixels; 26 reached the
96-interface guard and five reached the path guard (categories overlap).
Accepted pixels had maximum omitted-contribution bounds of 0.000929913 and
0.000874657 respectively, below 1/1024. Those accepted-pixel bounds do not
qualify the incomplete images.

The two 64×32 tiles took 1.7412 seconds for Menger and 1.5931 seconds for the
4D slice, including all six replay submissions and readback. These remain
small, incomplete diagnostics. They neither demonstrate useful full-size
performance nor constitute an owner comparison. Reports are preserved as
`scripts/out/transmission-dielectric-gpu/diagnostic-64x64-d2-{menger,hyper4}-glass-anchor-cells-fixed.json`.

The scalar tree harness subsequently replayed the eight primary samples named
by those archived refusal witnesses. Raising the work guards to 16,384 paths
and 256 interfaces qualified all eight without a cap: the four Menger samples
needed 4,136–5,714 processed paths, and the four 4D samples needed at most
110 interfaces. This is evidence for the next guard setting, not a claim
that all full-image pixels complete.

The same harness tests a possible conservative tail certificate: omitted
radiance plus the full bound of every pending path must fit the error budget
before a resource-limited sample can be called bounded completion. At the
old guards, the four Menger witnesses retain far too much untraced energy;
three of four 4D interface witnesses can be bounded. The GPU experiment does
not use that certificate yet. Its work guards remain hard refusals; the
next calibration changes only their measured limits, keeping the error
budget and 24-entry stack.

The next 256×256 GPU calibration used those larger guards with 128×64 tiles.
Both scenes completed 65,535 of 65,536 pixels; each had one state-mismatch
refusal at an exactly tied pair of faces. There were no path, interface or
stack failures. Accepted-pixel bounds were 0.000958101 (3D) and 0.000948801
(4D). The tile encode/submit/map totals were 7.6888 and 3.9127 seconds, with
about 35.90 MB of known cross-process state. These are incomplete calibration
results from source `f6b884d22d8615e3b3ed6bbe3e02a8776d92a0f3e95b65f7042ec5b2cf9b258f`, not full-image qualifications. The reports
are `scripts/out/transmission-dielectric-gpu/calibration-256x256-d2-{menger,hyper4}-glass-guards16384-256.json`.

That calibration also exposed an image-export convention error: row zero of
a directly encoded PNG is the top, but the camera had mapped it to the bottom
of its image plane. Subsequent output uses positive camera-up at PNG row zero.
The archived witness studies preserve their original coordinate convention.
The launcher and page now default to 128×64 tiles; the former 256×144 default
exceeded the additional-state preflight at 1024×1024 with the enlarged path
state. The report declares the replay settings and derives its completion
and cap-free flags from actual counters.

## Exact corner convention

At a nonsmooth edge, choosing one of several exactly crossed facets can send
a reflected ray outside through another crossed facet while its medium state
still says inside. The 256×256 calibration caught this in both dimensions.
An edge has no unique physical surface normal, so the experiment defines its
convention explicitly.

For an exact tie, let S be the span of the crossed facets' displayed normals.
The effective normal is the normalized projection of the incident direction
onto S, oriented outward from the incident medium. Reflection reverses that
projection and preserves the tangent component orthogonal to S. Consequently
it reverses the direction across every tied facet. Snell transmission
preserves the crossing sign of every tied facet. This keeps both resulting
rays consistent with their declared media. Gram-Schmidt constructs the span
in ascending intrinsic-axis order; the original single chosen face remains
an attribution convention. Rank-zero or otherwise invalid geometry refuses.

This rule concerns exact arithmetic ties in the current numeric mirror. It
neither merges nearby crossings nor certifies that f32 and f64 classify every
near-corner event identically. It is a declared rendering convention for the
finite solid's singular edges, not a claim that those edges have a smooth
physical normal.

## Completed GPU calibration

Source `608266cf2ef2394ede22d9d5574eea3977be0cde6b38cf1ba4cb61c17b6dac02`
passes all seventeen current-source GPU controls, including both reproduced
corner normals and reflected/transmitted anchored continuations. With the
corrected corner rule and PNG orientation, both 256×256 calibrations complete
all 65,536 pixels and 262,144 samples without invalid samples, unresolved
rays, traversal failures or resource caps. The maximum per-pixel omitted
contribution is 0.000958100893 in 3D and 0.000948801287 in 4D, both below
1/1024. Known cross-process state is approximately 35.90 MB.

The 3D tile encode/submit/map total is 7.7985 seconds; the 4D total is
3.8933 seconds. Each uses eight 128×64 tiles and four samples per pixel.
Quiet per-process baselines and the non-fallback RX 7900 XTX adapter are
recorded in both reports:
`scripts/out/transmission-dielectric-gpu/calibration-256x256-d2-{menger,hyper4}-glass-corner-controls.json`.
These successful calibrations authorize attempting useful full-size images;
image appearance and full-size performance require those images themselves.

## First full-size attempt and remaining numerical cases

The same source produced actual 1024×1024 opaque and glass images in both
dimensions. Both opaque controls complete with zero residual. The first glass
attempt remains refused: Menger has three incomplete pixels (two anchor-input
failures and one interface limit), and the 4D slice has five (one anchor-input
failure and four interface limits). All other pixels meet the per-pixel bound;
there are no non-finite samples. The measured tile encode/submit/map totals
are 65.2538 seconds for 3D glass and 45.2327 seconds for 4D glass, with known
cross-process state approximately 78.60 and 78.65 MB. These figures describe
an incomplete full-size attempt, not completed performance targets.

Its report and all four PNGs are preserved in the source-hash snapshot under
`scripts/out/transmission-dielectric-gpu/snapshots/`. The full-size images
show crisp internal facets and reflected features, but the studio lighting
remains plain. No owner approval is inferred from that inspection.

The separate 256-interface guard can terminate weak reflected paths before
the total work budget is exhausted. Every interface already consumes a
processed path, so the next run uses the existing 16,384 processed-path limit
as the interface ceiling too. This does not increase the maximum whole-tree
work or the size of the path stack.

The anchor failures expose sensitivity to rounded plane and hit-point
reconstruction. The old `-H + i * (2H/N)` plane expression can produce
different rounded values when operations are fused; the observed coordinates
match that mechanism. WGSL explicitly permits
[reassociation and fusion](https://www.w3.org/TR/2026/CRD-WGSL-20260817/#reassociation-and-fusion).
The centred rational form `H * (2i - N) / N` removes that observed cancellation
site; it is not a portable proof of bitwise equality between evaluations.

The finite-precision continuation policy therefore treats integer plane and
cell identities as authoritative. Reconstruction is allowed only within
`2 * 2^-23 * H` of those identities, and greater inconsistencies refuse.
Masked coordinates are reconstructed from their integer planes. An unmasked
coordinate rounded beyond its cell within that allowance is placed on the
pending boundary without consuming the next cell transition. This is an
explicit numerical reconstruction allowance, not a bound on all accumulated
floating-point or optical error. It can affect events at the precision limit;
it does not authorize merging larger intervals or hiding a traversal failure.

## Reproduce the full-size comparison

The launcher establishes the X cookie, checks the real driver and records the
per-process quiet baseline before launching Chromium. Run without other local
test or rendering workloads:

```bash
node scripts/transmission-dielectric-gpu.mjs --display=:0 --width=1024 --height=1024 --tileWidth=128 --tileHeight=64 --output=actual-1024x1024-all.json
node scripts/transmission-dielectric-review.mjs
```

Each row writes its PNG and report checkpoint before the next row. The builder
checks source and PNG hashes, actual dimensions, every sample's completion,
residual accounting, GPU controls, quiet hardware and the known allocation
plan. It rejects diagnostic/calibration files as the main review and displays
1024-pixel originals in separate rows. Generated artifacts remain under
`scripts/out/`; regenerate them from the pushed branch.

## Validation and review status

The application suite passed 191 files / 7,611 tests and the production build
passed. The final scalar geometry/tree run passes 9/9 tests; current-source
emitted GPU controls pass 22/22. Scripts TypeScript, ESLint, formatting and
launcher syntax checks pass. Full repository lint also passes after the final
source changes. Browser QA of the completed review at 1440px
desktop width and 390px mobile width confirms natural 1024px main images on
desktop, working original-image links, bounded-completion labels, no console
errors and no horizontal overflow even with details expanded. That initial
QA preceded the owner decision; the review now records the selection only
for the matching source and main PNG hashes.

The comparison study is delivered and its appearance is selected by the
owner. Production qualification remains open under the measured limits above.
