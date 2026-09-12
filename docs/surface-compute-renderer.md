# `surface-compute.ts` — the WebGPU compute surface renderer, in full

This is the full record behind CLAUDE.md's `surface-compute.ts` bullet
(`src/app/surface-compute.ts`). The bullet in CLAUDE.md is the condensed
routing table and the rules; this document keeps every measured number,
every measurement narrative, and every refuted premise behind it.

The separately retained background sidecar, its nonlinear supersampling
boundary, and the decision not to retain exact re-shading state are recorded in
[`surface-background-layer.md`](surface-background-layer.md).

## Which sessions route here

`surface-compute.ts` is the WebGPU compute renderer for fold-shaped 3D
surface sessions: systems with base-map folds OR a fold FINAL lens
(`deHasFolds(de) || foldFinal`; the DE picks the kernel core and the lens
wrapper, and the first march slice's prior scales by the lens branch count
27/3/81 ÷ 8). Since the escape port it also takes escape-time sessions — the
non-contracting pure-fold map, or the CHAIN of them, that the IFS gate
refuses. Since that port's 4D cut it also takes 4D surface sessions — plain
ones from the cut itself, and every other 4D system since the shade-sizer
width fix.

All of those PREFER compute when an adapter exists: no fold GLSL ever
compiles (the ~25s Mesa link / ~5.7s lens link / i915-preemption entry
hazards never engage), and there is no grid request (gridless by decision,
measured).

FOLD-shaped 4D sessions (4D base-map folds or a 4D fold FINAL, any symmetry
order) are compute-ONLY. The fragment 4D tracer deliberately carries no fold
GLSL, so the eligibility gate refuses entry when compute is unavailable, and
a mid-session compute loss exits the mode with a toast rather than falling
back.

KALEIDOSCOPE 4D (non-fold, order > 1) came here too with the shade-sizer
width fix, so there is no order split left: EVERY 4D session prefers
compute, and the fragment 4D tracer is its fallback arm.

That line moved twice. The 4D cut kept order > 1 on the fragment tracer
because the WGSL sector sweep never settled a 6-minute observation the
fragment arm settled in 10.9s. The 4D kernel-cost investigation exonerated
the kernel — the DE's cost is algorithmically superlinear in order for BOTH
arms (CPU-oracle-matched), and the uniform-maps/refinedCert suspects were
refuted on the extended `--surface-aff4-sweep` leg. The off-centre-slice
investigation then made both arms forceable and re-measured: WebGL 147s
against compute 179s, a 1.2x sitting inside the fragment arm's own
147/444/604s spread, so the rule stood on a null result. The shade-sizer
width fix found what the compute arm was actually spending that time on — a
hit-shade batch width that was its cost model's attribution pivot rather
than anything about the scene — and fixing it moved the row decisively.
MEASURED, real Iris Xe at 1024x640, identity rotor, both arms forced,
`scripts/slice-cliff.probe.mjs --arm=both --slices=0 --settle=1`:

| scene                               | WebGL       | compute    |
| ----------------------------------- | ----------- | ---------- |
| plain4 (3 maps, order 1)            | 11.5 s      | 3.0 s      |
| kaleido4 (2 maps, order 6, twist 1) | **637.5 s** | **53.1 s** |

53.1s is 2.8x faster than the FASTEST run the fragment arm has ever recorded
on that scene and 12x this cell's, with a ~5% run-to-run spread against a 4x
one — no longer a null result in either magnitude or repeatability. First
frame moves the same way, 0.21s against 4.86s. The two arms agree on the
picture: `scripts/surface-4d.verify.mjs` step (e) holds them to an
object-mask IoU on both scenes (plain 4D measured 0.996 at the 4D cut), and
both settle the same 8 supersampling passes at `subPixelSample`'s offsets,
which the strip pump and this module share by import.

What the 12x does NOT buy is a cheap scene: kaleido4 is still tens of
seconds, because the DE's superlinear order cost is paid by whichever arm
renders it. That is disclosed by the progress row, never a refusal.

ESCAPE-shaped 4D sessions (a non-flat chain the 4D IFS gate refuses) are
compute-ONLY for the fold-4D reason unchanged: an escape chain IS
fold-shaped, and the fragment 4D tracer carries no forward-orbit GLSL
either, so entry is refused without compute and a mid-session loss exits
with the same toast one family over.

A TILED session (finite or mirrored-lattice) routes exactly where its
untiled shape routes — the tiling block rides the `SurfaceComputeTarget`
and the frame specs' params packers derive the carrier from it, so the
lattice session marches the presentation carrier (sphere ∩ attractor-y
slab at the frozen 10R window) through the same bounded loop, then fades
coverage from 8R to backdrop in the shared shade entry used by every core,
supersampling pass and capture tile. The lattice camera
frames the canonical cell, never the global lattice, and a lattice
session never requests the empty-space grid (its floors bound the
attractor, not the infinite mirror image).

## Targets and cores

`create()` takes a `SurfaceComputeTarget` union,
`{kind:"ifs"|"escape"|"bulb"|"escape4"|"ifs4"}`, whose `kind` picks the
kernel core:

- `ifs4` → affine4 or fold4, off `deHasFolds4` (the 3D `deHasFolds` split
  one dimension up).
- `bulb` → `core:"bulb"`, structurally the escape arm one formula over.
- `escape4` → `core:"escape4"`.

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

The BALLOON and the FLOOR ride an `ifs4` target since their own 4D lifts,
with the 3D arm's own precedence (the two never compile together, and the
balloon wins). No FORWARD kind ever balloons, in either dimension. Escape
and plain-affine `ifs4` targets scale no prior (the forward loop is
phone-cheap, and the pessimistic march prior only errs toward smaller first
slices); fold/lens-shaped `ifs4` targets scale by branch count the way 3D
does. Only the MARCH slice has a prior to scale since the two-term shade
cost model — the shade sizer opens with an empty cost model and a
one-workgroup capacity.

The `ifs4` kind's rotor/slice view is PER-FRAME SPEC STATE (`spec.view4`,
re-read from the scene's `setSurface4View` state at every spec assembly
and repacked per pass — the fragment tracer's live-uniform discipline
carried across the WebGPU seam; a missing `view4` throws), and
`surfaceComputeForceFrameKey` includes the pose so a timeline leg's
rotor/slice glide never re-presents a stale frame.

`SURFACE_ESCAPE` GLSL and the fragment 4D tracer are the fallback arms
(`?surfacegl` / no adapter / device loss), exactly like `SURFACE_FOLD_LENS`;
the render-backend detail vocabulary widened to cover them
(`surfaceWebglDetail`'s param is `computeShaped` now — every 4D system is
compute-shaped).

MEASURED (at the fold-lens compute port, Iris Xe real driver, dev regime):
the fold-FINAL lens archetype previews in 0.94s and settles a full 1280x720
frame in 9.4s (0 exhausted) where the WebGL A/B of the same hash was 43%
settled at 30s; the 81-branch mandelbox field class settles in ~35-55s
(thermally variable) against a 2min+ WebGL grind.

The renderer owns the device (bench acquisition idioms + flame-backend
error taxonomy) and the frame loop.

`create()`'s opts also carry the session's gated finishes: `null` means
classic — today's kernels unchanged — and non-null compiles `finish: true`
and packs the stride-3 shadeMaps. Finishes are compiled at create time, like
colors, rather than read per frame; the frame spec still discloses the finish
list so the offline force-frame memo re-traces a finish-only leg instead of
serving a stale frame.

## The frame loop and batch sizing

March slices are sized from a measured per-ray·step EMA, and `stepsThisPass`
doubles toward 32 whenever a whole sweep fits one slice. The shade-sizer
width fix priced that half and found it small — 5.8% of a settle before its
own fix, 19.9% after, with the sweep readbacks at 0.06% and ~2% of the
settle in per-dispatch fixed cost — so the EMA's shape is a known, measured,
declined lever rather than an unexamined one. Shade batches are sized in HIT
units (the shading probe's second lesson): terminal rays queue by status —
misses are one background write; hits, and ground-plane PLANE terminals, pay
the probe evals and arrive scanline-CLUSTERED. Batches are predicted from a
two-term cost model — `intercept + n·marginal`, whose whole record is two
sections down — under a slow-trust double/quarter capacity ladder, and the
WIDTH that model asks for is the attribution pivot's rather than the
scene's, which is the width fix's finding and the section after the cost
model's.

The original design doubled capacity in RAY units, which let a run of misses
inflate capacity before a hit band paid for it — that caused five
kernel-confirmed i915 GPU hangs. The fix floors batches at one WORKGROUP,
never one hit: within a workgroup, cost is depth-dominated, so sub-workgroup
batches buy no submission-wall safety. The old 1-hit floor was a one-way
trapdoor — one hit band past the pass target, and every 1-ray batch
re-measures the full per-submission wall as its per-hit cost; the estimate
latches that in, producing ~4 hits/s serialization that reads as a settle
parked forever at a pose-dependent percent. This is the Mesa-25.2.8 settle
"park" (see below). The `?surfacetrace` flag and
`scripts/fold-settle-park.repro.mjs` are that diagnosis' kept instruments.
The cost model's finding is that the SAME trapdoor ran at every width below
the occupancy knee, not only at n=1, and that the fix for it is a cost model
with an intercept rather than a wider floor.

With the workgroup floor, no submission outruns the i915 watchdog.

Shading probes ride the width-1 greedy descent
(`SURFACE_COMPUTE_SHADE_DE_WIDTH`, the probe-width verdict: 23.8x cheaper
shading, eyeball-identical frames). The active list is host-compacted.
Presents are progressive between every bounded piece.

### Compaction reads 4 B per active ray

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
  fell 44 B → 36 B; the later background-layer output and staging twin
  bring the total back to 44 B (see "Raster limits" below for why the
  device ceiling still does not move).
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
that work left behind; the two arms are the same script against the two
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
resolution. The first draft of this record ASSERTED why ("the settle is
shade-dominated") — so the instrument grew a WHERE THE TIME WENT line and
the same settle was re-run to find out. Measured, same scene and raster:

| GPU submissions + sweep readbacks | count | ms      | share     |
| --------------------------------- | ----- | ------- | --------- |
| shade dispatches                  | 2634  | 23070.8 | **84.8%** |
| march dispatches                  | 114   | 4013.9  | 14.8%     |
| sweep readbacks (after)           | 58    | 107.0   | **0.4%**  |

So the assertion held — but the number is the point: the status side channel
moved the readback from ~2.7% of that total to 0.4%, of a settle whose other
99.6% is the shade half. The saving is transfer volume and host-blocked
time, and it is worth most exactly where the raster-ceiling field report
found the problem — an export tile at the 4M-ray cap read a flat 64 MB of
ray state per sweep, tens of sweeps a tile, and now reads 4 B per ray still
marching.

That table also says something that work did not set out to find, and which
became the free/hit shade-drain split — and a MEAN over the two shade queues
is not a finding, so the instrument grew one more regex (the `shade BEGIN
isFree=` flag) and the settle was run once more. The 84% splits:

| shade dispatches | count | ms      | share | mean     |
| ---------------- | ----- | ------- | ----- | -------- |
| free (miss)      | 2492  | 7926.7  | 29.3% | 3.2 ms   |
| hit              | 135   | 14881.1 | 55.0% | 110.2 ms |

Both halves say something, and the first draft of this paragraph had the
first one wrong by an order of magnitude. **Free batches are 29%, not 84%**:
the flat 4096-ray cap the two queues then shared is 4096 rays of one
background write each costing 3.2 ms, which IS the per-submission wall
(there is no work in it), so a 1.26M-ray frame spends ~307 submissions
painting backdrop, times the 8 supersampling passes. Raising that cap 16x
has a hard ceiling of 7.9 s on this 35 s settle — real, bounded, ~22%, and
NOT "most of the settle". (What raising it actually bought is the next
section, and it beat that ceiling.) **The hit half is the bigger one** — 135
dispatches x ~178 hits at ~0.62 ms per hit, the width-1 probe cost the
probe-width verdict already cut 23.8x, re-paid by every one of the 8 passes
— and this record closed by calling it real work no batch-cap change
touches. That last clause did not survive its own instrument: see "The hit
half is not work either" below.

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

### The free shade queue drains whole

The split above left the free half's cap un-run, and the answer turned out
to be that there is no cap to pick: THE FREE QUEUE HAS NO COST TO MODEL.
Every exit the shade entry offers a non-HIT status is the same two lines —
evaluate the backdrop ramp at this pixel's row, store it — and that is
checked per core rather than assumed, which is what the split's own design
asked for: EXHAUSTED falls through the same `st.y != HIT` exit as MISS in
all seven, and the ground plane's PLANE terminals are queued with the HITS,
where their probe evals belong. So the free queue now drains WHOLE, one
dispatch per march sweep, bounded by nothing but the device's own dispatch
ceiling. `SURFACE_COMPUTE_MAX_SHADE_BATCH` became
`SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH` with it: one constant standing for
both queues is what let a MEAN over them read as a finding in the first
place.

**MEASURED** (`scripts/march-readback-ab.mjs` again, same pose-pinned
2-map boxfold pair, same 1400x900 window / 1.26M-ray pane, same real Iris
Xe; the arms are the two builds):

| per settle             | before (4096 cap) | after (whole queue) |
| ---------------------- | ----------------- | ------------------- |
| settle wall            | 35.0 s            | **25.0 s** (−28.6%) |
| free shade dispatches  | 2492              | **58** — one/sweep  |
| free shade GPU time    | 8047.7 ms (29.3%) | 232.6 ms (1.1%)     |
| mean per free dispatch | 3.2 ms @ 4096     | 4.0 ms @ ~1.2M      |
| hit shade              | 140 / 15193.2 ms  | 150 / 15927.6 ms    |
| march                  | 114 / 4143.9 ms   | 114 / 4030.0 ms     |
| sweep readbacks        | 58 / 112.0 ms     | 58 / 103.0 ms       |
| present readbacks      | 7 / 47.0 ms       | 4 / 26.0 ms         |

The mean column is the one-line proof that the 3.2 ms was wall and not
work: **~300x the rays for 25% more time**. The hit and march rows are
the controls, and they move by run-to-run variance alone (a third run of
the same after build read 140 / 15157.1 ms of hit shade — the spread
between two runs of one build, not a difference between builds). The free
dispatch count
landing exactly on the sweep count (58) is the other — the queue is
emptied every time it is touched, so the floor is now "how many times
does a march sweep terminate a ray", which is a property of the march
schedule and not of any cap.

AND IT BEAT ITS OWN PREDICTED CEILING, which is worth saying because the
predicted ceiling was 7.9 s and the settle gave up 10.0 s. The extra ~2.1 s
is host-side and outside the GPU accounting entirely: 2434 fewer dispatches
is 2434 fewer command encoders, `writeBuffer` uploads and
`onSubmittedWorkDone` round trips (~1.15 ms each here), plus three fewer
whole-frame present readbacks that used to fire inside the free drain.
Accounted GPU time fell 7.2 s; the settle fell 10.0 s.

`scripts/surface-repro.verify.mjs --scenario=all --runs=2 --mode=x11::0`
against both builds measured the same thing a second way, at 1280x720,
per SETTLE, and across five scenes rather than one — and its numbers are
the ones that say who the change is FOR:

| scenario (compute)      | before     | after     | settle wall |
| ----------------------- | ---------- | --------- | ----------- |
| pentatope4 (5.7k hits)  | 256 passes | 35 passes | −42.7%      |
| pentatope4direct        | 255 passes | 41 passes | −38.9%      |
| boxfold3 (1.8k hits)    | 253 passes | 32 passes | −30.4%      |
| lens3 (60.9k hits)      | 268 passes | 61 passes | −17.8%      |
| sierpinski3 (WebGL arm) | —          | —         | control     |

The pass counts fall by 210-225 in every row, which is exactly `misses /
4096` for each raster — the free drain, and nothing else. The WALL falls
least on lens3 and most on the sparse 4D slices, which is the change's own
prediction confirmed and the honest way to describe the feature: the saving
scales with the MISS count, so the frames that take longest benefit least.
It is 3D and 4D alike (the affine4 core has no folds and gains the most
here), and it is one number, not a quality knob — every settled PNG across
all ten runs is byte-identical between the two builds, and each is
deterministic within its own build.

BOTH SIZING PATHS NOW CLAMP AT THE DEVICE'S DISPATCH CEILING
(`surfaceComputeMaxDispatchRays`), and neither did before. Every dispatch
here is one-dimensional at 64 threads per workgroup, so
`maxComputeWorkgroupsPerDimension` is a ray count once multiplied
through — 4,194,240 at the spec minimum this renderer never raises. A
free batch asks for its whole queue by design, and a march slice comes
out of a measured cost EMA a cheap far-field frame can drive low enough
to ask for the whole active list; either can exceed that on a raster the
memory ceiling allows, since a spec-minimum 128 MiB binding is 8.4M rays.
WebGPU answers an over-limit `dispatchWorkgroups` with a validation error
that invalidates the encoder, so the submission would silently do NOTHING
and those pixels would keep their seed — a latent, hidpi-only wrong-image
path, not a crash. `surfaceComputeMaxFrameRays` deliberately does NOT
meet the same ceiling: a frame's rays are a memory question and a
dispatch's are a submission-shape one, and folding them together would
make a 4K pane fit one rung softer for a bound no single piece of work
has to meet.

### The hit half is not work either — it is wall (the free/hit split found it, the two-term model fixed it)

The compaction record two sections up closes by calling the hit queue "real
work no batch-cap change touches". That is wrong, and the free-queue work's
own instrument is what says so. A third run of the shipped build printed the
new HIT SHADE COST vs BATCH SIZE table (140 hit dispatches, 15157.1 ms):

| batch size | dispatches | hits | totalMs | meanMs/disp | meanUs/hit |
| ---------- | ---------- | ---- | ------- | ----------- | ---------- |
| 1-63       | 32         | 591  | 2791.4  | 87.2        | 4723.2     |
| 64-127     | 50         | 4023 | 5142.6  | 102.9       | 1278.3     |
| 128-255    | 39         | 7109 | 4636.1  | 118.9       | 652.1      |
| 256-511    | 19         | 6238 | 2587.0  | 136.2       | 414.7      |

Cost per DISPATCH rises 1.56x while hits per dispatch rise ~11x — a
latency-bound dispatch, and the flat region reaches at least 8
workgroups where `shadeHitBatchSize`'s own argument only claims one.

THE TABLE ALONE PROVES NOTHING, which is the methodological half worth
keeping: batch size is CHOSEN from the cost EMA against a fixed ms/dispatch
target, so "small batches have high µs/hit" is close to tautological — the
sizer would draw that shape whether or not the small batches were really
more expensive per hit. So the discriminating experiment was run: force the
batch floor to 512 so size varies INDEPENDENTLY of the EMA, same scene, same
pose, same window. Settle 25.0 s → **15.0 s**, hit shade 15157.1 → **7853.3
ms**, dispatches 140 → 70, and mean ms/dispatch 108.3 → 112.2 — UNCHANGED,
which is the whole result. Cumulative from the baseline before the
free-queue drain that is 35.0 s → 15.0 s, 2.33x.

The root cause was one line and it is the settle park's trapdoor one order
up: `nextShadeHitEmaUs` was fed `shadeMs * 1000 / batch.length`, a
submission's WHOLE time over its ray count, so a 16-hit batch recorded its
~85 ms latency floor as 5.2 ms per hit where the marginal cost is ~0.26 ms —
and the sizer then divided the pass target by that inflated number and
picked another small batch. The park fix cured the degenerate 1-ray case
with a one-workgroup floor; the loop ran at every width below the occupancy
knee. That intercept is NOT the per-submission wall (the free queue measured
that separately at 3-4 ms, so at most ~0.6 s of the 15.2 s was submission
overhead) — it is the batch's DEEPEST ray, since lanes run in parallel
across EUs and a batch's hits come from one scanline band.

THE FLOOR WAS THE EXPERIMENT, NOT THE DESIGN, and the two-term model shipped
instead. A floor is a one-way promise to submit that much work whatever the
measurements believe, and this is the exact mechanism behind five
kernel-confirmed i915 hangs and the Mesa park.

#### What shipped

`ShadeHitCost` is `cost(n) = intercept + n·marginal`, in µs, and seven
pieces hang off it.

1. **The model replaces the per-hit EMA.** `shadeHitBatchSize` divides
   the budget by the MARGINAL term after paying the intercept, so a
   narrow dispatch no longer teaches the sizer that hits are expensive.
2. **The attribution is by width.** One observation, two unknowns, so
   `nextShadeHitCost` splits the surprise `w = n / (n + 512)` to the
   marginal and the rest to the intercept — a one-workgroup batch is
   nearly all fixed cost, a wide one is nearly all marginal. 512 is eight
   workgroups, the width the table above measured the cost curve still
   flat at. The split is exact-fitting (after the update the model
   reproduces the measurement at that width), so nothing is
   double-counted in either direction, and a genuine spike still cuts the
   next batch by more than 6x in ONE step.
3. **The allowance is `max(pass target − intercept, intercept)`**, i.e.
   fill the pass target, or spend at most as much on hits as the fixed
   cost already being paid — and never past what
   `SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS` leaves. Below the knee that
   is just the 250 ms pass target; above it — mandelboxKifs measures a
   630-1280 ms intercept — refusing to widen buys no safety at all,
   because the wall IS the intercept, and costs an order of throughput.
4. **The capacity ladder's growth threshold is that budget**, not a fixed
   `PASS_TARGET / 2`. That constant was the OTHER half of the stall: it
   froze the capacity at whatever width cost 125 ms, ~256 hits on the
   boxfold pair against a measured optimum of ~1050.
5. **One sizer per supersampling JOB.** Passes 1..N−1 differ from pass 0
   by a sub-pixel offset and nothing else, so re-learning the model from
   one workgroup eight times over was eight climbs for one frame's worth
   of information. Across FRAMES the pose can jump, which is exactly what
   the ladder's first-encounter bound is for, so the carry stops there.
6. **A partial hit batch is HELD for the next sweep.** Draining the queue
   to empty after every sweep paid the intercept for slivers: measured 6
   hit dispatches per settle frame where the sizer had priced 2. The hold
   ends when the march can no longer add to the queue (so the outer
   loop's own condition still drains it before the frame ends) or when
   one progressive-present interval has passed since the last hit
   dispatch (so the screen keeps developing). Rays held over a budget cut
   keep their seed pixels, which after the first frame is the previous
   frame's shading of very nearly the same geometry, not backdrop — a
   new, bounded loss on truncated frames (at most one batch's worth, and
   only the preview path passes a wall budget at all).
7. **The marginal may not fall by more than half on one measurement**
   (`SURFACE_COMPUTE_SHADE_MARGINAL_DECAY`). The model clamps it at zero,
   and zero means FREE: without a rate limit one cheap dispatch has the
   sizer asking for the entire capacity, which on a fold monster is a
   multi-second submission. It is reachable rather than theoretical — a
   wide batch of ground-plane terminals, which the ground plane queues
   WITH the hits but which shade analytically, is exactly that surprise
   landing on a model converged to expensive fold hits, and it is the
   hit-unit sizing lesson's "a cheap run inflates the capacity a hit band
   then pays" re-opened one level up, in the cost model rather than in the
   queue. Halving bounds the next
   batch at twice the last, the rate the ladder already enforces, and it
   costs nothing measured (the marginal's real per-dispatch moves during a
   convergence are a few percent).

There is no per-hit cost PRIOR any more. `SURFACE_COMPUTE_INITIAL_HIT_SHADE_US`
(20 ms/hit) could only ask for fewer hits than the one-workgroup starting
capacity already gives, while its 0.4-per-dispatch decay held ~7
dispatches at the floor before the measurements it was guarding against
could speak. The capacity ladder is the first-encounter bound; the model
is the sizer.

#### Measured (real Iris Xe, Mesa 25.2.8, headed Chrome on `:0`)

`scripts/march-readback-ab.mjs`, one settle per arm, the pose-pinned
`boxfoldPair` at 1400x900 (1.26M rays) — the free-queue section's own scene,
so the numbers chain:

| arm                  | settle       | hit shade     | hit disp | ms/disp | disp/frame | worst dispatch      |
| -------------------- | ------------ | ------------- | -------- | ------- | ---------- | ------------------- |
| shipped              | 25029 ms     | 14807.4 ms    | 139      | 106.5   | 13.9       | 181.2 ms @ len 369  |
| + cost model         | 15016 ms     | 6248.0 ms     | 57       | 109.6   | 5.7        | 173.6 ms @ len 491  |
| + partial-batch hold | **10072 ms** | **2650.4 ms** | **20**   | 132.5   | **2.0**    | 188.3 ms @ len 2197 |

The middle row is the forced-512-floor experiment reproduced by the model
rather than by a constant, to the second (15.0 s both times). Cumulative
from the baseline before the free-queue drain: **35.0 s → 10.1 s, 3.5x**. A
converged frame now shades all ~2240 of its hits in ONE 2246-hit dispatch of
174 ms; it used to take 14 dispatches and 1.8 s.

The same run's cost-vs-width table extends those two buckets further, and
the last column is the whole argument:

| batch size | dispatches | hits  | totalMs | meanMs/disp | meanUs/hit |
| ---------- | ---------- | ----- | ------- | ----------- | ---------- |
| 1-63       | 3          | 95    | 177.0   | 59.0        | 1863.2     |
| 64-127     | 1          | 64    | 134.9   | 134.9       | 2107.8     |
| 128-255    | 2          | 378   | 213.8   | 106.9       | 565.6      |
| 256-511    | 2          | 724   | 263.5   | 131.8       | 364.0      |
| 512-1023   | 3          | 2389  | 379.9   | 126.6       | 159.0      |
| 1024+      | 9          | 14311 | 1481.3  | 164.6       | **103.5**  |

`lens3` (the fold-FINAL lens, ~93k hits per frame — the frame-FILLING case)
gains less and for a reason worth writing down: its per-hit cost is 17 µs,
so its big batches were already pinned at
`SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH` (4096) in BOTH arms and only the ramp
and the queue-limited slivers moved. Settle 35031 → 30034 ms (−14.3%), hit
shade 18084.4 → 13004.2 ms, 356 → 208 dispatches, worst dispatch 77.4 → 76.1
ms. (Its ~25 ms intercept is three orders under the dispatch ceiling, so the
ceiling correction below does not touch it.)

`mandelboxKifs` at 800x520 does not settle at all, so it was run as a
fixed 150 s window on each arm. It is the fold monster, and it is where
the ceiling's PLACEMENT turned out to matter more than anything else in
this change — the sizer that never got past 127 hits there now spends 86
of its 98 dispatches at 512-1023:

| arm             | hit disp | hits shaded | hit shade ms | hits/s    | worst dispatch      | p95    |
| --------------- | -------- | ----------- | ------------ | --------- | ------------------- | ------ |
| shipped         | 134      | 7961        | 127376.8     | 62.5      | 1714.8 ms @ len 64  | 1377.3 |
| 1000 ms ceiling | 112      | 13900       | 126815.1     | 109.6     | 1735.1 ms @ len 64  | 1515.5 |
| 2000 ms ceiling | 98       | 45178       | 119220.7     | **379.0** | 1731.3 ms @ len 512 | 1638.8 |

**6.1x the hits per second on the hardest scene the project has, and the
worst single submission did not move across any of the three arms**
(1714.8 / 1735.1 / 1731.3 ms). These historical measurements predate the
deterministic `BOOT_SEED`: the scene was pose-less, so its then-random boot
cloud auto-framed each arm differently. The runs therefore were not
identical work — read the ratio as an order-of-magnitude statement, and the
worst-dispatch column, measured over ~100 dispatches per arm, as the reliable
one. Current direct pose-less boots reuse `BOOT_SEED`, and their async
full-density upgrade keeps `fit:false`, so neither the initial frame nor the
upgrade introduces that camera drift.

Its own cost-vs-width table is the cleanest statement of the finding
anywhere in this record — from 16 hits per dispatch to 512, cost per
dispatch goes 643.8 → 1015.4 ms (1.58x) while hits per dispatch go 32x,
i.e. 39253 → 1983 µs/hit (the 1000 ms arm, where the sizer visited every
bucket):

| batch size | dispatches | hits | totalMs | meanMs/disp | meanUs/hit |
| ---------- | ---------- | ---- | ------- | ----------- | ---------- |
| 1-63       | 5          | 82   | 3218.8  | 643.8       | 39253.7    |
| 64-127     | 75         | 5011 | 90364.6 | 1204.9      | 18033.2    |
| 128-255    | 16         | 2800 | 15788.2 | 986.8       | 5638.6     |
| 256-511    | 12         | 3959 | 13382.0 | 1115.2      | 3380.1     |
| 512-1023   | 4          | 2048 | 4061.5  | 1015.4      | 1983.2     |

#### The ceiling was strangling the scene it was there to protect

The dispatch ceiling shipped at 1000 ms and an adversarial read of the sizer
found why that was wrong before any of it reached hardware. A ceiling on the
predicted TOTAL necessarily squeezes the allowance to nothing as the
intercept approaches it — the intercept is measured, not chosen, so the only
lever a total ceiling leaves is refusing to put hits in a dispatch that is
going to cost that much anyway. That is the park's trapdoor rebuilt inside
its own replacement, and at 1000 ms it was not theoretical: mandelboxKifs's
model reaches an intercept of 960 ms, where the allowance had fallen to 38
ms and the sizer floored at one workgroup while a 500-hit batch would have
cost 4% more.

The fix is placement, not shape. The squeeze has to sit outside the range
real scenes measure in, and 2 s is where a dispatch's FIXED cost alone is
already a watchdog conversation — declining to widen THAT is the right
answer rather than a trapdoor. What the move bought, measured on the fold
monster: **3.5x the hits per second (109.6 → 379.0) at an unchanged worst
dispatch (1735.1 → 1731.3 ms)**. The 1000 ms constant was costing more
throughput than everything else in this change put together, on the one
scene that most needed it, and buying no watchdog margin for it.

Two smaller corrections from the same read, both shipped: the marginal's
fall is rate-limited (piece 7 above), because clamping it at zero let one
cheap dispatch ask for the whole capacity; and the capacity ladder's own
doc comment claimed to be "the ONLY bound on the first encounter with an
unmeasured-cost region", which is false once the model is calibrated —
the ladder saturates at the maximum within about six dispatches and
thereafter binds nothing, by design (the model sizes, the ladder paces
the climb out of an empty model). Three test assertions were vacuous and
are rewritten: one fed a measurement equal to the model's own prediction,
so the function returned its input unchanged and the assertion reduced to
`1051 > 0.9 × 1051`; the convergence simulation passed with the intercept
term disabled entirely, and now pins the RECOVERED terms rather than only
the width.

#### The watchdog question, answered by measurement rather than by a divisor

The reason the free-queue work did not ship the floor was that its safety
arithmetic ran through a measured AVERAGE (the probe-width A/B's ~108 ms/hit
at full width, ÷23.8 for the shipped width-1 probe) and that the A/B had not
run the near-surface fold-monster silhouettes. So `march-readback-ab.mjs`
grew three things for the cost model: a WORST SINGLE DISPATCH block with a
p95 beside it (a mean cannot answer a watchdog question), a HIT DISPATCHES
PER FRAME table (the sizer's ramp is per job, so a per-settle total hides
how much of a frame is spent climbing), and the scenes to ask on —
`--scene=lens3` for the frame-filling lens archetype plus a `--hash=` escape
hatch for anything else. All three scenes were then run on both arms. The
answer:

- **boxfoldPair: 181.2 ms → 188.3 ms** while the batch that produced it
  went from 369 hits to 2197 — 6x the width for 4% of the wall. That is
  the flat-cost-vs-width claim proven end to end, and it is the single
  most useful line in the dataset.
- **lens3: 77.4 ms → 76.1 ms**, at 4096 and 3728 hits respectively.
- **mandelboxKifs: 1714.8 → 1735.1 → 1731.3 ms** across the three arms.
  The worst submission on the fold monster is a property of the scene's
  deepest ray, not of the sizer's width: the shipped arm hit its worst at
  `len=64` — the FLOOR — and the final arm hit the same number at
  `len=512`. 1.7 s is 4.3x under the ~7.5 s i915 watchdog, and it was
  already there before this change.

`scripts/fold-settle-park.repro.mjs` (mandelboxKifs at 512x320, the
settle-park regression gate) never reports PARKED-WEDGED — the trace log
never stops growing on any arm — and its own trace shows the same flat curve
at a third raster (33 hits per dispatch costs 732.6 ms, 433 costs 921.8 ms).

At its documented default `--parkMs` it reports TIMEOUT, and its percent
readout is a fourth independent measurement of the change: **37% of the
settle in a 400 s window against the pre-change build's 10% in the same
window.**

ITS PARKED-**SPINNING** VERDICT, WHICH THIS SESSION TRIPPED, IS NOT ABOUT
THE RENDERER — and establishing that cost a control run worth keeping.
The probe's staleness test reads an INTEGER percent, and this scene at
this viewport resolves ~1 percentage point per 80 s of entirely healthy
work (a settle frame's whole shade phase is ~1.4 points of an 8-pass
job). Run at `--parkMs=90000`, tighter than the probe's own 150 s
default, the FIXED build reported PARKED-SPINNING at 12% — so the
pre-change build was run as a control on the same cap and reported **the
same verdict** at 10%, having taken 350 s to reach a frozen integer where
the fixed build took 190 s. The fixed build is strictly further along at
every instant and reported "parked" sooner only by arriving at a frozen
integer sooner. The probe's header now carries that so the next session
does not re-derive it, and PARKED-WEDGED — the trace log itself frozen —
is the verdict that means what it says.

AND the probe-width A/B's ~108 ms/hit — the number that safety arithmetic
ran through — is ITSELF a whole-submission-over-rays figure, which is to say
the exact statistic this section's finding says is not a per-hit cost. Its
frame was 660 hits in 31 s at width 1, i.e. 47 ms per hit amortized, where
the marginal cost fitted over the widest lever available here (16 to 512
hits per dispatch on the 800x520 run above) is ~0.75 ms/hit against a ~630
ms intercept. So the divisor was not merely uncertain in degree, it was
measuring the wrong quantity, and no arithmetic on it could have bounded a
submission in either direction. That is why the answer had to be a measured
WORST DISPATCH rather than a computation.

Fit the intercept over a WIDE lever or not at all: a secant through two
adjacent buckets of the park probe's own trace (19 vs 64 hits) reads 4.05
ms/hit — 5x the long-lever figure — because a 45-hit lever arm divides
bucket-mean noise by a small number. That reading is what a first draft of
this record quoted, and it happened to land on the probe-width A/B's 4.5
ms/hit, which made it look like a confirmation of the model rather than a
symptom of the lever.

`scripts/surface-repro.verify.mjs --scenario=all --runs=2 --mode=x11::0`
is DETERMINISTIC on all five scenarios with 0 differing pixels, and all
ten settled PNGs are byte-identical BETWEEN the two arms — a sizing
change may not move a pixel, and a ray's shading does not depend on which
batch carried it. That run is also the second, independent measurement of
the win, at 1280x720 and across five scenes rather than one:

| scenario (settle wall)  | before      | after      |         |
| ----------------------- | ----------- | ---------- | ------- |
| boxfold3                | 19.0/18.8 s | 9.2/9.4 s  | −51%    |
| pentatope4 (4D affine4) | 12.8/12.9 s | 7.8/7.7 s  | −39%    |
| pentatope4direct        | 12.8/12.9 s | 7.6/7.6 s  | −41%    |
| lens3                   | 26.2/25.9 s | 21.7/21.4s | −17%    |
| sierpinski3 (WebGL arm) | 13.1/5.3 s  | 12.1/5.4 s | control |

Its per-settle census agrees ray for ray across the arms — boxfold3's
`hit 1782 / miss 919818 / exhausted 0` is the same on both builds while
its frame goes 15538 ms / 32 passes → 5992 ms / 20 — which is the
independent check that the partial-batch hold strands nothing.

THE 4D ROWS ARE THE DIMENSIONAL-PARITY ANSWER and they are not a separate
lift: the sizer lives in the host frame loop, which is shared by all
seven kernel cores in both dimensions, so `core:"affine4"` gains what
`core:"fold"` gains — measured, not argued. `sierpinski3` runs the WebGL
strip pump and is unmoved, which is what a control is for.

#### Headroom this deliberately did not take

`lens3`'s batches sit at `SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH` = 4096
costing 66 ms against a 250 ms budget, so the model would ask for ~15000
hits if the constant let it — worth perhaps 5 s of that 30 s settle. It
was left alone. The constant is the last absolute stop on the model being
wrong, and raising it is a separate safety argument with its own
measurements (a batch is only as safe as the multiple by which an
unmeasured band can exceed the measured one), not a free win to bundle
into this one.

`colorOut` WAS prefilled from the last frame, nearest-resampled — the strip
settle's preview-seeded-target discipline — and the record below is that
design's. It no longer is: the background-compositing split made every
frame's seed uncovered backdrop in BOTH the colour and layer buffers, since a
prior frame's RGB cannot be paired with coverage zero under this frame's
background reference, and that seed is now written on the device
("It is a VOLUME, not a count" below). The floor-rung preview question —
paint a 5%-resolved frame, or hold the last good one? — measured what that
buys during MOTION on a slow adapter, where every preview is a
budget-truncated one: the present is the PREVIOUS frame with its newly
resolved rays overwritten, so the pane never shows backdrop mid-drag.
Measured on 1280x720 Firefox WebGPU, dragging into a mandelbox-lens
close-up: mid-drag frames measured 0.98-0.99x the completed preview's size,
i.e. full coverage, and at the extreme a preview resolving ZERO rays in its
2.2s budget presents the prior image byte for byte. That refutes that
question's own premise — there is no worse frame being painted over a better
one to suppress, and a coverage threshold on the present would have had
nothing to fix. The pane heals at park through the unbudgeted completion
pass.

The loop also keeps per-frame status counts for field debugging.

### The width it asks for is the model's own pivot

This opened as a march-loop question — a kaleidoscope-4D scene at symmetry
order 6 that the compute arm settled in minutes — and the first thing that
had to happen was an accounting, because every suspect named up front was a
guess. `?surfacecompute` (the off-centre-slice work's own follow-up) made
the arm reachable on that shape; `--params=` carried it into
`scripts/march-readback-ab.mjs`. MEASURED, real Iris Xe / Mesa 25.2.8,
`kaleido4` (two maps, order 6, twist 1) at 1024x640, production build,
identity rotor, compute arm forced, 655360 rays, ten frames (two previews
and eight supersampling passes), 180.1 s to the settle latch:

| half of the frame loop | dispatches | ms       | share     |
| ---------------------- | ---------- | -------- | --------- |
| hit shade              | 524        | 165918.7 | **92.1%** |
| march                  | 130        | 10362.6  | 5.8%      |
| free shade             | 76         | 278.5    | 0.15%     |
| sweep readbacks        | 76         | 110.0    | 0.06%     |
| present readbacks      | 35         | 215.0    | 0.12%     |
| unaccounted (host)     | —          | ~3460    | 1.9%      |

**The march loop is not the cost, and neither is the host.** 98.1% of the
settle is GPU submissions, the whole compaction/readback story the status
side channel rewrote is 0.06%, and the step ramp works: 75 sweeps over ten
frames, 1.7 march dispatches per sweep, `stepsThisPass` climbing
1→2→4→8→16→32 as the active list drains (60/16/17/15/10/10 dispatches at
each). The march's own dispatches do carry a fixed cost — 40k rays cost 9.9
ms against 170k rays' 12.7 ms at one step, so ~9 ms of each is
width-independent — but 128 dispatches of it is ~1.2 s, 2% of the settle.
That is the cost model's "price the march the way we priced the shade"
answered and refused with a number rather than by assertion. Levers (a) and
(c) of the original suspect list go the same way: no preview truncated in
that run, and the 500 ms presents cost 215 ms in total.

So the residual was the hit sizer, and forcing its width — the lever the
sizer's own estimate normally decides, `?surfaceshadehits=N` — says why.
Each settle frame shades the SAME ~32.3k hits, so ms/frame is the
comparison:

| forced width   | 64     | 256   | 512         | 1024    | 3690   | 10764  |
| -------------- | ------ | ----- | ----------- | ------- | ------ | ------ |
| ms/dispatch    | 287    | 313   | 321         | 336     | 395    | 947    |
| ms/frame       | 144594 | 39661 | **20503**   | 10756   | 3452   | 2841   |
| settle         | —      | —     | **180.1 s** | 100.1 s | 40.2 s | 35.0 s |
| worst dispatch | 401.0  | 407.9 | 397.3       | 418.9   | 441.7  | 1371.1 |

A 168x width buys 3.3x the dispatch. The fit over all six widths is
`283.1 ms + 64.8 µs/hit`, so at the shipped 512 **ninety per cent of every
hit dispatch was fixed cost**, and simply doubling the batch halved the
settle. The fixed cost is not a submission's ~1.15 ms: a hit dispatch's
wall is its DEEPEST ray's shading chain — ~40 zero-cutoff on-surface DE
evals in series, and at order 6 one such eval is a deep sector-swept beam
descent — and lanes run in parallel across EUs, so until the batch fills
the machine that chain IS the dispatch. 512 hits is 8 workgroups on a
96-EU part.

#### Why the sizer could not find that out for itself

`nextShadeHitCost` preserves `interceptUs = PIVOT · marginalUs`
**identically, unclamped**. From a zeroed model, one update at width n
gives `I = (1−w)C` and `m = wC/n` with `w = n/(n+P)`, so
`I/m = n(1−w)/w = P`; and if `I = P·m` already then
`I'/m' = (I + Ps/(n+P))/(m + s/(n+P)) = P` for any surprise `s` at any
width. Two parameters, one measurement per dispatch, an exact fit — the
RATIO is fixed by the attribution weight and the data only ever moves the
scale.

That is not a defect in the model, which reproduces the cost at the width it
measured and predicts a doubling within a factor of two. It is a defect in a
SIZING rule written in terms of `intercept` alone: `shadeHitAllowanceUs`'s
middle branch divided an allowance proportional to `I` by `m`, so it
returned `K · PIVOT` hits on every scene in the project and nothing about
the scene survived into the answer. At the cost model's original `K = 1`
that is 512 — the number the table above measured leaving 90% of the
dispatch on fixed cost. The capacity ladder could not push past it either,
since its growth threshold was `shadeHitBudgetUs(I)` = the model's own
prediction of that same width: it stopped at exactly where the model wanted
to be.

**The word "unclamped" is load-bearing, and a first draft of this section
did not have it.** The marginal's decay floor
(`SURFACE_COMPUTE_SHADE_MARGINAL_DECAY`) binds when
`m + w·s/n < m·DECAY`, i.e. exactly when a dispatch measures under HALF
what the model predicted, and the ratio then becomes
`2·P·(measured/predicted)` — below `P` for anything that triggered it.
That trigger is ordinary operation, not a corner: a queue-limited sliver
lands most of a large positive surprise on the INTERCEPT (small `n`, small
`w`), and the next full-width batch measures a fraction of the inflated
prediction and trips the floor. Replaying the shipped sizer against
kaleido4's own fit with its own drain pattern, the ratio leaves `P` after
one such pair and settles around 250-310, and the width asked for lands in
1764-3584. So `K · PIVOT` is an UPPER BOUND rather than a constant, the
miss errs narrow, and the shipped settle's own numbers say so out loud —
3583 at its widest against a 2464 mean. None of that makes the width any
more the scene's: `2·P·(measured/predicted)` is as much an artifact of the
attribution weight and the decay floor as `P` is, so the conclusion is
unchanged and if anything stronger. `surface-compute.test.ts` now drives
the clamp and pins both halves — the ratio it lands on, and that the
sizer never asks for more than the dial names.

The fix is one constant read as what it is —
`SURFACE_COMPUTE_SHADE_WORK_PER_FIXED_COST`, a width in units of the
pivot, **7**, chosen off that table. 3584 is where the curve stops paying:
3690 measured 40.2 s against 10764's 35.0 s, a further 13% for 2.4x the
worst dispatch. MEASURED on the shipped build, same scene and machine:

|                           | before                               | after                    |
| ------------------------- | ------------------------------------ | ------------------------ |
| settle                    | 180131 ms                            | **55136 ms** (3.27x)     |
| hit shade                 | 524 dispatches / 165918.7 ms (92.1%) | 122 / 40855.7 ms (79.4%) |
| march                     | 130 / 10362.6 ms (5.8%)              | 128 / 10224.2 ms (19.9%) |
| sweep readbacks           | 76 / 110.0 ms                        | 75 / 113.0 ms            |
| batch width               | 512                                  | 3583 widest, 2464 mean   |
| **worst single dispatch** | **397.3 ms @ 512**                   | **417.5 ms @ 3583**      |

The last row is the watchdog answer a mean cannot give: the settle fell 3.3x
and the worst submission grew 5%, because the fold monster's worst dispatch
is its deepest ray and not the sizer's width — the same shape the cost model
measured one regime over.

The shipped 55.1 s is above the 40.2 s the forced 4096 reached, and the
difference is disclosed rather than tuned away: 17 dispatches of the
capacity ladder's climb out of one workgroup, and batches the sweep could
not fill (105 dispatches carried 258752 hits, a mean of 2464 against the
3583 asked for) because the partial-batch HOLD releases after one
progressive-present interval. Both are the pacing the cost model put there
on purpose.

`mandelboxKifs` — the hardest scene here, and the one whose intercept the
ceiling term governs — gains the same way, on the cost model's own protocol
for it (800x520, a 150 s fixed window, since it does not settle):

|                      | before          | after              |
| -------------------- | --------------- | ------------------ |
| hits shaded in 150 s | 45577           | 113259             |
| hit dispatches       | 96              | 60                 |
| **hits/s**           | **387.3**       | **1299.9** (3.36x) |
| worst dispatch       | 1744.5 ms @ 512 | 2056.5 ms @ 3583   |
| p95                  | 1611 ms         | 1952.8 ms          |

That "before" cell was taken on this build with `?surfaceshadehits=512` and
reads 387.3 hits/s against the 379.0 the cost model recorded for the shipped
sizer months earlier — a cross-session control on the protocol itself, not
just on the change. The worst dispatch is now the CEILING's number rather
than the pivot's: predicted total 2000 ms, measured 2056.5, a 2.8% model
error, and 3.6x under the ~7.5 s i915 watchdog where the cost model's 1731
ms was 4.3x under.

REGRESSION, `scripts/surface-repro.verify.mjs --scenario=all --runs=2
--mode=x11::0`, 1280x720, against the cost model's own recorded figures for
the same scenes: boxfold3 8.6/8.7 s (was 9.2/9.4), pentatope4 7.7/7.7
(7.8/7.7), pentatope4direct 7.6/7.6 (7.6/7.6), lens3 21.3/21.3 (21.7/21.4),
sierpinski3 13.3/5.3 on the WebGL control (12.1/5.4). Every scenario
DETERMINISTIC, 0 differing pixels. Those scenes barely move, and that is the
shape to expect: the change only reaches a dispatch whose fixed cost is
worth more than an eighth of the pass target, and `lens3` is still held by
`SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH` — see the headroom note above, which
stands unchanged.

### Presentation and routing

`scene.ts` presents frames as a DataTexture through the shared surface blit
(the one WebGL canvas — capture/recorder unchanged) and assembles specs with
uniform-exact camera/eps/tier quantities (acceptance eps stays native-height
— the tier-pinned acceptance rule). `main.ts` routes and choreographs it:
the same tier clock and preview governor, latest-wins preview coalescing,
plus the unbudgeted completion pass — the preview frame is the one an
invalidation must CANCEL rather than wait out, since it is the only one with
no wall budget to expire. Offline force frames are memoized. Fallback is
one-way: a create failure or device loss re-enters through the untouched
WebGL path; `?surfacegl` forces WebGL.

The frame spec also carries `camForward` and `focusDepth`. The former is the
normalized camera world direction; the latter is
`dot(enclosingBall.center - camPos, camForward)`. Kernels store signed CoC in
the retained layer's alpha while leaving terminal state/count buffers alone.
The parameter ABI does not grow: `pose.fwd` already occupies its camera lane,
and the former pad at byte 92 now stores focus depth.

## The Mesa park

See "The frame loop and batch sizing" above for the mechanism. In short:
a batch-sizing policy that let ray-unit doubling inflate capacity ahead
of payment, combined with a 1-hit floor, produced a one-way trapdoor on
Mesa 25.2.8 — once a hit band pushed past the pass target, every 1-ray
batch re-measured the full per-submission wall as its per-hit cost, the
spike-lift EMA latched it in, and the result was ~4 hits/s
serialization: a settle that reads as parked forever at a pose-dependent
completion percent. The fix was the one-workgroup floor (cost inside a
workgroup is depth-dominated, so a sub-workgroup batch buys no
submission-wall safety). `?surfacetrace` and
`scripts/fold-settle-park.repro.mjs` are the kept diagnostic instruments
for this failure mode.

The two-term cost model is this diagnosis finished. The floor cured the
degenerate case and left the mechanism running everywhere else: the flat
region reaches at least EIGHT workgroups, so every width below that was
re-measuring latency as per-hit cost, just less catastrophically. The EMA it
latched is gone — see "The hit half is not work either" above for the model
that replaced it, and for the fold-monster re-run of this same probe.

## Supersampling

SUPERSAMPLING rides the frame loop as `opts.samples`: N passes of the same
frame at N sub-pixel offsets (`subPixelSample` — pass 0 is the pixel CENTRE
exactly, the rest the R2 low-discrepancy sequence). Passes are averaged in
LINEAR light, because both tracers end with a `pow(lit, 1/2.2)` encode and
averaging the gamma-encoded bytes is the edge-darkening bug.

It is N FRAMES, not N rays per frame, so the eight per-ray buffers and every
watchdog bound stay exactly as measured, and the device ray ceiling is not
met N times sooner. The result is PROGRESSIVE: pass 0 is the
pre-supersampling frame, arriving when it always did and presenting its own
partials; every later pass only refines and presents when it lands; a
superseded job keeps what it finished.

The speckle supersampling removes is sub-pixel STRUCTURE — measured, not
march undersampling (`exhausted` reads 0.00% at 20x the step budget) and
not reachable by any viewport (the impulse rate is FLAT across a 4x
resolution range: 16.0-16.1% for the single map, 23.0-23.5% for a
six-link chain, at 128/256/512px). 39-55% of pixels still move by more
than 24/255 between the 1-sample and the 16-sample render, against a
smooth sphere's 0.29% through the same marcher.

The set-extent correction re-measured that sheet on a corrected fitted
radius and moved one leg of it: the partial-coverage exponents read -0.34
(single map) and -0.73 (six links) against the sphere's -0.98 — not the
earlier -0.21..-0.36 — because partial coverage counts SILHOUETTE pixels,
and the old, inflated marching ball drew these objects far smaller than they
actually are. It is the weaker leg either way: a frame-filling object keeps
its structure in its interior, where a silhouette statistic cannot see it,
which is why the six-link row's coverage fell to the sphere's while its
impulse rate rose ABOVE the single map's.

`main.ts` spends the document's Surface **Antialiasing** choice on the live
SETTLE and on Save-PNG. The Quality slider offers 1, 2, 4, 8, or 16 samples per
pixel and defaults to 8. It never applies to a preview (cheap by definition)
or an offline VIDEO force frame (the cost would multiply by the frame count).
The progress row discloses later passes as a trailing `antialiasing pass k/N`,
silent through pass 1. Changing the choice cancels and restarts the active
refinement; it persists with the Surface render settings.

THE WEBGL STRIP ARM NOW DOES THE SAME THING, and by the same algorithm
rather than a parallel one: it imports `subPixelSample` from here, averages
in linear light, and spends the same resolved count on the settle and on
Save-PNG, so "N samples" has ONE meaning whichever engine a machine has. An in-shader
accumulation loop stayed refused for the reason above (all-or-nothing
per-strip cost fighting the strip pump's own bounding and evidence
machinery); instead the settle opens a SEQUENCE of N whole-frame strip jobs,
each armed exactly the way pass 0 is, so the pump, planner, fence groups and
evidence chain are untouched — measured flat per-pass strip counts on real
Iris: 152/258/258/300/258/258/258/258.

The accumulator is HOST-SIDE f32, not a float render target: ~2.1ms
against a ~390ms pass, one sync point per pass and outside any job, so
strip-planner never sees it. This is deliberate — the WebGL arm is the
FALLBACK arm and must not acquire an `EXT_color_buffer_float` dependency
on the devices that have the least capability.

Pass 0 is BYTE-IDENTICAL to the pre-supersampling frame, proved by building
twice and diffing: 0 of 120000 pixels differ on SwiftShader AND on real
Iris, max channel delta 0, the PNGs identical to the byte. That second run
is not ceremony — the escape port's lesson is that a classifier passed
SwiftShader clean and then real Iris flipped six "stable" rows, so whether
Mesa contracts `(vUv + 0.0) * 2.0 - 1.0` differently is a question only that
driver can answer. Edge energy falls 0.846x / 0.851x on the two adapters, so
the supersampling win is the object's own and not an artifact of the
rasterizer.

Sidecar R/G/B follow the existing arithmetic fold. Sidecar A does not: each
pixel retains the minimum encoded CoC among covered samples, while an
all-uncovered pixel stays at the far sentinel 255. This frontmost rule avoids
near/far cancellation at silhouettes and matches the WebGL host fold.

`?surfacesamples=N` is the escape hatch and the A/B instrument (N=1 restores
the exact single-pass behaviour). The override accepts integers 1–64 and wins
over the document setting for that page load. It is resolved once before the
renderer arms, disclosed beside Antialiasing in Quality, and supplied to both
WebGPU and WebGL; it is not a second engine-specific quality setting.

## Raster limits and tiled export

A frame's RASTER is bounded by the device, not the caller. The eight per-ray
buffers cost 44 B/ray (36 before the background-layer output/staging twin;
44 across five before the status side channel dropped the ray state's
MAP_READ twin), and it is the 16 B ray state as a BOUND
STORAGE buffer that a limit actually bites on. So `maxFrameRays =
min(maxBufferSize, maxStorageBufferBindingSize) / 16` — unchanged by that
change, which is worth stating because it was expected to move: a cheaper
readback cuts what a frame COMMITS, but the ceiling was never the total,
only the widest bound buffer. A frame that would exceed it throws
`SurfaceComputeFrameSizeError` up front, before reaching the kernels —
because WebGPU refuses SILENTLY here: an over-limit `createBuffer` call
returns an invalid buffer plus a validation error, and the first actual
REJECTION shows up at a staging `mapAsync` call ("Mapping WebGPU buffer
failed: Invalid buffer"). That was the field report: a 4x Save-PNG whose
32.5M rays wanted a 520 MB state buffer inside a ~1.4 GB frame, with the
size that caused it appearing nowhere in the error.

That ceiling is NOT met against the per-dispatch one
(`surfaceComputeMaxDispatchRays`, 4,194,240 rays at the workgroup limit this
renderer never raises) even though the dispatch ceiling is the lower of the
two on a spec-minimum device. They answer different questions — how much
memory may a frame commit, versus how much work may one submission carry —
and meeting them here would make a 4K pane trace soft for a bound no single
dispatch has to meet. The march slice and the free shade batch clamp at the
dispatch ceiling themselves; see "The free shade queue drains whole" above.

Both callers size against the ceiling. The live pane FITS
(`fitSurfaceComputeRaster`): one frame IS the image, so a hidpi raster past
the ceiling traces soft and blits up — the preview tier's own mechanism,
disclosed once per session. A capture TILES (`surfaceComputeTileRows`), also
capped at `SURFACE_COMPUTE_MAX_TILE_RAYS`, so a device reporting gigabytes
of headroom still exports in ~144 MB pieces (~176 MB before the ray state's
staging twin went away; the 4M-ray cap itself is unchanged — it was chosen
against the watchdog and the allocator, not against the byte count).

`scene.ts`'s `captureSurfaceComputeFrame` traces the export as full-width
BANDS. Every band's spec is assembled in ONE synchronous span, because a
tiled export must outlive an auto-orbit/drift camera move — this is the
compute answer to the WebGL drain's frozen-uniforms approach. Each band is a
row range of the WHOLE image's projection, traced at the FULL image's trace
eps, with the backdrop pair left as the WHOLE image's stops and a
`bgOffset`/`bgExtent` pair carrying the band's own place in that image
instead — `fractal/background-shape.ts`'s shared shape reads FULL-IMAGE
coordinates, so a band just reports where it sits rather than re-deriving
its own two-stop sub-range. This retired `surfaceComputeBandStops`, which
existed only because a LINEAR ramp restricted to a sub-rectangle is still
linear; a non-linear shape has no such restriction to remap onto, while
re-deriving `imageUv` per pixel from the full extent works for every shape,
linear included. Band frames run with `capture: true`, outside the live
pane's seed chain. One band is the whole image on an ordinary export, and
that path is byte-identical to the untiled path (an absent
`bgOffset`/`bgExtent` defaults to offset `(0, 0)` and extent equal to the
frame's own raster).

Band completion never blurs a band. Host recomposition writes the band's CoC
byte into the otherwise private color alpha while placing rows in the one
full-image RGBA allocation. When Surface depth of field is enabled, the shared
blit reads that metadata after the final band and filters the complete image
once, so kernel tiles create neither blur seams nor a second full-image sidecar
allocation. Background and DoF enable state are both frozen at capture arm.

`?surfacemaxrays=N` pretends a device ceiling for testing.
`scripts/surface-export-tile.verify.mjs` is the gate: tiled vs untiled
export of one pinned pose. It measured a mean difference of 0.002/255 with
0.006% of pixels off by more than 8 while a band still derived rays from
its own raster; it measures **0.0000/255, max 0** now — byte for byte —
and the bar is bit-exact. See "A band is bit-exact" below.

### The fence round-trip, and why Firefox is ~100x slower

**MEASURED, and now SUBTRACTED — see the fix below.** A trivial WGSL kernel
(one float written per invocation, so the GPU work is nothing) timed three
ways on the same real AMD RX 7900 XTX, hardware adapters confirmed in both
browsers:

|                                     | batched dispatch | per submit | per FENCED submit |
| ----------------------------------- | ---------------: | ---------: | ----------------: |
| Firefox                             |         0.150 ms |   1.010 ms |    **100.960 ms** |
| Chrome (`--enable-features=Vulkan`) |         0.100 ms |   0.057 ms |      **3.265 ms** |

Those are pure round-trips. Firefox's landing on a round 100 ms suggests
`onSubmittedWorkDone` resolves on a polling tick — the price is per fence
whatever sits behind it. The platform ratio is 31x. The renderer's own
calibration probe re-measures both numbers every session and agrees:
2.35-2.42 ms in Chrome, 84.3-100.0 ms in Firefox.

WHAT ONE FULL-PANE LIT PASS PAYS, from `?surfacetrace` on the same machine
(cathedral, 1920x1057): `frame start rays=2029440 … shadeHitCap0=4096`,
then `frame done passes=517 hit=1940489 miss=88951` in 25,970 ms. So 517
fenced dispatches cost 1.69 s in Chrome — 6.5% of the frame, real but not
the story — and 52 s in Firefox.

THE AMPLIFIER WAS THIS FILE'S OWN ADAPTIVE SIZING. The loop's dispatch
timing (then `dispatchTimed`, now `flushGroup`) returns
`performance.now() - t0` measured ACROSS its own
`await device.queue.onSubmittedWorkDone()`, so fence latency was inside the
number `nextShadeHitCost`, `nextShadeBatchSize`, `nextLightingRayCap` and
the march's per-ray·step EMA read. On Firefox every dispatch therefore
priced at >=84 ms however little work it did, and the models concluded the
GPU was desperately slow.

THE TWO LADDERS FAIL DIFFERENTLY, which the first write-up of this section
got wrong by treating them as one. `nextLightingRayCap` compares against a
50 ms target, which a ~100 ms fence puts permanently out of reach: the LIT
ladder can only ever quarter, `Math.floor(cap / 4)` walks it to
`SURFACE_COMPUTE_WORKGROUP_SIZE`, and a 640x360 lit settle measured **1102
hit dispatches for 71.5k hits — 65 each, the one-workgroup floor**. The
UNLIT hit ladder cannot be quartered by a fence that size at all:
`nextShadeBatchSize` quarters past `budgetMs * 2` and `shadeHitBudgetUs`'s
own floor is `SURFACE_COMPUTE_PASS_TARGET_MS` (250 ms), and the budget
inflates with the very intercept the measurement inflated — so it reaches
4096 on Firefox even unfixed, and what the fence costs there is march
slicing and dispatch count instead.

THIS IS `strip-planner.ts`'S OWN BUG ONE ENGINE OVER. That file subtracts
`SURFACE_STRIP_SYNC_TAX_MS` before pricing marginal trace work precisely so
a fixed per-sync cost cannot ratchet strips into a 1px absorbing state —
"a single ms/px number absorbs whatever fixed cost the constant
under-states, which is a ONE-WAY RATCHET". Its record also says a flat
subtraction was not enough on its own there, and the answer it grew is a
two-term model. The compute arm's answer is narrower because it ALREADY
has that model: the residue lands in `nextShadeHitCost`'s intercept and
sizing reads the marginal alone. The march's own model is single-term
(µs per ray·step) and does absorb the residue, but shrinking dilutes
nothing there — `SURFACE_COMPUTE_MARCH_CHUNK_MIN` floors the slice and a
bigger slice spreads the same residue over more ray·steps, so that term
falls as the chunk grows instead of ratcheting.

**THE FIX: measure the session's own round-trip and subtract it at one
chokepoint.** The loop calibrates on its first dispatch — one leading
alignment NULL dispatch plus five COUNTED ones (this frame's real pipeline
and bind group at ZERO workgroups, so a genuine submit-and-fence with no
GPU work, no side effect and no dependence on what the params buffer
holds; see "The first probe was a different population" just below for
why there is an alignment probe at all) — and thereafter returns BOTH
currencies: `wallMs`, the honest wall clock the tally and the trace lines
use, and `workMs`, that minus the fence, which is the only number any
sizing model or capacity ladder may read. The calibration hangs off the
first real dispatch rather than the top of `runFrame` so a frame that never
reaches one — the params-write seam the tiling tests stop at — never pays
for it, and it sits inside the frame's own in-flight accounting so
`destroy()` still drains it, with the frame token re-checked between probes
so cancellation stays responsive.

THE STATISTIC IS THE **MINIMUM** OF THE COUNTED PROBES, not the median. The
two errors are not symmetric: under-stating the round-trip leaves part of a
fixed cost in the number and is bounded by how much was left, while
over-stating it makes every dispatch read cheaper than it was — and
`nextShadeHitCost` reads `workMs` DIRECTLY, with the capacity ladder above
it binding nothing once the model is calibrated, so on that path the only
rate limit is `SURFACE_COMPUTE_SHADE_MARGINAL_DECAY`'s halving per update.
The probes are also back-to-back on a cold device, so the outliers a
five-sample run really carries are HIGH ones, which a median admits and a
minimum rejects. Under a polling-tick fence the subtraction under-states
what it removes anyway (a dispatch is charged the tick it lands in, less
one whole tick), so the residue is bounded by one fence quantum — a claim
the next subsection found was not yet true of the probes actually being
minimized, and fixed.

MEASURED before/after, same machine on `DISPLAY=:0`, production build, the
`scripts/surface-fence-cost.verify.mjs` fixture (a Sierpinski tetra under a
pure-mandelbox fold FINAL), one antialiasing pass, settle frame's own
duration read off the trace:

| arm                        | Chrome before | Chrome after | Firefox before | Firefox after |
| -------------------------- | ------------: | -----------: | -------------: | ------------: |
| unlit, 1280x720            |       1271 ms |      1191 ms |      32,291 ms |     13,221 ms |
| dispatches (march + shade) |      39 + 101 |     38 + 101 |      148 + 145 |      43 + 107 |
| LIT, 640x360               |        801 ms |       844 ms |     138,854 ms |      6,845 ms |
| dispatches (march + shade) |       30 + 43 |      29 + 42 |      91 + 1102 |       29 + 42 |
| lit ray cap, final         |          4096 |         4096 |        **128** |          4096 |

So Firefox's LIT settle is **20.3x** faster and its unlit one **2.44x**,
while Chrome is unmoved — its round-trip is 2.4 ms and the calibration
costs ~12 ms once per session. `scripts/surface-fence-cost.verify.mjs` is
the gate; its LIT arm is the discriminating one, and its verdict is the
pinning's machine-independent signature (a pinned ladder carries exactly
one workgroup per dispatch however fast the GPU is) rather than a
stopwatch.

#### The first probe was a different population

**A SECOND DEFECT IN THE SAME CALIBRATION, found after the fix above
shipped and measured live.** Nine runs of `scripts/surface-fence-cost.verify.mjs`
on this machine (real AMD RX 7900 XTX, `DISPLAY=:0`, production build)
traced calibrated round-trips of 56.94, 70.60, 41.84, 94.40, 84.18, 91.18,
88.46, 16.42 and 55.84 ms — scattered across most of the ~100 ms tick
the section above measured as Firefox's true per-fence cost. The 16.42 ms run's own
probe list read `16.42,100.56,100.26,100.12,100.16` — one low, variable
first probe followed by four probes clustered at essentially one tick —
and its settle ran **121,519 ms** (1011 shade dispatches at 71 hits each,
`--display=:0`, exit 3): the under-subtracted 16.42 ms pinned the lit
capacity ladder at the one-workgroup floor for the whole session, the
exact regression the fix above exists to prevent. Every one of the nine
runs shared that shape: a low first probe, then probes 2-5 within a
fraction of a millisecond of 100 ms.

THE MECHANISM: Firefox resolves `onSubmittedWorkDone` only on a ~100 ms
polling tick (`WebGPUParent`'s `MaintainDevices` timer, Mozilla bug
1870699), not at submit time. `ensureFenceCalibrated` had no fence to
follow before its first probe — it hangs off the session's first real
dispatch, so probe #1 is submitted at whatever phase of that tick the app
happened to reach it — while every later back-to-back probe is submitted
right after the PREVIOUS one resolved ON a tick, so it must wait a whole
tick. Probe #1 draws from a roughly uniform (0, 100] population; probes
2-5 draw from a population clustered near 100 ms. `Math.min()` over a
mixed sample is therefore overwhelmingly probe #1's draw, not a stable
platform constant — the calibration was sampling a DIFFERENT population
from the one it gets subtracted from, since every real frame-loop
dispatch (`flushGroup`, `drainStaging`'s `mapAsync`) is, like probes 2-5,
submitted shortly after an awaited fence.

`scripts/webgpu-fence-phase.repro.mjs` confirmed this away from the app
entirely (fresh page per rep, one launched browser, same discipline as
`webgpu-staging-ceiling.repro.mjs`), 20 reps on the same RX 7900 XTX:

| cell                                                                     | finding                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — cold, random 0-250ms sleep, 11 back-to-back probes                   | Firefox probe #1 min/med/max 11/54.5/99 ms; probes #2-11 99-100/100/≤112 ms. Probe #1 was the minimum of probes 1-5 in **20/20** reps. Chrome: probe #1 min in only 6/20 (chance), all ~2.5 ms |
| B — one unmeasured alignment fence, then aligned + host-delay `δ` probes | wall ≈ 100 − δ across the whole 0-50ms range tested (δ=0/5/20/50 → medians 100/95/80/50 ms), busy-wait and `setTimeout` alike. Chrome: flat ~2.5 ms regardless of δ                            |
| C — after `mapAsync`                                                     | `mapAsync` round-trip itself min=93 med=100 max=111 ms; the dispatch submitted immediately after reads the same — `mapAsync` resolves on the SAME timer as `onSubmittedWorkDone`               |
| D — real GPU work, aligned (δ≈0)                                         | ~5ms work read min=99 med=100 max=104 ms of wall; ~150ms work read min=200 med=200 max=206 ms — one and two ticks exactly, confirming `wall = ceil((δ+W)/T)·T − δ` at δ≈0                      |

THE FIX: one unmeasured **alignment** fence before the counted probes
(`SURFACE_COMPUTE_FENCE_ALIGNMENT_PROBES = 1`), so `ensureFenceCalibrated`
now times `1 + SURFACE_COMPUTE_FENCE_PROBES` dispatches and
`surfaceComputeFenceRoundTripMs` unconditionally discards the leading one
before taking the minimum of the rest — every counted probe now lands at
the same tick-aligned phase a real dispatch does. THE BOUND THAT MAKES
SUBTRACTING A ~FULL TICK SAFE: a tick-aligned probe (host delay ≈ 0) is
the LARGEST fence a tick-aligned dispatch can ever be charged, so the
aligned minimum cannot exceed one tick; a real dispatch landing with some
host delay reads up to that delay cheaper, so `workMs = max(0, wallMs −
fenceMs)` under-reads true work by less than one tick — the "residue
bounded by one fence quantum" claim two paragraphs up, now actually true
of the population being minimized, where a random-phase first probe could
previously leave up to a whole extra tick unsubtracted in every reading.

THIS SUPERSEDES THE BIMODAL-MINIMUM CAVEAT BELOW (under "Fewer fences").
Of the fixes that reading invited — more probes, a median-of-modes,
re-calibrating on near-zero work — none addresses the cause. MORE PROBES would not
have helped: every additional back-to-back probe after a cold start joins
the SLOW population, so the minimum still lands on probe #1 regardless of
count. A MEDIAN would have read ~100 ms on every one of these runs, since
only one probe is off-phase — but it OUTVOTES the wrong sample rather than
removing it, and gives back the minimum's rejection of HIGH outliers, the
over-subtracting direction. Re-calibrating on near-zero work would repair
the constant only after frames had already paid for it, and a mid-session
re-probe is aligned only because a fence happens to precede it — which is
the alignment fence, arrived at late.

AFTER THE FIX, same machine, same fixture, same gate, production build,
every run exit 0 and every run on a hardware adapter. The discarded
alignment probe still drew anywhere from 1.50 to 76.10 ms — run 4 of the
unlit arm would have calibrated at 1.50 ms before — while the counted
minimum landed within half a millisecond of one tick every time:

| arm (runs)                | calibrated ms | alignment probe ms | settle ms (before, same session) | lit cap |
| ------------------------- | ------------: | -----------------: | -------------------------------: | ------: |
| Firefox unlit 640x360 (6) |  99.78-100.02 |         1.50-76.10 |            4106-4402 (4499-5113) |       — |
| Firefox LIT 640x360 (6)   |  99.62-100.10 |        34.64-59.70 |  4273-4661 (4534, 5150, 121,519) |    4096 |
| Chrome unlit 1280x720 (2) |     0.67-2.38 |                  — |                        1088-1114 |       — |
| Chrome LIT 640x360 (2)    |     2.34-2.40 |                  — |                          744-755 |    4096 |

Firefox's lit hit dispatches carried 1660-1699 hits each on all six runs,
against the pinned floor's 71. Chrome's round-trip has no tick to align
to, and its settles are unmoved.

WHAT WAS STILL OWED, and is now done. After the fix a Firefox settle frame
was very nearly its fence COUNT times its fence latency — 150 fences x
~100 ms against a 13.2 s frame — so the remaining 8-11x against Chrome was
the per-fence price itself rather than the sizing. The lever for that is
fewer fences, and it is the next section.

It was ENGINE-WIDE rather than specific to any feature: every
compute-preferred session (fold-shaped 3D, escape-time, bulb and EVERY 4D
system) runs this loop.

### Fewer fences: dispatches are grouped, the fence is paid per group

**A DISPATCH IS STILL ITS OWN SUBMISSION. What changed is how many of them
one `onSubmittedWorkDone` stands behind.** The submission is the i915
preemption boundary and the reason this loop bounds every piece of work it
hands the driver; the FENCE is a host round-trip that costs the same
whatever sits behind it. Those are two different bounds, and only the
second was being paid per dispatch for no reason. `strip-planner.ts` made
exactly this trade once already on the WebGL arm — strips go out as
individually flushed draw groups, fenced only per
`SURFACE_STRIP_FENCE_GROUP_MS` of predicted work — and the work target here is
deliberately that file's 300 ms. The DISPATCH cap is not: it is a measured
browser ceiling, and it is the next-but-one paragraph.

**A MODEL PREDICTION IS THE WRONG INPUT HERE, AND THE FIRST DRAFT OF THIS
WORK USED ONE.** Both schedulers SIZE a dispatch to hit a target —
`marchChunkFor` divides the pass target by the per-ray·step EMA,
`shadeHitBatchSize` divides the hit allowance by the marginal — so a
dispatch's model-predicted cost is that target BY CONSTRUCTION. Measured on
Firefox at 640x360, every march slice of a settle predicted exactly
250.0 ms while measuring 26-29 ms of fence-free work, and a group sized off
that prediction closed at two dispatches on a lane where six were
affordable. The prediction carries no information; only the measurement
does.

SO FOUR BOUNDS CLOSE A GROUP, whichever comes first — the first three in
`surfaceComputeFenceGroupSize`, the fourth in
`surfaceComputeFenceGroupStagedFull`:

- **the bytes the group has staged**, `SURFACE_COMPUTE_FENCE_GROUP_STAGED_BYTES`
  (1 MiB): every `queue.writeBuffer`/`writeTexture` since the last fence —
  params blocks, ray lists, the frame's own uniforms and textures. It is
  asked BEFORE a dispatch stages its writes, so a raster-sized ray list never
  joins a group already holding staging, and again once the dispatch is
  submitted. It only ever shrinks a group: an EMPTY group never closes, so a
  dispatch whose own writes pass the ceiling still goes out, as a group of
  one, and no fence is skipped. The evidence is the staging repro's table
  below — row C (four dispatches, two 16 KB writes each) 0/20, row D (the
  same plus 8 MB) 7/20, row E (8 MB behind a group of one) 0/20, row F
  (32 MB across four dispatches) 13/20: staged VOLUME behind one fence is
  what kills. After the device seed the volume left is the ray lists — a
  march slice's list, and the free queue, which drains whole (3.7 MB at
  1280x720). The bound binds under `?surfacefencegroup` too, which is what
  should make raising the count safe at any raster. It cannot fix row G: a
  single dispatch whose own list is tens of megabytes;

- **twice the lane's worst MEASURED per-dispatch work this frame**, against
  `SURFACE_COMPUTE_FENCE_GROUP_MS`. This is
  `surfaceComputeLightingFenceGroup` from the removed medium, constant for
  constant, and its reasoning holds unchanged: a running MAX can only be
  raised by a later, slower dispatch, which is the safe direction for a
  decision about how much work to queue. The maximum is per FRAME, so an
  expensive band cannot pin the group size for a session, and a lane whose
  dispatches really do measure at the pass target gets groups of one —
  which is how grouping stays off the frames that never needed it;
- **the dispatch count**, `SURFACE_COMPUTE_FENCE_GROUP_MAX`, which is a
  MEASURED BROWSER CEILING and not a tuning constant — see below. It binds
  in the case the work exists for, since a frame of queue-limited slivers
  measures almost nothing per dispatch, and it also keeps one measurement
  from being spread so thin it says nothing about any member;
- **the caller's own deadline** — the time before the next progressive
  present falls due, or before the frame budget cuts. Queued work is
  present debt and cancellation debt: the screen has to keep developing
  through a long drain, and a budget cut has to be able to land. A caller
  with nothing left to spend gets a group of one, which is the
  pre-grouping loop exactly.

**FIREFOX LOSES ITS DEVICE AT FOUR QUEUED DISPATCHES, AND THAT IS WHAT
SETS THE CAP.** Measured on this repository's AMD RX 7900 XTX on
`DISPLAY=:0`, the fence gate's own fixture, production build: with four or
more dispatches behind one `onSubmittedWorkDone`, the settle frame's FIRST
march sweep raises `Uncaptured WebGPU error: Not enough memory left`, the
device is lost, and the session falls back to the WebGL tracer. Reproduced
at `--fencegroup=4` and `=6`; clean at 1, 2 and 3.

| `--fencegroup` | 640x360 | 960x540 | 1280x720 |
| -------------- | ------- | ------- | -------- |
| 1, 2, 3        | compute | compute | compute  |
| 4, 6           | LOST    | —       | —        |

#### It is a VOLUME, not a count — what the app-free reproduction settled

THE FIRST READING OF THAT TABLE WAS WRONG, and it was wrong in the half
that pointed at a fix. It read "a COUNT, not a volume: three survive at
every raster tried, and the writes outstanding when it dies are ~16 KB
each", named OUTSTANDING QUEUE WRITES as the likely quantity — two per
dispatch, the params block and the ray list — and concluded that lifting
the cap was gated on unifying those two into one write per sweep. The
quantity was right; the writes named were not, and that unification would
have bought nothing.

`scripts/webgpu-staging-ceiling.repro.mjs` settles it away from this app
entirely: a routed one-line HTML page on an `https:` origin, a fresh
browser per rep, no build and no server, so what it measures is the
BROWSER. Firefox 153.0 (Playwright's build), the same RX 7900 XTX on
`DISPLAY=:0`, 10 rounds a rep.

TWENTY REPS A CELL, AND THAT IS THE MINIMUM THIS QUESTION TAKES — the
failure is stochastic, the same cell read 0/5 in one five-rep run and 5/5
in another, and the first draft of this section published a table of
five-rep cells that did not survive re-measurement. These are RATES:

| #   | queued behind ONE fence                             | died  |
| --- | --------------------------------------------------- | ----- |
| A   | 4 bare submits                                      | 0/20  |
| B   | 32 bare submits                                     | 6/20  |
| C   | 4 dispatches, 2 x 16 KB writes each (the app's own) | 0/20  |
| D   | C plus a frame's 8 MB prefill                       | 7/20  |
| E   | 1 dispatch, the same 8 MB prefill                   | 0/20  |
| F   | 4 dispatches, 2 x 4 MB writes each (32 MB staged)   | 13/20 |
| G   | 1 dispatch, a 32 MB prefill                         | 20/20 |
| H   | 4 dispatches, no writes, 128 MB merely HELD         | 0/20  |

**C against A** is the refutation: the app's own two writes per dispatch,
128 KB across a group, add nothing, so unifying them would have bought
nothing. **F against C** is the correction: the SAME dispatch count with
bigger writes kills 13/20, so the quantity is a VOLUME measured at fixed
count. **D against C** locates the app's volume — the frame's own PREFILL,
which `runFrame` stages before any dispatch. **E against D** says what a
fence group actually is: the same megabytes behind a group of one are
harmless, so the group is HOLD TIME on staging rather than a count of
anything. **H** rules out memory the device merely holds. And **B against
A** keeps the honest remainder: submissions do carry a cost of their own,
but it takes eight times the app's cap to reach a rate that 8 MB of
staging reaches at four.

WHY HOLD TIME IS THE RIGHT WORD. Firefox reclaims a submission's staging
only when a poll observes its fence: `WebGPUParent` starts its timer at
`POLL_TIME_MS = 100` and `MaintainDevices` calls
`wgpu_server_poll_all_devices`, and nothing polls at submit time
(Mozilla's bug 1870699, "Don't poll WebGPU from a timer"). That 100 ms
tick is the same one the section above measured from the outside as
Firefox's fence round-trip. `Not enough memory left` is wgpu's generic
`DeviceError::OutOfMemory` text rather than a report about VRAM — 23 of
this machine's 24 GB were free every time it fired.

**ROW G IS THE ONE NO FENCE GROUP CAN FIX.** A frame's prefill, while it
was staged, was 24 B/ray unlit (states 16, layer 4, colour 4) and 36 B/ray
lit, where the colour buffer widens to `vec4f` radiance — so 640x360 was
5.5 MB and 8.3 MB, and 1280x720 was 22 MB and 33 MB. The fence gate's unlit 640x360 fixture is
therefore cell D, dying at four dispatches a fence and clean at one, which
is its measured behaviour in the app. A LIT 1280x720 frame is cell G,
which dies 20/20 at a group of ONE, on the first fence, every run. That
has not been observed in the app yet, and only because a Firefox settle at
that raster does not complete inside 180 s to be observed at all.

A LOST DEVICE DOES NOT COME BACK IN THAT TAB. Across 20 probe reps that
actually killed one, 0 recovered: the replacement device cannot allocate
8 MB, and `requestDevice()` itself sometimes rejects with the same error —
at 0 ms, 500 ms and 3000 ms after the loss alike. So main.ts's one-way
`surfaceComputeBlock = "failed"` latch is CORRECT rather than merely
conservative, and a retry-on-loss is a measured won't-do.

CHROME IS UNAFFECTED — 0/10 at 32 and at 512 bare submits a fence, and
0/10 on cell D, the exact shape that kills Firefox 7/20 — and it gains
nothing measurable from a wider group, so the cap stays the SMALLEST
stack's rather than a compromise. **The shipped cap of TWO stands, for a
better reason than the one it was given:** the failure is a RATE rather
than a threshold, so "clean at three" was never a property of three — it
was one run of a cell whose neighbour at four dies a third of the time —
and the cost of being wrong is a compute-only session, fold-shaped or
escape-shaped 4D, losing its Surface renderer outright with no way back.
**THE FRAME PREFILL IS NOW SEEDED ON THE DEVICE.** `runFrame` no longer
stages `color`, `layer` or `states` through the queue: one `seedFrame`
dispatch (`surface-de-gpu.ts`'s `surfaceComputeSeedWgsl`) writes all three
per ray — state `(-1, ACTIVE, 0, 0)`, the uncovered layer, the pixel's own
backdrop — reading the shade uniform the frame already uploads, so the
megabytes this ceiling is about stop being queued at all. What a frame
still stages is its 16-byte seed uniform, its params/shade uniforms and
the dispatches' ray lists. A same-size UPLOAD would not have been
equivalent: wgpu stages a `mappedAtCreation` or `writeBuffer` seed buffer
too, and row G is one such staging dying on its own. The colour seed can
change nothing in a completed frame — the shade entry overwrites every
terminal ray — so it is visible only on rays still active at a budget cut
and in mid-frame progressive presents.

**THE CAP IS STILL TWO.** The seed removes the quantity that set it; it
does not measure what the cap can now be. Raising
`SURFACE_COMPUTE_FENCE_GROUP_MAX` waits on the fence gate and the staging
repro re-run in the app on Firefox.

AND EACH LANE IS PILOTED. Until a lane's first group comes back measured
there is no measurement to size from, so that lane fences one dispatch at a
time — `surfaceComputeFenceGroupSize(null) = 1`, the shape the medium's own
pilot had. A shade group reads the HIT lane: a free batch has no cost of its
own to contribute, and pricing the group by the hits it also carries is the
conservative direction.

THE MEMORY QUESTION DOES NOT ANSWER ITSELF, and the paragraph that used to
stand here said it did. Its arithmetic is sound as far as it goes: each
queued dispatch writes its ray list through `queue.writeBuffer`, the march
slices PARTITION the active list and the shade batches partition the
queues, so a group's queued rays can never exceed the frame's own ray
count, which `maxFrameRays` bounds — at most one frame's active list, four
bytes a ray. What it missed is that the DISPATCHES were not where a frame's
staging was. `runFrame`'s three PREFILL writes preceded them and were an
order of magnitude larger, and they were the ones that reached the browser
ceiling above. With those writes replaced by the device seed, the partition
bound IS the frame's raster-scaled staging now: the ray lists, at most one
frame's worth across a group — 0.9 MB at 640x360, 3.7 MB at 1280x720. The
free queue drains whole, so an all-miss sweep can stage that much in ONE
write. That is what the staged-bytes bound above is for: a group closes
before a list that would carry it to 1 MiB joins it, and a list past 1 MiB
fences alone, so the partition argument no longer has to carry this by
itself.

**THE ATTRIBUTION IS THE PART TO GET RIGHT**, because a group measures ONE
time for N pieces of work and the models below still reason per dispatch.
The fence subtraction becomes one fence per GROUP, and then:

- the march's per-ray·step EMA takes the group's AGGREGATE rate, its
  fence-free work over its total ray·steps — which is what a single
  dispatch of the same total rays would have given. One measurement, one
  EMA update;
- the hit queue's two-term model takes the group AS a group:
  `nextShadeHitCost` gained a dispatch COUNT and fits
  `d·intercept + N·marginal` to the one measurement. Every property the
  single-dispatch form had survives — the fit is still EXACT, and the
  `intercept = PIVOT · marginal` invariant is preserved identically with
  `w = N/(N + d·PIVOT)` — and at EQUAL widths the joint fit and folding
  each member at the equal share are the same answer by algebra, which is
  what makes the two attributions in this list consistent where they
  overlap. Unequal widths are where they part, and the joint fit is the
  one that does not have to guess which member was expensive;
- the two capacity LADDERS (`nextShadeBatchSize`, `nextLightingRayCap`)
  judge one dispatch against a budget, so they take
  `surfaceComputeGroupDispatchMs`'s EQUAL share, applied once per member in
  submit order. Per member rather than per group because the watchdog sees
  dispatches and because folding a group into one ladder step would slow
  the doubling climb out of the cold cap by the group size. The
  queue-limited rule is unchanged and still per member: a batch the sweep
  could not fill may shrink a capacity and never grow it;
- a FREE batch is attributed ZERO and feeds nothing. Not a convenience:
  its shade-entry exit is two lines, so what a free dispatch costs really
  is the submission and the fence rather than work — the measurement two
  sections up, 3.2 ms per free dispatch on a stack whose fence was ~3 ms.
  A group of nothing BUT free batches has no priced member, so its work is
  shared over the frees for the trace's sake alone.

`?surfacefencegroup=N` PINS THE GROUP COUNT outright, and `=1` is the
pre-grouping loop value for value — which is how the rows below were taken:
ONE build, the two arms back to back,
`scripts/surface-fence-cost.verify.mjs --fencegroup=1` against the same
script with no flag. Against a remembered number from another checkout they
would not be comparable, because the thing being measured moves (the
calibration caveat at the end of this section).

MEASURED, this repository's AMD RX 7900 XTX on `DISPLAY=:0`, production
build, that gate's fixture, one antialiasing pass, the settle frame's own
duration off the trace. Firefox at 640x360 because it does not settle this
fixture at 1280x720 at ANY group size, the pre-grouping loop included:

| arm                    |   1 fence/dispatch |           grouped |
| ---------------------- | -----------------: | ----------------: |
| Firefox unlit, 640x360 | 6600 / 6820 / 7112 | 4707 /4704 / 4908 |
| fences (whole run)     |        73 /75 / 76 |       54 /55 / 55 |
| Firefox LIT, 640x360   |               6623 |              4644 |
| fences                 |                 73 |                54 |
| Chrome unlit, 1280x720 | 1319 / 1344 / 1311 | 1191 /1194 / 1235 |
| fences                 |      138 /138 /138 |       93 /95 / 95 |
| Chrome LIT, 640x360    |    892 / 880 / 867 |    893 /848 / 858 |
| fences                 |        71 /73 / 71 |       53 /53 / 53 |

So **Firefox settles 1.4x faster** and Chrome 1.09x unlit, flat lit — which
is the shape the fence price predicts: Firefox's calibrated round-trip on
those runs was 59-85 ms against Chrome's 2.4, so ~80% of a Firefox settle
frame was fence and ~25% of a Chrome one. DISPATCH COUNTS ARE UNCHANGED in
every arm (Chrome 37+101 both sides, Firefox 30+43 both sides): the design
claim is that only the fence count moves, and the table is where that gets
checked rather than asserted.

THE EMA MUST FOLD PER MEMBER FOR THAT TO BE TRUE, and the first version of
this did not. Folding a group's aggregate rate ONCE per group slows the
per-ray·step EMA's convergence — and with it `marchChunkFor`'s climb — by
the group size, which measured as a 141-dispatch Chrome settle becoming a
210-dispatch one at the same wall time: more, smaller slices, each still
paying a submission. The measurement covers `d` dispatches' worth of
ray·steps, so it is `d` dispatches' worth of evidence, and it is folded `d`
times.

A CAVEAT ON READING ANY OF THESE ROWS, and on the gate itself, AS MEASURED
AT THE TIME: the session's calibrated round-trip was BIMODAL on Firefox.
Eight consecutive runs of one fixture calibrated 77.8, 78.3, 18.6, 81.4,
37.2, 3.3, 59.0 and 67.2 ms, and one logged
`probes=71.36,100.22,100.16,99.94,100.36` — so the MINIMUM of five probes
could be a lucky fast one against a ~100 ms typical. When it landed low the
residue stayed inside every sizing model and the same frame measured
11.1 s (calibrated 18.6) or 29.3 s (calibrated 3.3) against the 4.7 s
median, on BOTH arms. The rows above are therefore matched by calibrated
round-trip rather than averaged over runs, and the low-draw runs are
reported here rather than dropped. Grouping MITIGATED that defect — the
subtraction is one fence per GROUP, so the residue was divided across the
group's dispatches — but did not fix it. **DIAGNOSED AND FIXED**: "The
first probe was a different population" under the section above names the
mechanism (a cold first fence samples a different, faster tick phase than
every later one) and the fix (one unmeasured alignment fence).

### What the driver's job timeout actually bounds

**A SINGLE DRIVER JOB IS CUT AT ~2.0 s ON THIS MACHINE, AND THE FENCE GROUP
IS NOT THE UNIT THE WATCHDOG COUNTS.** Both halves are measured, and the
second refutes the reading this loop was built on.

The question was forced by a loss the instruments could not explain. A
1920x1057 cathedral settle on the RX 7900 XTX lost its device at 182 s with
`amdgpu: ring gfx_0.0.0 timeout ... Process chrome`, while the renderer's own
`?surfacetrace` reported a worst per-dispatch time of 40 ms against a 50 ms
target. Something the driver timed was three orders of magnitude off what the
instrument reported, and until that is explained every dispatch-width bound in
this file is set against a number that does not bound the thing that kills the
device.

`scripts/webgpu-job-watchdog.repro.mjs` asks it away from this app entirely, in
`scripts/webgpu-staging-ceiling.repro.mjs`'s shape: a routed one-line HTML
document on an `https:` origin Playwright fulfils itself, no build, no server
and none of this app, a fresh browser per rep. Its arms all spend the SAME
total GPU time and differ only in how that total is handed to the queue —
`single` (one submit carrying the whole total), `serial` (K submits, EACH
awaited on its own fence), `group` (K submits behind ONE fence — the app's
fence group), and `multicb` (ONE `queue.submit([cb1..cbK])` of K command
buffers, which separates "several submit calls" from "several command
buffers").

MEASURED 12 September 2026, RX 7900 XTX, Chrome on `:0`, WebGPU adapter
`amd rdna-3`, kernel 7.0.0-29. `ring` is what `journalctl -k` recorded during
that row:

| arm     | shape       | total   | outcome               | ring      |
| ------- | ----------- | ------- | --------------------- | --------- |
| single  | 1 x 2000 ms | 2000 ms | survived (fence 2004) | clean     |
| single  | 1 x 3000 ms | 3000 ms | DIED                  | gfx reset |
| single  | 1 x 6000 ms | 6000 ms | DIED                  | gfx reset |
| serial  | 6 x 500 ms  | 3000 ms | survived              | clean     |
| serial  | 6 x 667 ms  | 4002 ms | survived              | clean     |
| serial  | 6 x 1000 ms | 6000 ms | survived              | clean     |
| group   | 3 x 500 ms  | 1500 ms | survived              | clean     |
| group   | 6 x 250 ms  | 1500 ms | survived              | clean     |
| group   | 2 x 900 ms  | 1800 ms | survived              | clean     |
| group   | 2 x 1000 ms | 2000 ms | survived              | clean     |
| group   | 2 x 1200 ms | 2400 ms | survived              | clean     |
| group   | 2 x 1400 ms | 2800 ms | survived              | clean     |
| group   | 2 x 1500 ms | 3000 ms | DIED 4 of 5 runs      | clean     |
| group   | 6 x 500 ms  | 3000 ms | DIED 1 of 2 runs      | clean     |
| group   | 12 x 250 ms | 3000 ms | DIED                  | clean     |
| group   | 6 x 667 ms  | 4002 ms | survived              | clean     |
| group   | 6 x 1000 ms | 6000 ms | DIED                  | clean     |
| group   | 12 x 500 ms | 6000 ms | DIED                  | clean     |
| multicb | 6 x 500 ms  | 3000 ms | DIED at 2042 ms       | gfx reset |
| multicb | 6 x 667 ms  | 4002 ms | DIED at 2033 ms       | gfx reset |
| multicb | 6 x 1000 ms | 6000 ms | DIED at 2063 ms       | gfx reset |

#### Four verdicts — two sharp, one refutation, one withdrawn

**1. ONE DRIVER JOB GETS ~2.0 s, not the 10 s amdgpu nominally gives its gfx
ring.** `single` survives 2000 ms (fence 2004 ms) and dies at 3000 ms;
`multicb` dies 2033, 2042 and 2063 ms into payloads of 4002, 3000 and 6000 ms —
the SAME instant regardless of how much work was behind it, which is what a
fixed deadline looks like. This is the reproducible, sharp number, and it is a
MACHINE's number: read it off the device in front of you, never off the
driver's documented default.

**2. K COMMAND BUFFERS IN ONE `submit()` ARE ONE DRIVER JOB.** That is the
whole of why `multicb` dies where `group` — the same K dispatches, the same
total, K separate `submit()` calls — does not. `surface-compute.ts` submits one
command buffer per submit, so it is clear of this; a caller that ever batched
command buffers to "save submissions" would be walking straight into it.

**3. THE FENCE GROUP IS NOT THE WATCHDOG'S UNIT, and the backlog reading is
REFUTED.** K separate submissions behind one `onSubmittedWorkDone` are K jobs
with K deadlines: 4002 ms of it survives, and 6000 ms survives when each second
is fenced. The prior reading — that a queued backlog accumulates into one
job — was already refuted by the kernel line that prompted this work:
`signaled seq=17130178, emitted seq=17130179` is a gap of ONE. Exactly one job
was emitted and unsignaled when the watchdog fired, not a backlog of as many
jobs as were queued.

**4. AN UNFENCED INTERVAL ALSO DIED NEAR 3 s — AND THIS ONE IS WITHDRAWN AS A
FINDING.** Every `group` death in the table is at a total of 3000 ms or more,
leaves NOTHING in the kernel log, and lands at the moment the interval's work
would have COMPLETED (2987, 2997, 2999, 3002, 3006, 5927, 5930 ms) rather than
at a deadline part-way through it. It was a rate rather than a threshold —
2x1500 ms died on four runs of five, 6x500 ms on one of two, and 6x667 ms not
at all — and it was first written up here as an open question about how much of
a backlog reaches the ring as one busy period.

THAT READING DOES NOT SURVIVE THE OBVIOUS ALTERNATIVE. These rows were taken on
a machine whose other workloads nobody was tracking, and an intermittent death
at a threshold nothing else in the probe shows is exactly what a second process
competing for the GPU produces. The machine's owner raised it, and there is no
record that can settle it: `sar` shows both windows equally quiet on CPU (4-8%
user, loadavg ~1 on 16 cores) but records NO GPU utilisation at all, which is
the only kind that would have mattered. VERDICTS 1 TO 3 ARE UNAFFECTED — a
fixed deadline landing at 2033, 2042 and 2063 ms under three different payloads
is not something contention manufactures, and verdict 3 rests partly on a
kernel sequence gap that is not a timing measurement at all. This one is not
load-bearing anywhere and should not be treated as measured until it is re-run
under `scripts/lib/machine-quiet.mjs`, which now attributes GPU busy time per
process so a contended run reports itself instead of being believed.

**A CLEAN JOURNAL IS NOT A CLEAN RUN.** Only the over-long single job takes
the logged `ring gfx_0.0.0 timeout ... Ring reset succeeded` path. The
withdrawn interval deaths lost the device with `A valid external Instance
reference no longer exists.` and wrote NOTHING to the kernel log, and whatever
caused them, that much is worth keeping: a session that reads the journal to
decide whether the driver was involved can be told nothing at all and conclude
it was not.

#### What it bounds here, and what the existing reading got half right

THE DERIVED BOUND IS VERDICT 1'S, APPLIED TO THE WHOLE INTERVAL: hold the GPU
work queued between two fences to the ~2 s a single job gets. With verdict 4
withdrawn the justification is no longer a measured interval death but simple
conservatism — the host cannot see how much of its queued backlog the driver
takes as one busy period, and a fence group is at most two dispatches, so
bounding the group bounds each member well under the deadline either way. At this project's usual 4x watchdog margin that is
~500 ms per fence interval, which the shipped
`SURFACE_COMPUTE_FENCE_GROUP_MS` of 300 ms already respects — PROVIDED the
prediction it sizes against is right, which is precisely what failed at 182 s.

THE CEILING IS ~2.0 s AND THE LADDERS AIM AT 50 ms, so the shipped widths are
nowhere near it and this measurement does not, by itself, ask for one of them
to move. What it moves is what the numbers MEAN.

AND THE HEADROOM IS NOT THEORETICAL. Instrumented with the submit-time line,
the worst configuration anyone has lost a device on — the cathedral at
1920x1057, authored 32-cell medium, lit ceiling lifted to 65536 — settled all
eight passes three times out of three (327.7, 329.2, 328.0 s, no ring reset).
Across one of those settles' 11,475 fence groups the widest MEASURED interval
was 76.6 ms, and the widest single submission of ANY kind was a 245 ms present
readback: 26x and 8x under the deadline. Worth noting which of those is which —
the readback is the biggest thing this renderer hands the queue, it is not a
dispatch, and no ladder here sizes it. `docs/cinematic-surface-lighting.md`
carries that run's figures and the one difference it did find, which is that
the run that died was 1.6x slower per pass than the three that did not.

**"THE WATCHDOG SEES DISPATCHES, NOT GROUPS" IS HALF RIGHT, AND THE HALF IT
MISSES IS THE DEADLINE.** The ladders pace on `groupWorkMs / members` — a
group's wall divided by how many dispatches shared it — on exactly that stated
ground. The dispatches really ARE separate jobs, so the reading survives
verdict 3 and only verdict 3. But the quantity the deadline is denominated in
is the INTERVAL's work, so the per-dispatch share understates it by the group
size, and the frame's seed submits — which ride the first fence untracked —
are not in the divisor at all. A ladder may keep stepping per member; the group's own
work is what is held against ~2 s, conservatively rather than because an
interval was measured dying.
`surfaceComputeFenceGroupAllowanceMs` now holds its PREDICTED work there —
`min(SURFACE_COMPUTE_FENCE_GROUP_MS, 2000/4)`, which picks the shipped 300 ms
and so binds nothing today, and exists so that target cannot be raised on
throughput grounds, which is what raising it looks like, past the measured
ceiling without something refusing it. The group's MEASURED `workMs` is still
read by nothing.

**AND AN INSTRUMENT BUILT ON FENCES CANNOT SEE ITS OWN FATAL DISPATCH.** Every
number this renderer records is taken when a fence resolves. The submission
that kills the device never resolves, so it is never recorded, and "the worst
dispatch we measured was 40 ms" is a statement about the SURVIVORS alone. That
is the gap the probe was written to explain, and it does not close by making
the existing number more accurate.

`timestamp-query` IS AVAILABLE ON THIS STACK — the probe reads it, and its
GPU-side figures track the host's fence wall to within 7 ms — and it is the
right instrument: a pass's own begin-to-end ON THE DEVICE, in the currency the
deadline is denominated in, with nothing split or subtracted. The renderer has
none of it today. A trace line written at SUBMIT rather than at the fence is
the cheaper half of the same fix, and it is now there: under `?surfacetrace`
each dispatch writes a `<lane> SUBMIT len=… ahead=… predicted=…` line as it is
handed to the queue, so a lost device names its last submission instead of
taking the answer with it. The `predicted=` figure is NOT evidence and nothing
sizes anything from it — a dispatch's predicted cost is its sizer's target by
construction — it is simply the only number that exists before the work runs.

#### Running the probe

HEADED ONLY — Chrome exposes no WebGPU adapter headless on this box, which is
also how the app failed:

```bash
export XAUTHORITY=$(ls -t /run/user/$(id -u)/.mutter-Xwaylandauth.* | head -1)
node scripts/webgpu-job-watchdog.repro.mjs --display=:0
node scripts/webgpu-job-watchdog.repro.mjs --display=:0 --arm=group --totalMs=3000 --groups=6
```

`--arm=calibrate` fits GPU time against the spin kernel's iteration count so
every other arm asks for a duration rather than a magic number, and never hangs
anything. Exit 3 is REPRODUCED (an interval over the ceiling killed the device
while the same work serially fenced did not — the expected verdict, and the
rows above still stand); 0 is CLEAN, meaning the browser, the driver or the
machine changed and the ceiling above is due a re-measurement; 2 is
INCONCLUSIVE (no adapter, or a software one); 1 is harness failure. RUN IT ON A
QUIET MACHINE, and expect ring resets: hanging the GPU is the point. Every
reset on this box has recovered, but a wedged GPU can still take a desktop
session with it.

### The lit dispatch width, and what one workgroup cost

**Measured on the participating medium, which has since been REMOVED on the
cost this section measures** (`docs/cinematic-surface-lighting.md`). The
width lesson stands and the sizer still runs — a lit dispatch's fixed cost
dominates a narrow one — but `mediumCost`, the per-cell sweep and the
phase split are gone with the medium.

`ShadeSizerState.lighting`'s `surfaceCost`/`mediumCost` shipped as inert
placeholders. `surfaceComputeLightingRayBatch`'s `affordable()` therefore
never bound, the width fell through to `rayCap` — one workgroup, never
updated — and every lit hit dispatch was 64 rays wide for the life of the
session, each paying a full 32-cell x 2-light medium sweep.

MEASURED (real AMD RX 7900 XTX, production build, cathedral, 64x64 = 4096
rays, ONE sample, one fresh session per width, lit width forced offline
through `?surfaceshadehits=N`):

    width               64      256     1024     4096
    ms/medium disp   5.756    7.200    9.880   13.978
    medium disps      4288     1088      288       96
    medium ms        24,647    7,791    2,754    1,120
    settle          27.22 s   8.76 s   3.29 s   1.54 s

The fit over that lever is **5.63 ms + 2.04 us/ray**. At the shipped width
that is 0.13 ms of marginal work inside a 5.76 ms dispatch — **97.7% fixed
cost**, because 64 invocations do not begin to fill the machine — and a
64x width buys 2.4x the dispatch for a 17.7x settle. Coverage is identical
(3840 covered / 256 miss / 0 exhausted) at every width: this is
scheduling, and the image does not change. It is the same shape the unlit
hit queue already measured and fixed (`nextShadeHitCost`'s own record,
`283.1 ms + 64.8 us/hit`, 90% fixed at width 512).

Both lanes are live now, and `nextLightingRayCap` paces the climb exactly
as `nextShadeBatchSize` paces the unlit queue. Same fixture, ladder
running: **27.22 s -> 4.655 s**, climbing 64/128/256/512/1024/2048/3328.
The 64px frame pays most of that climb because its early sweeps are
queue-limited and a queue-limited batch may not grow the capacity; a frame
with rays to spare reaches the ceiling in six dispatches out of hundreds.

WHAT WAS STILL OWED, from the same fit, and what happened instead. At
1920x1057 and 8 samples the frame went from ~26 h to ~59 min, still 40%
fixed / 60% marginal with 64 medium dispatches per shade batch to answer
for. The naive remedy — one medium cell per pass, letting supersampling
average — was a TRAP: every pass re-runs phase 0, ~23.7 s of surface shade
at pane scale, so reaching the authored sample count would have cost
~2.7 h. The medium needed its own progressive dimension over
already-shaded terminals. Nobody built it: a later full-pane measurement
put the authored cathedral at 9.5% after five minutes, against 130 s for a
complete eight-pass settle with the mist off, and the
medium was removed rather than optimized. Without it a lit frame is the
surface half alone — which is the 130 s.

### A band is bit-exact

The band used to be a `camera.setViewOffset` SUB-FRUSTUM, and its rays
were the full image's rays only in exact arithmetic. Two things went wrong
with that, and the second is what a lit export could not absorb:

- the march-start DITHER hashed the ray's coordinates in its OWN raster
  (`hash2(vec2f(f32(px) + sub.x, f32(py) + sub.y))`), so every band past
  the first got a different dither phase from the whole image's — the
  0.006% residual above, read as a thin silhouette scatter in an unlit
  frame. In a LIT frame it is not thin: the dither moves the march start,
  the march start moves the terminal distance, and the terminal distance
  was the (since-removed) volumetric medium's whole integration length, so
  the mist re-integrated over a slightly different segment for every pixel
  of every band. MEASURED on the `cathedral` fixture at 64 px: 0.408/255 mean and
  5.9% of channels at the authored eight samples, 0.699 and 10.1% at one;
  against `scripts/cinematic-lighting.verify.mjs`'s 0.15 bar;
- the sub-frustum's own f32 rounding, which is real but small.

Both are gone. The projection stays the WHOLE image's for every band, and
the kernels derive the ray's NDC, the dither and (with lighting) the
transport's per-pixel seed from the FULL-IMAGE pixel — `bgOffset` plus the
band-local one, over `bgExtent` — exactly as the backdrop shape already
did. `params.rasterHeight` then reaches NO per-pixel arithmetic in the app
kernels at all (the `pose` bench-baseline ray arm still uses it and is
never banded), which is why bit-exactness is structural here rather than a
lucky measurement: a band and the whole image feed each shared pixel the
same numbers. `withViewBand` is gone with the sub-frustum.

MEASURED after the fix, real AMD RX 7900 XTX (radeonsi):
`surface-export-tile.verify.mjs` 900x560 in 9 bands, mean 0.0000/255,
max 0; `cinematic-lighting.verify.mjs` `cathedral`/compute 64 px in 4
bands, mean 0 and 0% of channels changed, at one sample and at the
authored eight (the two PNGs are byte-identical FILES); and the same gate's
non-flat 4D `slice4`/compute row, 64 px in 4 bands, mean 0 and 0% at one
sample. Both dimensional halves, because the changed text is the march and
shade entries every core shares. Both gates now assert bit-exactness
rather than a tolerance.

One measurement had to be corrected to see it. The cinematic gate's two
export arms did not trace the same document: the untiled arm exported the
session configured through the UI and the tiled arm a reload of its saved
hash, and `persist.ts` ROUNDS on encode — worth 0.127/255 mean and 1.2% of
channels on this fixture, which is most of what remained after the dither
fix and none of it tiling. The gate now reloads the saved document once
before either export, so the arms differ only in their ray cap.

### Radial vignette + bands

`SurfaceComputeFrameSpec` grows an optional `bgShape` — the same
optional/required split as `bgOffset`/`bgExtent`: absent defaults to
`{kind: "linear"}`, so gpu-bench's spec literals compile unchanged.
`scene.ts`'s `surfaceComputeFrameSpecAt` derives it from the live
`backdropShape` field and, for `"radial"`, computes `scale` via
`backgroundRadialScale` of `bgExtent` — the FULL image `bgOffset`/
`bgExtent` already name, NOT of this call's own `width`/`height`. That
distinction is the whole reason `surfaceComputeBandStops` had to go one
level up: a capture band's raster is a SLICE of the full export, and
scaling a vignette by the slice's own dimensions would draw a different
ellipse per band instead of one consistent vignette across the whole
tiled image. `captureSurfaceComputeFrame`'s per-band spec assembly needs
no separate handling for this — every band already computes its own
`bgOffset`/`bgExtent` from the SAME `band.fullHeight`, so `bgShape`'s
scale falls out of that existing plumbing for free.

`runFrame` packs `bgShape`/`bgCenter`/`bgScale` into `packSurfaceGpuShade`
exactly like `bgOffset`/`bgExtent`, and the device seed
(`surfaceComputeSeedWgsl`) reads that same shade uniform — so a radial
session's ACTIVE-ray seed (a budget cut, or a mid-frame progress present)
already shows the vignette instead of a stale linear guess. There is no host
row cache left to key: the seed re-evaluates the shape per pixel every frame
from the uniform the shade kernel reads, so a viewport resize under a live
radial session (which moves `scale` without moving `shapeKind`) cannot serve
a stale ellipse. The host mirror that used to prefill these rows,
`buildSurfaceComputeBackground`, is retired with its cache.

## Teardown

`destroy()` defers the real `device.destroy()` until every in-flight frame
unwinds. The failure it exists for: a frame parks on LIVE submitted GPU work
— `mapAsync` over a submitted `copyBufferToBuffer`, or `onSubmittedWorkDone`
over a submitted dispatch — and tearing the device down under one of those
took down the WHOLE Firefox process, not just a tab crash or a device-loss
toast.

`destroyed` now means "teardown requested" and `deviceDestroyed` means
"device gone" — the guard that stops both the idle path (`destroy()`
itself) and the drain path (`releaseFrame`, when the last in-flight frame
unwinds) from calling `device.destroy()` twice. The synchronous teardown
still runs whenever the device IS idle, which is what keeps gpu-bench's
one-device-alive-at-a-time invariant and `RenderSession.terminate()`'s
`void` contract untouched.

The same shape was open one module over and is now closed with the same
vocabulary: `flame-gpu-backend.ts` counts OPS where this module counts
frames.

Pinned by `surface-compute.test.ts` over a fake GPUDevice — the
`flame-gpu-backend.test.ts` idiom one module over, and the reason
`SurfaceComputeRenderer`'s constructor is PUBLIC over the named
`SurfaceComputeRendererInit` object: sixteen positional GPU resources behind
an adapter-acquiring `create()` left the whole state machine with no
injection point, so the only cover it had was a manual real-Firefox gate.
The fake CONFIGURES outcomes (a settle-on-demand device round trip, a
`destroy` spy) and implements no GPU behavior. What it pins is the COUNTED
SPAN — `renderFrame`'s increment to its `.finally` release — and the four
decisions hanging off it: the deferred teardown, the inline one when the
device is idle, exactly ONE `device.destroy()` across the
`destroyed`/`deviceDestroyed` split, and a drain that waits for the LAST of
two in-flight frames rather than the first (the plural case that matters,
since a latest-wins request during a live frame counts two). Each of those
was verified to FAIL under a matching mutation of the state machine, and
only that one.

What it cannot pin is the crash itself. The fake parks a frame at the
allocation error-scope round trip, where a real frame parks deeper on
`mapAsync`/`onSubmittedWorkDone` over submitted work — the same counted
span either way, but no Node process can say whether a driver survives a
teardown under it. `scripts/surface-teardown.verify.mjs` on a real
Firefox stays the authority on that.

### The browser teardown gates

Both gates are not npm scripts — they need a real Firefox build with WebGPU
enabled on a display, and they gate renderer LIFECYCLE rather than built
output, so the dev server hosts them: `npm run dev &`, then

```
node scripts/surface-teardown.verify.mjs --lens --toggleId=__modeExit --toggles=20
node scripts/flame-teardown.verify.mjs --toggles=12
```

The surface gate restarts or exits a live surface session while
`SurfaceComputeRenderer` still has a frame parked on submitted GPU work —
the widest trigger, a mode exit, is what undo/redo, a preset load and
clicking Points all reach — which used to take down the whole Firefox
process rather than the tab. Exit 0 is a clean sweep, exit 3 means it
reproduced.

Its flame sibling storms the palette select — `setPalette` has no equality
guard, so every toggle reaches `startAccumulation` and therefore
`backend.destroy()` — against a 2B-iteration accumulation, so each teardown
lands on an op parked on `mapAsync`/`onSubmittedWorkDone`. Same 0/3 verdicts
plus exit 2 for INCONCLUSIVE, which is the one this gate needs and the
surface one does not: a run that fell back to CPU (or a software adapter),
or never caught a restart, never exercised the path and must not read as a
pass — so it counts `Flame GPU: backend up on` lines rather than trusting
`#flameProgress`, whose percentage stays rounded at 0% through a storm this
fast. `--toggleId=` also takes `flameSupersampleSlider`,
`symmetryOrderSlider`, and the sentinel `__modeExit` — that last one is
INFORMATIONAL, not a gate on the deferred teardown: leaving flame mode never
calls `destroy()` at all, since main.ts kills the worker with
`worker.terminate()`, orphaning a live map a different way. MEASURED on this
stack (RX 7900 XTX, real Firefox): a regression gate rather than a
reproduction — the crash does not reproduce on it.
