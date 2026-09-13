# Layered transmission with world-space bending

This is the next experiment selected in the
[transmission review](surface-transmission.md#candidate-comparison-and-review-status):
preserve fractal detail and reveal internal/rear geometry in both dimensions,
with visible bending required. The desktop research targets are 1 second for
256 × 144, 10 seconds for 512 × 288, and 120 seconds for 1920 × 1080, with
correct completion and at most 128 MiB of additional state. These are targets,
not achieved performance or production approval.

The previous hard World bands and screen-space warp remain intact as
controls. Their gap-phase, fallback, and GPU agreement failures remain in
the [original study](surface-transmission.md) and
[feasibility record](surface-transmission-feasibility.md).

## Smooth layer weight

`scripts/transmission-layer-field.ts` defines a smooth clearance signal:

```
s = clamp((.003R - DE(p)) / (.003R - .002R), 0, 1)
h = s²(3 - 2s)
weight = max(0, h - previousH)
throughput *= baseTau ** weight
previousH = h
```

`R` is the full scene ball, including the unsliced ball for 4D. The default
world lattice is still `.001R`. The previous signal survives work chunks
and starts at zero at analytic entry. A complete monotone rise contributes
one interface weight; a plateau and an outward fall contribute zero; a
partial rise contributes fractional weight. An opaque material has zero
throughput at any positive weight and remains inert at zero weight.

This is positive variation of a sampled clearance signal. It is not a
signed membership test, true solid thickness, or Beer absorption per unit
length. Repeating the same sample cannot manufacture density, but an
oscillating field can add multiple rises to one apparent layer. Both the
TypeScript and small WGSL mirror use this definition; their arithmetic has
different precision and requires measured comparison.

## Exact gap and noise controls

`scripts/transmission-layer-field.harness.ts` uses the independent finite-box
interval oracle for a central ray through two closed solids in 3D and a
posed 4D slice. On these chosen axis-parallel rays, distance to the interval
union is the exact unsigned box distance. The continuous positive variation
is independently `2 - h(gap/2)`. This identity does not extend an interval
oracle into a general estimator or infer membership from a generic DE.

At base throughput `.864`, the measured throughput range over grid phases
0, .25, .5, .75 is identical in both dimensions:

| Gap / R | Spacing / R | Throughput range across phases |
| ------: | ----------: | -----------------------------: |
|    .006 |        .001 |                        .056606 |
|    .006 |      .00025 |                        .004704 |
|  .00625 |        .001 |                        .017247 |
|  .00625 |      .00025 |                        < 2e-15 |

The `.004R` gap remains one layer; the `.008R` gap gives two on all tested
phases and spacings. Nested phase-zero refinement cannot lose positive
variation and is checked against the continuous oracle. Smoothing reduces
the old `.00625R` all-or-nothing split, but material phase sensitivity
remains at the default spacing. This is not a phase-independent optical
definition.

A separate deterministic spatial-noise control samples
`DE/R = .0025 + .00005 cos(2π cycles s)` on 16,384 subdivisions. Without
noise, positive variation is .5 and throughput is .929516. At 64 cycles,
variation rises to 9.99325 and throughput falls to .232042. Fixed-amplitude
noise can therefore make the field substantially more opaque. The harness
also checks plateaus, repeated identical samples, homothetic scale, opaque
limits, invalid inputs, and exact chunk equality for sizes 1, 37, and 1200.

No public Menger or Pentatope estimator currently provides a certificate
bounding its returned DE over a skipped segment. A map-level distance or
Lipschitz bound does not certify finite-depth branch selection. The pilot
therefore evaluates the fixed lattice; it cannot safely skip work merely
because the current sample is far from a layer.

Reproduce these scalar controls independently of a GPU timing window:

```bash
npx vitest run --config scripts/vitest.harness.config.ts \
  scripts/transmission-layer-field.harness.ts --disableConsoleIntercept
```

The gap and noise records land in
`scripts/out/transmission-layer-field-report.json` and
`scripts/out/transmission-layer-noise-report.json`. Generated evidence stays
under ignored `scripts/out/`; the harness and this interpretation are
versioned. World-space bending and device continuation need their own
image, correctness, and measured cost evidence before qualification.

## World-space displacement contract

`scripts/transmission-bend-study.ts` uses the shared `renderPreview` marcher
with a saved origin, incident direction, analytic entry, integer sample
index, previous signal, throughput, accumulated radiance, and termination
state. Work chunks suspend this state. They do not restart the signal or
move the world lattice. An optional normal callback supplies the actual
sampled point's optical normal to the shared renderer; other consumers
retain its existing normal calculation.

The virtual parallel slab defines a displacement, not a physical exit from
the fractal. For a unit incident ray `rd` and facing unit interface normal
`n`, let `c = -dot(n, rd)`, `v = rd + c*n`, `eta = 1/IOR`, and
`ct = sqrt(1 - eta²(1 - c²))`. The unbounded displacement is
`thickness * (eta/ct - 1/c) * v`. Its direction lies in the interface's
tangent plane and has nonpositive projection along the incident ray.
At grazing incidence the magnitude diverges, so the experiment smoothly
limits it to `L*tanh(magnitude/L)`, with default `L = .08R`. IOR 1, zero
thickness, and a zero normal produce no displacement.

Only this displacement changes the saved ray origin, at unchanged forward
sample parameter. There is no unqueried `.08R` jump through purported glass.
Subsequent clearance, material, and terminal floor queries use the displaced
world ray, whose ball interval is recomputed. Samples before its shifted
entry retain their original lattice indices, carry zero signal, and do not
query the estimator outside the optical domain. Newly uncovered rear geometry can
therefore be queried directly. The thin interface itself is an artistic
mapping; it does not claim a known glass volume, physical path length,
multiple refractions, or exact curved-solid optics.

Being tangent to the **estimated optical normal** does not certify that the
shift stays tangent to a true surface or avoids every nearby object. In
particular, a wide finite-difference probe across two close unsigned sheets
can give a different normal from either sheet's analytic normal. The close-
guard controls distinguish a forbidden jump forward along the incident ray
from this remaining lateral-map approximation.

The weighted onset accumulates positive signal rises on the first approach,
up to weight one, and freezes at the first decrease. A hard-onset control
applies the whole displacement at the first positive rise. Weighted onset
avoids a full shift for an infinitesimal initial signal, but its first-
reversal rule can itself respond to noise or sampling phase. Default
parameters are IOR 1.45, virtual thickness `.08R`, offset bound `.08R`, and
normal radius `.04R`; these are experimental settings, not qualified ranges.

Each positive increment shades the actual sampled material and composes
linear radiance with `tau = [transmit*(1-Fresnel)] ** weight`. This local
base throughput can vary with the optical normal; the GPU cost pilot below
uses a constant base throughput and does not measure that shading work.
An opaque material terminates immediately. A completed analytic domain
receives terminal radiance. Sample, layer, or chunk exhaustion remains
unresolved; it never becomes a completed backdrop miss.

## Device-owned continuation

`scripts/transmission-gpu-resumable.page.ts` reuses the public generated
estimator WGSL through a guarded replacement of its evaluation entry and
I/O declarations. It owns a 64-byte ray state, two 4-byte active-queue entries
per ray, and explicit queue/indirect-dispatch control. Each submission takes
1, 2, 4, or 8 consecutive lattice samples per active ray. The GPU compacts
the next queue; the host reads completed state once per window. The host
does not classify optical events between submissions.

The initially written multiply/add expression was fused by the tested
compiler and failed the coordinate hash comparison. The revised definition
therefore explicitly uses f32 fused multiply-add for ray coordinates. The
CPU mirror rounds `a + b*c` from float inputs once to f32, and a per-ray
coordinate hash checks the actual device sequence. It intentionally differs
from the old host-packed double-precision grid. Counts use the same f32
half-open `t < exit` domain with bounded endpoint correction; no counts
changed in the recorded 256 × 144 comparisons.

The 32 × 18 and 64 × 36 calibrations compare complete state across K =
1/2/4/8 and 256/128-ray windows: sample count, status, coordinate hash,
terminal signal, positive variation, and throughput are exactly equal.
These are measured scheduling invariants, not a claim that CPU and GPU DE
arithmetic are identical. The 256 × 144 run checks 128 deterministic
nonempty rays against the CPU, while the calibrations check every nonempty
ray. Empty rays are independently counted as completed without sampling.

The scalar transport comparison proposes maximum absolute throughput error
`1/1024` at constant base throughput .9. It reports terminal-signal and
positive-variation errors separately. This new metric does not replace or
relax the previous hard-predicate failures. In particular, **the 64 × 36
native Mandelbox Brick calibration fails**: maximum throughput error
.008096799 and positive-variation difference .710269928, despite matching
coordinate hashes and final signal. The 256 × 144 selected-ray pass does
not overrule that full calibration failure.

A separate, source-hashed Brick-only 64 × 36 run with K = 1 and one window
reproduces the failure at global ray 1369. Its canonical origin is
`(0, 0, 10)`, direction `(-.20287749, -.10924173, -.97309142)`, entry
6.46125126, exit 13.00057793, and sample count 1635. CPU/GPU throughput is
.104198821/.112295620; positive variation is 21.463964/20.753695. All
coordinate hashes match, all 2304 rays complete, and terminal-signal error
is zero. The failure therefore survives a different work schedule and is
not repaired by a matching final signal. The diagnostic report records 37
source input hashes; it does not attribute the divergence to a particular
internal estimator branch.

### Actual raster and scheduling cost

Measured on the verified RX 7900 XTX (`radeonsi`, navi31, LLVM 20.1.2,
DRM 3.64), Chromium 153.0.8010.12, amd/rdna-3 nonfallback WebGPU adapter.
The launcher verifies the current X cookie, hardware renderer and attributed
quiet baseline before each browser launches. No application tests or CPU
image renders ran beside these measurements.

All four 256 × 144 fixtures complete 36,864 rays with zero invalid or
unresolved rays. K = 1 with one 36,864-ray state window yields:

| Fixture                  | Device total | Largest submission | Encode/submit/terminal-map wall |
| ------------------------ | -----------: | -----------------: | ------------------------------: |
| Menger 3D                |   974.100 ms |            .773 ms |                       1142.8 ms |
| Posed Pentatope 4D       |   117.912 ms |            .097 ms |                        167.5 ms |
| Mandelbox Cube 3D        |    31.838 ms |            .023 ms |                        140.1 ms |
| Posed Mandelbox Brick 4D |    34.511 ms |            .023 ms |                        139.2 ms |

Each row has 2,000 bounded submissions. The Menger row additionally spends
17ms building the host grid, 23.3ms compiling pipelines, and 11.9ms preparing
the window. Its 1,459.5ms CPU-oracle time is a measurement expense and is
reported separately; it is not rendering work.

The same raster with K = 4 and 256-ray windows takes 38.708s of Menger
device time and 42.539s of submission/readback wall time across 41,818
submissions, despite a largest submission of only 3.073ms. Small windows
bound memory but leave very few workgroups active; sufficient simultaneous
ray work matters. Both window size and K changed in this comparison, so it
does not independently isolate their performance effects. The retained
calibration comparisons pin their optical equivalence.

The largest actual row allocates 5,081,032 bytes of declared GPU buffers
and reports a 4,901,576-byte peak in host typed arrays. These are peak and
cumulative accounting fields, not a complete memory certification: the
full host ray-object grid, JavaScript objects, query-set implementation,
compiler and driver allocations are not measured. The pilot lists them as
unknown. Windowing avoids a mandatory full-1080p ray-state allocation, but
the 128 MiB export target is still unqualified.

These timings exclude bending, normal probes, Fresnel, material shading,
rear lighting, image composition, and the production frame loop. A bounded
GPU submission also does not prove a responsive browser loop when the host
queues many submissions synchronously. Menger already exceeds the selected
1-second preview target in the measured encode/submit/readback work alone.
No 512 × 288 settled or 1080p export was measured, and pixel-count scaling
would not establish either target.

**Production integration remains no-go for this revision.** Device state
and adequate parallel work remove a large avoidable cost, but do not settle
the 4D agreement, sampling/noise, mixed-material ownership, bending quality,
or complete time/memory questions. This is a measured limit of this
candidate, not a general impossibility result for fractal transmission.

## Bending controls, stills and motion

The corrected analytic 33 × 33 comparison finds three newly exposed rear
pixels that the straight ray does not see. Removing the actual rear object
changes the transmitted image; zero slab thickness exactly matches the
straight image. An opaque front produces no rear hits or displacement.
Offset limits `.04/.08/.12R` yield straight/bent mean RGB differences of
7.109/7.287/7.478 on a 0–255 scale. These differences demonstrate a changed
image, not aesthetic quality or physical refraction.

An independent native 4D hypersphere control uses XW rotation .37 and slice
`w0 = .23`. For each displayed sphere, its 4D centre is the rotated displayed
centre plus an offset along the slice normal, and its radius is
`hypot(displayedRadius, offset)`. Offsets .2/.05 for front/rear give genuine
off-centre hypersphere slices with known displayed geometry and a fixed full
ball radius 1.25. At 33 × 33, weighted rays see 28 rear pixels versus 24 for
straight rays: four are newly disoccluded. Removing the rear object and
making the front opaque each produce zero rear hits; zero slab thickness
matches straight RGB exactly. Every row completes without the analytic
opaque-stop override used by the separate close-guard test.

The two one-ray no-forward-jump controls put an opaque z-plane `.005R`
downstream of a tilted front, including a genuinely posed 4D front. A
separate analytic opaque predicate, sampled on the same lattice, makes this
a transport-independent continuation oracle. Both stop at the guard. This
override is disclosed in the report and absent from every fractal still and
motion frame; it does not qualify generic mixed-material ownership. The
ordinary perpendicular and tilted-parallel field-only controls also retain
opaque ownership at the recorded phase. Those are individual observations,
not a proof over phase or arbitrary adjacent geometry.

Chunks of 1/37/1200 samples produce exactly equal RGB, sample/event counts,
variation, throughput, attribution and termination in the close-guard
control. A near-boundary displacement skips 40 original lattice slots before
the shifted ball entry without querying the estimator. No phase reset or
unresolved-as-background shortcut is used.

| Still                        | Covered pixels | Straight / weighted RGB difference | Weighted / hard RGB difference | Weighted positive-increment events | Unresolved |
| ---------------------------- | -------------: | ---------------------------------: | -----------------------------: | ---------------------------------: | ---------: |
| Menger, 32 × 32              |     526 / 1024 |                          7.644/255 |                      3.781/255 |                             12,326 |          0 |
| Native Mandelbox 4D, 48 × 48 |    1475 / 2304 |                         14.014/255 |                      4.353/255 |                             25,157 |          0 |

The weighted Menger/4D rows make 1,272,909/4,402,504 DE calls, of which
73,956/150,942 are optical-normal probes. They stop first-approach steering
at a reversal on 269/342 rays; 213/517 rays exceed the raw `.08R` offset
before the smooth limit. These counts are visible costs and model behavior,
not GPU timings or validated production limits.

Three-frame comparisons isolate Menger camera movement at 20 × 20, then
native 4D rotor and slice movement at 24 × 24. Every frame completes. Their
straight/weighted differences span 7.057–7.409/255 for camera movement,
12.328–13.375/255 for rotor changes, and 13.152–14.664/255 for slice changes.
The tiny, aliased images are diagnostic previews with a high-contrast
procedural floor. They do not establish fine-detail appearance or temporal
stability at a viewing resolution. In particular, completion and a changed
pixel count are not a visual approval of the bending model.

## Reproduce the revision

Run the scalar and image experiments separately from GPU measurement:

```bash
npx vitest run --config scripts/vitest.harness.config.ts \
  scripts/transmission-layer-field.harness.ts \
  scripts/transmission-bend.harness.ts --disableConsoleIntercept
```

The image harness defaults to the diagnostic sizes above. Its
`TRANSMISSION_BEND_CONTROL_SIZE`, `TRANSMISSION_BEND_MENGER_SIZE`,
`TRANSMISSION_BEND_4D_SIZE`, `TRANSMISSION_BEND_MOTION3_SIZE`, and
`TRANSMISSION_BEND_MOTION4_SIZE` variables are raster controls; they do not
change the world-space optical parameters.

With the current Xwayland cookie and `DISPLAY=:0` set as described in the
project commands, run these on a quiet machine:

```bash
node scripts/transmission-gpu-resumable.mjs --display=:0 \
  --width=32 --height=18 --k=4 --windowRays=256 --checkWindowInvariant
cp scripts/out/transmission-gpu-resumable/report.json \
  scripts/out/transmission-gpu-resumable/calibration-32x18-k4-window256-allk-window.json
node scripts/transmission-gpu-resumable.mjs --display=:0 \
  --width=64 --height=36 --k=4 --windowRays=256 --checkWindowInvariant
cp scripts/out/transmission-gpu-resumable/report.json \
  scripts/out/transmission-gpu-resumable/calibration-64x36-k4-window256-allk-window-refused.json
node scripts/transmission-gpu-resumable.mjs --display=:0 \
  --width=256 --height=144 --k=4 --windowRays=256
cp scripts/out/transmission-gpu-resumable/report.json \
  scripts/out/transmission-gpu-resumable/actual-256x144-k4-window256-control.json
node scripts/transmission-gpu-resumable.mjs --display=:0 \
  --width=256 --height=144 --k=1 --windowRays=36864
cp scripts/out/transmission-gpu-resumable/report.json \
  scripts/out/transmission-gpu-resumable/actual-256x144-k1-window36864-fullraster.json
node scripts/transmission-gpu-resumable.mjs --display=:0 \
  --width=64 --height=36 --k=1 --windowRays=2304 \
  --fixture=mandelbox-brick-4d-posed-filled-escape
cp scripts/out/transmission-gpu-resumable/report.json \
  scripts/out/transmission-gpu-resumable/diagnostic-64x36-brick-k1-full-window.json
```

Exit 2 means an inconclusive device/measurement setup; exit 3 records a
qualification refusal and still writes the report. The 64 × 36 comparison
above is expected to refuse on its recorded Brick witness. It must not be
chained to the following archive command with `&&`, which would lose the
negative record. The initial 32/64 calibration archives predate added timing
fields for alternate K/window comparisons; their invariant results and
primary timing fields remain recorded. Newly generated reports include those
additional fields and hashes of the bundled source inputs.

Run `node scripts/transmission-revision-review.mjs` after generating the
artifacts. It writes the offline review and source/artifact manifest under
`scripts/out/transmission-revision-review.html` and
`scripts/out/transmission-revision-review-manifest.json`, including the
failed calibration alongside the larger selected-ray pass. The original
`transmission-review.html` remains the earlier control package.
