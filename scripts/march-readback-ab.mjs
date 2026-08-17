#!/usr/bin/env node
/**
 * fr-si66 march-readback A/B: measures the REAL-DRIVER cost of the WebGPU
 * compute surface renderer's per-sweep host readback, before and after the
 * change that swaps a whole-ray-state readback for a per-active-ray status
 * side channel.
 *
 * THE TWO ARMS ARE THE TRACE VOCABULARY, NOT A SCRIPT FLAG. `runFrame` in
 * src/app/surface-compute.ts used to read the ENTIRE 16 B/ray `states`
 * buffer back to the host after every march sweep just to look at one field
 * of it (`states readback BEGIN rays=<R>` / `states readback END` in the
 * `?surfacetrace` log); it now reads a 4 B-per-ACTIVE-ray status side
 * channel instead (`status readback BEGIN active=<A>` / `status readback
 * END`). This script parses BOTH vocabularies with ONE parser — keyed off
 * the label before " readback" — so the identical script runs unmodified
 * against either arm. Drive it once per arm, `git stash` between runs:
 *
 *   node scripts/march-readback-ab.mjs --label=before   # current worktree
 *   git stash                                           # -> the other arm
 *   <reload not required: a fresh page load re-fetches the built bundle,
 *    so restart/rebuild whatever dev server --url points at>
 *   node scripts/march-readback-ab.mjs --label=after
 *   git stash pop                                       # restore worktree
 *
 * This is a MEASUREMENT INSTRUMENT, not a gate: it always exits 0 once the
 * browser is up and driving the page — a settle timeout is DATA, not a
 * failure, and gets reported like everything else. It exits 1 only if it
 * could not run at all (browser launch/navigation failure or similar).
 *
 * MODELED ON scripts/fold-settle-park.repro.mjs: the headed-Chrome-on-:0
 * launch recipe (real Vulkan, not headless SwiftShader — a software device
 * has nothing worth timing here), the `enc()` scene-hash encoder, the
 * embedded mandelboxKifs preset (the surface fold monster fr-si66's own
 * bead measures against), the `#modeSurfaceBtn` click, and the
 * `?surfacestate` / `window.__surfaceState()` settle-latch poll — copied
 * close to verbatim. The header-comment style (what/why/how-to-read the
 * output) follows scripts/shade-width-ab.mjs.
 *
 * WHERE THE TRACE COMES FROM: main.ts's `?surfacetrace` handler logs every
 * frame-loop trace line as `console.debug(\`[surfacetrace] ${line}\`)` AND
 * appends it to a `window.__surfaceTraceLog` ring buffer CAPPED AT 6000
 * LINES — far short of a full settle. This script therefore reads the PAGE
 * CONSOLE directly (a `page.on("console", ...)` listener attached before
 * navigation), never the ring buffer.
 *
 * TRACE LINE FORMAT (surface-compute.ts's `runFrame`, its local `tr()`):
 * every line is `[<ms>ms] <text>`, where `<ms>` is
 * `performance.now() - traceT0` and `traceT0` RESETS AT THE START OF EACH
 * FRAME — so a ms delta is only meaningful between two lines of the SAME
 * frame, which is exactly what every BEGIN/END pair here is (a readback
 * never spans a frame boundary; the frame loop `await`s each one to
 * completion before starting the next). Lines this script keys off:
 *
 *   frame start rays=<R> marchSteps=... budgetMs=... ...   R = this frame's rays
 *   states readback BEGIN rays=<R>  /  states readback END   OLD arm, R*16 B
 *   status readback BEGIN active=<A> / status readback END   NEW arm, A*4 B
 *   present readback BEGIN / present readback END            control, R*4 B
 *   final readback BEGIN                       no END by design; R*4 B, untimed
 *   frame done passes=... truncated=... hit=... ...
 *
 * READING THE OUTPUT: the per-kind table's "sweep" row (`states` or
 * `status`, whichever the running arm actually emitted — never both) is the
 * number fr-si66 is about: its totalMs is host time blocked on readbacks
 * this change avoids, its totalMiB the PCIe/host-copy traffic saved. Divide
 * the two arms' sweep totalMs/totalMiB to get the speedup/reduction
 * directly; the sweep COUNT should match closely across arms (same march
 * schedule either side of fr-si66) so it doubles as a sanity check that
 * both runs did comparable work. `present` is the unrelated progressive-
 * present readback, reported as a control — unaffected by fr-si66, so it
 * should read ~equal across arms. `final` is the once-per-frame terminal
 * color readback: counted (and sized, from the same rays*4 formula as
 * `present`) but never timed, since it has no END trace line by design.
 *
 * WHERE THE TIME WENT: the report closes with the settle's GPU-submission
 * time split MARCH vs SHADE beside the sweep-readback total, and each as a
 * percentage of the three. A readback number on its own invites a guess
 * about which half of the loop the rest of the settle went to — this is
 * the line that answers it instead, and it is scene-dependent enough to
 * be worth reading every time (a thin-dust system is march-bound, a
 * frame-filling one shade-bound, and the readback's SHARE differs by an
 * order of magnitude between them).
 *
 * PER-SWEEP MEANS ARE THE TRUNCATION-SAFE COMPARISON: if a scene does not
 * reach a completed settle before `--capMs`, the two arms' sweep COUNTS and
 * TOTALS will legitimately differ (whichever arm got further did more
 * work) — but the mean ms and mean bytes PER SWEEP stay comparable
 * regardless, since they normalize that difference away. The per-kind
 * table prints each total next to its own mean; the sweep row's mean is
 * additionally called out on its own "SWEEP HEADLINE" line so it is not
 * missed when a run did not settle.
 *
 * SCENE CHOICE: `--scene` picks which embedded document to load — both are
 * fold-shaped (same WebGPU compute path fr-si66 touches,
 * `deHasFolds(de) === true`), so either is a valid arm subject, but they
 * trade completeness for cost:
 *   mandelboxKifs (default) — the surface fold monster fr-si66's own bead
 *     measures against, 14 maps. Thorough, but heavy: at a 1400x900 window
 *     it was measured reaching only ~9% of one settle in 90s on the
 *     hardware this was written for, which makes a COMPLETED settle
 *     impractical per arm and pushes every run to the `--capMs` fallback.
 *   boxfoldPair — scripts/surface-repro.verify.mjs's `SCENARIOS` boxfold3
 *     entry: the same 2-map boxfold pair, but MINTED with a pinned camera
 *     pose rather than pose-less (see the `BOXFOLD_PINNED_HASH` comment
 *     below for why that matters here). Settles in a fraction of the
 *     time, so an A/B against it can compare two COMPLETED settles end to
 *     end instead of two arbitrary truncation points — and the pinned
 *     pose means the two arms trace the IDENTICAL pose too, so sweep
 *     counts and totals compare exactly, not just their per-sweep means.
 *
 * Usage:
 *   node scripts/march-readback-ab.mjs [--display=:0]
 *     [--url=https://localhost:5174] [--capMs=600000] [--label=unlabelled]
 *     [--scene=mandelboxKifs] [--width=1400] [--height=900]
 *     [--out=/tmp/march-readback-<label>.json]
 *
 *   --display  X display to launch headed Chrome on (real Vulkan driver).
 *   --url      Base URL of an already-running dev server. This script does
 *              not build or serve anything itself.
 *   --capMs    Give up waiting for the settle latch after this long; the
 *              trace collected so far is still summarized and reported.
 *   --label    Tags this run's output ("before"/"after", "states"/
 *              "status", whatever distinguishes the two `git stash` arms).
 *   --scene    `mandelboxKifs` (default, thorough/heavy) or `boxfoldPair`
 *              (cheap, settles fast) — see "SCENE CHOICE" above.
 *   --width/--height  Browser window (viewport) size. The surface pane's
 *              actual raster comes out of the trace's own `frame start
 *              rays=`, not from these — they only set what the page sees.
 *   --out      Where the JSON summary is also written (as well as printed
 *              on stdout prefixed `[march-readback] JSON `).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

function numArg(name, fallback) {
  if (!(name in args)) return fallback;
  const n = Number(args[name]);
  if (!Number.isFinite(n)) {
    throw new Error(`--${name}: not a number: "${args[name]}"`);
  }
  return n;
}

const DISPLAY = args.display ?? ":0";
const BASE = String(args.url ?? "https://localhost:5174").replace(/\/+$/, "");
const CAP_MS = numArg("capMs", 600000);
const LABEL = typeof args.label === "string" ? args.label : "unlabelled";
const SCENE = typeof args.scene === "string" ? args.scene : "mandelboxKifs";
const WIDTH = numArg("width", 1400);
const HEIGHT = numArg("height", 900);
const OUT =
  typeof args.out === "string" ? args.out : `/tmp/march-readback-${LABEL}.json`;
// Undocumented escape hatch, same as fold-settle-park.repro.mjs's own.
const CHROME = args.chrome ?? "/usr/bin/google-chrome";
const POLL_MS = 5000;
const TRACE_PREFIX = "[surfacetrace] ";

const log = (...a) => console.log("[march-readback]", ...a);

const enc = (scene) =>
  "#v1=" + Buffer.from(JSON.stringify(scene)).toString("base64url");

const sceneBase = {
  numPoints: 100000,
  pointSize: 1,
  colorMode: "transform",
  renderStyle: "depthFade",
  showGuides: false,
  balloonEcho: false,
  balloonRadius: 1.6,
};

// The REAL mandelboxKifs preset (presets.ts:722) — the surface fold
// monster; eligibility depends on these exact numbers. Copied verbatim
// from scripts/fold-settle-park.repro.mjs (itself copied from
// scripts/balloon-real-driver.verify.mjs).
const mandelboxKifs = (() => {
  const transforms = [];
  for (const x of [1, -1])
    for (const y of [1, -1])
      for (const z of [1, -1])
        transforms.push({
          position: [x * 0.7, y * 0.7, z * 0.7],
          rotation: [0, 0, 0],
          scale: [0.19, 0.19, 0.19],
          variations: [{ type: "mandelbox", weight: 1.2 }],
        });
  for (const c of [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ])
    transforms.push({
      position: [c[0] * 0.62, c[1] * 0.62, c[2] * 0.62],
      rotation: [0, 0, 0],
      scale: [0.66, 0.66, 0.66],
      variations: [{ type: "boxfold", weight: 1 }],
    });
  return { ...sceneBase, transforms };
})();

/** scripts/surface-repro.verify.mjs's `SCENARIOS` table, the `boxfold3`
 * entry's minted hash — copied verbatim. The CHEAP scene
 * (`--scene=boxfoldPair`, see the module doc's "SCENE CHOICE"): the same
 * fr-jmat 2-map boxfold pair as surface-fold.verify.mjs's `BOXFOLD_HASH`
 * (this constant's transforms are bit-identical to it), fold-shaped like
 * mandelboxKifs (`deHasFolds(de) === true`, same WebGPU compute path) but
 * settling in a fraction of the time — EXCEPT that hash is pose-less,
 * where this one is POSE-PINNED: surface-repro.verify.mjs's own `--mint`
 * mode booted the pose-less document, let it auto-frame, and re-encoded
 * the result with the resulting `camera` block baked in.
 *
 * WHY THE PINNED POSE MATTERS FOR THIS A/B: a pose-less document boots
 * from a `Math.random()`-seeded point cloud, so its auto-frame lands on a
 * slightly different camera (radius/target a few tenths of a percent
 * apart) on every load — the exact drift surface-repro.verify.mjs's own
 * module doc measures and its fr-opgk pinned-pose discipline exists to
 * remove. A different pose marches a different set of rays through a
 * different empty-space/fold-branch mix, so two `git stash` arms loading
 * a pose-less scene would not be tracing the same work end to end — only
 * the PER-SWEEP MEANS (see that section of this module doc) would still
 * be safe to compare, not the raw sweep counts/totals. Pinning the pose
 * makes both arms trace the IDENTICAL scene from the IDENTICAL viewpoint,
 * so counts and totals compare exactly too, not just their means.
 *
 * Already a full `#v1=` hash rather than a JS scene object, so it is used
 * directly instead of round-tripped through enc(). Sets
 * `showGuides: true` — harmless, left as authored. */
const BOXFOLD_PINNED_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjEsMF0sInJvdGF0aW9uIjpbMC4zLDAuMiwwXSwic2NhbGUiOlswLjQ1LDAuNDUsMC40NV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjoxfV19LHsicG9zaXRpb24iOlstMC4zNSwtMC4yLDAuM10sInJvdGF0aW9uIjpbMCwwLjUsMC4xXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjowLjl9XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiY2FtZXJhIjp7InRhcmdldCI6WzAuMTcyNiwtMC4wNjYsMC4yNDUyXSwicmFkaXVzIjoxLjQ2MDEsInRoZXRhIjowLjc4NTQsInBoaSI6MS4wNTZ9fQ";

/** `--scene=<name>` registry: `mandelboxKifs` needs enc()'d, `boxfoldPair`
 * is already a `#v1=` hash — both resolve to a callable so the lookup site
 * (driveSession) doesn't care which. */
const SCENES = {
  mandelboxKifs: () => enc(mandelboxKifs),
  boxfoldPair: () => BOXFOLD_PINNED_HASH,
};
if (!(SCENE in SCENES)) {
  throw new Error(
    `--scene: unknown scene "${SCENE}" (must be one of: ${Object.keys(SCENES).join(", ")})`,
  );
}

// ---------------------------------------------------------------------------
// Trace parsing — the part that must survive an arm switch untouched.
// ---------------------------------------------------------------------------

/** Every `?surfacetrace` line is `[<ms>ms] <body>` — see the module doc's
 * "TRACE LINE FORMAT". */
const TRACE_LINE_RE = /^\[(\d+)ms\] (.*)$/;
const FRAME_START_RE = /^frame start rays=(\d+)/;
const FRAME_DONE_RE = /^frame done passes=(\d+) truncated=(\S+)/;
/** Keys a readback BEGIN/END pair off the label BEFORE " readback" — the
 * one thing that differs between the OLD (`states`) and NEW (`status`)
 * vocabulary; everything else about the line shape is shared. */
const READBACK_RE = /^(\w+) readback (BEGIN|END)\b(.*)$/;
/** The frame loop's own GPU-submission timings — the CONTEXT a readback
 * number is meaningless without. Without them "the readback costs X ms"
 * cannot be turned into "X% of the settle", and worse, it invites a guess
 * about which half of the loop the rest of the time went to. Both are
 * `<kind> END ms=<n>` with a one-decimal float (or the literal `null`
 * when the frame was superseded mid-dispatch, which is not a timing). */
const DISPATCH_END_RE = /^(march|shade) END ms=([0-9.]+)$/;
/** Which QUEUE a shade dispatch drained (fr-257o). The two are different
 * animals — a FREE batch does one background write per ray and is capped
 * at a flat `SURFACE_COMPUTE_MAX_SHADE_BATCH`, a HIT batch pays the
 * on-surface probe evals and is sized predictively — so a single shade
 * mean over both says nothing about either. The BEGIN line carries the
 * flag; the very next `shade END` is its own, because the frame loop
 * awaits each dispatch before encoding the next. */
const SHADE_BEGIN_RE = /^shade BEGIN isFree=(true|false)\b/;
/** `final readback BEGIN` has no matching END by design (see module doc) —
 * this is the one label {@link summarize} never opens against later END. */
const UNTIMED_READBACK_LABEL = "final";
/** The sweep kind is whichever of these the running arm actually emits;
 * never both in one trace (one script run is one build, one arm). */
const SWEEP_LABELS = ["states", "status"];

function bytesForReadback(label, extra) {
  if (extra === null || extra === undefined) return 0;
  if (label === "states") return extra * 16; // whole ray-state record (OLD)
  if (label === "status") return extra * 4; // one status word/active ray (NEW)
  return extra * 4; // present/final (and any future kind): the color buffer
}

/**
 * Parses the collected `[surfacetrace] `-stripped body lines (each still
 * carrying its own leading `[<ms>ms] `) into per-readback-kind statistics.
 * Handles both the OLD (`states`) and NEW (`status`) vocabulary with the
 * same code — see the module doc's "TRACE LINE FORMAT".
 */
function summarize(rawLines) {
  const kinds = new Map(); // label -> { count, timedCount, totalMs, totalBytes }
  const openBegins = new Map(); // label -> { ms, extra }
  const unmatchedBegins = []; // BEGIN that never saw its END
  let framesTraced = 0;
  let framesCompleted = 0;
  let lastFrameRays = null;
  let lastFrameTruncated = null;
  let unparsedLines = 0;
  /** GPU-submission time by half of the frame loop, so the readback
   * totals can be read as a SHARE of the settle rather than in a vacuum. */
  const dispatch = {
    march: { count: 0, totalMs: 0 },
    shade: { count: 0, totalMs: 0 },
    // fr-257o: the same shade time split by which queue it drained.
    shadeFree: { count: 0, totalMs: 0 },
    shadeHit: { count: 0, totalMs: 0 },
  };
  let pendingShadeIsFree = null;

  const kindStat = (label) => {
    let s = kinds.get(label);
    if (!s) {
      s = { count: 0, timedCount: 0, totalMs: 0, totalBytes: 0 };
      kinds.set(label, s);
    }
    return s;
  };

  for (const raw of rawLines) {
    const lineMatch = TRACE_LINE_RE.exec(raw);
    if (!lineMatch) {
      unparsedLines++;
      continue;
    }
    const ms = Number(lineMatch[1]);
    const body = lineMatch[2];

    const frameStart = FRAME_START_RE.exec(body);
    if (frameStart) {
      framesTraced++;
      lastFrameRays = Number(frameStart[1]);
      continue;
    }
    const frameDone = FRAME_DONE_RE.exec(body);
    if (frameDone) {
      framesCompleted++;
      lastFrameTruncated = frameDone[2] === "true";
      continue;
    }

    const shadeBegin = SHADE_BEGIN_RE.exec(body);
    if (shadeBegin) {
      pendingShadeIsFree = shadeBegin[1] === "true";
      continue;
    }

    const dispatchEnd = DISPATCH_END_RE.exec(body);
    if (dispatchEnd) {
      const half = dispatch[dispatchEnd[1]];
      const ms = Number(dispatchEnd[2]);
      half.count++;
      half.totalMs += ms;
      if (dispatchEnd[1] === "shade" && pendingShadeIsFree !== null) {
        const queue = pendingShadeIsFree
          ? dispatch.shadeFree
          : dispatch.shadeHit;
        queue.count++;
        queue.totalMs += ms;
        pendingShadeIsFree = null;
      }
      continue;
    }

    const rb = READBACK_RE.exec(body);
    if (!rb) continue; // sweep-done/ANOMALY lines — not ours
    const [, label, beginOrEnd, rest] = rb;

    if (beginOrEnd === "BEGIN") {
      const raysMatch = /rays=(\d+)/.exec(rest);
      const activeMatch = /active=(\d+)/.exec(rest);
      const extra = raysMatch
        ? Number(raysMatch[1])
        : activeMatch
          ? Number(activeMatch[1])
          : lastFrameRays; // present/final: no field of their own, R comes
      // from the enclosing frame's own "frame start rays=" line.

      if (label === UNTIMED_READBACK_LABEL) {
        const s = kindStat(label);
        s.count++;
        s.totalBytes += bytesForReadback(label, extra);
        continue; // never opened — there is no END to pair it with
      }

      const dangling = openBegins.get(label);
      if (dangling) {
        // The previous BEGIN of this label never saw its END — a
        // truncated/aborted frame (budget cut, token change, page torn
        // down mid-readback). Count what we can, flag it, move on.
        unmatchedBegins.push({ label, extra: dangling.extra });
        const s = kindStat(label);
        s.count++;
        s.totalBytes += bytesForReadback(label, dangling.extra);
      }
      openBegins.set(label, { ms, extra });
      continue;
    }

    // END
    const begin = openBegins.get(label);
    if (!begin) continue; // END with no BEGIN on record — ignore, don't crash
    openBegins.delete(label);
    const s = kindStat(label);
    s.count++;
    s.timedCount++;
    s.totalMs += ms - begin.ms;
    s.totalBytes += bytesForReadback(label, begin.extra);
  }

  // Anything still open at the end of the log lost its END because the
  // trace stopped mid-readback (settle declared, cap hit, page closed).
  for (const [label, begin] of openBegins) {
    unmatchedBegins.push({ label, extra: begin.extra });
    const s = kindStat(label);
    s.count++;
    s.totalBytes += bytesForReadback(label, begin.extra);
  }

  return {
    kinds,
    dispatch,
    unmatchedBegins,
    framesTraced,
    framesCompleted,
    lastFrameRays,
    lastFrameTruncated,
    unparsedLines,
  };
}

// ---------------------------------------------------------------------------
// Browser driving — launch mechanics + settle poll copied close to verbatim
// from scripts/fold-settle-park.repro.mjs.
// ---------------------------------------------------------------------------

async function driveSession() {
  log(
    `starting: url=${BASE} display=${DISPLAY} capMs=${CAP_MS} label=${LABEL} scene=${SCENE} width=${WIDTH} height=${HEIGHT}`,
  );

  const browser = await chromium.launch({
    executablePath: CHROME,
    // HEADED is load-bearing — see fold-settle-park.repro.mjs: headless
    // Chrome's Vulkan lands on SwiftShader, and a software device's
    // readback timing carries no signal for this measurement.
    headless: false,
    env: { ...process.env, DISPLAY },
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
  });

  const traceLines = [];
  const consoleIssues = [];
  let settled = false;
  let settleWallMs = null;
  let renderErrorText = null;
  let finalProbe = null;

  try {
    const ctx = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: WIDTH, height: HEIGHT },
      // scripts/surface-repro.verify.mjs's idiom: kills the entry glide and
      // the 3D auto-orbit (prefers-reduced-motion), either of which would
      // keep invalidating the settle and adding un-comparable frames/sweeps
      // to the trace this script is trying to measure.
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();

    // Attached BEFORE navigation, per the brief: main.ts's ?surfacetrace
    // ring buffer caps at 6000 lines, far short of a full settle, so the
    // page console — not window.__surfaceTraceLog — is this script's
    // source of truth.
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.startsWith(TRACE_PREFIX)) {
        traceLines.push(text.slice(TRACE_PREFIX.length));
        return;
      }
      const t = msg.type();
      if (t === "error" || t === "warning") {
        consoleIssues.push({ type: t, text });
      }
    });
    page.on("pageerror", (e) => {
      consoleIssues.push({ type: "pageerror", text: String(e) });
    });

    const hash = SCENES[SCENE]();
    const url = `${BASE}/?surfacetrace&surfacestate${hash}`;
    log(`navigating: ${url.slice(0, 100)}...`);
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    // Mutter only sends frame callbacks to VISIBLE surfaces — keep the
    // window on top so the frame loop actually advances.
    await page.bringToFront();
    await page.waitForTimeout(4000);

    const disabled = await page.evaluate(
      () => document.getElementById("modeSurfaceBtn")?.disabled ?? true,
    );
    if (disabled) {
      log("WARNING: #modeSurfaceBtn reports disabled — clicking anyway");
    }
    await page.evaluate(() =>
      document.getElementById("modeSurfaceBtn").click(),
    );
    await page.waitForTimeout(400);

    log("polling every 5s for the settle latch (window.__surfaceState())...");
    const t0 = Date.now();
    for (;;) {
      const elapsed = Date.now() - t0;
      let sample;
      try {
        sample = await page.evaluate(() => {
          const errEl = document.getElementById("renderError");
          const renderError =
            errEl && !errEl.classList.contains("hidden")
              ? errEl.textContent.trim()
              : null;
          return { renderError, probe: window.__surfaceState?.() ?? null };
        });
      } catch (e) {
        log(`page evaluate failed: ${e}`);
        break;
      }
      finalProbe = sample.probe;
      const probeDisplay = sample.probe
        ? `engine=${sample.probe.engine} settled=${sample.probe.settled} settleActive=${sample.probe.settleActive} previewActive=${sample.probe.previewActive}`
        : "(no probe)";
      log(
        `t=${Math.round(elapsed / 1000)}s traceLines=${traceLines.length} probe=[${probeDisplay}]`,
      );

      if (sample.renderError) {
        renderErrorText = sample.renderError;
        log(`RENDER ERROR BANNER: ${sample.renderError}`);
        break;
      }
      if (sample.probe && sample.probe.settled === true) {
        settled = true;
        break;
      }
      if (elapsed >= CAP_MS) {
        log(`--capMs (${CAP_MS}ms) reached without settling`);
        break;
      }
      await page.waitForTimeout(POLL_MS);
    }
    settleWallMs = Date.now() - t0;

    // Let any in-flight console events for the frame that just declared
    // settled finish arriving before the listener goes away.
    await page.waitForTimeout(500);
  } finally {
    await browser.close();
  }

  return {
    traceLines,
    consoleIssues,
    settled,
    settleWallMs,
    renderErrorText,
    finalProbe,
  };
}

// ---------------------------------------------------------------------------
// Reporting.
// ---------------------------------------------------------------------------

function fmtMs(x) {
  return x === null || x === undefined || !Number.isFinite(x)
    ? "n/a"
    : x.toFixed(1);
}
function fmtMiB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}
function round2(x) {
  return x === null || x === undefined ? null : Math.round(x * 100) / 100;
}

function printReport(summary, runResult) {
  const {
    kinds,
    unmatchedBegins,
    framesTraced,
    framesCompleted,
    lastFrameRays,
    lastFrameTruncated,
    unparsedLines,
  } = summary;
  const sweepLabels = SWEEP_LABELS.filter(
    (l) => (kinds.get(l)?.count ?? 0) > 0,
  );
  const engine = runResult.finalProbe?.engine ?? null;

  console.log(`\n=== march-readback-ab summary (label=${LABEL}) ===`);
  console.log(`scene               : ${SCENE}`);
  console.log(`engine              : ${engine ?? "n/a"}`);
  console.log(`raster (last frame) : ${lastFrameRays ?? "n/a"} rays`);
  console.log(
    `frames traced       : ${framesTraced} (completed: ${framesCompleted}` +
      `${lastFrameTruncated ? ", last frame truncated" : ""})`,
  );
  console.log(
    `settle              : ${
      runResult.settled
        ? "SETTLED"
        : runResult.renderErrorText
          ? "RENDER-ERROR"
          : "TIMEOUT"
    } after ${runResult.settleWallMs}ms` +
      (runResult.renderErrorText ? ` (${runResult.renderErrorText})` : ""),
  );
  if (engine !== null && engine !== "compute" && framesTraced === 0) {
    console.log(
      `WARNING: engine=${engine} — ?surfacetrace only instruments the WebGPU ` +
        `compute renderer's frame loop, so a non-compute session traces nothing.`,
    );
  }

  // totalMs/meanMs and totalMiB/meanMiB are printed as adjacent pairs on
  // purpose (team ask: "alongside the totals, the PER-SWEEP means") — the
  // mean is what a truncated (--capMs) arm can still compare apples to
  // apples, since totals and count both grow with however much work an
  // arm got through before the cap.
  const TABLE_HEADER =
    "readback kind        count  timed   totalMs   meanMs  totalMiB  meanMiB    totalBytes";
  console.log(`\n${TABLE_HEADER}`);
  console.log("-".repeat(TABLE_HEADER.length));
  const printed = new Set();
  const printRow = (label) => {
    if (printed.has(label)) return;
    printed.add(label);
    const s = kinds.get(label);
    if (!s) return;
    const meanMs = s.timedCount > 0 ? s.totalMs / s.timedCount : null;
    const meanBytes = s.count > 0 ? s.totalBytes / s.count : null;
    console.log(
      `${label.padEnd(20)} ${String(s.count).padStart(6)} ${String(s.timedCount).padStart(6)} ` +
        `${fmtMs(s.totalMs).padStart(9)} ${fmtMs(meanMs).padStart(8)} ` +
        `${fmtMiB(s.totalBytes).padStart(9)} ${(meanBytes === null ? "n/a" : fmtMiB(meanBytes)).padStart(8)} ` +
        `${String(s.totalBytes).padStart(14)}`,
    );
  };
  for (const label of [...sweepLabels, "present", "final"]) printRow(label);
  for (const label of [...kinds.keys()].sort()) printRow(label); // anything unexpected

  console.log();
  if (sweepLabels.length === 0) {
    console.log(
      "SWEEP HEADLINE: none observed (neither 'states' nor 'status' readback " +
        "lines seen — did the session ever sweep? see the engine line above)",
    );
  } else {
    for (const label of sweepLabels) {
      const s = kinds.get(label);
      const meanMs = s.timedCount > 0 ? s.totalMs / s.timedCount : null;
      const meanBytes = s.count > 0 ? s.totalBytes / s.count : null;
      console.log(
        `SWEEP HEADLINE (${label}): sweeps=${s.count} totalMs=${fmtMs(s.totalMs)} totalMiB=${fmtMiB(s.totalBytes)} ` +
          `| PER-SWEEP MEAN: ms=${fmtMs(meanMs)} MiB=${meanBytes === null ? "n/a" : fmtMiB(meanBytes)}`,
      );
    }
    console.log(
      "(compare the PER-SWEEP MEAN across arms if either run did not reach " +
        "a completed settle before --capMs — sweep count and totals then " +
        "differ by design since one arm did more work, but the mean should not.)",
    );
    if (sweepLabels.length > 1) {
      console.log(
        "WARNING: both 'states' and 'status' readback lines observed in one " +
          "trace — mixed vocabulary, unexpected (one run should be one arm).",
      );
    }
  }

  // The share the sweep readback actually is — the context without which
  // its ms number invites a guess about where the rest of the settle went.
  console.log();
  const marchMs = summary.dispatch.march.totalMs;
  const shadeMs = summary.dispatch.shade.totalMs;
  const sweepMs = sweepLabels.reduce(
    (acc, label) => acc + (kinds.get(label)?.totalMs ?? 0),
    0,
  );
  const accounted = marchMs + shadeMs + sweepMs;
  const pct = (ms) =>
    accounted > 0 ? `${((ms / accounted) * 100).toFixed(1)}%` : "n/a";
  console.log(
    `WHERE THE TIME WENT (GPU submissions + sweep readbacks, ${fmtMs(accounted)} ms accounted):`,
  );
  console.log(
    `  march dispatches : ${String(summary.dispatch.march.count).padStart(5)}  ${fmtMs(marchMs).padStart(9)} ms  ${pct(marchMs)}`,
  );
  console.log(
    `  shade dispatches : ${String(summary.dispatch.shade.count).padStart(5)}  ${fmtMs(shadeMs).padStart(9)} ms  ${pct(shadeMs)}`,
  );
  for (const [name, q] of [
    ["  ...free (miss)", summary.dispatch.shadeFree],
    ["  ...hit", summary.dispatch.shadeHit],
  ]) {
    const mean = q.count > 0 ? q.totalMs / q.count : null;
    console.log(
      `  ${name.padEnd(15)}: ${String(q.count).padStart(5)}  ${fmtMs(q.totalMs).padStart(9)} ms  ${pct(q.totalMs)}  (mean ${fmtMs(mean)} ms/dispatch)`,
    );
  }
  console.log(
    `  sweep readbacks  : ${String(sweepLabels.reduce((a, l) => a + (kinds.get(l)?.count ?? 0), 0)).padStart(5)}  ${fmtMs(sweepMs).padStart(9)} ms  ${pct(sweepMs)}`,
  );

  console.log();
  if (unmatchedBegins.length === 0) {
    console.log("warnings: 0 unmatched BEGIN (no matching END)");
  } else {
    console.log(
      `warnings: ${unmatchedBegins.length} unmatched BEGIN (no matching END) ` +
        `— truncated/aborted frame(s)`,
    );
    const counts = new Map();
    for (const u of unmatchedBegins) {
      counts.set(u.label, (counts.get(u.label) ?? 0) + 1);
    }
    for (const [label, count] of counts) console.log(`  ${label}: x${count}`);
  }
  if (unparsedLines > 0) {
    console.log(
      `(${unparsedLines} trace line(s) missing the "[<ms>ms] " prefix — ignored)`,
    );
  }

  if (runResult.consoleIssues.length > 0) {
    console.log(
      `\n${runResult.consoleIssues.length} console error/warning/pageerror message(s):`,
    );
    for (const c of runResult.consoleIssues.slice(0, 20)) {
      console.log(`  [${c.type}] ${c.text.slice(0, 200)}`);
    }
    if (runResult.consoleIssues.length > 20) {
      console.log(`  ... and ${runResult.consoleIssues.length - 20} more`);
    }
  }
}

function buildJsonSummary(summary, runResult) {
  const sweepLabels = SWEEP_LABELS.filter(
    (l) => (summary.kinds.get(l)?.count ?? 0) > 0,
  );
  const kindsObj = {};
  for (const [label, s] of summary.kinds) {
    // meanBytes/meanMiB are the PER-SWEEP means (team ask) — the figure
    // that stays comparable across arms even when --capMs truncated one of
    // them before a completed settle, unlike the totals/count above.
    const meanBytes = s.count > 0 ? s.totalBytes / s.count : null;
    kindsObj[label] = {
      count: s.count,
      timedCount: s.timedCount,
      totalMs: round2(s.totalMs),
      meanMs: s.timedCount > 0 ? round2(s.totalMs / s.timedCount) : null,
      totalBytes: s.totalBytes,
      totalMiB: round2(s.totalBytes / (1024 * 1024)),
      meanBytes: meanBytes === null ? null : round2(meanBytes),
      meanMiB: meanBytes === null ? null : round2(meanBytes / (1024 * 1024)),
    };
  }
  return {
    label: LABEL,
    scene: SCENE,
    url: BASE,
    display: DISPLAY,
    capMs: CAP_MS,
    width: WIDTH,
    height: HEIGHT,
    engine: runResult.finalProbe?.engine ?? null,
    lastFrameRays: summary.lastFrameRays,
    framesTraced: summary.framesTraced,
    framesCompleted: summary.framesCompleted,
    lastFrameTruncated: summary.lastFrameTruncated,
    settled: runResult.settled,
    settleWallMs: runResult.settleWallMs,
    renderError: runResult.renderErrorText,
    sweepLabels,
    kinds: kindsObj,
    dispatch: {
      march: {
        count: summary.dispatch.march.count,
        totalMs: round2(summary.dispatch.march.totalMs),
      },
      shade: {
        count: summary.dispatch.shade.count,
        totalMs: round2(summary.dispatch.shade.totalMs),
      },
      shadeFree: {
        count: summary.dispatch.shadeFree.count,
        totalMs: round2(summary.dispatch.shadeFree.totalMs),
      },
      shadeHit: {
        count: summary.dispatch.shadeHit.count,
        totalMs: round2(summary.dispatch.shadeHit.totalMs),
      },
    },
    unmatchedBeginCount: summary.unmatchedBegins.length,
    unparsedLines: summary.unparsedLines,
    consoleIssueCount: runResult.consoleIssues.length,
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const runResult = await driveSession();
  const summary = summarize(runResult.traceLines);
  printReport(summary, runResult);

  const json = buildJsonSummary(summary, runResult);
  console.log(`\n[march-readback] JSON ${JSON.stringify(json)}`);

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(json, null, 2));
  log(`wrote ${OUT}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[march-readback] FATAL — could not complete the run:", e);
    process.exit(1);
  });
