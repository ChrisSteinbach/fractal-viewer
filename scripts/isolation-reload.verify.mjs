#!/usr/bin/env node
/**
 * fr-su3r isolation-reload verifier.
 *
 * On GitHub Pages the app cannot get COOP/COEP from the server (GitHub Pages
 * sends neither header), so a first-ever visit necessarily loads NON-isolated.
 * `src/app/register-sw.ts` registers the service worker and, the instant that
 * worker takes control (`controllerchange`), fires exactly one
 * `window.location.reload()` — the reloaded navigation is intercepted by the
 * worker (`src/app/sw/sw.ts`) and served WITH `Cross-Origin-Opener-Policy` /
 * `Cross-Origin-Embedder-Policy`, so `SharedArrayBuffer` becomes available
 * for the flame renderer's fast path. Anything the user does inside that
 * reload window is real, current-session interaction — but it used to vanish
 * with nothing to blame: the scene document survives the trip (it lives in
 * the `#v1=` hash, which the reloaded page restores verbatim), yet
 * `AppState.renderMode` is session-only by design (`state.ts`) and was never
 * carried across, so picking a Flame-group preset — or switching render mode
 * by hand — inside the window came back in Points mode after reload, with no
 * trace of the choice. `swirl` is exactly such a preset
 * (`PRESET_RENDER_HINTS.swirl === "flame"`, see `src/fractal/presets.ts`): a
 * correct app that has just loaded `swirl` and then isolation-reloads must
 * still show Flame mode afterward. The fix (`src/app/isolation-handoff.ts` +
 * the `onBeforeIsolationReload`/`consumeIsolationHandoff` wiring in
 * `src/app/main.ts`) snapshots `state.renderMode` into sessionStorage
 * immediately before the reload and re-applies it on the very next boot.
 *
 * Why this script has to exist rather than reusing an existing harness:
 * neither everyday local surface forces that window open. `npm run dev`
 * never reaches this code path at all — `register-sw.ts` registers no
 * service worker in dev, which gets COOP/COEP natively from Vite's
 * dev-server headers instead, so `wantsIsolationReload` is false and the
 * dance never arms. `npm run preview` deliberately withholds those headers
 * (see the comment on `server.headers` in `vite.config.ts`) precisely so
 * the reload CAN fire against a real production build — but the window it
 * opens is unthrottled localhost timing, over between registration and
 * reload before a person, let alone a script, could act inside it. Hence
 * the inline `node:http` server below, which likewise sends NO
 * `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers at
 * all, plus `--sw-delay`, which widens the resulting window to a
 * deterministic, generous size (by delaying only the `sw.js` response) so
 * an action taken inside it — like the render-mode switch this bug lost —
 * is reproduced by timing DISCIPLINE rather than timing luck.
 *
 * What this script does, end to end:
 *   1. Serves `dist/app` from `http://127.0.0.1:<port>` with no COOP/COEP,
 *      correct per-extension Content-Type, path-traversal rejected, and the
 *      `sw.js` response alone delayed by `--sw-delay` ms.
 *   2. Boots the app in a real, headless-SwiftShader WebGL2 Chromium (the
 *      `scripts/webgl-smoke.mjs` launch recipe) inside a FRESH
 *      `browser.newContext()` — service-worker registrations are per
 *      context, so this origin starts guaranteed-uncontrolled, which is
 *      required for the dance to arm at all.
 *   3. Confirms the scenario is actually non-isolated/uncontrolled at boot
 *      (fails loudly otherwise — that would mean the server is leaking
 *      COOP/COEP or the harness reused a controlled context).
 *   4. Selects the `swirl` preset through the real `<select id="presetSelect">`
 *      control (Playwright `selectOption`, which fires the same `change`
 *      event a real user's pick does) and confirms the app enters Flame mode
 *      — BEFORE the reload — so a later failure is unambiguously the
 *      reload's fault, not a broken interaction.
 *   5. Waits out the isolation reload (`window.crossOriginIsolated` flipping
 *      to `true`), then asserts: isolation actually engaged, the render mode
 *      is still Flame (the fr-su3r fix — this is the assertion that fails on
 *      unfixed code, where it silently reverts to Points), and the scene
 *      survived too (`location.hash` still starts with `#v1=` — the
 *      pre-existing behavior this fix must not regress).
 *
 * Usage:
 *   npm run build   # once, if dist/app doesn't exist yet
 *   node scripts/isolation-reload.verify.mjs [--sw-delay=5000]
 *     [--timeout=60000] [--shot=/path/to/screenshot.png]
 *
 *   --sw-delay  milliseconds to delay ONLY the sw.js response by, widening
 *               the reload window deterministically (default 5000).
 *   --timeout   how long to wait for window.crossOriginIsolated to flip to
 *               true after the interaction — the reload itself plus the
 *               service-worker install/activate dance (default 60000).
 *   --shot      optional screenshot path, written at the end whether the run
 *               passed or failed.
 *
 * Exit code is non-zero unless every assertion in step 3-5 above passes.
 */
import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.resolve(REPO_ROOT, "dist/app");

/** Timeout for the very first navigation's `load` event. Independent of
 * `--timeout` (which governs the much longer post-interaction reload wait
 * below) — this one only has to cover "the static server answered and the
 * document parsed", which is immediate. */
const NAV_TIMEOUT_MS = 30_000;
/** Timeout for the boot-time chaos-game render to produce points, mirroring
 * `scripts/webgl-smoke.mjs`'s own boot-readiness wait. */
const BOOT_TIMEOUT_MS = 30_000;
/** Timeout for the `swirl` preset's cloud to land and its render-mode hint
 * (`PRESET_RENDER_HINTS`) to actually switch the app into Flame mode — a
 * worker round trip, but a cheap one on SwiftShader. */
const PRESET_TIMEOUT_MS = 20_000;

/** `PRESET_RENDER_HINTS.swirl === "flame"` — see src/fractal/presets.ts. */
const PRESET_VALUE = "swirl";

/** Viewport width matters here beyond the usual "big enough to render":
 * `src/app/main.ts` computes `panelOpen = window.innerWidth > MOBILE_BREAKPOINT`
 * (640, src/app/constants.ts) once, at boot, and `#panel` (which hosts
 * `#presetSelect`) is `visibility: hidden` until it carries the `.open`
 * class (src/app/style.css) — so a narrower viewport would boot with the
 * panel closed and no in-page control to open it back up except clicking
 * `#menuToggle` first. Staying comfortably above the breakpoint keeps the
 * preset select actionable for Playwright's `selectOption` with no extra
 * steps, exactly like a desktop visitor gets by default. */
const VIEWPORT = { width: 1280, height: 900 };

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    swDelay: 5_000,
    timeout: 60_000,
    shot: undefined,
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
      case "sw-delay":
        args.swDelay = Number(value);
        break;
      case "timeout":
        args.timeout = Number(value);
        break;
      case "shot":
        args.shot = value;
        break;
      default:
        throw new Error(`Unknown flag: --${key}`);
    }
  }
  if (!Number.isFinite(args.swDelay) || args.swDelay < 0) {
    throw new Error(
      `--sw-delay must be a non-negative number, got: ${String(args.swDelay)}`,
    );
  }
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) {
    throw new Error(
      `--timeout must be a positive number, got: ${String(args.timeout)}`,
    );
  }
  return args;
}

// ---------------------------------------------------------------------------
// Static server — deliberately COOP/COEP-less (that is the entire point)
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};
const DEFAULT_MIME_TYPE = "application/octet-stream";

/** Resolve a request pathname against `root`, refusing to leave it. Returns
 * the resolved absolute path, or `null` if the request would escape `root`
 * (path traversal via `..` segments, decoded or not). */
function resolveRequestPath(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : `.${decoded}`;
  const resolved = path.resolve(root, relative);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

/** The one fetch pipeline: resolve -> traversal-check -> directory-to-index
 * -> 404 -> correct Content-Type -> send, with the `sw.js` response alone
 * delayed by `swDelayMs` (fr-su3r's whole point: a wide, deterministic
 * isolation-reload window). Never sets COOP/COEP — see this file's header. */
async function handleRequest(req, res, root, swDelayMs) {
  const requestUrl = new URL(req.url ?? "/", "http://isolation-reload.invalid");
  const resolved = resolveRequestPath(root, requestUrl.pathname);
  if (!resolved) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden: path traversal rejected\n");
    return;
  }

  let filePath = resolved;
  let stats = await stat(filePath).catch(() => null);
  if (stats?.isDirectory()) {
    filePath = path.join(filePath, "index.html");
    stats = await stat(filePath).catch(() => null);
  }
  if (!stats || !stats.isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Not found: ${requestUrl.pathname}\n`);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? DEFAULT_MIME_TYPE;
  const body = await readFile(filePath);

  const send = () => {
    // Deliberately NO Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy
    // here — sending them would make the isolation reload never arm at all,
    // which defeats the entire purpose of this server (see header doc).
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": body.length,
    });
    res.end(body);
  };

  if (requestUrl.pathname === "/sw.js" && swDelayMs > 0) {
    setTimeout(send, swDelayMs);
  } else {
    send();
  }
}

function createDistServer(root, swDelayMs) {
  return createServer((req, res) => {
    handleRequest(req, res, root, swDelayMs).catch((err) => {
      console.error(
        `[isolation-reload] server error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      res.end("Internal server error\n");
    });
  });
}

/** Bind to port 0 and resolve with whatever port the OS actually assigned —
 * so parallel runs of this script never collide. */
function listenOnEphemeralPort(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("server did not bind to a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const indexHtml = path.join(DIST_DIR, "index.html");
  const distReady = await stat(indexHtml).catch(() => null);
  if (!distReady) {
    console.error(`[isolation-reload] fatal: ${indexHtml} does not exist.`);
    console.error(
      "[isolation-reload] run `npm run build` first, then re-run this script.",
    );
    process.exitCode = 1;
    return;
  }

  const results = [];
  function record(label, ok, detail) {
    console.error(
      `[isolation-reload] ${ok ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`,
    );
    results.push({ label, ok });
  }
  function skip(label, reason) {
    record(label, false, `skipped: ${reason}`);
  }

  let server = null;
  let browser = null;
  let pass = false;
  try {
    server = createDistServer(DIST_DIR, args.swDelay);
    const port = await listenOnEphemeralPort(server);
    const base = `http://127.0.0.1:${port}`;
    console.error(
      `[isolation-reload] serving ${DIST_DIR} at ${base}/ with NO COOP/COEP (sw.js delayed ${args.swDelay}ms)`,
    );

    // The SwiftShader launch recipe, copied from scripts/webgl-smoke.mjs (see
    // its doc for why each piece matters): the Playwright-bundled Chromium,
    // NEW headless mode requested explicitly, DISPLAY removed so Chrome can't
    // fall back to a broken X11-forwarded GLX.
    const env = { ...process.env };
    delete env.DISPLAY;
    console.error(
      "[isolation-reload] launching the Playwright-bundled Chromium with SwiftShader...",
    );
    browser = await chromium.launch({
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

    // A FRESH context: service workers are per-context, so this origin
    // starts guaranteed-uncontrolled — required for the dance to arm at all.
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        console.error(`[page:${msg.type()}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      console.error(`[page:uncaught] ${err.stack ?? err.message}`);
    });

    console.error(`[isolation-reload] navigating to ${base}/`);
    await page.goto(`${base}/`, {
      waitUntil: "load",
      timeout: NAV_TIMEOUT_MS,
    });

    let usable = true;

    // --- Boot readiness, mirroring scripts/webgl-smoke.mjs -----------------
    let pointCountOk = false;
    try {
      await page.waitForFunction(
        () => {
          const el = document.getElementById("pointCount");
          if (!el) return false;
          return Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
        },
        undefined,
        { timeout: BOOT_TIMEOUT_MS, polling: 100 },
      );
      pointCountOk = true;
    } catch (err) {
      console.error(
        `[isolation-reload] boot wait failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const bootError = await page.evaluate(() => {
      const el = document.getElementById("error");
      const text = el ? (el.textContent || "").trim() : "";
      return text.length ? text : null;
    });
    record(
      "app booted cleanly (#error empty, #pointCount > 0)",
      pointCountOk && bootError === null,
      bootError ? `#error: ${bootError}` : undefined,
    );
    if (!pointCountOk || bootError !== null) usable = false;

    // --- Scenario validity: the window must actually be real ---------------
    if (usable) {
      const pre = await page.evaluate(() => ({
        isolated: window.crossOriginIsolated,
        controlled: navigator.serviceWorker.controller !== null,
      }));
      record(
        "pre-reload: window.crossOriginIsolated === false",
        pre.isolated === false,
        `got ${String(pre.isolated)}`,
      );
      record(
        "pre-reload: navigator.serviceWorker.controller === null",
        !pre.controlled,
        pre.controlled ? "a controller is already set" : undefined,
      );
      if (pre.isolated !== false || pre.controlled) {
        console.error(
          "[isolation-reload] scenario invalid — the static server must not be sending " +
            "Cross-Origin-Opener-Policy/Cross-Origin-Embedder-Policy headers (or this " +
            "context was somehow already controlled by a service worker); refusing to continue",
        );
        usable = false;
      }
    } else {
      skip(
        "pre-reload: window.crossOriginIsolated === false",
        "app did not boot cleanly",
      );
      skip(
        "pre-reload: navigator.serviceWorker.controller === null",
        "app did not boot cleanly",
      );
    }

    // --- Interact inside the window: pick the swirl preset -----------------
    if (usable) {
      await page.selectOption("#presetSelect", PRESET_VALUE);
      try {
        await page.waitForFunction(
          () =>
            document
              .getElementById("modeFlameBtn")
              ?.getAttribute("aria-pressed") === "true",
          undefined,
          { timeout: PRESET_TIMEOUT_MS, polling: 100 },
        );
        record(`pre-reload: "${PRESET_VALUE}" preset entered Flame mode`, true);
      } catch (err) {
        record(
          `pre-reload: "${PRESET_VALUE}" preset entered Flame mode`,
          false,
          `timed out after ${PRESET_TIMEOUT_MS}ms — a broken interaction, not the reload's fault (${err instanceof Error ? err.message : String(err)})`,
        );
        usable = false;
      }
    } else {
      skip(
        `pre-reload: "${PRESET_VALUE}" preset entered Flame mode`,
        "scenario was invalid before interacting",
      );
    }

    // --- Wait out the isolation reload --------------------------------------
    let reloadOk = false;
    if (usable) {
      try {
        await page.waitForFunction(
          () => window.crossOriginIsolated === true,
          undefined,
          { timeout: args.timeout, polling: 100 },
        );
        reloadOk = true;
        record(
          "isolation reload fired (crossOriginIsolated became true)",
          true,
        );
      } catch (err) {
        record(
          "isolation reload fired (crossOriginIsolated became true)",
          false,
          `timed out after ${args.timeout}ms (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    } else {
      skip(
        "isolation reload fired (crossOriginIsolated became true)",
        "a prior step failed",
      );
    }

    // --- Assert the outcome after the reload --------------------------------
    if (reloadOk) {
      // Re-evaluate fresh rather than reusing anything captured before the
      // reload — the page navigated out from under us, so any earlier
      // handle would now be stale.
      const post = await page.evaluate(() => ({
        isolated: window.crossOriginIsolated,
        flameActive:
          document
            .getElementById("modeFlameBtn")
            ?.getAttribute("aria-pressed") === "true",
        hash: location.hash,
      }));
      record(
        "post-reload: window.crossOriginIsolated === true",
        post.isolated === true,
        `got ${String(post.isolated)}`,
      );
      record(
        "post-reload: render mode is Flame (fr-su3r fix)",
        post.flameActive === true,
        post.flameActive
          ? undefined
          : 'modeFlameBtn aria-pressed !== "true" — the render-mode hint was lost across the reload',
      );
      record(
        "post-reload: scene survived (location.hash starts with #v1=)",
        post.hash.startsWith("#v1="),
        `hash starts with: ${JSON.stringify(post.hash.slice(0, 12))}`,
      );
    } else {
      skip(
        "post-reload: window.crossOriginIsolated === true",
        "reload never fired",
      );
      skip(
        "post-reload: render mode is Flame (fr-su3r fix)",
        "reload never fired",
      );
      skip(
        "post-reload: scene survived (location.hash starts with #v1=)",
        "reload never fired",
      );
    }

    if (args.shot) {
      try {
        await mkdir(path.dirname(args.shot), { recursive: true });
        await page.screenshot({ path: args.shot, fullPage: true });
        console.error(`[isolation-reload] screenshot written to ${args.shot}`);
      } catch (err) {
        console.error(
          `[isolation-reload] screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    pass = results.length > 0 && results.every((r) => r.ok);
    console.error("[isolation-reload] ======== SUMMARY ========");
    for (const r of results) {
      console.error(
        `[isolation-reload]   ${r.ok ? "PASS" : "FAIL"} — ${r.label}`,
      );
    }
    console.error(`[isolation-reload] VERDICT: ${pass ? "PASS" : "FAIL"}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(() => resolve()));
  }
  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error("[isolation-reload] fatal:", err);
  process.exitCode = 1;
});
