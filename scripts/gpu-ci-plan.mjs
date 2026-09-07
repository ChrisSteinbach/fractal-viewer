#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fullMatrix, scenarioRoster, selectImpact } from "./gpu-ci-impact.ts";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
function tree(ref) {
  // Resolve first: refs are data, never shell text or git options.
  const sha = git("rev-parse", "--verify", `${ref}^{commit}`).trim();
  const files = new Set(
    git("ls-tree", "-r", "--name-only", "-z", sha).split("\0").filter(Boolean),
  );
  const cache = new Map();
  return {
    files,
    read(file) {
      if (!cache.has(file)) cache.set(file, git("show", `${sha}:${file}`));
      return cache.get(file);
    },
  };
}

const args = process.argv.slice(2);
const value = (name) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
for (const arg of args)
  if (!/^--(full|base=.+|head=.+)$/.test(arg))
    throw new Error(`Unknown argument: ${arg}`);
const headRef = value("head") ?? "HEAD";
let baseRef = value("base");
let full = args.includes("--full");
const event = process.env.GITHUB_EVENT_PATH
  ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
  : {};
if (process.env.GITHUB_EVENT_NAME === "pull_request")
  baseRef ??= event.pull_request?.base?.sha;
if (process.env.GITHUB_EVENT_NAME === "push") baseRef ??= event.before;
if (["schedule", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME))
  full = true;

const roster = scenarioRoster(
  readFileSync("src/app/gpu-bench/main.ts", "utf8"),
);
let impact = {
  full: true,
  groups: ["flame-3d", "flame-4d"],
  reasons: ["explicit full sweep or no usable baseline"],
};
if (!full && baseRef) {
  try {
    // PR checks execute the merge tree. Comparing the base tip to that tree
    // covers the complete PR, including changes from earlier pushes.
    const headSha = git("rev-parse", "--verify", `${headRef}^{commit}`).trim();
    const baseSha = git("rev-parse", "--verify", `${baseRef}^{commit}`).trim();
    const changed = git(
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      baseSha,
      headSha,
      "--",
    )
      .split("\0")
      .filter(Boolean);
    impact = selectImpact(tree(baseSha), tree(headSha), changed);
  } catch (error) {
    impact.reasons = [`unavailable baseline/diff: ${String(error)}`];
  }
}
const plan = {
  ...impact,
  head: headRef,
  base: baseRef ?? null,
  roster,
  matrix: { include: impact.full ? fullMatrix(roster) : [] },
};
writeFileSync("gpu-ci-plan.json", JSON.stringify(plan, null, 2) + "\n");
console.log(JSON.stringify(plan, null, 2));
if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `full=${impact.full}\nmatrix=${JSON.stringify(plan.matrix)}\n`,
  );
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `GPU selection: **${impact.full ? "full 3D + 4D agreement" : "independent change; no GPU jobs"}**\n\n${impact.reasons.map((reason) => `- ${reason}`).join("\n")}\n\nRoster: ${roster.length} scenarios; ${plan.matrix.include.length} shards.\n`,
  );
