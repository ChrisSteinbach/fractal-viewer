#!/usr/bin/env node
/**
 * Production-WebGL qualification for Solid's conservative hierarchy marcher.
 *
 * Each selected fixture is rendered twice through the production app. The
 * accelerated leg receives the worker's hierarchy normally; an init-time
 * Worker wrapper changes only the reference leg's grid-event hierarchy arm to
 * explicit `absent`. Both legs therefore retain the same document, seed,
 * packed RGBA volume, shader, camera, settings, and app-owned PNG path.
 *
 * Historical invocation stays valid and uses Playwright's bundled Chromium +
 * SwiftShader. Production hardware qualification is explicit:
 *
 *   node scripts/solid-hierarchy.verify.mjs \
 *     --url=https://localhost:5173 --driver=hardware --display=:0 \
 *     --fixtures=affine,nonlinear,stochastic,nonlinear4d \
 *     --outdir=bench-results/fr-qxyt.9
 *
 * `--fixture` may be repeated. Besides the built-ins above (and `default`, the
 * historical seeded boot document), a fixture can be a `v1=...` scene string
 * or a path to a JSON scene document. Results include build/browser/renderer
 * identity, convergence and effective-resolution evidence, console failures,
 * warm-up and measured capture timings, and accelerated/reference/diff PNGs.
 * The pixel gate remains the original one: at most 0.1% changed readback
 * channels and no channel delta above one byte. Timing remains descriptive.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import {
  NONLINEAR_SOLID_FIXTURE_SEED,
  canonicalTwoMapSolidSystem,
  stochasticJuliaSolidLens,
} from "../src/fractal/nonlinear-solid.fixture.ts";
import {
  comparePixelChannels,
  median,
  medianSampleIndex,
  parseSolidHierarchyVerifyArgs,
  rendererIsSoftware,
} from "./solid-hierarchy-verify-helpers.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const args = parseSolidHierarchyVerifyArgs(process.argv.slice(2));
const outDir = path.resolve(REPO_ROOT, args.outdir);
const READBACK_WIDTH = 64;
const READBACK_HEIGHT = 64;

function sceneHash(scene) {
  return `#v1=${Buffer.from(JSON.stringify(scene)).toString("base64url")}`;
}

const SCENE_BASE = {
  numPoints: 100_000,
  pointSize: 1,
  colorMode: "transform",
  renderStyle: "depthFade",
  showGuides: false,
};

const BUILTIN_FIXTURES = {
  default: {
    name: "default",
    description: "historical deterministic app boot document",
    dimension: "app default",
    seed: 0x12345678,
    hash: "",
  },
  affine: {
    name: "affine",
    description: "four-map affine tetrahedral sampled Solid",
    dimension: "3D",
    seed: NONLINEAR_SOLID_FIXTURE_SEED,
    hash: sceneHash({
      ...SCENE_BASE,
      transforms: [
        [0.46, 0.46, 0.46],
        [-0.46, -0.46, 0.46],
        [0.46, -0.46, -0.46],
        [-0.46, 0.46, -0.46],
      ].map((position) => ({
        position,
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      })),
    }),
  },
  nonlinear: {
    name: "nonlinear",
    description: "canonical two-map linear + swirl sampled Solid document",
    dimension: "3D nonlinear",
    seed: NONLINEAR_SOLID_FIXTURE_SEED,
    hash: sceneHash({
      ...SCENE_BASE,
      transforms: canonicalTwoMapSolidSystem(),
    }),
  },
  stochastic: {
    name: "stochastic",
    description: "canonical two-map document with stochastic Julia lens",
    dimension: "3D stochastic",
    seed: NONLINEAR_SOLID_FIXTURE_SEED,
    hash: sceneHash({
      ...SCENE_BASE,
      transforms: canonicalTwoMapSolidSystem(),
      finalTransform: stochasticJuliaSolidLens(),
    }),
  },
  nonlinear4d: {
    name: "nonlinear4d",
    description: "canonical linear + swirl maps with authored xw/yw extensions",
    dimension: "4D nonlinear",
    seed: NONLINEAR_SOLID_FIXTURE_SEED,
    hash: sceneHash({
      ...SCENE_BASE,
      transforms: canonicalTwoMapSolidSystem().map((transform, index) => ({
        ...transform,
        w:
          index === 0
            ? { position: 0.18, rotation: { xw: 0.2 } }
            : { position: -0.14, rotation: { yw: -0.17 } },
      })),
    }),
  },
};

function fixtureName(value, index) {
  return (
    value
      .replace(/^.*[/\\]/, "")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || `custom-${index + 1}`
  );
}

async function resolveFixture(spec, index) {
  if (Object.hasOwn(BUILTIN_FIXTURES, spec)) return BUILTIN_FIXTURES[spec];
  if (spec.startsWith("#v1=") || spec.startsWith("v1=")) {
    return {
      name: `custom-${index + 1}`,
      description: "custom encoded scene",
      dimension: "document-defined",
      seed: NONLINEAR_SOLID_FIXTURE_SEED,
      hash: spec.startsWith("#") ? spec : `#${spec}`,
    };
  }
  const filePath = path.resolve(REPO_ROOT, spec);
  const source = (await readFile(filePath, "utf8")).trim();
  if (source.startsWith("#v1=") || source.startsWith("v1=")) {
    return {
      name: fixtureName(spec, index),
      description: `encoded scene from ${path.relative(REPO_ROOT, filePath)}`,
      dimension: "document-defined",
      seed: NONLINEAR_SOLID_FIXTURE_SEED,
      hash: source.startsWith("#") ? source : `#${source}`,
    };
  }
  const parsed = JSON.parse(source);
  const scene = parsed.scene ?? parsed;
  return {
    name:
      typeof parsed.name === "string"
        ? fixtureName(parsed.name, index)
        : fixtureName(spec, index),
    description:
      parsed.description ??
      `JSON scene from ${path.relative(REPO_ROOT, filePath)}`,
    dimension: parsed.dimension ?? "document-defined",
    seed: Number.isInteger(parsed.seed)
      ? parsed.seed >>> 0
      : NONLINEAR_SOLID_FIXTURE_SEED,
    hash: sceneHash(scene),
  };
}

function gitIdentity() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function launchOptions() {
  if (args.driver === "hardware") {
    return {
      executablePath: args.chrome ?? "/usr/bin/google-chrome",
      headless: false,
      env: { ...process.env, DISPLAY: args.display },
      args: [
        "--ignore-gpu-blocklist",
        "--no-sandbox",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
      ],
    };
  }
  const env = { ...process.env };
  delete env.DISPLAY;
  return {
    executablePath:
      args.chrome === undefined || args.chrome === "bundled"
        ? chromium.executablePath()
        : args.chrome,
    headless: false,
    env,
    args: [
      "--headless=new",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--no-sandbox",
    ],
  };
}

async function waitFor(page, read, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${label}`);
    // Separate short protocol calls leave the page and worker event loops idle
    // between checks; one long in-page poll can starve render workers.
    await page.waitForTimeout(250);
  }
}

async function pngBytesAt(page, index) {
  return page.evaluate(async (captureIndex) => {
    const blob = window.__solidHierarchyPngs[captureIndex]?.blob;
    if (!(blob instanceof Blob)) throw new Error("capture PNG is absent");
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, index);
}

async function readbackAt(page, index) {
  return page.evaluate(
    async ({ captureIndex, width, height }) => {
      const blob = window.__solidHierarchyPngs[captureIndex]?.blob;
      if (!(blob instanceof Blob)) throw new Error("capture PNG is absent");
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("2D readback context is absent");
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      return Array.from(context.getImageData(0, 0, width, height).data);
    },
    { captureIndex: index, width: READBACK_WIDTH, height: READBACK_HEIGHT },
  );
}

function parseStatusEvidence(statusText, resolutionNote, requestedValue) {
  const effectiveMatch = statusText.match(/Sampled Solid · (\d+)³ voxels/);
  const fallbackMatch = statusText.match(/\(requested (\d+)³\)/);
  return {
    text: statusText,
    resolutionNote,
    requestedControl: Number(requestedValue),
    effectiveResolution: effectiveMatch ? Number(effectiveMatch[1]) : null,
    fallbackRequestedResolution: fallbackMatch
      ? Number(fallbackMatch[1])
      : null,
    converged: /· converged ·/.test(statusText),
  };
}

function validateStatusEvidence(evidence) {
  if (!evidence.converged) throw new Error("Sampled Solid did not converge");
  if (evidence.requestedControl !== args.resolution) {
    throw new Error("resolution control did not retain the requested value");
  }
  if (evidence.effectiveResolution === null) {
    throw new Error("Sampled Solid status omitted effective resolution");
  }
  if (evidence.effectiveResolution > args.resolution) {
    throw new Error("effective resolution exceeds the requested resolution");
  }
  if (
    evidence.effectiveResolution < args.resolution &&
    (evidence.fallbackRequestedResolution !== args.resolution ||
      !evidence.resolutionNote.includes(`requested ${args.resolution}³`))
  ) {
    throw new Error("resolution fallback was not disclosed consistently");
  }
}

async function renderCase(browser, fixture, stripHierarchy, leg) {
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 820, height: 540 },
    reducedMotion: "reduce",
  });
  const consoleErrors = [];
  const consoleMessages = [];
  let buildIdentity = null;
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    const entry = { type: message.type(), text: message.text() };
    consoleMessages.push(entry);
    if (message.type() === "error") consoleErrors.push(message.text());
    const match = message.text().match(/^Fractal Explorer build (.+)$/);
    if (match) buildIdentity = match[1];
  });
  await page.addInitScript(
    ({ strip, seed }) => {
      let state = seed >>> 0;
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
    },
    { strip: stripHierarchy, seed: fixture.seed },
  );

  try {
    await page.goto(`${args.url}/${fixture.hash}`, {
      waitUntil: "load",
      timeout: 60_000,
    });
    if (args.driver === "hardware") await page.bringToFront();
    await waitFor(
      page,
      () =>
        page.evaluate(() => {
          const text = document.getElementById("pointCount")?.textContent ?? "";
          return !/^0\s/.test(text);
        }),
      60_000,
      `${fixture.name}/${leg} initial point cloud`,
    );
    await page.evaluate((resolutionValue) => {
      const orbit = document.getElementById("autoOrbitToggle");
      if (orbit?.checked) orbit.click();
      const resolution = document.getElementById("solidResolutionSlider");
      if (!(resolution instanceof HTMLInputElement)) {
        throw new Error("Solid resolution control is absent");
      }
      resolution.value = String(resolutionValue);
      resolution.dispatchEvent(new Event("input", { bubbles: true }));
      const iterations = document.getElementById("solidIterationsSlider");
      if (!(iterations instanceof HTMLInputElement)) {
        throw new Error("Solid iterations control is absent");
      }
      // The standing verifier's minimum-budget convergence fixture.
      iterations.value = "0";
      iterations.dispatchEvent(new Event("input", { bubbles: true }));
      document.getElementById("modeSolidBtn")?.click();
    }, args.resolution);
    const statusText = await waitFor(
      page,
      () =>
        page.evaluate(() => {
          const text =
            document.getElementById("solidProgress")?.textContent ?? "";
          return /· converged ·/.test(text) ? text : null;
        }),
      args.timeoutMs,
      `${fixture.name}/${leg} Sampled Solid convergence`,
    );

    const statusFields = await page.evaluate(() => {
      const renderError = document.getElementById("renderError");
      return {
        resolutionNote:
          document.getElementById("solidResolutionNote")?.textContent ?? "",
        requestedValue:
          document.getElementById("solidResolutionSlider")?.value ?? "",
        pointCount: document.getElementById("pointCount")?.textContent ?? "",
        locationHash: location.hash,
        errorText:
          renderError !== null && !renderError.classList.contains("hidden")
            ? (renderError.textContent?.trim() ?? "")
            : "",
      };
    });
    const status = parseStatusEvidence(
      statusText,
      statusFields.resolutionNote,
      statusFields.requestedValue,
    );
    validateStatusEvidence(status);
    if (statusFields.errorText) {
      throw new Error(`render error banner: ${statusFields.errorText}`);
    }

    const warmupMs = [];
    const measuredMs = [];
    const capture = async (bucket, label) => {
      const before = await page.evaluate(() => ({
        count: window.__solidHierarchyPngs.length,
        at: performance.now(),
      }));
      await page.evaluate(() => document.getElementById("savePngBtn")?.click());
      const at = await waitFor(
        page,
        () =>
          page.evaluate(
            (index) => window.__solidHierarchyPngs[index]?.at ?? null,
            before.count,
          ),
        30_000,
        `${fixture.name}/${leg} ${label}`,
      );
      bucket.push(at - before.at);
    };
    for (let index = 0; index < args.warmups; index++) {
      await capture(warmupMs, `warm-up ${index + 1}`);
    }
    for (let index = 0; index < args.captures; index++) {
      await capture(measuredMs, `capture ${index + 1}`);
    }
    const medianCapture = medianSampleIndex(measuredMs);
    const captureIndex = args.warmups + medianCapture;
    const png = await pngBytesAt(page, captureIndex);
    const pixels = await readbackAt(page, captureIndex);

    const balloonCompiled = await page.evaluate(() => {
      const checkbox = document.getElementById("balloonEchoCheckbox");
      if (!(checkbox instanceof HTMLInputElement) || checkbox.disabled) {
        return false;
      }
      if (!checkbox.checked) checkbox.click();
      return checkbox.checked;
    });
    await page.waitForTimeout(1_000);
    const webgl = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2");
      if (gl === null) {
        return { api: null, vendor: null, renderer: null, version: null };
      }
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        api: "WebGL2",
        vendor: info
          ? String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL))
          : null,
        renderer: info
          ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
          : null,
        version: String(gl.getParameter(gl.VERSION)),
      };
    });
    return {
      warmupMs,
      measuredMs,
      medianMs: median(measuredMs),
      medianCapture,
      png,
      pixels,
      consoleErrors,
      consoleMessages,
      buildIdentity,
      balloonCompiled,
      renderer: webgl.renderer,
      webgl,
      status,
      pointCount: statusFields.pointCount,
      locationHash: statusFields.locationHash,
    };
  } finally {
    await page.close();
  }
}

async function makeDiffPng(browser, accelerated, reference) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ({ acceleratedPixels, referencePixels, width, height }) => {
        const output = new Uint8ClampedArray(width * height * 4);
        for (let index = 0; index < output.length; index += 4) {
          const delta = Math.max(
            Math.abs(acceleratedPixels[index] - referencePixels[index]),
            Math.abs(acceleratedPixels[index + 1] - referencePixels[index + 1]),
            Math.abs(acceleratedPixels[index + 2] - referencePixels[index + 2]),
          );
          output[index] = Math.min(255, delta * 64);
          output[index + 1] = delta === 0 ? 18 : 0;
          output[index + 2] = delta === 0 ? 28 : 0;
          output[index + 3] = 255;
        }
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("diff 2D context is absent");
        context.putImageData(new ImageData(output, width, height), 0, 0);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      },
      {
        acceleratedPixels: accelerated,
        referencePixels: reference,
        width: READBACK_WIDTH,
        height: READBACK_HEIGHT,
      },
    );
  } finally {
    await page.close();
  }
}

function publicLeg(leg, artifact) {
  return {
    warmupMs: leg.warmupMs,
    captureMs: leg.measuredMs,
    medianCaptureMs: leg.medianMs,
    medianCaptureIndex: leg.medianCapture,
    artifact,
    renderer: leg.renderer,
    webgl: leg.webgl,
    buildIdentity: leg.buildIdentity,
    status: leg.status,
    pointCount: leg.pointCount,
    locationHash: leg.locationHash,
    balloonCompiled: leg.balloonCompiled,
    consoleErrors: leg.consoleErrors,
    consoleMessages: leg.consoleMessages,
  };
}

await mkdir(outDir, { recursive: true });
const fixtures = await Promise.all(args.fixtures.map(resolveFixture));
const result = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  completedAt: null,
  verdict: "checking",
  invocation: {
    url: args.url,
    driver: args.driver,
    display: args.driver === "hardware" ? args.display : null,
    chrome:
      args.chrome ??
      (args.driver === "hardware" ? "/usr/bin/google-chrome" : "bundled"),
    resolution: args.resolution,
    warmups: args.warmups,
    captures: args.captures,
    timeoutMs: args.timeoutMs,
    fixtures: args.fixtures,
  },
  source: { gitCommit: gitIdentity(), node: process.version },
  browser: null,
  renderer: null,
  webgl: null,
  failures: [],
  fixtures: [],
};

let browser;
try {
  browser = await chromium.launch(launchOptions());
  result.browser = { version: browser.version() };
  for (const fixture of fixtures) {
    console.error(`[solid-hierarchy] ${fixture.name}: accelerated`);
    try {
      const accelerated = await renderCase(
        browser,
        fixture,
        false,
        "accelerated",
      );
      console.error(`[solid-hierarchy] ${fixture.name}: reference`);
      const reference = await renderCase(browser, fixture, true, "reference");
      if (result.renderer === null) {
        result.renderer = accelerated.renderer;
        result.webgl = accelerated.webgl;
      }
      const pixels = comparePixelChannels(accelerated.pixels, reference.pixels);
      const maxChangedChannels = Math.ceil(accelerated.pixels.length * 0.001);
      const acceleratedArtifact = `${fixture.name}-accelerated.png`;
      const referenceArtifact = `${fixture.name}-reference.png`;
      const diffArtifact = `${fixture.name}-diff.png`;
      await Promise.all([
        writeFile(
          path.join(outDir, acceleratedArtifact),
          Buffer.from(accelerated.png),
        ),
        writeFile(
          path.join(outDir, referenceArtifact),
          Buffer.from(reference.png),
        ),
        makeDiffPng(browser, accelerated.pixels, reference.pixels).then((png) =>
          writeFile(path.join(outDir, diffArtifact), Buffer.from(png)),
        ),
      ]);
      const errors = [...accelerated.consoleErrors, ...reference.consoleErrors];
      const failures = [];
      if (errors.length > 0) {
        failures.push("browser console/page errors occurred");
      }
      if (
        accelerated.buildIdentity === null ||
        reference.buildIdentity !== accelerated.buildIdentity
      ) {
        failures.push("build identity was absent or differed between legs");
      }
      if (accelerated.renderer !== reference.renderer) {
        failures.push("renderer identity differed between legs");
      }
      if (
        pixels.maxChannelDelta > 1 ||
        pixels.changedChannels > maxChangedChannels
      ) {
        failures.push("accelerated and reference Solid captures diverged");
      }
      if (!accelerated.balloonCompiled || !reference.balloonCompiled) {
        failures.push("one or both Balloon shader variants did not compile");
      }
      const row = {
        name: fixture.name,
        description: fixture.description,
        dimension: fixture.dimension,
        seed: fixture.seed,
        verdict: failures.length === 0 ? "pass" : "fail",
        failures,
        accelerated: publicLeg(accelerated, acceleratedArtifact),
        reference: publicLeg(reference, referenceArtifact),
        performance: {
          fallbackOverAccelerated: reference.medianMs / accelerated.medianMs,
        },
        pixels: {
          ...pixels,
          channels: accelerated.pixels.length,
          maxChangedChannels,
        },
        diffArtifact,
      };
      result.fixtures.push(row);
      for (const failure of failures) {
        result.failures.push(`${fixture.name}: ${failure}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.fixtures.push({
        name: fixture.name,
        description: fixture.description,
        dimension: fixture.dimension,
        seed: fixture.seed,
        verdict: "fail",
        failures: [message],
      });
      result.failures.push(`${fixture.name}: ${message}`);
    }
  }
  if (args.driver === "hardware" && rendererIsSoftware(result.renderer)) {
    result.failures.push(
      `hardware mode rejected software or unavailable renderer: ${String(result.renderer)}`,
    );
  }
} catch (error) {
  result.failures.push(error instanceof Error ? error.message : String(error));
} finally {
  if (browser !== undefined) await browser.close();
  result.completedAt = new Date().toISOString();
  result.verdict = result.failures.length === 0 ? "pass" : "fail";
  await writeFile(
    path.join(outDir, "results.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
}

console.log(JSON.stringify(result, null, 2));
if (result.verdict !== "pass") process.exitCode = 1;
