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
commit, covering all pushed commits — and, before that, ask whether this push's
TREE was already swept green on another commit, which is how a rebase merge's
new SHAs inherit their PR's sweep (see _Tree identity_ below). That question is
asked on `push` alone, and it WAITS up to 45 minutes for a twin whose sweep is
still in flight rather than duplicating it. Schedule and manual dispatch force
full agreement regardless of a baseline. Deploy reuses this workflow at the
caller's exact commit; its dispatch also forces full agreement, and inside a
called workflow `github.event_name` is the CALLER's event, so the tree question
is never asked there — deploy asks it once in its own preflight and skips the
whole call. A missing baseline is always full. `gpu-ci-plan.json` and the job
summary record the reasons, roster and selected matrix.

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

The full roster currently has 34 scenarios: 20 in 3D, 14 in 4D. The selector
reads the literal `SCENARIOS` definitions from the page with the TypeScript
parser. Names and dimensions follow any spread properties so their identity is
statically checkable. It generates one shard per scenario, using the browser's
existing round-robin partition with the roster length as its denominator; no
scenario list is copied into YAML. Tests compare every generated shard with
the browser's partition and check the exact union, including roster growth
beyond the former 27-shard ceiling. An added scenario gets its own job instead
of changing which expensive cases must share a deadline. The 20-minute
whole-shard cap and 40-minute job guard remain unchanged; each individual
scenario still has to fit. The standalone ss=1 check runs in every job.

The full union runs:

- on affected or uncertain PRs and main pushes;
- nightly at **03:17 UTC**, on the default branch;
- on a **manual deployment**, before the deploy job can publish — unless some
  commit carrying the same tree already has a full sweep recorded green on it,
  which the preflight reuses instead of repeating (see below);
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
missing or red ordinary check refuses before spending the full GPU sweep. That
gate stays an exact-commit question — it is cheap, and its early post-rebase
refusal is deliberate. A full agreement result for that commit's **content**
must then be in hand before `deploy` starts: either the `gpu-full` reusable
call finishes successfully, or the preflight found one already recorded green
on a commit carrying the same tree and `gpu-full` skips. Reuse is the narrow
third case, and only that one.

Deploy's sweep is a **content gate, not an environment liveness check**, which
is what admits the reuse. It runs on its own `ubuntu-latest` runner in a
separate job from `deploy`, against source and CPU oracles; it never touches the
built bundle or the publishing environment, so it cannot certify "the
environment doing the publishing is healthy". Liveness — does this content still
pass on today's runner image — is what the nightly 03:17 UTC full sweep on the
default branch already measures, so a per-deploy re-run of the same matrix on
the same content adds no liveness signal the nightly does not carry. A
SwiftShader or runner-image regression is a CI signal; it is not a reason to
block publishing a source-built bundle to users' real browsers.

`backend-smoke` is the **full** discriminator. The stable `gpu-agreement`
aggregate is green on both of its branches — a completed full sweep, and a
proved-independent selection that skipped both GPU jobs — so aggregate-green
alone would admit a commit whose kernels were never swept. On the full branch
the aggregate has already asserted that `backend-smoke` **and** every
`agreement` shard succeeded, while on the independent branch it asserts
`backend-smoke` is `skipped`. Aggregate-green plus `backend-smoke`-green
therefore proves the whole matrix ran and passed, with no shard counting.
`scripts/gpu-ci-swept.mjs` is that predicate: it reads a commit's check runs
(paginated, latest by id, counting the reusable call's prefixed
`gpu-full / …` names), and any missing, pending, red or unreadable result
resolves to "not swept" so the failure direction is always to sweep. It is
plain dependency-free JavaScript because the preflight job has no `npm ci`. Its
`--sha=X` mode asks that question of one exact commit; `--tree` asks it of the
commit's **content**, walking a bounded candidate list and accepting only a
commit whose tree matches byte for byte.

The independent-change refusal stays in force: such a result cannot substitute,
because selection **skipped** the GPU jobs rather than running them, whatever
tree it sat on. The "different SHA" refusal is superseded — not because the
conclusion was wrong but because the **commit was the wrong key**; see _Tree
identity_ below. Deployment stays manual. Rebase merges still need main CI to
finish before dispatch, and the live-site verification remains after
publication. PR/push cancellation groups are separate from nightly, manual and
deployment full runs.

## Tree identity: a sweep survives a rebase merge

A rebase merge mints new commit SHAs, which is why a PR's green checks do not
transfer to the merged commits. But git already records content identity
separately from commit identity, as the **tree** object, and a rebase replays
each patch onto the same base: only the parent and the committer date move.
Measured on the 2026-09-10 staging-ceiling merge, PR 391's branch against main
after `gh pr merge --rebase`:

| PR branch commit | Main commit | Tree (shared) |
| ---------------- | ----------- | ------------- |
| `d721cc7`        | `616e4f3`   | `3c191a94…`   |
| `e15e195`        | `2c7f121`   | `ebb08c3a…`   |
| `cc24bf8`        | `3b3a138`   | `ed8ef5ea…`   |

So `scripts/gpu-ci-swept.mjs --tree` asks the content question instead of the
commit one: is there a commit with a **byte-identical tree** carrying a green
full sweep? On that merge it collapses three full 36-shard sweeps into **one**.
It also covers, for free, a commit that only changed its message, an empty
rebase, a cherry-pick of an already-swept change, and a revert of a revert.

**The chain closes to one sweep only if both halves ask the tree question.**
The PR head sweeps; `gpu-agreement.yml`'s push-to-main run then finds the
rebased tip's tree already swept on that head and plans `full=false`, which
leaves main's tip carrying a green `gpu-agreement` aggregate with
`backend-smoke` **skipped**. The exact-SHA question reads that (correctly) as
"not swept", so a deploy still asking it would sweep a second time — net two
sweeps, not one. Deploy's preflight therefore asks `--tree` too, finds the same
twin, and skips: PR head sweeps → push skips → deploy skips.

The reuse reaches the plan as `node scripts/gpu-ci-plan.mjs --swept=<sha>`
rather than as a second skip condition beside `full`, so `full=false` stays the
one signal both GPU jobs and the stable aggregate read — the aggregate's
assertion that `full=false` implies both jobs `skipped` holds unchanged — and
`gpu-ci-plan.json` still records the reuse, and the impact analysis's own
reasons beneath it, in `reasons`, plus a structural `swept` field so a reader
need not parse a sentence. The job summary headlines a reuse as a reuse: both
outcomes end in no GPU jobs, but a reuse says this content already passed where
independence says it was never touched, and those are not the same claim.

### Propose versus decide

Candidates come from `GET /repos/{owner}/{repo}/commits/{sha}/pulls`, and that
association is a **heuristic**. It does not matter, which is the point of the
design: **the API only PROPOSES a candidate; tree equality DECIDES.** Verified
against this repo, all three merged commits propose the same PR head:

```
616e4f3 -> PR 391, head d721cc7
2c7f121 -> PR 391, head d721cc7
3b3a138 -> PR 391, head d721cc7
```

`616e4f3` and `d721cc7` share tree `3c191a94…`, so the tip's twin is found. The
two intermediate commits propose the same head, its tree differs from theirs,
and they sweep. A wrong proposal costs one tree comparison; it can never
produce a wrong verdict.

Trusting a twin is sound because **the tree IS the content**. If a full sweep
passed green on a commit with this exact tree, this content was swept —
including a fork PR's run, which executes in this repo's Actions on that
content. The unsound version is trusting a _claim_ about the tree rather than
the tree itself.

The candidate list is bounded (`MAX_TREE_CANDIDATES`, 5) with the target
commit itself **first**, so tree mode is a strict superset of the exact-SHA
question at no extra API call, and a pathological association list cannot
outrun the preflight job's `timeout-minutes: 2`. Every failure direction —
an unreadable tree, an unreadable candidate, an API error, a mismatched tree,
a candidate green only by an independence skip — resolves to "not swept" and
spends the sweep.

`commitTree` reads the tree from the API rather than `git rev-parse` on
purpose: deploy's preflight checkout is shallow while `select`'s is full, so
only one of the two callers could answer locally at all, and a candidate from
another branch or a fork PR need not be in either checkout. The trust boundary
is unchanged, since check runs already come from the same API. All three
endpoints used (commit, its pulls, its check runs) answer 200 on this public
repo with no token, so no `pull-requests: read` is added — and none may be, as
a reusable workflow cannot request more than its caller job grants and deploy's
`gpu-full` grants `contents: read` alone.

### Waiting for a twin's sweep that is still running

Tree reuse only pays when the twin's sweep has **finished**, and nothing makes
it finish first. `gpu-agreement` is not a required check, so the four that are
— `lint`, `build`, `test`, `smoke` — go green in ~6 minutes and the merge
button is live roughly 27 minutes before the PR's 36-shard sweep is. Observed
on the first real merge after tree keying landed: the push-to-main run asked
the tree question, found the twin carrying no **completed** aggregate, and
correctly started a second full sweep of byte-identical content. The verdict
was right; the gap was that reuse depended on a human waiting for a sweep no
rule made them wait for.

So `--wait` (push runs only) polls every 30s, up to a 45-minute budget, when a
tree twin's sweep is **in flight**. The trade is **one idle `ubuntu-latest`
runner for at most the budget, against 36 shard jobs of ~8 minutes each
(~290 runner-minutes)**. Wall clock is roughly unchanged: the wait ends when
the twin's sweep ends, which is about when a duplicate sweep started now would
have ended anyway. What is saved is the shard fleet, not time.

**Ask the workflow run, never the check run.** Measured on main's tip
`9163d1c` mid-sweep (2026-09-10): `backend-smoke` is `completed/success` and
there is **no `gpu-agreement` check run at all**, because that job carries
`needs: [select, backend-smoke, agreement]` and its check run does not exist
until the shards finish. "No aggregate check" is therefore ambiguous between
"no sweep ever ran here" and "one is running right now", and only
`GET /repos/{owner}/{repo}/actions/workflows/gpu-agreement.yml/runs?head_sha=…`
separates them, through each run's `status` (`queued`/`in_progress`/
`completed`) and `conclusion`.

**The self-deadlock is the hazard.** `candidateShas` puts the target commit
**first**, and the gpu-agreement run in flight on the target commit is _the run
doing the waiting_. Left alone it waits for itself to the budget and then
sweeps — strictly worse than sweeping at once. Both the target SHA and
`GITHUB_RUN_ID` are excluded, deliberately both: the SHA is the real rule, the
run id is insurance if candidate ordering ever changes, and each is pinned by
its own test.

Three more cases the poll handles, each a way to lose the budget:

1. **A cancelled twin ends the wait.** `gh pr merge --delete-branch` deletes
   the PR branch, and deleting a branch cancels its queued and in-progress
   runs. The wait stops on **any** completed status, never on success alone.
2. **An independence run is never waited for.** A run whose `backend-smoke` job
   is `completed/skipped` proved the change independent (or reused a sweep
   itself) and can never satisfy `fullSweepVerdict`. It is read from
   `/actions/runs/{id}/jobs`, where a skipped job is listed the moment
   selection decides (verified on run `34155886040`, the proved-independent
   probe: `backend-smoke completed/skipped`).
3. **A tree-mismatched twin is never waited for.** A sweep running on content
   that is not ours is worth none of the budget — the propose-versus-decide
   rule again, one poll further out.

**No two runs can wait for each other.** The step is `push`-only, so a PR run
never waits at all, and a push run's candidates — its own commit, its
associated PR heads, the push's `before` — are all commits that already
existed when it started. The wait graph therefore points strictly backwards in
time and cannot close a cycle.

Every failure direction stays "sweep": budget expiry, an API error, an
unclassifiable run, a cancelled or red twin. `select`'s `timeout-minutes` rises
to 60 to cover the budget and the job's own work, so expiry is always the
script's reported verdict and never a killed job reddening the aggregate over a
reuse that should merely not happen.

`waitDecision` is pure over per-candidate state the caller has already fetched
(`{sha, treeMatched, verdict, runs}`), so every rule above is tested without a
network or a clock; `waitForFullSweep` is the thin async shell that fetches,
decides and sleeps. Trees are read once per commit for the whole wait — a
commit's tree cannot change — while check runs and workflow runs are re-read
every poll, which is what turns a twin finishing green mid-wait into a reuse.

**Deploy's preflight deliberately does NOT wait.** A dispatch is manual and
re-dispatchable, so "wait, then dispatch again" is already the user's own call;
that job's `timeout-minutes` is 2, sized for a question answered in seconds;
and a deploy parked for half an hour holds the `pages` concurrency group that
`cancel-in-progress: false` already makes precious — the documented rollback
flow (revert through a PR, then dispatch fresh) would queue behind the parked
run. A dispatch whose twin sweep is still running simply sweeps, as before.

### What tree reuse deliberately does NOT cover

**A rebase onto a MOVED main.** The patches replay onto a different base, so
every tree is genuinely new content no run has ever seen — and that is exactly
where a semantic conflict hides: each side passed alone, the combination has
never been tested. A new tree sweeps. Nobody has to reason about which case
they are in; the tree hashes answer it.

Three caveats bound what a tree marker asserts:

1. **Same tree is not the same artifact.** `vite.config.ts` bakes the short SHA
   and the build date into `__BUILD_ID__` deliberately, so "same tree" never
   means "same `dist/`". Harmless here: the sweep runs against source and CPU
   oracles and never touches the built bundle.
2. **Same tree is not the same environment.** A reused sweep asserts that this
   content passed on a recent runner, never that it would pass now. Liveness is
   the nightly 03:17 UTC full sweep's job, which is why `schedule` and
   `workflow_dispatch` never consult the marker.
3. **The marker must record FULL**, never merely that the aggregate was green.
   `backend-smoke` is the discriminator, and it is what makes a green
   independence-skip result unusable as evidence — including the one this
   change itself creates on main's tip.

### Refuted alternative: an Actions cache marker

The first design wrote a `gpu-agreement-full-<tree>` entry through
`actions/cache` and had `select` consult it, on the belief that cache scoping
made the marker safe to trust. GitHub's dependency-caching reference (fetched
2026-09-10) refutes the mechanism:

> When a cache is created by a workflow run triggered on a pull request, the
> cache is created for the merge ref (`refs/pull/.../merge`). Because of this,
> the cache will have a limited scope and can only be restored by re-runs of
> the pull request.

> Workflow runs cannot restore caches created for child branches or sibling
> branches.

The scoping is real, and it **defeats** the mechanism rather than securing it:
the marker would be written by the PR run and read by the main push run, which
is precisely the direction the scoping forbids. The only case tree keying
exists to serve is the one the cache cannot serve. Independently, a cache key
is a _claim_ about a tree that an untrusted run could plant, where a check run
on a commit whose tree the API confirms is the tree itself — a second reason
the cache is the wrong store.

## Measurement record

### The selector was inert until 2026-09-10

Every run selected a FULL sweep whatever changed, so the impact machinery
this document describes was delivering none of the savings measured below.
Four hosted runs and three local replays all reported the identical reason:

    analysis uncertainty: Error: unknown import in scripts/gpu-flame-bench.mjs

`gpu-ci-impact.ts` treated EVERY `new URL(...)` as a possible module
reference. `scripts/gpu-flame-bench.mjs` builds one runtime HTTP address from
a template literal, which is a `TemplateExpression` rather than
`isStringLiteralLike`, so analysing that file threw and the whole selection
fell back. The file is in the closure every run analyses, so every run paid
it.

The branch exists for the bundler idiom `new URL(spec, import.meta.url)`,
the only form the tests covered. A ONE-argument `new URL(x)` cannot be a
module reference at all: a relative specifier with no base is a runtime
TypeError, so the argument is always an absolute runtime address. The
branch now requires a second argument. A dynamic first argument BESIDE a
base still fails closed — that one genuinely cannot be resolved, and a test
pins it so the narrowing cannot drift into unsoundness.

Replayed over real commits after the fix, the selector discriminates:

| Commit    | Change                       | Before | After                                     |
| --------- | ---------------------------- | ------ | ----------------------------------------- |
| `7ed79ce` | AGENTS.md only               | full   | independent, 0 shards                     |
| `883c60c` | tracker sync only            | full   | independent, 0 shards                     |
| `2c7f121` | touches `surface-compute.ts` | full   | full — `agreement dependency`             |
| `616e4f3` | adds a repro script          | full   | full — `unclassified configuration/asset` |

### Duplicate sweeps on one tree, 2026-09-10

The staging-ceiling merge ran the same full 36-shard sweep THREE times on one
byte-identical tree:

| Run                | Event           | Shards | Note                         |
| ------------------ | --------------- | -----: | ---------------------------- |
| PR 391             | `pull_request`  |     36 | head `d721cc7`               |
| main tip `616e4f3` | `push`          |     36 | 17:30 → 18:03 (33 min)       |
| deploy 34509745795 | `workflow_call` |     36 | dispatched 17:41, overlapped |

The push and deploy sweeps were in flight together — 72 shard jobs for one
tree — and the deploy sweep produced no information the push sweep had not
already produced on the SAME SHA. It also lengthens the ROLLBACK path, which
`deploy.yml`'s header documents as "land a revert through a PR, then dispatch
a fresh run": that revert pays a push sweep and then a second full sweep at
dispatch, half an hour of it while production is wrong.

`scripts/gpu-ci-swept.mjs` was exercised against these real commits before
shipping. Both `616e4f3` and PR head `d721cc7` report swept — reading
`gpu-full / gpu-agreement` and `gpu-full / backend-smoke` as the latest
matches while ignoring all 72 `gpu-agreement (shard N)` runs, which
prefix-match the aggregate's name and must not satisfy it. Intermediate main
commits, which carry no `gpu-agreement` run of their own, report not swept.
Pagination is load-bearing and was observed to be: the same query without
`--paginate` reports `backend-smoke` MISSING on `616e4f3`, because the default
30-newest-first page truncates it behind the shard runs.

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

The 2026-09-08 investigation repeated the original launch on the same Radeon
and Mesa stack, bundled Chromium revision 1234 (Chrome 151), with the original
runner from `026f2b2`. Fresh-browser `variation-zoo` passed in **35.876s of
browser lifetime**; the original full, single-browser run passed **all 32
scenarios (19 3D, 13 4D) and ss=1 in 575.675s of browser lifetime**, exiting
normally with code 0 and no signal. These times run from Playwright's browser
launch to process exit, including screenshots, and exclude dev-server startup
and the runner's remaining startup timer. Each returned scenario name was
checked against the source roster and every comparison/downsample verdict
was true. This did not reproduce the historical exit and does not identify
its cause. The original journal adds only the Chromium scope finishing, with
no crash, OOM or driver report in the surrounding interval.

Startup diagnostics did reveal a separate launch defect: setting `DISPLAY`
alone still selected Wayland on this desktop, and Chromium reported
`'--ozone-platform=wayland' is not compatible with Vulkan`. That warning
occurred in both successful original-launch repeats, so it is **not evidence
that Wayland caused the historical exit**. `--display` now explicitly passes
`--ozone-platform=x11`, matching its documented contract. WebGPU still must
identify `amd rdna-3`; a successful X connection alone does not certify the
compute adapter.

The first foreground X11 shard attempt was interrupted by an unexpected
top-level navigation to Google after five completed scenarios. Neither the
benchmark nor its runner requests that navigation. That attempt is not counted
as agreement evidence and does not establish why the historical browser closed.
It exposed two further runner problems: a replacement page could erase the
partial snapshot, and the wait would continue on that unrelated page. The wait
now refuses a changed URL, diagnostics record top-level navigation, and an
empty replacement page cannot overwrite the last benchmark sample.

Hardware runs now create an unfocused, minimized window by default; explicit
`--headed` keeps it visible. `--start-minimized` alone was ineffective because
Playwright creates a new target, and its viewport initialization restores the
window. A minimized/background CDP target with no Playwright viewport, followed
by direct emulation of the same 3040×1000 viewport, keeps it minimized. This was
checked both through CDP and the live window's `_NET_WM_STATE_HIDDEN` after
progress screenshots. This removes the automated run's interference with
desktop keyboard focus without switching to a software GPU or changing the
agreement workload.

The minimized X11 repeat used four sequential fresh browsers, `--shard=1/4`
through `4/4`, with diagnostics enabled and no concurrent test suite. **All
four exited 0 normally, with no page crash or unexpected browser disconnect.**
The eight returned names in each shard matched `applyScenarioShard` over the
source roster; their exact union was all **32 scenarios, 19 3D and 13 4D**, with
every comparison, display-downsample and all four ss=1 checks passing on
`amd rdna-3`. The experiment establishes a completed isolated union on this
host, not a reproducible explanation for the old exit or a replacement for
the hosted CI topology.

Minimization exposed a capture cost: about 85 seconds after the first shard's
agreement finished went into per-element screenshots. Clipping rendered
document rectangles still cost about 75 seconds on the fourth shard. The
final runner therefore serializes the completed **2D canvas bitmaps** directly
for minimized runs; `page.png` retains the surrounding page and CSS borders.
Headless and explicit `--headed` element captures stay unchanged. This changes
artifact capture, not the equal-N workload or any agreement threshold.
The final capture path passed `sierpinski` and `chi-kaleido-4d` together with
ss=1, produced six 960×540 PNGs, and closed normally about two seconds after
agreement completed. Both CPU bitmaps matched the original screenshot
interiors pixel for pixel after removing their CSS borders.

Keep public PR execution on disposable hosted runners. GitHub explicitly
[warns against persistent self-hosted runners for public PRs](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#hardening-for-self-hosted-runners):
untrusted code can compromise their environment. A dedicated ephemeral GPU
runner for trusted full sweeps would need isolation, patching, browser/driver
maintenance, capacity and direct-cost accounting. Faster hardware is a
separate option for the full gate; it does not justify a full sweep after an
unrelated source change.

## Roster growth and independent deadlines

The tiling/symmetry extension grew the roster from 32 to 34. In the first
hosted run (2026-09-08, run `34202948983`), the fixed 27-way partition put
`tiling-multisystem-3d` and `chi-kaleido-4d` together in shard 7. The first
scenario completed; the second was still accumulating at 114.3 K iterations
per second when their shared 20-minute script deadline expired. This was
a whole-shard timeout, not a numerical comparison failure. The same cases
had been assigned to different jobs in the 32-scenario roster.

One scenario per generated shard removes that dependence on roster order.
The 34-scenario matrix adds seven runner setups and seven standalone ss=1
checks relative to the 27-job grouping. It neither increases a scenario's
sample budget nor removes any comparison, and it leaves both deadline
guards intact. Historical pooled-job cost figures below remain measurements
of their original partitions, not predictions for this matrix.
Local requalification passed 7,207 tests across 176 files, full lint and the
production build; 80 targeted planner, workflow, browser-partition and wait
tests include the roster-growth regression.

### Browser exit diagnostics

Use a separate output directory for each attempt:

```sh
mkdir -p scripts/out/flame-browser-exit
export XAUTHORITY=$(ls -t /run/user/$(id -u)/.mutter-Xwaylandauth.* | head -1)
export DISPLAY=:0
glxinfo -B | rg 'OpenGL renderer'
DEBUG=pw:browser npm run bench:gpu -- --chrome=bundled --display=:0 \
  --duration=1 --diagnostics --out=scripts/out/flame-browser-exit/full \
  > scripts/out/flame-browser-exit/full.log 2>&1
```

Add `--scenarios=variation-zoo` for a fresh-browser single-scenario check, or
run every `--shard=i/n` sequentially
with separate output paths for an isolated union. Verify the returned names
against the page's roster, every comparison and downsample verdict, and each
shard's ss=1 check; successful process exits alone do not establish coverage.

`--diagnostics` uses a loopback-only Playwright browser server to access its
child process. `browser-events.jsonl` records the actual command, browser
version, PID, progress, page crashes, disconnects, runner errors and process
exit code/signal. Deliberate teardown is marked separately. `browser-stderr.log`
captures stderr after attachment. For startup stderr, repeat without
`--diagnostics` using `DEBUG=pw:browser`; Playwright's server launch does not
stream those initial messages. No GPU work or second browser is added by
diagnostics.

`partial-results.json` is an atomic replacement of the last successful sample,
normally once per second. It carries the active scenario/phase, completed rows
and the page's `done` latch; it can lag a crash and never substitutes for a
completed gate. Final `results.json` is now written before screenshots, so an
image-capture failure cannot erase completed numeric evidence. Reusing an
output directory clears the prior final result before launch. Browser loss
preserves its actual exception; only Playwright's `TimeoutError` is described
as an elapsed deadline. Neither local rolling deadlines nor CI's total shard
cap changes.

`node scripts/gpu-bench-diagnostics.verify.mjs` exercises actual Chromium
`Page.crash`, browser SIGKILL and navigation away. Its synthetic completed row
tests artifact survival and failure attribution, not GPU agreement. Outputs
live under
`scripts/out/gpu-bench-diagnostics/`.

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
raised. That choice depended on the roster order and was replaced by the
per-scenario policy above when the next extension paired expensive cases.

Browser setup still uses cached, lockfile-pinned Playwright Chromium, without
`--with-deps`. On 2026-08-19 an apt mirror hung smoke and shards 1/3/4 (shard 1
twice) without reaching tests. Ubuntu's hosted image already supplied the
browser library closure; a future missing library should fail at launch and
trigger a deliberate setup repair. The alternative Playwright container was
rejected then for an uncached roughly 1GB pull, a tag requiring lockfile
synchronization, and root's sandbox-flag changes. Caching the browser solves a
different problem from impact selection.
