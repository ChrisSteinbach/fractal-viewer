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

function main() {
  const args = process.argv.slice(2);
  for (const arg of args)
    if (!/^--(sha=.+|repo=.+|tree)$/.test(arg))
      throw new Error(`Unknown argument: ${arg}`);
  const value = (name) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const sha = value("sha");
  if (!sha) throw new Error("Missing required argument: --sha=<sha>");
  const repo = value("repo") ?? process.env.GITHUB_REPOSITORY;
  if (!repo)
    throw new Error("Missing --repo=<owner/repo> and GITHUB_REPOSITORY");

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
    verdict = treeSweptVerdict({
      sha,
      candidates,
      tree: (candidate) => commitTree(repo, candidate),
      checkRuns: (candidate) => fetchCheckRuns(repo, candidate),
    });
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

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
