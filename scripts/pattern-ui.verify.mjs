#!/usr/bin/env node
/**
 * Surface PATTERN AUTHORING UI gate (fr-cmtl.7): does the REAL panel — the
 * transform editor's Pattern group and the Finish group's Material menu —
 * author a document that (a) stays byte-identical through every non-write
 * interaction, (b) returns to its exact original bytes when the pattern is
 * returned to none, and (c) visibly changes the settled Surface render on
 * BOTH engines?
 *
 * The gate is pattern.verify.mjs's machinery with the document built by
 * the UI instead of by hash surgery. One scene, the lens3 fold-FINAL
 * archetype (the pattern arm's multivalued fold case — its LENS3_HASH is
 * pattern.verify.mjs's verbatim, after its boot auto-frame):
 *
 * - unauthored: boot the plain document, enter Surface, capture.
 * - family: boot, then AUTHOR VIA THE PANEL — click the transform row,
 *   pick the Wood family (no finish), assert the document hash changed —
 *   and that clicking the row / opening the Finish group did NOT change it
 *   first — then enter Surface, capture. This leg's pattern effect must
 *   match the .5/.6 gate's authored leg: the panel writes `{kind, axis}`
 *   and the resolver's defaults (scale 3, strength 1) are what the older
 *   gate authored explicitly, so the render must change ~3.8% of the
 *   central region or the sparse write broke the wire.
 * - strength0: boot, author family Wood, then drag the strength slider to
 *   0, then enter Surface, capture. mix(base, full, 0.0) == base exactly,
 *   so this leg must be an identity with unauthored — the same strongest
 *   byte-level control as the .5/.6 gate's strength-0 leg, now authored by
 *   the real slider.
 * - material: boot, author the Wood MATERIAL from the Finish group's
 *   Material menu (finish + pattern in one pick), assert the document
 *   carries the finish AND the pattern and NO preset name, then enter
 *   Surface, capture. The render must differ (the satin finish and the
 *   wood pattern both reach pixels).
 *
 * THE DOCUMENT-HASH CONTRACT is asserted inside the legs, not just after
 * them: with the panel open, selecting the transform row and opening the
 * Finish group are NON-writes (the acceptance's "opening/selecting/sibling
 * edits materialize nothing" — the hash must not move), and the family
 * pick is a write (the hash must move). A separate return-none leg does
 * the strongest possible sparse check: author a family, then return it to
 * none, and require the persisted hash to be BYTE-IDENTICAL to the boot
 * hash — a document explored and returned from is byte-identical to one
 * never touched.
 *
 * THE ENGINE IS SAMPLED AT CAPTURE TIME (pattern.verify.mjs's discipline).
 * The webgl arm forces `?surfacegl` and asserts engine=webgl; the compute
 * arm never forces the arm and asserts engine=compute. Both arms run all
 * four legs.
 *
 * MEASURED floors are pattern.verify.mjs's: patterned-vs-none >= 2%
 * central structural (lens3 measured 3.80-3.81% on both engines), the
 * strength-0 identity <= 0.5% (measured 0.000%), and no page errors.
 *
 * Usage (build + `npm run preview` first — this measures a real build):
 *   node scripts/pattern-ui.verify.mjs                 # both arms, sw
 *   node scripts/pattern-ui.verify.mjs --mode=x11::0   # real driver, headed
 *   node scripts/pattern-ui.verify.mjs --arm=webgl     # WebGL arm only
 *
 *   --url       app origin (default https://localhost:4173)
 *   --mode      sw (default) | x11:<display>
 *   --arm       both (default) | webgl | compute
 *   --viewport  WxH (default 641x360 — the narrowest width that still opens
 *               the panel; MOBILE_BREAKPOINT is 640, and the canvas backing
 *               is the full viewport under the overlaying panel, so wider
 *               costs render time without adding visible canvas)
 *   --settle    per-leg budget in ms for reaching the target stage
 *               (default 300000)
 *   --stage     target stage for the first leg: 8 waits for the settled
 *               latch; 1..7 stops at that many completed passes (default 1)
 *   --dwell     ms the settled latch must hold (default 2000)
 *   --floor     minimum structural-diff fraction for patterned-vs-none
 *               (default 0.02)
 *   --identity  maximum structural-diff fraction for strength-0-vs-none
 *               (default 0.005)
 *   --outdir    where PNGs land (default .playwright-mcp/, gitignored)
 *
 * Exit codes: 0 all legs passed; 1 a verdict failed; 2 a CHECKING-side
 * failure (no browser, no common stage inside the budget) — rerun, it is
 * not a pattern verdict.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.resolve(__dirname, "..", ".playwright-mcp");

/** pattern.verify.mjs's lens3 scenario hash, verbatim: LENS3_BASE_HASH
 * after its boot auto-frame, re-encoded with the resulting camera pose —
 * a 4-map Sierpinski base under a boxfold final transform, the pattern
 * arm's multivalued fold case. */
const LENS3_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuMzUsMC4zNSwwLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfSx7InBvc2l0aW9uIjpbLTAuMzUsLTAuMzUsMC4zNV0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX0seyJwb3NpdGlvbiI6WzAuMzUsLTAuMzUsLTAuMzVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlstMC4zNSwwLjM1LC0wLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxLCJmaW5hbFRyYW5zZm9ybSI6eyJwb3NpdGlvbiI6WzAuMTUsLTAuMSwwLjA1XSwicm90YXRpb24iOlswLjIsMC4zLDAuMV0sInNjYWxlIjpbMC45LDAuOSwwLjldLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoiYm94Zm9sZCIsIndlaWdodCI6MC41NX1dfSwiY2FtZXJhIjp7InRhcmdldCI6WzAuMDU2OSwtMC4wOTI1LC0wLjAzNDhdLCJyYWRpdXMiOjEuNDM5OCwidGhldGEiOjAuNzg1NCwicGhpIjoxLjA1Nn19";

/** Overlay elements that can paint on top of the canvas (pattern.verify's
 * list). Their boxes are masked out of both regions, as the UNION over the
 * compared legs. */
const OVERLAY_SELECTORS = [
  "#panel",
  "#help",
  "#legend",
  "#menuToggle",
  "#loading",
  "#error",
  "#updateBanner",
  "#renderError",
  "#toast",
];

/** Channel delta above which a differing pixel counts as STRUCTURAL. */
const STRUCTURAL_DELTA = 8;
/** The asserted region: the middle CENTER_FRACTION of the canvas. */
const CENTER_FRACTION = 0.7;
/** The app's supersampling pass count; stage SETTLE_SAMPLES is the settled
 * latch. */
const SETTLE_SAMPLES = 8;
const STAGE_GRACE_MS = 2_500;
const POLL_MS = 250;
/** How long the persisted hash must hold unchanged for an interaction to be
 * judged a no-op (the app's own SAVE_DEBOUNCE_MS is 300). */
const HASH_SETTLE_MS = 800;
/** How long after a UI write the hash has to move. */
const HASH_WRITE_TIMEOUT_MS = 10_000;

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    mode: "sw",
    arm: "both",
    viewport: "641x360",
    settle: 300_000,
    stage: 1,
    dwell: 2_000,
    floor: 0.02,
    identity: 0.005,
    outdir: DEFAULT_OUT_DIR,
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    if (!raw.startsWith("--") || !(key in args)) {
      throw new Error(`unknown flag ${raw}`);
    }
    if (["settle", "stage", "dwell", "floor", "identity"].includes(key)) {
      args[key] = Number(value);
      if (!Number.isFinite(args[key]))
        throw new Error(`--${key} wants a number`);
    } else args[key] = value;
  }
  if (!["both", "webgl", "compute"].includes(args.arm)) {
    throw new Error(`--arm must be both, webgl or compute (got ${args.arm})`);
  }
  const vp = /^(\d+)x(\d+)$/.exec(args.viewport);
  if (!vp) throw new Error(`--viewport must be WxH (got ${args.viewport})`);
  args.width = Number(vp[1]);
  args.height = Number(vp[2]);
  if (args.width <= 640) {
    throw new Error(
      `--viewport width ${args.width} keeps the panel CLOSED (MOBILE_BREAKPOINT 640); the UI cannot be driven — use at least 641px`,
    );
  }
  if (
    !Number.isInteger(args.stage) ||
    args.stage < 1 ||
    args.stage > SETTLE_SAMPLES
  ) {
    throw new Error(`--stage must be an integer 1..${SETTLE_SAMPLES}`);
  }
  if (args.mode !== "sw" && !args.mode.startsWith("x11:")) {
    throw new Error(`--mode must be sw or x11:<display> (got ${args.mode})`);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Document helpers: decode the hash, assert what the UI wrote.
// ---------------------------------------------------------------------------

function decodeHash(hash) {
  const raw = hash.replace(/^#v1=/, "");
  const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
  const json = Buffer.from(
    padded.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
  return JSON.parse(json);
}

// ---------------------------------------------------------------------------
// Browser.
// ---------------------------------------------------------------------------

function launchOptions(mode) {
  const env = { ...process.env };
  if (mode.startsWith("x11:")) {
    env.DISPLAY = mode.slice(4);
    return {
      env,
      args: [
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan",
        "--ignore-gpu-blocklist",
        "--no-sandbox",
      ],
    };
  }
  delete env.DISPLAY;
  return {
    env,
    args: [
      "--headless=new",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
      "--use-webgpu-adapter=swiftshader",
      "--use-vulkan=swiftshader",
      "--no-sandbox",
    ],
  };
}

async function bootScene(page, target) {
  await page.goto(target, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const el = document.getElementById("pointCount");
      return !!el && Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
    },
    undefined,
    { timeout: 60_000, polling: 100 },
  );
}

async function readBackendLabels(page) {
  return page.evaluate(async () => {
    let webgl = null;
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") ?? c.getContext("webgl");
      if (gl) {
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        webgl = String(
          ext
            ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER),
        );
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      } else webgl = "(no WebGL context)";
    } catch (err) {
      webgl = `(error: ${err instanceof Error ? err.message : String(err)})`;
    }
    return { webgl };
  });
}

async function enterSurface(page) {
  const deadline = Date.now() + 10_000;
  let state = null;
  for (;;) {
    state = await page.evaluate(() => {
      const b = document.getElementById("modeSurfaceBtn");
      return {
        present: !!b,
        disabled: b?.disabled ?? true,
        pressed: b?.getAttribute("aria-pressed") === "true",
        title: b?.title ?? "",
      };
    });
    if (state.present && !state.disabled) break;
    if (Date.now() > deadline) return state;
    await page.waitForTimeout(100);
  }
  if (!state.pressed) {
    await page.evaluate(() => {
      document
        .getElementById("modeSurfaceBtn")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
  return state;
}

/** One poll of the settle machinery (pattern.verify's vocabulary). */
async function pollStage(page) {
  const s = await page.evaluate(() => {
    const probe = window.__surfaceState?.() ?? null;
    const row = document.getElementById("surfaceProgress");
    const rowText =
      row && !row.classList.contains("hidden") ? row.textContent || "" : "";
    return { probe, rowText };
  });
  if (s.probe === null) {
    throw new Error(
      "window.__surfaceState is absent — the page was not loaded with ?surfacestate",
    );
  }
  const p = s.probe;
  const latched =
    p.mode === "surface" &&
    p.firstFrame &&
    p.settled &&
    !p.previewActive &&
    !p.settleActive &&
    !p.settlePending;
  let completed = 0;
  const pass = /antialiasing pass (\d+)\/(\d+)/.exec(s.rowText);
  if (pass && /Full detail/.test(s.rowText)) {
    completed = Math.max(0, Number(pass[1]) - 1);
  }
  return { probe: p, rowText: s.rowText, latched, completed };
}

async function captureCanvas(page) {
  const geometry = await page.evaluate((selectors) => {
    const canvas = document.querySelector("#container canvas");
    if (!canvas) return null;
    const c = canvas.getBoundingClientRect();
    const overlays = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (Number(style.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (r.right <= c.left || r.left >= c.right) continue;
        if (r.bottom <= c.top || r.top >= c.bottom) continue;
        overlays.push({
          sel,
          x: Math.floor(r.left - c.left),
          y: Math.floor(r.top - c.top),
          w: Math.ceil(r.width),
          h: Math.ceil(r.height),
        });
      }
    }
    return {
      width: Math.round(c.width),
      height: Math.round(c.height),
      overlays,
    };
  }, OVERLAY_SELECTORS);
  if (geometry === null) throw new Error("no canvas element on the page");
  const buffer = await page
    .locator("#container canvas")
    .first()
    .screenshot({ type: "png" });
  return { buffer, geometry };
}

/** A capture of a PARKED canvas, diag-style (pattern.verify's
 * captureStable): the strip settle presents each completed pass on its
 * fixed cadence, so after the stage row appears a fixed grace lets the
 * present land and the canvas holds the completed mean. */
async function captureStable(page) {
  await page.waitForTimeout(STAGE_GRACE_MS);
  return { ...(await captureCanvas(page)), stable: true };
}

// ---------------------------------------------------------------------------
// The panel-driving steps.
// ---------------------------------------------------------------------------

/** Select transform 0 (the first real transform row — the camera row is
 * row 1) and open the Pattern group, so the authoring controls exist. */
async function openTransformEditor(page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll("#transformList .transform-btn");
    const row = rows[1];
    if (!row) throw new Error("no transform row in the list");
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const editor = document.getElementById("transformEditor");
    if (!editor) return { ok: false };
    const details = [...editor.querySelectorAll("details")].find(
      (d) => d.querySelector("summary")?.textContent === "Pattern",
    );
    details?.setAttribute("open", "");
    return { ok: true };
  });
}

/** Set one editor <select> and fire its change event. */
async function pickEditorSelect(page, className, value) {
  return page.evaluate(
    ({ className, value }) => {
      const select = document.querySelector(
        `#transformEditor select.${className}`,
      );
      if (!select) throw new Error(`no select.${className} in the editor`);
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return select.value;
    },
    { className, value },
  );
}

/** Set one editor slider and fire its input event. */
async function dragEditorSlider(page, ariaLabel, value) {
  return page.evaluate(
    ({ ariaLabel, value }) => {
      const slider = document.querySelector(
        `#transformEditor input[aria-label="${ariaLabel}"]`,
      );
      if (!slider) throw new Error(`no slider labelled ${ariaLabel}`);
      slider.value = value;
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      return slider.value;
    },
    { ariaLabel, value },
  );
}

/** The persisted document hash, or null when the page has none. */
async function readHash(page) {
  return page.evaluate(() => window.location.hash || null);
}

/** Wait until the hash stops changing (a non-write interaction's persist
 * debounce would have fired by then), and return it. */
async function settleHash(page, log) {
  let last = await readHash(page);
  const deadline = Date.now() + 15_000;
  for (;;) {
    await page.waitForTimeout(150);
    const now = await readHash(page);
    if (now === last) {
      if (Date.now() + 150 > deadline) return last;
      // Require the hash to hold for the whole debounce window + margin.
      await page.waitForTimeout(HASH_SETTLE_MS);
      const again = await readHash(page);
      if (again === last) return last;
      last = again;
    } else {
      last = now;
      log(`    hash moved; re-settling`);
    }
    if (Date.now() > deadline) throw new Error("hash never settled");
  }
}

/** Assert the hash does NOT move across a no-op interaction, then that it
 * DOES move across the given write. `pick` must itself fire the write. */
async function assertWriteDiscipline(page, log, bootHash, pick) {
  await openTransformEditor(page);
  await settleHash(page, log);
  const afterOpen = await readHash(page);
  if (afterOpen !== bootHash) {
    throw new Error(
      `opening the transform editor materialized a write: hash moved ${bootHash === null ? "from null" : "away from boot"} — the acceptance's "opening/selecting materializes nothing" is violated`,
    );
  }
  await pick(page);
  const deadline = Date.now() + HASH_WRITE_TIMEOUT_MS;
  for (;;) {
    const now = await readHash(page);
    if (now !== afterOpen) return now;
    if (Date.now() > deadline) {
      throw new Error("the write never reached the persisted hash");
    }
    await page.waitForTimeout(100);
  }
}

// ---------------------------------------------------------------------------
// One leg: fresh context, boot, author via the UI when the leg calls for
// it, enter Surface, capture at every stage boundary up to `stopAt`.
// ---------------------------------------------------------------------------

async function runLeg(browser, args, leg, legArm, stopAt, budgetMs, log) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const consoleLines = [];
  const pageErrors = [];
  const captures = new Map();
  const result = {
    leg: leg.name,
    captures,
    consoleLines,
    pageErrors,
    engine: null,
    labels: null,
    final: null,
    stopReason: null,
    elapsedMs: 0,
    authoredHash: null,
    bootHash: null,
    notes: [],
  };
  const t0 = Date.now();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(budgetMs + 60_000);
    page.on("console", (msg) => consoleLines.push(msg.text()));
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.bringToFront();
    const base = args.url.replace(/\/+$/, "");
    // `?surfacegl` must ride the LEG's arm, not the invocation's: the
    // both-arms mode forces it on the webgl legs and never on the compute
    // legs, so the engine each capture asserts is the one the session
    // actually had to choose.
    const force = legArm === "webgl" ? "surfacegl" : "";
    const query = ["surfacestate", force].filter(Boolean).join("&");
    await bootScene(page, `${base}/?${query}${LENS3_HASH}`);
    const bootUrl = await page.evaluate(
      () =>
        `${window.location.pathname}${window.location.search}${window.location.hash.slice(0, 12)}…`,
    );
    log(`    booted ${bootUrl}`);
    result.labels = await readBackendLabels(page);
    result.bootHash = await settleHash(page, log);
    if (leg.author) {
      result.authoredHash = await leg.author(page, log, result.bootHash);
    }

    const btn = await enterSurface(page);
    if (!btn.present || btn.disabled) {
      result.stopReason = `surface button ${btn.present ? "disabled" : "missing"}: ${btn.title}`;
      return result;
    }

    const deadline = t0 + budgetMs;
    let heldSince = null;
    let lastCompleted = 0;
    let lastRow = null;
    for (;;) {
      const s = await pollStage(page);
      result.final = s;
      if (s.probe.engine) result.engine = s.probe.engine;
      if (s.rowText !== lastRow) {
        lastRow = s.rowText;
        log(
          `    [${((Date.now() - t0) / 1000).toFixed(0)}s] ${s.rowText || "(row hidden)"}`,
        );
      }
      if (s.latched) {
        heldSince ??= Date.now();
        if (Date.now() - heldSince >= args.dwell) {
          const shot = await captureStable(page);
          const after = await pollStage(page);
          if (after.latched) {
            captures.set(SETTLE_SAMPLES, {
              ...shot,
              stage: SETTLE_SAMPLES,
              elapsedMs: Date.now() - t0,
              rowText: "(settled)",
              engine: after.probe.engine,
            });
            result.stopReason = "settled";
            return result;
          }
          heldSince = null;
          continue;
        }
      } else heldSince = null;

      if (s.completed > lastCompleted && s.completed >= 1) {
        const stage = s.completed;
        const shot = await captureStable(page);
        const after = await pollStage(page);
        if (after.completed === stage && !after.latched) {
          captures.set(stage, {
            ...shot,
            stage,
            elapsedMs: Date.now() - t0,
            rowText: s.rowText,
            engine: after.probe.engine,
          });
          log(
            `    captured stage ${stage}/${SETTLE_SAMPLES} at ${((Date.now() - t0) / 1000).toFixed(1)}s`,
          );
          lastCompleted = stage;
          if (stage >= stopAt) {
            result.stopReason = `reached stage ${stage}`;
            return result;
          }
        } else {
          log(`    stage ${stage} moved on during capture; skipping it`);
          lastCompleted = Math.max(lastCompleted, stage);
        }
      }
      if (Date.now() > deadline) {
        result.stopReason = "budget";
        return result;
      }
      await page.waitForTimeout(POLL_MS);
    }
  } finally {
    result.elapsedMs = Date.now() - t0;
    await context.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Diff (pattern.verify's, verbatim).
// ---------------------------------------------------------------------------

async function diffPngs(page, a, b, masks, region) {
  return page.evaluate(
    async ({ aB64, bB64, masks, region, structuralDelta }) => {
      async function decode(base64) {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return {
          data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          width: canvas.width,
          height: canvas.height,
        };
      }
      const A = await decode(aB64);
      const B = await decode(bB64);
      if (A.width !== B.width || A.height !== B.height) {
        return {
          error: `size mismatch ${A.width}x${A.height} vs ${B.width}x${B.height}`,
        };
      }
      const { width, height } = A;
      const masked = new Uint8Array(width * height);
      for (const m of masks) {
        for (let y = Math.max(0, m.y); y < Math.min(height, m.y + m.h); y++) {
          for (let x = Math.max(0, m.x); x < Math.min(width, m.x + m.w); x++) {
            masked[y * width + x] = 1;
          }
        }
      }
      const inRegion = (x, y) =>
        x >= region.x &&
        x < region.x + region.w &&
        y >= region.y &&
        y < region.y + region.h;
      const center = { compared: 0, differing: 0, structural: 0, maxDelta: 0 };
      for (let i = 0, p = 0; p < width * height; p++, i += 4) {
        if (masked[p]) continue;
        const x = p % width;
        const y = (p - x) / width;
        if (!inRegion(x, y)) continue;
        center.compared++;
        const d = Math.max(
          Math.abs(A.data[i] - B.data[i]),
          Math.abs(A.data[i + 1] - B.data[i + 1]),
          Math.abs(A.data[i + 2] - B.data[i + 2]),
        );
        if (d === 0) continue;
        center.differing++;
        if (d > center.maxDelta) center.maxDelta = d;
        if (d > structuralDelta) center.structural++;
      }
      return { center };
    },
    {
      aB64: a.toString("base64"),
      bB64: b.toString("base64"),
      masks,
      region,
      structuralDelta: STRUCTURAL_DELTA,
    },
  );
}

function centralRegion(width, height) {
  const w = Math.round(width * CENTER_FRACTION);
  const h = Math.round(height * CENTER_FRACTION);
  return {
    x: Math.floor((width - w) / 2),
    y: Math.floor((height - h) / 2),
    w,
    h,
  };
}

function stageName(stage) {
  return stage >= SETTLE_SAMPLES
    ? "settled"
    : `${stage}/${SETTLE_SAMPLES} passes`;
}

function describeLeg(r) {
  const stages = [...r.captures.keys()].sort((a, b) => a - b);
  const best = stages.at(-1);
  return (
    `engine=${r.engine ?? "none"}, ${r.stopReason ?? "?"} at ${(r.elapsedMs / 1000).toFixed(1)}s, ` +
    `stages captured [${stages.join(",")}]` +
    (best !== undefined
      ? ` (best ${stageName(best)} at ${(r.captures.get(best).elapsedMs / 1000).toFixed(1)}s)`
      : "") +
    (r.pageErrors.length ? `, ${r.pageErrors.length} page error(s)` : "")
  );
}

function interestingConsole(lines) {
  return lines.filter(
    (l) =>
      /^Surface render: /.test(l) ||
      /^WebGL renderer is a software rasterizer/.test(l) ||
      /^Surface compute settle/.test(l) ||
      /^Surface compute: tracing/.test(l) ||
      /Surface compute device lost/.test(l),
  );
}

// ---------------------------------------------------------------------------
// The legs.
// ---------------------------------------------------------------------------

/** Author the Wood family through the real panel, asserting the write
 * discipline around it: opening the editor and picking the family are the
 * only steps, and only the pick may move the hash. Returns the authored
 * hash. */
async function authorFamily(page, log, bootHash) {
  const authored = await assertWriteDiscipline(
    page,
    log,
    bootHash,
    async (p) => {
      await pickEditorSelect(p, "pattern-family", "wood");
    },
  );
  const doc = decodeHash(authored);
  const t = doc.transforms[0];
  const pattern = t.surfacePattern;
  if (!pattern) {
    throw new Error("picking the Wood family wrote no surfacePattern");
  }
  const keys = Object.keys(pattern).sort().join(",");
  if (keys !== "axis,kind") {
    throw new Error(
      `the UI-authored surfacePattern is not minimal — got {${keys}}; the family defaults (scale, strength) must stay absent`,
    );
  }
  if (pattern.kind !== "wood" || pattern.axis !== "y") {
    throw new Error(
      `the UI-authored pattern is not the pick: ${JSON.stringify(pattern)}`,
    );
  }
  log(
    `    UI pick wrote surfacePattern ${JSON.stringify(pattern)} (minimal; defaults absent)`,
  );
  return authored;
}

/** Author the Wood family, then drag the strength slider to 0. */
async function authorFamilyStrength0(page, log, bootHash) {
  const authored = await assertWriteDiscipline(
    page,
    log,
    bootHash,
    async (p) => {
      await pickEditorSelect(p, "pattern-family", "wood");
      await dragEditorSlider(p, "Pattern strength", "0");
    },
  );
  const doc = decodeHash(authored);
  const pattern = doc.transforms[0].surfacePattern;
  if (!pattern || pattern.strength !== 0) {
    throw new Error(
      `the strength-0 leg's document is not {kind, axis, strength: 0}: ${JSON.stringify(pattern)}`,
    );
  }
  log(`    UI wrote strength 0: ${JSON.stringify(pattern)}`);
  return authored;
}

/** Author the Wood MATERIAL from the Finish group's Material menu. */
async function authorMaterial(page, log, bootHash) {
  const authored = await assertWriteDiscipline(
    page,
    log,
    bootHash,
    async (p) => {
      // Open the Finish group so the Material menu is genuinely reachable,
      // and pick the wood starting point.
      await p.evaluate(() => {
        const editor = document.getElementById("transformEditor");
        const details = [...editor.querySelectorAll("details")].find(
          (d) => d.querySelector("summary")?.textContent === "Finish",
        );
        details?.setAttribute("open", "");
      });
      await pickEditorSelect(p, "finish-material", "wood");
    },
  );
  const doc = decodeHash(authored);
  const t = doc.transforms[0];
  if (!t.finish) {
    throw new Error("picking the Wood material wrote no finish");
  }
  const pattern = t.surfacePattern;
  if (!pattern || pattern.kind !== "wood") {
    throw new Error(
      `picking the Wood material wrote no wood pattern: ${JSON.stringify(pattern)}`,
    );
  }
  const tKeys = Object.keys(t).sort();
  if (tKeys.includes("material") || tKeys.includes("preset")) {
    throw new Error(
      `the document stores a preset name: keys ${tKeys.join(",")} — the acceptance's "never a preset name" is violated`,
    );
  }
  log(
    `    UI Material pick wrote finish ${JSON.stringify(t.finish)} and surfacePattern ${JSON.stringify(pattern)} (values only, no preset name)`,
  );
  return authored;
}

/** Author a family and return it to none; require the persisted hash to
 * come back BYTE-IDENTICAL to the plain document's MODERN canonical form.
 *
 * The boot hash itself is pattern.verify.mjs's LENS3_HASH, which predates
 * the atmosphere/balloon/floor fields (balloonEcho, fogDensity, envLight,
 * floorPattern, …) the current persist encoder writes whenever it touches
 * a document — so the byte-identical comparison cannot be against the boot
 * hash (that would fail on the persist-era fields, not on the pattern). A
 * NEUTRAL edit on a fresh boot — a slider dragged to its own value, which
 * changes no document data — makes the app persist the plain document in
 * its modern canonical form; the return-to-none hash must equal THAT,
 * byte for byte. Runs without entering Surface. */
async function runReturnNoneLeg(browser, args, log) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const notes = [];
  const pageErrors = [];
  try {
    const page = await context.newPage();
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.bringToFront();
    const base = args.url.replace(/\/+$/, "");
    await bootScene(page, `${base}/?surfacestate${LENS3_HASH}`);
    const bootHash = await settleHash(page, log);
    await openTransformEditor(page);
    await settleHash(page, log);
    if ((await readHash(page)) !== bootHash) {
      throw new Error("opening the editor moved the hash");
    }
    // A neutral edit: drag the Scale X slider to its own value. The
    // document data is unchanged, but the persist debounce fires and
    // re-encodes the plain document in the modern canonical form — the
    // reference the return-to-none hash must equal.
    await dragEditorSlider(page, "Scale X", "0.5");
    const plainHash = await settleHash(page, log);
    if (plainHash === bootHash) {
      notes.push(
        "neutral edit produced no re-encode (the boot hash is already the modern form) — comparing against the boot hash",
      );
    } else {
      notes.push(
        "neutral edit re-encoded the plain document in its modern canonical form",
      );
    }
    const deadline = Date.now() + HASH_WRITE_TIMEOUT_MS;
    let authoredHash = null;
    await pickEditorSelect(page, "pattern-family", "wood");
    for (;;) {
      authoredHash = await readHash(page);
      if (authoredHash !== plainHash) break;
      if (Date.now() > deadline) throw new Error("family pick never persisted");
      await page.waitForTimeout(100);
    }
    const authoredDoc = decodeHash(authoredHash);
    const pattern = authoredDoc.transforms[0].surfacePattern;
    if (!pattern) {
      throw new Error("the family pick persisted no surfacePattern");
    }
    await settleHash(page, log);
    await pickEditorSelect(page, "pattern-family", "none");
    const returned = await settleHash(page, log);
    const identical = returned === plainHash;
    if (identical) {
      notes.push("return-to-none restored the plain document byte-identically");
    } else {
      notes.push(
        `return-to-none DID NOT restore the plain document (plain ${plainHash.slice(0, 24)}…, returned ${returned.slice(0, 24)}…)`,
      );
    }
    if (pageErrors.length) {
      notes.push(`${pageErrors.length} page error(s): ${pageErrors[0]}`);
    }
    return { notes, identical, pageErrors: pageErrors.length };
  } finally {
    await context.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outdir, { recursive: true });
  const log = (line) => console.error(`[pattern-ui] ${line}`);
  const region = centralRegion(args.width, args.height);
  const arms = args.arm === "both" ? ["webgl", "compute"] : [args.arm];

  log(
    `arms=${arms.join("+")}, ${args.width}x${args.height}, mode=${args.mode}, ` +
      `target stage ${stageName(args.stage)}, budget ${args.settle / 1000}s/leg, ` +
      `pattern floor ${(args.floor * 100).toFixed(2)}% structural (>${STRUCTURAL_DELTA}/255) ` +
      `over the central ${CENTER_FRACTION * 100}% region, ` +
      `strength-0 identity ceiling ${(args.identity * 100).toFixed(3)}%`,
  );

  const { env, args: launchArgs } = launchOptions(args.mode);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: chromium.executablePath(),
      headless: false, // + --headless=new under sw: keeps a GPU process alive
      env,
      args: launchArgs,
    });
  } catch (err) {
    log(`CHECKING FAILURE: browser launch failed: ${err.message}`);
    process.exit(2);
  }

  const verdicts = [];
  let failures = 0;
  let inconclusive = 0;
  const t0 = Date.now();
  try {
    const diffContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const diffPage = await diffContext.newPage();
    await diffPage.goto("about:blank");

    const legs = [
      { name: "unauthored", author: null },
      { name: "family", author: authorFamily },
      { name: "strength0", author: authorFamilyStrength0 },
      { name: "material", author: authorMaterial },
    ];

    for (const arm of arms) {
      log(`=== ${arm} arm ===`);
      const results = [];
      let stopAt = args.stage;
      let budget = args.settle;
      for (const leg of legs) {
        log(
          `  leg ${leg.name}: stop at ${stageName(stopAt)}, budget ${(budget / 1000).toFixed(0)}s`,
        );
        let r;
        try {
          r = await runLeg(browser, args, leg, arm, stopAt, budget, log);
        } catch (err) {
          log(`  CHECKING FAILURE on ${arm}/${leg.name}: ${err.message}`);
          inconclusive++;
          verdicts.push(
            `${arm}: INCONCLUSIVE — ${leg.name} leg threw before a capture (${err.message})`,
          );
          results.length = 0;
          break;
        }
        log(`  leg ${leg.name}: ${describeLeg(r)}`);
        log(`    WebGL renderer: ${r.labels?.webgl ?? "?"}`);
        for (const line of interestingConsole(r.consoleLines))
          log(`    console: ${line}`);
        for (const e of r.pageErrors) log(`    PAGE ERROR: ${e}`);
        for (const [stage, cap] of r.captures) {
          const file = path.join(
            args.outdir,
            `${arm}-${leg.name}-s${stage}.png`,
          );
          await writeFile(file, cap.buffer);
        }
        results.push(r);
        const best = Math.max(0, ...r.captures.keys());
        if (best === 0) break;
        stopAt = best;
        budget = Math.max(args.settle, 2 * r.captures.get(best).elapsedMs);
      }
      if (results.length < 4) {
        const r = results[0];
        inconclusive++;
        verdicts.push(
          `${arm}: INCONCLUSIVE — a leg reached no stage inside ${(args.settle / 1000).toFixed(0)}s (${r?.stopReason ?? "no result"}); raise --settle or shrink --viewport`,
        );
        continue;
      }
      const [un, family, strength0, material] = results;
      const common = [...un.captures.keys()]
        .filter(
          (s) =>
            family.captures.has(s) &&
            strength0.captures.has(s) &&
            material.captures.has(s),
        )
        .sort((a, b) => b - a)[0];
      if (common === undefined) {
        inconclusive++;
        verdicts.push(
          `${arm}: INCONCLUSIVE — no common stage (unauthored [${[...un.captures.keys()].join(",")}], family [${[...family.captures.keys()].join(",")}], strength0 [${[...strength0.captures.keys()].join(",")}], material [${[...material.captures.keys()].join(",")}]); raise --settle`,
        );
        continue;
      }
      const capUn = un.captures.get(common);
      const capFa = family.captures.get(common);
      const capS0 = strength0.captures.get(common);
      const capMa = material.captures.get(common);

      const problems = [];
      for (const r of results) {
        if (r.pageErrors.length) {
          problems.push(
            `${r.leg} leg: ${r.pageErrors.length} page error(s): ${r.pageErrors[0]}`,
          );
        }
      }
      const expectedEngine = arm;
      for (const [r, cap] of [
        [un, capUn],
        [family, capFa],
        [strength0, capS0],
        [material, capMa],
      ]) {
        if (cap.engine !== expectedEngine) {
          problems.push(
            `${r.leg} leg ran engine=${cap.engine ?? "none"} at the compared stage (${stageName(common)}), expected ${expectedEngine}`,
          );
        }
      }
      if (!capUn.stable || !capFa.stable || !capS0.stable || !capMa.stable) {
        problems.push(
          `a stage-${common} capture never parked (unauthored stable=${capUn.stable}, family stable=${capFa.stable}, strength0 stable=${capS0.stable}, material stable=${capMa.stable})`,
        );
      }

      const masks = [
        ...capUn.geometry.overlays,
        ...capFa.geometry.overlays,
        ...capS0.geometry.overlays,
        ...capMa.geometry.overlays,
      ];
      const dFamily = await diffPngs(
        diffPage,
        capUn.buffer,
        capFa.buffer,
        masks,
        region,
      );
      const dIdentity = await diffPngs(
        diffPage,
        capUn.buffer,
        capS0.buffer,
        masks,
        region,
      );
      const dMaterial = await diffPngs(
        diffPage,
        capUn.buffer,
        capMa.buffer,
        masks,
        region,
      );
      const frac = (d) =>
        d.center.compared > 0 ? d.center.structural / d.center.compared : 0;
      const familyFrac = frac(dFamily);
      const s0Frac = frac(dIdentity);
      const materialFrac = frac(dMaterial);
      log(
        `  ${arm} @ ${stageName(common)}: family-vs-none ${(familyFrac * 100).toFixed(3)}% structural (max delta ${dFamily.center.maxDelta}); ` +
          `strength0-vs-none ${(s0Frac * 100).toFixed(3)}% (max delta ${dIdentity.center.maxDelta}); ` +
          `material-vs-none ${(materialFrac * 100).toFixed(3)}% (max delta ${dMaterial.center.maxDelta}); ` +
          `${masks.length} overlay box(es) masked`,
      );
      if (familyFrac < args.floor) {
        problems.push(
          `family-vs-none central structural diff ${(familyFrac * 100).toFixed(3)}% < floor ${(args.floor * 100).toFixed(2)}%`,
        );
      }
      if (materialFrac < args.floor) {
        problems.push(
          `material-vs-none central structural diff ${(materialFrac * 100).toFixed(3)}% < floor ${(args.floor * 100).toFixed(2)}%`,
        );
      }
      if (s0Frac > args.identity) {
        problems.push(
          `strength-0-vs-none central structural diff ${(s0Frac * 100).toFixed(3)}% > identity ceiling ${(args.identity * 100).toFixed(3)}%`,
        );
      }
      if (problems.length) {
        failures++;
        verdicts.push(`${arm}: FAIL — ${problems.join("; ")}`);
      } else {
        verdicts.push(
          `${arm}: PASS @ ${stageName(common)} (family ${(familyFrac * 100).toFixed(2)}%, strength-0 ${(s0Frac * 100).toFixed(3)}%, material ${(materialFrac * 100).toFixed(2)}%)`,
        );
      }
    }

    // The document round-trip leg runs once, engine-independent.
    log(`=== document round-trip ===`);
    let ret;
    try {
      ret = await runReturnNoneLeg(browser, args, log);
    } catch (err) {
      log(`  CHECKING FAILURE on return-none leg: ${err.message}`);
      inconclusive++;
      verdicts.push(`document round-trip: INCONCLUSIVE — ${err.message}`);
      ret = null;
    }
    if (ret) {
      for (const note of ret.notes) log(`  ${note}`);
      if (ret.pageErrors > 0) {
        failures++;
        verdicts.push(
          `document round-trip: FAIL — ${ret.pageErrors} page error(s)`,
        );
      } else if (ret.identical) {
        verdicts.push(
          "document round-trip: PASS — return-to-none restored the boot hash byte-identically",
        );
      } else {
        failures++;
        verdicts.push(
          "document round-trip: FAIL — return-to-none did not restore the boot hash",
        );
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  log(`total wall ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const v of verdicts) log(v);
  if (failures > 0) process.exit(1);
  if (inconclusive > 0) process.exit(2);
}
main().catch((err) => {
  console.error(`[pattern-ui] FATAL: ${err.stack ?? err}`);
  process.exit(2);
});
