#!/usr/bin/env node
/**
 * Surface-preview-completion verifier (not an npm script, like
 * scripts/isolation-reload.verify.mjs).
 *
 * Graduates the reporter's throwaway repro script (which caught the BROKEN
 * behavior) into a permanent check of the FIXED contract.
 * The bug: on the WebGPU compute surface path, a preview frame truncated at
 * its SURFACE_COMPUTE_PREVIEW_BUDGET_MS wall budget (main.ts) while the
 * interaction-tier governor is already at its floor rung used to be the
 * preview's FINAL word — runSurfaceComputePreviewLoop drained and
 * surfaceComputeTick fired the full settle straight away, with no progress
 * disclosure (syncSurfaceProgress hid the row for every compute preview) and
 * no Skip button (skippable rode a WebGL-only phase). That is the exact
 * "quit on the user's behalf" pattern the no-automatic-give-up line of
 * work removed from the WebGL strip path — just missed here. Fixed
 * behavior: a truncated floor-rung frame on a PARKED view re-runs UNBUDGETED
 * to completion (progressive presents, like the settle), discloses
 * "Preview · WebGPU N%" in #surfaceProgress while it does, and shows the
 * one-shot Skip button throughout.
 *
 * Why Firefox-shaped: this script drives Playwright's bundled Firefox
 * (stock Firefox can't be driven by playwright-core), not Chrome. Firefox's
 * WebGPU is roughly 10-20x slower than Chrome's on the same hardware,
 * which is exactly what makes even the GOVERNOR FLOOR RUNG blow the 2s
 * preview budget — on Chrome the preview usually finishes inside
 * budget and the bug never engages. This is a device-speed bug, not a
 * browser-specific one; Firefox is just the reliable way to exercise it on
 * commodity hardware. A software/SwiftShader-class adapter would work too,
 * but Firefox's real (if slow) WebGPU is what the original report used.
 *
 * The scene is the reporter's exact repro pose, hand-transcribed (not
 * embedded as an opaque base64 blob) from the reporter's own scene hash:
 * the 20-map Menger sponge (src/fractal/presets.ts's mengerSponge(), mirrored
 * below since these plain-Node scripts can't import .ts sources — see
 * mengerSpongeTransforms()) plus a mandelbox fold FINAL lens and a balloon
 * echo (R=1.6). The lens makes the session fold-shaped
 * (main.ts's surfaceComputeEligible: deHasFolds(de) || de.foldFinal !==
 * null), which routes it onto the WebGPU compute renderer whenever an
 * adapter exists — and it is heavy enough that even the floor rung can miss
 * the 2s budget on a slow adapter. Every field was checked against the
 * decoded reporter hash field-for-field; fields not carried here (symmetry,
 * flame/solid/surface sub-params, glowBrightness, colorGamma, ...) decode to
 * documented defaults per persist.ts's decodeScene, which never rejects a
 * scene over an absent optional block — colorMode/renderStyle/numPoints/
 * pointSize are the only genuinely REQUIRED top-level fields and are all
 * present below. MEASURED end to end once the fix landed (Playwright
 * Firefox 151 WebGPU, real driver, 1920x1057, dev server): the transcribed
 * scene enters a WebGPU compute session and reproduces the reporter's
 * precondition exactly — two ~2.1s truncated floor previews at 134x74
 * resolving ~5% of their 9916 rays, then the unbudgeted completion pass
 * disclosing 3.9% -> 97%, with the settle behind it still climbing minutes
 * later. A wrong transcription cannot fake that: it lands as zero compute
 * preview lines (INCONCLUSIVE, "WebGL fallback?"), never as a false PASS.
 *
 * What the script does: navigates to `?surfacestate<hash>`, clicks
 * #modeSurfaceBtn, then polls every ~250ms recording (a) console.debug
 * breadcrumbs for "Surface compute preview ..." / "Surface compute settle
 * ..." lines, classifying each preview line as truncated / completion /
 * plain from its trailing parenthetical, (b) the #surfaceProgress row text
 * whenever it's visible, (c) whether #surfaceSkipPreviewBtn is visible, and
 * (d) the window.__surfaceState() probe — until `settled` latches
 * or --watchMs runs out. It never clicks Skip unless --skip is passed.
 *
 * Usage:
 *   node scripts/surface-preview-completion.verify.mjs \
 *     [--url=https://localhost:5173] [--display=:0] [--watchMs=180000] \
 *     [--headless] [--viewport=1920x1057] [--skip]
 *
 *   The dev server must already be running (`npm run dev`) — this script
 *   only drives a browser against it and never starts one itself.
 *
 * Exit codes. The two modes verify COMPLEMENTARY halves of the contract:
 * without --skip, that the pass runs to completion; with it, that the pass
 * yields when asked. A --skip run cannot show both — its click fires at the
 * first disclosed, skippable sample, which is by construction before the
 * pass could finish — so each half needs its own run.
 *   0  PASS          Default mode: a truncated floor-rung preview was
 *                     observed, an unbudgeted completion pass followed it
 *                     before any settle activity, and the row disclosed
 *                     "Preview · WebGPU N%" with the Skip button visible
 *                     while it ran. With --skip: that same disclosure was
 *                     live (it is what makes the click possible) and the
 *                     click handed the session to the full render inside
 *                     30s; the pass's natural completion is NOT verified
 *                     there, and the verdict text says so.
 *   1  FAIL           Either the old bug reproduced (a truncated preview was
 *                     followed by settle activity — console "Surface
 *                     compute settle" or the row jumping straight to
 *                     "Full detail" — with no completion pass in between),
 *                     or a completion pass ran without the disclosure row
 *                     and/or Skip button visible while it did, or (with
 *                     --skip) clicking Skip never led to a settle within
 *                     30s. A fatal script error also exits 1.
 *   2  INCONCLUSIVE   This run never exercised the bug's precondition: no
 *                     compute preview lines at all (WebGL fallback or no
 *                     adapter — the printed reason says which), every
 *                     preview finished inside its 2s budget (device/pose too
 *                     fast — try a bigger --viewport or a heavier pose), the
 *                     watch window expired mid-preview before either a
 *                     completion pass or a settle appeared, or (with --skip)
 *                     the click landed but its handoff never resolved.
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
const BASE = args.url ?? "https://localhost:5173";
const DISPLAY = args.display ?? ":0";
const WATCH_MS = Number(args.watchMs ?? 180000);
const POLL_MS = 250;
const SKIP_SETTLE_TIMEOUT_MS = 30000;
const FIREFOX_BIN = path.join(
  os.homedir(),
  ".cache/ms-playwright/firefox-1532/firefox/firefox",
);

const [rawViewportW, rawViewportH] = String(args.viewport ?? "1920x1057")
  .split("x")
  .map(Number);
const VIEWPORT =
  Number.isFinite(rawViewportW) && Number.isFinite(rawViewportH)
    ? { width: rawViewportW, height: rawViewportH }
    : { width: 1920, height: 1057 };

const log = (...a) => console.log("[surface-preview-completion]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the reporter's scene, transcribed (see header doc) -------------------

/** The 20 edge/corner sub-cubes of a Menger sponge — mirrors
 * src/fractal/presets.ts's mengerSponge() exactly (face-center and
 * true-center cells removed), reproduced here rather than imported because
 * this plain-Node script has no TS loader for src/. Verified against the
 * decoded reporter hash: same 20 positions, same iteration order. */
function mengerSpongeTransforms() {
  const s = 1 / 3;
  const transforms = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const zeros = (x === 0 ? 1 : 0) + (y === 0 ? 1 : 0) + (z === 0 ? 1 : 0);
        if (zeros >= 2) continue; // face-center (2 zeros) + true-center (3)
        transforms.push({
          position: [x * 0.5, y * 0.5, z * 0.5],
          rotation: [0, 0, 0],
          scale: [s, s, s],
        });
      }
    }
  }
  return transforms; // 20 entries
}

const scene = {
  transforms: mengerSpongeTransforms(),
  numPoints: 100000,
  pointSize: 1,
  colorMode: "transform",
  renderStyle: "depthFade",
  showGuides: true,
  // The balloon echo, copied verbatim from the reporter's hash —
  // orthogonal to compute eligibility, but part of the exact repro pose.
  balloonEcho: true,
  balloonRadius: 1.6,
  // The fold FINAL lens: a pure-mandelbox final transform is what
  // makes this system fold-shaped (de.foldFinal !== null), routing it onto
  // the WebGPU compute renderer instead of the plain-affine WebGL tracer.
  finalTransform: {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight: 1 }],
  },
  // Pinned camera pose, copied verbatim from the reporter's hash — a
  // pose-less scene auto-frames from a random seed, which would make the
  // floor-rung-truncation precondition unreproducible run to run.
  camera: {
    target: [-0.0005, 0.0009, 0],
    radius: 2.7997,
    theta: -0.3503,
    phi: 1.056,
  },
};

const enc = (s) =>
  "#v1=" + Buffer.from(JSON.stringify(s)).toString("base64url");
const HASH = enc(scene);

// ---- console-line / progress-row parsing -----------------------------------

// Mirrors main.ts's runSurfaceComputePreviewLoop console.debug template:
// `Surface compute preview ${w}x${h}: ${wallMs}ms wall, ${passes} passes` +
// `${truncated ? " (truncated)" : ""}, hit ${hit} / miss ${miss} / ` +
// `exhausted ${exhausted} / active ${active}` — post-fix, the same slot
// carries "(completion)" for the unbudgeted re-run, or nothing at all for a
// preview that finished inside its wall budget.
const PREVIEW_LINE_RE =
  /^Surface compute preview (\d+)x(\d+): ([\d.]+)ms wall, (\d+) passes(?: \((\w+)\))?, hit (\d+) \/ miss (\d+) \/ exhausted (\d+) \/ active (\d+)/;
// Mirrors runSurfaceComputeSettle's console.debug template (no truncated/
// completion tag, no active count — the settle always runs to completion).
const SETTLE_LINE_RE =
  /^Surface compute settle (\d+)x(\d+): ([\d.]+)ms wall, (\d+) passes, hit (\d+) \/ miss (\d+) \/ exhausted (\d+)/;
// U+00B7 MIDDLE DOT (not a period or a bullet) — see ui.ts's
// setSurfaceProgress / main.ts's syncSurfaceProgress. The percentage
// carries ONE DECIMAL below 10% (export-progress.ts's
// formatRenderPercent), and a completion pass opens at ~4%, so `[\d.]+`
// is load-bearing: `\d+` would miss every sample of a short pass and
// fail the disclosure check on a working build.
const PREVIEW_ROW_RE = /^Preview · WebGPU(?: \(software\))? [\d.]+%/;
const FULL_ROW_RE = /^Full detail · WebGPU(?: \(software\))? [\d.]+%/;

function classifyPreview(text) {
  const m = PREVIEW_LINE_RE.exec(text);
  if (!m) return null;
  const tag = m[5];
  const kind =
    tag === "truncated"
      ? "truncated"
      : tag === "completion"
        ? "completion"
        : tag
          ? "other"
          : "plain";
  return { kind, tag };
}

async function run() {
  log(`firefox=${FIREFOX_BIN}`);
  log(
    `url=${BASE} display=${DISPLAY} watchMs=${WATCH_MS} viewport=${VIEWPORT.width}x${VIEWPORT.height} skip=${Boolean(args.skip)}`,
  );
  const browser = await firefox.launch({
    executablePath: FIREFOX_BIN,
    headless: Boolean(args.headless),
    // Firefox's WebGPU is the whole point of this script — see header doc:
    // it's slow enough that even the governor's floor rung can blow the
    // preview's 2s wall budget, which is the precondition this test needs.
    env: { ...process.env, DISPLAY, MOZ_WEBRENDER: "1" },
    firefoxUserPrefs: {
      "dom.webgpu.enabled": true,
      "gfx.webgpu.ignore-blocklist": true,
    },
  });

  const events = []; // chronological: { t, tMs, kind: "console"|"row"|"note", text }
  const samples = []; // every poll tick: { tMs, row, skipVisible, probe }
  let verdict = "UNKNOWN";
  let exitCode = 1;
  const t0 = Date.now();
  const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";

  try {
    const ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: VIEWPORT,
    });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      const text = msg.text();
      if (
        /Surface (render|compute)|WebGPU|compute tracer|surface/i.test(text)
      ) {
        events.push({
          t: stamp(),
          tMs: Date.now() - t0,
          kind: "console",
          text,
        });
        log(`console[${msg.type()}] ${stamp()}: ${text}`);
      }
    });
    page.on("pageerror", (e) => log(`pageerror: ${String(e)}`));

    const url = `${BASE}/?surfacestate${HASH}`;
    log(`navigating (hash len ${HASH.length})`);
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.bringToFront().catch(() => {});
    await sleep(3000);

    // Sanity: does this Firefox hand out a WebGPU adapter at all? Purely
    // diagnostic — folded into the INCONCLUSIVE reason below if no compute
    // preview lines ever show up.
    const gpuProbeResult = await page.evaluate(async () => {
      if (!("gpu" in navigator)) return "no navigator.gpu";
      try {
        const a = await navigator.gpu.requestAdapter();
        if (!a) return "adapter null";
        return `adapter ok (fallback=${a.isFallbackAdapter ?? "?"})`;
      } catch (e) {
        return `requestAdapter threw: ${e}`;
      }
    });
    log(`webgpu probe: ${gpuProbeResult}`);

    await page.evaluate(() => {
      const btn = document.getElementById("modeSurfaceBtn");
      if (!btn) throw new Error("no #modeSurfaceBtn");
      btn.click();
    });
    log("clicked #modeSurfaceBtn; polling every 250ms...");

    const tEnter = Date.now();
    let lastRow = "";
    let skipClicked = false;
    let skipCheck = null; // { clickedAtMs, resolved, ok }

    while (Date.now() - tEnter < WATCH_MS) {
      await sleep(POLL_MS);
      const sample = await page.evaluate(() => {
        // Both elements hide via a `hidden` class, not display/visibility —
        // see ui.ts's setSurfaceProgress.
        const rowEl = document.getElementById("surfaceProgress");
        const rowVisible = rowEl ? !rowEl.classList.contains("hidden") : false;
        const row = rowVisible ? (rowEl.textContent ?? "").trim() : "";
        const skipEl = document.getElementById("surfaceSkipPreviewBtn");
        const skipVisible = skipEl
          ? !skipEl.classList.contains("hidden")
          : false;
        const probe = window.__surfaceState?.() ?? null;
        return { row, skipVisible, probe };
      });
      const tMs = Date.now() - t0;
      samples.push({
        tMs,
        row: sample.row,
        skipVisible: sample.skipVisible,
        probe: sample.probe,
      });

      if (sample.row !== lastRow) {
        lastRow = sample.row;
        if (sample.row) {
          events.push({ t: stamp(), tMs, kind: "row", text: sample.row });
          log(`row ${stamp()}: "${sample.row}" skip=${sample.skipVisible}`);
        }
      }

      if (
        args.skip &&
        !skipClicked &&
        sample.skipVisible &&
        PREVIEW_ROW_RE.test(sample.row)
      ) {
        skipClicked = true;
        log(
          `clicking #surfaceSkipPreviewBtn at ${stamp()} (row="${sample.row}")`,
        );
        await page.evaluate(() =>
          document.getElementById("surfaceSkipPreviewBtn").click(),
        );
        events.push({
          t: stamp(),
          tMs: Date.now() - t0,
          kind: "note",
          text: "clicked Skip preview",
        });
        skipCheck = {
          clickedAtMs: Date.now() - t0,
          resolved: false,
          ok: false,
        };
      }

      if (skipCheck !== null && !skipCheck.resolved) {
        const sinceClickMs = Date.now() - t0 - skipCheck.clickedAtMs;
        const settleReached =
          sample.probe?.settleActive === true ||
          events.some(
            (e) =>
              e.kind === "console" &&
              SETTLE_LINE_RE.test(e.text) &&
              e.tMs >= skipCheck.clickedAtMs,
          );
        if (settleReached) {
          skipCheck.resolved = true;
          skipCheck.ok = true;
          log(
            `skip check: settle reached ${(sinceClickMs / 1000).toFixed(1)}s after click`,
          );
        } else if (sinceClickMs >= SKIP_SETTLE_TIMEOUT_MS) {
          skipCheck.resolved = true;
          skipCheck.ok = false;
          log("skip check: FAILED — no settle within 30s of clicking Skip");
        }
      }

      if (sample.probe?.settled === true) {
        events.push({
          t: stamp(),
          tMs,
          kind: "note",
          text: "probe settled=true",
        });
        log(`probe ${stamp()}: settled=true`);
        break;
      }
    }

    // ---- verdict --------------------------------------------------------
    const previewEvents = events
      .filter((e) => e.kind === "console")
      .map((e) => ({ ...e, preview: classifyPreview(e.text) }))
      .filter((e) => e.preview !== null);
    const truncatedEvents = previewEvents.filter(
      (e) => e.preview.kind === "truncated",
    );
    const completionEvents = previewEvents.filter(
      (e) => e.preview.kind === "completion",
    );
    const otherTaggedEvents = previewEvents.filter(
      (e) => e.preview.kind === "other",
    );
    const settleConsoleEvents = events.filter(
      (e) => e.kind === "console" && SETTLE_LINE_RE.test(e.text),
    );
    const previewRowEvents = events.filter(
      (e) => e.kind === "row" && PREVIEW_ROW_RE.test(e.text),
    );
    const fullRowEvents = events.filter(
      (e) => e.kind === "row" && FULL_ROW_RE.test(e.text),
    );

    if (otherTaggedEvents.length > 0) {
      log(
        `WARNING: ${otherTaggedEvents.length} preview line(s) carried an ` +
          `unrecognized parenthetical (neither "truncated" nor "completion") — ` +
          `contract wording may have drifted: ${otherTaggedEvents.map((e) => `"${e.text}"`).join(", ")}`,
      );
    }

    const firstTruncated = truncatedEvents[0] ?? null;
    const firstSettleSignal =
      [...settleConsoleEvents, ...fullRowEvents].sort(
        (a, b) => a.tMs - b.tMs,
      )[0] ?? null;
    const firstCompletionAfterTruncated =
      firstTruncated !== null
        ? (completionEvents.find((e) => e.tMs > firstTruncated.tMs) ?? null)
        : null;
    // --skip clicks Skip the first time the row is skippable, which on this
    // single-invalidation repro pose is almost always WHILE the completion
    // pass is still climbing — well before it would finish naturally. That
    // click legitimately sends the session to settle with no completion
    // line ever appearing, which must NOT read as the silent preview quit:
    // the row disclosed "Preview · WebGPU N%" with Skip visible right up to
    // the click (that's what made the click possible), and the user asked
    // to bail. Only a settle signal at/after the click can be this —
    // one that precedes it (or a run where the button never even appeared)
    // is the real bug, --skip or not.
    const settleCausedBySkipClick =
      skipCheck !== null &&
      firstSettleSignal !== null &&
      firstSettleSignal.tMs >= skipCheck.clickedAtMs;

    const disclosureHeldDuring = (startMs, endMs) =>
      samples.some(
        (s) =>
          s.tMs >= startMs &&
          s.tMs <= endMs &&
          PREVIEW_ROW_RE.test(s.row) &&
          s.skipVisible,
      );

    if (previewEvents.length === 0) {
      const fallbackLine = events.find(
        (e) =>
          e.kind === "console" &&
          /Surface compute (unavailable|device lost)/i.test(e.text),
      );
      const activeLine = events.find(
        (e) =>
          e.kind === "console" && /WebGPU compute tracer active/i.test(e.text),
      );
      const sawWebglRow = events.some(
        (e) => e.kind === "row" && /WebGL/.test(e.text),
      );
      const reason = fallbackLine
        ? `compute reported unavailable: "${fallbackLine.text}"`
        : sawWebglRow
          ? "the progress row showed a WebGL-engine label — this session used the WebGL tracer, not compute"
          : activeLine
            ? "the compute tracer WAS active but logged no preview lines"
            : `no compute-tracer-active line seen either; webgpu adapter probe said: ${gpuProbeResult}`;
      verdict = `INCONCLUSIVE: no 'Surface compute preview' console lines observed at all (${reason}).`;
      exitCode = 2;
    } else if (firstTruncated === null) {
      verdict =
        `INCONCLUSIVE: ${previewEvents.length} preview(s) observed but every one finished inside its ` +
        "2s wall budget on this device/pose — the governor floor rung was never exercised. " +
        "Try a bigger --viewport or a heavier pose.";
      exitCode = 2;
    } else if (
      firstSettleSignal !== null &&
      settleCausedBySkipClick &&
      (firstCompletionAfterTruncated === null ||
        firstSettleSignal.tMs < firstCompletionAfterTruncated.tMs)
    ) {
      // --skip verifies a DIFFERENT half of the contract and cannot verify
      // this one: the click fires at the first sample where the row reads
      // "Preview · WebGPU N%" with the Skip button visible, so a settle
      // with no completion line before it is the DESIGNED outcome here,
      // not the silent quit. Note the click's own precondition IS the
      // disclosure (the same predicate disclosureHeldDuring tests), and
      // skipCheck timed the handoff — so a PASS in this mode says: the
      // completion pass ran, disclosed itself, and yielded the moment the
      // user asked. It does NOT say the pass was allowed to finish. The
      // two modes verify complementary halves; exit 0 has to be reachable
      // in both, or --skip is a mode whose success looks like a failure.
      const clickedAt = `${(skipCheck.clickedAtMs / 1000).toFixed(1)}s`;
      if (skipCheck.ok) {
        verdict =
          `PASS (--skip): the completion pass following the truncated preview at ${firstTruncated.t} disclosed ` +
          `"Preview · WebGPU N%" with the Skip button live at ${clickedAt}, and the click handed off to the full ` +
          "render (see skip-check below). The pass was deliberately cut short, so its natural completion is " +
          "unverified in this mode — rerun without --skip for that half.";
        exitCode = 0;
      } else {
        verdict =
          `INCONCLUSIVE: --skip clicked Skip preview at ${clickedAt} and the session moved to settle ` +
          `(${firstSettleSignal.kind} "${firstSettleSignal.text}" at ${firstSettleSignal.t}) — the button working ` +
          "as designed, not the silent preview quit — but the handoff itself never resolved within this run.";
        exitCode = 2;
      }
    } else if (
      firstSettleSignal !== null &&
      (firstCompletionAfterTruncated === null ||
        firstSettleSignal.tMs < firstCompletionAfterTruncated.tMs)
    ) {
      verdict =
        `FAIL: truncated preview at ${firstTruncated.t} was followed by settle activity ` +
        `(${firstSettleSignal.kind} "${firstSettleSignal.text}" at ${firstSettleSignal.t}) with no ` +
        "completion pass in between — the preview quit silently on the user's behalf (the bug reproduced).";
      exitCode = 1;
    } else if (firstCompletionAfterTruncated === null) {
      verdict =
        `INCONCLUSIVE: truncated preview at ${firstTruncated.t} observed, but the watch window expired ` +
        "before a completion pass or any settle activity appeared — still grinding. Rerun with a larger --watchMs.";
      exitCode = 2;
    } else if (
      !disclosureHeldDuring(
        firstTruncated.tMs,
        firstCompletionAfterTruncated.tMs,
      )
    ) {
      verdict =
        `FAIL: completion pass at ${firstCompletionAfterTruncated.t} ran (following the truncated preview ` +
        `at ${firstTruncated.t}), but no poll sample in between showed both "Preview · WebGPU N%" and the ` +
        "Skip button visible at once — disclosure/Skip contract violated even though the silent-quit bug itself is fixed.";
      exitCode = 1;
    } else {
      verdict =
        `PASS: truncated preview at ${firstTruncated.t} was followed by an unbudgeted completion pass at ` +
        `${firstCompletionAfterTruncated.t} (before any settle activity), disclosed as "Preview · WebGPU N%" ` +
        "with the Skip button visible throughout.";
      exitCode = 0;
    }

    // Fold in the opt-in --skip assertion.
    if (args.skip) {
      if (skipCheck === null) {
        verdict += " [skip-check: not exercised — Skip button never appeared]";
      } else if (!skipCheck.resolved) {
        verdict +=
          " [skip-check: clicked, still pending when the watch window ended]";
      } else if (skipCheck.ok) {
        verdict += " [skip-check: OK]";
      } else {
        verdict +=
          " [skip-check: FAILED — no settle within 30s of clicking Skip]";
        exitCode = 1;
      }
    }

    if (exitCode !== 0) {
      log("--- offending event stream ---");
      for (const e of events) log(`${e.t} [${e.kind}] ${e.text}`);
    }

    log("--- summary ---");
    log(
      `previews=${previewEvents.length} truncated=${truncatedEvents.length} ` +
        `completion=${completionEvents.length} rows=${events.filter((e) => e.kind === "row").length} ` +
        `(preview=${previewRowEvents.length} full=${fullRowEvents.length}) ` +
        `skipVisibleSamples=${samples.filter((s) => s.skipVisible).length}`,
    );
    log(`VERDICT: ${verdict}`);
  } finally {
    await browser.close().catch(() => {});
  }

  process.exit(exitCode);
}

run().catch((e) => {
  console.error("[surface-preview-completion] fatal:", e);
  process.exit(1);
});
