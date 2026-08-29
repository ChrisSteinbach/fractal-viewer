#!/usr/bin/env node
/**
 * Real-WebGL comparison for Solid's conservative hierarchy traversal.
 *
 * Two deterministic app instances render the same completed 192-cubed Solid
 * snapshot. The first receives the worker's hierarchy normally. An init-time
 * Worker wrapper changes only each grid event's hierarchy arm to explicit
 * `absent` in the second instance, exercising the production fallback without
 * changing its texture bytes, seed, camera, settings, or capture path.
 * App-owned PNG captures must retain identical coverage after a 64x64
 * readback; at most one output-byte delta is allowed in at most 0.1% of color
 * channels, covering the harmless f32 regrouping of a multi-step lattice jump.
 * Capture latency is printed as descriptive SwiftShader evidence, never a CI
 * timing threshold; the deterministic work-count harness prices the sparse,
 * dense, and nonlinear cases without machine noise.
 *
 * Usage: serve the app, then
 *   node scripts/solid-hierarchy.verify.mjs [--url=https://localhost:5173]
 */
import process from "node:process";
import { chromium } from "playwright-core";

const args = { url: "https://localhost:5173", captures: 5, resolution: 192 };
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--url=")) args.url = arg.slice(6);
  else if (arg.startsWith("--captures=")) args.captures = Number(arg.slice(11));
  else if (arg.startsWith("--resolution=")) {
    args.resolution = Number(arg.slice(13));
  } else throw new Error(`Unknown argument: ${arg}`);
}
args.url = args.url.replace(/\/+$/, "");
if (!Number.isInteger(args.captures) || args.captures < 1) {
  throw new RangeError("--captures must be a positive integer");
}
if (!Number.isInteger(args.resolution) || args.resolution < 32) {
  throw new RangeError("--resolution must be an integer of at least 32");
}

const env = { ...process.env };
delete env.DISPLAY;
const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  headless: false,
  env,
  args: [
    "--headless=new",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--no-sandbox",
  ],
});

async function waitFor(page, read, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${label}`);
    // A separate short protocol call leaves the page/worker event loops idle
    // between checks; one long in-page polling evaluate starves render workers.
    await page.waitForTimeout(250);
  }
}

async function renderCase(stripHierarchy) {
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 820, height: 540 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript((strip) => {
    let state = 0x12345678;
    Math.random = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };

    window.__solidHierarchyPngs = [];
    const createObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob && blob.type === "image/png") {
        window.__solidHierarchyPngs.push({ blob, at: performance.now() });
      }
      return createObjectUrl(blob);
    };

    if (!strip) return;
    const NativeWorker = Worker;
    window.Worker = class HierarchyAbsentWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (!String(url).includes("voxel-worker")) return;
        this.addEventListener("message", (event) => {
          const data = event.data;
          if (data?.type !== "grid" || data.hierarchy?.status !== "present") {
            return;
          }
          event.stopImmediatePropagation();
          this.dispatchEvent(
            new MessageEvent("message", {
              data: { ...data, hierarchy: { status: "absent" } },
            }),
          );
        });
      }
    };
  }, stripHierarchy);

  await page.goto(`${args.url}/`, { waitUntil: "load", timeout: 60_000 });
  await waitFor(
    page,
    () =>
      page.evaluate(() => {
        const text = document.getElementById("pointCount")?.textContent ?? "";
        return !/^0\s/.test(text);
      }),
    60_000,
    "the initial point cloud",
  );
  await page.evaluate((resolutionValue) => {
    const orbit = document.getElementById("autoOrbitToggle");
    if (orbit?.checked) orbit.click();
    const resolution = document.getElementById("solidResolutionSlider");
    resolution.value = String(resolutionValue);
    resolution.dispatchEvent(new Event("input", { bubbles: true }));
    const iterations = document.getElementById("solidIterationsSlider");
    iterations.value = "0";
    iterations.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("modeSolidBtn").click();
  }, args.resolution);
  await waitFor(
    page,
    () =>
      page.evaluate(() =>
        /\(100%\)/.test(
          document.getElementById("solidProgress")?.textContent ?? "",
        ),
      ),
    120_000,
    "Solid convergence",
  );

  const durations = [];
  for (let capture = 0; capture < args.captures; capture++) {
    const before = await page.evaluate(() => ({
      count: window.__solidHierarchyPngs.length,
      at: performance.now(),
    }));
    await page.evaluate(() => document.getElementById("savePngBtn").click());
    const at = await waitFor(
      page,
      () =>
        page.evaluate(
          (index) => window.__solidHierarchyPngs[index]?.at ?? null,
          before.count,
        ),
      30_000,
      `capture ${capture + 1}`,
    );
    durations.push(at - before.at);
  }

  const pixels = await page.evaluate(async () => {
    const bitmap = await createImageBitmap(window.__solidHierarchyPngs[0].blob);
    const canvas = new OffscreenCanvas(64, 64);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, 64, 64);
    return Array.from(context.getImageData(0, 0, 64, 64).data);
  });
  const balloonCompiled = await page.evaluate(() => {
    const checkbox = document.getElementById("balloonEchoCheckbox");
    if (checkbox.disabled) return false;
    if (!checkbox.checked) checkbox.click();
    return checkbox.checked;
  });
  await page.waitForTimeout(1_000);
  const renderer = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
  });
  await page.close();
  return { durations, pixels, errors, balloonCompiled, renderer };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

try {
  const accelerated = await renderCase(false);
  const fallback = await renderCase(true);
  const errors = [...accelerated.errors, ...fallback.errors];
  let changedChannels = 0;
  let maxChannelDelta = 0;
  let sumChannelDelta = 0;
  for (let index = 0; index < accelerated.pixels.length; index++) {
    const delta = Math.abs(accelerated.pixels[index] - fallback.pixels[index]);
    if (delta !== 0) changedChannels++;
    maxChannelDelta = Math.max(maxChannelDelta, delta);
    sumChannelDelta += delta;
  }
  const acceleratedMedian = median(accelerated.durations);
  const fallbackMedian = median(fallback.durations);
  console.log(
    JSON.stringify(
      {
        acceleratedMs: accelerated.durations,
        fallbackMs: fallback.durations,
        medianAcceleratedMs: acceleratedMedian,
        medianFallbackMs: fallbackMedian,
        fallbackOverAccelerated: fallbackMedian / acceleratedMedian,
        pixels: {
          changedChannels,
          maxChannelDelta,
          meanChannelDelta: sumChannelDelta / accelerated.pixels.length,
        },
        balloonCompiled: {
          accelerated: accelerated.balloonCompiled,
          fallback: fallback.balloonCompiled,
        },
        renderer: accelerated.renderer,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length > 0)
    throw new Error("Browser console/page errors occurred");
  const maxChangedChannels = Math.ceil(accelerated.pixels.length * 0.001);
  if (maxChannelDelta > 1 || changedChannels > maxChangedChannels) {
    throw new Error("Accelerated and fallback Solid captures diverge");
  }
} finally {
  await browser.close();
}
