#!/usr/bin/env node
/** Focused production-browser authoring gate for Surface lighting.
 *
 * Build and preview first. Default --phase=dormant never enters Surface:
 * it opens the real persisted rigs in Points, measures the disabled editor at
 * phone widths, and restores complete documents through Collection and Undo.
 * This phase may run beside a separate Surface GPU gate. --phase=active adds
 * real starter-menu entry and trusted touch/exact numeric edits; reserve the
 * GPU before running it. Reduced-motion parks both phases.
 *
 *   node scripts/surface-lighting-ui.verify.mjs --phase=dormant
 *   node scripts/surface-lighting-ui.verify.mjs --phase=active --viewport=393x727
 *
 * Fixtures are built with the application starter helper and codec, then
 * loaded into the production page as ordinary hash documents. This source
 * bundle is a fixture generator only; the running UI is the production build.
 * No renderer method, app state, control availability or shader is patched.
 * Layout is measured with every owning disclosure open. The widest declared
 * numeric values are tested like panel-numeric-control.verify.mjs, including
 * the field's currently displayed decimal precision. Capture files and full
 * diagnostics land under ignored scripts/out/ without overwriting prior runs.
 * Exit 0 pass, 1 assertion failed, 2 checking/browser failure.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { launchSurfaceBrowser } from "./lib/surface-browser-runner.mjs";

const options = {
  url: "https://localhost:4173",
  phase: "dormant",
  display: "",
  viewport: "393x727,320x568",
  out: `scripts/out/cinematic-lighting/ui-${new Date().toISOString().replaceAll(":", "-")}`,
};
for (const arg of process.argv.slice(2)) {
  const parsed = /^--([^=]+)=(.+)$/.exec(arg);
  if (!parsed || !Object.hasOwn(options, parsed[1]))
    throw new Error(`Unknown option ${arg}`);
  options[parsed[1]] = parsed[2];
}
assert(["dormant", "active"].includes(options.phase));
const viewports = options.viewport.split(",").map((value) => {
  const [width, height] = value.split("x").map(Number);
  assert(
    width >= 320 &&
      height >= 500 &&
      Number.isInteger(width) &&
      Number.isInteger(height),
  );
  return { width, height };
});
const report = {
  options,
  started: new Date().toISOString(),
  verdict: "running",
  checks: [],
  errors: [],
  audits: [],
};
const log = (message) => console.log(`[lighting-ui] ${message}`);
const check = (name, okay, detail) => {
  report.checks.push({ name, okay, detail });
  log(`${okay ? "PASS" : "FAIL"} ${name}`);
};
const decode = (encoded) =>
  JSON.parse(
    Buffer.from(encoded.replace(/^#?v1=/, ""), "base64url").toString("utf8"),
  );
const same = isDeepStrictEqual;
let navigation = 0;

async function fixtures() {
  const result = await build({
    stdin: {
      contents: `import { createSurfaceLightingStarter, SURFACE_LIGHTING_STARTERS } from "./src/app/surface-lighting-starters.ts";
import { encodeScene } from "./src/app/persist.ts";
export const fixtures = SURFACE_LIGHTING_STARTERS.map(({id,label}) => ({id,label,encoded:encodeScene(createSurfaceLightingStarter(id))}));`,
      resolveDir: process.cwd(),
      loader: "ts",
      sourcefile: "lighting-ui-fixtures.ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
  return module.fixtures.map((fixture) => ({
    ...fixture,
    document: decode(fixture.encoded),
  }));
}

async function boot(page, fixture) {
  const engineQuery =
    options.phase === "active"
      ? "surfacecompute&surfacesamples=1"
      : "surfacegl";
  await page.goto(
    `${options.url}/?surfacestate&${engineQuery}&uiRun=${++navigation}#${fixture.encoded}`,
    {
      waitUntil: "load",
      timeout: 60_000,
    },
  );
  await page.waitForFunction(
    () =>
      typeof window.__surfaceState === "function" &&
      Number(
        (document.getElementById("pointCount")?.textContent ?? "").replace(
          /[^\d]/g,
          "",
        ),
      ) > 0,
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForFunction(() => window.__surfaceState().mode === "points");
  await page.waitForFunction(
    (flux) =>
      Number(document.getElementById("surfaceRigKeyIntensityNumber")?.value) ===
      flux,
    fixture.document.surface.lighting.lights[0].intensity,
  );
  if (
    !(await page
      .locator("#panel")
      .evaluate((el) => el.classList.contains("open")))
  )
    await page.click("#menuToggle");
  await page.waitForTimeout(400);
}

async function open(page, id) {
  await page.locator(`#${id}`).evaluate((element) => {
    if (!element.open) element.querySelector(":scope > summary").click();
  });
  await page.waitForTimeout(150);
}

async function hashDocument(page) {
  return decode(await page.evaluate(() => location.hash));
}

async function saveDocument(page) {
  await open(page, "collectionSection");
  const key = "fractal-viewer:collection";
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.click("#saveCollectionBtn");
  await page.waitForFunction(
    ({ key, before }) => localStorage.getItem(key) !== before,
    { key, before },
    { timeout: 15_000 },
  );
  const entry = await page.evaluate((key) => {
    const value = JSON.parse(localStorage.getItem(key));
    return (Array.isArray(value) ? value : value.scenes)[0];
  }, key);
  return { ...entry, document: decode(entry.encoded) };
}

async function audit(page, label, active) {
  await open(page, "surfaceAuthoredLightingSection");
  await page
    .locator("#surfaceAuthoredLightingControls details")
    .evaluateAll((groups) => {
      for (const group of groups) group.open = true;
    });
  const result = await page.evaluate(
    ({ label, active }) => {
      const panel = document.getElementById("panel");
      const host = document.getElementById("surfaceAuthoredLightingControls");
      const rows = [];
      const clipped = [];
      const unpaired = [];
      const availability = [];
      for (const range of host.querySelectorAll('input[type="range"]')) {
        const pair = range.closest(".range-number-pair");
        const numbers = pair?.querySelectorAll('input[type="number"]');
        if (!pair || numbers?.length !== 1) {
          unpaired.push(range.id);
          continue;
        }
        const number = numbers[0];
        if (range.disabled !== number.disabled || number.disabled === active)
          availability.push(range.id);
        if (range.offsetParent === null) continue;
        const box = number.getBoundingClientRect();
        const slider = range.getBoundingClientRect();
        const original = number.value;
        const decimals = (original.split(".")[1] ?? "").length;
        for (const value of [
          original,
          Number(number.min).toFixed(decimals),
          Number(number.max).toFixed(decimals),
        ]) {
          number.value = value;
          if (number.scrollWidth > number.clientWidth + 1)
            clipped.push({
              id: range.id,
              value,
              width: box.width,
              clientWidth: number.clientWidth,
              scrollWidth: number.scrollWidth,
            });
        }
        number.value = original;
        rows.push({
          id: range.id,
          width: box.width,
          height: box.height,
          track: slider.width,
          value: original,
        });
      }
      const targets = [
        ...host.querySelectorAll(
          'input[type="color"], .checkbox-label, summary',
        ),
      ]
        .filter((el) => el.offsetParent !== null)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            id: el.id || el.textContent.trim(),
            width: rect.width,
            height: rect.height,
          };
        });
      return {
        label,
        active,
        rows,
        targets,
        clipped,
        unpaired,
        availability,
        overflow: panel.scrollWidth - panel.clientWidth,
        note: document.getElementById("surfaceAuthoredLightingNote")
          .textContent,
        mode: window.__surfaceState().mode,
      };
    },
    { label, active },
  );
  report.audits.push(result);
  check(
    `${label}: complete paired editor`,
    result.rows.length === 25 && result.unpaired.length === 0,
    result.unpaired,
  );
  check(
    `${label}: applicability and paired availability`,
    result.availability.length === 0 &&
      (active
        ? /restart Surface convergence/.test(result.note)
        : /Enter Surface/.test(result.note)),
    result.availability,
  );
  check(
    `${label}: 44px fields, tracks and touch targets`,
    result.rows.every(
      (r) => r.width >= 44 && r.height >= 44 && r.track >= 44,
    ) && result.targets.every((r) => r.width >= 44 && r.height >= 44),
    { rows: result.rows, targets: result.targets },
  );
  check(
    `${label}: no horizontal panel overflow`,
    result.overflow <= 1,
    result.overflow,
  );
  check(
    `${label}: authored and domain values fit`,
    result.clipped.length === 0,
    result.clipped,
  );
  await page.locator("#surfaceRigKeyIntensityNumber").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(options.out, `${label}-key.png`) });
  await page.locator("#surfaceRigMediumDensityNumber").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(options.out, `${label}-mist.png`) });
  return result;
}

async function dormant(page, fixture, next, width) {
  const label = `${fixture.id}-${width}-dormant`;
  await boot(page, fixture);
  check(
    `${label}: hash retains exact rig`,
    same(
      (await hashDocument(page)).surface.lighting,
      fixture.document.surface.lighting,
    ),
    null,
  );
  await audit(page, label, false);
  const saved = await saveDocument(page);
  check(
    `${label}: Collection captures exact rig and camera`,
    same(saved.document.surface.lighting, fixture.document.surface.lighting) &&
      same(saved.document.camera, fixture.document.camera),
    { expected: fixture.document.camera, actual: saved.document.camera },
  );
  await boot(page, next);
  await open(page, "collectionSection");
  await page.click("#galleryBtn");
  await page.locator(".gallery-card-load").first().click();
  await page.waitForFunction(
    (expectedFlux) => {
      const doc = JSON.parse(
        atob(location.hash.slice(4).replace(/-/g, "+").replace(/_/g, "/")),
      );
      return doc.surface?.lighting?.lights?.[0]?.intensity === expectedFlux;
    },
    fixture.document.surface.lighting.lights[0].intensity,
    { timeout: 20_000 },
  );
  const restored = await saveDocument(page);
  check(
    `${label}: gallery restores lighting and saved camera`,
    same(
      restored.document.surface.lighting,
      fixture.document.surface.lighting,
    ) && same(restored.document.camera, fixture.document.camera),
    restored.document.camera,
  );
  await open(page, "atmosphereSection");
  await page.locator("#fogSliderNumber").fill("0.25");
  await page.locator("#fogSliderNumber").press("Enter");
  await page.waitForFunction(
    () =>
      JSON.parse(
        atob(location.hash.slice(4).replace(/-/g, "+").replace(/_/g, "/")),
      ).fogDensity === 0.25,
  );
  await page.click("#undoBtn");
  await page.waitForFunction(
    () =>
      JSON.parse(
        atob(location.hash.slice(4).replace(/-/g, "+").replace(/_/g, "/")),
      ).fogDensity === 0,
  );
  check(
    `${label}: Undo keeps dormant rig intact`,
    same(
      (await hashDocument(page)).surface.lighting,
      fixture.document.surface.lighting,
    ),
    null,
  );
  check(
    `${label}: stayed in Points`,
    (await page.evaluate(() => window.__surfaceState().mode)) === "points",
    null,
  );
}

async function active(page, fixture, width) {
  const label = `${fixture.id}-${width}-active`;
  await boot(page, fixture);
  await open(page, "presetSection");
  await page.selectOption("#surfaceLightingStarterSelect", fixture.id);
  await page.waitForFunction(
    () => window.__surfaceState().mode === "surface",
    undefined,
    { timeout: 60_000 },
  );
  check(
    `${label}: starter menu enters Surface and resets`,
    (await page.locator("#surfaceLightingStarterSelect").inputValue()) === "",
    null,
  );
  await audit(page, label, true);
  const saved = await saveDocument(page);
  check(
    `${label}: starter installs its complete saved camera and rig`,
    same(saved.document.camera, fixture.document.camera) &&
      same(saved.document.surface.lighting, fixture.document.surface.lighting),
    saved.document.camera,
  );
  await open(page, "surfaceAuthoredLightingSection");
  const input = page.locator("#surfaceRigKeyIntensityNumber");
  await input.scrollIntoViewIfNeeded();
  await input.tap();
  check(
    `${label}: trusted touch focuses exact input`,
    await input.evaluate((el) => document.activeElement === el),
    null,
  );
  const flux = fixture.document.surface.lighting.lights[0].intensity;
  const editedFlux = flux + 0.123456789;
  const steppedFlux = Number((editedFlux + 0.1).toFixed(12));
  await input.fill(String(editedFlux));
  await input.press("Enter");
  await page.waitForFunction(
    (flux) =>
      JSON.parse(
        atob(location.hash.slice(4).replace(/-/g, "+").replace(/_/g, "/")),
      ).surface.lighting.lights[0].intensity === flux,
    editedFlux,
  );
  check(
    `${label}: exact numeric edit reaches hash`,
    (await hashDocument(page)).surface.lighting.lights[0].intensity ===
      editedFlux,
    null,
  );
  const exactField = await input.evaluate((element) => ({
    value: element.value,
    width: element.getBoundingClientRect().width,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  check(
    `${label}: long exact input remains fully visible`,
    exactField.scrollWidth <= exactField.clientWidth + 1,
    exactField,
  );
  const before = await page.evaluate(() => location.hash);
  await input.fill("-1");
  await input.press("Enter");
  check(
    `${label}: invalid input refuses document change`,
    (await input.getAttribute("aria-invalid")) === "true" &&
      (await page.evaluate(() => location.hash)) === before,
    null,
  );
  await input.press("Escape");
  check(
    `${label}: Escape restores accepted exact value`,
    Number(await input.inputValue()) === editedFlux,
    null,
  );
  await input.press("ArrowUp");
  await page.waitForFunction(
    (flux) =>
      JSON.parse(
        atob(location.hash.slice(4).replace(/-/g, "+").replace(/_/g, "/")),
      ).surface.lighting.lights[0].intensity === flux,
    steppedFlux,
  );
  check(
    `${label}: Arrow follows exact increment`,
    Number(await input.inputValue()) === steppedFlux,
    null,
  );
  await page.click("#undoBtn");
  // Undo arms a BARE debounced save of the restored document, so the hash is
  // rewritten SAVE_DEBOUNCE_MS (300ms) after the click, not with it. The
  // fixed 200ms sleep this replaces therefore lost deterministically rather
  // than flakily, which is why the active phase never reached its end while
  // the dormant phase's identical undo gesture passed: that one already waits
  // on the document itself. Wait the same way here, and keep the timeout
  // INSIDE the check so a real regression reads as an assertion failure
  // (exit 1) instead of a checking failure (exit 2).
  const undone = await page
    .waitForFunction(
      (flux) =>
        JSON.parse(
          atob(location.hash.slice(4).replace(/-/g, "+").replace(/_/g, "/")),
        ).surface.lighting.lights[0].intensity !== flux,
      steppedFlux,
      { timeout: 5_000 },
    )
    .then(
      () => true,
      () => false,
    );
  check(
    `${label}: lighting edit is undoable`,
    undone &&
      (await hashDocument(page)).surface.lighting.lights[0].intensity ===
        editedFlux,
    null,
  );
  await page.locator("#modePointsBtn").evaluate((el) => el.click());
  await page.waitForFunction(() => window.__surfaceState().mode === "points");
}

await mkdir(path.dirname(options.out), { recursive: true });
await mkdir(options.out, { recursive: false });
const generated = await fixtures();
await writeFile(
  path.join(options.out, "fixtures.json"),
  JSON.stringify(generated, null, 2),
);
const env = { ...process.env };
delete env.DISPLAY;
let browser;
try {
  browser = options.display
    ? await launchSurfaceBrowser(`x11:${options.display}`)
    : await chromium.launch({
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
  for (const viewport of viewports) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
      viewport,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(error.message));
    for (const [index, fixture] of generated.entries()) {
      log(
        `${options.phase}: ${fixture.id} at ${viewport.width}x${viewport.height}`,
      );
      if (options.phase === "dormant")
        await dormant(page, fixture, generated[1 - index], viewport.width);
      else await active(page, fixture, viewport.width);
    }
    await context.close();
  }
  check("no uncaught page errors", report.errors.length === 0, report.errors);
  report.verdict = report.checks.every((item) => item.okay) ? "pass" : "fail";
  process.exitCode = report.verdict === "pass" ? 0 : 1;
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  report.verdict = "checking-failed";
  log(String(error));
  process.exitCode = 2;
} finally {
  await browser?.close();
  await writeFile(
    path.join(options.out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  log(`${report.verdict}: ${options.out}/report.json`);
}
