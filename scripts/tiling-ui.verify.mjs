#!/usr/bin/env node
/**
 * Finite Surface-tiling AUTHORING AND PRESET gate. This drives the production
 * app through the same panel controls and preset menu a person uses; it does
 * not construct a tiling block by editing the document hash.
 *
 * The three showcase presets are loaded FROM `#presetSelect`. Each must write
 * its authored finite group (B3, A4, F4), enter Surface unaided through its
 * saved renderer hint, reach the requested completed rendering stage, draw a
 * non-backdrop share in a real canvas screenshot, and retain the group in the
 * persisted `#v1=` document. The gate then clears ONLY the tiling block through
 * its live checkbox, renders the same transforms at the preserved camera, and
 * requires a structural scene-region difference. That paired negative control
 * proves each showcase is visibly tiled rather than merely drawn with a dead
 * persisted block. At the default stage (8) the app's own settled
 * latch must hold; stages 1..7 are explicit quicker diagnostic runs that stop
 * only after that many full-detail antialiasing passes have completed. On a
 * real X11 display the natural production routing is also gated: the flat B3
 * showcase uses WebGL and the two genuinely 4D showcases use compute. The
 * SwiftShader run reports its engine but does not turn adapter availability
 * into a routing verdict.
 *
 * A same-page replacement loads an ordinary untiled preset after a tiled one
 * and requires the tiling block to clear. The authoring leg then proves the
 * panel contract independently of the presets:
 *
 * - Space enables the finite block, ArrowDown changes the chamber group, and
 *   ArrowDown in the independent clip picker adds a bundled analytic content
 *   clip without changing that chamber;
 * - every control has an unclipped 44x44 CSS-pixel activation target;
 * - Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z restore the exact group-only and
 *   group-plus-clip tiling objects, and the app's own copied share link keeps
 *   the latter object exactly;
 * - Points, Flame, and Sampled Solid each disclose beside the still-visible
 *   controls that they show the untiled attractor;
 * - Balloon and order>1 Symmetry leave the authored checkbox available as a
 *   clear route while disabling both dependent finite detail controls and
 *   explaining the refusal next to them.
 *
 * Screenshots are read only after Playwright captures the canvas. The live
 * WebGL canvas is never read outside its renderer's animation frame. Overlay
 * elements are hidden before capture, and the downsampled image is compared
 * with its own four corners to estimate non-backdrop coverage.
 *
 * This gate deliberately does NOT compare the three presets with each other,
 * certify the fold algebra (the CPU/kernel tests and finite renderer gate own
 * that), exercise imported/custom clips, author mirrored lattice parameters,
 * or test phone layout (the panel must be open at a viewport wider than the
 * 640px breakpoint).
 *
 * MEASURED 2026-08-31 on verified Mesa Intel Iris Xe, settled 8/8 at 800x640:
 * B3 routed WebGL, drew 39.63% non-backdrop and differed 5.75% from its
 * same-camera untiled control; A4 routed compute at 40.19% / 5.19%; F4 routed
 * compute at 39.01% / 8.47%. The preset clear, 44px targets, trusted keyboard
 * edits, exact undo/redo, app-copied-link reload, three untiled-mode notices,
 * Balloon/Symmetry dormancy and explicit clear route all passed without page
 * or console errors. A short SwiftShader stage-1 smoke independently passed
 * B3 (37.22% / 5.68%) and A4 (37.75% / 4.85%); F4 drew through compute but
 * its untiled negative-control pass exceeded that run's deliberately short
 * 120s diagnostic budget, so it is not recorded as a software verdict.
 *
 * Usage (build + `npm run preview` first):
 *   node scripts/tiling-ui.verify.mjs
 *   node scripts/tiling-ui.verify.mjs --mode=x11::0
 *   node scripts/tiling-ui.verify.mjs --stage=1
 *
 * Options:
 *   --url=URL        app origin (default https://localhost:4173)
 *   --mode=MODE      sw (default) or x11:<display>
 *   --viewport=WxH   viewport, width must be >=641 (default 800x640)
 *   --settle=MS      per-preset target-stage budget (default 300000)
 *   --stage=N        completed-pass target, 8 = settled latch (default 8)
 *   --dwell=MS       settled-latch hold time at stage 8 (default 1500)
 *   --draw=FRACTION  minimum non-backdrop screenshot share (default 0.005)
 *   --diff=FRACTION  minimum tiled/untiled structural difference (default 0.01)
 *   --outdir=PATH    PNG directory (default .playwright-mcp/tiling-ui)
 *
 * Exit 0 = every preset and authoring assertion passed.
 * Exit 1 = a scene/UI verdict failed.
 * Exit 2 = a CHECKING-side failure (bad arguments, browser/navigation/image
 *          decode, app boot, or missing instrumentation/control); rerun after
 *          correcting the checking environment.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.resolve(
  SCRIPT_DIR,
  "..",
  ".playwright-mcp",
  "tiling-ui",
);
const POLL_MS = 150;
const SETTLE_SAMPLES = 8;
const TARGET_PX = 44;
const NON_BACKDROP_TOLERANCE = 10;
const STRUCTURAL_DELTA = 12;
const OVERLAYS = [
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

const PRESETS = [
  {
    key: "tiledOctahedron",
    label: "Tiled Octahedron",
    group: "b3",
    x11Engine: "webgl",
  },
  {
    key: "tiledPentatope",
    label: "Tiled Pentatope",
    group: "a4",
    x11Engine: "compute",
  },
  {
    key: "tiledTwentyFourCell",
    label: "Tiled 24-Cell",
    group: "f4",
    x11Engine: "compute",
  },
];

class CheckingError extends Error {}

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    mode: "sw",
    viewport: "800x640",
    settle: 300_000,
    stage: SETTLE_SAMPLES,
    dwell: 1_500,
    draw: 0.005,
    diff: 0.01,
    outdir: DEFAULT_OUT_DIR,
  };
  for (const raw of argv) {
    if (!raw.startsWith("--"))
      throw new CheckingError(`unknown argument ${raw}`);
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    if (!(key in args)) throw new CheckingError(`unknown flag --${key}`);
    if (["settle", "stage", "dwell", "draw", "diff"].includes(key)) {
      args[key] = Number(value);
      if (!Number.isFinite(args[key])) {
        throw new CheckingError(`--${key} wants a finite number`);
      }
    } else if (key === "url") args.url = value.replace(/\/+$/, "");
    else args[key] = value;
  }
  if (args.mode !== "sw" && !args.mode.startsWith("x11:")) {
    throw new CheckingError(
      `--mode must be sw or x11:<display> (got ${args.mode})`,
    );
  }
  const viewport = /^(\d+)x(\d+)$/.exec(args.viewport);
  if (!viewport) {
    throw new CheckingError(`--viewport wants WxH (got ${args.viewport})`);
  }
  args.width = Number(viewport[1]);
  args.height = Number(viewport[2]);
  if (args.width <= 640 || args.height < 320) {
    throw new CheckingError(
      "--viewport must be at least 641px wide and 320px high",
    );
  }
  if (
    !Number.isInteger(args.stage) ||
    args.stage < 1 ||
    args.stage > SETTLE_SAMPLES
  ) {
    throw new CheckingError(`--stage must be an integer 1..${SETTLE_SAMPLES}`);
  }
  if (args.settle <= 0 || args.dwell < 0 || args.draw < 0 || args.diff < 0) {
    throw new CheckingError(
      "--settle must be positive; --dwell, --draw and --diff must be nonnegative",
    );
  }
  if (!args.url) throw new CheckingError("--url must not be empty");
  return args;
}

function launchOptions(mode) {
  const env = { ...process.env };
  const flags = [
    "--ignore-certificate-errors",
    "--ignore-gpu-blocklist",
    "--no-sandbox",
  ];
  if (mode.startsWith("x11:")) {
    env.DISPLAY = mode.slice(4);
    flags.push("--enable-unsafe-webgpu", "--enable-features=Vulkan");
    return { env, args: flags, headless: false };
  }
  delete env.DISPLAY;
  flags.push(
    "--enable-unsafe-webgpu",
    "--enable-unsafe-swiftshader",
    "--enable-features=Vulkan",
    "--use-webgpu-adapter=swiftshader",
    "--use-vulkan=swiftshader",
  );
  return { env, args: flags, headless: true };
}

function decodeHash(hash) {
  const match = /^#v1=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) throw new Error("location has no valid #v1= document");
  return JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
}

async function readDocument(page) {
  return decodeHash(await page.evaluate(() => window.location.hash));
}

async function waitForDocument(page, predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await readDocument(page);
      if (predicate(last)) return { ok: true, document: last };
    } catch {
      // The boot save and an edit's debounced save can leave the hash absent
      // for a short interval. The deadline distinguishes that from a failure.
    }
    await page.waitForTimeout(POLL_MS);
  }
  return { ok: false, document: last };
}

async function waitForHashChange(page, before, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hash = await page.evaluate(() => window.location.hash);
    if (hash && hash !== before) return true;
    await page.waitForTimeout(POLL_MS);
  }
  return false;
}

/** Capture the app's own Copy-link payload without depending on host
 * clipboard permissions. The override belongs to this document, which is all
 * this one-shot check needs; navigating to the captured link replaces it. */
async function copyShareLink(page, timeout = 15_000) {
  await page.evaluate(() => {
    delete window.__tilingShareLink;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__tilingShareLink = text;
        },
      },
    });
  });
  await openSection(page, "shareSection");
  await page.locator("#copyLinkBtn").click();
  await page.waitForFunction(
    () => typeof window.__tilingShareLink === "string",
    undefined,
    { timeout },
  );
  return page.evaluate(() => window.__tilingShareLink);
}

async function openApp(browser, args) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: args.width, height: args.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  try {
    await page.goto(`${args.url}/?surfacestate`, {
      waitUntil: "load",
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => {
        const count = document.getElementById("pointCount")?.textContent ?? "";
        return (
          typeof window.__surfaceState === "function" &&
          Number(count.replace(/[^\d]/g, "")) > 0
        );
      },
      undefined,
      { timeout: 60_000, polling: 100 },
    );
    const required = [
      "presetSelect",
      "tilingSection",
      "tilingEnabledCheckbox",
      "tilingGroup",
      "tilingClip",
      "tilingNote",
    ];
    const missing = await page.evaluate(
      (ids) => ids.filter((id) => document.getElementById(id) === null),
      required,
    );
    if (missing.length) {
      throw new CheckingError(
        `required controls missing: ${missing.join(", ")}`,
      );
    }
    return { context, page, pageErrors, consoleErrors };
  } catch (error) {
    await context.close().catch(() => {});
    if (error instanceof CheckingError) throw error;
    throw new CheckingError(
      `app boot failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function openSection(page, id) {
  const section = page.locator(`#${id}`);
  if ((await section.count()) !== 1) {
    throw new CheckingError(`missing panel section #${id}`);
  }
  if (!(await section.evaluate((element) => element.open))) {
    await section.locator(":scope > summary").click();
  }
  await page.waitForFunction(
    (sectionId) => document.getElementById(sectionId)?.open === true,
    id,
    { timeout: 5_000 },
  );
}

/** Choose a preset through the one-shot menu and wait for its debounced
 * document write. This does not enter Surface itself: a showcase's renderer
 * hint must perform that transition unaided. */
async function loadPreset(page, key) {
  await openSection(page, "presetSection");
  const before = await page.evaluate(() => window.location.hash);
  await page.locator("#presetSelect").selectOption(key);
  return waitForHashChange(page, before);
}

async function pollSurfaceStage(page) {
  return page.evaluate(() => {
    const probe = window.__surfaceState?.() ?? null;
    const row = document.getElementById("surfaceProgress");
    const rowText =
      row && !row.classList.contains("hidden") ? (row.textContent ?? "") : "";
    const pass = /antialiasing pass (\d+)\/(\d+)/.exec(rowText);
    const completed =
      pass && /Full detail/.test(rowText)
        ? Math.max(0, Number(pass[1]) - 1)
        : 0;
    const settled = Boolean(
      probe &&
      probe.mode === "surface" &&
      probe.firstFrame &&
      probe.settled &&
      !probe.previewActive &&
      !probe.settleActive &&
      !probe.settlePending,
    );
    return { probe, rowText, completed, settled };
  });
}

async function waitForSurfaceTarget(page, args) {
  const deadline = Date.now() + args.settle;
  let last = null;
  let heldSince = null;
  while (Date.now() < deadline) {
    last = await pollSurfaceStage(page);
    if (args.stage === SETTLE_SAMPLES) {
      if (last.settled) {
        heldSince ??= Date.now();
        if (Date.now() - heldSince >= args.dwell) {
          return { ok: true, state: last };
        }
      } else heldSince = null;
    } else if (
      last.probe?.mode === "surface" &&
      last.probe.firstFrame &&
      last.completed >= args.stage
    ) {
      return { ok: true, state: last };
    }
    if (
      last.probe &&
      last.probe.mode !== "points" &&
      last.probe.mode !== "surface"
    ) {
      break;
    }
    await page.waitForTimeout(POLL_MS);
  }
  return { ok: false, state: last };
}

async function visibleErrorText(page) {
  return page.evaluate(() =>
    ["#error", "#renderError"]
      .map((selector) => document.querySelector(selector))
      .filter((element) => {
        if (!element || element.classList.contains("hidden")) return false;
        const style = getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0
        );
      })
      .map((element) => element.textContent ?? "")
      .join(" ")
      .trim(),
  );
}

async function captureCanvas(page, args, name) {
  const priorVisibility = await page.evaluate((selectors) => {
    const prior = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        prior.push([selector, element.style.getPropertyValue("visibility")]);
        element.style.setProperty("visibility", "hidden", "important");
      }
    }
    return prior;
  }, OVERLAYS);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  );
  const canvas = page.locator("#container canvas").first();
  if ((await canvas.count()) !== 1)
    throw new CheckingError("main canvas missing");
  const png = await canvas.screenshot({ type: "png" });
  await page.evaluate(
    ({ selectors, prior }) => {
      let at = 0;
      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          const entry = prior[at++];
          if (entry?.[1]) {
            element.style.setProperty("visibility", entry[1]);
          } else {
            element.style.removeProperty("visibility");
          }
        }
      }
    },
    { selectors: OVERLAYS, prior: priorVisibility },
  );
  const metrics = await page.evaluate(
    async ({ base64, tolerance }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const width = 128;
      const height = Math.max(
        1,
        Math.round((image.naturalHeight / image.naturalWidth) * width),
      );
      const scratch = document.createElement("canvas");
      scratch.width = width;
      scratch.height = height;
      const context = scratch.getContext("2d");
      if (!context) throw new Error("2D screenshot decode context unavailable");
      context.drawImage(image, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      const pixel = (x, y) => {
        const at = (y * width + x) * 4;
        return [data[at], data[at + 1], data[at + 2]];
      };
      const corners = [
        pixel(0, 0),
        pixel(width - 1, 0),
        pixel(0, height - 1),
        pixel(width - 1, height - 1),
      ];
      let nonBackdrop = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = pixel(x, y);
          const backdrop = corners.some(
            (corner) =>
              Math.abs(corner[0] - p[0]) <= tolerance &&
              Math.abs(corner[1] - p[1]) <= tolerance &&
              Math.abs(corner[2] - p[2]) <= tolerance,
          );
          if (!backdrop) nonBackdrop++;
        }
      }
      return {
        coverage: nonBackdrop / (width * height),
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
    },
    { base64: png.toString("base64"), tolerance: NON_BACKDROP_TOLERANCE },
  );
  await mkdir(args.outdir, { recursive: true });
  await writeFile(path.join(args.outdir, `${name}.png`), png);
  return { metrics, png };
}

async function screenshotDiff(page, a, b) {
  return page.evaluate(
    async ({ a64, b64, threshold }) => {
      async function decode(base64) {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("2D screenshot diff context unavailable");
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      }
      const A = await decode(a64);
      const B = await decode(b64);
      if (A.width !== B.width || A.height !== B.height) {
        throw new Error(
          `screenshot size mismatch ${A.width}x${A.height} vs ${B.width}x${B.height}`,
        );
      }
      // Compare the canvas scene region rather than DOM chrome or the least
      // stable compositor edge band. Both frames use the identical live
      // camera; clearing tiling is the only document edit between them.
      const x0 = Math.floor(A.width * 0.05);
      const x1 = Math.ceil(A.width * 0.95);
      const y0 = Math.floor(A.height * 0.05);
      const y1 = Math.ceil(A.height * 0.95);
      let compared = 0;
      let structural = 0;
      let maxDelta = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const at = (y * A.width + x) * 4;
          const delta = Math.max(
            Math.abs(A.data[at] - B.data[at]),
            Math.abs(A.data[at + 1] - B.data[at + 1]),
            Math.abs(A.data[at + 2] - B.data[at + 2]),
          );
          compared++;
          if (delta > threshold) structural++;
          if (delta > maxDelta) maxDelta = delta;
        }
      }
      return {
        fraction: compared > 0 ? structural / compared : 0,
        structural,
        compared,
        maxDelta,
      };
    },
    {
      a64: a.toString("base64"),
      b64: b.toString("base64"),
      threshold: STRUCTURAL_DELTA,
    },
  );
}

async function runPresetLeg(browser, args, preset) {
  const app = await openApp(browser, args);
  const { context, page, pageErrors, consoleErrors } = app;
  const started = Date.now();
  try {
    const loaded = await loadPreset(page, preset.key);
    if (!loaded) {
      return { ok: false, preset, reason: "preset document never changed" };
    }
    const installed = await waitForDocument(
      page,
      (document) => document.tiling?.group === preset.group,
    );
    if (!installed.ok) {
      return {
        ok: false,
        preset,
        reason: `preset did not install ${preset.group.toUpperCase()}`,
      };
    }
    // Do not press #modeSurfaceBtn. PRESET_RENDER_HINTS owns this transition,
    // and the gate must fail if the saved renderer hint never reaches it.
    const target = await waitForSurfaceTarget(page, args);
    const state = target.state?.probe ?? null;
    const expectedEngine = args.mode.startsWith("x11:")
      ? preset.x11Engine
      : null;
    const enginePass =
      expectedEngine === null || state?.engine === expectedEngine;
    const document = await readDocument(page);
    const documentPass =
      document.tiling?.group === preset.group &&
      Object.prototype.hasOwnProperty.call(document.tiling, "kind") === false;
    const errorText = await visibleErrorText(page);
    let tiledCapture = null;
    if (state?.firstFrame) {
      tiledCapture = await captureCanvas(page, args, `${preset.key}-tiled`);
    }
    let untiledTarget = null;
    let untiledCapture = null;
    let distinctness = null;
    if (target.ok && tiledCapture !== null) {
      await openSection(page, "tilingSection");
      await page.locator("#tilingEnabledCheckbox").scrollIntoViewIfNeeded();
      await page.locator("#tilingEnabledCheckbox").focus();
      await page.locator("#tilingEnabledCheckbox").press("Space");
      const cleared = await waitForDocument(
        page,
        (next) => next.tiling === undefined,
      );
      if (cleared.ok) {
        untiledTarget = await waitForSurfaceTarget(page, args);
        if (untiledTarget.ok && untiledTarget.state?.probe?.firstFrame) {
          untiledCapture = await captureCanvas(
            page,
            args,
            `${preset.key}-untiled`,
          );
          distinctness = await screenshotDiff(
            page,
            tiledCapture.png,
            untiledCapture.png,
          );
        }
      }
    }
    const distinctPass =
      untiledTarget?.ok === true &&
      untiledCapture !== null &&
      untiledCapture.metrics.coverage >= args.draw &&
      distinctness !== null &&
      distinctness.fraction >= args.diff;
    const ok =
      target.ok &&
      state?.mode === "surface" &&
      state.firstFrame === true &&
      documentPass &&
      enginePass &&
      tiledCapture !== null &&
      tiledCapture.metrics.coverage >= args.draw &&
      distinctPass &&
      pageErrors.length === 0 &&
      consoleErrors.length === 0 &&
      errorText.length === 0;
    return {
      ok,
      preset,
      target,
      engine: state?.engine ?? null,
      backend: state?.backend ?? null,
      expectedEngine,
      documentPass,
      coverage: tiledCapture?.metrics.coverage ?? null,
      untiledCoverage: untiledCapture?.metrics.coverage ?? null,
      distinctness,
      elapsedMs: Date.now() - started,
      pageErrors,
      consoleErrors,
      errorText,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

function exact(value) {
  return JSON.stringify(value);
}

async function waitForExactTiling(page, wanted, timeout = 15_000) {
  return waitForDocument(
    page,
    (document) => exact(document.tiling) === exact(wanted),
    timeout,
  );
}

async function pressAndWaitTiling(page, selector, key, wanted) {
  const control = page.locator(selector);
  await control.scrollIntoViewIfNeeded();
  await control.focus();
  await control.press(key);
  return waitForExactTiling(page, wanted);
}

async function readActivationTargets(page) {
  return page.evaluate(
    ({ ids, minimum }) => {
      const panel = document.getElementById("panel");
      const panelRect = panel?.getBoundingClientRect() ?? null;
      return ids.map((id) => {
        const control = document.getElementById(id);
        if (!control) return { id, missing: true };
        const label = control.closest("label");
        const target = label ?? control;
        const rect = target.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(centerX, centerY);
        const hitPass =
          hit === target ||
          target.contains(hit) ||
          (label && label.contains(hit));
        const unclipped =
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= window.innerWidth &&
          rect.bottom <= window.innerHeight &&
          (!panelRect ||
            (rect.left >= panelRect.left &&
              rect.right <= panelRect.right &&
              rect.top >= panelRect.top &&
              rect.bottom <= panelRect.bottom));
        return {
          id,
          width: rect.width,
          height: rect.height,
          minimum,
          hitPass,
          unclipped,
          disabled: control.disabled,
        };
      });
    },
    {
      ids: ["tilingEnabledCheckbox", "tilingGroup", "tilingClip"],
      minimum: TARGET_PX,
    },
  );
}

async function waitForModeNote(page, buttonId, expression) {
  await page.locator(`#${buttonId}`).click();
  const deadline = Date.now() + 10_000;
  let note = "";
  while (Date.now() < deadline) {
    const state = await page.evaluate(
      ({ id }) => ({
        pressed:
          document.getElementById(id)?.getAttribute("aria-pressed") === "true",
        note: document.getElementById("tilingNote")?.textContent ?? "",
      }),
      { id: buttonId },
    );
    note = state.note;
    if (state.pressed && expression.test(note)) return { ok: true, note };
    await page.waitForTimeout(POLL_MS);
  }
  return { ok: false, note };
}

async function readDormantState(page, reason) {
  return page.evaluate((reasonText) => {
    const checkbox = document.getElementById("tilingEnabledCheckbox");
    const group = document.getElementById("tilingGroup");
    const clip = document.getElementById("tilingClip");
    const note = document.getElementById("tilingNote")?.textContent ?? "";
    return {
      checkboxEnabled:
        checkbox instanceof HTMLInputElement && !checkbox.disabled,
      checkboxChecked:
        checkbox instanceof HTMLInputElement && checkbox.checked === true,
      groupDisabled: group instanceof HTMLSelectElement && group.disabled,
      clipDisabled: clip instanceof HTMLSelectElement && clip.disabled,
      reasonPass: note.includes(reasonText),
      note,
    };
  }, reason);
}

async function runClearLeakLeg(browser, args) {
  const { context, page } = await openApp(browser, args);
  try {
    if (!(await loadPreset(page, "tiledOctahedron"))) {
      return { ok: false, reason: "tiled preset never changed the document" };
    }
    const tiled = await waitForDocument(
      page,
      (document) => document.tiling?.group === "b3",
    );
    if (!tiled.ok) {
      return { ok: false, reason: "tiled preset never installed B3" };
    }
    if (!(await loadPreset(page, "default"))) {
      return {
        ok: false,
        reason: "ordinary preset never changed the document",
      };
    }
    const cleared = await waitForDocument(
      page,
      (document) => document.tiling === undefined,
    );
    return {
      ok: cleared.ok,
      reason: cleared.ok
        ? "ordinary preset cleared the previous finite block"
        : `ordinary preset retained ${exact(cleared.document?.tiling)}`,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function runAuthoringLeg(browser, args) {
  const { context, page, pageErrors, consoleErrors } = await openApp(
    browser,
    args,
  );
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  try {
    await openSection(page, "tilingSection");

    const enabled = await pressAndWaitTiling(
      page,
      "#tilingEnabledCheckbox",
      "Space",
      { group: "a3" },
    );
    check(
      "keyboard toggle",
      enabled.ok,
      enabled.ok ? "Space authored A3" : "Space did not author A3",
    );
    if (!enabled.ok) return { ok: false, checks, pageErrors, consoleErrors };

    await page.locator("#tilingClip").scrollIntoViewIfNeeded();
    const targets = await readActivationTargets(page);
    for (const target of targets) {
      const ok =
        !target.missing &&
        !target.disabled &&
        target.width >= TARGET_PX &&
        target.height >= TARGET_PX &&
        target.hitPass &&
        target.unclipped;
      check(
        `${target.id} target`,
        ok,
        target.missing
          ? "missing"
          : `${target.width.toFixed(1)}x${target.height.toFixed(1)}px, ` +
              `hit=${target.hitPass}, unclipped=${target.unclipped}`,
      );
    }

    const grouped = await pressAndWaitTiling(
      page,
      "#tilingGroup",
      "ArrowDown",
      { group: "b3" },
    );
    check(
      "keyboard group",
      grouped.ok,
      grouped.ok ? "ArrowDown changed A3 to B3" : "group did not become B3",
    );

    const clipBefore = await page.locator("#tilingClip").inputValue();
    await page.locator("#tilingClip").focus();
    await page.locator("#tilingClip").press("ArrowDown");
    const clipped = await waitForDocument(
      page,
      (document) =>
        document.tiling?.group === "b3" && document.tiling.clip !== undefined,
    );
    const clipAfter = await page.locator("#tilingClip").inputValue();
    const groupOnly = { group: "b3" };
    const groupAndClip = clipped.document?.tiling;
    check(
      "keyboard clip",
      clipped.ok && clipAfter !== "" && clipAfter !== clipBefore,
      clipped.ok
        ? `ArrowDown selected ${clipAfter}; chamber remained B3`
        : "clip was not authored independently of B3",
    );

    if (clipped.ok) {
      await page.locator("#tilingClip").press("Control+z");
      const undoClip = await waitForExactTiling(page, groupOnly);
      check(
        "undo clip",
        undoClip.ok,
        undoClip.ok
          ? "restored exact group-only object"
          : "did not restore B3-only",
      );
      await page.keyboard.press("Control+z");
      const undoGroup = await waitForExactTiling(page, { group: "a3" });
      check(
        "undo group",
        undoGroup.ok,
        undoGroup.ok ? "restored exact A3 object" : "did not restore A3",
      );
      await page.keyboard.press("Control+Shift+z");
      const redoGroup = await waitForExactTiling(page, groupOnly);
      check(
        "redo group",
        redoGroup.ok,
        redoGroup.ok
          ? "restored exact B3-only object"
          : "did not restore B3-only",
      );
      await page.keyboard.press("Control+Shift+z");
      const redoClip = await waitForExactTiling(page, groupAndClip);
      check(
        "redo clip",
        redoClip.ok,
        redoClip.ok
          ? "restored exact B3-plus-clip object"
          : "did not restore exact B3-plus-clip object",
      );

      const shareLink = await copyShareLink(page);
      const validShareLink = shareLink.includes("#v1=");
      await page.goto(shareLink, { waitUntil: "load", timeout: 60_000 });
      await page.waitForFunction(
        () => {
          const count =
            document.getElementById("pointCount")?.textContent ?? "";
          return Number(count.replace(/[^\d]/g, "")) > 0;
        },
        undefined,
        { timeout: 60_000 },
      );
      const reloaded = await waitForExactTiling(page, groupAndClip);
      check(
        "copied-link reload",
        validShareLink && reloaded.ok,
        validShareLink && reloaded.ok
          ? "app-copied link restored the exact B3-plus-clip object"
          : "app-copied link was invalid or changed/lost its tiling object",
      );
    }

    await openSection(page, "tilingSection");
    const modeChecks = [
      ["modePointsBtn", /Points shows the untiled attractor/],
      ["modeFlameBtn", /Flame shows the untiled attractor/],
      ["modeSolidBtn", /Solid shows the untiled attractor/],
    ];
    for (const [button, expression] of modeChecks) {
      const mode = await waitForModeNote(page, button, expression);
      check(
        `${button} disclosure`,
        mode.ok,
        mode.note || "adjacent tiling note stayed empty",
      );
      if (button !== "modePointsBtn") {
        await waitForModeNote(
          page,
          "modePointsBtn",
          /Points shows the untiled attractor/,
        );
      }
    }

    await openSection(page, "balloonSection");
    await page.locator("#balloonEchoCheckbox").focus();
    await page.locator("#balloonEchoCheckbox").press("Space");
    const balloonAuthored = await waitForDocument(
      page,
      (document) => document.balloonEcho === true,
    );
    await openSection(page, "tilingSection");
    const balloon = await readDormantState(page, "Unavailable with Balloon");
    check(
      "Balloon dormant details",
      balloonAuthored.ok &&
        balloon.checkboxEnabled &&
        balloon.checkboxChecked &&
        balloon.groupDisabled &&
        balloon.clipDisabled &&
        balloon.reasonPass,
      balloon.note,
    );
    await page.locator("#tilingEnabledCheckbox").focus();
    await page.locator("#tilingEnabledCheckbox").press("Space");
    const balloonClear = await waitForDocument(
      page,
      (document) =>
        document.tiling === undefined && document.balloonEcho === true,
    );
    check(
      "Balloon clear recovery",
      balloonClear.ok,
      balloonClear.ok
        ? "enabled checkbox cleared tiling without clearing Balloon"
        : "checkbox did not clear the dormant tiling block",
    );

    await openSection(page, "balloonSection");
    await page.locator("#balloonEchoCheckbox").focus();
    await page.locator("#balloonEchoCheckbox").press("Space");
    await waitForDocument(page, (document) => document.balloonEcho !== true);
    await openSection(page, "tilingSection");
    const reenabled = await pressAndWaitTiling(
      page,
      "#tilingEnabledCheckbox",
      "Space",
      { group: "a3" },
    );
    check(
      "re-enable for Symmetry",
      reenabled.ok,
      reenabled.ok
        ? "restored a finite block"
        : "could not restore finite tiling",
    );
    await openSection(page, "symmetrySection");
    await page.locator("#symmetryOrderSlider").focus();
    await page.locator("#symmetryOrderSlider").press("ArrowRight");
    const symmetryAuthored = await waitForDocument(
      page,
      (document) => document.symmetry?.order === 2,
    );
    await openSection(page, "tilingSection");
    const symmetry = await readDormantState(page, "Unavailable with Symmetry");
    check(
      "Symmetry dormant details",
      symmetryAuthored.ok &&
        symmetry.checkboxEnabled &&
        symmetry.checkboxChecked &&
        symmetry.groupDisabled &&
        symmetry.clipDisabled &&
        symmetry.reasonPass,
      symmetry.note,
    );
    await page.locator("#tilingEnabledCheckbox").focus();
    await page.locator("#tilingEnabledCheckbox").press("Space");
    const symmetryClear = await waitForDocument(
      page,
      (document) =>
        document.tiling === undefined && document.symmetry?.order === 2,
    );
    check(
      "Symmetry clear recovery",
      symmetryClear.ok,
      symmetryClear.ok
        ? "enabled checkbox cleared tiling without clearing Symmetry"
        : "checkbox did not clear the dormant tiling block",
    );

    check(
      "page errors",
      pageErrors.length === 0,
      pageErrors.length ? pageErrors.join(" | ") : "none",
    );
    check(
      "console errors",
      consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.join(" | ") : "none",
    );
    return {
      ok: checks.every((entry) => entry.ok),
      checks,
      pageErrors,
      consoleErrors,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

function printPreset(result) {
  const coverage =
    result.coverage === null || result.coverage === undefined
      ? "n/a"
      : `${(result.coverage * 100).toFixed(2)}%`;
  const backend = result.backend
    ? `${result.backend.software ? "software" : "hardware"}:${result.backend.label ?? "?"}`
    : "n/a";
  const expected = result.expectedEngine ?? "reported-only";
  const difference = result.distinctness
    ? `${(result.distinctness.fraction * 100).toFixed(2)}%`
    : "n/a";
  process.stdout.write(
    `${result.ok ? "PASS" : "FAIL"}  ${result.preset.label.padEnd(20)} ` +
      `group=${result.preset.group.toUpperCase()} ` +
      `engine=${result.engine ?? "none"}/${expected} ` +
      `drawn=${coverage} tiled/untiled=${difference} backend=${backend} ` +
      `time=${((result.elapsedMs ?? 0) / 1000).toFixed(1)}s` +
      `${result.reason ? ` — ${result.reason}` : ""}\n`,
  );
  for (const error of result.pageErrors ?? []) {
    process.stdout.write(`  page error: ${error}\n`);
  }
  for (const error of result.consoleErrors ?? []) {
    process.stdout.write(`  console error: ${error}\n`);
  }
  if (result.errorText)
    process.stdout.write(`  app error: ${result.errorText}\n`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const launch = launchOptions(args.mode);
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    ...launch,
  });
  let failed = false;
  try {
    process.stdout.write(
      `[tiling-ui] mode=${args.mode}, viewport=${args.width}x${args.height}, ` +
        `target=${args.stage === SETTLE_SAMPLES ? "settled" : `${args.stage}/${SETTLE_SAMPLES} completed passes`}\n`,
    );
    for (const preset of PRESETS) {
      const result = await runPresetLeg(browser, args, preset);
      printPreset(result);
      if (!result.ok) failed = true;
    }

    const clear = await runClearLeakLeg(browser, args);
    process.stdout.write(
      `${clear.ok ? "PASS" : "FAIL"}  absent-means-clear — ${clear.reason}\n`,
    );
    if (!clear.ok) failed = true;

    const authoring = await runAuthoringLeg(browser, args);
    for (const result of authoring.checks) {
      process.stdout.write(
        `${result.ok ? "PASS" : "FAIL"}  ${result.name} — ${result.detail}\n`,
      );
    }
    if (!authoring.ok) failed = true;
  } finally {
    await browser.close().catch(() => {});
  }
  process.exit(failed ? 1 : 0);
}

run().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[tiling-ui] ${message}\n`);
  process.exit(error instanceof CheckingError ? 2 : 2);
});
