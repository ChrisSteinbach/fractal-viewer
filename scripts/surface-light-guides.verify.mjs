#!/usr/bin/env node
/** Production Points placement gate, both dimensions. Build and preview first.
 * Drives authored numeric controls, checks real scene-region screenshot pixels
 * (never a WebGL readback outside rAF), undo/reload, single/four/parallel views,
 * 4D rotor edits, and guide-free PNG/Collection output with the editor open.
 * No app state or renderer is patched. The only hidden-button clicks exercise
 * capture while the exclusive-open lighting section still owns visible guides.
 * Software rendering is sufficient: this measures behavior, not GPU speed.
 * node scripts/surface-light-guides.verify.mjs [https://localhost:4173]
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { build } from "esbuild";
import { launchSurfaceBrowser } from "./lib/surface-browser-runner.mjs";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { decodePng } from "./lib/pattern-release-artifacts.mjs";

const url = process.argv[2] ?? "https://localhost:4173";
const out = `scripts/out/surface-light-guides/${new Date().toISOString().replaceAll(":", "-")}`;
const viewport = { width: 1280, height: 800 };
const report = { checks: [], errors: [] };
const check = (name, okay, detail = null) => {
  console.log(`${okay ? "PASS" : "FAIL"} ${name}`);
  report.checks.push({ name, okay, detail });
};
const section = "#surfaceAuthoredLightingSection";

async function fixtures() {
  const result = await build({
    stdin: {
      contents: `import { initialState, setSurfaceLighting } from "./src/app/state.ts";
import { toSnapshot, encodeScene } from "./src/app/persist.ts";
import { DEFAULT_SURFACE_LIGHTING } from "./src/fractal/surface-lighting.ts";
import { pentatope } from "./src/fractal/presets.ts";
export default [3,4].map(dimension => {
  const state = setSurfaceLighting(initialState(true), DEFAULT_SURFACE_LIGHTING);
  state.showGuides = false; state.numPoints = 20000; state.fogDensity = 0;
  state.surface.antialiasSamples = 1;
  if (dimension === 4) state.transforms = pentatope();
  state.surface.lighting.lights[0].position = [-1.7, 1.6, 0.8];
  state.surface.lighting.lights[1].position = [1.8, 0.6, -0.7];
  const snapshot = { ...toSnapshot(state), camera: { target: [0,0,0], radius: 6, theta: 0, phi: Math.PI/2 } };
  return { dimension, encoded: encodeScene(snapshot) };
});`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  return (
    await import(
      `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
    )
  ).default;
}

async function open(page, selector, value = true) {
  if ((await page.locator(selector).evaluate((el) => el.open)) !== value)
    await page.locator(`${selector} > summary`).click();
  await page.waitForTimeout(250);
}

async function documentValue(page) {
  return page.evaluate(() =>
    JSON.parse(
      atob(location.hash.slice(4).replaceAll("-", "+").replaceAll("_", "/")),
    ),
  );
}

async function edit(page, id, value) {
  const input = page.locator(`#${id}Number`);
  await input.fill(String(value));
  await input.press("Enter");
  await page.waitForTimeout(450);
}

async function pixels(page, name) {
  const panel = await page.locator("#panel").boundingBox();
  const png = await page.screenshot({
    clip: {
      x: 0,
      y: 80,
      width: Math.floor(panel.x),
      height: viewport.height - 160,
    },
    path: path.join(out, `${name}.png`),
  });
  return decodePng(page, png);
}

function changes(
  a,
  b,
  rect = { x: 0, y: 0, width: a.width, height: a.height },
) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  let changed = 0;
  for (
    let y = Math.max(0, Math.floor(rect.y));
    y < Math.min(a.height, rect.y + rect.height);
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(rect.x));
      x < Math.min(a.width, rect.x + rect.width);
      x++
    ) {
      const offset = (y * a.width + x) * 4;
      if (
        [0, 1, 2].some(
          (channel) =>
            Math.abs(a.data[offset + channel] - b.data[offset + channel]) > 10,
        )
      )
        changed++;
    }
  }
  return changed;
}

async function savePng(page) {
  const pending = page.waitForEvent("download");
  await page.locator("#savePngBtn").evaluate((button) => button.click());
  const download = await pending;
  assert.equal(await download.failure(), null);
  return readFile(await download.path());
}

async function thumbnail(page) {
  await page.locator("#saveCollectionBtn").evaluate((button) => button.click());
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const stored = JSON.parse(
      localStorage.getItem("fractal-viewer:collection"),
    );
    const entries = Array.isArray(stored) ? stored : stored.scenes;
    return entries[0].thumbnail;
  });
}

await guardFreshDist({ url });
await mkdir(out, { recursive: true });
const generated = await fixtures();
const browser = await launchSurfaceBrowser("sw");
try {
  for (const fixture of generated) {
    const name = `${fixture.dimension}d`;
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      reducedMotion: "reduce",
      viewport,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.goto(`${url}/?surfacestate&surfacegl#${fixture.encoded}`);
    await page.waitForFunction(
      () =>
        window.__surfaceState?.().mode === "points" &&
        Number(
          document
            .getElementById("pointCount")
            .textContent.replace(/[^\d]/g, ""),
        ) > 0,
    );
    if (
      !(await page
        .locator("#panel")
        .evaluate((el) => el.classList.contains("open")))
    )
      await page.click("#menuToggle");
    await page.waitForTimeout(2600);
    const rig = (await documentValue(page)).surface.lighting;
    const off = await pixels(page, `${name}-closed`);
    await open(page, section);
    const on = await pixels(page, `${name}-guides`);
    await page.screenshot({ path: path.join(out, `${name}-editor.png`) });
    const drawn = changes(off, on);
    check(
      `${name}: guides draw independently of transform guides`,
      drawn > 1000,
      drawn,
    );
    // Independent projection oracle for the known +Z camera, centered in the
    // uncovered viewport. Each label sits just above its true world anchor.
    for (const [index, light] of rig.lights.entries()) {
      const scale =
        viewport.height / (2 * Math.tan(Math.PI / 6) * (6 - light.position[2]));
      const anchor = {
        x: on.width / 2 + light.position[0] * scale - 38,
        y: viewport.height / 2 - light.position[1] * scale - 80 - 40,
        width: 76,
        height: 32,
      };
      const count = changes(off, on, anchor);
      check(
        `${name}: ${index === 0 ? "Key" : "Rim"} label matches authored world position`,
        count > 500,
        { count, anchor },
      );
    }
    const pngOn = await savePng(page);
    const thumbOn = await thumbnail(page);
    await open(page, section, false);
    const closed = await pixels(page, `${name}-closed-again`);
    check(
      `${name}: closing the editor removes guides`,
      changes(off, closed) === 0,
      changes(off, closed),
    );
    const pngOff = await savePng(page);
    const thumbOff = await thumbnail(page);
    check(
      `${name}: PNG excludes guides with editor open`,
      pngOn.equals(pngOff),
    );
    check(
      `${name}: Collection thumbnail excludes guides with editor open`,
      typeof thumbOn === "string" &&
        thumbOn.startsWith("data:image/") &&
        thumbOn === thumbOff,
    );

    await open(page, section);
    await edit(page, "surfaceRigKeyPositionX", -0.7);
    const moved = await pixels(page, `${name}-moved`);
    check(
      `${name}: placement updates pixels and exact saved coordinates`,
      changes(on, moved) > 800 &&
        (await documentValue(page)).surface.lighting.lights[0].position[0] ===
          -0.7,
    );
    await page.click("#undoBtn");
    await page.waitForFunction(
      () =>
        JSON.parse(
          atob(
            location.hash.slice(4).replaceAll("-", "+").replaceAll("_", "/"),
          ),
        ).surface.lighting.lights[0].position[0] === -1.7,
    );
    check(
      `${name}: placement undo restores rig`,
      isDeepStrictEqual((await documentValue(page)).surface.lighting, rig),
      { expected: rig, actual: (await documentValue(page)).surface.lighting },
    );
    await page.waitForTimeout(1000);
    const beforeAim = await pixels(page, `${name}-before-aim`);
    await edit(page, "surfaceRigKeyAzimuth", 90);
    await edit(page, "surfaceRigKeyElevation", 0);
    const aimed = await pixels(page, `${name}-aimed`);
    check(
      `${name}: aim changes direction guide`,
      changes(beforeAim, aimed) > 80,
      changes(beforeAim, aimed),
    );
    await edit(page, "surfaceRigKeyRadius", 0.6);
    const resized = await pixels(page, `${name}-resized`);
    check(
      `${name}: radius changes true-size disk`,
      changes(aimed, resized) > 200,
      changes(aimed, resized),
    );
    const authored = (await documentValue(page)).surface.lighting;
    await page.reload();
    await page.waitForFunction(
      () =>
        window.__surfaceState?.().mode === "points" &&
        Number(document.getElementById("surfaceRigKeyRadiusNumber")?.value) ===
          0.6,
    );
    await open(page, section);
    check(
      `${name}: reload restores authored placement and aim`,
      isDeepStrictEqual((await documentValue(page)).surface.lighting, authored),
    );

    if (fixture.dimension === 4) {
      const before = await pixels(page, `${name}-before-rotor`);
      await page.keyboard.down("Shift");
      await page.mouse.move(350, 450);
      await page.mouse.down();
      await page.mouse.move(420, 480, { steps: 8 });
      await page.mouse.up();
      await page.keyboard.up("Shift");
      await page.waitForTimeout(500);
      const rotated = await pixels(page, `${name}-rotated`);
      check(
        `${name}: rotor changes fractal while retaining displayed-space rig`,
        changes(before, rotated) > 100 &&
          isDeepStrictEqual(
            (await documentValue(page)).surface.lighting,
            authored,
          ),
      );
    }
    for (const parallel of [false, true]) {
      await open(page, "#viewControls");
      await page.click("#pointsFourViewBtn");
      await page.locator("#pointsParallelViewsToggle").setChecked(parallel);
      const hidden = await pixels(page, `${name}-four-${parallel}-closed`);
      await open(page, section);
      const shown = await pixels(page, `${name}-four-${parallel}-guides`);
      await page.screenshot({
        path: path.join(out, `${name}-four-${parallel}-editor.png`),
      });
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        const rect = {
          x: ((quadrant % 2) * shown.width) / 2,
          y: (Math.floor(quadrant / 2) * shown.height) / 2,
          width: shown.width / 2,
          height: shown.height / 2,
        };
        const count = changes(hidden, shown, rect);
        check(
          `${name}: ${parallel ? "parallel" : "perspective"} pane ${quadrant + 1} shows guides`,
          count > 100,
          count,
        );
      }
    }
    await open(page, "#viewControls");
    await page.click("#pointsSingleViewBtn");
    for (const style of fixture.dimension === 3
      ? ["glow", "dof", "edl"]
      : ["glow", "dof"]) {
      await open(page, "#pointsDepthSection");
      await page.selectOption("#renderStyle", style);
      await page.waitForTimeout(2500);
      const hidden = await pixels(page, `${name}-${style}-closed`);
      await open(page, section);
      const shown = await pixels(page, `${name}-${style}-guides`);
      const count = changes(hidden, shown);
      check(
        `${name}: guides remain visible with ${style}`,
        count > 1000,
        count,
      );
    }
    const beforeSurface = (await documentValue(page)).surface.lighting;
    await page.setViewportSize({ width: 640, height: 480 });
    await page.click("#modeSurfaceBtn");
    await page.waitForFunction(
      () => window.__surfaceState?.().mode === "surface",
    );
    check(
      `${name}: Surface accepts the authored Points rig and keeps editor open`,
      isDeepStrictEqual(
        (await documentValue(page)).surface.lighting,
        beforeSurface,
      ) &&
        (await page.locator(section).evaluate((el) => el.open)) &&
        (await page.locator("#surfaceRigKeyPositionXNumber").isEnabled()),
    );
    await page.click("#modePointsBtn");
    await page.waitForFunction(
      () => window.__surfaceState?.().mode === "points",
    );
    await page.setViewportSize(viewport);
    await page.waitForTimeout(2500);
    const returned = await pixels(page, `${name}-returned-to-points`);
    await open(page, section, false);
    const returnedClosed = await pixels(page, `${name}-returned-closed`);
    check(
      `${name}: returning to Points restores placement guides`,
      changes(returned, returnedClosed) > 1000,
    );
    await open(page, section);
    await page.selectOption("#surfaceRigLightCount", "0");
    const ambientOpen = await pixels(page, `${name}-ambient-only`);
    await open(page, section, false);
    const ambientClosed = await pixels(page, `${name}-ambient-closed`);
    check(
      `${name}: ambient-only rig has no stale guides`,
      changes(ambientOpen, ambientClosed) === 0,
    );
    await context.close();
  }
  check(
    "no uncaught browser errors",
    report.errors.length === 0,
    report.errors,
  );
  process.exitCode = report.checks.every((item) => item.okay) ? 0 : 1;
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  console.error(error);
  process.exitCode = 2;
} finally {
  await browser.close();
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(`Report: ${out}/report.json`);
}
