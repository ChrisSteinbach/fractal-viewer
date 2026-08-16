#!/usr/bin/env node
/**
 * fr-5666's real-WebGL gate: the 4D Points explorer must project, then invert,
 * its balloon echo. Drives the persisted UI path so a shader/link failure or
 * the boot-time "enabled before a bounding sphere exists" zero-uniform bug
 * cannot pass as a merely present checkbox.
 *
 * Usage:
 *   node scripts/explorer-balloon-4d.verify.mjs [--url=https://localhost:5173]
 *
 * Without --url, starts `npm run dev` and tears it down. Chromium is the
 * Playwright-bundled build on the same SwiftShader recipe as webgl-smoke.mjs.
 */
import { spawn } from "node:child_process";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRESET = "pentatope";
const VIEWPORT = { width: 960, height: 720 };
const START_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 45_000;
const MIN_CHANGED_FRACTION = 0.001;

function args(argv) {
  const out = { url: null, timeout: DEFAULT_TIMEOUT_MS };
  for (const raw of argv) {
    const match = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument: ${raw}`);
    if (match[1] === "url" && match[2]) {
      out.url = match[2].replace(/\/+$/, "");
    } else if (match[1] === "timeout" && match[2]) {
      out.timeout = Number(match[2]);
    } else {
      throw new Error(`Unknown argument: ${raw}`);
    }
  }
  return out;
}

async function spawnDev() {
  // Vite 7 can suppress its banner when stdout is a pipe. Pick an ephemeral
  // process-scoped high port explicitly rather than depending on parsing it.
  const port = 41_000 + (process.pid % 20_000);
  const child = spawn(
    "npm",
    ["run", "dev", "--", "--port", String(port), "--strictPort"],
    {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      const text = chunk.toString();
      process.stderr.write(`[dev] ${text}`);
    });
  }
  return { child, url: `https://localhost:${port}` };
}

function stopDev(child) {
  if (!child?.pid || child.killed) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

function waitForHttps(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = https.get(
        url,
        { rejectUnauthorized: false, timeout: 3_000 },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on("error", () => {
        if (Date.now() >= deadline)
          reject(new Error(`No response from ${url}`));
        else setTimeout(attempt, 250);
      });
      req.on("timeout", () => req.destroy());
    };
    attempt();
  });
}

async function waitForPoints(page, timeout) {
  await page.waitForFunction(
    () => {
      const text = document.getElementById("pointCount")?.textContent ?? "";
      return Number(text.replace(/[^\d]/g, "")) > 0;
    },
    undefined,
    { timeout, polling: 100 },
  );
}

async function canvasShot(page) {
  return page.locator("#container canvas").first().screenshot({ type: "png" });
}

/** Wait for a render-on-demand canvas to change from `baseline` (if given),
 * then produce two byte-identical screenshots. */
async function stableCanvas(page, timeout, baseline = null) {
  const deadline = Date.now() + timeout;
  let previous = null;
  let changed = baseline === null;
  let equalRuns = 0;
  while (Date.now() < deadline) {
    const shot = await canvasShot(page);
    if (!changed && !shot.equals(baseline)) changed = true;
    if (changed && previous?.equals(shot)) {
      equalRuns++;
      if (equalRuns >= 2) return shot;
    } else {
      equalRuns = 0;
    }
    previous = shot;
    await page.waitForTimeout(250);
  }
  throw new Error("canvas did not change and settle before timeout");
}

async function imageDiff(page, onPng, offPng) {
  return page.evaluate(
    async ({ on64, off64 }) => {
      const bitmap = async (encoded) => {
        const raw = atob(encoded);
        const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        return createImageBitmap(new Blob([bytes], { type: "image/png" }));
      };
      const [on, off] = await Promise.all([bitmap(on64), bitmap(off64)]);
      if (on.width !== off.width || on.height !== off.height) {
        return { changedFraction: 1, meanAbs: 255, maxDelta: 255 };
      }
      const pixels = (image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, image.width, image.height).data;
      };
      const a = pixels(on);
      const b = pixels(off);
      let changed = 0;
      let sum = 0;
      let maxDelta = 0;
      for (let i = 0; i < a.length; i += 4) {
        const dr = Math.abs(a[i] - b[i]);
        const dg = Math.abs(a[i + 1] - b[i + 1]);
        const db = Math.abs(a[i + 2] - b[i + 2]);
        const delta = Math.max(dr, dg, db);
        if (delta >= 3) changed++;
        sum += dr + dg + db;
        maxDelta = Math.max(maxDelta, delta);
      }
      const count = a.length / 4;
      return {
        changedFraction: changed / count,
        meanAbs: sum / (count * 3),
        maxDelta,
      };
    },
    { on64: onPng.toString("base64"), off64: offPng.toString("base64") },
  );
}

async function rows(page) {
  return page.evaluate(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      return Boolean(el && !el.classList.contains("hidden"));
    };
    return {
      echo: visible("balloonEchoRow"),
      radius: visible("balloonRadiusRow"),
      checked: document.getElementById("balloonEchoCheckbox")?.checked === true,
      tumble: document.getElementById("fourDTumbleToggle")?.checked === true,
    };
  });
}

async function main() {
  const options = args(process.argv.slice(2));
  let dev = null;
  let browser = null;
  let failed = false;
  const failures = [];
  const pageErrors = [];
  const shaderErrors = [];
  const fail = (message) => {
    failed = true;
    failures.push(message);
    console.error(`[explorer-balloon-4d] FAIL ${message}`);
  };

  try {
    if (!options.url) {
      dev = await spawnDev();
      options.url = dev.url;
      await waitForHttps(options.url, START_TIMEOUT_MS);
    }

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
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: VIEWPORT,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => {
      const text = message.text();
      if (
        message.type() === "error" &&
        /(WebGLProgram|GLSL|shader|link program|VALIDATE_STATUS)/i.test(text)
      ) {
        shaderErrors.push(text);
      }
    });

    await page.goto(`${options.url}/`, {
      waitUntil: "load",
      timeout: options.timeout,
    });
    await waitForPoints(page, options.timeout);
    const initial = await canvasShot(page);

    // Real preset-select path, then park the session-only tumble before any
    // image comparison. Waiting for a changed + stable canvas distinguishes
    // the arriving 4D cloud from the already-painted boot cloud.
    await page.selectOption("#presetSelect", PRESET);
    await page.waitForFunction(
      () =>
        !document.getElementById("fourDControls")?.classList.contains("hidden"),
      undefined,
      { timeout: options.timeout },
    );
    await page.evaluate(() => {
      const toggle = document.getElementById("fourDTumbleToggle");
      if (toggle?.checked) toggle.click();
    });
    const plain4 = await stableCanvas(page, options.timeout, initial);

    await page.evaluate(() => {
      document.getElementById("atmosphereSection").open = true;
      document.getElementById("balloonEchoCheckbox").click();
    });
    const enabled = await rows(page);
    if (!enabled.echo || !enabled.radius || !enabled.checked) {
      fail(`pre-share balloon rows/state ${JSON.stringify(enabled)}`);
    }
    await stableCanvas(page, options.timeout, plain4);

    // Capture the link produced by the app's Copy-link handler without
    // depending on host clipboard permissions.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__explorerBalloonShareLink = text;
          },
        },
      });
      document.getElementById("shareSection").open = true;
      document.getElementById("copyLinkBtn").click();
    });
    await page.waitForFunction(
      () => typeof window.__explorerBalloonShareLink === "string",
      undefined,
      { timeout: options.timeout },
    );
    const shareLink = await page.evaluate(
      () => window.__explorerBalloonShareLink,
    );
    if (!shareLink.includes("#v1=")) fail(`bad share link: ${shareLink}`);

    // The restored document is the important half: balloon state is applied
    // before its first 4D cloud installs the full bounding sphere.
    await page.goto(shareLink, {
      waitUntil: "load",
      timeout: options.timeout,
    });
    await waitForPoints(page, options.timeout);
    await page.evaluate(() => {
      const toggle = document.getElementById("fourDTumbleToggle");
      if (toggle?.checked) toggle.click();
    });
    const restored = await rows(page);
    if (!restored.echo || !restored.radius || !restored.checked) {
      fail(`restored balloon rows/state ${JSON.stringify(restored)}`);
    }
    const onShot = await stableCanvas(page, options.timeout);

    await page.evaluate(() => {
      document.getElementById("atmosphereSection").open = true;
      document.getElementById("balloonEchoCheckbox").click();
    });
    const offShot = await stableCanvas(page, options.timeout, onShot);
    const diff = await imageDiff(page, onShot, offShot);
    console.error(
      `[explorer-balloon-4d] on/off changed=${(100 * diff.changedFraction).toFixed(3)}% meanAbs=${diff.meanAbs.toFixed(3)} max=${diff.maxDelta}`,
    );
    if (diff.changedFraction < MIN_CHANGED_FRACTION || diff.maxDelta < 5) {
      fail(`echo produced no material canvas change: ${JSON.stringify(diff)}`);
    }

    const appError = await page.evaluate(() => ({
      boot: document.getElementById("error")?.textContent?.trim() ?? "",
      renderVisible: !document
        .getElementById("renderError")
        ?.classList.contains("hidden"),
    }));
    if (appError.boot || appError.renderVisible) {
      fail(`app error UI ${JSON.stringify(appError)}`);
    }
    if (pageErrors.length) fail(`page errors: ${pageErrors.join(" | ")}`);
    if (shaderErrors.length) fail(`shader errors: ${shaderErrors.join(" | ")}`);

    console.error("[explorer-balloon-4d] ======== SUMMARY ========");
    console.error(`[explorer-balloon-4d] preset: ${PRESET}`);
    console.error(
      `[explorer-balloon-4d] restored rows: ${JSON.stringify(restored)}`,
    );
    console.error(`[explorer-balloon-4d] VERDICT: ${failed ? "FAIL" : "PASS"}`);
  } finally {
    if (browser) await browser.close();
    stopDev(dev?.child);
  }

  if (failed) throw new Error(failures.join("; "));
}

main().catch((error) => {
  console.error(`[explorer-balloon-4d] fatal: ${error.stack ?? error}`);
  process.exitCode = 1;
});
