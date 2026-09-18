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
 *
 * THE PREMISE, and its honest scope: the app routes an optics-authored IFS
 * session to the compute renderer with the transport lane live — the
 * `#v1=` document carries `optics: { model: "dielectric" }` on every
 * transform, `?surfacecompute` (3D only; every 4D session already prefers
 * compute) forces the compute tracer past the plain-affine WebGL verdict,
 * and `gatedSlotMaterials` admits the authored optics. These fixtures are
 * map-bearing IFS systems, so the app's routing admission (the closed-solid
 * backend's emitter-only shape) keeps them on the ESTIMATOR boundary query
 * by its own rule — the routing itself landed 2026-09-18 and resolves on
 * the closed-solid vocabulary (the starters' leg; the tile gate asserts
 * it) — and this sweep drives the estimator query deliberately: the lane
 * pays its
 * buffers, dispatches, replay passes and cancellation generations whatever
 * the samples resolve, and on IFS geometry every inside path refuses — the
 * capability matrix's disclosed vacuous state. That is exactly right for
 * THIS criterion: it is the invalidation/drain of the transport STATE that
 * is under test here, not optical resolution (the closed-solid resolution
 * evidence is the envelope leg's, which gates `resolved > 0`). The sweep
 * proves the premise per arm — `engine === "compute"` AND
 * `?surfacetrace`'s ring carries `transport pass=` lines — and reports
 * INCONCLUSIVE (exit 2) rather than passing if the lane never went live.
 *
 * THE LANES. `--lane=compute` (default) is the sweep above. `--lane=webgl`
 * drives the SAME arms against the GLSL twins: the fixtures' URLs swap
 * `?surfacecompute` for `?surfacegl` (the fragment tracer is the fallback
 * arm; `?surfacetrace` is inert there and dropped), `engine === "webgl"` is
 * asserted in place of `"compute"`, and the lane-live observable is the
 * settled frame's ABSOLUTE near-black fraction (on IFS geometry every
 * inside path refuses and unresolved samples paint black — the same
 * vacuous state — so the object's ray coverage reads as near-black: 14.08%
 * on the tetra, 0.32% on the sparse w-slice (0.21% at the slice arm's
 * edited pose); both stripped controls ~0.
 * The floors sit under the measured minima. The webgl lane runs
 * WITHOUT the device-failure arm: the GPU-process kill loses every GL
 * context with the process, the app does not handle WebGL context
 * restoration, and the arm is meaningful only against the compute device.
 * A software rasterizer is INCONCLUSIVE in the webgl lane by measurement —
 * the optics program crashed the SwiftShader renderer on the 4D arm's
 * first frame, and the wire strips the lane there.
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
import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";
import { OPTICS_SCENES } from "./lib/optics-fixtures.mjs";

const NON_BACKDROP_TOL = 10;

function parseArgs(argv) {
  const out = {
    url: "https://localhost:4173",
    display: undefined,
    settleMs: 240000,
    arm: null,
    lane: "compute",
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "url" && value) out.url = value.replace(/\/+$/, "");
    else if (key === "display") out.display = value ?? ":0";
    else if (key === "settle" && value) out.settleMs = Number(value);
    else if (key === "arm" && value) out.arm = value;
    else if (key === "lane" && value) out.lane = value;
  }
  if (!["compute", "webgl"].includes(out.lane)) {
    throw new Error(`--lane must be compute or webgl (got ${out.lane})`);
  }
  return out;
}

const SCENES = OPTICS_SCENES;

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
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 1024, height: 640 },
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
  page.on("console", (m) => {
    const t = m.text();
    if (/surface|webgpu|webgl|transport|device|shader|adapter|error/i.test(t)) {
      consoleLines.push(`[${m.type()}] ${t}`);
    }
  });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("crash", () => consoleLines.push("[page] CRASHED"));
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
  return { page, consoleLines, pageErrors };
}

const probe = (page) => page.evaluate(() => window.__surfaceState?.() ?? null);

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
async function laneCensus(page, lane, scene, settled) {
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
async function cameraDrag(page) {
  const box = await (await page.$("canvas")).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(cx + i * 24, cy + i * 8);
    await sleep(20);
  }
  await page.mouse.up();
}

/** One slice edit: the toggle (row's own availability edit), then the slice
 * POSITION slider through the panel's live-edit pair. */
async function sliceEdit(page, value) {
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
    arm: `mid-trace ${dim === 3 ? "camera" : "slice"} edits [${scene.name}]`,
    checks: [],
    ok: true,
  };
  const { page, pageErrors } = await newPage(
    browser,
    args,
    scene,
    `edits-${dim}d`,
  );
  try {
    for (let round = 1; round <= 2; round++) {
      if (round === 1) {
        await page.click("#modeSurfaceBtn");
        await pollUntil(
          page,
          async () => (await probe(page))?.firstFrame === true,
          args.settleMs,
        );
      } else {
        // Round 1's settle left the page idle — spool the lane up with a
        // first edit and catch the preview/settle it ARMS; the measured
        // edit then lands while that work is in flight. The round's
        // subject is the mid-flight edit, not the spool-up one.
        if (dim === 3) await cameraDrag(page);
        else await sliceEdit(page, 0.05);
      }
      const inFlight = await waitForLaneInFlight(page);
      const before = await probe(page);
      if (dim === 3) await cameraDrag(page);
      else await sliceEdit(page, round === 1 ? 0.15 : -0.1);
      // The edit must OBSERVABLY invalidate: settled goes false.
      const invalidated = await pollUntil(
        page,
        async () => {
          const s = await probe(page);
          return Boolean(s && s.mode === "surface" && !s.settled);
        },
        8000,
      );
      // The lane catches up: a fresh settle completes.
      const reSettled = await pollUntil(
        page,
        async () => (await probe(page))?.settled === true,
        args.settleMs,
      );
      const lane = await laneCensus(page, args.lane, scene, reSettled);
      r.checks.push({
        what: `edit round ${round}: lane in flight, edit lands, invalidate, settle`,
        pass: inFlight && invalidated && reSettled && lane.live,
        detail: `inFlight=${inFlight} wasSettled=${before?.settled} invalidated=${invalidated} reSettled=${reSettled} ${lane.detail}`,
      });
    }
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
    await page.click("#modePointsBtn");
    const exited = await pollUntil(
      page,
      async () => (await probe(page))?.mode === "points",
      10000,
    );
    const afterExit = await probe(page);
    const reEntered = await page.click("#modeSurfaceBtn").then(
      () => true,
      () => false,
    );
    const final = reEntered ? await settle(page, args.settleMs) : null;
    const lane = await laneCensus(page, args.lane, scene, final?.settled);
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
    for (let i = 0; i < 6; i++) {
      await sleep(900);
      const landed = await page.evaluate(() => {
        const cb = document.getElementById("surfaceGroundPlaneCheckbox");
        if (!(cb instanceof HTMLInputElement)) return false;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      });
      if (!landed) break;
      toggles++;
    }
    r.checks.push({
      what: "all 6 toggles landed mid-flight",
      pass: toggles === 6,
      detail: `toggles=${toggles}/6`,
    });
    const final = await settle(page, args.settleMs);
    const lane = await laneCensus(page, args.lane, scene, final.settled);
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
    for (let attempt = 0; attempt < 20 && !killed; attempt++) {
      await sleep(250);
      for (const pid of gpuProcessPids()) {
        process.kill(pid, "SIGKILL");
        killed = true;
        break;
      }
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
      pass: inFlight && traceLive && killed,
      detail: `inFlight=${inFlight} traceLive=${traceLive} killed=${killed}`,
    });
    r.checks.push({
      what: "renderer's device-lost path fired; page alive",
      pass: lostLine && browser.isConnected() && responsive,
      detail: `lostLine=${lostLine} browserAlive=${browser.isConnected()} probeMode=${after?.mode}`,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await guardFreshDist({ url: args.url });
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
            ]
          : []),
      ];
      for (const [name, run] of args.arm
        ? arms.filter(([n]) => n === args.arm)
        : arms) {
        log(`--- ${name}`);
        const r = await run();
        results.push(r);
        for (const c of r.checks) {
          log(`    ${c.pass ? "PASS" : "FAIL"}  ${c.what} — ${c.detail}`);
        }
        log(`    arm ${r.ok ? "OK" : "FAILED"}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  console.log("\n=== summary ===");
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
