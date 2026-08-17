# `surface-compute.ts` — the WebGPU compute surface renderer, in full

This is the full record behind CLAUDE.md's `surface-compute.ts` bullet
(`src/app/surface-compute.ts`). The bullet in CLAUDE.md is the condensed
routing table and the rules; this document keeps every measured number,
every bead id, and every refuted premise behind it.

## Which sessions route here

`surface-compute.ts` is the WebGPU compute renderer for fold-shaped 3D
surface sessions (fr-tzdg): systems with base-map folds OR a fold FINAL
lens (fr-55s1 — `deHasFolds(de) || foldFinal`; the DE picks the kernel
core and the lens wrapper, and the two first-sizing priors scale by the
lens branch count 27/3/81 ÷ 8). Since fr-dlxh it also takes escape-time
sessions — the non-contracting pure-fold map, or, since fr-s04t, the
CHAIN of them, that the IFS gate refuses. Since fr-dlxh's 4D cut it also
takes plain 4D surface sessions (symmetry order 1).

All of those PREFER compute when an adapter exists: no fold GLSL ever
compiles (the ~25s Mesa link / ~5.7s lens link / fr-096u entry hazards
never engage), and there is no grid request (gridless by decision,
measured).

FOLD-shaped 4D sessions (fr-rsp6: 4D base-map folds or a 4D fold FINAL,
any symmetry order) are compute-ONLY. The fragment 4D tracer
deliberately carries no fold GLSL, so the eligibility gate refuses entry
when compute is unavailable, and a mid-session compute loss exits the
mode with a toast rather than falling back.

KALEIDOSCOPE 4D (non-fold, order > 1) stays on the fragment tracer by
MEASURED verdict: on real Iris at 1024x640, plain 4D compute settles in
4.6s vs the fragment tracer's 8.9s, with object-mask IoU 0.996 between
them — so compute is faster and they agree on the picture. But at order
6 the WGSL sector sweep never settled a 6-minute observation that the
fragment arm settled in 10.9s, a ~35x gap. fr-b72d's closure exonerated
the kernel: the DE's cost is algorithmically superlinear in order for
BOTH arms (CPU-oracle-matched), and the uniform-maps/refinedCert kernel
suspects were refuted on the extended `--surface-aff4-sweep` leg. So the
residual is this module's march-loop scheduling under an expensive-DE
regime — fr-fniy, open.

ESCAPE-shaped 4D sessions (fr-vag4 — a non-flat chain the 4D IFS gate
refuses) are compute-ONLY for the fold-4D reason unchanged: an escape
chain IS fold-shaped, and the fragment 4D tracer carries no
forward-orbit GLSL either, so entry is refused without compute and a
mid-session loss exits with the same toast one family over.

## Targets and cores

`create()` takes a `SurfaceComputeTarget` union,
`{kind:"ifs"|"escape"|"bulb"|"escape4"|"ifs4"}`, whose `kind` picks the
kernel core:

- `ifs4` → affine4 or fold4, off `deHasFolds4` (the 3D `deHasFolds` split
  one dimension up).
- `bulb` → fr-tdin's `core:"bulb"`, structurally the escape arm one
  formula over.
- `escape4` → fr-vag4's `core:"escape4"`.

`isForwardTarget` names the THREE forward-orbit kinds (`escape`, `bulb`,
`escape4`) so a branch cannot serve one and miss another. `isFourDTarget`
names the two kinds whose frame spec must carry `view4` (`ifs4` and
`escape4` — `escape4` is in both sets). The params packer and the maps
buffer's layout/existence are the only things that vary by kind; the
bounded march/shade host loop, progressive presents, and failure ladder
stay shared regardless of kind.

`isForwardTarget` no longer means "no maps buffer": both ESCAPE kinds
carry their formula chain on the maps binding, so every maps-shaped
branch names them ahead of the predicate, and `bulb` is the one
bindingless kind left.

The BALLOON and the FLOOR ride an `ifs4` target since fr-qxxw/fr-h0c3,
with the 3D arm's own precedence (the two never compile together, and
the balloon wins). No FORWARD kind ever balloons, in either dimension.
Escape and plain-affine `ifs4` targets scale no priors (the forward loop
is phone-cheap, and the pessimistic base priors elsewhere only err
toward smaller first slices); fold/lens-shaped `ifs4` targets scale by
branch count the way 3D does.

The `ifs4` kind's rotor/slice view is PER-FRAME SPEC STATE (`spec.view4`,
re-read from the scene's `setSurface4View` state at every spec assembly
and repacked per pass — the fragment tracer's live-uniform discipline
carried across the WebGPU seam; a missing `view4` throws), and
`surfaceComputeForceFrameKey` includes the pose so a timeline leg's
rotor/slice glide never re-presents a stale frame.

`SURFACE_ESCAPE` GLSL and the fragment 4D tracer are the fallback arms
(`?surfacegl` / no adapter / device loss), exactly like
`SURFACE_FOLD_LENS`; the fr-tmgf detail vocabulary widened to cover them
(`surfaceWebglDetail`'s param is `computeShaped` now — every 4D system is
compute-shaped).

MEASURED (fr-55s1, Iris Xe real driver, dev regime): the fr-g58b lens
archetype previews in 0.94s and settles a full 1280x720 frame in 9.4s (0
exhausted) where the WebGL A/B of the same hash was 43% settled at 30s;
the 81-branch mandelbox field class settles in ~35-55s (thermally
variable) against a 2min+ WebGL grind.

The renderer owns the device (bench acquisition idioms + flame-backend
error taxonomy) and the frame loop.

## The frame loop and batch sizing

March slices are sized from a measured per-ray·step EMA. Shade batches
are sized in HIT units (fr-p8bc): terminal rays queue by status — misses
are one background write; hits, and, since fr-rhn5, ground-plane PLANE
terminals, pay the probe evals and arrive scanline-CLUSTERED. Batches are
predicted from a per-hit cost EMA under a pessimistic prior, spike-lift
instantly, decay slowly, and are capped by a slow-trust double/quarter
policy.

The original design doubled capacity in RAY units, which let a run of
misses inflate capacity before a hit band paid for it — that caused five
kernel-confirmed i915 GPU hangs. The fix floors batches at one WORKGROUP,
never one hit: within a workgroup, cost is depth-dominated, so
sub-workgroup batches buy no submission-wall safety. The old 1-hit floor
was a one-way trapdoor — one hit band past the pass target, and every
1-ray batch re-measures the full per-submission wall as its per-hit cost;
spike-lift latches that in, producing ~4 hits/s serialization that reads
as a settle parked forever at a pose-dependent percent. This is fr-d6g5's
Mesa-25.2.8 "park" (see below). The `?surfacetrace` flag and
`scripts/fold-settle-park.repro.mjs` are that diagnosis' kept
instruments.

With the workgroup floor, no submission outruns the i915 watchdog.

Shading probes ride the width-1 greedy descent
(`SURFACE_COMPUTE_SHADE_DE_WIDTH`, the fr-p8bc measured verdict: 23.8x
cheaper shading, eyeball-identical frames). The active list is
host-compacted. Presents are progressive between every bounded piece.

### Compaction reads 4 B per active ray (fr-si66)

Host compaction needs exactly one field of the ray state — the status —
and used to get it by reading the ENTIRE `states` buffer back after every
march sweep: 16 B per FRAME ray, whether the active list still held every
ray or a hundred. The march kernel now writes each dispatched ray's
post-pass status to its own SLOT in the list being rebuilt
(`surface-de-gpu.ts`'s `statusOut` flag), and the sweep reads
`4 × |active|` bytes instead.

Three details make it a plain win rather than a trade:

- The kernel writes SLOT-relative (`statusOut[gid]`), so no params field
  moves — the frozen wire is untouched. Each march slice's dispatch
  carries a `copyBufferToBuffer` into the sweep's staging at that slice's
  own offset, riding the SAME submission, so there is no extra submission
  and no extra fence; the sweep still pays exactly one `mapAsync` round
  trip, as it always did. That copy's (small) cost lands inside the
  measured march time, which is where it belongs.
- The `states` buffer loses its MAP_READ staging twin and its COPY_SRC
  usage: nothing reads it back at all now. A frame's per-ray commitment
  falls 44 B → 36 B (see "Raster limits" below for why the device ceiling
  does not move with it).
- The terminal tally (`SurfaceComputeFrame.counts`) is kept as rays LEAVE
  the active list, with `active` the remainder, replacing a final
  whole-buffer scan of a buffer the loop no longer reads. Same numbers,
  including on truncated frames, where the stranded rays counted as
  ACTIVE before and still do.

The gate came free. `gpu-bench`'s leg B (`runSurfaceComputeFrameLeg` and
its escape/plane/4D siblings) drives the PRODUCTION renderer and gates
`frame.counts.hit` against a CPU sanity march's hit rate — which is now
the side channel's own tally, so mis-indexed slots fail the bench. The
bench's own march legs never set the flag and their generated source is
byte-identical, so no bench edit was needed anywhere.

**MEASURED** (real Iris Xe, headed Chrome on `:0`, one full settle per
arm of the pose-pinned 2-map boxfold pair at a 1400x900 window — a
1.26M-ray pane — via `scripts/march-readback-ab.mjs`, the A/B instrument
this bead left behind; the two arms are the same script against the two
builds, told apart by the trace vocabulary alone):

| per settle                   | before (`states`)   | after (`status`)           |
| ---------------------------- | ------------------- | -------------------------- |
| sweep readbacks              | 58                  | 58                         |
| transferred                  | 923.79 MiB          | 74.82 MiB — **12.3x less** |
| host time blocked            | 739.0 ms            | 102.0 ms — **7.2x less**   |
| per sweep                    | 15.93 MiB / 12.7 ms | 1.29 MiB / 1.8 ms          |
| `present` readback (control) | 33.65 MiB / 54 ms   | 33.65 MiB / 52 ms          |
| `final` readback (control)   | 38.50 MiB           | 38.50 MiB                  |
| frames traced                | 10 (10 completed)   | 10 (10 completed)          |
| settle                       | 35.0 s              | 35.0 s                     |

The 12.3x factors cleanly: **4x** from reading a `u32` status where a
`vec4f` ray state was read, and **3.1x** from paying only for rays still
MARCHING (mean active list 338k against a mean frame raster of 1.04M).
Identical sweep counts and byte-identical control readbacks across the
arms say the march schedule did not move — the arms did the same work.

AND THE WALL TIME DID NOT MOVE, which is the honest half of the result:
637 ms off a 35 s settle is ~1.8%, inside the settle poll's own 5 s
resolution. This settle is SHADE-dominated (fr-p8bc), so the readback was
never its critical path. The saving is transfer volume and host-blocked
time, and it is worth most exactly where fr-biox found the problem — an
export tile at the 4M-ray cap read a flat 64 MB of ray state per sweep,
tens of sweeps a tile, and now reads 4 B per ray still marching.

Proven output-identical rather than argued: `scripts/surface-repro.verify.mjs
--scenario=all --runs=2 --mode=x11::0` was run against BOTH builds, and
every settled PNG is byte-identical across them — boxfold3 (fold core),
lens3 (lens wrapper, hit 60912 both sides, the figure that script's own
doc already recorded), pentatope4 and pentatope4direct (affine4 core),
sierpinski3 (the WebGL arm, control) — each also DETERMINISTIC within its
own build. `npm run bench:surface --display=:0` reports
`surfaceDe: verdict=pass`, and every compute-frame leg's
hit+miss+exhausted sums exactly to its raster (4637+32227 = 36864, and so
on through the escape, chain, ifs4 and fold4 legs), which is the new
tally's arithmetic checked seven ways.

`colorOut` is prefilled from the last frame, nearest-resampled — the
strip settle's preview-seeded-target discipline. fr-f4bx measured what
that buys during MOTION on a slow adapter, where every preview is a
budget-truncated one: the present is the PREVIOUS frame with its newly
resolved rays overwritten, so the pane never shows backdrop mid-drag.
Measured on 1280x720 Firefox WebGPU, dragging into a mandelbox-lens
close-up: mid-drag frames measured 0.98-0.99x the completed preview's
size, i.e. full coverage, and at the extreme a preview resolving ZERO
rays in its 2.2s budget presents the prior image byte for byte. That
refutes the bead's own premise — there is no worse frame being painted
over a better one to suppress, and a coverage threshold on the present
would have had nothing to fix. The pane heals at park through fr-ud7n's
completion pass.

The loop also keeps per-frame status counts for field debugging.

### Presentation and routing

`scene.ts` presents frames as a DataTexture through the shared surface
blit (the one WebGL canvas — capture/recorder unchanged) and assembles
specs with uniform-exact camera/eps/tier quantities (acceptance eps
stays native-height, fr-7xgi). `main.ts` routes and choreographs it: the
same tier clock and preview governor, latest-wins preview coalescing,
plus fr-ud7n's unbudgeted completion pass — the preview frame is the one
an invalidation must CANCEL rather than wait out, since it is the only
one with no wall budget to expire. Offline force frames are memoized.
Fallback is one-way: a create failure or device loss re-enters through
the untouched WebGL path; `?surfacegl` forces WebGL.

## The Mesa park (fr-d6g5)

See "The frame loop and batch sizing" above for the mechanism. In short:
a batch-sizing policy that let ray-unit doubling inflate capacity ahead
of payment, combined with a 1-hit floor, produced a one-way trapdoor on
Mesa 25.2.8 — once a hit band pushed past the pass target, every 1-ray
batch re-measured the full per-submission wall as its per-hit cost,
spike-lift latched it in, and the result was ~4 hits/s serialization: a
settle that reads as parked forever at a pose-dependent completion
percent. The fix is the one-workgroup floor (cost inside a workgroup is
depth-dominated, so a sub-workgroup batch buys no submission-wall
safety). `?surfacetrace` and `scripts/fold-settle-park.repro.mjs` are the
kept diagnostic instruments for this failure mode.

## Supersampling (fr-vpbq, fr-jf9y)

SUPERSAMPLING (fr-vpbq) rides the frame loop as `opts.samples`: N passes
of the same frame at N sub-pixel offsets (`subPixelSample` — pass 0 is
the pixel CENTRE exactly, the rest the R2 low-discrepancy sequence).
Passes are averaged in LINEAR light, because both tracers end with a
`pow(lit, 1/2.2)` encode and averaging the gamma-encoded bytes is the
edge-darkening bug.

It is N FRAMES, not N rays per frame, so the five per-ray buffers and
every watchdog bound stay exactly as measured, and fr-biox's device ray
ceiling is not met N times sooner. The result is PROGRESSIVE: pass 0 is
the pre-fr-vpbq frame, arriving when it always did and presenting its
own partials; every later pass only refines and presents when it lands;
a superseded job keeps what it finished.

The speckle supersampling removes is sub-pixel STRUCTURE — measured, not
march undersampling (`exhausted` reads 0.00% at 20x the step budget) and
not reachable by any viewport (the impulse rate is FLAT across a 4x
resolution range: 16.0-16.1% for the single map, 23.0-23.5% for a
six-link chain, at 128/256/512px). 39-55% of pixels still move by more
than 24/255 between the 1-sample and the 16-sample render, against a
smooth sphere's 0.29% through the same marcher.

fr-azjk re-measured that sheet on a corrected fitted radius and moved one
leg of it: the partial-coverage exponents read -0.34 (single map) and
-0.73 (six links) against the sphere's -0.98 — not the earlier
-0.21..-0.36 — because partial coverage counts SILHOUETTE pixels, and the
old, inflated marching ball drew these objects far smaller than they
actually are. It is the weaker leg either way: a frame-filling object
keeps its structure in its interior, where a silhouette statistic cannot
see it, which is why the six-link row's coverage fell to the sphere's
while its impulse rate rose ABOVE the single map's.

`main.ts` spends supersampling on the live SETTLE and on Save-PNG, at 8
samples — never on a preview (cheap by definition) and never on offline
VIDEO force frames (the cost would multiply by the frame count). The
progress row discloses the pass as a trailing `antialiasing pass k/8`,
silent through pass 1.

THE WEBGL STRIP ARM NOW DOES THE SAME THING (fr-jf9y), and by the same
algorithm rather than a parallel one: it imports `subPixelSample` from
here, averages in linear light, and spends 8 samples on the settle and on
Save-PNG, so "8 samples" has ONE meaning whichever engine a machine has.
An in-shader accumulation loop stayed refused for the reason above
(all-or-nothing per-strip cost fighting the fr-096u/fr-id9r machinery);
instead the settle opens a SEQUENCE of N whole-frame strip jobs, each
armed exactly the way pass 0 is, so the pump, planner, fence groups and
evidence chain are untouched — measured flat per-pass strip counts on
real Iris: 152/258/258/300/258/258/258/258.

The accumulator is HOST-SIDE f32, not a float render target: ~2.1ms
against a ~390ms pass, one sync point per pass and outside any job, so
strip-planner never sees it. This is deliberate — the WebGL arm is the
FALLBACK arm and must not acquire an `EXT_color_buffer_float` dependency
on the devices that have the least capability.

Pass 0 is BYTE-IDENTICAL to the pre-supersampling frame, proved by
building twice and diffing: 0 of 120000 pixels differ on SwiftShader AND
on real Iris, max channel delta 0, the PNGs identical to the byte. That
second run is not ceremony — fr-dlxh's lesson is that a classifier passed
SwiftShader clean and then real Iris flipped six "stable" rows, so
whether Mesa contracts `(vUv + 0.0) * 2.0 - 1.0` differently is a
question only that driver can answer. Edge energy falls 0.846x / 0.851x
on the two adapters, so the supersampling win is the object's own and not
an artifact of the rasterizer.

`?surfacesamples=N` is the escape hatch and the A/B instrument (N=1
restores the exact single-pass behaviour).

## Raster limits and tiled export (fr-biox)

A frame's RASTER is bounded by the device, not the caller (fr-biox). The
six per-ray buffers cost 36 B/ray (44 across five before fr-si66 dropped
the ray state's MAP_READ twin), and it is the 16 B ray state as a BOUND
STORAGE buffer that a limit actually bites on. So `maxFrameRays =
min(maxBufferSize, maxStorageBufferBindingSize) / 16` — unchanged by
fr-si66, which is worth stating because the bead expected otherwise: a
cheaper readback cuts what a frame COMMITS, but the ceiling was never the
total, only the widest bound buffer. A frame that would exceed it
throws `SurfaceComputeFrameSizeError` up front, before reaching the
kernels — because WebGPU refuses SILENTLY here: an over-limit
`createBuffer` call returns an invalid buffer plus a validation error,
and the first actual REJECTION shows up at a staging `mapAsync` call
("Mapping WebGPU buffer failed: Invalid buffer"). That was the field
report: a 4x Save-PNG whose 32.5M rays wanted a 520 MB state buffer
inside a ~1.4 GB frame, with the size that caused it appearing nowhere in
the error.

Both callers size against the ceiling. The live pane FITS
(`fitSurfaceComputeRaster`): one frame IS the image, so a hidpi raster
past the ceiling traces soft and blits up — the preview tier's own
mechanism, disclosed once per session. A capture TILES
(`surfaceComputeTileRows`), also capped at
`SURFACE_COMPUTE_MAX_TILE_RAYS`, so a device reporting gigabytes of
headroom still exports in ~144 MB pieces (~176 MB before fr-si66; the
4M-ray cap itself is unchanged — it was chosen against the watchdog and
the allocator, not against the byte count).

`scene.ts`'s `captureSurfaceComputeFrame` traces the export as full-width
BANDS. Every band's spec is assembled in ONE synchronous span, because a
tiled export must outlive an auto-orbit/drift camera move — this is the
compute answer to the WebGL drain's frozen-uniforms approach. Each band
is a `camera.setViewOffset` sub-frustum, traced at the FULL image's trace
eps, with `surfaceComputeBandStops` restricting the backdrop gradient
pair to the band's own edges (every tracer spreads its gradient stops
over its OWN rasterHeight, so whole-image stops would repeat the gradient
per band). Band frames run with `capture: true`, outside the live pane's
seed chain. One band is the whole image on an ordinary export, and that
path is byte-identical to the untiled path.

`?surfacemaxrays=N` pretends a device ceiling for testing.
`scripts/surface-export-tile.verify.mjs` is the gate: tiled vs untiled
export of one pinned pose measures a mean difference of 0.002/255, with
0.006% of pixels off by more than 8 — the march-start dither's own
per-raster hash phase, nothing structural.

## Teardown (fr-uec4)

`destroy()` defers the real `device.destroy()` until every in-flight
frame unwinds. fr-uec4: a frame parks on LIVE submitted GPU work —
`mapAsync` over a submitted `copyBufferToBuffer`, or
`onSubmittedWorkDone` over a submitted dispatch — and tearing the device
down under one of those took down the WHOLE Firefox process, not just a
tab crash or a device-loss toast.

`destroyed` now means "teardown requested" and `deviceDestroyed` means
"device gone" — the guard that stops both the idle path (`destroy()`
itself) and the drain path (`releaseFrame`, when the last in-flight frame
unwinds) from calling `device.destroy()` twice. The synchronous teardown
still runs whenever the device IS idle, which is what keeps gpu-bench's
one-device-alive-at-a-time invariant and `RenderSession.terminate()`'s
`void` contract untouched.

The same shape was open one module over and is now closed with the same
vocabulary: `flame-gpu-backend.ts` (fr-mxkk) counts OPS where this module
counts frames.
