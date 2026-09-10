/**
 * The compute renderer's FENCE-SUBTRACTION gate: does a session's adaptive
 * sizing still climb on a browser whose fence round-trip is ~100 ms?
 *
 * WHAT IT PROTECTS. `SurfaceComputeRenderer`'s `dispatchTimed` times across
 * its own `device.queue.onSubmittedWorkDone()`, so the fence round-trip is
 * inside the measured number. Fed raw to the CAPS — which compare a TOTAL
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
 * `dispatchTimed` before `nextShadeHitCost`, `nextShadeBatchSize`,
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
 * WHAT IS STILL OWED, and this gate does not test it: after the fix a
 * Firefox settle frame is very nearly its fence COUNT times its fence
 * latency (150 fences x ~100 ms against a 13.2 s frame), so the remaining
 * 8-11x against Chrome is the per-fence price itself, not the sizing. The
 * lever for that is fewer fences — grouping N dispatches behind one — and
 * it is a separate piece of work.
 *
 * EXIT CODES. 0 = the cap climbed off its floor and the session settled —
 * the gate passes. 3 = the cap stayed pinned at the workgroup floor across
 * a real drain — the regression is back. 2 = INCONCLUSIVE: no WebGPU
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
 * --samples=N (antialiasing passes, default 1 — the ladder question is
 * answered by pass one and eight passes cost eight settles),
 * --timeoutMs=, --lighting, --headless, --log=<file> (dump the raw trace).
 */
import { chromium, firefox } from "playwright-core";
import { writeFileSync } from "node:fs";

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
    done,
  };
}

async function main() {
  const url = `${BASE}/?surfacestate&surfacetrace&surfacesamples=${String(SAMPLES)}${enc(scene())}`;
  log(`browser=${BROWSER} viewport=${VIEWPORT.width}x${VIEWPORT.height}`);
  log(
    `url=${BASE}/?surfacestate&surfacetrace&surfacesamples=${String(SAMPLES)}#…`,
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
  log(`dispatches: march=${t.marchDispatches} shade=${t.shadeDispatches}`);
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
