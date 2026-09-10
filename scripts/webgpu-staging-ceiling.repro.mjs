/**
 * WHY FIREFOX LOSES ITS WEBGPU DEVICE WITH `Not enough memory left` — the
 * app-free reproduction, and the executable record that corrected what
 * `SURFACE_COMPUTE_FENCE_GROUP_MAX` says about itself.
 *
 * SELF-CONTAINED ON PURPOSE. It needs no build, no server and none of this
 * app: the page is a routed one-line HTML document on an `https://` origin
 * Playwright fulfils itself, so what it measures is the BROWSER and cannot
 * be blamed on a renderer. Every run launches a FRESH browser per rep — a
 * lost device poisons its page, and a leaked one poisons the next arm, and
 * an early version of this probe reported both as findings before it did
 * that.
 *
 *   node scripts/webgpu-staging-ceiling.repro.mjs                # all arms
 *   node scripts/webgpu-staging-ceiling.repro.mjs --arm=frame
 *   node scripts/webgpu-staging-ceiling.repro.mjs --browser=chrome
 *
 * EXIT CODES. 3 = the ceiling reproduced (the expected verdict on Firefox
 * today — this is a browser bug the app steers around, so "reproduced" is
 * news only in that it is still there). 0 = no arm could kill a device:
 * the browser changed, and the constants below are due a re-measurement.
 * 2 = INCONCLUSIVE (no adapter, or a software one — a run that never
 * exercised a real device must not read as either verdict). 1 = harness
 * failure. A CLEAN VERDICT ONLY MEANS ANYTHING AT THE DEFAULTS: the
 * failure is intermittent near its threshold, so a cut-down run (fewer
 * reps, one group, one arm) that survives says nothing at all.
 *
 * ── WHAT IT ASKS ────────────────────────────────────────────────────────
 *
 * `--arm=burst` — bare `queue.submit()`s in one synchronous burst behind
 * one `onSubmittedWorkDone`, no `writeBuffer` at all.
 *
 * `--arm=frame` — the app's own frame shape: three multi-megabyte
 * `queue.writeBuffer` prefills (`surface-compute.ts` seeds `color`,
 * `layer` and `states` once per frame) followed by `--groups=N` dispatches
 * each staging two small writes (its params block and its ray-list slice),
 * one fence per group. `--prefillMb` is the frame's prefill total,
 * `--groups` its fence group.
 *
 * `--arm=recover` — kill a device the `frame` way, then ask whether the
 * page can get a WORKING one back, at several delays.
 *
 * ── MEASURED, Firefox 153.0 (Playwright's build) and Chrome, this
 * repository's AMD RX 7900 XTX on `DISPLAY=:0`, 5 reps x 10 rounds a cell,
 * reps counted DEAD on a device loss or an uncaptured error ─────────────
 *
 * IT IS NOT A COUNT OF QUEUED DISPATCHES. Bare submits are harmless:
 *
 * | `--arm=burst`, submits per fence | 4   | 8   | 16  | 32  |
 * | -------------------------------- | --- | --- | --- | --- |
 * | died                             | 0/5 | 0/5 | 0/5 | 0/5 |
 *
 * IT IS THE `writeBuffer` STAGING OUTSTANDING WHEN THE FENCE FALLS DUE,
 * and it is a VOLUME. At a fixed group of four, with the per-dispatch
 * writes alone (no prefill), only their SIZE moves anything:
 *
 * | per-dispatch write | 16 KB | 256 KB | 1 MB | 4 MB |
 * | ------------------ | ----- | ------ | ---- | ---- |
 * | died               | 0/5   | 0/5    | 1/5  | 4/5  |
 *
 * — so the app's own two 16 KB writes are 128 KB against a frame's
 * MEGABYTES, and they are not what kills it. Restore the frame prefill
 * and the app's failure appears exactly where the app has it:
 *
 * | `--prefillMb` \ `--groups` | 1   | 3   | 4   | 8   |
 * | -------------------------- | --- | --- | --- | --- |
 * | 4                          | 0/5 | 1/5 | 3/5 | 5/5 |
 * | 8                          | 0/5 | 3/5 | 5/5 | 5/5 |
 * | 16                         | 0/5 | 0/5 | 5/5 | 5/5 |
 * | 32                         | 5/5 | 5/5 | 5/5 | 5/5 |
 *
 * `surface-compute.ts` stages 16 B/ray of ray state, 4 B/ray of layer
 * sidecar and the colour prefill once per frame, so a 640x360 raster is
 * the 8 MB row — dead at four dispatches a fence, marginal at three,
 * clean at one, which is the app's measured behaviour to the group.
 *
 * TWO THINGS THE TABLE SAYS THAT THE FENCE GROUP CANNOT FIX. The 32 MB row
 * dies at a group of ONE: past some raster the frame's own prefill is over
 * the ceiling however finely its dispatches are fenced. And fencing
 * BETWEEN the three prefill writes does not rescue them (16 MB 3/5, 24 MB
 * 5/5, 32 MB 4/5, 48 MB 5/5 dead at a group of one) — the staging is not
 * reclaimed by a fence returning, only by the browser's own poll.
 *
 * WHAT DOES NOT MOVE IT: buffers the device merely HOLDS. 16, 32, 64 and
 * 128 MB of untouched storage buffers all died 0/5 at the group of four
 * that kills a frame's prefill.
 *
 * CHROME IS UNAFFECTED — 0/5 dead at 8, 32, 128 and 512 submits a fence,
 * with the same writes.
 *
 * A LOST DEVICE DOES NOT COME BACK IN THAT TAB. Of 6 reps that actually
 * killed the device, 0 recovered: `requestDevice()` itself rejects with
 * `Not enough memory left`, or the replacement device cannot allocate
 * 8 MB — at 0 ms, 500 ms and 3000 ms after the loss alike. So the app's
 * one-way `"failed"` latch is CORRECT rather than merely conservative, and
 * a retry-on-loss is a measured won't-do, not an oversight.
 *
 * ── THE UPSTREAM MECHANISM (established, not this script's own finding)
 *
 * Firefox reclaims WebGPU submission resources only on a timer:
 * `WebGPUParent` starts `mTimer` at `POLL_TIME_MS = 100` and its
 * `MaintainDevices` calls `wgpu_server_poll_all_devices`; nothing polls at
 * submit time, and wgpu-core's `LifetimeTracker` holds a submission's
 * staging and command resources until a poll observes its fence. That
 * 100 ms tick is the same one this repository already measured from the
 * outside as Firefox's ~100 ms `onSubmittedWorkDone` round-trip
 * (`scripts/surface-fence-cost.verify.mjs`), and Mozilla's own bug 1870699
 * ("Don't poll WebGPU from a timer") is where it is written down.
 * `Not enough memory left` is wgpu's `DeviceError::OutOfMemory` text, a
 * generic exhaustion signal rather than a report about VRAM: this machine
 * had 23 GB of its 24 GB free every time it fired.
 */
import { firefox, chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const BROWSER = String(args.browser ?? "firefox");
const DISPLAY = args.display ?? ":0";
const REPS = Number(args.reps ?? 5);
const ROUNDS = Number(args.rounds ?? 10);
const ARM = String(args.arm ?? "all");
const GROUPS = String(args.groups ?? "1,3,4,8")
  .split(",")
  .map(Number);
const WRITE_BYTES = Number(args.writeBytes ?? 16384);
const PREFILL_MB = Number(args.prefillMb ?? 8);
const HOLD_MB = Number(args.holdMb ?? 0);
const DELAYS = String(args.delays ?? "0,500,3000")
  .split(",")
  .map(Number);
/** Any origin will do — nothing is served from it. It only has to be
 * `https:` so the page is a secure context and `navigator.gpu` exists. */
const ORIGIN = "https://webgpu-staging-probe.test";
const SOFTWARE_RE = /swiftshader|llvmpipe|software|lavapipe|microsoft basic/i;

const log = (...a) => console.log("[staging-ceiling]", ...a);

function launch() {
  const env = { ...process.env, DISPLAY };
  if (BROWSER === "firefox") {
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
  if (BROWSER === "chrome") {
    return chromium.launch({
      executablePath: "/usr/bin/google-chrome",
      headless: Boolean(args.headless),
      env,
      // Without these Chrome reports Vulkan: Disabled and exposes no
      // WebGPU adapter at all — the bench's own standing trap.
      args: [
        "--enable-features=Vulkan",
        "--enable-unsafe-webgpu",
        "--ignore-gpu-blocklist",
      ],
    });
  }
  throw new Error(`--browser must be firefox or chrome, got ${BROWSER}`);
}

/** One rep: a fresh browser, a fresh page, one call into `body`. */
async function rep(body, arg) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>webgpu staging probe</title>",
      }),
    );
    await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    return await page.evaluate(body, arg);
  } catch (error) {
    return { threw: String(error) };
  } finally {
    await browser.close();
  }
}

/** Shared page-side preamble: a device, its loss/error latches, and a
 * trivial compute pipeline to submit. Serialized into the page, so it
 * takes no closures from here. */
const PAGE_SETUP = `
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return { inconclusive: "no WebGPU adapter" };
  const label = [adapter.info?.description, adapter.info?.vendor, adapter.info?.architecture]
    .filter(Boolean).join(" ");
  const device = await adapter.requestDevice();
  let lost = null;
  device.lost.then((e) => { lost = e.reason ? e.reason + ": " + e.message : e.message; });
  const errors = [];
  device.addEventListener("uncapturederror", (e) => errors.push(String(e.error?.message ?? e.error)));
  const module = device.createShaderModule({ code: \`
@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= arrayLength(&data)) { return; }
  data[gid.x] = data[gid.x] * 1664525u + 1013904223u;
}\` });
  const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
  const target = device.createBuffer({ size: 65536, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: target } }] });
  const dispatch = () => {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(256);
    pass.end();
    device.queue.submit([enc.finish()]);
  };
`;

/** The `burst` and `frame` arms are one body: `prefillMb = 0` and
 * `writes = 0` reduce it to bare submits, which is the point — the two
 * arms differ only in what they stage, never in how they are driven. */
const runBody = new Function(
  "opts",
  `return (async () => {
  const { group, rounds, writes, writeBytes, prefillMb, holdMb } = opts;
  ${PAGE_SETUP}
  // Ballast the device merely HOLDS, never writes: the control that says
  // whether allocation or staging is the exhausted quantity.
  const ballast = [];
  for (let i = 0; i < holdMb; i++) {
    ballast.push(device.createBuffer({ size: 1 << 20, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
  }
  // A FRAME'S PREFILL: three writes, sized as one round's total. Sizes are
  // rounded down to a multiple of 4 — writeBuffer refuses anything else,
  // and an unaligned payload reads as a device error rather than a
  // finding.
  const prefillBytes = Math.floor((prefillMb * (1 << 20)) / 3 / 4) * 4;
  const prefillBuf = prefillBytes > 0
    ? device.createBuffer({ size: prefillBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    : null;
  const prefillPayload = prefillBytes > 0 ? new Uint8Array(prefillBytes) : null;
  const params = device.createBuffer({ size: Math.max(writeBytes, 256), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const payload = new Uint8Array(writeBytes);
  let submits = 0;
  let round = 0;
  let threw = null;
  try {
    for (; round < rounds; round++) {
      if (prefillBuf) for (let i = 0; i < 3; i++) device.queue.writeBuffer(prefillBuf, 0, prefillPayload);
      for (let d = 0; d < group; d++) {
        for (let w = 0; w < writes; w++) device.queue.writeBuffer(params, 0, payload);
        dispatch();
        submits++;
      }
      await device.queue.onSubmittedWorkDone();
      if (lost || errors.length) break;
    }
  } catch (e) { threw = String(e); }
  // A loss lands asynchronously; give it the tick it needs before reporting.
  await new Promise((r) => setTimeout(r, 250));
  return { label, submits, round, lost, errors, threw };
})();`,
);

/** The `recover` arm: kill the device the frame way, wait, then ask for a
 * working one back. "Working" is deliberately modest — an 8 MB buffer and
 * two dispatches — because a 32 MB one fails on a FRESH Firefox device
 * too, and an over-strict criterion would report every rep as a
 * non-recovery whatever the browser did. */
const recoverBody = new Function(
  "opts",
  `return (async () => {
  const { delayMs } = opts;
  ${PAGE_SETUP}
  const big = device.createBuffer({ size: 12 << 20, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const payload = new Uint8Array(8 << 20);
  for (let round = 0; round < 4 && !lost && errors.length === 0; round++) {
    for (let i = 0; i < 3; i++) device.queue.writeBuffer(big, 0, payload);
    for (let d = 0; d < 4; d++) dispatch();
    try { await device.queue.onSubmittedWorkDone(); } catch {}
  }
  await new Promise((r) => setTimeout(r, 400));
  if (!lost && errors.length === 0) return { label, killed: false };
  await new Promise((r) => setTimeout(r, delayMs));
  let next;
  try {
    const a2 = await navigator.gpu.requestAdapter();
    if (!a2) return { label, killed: true, recovered: false, why: "no adapter after the loss" };
    next = await a2.requestDevice();
  } catch (e) { return { label, killed: true, recovered: false, why: "requestDevice: " + String(e) }; }
  let lost2 = null;
  next.lost.then((e) => { lost2 = e.message; });
  const errors2 = [];
  next.addEventListener("uncapturederror", (e) => errors2.push(String(e.error?.message ?? e.error)));
  next.pushErrorScope("out-of-memory");
  const probe = next.createBuffer({ size: 8 << 20, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const oom = await next.popErrorScope();
  void probe;
  await new Promise((r) => setTimeout(r, 250));
  const why = oom ? "8 MB alloc: " + oom.message : lost2 ? "replacement lost: " + lost2 : errors2[0] ?? null;
  return { label, killed: true, recovered: why === null, why };
})();`,
);

let adapterLabel = null;
let inconclusive = null;
let reproduced = false;
let arms = 0;

/** One cell of a sweep: REPS reps, reported as a death RATE, because the
 * failure is intermittent near its threshold and a single rep is a coin
 * flip that has misled this investigation once already. */
async function cell(labelText, opts) {
  const outs = [];
  for (let r = 0; r < REPS; r++) outs.push(await rep(runBody, opts));
  for (const o of outs) {
    if (o.inconclusive) inconclusive ??= o.inconclusive;
    if (o.label && !adapterLabel) adapterLabel = o.label;
  }
  const dead = outs.filter((o) => o.lost || o.errors?.length || o.threw).length;
  if (dead > 0) reproduced = true;
  arms++;
  log(
    `${labelText.padEnd(38)} died ${String(dead)}/${String(REPS)}` +
      `  submitsAtDeath=[${outs
        .map((o) =>
          o.lost || o.errors?.length || o.threw ? (o.submits ?? "?") : "-",
        )
        .join(",")}]`,
  );
}

try {
  log(
    `browser=${BROWSER} reps=${String(REPS)} rounds=${String(ROUNDS)} ` +
      `writeBytes=${String(WRITE_BYTES)} prefillMb=${String(PREFILL_MB)}`,
  );

  if (ARM === "all" || ARM === "burst") {
    for (const group of GROUPS) {
      await cell(`burst  submits/fence=${String(group)}`, {
        group,
        rounds: ROUNDS,
        writes: 0,
        writeBytes: WRITE_BYTES,
        prefillMb: 0,
        holdMb: HOLD_MB,
      });
    }
  }

  if (ARM === "all" || ARM === "frame") {
    for (const group of GROUPS) {
      await cell(
        `frame  prefill=${String(PREFILL_MB)}MB group=${String(group)}`,
        {
          group,
          rounds: ROUNDS,
          writes: 2,
          writeBytes: WRITE_BYTES,
          prefillMb: PREFILL_MB,
          holdMb: HOLD_MB,
        },
      );
    }
  }

  if (ARM === "all" || ARM === "recover") {
    for (const delayMs of DELAYS) {
      const outs = [];
      for (let r = 0; r < REPS; r++)
        outs.push(await rep(recoverBody, { delayMs }));
      for (const o of outs) {
        if (o.inconclusive) inconclusive ??= o.inconclusive;
        if (o.label && !adapterLabel) adapterLabel = o.label;
      }
      const killed = outs.filter((o) => o.killed);
      const back = killed.filter((o) => o.recovered).length;
      if (killed.length > 0) reproduced = true;
      arms++;
      log(
        `recover delay=${String(delayMs).padStart(5)}ms  ` +
          `killed ${String(killed.length)}/${String(REPS)}, ` +
          `recovered ${String(back)}/${String(killed.length)}` +
          `  ${killed.map((o) => o.why ?? "ok").join(" | ")}`,
      );
    }
  }

  if (arms === 0) {
    log(`FAIL: --arm must be all, burst, frame or recover (got ${ARM})`);
    process.exit(1);
  }
  // FIREFOX REPORTS AN EMPTY ADAPTER LABEL (every `adapter.info` field is
  // ""), so the software guard below bites on Chrome alone. On Firefox the
  // caller owns that check — run this where `glxinfo -B` names a real GPU.
  log(
    `adapter: ${adapterLabel ? adapterLabel : "(this browser reports none)"}`,
  );
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
  if (reproduced) {
    log("REPRODUCED: the staging ceiling is still there on this browser");
    process.exit(3);
  }
  log("CLEAN: no arm killed a device — re-measure the constants this pinned");
  process.exit(0);
} catch (error) {
  log("FAIL:", error);
  process.exit(1);
}
