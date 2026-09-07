# GPU agreement CI

## Selection policy

`gpu-agreement.yml` runs its selector on every pull request and main push,
including documentation changes. It has no workflow path filter. The final
`gpu-agreement` check reports either completed agreement or a proved independent
change; failed analysis cannot silently disappear as a skipped workflow.

`scripts/gpu-ci-impact.ts` walks the TypeScript/JavaScript imports starting at
the actual benchmark page and headless runner. Static imports, re-exports,
literal dynamic imports, type imports and relative URL assets count. It walks
both the base and head trees, so removing an import cannot erase the old
dependency's ownership. Package imports are checked against `package.json`;
package and lockfile changes themselves select the full sweep.

The current ownership groups are **flame-3d and flame-4d together**. Their
production backend, CPU oracles, packing, shared math and scenario fixtures are
coupled through the same page. Module-level reachability therefore deliberately
selects both groups for either half. There is no manually maintained list of
kernel paths or scenario-to-feature assignments. Surface dependencies imported
by the combined benchmark page conservatively select flame agreement too.
Splitting that page into independent entry points could narrow this closure in
future; it is not necessary for independent UI changes to benefit now.

For each changed path, in order:

1. Membership in either dependency closure selects full agreement, including
   imported documentation and raw assets.
2. Otherwise `docs/**`, Markdown and `.beads/**` are inert, as under the old
   workflow policy.
3. Any other addition, deletion or rename selects full agreement. Git diff
   disables rename detection, so both old and new paths are checked.
4. An existing `.ts`/`.tsx`/`.js`/`.jsx`/`.mts`/`.mjs`/`.cts`/`.cjs` source
   module under `src/` can skip only when it is outside both closures and its
   import edges are unchanged. Ambient `.d.ts` declarations do not qualify.
5. Everything else selects full agreement: configuration, dependencies,
   workflow/runner edits, assets and files the policy does not understand.

An unresolved or ambiguous import, unknown package or alias, computed import, glob loader,
unsupported import assignment, parse failure, missing root or unavailable git
history selects full agreement. Symlink/submodule source and runtime fetch/file-read,
worker or generated-function loaders are also uncertain. Selector execution failure makes the aggregate
red. Unsupported scenario-roster structure also makes it red because the union
cannot then be established. New dependency syntax must earn support through
tests before it can prove independence.

PRs compare the event's base SHA with the checked-out merge tree, covering the
whole PR after every push. Main pushes compare `before` with the checked-out
commit, covering all pushed commits. Schedule and manual dispatch force full
agreement regardless of a baseline. Deploy reuses this workflow at the caller's
exact commit; its dispatch also forces full agreement. A missing baseline is
always full. `gpu-ci-plan.json` and the job summary record the reasons, roster
and selected matrix.

## Gates and full cadence

Relevant PRs first run `--backend-smoke`: the production 3D/4D plain/tiled
programs compile, warm up, accumulate, return nonempty staging readbacks, and
run both GPU downsample passes. Display downsampling uses the existing CPU
comparison and thresholds. The small 64×48 accumulation buffers and a single
dispatch make this a backend liveness check, with its own `backendSmoke`
verdict and five-minute script cap. It never reports statistical agreement.
The ordinary image/numeric agreement budgets, thresholds and ss=1 check are
unchanged. A failed smoke prevents spending the entire agreement matrix on
invalid WGSL or an unavailable GPU path.

The full roster currently has 32 scenarios: 19 in 3D, 13 in 4D. The selector
reads the literal `SCENARIOS` definitions from the page with the TypeScript
parser. Names and dimensions follow any spread properties so their identity is
statically checkable. It generates the same 27-way round-robin partition the
browser uses; no scenario list is copied into YAML. Tests compare every
generated shard with the browser's partition and check the exact union,
including an appended scenario. Roster growth automatically enters the sweep.
The 20-minute whole-shard cap and 40-minute job guard remain unchanged; future
growth must still demonstrate that its heaviest shard fits.

The full union runs:

- on affected or uncertain PRs and main pushes;
- nightly at **03:17 UTC**, on the default branch;
- on **every manual deployment**, before the deploy job can publish;
- on manual dispatch of **GPU agreement** for investigation.

Commands:

```sh
# Entire union, one local browser (20-minute stall cap per completed scenario).
npm run bench:gpu -- --chrome=bundled --swiftshader --duration=1
# Explicit full hosted matrix, including backend smoke.
gh workflow run gpu-agreement.yml
# Fast local backend check.
npm run bench:gpu -- --chrome=bundled --swiftshader --backend-smoke
# Inspect a committed delta or the full manifest, without running a GPU.
node scripts/gpu-ci-plan.mjs --base=BASE_SHA --head=HEAD_SHA
node scripts/gpu-ci-plan.mjs --full
# Reproduce hosted timing evidence (completed runs only).
node scripts/gpu-ci-metrics.mjs RUN_ID
```

The planner reads the roster from the checkout: check out `HEAD_SHA` when
inspecting another revision. The local browser may tire during a long software
sweep; the hosted partition is the isolated full-matrix form. A surface bench
remains its separate gate; this policy does not replace it.

## Required checks and deployment

The active main ruleset was inspected through GitHub's API on 2026-09-07. It
requires `lint`, `build`, `test` and `smoke`, from GitHub Actions, and a PR with
rebase-only merge. No GPU shard was a required check. This change preserves all
four names, their events and the ruleset; there is **no required-check
migration** and no remote protection edit.

The additional stable `gpu-agreement` aggregate runs with `if: always()`. It
passes only when selection succeeded and either both GPU jobs succeeded, or a
proved independent selection skipped both. Failure, cancellation, missing
outputs and unexpected skips fail it. If GPU agreement is made required later,
require this name, never the variable shard names. Tests execute the actual
aggregate shell against these success/failure states and inspect the existing
required-check events and deploy dependency.

Deploy first runs the existing exact-SHA lint/build/test/smoke preflight, so a
missing or red ordinary check refuses before spending the full GPU sweep.
Its `gpu-full` reusable call must then finish successfully before `deploy` starts.
This lengthens a deployment or rollback by one full sweep; an old PR's green
GPU result or an independent-change result cannot substitute. Deployment stays
manual. Rebase merges still need main CI to finish before dispatch, and the
live-site verification remains after publication. PR/push cancellation groups
are separate from nightly, manual and deployment full runs.

## Measurement record

The old broad trigger ran the same matrix for an independent UI source edit
as for a kernel/CPU-oracle edit. The baseline below therefore measures the
work that either class paid, with the unchanged 32-scenario roster.

Baseline: [main run 34129315979](https://github.com/ChrisSteinbach/fractal-viewer/actions/runs/34129315979),
commit `69f26681aee10e0c6680208dd7032ff442f1fa63`, 2026-09-07:

| Quantity                                           |              Observed value |
| -------------------------------------------------- | --------------------------: |
| Full workflow elapsed time, creation to completion |                      28m37s |
| Allocated runner time, 27 successful jobs          |              324.65 minutes |
| Agreement-step time summed across jobs             |              315.78 minutes |
| All setup, upload and teardown time combined       |        8.87 minutes (2.73%) |
| Longest job / longest agreement step               |             19m35s / 19m19s |
| GPU timed throughput across scenarios              | 61,353–182,471 iterations/s |

These are elapsed job allocations, not rounded billable minutes. The first
20 jobs were admitted before the remaining seven; the completion tail extends
about nine minutes beyond the longest individual job. Logs and API job/step
timestamps distinguish queue time from execution. The measurement helper
reproduces wall time and runner-minute totals without downloading images.

The independent-source probe changed one existing `src/app/ui.ts` tooltip,
with identical imports, in a disposable PR against the implementation branch.
Its GPU workflow [34155886040](https://github.com/ChrisSteinbach/fractal-viewer/actions/runs/34155886040)
passed with `full: false`, both GPU jobs skipped, and the stable aggregate
green. It took **5m08s elapsed and 0.467 runner-minutes**: selection used 25s
and the aggregate 3s. The remaining 4m40s was queue/orchestration time while the
separate full matrix occupied the hosted runner pool. This deliberately reports
the observed wall time under contention, not 28 seconds as a latency claim.
Against the old policy's identical-GPU-input baseline, allocated runner time
fell **99.86%**; no agreement scenario ran. The before row reuses the measured
full sweep because the tooltip changes none of its inputs; it does not claim a
second historical run of that exact tooltip commit.

The same probe's [ordinary CI run 34155886067](https://github.com/ChrisSteinbach/fractal-viewer/actions/runs/34155886067)
passed all four required checks: lint, build, test and WebGL smoke. This proves
the required-check acceptance path on GitHub, beyond the selector unit test.
The disposable [probe PR #377](https://github.com/ChrisSteinbach/fractal-viewer/pull/377)
was then closed without merging and its branch removed.

The GPU-sensitive harness/workflow implementation selected both groups in
[full run 34155672849](https://github.com/ChrisSteinbach/fractal-viewer/actions/runs/34155672849),
commit `2d1ccdad7635e32886b1f0f321888a52e8984271`. All 30 jobs passed: selection,
backend smoke, 27 agreement shards and the aggregate. Its logs contain exactly
the current roster's **32 distinct passing scenario records**, including all
image and downsample comparisons; all 27 standalone ss=1 checks passed too.

| Change class / policy                               | Full scenarios | Workflow elapsed | Allocated runner-minutes |
| --------------------------------------------------- | -------------: | ---------------: | -----------------------: |
| Old policy, either independent or sensitive source  |             32 |           28m37s |                   324.65 |
| New policy, measured independent tooltip PR         |              0 |            5m08s |                    0.467 |
| New policy, measured sensitive 3D/4D harness change |             32 |           25m54s |                   295.22 |

The full after-run spent 283.15 summed minutes in agreement steps. Its selector
took 21s, backend-smoke job 136s (129s in the browser/runner step), and aggregate
5s. The longest shard remained 19m35s, with a 19m17s agreement step. The smaller
full-run total is **run-to-run execution/queue variation, not a reduction in
agreement coverage or a claimed kernel optimization**: sensitive changes
still run the same complete workload, plus the early backend check. The
ordinary required checks also passed in
[implementation CI run 34155672887](https://github.com/ChrisSteinbach/fractal-viewer/actions/runs/34155672887).

Local backend smoke on 2026-09-07: all four programs passed on bundled Chromium
SwiftShader in **23.15 seconds of page work**. Injecting invalid WGSL into the
4D module produced a named 4D compilation failure and process exit 1 after the
two 3D programs passed. The injected source was restored. This is a negative
execution check, in addition to the selector's unit tests. Removing
`navigator.gpu` through a browser initialization script also produced a fatal
"WebGPU is not available" result, with no completion or smoke pass.

## Execution substrate and batching

The repository is public and had **zero configured self-hosted runners** when
queried on 2026-09-07. Standard GitHub-hosted public-repository jobs have no
runner-minute charge; [larger runners remain billed](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
Runner-minutes here measure resource use and waiting, rather than a claimed
dollar saving. No paid runner was provisioned and no workstation was enrolled.

Batching has a small ceiling on this baseline: even eliminating all setup,
upload and teardown saves at most 8.87 of 324.65 minutes. A first-fit-decreasing
replay of the measured **whole shard steps**, pairing only when their sum fits
18 minutes, reduces 27 allocations to 24 while preserving the pre-existing
longer singletons. At the observed average overhead that saves only about
0.99 runner-minutes. Allowing pairs right up to 20 minutes gives 17 allocations,
but one reaches exactly the script cap, before browser startup variation. That
is not a safe replacement for the measured partition. These are batching
models, not additional hosted runs, and retain the per-shard ss=1 work.

The available local workstation has an i9-9900K (8 cores/16 threads) and Radeon
RX 7900 XTX, Mesa 25.2.8. `glxinfo -B` identifies that real driver; it is not the
Iris described by older machine notes. Real-GPU results must identify their
WebGPU adapter as well. A workstation run measures single-machine execution,
not hosted queue/cold-start time or a production self-hosted service level.

The attempted full real-driver union on 2026-09-07 used bundled Chromium,
`--display=:0 --duration=1`, on an otherwise quiet machine. The page reported
`amd rdna-3` and completed ten scenarios through `kaleido`, then the browser
closed during `variation-zoo`. The process exited 1 at **179.16 seconds**;
the error's cause was `Target page, context or browser has been closed`, not
an elapsed 20-minute deadline. No full agreement verdict or complete result
artifact was produced, so this is **inconclusive for agreement and a failed
full-gate execution**, not a measured speedup for all 32 scenarios. It provides
no basis to replace the successful hosted topology. Browser isolation would
need a separate measured trial before promoting this substrate.

Keep public PR execution on disposable hosted runners. GitHub explicitly
[warns against persistent self-hosted runners for public PRs](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#hardening-for-self-hosted-runners):
untrusted code can compromise their environment. A dedicated ephemeral GPU
runner for trusted full sweeps would need isolation, patching, browser/driver
maintenance, capacity and direct-cost accounting. Faster hardware is a
separate option for the full gate; it does not justify a full sweep after an
unrelated source change.

## Earlier partition evidence

Before impact selection, the workflow moved out of `ci.yml` because it took
16m39s–19m32s against smoke's 1m50s. Workflow-level `paths-ignore` then exempted
only docs, Markdown and beads. The initial four-way split measured a 6m27s
slowest shard, at roughly 1.3× runner-minutes due to duplicated setup.

The multi-system wave forced four to eight to twelve shards. Four jobs put two
shards over the 20-minute script cap. Eight still timed out shard 6 and left
shards 4 and 7 only 48s and 31s of margin. Scenario legs spanned 2m14s–6m56s;
round-robin had grouped three heavy legs. Twelve limited the then-roster to
two scenarios each, with the slowest pair about 12m43s, about 13m20s including
fixed work. The 40-minute job cap remained above the unchanged script cap.

Tiling grew 23 scenarios to 30. At twelve shards, six jobs took 20.5–24 minutes
of bench work; four timed out and two passed with under a minute's margin.
The timed-out shards were 1/2/4/6, on variation-zoo-4d, fold-zoo-4d, the ss=1
check and emitter-menagerie; shard 1 was about 15s short. Typical legs took
5–7 minutes, heavy ones 9–14; tiling-multisystem-3d alone spent about 12 minutes
in GPU equal-N at about 70K iterations/s. Twenty-five left that index-5 leg
unpaired, with pairs and the slowest single around 14 minutes.

The exact-flam3 batch grew 30 to 32 scenarios. At 25 shards, indices 30/31
would pair with old indices 5/6, restoring the known heavy pairing. Twenty-seven
was the smallest round-robin count leaving old indices 5+ single; only old
indices 0–4 pair with new indices 27–31. No timeout or agreement threshold was
raised. This history explains the retained partition, not a policy of adding
jobs indefinitely.

Browser setup still uses cached, lockfile-pinned Playwright Chromium, without
`--with-deps`. On 2026-08-19 an apt mirror hung smoke and shards 1/3/4 (shard 1
twice) without reaching tests. Ubuntu's hosted image already supplied the
browser library closure; a future missing library should fail at launch and
trigger a deliberate setup repair. The alternative Playwright container was
rejected then for an uncached roughly 1GB pull, a tag requiring lockfile
synchronization, and root's sandbox-flag changes. Caching the browser solves a
different problem from impact selection.
