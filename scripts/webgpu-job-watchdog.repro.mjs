/**
 * WHAT UNIT DOES THE GPU'S JOB TIMEOUT SEE — THE DISPATCH, OR THE FENCE
 * GROUP? The app-free reproduction, and the executable record behind the
 * compute renderer's submission-time bound.
 *
 * SELF-CONTAINED ON PURPOSE, in the spirit of
 * `scripts/webgpu-staging-ceiling.repro.mjs`: no build, no server and none
 * of this app. The page is a routed one-line HTML document on an `https://`
 * origin Playwright fulfils itself, so what it measures is the BROWSER AND
 * THE DRIVER and cannot be blamed on a renderer. Every rep launches a fresh
 * browser — a lost device poisons its page, and a leaked one poisons the
 * next arm.
 *
 *   export XAUTHORITY=$(ls -t /run/user/$(id -u)/.mutter-Xwaylandauth.* | head -1)
 *   node scripts/webgpu-job-watchdog.repro.mjs --display=:0
 *   node scripts/webgpu-job-watchdog.repro.mjs --display=:0 --arm=group --totalMs=3000 --groups=6
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────
 *
 * A 1920x1057 cathedral settle on the RX 7900 XTX lost its device at 182 s
 * with `amdgpu: ring gfx_0.0.0 timeout ... Process chrome`, while the
 * renderer's own `?surfacetrace` reported a worst per-dispatch time of
 * 40 ms against a 50 ms target. Something the driver timed was three
 * orders of magnitude off what the instrument reported, and until that is
 * explained every dispatch-width bound in `surface-compute.ts` is set
 * against a number that does not bound the thing that kills the device.
 *
 * The kernel line carries half the answer already. `signaled seq=17130178,
 * emitted seq=17130179` is a gap of ONE: exactly one job was emitted and
 * unsignaled when the watchdog fired. A backlog of queued submissions
 * waiting behind one `onSubmittedWorkDone` would have shown a gap of as
 * many jobs as were queued. So the killer is ONE job that ran long, and
 * the question narrows to what a job IS, and to how long one may run —
 * which is what this probe asks.
 *
 * ── THE ARMS ────────────────────────────────────────────────────────────
 *
 * Every arm spends the SAME total GPU time. They differ only in how that
 * total is handed to the queue, which is the whole question.
 *
 * `--arm=calibrate` — how long is one unit of spin? Fits GPU time against
 * the kernel's iteration count so every other arm asks for a duration
 * rather than a magic number. Never hangs anything.
 *
 * `--arm=single`  — ONE submit carrying the whole total.
 * `--arm=serial`  — `--groups` submits, EACH awaited on its own fence.
 * `--arm=group`   — `--groups` submits, ALL behind ONE fence. The app's
 *                   fence group.
 * `--arm=multicb` — ONE `queue.submit([cb1..cbK])` of `--groups` command
 *                   buffers. Separates "several submit calls" from
 *                   "several command buffers", which WebGPU lets a caller
 *                   confuse.
 *
 * ── WHAT IT MEASURED — 12 September 2026, RX 7900 XTX, Chrome on :0 ─────
 *
 * WebGPU adapter `amd rdna-3`, HEADED on the real display (Chrome exposes
 * no adapter headless on this box), kernel 7.0.0-29. Every row is a fresh
 * browser. `ring` is what `journalctl -k` recorded during that row.
 *
 *   arm      shape          total    outcome              ring
 *   single   1 x 2000ms     2000ms   survived (fence 2004) clean
 *   single   1 x 3000ms     3000ms   DIED                  gfx reset
 *   single   1 x 6000ms     6000ms   DIED                  gfx reset
 *   serial   6 x  500ms     3000ms   survived              clean
 *   serial   6 x  667ms     4002ms   survived              clean
 *   serial   6 x 1000ms     6000ms   survived              clean
 *   group    3 x  500ms     1500ms   survived              clean
 *   group    6 x  250ms     1500ms   survived              clean
 *   group    2 x  900ms     1800ms   survived              clean
 *   group    2 x 1000ms     2000ms   survived              clean
 *   group    2 x 1200ms     2400ms   survived              clean
 *   group    2 x 1400ms     2800ms   survived              clean
 *   group    2 x 1500ms     3000ms   DIED 4 of 5 runs      clean
 *   group    6 x  500ms     3000ms   DIED 1 of 2 runs      clean
 *   group   12 x  250ms     3000ms   DIED                  clean
 *   group    6 x  667ms     4002ms   survived              clean
 *   group    6 x 1000ms     6000ms   DIED                  clean
 *   group   12 x  500ms     6000ms   DIED                  clean
 *   multicb  6 x  500ms     3000ms   DIED at 2042ms        gfx reset
 *   multicb  6 x  667ms     4002ms   DIED at 2033ms        gfx reset
 *   multicb  6 x 1000ms     6000ms   DIED at 2063ms        gfx reset
 *
 * FOUR VERDICTS.
 *
 * 1. A SINGLE DRIVER JOB IS CUT AT ~2.0 s, not the 10 s amdgpu nominally
 *    gives its gfx ring. `single` survives 2000 ms (fence 2004 ms) and
 *    dies at 3000 ms; `multicb` dies 2033, 2042 and 2063 ms into payloads
 *    of 4002, 3000 and 6000 ms — the SAME instant regardless of how much
 *    work was behind it, which is what a fixed deadline looks like. This
 *    is the sharp, reproducible number, and it is a MACHINE's number: read
 *    it off the device in front of you, never off the driver's documented
 *    default.
 *
 * 2. K COMMAND BUFFERS IN ONE `submit()` ARE ONE DRIVER JOB. That is the
 *    whole of why `multicb` dies where `group` — the same K dispatches,
 *    the same total, K separate `submit()` calls — does not.
 *    `surface-compute.ts` submits one command buffer per submit, so it is
 *    clear of this; a caller that ever batches command buffers to "save
 *    submissions" would be walking straight into it.
 *
 * 3. THE FENCE GROUP IS NOT THE WATCHDOG'S UNIT. K separate submissions
 *    behind one `onSubmittedWorkDone` are K jobs with K deadlines: 4002 ms
 *    of it survives, and 6000 ms survives when each second is fenced. The
 *    prior reading — that a queued backlog accumulates into one job — is
 *    REFUTED here and was already refuted by the kernel line that prompted
 *    this work: `signaled seq=17130178, emitted seq=17130179` is a gap of
 *    ONE, one job outstanding, not a backlog of them.
 *
 * 4. BUT AN UNFENCED INTERVAL STILL DIES NEAR 3 s, AND NOT CLEANLY. Every
 *    `group` death above is at a total of 3000 ms or more, leaves NOTHING
 *    in the kernel log, and lands at the moment the interval's work would
 *    have COMPLETED (2987, 2997, 2999, 3002, 3006, 5927, 5930 ms) rather
 *    than at a deadline part-way through it. It is intermittent — 2x1500ms
 *    died on four runs of five, 6x500ms on one of two, and 6x667ms not at
 *    all. THE LIKELIEST READING IS THAT THE APP DOES NOT CONTROL HOW MUCH
 *    OF ITS BACKLOG REACHES THE RING AT ONCE: submissions the host issues
 *    together may be batched into one busy period against verdict 1's
 *    deadline, or spread out, and which of those happens is not the
 *    caller's to decide. That is not proven here and is named as an open
 *    question, not a mechanism.
 *
 *    SO THE PRUDENT BOUND IS VERDICT 1'S, APPLIED TO THE WHOLE INTERVAL:
 *    hold the GPU work queued between two fences to the ~2 s a single job
 *    gets, because the driver may treat it as one. At the project's usual
 *    4x watchdog margin that is ~500 ms per fence interval, which the
 *    shipped `SURFACE_COMPUTE_FENCE_GROUP_MS` of 300 ms already respects —
 *    PROVIDED the prediction it sizes against is right, which is precisely
 *    what failed.
 *
 * TWO FAILURE SIGNATURES, AND ONLY ONE REACHES THE JOURNAL. An over-long
 * single job takes the logged `ring gfx_0.0.0 timeout ... Ring reset
 * succeeded` path. An over-long interval loses the device with `A valid
 * external Instance reference no longer exists.` and writes NOTHING to the
 * kernel log — so a session that reads the journal to decide whether the
 * driver was involved will conclude it was not. Do not read the quiet one
 * as a different bug, and do not read a clean journal as a clean run.
 *
 * ── WHAT THIS SAYS ABOUT THE RENDERER ───────────────────────────────────
 *
 * THE CEILING IS ~2.0 s AND THE LADDERS AIM AT 50 ms, so the shipped
 * widths are nowhere near it and this measurement does not, by itself,
 * ask for one of them to move. What it moves is what the numbers MEAN.
 *
 * `surface-compute.ts` paces its ladders on `groupWorkMs / members` — a
 * group's wall divided by how many dispatches shared it — on the stated
 * grounds that "the watchdog sees dispatches, not groups". That reading
 * survives verdict 3 and only verdict 3: the dispatches really are
 * separate jobs. But the quantity the deadline is denominated in is the
 * INTERVAL's, so the per-dispatch share understates it by the group size,
 * and the frame's seed submits — which ride the first fence untracked —
 * are not in the divisor at all. A ladder may keep stepping per member;
 * what must be held against ~2 s is the group's own `workMs`, which
 * nothing reads today.
 *
 * AND AN INSTRUMENT BUILT ON FENCES CANNOT SEE ITS OWN FATAL DISPATCH.
 * Every number the renderer records is taken when a fence resolves. The
 * submission that kills the device never resolves, so it is never
 * recorded, and "the worst dispatch we measured was 40 ms" is a statement
 * about the survivors alone. That is the gap this probe was written to
 * explain, and it does not close by making the existing number more
 * accurate.
 *
 * `timestamp-query` IS AVAILABLE ON THIS STACK — this probe reads it, and
 * its GPU-side figures track the host's fence wall to within 7 ms — and it
 * is the right instrument: a pass's own begin-to-end ON THE DEVICE, in the
 * currency the deadline is denominated in, with nothing split or
 * subtracted. The renderer has none of it today, and a trace line written
 * at SUBMIT rather than at the fence is the cheaper half of the same fix:
 * it costs nothing and it names the dispatch a lost device died on.
 *
 * ── EXIT CODES ──────────────────────────────────────────────────────────
 *
 * 3 = REPRODUCED: an interval over the ceiling killed the device while the
 *     same work serially fenced did not. The expected verdict, and the
 *     rows above still stand.
 * 0 = CLEAN: no arm could kill a device. The browser, the driver or the
 *     machine changed, and the ceiling above is due a re-measurement.
 * 2 = INCONCLUSIVE: no adapter, or a software one. Chrome exposes no
 *     WebGPU adapter headless on this box, so this probe is HEADED ONLY —
 *     which is also how the app failed.
 * 1 = harness failure.
 *
 * RUN IT ON A QUIET MACHINE, and expect ring resets: hanging the GPU is
 * the point. Every reset on this box has recovered ("device wedged, but
 * recovered through reset"), but a wedged GPU can still take a desktop
 * session with it, so do not run it over work you have not saved.
 */

import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`Invalid argument ${a}`);
    return [m[1], m[2] ?? "1"];
  }),
);

const ARM = String(args.arm ?? "all");
const DISPLAY = args.display === undefined ? null : String(args.display);
const TOTAL_MS = Number(args.totalMs ?? 3000);
const GROUPS = Number(args.groups ?? 6);
const SETTLE_MS = Number(args.settleMs ?? 1500);
/** Any origin will do — nothing is served from it. It only has to be
 * `https:` so the page is a secure context and `navigator.gpu` exists. */
const ORIGIN = "https://webgpu-job-watchdog.test";
const SOFTWARE_RE = /swiftshader|llvmpipe|software|lavapipe|microsoft basic/i;

const log = (...a) => console.log("[job-watchdog]", ...a);

/** Fixed invocation count for every spin dispatch, so the ONLY thing that
 * moves a dispatch's duration is the iteration count the arms solve for.
 * 256 workgroups keeps the whole device busy without making the dispatch
 * so wide that occupancy rather than the loop sets the time. */
const SPIN_WORKGROUPS = 256;

function launch() {
  const env = { ...process.env };
  const flags = [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--ignore-gpu-blocklist",
    "--ignore-certificate-errors",
    "--no-sandbox",
    // The GPU-side begin/end this probe exists to read. Without it Chrome
    // exposes no `timestamp-query` feature and instrument 3 goes silent.
    "--enable-dawn-features=allow_unsafe_apis",
  ];
  if (DISPLAY !== null) {
    env.DISPLAY = DISPLAY;
    return chromium.launch({
      executablePath: chromium.executablePath(),
      headless: false,
      env,
      args: ["--ozone-platform=x11", ...flags],
    });
  }
  return chromium.launch({
    executablePath: chromium.executablePath(),
    headless: true,
    env,
    args: flags,
  });
}

/** One rep: a fresh browser, a fresh page, one call into `body`, and the
 * kernel's own account of what happened while it ran. */
async function rep(body, arg) {
  const since = Math.floor(Date.now() / 1000) - 2;
  const browser = await launch();
  // A device can be lost without a ring reset, and when it is, the reason
  // is browser-side. `disconnected` is the one that separates "Chrome gave
  // up on its GPU process" from anything the kernel did.
  const stderr = [];
  browser.on("disconnected", () => stderr.push("browser disconnected"));
  let out;
  try {
    const page = await browser.newPage();
    page.on("crash", () => stderr.push("page crashed"));
    page.on("pageerror", (e) =>
      stderr.push(`pageerror ${String(e).slice(0, 120)}`),
    );
    await page.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>webgpu job watchdog probe</title>",
      }),
    );
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    out = await page.evaluate(body, arg);
  } catch (error) {
    out = { threw: String(error) };
  } finally {
    await browser.close().catch(() => {});
  }
  out.ring = await ringResets(since);
  out.stderr = stderr;
  return out;
}

/**
 * `ring <name> timeout, signaled seq=A, emitted seq=B` lines since `since`.
 * `B - A` is how many jobs the ring held emitted-but-unsignaled when it
 * gave up, so it is the direct answer to whether K submissions became one
 * job or K. Absence of the journal is not a finding — it is reported as
 * `null` so a verdict never rests on an instrument that was not there.
 *
 * THE WINDOW IS EPOCH SECONDS, NOT A FORMATTED STAMP. `journalctl --since`
 * reads a bare timestamp as LOCAL time, so handing it a UTC string opened
 * the window two hours early on this box and every arm read the previous
 * arm's reset as its own — which briefly turned a clean group run into a
 * reproduction.
 */
async function ringResets(since) {
  try {
    const { stdout } = await execFileAsync(
      "journalctl",
      ["-k", `--since=@${since}`],
      { maxBuffer: 8 << 20 },
    );
    const hits = [];
    const re = /ring (\S+) timeout, signaled seq=(\d+), emitted seq=(\d+)/g;
    let m;
    while ((m = re.exec(stdout)) !== null) {
      hits.push({ ring: m[1], gap: Number(m[3]) - Number(m[2]) });
    }
    return hits;
  } catch {
    return null;
  }
}

/**
 * Shared page-side preamble: a device, its loss/error latches, a spin
 * pipeline whose duration is a uniform, and the timestamp machinery when
 * the browser has it. Serialized into the page, so it takes no closures.
 *
 * THE LOOP MUST NOT BE OPTIMIZED AWAY. Every iteration feeds the next
 * through a transcendental and the result reaches a storage buffer, so no
 * compiler can hoist it; and the trip count is a UNIFORM, so none can
 * unroll the loop into a constant.
 */
const PAGE_SETUP = `
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return { inconclusive: "no WebGPU adapter" };
  const label = [adapter.info?.description, adapter.info?.vendor, adapter.info?.architecture]
    .filter(Boolean).join(" ");
  const hasTs = adapter.features.has("timestamp-query");
  const device = await adapter.requestDevice(hasTs ? { requiredFeatures: ["timestamp-query"] } : {});
  let lost = null;
  device.lost.then((e) => { lost = e.reason ? e.reason + ": " + e.message : e.message; });
  const errors = [];
  device.addEventListener("uncapturederror", (e) => errors.push(String(e.error?.message ?? e.error)));
  const module = device.createShaderModule({ code: \`
struct Spin { iters: u32 };
@group(0) @binding(0) var<storage, read_write> data: array<f32>;
@group(0) @binding(1) var<uniform> spin: Spin;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x % arrayLength(&data);
  var acc = f32(i) * 0.001 + 1.0;
  for (var k = 0u; k < spin.iters; k = k + 1u) {
    acc = fract(sin(acc * 12.9898 + f32(k) * 0.017) * 43758.5453) + 0.5;
  }
  data[i] = acc;
}\` });
  const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
  const data = device.createBuffer({ size: 64 * 1024, usage: GPUBufferUsage.STORAGE });
  const spin = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: data } },
    { binding: 1, resource: { buffer: spin } },
  ] });
  const WORKGROUPS = ${SPIN_WORKGROUPS};
  const setIters = (n) => device.queue.writeBuffer(spin, 0, new Uint32Array([n, 0, 0, 0]));

  // GPU-side begin/end per pass, when the browser exposes it. Two
  // timestamps per pass; 64 passes is far more than any arm records.
  const tsCapacity = 128;
  const tsSet = hasTs ? device.createQuerySet({ type: "timestamp", count: tsCapacity }) : null;
  const tsResolve = hasTs ? device.createBuffer({ size: tsCapacity * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
  const tsRead = hasTs ? device.createBuffer({ size: tsCapacity * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : null;
  let tsNext = 0;

  /** One encoder, one compute pass, one dispatch — submitDispatch's
   * shape in surface-compute.ts, with a timestamp pair when available. */
  const encodeSpin = () => {
    const enc = device.createCommandEncoder();
    const slot = hasTs && tsNext + 2 <= tsCapacity ? tsNext : -1;
    if (slot >= 0) tsNext += 2;
    const pass = enc.beginComputePass(slot >= 0
      ? { timestampWrites: { querySet: tsSet, beginningOfPassWriteIndex: slot, endOfPassWriteIndex: slot + 1 } }
      : {});
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(WORKGROUPS);
    pass.end();
    return enc.finish();
  };

  /** Milliseconds of GPU time per recorded pass, read after the fence.
   * The watchdog's own currency: nothing on the host is subtracted or
   * split, because this is the pass's own begin-to-end on the device. */
  const readTimestamps = async () => {
    if (!hasTs || tsNext === 0) return null;
    const enc = device.createCommandEncoder();
    enc.resolveQuerySet(tsSet, 0, tsNext, tsResolve, 0);
    enc.copyBufferToBuffer(tsResolve, 0, tsRead, 0, tsNext * 8);
    device.queue.submit([enc.finish()]);
    await tsRead.mapAsync(GPUMapMode.READ, 0, tsNext * 8);
    const raw = new BigUint64Array(tsRead.getMappedRange(0, tsNext * 8).slice(0));
    tsRead.unmap();
    const out = [];
    for (let i = 0; i + 1 < tsNext; i += 2) out.push(Number(raw[i + 1] - raw[i]) / 1e6);
    return out;
  };
`;

/**
 * CALIBRATION. Doubles the iteration count until one dispatch clears
 * `probeMs`, then reports the measured per-iteration slope so every other
 * arm can ask for a duration. Deliberately stops well short of anything
 * that could wedge the ring.
 */
const calibrateBody = new Function(
  "opts",
  `return (async () => {
  ${PAGE_SETUP}
  const { probeMs } = opts;
  const rows = [];
  let iters = 256;
  let ms = 0;
  for (let step = 0; step < 24 && ms < probeMs; step++) {
    setIters(iters);
    const t0 = performance.now();
    device.queue.submit([encodeSpin()]);
    await device.queue.onSubmittedWorkDone();
    ms = performance.now() - t0;
    rows.push({ iters, ms });
    if (lost) break;
    if (ms < probeMs) iters *= 2;
  }
  const gpu = await readTimestamps();
  return { label, hasTs, rows, gpu, msPerIter: ms / iters, lost, errors };
})()`,
);

/**
 * THE THREE HANGING ARMS, one body. `mode` alone separates them, which is
 * the point — they must differ only in how the SAME total work is handed
 * to the queue, never in how much of it there is.
 */
const runBody = new Function(
  "opts",
  `return (async () => {
  ${PAGE_SETUP}
  const { mode, iters, pieces, settleMs } = opts;
  setIters(iters);
  const submitMs = [];
  let fenceMs = null;
  let lostMs = null;
  let threw = null;
  const t0 = performance.now();
  try {
    if (mode === "multicb") {
      // K command buffers, ONE submit call.
      const cbs = [];
      for (let i = 0; i < pieces; i++) cbs.push(encodeSpin());
      const s0 = performance.now();
      device.queue.submit(cbs);
      submitMs.push(performance.now() - s0);
    } else if (mode === "serial") {
      // THE CONTROL: K submissions, each fenced ON ITS OWN. Same total
      // work in the same window, no queued backlog at any moment. If this
      // dies too, the quantity at issue is sustained OCCUPANCY and not
      // anything about how the app groups its fences.
      for (let i = 0; i < pieces; i++) {
        const s0 = performance.now();
        device.queue.submit([encodeSpin()]);
        submitMs.push(performance.now() - s0);
        const step = await Promise.race([
          device.queue.onSubmittedWorkDone().then(() => "fence"),
          device.lost.then(() => "lost"),
        ]);
        if (step === "lost") break;
      }
    } else {
      // K separate submit calls (pieces === 1 is the single arm).
      for (let i = 0; i < pieces; i++) {
        const s0 = performance.now();
        device.queue.submit([encodeSpin()]);
        submitMs.push(performance.now() - s0);
      }
    }
    // ONE fence behind all of it — surface-compute.ts's fence group.
    // RACED AGAINST THE LOSS: a wedged ring never signals, so an
    // unraced await here hangs the rep instead of reporting it.
    const outcome = await Promise.race([
      device.queue.onSubmittedWorkDone().then(() => "fence"),
      device.lost.then(() => "lost"),
    ]);
    if (outcome === "fence") fenceMs = performance.now() - t0;
    else lostMs = performance.now() - t0;
  } catch (error) {
    threw = String(error);
  }
  let gpu = null;
  try { gpu = await readTimestamps(); } catch (error) { gpu = { threw: String(error) }; }
  // A loss lands asynchronously; give it the ticks it needs before reporting.
  await new Promise((r) => setTimeout(r, settleMs));
  return { label, hasTs, mode, pieces, submitMs, fenceMs, lostMs, gpu, lost, errors, threw };
})()`,
);

const dead = (o) => Boolean(o.lost || o.threw || o.errors?.length);
const ringLine = (o) =>
  o.ring === null
    ? " ring=?"
    : o.ring.length === 0
      ? " ring=clean"
      : ` ring=${o.ring.map((r) => `${r.ring}(gap=${r.gap})`).join(",")}`;

/** One line of verdict for a rep: what happened, when, and on whose
 * authority — the browser's latch, the kernel's ring, and the device's own
 * timestamps, never just the first of those. */
function outcomeLine(o) {
  return (
    `${dead(o) ? "DIED" : "survived"}` +
    ` fence=${o.fenceMs === null ? "never" : o.fenceMs.toFixed(0) + "ms"}` +
    (o.lostMs === null || o.lostMs === undefined
      ? ""
      : ` lostAt=${o.lostMs.toFixed(0)}ms`) +
    gpuLine(o) +
    ringLine(o) +
    (o.errors?.length ? `  errors=${o.errors.join(" | ")}` : "") +
    (o.stderr?.length ? `  stderr=${o.stderr.slice(-3).join(" | ")}` : "") +
    (o.threw ? `  threw=${o.threw}` : "") +
    (o.lost ? `  lost=${o.lost}` : "")
  );
}

function gpuLine(o) {
  if (!Array.isArray(o.gpu) || o.gpu.length === 0) return "";
  const worst = Math.max(...o.gpu);
  const total = o.gpu.reduce((a, b) => a + b, 0);
  return ` gpuPasses=${o.gpu.length} worstPass=${worst.toFixed(0)}ms totalGpu=${total.toFixed(0)}ms`;
}

let adapterLabel = "";
let inconclusive = null;

function note(o) {
  if (o.inconclusive) inconclusive ??= o.inconclusive;
  if (o.label && !adapterLabel) adapterLabel = o.label;
}

async function main() {
  log(`arm=${ARM} totalMs=${TOTAL_MS} groups=${GROUPS}`);

  // Every arm needs the calibration, so it always runs first.
  const cal = await rep(calibrateBody, { probeMs: 400 });
  note(cal);
  if (cal.inconclusive) {
    log(`INCONCLUSIVE: ${cal.inconclusive}`);
    process.exit(2);
  }
  log(`adapter: ${cal.label}  timestamp-query=${cal.hasTs ? "yes" : "NO"}`);
  if (SOFTWARE_RE.test(cal.label ?? "")) {
    log(
      "INCONCLUSIVE: software adapter — this says nothing about a real device",
    );
    process.exit(2);
  }
  if (!Number.isFinite(cal.msPerIter) || cal.msPerIter <= 0) {
    log("INCONCLUSIVE: calibration produced no slope");
    process.exit(2);
  }
  const itersFor = (ms) => Math.max(256, Math.round(ms / cal.msPerIter));
  log(
    `  slope: ${(cal.msPerIter * 1000).toFixed(3)} us/iteration at ${SPIN_WORKGROUPS} workgroups`,
  );
  if (ARM === "calibrate") process.exit(0);

  /** One arm at `--totalMs`, split `pieces` ways. */
  const arm = async (mode, pieces) => {
    const each = Math.round(TOTAL_MS / pieces);
    const o = await rep(runBody, {
      mode,
      iters: itersFor(each),
      pieces,
      settleMs: SETTLE_MS,
    });
    note(o);
    log(
      `${mode.padEnd(7)} ${pieces}x${each}ms=${each * pieces}ms  ${outcomeLine(o)}`,
    );
    return o;
  };

  // A named arm runs alone and reports; only `all` reaches a verdict,
  // because a verdict needs the serial control beside the grouped one.
  // `single` is the arm that takes a full ring reset every time it lands,
  // so it is never part of `all`.
  if (ARM !== "all") {
    await arm(ARM, ARM === "single" ? 1 : GROUPS);
    process.exit(0);
  }

  // THE PAIR THAT DECIDES IT: the same total, fenced per piece and fenced
  // once. Nothing else about them differs.
  const serial = await arm("serial", GROUPS);
  const group = await arm("group", GROUPS);
  const multicb = await arm("multicb", GROUPS);

  if (inconclusive) {
    log(`INCONCLUSIVE: ${inconclusive}`);
    process.exit(2);
  }
  // `multicb` is reported but never decides the verdict: it answers a
  // different question (what a JOB is) and its ceiling is the lower of the
  // two, so it dies on totals the interval survives.
  log(
    `multicb carried its whole ${TOTAL_MS}ms as ONE job: ${dead(multicb) ? "DIED" : "survived"}`,
  );
  if (dead(serial)) {
    log(
      "INCONCLUSIVE: the SERIAL control died too, so this run bounded" +
        " sustained occupancy rather than the fence interval — lower --totalMs",
    );
    process.exit(2);
  }
  if (!dead(group)) {
    log(
      `CLEAN: ${TOTAL_MS}ms behind one fence killed nothing this run. AT THE` +
        " DEFAULT TOTAL THAT IS NOT NEWS BY ITSELF — the ceiling is" +
        " intermittent within a few hundred ms of it. Raise --totalMs to" +
        " 4000+ and re-run before reading it as a changed device.",
    );
    process.exit(0);
  }
  log(
    `REPRODUCED: ${TOTAL_MS}ms behind ONE fence loses the device while the same` +
      " work serially fenced does not — the governed quantity is the FENCE" +
      " INTERVAL, not the dispatch",
  );
  process.exit(3);
}

main().catch((error) => {
  log("FAIL:", error);
  process.exit(1);
});
