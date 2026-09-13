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
intersection to choose its starting cell. Re-transforming a rounded displayed
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

This experiment is unreviewed. It cannot authorize production material,
document, panel or renderer integration. Its finite depth, altered geometry,
precision, approximation and performance limits must accompany the images.

## Scalar controls

`transmission-dielectric-solid.harness.ts` passes six tests. They check the
terminal-cell counts, the actual 3D Menger preset's depth-zero, two and three
construction, exhaustive depth-two ray intervals in both dimensions, touching
cells and positive gaps, inside rays, projected slice normals and corner
policy. The continuation controls preserve the authoritative intrinsic anchor
when the accompanying displayed hit is rounded to f32 or perturbed by one
ULP. Invalid anchor state, tangent ambiguity and traversal exhaustion refuse
explicitly. Independent Snell, total-internal-reflection, identity and Beer
controls cover the optical arithmetic.

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
