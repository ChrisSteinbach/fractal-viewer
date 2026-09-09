#!/usr/bin/env node
/**
 * Production-browser evidence for the finite emitter-only union A = C0.
 *
 * Build and serve the app first, then run on a quiet real GPU:
 *
 *   node scripts/surface-emitter-only.verify.mjs --mode=x11::0
 *
 * --mode=sw is a software diagnostic, never release evidence. The display
 * must have its XAUTHORITY cookie; each capture rejects a software backend
 * in real-display mode. Optional: --url=https://localhost:4173,
 * --timeout=180000, --outdir=scripts/out/surface-emitter-only.
 * --only=3d-webgl-posed filters row names for diagnosis; every filtered pass
 * exits 2 and cannot be used as the complete release verdict.
 * --only=3d-webgl-classic is a separate affine tetrahedron control for the
 * shared compositor's GPU-process diagnostics; it has no emitters or B.
 *
 * Both dimensions run both engines. Two independently posed analytic shapes
 * retain distinct authored palette indices and finishes.
 * A three-sector symmetry exercises the expanded C0 records. The 4D shapes
 * mix xw and yw, and the saved view selects a nonzero, zero-thickness slice.
 * Xaos with only self-edges cannot remove a root emitter; the all-level and
 * root-containing finite bands must therefore draw the same finite union.
 * A five-step affine B schedule must change that picture; it also exceeds
 * the ordinary preview depth, so B must finish before the C0 leaf. A separate
 * Palette-source witness paints one sphere red and one blue; changing only
 * the second emitter's index must repaint that sphere while preserving the
 * first. Reusing shade slot 0 for both spheres cannot pass this witness.
 * The masks follow connected screenshot geometry, ordered by x: the app's
 * panel-aware camera placed both objects left of the canvas midpoint in the
 * first measurement, so splitting the whole canvas into halves was invalid.
 * A separate five-identity-B frontier puts two radius-0.1 spheres at x = ±0.4:
 * All levels must equal Root only even when B candidates spill the beam. No
 * future recursive-A sphere certificate may fill the gap between the spheres.
 *
 * The root-containing custom band drives live slider refusal, then Root only
 * drives select refusal. Both preserve the document and the completed frame.
 * A preloaded root-excluding band refuses entry, retains that band, and offers
 * the production recovery action. The cap legs price symmetry-expanded C0
 * records and an active schedule record independently in both dimensions.
 *
 * Draw is measured from real canvas SCREENSHOTS, never an out-of-rAF WebGL
 * readback. Completed settle, a stable frame, ray census, actual backend,
 * document-hash fidelity and console/driver health are all required. Chromium
 * GPU-process errors do not necessarily reach page console events: an early
 * run's framebuffer feedback-loop errors accompanied valid completed images
 * because the later trace overwrote the rejected background prefill. Raw
 * stderr therefore has its own gate and timestamped case/phase evidence.
 * PNGs, stderr and the compact JSON report land in the gitignored outdir,
 * including partial records on failure.
 *
 * Exit 0: real-driver pass; 2: checking failure or software diagnostic pass;
 * 3: product/gate verdict failure; 1: unexpected script error.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

import {
  decodeSceneHash,
  encodeSceneHash,
} from "./pattern-release-fixtures.mjs";
import { decodePng } from "./lib/pattern-release-artifacts.mjs";
import {
  pollSurfaceState,
  RELEASE_DEVICE_SCALE_FACTOR,
  RELEASE_VIEWPORT,
  surfaceLaunchOptions,
  SurfaceBrowserCheckingError,
} from "./lib/surface-browser-runner.mjs";

const ENGINES = ["compute", "webgl"];
const DIMENSIONS = [3, 4];
const LAST_PROBES = new WeakMap();
const DIAGNOSTICS = {
  activeCase: "startup",
  phase: "launch",
  driverErrors: [],
  pageErrors: [],
  stderr: [],
};
let stderrBuffer = "";

function chromiumStderr(chunk) {
  stderrBuffer += chunk;
  const lines = stderrBuffer.split("\n");
  stderrBuffer = lines.pop();
  for (const line of lines) {
    if (!line) continue;
    const entry = {
      time: new Date().toISOString(),
      case: DIAGNOSTICS.activeCase,
      phase: DIAGNOSTICS.phase,
      line,
    };
    DIAGNOSTICS.stderr.push(entry);
    if (
      /GL_(?:INVALID_|OUT_OF_MEMORY|CONTEXT_LOST)|device lost|validation error|uncaptured error|shader compilation failed/i.test(
        line,
      )
    ) {
      DIAGNOSTICS.driverErrors.push(entry);
    }
    process.stderr.write(`[chromium] [${entry.case}/${entry.phase}] ${line}\n`);
  }
}
const CAPTURE_STYLE =
  [
    "#panel",
    "#help",
    "#legend",
    "#menuToggle",
    "#loading",
    "#error",
    "#updateBanner",
    "#renderError",
    "#toast",
  ].join(",") + " { visibility: hidden !important; }";

// Production's compact one-part shape wire: [tag, dimensions..., pose],
// with o/r/s denoting part offset/rotation/uniform scale.
const SPHERE = ["s", 0.8, { o: [0.12, -0.06, 0.05], s: 0.9 }];
const TORUS = ["t", 0.56, 0.22, { o: [-0.08, 0.12, 0], r: [0.25, -0.15, 0.1] }];
const COMMON = {
  numPoints: 100_000,
  pointSize: 1,
  colorMode: "transform",
  colorGamma: 1,
  rampPaletteId: "legacy",
  fourDColor: "wBlueOrange",
  fourDDepthFade: false,
  renderStyle: "depthFade",
  showGuides: false,
  flame: {
    exposure: 1,
    iterations: 20_000_000,
    gamma: 2.4,
    vibrancy: 1,
    supersample: 2,
    estimatorRadius: 6,
    estimatorMinimumRadius: 0,
    estimatorCurve: 0.4,
    paletteId: "spectrum",
  },
  solid: {
    resolution: 192,
    iterations: 20_000_000,
    threshold: 0.3,
    lightAzimuth: 135,
    lightElevation: 50,
    ambient: 0.25,
    paletteId: "spectrum",
  },
  surface: {
    antialiasSamples: 1,
    lightAzimuth: 135,
    lightElevation: 50,
    ambient: 0.45,
    colorSource: "transform",
    paletteId: "spectrum",
    colorSpeed: 0.5,
  },
  glowBrightness: 1,
  balloonEcho: false,
  balloonRadius: 1.6,
  fogDensity: 0,
  fogTint: "#ffffff",
  fogTintStrength: 0,
  groundPlane: false,
  background: {
    mode: "custom",
    shape: "linear",
    top: "#000000",
    bottom: "#000000",
  },
  camera: { target: [0, 0, 0], radius: 5.2, theta: 0.75, phi: 1.12 },
};

function fixture(dimension, variant = "posed") {
  if (variant === "classic") {
    return structuredClone({
      ...COMMON,
      transforms: [
        [0.5, 0.5, 0.5],
        [0.5, -0.5, -0.5],
        [-0.5, 0.5, -0.5],
        [-0.5, -0.5, 0.5],
      ].map((position, index) => ({
        position,
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        colorIndex: index / 3,
      })),
    });
  }
  const document = structuredClone({
    ...COMMON,
    transforms: [
      {
        position: [-0.7, 0.15, 0],
        rotation: [0.15, 0.25, -0.1],
        scale: [0.7, 0.95, 0.8],
        emitter: SPHERE,
        colorIndex: 0.03,
        finish: { specular: 0.12, shininess: 8 },
      },
      {
        position: [0.75, -0.1, 0.05],
        rotation: [0.2, 0.1, 0.4],
        scale: [0.9, 0.75, 0.95],
        emitter: TORUS,
        colorIndex: 0.62,
        finish: { specular: 0.8, shininess: 64 },
      },
    ],
    symmetry: { order: 3, plane: "xz" },
    condensationDepthBand: { maxDepth: 2 },
  });
  if (dimension === 4) {
    document.transforms[0].w = { rotation: { xw: 0.55 }, position: 0.08 };
    document.transforms[1].w = { rotation: { yw: -0.5 }, position: -0.06 };
    document.fourD = {
      p: [1, 0, 0, 0],
      q: [1, 0, 0, 0],
      sliceOn: true,
      sliceCenter: 0.2,
      sliceThickness: 0,
      sliceRelColor: false,
    };
  }
  if (variant === "xaos") {
    delete document.condensationDepthBand;
    document.transforms[0].chaos = [1, 0];
    document.transforms[1].chaos = [0, 1];
  } else if (variant === "schedule") {
    document.schedule = {
      depth: 5,
      transforms: [
        {
          position: [0.19, -0.08, 0.03],
          rotation: [0, 0, 0.17],
          scale: [0.84, 0.84, 0.84],
        },
      ],
    };
  } else if (variant.startsWith("frontier") || variant.startsWith("palette")) {
    delete document.condensationDepthBand;
    document.symmetry.order = 1;
    document.camera.radius = 1.25;
    document.transforms = document.transforms.map((transform, index) => ({
      ...transform,
      position: [index === 0 ? -0.4 : 0.4, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      emitter: ["s", 0.1],
      ...(dimension === 4
        ? {
            w: { rotation: index === 0 ? { xw: 0.55 } : { yw: -0.5 } },
          }
        : {}),
    }));
    if (variant.startsWith("frontier")) {
      document.schedule = {
        depth: variant === "frontier-overflow" ? 2 : 1,
        transforms: Array.from({ length: 5 }, () => ({
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        })),
      };
    } else {
      document.surface.colorSource = "palette";
      document.surface.paletteId = "custom";
      document.customPalette = { stops: ["#ff0000", "#0000ff"] };
      document.transforms.forEach((transform, index) => {
        transform.colorIndex = variant === "palette-second" ? 0 : index;
        transform.finish = { specular: 0 };
      });
    }
  } else if (variant === "empty-band") {
    document.condensationDepthBand = { minDepth: 1, maxDepth: 2 };
  } else if (variant === "record-cap" || variant === "schedule-cap") {
    document.transforms = Array.from({ length: 8 }, (_, index) => ({
      ...structuredClone(document.transforms[index % 2]),
      position: [0.3 * Math.cos(index), 0.3 * Math.sin(index), 0],
    }));
    if (variant === "record-cap") {
      document.symmetry.order = 4; // 8 emitters x 4 sectors = 32 > 24.
    } else {
      document.schedule = {
        depth: 1,
        transforms: [
          { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
        ],
      }; // 8 emitters x 3 sectors + one B record = 25 > 24.
    }
  }
  return document;
}

function parseArgs(argv) {
  const result = {
    url: "https://localhost:4173",
    mode: "x11::0",
    timeout: 180_000,
    outdir: "scripts/out/surface-emitter-only",
    only: "",
  };
  for (const arg of argv) {
    const match = /^--([a-z]+)=(.+)$/.exec(arg);
    if (!match || !(match[1] in result))
      throw new Error(`unknown argument ${arg}`);
    result[match[1]] = match[1] === "timeout" ? Number(match[2]) : match[2];
  }
  if (result.mode !== "sw" && !/^x11:.+/.test(result.mode)) {
    throw new Error("--mode must be sw or x11:<display>");
  }
  if (!Number.isFinite(result.timeout) || result.timeout < 30_000) {
    throw new Error("--timeout must be at least 30000ms");
  }
  result.url = result.url.replace(/\/+$/, "");
  result.release = result.mode !== "sw";
  result.filter = result.only ? new RegExp(result.only) : null;
  return result;
}

function within(promise, milliseconds, description) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new SurfaceBrowserCheckingError(
              `${description} exceeded external deadline ${milliseconds}ms`,
            ),
          ),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function readDocument(page) {
  return page.evaluate(() => window.location.hash).then(decodeSceneHash);
}

async function readProductionDocument(page) {
  const encoded = await page.evaluate(() => {
    localStorage.removeItem("fractal-viewer:collection");
    document.getElementById("saveCollectionBtn")?.click();
    const raw = localStorage.getItem("fractal-viewer:collection");
    const parsed = raw ? JSON.parse(raw) : null;
    const entries = Array.isArray(parsed) ? parsed : parsed?.scenes;
    return entries?.at(-1)?.encoded ?? null;
  });
  assert.ok(
    encoded?.startsWith("v1="),
    "production collection encoder did not persist the loaded scene",
  );
  return decodeSceneHash(encoded);
}

async function boot(page, args, engine, document) {
  DIAGNOSTICS.phase = "boot";
  const query = `?surfacestate&stripdiag&${engine === "compute" ? "surfacecompute" : "surfacegl"}&surfacesamples=1`;
  await page.goto(`${args.url}/${query}${encodeSceneHash(document)}`, {
    waitUntil: "load",
    timeout: 60_000,
  });
  await page.bringToFront();
  await page.waitForFunction(
    () =>
      typeof window.__surfaceState === "function" &&
      Number(
        (document.getElementById("pointCount")?.textContent || "").replace(
          /[^\d]/g,
          "",
        ),
      ) > 0,
    undefined,
    { timeout: 60_000 },
  );
  assert.equal(
    await page.locator('script[src*="/@vite/client"]').count(),
    0,
    "gate requires a production build",
  );
  const loaded = await readProductionDocument(page);
  const expected = decodeSceneHash(encodeSceneHash(document));
  assert.deepEqual(
    loaded.transforms,
    expected.transforms,
    "fixture transforms were not accepted by the production decoder",
  );
  assert.deepEqual(
    loaded.schedule,
    expected.schedule,
    "schedule was dropped or changed",
  );
  assert.deepEqual(
    loaded.condensationDepthBand,
    expected.condensationDepthBand,
    "depth band was dropped or changed",
  );
  assert.deepEqual(
    loaded.customPalette,
    expected.customPalette,
    "palette was dropped or changed",
  );
  assert.equal(
    loaded.surface.colorSource,
    expected.surface.colorSource,
    "Surface color source was dropped or changed",
  );
  assert.equal(
    loaded.surface.paletteId,
    expected.surface.paletteId,
    "Surface palette selection was dropped or changed",
  );
  assert.equal(
    loaded.background?.top,
    "#000000",
    "draw witness requires its authored black background",
  );
  assert.equal(
    loaded.background?.bottom,
    "#000000",
    "draw witness requires its authored black background",
  );
  if (document.fourD)
    assert.equal(
      loaded.fourD?.sliceCenter,
      0.2,
      "nonzero 4D slice was dropped",
    );
}

async function enter(page) {
  DIAGNOSTICS.phase = "entry";
  const button = page.locator("#modeSurfaceBtn");
  assert.equal(
    await button.isEnabled(),
    true,
    `Surface refused: ${await button.getAttribute("title")}`,
  );
  await button.click();
}

async function settled(page, args, engine, name) {
  const deadline = Date.now() + args.timeout;
  let progress = null;
  let nextHeartbeat = 0;
  for (;;) {
    const state = await pollSurfaceState(page);
    LAST_PROBES.set(page, state);
    assert.equal(
      state.probe.mode,
      "surface",
      `${name}: Surface exited before completed settle; see captured console errors`,
    );
    if (progress !== state.rowText) {
      progress = state.rowText;
      process.stderr.write(
        `[surface-emitter-only] ${name}: ${progress || "(progress hidden)"}\n`,
      );
    }
    if (Date.now() >= nextHeartbeat) {
      nextHeartbeat = Date.now() + 15_000;
      process.stderr.write(
        `[surface-emitter-only] ${name} state: ${JSON.stringify(state.probe)}\n`,
      );
    }
    if (state.settled) {
      await page.waitForTimeout(400);
      const after = await pollSurfaceState(page);
      if (!after.settled) continue;
      assert.equal(after.probe.engine, engine, `${name}: wrong Surface engine`);
      assert.ok(
        after.probe.backend?.label,
        `${name}: backend was not disclosed`,
      );
      if (args.release)
        assert.equal(
          after.probe.backend.software,
          false,
          `${name}: software adapter is not real-driver evidence`,
        );
      const census = after.probe.census;
      assert.ok(census, `${name}: settled census missing`);
      for (const value of [
        census.rays,
        census.covered,
        census.miss,
        census.exhausted,
      ]) {
        assert.ok(
          Number.isSafeInteger(value) && value >= 0,
          `${name}: malformed census`,
        );
      }
      assert.equal(
        census.covered + census.miss + census.exhausted,
        census.rays,
        `${name}: census does not partition rays`,
      );
      assert.ok(
        census.covered >= 128 && census.miss >= 128,
        `${name}: vacuous census`,
      );
      assert.ok(
        census.exhausted <= census.rays * 0.01,
        `${name}: more than 1% of rays exhausted`,
      );
      return after.probe;
    }
    if (Date.now() >= deadline) {
      await writeFile(
        path.join(args.outdir, `${name}-failed-state.json`),
        `${JSON.stringify(state, null, 2)}\n`,
      );
      assert.fail(
        `${name}: did not complete settle in ${args.timeout}ms; state=${JSON.stringify(state.probe)}`,
      );
    }
    await page.waitForTimeout(250);
  }
}

async function capture(page, args, engine, name) {
  DIAGNOSTICS.phase = `settle:${name}`;
  const started = Date.now();
  const probe = await settled(page, args, engine, name);
  DIAGNOSTICS.phase = `screenshot:${name}`;
  const canvas = page.locator("#container canvas").first();
  const take = () => canvas.screenshot({ type: "png", style: CAPTURE_STYLE });
  let png;
  for (let attempt = 0; attempt < 5; attempt++) {
    const first = await take();
    await page.waitForTimeout(300);
    png = await take();
    if (first.equals(png)) break;
    assert.ok(attempt < 4, `${name}: completed canvas never became stable`);
  }
  assert.equal(
    (await pollSurfaceState(page)).settled,
    true,
    `${name}: capture invalidated settle`,
  );
  const image = await decodePng(page, png);
  assert.equal(image.width, RELEASE_VIEWPORT.width);
  assert.equal(image.height, RELEASE_VIEWPORT.height);
  let drawn = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (Math.max(image.data[i], image.data[i + 1], image.data[i + 2]) > 12)
      drawn++;
  }
  const share = drawn / (image.width * image.height);
  assert.ok(
    share > 0.005 && share < 0.85,
    `${name}: screenshot draw is vacuous (${share})`,
  );
  await writeFile(path.join(args.outdir, `${name}.png`), png);
  const record = {
    name,
    backend: probe.backend,
    census: probe.census,
    drawShare: share,
    elapsedMs: Date.now() - started,
  };
  process.stdout.write(
    `PASS ${name}: engine=${engine} drawn=${(share * 100).toFixed(2)}% covered=${probe.census.covered}/${probe.census.rays} exhausted=${probe.census.exhausted}\n`,
  );
  return { image, record };
}

function compare(a, b, name, expectEffect) {
  assert.equal(a.image.data.length, b.image.data.length);
  let changed = 0;
  let sum = 0;
  const pixels = a.image.width * a.image.height;
  for (let i = 0; i < a.image.data.length; i += 4) {
    let delta = 0;
    for (let channel = 0; channel < 3; channel++) {
      const d = Math.abs(a.image.data[i + channel] - b.image.data[i + channel]);
      sum += d;
      delta = Math.max(delta, d);
    }
    if (delta >= 12) changed++;
  }
  const share = changed / pixels;
  const meanAbs = sum / (pixels * 3);
  if (expectEffect) {
    assert.ok(
      changed >= 256 && share >= 0.003,
      `${name}: authored change has no material effect (${share})`,
    );
  } else {
    assert.ok(
      share < 0.001 && meanAbs < 0.1,
      `${name}: equivalent root unions differ (${share}, mean ${meanAbs})`,
    );
  }
  process.stdout.write(
    `PASS ${name}: changed=${changed}/${pixels} meanAbs=${meanAbs.toFixed(4)}\n`,
  );
  return { name, changedShare: share, meanAbs };
}

function paletteAttribution(before, after, name) {
  const { width, height } = before.image;
  const support = (image, index) =>
    Math.max(
      image.data[index * 4],
      image.data[index * 4 + 1],
      image.data[index * 4 + 2],
    ) > 12;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components = [];
  let supportChanges = 0;
  for (let index = 0; index < visited.length; index++) {
    if (support(before.image, index) !== support(after.image, index))
      supportChanges++;
    if (visited[index] || !support(before.image, index)) continue;
    let head = 0;
    let tail = 1;
    let sumX = 0;
    queue[0] = index;
    visited[index] = 1;
    const add = (neighbor) => {
      if (!visited[neighbor] && support(before.image, neighbor)) {
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    };
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      sumX += x;
      if (x > 0) add(pixel - 1);
      if (x + 1 < width) add(pixel + 1);
      if (pixel >= width) add(pixel - width);
      if (pixel + width < visited.length) add(pixel + width);
    }
    if (tail >= 128)
      components.push({ pixels: queue.slice(0, tail), centerX: sumX / tail });
  }
  assert.equal(
    components.length,
    2,
    `${name}: witness requires exactly two substantial connected shapes`,
  );
  assert.equal(
    supportChanges,
    0,
    `${name}: palette edit changed the geometry mask`,
  );
  components.sort((a, b) => a.centerX - b.centerX);
  const counts = (image) => {
    return components.map((component) => {
      const count = { red: 0, blue: 0, pixels: component.pixels.length };
      for (const pixel of component.pixels) {
        const offset = pixel * 4;
        const red = image.data[offset];
        const blue = image.data[offset + 2];
        if (red > 24 && red > blue * 2) count.red++;
        if (blue > 24 && blue > red * 2) count.blue++;
      }
      return count;
    });
  };
  const original = counts(before.image);
  const changed = counts(after.image);
  assert.ok(
    original[0].red >= original[0].pixels * 0.9 &&
      original[0].blue < original[0].red * 0.01,
    `${name}: first emitter is not distinctly red`,
  );
  assert.ok(
    original[1].blue >= original[1].pixels * 0.9 &&
      original[1].red < original[1].blue * 0.01,
    `${name}: second emitter is not distinctly blue`,
  );
  assert.ok(
    changed[1].red >= changed[1].pixels * 0.9 &&
      changed[1].blue < changed[1].red * 0.01,
    `${name}: changing only emitter 2 did not make it red`,
  );
  let firstDelta = 0;
  for (const pixel of components[0].pixels) {
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel++) {
      firstDelta += Math.abs(
        before.image.data[offset + channel] -
          after.image.data[offset + channel],
      );
    }
  }
  const firstMeanAbs = firstDelta / (components[0].pixels.length * 3);
  assert.ok(
    firstMeanAbs < 0.1,
    `${name}: changing emitter 2 repainted emitter 1 (${firstMeanAbs})`,
  );
  process.stdout.write(
    `PASS ${name}: red/blue=${JSON.stringify(original)} -> ${JSON.stringify(changed)} firstMeanAbs=${firstMeanAbs.toFixed(4)}\n`,
  );
  return { name, original, changed, firstMeanAbs, supportChanges };
}

async function rejectLiveEdit(page, act, name) {
  DIAGNOSTICS.phase = `refused-edit:${name}`;
  await page.waitForTimeout(500);
  const before = await readDocument(page);
  await act();
  await page.waitForTimeout(650);
  assert.deepEqual(
    await readDocument(page),
    before,
    `${name}: refused edit changed the scene hash`,
  );
  assert.equal(
    (await pollSurfaceState(page)).settled,
    true,
    `${name}: refused edit replaced the completed surface`,
  );
  assert.match(
    await page.locator("#toast").innerText(),
    /root|depth 0/i,
    `${name}: refusal did not explain the missing root`,
  );
  assert.equal(
    await page.locator("#modeSurfaceBtn").getAttribute("aria-pressed"),
    "true",
  );
  process.stdout.write(
    `PASS ${name}: document and settled Surface retained with root-depth reason\n`,
  );
}

async function liveBands(page, args, engine, prefix, baseline) {
  await page.locator("#surfaceCondensationSection > summary").click();
  await rejectLiveEdit(
    page,
    async () => {
      const slider = page.locator("#surfaceCondensationMinSlider");
      assert.equal(
        await slider.inputValue(),
        "0",
        "root-containing custom band must display first level 0",
      );
      await slider.focus();
      await slider.press("ArrowRight");
    },
    `${prefix}-live-min-refusal`,
  );
  assert.equal(
    await page.locator("#surfaceCondensationMinSlider").inputValue(),
    "0",
    "refused range must snap back to root depth",
  );
  const root = await rootBandCapture(page, args, engine, prefix, baseline);
  await rejectLiveEdit(
    page,
    () => page.selectOption("#surfaceCondensationBandMode", "custom"),
    `${prefix}-live-custom-refusal`,
  );
  assert.equal(
    await page.locator("#surfaceCondensationBandMode").inputValue(),
    "root",
    "refused select must snap back to Root only",
  );
  return root;
}

async function rootBandCapture(page, args, engine, prefix, baseline) {
  DIAGNOSTICS.phase = "root-band-restart";
  await page.selectOption("#surfaceCondensationBandMode", "root");
  await page.waitForTimeout(650);
  assert.deepEqual((await readDocument(page)).condensationDepthBand, {
    maxDepth: 0,
  });
  const root = await capture(page, args, engine, `${prefix}-root`);
  const same = compare(
    baseline,
    root,
    `${prefix}-root-band-equivalence`,
    false,
  );
  return { root: root.record, same };
}

async function withPage(browser, args, name, run) {
  DIAGNOSTICS.activeCase = name;
  DIAGNOSTICS.phase = "new-context";
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: RELEASE_VIEWPORT,
    deviceScaleFactor: RELEASE_DEVICE_SCALE_FACTOR,
    reducedMotion: "reduce",
  });
  let failure = null;
  let page;
  const errors = [];
  try {
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on("pageerror", (error) => {
      errors.push(error.message);
      DIAGNOSTICS.pageErrors.push({ case: name, error: error.message });
      process.stderr.write(
        `[surface-emitter-only] page error: ${error.message}\n`,
      );
    });
    page.on("console", (message) => {
      if (
        message.type() === "error" ||
        /device lost|validation error|uncaptured error/i.test(message.text())
      ) {
        errors.push(message.text());
        DIAGNOSTICS.pageErrors.push({ case: name, error: message.text() });
        process.stderr.write(
          `[surface-emitter-only] console error: ${message.text().slice(0, 2000)}\n`,
        );
      }
    });
    const result = await within(
      run(page),
      args.timeout + 60_000,
      "production page case",
    );
    assert.deepEqual(errors, [], "page emitted browser errors");
    return result;
  } catch (error) {
    failure = error;
    await writeFile(
      path.join(args.outdir, "failed-page.json"),
      `${JSON.stringify(
        {
          url: page?.url(),
          lastState: page ? (LAST_PROBES.get(page) ?? null) : null,
          errors,
          driverErrors: DIAGNOSTICS.driverErrors.filter(
            (entry) => entry.case === name,
          ),
          failure: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      )}\n`,
    );
    throw error;
  } finally {
    DIAGNOSTICS.phase = "context-cleanup";
    try {
      await within(context.close(), 10_000, "browser context cleanup");
    } catch (error) {
      if (!failure) throw error;
      process.stderr.write(
        `[surface-emitter-only] cleanup: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    DIAGNOSTICS.phase = "between-cases";
  }
}

async function refusal(browser, args, dimension, variant) {
  const name = `${dimension}d-${variant}`;
  return withPage(browser, args, name, async (page) => {
    const document = fixture(dimension, variant);
    await boot(page, args, "webgl", document);
    DIAGNOSTICS.phase = "pre-entry-refusal";
    const button = page.locator("#modeSurfaceBtn");
    assert.equal(
      await button.isEnabled(),
      false,
      `${name}: expected entry refusal`,
    );
    const reason = await button.getAttribute("title");
    assert.match(
      reason,
      variant === "empty-band"
        ? /root|depth 0/i
        : variant === "frontier-overflow"
          ? /schedule|prefix|frontier|beam/i
          : /records.*24/i,
      `${name}: incorrect refusal reason`,
    );
    assert.deepEqual(
      (await readDocument(page)).condensationDepthBand,
      document.condensationDepthBand,
      `${name}: entry gate rewrote the band`,
    );
    let recovered = null;
    if (variant === "empty-band") {
      const recovery = page.locator("#surfaceEligibilityRecoveryBtn");
      assert.equal(
        await recovery.isVisible(),
        true,
        `${name}: missing root recovery`,
      );
      DIAGNOSTICS.phase = "root-band-recovery";
      await recovery.click();
      await page.waitForTimeout(650);
      assert.deepEqual(
        (await readDocument(page)).condensationDepthBand,
        { maxDepth: 0 },
        `${name}: recovery did not author root-only`,
      );
      assert.equal(
        await button.isEnabled(),
        true,
        `${name}: recovery did not restore entry`,
      );
      await enter(page);
      recovered = (await capture(page, args, "webgl", `${name}-recovered`))
        .record;
    } else {
      assert.equal(
        await page.locator("#surfaceEligibilityRecoveryBtn").isVisible(),
        false,
        `${name}: root recovery cannot resolve this refusal`,
      );
    }
    process.stdout.write(`PASS ${name}: ${reason}\n`);
    return { name, reason, recovered };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outdir, { recursive: true });
  // Same launcher flags as the shared runner, with a BrowserServer handle so
  // a hung renderer cannot strand cleanup: process ownership and kill() are
  // public Playwright APIs, and the websocket listens on loopback only.
  const server = await chromium.launchServer({
    ...surfaceLaunchOptions(args.mode),
    executablePath: chromium.executablePath(),
    headless: false,
    host: "127.0.0.1",
    timeout: 60_000,
  });
  process.stderr.write(
    `[surface-emitter-only] browser pid=${server.process().pid}\n`,
  );
  server
    .process()
    .stderr?.on("data", (data) => chromiumStderr(data.toString()));
  const report = {
    mode: args.mode,
    filter: args.only || null,
    captures: [],
    comparisons: [],
    refusals: [],
    status: "running",
  };
  try {
    const browser = await chromium.connect(server.wsEndpoint(), {
      timeout: 30_000,
    });
    for (const dimension of DIMENSIONS) {
      for (const engine of ENGINES) {
        const records = new Map();
        for (const variant of [
          "posed",
          "xaos",
          "schedule",
          "frontier",
          "palette",
          "palette-second",
          ...(args.only === "3d-webgl-classic" &&
          dimension === 3 &&
          engine === "webgl"
            ? ["classic"]
            : []),
        ]) {
          const name = `${dimension}d-${engine}-${variant}`;
          if (args.filter && !args.filter.test(name)) continue;
          const captured = await withPage(browser, args, name, async (page) => {
            await boot(page, args, engine, fixture(dimension, variant));
            await enter(page);
            const result = await capture(page, args, engine, name);
            if (variant === "posed") {
              const bands = await liveBands(page, args, engine, name, result);
              report.captures.push(bands.root);
              report.comparisons.push(bands.same);
            } else if (variant === "frontier") {
              await page
                .locator("#surfaceCondensationSection > summary")
                .click();
              const bands = await rootBandCapture(
                page,
                args,
                engine,
                name,
                result,
              );
              report.captures.push(bands.root);
              report.comparisons.push(bands.same);
            }
            return result;
          });
          records.set(variant, captured);
          report.captures.push(captured.record);
        }
        for (const variant of ["xaos", "schedule"]) {
          if (!records.has("posed") || !records.has(variant)) continue;
          report.comparisons.push(
            compare(
              records.get("posed"),
              records.get(variant),
              `${dimension}d-${engine}-${variant}-effect`,
              variant !== "xaos",
            ),
          );
        }
        if (records.has("palette") && records.has("palette-second")) {
          report.comparisons.push(
            paletteAttribution(
              records.get("palette"),
              records.get("palette-second"),
              `${dimension}d-${engine}-palette-attribution`,
            ),
          );
        }
      }
      for (const variant of [
        "empty-band",
        "record-cap",
        "schedule-cap",
        "frontier-overflow",
      ]) {
        if (args.filter && !args.filter.test(`${dimension}d-${variant}`))
          continue;
        const refused = await refusal(browser, args, dimension, variant);
        if (refused.recovered) report.captures.push(refused.recovered);
        report.refusals.push(refused);
      }
    }
    assert.ok(
      report.captures.length + report.refusals.length > 0,
      "filter selected no gate rows",
    );
    assert.deepEqual(
      DIAGNOSTICS.driverErrors,
      [],
      "Chromium GPU-process errors occurred; see chromium-stderr.log and report.json",
    );
    report.status = args.filter || !args.release ? "diagnostic-pass" : "pass";
    if (args.filter) {
      process.stdout.write(
        "DIAGNOSTIC PASS: selected emitter-only Surface rows completed; full matrix remains required\n",
      );
    } else {
      process.stdout.write(
        "PASS emitter-only Surface: both dimensions and engines drew, settled, preserved C0, applied B/materials, and refused empty bands and excess records\n",
      );
    }
    process.stdout.write(
      `PASS browser health: ${DIAGNOSTICS.pageErrors.length} page errors, ${DIAGNOSTICS.driverErrors.length} GPU-process errors\n`,
    );
    if (!args.release || args.filter) {
      process.stderr.write(
        "[surface-emitter-only] DIAGNOSTIC PASS; unfiltered real-display rerun required for release evidence\n",
      );
      process.exitCode = 2;
    }
  } catch (error) {
    report.status = "failed";
    report.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    DIAGNOSTICS.activeCase = "shutdown";
    DIAGNOSTICS.phase = "browser-cleanup";
    try {
      await within(server.close(), 10_000, "browser shutdown");
    } catch (error) {
      process.stderr.write(
        `[surface-emitter-only] forcing own browser pid=${server.process().pid} closed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      await within(server.kill(), 10_000, "browser kill");
    } finally {
      if (stderrBuffer) chromiumStderr("\n");
      report.driverErrors = DIAGNOSTICS.driverErrors;
      report.pageErrors = DIAGNOSTICS.pageErrors;
      await writeFile(
        path.join(args.outdir, "report.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      await writeFile(
        path.join(args.outdir, "chromium-stderr.log"),
        DIAGNOSTICS.stderr
          .map(
            (entry) =>
              `${entry.time} [${entry.case}/${entry.phase}] ${entry.line}\n`,
          )
          .join(""),
      );
    }
  }
}

main().catch((error) => {
  process.stderr.write(
    `[surface-emitter-only] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode =
    error instanceof SurfaceBrowserCheckingError
      ? 2
      : error?.code === "ERR_ASSERTION"
        ? 3
        : 1;
});
