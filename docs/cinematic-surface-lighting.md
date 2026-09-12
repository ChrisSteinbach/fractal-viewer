# Cinematic Surface lighting

## THE PARTICIPATING MEDIUM WAS REMOVED — 10 September 2026

**Everything below this section describes a feature that shipped with a
bounded homogeneous medium. It no longer has one.** The medium was deleted
outright — schema, `ShadeParams` lanes, both shader emitters, the compute
renderer's per-cell dispatch sweep, the panel controls, the CPU reference's
scattering half and its gates. `SURFACE_GPU_SHADE_LIGHTING_BYTES` is 384
rather than 432, and the lane count is nine rather than twelve. The rest of
the record is kept as written: the transport was correct, and what it cost is
the reason it went.

WHY, measured on a real AMD RX 7900 XTX, production build:

| Cathedral, 1920x1057, WebGPU compute | Progress                                                            |
| ------------------------------------ | ------------------------------------------------------------------- |
| as authored (mist density 0.42)      | 3.4% at 10 s, 9.5% at 5 min of the whole job — still in pass 1 of 8 |
| mist density 0                       | complete 8-pass settle in 130 s                                     |

That is the whole feature's cost in one line: everything except the medium
settles a full pane in a bit over two minutes, and the medium alone turns
that into hours. It matches this file's own earlier arithmetic — 95% of GPU
time in the medium at 64 px, ~26 h per pane settle before the dispatch-width
fix and ~59 min after it — and it is why "Lights + mist" could never be
judged in a browser. The owner's call was that a feature that renders only
postage stamps is not a feature.

WHAT A FUTURE MEDIUM WOULD HAVE TO DO DIFFERENTLY. The cost was never the
transport arithmetic; it was that every shaded terminal paid a full
32-cell x 2-light sweep of nested visibility marches before any pixel
finished. Three things were identified and none were built: give the medium
its own progressive dimension over already-shaded terminals (so a usable
frame appears first and the air refines into it); render it at quarter
resolution and upsample bilaterally, since the field is smooth and
low-frequency; and take a few jittered cells per pass instead of 32,
averaged across the eight antialiasing passes the renderer already runs.
Together those are plausibly two orders of magnitude on the one term that
costs everything. That was written unmeasured; the next section measures it,
and corrects two things the paragraphs above got wrong.

WHAT SURVIVED. Authored disk lights, their soft shadows, the ambient and
material defaults, the per-transform finishes, the HDR pipeline, both
engines, both dimensions, and the two starting compositions — which now
render without the mist they were composed around, and therefore owe a fresh
aesthetic judgement (see `surface-lighting-starters.ts`). A saved scene or
link written while the medium existed still opens: `persist.ts` ignores a
`medium` block rather than rejecting the rig.

## The medium reconsidered on arithmetic — 11 September 2026

The question: does the fence round-trip work (the calibrated-fence
subtraction, per-group fencing) make the medium affordable, and which of the
three techniques above actually pays? To answer it on the real thing rather
than a prototype, the removal was reverted onto current main on an
experiment branch, `experiment/medium-cost`, and never merged. The medium's
dispatches ride main's shared fence groups (at most two dispatches per
group), with a lane of their own in the `?surfacetrace` tally. Three
measurement-only page-load levers were added:

- `?surfacemediumcells=N` — N medium cells per antialiasing pass. An S-pass
  job cuts each camera segment into N·S strata and pass k visits strata
  `j·S + k`, so the job samples N·S distinct cells and each pass spans the
  whole segment. In-scatter is scaled by S, so the job average stays an
  unbiased estimate.
- `?surfacemediumstride=K` — after phase-0 shading, the medium sweep runs only
  for full-image pixels with `x%K == 0 && y%K == 0`. This is the COST side of
  a 1/K² medium raster; nothing is upsampled.
- `?surfacelitceiling=N` — replaces the lit ray ladder's 4096-ray CEILING. The
  ladder still paces by its 50 ms time target.

The driver is `scripts/medium-cost.measure.mjs` on that branch. If the branch
is gone, the levers above are its whole delta over a plain revert of the
removal. ALL ROWS: real AMD RX 7900 XTX (WebGPU adapter `amd rdna-3`), Chrome,
the cathedral starter, a 1920x1057 pane = 2,029,440 rays per settle frame,
compute engine, 8 samples, camera parked. Firefox was not measured.

THE PROGRESS ROW WAS MISREAD, BY A FACTOR OF EIGHT. Its percentage spans the
whole supersampled job (`done / total` in `main.ts`, unchanged since the
removal), so "9.5% at 5 min" meant about three-quarters of pass 1, not a
tenth of it. Re-measured, the authored pass 1 took 501 s. The gap that
justified the removal was therefore ~20–25x per settle, not ~190x.

At the SHIPPED lit ceiling:

| Run                             | Settle (8 passes)   |
| ------------------------------- | ------------------- |
| mist density 0                  | 118.7 s, 118.8 s    |
| authored (32 cells/pass)        | pass 1 alone 501 s  |
| 1 cell/pass                     | 223.8 s             |
| 4 cells/pass                    | pass 1 alone 78.3 s |
| 1 cell/pass, 1/4 medium raster  | 219.8 s             |
| 1 cell/pass, 1/16 medium raster | 209.4 s, 209.6 s    |

- THE FENCE WORK DOES NOT BUY IT. The medium lane's fence share was 15% of its
  wall authored and 13% at one cell. Fences were never the term that
  mattered.
- COST IS LINEAR IN CELLS: 4.1 / 4.7 / 5.0 s of medium wall per (cell, light)
  sweep at 1 / 4 / 32 cells in pass 1.
- COST IS NOT LINEAR IN RASTER. Populations of 16 : 4 : 1 gave 79.0 : 69.9 :
  59.2 s of medium wall. A dispatch cost about as much as its slowest
  invocation — 9.9 / 8.8 / 7.5 ms at 4096 / 1022 / 257 rays — and the dispatch
  COUNT is 2 lights × cells × the phase-0 lit batches (~497 per pass),
  whatever the stride.
- The phase-0 batch width sat at the 4096 ceiling in 3,970 of 3,976 steps, at
  ~15–25 ms per dispatch against its own 50 ms target. The ceiling, not the
  time target, was binding.

With the ceiling lifted (`?surfacelitceiling`):

| Run                             | Settle        | vs mist off |
| ------------------------------- | ------------- | ----------- |
| mist density 0, ceiling 65536   | 21.52 s       | 1.00x       |
| 1 cell/pass, ceiling 16384      | 67.60 s       | 3.14x       |
| 1 cell/pass, ceiling 65536      | 33.45 s       | 1.55x       |
| 1 cell/pass, 1/16 raster, 65536 | 32.57 s       | 1.51x       |
| authored, ceiling 65536         | pass 1 99.6 s | 15.1x       |

The mist-free frame is BYTE-IDENTICAL to the shipped-ceiling one (maximum
difference 0, identical coverage census), and so is the one-cell frame.
Width is scheduling. Raised, the ladder stops at 49.7–50.0k rays, bound by
the 50 ms target on phase-0 cost; the worst single dispatch was 67 ms. A
medium dispatch stayed at 9–12 ms from 257 rays up to 50k. The 4096 had no
stated derivation: it arrived with the lighting integration as a fixed
conservative width, copied from the unlit shade batch's number. It throttles
every lit compute settle on this hardware, mist or not, and lifting it is
separate work that must be verified on Iris (the i915 watchdog) and on
Firefox (the staging-volume ceiling) first.

WHAT THAT SAYS ABOUT THE THREE TECHNIQUES:

1. A progressive dimension of the medium's own is the PREREQUISITE for the
   other two, not a parallel option. Medium dispatches stay nearly flat in
   cost out to 50k rays, while phase 0 saturates there. A medium tied to
   phase-0 batches therefore pays per BATCH, and shrinking its population
   shrinks only the width. Not built. The reverted frame-wide sweep's warning
   (per-dispatch active-list re-aiming, the base offset the frozen run
   params lack) still applies to building it.
2. A quarter-resolution medium is REFUTED as a lever while that coupling
   stands: 1/16 of the rays saved 3% with the ceiling lifted and 14% without
   it.
3. A few cells per pass, averaged over the antialiasing passes, WORKS and is
   linear. It is the interleaved schedule `?surfacemediumcells` implements.

4D, at the shipped ceiling only (`simpleFourD` fixture, same pane): mist-free
was capped at 1200 s with 6 of 8 passes (pass 1 264 s, then ~175 s each);
1 cell/pass with a 1/16 medium raster completed 7 of 8 (~151–162 s each, 13–24
s of medium wall per pass). That fixture's lit batches are TIME-bound at
~240 rays, so the ceiling never binds in 4D. There the surface itself is the
expensive term and a one-cell medium is ~10% on top. Its faster passes are a
batching side effect (misses pad the lit batches), not a free medium.

THE LOOK is now the open question, and it is the owner's call. With the
ceiling lifted, the interleaved schedule settled the pane in:

- 33.45 s (1.55x) at 8 strata — 1 cell per pass;
- 62.1 s (2.9x) at 32 strata — 4 cells per pass;
- 99.9 s (4.6x) at 64 strata — 8 cells per pass.

Against the 64-strata frame, 8 strata differ by 1.33/255 on average, with 4.0%
of pixels beyond 4/255; 32 strata differ by 0.66/255, with 1.6%. The
mist-free frame differs by 16/255 over 72% of pixels, so the mist is most of
the composition. At 1:1 the remaining error is GRAIN, with no banding: 8
strata is visibly speckled, 32 grainy, and 64 smoother but still grainy.

The authored 256 strata (32 cells per pass) did not settle at the lifted
ceiling. The device was LOST at 182 s, in pass 5, and the kernel logged an
amdgpu `ring gfx_0.0.0 timeout` — AMD's counterpart of the i915 watchdog. Its
first pass alone had completed with a worst traced dispatch of 40 ms, so the
traced dispatch time does not bound what the driver's job timeout sees. THAT
GAP IS NOW EXPLAINED: an instrument built on fences records only the
submissions that RESOLVE, so 40 ms was a statement about the survivors, and a
single driver job on this machine is cut at ~2.0 s. "What the driver's job
timeout actually bounds" in `docs/surface-compute-renderer.md` carries the
measurement and `scripts/webgpu-job-watchdog.repro.mjs` reproduces it. What
remains unknown is WHICH dispatch in that settle was the long one — the
renderer had no submit-time instrument to name it. It has one now, and the
attempt to use it did not find the culprit, because THE LOSS DID NOT
REPRODUCE.

MEASURED 12 September 2026, same machine, same levers, same cathedral at
1920x1057, with the submit-time line added on top of the experiment branch:
THREE runs out of THREE SETTLED — 327.7 s, 329.2 s and 328.0 s, all eight
passes, ~22,200 medium dispatches apiece, and NOT ONE amdgpu ring reset. So
the authored 32 cells per pass at the lifted ceiling is not, by itself, a
configuration that loses the device.

AND NOTHING IN THOSE SETTLES COMES NEAR THE DEADLINE. Across a whole
settle's 11,475 fence groups the widest MEASURED interval was 76.6 ms and
the widest single submission of any kind was a 245 ms present readback —
26x and 8x under the ~2.0 s a single driver job gets. The submit-time
predictions agree: 92.7 ms is the worst any medium group ever predicted for
itself, and the march lane's worst, 500 ms, is its cold-start EMA before a
single measurement has landed. The renderer is not asking for anything the
watchdog could object to.

WHAT DIFFERS IS SPEED, AND IT IS THE WRONG WAY ROUND. The run that died
recorded a pass 1 of 99.6 s; these three took 60.7, 60.9 and 61.0 s for the
same work on the same hardware. A 1.6x difference the configuration does
not explain points at what else the machine was doing, and this file's own
standing instruction — run it on a QUIET machine — is the obvious suspect.
That is a correlation between one run and three, NOT a mechanism, and it is
recorded as one.

THE RECORD CANNOT SETTLE IT, WHICH IS THE REAL FINDING. `sar` has both
windows and they are equally quiet on CPU — 4-8% user, loadavg around 1 on
16 cores, in the half hour around the loss and in the half hour around the
three settles — but it records NO GPU utilisation at all, and a competing
browser doing WebGPU would add roughly one busy thread and vanish into a
ten-minute CPU average. The one kind of contention that would have mattered
is the one kind nothing recorded. So "it was a quiet machine" was never
evidence here; it was an assumption, and the machine's owner cannot be asked
to coordinate with every agent that runs a gate. `scripts/lib/machine-quiet.mjs`
exists so the next such run answers the question itself, attributing GPU busy
time per process rather than asserting quiet.

AND QUIET IS NOT THIS MACHINE'S DEFAULT STATE. The first thing that check
reported, run while this section was being written, was
`quiet=NO contenders: firefox[4635] 92ms/s  desktop: gnome-shell[3692] 29ms/s`.
A second browser on the GPU is ordinary here. So neither the loss nor the
three settles can be certified after the fact, and the three settles are
evidence that the configuration CAN complete rather than evidence about what
it does on a quiet machine — which nobody has yet measured. Either way, lifting the ceiling has to be shown safe before
a medium is reconsidered — but the case against it is now weaker than the
loss alone made it look.

The measurement branch is `measure/name-fatal-dispatch`: the medium-cost
experiment with the submit-time line taught about the medium lane.

A separate cost surfaced along the way. The authored pass 1 spent 151 s of
its 501 s in 687 progressive presents, ~220 ms apiece: a full-frame readback
roughly every 500 ms. Any compute settle slow enough to present often pays
it, so it is not medium-specific.

## The reference review (historical)

The owner accepted the Menger cathedral and Balloon cavern reference looks
for production integration. The rotor-posed 4D shells composition was rejected
and may be set aside; it is not an approved starting scene. Lighting support
for non-flat 4D geometry remains part of the production implementation.

Production integration is in progress. The reference review establishes the
starting compositions, not browser appearance, performance or release readiness.
A pixel-difference test cannot establish that the finished look succeeds.

The comparison uses a native 3D Menger cathedral, a Balloon inverted-union
interior and a genuinely non-flat, rotor-posed 4D slice. Each row keeps its
geometry, camera and albedo fixed across legacy lighting/fog, colored lighting
alone, and colored lighting with a bounded medium. All primary rays use
`scripts/de-preview.ts`, the shared CPU reference renderer.

## Reference model and its limits

Lighting takes place in displayed three-dimensional space. A 4D scene supplies
one posed-slice distance query to the primary ray, surface shadow and medium
visibility. The query retains the underlying estimator's approximation; the
lighting experiment does not strengthen its geometry certificate.

A finite emitter supplies a distribution of incoming directions, so emitter
size affects both highlights and shadow softness. A bounded homogeneous medium
attenuates the camera ray and adds single scattering from visible emitters.
Light travelling to a scattering point is attenuated through the medium too.
Geometry clearance never implies absence of medium: even a primary ray that
misses the fractal may collect scattered light.

These choices follow the participating-medium and finite-emitter models in
PBRT's [Volume Scattering](https://www.pbr-book.org/4ed/Volume_Scattering) and
[Area Lights](https://pbr-book.org/4ed/Light_Sources/Area_Lights). Those sources
support the transport model, not the speed or artistic merit of this renderer.

The reference must report visibility evaluations, exhausted visibility rays
and sample counts. A budget exhaustion is unresolved visibility and cannot be
treated as a clear path. CPU reference timing is not a GPU performance result.
The production-browser viewport/export comparison and verified-hardware
cancellation and memory measurements remain separate release gates.

The baseline calls `finishShadeTs` with the application defaults and reproduces
its DE ambient-occlusion probes, directional shadow and encoded-space
squared-exponential fog. Primary hit tolerance and tetrahedron normals still
come from the common preview renderer. The new columns use a normalized Phong
diffuse/specular mixture and explicit ambient fill; their comparison with
legacy therefore also includes that declared material model. The lighting-only
and lighting-plus-medium columns have identical material and light state.

Disk intensity is total flux, independent of emitter radius. Its uniform-area
sampling weight includes the emitter cosine, inverse-square falloff and sample
normalization. The same emitter sample drives surface highlight and visibility.
The disk is an illumination source rather than camera-visible geometry in this
reference. Medium tint is scattering albedo; extinction is achromatic. Ambient
fill affects surfaces only. No multiple scattering, refraction, denoising or
GPU implementation is implied.

Camera transmittance is integrated analytically within each homogeneous cell;
its source illumination is sampled at a deterministic position weighted by
that cell's exponential attenuation. The light segment receives its own
bounded-medium attenuation. The HG helper uses the photon deflection cosine,
where positive directionality favors photons continuing in their incident
direction. This
differs in sign convention from PBRT's two-outward-vector notation, not in
scattering behavior. See [Transmittance](https://www.pbr-book.org/4ed/Volume_Scattering/Transmittance)
and [Phase Functions](https://www.pbr-book.org/4ed/Volume_Scattering/Phase_Functions).

`scripts/cinematic-lighting.test.ts` independently checks disk irradiance, an
analytically integrable axial scattering configuration, both surface transport
segments, normalized phase functions, zero-density identity, finite-light
occlusion, opened gaps and moved lights affecting both surface and mist, and
byte-identical atmosphere capture bands. `scripts/de-preview.test.ts` pins four
pre-change images and checks background integration, exhausted/invalid primary
rays and explicit far caps. These are transport and instrument checks, not
visual acceptance.

## Reproduce the owner sheet

```bash
CINEMATIC_RUN=owner-review npx vitest run --config scripts/vitest.harness.config.ts scripts/cinematic-lighting.harness.ts
```

The default is 256 pixels per panel, eight emitter samples per surface light,
32 medium cells and one emitter sample per light in each cell. Visibility is
capped at 128 DE steps in the native 3D rows and 256 in the 4D row. These are
reference settings, not proposed production tiers. The fixed world-space
visibility epsilon is the geometry's bounding radius times `2e-4`.

Select a row with `CINEMATIC_SCENES=cathedral`, `cavern` or `slice4`. Draft runs
can reduce `CINEMATIC_SIZE`, `CINEMATIC_SURFACE_SAMPLES` and
`CINEMATIC_MEDIUM_SAMPLES`; the manifest records actual values. Named output
directories refuse overwriting. `CINEMATIC_COMBINE=run-a,run-b,run-c` joins
separately rendered rows after verifying matching sampling and raw pixel
hashes. It does not rerender geometry.

Outputs include individual PNGs, raw RGB companions, `contact-sheet.png`,
`review.html` and `manifest.json` under `scripts/out/cinematic-lighting/<run>/`. The manifest
carries full transforms, the 4D rotor/slice, cameras, palette values, lights,
medium, primary terminal counts, visibility terminal counts and timing. The
Balloon row also records actual echo-attributed hits. Raw files and images are
ignored generated evidence; retain a reviewed run externally if it must remain
independently inspectable after the checkout is removed.

## Reference evidence, 9 September 2026

The runs used Node 22.22.0 on an Intel Core i9-9900K. Native scene jobs and the
intervention sheet ran concurrently. Timings therefore describe these CPU
reference runs; they are neither isolated benchmarks nor GPU predictions.

All nine owner panels have zero primary exhaustion and zero invalid visibility
queries. Each row retains the same geometry mask across all three columns.

| Scene             | Hit pixels / 65,536 | Legacy CPU time | Colored lights | Lights + medium |
| ----------------- | ------------------: | --------------: | -------------: | --------------: |
| Menger cathedral  |              60,429 |        29.845 s |      167.203 s |       665.343 s |
| Balloon cavern    |              58,357 |        33.324 s |      188.015 s |       497.013 s |
| Non-flat 4D slice |              28,346 |         0.937 s |        3.448 s |        33.797 s |

The cathedral's surface visibility exhausted 2,317 of 622,062 rays (0.373%);
medium visibility exhausted 1,529 of 4,175,088 (0.037%). The Balloon row has
28 of 529,308 unresolved surface rays and three of 3,646,857 medium rays.
Its echo supplies 42,168 hits, 72.26% of drawn geometry, so this is an actual
inverted-union interior. Camera clearance is 0.32876 world units. Near-clipped
pixels, defined by any encoded channel reaching 254, occupy 0.578% of the
cathedral medium frame and 1.701% of the Balloon medium frame.

The 4D row's surface visibility exhausted 82 of 215,558 rays (0.038%); medium
visibility exhausted 548 of 4,194,304 rays (0.013%). Unresolved visibility stays
dark in every row. The first 4D composition had a distracting bright source region and visible
spherical mist edge. Moving the rim light outside the medium, enlarging the
medium and adjusting density/fill removed those distractions in the revised
sheet. This is a composition decision, not owner acceptance.

The final deck combines `owner-256-cathedral`, `owner-256-balloon` and
`owner-256-4d-revised` into `owner-review-final`. All nine raw pixel hashes were
verified before assembly; Chromium loaded all nine review-page PNGs without
page errors. This only qualifies the generated review page. It does not test
the production fractal renderer in a browser.

**Visual limitation:** the colored rig strengthens warm/cool separation, but
the medium chiefly reads as illuminated haze or local glow. Distinct separated
shafts remain weak, and bright source regions retain sampling noise. The
Balloon glow also competes with the darker ceiling and wall detail. These
remain explicit questions for owner review; numerical agreement does not
resolve them.

The separate real-Menger intervention keeps a camera in clearance and compares
a 21-map IFS with a closed rear portal, the ordinary 20-map open portal, and
the same open geometry with its warm light moved sideways. Both lighting-only
and medium panels are rendered for each state. At 96 pixels, four surface
samples and 24 medium cells:

```bash
CINEMATIC_RUN=portal-review CINEMATIC_SIZE=96 CINEMATIC_SURFACE_SAMPLES=4 CINEMATIC_MEDIUM_SAMPLES=24 CINEMATIC_SCENES=portalClosed,portalOpen,portalMoved CINEMATIC_COLUMNS=lights,medium npx vitest run --config scripts/vitest.harness.config.ts scripts/cinematic-lighting.harness.ts
```

| Intervention             | Visible surface light rays | Visible medium light rays | Unresolved medium rays |
| ------------------------ | -------------------------: | ------------------------: | ---------------------: |
| Closed portal            |            21,950 / 45,874 |          81,372 / 442,368 |                     20 |
| Open portal              |            33,150 / 44,974 |         278,881 / 440,422 |                    137 |
| Moved light, open portal |            19,657 / 40,804 |          86,353 / 441,404 |                     84 |

All six panels have zero primary exhaustion and zero invalid queries. Opening
the portal admits warm illumination onto surfaces and into the medium; moving
the light suppresses both again. The 293 s concurrent run records visibility
behavior on real fractal geometry. It does not substitute for the owner's
judgment of the finished look or for the eventual production-browser gate.

## Decision and delivery boundary

**The owner approved the cathedral and cavern compositions.** The shells
composition is deferred. The reference images remain unchanged as the record
of that decision, including their noise and weakly separated shafts. Production
appearance and interaction still require browser qualification.

The production delivery includes both dimensional halves and
both Surface engines. The authored light/medium vocabulary and shader math must
be shared; saved views, links, scene files, Collection, Timeline and PNG capture
must reproduce the same state. Light-only edits must invalidate retained images
and accumulations. Absent state preserves the legacy path; zero density removes
only the medium. Full-image sample coordinates must survive capture bands.

Authored lights and atmosphere belong under Surface Scene / Look. Sampling
budget belongs to Renderer; capture belongs to Workflow. Other rendering modes
retain dormant Surface look state with an adjacent applicability explanation.

Production scheduling must price the nested visibility work, including
background rays, and keep long renders cancellable. The interaction tier may
reduce sampling only with its approximation disclosed. No production sample
budget or performance promise is established by this reference experiment.

## Authoring integration

`SurfaceParams.lighting` is optional: absence selects legacy lighting. Its
finite disk lights, ambient fill, Classic material defaults and optional
spherical medium use displayed-world coordinates in both dimensional paths.
Light colors and fill are linear RGB, disk intensity is total flux, and mist
tint is scattering albedo. The renderer resolves physical domains; the document
codec retains finite authored values and exact nested lighting precision.

State installation, snapshots and restored state own their nested rig arrays.
Undo, Collection and Timeline carry the same encoded scene block. Evolution
keeps the primary parent's complete rig as presentation state and validates
its structure without changing authored values.

The Surface lighting section is Scene / Look. Its controls remain visible but
disabled with an adjacent reason outside Surface. Edits apply live and restart
convergence; reduced sampling during motion is disclosed beside the controls.
Every numeric range has the shared exact-number companion. The older light
angle, height and ambient controls retain their role in authored finish
reflections; their Environment tint control is dormant under the new rig.

Systems offers two complete editable scene replacements through
`createSurfaceLightingStarter`: Menger cathedral and Balloon cavern. Each owns
its transforms, camera, constant stone palette, backdrop, rig and medium, with
eight parked-view samples as its initial Renderer setting.

They ride the preset menu's own "Replace with preset" select as a **Lit
interiors** optgroup rather than a second select beside it — one replacement
door in the section, the composition pickers' `preset:`/`saved:` convention
applied to a third vocabulary. The `starter:` value prefix
(`surface-lighting-starters.ts` owns it, with the id/label list) is what keeps
the two apart: a preset key resolves to a transform system plus its side
tables and auto-fits the camera, while a starter is a whole `SceneSnapshot`
loaded through `loadSceneSnapshot`, so it does not morph and its authored
camera, backdrop and palette are the composition. `#presetTimingHint`
discloses that difference beside the menu. Both composition pickers, which
clone the preset menu for their `preset:<key>` sources, skip the prefixed
entries: a scene document is not a system B. The reference
camera zooms become vertical fields of view of about 61.93° and 66.05°; these
wider authored lenses preserve normal dolly behavior. The ordinary fitted lens
remains 60°. Existing palette/backdrop wire quantization still applies when a
scene is encoded, while lighting values retain their full finite precision.

This authoring description does not certify the unfinished GPU and lifecycle
integration or the final production-browser checks.

## Production transport and wire

`src/fractal/surface-lighting.ts` owns the authored schema, render domains and
uniform lanes. `surface-lighting-shader.ts` emits one transport body in GLSL and
WGSL. Its visibility callback evaluates the public displayed DE, including a
posed 4D slice or supported slab, lens, Balloon union and tiling. A lattice clips
the finite light segment to its presentation carrier once. The analytic floor
is checked separately. Unresolved visibility stays dark; samples beyond the
finite emitter cannot shadow it.

The optional lighting tail starts at byte 240 of `ShadeParams`, after the
existing pattern quartet. Twelve vec4 lanes make the lit struct 432 bytes;
the runtime lane starts at 400 and the dispatch phase at 416. The geometry
parameter blocks and existing shade offsets retain their layout. Both GLSL
materials pack the same twelve lanes. Removing the rig restores the exact
legacy shader source.

A progressive pass samples each surface emitter once. Motion uses eight
medium cells and the parked view uses 32; the visibility budget is 128 steps
in 3D and 256 in 4D. Visibility epsilon is the raw geometry bounding radius
times `2e-4`, with a `1e-7` floor. Pixel position and progressive sample ordinal
seed the stream. Compute capture bands add their full-image offset — as does
the ray's own NDC and the march-start dither, which is what makes a banded
capture bit-exact rather than merely close; WebGL strips retain full-size
target coordinates. No sampling count changes the emitter's total flux.

Lit compute frames retain linear floating-point RGB and a separate byte
coverage/depth sidecar. WebGL uses a float color attachment with the existing
gamma encoding, then decodes into its linear sample accumulator. Both average
unclipped radiance before the final display conversion. The finite arithmetic
guard caps extreme radiance at `1e20`; it does not clip individual samples to
display white. The compute frame buffers require 68 bytes per ray, excluding
uniforms, textures, driver allocation overhead and CPU accumulators.

An actual image backdrop is an immutable, owned shading input. Lighting frames
integrate its radiance through the medium; changing it retraces the frame.
The legacy encoded-color background replacement is disabled while a rig is
active. Coverage and depth remain available for the existing depth-of-field
presentation. Zero mist density removes attenuation and scattering without
changing the authored lights.

The shared transport gate is
`scripts/surface-lighting-agreement.harness.ts`: analytic disk irradiance,
scattering, finite occlusion, gaps, exhaustion and zero density run through
the emitted shaders against independent reference results. Its production
shader compilation rows complement `scripts/cinematic-lighting.verify.mjs`,
which enters the built app through the two starting scenes and checks the
actual engines, pixels, saved state, edits, capture and cancellation.

## Production integration audit

The planning estimate is 10–18 focused engineering days after visual approval,
with scheduling and dynamic range the largest uncertainties. Every stage
includes native 3D and non-flat 4D; both Surface engines carry the effect for
the scene families they already support. Existing compute-only families do not
gain a separate WebGL geometry engine as part of lighting.

| Stage                 | Scope                                                                                            | Estimate |
| --------------------- | ------------------------------------------------------------------------------------------------ | -------- |
| Transport contract    | Shared vocabulary, sampling, visibility, attenuation, phase, output policy and CPU oracle        | 2–3 days |
| Shaders               | Both GLSL tracers and the shared WGSL shade emission; legacy identity and geometry compositions  | 3–5 days |
| Rendering lifecycle   | Compute/strip scheduling, retained background, frame keys, accumulation and capture cancellation | 2–4 days |
| Authoring             | Shared 3D/4D document state, persistence, controls and two accepted interior starting scenes     | 1–2 days |
| Browser qualification | Accepted appearance, restored state, viewport/export, cost, convergence, cancellation and memory | 2–4 days |

The wire audit found `SURFACE_GPU_SHADE_BYTES = 224`, with the optional pattern
calibration quartet already occupying bytes 224–239. A new shade tail must
start at or after 240, preserving that quartet even when unused, or use a
separate binding. Bytes 208–219 are also occupied: Balloon tint and ground
appearance deliberately share them in mutually exclusive sessions. Global
lighting does not belong in the frozen geometry Params, map offsets or 4D
`SurfaceMaps4` layout. Recheck these facts when implementing the wire.

State must travel through `SurfaceParams`, explicit persistence encoding and
decoding, `scene.ts`'s Surface parameter installation, the compute spec and
both material uniform sets. `surface-force-frame-key.ts` must include every
authored field with packer-identical defaults. Capture currently freezes all
band specs synchronously; nested rig arrays need owned copies. Links, files,
saved views, Collection and Timeline use the scene document, so their actual
restoration paths still need browser coverage.

Three existing assumptions require particular attention:

- The compute shader queue treats misses and exhausted primary rays as cheap
  background work. A medium makes those pixels expensive. Merely scaling the
  number of pixels cannot make one oversized workgroup safe; nested visibility
  work needs a bounded subdivision before submission.
- `packSurfaceLayer` and the retained-background compositor assume uncovered
  rays retain full background weight. Scattering and attenuation invalidate
  that assumption. The existing encoded-color background correction is not
  physical transmittance.
- `finishShade` returns encoded color. Each compute sample is clipped into
  RGBA8 before the sample accumulator decodes it for linear averaging. Bright
  light samples require an explicit radiance/output policy; averaging already
  clipped samples would bias the result.

Visibility must include the analytic ground plane separately because it is
outside the public fractal DE. Other wrappers—rotor/slice/slab, lens, Balloon
and tiling—must retain their existing displayed-space and far-cap contracts.
Emitted GLSL size also needs measurement against the documented strip threshold
and Mesa link limit.

The release evidence combines a new accepted-look browser comparison with the
existing Surface kernel agreement, 4D lift, forced-WebGL/fallback, tiled export,
render-tier, capture-drain and retained-background/DoF checks. Lifecycle changes
also require the Firefox teardown gate; new numeric controls require the trusted
touch/numeric-control gate. Real-driver claims require checking the adapter,
not merely passing a display flag.

## Production-browser gate, first measured run

Run on a verified real driver — `glxinfo -B` reporting
`AMD Radeon RX 7900 XTX (radeonsi, navi31)`, not SwiftShader — against
`npm run build && npm run preview`, with
`node scripts/cinematic-lighting.verify.mjs --display=:0`. All rows below are
64 px. Chromium reported `amd rdna-3` for compute and
`ANGLE (AMD, AMD Radeon RX 7900 XTX (radeonsi navi31 LLVM 20.1.2), OpenGL 4.6)`
for WebGL, so both are real-adapter rows.

| Row                     | Verdict |  Wall |
| ----------------------- | ------- | ----: |
| cathedral, compute      | PASS    | 28.2s |
| cathedral, WebGL        | PASS    | 54.3s |
| balloon-cavern, compute | PASS    | 13.0s |
| balloon-cavern, WebGL   | PASS    | 20.9s |
| slice4, compute         | PASS    | 72.7s |
| slice4, WebGL           | FAIL    |     — |

The appearance/entry/settle path therefore carries on both engines for both
accepted 3D compositions and, on compute, for a genuinely non-flat 4D slice.
The compute `slice4` row covers 2,833 of 4,096 rays with zero exhausted
primaries and zero invalid visibility queries.

Two failures were open at that run, and neither was an appearance defect.
Both are now fixed: the tiled export, and the authoring gate's active phase
(below, where the recorded cause turned out to be wrong twice over).

**The 4D WebGL row is blocked by a pre-existing engine disagreement about the
off-centre w-slice, not by lighting.** At `sliceCenter` 0.12 the fragment 4D
tracer covers no geometry at all where the compute tracer covers 69% of rays;
at `sliceCenter` 0 the same fixture renders normally on WebGL. Deleting the rig
from the fixture reproduces the empty frame, which is what attributes it away
from this feature. The gate's own fixture was also wrong until this run — it
built `document.fourD` in the in-memory `{pair: {p, q}}` shape where the
encoded wire is flat, so `validateFourD` dropped the pose and the app booted
with a fresh rotor and no slice at all.

**The tiled compute export did not reproduce the untiled one — FIXED, and it
was not the sampling.** The measured difference was 0.699/255 at the
diagnostic `--samples=1` and 0.408 at the authored eight-sample budget
(changed fraction 0.101 and 0.059) against the gate's `meanDiff < 0.15` bar.
A row-wise diff put it DIFFUSELY across the frame — elevated where the mist is
busiest — and NOT at the three internal band boundaries of the four-tile job,
which ruled out a seam.

The first hypothesis, that a tile completed fewer antialiasing passes than the
untiled frame, was WRONG: an export carries no wall budget, so no pass is ever
truncated, and both paths ran the full eight. The `pass 7/8` progress line was
the live pane's, not the export's. The per-pixel transport seed was innocent
too — `cinematicPixelSeed` already hashed the full-image pixel. What differed
was the GEOMETRY under that seed, in two places:

- the march-start DITHER hashed the ray's coordinates in its OWN raster, so
  every band past the first drew a different start offset for the same
  full-image pixel. Unlit, that is a thin silhouette scatter (`0.006%` of
  pixels in `surface-export-tile.verify.mjs`); lit, it is the whole frame,
  because the dithered start moves the terminal distance and the terminal
  distance IS the volumetric medium's integration length;
- the band's rays came from a `camera.setViewOffset` SUB-FRUSTUM, which is the
  full image's ray only in exact arithmetic.

Both are gone. A band now traces a row range of the WHOLE image's projection,
and the ray's NDC, the dither and the transport seed all derive from the
full-image pixel that `bgOffset`/`bgExtent` already supplied to the backdrop
shape — so the band's own raster height reaches no per-pixel arithmetic in the
app kernels at all, which makes the agreement structural rather than lucky.
MEASURED on the same real AMD RX 7900 XTX: mean 0, 0% of channels changed, at
`--samples=1` and at the authored eight — the two 64 px PNGs are byte-identical
files. The non-flat 4D `slice4`/compute row reads the same 0 and 0% over its
own four bands (at one sample; the authored-eight 4D settle is hours on this
box), and `surface-export-tile.verify.mjs`'s unlit 900x560 nine-band arm reads
mean 0.0000/255, max 0. Both gates now assert bit-exactness instead of a
tolerance.

Seeing it took correcting the measurement as well. The gate's two export arms
were not tracing the same document: the untiled arm exported the session
configured through the UI and the tiled arm a reload of its saved hash, and
`persist.ts` rounds on encode — worth 0.127/255 mean and 1.2% of channels on
this fixture, i.e. most of what was left after the dither fix and none of it
tiling. The gate now reloads the saved document once before either export, so
the arms differ only in their ray cap. The 64 px tiled export took 203 s at
eight samples.

## The cost of a lit frame, and why the look could not be judged

The feature could not be accepted in a browser because it could not be
rendered in one. MEASURED, real AMD RX 7900 XTX, cathedral at 64x64 = 4096
rays: one authored 8-sample settle took **206.6 s**, which is 50 ms per ray,
and the session's fence tally put **95%** of GPU time in the medium
(372,768 dispatches, 2,512,759 ms) against 4.9% in surface shading and
**0.1%** in the primary march. The fractal was a rounding error beside the
air around it. Scaled to a 1920x1057 pane that is ~3.6 h per antialiasing
pass and ~26 h for a settle — the owner reported not reaching 1% of a
cathedral in ten minutes, which is what the arithmetic predicts.

The cause was host scheduling, not the transport math the agreement harness
pins. `ShadeSizerState.lighting`'s cost lanes were inert placeholders, so
the lit hit dispatch was one workgroup wide for the life of a session and
each of them paid a 32-cell x 2-light medium sweep. A width sweep put one
medium dispatch at `5.63 ms + 2.04 us/ray`, i.e. **97.7% fixed cost** at
that width, with identical coverage at every width. Wiring the lanes and
pacing the width with a capacity ladder took the 64px settle from 27.22 s
to 4.655 s at one sample, and is worth ~26x at pane resolution — the full
record, including what remains, is in `docs/surface-compute-renderer.md`'s
"The lit dispatch width, and what one workgroup cost".

THAT IS NOT YET ENOUGH. ~59 min for a pane settle is faster and still not
judgeable, and the remaining factor is the 64 medium dispatches per shade
batch rather than any per-ray cost. Until the medium gets its own
progressive dimension over already-shaded terminals, acceptance criterion
1's browser half stays unmet and this feature is not finished.

These are gate results on one machine. They do not establish owner acceptance
of the finished look, and no performance promise is made from them.

## Remaining gates run, and what they settled

The shared transport gate PASSES on the emitted shaders:
`npx vitest run --config scripts/vitest.harness.config.ts
scripts/surface-lighting-agreement.harness.ts` compiles 25 WGSL and 15 GLSL
programs and finds WGSL and GLSL agreeing to the last printed digit on every
scenario — disk irradiance at one and eight samples, an occluding wall, an
opened aperture, a wall beyond the emitter, finite shadow exhaustion, isotropic
and forward and backward scattering, and the zero-density identity — each
matching its analytic reference. The largest emitted GLSL program is the 3D
compound lattice/lens/floor arm at 72,601 bytes.

The functional browser checks PASS on compute
(`--checks=all --export=none`, 240.7 s): moving a light invalidates retained
pixels and changes the image (mean 5.45 over 66% of pixels), a hash restore
reproduces it (0.11), opening a geometric gap admits light (1.75 over 24%),
a backdrop change retraces (1.26), cancellation catches an active render in
15 ms and re-entry after cancel succeeds — and **zero mist density is exact**:
mean difference 0 over 0 changed pixels, which is acceptance criterion 4's
identity requirement proved rather than approximated.

The authoring gate passes in BOTH phases on a verified real AMD adapter.
DORMANT is 41/41 (`--phase=dormant`), including exact rig retention through
Collection, gallery restore and Undo. ACTIVE is 57/57
(`--phase=active --viewport=393x727,320x568 --display=:0`, 10.3 s): the same
fourteen checks across both starters at both phone widths, plus the run-level
no-page-errors check — starter entry, the complete paired editor, applicability
and paired availability, 44 px targets, no horizontal overflow, authored and
domain values fitting, the installed camera and rig, trusted touch focus, the
exact numeric edit reaching the hash, refusal, Escape, the Arrow increment, and
undo.

THE ACTIVE PHASE'S LONG FAILURE WAS THE GATE'S OWN CLOCK, and both recorded
explanations for it were wrong. It had never passed in any session: it reached
six checks and then blocked past 30 s on a trusted click of Save to collection.
The first hypothesis was that a Collection save re-traces a lit Surface
thumbnail; that is not what the path does, because the active phase boots
`?surfacecompute` and a compute session's thumbnail RE-PRESENTS the last traced
frame rather than tracing. The second was that trusted pointer input stalls
during a lit settle while synthetic clicks do not — a `page.evaluate` click was
measured at 23 ms against a 30 s trusted timeout. THAT DOES NOT REPRODUCE ON
THIS BRANCH, measured rather than assumed: driving the same fixture to
`__surfaceState().settleActive === true` and then clicking for real lands in
38/48/60 ms over three trials, with all five pointer events arriving on the
button inside 1.1 ms, a maximum requestAnimationFrame gap of 21.3 ms and ZERO
long tasks. Nor is it button-specific — `#undoBtn` 57 ms and `#modePointsBtn`
40 ms mid-session. Input delivery is not starved behind the lit GPU queue.

What actually lost was a fixed sleep used as a document wait. After clicking
Undo the phase slept 200 ms, but undo arms a BARE DEBOUNCED SAVE of the
restored document, so the hash is rewritten `SAVE_DEBOUNCE_MS` (300 ms,
`edit-session.ts`) after the click and not with it. The measured revert
timeline is 7.223456789 at 0 ms and at 200 ms, 7.123456789 by 400 ms: 200 < 300,
so the check lost DETERMINISTICALLY rather than flakily, which is why no number
of reruns ever produced a pass. It was the only fixed sleep standing in for a
document change in the file — the dormant phase's identical undo gesture
already waits on the hash predicate, and that asymmetry is exactly why dormant
passed completely while active never finished. The wait now matches dormant's,
with its timeout bounded and CAUGHT so a genuine regression reads as an
assertion failure rather than as a checking failure, and the assertion
strengthened from "not the stepped value" to the exact restored value, which
holds in all four sessions with no checkpoint coalescing anywhere.

TWO CAUTIONS SURVIVE THIS. The gate drives `dist/` through `vite preview` and
never builds, so a re-measurement taken without an intervening `npm run build`
tests the PREVIOUS bundle; the lit dispatch sizing that bounded submissions to
50 ms landed in that window, and it is the leading unproven explanation for why
the 30 s block was seen at all after the sizing fix. And this gate is NOT a
standing guard against the input-stall class: its entry wait resolves when the
mode flips, not when the lit settle completes, so it overlaps a settle only
incidentally. The mid-settle figures above come from a separate probe that
waited on `settleActive`, not from the gate.

The Firefox lifecycle gate passes with the rig
(`surface-teardown.verify.mjs --lens --lighting --toggleId=__modeExit
--toggles=12`, exit 0, no process loss). It also surfaced an intermittent
`Not enough memory left.` WebGPU device loss that falls back to the WebGL
tracer. CONTROL RUNS ATTRIBUTE THAT AWAY FROM LIGHTING: the rig-less arm
reproduces it (once in four 12-toggle runs, against two of three lit runs),
and it is not cumulative, since a 4-toggle run lost the device where an
8-toggle run did not. The first single control run did NOT reproduce it and
would have supported the opposite, wrong conclusion; the repeats are why that
claim is not in this document.

Still unrun here: the WebGL engine under `--checks=all`, and owner
acceptance of the finished look in a browser rather than in the CPU reference
deck.
