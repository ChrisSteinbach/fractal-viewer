#!/usr/bin/env node
/**
 * Browser verification for the surface render's
 * interaction preview tier and its strip-bounded full-quality traces.
 * Boots the app under SwiftShader (the webgl-smoke launch recipe) and
 * drives two phases:
 *
 * Phase 1 — default system (light): enters Surface mode and asserts the
 * tier split observably: the parked view renders SHARP (stabilized
 * screenshot), a continuous drag renders the low-res preview (markedly
 * smaller JPEG for the same scene), and after release the view settles
 * back to a sharp full-quality frame.
 *
 * Phase 2 — Menger Sponge (20 maps, the map-count-heavy regime that used
 * to wedge the GPU process close up): asserts every screenshot during the
 * settle grind — mid-distance AND zoomed close to the viewplane —
 * completes within a bounded time. Screenshots only complete when the
 * compositor presents, so this is a direct probe of submission
 * boundedness: pre-fix, the close-up full trace was ONE draw call of
 * unbounded GPU time and presents stopped for its whole duration
 * (observed as multi-minute screenshot hangs); post-fix the strip job
 * presents progress every step. Also asserts a fresh drag interrupts the
 * settle (previews resume) and that the WebGL context survives the whole
 * ordeal.
 *
 * Usage: node scripts/surface-tier.verify.mjs [url]
 * (url defaults to https://localhost:5173 — start `npm run dev` first.)
 * Screenshots land in .playwright-mcp/ (gitignored) for eyeballing.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", ".playwright-mcp");
const BASE = (process.argv[2] ?? "https://localhost:5173").replace(/\/+$/, "");

/** Upper bound for any single screenshot while a settle job strips.
 * Generous for SwiftShader, which traces on the CPU AND drains a queue of
 * multi-second frames before a capture can present; the pre-fix unbounded
 * close-up draw blocked presents for the length of the whole trace (an
 * 800x600 Menger close-up is upward of half an hour of SwiftShader work in
 * ONE submission), so even these lax bounds discriminate sharply. */
const SHOT_BOUND_MS = 120_000;
/** The close-up settle grind gets extra queue-drain headroom. */
const CLOSE_SHOT_BOUND_MS = 280_000;

const failures = [];
function check(ok, label) {
  console.error(`[surface-tier] ${ok ? "ok " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const env = { ...process.env };
  delete env.DISPLAY; // offscreen SwiftShader, not X11 GLX (see webgl-smoke.mjs)
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false, // + --headless=new below — the combination that yields WebGL
    env,
    args: [
      "--headless=new",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--no-sandbox",
    ],
  });
  const pageErrors = [];
  let page = null;
  try {
    page = await browser.newPage({
      ignoreHTTPSErrors: true,
      // Small on purpose: SwiftShader traces on the CPU; this keeps the
      // full-quality grinds affordable while still exercising every path.
      viewport: { width: 800, height: 600 },
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));
    // Forward the app's console — the diagnosis when a run aborts.
    page.on("console", (msg) => {
      console.error(`[page:${msg.type()}] ${msg.text()}`);
    });
    page.setDefaultTimeout(CLOSE_SHOT_BOUND_MS + 30_000);
    // Reduced motion: camera glides/chases SNAP instead of easing. Under
    // software GL an exponential camera chase advances by clamped dt per
    // 10s+ frame and keeps invalidating (sub-pixel but nonzero) for
    // minutes — pinning the tier scheduler in preview so the settle under
    // test never fires. The app honors this media query everywhere, and
    // real hardware lands the same tweens in about a second.
    await page.emulateMedia({ reducedMotion: "reduce" });

    const shot = (name) =>
      page.screenshot({
        type: "jpeg",
        quality: 85,
        ...(name ? { path: path.join(OUT_DIR, name) } : {}),
      });

    /** Screenshot bounded by `boundMs` — completion IS the assertion (a
     * present happened within the bound). */
    const boundedShot = async (name, label, boundMs = SHOT_BOUND_MS) => {
      const t0 = Date.now();
      const buf = await shot(name);
      const ms = Date.now() - t0;
      check(ms < boundMs, `${label} presented in ${ms}ms`);
      return buf;
    };

    /** Poll until two consecutive screenshots are byte-identical — the
     * settle job has finished and the canvas is parked. */
    const stableShot = async (name, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      let prev = await shot(null);
      for (;;) {
        await page.waitForTimeout(2_000);
        const cur = await shot(name);
        if (cur.equals(prev)) return cur;
        if (Date.now() > deadline) {
          throw new Error(`view never stabilized within ${timeoutMs}ms`);
        }
        prev = cur;
      }
    };

    /** Assert the canvas keeps PRESENTING DISTINCT FRAMES while a grind
     * runs — the direct discriminator against the pre-fix unbounded draw,
     * which presented NOTHING for the render's whole (30min+) duration.
     * Software GL drains queued multi-second frames at its own pace, so
     * this counts progress within a window instead of bounding any single
     * present. */
    const assertProgress = async (label, windowMs, wantDistinct) => {
      // The baseline shot may itself block through a long queue drain —
      // the window must start only once it lands, or the drain eats it.
      let last = await shot(null);
      const deadline = Date.now() + windowMs;
      let distinct = 0;
      while (Date.now() < deadline && distinct < wantDistinct) {
        await page.waitForTimeout(4_000);
        const cur = await shot(null);
        if (!cur.equals(last)) distinct++;
        last = cur;
      }
      check(
        distinct >= wantDistinct,
        `${label}: ${distinct} distinct presents (want >= ${wantDistinct})`,
      );
      return last;
    };

    const dragStart = () =>
      page.evaluate(() => {
        // interactions.ts listens for mousedown on the CANVAS and
        // mousemove/mouseup on the DOCUMENT — dispatch accordingly. Start
        // away from the center so a visible guide box can't grab it.
        const canvas = document.querySelector("canvas");
        const r = canvas.getBoundingClientRect();
        const x0 = r.left + r.width * 0.2;
        const y0 = r.top + r.height * 0.8;
        const ev = (target, type, x, y, buttons) =>
          target.dispatchEvent(
            new MouseEvent(type, {
              button: 0,
              buttons,
              clientX: x,
              clientY: y,
              bubbles: true,
              cancelable: true,
            }),
          );
        ev(canvas, "mousedown", x0, y0, 1);
        let step = 0;
        window.__surfaceTierLast = [x0, y0];
        // 100ms cadence: safely inside TIER_SETTLE_MS (so the drag never
        // reads as parked) without flooding a software-GL run's frame
        // queue the way per-frame events would.
        window.__surfaceTierDrag = setInterval(() => {
          step++;
          const x = x0 + step * 12;
          const y = y0 - step * 5 + Math.sin(step / 3) * 12;
          window.__surfaceTierLast = [x, y];
          ev(document, "mousemove", x, y, 1);
        }, 100);
      });
    const dragEnd = () =>
      page.evaluate(() => {
        clearInterval(window.__surfaceTierDrag);
        const [x, y] = window.__surfaceTierLast;
        document.dispatchEvent(
          new MouseEvent("mouseup", {
            button: 0,
            buttons: 0,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      });

    console.error(`[surface-tier] navigating to ${BASE}/`);
    await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const el = document.getElementById("pointCount");
        return !!el && Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
      },
      undefined,
      { timeout: 30_000, polling: 100 },
    );
    // Arm a context-loss tripwire on the app's own canvas: the pre-fix
    // failure mode was exactly a lost (and unrecoverable) WebGL context.
    await page.evaluate(() => {
      window.__glLost = false;
      document
        .querySelector("canvas")
        .addEventListener("webglcontextlost", () => {
          window.__glLost = true;
        });
    });

    // ---- Phase 1: default system — tier split sharp/soft/sharp ----------
    check(
      !(await page.$eval("#modeSurfaceBtn", (b) => b.disabled)),
      "default system surface-eligible",
    );
    await page.click("#modeSurfaceBtn");
    await page.waitForTimeout(500);
    const settled1 = await stableShot("surface-tier-1-settled.jpg", 300_000);
    await dragStart();
    await page.waitForTimeout(1_500);
    const midDrag = await shot("surface-tier-2-middrag.jpg");
    await dragEnd();
    await page.waitForTimeout(500);
    const settled2 = await stableShot("surface-tier-3-resettled.jpg", 300_000);
    check(!midDrag.equals(settled1), "drag changed the frame");
    // Softness proxy: an upscaled preview compresses markedly better than
    // a crisp settled trace of the same scene. Compared against the larger
    // settled shot — the two settled frames differ a little (different
    // orientations), and the preview must simply be clearly below both.
    const settledMax = Math.max(settled1.length, settled2.length);
    const ratio = midDrag.length / settledMax;
    check(
      midDrag.length < settledMax * 0.9,
      `mid-drag preview softer (jpeg ratio ${ratio.toFixed(2)}, want < 0.9)`,
    );
    check(
      Math.abs(settled2.length - settled1.length) / settled1.length < 0.3,
      "settled sharpness recovered after release",
    );
    await page.click("#modePointsBtn");
    await page.waitForTimeout(500);

    // ---- Phase 2: Menger Sponge — bounded submissions, interruptible ----
    await page.selectOption("#presetSelect", "menger");
    // Let the regeneration + camera auto-fit glide land COMPLETELY: a
    // still-gliding camera would enter Surface mode invalidating every
    // frame, and under SwiftShader each queued preview is many seconds.
    await page.waitForTimeout(8_000);
    check(
      !(await page.$eval("#modeSurfaceBtn", (b) => b.disabled)),
      "menger surface-eligible",
    );
    await page.click("#modeSurfaceBtn");
    await boundedShot("surface-tier-4-menger-entry.jpg", "menger entry");
    // Drag briefly: preview frames must keep presenting (each is seconds
    // of software GL, so the drag stays short to keep the queue shallow).
    await dragStart();
    await page.waitForTimeout(600);
    await boundedShot(
      "surface-tier-5-menger-drag.jpg",
      "menger mid-drag",
      CLOSE_SHOT_BOUND_MS,
    );
    await dragEnd();
    // Settle strips grinding, mid-distance: distinct frames keep landing.
    await page.waitForTimeout(500);
    await assertProgress("menger settle", 240_000, 2);
    await shot("surface-tier-6-menger-settling.jpg");
    // Zoom hard toward the sponge — the close-up regime that used to wedge
    // the GPU process — then let the close-up settle start grinding.
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      // 4 ticks: close enough to be the heavy regime, shallow enough that
      // a single software-GL preview draw stays under Chrome's GPU-process
      // watchdog (which applies to SwiftShader draws too — the harness
      // must not kill the GPU process with an artifact 1000x slower than
      // any real device).
      const r = canvas.getBoundingClientRect();
      for (let i = 0; i < 4; i++) {
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -120,
            clientX: r.left + r.width * 0.5,
            clientY: r.top + r.height * 0.5,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    });
    await boundedShot(
      "surface-tier-7-menger-close.jpg",
      "menger close-up",
      CLOSE_SHOT_BOUND_MS,
    );
    // The close-up settle grind — the exact regime that used to wedge the
    // GPU process in one unbounded draw. Distinct frames landing here IS
    // the fix working.
    await page.waitForTimeout(500);
    await assertProgress("menger close-up settle", 420_000, 2);
    await shot("surface-tier-8-menger-close-settling.jpg");
    // A fresh drag must interrupt the grind and resume previews promptly
    // (with close-up queue-drain headroom under software GL).
    await dragStart();
    await page.waitForTimeout(500);
    await boundedShot(
      "surface-tier-9-menger-interrupt.jpg",
      "menger drag interrupts settle",
      CLOSE_SHOT_BOUND_MS,
    );
    await dragEnd();
    await page.click("#modePointsBtn");
    await page.waitForTimeout(500);

    check(
      !(await page.evaluate(() => window.__glLost)),
      "WebGL context survived",
    );
    check(pageErrors.length === 0, `no page errors (${pageErrors.join("|")})`);
  } finally {
    // Print the tripwires even when an abort skipped their checks — a run
    // that died on a screenshot timeout needs this diagnosis in the log.
    if (page && !page.isClosed()) {
      const lost = await page
        .evaluate(() => window.__glLost)
        .catch(() => "unknown");
      console.error(`[surface-tier] context-lost tripwire: ${lost}`);
    }
    if (pageErrors.length) {
      console.error(`[surface-tier] page errors: ${pageErrors.join(" | ")}`);
    }
    await browser.close();
  }
  console.error("[surface-tier] ======== SUMMARY ========");
  console.error(
    `[surface-tier] VERDICT: ${failures.length === 0 ? "PASS" : `FAIL (${failures.length}: ${failures.join("; ")})`}`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("[surface-tier] fatal:", err);
  process.exitCode = 1;
});
