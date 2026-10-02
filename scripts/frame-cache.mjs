#!/usr/bin/env node
/**
 * The frame cache's CLI (scripts/lib/frame-cache.mjs is the library the
 * gates import; this is the human/CI face): put, lookup, list, prune.
 *
 *   node scripts/frame-cache.mjs put   --fields=<key.json> --png=<frame.png>
 *                                      [--verdict=<verdict.json>]
 *                                      [--gate=<name>] [--scenario=<name>]
 *                                      [--root=<dir>] [--json]
 *   node scripts/frame-cache.mjs lookup (--fields=<key.json> | --hash=<hex>)
 *                                      [--root=<dir>] [--png-out=<file>]
 *                                      [--json]
 *   node scripts/frame-cache.mjs list  [--root=<dir>] [--json]
 *   node scripts/frame-cache.mjs prune [--max-bytes=<n>] [--max-age-days=<n>]
 *                                      [--root=<dir>] [--dry-run] [--json]
 *   node scripts/frame-cache.mjs hash-bundle [--dir=<dir>]
 *
 * `put` and `lookup` take the key as a JSON FILE of the nine key fields
 * (scripts/lib/frame-cache.mjs owns the list and refuses both missing and
 * unknown fields — absence is stated, never elided). `lookup` exits 0 on a
 * hit and 1 on a miss, the shell-scriptable pair; exit 2 everywhere is a
 * CHECKING failure (bad arguments, a misshapen key), this repo's convention.
 *
 * The default root is scripts/out/frame-cache/ — gitignored, regenerated,
 * never committed. `prune` keeps it bounded: 45 days of age, 1 GiB of
 * frames, corrupt and orphan entries dropped, oldest over-budget first.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  FRAME_CACHE_FIELDS,
  FRAME_CACHE_MAX_AGE_MS_DEFAULT,
  FRAME_CACHE_MAX_BYTES_DEFAULT,
  FrameCacheCheckingError,
  defaultFrameCacheRoot,
  frameCacheLookup,
  frameCacheLookupHash,
  frameCachePaths,
  frameCachePrune,
  frameCachePut,
  hashBundleDir,
} from "./lib/frame-cache.mjs";

const USAGE = `usage: node scripts/frame-cache.mjs <command> [flags]

commands:
  put   --fields=<key.json> --png=<frame.png> [--verdict=<verdict.json>]
        [--gate=<name>] [--scenario=<name>] [--root=<dir>] [--json]
  lookup (--fields=<key.json> | --hash=<hex>) [--root=<dir>]
        [--png-out=<file>] [--json]        exit 0 hit, 1 miss, 2 bad args
  list  [--root=<dir>] [--json]
  prune [--max-bytes=<n>] [--max-age-days=<n>] [--root=<dir>]
        [--dry-run] [--json]
  hash-bundle [--dir=<dir>]              hash a built bundle's bytes

The nine key fields (all required, see docs/gate-velocity.md):
  ${FRAME_CACHE_FIELDS.join(", ")}`;

function usageError(message) {
  return `${message}\n\n${USAGE}`;
}

/** PURE. Parse the CLI's arguments into `{command, flags}`. Throws with the
 * usage text on anything unexpected — every command's own flag set is
 * checked here so the executable path below only handles valid shapes. */
export function parseFrameCacheArgs(argv) {
  if (argv.length === 0) {
    throw new FrameCacheCheckingError("no command given");
  }
  const [command, ...rest] = argv;
  const commands = ["put", "lookup", "list", "prune", "hash-bundle"];
  if (!commands.includes(command)) {
    throw new FrameCacheCheckingError(`unknown command "${command}"`);
  }
  const flags = {
    fields: undefined,
    png: undefined,
    verdict: undefined,
    gate: undefined,
    scenario: undefined,
    root: undefined,
    hash: undefined,
    pngOut: undefined,
    maxBytes: undefined,
    maxAgeDays: undefined,
    dir: undefined,
    dryRun: false,
    json: false,
  };
  for (const raw of rest) {
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw : raw.slice(0, eq);
    const value = eq === -1 ? undefined : raw.slice(eq + 1);
    const bare = { "--dry-run": "dryRun", "--json": "json" };
    if (key in bare) {
      if (value !== undefined)
        throw new FrameCacheCheckingError(`${key} takes no value`);
      flags[bare[key]] = true;
      continue;
    }
    const valued = {
      "--fields": "fields",
      "--png": "png",
      "--verdict": "verdict",
      "--gate": "gate",
      "--scenario": "scenario",
      "--root": "root",
      "--hash": "hash",
      "--png-out": "pngOut",
      "--max-bytes": "maxBytes",
      "--max-age-days": "maxAgeDays",
      "--dir": "dir",
    };
    if (key in valued) {
      if (value === undefined)
        throw new FrameCacheCheckingError(`${key} needs a value`);
      flags[valued[key]] = value;
      continue;
    }
    throw new FrameCacheCheckingError(`unknown flag "${key}"`);
  }
  if (command === "put") {
    if (flags.fields === undefined || flags.png === undefined) {
      throw new FrameCacheCheckingError("put needs --fields and --png");
    }
    if (flags.gate === undefined || flags.gate === "") {
      throw new FrameCacheCheckingError("put needs --gate=<name>");
    }
    if (flags.scenario === undefined || flags.scenario === "") {
      throw new FrameCacheCheckingError("put needs --scenario=<name>");
    }
  }
  if (
    command === "lookup" &&
    flags.fields === undefined &&
    flags.hash === undefined
  ) {
    throw new FrameCacheCheckingError(
      "lookup needs --fields=<key.json> or --hash=<hex>",
    );
  }
  return { command, flags };
}

/** PURE. `1234567` → `"1.2 MiB"` — the human side of every size the CLI prints. */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return `${n} B?`;
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = n;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(1)} ${unit}`;
}

/** PURE. `<epoch>` → `"3d4h ago"` (or "just now") — the list's age column. */
export function formatAge(ms, nowMs) {
  const delta = Math.max(0, nowMs - ms);
  if (delta < 60_000) return "just now";
  const minutes = Math.floor(delta / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d${hours % 24}h ago`;
  if (hours > 0) return `${hours}h${minutes % 60}m ago`;
  return `${minutes}m ago`;
}

async function readJsonFile(filePath, label) {
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    throw new FrameCacheCheckingError(`cannot read ${label} file: ${filePath}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new FrameCacheCheckingError(
      `${label} file is not JSON: ${filePath} (${String(error?.message ?? error)})`,
    );
  }
}

async function main(argv) {
  const { command, flags } = parseFrameCacheArgs(argv);
  const root = flags.root ?? defaultFrameCacheRoot();

  if (command === "put") {
    const fields = await readJsonFile(flags.fields, "key-fields");
    let png;
    try {
      png = await fs.readFile(flags.png);
    } catch {
      throw new FrameCacheCheckingError(`cannot read --png file: ${flags.png}`);
    }
    const verdict =
      flags.verdict === undefined
        ? null
        : await readJsonFile(flags.verdict, "verdict");
    const result = await frameCachePut(root, {
      fields,
      png,
      verdict,
      meta: { gate: flags.gate, scenario: flags.scenario },
    });
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(
        `PUT ${result.hash} ${result.existed ? "(refreshed)" : "(new)"} → ${result.entryPath}`,
      );
    }
    return 0;
  }

  if (command === "lookup") {
    const hit = flags.fields
      ? await frameCacheLookup(
          root,
          await readJsonFile(flags.fields, "key-fields"),
        )
      : await frameCacheLookupHash(root, flags.hash);
    if (hit === null) {
      console.log("MISS");
      return 1;
    }
    if (flags.pngOut) {
      await fs.writeFile(flags.pngOut, hit.png);
    }
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            hit: true,
            hash: hit.hash,
            entryPath: hit.entryPath,
            entry: hit.entry,
          },
          null,
          2,
        ),
      );
    } else {
      const { gate, scenario, createdAtMs } = hit.entry.meta;
      console.log(
        `HIT ${hit.hash}  gate=${gate} scenario=${scenario} age=${formatAge(createdAtMs, Date.now())}`,
      );
      console.log(`  entry ${hit.entryPath}`);
      console.log(`  png   ${hit.pngPath} (${formatBytes(hit.png.length)})`);
    }
    return 0;
  }

  if (command === "list") {
    const rows = [];
    let shards;
    try {
      shards = await fs.readdir(root, { withFileTypes: true });
    } catch {
      console.log("(no store yet)");
      return 0;
    }
    for (const shard of shards) {
      if (!shard.isDirectory() || !/^[0-9a-f]{2}$/.test(shard.name)) continue;
      for (const name of await fs.readdir(path.join(root, shard.name))) {
        if (!name.endsWith(".json")) continue;
        const entryPath = path.join(root, shard.name, name);
        try {
          const entry = JSON.parse(await fs.readFile(entryPath, "utf8"));
          const pngPath = entryPath.replace(/\.json$/, ".png");
          const pngStat = await fs.stat(pngPath).catch(() => null);
          rows.push({
            hash: entry.key,
            gate: entry?.meta?.gate ?? "?",
            scenario: entry?.meta?.scenario ?? "?",
            createdAtMs: entry?.meta?.createdAtMs ?? 0,
            bytes:
              (pngStat?.size ?? 0) + Buffer.byteLength(JSON.stringify(entry)),
            bundle: entry?.meta?.buildHash ?? entry?.fields?.bundle ?? "?",
            entryPath,
          });
        } catch {
          rows.push({
            hash: name.replace(/\.json$/, ""),
            gate: "(corrupt)",
            scenario: "(corrupt)",
            createdAtMs: 0,
            bytes: 0,
            bundle: "?",
            entryPath,
          });
        }
      }
    }
    rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
    if (flags.json) {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      const total = rows.reduce((sum, row) => sum + row.bytes, 0);
      console.log(
        `${rows.length} entr${rows.length === 1 ? "y" : "ies"}, ${formatBytes(total)}`,
      );
      for (const row of rows) {
        console.log(
          `${row.hash.slice(0, 12)}  ${formatAge(row.createdAtMs, Date.now()).padEnd(12)} ${formatBytes(row.bytes).padEnd(10)} gate=${row.gate} scenario=${row.scenario} bundle=${row.bundle.slice(0, 12)}`,
        );
      }
    }
    return 0;
  }

  if (command === "prune") {
    const maxBytes =
      flags.maxBytes === undefined
        ? FRAME_CACHE_MAX_BYTES_DEFAULT
        : Number(flags.maxBytes);
    const maxAgeDays =
      flags.maxAgeDays === undefined
        ? FRAME_CACHE_MAX_AGE_MS_DEFAULT / (24 * 60 * 60 * 1000)
        : Number(flags.maxAgeDays);
    if (!Number.isFinite(maxBytes) || maxBytes < 0) {
      throw new FrameCacheCheckingError(
        `--max-bytes must be a non-negative number (got ${JSON.stringify(flags.maxBytes)})`,
      );
    }
    if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
      throw new FrameCacheCheckingError(
        `--max-age-days must be a non-negative number (got ${JSON.stringify(flags.maxAgeDays)})`,
      );
    }
    const result = await frameCachePrune(root, {
      maxBytes,
      maxAgeMs: maxAgeDays * 24 * 60 * 60 * 1000,
      dryRun: flags.dryRun,
    });
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const byReason = new Map();
      for (const row of result.removed) {
        byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
      }
      const reasons = [...byReason.entries()]
        .map(([r, n]) => `${r}: ${n}`)
        .join(", ");
      console.log(
        `prune ${flags.dryRun ? "(dry run) " : ""}removed ${result.removed.length}${reasons ? ` (${reasons})` : ""}, kept ${result.kept}; ${formatBytes(result.bytesBefore)} → ${formatBytes(result.bytesAfter)}`,
      );
    }
    return 0;
  }

  if (command === "hash-bundle") {
    const dir = flags.dir ?? "dist/app";
    const hash = await hashBundleDir(dir);
    console.log(hash);
    return 0;
  }

  throw new FrameCacheCheckingError(`unreachable command ${command}`);
}

const invoked = process.argv[1]?.endsWith("frame-cache.mjs");
if (invoked) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      if (error instanceof FrameCacheCheckingError) {
        console.error(usageError(error.message));
        process.exitCode = 2;
      } else {
        console.error(error?.stack ?? String(error));
        process.exitCode = 1;
      }
    });
}
