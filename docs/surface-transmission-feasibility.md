# Surface transmission feasibility pilot

This is a harness-only feasibility record for sampled world-space clearance
bands. It does not approve a production renderer or change its frozen runtime
wire contracts.

## Contract measured

Each analytic-sphere ray samples the half-open interval `t ∈ [enter, exit)` at
`delta = 0.001R`, where `R` is the full raw bounding-ball radius. The predicate
is in world units in every phase: an event enters at `DE <= 0.002R`, re-arms at
`DE > 0.003R`, and emits at most one normal-free event with throughput `0.9`.
The endpoint is excluded; a tangent interval has no samples. This is a sampled
feature-resolution contract, not an exact volume/interior inference. Escape
DE clearance remains heuristic and is not a universal outside certification.

The browser kernel is a pure estimator evaluation loop. It has no actual
surface normal, Fresnel, shade, warp, lights, image composition, or renderer
frame-loop work. It reserves 72 bytes per ray (64-byte core continuation plus
4-byte active and 4-byte status fields), but continuation classification and
event accumulation remain on the host. The reservation is therefore a bounded
memory accounting exercise, not proof that a device continuation architecture
is viable.

## Reproduction and provenance

The real-driver runs used the current Xwayland cookie and rejected a non-quiet
or software configuration before launching Chromium:

```sh
export XAUTHORITY=$(ls -t /run/user/$(id -u)/.mutter-Xwaylandauth.* | head -1)
export DISPLAY=:0
glxinfo -B | rg 'OpenGL renderer|OpenGL vendor|OpenGL version'
node scripts/transmission-gpu-pilot.mjs --display=:0 --width=64 --height=36 \
  --batchSamples=8192 --maxSamples=5000000 --checkChunkInvariant
node scripts/transmission-gpu-pilot.mjs --display=:0 --width=256 --height=144 \
  --batchSamples=8192 --maxSamples=12500000
```

`machine-quiet` reported `YES` before browser launch (the desktop compositor
was attributed separately). `glxinfo` identified an AMD Radeon RX 7900 XTX
using radeonsi/navi31, Mesa 25.2.8. Chromium was `153.0.8010.12`; WebGPU
reported `vendor: amd`, `architecture: rdna-3`, empty device/description, and
`isFallbackAdapter: false`. The harness refuses empty browser adapter identity,
fallback adapters, and software identity, so the rows below have browser-side
as well as X-side provenance.

## Completed 256 × 144 measurement

All four fixtures completed their analytic-sphere domains: 36,864 rays,
11,973,260 samples, 1,462 submissions, and zero unresolved rays in each row.
Depth is packed from the public fixture model rather than a pilot default.
Times are milliseconds. `GPU` is timestamp-query kernel time, `host fence` is
the sum of submission fences, and `end-to-end` includes packing, readback,
host transitions, timestamp resolution/map, and the CPU comparison. GPU time
is a lower bound for an eventual renderer, not a settled-frame claim.

| Fixture                          | Core / depth |                 Coverage and events |        State allocation |       GPU | Largest pass | Host fence | End-to-end |
| -------------------------------- | -----------: | ----------------------------------: | ----------------------: | --------: | -----------: | ---------: | ---------: |
| Menger 3D                        |   affine / 9 | 13.53%; 28,304 events on 4,988 rays | 2,854,336 B (2.722 MiB) | 1,214.458 |        1.384 |    3,996.0 |   14,822.9 |
| Pentatope, posed native 4D       | affine4 / 14 |       0.46%; 192 events on 170 rays |             2,852,432 B |    83.940 |        0.189 |    3,876.9 |   12,699.6 |
| Mandelbox Cube 3D                |  escape / 30 | 10.41%; 26,000 events on 3,836 rays |             2,851,296 B |    15.029 |        0.014 |    3,790.9 |   11,893.5 |
| Mandelbox Brick, posed native 4D | escape4 / 30 | 11.17%; 17,124 events on 4,116 rays |             2,851,648 B |    15.871 |        0.015 |    3,878.8 |   13,068.5 |

The Menger kernel alone takes 1.214 seconds and exceeds the proposed 256 ×
144 preview envelope below. The large wall costs also show that summing device
timestamps would omit consequential pilot work. Linear raster scaling from
these rows may be useful for planning, but is only a prediction: it is neither
FPS nor an actual whole-application result.

The pilot camera is `(0, 0, 2.5R)` aimed down negative Z with a 60-degree
vertical field of view. Its 16:9 framing differs from the square visual
studies. On covered rays, measured GPU time divided by coverage is 0.243 ms
for Menger, 0.494 ms for Pentatope, 0.00392 ms for Cube and 0.00386 ms for
Brick. Both 4D timing rows remain unqualified by the predicate gate
below; Pentatope's tiny coverage is especially unsuitable for a general
"4D is cheap" conclusion.

At 64 × 36, the same fixtures completed with batches of both 8,192 and 4,096.
Every fixture had identical event count, event-ray count, and per-ray trace.
That establishes work-chunk invariance for this fixed grid and the measured
kernel path; it does not establish continuation invariance for a future device
implementation.

## CPU/GPU agreement gate

The gate checks 128 f32-uploaded near-boundary points and 128 far points per
fixture against public CPU estimators. It refuses a row on an entry or re-arm
predicate flip and retains raw-distance witnesses separately.
Near points deliberately stress boundaries; this is not a random sample or
an image-error rate. Unfinished rasters and failed or unjudged requested
chunk comparisons also refuse, even if the point witnesses agree. Exit 3
records refusal; exit 2 records missing measurement capability/provenance;
exit 1 is a harness failure. A successful completed measurement exits 0.

Menger passed the predicate gate; its maximum raw difference was
`9.02e-8`. The 3D escape row also passed its event predicates, but it has a
material raw-value discontinuity witness at
`(-0.12038888037204742, 0.16854442656040192, 3.994633913040161)`: CPU returned
`4.000000100681544`, GPU returned `2.794940948486328`, and CPU one-f32-ULP
neighbours ranged from `2.794940679796013` to `4.000000338780273`. This is a
measured precision-sensitive forward-orbit discontinuity, not a widened cap or
a repaired agreement result.

The 4D rows are unqualified for near-boundary classification. Pentatope had a
leave flip at `(0.2677499055862427, -0.5471411347389221,
-0.324232816696167)`: CPU `0.003095147614408829` re-armed while GPU
`0.0030950892250984907` did not; the leave threshold was
`0.0030951428874642114`. Brick had an entry flip at
`(-1.7170442342758179, 0.09719117730855942, 1.9196770191192627)`: CPU
`0.007999938887893082` entered while GPU `0.008000046014785767` did not; the
enter threshold was `0.008`. Their raw maxima were `1.331e-7` and
`6.144e-7`, respectively. Completed sampling does not override these gate
refusals.

## Corrections retained in the record

An early calibration used a stale wrapper item-count path. It is discarded and
excluded from every table because it did not represent the uploaded work. The
pilot now calls the public fixture parameter packer with the actual item count.
An earlier depth-12 pilot default was also removed: the valid rows pack depth
9, 14, 30, and 30 as shown above. Finally, reports made before WebGPU adapter
identity was collected are provenance-incomplete; the rows here were rerun
with the browser adapter check and are the only rows used for the finding.

## Proposed owner-review envelope

This is a proposed review envelope, not an owner approval:

| Requirement              |                                           Proposed limit |
| ------------------------ | -------------------------------------------------------: |
| GPU pass                 |                                                  <= 4 ms |
| 256 × 144 preview        |                                                <= 250 ms |
| 512 × 288 settled result |                                                   <= 2 s |
| 1080p export             |                                                  <= 30 s |
| Additional state         |                                               <= 128 MiB |
| Completion and semantics | zero unresolved rays; unchanged declared event semantics |

The measured Menger row fails the preview criterion by a wide margin before
normal/shading/frame work is added. The 4D near-boundary predicate failures
also prevent claiming the required unchanged semantics.

An optimistic linear kernel-only extrapolation of Menger gives 4.86 s at
512 × 288 and 68.3 s at 1920 × 1080 with the same framing. These are planning
estimates, not certified bounds: scheduling, occupancy and the sampled
geometry can change with raster size. The 72-byte proposed state alone is
142.4 MiB at 1080p, before rear images or existing renderer allocations.
No settled pane or export was implemented or timed.

The recommendation is **no-go for direct generic world-band production
integration** on this evidence. It is not a theorem that all fractal glass is
impossible. A finite solid or explicit proxy can be a different representation
with its own correctness and cost argument; it was not substituted silently in
this pilot.

This record does not measure other platforms, cores beyond the four listed,
lens/slab/balloon paths, tiling, GLSL paths, actual device continuation,
normals, shading, warps, lights, compositor cost, or the production frame
loop. Those omissions define its boundary rather than an approval to infer
them.
