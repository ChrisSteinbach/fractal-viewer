# Surface transmission: what can actually look transparent?

Investigation, 12 September 2026. Application baseline:
`0f09a3f863d6a1bfa0bab5638690ccafe5417f38`. The executable experiment is
[`finish-transmission.harness.ts`](../scripts/finish-transmission.harness.ts).
This work changes no production renderer, finish bundle or scene document.

**Qualification update, 13 September 2026** (application base `3b5deaa`):
the [World bands study](#world-bands-the-candidate-definition)
now separates optical scale from display tolerance and compares an exact
finite solid in both dimensions. It still merges phase-sensitive gaps. The
[quiet real-GPU pilot](surface-transmission-feasibility.md) records a no-go
for direct generic integration: Menger exceeds the proposed preview budget,
and both native 4D rows fail strict boundary predicates. The [review outcome](#candidate-comparison-and-review-status)
now records an owner-selected research direction; production qualification
still requires rework under those targets.
The original investigation below remains the baseline evidence.

**Verdict:** the present finish fades toward the backdrop and cannot show
occluded geometry. Continuing through separated surface layers does reveal
it, in 3D and in posed 4D slices, without an image background. A distortion
of those rear layers gives the Menger a more glasslike appearance, but this
prototype does not establish a convincing general glass material or a cheap
production implementation. True refraction needs an explicitly defined
optical solid; it is not universally impossible for fractals.

## What the current finish does

`surface-finish.ts` emits the same finish body for both GLSL tracers and
the shared WGSL shade entry. Its last operation is, schematically:

```text
tau = transmit * (1 - Fresnel)
pixel = (1 - tau) * lit_front_surface + tau * pixel_backdrop
```

This blend happens after gamma encoding. The cinematic lighting path in
`surface-lighting-shader.ts` makes the corresponding blend in linear light.
Neither path resumes the ray, obtains a rear depth, samples another part of
the fractal, or refracts a ray. The floor can supply a reflected environment
in the ordinary finish, but the transmission term still receives the
backdrop, not a traced floor intersection.

The Translucent bundle in `ui.ts` sets `transmit = 0.35`, `specular = 1`,
`shininess = 128`, `reflect = 0.5`, and `metalness = 0`. Even head-on,
`tau = 0.35 * 0.96 = 0.336`: approximately two thirds of the original lit
front colour remains. Turning transmission up makes the surface disappear
toward its background; it cannot reveal something the renderer never read.
Changing the blend to linear light changes brightness, not that limitation.

Consequently, camera positioning cannot repair the current effect. It can
become useful composition once rear geometry participates in transmission.

## The geometry limitation, stated narrowly

These estimators do not share a signed interior-distance contract. Some
descent results are negative terminal certificates, so describing every
result as literally unsigned is also inaccurate. A negative lower bound
does not certify solid membership or distance to an exit. Forward estimators
have their own non-escape semantics and interior behaviour. Neither
`abs(DE)` nor negating the existing estimator manufactures the missing
contract.

An infinitely detailed IFS dust or gasket also does not, by itself, specify
a volume of glass, its thickness, or the scale at which its surface becomes
optically smooth. Those are modelling choices. An estimator's first-hit
tolerance already chooses a display surface, but that does not define an
optical medium throughout the object.

This is a reason to define a representation, not a theorem forbidding
refraction. A finite union of closed primitives, a finite signed fractal
construction, or an explicitly reconstructed solid can have both an inside
and an exit. Our emitter/shape subsystem already contains signed primitives;
that does not make arbitrary composed Surface scenes signed. A hybrid that
keeps the detailed visible surface but uses a smoother optical proxy is
another possible artistic choice. It describes a different optical object
and needs visual comparison before adoption.

Thin transparent sheets are useful without a volumetric interior. For
parallel thin interfaces the emerging direction is parallel to the incident
direction, so straight-through transmission has a legitimate optical model
as well as being a practical approximation. It still has to carry the light
behind the sheet. See PBRT's
[thin dielectric model](https://pbr-book.org/4ed/Reflection_Models/Dielectric_BSDF#ThinDielectricBSDF).

## What the linked projects actually implement

This is a source audit of the named revisions, not a runtime qualification
of those applications or every Fragmentarium fork.

| Project and inspected revision                            | Mechanism in the inspected source                                                                                                                                                                                                                                                                            | Relevance here                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IFSRenderer, `28846559376337646ade76cd081dd7904788d626`   | The compute kernel projects chaos-game points and accumulates colour/weight into a histogram; tone mapping follows. Its `de.frag.shader` means **density estimation**, a filter over that histogram.                                                                                                         | Its overlapping, luminous appearance is closer to our Flame mode. It supplies no general solid-interior or Surface-refraction algorithm.                                                                                                        |
| Fractaliz3r, `86cdb25e3d49c9b7f2535c505dfe9363eed00752`   | The glass path refracts at entry, advances with `abs(d)` through a presumed signed interior, detects positive `d`, and refracts at the exit. Its Menger is a finite signed box/cross construction. The glass path also contains approximations, including passing through on exit total internal reflection. | Evidence that finite fractal glass is possible, but not an exit finder that can be copied over our arbitrary lower bounds. Its separate subsurface term is a short inward-probe/backlighting approximation, suited to a waxy look.              |
| Fragmentarium, `f0ff279de356d8d429db98e038ad5e18d21e8945` | The bundled Kali `Xray_skifs.frag` keeps sampling along the ray and derives brightness from step count or distance statistics. It does not stop and shade only the first surface.                                                                                                                            | A direct precedent for a different visual mechanism: an X-ray appearance rather than a signed glass volume. Raw step-count brightness would depend on our estimator tightness and work budget, so it should not become our material definition. |

Sources:
[IFS accumulation](https://github.com/bezo97/IFSRenderer/blob/28846559376337646ade76cd081dd7904788d626/IFSEngine/Rendering/Shaders/ifs_kernel.comp.shader#L457-L468),
[IFS density filter](https://github.com/bezo97/IFSRenderer/blob/28846559376337646ade76cd081dd7904788d626/IFSEngine/Rendering/Shaders/de.frag.shader),
[Fractaliz3r glass](https://github.com/warnotte/Fractaliz3r/blob/86cdb25e3d49c9b7f2535c505dfe9363eed00752/src/main/resources/shaders/raytracer.glsl#L1448-L1518),
[its finite Menger](https://github.com/warnotte/Fractaliz3r/blob/86cdb25e3d49c9b7f2535c505dfe9363eed00752/src/main/resources/shaders/fractals/menger.glsl),
[Fragmentarium X-ray example](https://github.com/Syntopia/Fragmentarium/blob/f0ff279de356d8d429db98e038ad5e18d21e8945/Fragmentarium-Source/Examples/Kali%27s%20Creations/Xray_skifs.frag#L67-L127).

## Reproducible comparison

```bash
npx vitest run --config scripts/vitest.harness.config.ts scripts/finish-transmission.harness.ts --disableConsoleIntercept
```

Output, deliberately gitignored:

- `scripts/out/transmission-comparison.png`: five rows, six columns, with
  labels attached to the images.
- `scripts/out/transmission-control.png`: a hidden-object removal control.
- `scripts/out/transmission-report.json`: query counts, unresolved work and
  comparison metrics. Individual panels are `transmission-0.png`, etc.

Rows are the real Menger and Mandelbox estimators, the native Pentatope and
Tesseract estimators with nonzero XW rotation and off-centre W slices, and
a native 4D Mandelbox with a W translation, XW rotation and off-centre slice.
All optics operates in displayed 3D space; 4D queries inverse-rotate
`(x, y, z, w0)`. This follows the slice-then-operate rule. The sparse native
gasket/dust slices are retained rather than replaced with a flat lift to
make their pictures fuller.

The six columns are:

1. Opaque, with the bundle's other finish values.
2. The actual current `transmit = 0.35` finish.
3. The actual current finish at `transmit = 0.90`.
4. The same first-hit fade at 0.90, blended in linear light. This control
   separates a colour-space improvement from reading hidden geometry.
5. Repeated surface layers at 0.90, composited front to back in linear light.
6. The same layers with a cheap image-space distortion of the rear image.

Lighting and a smooth cyan-to-orange spatial colour field are held fixed.
The shading is the production CPU finish oracle. Fog, shadow and the
preview's step-count AO proxy are disabled to isolate transmission. The
backdrop is a dark two-stop gradient in every panel; there is no image
texture. These are CPU diagnostic images, not screenshots of a shipped
material, nor a complete lighting/transport implementation.

### How continuation works, and what it does not prove

Every pass uses the existing `renderPreview` marcher. At a previous hit,
its `march` hook samples forward in increments of half the current hit
tolerance until it sees `DE > 1.5 * tolerance`. It then re-arms ordinary
first-hit tracing. Each separated run contributes once, retaining Fresnel
and the local finish; the rear material may be opaque. On budget exhaustion
or a remaining active ray at the layer cap, the unresolved contribution
stays dark and is counted. It is never relabelled as an empty background.

This is a sampled appearance rule, not membership in the mathematical
attractor. It can merge thin gaps or miss sub-step runs; it has no certified
interior stride. Importantly, all appearance is independent of how many
samples were spent **within** one run: a constant zero plateau does not
receive another alpha contribution at every step.

The independent control is an unsigned-distance pair of overlapping
spheres, with an opaque orange rear sphere. Removing the hidden sphere
leaves the current finish's central RGB unchanged. With continuation,
removing it changes the central red channel by more than 80/255. Both
complete. A separate forced-exhaustion control checks the unresolved
channel. This proves actual rear-geometry dependence, not just a brighter
image after a blend change.

### How the distortion works

The first layer stays fixed. Subtracting its contribution from the completed
linear image yields a rear image. A virtual parallel slab with IOR 1.45
and thickness `0.08R` supplies a lateral offset for sampling that image.
The optical normal uses six DE probes at `0.04R`, independently of the
fine visible surface normal; this follows the coherence lesson of
[`finish-reflection.harness.ts`](../scripts/finish-reflection.harness.ts).
Offsets are bounded, and bilinear taps that are unavailable, unresolved,
or have a rear depth ahead of the current front hit fall back to the
undistorted pixel.

This is an intentionally synthetic slab, not a discovered exit surface.
It lacks refracted disocclusions, offscreen geometry, general nested
interfaces and an accurate varying-thickness volume. Small distortions can
be persuasive in a still, while strong ones expose the image-space
assumption. Wyman's
[refraction of nearby geometry](https://cwyman.org/papers/graphite05_InteractiveNearbyRefraction.pdf)
is a related primary reference for approximating refraction with rendered
depth/normal/image data; the experiment here is much simpler.

## Measurements and visual assessment

The main panels are 192 × 192, Node 22 CPU/f64. Query counts include all
primary/continuation marching and the ordinary four-tap normals. The
additional six optical-normal taps are counted separately. These are
algorithmic work counts, **not GPU slowdowns**: near-surface DE calls can
also be more expensive than the outside calls they replace. CPU wall times
are included in the generated report, not used to price a production frame.

| Fixture      | Front-hit pixels | Current DE calls | Layered DE calls | Query multiplier | Pixels with another hit | Most layers |
| ------------ | ---------------: | ---------------: | ---------------: | ---------------: | ----------------------: | ----------: |
| Menger 3D    |           23,000 |          428,297 |        4,910,808 |           11.47× |                  19,163 |          12 |
| Mandelbox 3D |           19,429 |          551,225 |        1,199,648 |            2.18× |                  10,522 |          14 |
| Pentatope 4D |            2,450 |          357,352 |          417,875 |            1.17× |                     329 |           3 |
| Tesseract 4D |            1,424 |          422,430 |          495,453 |            1.17× |                     752 |           6 |
| Mandelbox 4D |           11,311 |          987,661 |        1,757,349 |            1.78× |                   4,861 |           7 |

Every main layered panel completes within 32 layers and 1,200 steps per
pass/ray. Zero unresolved rays is a budget result, not a geometric proof
of the sampled continuation. The small full-frame overhead for the two
sparse 4D slices is partly their low screen coverage; it does not establish
that arbitrary 4D transparency is cheap.

The Menger's main layered run spends 3,697,982 calls just looking for
clearance. At 112 pixels it used 8 layers and 8.74× the first-hit query
count, against 12 layers and 11.47× at 192 pixels. More detail resolves
more material boundaries: a universal small layer cap, or opacity per
pixel-sized run without an optical-scale decision, will change the look
with resolution.

A separate 80-pixel scan check halves the clearance-scan increment and
doubles both budgets. Full-frame mean absolute RGB changes, in byte units,
are 0.891 for Menger, 2.092 for Mandelbox, 0.020 for Pentatope, 0.069 for
Tesseract and 0.518 for the 4D Mandelbox. All complete. These means can hide
larger local changes. An eight-layer cap leaves two Mandelbox rays
unresolved at that small resolution despite a nearly zero image mean
difference. This is why a picture-difference test alone cannot certify it.

My visual assessment: the layered Menger reveals a transparent internal
lattice. The slab warp gives it a stronger textured-glass/frosted-glass
cue. The Mandelbox improvements are less decisive, and the sparse 4D slices
provide little broad overlapping surface on which the illusion could read.
These are useful candidate looks, not owner approval or evidence that the
cheat generally goes unnoticed.

The warp adds 136,800 DE probes to the Menger, 2.79% of its layered-query
count, and moves the full-frame RGB by 7.310/255 on average. It falls back
on 3,562 pixels. On the 3D Mandelbox it moves only 1.283/255 and falls back
on 9,956 pixels: a concrete limitation of the simple rear-image lookup.
The equivalent mean changes on Pentatope, Tesseract and 4D Mandelbox are
0.184, 0.209 and 1.375/255. These are change measurements, not look scores.

## What is worth doing next

**The best near-term candidate is geometry-aware transmission with an
optional restrained optical distortion.** Start from the layered/warped
Menger comparison, not another change to the bundle's name or its backdrop
weight. Before production integration, decide whether that appearance is
worth pursuing and measure an optical scale that is stable across size,
zoom and motion. The present expensive sampled exit scan is not ready to
become the default inner loop.

There are three distinct development directions:

| Direction                                               | What it can deliver                                                                                            | Main unresolved work                                                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layered transmission, with a restrained rear-image warp | Real visibility of later fractal structure; an artistic clear or frosted appearance in favourable compositions | Stable optical scale, efficient run exits, transparent lighting, disocclusion and temporal tests                                                      |
| Finite optical solid or smoother proxy                  | Actual entry/exit refraction, thickness-dependent tint and potentially much stronger glass cues                | Define the solid and its interior oracle in 3D/4D; compare the shape change; retain total internal reflection and qualify the full secondary-ray cost |
| Scattering/backlighting or density rendering            | Wax, jade, frosted mineral, luminous/X-ray structures                                                          | Define attenuation independently of march step count; this will not produce recognisable sharp geometry seen through clear glass                      |

A bright image background is **helpful but optional**. What matters is
structured radiance to transmit or distort: rear fractal branches, mixed
opaque/transmissive regions, a procedural checker floor or studio panels
can all provide it. A uniform field offers few distortion cues, and making
every overlapping layer strongly attenuating rapidly hides the rear ones.
The sphere control demonstrates the no-image case directly. The existing
procedural floor is a particularly accessible candidate once transmission
actually intersects it.

Stochastic transmission could choose one surviving interaction per sample
instead of shading every layer. This may save shading and storage, but it
does not supply a missing exit/clearance oracle and would add convergence
noise. The existing eight AA passes are not evidence of adequate
transparency sampling. See NVIDIA's
[stochastic transparency research](https://research.nvidia.com/publication/2011-08_stochastic-transparency).

For an eventual implementation, both GLSL twins and the shared WGSL cores
belong in the same scope. The compute path needs resumable continuation
states, a throughput accumulator, per-layer hit/material attribution and
priced work batches; a long exit search must not be buried inside one shade
dispatch. Fragment variants need their link/strip costs re-measured. Every
query must see the public displayed object, including the rotor/slice,
lenses, Balloon and tiling, within their existing applicability contracts.
No frozen params or material lane should be reused for an optical setting.

The release evidence would include hidden-object removal and opaque limits,
thin-gap and filled-interior adversaries, background/floor transmission,
shadow consistency, camera/rotor/slice motion, preview/settle and export
agreement, capture-band seams for any image-space warp, cancellation and
real-driver cost in both dimensions. This experiment qualifies none of
those production paths. In particular, the sampled alpha bands and the
material's optical behaviour cannot silently change with export resolution.

## Finite-solid comparison oracle

`scripts/transmission-proxy.ts` supplies an explicitly different optical
object for the next comparison: the depth-2 Menger construction is a union
of 400 closed cubes, and the depth-2 native Tesseract construction is a
union of 256 closed hypercubes. The starting half-sides are 0.75 and 0.65,
respectively, and each construction step applies the real preset's maps
at scale 1/3. Filling those terminal cells removes all finer fractal gaps.
This is a bounded research control, not a new application solid mode.

The 4D control inverse-rotates the displayed ray through XW by 0.35 radians
at the off-centre slice `w = 0.2`. Intersecting the ray with all four box
inequalities supplies actual entry/exit intervals of the sliced solid.
Their sorted union merges overlapping or touching intervals and retains
positive gaps without a material epsilon. Direct box membership is checked
independently of the interval oracle. The signed box-distance union is only
a shading/trace bound; its 4D restriction is not claimed to be the exact
Euclidean distance within the 3D slice. Neither oracle infers membership
from the production estimators.

Reproduce the initial oracle controls with:

```bash
npx vitest run --config scripts/vitest.harness.config.ts scripts/transmission-proxy.harness.ts
```

The controls cover overlapping components, a 0.00001-wide gap, a ray
starting inside, a filled rotated 4D slice, and direct membership checks
along rays through both finite constructions. These checks establish the
comparison geometry; they are not an appearance or performance decision.

## World bands: the candidate definition

The **World bands** experiment gives optical events their own scale. The
definition is shared by `transmission-study.ts` and the GPU pilot through
`transmission-gpu-contract.ts`; it is deliberately an appearance rule, not
a reconstructed glass volume.

`R` is the full scene ball used by the public estimator. For native 4D it
is the full unsliced radius, held fixed while the rotor and slice change.
The displayed 3D ray is evaluated after the same inverse rotor/slice lift
as the visible object. The optical domain is the half-open interval within
that ball, sampled from its analytic entry at spacing `delta = 0.001R`.
Integer sample indices survive scheduling changes. Neither viewport size,
zoom, the preview's display tolerance, nor the work chunk chooses this grid.

An accepted event occurs at the first sample with `DE <= 0.002R`. It
contributes once; subsequent samples do not add optical density until a
sample with `DE > 0.003R` re-arms event detection. The next accepted run can
then contribute. These are clearance thresholds, **not a physical thickness
or a generic inside/outside test**. A loose inverse bound can enlarge the
accepted band, and the escape estimator remains heuristic. Even a very
small or negative estimate does not authorize a jump through an interior.

Each appearance event has throughput `transmit * (1 - Fresnel)`, using
a six-query normal at radius `0.03R`, independent of the preview's visible
normal. At normal incidence with transmit 0.9 this is 0.864. Layers compose
in linear light. The GPU work pilot uses the simpler fixed 0.9 throughput
per event and reports normal/shading work separately as unimplemented;
that number is not a second proposed material default.

Completed sampling of the declared ball, an opaque stop, a separately
declared residual cutoff, and unfinished work are distinct outcomes. The
default residual cutoff is zero. Exhausted chunks resume; an exhausted
total budget or layer cap retains a dark unresolved remainder. Completing
the clipped sampled domain does not establish an unknown solid's physical
exit outside that domain. The original pixel-tolerance prototype and old
0.35/0.90 backdrop fades remain executable controls.

### A gap adversary that world scale does not solve

```bash
npx vitest run --config scripts/vitest.harness.config.ts scripts/transmission-gap.harness.ts --disableConsoleIntercept
```

Two finite boxes have two exact analytic intervals for every positive gap.
The sampled appearance intentionally merges sufficiently small gaps: with
the stated thresholds, an exact-distance gap must exceed `0.006R` to have
any point farther than the re-arm threshold from both faces. Sampling adds
an ambiguity region above that threshold. The native 4D version uses posed
hypercubes and an off-centre slice, with the same result.

| Gap        | Grid phase | Exact solid intervals | Appearance events | Remaining optical throughput |
| ---------- | ---------: | --------------------: | ----------------: | ---------------------------: |
| `0.004R`   |   0 or 0.5 |                     2 |                 1 |                        0.864 |
| `0.00625R` |          0 |                     2 |                 2 |                     0.746496 |
| `0.00625R` |        0.5 |                     2 |                 1 |                        0.864 |
| `0.008R`   |   0 or 0.5 |                     2 |                 2 |                     0.746496 |

These results are measured identically in 3D and posed 4D. The phase change
is half one scan step. It demonstrates an optical change during small
relative motion even though resolution no longer defines the layer scale.
The boundary case must remain visible in the recommendation; a fixed world
scale alone is not evidence of stable glass. A constant low-field control
also confirms one contribution throughout a plateau, exact completed
results with work chunks of 7 and 503 samples, and a distinct unresolved
result when the total work is deliberately cut short.

## World-scale stills, resolution and motion

The completed comparison uses 48px square world panels, the original 192px
controls, an 80px finite-solid comparison, and separate 48px camera / 64px
native 4D motion. Contact-sheet enlargement adds no detail. These are
bounded appearance studies, not production-resolution quality certificates.
Default native 4D `(XW angle, slice)` pairs are Pentatope `(0.48, -0.1)`,
Tesseract `(0.35, 0.2)`, 16-cell `(0.43, 0.14)` and Mandelbox `(0.35, 0.3)`.
The escape4 fixture has a genuinely non-flat map (`w` scale 2, translation 0.12).

At 48px, the same-raster pixel and world comparisons give:

| Fixture          | World coverage | Maximum events, pixel / world | World calls per covered ray | Worst ray work | Unresolved at 32 / 64 events |
| ---------------- | -------------: | ----------------------------: | --------------------------: | -------------: | ---------------------------: |
| Menger 3D        |         61.98% |                        5 / 19 |                       2,236 |          2,125 |                        0 / 0 |
| Mandelbox 3D     |         57.47% |                        8 / 43 |                       2,265 |          2,412 |                       21 / 0 |
| Pentatope 4D     |          3.78% |                         3 / 2 |                      36,322 |          2,011 |                        0 / 0 |
| Tesseract 4D     |          2.52% |                         4 / 4 |                      54,483 |          2,000 |                        0 / 0 |
| 16-cell flake 4D |          2.95% |                         3 / 3 |                      46,468 |          2,028 |                        0 / 0 |
| Mandelbox 4D     |         33.25% |                        5 / 11 |                       3,743 |          2,094 |                        0 / 0 |

The call denominator includes all sampled rays, divided by those with an
event. It exposes the cost of sparse coverage; it does not mean each covered
ray individually made that many queries. The call column includes both
normal estimators but excludes attribution operations and the optional warp.
Worst-ray work counts those operations too; the warp adds six queries per
covered ray.
CPU wall times were not measured in an exclusive machine window and are not
release-performance evidence.

For Menger, the 3,192,994 counted calls divide into 1,489,348 first-trace,
455,638 run-clearance, 1,155,098 later-trace, 37,164 display-normal and
55,746 optical-normal calls. Another 9,291 event-attribution operations and
8,568 optional warp queries are reported separately. The fixed lattice supplies
all three trace phases. It deliberately makes no supposedly safe DE jump
through a run. The finite-solid control instead jumps to independently
computed interval boundaries; its different object is disclosed below.

The scale controls retain adverse results. Linear-light downsampling of the
96px Menger to 48px differs from native 48px by 14.249/255 mean byte value;
1,445 of 2,304 pixels differ by more than two in some channel. These rasters
sample different rays, so this is spatial aliasing evidence, not a test of
identical-ray event invariance. On the **same** 48px rays, shifting the grid
by `0.0005R` changes 138 event counts and the image by 3.422/255. Changing
the optical-normal radius from `0.02R` to `0.04R` changes it by 8.622/255.
The zoom control changes 0.36 to 0.27 with all optical scales fixed.

Independent controls do compare identical rays: odd 63/95px centre rays
retain two events through a transparent front and an opaque rear, versus
one event and throughput 0.864 with the rear absent. Chunk sizes 1, 7 and
1,200 preserve event and throughput arrays on the hidden-object/native
escape4 controls. The invariant sheet also covers native affine 4D and
power-of-two scene scaling, with throughput agreement within `1e-12`.
Exact-cap and tangent controls exclude a sample at the ball's far endpoint.
An earlier inclusive count was corrected; an interval-count audit of all
37 published visual grids (169,216 rays, phases 0 and 0.5) found zero
changed sample counts, so that correction leaves the cited images unchanged.

The close native Mandelbox is the useful higher-coverage 4D composition;
the three sparse affine views remain counterexamples. Its motion camera is
`R * (0.55, 0.35, 2.2)`, zoom 0.22. One sequence varies only XW angle
0.27–0.43 at slice 0.30; another varies only slice 0.18–0.42 at angle 0.35.
The 3D sequence varies the Menger camera, with exact five-frame poses in
`transmission-motion.harness.ts` and its JSON report.

| Sequence                  | Coverage across frames | Warp fallback among covered rays | Unresolved rays |
| ------------------------- | ---------------------: | -------------------------------: | --------------: |
| Menger camera             |           59.68–62.89% |                     31.85–46.72% |               0 |
| Native Mandelbox XW rotor |           54.71–69.34% |                     27.37–32.66% |               0 |
| Native Mandelbox slice    |           62.04–65.14% |                     27.18–32.74% |               0 |

Straight layers expose internal/rear structure, while the warp visibly
softens and shifts it. However, the warp only reuses existing screen-space
rear samples. It cannot supply newly disoccluded geometry; its rejection
guard returns the straight result at the rates above. The small grid-phase
adversary separately proves opacity instability. Raw adjacent-frame image
deltas also contain intended object motion, so they are not a measured
motion-compensated boiling score. These sequences support rejecting the
current warp as a required production feature, not a claim of artifact-free
glass. Halos and front-surface weight remain visible review concerns.

## Finite-solid appearance and its cost

The finite comparison uses one finish contribution at each exact union
interval's entry and straight Beer attenuation
`exp(-0.8 * intervalLength / R)`. A zero-absorption control separates path
length from interface weighting. This is **not a complete dielectric**:
it has no exit-interface Fresnel/shading or refracted ray. Its actual
inside/exit oracle permits bounded work without inventing generic DE
membership, but filling the terminal cells visibly changes the object.

| Finite object, 80px      | Terminal cell side | Maximum intervals | Mean path length / R | Box intersections per frame | Opaque public/proxy image difference |
| ------------------------ | -----------------: | ----------------: | -------------------: | --------------------------: | -----------------------------------: |
| 400-cell Menger          |           0.166667 |                 8 |              0.42526 |                   2,560,000 |                            8.182/255 |
| 256-cell posed Tesseract |           0.144444 |                 4 |              0.14495 |                   1,638,400 |                            2.141/255 |

Every ray intersects every finite box once; this is a bounded brute-force
comparison, not a claimed production accelerator. Both rows complete with
zero unresolved intervals. Their finite/full-public radii are
1.29904/1.34174 and 1.30000/1.34942, respectively. Absorption changes the
two images by 6.437/255 and 0.187/255. The small Tesseract whole-frame
difference reflects its sparse composition and does not establish a small
shape error where geometry is present.

The procedural checker floor lies at `y = -1.05R`, below the entire scene
ball, with quarter-radius squares and fixed illumination. For rays visiting
the ball it is behind the optical domain. The companion uniform sky uses
no image texture. Independent 3D and posed 4D finite-box centre-ray tests
show floor/sky changes through transmission and exact equality in the
opaque limit. Whole-frame floor differences include the exposed background
and are not used as evidence of rear visibility by themselves.

## Candidate comparison and review status

| Named candidate                   | What it supplies                                   | Qualification outcome                                                                                         |
| --------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Current fade / linear fade        | Front surface blended with backdrop                | Retained controls; cannot reveal hidden geometry.                                                             |
| Pixel bands                       | Rear geometry from pixel-scale accepted runs       | Rejected as an optical definition: raster tolerance changes material.                                         |
| World bands, straight             | Rear geometry at declared world clearance scale    | Executable research candidate; gap phase and real-GPU cost/agreement prevent generic integration.             |
| World bands + virtual slab warp   | Distorted already-rendered rear samples            | Optional experiment only; frequent fallback and missing disocclusions prevent requiring it.                   |
| Finite cells with path absorption | Exact closed-cell intervals and actual path length | Valid bounded alternative with visibly coarser geometry; neither full refraction nor a qualified replacement. |

The recommendation is **no-go for direct generic World bands production
integration**. Retain the straight variant as the reference for further
model work. The tested optical tuple is entry `0.002R`, re-arm `0.003R`,
spacing `0.001R`, transmit 0.9, normal radius `0.03R`; the explored normal
range is `0.02–0.04R`. Grid phase 0–0.5 is an adversary, not an authoring
control. The optional warp uses experimental IOR 1.45, slab `0.08R` and
image offset cap 0.04. There is **no qualified production parameter range**
from these measurements. Larger bands or strides would change the object
and require another appearance study; they are not exit optimizations.

The [feasibility record](surface-transmission-feasibility.md) supplies the
named device/browser, actual raster and proposed latency/memory limits.
It is an intentionally failed qualification: Menger's kernel alone takes
1.214 seconds at 256 × 144, and native affine4/escape4 each have a strict
near-boundary predicate flip. No production capability is unlocked.

**Owner outcome, 13 September 2026: research direction selected;
production qualification requires rework.** Chris Steinbach explicitly chose
layered transparency that preserves fractal detail and reveals internal/rear
geometry in both 3D and 4D. Visible bending is **essential**, rather than an
optional enhancement. The finite-cell glass direction was not selected.

For the next desktop feasibility study on the measured RX 7900 XTX/Chromium
setup, the selected waiting-time targets are:

| Stage                   |                                  Selected research target |
| ----------------------- | --------------------------------------------------------: |
| 256 × 144 preview       |                                                    <= 1 s |
| 512 × 288 settled image |                                                   <= 10 s |
| 1920 × 1080 export      |                                                  <= 120 s |
| Additional state        |                                                <= 128 MiB |
| Completion              | Correct completion; no exhaustion presented as background |

These answers select the next experiment, not the current failed prototype
for production. The original measured rows above retain their original
250ms/2s/30s comparison in the feasibility record; accepting slower targets
does not repair the gap-phase or 4D agreement failures. The research inputs
offered for this choice were the review package at repository revision
`f59d978d3030148cf46a8469313ba716759c00f5`, with its source/artifact manifest.
The conversation records the three explicit answers; it does not establish
that every image in that package was inspected.

The next study will compare a smooth, fractional layer-opacity rule and
actual world-space displaced-ray queries against the existing hard bands
and screen-space warp. It must retain the fine object, reveal newly visible
rear geometry, carry both dimensions, and price real continuation work.
Production integration remains blocked until that revised evidence qualifies
and the resulting appearance is selected for release.

## Reproduce the qualification package

Run CPU artifacts separately from the real-driver timing window:

```bash
TRANSMISSION_WORLD_SIZE=48 TRANSMISSION_PROXY_SIZE=80 \
npx vitest run --config scripts/vitest.harness.config.ts \
  scripts/finish-transmission.harness.ts scripts/transmission-proxy-visual.harness.ts \
  scripts/transmission-motion.harness.ts --disableConsoleIntercept
npx vitest run --config scripts/vitest.harness.config.ts \
  scripts/transmission-proxy.harness.ts scripts/transmission-gap.harness.ts \
  scripts/transmission-invariant.harness.ts scripts/transmission-gpu-contract.harness.ts
```

After the two GPU commands in the feasibility record, build the offline
review with `node scripts/transmission-review.mjs`. Open
`scripts/out/transmission-review.html`; it links the original control sheet,
same-size straight/warped pairs, scale controls, finite comparison, reports
and the camera/rotor/slice player. The images, reports and manifest remain
under ignored `scripts/out/`; all generating sources are versioned.
