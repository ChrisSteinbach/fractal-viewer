#!/usr/bin/env node
/**
 * fr-5ne3: browser verification for the surface render's interaction
 * preview tier. Boots the app under SwiftShader (the webgl-smoke launch
 * recipe), enters Surface mode, and asserts the tier split observably:
 *
 *   1. parked view (after entry + settle) renders SHARP,
 *   2. a continuous drag renders the low-res preview — detected as a
 *      markedly smaller JPEG for the same scene (a 0.3-scale upscale
 *      compresses far better than a crisp full trace),
 *   3. after release the view settles back to a sharp full-quality frame
 *      (JPEG size recovers), and
 *   4. no page errors anywhere along the way.
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
  let pass = false;
  try {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      // Small on purpose: SwiftShader traces the full-quality settle frame
      // on the CPU, and screenshots only complete on the NEXT presented
      // frame — so every "settled" capture below self-synchronizes to that
      // trace finishing. Keep it affordable.
      viewport: { width: 800, height: 600 },
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));
    // Screenshots deliberately get a long leash for the same reason.
    page.setDefaultTimeout(180_000);

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

    const surfaceDisabled = await page.$eval(
      "#modeSurfaceBtn",
      (b) => b.disabled,
    );
    if (surfaceDisabled) {
      throw new Error(
        "default system is not surface-eligible; pick an eligible preset first",
      );
    }
    // A settled capture in two takes: the first blocks on the busy
    // compositor until the in-flight full trace presents (draining any
    // backlogged preview present with it), the second — on a then-idle
    // page — reads the front buffer, which is the settled full frame.
    const settledShot = async (name) => {
      await page.screenshot({ type: "jpeg", quality: 85 });
      await page.waitForTimeout(300);
      return page.screenshot({
        type: "jpeg",
        quality: 85,
        path: path.join(OUT_DIR, name),
      });
    };

    await page.click("#modeSurfaceBtn");
    // Entry preview lands immediately; the settle full trace follows.
    await page.waitForTimeout(1000);
    const settled1 = await settledShot("surface-tier-1-settled.jpg");

    // Continuous orbit drag, dispatched page-side so the invalidation keeps
    // flowing no matter how long each screenshot takes. Start point away
    // from the center so a visible guide box can't capture the gesture.
    await page.evaluate(() => {
      // interactions.ts listens for mousedown on the CANVAS and
      // mousemove/mouseup on the DOCUMENT — dispatch accordingly.
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
      window.__surfaceTierDrag = setInterval(() => {
        step++;
        const x = x0 + step * 5;
        const y = y0 - step * 2 + Math.sin(step / 3) * 12;
        window.__surfaceTierLast = [x, y];
        ev(document, "mousemove", x, y, 1);
      }, 40);
    });
    await page.waitForTimeout(1500); // several preview frames deep
    const midDrag = await page.screenshot({
      type: "jpeg",
      quality: 85,
      path: path.join(OUT_DIR, "surface-tier-2-middrag.jpg"),
    });
    await page.evaluate(() => {
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
    // TIER_SETTLE_MS of quiet, then the full trace; settledShot syncs to it.
    await page.waitForTimeout(500);
    const settled2 = await settledShot("surface-tier-3-resettled.jpg");

    // Back to the explorer — the exit path must repaint without errors.
    await page.click("#modePointsBtn");
    await page.waitForTimeout(500);

    const s1 = settled1.length;
    const mid = midDrag.length;
    const s2 = settled2.length;
    const dragMoved = !midDrag.equals(settled1);
    const previewSofter = mid < s1 * 0.9 && mid < s2 * 0.9;
    const settledRecovered = Math.abs(s2 - s1) / s1 < 0.3;
    pass =
      dragMoved && previewSofter && settledRecovered && pageErrors.length === 0;

    console.error("[surface-tier] ======== SUMMARY ========");
    console.error(
      `[surface-tier] settled=${s1}B  mid-drag=${mid}B  re-settled=${s2}B`,
    );
    console.error(
      `[surface-tier] preview/settled size ratio: ${(mid / s1).toFixed(2)} (want < 0.9)`,
    );
    console.error(`[surface-tier] drag changed the frame: ${dragMoved}`);
    console.error(`[surface-tier] settled size recovered: ${settledRecovered}`);
    console.error(
      `[surface-tier] page errors: ${pageErrors.length ? pageErrors.join(" | ") : "none"}`,
    );
    console.error(`[surface-tier] VERDICT: ${pass ? "PASS" : "FAIL"}`);
  } finally {
    await browser.close();
  }
  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error("[surface-tier] fatal:", err);
  process.exitCode = 1;
});
