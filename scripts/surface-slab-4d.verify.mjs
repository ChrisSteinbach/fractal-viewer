#!/usr/bin/env node
/**
 * The nonlinear 4D slab's browser gate: the RELOAD and CAPTURE rows of the
 * thickness matrix — the two things `surface-4d-lift.verify.mjs`'s thickness
 * phases deliberately do not reach (they are one live session by
 * construction).
 *
 *   npm run build && npm run preview &
 *   node scripts/surface-slab-4d.verify.mjs [--display=:0] [--url=…] [--tier=fast]
 *
 * ONE FIXTURE: the posed recursive spherefold pair with AUTHORED fold radii
 * and a map post under a pinned camera — the same document the lift gate's
 * `coverPosedAuthored4` scene drives (`scripts/lib/surface-cover-scene.mjs`),
 * RE-FRAMED here at camera radius 1.6. The lift gate's 2.6 leaves the object
 * sparse (MEASURED 151 covered rays at h = 0), fine for a settle/identity
 * check and too sparse for a downscaled capture comparison; 1.6 measures
 * 9005 covered rays at h = 0.2. The pose, authored radii and posts stay the
 * shared document's. Fold-4D is compute-only — there is no WebGL arm for a
 * nonlinear 4D slab, `surface-material-4d.ts` refuses the combination — so
 * the engine column is part of the claim, not a preference.
 *
 * WHAT IT ASKS.
 *
 *   1. RELOAD RESTORES THE POSE, THICKNESS INCLUDED. The slab half-thickness
 *      is a field of the persisted `FourDPose` (`four-d-view.ts`'s `pose()`),
 *      so the app's own share link carries it: the decoded link must read
 *      `fourD.sliceThickness === 0.2`, and a reload of that link must come
 *      back with the slider at 0.2, take compute, complete a settled thick
 *      view and reproduce the pre-reload canvas frame BYTE FOR BYTE in the
 *      SCENE REGION (the panel is painted over the canvas, and its rows are
 *      not part of the render). The reload is forced through a unique query
 *      key: a URL differing only in its FRAGMENT never reloads, and the app
 *      reads the scene hash exactly once at boot — without the key this gate
 *      would silently measure the live session twice.
 *      THIS CORRECTS THE NOTE THE THICKNESS WORK WAS PARKED WITH ("thickness
 *      is session view state and is NOT in the document; a reload keeps the
 *      scene/pose but not thickness"): MEASURED, the link carries 0.2 and the
 *      restored session's census covers 9005 rays against 151 at h = 0. A
 *      POSE-LESS document still resets thickness to 0 on 4D entry
 *      (`resetFourDView`) — the session-visible half of that note — but a
 *      shared scene's reload is the pose path, and the pose carries it.
 *
 *   2. CAPTURE CARRIES THE THICK RENDER. Three Save-PNGs, all through the
 *      same export pipeline (a canvas screenshot is NOT comparable to an
 *      export: the export enables depth of field after settle and never
 *      carries the panel — MEASURED 2.2-2.4/255 mean distance between the
 *      same render's export and its canvas): the explorer's capture, the
 *      h = 0 surface capture, and the h = 0.2 surface capture. The thick
 *      capture must differ from the h = 0 one (the slab reached the export)
 *      and must be closer to it than to the explorer's capture, by a factor
 *      of two — a wrong-subject export or a slab-less one fails both.
 *      MEASURED at radius 1.6: thick-vs-zero 0.105, thick-vs-explorer 0.515.
 *
 *   3. ENGINE AND PANEL, on every phase: the thickness row is ENABLED, every
 *      settle COMPLETES (the settle latch, not "pixels stopped moving"), and
 *      with `--display` every session took `engine === "compute"`; without
 *      one the engine column is reported rather than gated, exactly as the
 *      lift gate does it.
 *
 * NON-VACUITY, MEASURED. `FourDView.pose()` forced to report
 * `sliceThickness: 0` (the parked note's belief that thickness is
 * session-only), rebuilt, same gate: the reload row FAILS —
 * `carriedThickness=0`, the slider comes back at 0, and the scene-region
 * identity reads 1.9542% changed / max 145, i.e. the h = 0 frame. The
 * capture row's own non-vacuity is its first assertion: an export that
 * ignored the slab makes `thick-vs-zero` exactly 0 and fails, and a
 * wrong-subject export lands at `thick-vs-points` 0 instead.
 *
 * Exit 0 = every assertion held. Exit 1 = harness/setup failure. Exit 3 = a
 * real failure (the numbers are printed either way).
 *
 * THE FAST TIER (`--tier=fast`, scripts/lib/fast-tier.mjs,
 * docs/gate-velocity.md): the development loop renders the fixture under
 * the app's own `?surfacemaxrays` device-ceiling stand-in (the live pane
 * FITS under the cap and blits up to an unchanged 1024x640 canvas — the
 * page, the panel and the capture/export choreography stay exactly the
 * full tier's) and keeps this gate's own `surfacesamples=1` pin at both
 * tiers, so every assertion — reload pose/thickness, the scene-region byte
 * identity, the capture discrimination, engine, row availability — is
 * asked of fast frames compared against fast frames of the same build (the
 * three exports band under the same cap, all three alike). The identity
 * bar (`maxDelta === 0`) compares two same-tier renders, and the capture
 * comparisons are 64px-grayscale distances and a RATIO — tier-free by
 * construction; the settle latch is untouched. THE PILOT: one
 * full-resolution sample, the fixture's ENTRY phase re-run with no tier
 * params after the fast pass, asserting the same entry predicates its fast
 * pass asserted — the run's fast-vs-full correspondence
 * (scripts/lib/fast-tier.mjs), disclosed in the verdict line and FAILING
 * the run on a divergence. The gate's own full pass stays exactly as
 * recorded and remains the capture-row record; every verdict line carries
 * `tier=<label>`. The pilot is LIVE-ONLY (it records no frame-cache entry
 * — its full-tier entry phase is the correspondence anchor, not cached
 * evidence). MEASURED (AMD RX 7900 XTX, real driver --display=:0,
 * 2026-10-02): full 12.1s -> fast 14.0s — a small LOSS on this box (the
 * full pass is already cheap here and the pilot's anchor costs ~2s); the
 * fast tier is for the settle/export-dominated machines the 300s budgets
 * were sized against, and it does not pretend to win everywhere. The
 * measured discrimination numbers are byte-identical across tiers
 * (0.1046/0.5093 — the 64px downscale erases the raster difference), both
 * tiers' reload identities read maxDelta 0, and the pilot agreed.
 *
 * THE FRAME CACHE (wired 2026-10-03, scripts/lib/frame-cache-gate.mjs,
 * docs/gate-velocity.md): the REPRO SHAPE the unwired-list note projected.
 * Two products per run, one settle collapsed. (1) The THICK FRAME — the
 * completed h=0.2 cover settle's canvas shot — is memoized under the exact
 * key (bundle, the gate's re-framed fixture hash as the document, the
 * driven thickness as the pose, samples + tier params in env, device,
 * engine). (2) The THICK EXPORT — the h=0.2 Save-PNG — is memoized under
 * the same key but a `save-png` raster product, because a cached canvas
 * frame alone cannot skip the settle: the Save-PNG's awaitReady would wait
 * the settle it skipped right back. On a hit the DRIVE machinery stays
 * live in both paths (the drive itself, the invalidation poll, the
 * share-link copy, the real reload, the slider reads, boot mode) and the
 * identity becomes FRESH-reload-vs-RECORDED-thick — one side fresh, per
 * the self-consistency rule — which is also what collapses the two h=0.2
 * settles to one: the live thick settle is skipped, the reload settle
 * runs. The capture row's discrimination recomputes from the (different
 * key) bytes; capZero and the explorer's capPoints stay live — they are
 * the row's live anchors and cheap at h=0. A hit-path identity failure is
 * a FAIL naming the cached side (`--force` re-records); the compute
 * renderer is bit-reproducible once settled, so a fresh-vs-recorded
 * disagreement under an exact key is a real defect or a poisoned entry,
 * both worth the red line. The frame is recorded only from a completed
 * settle whose engine matches the key's. `--force` never looks up; a
 * store error degrades the run to uncached and is noted once, never
 * fatal. MEASURED (AMD RX 7900 XTX, real driver --display=:0, 2026-10-03,
 * machine-quiet): full 12.5s cold -> 11.3s warm (both hits, identity max 0
 * against the recorded frame); fast 14.3s cold -> 12.7s warm (its own
 * entries — the tier params in env separate them; the pilot agreed both
 * runs); --force re-records under the same key hashes. The capture row's
 * discrimination read 0.1046/0.5093 on every run, live and replayed
 * alike. The settle collapse pays on the Iris-class machines the 300s
 * budgets were sized against (~60 s/sample cover settles), where the hit
 * skips the run's dominant term.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import {
  parseTierArg,
  tierCorrespondence,
  tierLabel,
  tierUrlParams,
} from "./lib/fast-tier.mjs";
import {
  createFrameCache,
  gateKeyFields,
  readDeviceSignature,
} from "./lib/frame-cache-gate.mjs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";
import { COVER4_POSED_HASH } from "./lib/surface-cover-scene.mjs";

const DEFAULT_SETTLE_MS = 300000;
const DEFAULT_CAPTURE_MS = 300000;
/** The framing this gate's capture comparisons run at — see the header. */
const GATE_CAMERA_RADIUS = 1.6;
/** The thick capture must beat the explorer's by this factor. */
const CAPTURE_DISCRIMINATION = 2;

function parseArgs(argv) {
  const out = {
    url: "https://localhost:4173",
    display: undefined,
    settleMs: DEFAULT_SETTLE_MS,
    captureMs: DEFAULT_CAPTURE_MS,
    tier: parseTierArg(argv),
    force: false,
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "url" && value) out.url = value.replace(/\/+$/, "");
    else if (key === "display") out.display = value ?? ":0";
    else if (key === "settle" && value) out.settleMs = Number(value);
    else if (key === "capture" && value) out.captureMs = Number(value);
    else if (key === "force")
      out.force = value === undefined || value !== "false";
  }
  return out;
}

/** The shared fixture, re-framed at this gate's camera radius. */
function gateSceneHash() {
  const raw = COVER4_POSED_HASH.slice("v1=".length)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const payload = JSON.parse(
    Buffer.from(
      raw + "=".repeat((4 - (raw.length % 4)) % 4),
      "base64",
    ).toString("utf8"),
  );
  payload.camera = { ...payload.camera, radius: GATE_CAMERA_RADIUS };
  return (
    "v1=" +
    Buffer.from(JSON.stringify(payload))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  );
}

/** The decoded `#v1=` payload of a link or hash, as plain JSON. */
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
 * own left edge, derived from the live DOM (the panel is painted OVER the
 * canvas, so an element screenshot carries it and it moves for reasons that
 * are not the render). 4px of margin for a shadow. */
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

/** 64x64 grayscale of a PNG's SCENE REGION, decoded in the page — there is
 * no image library on the Node side, and the browser is already here. */
async function gray64(page, png) {
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
      return { width, gray };
    },
    { b64: png.toString("base64"), cropSource: SCENE_CROP_FN },
  );
}

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

async function enterSurface(page) {
  const mode = await page.evaluate(
    () => window.__surfaceState?.().mode ?? null,
  );
  if (mode !== "surface") await page.click("#modeSurfaceBtn");
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const fast = args.tier === "fast";
  // The fast tier's raster rides the app's own `?surfacemaxrays` device
  // ceiling stand-in (scripts/lib/fast-tier.mjs): the live pane FITS under
  // the cap and blits up to an UNCHANGED 1024x640 canvas — the page, the
  // panel and the capture/export choreography stay exactly the full
  // tier's. The samples pin stays the gate's own (surfacesamples=1) at
  // both tiers; the cap also bands the three exports, all three alike.
  await guardFreshDist({ url: args.url });
  const sceneHash = gateSceneHash();
  // The frame cache (docs/gate-velocity.md): declared beside the browser so
  // the run's finally can prune; one bundle hash and one device-signature
  // memo per run. The device probe asks the BROWSER from the session page
  // (the app's origin — a secure context — after its first goto).
  const cache = createFrameCache({
    gate: "surface-slab-4d",
    force: args.force,
    log: (line) => console.error(line),
  });
  const bundleHash = await cache.bundleHash(
    path.resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "..",
      "dist",
      "app",
    ),
  );
  const flags = [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
  ];
  if (args.display !== undefined) flags.push("--no-sandbox");
  else flags.push("--headless=new");
  // The machine's conditions before this gate puts its own browser on the
  // GPU — the engine column and the capture rows are measurements.
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
  let failed = false;
  const tierQueryString = Object.entries(tierUrlParams(args.tier))
    .map(([k, v]) => `&${k}=${v}`)
    .join("");
  process.stdout.write(
    `tier=${tierLabel(args.tier)} samples=1` +
      (fast ? ` maxrays=${tierUrlParams("fast").surfacemaxrays}` : "") +
      "\n",
  );
  try {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 1024, height: 640 },
    });
    page.on("pageerror", (e) => {
      process.stderr.write(`[page:uncaught] ${e.message}\n`);
    });
    // Reduced motion parks the 4D tumble (and the camera glides) for the
    // whole run: the document's own pose is then the only thing that moves
    // the view, which is what makes the reload identity a claim about the
    // POSE rather than about two different moments of a tumble.
    await page.emulateMedia({ reducedMotion: "reduce" });
    // The app's own Copy-link handler, captured without host clipboard
    // permissions. Installed per document so the reload gets it too.
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
      `${args.url}/?surfacestate&surfacesamples=1${tierQueryString}#${sceneHash}`,
      { waitUntil: "load" },
    );
    await waitLatch(page);
    // The key's device field asks the BROWSER which adapter it renders
    // with — probed once per engine, memoized for the run.
    const deviceSigs = new Map();
    const deviceFor = async (wanted) => {
      if (!deviceSigs.has(wanted)) {
        deviceSigs.set(wanted, await readDeviceSignature(page, wanted));
      }
      return deviceSigs.get(wanted);
    };
    // The thick products' key, built in ONE construction used by lookup and
    // record both: the gate's re-framed fixture hash as the document (the
    // page booted it; the drive persists the thickness into the session's
    // fourD pose — the share-link payload is the proof — so the driven
    // thickness rides the pose field), samples and tier params in env (the
    // env-key rule), and the product (settled canvas vs its Save-PNG
    // export, whose DoF comes from the capture pipeline, not the document)
    // in raster.
    const envFor = {
      surfacestate: "1",
      surfacesamples: "1",
      ...tierUrlParams(args.tier),
    };
    const keyFieldsFor = async (pose, raster) =>
      cache.disabled || bundleHash === null
        ? null
        : gateKeyFields({
            bundle: bundleHash,
            document: sceneHash,
            pose,
            engine: "compute",
            viewport: { width: 1024, height: 640, scale: 1 },
            device: await deviceFor("compute"),
            env: envFor,
            raster,
          });
    // The explorer's own capture, same export pipeline, same camera — the
    // wrong-subject reference.
    const capPoints = await savePng(page, args.captureMs);
    await page.waitForTimeout(2500);

    await enterSurface(page);
    const entry = await waitSettle(page, args.settleMs);
    const entryEngine = entry.state ? entry.state.engine : null;
    const rowEnabled = await page.evaluate(() => {
      const el = document.getElementById("fourDSliceThicknessSlider");
      return el instanceof HTMLInputElement && !el.disabled;
    });
    const capZero = await savePng(page, args.captureMs);
    await page.waitForTimeout(2500);

    const drove = await driveThickness(page, 0.2);
    const invalidated = await waitInvalidation(page);
    // THE FRAME CACHE, the repro shape: the thick canvas frame's lookup
    // runs before the settle it stands in for; on a hit the h=0.2 settle
    // is SKIPPED (this collapse is the wiring's whole point) and the
    // recorded frame answers DRAW and the identity's recorded side. The
    // drive's own observations (landed, invalidated) stay live in both
    // paths, and the reload settle below stays live — the fresh side of
    // the fresh-vs-recorded identity compare.
    const thickFields = await keyFieldsFor(
      { sliceThickness: 0.2 },
      { product: "canvas", dof: false },
    );
    const thickHit =
      drove && invalidated && thickFields
        ? await cache.lookup(thickFields, "thick@0.2")
        : null;
    let thickShot = null;
    let thickSettled = false;
    let thickEngine = null;
    let thickCached = false;
    if (thickHit) {
      thickCached = true;
      thickShot = thickHit.png;
      thickSettled = true;
      thickEngine =
        (thickHit.entry.verdict && thickHit.entry.verdict.engine) || null;
      console.error(
        `[frame-cache] thick@0.2: settle skipped — frame recorded ` +
          `${new Date(thickHit.entry.meta.createdAtMs).toISOString()}`,
      );
    } else {
      const thick = await waitSettle(page, args.settleMs);
      thickSettled = thick.settled;
      thickEngine = thick.state ? thick.state.engine : null;
      if (thickSettled) thickShot = await canvasShot(page);
      // Recorded only from a completed settle whose engine matches the
      // key's (fold-4D is compute-only, so anything else is a session
      // the run's own engine column already fails).
      if (
        thickSettled &&
        thickShot &&
        thickFields &&
        thickEngine === "compute"
      ) {
        await cache.record(thickFields, {
          scenario: "thick@0.2",
          png: thickShot,
          verdict: { engine: thickEngine },
          wallMs: thick.ms,
        });
      }
    }
    // The THICK EXPORT is memoized too, under the same document/pose but a
    // save-png raster product: on a thick-frame hit a LIVE Save-PNG would
    // wait the skipped settle right back through the app's own awaitReady,
    // so the settle collapse only pays if this save replays as well. The
    // cached-path miss still saves live (the app's awaitReady completes
    // the settle inside the save) and records, so the store fills over a
    // run or two of --force-free reruns.
    const capThickScale = await page.evaluate(() =>
      Number(document.getElementById("exportScale")?.value),
    );
    const capThickFields = await keyFieldsFor(
      { sliceThickness: 0.2 },
      { product: "save-png", dof: true, exportScale: capThickScale },
    );
    const capThickHit = capThickFields
      ? await cache.lookup(capThickFields, "thick@0.2 export")
      : null;
    let capThick = null;
    let capThickCached = false;
    if (capThickHit) {
      capThickCached = true;
      capThick = capThickHit.png;
      console.error(
        `[frame-cache] thick@0.2 export: Save-PNG skipped — recorded ` +
          `${new Date(capThickHit.entry.meta.createdAtMs).toISOString()}`,
      );
    } else if (drove && invalidated) {
      capThick = await savePng(page, args.captureMs);
      if (capThick && capThickFields) {
        // The put gate is the save's own contract, not this gate's wait:
        // Save-PNG's awaitReady completed (the bytes exist), and the
        // session's engine — read after the save — matches the key's.
        const settledState = await page.evaluate(
          () => window.__surfaceState?.() ?? null,
        );
        if (settledState && settledState.engine === "compute") {
          await cache.record(capThickFields, {
            scenario: "thick@0.2 export",
            png: capThick,
            verdict: { engine: settledState.engine },
            notes: thickCached
              ? "canvas frame was cached; settle completed inside the save"
              : undefined,
          });
        }
      }
    }

    // ── The share link, then a REAL reload ─────────────────────────────
    await page.evaluate(() => {
      delete window.__shareLink;
      document.getElementById("copyLinkBtn").click();
    });
    await page.waitForFunction(
      () => typeof window.__shareLink === "string",
      null,
      { timeout: 30000 },
    );
    const shareLink = await page.evaluate(() => window.__shareLink);
    const payload = decodePayload(shareLink);
    const carriedThickness =
      payload && payload.fourD ? payload.fourD.sliceThickness : null;
    // The unique query key is what forces a reload at all: with only the
    // fragment changed, `page.goto` is a same-document navigation and the
    // app never re-reads the scene (the lift gate's own unique-query rule).
    const reloadUrl = shareLink.replace(
      /#/,
      `?surfacestate&surfacesamples=1${tierQueryString}&slabreload=1#`,
    );
    await page.goto(reloadUrl, { waitUntil: "load" });
    await waitLatch(page);
    const reloadMode = await page.evaluate(
      () => window.__surfaceState?.().mode ?? null,
    );
    const sliderBefore = await page.evaluate(() => {
      const el = document.getElementById("fourDSliceThicknessSlider");
      return el instanceof HTMLInputElement ? el.value : null;
    });
    await enterSurface(page);
    const reload = await waitSettle(page, args.settleMs);
    const reloadEngine = reload.state ? reload.state.engine : null;
    const sliderAfter = await page.evaluate(() => {
      const el = document.getElementById("fourDSliceThicknessSlider");
      return el instanceof HTMLInputElement ? el.value : null;
    });
    const reloadShot = await canvasShot(page);

    // ── The measurements the verdict is stated in ──────────────────────
    const capPointsGray = capPoints ? await gray64(page, capPoints) : null;
    const capZeroGray = capZero ? await gray64(page, capZero) : null;
    const capThickGray = capThick ? await gray64(page, capThick) : null;
    const capThickVsZero =
      capThickGray && capZeroGray
        ? grayDistance(capThickGray.gray, capZeroGray.gray)
        : null;
    const capThickVsPoints =
      capThickGray && capPointsGray
        ? grayDistance(capThickGray.gray, capPointsGray.gray)
        : null;
    const identity = await sceneDiff(page, thickShot, reloadShot);

    const entryOk = entry.entered && entry.settled;
    const thickOk = drove && invalidated && thickSettled;
    const captureOk =
      capThickVsZero !== null &&
      capThickVsPoints !== null &&
      capThickVsZero > 0 &&
      capThickVsZero * CAPTURE_DISCRIMINATION < capThickVsPoints;
    const reloadOk =
      carriedThickness === 0.2 &&
      reloadMode !== "surface" &&
      sliderBefore === "0.2" &&
      sliderAfter === "0.2" &&
      reload.entered &&
      reload.settled &&
      identity.maxDelta === 0;
    const engineOk =
      args.display === undefined ||
      (entryEngine === "compute" &&
        thickEngine === "compute" &&
        reloadEngine === "compute");
    const ok =
      rowEnabled && entryOk && thickOk && captureOk && reloadOk && engineOk;
    if (!ok) failed = true;
    // The fast tier's pilot compare needs the entry predicates its
    // full-resolution counterpart will re-assert below.
    const entryPredicates = {
      entered: entry.entered,
      settled: entry.settled,
      engineCompute: args.display === undefined || entryEngine === "compute",
    };
    process.stdout.write(
      `${ok ? "PASS" : "FAIL"}  slab4d ` +
        `tier=${tierLabel(args.tier)} ` +
        `entry=${String(entryOk).padEnd(5)} thick=${String(thickOk).padEnd(5)} ` +
        `capture=${String(captureOk).padEnd(5)} reload=${String(reloadOk).padEnd(5)} ` +
        `rowEnabled=${String(rowEnabled).padEnd(5)} ` +
        `engine=${String(entryEngine).padEnd(8)}(want compute) ` +
        `reloadEngine=${String(reloadEngine).padEnd(8)}\n` +
        `  capture ${capThickGray ? `${capThickGray.width}px scene crop` : "n/a"} ` +
        `thick-vs-zero=${capThickVsZero === null ? "n/a" : capThickVsZero.toFixed(4)} ` +
        `thick-vs-points=${capThickVsPoints === null ? "n/a" : capThickVsPoints.toFixed(4)}\n` +
        `  reload carriedThickness=${String(carriedThickness)} ` +
        `modeAfterReload=${String(reloadMode)} ` +
        `slider=${String(sliderBefore)}->${String(sliderAfter)} ` +
        `identity=changed ${(identity.changedFraction * 100).toFixed(4)}% max ${identity.maxDelta} ` +
        `(crop ${identity.width}px) settle=${String(reload.settled)} ` +
        `thickFrame=${thickCached ? "CACHED" : "live"} ` +
        `thickExport=${capThickCached ? "CACHED" : "live"}` +
        // On a cached thick side an identity failure is a fresh-vs-recorded
        // collision under an exact key — a real defect or a poisoned entry;
        // the marker tells the operator which --force re-records.
        (thickCached && identity.maxDelta !== 0
          ? " <-- collision suspect"
          : "") +
        "\n",
    );

    // THE PILOT (fast runs only): one full-resolution sample — the
    // fixture's ENTRY phase at the full viewport, this gate's own
    // surfacesamples=1 convention at both tiers — asserting the same entry
    // predicates its fast pass asserted. The run's fast-vs-full
    // correspondence (scripts/lib/fast-tier.mjs): a divergence fails the
    // run with the predicates named. A full run has no pilot — the whole
    // run is the anchor.
    if (fast) {
      const pilotPage = await browser.newPage({
        ignoreHTTPSErrors: true,
        viewport: { width: 1024, height: 640 },
      });
      await pilotPage.emulateMedia({ reducedMotion: "reduce" });
      pilotPage.on("pageerror", (e) => {
        process.stderr.write(`[page:uncaught] ${e.message}\n`);
      });
      try {
        await pilotPage.goto(
          `${args.url}/?surfacestate&surfacesamples=1#${sceneHash}`,
          { waitUntil: "load" },
        );
        await waitLatch(pilotPage);
        await enterSurface(pilotPage);
        const pilot = await waitSettle(pilotPage, args.settleMs);
        const pilotEngine = pilot.state ? pilot.state.engine : null;
        const pilotPredicates = {
          entered: pilot.entered,
          settled: pilot.settled,
          engineCompute:
            args.display === undefined || pilotEngine === "compute",
        };
        const corr = tierCorrespondence(entryPredicates, pilotPredicates);
        const pilotOk = pilot.settled && pilotEngine !== null && corr.agree;
        if (!pilotOk) failed = true;
        process.stdout.write(
          `${pilotOk ? "PASS" : "FAIL"}  pilot:entry ` +
            `tier=fast vs tier=full ` +
            `${corr.agree ? "agree" : `DIVERGED ${corr.diverged.join(",")}`} ` +
            `settled=${String(pilot.settled).padEnd(5)} ` +
            `engine=${String(pilotEngine).padEnd(8)}(want compute)\n`,
        );
      } finally {
        await pilotPage.close().catch(() => {});
      }
    }
  } finally {
    await cache.prune();
    await browser.close();
  }
  process.exit(failed ? 3 : 0);
}

run().catch((e) => {
  process.stderr.write(
    `[surface-slab-4d] ${e instanceof Error ? e.stack : String(e)}\n`,
  );
  process.exit(1);
});
