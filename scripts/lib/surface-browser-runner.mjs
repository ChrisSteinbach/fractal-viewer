import crypto from "node:crypto";
import process from "node:process";
import { chromium } from "playwright-core";
import { contendedReason, quietBaseline } from "./machine-quiet.mjs";

/**
 * THE SHARED WARM-BROWSER SESSION (`npm run verify`).
 *
 * The orchestrator (scripts/verify.mjs) builds once, serves `dist/` once,
 * takes the boot machine-quiet baseline once, launches ONE Chromium per
 * browser signature, and then runs the named gates SEQUENTIALLY as child
 * processes that CONNECT to that browser over CDP instead of launching their
 * own. The two environment variables below are the whole handoff: the
 * orchestrator sets them on every gate it spawns, and `launchSurfaceBrowser`
 * consults them at its existing call site — a gate's own code does not
 * change to join the warm session, and with no orchestrator running the
 * variables are absent and every gate behaves exactly as before.
 *
 * A shared browser is a real browser: contexts are per-gate (fresh storage,
 * pinned viewport, reduced motion) and GPU work stays serial because the
 * orchestrator runs gates one at a time. What is amortized is what each gate
 * used to pay privately — the browser boot, its GPU process bring-up, and
 * the shader-program caches (the ~25s Mesa GLSL link cliff lands once per
 * session instead of once per gate). What is deliberately NOT amortized is
 * the machine-quiet certification: each gate still samples its own baseline
 * at connect time, because the certification is per-run by design and an
 * idle shared browser contributes ~0 engine-time delta while its client
 * samples.
 *
 * ISOLATION IS CHROMIUM'S, NOT OURS. A gate process that exits without
 * cleanup — crash, hang then kill, hard exit — drops its CDP client
 * transport, and Chromium destroys the browser contexts that client created
 * (measured: the devtools /json/list target list is empty 200ms after a
 * client that had a live page exits without closing). So a crashed gate
 * cannot leak contexts into the next gate's session, and `browser.close()`
 * on a connectOverCDP client only DISCONNECTS — a gate's ordinary cleanup
 * cannot kill the shared browser. The orchestrator still recycles the
 * browser after any gate failure, as cheap insurance against a wedged GPU
 * context a fresh page might inherit.
 *
 * The signature comparison is what keeps mode semantics exact: the
 * orchestrator advertises the signature of the browser it actually launched
 * (derived from `surfaceLaunchOptions(mode)` — the X display and the full
 * WebGPU/SwiftShader argument set), and a gate that wants a different
 * signature — a different mode, or a gate with private launch options like
 * surface-repro's ANGLE-GL SwiftShader — falls back to its own browser with
 * a one-line note. Never connect a gate to a browser shaped differently
 * from what its own launcher would have built.
 */
export const SHARED_BROWSER_CDP_ENV = "GATE_BROWSER_CDP";
export const SHARED_BROWSER_SIG_ENV = "GATE_BROWSER_SIG";

/** `browserSignature` truncates to this many hex chars — 48 bits of a SHA-1
 * over a small JSON fingerprint; collision odds are irrelevant against a
 * fixed alphabet of modes on one machine. */
const SIGNATURE_CHARS = 12;

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
        "--ozone-platform=x11",
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

/**
 * PURE over `surfaceLaunchOptions(mode)`. The identity of the browser a gate
 * wants: the X display it targets plus the exact argument set that shapes
 * its WebGPU/SwiftShader backend. The orchestrator advertises the signature
 * of the browser it launched; a gate whose desired signature differs runs
 * standalone, so mode semantics stay exact without the runner knowing any
 * gate's private options.
 */
export function browserSignature(mode) {
  const launch = surfaceLaunchOptions(mode);
  const fingerprint = JSON.stringify({
    display: launch.env?.DISPLAY ?? null,
    args: launch.args,
  });
  return crypto
    .createHash("sha1")
    .update(fingerprint)
    .digest("hex")
    .slice(0, SIGNATURE_CHARS);
}

/** The shared session's CDP endpoint when the environment offers one shaped
 * like this gate's own browser, else `null` (with a reason a caller may
 * log). Malformed or stale variables fall back to standalone rather than
 * taking a gate down — the orchestrator's env is an optimization, not a
 * contract the gate must enforce with an exit code. */
export function sharedSessionFor(mode) {
  const endpoint = process.env[SHARED_BROWSER_CDP_ENV];
  const wanted = browserSignature(mode);
  const advertised = process.env[SHARED_BROWSER_SIG_ENV];
  if (!endpoint) return { endpoint: null, reason: "no shared session" };
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(endpoint)) {
    return { endpoint: null, reason: `malformed ${SHARED_BROWSER_CDP_ENV}` };
  }
  if (advertised !== wanted) {
    return {
      endpoint: null,
      reason: `browser shape mismatch (session ${advertised ?? "none"}, wanted ${wanted})`,
    };
  }
  return { endpoint, reason: null };
}

function noteSharedSessionMiss(reason) {
  console.error(
    `[surface-browser] not joining the shared session: ${reason} — launching a private browser.`,
  );
}

/**
 * The machine's conditions for one gate run: sampled while the gate has
 * nothing of its own on the GPU. In the shared session that moment is AFTER
 * the connect — the browser is already up and idle (the connect itself adds
 * no GPU work), so the sample correctly counts it as a separate process and
 * a leaked busy page from a previous leg would name itself here. The
 * STANDALONE path samples BEFORE its launch for the same reason: the
 * browser's own bring-up is part of "this run's" GPU work and must not
 * pollute its own baseline.
 */
async function takeQuietBaseline() {
  const quiet = await quietBaseline((line) =>
    console.error(`[surface-browser] ${line}`),
  );
  const contended = contendedReason(quiet);
  if (contended) {
    console.error(
      `[surface-browser] NOTE: another process was already on the GPU — ${contended}.` +
        " A behavior verdict still stands; a timing or settle-budget row" +
        " from this run does not.",
    );
  }
  return quiet;
}

export async function launchSurfaceBrowser(mode) {
  const shared = sharedSessionFor(mode);
  if (shared.endpoint !== null) {
    try {
      const browser = await chromium.connectOverCDP(shared.endpoint, {
        timeout: 10_000,
      });
      browser.gpuQuiet = await takeQuietBaseline();
      return browser;
    } catch (error) {
      noteSharedSessionMiss(
        `connect over CDP failed (${String(error?.message ?? error)})`,
      );
    }
  } else if (process.env[SHARED_BROWSER_CDP_ENV]) {
    noteSharedSessionMiss(shared.reason);
  }
  // The machine's conditions, before this launcher puts its own browser on
  // the GPU. Every real-driver gate that comes through here asks for "a
  // QUIET machine" in prose; the baseline is what makes that checkable —
  // in the run's own output, with UNKNOWN spelled out rather than reading
  // as quiet. Report-only: a behavior gate's verdict survives contention,
  // and each gate that measures (rather than asserts) refuses on its own —
  // `quiet` is exposed on the browser for it.
  const quiet = await takeQuietBaseline();
  const launch = surfaceLaunchOptions(mode);
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false,
    env: launch.env,
    args: launch.args,
  });
  browser.gpuQuiet = quiet;
  return browser;
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
