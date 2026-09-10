#!/usr/bin/env node
// Does this exact commit already carry a green FULL gpu-agreement sweep?
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
import { appendFileSync } from "node:fs";
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

function main() {
  const args = process.argv.slice(2);
  for (const arg of args)
    if (!/^--(sha=.+|repo=.+)$/.test(arg))
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
  try {
    verdict = fullSweepVerdict(fetchCheckRuns(repo, sha));
  } catch (error) {
    // First line only: a failed `gh api` prints its whole usage banner, and
    // this reason is echoed into the job log as one sentence.
    const detail = String(error?.message ?? error).split("\n")[0];
    verdict = { swept: false, reason: `could not read check runs: ${detail}` };
  }
  console.log(`${sha}: ${verdict.reason}`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `swept=${verdict.swept}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
