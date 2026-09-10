#!/usr/bin/env node
// Does this content already carry a green FULL gpu-agreement sweep?
//
// TWO MODES, one predicate. `--sha=X` asks the exact-commit question. `--tree`
// asks the CONTENT question: is there a commit with a BYTE-IDENTICAL TREE that
// carries one? A rebase merge mints new commit SHAs, which is exactly why a
// PR's green checks do not transfer — but the COMMIT is the wrong key. Git
// already records content identity separately, as the tree object, and a
// rebase replays each patch onto the same base and so keeps every tree: only
// parent and committer date move. Measured on the 2026-09-10 staging-ceiling
// merge (figures in docs/gpu-agreement-ci.md). A rebase onto a MOVED main
// genuinely produces new trees and sweeps, which is the refusal we want:
// nobody has to reason about which case they are in, the tree hashes answer
// it.
//
// Deliberately plain JavaScript with no TypeScript import (unlike
// scripts/gpu-ci-plan.mjs, which imports gpu-ci-impact.ts and therefore needs
// setup-node + `npm ci`): deploy.yml's preflight has neither a node version
// step nor an install, so this must run on a bare runner with only the
// preinstalled node and `gh`.
//
// FULL IS THE LOAD-BEARING WORD. A bare green `gpu-agreement` is NOT enough:
// gpu-agreement.yml's aggregate also passes when `select` proved the change
// independent and both GPU jobs were SKIPPED, so aggregate-green alone admits
// a commit whose kernels were never swept. `backend-smoke` is the
// discriminator — the aggregate asserts it is `skipped` on the independent
// branch and `success` on the full branch, and on the full branch it asserts
// every `agreement` shard succeeded too. So aggregate-green PLUS
// backend-smoke-green proves the whole matrix ran and passed, with no shard
// counting needed.
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Of the check runs whose name is `name` or ends with `/ ${name}` (a reusable
// workflow call prefixes its job names, e.g. `gpu-full / backend-smoke`, and
// those are equally valid evidence of a sweep on this commit), the one with
// the greatest id — every dispatch mints another check suite on the same
// commit, so the latest is the only one that describes today's state.
export function latestCheckByName(runs, name) {
  const suffix = `/ ${name}`;
  let latest;
  for (const run of runs ?? []) {
    const runName = String(run?.name ?? "");
    if (runName !== name && !runName.endsWith(suffix)) continue;
    if (latest === undefined || run.id > latest.id) latest = run;
  }
  return latest;
}

const state = (run) => `${run.status}/${run.conclusion ?? "none"}`;

export function fullSweepVerdict(runs) {
  const aggregate = latestCheckByName(runs, "gpu-agreement");
  if (!aggregate)
    return {
      swept: false,
      reason: "no gpu-agreement check run on this commit",
    };
  if (aggregate.status !== "completed" || aggregate.conclusion !== "success")
    return {
      swept: false,
      reason: `gpu-agreement is ${state(aggregate)} on this commit, not completed/success`,
    };
  const smoke = latestCheckByName(runs, "backend-smoke");
  if (!smoke)
    return {
      swept: false,
      reason:
        "gpu-agreement is green but there is no backend-smoke check run — nothing proves the sweep was full",
    };
  if (smoke.status !== "completed" || smoke.conclusion !== "success")
    return {
      swept: false,
      reason: `gpu-agreement is green but backend-smoke is ${state(smoke)} — a proved-independent selection, not a full sweep`,
    };
  return {
    swept: true,
    reason:
      "gpu-agreement and backend-smoke are both green on this commit — a full sweep is already recorded here",
  };
}

// One JSON object per line, across every page. NOT `--slurp`, which needs
// gh >= 2.51 and cannot be exercised on an older local gh at all: a --jq
// filter ending in `[]` streams its results, so concatenating pages stays
// valid JSONL whatever the gh version, and the projection keeps a commit
// carrying 70+ shard runs down to a few KB.
export function parseCheckRuns(stdout) {
  return stdout
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export function fetchCheckRuns(repo, sha) {
  // --paginate: the default page is 30 newest-first, and every dispatch mints
  // another check suite on the same commit, so repeated dispatches truncate
  // the runs we need off page one.
  return parseCheckRuns(
    execFileSync(
      "gh",
      [
        "api",
        "--paginate",
        `repos/${repo}/commits/${sha}/check-runs`,
        "--jq",
        ".check_runs[] | {id, name, status, conclusion}",
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    ),
  );
}

// Never more than this many commits are examined, however long the
// association list turns out to be: the preflight job's timeout-minutes is 2
// and every candidate costs up to two API round trips.
export const MAX_TREE_CANDIDATES = 5;

// The commits worth asking about, in order, deduplicated. PURE over responses
// already fetched, so the ordering rule is testable without a network:
//
//   1. THE TARGET ITSELF, always first. That is the exact-SHA question this
//      script already answered, so tree mode is a strict superset of it and
//      costs no extra API call to keep it working.
//   2. The head SHAs of pull requests GitHub associates with the commit.
//   3. On a push event, the push's `before` commit — an amended message, an
//      empty rebase, a revert of a revert.
//
// PROPOSE VERSUS DECIDE is what makes step 2 sound even though GitHub's
// commit -> PR association is a HEURISTIC. The API only PROPOSES a candidate;
// TREE EQUALITY DECIDES. A wrongly proposed commit whose tree differs is
// skipped, and a rightly proposed one whose tree matches IS this content by
// definition. Measured: all three commits of the staging-ceiling merge propose
// the same PR head, and only the tip — the one that actually shares its
// tree — is accepted.
/**
 * @param {{
 *   sha?: string,
 *   pulls?: { number?: number, head?: { sha?: string } | string }[],
 *   pushBefore?: string,
 *   limit?: number,
 * }} [options]
 * @returns {string[]}
 */
export function candidateShas({
  sha,
  pulls,
  pushBefore,
  limit = MAX_TREE_CANDIDATES,
} = {}) {
  const shas = [];
  const add = (value) => {
    const candidate = String(value ?? "").trim();
    // Hex only, and never the all-zero null SHA a first push reports as
    // `before`: a candidate is fed straight to `gh api` as a path segment.
    if (!/^[0-9a-f]{7,40}$/.test(candidate) || /^0+$/.test(candidate)) return;
    if (shas.includes(candidate) || shas.length >= limit) return;
    shas.push(candidate);
  };
  add(sha);
  for (const pull of pulls ?? []) add(pull?.head?.sha ?? pull?.head);
  add(pushBefore);
  return shas;
}

const short = (sha) => String(sha ?? "").slice(0, 7);
// A failed `gh api` prints its whole usage banner; these reasons are echoed
// into the job log as one sentence each.
const firstLine = (error) => String(error?.message ?? error).split("\n")[0];

// Walks `candidates` in order and stops at the first one that BOTH shares the
// target's tree and carries a green full sweep. Injected `tree`/`checkRuns` so
// the walk is testable without a network; every failure direction — an
// unreadable tree, an unreadable candidate, a mismatched tree, a candidate
// swept only by an independence skip — is "not swept", never "assume yes".
export function treeSweptVerdict({ sha, candidates, tree, checkRuns }) {
  const seen = new Map();
  const treeOf = (candidate) => {
    if (!seen.has(candidate)) seen.set(candidate, tree(candidate));
    return seen.get(candidate);
  };
  let target;
  try {
    target = treeOf(sha);
  } catch (error) {
    return {
      swept: false,
      reason: `could not read the tree of ${sha}: ${firstLine(error)}`,
    };
  }
  if (!target)
    return { swept: false, reason: `no tree recorded for commit ${sha}` };

  const rejected = [];
  for (const candidate of candidates ?? []) {
    let candidateTree;
    try {
      candidateTree = treeOf(candidate);
    } catch (error) {
      rejected.push(
        `${short(candidate)}: tree unreadable (${firstLine(error)})`,
      );
      continue;
    }
    if (candidateTree !== target) {
      // The rebase-onto-a-moved-main refusal: the patches replayed onto a
      // different base, so this is content no run has ever seen.
      rejected.push(
        `${short(candidate)}: tree ${short(candidateTree)} differs from ${short(target)}`,
      );
      continue;
    }
    let verdict;
    try {
      verdict = fullSweepVerdict(checkRuns(candidate));
    } catch (error) {
      rejected.push(
        `${short(candidate)}: check runs unreadable (${firstLine(error)})`,
      );
      continue;
    }
    if (verdict.swept)
      return {
        swept: true,
        sha: candidate,
        reason: `tree ${short(target)} was already fully swept on ${candidate === sha ? `this commit (${candidate})` : `commit ${candidate}`} — ${verdict.reason}`,
      };
    rejected.push(`${short(candidate)}: ${verdict.reason}`);
  }
  return {
    swept: false,
    reason: `no commit sharing tree ${short(target)} carries a green full sweep — ${rejected.join("; ") || "no candidate commits to consider"}`,
  };
}

// The API rather than `git rev-parse` on purpose: deploy.yml's preflight
// checkout is shallow (no fetch-depth) while gpu-agreement.yml's select
// checkout is full, so only one of the two callers could answer this from the
// local object store at all — and a candidate commit from another branch or a
// fork PR need not be in either checkout. The trust boundary is unchanged: we
// already read check runs from this same API for this same repo.
export function commitTree(repo, sha) {
  return execFileSync(
    "gh",
    ["api", `repos/${repo}/commits/${sha}`, "--jq", ".commit.tree.sha"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  ).trim();
}

// Pull requests GitHub associates with this commit. One JSON object per line,
// same reason as fetchCheckRuns: no --slurp, which needs gh >= 2.51.
export function fetchPullHeads(repo, sha) {
  return parseCheckRuns(
    execFileSync(
      "gh",
      [
        "api",
        "--paginate",
        `repos/${repo}/commits/${sha}/pulls`,
        "--jq",
        ".[] | {number, head: .head.sha}",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ),
  );
}

// ---------------------------------------------------------------------------
// WAITING FOR A TWIN'S SWEEP THAT IS STILL RUNNING
//
// Tree reuse only pays when the twin's sweep has FINISHED, and nothing makes
// it finish first: `gpu-agreement` is not a required check, so the four
// required ones (lint/build/test/smoke) go green in ~6 minutes and the merge
// button is live ~27 minutes before the PR's 36-shard sweep is. Observed on
// the first real merge after tree keying landed: the push-to-main run asked
// the tree question, found the twin carrying no COMPLETED aggregate, and
// correctly started a second full sweep of byte-identical content.
//
// So when a twin's sweep is IN FLIGHT, wait for it instead of duplicating it.
// The arithmetic: one idle ubuntu runner for at most the wait budget, against
// 36 shard jobs of ~8 minutes each (~290 runner-minutes). Wall-clock is
// roughly unchanged — the wait ends when the twin's sweep ends, which is when
// a duplicate sweep started now would have ended anyway.
//
// ASK THE WORKFLOW RUN, NEVER THE CHECK RUN. Measured on main's tip
// 9163d1c mid-sweep (2026-09-10): `backend-smoke` is completed/success and
// there is NO `gpu-agreement` check run at all, because that job
// `needs: [select, backend-smoke, agreement]` and its check run does not
// exist until the shards finish. "No aggregate check" is therefore ambiguous
// between "no sweep ever ran here" and "one is running right now", and only
// the workflow run's own `status` separates them.
export const GPU_AGREEMENT_WORKFLOW = "gpu-agreement.yml";
// 45 minutes against a measured ~33-minute sweep (2026-09-10, main tip
// 616e4f3: 17:30 -> 18:03). The margin covers hosted-runner queueing at the
// shard fan-out, and expiry sweeps rather than failing, so an over-run costs
// one duplicate sweep and never a red gate.
export const DEFAULT_WAIT_BUDGET_MS = 45 * 60 * 1000;
export const WAIT_POLL_MS = 30 * 1000;

// SHA equality that tolerates an abbreviation on either side: `--sha=` may be
// given short by hand, while every SHA from the API is full-length.
export function sameCommit(a, b) {
  const x = String(a ?? "").toLowerCase();
  const y = String(b ?? "").toLowerCase();
  const n = Math.min(x.length, y.length);
  return n >= 7 && x.slice(0, n) === y.slice(0, n);
}

// Reuse now, wait, or sweep — PURE over per-candidate state the caller has
// already fetched, so the poll loop is testable with no network and no clock.
// A twin is `{sha, treeMatched, note?, verdict?, runs?}`, where `runs` are
// that commit's gpu-agreement workflow runs as
// `{id, status, conclusion, smokeSkipped}`.
//
// THE SELF-DEADLOCK IS THE HAZARD. `candidateShas` puts the TARGET COMMIT
// first, and the gpu-agreement run in flight on the target commit is THE RUN
// ASKING THIS QUESTION: left alone it waits for itself until the budget
// expires and then sweeps, which is strictly worse than sweeping at once.
// Two exclusions, deliberately both — the target's own SHA is the real rule,
// and GITHUB_RUN_ID is cheap insurance if candidate ordering ever changes.
//
// THREE MORE RUNS ARE NOT WORTH WAITING FOR. A run whose `backend-smoke` was
// SKIPPED proved independence (or reused a sweep itself) and can never
// satisfy `fullSweepVerdict`, so waiting for it is pure loss. Any COMPLETED
// status ends the wait, never success alone: `gh pr merge --delete-branch`
// deletes the PR branch, which cancels its queued and in-progress runs, and a
// budget spent waiting for a run that will never finish is the worst outcome
// available. And a twin whose tree does not match is not this content at all.
// Every remaining failure direction — budget expiry, an API error, a red
// twin — is "sweep", exactly as today.
/**
 * @param {{
 *   targetSha?: string,
 *   currentRunId?: string | number,
 *   twins?: {
 *     sha?: string,
 *     treeMatched?: boolean,
 *     note?: string,
 *     verdict?: { swept?: boolean, reason?: string },
 *     runs?: {
 *       id?: number,
 *       status?: string,
 *       conclusion?: string | null,
 *       smokeSkipped?: boolean,
 *     }[],
 *   }[],
 *   elapsedMs?: number,
 *   budgetMs?: number,
 * }} [options]
 */
export function waitDecision({
  targetSha,
  currentRunId,
  twins,
  elapsedMs = 0,
  budgetMs = DEFAULT_WAIT_BUDGET_MS,
} = {}) {
  const rejected = [];
  for (const twin of twins ?? []) {
    if (!twin?.treeMatched) {
      rejected.push(`${short(twin?.sha)}: ${twin?.note ?? "tree differs"}`);
      continue;
    }
    if (twin.verdict?.swept)
      return {
        action: "reuse",
        sha: twin.sha,
        reason: `${sameCommit(twin.sha, targetSha) ? `this commit (${twin.sha})` : `commit ${twin.sha}`} carries a full sweep of this tree — ${twin.verdict.reason}`,
      };
    rejected.push(
      `${short(twin.sha)}: ${twin.verdict?.reason ?? "no full sweep recorded"}`,
    );
  }

  const excluded =
    currentRunId === undefined || currentRunId === null
      ? undefined
      : String(currentRunId);
  const until = [];
  for (const twin of twins ?? []) {
    if (!twin?.treeMatched) continue;
    // The self-deadlock, excluded twice over.
    if (sameCommit(twin.sha, targetSha)) continue;
    for (const run of twin.runs ?? []) {
      if (excluded !== undefined && String(run?.id) === excluded) continue;
      if (run?.status === "completed") continue;
      if (run?.smokeSkipped) continue;
      until.push({ sha: twin.sha, runId: run?.id, status: run?.status });
    }
  }

  const spent = Math.max(0, Math.round(elapsedMs / 1000));
  const budget = Math.max(0, Math.round(budgetMs / 1000));
  if (until.length === 0)
    return {
      action: "sweep",
      reason: `no commit sharing this tree carries or is running a full sweep — ${rejected.join("; ") || "no candidate commits to consider"}`,
    };
  const running = until
    .map((entry) => `${short(entry.sha)} run ${entry.runId} (${entry.status})`)
    .join(", ");
  if (elapsedMs >= budgetMs)
    return {
      action: "sweep",
      reason: `a full sweep of this tree is still running on ${running} after ${spent}s of a ${budget}s wait budget — sweeping rather than waiting longer`,
    };
  return {
    action: "wait",
    until,
    reason: `waiting for the in-flight full sweep of this tree on ${running} — ${spent}s of ${budget}s spent`,
  };
}

// That commit's gpu-agreement workflow runs, each classified for eligibility.
// A run whose jobs cannot be read is DROPPED rather than kept with a guessed
// classification: unwaitable is the sweep direction, and inventing
// `smokeSkipped: false` would park the budget on a run nothing can vouch for.
function twinRuns(candidate, workflowRuns, runSmokeSkipped) {
  let runs;
  try {
    runs = workflowRuns(candidate) ?? [];
  } catch {
    return [];
  }
  return runs
    .map((run) => {
      // A finished run is judged by its check runs, not its jobs; asking for
      // the jobs of every historical run would cost a call per poll per run.
      if (run?.status === "completed") return run;
      try {
        return { ...run, smokeSkipped: runSmokeSkipped(run.id) };
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

// The thin async shell around `waitDecision`: fetch, decide, sleep, repeat.
// Trees are read once each and cached for the whole wait — a commit's tree
// cannot change — while check runs and workflow runs are re-read every poll,
// which is what lets a twin that finishes green mid-wait become a reuse.
/**
 * @param {{
 *   sha: string,
 *   candidates: string[],
 *   tree: (sha: string) => string,
 *   checkRuns: (sha: string) => unknown[],
 *   workflowRuns: (sha: string) => unknown[],
 *   runSmokeSkipped: (runId: number) => boolean,
 *   currentRunId?: string | number,
 *   budgetMs?: number,
 *   pollMs?: number,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   log?: (line: string) => void,
 * }} options
 */
export async function waitForFullSweep({
  sha,
  candidates,
  tree,
  checkRuns,
  workflowRuns,
  runSmokeSkipped,
  // Absent locally, where there is no run of our own to exclude.
  currentRunId,
  budgetMs = DEFAULT_WAIT_BUDGET_MS,
  pollMs = WAIT_POLL_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = (line) => console.log(line),
}) {
  const trees = new Map();
  const treeOf = (candidate) => {
    if (!trees.has(candidate))
      try {
        trees.set(candidate, { tree: tree(candidate) });
      } catch (error) {
        trees.set(candidate, { error: firstLine(error) });
      }
    return trees.get(candidate);
  };

  const started = now();
  for (;;) {
    const target = treeOf(sha);
    if (target.error)
      return {
        swept: false,
        reason: `could not read the tree of ${sha}: ${target.error}`,
      };
    if (!target.tree)
      return { swept: false, reason: `no tree recorded for commit ${sha}` };

    const twins = [];
    for (const candidate of candidates ?? []) {
      const twin = { sha: candidate, treeMatched: false };
      twins.push(twin);
      const candidateTree = treeOf(candidate);
      if (candidateTree.error) {
        twin.note = `tree unreadable (${candidateTree.error})`;
        continue;
      }
      if (candidateTree.tree !== target.tree) {
        twin.note = `tree ${short(candidateTree.tree)} differs from ${short(target.tree)}`;
        continue;
      }
      twin.treeMatched = true;
      try {
        twin.verdict = fullSweepVerdict(checkRuns(candidate));
      } catch (error) {
        twin.verdict = {
          swept: false,
          reason: `check runs unreadable (${firstLine(error)})`,
        };
      }
      if (twin.verdict.swept) break;
      // The target's own runs are never even fetched: one of them is the run
      // asking this question, and `waitDecision` excludes them anyway.
      if (sameCommit(candidate, sha)) continue;
      twin.runs = twinRuns(candidate, workflowRuns, runSmokeSkipped);
    }

    const decision = waitDecision({
      targetSha: sha,
      currentRunId,
      twins,
      elapsedMs: now() - started,
      budgetMs,
    });
    if (decision.action === "reuse")
      return { swept: true, sha: decision.sha, reason: decision.reason };
    if (decision.action === "sweep")
      return { swept: false, reason: decision.reason };
    // This job sits apparently idle for up to the budget, so every poll says
    // what it is waiting for and how long it has waited: a reader must be
    // able to tell waiting from hung.
    log(decision.reason);
    await sleep(pollMs);
  }
}

// gpu-agreement runs for this exact commit. `head_sha` needs the full 40-char
// SHA (an abbreviation matches nothing), which is what every candidate from
// the pulls/push-event sources already is. One JSON object per line and no
// --slurp, same reason as fetchCheckRuns.
export function fetchWorkflowRuns(
  repo,
  sha,
  workflow = GPU_AGREEMENT_WORKFLOW,
) {
  return parseCheckRuns(
    execFileSync(
      "gh",
      [
        "api",
        "--paginate",
        `repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100`,
        "--jq",
        ".workflow_runs[] | {id, status, conclusion, event}",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ),
  );
}

// Did selection skip this run's backend-smoke? Jobs, not check runs: the
// aggregate's check run does not exist mid-sweep, but a SKIPPED job is
// listed here the moment selection decides (verified on run 34155886040,
// the proved-independent probe: `backend-smoke completed/skipped`).
// `latestCheckByName` matches the reusable call's `gpu-full / backend-smoke`
// naming too, and the jobs list is paginated because a full sweep has 39.
export function fetchRunSmokeSkipped(repo, runId) {
  const jobs = parseCheckRuns(
    execFileSync(
      "gh",
      [
        "api",
        "--paginate",
        `repos/${repo}/actions/runs/${runId}/jobs`,
        "--jq",
        ".jobs[] | {id, name, status, conclusion}",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ),
  );
  const smoke = latestCheckByName(jobs, "backend-smoke");
  return Boolean(
    smoke && smoke.status === "completed" && smoke.conclusion === "skipped",
  );
}

async function main() {
  const args = process.argv.slice(2);
  for (const arg of args)
    if (!/^--(sha=.+|repo=.+|tree|wait|wait-budget-ms=\d+)$/.test(arg))
      throw new Error(`Unknown argument: ${arg}`);
  const value = (name) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const sha = value("sha");
  if (!sha) throw new Error("Missing required argument: --sha=<sha>");
  const repo = value("repo") ?? process.env.GITHUB_REPOSITORY;
  if (!repo)
    throw new Error("Missing --repo=<owner/repo> and GITHUB_REPOSITORY");
  // The wait polls the TREE question; there is nothing to wait for in the
  // exact-SHA one (the run asking it is the run that would have to finish).
  const wait = args.includes("--wait");
  if (wait && !args.includes("--tree"))
    throw new Error("--wait polls the tree question: pass --tree --wait");
  const budgetMs = Number(value("wait-budget-ms") ?? DEFAULT_WAIT_BUDGET_MS);

  // Any failure talking to the API is NOT swept: the safe direction is to
  // spend the sweep, never to publish a commit whose kernels went unchecked.
  let verdict;
  if (args.includes("--tree")) {
    // The association list is itself best-effort: no pulls means the walk
    // still asks the exact-commit question, which is the pre-tree behaviour.
    let pulls = [];
    try {
      pulls = fetchPullHeads(repo, sha);
    } catch (error) {
      console.log(
        `could not list associated pull requests: ${firstLine(error)}`,
      );
    }
    let pushBefore;
    if (
      process.env.GITHUB_EVENT_NAME === "push" &&
      process.env.GITHUB_EVENT_PATH
    )
      try {
        pushBefore = JSON.parse(
          readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
        ).before;
      } catch {
        pushBefore = undefined;
      }
    const candidates = candidateShas({ sha, pulls, pushBefore });
    const tree = (candidate) => commitTree(repo, candidate);
    const checkRuns = (candidate) => fetchCheckRuns(repo, candidate);
    verdict = wait
      ? await waitForFullSweep({
          sha,
          candidates,
          tree,
          checkRuns,
          workflowRuns: (candidate) => fetchWorkflowRuns(repo, candidate),
          runSmokeSkipped: (runId) => fetchRunSmokeSkipped(repo, runId),
          // Set for every job by Actions; absent locally, where there is no
          // run of our own to exclude.
          currentRunId: process.env.GITHUB_RUN_ID,
          budgetMs,
        })
      : treeSweptVerdict({ sha, candidates, tree, checkRuns });
  } else {
    try {
      verdict = fullSweepVerdict(fetchCheckRuns(repo, sha));
    } catch (error) {
      // First line only: a failed `gh api` prints its whole usage banner, and
      // this reason is echoed into the job log as one sentence.
      verdict = {
        swept: false,
        reason: `could not read check runs: ${firstLine(error)}`,
      };
    }
  }
  console.log(`${sha}: ${verdict.reason}`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `swept=${verdict.swept}\nswept_sha=${verdict.sha ?? ""}\n`,
    );
}

// An unhandled rejection is an uncaught exception in Node 22, so an async
// main fails the step exactly as the synchronous one did.
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
