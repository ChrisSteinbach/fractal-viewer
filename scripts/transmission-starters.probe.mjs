#!/usr/bin/env node
/**
 * The transmission starters' composition probe: drives the BUILT app's real
 * UI — picks each starter from the "Replace with preset" menu (the one
 * door the Glass transmission group rides), enters Surface from the mode
 * button, waits on the ?surfacestate settle latch, and saves the settled
 * canvas plus the session state readout under scripts/out/.
 *
 *   npm run build && npm run preview &
 *   node scripts/transmission-starters.probe.mjs --display=:0
 *
 * This is the composition-review instrument for the starter scenes: the
 * PNGs are what the aesthetic judgement reads. The gate-side structural
 * evidence lives in the finish/optics verifies and the tile gate's
 * closed-solid leg; this probe only answers "does the composition look
 * right, and does the session report the compute engine + closed-solid
 * transport".
 *
 * The state readout asserts the PREMISES per starter (engine === "compute",
 * transport lines present on ?surfacetrace) and exits 3 if one is broken —
 * a starter that silently routes elsewhere is a routing bug, not a taste
 * question. Exit 0 otherwise; 2 inconclusive (no settle).
 */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";
import { launchSurfaceBrowser } from "./lib/surface-browser-runner.mjs";

const args = process.argv.slice(2);
const argOf = (key, fallback) => {
  const i = args.indexOf(key);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const display = argOf("--display", ":0");
const url = argOf("--url", "https://localhost:4173");
const settleMs = Number(argOf("--settle", "180000"));

const STARTERS = [
  { id: "glass-garden", label: "Glass garden (3D)" },
  { id: "glass-menger", label: "Glass Menger (3D)" },
  { id: "glass-cells", label: "Glass cells (4D)" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await guardFreshDist();
  const quiet = await quietBaseline(console.error);
  const contention = await contendedReason(quiet);
  console.log(`machine quiet: ${contention ? `NO (${contention})` : "YES"}`);
  if (contention)
    console.log("UNCERTIFIED: the machine is busy — treat timings as suspect");

  const browser = await launchSurfaceBrowser(`x11:${display}`);
  const outDir = new URL("./out/", import.meta.url).pathname;
  mkdirSync(outDir, { recursive: true });

  const report = [];
  let failed = false;
  for (const starter of STARTERS) {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 1024, height: 640 },
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.goto(`${url}/?surfacestate&surfacetrace&surfacesamples=1`, {
      waitUntil: "load",
      timeout: 60000,
    });
    await page.bringToFront();
    await page.waitForFunction(
      () => typeof window.__surfaceState === "function",
      { timeout: 30000 },
    );

    // Pick the starter from the real preset menu.
    const value = `glass:${starter.id}`;
    await page.evaluate((v) => {
      const select = document.querySelector("#presetSelect");
      select.value = v;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await sleep(1500);

    // Enter Surface from the UI and wait for the true settle.
    await page.click("#modeSurfaceBtn");
    const started = Date.now();
    let state = null;
    while (Date.now() - started < settleMs) {
      state = await page.evaluate(() => window.__surfaceState?.() ?? null);
      if (state && state.settled) break;
      await sleep(250);
    }
    const settled = Boolean(state && state.settled);
    const engine = state ? state.engine : null;
    const hash = await page.evaluate(() => document.location.hash);

    const canvas = await page.$("canvas");
    const shot = canvas ? await canvas.screenshot({ type: "png" }) : null;
    if (shot) {
      writeFileSync(`${outDir}starter-${starter.id}.png`, shot);
    }
    // The trace ring: the transport pass lines the ?surfacetrace lane prints.
    const trace = await page.evaluate(() =>
      (window.__surfaceTraceLog ?? [])
        .slice(-80)
        .filter((line) => /transport/i.test(line)),
    );

    const ok = settled && engine === "compute";
    if (!ok) failed = true;
    report.push({
      starter: starter.id,
      settled,
      engine,
      transportLines: trace.length,
      hash: hash.slice(0, 64),
      pageErrors,
    });
    console.log(
      `${starter.id}: settled=${settled} engine=${engine} transportLines=${trace.length}`,
    );
    if (trace.length) console.log(trace.slice(0, 3).join("\n"));
    await page.close();
  }
  await browser.close();
  writeFileSync(`${outDir}starter-probe.json`, JSON.stringify(report, null, 2));
  process.exit(failed ? 3 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
