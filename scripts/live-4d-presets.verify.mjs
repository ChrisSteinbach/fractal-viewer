#!/usr/bin/env node
/**
 * THE LIVE-SITE 4D PRESET SWEEP — the six 4D presets the escape4/fold4 work
 * added (mandelboxBrick, mandelboxColumn, hybridChainShells,
 * turnedShells, brickRosette, hyperkifs), driven FROM THE MENU on a target
 * origin — the deployed site by default, `npm run preview` under
 * `npm run verify`'s forwarding.
 *
 * WHY THIS EXISTS. The post-deploy sweep that first certified the six on
 * the live deployment (2026-09-28, headless SwiftShader-Chromium with
 * WebGPU flags) settled five and watched hyperkifs time out at its
 * seven-minute window with the pane still reading
 * "Full detail · WebGPU (software) 0%" — hyperkifs is the one preset that
 * routes to the 16-map 4D fold kernel, whose per-query cost dominates a
 * software adapter, and the sweep's window was not
 * minutes-per-frame-patient. Not a deployment defect: the same preset
 * settles in ~a minute on the real driver (rdna-3, verified pre-merge),
 * and the live site serves it. What that sweep left behind is the gap
 * this script closes: a standing leg for the one preset the standing
 * post-deploy check could not carry, plus the sweep for the other five.
 *
 * WHAT IT ASKS, per preset, of a session it drives FROM THE MENU (a
 * fresh context each — the live origin's first-visit isolation reload is
 * waited out once per preset, see openApp):
 *
 *   1. the preset LOADS (the document hash changes — edit-session.ts
 *      debounces that save, so the hash is the only reliable "it landed"),
 *      and Surface ACCEPTS it (a preset whose system its own gate refuses
 *      leaves the button dark, and nothing below the UI says so);
 *   2. the session ENTERS COMPUTE (`__surfaceState().engine === "compute"`)
 *      — asserted on BOTH arms, and the load-bearing one for the live
 *      site: the four 4D fold/escape kernels are compute-only, so
 *      `engine: "webgl"` here means the deployed routing fell back and the
 *      kernel the preset exists to exercise is dead code on the served
 *      bundle. SwiftShader compute is still compute ("compute, software"
 *      — true, and exactly the answer the routing question needs);
 *   3. its FIRST FRAME lands (`__surfaceState().firstFrame`, past the
 *      compile/pipeline gate — until then the canvas still shows the
 *      explorer) and the pane DRAWS (the share of pixels differing from
 *      the frame's own corner backdrop, the blank-frame evidence, read
 *      engine-agnostically);
 *   4. THE SETTLE, arm-conditional — the acceptance line's either/or:
 *       - `--mode=x11:<display>` (the real driver): asserted within the
 *         budget. This is the arm the original evidence came from and the
 *         one that polices a settle regression.
 *       - `--mode=sw` (SwiftShader, the CI arm): DISCLOSED, never
 *         asserted. MEASURED on this box (AMD RX 7900 XTX, SwiftShader
 *         compute, 2026-10-14, LIVE origin, `?surfacemaxrays=163840
 *         &surfacesamples=1`): first frames 0.8 s on the five lighter
 *         presets and 7.6 s on hyperkifs, whose settle had still not
 *         completed at 16 minutes — so a settle assertion on a software
 *         adapter is not a gate any CI budget carries (the full pane, the
 *         original sweep's setting, is ~4x that raster). The five land
 *         settle rows on a green run (their fast-tier settles measured
 *         1.5-1.8 s); hyperkifs exits at the disclosed grace with the row
 *         naming its state. A settle that used to land and stopped is
 *         visible in the row; a change that breaks hyperkifs' ROUTING or
 *         first frame fails the run outright, which is the regression the
 *         live deployment actually fears. THE SETTLE REGRESSION GATE IS
 *         THE REAL-DRIVER ARM: MEASURED the same day on radeonsi
 *         (`--mode=x11::0`, full tier, LIVE origin): all six PASS, first
 *         frames at or under 1.0 s, settles 1.6-1.8 s on the five and
 *         73.6 s on hyperkifs — the bead's own "~a minute on the real
 *         driver" record, reproduced on the standing leg.
 *
 * USAGE:
 *   node scripts/live-4d-presets.verify.mjs --mode=x11::0        # real driver
 *   node scripts/live-4d-presets.verify.mjs --mode=sw            # SwiftShader
 *   node scripts/live-4d-presets.verify.mjs --mode=sw --only=hyperkifs
 *   node scripts/live-4d-presets.verify.mjs --url=https://localhost:4173 --mode=sw
 *   flags: --mode=x11:<display>|sw   --url=<origin>   --settle=<ms>
 *          --only=<presetKey>   --tier=fast|full
 *
 * `--settle=` is a measurement override: it replaces BOTH arms' leg
 * budgets when given (re-measuring a wall wants the same knob on both
 * sides); absent, each arm applies its own default — the real driver's
 * settle budget (240 s) or the SwiftShader arm's disclosed window
 * (7 minutes, the original sweep's own). `--tier=fast` pins the app's
 * own page-load overrides
 * (`?surfacemaxrays` + `?surfacesamples=1`, scripts/lib/fast-tier.mjs) on
 * every leg — the raster shrinks, the page and the menu choreography do
 * not, and every verdict line discloses the tier. A LOCAL run refuses a
 * stale bundle (exit 2) rather than measuring the previous build behind
 * `npm run preview`; a REMOTE `--url` skips that check, since this
 * checkout's dist/ says nothing about a deployed origin
 * (scripts/lib/dist-freshness.mjs).
 *
 * Exit 0 = every leg passed its arm's assertions. Exit 3 = a preset leg
 * FAILED one (the numbers are printed per leg either way). Exit 1 = a
 * harness/setup failure. Exit 2 = a checking-side inconclusive (the
 * browser never launched) — the one code a CI retry ladder may rerun on,
 * live-site.verify.mjs's convention.
 */

import { guardFreshDist } from "./lib/dist-freshness.mjs";
import { launchSurfaceBrowser } from "./lib/surface-browser-runner.mjs";
import { parseTierArg, tierLabel, tierUrlParams } from "./lib/fast-tier.mjs";

const LIVE_URL = "https://fractal-4d.com";

/** The sweep's viewport — the surface gates' convention (the lift/slab
 * gates' own), so the settle walls across the gates read side by side. */
const VIEWPORT = { width: 1024, height: 640 };

/** The real-driver arm's settle budget per leg. escape-family's own
 * default, sized to the slower preset's measured wall on a real driver
 * with margin — hyperkifs measured 73.6 s at this viewport on radeonsi
 * (the header's record), 240 s is the margin. */
const X11_SETTLE_MS = 240_000;

/** The SwiftShader arm's disclosed window per leg — the original
 * sweep's own 7-minute window, disclosed multi-minute exactly as the
 * acceptance line asks. The leg may exit earlier (below). */
const SW_LEG_WINDOW_MS = 420_000;

/** The SwiftShader arm's post-assertions settle grace: how long a leg
 * whose assertions all hold keeps waiting for its settle before exiting
 * with the settle row's state. Sized for the five lighter presets'
 * fast-tier settles to land (their original full-tier settles fit the
 * original sweep's 7-minute window together); hyperkifs' measured
 * SwiftShader wall exceeds it and exits at the grace with the disclosed
 * row. Measured fast-tier walls (2026-10-14, this box) in the header. */
const SW_SETTLE_GRACE_MS = 150_000;

/**
 * The six 4D presets, in menu order — the exact set the 2026-09-28 live
 * sweep covered ("five of the six"). All six carry `PRESET_RENDER_HINTS`
 * entries routing them to Surface, so a user's first contact with each is
 * load-one-and-press-Surface, which is the choreography below.
 */
const PRESETS_4D = [
  {
    key: "mandelboxBrick",
    what: "mandelboxCube turned 1 rad in xw — the brick, the escape4 kernel's headline preset",
  },
  {
    key: "mandelboxColumn",
    what: "the same map turned in yw instead — the rotation plane picks the long axis",
  },
  {
    key: "hybridChainShells",
    what: "hybridChainQuaternion with the rotation on its POWER link — the one position that costs no rays",
  },
  {
    key: "turnedShells",
    what: "the 4D fold frontier's shell showcase (16 maps, fold4)",
  },
  {
    key: "brickRosette",
    what: "the 4D fold frontier's rosette (16 maps, fold4)",
  },
  {
    key: "hyperkifs",
    what: "hyperboxKIFS — the 16-map 4D fold kernel, the leg whose SwiftShader wall the original sweep's window was too small for",
  },
];

const NON_BACKDROP_TOL = 10;
const MIN_COVERAGE = 0.005;

function parseArgs(argv) {
  const args = {
    url: LIVE_URL,
    mode: "sw",
    settle: null,
    only: undefined,
    tier: parseTierArg(argv),
  };
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      throw new Error(`Unrecognized argument: ${raw} (flags start with --)`);
    }
    const eq = raw.indexOf("=");
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    switch (key) {
      case "url":
        args.url = value.replace(/\/+$/, "");
        break;
      case "mode":
        args.mode = value;
        break;
      case "settle":
        args.settle = Number(value);
        break;
      // --settle is a measurement override: when given it replaces BOTH
      // arms' budgets (a gate author re-measuring a wall wants the same
      // knob on both sides); absent, each arm applies its own default.
      case "only":
        args.only = value;
        break;
      case "tier":
        break; // consumed by parseTierArg
      default:
        throw new Error(`Unknown flag: --${key}`);
    }
  }
  if (args.mode !== "sw" && !args.mode.startsWith("x11:")) {
    throw new Error(`--mode must be sw or x11:<display> (got ${args.mode})`);
  }
  if (
    args.settle !== null &&
    (!Number.isFinite(args.settle) || args.settle <= 0)
  ) {
    throw new Error(`--settle must be a positive number`);
  }
  return args;
}

/** Load the app fresh, with the settle latch published. A LIVE origin
 * reloads once for cross-origin isolation (register-sw.ts): the first
 * visit registers the service worker, then the page reloads to come back
 * under COOP/COEP. Wait it out ONCE here so every later evaluate sees a
 * stable document — escape-family's own openApp dance. */
async function openApp(browser, args) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: VIEWPORT,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error") {
      process.stderr.write(`[page:error] ${text}\n`);
      consoleErrors.push(text);
    }
  });
  page.on("pageerror", (err) => {
    const text =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`[page:uncaught] ${text}\n`);
    consoleErrors.push(text);
  });
  // The tier's own page-load params ride EVERY leg (fast pins the ray cap
  // and one antialiasing pass; full adds none) — the tier label in the
  // verdict lines must name what the page actually rendered.
  const query = new URLSearchParams({
    surfacestate: "1",
    ...tierUrlParams(args.tier),
  });
  await page.goto(`${args.url}/?${query}`, { waitUntil: "load" });
  await waitForProbe(page);
  await page
    .waitForFunction(() => window.crossOriginIsolated === true, undefined, {
      timeout: 15_000,
    })
    .catch(() => {
      // Not every deployment is isolated; npm run preview serves the
      // headers already. The point was only to be past the reload if one
      // was coming.
    });
  await waitForProbe(page);
  return { context, page, consoleErrors };
}

/** Wait for `?surfacestate`'s probe, retrying once across the isolation
 * reload's own navigation (an evaluate killed by the document swap). */
async function waitForProbe(page) {
  const ask = () =>
    page.waitForFunction(() => typeof window.__surfaceState === "function", {
      timeout: 30_000,
    });
  try {
    await ask();
  } catch (error) {
    if (
      !/Execution context was destroyed|frame was detached/i.test(String(error))
    ) {
      throw error;
    }
    await page.waitForLoadState("load").catch(() => {});
    await ask();
  }
}

/** Choose a preset from the panel's menu — the path a user takes, and the
 * one that runs main.ts's onPreset handler with its side tables. The
 * document-hash change is the "it landed" signal (see the header). */
async function loadPreset(page, key) {
  const shape = await page.evaluate(() => {
    const sel = document.getElementById("presetSelect");
    if (!sel) return { found: false };
    const details = sel.closest("details");
    if (details && !details.open) details.open = true;
    const r = sel.getBoundingClientRect();
    return { found: true, w: r.width, h: r.height };
  });
  if (!shape.found || shape.w === 0 || shape.h === 0) {
    throw new Error(`preset menu unreachable: ${JSON.stringify(shape)}`);
  }
  const before = await page.evaluate(() => location.hash);
  await page.selectOption("#presetSelect", key);
  await page
    .waitForFunction(
      (h) => location.hash !== h && location.hash !== "",
      before,
      { timeout: 15_000 },
    )
    .catch(() => {
      throw new Error(
        `preset ${key}: the document never changed after loading`,
      );
    });
}

/** Enter Surface mode from the mode button, refusing to pretend a disabled
 * button is a pass — a dark button is precisely the reported symptom. */
async function enterSurface(page) {
  const disabled = await page.getAttribute("#modeSurfaceBtn", "disabled");
  const title = await page.getAttribute("#modeSurfaceBtn", "title");
  if (disabled !== null) return { entered: false, reason: title ?? "disabled" };
  await page.click("#modeSurfaceBtn");
  return { entered: true, reason: null };
}

/** Poll the settle latch until the leg may end, recording when firstFrame
 * flipped. A multi-minute leg prints a heartbeat line every 30 s —
 * a silent poll is indistinguishable from a stuck one.
 *
 * THE END CONDITIONS ARE ARM-CONDITIONAL (the header's point 4):
 *   - real driver: the leg ends on SETTLED or at the budget — the settle
 *     is the asserted claim, so the leg must actually see it.
 *   - SwiftShader: the leg ends on settled too, but may also exit early
 *     once every asserted predicate has held AND the disclosed settle
 *     grace has elapsed since they did — the settle is disclosed there,
 *     not asserted, and waiting the full window for a wall that measures
 *     past 16 minutes at even the fast tier would spend CI on a row the
 *     arm never gates on.
 *
 * Returns the final probe, the first-frame wall and the total wall. */
async function awaitSession(page, budgetMs, label, x11) {
  const start = Date.now();
  let firstFrameMs = null;
  let assertionsHeldAt = null;
  let state = null;
  let lastBeat = 0;
  while (Date.now() - start < budgetMs) {
    state = await page.evaluate(() => window.__surfaceState?.() ?? null);
    if (state && state.mode !== "surface") break;
    if (state && state.firstFrame && firstFrameMs === null) {
      firstFrameMs = Date.now() - start;
      console.error(
        `[live-4d-presets] ${label}: FIRST FRAME at ${(firstFrameMs / 1000).toFixed(1)}s`,
      );
    }
    if (state && state.settled) break;
    if (!x11 && state && state.firstFrame && assertionsHeldAt === null) {
      // The asserted predicates but the settle have held (the engine is
      // read at leg end); this moment starts the disclosed grace.
      assertionsHeldAt = Date.now();
    }
    if (
      !x11 &&
      assertionsHeldAt !== null &&
      Date.now() - assertionsHeldAt >= SW_SETTLE_GRACE_MS
    ) {
      break;
    }
    const now = Date.now() - start;
    if (now - lastBeat >= 30_000) {
      lastBeat = now;
      console.error(
        `[live-4d-presets] ${label}: waiting... ${(now / 1000).toFixed(0)}s ` +
          `firstFrame=${String(Boolean(state?.firstFrame))} settled=${String(Boolean(state?.settled))}`,
      );
    }
    await page.waitForTimeout(250);
  }
  return {
    state,
    firstFrameMs,
    settled: Boolean(state && state.settled),
    wallMs: Date.now() - start,
  };
}

/** Share of canvas pixels that differ from the frame's own corners —
 * engine-agnostic, the same question the blank-frame notice asks of its
 * hit counts (surface-4d-lift's frameCoverage). */
async function frameCoverage(page, shot) {
  return page.evaluate(
    async ({ bytes, tol }) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      const w = 128;
      const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w));
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const at = (x, y) => {
        const i = (y * w + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      };
      const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
      let n = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = at(x, y);
          const backdrop = corners.some(
            (c) =>
              Math.abs(c[0] - p[0]) <= tol &&
              Math.abs(c[1] - p[1]) <= tol &&
              Math.abs(c[2] - p[2]) <= tol,
          );
          if (!backdrop) n++;
        }
      }
      return n / (w * h);
    },
    { bytes: Array.from(shot), tol: NON_BACKDROP_TOL },
  );
}

async function canvasShot(page) {
  const canvas = await page.$("canvas");
  if (!canvas) return null;
  return canvas.screenshot({ type: "png" });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  await guardFreshDist({ url: args.url });
  const x11 = args.mode.startsWith("x11:");
  const budgetFor = (preset) =>
    args.settle ?? (x11 ? X11_SETTLE_MS : SW_LEG_WINDOW_MS);
  const wanted = args.only
    ? PRESETS_4D.filter((p) => p.key === args.only)
    : PRESETS_4D;
  if (wanted.length === 0) {
    throw new Error(`unknown --only ${args.only} (not in the 4D sweep's six)`);
  }
  console.error(
    `[live-4d-presets] target: ${args.url} mode=${args.mode} tier=${tierLabel(args.tier)} ` +
      `window=${((args.settle ?? (x11 ? X11_SETTLE_MS : SW_LEG_WINDOW_MS)) / 1000).toFixed(0)}s ` +
      `settle=${x11 ? "ASSERTED" : "disclosed (grace " + SW_SETTLE_GRACE_MS / 1000 + "s)"}`,
  );
  let browser = null;
  let failed = false;
  // A browser that never launched is a CHECKING-side failure (exit 2 —
  // the one code a CI retry ladder may rerun on), not a site verdict.
  try {
    browser = await launchSurfaceBrowser(args.mode);
  } catch (err) {
    process.stderr.write(
      `[live-4d-presets] browser launch failed: ${err instanceof Error ? err.message : String(err)}\n` +
        "[live-4d-presets] VERDICT: INCONCLUSIVE — checking side failed, rerun.\n",
    );
    process.exit(2);
  }
  try {
    for (const preset of wanted) {
      const { context, page, consoleErrors } = await openApp(browser, args);
      try {
        await loadPreset(page, preset.key);
        const entry = await enterSurface(page);
        if (!entry.entered) {
          failed = true;
          process.stdout.write(
            `FAIL  ${preset.key.padEnd(20)} NOT ENTERED — Surface button refused: ${entry.reason}\n  ${preset.what}\n`,
          );
          continue;
        }
        await page.bringToFront();
        const session = await awaitSession(
          page,
          budgetFor(preset),
          preset.key,
          x11,
        );
        const state = session.state;
        const engine = state ? state.engine : null;
        const exited = Boolean(state && state.mode !== "surface");
        const shot = await canvasShot(page);
        const drawn = shot && !exited ? await frameCoverage(page, shot) : null;
        const enteredCompute = engine === "compute";
        const firstFrame = Boolean(state && state.firstFrame);
        const drew = drawn !== null && drawn > MIN_COVERAGE;
        // THE SETTLE ASSERTION IS ARM-CONDITIONAL — see the header's
        // point 4: asserted on the real driver, disclosed on SwiftShader
        // (its measured wall is past any CI budget; the rows carry it).
        const settleOk = x11 ? session.settled : true;
        const settleNote = session.settled
          ? `settled ${(session.wallMs / 1000).toFixed(1) + "s"}`
          : `NOT settled at ${(session.wallMs / 1000).toFixed(1) + "s"}` +
            (x11
              ? ""
              : " (the SwiftShader wall — asserted on the real-driver arm only)");
        const ok = enteredCompute && firstFrame && drew && settleOk && !exited;
        if (!ok) failed = true;
        process.stdout.write(
          `${ok ? "PASS" : "FAIL"}  ${preset.key.padEnd(20)} ` +
            `tier=${tierLabel(args.tier)} ` +
            `engine=${String(engine).padEnd(8)} (want compute) ` +
            `firstFrame=${String(firstFrame).padEnd(5)} ` +
            `@${session.firstFrameMs === null ? "n/a" : (session.firstFrameMs / 1000).toFixed(1) + "s"} ` +
            `${settleNote} ` +
            `drawn=${drawn === null ? "n/a" : (drawn * 100).toFixed(1) + "%"}` +
            `${exited ? "  SESSION EXITED" : ""}\n  ${preset.what}\n`,
        );
        if (consoleErrors.length > 0) {
          failed = true;
          process.stdout.write(
            `FAIL  ${preset.key.padEnd(20)} console — ${consoleErrors.slice(0, 3).join(" | ")}\n`,
          );
        }
      } finally {
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  console.error(
    `[live-4d-presets] ======== SUMMARY ========` +
      `\n[live-4d-presets] target: ${args.url}  mode=${args.mode}  tier=${tierLabel(args.tier)}` +
      `\n[live-4d-presets] VERDICT: ${failed ? "FAIL" : "PASS"}`,
  );
  process.exit(failed ? 3 : 0);
}

run().catch((err) => {
  process.stderr.write(
    `[live-4d-presets] ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exitCode = 1;
});
