#!/usr/bin/env node
/**
 * Browser evidence for the shipped `spongeOfFerns` Surface schedule.
 *
 * Build and serve the production app first, then run either a release pass on
 * a real display or a software diagnostic:
 *
 *   npm run build && npm run preview &
 *   node scripts/surface-schedule.verify.mjs --mode=x11::0
 *   node scripts/surface-schedule.verify.mjs --mode=sw
 *
 * Optional flags:
 *
 *   --url=https://localhost:4173
 *   --timeout=600000
 *   --dwell=1000
 *
 * The four render legs are {compute, WebGL} x {schedule off, schedule on}.
 * Every leg is a fresh production page loaded with `?surfacestate`, the
 * requested engine override, and `surfacesamples=1`. It must admit Surface,
 * take the requested engine, hold the real settle latch, report a partitioned
 * and meaningfully covered ray census, and produce a byte-stable canvas.
 *
 * The fixture is selected through the production preset menu rather than a
 * copied hash. The production collection encoder then mints the schedule-on
 * preset's auto-framed camera; both sides use that exact persisted pose. The
 * control differs only by deleting `schedule`, so an implementation that
 * accepts the document but ignores system B produces the same image and fails
 * the structural pixel-delta gate.
 *
 * Exit 0 is a real-driver pass. Exit 2 is either a checking failure or a
 * successful software-only diagnostic; exit 1 is an unexpected script error.
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
    const key = match[1].replace(/-([a-z])/g, (_, letter) =>
      letter.toUpperCase(),
    );
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

function assertOnlyScheduleDiffers(onHash, offHash) {
  const onDocument = structuredClone(decodeSceneHash(onHash));
  const offDocument = structuredClone(decodeSceneHash(offHash));
  const schedule = onDocument.schedule;
  delete onDocument.schedule;
  if (JSON.stringify(offDocument) !== JSON.stringify(onDocument)) {
    throw new SurfaceBrowserCheckingError(
      "schedule-off control differs from schedule-on by more than the schedule field",
    );
  }
  if (
    !schedule ||
    !Number.isInteger(schedule.depth) ||
    schedule.depth <= 0 ||
    !Array.isArray(schedule.transforms) ||
    schedule.transforms.length === 0
  ) {
    throw new SurfaceBrowserCheckingError(
      "minted spongeOfFerns document has no live schedule",
    );
  }
  return schedule;
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

/**
 * Select the real shipped menu preset, allow its production auto-frame to
 * land, then use the same collection encoder as Save scene. This avoids a
 * copied fixture drifting from the preset's A/B side tables.
 */
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
    const optionCount = await page
      .locator('#presetSelect option[value="spongeOfFerns"]')
      .count();
    if (optionCount !== 1) {
      throw new SurfaceBrowserCheckingError(
        "shipped spongeOfFerns preset option is absent or duplicated",
      );
    }
    await page.selectOption("#presetSelect", "spongeOfFerns");
    await page.waitForFunction(
      () => {
        const surface = document.getElementById("modeSurfaceBtn");
        // The production change handler deliberately clears the select back
        // to its blank sentinel immediately after dispatch. The durable load
        // outcome is the scheduled document passing the Surface gate; the
        // encoded-scene assertion below then proves the schedule itself
        // landed rather than merely trusting this enabled button.
        return surface?.disabled === false;
      },
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
        "production collection encoder did not persist spongeOfFerns",
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
  return button;
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
          selector,
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
  if (geometry === null) {
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
  let latest = null;
  for (let attempt = 0; attempt < STABLE_ATTEMPTS; attempt++) {
    const first = await captureCanvas(page);
    await page.waitForTimeout(STABLE_GAP_MS);
    latest = await captureCanvas(page);
    if (first.png.equals(latest.png)) return latest;
  }
  throw new SurfaceBrowserCheckingError(
    "settled canvas did not become byte-stable",
  );
}

function fatalConsoleLine(type, text) {
  return (
    type === "error" ||
    /device lost|validation error|uncaptured error/i.test(text)
  );
}

function validateProbe(probe, engine, release) {
  if (probe.mode !== "surface") {
    throw new SurfaceBrowserCheckingError(
      `settled probe left Surface mode (${String(probe.mode)})`,
    );
  }
  if (probe.engine !== engine) {
    throw new SurfaceBrowserCheckingError(
      `capture ran engine=${probe.engine ?? "none"}, expected ${engine}`,
    );
  }
  const backend = probe.backend ?? null;
  if (!backend || typeof backend.label !== "string" || !backend.label.trim()) {
    throw new SurfaceBrowserCheckingError(
      `capture did not disclose the active ${engine} backend`,
    );
  }
  if (release && backend.software !== false) {
    throw new SurfaceBrowserCheckingError(
      `real-display run resolved to ${backend.label} (software=${String(backend.software)})`,
    );
  }

  const census = probe.census ?? null;
  if (!census) {
    throw new SurfaceBrowserCheckingError(
      `settled ${engine} capture did not disclose a ray census`,
    );
  }
  const counts = [census.rays, census.covered, census.miss, census.exhausted];
  if (counts.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new SurfaceBrowserCheckingError("settled ray census is malformed");
  }
  if (census.covered + census.miss + census.exhausted !== census.rays) {
    throw new SurfaceBrowserCheckingError(
      `ray census does not partition its ${census.rays} rays`,
    );
  }
  if (
    !Array.isArray(census.exhaustedIndices) ||
    census.exhaustedIndices.length !== census.exhausted ||
    census.exhaustedIndices.some(
      (index) =>
        !Number.isSafeInteger(index) || index < 0 || index >= census.rays,
    ) ||
    new Set(census.exhaustedIndices).size !== census.exhaustedIndices.length
  ) {
    throw new SurfaceBrowserCheckingError(
      "settled ray census has malformed exhausted-ray locations",
    );
  }
  const requiredCovered = Math.max(
    MIN_COVERED_RAYS,
    Math.ceil(census.rays * MIN_COVERED_SHARE),
  );
  if (census.covered < requiredCovered) {
    throw new SurfaceBrowserCheckingError(
      `render covered only ${census.covered}/${census.rays} rays; need at least ${requiredCovered}`,
    );
  }
  if (census.miss < MIN_COVERED_RAYS) {
    throw new SurfaceBrowserCheckingError(
      `render has no meaningful background (${census.miss}/${census.rays} misses)`,
    );
  }
  if (census.exhausted > census.rays * MAX_EXHAUSTED_SHARE) {
    throw new SurfaceBrowserCheckingError(
      `render exhausted ${census.exhausted}/${census.rays} rays (> ${(MAX_EXHAUSTED_SHARE * 100).toFixed(1)}%)`,
    );
  }
  return { backend, census };
}

async function captureLeg(browser, options) {
  const { args, engine, hash, variant } = options;
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
    page.on("console", (message) => {
      consoleLines.push({ type: message.type(), text: message.text() });
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const query = diagnosticQuery(engine);
    process.stderr.write(
      `[surface-schedule] ${engine}/${variant}: loading ${query}\n`,
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
          `[surface-schedule] ${engine}/${variant}: ${state.rowText || "(progress hidden)"}\n`,
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
          const fatalConsole = consoleLines.filter((line) =>
            fatalConsoleLine(line.type, line.text),
          );
          if (pageErrors.length > 0 || fatalConsole.length > 0) {
            throw new SurfaceBrowserCheckingError(
              `page emitted ${pageErrors.length} page error(s) and ${fatalConsole.length} fatal console line(s): ` +
                [...pageErrors, ...fatalConsole.map((line) => line.text)]
                  .slice(0, 3)
                  .join(" | "),
            );
          }
          const image = await decodePng(page, canvas.png);
          return {
            engine,
            variant,
            backend: exact.backend,
            census: exact.census,
            elapsedMs: Date.now() - startedAt,
            geometry: canvas.geometry,
            image,
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
  const seen = new Set();
  const overlays = [];
  for (const overlay of groups.flat()) {
    const normalized = {
      x: overlay.x,
      y: overlay.y,
      width: overlay.width,
      height: overlay.height,
    };
    const key = JSON.stringify(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      overlays.push(normalized);
    }
  }
  return overlays;
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

function compareImages(off, on) {
  if (
    off.image.width !== on.image.width ||
    off.image.height !== on.image.height
  ) {
    throw new SurfaceBrowserCheckingError(
      `schedule A/B images have different dimensions (${off.image.width}x${off.image.height} vs ${on.image.width}x${on.image.height})`,
    );
  }
  const overlays = unionOverlays(off.geometry.overlays, on.geometry.overlays);
  let eligible = 0;
  let changed = 0;
  let strong = 0;
  let maxDelta = 0;
  let absoluteSum = 0;
  const { width, height } = off.image;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (insideOverlay(x, y, overlays)) continue;
      const offset = (y * width + x) * 4;
      const red = Math.abs(off.image.data[offset] - on.image.data[offset]);
      const green = Math.abs(
        off.image.data[offset + 1] - on.image.data[offset + 1],
      );
      const blue = Math.abs(
        off.image.data[offset + 2] - on.image.data[offset + 2],
      );
      const delta = Math.max(red, green, blue);
      eligible++;
      absoluteSum += red + green + blue;
      maxDelta = Math.max(maxDelta, delta);
      if (delta >= PIXEL_NOISE_FLOOR) changed++;
      if (delta >= PIXEL_STRONG_FLOOR) strong++;
    }
  }
  if (eligible === 0) {
    throw new SurfaceBrowserCheckingError(
      "all schedule A/B pixels are covered by UI overlays",
    );
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
  const requiredChanged = Math.max(
    MIN_CHANGED_PIXELS,
    Math.ceil(eligible * MIN_CHANGED_SHARE),
  );
  const requiredStrong = Math.max(
    MIN_STRONG_PIXELS,
    Math.ceil(eligible * MIN_STRONG_SHARE),
  );
  if (
    result.changed < requiredChanged ||
    result.strong < requiredStrong ||
    result.maxDelta < PIXEL_STRONG_FLOOR
  ) {
    throw new SurfaceBrowserCheckingError(
      `schedule-on did not structurally differ from schedule-off: ` +
        `${result.changed}/${eligible} changed (need ${requiredChanged}), ` +
        `${result.strong}/${eligible} strong (need ${requiredStrong}), max ${result.maxDelta}`,
    );
  }
  return result;
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
      `[surface-schedule] selecting spongeOfFerns and minting one shared camera pose\n`,
    );
    const onHash = await mintShippedPresetPose(browser, args);
    const offHash = deriveSceneHash(onHash, (document) => {
      delete document.schedule;
    });
    const schedule = assertOnlyScheduleDiffers(onHash, offHash);

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
      );
      process.stdout.write(
        `PASS ${engine}/schedule-effect: changed=${delta.changed}/${delta.eligible} ` +
          `(${percentage(delta.changedShare)}) strong=${delta.strong} ` +
          `(${percentage(delta.strongShare)}) meanAbs=${delta.meanAbs.toFixed(3)} ` +
          `max=${delta.maxDelta}\n`,
      );
    }

    process.stdout.write(
      `PASS spongeOfFerns schedule depth=${schedule.depth}, ` +
        `B maps=${schedule.transforms.length}; both Surface engines admitted, settled, drew, and changed under B\n`,
    );
    if (!args.release) {
      process.stderr.write(
        "[surface-schedule] DIAGNOSTIC PASS — rerun with --mode=x11:<display> on a real driver for release evidence\n",
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
    `[surface-schedule] ${checking ? "CHECKING FAILURE" : "UNEXPECTED FAILURE"}: ` +
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = checking ? 2 : 1;
});
