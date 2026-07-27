#!/usr/bin/env node
/**
 * fr-ck0w fold beam-width spill probe: sweeps `SURFACE_FOLD_BEAM_WIDTH`
 * (src/fractal/surface-de.ts) across a list of widths and measures
 * settled-frame GPU trace cost on the "Mandelbox KIFS" preset, to find
 * where narrowing the fold-descent frontier (docs/fold-de-performance-brief.md
 * §2 item 1) stops paying for itself.
 *
 * For each width, in order:
 *   1. Rewrite the `SURFACE_FOLD_BEAM_WIDTH = <n>;` declaration (the ORIGINAL
 *      file content is captured once at startup and restored byte-for-byte
 *      in a top-level `finally` — and from SIGINT/SIGTERM handlers, since
 *      this script leaves a shared source file transiently edited while it
 *      runs and must never exit leaving that mutation behind).
 *   2. `npm run build` (fails loudly on nonzero exit).
 *   3. Serve the build with `vite preview` on a fixed `--strictPort` (killed
 *      between widths, and on every failure path).
 *   4. Drive it with the SAME launch/scenario mechanics as
 *      `scripts/surface-fold.verify.mjs`'s x11 "preset" scenario (open the
 *      app, select "Mandelbox KIFS" from the preset menu — whose render
 *      hint auto-enters Surface mode, src/fractal/presets.ts's
 *      `PRESET_RENDER_HINTS`), with the `?surfperf` query param appended
 *      (src/app/scene.ts, fr-ck0w) so every COMPLETED surface strip job
 *      logs `[surfperf] settle complete <W>x<H> spentMs=<N>` to the
 *      console. `--mode=x11:<display>` is the only route to the REAL GPU
 *      driver on this box — headless Chromium falls back to SwiftShader
 *      regardless of ANGLE flags, which is useless for GPU-occupancy
 *      measurement.
 *   5. Collect every such line (order, spentMs, dimensions) until
 *      `--quiet-ms` has passed since the last one (with at least one
 *      seen), or `--cap-ms` elapses overall, then close the browser. The
 *      fold tracer's shader link alone is ~25s, and a single settle on a
 *      narrow-beam fold system can take MINUTES, with several settles per
 *      session (initial preview, camera-glide parking, the async
 *      empty-space-grid arrival re-settle) — both bounds default
 *      generously to allow for that.
 *   6. If that session ever logs a WebGL "context lost" line, its settle
 *      data is poison (see below) — retry the SAME width with a fresh
 *      browser (no rebuild) up to `--retries` times, keeping only a
 *      session that never lost context as the width's measurement.
 *
 * KNOWN FAILURE MODE this script defends against (found while validating
 * it, fr-ck0w): the real Mesa/Iris driver on this box intermittently loses
 * the WebGL context partway through the fold tracer's settle trace. Once
 * lost, every further GL call is a no-op, so the in-flight strip job
 * "completes" trivially and logs a normal-looking settle line with
 * spentMs≈0 — indistinguishable from a genuine fast measurement unless you
 * know to check for the context-lost console line first. Every attempt is
 * therefore watched for this and marked `contextLost`/`suspect` rather than
 * trusted, and retried per point 6 above.
 *
 * After the sweep: the original file is restored (and verified restored —
 * see below), a summary table prints, and full results (every attempt,
 * not just the winning one) land in `--out`.
 *
 * Usage:
 *   node scripts/fold-width-sweep.mjs --mode=x11::0 \
 *     [--widths=12,8,6,4,12] [--serve=preview] [--url=<existing base URL>] \
 *     [--quiet-ms=90000] [--cap-ms=720000] [--retries=3] [--port=4791] \
 *     [--out=/tmp/fold-width-sweep.json]
 *
 *   --mode      REQUIRED. x11:<display> = headed on that X display (the
 *               real driver); gpu = headless (falls back to SwiftShader in
 *               practice); sw = headless SwiftShader explicitly. Only x11
 *               produces numbers worth reading.
 *   --widths    Comma-separated SURFACE_FOLD_BEAM_WIDTH values, swept in
 *               order. Repeats are fine and expected (the default repeats
 *               12 at the end as a run-to-run noise control).
 *   --serve     "preview" (default): build + serve each width with a fresh
 *               `vite preview`. The only supported value — present so the
 *               invocation reads symmetrically with --url below.
 *   --url       Escape hatch for iterating on THIS SCRIPT's driving logic:
 *               point at an already-running server instead of building and
 *               spawning one. If that server is `npm run dev`, Vite
 *               transforms TS on demand, so the file edit still takes
 *               effect on next navigation and per-width iteration still
 *               varies the width — but this is NOT the production-build
 *               measurement path; use the default for real sweep data.
 *   --quiet-ms  Stop a width's capture this long after its last settle
 *               line, provided at least one has arrived.
 *   --cap-ms    Hard ceiling on one width's capture regardless of quiet.
 *   --retries   Max attempts per width (fresh browser, same build) when a
 *               session loses its WebGL context. If every attempt loses
 *               context, the width is recorded `contextLost: true` (using
 *               its last attempt's data, all marked suspect) and the
 *               script exits 1.
 *   --port      Fixed `vite preview --strictPort` port (must be free).
 *   --out       Where to write the full JSON results.
 *
 * This script is tooling for fr-ck0w's experiment 1, not the sweep itself —
 * another step runs the real sweep. Smoke-validate with
 * `--widths=12 --mode=x11::0`: since the shipped value already IS 12, this
 * exercises the full edit/build/serve/drive/restore pipeline as a
 * (verified) no-op rewrite without changing anything the sweep cares about.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SURFACE_DE_PATH = path.join(REPO_ROOT, "src/fractal/surface-de.ts");
const VITE_BIN = path.join(REPO_ROOT, "node_modules/vite/bin/vite.js");

/** Matches the single `export const SURFACE_FOLD_BEAM_WIDTH = <n>;`
 * declaration (src/fractal/surface-de.ts) this script rewrites per width. */
const BEAM_WIDTH_RE = /export const SURFACE_FOLD_BEAM_WIDTH = \d+;/;

/** Matches scene.ts's `[surfperf] settle complete <W>x<H> spentMs=<N>` line
 * verbatim (see scene.ts's `renderSurfaceStrips`, guarded by `SURFPERF`). */
const SURFPERF_RE =
  /^\[surfperf\] settle complete (\d+)x(\d+) spentMs=([\d.]+)$/;

function parseArgs(argv) {
  const args = {
    mode: undefined,
    widths: [12, 8, 6, 4, 12],
    serve: "preview",
    url: undefined,
    quietMs: 90_000,
    capMs: 720_000,
    retries: 3,
    port: 4791,
    out: "/tmp/fold-width-sweep.json",
  };
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      throw new Error(`Unrecognized argument: ${raw} (flags start with --)`);
    }
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    switch (key) {
      case "mode":
        args.mode = value;
        break;
      case "widths":
        args.widths = value.split(",").map((s) => {
          const n = Number(s.trim());
          if (!Number.isInteger(n) || n <= 0) {
            throw new Error(`--widths: not a positive integer: "${s}"`);
          }
          return n;
        });
        if (args.widths.length === 0) {
          throw new Error("--widths: at least one width is required");
        }
        break;
      case "serve":
        args.serve = value;
        break;
      case "url":
        args.url = value.replace(/\/+$/, "");
        break;
      case "quiet-ms":
        args.quietMs = Number(value);
        break;
      case "cap-ms":
        args.capMs = Number(value);
        break;
      case "retries":
        args.retries = Number(value);
        if (!Number.isInteger(args.retries) || args.retries < 1) {
          throw new Error(`--retries: not a positive integer: "${value}"`);
        }
        break;
      case "port":
        args.port = Number(value);
        break;
      case "out":
        args.out = value;
        break;
      default:
        throw new Error(`Unknown flag: --${key}`);
    }
  }
  if (!args.mode) {
    throw new Error("--mode is required, e.g. --mode=x11::0");
  }
  if (!/^x11:.+/.test(args.mode) && args.mode !== "gpu" && args.mode !== "sw") {
    throw new Error(
      `--mode must be x11:<display>, gpu, or sw (got "${args.mode}")`,
    );
  }
  if (!args.url && args.serve !== "preview") {
    throw new Error(`--serve only supports "preview" (got "${args.serve}")`);
  }
  return args;
}

// ---------------------------------------------------------------------------
// surface-de.ts transient edit + restore. `originalSource` is read ONCE,
// before any edit, and every width's rewrite is derived from it directly
// (never from whatever the previous width left on disk) so restoration is
// always a plain byte-for-byte write-back, never a chain of reversals.
// ---------------------------------------------------------------------------
let originalSource = null;
let fileRestored = true;
let currentServerChild = null;
let currentBrowser = null;
let exiting = false;

function loadOriginalSource() {
  originalSource = readFileSync(SURFACE_DE_PATH, "utf8");
  if (!BEAM_WIDTH_RE.test(originalSource)) {
    throw new Error(
      "SURFACE_FOLD_BEAM_WIDTH declaration not found in surface-de.ts " +
        "— this script's regex is stale, refusing to proceed",
    );
  }
  fileRestored = true;
}

function setBeamWidth(width) {
  const edited = originalSource.replace(
    BEAM_WIDTH_RE,
    `export const SURFACE_FOLD_BEAM_WIDTH = ${width};`,
  );
  writeFileSync(SURFACE_DE_PATH, edited);
  fileRestored = false;
  console.error(
    `[fold-sweep] surface-de.ts: SURFACE_FOLD_BEAM_WIDTH = ${width}`,
  );
}

function restoreSurfaceDe() {
  if (originalSource === null || fileRestored) return;
  writeFileSync(SURFACE_DE_PATH, originalSource);
  fileRestored = true;
  console.error("[fold-sweep] surface-de.ts restored to its original content");
}

function cleanupForSignal(signal, exitCode) {
  return () => {
    if (exiting) return;
    exiting = true;
    console.error(`\n[fold-sweep] caught ${signal} — cleaning up before exit`);
    try {
      const proc = currentBrowser?.process?.();
      if (proc?.pid) process.kill(proc.pid, "SIGTERM");
    } catch {
      // Best-effort; the browser is not detached, so a terminal-wide signal
      // usually already reached it directly.
    }
    try {
      if (currentServerChild && currentServerChild.exitCode === null) {
        process.kill(-currentServerChild.pid, "SIGTERM");
      }
    } catch {
      // Best-effort.
    }
    try {
      restoreSurfaceDe();
    } catch (err) {
      console.error("[fold-sweep] restore FAILED during signal cleanup:", err);
    }
    process.exit(exitCode);
  };
}
process.on("SIGINT", cleanupForSignal("SIGINT", 130));
process.on("SIGTERM", cleanupForSignal("SIGTERM", 143));

// ---------------------------------------------------------------------------
// Build + serve.
// ---------------------------------------------------------------------------

function runToCompletion(cmd, args, logPrefix) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => process.stderr.write(`${logPrefix} ${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`${logPrefix} ${d}`));
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${cmd} ${args.join(" ")} exited ${code ?? `via signal ${signal}`}`,
          ),
        );
    });
  });
}

/** Spawn `vite preview` detached (own process group, like webgl-smoke.mjs's
 * dev server) so it — and anything it itself spawns — can be killed as a
 * unit between widths without touching this script's own process group. */
function spawnPreviewServer(port) {
  const child = spawn(
    process.execPath,
    [VITE_BIN, "preview", "--port", String(port), "--strictPort"],
    { cwd: REPO_ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (d) => process.stderr.write(`[preview] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[preview] ${d}`));
  return child;
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.killed) {
      resolve();
      return;
    }
    const forceTimer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(forceTimer);
      resolve();
    });
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      clearTimeout(forceTimer);
      resolve();
    }
  });
}

/** Poll `url` (ignoring the preview server's self-signed basicSsl cert)
 * until it answers, or throw after `timeoutMs` — mirrors webgl-smoke.mjs's
 * `pollUntilUp`. */
function pollUntilUp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = https.get(
        url,
        { rejectUnauthorized: false, timeout: 5_000 },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on("error", () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${url} to respond`));
          return;
        }
        setTimeout(attempt, 300);
      });
      req.on("timeout", () => req.destroy());
    }
    attempt();
  });
}

// ---------------------------------------------------------------------------
// Browser driving — launch mechanics copied verbatim from
// scripts/surface-fold.verify.mjs; scenario mechanics (preset select +
// Surface button) copied from its "preset" scenario.
// ---------------------------------------------------------------------------

function glArgsForMode(mode, env) {
  if (mode.startsWith("x11:")) {
    env.DISPLAY = mode.slice(4);
    return ["--use-gl=angle", "--use-angle=gl", "--no-sandbox"];
  } else if (mode === "gpu") {
    delete env.DISPLAY;
    return [
      "--headless=new",
      "--use-gl=angle",
      "--use-angle=gl",
      "--no-sandbox",
    ];
  }
  delete env.DISPLAY;
  return [
    "--headless=new",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--no-sandbox",
  ];
}

/** Drive one width's measurement session: launch a fresh browser, load the
 * app with `?surfperf`, select "Mandelbox KIFS" (auto-enters Surface mode
 * via its render hint), then collect settle lines until quiet or capped. */
async function driveWidth(baseUrl, mode, quietMs, capMs) {
  const env = { ...process.env };
  const glArgs = glArgsForMode(mode, env);
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false,
    env,
    args: glArgs,
  });
  currentBrowser = browser;
  const settles = [];
  const consoleErrors = [];
  let renderer = null;
  let contextLost = false;
  // "How far it got" for a retried/failed attempt — updated at each major
  // step so a context-lost-before-any-settle attempt is still legible in
  // the JSON, not indistinguishable from one that never entered Surface
  // mode at all.
  let stage = "launched";
  const runStart = Date.now();
  try {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 720 },
    });
    page.on("console", (msg) => {
      const text = msg.text();
      // Observed intermittently on this box's real Mesa/Iris driver under
      // the fold tracer's full-quality settle trace (reproduced 3 of 4
      // manual attempts while validating this script — NOT specific to any
      // one width or to a freshly-rebuilt server): the context loss makes
      // every subsequent GL call a no-op, so the in-flight strip job
      // "completes" trivially and logs a settle line with spentMs≈0. That
      // reads exactly like a real (fast) measurement unless flagged — so
      // any settle from a session that has seen this is NOT trustworthy
      // data and callers should discard/retry the whole width run.
      if (/context lost/i.test(text)) contextLost = true;
      const m = SURFPERF_RE.exec(text);
      if (m) {
        settles.push({
          tMs: Date.now() - runStart,
          width: Number(m[1]),
          height: Number(m[2]),
          spentMs: Number(m[3]),
          suspect: contextLost,
        });
        console.error(
          `[fold-sweep] settle #${settles.length}: ${m[1]}x${m[2]} spentMs=${m[3]}` +
            (contextLost ? " (SUSPECT: context lost this session)" : ""),
        );
        return;
      }
      if (msg.type() === "error" || msg.type() === "warning") {
        consoleErrors.push(`[page:${msg.type()}] ${text}`);
        console.error(`[page:${msg.type()}] ${text.slice(0, 500)}`);
      }
    });
    page.on("pageerror", (err) => {
      const line = `[page:uncaught] ${err.stack ?? err.message}`;
      consoleErrors.push(line);
      console.error(line.slice(0, 500));
    });

    const target = `${baseUrl}/?surfperf`;
    console.error(`[fold-sweep] navigating to ${target}`);
    stage = "navigating";
    await page.goto(target, { waitUntil: "load", timeout: 30_000 });
    stage = "navigated";

    renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return "(no webgl2)";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "(masked)";
    });
    console.error(`[fold-sweep] renderer: ${renderer}`);
    stage = "renderer-checked";

    await page.waitForFunction(
      () =>
        Number(
          (document.getElementById("pointCount")?.textContent || "").replace(
            /[^\d]/g,
            "",
          ),
        ) > 0,
      undefined,
      { timeout: 30_000, polling: 100 },
    );
    console.error("[fold-sweep] cloud booted");
    stage = "cloud-booted";

    await page.evaluate(() => {
      const sel = document.getElementById("presetSelect");
      sel.value = "mandelboxKifs";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    console.error("[fold-sweep] selected Mandelbox KIFS from the preset menu");
    stage = "preset-selected";

    await page.waitForTimeout(3_000);
    const btnState = await page.evaluate(() => {
      const b = document.getElementById("modeSurfaceBtn");
      return {
        disabled: b?.disabled ?? null,
        pressed: b?.getAttribute("aria-pressed"),
      };
    });
    console.error(`[fold-sweep] surface button: ${JSON.stringify(btnState)}`);
    if (btnState.disabled) {
      throw new Error(
        "Surface button disabled after selecting Mandelbox KIFS — eligibility gate tripped",
      );
    }
    if (btnState.pressed !== "true") {
      await page.evaluate(() => {
        document
          .getElementById("modeSurfaceBtn")
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      console.error(
        "[fold-sweep] clicked Surface (preset hint hadn't already entered it)",
      );
    }
    stage = "surface-entered";

    // Collect settle lines: a background `page.on("console", ...)` listener
    // does the actual capture, so this loop only needs Node-side timers —
    // it never calls back into the page, which matters because a heavy
    // settle can leave the page's own JS thread busy/fenced for minutes.
    const capDeadline = Date.now() + capMs;
    let lastHeartbeat = Date.now();
    for (;;) {
      const now = Date.now();
      if (now >= capDeadline) {
        console.error(
          `[fold-sweep] --cap-ms (${capMs}ms) reached with ${settles.length} settle(s)`,
        );
        break;
      }
      const lastSettleAt = settles.length
        ? runStart + settles[settles.length - 1].tMs
        : runStart;
      if (settles.length > 0 && now - lastSettleAt >= quietMs) {
        console.error(
          `[fold-sweep] quiet for ${quietMs}ms after ${settles.length} settle(s), stopping`,
        );
        break;
      }
      if (now - lastHeartbeat > 30_000) {
        console.error(
          `[fold-sweep] ...waiting (${((now - runStart) / 1000).toFixed(0)}s elapsed, ${settles.length} settle(s) so far)`,
        );
        lastHeartbeat = now;
      }
      stage = "collecting-settles";
      await page.waitForTimeout(2_000);
    }
    stage = "done";
  } finally {
    await browser.close().catch(() => {});
    currentBrowser = null;
  }
  return {
    stage,
    settles,
    consoleErrors,
    renderer,
    contextLost,
    runWallMs: Date.now() - runStart,
  };
}

/** Wrap {@link driveWidth} with a retry loop keyed on `contextLost`: the
 * real Mesa/Iris driver on this box intermittently loses the WebGL context
 * partway through the fold tracer's settle trace (found while validating
 * this script — see the module doc), and a session that saw that is not
 * usable data. Each attempt gets a completely fresh browser (via
 * `driveWidth`'s own launch/close) against the SAME already-built/served
 * app — no rebuild between attempts. Returns every attempt (for the JSON)
 * plus whichever one first came back clean, or `null` if none did. */
async function driveWidthWithRetries(
  baseUrl,
  mode,
  quietMs,
  capMs,
  maxRetries,
) {
  const attempts = [];
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const loadavg = os.loadavg();
    console.error(
      `[fold-sweep] attempt ${attempt}/${maxRetries} ` +
        `(loadavg ${loadavg.map((n) => n.toFixed(2)).join(", ")})`,
    );
    const attemptWallStart = Date.now();
    const outcome = await driveWidth(baseUrl, mode, quietMs, capMs);
    if (outcome.contextLost) {
      // Retroactively mark every settle from this attempt suspect: once the
      // context is known lost, nothing this session measured is trustworthy,
      // including settles logged before the context-lost line arrived.
      outcome.settles = outcome.settles.map((s) => ({ ...s, suspect: true }));
    }
    attempts.push({
      attempt,
      loadavg1: loadavg[0],
      loadavg5: loadavg[1],
      loadavg15: loadavg[2],
      attemptWallMs: Date.now() - attemptWallStart,
      ...outcome,
    });
    if (!outcome.contextLost) {
      return { attempts, success: attempts[attempts.length - 1] };
    }
    console.error(
      `[fold-sweep] attempt ${attempt} lost context` +
        (attempt < maxRetries
          ? " — retrying with a fresh browser"
          : " — no attempts left"),
    );
  }
  return { attempts, success: null };
}

// ---------------------------------------------------------------------------
// Reporting.
// ---------------------------------------------------------------------------

function printSummary(results) {
  console.error("[fold-sweep] ==== SUMMARY ====");
  console.error(
    [
      "width",
      "occurrence",
      "settles",
      "firstSpentMs",
      "lastSpentMs",
      "wallMs",
      "contextLost",
      "renderer",
    ].join("\t"),
  );
  for (const r of results) {
    const count = r.settles?.length ?? 0;
    const first = count
      ? r.settles[0].spentMs.toFixed(1)
      : r.error
        ? "ERROR"
        : "-";
    const last = count ? r.settles[count - 1].spentMs.toFixed(1) : "-";
    console.error(
      [
        r.width,
        r.occurrence,
        count,
        first,
        last,
        r.runWallMs ?? "-",
        r.contextLost ? "YES — DISCARD" : "no",
        r.renderer ?? "-",
      ].join("\t"),
    );
    if (r.error) console.error(`  ^ error: ${r.error}`);
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadOriginalSource();

  const results = [];
  try {
    for (let i = 0; i < args.widths.length; i++) {
      const width = args.widths[i];
      const occurrence =
        args.widths.slice(0, i).filter((w) => w === width).length + 1;
      console.error(
        `[fold-sweep] ==== width=${width} (${i + 1}/${args.widths.length}, occurrence ${occurrence}) ====`,
      );
      const record = { width, runIndex: i, occurrence };
      let serverChild = null;
      try {
        setBeamWidth(width);
        let baseUrl = args.url;
        if (!args.url) {
          await runToCompletion("npm", ["run", "build"], "[build]");
          serverChild = spawnPreviewServer(args.port);
          currentServerChild = serverChild;
          baseUrl = `https://localhost:${args.port}`;
          await pollUntilUp(`${baseUrl}/`, 30_000);
          console.error(`[fold-sweep] preview serving at ${baseUrl}`);
        }
        const { attempts, success } = await driveWidthWithRetries(
          baseUrl,
          args.mode,
          args.quietMs,
          args.capMs,
          args.retries,
        );
        record.attempts = attempts;
        // The canonical result for this width: the first attempt that came
        // back without a context loss, or (all attempts poisoned) the last
        // attempt — so the width still carries its most complete data,
        // clearly marked `contextLost`/`suspect` rather than silently
        // dropped.
        Object.assign(record, success ?? attempts[attempts.length - 1]);
      } catch (err) {
        record.error = err instanceof Error ? err.message : String(err);
        console.error(`[fold-sweep] width=${width} FAILED: ${record.error}`);
      } finally {
        if (serverChild) {
          await stopServer(serverChild);
          currentServerChild = null;
        }
      }
      results.push(record);
    }
  } finally {
    restoreSurfaceDe();
  }

  // Verify the restore actually landed — informational, not a hard gate,
  // since a dirty tree before this script ran would make an empty diff the
  // wrong expectation; it is what this script's OWN validation checks for.
  try {
    const diffStat = execFileSync(
      "git",
      ["diff", "--stat", "--", "src/fractal/surface-de.ts"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    ).trim();
    console.error(
      diffStat.length === 0
        ? "[fold-sweep] git diff --stat surface-de.ts: empty (clean restore confirmed)"
        : `[fold-sweep] WARNING: surface-de.ts shows a diff after restore:\n${diffStat}`,
    );
  } catch (err) {
    console.error(
      "[fold-sweep] git diff check failed (non-fatal):",
      err.message,
    );
  }

  printSummary(results);

  mkdirSync(path.dirname(args.out), { recursive: true });
  writeFileSync(
    args.out,
    JSON.stringify({ args: { ...args }, results }, null, 2),
  );
  console.error(`[fold-sweep] wrote ${args.out}`);

  const anyBad = results.some(
    (r) => r.error || r.contextLost || (r.settles?.length ?? 0) === 0,
  );
  if (anyBad) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[fold-sweep] fatal:", err);
  try {
    restoreSurfaceDe();
  } catch {
    // Already logged by restoreSurfaceDe's own callers if this fails too.
  }
  process.exitCode = 1;
});
