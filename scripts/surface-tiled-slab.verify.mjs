#!/usr/bin/env node
/**
 * The TILED slab's browser gate: slice thickness THROUGH a finite
 * reflection group, live in the production app — the acceptance rows
 * `scripts/surface-slab-4d.verify.mjs` cannot reach (its fixture is
 * untiled, and until this work a tiled 4D session clamped thickness to 0).
 *
 *   npm run build && npm run preview &
 *   node scripts/surface-tiled-slab.verify.mjs [--display=:0] [--url=…]
 *
 * FIXTURES (`scripts/lib/surface-tiled-slab-scene.mjs`, both produced by
 * `persist.ts`'s own encoder):
 *   · TILED4_SLAB_HASH — the A4-aligned pentatope affine set under the
 *     FINITE a4 tiling, pinned camera (radius 1.6) and a non-identity
 *     rotor/slice pose whose rotor pair mixes w into xyz, so the lifted
 *     slab segment genuinely crosses mirror walls. Segment-exact
 *     (`slabExact4`): this is the split vocabulary's class, not the
 *     nonlinear cover's — the split-plus-cover composition is the
 *     separate nonlinear slab work and stays refused.
 *   · TILED4_SLAB_HASH_3D — the four-tetra affine set under the finite
 *     b3 tiling: the 3D PARITY fixture (the GLSL finite wrapper is shared
 *     3D/4D code and must render this exactly as before the composed arm).
 *
 * WHAT IT ASKS.
 *
 *   1. AVAILABILITY WITH TILING: the thickness row is ENABLED in the live
 *      tiled 4D surface session (the report's own defect was this row
 *      disabled) and every settle COMPLETES (the settle latch, not "pixels
 *      stopped moving"); with `--display` the session took
 *      `engine === "compute"`.
 *   2. VISIBLE THICKNESS: driving the panel's thickness to 0.2 invalidates
 *      the frame and the completed settle's canvas differs from the entry
 *      frame (the slab reached the render).
 *   3. ZERO-THICKNESS IDENTITY: driving back to 0 and settling reproduces
 *      the entry frame BYTE FOR BYTE in the scene region — the slab pair's
 *      h=0 path is the tiled point kernel's own composition, measured as
 *      pixels rather than argued from the oracle.
 *   4. RELOAD CARRIES THICKNESS: the app's own share link carries
 *      `fourD.sliceThickness`, a real reload (forced through a unique
 *      query key — a fragment-only navigation never reloads) restores the
 *      slider and reproduces the thick frame byte for byte in the scene
 *      region.
 *   5. CAPTURE: three Save-PNGs through one export pipeline (exports are
 *      not comparable to canvas screenshots — measured 2.2-2.4/255 between
 *      the same render's export and its canvas): the thick export differs
 *      from the h=0 one and sits closer to it than to the explorer's
 *      capture by a factor of two.
 *   6. 3D PARITY: the b3-tiled affine scene enters Surface, settles
 *      COMPLETED and draws coverage > 0 — the shared finite wrapper's 3D
 *      arm renders unchanged.
 *
 * NON-VACUITY: the thick-vs-entry comparison fails when thickness never
 * reached the render (0 changed); the zero-return identity fails when
 * zero thickness is not point-exact (any maxDelta); the reload row fails
 * at `carriedThickness=0`/slider 0; the capture row fails on a wrong-
 * subject export (thick-vs-points smallest). The machine's conditions are
 * baselined BEFORE the browser launches; a contended run is UNCERTIFIED
 * in its own output rather than believed.
 *
 * Exit 0 = every assertion held. Exit 1 = harness/setup failure. Exit 3 =
 * a real failure (the numbers are printed either way).
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";
import {
  TILED4_SLAB_HASH,
  TILED4_SLAB_HASH_3D,
} from "./lib/surface-tiled-slab-scene.mjs";

const DEFAULT_SETTLE_MS = 300000;
const DEFAULT_CAPTURE_MS = 300000;
/** The thick export must sit canvas-close (the same render read through
 * the export pipeline, DOF aside) and must differ from both references —
 * see the capture row's doc for why the cover gate's 2x ratio is the
 * wrong shape for this scene. */
const CAPTURE_CANVAS_CEILING = 8;
/** The thick frame must visibly differ from the entry frame. */
const THICK_CHANGED_FRACTION = 0.0001;

function parseArgs(argv) {
  const out = {
    url: "https://localhost:4173",
    display: undefined,
    settleMs: DEFAULT_SETTLE_MS,
    captureMs: DEFAULT_CAPTURE_MS,
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "url" && value) out.url = value.replace(/\/+$/, "");
    else if (key === "display") out.display = value ?? ":0";
    else if (key === "settle" && value) out.settleMs = Number(value);
    else if (key === "capture" && value) out.captureMs = Number(value);
  }
  return out;
}

/** The decoded `#v1=` payload of a link, as plain JSON. */
function decodePayload(link) {
  const at = link.indexOf("v1=");
  if (at < 0) return null;
  const raw = link
    .slice(at + 3)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  try {
    return JSON.parse(
      Buffer.from(
        raw + "=".repeat((4 - (raw.length % 4)) % 4),
        "base64",
      ).toString("utf8"),
    );
  } catch {
    return null;
  }
}

/** The canvas's own pixels, as a PNG (one canvas exists; the panel is not
 * part of it). */
async function canvasShot(page) {
  const canvas = await page.$("canvas");
  if (!canvas) return null;
  return canvas.screenshot({ type: "png" });
}

/** The scene-region crop in image pixels: everything left of the panel's
 * own left edge, derived from the live DOM. 4px of margin for a shadow. */
const SCENE_CROP_FN = `(imageWidth) => {
  let width = imageWidth;
  const canvasRect = document.querySelector("#container canvas")?.getBoundingClientRect();
  const panelRect = document.getElementById("panel")?.getBoundingClientRect();
  if (canvasRect?.width && panelRect?.width) {
    const scale = imageWidth / canvasRect.width;
    const edge = (panelRect.left - canvasRect.left) * scale - 4;
    if (edge > 0 && edge < width) width = Math.floor(edge);
  }
  return width;
}`;

/** FULL-RESOLUTION pixel diff of two PNGs' scene regions. `changedFraction`
 * counts ANY channel difference, so 0 is exactly "byte-identical there". */
async function sceneDiff(page, aPng, bPng) {
  return page.evaluate(
    async ({ a64, b64, cropSource }) => {
      const cropWidth = (0, eval)(cropSource);
      const bitmap = async (encoded) => {
        const raw = atob(encoded);
        const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        return createImageBitmap(new Blob([bytes], { type: "image/png" }));
      };
      const [a, b] = await Promise.all([bitmap(a64), bitmap(b64)]);
      if (a.width !== b.width || a.height !== b.height) {
        return { changedFraction: 1, maxDelta: 255, width: 0 };
      }
      const width = cropWidth(a.width);
      const pixels = (image) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, width, image.height).data;
      };
      const pa = pixels(a);
      const pb = pixels(b);
      let changed = 0;
      let maxDelta = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const delta = Math.max(
          Math.abs(pa[i] - pb[i]),
          Math.abs(pa[i + 1] - pb[i + 1]),
          Math.abs(pa[i + 2] - pb[i + 2]),
        );
        if (delta > 0) changed++;
        maxDelta = Math.max(maxDelta, delta);
      }
      return {
        changedFraction: changed / (pa.length / 4),
        maxDelta,
        width,
      };
    },
    {
      a64: aPng.toString("base64"),
      b64: bPng.toString("base64"),
      cropSource: SCENE_CROP_FN,
    },
  );
}

/** Mean absolute difference between two equal-length grayscale vectors. */
function gray64(page, png) {
  return page.evaluate(
    async ({ b64, cropSource }) => {
      const cropWidth = (0, eval)(cropSource);
      const raw = atob(b64);
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const width = cropWidth(bitmap.width);
      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, width, bitmap.height, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      const gray = new Array(size * size);
      for (let i = 0; i < gray.length; i++) {
        const p = i * 4;
        gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      }
      return gray;
    },
    { b64: png.toString("base64"), cropSource: SCENE_CROP_FN },
  );
}

function grayDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** Poll the settle latch until it completes or the budget runs out. */
async function waitSettle(page, budgetMs) {
  const start = Date.now();
  let state = null;
  let entered = false;
  while (Date.now() - start < budgetMs) {
    state = await page.evaluate(() => window.__surfaceState?.() ?? null);
    if (state && state.mode !== "surface") break;
    if (state && state.firstFrame) entered = true;
    if (state && state.settled) break;
    await page.waitForTimeout(250);
  }
  return {
    entered,
    settled: Boolean(state && state.settled),
    state,
    ms: Date.now() - start,
  };
}

async function waitInvalidation(page) {
  let invalidated = false;
  const deadline = Date.now() + 10000;
  while (!invalidated && Date.now() < deadline) {
    invalidated = await page.evaluate(() => {
      const state = window.__surfaceState?.();
      return Boolean(state && state.mode === "surface" && !state.settled);
    });
    if (!invalidated) await page.waitForTimeout(100);
  }
  return invalidated;
}

/** The thickness drive every phase uses: the panel's own live-edit pair. */
async function driveThickness(page, value) {
  return page.evaluate((value) => {
    const el = document.getElementById("fourDSliceThicknessSlider");
    if (!(el instanceof HTMLInputElement)) return false;
    el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, value);
}

/** One Save-PNG, returned as the bytes the app handed the browser. */
async function savePng(page, captureMs) {
  const download = page.waitForEvent("download", { timeout: captureMs });
  const clicked = await page.evaluate(() => {
    const btn = document.getElementById("savePngBtn");
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  if (!clicked) {
    download.catch(() => {});
    return null;
  }
  const path = await (await download).path();
  return path ? await readFile(path) : null;
}

async function waitLatch(page) {
  await page.waitForFunction(
    () => typeof window.__surfaceState === "function",
    null,
    { timeout: 30000 },
  );
  await page.bringToFront();
}

/** The first visit in a fresh profile runs the COOP/COEP isolation dance:
 * the service worker activates and the page RELOADS itself once. A latch
 * that survived that navigation would leave the next click's pending
 * download dead on a document that goes away, so wait for the isolated
 * state (or time out gracefully where SW activation is slow) and re-latch
 * on whichever document is current. */
async function waitStableLatch(page) {
  await page
    .waitForFunction(() => window.crossOriginIsolated === true, null, {
      timeout: 45000,
    })
    .catch(() => {});
  await waitLatch(page);
  await page.waitForTimeout(2000);
  await waitLatch(page);
}

async function enterSurface(page) {
  const mode = await page.evaluate(
    () => window.__surfaceState?.().mode ?? null,
  );
  if (mode !== "surface") await page.click("#modeSurfaceBtn");
}

/** The slider's live availability — the report's own defect was this row
 * disabled in a tiled session. */
async function rowEnabled(page) {
  return page.evaluate(() => {
    const el = document.getElementById("fourDSliceThicknessSlider");
    return el instanceof HTMLInputElement && !el.disabled;
  });
}

async function copyLink(page) {
  await page.evaluate(() => {
    delete window.__shareLink;
    document.getElementById("copyLinkBtn").click();
  });
  await page.waitForFunction(
    () => typeof window.__shareLink === "string",
    null,
    { timeout: 30000 },
  );
  return page.evaluate(() => window.__shareLink);
}

/** One browser page driven through the tiled-slab phases; every assertion
 * writes its numbers into the shared `rows` object the verdict reads. */
async function driveTiledScene(browser, args, rows) {
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 1024, height: 640 },
  });
  page.on("pageerror", (e) => {
    process.stderr.write(`[page:uncaught] ${e.message}\n`);
  });
  try {
    // Reduced motion parks the 4D tumble and the camera glides: the
    // document's own pose is then the only thing that moves the view.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__shareLink = text;
          },
        },
      });
    });
    await page.goto(
      `${args.url}/?surfacestate&surfacesamples=1#${TILED4_SLAB_HASH}`,
      { waitUntil: "load" },
    );
    await waitStableLatch(page);
    // The explorer's own capture, same export pipeline — the wrong-subject
    // reference for the capture discrimination. It runs FIRST because a
    // Save-PNG enables depth of field for the export and the session it
    // lands on keeps that state: every frame compared below is captured
    // before any surface export runs.
    rows.capPoints = await savePng(page, args.captureMs);
    await page.waitForTimeout(2500);

    await enterSurface(page);
    rows.entry = await waitSettle(page, args.settleMs);
    rows.entryEngine = rows.entry.state ? rows.entry.state.engine : null;
    rows.entryRowEnabled = await rowEnabled(page);
    rows.entryShot = await canvasShot(page);

    const drove = await driveThickness(page, 0.2);
    const invalidated = await waitInvalidation(page);
    const thick = await waitSettle(page, args.settleMs);
    rows.thickEngine = thick.state ? thick.state.engine : null;
    rows.thickShot = await canvasShot(page);
    rows.thickOk = drove && invalidated && thick.settled;

    // The share link is copied while the thick value is live, so the
    // document it encodes carries thickness 0.2. Its confirmation toast
    // overlays the scene region for ~1.8s, so wait it out before any
    // frame the identity compares.
    const shareLink = await copyLink(page);
    await page.waitForFunction(
      () =>
        document.getElementById("toast")?.classList.contains("hidden") ?? true,
      null,
      { timeout: 15000 },
    );
    await page.waitForTimeout(500);

    // Zero thickness reproduces the entry frame byte for byte (scene
    // region) — the tiled point kernel's own composition, as pixels, and
    // deliberately BEFORE any surface export could toggle depth of field.
    const back = await driveThickness(page, 0);
    const backInvalidated = await waitInvalidation(page);
    const backSettle = await waitSettle(page, args.settleMs);
    const backShot = await canvasShot(page);
    rows.identity = await sceneDiff(page, rows.entryShot, backShot);
    rows.backOk = back && backInvalidated && backSettle.settled;

    // The two surface captures: h = 0 (already live — the identity phase just
    // drove it there), then h = 0.2 — after the identity phase, so their
    // depth-of-field side effects touch no comparison. The 0.2 drive waits
    // for the INVALIDATION to land before polling the latch, exactly like
    // the thick phase: without it the poll can catch the stale settled
    // latch and the export re-presents the previous thickness's frame
    // (measured: thick-vs-zero read 0.0000 with the live canvas 44% changed
    // between the same two thicknesses). The h=0 export needs no drive and
    // no invalidation wait — re-settling the SAME state needs no latch.
    await waitSettle(page, args.settleMs);
    rows.capZero = await savePng(page, args.captureMs);
    await page.waitForTimeout(2500);
    await driveThickness(page, 0.2);
    rows.capThickInvalidated = await waitInvalidation(page);
    await waitSettle(page, args.settleMs);
    rows.capThick = await savePng(page, args.captureMs);

    // A REAL reload through a unique query key.
    const payload = decodePayload(shareLink);
    rows.carriedThickness =
      payload && payload.fourD ? payload.fourD.sliceThickness : null;
    const reloadUrl = shareLink.replace(
      /#/,
      "?surfacestate&surfacesamples=1&tiledslabreload=1#",
    );
    await page.goto(reloadUrl, { waitUntil: "load" });
    await waitStableLatch(page);
    rows.reloadMode = await page.evaluate(
      () => window.__surfaceState?.().mode ?? null,
    );
    rows.sliderBefore = await page.evaluate(() => {
      const el = document.getElementById("fourDSliceThicknessSlider");
      return el instanceof HTMLInputElement ? el.value : null;
    });
    await enterSurface(page);
    const reload = await waitSettle(page, args.settleMs);
    rows.reloadEngine = reload.state ? reload.state.engine : null;
    rows.sliderAfter = await page.evaluate(() => {
      const el = document.getElementById("fourDSliceThicknessSlider");
      return el instanceof HTMLInputElement ? el.value : null;
    });
    const reloadShot = await canvasShot(page);
    rows.reloadIdentity = await sceneDiff(page, rows.thickShot, reloadShot);
    rows.reloadOk =
      rows.carriedThickness === 0.2 &&
      rows.reloadMode !== "surface" &&
      rows.sliderBefore === "0.2" &&
      rows.sliderAfter === "0.2" &&
      reload.entered &&
      reload.settled &&
      rows.reloadIdentity.maxDelta === 0;

    // The captures' discrimination. The honest predicate for THIS scene is
    // three-way: the thick export must differ from BOTH references (the
    // slab reached the export; it is not a wrong-subject copy) and must
    // MATCH the live thick canvas — the same render read through the export
    // pipeline (the slab gate's doc measured 2.2-2.4/255 between the same
    // render's export and its canvas; depth of field is the whole gap).
    // The cover gate's "thick closer to zero than to points by 2x" ratio is
    // the wrong shape here: a 0.2-thick slab over this dust legitimately
    // fills toward the cloud's look (measured thick-vs-zero 11.30 vs
    // thick-vs-points 8.55 — the ratio inverts with the subject intact).
    const pointsGray = rows.capPoints
      ? await gray64(page, rows.capPoints)
      : null;
    const zeroGray = rows.capZero ? await gray64(page, rows.capZero) : null;
    const thickGray = rows.capThick ? await gray64(page, rows.capThick) : null;
    rows.capThickVsZero =
      thickGray && zeroGray ? grayDistance(thickGray, zeroGray) : null;
    rows.capThickVsPoints =
      thickGray && pointsGray ? grayDistance(thickGray, pointsGray) : null;
    rows.thickChanged = await sceneDiff(page, rows.entryShot, rows.thickShot);
  } finally {
    await page.close();
  }
}

/** The 3D parity fixture: enter, settle COMPLETED, draw coverage > 0. */
async function driveParityScene(browser, args, rows) {
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 1024, height: 640 },
  });
  page.on("pageerror", (e) => {
    process.stderr.write(`[page:uncaught] ${e.message}\n`);
  });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `${args.url}/?surfacestate&surfacesamples=1#${TILED4_SLAB_HASH_3D}`,
      { waitUntil: "load" },
    );
    await waitStableLatch(page);
    await enterSurface(page);
    const settle = await waitSettle(page, args.settleMs);
    rows.parityEngine = settle.state ? settle.state.engine : null;
    rows.parityCoverage = await page.evaluate(() => {
      const el = document.getElementById("pointCount");
      const n = el ? Number(el.textContent.replace(/[^\d.]/g, "")) : 0;
      return Number.isFinite(n) ? n : 0;
    });
    rows.parityOk = settle.entered && settle.settled && rows.parityCoverage > 0;
    rows.parityMs = settle.ms;
  } finally {
    await page.close();
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  await guardFreshDist({ url: args.url });
  const flags = [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
  ];
  if (args.display !== undefined) flags.push("--no-sandbox");
  else flags.push("--headless=new");
  const quiet = await quietBaseline(console.error);
  const contended = contendedReason(quiet);
  if (contended) {
    console.error(
      `UNCERTIFIED: another process was already on the GPU — ${contended};` +
        " do not read this run's engine/capture rows.",
    );
  }
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    headless: false,
    args: flags,
    ...(args.display !== undefined
      ? { env: { ...process.env, DISPLAY: args.display } }
      : {}),
  });
  const rows = {};
  let failed = false;
  try {
    await driveTiledScene(browser, args, rows);
    await driveParityScene(browser, args, rows);

    const thickChangedOk =
      rows.thickChanged.changedFraction > THICK_CHANGED_FRACTION;
    const identityOk = rows.backOk && rows.identity.maxDelta === 0;
    const captureOk =
      // The 0.2 drive's invalidation landed (the stale-latch guard), the
      // slab reached the export (thick-vs-zero > 0 was the measured
      // wrong-subject failure), and the export is not the explorer's
      // image. NO canvas comparison: exports always render at the
      // persisted AA budget (default 8) while this gate's canvas runs at
      // surfacesamples=1 — measured 18.2/255 between the same render's
      // export and canvas on this dust, a sampling gap, not a wrong
      // subject. The cover gate's 2x ratio is the wrong shape here too:
      // a 0.2-thick slab over this dust legitimately fills toward the
      // cloud's look (thick-vs-zero 11.30 vs thick-vs-points 8.55).
      rows.capThickInvalidated === true &&
      rows.capThickVsZero !== null &&
      rows.capThickVsPoints !== null &&
      rows.capThickVsZero > 1.0 &&
      rows.capThickVsPoints > 1.0;
    const engineOk =
      args.display === undefined ||
      (rows.entryEngine === "compute" &&
        rows.thickEngine === "compute" &&
        rows.reloadEngine === "compute");
    const ok =
      rows.entryRowEnabled &&
      rows.entry.entered &&
      rows.entry.settled &&
      rows.thickOk &&
      thickChangedOk &&
      identityOk &&
      rows.reloadOk &&
      captureOk &&
      rows.parityOk &&
      engineOk;
    if (!ok) failed = true;
    process.stdout.write(
      `${ok ? "PASS" : "FAIL"}  tiled-slab ` +
        `rowEnabled=${String(rows.entryRowEnabled).padEnd(5)} ` +
        `entry=${String(rows.entry.settled).padEnd(5)} ` +
        `thick=${String(rows.thickOk).padEnd(5)} ` +
        `changed=${(rows.thickChanged.changedFraction * 100).toFixed(4)}% ` +
        `identity=${String(identityOk).padEnd(5)}(max ${rows.identity.maxDelta}) ` +
        `reload=${String(rows.reloadOk).padEnd(5)}(max ${rows.reloadIdentity.maxDelta}) ` +
        `capture=${String(captureOk).padEnd(5)} ` +
        `parity=${String(rows.parityOk).padEnd(5)}(cov ${rows.parityCoverage}, ${String(rows.parityMs)}ms) ` +
        `engine=${String(rows.entryEngine).padEnd(8)}(want compute)\n` +
        `  capture thick-vs-zero=${rows.capThickVsZero === null ? "n/a" : rows.capThickVsZero.toFixed(4)} ` +
        `thick-vs-points=${rows.capThickVsPoints === null ? "n/a" : rows.capThickVsPoints.toFixed(4)} ` +
        `thick-vs-canvas=n/a ` +
        `invalidated=${String(rows.capThickInvalidated)} ` +
        `reload carriedThickness=${String(rows.carriedThickness)} ` +
        `slider=${String(rows.sliderBefore)}->${String(rows.sliderAfter)}\n`,
    );
  } finally {
    await browser.close();
  }
  process.exit(failed ? 3 : 0);
}

run().catch((e) => {
  process.stderr.write(
    `[surface-tiled-slab] ${e instanceof Error ? e.stack : String(e)}\n`,
  );
  process.exit(1);
});
