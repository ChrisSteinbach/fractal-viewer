#!/usr/bin/env node
/**
 * The adaptive density-estimate port's browser gate: end-to-end PASS/FAIL
 * verification, in a real browser, that an imported Electric Sheep genome's
 * Flame settle runs its finished-frame density estimate through the GPU port
 * and gets the frame in interactive time — on BOTH engines.
 *
 * WHAT IT MEASURES. The flame worker posts `estimating` immediately before
 * the finished-frame adaptive pass and a `progress`/`sharedFrame` event when
 * the pass's frame is ready, so the phase's wall time is the distance
 * between those two worker messages (hooked by wrapping `Worker` before the
 * app loads). The same trace carries the `estimateProgress` events, so the
 * run also asserts the phase reports determinate progress that reaches its
 * total exactly — the disclosure half of the epic.
 *
 * THE BAR. The decision that chose this port states an interactive bar of
 * ~2s at 1920x950 (viewport x min(DPR, 2) at DPR 1) on the dev machine's
 * i7-1165G7 / Iris Xe — twice the measured 0.73-1.20s progressive-tick
 * cost. This script gates the GPU arm on that bar and REPORTS (does not
 * gate) the CPU arm: the CPU job is the oracle and the accepted fallback,
 * disclosed as such, not a path this port promises to make fast.
 *
 * ROUTING, NOT EXACTNESS. The bench's adaptive-display agreement leg is the
 * exactness gate (GPU output vs `adaptiveDownsampleFlame` on the same
 * histogram, both dimensions, pinned to a measured f32 tolerance); this
 * script is the seam/routing gate the bench cannot be: it proves the BUILT
 * APP, on a real imported genome, actually reaches a completed settle on the
 * chosen engine with the phase's progress disclosed. It asserts the backend
 * note names "GPU accumulation" for the GPU arm (a silent CPU fallback that
 * still settled would otherwise read as green) and "CPU accumulation" for
 * the CPU arm — the latter run in a SEPARATE, plain-headless browser with no
 * WebGPU at all, because `page.addInitScript` cannot reach inside the
 * flame WORKER, which has its own `navigator.gpu`.
 *
 * SOFTWARE ADAPTERS. A run whose adapter is software (SwiftShader) reports
 * its phase and marks it UNCERTIFIED rather than gating on the bar: the only
 * WebGPU this script can reach without a display IS software, and software
 * timing says nothing about the interactive budget. A headed `--display=:0`
 * run on real hardware is the one that gates.
 *
 *   npm run build && npm run preview &          # or the dev server
 *   node scripts/flame-adaptive.verify.mjs --display=:0
 *
 * Flags:
 *   --url=<url>        app origin, default https://localhost:4173
 *   --display=:N       launch the GPU arm HEADED on that X display (real
 *                      WebGPU driver); the CPU arm stays headless
 *   --swiftshader      headless GPU arm with the bundled SwiftShader Vulkan
 *                      adapter (routing+progress gate only; timing
 *                      UNCERTIFIED)
 *   --genome=<path>    the .flame genome to import; defaults to the first
 *                      Electric Sheep genome of generation 243 (the worst
 *                      row the port's decision measured)
 *   --viewport=WxH     default 1920x950 (the decision's app-realistic raster)
 *   --bar-ms=N         GPU phase bar, default 2000
 *   --keep-open        leave the browser open at the end (debugging)
 *
 * Exit 0 = every assertion held. Exit 1 = a real verdict failure (wrong
 * engine, incomplete settle, no determinate progress, GPU phase over bar on
 * a real driver). Exit 2 = a CHECKING failure (browser/network/WebGPU
 * unavailable) — rerun, it is not a verdict.
 *
 * MEASURED VERDICT (2026-09-13, i7-1165G7 / Iris Xe, headed on :0,
 * 1920x950/ss3/20M, genome electricsheep.243.02595.flam3, machine quiet=YES):
 * the GPU arm settled with a **1431ms** estimate phase against the 2000ms
 * bar (4 determinate progress events, 65,478,099,936/65,478,099,936 work
 * units; adapter "intel gen-12lp"), and the CPU arm took 15868ms (93
 * events, 10,019,567,728 units). 6/6 assertions held. The port is ~11x
 * faster on the machine and the genome the decision called the worst row;
 * the bar is met but not by a wide margin at this raster, so this gate
 * stays the measurement of record for the GPU phase.
 */
import { chromium } from "playwright-core";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";

const args = {
  url: "https://localhost:4173",
  display: undefined,
  swiftshader: false,
  genome: undefined,
  viewport: { width: 1920, height: 950 },
  barMs: 2000,
  keepOpen: false,
};
for (const arg of process.argv.slice(2)) {
  if (arg === "--keep-open") args.keepOpen = true;
  else if (arg === "--swiftshader") args.swiftshader = true;
  else if (arg.startsWith("--url=")) args.url = arg.slice(6);
  else if (arg.startsWith("--display=")) args.display = arg.slice(10);
  else if (arg.startsWith("--genome=")) args.genome = arg.slice(9);
  else if (arg.startsWith("--bar-ms=")) args.barMs = Number(arg.slice(9));
  else if (arg.startsWith("--viewport=")) {
    const [w, h] = arg
      .slice(11)
      .split("x")
      .map((p) => Number.parseInt(p, 10));
    if (w > 0 && h > 0) args.viewport = { width: w, height: h };
  } else if (!arg.startsWith("--")) args.url = arg;
}
args.url = args.url.replace(/\/+$/, "");

const log = (s) => console.log(`[flame-adaptive] ${s}`);
let passed = 0;
let failed = 0;
const ok = (s) => {
  passed++;
  log(`ok   ${s}`);
};
const bad = (s) => {
  failed++;
  log(`FAIL ${s}`);
};

/** Default genome: the alphabetically first file of generation 243 — the
 * same pick the density-estimate harness's `pickFiles(1)` makes for the
 * worst row the port's decision measured. */
function defaultGenome() {
  const corpus = "/home/christians/src/electric_sheep_genomes";
  const dir = join(corpus, "ES_gen_243");
  if (!existsSync(dir)) {
    return null;
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".flam3"))
    .sort();
  return files.length > 0 ? join(dir, files[0]) : null;
}

const genome = args.genome ?? defaultGenome();
if (genome === undefined || genome === null) {
  console.error(
    "[flame-adaptive] no genome: pass --genome=<path> or place the Electric " +
      "Sheep corpus at /home/christians/src/electric_sheep_genomes",
  );
  process.exit(2);
}
if (!existsSync(genome)) {
  console.error(`[flame-adaptive] genome not found: ${genome}`);
  process.exit(2);
}

await guardFreshDist({ url: args.url });

// ── quiet baseline, taken BEFORE the browser launches (repo discipline) ──
let quiet = null;
if (args.display !== undefined) {
  quiet = await quietBaseline(log);
}
const contended = quiet !== null ? contendedReason(quiet) : null;

/** Messages from every worker on the page, timestamps and the few numeric
 * fields this gate reads. Read-only: the app's own listeners are untouched. */
const TRACE_INIT = () => {
  window.__flameTrace = [];
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(...workerArgs) {
      super(...workerArgs);
      this.addEventListener("message", (event) => {
        const data = event.data;
        if (data && typeof data === "object" && typeof data.type === "string") {
          window.__flameTrace.push({
            t: performance.now(),
            type: data.type,
            done: typeof data.done === "number" ? data.done : undefined,
            total: typeof data.total === "number" ? data.total : undefined,
          });
        }
      });
    }
  };
};

/**
 * Drive one arm on an already-open page: boot check, import through the
 * app's one import door (the .flame path arms the flame mode hint, so the
 * session enters Flame on its own once the imported cloud lands), wait for
 * `estimating` + the following frame, and read the trace.
 */
async function runArm(page, engine) {
  await page.goto(args.url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const err = document.getElementById("error");
      if (err && (err.textContent || "").trim().length) return true;
      const el = document.getElementById("pointCount");
      if (!el) return false;
      return Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
    },
    undefined,
    { timeout: 60_000, polling: 200 },
  );

  await page.setInputFiles("#importFileInput", genome);
  await page.waitForFunction(
    () => {
      const note = document.getElementById("flameBackendNote");
      return !!note && (note.textContent || "").trim().length > 0;
    },
    undefined,
    { timeout: 60_000, polling: 100 },
  );
  const backendNote = (
    await page.evaluate(
      () => document.getElementById("flameBackendNote")?.textContent ?? "",
    )
  ).trim();

  // The finished frame: an `estimating` event followed by a frame event.
  // Generous timeout — the CPU arm's 20M-iteration accumulation alone
  // measured ~20s at this raster, plus its ~36s estimate.
  await page.waitForFunction(
    () => {
      const trace = window.__flameTrace ?? [];
      const start = trace.findIndex((e) => e.type === "estimating");
      if (start < 0) return false;
      return trace
        .slice(start + 1)
        .some((e) => e.type === "progress" || e.type === "sharedFrame");
    },
    undefined,
    { timeout: 600_000, polling: 200 },
  );

  const result = await page.evaluate(() => {
    const trace = window.__flameTrace ?? [];
    const start = trace.findIndex((e) => e.type === "estimating");
    const frameAt = trace.findIndex(
      (e, i) =>
        i > start && (e.type === "progress" || e.type === "sharedFrame"),
    );
    const between = trace.slice(start, frameAt + 1);
    const estimate = between.filter((e) => e.type === "estimateProgress");
    const last = estimate.at(-1);
    return {
      phaseMs: trace[frameAt].t - trace[start].t,
      estimateEvents: estimate.length,
      finalDone: last?.done ?? null,
      finalTotal: last?.total ?? null,
      monotone: estimate.every(
        (e, i) => i === 0 || e.done >= estimate[i - 1].done,
      ),
    };
  });

  const gpu = backendNote.startsWith("GPU accumulation");
  const software = /swiftshader|llvmpipe|software/i.test(backendNote);
  const engineOk =
    engine === "gpu" ? gpu : backendNote.startsWith("CPU accumulation");
  const progressOk =
    result.estimateEvents >= 1 &&
    result.finalDone === result.finalTotal &&
    result.finalTotal > 0 &&
    result.monotone;

  log(
    `${engine}: backend "${backendNote}"${software ? " (SOFTWARE)" : ""}; ` +
      `estimate ${result.phaseMs.toFixed(0)}ms over ` +
      `${result.estimateEvents} progress event(s), final ` +
      `${result.finalDone}/${result.finalTotal}`,
  );
  if (engineOk) {
    ok(`${engine} arm reached the finished frame on its own engine`);
  } else {
    bad(`${engine} arm ran on the wrong engine: "${backendNote}"`);
  }
  if (progressOk) {
    ok(`${engine} arm disclosed determinate estimate progress to its total`);
  } else {
    bad(
      `${engine} arm's estimate progress was incomplete: ` +
        `${result.estimateEvents} event(s), final ` +
        `${result.finalDone}/${result.finalTotal}, monotone ${result.monotone}`,
    );
  }
  if (engine === "gpu") {
    if (args.display !== undefined && !software && contended === null) {
      if (result.phaseMs <= args.barMs) {
        ok(
          `GPU estimate phase ${result.phaseMs.toFixed(0)}ms within the ` +
            `${args.barMs}ms bar`,
        );
      } else {
        bad(
          `GPU estimate phase ${result.phaseMs.toFixed(0)}ms over the ` +
            `${args.barMs}ms bar`,
        );
      }
    } else {
      log(
        `note GPU phase reported UNCERTIFIED (software adapter ` +
          `${software}, contended ${contended ?? "n/a"}): ` +
          `${result.phaseMs.toFixed(0)}ms`,
      );
    }
  }
  return result;
}

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
  launchFlags.push("--ozone-platform=x11", "--no-sandbox");
} else {
  launchFlags.push("--no-sandbox", "--enable-unsafe-swiftshader");
}

const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  headless: args.display === undefined,
  args: launchFlags,
  ...(args.display !== undefined
    ? { env: { ...process.env, DISPLAY: args.display } }
    : {}),
});
// The CPU arm's own browser: no WebGPU flags at all, so `navigator.gpu` is
// absent in the worker too and the session takes its documented CPU
// fallback. A separate instance because the flag set is per-launch.
const cpuBrowser = await chromium.launch({
  executablePath: chromium.executablePath(),
  headless: true,
  args: ["--no-sandbox", "--disable-features=WebGPU,Vulkan"],
});

try {
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: args.viewport,
  });
  const cpuPage = await cpuBrowser.newPage({
    ignoreHTTPSErrors: true,
    viewport: args.viewport,
  });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  cpuPage.on("pageerror", (e) => pageErrors.push(e.message));
  await page.addInitScript(TRACE_INIT);
  await cpuPage.addInitScript(TRACE_INIT);

  log(`genome ${genome}`);
  log(
    `viewport ${args.viewport.width}x${args.viewport.height}, bar ` +
      `${args.barMs}ms`,
  );

  const gpuResult = await runArm(page, "gpu");
  const cpuResult = await runArm(cpuPage, "cpu");

  const pageErrorList = pageErrors.filter((m) => !/ResizeObserver/.test(m));
  if (pageErrorList.length === 0) {
    ok("no page errors");
  } else {
    bad(`page errors: ${pageErrorList.join(" | ")}`);
  }

  log(
    `summary: GPU ${gpuResult.phaseMs.toFixed(0)}ms ` +
      `(${gpuResult.estimateEvents} events) vs CPU ` +
      `${cpuResult.phaseMs.toFixed(0)}ms (${cpuResult.estimateEvents} events)`,
  );
  if (quiet !== null) {
    log(contended !== null ? `quiet=NO contenders: ${contended}` : "quiet=YES");
  }
  log(`${passed} passed, ${failed} failed`);
  if (args.keepOpen) {
    log("--keep-open: leaving the browsers open; press Ctrl+C to exit");
    await new Promise(() => {});
  }
  process.exitCode = failed > 0 ? 1 : 0;
} catch (e) {
  console.error(`[flame-adaptive] checking failure: ${e?.stack ?? e}`);
  process.exitCode = 2;
} finally {
  if (!args.keepOpen) {
    await browser.close();
    await cpuBrowser.close();
  }
}
