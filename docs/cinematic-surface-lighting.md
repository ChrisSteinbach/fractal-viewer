# Cinematic Surface lighting

The first milestone is a visual decision about colored finite lights and
shadowed mist on existing fractals. It is a reference experiment, with no
production controls, document fields or GPU wire changes. Owner judgment of
depth, legibility and visual impact is required before those changes; a
pixel-difference test cannot establish that the look succeeds.

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

The non-flat 4D row has 28,346 hit pixels out of 65,536 in every column, with
zero primary exhaustion. Its reference times were 0.937 s for legacy lighting,
3.448 s for colored lights and 33.797 s with the medium. Surface visibility
exhausted 82 of 215,558 rays (0.038%); medium visibility exhausted 548 of
4,194,304 rays (0.013%). All remained dark, and no distance query was invalid.
The first composition had a distracting bright source region and visible
spherical mist edge. Moving the rim light outside the medium, enlarging the
medium and adjusting density/fill removed those distractions in the revised
sheet. This is a composition decision, not owner acceptance.

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

**Owner visual review is pending.** The implementation issue remains open.
The reference images and machine checks prepare that decision; they do not
approve it.

After visual acceptance, one delivery includes both dimensional halves and
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
| Authoring             | Surface document state, persistence, controls and composed 3D/4D starting scenes                 | 1–2 days |
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
