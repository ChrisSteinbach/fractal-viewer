# Cinematic Surface lighting

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
eight parked-view samples as its initial Renderer setting. The reference
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
seed the stream. Compute capture bands add their full-image offset; WebGL
strips retain full-size target coordinates. No sampling count changes the
emitter's total flux.

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
