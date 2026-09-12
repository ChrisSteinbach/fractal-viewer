/**
 * WHY FIREFOX'S CALIBRATED FENCE ROUND-TRIP IS SOMETIMES A LOW OUTLIER —
 * the app-free reproduction of the polling-tick-phase hypothesis behind
 * `surface-compute.ts`'s `ensureFenceCalibrated`.
 *
 * BACKGROUND. `surfaceComputeFenceRoundTripMs` (surface-compute.ts) takes
 * the MINIMUM of five back-to-back fenced null dispatches on a session's
 * first real dispatch, and subtracts it from every later dispatch's wall
 * time before the sizing models read it. Firefox resolves
 * `onSubmittedWorkDone` (and `mapAsync`) only when `WebGPUParent`'s
 * `MaintainDevices` timer fires — a ~100 ms poll (Mozilla bug 1870699),
 * not at submit time. Eight runs of the app's own calibration
 * (`scripts/surface-fence-cost.verify.mjs`) on this machine read 77.84,
 * 78.30, 18.64, 81.40, 37.18, 3.32, 59.04, 67.24 ms — a spread the tick
 * model predicts if the FIRST probe lands at a random phase of the poll
 * (uniform on (0, 100]) while every later back-to-back probe is
 * submitted right after the previous fence resolved ON a tick, so it
 * must wait a WHOLE tick (~100 ms) — making the five-probe minimum
 * almost always probe #1's random draw, not a stable platform constant.
 *
 * SELF-CONTAINED ON PURPOSE, modelled on
 * `scripts/webgpu-staging-ceiling.repro.mjs`: a routed one-line HTML page
 * on an `https:` origin, no build, no server, nothing borrowed from the
 * app but its adapter-selection flags. DEVIATION FROM THAT SCRIPT'S
 * DISCIPLINE, disclosed rather than silently copied: cells here open a
 * FRESH PAGE (fresh realm, fresh `requestDevice()`) per rep inside ONE
 * launched browser, not a fresh browser process per rep. The staging
 * repro needs a fresh process because a LOST device poisons a page and a
 * LEAKED one poisons the next arm; this question is about fence-timing
 * phase, which a fresh page's fresh device already isolates, and a
 * process-per-rep would have made the ~20-minute measurement here run
 * for hours.
 *
 * USAGE:
 *
 *   node scripts/webgpu-fence-phase.repro.mjs --browser=firefox --cells=a,b,c,d
 *   node scripts/webgpu-fence-phase.repro.mjs --browser=chrome --cells=a,b
 *
 * Flags: --browser=firefox|chrome (default firefox), --cells=a,b,c,d
 * (default a,b,c,d on firefox, a,b on chrome), --reps=N (default 20; d
 * defaults to 10 given its GPU-time cost), --display=:0, --headless.
 * Cell d calibrates its two GPU-work sizes (~5 ms, ~150 ms) with a
 * throwaway Chrome launch first, regardless of --browser, because Chrome's
 * own fence overhead is small enough to read GPU work time directly; it
 * accepts --iters5=N/--iters150=N to skip recalibrating.
 *
 * EXIT CODES: 0 = ran to completion (this is a measurement script, not a
 * pass/fail gate — read the printed tables). 2 = INCONCLUSIVE (no
 * adapter, or a software one). 1 = harness failure.
 *
 * ── MEASURED, this repository's AMD RX 7900 XTX, DISPLAY=:0, Firefox
 * 153.0 (Playwright's build) and Chrome 151 with the Vulkan flags ───────
 *
 * Adapter: Firefox reports no `adapter.info` fields (all empty strings,
 * as `webgpu-staging-ceiling.repro.mjs` already notes); Chrome reports
 * "amd rdna-3".
 *
 * CELL A — cold (random 0-250ms sleep, then 1+10 back-to-back probes),
 * 20 reps. FIREFOX (ms):
 *
 * | probe # |  1  |  2  |  3  |  4  |  5  |  6  |  7  |  8  |  9  | 10  | 11  |
 * | ------- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
 * | min     |  11 |  99 |  99 | 100 |  99 |  99 |  99 |  99 |  99 |  99 |  99 |
 * | median  |54.5 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
 * | max     |  99 | 104 | 101 | 112 | 101 | 101 | 109 | 112 | 101 | 111 | 101 |
 *
 * Probe #1 was the minimum of probes 1-5 in 20/20 reps. Current
 * calibration (min of 1-5): min=11 med=54.5 max=99. Alternative — skip
 * #1, take min of probes 2-6: min=99 med=100 max=100. CHROME, same cells
 * (ms): probe #1 min=2.1 med=2.55 max=11.7; probes #2-11 min in
 * 0.1-0.3, median ~2.5, max 3.4-6.8 throughout — no probe stands out, and
 * probe #1 was the minimum of 1-5 in only 6/20 reps (chance, not phase).
 *
 * CELL B — one unmeasured alignment fence, then per-delta aligned+delta
 * fenced dispatches, 100 samples/delta (20 reps x 5). FIREFOX busy-wait
 * (ms): delta=0 min=96 med=100 max=107; delta=5 min=93 med=95 max=100;
 * delta=20 min=79 med=80 max=86; delta=50 min=49 med=50 max=51. The
 * setTimeout variant is the same to within noise (delta=0 min=99 med=100
 * max=102; delta=50 min=49 med=50 max=56). wall ≈ 100 − delta holds
 * exactly across the whole range tested. CHROME: flat regardless of
 * delta (busy-wait medians 2.5/2.6/2.6/2.5 ms at delta=0/5/20/50) — no
 * tick to dodge, so nothing to subtract.
 *
 * CELL C — after mapAsync, Firefox, 200 samples (20 reps x 10): the
 * mapAsync round-trip itself reads min=93 med=100 max=111, and the
 * dispatch submitted immediately after reads min=99 med=100 max=111 —
 * indistinguishable from two back-to-back fenced dispatches. mapAsync
 * resolves on the same ~100ms timer.
 *
 * CELL D — real work, aligned (delta~0), Firefox, 10 reps x 3: ~5ms work
 * (ITERS=8000, calibrated in Chrome) read min=99 med=100 max=104 ms of
 * wall; ~150ms work (ITERS=1,900,000, measured 150.8ms in Chrome) read
 * min=200 med=200 max=206 ms of wall — one tick and two ticks exactly,
 * confirming wall = ceil((delta+W)/T)*T - delta at delta~0.
 *
 * IN-APP CONFIRMATION (Task 2 of the session that wrote this script):
 * every one of 9 `surface-fence-cost.verify.mjs` runs on this build
 * traced a `probes=` list of the exact same shape — one low, variable
 * first probe followed by four ~100ms probes — e.g.
 * `16.42,100.56,100.26,100.12,100.16` and `91.18,100.14,100.24,99.62,
 * 100.22`. Probe #1 was the reported minimum, and therefore the
 * session's whole `fenceMs`, in all 9 runs.
 *
 * VERDICT: CONFIRMED. Firefox's probe #1 (after a random 0-250ms sleep)
 * behaves like a draw from a wide, roughly-uniform window while probes
 * #2-#11 cluster tightly near one tick (~100 ms) with almost no low
 * outliers — so the five-probe minimum is overwhelmingly probe #1's
 * random-phase draw, not a stable platform constant, in BOTH the
 * app-free repro and the app's own gate. Aligning to a fence and adding
 * a small host delay delta subtracts near-exactly from the next fence's
 * wall time (wall = T - delta) across the whole 0-50ms range tested.
 * mapAsync resolves on the same timer as onSubmittedWorkDone. Real work
 * confirms wall = ceil((delta+W)/T)*T - delta at delta~0. So the ONE
 * unmeasured alignment fence the hypothesis proposes as a fix is sound:
 * skip probe #1 (or replace it with a throwaway dispatch before the
 * measured probes) and calibrate off the ALIGNED probes instead, which
 * cluster near a true tick rather than a random phase draw. Chrome shows
 * none of this: flat ~0.1-3.4ms fence cost regardless of alignment,
 * because there is no polling tick to dodge.
 *
 * WHAT THIS CHANGED: `surface-compute.ts`'s `ensureFenceCalibrated` now
 * times one leading, UNMEASURED alignment fence
 * (`SURFACE_COMPUTE_FENCE_ALIGNMENT_PROBES`) before its counted probes,
 * and `surfaceComputeFenceRoundTripMs` discards that leading sample before
 * taking the minimum of the rest — so the calibration's counted probes
 * are drawn from the same tick-aligned population as every real
 * frame-loop dispatch, instead of mixing in one random-phase draw.
 */
import { firefox, chromium } from "playwright-core";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const BROWSER = String(args.browser ?? "firefox");
const DISPLAY = args.display ?? ":0";
const CELLS = String(args.cells ?? (BROWSER === "chrome" ? "a,b" : "a,b,c,d"))
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const REPS = Number(args.reps ?? 20);
const REPS_D = Number(args.repsD ?? Math.min(REPS, 10));
const ORIGIN = "https://webgpu-fence-phase.test";
const SOFTWARE_RE = /swiftshader|llvmpipe|software|lavapipe|microsoft basic/i;

const log = (...a) => console.log("[fence-phase]", ...a);

/** The once-per-process quiet baseline `launchBrowser` awaits. */
let quietPromise = null;
function quietOnce() {
  quietPromise ??= quietBaseline(log).then((quiet) => {
    const contended = contendedReason(quiet);
    if (contended) {
      log(
        `UNCERTIFIED: another process was already on the GPU — ${contended};` +
          " do not read this run's timing rows.",
      );
    }
  });
  return quietPromise;
}
const round = (n) => Math.round(n * 100) / 100;

function stats(nums) {
  const xs = nums
    .filter((n) => Number.isFinite(n))
    .slice()
    .sort((a, b) => a - b);
  if (xs.length === 0) return { min: NaN, median: NaN, max: NaN, n: 0 };
  const mid = xs.length >> 1;
  const median = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return { min: xs[0], median, max: xs[xs.length - 1], n: xs.length };
}
const fmtStats = (s) =>
  `min=${round(s.min)} med=${round(s.median)} max=${round(s.max)} n=${s.n}`;

async function launchBrowser(name) {
  // The machine's conditions, taken ONCE before this probe puts its own
  // work on the GPU: every number here fences real dispatches, so a
  // contender on the ring bounds them too. Report-only — the probe's own
  // INCONCLUSIVE channel decides what its verdict is worth.
  await quietOnce();
  const env = { ...process.env, DISPLAY };
  if (name === "firefox") {
    return firefox.launch({
      executablePath: firefox.executablePath(),
      headless: Boolean(args.headless),
      env,
      firefoxUserPrefs: {
        "dom.webgpu.enabled": true,
        "gfx.webgpu.ignore-blocklist": true,
      },
    });
  }
  if (name === "chrome") {
    return chromium.launch({
      executablePath: "/usr/bin/google-chrome",
      headless: Boolean(args.headless),
      env,
      args: [
        "--enable-features=Vulkan",
        "--enable-unsafe-webgpu",
        "--ignore-gpu-blocklist",
      ],
    });
  }
  throw new Error(`--browser must be firefox or chrome, got ${name}`);
}

/** Fresh page per rep, inside ONE browser instance for the whole cell
 * (see the deviation note in the header). */
async function repIn(browser, body, arg) {
  const page = await browser.newPage();
  try {
    await page.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>fence phase probe</title>",
      }),
    );
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    return await page.evaluate(body, arg);
  } catch (error) {
    return { threw: String(error) };
  } finally {
    await page.close();
  }
}

/** Shared page-side preamble, serialized so it takes no closures. */
const PAGE_SETUP = `
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return { inconclusive: "no WebGPU adapter" };
  const label = [adapter.info?.description, adapter.info?.vendor, adapter.info?.architecture]
    .filter(Boolean).join(" ");
  const device = await adapter.requestDevice();
  const module = device.createShaderModule({ code: \`
@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= arrayLength(&data)) { return; }
  data[gid.x] = data[gid.x] * 1664525u + 1013904223u;
}\` });
  const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
  const target = device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: target } }] });
  const dispatch = () => {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(0, 0, 0);
    pass.end();
    device.queue.submit([enc.finish()]);
  };
  const fencedDispatch = async () => {
    const t0 = performance.now();
    dispatch();
    await device.queue.onSubmittedWorkDone();
    return performance.now() - t0;
  };
  const busyWait = (ms) => { const end = performance.now() + ms; while (performance.now() < end) {} };
`;

// ── Cell A: cold, random-phase-sleep then 1+10 back-to-back probes ──────
const cellABody = new Function(
  "opts",
  `return (async () => {
  ${PAGE_SETUP}
  await new Promise((r) => setTimeout(r, Math.random() * 250));
  const probes = [];
  for (let i = 0; i < 11; i++) probes.push(await fencedDispatch());
  return { label, probes };
})();`,
);

// ── Cell B: one unmeasured alignment fence, then per-delta aligned+delta
// fenced dispatches (busy-wait and setTimeout variants). ────────────────
const cellBBody = new Function(
  "opts",
  `return (async () => {
  const { deltas } = opts;
  ${PAGE_SETUP}
  await fencedDispatch(); // unmeasured alignment fence
  const busy = {};
  for (const d of deltas) {
    busy[d] = [];
    for (let k = 0; k < 5; k++) {
      if (d > 0) busyWait(d);
      busy[d].push(await fencedDispatch());
    }
  }
  await fencedDispatch(); // realign before the setTimeout variant
  const timer = {};
  for (const d of deltas) {
    timer[d] = [];
    for (let k = 0; k < 5; k++) {
      if (d > 0) await new Promise((r) => setTimeout(r, d));
      timer[d].push(await fencedDispatch());
    }
  }
  return { label, busy, timer };
})();`,
);

// ── Cell C: after mapAsync, does the SAME tick govern its resolution and
// the very next dispatch's fence? ────────────────────────────────────────
const cellCBody = new Function(
  "opts",
  `return (async () => {
  ${PAGE_SETUP}
  const src = device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const staging = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const mapMs = [];
  const nextDispatchMs = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, staging, 0, 256);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    mapMs.push(performance.now() - t0);
    staging.unmap();
    nextDispatchMs.push(await fencedDispatch());
  }
  return { label, mapMs, nextDispatchMs };
})();`,
);

// ── Cell D: real GPU work, submitted aligned (delta ~ 0). ───────────────
const cellDBody = new Function(
  "opts",
  `return (async () => {
  const { iters, workgroups } = opts;
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return { inconclusive: "no WebGPU adapter" };
  const label = [adapter.info?.description, adapter.info?.vendor, adapter.info?.architecture]
    .filter(Boolean).join(" ");
  const device = await adapter.requestDevice();
  const bufSize = workgroups * 64 * 4;
  const buf = device.createBuffer({ size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const results = {};
  for (const [name, itersN] of Object.entries(iters)) {
    const module = device.createShaderModule({ code: \`
override ITERS: u32 = 1000u;
@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= arrayLength(&data)) { return; }
  var v = data[gid.x];
  for (var i: u32 = 0u; i < ITERS; i = i + 1u) { v = v * 1664525u + 1013904223u; }
  data[gid.x] = v;
}\` });
    const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main", constants: { ITERS: itersN } } });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    const run = async () => {
      const t0 = performance.now();
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
      return performance.now() - t0;
    };
    await run(); // warmup / align
    const times = [];
    for (let k = 0; k < 3; k++) times.push(await run());
    results[name] = times;
  }
  return { label, results };
})();`,
);

/** One-time calibration in Chrome: find ITERS at a fixed workgroup count
 * whose fenced dispatch time is close to each target. Chrome's own fence
 * overhead (~2-3ms) is small enough that its wall time reads GPU work
 * directly. */
async function calibrateIters(workgroups, targets) {
  const browser = await launchBrowser("chrome");
  try {
    const page = await browser.newPage();
    await page.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>calib</title>",
      }),
    );
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    const out = await page.evaluate(
      new Function(
        "opts",
        `return (async () => {
    const { workgroups, targets } = opts;
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) return { inconclusive: "no WebGPU adapter" };
    const device = await adapter.requestDevice();
    const bufSize = workgroups * 64 * 4;
    const buf = device.createBuffer({ size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const measure = async (itersN) => {
      const module = device.createShaderModule({ code: \`
override ITERS: u32 = 1000u;
@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= arrayLength(&data)) { return; }
  var v = data[gid.x];
  for (var i: u32 = 0u; i < ITERS; i = i + 1u) { v = v * 1664525u + 1013904223u; }
  data[gid.x] = v;
}\` });
      const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main", constants: { ITERS: itersN } } });
      const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
      const run = async () => {
        const t0 = performance.now();
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(workgroups);
        pass.end();
        device.queue.submit([enc.finish()]);
        await device.queue.onSubmittedWorkDone();
        return performance.now() - t0;
      };
      await run();
      return await run();
    };
    const out = {};
    for (const [name, targetMs] of Object.entries(targets)) {
      let iters = 2000;
      let ms = 0;
      for (let attempt = 0; attempt < 6; attempt++) {
        ms = await measure(iters);
        if (ms <= 0.001) { iters *= 8; continue; }
        const ratio = targetMs / ms;
        const nextIters = Math.max(1, Math.round(iters * ratio));
        if (attempt === 5) break;
        iters = nextIters;
      }
      out[name] = { iters, measuredMs: ms };
    }
    return out;
  })();`,
      ),
      { workgroups, targets },
    );
    return out;
  } finally {
    await browser.close();
  }
}

async function runCellA(browser) {
  const label = "A cold (random 0-250ms sleep, 11 back-to-back probes)";
  const allProbes = [];
  let adapterLabel = null;
  let inconclusive = null;
  for (let r = 0; r < REPS; r++) {
    const out = await repIn(browser, cellABody, {});
    if (out.inconclusive) inconclusive ??= out.inconclusive;
    if (out.threw) {
      log(`  A rep ${r} threw: ${out.threw}`);
      continue;
    }
    if (out.label !== undefined && !adapterLabel) adapterLabel = out.label;
    if (out.probes) allProbes.push(out.probes);
  }
  if (inconclusive) return { inconclusive };
  log(`-- ${label} --  reps=${allProbes.length}`);
  log(`adapter: ${adapterLabel || "(none reported)"}`);
  for (let i = 0; i < 11; i++) {
    const col = allProbes.map((p) => p[i]);
    log(`  probe #${String(i + 1).padStart(2)}: ${fmtStats(stats(col))}`);
  }
  let firstIsMinOfFive = 0;
  const min5current = [];
  const min5aligned = [];
  for (const p of allProbes) {
    const first5 = p.slice(0, 5);
    if (Math.min(...first5) === p[0]) firstIsMinOfFive++;
    min5current.push(Math.min(...first5));
    min5aligned.push(Math.min(...p.slice(1, 6)));
  }
  log(
    `  probe#1 is the min of probes 1-5 in ${firstIsMinOfFive}/${allProbes.length} reps`,
  );
  log(
    `  current calibration (min of probes 1-5):  ${fmtStats(stats(min5current))}`,
  );
  log(
    `  alt: skip #1, min of probes 2-6:           ${fmtStats(stats(min5aligned))}`,
  );
  return {
    adapterLabel,
    allProbes,
    firstIsMinOfFive,
    min5current,
    min5aligned,
  };
}

async function runCellB(browser) {
  const deltas = [0, 5, 20, 50];
  const label = "B aligned + delta (busy-wait and setTimeout variants)";
  const busyByDelta = Object.fromEntries(deltas.map((d) => [d, []]));
  const timerByDelta = Object.fromEntries(deltas.map((d) => [d, []]));
  let adapterLabel = null;
  let inconclusive = null;
  for (let r = 0; r < REPS; r++) {
    const out = await repIn(browser, cellBBody, { deltas });
    if (out.inconclusive) inconclusive ??= out.inconclusive;
    if (out.threw) {
      log(`  B rep ${r} threw: ${out.threw}`);
      continue;
    }
    if (out.label !== undefined && !adapterLabel) adapterLabel = out.label;
    if (out.busy) for (const d of deltas) busyByDelta[d].push(...out.busy[d]);
    if (out.timer)
      for (const d of deltas) timerByDelta[d].push(...out.timer[d]);
  }
  if (inconclusive) return { inconclusive };
  log(`-- ${label} --`);
  log(`adapter: ${adapterLabel || "(none reported)"}`);
  for (const d of deltas) {
    log(
      `  delta=${String(d).padStart(3)}ms busy-wait:  ${fmtStats(stats(busyByDelta[d]))}`,
    );
  }
  for (const d of deltas) {
    log(
      `  delta=${String(d).padStart(3)}ms setTimeout:  ${fmtStats(stats(timerByDelta[d]))}`,
    );
  }
  return { adapterLabel, busyByDelta, timerByDelta };
}

async function runCellC(browser) {
  const label = "C after mapAsync";
  const mapMsAll = [];
  const nextAll = [];
  let adapterLabel = null;
  let inconclusive = null;
  for (let r = 0; r < REPS; r++) {
    const out = await repIn(browser, cellCBody, {});
    if (out.inconclusive) inconclusive ??= out.inconclusive;
    if (out.threw) {
      log(`  C rep ${r} threw: ${out.threw}`);
      continue;
    }
    if (out.label !== undefined && !adapterLabel) adapterLabel = out.label;
    if (out.mapMs) mapMsAll.push(...out.mapMs);
    if (out.nextDispatchMs) nextAll.push(...out.nextDispatchMs);
  }
  if (inconclusive) return { inconclusive };
  log(`-- ${label} --`);
  log(`adapter: ${adapterLabel || "(none reported)"}`);
  log(`  mapAsync round-trip:               ${fmtStats(stats(mapMsAll))}`);
  log(`  immediately-following dispatch:    ${fmtStats(stats(nextAll))}`);
  return { adapterLabel, mapMsAll, nextAll };
}

async function runCellD(browser) {
  const workgroups = 4096;
  log(`-- D real work (workgroups=${workgroups}), calibrating in Chrome --`);
  let iters5 = args.iters5 ? Number(args.iters5) : null;
  let iters150 = args.iters150 ? Number(args.iters150) : null;
  if (!iters5 || !iters150) {
    const calib = await calibrateIters(workgroups, { five: 5, oneFifty: 150 });
    if (calib.inconclusive) return { inconclusive: calib.inconclusive };
    iters5 ??= calib.five.iters;
    iters150 ??= calib.oneFifty.iters;
    log(
      `  calibration: five -> ITERS=${calib.five.iters} measured=${round(calib.five.measuredMs)}ms; ` +
        `oneFifty -> ITERS=${calib.oneFifty.iters} measured=${round(calib.oneFifty.measuredMs)}ms`,
    );
  }
  const iters = { five: iters5, oneFifty: iters150 };
  const allFive = [];
  const allOneFifty = [];
  let adapterLabel = null;
  let inconclusive = null;
  for (let r = 0; r < REPS_D; r++) {
    const out = await repIn(browser, cellDBody, { iters, workgroups });
    if (out.inconclusive) inconclusive ??= out.inconclusive;
    if (out.threw) {
      log(`  D rep ${r} threw: ${out.threw}`);
      continue;
    }
    if (out.label !== undefined && !adapterLabel) adapterLabel = out.label;
    if (out.results) {
      allFive.push(...out.results.five);
      allOneFifty.push(...out.results.oneFifty);
    }
  }
  if (inconclusive) return { inconclusive };
  log(`adapter: ${adapterLabel || "(none reported)"}`);
  log(`  ~5ms work (ITERS=${iters5}):    ${fmtStats(stats(allFive))}`);
  log(`  ~150ms work (ITERS=${iters150}): ${fmtStats(stats(allOneFifty))}`);
  return { adapterLabel, allFive, allOneFifty, iters5, iters150 };
}

try {
  log(
    `browser=${BROWSER} cells=${CELLS.join(",")} reps=${REPS} repsD=${REPS_D}`,
  );
  const browser = await launchBrowser(BROWSER);
  const results = {};
  let inconclusive = null;
  let adapterLabel = null;
  try {
    if (CELLS.includes("a")) results.a = await runCellA(browser);
    if (CELLS.includes("b")) results.b = await runCellB(browser);
    if (CELLS.includes("c")) results.c = await runCellC(browser);
    if (CELLS.includes("d")) results.d = await runCellD(browser);
  } finally {
    await browser.close();
  }
  for (const r of Object.values(results)) {
    if (r?.inconclusive) inconclusive ??= r.inconclusive;
    if (r?.adapterLabel && !adapterLabel) adapterLabel = r.adapterLabel;
  }
  if (inconclusive) {
    log(`INCONCLUSIVE: ${inconclusive}`);
    process.exit(2);
  }
  if (adapterLabel && SOFTWARE_RE.test(adapterLabel)) {
    log(
      "INCONCLUSIVE: software adapter — this says nothing about a real device",
    );
    process.exit(2);
  }
  log("DONE");
  process.exit(0);
} catch (error) {
  log("FAIL:", error);
  process.exit(1);
}
