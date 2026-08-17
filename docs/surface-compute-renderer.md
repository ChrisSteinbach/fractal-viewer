# `surface-compute.ts` — the WebGPU compute surface renderer, in full

This is the full record behind CLAUDE.md's `surface-compute.ts` bullet
(`src/app/surface-compute.ts`). The bullet in CLAUDE.md is the condensed
routing table and the rules; this document keeps every measured number,
every bead id, and every refuted premise behind it.

## Which sessions route here

`surface-compute.ts` is the WebGPU compute renderer for fold-shaped 3D
surface sessions (fr-tzdg): systems with base-map folds OR a fold FINAL
lens (fr-55s1 — `deHasFolds(de) || foldFinal`; the DE picks the kernel
core and the lens wrapper, and the first march slice's prior scales by
the lens branch count 27/3/81 ÷ 8). Since fr-dlxh it also takes escape-time
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
Escape and plain-affine `ifs4` targets scale no prior (the forward loop
is phone-cheap, and the pessimistic march prior only errs toward smaller
first slices); fold/lens-shaped `ifs4` targets scale by branch count the
way 3D does. Only the MARCH slice has a prior to scale since fr-2ojg —
the shade sizer opens with an empty cost model and a one-workgroup
capacity.

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
predicted from a two-term cost model — `intercept + n·marginal`, fr-2ojg,
whose whole record is two sections down — under a slow-trust
double/quarter capacity ladder.

The original design doubled capacity in RAY units, which let a run of
misses inflate capacity before a hit band paid for it — that caused five
kernel-confirmed i915 GPU hangs. The fix floors batches at one WORKGROUP,
never one hit: within a workgroup, cost is depth-dominated, so
sub-workgroup batches buy no submission-wall safety. The old 1-hit floor
was a one-way trapdoor — one hit band past the pass target, and every
1-ray batch re-measures the full per-submission wall as its per-hit cost;
the estimate latches that in, producing ~4 hits/s serialization that
reads as a settle parked forever at a pose-dependent percent. This is
fr-d6g5's Mesa-25.2.8 "park" (see below). The `?surfacetrace` flag and
`scripts/fold-settle-park.repro.mjs` are that diagnosis' kept
instruments. fr-2ojg's finding is that the SAME trapdoor ran at every
width below the occupancy knee, not only at n=1, and that the fix for it
is a cost model with an intercept rather than a wider floor.

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
resolution. The first draft of this record ASSERTED why ("the settle is
shade-dominated") — so the instrument grew a WHERE THE TIME WENT line and
the same settle was re-run to find out. Measured, same scene and raster:

| GPU submissions + sweep readbacks | count | ms      | share     |
| --------------------------------- | ----- | ------- | --------- |
| shade dispatches                  | 2634  | 23070.8 | **84.8%** |
| march dispatches                  | 114   | 4013.9  | 14.8%     |
| sweep readbacks (after)           | 58    | 107.0   | **0.4%**  |

So the assertion held — but the number is the point: fr-si66 moved the
readback from ~2.7% of that total to 0.4%, of a settle whose other 99.6%
is the shade half. The saving is transfer volume and host-blocked time,
and it is worth most exactly where fr-biox found the problem — an export
tile at the 4M-ray cap read a flat 64 MB of ray state per sweep, tens of
sweeps a tile, and now reads 4 B per ray still marching.

That table also says something fr-si66 did not set out to find, filed as
fr-257o — and a MEAN over the two shade queues is not a finding, so the
instrument grew one more regex (the `shade BEGIN isFree=` flag) and the
settle was run once more. The 84% splits:

| shade dispatches | count | ms      | share | mean     |
| ---------------- | ----- | ------- | ----- | -------- |
| free (miss)      | 2492  | 7926.7  | 29.3% | 3.2 ms   |
| hit              | 135   | 14881.1 | 55.0% | 110.2 ms |

Both halves say something, and the first draft of this paragraph had the
first one wrong by an order of magnitude. **Free batches are 29%, not
84%**: the flat 4096-ray cap the two queues then shared is 4096 rays of
one background write each costing 3.2 ms, which IS the per-submission
wall (there is no work in it), so a 1.26M-ray frame spends ~307
submissions painting backdrop, times the 8 supersampling passes
(fr-vpbq). Raising that cap 16x has a hard ceiling of 7.9 s on this 35 s
settle — real, bounded, ~22%, and NOT "most of the settle". (What
raising it actually bought is the next section, and it beat that
ceiling.) **The hit half is the bigger one** — 135 dispatches x ~178 hits
at ~0.62 ms per hit, the width-1 probe cost fr-p8bc already cut 23.8x,
re-paid by every one of the 8 passes — and this record closed by calling
it real work no batch-cap change touches. That last clause did not
survive its own instrument: see "And the hit half is NOT what fr-si66
concluded" below.

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

### The free shade queue drains whole (fr-257o)

The split above left the free half's cap un-run, and the answer turned
out to be that there is no cap to pick: THE FREE QUEUE HAS NO COST TO
MODEL. Every exit the shade entry offers a non-HIT status is the same two
lines — evaluate the backdrop ramp at this pixel's row, store it — and
that is checked per core rather than assumed, which is what fr-257o's own
bead asked for: EXHAUSTED falls through the same `st.y != HIT` exit as
MISS in all seven, and fr-rhn5's PLANE terminals are queued with the
HITS, where their probe evals belong. So the free queue now drains WHOLE,
one dispatch per march sweep, bounded by nothing but the device's own
dispatch ceiling. `SURFACE_COMPUTE_MAX_SHADE_BATCH` became
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
bead's arithmetic said 7.9 s and the settle gave up 10.0 s. The extra
~2.1 s is host-side and outside the GPU accounting entirely: 2434 fewer
dispatches is 2434 fewer command encoders, `writeBuffer` uploads and
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

The pass counts fall by 210-225 in every row, which is exactly
`misses / 4096` for each raster — the free drain, and nothing else. The
WALL falls least on lens3 and most on the sparse 4D slices, which is the
bead's own prediction confirmed and the honest way to describe the
feature: the saving scales with the MISS count, so the frames that take
longest benefit least. It is 3D and 4D alike (the affine4 core has no
folds and gains the most here), and it is one number, not a quality
knob — every settled PNG across all ten runs is byte-identical between
the two builds, and each is deterministic within its own build.

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

### The hit half is not work either — it is wall (fr-257o found it, fr-2ojg fixed it)

fr-si66's record two sections up closes by calling the hit queue "real
work no batch-cap change touches". That is wrong, and fr-257o's own
instrument is what says so. A third run of the shipped build printed the
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
keeping: batch size is CHOSEN from the cost EMA against a fixed
ms/dispatch target, so "small batches have high µs/hit" is close to
tautological — the sizer would draw that shape whether or not the small
batches were really more expensive per hit. So the discriminating
experiment was run: force the batch floor to 512 so size varies
INDEPENDENTLY of the EMA, same scene, same pose, same window. Settle
25.0 s → **15.0 s**, hit shade 15157.1 → **7853.3 ms**, dispatches 140 →
70, and mean ms/dispatch 108.3 → 112.2 — UNCHANGED, which is the whole
result. Cumulative from the pre-fr-257o baseline that is 35.0 s → 15.0 s,
2.33x.

The root cause was one line and it is fr-d6g5's trapdoor one order up:
`nextShadeHitEmaUs` was fed `shadeMs * 1000 / batch.length`, a
submission's WHOLE time over its ray count, so a 16-hit batch recorded
its ~85 ms latency floor as 5.2 ms per hit where the marginal cost is
~0.26 ms — and the sizer then divided the pass target by that inflated
number and picked another small batch. fr-d6g5 fixed the degenerate
1-ray case with a one-workgroup floor; the loop ran at every width below
the occupancy knee. That intercept is NOT the per-submission wall
(fr-257o measured that separately at 3-4 ms from the free queue, so at
most ~0.6 s of the 15.2 s was submission overhead) — it is the batch's
DEEPEST ray, since lanes run in parallel across EUs and a batch's hits
come from one scanline band.

THE FLOOR WAS THE EXPERIMENT, NOT THE DESIGN, and fr-2ojg shipped the
model instead. A floor is a one-way promise to submit that much work
whatever the measurements believe, and this is the exact mechanism behind
five kernel-confirmed i915 hangs and the Mesa park.

#### What shipped

`ShadeHitCost` is `cost(n) = intercept + n·marginal`, in µs, and six
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
   double-counted in either direction, and a genuine spike still
   collapses the next batch to the floor in ONE step.
3. **The budget is `max(pass target, 2 × intercept)`, capped at
   `SURFACE_COMPUTE_SHADE_DISPATCH_CEILING_MS` (1000).** Spend at most as
   much on marginal work as the fixed cost already being paid. Below the
   knee that is just the 250 ms pass target; above it — mandelboxKifs
   measures a ~480 ms intercept — refusing to widen past the target buys
   no safety at all, because the wall is the intercept, and costs an
   order of throughput.
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
   frame's shading of very nearly the same geometry, not backdrop.

There is no per-hit cost PRIOR any more. `SURFACE_COMPUTE_INITIAL_HIT_SHADE_US`
(20 ms/hit) could only ask for fewer hits than the one-workgroup starting
capacity already gives, while its 0.4-per-dispatch decay held ~7
dispatches at the floor before the measurements it was guarding against
could speak. The capacity ladder is the first-encounter bound; the model
is the sizer.

#### Measured (real Iris Xe, Mesa 25.2.8, headed Chrome on `:0`)

`scripts/march-readback-ab.mjs`, one settle per arm, the pose-pinned
`boxfoldPair` at 1400x900 (1.26M rays) — fr-257o's own scene, so the
numbers chain:

| arm                  | settle       | hit shade     | hit disp | ms/disp | disp/frame | worst dispatch      |
| -------------------- | ------------ | ------------- | -------- | ------- | ---------- | ------------------- |
| shipped              | 25029 ms     | 14807.4 ms    | 139      | 106.5   | 13.9       | 181.2 ms @ len 369  |
| + cost model         | 15016 ms     | 6248.0 ms     | 57       | 109.6   | 5.7        | 173.6 ms @ len 491  |
| + partial-batch hold | **10063 ms** | **2674.8 ms** | **20**   | 133.7   | **2.0**    | 175.3 ms @ len 2229 |

The middle row is the bead's own forced-512-floor experiment reproduced
by the model rather than by a constant, to the second (15.0 s both
times). Cumulative from the pre-fr-257o baseline: **35.0 s → 10.1 s,
3.5x**. A converged frame now shades all ~2240 of its hits in ONE
2229-hit dispatch of 175 ms; it used to take 14 dispatches and 1.8 s.

The same run's cost-vs-width table extends fr-257o's two buckets further,
and the last column is the whole argument:

| batch size | dispatches | hits  | totalMs | meanMs/disp | meanUs/hit |
| ---------- | ---------- | ----- | ------- | ----------- | ---------- |
| 1-63       | 3          | 113   | 224.1   | 74.7        | 1983.2     |
| 64-127     | 2          | 168   | 257.1   | 128.6       | 1530.4     |
| 128-255    | 2          | 378   | 209.7   | 104.8       | 554.8      |
| 256-511    | 1          | 256   | 118.7   | 118.7       | 463.7      |
| 512-1023   | 3          | 1830  | 391.4   | 130.5       | 213.9      |
| 1024+      | 9          | 15216 | 1473.8  | 163.8       | **96.9**   |

`lens3` (fr-g58b's fold-FINAL lens, ~93k hits per frame — the
frame-FILLING case) gains less and for a reason worth writing down: its
per-hit cost is 17 µs, so its big batches were already pinned at
`SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH` (4096) in BOTH arms and only the
ramp and the queue-limited slivers moved. Settle 35031 → 30034 ms
(−14.3%), hit shade 18084.4 → 13004.2 ms, 356 → 208 dispatches, worst
dispatch 77.4 → 76.1 ms.

`mandelboxKifs` at 800x520 does not settle at all, so it was run as a
fixed 150 s window on both arms. It is the fold monster, and the sizer
that never got past 127 hits there now reaches 512-1023:

| arm     | hit disp | hits shaded | hit shade ms | hits/s    | worst dispatch     | p95    |
| ------- | -------- | ----------- | ------------ | --------- | ------------------ | ------ |
| shipped | 134      | 7961        | 127376.8     | 62.5      | 1714.8 ms @ len 64 | 1377.3 |
| fixed   | 112      | 13900       | 126815.1     | **109.6** | 1735.1 ms @ len 64 | 1515.5 |

**1.75x the hits per second on the hardest scene the project has**, and
its own cost-vs-width table is the cleanest statement of the finding
anywhere in this record — from 16 hits per dispatch to 512, cost per
dispatch goes 643.8 → 1015.4 ms (1.58x) while hits per dispatch go 32x,
i.e. 39253 → 1983 µs/hit:

| batch size | dispatches | hits | totalMs | meanMs/disp | meanUs/hit |
| ---------- | ---------- | ---- | ------- | ----------- | ---------- |
| 1-63       | 5          | 82   | 3218.8  | 643.8       | 39253.7    |
| 64-127     | 75         | 5011 | 90364.6 | 1204.9      | 18033.2    |
| 128-255    | 16         | 2800 | 15788.2 | 986.8       | 5638.6     |
| 256-511    | 12         | 3959 | 13382.0 | 1115.2      | 3380.1     |
| 512-1023   | 4          | 2048 | 4061.5  | 1015.4      | 1983.2     |

#### The watchdog question, answered by measurement rather than by a divisor

fr-257o's reason for not shipping the floor was that its safety
arithmetic ran through a measured AVERAGE (fr-p8bc's ~108 ms/hit at full
width, ÷23.8 for the shipped width-1 probe) and that the A/B had not run
the near-surface fold-monster silhouettes. So `march-readback-ab.mjs`
grew three things for fr-2ojg: a WORST SINGLE DISPATCH block with a p95
beside it (a mean cannot answer a watchdog question), a HIT DISPATCHES
PER FRAME table (the sizer's ramp is per job, so a per-settle total hides
how much of a frame is spent climbing), and the scenes to ask on —
`--scene=lens3` for the frame-filling lens archetype plus a `--hash=`
escape hatch for anything else. All three scenes were then run on both
arms. The answer:

- **boxfoldPair: 181.2 ms → 175.3 ms.** The worst submission went DOWN
  while the batch that produced it went from 369 hits to 2229. That is
  the flat-cost-vs-width claim proven at 6x the width, and it is the
  single most useful line in the dataset.
- **lens3: 77.4 ms → 76.1 ms**, at 4096 and 3728 hits respectively.
- **mandelboxKifs: 1714.8 ms → 1735.1 ms, and in BOTH arms at `len=64`
  — the FLOOR.** The worst submission on the fold monster is a property
  of the scene's deepest ray, not of the sizer, and widening batches did
  not raise it. 1.7 s is 4.3x under the ~7.5 s i915 watchdog, and it was
  already there before this change.

`scripts/fold-settle-park.repro.mjs` (mandelboxKifs at 512x320, the
fr-d6g5 regression gate) came back **TIMEOUT, not PARKED** — the scene is
genuinely enormous, not wedged — and its trace tail measures that scene's
model directly: 12 dispatches averaging 19 hits cost 557.8 ms each, 21
averaging 64 hits cost 740.0 ms each — a secant through those two widths
puts that scene's intercept at ~481 ms and its marginal at ~4.05 ms/hit.
That marginal independently reproduces
fr-p8bc's own number (108 ms full-width ÷ 23.8 = 4.5 ms/hit) from a
completely different instrument, which is the best evidence available
that the two-term model is measuring physical things and not fitting
noise.

`scripts/surface-repro.verify.mjs --scenario=all --runs=2 --mode=x11::0`
is DETERMINISTIC on all five scenarios with 0 differing pixels, and all
ten settled PNGs are byte-identical BETWEEN the two arms — a sizing
change may not move a pixel, and a ray's shading does not depend on which
batch carried it. That run is also the second, independent measurement of
the win, at 1280x720 and across five scenes rather than one:

| scenario (settle wall)  | before      | after       |         |
| ----------------------- | ----------- | ----------- | ------- |
| boxfold3                | 19.0/18.8 s | 12.9/12.8 s | −32%    |
| pentatope4 (4D affine4) | 12.8/12.9 s | 8.7/8.8 s   | −32%    |
| pentatope4direct        | 12.8/12.9 s | 8.7/8.7 s   | −32%    |
| lens3                   | 26.2/25.9 s | 22.1/22.2 s | −15%    |
| sierpinski3 (WebGL arm) | 13.1/5.3 s  | 13.4/5.4 s  | control |

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
batch re-measured the full per-submission wall as its per-hit cost, the
spike-lift EMA latched it in, and the result was ~4 hits/s
serialization: a settle that reads as parked forever at a pose-dependent
completion percent. The fix was the one-workgroup floor (cost inside a
workgroup is depth-dominated, so a sub-workgroup batch buys no
submission-wall safety). `?surfacetrace` and
`scripts/fold-settle-park.repro.mjs` are the kept diagnostic instruments
for this failure mode.

fr-2ojg is this diagnosis finished. The floor cured the degenerate case
and left the mechanism running everywhere else: the flat region reaches
at least EIGHT workgroups, so every width below that was re-measuring
latency as per-hit cost, just less catastrophically. The EMA it latched
is gone — see "The hit half is not work either" above for the model that
replaced it, and for the fold-monster re-run of this same probe.

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

That ceiling is NOT met against the per-dispatch one (fr-257o's
`surfaceComputeMaxDispatchRays`, 4,194,240 rays at the workgroup limit
this renderer never raises) even though the dispatch ceiling is the lower
of the two on a spec-minimum device. They answer different questions —
how much memory may a frame commit, versus how much work may one
submission carry — and meeting them here would make a 4K pane trace soft
for a bound no single dispatch has to meet. The march slice and the free
shade batch clamp at the dispatch ceiling themselves; see "The free shade
queue drains whole" above.

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
