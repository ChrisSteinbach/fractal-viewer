#!/usr/bin/env node
/**
 * The engine head-to-head — does the WebGPU COMPUTE arm settle a BALLOON
 * surface session dramatically slower than the WebGL STRIP arm, or is it
 * just slower here?
 *
 *   npm run build && npm run preview &
 *   node scripts/balloon-engine-ab.verify.mjs [--display=:0] [--scale=…] [--url=…]
 *
 * THE OBSERVATION THIS EXISTS TO REPLACE was made off four
 * real-Iris legs that were NOT matched — boxfoldPair on WebGL WITH a
 * balloon settled in 25.4s while compute did NOT settle a mandelboxKifs
 * scene WITHOUT one in 300s — so the only honest reading of it was "two
 * different systems on two different engines took two different times".
 * This script asks the same question with the confounds removed: ONE
 * system, ONE camera, ONE raster, ONE supersampling count, four legs —
 * {compute, webgl} x {balloon off, balloon on} — and the answer it is
 * built to give is not a time at all but TWO RATIOS:
 *
 *   compute:webgl with the balloon OFF   — how much slower is compute here
 *   compute:webgl with the balloon ON    — how much slower is it WITH one
 *
 * If those two are close, compute is simply the slower arm on this system
 * and the annulus early-out is worth doing on whichever arm ships.
 * If the balloon-ON ratio is much the worse, compute is PATHOLOGICAL FOR
 * THE BALLOON SPECIFICALLY and the fix is a routing predicate — which is
 * the decision the early-out is blocked on. The per-engine balloon PENALTY
 * (on/off within one arm) is printed beside them, because that is the same
 * claim read the other way round and it is censoring-resistant in a
 * different place.
 *
 * ── THE MATCHING, WHICH IS THE WHOLE VALUE ────────────────────────────
 *
 * ONE SYSTEM, from a `#v1=` HASH. `harness-profiles`' foldBoxfoldPair (two
 * boxfolds, `--system=boxfoldPair`, the default) — the same fixture
 * `scripts/balloon-real-driver.verify.mjs` and
 * `scripts/surface-balloon-tint.verify.mjs` drive, so the numbers here can
 * be read beside theirs. It is the LIGHT fold-frontier system on purpose:
 * `deHasFolds(de)` is what routes a 3D session to compute at all (a plain
 * affine IFS prefers WebGL and could not produce a compute leg), the
 * balloon is eligible on it (an IFS, not a forward orbit), and
 * every extra base map is another inverse-map branch the echo's descent
 * pays for TWICE, so the 12-map monster costs four legs where two boxfolds
 * cost one. `--system=mandelboxKifs` is the monster, kept because it is
 * the system half of the original observation. Both are built as plain
 * objects through `persist.ts`'s encoder rather than pasted base64, so the
 * documents are readable in the diff and no preset table is involved: the
 * gate survives one changing under it (`surface-4d-lift.verify.mjs`'s
 * idiom).
 *
 * ONE RASTER. `--scale=` is the ray-count lever (`scene.ts`'s
 * `basePixelRatio()` is `min(devicePixelRatio, 2)` with no floor, so the
 * page's deviceScaleFactor scales the trace buffer while every CSS box
 * stays where a user's is — `surface-balloon-tint.verify.mjs`'s flag,
 * same meaning). It defaults SMALL (0.25 → ~225x140 inside the 900x560
 * CSS viewport) because THE ABSOLUTE TIMES DO NOT MATTER HERE AND THE
 * RATIO DOES: four legs at a raster nobody has to sit through is what
 * makes the comparison affordable, and a ratio is what survives the
 * shrinkage. Both arms take the same lever, and the script ASSERTS the
 * four legs ran at one drawing-buffer size rather than trusting that.
 * (A real-driver run that wants real numbers as well as a ratio should say
 * `--scale=1`; see WEAKNESSES below for why the small raster is not free.)
 *
 * ONE SUPERSAMPLING COUNT — the subtle one, and the one that observation
 * calls out. Both arms now resolve the document's Antialiasing choice and
 * the same diagnostic `?surfacesamples=N` override before either renderer
 * starts. This script deliberately passes NO override, leaving every leg on
 * the shipped document default of 8, and then MEASURES the count rather than
 * assuming the shared resolver stayed wired to both arms: both engines
 * disclose the pass as a trailing `antialiasing pass k/N` token in
 * `#surfaceProgress` (deliberately the same words), and the run
 * FAILS if two legs report different N. A leg too fast — or too slow — to
 * ever show pass 2 reports `samples=?` and is disclosed as unverified
 * rather than assumed matched.
 *
 * FOUR LEGS, ordered `compute/off, webgl/off, compute/on, webgl/on` so
 * that each RATIO is formed from two temporally ADJACENT measurements —
 * this machine's own settle times spread 2x between a quiet and a busy box
 * (`surface-balloon-tint.verify.mjs`'s header records 118s and 246s for
 * one identical capture), so a ratio whose halves are half an hour apart
 * is measuring the machine. `?surfacegl` forces WebGL and `?surfacecompute`
 * forces compute; only ONE is ever passed (a block is one-way, so
 * `?surfacegl` wins if both are given). On a fold system `?surfacecompute`
 * is a no-op — routing already prefers compute — and it is passed anyway
 * so the URL says which leg it is; the engine ASSERTION below is what
 * actually proves it.
 *
 * ── WHAT THE PERCENTAGE DENOMINATES (the first alternative) ────────────
 *
 * Read out of the source, and then MEASURED by this script rather than
 * left as a reading. Both arms' percentage spans the WHOLE 8-pass job, so
 * they are the same quantity in kind:
 *
 *   compute  main.ts's onProgress takes `done/total` where pass 0 stretches
 *            its own ray tallies over `total * samples`
 *            (`SurfaceComputeRenderer.runSamples`), and every later pass
 *            reports `taken * rays / (samples * rays)`. So it is RESOLVED
 *            RAYS over rays x 8 — fine-grained inside pass 0, then a
 *            12.5-point STEP as each later pass completes.
 *   webgl    `scene.surfaceRenderProgress()` returns
 *            `(sampleIndex + stripJobCoverage(job)) / samples` — TRACED
 *            PIXELS over pixels x 8, fine-grained inside EVERY pass.
 *
 * The one real asymmetry is granularity, not denominator: a compute leg
 * reading 50% has finished four whole passes, where a WebGL leg reading
 * 50% may be three passes and most of a fourth. The script prints a PASS
 * LADDER per leg — the percentage at which each `pass k` token first
 * appeared — so a reader can see compute's ladder land on 12.5/25.0/37.5
 * and WebGL's ramp through them, which is that reading MEASURED.
 *
 * It also means `100/N` per cent is the SAME EVENT on both arms — PASS 0
 * COMPLETE, the pre-supersampling single-pass frame — which is the `pass0`
 * column, and the one comparison that survives a leg that never settles.
 * It is read off the percentage TRAJECTORY rather than the pass token,
 * because a token can be missed outright: at a small raster a whole pass
 * can elapse between two polls (measured on this script's own SwiftShader
 * smoke run, whose compute ladder starts at p3), and a checkpoint taken
 * from the first token seen would then be a whole pass late. The
 * percentage only rises, so it cannot skip; where the detecting sample
 * still overshot a whole pass the report says so and calls the figure an
 * upper bound.
 *
 * ONE MORE READING, free: main.ts logs `Surface compute settle WxH: Nms
 * wall, P passes, hit H / miss M / exhausted E` when a compute settle
 * COMPLETES. The script captures it per leg and prints it as the `device`
 * line — the renderer's own wall for the job being timed (it matched this
 * script's `trace` column on the smoke run recorded below — 18.1s against
 * 18.4s), the TRACE raster, and the hit tally, which is how "is the
 * balloon leg doing more work, or the same work slower" gets asked at all.
 * A censored compute leg has no such line, which is itself informative.
 *
 * ── WHAT IT ASSERTS (exit 3) vs WHAT IT ONLY REPORTS ──────────────────
 *
 * ASSERTS — these are the matching, and a run that breaks one is not
 * measuring what it claims:
 *   1. every leg took the engine it asked for, read from the app
 *      (`window.__surfaceState().engine`, needs `?surfacestate`) — a leg
 *      that silently fell back to the other arm would INVERT the verdict;
 *   2. every leg that disclosed a supersampling count disclosed the SAME
 *      one;
 *   3. all four legs ran at one drawing-buffer raster;
 *   4. the four documents differ in `balloonEcho` and in nothing else
 *      (they are built from one object, and the difference is diffed and
 *      printed);
 *   5. no leg raised the `#renderError` banner or left surface mode
 *      mid-leg (a device loss exiting the mode is a real event, but it is
 *      not a settle time).
 *
 * REPORTS, and never fails on:
 *   whether each leg SETTLED — a leg that does not settle inside
 *   `--legTimeout` is a MEASUREMENT, not a crash (it is half of what was
 *   observed), and its time enters the ratios as a CENSORED bound, printed
 *   `>=` or `<=` in the direction the censoring can only push it. Also
 *   reported: entry time (click -> first frame), the pass-0 checkpoint, the
 *   percentage and row text reached, the pass ladder, the raster, and any
 *   console line about the compute raster fit.
 *
 * ── MEASURED, this script's own SwiftShader smoke run ────────────────
 *
 * NOT A VERDICT — SwiftShader for WebGPU and ANGLE SwiftShader for GL,
 * headless, `--scale=0.06` (53x33 = 1749 rays), boxfoldPair, balloon
 * 1.60x, `--legTimeout=30`. It is recorded because it is the proof that
 * every mechanism above works, and because it shows what the output looks
 * like when a leg is censored:
 *
 *   leg          engine   entered   pass0   settle   reached  samples raster
 *   compute/off  compute     4.8s    5.7s     9.4s      100%       8  53x33
 *   webgl/off    webgl       5.0s    6.4s     9.5s      100%       8  53x33
 *   compute/on   compute    11.1s   15.9s    29.5s      100%       8  53x33
 *   webgl/on     webgl      11.0s     n/a   >30.0s       11%       ?  53x33
 *
 *   device compute/off  1749 rays   4.4s wall  hit 109 (6.2%)
 *   device compute/on   1749 rays  18.1s wall  hit 408 (23.3%)
 *
 * Three of the four legs disclosed 8 passes and the fourth never finished
 * one, so it reported its count as UNVERIFIED rather than assuming it —
 * which is the disclosure the matching needs, in the one case where it
 * cannot be checked. All four took the engine they asked for and all four
 * traced one raster. The `device` line, which is the RENDERER's own clock
 * on the job, agreed with this script's `trace` column to the tenth
 * (18.1s against 29.5 - 11.1 = 18.4s), which is what says the columns
 * measure the trace and not the harness.
 *
 * On this SOFTWARE stack the answer came out "compute is not the
 * pathological arm": compute:webgl x0.99 with the balloon off and <=x0.98
 * with it on, the balloon penalty x3.12 on compute against >=x3.15 on
 * WebGL. That is worth NOTHING as a verdict about real Iris — where
 * the original observation was made, and where the two arms' fixed costs are
 * entirely different — and is recorded only so a real-driver run has a
 * known-good shape to be compared against.
 *
 * Exit 0 = four legs measured and matched. Exit 3 = the MATCHING failed
 * (wrong engine, mismatched sample counts, mismatched raster, a leg
 * invalidated). Exit 1 = the CHECKING side broke — no server, no browser,
 * no WebGPU adapter to ask the compute legs of, an ineligible system. A
 * flaky environment must never read as a verdict about the renderer.
 *
 * ── WEAKNESSES, stated because a real-GPU slot is scarce ──────────────
 *
 * - A SMALL RASTER IS NOT NEUTRAL. Both arms carry per-frame fixed costs
 *   that do not shrink with the ray count — the strip pump's ~66-90ms sync
 *   tax per fence group and the compute shade sizer's dispatch INTERCEPT —
 *   so a tiny raster inflates whichever arm's fixed costs are larger and
 *   the measured ratio is not the per-ray ratio. The ratio's SIGN and its
 *   balloon-on-vs-off CONTRAST are what to read at a small scale; a
 *   headline number wants `--scale=1`.
 * - THE WEBGL ARM PAYS A FOLD LINK the compute arm does not: a fold
 *   session gates its first frame on `compileAsync` of the fold tracer,
 *   ~25s on Mesa. That lands entirely in `entered`, so the table prints
 *   settle-from-click AND a `trace` column with the entry subtracted, and
 *   the ratios are given both ways.
 * - PROGRAM LINK COST IS PER VARIANT, not per leg pair: the balloon arm is
 *   a different shader variant from the plain one on BOTH engines, so on a
 *   cold browser each of the four legs links its own program — but a
 *   `--repeat` block re-runs against a warm cache, so its `entered` column
 *   is not the first block's. Compare blocks by `trace` and `pass0`.
 * - THE PREVIEW TIER IS NOT MATCHED and is not meant to be: each arm runs
 *   its own preview governor before the settle arms. That cost is inside
 *   settle-from-click on both arms and inside `trace` on both arms; only
 *   the pass-0 checkpoint is free of it, which is another reason it is
 *   reported.
 * - ONE RUN IS ONE RUN. `--repeat=N` re-runs the whole four-leg block and
 *   prints each block's ratios; nothing here averages them, because a
 *   spread across blocks is the machine and deserves to be seen rather
 *   than smoothed.
 * - THE POSE IS PINNED by reading the app's own share link once and writing
 *   that camera into all four documents. Current direct boots already use
 *   deterministic `BOOT_SEED`; the explicit pose makes the stronger A/B
 *   contract that every leg consumes the exact same captured camera,
 *   independently of fit changes. If that read fails the run CONTINUES
 *   unpinned and says so loudly: the current boots should still agree, but
 *   the harness has no explicit pose artifact proving that they did.
 *
 * -- FLAGS -------------------------------------------------------------
 *
 *   --url=...          preview origin (default https://localhost:4173)
 *   --display=:0       headed against a real driver — the only mode whose
 *                      TIMES mean anything; without it every leg runs on
 *                      SwiftShader, which proves the script runs and says
 *                      nothing about the renderer
 *   --scale=N          device scale = the ray-count lever (default 0.25)
 *   --radius=N         normalized balloon radius (default 1.6, the
 *                      document's own default)
 *   --legTimeout=S     soft per-leg budget in SECONDS (default 300)
 *   --system=NAME      boxfoldPair (default) | mandelboxKifs
 *   --only=a,b         run a subset by leg id (compute/off, webgl/off,
 *                      compute/on, webgl/on) — how one leg gets re-run
 *   --repeat=N         re-run the whole four-leg block N times
 *   --nopose           skip the camera pin (see WEAKNESSES)
 *   --surfperf         add `?surfperf` to every leg — chatty per-strip
 *                      logging that can perturb the WebGL arm's own
 *                      timing, so it explains a result rather than
 *                      producing one
 */
import { chromium } from "playwright-core";

/** CSS viewport. Wider than `MOBILE_BREAKPOINT` (640) on purpose: below it
 * the panel is a closed drawer and `#modeSurfaceBtn` is not clickable, so
 * the layout rather than the render would decide whether this runs. */
const VIEWPORT = { width: 900, height: 560 };
/** Ray-count lever's default — see the header. 0.25 of 900x560 is ~225x140
 * = 31.5k rays, roughly a fifth of the 512x320 the original observation
 * used, which is what makes four legs affordable. */
const DEFAULT_DEVICE_SCALE = 0.25;
/** Normalized balloon radius (`buildBalloon`'s `rMult`, multiples of the
 * raw ball radius). 1.6 is the DOCUMENT's own shipped default and the one
 * the original observation ran at — this instrument compares engines, not
 * radii, so it stays on the shipped value. `--radius=` moves it (the tint
 * gate uses 0.50 for a different reason: to put the echo ON SCREEN, which
 * a cost measurement does not need). */
const DEFAULT_BALLOON_RADIUS = 1.6;
/** Per-leg soft budget. A leg that exceeds it is CENSORED, not failed —
 * 300s matches the budget the original non-settling legs were given, so
 * "did not settle in 300s" means here what it meant there. */
const DEFAULT_LEG_TIMEOUT_MS = 300_000;
/** Poll cadence for the settle latch and the progress row. 200ms is fine
 * enough to catch a pass boundary (a pass is seconds at any raster worth
 * measuring) and coarse enough that the polling is not itself load. */
const POLL_MS = 200;

/** `harness-profiles`' foldBoxfoldPair — the light fold-frontier pair. */
const BOXFOLD_PAIR = [
  {
    position: [0.4, 0.1, 0],
    rotation: [0.3, 0.2, 0],
    scale: [0.45, 0.45, 0.45],
    variations: [{ type: "boxfold", weight: 1 }],
  },
  {
    position: [-0.35, -0.2, 0.3],
    rotation: [0, 0.5, 0.1],
    scale: [0.5, 0.5, 0.5],
    variations: [{ type: "boxfold", weight: 0.9 }],
  },
];

/** The REAL `mandelboxKifs` preset (presets.ts), transform for transform —
 * the surface fold monster, and the system half of that observation.
 * Eligibility depends on these exact numbers. */
const MANDELBOX_KIFS = (() => {
  const transforms = [];
  for (const x of [1, -1]) {
    for (const y of [1, -1]) {
      for (const z of [1, -1]) {
        transforms.push({
          position: [x * 0.7, y * 0.7, z * 0.7],
          rotation: [0, 0, 0],
          scale: [0.19, 0.19, 0.19],
          variations: [{ type: "mandelbox", weight: 1.2 }],
        });
      }
    }
  }
  for (const c of [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ]) {
    transforms.push({
      position: [c[0] * 0.62, c[1] * 0.62, c[2] * 0.62],
      rotation: [0, 0, 0],
      scale: [0.66, 0.66, 0.66],
      variations: [{ type: "boxfold", weight: 1 }],
    });
  }
  return transforms;
})();

const SYSTEMS = {
  boxfoldPair: BOXFOLD_PAIR,
  mandelboxKifs: MANDELBOX_KIFS,
};

/** The four legs, in the order they run. Adjacent pairs form the ratios —
 * see the header on why that ordering is the measurement's, not taste. */
const LEGS = [
  { id: "compute/off", engine: "compute", balloon: false },
  { id: "webgl/off", engine: "webgl", balloon: false },
  { id: "compute/on", engine: "compute", balloon: true },
  { id: "webgl/on", engine: "webgl", balloon: true },
];

/** `persist.ts`'s encoder: a plain object through JSON + base64url. */
const enc = (scene) =>
  "#v1=" + Buffer.from(JSON.stringify(scene)).toString("base64url");

/**
 * The ONE document every leg renders. `balloon` is the ONLY field that
 * differs between legs — asserted below by diffing the encoded pair, not
 * by trusting this function.
 */
function sceneDoc({ system, balloon, radius, pose }) {
  const doc = {
    transforms: system,
    numPoints: 100000,
    pointSize: 1,
    colorMode: "transform",
    renderStyle: "depthFade",
    showGuides: false,
    balloonEcho: balloon,
    balloonRadius: radius,
  };
  if (pose?.camera) doc.camera = pose.camera;
  return doc;
}

/** Terse restatement of the header's FLAGS block, for `--help` and for an
 * unknown argument — the header stays the authority on WHY each exists. */
const USAGE = `usage: node scripts/balloon-engine-ab.verify.mjs [flags]
  --url=…          preview origin (default https://localhost:4173)
  --display=:0     headed, real driver (the only mode whose TIMES mean anything)
  --scale=N        device scale = the ray-count lever (default 0.25)
  --radius=N       normalized balloon radius (default 1.6)
  --legTimeout=S   soft per-leg budget in SECONDS (default 300)
  --system=NAME    boxfoldPair (default) | mandelboxKifs
  --only=a,b       subset by leg id: compute/off webgl/off compute/on webgl/on
  --repeat=N       re-run the whole four-leg block N times
  --nopose         skip the camera pin
  --surfperf       add ?surfperf to every leg (chatty; can perturb WebGL timing)`;

function parseArgs(argv) {
  const out = {
    url: "https://localhost:4173",
    display: undefined,
    scale: DEFAULT_DEVICE_SCALE,
    radius: DEFAULT_BALLOON_RADIUS,
    legTimeoutMs: DEFAULT_LEG_TIMEOUT_MS,
    system: "boxfoldPair",
    only: null,
    repeat: 1,
    pose: true,
    surfperf: false,
  };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    }
    const m = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) throw new HarnessError(`Unknown argument: ${raw}\n${USAGE}`);
    const [, key, value] = m;
    if (key === "url" && value) out.url = value.replace(/\/+$/, "");
    else if (key === "display") out.display = value ?? ":0";
    else if (key === "scale" && value) out.scale = Number(value);
    else if (key === "radius" && value) out.radius = Number(value);
    else if (key === "legTimeout" && value)
      out.legTimeoutMs = Number(value) * 1000;
    else if (key === "system" && value) out.system = value;
    else if (key === "only" && value) out.only = value.split(",");
    else if (key === "repeat" && value) out.repeat = Number(value);
    else if (key === "nopose") out.pose = false;
    else if (key === "surfperf") out.surfperf = true;
    else throw new HarnessError(`Unknown argument: ${raw}\n${USAGE}`);
  }
  if (!Number.isFinite(out.scale) || out.scale <= 0) {
    throw new HarnessError(`--scale takes a positive number, not ${out.scale}`);
  }
  if (!Number.isFinite(out.radius) || out.radius <= 0) {
    throw new HarnessError(
      `--radius takes a positive number, not ${out.radius}`,
    );
  }
  if (!Number.isFinite(out.legTimeoutMs) || out.legTimeoutMs <= 0) {
    throw new HarnessError(
      `--legTimeout takes seconds, not ${out.legTimeoutMs}`,
    );
  }
  if (!Number.isInteger(out.repeat) || out.repeat < 1) {
    throw new HarnessError(
      `--repeat takes a positive integer, not ${out.repeat}`,
    );
  }
  if (!(out.system in SYSTEMS)) {
    throw new HarnessError(
      `--system takes ${Object.keys(SYSTEMS).join(" or ")}, not ${out.system}`,
    );
  }
  if (out.only) {
    for (const id of out.only) {
      if (!LEGS.some((leg) => leg.id === id)) {
        throw new HarnessError(
          `--only takes leg ids (${LEGS.map((l) => l.id).join(", ")}), not ${id}`,
        );
      }
    }
  }
  return out;
}

/** A failure of the CHECKING side as against a failure of the matching —
 * the two exits this script keeps apart. */
class HarnessError extends Error {}

const log = (line) => process.stdout.write(`[balloon-engine-ab] ${line}\n`);

/**
 * Chrome flags. The default is the SwiftShader recipe that exposes a real
 * WebGPU adapter headlessly on this stack, so the script can be smoke-run
 * without a display; `--display=:0` drops the forcing and runs HEADED
 * against whatever driver the display has, which is the only mode whose
 * TIMES mean anything (`surface-balloon-tint.verify.mjs`'s pair, verbatim,
 * plus balloon-real-driver's three occlusion flags — Chrome throttles rAF
 * for backgrounded windows and this script's whole output is a clock).
 */
function launchOptions(display) {
  const env = { ...process.env };
  if (display === undefined) {
    delete env.DISPLAY;
    return {
      env,
      headless: true,
      args: [
        "--no-sandbox",
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--disable-vulkan-surface",
      ],
    };
  }
  env.DISPLAY = display;
  return {
    env,
    headless: false,
    args: [
      "--no-sandbox",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
  };
}

/**
 * Load one document. The query is unique per leg because a URL that
 * differs only in its FRAGMENT does not reload, and this app reads the
 * scene hash exactly once, at boot — the trap `surface-4d-lift.verify.mjs`
 * documents falling into (three documents, three identical frames).
 *
 * `page.bringToFront()` is MANDATORY and not politeness: Mutter withholds
 * frame callbacks from occluded surfaces and the settle machinery this
 * polls is present-gated, so an occluded window parks it at a
 * deterministic percent (measured 64%/99% stalls on the real driver; the
 * same call landed in the 4D gate for the same reason).
 */
async function openScene(page, { url, tag, hash, engine, surfperf }) {
  const force = engine === "webgl" ? "&surfacegl" : "&surfacecompute";
  // `?surfperf` is OPT-IN and matched across every leg when it is on: the
  // strip arm logs per-readback lines under it, and a console.log inside
  // the pump is not free on the arm this script is timing. Use it to
  // EXPLAIN a result, never to produce one.
  const perf = surfperf ? "&surfperf" : "";
  await page.goto(`${url}/?surfacestate${force}${perf}&leg=${tag}${hash}`, {
    waitUntil: "load",
  });
  await page.bringToFront();
  await page.waitForFunction(
    () => typeof window.__surfaceState === "function",
    undefined,
    { timeout: 60_000 },
  );
}

/** Does this page have a live WebGPU adapter? Asked ON THE APP ORIGIN —
 * `navigator.gpu` is absent on `about:blank`. Without one there is no
 * compute leg to measure and the run has no question to ask. */
async function probeAdapter(page) {
  return page.evaluate(async () => {
    if (!navigator.gpu) return { gpu: false, adapter: false };
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return {
        gpu: true,
        adapter: adapter !== null,
        vendor: adapter?.info?.vendor ?? null,
        architecture: adapter?.info?.architecture ?? null,
      };
    } catch {
      return { gpu: true, adapter: false };
    }
  });
}

/**
 * The pose the app itself framed this system with, read out of the
 * Copy-link handler's `#v1=` — the one place that decides what a shared
 * document carries. Read ONCE, from the balloon-OFF document, and written
 * into all four legs, so the balloon legs are framed exactly as the plain
 * ones are. It waits for the synchronous boot cloud and retains the short
 * grace period for the app/share UI to become quiescent. The async density
 * upgrade uses the same `BOOT_SEED` with `fit:false`: it adds points but
 * cannot re-fit the camera. (Copied from
 * `surface-balloon-tint.verify.mjs`, where this idiom was proven.)
 */
async function readPose(page) {
  await page.waitForFunction(
    () =>
      Number(
        (document.getElementById("pointCount")?.textContent ?? "").replace(
          /[^\d]/g,
          "",
        ),
      ) > 0,
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(2500);
  const link = await page.evaluate(async () => {
    delete window.__balloonAbLink;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__balloonAbLink = text;
        },
      },
    });
    document.getElementById("shareSection").open = true;
    document.getElementById("copyLinkBtn").click();
    return new Promise((resolve) =>
      setTimeout(() => resolve(window.__balloonAbLink ?? null), 750),
    );
  });
  if (typeof link !== "string" || !link.includes("#v1=")) {
    throw new HarnessError("copy-link produced no #v1= document");
  }
  const decoded = JSON.parse(
    Buffer.from(link.split("#v1=")[1], "base64url").toString("utf8"),
  );
  if (!decoded.camera) {
    throw new HarnessError("the app's own share link carried no camera pose");
  }
  return { camera: decoded.camera };
}

/** Noise from the preview origin itself, not from the renderer. */
const PREVIEW_ORIGIN_NOISE =
  /SSL certificate error|Service worker registration failed/;
/**
 * main.ts's own settle breadcrumb, emitted once a compute settle COMPLETES:
 * `Surface compute settle WxH: Nms wall, P passes, hit H / miss M /
 * exhausted E`. It is the device-side counterpart of this script's `trace`
 * column — the whole supersampled job's wall as the renderer measured it,
 * plus the TRACE raster (which is the canvas raster unless the device ray
 * cap bit) and the hit tally. Captured and printed because it independently
 * answers two of the observation's alternative explanations: whether the
 * two arms traced the same number of rays, and whether the balloon leg is
 * doing more work or the same work slower. A censored compute leg has no
 * such line — it is emitted on completion — which is itself worth seeing.
 */
const COMPUTE_SETTLE_RE =
  /Surface compute settle (\d+)x(\d+): ([\d.]+)ms wall, (\d+) passes, hit (\d+) \/ miss (\d+) \/ exhausted (\d+)/;

/** `#surfaceProgress`'s text, as main.ts writes it:
 * `"<Preview|Full detail> · <engine> <pct>%[ — <detail>]"`. */
const ROW_RE = /^(Preview|Full detail) · (.+?) (\d+(?:\.\d+)?)%(?: — (.+))?$/;
/** Both arms' supersampling disclosure — compute and WebGL emit
 * deliberately the same words. Silent through pass 1, which is why
 * a leg can legitimately report an unknown count. */
const PASS_RE = /antialiasing pass (\d+)\/(\d+)/;

function parseRow(text) {
  const m = ROW_RE.exec(text.trim());
  if (!m) return null;
  const pass = m[4] ? PASS_RE.exec(m[4]) : null;
  return {
    phase: m[1] === "Preview" ? "preview" : "settle",
    engineToken: m[2],
    pct: Number(m[3]),
    detail: m[4] ?? null,
    pass: pass ? Number(pass[1]) : null,
    samples: pass ? Number(pass[2]) : null,
  };
}

/**
 * PASS 0 COMPLETE — the pre-supersampling single-pass frame, and the ONE
 * comparison a leg that never settles still yields. Both arms' percentage
 * spans the whole N-pass job (see the header), so pass 0 completes exactly
 * as the percentage reaches `100/N` on either engine; `formatRenderPercent`
 * floors, so the crossing is read at `floor(100/N)`. Falls back to the
 * first pass TOKEN when no count was ever disclosed, and to the settle
 * itself when the leg finished before either appeared.
 *
 * `pass0Pct` records the percentage the detecting sample actually carried,
 * so the report can mark a checkpoint that the poll cadence caught LATE.
 */
function resolvePass0(rec) {
  if (rec.samples !== null && rec.samples > 1) {
    const threshold = Math.floor(100 / rec.samples);
    const hit = rec.traj.find((e) => e.pct >= threshold);
    if (hit) {
      rec.pass0Ms = hit.ms;
      rec.pass0Pct = hit.pct;
      return;
    }
  }
  if (rec.firstPassMs !== null) {
    rec.pass0Ms = rec.firstPassMs;
    rec.pass0Pct = null;
    return;
  }
  if (rec.settled) {
    rec.pass0Ms = rec.ms;
    rec.pass0Pct = null;
  }
}

/**
 * Drive ONE leg: enter Surface from the UI, then poll the settle
 * latch and the progress row until the latch says COMPLETED or the soft
 * budget runs out. Never throws on slowness — a leg that does not settle
 * is this instrument's most important kind of measurement.
 *
 * The clock starts at the click, which is the quantity the original
 * observation reported. `enteredMs` (click -> first frame) is kept
 * separately because the WebGL arm pays a fold program link there that
 * compute never pays.
 */
async function driveLeg(page, leg, timeoutMs) {
  const disabled = await page.evaluate(
    () => document.getElementById("modeSurfaceBtn").disabled,
  );
  if (disabled) {
    throw new HarnessError(
      `${leg.id}: Surface mode is disabled for this system`,
    );
  }
  const t0 = Date.now();
  await page.click("#modeSurfaceBtn");
  const rec = {
    id: leg.id,
    want: leg.engine,
    balloon: leg.balloon,
    engine: null,
    entered: false,
    enteredMs: null,
    settled: false,
    ms: null,
    pass0Ms: null,
    pass0Pct: null,
    firstPassSeen: null,
    firstPassMs: null,
    traj: [],
    maxPct: 0,
    endRow: "",
    samples: null,
    ladder: [],
    raster: null,
    invalid: null,
  };
  let lastMinute = 0;
  for (;;) {
    const snap = await page.evaluate(() => {
      const row = document.getElementById("surfaceProgress");
      const err = document.getElementById("renderError");
      return {
        state: window.__surfaceState?.() ?? null,
        row:
          row && !row.classList.contains("hidden")
            ? (row.textContent ?? "")
            : "",
        error:
          err && !err.classList.contains("hidden")
            ? (err.textContent ?? "").trim()
            : null,
      };
    });
    const elapsed = Date.now() - t0;
    if (snap.error) {
      rec.invalid = `render error banner: ${snap.error}`;
      rec.ms = elapsed;
      return rec;
    }
    const state = snap.state;
    if (state) {
      if (state.engine) rec.engine = state.engine;
      if (state.firstFrame && !rec.entered) {
        rec.entered = true;
        rec.enteredMs = elapsed;
      }
      if (state.mode !== "surface") {
        rec.invalid = `left surface mode after ${(elapsed / 1000).toFixed(1)}s`;
        rec.ms = elapsed;
        return rec;
      }
    }
    const row = snap.row ? parseRow(snap.row) : null;
    if (row) rec.endRow = snap.row.trim();
    if (row && row.phase === "settle") {
      rec.maxPct = Math.max(rec.maxPct, row.pct);
      // The percentage TRAJECTORY, deduplicated. The pass-0 checkpoint is
      // recovered from it below rather than from the pass token, because a
      // token can be MISSED: at a small raster a whole pass can pass
      // between two polls (measured on the SwiftShader smoke run — a
      // compute leg whose ladder starts at p3), and a checkpoint read off
      // the first token seen would then be a whole pass late. The
      // trajectory cannot skip: the percentage only rises.
      if (
        rec.traj.length === 0 ||
        rec.traj[rec.traj.length - 1].pct !== row.pct
      ) {
        rec.traj.push({ ms: elapsed, pct: row.pct });
      }
      if (row.samples !== null) {
        rec.samples = row.samples;
        if (rec.firstPassSeen === null) {
          rec.firstPassSeen = row.pass;
          rec.firstPassMs = elapsed;
        }
        if (!rec.ladder.some((e) => e.pass === row.pass)) {
          rec.ladder.push({ pass: row.pass, ms: elapsed, pct: row.pct });
        }
      }
    }
    if (state?.settled === true) {
      rec.settled = true;
      rec.ms = elapsed;
      rec.maxPct = Math.max(rec.maxPct, 100);
      break;
    }
    if (elapsed > timeoutMs) {
      rec.ms = elapsed;
      break;
    }
    if (elapsed - lastMinute >= 60_000) {
      lastMinute = elapsed;
      log(
        `  ${leg.id}: t=${(elapsed / 1000).toFixed(0)}s "${rec.endRow || "(row hidden)"}"`,
      );
    }
    await page.waitForTimeout(POLL_MS);
  }
  resolvePass0(rec);
  rec.raster = await page.evaluate(() => {
    const canvas = document.querySelector("#container canvas");
    return canvas ? { w: canvas.width, h: canvas.height } : null;
  });
  return rec;
}

/** A ratio of two leg times where either may be a CENSORED lower bound (a
 * leg that hit the budget without settling). The bound's direction is
 * mechanical: censoring can only make the numerator larger and the
 * denominator larger, so a censored numerator gives `>=` and a censored
 * denominator gives `<=`; both censored gives neither, and says so. */
function ratio(a, b, pick) {
  const av = pick(a);
  const bv = pick(b);
  if (av === null || bv === null || bv === 0) return "n/a";
  const value = `x${(av / bv).toFixed(2)}`;
  if (!a.settled && !b.settled)
    return `~${value} [BOTH CENSORED — not a bound]`;
  if (!a.settled) return `>=${value}`;
  if (!b.settled) return `<=${value}`;
  return value;
}

const secs = (ms) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)}s`);
const censored = (rec) => (rec.settled ? "" : ">");

function reportBlock(records, args) {
  const by = Object.fromEntries(records.map((r) => [r.id, r]));
  process.stdout.write("\n");
  process.stdout.write(
    `  leg          engine   entered    pass0     settle     reached  samples  raster\n`,
  );
  for (const rec of records) {
    // "trace" is settle minus entry: the WebGL arm's fold program link
    // (~25s on Mesa) lands entirely in `entered` and compute never pays
    // it, so the two columns bracket the answer.
    process.stdout.write(
      `  ${rec.id.padEnd(12)} ${String(rec.engine).padEnd(8)} ` +
        `${secs(rec.enteredMs).padStart(8)}  ${secs(rec.pass0Ms).padStart(8)}  ` +
        `${(censored(rec) + secs(rec.ms)).padStart(9)}  ` +
        `${(rec.settled ? "100%" : `${rec.maxPct}%`).padStart(6)}  ` +
        `${String(rec.samples ?? "?").padStart(7)}  ` +
        `${rec.raster ? `${rec.raster.w}x${rec.raster.h}` : "?"}\n`,
    );
  }
  process.stdout.write("\n");
  for (const rec of records) {
    const ladder =
      rec.ladder.length === 0
        ? "(no pass token seen — the leg never reached pass 2)"
        : rec.ladder
            .sort((x, y) => x.pass - y.pass)
            .map((e) => `p${e.pass}@${e.pct}%/${(e.ms / 1000).toFixed(0)}s`)
            .join(" ");
    process.stdout.write(`  ladder ${rec.id.padEnd(12)} ${ladder}\n`);
    process.stdout.write(
      `  row    ${rec.id.padEnd(12)} ${rec.endRow || "(hidden)"}\n`,
    );
    // The renderer's own accounting of the job this script timed — see
    // COMPUTE_SETTLE_RE. Compute legs only, completed settles only.
    const device = (rec.console ?? [])
      .map((line) => COMPUTE_SETTLE_RE.exec(line))
      .filter((m) => m !== null)
      .pop();
    if (device) {
      const [, w, h, wall, passes, hit, miss, exhausted] = device;
      const rays = Number(w) * Number(h);
      process.stdout.write(
        `  device ${rec.id.padEnd(12)} ${w}x${h}=${rays} rays  ` +
          `${(Number(wall) / 1000).toFixed(1)}s wall  ${passes} passes  ` +
          `hit ${hit} (${((Number(hit) / rays) * 100).toFixed(1)}%) ` +
          `miss ${miss} exhausted ${exhausted}\n`,
      );
    }
  }
  const late = records.filter(
    (r) =>
      r.pass0Pct !== null &&
      r.samples !== null &&
      r.pass0Pct >= (2 * 100) / r.samples,
  );
  if (late.length > 0) {
    process.stdout.write(
      `\n  NOTE: the poll cadence caught pass 0's completion LATE on ` +
        `${late.map((r) => r.id).join(", ")} (first sample past the ` +
        `boundary already read ${late.map((r) => `${r.pass0Pct}%`).join(", ")}), ` +
        `so those pass0 figures are UPPER bounds.\n`,
    );
  }
  const co = by["compute/off"];
  const wo = by["webgl/off"];
  const cn = by["compute/on"];
  const wn = by["webgl/on"];
  const trace = (r) =>
    r.ms === null || r.enteredMs === null ? null : r.ms - r.enteredMs;
  process.stdout.write("\n  RATIOS — the answer this instrument exists for\n");
  if (co && wo) {
    process.stdout.write(
      `    compute:webgl  balloon OFF   settle ${ratio(co, wo, (r) => r.ms)}` +
        `   trace ${ratio(co, wo, trace)}   pass0 ${ratio(co, wo, (r) => r.pass0Ms)}\n`,
    );
  }
  if (cn && wn) {
    process.stdout.write(
      `    compute:webgl  balloon ON    settle ${ratio(cn, wn, (r) => r.ms)}` +
        `   trace ${ratio(cn, wn, trace)}   pass0 ${ratio(cn, wn, (r) => r.pass0Ms)}\n`,
    );
  }
  process.stdout.write(
    "\n  BALLOON PENALTY (on/off within one arm) — the same claim read the other way\n",
  );
  if (cn && co) {
    process.stdout.write(
      `    compute        on:off        settle ${ratio(cn, co, (r) => r.ms)}` +
        `   trace ${ratio(cn, co, trace)}   pass0 ${ratio(cn, co, (r) => r.pass0Ms)}\n`,
    );
  }
  if (wn && wo) {
    process.stdout.write(
      `    webgl          on:off        settle ${ratio(wn, wo, (r) => r.ms)}` +
        `   trace ${ratio(wn, wo, trace)}   pass0 ${ratio(wn, wo, (r) => r.pass0Ms)}\n`,
    );
  }
  process.stdout.write(
    `\n  READ IT AS: the balloon-ON compute:webgl ratio MUCH worse than the\n` +
      `  balloon-OFF one (equivalently: compute's on:off penalty much worse\n` +
      `  than webgl's) is "compute is pathological for the balloon". The two\n` +
      `  ratios close together is "compute is simply the slower arm here",\n` +
      `  whatever their size.` +
      (args.pose ? "" : "\n  POSE WAS NOT PINNED — see the warning above.") +
      "\n",
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const system = SYSTEMS[args.system];
  const legs = args.only
    ? LEGS.filter((leg) => args.only.includes(leg.id))
    : LEGS;
  const { env, headless, args: flags } = launchOptions(args.display);
  log(
    `system=${args.system} scale=${args.scale} radius=${args.radius} ` +
      `legTimeout=${(args.legTimeoutMs / 1000).toFixed(0)}s repeat=${args.repeat} ` +
      `display=${args.display ?? "(headless SwiftShader — TIMES ARE NOT A VERDICT)"}`,
  );
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    headless,
    args: flags,
    env,
  });
  const failures = [];
  try {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: VIEWPORT,
      deviceScaleFactor: args.scale,
      // The boot auto-orbit / 4D tumble follow this, and a rotor that
      // advanced for a different number of frames between two loads would
      // frame two legs differently. Surface mode's early return freezes
      // the motion tick anyway; this makes the pre-entry gap deterministic
      // too.
      reducedMotion: "reduce",
    });
    const consoleLines = [];
    page.on("console", (msg) => {
      const text = msg.text();
      // `npm run preview` serves a self-signed cert, so the service
      // worker refuses to register on every single load — two lines per
      // leg that say nothing about the render. Everything else is kept.
      if (PREVIEW_ORIGIN_NOISE.test(text)) return;
      // The app's own surface breadcrumbs all start "Surface": the tracer
      // line names the ADAPTER ("Surface render: WebGPU compute tracer
      // active (…)"), the fit line says the compute raster was CAPPED
      // ("Surface compute: tracing WxH for a WxH raster"), the settle line
      // is the compute arm's own accounting of the job this script is
      // timing (see COMPUTE_SETTLE_RE), and a device loss says so.
      // Warnings and errors ride along whatever they say.
      if (
        msg.type() === "error" ||
        msg.type() === "warning" ||
        text.startsWith("Surface")
      ) {
        consoleLines.push(`${msg.type()}: ${text}`);
      }
    });
    page.on("pageerror", (e) => consoleLines.push(`uncaught: ${e.message}`));

    // ---- pose + adapter, both asked once on the plain document ---------
    const plainHash = enc(
      sceneDoc({ system, balloon: false, radius: args.radius, pose: null }),
    );
    await openScene(page, {
      url: args.url,
      tag: "probe",
      hash: plainHash,
      engine: "compute",
      surfperf: args.surfperf,
    });
    const adapter = await probeAdapter(page);
    log(
      `adapter: gpu=${adapter.gpu} adapter=${adapter.adapter}` +
        (adapter.vendor ? ` vendor=${adapter.vendor}` : "") +
        (adapter.architecture ? ` arch=${adapter.architecture}` : ""),
    );
    if (!adapter.adapter && legs.some((l) => l.engine === "compute")) {
      throw new HarnessError(
        "no WebGPU adapter — there is no compute arm to compare, so this run has no question to ask",
      );
    }
    let pose = null;
    if (args.pose) {
      try {
        pose = await readPose(page);
        log(
          `pose pinned from the app's own share link: ` +
            `${JSON.stringify(pose.camera)}`,
        );
      } catch (e) {
        log(
          `WARNING: could not read the app's pose (${e instanceof Error ? e.message : String(e)}).`,
        );
        log(
          `WARNING: legs run UNPINNED — direct boots use deterministic BOOT_SEED, but`,
        );
        log(
          `WARNING: identical framing is not captured as an explicit harness artifact. Read with care.`,
        );
      }
    } else {
      log(
        "--nopose: legs use deterministic boot auto-frames, without an explicit shared pose (see WEAKNESSES).",
      );
    }

    // The matching claim about the documents themselves, diffed rather
    // than asserted: build both and show that `balloonEcho` is the only
    // field that moves.
    const docOff = sceneDoc({
      system,
      balloon: false,
      radius: args.radius,
      pose,
    });
    const docOn = sceneDoc({
      system,
      balloon: true,
      radius: args.radius,
      pose,
    });
    const moved = Object.keys(docOn).filter(
      (k) => JSON.stringify(docOn[k]) !== JSON.stringify(docOff[k]),
    );
    log(`documents differ in: ${moved.join(", ")}`);
    if (moved.length !== 1 || moved[0] !== "balloonEcho") {
      failures.push(
        `the two documents differ in ${moved.join(", ")} — the legs are not matched`,
      );
    }

    for (let block = 0; block < args.repeat; block++) {
      if (args.repeat > 1) log(`---- block ${block + 1}/${args.repeat} ----`);
      const records = [];
      for (const leg of legs) {
        const tag = `${leg.id.replace("/", "-")}-b${block}`;
        const hash = enc(
          sceneDoc({
            system,
            balloon: leg.balloon,
            radius: args.radius,
            pose,
          }),
        );
        const before = consoleLines.length;
        await openScene(page, {
          url: args.url,
          tag,
          hash,
          engine: leg.engine,
          surfperf: args.surfperf,
        });
        log(`leg ${leg.id}: entering Surface (forced ${leg.engine})...`);
        const rec = await driveLeg(page, leg, args.legTimeoutMs);
        rec.console = consoleLines.slice(before);
        records.push(rec);
        log(
          `  ${leg.id}: ${rec.settled ? `SETTLED ${secs(rec.ms)}` : `DID NOT SETTLE (${rec.maxPct}% at ${secs(rec.ms)})`} ` +
            `engine=${rec.engine} entered=${secs(rec.enteredMs)} pass0=${secs(rec.pass0Ms)} ` +
            `samples=${rec.samples ?? "?"}`,
        );
        for (const line of rec.console) log(`  console ${line}`);
        // Leave surface mode so the renderer tears down before the next
        // navigation, the way the 4D gate does.
        await page.click("#modePointsBtn").catch(() => {});

        // ---- the matching assertions, per leg -------------------------
        if (rec.invalid) {
          failures.push(`${leg.id}: ${rec.invalid}`);
        }
        if (rec.engine !== leg.engine) {
          failures.push(
            `${leg.id}: took engine ${String(rec.engine)}, asked for ${leg.engine}` +
              ` — this leg cannot be compared`,
          );
        }
      }

      const counts = [
        ...new Set(
          records
            .map((r) => r.samples)
            .filter((n) => n !== null && n !== undefined),
        ),
      ];
      if (counts.length > 1) {
        failures.push(
          `legs disclosed DIFFERENT supersampling counts (${counts.join(", ")}) — ` +
            `an unmatched pass count fakes exactly the asymmetry under test`,
        );
      }
      const unknown = records
        .filter((r) => r.samples === null)
        .map((r) => r.id);
      if (unknown.length > 0) {
        log(
          `NOTE: ${unknown.join(", ")} never showed a pass token, so that leg's ` +
            `supersampling count is UNVERIFIED — both arms stay silent through ` +
            `pass 1, so a leg that never finished one cannot be checked against ` +
            `the others.`,
        );
      }
      const rasters = [
        ...new Set(
          records
            .map((r) => (r.raster ? `${r.raster.w}x${r.raster.h}` : null))
            .filter((s) => s !== null),
        ),
      ];
      if (rasters.length > 1) {
        failures.push(
          `legs ran at DIFFERENT rasters (${rasters.join(", ")}) — not comparable`,
        );
      }
      reportBlock(records, args);
    }
  } finally {
    await browser.close();
  }
  if (failures.length > 0) {
    for (const f of failures) log(`FAIL ${f}`);
    log(
      "VERDICT: the legs were NOT matched — read the numbers with that in mind",
    );
    process.exit(3);
  }
  log(
    `VERDICT: ${String(legs.length * args.repeat)} matched legs measured` +
      (legs.length < LEGS.length ? " (--only: a PARTIAL matrix)" : ""),
  );
}

main().catch((e) => {
  if (e instanceof HarnessError) {
    process.stderr.write(`[balloon-engine-ab] HARNESS: ${e.message}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `[balloon-engine-ab] HARNESS: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
  );
  process.exit(1);
});
