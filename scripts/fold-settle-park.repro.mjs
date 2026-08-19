// Repro for the 3D fold-core WebGPU compute settle park bug —
// "Full detail" (compute) surface renders advance to a pose-dependent
// percent then stop retiring rays forever, with rAF still ticking at 60Hz
// and the GPU idle. Modeled on scripts/balloon-real-driver.verify.mjs:
// same headed-Chrome launch recipe (real Vulkan, not the headless
// SwiftShader path), same `enc()` scene-hash encoder, same embedded
// mandelboxKifs preset, same `#modeSurfaceBtn` click + `#surfaceProgress`
// polling idioms — but this script's job is to CAPTURE a park, not to
// time a settle. It drives the session with `?surfacetrace` enabled
// (main.ts) so `window.__surfaceTraceLog` records every
// march/shade/readback BEGIN/END pair the compute frame loop emits; a
// wedged GPU await shows up as a BEGIN with no END as the last line ever
// appended — the log stops growing exactly when the frame loop stops
// advancing.
//
// The SETTLE VERDICT comes from `?surfacestate`'s window.__surfaceState()
// probe (main.ts's SurfaceStateProbe), not the #surfaceProgress text: the
// row hides on completion and — since the ui.ts stale-text fix — clears
// its stale text when it does, but a poll still can't tell
// "hidden because done" from "hidden because nothing has started" from
// text alone, and the row's integer percent floors so it can never
// actually paint 100 even while visible. `probe.settled` is the one
// authoritative source; the pct/textContent scrape stays in the timeline
// for human corroboration only.
//
// This is a probe, not a gate: it always exits 0 and reports whatever
// state it finds (SETTLED / PARKED-WEDGED / PARKED-SPINNING / TIMEOUT).
//
// PARKED-SPINNING IS NOT A RENDERER VERDICT ON THIS SCENE, and the
// two-term shade cost model's A/B measured why. The staleness test reads
// the row's INTEGER percent, and mandelboxKifs at this 512x320 viewport
// resolves roughly ONE percentage point per 80 s of entirely healthy work
// — a settle frame's whole shade phase is ~1.4 points of an 8-pass job —
// so any `--parkMs` under about 150 s calls a working build parked.
// Measured on both sides of that change at `--parkMs=90000`: the
// pre-change build sat at 10% from t=260s to the 400 s cap and reported
// PARKED-SPINNING; the fixed build, which is strictly further along at
// every instant (12% at t=100s where the baseline needed 260 s to reach
// 10%), reported the same thing sooner simply by arriving at a frozen
// integer sooner. So the default
// `--parkMs` is the honest setting, PARKED-WEDGED (the trace log itself
// frozen) is the verdict that means what it says, and SPINNING is worth
// acting on only against a control run of the other build.
//
// Usage: node scripts/fold-settle-park.repro.mjs [--url=https://localhost:5174]
//        [--display=:0] [--capMs=600000] [--parkMs=150000]
import fs from "node:fs";
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const DISPLAY = args.display ?? ":0";
const BASE = args.url ?? "https://localhost:5174";
const CAP_MS = Number(args.capMs ?? 600000);
const PARK_MS = Number(args.parkMs ?? 150000);
const POLL_MS = 5000;
const TRACE_TAIL_PATH = "/tmp/fold-settle-park-trace-tail.txt";

const log = (...a) => console.log("[fold-settle-park]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const enc = (scene) =>
  "#v1=" + Buffer.from(JSON.stringify(scene)).toString("base64url");

const sceneBase = {
  numPoints: 100000,
  pointSize: 1,
  colorMode: "transform",
  renderStyle: "depthFade",
  showGuides: false,
  balloonEcho: false, // balloon OFF — the verify script's first (baseline) leg
  balloonRadius: 1.6,
};

// The REAL mandelboxKifs preset (presets.ts:722) — the surface fold
// monster; eligibility depends on these exact numbers. Copied verbatim
// from scripts/balloon-real-driver.verify.mjs.
const mandelboxKifs = (() => {
  const transforms = [];
  for (const x of [1, -1])
    for (const y of [1, -1])
      for (const z of [1, -1])
        transforms.push({
          position: [x * 0.7, y * 0.7, z * 0.7],
          rotation: [0, 0, 0],
          scale: [0.19, 0.19, 0.19],
          variations: [{ type: "mandelbox", weight: 1.2 }],
        });
  for (const c of [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ])
    transforms.push({
      position: [c[0] * 0.62, c[1] * 0.62, c[2] * 0.62],
      rotation: [0, 0, 0],
      scale: [0.66, 0.66, 0.66],
      variations: [{ type: "boxfold", weight: 1 }],
    });
  return { ...sceneBase, transforms };
})();

/** Reads whichever intel GPU frequency sysfs files exist, across every
 * /sys/class/drm/cardN. Host-side (Node), not the page — the browser has
 * no access to this. */
function readGpuFreqSample() {
  const out = {};
  let cards = [];
  try {
    cards = fs.readdirSync("/sys/class/drm").filter((n) => /^card\d+$/.test(n));
  } catch (e) {
    return { error: String(e) };
  }
  for (const card of cards) {
    const candidates = [
      `/sys/class/drm/${card}/gt_cur_freq_mhz`,
      `/sys/class/drm/${card}/gt/gt0/rps_cur_freq_mhz`,
    ];
    for (const p of candidates) {
      try {
        out[p] = fs.readFileSync(p, "utf8").trim();
      } catch {
        // doesn't exist on this card/kernel — skip
      }
    }
  }
  return out;
}

/** Three GPU-frequency samples, 10s apart, as {tMs, freqs} rows. */
async function sampleGpuFreq3x() {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    samples.push({ tMs: Date.now(), freqs: readGpuFreqSample() });
    if (i < 2) await sleep(10000);
  }
  return samples;
}

/** Best-effort intel_gpu_top snapshot — commonly needs root, so failure is
 * expected and just gets reported, not treated as an error. */
function tryIntelGpuTop() {
  try {
    const out = execSync("timeout 3 intel_gpu_top -J -s 1000", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 6000,
    });
    return { ok: true, output: out.slice(0, 4000) };
  } catch (e) {
    return {
      ok: false,
      error: String(e.stderr?.toString?.() || e.message || e).slice(0, 2000),
    };
  }
}

/** The frame loop's trace lines are always `[NNNms] <kind> BEGIN ...` /
 * `[NNNms] <kind> END ...` pairs (surface-compute.ts's `tr()`), emitted
 * strictly in execution order by a single in-flight async call. If the
 * loop is truly wedged inside a GPU await, no further tr() calls ever
 * fire — so the log stops growing and its last line is frozen exactly on
 * the unmatched BEGIN. That makes "last line is a BEGIN" both necessary
 * and sufficient evidence of a pending await; a fuller BEGIN/END stack
 * match is unreliable here because `final readback BEGIN` has no paired
 * END trace line at all (its completion is only implied by the following
 * `frame done` line), which would false-positive every normal frame.
 */
function findPendingAwait(lines) {
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1];
  return /\bBEGIN\b/.test(last) && !/\bEND\b/.test(last) ? last : null;
}

function distinctAnomalies(lines) {
  const counts = new Map();
  for (const l of lines) {
    if (!l.includes("ANOMALY")) continue;
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return counts;
}

async function sampleFromPage(page) {
  return page.evaluate(() => {
    const prog = document.getElementById("surfaceProgress")?.textContent ?? "";
    const errEl = document.getElementById("renderError");
    const renderError =
      errEl && !errEl.classList.contains("hidden")
        ? errEl.textContent.trim()
        : null;
    const trace = window.__surfaceTraceLog;
    const traceLen = trace ? trace.length : -1;
    const lastLine = trace && trace.length ? trace[trace.length - 1] : "(none)";
    // The settle authority (see header comment) — defined from
    // first paint since `?surfacestate` is on the URL.
    const probe = window.__surfaceState?.() ?? null;
    return { raw: prog, renderError, traceLen, lastLine, probe };
  });
}

async function run() {
  log(
    `starting: url=${BASE} display=${DISPLAY} capMs=${CAP_MS} parkMs=${PARK_MS}`,
  );

  const browser = await chromium.launch({
    executablePath: args.chrome ?? "/usr/bin/google-chrome",
    // HEADED is load-bearing: playwright defaults to headless, and headless
    // Chrome's Vulkan lands on SwiftShader — the app then reports
    // "WebGPU (software)" and this bug (a real-driver GPU await wedge)
    // would never reproduce.
    headless: false,
    env: { ...process.env, DISPLAY },
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
      // Keep the page serviced at full rate regardless of window
      // visibility/focus — an occluded/backgrounded window throttles rAF
      // and would make a real park indistinguishable from a Chrome-side
      // throttle artifact.
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
  });

  const consoleMessages = [];
  const timeline = [];
  let verdict = "UNKNOWN";
  let verdictPct = null;
  let fullTrace = [];

  try {
    const ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 512, height: 320 },
    });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      const t = msg.type();
      if (t === "error" || t === "warning") {
        consoleMessages.push({ type: t, text: msg.text() });
      }
    });
    page.on("pageerror", (e) => {
      consoleMessages.push({ type: "pageerror", text: String(e) });
    });

    const hash = enc(mandelboxKifs);
    const url = `${BASE}/?surfacetrace&surfacestate${hash}`;
    log(`navigating: ${url.slice(0, 100)}...`);
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    // Mutter only sends frame callbacks to VISIBLE surfaces, and the app's
    // settle machinery is present-gated — an occluded window parks it for
    // reasons that have nothing to do with the settle park. Keep the
    // window on top.
    await page.bringToFront();
    await page.waitForTimeout(4000);

    const disabled = await page.evaluate(
      () => document.getElementById("modeSurfaceBtn")?.disabled ?? true,
    );
    if (disabled)
      log("WARNING: #modeSurfaceBtn reports disabled — clicking anyway");
    await page.evaluate(() =>
      document.getElementById("modeSurfaceBtn").click(),
    );
    await page.waitForTimeout(400);

    log("polling every 5s for Full detail progress + trace log growth...");
    const t0 = Date.now();
    let sawFullDetail = false;
    let lastPctValue = null;
    let pctChangedAt = 0;
    let lastTraceLen = null;
    let traceLenChangedAt = 0;
    let finalProbe = null;

    for (;;) {
      const elapsed = Date.now() - t0;
      let sample;
      try {
        sample = await sampleFromPage(page);
      } catch (e) {
        log(`page evaluate failed: ${e}`);
        timeline.push({
          elapsed,
          line: `t=${Math.round(elapsed / 1000)}s PAGE-EVALUATE-FAILED: ${e}`,
        });
        verdict = "PAGE-ERROR";
        verdictPct = lastPctValue;
        break;
      }
      finalProbe = sample.probe;

      if (sample.renderError) {
        log(`RENDER ERROR BANNER: ${sample.renderError}`);
        timeline.push({
          elapsed,
          line: `t=${Math.round(elapsed / 1000)}s RENDER-ERROR: ${sample.renderError}`,
        });
        verdict = "RENDER-ERROR";
        verdictPct = lastPctValue;
        break;
      }

      const m = sample.raw.match(/Full detail[^0-9]*([\d.]+)%/);
      const pctValue = m ? parseFloat(m[1]) : null;
      const pctDisplay =
        pctValue !== null ? `${pctValue}%` : sample.raw || "(empty)";
      const probeDisplay = sample.probe
        ? `settled=${sample.probe.settled} settleActive=${sample.probe.settleActive} previewActive=${sample.probe.previewActive}`
        : "(no probe)";
      const line = `t=${Math.round(elapsed / 1000)}s pct=${pctDisplay} traceLen=${sample.traceLen} last="${sample.lastLine}" probe=[${probeDisplay}]`;
      log(line);
      timeline.push({ elapsed, line });

      if (pctValue !== null) {
        sawFullDetail = true;
        if (lastPctValue === null || pctValue !== lastPctValue) {
          lastPctValue = pctValue;
          pctChangedAt = elapsed;
        }
      }
      if (lastTraceLen === null || sample.traceLen !== lastTraceLen) {
        lastTraceLen = sample.traceLen;
        traceLenChangedAt = elapsed;
      }

      // The probe is the settle AUTHORITY (header comment):
      // declare as soon as it says so, regardless of the pct scrape above
      // (which stays in the timeline purely for corroboration).
      if (sample.probe && sample.probe.settled === true) {
        verdict = "SETTLED";
        verdictPct = pctValue;
        break;
      }
      if (sawFullDetail) {
        const pctStale = elapsed - pctChangedAt >= PARK_MS;
        const traceStale = elapsed - traceLenChangedAt >= PARK_MS;
        if (pctStale && traceStale) {
          verdict = "PARKED-WEDGED";
          verdictPct = lastPctValue;
          break;
        }
        if (pctStale && !traceStale) {
          verdict = "PARKED-SPINNING";
          verdictPct = lastPctValue;
          break;
        }
      }
      if (elapsed >= CAP_MS) {
        verdict = "TIMEOUT";
        verdictPct = lastPctValue;
        break;
      }
      await page.waitForTimeout(POLL_MS);
    }

    log(
      `VERDICT: ${verdict} (pct=${verdictPct ?? "n/a"}) probe=${JSON.stringify(finalProbe)}`,
    );

    // GPU frequency + intel_gpu_top, taken right after declaring (allowed
    // by the brief in lieu of sampling inside the final 60s before —
    // simpler and just as valid since the pose/GPU state is frozen either
    // way once we've already declared).
    log("sampling GPU frequency 3x10s apart...");
    const gpuFreqSamples = await sampleGpuFreq3x();
    log("trying intel_gpu_top once (may fail without root)...");
    const gpuTopResult = tryIntelGpuTop();

    try {
      fullTrace = await page.evaluate(() => window.__surfaceTraceLog ?? []);
    } catch (e) {
      log(`failed to read final trace log: ${e}`);
      fullTrace = [];
    }

    // ---- Report -----------------------------------------------------
    const last250 = fullTrace.slice(-250);
    const tailDump =
      `# fold-settle-park trace tail — verdict=${verdict} pct=${verdictPct ?? "n/a"} ` +
      `fullTraceLen=${fullTrace.length} dumped=${last250.length}\n` +
      last250.join("\n") +
      "\n";
    fs.writeFileSync(TRACE_TAIL_PATH, tailDump, "utf8");

    console.log("\n=== LAST 250 TRACE LINES (verbatim) ===");
    console.log(tailDump);
    console.log(`(also written to ${TRACE_TAIL_PATH})`);

    console.log("\n=== FULL TIMELINE ===");
    for (const t of timeline) console.log(t.line);

    const pending = findPendingAwait(fullTrace);
    console.log("\n=== PENDING AWAIT ===");
    console.log(
      pending
        ? `last line of trace log is an unmatched BEGIN: ${pending}`
        : "none — last trace line is not a bare BEGIN",
    );

    const anomalies = distinctAnomalies(fullTrace);
    console.log("\n=== ANOMALY LINES (distinct) ===");
    if (anomalies.size === 0) {
      console.log("none observed");
    } else {
      for (const [text, count] of anomalies) {
        console.log(`x${count}: ${text}`);
      }
    }

    console.log("\n=== GPU FREQUENCY SAMPLES ===");
    for (const s of gpuFreqSamples) {
      console.log(
        `t=${new Date(s.tMs).toISOString()} ${JSON.stringify(s.freqs)}`,
      );
    }

    console.log("\n=== intel_gpu_top ===");
    if (gpuTopResult.ok) {
      console.log(gpuTopResult.output);
    } else {
      console.log(`failed (expected without root): ${gpuTopResult.error}`);
    }

    console.log("\n=== CONSOLE MESSAGES (error/warning/pageerror) ===");
    if (consoleMessages.length === 0) {
      console.log("none observed");
    } else {
      for (const c of consoleMessages) console.log(`[${c.type}] ${c.text}`);
    }

    console.log("\n=== FINAL PROBE (window.__surfaceState() at declare) ===");
    console.log(JSON.stringify(finalProbe, null, 2));

    console.log(`\n=== SUMMARY ===`);
    console.log(
      `verdict=${verdict} pct=${verdictPct ?? "n/a"} probeSettled=${finalProbe ? finalProbe.settled : "n/a"} fullTraceLen=${fullTrace.length} ` +
        `elapsedTotalS=${Math.round((Date.now() - t0) / 1000)}`,
    );
  } finally {
    await browser.close();
  }
}

run()
  .catch((e) => {
    console.error("[fold-settle-park] ERROR:", e);
  })
  .finally(() => {
    // Probe, not a gate — always exit 0 regardless of verdict.
    process.exit(0);
  });
