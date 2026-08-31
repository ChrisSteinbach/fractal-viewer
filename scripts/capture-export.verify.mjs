#!/usr/bin/env node
/**
 * Capture-export gate: end-to-end PASS/FAIL verification, in a real
 * headless browser, that BOTH surface capture drains now run through the
 * same pipelined strip pump the live settle uses (scene.ts's pumpStrips) —
 * the yielding Save-PNG drain (drainStripsAsync) and the
 * synchronous thumbnail/offline drain (drainStripsSync, via
 * captureThumbnail("surface") -> renderSurface("full")). Unlike
 * scripts/capture-drain.verify.mjs — a MEASUREMENT harness that reports A/B
 * timing numbers and treats a refused/timed-out export as a valid,
 * reportable outcome — this script is a strict PASS/FAIL GATE: every
 * assertion below must hold, and a partial or refused export is a script
 * failure, not data.
 *
 * THE BUG THIS EXISTS TO CATCH. `drainStripsSync`'s join/abort path retires
 * its strip queue by polling `gl.clientWaitSync` — but a WebGL sync object's
 * signaled state is only refreshed on the page's own message loop, which a
 * tight synchronous drain loop never returns to. Poll it from inside such a
 * loop and it reads TIMEOUT_EXPIRED forever, even though the GPU finished
 * the work long ago: the queue bound then blocks every refill and the drain
 * spins with `spentMs` frozen at 0, so even the spend ceiling can't end it.
 * MEASURED on exactly this bug: a thumbnail capture (phase 4 below) went
 * from 4.3s to a >300s hang. A script that only checks the FINAL state
 * cannot tell that failure from a slow-but-fine box — both eventually time
 * out — so this script's bounded waits (see ROBUSTNESS below) are the
 * actual assertion, not decoration. The fix retires the queue with
 * `assumeComplete` immediately after the one join that already proved every
 * fence behind it signaled, instead of polling from a loop with no message
 * pump (see scene.ts's `collectStripFences` doc for the full argument).
 *
 * FOUR PHASES against one live surface session, in order:
 *   1. Enter Surface mode, wait for the live settle (the unchanged
 *      pipelined pump — the baseline both drains are measured against).
 *   2. Save PNG to a real, completed download — the yielding async drain.
 *   3. Save PNG again, Cancel mid-drain: the export modal must open, the
 *      cancel must be honoured without producing a second download, and the
 *      surface session must still be interactive afterward — a cancelled
 *      export must not strand the pane. `--tiling=a3` authors the finite
 *      tiling through the real panel before entry and requires it to survive
 *      the completed export, cancellation, interaction and collection save.
 *   4. Save to collection: the SYNCHRONOUS drain, via
 *      captureThumbnail("surface") -> renderSurface("full") ->
 *      drainStripsSync. This is the phase the bug above lived in, so its
 *      completion — not just its output — is the load-bearing assertion.
 *
 * ZOOMED OUT ON PURPOSE — AND SHRUNK. Every phase runs on a camera
 * zoomed well back from the attractor first: at the shipped default
 * framing, a full-tier trace of the default preset is on the order of 10
 * MINUTES under SwiftShader — a gate that has to run routinely cannot
 * afford that. Zoomed out, most rays miss the attractor immediately and
 * both drains resolve in seconds, while still exercising every
 * strip/fence/present path a slow, real capture shares with this cheap
 * one. The original fixture (900x560 viewport, 14 wheel ticks) was still
 * too heavy for a software rasterizer: the phase-2 export outlived its
 * 240s bound (measured >330s and still grinding), so phase 3's click
 * found #savePngBtn busy-disabled and the run died on a stalled click — a
 * failure that PRE-EXISTS the quality campaign that found it (A/B-proven
 * identical on pre-campaign main). The fix is the FIXTURE, not the
 * budgets: 660x410 (the smallest viewport above the app's mobile-layout
 * breakpoints) and 18 ticks keep the identical code path — the strip
 * pump, both drains, a real settle over the default-preset Surface entry —
 * while cutting
 * per-pixel cost ~1.9x, and every export phase still takes real seconds,
 * so the busy-disabled button, the disclosed wait and a mid-drain Cancel
 * all stay genuinely observable. MEASURED 2026-08-18 (SwiftShader, quiet
 * 8-core box, strictly one run at a time), three back-to-back green runs:
 * settle 14.1s / 14.1s / 14.1s; Save-PNG export to a completed download
 * 17.6s / 80.8s / 39.0s (the spread is the capture ratchet, see
 * EXPORT_DOWNLOAD_TIMEOUT_MS); cancel honoured 1.4s / 0.7s / 0.7s; sync
 * thumbnail drain 1.1s / 2.4s / 1.5s. Concurrent gate runs invalidate
 * all of these numbers — beside stray concurrent runs the same export
 * measured 169.3s — so run this gate ALONE.
 * The 2026-08-31 `--tiling=a3` qualification passed 15/15 on SwiftShader:
 * settle 10.0s, completed PNG 73.6s/12,952 bytes, cancel 0.7s with no second
 * download, and synchronous collection thumbnail 1.7s; exact A3 survived
 * every phase and the collection entry's encoded document.
 *
 * ROBUSTNESS. The settle wait (phase 1) and the download wait (phase 2) are
 * the two places a hung drain would otherwise wedge this script forever;
 * both carry an explicit bound and fail with a message that says WHY, not
 * just that a timer expired. A settle that never completes aborts the run
 * immediately, before any capture phase — proceeding into capture
 * assertions on an unsettled frame would just be noise on top of a report
 * that already says "this box is too slow or this pose too heavy", not a
 * second finding.
 *
 * SERVICE-WORKER SSL NOISE. Both `npm run dev` and `npm run preview` serve
 * HTTPS with a self-signed cert (basicSsl); fetching sw.js for the
 * COOP/COEP service worker fails on a certificate error under Playwright's
 * default CA trust, logging two console errors that are pure environment
 * noise — see `isKnownServiceWorkerSslNoise`'s doc for the exact text
 * matched. Every OTHER page error still fails the run.
 *
 * Usage: node scripts/capture-export.verify.mjs [url] [--tiling=a3]
 * (url defaults to https://localhost:4173 — `npm run build && npm run
 * preview` first, per capture-drain.verify.mjs.)
 */
import { stat } from "node:fs/promises";
import process from "node:process";
import { chromium } from "playwright-core";

const cliArgs = process.argv.slice(2);
const BASE = (
  cliArgs.find((arg) => !arg.startsWith("--")) ?? "https://localhost:4173"
).replace(/\/+$/, "");
const tilingArg = cliArgs.find((arg) => arg.startsWith("--tiling="));
const TILING = tilingArg?.slice("--tiling=".length) ?? null;
if (TILING !== null && TILING !== "a3") {
  throw new Error("--tiling currently accepts only a3");
}

/** Bound on the live settle (phase 1). Generous even for SwiftShader on the
 * zoomed-out (cheap) frame this script insists on — a real timeout means
 * this box is unusually slow or the default pose unusually heavy, not that
 * the gate needs a longer bound. Recalibrated 180s -> 90s with the
 * shrunk fixture: measured 14.1s on all three green runs (16.0s the
 * worst observation of the day), so 90s keeps >5x margin over the worst. */
const SETTLE_TIMEOUT_MS = 90_000;
const SETTLE_POLL_MS = 2_000;
/** Bound on the Save-PNG download (phase 2) — the async yielding drain.
 * Deliberately NOT tightened with the fixture shrink: the export's wall
 * is bimodal under SwiftShader (17.6s / 80.8s / 39.0s across the three
 * green runs — the strip planner's capture-side raise-only ratchet, by
 * design, turns one slow readback into micro-strip passes), so 240s is
 * ~3x over the worst observed mode where "5x over the typical run" would
 * sit dangerously inside it. */
const EXPORT_DOWNLOAD_TIMEOUT_MS = 240_000;
/** Bound on waiting out the "Export cancelled" toast (phase 3). */
const CANCEL_TOAST_TIMEOUT_MS = 30_000;
const CANCEL_TOAST_POLL_MS = 500;
/** Bound on proving the pane still responds to input after a cancel. */
const ALIVE_CHECK_TIMEOUT_MS = 30_000;
/** export-progress.ts's EXPORT_MODAL_GRACE_MS is 400ms; wait comfortably
 * past it so a fast-opening modal is never missed. */
const MODAL_GRACE_WAIT_MS = 700;
/** See the ZOOMED OUT note above: a zoomed-out frame's thumbnail JPEG is
 * legitimately tiny (~1.5K chars observed, stable across runs) because most
 * of the frame is empty background. This proves an image was produced, not
 * that it is any particular size — `> 2000` simply didn't hold for this
 * pose even before the fix, on a byte-identical image. */
const THUMBNAIL_MIN_CHARS = 500;
/** Floor on the Save-PNG download's byte size (phase 2): an INTEGRITY
 * floor — a zero-byte, truncated or catastrophically failed encode cannot
 * reach it — NOT a content check: THUMBNAIL_MIN_CHARS's own discipline,
 * one drain over. CALIBRATED TO THE SHRUNK FIXTURE (2026-08-18,
 * SwiftShader, 660x410), where the frame is mostly backdrop and the PNG's
 * bytes are dominated by px-proportional backdrop noise, not the
 * attractor: measured 11_379-11_393 bytes across four runs at the shipped
 * 18-tick pose (near-byte-deterministic) and 9_372 (twice) at the
 * rejected 24-tick one — a 2.14x attractor-area change moved the file
 * ~2K, so no affordable pose at this viewport reaches the old 20_000,
 * which was calibrated against 900x560's ~1.9x pixel count. TWO HONEST
 * SCOPE LOSSES, disclosed rather than papered over. (1) A solid-black
 * 660x410 canvas PNG MEASURES ~7_005 bytes through Chrome's own encoder
 * (twice; the "all-black compresses to ~1-3K" a first cut of this comment
 * assumed is false for this encoder) — above this floor, so an all-black
 * frame, or one holed by the coverage-alpha leak's transparent misses, is
 * not distinguishable by size here.
 * (2) Extrapolating the two measured poses to zero attractor puts a
 * BACKDROP-ONLY frame at ~7.6-8.4K — also above this floor — so a render
 * that drew the gradient but no fractal is not distinguishable by size
 * either (the old 20k floor at 900x560 did sit above that fixture's
 * ~14K backdrop; direct measurement of a backdrop-only export at this
 * one was attempted at 32 and 48 wheel ticks and failed for app-side
 * reasons — the export stalls past 240s or the renderer crashes at
 * degenerate zoom). Neither case is this check's load-bearing job:
 * phase 1's settle latch proves a real trace ran at this pose before any
 * export, phase 2's sequencing proves the download landed only once that
 * render finished, and wrong-source exports are the flame-export gate's
 * image-distance question — this floor exists for the byte-level
 * failures named at the top, and 5_500 keeps ~2x margin under the
 * shipped pose's measured bytes while every one of those failures sits
 * far below it. */
const EXPORT_PNG_MIN_BYTES = 5_500;

let totalChecks = 0;
const failures = [];
function check(ok, label) {
  totalChecks += 1;
  console.error(`[capture-export] ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
}

/**
 * Environmental noise, not a real failure (see the module doc's
 * SERVICE-WORKER SSL NOISE section): Playwright's browser trusts no CA for
 * the dev/preview server's self-signed HTTPS cert, so fetching sw.js for the
 * COOP/COEP service worker fails with a certificate error. Two console
 * errors follow, every run, on this rig:
 *   - the browser's own service-worker-registration-failure log, a fixed
 *     string with no variable parts;
 *   - register-sw.ts's own `console.error("Service worker registration
 *     failed:", error)` echo of that same rejection, whose text embeds
 *     BASE's host:port and the SecurityError's own message — hence a
 *     substring match rather than a literal string.
 * Surface mode needs neither the worker nor cross-origin isolation, so this
 * is genuinely unrelated to anything under test here.
 */
function isKnownServiceWorkerSslNoise(text) {
  if (text === "An SSL certificate error occurred when fetching the script.") {
    return true;
  }
  return (
    text.startsWith("Service worker registration failed:") &&
    text.includes("SecurityError") &&
    text.includes("sw.js") &&
    text.includes("SSL certificate error")
  );
}

/** Open a <details class="panel-section"> accordion section if it is not
 * already open — savePngBtn/saveCollectionBtn live inside one and are
 * unclickable (zero-size, native <details> collapse) while it is closed.
 * Idempotent: re-clicking an already-open summary would TOGGLE IT CLOSED,
 * so this checks first. */
async function openPanelSection(page, sectionId) {
  const isOpen = await page.$eval(`#${sectionId}`, (el) => el.open);
  if (!isOpen) {
    await page.click(`#${sectionId} summary`);
    await page.waitForTimeout(150);
  }
}

function decodeDocument(encoded) {
  const match = /^#?v1=([A-Za-z0-9_-]+)$/.exec(encoded);
  if (!match)
    throw new Error(`invalid scene document: ${encoded.slice(0, 24)}`);
  return JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
}

async function readTiling(page) {
  return decodeDocument(await page.evaluate(() => window.location.hash)).tiling;
}

async function waitForExactTiling(page, wanted, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (JSON.stringify(await readTiling(page)) === JSON.stringify(wanted)) {
        return true;
      }
    } catch {
      // Debounced persistence can briefly leave the hash absent.
    }
    await page.waitForTimeout(100);
  }
  return false;
}

async function main() {
  const env = { ...process.env };
  delete env.DISPLAY; // offscreen SwiftShader, not X11 GLX (see webgl-smoke.mjs)
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false, // + --headless=new below — the combination that yields WebGL
    env,
    args: [
      "--headless=new",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--no-sandbox",
    ],
  });

  try {
    const ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      // 660x410, the smallest viewport comfortably above the
      // app's mobile-layout breakpoints (width <= 640px / height <= 380px
      // would swap in the phone panel, which this script does not drive).
      // Every trace-heavy phase — the settle, the Save-PNG re-trace at
      // export scale 1, the sync thumbnail drain — costs per canvas pixel,
      // so the shrink from 900x560 is a straight ~1.9x cut on an unchanged
      // path. See the module doc's ZOOMED OUT note for the measured effect.
      viewport: { width: 660, height: 410 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      acceptDownloads: true,
    });
    const page = await ctx.newPage();
    const surfperfLines = [];
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      const t = m.text();
      if (t.includes("[surfperf]") && !t.includes("heavy")) {
        surfperfLines.push(t);
      }
      if (m.type() === "error") errors.push(t);
    });
    page.setDefaultTimeout(90_000);
    await page.goto(`${BASE}/?surfacestate&surfacegl&surfperf`, {
      waitUntil: "load",
    });
    await page.waitForFunction(() => window.__surfaceState !== undefined, {
      timeout: 60_000,
    });
    await page.waitForTimeout(4000);

    if (TILING === "a3") {
      await openPanelSection(page, "tilingSection");
      await page.locator("#tilingEnabledCheckbox").check();
      check(
        await waitForExactTiling(page, { group: "a3" }),
        "A3 authored through the live tiling panel",
      );
    }

    // Zoom out so most rays miss the attractor: the cheap frame this whole
    // gate depends on to finish under SwiftShader at all (see the module
    // doc's ZOOMED OUT note). Each wheel tick dollies x1.1 (deltaY's
    // magnitude is ignored — interactions.ts), so the tick COUNT is the
    // knob: 18 ticks sits ~x1.5 further back than the original 14, cutting
    // the attractor's screen area ~2.1x on top of the viewport shrink,
    // with MAX_RADIUS=100 still far away. Deeper zoom (24 ticks) was
    // measured and REJECTED: the frame empties so far that the exported
    // PNG falls under the size assertion (9372 bytes), while the export's
    // wall is dominated by per-strip overhead anyway, not trace work.
    const box = await page.locator("canvas").first().boundingBox();
    for (let i = 0; i < 18; i += 1) {
      await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5);
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1500);

    // --- 1. Enter Surface mode, wait for the live settle -------------------
    await page.click("#modeSurfaceBtn");
    const t0 = Date.now();
    let settled = false;
    while (Date.now() - t0 < SETTLE_TIMEOUT_MS) {
      await page.waitForTimeout(SETTLE_POLL_MS);
      settled = await page.evaluate(
        () => window.__surfaceState?.().settled === true,
      );
      if (settled) break;
    }
    const settleMs = Date.now() - t0;
    check(settled, `settle completed (${(settleMs / 1000).toFixed(1)}s)`);
    if (!settled) {
      const row = await page.textContent("#surfaceProgress").catch(() => null);
      console.error(
        `[capture-export] settle row="${(row ?? "").trim()}" after ` +
          `${(SETTLE_TIMEOUT_MS / 1000).toFixed(0)}s — this box is too slow ` +
          `or the pose too heavy for this gate; the remaining checks would ` +
          `be meaningless without a settled frame, so aborting now`,
      );
      return;
    }

    // --- 2. Save PNG to completion: the yielding async drain ---------------
    await openPanelSection(page, "captureSection");
    const dlPromise = page.waitForEvent("download", {
      timeout: EXPORT_DOWNLOAD_TIMEOUT_MS,
    });
    const c0 = Date.now();
    await page.click("#savePngBtn");
    let download = null;
    let downloadFailure = null;
    try {
      download = await dlPromise;
    } catch (err) {
      downloadFailure = err instanceof Error ? err.message : String(err);
    }
    const captureMs = Date.now() - c0;
    const size = download
      ? await download
          .path()
          .then((p) => (p ? stat(p).then((s) => s.size) : 0))
          .catch(() => 0)
      : 0;
    check(
      download !== null && size > EXPORT_PNG_MIN_BYTES,
      `PNG downloaded "${download?.suggestedFilename() ?? "none"}" ${String(size)} bytes` +
        ` in ${(captureMs / 1000).toFixed(1)}s` +
        (downloadFailure
          ? ` — no download within ${(EXPORT_DOWNLOAD_TIMEOUT_MS / 1000).toFixed(0)}s: ${downloadFailure}`
          : ""),
    );
    const toast1 = (await page.textContent("#toast").catch(() => "")) ?? "";
    check(/Saved /.test(toast1), `save toast: "${toast1.trim().slice(0, 70)}"`);
    if (TILING === "a3") {
      check(
        JSON.stringify(await readTiling(page)) ===
          JSON.stringify({ group: "a3" }),
        "completed Save PNG preserved exact A3",
      );
    }
    await page.waitForTimeout(1500);

    // --- 3. Save PNG again, Cancel mid-drain --------------------------------
    // Clear the leftover "Saved..." toast from phase 2 first, so the
    // cancel-toast check below can't be fooled by stale text.
    await page.evaluate(() => {
      const t = document.getElementById("toast");
      if (t) t.textContent = "";
    });
    let cancelledDownload = false;
    const onCancelledDownload = () => {
      cancelledDownload = true;
    };
    page.on("download", onCancelledDownload);
    await page.click("#savePngBtn");
    await page.waitForTimeout(MODAL_GRACE_WAIT_MS);
    const modalUp = await page.isVisible("#exportModal").catch(() => false);
    const cancelMs = Date.now();
    let cancelled = false;
    if (modalUp) {
      await page.click("#exportCancelBtn");
      const cancelDeadline = Date.now() + CANCEL_TOAST_TIMEOUT_MS;
      while (Date.now() < cancelDeadline) {
        await page.waitForTimeout(CANCEL_TOAST_POLL_MS);
        const t = (await page.textContent("#toast").catch(() => "")) ?? "";
        if (/Export cancelled/.test(t)) {
          cancelled = true;
          break;
        }
      }
    }
    check(
      modalUp,
      "export modal opened for the second save (grace period elapsed)",
    );
    check(
      !modalUp || cancelled,
      `cancel honoured in ${((Date.now() - cancelMs) / 1000).toFixed(1)}s`,
    );
    await page.waitForTimeout(500);
    page.off("download", onCancelledDownload);
    check(!cancelledDownload, "cancelled export produced no download");
    if (TILING === "a3") {
      check(
        JSON.stringify(await readTiling(page)) ===
          JSON.stringify({ group: "a3" }),
        "cancelled Save PNG preserved exact A3",
      );
    }

    // The pane must still be alive after a cancelled export.
    await page.waitForTimeout(1200);
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 70, { steps: 6 });
    await page.mouse.up();
    const alive = await page.waitForFunction(
      () => {
        const s = window.__surfaceState?.();
        return s?.mode === "surface" && s.firstFrame === true;
      },
      undefined,
      { timeout: ALIVE_CHECK_TIMEOUT_MS },
    );
    check(Boolean(alive), "surface session alive after cancel + drag");
    if (TILING === "a3") {
      check(
        JSON.stringify(await readTiling(page)) ===
          JSON.stringify({ group: "a3" }),
        "post-cancel interaction preserved exact A3",
      );
    }

    // --- 4. Save to collection: the SYNC drain via captureThumbnail --------
    await openPanelSection(page, "collectionSection");
    const before = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("fractal-viewer:collection") ?? "[]")
          .length,
    );
    // The sync drain runs inside the click handler on the page's main
    // thread, so the click's input ack is held for the drain's whole wall
    // time — timing the await IS timing the drain (within input-dispatch
    // noise), and the check label below carries it so every run's log
    // records phase 4's cost beside phases 1-3's own timings.
    const sync0 = Date.now();
    await page.click("#saveCollectionBtn");
    const syncHeldMs = Date.now() - sync0;
    await page.waitForTimeout(2000);
    const entries = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fractal-viewer:collection") ?? "[]"),
    );
    const last = entries[entries.length - 1];
    check(
      entries.length === before + 1,
      `collection entry saved (${String(entries.length)})`,
    );
    check(
      typeof last?.thumbnail === "string" &&
        last.thumbnail.length > THUMBNAIL_MIN_CHARS,
      `surface thumbnail rendered by the sync drain ` +
        `(${String(last?.thumbnail?.length ?? 0)} chars, click held ` +
        `${(syncHeldMs / 1000).toFixed(1)}s)`,
    );
    if (TILING === "a3") {
      let savedTiling = null;
      try {
        savedTiling = decodeDocument(last?.encoded ?? "").tiling;
      } catch {
        // The assertion below reports an invalid/missing encoded document.
      }
      check(
        JSON.stringify(savedTiling) === JSON.stringify({ group: "a3" }),
        "collection entry encoded exact A3",
      );
    }

    // --- Page errors, filtered for the known SSL/service-worker noise ------
    const realErrors = errors.filter((e) => !isKnownServiceWorkerSslNoise(e));
    const ignoredCount = errors.length - realErrors.length;
    check(
      realErrors.length === 0,
      `no page errors (${realErrors.length})` +
        (ignoredCount > 0
          ? ` [ignored ${ignoredCount} known SW/SSL noise error(s)]`
          : ""),
    );
    for (const e of realErrors.slice(0, 5)) {
      console.error(`[capture-export] err: ${e}`);
    }
    // The [surfperf] "capture <outcome> ..." lines are the direct evidence
    // for each drain (phases 2-4 each produce one) — see the module doc.
    for (const l of surfperfLines) console.error(l);
  } finally {
    await browser.close().catch(() => {});

    const okCount = totalChecks - failures.length;
    console.error(`[capture-export] ok=${okCount} fail=${failures.length}`);
    if (failures.length > 0) {
      console.error(`[capture-export] FAILURES: ${failures.join("; ")}`);
    }
    process.exitCode = failures.length === 0 ? 0 : 1;
  }
}

main().catch((err) => {
  console.error("[capture-export] fatal:", err);
  process.exitCode = 1;
});
