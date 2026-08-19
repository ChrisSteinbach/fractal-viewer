#!/usr/bin/env node
/**
 * March-readback A/B: measures the REAL-DRIVER cost of the WebGPU compute
 * surface renderer's per-sweep host readback, before and after the change
 * that swaps a whole-ray-state readback for a per-active-ray status side
 * channel.
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
 * embedded mandelboxKifs preset (the surface fold monster the status
 * side channel was measured against), the `#modeSurfaceBtn` click, and the
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
 *   march BEGIN offset=... chunk=... len=<L> steps=<S> ...  one slice of a sweep
 *   march END ms=<M>                                        that slice's own GPU ms
 *   states readback BEGIN rays=<R>  /  states readback END   OLD arm, R*16 B
 *   status readback BEGIN active=<A> / status readback END   NEW arm, A*4 B
 *   sweep done active=<A> hitQ=... freeQ=... sweepSteps=... stepsThisPass=...
 *                                       closes a sweep — see MARCH SWEEP SHAPE
 *   shade BEGIN isFree=<bool> ... len=<L> ...     one hit or free batch
 *   shade END ms=<M>                              that batch's own GPU ms
 *   present readback BEGIN / present readback END            control, R*4 B
 *   final readback BEGIN                       no END by design; R*4 B, untimed
 *   frame done passes=... truncated=... hit=... ...
 *
 * READING THE OUTPUT: the per-kind table's "sweep" row (`states` or
 * `status`, whichever the running arm actually emitted — never both) is the
 * number this A/B is about: its totalMs is host time blocked on readbacks
 * this change avoids, its totalMiB the PCIe/host-copy traffic saved. Divide
 * the two arms' sweep totalMs/totalMiB to get the speedup/reduction
 * directly; the sweep COUNT should match closely across arms (same march
 * schedule either side of the change) so it doubles as a sanity check that
 * both runs did comparable work. `present` is the unrelated progressive-
 * present readback, reported as a control — unaffected by the change, so
 * it should read ~equal across arms. `final` is the once-per-frame
 * terminal color readback: counted (and sized, from the same rays*4
 * formula as `present`) but never timed, since it has no END trace line by
 * design.
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
 * MARCH SWEEP SHAPE: WHERE THE TIME WENT above answers "march or
 * shade" but not "why is march slow", and for march the answer is usually
 * the SWEEP schedule rather than the marching itself. One sweep is a full
 * pass over the active ray list — however many march BEGIN/END slices it
 * takes to cover it — closed by a readback and a "sweep done" line; the
 * headline is the stepsThisPass table, one row per distinct `steps=` value
 * seen on `march BEGIN`: a frame whose steps stays PINNED AT 1 pays a
 * WHOLE sweep's host cost (the readback, the JS active-list rebuild, the
 * active-list upload) per SINGLE DE step, where a frame that ramps to 32
 * pays that same fixed cost once per 32 steps — so a flat-at-1 shape is
 * "the march half pays its fixed sweep cost far too often", not "marching
 * is slow". Sweep detection reads off the "sweep done" line rather than
 * either readback label, because that line is common to BOTH the OLD
 * `states` and NEW `status` vocabulary (see SWEEP_LABELS below) — the one
 * marker guaranteed to mean the same thing whichever arm produced the
 * trace. The `active=` mean/max reported alongside it are the sweep's own
 * — how many rays a typical/worst sweep still had left to march — and are
 * distinct from the mean `active=` the readback BEGIN line reports about
 * itself, which the NEW `status` vocabulary alone carries (the OLD
 * `states` line sizes itself off the whole ray count instead, so that
 * second mean reads "n/a" under that arm, correctly — not missing data).
 *
 * MARCH COST vs WIDTH: the slice sizer prices a dispatch by
 * dividing its whole time by `len * steps` — a per-ray-step cost — which
 * is only the right quantity if a dispatch has NO fixed per-dispatch
 * INTERCEPT, the same question already asked of hit shade batches. So
 * march dispatches are bucketed by `len` on a ladder wide enough for a
 * march slice (hundreds of thousands of rays, where a hit batch tops out
 * in the low thousands) and reported as ns PER RAY-STEP: FALLING as width
 * grows means a fixed cost is being amortised (an intercept the sizer's
 * division is hiding), FLAT means the time is real per-ray-step work. The
 * table is split one-per-`steps=`-value FIRST, because ns/ray-step is only
 * comparable within one step count — pooling two step counts into one
 * length bucket would average together two different fixed-cost regimes
 * and answer neither question — and a steps value with fewer than 3
 * dispatches is skipped as too few to read a trend into.
 *
 * HIT SHADE COST vs BATCH SIZE: the free queue's share turned
 * out to be per-submission wall with no work in it, and the table after
 * WHERE THE TIME WENT asks the same question of the HIT queue, which no
 * cap change touches. Hit dispatches are bucketed by batch size and
 * reported with µs PER HIT; a falling column means the wider batches are
 * amortizing a wall (a ~178-ray batch is under 3 workgroups, so
 * under-utilization is a live hypothesis), a flat one means the time is
 * real per-hit probe work. Printed only when some hit dispatch carried a
 * parsable `len=`.
 *
 * WORST SINGLE DISPATCH: a MEAN cannot answer the watchdog
 * question. No submission may outrun the i915 watchdog (surface-compute.ts's
 * own settle-park history is the reason every march slice and shade batch is
 * bounded in the first place), and a mean is exactly the statistic in which
 * one pathological dispatch hides — a thousand 2ms dispatches and one 400ms
 * one average out to under 2.5ms, and the mean column would never tell you
 * the 400ms one happened. This block reports the single WORST (highest-ms)
 * dispatch actually observed, one line per kind — hit shade, free shade,
 * march — each beside the batch size (and, for march, the step count) it
 * ran at, plus the hit queue's own 95th-percentile ms (nearest-rank, over
 * the RAW per-dispatch list, not derived from the bucketed means above, so
 * it is not diluted by whichever size bucket happens to be crowded). A kind
 * that never dispatched in this run (a march-only truncation, say) is left
 * out of the block silently; the whole block is skipped if none of the
 * three ever fired at all.
 *
 * HIT DISPATCHES PER FRAME: the hit batch sizer's state — its
 * intercept/marginal cost model and its capacity cap — lives in
 * surface-compute.ts's `sizer` local, which a SUPERSAMPLING JOB hands from
 * pass to pass (same pose, same raster) and nothing else shares, so a
 * single-sample frame restarts the ramp from its own first hit dispatch and
 * pays a climb a converged frame does not. This table is one
 * row per COMPLETED frame (a "frame start" whose matching "frame done" was
 * seen — see `framesTraced`/`framesCompleted` above for the frames this
 * excludes), with hitDisp/hits/totalMs summed over that frame's HIT
 * dispatches alone (free and march excluded) and firstLen/maxLen the
 * ramp's start and its ceiling by the frame's last hit dispatch, plus a
 * MEAN row closing it out — firstLen/maxLen average only over frames that
 * had a hit dispatch at all, rather than counting a hitless frame's "no
 * ramp" as a ramp of size 0. A settle of more than 12 frames prints the
 * first 6 and the last 6 with the middle elided: once the sizer has
 * converged, frame 40's ramp shape is frame 20's asked again.
 *
 * PER-FRAME WALL ACCOUNTING: every other block prices GPU
 * submissions; this one prices the gaps between them. `frame done`'s own
 * `[<ms>ms]` timestamp IS that frame's wall-clock duration (`traceT0`
 * resets at each "frame start"), so `wallMs - marchMs - shadeMs -
 * readbackMs` (that frame's own summed dispatch/readback times) is
 * `otherMs` — host time the GPU sat idle: the JS active-list rebuild
 * between sweeps, `writeBuffer` uploads, the `Uint32Array.from`
 * allocations, promise/microtask latency, per-submission host overhead.
 * `readbackMs` here is TIMED readbacks only (the sweep readback + the
 * progressive present; "final" has no END line and is never timed, same
 * as everywhere else in this script). A large `other%` means the frame
 * loop's own SCHEDULING is the cost, not the GPU work it is scheduling —
 * a lever no kernel change reaches. One row per COMPLETED frame, same
 * elision past 12 rows as HIT DISPATCHES PER FRAME above (and sharing its
 * `frames` list — this table just reads different columns off it), closed
 * by a MEAN row and a TOTAL line giving the settle's overall other share.
 * `otherMs` is clamped at 0 — the four components are measured
 * independently and can in principle jitter past the frame's own
 * timestamp — and a run where that clamp ever bit is flagged rather than
 * silently reported as a suspiciously tidy zero.
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
 * SCENE CHOICE: `--scene` picks which embedded document to load — all
 * three take the SAME WebGPU compute path the side channel touches (its
 * routing: base-map folds OR a fold-FINAL lens, i.e. `deHasFolds(de) ||
 * foldFinal`), so any one is a valid arm subject, but they trade
 * completeness, cost and HIT COVERAGE against each other:
 *   mandelboxKifs (default) — the surface fold monster the side channel
 *     was measured against, 14 maps. Thorough, but heavy: at a 1400x900
 *     window it was measured reaching only ~9% of one settle in 90s on the
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
 *     Its render is thin dust (that script measures ~1.8k hit pixels), so
 *     it says little about the HIT batch sizer's own cost model — most
 *     of a settle here is march and free-queue background, not hit shade.
 *   lens3 — scripts/surface-repro.verify.mjs's `SCENARIOS` lens3 entry:
 *     the fold-FINAL lens archetype, a Sierpinski-shaped 4-map
 *     affine base under a boxfold FINAL transform, so it reaches the
 *     compute path through `foldFinal` rather than `deHasFolds` — a
 *     genuinely different eligibility arm from the other two scenes, not
 *     just a different document. MINTED with a pinned camera pose, same
 *     reasoning as boxfoldPair (see `LENS3_PINNED_HASH` below). The one
 *     scenario here that FILLS THE FRAME (~61k hit pixels of fine crease
 *     detail, per that script's own measurement) rather than tracing thin
 *     dust — i.e. the one with enough HIT dispatches for a batch-size A/B
 *     (the "HIT SHADE COST vs BATCH SIZE" / "WORST SINGLE DISPATCH"
 *     / "HIT DISPATCHES PER FRAME" sections below) to say anything at all.
 *
 * Usage:
 *   node scripts/march-readback-ab.mjs [--display=:0]
 *     [--url=https://localhost:5174] [--capMs=600000] [--label=unlabelled]
 *     [--scene=mandelboxKifs] [--hash=#v1=...] [--width=1400] [--height=900]
 *     [--params=surfacecompute] [--out=/tmp/march-readback-<label>.json]
 *
 *   --display  X display to launch headed Chrome on (real Vulkan driver).
 *   --url      Base URL of an already-running dev server. This script does
 *              not build or serve anything itself.
 *   --capMs    Give up waiting for the settle latch after this long; the
 *              trace collected so far is still summarized and reported.
 *   --label    Tags this run's output ("before"/"after", "states"/
 *              "status", whatever distinguishes the two `git stash` arms).
 *   --scene    `mandelboxKifs` (default, thorough/heavy), `boxfoldPair`
 *              (cheap, settles fast) or `lens3` (fills the frame; see
 *              "SCENE CHOICE" above). Ignored when `--hash` is given.
 *   --hash     Escape hatch: an arbitrary scene, used VERBATIM as the URL
 *              fragment instead of any `SCENES` entry — for a document
 *              this registry does not carry (yet, or ever — a one-off
 *              repro someone hands you need not earn a permanent scene
 *              constant). Accepts either `#v1=xxxx` or bare `v1=xxxx` (a
 *              leading `#` is prepended when absent, so both spellings
 *              from a pasted URL/hash work unmodified). Overrides
 *              `--scene` entirely — no registry lookup, no validation
 *              beyond what the app's own decoder does at load — and the
 *              run reports its scene as `custom` in both the printed
 *              summary and the JSON, since there is no registry name to
 *              report.
 *   --params   Extra query parameters, `&`-joined, appended after
 *              `?surfacetrace&surfacestate`. `--params=surfacecompute` is
 *              the one this instrument needs to reach the compute arm on a
 *              kaleidoscope-4D scene at all (main.ts routes those to the
 *              FRAGMENT tracer, which `?surfacetrace` does not instrument);
 *              `--params=surfacemarchchunk=N` forces the march slice width
 *              for the cost-vs-WIDTH sweep.
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
// --hash's escape hatch (see the module doc's "SCENE CHOICE"/Usage): a bare
// `v1=...` paste is as valid as a full `#v1=...` URL fragment, so this is
// the one place that distinction gets normalised away — everywhere else
// treats HASH_OVERRIDE as either a ready-to-use fragment or null.
const HASH_ARG = typeof args.hash === "string" ? args.hash : null;
const HASH_OVERRIDE =
  HASH_ARG === null
    ? null
    : HASH_ARG.startsWith("#")
      ? HASH_ARG
      : `#${HASH_ARG}`;
// The identifier this run REPORTS as its scene (log line, summary, JSON) —
// "custom" under --hash, since there is no SCENES registry key to name.
const SCENE_ID = HASH_OVERRIDE !== null ? "custom" : SCENE;
/**
 * Extra query parameters appended after `?surfacetrace&surfacestate`, as a
 * bare `&`-joined string (a leading `&` is added when absent, so both
 * `--params=surfacecompute` and `--params=&surfacecompute` work).
 *
 * IT IS WHAT LET THE SHADE-SIZER WIDTH FIX REACH THE ARM IT WAS ABOUT.
 * main.ts routed kaleidoscope-4D (non-fold, symmetry order > 1) to the
 * FRAGMENT tracer at the time, and `?surfacetrace` only instruments the
 * WebGPU frame loop — so a `--hash=<kaleido4>` run collected nothing and
 * reported the WebGL engine until `--params=surfacecompute` forced the
 * other arm.
 * That measurement is what moved the routing rule, so kaleido4 now needs
 * no flag; `--params=surfacegl` is how you get back to the arm it left.
 * The same door reaches `surfacesamples=N` and the schedule pins
 * (`surfacemarchchunk=N`, `surfacemarchsteps=S`, `surfaceshadehits=H`) —
 * that last one is the cost-vs-WIDTH lever, and the reason this file has
 * a MARCH COST vs WIDTH table to compare against.
 */
const EXTRA_PARAMS = (() => {
  const raw = typeof args.params === "string" ? args.params : "";
  const trimmed = raw.replace(/^&+/, "").replace(/&+$/, "");
  return trimmed === "" ? "" : `&${trimmed}`;
})();
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
 * 2-map boxfold pair as surface-fold.verify.mjs's `BOXFOLD_HASH`
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
 * module doc measures and its pinned-pose discipline exists to
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

/** scripts/surface-repro.verify.mjs's `SCENARIOS` table, the `lens3`
 * entry's minted hash — copied verbatim, POSE-PINNED for the same reason
 * BOXFOLD_PINNED_HASH above is (see its comment): a pose-less boot
 * auto-frames from a `Math.random()`-seeded cloud, so two `git stash` arms
 * would trace two different sets of rays rather than the identical work.
 * The fold-FINAL lens archetype — a Sierpinski-shaped 4-map affine
 * base under a boxfold FINAL transform, eligible through `foldFinal`
 * rather than `deHasFolds` (see the module doc's "SCENE CHOICE") — and,
 * per that script's own module doc, the one scenario there that FILLS THE
 * FRAME (~61k hit pixels of fine crease detail) where boxfoldPair above is
 * thin dust (~1.8k). That is what makes it worth adding here: a hit-shade
 * batch-size A/B needs hits to batch, and boxfoldPair barely has
 * any.
 *
 * Already a full `#v1=` hash rather than a JS scene object, so it is used
 * directly instead of round-tripped through enc(). Sets `showGuides: true`
 * — harmless, left as authored, same as BOXFOLD_PINNED_HASH. */
const LENS3_PINNED_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuMzUsMC4zNSwwLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfSx7InBvc2l0aW9uIjpbLTAuMzUsLTAuMzUsMC4zNV0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX0seyJwb3NpdGlvbiI6WzAuMzUsLTAuMzUsLTAuMzVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlstMC4zNSwwLjM1LC0wLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxLCJmaW5hbFRyYW5zZm9ybSI6eyJwb3NpdGlvbiI6WzAuMTUsLTAuMSwwLjA1XSwicm90YXRpb24iOlswLjIsMC4zLDAuMV0sInNjYWxlIjpbMC45LDAuOSwwLjldLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoiYm94Zm9sZCIsIndlaWdodCI6MC41NX1dfSwiY2FtZXJhIjp7InRhcmdldCI6WzAuMDU2OSwtMC4wOTI1LC0wLjAzNDhdLCJyYWRpdXMiOjEuNDM5OCwidGhldGEiOjAuNzg1NCwicGhpIjoxLjA1Nn19";

/** `--scene=<name>` registry: `mandelboxKifs` needs enc()'d, `boxfoldPair`
 * and `lens3` are already `#v1=` hashes — all resolve to a callable so the
 * lookup site (driveSession) doesn't care which, and so `--hash`'s own
 * override (below) can sit beside them as one more callable-shaped case
 * rather than a special path through driveSession. */
const SCENES = {
  mandelboxKifs: () => enc(mandelboxKifs),
  boxfoldPair: () => BOXFOLD_PINNED_HASH,
  lens3: () => LENS3_PINNED_HASH,
};
// --hash bypasses this registry entirely (see the module doc's Usage), so
// an unknown --scene is only a real error when nothing else is going to
// supply the hash.
if (HASH_OVERRIDE === null && !(SCENE in SCENES)) {
  throw new Error(
    `--scene: unknown scene "${SCENE}" (must be one of: ${Object.keys(SCENES).join(", ")}; or pass --hash=<#v1=...> to supply one directly)`,
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
/** Closes one march SWEEP — see the module doc's "MARCH SWEEP SHAPE". This
 * line is common to BOTH readback vocabularies (unlike the BEGIN/END pair
 * {@link READBACK_RE}/{@link SWEEP_LABELS} key off), which is exactly why
 * sweep counting reads off THIS line instead of either readback label: it
 * is the one marker guaranteed to exist and mean the same thing whichever
 * arm produced the trace, so the readback A/B this script was built for
 * and the sweep-shape questions it now also answers share one signal.
 * Only `active=` is captured — the line's other fields (hitQ/freeQ/
 * sweepSteps/stepsThisPass) belong to questions this script does not ask,
 * the same restraint {@link FRAME_DONE_RE} already takes with "frame
 * done"'s own longer tail. */
const SWEEP_DONE_RE = /^sweep done active=(\d+)\b/;
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
/** `march BEGIN`'s own line — carries the ray count and per-ray step
 * budget THIS dispatch marched (see the module doc's "WORST SINGLE
 * DISPATCH"), read off it by the shared {@link LEN_RE}/{@link STEPS_RE}
 * below. Matched separately from {@link SHADE_BEGIN_RE} because a march
 * dispatch carries no `isFree` flag to key off — there is only one kind
 * of march. */
const MARCH_BEGIN_RE = /^march BEGIN\b/;
/** Which QUEUE a shade dispatch drained. The two are different
 * animals — a FREE batch does one background write per ray and takes its
 * WHOLE queue in one dispatch (there is no cost to model, so no cap but
 * the device's own dispatch ceiling), a HIT batch pays the on-surface
 * probe evals and is sized predictively against
 * `SURFACE_COMPUTE_MAX_HIT_SHADE_BATCH` — so a single shade mean over
 * both says nothing about either. The BEGIN line carries the flag; the
 * very next `shade END` is its own, because the frame loop awaits each
 * dispatch before encoding the next. */
const SHADE_BEGIN_RE = /^shade BEGIN isFree=(true|false)\b/;
/** How many rays that dispatch carried, read off the SAME BEGIN line by
 * NAME rather than by position, so a field added or reordered in the
 * trace does not silently start reporting some other number. A line
 * without a `len=` still counts in the free/hit totals above — it only
 * drops out of the size table, which is the conservative direction. Both
 * `shade BEGIN` and `march BEGIN` carry a `len=` field (rays queued to
 * shade vs rays marched this dispatch), so this one regex reads either. */
const LEN_RE = /\blen=(\d+)\b/;
/** `march BEGIN`'s `steps=` field — the per-ray step budget
 * (`stepsThisPass`) this dispatch marched with, read by name for the same
 * reason {@link LEN_RE} is (the module doc's "WORST SINGLE DISPATCH"). */
const STEPS_RE = /\bsteps=(\d+)\b/;
/** Batch-size buckets for the hit table, half-open on powers of two: the
 * question is whether cost per HIT falls as the batch widens, and a
 * doubling ladder is the resolution that question has (a hit batch is
 * sized from a measured cost model under a doubling capacity ladder, so
 * its sizes cluster around powers of two rather than spread). */
const HIT_SIZE_BUCKETS = [
  { label: "1-63", min: 1, max: 63 },
  { label: "64-127", min: 64, max: 127 },
  { label: "128-255", min: 128, max: 255 },
  { label: "256-511", min: 256, max: 511 },
  { label: "512-1023", min: 512, max: 1023 },
  { label: "1024+", min: 1024, max: Infinity },
];

function hitSizeBucket(len) {
  return HIT_SIZE_BUCKETS.find((b) => len >= b.min && len <= b.max) ?? null;
}
/** Batch-size buckets for the march cost-vs-width table (the module doc's
 * "MARCH COST vs WIDTH"), wider than {@link HIT_SIZE_BUCKETS} because a march
 * slice runs to hundreds of thousands of rays where a hit shade batch tops
 * out in the low thousands (the sizer's own capacity ladder) — the
 * question is whether ns PER RAY-STEP falls as the slice widens, which
 * needs a ruler wide enough to span what a slice actually reaches, not a
 * ladder tuned to where dispatches cluster (unlike the hit buckets, a
 * march slice's width is not itself powers-of-two-shaped — it comes off a
 * measured us/ray-step EMA with no capacity ladder of its own). */
const MARCH_SIZE_BUCKETS = [
  { label: "1-1023", min: 1, max: 1023 },
  { label: "1024-4095", min: 1024, max: 4095 },
  { label: "4096-16383", min: 4096, max: 16383 },
  { label: "16384-65535", min: 16384, max: 65535 },
  { label: "65536-262143", min: 65536, max: 262143 },
  { label: "262144+", min: 262144, max: Infinity },
];

function marchSizeBucket(len) {
  return MARCH_SIZE_BUCKETS.find((b) => len >= b.min && len <= b.max) ?? null;
}
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
   * totals can be read as a SHARE of the settle rather than in a vacuum.
   * `worstMs`/`worstLen` (plus march's own `worstSteps`) are the module
   * doc's "WORST SINGLE DISPATCH" — the single highest-ms dispatch seen
   * for that kind, beside the size it ran at, which a mean cannot report. */
  const dispatch = {
    march: {
      count: 0,
      totalMs: 0,
      worstMs: null,
      worstLen: null,
      worstSteps: null,
      /** "MARCH SWEEP SHAPE"'s stepsThisPass distribution — one
       * entry per distinct `steps=` value seen on `march BEGIN`, keyed by
       * that number (a `Map`, not the fixed string labels
       * {@link HIT_SIZE_BUCKETS} uses, since the key is numeric and
       * unbounded). Answers "how much of the march half's time went to
       * each rung of the steps ramp", independent of ray count. */
      byStep: new Map(), // steps -> { count, totalLen, totalMs }
      /** "MARCH COST vs WIDTH": the same dispatches bucketed by
       * BOTH steps and length — steps FIRST, because ns/ray-step is only
       * comparable within one step count (see {@link MARCH_SIZE_BUCKETS}'s
       * own comment); a length bucket pooling two different steps values
       * would average together two different fixed-cost regimes and
       * answer neither question. */
      byStepAndSize: new Map(), // steps -> Map(bucketLabel -> {count, totalLen, totalSteps, totalMs})
    },
    shade: { count: 0, totalMs: 0 },
    // The same shade time split by which queue it drained.
    shadeFree: { count: 0, totalMs: 0, worstMs: null, worstLen: null },
    /** `msList` is the RAW per-dispatch hit time list — the p95
     * line needs the actual sorted sample, not anything derivable from
     * the bucketed means `shadeHitBySize` below already collapses. */
    shadeHit: {
      count: 0,
      totalMs: 0,
      worstMs: null,
      worstLen: null,
      msList: [],
    },
    /** Hit dispatches bucketed by BATCH SIZE — `{count, hits,
     * totalMs}` per bucket label, where `hits` is the SUM of the batch
     * lengths (never count x meanLen), since µs/hit is the column the
     * work-or-wall question turns on. */
    shadeHitBySize: Object.fromEntries(
      HIT_SIZE_BUCKETS.map((b) => [b.label, { count: 0, hits: 0, totalMs: 0 }]),
    ),
  };
  /** "MARCH SWEEP SHAPE": one march SWEEP is a full pass over the
   * active ray list, closed by a "sweep done" line (see SWEEP_DONE_RE's own
   * comment for why counting keys off that line rather than either
   * readback label). `activeSum`/`activeMax` are the sweep's own reported
   * `active=` — how many rays a typical/worst sweep still had left to
   * march. `readbackActiveSum`/`readbackActiveCount` are a DIFFERENT
   * number: the mean `active=` the readback BEGIN line reports about
   * ITSELF, which only the NEW `status` vocabulary carries (the OLD
   * `states` line sizes itself off the whole ray count via `rays=`
   * instead — see `bytesForReadback`'s OLD/NEW split) — so under that arm
   * this pair simply never increments and the report reads "n/a", which is
   * correct, not missing data. */
  const sweep = {
    count: 0,
    activeSum: 0,
    activeMax: null,
    readbackActiveSum: 0,
    readbackActiveCount: 0,
  };
  let pendingShadeIsFree = null;
  let pendingShadeLen = null;
  let pendingMarchLen = null;
  let pendingMarchSteps = null;
  /** One record per "frame start" seen, its ramp stats
   * accumulated as that frame's OWN hit dispatches parse, `completed`
   * flipped true by the matching "frame done" — see the module doc's
   * "HIT DISPATCHES PER FRAME". A frame whose "frame done" the trace
   * never reached (settle declared or cap hit mid-frame) stays
   * `completed: false` and is dropped from the reported `frames` list
   * below, the same truncation `framesTraced > framesCompleted` already
   * discloses at the summary level. */
  const frameRecords = [];
  let currentFrame = null;

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
      currentFrame = {
        index: frameRecords.length,
        rays: lastFrameRays,
        hitDispatches: 0,
        hits: 0,
        // HIT-shade time only (feeding "HIT DISPATCHES PER FRAME" below)
        // — distinct from `shadeMs` below, which is the ALL-shade
        // (hit+free) total feeding "PER-FRAME WALL ACCOUNTING". Two
        // different questions kept as two fields rather than one
        // overloaded one.
        totalMs: 0,
        firstLen: null,
        maxLen: null,
        completed: false,
        // "MARCH SWEEP SHAPE"'s per-frame sweep count.
        sweeps: 0,
        // "PER-FRAME WALL ACCOUNTING": wallMs comes off "frame
        // done"'s own timestamp (set there, once traceT0's reset makes it
        // meaningful); marchMs/shadeMs/readbackMs are this frame's own
        // summed dispatch/readback times, accumulated dispatch by
        // dispatch below exactly like `totalMs` already is for hit shade.
        wallMs: null,
        marchMs: 0,
        shadeMs: 0,
        readbackMs: 0,
      };
      frameRecords.push(currentFrame);
      continue;
    }
    const frameDone = FRAME_DONE_RE.exec(body);
    if (frameDone) {
      framesCompleted++;
      lastFrameTruncated = frameDone[2] === "true";
      if (currentFrame) {
        currentFrame.completed = true;
        // "frame done"'s OWN [<ms>ms] IS this frame's wall-clock
        // duration — traceT0 resets at "frame start", so nothing needs
        // subtracting (see the module doc's "PER-FRAME WALL ACCOUNTING").
        currentFrame.wallMs = ms;
      }
      continue;
    }

    const marchBegin = MARCH_BEGIN_RE.exec(body);
    if (marchBegin) {
      const lenMatch = LEN_RE.exec(body);
      pendingMarchLen = lenMatch ? Number(lenMatch[1]) : null;
      const stepsMatch = STEPS_RE.exec(body);
      pendingMarchSteps = stepsMatch ? Number(stepsMatch[1]) : null;
      continue;
    }

    const shadeBegin = SHADE_BEGIN_RE.exec(body);
    if (shadeBegin) {
      pendingShadeIsFree = shadeBegin[1] === "true";
      const lenMatch = LEN_RE.exec(body);
      pendingShadeLen = lenMatch ? Number(lenMatch[1]) : null;
      continue;
    }

    const dispatchEnd = DISPATCH_END_RE.exec(body);
    if (dispatchEnd) {
      const half = dispatch[dispatchEnd[1]];
      const ms = Number(dispatchEnd[2]);
      half.count++;
      half.totalMs += ms;
      if (dispatchEnd[1] === "march") {
        // Worst SINGLE march dispatch — `len`/`steps` come off
        // the matching "march BEGIN" line captured just above.
        if (dispatch.march.worstMs === null || ms > dispatch.march.worstMs) {
          dispatch.march.worstMs = ms;
          dispatch.march.worstLen = pendingMarchLen;
          dispatch.march.worstSteps = pendingMarchSteps;
        }
        // "PER-FRAME WALL ACCOUNTING": this frame's own march
        // total, summed slice by slice exactly like `totalMs` already
        // sums hit-shade time below.
        if (currentFrame) currentFrame.marchMs += ms;
        // "MARCH SWEEP SHAPE"'s steps distribution and "MARCH
        // COST vs WIDTH"'s steps x size buckets both need len AND steps
        // off the same BEGIN line (the trace always carries both
        // together — see MARCH_BEGIN_RE's own comment); a dispatch
        // missing either drops out of both tables the same way a
        // len-less shade dispatch already drops out of `shadeHitBySize`
        // below, rather than corrupting a mean with a partial record.
        if (pendingMarchLen !== null && pendingMarchSteps !== null) {
          let byStep = dispatch.march.byStep.get(pendingMarchSteps);
          if (!byStep) {
            byStep = { count: 0, totalLen: 0, totalMs: 0 };
            dispatch.march.byStep.set(pendingMarchSteps, byStep);
          }
          byStep.count++;
          byStep.totalLen += pendingMarchLen;
          byStep.totalMs += ms;

          const bucket = marchSizeBucket(pendingMarchLen);
          if (bucket) {
            let bySize = dispatch.march.byStepAndSize.get(pendingMarchSteps);
            if (!bySize) {
              bySize = new Map();
              dispatch.march.byStepAndSize.set(pendingMarchSteps, bySize);
            }
            let b = bySize.get(bucket.label);
            if (!b) {
              b = { count: 0, totalLen: 0, totalSteps: 0, totalMs: 0 };
              bySize.set(bucket.label, b);
            }
            b.count++;
            b.totalLen += pendingMarchLen;
            b.totalSteps += pendingMarchSteps;
            b.totalMs += ms;
          }
        }
        pendingMarchLen = null;
        pendingMarchSteps = null;
      }
      if (dispatchEnd[1] === "shade" && pendingShadeIsFree !== null) {
        const queue = pendingShadeIsFree
          ? dispatch.shadeFree
          : dispatch.shadeHit;
        queue.count++;
        queue.totalMs += ms;
        // "PER-FRAME WALL ACCOUNTING": ALL shade this frame, hit
        // and free alike — unlike `currentFrame.totalMs` below, which
        // stays hit-only for the ramp table.
        if (currentFrame) currentFrame.shadeMs += ms;
        if (queue.worstMs === null || ms > queue.worstMs) {
          queue.worstMs = ms;
          queue.worstLen = pendingShadeLen;
        }
        if (!pendingShadeIsFree) {
          // p95 needs the raw list, not the bucketed means —
          // see the module doc's "WORST SINGLE DISPATCH".
          queue.msList.push(ms);
          // This frame's ramp — a single-sample frame gets a
          // fresh sizer, but a supersampled job shares one across its
          // passes, so how far it climbed by the frame's LAST hit
          // dispatch is a per-frame question only within that job. See
          // the module doc's "HIT DISPATCHES PER FRAME".
          if (currentFrame) {
            currentFrame.hitDispatches++;
            currentFrame.totalMs += ms;
            if (pendingShadeLen !== null) {
              currentFrame.hits += pendingShadeLen;
              if (currentFrame.firstLen === null) {
                currentFrame.firstLen = pendingShadeLen;
              }
              if (
                currentFrame.maxLen === null ||
                pendingShadeLen > currentFrame.maxLen
              ) {
                currentFrame.maxLen = pendingShadeLen;
              }
            }
          }
          if (pendingShadeLen !== null) {
            const bucket = hitSizeBucket(pendingShadeLen);
            if (bucket) {
              const b = dispatch.shadeHitBySize[bucket.label];
              b.count++;
              b.hits += pendingShadeLen;
              b.totalMs += ms;
            }
          }
        }
        pendingShadeIsFree = null;
        pendingShadeLen = null;
      }
      continue;
    }

    const sweepDone = SWEEP_DONE_RE.exec(body);
    if (sweepDone) {
      const active = Number(sweepDone[1]);
      sweep.count++;
      sweep.activeSum += active;
      if (sweep.activeMax === null || active > sweep.activeMax) {
        sweep.activeMax = active;
      }
      if (currentFrame) currentFrame.sweeps++;
      continue;
    }

    const rb = READBACK_RE.exec(body);
    if (!rb) continue; // ANOMALY lines — not ours
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

      // "MARCH SWEEP SHAPE": the mean `active=` a SWEEP-LABEL
      // readback reports about ITSELF — guarded on SWEEP_LABELS (not the
      // literal "status") for the same reason SWEEP_DONE_RE is, so
      // whichever arm is running this only ever sums that arm's own
      // readback, and the OLD `states` line (no `active=` field — see
      // `sweep`'s own comment above) simply never matches `activeMatch`
      // and so never contributes.
      if (activeMatch && SWEEP_LABELS.includes(label)) {
        sweep.readbackActiveSum += Number(activeMatch[1]);
        sweep.readbackActiveCount++;
      }

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
    // "PER-FRAME WALL ACCOUNTING": every readback that reaches
    // this branch is by construction a TIMED one (UNTIMED_READBACK_LABEL
    // took the early `continue` above and never opened) — the sweep
    // readback and the progressive present, never "final".
    if (currentFrame) currentFrame.readbackMs += ms - begin.ms;
  }

  // Anything still open at the end of the log lost its END because the
  // trace stopped mid-readback (settle declared, cap hit, page closed).
  for (const [label, begin] of openBegins) {
    unmatchedBegins.push({ label, extra: begin.extra });
    const s = kindStat(label);
    s.count++;
    s.totalBytes += bytesForReadback(label, begin.extra);
  }

  // Only COMPLETED frames earn a row (see `frameRecords`'s own
  // comment above) — `completed` itself is bookkeeping for THIS function,
  // not part of the reported shape, so it is dropped here rather than
  // carried into every consumer.
  const frames = frameRecords
    .filter((f) => f.completed)
    .map((f) => ({
      index: f.index,
      hitDispatches: f.hitDispatches,
      hits: f.hits,
      totalMs: f.totalMs,
      firstLen: f.firstLen,
      maxLen: f.maxLen,
      // Rays/sweeps feed "MARCH SWEEP SHAPE"'s per-frame sweep
      // count; wallMs/marchMs/shadeMs/readbackMs feed "PER-FRAME WALL
      // ACCOUNTING" — see `currentFrame`'s own comment above for what each
      // one sums.
      rays: f.rays,
      sweeps: f.sweeps,
      wallMs: f.wallMs,
      marchMs: f.marchMs,
      shadeMs: f.shadeMs,
      readbackMs: f.readbackMs,
    }));

  return {
    kinds,
    dispatch,
    sweep,
    frames,
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
    `starting: url=${BASE} display=${DISPLAY} capMs=${CAP_MS} label=${LABEL} scene=${SCENE_ID} width=${WIDTH} height=${HEIGHT}`,
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

    // --hash wins outright when given (see the module doc's Usage) — no
    // registry lookup, so an override never has to also be a valid SCENES
    // key.
    const hash = HASH_OVERRIDE ?? SCENES[SCENE]();
    const url = `${BASE}/?surfacetrace&surfacestate${EXTRA_PARAMS}${hash}`;
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
/** The "WORST SINGLE DISPATCH" p95 — NEAREST-RANK over the raw
 * per-dispatch list (never the bucketed means in `shadeHitBySize`, which
 * would answer a coarser, bucket-diluted question): sort ascending and
 * take `sorted[ceil(0.95*N) - 1]`. `null` on an empty list rather than
 * NaN, so a kind with no dispatches reports as absent, not as a number
 * that happens to be garbage. */
function percentile95(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[rank];
}
/** Mean over the non-null/non-undefined entries of `values`, `null` if none
 * qualify. The "HIT DISPATCHES PER FRAME" MEAN row uses this for
 * firstLen/maxLen so a hitless frame (both fields null, never 0) is left
 * OUT of that column's average rather than dragging it toward 0 — which
 * would misreport "the ramp starts small" where the truth is "this frame
 * had no ramp at all". */
function meanOf(values) {
  const nums = values.filter((v) => v !== null && v !== undefined);
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}
/** Generic one-decimal formatter for non-millisecond quantities (ray
 * counts, sweep counts, dispatch counts) — {@link fmtMs} reads as "this is
 * a timing" even beside a number that is not one, so every table
 * below uses this instead. Also replaces "HIT DISPATCHES PER FRAME"'s own
 * MEAN row, which used to keep a private copy of exactly this function. */
function fmt1(x) {
  return x === null || x === undefined || !Number.isFinite(x)
    ? "n/a"
    : x.toFixed(1);
}
/** "PER-FRAME WALL ACCOUNTING": `otherMs` is what is left of a
 * frame's own wall time once its march/shade/readback totals are
 * subtracted — host time the GPU sat idle. Clamped at 0 rather than
 * printed negative: the four components are measured independently
 * (separate `performance.now()` spans around separate awaits), so jitter
 * can in principle sum them a hair past the frame's own wall clock;
 * `negative` reports whether that happened so a run where it did is
 * flagged rather than shown a suspiciously tidy zero. `frames` is already
 * filtered to completed frames (see `summarize`'s own filter), so
 * `wallMs === null` should not reach this function in practice, but it is
 * handled rather than assumed away. */
function frameOtherMs(f) {
  if (f.wallMs === null) return { otherMs: null, negative: false };
  const raw = f.wallMs - f.marchMs - f.shadeMs - f.readbackMs;
  return { otherMs: Math.max(0, raw), negative: raw < 0 };
}
/** "MARCH SWEEP SHAPE"'s headline numbers — shared by printReport
 * and buildJsonSummary so the printed line and the JSON field can never
 * disagree. `meanSweepsPerFrame` averages over ALL completed frames,
 * including a legitimate zero-sweep one: unlike {@link meanOf}'s other
 * uses in this file (firstLen/maxLen, where null means "this frame had no
 * ramp at all" and must not drag the mean toward 0), a sweep count is
 * always real data, never absent, so 0 belongs in the average. */
function marchSweepStats(summary) {
  const sweepCount = summary.sweep.count;
  const frames = summary.frames;
  return {
    sweepCount,
    meanSweepsPerFrame:
      frames.length > 0 ? meanOf(frames.map((f) => f.sweeps)) : null,
    meanMarchDispatchesPerSweep:
      sweepCount > 0 ? summary.dispatch.march.count / sweepCount : null,
    meanSweepActive:
      sweepCount > 0 ? summary.sweep.activeSum / sweepCount : null,
    maxSweepActive: summary.sweep.activeMax,
    meanReadbackActive:
      summary.sweep.readbackActiveCount > 0
        ? summary.sweep.readbackActiveSum / summary.sweep.readbackActiveCount
        : null,
  };
}
/** "MARCH SWEEP SHAPE"'s stepsThisPass distribution table — one
 * row per distinct `steps=` value seen on `march BEGIN`, SORTED ascending
 * (Map iteration order is first-seen order, not numeric order, and the
 * steps ramp resets every sweep, so first-seen is not even mostly
 * sorted). Shared by printReport and buildJsonSummary. */
function marchStepRows(summary) {
  const marchTotalMs = summary.dispatch.march.totalMs;
  return [...summary.dispatch.march.byStep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([steps, s]) => ({
      steps,
      dispatches: s.count,
      meanLen: s.totalLen / s.count,
      totalMs: s.totalMs,
      shareOfMarchMs:
        marchTotalMs > 0 ? (s.totalMs / marchTotalMs) * 100 : null,
    }));
}
/** "MARCH COST vs WIDTH": march dispatches bucketed by length,
 * broken out one table per distinct `steps=` value (ns/ray-step is only
 * comparable within one step count — see the module doc). A steps value
 * with fewer than 3 dispatches TOTAL is dropped entirely — too few to
 * read a trend into — checked against `byStep`'s own count rather than
 * the sum of this function's own bucketed rows, so the cutoff cannot be
 * evaded by a steps value whose dispatches happen to spread thin across
 * many buckets. Shared by printReport and buildJsonSummary. */
function marchWidthTables(summary) {
  return [...summary.dispatch.march.byStepAndSize.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([steps, bucketsMap]) => {
      const totalAtSteps = summary.dispatch.march.byStep.get(steps)?.count ?? 0;
      if (totalAtSteps < 3) return null;
      const rows = MARCH_SIZE_BUCKETS.map((b) => {
        const s = bucketsMap.get(b.label);
        if (!s || s.count === 0) return null;
        const meanLen = s.totalLen / s.count;
        const meanSteps = s.totalSteps / s.count;
        const meanMs = s.totalMs / s.count;
        const nsPerRayStep =
          meanLen > 0 && meanSteps > 0
            ? (meanMs * 1e6) / (meanLen * meanSteps)
            : null;
        return {
          bucket: b.label,
          count: s.count,
          meanLen,
          meanSteps,
          meanMs,
          nsPerRayStep,
        };
      }).filter((r) => r !== null);
      return { steps, totalDispatches: totalAtSteps, rows };
    })
    .filter((t) => t !== null);
}
/** "PER-FRAME WALL ACCOUNTING"'s closing totals — the TOTAL line
 * in printReport and the `wallAccounting` JSON field are the same numbers
 * by construction, since both call this. `null` when there are no
 * completed frames to total, the same "print/report nothing" rule every
 * other block here follows. */
function wallAccountingTotals(frames) {
  if (frames.length === 0) return null;
  const totalWallMs = frames.reduce((a, f) => a + f.wallMs, 0);
  const totalMarchMs = frames.reduce((a, f) => a + f.marchMs, 0);
  const totalShadeMs = frames.reduce((a, f) => a + f.shadeMs, 0);
  const totalReadbackMs = frames.reduce((a, f) => a + f.readbackMs, 0);
  const otherPerFrame = frames.map((f) => frameOtherMs(f));
  const totalOtherMs = otherPerFrame.reduce((a, o) => a + o.otherMs, 0);
  const anyNegative = otherPerFrame.some((o) => o.negative);
  return {
    totalWallMs,
    totalMarchMs,
    totalShadeMs,
    totalReadbackMs,
    totalOtherMs,
    otherPctOfWall: totalWallMs > 0 ? (totalOtherMs / totalWallMs) * 100 : null,
    anyNegative,
  };
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
  console.log(`scene               : ${SCENE_ID}`);
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

  // How the march half SHAPES itself sweep to sweep — see the
  // module doc's "MARCH SWEEP SHAPE". Skipped whole when no "sweep done"
  // line was ever seen (a march-less truncation, or a settle that never
  // left its first outer-loop iteration).
  const sweepStats = marchSweepStats(summary);
  if (sweepStats.sweepCount > 0) {
    console.log();
    console.log(
      "MARCH SWEEP SHAPE (one sweep = one full pass over the active list, " +
        'closed by a readback + "sweep done"):',
    );
    console.log(
      `  sweeps=${sweepStats.sweepCount}  meanSweepsPerFrame=${fmt1(sweepStats.meanSweepsPerFrame)}` +
        `  meanMarchDispatchesPerSweep=${fmt1(sweepStats.meanMarchDispatchesPerSweep)}`,
    );
    console.log(
      `  active rays: sweep-done mean=${fmt1(sweepStats.meanSweepActive)} max=${sweepStats.maxSweepActive ?? "n/a"}` +
        `  |  readback-BEGIN mean=${fmt1(sweepStats.meanReadbackActive)}` +
        (sweepStats.meanReadbackActive === null
          ? "  (old `states` arm reports rays=, not active=)"
          : ""),
    );

    // The headline table: a frame whose steps stays PINNED AT
    // 1 pays a WHOLE sweep's host cost (readback + active-list
    // rebuild/upload) per SINGLE DE step; a frame that ramps to 32 pays it
    // once per 32. If the dispatch count/totalMs mass sits at low steps
    // values, that fixed cost is being paid far more often than it needs
    // to be.
    const stepRows = marchStepRows(summary);
    if (stepRows.length > 0) {
      console.log(
        "  stepsThisPass distribution (this DISPATCH's own budget, not the sweep's mean):",
      );
      console.log(
        "    steps   dispatches   meanLen      totalMs   share of march ms",
      );
      for (const r of stepRows) {
        console.log(
          `    ${String(r.steps).padStart(5)}   ${String(r.dispatches).padStart(10)}   ` +
            `${fmt1(r.meanLen).padStart(8)}   ${fmtMs(r.totalMs).padStart(10)}   ` +
            `${r.shareOfMarchMs === null ? "n/a" : r.shareOfMarchMs.toFixed(1) + "%"}`,
        );
      }
    }

    // Does a march dispatch have a fixed per-dispatch cost the
    // slice sizer's len*steps division hides? FALLING ns/ray-step = yes,
    // an intercept is being amortised as width grows; FLAT = real
    // per-ray-step work, which no sizing change reaches. One table per
    // distinct steps value — see the module doc's "MARCH COST vs WIDTH"
    // for why ns/ray-step cannot be compared across step counts.
    const widthTables = marchWidthTables(summary);
    if (widthTables.length > 0) {
      console.log();
      console.log(
        "MARCH COST vs WIDTH (FALLING ns/ray-step = a fixed per-dispatch " +
          "cost is being amortised; FLAT = real per-ray-step work):",
      );
      for (const t of widthTables) {
        console.log(`  steps=${t.steps} (${t.totalDispatches} dispatches):`);
        console.log(
          "    len bucket        count   meanLen  meanSteps    meanMs   ns/ray-step",
        );
        for (const r of t.rows) {
          console.log(
            `    ${r.bucket.padEnd(14)} ${String(r.count).padStart(7)}  ` +
              `${fmt1(r.meanLen).padStart(8)}  ${fmt1(r.meanSteps).padStart(9)} ` +
              `${fmtMs(r.meanMs).padStart(9)}   ${fmt1(r.nsPerRayStep).padStart(10)}`,
          );
        }
      }
    }
  }

  // The free/hit split's second half: the free queue's time was
  // per-submission wall, and this is the same question asked of the HIT
  // queue, which the cap change does not touch. A hit batch is ~178 rays
  // — under 3 workgroups — so if µs/hit FALLS as batches widen, part of
  // that 55% is wall and under-utilization and there is a lever; if it
  // stays FLAT, it is real per-hit probe work and there is not.
  const bySize = summary.dispatch.shadeHitBySize ?? {};
  const sizedBuckets = HIT_SIZE_BUCKETS.filter(
    (b) => (bySize[b.label]?.count ?? 0) > 0,
  );
  if (sizedBuckets.length > 0) {
    console.log();
    console.log(
      "HIT SHADE COST vs BATCH SIZE (is the hit half work, or wall + under-utilization?):",
    );
    console.log(
      "  batch size    dispatches       hits      totalMs   meanMs/disp   meanUs/hit",
    );
    for (const b of sizedBuckets) {
      const s = bySize[b.label];
      const meanMs = s.totalMs / s.count;
      const usPerHit = s.hits > 0 ? (s.totalMs * 1000) / s.hits : null;
      console.log(
        `  ${b.label.padEnd(12)}  ${String(s.count).padStart(10)} ` +
          `${String(s.hits).padStart(10)} ${fmtMs(s.totalMs).padStart(12)} ` +
          `${fmtMs(meanMs).padStart(13)} ${fmtMs(usPerHit).padStart(12)}`,
      );
    }
    console.log(
      "  (read the last column: FALLING with batch size = the wider batches " +
        "are amortizing a\n   per-submission wall, i.e. overhead a sizing " +
        "change could still take; FLAT = real per-hit\n   probe work, which " +
        "no batch-cap change reaches.)",
    );
  }

  // The watchdog question a MEAN cannot answer — see the module
  // doc's "WORST SINGLE DISPATCH". One line per kind, printed only for a
  // kind that actually dispatched at least once (a --capMs cut may end a
  // run before it ever reaches march, or keep it hit-bound the whole run
  // with no free batch at all); the whole block is skipped if none of the
  // three ever fired.
  const worstMarch = summary.dispatch.march;
  const worstFree = summary.dispatch.shadeFree;
  const worstHit = summary.dispatch.shadeHit;
  if (
    worstMarch.worstMs !== null ||
    worstFree.worstMs !== null ||
    worstHit.worstMs !== null
  ) {
    console.log();
    console.log(
      "WORST SINGLE DISPATCH (the watchdog question — a mean cannot answer it):",
    );
    const worstLine = (label, text) =>
      console.log(`  ${label.padEnd(13)}: ${text}`);
    if (worstHit.worstMs !== null) {
      const usPerHit = worstHit.worstLen
        ? (worstHit.worstMs * 1000) / worstHit.worstLen
        : null;
      worstLine(
        "hit shade",
        `${fmtMs(worstHit.worstMs)} ms at len=${worstHit.worstLen ?? "n/a"}  (${fmtMs(usPerHit)} us/hit)`,
      );
      worstLine(
        "hit shade p95",
        `${fmtMs(percentile95(worstHit.msList))} ms  (over ${worstHit.msList.length} dispatch(es))`,
      );
    }
    if (worstFree.worstMs !== null) {
      worstLine(
        "free shade",
        `${fmtMs(worstFree.worstMs)} ms at len=${worstFree.worstLen ?? "n/a"}`,
      );
    }
    if (worstMarch.worstMs !== null) {
      worstLine(
        "march",
        `${fmtMs(worstMarch.worstMs)} ms at len=${worstMarch.worstLen ?? "n/a"} steps=${worstMarch.worstSteps ?? "n/a"}`,
      );
    }
  }

  // How much of a frame is spent re-climbing the hit batch
  // sizer's own ramp — see the module doc's "HIT DISPATCHES PER FRAME".
  // One row per COMPLETED frame (summarize()'s own filter — see `frames`'
  // construction there); skipped entirely if the trace never completed one
  // (a --capMs cut mid-first-frame, say).
  const frames = summary.frames;
  if (frames.length > 0) {
    console.log();
    console.log(
      "HIT DISPATCHES PER FRAME (batch-size ramp; a supersampled job shares one sizer across its passes):",
    );
    const FRAME_COL_WIDTHS = [5, 9, 8, 9, 10, 8];
    const frameRow = (values) =>
      "  " +
      values.map((v, i) => String(v).padStart(FRAME_COL_WIDTHS[i])).join(" ");
    console.log(
      frameRow(["frame", "hitDisp", "hits", "totalMs", "firstLen", "maxLen"]),
    );
    const printFrame = (f) =>
      console.log(
        frameRow([
          f.index,
          f.hitDispatches,
          f.hits,
          fmtMs(f.totalMs),
          f.firstLen ?? "n/a",
          f.maxLen ?? "n/a",
        ]),
      );
    // A long settle's ramp shape repeats once the sizer has converged, so
    // past 12 frames the first/last 6 carry the signal (does it converge,
    // does it STAY converged) and the middle is elided rather than
    // printed in full.
    if (frames.length > 12) {
      frames.slice(0, 6).forEach(printFrame);
      console.log("  ...");
      frames.slice(-6).forEach(printFrame);
    } else {
      frames.forEach(printFrame);
    }
    console.log(
      frameRow([
        "MEAN",
        fmt1(meanOf(frames.map((f) => f.hitDispatches))),
        fmt1(meanOf(frames.map((f) => f.hits))),
        fmtMs(meanOf(frames.map((f) => f.totalMs))),
        fmt1(meanOf(frames.map((f) => f.firstLen))),
        fmt1(meanOf(frames.map((f) => f.maxLen))),
      ]),
    );
  }

  // "PER-FRAME WALL ACCOUNTING": otherMs is host time the GPU sat
  // idle while the frame was open (JS active-list rebuild, writeBuffer
  // uploads, the Uint32Array.from allocations, promise/microtask latency,
  // per-submission overhead) — a large other% means the frame loop's own
  // SCHEDULING is the cost, not the GPU work it schedules. Same `frames`
  // list and elision rule as "HIT DISPATCHES PER FRAME" above, just
  // different columns off it.
  const wallTotals = wallAccountingTotals(frames);
  if (wallTotals !== null) {
    console.log();
    console.log(
      "PER-FRAME WALL ACCOUNTING (otherMs = wallMs minus this frame's own " +
        "march+shade+readback — host time the GPU was idle):",
    );
    const WALL_COL_WIDTHS = [5, 8, 7, 9, 9, 9, 11, 9, 7];
    const wallRow = (values) =>
      "  " +
      values.map((v, i) => String(v).padStart(WALL_COL_WIDTHS[i])).join(" ");
    console.log(
      wallRow([
        "frame",
        "rays",
        "sweeps",
        "wallMs",
        "marchMs",
        "shadeMs",
        "readbackMs",
        "otherMs",
        "other%",
      ]),
    );
    let anyNegativeRow = false;
    const otherPct = (otherMs, wallMs) =>
      wallMs > 0 ? `${((otherMs / wallMs) * 100).toFixed(1)}%` : "n/a";
    const printWallFrame = (f) => {
      const { otherMs, negative } = frameOtherMs(f);
      if (negative) anyNegativeRow = true;
      console.log(
        wallRow([
          f.index,
          f.rays,
          f.sweeps,
          fmtMs(f.wallMs),
          fmtMs(f.marchMs),
          fmtMs(f.shadeMs),
          fmtMs(f.readbackMs),
          fmtMs(otherMs),
          otherPct(otherMs, f.wallMs),
        ]),
      );
    };
    if (frames.length > 12) {
      frames.slice(0, 6).forEach(printWallFrame);
      console.log("  ...");
      frames.slice(-6).forEach(printWallFrame);
    } else {
      frames.forEach(printWallFrame);
    }
    const meanWallMs = meanOf(frames.map((f) => f.wallMs));
    const meanOtherMs = meanOf(frames.map((f) => frameOtherMs(f).otherMs));
    console.log(
      wallRow([
        "MEAN",
        fmt1(meanOf(frames.map((f) => f.rays))),
        fmt1(meanOf(frames.map((f) => f.sweeps))),
        fmtMs(meanWallMs),
        fmtMs(meanOf(frames.map((f) => f.marchMs))),
        fmtMs(meanOf(frames.map((f) => f.shadeMs))),
        fmtMs(meanOf(frames.map((f) => f.readbackMs))),
        fmtMs(meanOtherMs),
        otherPct(meanOtherMs, meanWallMs),
      ]),
    );
    console.log(
      `  TOTAL: wallMs=${fmtMs(wallTotals.totalWallMs)} marchMs=${fmtMs(wallTotals.totalMarchMs)} ` +
        `shadeMs=${fmtMs(wallTotals.totalShadeMs)} readbackMs=${fmtMs(wallTotals.totalReadbackMs)} ` +
        `otherMs=${fmtMs(wallTotals.totalOtherMs)}  (other=${
          wallTotals.otherPctOfWall === null
            ? "n/a"
            : wallTotals.otherPctOfWall.toFixed(1) + "%"
        } of wall)`,
    );
    if (wallTotals.anyNegative || anyNegativeRow) {
      console.log(
        "  NOTE: at least one frame's otherMs computed negative before " +
          "clamping (marchMs+shadeMs+readbackMs exceeded wallMs) — the " +
          "four components are measured independently and can jitter past " +
          "the frame's own timestamp; read as ~0, not as a real deficit.",
      );
    }
  }

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
    scene: SCENE_ID,
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
    // "MARCH SWEEP SHAPE"'s headline numbers — see
    // `marchSweepStats`'s own comment. `null` fields (e.g.
    // `meanReadbackActive` under the OLD `states` arm) mean the
    // underlying trace never carried that number, not that it was 0.
    sweep: (() => {
      const s = marchSweepStats(summary);
      return {
        count: s.sweepCount,
        meanSweepsPerFrame: round2(s.meanSweepsPerFrame),
        meanMarchDispatchesPerSweep: round2(s.meanMarchDispatchesPerSweep),
        meanActive: round2(s.meanSweepActive),
        maxActive: s.maxSweepActive,
        meanReadbackActive: round2(s.meanReadbackActive),
      };
    })(),
    dispatch: {
      march: {
        count: summary.dispatch.march.count,
        totalMs: round2(summary.dispatch.march.totalMs),
        // "MARCH SWEEP SHAPE"'s stepsThisPass distribution — see
        // `marchStepRows`'s own comment; array (not an object keyed by
        // steps) so a consumer does not have to know JSON stringifies
        // numeric keys as strings.
        stepsDistribution: marchStepRows(summary).map((r) => ({
          steps: r.steps,
          dispatches: r.dispatches,
          meanLen: round2(r.meanLen),
          totalMs: round2(r.totalMs),
          shareOfMarchMsPct:
            r.shareOfMarchMs === null ? null : round2(r.shareOfMarchMs),
        })),
        // "MARCH COST vs WIDTH" — see `marchWidthTables`'s own
        // comment for the per-steps split and the <3-dispatch cutoff.
        widthByStep: marchWidthTables(summary).map((t) => ({
          steps: t.steps,
          totalDispatches: t.totalDispatches,
          buckets: t.rows.map((r) => ({
            bucket: r.bucket,
            count: r.count,
            meanLen: round2(r.meanLen),
            meanSteps: round2(r.meanSteps),
            meanMs: round2(r.meanMs),
            nsPerRayStep:
              r.nsPerRayStep === null ? null : round2(r.nsPerRayStep),
          })),
        })),
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
      // Only the buckets that saw a dispatch, so an arm's JSON
      // does not carry five zero rows for sizes its sizing never picked.
      shadeHitBySize: Object.fromEntries(
        Object.entries(summary.dispatch.shadeHitBySize)
          .filter(([, s]) => s.count > 0)
          .map(([label, s]) => [
            label,
            { count: s.count, hits: s.hits, totalMs: round2(s.totalMs) },
          ]),
      ),
    },
    unmatchedBeginCount: summary.unmatchedBegins.length,
    unparsedLines: summary.unparsedLines,
    consoleIssueCount: runResult.consoleIssues.length,
    // The watchdog question a MEAN cannot answer (see the module
    // doc's "WORST SINGLE DISPATCH") — a `null` field means that kind
    // never dispatched in this run, not that it dispatched for 0ms.
    worst: {
      hitMs: round2(summary.dispatch.shadeHit.worstMs),
      hitLen: summary.dispatch.shadeHit.worstLen,
      hitUsPerHit:
        summary.dispatch.shadeHit.worstMs !== null &&
        summary.dispatch.shadeHit.worstLen
          ? round2(
              (summary.dispatch.shadeHit.worstMs * 1000) /
                summary.dispatch.shadeHit.worstLen,
            )
          : null,
      hitP95Ms: round2(percentile95(summary.dispatch.shadeHit.msList)),
      freeMs: round2(summary.dispatch.shadeFree.worstMs),
      freeLen: summary.dispatch.shadeFree.worstLen,
      marchMs: round2(summary.dispatch.march.worstMs),
      marchLen: summary.dispatch.march.worstLen,
      marchSteps: summary.dispatch.march.worstSteps,
    },
    // One entry per COMPLETED frame — see the module
    // doc's "HIT DISPATCHES PER FRAME" and "PER-FRAME WALL ACCOUNTING",
    // and summarize()'s own `frames` construction (already this exact
    // shape; the ms fields want rounding, and otherMs/otherPct are
    // derived the same way `wallAccountingTotals` derives its totals, off
    // the SAME `frameOtherMs` so the two can never disagree).
    frames: summary.frames.map((f) => {
      const { otherMs, negative } = frameOtherMs(f);
      return {
        ...f,
        totalMs: round2(f.totalMs),
        wallMs: round2(f.wallMs),
        marchMs: round2(f.marchMs),
        shadeMs: round2(f.shadeMs),
        readbackMs: round2(f.readbackMs),
        otherMs: round2(otherMs),
        otherPct: f.wallMs > 0 ? round2((otherMs / f.wallMs) * 100) : null,
        otherNegativeBeforeClamp: negative,
      };
    }),
    // "PER-FRAME WALL ACCOUNTING"'s closing totals — see
    // `wallAccountingTotals`'s own comment. `null` when no frame
    // completed (mirrors the printed report's own "skip the block"
    // rule).
    wallAccounting: (() => {
      const t = wallAccountingTotals(summary.frames);
      if (t === null) return null;
      return {
        totalWallMs: round2(t.totalWallMs),
        totalMarchMs: round2(t.totalMarchMs),
        totalShadeMs: round2(t.totalShadeMs),
        totalReadbackMs: round2(t.totalReadbackMs),
        totalOtherMs: round2(t.totalOtherMs),
        otherPctOfWall:
          t.otherPctOfWall === null ? null : round2(t.otherPctOfWall),
        anyNegative: t.anyNegative,
      };
    })(),
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
