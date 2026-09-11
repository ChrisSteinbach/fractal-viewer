#!/usr/bin/env node
/** MEASUREMENT-ONLY: the restored participating medium's cost at pane scale.
 *
 *   npm run build && npm run preview &
 *   export XAUTHORITY=$(ls -t /run/user/$(id -u)/.mutter-Xwaylandauth.* | head -1)
 *   node scripts/medium-cost.measure.mjs --display=:0 --label=R4a \
 *     --levers="surfacemediumcells=1&surfacemediumstride=4" --cap=1200
 *
 * One run = one fresh browser process + one fresh context at a viewport
 * whose Surface pane traces `--width`x`--height` compute rays (default
 * 1920x1057 = 2,029,440, the prior pane record's `frame start rays=`). The
 * scene is the cathedral starter: minted ONCE through the production menu
 * entry and the app's own Collection encoder, cached as
 * `<out>/cathedral.scene.txt`, then booted from its `#v1=` hash so every run
 * starts from the identical document with a parked camera. `--density=0`
 * zeroes the medium's density in that document (the compute loop then
 * dispatches no medium work); `--density=authored` keeps the starter's 0.42.
 * `--scene=slice4` swaps in cinematic-lighting.verify.mjs's simpleFourD
 * fixture (a filled 16-map 4-cube at a nonzero w slice under a nonidentity
 * rotor, two lights, medium density 0.12) on top of that document.
 * `--hashfile=PATH` boots an ARBITRARY document instead: PATH holds a bare
 * `v1=...` hash (as `scripts/medium-shafts-scene.mjs` writes), read verbatim
 * and never re-minted. `--scene`/`--density` are ignored with it.
 * ATTRIBUTION CAVEAT: a settle's FIRST frame can log `frame start` before
 * the 50 ms watcher's `[mcstate]` flips (seen on the 4D fixture), which then
 * files that pass under previewFrames; pass boundaries/lanes must be read
 * with the full-pane unbudgeted frame counted as the settle's.
 *
 * Timing is from the Surface button click (t=0). Everything the renderer
 * says arrives through `?surfacetrace` and is appended to `<label>.trace.txt`
 * with a node receive time; a page-side 50 ms watcher emits `[mcstate]`
 * console lines on every settle/preview/row transition, so trace lines are
 * attributed to the SETTLE job by console ORDER rather than by polling
 * guesswork. A settle pass boundary is a `frame done` inside the settle job.
 *
 * Stops at the settled latch, at `--cap` seconds, or (`--stop=pass1`) at the
 * first settle pass boundary. Reports lane totals (medium/shade/march
 * fence wall and work), medium dispatch widths, the fence calibration,
 * progress at `--checkpoints`, and an optional canvas screenshot.
 * GPU work is serial by construction: run it on a quiet machine.
 */
import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import {
  launchSurfaceBrowser,
  pollSurfaceState,
} from "./lib/surface-browser-runner.mjs";
import { guardFreshDist } from "./lib/dist-freshness.mjs";

const args = {
  url: "https://localhost:4173",
  mode: "x11::0",
  label: `run-${Date.now()}`,
  levers: "",
  scene: "cathedral",
  density: "authored",
  hashfile: "",
  cap: 600,
  stop: "settle",
  checkpoints: "10,60,300,600",
  shot: "yes",
  width: 1920,
  height: 1057,
  out: "scripts/out/medium-cost",
};
for (const raw of process.argv.slice(2)) {
  const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
  if (!match) throw new Error(`Invalid argument ${raw}`);
  const [, key, value] = match;
  if (key === "display") args.mode = `x11:${value ?? ":0"}`;
  else if (Object.hasOwn(args, key) && value !== undefined) args[key] = value;
  else throw new Error(`Unknown or incomplete option ${raw}`);
}
args.cap = Number(args.cap);
args.width = Number(args.width);
args.height = Number(args.height);
assert(["authored", "0"].includes(args.density));
assert(["settle", "pass1"].includes(args.stop));
assert(Number.isFinite(args.cap) && args.cap > 0);
const checkpoints = args.checkpoints
  .split(",")
  .filter(Boolean)
  .map(Number)
  .sort((a, b) => a - b);

await guardFreshDist({ url: args.url });
await mkdir(args.out, { recursive: true });

const log = (message) => console.log(`[medium-cost ${args.label}] ${message}`);
const encode = (document) =>
  `v1=${Buffer.from(JSON.stringify(document)).toString("base64url")}`;
const decode = (encoded) =>
  JSON.parse(Buffer.from(encoded.slice(3), "base64url").toString("utf8"));
const shotStyle =
  "#panel,#help,#legend,#menuToggle,#loading,#error,#updateBanner,#renderError,#toast,#surfaceProgress { visibility:hidden !important }";

async function newContext(browser) {
  return browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
}

async function boot(page, query, hash = "") {
  await page.goto(`${args.url}/?${query}${hash ? `#${hash}` : ""}`, {
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

/** Mint the cathedral starter's persisted document through the production
 * menu and Collection encoder. No GPU settle is waited for. */
async function mintDocument(browser) {
  const cache = path.join(args.out, "cathedral.scene.txt");
  try {
    await access(cache);
    return (await readFile(cache, "utf8")).trim();
  } catch {
    /* mint below */
  }
  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    await boot(page, "surfacestate&surfacecompute");
    await page.locator("#presetSelect").evaluate((element) => {
      element.value = "starter:cathedral";
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(
      () => window.__surfaceState?.().mode === "surface",
      undefined,
      { timeout: 60_000 },
    );
    const key = "fractal-viewer:collection";
    const before = await page.evaluate((k) => localStorage.getItem(k), key);
    await page.locator("#saveCollectionBtn").evaluate((el) => el.click());
    await page.waitForFunction(
      ({ key, before }) => localStorage.getItem(key) !== before,
      { key, before },
      { timeout: 60_000 },
    );
    const encoded = await page.evaluate((k) => {
      const parsed = JSON.parse(localStorage.getItem(k));
      return (Array.isArray(parsed) ? parsed : parsed.scenes)[0]?.encoded;
    }, key);
    const document = decode(encoded);
    assert(document.surface?.lighting?.medium, "starter lost its medium");
    assert(document.camera, "starter lost its camera");
    await writeFile(cache, encoded);
    await writeFile(
      path.join(args.out, "cathedral.scene.json"),
      JSON.stringify(document, null, 2),
    );
    return encoded;
  } finally {
    await context.close();
  }
}

const num = (re, text) => {
  const m = re.exec(text);
  return m ? Number(m[1]) : null;
};
const newLane = () => ({ groups: 0, dispatches: 0, wallMs: 0, workMs: 0 });

let browser;
const report = {
  args,
  startedAt: new Date().toISOString(),
  verdict: "running",
};
try {
  browser = await launchSurfaceBrowser(args.mode);
  const cdp = await browser.newBrowserCDPSession();
  const gpuInfo = (await cdp.send("SystemInfo.getInfo")).gpu;
  report.browserGpu = {
    devices: gpuInfo.devices,
    driverBugWorkarounds: undefined,
    featureStatus: gpuInfo.featureStatus,
  };
  await cdp.detach();
  report.browserVersion = browser.version();

  let document;
  let hash;
  if (args.hashfile) {
    hash = (await readFile(args.hashfile, "utf8")).trim();
    document = decode(hash);
  } else {
    const encoded = await mintDocument(browser);
    document = decode(encoded);
    if (args.scene === "slice4") {
      // cinematic-lighting.verify.mjs's simpleFourD fixture, verbatim: an
      // ordinary filled 4-cube IFS (16 maps), seen at a nonzero w slice under
      // a nonidentity rotor, with a two-light rig and a bounded medium.
      document = structuredClone(document);
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
    } else {
      assert.equal(args.scene, "cathedral", "--scene must be cathedral|slice4");
    }
    if (args.density === "0") document.surface.lighting.medium.density = 0;
    hash = encode(document);
  }
  report.medium = document.surface?.lighting?.medium ?? null;
  report.antialiasSamples = document.surface?.antialiasSamples;
  report.hash = hash;

  const context = await newContext(browser);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const trace = createWriteStream(
    path.join(args.out, `${args.label}.trace.txt`),
  );
  let t0 = null;
  const now = () => (t0 === null ? 0 : Date.now() - t0);

  // Attribution state, advanced in console ORDER.
  let inSettle = false;
  let settleStartT = null;
  let settleEverStarted = false;
  let frame = null;
  const frames = [];
  const errors = [];
  let fenceCalibrated = [];
  let firstExperimentLine = null;
  const strideKept = { kept: 0, batch: 0 };
  let lastRow = "";

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    const t = now();
    trace.write(`${t}\t${text}\n`);
    if (text.startsWith("[mcstate] ")) {
      const s = JSON.parse(text.slice(10));
      lastRow = s.row;
      if (s.settleActive && !inSettle) {
        inSettle = true;
        if (!settleEverStarted) {
          settleEverStarted = true;
          settleStartT = t;
        }
      } else if (!s.settleActive && inSettle) {
        inSettle = false;
      }
      return;
    }
    if (!text.startsWith("[surfacetrace]")) {
      if (
        message.type() === "error" ||
        /device lost|validation error|uncaptured error/i.test(text)
      )
        errors.push(text);
      return;
    }
    const cal = /fence calibrated ms=([\d.]+)/.exec(text);
    if (cal) fenceCalibrated.push(Number(cal[1]));
    if (/medium experiment /.test(text) && firstExperimentLine === null)
      firstExperimentLine = text;
    const start = /frame start rays=(\d+).*budgetMs=(\S+)/.exec(text);
    if (start) {
      frame = {
        settle: inSettle,
        rays: Number(start[1]),
        budgetMs: start[2],
        startT: t,
        doneT: null,
        medium: newLane(),
        shade: newLane(),
        march: newLane(),
        mediumWidths: {},
        mediumSamples: [],
        done: null,
      };
      frames.push(frame);
      return;
    }
    if (!frame) return;
    const stride = /medium stride=\d+ kept=(\d+)\/(\d+)/.exec(text);
    if (stride && frame.settle) {
      strideKept.kept += Number(stride[1]);
      strideKept.batch += Number(stride[2]);
    }
    const fence =
      /fence (medium|shade|march) dispatches=(\d+).*? wall=([\d.]+) work=([-\d.]+) perDispatch=([-\d.]+)/.exec(
        text,
      );
    if (fence) {
      const lane = frame[fence[1]];
      const d = Number(fence[2]);
      lane.groups++;
      lane.dispatches += d;
      lane.wallMs += Number(fence[3]);
      lane.workMs += Number(fence[4]);
      if (fence[1] === "medium") {
        const rays = num(/ rays=(\d+)/, text);
        const width = Math.round(rays / d);
        frame.mediumWidths[width] = (frame.mediumWidths[width] ?? 0) + d;
        frame.mediumSamples.push([
          width,
          Number(fence[5]),
          d,
          Number(fence[3]),
          Number(fence[4]),
        ]);
      }
      return;
    }
    if (/frame done /.test(text)) {
      frame.doneT = t;
      frame.done = {
        passes: num(/passes=(\d+)/, text),
        fences: num(/ fences=(\d+)/, text),
        truncated: /truncated=true/.test(text),
        hit: num(/ hit=(\d+)/, text),
        miss: num(/ miss=(\d+)/, text),
        exhausted: num(/ exhausted=(\d+)/, text),
        active: num(/ active=(\d+)/, text),
        mediumDispatches: num(/mediumDispatches=(\d+)/, text),
        mediumFences: num(/mediumFences=(\d+)/, text),
        mediumMs: num(/mediumMs=([\d.]+)/, text),
        marchMs: num(/marchMs=([\d.]+)/, text),
        shadeMs: num(/shadeMs=([\d.]+)/, text),
      };
    }
  });
  await page.addInitScript(() => {
    let previous = "";
    setInterval(() => {
      const probe = window.__surfaceState?.();
      if (!probe) return;
      const rowEl = document.getElementById("surfaceProgress");
      const row =
        rowEl && !rowEl.classList.contains("hidden")
          ? (rowEl.textContent ?? "").replace(/\s+/g, " ").trim()
          : "";
      const s = {
        mode: probe.mode,
        settleActive: !!probe.settleActive,
        previewActive: !!probe.previewActive,
        settled: !!probe.settled,
        row,
      };
      const key = JSON.stringify(s);
      if (key !== previous) {
        previous = key;
        console.debug(`[mcstate] ${key}`);
      }
    }, 50);
  });

  const query = new URLSearchParams({
    surfacestate: "",
    surfacetrace: "",
    surfacecompute: "",
    run: args.label,
  }).toString();
  const leverQuery = args.levers ? `&${args.levers}` : "";
  await boot(page, `${query}${leverQuery}`, hash);
  report.url = `${args.url}/?${query}${leverQuery}`;
  // The canvas the compute pane presents into.
  report.canvas = await page.evaluate(() => {
    const c = document.querySelector("#container canvas");
    const r = c.getBoundingClientRect();
    return {
      css: [r.width, r.height],
      backing: [c.width, c.height],
      dpr: window.devicePixelRatio,
      inner: [window.innerWidth, window.innerHeight],
    };
  });

  t0 = Date.now();
  await page.locator("#modeSurfaceBtn").evaluate((element) => {
    if (element.disabled) throw new Error(`Surface refused: ${element.title}`);
    element.click();
  });
  log(
    `entered Surface; cap ${args.cap}s; levers="${args.levers}" density=${args.density}`,
  );

  const progressAt = [];
  let nextCheckpoint = 0;
  let nextLog = 30_000;
  let outcome = "cap";
  let lastProbe = null;
  for (;;) {
    const state = await pollSurfaceState(page);
    lastProbe = state.probe;
    const t = now();
    const settleFrames = frames.filter((f) => f.settle);
    const passesDone = settleFrames.filter((f) => f.doneT !== null).length;
    while (
      nextCheckpoint < checkpoints.length &&
      t >= checkpoints[nextCheckpoint] * 1000
    ) {
      progressAt.push({
        atS: checkpoints[nextCheckpoint],
        tMs: t,
        row: state.rowText.replace(/\s+/g, " ").trim(),
        passesDone,
        settleActive: state.probe.settleActive,
        previewActive: state.probe.previewActive,
      });
      log(
        `@${checkpoints[nextCheckpoint]}s: ${progressAt.at(-1).row} (passes ${passesDone})`,
      );
      nextCheckpoint++;
    }
    if (t >= nextLog) {
      log(
        `${(t / 1000).toFixed(0)}s: ${state.rowText.replace(/\s+/g, " ").trim()} passes=${passesDone}`,
      );
      nextLog += 30_000;
    }
    if (state.settled && settleEverStarted) {
      outcome = "settled";
      break;
    }
    if (args.stop === "pass1" && passesDone >= 1) {
      outcome = "pass1";
      break;
    }
    if (t >= args.cap * 1000) {
      outcome = "cap";
      break;
    }
    if (errors.length > 0 && errors.some((e) => /device lost/i.test(e))) {
      outcome = "device-lost";
      break;
    }
    await page.waitForTimeout(250);
  }
  const endT = now();
  const finalRow = (await pollSurfaceState(page)).rowText
    .replace(/\s+/g, " ")
    .trim();
  if (args.shot === "yes") {
    const bytes = await page
      .locator("#container canvas")
      .first()
      .screenshot({ type: "png", style: shotStyle });
    await writeFile(path.join(args.out, `${args.label}.png`), bytes);
  }
  // Let trailing console lines land before closing.
  await page.waitForTimeout(500);
  await context.close();
  trace.end();

  const settleFrames = frames.filter((f) => f.settle);
  const sum = (lane) =>
    settleFrames.reduce(
      (acc, f) => ({
        groups: acc.groups + f[lane].groups,
        dispatches: acc.dispatches + f[lane].dispatches,
        wallMs: acc.wallMs + f[lane].wallMs,
        workMs: acc.workMs + f[lane].workMs,
      }),
      newLane(),
    );
  const widths = {};
  const mediumSamples = [];
  for (const f of settleFrames) {
    for (const [w, d] of Object.entries(f.mediumWidths))
      widths[w] = (widths[w] ?? 0) + d;
    mediumSamples.push(...f.mediumSamples);
  }
  // Least squares per-dispatch work = a + b * width over medium groups
  // (each group weighted by its dispatch count).
  let fit = null;
  if (mediumSamples.length >= 3) {
    let sw = 0,
      sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0;
    for (const [x, y, d] of mediumSamples) {
      sw += d;
      sx += d * x;
      sy += d * y;
      sxx += d * x * x;
      sxy += d * x * y;
    }
    const den = sw * sxx - sx * sx;
    if (den > 0) {
      const b = (sw * sxy - sx * sy) / den;
      const a = (sy - b * sx) / sw;
      fit = {
        fixedMs: a,
        marginalUsPerRay: b * 1000,
        samples: mediumSamples.length,
      };
    }
  }
  const medium = sum("medium");
  report.result = {
    outcome,
    endMs: endT,
    finalRow,
    settleStartMs: settleStartT,
    fenceCalibratedMs: fenceCalibrated,
    firstExperimentLine,
    strideKept: args.levers.includes("stride") ? strideKept : null,
    passBoundariesMs: settleFrames
      .filter((f) => f.doneT !== null)
      .map((f) => f.doneT),
    passDurationsMs: settleFrames
      .filter((f) => f.doneT !== null)
      .map((f) => f.doneT - f.startT),
    settleFrameRays: [...new Set(settleFrames.map((f) => f.rays))],
    settleFrameCount: settleFrames.length,
    previewFrames: frames
      .filter((f) => !f.settle)
      .map((f) => ({
        rays: f.rays,
        budgetMs: f.budgetMs,
        startT: f.startT,
        doneT: f.doneT,
        truncated: f.done?.truncated ?? null,
        mediumDispatches: f.medium.dispatches,
        mediumWorkMs: f.medium.workMs,
      })),
    lanes: {
      medium: {
        ...medium,
        fenceShare:
          medium.wallMs > 0
            ? (medium.wallMs - medium.workMs) / medium.wallMs
            : null,
      },
      shade: sum("shade"),
      march: sum("march"),
    },
    frameDone: settleFrames.map((f) => f.done),
    mediumWidths: widths,
    mediumFit: fit,
    progressAt,
    census: lastProbe?.census
      ? {
          rays: lastProbe.census.rays,
          covered: lastProbe.census.covered,
          miss: lastProbe.census.miss,
          exhausted: lastProbe.census.exhausted,
        }
      : null,
    backend: lastProbe?.backend ?? null,
    engine: lastProbe?.engine ?? null,
    errors,
  };
  report.verdict = outcome;
  log(
    `${outcome} at ${(endT / 1000).toFixed(1)}s; passes ${report.result.passBoundariesMs.length}; medium dispatches ${medium.dispatches}; backend ${report.result.backend?.label}`,
  );
  process.exitCode = 0;
} catch (error) {
  report.verdict = "checking-failed";
  report.failure = error.stack ?? String(error);
  console.error(report.failure);
  process.exitCode = 2;
} finally {
  await browser?.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(args.out, `${args.label}.report.json`),
    JSON.stringify(report, null, 2),
  );
}
