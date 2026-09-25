#!/usr/bin/env node
/**
 * The owner's depth-4 glass document's per-frame cost, measured: the Menger
 * maps (20) under a general Glass solid at depth 4, Glass on the two corner
 * maps, driven through the app's own authoring path (preset -> Glass solid
 * block -> depth select -> the Finish group's Glass bundle on maps 1 and
 * 20), then rebooted on the authored `#v1=` hash with `?surfacetrace` and
 * entered on Surface. Reports the first completed frame's wall, every
 * completed settle pass's exact census (the exhausted count is the
 * unresolved-at-the-caps figure; covered/miss the march's terminals), and
 * the transport lane's per-pass pacing and done tallies from the trace.
 * Measures, gates nothing.
 *
 * Two phases, so a BEFORE/AFTER pair rides ONE document: without --hash the
 * probe AUTHORS the document, logs the hash, and exits (--author-only);
 * with --hash=<#v1=...> it boots directly on that hash and measures. The
 * authoring phase waits for the document hash to stop changing (the camera
 * fit's debounce included) before logging, so the captured hash is settled.
 *
 *   npm run build && (setsid nohup npm run preview > /tmp/preview.log 2>&1 &)
 *   node scripts/glass-depth4-cost.probe.mjs --mode=x11::0 --author-only
 *   node scripts/glass-depth4-cost.probe.mjs --mode=x11::0 --hash='#v1=...' [--settle=1200000]
 */
import { launchSurfaceBrowser } from "./lib/surface-browser-runner.mjs";
import { openApp } from "./lib/sphere-inversion-gate.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "1"];
  }),
);
const url = args.url ?? "https://localhost:4173";
const mode = args.mode ?? "sw";
const settleMs = Number(args.settle ?? 900_000);
const authorOnly =
  args["author-only"] === "1" || args["author-only"] === "true";
const presetHash = args.hash ?? null;
const log = (line) => console.log(`[depth4-cost] ${line}`);

const decodeDoc = (h) => {
  const inner = h.startsWith("#") ? h.slice(1) : h;
  const body = inner.startsWith("v1=") ? inner.slice(3) : inner;
  const pad = "===".slice((body.length + 3) % 4);
  return JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/") + pad));
};

const browser = await launchSurfaceBrowser(mode);

/** Phase 1: author the owner's document through the panel, log the hash. */
const authorDocument = async () => {
  const author = await openApp(browser, { url, query: "surfacetrace" });
  const { page } = author;
  await page.evaluate(() => {
    const details = document.getElementById("presetSelect")?.closest("details");
    if (details && !details.open) details.open = true;
  });
  const beforeHash = await page.evaluate(() => location.hash);
  await page.selectOption("#presetSelect", "menger");
  await page.waitForFunction((h) => location.hash !== h, beforeHash, {
    timeout: 15_000,
  });
  await page.evaluate(() => {
    const section = document.getElementById("glassSolidSection");
    if (section && !section.open) section.querySelector("summary")?.click();
  });
  await page.click("#glassSolidEnabledCheckbox");
  await page.waitForTimeout(300);
  await page.selectOption("#glassSolidDepthSelect", "4");
  await page.waitForTimeout(300);
  // Glass on maps 1 and 20 (1-based): the Finish group's bundle on both.
  await page.evaluate(() => {
    const details = document.getElementById("transformsSection");
    if (details && !details.open) details.querySelector("summary")?.click();
  });
  for (const index of [1, 20]) {
    await page.evaluate((i) => {
      const buttons = document.getElementById("transformList").children;
      buttons[i].click();
    }, index);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const details = [
        ...document.querySelectorAll("#transformEditor > details"),
      ].find(
        (d) => d.querySelector("summary")?.textContent?.trim() === "Finish",
      );
      if (details && !details.open) details.querySelector("summary")?.click();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const bundle = document.querySelector("#transformEditor .finish-bundle");
      bundle.value = "glass";
      bundle.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(500);
  }
  // The document hash rides a debounced save and the camera fit's glide:
  // wait until it has been stable for two full seconds before logging it.
  await page.waitForFunction(() => typeof window.__surfaceState === "function");
  await page.waitForTimeout(3_000);
  let hash = await page.evaluate(() => location.hash);
  for (;;) {
    await page.waitForTimeout(2_000);
    const next = await page.evaluate(() => location.hash);
    if (next === hash) break;
    hash = next;
  }
  const doc = decodeDoc(hash);
  const glassMaps = (doc.transforms ?? [])
    .map((t, i) => (t.optics?.model === "dielectric" ? i : -1))
    .filter((i) => i >= 0);
  log(
    `doc: maps=${doc.transforms.length} level=${doc.finiteSolid?.level} glassMaps=${glassMaps.join(",")}`,
  );
  log(`camera: ${JSON.stringify(doc.camera)}`);
  if (doc.finiteSolid?.level !== 4 || glassMaps.length !== 2) {
    log("AUTHORING FAILED — expected level 4 and Glass on exactly two maps");
    process.exit(1);
  }
  log(`AUTHORED_HASH ${hash}`);
  await author.context.close();
  return hash;
};

/** Phase 2: boot on the given hash and measure. */
const measureHash = async (hash) => {
  const doc = decodeDoc(hash);
  log(
    `doc: maps=${doc.transforms.length} level=${doc.finiteSolid?.level} ` +
      `camera=${JSON.stringify(doc.camera)}`,
  );
  const measured = await openApp(browser, { url, query: "surfacetrace", hash });
  const m = measured;
  await m.page.waitForFunction(
    () => typeof window.__surfaceState === "function",
    undefined,
    { timeout: 60_000 },
  );
  let entered = false;
  for (let i = 0; i < 60; i++) {
    const pressed = await m.page.evaluate(() => {
      const btn = document.getElementById("modeSurfaceBtn");
      if (!btn.disabled) btn.click();
      return btn.getAttribute("aria-pressed") === "true";
    });
    if (pressed) {
      entered = true;
      break;
    }
    await m.page.waitForTimeout(1000);
  }
  if (!entered) {
    log("the Surface button never took the press");
    process.exit(1);
  }
  const t0 = Date.now();
  let firstFrameAt = null;
  let enteredAt = null;
  let lastCensus = "";
  let backendLogged = false;
  const transportLines = [];
  while (Date.now() - t0 < settleMs) {
    const state = await m.page.evaluate(() => window.__surfaceState());
    if (enteredAt === null && state.mode === "surface")
      enteredAt = Date.now() - t0;
    if (
      !backendLogged &&
      state.mode === "surface" &&
      state.engine === "compute"
    ) {
      backendLogged = true;
      log(
        `session: engine=${state.engine} opticsBackend=${state.opticsBackend} ` +
          `finiteComposite=${state.finiteComposite} backend=${JSON.stringify(state.backend)}`,
      );
      if (state.opticsBackend !== "finiteSolid") {
        log("WARNING: the session's optics backend is NOT finiteSolid");
      }
    }
    if (state.firstFrame && firstFrameAt === null) {
      firstFrameAt = Date.now() - t0;
      const trace = await m.page.evaluate(
        () => window.__surfaceTraceLog?.slice(-2) ?? [],
      );
      log(
        `firstFrame after ${((firstFrameAt - (enteredAt ?? 0)) / 1000).toFixed(1)} s ` +
          `(session wall ${(firstFrameAt / 1000).toFixed(1)} s); frame trace tail: ${trace.join(" | ")}`,
      );
    }
    const censusJson = state.census ? JSON.stringify(state.census) : "";
    if (state.settled && censusJson && censusJson !== lastCensus) {
      lastCensus = censusJson;
      const census = state.census;
      log(
        `census at ${((Date.now() - t0) / 1000).toFixed(1)} s: rays=${census.rays} ` +
          `covered=${census.covered} miss=${census.miss} exhausted=${census.exhausted}`,
      );
    }
    await m.page.waitForTimeout(1000);
  }
  const trace = await m.page.evaluate(() => window.__surfaceTraceLog ?? []);
  for (const line of trace) {
    if (/^(\[\d+ms\]) (transport|sample complete)/.test(line))
      transportLines.push(line);
  }
  if (m.errors.length > 0) {
    log(`console errors (${m.errors.length}):`);
    for (const e of m.errors.slice(0, 12)) log(`  ${e}`);
  }
  log(`transport lines (${transportLines.length} of ${trace.length} total):`);
  log("first 12:");
  for (const line of transportLines.slice(0, 12)) log(`  ${line}`);
  const done = transportLines.filter((line) => /transport done/.test(line));
  log(`transport done lines (${done.length}):`);
  for (const line of done) log(`  ${line}`);
  log("last 12:");
  for (const line of transportLines.slice(-12)) log(`  ${line}`);
  await m.context.close();
};

try {
  if (presetHash) {
    await measureHash(presetHash);
  } else {
    const hash = await authorDocument();
    if (!authorOnly) await measureHash(hash);
  }
} finally {
  await browser.close();
}
