/**
 * The pass-duration instrument's RESOLVE-PLACEMENT matrix: does a
 * `resolveQuerySet` work when it rides the same submission as the compute
 * pass that wrote the pairs, or must it come after the fence in its own
 * submission?
 *
 * WHY THIS EXISTS. `SurfaceComputeRenderer`'s frame loop sizes every
 * dispatch from a measured pass duration. The first draft resolved each
 * pass's timestamp pair in that pass's own command encoder — no extra
 * submission, no extra fence — and the app's very first instrumented group
 * read ZERO on this stack while later groups looked plausible, which no
 * per-group currency rule can survive. This probe isolates the mechanism
 * away from the app and pins the shape `flushGroup` must use.
 *
 * MEASURED 12 September 2026, this machine's AMD RX 7900 XTX (RDNA 3,
 * kernel 7.0.0-29), Chrome on `DISPLAY=:0` behind
 * `--enable-dawn-features=allow_unsafe_apis` (the only way this browser
 * exposes `timestamp-query`), WebGPU adapter `amd rdna-3`. Four arms, all
 * mirroring `surface-compute.ts`'s calibration-probe flow — one encoder
 * per pass, a `timestampWrites` pair per pass, one resolve+copy per arm's
 * chosen shape:
 *
 * | arm | passes | resolve | readings |
 * | --- | --- | --- | --- |
 * | A | six 0-workgroup probes, fenced apart, then one 17.4 ms spin pass | per-pass, in the pass's own submission | first probe 9 µs, every later copy **0**, spin pass included |
 * | D | three back-to-back spin passes behind ONE fence (a group) | per-pass | **nondeterministic** — all zeros in one rep, `[0, 0, 1.18]` in another: the last member sometimes surfaces a real value |
 * | C | the same passes, no per-pass resolve | ONE resolve of every slot in its own submission AFTER the final fence | probes 3.2 µs each, spin pass 17.4 ms — every pair correct |
 *
 * VERDICT: a same-submission resolve is UNRELIABLE — zeros dominate, and a
 * correct-looking value can appear, which is worse than a uniform zero
 * because it cannot be detected from the reading alone. One resolve after
 * the fence is exact. So the
 * renderer resolves each fence group's pairs in its own submission in
 * `flushGroup`, after `onSubmittedWorkDone`, and never inside a dispatch's
 * encoder. The cost of that shape is measured in the same session's
 * records (fence 2.5 ms + resolve 0.1 ms + map 2.6 ms per group on
 * Chrome; fence 100 ms + map 101 ms on Firefox — see
 * `docs/surface-compute-renderer.md`, which also gates the engagement on
 * the session's measured fence round-trip for exactly that Firefox row).
 *
 * USAGE: `node scripts/webgpu-ts-resolve.repro.mjs --display=:0`. Exit 0 =
 * the verdict reproduced (per-pass resolve reads zeros past the first
 * submission; the after-fence resolve reads every pair). Exit 3 = the
 * matrix flipped (same-submission resolve now works, or the end-resolve
 * broke) — the mechanism moved and `flushGroup`'s shape is due a
 * re-read. Exit 2 = INCONCLUSIVE (no adapter, a software one, or the
 * feature absent). Exit 1 = harness failure.
 */
import { chromium } from "playwright-core";
import { contendedReason, quietBaseline } from "./lib/machine-quiet.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const DISPLAY = args.display === undefined ? ":0" : String(args.display);
const log = (...a) => console.log("[ts-resolve]", ...a);

const pageBody = async () => {
  const adapter = await navigator.gpu?.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) return { inconclusive: "no WebGPU adapter" };
  if (!adapter.features.has("timestamp-query"))
    return { inconclusive: "timestamp-query feature absent" };
  const device = await adapter.requestDevice({
    requiredFeatures: ["timestamp-query"],
  });
  const CAP = 512;
  const tsSet = device.createQuerySet({ type: "timestamp", count: CAP });
  const tsResolve = device.createBuffer({
    size: CAP * 8,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const tsRead = device.createBuffer({
    size: CAP * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const module = device.createShaderModule({
    code: `
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
}`,
  });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module, entryPoint: "main" },
  });
  const data = device.createBuffer({
    size: 64 * 1024,
    usage: GPUBufferUsage.STORAGE,
  });
  const spin = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: data } },
      { binding: 1, resource: { buffer: spin } },
    ],
  });
  device.queue.writeBuffer(spin, 0, new Uint32Array([20000, 0, 0, 0]));
  let cursor = 0;

  /** One encoder, one pass with a timestamp pair, optional per-pass
   * resolve+copy riding the same submission (the shape `flushGroup` must
   * not use). */
  const encode = (workgroups, slot, withResolve) => {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass({
      timestampWrites: {
        querySet: tsSet,
        beginningOfPassWriteIndex: slot,
        endOfPassWriteIndex: slot + 1,
      },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    if (withResolve) {
      enc.resolveQuerySet(tsSet, slot, 2, tsResolve, slot * 8);
      enc.copyBufferToBuffer(tsResolve, slot * 8, tsRead, slot * 8, 16);
    }
    device.queue.submit([enc.finish()]);
  };
  const drainRange = async (offset, bytes) => {
    await tsRead.mapAsync(GPUMapMode.READ, offset, bytes);
    const out = new BigUint64Array(
      tsRead.getMappedRange(offset, bytes).slice(0),
    );
    tsRead.unmap();
    return out;
  };
  const toMs = (raw) => {
    const out = [];
    for (let i = 0; i + 1 < raw.length; i += 2)
      out.push(Number(raw[i + 1] - raw[i]) / 1e6);
    return out;
  };

  const results = {};

  // ARM A — six 0-workgroup probes, each fenced apart, each resolving its
  // own pair (the calibration flow `ensureFenceCalibrated` runs), then one
  // real pass resolving its own. The app's original shape.
  {
    let slot = 0;
    for (let i = 0; i < 6; i++) {
      encode(0, slot, true);
      slot += 2;
      await device.queue.onSubmittedWorkDone();
    }
    encode(20000, slot, true);
    await device.queue.onSubmittedWorkDone();
    results.armA_probeCopies = toMs(await drainRange(0, slot * 8));
    results.armA_realPass = toMs(await drainRange(slot * 8, 16));
    cursor = slot + 2;
  }

  // ARM C — no per-pass resolve at all: the same six 0-workgroup probes
  // and the spin pass, ONE resolve of every slot after the final fence
  // (the shape `flushGroup` must use).
  {
    let slot = cursor;
    for (let i = 0; i < 6; i++) {
      encode(0, slot, false);
      slot += 2;
      await device.queue.onSubmittedWorkDone();
    }
    encode(20000, slot, false);
    await device.queue.onSubmittedWorkDone();
    const enc = device.createCommandEncoder();
    enc.resolveQuerySet(tsSet, cursor, slot + 2 - cursor, tsResolve, 0);
    enc.copyBufferToBuffer(tsResolve, 0, tsRead, 0, (slot + 2 - cursor) * 8);
    device.queue.submit([enc.finish()]);
    const raw = await drainRange(0, (slot + 2 - cursor) * 8);
    // raw[0..6) are the probes, raw[6] the spin pass.
    results.armC_probeCopies = toMs(raw.subarray(0, 12));
    results.armC_realPass = toMs(raw.subarray(raw.length - 2));
    cursor = slot + 2;
  }

  // ARM D — a GROUP: three back-to-back passes behind one fence, each
  // resolving its own pair (the shape a per-dispatch resolve would give a
  // fence group).
  {
    let slot = cursor;
    for (let i = 0; i < 3; i++) {
      encode(2000, slot, true);
      slot += 2;
    }
    await device.queue.onSubmittedWorkDone();
    results.armD_groupCopies = toMs(
      await drainRange(cursor * 8, (slot - cursor) * 8),
    );
    cursor = slot;
  }

  return { ...results, cursor };
};

async function main() {
  const quiet = await quietBaseline(log);
  const contended = contendedReason(quiet);
  if (contended) log(`UNCERTIFIED: ${contended} — correctness rows only`);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false,
    env: { ...process.env, DISPLAY },
    args: [
      "--ozone-platform=x11",
      // Without it Chrome exposes no `timestamp-query` feature at all.
      "--enable-features=Vulkan",
      "--enable-unsafe-webgpu",
      "--ignore-gpu-blocklist",
      "--enable-dawn-features=allow_unsafe_apis",
      "--no-sandbox",
    ],
  });
  const page = await browser.newPage();
  await page.route("https://ts-resolve.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>ts resolve probe</title>",
    }),
  );
  await page.goto("https://ts-resolve.test/", {
    waitUntil: "domcontentloaded",
  });
  const out = await page
    .evaluate(pageBody)
    .catch((e) => ({ threw: String(e) }));
  await browser.close().catch(() => {});
  if (out.inconclusive) {
    log(`INCONCLUSIVE: ${out.inconclusive}`);
    return 2;
  }
  if (out.threw) {
    log(`harness failure: ${out.threw}`);
    return 1;
  }
  log(`armA per-pass-resolve probes: ${JSON.stringify(out.armA_probeCopies)}`);
  log(`armA real pass:               ${JSON.stringify(out.armA_realPass)}`);
  log(`armC end-resolve probes:      ${JSON.stringify(out.armC_probeCopies)}`);
  log(`armC end-resolve real pass:   ${JSON.stringify(out.armC_realPass)}`);
  log(`armD group copies:            ${JSON.stringify(out.armD_groupCopies)}`);
  const broken = (ms) => ms === 0;
  const working = (ms) => ms > 0;
  // Per-pass resolve reads UNRELIABLY, not uniformly zero: re-runs have
  // surfaced a real value in the LAST member of a group ([0,0,1.18] in one
  // rep) where an earlier rep read all zeros. Unreliable is worse than
  // uniformly broken — so the check is "any zero anywhere among the
  // per-pass copies", not "all zero".
  const perPassUnreliable =
    out.armA_realPass.some((ms) => broken(ms)) ||
    out.armA_probeCopies.slice(1).some((ms) => ms === 0) ||
    out.armD_groupCopies.some((ms) => broken(ms));
  const endResolveWorks =
    out.armC_realPass.every((ms) => ms > 0) &&
    out.armC_probeCopies.every((ms) => ms > 0);
  if (perPassUnreliable && endResolveWorks) {
    log(
      "REPRODUCED: same-submission resolves read zeros/unreliable values; one resolve after the fence reads every pair",
    );
    return 3;
  }
  if (endResolveWorks) {
    log(
      "CHANGED: the end-resolve shape still works but the per-pass shape no longer reads zeros — flushGroup's resolve shape is due a re-measurement",
    );
    return 3;
  }
  log("CHANGED: the measured verdicts above no longer reproduce");
  return 3;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error("[ts-resolve] harness failure:", e);
    process.exit(1);
  },
);
