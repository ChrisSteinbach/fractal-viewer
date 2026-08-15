/**
 * fr-uec4: the regression gate for the WebGPU compute surface renderer's
 * teardown race. Renamed from fold-floor-crash.repro.mjs once the real
 * defect was found — see "WHY NOT fold-floor-ANYTHING" below — so this file
 * no longer hunts for a cause, it PINS the fix against ever regressing.
 *
 * EXIT CODES: 0 = swept clean, no crash — the gate passes. 3 = reproduced,
 * the browser died mid-sweep — the regression is back. 1 = harness failure
 * (a Playwright/launch problem unrelated to the invariant under test).
 *
 * INVARIANT PROTECTED: tearing down or restarting `SurfaceComputeRenderer`
 * (src/app/surface-compute.ts) while a frame is still parked on live
 * submitted GPU work — a `mapAsync` over a submitted `copyBufferToBuffer`,
 * or `onSubmittedWorkDone` over a submitted dispatch — must never crash the
 * browser. Before the fix, `destroy()` called `this.device.destroy()`
 * synchronously regardless of in-flight work, which took down the WHOLE
 * Firefox process: every context, not a tab crash and not a device-loss
 * toast, and Playwright's next `evaluate` finds the browser gone. WebGL is
 * unaffected — measured, both natively and with the same fold-lens system
 * forced onto it via ?surfacegl. Whether other WebGPU implementations
 * crashed too was never tested: this gate drives Firefox because that is
 * where the report came from, and "Firefox-only" is an untested claim, not
 * a finding. Destroying a device under a parked `mapAsync` is wrong on any
 * implementation, which is why the fix is not conditioned on one. The fix defers the
 * real `device.destroy()` until every in-flight frame unwinds (a
 * `framesInFlight` counter incremented in `renderFrame` and released in a
 * `.finally`), while keeping the synchronous teardown path when the device
 * IS idle.
 *
 * WHY NOT fold-floor-ANYTHING: the field report read "adjust Min Radius /
 * Fixed Radius / Box Limit together with the Floor option until it goes",
 * which pointed straight at fr-s9ll's authored fold radii and fr-rhn5's
 * Floor option. Both were coincidence, and both were disproved before the
 * real defect surfaced:
 *
 *   - The RADII are innocent. Classic (unauthored) lengths crash exactly as
 *     readily as any slider position, and the CPU sweep in
 *     scripts/fold-radii-seam.harness.ts finds nothing wrong with the
 *     estimator anywhere the sliders can reach.
 *   - The FLOOR is not special. --toggleId=surfaceBalloonCheckbox kills it
 *     the same way, and so does simply LEAVING Surface mode. Floor and
 *     Balloon are just the only two document edits reachable from INSIDE a
 *     surface session — #explorerControls, and with it the transform list
 *     carrying the radius sliders, is points-mode only — so a user "playing
 *     about" in Surface mode has exactly these two switches to hand, and
 *     both restart the renderer the same way a mode exit does.
 *
 * MEASURED, real Firefox 151, DISPLAY=:0, dom.webgpu.enabled, dev server, a
 * Sierpinski tetrahedron with a pure-mandelbox FINAL transform (fr-g58b's
 * fold lens, which routes the session onto the compute renderer):
 *
 * | trigger, mid-flight                          | before            | after       |
 * |---|---|---|
 * | Floor checkbox toggles                       | died at toggle 9  | 20/20 clean |
 * | Balloon checkbox toggles                     | died at toggle 9  | 20/20 clean |
 * | Leave Surface mode (`RenderSession.exit()`)  | died at toggle 3  | 20/20 clean |
 * | same three, forced onto WebGL (`?surfacegl`) | survives          | survives    |
 *
 * ARMS, all against the same Sierpinski tetrahedron:
 *
 *   --toggleId=__modeExit
 *                 the WIDEST trigger, and the one that died fastest (toggle
 *                 3, above): undo/redo, a preset load and clicking Points
 *                 all reach `RenderSession.exit()`, which tears the
 *                 renderer down the SAME way a checkbox restart does — so
 *                 this arm stands in for that whole class rather than one
 *                 checkbox. Simulated by clicking Points then Surface again
 *                 from inside the toggle loop, re-entering through
 *                 #modeSurfaceBtn.
 *   --toggles=N   the toggle-storm arm. One page, one surface session, and
 *                 a checkbox (or, with --toggleId=__modeExit, a mode exit)
 *                 fired N times while a heavy fold settle is still running,
 *                 so every toggle lands mid-flight against a renderer with
 *                 GPU work still queued. --toggleId defaults to
 *                 #surfaceGroundPlaneCheckbox (the Floor toggle).
 *   (no flag)     the exploratory arm that came first: one fresh page load
 *                 per (mR, fR, boxLimit) triple, enter Surface, watch, move
 *                 on — no toggling, so it speaks to the radii hypothesis
 *                 only and never exercises the teardown race. 18 triples x
 *                 {base map, lens}: never crashed, before or after the fix.
 *
 *   --lens        a pure-mandelbox FINAL transform (fr-g58b's descendLens),
 *                 which routes the session onto the compute renderer. A lens
 *                 has NO contraction gate, so every radius triple is
 *                 admissible here — unlike a base-map fold, where
 *                 analyzeSurfaceSystem only admits mR/fR > ~0.7075.
 *   --plain       no fold anywhere: bare affine tetra, native WebGL. Control.
 *   --gl          the lens system forced onto WebGL. Control — the crash is
 *                 WebGPU-only, so this arm must stay clean at any --toggles.
 *   --floor=off / --toggleId=... / --viewport=WxH / --toggleGapMs=N
 *
 * RUN (needs a real Firefox build with WebGPU on a display, and the
 * dev/preview server already up):
 *
 *   node scripts/surface-teardown.verify.mjs --url=https://localhost:5174 \
 *        --lens --toggleId=__modeExit --toggles=20 --toggleGapMs=900
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
// The dev server's port, matching surface-preview-completion.verify.mjs. This
// gate exercises renderer LIFECYCLE, not built output, so `npm run dev` is the
// cheaper and equally valid host; pass --url to point it anywhere else.
const BASE = args.url ?? "https://localhost:5173";
const DISPLAY = args.display ?? ":0";
const WATCH_MS = Number(args.watchMs ?? 20000);
const FLOOR = args.floor !== "off";
const FORCE_GL = Boolean(args.gl);
const LENS = Boolean(args.lens);
const FOLD_TYPE = args.fold ?? "mandelbox";
const PLAIN = Boolean(args.plain);
const TOGGLE_ID = args.toggleId ?? "surfaceGroundPlaneCheckbox";
const TOGGLES = Number(args.toggles ?? 0);
const TOGGLE_GAP_MS = Number(args.toggleGapMs ?? 1200);
const POLL_MS = 500;
const FIREFOX_BIN = path.join(
  os.homedir(),
  ".cache/ms-playwright/firefox-1532/firefox/firefox",
);
const [vw, vh] = String(args.viewport ?? "1280x720")
  .split("x")
  .map(Number);
const VIEWPORT = { width: vw || 1280, height: vh || 720 };

const log = (...a) => console.log("[surface-teardown]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HALF = 0.5;

/** src/fractal/presets.ts's sierpinskiTetrahedron(), transcribed (plain Node,
 * no TS loader for src/). */
function tetra() {
  return [
    { position: [0, 0.8, 0], rotation: [0, 0, 0], scale: [HALF, HALF, HALF] },
    {
      position: [0.75, -0.4, 0],
      rotation: [0, 0, 0],
      scale: [HALF, HALF, HALF],
    },
    {
      position: [-0.375, -0.4, 0.65],
      rotation: [0, 0, 0],
      scale: [HALF, HALF, HALF],
    },
    {
      position: [-0.375, -0.4, -0.65],
      rotation: [0, 0, 0],
      scale: [HALF, HALF, HALF],
    },
  ];
}

/** The mandelbox fold carrying the three authored lengths. Absent fields mean
 * the classic values, so only what a slider actually moved is written —
 * types.ts's rule, and ui.ts's editing discipline. */
function foldVariation(
  { minRadius, fixedRadius, boxLimit },
  type = "mandelbox",
) {
  const v = { type, weight: 1 };
  if (minRadius !== undefined) v.minRadius = minRadius;
  if (fixedRadius !== undefined) v.fixedRadius = fixedRadius;
  if (boxLimit !== undefined) v.boxLimit = boxLimit;
  return v;
}

/**
 * Two shapes, selected by --lens:
 *
 * BASE MAP (default): map 0 becomes a pure mandelbox fold. The contraction
 * gate then bounds the radii — only mR/fR > ~0.7075 is reachable at all.
 *
 * LENS (--lens): the tetra's maps stay plain affine and the FINAL transform
 * becomes a pure mandelbox fold (fr-g58b's descendLens). A lens is applied
 * ONCE to the query point, so it carries NO contraction requirement — every
 * radius combination is admissible, which is the arm where a user really can
 * drag all three sliders freely, and the arm whose params block fr-s9ll moved.
 */
function sceneFor(radii, { lens = false, foldType = "mandelbox" } = {}) {
  const maps = tetra();
  const scene = {
    transforms: maps,
    numPoints: 100000,
    pointSize: 1,
    colorMode: "transform",
    renderStyle: "depthFade",
    showGuides: false,
    groundPlane: FLOOR,
    // Pinned pose: the surface renderer is only bit-reproducible run to run
    // when the document pins its camera (fr-opgk), and an unpinned scene
    // auto-frames off a random seed — which would make a crash unattributable.
    // phi just above the horizontal so plenty of rays go DOWN and cross the
    // floor's fade band, which is the whole point of the Floor arm.
    camera: { target: [0, 0, 0], radius: 3.2, theta: -0.35, phi: 1.15 },
  };
  if (PLAIN) {
    // No fold anywhere: the bare Sierpinski tetra on the affine descent. The
    // control for "does the crash need a fold DE at all, or just a restart
    // storm?"
    return scene;
  }
  if (lens) {
    scene.finalTransform = {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [foldVariation(radii, foldType)],
    };
  } else {
    maps[0] = { ...maps[0], variations: [foldVariation(radii, foldType)] };
  }
  return scene;
}

const enc = (s) =>
  "#v1=" + Buffer.from(JSON.stringify(s)).toString("base64url");

/** The triples to walk. Ratios chosen around the mR/fR ≈ 0.7075 seam measured
 * by the CPU sheet, plus box-limit extremes at an admissible ratio. */
const CASES = [
  { label: "classic (no authored lengths)", radii: {} },
  { label: "mR 1.00 fR 1 (ratio 1.000)", radii: { minRadius: 1.0 } },
  { label: "mR 0.90 fR 1 (ratio 0.900)", radii: { minRadius: 0.9 } },
  { label: "mR 0.80 fR 1 (ratio 0.800)", radii: { minRadius: 0.8 } },
  { label: "mR 0.75 fR 1 (ratio 0.750)", radii: { minRadius: 0.75 } },
  { label: "mR 0.73 fR 1 (ratio 0.730)", radii: { minRadius: 0.73 } },
  { label: "mR 0.71 fR 1 (ratio 0.710)", radii: { minRadius: 0.71 } },
  { label: "mR 0.708 fR 1 (seam edge)", radii: { minRadius: 0.708 } },
  { label: "mR 0.7075 fR 1 (seam edge)", radii: { minRadius: 0.7075 } },
  { label: "mR 0.707 fR 1 (past seam)", radii: { minRadius: 0.707 } },
  { label: "mR 0.5 fR 1 (classic, past seam)", radii: { minRadius: 0.5 } },
  {
    label: "mR 1.5 fR 2 wall 1 (scaled up)",
    radii: { minRadius: 1.5, fixedRadius: 2 },
  },
  {
    label: "mR 0.75 fR 1 wall 0.001 (tiny box)",
    radii: { minRadius: 0.75, boxLimit: 0.001 },
  },
  {
    label: "mR 0.75 fR 1 wall 0.05 (tiny box)",
    radii: { minRadius: 0.75, boxLimit: 0.05 },
  },
  {
    label: "mR 0.75 fR 1 wall 64 (huge box)",
    radii: { minRadius: 0.75, boxLimit: 64 },
  },
  {
    label: "mR 0.001 fR 0.001 wall 0.001 (all tiny)",
    radii: { minRadius: 0.001, fixedRadius: 0.001, boxLimit: 0.001 },
  },
  {
    label: "mR 8 fR 8 wall 8 (all huge)",
    radii: { minRadius: 8, fixedRadius: 8, boxLimit: 8 },
  },
  {
    label: "mR 0 fR 0 wall 0 (degenerate)",
    radii: { minRadius: 0, fixedRadius: 0, boxLimit: 0 },
  },
];

async function launch() {
  return firefox.launch({
    executablePath: FIREFOX_BIN,
    headless: Boolean(args.headless),
    env: { ...process.env, DISPLAY, MOZ_WEBRENDER: "1" },
    firefoxUserPrefs: {
      "dom.webgpu.enabled": true,
      "gfx.webgpu.ignore-blocklist": true,
    },
  });
}

/** Run ONE case on a fresh page. Resolves a result record; a thrown/browser-
 * gone condition is reported, never rethrown, so the sweep can continue. */
async function runCase(browser, c) {
  const hash = enc(sceneFor(c.radii, { lens: LENS, foldType: FOLD_TYPE }));
  const url = `${BASE}/?surfacestate${FORCE_GL ? "&surfacegl" : ""}${hash}`;
  const lines = [];
  const result = {
    label: c.label,
    outcome: "ok",
    detail: "",
    lastRow: "",
    engine: "",
    eligibility: "",
    lines,
  };
  let ctx;
  try {
    ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: VIEWPORT,
    });
    const page = await ctx.newPage();
    page.on("console", (m) => {
      const t = m.text();
      if (/surface|webgpu|webgl|compute|shader|adapter|device/i.test(t)) {
        lines.push(`[${m.type()}] ${t}`);
      }
    });
    page.on("pageerror", (e) => lines.push(`[pageerror] ${String(e)}`));
    page.on("crash", () => lines.push("[page] CRASHED"));

    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await sleep(2500);

    // Is the mode even reachable with these radii? The button carries the
    // verdict; a refused system is a legitimate, non-crashing outcome.
    const gate = await page.evaluate(() => {
      const btn = document.getElementById("modeSurfaceBtn");
      return {
        present: Boolean(btn),
        disabled: btn ? btn.disabled : null,
        title: btn ? btn.title : "",
      };
    });
    result.eligibility = gate.disabled ? `refused: ${gate.title}` : "admitted";
    if (gate.disabled) {
      await ctx.close();
      result.outcome = "refused";
      result.detail = gate.title;
      return result;
    }

    await page.evaluate(() => {
      document.getElementById("modeSurfaceBtn").click();
    });

    const tEnter = Date.now();
    while (Date.now() - tEnter < WATCH_MS) {
      await sleep(POLL_MS);
      const s = await page.evaluate(() => {
        const rowEl = document.getElementById("surfaceProgress");
        const visible = rowEl ? !rowEl.classList.contains("hidden") : false;
        return {
          row: visible ? (rowEl.textContent ?? "").trim() : "",
          probe: window.__surfaceState?.() ?? null,
        };
      });
      if (s.row) result.lastRow = s.row;
      if (s.probe) result.probe = s.probe;
      if (s.row.includes("WebGPU")) result.engine = "WebGPU";
      else if (s.row.includes("WebGL")) result.engine = "WebGL";
      else if (s.probe?.engine) result.engine = s.probe.engine;
      if (s.probe?.settled) break; // fr-opgk's settle latch: done
    }
    // A frame that rendered nothing looks identical to a frame that never
    // ran, so price the canvas: how many pixels are not the backdrop.
    result.ink = await page
      .evaluate(() => {
        const cv = document.querySelector("canvas");
        if (!cv) return null;
        const off = document.createElement("canvas");
        off.width = 160;
        off.height = 90;
        const g = off.getContext("2d");
        g.drawImage(cv, 0, 0, 160, 90);
        const d = g.getImageData(0, 0, 160, 90).data;
        const seen = new Set();
        for (let i = 0; i < d.length; i += 4) {
          seen.add((d[i] >> 3) * 1024 + (d[i + 1] >> 3) * 32 + (d[i + 2] >> 3));
        }
        return seen.size; // distinct coarse colors — 1-3 means a flat frame
      })
      .catch(() => null);
    await ctx.close();
    return result;
  } catch (e) {
    result.outcome = "CRASH/ERROR";
    result.detail = String(e).split("\n")[0];
    try {
      await ctx?.close();
    } catch {
      /* the context is gone with the browser — that IS the signal */
    }
    return result;
  }
}

/**
 * The "playing about" arm. One page, one long-lived surface session, and a
 * trigger — the Floor checkbox by default, any other #toggleId, or (with
 * --toggleId=__modeExit) a mode exit — fired repeatedly WHILE a heavy fold
 * settle is in flight.
 *
 * The Floor default is the one edit a user can make from inside a surface
 * session — the transform list is points-mode only, but
 * #surfaceGroundPlaneCheckbox lives in the Surface Look section, and its
 * control-spec effect is `fx.restartSurfaceRender()` -> `surfaceSession.enter()`,
 * which TERMINATES the running renderer and builds a new one — the same
 * `RenderSession.exit()`/`terminate()` path a mode exit reaches directly.
 * With an expensive fold DE the settle runs for minutes, so every toggle
 * lands mid-flight, against a renderer with GPU work still queued.
 */
async function runToggleArm(browser, c, toggles, gapMs) {
  const hash = enc(sceneFor(c.radii, { lens: LENS, foldType: FOLD_TYPE }));
  const url = `${BASE}/?surfacestate${FORCE_GL ? "&surfacegl" : ""}${hash}`;
  const lines = [];
  const result = {
    // Name the trigger, not "floor" — the arm is whichever restart/exit door
    // --toggleId selected, and mislabelling every run as a Floor toggle is how
    // the original diagnosis went wrong in the first place.
    label: `${c.label} [${toggles}x ${
      TOGGLE_ID === "__modeExit" ? "mode exit" : TOGGLE_ID
    } @${gapMs}ms]`,
    outcome: "ok",
    detail: "",
    lastRow: "",
    engine: "",
    eligibility: "admitted",
    lines,
  };
  let ctx;
  try {
    ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: VIEWPORT,
    });
    const page = await ctx.newPage();
    page.on("console", (m) => {
      const t = m.text();
      if (/surface|webgpu|webgl|compute|shader|adapter|device|error/i.test(t)) {
        lines.push(`[${m.type()}] ${t}`);
      }
    });
    page.on("pageerror", (e) => lines.push(`[pageerror] ${String(e)}`));
    page.on("crash", () => lines.push("[page] CRASHED"));

    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await sleep(2500);
    const disabled = await page.evaluate(
      () => document.getElementById("modeSurfaceBtn").disabled,
    );
    if (disabled) {
      await ctx.close();
      result.outcome = "refused";
      return result;
    }
    await page.evaluate((id) => {
      window.__toggleId = id;
      document.getElementById("modeSurfaceBtn").click();
    }, TOGGLE_ID);
    await sleep(1500);

    for (let i = 0; i < toggles; i++) {
      await sleep(gapMs);
      const state = await page.evaluate(() => {
        const rowText = () => {
          const el = document.getElementById("surfaceProgress");
          return el && !el.classList.contains("hidden")
            ? (el.textContent ?? "").trim()
            : "";
        };
        // Blast-radius arm: leaving the mode outright is RenderSession.exit(),
        // which runs the SAME terminate() the restart does.
        if (window.__toggleId === "__modeExit") {
          document.getElementById("modePointsBtn").click();
          document.getElementById("modeSurfaceBtn").click();
          return {
            ok: true,
            floor: "mode-exit",
            row: rowText(),
            probe: window.__surfaceState?.() ?? null,
          };
        }
        const cb = document.getElementById(
          window.__toggleId ?? "surfaceGroundPlaneCheckbox",
        );
        if (!cb) return { ok: false };
        // Mirror the real interaction: set + dispatch "change", which is the
        // event ui.ts binds the checkbox effect to.
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        const rowEl = document.getElementById("surfaceProgress");
        const visible = rowEl ? !rowEl.classList.contains("hidden") : false;
        return {
          ok: true,
          floor: cb.checked,
          row: visible ? (rowEl.textContent ?? "").trim() : "",
          probe: window.__surfaceState?.() ?? null,
        };
      });
      if (!state.ok) {
        result.detail = "no #surfaceGroundPlaneCheckbox (row hidden?)";
        break;
      }
      if (state.row) result.lastRow = state.row;
      if (state.probe) result.probe = state.probe;
      log(
        `      toggle ${i + 1}/${toggles} floor=${state.floor} row="${state.row}"`,
      );
    }
    await sleep(3000);
    await ctx.close();
    return result;
  } catch (e) {
    result.outcome = "CRASH/ERROR";
    result.detail = String(e).split("\n")[0];
    try {
      await ctx?.close();
    } catch {
      /* gone with the browser — that IS the signal */
    }
    return result;
  }
}

async function main() {
  log(
    `url=${BASE} shape=${LENS ? "fold FINAL lens" : "fold base map"} fold=${FOLD_TYPE} floor=${
      FLOOR ? "ON" : "off"
    } engine=${
      FORCE_GL ? "forced WebGL" : "default (WebGPU if available)"
    } watchMs=${WATCH_MS}`,
  );
  let browser = await launch();
  const results = [];
  let reproduced = false;

  // The toggle arm's subject is the TEARDOWN, and the fold radii are exactly
  // what this investigation exonerated — so sweeping all of CASES there would
  // pay 18x the wall clock to re-answer a settled question (and, at the
  // default 20 toggles, run for the better part of an hour). One case is the
  // gate; --only still picks a different one. The radius sweep is the
  // no-toggles exploratory arm's job, and its record lives in
  // scripts/fold-radii-seam.harness.ts.
  const selected = args.only
    ? CASES.filter((c) => c.label.includes(String(args.only)))
    : TOGGLES
      ? CASES.slice(0, 1)
      : CASES;
  const cases = selected;
  for (const c of cases) {
    log(`--- ${c.label}`);
    if (!browser.isConnected()) {
      log("    browser gone; relaunching");
      browser = await launch();
    }
    const r = TOGGLES
      ? await runToggleArm(browser, c, TOGGLES, TOGGLE_GAP_MS)
      : await runCase(browser, c);
    results.push(r);
    const browserAlive = browser.isConnected();
    if (!browserAlive) {
      r.outcome = "BROWSER DIED";
      reproduced = true;
    } else if (r.outcome === "CRASH/ERROR") {
      reproduced = true;
    }
    log(
      `    ${r.outcome} | ${r.eligibility} | engine=${r.engine || "?"} | ink=${r.ink ?? "?"} | settled=${r.probe?.settled ?? "?"} | row="${r.lastRow}" ${r.detail ? "| " + r.detail : ""}`,
    );
    for (const l of r.lines.slice(-6)) log(`      ${l}`);
    if (!browserAlive) {
      log("    !!! FIREFOX DIED ON THIS CASE !!!");
      browser = await launch();
    }
  }

  await browser.close().catch(() => {});

  console.log("\n=== summary ===");
  for (const r of results) {
    console.log(
      `${r.label.padEnd(38)} ${r.outcome.padEnd(14)} ${r.eligibility.padEnd(20)} ${r.engine.padEnd(8)} ink=${String(r.ink ?? "?").padEnd(5)} settled=${String(r.probe?.settled ?? "?").padEnd(6)} ${r.lastRow}`,
    );
  }
  process.exit(reproduced ? 3 : 0);
}

main().catch((e) => {
  console.error("[surface-teardown] harness failure:", e);
  process.exit(1);
});
