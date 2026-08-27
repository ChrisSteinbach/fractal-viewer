#!/usr/bin/env node
/**
 * Capture-drain measurement harness: same-machine, A/B-able numbers for the
 * reported asymmetry — the surface render's live settle is PIPELINED
 * (fenced strip groups, scene.ts's pumpStrips/renderSurfaceStrips)
 * while a Save-PNG capture of the SAME pose drained SERIALLY, one
 * forced-completion readback per strip at ~66-90ms of fixed sync tax each,
 * instead of once per fenced batch. Measured before the fix on SwiftShader
 * WebGL, 1280x720, default preset: the live settle of a pose completed in
 * 19s while a Save-PNG of the SAME pose reached only ~37% before tripping
 * the 60s spend ceiling (SURFACE_CAPTURE_SPEND_CEILING_MS). Both drains now
 * loop the pump, so this script's job is to keep that comparison MEASURABLE
 * rather than to prove it once: it prints one grep-able summary line, so a
 * BEFORE run and an AFTER run of any future change to the drains, the pump
 * or the strip planner can be diffed directly. `capture-export.verify.mjs`
 * is the pass/fail gate beside it.
 *
 * NOTE ON SCALE. The 1280x720 default is the reported configuration, not a
 * universally affordable one: on a software-GL box a default-preset frame
 * at that size can be ~10 minutes of tracing, so both phases report
 * timeouts. That is a legitimate reading of a too-slow box, not a script
 * failure — but for an A/B you want a frame both phases can finish, so run
 * it somewhere the settle completes, or compare coverage-at-a-fixed-window
 * instead of totals. (Before the interactive export's cost ceilings were
 * dropped such a run ended in a `refused` outcome instead, the predict
 * ceiling rejecting the export up front; the interactive capture carries no
 * cost ceiling now, so `refused` is reachable only if some future change
 * puts one back.)
 *
 * This is a MEASUREMENT harness, not a pass/fail gate: a refused or
 * timed-out export is a valid, reportable outcome, never a script failure.
 * Exit code is non-zero only when the app never reached a measurable state
 * at all (no settle, the export modal never opened and no other terminal
 * capture signal arrived, a page error, or a lost WebGL context).
 *
 * Conventions copied from the existing surface-*.verify.mjs scripts:
 *   - The SwiftShader launch recipe (headless=new + --enable-unsafe-
 *     swiftshader + --use-angle=swiftshader, DISPLAY removed) and console
 *     forwarding: scripts/surface-tier.verify.mjs.
 *   - window.__surfaceState()'s settle latch (?surfacestate) and its
 *     waitForSettled polling shape: scripts/surface-repro.verify.mjs.
 *   - ?surfacegl / ?surfperf query-flag wiring: scripts/surface-fold.verify.mjs.
 *   - reducedMotion so camera glides SNAP instead of easing (a software-GL
 *     exponential chase can keep invalidating for minutes otherwise and pin
 *     the tier scheduler in preview forever) — every script above.
 *
 * PINNING THE CAMERA — degraded from the originally-suggested approach. The
 * obvious plan ("boot the app, wait, read window.location.hash — the app
 * persists camera pose to the #v1= hash") does not actually hold for a
 * passive load: persist.ts's saveScene() only ever runs from
 * EditSession.persist(), which fires SAVE_DEBOUNCE_MS after
 * editSession.beginEdit() — and main.ts's boot path assigns `state` directly
 * from loadScene()/initialState() BEFORE EditSession is even constructed, so
 * a plain boot with no user interaction never calls beginEdit() and the hash
 * never gets written (camera motion schedules no per-frame save — its pose is
 * captured fresh only at the moment something DOES persist). So this script mints its
 * pinned document the way surface-repro.verify.mjs's `--mint` mode does:
 * click "Save to collection" (onSaveToCollection encodes currentDocument()
 * — the scene PLUS the live camera pose — independent of the hash/autosave
 * path) and read the resulting entry's `.encoded` field back out of
 * localStorage["fractal-viewer:collection"]. That string already carries the
 * `v1=` prefix (persist.ts's encodeScene), so `"#" + encoded` is a directly
 * navigable, pose-pinned document. Verified by hard-reloading to that exact
 * hash and checking two things: location.hash round-trips byte-for-byte,
 * and two screenshots ~800ms apart are pixel-identical (proof nothing is
 * still auto-framing/gliding).
 *
 * HARD-NAVIGATING TO THE PINNED HASH. A URL that differs from the page's
 * CURRENT URL only in its fragment is a same-document navigation per the
 * HTML navigation algorithm (no unload, no re-run of main.ts's boot code,
 * whether the navigation is address-bar-typed, script-driven, or
 * CDP-driven) — so a bare page.goto(url-with-new-hash) is not trustworthy
 * here: it can update location.hash without ever re-executing loadScene().
 * This script always follows the goto with an explicit page.reload(), which
 * reloads the CURRENT (now-updated) URL from scratch and guarantees main.ts
 * actually boots from the pinned hash. Cheap insurance: if goto() already
 * forced a real reload on some Playwright/browser combination, the extra
 * reload just repeats an already-correct boot.
 *
 * ISOLATION RELOAD. The production build's service worker injects
 * COOP/COEP; a first-ever visit in this fresh browser context loads
 * non-isolated and self-reloads exactly once, the instant the worker takes
 * control (see register-sw.ts). This script waits out that reload
 * (window.crossOriginIsolated flipping true) after the FIRST navigation
 * only — every navigation after that, in the same context, is already
 * served by the controlling worker, so the dance never arms again.
 *
 * DOWNLOAD SIGNAL. The primary "saved" signal is Playwright's `download`
 * event (triggerDownload's detached `<a download>` blob-URL click reliably
 * fires it under acceptDownloads:true). As a degraded backup — in case a
 * future environment ever fails to deliver that event under headless
 * SwiftShader — this script also recognizes the "Saved <W>x<H> PNG" toast
 * text as a success signal, and the refusal/cancellation toasts
 * ("...export skipped", "...export aborted", "Export cancelled",
 * "Couldn't encode the PNG") as their respective terminal signals.
 *
 * Usage: node scripts/capture-drain.verify.mjs [url]
 * (url defaults to https://localhost:4173. Build once with `npm run build`,
 * then `npm run preview` and leave it running; the preview server
 * deliberately serves no COOP/COEP of its own, which is what lets the
 * service-worker isolation reload above actually exercise, per vite.config.ts.)
 *
 * Prints one grep-able summary line at the end:
 *   [capture-drain] settleMs=<n> captureMs=<n> captureOutcome=<saved|
 *     refused|cancelled|timeout> capturePct=<n|na> exportSize=<WxH|na>
 *     settleSpentMs=<n|na> captureSpentMs=<n|na> captureLogOutcome=<s|na>
 * The first six fields are the contract this script was asked for, in the
 * required order; captureSpentMs/captureLogOutcome are an addition once the
 * app grew a capture-side twin of the settle-complete log line (the
 * ?surfperf "[surfperf] capture <done|ceiling|cancelled> px=... spentMs=..."
 * line) — parsed when present, "na" when absent, and cross-checked in the
 * log against the UI-observed captureOutcome as a sanity check (the two are
 * independent signals: one polls DOM/toast/download, the other reads the
 * app's own internal accounting). Every [surfperf] console line the app
 * logged along the way is also printed on its own line.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", ".playwright-mcp");
const BASE = (process.argv[2] ?? "https://localhost:4173").replace(/\/+$/, "");

/** ?surfacegl forces the WebGL tracer (this harness is about the WebGL
 * strip drain, never the WebGPU compute path — the default preset is plain
 * affine so it always runs WebGL regardless, but the flag is cheap, explicit
 * insurance). ?surfacestate publishes window.__surfaceState()'s settle
 * latch. ?surfperf logs strip-job costs, including the settle-complete and
 * capture lines this script parses. */
const QUERY = "surfacestate&surfacegl&surfperf";

const NAV_TIMEOUT_MS = 30_000;
const BOOT_TIMEOUT_MS = 30_000;
const ISOLATION_TIMEOUT_MS = 30_000;
/** Buffer after boot for the camera auto-fit glide to land before minting
 * the pinned document — reducedMotion makes this near-instant, but the
 * buffer avoids a race against whatever's left of the fit tween. */
const MINT_SETTLE_BUFFER_MS = 4_000;
const SETTLE_DWELL_MS = 2_000;
/** Generous per the measured worst case (a pre-fix capture grinds to the
 * 60s spend ceiling and refuses) — allow at least 180s/240s. */
const SETTLE_TIMEOUT_MS = 180_000;
const CAPTURE_TIMEOUT_MS = 240_000;
const CAPTURE_POLL_MS = 300;
/** Lead-in before the FIRST stability screenshot: waitForBoot only proves
 * the point count ticked past zero, not that the chaos-game worker has
 * landed the document's full numPoints budget yet — comparing two shots
 * taken too early would legitimately catch an evolving points-mode cloud
 * (unrelated to camera-pose drift, which is what this check exists to
 * catch) and misreport it as "STILL CHANGING". */
const STABILITY_CHECK_LEAD_MS = 1_500;
const STABILITY_CHECK_GAP_MS = 800;

const COLLECTION_STORAGE_KEY = "fractal-viewer:collection";

async function mkOutDir() {
  await mkdir(OUT_DIR, { recursive: true });
}

/** Boot-readiness signal shared by every verify script in this directory:
 * the point count text ticks past zero once the boot chaos game lands. */
async function waitForBoot(page, timeoutMs = BOOT_TIMEOUT_MS) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById("pointCount");
      return !!el && Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
    },
    undefined,
    { timeout: timeoutMs, polling: 100 },
  );
}

/** Wait out the isolation reload. Non-fatal on timeout — Surface
 * mode does not need SharedArrayBuffer, so a missing/slow dance does not by
 * itself prevent measurement; it is just logged. Playwright's
 * waitForFunction is proven (scripts/isolation-reload.verify.mjs) to survive
 * the navigation this triggers. */
async function waitForIsolation(page, timeoutMs = ISOLATION_TIMEOUT_MS) {
  try {
    await page.waitForFunction(
      () => window.crossOriginIsolated === true,
      undefined,
      { timeout: timeoutMs, polling: 100 },
    );
    return true;
  } catch {
    return false;
  }
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
    await page.waitForTimeout(100);
  }
}

/**
 * Mint a pose-pinned document the way surface-repro.verify.mjs's --mint
 * mode does (see the module doc for why a passive hash-read does not work):
 * click "Save to collection" and read the resulting entry's `.encoded`
 * field back out of localStorage. Returns a navigable "#v1=..." string, or
 * null if the collection save produced nothing to read.
 */
async function mintPinnedHash(page) {
  await openPanelSection(page, "collectionSection");
  await page.click("#saveCollectionBtn");
  // onSaveToCollection's localStorage write is synchronous in the click
  // handler; this is cheap insurance, not a real race.
  await page.waitForTimeout(200);
  const encoded = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const scenes = Array.isArray(parsed) ? parsed : parsed.scenes;
    return scenes?.at(-1)?.encoded ?? scenes?.[0]?.encoded ?? null;
  }, COLLECTION_STORAGE_KEY);
  return encoded ? `#${encoded}` : null;
}

/**
 * Wait for the TRUE settled state via window.__surfaceState(),
 * held continuously for dwellMs — see surface-repro.verify.mjs's module doc
 * for why neither the canvas nor the #surfaceProgress row can answer this
 * question. Never throws on timeout: returns {ok:false, ...} so the caller
 * can still attempt the capture phase and report a partial measurement.
 */
async function waitForSettled(page, dwellMs, budgetMs) {
  const t0 = Date.now();
  const deadline = t0 + budgetMs;
  let heldSince = null;
  let last = null;
  for (;;) {
    const s = await page.evaluate(() => window.__surfaceState?.() ?? null);
    if (s === null) {
      throw new Error(
        "window.__surfaceState is absent — the page was not loaded with ?surfacestate",
      );
    }
    last = s;
    const settled =
      s.mode === "surface" &&
      s.firstFrame &&
      s.settled &&
      !s.previewActive &&
      !s.settleActive &&
      !s.settlePending;
    if (settled) {
      heldSince ??= Date.now();
      if (Date.now() - heldSince >= dwellMs) {
        return { ok: true, elapsedMs: Date.now() - t0, state: s };
      }
    } else {
      heldSince = null;
    }
    if (Date.now() > deadline) {
      return { ok: false, elapsedMs: Date.now() - t0, state: last };
    }
    await page.waitForTimeout(250);
  }
}

/** "1280 × 720 · WebGL" -> "1280x720". Null if the detail text does not
 * start with a WxH pair (e.g. the modal never showed). */
function parseExportSize(detail) {
  const m = /^(\d+)\s*[×x]\s*(\d+)/.exec(detail || "");
  return m ? `${m[1]}x${m[2]}` : null;
}

/** Last "[surfperf] settle complete WxH spentMs=N ..." line's spentMs, or
 * null if none was logged. */
function extractLastSettleSpentMs(lines) {
  const re = /\[surfperf\] settle complete \S+ spentMs=([\d.]+)/;
  let last = null;
  for (const line of lines) {
    const m = re.exec(line);
    if (m) last = Number(m[1]);
  }
  return last;
}

/** Last "[surfperf] capture <done|ceiling|cancelled> px=N spentMs=N ..."
 * line, parsed — the capture drain's own internal accounting, independent
 * of this script's DOM/toast/download polling. Returns null if the app
 * build in front of this script does not log it yet. */
function extractLastCaptureLog(lines) {
  const re =
    /\[surfperf\] capture (done|ceiling|cancelled) px=(\d+) spentMs=([\d.]+) wall=([\d.]+) strips=(\d+) polls=(\d+) calls=(\d+)/;
  let last = null;
  for (const line of lines) {
    const m = re.exec(line);
    if (m) {
      last = {
        outcome: m[1],
        px: Number(m[2]),
        spentMs: Number(m[3]),
        wall: Number(m[4]),
        strips: Number(m[5]),
        polls: Number(m[6]),
        calls: Number(m[7]),
      };
    }
  }
  return last;
}

/**
 * Drive Save PNG through the real UI and race three terminal signals: the
 * browser `download` event (a delivered PNG), a terminal toast message
 * (saved/cancelled/refused), or the timeout bound. Polls #exportProgress
 * for the last percentage seen and #exportDetail for the modal's named
 * export size. Never throws — always resolves with an outcome, "timeout"
 * included, so a ceiling refusal is reported rather than crashing the run.
 */
async function runCapture(page, timeoutMs) {
  let downloadEvent = null;
  // Fire-and-forget: armed before the click, resolved (or timed out and
  // swallowed) independently of the polling loop below.
  void page
    .waitForEvent("download", { timeout: timeoutMs })
    .then((d) => {
      downloadEvent = d;
    })
    .catch(() => {});

  const t0 = Date.now();
  await page.click("#savePngBtn");

  let exportSize = null;
  let lastPct = null;
  let modalSeen = false;
  let toastText = "";
  let outcome = null;
  let lastLoggedPct = null;

  const deadline = t0 + timeoutMs;
  while (!outcome && Date.now() < deadline) {
    if (downloadEvent) {
      outcome = "saved";
      break;
    }
    const snap = await page
      .evaluate(() => {
        const modal = document.getElementById("exportModal");
        const detail = document.getElementById("exportDetail");
        const progress = document.getElementById("exportProgress");
        const toast = document.getElementById("toast");
        return {
          modalVisible: modal ? !modal.classList.contains("hidden") : false,
          detail: detail ? detail.textContent || "" : "",
          progressText: progress ? progress.textContent || "" : "",
          toastVisible: toast ? !toast.classList.contains("hidden") : false,
          toastText: toast ? toast.textContent || "" : "",
        };
      })
      .catch(() => null);
    if (snap) {
      if (snap.modalVisible) {
        if (!modalSeen) {
          console.error(`[capture-drain] export modal shown (${snap.detail})`);
        }
        modalSeen = true;
        if (snap.detail) exportSize = snap.detail;
      }
      const m = /^(\d+(?:\.\d+)?)%/.exec(snap.progressText);
      if (m) {
        lastPct = Number(m[1]);
        if (lastPct !== lastLoggedPct) {
          console.error(
            `[capture-drain] export progress: ${snap.progressText}`,
          );
          lastLoggedPct = lastPct;
        }
      }
      if (snap.toastVisible && snap.toastText) {
        toastText = snap.toastText;
        if (toastText.startsWith("Saved ")) outcome = "saved";
        else if (toastText === "Export cancelled") outcome = "cancelled";
        else if (
          toastText.includes("export skipped") ||
          toastText.includes("export aborted") ||
          toastText === "Couldn't encode the PNG"
        ) {
          outcome = "refused";
        }
        if (outcome) {
          console.error(
            `[capture-drain] toast: "${toastText}" -> outcome=${outcome}`,
          );
          break;
        }
      }
    }
    await page.waitForTimeout(CAPTURE_POLL_MS);
  }
  if (!outcome) outcome = downloadEvent ? "saved" : "timeout";
  const captureMs = Date.now() - t0;

  let downloadPath = null;
  if (downloadEvent) {
    try {
      downloadPath = path.join(
        OUT_DIR,
        `capture-drain-export-${Date.now()}.png`,
      );
      await downloadEvent.saveAs(downloadPath);
      console.error(`[capture-drain] download saved to ${downloadPath}`);
    } catch (err) {
      console.error(
        `[capture-drain] could not save download: ${err instanceof Error ? err.message : String(err)}`,
      );
      downloadPath = null;
    }
  }

  return {
    outcome,
    captureMs,
    exportSize,
    lastPct,
    modalSeen,
    toastText,
    downloadPath,
  };
}

async function main() {
  await mkOutDir();
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

  const pageErrors = [];
  const surfperfLines = [];
  let page = null;
  let hardFailure = false;

  let settleMs = null;
  let settleSpentMs = null;
  let captureResult = null;
  let hashRoundTripOk = null;
  let pinnedHash = null;

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true, // basicSsl's self-signed cert on npm run preview
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1, // apples-to-apples: export scale 1x traces the same pixel count as the settle
      reducedMotion: "reduce",
      acceptDownloads: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(
      Math.max(SETTLE_TIMEOUT_MS, CAPTURE_TIMEOUT_MS) + 60_000,
    );
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.startsWith("[surfperf]")) {
        surfperfLines.push(text);
        console.error(`[page] ${text}`);
      } else if (msg.type() === "error" || msg.type() === "warning") {
        console.error(`[page:${msg.type()}] ${text.slice(0, 2000)}`);
      }
    });

    // ---- Phase 0: mint a pose-pinned document ----------------------------
    console.error(`[capture-drain] navigating to ${BASE}/?${QUERY}`);
    await page.goto(`${BASE}/?${QUERY}`, {
      waitUntil: "load",
      timeout: NAV_TIMEOUT_MS,
    });
    await waitForBoot(page);
    const isolatedAfterFirstBoot = await waitForIsolation(page);
    console.error(
      `[capture-drain] crossOriginIsolated after first boot: ${isolatedAfterFirstBoot}`,
    );
    // Whether or not the isolation reload fired, re-confirm the boot signal
    // against whatever document is now current.
    await waitForBoot(page);
    await page.waitForTimeout(MINT_SETTLE_BUFFER_MS);

    pinnedHash = await mintPinnedHash(page);
    if (!pinnedHash) {
      console.error(
        "[capture-drain] FATAL: could not mint a pinned camera pose " +
          "(collection save produced no encoded scene in localStorage)",
      );
      hardFailure = true;
      throw new Error("mint failed");
    }
    console.error(
      `[capture-drain] minted pinned hash (${pinnedHash.length} chars)`,
    );

    // ---- Phase 1: hard-navigate to the pinned pose ------------------------
    const target = `${BASE}/?${QUERY}${pinnedHash}`;
    console.error("[capture-drain] navigating to the pinned hash");
    await page.goto(target, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
    // goto() alone may be a same-document (fragment-only) navigation that
    // never re-runs main.ts's boot — see the module doc. Force a real one.
    await page.reload({ waitUntil: "load", timeout: NAV_TIMEOUT_MS });
    await waitForBoot(page);

    const hashAfterNav = await page.evaluate(() => location.hash);
    hashRoundTripOk = hashAfterNav === pinnedHash;
    console.error(
      `[capture-drain] hash round-trip: ${hashRoundTripOk ? "ok" : "MISMATCH"}` +
        (hashRoundTripOk
          ? ""
          : ` (wanted ${pinnedHash.length} chars, got ${hashAfterNav.length} chars)`),
    );

    // Stability evidence: two screenshots ~800ms apart, byte-identical,
    // proves the pinned camera pose actually took (nothing still
    // auto-framing/gliding under it). The lead-in lets the chaos-game
    // worker finish landing this document's points first — see
    // STABILITY_CHECK_LEAD_MS's doc.
    await page.waitForTimeout(STABILITY_CHECK_LEAD_MS);
    const shotA = await page.screenshot({
      type: "jpeg",
      quality: 80,
      path: path.join(OUT_DIR, "capture-drain-pinned-pose-a.jpg"),
    });
    await page.waitForTimeout(STABILITY_CHECK_GAP_MS);
    const shotB = await page.screenshot({
      type: "jpeg",
      quality: 80,
      path: path.join(OUT_DIR, "capture-drain-pinned-pose-b.jpg"),
    });
    const poseStable = shotA.equals(shotB);
    console.error(
      `[capture-drain] pinned-pose screenshot stability: ${poseStable ? "stable" : "STILL CHANGING"}`,
    );

    // Context-loss tripwire, armed on this document (the one we actually
    // measure through).
    await page.evaluate(() => {
      window.__glLost = false;
      document
        .querySelector("canvas")
        ?.addEventListener("webglcontextlost", () => {
          window.__glLost = true;
        });
    });

    // ---- Phase 2: enter Surface mode, measure the live settle ------------
    const surfaceBtnState = await page.evaluate(() => {
      const b = document.getElementById("modeSurfaceBtn");
      return { disabled: b?.disabled ?? null, title: b?.title ?? "" };
    });
    if (surfaceBtnState.disabled) {
      console.error(
        `[capture-drain] FATAL: Surface mode unavailable (${surfaceBtnState.title})`,
      );
      hardFailure = true;
      throw new Error("surface mode disabled");
    }
    await page.click("#modeSurfaceBtn");
    const settle = await waitForSettled(
      page,
      SETTLE_DWELL_MS,
      SETTLE_TIMEOUT_MS,
    );
    settleMs = settle.elapsedMs;
    if (!settle.ok) {
      console.error(
        `[capture-drain] settle NEVER completed within ${SETTLE_TIMEOUT_MS}ms ` +
          `(last state=${JSON.stringify(settle.state)})`,
      );
      hardFailure = true;
      // Fall through and still attempt the capture phase best-effort — a
      // Save-PNG capture traces its own frame independent of the live
      // settle, so a partial measurement is still worth reporting.
    } else {
      console.error(
        `[capture-drain] settled in ${settleMs}ms (engine=${settle.state.engine})`,
      );
    }
    settleSpentMs = extractLastSettleSpentMs(surfperfLines);
    await page.screenshot({
      path: path.join(OUT_DIR, "capture-drain-settled.jpg"),
      type: "jpeg",
      quality: 85,
    });

    // ---- Phase 3: Save PNG, race the terminal signals ---------------------
    await openPanelSection(page, "captureSection");
    const saveBtnDisabled = await page
      .$eval("#savePngBtn", (b) => b.disabled)
      .catch(() => null);
    console.error(`[capture-drain] savePngBtn disabled=${saveBtnDisabled}`);
    captureResult = await runCapture(page, CAPTURE_TIMEOUT_MS);
    console.error(
      `[capture-drain] capture finished: outcome=${captureResult.outcome} ` +
        `ms=${captureResult.captureMs} modalSeen=${captureResult.modalSeen} ` +
        `lastPct=${captureResult.lastPct ?? "na"} exportSize=${captureResult.exportSize ?? "na"}`,
    );
    if (
      captureResult.outcome === "timeout" &&
      !captureResult.modalSeen &&
      !captureResult.downloadPath
    ) {
      console.error(
        "[capture-drain] FATAL: capture never produced any observable state " +
          "(modal never opened, no download, no toast)",
      );
      hardFailure = true;
    }
  } catch (err) {
    console.error(
      `[capture-drain] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    hardFailure = true;
  } finally {
    if (page && !page.isClosed()) {
      const glLost = await page
        .evaluate(() => window.__glLost)
        .catch(() => "unknown");
      console.error(`[capture-drain] context-lost tripwire: ${glLost}`);
      if (glLost === true) hardFailure = true;
      await page
        .screenshot({
          path: path.join(OUT_DIR, "capture-drain-final.jpg"),
          type: "jpeg",
          quality: 85,
        })
        .catch(() => {});
    }
    if (pageErrors.length) {
      console.error(`[capture-drain] page errors: ${pageErrors.join(" | ")}`);
      hardFailure = true;
    }

    // Every [surfperf] line seen, for anyone diffing a before/after run.
    for (const line of surfperfLines) console.error(line);

    const captureLog = extractLastCaptureLog(surfperfLines);
    if (captureResult && captureLog) {
      const expected =
        { saved: "done", refused: "ceiling", cancelled: "cancelled" }[
          captureResult.outcome
        ] ?? null;
      if (expected && expected !== captureLog.outcome) {
        console.error(
          `[capture-drain] NOTE: UI-observed outcome (${captureResult.outcome}) ` +
            `disagrees with the app's own capture log (${captureLog.outcome})`,
        );
      }
    }

    const exportSize = captureResult?.exportSize
      ? parseExportSize(captureResult.exportSize)
      : null;
    console.error(
      `[capture-drain] settleMs=${settleMs ?? "na"} ` +
        `captureMs=${captureResult?.captureMs ?? "na"} ` +
        `captureOutcome=${captureResult?.outcome ?? "na"} ` +
        `capturePct=${captureResult?.lastPct ?? "na"} ` +
        `exportSize=${exportSize ?? "na"} ` +
        `settleSpentMs=${settleSpentMs ?? "na"} ` +
        `captureSpentMs=${captureLog?.spentMs ?? "na"} ` +
        `captureLogOutcome=${captureLog?.outcome ?? "na"}`,
    );
    console.error(
      `[capture-drain] hashRoundTrip=${hashRoundTripOk ?? "na"} ` +
        `pinnedHashChars=${pinnedHash?.length ?? "na"}`,
    );

    await browser.close().catch(() => {});
  }
  process.exitCode = hardFailure ? 1 : 0;
}

main().catch((err) => {
  console.error("[capture-drain] fatal:", err);
  process.exitCode = 1;
});
