#!/usr/bin/env node
/**
 * gpu:scratch — the seconds-scale authoring loop for WGSL kernel and
 * variation iteration. ONE scene, a small raster, the PRODUCTION
 * `SurfaceComputeRenderer` plus one eval dispatch over the bench's own query
 * plumbing, and the verdict-relevant numbers printed. NOT a gate: no
 * verdicts, no thresholds, no CI workflow references this script —
 * `bench:gpu`/`bench:surface` keep the agreement role; this answers "did my
 * kernel change the frame" while the edit is still in the editor.
 *
 * Usage:
 *   npm run gpu:scratch -- --scene=<preset-name> [--core=<id>] [--res=256]
 *   npm run gpu:scratch -- --doc='#v1=<payload>' [--core=<id>] [--res=256]
 *     [--w0=N] [--slab=N]              4D pose overrides (world units)
 *     [--budget=N]                     frame wall budget ms (default 20000)
 *     [--url=https://localhost:5173]   reuse a running dev server (the
 *                                      authoring loop's natural state); else
 *                                      `npm run dev` is spawned per run
 *     [--display=:0] [--headed] [--swiftshader] [--chrome=/path|bundled]
 *     [--out=dir]                      default scripts/out/gpu-scratch
 *     [--no-quiet]                     skip the GPU-contention baseline
 *                                      (prints UNMEASURED — the scratch's
 *                                      timings are diagnostics, not verdicts,
 *                                      but a baseline is still the default)
 *
 * The page is gpu-bench/index.html's `?scratch=1` mode — the bench's own
 * device setup, scenario plumbing and packers; there is no second wire. The
 * scene routes through `deriveSurfaceEligibility` (gpu-bench/scratch-scene.ts,
 * unit-tested) and `--core` mismatching that route refuses rather than
 * rendering a different kernel than asked.
 *
 * Exit 0 with the result JSON on stdout and the frame PNG written under
 * --out; exit 1 on any failure (scene refusal, compile error, device loss —
 * those ARE the answer to the kernel question, reported loudly).
 * Timing is NOT gated on a quiet machine beyond the printed baseline: the
 * numbers are diagnostics and carry their own conditions.
 */

import { spawn } from "node:child_process";
import https from "node:https";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { formatQuietLine, quietBaseline } from "./lib/machine-quiet.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEV_SERVER_PORT = 5173;
const DEV_SERVER_TIMEOUT_MS = 60_000;
const DEFAULT_CHROME = "/usr/bin/google-chrome";
const VITE_LOCAL_URL_RE = /Local:\s+https?:\/\/[^/\s]+:(\d+)/;

function parseArgs(argv) {
  const args = {
    scene: undefined,
    doc: undefined,
    core: undefined,
    res: "256",
    w0: undefined,
    slab: undefined,
    budget: "20000",
    url: undefined,
    display: undefined,
    headed: false,
    swiftshader: false,
    chrome: DEFAULT_CHROME,
    out: "scripts/out/gpu-scratch",
    quiet: true,
    extra: {},
  };
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      throw new Error(
        `Unrecognized argument: ${raw} (flags must start with --)`,
      );
    }
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    switch (key) {
      case "scene":
      case "doc":
      case "core":
      case "url":
      case "out":
      case "res":
      case "budget":
      case "w0":
      case "slab":
        args[key] = value;
        break;
      case "display":
        args.display = value;
        break;
      case "headed":
        args.headed = true;
        break;
      case "swiftshader":
        args.swiftshader = true;
        break;
      case "chrome":
        args.chrome = value;
        break;
      case "no-quiet":
        args.quiet = false;
        break;
      default:
        throw new Error(`Unknown flag: --${key}`);
    }
  }
  if (!args.scene && !args.doc) {
    throw new Error(
      "pass --scene=<preset-name> or --doc=<v1 payload> (a share link's #v1= fragment works as-is)",
    );
  }
  return args;
}

function pollUntilUp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = https.get(
        url,
        { rejectUnauthorized: false, timeout: 5_000 },
        (res) => {
          res.resume(); // drain — we only care that something answered.
          resolve();
        },
      );
      req.on("error", () => {
        if (Date.now() >= deadline) {
          reject(
            new Error(
              `Timed out waiting for ${url} to respond after ${timeoutMs}ms`,
            ),
          );
          return;
        }
        setTimeout(attempt, 500);
      });
      req.on("timeout", () => req.destroy());
    }
    attempt();
  });
}

/** Spawn `npm run dev` in its own process group and resolve the port Vite
 * actually announces — the gpu-flame-bench runner's pattern verbatim (a
 * fixed-port guess silently succeeds against ANOTHER server when 5173 is
 * already held, which is exactly the looks-fine-measures-wrong failure). */
function spawnDevServer() {
  const child = spawn("npm", ["run", "dev"], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let resolvePort;
  const portPromise = new Promise((resolve) => {
    resolvePort = resolve;
  });
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(`[dev-server] ${text}`);
    const match = VITE_LOCAL_URL_RE.exec(text);
    if (match) resolvePort(Number(match[1]));
  });
  child.stderr.on("data", (chunk) =>
    process.stderr.write(`[dev-server] ${chunk}`),
  );
  return { child, portPromise };
}

function killDevServer(child) {
  if (!child || child.killed || child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(REPO_ROOT, args.out);
  await mkdir(outDir, { recursive: true });

  let devServer = null;
  let base = args.url;
  if (!base) {
    console.error("[gpu-scratch] no --url given; spawning `npm run dev`...");
    const spawned = spawnDevServer();
    devServer = spawned.child;
    const announcedPort = await Promise.race([
      spawned.portPromise,
      new Promise((resolve) =>
        setTimeout(() => resolve(null), DEV_SERVER_TIMEOUT_MS),
      ),
    ]);
    base = `https://localhost:${announcedPort ?? DEV_SERVER_PORT}`;
    try {
      await pollUntilUp(`${base}/gpu-bench/index.html`, DEV_SERVER_TIMEOUT_MS);
    } catch (err) {
      killDevServer(devServer);
      throw err;
    }
    console.error(`[gpu-scratch] dev server responding at ${base}`);
  } else {
    console.error(`[gpu-scratch] using existing server at ${base}`);
  }

  // The run's conditions, printed rather than asserted. A --no-quiet run
  // spells UNMEASURED out — never silently reading as quiet.
  let quietLine = "quiet=UNMEASURED (--no-quiet)";
  if (args.quiet) {
    const quiet = await quietBaseline((line) =>
      console.error(`[gpu-scratch] ${line}`),
    );
    quietLine = formatQuietLine(quiet);
  } else {
    console.error(
      `[gpu-scratch] quiet-baseline: ${quietLine} — the timings below carry no conditions evidence`,
    );
  }

  const t0 = Date.now();
  const executablePath =
    args.chrome === "bundled" ? chromium.executablePath() : args.chrome;
  const launchFlags = [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
  ];
  if (args.swiftshader) {
    launchFlags.push(
      "--use-webgpu-adapter=swiftshader",
      "--use-vulkan=swiftshader",
    );
  }
  if (args.display !== undefined) {
    // Real-driver mode (gpu-flame-bench's x11 recipe): headed, x11, no sandbox.
    launchFlags.push("--ozone-platform=x11", "--no-sandbox");
  } else if (!args.headed) {
    launchFlags.push("--headless=new");
  }
  const browser = await chromium.launch({
    executablePath,
    headless: false,
    args: launchFlags,
    ...(args.display !== undefined
      ? { env: { ...process.env, DISPLAY: args.display } }
      : {}),
  });
  try {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 1024, height: 900 },
    });
    page.on("pageerror", (err) => {
      process.stderr.write(`[page:uncaught] ${err.stack ?? err.message}\n`);
    });

    const query = new URLSearchParams({ scratch: "1" });
    if (args.scene) query.set("scene", args.scene);
    if (args.doc) query.set("doc", args.doc);
    if (args.core) query.set("core", args.core);
    query.set("res", args.res);
    if (args.w0 !== undefined) query.set("w0", args.w0);
    if (args.slab !== undefined) query.set("slab", args.slab);
    if (args.budget !== undefined) query.set("budget", args.budget);
    const targetUrl = new URL(
      `${base}/gpu-bench/index.html?${query.toString()}`,
    ).href;
    console.error(`[gpu-scratch] navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: "load" });
    await page
      .waitForFunction(
        () =>
          window.__SCRATCH_DONE__ === true || window.__SCRATCH_ERROR__ != null,
        null,
        { timeout: 120_000, polling: 100 },
      )
      .catch(() => {
        throw new Error(
          "the scratch page published neither a result nor an error within 120s",
        );
      });
    const pageError = await page.evaluate(
      () => window.__SCRATCH_ERROR__ ?? null,
    );
    if (pageError) {
      throw new Error(`the scratch page failed: ${pageError}`);
    }
    const result = await page.evaluate(() => window.__SCRATCH__ ?? null);
    if (!result) throw new Error("the scratch page published no result");

    // The frame PNG, serialized from the canvas itself (works from a
    // minimized window — the bench runner's minimized-X11 idiom).
    const sceneTag = (args.scene ?? "doc").replace(/[^a-zA-Z0-9_-]+/g, "_");
    const pngPath = path.join(
      outDir,
      `${result.core}-${sceneTag}-${result.frame.width}.png`,
    );
    const png = await page.evaluate(() => {
      const canvas = document.getElementById("scratchFrame");
      return canvas ? canvas.toDataURL("image/png") : null;
    });
    if (png) {
      await writeFile(pngPath, Buffer.from(png.split(",")[1], "base64"));
      result.png = path.relative(REPO_ROOT, pngPath);
    }

    result.quiet = quietLine;
    result.wallMs = Date.now() - t0;
    console.log(JSON.stringify(result, null, 2));
    console.error(
      `[gpu-scratch] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — frame ${pngPath}`,
    );
  } finally {
    await browser.close();
    killDevServer(devServer);
  }
}

main().catch((err) => {
  console.error("[gpu-scratch] fatal:", err);
  process.exitCode = 1;
});
