#!/usr/bin/env node
/**
 * Surface FINISH gate: does an AUTHORED per-transform finish visibly change
 * the settled Surface render, on every requested engine/scene route, from a
 * real `#v1=` document driven through the real app?
 *
 * WHAT IT PROVES, and what it deliberately does not. On inverse IFS/lens
 * routes, `Transform.finish` (types.ts) rides the document into
 * `surface-slots.ts`'s gated slot list, which main.ts hands to
 * `surface-compute.ts`'s `create()` (the WGSL shade entry compiled with
 * `finish: true`, stride-3 shadeMaps) and to `surface-material.ts`'s
 * `SURFACE_FINISH` arm (the `uMapFinishA/B` uniforms over the same emitted
 * BRDF body). Forward escape routes instead take the head transform through
 * main.ts's `escapeSlotFinish()` and hand its one slot to the compute
 * renderer. A finish that decodes, packs and compiles but never reaches a
 * PIXEL — a uniform never uploaded, a stride the kernel does not read, a
 * define a recompose site dropped — is
 * invisible to every unit test, because none of them traces a frame. This
 * gate traces the frame twice per requested route: once from an unauthored
 * document and once from its finish-authored twin, and asserts the two
 * frames differ STRUCTURALLY where the object sits. The default lens3 scene
 * runs on both engines. The optional escape4 scene exercises the compute-only
 * 4D forward-orbit route and its head-transform finish wire. The
 * byte-identity control — "an unauthored document renders
 * literally today's programs" — is NOT re-proved in a browser here, on
 * purpose: it is pinned where it is cheap and exact, by the emission
 * string-equality tests (`surface-de-gpu.ts`'s `finish:false` source
 * against the pre-change module over every emission pair, the GLSL arms'
 * compile gates, and `finishShadeTs`'s value pin against the fixed
 * formula). A pixel diff can only say "nothing moved" to within a
 * screenshot; those tests say it to the byte.
 *
 * THE DEFAULT SCENE is `surface-repro.verify.mjs`'s lens3 — the fold-FINAL
 * lens archetype (a 4-map Sierpinski base under a boxfold final transform), so
 * the compute path takes the `lens:true` wrapper and the WebGL arm compiles
 * SURFACE_FOLD_LENS, and the one scenario in that harness whose render
 * FILLS the frame (~61k hit pixels at 1280x720). boxfold3 is too sparse for
 * a colour question: its object is ~0.5% of the frame. The hash is the
 * POSE-PINNED mint, verbatim, retained so this comparison is independent of
 * boot auto-frame policy. The original prototype predated the current
 * pinned boot seed: its pose-less scene framed from a random cloud and lit
 * up every silhouette — measured there, 8.9% of pixels.
 * The AUTHORED twin is derived IN THIS SCRIPT from that one embedded hash —
 * decode, set `transforms[0].finish = {metalness:1, reflect:1, specular:1,
 * shininess:96}` (chrome) and `transforms[2].finish = {transmit:0.65,
 * reflect:0.4}` (glass), re-encode — and the script asserts its own
 * decode/encode round trip reproduces the base hash byte for byte before it
 * opens a browser, so the pair can never drift apart.
 *
 * THE ESCAPE4 SCENE (`--scene=escape4`) is the shipped Mandelbox Brick's
 * minimal document: one Mandelbox link at -1.5, rotated 1 radian in xw. A
 * transform list is the escape formula chain even when its length is one,
 * and the w rotation makes this one route through `core:"escape4"`. This is
 * the dense 4D escape fixture (~41% of measured entry-pose rays hit), rather
 * than Hybrid Shells' much thinner two-link object. Its authored twin puts
 * the same strong chrome finish on transform 0 only. Forward-orbit hit-info
 * leaves `firstChoice = 0`, so the head is the ONLY finish slot and this pair
 * directly gates the assignment the escape4 routing arm once omitted. There
 * is deliberately no `?surfacegl` twin: 4D escape chains are compute-only,
 * and both compared captures must report engine="compute". Reduced motion
 * makes entry snap to the deterministic bailout-ball framing, so this route
 * can rely on its own fixed refit and needs no minted camera pose.
 *
 * SAME-STAGE CAPTURE is the discipline that makes the diff mean what it
 * claims. The full settle is EIGHT supersampling passes, and at 640x360 on
 * SwiftShader the wave-1 prototype measured it NOT completing inside 8
 * minutes on either engine — so a gate that simply waited for the latch
 * would hang, and a gate that captured "whatever is on screen at the
 * budget" would compare frames at DIFFERENT antialiasing stages, since
 * settle wall time varies up to 2x run to run on the same scene
 * (surface-repro's measurement). A mixed-stage pair is not tolerable for a
 * colour question even though a same-stage mid-settle pair is: the k- vs
 * (k+1)-sample means differ along every edge of an object that is ALL fine
 * crease detail, and that edge noise inflates the structural diff in the
 * direction that lets a finish that reached no pixel PASS.
 *
 * The stage is therefore defined by the RENDER, not the clock, and the
 * render makes it exact: both engines present only COMPLETED passes after
 * pass 0 (`surface-compute.ts`'s `runSamples` — "later samples present only
 * their finished mean"; `scene.ts`'s `presentSurfaceSampleImage` — "the
 * last COMPLETED image, never the half-traced pass"), so from the end of
 * pass 0 the canvas is PIECEWISE-CONSTANT: the 1-sample frame, then the
 * 2-sample mean, ..., then the 8-sample mean the latch fires on. The
 * progress row names which step is showing — its trailing `antialiasing
 * pass k/8` token means k-1 passes are complete and their mean is on
 * screen — and `?surfacestate`'s latch names the last one. A leg's STAGE
 * is that count of completed passes (1..7, with 8 = the settled latch held
 * for --dwell), and each leg captures the canvas at EVERY stage boundary it
 * crosses, after a short grace and only once two consecutive screenshots
 * are byte-identical. The pair is then diffed at the HIGHEST COMMON STAGE,
 * and the authored leg stops the moment it reaches the unauthored leg's
 * best stage, so the run costs no more than it must. The verdict line
 * discloses the stage ("settled" or "N/8 passes") and each leg's wall time.
 * If neither leg completes pass 0 inside the budget there is no common
 * stage and the arm is INCONCLUSIVE (exit 2): raise --settle or shrink
 * --viewport; that is the box being slow, not a finish verdict.
 *
 * THE REGION is the central 70% x 70% of the canvas, with every overlay
 * element's box masked out of it (surface-repro's overlay list). Two
 * lessons, both measured elsewhere in this directory: the explorer balloon
 * gate's row passed for a year at ~10% on a FULL-FRAME diff while the
 * shader under test drew exactly zero scene pixels — the control panel was
 * growing a row — so an assertion here compares the scene and never the
 * chrome; and a floor stated over the whole canvas is diluted by backdrop
 * that is identical in both legs BY CONSTRUCTION (a finish lights a hit; it
 * cannot touch a miss), so the same pixel count reads as a smaller fraction
 * the larger the viewport. In the prototype's 640x360 frames the lens3
 * object spans roughly x 230..420, y 70..280 — well inside the middle 70%
 * (x 96..544, y 54..306) — so the region holds the whole object and about
 * a third of it IS object, where the full canvas is ~17%. The full-canvas
 * numbers are still computed and printed for continuity with the prototype
 * figures; only the central-region structural fraction is asserted.
 *
 * MEASURED (wave-1 prototype, SwiftShader, 640x360, overlay-masked FULL
 * canvas, >8/255 structural): chrome+glass vs unauthored 4.858% of compared
 * pixels on the compute leg (engine=compute), 5.454% on the ?surfacegl leg
 * (engine=webgl), max channel delta ~190. The default --floor of 1.5% over
 * the central region sits several times under those (and the region
 * roughly doubles the fraction, see above). This script's own measured rows
 * are at the bottom of this comment.
 *
 * LAUNCH RECIPES — read before trusting an engine column.
 *   --mode=sw (default): headless SwiftShader. The compute leg REQUIRES
 *   `surface-export-tile.verify.mjs`'s recipe, copied verbatim: playwright
 *   `headless: false` COMBINED with `--headless=new`, plus
 *   `--enable-unsafe-webgpu --enable-features=Vulkan --ignore-gpu-blocklist
 *   --use-webgpu-adapter=swiftshader --use-vulkan=swiftshader`. Without it
 *   `navigator.gpu` is absent, the app silently routes WebGL, and a green
 *   "compute" leg would be a second WebGL leg — which is why the engine is
 *   ASSERTED off `window.__surfaceState().engine` and why a missing adapter
 *   is reported as a CHECKING failure (exit 2), not a verdict. Both arms run
 *   in that one browser; the WebGL arm is the same page with `?surfacegl`.
 *   --mode=x11:<display>: headed on a live X display, the only route to the
 *   real driver (Iris here) — and an agent/SSH shell arrives with a forwarded
 *   DISPLAY and no authorization for :0, so a run that MEANT Iris can land
 *   on SwiftShader without any error (CLAUDE.md's XAUTHORITY note). So
 *   every leg prints the WebGL unmasked renderer string and the WebGPU
 *   adapter's vendor/architecture/description (read in-page) beside the
 *   app's own console breadcrumbs ("Surface render: WebGPU compute tracer
 *   active (...)", "WebGL renderer is a software rasterizer: ..."), and a
 *   human reads those lines before believing a real-driver row.
 *
 * THE ENGINE IS SAMPLED AT CAPTURE TIME, NEVER AT A LEG'S FIRST POLL. A
 * compute-preferring session honestly reports engine="webgl" for its
 * opening polls: `surfaceComputeRenderer` (main.ts) stays null for the
 * whole async `SurfaceComputeRenderer.create()` (`beginSurfaceComputeGate`),
 * and the WebGL tracer is what the pane shows while that device+pipeline
 * build is in flight, so `__surfaceState().engine` reads "webgl" until the
 * gate's `.then()` resolves and "compute" for the rest of the session. An
 * earlier version of this script latched the FIRST non-null reading per
 * leg — so a compute arm that traced on WebGPU compute for its entire
 * settle still reported "ran engine=webgl, expected compute", because the
 * gate had long since resolved by the time any stage was captured but the
 * leg had already locked onto its opening poll. Each stage capture now
 * tags itself with the engine read in the SAME poll that confirmed the
 * capture parked (the `after` check beside `captureStable`), and the
 * verdict asserts THAT tag on the two frames actually diffed — never a
 * leg-wide summary that could predate or postdate them. Checking both legs
 * against the arm's one fixed `expectEngine` also proves they ran on the
 * SAME engine as each other: a compute-vs-webgl pair cannot both equal it.
 *
 * Usage (build + `npm run preview` first — this measures a real build):
 *   node scripts/finish.verify.mjs                       # sw, both arms
 *   node scripts/finish.verify.mjs --mode=x11::0 --arm=both
 *   node scripts/finish.verify.mjs --arm=compute --stage=1 --settle=240000
 *   node scripts/finish.verify.mjs --scene=escape4 --stage=1
 *   node scripts/finish.verify.mjs --scene=all --arm=both --stage=1
 *
 *   --url       app origin (default https://localhost:4173)
 *   --mode      sw (default) | x11:<display>
 *   --arm       compute | webgl | both (default both)
 *   --scene     lens3 (default) | escape4 | all. escape4 permits only the
 *               compute arm; `--scene=escape4 --arm=both` therefore runs
 *               its one compute route, while `--arm=webgl` is rejected.
 *   --viewport  WxH (default 640x360)
 *   --settle    per-leg budget in ms for reaching the target stage (default
 *               300000). The authored leg's budget stretches to twice the
 *               wall time the unauthored leg needed for its best stage when
 *               that is larger, so the 2x run-to-run pacing spread cannot
 *               strand a pair one stage apart.
 *   --stage     target stage for the unauthored leg: 8 (default) waits for
 *               the settled latch; 1..7 stops at that many completed passes
 *               (1 = the pre-supersampling full-quality frame, the cheap
 *               way to run this on SwiftShader).
 *   --dwell     ms the settled latch must hold continuously (default 2000).
 *   --floor     minimum structural-diff fraction over the central region
 *               (default 0.015).
 *   --outdir    where PNGs land (default .playwright-mcp/, gitignored).
 *
 * Exit codes: 0 every requested scene/arm route passed; 1 a verdict failed (engine
 * mismatch with an adapter present, floor not met, a page error); 2 a
 * CHECKING-side failure (no browser, no adapter, no common stage inside the
 * budget) — rerun, it is not a feature verdict. Runtime: with the defaults
 * this is ~20 minutes on SwiftShader (each leg runs to its budget, and the
 * settle never completes there); `--stage=1` is a few minutes; the real
 * driver settles in seconds.
 *
 * MEASURED (this script's own run, `--arm=both --mode=sw`, 640x360; neither
 * engine reaches the settled latch inside the default 300s/leg budget on
 * this box, so both arms compared at the common stage they actually
 * reached, 3/8 passes): compute (engine=compute/compute) 9.283%
 * central-region structural (10046 differing, max delta 190), 4.732% full
 * canvas; webgl (engine=webgl/webgl) 9.275% central-region structural
 * (10035 differing, max delta 192), 4.728% full canvas — both several times
 * over the 1.5% floor and within 0.01 points of each other, the CPU/GPU
 * parity the fold's authored-finish wire is built on, and consistent with
 * the wave-1 prototype's full-canvas 4.858%/5.454% pair above. Total wall
 * time 1113s (~18.5 min) for both arms in one browser. BEFORE THE FIX
 * DESCRIBED IN "THE ENGINE IS SAMPLED AT CAPTURE TIME" above, this same
 * scene reported the compute arm as "ran engine=webgl, expected compute"
 * on both legs, even though the console showed
 * "Surface render: WebGPU compute tracer active" and the progress row
 * showed "WebGPU (software)" throughout — the leg had locked its verdict
 * onto its opening poll, taken while `surfaceComputeRenderer` was still
 * null mid-gate.
 *
 * MEASURED (the escape4 addition, `--scene=escape4 --stage=1 --mode=sw`,
 * 640x360): the fixture completed all eight passes before the stage-1
 * capture could park, in 8.2s per leg / 16.6s total. Both compared captures
 * reported engine=compute and the two settles had the identical census
 * (11037 hits / 219363 misses / 0 exhausted), while the chrome head finish
 * changed 10468/107320 central-region pixels structurally — 9.754% against
 * the 1.5% floor — and 4.972% of the full canvas, max delta 188. Identical
 * geometry work plus an object-shaped diff is the material-wire verdict;
 * the optional 4D row is also far cheaper than the lens3 gate's default
 * SwiftShader pair.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.resolve(__dirname, "..", ".playwright-mcp");

/** surface-repro.verify.mjs's lens3 scenario hash, verbatim: LENS_BASE_HASH
 * after its boot auto-frame, re-encoded with the resulting camera pose (the
 * 2026-08-10 --mint). The ONE embedded document; both legs derive from it. */
const LENS3_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuMzUsMC4zNSwwLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfSx7InBvc2l0aW9uIjpbLTAuMzUsLTAuMzUsMC4zNV0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX0seyJwb3NpdGlvbiI6WzAuMzUsLTAuMzUsLTAuMzVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlstMC4zNSwwLjM1LC0wLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxLCJmaW5hbFRyYW5zZm9ybSI6eyJwb3NpdGlvbiI6WzAuMTUsLTAuMSwwLjA1XSwicm90YXRpb24iOlswLjIsMC4zLDAuMV0sInNjYWxlIjpbMC45LDAuOSwwLjldLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoiYm94Zm9sZCIsIndlaWdodCI6MC41NX1dfSwiY2FtZXJhIjp7InRhcmdldCI6WzAuMDU2OSwtMC4wOTI1LC0wLjAzNDhdLCJyYWRpdXMiOjEuNDM5OCwidGhldGEiOjAuNzg1NCwicGhpIjoxLjA1Nn19";

/** The 4D escape gate's minimal Mandelbox Brick document: mandelboxCube's
 * one -1.5 link, rotated 1 radian in xw. Derived from the browser-proven
 * escape4 document in surface-4d-lift.verify.mjs, with the second link
 * removed and the first changed to the denser shipped Brick shape. */
const ESCAPE4_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMSwxLDFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjotMS41fV0sInciOnsicm90YXRpb24iOnsieHciOjF9fX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiYmFsbG9vbkVjaG8iOmZhbHNlLCJiYWxsb29uUmFkaXVzIjoxLjYsImZvZ0RlbnNpdHkiOjEsImZvZ1RpbnQiOiIjZmZmZmZmIiwiZm9nVGludFN0cmVuZ3RoIjowLCJncm91bmRQbGFuZSI6ZmFsc2V9";

/** The finishes authored onto the base document, by transform index.
 * Transform 0 becomes chrome (fully metallic, fully reflective, an
 * overdriven tight highlight), transform 2 becomes glass (mostly
 * transmissive, partly reflective); 1 and 3 stay classic as in-frame
 * controls. Every value is far from the classic 0.4/32/0/0/0, so the
 * change is a colour change, not a highlight nudge. */
const AUTHORED_FINISHES = {
  0: { metalness: 1, reflect: 1, specular: 1, shininess: 96 },
  2: { transmit: 0.65, reflect: 0.4 },
};

const SCENES = [
  {
    name: "lens3",
    baseHash: LENS3_HASH,
    finishes: AUTHORED_FINISHES,
    armNames: ["compute", "webgl"],
  },
  {
    name: "escape4",
    baseHash: ESCAPE4_HASH,
    finishes: { 0: AUTHORED_FINISHES[0] },
    armNames: ["compute"],
  },
];

/** Overlay elements that can paint on top of the canvas (surface-repro's
 * list plus the toast). Their boxes are masked out of both the full-canvas
 * and the central-region counts, as the UNION over the two legs, so a
 * notice that appears in one leg only can neither add to nor hide a diff. */
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

/** Channel delta above which a differing pixel counts as STRUCTURAL rather
 * than a last-bit rounding wobble (surface-repro's constant). */
const STRUCTURAL_DELTA = 8;
/** The asserted region: the middle CENTER_FRACTION of the canvas on each
 * axis (see the module doc for why not the whole canvas). */
const CENTER_FRACTION = 0.7;
/** The app's supersampling pass count (main.ts's
 * SURFACE_COMPUTE_SETTLE_SAMPLES / scene.ts's SURFACE_STRIP_SETTLE_SAMPLES,
 * the same number by design). Stage SETTLE_SAMPLES is the settled latch. */
const SETTLE_SAMPLES = 8;
/** After a stage boundary is observed, how long to let the new mean's
 * present land before the stability check: the strip arm re-presents on its
 * SURFACE_SETTLE_PRESENT_MS (600ms) cadence, the compute arm on the next
 * rAF; one second covers both with margin. */
const STAGE_GRACE_MS = 1_000;
/** Gap between the two screenshots that must agree byte for byte. */
const STABLE_GAP_MS = 300;
const STABLE_ATTEMPTS = 5;
const POLL_MS = 250;

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    mode: "sw",
    arm: "both",
    scene: "lens3",
    viewport: "640x360",
    settle: 300_000,
    stage: SETTLE_SAMPLES,
    dwell: 2_000,
    floor: 0.015,
    outdir: DEFAULT_OUT_DIR,
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    if (!raw.startsWith("--") || !(key in args)) {
      throw new Error(`unknown flag ${raw}`);
    }
    if (["settle", "stage", "dwell", "floor"].includes(key)) {
      args[key] = Number(value);
      if (!Number.isFinite(args[key]))
        throw new Error(`--${key} wants a number`);
    } else args[key] = value;
  }
  if (!["compute", "webgl", "both"].includes(args.arm)) {
    throw new Error(`--arm must be compute, webgl or both (got ${args.arm})`);
  }
  if (!["lens3", "escape4", "all"].includes(args.scene)) {
    throw new Error(
      `--scene must be lens3, escape4 or all (got ${args.scene})`,
    );
  }
  if (args.arm === "webgl" && args.scene !== "lens3") {
    throw new Error(
      `--scene=${args.scene} includes compute-only escape4; use --arm=compute or --arm=both`,
    );
  }
  const vp = /^(\d+)x(\d+)$/.exec(args.viewport);
  if (!vp) throw new Error(`--viewport must be WxH (got ${args.viewport})`);
  args.width = Number(vp[1]);
  args.height = Number(vp[2]);
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
// Documents: decode the embedded hash, author the finishes, re-encode — the
// same base64url wire persist.ts uses (`+`->`-`, `/`->`_`, padding dropped).
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

function encodeHash(doc) {
  const b64 = Buffer.from(JSON.stringify(doc), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `#v1=${b64}`;
}

/** A scene's authored twin: the base document with its finish map applied.
 * Throws if the base does not round-trip byte for byte through this
 * script's own codec — the one way the two legs could silently diverge. */
function buildDocuments(scene) {
  const base = decodeHash(scene.baseHash);
  if (encodeHash(base) !== scene.baseHash) {
    throw new Error(
      `the embedded ${scene.name} hash does not round-trip through this script's codec; refusing to derive an authored twin from it`,
    );
  }
  const authored = decodeHash(scene.baseHash);
  for (const [index, finish] of Object.entries(scene.finishes)) {
    const t = authored.transforms[Number(index)];
    if (!t) {
      throw new Error(`${scene.name} base document has no transform ${index}`);
    }
    t.finish = { ...finish };
  }
  return [
    { name: "unauthored", hash: scene.baseHash },
    { name: "authored", hash: encodeHash(authored) },
  ];
}

// ---------------------------------------------------------------------------
// Browser.
// ---------------------------------------------------------------------------

function launchOptions(mode) {
  const env = { ...process.env };
  if (mode.startsWith("x11:")) {
    // Real driver (surface-repro's x11 idiom): a headed window on a live X
    // display, WebGPU through Vulkan, deliberately NO SwiftShader flags.
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
  // surface-export-tile.verify.mjs's headless WebGPU recipe, verbatim. The
  // `headless: false` + `--headless=new` combination (see launch()) is what
  // keeps a GPU process alive for the SwiftShader Vulkan adapter.
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

/** The two backend labels, read IN-PAGE rather than inferred from flags:
 * the WebGL unmasked renderer off a throwaway context (the app only logs
 * its own when it is software), and the WebGPU adapter's info off a second
 * requestAdapter() (harmless beside the app's). */
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
    let webgpu = "(navigator.gpu absent)";
    let adapter = false;
    if (navigator.gpu) {
      try {
        const a = await navigator.gpu.requestAdapter();
        if (a) {
          adapter = true;
          const info = a.info ?? {};
          const fallback =
            a.isFallbackAdapter === true || info.isFallbackAdapter === true;
          webgpu =
            [info.vendor, info.architecture, info.device, info.description]
              .filter((s) => typeof s === "string" && s.length > 0)
              .join(" / ") || "(blank adapter info)";
          if (fallback) webgpu += " [fallback adapter]";
        } else webgpu = "(requestAdapter returned null)";
      } catch (err) {
        webgpu = `(error: ${err instanceof Error ? err.message : String(err)})`;
      }
    }
    return { webgl, webgpu, adapter };
  });
}

/** Click into Surface once the mode button is enabled (eligibility lands
 * with the boot cloud). Returns the button state seen, so a refusal is
 * reported rather than waited out. */
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

/** One poll of the settle machinery: the `?surfacestate` latch plus the
 * progress row, reduced to this script's stage vocabulary. `completed` is
 * the number of finished supersampling passes whose mean is on screen
 * (0 while pass 0 traces or before the settle arms), `latched` the raw
 * settled verdict (held for --dwell by the caller). */
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

/** Canvas screenshot plus the overlay boxes to mask, in canvas-local pixels
 * (deviceScaleFactor is pinned to 1, so CSS px = image px). Nothing in the
 * page is mutated. */
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

/** A capture that is demonstrably of a PARKED canvas: after STAGE_GRACE_MS,
 * two screenshots STABLE_GAP_MS apart must agree byte for byte. Returns the
 * capture with `stable:false` if STABLE_ATTEMPTS pairs never agreed. */
async function captureStable(page) {
  await page.waitForTimeout(STAGE_GRACE_MS);
  let last = null;
  for (let i = 0; i < STABLE_ATTEMPTS; i++) {
    const a = await captureCanvas(page);
    await page.waitForTimeout(STABLE_GAP_MS);
    const b = await captureCanvas(page);
    last = b;
    if (a.buffer.equals(b.buffer)) return { ...b, stable: true };
  }
  return { ...last, stable: false };
}

/**
 * One leg: fresh context, boot the document, enter Surface, and capture the
 * canvas at every stage boundary up to `stopAt` (a completed-pass count;
 * SETTLE_SAMPLES means the settled latch) or the budget. Returns every
 * stage capture, keyed by stage, plus what the leg disclosed about itself.
 */
async function runLeg(browser, args, arm, leg, stopAt, budgetMs, log) {
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
    arm: arm.name,
    leg: leg.name,
    captures,
    consoleLines,
    pageErrors,
    engine: null,
    labels: null,
    final: null,
    stopReason: null,
    elapsedMs: 0,
  };
  const t0 = Date.now();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(budgetMs + 60_000);
    page.on("console", (msg) => consoleLines.push(msg.text()));
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.bringToFront();
    const base = args.url.replace(/\/+$/, "");
    const search = arm.query ? `?surfacestate&${arm.query}` : "?surfacestate";
    await bootScene(page, `${base}/${search}${leg.hash}`);
    result.labels = await readBackendLabels(page);
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
      // Sticky-LAST, not sticky-first: see "THE ENGINE IS SAMPLED AT
      // CAPTURE TIME" above. This leg-wide field is a diagnostic only
      // (describeLeg's log line, and the CHECKING fallback for a leg that
      // captured nothing) — the verdict itself asserts the engine tagged on
      // each capture below, never this one.
      if (s.probe.engine) result.engine = s.probe.engine;
      if (s.rowText !== lastRow) {
        lastRow = s.rowText;
        log(
          `    [${((Date.now() - t0) / 1000).toFixed(0)}s] ${s.rowText || "(row hidden)"}`,
        );
      }
      // The settled latch, held for --dwell: stage SETTLE_SAMPLES.
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
              // The engine that produced THIS pixel data, read in the same
              // poll that confirmed the capture — not the leg's opening poll.
              engine: after.probe.engine,
            });
            result.stopReason = "settled";
            return result;
          }
          // A late invalidation re-armed the settle mid-capture (the grid
          // landing is the documented one); start the dwell over.
          heldSince = null;
          continue;
        }
      } else heldSince = null;

      // A stage boundary: k completed passes now on screen.
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
            // Same rule as the settled capture above: tag the engine from
            // the confirming poll, not the leg's opening one.
            engine: after.probe.engine,
          });
          log(
            `    captured stage ${stage}/${SETTLE_SAMPLES} at ${((Date.now() - t0) / 1000).toFixed(1)}s${shot.stable ? "" : " (UNSTABLE canvas)"}`,
          );
          lastCompleted = stage;
          if (stage >= stopAt) {
            result.stopReason = `reached stage ${stage}`;
            return result;
          }
        } else {
          // The pass advanced during the capture (a fast driver); the next
          // poll sees the new boundary.
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
// Diff: inside a page (no image dependency in this repo), over the unmasked
// full canvas AND the unmasked central region. Red marks every differing
// pixel; a green outline shows the asserted region.
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
      const out = document.createElement("canvas");
      out.width = width;
      out.height = height;
      const octx = out.getContext("2d");
      const img = octx.createImageData(width, height);
      const full = { compared: 0, differing: 0, structural: 0, maxDelta: 0 };
      const center = { compared: 0, differing: 0, structural: 0, maxDelta: 0 };
      for (let i = 0, p = 0; p < width * height; p++, i += 4) {
        img.data[i] = A.data[i] >> 1;
        img.data[i + 1] = A.data[i + 1] >> 1;
        img.data[i + 2] = A.data[i + 2] >> 1;
        img.data[i + 3] = 255;
        if (masked[p]) continue;
        const x = p % width;
        const y = (p - x) / width;
        const central = inRegion(x, y);
        full.compared++;
        if (central) center.compared++;
        const d = Math.max(
          Math.abs(A.data[i] - B.data[i]),
          Math.abs(A.data[i + 1] - B.data[i + 1]),
          Math.abs(A.data[i + 2] - B.data[i + 2]),
        );
        if (d === 0) continue;
        full.differing++;
        if (d > full.maxDelta) full.maxDelta = d;
        if (d > structuralDelta) full.structural++;
        if (central) {
          center.differing++;
          if (d > center.maxDelta) center.maxDelta = d;
          if (d > structuralDelta) center.structural++;
        }
        img.data[i] = d > structuralDelta ? 255 : 160;
        img.data[i + 1] = 0;
        img.data[i + 2] = 0;
      }
      octx.putImageData(img, 0, 0);
      octx.strokeStyle = "rgb(0, 255, 0)";
      octx.lineWidth = 1;
      octx.strokeRect(
        region.x + 0.5,
        region.y + 0.5,
        region.w - 1,
        region.h - 1,
      );
      return {
        width,
        height,
        full,
        center,
        diffPng: out.toDataURL("image/png").split(",")[1],
      };
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

/** Console lines worth echoing: the app's own engine/software breadcrumbs
 * and the compute settle census. */
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outdir, { recursive: true });
  const arms = [
    { name: "compute", query: "", expectEngine: "compute" },
    { name: "webgl", query: "surfacegl", expectEngine: "webgl" },
  ].filter((a) => args.arm === "both" || a.name === args.arm);
  const scenes = SCENES.filter(
    (s) => args.scene === "all" || s.name === args.scene,
  );
  const legsByScene = new Map(
    scenes.map((scene) => [scene, buildDocuments(scene)]),
  );
  const jobs = scenes.flatMap((scene) =>
    arms
      .filter((arm) => scene.armNames.includes(arm.name))
      .map((arm) => ({
        scene,
        arm,
        legs: legsByScene.get(scene),
        label: scene.name === "lens3" ? arm.name : `${scene.name}/${arm.name}`,
        fileStem:
          scene.name === "lens3"
            ? `finish-${arm.name}`
            : `finish-${scene.name}-${arm.name}`,
      })),
  );
  const log = (line) => console.error(`[finish] ${line}`);
  const region = centralRegion(args.width, args.height);

  log(
    `scenes=${args.scene}, ${args.width}x${args.height}, mode=${args.mode}, routes=${jobs.map((j) => j.label).join("+")}, ` +
      `target stage ${stageName(args.stage)}, budget ${args.settle / 1000}s/leg, floor ${(args.floor * 100).toFixed(2)}% ` +
      `structural (>${STRUCTURAL_DELTA}/255) over the central ${CENTER_FRACTION * 100}% region ` +
      `x[${region.x}..${region.x + region.w - 1}] y[${region.y}..${region.y + region.h - 1}]`,
  );
  for (const scene of scenes) {
    const legs = legsByScene.get(scene);
    log(
      `${scene.name} authored twin: ${legs[1].hash.length} chars (base ${legs[0].hash.length})`,
    );
  }

  const { env, args: launchArgs } = launchOptions(args.mode);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: chromium.executablePath(),
      headless: false, // + --headless=new under sw: the combination that keeps a GPU process
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

    for (const { arm, legs, label, fileStem } of jobs) {
      log(
        `=== ${label} (${arm.query ? `?${arm.query}` : "default routing"}) ===`,
      );
      const results = [];
      let stopAt = args.stage;
      let budget = args.settle;
      for (const leg of legs) {
        log(
          `  leg ${leg.name}: stop at ${stageName(stopAt)}, budget ${(budget / 1000).toFixed(0)}s`,
        );
        let r;
        try {
          r = await runLeg(browser, args, arm, leg, stopAt, budget, log);
        } catch (err) {
          log(`  CHECKING FAILURE on ${label}/${leg.name}: ${err.message}`);
          inconclusive++;
          verdicts.push(
            `${label}: INCONCLUSIVE — ${leg.name} leg threw before a capture (${err.message})`,
          );
          results.length = 0;
          break;
        }
        log(`  leg ${leg.name}: ${describeLeg(r)}`);
        log(`    WebGL renderer: ${r.labels?.webgl ?? "?"}`);
        log(`    WebGPU adapter: ${r.labels?.webgpu ?? "?"}`);
        for (const line of interestingConsole(r.consoleLines))
          log(`    console: ${line}`);
        for (const e of r.pageErrors) log(`    PAGE ERROR: ${e}`);
        for (const [stage, cap] of r.captures) {
          const file = path.join(
            args.outdir,
            `${fileStem}-${leg.name}-s${stage}.png`,
          );
          await writeFile(file, cap.buffer);
        }
        results.push(r);
        // The authored leg only needs to reach the unauthored leg's best
        // stage, and gets at least twice the time that stage cost there.
        const best = Math.max(0, ...r.captures.keys());
        if (best === 0) break;
        stopAt = best;
        budget = Math.max(args.settle, 2 * r.captures.get(best).elapsedMs);
      }
      if (results.length === 0) continue;

      // --- verdict for this scene/arm route ---
      // A leg that captured no stage at all has no per-capture engine to
      // check; fall back to its last-observed engine (sticky-last, set in
      // runLeg) so a missing WebGPU adapter still reads as CHECKING rather
      // than a bare "reached no stage" — but this is the ONLY place a
      // leg-wide engine reading decides anything. Once both legs have a
      // capture, the engine assertion below reads the capture itself.
      if (results.length < 2) {
        const r = results[0];
        inconclusive++;
        if (arm.expectEngine === "compute" && r.labels && !r.labels.adapter) {
          verdicts.push(
            `${label}: INCONCLUSIVE — ${r.leg} leg: no WebGPU adapter in this browser (engine=${r.engine ?? "none"}) — the launch recipe did not yield one; see the module doc`,
          );
        } else {
          verdicts.push(
            `${label}: INCONCLUSIVE — the unauthored leg reached no stage inside ${(args.settle / 1000).toFixed(0)}s (${r.stopReason}); raise --settle or shrink --viewport`,
          );
        }
        continue;
      }
      const [un, au] = results;
      const common = [...un.captures.keys()]
        .filter((s) => au.captures.has(s))
        .sort((a, b) => b - a)[0];
      if (common === undefined) {
        inconclusive++;
        verdicts.push(
          `${label}: INCONCLUSIVE — no common stage (unauthored [${[...un.captures.keys()].join(",")}], authored [${[...au.captures.keys()].join(",")}]); raise --settle`,
        );
        continue;
      }
      const capA = un.captures.get(common);
      const capB = au.captures.get(common);

      const problems = [];
      let checking = null;
      for (const r of results) {
        if (r.pageErrors.length) {
          problems.push(
            `${r.leg} leg: ${r.pageErrors.length} page error(s): ${r.pageErrors[0]}`,
          );
        }
      }
      // THE ENGINE ASSERTION READS THE COMPARED CAPTURES, not a leg-wide
      // summary — see "THE ENGINE IS SAMPLED AT CAPTURE TIME" in the module
      // doc. Checking both legs against the arm's one fixed expectEngine
      // also proves they ran on the SAME engine as each other.
      for (const [r, cap] of [
        [un, capA],
        [au, capB],
      ]) {
        if (cap.engine !== arm.expectEngine) {
          if (arm.expectEngine === "compute" && r.labels && !r.labels.adapter) {
            checking ??= `${r.leg} leg: no WebGPU adapter in this browser (engine=${cap.engine ?? "none"} at the compared stage) — the launch recipe did not yield one; see the module doc`;
          } else {
            problems.push(
              `${r.leg} leg ran engine=${cap.engine ?? "none"} at the compared stage (${stageName(common)}), expected ${arm.expectEngine}`,
            );
          }
        }
      }
      if (checking !== null) {
        inconclusive++;
        verdicts.push(`${label}: INCONCLUSIVE — ${checking}`);
        continue;
      }

      const masks = [...capA.geometry.overlays, ...capB.geometry.overlays];
      const d = await diffPngs(
        diffPage,
        capA.buffer,
        capB.buffer,
        masks,
        region,
      );
      if (d.error) {
        inconclusive++;
        verdicts.push(`${label}: INCONCLUSIVE — diff failed: ${d.error}`);
        continue;
      }
      const diffFile = path.join(
        args.outdir,
        `${fileStem}-diff-s${common}.png`,
      );
      await writeFile(diffFile, Buffer.from(d.diffPng, "base64"));
      const centerFrac =
        d.center.compared > 0 ? d.center.structural / d.center.compared : 0;
      const fullFrac =
        d.full.compared > 0 ? d.full.structural / d.full.compared : 0;
      log(
        `  ${label} @ ${stageName(common)}: central region ${d.center.structural}/${d.center.compared} structural ` +
          `(${(centerFrac * 100).toFixed(3)}%, ${d.center.differing} differing, max delta ${d.center.maxDelta}); ` +
          `full canvas ${d.full.structural}/${d.full.compared} structural (${(fullFrac * 100).toFixed(3)}%, max delta ${d.full.maxDelta}); ` +
          `${masks.length} overlay box(es) masked -> ${path.basename(diffFile)}`,
      );
      if (!capA.stable || !capB.stable) {
        problems.push(
          `a stage-${common} capture never parked (unauthored stable=${capA.stable}, authored stable=${capB.stable})`,
        );
      }
      if (centerFrac < args.floor) {
        problems.push(
          `central-region structural diff ${(centerFrac * 100).toFixed(3)}% < floor ${(args.floor * 100).toFixed(2)}%`,
        );
      }
      const stageLine =
        `stage ${stageName(common)} in both legs (unauthored ${un.stopReason} at ${(un.elapsedMs / 1000).toFixed(1)}s, ` +
        `authored ${au.stopReason} at ${(au.elapsedMs / 1000).toFixed(1)}s)`;
      if (problems.length) {
        failures++;
        verdicts.push(
          `${label} (engine=${capA.engine}/${capB.engine}): FAIL — ${problems.join("; ")}; ${stageLine}`,
        );
      } else {
        verdicts.push(
          `${label} (engine=${capA.engine}): PASS — authored vs unauthored ${(centerFrac * 100).toFixed(3)}% structural over the central region ` +
            `(floor ${(args.floor * 100).toFixed(2)}%; full canvas ${(fullFrac * 100).toFixed(3)}%, max delta ${d.full.maxDelta}); ${stageLine}`,
        );
      }
    }
  } finally {
    log("===== VERDICTS =====");
    for (const v of verdicts) log(v);
    log(
      `wall time ${((Date.now() - t0) / 1000).toFixed(1)}s (scene=${args.scene}, mode=${args.mode}, viewport=${args.viewport}, settle=${args.settle}ms, stage=${args.stage}, floor=${args.floor})`,
    );
    await browser.close().catch(() => {});
  }
  if (failures > 0) process.exit(1);
  if (inconclusive > 0 || verdicts.length < jobs.length) process.exit(2);
  process.exit(0);
}

main().catch((err) => {
  console.error("[finish] fatal:", err);
  process.exit(2);
});
