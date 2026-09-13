# GPU images for layered transmission

The expensive 512px reference batch was a CPU render. The owner challenged
the wait and asked for GPU image generation. `scripts/transmission-bend-gpu.mjs`
and its browser page now evaluate the selected layered field, weighted
world-space displacement, optical normals, Fresnel, finish shading and
procedural floor on WebGPU. Both Menger 3D and the native posed 4D reference
are included. This is an offline image experiment; the application has not
acquired a new material.

The [optical definition](surface-transmission-revision.md) is unchanged.
The GPU uses the public `affine` and `escape4` estimator sources and the
shared finish shader emitter. The launcher obtains camera, bounds and
optical settings from the shared CPU fixtures. The 4D scene is Mandelbox
Classic lifted with `w.scale = 2` and `w.position = .12`, viewed at XW angle
`.35` and slice `.3`. It is not the earlier Brick scalar diagnostic.

The public 4D packer transposes its input view rotor. The CPU image fixture
explicitly queries `R(+.35) * (p, .3)`, so this experiment supplies `R(-.35)`
to that packer. An initial sign error produced large disagreements and was
corrected before the image measurements. It was an implementation defect,
not evidence about the optical rule or floating-point precision.

## Completion and scheduling

Each ray retains its original entry, integer world-lattice index, displaced
origin, prior field value, throughput, accumulated radiance and bending
state. Active queues stay on the GPU. Chunk boundaries do not restart the
ray or field. Caps produce explicit unresolved reasons and never become a
backdrop miss.

For the selected maximum displacement `L = .08R`, a shifted sphere exit
minus the original entry is at most `2R + L`. With spacing `.001R`, the
scheduler therefore needs at most 2080 exact lattice slots. Two guard slots
and a terminal turn cover the current near-origin fixtures. K=8 rounds this
to 2088 turns; a surviving active ray is a `schedulerCap` refusal. The
independent sample cap remains 4096. This scheduling bound is tied to the
selected displacement and spacing; it is not permission to skip arbitrary
intervals of an estimator.

The original 8px control wasted dispatches up to the sample safety cap.
Its timing was not a prediction of larger-image speed. Measurements at
64px, 128px and 512px followed the corrected scheduler. K=1/K=8 comparisons
at the diagnostic size check identical RGB, sample/event counts,
termination, field variation, throughput, bending strength and query work.
That check does not assert CPU agreement or K invariance at every raster.

## Measured images and waiting times

The September 13, 2026 runs used the verified Radeon RX 7900 XTX through
Chromium, with an attributed quiet baseline before each browser launch.
The final source closure contains 41 files and has SHA-256
`c139b5e53b7f9dd9261704ad3a93cbda78ceb1ec6dc9e285fc6ca0608c2e4cb0`.
Per-run adapter, browser, quiet-state and source records accompany the
images in `scripts/out/transmission-bend-gpu/final-current/`.

All four 512 × 512 images complete every ray: 1,048,576 rays in total,
with zero invalid, sample-cap, layer-cap or scheduler-cap results.

| 512 × 512 image     | Bend/encode GPU time | Page render wall time | Longest timed pass |
| ------------------- | -------------------: | --------------------: | -----------------: |
| Menger, straight    |          5423.713 ms |             5871.4 ms |          36.072 ms |
| Menger, bending     |          5670.522 ms |             6161.4 ms |          36.924 ms |
| Native 4D, straight |            47.996 ms |              272.8 ms |            .308 ms |
| Native 4D, bending  |            49.746 ms |              282.9 ms |            .333 ms |

The device timestamps cover bend-step and image-encode passes. Page wall
time also includes ray initialization, shader/pipeline creation,
prepare/finalize dispatches, mapping/readback, typed extraction and base64
encoding. It excludes browser and launcher startup, CPU oracle controls,
PNG/trace file writing and multi-row orchestration. The diagnostic renders
precede each actual image, so these are not independent cold shader-compile
measurements or end-to-end application interaction times.

The rectangular targets were measured separately with bending enabled;
the square stills are appearance evidence, not substitute target rasters.
Every ray in these four rectangular runs also completes.

| Scene     | Raster    | Bend/encode GPU time | Page render wall time | Waiting-time comparison            |
| --------- | --------- | -------------------: | --------------------: | ---------------------------------- |
| Menger    | 256 × 144 |          2840.810 ms |             3041.5 ms | Exceeds 1-second preview target    |
| Native 4D | 256 × 144 |            34.091 ms |               84.8 ms | Within preview time only           |
| Menger    | 512 × 288 |          4113.671 ms |             4489.3 ms | Within 10-second settled time only |
| Native 4D | 512 × 288 |            39.999 ms |              183.2 ms | Within settled time only           |

These comparisons do not pass the combined correctness, memory and
responsiveness requirements. In particular, a 36.9 ms measured pass is not
evidence that the browser accepts input promptly during this job. A tiny
GPU test, a scalar-only pilot and CPU timing would each have missed parts
of this result.

Each 512px Menger row declares 62,926,536 GPU-buffer bytes (about 60.0 MiB),
including its readback buffer. Native 4D uses 62,923,848 bytes. Separately,
host initialization, readback and extraction arrays allocate 30,408,704,
30,412,896 and 8,912,896 bytes per row. These are allocation categories,
not a measured simultaneous peak. Strings, serialization, browser/driver
allocations and retained oracle data remain unmeasured. The final version
avoids converting full-image diagnostic arrays into seven additional
JavaScript number arrays; only the small controls retain those arrays.

The 1920 × 1080 preflight records a refusal before allocating image state:
the Menger plan requires 497,675,976 GPU-buffer bytes (474.6 MiB). State
plus its readback alone is about 450.9 MiB. The 120-second export target
was therefore not timed with this whole-raster design. No pixel-count
extrapolation is presented as an export measurement.

## Qualification status

Completed GPU images remain experimental. A completed ray is different
from agreement with the CPU oracle, and a changed image is different from
an accepted appearance. The 16px CPU comparisons retain their proposed
`1/1024` transport tolerance and `3/255` RGB tolerance, with exact event and
sample counts. The current implementation fails some of those checks in
both dimensions. The existing phase and noise controls also remain failed
qualification evidence. No tolerance was enlarged to turn these into
passes.

| 16 × 16 CPU comparison | Exact event/sample mismatches | Largest transport residuals that exceed 1/1024          | Maximum RGB difference |
| ---------------------- | ----------------------------- | ------------------------------------------------------- | ---------------------: |
| Menger, straight       | 0 / 0                         | Throughput .001963                                      |                  1/255 |
| Menger, bending        | 7 / 2                         | Throughput .014765; variation .119707; strength .006076 |                  4/255 |
| Native 4D, straight    | 1 / 0                         | None                                                    |                  1/255 |
| Native 4D, bending     | 0 / 0                         | Variation .001972                                       |                      0 |

Termination aggregates and per-ray completed status agree in all four
controls. Every K=1/K=8 diagnostic comparison is exact. The launcher still
records `REFUSED` for each CPU comparison above; neither a visually close
image nor exact scheduling removes the numerical or event disagreement.
The old Brick witness remains a separate unresolved diagnostic.

The whole-raster diagnostic state and readback design does not qualify a
1920x1080 export within 128 MiB of additional state. GPU buffer counts,
known host allocations and unmeasured runtime overhead must be distinguished;
a GPU-only allocation check is not certification of the total-state target.
The full production feasibility study still owes bounded export state,
responsiveness during rendering, difficult poses and supported platforms.

The current CPU reference review remains at
`scripts/out/transmission-revision-review.html`. GPU appearance evidence
uses a separate page, `scripts/out/transmission-gpu-review.html`, with actual
512px images and links to their original PNGs. Tiny controls never replace
either main comparison. Increasing resolution and changing the executing
processor do not repair the grain or weak separation in the current material.

## Reproduce

Set the current Xwayland cookie and `DISPLAY=:0` using the project commands,
and keep CPU tests and other GPU jobs out of the measurement window. Then:

```bash
node scripts/transmission-bend-gpu.mjs --display=:0 \
  --width=512 --height=512 --k=8 --cpuCompareSize=16
cp scripts/out/transmission-bend-gpu/report.json \
  scripts/out/transmission-bend-gpu/actual-512x512-all.json
node scripts/transmission-gpu-review.mjs
```

Exit 3 is the recorded qualification refusal, with images and a report
still written when transport completes. Do not join the archive command
with `&&`, which would discard the negative result. Exit 2 means the
hardware/measurement setup is inconclusive, and exit 1 is a harness error.
The review requires all four actual 512px rows, complete termination and
matching current source, PNG and trace hashes. It labels the separate
small-raster CPU refusal rather than presenting it as full-image agreement.

For the rectangular measurements, use `--mode=weighted` with
`--width=256 --height=144`, then `--width=512 --height=288`, archiving each
report before the next run. A 1920 × 1080 request verifies the structured
memory preflight refusal; it does not render an over-budget image. The
current measurements use K=8, with K=1 only for diagnostic invariance.
