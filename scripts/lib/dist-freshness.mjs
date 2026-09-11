/**
 * REFUSES TO MEASURE A STALE BUNDLE.
 *
 * The browser gates under `scripts/` drive `dist/` through `vite preview` and
 * never build it. Their headers say "build and preview first", which makes a
 * rebuild the CALLER'S job — so a gate rerun after a source edit with no
 * intervening `npm run build` silently measures the PREVIOUS bundle. Nothing
 * fails; the numbers are just not the ones that were asked for. That is the
 * exact failure shape AGENTS.md already warns about one layer up for
 * `--display=:0` falling back to SwiftShader without a cookie, and it is the
 * leading explanation for a fix that kept "not working" across the window
 * between an observation and the bundle it was measured against.
 *
 * So this is a REFUSAL, not a warning. A warning in a long log is exactly as
 * easy to miss as the thing it warns about. Exit code 2, which across this
 * project's gates means the CHECKING side failed — the apparatus is wrong,
 * not the thing under test.
 *
 * WHAT COUNTS AS THE BUILD: the mtime of `dist/app/index.html`, Vite's own
 * emitted entry (`vite.config.ts` sets root `src/app`, outDir `../../dist/app`).
 * Its absence is its own refusal with its own message — "nothing has been
 * built" rather than a staleness report naming every file in the tree.
 *
 * WHAT COUNTS AS A SOURCE: everything under `src/` (which is where the Vite
 * root, its `index.html`, its `public/` assets and the whole fractal core
 * live), plus `vite.config.ts`, `tsconfig.json` (esbuild reads its `target`
 * and `useDefineForClassFields`), `package.json` and `package-lock.json`.
 * `*.test.ts` is EXCLUDED: no test file is reachable from the app entry, so
 * counting one would false-refuse a perfectly good bundle — and a false
 * refusal is a worse bug than the one this module exists to stop.
 *
 * WHAT DOES NOT GET GUARDED is decided by each caller, not here: gates that
 * drive `npm run dev` serve source directly and have no `dist/` relationship
 * at all, and `live-site.verify.mjs` checks the deployed origin. Pass the
 * gate's resolved `url` and a non-local origin skips the check on its own.
 *
 * ESCAPE HATCH: `ALLOW_STALE_DIST=1` downgrades the refusal to a one-line
 * stderr notice. Measuring an old bundle on purpose — bisecting a
 * regression, or holding a build still across a source edit — is legitimate;
 * doing it BY ACCIDENT is what the refusal is for.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Repo root, from this module's own location (scripts/lib/). */
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Vite's emitted entry — the one file whose mtime IS "when we last built". */
export const BUILT_ENTRY = "dist/app/index.html";

/** Roots walked recursively for sources. */
export const SOURCE_DIRS = Object.freeze(["src"]);

/** Individual files that feed the bundle without living under a source root. */
export const SOURCE_FILES = Object.freeze([
  "vite.config.ts",
  "tsconfig.json",
  "package.json",
  "package-lock.json",
]);

/** Directories that can never reach the bundle. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

/** Files under a source root that the bundle never imports. */
const SKIP_FILE_RE = /\.test\.ts$/;

export const ALLOW_STALE_ENV = "ALLOW_STALE_DIST";

/** Refusal raised by `assertFreshDist`. `reason` is "stale" or "missing". */
export class StaleDistError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = "StaleDistError";
    this.reason = reason;
    this.exitCode = 2;
  }
}

/**
 * PURE. Given the build's mtime and already-stat'd sources, return those
 * strictly newer than the build, newest first.
 *
 * Equal mtimes are FRESH, not stale: a build reads its sources and writes
 * afterwards, so same-millisecond is the ordinary outcome of a build that
 * just ran, never evidence of an edit it missed.
 */
export function staleSources({ builtMs, sources }) {
  return sources
    .filter((source) => source.mtimeMs > builtMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** PURE. `14:02:11` in local time — the clock the caller was watching. */
export function formatClock(ms) {
  return new Date(ms).toTimeString().slice(0, 8);
}

/** PURE. `+17m36s`, the lag between the build and an edit that outran it. */
export function formatLag(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) return `+${hours}h${minutes}m${seconds}s`;
  if (minutes > 0) return `+${minutes}m${seconds}s`;
  return `+${seconds}s`;
}

/**
 * PURE. The refusal message. Names the NEWEST offender with its lag and
 * summarises the rest as a count — a gate's log is long enough already, and
 * one file plus a number is the whole decision.
 */
export function formatStaleReport({ builtPath, builtMs, stale }) {
  const [newest, ...rest] = stale;
  // Pad the two paths to one column so `built` and `modified` line up: this
  // is read by someone who has just been told their measurement was wrong,
  // and the two timestamps are the whole point of the message.
  const width = Math.max(builtPath.length, newest.path.length);
  const lines = [
    "Refusing to measure a stale bundle (exit 2).",
    `  ${builtPath.padEnd(width)}     built ${formatClock(builtMs)}`,
    `  ${newest.path.padEnd(width)}  modified ${formatClock(newest.mtimeMs)}  (${formatLag(
      newest.mtimeMs - builtMs,
    )})`,
  ];
  if (rest.length > 0) {
    lines.push(
      `  ...and ${rest.length} more source file${
        rest.length === 1 ? "" : "s"
      } newer than the build.`,
    );
  }
  lines.push("", "Run `npm run build` and restart `npm run preview`.");
  return lines.join("\n");
}

/** PURE. The other refusal: there is no bundle to be stale. */
export function formatMissingReport({ builtPath }) {
  return [
    "Refusing to measure: nothing has been built (exit 2).",
    `  ${builtPath} is missing.`,
    "",
    "Run `npm run build` and restart `npm run preview`.",
  ].join("\n");
}

/**
 * PURE. Does this URL point at something whose freshness THIS checkout's
 * `dist/` can speak for? A deployed origin has no local build relationship,
 * so a gate pointed at one must not be refused for a local edit.
 */
export function isLocalPreviewUrl(url) {
  if (url === undefined || url === null || url === "") return true;
  let host;
  try {
    host = new URL(String(url)).hostname;
  } catch {
    // Unparseable: treat as local so a malformed --url cannot silently buy
    // an exemption from the guard.
    return true;
  }
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost")
  );
}

/** Walk one source root, returning `{path, mtimeMs}` with repo-relative paths. */
async function walkSourceDir(root, relative, out) {
  let entries;
  try {
    entries = await fs.readdir(path.join(root, relative), {
      withFileTypes: true,
    });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkSourceDir(root, rel, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILE_RE.test(entry.name)) continue;
    const stat = await fs.stat(path.join(root, rel));
    out.push({ path: rel.split(path.sep).join("/"), mtimeMs: stat.mtimeMs });
  }
  return out;
}

/** Stat every file that feeds the bundle. Repo-relative paths, unsorted. */
export async function collectBundleSources({ root = REPO_ROOT } = {}) {
  const out = [];
  for (const dir of SOURCE_DIRS) await walkSourceDir(root, dir, out);
  for (const file of SOURCE_FILES) {
    try {
      const stat = await fs.stat(path.join(root, file));
      out.push({ path: file, mtimeMs: stat.mtimeMs });
    } catch {
      // A missing optional input is not evidence of staleness.
    }
  }
  return out;
}

/**
 * Walk the real tree and throw `StaleDistError` when the built bundle is
 * older than any source, or missing outright.
 *
 * `url`, when the caller has one, exempts a non-local origin.
 */
export async function assertFreshDist({ root = REPO_ROOT, url } = {}) {
  if (!isLocalPreviewUrl(url)) return { checked: false, reason: "remote" };

  let builtMs;
  try {
    builtMs = (await fs.stat(path.join(root, BUILT_ENTRY))).mtimeMs;
  } catch {
    throw new StaleDistError(
      formatMissingReport({ builtPath: BUILT_ENTRY }),
      "missing",
    );
  }

  const sources = await collectBundleSources({ root });
  const stale = staleSources({ builtMs, sources });
  if (stale.length > 0) {
    throw new StaleDistError(
      formatStaleReport({ builtPath: BUILT_ENTRY, builtMs, stale }),
      "stale",
    );
  }
  return { checked: true, builtMs, sourceCount: sources.length };
}

/**
 * The call every gate makes. Refuses with exit 2, or — under
 * `ALLOW_STALE_DIST=1` — prints one line and carries on.
 *
 * Put it at the TOP of a gate's entry point, before any browser launches or
 * any server starts, so the refusal is immediate and costs nothing.
 */
export async function guardFreshDist(options = {}) {
  try {
    return await assertFreshDist(options);
  } catch (error) {
    if (!(error instanceof StaleDistError)) throw error;
    if (process.env[ALLOW_STALE_ENV]) {
      process.stderr.write(
        `[dist-freshness] ${ALLOW_STALE_ENV} set — measuring a ${error.reason} bundle on purpose.\n`,
      );
      return { checked: false, reason: `allowed-${error.reason}` };
    }
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
}
