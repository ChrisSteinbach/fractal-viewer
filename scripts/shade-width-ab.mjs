#!/usr/bin/env node
/**
 * Shade-probe-width A/B: measures whether the new width-1 shading probe DE
 * (src/app/surface-material.ts's `SURFACE_SHADE_DE_WIDTH`, the WebGL twin
 * of the compute path's probe-width verdict) actually costs less than the
 * pre-change full-width descent, on the REAL Mesa/Iris driver.
 *
 * The A/B knob is the `?surfshadewidth=N` runtime query flag, not a source
 * edit: `resolveShadeDeWidth` (surface-material.ts) reads it once at module
 * load, and N equal to `SURFACE_FOLD_BEAM_WIDTH` (currently 12) short-circuits
 * `foldProbeGlsl`/`foldValueFormGlsl` to skip emitting the probe variant
 * entirely, reproducing the pre-change fragment source byte for byte. That
 * means arms 12 (baseline) and 1 (shipped treatment) are a perfect A/B pair
 * on a SINGLE build+serve — unlike scripts/fold-width-sweep.mjs, which must
 * rebuild per point because its knob (`SURFACE_FOLD_BEAM_WIDTH`) is baked
 * into the source at build time. This script therefore has NO file-edit/
 * restore machinery at all: it builds once (unless `--url` skips that too),
 * serves once, and varies only the per-session URL.
 *
 * Mechanics borrowed verbatim from two sibling scripts:
 *   - scripts/fold-width-sweep.mjs: browser launch (playwright-core
 *     chromium, `executablePath`, DISPLAY/mode handling, GL args), preset
 *     scenario driving (pointCount wait, #presetSelect -> mandelboxKifs,
 *     #modeSurfaceBtn), the console listener's context-lost detection +
 *     retroactive all-suspect marking + per-session retry loop
 *     (`driveSessionWithRetries`, this script's twin of `driveWidthWithRetries`),
 *     quiet-ms/cap-ms stop conditions with a 30s heartbeat, vite preview
 *     spawn/stop/`pollUntilUp`, SIGINT/SIGTERM cleanup, JSON-out + summary
 *     table style.
 *   - scripts/surface-fold.verify.mjs: the "hash" scenario (its
 *     `BOXFOLD_HASH` deep-link constant, copied verbatim) and how an extra
 *     query string is inserted BEFORE the `#v1=` scene hash rather than
 *     appended after it.
 *
 * Per session (one browser, one scenario x arm x repeat point), the console
 * listener collects:
 *   (a) every raw `[surfperf]`-prefixed line, with a timestamp, into
 *       `rawSurfperf` — a catch-all so lines this script doesn't parse
 *       structurally (e.g. scene.ts's heavy-strip warnings) are still on
 *       record;
 *   (b) settle lines (`[surfperf] settle complete <W>x<H> spentMs=<N> ...`)
 *       parsed into `settles`, suspect-flagged like fold-width-sweep.mjs.
 *       The regex is deliberately NOT end-anchored: the strip-pump safety
 *       pass added trailing ` wall=/strips=/polls=/calls=/presents=` fields
 *       after `spentMs=` that fold-width-sweep.mjs's own end-anchored regex
 *       would choke on;
 *   (c) link/compile lines (`[surfperf] surface compileAsync ms=<N>
 *       khr=<0|1>`, this A/B's own gate metric for the fold program's Mesa
 *       link cost) parsed into `linkEvents` — a session can log more than
 *       one if the program recompiles, so every occurrence is kept, not
 *       just the first;
 *   (d) the context-lost flag, exactly as fold-width-sweep.mjs: any
 *       "context lost" line marks the whole session's settles suspect
 *       (retroactively, including settles logged before the line arrived)
 *       and drives a fresh-browser retry up to `--retries`;
 *   (e) console errors/warnings, collected and echoed live.
 *
 * A screenshot is taken at the end of each session (before the browser
 * closes) to `<outdir>/<scenario>-w<arm>-r<repeat>.png`, or with an
 * `-a<attempt>` suffix on any attempt beyond the first (so a context-lost
 * retry's shots don't clobber each other — the clean, unsuffixed name is
 * reserved for the common single-attempt case).
 *
 * Usage:
 *   node scripts/shade-width-ab.mjs --mode=x11::0 \
 *     [--arms=12,1] [--repeats=3] [--scenarios=preset,hash] [--port=4791] \
 *     [--url=<existing base URL>] [--quiet-ms=90000] [--cap-ms=720000] \
 *     [--retries=3] [--out=/tmp/shade-width-ab.json] \
 *     [--outdir=/tmp/shade-width-ab-shots]
 *
 *   --mode       REQUIRED. x11:<display> = headed on that X display (the
 *                real driver); gpu = headless (falls back to SwiftShader in
 *                practice); sw = headless SwiftShader explicitly. Only x11
 *                produces numbers worth reading.
 *   --arms       Comma-separated `?surfshadewidth` values, swept innermost
 *                (see "session order" below). 12 = baseline (pre-change
 *                byte-identical shader), 1 = shipped treatment.
 *   --repeats    How many times to repeat the full scenario x arm matrix.
 *   --scenarios  Comma-separated: preset (Mandelbox KIFS via the preset
 *                menu) and/or hash (the boxfold-pair deep link).
 *   --port       Fixed `vite preview --strictPort` port (must be free).
 *   --url        Escape hatch: point at an already-running server instead
 *                of building and spawning one — skips the one-time build
 *                entirely. Useful for iterating on THIS script.
 *   --quiet-ms   Stop a session's capture this long after its last settle
 *                line, provided at least one has arrived.
 *   --cap-ms     Hard ceiling on one session's capture regardless of quiet.
 *   --retries    Max attempts per session (fresh browser, same build) when
 *                a session loses its WebGL context.
 *   --out        Where to write the full JSON results.
 *   --outdir     Directory for per-session screenshots (created if absent).
 *
 * Session order: for repeat 1..R, for each scenario, for each arm — ARMS
 * are the innermost loop so 12/1/12/1/... interleave across the run instead
 * of running as two separated blocks. This is thermal fairness: any
 * run-to-run drift (driver warm-up, thermal throttling) then affects both
 * arms roughly equally rather than systematically favoring whichever arm
 * happened to run cooler.
 *
 * Exit code 1 if any session errored, lost context on every attempt, or
 * completed with zero settles observed.
 *
 * COLD-LINK measurement (this A/B's gate metric — first session after an
 * app update): Mesa's disk shader cache makes every link after a source's
 * first ~1.5s warm REGARDLESS of arm, silently flattening the A/B. Run
 * with `MESA_SHADER_CACHE_DISABLE=true` in the environment for genuine
 * per-session cold links — `driveSession` passes the parent env through
 * to the browser (and thus its GPU process), so the variable reaches
 * Mesa. Measured while validating this flow (Iris Xe): w12 cold
 * 25.3-26.4s vs warm ~1.5s; w1 cold 1.5s (the probe variant's link is
 * genuinely ~17x cheaper — Mesa inlines the width-12 body at every call
 * site, and the probe leaves only the march inlining it).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const VITE_BIN = path.join(REPO_ROOT, "node_modules/vite/bin/vite.js");

/** scripts/surface-fold.verify.mjs's boxfold-pair deep link, copied
 * verbatim: a 2-map pure-boxfold system whose render hint does NOT
 * auto-enter Surface mode (unlike the Mandelbox KIFS preset), so the
 * "hash" scenario drives the Surface button explicitly like "preset" does. */
const BOXFOLD_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjEsMF0sInJvdGF0aW9uIjpbMC4zLDAuMiwwXSwic2NhbGUiOlswLjQ1LDAuNDUsMC40NV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjoxfV19LHsicG9zaXRpb24iOlstMC4zNSwtMC4yLDAuM10sInJvdGF0aW9uIjpbMCwwLjUsMC4xXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjowLjl9XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwiYXhpcyI6InkifSwiZ2xvd0JyaWdodG5lc3MiOjF9";

/** Matches scene.ts's `[surfperf] settle complete <W>x<H> spentMs=<N>` line
 * PREFIX (see scene.ts's `renderSurfaceStrips`, guarded by `SURFPERF`).
 * Deliberately NOT end-anchored — the strip-pump safety pass appended
 * trailing ` wall=/strips=/polls=/calls=/presents=` fields this script
 * doesn't need to parse but must not fail to match because of. */
const SURFPERF_SETTLE_RE =
  /^\[surfperf\] settle complete (\d+)x(\d+) spentMs=([\d.]+)/;

/** Matches scene.ts's `[surfperf] surface compileAsync ms=<N> khr=<0|1>`
 * line verbatim (the fold-program link/compile timing — this
 * script's gate metric for whether the new probe variant grew the link
 * cost). */
const SURFPERF_LINK_RE =
  /^\[surfperf\] surface compileAsync ms=([\d.]+) khr=([01])$/;

function parseArgs(argv) {
  const args = {
    mode: undefined,
    arms: [12, 1],
    repeats: 3,
    scenarios: ["preset", "hash"],
    port: 4791,
    url: undefined,
    quietMs: 90_000,
    capMs: 720_000,
    retries: 3,
    out: "/tmp/shade-width-ab.json",
    outdir: "/tmp/shade-width-ab-shots",
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
      case "arms":
        args.arms = value.split(",").map((s) => {
          const n = Number(s.trim());
          if (!Number.isInteger(n) || n <= 0) {
            throw new Error(`--arms: not a positive integer: "${s}"`);
          }
          return n;
        });
        if (args.arms.length === 0) {
          throw new Error("--arms: at least one arm is required");
        }
        break;
      case "repeats":
        args.repeats = Number(value);
        if (!Number.isInteger(args.repeats) || args.repeats < 1) {
          throw new Error(`--repeats: not a positive integer: "${value}"`);
        }
        break;
      case "scenarios":
        args.scenarios = value.split(",").map((s) => s.trim());
        if (args.scenarios.length === 0) {
          throw new Error("--scenarios: at least one scenario is required");
        }
        for (const s of args.scenarios) {
          if (s !== "preset" && s !== "hash") {
            throw new Error(
              `--scenarios: unknown scenario "${s}" (must be preset or hash)`,
            );
          }
        }
        break;
      case "port":
        args.port = Number(value);
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
      case "out":
        args.out = value;
        break;
      case "outdir":
        args.outdir = value;
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
  return args;
}

// ---------------------------------------------------------------------------
// Cleanup state. No source file is ever edited by this script, so unlike
// fold-width-sweep.mjs there is nothing to restore on exit — only the
// server and browser need killing.
// ---------------------------------------------------------------------------
let currentServerChild = null;
let currentBrowser = null;
let exiting = false;

function cleanupForSignal(signal, exitCode) {
  return () => {
    if (exiting) return;
    exiting = true;
    console.error(`\n[shade-ab] caught ${signal} — cleaning up before exit`);
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
    process.exit(exitCode);
  };
}
process.on("SIGINT", cleanupForSignal("SIGINT", 130));
process.on("SIGTERM", cleanupForSignal("SIGTERM", 143));

// ---------------------------------------------------------------------------
// Build + serve (copied from fold-width-sweep.mjs — generic vite preview
// mechanics, nothing width-sweep-specific).
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

/** Spawn `vite preview` detached (own process group) so it — and anything it
 * itself spawns — can be killed as a unit at the end of the run without
 * touching this script's own process group. Serves ONCE for the whole run
 * (see module doc): the A/B knob is a URL query value, not a build input. */
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
 * `pollUntilUp` (and fold-width-sweep.mjs's copy of it). */
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
// scripts/surface-fold.verify.mjs / scripts/fold-width-sweep.mjs; scenario
// mechanics (preset select + Surface button, hash deep link) likewise.
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

/** `<outdir>/<scenario>-w<arm>-r<repeat>.png`, with an `-a<attempt>` suffix
 * on any attempt beyond the first — the common single-attempt case keeps
 * the clean name; a context-lost retry's shots get their own files instead
 * of clobbering attempt 1's. */
function screenshotPath(outdir, scenario, arm, repeat, attempt) {
  const suffix = attempt > 1 ? `-a${attempt}` : "";
  return path.join(outdir, `${scenario}-w${arm}-r${repeat}${suffix}.png`);
}

/** Drive one (scenario, arm, repeat) session's single attempt: launch a
 * fresh browser, load the app with `?surfacegl&surfperf&surfshadewidth=<arm>`
 * (plus the scenario's scene hash for "hash"), enter Surface mode, then
 * collect surfperf lines until quiet or capped. Mirrors
 * fold-width-sweep.mjs's `driveWidth`. */
async function driveSession(
  baseUrl,
  mode,
  scenario,
  arm,
  quietMs,
  capMs,
  outdir,
  repeat,
  attempt,
) {
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
  const rawSurfperf = [];
  const linkEvents = [];
  const consoleErrors = [];
  let renderer = null;
  let contextLost = false;
  // "How far it got" for a retried/failed attempt — updated at each major
  // step so a context-lost-before-any-settle attempt is still legible in
  // the JSON, not indistinguishable from one that never entered Surface
  // mode at all.
  let stage = "launched";
  let screenshot = null;
  const runStart = Date.now();
  try {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 720 },
    });
    page.on("console", (msg) => {
      const text = msg.text();
      // See fold-width-sweep.mjs's module doc: the real Mesa/Iris driver on
      // this box intermittently loses the WebGL context partway through a
      // settle trace, after which every GL call is a no-op and the
      // in-flight strip job "completes" trivially with spentMs≈0 —
      // indistinguishable from a genuinely fast measurement unless flagged.
      if (/context lost/i.test(text)) contextLost = true;
      if (text.startsWith("[surfperf]")) {
        rawSurfperf.push({ tMs: Date.now() - runStart, text });
      }
      const settleMatch = SURFPERF_SETTLE_RE.exec(text);
      if (settleMatch) {
        settles.push({
          tMs: Date.now() - runStart,
          width: Number(settleMatch[1]),
          height: Number(settleMatch[2]),
          spentMs: Number(settleMatch[3]),
          suspect: contextLost,
        });
        console.error(
          `[shade-ab] settle #${settles.length}: ${settleMatch[1]}x${settleMatch[2]} spentMs=${settleMatch[3]}` +
            (contextLost ? " (SUSPECT: context lost this session)" : ""),
        );
        return;
      }
      const linkMatch = SURFPERF_LINK_RE.exec(text);
      if (linkMatch) {
        linkEvents.push({
          tMs: Date.now() - runStart,
          ms: Number(linkMatch[1]),
          khr: Number(linkMatch[2]),
        });
        console.error(
          `[shade-ab] compileAsync: ms=${linkMatch[1]} khr=${linkMatch[2]}`,
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

    // `?surfacegl` forces the WebGL fold tracer (fold sessions otherwise
    // prefer the WebGPU compute path when an adapter exists) and
    // `?surfperf` turns on the settle/compile logging this script parses;
    // `surfshadewidth` is this script's own A/B knob. For "hash", the query
    // goes BEFORE the `#v1=` scene hash, exactly like
    // surface-fold.verify.mjs's `--query` mechanics.
    const query = `surfacegl&surfperf&surfshadewidth=${arm}`;
    const target =
      scenario === "hash"
        ? `${baseUrl}/?${query}${BOXFOLD_HASH}`
        : `${baseUrl}/?${query}`;
    console.error(`[shade-ab] navigating to ${target}`);
    stage = "navigating";
    await page.goto(target, { waitUntil: "load", timeout: 30_000 });
    stage = "navigated";

    renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return "(no webgl2)";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "(masked)";
    });
    console.error(`[shade-ab] renderer: ${renderer}`);
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
    console.error("[shade-ab] cloud booted");
    stage = "cloud-booted";

    if (scenario === "preset") {
      await page.evaluate(() => {
        const sel = document.getElementById("presetSelect");
        sel.value = "mandelboxKifs";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });
      console.error("[shade-ab] selected Mandelbox KIFS from the preset menu");
      stage = "preset-selected";
    }

    await page.waitForTimeout(3_000);
    const btnState = await page.evaluate(() => {
      const b = document.getElementById("modeSurfaceBtn");
      return {
        disabled: b?.disabled ?? null,
        pressed: b?.getAttribute("aria-pressed"),
      };
    });
    console.error(`[shade-ab] surface button: ${JSON.stringify(btnState)}`);
    if (btnState.disabled) {
      throw new Error("Surface button disabled — eligibility gate tripped");
    }
    if (btnState.pressed !== "true") {
      await page.evaluate(() => {
        document
          .getElementById("modeSurfaceBtn")
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      console.error(
        "[shade-ab] clicked Surface (scenario hadn't already entered it)",
      );
    }
    stage = "surface-entered";

    // Collect settle/link lines: a background `page.on("console", ...)`
    // listener does the actual capture, so this loop only needs Node-side
    // timers — it never calls back into the page, which matters because a
    // heavy settle can leave the page's own JS thread busy/fenced for
    // minutes.
    const capDeadline = Date.now() + capMs;
    let lastHeartbeat = Date.now();
    for (;;) {
      const now = Date.now();
      if (now >= capDeadline) {
        console.error(
          `[shade-ab] --cap-ms (${capMs}ms) reached with ${settles.length} settle(s)`,
        );
        break;
      }
      const lastSettleAt = settles.length
        ? runStart + settles[settles.length - 1].tMs
        : runStart;
      if (settles.length > 0 && now - lastSettleAt >= quietMs) {
        console.error(
          `[shade-ab] quiet for ${quietMs}ms after ${settles.length} settle(s), stopping`,
        );
        break;
      }
      if (now - lastHeartbeat > 30_000) {
        console.error(
          `[shade-ab] ...waiting (${((now - runStart) / 1000).toFixed(0)}s elapsed, ${settles.length} settle(s) so far)`,
        );
        lastHeartbeat = now;
      }
      stage = "collecting-settles";
      await page.waitForTimeout(2_000);
    }
    stage = "done";

    const shotPath = screenshotPath(outdir, scenario, arm, repeat, attempt);
    try {
      await page.screenshot({ path: shotPath });
      console.error(`[shade-ab] screenshot: ${shotPath}`);
      screenshot = shotPath;
    } catch (err) {
      console.error(`[shade-ab] screenshot FAILED: ${err.message}`);
    }
  } finally {
    await browser.close().catch(() => {});
    currentBrowser = null;
  }
  return {
    stage,
    settles,
    rawSurfperf,
    linkEvents,
    consoleErrors,
    renderer,
    contextLost,
    screenshot,
    runWallMs: Date.now() - runStart,
  };
}

/** Wrap {@link driveSession} with a retry loop keyed on `contextLost` —
 * mirrors fold-width-sweep.mjs's `driveWidthWithRetries` exactly. Each
 * attempt gets a completely fresh browser against the SAME already-built/
 * served app. A hard failure (e.g. the Surface button staying disabled)
 * throws out of `driveSession` and is NOT retried here — it propagates to
 * the caller, which records it as the session's `error`. Returns every
 * attempt (for the JSON) plus whichever one first came back clean, or
 * `null` if none did. */
async function driveSessionWithRetries(
  baseUrl,
  mode,
  scenario,
  arm,
  quietMs,
  capMs,
  maxRetries,
  outdir,
  repeat,
) {
  const attempts = [];
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const loadavg = os.loadavg();
    console.error(
      `[shade-ab] attempt ${attempt}/${maxRetries} ` +
        `(loadavg ${loadavg.map((n) => n.toFixed(2)).join(", ")})`,
    );
    const attemptWallStart = Date.now();
    const outcome = await driveSession(
      baseUrl,
      mode,
      scenario,
      arm,
      quietMs,
      capMs,
      outdir,
      repeat,
      attempt,
    );
    if (outcome.contextLost) {
      // Retroactively mark every settle from this attempt suspect: once the
      // context is known lost, nothing this session measured is
      // trustworthy, including settles logged before the context-lost line
      // arrived.
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
      `[shade-ab] attempt ${attempt} lost context` +
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

function printSummary(sessions, args) {
  console.error("[shade-ab] ==== SUMMARY ====");
  console.error(
    [
      "scenario",
      "arm",
      "sessions",
      "linkMs",
      "khr",
      "settles(first/last per session)",
      "contextLost",
    ].join("\t"),
  );
  for (const scenario of args.scenarios) {
    for (const arm of args.arms) {
      const rows = sessions.filter(
        (s) => s.scenario === scenario && s.arm === arm,
      );
      const linkMs =
        rows
          .flatMap((s) => (s.linkEvents ?? []).map((e) => e.ms.toFixed(0)))
          .join(",") || "-";
      const khr =
        rows.flatMap((s) => (s.linkEvents ?? []).map((e) => e.khr)).join(",") ||
        "-";
      const settleSummary =
        rows
          .map((s) => {
            const count = s.settles?.length ?? 0;
            if (!count) return s.error ? "ERROR" : "-";
            const first = s.settles[0].spentMs.toFixed(1);
            const last = s.settles[count - 1].spentMs.toFixed(1);
            return `${first}/${last}`;
          })
          .join(";") || "-";
      const contextLostCount = rows.filter((s) => s.contextLost).length;
      console.error(
        [
          scenario,
          arm,
          rows.length,
          linkMs,
          khr,
          settleSummary,
          contextLostCount,
        ].join("\t"),
      );
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.outdir, { recursive: true });

  const sessions = [];
  let serverChild = null;
  try {
    let baseUrl = args.url;
    if (!args.url) {
      await runToCompletion("npm", ["run", "build"], "[build]");
      serverChild = spawnPreviewServer(args.port);
      currentServerChild = serverChild;
      baseUrl = `https://localhost:${args.port}`;
      await pollUntilUp(`${baseUrl}/`, 30_000);
      console.error(`[shade-ab] preview serving at ${baseUrl}`);
    }

    // Arms innermost — see module doc's "session order" for why.
    for (let repeat = 1; repeat <= args.repeats; repeat++) {
      for (const scenario of args.scenarios) {
        for (const arm of args.arms) {
          console.error(
            `[shade-ab] ==== scenario=${scenario} arm=${arm} repeat=${repeat}/${args.repeats} ====`,
          );
          const record = { scenario, arm, repeat };
          try {
            const { attempts, success } = await driveSessionWithRetries(
              baseUrl,
              args.mode,
              scenario,
              arm,
              args.quietMs,
              args.capMs,
              args.retries,
              args.outdir,
              repeat,
            );
            record.attempts = attempts;
            // The canonical result for this session: the first attempt
            // that came back without a context loss, or (all attempts
            // poisoned) the last attempt — so the session still carries
            // its most complete data, clearly marked
            // `contextLost`/`suspect` rather than silently dropped.
            Object.assign(record, success ?? attempts[attempts.length - 1]);
          } catch (err) {
            record.error = err instanceof Error ? err.message : String(err);
            console.error(
              `[shade-ab] scenario=${scenario} arm=${arm} repeat=${repeat} FAILED: ${record.error}`,
            );
          }
          sessions.push(record);
        }
      }
    }
  } finally {
    if (serverChild) {
      await stopServer(serverChild);
      currentServerChild = null;
    }
  }

  printSummary(sessions, args);

  mkdirSync(path.dirname(args.out), { recursive: true });
  writeFileSync(
    args.out,
    JSON.stringify({ args: { ...args }, sessions }, null, 2),
  );
  console.error(`[shade-ab] wrote ${args.out}`);

  const anyBad = sessions.some(
    (s) => s.error || s.contextLost || (s.settles?.length ?? 0) === 0,
  );
  if (anyBad) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[shade-ab] fatal:", err);
  process.exitCode = 1;
});
