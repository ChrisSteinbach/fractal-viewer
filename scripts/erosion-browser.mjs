#!/usr/bin/env node
/**
 * fr-z70m browser repro driver: boot the app, load a preset, enter Surface
 * mode, wait for the settle frame, screenshot. Based on webgl-smoke.mjs's
 * SwiftShader recipe (see .claude/skills/verify/SKILL.md); pass --gpu to run
 * on the real GPU/display instead (this box has one).
 *
 * Usage:
 *   node scripts/erosion-browser.mjs --url=https://localhost:5173 \
 *     --preset=sierpinski --out=/tmp/erosion/sierpinski.png [--gpu]
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium, firefox } from "playwright-core";

function parseArgs(argv) {
  const args = {
    url: "https://localhost:5173",
    preset: "sierpinski",
    out: "/tmp/erosion/shot.png",
    gpu: false,
    settleMs: 9000,
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    if (key === "url") args.url = value.replace(/\/+$/, "");
    else if (key === "preset") args.preset = value;
    else if (key === "out") args.out = value;
    else if (key === "gpu") args.gpu = true;
    else if (key === "browser") args.browser = value;
    else if (key === "orbit") args.orbit = value;
    else if (key === "zoom") args.zoom = Number(value);
    else if (key === "settleMs") args.settleMs = Number(value);
    else if (key === "dpr") args.dpr = Number(value);
    else if (key === "blockGrid") args.blockGrid = true;
    else if (key === "shareUrl") args.shareUrl = true;
    else if (key === "sweep") args.sweep = value;
    else throw new Error(`Unknown flag: --${key}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...process.env };
  let browser;
  if (args.browser === "firefox") {
    // Firefox drives WebGL through Mesa's GLSL compiler directly (no ANGLE
    // translator) — the user's actual browser stack on this box.
    browser = await firefox.launch({ headless: true, env });
  } else {
    const launchArgs = ["--no-sandbox"];
    if (args.gpu) {
      // Real GPU on the live display: keep DISPLAY/WAYLAND, new headless can
      // still use the hardware driver.
      launchArgs.push("--headless=new", "--use-gl=angle", "--use-angle=gl");
    } else {
      delete env.DISPLAY;
      launchArgs.push(
        "--headless=new",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
      );
    }
    browser = await chromium.launch({
      executablePath: chromium.executablePath(),
      headless: false,
      env,
      args: launchArgs,
    });
  }
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: args.dpr || 1,
    });
    if (args.shareUrl && args.browser !== "firefox") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    }
    const page = await context.newPage();
    page.on("pageerror", (err) => {
      process.stderr.write(`[page:uncaught] ${err.stack ?? err.message}\n`);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        process.stderr.write(`[page:${msg.type()}] ${msg.text()}\n`);
      }
    });
    if (args.blockGrid) {
      // No-code-change bisector: abort the grid worker's module request —
      // the client degrades to gridless marching by design (fr-55r5).
      await page.route("**/surface-grid-worker*", (route) => route.abort());
      console.error("[erosion] grid worker BLOCKED (gridless marching)");
    }
    await page.goto(args.url, { waitUntil: "load", timeout: 30_000 });
    // Production first visit reloads once for cross-origin isolation
    // (register-sw.ts); renderMode is session-only, so wait the dance out
    // before driving the UI. A second goto is a no-op on the dev server.
    await page.waitForTimeout(3000);
    await page.goto(args.url, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const el = document.getElementById("pointCount");
        return el && Number((el.textContent || "").replace(/\D/g, "")) > 0;
      },
      undefined,
      { timeout: 30_000, polling: 100 },
    );
    const renderer = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
    });
    console.error(`[erosion] renderer: ${renderer}`);

    const driveView = async (orbit, zoom, outPath) => {
      if (args.preset) {
        await page.selectOption("#presetSelect", args.preset);
        await page.waitForTimeout(1500); // morph/regen
      }
      await page.click("#modeSurfaceBtn");
      await page.waitForTimeout(1000);
      if (orbit) {
        const [dx, dy] = orbit.split(",").map(Number);
        const canvas = await page.locator("canvas").first().boundingBox();
        const cx = canvas.x + canvas.width * 0.4;
        const cy = canvas.y + canvas.height * 0.5;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) {
          await page.mouse.move(cx + (dx * i) / 8, cy + (dy * i) / 8);
          await page.waitForTimeout(30);
        }
        await page.mouse.up();
      }
      if (zoom) {
        const canvas = await page.locator("canvas").first().boundingBox();
        await page.mouse.move(
          canvas.x + canvas.width * 0.4,
          canvas.y + canvas.height * 0.5,
        );
        for (let i = 0; i < Math.abs(zoom); i++) {
          await page.mouse.wheel(0, zoom > 0 ? -120 : 120);
          await page.waitForTimeout(120);
        }
      }
      // Let the preview tier settle and the full-quality strip job
      // complete: poll until two consecutive canvas grabs are identical.
      const deadline = Date.now() + args.settleMs;
      let prev = null;
      for (;;) {
        await page.waitForTimeout(2500);
        const cur = await page
          .locator("canvas")
          .first()
          .screenshot()
          .then((b) => b.toString("base64"));
        if (prev === cur || Date.now() > deadline) break;
        prev = cur;
      }
      await mkdir(path.dirname(outPath), { recursive: true });
      await page.screenshot({ path: outPath });
      console.error(`[erosion] wrote ${outPath}`);
      const sfLog = await page.evaluate(() => {
        const log = window.__sfLog ?? [];
        // Compress runs of identical (tier, height, scale, maxDepth) frames.
        const out = [];
        for (const e of log) {
          const prev = out[out.length - 1];
          if (
            prev &&
            !e.event &&
            !prev.event &&
            prev.tier === e.tier &&
            prev.height === e.height &&
            prev.scale === e.scale &&
            prev.maxDepth === e.maxDepth
          ) {
            prev.n = (prev.n ?? 1) + 1;
            prev.tEnd = e.t;
          } else {
            out.push({ ...e });
          }
        }
        return out;
      });
      console.log("SFLOG " + JSON.stringify(sfLog, null, 1));
      if (args.shareUrl) {
        await page.click("#shareSection > summary");
        await page.click("#copyLinkBtn");
        await page.waitForTimeout(300);
        const link = await page.evaluate(() => navigator.clipboard.readText());
        console.log(`SHARE_URL ${link}`);
      }
    };

    if (args.sweep) {
      const base = args.out.replace(/\.png$/, "");
      for (const azPx of args.sweep.split(";")) {
        await page.reload({ waitUntil: "load" });
        await page.waitForFunction(
          () => {
            const el = document.getElementById("pointCount");
            return el && Number((el.textContent || "").replace(/\D/g, "")) > 0;
          },
          undefined,
          { timeout: 30_000, polling: 100 },
        );
        await driveView(
          `${azPx},-60`,
          args.zoom,
          `${base}-az${azPx.replace(/[^-\d]/g, "")}.png`,
        );
      }
    } else {
      await driveView(args.orbit, args.zoom, args.out);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[erosion] fatal:", err);
  process.exitCode = 1;
});
