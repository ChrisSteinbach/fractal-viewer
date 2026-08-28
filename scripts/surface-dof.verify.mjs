#!/usr/bin/env node
/**
 * Real-browser gate for Surface's retained depth-of-field presentation.
 *
 * It forces the shipped WebGL fallback, waits for a real settled frame, then
 * proves that enabling DoF changes pixels without restarting trace work,
 * disabling it restores the legacy image, and a radial background edit is
 * recomposited while the trace stays settled. WebGPU plus tiled Save-PNG is
 * covered by surface-export-tile.verify.mjs.
 *
 * Usage: npm run build && npm run preview, then
 *   node scripts/surface-dof.verify.mjs [--url=https://localhost:4173]
 *     [--display=:0]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "1"];
  }),
);
const base = (args.url ?? "https://localhost:4173").replace(/\/+$/, "");
const display = args.display ?? process.env.DISPLAY ?? ":0";
const outDir = path.resolve(".playwright-mcp");
const failures = [];

function check(ok, message) {
  console.error(`[surface-dof] ${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures.push(message);
}

async function comparePngs(page, a, b) {
  return page.evaluate(
    async ([aB64, bB64]) => {
      const decode = async (b64) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const g = canvas.getContext("2d");
        g.drawImage(bitmap, 0, 0);
        return g.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const x = await decode(aB64);
      const y = await decode(bB64);
      if (x.width !== y.width || x.height !== y.height) return Infinity;
      let sum = 0;
      for (let p = 0; p < x.data.length; p += 4) {
        sum += Math.abs(x.data[p] - y.data[p]);
        sum += Math.abs(x.data[p + 1] - y.data[p + 1]);
        sum += Math.abs(x.data[p + 2] - y.data[p + 2]);
      }
      return sum / (x.width * x.height * 3);
    },
    [a.toString("base64"), b.toString("base64")],
  );
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false,
    env: { ...process.env, DISPLAY: display },
    args: ["--ignore-gpu-blocklist", "--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 900, height: 560 },
      reducedMotion: "reduce",
    });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${base}/?surfacestate&surfacegl&surfacesamples=1`, {
      waitUntil: "load",
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => {
        const count = document.getElementById("pointCount")?.textContent ?? "";
        return (
          window.__surfaceState !== undefined &&
          Number(count.replace(/[^\d]/g, "")) > 0
        );
      },
      { timeout: 30_000 },
    );
    await page.click("#modeSurfaceBtn");
    await page.waitForFunction(
      () => window.__surfaceState?.().settled === true,
      { timeout: 180_000, polling: 250 },
    );

    const probe = await page.evaluate(() => window.__surfaceState?.());
    check(probe?.engine === "webgl", `forced WebGL engine (${probe?.engine})`);
    check(
      probe?.backend?.software === false,
      `real GPU backend (${probe?.backend?.label ?? "unknown"})`,
    );
    const canvas = page.locator("canvas").first();
    const off = await canvas.screenshot({ type: "png" });

    const setDof = (on) =>
      page.$eval(
        "#surfaceDepthOfFieldCheckbox",
        (input, checked) => {
          input.checked = checked;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        },
        on,
      );
    const traceStayedSettled = () =>
      page.evaluate(() => {
        const state = window.__surfaceState?.();
        return (
          state?.settled === true &&
          state.previewActive === false &&
          state.settleActive === false
        );
      });

    await setDof(true);
    await page.waitForTimeout(500);
    check(await traceStayedSettled(), "enabling DoF did not restart tracing");
    const on = await canvas.screenshot({ type: "png" });
    const onDiff = await comparePngs(page, off, on);
    check(onDiff > 0.01, `DoF changed pixels (mean ${onDiff.toFixed(4)}/255)`);

    await setDof(false);
    await page.waitForTimeout(250);
    const offAgain = await canvas.screenshot({ type: "png" });
    const identityDiff = await comparePngs(page, off, offAgain);
    check(
      identityDiff < 0.02,
      `off path restored legacy pixels (mean ${identityDiff.toFixed(4)}/255)`,
    );

    await setDof(true);
    await page.$eval("#background", (select) => {
      select.value = "haze";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.$eval("#backgroundShape", (select) => {
      select.value = "radial";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(500);
    check(
      await traceStayedSettled(),
      "radial background edit with DoF did not retrace",
    );
    const radial = await canvas.screenshot({ type: "png" });
    const radialDiff = await comparePngs(page, on, radial);
    check(
      radialDiff > 0.1,
      `live radial background changed filtered pixels (mean ${radialDiff.toFixed(4)}/255)`,
    );

    await writeFile(path.join(outDir, "surface-dof-webgl-off.png"), off);
    await writeFile(path.join(outDir, "surface-dof-webgl-on.png"), on);
    await writeFile(path.join(outDir, "surface-dof-webgl-radial.png"), radial);
    check(pageErrors.length === 0, `no page errors (${pageErrors.join("; ")})`);
    await page.close();
  } finally {
    await browser.close();
  }

  console.error(
    failures.length === 0
      ? "[surface-dof] PASS"
      : `[surface-dof] FAIL (${failures.join("; ")})`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

await main();
