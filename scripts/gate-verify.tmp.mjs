#!/usr/bin/env node
// Throwaway verification: disabled Surface segment is visibly dimmed and a
// tap toasts the reason (real-Chrome pointerdown-on-disabled behavior).
import { spawn } from "node:child_process";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const VITE_LOCAL_URL_RE = /Local:\s+https?:\/\/[^/\s]+:(\d+)/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function spawnDevServer() {
  const child = spawn("npm", ["run", "dev"], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let resolvePort;
  const portPromise = new Promise((r) => (resolvePort = r));
  child.stdout.on("data", (chunk) => {
    const m = VITE_LOCAL_URL_RE.exec(chunk.toString());
    if (m) resolvePort(Number(m[1]));
  });
  child.stderr.on("data", () => {});
  return { child, portPromise };
}
function killDevServer(child) {
  if (!child || child.killed || child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* gone */
  }
}
function pollUntilUp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function attempt() {
      const req = https.get(
        url,
        { rejectUnauthorized: false, timeout: 5000 },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on("error", () => {
        if (Date.now() >= deadline) reject(new Error("timeout"));
        else setTimeout(attempt, 500);
      });
      req.on("timeout", () => req.destroy());
    })();
  });
}

async function main() {
  const results = [];
  const check = (name, ok, detail) => {
    results.push(ok);
    console.error(
      `[gate-verify] ${ok ? "PASS" : "FAIL"}: ${name} ${detail ?? ""}`,
    );
  };
  const spawned = spawnDevServer();
  const devServer = spawned.child;
  let browser = null;
  try {
    const port = await Promise.race([
      spawned.portPromise,
      sleep(60000).then(() => null),
    ]);
    const base = `https://localhost:${port ?? 5173}`;
    await pollUntilUp(base + "/", 60000);
    const env = { ...process.env };
    delete env.DISPLAY;
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
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 800, height: 560 },
    });
    await page.goto(base + "/", { waitUntil: "load", timeout: 45000 });
    await page.waitForFunction(
      () =>
        Number(
          (document.getElementById("pointCount")?.textContent || "").replace(
            /[^\d]/g,
            "",
          ),
        ) > 0,
      undefined,
      { timeout: 45000, polling: 200 },
    );

    // Ineligible preset: swirl (uses variations).
    await page.evaluate(() => {
      const sel = document.getElementById("presetSelect");
      sel.value = "swirl";
      sel.dispatchEvent(new Event("change"));
    });
    await sleep(2500);

    const state = await page.evaluate(() => {
      const b = document.getElementById("modeSurfaceBtn");
      const enabled = document.getElementById("modeSolidBtn");
      return {
        disabled: b.disabled,
        opacity: getComputedStyle(b).opacity,
        cursor: getComputedStyle(b).cursor,
        enabledOpacity: getComputedStyle(enabled).opacity,
      };
    });
    check(
      "disabled segment visibly dimmed",
      state.disabled &&
        Number(state.opacity) < 0.5 &&
        Number(state.enabledOpacity) === 1,
      `opacity=${state.opacity} vs enabled=${state.enabledOpacity} cursor=${state.cursor}`,
    );

    // Tap the disabled button with a REAL mouse press at its coordinates
    // (page.click would refuse a disabled control).
    const box = await page.locator("#modeSurfaceBtn").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(600);
    const toast = await page.evaluate(() => {
      const t = document.getElementById("toast");
      return { hidden: t.classList.contains("hidden"), text: t.textContent };
    });
    check(
      "tapping disabled segment toasts the reason",
      !toast.hidden && /variations/.test(toast.text),
      JSON.stringify(toast),
    );

    const fs = await import("node:fs/promises");
    await fs.mkdir(".playwright-mcp", { recursive: true });
    await page.screenshot({ path: ".playwright-mcp/gated-surface.png" });
  } finally {
    if (browser) await browser.close();
    killDevServer(devServer);
  }
  const failed = results.filter((r) => !r).length;
  console.error(
    `[gate-verify] ======== ${failed ? "FAIL" : "PASS"} (${results.length - failed}/${results.length}) ========`,
  );
  process.exitCode = failed ? 1 : 0;
}
main().catch((err) => {
  console.error("[gate-verify] fatal:", err);
  process.exitCode = 1;
});
