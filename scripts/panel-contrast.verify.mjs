#!/usr/bin/env node
/**
 * PANEL CONTRAST gate: the WCAG-AA readability half of the panel-cleanup
 * epic, asked of a REAL production build in BOTH Chromium and Firefox at
 * PHONE width.
 *
 * WHAT IT ASSERTS. Every visible text node inside `#panel` (the mode switch,
 * the status notes, every accordion section, and the transform editor's
 * dynamically built rows — Finish/Pattern/Variation/Shape groups) must meet
 * WCAG AA contrast against its EFFECTIVE background: 4.5:1 normally, 3.0:1
 * for large text (fontSize >= 24px, or >= 18.66px at fontWeight >= 700).
 * Every visible `select` must resolve a `color-scheme` containing `dark`
 * (`style.css` declares `color-scheme: dark` on `:root` so the NATIVE
 * dropdown popups render dark), and every `option`/`optgroup` inside a
 * visible select must meet AA against the background its popup will
 * actually paint.
 *
 * WHY COMPUTED STYLES AND NOT SCREENSHOTS. A native select's open popup is
 * OS/browser chrome: no headless browser will screenshot it, and the two
 * engines disagree about how much of the popup they own. So the gate asserts
 * the contract at the level browsers DO expose — the `color-scheme` the
 * page asks for and the option/optgroup computed colour pairs that style
 * the popup's rows — and leaves the open popups themselves as a ONE-TIME
 * MANUAL SPOT CHECK for the owner (open a dropdown in each engine by hand
 * once, after any theming change).
 *
 * DISABLED TEXT IS DELIBERATELY INCLUDED at the same AA thresholds, even
 * though WCAG exempts inactive controls: a panel that greys a disabled row
 * into illegibility is exactly the unreadable panel this gate exists to
 * catch, and the app discloses dormant controls with a reason beside them
 * rather than by washing them out. The verdict names how many disabled
 * samples the walk actually hit, so the claim is exercised, not vacuous.
 *
 * THE EFFECTIVE-BACKGROUND RULE. A computed `background-color` is often
 * translucent (`--surface` is `rgb(20 22 33 / 82%)`), so the gate walks
 * from the text element up through its ancestors to `document.documentElement`,
 * compositing child-over-parent in sRGB byte space (the app authors sRGB):
 * per channel `out = bg*a + parent*(1-a)`, with the standard alpha
 * accumulation `aOut = a + parentA*(1-a)`. A fully opaque layer ends the
 * walk. If the root is reached with alpha remaining, the remainder is
 * composited over the page's root background (read from computed style;
 * if THAT is transparent too, `#000` is used and disclosed in the state
 * summary). Never an `elementFromPoint` trick: the ancestor chain is the
 * background the element actually paints over in this app.
 *
 * BOTH ENGINES ARE REQUIRED BY THE OWNER: Chromium and Firefox resolve
 * option colours and `color-scheme` differently, and the panel ships on
 * both. `--engine=both` (default) runs each in its own browser; a launch
 * or boot failure on one engine is a CHECKING-side failure (exit 2) for
 * the whole run, never a verdict about the app.
 *
 * Usage (build + `npm run preview` first — this measures a real build):
 *   npm run build && npm run preview &
 *   node scripts/panel-contrast.verify.mjs
 *
 *   --url      app origin (default https://localhost:4173)
 *   --viewport WxH (default 393x727, the phone width the panel is
 *              designed against)
 *   --engine   both (default) | chromium | firefox
 *   --headed   run Firefox on the ambient display instead of headless.
 *              Chromium ignores it (always headless, SwiftShader). CI uses
 *              `xvfb-run -a` + LIBGL_ALWAYS_SOFTWARE=1, because a
 *              display-less GPU-less host leaves Firefox without WebGL and
 *              the app refuses to boot.
 *   --outdir   where PNGs land (default .playwright-mcp/, gitignored)
 *
 * Exit codes: 0 every verdict passed; 1 a verdict failed (real contrast
 * failures are REPORTED, never papered over); 2 a CHECKING-side failure
 * (no browser, the app never booted, a vacuous audit) — rerun, it is not
 * a verdict about the app.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright-core";
import { guardFreshDist } from "./lib/dist-freshness.mjs";

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
const ENGINE = flag("engine", "both");
if (!["both", "chromium", "firefox"].includes(ENGINE)) {
  console.error(`[panel-contrast] unknown --engine=${ENGINE}`);
  process.exit(2);
}
/** Run Firefox HEADED on the ambient display (CI: Xvfb + llvmpipe). See
 * `launchEngine` for why a display-less GPU-less host cannot run the
 * Firefox leg. Chromium ignores this flag — it is always headless. */
const HEADED = flag("headed", "false") === "true";

const MODES = [
  ["modePointsBtn", "points"],
  ["modeFlameBtn", "flame"],
  ["modeSolidBtn", "solid"],
  ["modeSurfaceBtn", "surface"],
];
/** Run-wide floor: fewer than this many text samples across the whole walk
 * means the audit is reading almost nothing and cannot be believed. */
const MIN_TOTAL_SAMPLES = 100;
/** A state prints at most this many failures, then says how many it hid. */
const PRINT_CAP = 10;

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

/* ── the audit, run inside the page ─────────────────────────────────────── */

const AUDIT_SOURCE = (stateLabel) => {
  /* The failure-list cap lives INSIDE the page context: this function is
   * stringified and evaluated there, where Node constants do not exist. */
  const PRINT_CAP = 10;

  /* Color parsing. Computed styles arrive as `rgb(...)`, `rgba(...)`,
   * `color(srgb r g b / a)` or `#rrggbb` depending on engine and
   * serialization; the app authors every colour in sRGB, so all four parse
   * to sRGB bytes + alpha here. */
  function parseColor(text) {
    if (!text) return null;
    const t = text.trim();
    if (t === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    let m = t.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      return {
        r: (n >> 16) & 255,
        g: (n >> 8) & 255,
        b: n & 255,
        a: 1,
      };
    }
    m = t.match(/^rgba?\(([^)]*)\)$/i);
    if (m) {
      const parts = m[1].split(/[\s,/]+/).filter(Boolean);
      if (parts.length < 3) return null;
      return {
        r: byteUnit(parts[0]),
        g: byteUnit(parts[1]),
        b: byteUnit(parts[2]),
        a: parts[3] !== undefined ? alphaUnit(parts[3]) : 1,
      };
    }
    m = t.match(/^color\(\s*srgb\s+([^)]*)\)$/i);
    if (m) {
      const parts = m[1].split(/[\s,/]+/).filter(Boolean);
      if (parts.length < 3) return null;
      return {
        // `color(srgb ...)` channels are 0-1 (or percentages); the compositing
        // below works in sRGB bytes, so normalise into bytes here.
        r: fracUnit(parts[0]) * 255,
        g: fracUnit(parts[1]) * 255,
        b: fracUnit(parts[2]) * 255,
        a: parts[3] !== undefined ? alphaUnit(parts[3]) : 1,
      };
    }
    return null;
  }
  /* A channel already in sRGB bytes ("233"). */
  function byteUnit(part) {
    const v = Number(part);
    return Number.isFinite(v) ? Math.min(255, Math.max(0, v)) : 0;
  }
  /* A channel given as a 0-1 fraction or a percentage ("0.8", "82%"). */
  function fracUnit(part) {
    const v = part.endsWith("%")
      ? Number(part.slice(0, -1)) / 100
      : Number(part);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  }
  function alphaUnit(part) {
    const v = part.endsWith("%")
      ? Number(part.slice(0, -1)) / 100
      : Number(part);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  }
  function hex({ r, g, b }) {
    const c = (v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase();
    return `#${c(r)}${c(g)}${c(b)}`;
  }

  /* WCAG relative luminance from linearised sRGB — the standard piecewise
   * formula, not an approximation. */
  function linear(channel) {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function luminance({ r, g, b }) {
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  }
  function ratio(fg, bg) {
    const l1 = luminance(fg);
    const l2 = luminance(bg);
    const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  }

  /* Child-over-parent compositing in sRGB byte space: `out = bg*a +
   * parent*(1-a)` per channel, `aOut = a + parentA*(1-a)`. */
  function composite(child, parent) {
    return {
      r: child.r * child.a + parent.r * (1 - child.a),
      g: child.g * child.a + parent.g * (1 - child.a),
      b: child.b * child.a + parent.b * (1 - child.a),
      a: child.a + parent.a * (1 - child.a),
    };
  }

  /** Effective background under `el`: walk the ancestor chain to and
   * including the root element, compositing each opaque-or-not
   * background-color child-over-parent. First fully opaque layer ends the
   * walk. Returns { color, fellThrough, pageTransparent, usedPageFallback }
   * — the remainder over the page's own root background when no layer
   * fully covers, with `usedPageFallback` true only when that fallback
   * actually ran (opaque `body` normally ends the walk well before it). */
  function effectiveBackground(el) {
    let acc = null;
    let node = el;
    while (node) {
      const raw = getComputedStyle(node).backgroundColor;
      const parsed = parseColor(raw);
      if (parsed) {
        acc = acc === null ? parsed : composite(acc, parsed);
        if (acc.a >= 1 - 1e-6) {
          return { color: acc, fellThrough: false, pageTransparent: false };
        }
      }
      if (node === document.documentElement) break;
      node = node.parentElement;
    }
    // Remainder over the page's root background.
    const pageRaw = getComputedStyle(document.documentElement).backgroundColor;
    const page = parseColor(pageRaw);
    const pageTransparent = !page || page.a <= 1e-6;
    const over = pageTransparent ? { r: 0, g: 0, b: 0, a: 1 } : page;
    const color = acc === null ? over : composite(acc, over);
    return {
      color,
      fellThrough: true,
      pageTransparent,
      // "The #000 fallback was actually used" — not merely that the root
      // is transparent (it usually is; opaque `body` ends the walk first).
      usedPageFallback: pageTransparent,
    };
  }

  /** Is this element rendered at all? A client rect, visible computed
   * visibility, and no ancestor hidden by display/visibility/opacity. */
  function isRendered(el) {
    if (el.getClientRects().length === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden") return false;
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden") return false;
      const op = Number(s.opacity);
      if (Number.isFinite(op) && op <= 0.001) return false;
    }
    return true;
  }

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE"]);

  function pathOf(el) {
    const bits = [el.tagName.toLowerCase()];
    if (el.id) bits.push(`#${el.id}`);
    const cls = (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    for (const c of cls) bits.push(`.${c}`);
    return bits.join("");
  }

  function isDisabledText(el) {
    return !!el.closest('[disabled], [aria-disabled="true"]');
  }

  function threshold(el) {
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize) || 0;
    const weight = Number(cs.fontWeight) || 400;
    if (size >= 24) return 3.0;
    if (size >= 18.66 && weight >= 700) return 3.0;
    return 4.5;
  }

  const panel = document.getElementById("panel");
  const pageBg = getComputedStyle(document.documentElement).backgroundColor;
  const out = {
    label: stateLabel,
    samples: 0,
    disabledSamples: 0,
    worst: null,
    failures: [],
    suppressed: 0,
    visibleSelects: 0,
    selectSchemeFailures: 0,
    optionSamples: 0,
    optionFailures: [],
    optionsSuppressed: 0,
    pageBgRaw: pageBg,
    pageBgTransparent: !parseColor(pageBg) || parseColor(pageBg)?.a <= 1e-6,
    pageFallbackReads: 0,
  };

  if (!panel) {
    out.failures.push({ text: "no #panel found", path: "document" });
    return out;
  }

  /* ── text nodes ──────────────────────────────────────────────────────── */
  const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent || !/\S/.test(node.textContent)) {
        return NodeFilter.FILTER_REJECT;
      }
      let n = node.parentElement;
      while (n) {
        if (
          SKIP_TAGS.has(n.tagName) ||
          n.classList?.contains("visually-hidden")
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        n = n.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const el = textNode.parentElement;
    if (!el || !isRendered(el)) continue;
    const text = textNode.textContent.replace(/\s+/g, " ").trim();
    // Every text NODE is sampled: identical strings in different rows can
    // paint over different backgrounds, so de-duplicating by text would let
    // a failing duplicate hide behind a passing one.
    if (!text) continue;
    out.samples += 1;
    const disabled = isDisabledText(el);
    if (disabled) out.disabledSamples += 1;

    const cs = getComputedStyle(el);
    const fg = parseColor(cs.color);
    const bg = effectiveBackground(el);
    if (bg.usedPageFallback) out.pageFallbackReads += 1;
    if (!fg) continue;
    const need = threshold(el);
    const got = ratio(fg, bg.color);
    if (out.worst === null || got < out.worst.ratio) {
      out.worst = { ratio: got, text, disabled };
    }
    if (got < need) {
      const entry = {
        path: pathOf(el),
        text: text.slice(0, 60),
        ratio: Math.round(got * 100) / 100,
        need,
        fg: hex(fg),
        bg: hex(bg.color),
        disabled,
      };
      if (out.failures.length < PRINT_CAP) out.failures.push(entry);
      else out.suppressed += 1;
    }
  }

  /* ── selects: color-scheme + option/optgroup popup rows ──────────────── */
  for (const select of panel.querySelectorAll("select")) {
    if (!isRendered(select)) continue;
    out.visibleSelects += 1;
    const scheme = getComputedStyle(select).colorScheme;
    if (!/dark/i.test(scheme)) {
      out.selectSchemeFailures += 1;
      out.failures.push({
        path: `select#${select.id || "(unnamed)"}`,
        text: `color-scheme "${scheme}" has no dark`,
        ratio: null,
        need: null,
        fg: "-",
        bg: "-",
        disabled: false,
      });
    }
    const selectBg = effectiveBackground(select);
    if (selectBg.usedPageFallback) out.pageFallbackReads += 1;
    for (const row of select.querySelectorAll("option, optgroup")) {
      const rowText = (row.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!rowText) continue;
      const rowCs = getComputedStyle(row);
      const rowFg = parseColor(rowCs.color);
      if (!rowFg) continue;
      const rowBgRaw = parseColor(rowCs.backgroundColor);
      // Chrome computes options transparent; the popup paints the
      // select's background, so a fully transparent row background falls
      // back to the parent select's effective background.
      const bgInfo =
        rowBgRaw && rowBgRaw.a > 1e-6 ? effectiveBackground(row) : selectBg;
      if (bgInfo.usedPageFallback) out.pageFallbackReads += 1;
      out.optionSamples += 1;
      const need = threshold(row);
      const got = ratio(rowFg, bgInfo.color);
      if (got < need) {
        const entry = {
          path: `select#${select.id || "(unnamed)"} > ${row.tagName.toLowerCase()}`,
          text: rowText.slice(0, 60),
          ratio: Math.round(got * 100) / 100,
          need,
          fg: hex(rowFg),
          bg: hex(bgInfo.color),
          disabled: isDisabledText(row),
        };
        if (out.optionFailures.length < PRINT_CAP) {
          out.optionFailures.push(entry);
        } else {
          out.optionsSuppressed += 1;
        }
      }
    }
  }

  return out;
};

/** The audit runs in the page as an EXPRESSION: Playwright evaluates the
 * string directly and returns its value, so the audit is invoked as an IIFE
 * with the state label embedded in the source — an evaluate string that
 * evaluates to a bare function would return that unserializable function
 * object (undefined on the host side) instead of the audit. */
const auditSource = (label) =>
  `(${AUDIT_SOURCE.toString()})(${JSON.stringify(label)})`;

/* ── the walk ───────────────────────────────────────────────────────────── */

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
  if (opened) await sleep(200);
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

/** Wait for a mode button to own `aria-pressed="true"`. */
async function enterMode(page, buttonId, label) {
  const ok = await page.evaluate((id) => {
    const button = document.getElementById(id);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, buttonId);
  if (!ok) {
    results.push({
      name: `mode ${label}`,
      ok: true,
      detail: "not offered by this document — skipped",
    });
    return false;
  }
  await page.waitForFunction(
    (id) =>
      document.getElementById(id)?.getAttribute("aria-pressed") === "true",
    buttonId,
    { timeout: 15_000 },
  );
  await sleep(1200); // let the session's first frame land
  return true;
}

async function loadPreset(page, value) {
  const loaded = await page.evaluate((preset) => {
    const select = document.getElementById("presetSelect");
    if (!select) return false;
    if (![...select.options].some((o) => o.value === preset)) return false;
    select.value = preset;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, value);
  if (!loaded) {
    harnessFail(`#presetSelect has no "${value}" option`);
    return false;
  }
  // The point count refreshes as the new system generates.
  await page.waitForFunction(
    () => {
      const el = document.getElementById("pointCount");
      return !!el && Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
    },
    undefined,
    { timeout: 15_000, polling: 100 },
  );
  await sleep(600);
  return true;
}

async function launchEngine(name) {
  // Chromium always runs headless: its bundled SwiftShader supplies WebGL
  // with no display. Firefox has no such bundle on Linux, so a display-less
  // runner without a GPU fails `webglAvailable()` and the app refuses to
  // boot — which is why CI runs Firefox --headed under Xvfb with
  // LIBGL_ALWAYS_SOFTWARE=1 (llvmpipe). That path is opt-in through
  // `--headed`; the default keeps every launch display-less.
  const env = { ...process.env };
  if (name === "chromium") {
    delete env.DISPLAY;
    return chromium.launch({
      executablePath: chromium.executablePath(),
      headless: true,
      env,
      args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
    });
  }
  if (!HEADED) delete env.DISPLAY;
  return firefox.launch({
    executablePath: firefox.executablePath(),
    headless: !HEADED,
    env,
    firefoxUserPrefs: {
      "gfx.webrender.software": true,
      // A software-GL host still has to be ALLOWED to run WebGL: without
      // this, Firefox's blocklist can leave `--headed` Xvfb runs without a
      // context exactly like the headless case.
      "webgl.force-enabled": true,
    },
  });
}

/** Walk one booted page: every applicable panel section in every render
 * mode, for one dimension, plus the transform editor's generated rows. */
async function walkPage(page, engine, dimension) {
  const audits = [];
  const entered = new Set();
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll("details.panel-section")]
      .map((d) => d.id)
      .filter(Boolean),
  );
  if (sections.length === 0) {
    harnessFail(`no panel sections found (${engine}/${dimension})`);
  }

  for (const [buttonId, label] of MODES) {
    if (!(await enterMode(page, buttonId, label))) continue;
    entered.add(label);
    for (const id of sections) {
      if (await openSection(page, id)) {
        audits.push(
          await page.evaluate(
            auditSource(`${engine}/${dimension}/${label}/${id}`),
          ),
        );
      }
    }
  }

  // The transform editor's generated rows (Finish/Pattern/Variation/Shape
  // groups) exist only once a transform is selected — the dynamically built
  // rows this gate exists to cover.
  await enterMode(page, "modePointsBtn", "points");
  if (await openSection(page, "transformsSection")) {
    await selectTransform(page);
    const groups = await page.evaluate(() =>
      [
        ...document.querySelectorAll("#transformEditor > details.editor-group"),
      ].map((d) => d.querySelector("summary")?.textContent?.trim() ?? "?"),
    );
    if (groups.length === 0) {
      harnessFail(
        `transform editor rendered no groups (${engine}/${dimension})`,
      );
    }
    for (let i = 0; i < groups.length; i += 1) {
      await page.evaluate((index) => {
        const details = [
          ...document.querySelectorAll(
            "#transformEditor > details.editor-group",
          ),
        ][index];
        if (details && !details.open) details.querySelector("summary")?.click();
      }, i);
      await sleep(300);
      audits.push(
        await page.evaluate(
          auditSource(`${engine}/${dimension}/editor/${groups[i]}`),
        ),
      );
    }
  } else {
    harnessFail(`Transforms section not reachable (${engine}/${dimension})`);
  }
  return { audits, entered };
}

/* ── the run ────────────────────────────────────────────────────────────── */

async function runEngine(name) {
  await guardFreshDist({ url: BASE });
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await launchEngine(name);

  const pageErrors = [];
  const consoleNoise = [];
  const audits = [];
  const entered = new Set();
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: VIEW_W, height: VIEW_H },
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => pageErrors.push(err.message));
    // Console errors are COLLECTED (they go into the page-error check's
    // detail) but never fail a verdict: a self-signed preview origin's
    // service-worker registration error is environmental noise here, and
    // the numeric gate's check counts `pageerror` only.
    page.on("console", (m) => {
      if (m.type() === "error") {
        consoleNoise.push(`[console] ${m.text()}`);
      }
    });

    // Flat dimension: boot once, walk every mode + the transform editor.
    await boot(page);
    check(`boot: the app booted in ${name}`, true, "pointCount > 0");
    const flatWalk = await walkPage(page, name, "flat");
    audits.push(...flatWalk.audits);
    for (const label of flatWalk.entered) entered.add(label);

    // 4D dimension: fresh page, boot, load the pentatope preset, walk again.
    const page4 = await context.newPage();
    page4.on("pageerror", (err) => pageErrors.push(err.message));
    await boot(page4);
    if (await loadPreset(page4, "pentatope")) {
      const fourWalk = await walkPage(page4, name, "4D");
      audits.push(...fourWalk.audits);
      for (const label of fourWalk.entered) entered.add(label);
    }

    await page
      .screenshot({
        path: path.join(OUT_DIR, `panel-contrast-${name}.png`),
      })
      .catch(() => {});
  } catch (error) {
    harnessFail(
      `${name}: run aborted: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await browser.close();
  }

  if (audits.length === 0) {
    harnessFail(`${name}: the walk produced no audits`);
  }

  /* Vacuousness is a CHECKING matter, not a verdict: an audit that never
   * saw a select or a disabled row proves nothing about what it claims. */
  const totalSamples = audits.reduce((s, a) => s + a.samples, 0);
  const totalOptionSamples = audits.reduce((s, a) => s + a.optionSamples, 0);
  const distinctSelects = new Set(
    audits.filter((a) => a.visibleSelects > 0).map((a) => a.label),
  );
  if (distinctSelects.size === 0) {
    harnessFail(`${name}: the walk never saw a visible <select>`);
  }
  const disabledSamples = audits.reduce((s, a) => s + a.disabledSamples, 0);
  if (disabledSamples === 0) {
    harnessFail(`${name}: the walk never sampled DISABLED text`);
  }

  const textFails = audits.flatMap((a) => a.failures);
  const optionFails = audits.flatMap((a) => a.optionFailures);
  const schemeFails = audits.reduce((s, a) => s + a.selectSchemeFailures, 0);
  const worst = audits
    .map((a) => a.worst)
    .filter(Boolean)
    .reduce((a, b) => (a === null || b.ratio < a.ratio ? b : a), null);
  const stateCount = audits.length;

  check(
    `no text below WCAG AA (${name})`,
    textFails.length === 0 && totalSamples >= MIN_TOTAL_SAMPLES,
    `${String(totalSamples)} samples over ${String(stateCount)} states${
      worst
        ? `, worst ratio ${worst.ratio.toFixed(2)} (${worst.disabled ? "disabled" : "enabled"} "${worst.text}")`
        : ""
    }${
      textFails.length === 0
        ? ""
        : ` — ${String(textFails.length)} failure(s), first: ${describe(textFails[0])}`
    }${totalSamples < MIN_TOTAL_SAMPLES ? ` — implausibly low sample count (< ${String(MIN_TOTAL_SAMPLES)})` : ""}`,
  );
  check(
    `every visible select resolves a dark color-scheme (${name})`,
    schemeFails === 0 && distinctSelects.size > 0,
    `${String(distinctSelects.size)} distinct select-bearing state(s), ${String(schemeFails)} violation(s)`,
  );
  check(
    `option/optgroup colours meet AA (${name})`,
    optionFails.length === 0 && totalOptionSamples > 0,
    `${String(totalOptionSamples)} popup row(s) sampled, ${String(optionFails.length)} below AA${
      optionFails.length === 0 ? "" : ` — first: ${describe(optionFails[0])}`
    }`,
  );
  check(
    `sampled disabled text (${name})`,
    disabledSamples > 0,
    `${String(disabledSamples)} disabled sample(s) audited at the same thresholds (evidence the claim is exercised)`,
  );
  check(
    `no uncaught page errors (${name})`,
    pageErrors.length === 0,
    pageErrors.length === 0
      ? consoleNoise.length === 0
        ? "clean"
        : `clean (${String(consoleNoise.length)} console error(s) collected as detail only: ${consoleNoise[0].slice(0, 120)})`
      : pageErrors.slice(0, 3).join(" | "),
  );
  // The bead's walk is renderer x dimension: a mode the document never
  // offered would otherwise be silently absent from every verdict above.
  for (const [, label] of MODES) {
    check(
      `walked the ${label} renderer (${name})`,
      entered.has(label),
      entered.has(label)
        ? "entered at least once, flat or 4D"
        : "never entered — nothing about this renderer was measured",
    );
  }

  const fallbackReads = audits.reduce((s, a) => s + a.pageFallbackReads, 0);
  const fallbackNote =
    fallbackReads > 0
      ? `; ${String(fallbackReads)} read(s) fell through to the page's own root background, which was transparent — #000 composited under the remainder`
      : "";
  console.log(
    `[panel-contrast] ${name}: ${String(audits.length)} states audited, ${String(totalSamples)} text samples, ${String(totalOptionSamples)} popup rows${fallbackNote}`,
  );
  const listed = [...textFails, ...optionFails].slice(0, PRINT_CAP * 2);
  for (const f of listed) console.log(`  FAIL ${describe(f)}`);
}

function describe(f) {
  if (f.ratio === null) return `${f.path}: ${f.text}`;
  return `${f.path} "${f.text}": ${String(f.ratio)}:1 < ${String(f.need)}:1 (fg ${f.fg} on ${f.bg})${f.disabled ? " [disabled]" : ""}`;
}

async function main() {
  const engines = ENGINE === "both" ? ["chromium", "firefox"] : [ENGINE];
  for (const engine of engines) {
    await runEngine(engine);
  }

  console.log("[panel-contrast] ======== RESULTS ========");
  console.log(
    `[panel-contrast] viewport ${String(VIEW_W)}x${String(VIEW_H)}, engines: ${engines.join(", ")}`,
  );
  for (const r of results) {
    console.log(
      `[panel-contrast] ${r.ok ? "PASS" : "FAIL"}  ${r.name}\n                        ${r.detail}`,
    );
  }

  if (harnessErrors.length > 0) {
    console.error(
      `[panel-contrast] CHECKING-SIDE FAILURE: ${harnessErrors.join(" | ")}`,
    );
    process.exit(2);
  }
  if (failures.length > 0) {
    console.error(
      `[panel-contrast] ${String(failures.length)} verdict(s) failed`,
    );
    process.exit(1);
  }
  console.log("[panel-contrast] all verdicts passed");
  process.exit(0);
}

await main();
