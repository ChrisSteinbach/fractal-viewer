#!/usr/bin/env node
/**
 * The transmission lane's real-app invalidation/drain sweep — the renderer
 * envelope's criterion that no bench leg reaches: a transmission-LIVE surface
 * session in the BUILT app, driven through every invalidation and teardown
 * path a real user (or a dying GPU) can reach, asserting the transport
 * state's machinery survives each one.
 *
 *   npm run build && npm run preview &
 *   node scripts/surface-transport-invalidation.verify.mjs --display=:0
 *   node scripts/surface-transport-invalidation.verify.mjs --display=:0 --lane=webgl
 *   node scripts/surface-transport-invalidation.verify.mjs --display=:0 --scene=finite
 *   node scripts/surface-transport-invalidation.verify.mjs --display=:0 --scene=finite \
 *     --arm=edits-4d --video-out=scripts/out/finite-motion
 *
 * FINITE FRACTAL SCOPE: --scene=finite consumes the exact app-authored
 * documents in bench-results/finite-glass-report.json from the SAME build
 * (--finite-report=path overrides). It retains the existing lifecycle arms,
 * exercises a native 4D rotor drag and a slice edit, and adds forced-WebGL
 * refusal and one-step Floor Undo/Redo in both dimensions. The full finite
 * sweep has 14 lifecycle arms plus two completion premises. Every completed finite settle must account
 * for every glass hit with zero unresolved/invalid paths. This is a one-AA-
 * sample lifecycle run, not the appearance or performance-envelope gate.
 * Device loss must exit the finite session rather than substitute geometry.
 * JSON evidence lands in scripts/out/surface-transport-invalidation.json.
 * Optional --video-out=DIR records only the finite camera/rotor/slice edit
 * pages, from boot and their first frame through the existing two edits and
 * completed replacement frames. Named WebM files and event offsets are linked
 * in the JSON. These are actual browser recordings; no synthetic animation,
 * extra aesthetic waits or altered images. Recording adds overhead, so this
 * evidence cannot certify the performance envelope.
 *
 * DEFAULT SCOPE: the shared OPTICS_SCENES are closed-solid emitter unions
 * in 3D and 4D. Both compute and hardware GLSL can render these fixtures.
 * Their census asserts the transport lane is live; the finite scope above
 * additionally requires complete optical work. A software adapter or absent
 * lane is a checking failure, never an optical pass. The WebGL lane omits
 * GPU-process loss because that kills the page's GL context as well, and
 * the app does not implement WebGL context restoration.
 *
 * THE ARMS (each a fresh page against the built app, entered FROM THE UI):
 *
 *   settle+reload     the transmission-live session settles (the
 *                     `?surfacestate` latch, not "pixels stopped changing"),
 *                     draws, runs the transport lane; then a real RELOAD
 *                     reproduces the settled frame BYTE FOR BYTE — restart
 *                     re-seeds the transport state, and a replay-pass lane
 *                     that retained anything across sessions would show it.
 *   mid-trace edits   camera drags (3D) / slice-toggle + slice-position
 *                     edits (4D) fired while `previewActive || settleActive`,
 *                     twice per page: each edit must OBSERVABLY invalidate
 *                     (`settled` goes false), the following settle completes,
 *                     and the transport lane runs again. The frame token
 *                     discard this exercises is what stops old-camera
 *                     transport work from landing after an edit.
 *   mode exit         Points clicked while the settle is in flight; the
 *                     session exits (RenderSession.terminate — the same
 *                     teardown the Floor checkbox reaches), re-enters, and
 *                     settles again with the lane live.
 *   restart storm     the Floor checkbox toggled 6x mid-settle (the
 *                     teardown gate's arm on a transmission session): every
 *                     toggle lands against a renderer with transport
 *                     buffers allocated and dispatches possibly queued.
 *   undo/redo         finite scenes only: one trusted Floor edit, one Undo,
 *                     one Redo. Each exact authored value comes from #v1=;
 *                     each phase must complete fresh optical work. History
 *                     restoration exits to Points, followed by UI re-entry.
 *   device failure    the browser's GPU process is SIGKILLed mid-settle —
 *                     a REAL `device.lost`, not a stub. Asserts the page
 *                     survives, the renderer's lost path fires ("Surface
 *                     compute device lost"), and no uncaught error lands.
 *                     The WebGL fallback's CANVAS liveness after a GPU
 *                     process death is deliberately NOT asserted: the main
 *                     GL context is lost with the same process and the app
 *                     does not handle WebGL context restoration — that is
 *                     the explorer's concern, outside this criterion.
 *
 * EXIT CODES: 0 = every arm passed. 3 = an arm FAILED (printed per arm).
 * 2 = INCONCLUSIVE: the transport lane never went live (no compute engine,
 * a software adapter, or no `transport pass=` trace lines) — rerun on the
 * real driver. 1 = harness failure (launch/apparatus problem).
 *
 * The fixtures are `persist.ts`'s OWN encoder output (a throwaway vitest
 * importing `encodeScene`/`toSnapshot`/`initialState` — the 4D lift gate's
 * precedent, after hand-built JSON failed to survive the strict decoder).
 * A silently mis-decoded document still fails LOUD: no optics means no
 * transport lane, and every arm asserts the lane.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";
import { OPTICS_SCENES } from "./lib/optics-fixtures.mjs";
import { completionFailures, traceFrames } from "./lib/finite-glass-trace.mjs";

const NON_BACKDROP_TOL = 10;

function parseArgs(argv) {
  const out = {
    url: "https://localhost:4173",
    display: undefined,
    settleMs: 240000,
    arm: null,
    lane: "compute",
    scene: "closedSolid",
    finiteReport: "bench-results/finite-glass-report.json",
    out: "scripts/out/surface-transport-invalidation.json",
    videoOut: null,
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "url" && value) out.url = value.replace(/\/+$/, "");
    else if (key === "display") out.display = value ?? ":0";
    else if (key === "settle" && value) out.settleMs = Number(value);
    else if (key === "arm" && value) out.arm = value;
    else if (key === "lane" && value) out.lane = value;
    else if (key === "scene" && value) out.scene = value;
    else if (key === "finite-report" && value) out.finiteReport = value;
    else if (key === "out" && value) out.out = value;
    else if (key === "video-out" && value) out.videoOut = value;
  }
  if (!["compute", "webgl"].includes(out.lane)) {
    throw new Error(`--lane must be compute or webgl (got ${out.lane})`);
  }
  if (!["closedSolid", "finite"].includes(out.scene))
    throw new Error("--scene must be closedSolid or finite");
  if (out.scene === "finite" && out.lane !== "compute")
    throw new Error(
      "finite scenes are compute-only; forced-WebGL refusal is included in their compute sweep",
    );
  if (out.videoOut && out.scene !== "finite")
    throw new Error("--video-out is available for --scene=finite");
  return out;
}

let SCENES = OPTICS_SCENES;
const pageTraces = new WeakMap();
const pageEvidence = [];

function finiteScenes(reportPath, freshDist) {
  const evidence = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (freshDist.checked && evidence.freshDist?.builtMs !== freshDist.builtMs) {
    throw new Error(
      "finite preset report belongs to another build; rerun finite-glass.verify.mjs",
    );
  }
  return Object.fromEntries(
    [3, 4].map((dim) => {
      const leg = evidence.legs?.find((row) => row.label === `menger${dim}`);
      const document = leg?.document;
      if (
        !leg?.hash ||
        document?.finiteSolid?.shape !==
          (dim === 3 ? "menger" : "hyperMenger") ||
        document.finiteSolid.level !== 2 ||
        document.transforms.length !== (dim === 3 ? 20 : 48) ||
        !document.transforms.every(
          (map) => map.optics?.model === "dielectric",
        ) ||
        (dim === 4 && !document.fourD?.sliceOn)
      ) {
        throw new Error(
          `finite preset report lacks the app-authored ${dim}D glass document`,
        );
      }
      return [
        dim,
        {
          name: `finiteMenger${dim}`,
          finite: true,
          hash: `v1=${leg.hash}`,
          computeQuery: "surfacestate&surfacetrace&surfacesamples=1",
          webglQuery: "surfacestate&surfacetrace&surfacegl",
        },
      ];
    }),
  );
}

const log = (...a) => console.log("[surface-transport-sweep]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every live Chrome GPU-process pid that belongs to THIS harness — the
 * ppid chain reaches this node process. The desktop's own browser runs a
 * gpu-process too, and playwright-core 1.63's runtime Browser object
 * exposes no process handle, so ancestry is the only unambiguous answer. */
function gpuProcessPids() {
  const mine = new Set([process.pid]);
  const parents = new Map();
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${entry}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      parents.set(Number(entry), ppid);
    } catch {
      /* raced exit */
    }
  }
  for (const [pid, ppid] of parents) {
    let cursor = pid;
    while (cursor > 1) {
      if (mine.has(cursor)) {
        if (isGpuProcess(pid)) return [pid];
        break;
      }
      cursor = parents.get(cursor) ?? 0;
    }
  }
  return [];
}

function isGpuProcess(pid) {
  try {
    return fs
      .readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .includes("--type=gpu-process");
  } catch {
    return false;
  }
}

async function launch(args) {
  const flags = [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
  ];
  if (args.display !== undefined) flags.push("--no-sandbox");
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    headless: false,
    args: flags,
    ...(args.display !== undefined
      ? { env: { ...process.env, DISPLAY: args.display } }
      : {}),
  });
  return browser;
}

async function newPage(browser, args, scene, armTag) {
  const recording = Boolean(
    args.videoOut && scene.finite && /^edits-[34]d$/.test(armTag),
  );
  if (recording) fs.mkdirSync(args.videoOut, { recursive: true });
  const recordingStartedMs = Date.now();
  const viewport = { width: 1024, height: 640 };
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport,
    ...(recording
      ? { recordVideo: { dir: args.videoOut, size: viewport } }
      : {}),
  });
  // Reduced motion parks the camera glides (and the 4D tumble) for the whole
  // run — the document's pinned pose is then the only thing that moves the
  // view. A glide is rAF-sampled, so without this its settled endpoint's
  // last bits differ per boot and grazing pixels flip hit/miss (~0.1% of
  // the frame, measured), which would eat the reload identity claim. The
  // slab gate's reload identity rides the same emulation.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const consoleLines = [];
  const pageErrors = [];
  const record = {
    arm: armTag,
    scene: scene.name,
    hash: scene.hash,
    documents: [],
    consoleLines,
    pageErrors,
    ...(recording
      ? {
          video: {
            kind: "playwright-browser-video",
            path: path.join(args.videoOut, `${scene.name}-${armTag}.webm`),
            viewport,
            startedAt: new Date(recordingStartedMs).toISOString(),
            startedMs: recordingStartedMs,
            saved: false,
            events: [],
            timingQualification:
              "recording overhead; no performance certification",
          },
        }
      : {}),
  };
  pageEvidence.push(record);
  // Hash autosaves are same-document navigations during edits. Only a real
  // document boot resets the capture; otherwise an edit would erase the
  // current frame's start and make its later completion unidentifiable.
  page.on("domcontentloaded", () => {
    const trace = [];
    pageTraces.set(page, trace);
    record.documents.push({ url: page.url(), trace });
  });
  page.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("[surfacetrace] "))
      pageTraces.get(page)?.push(t.slice("[surfacetrace] ".length));
    if (/surface|webgpu|webgl|transport|device|shader|adapter|error/i.test(t)) {
      consoleLines.push(`[${m.type()}] ${t}`);
    }
  });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("crash", () => consoleLines.push("[page] CRASHED"));
  page.on("close", () => {
    for (const document of record.documents)
      document.frames = traceFrames(document.trace);
  });
  // A unique query per arm: navigating to a URL that differs only in its
  // fragment does not reload, and the app reads the scene hash exactly once.
  const url = `${args.url}/?${laneQuery(scene, args.lane)}&scene=${armTag}#${scene.hash}`;
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  // Mutter only sends frame callbacks to VISIBLE surfaces — the settle latch
  // is present-gated (the 4D lift gate's measured occlusion stall). Keep the
  // window on top before anything waits on it.
  await page.bringToFront();
  await page.waitForFunction(
    () => typeof window.__surfaceState === "function",
    { timeout: 30000 },
  );
  return { page, consoleLines, pageErrors, record };
}

function videoEvent(record, event, details = {}) {
  if (record.video)
    record.video.events.push({
      event,
      elapsedMs: Date.now() - record.video.startedMs,
      ...details,
    });
}

/** The page has closed, so Playwright can finalize this arm's bounded clip. */
async function saveVideo(page, record, reportPath) {
  if (!record.video) return;
  const video = page.video();
  if (!video) throw new Error("the requested browser recording is absent");
  const target = path.resolve(record.video.path);
  await video.saveAs(target);
  const bytes = fs.statSync(target).size;
  if (bytes === 0) throw new Error("the browser recording is empty");
  record.video.bytes = bytes;
  record.video.relativeToReport = path.relative(
    path.dirname(path.resolve(reportPath)),
    target,
  );
  record.video.finishedAt = new Date().toISOString();
  record.video.observedDurationMs = Date.now() - record.video.startedMs;
  record.video.saved = true;
  // saveAs keeps the original generated filename too. Only that recording's
  // own temporary file is removed; the named review artifact is retained.
  await video.delete().catch(() => {});
}

const probe = (page) => page.evaluate(() => window.__surfaceState?.() ?? null);

const documentFromPage = async (page) =>
  JSON.parse(
    Buffer.from(
      (await page.evaluate(() => location.hash)).slice(4),
      "base64url",
    ).toString(),
  );

/** Camera/rotor/slice gestures update live framing without arming scene
 * autosave. Copy Link is the app's authority for that live document; the
 * address-bar hash is retained separately as persistence evidence. */
async function liveDocumentFromPage(page) {
  const evidence = await page.evaluate(async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    let copiedLink = null;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            copiedLink = text;
          },
        },
      });
      const button = document.getElementById("copyLinkBtn");
      if (!(button instanceof HTMLButtonElement) || button.disabled)
        throw new Error("the app's Copy Link action is unavailable");
      button.click();
      const deadline = performance.now() + 2000;
      while (copiedLink === null && performance.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      if (copiedLink === null)
        throw new Error("Copy Link did not provide a live document");
      return { copiedLink, locationHash: location.hash };
    } finally {
      if (previous) Object.defineProperty(navigator, "clipboard", previous);
      else delete navigator.clipboard;
    }
  });
  const hash = new URL(evidence.copiedLink).hash;
  if (!hash.startsWith("#v1="))
    throw new Error("Copy Link did not encode the expected scene document");
  return {
    ...evidence,
    document: JSON.parse(Buffer.from(hash.slice(4), "base64url").toString()),
  };
}

const framesSince = (page, offset = 0) =>
  traceFrames((pageTraces.get(page) ?? []).slice(offset));

const transportLines = (page) =>
  page.evaluate(() => {
    const log = window.__surfaceTraceLog;
    if (!Array.isArray(log)) return 0;
    return log.filter((l) => l.includes("transport pass=")).length;
  });

/** The engine route's URL query. The compute lane keeps the sweep's original
 * queries (`?surfacecompute` forcing 3D past the plain-affine WebGL verdict,
 * `?surfacetrace` feeding the premise's `transport pass=` census); the WebGL
 * lane forces the fragment tracer instead — a compute-only `?surfacetrace`
 * is inert there, so it is dropped. */
const laneQuery = (scene, lane) =>
  lane === "webgl" ? scene.webglQuery : scene.computeQuery;

/** The WebGL lane's lane-live observable: the ABSOLUTE near-black fraction
 * of the settled frame (all channels < 10, the 128-wide downsample the
 * coverage probe uses). On IFS geometry the estimator backend's every
 * inside path refuses and unresolved samples paint black — the disclosed
 * vacuous state — so a lane that ran shows the object's ray coverage as
 * near-black, while a classic frame (the lane stripped) renders the object
 * in palette colours and reads ~0. The fixtures' gradient backdrop keeps
 * every backdrop model (corner or row) above the threshold. */
async function blackFraction(page) {
  const shot = await canvasShot(page);
  if (!shot) return null;
  return page.evaluate(
    async ({ bytes }) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      const w = 128;
      const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w));
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      let black = 0;
      for (let i = 0; i < w * h; i++) {
        const p = i * 4;
        if (data[p] < 10 && data[p + 1] < 10 && data[p + 2] < 10) black++;
      }
      return black / (w * h);
    },
    { bytes: Array.from(shot) },
  );
}

/** The lane's live census, read wherever an arm asserts the transport ran:
 * the compute lane counts `transport pass=` trace lines; the webgl lane
 * asserts the session's DECIDED backend (the app probe's `opticsBackend`)
 * — the near-black fraction is recorded as detail but no longer gates:
 * the transport now resolves the ray set, the glass transmits and the
 * frame reads ~0 near-black, so the old black-collapse floor asserted the
 * defect it was named for. */
async function laneCensus(page, lane, scene, settled, traceOffset = 0) {
  if (scene.finite) {
    const state = await probe(page);
    if (!settled || !state?.census)
      return { live: false, detail: "finite frame did not settle" };
    const errors = completionFailures(
      framesSince(page, traceOffset),
      1,
      state.census.rays,
    );
    if (
      state.engine !== "compute" ||
      state.opticsBackend !== "finiteSolid" ||
      state.backend?.software !== false ||
      !state.backend?.label
    )
      errors.push("finite hardware compute route absent");
    return {
      live: errors.length === 0,
      detail:
        errors.join("; ") ||
        `complete finite transport on ${state.backend.label}`,
    };
  }
  if (lane === "webgl") return laneLive(page, scene, settled);
  const transport = settled ? await transportLines(page) : 0;
  return { live: transport > 0, detail: `transportLines=${transport}` };
}

async function laneLive(page, scene, settled) {
  if (!settled) return { live: false, detail: "not settled" };
  const black = await blackFraction(page);
  const backend = await page.evaluate(
    () => window.__surfaceState?.().opticsBackend ?? null,
  );
  return {
    live: backend === "closedSolid",
    detail: `opticsBackend=${backend ?? "null"} nearBlack=${black === null ? "n/a" : (black * 100).toFixed(2) + "%"}`,
  };
}

/** Enter Surface FROM THE UI and wait for the TRUE settled state. */
async function settle(page, budgetMs) {
  await page.click("#modeSurfaceBtn");
  const started = Date.now();
  let state = null;
  let entered = false;
  while (Date.now() - started < budgetMs) {
    state = await probe(page);
    if (state && state.mode !== "surface") break;
    if (state && state.firstFrame) entered = true;
    if (state && state.settled) break;
    await sleep(250);
  }
  return {
    entered,
    settled: Boolean(state && state.settled),
    engine: state ? state.engine : null,
    software: state && state.backend ? state.backend.software : null,
    settleMs: Date.now() - started,
  };
}

/** Poll until the predicate holds, or the budget dies. */
async function pollUntil(page, fn, budgetMs, intervalMs = 200) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

/** The canvas's own pixels, as a PNG buffer (the 4D lift gate's instrument:
 * a WebGL context without preserveDrawingBuffer reads back empty outside
 * its own rAF, so screenshots, not readbacks). */
async function canvasShot(page) {
  const canvas = await page.$("canvas");
  if (!canvas) return null;
  return canvas.screenshot({ type: "png" });
}

async function frameCoverage(page, shot) {
  return page.evaluate(
    async ({ bytes, tol }) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      const w = 128;
      const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w));
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const at = (x, y) => {
        const i = (y * w + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      };
      const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
      let n = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = at(x, y);
          const backdrop = corners.some(
            (c) =>
              Math.abs(c[0] - p[0]) <= tol &&
              Math.abs(c[1] - p[1]) <= tol &&
              Math.abs(c[2] - p[2]) <= tol,
          );
          if (!backdrop) n++;
        }
      }
      return n / (w * h);
    },
    { bytes: Array.from(shot), tol: NON_BACKDROP_TOL },
  );
}

/** FULL-RESOLUTION difference between two canvas screenshots — 0 changed
 * pixels is exactly "byte-identical" (the 4D lift gate's instrument). */
async function imageDiff(page, aPng, bPng) {
  return page.evaluate(
    async ({ a64, b64 }) => {
      const bitmap = async (encoded) => {
        const raw = atob(encoded);
        const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        return createImageBitmap(new Blob([bytes], { type: "image/png" }));
      };
      const [a, b] = await Promise.all([bitmap(a64), bitmap(b64)]);
      if (a.width !== b.width || a.height !== b.height) {
        return { changedFraction: 1, maxDelta: 255 };
      }
      const pixels = (image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, image.width, image.height).data;
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
      return { changedFraction: changed / (pa.length / 4), maxDelta };
    },
    { a64: aPng.toString("base64"), b64: bPng.toString("base64") },
  );
}

/** One camera drag on the canvas: pointer down at the centre, a short burst
 * of moves, up — interactions.ts' orbit drag, which invalidates the traced
 * view live. */
async function cameraDrag(page, rotor = false) {
  const box = await (await page.$("canvas")).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  if (rotor) await page.keyboard.down("Shift");
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(cx + i * 24, cy + i * 8);
    await sleep(20);
  }
  await page.mouse.up();
  if (rotor) await page.keyboard.up("Shift");
}

/** One slice edit: the toggle (row's own availability edit), then the slice
 * POSITION slider through the panel's live-edit pair. */
async function sliceEdit(page, value, trusted = false) {
  if (trusted) {
    const view = page.locator("#viewControls");
    if (!(await view.evaluate((element) => element.open)))
      await page.locator("#viewControls > summary").click();
    await page.locator("#fourDSliceToggle").check();
    const exact = page.getByRole("spinbutton", {
      name: "Slice position exact value",
      exact: true,
    });
    await exact.fill(String(value));
    await exact.press("Enter");
    return;
  }
  await page.evaluate((v) => {
    const toggle = document.getElementById("fourDSliceToggle");
    if (toggle instanceof HTMLInputElement && !toggle.checked) {
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const slider = document.getElementById("fourDSliceSlider");
    if (!(slider instanceof HTMLInputElement)) return false;
    slider.value = String(v);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, value);
}

/** Wait until a preview or settle is IN FLIGHT — the mid-trace arm's premise.
 * The entry settle arms as soon as the first frame lands, so this catches
 * the real thing; a timeout means the machinery under test never ran. */
async function waitForLaneInFlight(page, budgetMs = 20000) {
  return pollUntil(
    page,
    async () => {
      const s = await probe(page);
      return Boolean(
        s && s.mode === "surface" && (s.previewActive || s.settleActive),
      );
    },
    budgetMs,
    100,
  );
}

/** ARM: settle + reload byte identity. */
async function armSettleIdentity(browser, args, scene) {
  const r = {
    arm: `settle+reload [${scene.name}]`,
    checks: [],
    ok: true,
    detail: "",
  };
  const { page, pageErrors } = await newPage(
    browser,
    args,
    scene,
    "settle-identity",
  );
  try {
    const first = await settle(page, args.settleMs);
    const lane1 = await laneCensus(page, args.lane, scene, first.settled);
    const shotA = first.settled ? await canvasShot(page) : null;
    const drawn = shotA ? await frameCoverage(page, shotA) : null;
    r.checks.push({
      what: `first settle (engine ${args.lane}, lane live, drawn)`,
      pass:
        first.entered &&
        first.settled &&
        first.engine === args.lane &&
        first.software === false &&
        lane1.live &&
        drawn !== null &&
        drawn > 0.005,
      detail: `engine=${first.engine} software=${first.software} ${lane1.detail} drawn=${drawn === null ? "n/a" : (drawn * 100).toFixed(1) + "%"} settle=${(first.settleMs / 1000).toFixed(1)}s`,
    });
    // The RESTART IDENTITY is reload-vs-reload: two fresh boots of the same
    // document must reproduce each other BYTE FOR BYTE. The FIRST boot is
    // deliberately not a party to the identity claim — its surface entry
    // auto-fits the camera once (the pinned pose wins from the second boot
    // on, measured as a ~0.3% edge-flip delta between boot #1 and every
    // later one), which is the explorer's camera-tween concern, not the
    // transport state's. What reload-vs-reload proves is exactly this
    // criterion's question: a restart re-seeds the transport state, and a
    // replay lane that retained anything across sessions would show it.
    const boots = [];
    for (let i = 0; i < 2; i++) {
      await page.reload({ waitUntil: "load" });
      await page.bringToFront();
      await page.waitForFunction(
        () => typeof window.__surfaceState === "function",
        { timeout: 30000 },
      );
      const boot = await settle(page, args.settleMs);
      const shot = boot.settled ? await canvasShot(page) : null;
      const lane = await laneCensus(page, args.lane, scene, boot.settled);
      boots.push({ boot, shot, lane });
    }
    const [boot1, boot2] = boots;
    const identity =
      boot1.shot && boot2.shot
        ? await imageDiff(page, boot1.shot, boot2.shot)
        : null;
    r.checks.push({
      what: "reload settle reproduces the frame byte for byte",
      pass:
        boot1.boot.entered &&
        boot1.boot.settled &&
        boot2.boot.settled &&
        (!scene.finite || (boot1.lane.live && boot2.lane.live)) &&
        identity !== null &&
        identity.maxDelta === 0,
      detail: `boot1=${boot1.boot.settled} boot2=${boot2.boot.settled} lane[boot1]=${boot1.lane.detail} identity=${identity === null ? "n/a" : `max${identity.maxDelta} changed ${(identity.changedFraction * 100).toFixed(3)}%`}`,
    });
    r.checks.push({
      what: "no uncaught page errors",
      pass: pageErrors.length === 0,
      detail: pageErrors.join(" | ") || "clean",
    });
  } finally {
    await page.close().catch(() => {});
  }
  r.ok = r.checks.every((c) => c.pass);
  return r;
}

/** ARM: mid-trace edits (camera drags in 3D; slice edits in 4D), fired while
 * a lane is in flight, twice. */
async function armMidTraceEdits(browser, args, scene, dim) {
  const r = {
    arm: `mid-trace ${dim === 3 ? "camera" : scene.finite ? "rotor/slice" : "slice"} edits [${scene.name}]`,
    checks: [],
    edits: [],
    ok: true,
  };
  const { page, pageErrors, record } = await newPage(
    browser,
    args,
    scene,
    `edits-${dim}d`,
  );
  if (record.video) r.video = record.video;
  try {
    for (let round = 1; round <= 2; round++) {
      if (round === 1) {
        await page.click("#modeSurfaceBtn");
        await pollUntil(
          page,
          async () => (await probe(page))?.firstFrame === true,
          args.settleMs,
        );
        videoEvent(record, "baseline-first-frame");
      } else {
        // Round 1's settle left the page idle — spool the lane up with a
        // first edit and catch the preview/settle it ARMS; the measured
        // edit then lands while that work is in flight. The round's
        // subject is the mid-flight edit, not the spool-up one.
        if (dim === 3) await cameraDrag(page);
        else await sliceEdit(page, 0.05, Boolean(record.video));
      }
      const beforeEvidence = scene.finite
        ? await liveDocumentFromPage(page)
        : { document: await documentFromPage(page) };
      const documentBefore = beforeEvidence.document;
      const inFlight = await waitForLaneInFlight(page);
      const before = await probe(page);
      const tokenBefore = framesSince(page).at(-1)?.token;
      const traceOffset = (pageTraces.get(page) ?? []).length;
      videoEvent(
        record,
        dim === 3
          ? "camera-edit-requested"
          : round === 1
            ? "rotor-edit-requested"
            : "slice-edit-requested",
        { round, tokenBefore },
      );
      if (dim === 3) await cameraDrag(page);
      else if (scene.finite && round === 1) await cameraDrag(page, true);
      else
        await sliceEdit(page, round === 1 ? 0.15 : -0.1, Boolean(record.video));
      // The unsettled latch alone proves nothing when the old frame was
      // already running. Require new work after the edit as well, and a
      // different token on this retained renderer before accepting it.
      const invalidated = await pollUntil(
        page,
        async () => {
          const s = await probe(page);
          return Boolean(
            s &&
            s.mode === "surface" &&
            !s.settled &&
            (!scene.finite ||
              framesSince(page, traceOffset).some(
                (frame) => frame.token !== tokenBefore,
              )),
          );
        },
        8000,
      );
      // The lane catches up: a fresh settle completes.
      const reSettled = await pollUntil(
        page,
        async () => (await probe(page))?.settled === true,
        args.settleMs,
      );
      const lane = await laneCensus(
        page,
        args.lane,
        scene,
        reSettled,
        scene.finite ? traceOffset : 0,
      );
      const afterEvidence = scene.finite
        ? await liveDocumentFromPage(page)
        : { document: await documentFromPage(page) };
      const documentAfter = afterEvidence.document;
      const tokenAfter = framesSince(page, traceOffset).at(-1)?.token;
      videoEvent(record, "replacement-frame-observed", {
        round,
        tokenAfter,
        settled: reSettled,
        completeTransport: lane.live,
      });
      const newFrame =
        !scene.finite ||
        (Number.isInteger(tokenBefore) &&
          Number.isInteger(tokenAfter) &&
          tokenAfter !== tokenBefore);
      const editedValue = (document) =>
        dim === 3
          ? document.camera
          : scene.finite && round === 1
            ? [document.fourD?.p, document.fourD?.q]
            : [document.fourD?.sliceW, document.fourD?.sliceCenter];
      const documentChanged =
        !scene.finite ||
        JSON.stringify(editedValue(documentBefore)) !==
          JSON.stringify(editedValue(documentAfter));
      r.edits.push({
        round,
        documentBefore,
        documentAfter,
        ...(scene.finite
          ? {
              documentEvidence: {
                source: "app Copy Link live document",
                copiedLinkBefore: beforeEvidence.copiedLink,
                copiedLinkAfter: afterEvidence.copiedLink,
                locationHashBefore: beforeEvidence.locationHash,
                locationHashAfter: afterEvidence.locationHash,
              },
            }
          : {}),
        traceOffset,
        tokenBefore,
        tokenAfter,
        newFrame,
      });
      r.checks.push({
        what: `edit round ${round}: lane in flight, edit lands, invalidate, settle`,
        pass:
          inFlight &&
          invalidated &&
          reSettled &&
          lane.live &&
          documentChanged &&
          newFrame,
        detail: `inFlight=${inFlight} wasSettled=${before?.settled} invalidated=${invalidated} reSettled=${reSettled} documentChanged=${documentChanged} token=${tokenBefore}->${tokenAfter} newFrame=${newFrame} ${lane.detail}`,
      });
    }
    r.checks.push({
      what: "no uncaught page errors",
      pass: pageErrors.length === 0,
      detail: pageErrors.join(" | ") || "clean",
    });
  } finally {
    await page.close().catch(() => {});
    if (record.video) {
      try {
        await saveVideo(page, record, args.out);
        r.checks.push({
          what: "actual browser edit recording saved",
          pass: true,
          detail: record.video.path,
        });
      } catch (error) {
        record.video.error = String(error);
        r.checks.push({
          what: "actual browser edit recording saved",
          pass: false,
          detail: String(error),
        });
      }
    }
  }
  r.ok = r.checks.every((c) => c.pass);
  return r;
}

/** ARM: mode exit mid-settle, then re-enter. */
async function armModeExit(browser, args, scene) {
  const r = {
    arm: `mode exit mid-settle [${scene.name}]`,
    checks: [],
    ok: true,
  };
  const { page, pageErrors } = await newPage(browser, args, scene, "mode-exit");
  try {
    await page.click("#modeSurfaceBtn");
    await pollUntil(
      page,
      async () => (await probe(page))?.firstFrame === true,
      args.settleMs,
    );
    const inFlight = await waitForLaneInFlight(page);
    const exitRequestedAt = performance.now();
    await page.click("#modePointsBtn");
    const exited = await pollUntil(
      page,
      async () => (await probe(page))?.mode === "points",
      10000,
    );
    const afterExit = await probe(page);
    r.exitObservedMs = performance.now() - exitRequestedAt;
    const reentryTraceOffset = (pageTraces.get(page) ?? []).length;
    const reEntered = await page.click("#modeSurfaceBtn").then(
      () => true,
      () => false,
    );
    const final = reEntered ? await settle(page, args.settleMs) : null;
    const lane = await laneCensus(
      page,
      args.lane,
      scene,
      final?.settled,
      scene.finite ? reentryTraceOffset : 0,
    );
    r.reentryTraceOffset = reentryTraceOffset;
    r.checks.push({
      what: "exit landed mid-flight (mode points, engine null)",
      pass: inFlight && exited && afterExit?.engine === null,
      detail: `inFlight=${inFlight} exited=${exited} probe=${JSON.stringify({ mode: afterExit?.mode, engine: afterExit?.engine })}`,
    });
    r.checks.push({
      what: "re-enter settles with the lane live",
      pass:
        reEntered &&
        final?.entered &&
        final?.settled &&
        final?.engine === args.lane &&
        lane.live,
      detail: `reEntered=${reEntered} settled=${final?.settled} engine=${final?.engine} ${lane.detail}`,
    });
    r.checks.push({
      what: "no uncaught page errors",
      pass: pageErrors.length === 0,
      detail: pageErrors.join(" | ") || "clean",
    });
  } finally {
    await page.close().catch(() => {});
  }
  r.ok = r.checks.every((c) => c.pass);
  return r;
}

/** ARM: the Floor checkbox toggled repeatedly mid-settle (the teardown gate's
 * restart storm on a transmission session). */
async function armRestartStorm(browser, args, scene) {
  const r = {
    arm: `restart storm (6x Floor) [${scene.name}]`,
    checks: [],
    edits: [],
    ok: true,
  };
  const { page, pageErrors } = await newPage(browser, args, scene, "storm");
  try {
    await page.click("#modeSurfaceBtn");
    await pollUntil(
      page,
      async () => (await probe(page))?.firstFrame === true,
      args.settleMs,
    );
    let toggles = 0;
    let inFlightToggles = 0;
    let finalTraceOffset = 0;
    for (let i = 0; i < 6; i++) {
      await sleep(900);
      if (scene.finite && (await waitForLaneInFlight(page))) inFlightToggles++;
      const documentBefore = scene.finite ? await documentFromPage(page) : null;
      const traceOffset = (pageTraces.get(page) ?? []).length;
      const landed = await page.evaluate(() => {
        const cb = document.getElementById("surfaceGroundPlaneCheckbox");
        if (!(cb instanceof HTMLInputElement)) return false;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        return { checked: cb.checked };
      });
      if (!landed) break;
      if (scene.finite) {
        // Floor restarts may create a new renderer whose token counter
        // starts over. Bound evidence by the edit's console offset instead
        // of borrowing matching tokens from a destroyed renderer.
        const documentChanged = await pollUntil(
          page,
          async () =>
            Boolean((await documentFromPage(page)).groundPlane) ===
              landed.checked &&
            Boolean(documentBefore.groundPlane) !== landed.checked,
          8000,
        );
        const newFrame = await pollUntil(
          page,
          async () => framesSince(page, traceOffset).length > 0,
          8000,
        );
        r.edits.push({
          toggle: i + 1,
          documentBefore,
          documentAfter: await documentFromPage(page),
          traceOffset,
          documentChanged,
          newFrame,
        });
        if (!documentChanged || !newFrame) break;
        finalTraceOffset = traceOffset;
      }
      toggles++;
    }
    r.checks.push({
      what: "all 6 toggles landed mid-flight and restarted their authored scene",
      pass: toggles === 6 && (!scene.finite || inFlightToggles === 6),
      detail: `toggles=${toggles}/6 inFlight=${scene.finite ? inFlightToggles : "not instrumented"}`,
    });
    const final = await settle(page, args.settleMs);
    const lane = await laneCensus(
      page,
      args.lane,
      scene,
      final.settled,
      finalTraceOffset,
    );
    r.checks.push({
      what: `post-storm settle, lane live, engine ${args.lane}`,
      pass:
        final.entered &&
        final.settled &&
        final.engine === args.lane &&
        lane.live,
      detail: `settled=${final.settled} engine=${final.engine} ${lane.detail}`,
    });
    r.checks.push({
      what: "no uncaught page errors",
      pass: pageErrors.length === 0,
      detail: pageErrors.join(" | ") || "clean",
    });
  } finally {
    await page.close().catch(() => {});
  }
  r.ok = r.checks.every((c) => c.pass);
  return r;
}

/** ARM: a real Floor edit followed by exactly one Undo and one Redo. The
 * document hash is the authority; a checkbox that changes without saving
 * or an extra history checkpoint must not satisfy the restored-value check. */
async function armFiniteUndoRedo(browser, args, scene, dim) {
  const r = {
    arm: `Floor Undo/Redo [${scene.name}]`,
    checks: [],
    phases: [],
    ok: false,
  };
  const { page, pageErrors } = await newPage(
    browser,
    args,
    scene,
    `undo-redo-${dim}d`,
  );
  try {
    const first = await settle(page, args.settleMs);
    const before = await documentFromPage(page);
    const originalFloor = before.groundPlane;
    const initialLane = await laneCensus(page, args.lane, scene, first.settled);
    r.phases.push({
      phase: "before",
      hash: await page.evaluate(() => location.hash),
      document: before,
      groundPlane: originalFloor,
      traceOffset: 0,
      frames: framesSince(page),
      state: await probe(page),
    });
    r.checks.push({
      what: "baseline has an authored Floor value and complete finite transport",
      pass: typeof originalFloor === "boolean" && initialLane.live,
      detail: `groundPlane=${JSON.stringify(originalFloor)} ${initialLane.detail}`,
    });

    if (typeof originalFloor === "boolean") {
      for (const [phase, expectedFloor, button] of [
        ["edit", !originalFloor, null],
        ["undo", originalFloor, "#undoBtn"],
        ["redo", !originalFloor, "#redoBtn"],
      ]) {
        if (phase === "edit") {
          const section = page.locator("#surfaceFloorSection");
          if (!(await section.evaluate((element) => element.open)))
            await section.locator(":scope > summary").click();
        }
        const traceOffset = (pageTraces.get(page) ?? []).length;
        const documentBefore = await documentFromPage(page);
        const control = page.locator(button ?? "#surfaceGroundPlaneCheckbox");
        const enabled = await control.isEnabled();
        if (enabled) {
          // Playwright dispatches a trusted click; no direct state writes,
          // synthetic change events, history hooks, or explicit flushes.
          if (button) await control.click();
          else await control.setChecked(expectedFloor);
        }
        const authored =
          enabled &&
          (await pollUntil(
            page,
            async () =>
              (await documentFromPage(page)).groundPlane === expectedFloor,
            8000,
          ));
        const exitedForHistory =
          !button ||
          (await pollUntil(
            page,
            async () => (await probe(page))?.mode === "points",
            8000,
          ));
        // Undo/Redo intentionally leave render mode. Re-enter through the
        // same Surface button as the other lifecycle arms before census.
        const final = await settle(page, args.settleMs);
        const documentAfter = await documentFromPage(page);
        const frames = framesSince(page, traceOffset);
        const lane = await laneCensus(
          page,
          args.lane,
          scene,
          final.settled,
          traceOffset,
        );
        const documentChanged =
          documentBefore.groundPlane !== documentAfter.groundPlane;
        const fieldExact = documentAfter.groundPlane === expectedFloor;
        const geometryRetained =
          JSON.stringify(documentAfter.finiteSolid) ===
            JSON.stringify(before.finiteSolid) &&
          JSON.stringify(documentAfter.transforms) ===
            JSON.stringify(before.transforms);
        r.phases.push({
          phase,
          expectedFloor,
          groundPlane: documentAfter.groundPlane,
          hash: await page.evaluate(() => location.hash),
          documentBefore,
          document: documentAfter,
          traceOffset,
          frames,
          state: await probe(page),
          enabled,
          authored,
          exitedForHistory,
          geometryRetained,
        });
        r.checks.push({
          what: `one ${phase}: exact authored Floor value and complete new transport`,
          pass:
            enabled &&
            authored &&
            exitedForHistory &&
            documentChanged &&
            fieldExact &&
            geometryRetained &&
            final.entered &&
            final.settled &&
            frames.length > 0 &&
            lane.live,
          detail: `enabled=${enabled} authored=${authored} groundPlane=${JSON.stringify(documentBefore.groundPlane)}->${JSON.stringify(documentAfter.groundPlane)} expected=${expectedFloor} historyExit=${exitedForHistory} geometryRetained=${geometryRetained} postActionFrames=${frames.length} ${lane.detail}`,
        });
      }
    }
    r.checks.push({
      what: "no uncaught page errors",
      pass: pageErrors.length === 0,
      detail: pageErrors.join(" | ") || "clean",
    });
  } finally {
    await page.close().catch(() => {});
  }
  r.ok = r.checks.every((check) => check.pass);
  return r;
}

/** ARM: a REAL device failure — the browser's GPU process, SIGKILLed
 * mid-settle. The renderer's `device.lost` path must fire, the page must
 * survive, and no uncaught error may land. */
async function armDeviceFailure(browser, args, scene) {
  const r = {
    arm: `device failure (GPU process killed) [${scene.name}]`,
    checks: [],
    ok: true,
  };
  const { page, consoleLines, pageErrors } = await newPage(
    browser,
    args,
    scene,
    "device-failure",
  );
  try {
    await page.click("#modeSurfaceBtn");
    await pollUntil(
      page,
      async () => (await probe(page))?.firstFrame === true,
      args.settleMs,
    );
    const inFlight = await waitForLaneInFlight(page);
    const traceLive = await pollUntil(
      page,
      async () => (await transportLines(page)) > 0,
      20000,
    );
    // Kill the browser's GPU process (found by ppid ancestry — the
    // desktop's own browser runs one too). Chrome restarts the process on
    // demand; every WebGPU device (and every live GL context) is lost with
    // it.
    let killed = false;
    let killInFlight = false;
    for (let attempt = 0; attempt < 20 && !killed; attempt++) {
      let stateAtKill = await probe(page);
      if (!stateAtKill?.previewActive && !stateAtKill?.settleActive) {
        // A repaired finite frame may finish between the initial premise
        // and process discovery. Re-arm and measure the actual kill-time
        // state instead of reusing the earlier in-flight observation.
        await cameraDrag(page);
        await waitForLaneInFlight(page);
        stateAtKill = await probe(page);
      }
      if (!stateAtKill?.previewActive && !stateAtKill?.settleActive) continue;
      for (const pid of gpuProcessPids()) {
        r.stateAtKill = stateAtKill;
        killInFlight = true;
        process.kill(pid, "SIGKILL");
        killed = true;
        break;
      }
      if (!killed) await sleep(100);
    }
    // The lost path: the renderer latches, fires onLost (re-entering via
    // WebGL), and the page stays alive and responsive.
    const lostLine = await pollUntil(
      page,
      async () =>
        consoleLines.some((l) => l.includes("Surface compute device lost")),
      30000,
      250,
    );
    await sleep(3000);
    const after = await probe(page);
    const responsive = after !== null && after.mode !== undefined;
    r.checks.push({
      what: "GPU process killed mid-flight",
      pass: inFlight && traceLive && killed && killInFlight,
      detail: `inFlight=${inFlight} traceLive=${traceLive} killed=${killed} activeAtKill=${killInFlight}`,
    });
    r.checks.push({
      what: "renderer's device-lost path fired; page alive",
      pass: lostLine && browser.isConnected() && responsive,
      detail: `lostLine=${lostLine} browserAlive=${browser.isConnected()} probeMode=${after?.mode}`,
    });
    if (scene.finite)
      r.checks.push({
        what: "finite session exits after compute loss without a WebGL substitute",
        pass: after?.mode !== "surface" && after?.engine === null,
        detail: JSON.stringify(after),
      });
    r.checks.push({
      what: "no uncaught page errors",
      pass: pageErrors.length === 0,
      detail: pageErrors.join(" | ") || "clean",
    });
  } finally {
    await page.close().catch(() => {});
  }
  r.ok = r.checks.every((c) => c.pass);
  return r;
}

/** A finite solid has no GLSL twin: forcing it must refuse visibly before
 * entry, while preserving the finite document for a capable session. */
async function armFiniteGlRefusal(browser, args, scene) {
  const { page, pageErrors } = await newPage(
    browser,
    { ...args, lane: "webgl" },
    scene,
    "forced-gl-refusal",
  );
  const r = {
    arm: `forced-WebGL refusal [${scene.name}]`,
    checks: [],
    ok: false,
  };
  try {
    const disclosed = await pollUntil(
      page,
      async () => {
        const note = await page.locator("#surfaceNote").textContent();
        return /finite-solid.*WebGPU|WebGPU.*finite-solid/i.test(note ?? "");
      },
      30000,
    );
    const state = await probe(page);
    const disabled = await page.locator("#modeSurfaceBtn").isDisabled();
    const hash = await page.evaluate(() => location.hash);
    const document = JSON.parse(
      Buffer.from(hash.slice(4), "base64url").toString(),
    );
    r.checks.push({
      what: "compute-only scene visibly refused without replacing its geometry",
      pass:
        disclosed &&
        disabled &&
        state?.mode !== "surface" &&
        state?.engine === null &&
        document.finiteSolid?.level === 2,
      detail: `disclosed=${disclosed} disabled=${disabled} state=${JSON.stringify(state)}`,
    });
    r.checks.push({
      what: "no uncaught page errors",
      pass: pageErrors.length === 0,
      detail: pageErrors.join(" | ") || "clean",
    });
  } finally {
    await page.close().catch(() => {});
  }
  r.ok = r.checks.every((check) => check.pass);
  return r;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const freshDist = await guardFreshDist({ url: args.url });
  if (args.scene === "finite")
    SCENES = finiteScenes(args.finiteReport, freshDist);
  const quiet = await quietBaseline(console.error);
  const contended = contendedReason(quiet);
  if (contended) {
    console.error(
      `UNCERTIFIED: another process was already on the GPU — ${contended};` +
        " do not read this run's timing rows.",
    );
  }
  const browser = await launch(args);
  const results = [];
  let inconclusive = false;
  let checkingFailure = null;
  let expectedArms = [];
  const completedArms = [];
  try {
    // The premise check comes first, once per dimension: if the transport
    // lane never went live, every arm would "fail" for apparatus reasons.
    // Exit 2 and say so instead. The webgl lane's premise is the near-black
    // signature (its `?surfacetrace` census is inert) — and a software
    // rasterizer reads INCONCLUSIVE there, because the wire strips the lane
    // on one by measured crash (the session record's SwiftShader finding).
    for (const dim of [3, 4]) {
      const scene = SCENES[dim];
      const { page } = await newPage(browser, args, scene, "premise");
      let laneLive = false;
      try {
        const first = await settle(page, args.settleMs);
        const engineOk = first.settled && first.engine === args.lane;
        if (args.lane === "webgl") {
          const census = await laneCensus(page, args.lane, scene, engineOk);
          laneLive = engineOk && first.software === false && census.live;
          log(
            `premise [${scene.name}]: engine=${first.engine} software=${first.software} settled=${first.settled} laneLive=${laneLive} ${census.detail}`,
          );
          if (engineOk && first.software !== false) {
            console.error(
              `INCONCLUSIVE: ${scene.name} ran on a software rasterizer — ` +
                "the WebGL optics lane is stripped there by measured crash. Rerun on the real driver.",
            );
          }
        } else {
          laneLive =
            engineOk &&
            first.software === false &&
            (await transportLines(page)) > 0;
          log(
            `premise [${scene.name}]: engine=${first.engine} software=${first.software} settled=${first.settled} laneLive=${laneLive}`,
          );
          if (scene.finite && laneLive) {
            const census = await laneCensus(
              page,
              args.lane,
              scene,
              first.settled,
            );
            results.push({
              arm: `finite completion premise [${scene.name}]`,
              ok: census.live,
              checks: [
                {
                  what: "complete finite transport",
                  pass: census.live,
                  detail: census.detail,
                },
              ],
            });
          }
        }
      } finally {
        await page.close().catch(() => {});
      }
      if (!laneLive) {
        console.error(
          `INCONCLUSIVE: the transport lane never went live in ${scene.name} — ` +
            "no real adapter, or the optics never routed. Rerun on the real driver.",
        );
        inconclusive = true;
      }
    }
    if (!inconclusive) {
      const arms = [
        ["settle+reload-3d", () => armSettleIdentity(browser, args, SCENES[3])],
        ["settle+reload-4d", () => armSettleIdentity(browser, args, SCENES[4])],
        ["edits-3d", () => armMidTraceEdits(browser, args, SCENES[3], 3)],
        ["edits-4d", () => armMidTraceEdits(browser, args, SCENES[4], 4)],
        ["mode-exit-3d", () => armModeExit(browser, args, SCENES[3])],
        ["mode-exit-4d", () => armModeExit(browser, args, SCENES[4])],
        ["restart-storm", () => armRestartStorm(browser, args, SCENES[3])],
        ...(args.scene === "finite"
          ? [
              [
                "restart-storm-4d",
                () => armRestartStorm(browser, args, SCENES[4]),
              ],
              [
                "undo-redo-3d",
                () => armFiniteUndoRedo(browser, args, SCENES[3], 3),
              ],
              [
                "undo-redo-4d",
                () => armFiniteUndoRedo(browser, args, SCENES[4], 4),
              ],
              [
                "forced-gl-3d",
                () => armFiniteGlRefusal(browser, args, SCENES[3]),
              ],
              [
                "forced-gl-4d",
                () => armFiniteGlRefusal(browser, args, SCENES[4]),
              ],
            ]
          : []),
        // The GPU-process kill loses every GL context with the process and
        // the app does not handle WebGL context restoration — the arm is
        // meaningful only against the compute device, so the webgl lane
        // runs without it (the module doc's standing disclosure).
        ...(args.lane === "compute"
          ? [
              [
                "device-failure",
                () => armDeviceFailure(browser, args, SCENES[3]),
              ],
              ...(args.scene === "finite"
                ? [
                    [
                      "device-failure-4d",
                      () => armDeviceFailure(browser, args, SCENES[4]),
                    ],
                  ]
                : []),
            ]
          : []),
      ];
      if (args.arm && !arms.some(([name]) => name === args.arm))
        throw new Error(`unknown --arm=${args.arm}`);
      const selectedArms = args.arm
        ? arms.filter(([n]) => n === args.arm)
        : arms;
      expectedArms = selectedArms.map(([name]) => name);
      for (const [name, run] of selectedArms) {
        log(`--- ${name}`);
        const r = await run();
        results.push(r);
        completedArms.push(name);
        for (const c of r.checks) {
          log(`    ${c.pass ? "PASS" : "FAIL"}  ${c.what} — ${c.detail}`);
        }
        log(`    arm ${r.ok ? "OK" : "FAILED"}`);
      }
    }
  } catch (error) {
    checkingFailure = String(error?.stack ?? error);
    throw error;
  } finally {
    await browser.close().catch(() => {});
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(
      args.out,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          args,
          freshDist,
          quietBaseline: quiet,
          timingQualification: args.videoOut
            ? "recording overhead; this lifecycle run does not qualify the performance envelope"
            : "observations only; this lifecycle run does not qualify the performance envelope",
          browser: browser.version(),
          verdict: checkingFailure
            ? "checking-failed"
            : inconclusive
              ? "inconclusive"
              : expectedArms.length === 0 ||
                  completedArms.length !== expectedArms.length ||
                  results.some((result) => !result.ok)
                ? "fail"
                : "pass",
          checkingFailure,
          expectedArmCount: expectedArms.length,
          completedArmCount: completedArms.length,
          expectedArms,
          completedArms,
          inconclusive,
          results,
          pages: pageEvidence,
          ...(args.videoOut
            ? {
                videos: pageEvidence
                  .filter((page) => page.video)
                  .map((page) => page.video),
              }
            : {}),
        },
        null,
        2,
      ) + "\n",
    );
    log(`evidence: ${args.out}`);
  }
  console.log("\n=== summary ===");
  console.log(
    `lifecycle arms completed: ${completedArms.length}/${expectedArms.length}`,
  );
  let failed = false;
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.arm}`);
    for (const c of r.checks) {
      if (!c.pass) failed = true;
      console.log(`      ${c.pass ? "  " : "!!"} ${c.what} — ${c.detail}`);
    }
  }
  process.exit(failed ? 3 : inconclusive ? 2 : 0);
}

main().catch((e) => {
  console.error("[surface-transport-sweep] harness failure:", e);
  process.exit(1);
});
