#!/usr/bin/env node
/** Production-browser functional gate for authored Surface lighting.
 *
 *   npm run build && npm run preview
 *   node scripts/cinematic-lighting.verify.mjs --display=:0 --scene=cathedral
 *     --engine=compute --size=256 --export=none --checks=appearance
 *
 * Defaults: both engines, cathedral/Balloon/simple non-flat 4D, 256 square,
 * full authored AA, edit/restore/cancel checks, and untiled+tiled PNGs. Narrow
 * the flags while diagnosing. `--samples=N` is explicitly diagnostic and is
 * recorded; only an unoverridden run qualifies the authored sampling budget.
 * GPU work is serial. Run on a quiet machine with a verified display cookie.
 *
 * Uses UI event handlers and the app's Collection encoder, never private scene
 * mutation hooks. Scene variants are ordinary hash documents, and every
 * comparison after the starter is configured runs against a RELOAD of the
 * saved document — `persist.ts` rounds on encode, so a live session and a
 * reload of its own hash differ slightly, and that difference must not be
 * charged to whatever two images a check happens to compare. Pixels are read
 * from screenshots/downloads; out-of-rAF WebGL readback is never evidence.
 * The aperture variant removes one visible Menger corner branch: it gates a
 * geometry edit reaching production shading, not a separate transport oracle.
 * The CPU reference tests own the controlled two-path occlusion proof.
 *
 * Records actual backend, primary/visibility refusals, JS heap, wall time and
 * the known per-frame GPU buffer footprint. Heap/footprint are not peak GPU
 * memory measurements. This gate does not replace owner aesthetic judgment.
 * Exit 0 = functional checks pass; 2 = checking/browser setup failed;
 * 3 = an app assertion failed. Artifacts are never overwritten.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  launchSurfaceBrowser,
  pollSurfaceState,
} from "./lib/surface-browser-runner.mjs";

const args = {
  url: "https://localhost:4173",
  mode: "sw",
  scene: "all",
  engine: "both",
  size: 256,
  export: "both",
  checks: "all",
  timeout: 600_000,
  samples: null,
  out: `scripts/out/cinematic-lighting/browser-${new Date().toISOString().replaceAll(":", "-")}`,
};
for (const raw of process.argv.slice(2)) {
  const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
  if (!match) throw new Error(`Invalid argument ${raw}`);
  const [, key, value] = match;
  if (key === "display") args.mode = `x11:${value ?? ":0"}`;
  else if (["size", "timeout", "samples"].includes(key))
    args[key] = Number(value);
  else if (Object.hasOwn(args, key) && value !== undefined) args[key] = value;
  else throw new Error(`Unknown or incomplete option ${raw}`);
}
assert(["all", "cathedral", "balloon-cavern", "slice4"].includes(args.scene));
assert(["both", "compute", "webgl"].includes(args.engine));
assert(["none", "single", "tiled", "both"].includes(args.export));
assert(["all", "appearance"].includes(args.checks));
assert(Number.isInteger(args.size) && args.size >= 32 && args.size <= 1024);
assert(Number.isFinite(args.timeout) && args.timeout > 0);
assert(
  args.samples === null ||
    (Number.isInteger(args.samples) && args.samples >= 1 && args.samples <= 64),
);

const report = {
  args,
  startedAt: new Date().toISOString(),
  verdict: "running",
  cases: [],
};
let serial = 0;
const log = (message) => console.log(`[cinematic-browser] ${message}`);
const encode = (document) =>
  `v1=${Buffer.from(JSON.stringify(document)).toString("base64url")}`;
const decode = (encoded) => {
  assert(
    encoded.startsWith("v1="),
    "expected the production v1 scene encoding",
  );
  return JSON.parse(
    Buffer.from(encoded.slice(3), "base64url").toString("utf8"),
  );
};

function urlFor(engine, encoded = "", tileCap = null) {
  const query = new URLSearchParams({
    surfacestate: "",
    surfacetrace: "",
    stripdiag: "",
    run: String(++serial),
  });
  query.set(engine === "webgl" ? "surfacegl" : "surfacecompute", "");
  if (args.samples !== null) query.set("surfacesamples", String(args.samples));
  if (tileCap !== null) query.set("surfacemaxrays", String(tileCap));
  return `${args.url.replace(/\/+$/, "")}/?${query}${encoded ? `#${encoded}` : ""}`;
}

async function uiClick(page, selector) {
  await page.locator(selector).evaluate((element) => {
    if (element.disabled)
      throw new Error(`${element.id} is disabled: ${element.title}`);
    element.click();
  });
}

async function uiValue(page, selector, value, checkbox = false) {
  return page.locator(selector).evaluate(
    (element, update) => {
      if (element.disabled) throw new Error(`${element.id} is disabled`);
      if (update.checkbox) element.checked = update.value;
      else element.value = String(update.value);
      if (element.type === "range")
        element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return window.__surfaceState?.() ?? null;
    },
    { value, checkbox },
  );
}

async function boot(page, engine, encoded = "", tileCap = null) {
  await page.goto(urlFor(engine, encoded, tileCap), {
    waitUntil: "load",
    timeout: 60_000,
  });
  await page.bringToFront();
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
  await page.locator("#autoMotionToggle").evaluate((element) => {
    if (element.checked && !element.disabled) {
      element.checked = false;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

async function settled(page, engine, label) {
  const start = Date.now();
  let nextLog = start + 10_000;
  for (;;) {
    const state = await pollSurfaceState(page);
    if (state.settled) {
      assert.equal(state.probe.engine, engine, `${label}: wrong engine`);
      assert(state.probe.backend?.label, `${label}: missing backend identity`);
      if (args.mode !== "sw")
        assert.equal(
          state.probe.backend.software,
          false,
          `${label}: real-driver run silently fell back to software`,
        );
      assert(
        state.probe.census?.rays > 0,
        `${label}: missing completed primary census`,
      );
      assert(state.probe.census.covered > 0, `${label}: no covered geometry`);
      if (state.probe.lightingVisibility)
        assert.equal(
          state.probe.lightingVisibility.invalid,
          0,
          `${label}: invalid visibility queries`,
        );
      return { wallMs: Date.now() - start, probe: state.probe };
    }
    if (Date.now() >= nextLog) {
      log(`${label}: ${state.rowText || JSON.stringify(state.probe)}`);
      nextLog = Date.now() + 10_000;
    }
    assert(
      Date.now() - start < args.timeout,
      `${label}: settle timed out: ${JSON.stringify(state)}`,
    );
    await page.waitForTimeout(250);
  }
}

async function enter(page) {
  if ((await page.evaluate(() => window.__surfaceState().mode)) !== "surface")
    await uiClick(page, "#modeSurfaceBtn");
}

/** The app's authoritative camera+4D+look encoder, reached through Save scene. */
async function savedDocument(page) {
  const key = "fractal-viewer:collection";
  const before = await page.evaluate((key) => localStorage.getItem(key), key);
  await uiClick(page, "#saveCollectionBtn");
  await page.waitForFunction(
    ({ key, before }) => localStorage.getItem(key) !== before,
    { key, before },
    { timeout: 15_000 },
  );
  const encoded = await page.evaluate((key) => {
    const parsed = JSON.parse(localStorage.getItem(key));
    // Collection.add unshifts the newest document and removes an older
    // duplicate, so the first row is the just-saved camera/rig.
    return (Array.isArray(parsed) ? parsed : parsed.scenes)[0]?.encoded;
  }, key);
  const document = decode(encoded);
  assert(document.surface?.lighting, "saved document lost the lighting rig");
  assert(document.camera, "saved document lost its camera");
  return { encoded, document };
}

const shotStyle =
  "#panel,#help,#legend,#menuToggle,#loading,#error,#updateBanner,#renderError,#toast { visibility:hidden !important }";
async function screenshot(page, filename) {
  const bytes = await page
    .locator("#container canvas")
    .first()
    .screenshot({ type: "png", style: shotStyle });
  await writeFile(path.join(args.out, filename), bytes);
  return bytes;
}

async function compare(page, a, b = a) {
  return page.evaluate(
    async ([a64, b64]) => {
      const read = async (base64) => {
        const blob = new Blob(
          [
            Uint8Array.from(atob(base64), (character) =>
              character.charCodeAt(0),
            ),
          ],
          { type: "image/png" },
        );
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return {
          width: canvas.width,
          height: canvas.height,
          bytes: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      };
      const left = await read(a64),
        right = await read(b64);
      if (left.width !== right.width || left.height !== right.height)
        return {
          dimensionsDiffer: true,
          left: [left.width, left.height],
          right: [right.width, right.height],
        };
      let sum = 0,
        changed = 0,
        clipped = 0,
        min = 255,
        max = 0;
      const means = [0, 0, 0];
      for (let p = 0; p < left.bytes.length; p += 4) {
        let delta = 0;
        for (let c = 0; c < 3; c++) {
          const value = left.bytes[p + c];
          const difference = Math.abs(value - right.bytes[p + c]);
          sum += difference;
          delta = Math.max(delta, difference);
          means[c] += value;
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
        if (delta > 2) changed++;
        if (
          left.bytes[p] === 255 ||
          left.bytes[p + 1] === 255 ||
          left.bytes[p + 2] === 255
        )
          clipped++;
      }
      const pixels = left.width * left.height;
      return {
        width: left.width,
        height: left.height,
        meanDiff: sum / (pixels * 3),
        changedFraction: changed / pixels,
        clippedFraction: clipped / pixels,
        min,
        max,
        meanRgb: means.map((value) => value / pixels),
      };
    },
    [a.toString("base64"), b.toString("base64")],
  );
}

function simpleFourD(base) {
  const document = structuredClone(base);
  // An ordinary filled 4-cube IFS, seen at a nonzero w slice under a valid
  // nonidentity Spin(4) pose. This is a mechanics fixture, not the deferred
  // authored 4D shells composition. The sixteen contractions fill R4 volume.
  document.transforms = Array.from({ length: 16 }, (_, bits) => ({
    position: [0, 1, 2].map((axis) => (bits & (1 << axis) ? 0.5 : -0.5)),
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
    w: { position: bits & 8 ? 0.5 : -0.5 },
  }));
  delete document.finalTransform;
  document.balloonEcho = false;
  document.groundPlane = false;
  document.camera = {
    target: [0, 0, 0],
    radius: 4,
    theta: 0.6,
    phi: 1.15,
    fov: 45,
  };
  // The ENCODED wire is flat `{p, q, ...}` (persist.ts's `validateFourD`
  // requires `f.p`/`f.q` arrays); the nested `{pair: {p, q}}` shape is the
  // in-memory FourDPose. Emitting the in-memory shape here made the decoder
  // drop the whole pose, so the app booted with no slice and a fresh rotor
  // and the non-flat assertions below failed on both engines.
  document.fourD = {
    p: [Math.cos(0.15), Math.sin(0.15), 0, 0],
    q: [Math.cos(0.15), Math.sin(0.15), 0, 0],
    sliceOn: true,
    sliceCenter: 0.12,
    sliceThickness: 0,
    sliceRelColor: false,
  };
  document.surface.lighting = {
    lights: [
      {
        position: [2, 3, 2],
        normal: [-2, -3, -2],
        radius: 0.3,
        color: [1, 0.5, 0.2],
        intensity: 60,
      },
      {
        position: [-2, 1, 1],
        normal: [2, -1, -1],
        radius: 0.35,
        color: [0.15, 0.45, 1],
        intensity: 30,
      },
    ],
    ambient: [0.05, 0.05, 0.06],
    specular: 0.15,
    roughness: 0.45,
    medium: {
      center: [0, 0, 0],
      radius: 2.5,
      density: 0.12,
      tint: [0.9, 0.95, 1],
      anisotropy: 0.3,
    },
  };
  return document;
}

async function exportPng(page, filename) {
  await uiValue(page, "#exportScale", "1");
  const start = Date.now();
  const downloading = page.waitForEvent("download", { timeout: args.timeout });
  await uiClick(page, "#savePngBtn");
  const download = await downloading;
  assert.equal(await download.failure(), null, "PNG download failed");
  const bytes = await readFile(await download.path());
  await writeFile(path.join(args.out, filename), bytes);
  return { bytes, wallMs: Date.now() - start };
}

async function memory(page) {
  return page.evaluate(() => ({
    jsHeap: performance.memory
      ? {
          used: performance.memory.usedJSHeapSize,
          total: performance.memory.totalJSHeapSize,
          limit: performance.memory.jsHeapSizeLimit,
        }
      : null,
    heartbeat: window.__cinematicHeartbeat,
  }));
}

async function runCase(browser, scene, engine) {
  const label = `${scene}-${engine}`;
  const row = {
    scene,
    engine,
    status: "running",
    checks: {},
    console: [],
    errors: [],
    tiles: [],
    fences: {
      medium: { count: 0, dispatches: 0, wallMs: 0, maxMs: 0, maxGrouped: 0 },
      surface: { count: 0, wallMs: 0, maxMs: 0 },
      march: { count: 0, wallMs: 0, maxMs: 0 },
    },
    startedAt: Date.now(),
  };
  report.cases.push(row);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: args.size, height: args.size },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => row.errors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    const mediumFence = /medium END dispatches=(\d+) ms=([\d.]+)/.exec(text);
    if (mediumFence) {
      const metric = row.fences.medium;
      const count = Number(mediumFence[1]),
        ms = Number(mediumFence[2]);
      metric.count++;
      metric.dispatches += count;
      metric.wallMs += ms;
      metric.maxMs = Math.max(metric.maxMs, ms);
      metric.maxGrouped = Math.max(metric.maxGrouped, count);
    }
    const otherFence = /(shade|march) END ms=([\d.]+)/.exec(text);
    if (otherFence) {
      const metric =
        row.fences[otherFence[1] === "shade" ? "surface" : "march"];
      const ms = Number(otherFence[2]);
      metric.count++;
      metric.wallMs += ms;
      metric.maxMs = Math.max(metric.maxMs, ms);
    }
    if (
      message.type() === "error" ||
      /device lost|validation error|uncaptured error/i.test(text)
    )
      row.errors.push(text);
    if (!text.startsWith("[surfacetrace]"))
      row.console.push({ type: message.type(), text });
    const tile = /Surface compute export tile (\d+)\/(\d+)/.exec(text);
    if (tile)
      row.tiles.push({ index: Number(tile[1]), total: Number(tile[2]) });
  });
  await page.addInitScript(() => {
    window.__cinematicHeartbeat = { frames: 0, maxGapMs: 0, previous: null };
    const tick = (now) => {
      const state = window.__cinematicHeartbeat;
      if (state.previous !== null)
        state.maxGapMs = Math.max(state.maxGapMs, now - state.previous);
      state.previous = now;
      state.frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  try {
    await boot(page, engine);
    row.memoryBefore = await memory(page);
    await uiValue(
      page,
      "#surfaceLightingStarterSelect",
      scene === "slice4" ? "cathedral" : scene,
    );
    const initial = await settled(page, engine, `${label}/starter`);
    row.checks.starterAutomaticEntry = true;
    let saved = await savedDocument(page);
    if (scene === "slice4") {
      const fixture = simpleFourD(saved.document);
      await boot(page, engine, encode(fixture));
      await enter(page);
      await settled(page, engine, `${label}/nonflat`);
      saved = await savedDocument(page);
      assert(
        saved.document.transforms.some(
          (transform) => Math.abs(transform.w?.position ?? 0) > 0,
        ),
      );
      assert(
        saved.document.fourD?.sliceOn && saved.document.fourD.sliceCenter !== 0,
      );
      row.checks.nonFlatDocument = true;
    }
    // FROM HERE ON THE FIXTURE IS THE SAVED DOCUMENT, not the panel state
    // that produced it. `persist.ts` rounds on encode, so a session
    // configured through the UI and a session reloaded from its own saved
    // hash render a hair apart — MEASURED 0.127/255 mean, 1.2% of channels,
    // on cathedral/compute at one sample. That is a DOCUMENT difference,
    // and while the untiled arm exported the live session and the tiled arm
    // a reload of it, the band comparison below was charged for it: it read
    // 0.127 where the bands themselves were already exact. Reload once here
    // and the two export arms differ only in their ray cap.
    await boot(page, engine, saved.encoded);
    await enter(page);
    await settled(page, engine, `${label}/fixture`);
    row.initial = initial;
    row.settled = (await pollSurfaceState(page)).probe;
    row.estimatedFrameGpuBufferBytes =
      engine === "compute" ? row.settled.census.rays * 68 : null;
    await writeFile(
      path.join(args.out, `${label}.scene.json`),
      JSON.stringify(saved.document, null, 2),
    );
    await writeFile(path.join(args.out, `${label}.scene.txt`), saved.encoded);
    const baseline = await screenshot(page, `${label}.png`);
    row.image = await compare(page, baseline);
    assert(row.image.max - row.image.min > 10, `${label}: flat image`);
    assert.equal(
      await page.locator("#surfaceRigEnabled").isChecked(),
      true,
      `${label}: authored rig UI is not enabled`,
    );

    if (args.export === "single" || args.export === "both") {
      const single = await exportPng(page, `${label}-export.png`);
      row.export = {
        wallMs: single.wallMs,
        diff: await compare(page, baseline, single.bytes),
        image: await compare(page, single.bytes),
      };
      assert(
        row.export.image.max - row.export.image.min > 10,
        `${label}: exported PNG is flat`,
      );
      assert(
        !row.export.diff.dimensionsDiffer,
        `${label}: PNG has wrong dimensions`,
      );
      // Capture uses its own ray footprint, so this gates the subject rather
      // than claiming bit-exact agreement with the displayed still.
      assert(
        row.export.diff.meanDiff < 8,
        `${label}: exported PNG differs substantially from the settled Surface`,
      );
      row.singleExportBytes = single.bytes;
    }
    if (
      (args.export === "tiled" || args.export === "both") &&
      engine === "compute"
    ) {
      const cap = args.size * Math.max(1, Math.floor(args.size / 3));
      const tilesBefore = row.tiles.length;
      await boot(page, engine, saved.encoded, cap);
      await enter(page);
      await settled(page, engine, `${label}/tiled-live`);
      const tiled = await exportPng(page, `${label}-export-tiled.png`);
      row.tiledExport = {
        wallMs: tiled.wallMs,
        cap,
        tileLines: row.tiles.slice(tilesBefore),
      };
      assert(
        row.tiledExport.tileLines.some((tile) => tile.total > 1),
        `${label}: did not exercise capture bands`,
      );
      if (row.singleExportBytes) {
        row.tiledExport.diff = await compare(
          page,
          row.singleExportBytes,
          tiled.bytes,
        );
        // BIT-EXACT, not merely close. Nothing a band changes reaches the
        // per-pixel arithmetic any more: the ray's NDC, the march-start
        // dither and the transport's per-pixel seed are all derived from
        // the FULL-IMAGE pixel (bgOffset/bgExtent), the projection is the
        // whole image's, and the band's own raster height no longer enters
        // the app kernels at all. So an equal document traced in four
        // bands must return the same bytes, and any drift at all is a real
        // band-derived difference to explain rather than a tolerance to
        // widen. MEASURED 0 / 0% here against 0.408 mean, 5.9% of channels
        // before the fix (authored 8 samples), 0.699 / 10.1% at one.
        assert(
          !row.tiledExport.diff.dimensionsDiffer &&
            row.tiledExport.diff.meanDiff === 0 &&
            row.tiledExport.diff.changedFraction === 0,
          `${label}: capture bands did not reproduce the untiled export ` +
            `(mean ${row.tiledExport.diff.meanDiff?.toFixed(4) ?? "n/a"}/255, ` +
            `${((row.tiledExport.diff.changedFraction ?? 0) * 100).toFixed(2)}% of channels)`,
        );
      }
      await boot(page, engine, saved.encoded);
      await enter(page);
      await settled(page, engine, `${label}/restore-after-export`);
    }
    delete row.singleExportBytes;

    if (args.checks === "all") {
      const keyX = saved.document.surface.lighting.lights[0].position[0] + 0.23;
      const invalidated = await uiValue(page, "#surfaceRigKeyPositionX", keyX);
      assert.equal(
        invalidated.settled,
        false,
        `${label}: moving a light retained stale pixels`,
      );
      await settled(page, engine, `${label}/move-light`);
      const moved = await screenshot(page, `${label}-moved-light.png`);
      row.checks.lightMotion = await compare(page, baseline, moved);
      assert(
        row.checks.lightMotion.meanDiff > 0.005,
        `${label}: moving the light had no visible effect`,
      );
      const edited = await savedDocument(page);
      assert(
        Math.abs(
          edited.document.surface.lighting.lights[0].position[0] - keyX,
        ) < 1e-10,
        `${label}: edit was not persisted exactly`,
      );
      await boot(page, engine, edited.encoded);
      await enter(page);
      await settled(page, engine, `${label}/hash-restore`);
      const restored = await savedDocument(page);
      assert.deepEqual(
        restored.document.surface.lighting,
        edited.document.surface.lighting,
        `${label}: saved rig changed on reload`,
      );
      const restoredPixels = await screenshot(page, `${label}-restored.png`);
      row.checks.hashRestore = await compare(page, moved, restoredPixels);
      assert(
        row.checks.hashRestore.meanDiff < 0.15,
        `${label}: restored rig/camera image drifted`,
      );

      await uiValue(page, "#surfaceRigMediumDensity", 0);
      await settled(page, engine, `${label}/zero-density`);
      const zero = await screenshot(page, `${label}-zero-density.png`);
      await uiValue(page, "#surfaceRigMediumEnabled", false, true);
      await settled(page, engine, `${label}/no-medium`);
      const absent = await screenshot(page, `${label}-no-medium.png`);
      row.checks.zeroDensityIdentity = await compare(page, zero, absent);
      assert(
        row.checks.zeroDensityIdentity.meanDiff < 0.02,
        `${label}: zero-density differs from absent medium`,
      );

      await boot(page, engine, saved.encoded);
      await enter(page);
      await settled(page, engine, `${label}/restore-background`);
      const backgroundInvalidation = await uiValue(page, "#background", "haze");
      assert.equal(
        backgroundInvalidation.settled,
        false,
        `${label}: background edit did not retrace authored lighting`,
      );
      await settled(page, engine, `${label}/background`);
      const background = await screenshot(page, `${label}-background.png`);
      row.checks.background = await compare(page, baseline, background);
      assert(
        row.checks.background.meanDiff > 0.005,
        `${label}: background edit had no visible effect`,
      );

      if (scene !== "slice4") {
        const aperture = structuredClone(saved.document);
        const remove = aperture.transforms.findIndex(
          (transform) =>
            transform.position[0] < -0.1 &&
            transform.position[1] < -0.1 &&
            transform.position[2] > 0.1,
        );
        assert(
          remove >= 0,
          "Menger fixture no longer has the chosen corner branch",
        );
        aperture.transforms.splice(remove, 1);
        await writeFile(
          path.join(args.out, `${label}-opened-gap.scene.json`),
          JSON.stringify(aperture, null, 2),
        );
        await boot(page, engine, encode(aperture));
        await enter(page);
        await settled(page, engine, `${label}/opened-gap`);
        const gap = await screenshot(page, `${label}-opened-gap.png`);
        row.checks.geometryGap = await compare(page, baseline, gap);
        assert(
          row.checks.geometryGap.meanDiff > 0.005,
          `${label}: opening a geometry branch had no visible effect`,
        );
      }

      await uiValue(page, "#surfaceRigKeyPositionX", keyX + 0.17);
      await page.waitForFunction(
        () => {
          const state = window.__surfaceState?.();
          return state?.previewActive || state?.settleActive;
        },
        undefined,
        { timeout: 30_000 },
      );
      const beforeCancel = await pollSurfaceState(page);
      const cancelStart = Date.now();
      await uiClick(page, "#modePointsBtn");
      await page.waitForFunction(
        () => window.__surfaceState?.().mode === "points",
        undefined,
        { timeout: 10_000 },
      );
      row.checks.cancel = {
        wallMs: Date.now() - cancelStart,
        caughtActive: beforeCancel.probe,
        submittedWorkNotSeparatelyProved: true,
      };
      await page.waitForTimeout(300);
      await enter(page);
      await settled(page, engine, `${label}/reenter-after-cancel`);
      row.checks.reenterAfterCancel = true;
    }
    row.memoryAfter = await memory(page);
    row.lastProbe = (await pollSurfaceState(page)).probe;
    const fatal = await page.locator("#error").textContent();
    assert.equal(fatal?.trim() ?? "", "", `${label}: fatal app banner`);
    assert.equal(
      row.errors.length,
      0,
      `${label}: browser errors: ${row.errors.slice(0, 3).join(" | ")}`,
    );
    row.status = "pass";
    log(
      `${label}: PASS, ${((Date.now() - row.startedAt) / 1000).toFixed(1)}s, ${row.settled.backend.label}`,
    );
  } catch (error) {
    row.status = "fail";
    row.failure = error.stack ?? String(error);
    row.failureProbe = await page
      .evaluate(() => window.__surfaceState?.() ?? null)
      .catch(() => null);
    await screenshot(page, `${label}-failure.png`).catch(() => {});
    log(`${label}: FAIL ${error.message}`);
  } finally {
    delete row.singleExportBytes;
    row.wallMs = Date.now() - row.startedAt;
    await writeFile(
      path.join(args.out, `${label}.report.json`),
      JSON.stringify(row, null, 2),
    );
    await context.close();
  }
}

let browser;
let outReady = false;
try {
  await mkdir(path.dirname(args.out), { recursive: true });
  await mkdir(args.out, { recursive: false });
  outReady = true;
  browser = await launchSurfaceBrowser(args.mode);
  const browserCdp = await browser.newBrowserCDPSession();
  report.browserGpu = (await browserCdp.send("SystemInfo.getInfo")).gpu;
  await browserCdp.detach();
  for (const scene of args.scene === "all"
    ? ["cathedral", "balloon-cavern", "slice4"]
    : [args.scene]) {
    for (const engine of args.engine === "both"
      ? ["compute", "webgl"]
      : [args.engine])
      await runCase(browser, scene, engine);
  }
  report.verdict = report.cases.every((row) => row.status === "pass")
    ? "pass"
    : "fail";
  report.qualification =
    args.mode === "sw" ? "software functional only" : "real-driver functional";
  if (
    args.scene !== "all" ||
    args.engine !== "both" ||
    args.checks !== "all" ||
    args.export !== "both"
  )
    report.qualification += "; partial matrix";
  if (args.samples !== null)
    report.qualification += "; diagnostic sample override";
  process.exitCode = report.verdict === "pass" ? 0 : 3;
} catch (error) {
  report.verdict = "checking-failed";
  report.failure = error.stack ?? String(error);
  console.error(report.failure);
  process.exitCode = 2;
} finally {
  await browser?.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  if (outReady)
    await writeFile(
      path.join(args.out, "report.json"),
      JSON.stringify(report, null, 2),
    );
}
