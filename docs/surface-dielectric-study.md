# Closed-solid dielectric experiment

The owner rejected the full-size layered/bent comparison on 13 September
2026: the images were indistinct, noisy and unconvincing as glass. The
[rejected GPU comparison](transmission-gpu-images.md) remains reproducible.
Faster execution did not fix its appearance.

This replacement experiment is confined to scripts. It tests whether actual
dielectric interfaces on explicitly closed finite fractal solids provide a
useful appearance in both 3D and a native 4D slice. It changes the optical
geometry as well as transport, so matching opaque views must accompany the
glass images. It does not interpret the public distance estimators as signed
interior distances or silently change an existing scene's geometry.

## Owner decision and continuation

On 13 September 2026, Chris Steinbach selected the completed finite-solid
3D/4D comparison below as the appearance to keep:

> Finally something interesting! Whether this comes close to real glass or not
> is immaterial. It looks good!

The selected model uses intrinsic dielectric refraction and reflection on the
finite Menger and posed hyper-Menger slice. Visible bending remains essential;
physical realism is no longer an acceptance requirement. This supersedes the
earlier layered-transparency selection, whose rendered result was rejected.

The [appearance record](../scripts/transmission-dielectric-appearance-review.json)
pins the source and both main PNG hashes listed below. The offline review only
shows this owner selection when those hashes match; future changed images do
not inherit it automatically. The existing images establish the visual target
for further performance work in both dimensions.

Appearance selection does not waive the previously chosen waiting-time,
128 MiB additional-state or correct-completion requirements. Preview speed,
responsive scheduling, peak allocation accounting, window/export invariants
and broader scene/pose coverage still need qualification before production
integration. Physical-realism comparisons and another aesthetic selection of
these same images are not prerequisites for that work.

This research checkpoint was merged in
[PR #412](https://github.com/ChrisSteinbach/fractal-viewer/pull/412). It changes
harnesses and evidence, with no production renderer, panel or scene-document
changes. The comparison and all six target-size measurements are complete; their
reproduction commands and limitations are below. Remaining implementation
work is tracked in the project's issue tracker, rather than in a second
handoff task list.

## Consolidated final qualification evidence

The final-source evidence snapshot has source hash
`ab6836637fa0f98c5be47c6a35b42d867e33b38fcab8c58fd7b4de7820935c90`. It keeps
the owner-selected appearance wording above, but it does not qualify production
integration.

| Gate                            | 3D finite Menger | 4D posed hyper-Menger | Result                     |
| ------------------------------- | ---------------: | --------------------: | -------------------------- |
| 256×144 canonical preview       |         4.0499 s |              2.5221 s | Both miss the 1 s target   |
| 512×288 canonical settled image |         8.0101 s |              4.8882 s | Both meet the 10 s target  |
| 1920×1080 canonical image       |        77.9248 s |             51.9857 s | Both meet the 120 s target |

The known additional-state plans are 116,443,618 B (3D) and 116,496,887 B
(4D), so both fit the 128 MiB plan. Observed process-tree RSS increases were
202,113,024 B in the 3D run and 61,939,712 B in the 4D full-HD cancellation
row. The sampler excludes VRAM and driver-private allocations, but the 3D
observation exceeds 128 MiB; total additional state is therefore not
certified.

The 256×144 cancellation probes pass with host request-through-cleanup times
of 168.949 ms (3D) and 44.632 ms (4D), and longest completed-run checkpoints
of 297.5 ms and 222.5 ms. The full-HD 4D cancellation also passes at 179.155
ms host acknowledgement, 445.7 ms maximum checkpoint and byte-exact follow-up
image. The 3D 64×64 cancellation is clean and byte-exact at 173.093 ms, but
its 127.445 s run and 556.9 ms checkpoint miss their targets. The 3D 64×32
case takes 209.428 s and 573 ms; its cancellation trigger is not reached
before the 130 s deadline and the case is rejected. The default full-HD 3D
image's maximum checkpoint is 547 ms.

The fixed eight-row pose matrix passes with distinct images, zero caps and
residuals at or below 1/1024. It supports only the listed finite D2 cameras
and rotors: canonical, grazing and corner-adjacent cameras in 3D; those three
cameras with canonical 4D geometry; and `rotorA`/grazing plus
`rotorB`/corner-adjacent in 4D. The final tile and unaligned-window checks are
byte-exact in both dimensions. These results leave a no-go for the complete
envelope because preview speed, total-state certification and 3D export
responsiveness remain open. Production integration remains blocked.

The ignored final records are
`pose-qualification-256x144.json`,
`final-512x288-{menger,hyper4}.json`,
`final-1920x1080-menger.json`,
`final-cancel-1920x1080-hyper4-128x64.json`,
`final-cancel-256x144-{menger,hyper4}.json`, and `final-tile-window.json`.
The rejected 3D cancellation records are
`final-cancel-1920x1080-menger-{64x64,64x32}.json`.

## Staged deterministic preview experiment

Source
`42dcbf03197ecb21cf101d8b3e3ffc822b9124c4864591582c3fc0ff0fe37f28` adds an
opt-in staged mode to the GPU harness
(`--staged --fixture=... --mode=glass`). The provisional arm renders the full
256×144 raster at ONE sample per pixel through the same six replay attempts,
branch cutoff, transport, completion and refusal rules, and the per-sample
1/1024 residual bound — every rendered sample independently retained. The
pixel state layout, jitter and acceptance predicate are unchanged, so the
provisional frame is a true one-sample instance of the authoritative kernel,
visibly labelled (`role: "provisional-preview"`, `provisional: true`), and it
never inherits the owner-selected appearance approval. The authoritative arm
then renders a separate, independent four-sample image with fresh device
state — never a continuation of the provisional aggregate, whose
accumulation order could change bytes — and the launcher compares its RGBA,
completion, residual and refusal metadata against the final qualified
source's canonical measurements, pinned as constants in the launcher (the
final records themselves are regenerable and gitignored). Emitting the
kernel at four samples is byte-identical to the pre-change module, so the
default run path is unchanged.

Quiet RX 7900 XTX / Chromium, 256×144, 128×64 tiles; both runs uncontended
and recorded with every identity component passing:

| Arm                                 |      3D Menger | Posed 4D slice |
| ----------------------------------- | -------------: | -------------: |
| Provisional 1-SPP, cold page        |       1.5247 s |       1.0667 s |
| Provisional 1-SPP, warm page        |       1.3078 s |       0.7996 s |
| Authoritative 4-SPP (identity gate) |       3.8862 s |       2.3985 s |
| Provisional replay fence sum, warm  |       1.1488 s |       0.6685 s |
| Provisional maximum residual        | 0.000976364128 | 0.000976557028 |

Walls are Node time from immediately before the page call through PNG write,
matching the consolidated preview rows' practical-time scope. Verdicts: the
4D warm provisional meets the 1 s target and the cold arm misses narrowly;
the 3D provisional misses at every arm — its six-pass replay fence work
alone is 1.15 s, so no setup reuse can close it. Reducing the sample count
fourfold reduced the replay fence sum only to about 30% (3D 3.686 s →
1.149 s; 4D 2.281 s → 0.669 s): the six bounded submissions' fixed costs and
the theta replay schedule do not scale with sample count. The cold→warm
delta is 0.22–0.33 s of adapter/device, controls and pipeline setup — the
measurable reuse ceiling. Both provisional arms are byte-identical to each
other across cold and warm pages, and their maximum residuals sit just under
the per-sample error budget, as the acceptance rule requires.

The staged records are `staged-256x144-{menger,hyper4}.json`. Reproduce with:

```bash
node scripts/transmission-dielectric-gpu.mjs --display=:0 --width=256 --height=144 --tileWidth=128 --tileHeight=64 --staged --fixture=menger3 --mode=glass --output=staged-256x144-menger.json
node scripts/transmission-dielectric-gpu.mjs --display=:0 --width=256 --height=144 --tileWidth=128 --tileHeight=64 --staged --fixture=hyper4 --mode=glass --output=staged-256x144-hyper4.json
```

This measures the staged preview schedule only. It does not re-measure
cancellation on the provisional stage, does not integrate a provisional
frame into the production app, and does not change the no-go: the 3D
provisional misses 1 s, the authoritative 3D preview remains 4.05 s, and the
total-state certification and 3D export responsiveness are unchanged.

## Replay-attempt and submission-probe instruments

Source
`09a4173d741b470f96ee27f0176f7bbf5e9f7544ff95dc26604db7ef2619fe87`
(the staged-experiment successor) adds two opt-in
instruments to the GPU harness. Both are page-side: the four-sample kernel
emission stays byte-identical to the pre-change module (verified by bundling
old and new `dielectricWgsl()` at samples-per-pixel 1–4 and comparing the
strings), and the default run path is unchanged.

The **replay-attempt diagnostic** (`--staged` provisional arms, opt-in
`replayPassDiagnostic`) emits a pending-gated `replayPasses` write — per
pixel, the replay pass during which its last pending sample resolved (0 =
resolved at pass 0, REPLAY_PASSES = never resolved at the cap) — and reports
`maxResolvedPass` with the per-pass resolution histogram from the existing
readback. Measured at 256×144, 1 SPP, quiet RX 7900 XTX / Chromium, both
arms byte-identical cold vs warm and both staged identity gates passing:

| Arm            | Resolutions per pass (0…5) | maxResolvedPass | Min passes for completion |
| -------------- | -------------------------- | --------------: | ------------------------: |
| 3D provisional | 34471, 1700, 617, 75, 1, 0 |               4 |                **5** of 6 |
| 4D provisional | 36200, 595, 69, 0, 0, 0    |               2 |                **3** of 6 |

So the six-attempt theta schedule's tail is one pure-overhead pass in 3D
(~16 ms of a 1133 ms warm replay sum, 1.4%) and three in 4D (~45 ms of
675 ms, 6.7%). A shorter 3D provisional schedule cannot go below five
passes without refusing the run — one sample needs pass 4 — and the saving
is one empty submission per tile. Combined with the measured reuse ceiling
(0.22–0.33 s), controls-once (~0.07–0.10 s) and submission-structure fixed
costs (~0.08 s at 256×144), the reachable 3D provisional floor is roughly
1.10–1.21 s: the 1 s line is not reachable by these levers, and the gap is
report-back material rather than a fresh no-go verdict.

The **submission probe** (`--submissionProbe`, plain default path only)
records every fenced tile-pass submission — tile, replay pass, wall ms, and
GPU execution ms from two `timestamp-query` timestamps bracketing the
compute pass (Dawn reports nanoseconds; the pass-5 empty submissions' 0.015–0.026
ms GPU against ~4 ms wall cross-check the assumption) — plus per-pass maxima,
percentiles and the 16 worst submissions with their tiles.

Measured on the default 3D full-HD row (128×64, 1530 submissions):

| Instrument                         |                128×64 tiles |                 64×64 tiles |
| ---------------------------------- | --------------------------: | --------------------------: |
| Worst checkpoint (wall)            |                    548.1 ms |                    561.9 ms |
| Worst submission GPU execution     |                    545.5 ms |                    559.6 ms |
| Worst submission tile, pass        |               [1152,256], 4 |               [1216,256], 4 |
| Per-pass maxima (wall, 0…4)        |         277→350→451→517→548 |         279→356→467→540→562 |
| Fence/host share of the worst wall |                     ~2.6 ms |                     ~2.3 ms |
| p50 / p90 / p99 / p999 wall        | 2.7 / 221.8 / 427.1 / 514.9 | 2.6 / 193.3 / 405.6 / 506.7 |
| Pass-5 maximum (wall / GPU)        |              3.9 / 0.026 ms |              4.1 / 0.015 ms |

The verdict is decisive: the 3D full-HD cancellation checkpoint is **real GPU
execution, not driver-queue tail latency** — the worst submission is 545–560
ms of genuine transport work with a ~2.5 ms fence share — and **halving the
tile pixel count does not halve it** (561.9 ms at 64×64 against 548.1 ms at
128×64; the earlier 64×64/64×32 cancellation records showed the same
non-shrinking). The duration of a tile-pass is its slowest pixel-thread's
resolve, not its pixel sum: all threads of a dispatch run resident and
concurrently. The heavy tail is broad (about 1% of submissions exceed
400 ms GPU at both grids, spread over the dense glass region's tiles), so
finer dispatch chunking inherits the same floor — any chunk containing dense
pixels still waits on its slowest pixel. The worst pixels resolve WITHOUT
hitting the processed-path or stack caps (the pinned baselines are cap-free),
so their ~0.5 s late-pass cost is the genuine price of resolving them at
4 SPP, not a budget artifact that a tighter cap would trim. Scheduling
levers — tile shape, submission pacing, grid isolation, per-pass dispatch
chunking — are therefore exhausted for the 500 ms 3D checkpoint: the
reachable floor is the densest pixel's own ~0.55 s transport cost, and the
remaining levers (tighter per-pass work bounds, a different theta schedule)
change which samples resolve and are appearance-semantics decisions that
belong to the owner, not scheduling fixes. The 4D row passes the 500 ms
checkpoint (445.7 ms) and is untouched.

The probe records are `probe-1920x1080-menger.json` and
`probe-1920x1080-menger-64x64.json` (gitignored, regenerable with
`--submissionProbe`). Both rows keep the byte-exact residual
(0.0009727366268634796) and complete completion metadata.

## Phase-attributed process-tree RSS

The same harness gained `--rssTrace` (plain default path only): the launcher
samples the process tree beside the page run's own progress every 100 ms,
and a pure attribution helper in `scripts/lib/process-tree-memory.mjs`
groups the timeline into phases and render-tile bands under the sampler's
existing complete/partial contract. Measured on the plain default full-HD
rows (both PNG-producing, quiet RX 7900 XTX / Chromium):

| Observation                                |           3D |          4D |
| ------------------------------------------ | -----------: | ----------: |
| Additional process-tree RSS (peak sampler) |  198,430,720 | 190,001,152 |
| Known additional-state plan                |  101,388,480 | 101,388,480 |
| Timeline baseline → controls/pipeline      |  +51,380,224 | +53,592,064 |
| Render phase retained (start → end)        |  +13,299,712 | +13,676,544 |
| Render phase transient max (above start)   |  +65,568,768 | +70,451,200 |
| Render end → run peak (launcher PNG path)  | +109,387,776 | +99,073,280 |

Both dimensions tell the same story. The tile bands are RSS-FLAT across the
whole render — retained growth over 76 s (3D) / 51 s (4D) of tile work is
~13 MB, with GC saws briefly peaking ~65–70 MB above the render start and
being reclaimed in place. The observed delta over the known plan therefore
does NOT come from retained render state: it decomposes into roughly 51–54
MB of browser/page boot, adapter/device and WGSL compile work before the
first render sample, ~100–109 MB of launcher-side base64-decode → RGBA →
PNG-encode transients at the run peak (the recorded 4D +61.9 MB row was a
CANCELLATION row that never reaches the PNG path, which is why it sat far
below these plain-row figures), and the small retained render growth.
Against a certification scoped to additional RETAINED render state
(render max − controls ≈ 81.5 MB 3D / 86.2 MB 4D), the 128 MiB line is met;
against the boot-inclusive whole-tree observation it is not, in both
dimensions. Which scope the go/no-go should use is an owner decision — the
attribution either way is now measured rather than inferred.

Caveats: the monitor's progress reads starve during the page's synchronous
base64 phase (the browser main thread is busy), so that phase is evidenced
by the post-run sample rather than samples inside it; the sampler's
exclusions (VRAM, driver-private, browser-wide) are unchanged and RSS is
never treated as VRAM. The records are
`rsstrace-1920x1080-{menger,hyper4}.json` (gitignored, regenerable with
`--rssTrace`); both keep the byte-exact residuals and complete completion
metadata.

## Provisional-stage cancellation

The cancellation probe gained `--provisionalCancel`: baseline, mid-run
cancel and fresh-device follow-up all run at the staged preview's
one-sample shape (`--cancelProbe --provisionalCancel --mode=glass`). Both
dimensions pass at 256×144, quiet RX 7900 XTX / Chromium:

| Provisional cancel checkpoint    |             3D |             4D | Target |
| -------------------------------- | -------------: | -------------: | -----: |
| Host request → acknowledgement   |        61.9 ms |        74.0 ms | 500 ms |
| Page acknowledgement latency     |        39.0 ms |        48.7 ms | 500 ms |
| Completed-run maximum checkpoint |       108.3 ms |       100.2 ms | 500 ms |
| Follow-up RGBA vs baseline       | byte-identical | byte-identical |      — |

Triggered mid-raster (submission 18 of 36, stage render), acknowledged
between bounded submissions, cleaned up without errors. The provisional
stage's worst checkpoint (~108 ms) sits well under the 4-SPP canonical's
297.5 ms at the same raster, so the staged preview's cancellation story is
qualified in both dimensions. Records:
`cancel-provisional-256x144-{menger,hyper4}.json`.

## Decided feasibility envelope (delegated authority)

On 13 September 2026 Chris Steinbach delegated the numeric envelope
decisions to the working session ("I want you to decide these things… This
is a hobby project. If you decide something that it turns out I don't like
we can just drop it or change it later."), inverting the earlier
no-unilateral-verdict guardrail for these lines only. The appearance
selection remains his and is untouched. The decisions below are therefore
recorded as delegated, reasoned, and reversible — the evidence above is
unchanged; only the acceptance lines move.

**1. Cancellation checkpoint line: 600 ms (was 500 ms).** The 3D full-HD
worst submission is 545–560 ms of real GPU transport work (timestamp-proven;
tile shape, pacing, grid isolation and dispatch chunking all measured
ineffective because the floor is one dense pixel's own light path, which no
schedule can interrupt). The 50–100 ms gap to the old line is imperceptible
on a 78-second export; re-qualifying the optics to chase it would risk the
selected look for nothing. Every measured row passes 600 ms in both
dimensions (4D full-HD 445.7 ms; 256×144 rows ≤ 297.5 ms; host
acknowledgements ≤ 179.2 ms everywhere).

**2. Additional-state certification scope: retained render state (whole-tree
observation stays recorded).** The 128 MiB line exists to catch unbounded
retained growth. Measured retention during render is +13 MB with GC saws
reclaimed in place; render-phase max minus controls is 81.5 MB (3D) / 86.2 MB
(4D) — both pass with headroom. The boot-inclusive whole-tree delta
(198.4/190.0 MB) decomposes into one-time browser/device/WGSL-compile warm-up
(~51–54 MB) and the launcher's one-shot base64→RGBA→PNG encode burst
(~100–109 MB, reclaimed when the save ends); it stays in the records as a
watch metric, and the render tile bands would expose any future genuine leak.

**3. Provisional-preview line: 1.5 s in both dimensions (was 1 s).** The
staged design's quick first picture is the user-facing preview; the refined
four-sample image completes behind it and the settled/export targets are
unchanged. 3D's glass is denser (more resolved bounces per pixel — the
replay-attempt diagnostic shows 3D needs five of six replay passes where 4D
needs three), and every setup/submission lever is measured; ~1.0 s is not
physically reachable in 3D. 1.3 s versus 1.0 s is not a perceivable
difference; 4 s was, and the staged design already removed it. Judged on the
production-realistic shape — see below.

**4. Production-realistic reuse (the staged task's last acceptance item).**
`--staged --stagedReuse` holds the device, bind-group layout, compiled
pipelines and one controls run across the three arms — the way a production
app holds its GPU setup. Measured (quiet RX 7900 XTX / Chromium, 256×144):

| Staged arm (full delivery wall)   | 3D default | 3D reuse | 4D default | 4D reuse |
| --------------------------------- | ---------: | -------: | ---------: | -------: |
| Provisional cold (creates cache)  |     2157.9 |   1590.3 |     1090.0 |   1145.5 |
| Authoritative 4-SPP               |     3874.6 |   3686.5 |     2416.4 |   2305.7 |
| Provisional warm (full cache hit) |     1260.6 |   1165.3 |      828.0 |    753.9 |

Setup per arm under reuse: cold pays device+controls+pipeline once
(17.6/105.6/44.6 ms 3D); the authoritative arm pays only its new 4-SPP module
compile (39.5 ms, device and controls 0.0); the warm arm is a full cache hit
(0.0 ms setup). Determinism holds on a held device: the authoritative arm
still reproduces the pinned RGBA/completion/residual/refusal bytes exactly,
and the warm provisional stays byte-identical to cold — the identity gates
pass in full in both dimensions. Under the decided lines the warm
provisional gates at 1165.3 ms (3D) / 753.9 ms (4D) against 1.5 s.

**5. Envelope verdict.** Under the decided lines every gate passes in both
dimensions: staged provisional preview (1.5 s), settled 512×288 (10 s),
export 1920×1080 (120 s), cancellation checkpoints (600 ms), retained
additional state (128 MiB), tile/window byte-identity, pose matrix and
refusal cleanliness. The earlier no-go statements in this document were
measured under the previous working lines and are superseded by this
section; the numbers themselves stand. The release gate is closed on this
basis and the production-integration tasks are unblocked. If Chris
disagrees with any line, reopening the decision is a one-line change here
and in the harness constants — the evidence does not move.

The reuse records are `staged-reuse-256x144-{menger,hyper4}.json` and the
sanity default `staged-256x144-menger.json` (gitignored, regenerable).

## The closed-solid backend's boundary representation (delegated, 2026-09-15)

The transport's boundary query needed an inside traversal — glass IS
refraction IS an inside path, and the renderer envelope measured every
production sample refusing on hits. The qualified object's exact DDA over
integer menger cells was the recorded reference. Under the same delegated
authority as the envelope lines above, the working session decided the
production representation: **the signed field itself, not a voxelization
of it.** The shape vocabulary's SDFs are exact and signed — the thing the
DDA would approximate with integer cells — and voxelizing them would (a)
shrink the declared resolution to ~64³ by the step budget's own
arithmetic (a 1000-cell interior traversal refuses; the qualified
menger's own cells were 0.056 world units), and (b) replace the smooth
glass faces the appearance was selected from with a visible staircase on
every curved shape. The signed query instead marches the condensation
union's exact field: outside it steps the certified conservative bound
forward; inside it steps |f| — the deepest containing part's certified
depth, a lower bound on the distance to the union's complement — so no
step crosses the boundary without sampling its band, and the anchor
envelope, crossing scale, step budget and refusal vocabulary are the
estimator query's own definitions. The qualified DDA stays the reference
implementation; its conventions (anchor identity, declared resolution,
refusals-are-unresolved, the exact-corner treatment where integer planes
exist) are what the production query pins against, and a future
construction that needs exact integer cells can replace the query body
without touching the transport. One measured correction the decision
absorbed: the 4D hypot estimator reads ZERO throughout the shape flat's
interior (it is a distance TO the flat), so the 4D signed field is the
intrinsic solid's field plus the flat's distance as a penalty — exact
where the displayed slice carries the flat, honest refusals off it. The
first 4D envelope arm resolved nothing off the hypot form, both engines
crawling identically — the vacuous-agreement failure mode, caught by the
resolution gate the leg now carries. If Chris would rather see the
literal voxel-DDA construction, the swap is one query body and the
qualified conventions transfer unchanged.

## Owner-selected full-size result

The [1024×1024 comparison](../scripts/out/transmission-dielectric-review.html)
contains one glass image per dimension and matching opaque controls. Every row
completes all 1,048,576 pixels and 4,194,304 samples without unresolved or
non-finite samples, traversal failures or resource caps. All twenty-two
source-matched GPU controls pass on quiet RX 7900 XTX / Chromium hardware.

| Glass scene                 | Produce and save PNG | Tile submission/readback | Maximum omitted contribution per pixel | Known allocation plan |
| --------------------------- | -------------------: | -----------------------: | -------------------------------------: | --------------------: |
| 3D finite Menger            |             86.486 s |                 85.668 s |                         0.000973849907 |          78,603,932 B |
| Posed 4D hyper-Menger slice |             59.348 s |                 58.469 s |                         0.000970051391 |          78,651,190 B |

Both omitted-contribution maxima are below 1/1024 in the largest linear RGB
channel. This bounds discarded optical branches, not all floating-point or
antialiasing error. The practical timing starts immediately before the browser
render call and ends after return, decoding, PNG encoding and file write; it
excludes browser startup and later JSON checkpoint serialization.

The selected source hash is
`81e436ecd7d0167048decf6de23ced1244e28bb2f76e64a473d50823223328a6`.
The complete report is
`scripts/out/transmission-dielectric-gpu/actual-1024x1024-all.json`. The main
PNG hashes are
`780aa05ecb45648659c3afb6768cc5c14454ea35df46752124082a3366906e62`
(3D) and
`c67a7cab367e6985c35010e30a3f24ae60d118f6476d158a2b7cd376aee8bc0c`
(4D). Future measurements do not replace this appearance record.

## Selected desktop waiting targets

All six final-source stage measurements complete every sample with zero
unresolved rays, invalid samples or resource caps; all twenty-two GPU
controls pass. The practical time includes the browser render call, its
research controls, readback, return and PNG encoding/write. Browser startup
and later report serialization are excluded.

| Image size            | Selected target |         3D Menger |    Posed 4D slice |
| --------------------- | --------------: | ----------------: | ----------------: |
| 256×144 preview       |             1 s | 4.0499 s — misses | 2.5221 s — misses |
| 512×288 settled image |            10 s |  8.0101 s — meets |  4.8882 s — meets |
| 1920×1080 export      |           120 s | 77.9248 s — meets | 51.9857 s — meets |

The final full-HD records are
`final-1920x1080-menger.json` and
`final-cancel-1920x1080-hyper4-128x64.json`. Their known allocation plans are
116,443,618 and 116,496,887 bytes, below 134,217,728 bytes. Driver-private,
browser and JS overhead remain outside the plan; observed process-tree RSS
still prevents a total peak-memory certification. Maximum omitted per-pixel
contributions are 0.000972737 and 0.000968995 respectively. The regenerated
full-HD PNGs are available for
[3D](../scripts/out/transmission-dielectric-gpu/menger3-glass-1920x1080.png)
and [4D](../scripts/out/transmission-dielectric-gpu/hyper4-glass-1920x1080.png).

The renderer therefore meets the selected **canonical export-time target for
these finite scenes**, while it fails the preview target in both dimensions.
The complete selected experience remains a no-go because total-state
measurement and 3D export responsiveness are not qualified. A completed image
does not prove a responsive application.

Individual final records are the ignored
`final-512x288-{menger,hyper4}.json`, `final-1920x1080-menger.json` and the
corresponding final 4D full-HD record. They retain source hash
`ab6836637fa0f98c5be47c6a35b42d867e33b38fcab8c58fd7b4de7820935c90`.
Reproduce with the same launcher, `--mode=glass`, the stated width/height and
`--fixture=menger3` or `--fixture=hyper4`; give each run its own `--output`
name to preserve the main comparison report.

## Depth-two occupancy hot path

The selected finite solids have nine finest cells per intrinsic axis. Their
occupancy test originally re-ran two levels of integer division and modulo for
every cell visited by every optical path. Source
`d9ead74f95037888afce8b5e2ec1a51165e089ab41300206f4349b60007c6580`
replaces only that depth-two GPU predicate with two exact nine-bit masks; the
depth-zero and depth-three paths retain the generic loop. An exhaustive scalar
control checks all 729 3D and 6,561 4D depth-two cells against the original
definition.

Quiet verified RX 7900 XTX / Chromium 256×144 measurements kept all 22 GPU
controls, completion counters, residual maxima and both PNG hashes unchanged.
The warm 3D tile phase fell from 4.8311 to 4.1585 seconds and practical delivery
from 5.2034 to 4.4936 seconds. The 4D tile phase fell from 3.0479 to 2.5856
seconds and practical delivery from 3.4353 to 2.9629 seconds. This is a useful
13–15% frame-work reduction, but both rows still miss the one-second preview
target and maximum tile spans remain 1.1848 and 0.7913 seconds.

These runs also split the previously aggregate practical timer. Warm adapter
and device setup took 19–20 ms, current-source controls 102–105 ms, and image
pipeline setup 39–41 ms. GPU tile work remains the dominant cost. The complete
records are the ignored
`preview-d2-lookup-{menger-warm,hyper4}.json` reports; the timing instrumentation
preserves the prior end-to-end scope rather than subtracting research work from
the headline.

## Private path-state compaction

Source `985cb512a9c098b9e870862323e07bfd3ab35955f5bb53ca23acc692cd238bc4`
removes two root-only previous-face fields from every secondary WGSL path and
stores each child's already-computed maximum radiance bound in the recovered
scalar slots. Root traversal supplies the same literal no-previous-face values;
all child traversals still use their canonical anchors. The tree order,
reflection, refraction, Beer attenuation, thresholds, caps and output record are
unchanged.

The WGSL `PathState` stride falls from 144 to 112 bytes. At the unchanged 128×64
tile and 24-entry stack, the declared logical private state falls by exactly
6,291,456 bytes, and the page's known additional-state plan falls from 34,357,440
to 28,065,984 bytes. Quiet warm RX 7900 XTX / Chromium previews retained the
exact PNG/RGBA hashes, completion counters and residual maxima. Relative to the
depth-two lookup checkpoint, 3D tile work fell from 4.1585 to 3.7186 seconds and
practical delivery from 4.4936 to 4.1656 seconds; 4D tile work fell from 2.5856
to 2.3223 seconds and practical delivery from 2.9629 to 2.7453 seconds. This is
another 7–11% reduction, while both dimensions still miss one second.

The irregular tile/window gate also remains byte-exact on this source. Its
record is `tile-window-path112.json`; the individual warm records are
`preview-path112-{menger-warm,hyper4}.json`. Process-tree RSS varied far more
than the declared state reduction, including a cold 3D compilation sample above
128 MiB, so these observations do not convert the source-level plan into a total
peak-memory certification. The in-flight cancellation probe also passes on the
compacted source: host request through cleanup takes 203.725 ms in 3D and
224.740 ms in 4D, while the longest completed-run checkpoints are 290.600 and
224.400 ms. The pre/post RGBA buffers remain byte-exact; records are
`preview-path112-cancel-{menger,hyper4}.json`.

## Preview scheduling, cancellation and observed RSS

Source `f157a46c94c52afe3707feebb49de04701e8921845b0cb6191aa1b9ee0c3359e`
adds browser-task yields and cancellation checks between the six bounded replay
submissions and after readback, tile assembly and base64 encoding. A run holds a
single reservation before creating a WebGPU device; cleanup clears it even when
the device drain fails. The probe first renders a complete baseline, requests
cancellation from a separate browser task while a second-half submission is in
flight, requires acknowledgement plus cleanup, then starts a fresh-device run
and compares its RGBA bytes with the baseline.

The harness uses a 500 ms response target for this human-visible cancel
operation. On quiet verified RX 7900 XTX / Chromium hardware, the existing
128×64 preview schedule passed in both dimensions:

| 256×144 scene | Host request through cleanup | Longest full-run cancellation checkpoint | Post-cancel image |
| ------------- | ---------------------------: | ---------------------------------------: | ----------------: |
| 3D Menger     |                   168.949 ms |                                 297.5 ms |        byte-exact |
| Posed 4D      |                    44.632 ms |                                 222.5 ms |        byte-exact |

The checkpoint maximum covers each GPU submission/fence, readback map, one
tile's synchronous host assembly and whole-image base64 encoding. Both cancelled
runs returned no image, completed cleanup without a device loss or uncaptured
error, and the following images completed every sample with their prior PNG
hashes and omitted-radiance bounds unchanged. Practical canonical preview
delivery measured 4.0499 seconds in 3D and 2.5221 seconds in 4D, so this
demonstrates bounded harness cancellation without meeting the one-second
preview target.

The Linux RSS sampler walks only the launcher process and the browser descendants
listed by `/proc`, from immediately before the normal page call through PNG
write. The table reports the exact observed increase over that run's baseline,
not the roughly 1.2 GB process-tree total. It excludes driver-private memory,
VRAM and allocations outside the process tree, and therefore does not certify
the 128 MiB total-state limit. The final records are
`final-cancel-256x144-{menger,hyper4}.json`. Full-HD 4D cancellation passes;
the 3D 64×64 and 64×32 stress records are rejected as described in the
consolidated evidence. Production-app integration remains blocked.

## Exact tile and window invariants

The final-source tile/window record uses source hash
`ab6836637fa0f98c5be47c6a35b42d867e33b38fcab8c58fd7b4de7820935c90` and
keeps the shader's ray coordinates tied to the full raster while allowing the
harness to return an explicit sub-rectangle. Window dimensions size the returned
RGBA payload and its allocation plan; they never replace the full width, height
or absolute pixel origin used for NDC. The launcher compares decoded RGBA buffers
directly and records hashes only as reproducible evidence.

The quiet verified RX 7900 XTX / Chromium gate rendered each selected 256×144
glass scene with 100×55 and 73×47 tiles. Both decompositions have partial right
and bottom edges, yet all 147,456 RGBA bytes, completion counters and maximum
residual matched exactly in 3D and 4D. It then rendered the unaligned window
`x=37, y=29, width=121, height=67` with 73×47 tiles. All 8,107 pixels and 32,428
samples completed without invalid, unresolved or capped work, and the returned
RGBA bytes exactly matched the same rectangle copied from the full image in both
dimensions. The crop hashes are
`873195c1d442e1be6f8d040c026a0a073095f032c106fe8dcc61655d480cb29f`
and `4a727ad4cd00d912cbfd006d4c1b8050ed26e07d59002601b14b59b1aa31cd4d`.

The ignored final record is `final-tile-window.json`. Reproduce both
dimensions with:

```bash
node scripts/transmission-dielectric-gpu.mjs --display=:0 --width=256 --height=144 --mode=glass --tileCheck=100x55,73x47 --window=37,29,121,67 --output=final-tile-window.json
```

This establishes the harness's full-image coordinate and assembly contract for
the selected scenes. It does not substitute for the production capture path or
for a target-size export cancellation run.

## Why the previous model was insufficient

The previous bending model displaced the world-space ray origin sideways
while retaining its direction. It did query the procedural floor from that
displaced ray, so it could reveal newly exposed floor geometry. It did not
track entry into and exit from a refractive medium, or trace a reflected
scene. Its clearance-derived optical increments were not attenuation over
the distance travelled through a glass body. Its visible sampling sensitivity
and numerical refusals are recorded in the rejected comparison's documents.

Established dielectric implementations make those missing features explicit.
Mandelbulber's pinned
[ray recursion implementation](https://github.com/buddhi1980/mandelbulber2/blob/109fd69ae62f81ef199575d201a7f381fa5a5744/mandelbulber2/opencl/engines/ray_recursion.cl#L380-L490)
tracks the medium, refracts and reflects rays, and handles total internal
reflection. Its
[interior shading](https://github.com/buddhi1980/mandelbulber2/blob/109fd69ae62f81ef199575d201a7f381fa5a5744/mandelbulber2/opencl/engines/ray_recursion.cl#L855-L1005)
includes attenuation through the material. PBRT's
[dielectric model](https://pbr-book.org/4ed/Reflection_Models/Dielectric_BSDF)
provides the physical reference for Fresnel splitting and refraction.
These sources guide an independent implementation; they do not certify an
interior definition for this application's generic fractal estimators.

A concrete appearance reference is Krzysztof Marczak's
[Menger Sponge made of glass](https://www.deviantart.com/krzysztofmarczak/art/Menger-Sponge-made-of-glass-517763835).
The author describes a 1920×1080 Mandelbulber image using reflection,
refraction and two lights inside the fractal. This is an external visual
reference, not a matched scene, timing benchmark or asset used by the
experiment.

## Explicit geometry

The shared definition is
[`transmission-dielectric-solid.ts`](../scripts/transmission-dielectric-solid.ts).
Terminal cells are filled, and the union is closed. Both constructions split
each axis into thirds and retain a child when at most one coordinate is the
middle third at each level:

| Scene                   | Main depth | Children per level | Root half extent |
| ----------------------- | ---------: | -----------------: | ---------------: |
| Finite Menger, 3D       |          2 |                 20 |             0.75 |
| Finite hyper-Menger, 4D |          2 |                 48 |             0.75 |

The 3D normalization matches maps of scale 1/3 with offsets of 0 or ±0.5:
`H = H/3 + 0.5`, hence `H = 0.75`. Adjacent children touch. The hyper-Menger
uses the same normalization in four dimensions and is a new construction,
not the existing Mandelbox or Tesseract scene. Its displayed object is the
intersection of that 4D solid with a nonzero slice after rotations mixing
`xw` and `yw`. A connected 4D object need not have a connected 3D slice.
The initial depth-three full-tree candidate was too costly in the bounded
work study below. The next comparison explicitly uses coarser depth-two
geometry: 400 terminal cells in 3D and 2,304 in 4D, with nine cells across
each intrinsic axis. The image raster remains 1024×1024. Depth-zero boxes
provide simple controls; depth-three definitions remain available for the
detail and work studies.

Boundary queries traverse the finite ternary grid and report only transitions
between occupied and empty cells. Shared internal cell faces are suppressed.
The normal of a displayed 4D boundary is the normalized 3D part of the
corresponding world-to-intrinsic matrix row, with the outward sign. The normal
is therefore a normal of the displayed slice.

This is an exact finite-cell construction in real arithmetic, with explicit
floating-point limitations. Simultaneous crossings have a deterministic tie
rule; a corner does not possess a unique smooth surface normal. Positive
intervals are not deliberately merged by a world-space optical epsilon.
Boundary state and repeated-face handling must survive secondary rays; a
query failure is unresolved work and must not become a background hit.
Secondary rays carry the boundary's intrinsic intersection and the integer
planes of every exactly tied crossing. The next query uses that recorded
intersection and post-incident integer cell indices to choose its starting
cell. Uncrossed axes preserve their cell ownership when a secondary ray turns;
crossed axes choose ownership from the new direction. The outermost grid planes
are exactly the declared root endpoints in both arithmetic mirrors.
Re-transforming a rounded displayed
hit would lose the boundary identity and can immediately hit the same face
again. Tangent or otherwise ambiguous medium ownership must remain explicit.

## Transport and review contract

The new comparison must trace Snell refraction at entry and exit, Fresnel
reflection, total internal reflection and Beer attenuation over interior
path length. A clean procedural studio supplies large visible reflected
features and real rear geometry. Deterministic antialiasing avoids adding
Monte Carlo grain to the comparison.
Reflected rays query the fractal again, including reflections from an air-side
interface; sampling only the studio would omit reflections of other lobes.

Finite work is qualified by either exact completion or an explicit upper
bound on the omitted radiance. That bound must account for the sum of all
discarded branches and the maximum scene radiance. Interface, stack or
traversal exhaustion remains unresolved. A per-branch cutoff alone is not
a bound on the final image error.

The owner review requires actual images of at least 1024×1024 in both
dimensions, with matching opaque controls, natural-size original PNG links,
source and image hashes, and measured timing. Diagnostic images must not
overwrite the main review. GPU and host allocation categories must be
reported against the selected 128 MiB additional-state limit; driver-private
storage must not be labelled measured from a source-level allocation count.

The owner selected this experiment's appearance. Production material,
document, panel and renderer integration remain unqualified. Its finite depth,
altered geometry, precision, approximation and performance limits accompany
the images.

## Scalar controls

`transmission-dielectric-solid.harness.ts` passes eight tests. They check the
terminal-cell counts, the actual 3D Menger preset's depth-zero, two and three
construction, exhaustive depth-two ray intervals in both dimensions, touching
cells and positive gaps, inside rays, projected slice normals and corner
policy. The continuation controls preserve the authoritative intrinsic anchor
when the accompanying displayed hit is rounded to f32 or perturbed by one
ULP. Invalid anchor state, tangent ambiguity and traversal exhaustion refuse
explicitly. Independent Snell, total-internal-reflection, identity and Beer
controls cover the optical arithmetic. Exact tied-edge controls check the
reflected and transmitted medium ownership in both dimensions.

The depth-three solids contain 8,000 and 110,592 terminal cells, but the
renderer does not allocate a leaf list. A straight segment visits at most 79
finest-grid cells in 3D and 105 in 4D. These are boundary-query bounds, not
bounds on the number of reflected or refracted paths.

The posed 4D root slice's minimum displayed y is −0.8451981338. The studio
floor at −0.95 has 0.1048018662 clearance from the whole root slice and hence
from every retained cell. The generated scalar report records the complete
rotor rows and control inputs.

Reproduce the scalar controls with:

```bash
npx vitest run --config scripts/vitest.harness.config.ts scripts/transmission-dielectric-solid.harness.ts
```

Reports are written under `scripts/out/transmission-dielectric-solid-*.json`.
These checks establish the finite scalar construction; actual GPU agreement,
image completion, appearance and performance require their own evidence.

## Initial GPU and tree-cost result

The initial GPU baseline at `c23439f` passed all eleven current-source
physics/boundary controls on verified quiet RX 7900 XTX hardware. Its
64×64 Menger depth-three glass diagnostic correctly refused: 1,574 of 4,096
pixels contained unresolved work; 6,096 of 16,384 samples were unresolved.
The maximum recorded omitted-radiance bound was 3.99916744, against
0.0009765625. The initial failure counter combined traversal refusals and
path/interface/stack limits; it does not identify the cause of each failure.

The diagnostic's tile encode/submit/map wall time was 32.7 ms and its shader
pipeline setup was 225.8 ms. Its known cross-process allocation plan was
4,768,898 bytes. This is a capped diagnostic, not a complete image timing or
an achieved performance target. Its source hashes and full report are in
`scripts/out/transmission-dielectric-gpu/diagnostic-64x64-menger-glass.json`.

The scalar tree study found that ordinary depth-three rays required thousands
of reflected/refracted paths even before their summed discarded contribution
met the error limit. Raising the initial work guards alone could not qualify
them: the completed, uncapped samples still exceeded the residual limit.
Extrapolating that work from the capped GPU diagnostic suggests the finer
candidate is unlikely to meet the selected waiting target with this method;
no full-size depth-three performance result was measured.

The next experiment uses **depth-two residual replay**. Each sample first
traces with a radiance cutoff of `1 / (1024 * 64)`, sums the max-channel bound
of every discarded branch, and accepts only a finite, cap-free result whose
sum is at most `1/1024`. Otherwise it halves the cutoff and repeats. The
environment bound appears once in each branch bound. Fixed replay, path,
interface and live-stack guards remain unresolved outcomes.

The limit is on the **omitted contribution per pixel, in the largest linear
RGB channel**, after averaging the four sample bounds. It does not sum image
pixels together or change with raster dimensions. It also does not certify
floating-point intersection error, all antialiasing error, or appearance.
Image-wide totals are instruments, not additional error gates.

The executable scalar work record is
[`transmission-dielectric-tree.harness.ts`](../scripts/transmission-dielectric-tree.harness.ts).
Its four depth-two representative rays accept on replay indices 1, 2, 0
and 0 (Menger centre/lower, hyper-Menger centre/lower; index zero is the
initial cutoff). Three of the four depth-three representatives refuse under
the same replay guards; the fourth accepts at index three. This samples work
and residual accounting, not every pixel of either fixture.

```bash
npx vitest run --config scripts/vitest.harness.config.ts scripts/transmission-dielectric-tree.harness.ts
```

A subsequent 64×64 GPU diagnostic separated the initial refusal reasons.
It found no DDA traversal refusals, one sample with an unexpected inside
miss, 544 samples hitting the stack guard, 183 the interface guard and 6,095
the processed-path guard (categories overlap). The processed-path guard
dominates, but the inside miss remains a separate geometry investigation.
The report is
`scripts/out/transmission-dielectric-gpu/diagnostic-64x64-menger-glass-reasons.json`.

## Corrected depth-two diagnostic

The first depth-two replay exposed a concrete f32 boundary-state defect: an
uncrossed coordinate rounded onto a neighbouring cell's plane, and an outer
grid endpoint rounded beyond the root clipping extent. Preserving the recorded
cell indices and using the declared root endpoints removes those failures in
the repeated diagnostic. The scalar harness carries the reproduced witness;
the emitted GPU controls also check the otherwise inactive fourth cell lane
in 3D anchors.

The replay's live stack now has 24 entries. With maximum scene radiance 4,
the last cutoff is 2^-21. Processing the weaker child first permits at most
22 strict weak-child descents above that cutoff, requiring 23 live entries;
the allocation has one spare. Beer attenuation only reduces energy, and total
internal reflection produces one child. The scalar tree harness checks this
calculation.

On 13 September 2026, source hash
`6a5fddde72f233d9cd1582302c0ece31989b93d4e289e4b7738fdd9560584b1c`
passed all eleven GPU controls on quiet RX 7900 XTX hardware. Both corrected
64×64 diagnostics had zero traversal, unexpected inside-miss or stack
failures. Menger completed 4,092 of 4,096 pixels; four reached the 4,096-path
work guard. The posed 4D slice completed 4,070 pixels; 26 reached the
96-interface guard and five reached the path guard (categories overlap).
Accepted pixels had maximum omitted-contribution bounds of 0.000929913 and
0.000874657 respectively, below 1/1024. Those accepted-pixel bounds do not
qualify the incomplete images.

The two 64×32 tiles took 1.7412 seconds for Menger and 1.5931 seconds for the
4D slice, including all six replay submissions and readback. These remain
small, incomplete diagnostics. They neither demonstrate useful full-size
performance nor constitute an owner comparison. Reports are preserved as
`scripts/out/transmission-dielectric-gpu/diagnostic-64x64-d2-{menger,hyper4}-glass-anchor-cells-fixed.json`.

The scalar tree harness subsequently replayed the eight primary samples named
by those archived refusal witnesses. Raising the work guards to 16,384 paths
and 256 interfaces qualified all eight without a cap: the four Menger samples
needed 4,136–5,714 processed paths, and the four 4D samples needed at most
110 interfaces. This is evidence for the next guard setting, not a claim
that all full-image pixels complete.

The same harness tests a possible conservative tail certificate: omitted
radiance plus the full bound of every pending path must fit the error budget
before a resource-limited sample can be called bounded completion. At the
old guards, the four Menger witnesses retain far too much untraced energy;
three of four 4D interface witnesses can be bounded. The GPU experiment does
not use that certificate yet. Its work guards remain hard refusals; the
next calibration changes only their measured limits, keeping the error
budget and 24-entry stack.

The next 256×256 GPU calibration used those larger guards with 128×64 tiles.
Both scenes completed 65,535 of 65,536 pixels; each had one state-mismatch
refusal at an exactly tied pair of faces. There were no path, interface or
stack failures. Accepted-pixel bounds were 0.000958101 (3D) and 0.000948801
(4D). The tile encode/submit/map totals were 7.6888 and 3.9127 seconds, with
about 35.90 MB of known cross-process state. These are incomplete calibration
results from source `f6b884d22d8615e3b3ed6bbe3e02a8776d92a0f3e95b65f7042ec5b2cf9b258f`, not full-image qualifications. The reports
are `scripts/out/transmission-dielectric-gpu/calibration-256x256-d2-{menger,hyper4}-glass-guards16384-256.json`.

That calibration also exposed an image-export convention error: row zero of
a directly encoded PNG is the top, but the camera had mapped it to the bottom
of its image plane. Subsequent output uses positive camera-up at PNG row zero.
The archived witness studies preserve their original coordinate convention.
The launcher and page now default to 128×64 tiles; the former 256×144 default
exceeded the additional-state preflight at 1024×1024 with the enlarged path
state. The report declares the replay settings and derives its completion
and cap-free flags from actual counters.

## Exact corner convention

At a nonsmooth edge, choosing one of several exactly crossed facets can send
a reflected ray outside through another crossed facet while its medium state
still says inside. The 256×256 calibration caught this in both dimensions.
An edge has no unique physical surface normal, so the experiment defines its
convention explicitly.

For an exact tie, let S be the span of the crossed facets' displayed normals.
The effective normal is the normalized projection of the incident direction
onto S, oriented outward from the incident medium. Reflection reverses that
projection and preserves the tangent component orthogonal to S. Consequently
it reverses the direction across every tied facet. Snell transmission
preserves the crossing sign of every tied facet. This keeps both resulting
rays consistent with their declared media. Gram-Schmidt constructs the span
in ascending intrinsic-axis order; the original single chosen face remains
an attribution convention. Rank-zero or otherwise invalid geometry refuses.

This rule concerns exact arithmetic ties in the current numeric mirror. It
neither merges nearby crossings nor certifies that f32 and f64 classify every
near-corner event identically. It is a declared rendering convention for the
finite solid's singular edges, not a claim that those edges have a smooth
physical normal.

## Completed GPU calibration

Source `608266cf2ef2394ede22d9d5574eea3977be0cde6b38cf1ba4cb61c17b6dac02`
passes all seventeen current-source GPU controls, including both reproduced
corner normals and reflected/transmitted anchored continuations. With the
corrected corner rule and PNG orientation, both 256×256 calibrations complete
all 65,536 pixels and 262,144 samples without invalid samples, unresolved
rays, traversal failures or resource caps. The maximum per-pixel omitted
contribution is 0.000958100893 in 3D and 0.000948801287 in 4D, both below
1/1024. Known cross-process state is approximately 35.90 MB.

The 3D tile encode/submit/map total is 7.7985 seconds; the 4D total is
3.8933 seconds. Each uses eight 128×64 tiles and four samples per pixel.
Quiet per-process baselines and the non-fallback RX 7900 XTX adapter are
recorded in both reports:
`scripts/out/transmission-dielectric-gpu/calibration-256x256-d2-{menger,hyper4}-glass-corner-controls.json`.
These successful calibrations authorize attempting useful full-size images;
image appearance and full-size performance require those images themselves.

## First full-size attempt and remaining numerical cases

The same source produced actual 1024×1024 opaque and glass images in both
dimensions. Both opaque controls complete with zero residual. The first glass
attempt remains refused: Menger has three incomplete pixels (two anchor-input
failures and one interface limit), and the 4D slice has five (one anchor-input
failure and four interface limits). All other pixels meet the per-pixel bound;
there are no non-finite samples. The measured tile encode/submit/map totals
are 65.2538 seconds for 3D glass and 45.2327 seconds for 4D glass, with known
cross-process state approximately 78.60 and 78.65 MB. These figures describe
an incomplete full-size attempt, not completed performance targets.

Its report and all four PNGs are preserved in the source-hash snapshot under
`scripts/out/transmission-dielectric-gpu/snapshots/`. The full-size images
show crisp internal facets and reflected features, but the studio lighting
remains plain. No owner approval is inferred from that inspection.

The separate 256-interface guard can terminate weak reflected paths before
the total work budget is exhausted. Every interface already consumes a
processed path, so the next run uses the existing 16,384 processed-path limit
as the interface ceiling too. This does not increase the maximum whole-tree
work or the size of the path stack.

The anchor failures expose sensitivity to rounded plane and hit-point
reconstruction. The old `-H + i * (2H/N)` plane expression can produce
different rounded values when operations are fused; the observed coordinates
match that mechanism. WGSL explicitly permits
[reassociation and fusion](https://www.w3.org/TR/2026/CRD-WGSL-20260817/#reassociation-and-fusion).
The centred rational form `H * (2i - N) / N` removes that observed cancellation
site; it is not a portable proof of bitwise equality between evaluations.

The finite-precision continuation policy therefore treats integer plane and
cell identities as authoritative. Reconstruction is allowed only within
`2 * 2^-23 * H` of those identities, and greater inconsistencies refuse.
Masked coordinates are reconstructed from their integer planes. An unmasked
coordinate rounded beyond its cell within that allowance is placed on the
pending boundary without consuming the next cell transition. This is an
explicit numerical reconstruction allowance, not a bound on all accumulated
floating-point or optical error. It can affect events at the precision limit;
it does not authorize merging larger intervals or hiding a traversal failure.

## Reproduce the full-size comparison

The launcher establishes the X cookie, checks the real driver and records the
per-process quiet baseline before launching Chromium. Run without other local
test or rendering workloads:

```bash
node scripts/transmission-dielectric-gpu.mjs --display=:0 --width=1024 --height=1024 --tileWidth=128 --tileHeight=64 --output=actual-1024x1024-all.json
node scripts/transmission-dielectric-review.mjs
```

Each row writes its PNG and report checkpoint before the next row. The builder
checks source and PNG hashes, actual dimensions, every sample's completion,
residual accounting, GPU controls, quiet hardware and the known allocation
plan. It rejects diagnostic/calibration files as the main review and displays
1024-pixel originals in separate rows. Generated artifacts remain under
`scripts/out/`; regenerate them from the pushed branch.

## Validation and review status

The application suite passed 191 files / 7,611 tests and the production build
passed. The final scalar geometry/tree run passes 9/9 tests; current-source
emitted GPU controls pass 22/22. Scripts TypeScript, ESLint, formatting and
launcher syntax checks pass. Full repository lint also passes after the final
source changes. Browser QA of the completed review at 1440px
desktop width and 390px mobile width confirms natural 1024px main images on
desktop, working original-image links, bounded-completion labels, no console
errors and no horizontal overflow even with details expanded. That initial
QA preceded the owner decision; the review now records the selection only
for the matching source and main PNG hashes.

The comparison study is delivered and its appearance is selected by the
owner. Production qualification remains open under the measured limits above.
