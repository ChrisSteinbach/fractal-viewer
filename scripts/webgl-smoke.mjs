#!/usr/bin/env node
/**
 * fr-k35: headless WebGL smoke test for the production fractal app, booted
 * against a REAL WebGL2 context via SwiftShader (Google's software
 * Vulkan-backed GL implementation) — the committed, repeatable form of the
 * SwiftShader browser recipe, so "does the app still boot and render in a
 * headless/CI box with no real GPU" is a `node scripts/webgl-smoke.mjs` away
 * instead of a one-off manual recipe. Boots the app exactly as a user's
 * browser would (no mocked canvas, no stubbed renderer) and asserts:
 *   1. a WebGL context is obtainable at all — mirrors `webglAvailable()` in
 *      src/app/main.ts, the same guard the app itself runs before
 *      constructing its renderer,
 *   2. the app's own boot sequence didn't call `showError()` (the `#error`
 *      element — see main.ts's `webglAvailable()` check and the
 *      renderer-construction try/catch around `new FractalScene()` — stays
 *      empty),
 *   3. the boot-time chaos-game render actually produced points
 *      (`#pointCount` goes non-zero) — i.e. not just "a canvas exists" but
 *      "the app really ran the chaos game and pushed points through WebGL".
 *
 * Usage:
 *   node scripts/webgl-smoke.mjs [--url=https://host:port] [--path=/]
 *     [--timeout=30000] [--screenshot=<path>]
 *
 * Without --url, this spawns `npm run dev` itself and tears it down when
 * done (including on error) — the whole point being a one-shot
 * `node scripts/webgl-smoke.mjs` with no other setup, runnable in CI.
 *
 * Exit code is non-zero unless all three assertions above pass.
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/** Vite's conventional default port — used only as a last-resort fallback if
 * spawnDevServer's own stdout-announced port is somehow never seen (see its
 * doc); the normal case uses whatever port Vite actually reports. */
const DEV_SERVER_PORT = 5173;
const DEV_SERVER_TIMEOUT_MS = 60_000;

function parseArgs(argv) {
  const args = {
    url: undefined,
    path: "/",
    timeout: 30_000,
    screenshot: undefined,
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
      case "url":
        args.url = value.replace(/\/+$/, "");
        break;
      case "path":
        args.path = value;
        break;
      case "timeout":
        args.timeout = Number(value);
        break;
      case "screenshot":
        args.screenshot = value;
        break;
      default:
        throw new Error(`Unknown flag: --${key}`);
    }
  }
  return args;
}

/** Poll `url` (ignoring the dev server's self-signed cert) until it responds
 * with any HTTP status, or throw after `timeoutMs`. */
function pollUntilUp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = https.get(
        url,
        { rejectUnauthorized: false, timeout: 5_000 },
        (res) => {
          res.resume(); // drain and discard — we only care that something answered.
          resolve();
        },
      );
      req.on("error", () => {
        if (Date.now() >= deadline) {
          reject(
            new Error(
              `Timed out waiting for ${url} to respond after ${timeoutMs}ms`,
            ),
          );
          return;
        }
        setTimeout(attempt, 500);
      });
      req.on("timeout", () => req.destroy());
    }
    attempt();
  });
}

/** Vite's own "Local: https://host:PORT/" announcement — parsed out of its
 * stdout so this script talks to whatever port Vite ACTUALLY bound, not a
 * hardcoded guess. Matters because `npm run dev` auto-increments past 5173
 * when something else already holds it (observed in the wild: a stray dev
 * server left running from an unrelated earlier session) — polling a fixed
 * port would then silently succeed against THAT other server instead of the
 * one this script just spawned, which is exactly the kind of "looks fine,
 * tests the wrong thing" failure a smoke test must not have. */
const VITE_LOCAL_URL_RE = /Local:\s+https?:\/\/[^/\s]+:(\d+)/;

/** Spawn `npm run dev` in its own process group (so `killDevServer` can take
 * down Vite's own child processes too, not just the `npm` wrapper). Returns
 * the child plus a promise for the port Vite reports listening on. */
function spawnDevServer() {
  const child = spawn("npm", ["run", "dev"], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let resolvePort;
  const portPromise = new Promise((resolve) => {
    resolvePort = resolve;
  });
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(`[dev-server] ${text}`);
    const match = VITE_LOCAL_URL_RE.exec(text);
    if (match) resolvePort(Number(match[1]));
  });
  child.stderr.on("data", (chunk) =>
    process.stderr.write(`[dev-server] ${chunk}`),
  );
  return { child, portPromise };
}

function killDevServer(child) {
  if (!child || child.killed || child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Already gone — nothing to do.
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let devServer = null;
  let base = args.url;
  if (!base) {
    console.error("[webgl-smoke] no --url given; spawning `npm run dev`...");
    const spawned = spawnDevServer();
    devServer = spawned.child;
    // Prefer the port Vite actually announces (see spawnDevServer's doc);
    // fall back to the conventional default only if that announcement is
    // somehow never seen within the startup timeout.
    const announcedPort = await Promise.race([
      spawned.portPromise,
      new Promise((resolve) =>
        setTimeout(() => resolve(null), DEV_SERVER_TIMEOUT_MS),
      ),
    ]);
    base = `https://localhost:${announcedPort ?? DEV_SERVER_PORT}`;
    try {
      await pollUntilUp(`${base}${args.path}`, DEV_SERVER_TIMEOUT_MS);
    } catch (err) {
      killDevServer(devServer);
      throw err;
    }
    console.error(`[webgl-smoke] dev server responding at ${base}`);
  } else {
    console.error(`[webgl-smoke] using existing server at ${base}`);
  }

  const targetUrl = `${base}${args.path}`;
  let browser = null;
  let pass = false;
  try {
    // The SwiftShader launch recipe. Three things have to line up together,
    // and dropping any one of them silently falls back to a WebGL-less
    // browser instead of failing loudly:
    //   - `executablePath: chromium.executablePath()` pins this to the
    //     Playwright-BUNDLED Chromium (chrome-linux64) — only it ships
    //     `libvk_swiftshader.so` + ANGLE's SwiftShader backend; a system
    //     Chrome/Chromium typically does not.
    //   - `headless: false` + the explicit `--headless=new` arg: asking
    //     Playwright for `headless: true` launches Chrome's OLD headless
    //     mode (a bare `--headless`), which never yields a real WebGL
    //     context no matter what GL flags are passed alongside it. Setting
    //     `headless: false` stops Playwright from injecting that old flag,
    //     and NEW headless mode is instead requested explicitly via
    //     `--headless=new` — that combination is what actually works.
    //   - `delete env.DISPLAY`: forces Chrome onto the offscreen SwiftShader
    //     path. Leaving an inherited (e.g. X11-forwarded) DISPLAY set lets
    //     Chrome try to use that GLX instead, which is a different and
    //     broken path in a headless/CI box.
    const env = { ...process.env };
    delete env.DISPLAY; // force offscreen SwiftShader, not the broken X11-forwarded GLX
    console.error(
      "[webgl-smoke] launching the Playwright-bundled Chromium with SwiftShader...",
    );
    browser = await chromium.launch({
      executablePath: chromium.executablePath(), // the Playwright-BUNDLED Chromium (chrome-linux64) — only it ships libvk_swiftshader.so / ANGLE
      headless: false, // MUST be false so Playwright does NOT inject the old --headless; we pass --headless=new ourselves
      env,
      args: [
        "--headless=new",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--no-sandbox",
      ],
    });
    const page = await browser.newPage({
      ignoreHTTPSErrors: true, // dev server's self-signed basicSsl cert
      viewport: { width: 1280, height: 900 },
    });
    page.on("console", (msg) => {
      process.stderr.write(`[page:${msg.type()}] ${msg.text()}\n`);
    });
    page.on("pageerror", (err) => {
      process.stderr.write(`[page:uncaught] ${err.stack ?? err.message}\n`);
    });

    console.error(`[webgl-smoke] navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: "load", timeout: args.timeout });

    // Assertion 1: a WebGL context is obtainable at all — mirrors the app's
    // own `webglAvailable()` guard (src/app/main.ts), checked independently
    // here on a throwaway canvas rather than by reaching into the app's own
    // renderer internals.
    const webgl = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl2") ||
        canvas.getContext("webgl") ||
        canvas.getContext("experimental-webgl");
      if (!gl) return { ok: false, api: null, renderer: null };
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : null;
      const api =
        typeof WebGL2RenderingContext !== "undefined" &&
        gl instanceof WebGL2RenderingContext
          ? "webgl2"
          : "webgl";
      return { ok: true, api, renderer };
    });
    // The renderer string is informational, not a pass/fail signal on its
    // own — a real-GPU machine legitimately reports a hardware renderer
    // here and should still pass. Only note it when it's NOT the software
    // path this script exists to exercise.
    if (webgl.ok && webgl.renderer && !/swiftshader/i.test(webgl.renderer)) {
      console.error(
        `[webgl-smoke] note: hardware GL renderer in use ("${webgl.renderer}"), not the SwiftShader software path`,
      );
    }

    // Assertion 2: the app's boot sequence didn't call `showError()` — see
    // main.ts's `webglAvailable()` check and the try/catch around
    // `new FractalScene()`, both of which route failures into #error.
    const bootError = await page.evaluate(() => {
      const el = document.getElementById("error");
      const text = el ? (el.textContent || "").trim() : "";
      return text.length ? text : null;
    });

    // Assertion 3: the boot-time chaos-game render actually produced points
    // (main.ts's `regenerate()` runs on boot and fills in #pointCount).
    // Wrapped in try/catch — a timeout here is a real (recorded) assertion
    // failure, not a reason to throw out of main and skip the summary.
    let pointCount = 0;
    try {
      await page.waitForFunction(
        () => {
          const el = document.getElementById("pointCount");
          if (!el) return false;
          return Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
        },
        undefined,
        { timeout: args.timeout, polling: 100 },
      );
      pointCount = await page.evaluate(() =>
        Number(
          (document.getElementById("pointCount")?.textContent || "").replace(
            /[^\d]/g,
            "",
          ),
        ),
      );
    } catch (err) {
      console.error(
        `[webgl-smoke] point count wait timed out: ${err instanceof Error ? err.message : String(err)}`,
      );
      pointCount = 0;
    }

    if (args.screenshot) {
      await mkdir(path.dirname(args.screenshot), { recursive: true });
      await page.screenshot({ path: args.screenshot, fullPage: true });
      console.error(`[webgl-smoke] screenshot written to ${args.screenshot}`);
    }

    pass = webgl.ok && bootError === null && pointCount > 0;

    const rendererLabel = !webgl.ok
      ? "(no WebGL context)"
      : (webgl.renderer ?? "(no WEBGL_debug_renderer_info)");
    console.error("[webgl-smoke] ======== SUMMARY ========");
    console.error(`[webgl-smoke] URL: ${targetUrl}`);
    console.error(
      `[webgl-smoke] WebGL: ${webgl.ok ? webgl.api : "unavailable"} — ${rendererLabel}`,
    );
    console.error(`[webgl-smoke] boot error: ${bootError ?? "none"}`);
    console.error(`[webgl-smoke] point count: ${pointCount.toLocaleString()}`);
    console.error(`[webgl-smoke] VERDICT: ${pass ? "PASS" : "FAIL"}`);
  } finally {
    if (browser) await browser.close();
    killDevServer(devServer);
  }
  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error("[webgl-smoke] fatal:", err);
  process.exitCode = 1;
});
