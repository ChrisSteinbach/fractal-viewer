#!/usr/bin/env node
/**
 * Measures whether a touch scroll gesture that STARTS ON a panel control
 * accidentally activates that control on real Chromium — the open question
 * left after fr-zoi hardened range sliders specifically
 * (src/app/slider-scroll-guard.ts, verified at the time against real
 * Chromium under a touch harness). This script generalizes that harness to
 * the panel's other interactive shapes: a <select> (#colorMode), a
 * checkbox (#showGuides), a plain button (#regenerateBtn), and a
 * dynamically-rendered transform-list row button — plus the range slider
 * again (#fogSlider) as a POSITIVE CONTROL, so a run against a build that
 * never had slider-scroll-guard.ts would show the slider flipping back to
 * HAZARD, proving the harness can actually see the bug class it is looking
 * for in the other shapes, not just report SAFE by construction.
 *
 * MEASUREMENT ONLY. This script asserts nothing and never fails the run
 * over a discovered hazard — it prints a table of what was observed (did
 * the gesture actually scroll a container, did click/change/input fire,
 * did the control's value/selection change) and a HAZARD/SAFE verdict per
 * control type, and leaves what — if anything — to fix as a separate,
 * later decision.
 *
 * Every gesture is dispatched at the CDP Input level
 * (`Input.dispatchTouchEvent`), never as a JS-constructed TouchEvent — a
 * page-dispatched TouchEvent is untrusted and never reaches Blink's real
 * touch-to-scroll/tap disambiguation (the exact machinery under test), so
 * only CDP-level input exercises it: touchstart at the control's center
 * (or near its left edge — sliders jump to wherever the thumb lands, so
 * track position matters for them specifically), ~10 touchmove steps
 * travelling up to 180px with a short pause between each (a single big
 * jump reads as a fling, not the steady drag of a real scroll), then
 * touchend.
 *
 * The swipe direction is chosen per trial, not hardcoded to "upward": the
 * panel is one long accordion, and a control positioned near the bottom of
 * the open section can already have `scrollIntoView` land its scroller at
 * (or near) its maximum scrollTop, leaving an upward swipe nowhere to go —
 * measured directly on this app's default layout, where #showGuides and
 * #fogSlider both land the panel already pinned at its max scrollTop
 * (639px). Each trial walks up from the target to find its nearest actual
 * scroll container (the panel itself for the four Appearance targets, the
 * nested `.transform-list` for the row trial) and swipes toward whichever
 * direction — up or down — currently has more room, so "did this gesture
 * actually scroll" stays a fair question instead of an artifact of where
 * the control happens to sit in the panel.
 *
 * Usage: node scripts/panel-touch-scroll.verify.mjs [url]
 * (url defaults to https://localhost:5173 — start `npm run dev` first.)
 * Screenshots land in .playwright-mcp/ (gitignored) for eyeballing.
 *
 * Exit code: 0 whenever every trial ran to completion, regardless of
 * verdict (a HAZARD is the interesting, valid result this script exists to
 * find, not a harness failure). Exit 1 only when the harness itself
 * couldn't do its job — the app never booted, a targeted control is
 * missing from the DOM, etc.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", ".playwright-mcp");
const BASE = (process.argv[2] ?? "https://localhost:5173").replace(/\/+$/, "");

/** Upward travel of the synthetic swipe — comfortably past the guard's own
 * SCROLL_INTENT_PX (12px), matching a real, deliberate scroll gesture. */
const SWIPE_DISTANCE_PX = 180;
/** touchmove steps the swipe is broken into — small increments so
 * Chromium's gesture recognizer reads this as a drag/scroll, not a fling. */
const SWIPE_STEPS = 10;
/** Pause between touch events, milliseconds — "a few ms", not a jump. */
const SWIPE_STEP_DELAY_MS = 20;
/** Left-edge start offset (sliders jump to wherever the thumb lands, so
 * track position matters for them specifically — item 5 of the brief). */
const LEFT_EDGE_OFFSET_PX = 8;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const harnessErrors = [];
function fail(label) {
  console.error(`[panel-touch-scroll] HARNESS FAIL: ${label}`);
  harnessErrors.push(label);
}

/** Dispatch one realistic touch-scroll gesture at the CDP Input level,
 * starting at (x, yStart) and travelling straight up ("up", y decreases —
 * the finger moves toward the top of the screen, which scrolls content up
 * and INCREASES scrollTop) or down ("down", y increases, DECREASES
 * scrollTop) in SWIPE_STEPS increments. Pure vertical motion mirrors
 * installSliderScrollGuard's own scroll-intent shape (adx < SLIDE_SLOP_PX,
 * ady > SCROLL_INTENT_PX) — the exact gesture shape the guard was built to
 * recognize; the guard's own check is direction-agnostic (it only looks at
 * |dy|), so "down" exercises exactly the same machinery as "up".
 *
 * `onStarted`, if given, runs right after touchstart lands and before any
 * touchmove — the window in which a range input's native pointerdown
 * default action (the tap-jump) has already applied but
 * installSliderScrollGuard's restore (pointercancel/pointerup-triggered)
 * has not yet run, since that only fires once the gesture is later
 * recognized as a scroll. That is the one moment a MID-gesture snapshot
 * can see the raw hazard even on a control the app successfully protects
 * by the time the gesture ends. */
async function touchScroll(cdp, x, yStart, distance, direction, onStarted) {
  const sign = direction === "up" ? -1 : 1;
  const point = (y) => [{ x: Math.round(x), y: Math.round(y) }];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: point(yStart),
  });
  await sleep(SWIPE_STEP_DELAY_MS);
  if (onStarted) await onStarted();
  const stepDist = distance / SWIPE_STEPS;
  for (let i = 1; i <= SWIPE_STEPS; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(yStart + sign * stepDist * i),
    });
    await sleep(SWIPE_STEP_DELAY_MS);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

/** Read just the comparable state fields (see stateEqual/formatState) for
 * `selector`, with no side effects — used for the mid-gesture snapshot. */
async function snapshotState(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return {
      value: el && "value" in el ? el.value : null,
      checked: el && "checked" in el ? el.checked : null,
      selected: el ? el.classList.contains("selected") : null,
      selectedName:
        document.querySelector(".transform-btn.selected .name")?.textContent ??
        null,
    };
  }, selector);
}

/** The four instrumented Appearance-section targets (item 3 of the brief).
 * fogSlider is the KNOWN hazard — the positive control that proves the
 * harness detects a real one when it exists. */
const TARGETS = [
  { name: "colorMode", selector: "#colorMode", kind: "select" },
  { name: "showGuides", selector: "#showGuides", kind: "checkbox" },
  { name: "regenerateBtn", selector: "#regenerateBtn", kind: "button" },
  {
    name: "fogSlider (positive control)",
    selector: "#fogSlider",
    kind: "range",
  },
];

/** The transform-list row trial (item 6): the second `.transform-btn` is
 * index 0's sibling — the camera row renders first, so this is "Transform
 * 1", the first real transform row. Dynamically rebuilt on every
 * renderTransformList() call, unlike the four static TARGETS above — see
 * setupTrial's fresh-listener-per-trial installation, which is what makes
 * this safe to instrument at all. */
const ROW_TARGET = {
  name: "transform row 2 (Transform 1)",
  selector: "#transformList > .transform-btn:nth-of-type(2)",
  kind: "row",
};

/** Bring the control into view, install FRESH click/change/input counters
 * on window.__probe[selector] (fresh every call — the transform-list row's
 * button is destroyed and recreated by renderTransformList() on state
 * changes, so a listener installed once at the top of the run could end up
 * attached to a long-discarded node), and snapshot pre-gesture state. */
async function setupTrial(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    window.__probe = window.__probe || {};
    const counts = { click: 0, change: 0, input: 0 };
    window.__probe[sel] = counts;
    el.addEventListener("click", () => counts.click++);
    el.addEventListener("change", () => counts.change++);
    el.addEventListener("input", () => counts.input++);
    const r = el.getBoundingClientRect();
    const panel = document.getElementById("panel");
    const list = document.getElementById("transformList");

    // The nearest actual scroll container — #panel for the four static
    // Appearance targets, the nested .transform-list for the row trial —
    // walked dynamically rather than assumed, so the room computation
    // below is correct regardless of which target this is.
    let scroller = el.parentElement;
    while (scroller) {
      const style = getComputedStyle(scroller);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        scroller.scrollHeight > scroller.clientHeight + 1
      ) {
        break;
      }
      scroller = scroller.parentElement;
    }
    scroller =
      scroller || document.scrollingElement || document.documentElement;
    const maxScroll = Math.max(
      0,
      scroller.scrollHeight - scroller.clientHeight,
    );

    return {
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      panelScrollTop: panel ? panel.scrollTop : null,
      listScrollTop: list ? list.scrollTop : null,
      value: "value" in el ? el.value : null,
      checked: "checked" in el ? el.checked : null,
      selected: el.classList.contains("selected"),
      selectedName:
        document.querySelector(".transform-btn.selected .name")?.textContent ??
        null,
      scroller: {
        // Room available for a swipe in each direction (see touchScroll's
        // doc comment for the y/scrollTop sign convention).
        roomUp: maxScroll - scroller.scrollTop,
        roomDown: scroller.scrollTop,
      },
    };
  }, selector);
}

/** Re-query (the row's node may have been replaced by a re-render) and
 * snapshot post-gesture state + the counters installed by setupTrial. */
async function readAfter(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const panel = document.getElementById("panel");
    const list = document.getElementById("transformList");
    const counts = (window.__probe && window.__probe[sel]) || {
      click: 0,
      change: 0,
      input: 0,
    };
    return {
      panelScrollTop: panel ? panel.scrollTop : null,
      listScrollTop: list ? list.scrollTop : null,
      value: el && "value" in el ? el.value : null,
      checked: el && "checked" in el ? el.checked : null,
      selected: el ? el.classList.contains("selected") : null,
      selectedName:
        document.querySelector(".transform-btn.selected .name")?.textContent ??
        null,
      counts,
    };
  }, selector);
}

/** Are `a` and `b`'s comparable state fields equal, per control kind? */
function stateEqual(kind, a, b) {
  switch (kind) {
    case "checkbox":
      return a.checked === b.checked;
    case "select":
    case "range":
      return a.value === b.value;
    case "row":
      return a.selected === b.selected && a.selectedName === b.selectedName;
    default:
      return true; // buttons carry no state of their own.
  }
}

/** True if the gesture ever moved the control off its pre-gesture state —
 * either transiently (mid-gesture, then corrected) or in the final,
 * settled outcome. A slider whose guard restores the value by touchend
 * still counts: the raw hazard fired, the app just cleaned up after it. */
function computeValueChanged(kind, before, mid, after) {
  return (
    !stateEqual(kind, before, after) ||
    (mid !== null && !stateEqual(kind, before, mid))
  );
}

function formatState(kind, snap) {
  switch (kind) {
    case "checkbox":
      return String(snap.checked);
    case "select":
    case "range":
      return String(snap.value);
    case "row":
      return snap.selectedName ?? "(none)";
    default:
      return "n/a";
  }
}

/** Run one trial: setup + instrument, dispatch the touch-scroll gesture,
 * then snapshot the aftermath. Returns null (and records a harness
 * failure) if the control was missing from the DOM. */
async function runTrial(page, cdp, target, xMode) {
  const before = await setupTrial(page, target.selector);
  if (!before) {
    fail(`${target.name}: control missing (${target.selector})`);
    return null;
  }
  await page.waitForTimeout(80); // let scrollIntoView settle before measuring.

  const x =
    xMode === "center"
      ? before.rect.left + before.rect.width / 2
      : Math.min(
          before.rect.left + LEFT_EDGE_OFFSET_PX,
          before.rect.left + before.rect.width - 2,
        );
  const y = before.rect.top + before.rect.height / 2;

  // Swipe toward whichever direction currently has more room (see the
  // module doc comment) — "up" is preferred by the brief, but only when it
  // can actually move the scroller.
  const { roomUp, roomDown } = before.scroller;
  const direction = roomUp >= roomDown ? "up" : "down";
  const distance = Math.min(SWIPE_DISTANCE_PX, Math.max(roomUp, roomDown));

  let mid = null;
  await touchScroll(cdp, x, y, Math.max(distance, 1), direction, async () => {
    // Right after touchstart, before any touchmove — see touchScroll's doc
    // comment for why this is the one window a corrected hazard is still
    // visible in.
    mid = await snapshotState(page, target.selector);
  });
  await page.waitForTimeout(150); // let click/change/input and any re-render land.

  const after = await readAfter(page, target.selector);
  // Defensive: a spurious click on <select> may open its popup — close it
  // before it can intercept the next trial's input.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(100);

  const panelDelta = (after.panelScrollTop ?? 0) - (before.panelScrollTop ?? 0);
  const listDelta = (after.listScrollTop ?? 0) - (before.listScrollTop ?? 0);

  return {
    target,
    xMode,
    before,
    mid,
    after,
    panelDelta,
    listDelta,
    swipeDirection: direction,
    swipeDistance: Math.round(Math.max(distance, 1)),
    scrolled: panelDelta !== 0 || listDelta !== 0,
    clickFired: after.counts.click > 0,
    changeCount: after.counts.change,
    inputCount: after.counts.input,
    valueChanged: computeValueChanged(target.kind, before, mid, after),
  };
}

function fmtDelta(px) {
  return `${px > 0 ? "+" : ""}${px.toFixed(0)}px`;
}

function scrolledCell(r) {
  if (!r.scrolled) return "no";
  return [
    r.panelDelta !== 0 ? `panel ${fmtDelta(r.panelDelta)}` : null,
    r.listDelta !== 0 ? `list ${fmtDelta(r.listDelta)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function beforeAfterCell(r) {
  if (r.target.kind === "button") {
    return `clicks 0 -> ${r.after.counts.click}`;
  }
  const b = formatState(r.target.kind, r.before);
  const a = formatState(r.target.kind, r.after);
  // Surface a transient mid-gesture deviation even when the end state is
  // unchanged — e.g. a slider whose guard restores the value by touchend.
  if (r.mid && !stateEqual(r.target.kind, r.before, r.mid)) {
    return `${b} -> ${formatState(r.target.kind, r.mid)} (mid-gesture) -> ${a}`;
  }
  return `${b} -> ${a}`;
}

function printReport(results) {
  console.log("[panel-touch-scroll] ======== RESULTS ========");
  if (results.length === 0) {
    console.log("[panel-touch-scroll] no trials completed.");
  } else {
    const headers = [
      "target",
      "start",
      "swipe",
      "scrolled?",
      "click",
      "change",
      "input",
      "value changed?",
      "before -> after",
    ];
    const rows = results.map((r) => [
      r.target.name,
      r.xMode,
      `${r.swipeDirection} ${r.swipeDistance}px`,
      scrolledCell(r),
      r.clickFired ? `yes (${r.after.counts.click})` : "no",
      String(r.changeCount),
      String(r.inputCount),
      r.valueChanged ? "YES" : "no",
      beforeAfterCell(r),
    ]);
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((row) => row[i].length)),
    );
    const line = (cells) =>
      cells.map((c, i) => c.padEnd(widths[i])).join("  |  ");
    console.log(line(headers));
    console.log(widths.map((w) => "-".repeat(w)).join("--|--"));
    for (const row of rows) console.log(line(row));
  }

  console.log("[panel-touch-scroll] ======== VERDICT ========");
  for (const target of [...TARGETS, ROW_TARGET]) {
    const trials = results.filter((r) => r.target === target);
    let verdict;
    if (trials.length === 0) {
      verdict = "NO DATA (control missing or harness aborted first)";
    } else {
      const scrolledTrials = trials.filter((r) => r.scrolled);
      if (scrolledTrials.length === 0) {
        verdict = "INCONCLUSIVE (gesture never actually scrolled)";
      } else {
        const hazard = scrolledTrials.some(
          (r) => r.clickFired || r.valueChanged,
        );
        verdict = hazard ? "HAZARD" : "SAFE";
      }
    }
    console.log(
      `[panel-touch-scroll] ${target.kind.padEnd(9)} ${target.name.padEnd(30)} -> ${verdict}`,
    );
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
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

  const results = [];
  const pageErrors = [];
  try {
    // The app never constructs its Ui (main.ts) without a working WebGL
    // context — webglAvailable() fails first and main() returns before
    // `new Ui(document)` runs — so every panel control this script targets
    // requires the SwiftShader recipe above, not just a plain page.
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      hasTouch: true,
      isMobile: true,
      viewport: { width: 393, height: 727 },
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      console.error(`[page:${msg.type()}] ${msg.text()}`);
    });

    console.error(`[panel-touch-scroll] navigating to ${BASE}/`);
    await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const el = document.getElementById("pointCount");
        return !!el && Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
      },
      undefined,
      { timeout: 30_000, polling: 100 },
    );

    // ---- open the panel, then the Appearance section -------------------
    await page.click("#menuToggle");
    await page.waitForFunction(
      () => document.getElementById("panel")?.classList.contains("open"),
      undefined,
      { timeout: 5_000 },
    );
    await page.waitForTimeout(400); // let the 0.32s slide-in transition land.

    const appearanceSummary = "#appearanceSection > summary";
    if ((await page.$(appearanceSummary)) === null) {
      throw new Error("#appearanceSection > summary not found");
    }
    await page.click(appearanceSummary);
    await page.waitForFunction(
      () => document.getElementById("appearanceSection")?.open === true,
      undefined,
      { timeout: 5_000 },
    );
    await page.waitForTimeout(150);

    await page.screenshot({
      type: "jpeg",
      quality: 85,
      path: path.join(OUT_DIR, "panel-touch-scroll-1-appearance.jpg"),
    });

    // ---- the four instrumented Appearance targets, center + left-edge --
    for (const target of TARGETS) {
      if ((await page.$(target.selector)) === null) {
        fail(`${target.name}: control missing (${target.selector})`);
        continue;
      }
      for (const xMode of ["center", "left-edge"]) {
        console.error(
          `[panel-touch-scroll] trial: ${target.name} (${target.kind}) @ ${xMode}`,
        );
        const result = await runTrial(page, cdp, target, xMode);
        if (result) results.push(result);
      }
    }

    await page.screenshot({
      type: "jpeg",
      quality: 85,
      path: path.join(OUT_DIR, "panel-touch-scroll-2-after-appearance.jpg"),
    });

    // ---- the transform-list row (item 6) --------------------------------
    const transformsSummary = "#transformsSection > summary";
    if ((await page.$(transformsSummary)) === null) {
      throw new Error("#transformsSection > summary not found");
    }
    await page.click(transformsSummary);
    await page.waitForFunction(
      () => document.getElementById("transformsSection")?.open === true,
      undefined,
      { timeout: 5_000 },
    );
    await page.waitForTimeout(150);

    await page.screenshot({
      type: "jpeg",
      quality: 85,
      path: path.join(OUT_DIR, "panel-touch-scroll-3-transforms.jpg"),
    });

    if ((await page.$(ROW_TARGET.selector)) === null) {
      fail(`${ROW_TARGET.name}: control missing (${ROW_TARGET.selector})`);
    } else {
      console.error(`[panel-touch-scroll] trial: ${ROW_TARGET.name} @ center`);
      const rowResult = await runTrial(page, cdp, ROW_TARGET, "center");
      if (rowResult) results.push(rowResult);
    }

    await page.screenshot({
      type: "jpeg",
      quality: 85,
      path: path.join(OUT_DIR, "panel-touch-scroll-4-final.jpg"),
    });

    if (pageErrors.length) {
      console.error(
        `[panel-touch-scroll] page errors observed: ${pageErrors.join(" | ")}`,
      );
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
  }

  printReport(results);
  console.error(
    `[panel-touch-scroll] HARNESS: ${harnessErrors.length === 0 ? "OK" : `FAILED (${harnessErrors.join("; ")})`}`,
  );
  process.exitCode = harnessErrors.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("[panel-touch-scroll] fatal:", err);
  process.exitCode = 1;
});
