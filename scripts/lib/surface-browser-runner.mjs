import process from "node:process";
import { chromium } from "playwright-core";

export const RELEASE_VIEWPORT = Object.freeze({ width: 960, height: 540 });
export const RELEASE_DEVICE_SCALE_FACTOR = 1;
export const RELEASE_SETTLE_STAGE = 8;

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

const STAGE_GRACE_MS = 1_000;
const STABLE_GAP_MS = 300;
const STABLE_ATTEMPTS = 5;
const POLL_MS = 250;

export class SurfaceBrowserCheckingError extends Error {
  constructor(message) {
    super(message);
    this.name = "SurfaceBrowserCheckingError";
  }
}

export function surfaceLaunchOptions(mode) {
  const env = { ...process.env };
  if (/^x11:.+/.test(mode)) {
    env.DISPLAY = mode.slice(4);
    return {
      env,
      args: [
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan",
        "--ignore-gpu-blocklist",
        "--ignore-certificate-errors",
        "--no-sandbox",
      ],
    };
  }
  if (mode !== "sw") {
    throw new Error(`mode must be x11:<display> or sw (got ${mode})`);
  }
  delete env.DISPLAY;
  return {
    env,
    args: [
      "--headless=new",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
      "--ignore-certificate-errors",
      "--use-webgpu-adapter=swiftshader",
      "--use-vulkan=swiftshader",
      "--no-sandbox",
    ],
  };
}

export async function launchSurfaceBrowser(mode) {
  const launch = surfaceLaunchOptions(mode);
  return chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false,
    env: launch.env,
    args: launch.args,
  });
}

/**
 * Let the production boot path frame a pose-less document, then ask the real
 * collection encoder for the exact persisted camera/4D document. The result
 * is used as a fresh-context capture input; it is never inferred from a cloud
 * screenshot or reconstructed by the verifier.
 */
export async function mintPersistedSurfacePose(browser, options) {
  const { url, hash } = options;
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: RELEASE_VIEWPORT,
    deviceScaleFactor: RELEASE_DEVICE_SCALE_FACTOR,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    const base = url.replace(/\/+$/, "");
    await bootScene(page, `${base}/?surfacestate${hash}`);
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
        "production collection encoder did not return a persisted scene",
      );
    }
    return `#${encoded}`;
  } finally {
    await context.close().catch(() => {});
  }
}

function diagnosticQuery(engine) {
  if (engine === "compute") return "?surfacestate&surfacecompute";
  if (engine === "webgl") return "?surfacestate&surfacegl";
  throw new Error(`unknown surface engine ${engine}`);
}

async function bootScene(page, target) {
  await page.goto(target, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const el = document.getElementById("pointCount");
      return !!el && Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
    },
    undefined,
    { timeout: 60_000, polling: 100 },
  );
}

async function enterSurface(page) {
  const deadline = Date.now() + 15_000;
  let state = null;
  for (;;) {
    state = await page.evaluate(() => {
      const button = document.getElementById("modeSurfaceBtn");
      return {
        present: !!button,
        disabled: button?.disabled ?? true,
        pressed: button?.getAttribute("aria-pressed") === "true",
        title: button?.title ?? "",
      };
    });
    if (state.present && !state.disabled) break;
    if (Date.now() > deadline) return state;
    await page.waitForTimeout(100);
  }
  if (!state.pressed) {
    await page.evaluate(() => {
      document
        .getElementById("modeSurfaceBtn")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
  return state;
}

export async function pollSurfaceState(page) {
  const value = await page.evaluate(() => {
    const probe = window.__surfaceState?.() ?? null;
    const row = document.getElementById("surfaceProgress");
    const rowText =
      row && !row.classList.contains("hidden") ? row.textContent || "" : "";
    return { probe, rowText };
  });
  if (value.probe === null) {
    throw new SurfaceBrowserCheckingError(
      "window.__surfaceState is absent; load the page with ?surfacestate",
    );
  }
  const p = value.probe;
  const settled =
    p.mode === "surface" &&
    p.firstFrame === true &&
    p.settled === true &&
    p.settlePending === false &&
    p.previewActive === false &&
    p.settleActive === false;
  return { ...value, settled };
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
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (
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
  return { png, geometry };
}

async function captureStable(page) {
  await page.waitForTimeout(STAGE_GRACE_MS);
  let latest = null;
  for (let attempt = 0; attempt < STABLE_ATTEMPTS; attempt++) {
    const first = await captureCanvas(page);
    await page.waitForTimeout(STABLE_GAP_MS);
    const second = await captureCanvas(page);
    latest = second;
    if (first.png.equals(second.png)) return { ...second, stable: true };
  }
  return { ...latest, stable: false };
}

function fatalConsoleLine(type, text) {
  if (type === "error") return true;
  return /device lost|validation error|uncaptured error/i.test(text);
}

function validateCaptureProbe(probe, expectedEngine, release) {
  if (probe.engine !== expectedEngine) {
    throw new SurfaceBrowserCheckingError(
      `capture ran engine=${probe.engine ?? "none"}, expected ${expectedEngine}`,
    );
  }
  const backend = probe.backend ?? null;
  if (!backend || typeof backend.label !== "string" || !backend.label.trim()) {
    throw new SurfaceBrowserCheckingError(
      `capture did not disclose the active ${expectedEngine} backend`,
    );
  }
  if (release && backend.software !== false) {
    throw new SurfaceBrowserCheckingError(
      `release capture requires a real driver; active backend is ${backend.label} (software=${String(backend.software)})`,
    );
  }
  const census = probe.census ?? null;
  if (!census) {
    throw new SurfaceBrowserCheckingError(
      `capture did not disclose a settled ${expectedEngine} ray census`,
    );
  }
  const values = [census.rays, census.covered, census.miss, census.exhausted];
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new SurfaceBrowserCheckingError("settled ray census is malformed");
  }
  if (census.covered + census.miss + census.exhausted !== census.rays) {
    throw new SurfaceBrowserCheckingError(
      `settled ray census does not partition its ${census.rays} rays`,
    );
  }
  return { backend, census };
}

/**
 * Run one persisted document through the production app and capture only the
 * true eight-pass settled latch. Every call uses a fresh, reduced-motion,
 * DSF-1 browser context; the caller keeps GPU work serial.
 */
export async function captureSettledSurface(browser, options) {
  const {
    url,
    hash,
    engine,
    timeoutMs,
    dwellMs = 2_000,
    release = false,
    log = () => {},
  } = options;
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: RELEASE_VIEWPORT,
    deviceScaleFactor: RELEASE_DEVICE_SCALE_FACTOR,
    reducedMotion: "reduce",
  });
  const consoleLines = [];
  const pageErrors = [];
  const startedAt = Date.now();
  let page;
  try {
    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs + 60_000);
    page.on("console", (message) => {
      const entry = { type: message.type(), text: message.text() };
      consoleLines.push(entry);
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const base = url.replace(/\/+$/, "");
    await bootScene(page, `${base}/${diagnosticQuery(engine)}${hash}`);
    const button = await enterSurface(page);
    if (!button?.present || button.disabled) {
      throw new SurfaceBrowserCheckingError(
        `Surface mode is ${button?.present ? "disabled" : "missing"}: ${button?.title ?? ""}`,
      );
    }

    const deadline = startedAt + timeoutMs;
    let heldSince = null;
    let lastRow = null;
    for (;;) {
      const state = await pollSurfaceState(page);
      if (state.rowText !== lastRow) {
        lastRow = state.rowText;
        log(state.rowText || "(surface progress hidden)");
      }
      if (state.settled) {
        heldSince ??= Date.now();
        if (Date.now() - heldSince >= dwellMs) {
          const capture = await captureStable(page);
          const after = await pollSurfaceState(page);
          if (!after.settled) {
            heldSince = null;
            continue;
          }
          if (!capture.stable) {
            throw new SurfaceBrowserCheckingError(
              "settled canvas was not byte-stable",
            );
          }
          if (
            capture.geometry.width !== RELEASE_VIEWPORT.width ||
            capture.geometry.height !== RELEASE_VIEWPORT.height
          ) {
            throw new SurfaceBrowserCheckingError(
              `canvas is ${capture.geometry.width}x${capture.geometry.height}, expected ${RELEASE_VIEWPORT.width}x${RELEASE_VIEWPORT.height}`,
            );
          }
          const exact = validateCaptureProbe(after.probe, engine, release);
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
          return {
            png: capture.png,
            geometry: capture.geometry,
            stable: true,
            stage: RELEASE_SETTLE_STAGE,
            engine,
            backend: exact.backend,
            census: exact.census,
            probe: after.probe,
            elapsedMs: Date.now() - startedAt,
            console: consoleLines,
            pageErrors,
          };
        }
      } else {
        heldSince = null;
      }
      if (Date.now() > deadline) {
        throw new SurfaceBrowserCheckingError(
          `surface did not hold the settled latch inside ${timeoutMs}ms`,
        );
      }
      await page.waitForTimeout(POLL_MS);
    }
  } finally {
    await context.close().catch(() => {});
  }
}

export async function assertSurfaceRefusal(browser, options) {
  const { url, hash, engine = "webgl" } = options;
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: RELEASE_VIEWPORT,
    deviceScaleFactor: RELEASE_DEVICE_SCALE_FACTOR,
    reducedMotion: "reduce",
  });
  const pageErrors = [];
  const fatalConsole = [];
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (fatalConsoleLine(message.type(), message.text())) {
        fatalConsole.push(message.text());
      }
    });
    const base = url.replace(/\/+$/, "");
    await bootScene(page, `${base}/${diagnosticQuery(engine)}${hash}`);
    const button = await page.evaluate(() => {
      const value = document.getElementById("modeSurfaceBtn");
      return {
        present: !!value,
        disabled: value?.disabled ?? true,
        title: value?.title ?? "",
      };
    });
    if (!button.present || !button.disabled) {
      throw new SurfaceBrowserCheckingError(
        `expected a Surface refusal, got ${button.present ? "an enabled button" : "no button"}`,
      );
    }
    if (pageErrors.length > 0 || fatalConsole.length > 0) {
      throw new SurfaceBrowserCheckingError(
        `refusal page emitted ${pageErrors.length} page error(s) and ${fatalConsole.length} fatal console line(s)`,
      );
    }
    return { title: button.title, pageErrors, fatalConsole };
  } finally {
    await context.close().catch(() => {});
  }
}
