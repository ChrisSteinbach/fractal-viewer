/**
 * The compute renderer's FENCE-SUBTRACTION gate: does a session's adaptive
 * sizing still climb on a browser whose fence round-trip is ~100 ms?
 *
 * WHAT IT PROTECTS. `SurfaceComputeRenderer`'s frame loop times its
 * dispatches across its own `device.queue.onSubmittedWorkDone()`, so the
 * fence round-trip is inside the measured number. Fed raw to the CAPS — which compare a TOTAL
 * dispatch time against a budget — a per-fence constant is fatal rather
 * than merely wasteful. MEASURED on this machine's AMD RX 7900 XTX,
 * hardware adapters confirmed in both browsers: a fenced null dispatch
 * costs 100.960 ms in Firefox against 3.265 ms in Chrome. Firefox's round
 * 100 ms suggests the promise resolves on a polling tick, so the price is
 * per fence whatever sits behind it. At that constant no Firefox dispatch
 * can come in under `nextLightingRayCap`'s 50 ms target: the lit ladder can
 * only quarter, `Math.floor(cap / 4)` walks it to
 * SURFACE_COMPUTE_WORKGROUP_SIZE, and it stays pinned there for the life of
 * the session — one full-pane lit pass turning Chrome's 517 dispatches into
 * roughly 30,000, each paying another ~100 ms.
 *
 * The fix measures the session's OWN fence round-trip once, at its first
 * real dispatch (the minimum of five null dispatches), and subtracts it in
 * `flushGroup` before `nextShadeHitCost`, `nextShadeBatchSize`,
 * `nextLightingRayCap` and the march's per-ray-step EMA read the value.
 * This gate drives the built app in a real browser and asks the questions
 * that settle it: was the round-trip measured at all, did the ladder
 * climb, and HOW MANY HITS did an average hit dispatch carry — that last
 * one because it is the pinning's own signature (a pinned ladder carries
 * exactly one workgroup) and it does not depend on how fast the machine
 * is.
 *
 * MEASURED, this repository's AMD RX 7900 XTX on DISPLAY=:0, production
 * build, the fixture below, one antialiasing pass, settle frame's own
 * duration from the trace:
 *
 * | arm                  | Chrome before | Chrome after | Firefox before | Firefox after |
 * | -------------------- | ------------: | -----------: | -------------: | ------------: |
 * | unlit, 1280x720      |       1271 ms |      1191 ms |      32,291 ms |     13,221 ms |
 * |   dispatches (m + s) |      39 + 101 |     38 + 101 |      148 + 145 |      43 + 107 |
 * | LIT, 640x360         |        801 ms |       844 ms |     138,854 ms |      6,845 ms |
 * |   dispatches (m + s) |       30 + 43 |      29 + 42 |      91 + 1102 |       29 + 42 |
 * |   lit ray cap, final |          4096 |         4096 |        **128** |          4096 |
 *
 * So Chrome is unmoved (its round-trip measured 2.35-2.42 ms, and the
 * calibration costs ~12 ms once) and Firefox's LIT settle is 20.3x
 * faster, its unlit one 2.44x. The lit arm is the DISCRIMINATING one and
 * the reason the flag exists: the lit ladder is the one whose 50 ms
 * target a ~100 ms fence puts permanently out of reach, and its 1102 hit
 * dispatches for 71.5k hits is 65 hits each — the one-workgroup floor,
 * visible without a stopwatch. The unlit ladder is not pinned on this
 * fixture at all (`shadeHitBudgetUs`'s floor is 250 ms, five times the
 * lit target, and the budget inflates with the same intercept the
 * measurement inflated), so its 2.44x is march slicing and dispatch count
 * rather than a pinned width.
 *
 * AND FEWER FENCES, which this gate now also protects. Dispatches are
 * grouped behind one `onSubmittedWorkDone`
 * (`SURFACE_COMPUTE_FENCE_GROUP_MAX`), so the pass condition includes
 * FENCES coming in strictly under DISPATCHES; `--fencegroup=1` is the
 * pre-grouping loop exactly and is the before arm of that feature's own
 * A/B, which is why the check is skipped whenever the pin is set. Measured
 * on this machine, one build, arms back to back, settle frame's own
 * duration:
 *
 * | arm                    |   1 fence/dispatch |           grouped |
 * | ---------------------- | -----------------: | ----------------: |
 * | Firefox unlit, 640x360 | 6600 / 6820 / 7112 | 4707 / 4704 /4908 |
 * | fences                 |       73 / 75 / 76 |      54 / 55 / 55 |
 * | Firefox LIT, 640x360   |               6623 |              4644 |
 * | Chrome unlit, 1280x720 | 1319 / 1344 / 1311 | 1191 / 1194 /1235 |
 * | fences                 |    138 / 138 / 138 |      93 / 95 / 95 |
 * | Chrome LIT, 640x360    |    892 / 880 / 867 |   893 / 848 / 858 |
 *
 * TWO THINGS TO KNOW BEFORE RUNNING THE FIREFOX ARMS. It does not settle
 * this fixture at the DEFAULT 1280x720 inside 300 s at any group size, the
 * pre-grouping loop included, while 640x360 and 960x540 settle in 5-11 s —
 * so pass `--viewport=640x360` there (that is a standing Firefox question
 * of its own, not this gate's). And the calibrated round-trip it reports
 * is BIMODAL: eight consecutive runs of this fixture calibrated 77.8,
 * 78.3, 18.6, 81.4, 37.2, 3.3, 59.0 and 67.2 ms, and a LOW draw leaves the
 * residue inside the sizing models and can pin the lit ladder outright —
 * this gate has FAILED for that reason on code with grouping pinned off.
 * A lit FAIL is worth re-running once and reading the calibrated number
 * before believing it.
 *
 * EXIT CODES. 0 = the cap climbed off its floor, the session settled, and
 * fences came in under dispatches — the gate passes. 3 = the cap stayed
 * pinned at the workgroup floor across a real drain, OR every dispatch
 * paid its own fence (grouping never engaged) — the regression is back. 2 = INCONCLUSIVE: no WebGPU
 * adapter, a software adapter, the session took the WebGL fragment arm, or
 * the settle never completed inside the timeout. A run that never exercised
 * the compute loop must not read as a pass. 1 = harness failure.
 *
 * NEVER SWIFTSHADER, and this is the trap the bench's own record names: on
 * this machine Chrome has NO WebGPU adapter without
 * `--enable-features=Vulkan --enable-unsafe-webgpu` (chrome://gpu reports
 * Vulkan: Disabled) and silently takes the WebGL fragment tracer instead,
 * which measures nothing about this loop. The script passes those flags and
 * reports the adapter label; a software adapter is exit 2.
 *
 * USAGE (needs a served build — `npm run build && npm run preview &`):
 *
 *   node scripts/surface-fence-cost.verify.mjs --browser=firefox
 *   node scripts/surface-fence-cost.verify.mjs --browser=chrome --lighting
 *
 * Flags: --browser=firefox|chrome, --url=, --display=:0, --viewport=WxH,
 * --fencegroup=N (pin the fence group; 1 = one fence per dispatch, the
 * pre-grouping loop),
 * --samples=N (antialiasing passes, default 1 — the ladder question is
 * answered by pass one and eight passes cost eight settles),
 * --timeoutMs=, --lighting, --headless, --log=<file> (dump the raw trace).
 */
import { chromium, firefox } from "playwright-core";
import { writeFileSync } from "node:fs";
import { guardFreshDist } from "./lib/dist-freshness.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const BROWSER = String(args.browser ?? "firefox");
const BASE = args.url ?? "https://localhost:4173";
const DISPLAY = args.display ?? ":0";
const TIMEOUT_MS = Number(args.timeoutMs ?? 900000);
const SAMPLES = Number(args.samples ?? 1);
const LIGHTING = Boolean(args.lighting);
/** `--fencegroup=N` -> `?surfacefencegroup=N`, the compute loop's
 * fence-group pin. THIS IS THE BEFORE/AFTER SWITCH: `--fencegroup=1`
 * fences every dispatch, which is the loop exactly as it ran before
 * dispatches were grouped, so this gate's own A/B runs on ONE build in
 * ONE browser process on ONE machine state rather than against a
 * remembered number from another checkout. Absent leaves the adaptive
 * grouping alone. */
const FENCE_GROUP = args.fencegroup ? Number(args.fencegroup) : null;
const FENCE_GROUP_Q =
  FENCE_GROUP && Number.isFinite(FENCE_GROUP) && FENCE_GROUP >= 1
    ? `&surfacefencegroup=${String(Math.floor(FENCE_GROUP))}`
    : "";
const POLL_MS = 250;
const [vw, vh] = String(args.viewport ?? "1280x720")
  .split("x")
  .map(Number);
const VIEWPORT = { width: vw || 1280, height: vh || 720 };
/** src/app/surface-compute.ts's SURFACE_COMPUTE_WORKGROUP_SIZE — the floor
 * the pinned ladder walks to, transcribed (plain Node, no TS loader). */
const WORKGROUP = 64;
/** src/app/surface-compute.ts's SURFACE_COMPUTE_LIGHTING_MAX_DISPATCH_RAYS
 * — the ceiling the lit ladder must actually REACH, transcribed. */
const LIGHTING_MAX_DISPATCH_RAYS = 4096;

const log = (...a) => console.log("[surface-fence]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HALF = 0.5;
/** presets.ts's sierpinskiTetrahedron() with a pure-mandelbox FINAL
 * transform: plain affine maps under a fold LENS, which is what routes the
 * session onto the compute renderer (surface-compute.ts's routing bullet)
 * and carries no contraction requirement. Same fixture the teardown gate
 * uses, so the two gates argue about one shape. */
function scene() {
  const s = {
    transforms: [
      { position: [0, 0.8, 0], rotation: [0, 0, 0], scale: [HALF, HALF, HALF] },
      {
        position: [0.75, -0.4, 0],
        rotation: [0, 0, 0],
        scale: [HALF, HALF, HALF],
      },
      {
        position: [-0.375, -0.4, 0.65],
        rotation: [0, 0, 0],
        scale: [HALF, HALF, HALF],
      },
      {
        position: [-0.375, -0.4, -0.65],
        rotation: [0, 0, 0],
        scale: [HALF, HALF, HALF],
      },
    ],
    numPoints: 100000,
    pointSize: 1,
    colorMode: "transform",
    renderStyle: "depthFade",
    showGuides: false,
    // Pinned pose: the cost under test is the frame's, so the framing must
    // not be the auto-fit's answer to a slightly different cloud.
    camera: { target: [0, 0, 0], radius: 3.2, theta: -0.35, phi: 1.15 },
    finalTransform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "mandelbox", weight: 1 }],
    },
  };
  if (LIGHTING) {
    // The LIT queue is sized by its own ladder (nextLightingRayCap), which
    // is the one the 50 ms target pins hardest — so it gets its own arm.
    s.surface = {
      lighting: {
        lights: [
          {
            position: [0, 3, 2],
            normal: [0, -3, -2],
            radius: 0.3,
            color: [1, 0.6, 0.3],
            intensity: 20,
          },
        ],
        ambient: [0.03, 0.03, 0.03],
        specular: 0.15,
        roughness: 0.4,
      },
    };
  }
  return s;
}

const enc = (s) =>
  "#v1=" + Buffer.from(JSON.stringify(s)).toString("base64url");

async function launch() {
  const env = { ...process.env, DISPLAY };
  if (BROWSER === "firefox") {
    return firefox.launch({
      executablePath: firefox.executablePath(),
      headless: Boolean(args.headless),
      env: { ...env, MOZ_WEBRENDER: "1" },
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
      args: [
        // Without these Chrome reports Vulkan: Disabled, exposes NO WebGPU
        // adapter, and silently takes the WebGL fragment tracer.
        "--enable-features=Vulkan",
        "--enable-unsafe-webgpu",
        "--ignore-gpu-blocklist",
      ],
    });
  }
  throw new Error(`--browser must be firefox or chrome, got ${BROWSER}`);
}

/** Everything the trace log says about this session's sizing. The trace is
 * the instrument because the caps live inside `runFrame`'s closure: nothing
 * on the probe surface reports a batch width. */
function readTrace(lines) {
  const fence = /fence calibrated ms=([\d.]+)/.exec(lines.join("\n"));
  const caps = [];
  const litCaps = [];
  let shadeDispatches = 0;
  let marchDispatches = 0;
  // FENCES, the instrument the grouping work moved: dispatches are
  // unchanged by design (each is still its own submission, the i915
  // preemption boundary), and what falls is how many of them a single
  // `onSubmittedWorkDone` round-trip stands behind.
  let fences = 0;
  let firstCap = null;
  let done = null;
  for (const line of lines) {
    const start = /shadeHitCap0=(\d+)/.exec(line);
    if (start && firstCap === null) firstCap = Number(start[1]);
    const cap = /cap→(\d+)/.exec(line);
    if (cap) caps.push(Number(cap[1]));
    const lit = /rayCap→(\d+)/.exec(line);
    if (lit) litCaps.push(Number(lit[1]));
    if (line.includes("shade END")) shadeDispatches++;
    if (line.includes("march END")) marchDispatches++;
    if (/\bfence (march|shade) dispatches=/.test(line)) fences++;
    if (line.includes("frame done")) done = line;
  }
  // The trace prefix is ms since THIS frame's start, so the last
  // `frame done` line carries the settle frame's own duration — a far
  // finer instrument than the poll clock, and the number the before/after
  // comparison is actually about.
  const frameMs = done ? Number(/^\[(\d+)ms\]/.exec(done)?.[1] ?? NaN) : null;
  const hits = done ? Number(/hit=(\d+)/.exec(done)?.[1] ?? NaN) : null;
  return {
    frameMs,
    hits: Number.isFinite(hits) ? hits : null,
    fenceMs: fence ? Number(fence[1]) : null,
    firstCap,
    caps,
    litCaps,
    maxCap: caps.length ? Math.max(...caps) : null,
    lastCap: caps.length ? caps[caps.length - 1] : null,
    maxLitCap: litCaps.length ? Math.max(...litCaps) : null,
    lastLitCap: litCaps.length ? litCaps[litCaps.length - 1] : null,
    shadeDispatches,
    marchDispatches,
    fences,
    done,
  };
}

async function main() {
  await guardFreshDist({ url: BASE });
  const url = `${BASE}/?surfacestate&surfacetrace&surfacesamples=${String(SAMPLES)}${FENCE_GROUP_Q}${enc(scene())}`;
  log(`browser=${BROWSER} viewport=${VIEWPORT.width}x${VIEWPORT.height}`);
  log(
    `url=${BASE}/?surfacestate&surfacetrace&surfacesamples=${String(SAMPLES)}${FENCE_GROUP_Q}#…`,
  );
  const browser = await launch();
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: VIEWPORT,
  });
  const page = await ctx.newPage();
  const console_ = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/adapter|webgpu|device|fallback|software/i.test(t)) {
      console_.push(`[${m.type()}] ${t}`);
    }
  });
  page.on("pageerror", (e) => console_.push(`[pageerror] ${String(e)}`));

  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await sleep(3000);
  const gate = await page.evaluate(() => {
    const btn = document.getElementById("modeSurfaceBtn");
    return { disabled: btn ? btn.disabled : null, title: btn ? btn.title : "" };
  });
  if (gate.disabled !== false) {
    log(`INCONCLUSIVE: Surface refused the fixture (${gate.title})`);
    await browser.close();
    return 2;
  }
  await page.evaluate(() => {
    document.getElementById("modeSurfaceBtn").click();
  });

  const tEnter = Date.now();
  let firstFrameMs = null;
  let probe = null;
  let settledMs = null;
  while (Date.now() - tEnter < TIMEOUT_MS) {
    await sleep(POLL_MS);
    probe = await page.evaluate(() => window.__surfaceState?.() ?? null);
    if (probe?.firstFrame && firstFrameMs === null) {
      firstFrameMs = Date.now() - tEnter;
    }
    if (probe?.settled) {
      settledMs = Date.now() - tEnter;
      break;
    }
  }
  const lines = await page.evaluate(() => window.__surfaceTraceLog ?? []);
  const t = readTrace(lines);
  if (args.log) writeFileSync(String(args.log), lines.join("\n"));

  log(`engine=${probe?.engine ?? "?"} backend=${probe?.backend?.label ?? "?"}`);
  log(`software=${String(probe?.backend?.software ?? "?")}`);
  log(
    `fence round-trip: ${t.fenceMs === null ? "NOT CALIBRATED" : `${t.fenceMs.toFixed(2)} ms`}`,
  );
  log(`hit cap: first=${t.firstCap} max=${t.maxCap} last=${t.lastCap}`);
  if (LIGHTING) {
    log(`lit ray cap: max=${t.maxLitCap} last=${t.lastLitCap}`);
  }
  log(
    `dispatches: march=${t.marchDispatches} shade=${t.shadeDispatches} fences=${t.fences}`,
  );
  log(
    `first frame: ${firstFrameMs === null ? "never" : `${String(firstFrameMs)} ms`}`,
  );
  log(
    `settled: ${settledMs === null ? "NEVER (timeout)" : `${String(settledMs)} ms`}`,
  );
  log(
    `settle frame itself: ${t.frameMs === null ? "?" : `${String(t.frameMs)} ms`}`,
  );
  if (t.done) log(`trace: ${t.done}`);
  for (const c of console_.slice(0, 8)) log(`  ${c}`);
  await browser.close();

  if (probe?.engine !== "compute") {
    log("INCONCLUSIVE: the session did not take the compute engine");
    return 2;
  }
  if (probe?.backend?.software !== false) {
    log("INCONCLUSIVE: software adapter — this loop's costs are not the GPU's");
    return 2;
  }
  if (settledMs === null) {
    log("INCONCLUSIVE: no completed settle inside the timeout");
    return 2;
  }
  if (t.fenceMs === null) {
    log("FAIL: the session never calibrated its fence round-trip");
    return 3;
  }
  if (t.shadeDispatches < 4) {
    log("INCONCLUSIVE: too few hit dispatches to exercise the ladder");
    return 2;
  }
  const climbed = t.maxCap !== null && t.maxCap > WORKGROUP;
  // A pinned ladder's signature is machine-independent: it carries ONE
  // WORKGROUP per dispatch however fast the GPU is. Four workgroups is a
  // wide margin below what an unpinned run reaches here (~1660-1830 on
  // both arms, since the free/miss batches are counted too) and far above
  // the 65 a pinned Firefox run measured.
  const perDispatch =
    t.hits === null ? null : t.hits / Math.max(1, t.shadeDispatches);
  const wideEnough = perDispatch === null || perDispatch >= WORKGROUP * 4;
  // The lit ladder must reach its own ceiling, not merely leave the
  // floor: a raw-wall-time Firefox run does briefly climb to 1024 and
  // then quarters back to 128, so "ever grew" is not the question.
  const litClimbed =
    !LIGHTING ||
    (t.lastLitCap !== null && t.lastLitCap >= LIGHTING_MAX_DISPATCH_RAYS);
  log(
    `hits per hit dispatch: ${perDispatch === null ? "?" : perDispatch.toFixed(0)}`,
  );
  if (!climbed || !litClimbed || !wideEnough) {
    log(
      `FAIL: the ladder is pinned near the ${String(WORKGROUP)}-ray floor — ` +
        "fence latency is reaching the sizing models again",
    );
    return 3;
  }
  // DID GROUPING ENGAGE AT ALL? Its signature is machine-independent in
  // the same way the pinned ladder's is: one fence per dispatch is what
  // the loop did before dispatches were grouped, and any grouping at all
  // puts FENCES strictly below DISPATCHES. A `--fencegroup` run is the
  // deliberate exception — `=1` IS that old loop, which is the whole
  // point of the flag — so the check is skipped whenever the pin is set.
  const dispatches = t.marchDispatches + t.shadeDispatches;
  if (FENCE_GROUP_Q === "" && dispatches >= 8 && t.fences >= dispatches) {
    log(
      `FAIL: ${String(t.fences)} fences for ${String(dispatches)} dispatches — ` +
        "grouping never engaged, every dispatch is paying its own round-trip",
    );
    return 3;
  }
  log("PASS: the ladder climbed off its floor and the frame settled");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error("[surface-fence] harness failure:", e);
    process.exit(1);
  },
);
