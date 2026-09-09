# Surface strip pipeline

Full evidence record for `src/app/strip-planner.ts` — the adaptive
scissor-strip sizer behind every WebGL surface trace. `AGENTS.md`'s
`strip-planner.ts` bullet is the condensed rules-and-invariants version;
this document is where the measured numbers, the reverted attempts and the
historical narrative live.

## What a strip is

`strip-planner.ts` sizes adaptive scissor strips for EVERY WebGL surface
trace, previews included. `surface-compute.ts`'s WebGPU compute path is not
one of its callers — that path bounds its own submissions instead. Bounded
preview strips removed the preview tier's one remaining unbounded draw,
closing off the i915-preemption GPU-hang path that used to kill fold
sessions outright.

Units are PIXELS, not rows: a strip is a row-major pixel interval rendered
as 1-3 scissor rects under ONE fence, so fold strips can shrink below the
cost of a single row.

## Cost priors and the evidence chain

The probe that starts a job is sized from a per-pixel cost prior, chosen in
order: the measured preview cost when one exists, else a pessimistic
fold-class prior, else the legacy rows fraction for affine. (The old
unprimed 3-row probe at full resolution was the kernel-confirmed i915
preemption hang — this ladder exists to never issue that probe again.)
From there, strips scale toward a per-tier `targetMs` of measured GPU time
each. "Measured" here means forced-completion via a 1x1 readback — NOT
`gl.finish()`, because some command-buffer paths return from `gl.finish()`
before the work has actually executed.

Measurement-based scaling is blind to one thing: fold+grid frames have a
100-1000x cheap/expensive band bimodality, where most pixels are nearly
free and a few (creases) are enormously expensive. So every strip is ALSO
capped at `STRIP_WORST_CASE_CAP_MS` of worst-case predicted cost,
independent of what the running average says.

The price starts at a class-pessimistic ms/px and RATCHETS UP as the job's
own measurements reveal worse pixels. It also CHAINS across job re-arms via
`scene.ts`, with evidence semantics:

- A COMPLETED job's whole-frame observation REPLACES the floor in BOTH
  directions (a 10x tier-gap safety margin). Down matters as much as up:
  without it, a measured-cheap fold system (e.g. a lens over affine) stays
  pinned at class-floor micro-strips forever, and the readback overhead of
  those micro-strips dissolves its settle and poisons the cost gate.
- A PARTIAL job's observation only ever raises the floor, never lowers it.

Iris measured the `mandelboxKifs` band at ~40-125ms/px, with single crease
pixels costing 1.7-3.1s each. Post-discovery, strips pin at ~1px there.

Evidence relaxation lives for exactly ONE completed-preview→settle handoff:
a superseded job means the pose moved on, so its evidence is stale and
dies with it. (A far-pose glide preview once relaxed the floor under a
parked monster pose — that's the failure mode this one-handoff lifetime
closes.)

A later strip-pump safety pass closed two remaining holes in this chain:

1. Measurements now also reach the ratchet through a measurement-time
   `observe(ms, px)` door. Previously `next()`'s sizing-time door only
   heard a measurement if another strip was still to be planned, so a
   job's LAST measurement — its final batch, its final drain strip, or an
   escaping sync-collapse strip — never reached the ratchet at all.
   Capture frames' final strips are typically the bottom rows, which are
   fold monsters' favorite home, so this mattered most exactly where it
   was most expensive to miss.
2. The pipelined refill now ALSO bounds its in-flight queue at a queue
   price. Before this, the queue was priced off the evidence chain's
   TYPICAL-cost class floor — the fold PRIOR rather than the fold WORST
   constant — which let a fresh fold session's first preview rAF-drip
   through its queue at ~10x its real wall-clock cost. The queue price is
   now raised live by the job's own ratchet and capped at one
   `STRIP_WORST_CASE_CAP_MS` of mispredicted work, so an estimate-lagged
   cost-band entry can no longer stall the main thread behind seconds of
   queued monster pixels. Before the fix this was ~3s per crease pixel,
   ~46s at parked monster poses; after, it's roughly one worst-capped
   strip beyond the one currently executing.

Measured on Iris Xe, real driver: a 180s `mandelboxKifs` run now completes
360/360 responsiveness pings with 0s stalled and the kernel silent; lens
settle 0.87-1.0s; escape 48ms; boxfold settle 793ms versus 212ms at the tip
of the preemption-hang work. The accepted residual cost is that the
queue-priced first preview paces slower pre-evidence, so its inflated
evidence over-strips the settle that follows it — a documented, accepted
trade rather than a bug.

## The pipelined pump and the sync tax

`scene.ts`'s strip pump is PIPELINED — a measured A/B verdict. The reason:
every sync point on the Iris/ANGLE stack costs ~66-90ms REGARDLESS of the
work behind it (`SURFACE_STRIP_SYNC_TAX_MS`). Main's 3.3s lens settle was
roughly 50 strips times that tax, and an earlier branch's first
per-strip-join cut multiplied it by the caps' strip count into a 15x
regression.

So strips go out as individually FLUSHED draw groups — the watchdog's
preemption boundaries — fenced only per roughly
`SURFACE_STRIP_FENCE_GROUP_MS` of predicted work. Batch measurements
SUBTRACT the sync tax to price only the MARGINAL trace work; leaving the
tax in would re-inflate the evidence, which tightens the caps, which
produces more strips, which pays more tax — a vicious cycle. Strips of a
row or more ROW-SNAP to a single scissor rect, because the fixed per-draw
cost (~20-30ms) triples under a 3-rect strip. The canvas blit rides
PRESENT-ON-DRAIN gaps: presents share the strips' GL queue, and the first
pipelined cut presented behind that queue and stalled the page's own rAF.

No-prior jobs (affine) keep the legacy sync-collapse behavior: serial
joined strips that complete a whole light job in one call, escaping to the
pipelined behavior past `SURFACE_STRIP_SYNC_ESCAPE_MS`.

## The two-term cost model

Subtracting a FLAT `SURFACE_STRIP_SYNC_TAX_MS` and dividing the rest by the
batch's pixels was a calibration, and it had an absorbing state. When a
batch's wall is dominated by fixed cost rather than by trace work,
subtracting 80ms leaves the remainder attributed to the pixels; the sizer
asks for fewer; the next batch is MORE fixed-dominated; and growing back
needs a batch measuring under `targetMs` (`STRIP_TARGET_MS` by default),
which the fixed cost alone forbids. The degenerate-zoom export stall measured it on a near-empty frame
at extreme zoom: strips collapsed 990 → 484 → … → 1px and then oscillated at
1-6px, each batch still costing 500-1700ms REGARDLESS of pixel count, with a
Save-PNG frozen at 59% for the last 5.5 minutes of a 480s run. Extrapolated
remaining cost: hours to days for one pass of eight.

**The fix is `surface-compute.ts`'s `ShadeHitCost` ported down** (the
compute arm's hit-shade sizer had the identical pathology at hit dispatches
— hit-unit batches, the one-hit-floor settle park, and the two-term model
that fixed it): `StripCost = {interceptMs, marginalMsPerPx}`, each
measurement's surprise split by WIDTH (`w = px/(px + pivot)` to the
marginal, the rest to the intercept), sizing off the MARGINAL alone. The
safety mechanisms are untouched: **the worst-case cap is still priced on the
RAW ms/px ratchet and applied LAST**, so the set of sizes a strip may take
is exactly what it was — only the choice within it moved. That precedence is
load-bearing and is written at the clamp: the model cannot tell a monster
pose from an overhead-bound batch (see the identity below), and the raw
ratchet is the only thing that can.

Three places the port had to DIVERGE from its compute twin, each measured
or reasoned rather than copied:

- **The pivot is a PRICE, not a width.** `SURFACE_COMPUTE_SHADE_COST_PIVOT`
  = 512 hits is a HARDWARE knee (below it a dispatch's cost really is flat
  in width). A scissored strip has no knee — its cost is linear in pixels
  from pixel one — so "narrow" is a statement about the SCENE, and this
  planner's two tiers are three orders of magnitude apart in natural strip
  width (a light affine settle converges at ~35,000px; a heavy fold PREVIEW
  at ~3px). A single pixel pivot cannot serve both. `STRIP_COST_PIVOT_MS_PER_PX`
  = 0.6 (inside the measured heavy-fold band: 0.5-4ms/px on mandelboxKifs,
  ~6ms/px on a SwiftShader preview) puts the settle tier's pivot at 125px
  and the preview tier's at 20px.
- **The rate limit is on the marginal's RISE, not its FALL.** Compute limits
  the fall because a falling marginal INFLATES its batch width. Here a
  RISING marginal SHRINKS strips, and shrinking is the direction with the
  absorbing state at the bottom. Optimism needs no limit of its own: it
  already has `STRIP_MAX_GROWTH` (8x per step) and the worst-case cap,
  neither of which the compute sizer had.
- **The floor is 32px, not "one workgroup".** There is no physical unit
  here, so it is chosen against the clamps it sits between: below the fold
  class's fresh cap (4000/50 = 80px), so it can never loosen a strip that
  cap was holding; 32x fewer submissions than a 1px floor. It does NOT
  apply to the probe or to a repeat of an unmeasured strip — that size is
  the caller's PRIOR, the one bound an unmeasured submission has.

`scene.ts` changed in three ways. Both writers already reported at
measurement time (the safety pass's `observe` door), so they feed the model
directly; the pipelined refill now passes **null** to `next()` instead of
`estimate × lastSubmittedPx`, because re-quoting a batch average at one
strip's width is a fabricated measurement at a width nothing was measured
at — the exact conflation the model exists to undo (its worst-price ratchet
contribution was redundant: same ms/px, and the ratchet is a max). That
retired `seedStripMeasurement` and the job's `measured` / `lastSubmittedPx`
fields with it. And the pump's two THROUGHPUT lines — the queue budget and
the fence-group close — now price on the model's marginal rather than the
batch average: with the average, the queue collapses to a single strip on
exactly the frames where the fixed cost dominates, which is where a
pipeline is worth having. The queue's SAFETY line (`worst()`, priced at the
raw ratchet, `SURFACE_STRIP_QUEUE_WORST_MS`) is untouched.

### Simulated, not yet driver-measured

Every number below is the shipped planner run against synthetic cost
functions (`intercept + px × marginal`), against a frozen copy of the
single-number sizer that preceded it, under the same probe, cap and
row-snap. The frozen copy lives in `strip-planner.test.ts` so "ordinary
frames are unmoved" stays a comparison rather than a memory. Converged
strip, its cost, and the frame's submission count:

| scene (cost function)               | new                        | old                        |
| ----------------------------------- | -------------------------- | -------------------------- |
| degenerate 500ms fixed (zoom stall) | 222px / 500ms / 4,151 subs | 1px / 500ms / 921,600 subs |
| degenerate 100ms fixed, 660x410     | 125px / 100ms / 2,165 subs | 1px / 100ms / 270,600 subs |
| degenerate noisy 500-1700ms         | 1280px / 700ms / 720 subs  | 1px / 921,600 subs         |
| healthy fold settle 5+0.05/px       | 1280px / 69ms / 720 subs   | identical                  |
| cheap affine settle 1+0.002/px      | 35840px / 73ms / 26 subs   | identical                  |
| fold settle at class cap 2+0.3/px   | 80px / 26ms                | identical                  |
| settle behind a 5x-optimistic prior | 144px / 74ms               | 146px / 75ms               |
| light preview 2+0.02/px, t12        | 384px / 10ms               | identical                  |
| heavy preview 3+0.4/px, t12         | 32px / 16ms                | 22px / 12ms                |
| monster preview 1+4/px, t12         | 64px / 257ms               | 3px / 13ms                 |
| monster settle 500ms/px             | 7px / 3502ms               | 1px / 502ms                |

**The two disclosed regressions are the last two rows, and they are the
same one.** Where a scene's natural strip is far BELOW the pivot, the split
reads its measurements as mostly fixed cost and the sizer stops tracking
`targetMs`, converging instead against `STRIP_MIN_PX` and the worst-case
cap. Both are bounded on both sides, so the cost is interruption
granularity and present cadence, never watchdog headroom: no strip's
worst-case predicted cost changed, because the cap is unchanged and applied
last (the monster settle's 7px × 500ms/px = 3.5s IS the cap's own 4000ms
promise; the old sizer's 1px was under it by accident, via the same
misattribution this fix removes). `strip-planner.test.ts` pins the
monster-preview case so it cannot drift unnoticed.

The reason it cannot be fixed by tuning is the identity, carried down from
the compute arm's own doc and re-proved for this shape: unclamped,
`nextStripCost` preserves `interceptMs = pivotPx × marginalMsPerPx`
IDENTICALLY, so the RATIO is the attribution weight's and only the SCALE is
the data's. Two parameters, one measurement, an exact fit. That is what
makes the fixed-cost branch's answer a constant width no measurement can
walk down (the property that kills the absorbing state) and equally what
makes the model unable to identify the two terms. Identification needs two
widths far enough apart to be a lever; the sizer visits one at a time. A
two-point slope estimator was prototyped over the same scenarios — it
identifies the terms correctly on the clean cases (degenerate 2560px, heavy
preview 32px) but is noise-sensitive on the ±40% measurement spread real
batches show, so it is recorded here as the direction a future session
would take, not as something shipped.

## Capture and export drains

Capture/offline export runs the SAME pump. Before that, those drains used to
join every strip themselves — effectively the pre-pipeline shape, wearing
export clothing, multiplying the sync tax by the planner's strip count.

Both drains now loop the same pump and differ only in how they WAIT
between calls:

- The synchronous drain (offline export, thumbnails) blocks on ONE
  whole-queue readback per queueful.
- The yielding drain (the Save-PNG's, behind its progress modal) hands the
  main thread back on rAF, timer-backstopped at a frame — because a page
  whose frame clock runs slow starves the queue (headless SwiftShader
  serves rAF at ~10Hz), and because a bounded macrotask spin covers the
  case where the page is hidden, rAF stops and timers throttle. This is
  what lets a cancel land within a tick instead of behind a multi-second
  crease strip.

A capture job never presents (the export-scale target must not reach the
canvas), ADOPTS the fence backlog exactly like live jobs (a pipelined
refill has to price the real GL queue to work at all), and winds its own
queue down before returning from an abort, so no export leftovers outlive
the export.

The synchronous drain retires its fences WITHOUT polling them, immediately
after its readback: the readback is the stronger barrier. A sync object's
signaled state is only refreshed on the page's message loop, so a loop
that never yields would read `TIMEOUT_EXPIRED` forever and spin on a queue
the GPU actually finished long ago. Measured: without this fix, a 4.3s
thumbnail became a 300s hang with `spentMs` frozen at 0 — even the spend
ceiling could not end it, because the ceiling reads `spentMs`, and
`spentMs` never advanced.

MEASURED A/B, SwiftShader, same pose and build otherwise: at 1280x720, on
a pose neither path can finish, the live settle covered 38% of a 60s
window in both arms, while the capture went from 0.4% to 15% (~37x). On a
cheap 900x560 frame the live settle finishes in 2.6s, where main's
Save-PNG burned the whole 60s spend ceiling and refused to produce a PNG
at all; the fix delivers it in 4.7s, cancels in 0.9s (main: 2.2s), and
renders the collection thumbnail through the sync drain in 2.5s (main:
4.3s parked, 6.8s after a drag) — a byte-identical image either way.

`scripts/capture-export.verify.mjs` is the gate for this behavior;
`scripts/capture-drain.verify.mjs` is the measurement harness beside it.

## Cost ceilings, and why the interactive path has none

Cost ceilings belong to the SYNCHRONOUS drain alone — offline export and
thumbnails, the callers that freeze the tab for a frame's whole duration and
offer no way to stop it. There, measured evidence predicts the frame cost up
front (never the class prior, which would refuse every fold export sight
unseen), and the drain refuses past `SURFACE_CAPTURE_PREDICT_CEILING_MS`
(120s). The drain itself also aborts past `SURFACE_CAPTURE_SPEND_CEILING_MS`
(60s) of real spend. Both throw `SurfaceCaptureCostError`: the offline
exporter fails the run, and the thumbnail path falls back to the explorer
render.

The ceiling's currency changed meaning along with the drain fix:
`spentMs` is batch-attributed busy wall time with the sync tax subtracted,
so the same 60s budget now buys tracing where it used to buy joins.

The INTERACTIVE Save-PNG path is refused nothing. Its modal discloses
measured coverage, its Cancel works, and the drain yields — so having a
prediction (measured to run ~4x high) decide for the user would be exactly
the patience-guessing that the truncated-preview regression already reverted
for the preview tier, one render mode over (and the WebGPU arm had never
done that in the first place). The "Render anyway" opt-in was retired along
with the refusal it existed to escalate past.

Capture observations feed the evidence chain RAISE-ONLY, without killing
it: the pose hasn't moved, so live settle/preview evidence stays valid,
and the drain's export-scale observation may only tighten that floor,
never own it outright. (A micro-strip capture priced at pure readback
overhead would otherwise pin the next settle to dissolved micro-strips.)

One exception, measured on an unmeasured fold capture: a COMPLETED capture
may SEED an EMPTY chain, because offline export is the one caller that never
fills the chain any other way (a system upload clears it, and force frames
bypass the preview). Without this, every frame of a fold-scene video priced
its queue at the class prior — roughly 100x above its own actual pixels —
and paid a join per ~400px. The rule is seed, never replace, and it's safe
in the direction it can be wrong: a capture traces the WHOLE frame at its
armed pose, and an export-scale trace resolves finer pixels than the live
tier, so its reading is HIGH rather than low.

## The no-give-up verdict

The question was a runtime-mode verdict on monster-pose previews: the
floor-rung preview at `mandelboxKifs`'s entry pose ran past 210s and 4500px
with no terminal state — the settle never armed. A mode bail and a sub-floor
rung were both considered and rejected, because the cost is pose-local (only
~2x per rung) against a gap of >=50-150x, so neither would have actually
helped.

Two rounds of budget/prediction truncation shipped, and were then REVERTED:
both clipped a preview that was actually completable. The first case clipped
a 20-map Menger-lens preview that was 62% done with only ~2.5s left.

Final verdict, the user's: no automatic give-up. `surfaceRenderProgress()`
plus the surface progress row ("Preview 43%" / "Full detail 0.4%", one
decimal place under 10%, hidden when idle — and the label also names its
engine, "· WebGL" / "· WebGPU", with the compute side fed by `onProgress`
ray tallies) disclose honest coverage, and the user decides. At true
monsters the preview may grind for minutes with the settle never arming, but
safely — 120/120 responsiveness pings, 0s stalled, because the bounded-strip
pump (not truncation) is what carries safety here.

Save-PNG's refusals had gained a "Render anyway" opt-in (a 300s consented
backstop) before both the refusal and the opt-in were retired: once the
export modal disclosed coverage and Cancel actually worked, the refusal was
just guessing at a patience the user was already expressing directly.

Measured A/B (Iris, real driver, `?surfacegl`): lens-system settle 2.5s
versus main's 3.2s (total-to-settled 6.8s versus 7.4s), boxfold-pair
settle 0.2s, escape 45ms — all at full safety caps, kernel-silent through
every monster run.

The settle always ARMS, however expensive the frame: bounded strips grind
visibly and interruptibly. (An early cut of the preemption-hang work had
gated the settle on predicted cost and silently blanked legitimate lens
settles into permanent preview blur — a silent refusal reads as a broken
render, which is the core lesson behind this whole verdict.) The same
never-refuse discipline now covers the preview too: it always runs to
completion, with progress disclosed rather than bounded.

The unbudgeted completion pass carried that same line across the WebGPU
seam, where all three affordances — always-arms settle, always-completes
preview, disclosed progress — had been missed. A compute preview is
wall-budgeted (`main.ts`'s `SURFACE_COMPUTE_PREVIEW_BUDGET_MS`, 2s) so the
rung ladder can learn during motion — that budget is legitimate and
unchanged. But at the FLOOR rung, a truncated frame used to be the preview's
LAST word: there was nothing cheaper to drop to, so the loop drained and the
settle fired over a mostly-backdrop pane, with the truncation undisclosed
and unskippable. The budget stays a MEASUREMENT device; what changed is the
terminal state on a parked view — a floor-rung truncation now re-runs the
same rung UNBUDGETED to completion, with progressive presents, a "Preview ·
WebGPU N%" row label, and a live Skip button (`skipSurfacePreviewNow`'s
compute arm had already implemented the handoff; only its visibility was
missing). Bounded submissions, not the budget, carry watchdog safety — the
settle is equally unbudgeted.

MEASURED (Playwright, Firefox 151 WebGPU, ~10-20x slower than Chrome's,
1920x1057, using the reporter's own 20-map Menger + mandelbox fold lens +
balloon scene): two 2.1s truncated floor previews resolving 5% of their
9916 rays each, then a completion pass resolving all of them in 13.8s and
disclosing coverage climbing 3.9% -> 97% as it did, while the settle
behind it was still at only 48% after 179s — that completion pass supplied
~4% of the wall-clock time for the only whole image seen in the first
several minutes. `scripts/surface-preview-completion.verify.mjs` is that
gate, and it is necessarily Firefox-shaped: Chrome's preview completes
inside the budget on this hardware, so the bug is device-speed-dependent
(slow adapters, software devices, big viewports) rather than
browser-specific.

## Preview coalescing

The STRIP path had the mirror hole to the WebGPU one above: calling
`renderSurface("preview")` ARMS a fresh job every time, so re-arming per
invalidation discarded any in-flight partial. On any renderer where a
preview spans multiple frames, the job died before it could ever present —
a continuous drag painted essentially NOTHING for its whole duration.

Measured under SwiftShader at a 100ms move cadence: across 6s of drag, 13
of 15 samples were byte-identical at jpeg size 69360, with the progress
row reading "Preview · WebGL 0%" and `previewActive` true throughout. The
two non-identical samples are the mechanism caught in the act: one sample
found a job at 19% progress, and the next sample — 175ms later — was only
0.3% larger and had reset back to 0%. In six seconds of dragging, exactly
ONE partial strip was ever presented, and the job that produced it
re-armed away before it could finish.

The fix: `main.ts`'s tick now COALESCES like the compute loop already did.
While a job is in flight, an invalidation STEPS it instead of re-arming
it, and stays latched in `scene.needsRender` so the next arm (once the job
does complete or get superseded) takes the freshest camera. Pose coherence
comes for free: `armSurfacePreview` snapshots the camera into uniforms
once, so a multi-frame job traces exactly ONE pose throughout; and a
device fast enough to complete a preview inside its own arming call never
reaches the coalescing branch at all.

`scripts/surface-tier.verify.mjs`'s mid-drag softness check is the gate
for this fix. It had been failing at a jpeg similarity ratio of 0.99-1.00
(because the "mid-drag" frame it captured was actually the SETTLED frame,
unchanged throughout the drag) and now reads 0.83 with the coalescing in
place — evidence that a genuinely different, softer, in-progress frame is
now what gets presented mid-drag.

Fold surface sessions separately gate their first frame on `compileAsync`
of the fold tracer program, so that the ~25s link happens off the critical
path wherever the driver offers `KHR_parallel_shader_compile`. The compile
mesh MUST mirror `FullScreenQuad`'s position+uv triangle exactly, or the
draw ends up linking a second program variant instead of reusing the
compiled one. The gate also defers `activate()`'s guide/selection refresh
so that no other re-link request can join the driver's compile queue
behind the fold program.

## Intermittent 4D finite Balloon settle observation

On 2026-09-08, `scripts/tiling-balloon.verify.mjs` exposed an intermittent
WebGL settle stall on accelerated AMD Radeon RX 7900 XTX, Mesa 25.2.8.
The scene was the gate's A4-tiled 4D fixture, with Balloon, a copied rotor and
camera, and an independent echo palette. Ordinary on/off screenshots and
PNG exports completed before a later look-control boot stopped progressing.
Two isolated tint-strength-1 legs exceeded the unchanged 240s settle deadline
at 46% and 71% (whole-leg times 257.2s and 256.5s). A palette-change leg held
47% for at least 90s and was operator-aborted at 125.2s; that was not a
completed gate. The native-randomness timeout reported a visible, focused
page, 16.67–16.68ms rAF gaps, no browser errors, `settleActive: true`,
`previewActive: false`, `settled: false`, and no completed census.

The same tint-strength-1 fixture as the first Surface page completed its
640×480 settle in 129ms: 54 strips, all 11 fences retired, 24,596 hits,
282,604 misses and no exhausted rays. The full copied-link/export/look
sequence with read-only GL counters and `surfperf` completed every settle
in 130–280ms and every export in 0.6–1.2s. Two copies carrying a delayed
single-flush rescue also passed before either rescue fired. Finally the
unchanged production verifier passed the complete isolated 4D WebGL route
in 32.6s, including both look controls and exact-zero echo-off differences.
The final unmodified all-renderer matrix then passed all 12 rows in 170.3s
with the same 240s settle deadline.
The production bundle remained unchanged throughout these experiments.

The cause remains unestablished. Slow-rAF presentation starvation does not
match the measured cadence; a trailing-fence flush hypothesis was never
tested on an actually stalled context; and a tint-value-only shader cliff
does not explain the first-page success or the separate palette stall.
Removing a global random override did not remove the timeout. No strip
scheduling or shader workaround was applied from these observations.

Reproduce after a production build and preview with
`node scripts/tiling-balloon.verify.mjs --display=:0 --only=surface --dimension=4 --engine=webgl --look=true`.
The instrument records complete settle state, visibility and recent rAF
gaps on long waits. Original logs, copied diagnostic drivers and the
machine-readable investigation record land under
`scripts/out/finite-balloon-surface-investigation/`; output is untracked.

### Live queue diagnosis

On 2026-09-09, the unchanged production sequence first passed in 33.3s on
the same accelerated AMD/Mesa stack, using Chromium 151.0.7922.34. A build
adding only opt-in host counters (`?surfacestate&stripdiag`) then reproduced
the tint-strength-1 stall at 66%. The diagnostic reads the planner, queue,
existing fence-poll results and outer scheduler gates; it issues no GL calls.
The verifier used ordinary window randomness and its existing echo observer,
without the optional GL command observer or a rescue.

The stalled job had issued all 307,200 pixels in 56 strips. Ten of its twelve
fences retired; two own fences covering 102,400 pixels remained, with a
64,640-pixel head. Through the unchanged 240s deadline, the pump ran 14,377
times and made 14,386 actual fence polls, still returning `TIMEOUT_EXPIRED`.
Prices stayed finite, the accumulated attributed work stayed at 97.08ms,
and no export, capture, preview or pending invalidation owned the scheduler.
The page remained visible and focused with approximately 16.67ms rAF gaps.
Device-wide busy samples were 2–5%; these are not an independent fence signal.
The complete leg failed after 257.2s. The same copied/export/look sequence
then completed with tiling removed (17.2s) and with Balloon disabled (20.4s).
Across the complete three-repeat sweep, the other two finite legs passed
(35.2s and 35.5s), and all six untiled/Balloon-off control legs completed.
The sweep correctly exited 1 for its failed finite leg.

This establishes a fence-retirement stall, rather than planner or frame-loop
starvation, for this reproduction. It does not establish that only the final
fence lacked submission: with two outstanding groups, the earlier fence
necessarily precedes a later strip's explicit flush. Chromium's pinned
implementation also submits pending query checks and flushes its underlying
driver fences, so the JavaScript command order alone cannot locate the fault.
See its [query tracking](https://chromium.googlesource.com/chromium/src/+/151.0.7922.34/gpu/command_buffer/client/query_tracker.cc),
[WebGL sync cache](https://chromium.googlesource.com/chromium/src/+/151.0.7922.34/third_party/blink/renderer/modules/webgl/webgl_sync.cc)
and [EGL fence implementation](https://chromium.googlesource.com/chromium/src/+/151.0.7922.34/ui/gl/gl_fence_egl.cc).

A second three-repeat sweep enabled the GL command observer and conditional
browser trace/rescue. Its second **authored** boot stalled at 79%, before
that repetition's copied-link or export: all pixels were issued in 65 strips,
with one 64,000-pixel fence outstanding (11 of 12 retired). This was the
ordinary tint-strength-0.42 fixture, so the stall does not require a
tint-strength-1 edit. The first and third complete sequences passed in 33.55s
and 33.52s. The middle sequence failed in 242.61s, including the unchanged
240s settle deadline.

The 3.010s trace taken on that stalled page contained 180 executed WebGL
cache-rearm tasks, 180 compositor frame tasks, two Chromium command-buffer
flushes advancing the put offset by 100 entries, and 2,403 GPU-service
`PerformWork` executions. The GPU process received both flushes within 0.85ms;
the largest gap between service-work calls was 3.54ms. Across the surrounding
snapshots, actual JavaScript polls advanced from 925 to 1,123 while the same
fence stayed pending. These events establish ongoing cache rearming and
submission, but carry neither native fence status nor a per-query/service-stub
identifier. Query handling, ANGLE and Mesa remain unresolved parts of the
completion path; service FIFO processing can wait behind an earlier query.
See [service scheduling](https://chromium.googlesource.com/chromium/src/+/151.0.7922.34/gpu/ipc/service/command_buffer_stub.cc)
and [query processing](https://chromium.googlesource.com/chromium/src/+/151.0.7922.34/gpu/command_buffer/service/gles2_cmd_decoder_passthrough.cc).

After 18.35s of unchanged progress, the verifier rechecked that same live job
and **executed one `gl.flush()`** on its context. The GL observer recorded the
call; no fence retired afterward through the deadline. Unlike the earlier
unfired rescue experiments, this is a completed negative intervention.
Neither the trace nor the explicit flush released the stalled queue. No
post-fence flush or scheduling workaround is justified by these measurements.

Eight read-only samples of that GPU process's DRM fdinfo over 3.56s also kept
its client gfx/compute accounting unchanged. The installed kernel identifies
as Ubuntu 7.0.0-29 based on 7.0.12; matching upstream amdgpu accounting includes
elapsed time for unfinished **scheduled** jobs. This weakens the long-running
shader explanation, but excludes neither unscheduled/dependency-blocked work
nor incorrect completion bookkeeping; Ubuntu's downstream source was not
available for comparison. The counters are not a native fence oracle.
See [amdgpu job accounting](https://github.com/gregkh/linux/blob/v7.0.12/drivers/gpu/drm/amd/amdgpu/amdgpu_ctx.c#L160).

The extended verifier supports bounded `--repeat=1..20` and additive
`--controls=untiled|balloon-off|both` sequences. `--stripdiag=true` preserves
host snapshots without GL wrappers; `--gltrace=true` additionally records
existing GL calls and pending fence IDs. `--browsertrace=true` captures one
three-second task/submission trace after 15s unchanged planner/fence progress,
excluding GPU timing-query instrumentation. `--rescue=flush` permits one
explicit intervention only after rechecking that same stalled job, with
pre/post evidence and an explicit fired status. Neither diagnostics nor a
rescue extends the settle deadline or weakens the completed-settle gate.
Rows explicitly distinguish completed output from unassisted qualification:
an assisted completion records its rescue and cannot pass the native gate
(exit 2 if it is the only qualification limitation; any failed row takes
exit 1). Trace collection has one absolute deadline capped by the settle
deadline, including cleanup, and a rescue rechecks that deadline in the
browser task that would issue the flush.
Final runs of the updated instrument passed all three sequences in each
dimension: 3D finite/untiled/Balloon-off in 19.62/14.70/12.79s and 4D in
33.58/14.44/20.92s, including exports, both look controls and exact-zero
Balloon-off differences. These successful repetitions qualify the instrument
in both dimensions; they do not erase the earlier intermittent failures or
demonstrate a rendering fix. The application pump and shader behavior remain
unchanged. The remaining investigation needs native query/fence identity and
any blocking service-queue predecessor, which the current trace cannot expose.
Artifacts for this investigation land under
`scripts/out/surface-settle-stall/` and remain untracked.

### Native GL boundary

A further 2026-09-09 sweep observed existing native calls through a Linux
preload, with no added GL calls or rescue. The actual backend resolved
`glXGetProcAddress` through `libGL.so.1`, context switching through
`libGLX.so.0`, and sync calls through `libGLdispatch.so.0`. This is ANGLE's
native OpenGL/GLX path. Chromium's
[GLFenceARB::HasCompleted](https://chromium.googlesource.com/chromium/src/+/151.0.7922.34/ui/gl/gl_fence_arb.cc)
uses `glClientWaitSync(sync, 0, 0)`; ANGLE's pinned
[SyncGL::clientWait](https://chromium.googlesource.com/angle/angle/+/6dab7c7e742b528fd52233d3cc926e61b1e7d70d/src/libANGLE/renderer/gl/SyncGL.cpp)
forwards that wait to native GL. The captured native caller matches that
implementation in the installed binary. The Vulkan global-EGL-fence path is
not this backend.

The three-repeat 4D copied/export/look sweep completed seven of nine sequences
and correctly exited 1. Two native sync lifetimes remained pending through
the original 240s settle deadline:

| Scene                            |   Whole sequence | Observed native pending span | Native poll lower bound | Native flushes after creation |
| -------------------------------- | ---------------: | ---------------------------: | ----------------------: | ----------------------------: |
| Untiled, first authored boot     | failed, 242.546s |                     239.782s |                 399,764 |                             3 |
| Finite, independent-palette boot | failed, 268.352s |                     239.590s |                 399,161 |                             3 |

Every counted native wait returned `GL_TIMEOUT_EXPIRED`, and all three flushes
in each case returned on the fence's creation context. The first fence's
initial native flush returned 0.029ms after creation. These native flush calls
are observed, not inferred from JavaScript calls or Chromium source; their
returns do not establish kernel submission or GPU completion.
The app remained visible with normal frame cadence; its two pending fences
held progress at 47% and 46%, respectively. These jobs had not issued their
last pixels: the bounded queue prevented further work while its head stayed
pending. No queue cap, completion criterion or deadline was changed.

Both other finite sequences completed (34.002s and 35.626s), both other
untiled sequences completed (12.639s and 14.501s), and all three Balloon-off
sequences completed (20.791s, 20.387s and 20.521s). Before the finite palette
failure, the authored, restored, echo-off and both tint boots completed,
including the restored and echo-off PNG exports. Removing tiling does not
exclude the observed stall. The failed pages' GPU processes disappeared after
page closure; neither a signal nor deletion of the stalled native handle was
observed. That truncated lifetime does not establish why a process exited.

This locates an unavailable sync at the native GL API boundary. Native handles
and timestamps alone do not identify Chromium's owning query or distinguish
it from a FIFO predecessor. The read-only artifacts, including process maps,
scene timestamps and sampled native calls, are under
`scripts/out/native-fence-investigation/native-4d-02/`.

### Guarded Chromium query attribution

`scripts/native-gl-trace.build.mjs` builds the optional native observer on
Linux x86-64 with glibc and a C compiler. It intercepts explicit-handle
`dlsym` and native proc resolvers, preserving distinct original functions,
arguments and return values. It adds no GL calls. Returned polls are sampled
on the first call, status changes and every 256 calls; the analyzer treats
their counts as lower bounds because the bounded poll cache can collide and
native handles can be reused. A slot identifies a function implementation,
not a fence namespace. The trace records returned calls, so it cannot diagnose
a native call that never returns.

With `NATIVE_GL_TRACE_STACK_AFTER_MS=5000`, the observer also records at most
one prolonged pending stack and one successfully recovered query per process.
Successful-query recovery has a bounded 64-attempt limit. Private field reads
require Chromium's exact GNU build ID
`5f6e1a6835b28b53be4483a0c48063fd3fcb3108` and matching instruction bytes.
The installed binary lacks unwind-table coverage for the relevant frames,
so guarded recovery follows at most 32 frame pointers within 256KiB using
`process_vm_readv` on its own process. The exact call chain and saved-register
instructions must match before interpreting the query, and the recovered
`GLFenceARB` object must equal the query's selected fence. Unsupported builds
still permit native call observation; they do not qualify private query
identity. The guards and field offsets live in the builder beside the code
that uses them.

The successful 3D control recovered the FIFO-front
`GL_READBACK_SHADOW_COPIES_UPDATED_CHROMIUM` (`0x84F8`) query, service ID 6,
at the exact `ProcessQueries` call site. Its matching native GLsync returned
`GL_ALREADY_SIGNALED`. All layout, frame, read and fence-object checks passed.
The observed shared `QuerySync` still held process count 0 against submit
count 1: this observation occurs inside `HasCompleted`, before
[ProcessQueries publishes completion](https://chromium.googlesource.com/chromium/src/+/151.0.7922.34/gpu/command_buffer/service/gles2_cmd_decoder_passthrough.cc#2301).
That count difference is expected even on a successful native wait and is
not itself a publication defect. The same observer completed the full 3D
finite/untiled/Balloon-off copied/export/look sequences in
19.538s/12.143s/12.271s. A repeated 4D run independently validated successful
query recovery and completed all nine sequences. Passing runs qualify the
observer; they do not refute the earlier intermittent stall or establish a
renderer fix.

A following six-repeat finite-only 4D run captured a prolonged pending query
during repeat 4's copied-link restored boot, after three complete
copied/export/look sequences and the fourth authored boot. The same observer
library was used for all these guarded runs (SHA256
`6a7cc50592ac0379bd58aaa6a65f314d9ea52d31dee0aa42d2360db57cfa7a32`).
At 5.001s of continuous native timeouts, GPU process 1110885's stack 26751
identified:

| Observed field                     | Value                               |
| ---------------------------------- | ----------------------------------- |
| Native GLsync                      | `0x3b2c07b4d100`, generation 5      |
| Native creation/poll context       | `0x3b2c00091d00`                    |
| Native wait                        | `glClientWaitSync(sync, 0, 0)`      |
| Returned status                    | `GL_TIMEOUT_EXPIRED`                |
| FIFO-front target / service ID     | `0x84F8` / `9`                      |
| Query / decoder                    | `0x3b2c2fabea00` / `0x3b2c0848e000` |
| QuerySync / submit / process count | `0x7fb2d7e00048` / `1` / `0`        |
| Selected fence = recovered object  | `0x3b2c0c244e80`                    |
| ANGLE SyncID held by that object   | `2`                                 |

The verified ELF-relative frame sequence is `SyncGL::clientWait` at
`0x77d8dc0`, `Context::clientWaitSync` at `0x76eb081`, the ANGLE entry point
at `0xbf7ed2e`, `GLFenceARB::HasCompleted` at `0xbf2837d`, and the
`ProcessQueries` readback-shadow branch at `0xd181420`. The native sync,
ANGLE SyncID and service query ID are separate identifiers connected by this
live call chain, not by their ordinal order. All memory reads and object
consistency checks passed. This identifies the actual FIFO-front query whose
native completion blocks service progress. Mapping a frontend JavaScript
fence ordinal to that query is still unobserved.

That native lifetime remained pending for 239.809s between its first and last
observed polls, with a conservative lower bound of 398,420 returned timeouts
and no observed signal or deletion. Three native flushes returned on its
creation context; the first returned 0.031ms after creation. The restored
boot exhausted the original 240s settle deadline, failing its whole sequence
at 248.930s. The app stayed visible with normal 16.675ms frame cadence and
no browser errors. Its planner had issued all 307,200 pixels, but two fences
covering 94,720 pixels remained in flight at 69% completion. Actual app fence
polls reached 14,380; 12 fences were created and 10 retired. The successful
negative controls above exercised the same query recovery and complete
settles/exports without changing caps, deadlines or GL calls.

Repeat 6 reproduced the same guarded FIFO-front path in a palette boot:
process 1129723, service query 8, decoder `0x3b2c01048000`, matching fence
object `0x3b2c16b45820`, ANGLE SyncID 1, and native GLsync
`0x3b2c0d047140` generation 4. The native pending span reached 239.820s
with at least 398,408 returned timeout polls and three same-context native
flushes. The whole sequence failed at 268.677s after its unchanged 240s boot
deadline. The run completed four of six full sequences and exited 1;
neither reproduced failure received a rescue.

External `/proc` copy attempts for the two stalled processes produced empty
files and do not qualify as captured snapshots; end-of-run capture found both
processes gone. Their query identity
comes from the recorded in-process frame chain and matching executable-image
guards, not those unavailable external snapshots. This does not establish
why the processes exited.

The observed incompletion reaches the native GL boundary; the remaining
cause is on the native submission/completion path. The capture does not
distinguish upstream ordering or bookkeeping, Mesa submission/fence state
or kernel completion. A minimized reproduction must preserve the
copied-link/context/export sequence and identify the native fence while
comparing those layers. Neither a driver fix nor an application workaround
is established by these observations. The runtime query records, process
maps, scene events and full failure diagnostics remain untracked under
`scripts/out/native-fence-investigation/query-final-4d-finite/`; successful
guarded controls are in the sibling `query-final-3d/` and `query-final-4d/`
directories.

Build and verify the observer without starting a browser:

```bash
node scripts/native-gl-trace.build.mjs
node scripts/native-gl-trace.verify.mjs
node scripts/native-gl-trace.analyze.verify.mjs
```

After building and previewing the production app, and verifying the actual
accelerated renderer with the current Xwayland cookie, reproduce with a fresh
output directory:

```bash
NATIVE_GL_TRACE_STACK_AFTER_MS=5000 node scripts/tiling-balloon.verify.mjs \
  --display=:0 --only=surface --dimension=4 --engine=webgl --look=true \
  --repeat=3 --controls=both --gltrace=true \
  --nativegltrace="$PWD/scripts/out/native-gl-trace/native-gl-trace.so" \
  --outdir=scripts/out/native-gl-observation-4d
node scripts/native-gl-trace.analyze.mjs \
  scripts/out/native-gl-observation-4d/native-gl-trace.jsonl \
  --events=scripts/out/native-gl-observation-4d/native-gl-trace-events.jsonl \
  --source=scripts/out/native-gl-trace/native-gl-trace.c \
  --output=scripts/out/native-gl-observation-4d/native-summary.json
```

Use `--dimension=3` and another fresh directory for the dimensional control.
The launcher records the library hash, browser command provenance, allowlisted
environment, scene timestamps and available process maps without changing
browser flags. Empty native output exits 2 while preserving the rendering
rows' own verdicts; nonempty output alone does not prove hook coverage.
The offline analyzer preserves pointer generations and flags ambiguous
provider identity. Its `queryObservations` reports both raw snapshot fields
and whether all identity guards passed. Process maps use ELF load segments
to distinguish virtual addresses from file offsets. Neither native handle
order nor service IDs identify the frontend observer's JavaScript fence
ordinal across contexts.

## Measured A/Bs

Quick-reference table of the headline measured results above, each tied
to the section that carries its full context:

| Scenario                                                                                       | Result                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strip-pump safety pass, Iris Xe, 180s `mandelboxKifs` run                                      | 360/360 responsiveness pings, 0s stalled, kernel silent; lens settle 0.87-1.0s; escape 48ms; boxfold settle 793ms vs 212ms at the preemption-hang work's tip                                 |
| Strip-pump safety pass, before/after queue stall                                               | ~3s per crease pixel / ~46s at parked monster poses -> ~one worst-capped strip beyond the one executing                                                                                      |
| Capture/export drain fix, SwiftShader, 1280x720, unfinishable pose                             | live settle 38% of a 60s window in both arms; capture 0.4% -> 15% (~37x)                                                                                                                     |
| Capture/export drain fix, SwiftShader, cheap 900x560 frame                                     | live settle 2.6s; old Save-PNG burned 60s and refused; new: 4.7s deliver, 0.9s cancel (old: 2.2s); thumbnail 2.5s via sync drain (old: 4.3s parked, 6.8s after a drag); byte-identical image |
| Sync-fence polling fix                                                                         | 4.3s thumbnail that hung 300s with `spentMs` frozen at 0, before the fix                                                                                                                     |
| No-give-up final verdict, Iris real driver, `?surfacegl`                                       | lens settle 2.5s vs main 3.2s (total-to-settled 6.8s vs 7.4s); boxfold-pair settle 0.2s; escape 45ms                                                                                         |
| Unbudgeted completion pass, Firefox 151 WebGPU, 1920x1057, 20-map Menger + fold lens + balloon | two 2.1s truncated floor previews at 5% of 9916 rays; completion pass 13.8s, 3.9% -> 97%; settle still 48% after 179s                                                                        |
| Preview-coalescing bug, SwiftShader, 100ms drag cadence                                        | 13/15 samples byte-identical at 0% over 6s of drag; one partial strip briefly reached 19% before re-arming reset it to 0%                                                                    |
| Preview-coalescing fix, `surface-tier.verify.mjs` mid-drag check                               | jpeg similarity 0.99-1.00 (bug: mid-drag frame was actually the settled frame) -> 0.83 (fixed: genuinely softer mid-drag frame)                                                              |
