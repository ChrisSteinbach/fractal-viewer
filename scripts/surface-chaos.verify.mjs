#!/usr/bin/env node
/**
 * Production-browser evidence for graph-directed Surface on the shipped
 * `fernSponge` preset.
 *
 *   npm run build && npm run preview &
 *   node scripts/surface-chaos.verify.mjs --mode=x11::0
 *   node scripts/surface-chaos.verify.mjs --mode=sw
 *
 * Optional: --url=https://localhost:4173 --timeout=600000 --dwell=1000
 *
 * The four fresh-page legs are {compute, WebGL} x {chaos off, chaos on}.
 * The preset is selected through the production menu and persisted once, so
 * all legs share one real auto-framed camera/view. The off document is that
 * same wire with only transform `chaos` fields removed. Every leg must hold
 * the production settle latch, disclose a real partitioned ray census, draw
 * foreground and background, and become byte-stable. The gate also requires
 * a material within-engine chaos effect and cross-engine image/effect
 * agreement. Real X11 is the release gate; software is diagnostic exit 2.
 */

import process from "node:process";

import {
  decodeSceneHash,
  deriveSceneHash,
} from "./pattern-release-fixtures.mjs";
import { decodePng } from "./lib/pattern-release-artifacts.mjs";
import {
  launchSurfaceBrowser,
  pollSurfaceState,
  RELEASE_DEVICE_SCALE_FACTOR,
  RELEASE_VIEWPORT,
  SurfaceBrowserCheckingError,
} from "./lib/surface-browser-runner.mjs";

const ENGINES = Object.freeze(["compute", "webgl"]);
const VARIANTS = Object.freeze(["off", "on"]);
const POLL_MS = 250;
const STABLE_GAP_MS = 300;
const STABLE_ATTEMPTS = 5;
const STAGE_GRACE_MS = 1_000;
const MIN_COVERED_RAYS = 128;
const MIN_COVERED_SHARE = 0.0005;
const MAX_EXHAUSTED_SHARE = 0.01;
const PIXEL_NOISE_FLOOR = 8;
const PIXEL_STRONG_FLOOR = 24;
const MIN_CHANGED_PIXELS = 256;
const MIN_CHANGED_SHARE = 0.01;
const MIN_STRONG_PIXELS = 128;
const MIN_STRONG_SHARE = 0.005;
// Engine implementations use different raster arithmetic, so this is a
// structural disagreement ceiling, not an exact-byte assertion.
const MAX_ENGINE_STRONG_SHARE = 0.2;
const MAX_ENGINE_MEAN_ABS = 12;
const MIN_EFFECT_OVERLAP = 0.35;

const OVERLAY_SELECTORS = Object.freeze([
  "#panel",
  "#help",
  "#legend",
  "#menuToggle",
  "#loading",
  "#error",
  "#updateBanner",
  "#renderError",
  "#toast",
]);

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    mode: "x11::0",
    timeout: 600_000,
    dwell: 1_000,
  };
  for (const raw of argv) {
    const match = /^--([A-Za-z][A-Za-z0-9-]*)=(.*)$/.exec(raw);
    if (!match) throw new Error(`unknown argument ${raw}`);
    const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in args)) throw new Error(`unknown argument --${match[1]}`);
    args[key] = new Set(["timeout", "dwell"]).has(key)
      ? Number(match[2])
      : match[2];
  }
  if (args.mode !== "sw" && !/^x11:.+/.test(args.mode)) {
    throw new Error("--mode must be sw or x11:<display>");
  }
  if (!Number.isFinite(args.timeout) || args.timeout < 30_000) {
    throw new Error("--timeout must be at least 30000ms");
  }
  if (!Number.isFinite(args.dwell) || args.dwell < 0) {
    throw new Error("--dwell must be a non-negative number");
  }
  args.url = String(args.url).replace(/\/+$/, "");
  args.release = args.mode.startsWith("x11:");
  return args;
}

function assertOnlyChaosDiffers(onHash, offHash) {
  const onDocument = structuredClone(decodeSceneHash(onHash));
  const offDocument = structuredClone(decodeSceneHash(offHash));
  const rows = [];
  for (const transform of onDocument.transforms) {
    if (Object.hasOwn(transform, "chaos")) rows.push(transform.chaos);
    delete transform.chaos;
  }
  if (JSON.stringify(offDocument) !== JSON.stringify(onDocument)) {
    throw new SurfaceBrowserCheckingError(
      "chaos-off control differs from chaos-on by more than transform chaos fields",
    );
  }
  if (
    rows.length === 0 ||
    !rows.some(
      (row) =>
        Array.isArray(row) &&
        row.some((value) => Number.isFinite(value) && value !== 1),
    )
  ) {
    throw new SurfaceBrowserCheckingError(
      "minted fernSponge document has no non-trivial chaos row",
    );
  }
  if (
    offDocument.transforms.some((transform) =>
      Object.hasOwn(transform, "chaos"),
    )
  ) {
    throw new SurfaceBrowserCheckingError(
      "chaos-off control retained a transform chaos field",
    );
  }
  return rows;
}

function diagnosticQuery(engine) {
  if (engine === "compute") {
    return "?surfacestate&surfacecompute&surfacesamples=1";
  }
  if (engine === "webgl") {
    return "?surfacestate&surfacegl&surfacesamples=1";
  }
  throw new Error(`unknown Surface engine ${engine}`);
}

async function bootScene(page, target) {
  await page.goto(target, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const pointCount = document.getElementById("pointCount");
      return (
        typeof window.__surfaceState === "function" &&
        !!pointCount &&
        Number((pointCount.textContent || "").replace(/[^\d]/g, "")) > 0
      );
    },
    undefined,
    { timeout: 60_000, polling: 100 },
  );
}

async function mintShippedPresetPose(browser, args) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: RELEASE_VIEWPORT,
    deviceScaleFactor: RELEASE_DEVICE_SCALE_FACTOR,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    await bootScene(page, `${args.url}/?surfacestate`);
    const count = await page
      .locator('#presetSelect option[value="fernSponge"]')
      .count();
    if (count !== 1) {
      throw new SurfaceBrowserCheckingError(
        "shipped fernSponge preset option is absent or duplicated",
      );
    }
    // The handler clears the select to its sentinel synchronously. The
    // persisted-document assertion is the durable proof that the preset won.
    await page.selectOption("#presetSelect", "fernSponge");
    await page.waitForFunction(
      () => document.getElementById("modeSurfaceBtn")?.disabled === false,
      undefined,
      { timeout: 30_000, polling: 100 },
    );
    await page.waitForTimeout(1_000);
    const encoded = await page.evaluate(() => {
      localStorage.removeItem("fractal-viewer:collection");
      document
        .getElementById("saveCollectionBtn")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const raw = localStorage.getItem("fractal-viewer:collection");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const scenes = Array.isArray(parsed) ? parsed : parsed.scenes;
      return scenes?.at(-1)?.encoded ?? scenes?.[0]?.encoded ?? null;
    });
    if (typeof encoded !== "string" || !encoded.startsWith("v1=")) {
      throw new SurfaceBrowserCheckingError(
        "production collection encoder did not persist fernSponge",
      );
    }
    return `#${encoded}`;
  } finally {
    await context.close().catch(() => {});
  }
}

async function enterSurface(page) {
  const deadline = Date.now() + 15_000;
  let button = null;
  for (;;) {
    button = await page.evaluate(() => {
      const element = document.getElementById("modeSurfaceBtn");
      return {
        present: !!element,
        disabled: element?.disabled ?? true,
        pressed: element?.getAttribute("aria-pressed") === "true",
        title: element?.title ?? "",
      };
    });
    if (button.present && !button.disabled) break;
    if (Date.now() > deadline) break;
    await page.waitForTimeout(100);
  }
  if (!button?.present || button.disabled) {
    throw new SurfaceBrowserCheckingError(
      `Surface is ${button?.present ? "not admitted" : "missing"}: ${button?.title ?? ""}`,
    );
  }
  if (!button.pressed) {
    await page.evaluate(() => {
      document
        .getElementById("modeSurfaceBtn")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
}

async function captureCanvas(page) {
  const geometry = await page.evaluate((selectors) => {
    const canvas = document.querySelector("#container canvas");
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    const overlays = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.right <= bounds.left ||
          rect.left >= bounds.right ||
          rect.bottom <= bounds.top ||
          rect.top >= bounds.bottom
        ) {
          continue;
        }
        overlays.push({
          x: Math.max(0, Math.floor(rect.left - bounds.left)),
          y: Math.max(0, Math.floor(rect.top - bounds.top)),
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
        });
      }
    }
    return {
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      overlays,
    };
  }, OVERLAY_SELECTORS);
  if (!geometry) {
    throw new SurfaceBrowserCheckingError("surface canvas is absent");
  }
  const png = await page
    .locator("#container canvas")
    .first()
    .screenshot({ type: "png" });
  return { geometry, png };
}

async function captureStableCanvas(page) {
  await page.waitForTimeout(STAGE_GRACE_MS);
  for (let attempt = 0; attempt < STABLE_ATTEMPTS; attempt++) {
    const first = await captureCanvas(page);
    await page.waitForTimeout(STABLE_GAP_MS);
    const second = await captureCanvas(page);
    if (first.png.equals(second.png)) return second;
  }
  throw new SurfaceBrowserCheckingError(
    "settled canvas did not become byte-stable",
  );
}

function validateProbe(probe, engine, release) {
  if (probe.mode !== "surface" || probe.engine !== engine) {
    throw new SurfaceBrowserCheckingError(
      `settled probe is mode=${probe.mode} engine=${probe.engine}, expected surface/${engine}`,
    );
  }
  const backend = probe.backend;
  if (!backend?.label?.trim()) {
    throw new SurfaceBrowserCheckingError(
      `capture did not disclose the active ${engine} backend`,
    );
  }
  if (release && backend.software !== false) {
    throw new SurfaceBrowserCheckingError(
      `real-display run resolved to ${backend.label} (software=${String(backend.software)})`,
    );
  }
  const census = probe.census;
  const counts = census
    ? [census.rays, census.covered, census.miss, census.exhausted]
    : [];
  if (
    counts.length !== 4 ||
    counts.some((value) => !Number.isInteger(value) || value < 0) ||
    census.covered + census.miss + census.exhausted !== census.rays
  ) {
    throw new SurfaceBrowserCheckingError(
      "settled ray census is absent or malformed",
    );
  }
  if (
    !Array.isArray(census.exhaustedIndices) ||
    census.exhaustedIndices.length !== census.exhausted ||
    new Set(census.exhaustedIndices).size !== census.exhaustedIndices.length ||
    census.exhaustedIndices.some(
      (index) =>
        !Number.isSafeInteger(index) || index < 0 || index >= census.rays,
    )
  ) {
    throw new SurfaceBrowserCheckingError(
      "settled ray census has malformed exhausted-ray locations",
    );
  }
  const requiredCovered = Math.max(
    MIN_COVERED_RAYS,
    Math.ceil(census.rays * MIN_COVERED_SHARE),
  );
  if (census.covered < requiredCovered || census.miss < MIN_COVERED_RAYS) {
    throw new SurfaceBrowserCheckingError(
      `render census is vacuous: covered=${census.covered}/${census.rays}, miss=${census.miss}`,
    );
  }
  if (census.exhausted > census.rays * MAX_EXHAUSTED_SHARE) {
    throw new SurfaceBrowserCheckingError(
      `render exhausted ${census.exhausted}/${census.rays} rays`,
    );
  }
  return { backend, census };
}

function fatalConsoleLine(type, text) {
  return (
    type === "error" ||
    /device lost|validation error|uncaptured error/i.test(text)
  );
}

async function captureLeg(browser, { args, engine, hash, variant }) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: RELEASE_VIEWPORT,
    deviceScaleFactor: RELEASE_DEVICE_SCALE_FACTOR,
    reducedMotion: "reduce",
  });
  const consoleLines = [];
  const pageErrors = [];
  const startedAt = Date.now();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(args.timeout + 60_000);
    page.on("console", (message) =>
      consoleLines.push({ type: message.type(), text: message.text() }),
    );
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const query = diagnosticQuery(engine);
    process.stderr.write(
      `[surface-chaos] ${engine}/${variant}: loading ${query}\n`,
    );
    await bootScene(page, `${args.url}/${query}${hash}`);
    await enterSurface(page);

    const deadline = startedAt + args.timeout;
    let heldSince = null;
    let lastProgress = null;
    for (;;) {
      const state = await pollSurfaceState(page);
      if (state.rowText !== lastProgress) {
        lastProgress = state.rowText;
        process.stderr.write(
          `[surface-chaos] ${engine}/${variant}: ${state.rowText || "(progress hidden)"}\n`,
        );
      }
      if (state.settled) {
        heldSince ??= Date.now();
        if (Date.now() - heldSince >= args.dwell) {
          const canvas = await captureStableCanvas(page);
          const after = await pollSurfaceState(page);
          if (!after.settled) {
            heldSince = null;
            continue;
          }
          if (
            canvas.geometry.width !== RELEASE_VIEWPORT.width ||
            canvas.geometry.height !== RELEASE_VIEWPORT.height
          ) {
            throw new SurfaceBrowserCheckingError(
              `canvas is ${canvas.geometry.width}x${canvas.geometry.height}, expected ${RELEASE_VIEWPORT.width}x${RELEASE_VIEWPORT.height}`,
            );
          }
          const exact = validateProbe(after.probe, engine, args.release);
          const fatal = consoleLines.filter((line) =>
            fatalConsoleLine(line.type, line.text),
          );
          if (pageErrors.length || fatal.length) {
            throw new SurfaceBrowserCheckingError(
              `page emitted ${pageErrors.length} page error(s) and ${fatal.length} fatal console line(s): ` +
                [...pageErrors, ...fatal.map((line) => line.text)]
                  .slice(0, 3)
                  .join(" | "),
            );
          }
          return {
            engine,
            variant,
            backend: exact.backend,
            census: exact.census,
            elapsedMs: Date.now() - startedAt,
            geometry: canvas.geometry,
            image: await decodePng(page, canvas.png),
          };
        }
      } else {
        heldSince = null;
      }
      if (Date.now() > deadline) {
        throw new SurfaceBrowserCheckingError(
          `${engine}/${variant} did not hold the settled latch inside ${args.timeout}ms`,
        );
      }
      await page.waitForTimeout(POLL_MS);
    }
  } finally {
    await context.close().catch(() => {});
  }
}

function unionOverlays(...groups) {
  const byKey = new Map();
  for (const overlay of groups.flat()) {
    const clean = {
      x: overlay.x,
      y: overlay.y,
      width: overlay.width,
      height: overlay.height,
    };
    byKey.set(JSON.stringify(clean), clean);
  }
  return [...byKey.values()];
}

function insideOverlay(x, y, overlays) {
  return overlays.some(
    (overlay) =>
      x >= overlay.x &&
      x < overlay.x + overlay.width &&
      y >= overlay.y &&
      y < overlay.y + overlay.height,
  );
}

function pixelDelta(a, b, offset) {
  return Math.max(
    Math.abs(a[offset] - b[offset]),
    Math.abs(a[offset + 1] - b[offset + 1]),
    Math.abs(a[offset + 2] - b[offset + 2]),
  );
}

function compareImages(a, b, label, requireEffect) {
  if (a.image.width !== b.image.width || a.image.height !== b.image.height) {
    throw new SurfaceBrowserCheckingError(
      `${label} images have different dimensions`,
    );
  }
  const overlays = unionOverlays(a.geometry.overlays, b.geometry.overlays);
  let eligible = 0;
  let changed = 0;
  let strong = 0;
  let absoluteSum = 0;
  let maxDelta = 0;
  const { width, height } = a.image;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (insideOverlay(x, y, overlays)) continue;
      const offset = (y * width + x) * 4;
      const d = pixelDelta(a.image.data, b.image.data, offset);
      eligible++;
      maxDelta = Math.max(maxDelta, d);
      if (d >= PIXEL_NOISE_FLOOR) changed++;
      if (d >= PIXEL_STRONG_FLOOR) strong++;
      absoluteSum +=
        Math.abs(a.image.data[offset] - b.image.data[offset]) +
        Math.abs(a.image.data[offset + 1] - b.image.data[offset + 1]) +
        Math.abs(a.image.data[offset + 2] - b.image.data[offset + 2]);
    }
  }
  if (!eligible) {
    throw new SurfaceBrowserCheckingError(`${label} has no eligible pixels`);
  }
  const result = {
    eligible,
    changed,
    changedShare: changed / eligible,
    strong,
    strongShare: strong / eligible,
    meanAbs: absoluteSum / (eligible * 3),
    maxDelta,
  };
  if (requireEffect) {
    const requiredChanged = Math.max(
      MIN_CHANGED_PIXELS,
      Math.ceil(eligible * MIN_CHANGED_SHARE),
    );
    const requiredStrong = Math.max(
      MIN_STRONG_PIXELS,
      Math.ceil(eligible * MIN_STRONG_SHARE),
    );
    if (
      changed < requiredChanged ||
      strong < requiredStrong ||
      maxDelta < PIXEL_STRONG_FLOOR
    ) {
      throw new SurfaceBrowserCheckingError(
        `${label} is not material: changed=${changed}/${eligible}, strong=${strong}, max=${maxDelta}`,
      );
    }
  } else if (
    result.strongShare > MAX_ENGINE_STRONG_SHARE ||
    result.meanAbs > MAX_ENGINE_MEAN_ABS
  ) {
    throw new SurfaceBrowserCheckingError(
      `${label} engines disagree: strong=${percentage(result.strongShare)}, meanAbs=${result.meanAbs.toFixed(3)}`,
    );
  }
  return result;
}

function compareEffectMasks(computeOff, computeOn, glOff, glOn) {
  const overlays = unionOverlays(
    computeOff.geometry.overlays,
    computeOn.geometry.overlays,
    glOff.geometry.overlays,
    glOn.geometry.overlays,
  );
  let computeChanged = 0;
  let glChanged = 0;
  let overlap = 0;
  const { width, height } = computeOff.image;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (insideOverlay(x, y, overlays)) continue;
      const offset = (y * width + x) * 4;
      const c =
        pixelDelta(computeOff.image.data, computeOn.image.data, offset) >=
        PIXEL_NOISE_FLOOR;
      const g =
        pixelDelta(glOff.image.data, glOn.image.data, offset) >=
        PIXEL_NOISE_FLOOR;
      if (c) computeChanged++;
      if (g) glChanged++;
      if (c && g) overlap++;
    }
  }
  const smaller = Math.min(computeChanged, glChanged);
  const share = smaller > 0 ? overlap / smaller : 0;
  if (share < MIN_EFFECT_OVERLAP) {
    throw new SurfaceBrowserCheckingError(
      `cross-engine chaos-effect overlap is ${percentage(share)}; need ${percentage(MIN_EFFECT_OVERLAP)}`,
    );
  }
  return { overlap, computeChanged, glChanged, share };
}

function percentage(value) {
  return `${(value * 100).toFixed(3)}%`;
}

function seconds(value) {
  return `${(value / 1_000).toFixed(1)}s`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let browser;
  try {
    browser = await launchSurfaceBrowser(args.mode);
    process.stderr.write(
      "[surface-chaos] selecting fernSponge and minting one shared camera pose\n",
    );
    const onHash = await mintShippedPresetPose(browser, args);
    const offHash = deriveSceneHash(onHash, (document) => {
      for (const transform of document.transforms) delete transform.chaos;
    });
    const rows = assertOnlyChaosDiffers(onHash, offHash);

    const records = new Map();
    for (const engine of ENGINES) {
      for (const variant of VARIANTS) {
        const record = await captureLeg(browser, {
          args,
          engine,
          variant,
          hash: variant === "on" ? onHash : offHash,
        });
        records.set(`${engine}/${variant}`, record);
        process.stdout.write(
          `PASS ${engine}/${variant}: backend=${record.backend.label} ` +
            `software=${String(record.backend.software)} settled=${seconds(record.elapsedMs)} ` +
            `covered=${record.census.covered}/${record.census.rays} ` +
            `(${percentage(record.census.covered / record.census.rays)}) ` +
            `exhausted=${record.census.exhausted}\n`,
        );
      }
    }

    for (const engine of ENGINES) {
      const delta = compareImages(
        records.get(`${engine}/off`),
        records.get(`${engine}/on`),
        `${engine}/chaos-effect`,
        true,
      );
      process.stdout.write(
        `PASS ${engine}/chaos-effect: changed=${delta.changed}/${delta.eligible} ` +
          `(${percentage(delta.changedShare)}) strong=${delta.strong} ` +
          `(${percentage(delta.strongShare)}) meanAbs=${delta.meanAbs.toFixed(3)} ` +
          `max=${delta.maxDelta}\n`,
      );
    }

    for (const variant of VARIANTS) {
      const agreement = compareImages(
        records.get(`compute/${variant}`),
        records.get(`webgl/${variant}`),
        `engines/${variant}`,
        false,
      );
      process.stdout.write(
        `PASS engines/${variant}: strong=${agreement.strong}/${agreement.eligible} ` +
          `(${percentage(agreement.strongShare)}) meanAbs=${agreement.meanAbs.toFixed(3)} ` +
          `max=${agreement.maxDelta}\n`,
      );
    }
    const overlap = compareEffectMasks(
      records.get("compute/off"),
      records.get("compute/on"),
      records.get("webgl/off"),
      records.get("webgl/on"),
    );
    process.stdout.write(
      `PASS engines/chaos-effect: overlap=${overlap.overlap}/` +
        `${Math.min(overlap.computeChanged, overlap.glChanged)} ` +
        `(${percentage(overlap.share)})\n`,
    );
    process.stdout.write(
      `PASS fernSponge chaos rows=${rows.length}; both Surface engines admitted, settled, agreed, drew, and changed under graph support\n`,
    );
    if (!args.release) {
      process.stderr.write(
        "[surface-chaos] DIAGNOSTIC PASS — rerun with --mode=x11:<display> on a real driver for release evidence\n",
      );
      process.exitCode = 2;
    }
  } finally {
    await browser?.close().catch(() => {});
  }
}

main().catch((error) => {
  const checking = error instanceof SurfaceBrowserCheckingError;
  process.stderr.write(
    `[surface-chaos] ${checking ? "CHECKING FAILURE" : "UNEXPECTED FAILURE"}: ` +
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = checking ? 2 : 1;
});
