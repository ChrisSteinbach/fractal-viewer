#!/usr/bin/env node
/**
 * The regression gate for the WebGPU flame-accumulation backend's
 * teardown race — `GpuFlameBackend` (src/app/flame-gpu-backend.ts), the
 * module one dimension over from `SurfaceComputeRenderer`
 * (scripts/surface-teardown.verify.mjs), which this script is a close
 * sibling of: same launch, same toggle-storm shape, same crash-detection
 * idiom, same exit-code family. Read that file first if this one is
 * confusing — the two are meant to read as one pair.
 *
 * EXIT CODES: 0 = clean sweep — every toggle survived, the GPU backend was
 * CONFIRMED up (not CPU, not a software adapter), and restarts were actually
 * observed landing. 3 = REPRODUCED — the browser died or a case threw. 2 =
 * INCONCLUSIVE, rerun — either the GPU flame backend never came up (CPU or
 * software adapter) or the storm never actually caught a restart in
 * progress; either way the gate never exercised the code path under test,
 * and must NOT be reported as a pass. 1 = harness failure (a
 * Playwright/launch problem unrelated to the invariant under test).
 *
 * INVARIANT PROTECTED: `GpuFlameBackend.destroy()` used to free its eleven
 * GPUBuffers and then the GPUDevice synchronously, even with a
 * `snapshotDisplay()` parked on `displayStagingBuffer.mapAsync(...)` over a
 * submitted `copyBufferToBuffer` — or `accumulate()` parked on
 * `device.queue.onSubmittedWorkDone()` over a submitted dispatch.
 * `flame-worker-core.ts`'s `startAccumulation` calls that `destroy()`
 * SYNCHRONOUSLY on every live `setPalette`/`setSupersample`/`setSymmetry`
 * restart — precisely so a superseded in-flight chunk does not outlive its
 * backend — which means every ordinary palette swap during a long GPU render
 * used to tear the device down out from under whichever op was in flight at
 * that instant. Tearing a WebGPU device down under live submitted work is
 * what killed the WHOLE Firefox process in that sibling module, not a
 * tab crash and not a device-loss toast. The fix mirrors that module's
 * exactly: `destroy()` defers the real `device.destroy()` until every
 * in-flight op unwinds (an `opsInFlight` counter incremented by `beginOp`
 * and released in
 * a `finally`), while keeping the synchronous teardown path when the backend
 * IS idle. See that class's own doc for the full state-machine account.
 *
 * MEASURED (Firefox 151, the Playwright build, headed on DISPLAY=:0; the
 * `swirl` preset at supersample 2, i.e. a 2560x1440 accumulation with a
 * 113 MiB histogram and equal staging; adapter reporting 1024 MiB
 * maxStorageBufferBindingSize):
 *
 *   NOT REPRODUCED ON THIS STACK, in EITHER direction. The pre-fix module —
 *   eleven `GPUBuffer.destroy()` calls and then `device.destroy()`, with
 *   every restart landing on an op in flight — swept 12/12 palette toggles
 *   clean, and the fixed module swept 12/12 clean as well. So what this
 *   file gates is a REGRESSION, not a reproduction: it proves the storm
 *   actually reaches the code path (12/12 restarts observed, each one a
 *   fresh `Flame GPU: backend up on ...` line, GPU backend confirmed and
 *   never flipping to CPU) and that the teardown survives it — without
 *   claiming the browser-process kill measured one module over is
 *   reachable from here. Whether another implementation, adapter or timing
 *   reproduces it is untested, which is exactly why the fix is not
 *   conditioned on a browser: freeing a mapped buffer, or a device, under
 *   live submitted GPU work is wrong wherever it runs.
 *
 *   The other arms, fixed module, all exit 0:
 *   `--toggleId=flameSupersampleSlider` 2/2 restarts (the accumulation
 *   resolution toggling 2560x1440 <-> 1280x720 as it should);
 *   `--toggleId=symmetryOrderSlider` 1/2, the first toggle a correct no-op
 *   because order 1 matched the already-loaded default (`setSymmetry`'s own
 *   equality guard); `--toggleId=__modeExit` 2/2.
 *
 *   TILING ARM, MEASURED 2026-09-02 (same Firefox build, headed DISPLAY=:0,
 *   `--tiling=a3 --toggles=12`): exit 0, gpu=true, restarts=11/12 (the
 *   equality-guarded no-op slot as in the symmetry arm), backend never
 *   flipped to CPU, and the authored `{group:"a3"}` block was read back from
 *   the panel identical before and after the storm — the palette storm now
 *   runs the TILED accumulation (binding-8 plot adapter, 32-image bounded
 *   estimator) through every teardown it reaches. A 2-toggle smoke of the
 *   same arm earlier returned exit 2 INCONCLUSIVE (no backend-up count at
 *   that toggle depth) with tilingBefore/After already exact, which is the
 *   inconclusive-not-pass discipline the header demands of a run that never
 *   exercised the path.
 *
 * ARMS:
 *
 *   --toggleId=flamePalette (default)
 *                 the cleanest trigger: `setPalette` in flame-worker-core.ts
 *                 has NO equality guard, so every toggle calls
 *                 `startAccumulation` — and therefore `backend.destroy()` —
 *                 unconditionally, regardless of whether the picked palette
 *                 differs from the current one.
 *   --toggleId=flameSupersampleSlider
 *                 restarts only when the EFFECTIVE accumulation size
 *                 actually changes (`setSupersample`'s own guard), so the
 *                 storm cycles the slider's full min..max range to make sure
 *                 consecutive toggles differ.
 *   --toggleId=symmetryOrderSlider
 *                 restarts on any order change (`setSymmetry`'s guard is on
 *                 the whole order/plane/twist tuple), but ALSO regenerates
 *                 the underlying point cloud, so it is a noisier trigger than
 *                 the two above.
 *   --toggleId=__modeExit
 *                 informational, not a regression arm for THIS fix.
 *                 Leaving Flame mode does not call `GpuFlameBackend.destroy()`
 *                 at all — main.ts tears the session down by calling
 *                 `worker.terminate()`, which orphans any live `mapAsync`
 *                 through a completely different mechanism (the worker
 *                 thread itself disappears out from under the pending
 *                 promise, rather than the device being destroyed under it).
 *                 That is a SEPARATE vector this fix cannot cover by
 *                 construction. It is included here for information only:
 *                 if this arm crashes while the palette arm stays clean,
 *                 that is a NEW finding to file, not a regression of this
 *                 fix. Simulated by clicking Points then Flame again from
 *                 inside the toggle loop, re-entering through
 *                 `#modeFlameBtn` directly (a mode switch touches only
 *                 `AppState.renderMode`, session-only and untouched by the
 *                 scene document, so the SAME system loaded by `--preset` is
 *                 still there to re-enter with).
 *   --toggles=N   the toggle-storm arm. One page, one flame session, and a
 *                 trigger (a palette/supersample/symmetry-order control, or
 *                 a mode exit) fired N times while a long GPU accumulation is
 *                 still running, so every toggle lands mid-flight against a
 *                 backend with GPU work still submitted.
 *   --iterations=N
 *                 sets `#flameIterationsSlider` to DETENT INDEX N (0-10;
 *                 see src/app/state.ts's `FLAME_ITERATION_DETENTS`, a 1-2-5
 *                 series from 1M to 2B) immediately after entering Flame
 *                 mode, so the accumulation runs for minutes rather than
 *                 seconds and every toggle in the storm necessarily lands
 *                 mid-chunk. Default 10 — the slider's own max — is the most
 *                 conservative choice: it costs nothing on a slow adapter
 *                 (the render just keeps not-finishing) and is the only
 *                 value that guarantees an in-flight backend regardless of
 *                 how fast a given GPU chews through iterations.
 *
 * RUN (needs a real Firefox build with WebGPU on a display, and the dev
 * server already up — this script does not spawn one):
 *
 *   npm run dev &
 *   node scripts/flame-teardown.verify.mjs --toggles=20 --toggleGapMs=700
 *
 * FLAGS:
 *   --url=URL         dev server origin (default https://localhost:5173)
 *   --display=:N       X display Firefox renders on (default :0)
 *   --preset=NAME       flame-hinted preset to select from #presetSelect,
 *                       the door that auto-enters Flame mode (default swirl
 *                       — see src/fractal/presets.ts's PRESET_RENDER_HINTS)
 *   --toggleId=ID       #id of the control to storm, or the sentinel
 *                       __modeExit (default flamePalette)
 *   --toggles=N         number of toggles to fire (default 12)
 *   --toggleGapMs=N     milliseconds between toggles (default 700)
 *   --iterations=N      flameIterationsSlider detent index, 0-10 (default 10)
 *   --viewport=WxH      browser viewport (default 1280x720)
 *   --headless          run headless (default headed)
 *   --tiling=<preset>  enable a space-tiling block in the scene document before
 *                       entering Flame mode — currently only `a3` is accepted.
 *                       Requires `--toggles=N` together. Tiling edits reach
 *                       `startAccumulation` exactly like palette edits, so the
 *                       storm now runs the tiled accumulation; retention is
 *                       asserted before/after.
 *
 * Proving the storm isn't vacuous, two different ways: (1) the GPU backend
 * check — `#flameBackendNote`'s text must start with "GPU accumulation" AND
 * the element must NOT carry the `flame-note` class (that class means a
 * SOFTWARE/SwiftShader-class adapter, which is CPU-shaped for this bug's
 * purposes even though the code path is nominally "gpu") — read once right
 * after entering Flame mode, and (2) actually observing restarts land: each
 * `createBackendForProgram` success prints exactly one
 * "Flame GPU: backend up on ..." console line (the create-time
 * breadcrumb), so counting THOSE across the storm is a direct count of how
 * many times `GpuFlameBackend.destroy()` actually got called against a live
 * successor. Both must hold for exit 0; see the EXIT CODES paragraph above
 * for how each failure mode maps to a code.
 *
 * `#flameProgress`'s text (e.g. "12M / 20M iterations (61%)") is ALSO
 * sampled before/after every toggle and logged, but only as auxiliary
 * diagnostic text — measured empirically NOT to be a reliable restart
 * signal at this gate's own default settings: a --toggleGapMs cadence
 * faster than one fresh backend's ramp-up (device request, buffer/pipeline
 * setup, the warmup dispatch's own `onSubmittedWorkDone()` await) can keep
 * `iterationsDone` — and therefore the displayed percentage — pinned at a
 * rounded "0%" for the WHOLE storm even while every single toggle is
 * genuinely tearing down and rebuilding a backend — this shape was actually
 * observed while calibrating this script, at `--iterations=10` against a
 * 600ms toggle cadence: the console-line count read exactly one restart per
 * toggle while `#flameProgress` sat at "0.0M / 2B iterations (0%)" the
 * entire run. A percentage that never leaves "0%" cannot be observed to
 * drop, so it would have read that same storm as zero restarts — the
 * opposite of a false pass, but still a wrong number, which is why it is
 * not what gates the exit code.
 *
 * The backend note is re-written after every restart (the
 * one-time-per-backend `"backend"` event), so it is also resampled per
 * toggle to catch the worker's own GPU-failure ladder falling back to CPU
 * mid-storm — reported as an anomaly in the summary row, not folded into
 * the crash verdict.
 */
import { firefox } from "/home/christians/src/fractal/node_modules/playwright-core/index.mjs";
import os from "node:os";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

// The dev server's port, matching surface-teardown.verify.mjs. This gate
// exercises renderer/backend LIFECYCLE, not built output, so `npm run dev`
// is the cheaper and equally valid host; pass --url to point it anywhere
// else.
const BASE = args.url ?? "https://localhost:5173";
const DISPLAY = args.display ?? ":0";
const PRESET = args.preset ?? "swirl";
const TOGGLE_ID = args.toggleId ?? "flamePalette";
const TOGGLES = Number(args.toggles ?? 12);
const TOGGLE_GAP_MS = Number(args.toggleGapMs ?? 700);
// index into FLAME_ITERATION_DETENTS (state.ts) — 0..10, see this file's
// header doc for why 10 (the slider's own max, 2,000,000,000) is the
// conservative default.
const ITERATIONS_INDEX = Number(args.iterations ?? 10);
const TILING = args.tiling ?? null;
if (TILING !== null && TILING !== "a3") {
  throw new Error("--tiling currently accepts only a3");
}
if (TILING !== null && args.toggles === undefined) {
  throw new Error("--tiling qualification requires --toggles=N");
}
const EXPECTED_TILING = TILING === "a3" ? { group: "a3" } : null;
const FIREFOX_BIN = path.join(
  os.homedir(),
  ".cache/ms-playwright/firefox-1532/firefox/firefox",
);
const [vw, vh] = String(args.viewport ?? "1280x720")
  .split("x")
  .map(Number);
const VIEWPORT = { width: vw || 1280, height: vh || 720 };

const enc = (s) =>
  "#v1=" + Buffer.from(JSON.stringify(s)).toString("base64url");

/** The "swirl" preset's transforms (src/fractal/presets.ts's swirlFlame),
 * transcribed plain Node, no TS loader. */
function swirlTransforms() {
  const base = [
    {
      id: -1, // id will be assigned by the app
      position: [0.35, 0.25, 0],
      rotation: [0, 0, 0.5],
      scale: [0.7, 0.7, 0.7],
    },
    {
      id: -1,
      position: [-0.45, -0.2, 0.15],
      rotation: [0.25, 0, 1.3],
      scale: [0.55, 0.55, 0.55],
    },
  ];
  // withVariations adds the same variation blend to every map
  const variations = [
    { type: "swirl", weight: 1 },
    { type: "linear", weight: 0.2 },
  ];
  return base.map((t) => ({ ...t, variations }));
}

/** Create a scene document for the given preset with optional tiling. */
function sceneForPreset(presetName) {
  if (presetName !== "swirl") {
    throw new Error(`Only "swirl" preset is supported for tiling arm`);
  }
  const scene = {
    transforms: swirlTransforms(),
    numPoints: 100000,
    pointSize: 1,
    colorMode: "transform",
    renderStyle: "depthFade",
    showGuides: false,
    ...(EXPECTED_TILING ? { tiling: EXPECTED_TILING } : {}),
  };
  return scene;
}

const log = (...a) => console.log("[flame-teardown]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// How long a toggle's effect needs to sit before "after" reliably reflects
// it: the DOM update round-trips through a worker postMessage
// (dispatch -> command handler -> startAccumulation -> "restarted" event ->
// main.ts -> ui.setFlameProgress), which does not land inside the same
// synchronous evaluate() call that fired the toggle. Carved OUT of
// TOGGLE_GAP_MS (not added on top) so --toggleGapMs stays the true
// dispatch-to-dispatch cadence.
const SETTLE_MS = Math.min(300, Math.max(50, Math.floor(TOGGLE_GAP_MS / 3)));
const PRE_TOGGLE_SLEEP_MS = Math.max(0, TOGGLE_GAP_MS - SETTLE_MS);

async function launch() {
  return firefox.launch({
    executablePath: FIREFOX_BIN,
    headless: Boolean(args.headless),
    env: { ...process.env, DISPLAY, MOZ_WEBRENDER: "1" },
    firefoxUserPrefs: {
      "dom.webgpu.enabled": true,
      "gfx.webgpu.ignore-blocklist": true,
    },
  });
}

/** Poll `#flameBackendNote` until it has landed (non-hidden, non-empty) or
 * `timeoutMs` elapses. Returns `{ text, software }` or `null` on timeout —
 * the element carries `flame-note` (not `flame-note-info`) exactly when the
 * adapter behind a "gpu" backend is a software/SwiftShader-class one
 * (ui.ts's `setFlameBackendNote`), which for this bug's purposes is CPU-
 * shaped: there's no real device to race a teardown against. */
async function waitForBackendNote(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await page.evaluate(() => {
      const el = document.getElementById("flameBackendNote");
      if (!el) return null;
      const text = (el.textContent ?? "").trim();
      if (el.classList.contains("hidden") || !text) return null;
      return { text, software: el.classList.contains("flame-note") };
    });
    if (info) return info;
    await sleep(250);
  }
  return null;
}

const isGpuConfirmed = (info) =>
  Boolean(info && info.text.startsWith("GPU accumulation") && !info.software);

/** Pull the percentage out of `#flameProgress`'s "N / M iterations (P%)"
 * text (ui.ts's `setFlameProgress`). `null` for the pre-first-chunk "0%"
 * placeholder text (index.html's hardcoded initial content) or anything
 * else that doesn't carry the parenthesized form. */
function parsePct(text) {
  if (!text) return null;
  const m = /\((\d+)%\)/.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Apply ONE toggle inside the page and sample `#flameProgress` /
 * `#flameBackendNote` both before dispatching and after `settleMs` of
 * round-trip time — run inside a single `page.evaluate` (an async function,
 * so the settle wait happens in-page rather than costing a second
 * round-trip). Three control shapes, all reached by the documented triggers:
 * a <select> (flamePalette) cycles through its own options (skipping
 * "custom", which needs a populated custom-palette row this storm never
 * builds); a checkbox toggles `.checked`; anything else is treated as a
 * <input type=range> and cycles its own min..max..step, index by toggle
 * number, so consecutive toggles always land on a different value even
 * against a guarded setter like setSupersample/setSymmetry. The sentinel
 * `__modeExit` ignores `id` entirely and clicks Points then Flame again —
 * `#modeFlameBtn` re-enters with whatever system is already loaded (a mode
 * switch touches only `AppState.renderMode`, which is session-only and
 * doesn't disturb the scene document), so no preset re-selection is needed.
 */
async function applyToggle(page, id, i, settleMs) {
  return page.evaluate(
    async ({ id, i, settleMs }) => {
      const rowText = () =>
        (document.getElementById("flameProgress")?.textContent ?? "").trim();
      const backendInfo = () => {
        const el = document.getElementById("flameBackendNote");
        if (!el) return null;
        return {
          text: (el.textContent ?? "").trim(),
          software: el.classList.contains("flame-note"),
        };
      };
      const before = rowText();
      let applied;
      if (id === "__modeExit") {
        document.getElementById("modePointsBtn")?.click();
        document.getElementById("modeFlameBtn")?.click();
        applied = "mode-exit";
      } else {
        const el = document.getElementById(id);
        if (!el) return { ok: false };
        if (el.tagName === "SELECT") {
          const values = Array.from(el.options, (o) => o.value).filter(
            (v) => v !== "custom",
          );
          applied = values[i % values.length];
          el.value = applied;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (el.type === "checkbox") {
          el.checked = !el.checked;
          applied = String(el.checked);
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          const min = Number(el.min || 0);
          const max = Number(el.max || 1);
          const step = Number(el.step || 1);
          const count = Math.round((max - min) / step) + 1;
          applied = String(min + (i % count) * step);
          el.value = applied;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      await new Promise((r) => setTimeout(r, settleMs));
      return {
        ok: true,
        applied,
        before,
        after: rowText(),
        backend: backendInfo(),
      };
    },
    { id, i, settleMs },
  );
}

/**
 * The toggle-storm run: one page, one Flame session entered through the
 * `--preset` door, a long iterations budget so a chunk is always in flight,
 * then `--toggles` firings of `--toggleId` `--toggleGapMs` apart. Resolves a
 * result record; a thrown/browser-gone condition is reported, never
 * rethrown, mirroring surface-teardown.verify.mjs's `runToggleArm`.
 */
async function runFlameStorm(browser) {
  const lines = [];
  // Bumped by the console listener below on every
  // "Flame GPU: backend up on ..." line (createBackendForProgram's one
  // create-time breadcrumb) — see this function's doc for why this,
  // and not the #flameProgress percentage, is the restart signal that
  // actually gates exit 0/2.
  let backendUpCount = 0;
  const result = {
    label: `${PRESET} [${TOGGLES}x ${
      TOGGLE_ID === "__modeExit" ? "mode exit" : TOGGLE_ID
    } @${TOGGLE_GAP_MS}ms]`,
    outcome: "ok",
    detail: "",
    backend: "",
    gpuConfirmed: false,
    backendFlipped: false,
    togglesRun: 0,
    restartsObserved: 0,
    lastRow: "",
    lines,
    tilingBefore: null,
    tilingAfter: null,
  };
  let ctx;
  try {
    ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: VIEWPORT,
    });
    const page = await ctx.newPage();
    page.on("console", (m) => {
      const t = m.text();
      if (/flame|gpu|webgpu|device|adapter|error/i.test(t)) {
        lines.push(`[${m.type()}] ${t}`);
      }
      if (t.includes("Flame GPU: backend up on")) backendUpCount++;
    });
    page.on("pageerror", (e) => lines.push(`[pageerror] ${String(e)}`));
    page.on("crash", () => lines.push("[page] CRASHED"));

    const url =
      TILING !== null ? `${BASE}/${enc(sceneForPreset(PRESET))}` : `${BASE}/`;

    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await sleep(2500);

    // Read tiling state if tiling is enabled
    if (TILING !== null) {
      const before = await page.evaluate(() => {
        const checkbox = document.getElementById("tilingEnabledCheckbox");
        const group = document.getElementById("tilingGroup");
        return {
          tiling:
            checkbox?.checked === true && group?.value
              ? { group: group.value }
              : null,
        };
      });
      result.tilingBefore = before.tiling;
    }

    // Boot readiness (isolation-reload.verify.mjs's own idiom): wait for the
    // FIRST real chaos-game render before touching any control — measured
    // during this gate's own calibration to matter on a loaded machine
    // (multiple real Firefox processes sharing one GPU/display), where a
    // fixed post-goto sleep alone twice let #presetSelect's "change" fire
    // before the app had finished wiring itself up, timing out the
    // aria-pressed wait below entirely.
    await page.waitForFunction(
      () => {
        const el = document.getElementById("pointCount");
        if (!el) return false;
        return Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
      },
      undefined,
      { timeout: 30000, polling: 100 },
    );

    // Only use preset selection if we didn't already load via hash
    if (TILING === null) {
      await page.selectOption("#presetSelect", PRESET);
      await page.waitForFunction(
        () =>
          document
            .getElementById("modeFlameBtn")
            ?.getAttribute("aria-pressed") === "true",
        undefined,
        { timeout: 30000, polling: 100 },
      );
    } else {
      // With tiling, we already have the scene loaded via hash
      // Need to enter Flame mode manually
      await page.evaluate(() => {
        document.getElementById("modeFlameBtn")?.click();
      });
      await page.waitForFunction(
        () =>
          document
            .getElementById("modeFlameBtn")
            ?.getAttribute("aria-pressed") === "true",
        undefined,
        { timeout: 30000, polling: 100 },
      );
    }

    // Set the iterations budget high right away, before the storm starts, so
    // every toggle below necessarily lands against a still-running
    // accumulation. setIterationsBudget only EXTENDS the current run — it
    // does not restart it — so this cannot race the backend this preset just
    // started standing up.
    await page.evaluate((idx) => {
      const el = document.getElementById("flameIterationsSlider");
      if (el) {
        el.value = String(idx);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, ITERATIONS_INDEX);

    const initialBackend = await waitForBackendNote(page, 15000);
    result.backend = initialBackend?.text ?? "(never appeared)";
    result.gpuConfirmed = isGpuConfirmed(initialBackend);
    log(
      `    backend="${result.backend}"${initialBackend?.software ? " [software]" : ""} gpuConfirmed=${result.gpuConfirmed}`,
    );
    // Let the first real chunk land so the very first toggle's "before"
    // sample is a genuine in-progress percentage, not the "0%" placeholder.
    await sleep(1500);
    let prevBackendUpCount = backendUpCount;

    for (let i = 0; i < TOGGLES; i++) {
      await sleep(PRE_TOGGLE_SLEEP_MS);
      const state = await applyToggle(page, TOGGLE_ID, i, SETTLE_MS);
      if (!state.ok) {
        result.detail = `no #${TOGGLE_ID} found in the page`;
        break;
      }
      result.togglesRun++;
      if (state.after) result.lastRow = state.after;
      // The PRIMARY signal: did a new GpuFlameBackend actually get
      // constructed since the last toggle? (See this function's doc — at a
      // high iterations budget and a toggle cadence faster than one
      // backend's ramp-up, #flameProgress can sit at a rounded "0%" for the
      // WHOLE storm even though every toggle is genuinely tearing down and
      // rebuilding a backend; the percentage read below is kept only as
      // auxiliary diagnostic text in the log line, never as the count that
      // gates exit 0 vs 2.)
      const landed = backendUpCount > prevBackendUpCount;
      prevBackendUpCount = backendUpCount;
      if (landed) result.restartsObserved++;
      if (state.backend) {
        // A blank note (worker mid-recreate, hasn't reported its new
        // backend yet — normal right after __modeExit's full worker
        // terminate()+restart) is NOT the same finding as an actual
        // GPU-failure-ladder fallback, so only an explicit "CPU
        // accumulation..." reading counts as the anomaly.
        const nowCpu = state.backend.text.startsWith("CPU accumulation");
        if (result.gpuConfirmed && nowCpu && !result.backendFlipped) {
          result.backendFlipped = true;
          result.detail =
            (result.detail ? result.detail + "; " : "") +
            `backend fell back to "${state.backend.text}" at toggle ${i + 1}`;
        }
      }
      const beforePct = parsePct(state.before);
      const afterPct = parsePct(state.after);
      log(
        `      toggle ${i + 1}/${TOGGLES} applied=${state.applied} ${
          landed ? "RESTARTED" : "no-restart"
        } pct=${beforePct ?? "?"}%->${afterPct ?? "?"}% row="${state.after}"`,
      );
    }
    // A backend that was still mid-construction (device request, pipeline
    // creation, shader compile) when the LAST toggle's settle window closed
    // would otherwise never get credited — nothing checks the counter again
    // after the loop ends. This drain lets a late-arriving final restart
    // still land in the tally.
    await sleep(1500);
    if (backendUpCount > prevBackendUpCount) result.restartsObserved++;

    // Read tiling state after the storm
    if (TILING !== null) {
      const after = await page.evaluate(() => {
        const checkbox = document.getElementById("tilingEnabledCheckbox");
        const group = document.getElementById("tilingGroup");
        return {
          tiling:
            checkbox?.checked === true && group?.value
              ? { group: group.value }
              : null,
        };
      });
      result.tilingAfter = after.tiling;

      // Qualification checks similar to surface-teardown
      const qualificationFailures = [];
      if (
        JSON.stringify(result.tilingBefore) !== JSON.stringify(EXPECTED_TILING)
      ) {
        qualificationFailures.push(
          `before tiling=${JSON.stringify(result.tilingBefore)}`,
        );
      }
      if (result.togglesRun !== TOGGLES) {
        qualificationFailures.push(`toggles=${result.togglesRun}/${TOGGLES}`);
      }
      if (
        JSON.stringify(result.tilingAfter) !== JSON.stringify(EXPECTED_TILING)
      ) {
        qualificationFailures.push(
          `after tiling=${JSON.stringify(result.tilingAfter)}`,
        );
      }
      if (qualificationFailures.length > 0) {
        result.outcome = "QUALIFICATION FAILED";
        result.detail = qualificationFailures.join("; ");
      }
    }

    await ctx.close();
    return result;
  } catch (e) {
    result.outcome = "CRASH/ERROR";
    result.detail = String(e).split("\n")[0];
    try {
      await ctx?.close();
    } catch {
      /* the context is gone with the browser — that IS the signal */
    }
    return result;
  }
}

async function main() {
  log(
    `url=${BASE} preset=${PRESET} toggleId=${TOGGLE_ID} toggles=${TOGGLES} toggleGapMs=${TOGGLE_GAP_MS} iterationsIdx=${ITERATIONS_INDEX} tiling=${TILING ?? "off"}`,
  );
  const browser = await launch();
  const r = await runFlameStorm(browser);
  const browserAlive = browser.isConnected();
  if (!browserAlive) {
    r.outcome = "BROWSER DIED";
    log("    !!! FIREFOX DIED DURING THIS RUN !!!");
  } else if (r.outcome === "CRASH/ERROR") {
    log("    !!! CASE THREW !!!");
  }
  log(
    `    ${r.outcome} | gpu=${r.gpuConfirmed} | restarts=${r.restartsObserved}/${r.togglesRun} | flipped=${r.backendFlipped} | row="${r.lastRow}" ${r.detail ? "| " + r.detail : ""}`,
  );
  if (TILING !== null) {
    log(
      `    tiling before=${JSON.stringify(r.tilingBefore)} after=${JSON.stringify(r.tilingAfter)}`,
    );
  }
  for (const l of r.lines.slice(-8)) log(`      ${l}`);
  if (browserAlive) await browser.close().catch(() => {});

  console.log("\n=== summary ===");
  console.log(
    `${r.label.padEnd(46)} ${r.outcome.padEnd(14)} gpu=${String(r.gpuConfirmed).padEnd(5)} restarts=${String(r.restartsObserved).padEnd(3)}/${String(r.togglesRun).padEnd(3)} flipped=${String(r.backendFlipped).padEnd(5)} backend="${r.backend}"${TILING !== null ? ` tilingBefore=${JSON.stringify(r.tilingBefore)} tilingAfter=${JSON.stringify(r.tilingAfter)}` : ""}`,
  );

  const reproduced =
    r.outcome === "CRASH/ERROR" ||
    r.outcome === "BROWSER DIED" ||
    r.outcome === "QUALIFICATION FAILED";
  // A pass that never actually caught the fix's own precondition — a GPU
  // backend, restarted while genuinely in flight — would be exactly the
  // vacuous "looks clean because it tested nothing" result this gate exists
  // to refuse (see the header doc's EXIT CODES paragraph).
  const inconclusive =
    !reproduced && (!r.gpuConfirmed || r.restartsObserved === 0);
  if (reproduced) {
    console.log("REPRODUCED: the browser died or a case threw.");
    process.exit(3);
  }
  if (inconclusive) {
    console.log(
      "INCONCLUSIVE: " +
        (!r.gpuConfirmed
          ? "the GPU flame backend never came up (CPU or software adapter)"
          : "no restart was observed landing") +
        " — rerun.",
    );
    process.exit(2);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[flame-teardown] harness failure:", e);
  process.exit(1);
});
