#!/usr/bin/env node
/**
 * gate:affected — map a dirty tree (or a base..head diff) onto the gates and
 * harness sheets that actually EXERCISE the changed code. The seventh
 * gate-velocity child; dry-run by default, the warm runner is the hand-off.
 *
 * Usage:
 *   npm run gate:affected                     # dirty tree vs main's merge-base
 *   npm run gate:affected -- --base=main      # explicit base ref
 *   npm run gate:affected -- --base=<sha> --head=<sha>   # a past commit's diff
 *   npm run gate:affected -- --run            # hand the affected GATES to
 *                                             # `npm run verify --` (sheets
 *                                             # print their vitest commands)
 *   npm run gate:affected -- --json           # machine output
 *
 * The mapping is TWO halves (scripts/gate-map.ts owns the semantics): the
 * hand table GATE_MAP (which app modules each entry's verdict exercises —
 * the import graph cannot see a browser gate's runtime coverage) plus each
 * entry's own IMPORT CLOSURE over the diff's head tree (scripts-side helpers
 * and the sheets' src/fractal reach, computed here with the CI selector's
 * `importClosure` walker, memoized — one TS parse per file). The roster
 * errs INCLUSIVE: machinery and boot-spine changes mark everything gates;
 * an on-disk script missing from GATE_MAP is reported as an `unmapped`
 * warning and counts as affected whenever any code changed — the update
 * rule (add the entry in the same change) fixes it, a silent skip never
 * happens. Docs/markdown/beads paths are inert.
 *
 * Cost classes ride the entries: `cache-eligible` (wired to the frame cache
 * and/or a fast tier — the class a background pre-warm could legally take),
 * `full-render`, `lifecycle` (timings, teardown, trusted interaction, the
 * deployed origin — never cached, never backgrounded; the machine-quiet
 * rule's own class). A background pre-warm daemon for the CPU/SwiftShader
 * class is this child's deliberately-guarded stretch and is NOT shipped:
 * on an interactive box it would compete with the editing session for CPU
 * and risk the quiet-machine rule, and UNKNOWN NEVER READS AS QUIET.
 *
 * Runs in a few seconds; the output is grouped by cost class and prints the
 * exact hand-off commands. Exit 0 always (this is a planning tool, not a
 * gate) except on a usage/git error (exit 2 — a CHECKING failure).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  APP_SPINE_MODULES,
  GATE_MAP,
  affectedRoster,
  isInertPath,
} from "./gate-map.ts";
import { importClosure } from "./gpu-ci-impact.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function parseArgs(argv) {
  const args = { base: "main", head: undefined, run: false, json: false };
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      throw new Error(`Unrecognized argument: ${raw} (flags start with --)`);
    }
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    switch (key) {
      case "base":
        args.base = value || "main";
        break;
      case "head":
        args.head = value || undefined;
        break;
      case "run":
        args.run = true;
        break;
      case "json":
        args.json = true;
        break;
      default:
        throw new Error(`Unknown flag: --${key}`);
    }
  }
  return args;
}

/** A commit's file set + lazy reads, the gpu-ci-plan pattern. */
function tree(ref) {
  const sha = git("rev-parse", "--verify", `${ref}^{commit}`).trim();
  const entries = git("ls-tree", "-r", "-z", sha).split("\0").filter(Boolean);
  const modes = new Map(
    entries.map((entry) => [
      entry.slice(entry.indexOf("\t") + 1),
      entry.split(" ")[0],
    ]),
  );
  const files = new Set(modes.keys());
  const cache = new Map();
  return {
    files,
    read(file) {
      if (!["100644", "100755"].includes(modes.get(file)))
        throw new Error(`unsupported symlink/submodule: ${file}`);
      if (!cache.has(file)) cache.set(file, git("show", `${sha}:${file}`));
      return cache.get(file);
    },
  };
}

/** The working tree: tracked + untracked (gitignored excluded — the walker
 * only reads what it reaches, and scripts/out must not shadow a real path).
 * Unreadable-as-text files are included in the set (they may be import
 * candidates) but reading one throws into that entry's conservative path. */
function worktree() {
  const listing = git("ls-files", "-c", "-o", "--exclude-standard", "-z");
  const files = new Set(listing.split("\0").filter(Boolean));
  const cache = new Map();
  return {
    files,
    read(file) {
      if (!cache.has(file))
        cache.set(file, readFileSync(path.join(REPO_ROOT, file), "utf8"));
      return cache.get(file);
    },
  };
}

/** The changed set: dirty-tree mode diffs the merge-base against the WORKING
 * TREE (committed + uncommitted, what will land in the PR) plus untracked
 * files; --head mode diffs base..head directly. Inert paths never enter. */
function changedFiles(args) {
  const dirty = (ref) => {
    const mergeBase = git("merge-base", ref, "HEAD").trim();
    const diff = git("diff", "--name-only", "-z", mergeBase);
    const untracked = git("ls-files", "--others", "--exclude-standard", "-z");
    return [...(diff + untracked).split("\0").filter(Boolean)];
  };
  const committed = (base, head) =>
    git("diff", "--name-only", "-z", base, head).split("\0").filter(Boolean);
  const raw = args.head
    ? committed(
        git("rev-parse", "--verify", `${args.base}^{commit}`).trim(),
        git("rev-parse", "--verify", `${args.head}^{commit}`).trim(),
      )
    : dirty(git("rev-parse", "--verify", `${args.base}^{commit}`).trim());
  return new Set(raw.filter((f) => f && !isInertPath(f)));
}

function onDiskRoster() {
  const roster = new Map();
  for (const file of readdirSync(path.join(REPO_ROOT, "scripts"))) {
    if (file.endsWith(".verify.mjs")) {
      roster.set(file.slice(0, -".verify.mjs".length), {
        kind: "gate",
        path: `scripts/${file}`,
      });
    } else if (file.endsWith(".harness.ts")) {
      roster.set(file.slice(0, -".harness.ts".length), {
        kind: "sheet",
        path: `scripts/${file}`,
      });
    }
  }
  return roster;
}

function formatRoster(answer, timings) {
  const lines = [];
  const groups = { "cache-eligible": [], "full-render": [], lifecycle: [] };
  for (const entry of answer.affected) groups[entry.cost].push(entry);
  lines.push(
    `gate:affected — ${answer.affected.length} affected of ${GATE_MAP.length} table entries` +
      ` (+${answer.unmapped.length} unmapped on disk) in ${timings.elapsedMs}ms`,
  );
  if (answer.machineryFiles.length > 0) {
    lines.push(
      `  MACHINERY changed: ${answer.machineryFiles.join(", ")} — everything runs`,
    );
  }
  if (answer.spineFiles.length > 0) {
    lines.push(
      `  APP SPINE changed: ${answer.spineFiles.join(", ")} — every gate runs`,
    );
  }
  const label = {
    "cache-eligible": "cache-eligible / fast-tier",
    "full-render": "full-render",
    lifecycle: "lifecycle (never cached, never backgrounded)",
  };
  for (const cost of ["cache-eligible", "full-render", "lifecycle"]) {
    const entries = groups[cost];
    if (entries.length === 0) continue;
    lines.push(`  ${label[cost]} (${entries.length}):`);
    for (const entry of entries) {
      lines.push(`    ${entry.name} — ${entry.reasons.join("; ")}`);
    }
  }
  if (answer.unmapped.length > 0) {
    lines.push(
      `  UNMAPPED (add to GATE_MAP in the same change — the preset side tables' rule): ${answer.unmapped.join(", ")}`,
    );
  }
  return lines;
}

async function main() {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));
  let changed;
  let closureTree;
  try {
    changed = changedFiles(args);
    closureTree = args.head ? tree(args.head) : worktree();
  } catch (e) {
    console.error(`[gate:affected] git/analysis failure: ${e}`);
    process.exitCode = 2;
    return;
  }
  const roster = onDiskRoster();
  // One parse per file across every entry's closure — the CI selector's
  // walker, memoized.
  const edgeCache = new Map();
  const closures = new Map();
  const notes = [];
  for (const [name, info] of roster) {
    try {
      closures.set(name, importClosure(closureTree, info.path, edgeCache));
    } catch (e) {
      closures.set(name, null);
      notes.push(`${name}: closure unavailable (${String(e)}) — table-only`);
    }
  }
  const answer = affectedRoster({
    entries: GATE_MAP,
    onDisk: new Map([...roster].map(([name, info]) => [name, info.kind])),
    changed,
    closures,
  });
  const elapsedMs = Date.now() - t0;
  const timings = { elapsedMs, changedFiles: changed.size };
  if (args.json) {
    console.log(
      JSON.stringify(
        { ...answer, notes, timings, commands: handoff(answer, roster) },
        null,
        2,
      ),
    );
  } else {
    for (const line of formatRoster(answer, timings)) console.log(line);
    for (const note of notes) console.error(`[gate:affected] note: ${note}`);
    const commands = handoff(answer, roster);
    if (commands.verifyGates.length > 0) {
      console.log(
        `  hand-off: npm run verify -- ${commands.verifyGates.join(" ")}`,
      );
    }
    for (const sheet of commands.sheets) console.log(`  sheet: ${sheet}`);
  }
  if (args.run) {
    const commands = handoff(answer, roster);
    if (commands.verifyGates.length === 0) {
      console.log("[gate:affected] nothing affected — nothing to run");
      return;
    }
    console.error(
      `[gate:affected] --run: handing ${commands.verifyGates.length} gate(s) to the warm runner`,
    );
    const child = execFileSync(
      "npm",
      ["run", "verify", "--", ...commands.verifyGates],
      {
        stdio: "inherit",
        cwd: REPO_ROOT,
      },
    );
    void child;
  }
}

/** The warm-runner hand-off: affected gate names for `npm run verify --`,
 * and each affected sheet's own vitest invocation. */
function handoff(answer, roster) {
  const verifyGates = [];
  const sheets = [];
  for (const entry of answer.affected) {
    if (entry.kind === "gate") verifyGates.push(entry.name);
    else {
      const path = roster.get(entry.name)?.path;
      if (path)
        sheets.push(
          `npx vitest run --config scripts/vitest.harness.config.ts ${path}`,
        );
    }
  }
  return { verifyGates, sheets };
}

main().catch((err) => {
  console.error("[gate:affected] fatal:", err);
  process.exitCode = 1;
});
