#!/usr/bin/env node
/**
 * EXACT NUMERIC CONTROL gate: the four questions about the numeric
 * companion paired with every panel slider (`src/app/range-number-control.ts`)
 * that no jsdom test reaches, asked of a REAL production build in a REAL
 * browser at PHONE width.
 *
 * jsdom lays nothing out and dispatches no trusted input, so it can prove
 * the wiring and nothing about the two halves the feature was actually
 * argued on: that a phone can hit the field at all, and that a value the
 * panel SHOWS is the value the document HOLDS.
 *
 * 1. COMPLETENESS, IN THE RUNNING APP. The table-driven half is pinned in
 *    jsdom against SCALAR_CONTROLS, but eleven more sliders are built by
 *    hand at render time (the transform editor's axis/weight/colour/finish/
 *    pattern/variation/fold-length/4D rows, the authored-shape part editor
 *    and the xaos leak dials), and a spec table cannot see those. This walks
 *    the app through the states that MINT them — every visible panel section
 *    in every reachable render mode, every transform-editor group, a
 *    mandelbox variation for the fold-length rows, an emitter shape for the
 *    part editor, a xaos-carrying preset for the leak dials — and after each
 *    one enumerates every `input[type=range]` in the document, visible or
 *    not, requiring each to sit in a `.range-number-pair` holding exactly
 *    one `.range-number-input`, and every pair to be available or
 *    unavailable AS ONE CONTROL — the companion deliberately never observes
 *    `range.disabled` (the touch guard flips it for a frame), so a
 *    half-disabled pair is a caller that reached past `setDisabled` and left
 *    an exact field live on a refused control. The verdict names how many
 *    pairs the walk actually disabled, and fails on none: a walk that never
 *    reaches a refused control proves nothing about the parity.
 *
 * 2. PHONE LAYOUT. For every range actually on screen: the companion is at
 *    least TOUCH_TARGET_PX on both axes (the CSS's own promise below the
 *    640px breakpoint), the pair stays inside the panel's content box, the
 *    panel never scrolls horizontally, the retained slider keeps a usable
 *    track, and — set into the field and measured, not eyeballed — the
 *    WIDEST VALUE THE CONTROL'S OWN DOMAIN PERMITS fits without clipping.
 *
 * 3. TOUCH, at the CDP Input level (`Input.dispatchTouchEvent`) — a
 *    page-constructed TouchEvent is untrusted and never reaches Blink's
 *    touch-to-scroll disambiguation, which is the machinery under test, the
 *    same reason `panel-touch-scroll.verify.mjs` gives. A tap must FOCUS the
 *    companion (it is the only way in on a phone); a vertical swipe that
 *    starts on it must SCROLL the panel and leave the document alone (the
 *    complaint `slider-scroll-guard.ts` exists for, one control over); and a
 *    horizontal drag on the retained slider must still edit, with the
 *    companion following it — sampled THROUGHOUT, because that guard's whole
 *    mechanism is flipping `disabled` on the slider for a frame and a leak
 *    onto the companion would disable the exact-entry field at a touch.
 *    Swipe direction is chosen from the room the scroller actually has, not
 *    hardcoded: a panel already pinned at its maximum scrollTop would report
 *    a SAFE it had not earned.
 *
 * 4. KEYBOARD. Tab reaches the companion from its slider; Arrow steps the
 *    declared increment and moves slider, readout and document together;
 *    Escape restores the last accepted value; and a REFUSED draft leaves
 *    `aria-invalid`, a populated `role="alert"` and a document that did not
 *    move. Then the case this gate was written on:
 *
 *    ARROW AFTER A REFUSAL. Arrow stepping starts from whatever the field
 *    SHOWS and used to commit without re-validating, so a draft the control
 *    had just refused stepped into a value the same control rejects when
 *    typed. MEASURED on the build before the fix: Position X (step 0.01),
 *    draft "0.375" refused for precision, then ArrowUp wrote 0.385 into the
 *    document and displayed 0.39 in the field, the slider AND the readout —
 *    the panel and the document disagreeing about the number, which is the
 *    one thing an exact-value control must not do. Same defect on the
 *    table-driven half (fog, step 0.05: draft "1.234" refused, ArrowUp wrote
 *    1.284 and showed 1.28). The gate reads the committed value out of the
 *    `#v1=` document hash rather than the panel, because the panel is the
 *    half that was lying.
 *
 * MEASURED on a real production build, 393x727 and 320x568, reduced-motion
 * (so the camera parks and the document hash moves only when an edit moves
 * it): 80 states, 86 distinct paired ranges, 0 unpaired. Smallest companion
 * 61x44 px — a mandelbox fold-length row at 320px, the deepest-nested row
 * the panel has — no horizontal overflow anywhere, and no domain-widest
 * value clipped at either width.
 *
 * Usage (build + `npm run preview` first — this measures a real build):
 *   npm run build && npm run preview &
 *   node scripts/panel-numeric-control.verify.mjs
 *
 *   --url        app origin (default https://localhost:4173)
 *   --viewport   WxH (default 393x727; 320x568 is the narrowest phone the
 *                panel is designed against)
 *   --outdir     where PNGs land (default .playwright-mcp/, gitignored)
 *
 * Exit codes: 0 every question answered yes; 1 a verdict failed; 2 a
 * CHECKING-side failure (no browser, the app never booted, a target the
 * harness needs is missing) — rerun, it is not a verdict about the app.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function flag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const BASE = flag("url", "https://localhost:4173").replace(/\/+$/, "");
const OUT_DIR = path.resolve(
  __dirname,
  "..",
  flag("outdir", ".playwright-mcp"),
);
const [VIEW_W, VIEW_H] = flag("viewport", "393x727")
  .split("x")
  .map((n) => Number(n));

/** The companion's minimum touch target on both axes. `style.css` raises
 * `.range-number-input`'s min-height to this below the 640px breakpoint;
 * the gate holds the WIDTH to the same bar, which no rule states and only
 * the deepest-nested rows come close to. */
const TOUCH_TARGET_PX = 44;
/** A retained slider narrower than this has stopped being a coarse gesture:
 * the guard maps the pointer's x across the whole track, so the track is the
 * whole resolution the drag has. Measured minimum across both widths: 61px. */
const MIN_TRACK_PX = 44;
/** Travel of the synthetic swipe, comfortably past the guard's own scroll
 * intent, and the step count that keeps Blink reading it as a drag rather
 * than a fling — `panel-touch-scroll.verify.mjs`'s measured shape. */
const SWIPE_PX = 180;
/** The fog slider's own declared increment (index.html's `#fogSlider`), the
 * one the Arrow leg must move by. */
const FOG_STEP = 0.05;
const SWIPE_STEPS = 10;
const SWIPE_STEP_MS = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
const harnessErrors = [];
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures.push(`${name}: ${detail}`);
}
function harnessFail(label) {
  harnessErrors.push(label);
}

/* ── the app, driven the way a person drives it ─────────────────────────── */

async function boot(page) {
  await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const el = document.getElementById("pointCount");
      return !!el && Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
    },
    undefined,
    { timeout: 60_000, polling: 100 },
  );
  await page.click("#menuToggle");
  await page.waitForFunction(
    () => document.getElementById("panel")?.classList.contains("open"),
    undefined,
    { timeout: 10_000 },
  );
  await sleep(500); // the 0.32s slide-in.
}

/** Open one exclusive accordion section by id, if this render mode shows it. */
async function openSection(page, id) {
  const opened = await page.evaluate((sectionId) => {
    const details = document.getElementById(sectionId);
    if (!details) return false;
    if (getComputedStyle(details).display === "none" || details.hidden) {
      return false;
    }
    if (!details.open) details.querySelector("summary")?.click();
    return true;
  }, id);
  if (opened) await sleep(180);
  return opened;
}

/** Select the first real transform row (index 0 is the camera row). */
async function selectTransform(page) {
  await page.evaluate(() => {
    const rows = document.querySelectorAll("#transformList > .transform-btn");
    (rows[1] ?? rows[0])?.click();
  });
  await sleep(400);
}

/** Bring an element to a fixed height inside the panel's own scroller —
 * `scrollIntoView` animates here and the panel re-renders under it, so the
 * gate writes scrollTop directly and re-reads the rect afterwards. */
async function scrollInPanel(page, handleJs, offset = 280) {
  await page.evaluate(
    ([js, off]) => {
      const el = new Function(`return (${js})`)();
      if (!el) return;
      const panel = document.getElementById("panel");
      panel.scrollTop +=
        el.getBoundingClientRect().top -
        panel.getBoundingClientRect().top -
        off;
    },
    [handleJs, offset],
  );
  await sleep(250);
  await settleScroll(page);
}

/** Wait until the panel's own scroller has stopped moving. Opening a section
 * and writing scrollTop both animate here, and a touch dispatched at a rect
 * measured mid-animation lands somewhere else entirely — which is what made
 * an early version of this gate report an intermittent unfocused tap. */
async function settleScroll(page, tries = 20) {
  let previous = null;
  for (let i = 0; i < tries; i += 1) {
    const now = await page.evaluate(
      () => document.getElementById("panel").scrollTop,
    );
    if (previous !== null && Math.abs(now - previous) < 0.5) return true;
    previous = now;
    await sleep(120);
  }
  return false;
}

/** The centre of an element and what is actually on top of it there, measured
 * only once the scroller has settled and re-measured while the two disagree —
 * a touch is dispatched at a POINT, so a stale rect is a tap on whatever moved
 * into that point instead. */
async function tapTarget(page, id, tries = 5) {
  for (let i = 0; i < tries; i += 1) {
    await settleScroll(page);
    const spot = await page.evaluate((elementId) => {
      const el = document.getElementById(elementId);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const mid = document.elementFromPoint(x, y);
      return {
        x,
        y,
        onTop: mid === el,
        hit: mid ? `${mid.tagName}#${mid.id}` : "none",
      };
    }, id);
    if (spot === null) return null;
    if (spot.onTop) return spot;
    await sleep(200);
  }
  return null;
}

/* ── phase 1 + 2: pairing and phone layout, per visited state ───────────── */

async function auditState(page, label) {
  return page.evaluate((stateLabel) => {
    const panel = document.getElementById("panel");
    const panelRect = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    const contentLeft = panelRect.left + parseFloat(style.paddingLeft || "0");
    const contentRight =
      panelRect.right - parseFloat(style.paddingRight || "0");

    const nameOf = (range) =>
      range.id ||
      range.getAttribute("aria-label") ||
      `${range.closest(".editor-row")?.querySelector(".axis")?.textContent?.trim() ?? "?"} / ${
        range
          .closest("details")
          ?.querySelector("summary")
          ?.textContent?.trim() ?? "?"
      }`;

    const out = {
      label: stateLabel,
      total: 0,
      seen: [],
      unpaired: [],
      visible: 0,
      tooShort: [],
      tooNarrow: [],
      shortTrack: [],
      outside: [],
      clipped: [],
      desynced: [],
      disabledPairs: [],
      overflow: panel.scrollWidth - panel.clientWidth,
      smallest: null,
    };

    for (const range of document.querySelectorAll('input[type="range"]')) {
      out.total += 1;
      const pair = range.closest(".range-number-pair");
      const companions = pair
        ? pair.querySelectorAll(".range-number-input")
        : [];
      if (!pair || companions.length !== 1) {
        out.unpaired.push({
          name: nameOf(range),
          paired: !!pair,
          companions: companions.length,
        });
        continue;
      }
      out.seen.push(nameOf(range));

      // Availability is app-owned and set through `setDisabled`, which moves
      // both halves together — the companion deliberately never observes
      // `range.disabled`, because the touch guard flips it for one frame.
      // A half-disabled pair is therefore a caller that reached past the
      // control: an unreachable slider with a live exact field, or the
      // reverse.
      const number = companions[0];
      if (number.disabled && range.disabled)
        out.disabledPairs.push(nameOf(range));
      if (number.disabled !== range.disabled) {
        out.desynced.push({
          name: nameOf(range),
          range: range.disabled,
          number: number.disabled,
        });
      }

      // On screen means every ancestor <details> is open and a box exists.
      // A closed <details> is a content-visibility-skipped subtree whose
      // descendants Chromium still lays out ON DEMAND for a geometry query,
      // at the collapsed chip's width — measuring those would report a
      // 14px-wide slider that nobody can see.
      let onScreen = range.offsetParent !== null;
      for (
        let details = range.closest("details");
        details && onScreen;
        details = details.parentElement?.closest("details")
      ) {
        if (!details.open) onScreen = false;
      }
      const rangeRect = range.getBoundingClientRect();
      if (!onScreen || rangeRect.width <= 0 || rangeRect.height <= 0) continue;

      const numberRect = number.getBoundingClientRect();
      out.visible += 1;
      const entry = {
        name: nameOf(range),
        numberW: Math.round(numberRect.width),
        numberH: Math.round(numberRect.height),
        trackW: Math.round(rangeRect.width),
      };
      if (
        out.smallest === null ||
        numberRect.width * numberRect.height <
          out.smallest.numberW * out.smallest.numberH
      ) {
        out.smallest = entry;
      }
      if (numberRect.height < 44) out.tooShort.push(entry);
      if (numberRect.width < 44) out.tooNarrow.push(entry);
      if (rangeRect.width < 44) out.shortTrack.push(entry);
      if (
        numberRect.left < contentLeft - 1 ||
        numberRect.right > contentRight + 1 ||
        rangeRect.left < contentLeft - 1 ||
        rangeRect.right > contentRight + 1
      ) {
        out.outside.push(entry);
      }

      // Can the field SHOW the widest value its own domain permits? The
      // decimals it is displaying are its declared precision, so the two
      // bounds formatted at that precision are the longest legal strings.
      const decimals = (number.value.split(".")[1] ?? "").length;
      const keep = number.value;
      for (const bound of [Number(number.min), Number(number.max)]) {
        if (!Number.isFinite(bound)) continue;
        number.value = bound.toFixed(decimals);
        if (number.scrollWidth > number.clientWidth + 1) {
          out.clipped.push({ ...entry, text: number.value });
        }
      }
      number.value = keep;
    }
    return out;
  }, label);
}

/* ── phase 3: touch, at the CDP Input level ─────────────────────────────── */

const touchPoint = (x, y) => [{ x: Math.round(x), y: Math.round(y) }];

async function tap(cdp, x, y) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: touchPoint(x, y),
  });
  await sleep(60);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await sleep(300);
}

async function swipe(cdp, x, y, distance, sign) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: touchPoint(x, y),
  });
  await sleep(SWIPE_STEP_MS);
  for (let i = 1; i <= SWIPE_STEPS; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: touchPoint(x, y + (sign * distance * i) / SWIPE_STEPS),
    });
    await sleep(SWIPE_STEP_MS);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await sleep(400);
}

async function dragTrack(cdp, page, rect) {
  await page.evaluate(() => {
    window.__disabledSamples = [];
    const number = document.getElementById("fogSliderNumber");
    window.__disabledTimer = setInterval(
      () => window.__disabledSamples.push(number.disabled),
      4,
    );
  });
  const startX = rect.left + 10;
  const endX = rect.right - 10;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: touchPoint(startX, rect.y),
  });
  await sleep(30);
  for (let i = 1; i <= SWIPE_STEPS; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: touchPoint(
        startX + ((endX - startX) * i) / SWIPE_STEPS,
        rect.y,
      ),
    });
    await sleep(30);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await sleep(700);
  return page.evaluate(() => {
    clearInterval(window.__disabledTimer);
    const number = document.getElementById("fogSliderNumber");
    const range = document.getElementById("fogSlider");
    return {
      samples: window.__disabledSamples.length,
      everDisabled: window.__disabledSamples.some(Boolean),
      stillDisabled: number.disabled,
      number: number.value,
      range: range.value,
      hash: location.hash,
    };
  });
}

/* ── document state, read where the panel cannot lie about it ───────────── */

/** The scene document as the app persisted it, decoded from `#v1=` — the
 * only reader that survives a panel showing one number and the document
 * holding another, which is the defect class this gate was written on. */
async function decodedDocument(page) {
  return page.evaluate(() => {
    const hash = location.hash;
    if (!hash.startsWith("#v1=")) return null;
    try {
      return JSON.parse(
        atob(hash.slice(4).replace(/-/g, "+").replace(/_/g, "/")),
      );
    } catch {
      return null;
    }
  });
}

async function readControl(page, numberId) {
  return page.evaluate((id) => {
    const number = document.getElementById(id);
    const pair = number.closest(".range-number-pair");
    const range = pair.querySelector('input[type="range"]');
    const error = pair.querySelector(".range-number-error");
    return {
      value: number.value,
      range: range.value,
      invalid: number.getAttribute("aria-invalid"),
      errorText: error.textContent,
      errorHidden: error.hidden,
      errorRole: error.getAttribute("role"),
      hash: location.hash,
    };
  }, numberId);
}

/* ── the run ────────────────────────────────────────────────────────────── */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const env = { ...process.env };
  delete env.DISPLAY; // offscreen SwiftShader, not X11 GLX (see webgl-smoke.mjs).
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false, // + --headless=new below — the combination that yields WebGL.
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
  const audits = [];
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      hasTouch: true,
      isMobile: true,
      // The app boots auto-motion from prefers-reduced-motion when the
      // viewer has never chosen, so this parks the camera and the 4D
      // tumble — which is what lets "did the document move" be a question
      // about the edit rather than about the clock.
      reducedMotion: "reduce",
      viewport: { width: VIEW_W, height: VIEW_H },
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await boot(page);

    // ---- phase 1 + 2: walk the states that mint sliders ------------------
    const sections = await page.evaluate(() =>
      [...document.querySelectorAll("details.panel-section")]
        .map((d) => d.id)
        .filter(Boolean),
    );
    if (sections.length === 0) harnessFail("no panel sections found");

    const walkSections = async (modeLabel) => {
      for (const id of sections) {
        if (await openSection(page, id)) {
          audits.push(await auditState(page, `${modeLabel}/${id}`));
        }
      }
    };
    await walkSections("points");

    // The transform editor: every group, plus the two rows that only exist
    // once something is authored (a mandelbox's fold lengths, an emitter
    // shape's part editor).
    await openSection(page, "transformsSection");
    await selectTransform(page);
    await page.evaluate(() => {
      const add = document.querySelector("#transformEditor .variation-add");
      if (add) {
        add.value = "mandelbox";
        add.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await sleep(400);
    await page.evaluate(() => {
      const add = document.getElementById("addEmitterSelect");
      if (add && [...add.options].some((o) => o.value === "sphere")) {
        add.value = "sphere";
        add.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await sleep(600);
    const groups = await page.evaluate(() =>
      [...document.querySelectorAll("#transformEditor > details")].map(
        (d) => d.querySelector("summary")?.textContent?.trim() ?? "?",
      ),
    );
    if (groups.length === 0) harnessFail("transform editor rendered no groups");
    for (let i = 0; i < groups.length; i += 1) {
      await page.evaluate((index) => {
        const details = [
          ...document.querySelectorAll("#transformEditor > details"),
        ][index];
        if (details && !details.open) details.querySelector("summary")?.click();
      }, i);
      await sleep(300);
      audits.push(await auditState(page, `editor/${groups[i]}`));
    }

    // The xaos leak dials only exist for a system that carries chaos rows.
    const loadedXaos = await page.evaluate(() => {
      const select = document.getElementById("presetSelect");
      const option = [...(select?.options ?? [])].find((o) =>
        /fern|sponge/i.test(o.textContent ?? ""),
      );
      if (!select || !option) return false;
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });
    if (loadedXaos) {
      await sleep(2500);
      if (await openSection(page, "xaosSection")) {
        audits.push(await auditState(page, "points/xaos"));
      }
    }

    // The other render modes show their own sections.
    for (const [id, label] of [
      ["modeFlameBtn", "flame"],
      ["modeSolidBtn", "solid"],
      ["modeSurfaceBtn", "surface"],
    ]) {
      const entered = await page.evaluate((buttonId) => {
        const button = document.getElementById(buttonId);
        if (!button || button.disabled) return false;
        button.click();
        return true;
      }, id);
      if (!entered) {
        results.push({
          name: `mode ${label}`,
          ok: true,
          detail: "not offered by this document — skipped",
        });
        continue;
      }
      await sleep(2000);
      await walkSections(label);
    }
    await page.evaluate(() =>
      document.getElementById("modePointsBtn")?.click(),
    );
    await sleep(1500);

    const unpaired = audits.flatMap((a) =>
      a.unpaired.map((u) => ({ ...u, at: a.label })),
    );
    const distinct = new Set(audits.flatMap((a) => a.seen));
    check(
      "completeness: every runtime slider carries exactly one companion",
      unpaired.length === 0,
      unpaired.length === 0
        ? `${String(distinct.size)} distinct sliders over ${String(audits.length)} states, all paired`
        : `${String(unpaired.length)} unpaired: ${unpaired
            .slice(0, 6)
            .map((u) => `${u.name} @ ${u.at}`)
            .join("; ")}`,
    );

    const desynced = [
      ...new Map(
        audits.flatMap((a) => a.desynced.map((d) => [d.name, d])),
      ).values(),
    ];
    // Counting what the walk actually disabled keeps this from passing
    // vacuously: a walk that never reaches a refused control proves nothing
    // about whether both halves move together.
    const disabledSeen = new Set(audits.flatMap((a) => a.disabledPairs)).size;
    check(
      "completeness: a pair is available or unavailable as one control",
      desynced.length === 0 && disabledSeen > 0,
      desynced.length === 0
        ? `no half-disabled pair, over ${String(disabledSeen)} pair(s) the app actually disabled${disabledSeen === 0 ? " — INCONCLUSIVE, the walk never reached a refused control" : ""}`
        : desynced
            .slice(0, 6)
            .map(
              (d) =>
                `${d.name} slider ${d.range ? "off" : "on"} / field ${d.number ? "off" : "on"}`,
            )
            .join("; "),
    );

    const visible = audits.reduce((sum, a) => sum + a.visible, 0);
    const collect = (key) => [
      ...new Map(
        audits.flatMap((a) => a[key].map((e) => [e.name + (e.text ?? ""), e])),
      ).values(),
    ];
    const short = collect("tooShort");
    const narrow = collect("tooNarrow");
    const track = collect("shortTrack");
    const outside = collect("outside");
    const clipped = collect("clipped");
    const smallest = audits
      .map((a) => a.smallest)
      .filter(Boolean)
      .reduce(
        (a, b) => (b.numberW * b.numberH < a.numberW * a.numberH ? b : a),
        { numberW: Infinity, numberH: Infinity, name: "none" },
      );
    const overflow = Math.max(...audits.map((a) => a.overflow));

    check(
      `layout: every companion is at least ${String(TOUCH_TARGET_PX)}px on both axes`,
      short.length === 0 && narrow.length === 0,
      short.length + narrow.length === 0
        ? `${String(visible)} on-screen rows, smallest ${String(smallest.numberW)}x${String(smallest.numberH)}px (${smallest.name})`
        : [...short, ...narrow]
            .slice(0, 6)
            .map((e) => `${e.name} ${String(e.numberW)}x${String(e.numberH)}`)
            .join("; "),
    );
    check(
      `layout: every retained slider keeps a ${String(MIN_TRACK_PX)}px track`,
      track.length === 0,
      track.length === 0
        ? "no slider squeezed out by its companion"
        : track
            .slice(0, 6)
            .map((e) => `${e.name} ${String(e.trackW)}px`)
            .join("; "),
    );
    check(
      "layout: nothing escapes the panel, and the panel never scrolls sideways",
      outside.length === 0 && overflow <= 1,
      outside.length === 0 && overflow <= 1
        ? `horizontal overflow ${String(overflow)}px`
        : `${String(outside.length)} rows outside the content box, overflow ${String(overflow)}px`,
    );
    check(
      "layout: the widest value each domain permits fits its field",
      clipped.length === 0,
      clipped.length === 0
        ? "no bound clipped at either end of any domain"
        : clipped
            .slice(0, 6)
            .map((e) => `${e.name} "${e.text}" in ${String(e.numberW)}px`)
            .join("; "),
    );

    // ---- phase 3: touch --------------------------------------------------
    if (!(await openSection(page, "atmosphereSection"))) {
      harnessFail("Atmosphere section is not reachable in Points mode");
    }
    await scrollInPanel(page, 'document.getElementById("fogSlider")');

    const numberRect = await tapTarget(page, "fogSliderNumber");
    if (numberRect === null) {
      harnessFail("the fog companion never settled as the topmost element");
      throw new Error("fog companion unreachable");
    }
    await page.evaluate(() => document.activeElement?.blur());
    await tap(cdp, numberRect.x, numberRect.y);
    const focused = await page.evaluate(() => document.activeElement?.id ?? "");
    check(
      "touch: a tap focuses the companion",
      focused === "fogSliderNumber",
      `activeElement after tap: ${focused || "(none)"} — tapped (${String(Math.round(numberRect.x))}, ${String(Math.round(numberRect.y))}), topmost there ${numberRect.hit}`,
    );

    await page.evaluate(() => document.activeElement?.blur());
    await sleep(150);
    await settleScroll(page);
    const room = await page.evaluate(() => {
      const panel = document.getElementById("panel");
      const el = document.getElementById("fogSliderNumber");
      const r = el.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        up: panel.scrollHeight - panel.clientHeight - panel.scrollTop,
        down: panel.scrollTop,
        scroll: panel.scrollTop,
        value: el.value,
        hash: location.hash,
      };
    });
    // "up" is the finger travelling toward the top of the screen, which
    // raises scrollTop; swipe whichever way the scroller can still move.
    const sign = room.up >= room.down ? -1 : 1;
    const distance = Math.min(SWIPE_PX, Math.max(room.up, room.down));
    if (distance < 40) {
      harnessFail("the panel has no room to scroll in either direction");
    }
    await swipe(cdp, room.x, room.y, Math.max(distance, 1), sign);
    const afterSwipe = await page.evaluate(() => ({
      scroll: document.getElementById("panel").scrollTop,
      value: document.getElementById("fogSliderNumber").value,
      hash: location.hash,
    }));
    const scrolled = afterSwipe.scroll - room.scroll;
    check(
      "touch: a swipe that starts on the companion scrolls, and edits nothing",
      Math.abs(scrolled) > 8 &&
        afterSwipe.value === room.value &&
        afterSwipe.hash === room.hash,
      `scrolled ${String(Math.round(scrolled))}px, value ${room.value} -> ${afterSwipe.value}, document ${afterSwipe.hash === room.hash ? "unchanged" : "MOVED"}`,
    );

    await scrollInPanel(page, 'document.getElementById("fogSlider")');
    await settleScroll(page);
    const trackRect = await page.evaluate(() => {
      const r = document.getElementById("fogSlider").getBoundingClientRect();
      return { left: r.left, right: r.right, y: r.top + r.height / 2 };
    });
    const before = await page.evaluate(() => ({
      number: document.getElementById("fogSliderNumber").value,
      hash: location.hash,
    }));
    const drag = await dragTrack(cdp, page, trackRect);
    check(
      "touch: a drag on the retained slider still edits, and the companion follows",
      drag.number !== before.number &&
        Number(drag.number) === Number(drag.range) &&
        drag.hash !== before.hash,
      `${before.number} -> ${drag.number} (slider ${drag.range}), document ${drag.hash !== before.hash ? "moved" : "UNCHANGED"}`,
    );
    check(
      "touch: the slider guard's disabled flip never reaches the companion",
      !drag.everDisabled && !drag.stillDisabled && drag.samples > 20,
      `${String(drag.samples)} samples during the drag, ever disabled: ${String(drag.everDisabled)}`,
    );

    // ---- phase 4: keyboard ----------------------------------------------
    await page.evaluate(() => document.getElementById("fogSlider").focus());
    await page.keyboard.press("Tab");
    const tabbed = await page.evaluate(() => document.activeElement?.id ?? "");
    check(
      "keyboard: Tab reaches the companion from its slider",
      tabbed === "fogSliderNumber",
      `activeElement after Tab: ${tabbed || "(none)"}`,
    );

    const beforeArrow = await readControl(page, "fogSliderNumber");
    await page.keyboard.press("ArrowUp");
    await sleep(700);
    const afterArrow = await readControl(page, "fogSliderNumber");
    // The retained slider's `value` is the browser's own normalization of
    // what was assigned ("2.4" for a field showing "2.40"), so the two are
    // compared as NUMBERS — a string compare would fail on the formatting
    // alone and say nothing about whether they agree.
    const stepped = Number(afterArrow.value) - Number(beforeArrow.value);
    check(
      "keyboard: Arrow steps the declared increment and moves the document with it",
      Math.abs(stepped - FOG_STEP) < 1e-9 &&
        Number(afterArrow.range) === Number(afterArrow.value) &&
        afterArrow.hash !== beforeArrow.hash,
      `${beforeArrow.value} -> ${afterArrow.value} (+${String(stepped.toFixed(3))}, slider ${afterArrow.range}), document ${afterArrow.hash !== beforeArrow.hash ? "moved" : "UNCHANGED"}`,
    );

    await page.evaluate(() => {
      const number = document.getElementById("fogSliderNumber");
      number.focus();
      number.select();
    });
    await page.keyboard.type("9");
    await page.keyboard.press("Enter");
    await sleep(500);
    const refused = await readControl(page, "fogSliderNumber");
    check(
      "keyboard: an out-of-range draft is refused, announced, and never committed",
      refused.invalid === "true" &&
        refused.errorText.trim().length > 0 &&
        refused.errorHidden === false &&
        refused.errorRole === "alert" &&
        refused.hash === afterArrow.hash,
      `aria-invalid=${String(refused.invalid)}, alert "${refused.errorText}", document ${refused.hash === afterArrow.hash ? "unchanged" : "MOVED"}`,
    );

    await page.keyboard.press("Escape");
    await sleep(200);
    const restored = await readControl(page, "fogSliderNumber");
    check(
      "keyboard: Escape restores the last accepted value",
      restored.value === afterArrow.value && restored.invalid === null,
      `${refused.value} -> ${restored.value}`,
    );

    // The case this gate was written on: Arrow after a REFUSED draft must
    // commit a value the same control would accept typed, and the document
    // must hold exactly the number the panel is showing.
    for (const leg of [
      {
        label: "table-driven (fog, step 0.05)",
        numberId: "fogSliderNumber",
        draft: "1.234",
        read: (doc) => doc?.fogDensity,
      },
      {
        label: "dynamic editor row (Position X, step 0.01)",
        numberId: null,
        draft: "0.375",
        read: (doc) => doc?.transforms?.[0]?.position?.[0],
      },
    ]) {
      let numberId = leg.numberId;
      if (numberId === null) {
        if (!(await openSection(page, "transformsSection"))) {
          harnessFail("Transforms section is not reachable");
          break;
        }
        await selectTransform(page);
        await page.evaluate(() => {
          const details = [
            ...document.querySelectorAll("#transformEditor > details"),
          ].find(
            (d) =>
              d.querySelector("summary")?.textContent?.trim() === "Position",
          );
          if (details && !details.open)
            details.querySelector("summary")?.click();
        });
        await sleep(350);
        numberId = await page.evaluate(() => {
          const number = [
            ...document.querySelectorAll(
              "#transformEditor .range-number-input",
            ),
          ].find(
            (n) => n.getAttribute("aria-label") === "Position X exact value",
          );
          return number?.id ?? "";
        });
        if (!numberId) {
          harnessFail("the Position X companion is missing from the editor");
          break;
        }
        await scrollInPanel(page, `document.getElementById("${numberId}")`);
      }

      await page.evaluate((id) => {
        const number = document.getElementById(id);
        number.focus();
        number.select();
      }, numberId);
      await page.keyboard.type(leg.draft);
      await page.keyboard.press("Enter");
      await sleep(400);
      const drafted = await readControl(page, numberId);
      await page.keyboard.press("ArrowUp");
      await sleep(900);
      const stepped = await readControl(page, numberId);
      const doc = await decodedDocument(page);
      const committed = leg.read(doc);
      const shown = Number(stepped.value);
      check(
        `keyboard: Arrow after a refused draft commits what it shows — ${leg.label}`,
        drafted.invalid === "true" &&
          stepped.invalid === null &&
          committed !== undefined &&
          Math.abs(Number(committed) - shown) < 1e-9,
        `draft "${leg.draft}" ${drafted.invalid === "true" ? "refused" : "ACCEPTED"}, ArrowUp shows ${stepped.value}, document holds ${String(committed)}`,
      );
    }

    await page.screenshot({
      path: path.join(
        OUT_DIR,
        `panel-numeric-${String(VIEW_W)}x${String(VIEW_H)}.png`,
      ),
    });
  } catch (error) {
    harnessFail(
      `run aborted: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await browser.close();
  }

  check(
    "no uncaught page errors during the run",
    pageErrors.length === 0,
    pageErrors.length === 0 ? "clean" : pageErrors.slice(0, 3).join(" | "),
  );

  console.log("[panel-numeric-control] ======== RESULTS ========");
  console.log(
    `[panel-numeric-control] viewport ${String(VIEW_W)}x${String(VIEW_H)}, ${String(audits.length)} states visited`,
  );
  for (const r of results) {
    console.log(
      `[panel-numeric-control] ${r.ok ? "PASS" : "FAIL"}  ${r.name}\n                          ${r.detail}`,
    );
  }

  if (harnessErrors.length > 0) {
    console.error(
      `[panel-numeric-control] CHECKING-SIDE FAILURE: ${harnessErrors.join(" | ")}`,
    );
    process.exit(2);
  }
  if (failures.length > 0) {
    console.error(
      `[panel-numeric-control] ${String(failures.length)} verdict(s) failed`,
    );
    process.exit(1);
  }
  console.log("[panel-numeric-control] all verdicts passed");
  process.exit(0);
}

await main();
