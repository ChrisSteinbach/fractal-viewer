#!/usr/bin/env node
/**
 * fr-npb: headless runner for the GPU-flame agreement/benchmark page
 * (src/app/gpu-bench/index.html) — the standing check that pins the
 * production WebGPU kernel (src/fractal/flame-gpu.ts) to accumulateFlame,
 * its CPU oracle. Drives the page in real Chrome via playwright-core (WebGPU
 * needs an actual browser — jsdom/Vitest can't run it), waits for the page
 * to finish every scenario, and dumps its JSON results + screenshots.
 * Ported from fr-53k's spike runner (`git show
 * spike/fr-53k-gpu-flame-accum:scripts/gpu-flame-bench.mjs`); CI-able via
 * this script's own exit code (see the `agreement` check below), which the
 * spike's throwaway version had no need for.
 *
 * Usage:
 *   node scripts/gpu-flame-bench.mjs [--duration=4] [--scenarios=a,b]
 *     [--url=https://host:port] [--headed] [--chrome=/path/to/chrome]
 *     [--swiftshader] [--out=bench-results]
 *
 * `--chrome=bundled` launches the Playwright-BUNDLED Chromium (the same
 * hermetic browser the WebGL smoke test uses) instead of a system Chrome —
 * the right choice on CI, where /usr/bin/google-chrome may not exist and the
 * bundled chrome-linux64 is the build known to ship libvk_swiftshader.so.
 * `--swiftshader` forces the WebGPU adapter onto SwiftShader (Chrome's
 * bundled software Vulkan), so a GPU-less runner still executes the REAL
 * WGSL kernels — slowly, but bit-faithfully — instead of skipping the
 * agreement check. Together they are the CI invocation (see ci.yml's
 * gpu-agreement job).
 *
 * Without --url, this spawns `npm run dev` itself and tears it down when
 * done (including on error) — the whole point being a one-shot
 * `node scripts/gpu-flame-bench.mjs` with no other setup.
 *
 * Exit code is non-zero when either the page reported a fatal error
 * (`__BENCH_ERROR__`) or the agreement check itself failed
 * (`__BENCH_RESULTS__.agreement === "fail"`) — the second is what makes this
 * script meaningful in CI: a passing exit code means the shipped kernel's
 * output statistically agrees with the CPU oracle on every scenario that ran.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/** Vite's conventional default port — used only as a last-resort fallback if
 * spawnDevServer's own stdout-announced port is somehow never seen (see its
 * doc); the normal case uses whatever port Vite actually reports. */
const DEV_SERVER_PORT = 5173;
const DEV_SERVER_TIMEOUT_MS = 60_000;
const BENCH_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_CHROME = "/usr/bin/google-chrome";

function parseArgs(argv) {
  const args = {
    duration: "4",
    scenarios: undefined,
    url: undefined,
    headed: false,
    chrome: DEFAULT_CHROME,
    swiftshader: false,
    out: "bench-results",
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
      case "duration":
        args.duration = value;
        break;
      case "scenarios":
        args.scenarios = value;
        break;
      case "url":
        args.url = value.replace(/\/+$/, "");
        break;
      case "headed":
        args.headed = true;
        break;
      case "chrome":
        args.chrome = value;
        break;
      case "swiftshader":
        args.swiftshader = true;
        break;
      case "out":
        args.out = value;
        break;
      default:
        throw new Error(`Unknown flag: --${key}`);
    }
  }
  return args;
}

/** Poll `url` (ignoring the dev server's self-signed cert) until it responds
 * with any HTTP status, or throw after `timeoutMs`. */
function pollUntilUp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = https.get(
        url,
        { rejectUnauthorized: false, timeout: 5_000 },
        (res) => {
          res.resume(); // drain and discard — we only care that something answered.
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

/** Vite's own "Local: https://host:PORT/" announcement — parsed out of its
 * stdout so this script talks to whatever port Vite ACTUALLY bound, not a
 * hardcoded guess. Matters because `npm run dev` auto-increments past 5173
 * when something else already holds it (observed in the wild: a stray dev
 * server left running from an unrelated earlier session) — polling a fixed
 * port would then silently succeed against THAT other server instead of the
 * one this script just spawned, which is exactly the kind of "looks fine,
 * measures the wrong thing" failure a benchmark script must not have. */
const VITE_LOCAL_URL_RE = /Local:\s+https?:\/\/[^/\s]+:(\d+)/;

/** Spawn `npm run dev` in its own process group (so `killDevServer` can take
 * down Vite's own child processes too, not just the `npm` wrapper). Returns
 * the child plus a promise for the port Vite reports listening on. */
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
    // Already gone — nothing to do.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A screenshot that must never fail the run — used for the timing-based
 * mid-run progress captures, which have no page hook to synchronize on and
 * can legitimately race page state (e.g. a scenario finishing early). */
async function screenshotBestEffort(page, filePath) {
  try {
    await page.screenshot({ path: filePath, fullPage: true });
    console.error(
      `[gpu-flame-bench] progress screenshot written to ${filePath}`,
    );
  } catch (err) {
    console.error(
      `[gpu-flame-bench] progress screenshot to ${filePath} failed (ignored): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(REPO_ROOT, args.out);
  await mkdir(outDir, { recursive: true });

  let devServer = null;
  let base = args.url;
  if (!base) {
    console.error(
      "[gpu-flame-bench] no --url given; spawning `npm run dev`...",
    );
    const spawned = spawnDevServer();
    devServer = spawned.child;
    // Prefer the port Vite actually announces (see spawnDevServer's doc);
    // fall back to the conventional default only if that announcement is
    // somehow never seen within the startup timeout.
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
    console.error(`[gpu-flame-bench] dev server responding at ${base}`);
  } else {
    console.error(`[gpu-flame-bench] using existing server at ${base}`);
  }

  let browser = null;
  let exitCode = 0;
  try {
    // `--chrome=bundled` resolves to the Playwright-bundled Chromium — same
    // hermetic-browser convention as scripts/webgl-smoke.mjs (see this
    // script's usage doc for when that matters).
    const executablePath =
      args.chrome === "bundled" ? chromium.executablePath() : args.chrome;
    console.error(
      `[gpu-flame-bench] launching ${executablePath} (headless=${!args.headed})`,
    );
    // Playwright's `headless: true` launches Chrome's OLD headless mode,
    // which has no GPU stack at all — navigator.gpu never exists there, so
    // the agreement check could only ever report "skipped" (fr-2w5; same
    // trap scripts/webgl-smoke.mjs documents). NEW headless mode must be
    // requested explicitly: `headless: false` stops Playwright injecting
    // the old flag, and `--headless=new` opts into the mode that keeps the
    // GPU process.
    const launchFlags = [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
    ];
    if (args.swiftshader) {
      // Force BOTH knobs onto SwiftShader: `--use-webgpu-adapter` pins
      // Dawn's adapter selection, and `--use-vulkan=swiftshader` points the
      // Vulkan feature (enabled above) at the bundled software ICD instead
      // of probing for real hardware a CI box doesn't have.
      launchFlags.push(
        "--use-webgpu-adapter=swiftshader",
        "--use-vulkan=swiftshader",
      );
    }
    if (!args.headed) launchFlags.push("--headless=new");
    browser = await chromium.launch({
      executablePath,
      headless: false,
      args: launchFlags,
    });
    // Wide enough that a scenario's three 960px canvases sit un-clipped in
    // one row — page.png would otherwise cut off the GPU/diff canvases.
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 3040, height: 1000 },
    });
    page.on("console", (msg) => {
      process.stderr.write(`[page:${msg.type()}] ${msg.text()}\n`);
    });
    page.on("pageerror", (err) => {
      process.stderr.write(`[page:uncaught] ${err.stack ?? err.message}\n`);
    });

    const query = new URLSearchParams({
      autorun: "1",
      duration: args.duration,
    });
    if (args.scenarios) query.set("scenarios", args.scenarios);
    const targetUrl = `${base}/gpu-bench/index.html?${query.toString()}`;
    console.error(`[gpu-flame-bench] navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: "load" });

    // Timing-based evidence that the activity badge actually engages: ~2s
    // should land inside the CPU-timed phase, ~8s (on the default 4s
    // duration) inside the GPU-timed phase that follows it. Best-effort —
    // there's no page hook to wait on instead, so a screenshot racing page
    // state (or a scenario finishing unusually fast/slow) must never fail
    // the run; it just means a less useful PNG.
    await sleep(2_000);
    await screenshotBestEffort(page, path.join(outDir, "progress-1.png"));
    await sleep(6_000);
    await screenshotBestEffort(page, path.join(outDir, "progress-2.png"));

    console.error(
      `[gpu-flame-bench] waiting up to ${BENCH_TIMEOUT_MS}ms for __BENCH_DONE__/__BENCH_ERROR__...`,
    );
    await page.waitForFunction(
      () =>
        window.__BENCH_DONE__ === true || window.__BENCH_ERROR__ !== undefined,
      undefined,
      { timeout: BENCH_TIMEOUT_MS, polling: 250 },
    );

    const results = await page.evaluate(() => window.__BENCH_RESULTS__ ?? null);
    const pageError = await page.evaluate(() => window.__BENCH_ERROR__ ?? null);

    const screenshotPath = path.join(outDir, "page.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.error(`[gpu-flame-bench] screenshot written to ${screenshotPath}`);

    // Per-canvas element screenshots (cpu/gpu/diff per scenario) — full-res
    // artifacts for eyeballing agreement, independent of page layout.
    for (const scenario of await page.locator(".scenario").all()) {
      const name = (await scenario.locator("h2").innerText())
        .split("—")[0]
        .trim();
      const canvases = await scenario.locator("canvas").all();
      const labels = ["cpu", "gpu", "diff"];
      for (let i = 0; i < canvases.length && i < labels.length; i++) {
        const canvasPath = path.join(outDir, `${name}-${labels[i]}.png`);
        await canvases[i].screenshot({ path: canvasPath });
      }
    }
    console.error(`[gpu-flame-bench] per-canvas screenshots written`);

    const resultsPath = path.join(outDir, "results.json");
    await writeFile(resultsPath, JSON.stringify(results, null, 2));
    console.error(`[gpu-flame-bench] results written to ${resultsPath}`);

    console.log(JSON.stringify(results, null, 2));

    if (pageError) {
      console.error(
        `[gpu-flame-bench] page reported a fatal error:\n${pageError}`,
      );
      exitCode = 1;
    }
    if (results && results.agreement === "fail") {
      console.error(
        "[gpu-flame-bench] agreement check FAILED — see each scenario's comparison.pass in results.json",
      );
      exitCode = 1;
    }
    // "skipped" means no comparison ran at all (no WebGPU adapter) — a
    // check that verified nothing must not exit green, or a CI box that
    // silently loses WebGPU keeps passing while pinning nothing.
    if (results && results.agreement === "skipped") {
      console.error(
        "[gpu-flame-bench] agreement check SKIPPED — no GPU comparison ran (no WebGPU adapter?); refusing to report success",
      );
      exitCode = 2;
    }
  } finally {
    if (browser) await browser.close();
    killDevServer(devServer);
  }
  process.exitCode = exitCode;
}

main().catch((err) => {
  console.error("[gpu-flame-bench] fatal:", err);
  process.exitCode = 1;
});
