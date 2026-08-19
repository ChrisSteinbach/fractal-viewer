# Surface strip pipeline

Full evidence record for `src/app/strip-planner.ts` — the adaptive
scissor-strip sizer behind every WebGL surface trace. `CLAUDE.md`'s
`strip-planner.ts` bullet is the condensed rules-and-invariants version;
this document is where the measured numbers, the reverted attempts and the
historical narrative live.

## What a strip is

`strip-planner.ts` sizes adaptive scissor strips for EVERY WebGL surface
trace, previews included (fr-sjff). `surface-compute.ts`'s WebGPU compute
path is not one of its callers — that path bounds its own submissions
instead (fr-tzdg). fr-du81 removed the preview tier's one remaining
unbounded draw, closing off the i915-preemption GPU-hang path that used to
kill fold sessions outright.

Units are PIXELS, not rows (fr-096u): a strip is a row-major pixel interval
rendered as 1-3 scissor rects under ONE fence, so fold strips can shrink
below the cost of a single row.

## Cost priors and the evidence chain

The probe that starts a job is sized from a per-pixel cost prior, chosen in
order: the measured preview cost when one exists, else a pessimistic
fold-class prior, else the legacy rows fraction for affine. (The old
unprimed 3-row probe at full resolution was fr-096u's kernel-confirmed i915
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

fr-id9r closed two remaining holes in this chain:

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
settle 0.87-1.0s; escape 48ms; boxfold settle 793ms versus 212ms at the
fr-096u tip. The accepted residual cost is that the queue-priced first
preview paces slower pre-evidence, so its inflated evidence over-strips the
settle that follows it — a documented, accepted trade rather than a bug.

## The pipelined pump and the sync tax

`scene.ts`'s strip pump is PIPELINED — fr-096u's A/B verdict. The reason:
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

## The two-term cost model (fr-ado7)

Subtracting a FLAT `SURFACE_STRIP_SYNC_TAX_MS` and dividing the rest by the
batch's pixels was a calibration, and it had an absorbing state. When a
batch's wall is dominated by fixed cost rather than by trace work,
subtracting 80ms leaves the remainder attributed to the pixels; the sizer
asks for fewer; the next batch is MORE fixed-dominated; and growing back
needs a batch measuring under `targetMs`, which the fixed cost alone
forbids. fr-kz2p measured it on a near-empty frame at extreme zoom: strips
collapsed 990 → 484 → … → 1px and then oscillated at 1-6px, each batch
still costing 500-1700ms REGARDLESS of pixel count, with a Save-PNG frozen
at 59% for the last 5.5 minutes of a 480s run. Extrapolated remaining cost:
hours to days for one pass of eight.

**The fix is `surface-compute.ts`'s `ShadeHitCost` ported down** (fr-p8bc /
fr-d6g5 / fr-2ojg had the identical pathology at hit dispatches):
`StripCost = {interceptMs, marginalMsPerPx}`, each measurement's surprise
split by WIDTH (`w = px/(px + pivot)` to the marginal, the rest to the
intercept), sizing off the MARGINAL alone. The safety mechanisms are
untouched: **the worst-case cap is still priced on the RAW ms/px ratchet
and applied LAST**, so the set of sizes a strip may take is exactly what it
was — only the choice within it moved. That precedence is load-bearing and
is written at the clamp: the model cannot tell a monster pose from an
overhead-bound batch (see the identity below), and the raw ratchet is the
only thing that can.

Three places the port had to DIVERGE from its compute twin, each measured
or reasoned rather than copied:

- **The pivot is a PRICE, not a width.** `SURFACE_COMPUTE_SHADE_COST_PIVOT`
  = 512 hits is a HARDWARE knee (below it a dispatch's cost really is flat
  in width). A scissored strip has no knee — its cost is linear in pixels
  from pixel one — so "narrow" is a statement about the SCENE, and this
  planner's two tiers are three orders of magnitude apart in natural strip
  width (a light affine settle converges at ~35,000px; a heavy fold PREVIEW
  at ~3px). A single pixel pivot cannot serve both. `STRIP_COST_PIVOT_MS_PER_PX`
  = 0.6 (inside the measured heavy-fold band: fr-096u's 0.5-4ms/px on
  mandelboxKifs, fr-du81's ~6ms/px SwiftShader preview) puts the settle
  tier's pivot at 125px and the preview tier's at 20px.
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
  the caller's PRIOR, fr-096u's one bound on an unmeasured submission.

`scene.ts` changed in three ways. Both writers already reported at
measurement time (fr-id9r's `observe` door), so they feed the model
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
pre-fr-ado7 sizer under the same probe, cap and row-snap. The frozen copy
lives in `strip-planner.test.ts` so "ordinary frames are unmoved" stays a
comparison rather than a memory. Converged strip, its cost, and the
frame's submission count:

| scene (cost function)               | new                        | old                        |
| ----------------------------------- | -------------------------- | -------------------------- |
| degenerate 500ms fixed (fr-kz2p)    | 222px / 500ms / 4,151 subs | 1px / 500ms / 921,600 subs |
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

Capture/offline export runs the SAME pump (fr-y6m0). Before this, those
drains used to join every strip themselves — effectively the pre-fr-096u
shape, wearing export clothing, multiplying the sync tax by the planner's
strip count.

Both drains now loop the same pump and differ only in how they WAIT
between calls:

- The synchronous drain (offline export, thumbnails) blocks on ONE
  whole-queue readback per queueful.
- The yielding drain (fr-7mfx's Save-PNG) hands the main thread back on
  rAF, timer-backstopped at a frame — because a page whose frame clock
  runs slow starves the queue (headless SwiftShader serves rAF at
  ~10Hz), and because a bounded macrotask spin covers the case where the
  page is hidden, rAF stops and timers throttle. This is what lets a
  cancel land within a tick instead of behind a multi-second crease
  strip.

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

Cost ceilings belong to the SYNCHRONOUS drain alone, since fr-avf6 —
offline export and thumbnails, the callers that freeze the tab for a
frame's whole duration and offer no way to stop it. There, measured
evidence predicts the frame cost up front (never the class prior, which
would refuse every fold export sight unseen), and the drain refuses past
`SURFACE_CAPTURE_PREDICT_CEILING_MS` (120s). The drain itself also aborts
past `SURFACE_CAPTURE_SPEND_CEILING_MS` (60s) of real spend. Both throw
`SurfaceCaptureCostError`: the offline exporter fails the run, and the
thumbnail path falls back to the explorer render.

The ceiling's currency changed meaning along with the drain fix:
`spentMs` is batch-attributed busy wall time with the sync tax subtracted,
so the same 60s budget now buys tracing where it used to buy joins.

The INTERACTIVE Save-PNG path is refused nothing. Its modal discloses
measured coverage, its Cancel works, and the drain yields — so having a
prediction (measured to run ~4x high) decide for the user would be exactly
the patience-guessing that fr-zx34 already reverted for the preview tier,
one render mode over (and the WebGPU arm had never done that in the first
place). The "Render anyway" opt-in was retired along with the refusal it
existed to escalate past.

Capture observations feed the evidence chain RAISE-ONLY, without killing
it: the pose hasn't moved, so live settle/preview evidence stays valid,
and the drain's export-scale observation may only tighten that floor,
never own it outright. (A micro-strip capture priced at pure readback
overhead would otherwise pin the next settle to dissolved micro-strips.)

One exception, fr-y1m7: a COMPLETED capture may SEED an EMPTY chain,
because offline export is the one caller that never fills the chain any
other way (a system upload clears it, and force frames bypass the
preview). Without this, every frame of a fold-scene video priced its queue
at the class prior — roughly 100x above its own actual pixels — and paid
a join per ~400px. The rule is seed, never replace, and it's safe in the
direction it can be wrong: a capture traces the WHOLE frame at its armed
pose, and an export-scale trace resolves finer pixels than the live tier,
so its reading is HIGH rather than low.

## The no-give-up verdict (fr-24to / fr-zx34)

fr-24to asked for a runtime-mode verdict on monster-pose previews: the
floor-rung preview at `mandelboxKifs`'s entry pose ran past 210s and
4500px with no terminal state — the settle never armed. A mode bail and a
sub-floor rung were both considered and rejected, because the cost is
pose-local (only ~2x per rung) against a gap of >=50-150x, so neither
would have actually helped.

Two rounds of budget/prediction truncation shipped, and were then
REVERTED (fr-zx34): both clipped a preview that was actually completable.
The first case clipped a 20-map Menger-lens preview that was 62% done with
only ~2.5s left.

Final verdict, the user's: no automatic give-up.
`surfaceRenderProgress()` plus the surface progress row ("Preview 43%" /
"Full detail 0.4%", one decimal place under 10%, hidden when idle — and
since fr-tmgf the label also names its engine, "· WebGL" / "· WebGPU",
with the compute side fed by `onProgress` ray tallies) disclose honest
coverage, and the user decides. At true monsters the preview may grind
for minutes with the settle never arming, but safely — 120/120
responsiveness pings, 0s stalled, because the bounded-strip pump (not
truncation) is what carries safety here.

Save-PNG's refusals had gained a "Render anyway" opt-in (a 300s consented
backstop) before fr-avf6 retired both the refusal and the opt-in: once the
export modal disclosed coverage and Cancel actually worked, the refusal
was just guessing at a patience the user was already expressing directly.

Measured A/B (Iris, real driver, `?surfacegl`): lens-system settle 2.5s
versus main's 3.2s (total-to-settled 6.8s versus 7.4s), boxfold-pair
settle 0.2s, escape 45ms — all at full safety caps, kernel-silent through
every monster run.

The settle always ARMS, however expensive the frame: bounded strips grind
visibly and interruptibly. (An early fr-096u cut had gated the settle on
predicted cost and silently blanked legitimate lens settles into permanent
preview blur — a silent refusal reads as a broken render, which is the
core lesson behind this whole verdict.) The same never-refuse discipline
now covers the preview too: it always runs to completion, with progress
disclosed rather than bounded.

fr-ud7n carried that same line across the WebGPU seam, where all three
affordances — always-arms settle, always-completes preview, disclosed
progress — had been missed. A compute preview is wall-budgeted
(`main.ts`'s `SURFACE_COMPUTE_PREVIEW_BUDGET_MS`, 2s) so the rung ladder
can learn during motion — that budget is legitimate and unchanged. But at
the FLOOR rung, a truncated frame used to be the preview's LAST word:
there was nothing cheaper to drop to, so the loop drained and the settle
fired over a mostly-backdrop pane, with the truncation undisclosed and
unskippable. The budget stays a MEASUREMENT device; what changed is the
terminal state on a parked view — a floor-rung truncation now re-runs the
same rung UNBUDGETED to completion, with progressive presents, a
"Preview · WebGPU N%" row label, and a live Skip button
(`skipSurfacePreviewNow`'s compute arm had already implemented the
handoff; only its visibility was missing). Bounded submissions, not the
budget, carry watchdog safety — the settle is equally unbudgeted.

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

## Preview coalescing (fr-nl32)

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

## Measured A/Bs

Quick-reference table of the headline measured results above, each tied
to the section that carries its full context:

| Scenario                                                                    | Result                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fr-id9r fix, Iris Xe, 180s `mandelboxKifs` run                              | 360/360 responsiveness pings, 0s stalled, kernel silent; lens settle 0.87-1.0s; escape 48ms; boxfold settle 793ms vs 212ms at the fr-096u tip                                                |
| fr-id9r fix, before/after queue stall                                       | ~3s per crease pixel / ~46s at parked monster poses -> ~one worst-capped strip beyond the one executing                                                                                      |
| Capture/export drain fix, SwiftShader, 1280x720, unfinishable pose          | live settle 38% of a 60s window in both arms; capture 0.4% -> 15% (~37x)                                                                                                                     |
| Capture/export drain fix, SwiftShader, cheap 900x560 frame                  | live settle 2.6s; old Save-PNG burned 60s and refused; new: 4.7s deliver, 0.9s cancel (old: 2.2s); thumbnail 2.5s via sync drain (old: 4.3s parked, 6.8s after a drag); byte-identical image |
| Sync-fence polling fix                                                      | 4.3s thumbnail that hung 300s with `spentMs` frozen at 0, before the fix                                                                                                                     |
| fr-24to/fr-zx34 final verdict, Iris real driver, `?surfacegl`               | lens settle 2.5s vs main 3.2s (total-to-settled 6.8s vs 7.4s); boxfold-pair settle 0.2s; escape 45ms                                                                                         |
| fr-ud7n, Firefox 151 WebGPU, 1920x1057, 20-map Menger + fold lens + balloon | two 2.1s truncated floor previews at 5% of 9916 rays; completion pass 13.8s, 3.9% -> 97%; settle still 48% after 179s                                                                        |
| fr-nl32, SwiftShader, 100ms drag cadence                                    | 13/15 samples byte-identical at 0% over 6s of drag; one partial strip briefly reached 19% before re-arming reset it to 0%                                                                    |
| fr-nl32 fix, `surface-tier.verify.mjs` mid-drag check                       | jpeg similarity 0.99-1.00 (bug: mid-drag frame was actually the settled frame) -> 0.83 (fixed: genuinely softer mid-drag frame)                                                              |
