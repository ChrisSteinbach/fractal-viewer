#!/usr/bin/env node
/**
 * fr-2w5: WebGPU capability/allocation probe — the experimental half of the
 * flame GPU/CPU selection-flakiness investigation. Launches a real browser
 * and measures, from inside the page:
 *
 *  1. Adapter census: `navigator.gpu` presence, `requestAdapter()` for each
 *     power preference, adapter info + fallback-adapter flag, and the limits
 *     that gate the flame backend (`maxStorageBufferBindingSize`,
 *     `maxBufferSize`) — on the MAIN thread and inside a dedicated WORKER
 *     (the two contexts `main.ts`'s host selection cares about).
 *  2. Allocation ladder: at each size, create the exact buffer pair the
 *     flame backend creates (STORAGE|COPY_SRC histogram + MAP_READ|COPY_DST
 *     staging), wrapped in `pushErrorScope("out-of-memory")`, then actually
 *     exercise them (copyBufferToBuffer + mapAsync) — recording WHERE a
 *     too-big allocation fails (create-scope? mapAsync? silently?) and with
 *     what error type/message, per browser. This is the experiment that
 *     distinguishes "the limit guard would have caught it" from "the
 *     allocator refused an allocation the limits permit" (fr-e07's Firefox
 *     finding) and tells us whether error scopes surface it at create time.
 *
 * Usage:
 *   node scripts/gpu-probe.mjs --browser=chrome|chrome-default|chrome-headed|firefox
 *     [--chrome=/usr/bin/google-chrome] [--firefox=<path>] [--out=<file.json>]
 *
 * Browser variants:
 *   chrome          headless real Chrome with the gpu-bench flags
 *                   (--enable-unsafe-webgpu --enable-features=Vulkan
 *                   --ignore-gpu-blocklist) — the CI/bench regime.
 *   chrome-default  headless real Chrome with NO flags — whatever a default
 *                   install gives.
 *   chrome-headed   headed real Chrome, no flags — closest to a user's
 *                   desktop Chrome.
 *   firefox         Playwright's Firefox build with dom.webgpu.enabled.
 */
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium, firefox } from "playwright-core";

function parseArgs(argv) {
  const args = {
    browser: "chrome",
    chrome: "/usr/bin/google-chrome",
    firefox: path.join(
      os.homedir(),
      ".cache/ms-playwright/firefox-1532/firefox/firefox",
    ),
    flags: "",
    out: undefined,
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    if (!(key in args)) throw new Error(`Unknown flag: --${key}`);
    args[key] = value;
  }
  return args;
}

/**
 * Runs INSIDE the page. Serializable result only. `ladderMax` caps the
 * allocation ladder (bytes) so a machine with a huge adapter limit doesn't
 * try to allocate 16 GiB of staging memory.
 */
async function pageProbe(ladderMax) {
  const MIB = 1024 * 1024;

  function describeAdapterInfo(adapter) {
    const info = adapter.info ?? {};
    return {
      vendor: info.vendor ?? null,
      architecture: info.architecture ?? null,
      device: info.device ?? null,
      description: info.description ?? null,
      // isFallbackAdapter lives on the adapter in older spec revisions and
      // on info in newer ones — read both.
      isFallbackAdapter:
        (typeof adapter.isFallbackAdapter === "boolean"
          ? adapter.isFallbackAdapter
          : undefined) ??
        (typeof info.isFallbackAdapter === "boolean"
          ? info.isFallbackAdapter
          : null),
    };
  }

  function describeLimits(limits) {
    return {
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
      maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup:
        limits.maxComputeInvocationsPerWorkgroup,
    };
  }

  async function adapterCensus(gpu) {
    const census = {};
    for (const pref of ["default", "low-power", "high-performance"]) {
      const options =
        pref === "default" ? undefined : { powerPreference: pref };
      try {
        const adapter = await gpu.requestAdapter(options);
        census[pref] = adapter
          ? {
              info: describeAdapterInfo(adapter),
              limits: describeLimits(adapter.limits),
            }
          : null;
      } catch (e) {
        census[pref] = { error: String(e) };
      }
    }
    return census;
  }

  /** The allocation ladder: mirrors flame-gpu-backend.ts's buffer shapes and
   * usage exactly, at increasing sizes, instrumented with error scopes. */
  async function allocationLadder(gpu, ladderMaxBytes) {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { error: "no adapter" };
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    const uncaptured = [];
    device.onuncapturederror = (event) => {
      uncaptured.push(
        `${event.error.constructor.name}: ${event.error.message.slice(0, 200)}`,
      );
    };
    let lost = null;
    void device.lost.then((info) => {
      lost = { reason: info.reason, message: info.message };
    });

    const deviceLimits = describeLimits(device.limits);
    const sizesMiB = [128, 256, 512, 768, 1024, 1536, 2048, 3072, 4096];
    const steps = [];
    for (const sizeMiB of sizesMiB) {
      const size = sizeMiB * MIB;
      if (size > ladderMaxBytes) break;
      const overLimit =
        size > device.limits.maxStorageBufferBindingSize ||
        size > device.limits.maxBufferSize;
      const step = { sizeMiB, overReportedLimit: overLimit };
      let hist = null;
      let staging = null;
      try {
        // Create-phase, error-scoped exactly as a fixed backend would do it.
        device.pushErrorScope("validation");
        device.pushErrorScope("out-of-memory");
        hist = device.createBuffer({
          size,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        staging = device.createBuffer({
          size,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        const oomError = await device.popErrorScope();
        const validationError = await device.popErrorScope();
        step.createOom = oomError ? oomError.message.slice(0, 200) : null;
        step.createValidation = validationError
          ? validationError.message.slice(0, 200)
          : null;

        if (!oomError && !validationError) {
          // Exercise phase: the exact ops snapshot() performs.
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(hist, 0, staging, 0, size);
          device.queue.submit([encoder.finish()]);
          const mapResult = await Promise.race([
            staging
              .mapAsync(GPUMapMode.READ)
              .then(() => "ok")
              .catch((e) => `mapAsync rejected: ${String(e).slice(0, 200)}`),
            new Promise((resolve) =>
              setTimeout(() => resolve("mapAsync timeout (20s)"), 20_000),
            ),
          ]);
          step.exercise = mapResult;
          if (mapResult === "ok") {
            // Read one word so the map is genuinely realized, then unmap.
            const view = new Uint32Array(staging.getMappedRange(0, 4));
            step.firstWord = view[0];
            staging.unmap();
          }
        }
      } catch (e) {
        step.threw = String(e).slice(0, 300);
      } finally {
        try {
          hist?.destroy();
        } catch {
          /* ignore */
        }
        try {
          staging?.destroy();
        } catch {
          /* ignore */
        }
      }
      step.uncapturedSoFar = uncaptured.slice();
      step.lost = lost;
      steps.push(step);
      if (lost) break; // device gone — nothing further is meaningful.
    }

    // Solo ladder: the same sizes but ONE buffer at a time, splitting the
    // pair result into "per-buffer ceiling" vs "total-budget ceiling", and
    // STORAGE vs MAP_READ (is Chrome's wall specific to mappable staging?).
    const solo = [];
    for (const usageName of ["storage", "mapRead"]) {
      const usage =
        usageName === "storage"
          ? GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
          : GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
      for (const sizeMiB of sizesMiB) {
        const size = sizeMiB * MIB;
        if (size > ladderMaxBytes) break;
        if (
          size > device.limits.maxBufferSize ||
          (usageName === "storage" &&
            size > device.limits.maxStorageBufferBindingSize)
        )
          break;
        let buf = null;
        const entry = { usageName, sizeMiB };
        try {
          device.pushErrorScope("out-of-memory");
          buf = device.createBuffer({ size, usage });
          const oom = await device.popErrorScope();
          entry.createOom = oom ? oom.message.slice(0, 120) : null;
        } catch (e) {
          entry.threw = String(e).slice(0, 200);
        } finally {
          try {
            buf?.destroy();
          } catch {
            /* ignore */
          }
        }
        solo.push(entry);
        if (entry.createOom || entry.threw) break;
      }
    }
    device.destroy();
    return { deviceLimits, steps, solo, uncaptured, lost };
  }

  /** Same census, from inside a dedicated worker (Blob URL, like
   * probeWorkerWebGpu). */
  function workerCensus() {
    return new Promise((resolve) => {
      const code = `(${(async () => {
        const out = { hasGpu: !!navigator.gpu };
        if (navigator.gpu) {
          try {
            const adapter = await navigator.gpu.requestAdapter();
            out.adapter = adapter
              ? {
                  info: {
                    vendor: adapter.info?.vendor ?? null,
                    architecture: adapter.info?.architecture ?? null,
                    isFallbackAdapter:
                      (typeof adapter.isFallbackAdapter === "boolean"
                        ? adapter.isFallbackAdapter
                        : undefined) ??
                      adapter.info?.isFallbackAdapter ??
                      null,
                  },
                  limits: {
                    maxStorageBufferBindingSize:
                      adapter.limits.maxStorageBufferBindingSize,
                    maxBufferSize: adapter.limits.maxBufferSize,
                  },
                }
              : null;
          } catch (e) {
            out.adapterError = String(e);
          }
        }
        postMessage(out);
      }).toString()})()`;
      const blob = new Blob([code], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      const timeoutId = setTimeout(() => {
        worker.terminate();
        resolve({ timeout: true });
      }, 10_000);
      worker.onmessage = (event) => {
        clearTimeout(timeoutId);
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve(event.data);
      };
      worker.onerror = (e) => {
        clearTimeout(timeoutId);
        worker.terminate();
        resolve({ workerError: String(e.message ?? e) });
      };
    });
  }

  const result = {
    userAgent: navigator.userAgent,
    deviceMemory: navigator.deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
    screen: { width: window.screen.width, height: window.screen.height },
    hasGpu: !!navigator.gpu,
  };
  if (!navigator.gpu) return result;

  result.mainThread = await adapterCensus(navigator.gpu);
  result.worker = await workerCensus();
  result.ladder = await allocationLadder(navigator.gpu, ladderMax);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const totalRamBytes = os.totalmem();
  // Cap the ladder at half of system RAM (iGPU memory is system RAM; going
  // further just thrashes) and 4 GiB, whichever is smaller.
  const ladderMax = Math.min(totalRamBytes / 2, 4096 * 1024 * 1024);

  let browser;
  if (args.browser === "firefox") {
    browser = await firefox.launch({
      executablePath: args.firefox,
      headless: true,
      firefoxUserPrefs: {
        "dom.webgpu.enabled": true,
        "dom.webgpu.workers.enabled": true,
        "gfx.webgpu.force-enabled": true,
      },
    });
  } else {
    const headed = args.browser === "chrome-headed";
    const flags =
      args.browser === "chrome"
        ? [
            "--enable-unsafe-webgpu",
            "--enable-features=Vulkan",
            "--ignore-gpu-blocklist",
          ]
        : [];
    if (args.flags) flags.push(...args.flags.split(" "));
    // Playwright's `headless: true` launches Chrome's OLD headless mode,
    // which has no GPU stack at all (navigator.gpu never exists there) —
    // see scripts/webgl-smoke.mjs's launch recipe. NEW headless mode must
    // be requested explicitly via --headless=new with headless: false.
    if (!headed) flags.push("--headless=new");
    browser = await chromium.launch({
      executablePath: args.chrome,
      headless: false,
      args: flags,
    });
  }

  try {
    const page = await browser.newPage();
    page.on("console", (msg) =>
      process.stderr.write(`[page:${msg.type()}] ${msg.text()}\n`),
    );
    page.on("pageerror", (err) =>
      process.stderr.write(`[page:uncaught] ${err.message}\n`),
    );
    // navigator.gpu (and navigator.deviceMemory) are [SecureContext]-only;
    // about:blank in an automated launch is NOT one, so probing there
    // reports "no WebGPU" even where WebGPU works fine. file:// is a
    // potentially-trustworthy origin in both Chrome and Firefox.
    const probeHtml = path.join(os.tmpdir(), "gpu-probe-page.html");
    await writeFile(
      probeHtml,
      "<!doctype html><title>gpu-probe</title><body>probe",
    );
    await page.goto(`file://${probeHtml}`);
    process.stderr.write(
      `[gpu-probe] secureContext=${await page.evaluate(() => window.isSecureContext)}\n`,
    );
    const result = await page.evaluate(pageProbe, ladderMax);
    result.variant = args.browser;
    result.probeHost = {
      platform: os.platform(),
      totalRamGiB: Math.round(totalRamBytes / 1024 ** 3),
    };
    const json = JSON.stringify(result, null, 2);
    console.log(json);
    if (args.out) await writeFile(args.out, json);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[gpu-probe] fatal:", err);
  process.exitCode = 1;
});
