#!/usr/bin/env node
/**
 * fr-kz2p repro: does a Save-PNG surface export actually stall/crash at
 * extreme wheel-out zoom, and are the two symptoms the same thing?
 *
 * BACKGROUND. While measuring capture-export.verify.mjs's PNG-floor fixture
 * (fr-vja8.68), the gate agent tried a backdrop-only export at 32 and 48
 * wheel ticks (x1.1 dolly each, same recipe as that script) on the default
 * preset at 660x410 and could not get a Save-PNG to complete either way —
 * 32 ticks stalled past the gate's own 240s bound, 48 ticks reportedly
 * crashed the renderer. Both were observed ONCE on SwiftShader with no
 * repro script kept (fr-kz2p's own text). This script is that repro,
 * generalized to either tick count via `--ticks`.
 *
 * WHAT IT SEPARATES. The bead's own framing, which reading strip-planner.ts
 * and scene.ts's capture path supports: a "stall" may just be EXPECTED
 * cost, not a bug. Three unrelated, independently-documented design
 * decisions compound at this exact pose:
 *   1. Save-PNG supersamples 8x (fr-jf9y, `SURFACE_STRIP_SETTLE_SAMPLES`) —
 *      EIGHT full-tier drains of the same frame, not one.
 *   2. Every strip is capped at STRIP_WORST_CASE_CAP_MS worth of
 *      class-pessimistic `worstMsPerPx` (fr-096u's discontinuity guard,
 *      strip-planner.ts) — for the default preset's affine DE that is
 *      floor(4000 / 0.1) = 40000px/strip, REGARDLESS of how cheap a
 *      near-empty frame actually measures. A 660x410 frame (270600px)
 *      therefore never collapses below ~7 strips per pass no matter how
 *      degenerate the zoom, so the safety net that exists to keep a single
 *      submission watchdog-safe also puts a floor under the strip COUNT.
 *   3. The interactive Save-PNG carries NO cost ceiling (fr-avf6) and NO
 *      automatic give-up (fr-24to/fr-zx34) — it grinds however long that
 *      takes, by design, disclosing coverage instead of refusing.
 * If (1)x(2) x a slow-but-nonzero SwiftShader per-strip sync cost adds up
 * to minutes, that is (1)+(2)+(3) working exactly as documented, not a new
 * defect — this script's job is to show whether that arithmetic actually
 * accounts for what happens, or whether progress genuinely stops (a real
 * hang) or the page/GPU process actually dies (a real crash).
 *
 * INSTRUMENTS.
 *   - `?surfacestate` — the settle-latch probe (`window.__surfaceState()`,
 *     fr-opgk), read for `engine` (compute vs webgl — this fixture forces
 *     webgl, see below) and `settled`.
 *   - `?surfperf` — scene.ts's own strip-pump diagnostics. NOTE: its
 *     per-batch/per-strip lines are gated on `busyMs > SURFPERF_HEAVY_STRIP_MS`
 *     (500ms), so a run that never logs a single heavy strip is NOT
 *     evidence of silence/hang — it means every batch measured under
 *     500ms. The `[surfperf] capture <outcome>` line fires exactly once,
 *     at the END of each full-tier drain (i.e. up to 8 times per export,
 *     one per supersample pass) — its ABSENCE across the whole run is the
 *     more useful signal that no pass has finished yet.
 *   - `?surfacetrace` — fr-d6g5's compute-renderer frame trace. Included
 *     for completeness/confirmation only: this script forces `surfacegl`
 *     (matching capture-export.verify.mjs's own fixture, and the fixture
 *     the original observation used), so the compute renderer never
 *     initializes and this trace log is expected to stay EMPTY throughout.
 *     A non-empty trace log would mean the fixture silently routed to
 *     compute and should be treated as a surprise, not corroboration.
 *   - The export modal's own DOM (#exportModal/#exportDetail/#exportProgress)
 *     — the fr-7mfx disclosed-coverage text, scraped every poll.
 *   - A `webglcontextlost` tripwire on the canvas (house convention, see
 *     capture-drain.verify.mjs / surface-tier.verify.mjs) — the actual
 *     definition of "the renderer crashed" for a WebGL context.
 *   - Playwright's `page.on("crash")` (renderer process crash / OOM) and
 *     `browser.on("disconnected")` (whole browser process died) — the
 *     other two things "crashed" could mean.
 *
 * VERDICTS (printed, and written to /tmp/fr-kz2p-<ticks>ticks-report.txt):
 *   COMPLETED        — a download landed. Reports total wall time.
 *   STALL-TIMEOUT     — --capMs elapsed with no download, no crash, no
 *                       context loss, no render-error banner. Progress
 *                       evidence (surfperf lines, exportDetail coverage
 *                       text, pass count from the modal) is dumped so a
 *                       human can tell "still grinding" from "flatlined".
 *   CONTEXT-LOST      — the canvas fired webglcontextlost.
 *   PAGE-CRASHED      — Playwright's page "crash" event fired.
 *   BROWSER-DISCONNECTED — the whole browser process went away.
 *   RENDER-ERROR      — the app's own #renderError banner lit up.
 *   PAGE-UNRESPONSIVE — repeated page.evaluate() failures without an
 *                       explicit crash/disconnect event (a catch-all for
 *                       whatever a dead-but-not-yet-reaped page looks like).
 *
 * This is a PROBE, not a gate (same convention as fold-settle-park.repro.mjs):
 * it always exits 0 and reports whatever it finds, so it is safe to run
 * speculatively and safe to leave in the tree.
 *
 * Usage: node scripts/degenerate-zoom-export.repro.mjs [--url=https://localhost:4173]
 *        [--ticks=32,48] [--capMs=480000] [--settleCapMs=120000] [--samples=N]
 *
 * `--samples=N` overrides the shipped 8x supersampling via `?surfacesamples=N`
 * (main.ts's diagnostic pin) — pass `--samples=1` to test the "is it just
 * the 8x multiplier" hypothesis directly, at the cost of no longer matching
 * the bead's own fixture exactly. Omit it to reproduce the shipped behavior.
 */
import fs from "node:fs";
import process from "node:process";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const BASE = (args.url ?? "https://localhost:4173").replace(/\/+$/, "");
const TICKS_LIST = String(args.ticks ?? "32,48")
  .split(",")
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);
const CAP_MS = Number(args.capMs ?? 480_000);
const SETTLE_CAP_MS = Number(args.settleCapMs ?? 120_000);
const SAMPLES = args.samples !== undefined ? Number(args.samples) : null;
const POLL_MS = 5000;

const log = (...a) => console.log("[fr-kz2p]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Same helper as capture-export.verify.mjs: open a collapsed accordion
 * section (idempotent — checks first so it can't toggle one already open
 * back closed). */
async function openPanelSection(page, sectionId) {
  const isOpen = await page.$eval(`#${sectionId}`, (el) => el.open);
  if (!isOpen) {
    await page.click(`#${sectionId} summary`);
    await page.waitForTimeout(150);
  }
}

/** Best-effort page sample — every field individually guarded so one
 * missing/renamed element can't blank the whole sample. Never throws
 * (a truly dead page is caught by the caller). */
async function sampleFromPage(page) {
  return page.evaluate(() => {
    const txt = (id) =>
      document.getElementById(id)?.textContent?.trim() ?? null;
    const errEl = document.getElementById("renderError");
    const renderError =
      errEl && !errEl.classList.contains("hidden")
        ? (errEl.textContent?.trim() ?? "")
        : null;
    const modalEl = document.getElementById("exportModal");
    const modalVisible = modalEl
      ? !modalEl.classList.contains("hidden") &&
        modalEl.style.display !== "none"
      : null;
    const trace = window.__surfaceTraceLog;
    return {
      renderError,
      exportModalVisible: modalVisible,
      exportDetail: txt("exportDetail"),
      exportProgress: txt("exportProgress"),
      toast: txt("toast"),
      traceLen: trace ? trace.length : -1,
      traceLast: trace && trace.length ? trace[trace.length - 1] : null,
      probe: window.__surfaceState?.() ?? null,
      glLost: window.__glLost === true,
    };
  });
}

/** Run one (ticks, capMs) scenario end to end against a fresh browser +
 * context. Never throws — every failure mode becomes a verdict string. */
async function runScenario(ticks) {
  log(
    `=== scenario: ticks=${ticks} capMs=${CAP_MS} settleCapMs=${SETTLE_CAP_MS} samples=${SAMPLES ?? "shipped(8)"} ===`,
  );

  const env = { ...process.env };
  delete env.DISPLAY; // offscreen SwiftShader, matching capture-export.verify.mjs
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false, // + --headless=new below, the combination that yields WebGL (see capture-export.verify.mjs)
    env,
    args: [
      "--headless=new",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--no-sandbox",
    ],
  });

  const consoleLines = [];
  const surfperfLines = [];
  const errors = [];
  const timeline = [];
  let verdict = "UNKNOWN";
  let verdictDetail = "";
  let downloadInfo = null;
  let pageCrashed = false;
  let browserDisconnected = false;
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;

  browser.on("disconnected", () => {
    browserDisconnected = true;
    timeline.push({ elapsed: elapsed(), line: "BROWSER DISCONNECTED" });
  });

  try {
    const ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      // Same fixture as capture-export.verify.mjs (fr-vja8.68): 660x410,
      // the smallest viewport above the app's mobile-layout breakpoints.
      viewport: { width: 660, height: 410 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      acceptDownloads: true,
    });
    const page = await ctx.newPage();
    page.on("crash", () => {
      pageCrashed = true;
      timeline.push({ elapsed: elapsed(), line: "PAGE CRASH EVENT" });
      log("PAGE CRASH EVENT fired");
    });
    page.on("close", () => {
      timeline.push({ elapsed: elapsed(), line: "page closed" });
    });
    page.on("download", (d) => {
      downloadInfo = { filename: d.suggestedFilename(), at: elapsed() };
      timeline.push({
        elapsed: elapsed(),
        line: `DOWNLOAD EVENT: ${downloadInfo.filename}`,
      });
    });
    page.on("pageerror", (e) => {
      errors.push({ type: "pageerror", text: String(e), at: elapsed() });
    });
    page.on("console", (msg) => {
      const t = msg.type();
      const text = msg.text();
      if (text.includes("[surfperf]")) {
        surfperfLines.push({ at: elapsed(), text });
        log(`t=${Math.round(elapsed() / 1000)}s ${text}`);
      } else if (text.includes("[surfacetrace]")) {
        // kept in consoleLines only — expected to stay empty for this
        // surfacegl-forced fixture; see module doc.
        consoleLines.push({ type: t, text, at: elapsed() });
      } else if (t === "error" || t === "warning") {
        consoleLines.push({ type: t, text, at: elapsed() });
      }
    });

    const samplesQS = SAMPLES !== null ? `&surfacesamples=${SAMPLES}` : "";
    const url = `${BASE}/?surfacestate&surfacegl&surfperf&surfacetrace${samplesQS}`;
    log(`navigating: ${url}`);
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__surfaceState !== undefined, {
      timeout: 60_000,
    });
    await page.waitForTimeout(4000);

    // Context-loss tripwire (house convention — capture-drain.verify.mjs,
    // surface-tier.verify.mjs), armed before any driving happens.
    await page.evaluate(() => {
      window.__glLost = false;
      document
        .querySelector("canvas")
        ?.addEventListener("webglcontextlost", () => {
          window.__glLost = true;
        });
    });

    // Dolly N ticks — identical recipe to capture-export.verify.mjs: each
    // wheel tick dollies x1.1 regardless of deltaY magnitude
    // (interactions.ts), so the tick COUNT is the knob.
    const box = await page.locator("canvas").first().boundingBox();
    for (let i = 0; i < ticks; i += 1) {
      await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5);
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1500);

    const orbitState = await page
      .evaluate(() => {
        const s = window.__surfaceState?.();
        return s ? { mode: s.mode, engine: s.engine } : null;
      })
      .catch(() => null);
    log(`post-dolly state: ${JSON.stringify(orbitState)}`);

    try {
      await page.screenshot({
        path: `/tmp/fr-kz2p-${ticks}ticks-pre-surface.png`,
      });
    } catch {
      // best-effort
    }

    // --- Enter Surface mode, wait for the live settle -----------------
    await page.click("#modeSurfaceBtn");
    const settleT0 = Date.now();
    let settled = false;
    for (;;) {
      if (Date.now() - settleT0 >= SETTLE_CAP_MS) break;
      await page.waitForTimeout(POLL_MS);
      let sample;
      try {
        sample = await sampleFromPage(page);
      } catch (e) {
        timeline.push({
          elapsed: elapsed(),
          line: `settle poll evaluate failed: ${e}`,
        });
        break;
      }
      const settledNow = sample.probe?.settled === true;
      timeline.push({
        elapsed: elapsed(),
        line: `[settle] t=${Math.round((Date.now() - settleT0) / 1000)}s probe=${JSON.stringify(sample.probe)} glLost=${sample.glLost}`,
      });
      if (sample.glLost) {
        verdict = "CONTEXT-LOST";
        verdictDetail = "during live settle (before Save-PNG was ever clicked)";
        break;
      }
      if (sample.renderError) {
        verdict = "RENDER-ERROR";
        verdictDetail = `during live settle: ${sample.renderError}`;
        break;
      }
      if (settledNow) {
        settled = true;
        break;
      }
    }
    const settleMs = Date.now() - settleT0;
    log(
      `settle phase: settled=${settled} in ${(settleMs / 1000).toFixed(1)}s (verdict so far: ${verdict})`,
    );
    timeline.push({
      elapsed: elapsed(),
      line: `SETTLE PHASE DONE settled=${settled} ms=${settleMs}`,
    });

    try {
      await page.screenshot({
        path: `/tmp/fr-kz2p-${ticks}ticks-post-settle.png`,
      });
    } catch {
      // best-effort
    }

    // --- Save PNG: the export under test -------------------------------
    if (verdict === "UNKNOWN") {
      await openPanelSection(page, "captureSection").catch(() => {});
      const exportT0 = Date.now();
      log("clicking #savePngBtn...");
      try {
        await page.click("#savePngBtn", { timeout: 15000 });
      } catch (e) {
        verdict = "PAGE-UNRESPONSIVE";
        verdictDetail = `#savePngBtn click failed: ${e}`;
      }

      if (verdict === "UNKNOWN") {
        let consecutiveEvalFailures = 0;
        let lastSurfperfCount = 0;
        let lastSurfperfChangeAt = 0;
        for (;;) {
          const el = Date.now() - exportT0;
          if (downloadInfo) {
            verdict = "COMPLETED";
            verdictDetail = `download "${downloadInfo.filename}" at t=${Math.round(downloadInfo.at / 1000)}s`;
            break;
          }
          if (pageCrashed) {
            verdict = "PAGE-CRASHED";
            verdictDetail =
              "Playwright page 'crash' event fired during export wait";
            break;
          }
          if (browserDisconnected) {
            verdict = "BROWSER-DISCONNECTED";
            verdictDetail = "browser process disconnected during export wait";
            break;
          }
          if (el >= CAP_MS) {
            verdict = "STALL-TIMEOUT";
            verdictDetail = `no download/crash/error within capMs=${CAP_MS}`;
            break;
          }
          await page.waitForTimeout(POLL_MS);
          let sample;
          try {
            sample = await sampleFromPage(page);
            consecutiveEvalFailures = 0;
          } catch (e) {
            consecutiveEvalFailures += 1;
            timeline.push({
              elapsed: elapsed(),
              line: `[export] t=${Math.round(el / 1000)}s page.evaluate FAILED (${consecutiveEvalFailures}x): ${e}`,
            });
            log(`page.evaluate failed (${consecutiveEvalFailures}x): ${e}`);
            if (consecutiveEvalFailures >= 3) {
              verdict = "PAGE-UNRESPONSIVE";
              verdictDetail = `page.evaluate failed ${consecutiveEvalFailures}x in a row`;
              break;
            }
            continue;
          }
          if (sample.glLost) {
            verdict = "CONTEXT-LOST";
            verdictDetail = `during Save-PNG export, t=${Math.round(el / 1000)}s`;
            break;
          }
          if (sample.renderError) {
            verdict = "RENDER-ERROR";
            verdictDetail = `during Save-PNG export: ${sample.renderError}`;
            break;
          }
          if (surfperfLines.length !== lastSurfperfCount) {
            lastSurfperfCount = surfperfLines.length;
            lastSurfperfChangeAt = el;
          }
          const line =
            `[export] t=${Math.round(el / 1000)}s modalVisible=${sample.exportModalVisible} ` +
            `detail="${sample.exportDetail ?? ""}" progress="${sample.exportProgress ?? ""}" ` +
            `toast="${sample.toast ?? ""}" surfperfLines=${surfperfLines.length} ` +
            `(silent for ${Math.round((el - lastSurfperfChangeAt) / 1000)}s) traceLen=${sample.traceLen}`;
          log(line);
          timeline.push({ elapsed: elapsed(), line });
        }
      }
    }

    log(`VERDICT: ${verdict} — ${verdictDetail}`);
    timeline.push({
      elapsed: elapsed(),
      line: `VERDICT: ${verdict} — ${verdictDetail}`,
    });

    try {
      await page.screenshot({
        path: `/tmp/fr-kz2p-${ticks}ticks-final.png`,
      });
    } catch {
      // best-effort — page may be gone by now
    }

    // ---- Report --------------------------------------------------------
    const reportPath = `/tmp/fr-kz2p-${ticks}ticks-report.txt`;
    const report =
      `fr-kz2p repro — ticks=${ticks} capMs=${CAP_MS} settleCapMs=${SETTLE_CAP_MS} samples=${SAMPLES ?? "shipped(8)"}\n` +
      `VERDICT: ${verdict}\n` +
      `DETAIL: ${verdictDetail}\n` +
      `total wall: ${(elapsed() / 1000).toFixed(1)}s\n` +
      `settle: settled=${settled} ms=${settleMs}\n\n` +
      `=== TIMELINE ===\n${timeline.map((t) => `t=${Math.round(t.elapsed / 1000)}s ${t.line}`).join("\n")}\n\n` +
      `=== SURFPERF LINES (${surfperfLines.length}) ===\n${surfperfLines.map((l) => `t=${Math.round(l.at / 1000)}s ${l.text}`).join("\n")}\n\n` +
      `=== CONSOLE errors/warnings/surfacetrace (${consoleLines.length}) ===\n${consoleLines.map((l) => `t=${Math.round(l.at / 1000)}s [${l.type}] ${l.text}`).join("\n")}\n\n` +
      `=== PAGE ERRORS (${errors.length}) ===\n${errors.map((l) => `t=${Math.round(l.at / 1000)}s ${l.text}`).join("\n")}\n`;
    fs.writeFileSync(reportPath, report, "utf8");
    log(`report written: ${reportPath}`);
    console.log(`\n=== SUMMARY (ticks=${ticks}) ===`);
    console.log(
      `verdict=${verdict} detail="${verdictDetail}" wallS=${(elapsed() / 1000).toFixed(1)} ` +
        `settled=${settled} settleS=${(settleMs / 1000).toFixed(1)} surfperfLines=${surfperfLines.length} ` +
        `consoleErrors=${consoleLines.filter((l) => l.type === "error").length} pageErrors=${errors.length}`,
    );

    return {
      ticks,
      verdict,
      verdictDetail,
      wallMs: elapsed(),
      settled,
      settleMs,
      reportPath,
    };
  } catch (e) {
    log(`scenario threw: ${e}`);
    return {
      ticks,
      verdict: "SCRIPT-ERROR",
      verdictDetail: String(e),
      wallMs: elapsed(),
    };
  } finally {
    try {
      await browser.close();
    } catch {
      // best-effort — the browser may already be gone (that's data, not a
      // script bug, if it happens right after a crash verdict)
    }
  }
}

async function main() {
  log(`starting: url=${BASE} ticksList=${TICKS_LIST.join(",")}`);
  const results = [];
  for (const ticks of TICKS_LIST) {
    // Deliberately sequential and one browser per scenario — this rig's own
    // house rule (capture-export.verify.mjs's doc) is "run heavy SwiftShader
    // gates alone"; running two extreme-zoom exports concurrently would
    // contaminate both timings.
    results.push(await runScenario(ticks));
    await sleep(2000);
  }
  console.log("\n=== ALL SCENARIOS ===");
  for (const r of results) {
    console.log(
      `ticks=${r.ticks} verdict=${r.verdict} wallS=${(r.wallMs / 1000).toFixed(1)} detail="${r.verdictDetail}"`,
    );
  }
}

main()
  .catch((e) => {
    console.error("[fr-kz2p] FATAL:", e);
  })
  .finally(() => {
    // Probe, not a gate — always exit 0 regardless of verdict (see module
    // doc); the report files and stdout summary carry the finding.
    process.exit(0);
  });
