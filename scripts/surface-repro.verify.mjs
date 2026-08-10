#!/usr/bin/env node
/**
 * fr-opgk determinism harness: render the SAME surface scene N times from
 * FRESH page loads on the SAME build, and diff the settled frames pixel for
 * pixel. Existence proof (or refutation) for visual A/B regression testing
 * of a renderer whose whole discipline is CPU-oracle-mirrors-GPU — the bead
 * measured 2.9% differing pixels between two runs of one pose, which made a
 * branch-vs-main A/B (3.2%) indistinguishable from its own control.
 *
 * TWO THINGS make a run-to-run comparison meaningful, and both are the
 * point of this script:
 *
 *  1. THE POSE MUST BE PINNED IN THE DOCUMENT. A pose-less scene auto-frames
 *     itself at boot from `frameBounds` — trimmed quantiles over a chaos game
 *     seeded with `Math.random()` (main.ts's `rollSeed`) — so the camera
 *     radius/target differ by a fraction of a percent on every load, and a
 *     sub-pixel-to-few-pixel reframing lights up the silhouette of every
 *     object in the frame. That is a whole-image difference with nothing to
 *     do with the renderer, and it is MEASURED, not theorised: two `--mint`
 *     runs of these very scenes minutes apart auto-framed sierpinski3 at
 *     radius 4.1597 vs 4.1747 (0.36%), pentatope4 at 2.3117 vs 2.3038, and
 *     boxfold3's target at [0.1724,-0.0662,0.2449] vs [0.1726,-0.0660,
 *     0.2452]. Every SCENARIO hash below therefore carries a
 *     `camera` (and, for 4D, a `fourD`) block, which main.ts's boot applies
 *     INSTEAD of fitting (see `saved?.camera` in main.ts). They were minted
 *     by this script's own `--mint` mode — see MINTING below — so the
 *     provenance is reproducible rather than hand-typed.
 *     `emulateMedia({reducedMotion:"reduce"})` covers the rest of the motion
 *     surface: no entry glide, no 3D auto-orbit, no 4D auto-tumble.
 *
 *  2. "THE PIXELS STOPPED CHANGING" IS NOT A SETTLED FRAME. The full-quality
 *     pass renders into a target SEEDED FROM THE PREVIEW (strip-planner.ts /
 *     scene.ts's preview-seeded-target discipline; surface-compute.ts's
 *     colorOut prefill), and its pacing is driven by MEASURED GPU time — so
 *     a poll cadence over canvas screenshots can freeze a mix of preview and
 *     settle pixels whose ratio varies with machine load. Nor is the
 *     `#surfaceProgress` row an answer: it is hidden both BEFORE a job arms
 *     and after one finishes. This script waits on the app's own latch
 *     instead — `window.__surfaceState()`, published by `?surfacestate`
 *     (fr-opgk, main.ts's SurfaceStateProbe): a read-only view of
 *     main.ts's `surfaceSettled` (a COMPLETED full-quality frame is on
 *     screen for the CURRENT, uninvalidated view) plus the in-flight
 *     preview/settle flags of whichever engine owns the session. The
 *     verdict is
 *         mode==="surface" && firstFrame && settled &&
 *         !previewActive && !settleActive && !settlePending
 *     held continuously for --dwell ms — the dwell covers late
 *     invalidations that legitimately re-settle the view, above all the
 *     empty-space grid landing from its worker (main.ts's `onGrid` calls
 *     `scene.invalidate()`, which supersedes an already-latched settle).
 *
 * MEASURED VERDICT (2026-08-10, Iris Xe real driver via --mode=x11::0,
 * production build behind `npm run preview`, 1280x720, 3 fresh loads each):
 * every scenario on every arm is BIT-IDENTICAL once truly settled — 0
 * differing pixels, max channel delta 0, over all four scenarios on BOTH
 * arms — the WebGPU compute arm (boxfold3/pentatope4/lens3; sierpinski3 is
 * affine, so it runs WebGL either way) and the WebGL `?surfacegl` arm. The
 * PNGs are byte-identical, not merely pixel-equal. That holds while the
 * settle WALL TIME varies by up to 2x between runs of the same scene
 * (boxfold3/surfacegl settled in 8.6/4.3/4.6s; lens3/surfacegl in
 * 11.4/12.2/9.9s), which is the point: the pacing is timing-dependent, the
 * pixels are not. Raising --dwell from 2s to 12s on the grid scenario
 * returned a byte-identical PNG, so the empty-space grid's timing-picked
 * resolution does not leak into the settled frame either.
 *
 * One full pass (4 scenarios x 3 fresh loads) costs ~72s on the compute arm
 * and ~92s with `--query=surfacegl` — i.e. an A/B of two builds is ~6
 * minutes of wall time, dominated by page boots rather than tracing.
 *
 * And the CONTROL says what the bead actually measured. The same scenes at
 * `--pose=free` — identical in every respect except that boot auto-frames
 * them — are NOT reproducible: lens3 8.900/9.131/8.963% of pixels differing
 * with max channel delta 216-223, pentatope4 0.885/0.937/1.005% at max delta
 * 202-232, and the compute settle census moving with it (lens3 hit counts
 * 60328 / 60840 / 59844 where the pinned pose reports 60912 every time).
 * The diff images are the whole object lit up, not scattered speckle: the
 * camera moved, the renderer did not. That is the bead's 2.9%/170 in kind
 * and in magnitude.
 *
 * WHAT IT REPORTS, per scenario+arm: the settle wall time of each run, then
 * every pairwise diff — %-pixels-differing, max channel delta, and the count
 * differing by more than 8/255 (rounding vs structure) — plus a red-marked
 * diff PNG for any pair that differs. Verdict line is DETERMINISTIC (zero
 * differing pixels across every pair) or the measured spread.
 *
 * Page chrome that overlays the canvas (#panel, #help's point count, the
 * legend, the menu toggle) is MASKED OUT of the diff from the elements' own
 * bounding boxes, so the verdict is about traced pixels only — and the mask
 * is asserted identical across runs, so a moved overlay cannot hide a diff.
 *
 * Usage (build + `npm run preview` first — this measures a real build):
 *   node scripts/surface-repro.verify.mjs --url=https://localhost:4173 \
 *     --mode=x11::0 --scenario=boxfold3 --runs=3
 *   node scripts/surface-repro.verify.mjs --scenario=pentatope4 \
 *     --query=surfacegl --mode=x11::0
 *
 *   --scenario  boxfold3    = the fr-jmat boxfold PAIR (3D fold, cheap;
 *                             prefers WebGPU compute since fr-tzdg). Its
 *                             render is a thin dust — ~1.8k hit pixels — so
 *                             read it as a fold-path check, not a coverage
 *                             one; lens3 carries the coverage.
 *               pentatope4  = the Pentatope Gasket preset (the bead's own
 *                             scene — plain 4D, so it prefers the compute
 *                             affine4 core since fr-dlxh's 4D cut). A w=0
 *                             SLICE of a 4D gasket is likewise sparse
 *                             (~5.7k hit pixels).
 *               lens3       = fr-g58b's fold-FINAL lens archetype: the
 *                             `lens:true` compute wrapper / the WebGL
 *                             SURFACE_FOLD_LENS variant, and the one
 *                             scenario here that FILLS the frame (~61k hit
 *                             pixels of fine crease detail — the pixels a
 *                             real regression would move).
 *               sierpinski3 = a plain affine 3D system: the ONLY arm that
 *                             builds an empty-space grid, whose resolution
 *                             the worker picks from a MEASURED pilot slab
 *                             (surface-grid-worker-core.ts) — i.e. the one
 *                             place a timing measurement is known to reach
 *                             the marched image. Diagnosis scenario, and
 *                             the second high-coverage one.
 *               all         = every scenario above, in order.
 *   --query     extra query string (no leading "?"), inserted before the
 *               scene hash. `--query=surfacegl` forces the WebGL arm
 *               (fragment tracer) where compute would otherwise win.
 *               `?surfacestate` is always appended by this script.
 *   --mode      x11:<display> = headed on that X display (REAL driver — the
 *               only route to Iris/WebGPU here, per surface-4d.verify.mjs);
 *               sw = headless SwiftShader (cheap smoke of the harness
 *               itself, NOT a verdict about the real driver).
 *   --pose      pinned (default) = the minted, pose-carrying hash: the
 *               measurement configuration. free = the SAME system with no
 *               stored pose, so boot auto-frames it from a Math.random()-
 *               seeded cloud — the CONTROL, and a faithful reproduction of
 *               the bead's original setup. Run it once and the difference
 *               between the two numbers is the answer to "is this the
 *               renderer or the camera?".
 *   --runs      fresh loads per scenario+arm (default 3, minimum 2).
 *   --dwell     ms the settled verdict must hold continuously (default 2000).
 *   --settle    per-run budget for reaching that state (default 240000).
 *   --outdir    where PNGs land (default .playwright-mcp/, gitignored).
 *   --mint      MINTING mode: boot the scenario's BASE scene (raw preset or
 *               raw hash, no pose), let it auto-frame, save it to the
 *               collection — which encodes `currentDocument()`, camera and
 *               4D pose included — and print the resulting `#v1=` hash for
 *               pasting into SCENARIOS below. Run it once per scenario when
 *               a scene needs re-minting; the constants below are its
 *               output.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = path.resolve(__dirname, "..", ".playwright-mcp");

// ---------------------------------------------------------------------------
// Scenarios. `hash` is the POSE-PINNED document this script renders (minted
// by --mint, see the module doc); `base` is what --mint boots to re-mint it —
// either {preset} (a #presetSelect value) or {hash} (a pose-less deep link).
// ---------------------------------------------------------------------------

/** The fr-jmat boxfold pair, verbatim from surface-fold.verify.mjs's
 * BOXFOLD_HASH: two single-variation boxfold maps, `deHasFolds` true,
 * eligibility "eligible". Pose-less — the --mint input, not a scenario. */
const BOXFOLD_BASE_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjEsMF0sInJvdGF0aW9uIjpbMC4zLDAuMiwwXSwic2NhbGUiOlswLjQ1LDAuNDUsMC40NV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjoxfV19LHsicG9zaXRpb24iOlstMC4zNSwtMC4yLDAuM10sInJvdGF0aW9uIjpbMCwwLjUsMC4xXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjowLjl9XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwiYXhpcyI6InkifSwiZ2xvd0JyaWdodG5lc3MiOjF9";

/** fr-g58b's lens archetype, verbatim from surface-fold.verify.mjs's
 * LENS_HASH: a Sierpinski-shaped 4-map affine base under a boxfold FINAL
 * transform, so the compute path takes the `lens:true` wrapper over the
 * affine core and the WebGL arm compiles SURFACE_FOLD_LENS. Its render
 * FILLS the frame, which the two sparse scenarios above do not — the
 * strongest coverage this harness has for the fold machinery. Pose-less —
 * the --mint input. */
const LENS_BASE_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuMzUsMC4zNSwwLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfSx7InBvc2l0aW9uIjpbLTAuMzUsLTAuMzUsMC4zNV0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX0seyJwb3NpdGlvbiI6WzAuMzUsLTAuMzUsLTAuMzVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlstMC4zNSwwLjM1LC0wLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJheGlzIjoieSJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiZmluYWxUcmFuc2Zvcm0iOnsicG9zaXRpb24iOlswLjE1LC0wLjEsMC4wNV0sInJvdGF0aW9uIjpbMC4yLDAuMywwLjFdLCJzY2FsZSI6WzAuOSwwLjksMC45XSwidmFyaWF0aW9ucyI6W3sidHlwZSI6ImJveGZvbGQiLCJ3ZWlnaHQiOjAuNTV9XX19";

const SCENARIOS = [
  {
    name: "boxfold3",
    base: { hash: BOXFOLD_BASE_HASH },
    // --mint output, 2026-08-10 (Iris Xe, 1280x720): BOXFOLD_BASE_HASH after
    // its boot auto-frame, re-encoded with the resulting camera pose.
    hash: "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNCwwLjEsMF0sInJvdGF0aW9uIjpbMC4zLDAuMiwwXSwic2NhbGUiOlswLjQ1LDAuNDUsMC40NV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjoxfV19LHsicG9zaXRpb24iOlstMC4zNSwtMC4yLDAuM10sInJvdGF0aW9uIjpbMCwwLjUsMC4xXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInZhcmlhdGlvbnMiOlt7InR5cGUiOiJib3hmb2xkIiwid2VpZ2h0IjowLjl9XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiY2FtZXJhIjp7InRhcmdldCI6WzAuMTcyNiwtMC4wNjYsMC4yNDUyXSwicmFkaXVzIjoxLjQ2MDEsInRoZXRhIjowLjc4NTQsInBoaSI6MS4wNTZ9fQ",
  },
  {
    name: "pentatope4",
    base: { preset: "pentatope" },
    // --mint output, 2026-08-10: the Pentatope Gasket preset after its load
    // auto-frame, carrying the 4D pose too (the reduced-motion reset rotor
    // and slice 0 — a fixed pose, not the identity; two mints produced it
    // bit-identical, unlike the camera).
    hash: "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuMjc5NSwwLjI3OTUsMC4yNzk1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InBvc2l0aW9uIjotMC4xMjV9fSx7InBvc2l0aW9uIjpbMC4yNzk1LC0wLjI3OTUsLTAuMjc5NV0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XSwidyI6eyJwb3NpdGlvbiI6LTAuMTI1fX0seyJwb3NpdGlvbiI6Wy0wLjI3OTUsMC4yNzk1LC0wLjI3OTVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInciOnsicG9zaXRpb24iOi0wLjEyNX19LHsicG9zaXRpb24iOlstMC4yNzk1LC0wLjI3OTUsMC4yNzk1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InBvc2l0aW9uIjotMC4xMjV9fSx7InBvc2l0aW9uIjpbMCwwLDBdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV0sInciOnsicG9zaXRpb24iOjAuNX19XSwibnVtUG9pbnRzIjoxMDAwMDAsInBvaW50U2l6ZSI6MSwiY29sb3JNb2RlIjoidHJhbnNmb3JtIiwiY29sb3JHYW1tYSI6MSwicmFtcFBhbGV0dGVJZCI6ImxlZ2FjeSIsImZvdXJEQ29sb3IiOiJ3Qmx1ZU9yYW5nZSIsImZvdXJERGVwdGhGYWRlIjpmYWxzZSwicmVuZGVyU3R5bGUiOiJkZXB0aEZhZGUiLCJzaG93R3VpZGVzIjp0cnVlLCJmbGFtZSI6eyJleHBvc3VyZSI6MSwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsImdhbW1hIjoyLjQsInZpYnJhbmN5IjoxLCJzdXBlcnNhbXBsZSI6MiwiZXN0aW1hdG9yUmFkaXVzIjo2LCJlc3RpbWF0b3JNaW5pbXVtUmFkaXVzIjowLCJlc3RpbWF0b3JDdXJ2ZSI6MC40LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzb2xpZCI6eyJyZXNvbHV0aW9uIjoxOTIsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJ0aHJlc2hvbGQiOjAuMywibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic3VyZmFjZSI6eyJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJjb2xvclNvdXJjZSI6InRyYW5zZm9ybSIsInBhbGV0dGVJZCI6InNwZWN0cnVtIiwiY29sb3JTcGVlZCI6MC41fSwic3ltbWV0cnkiOnsib3JkZXIiOjEsInBsYW5lIjoieHoifSwiZ2xvd0JyaWdodG5lc3MiOjEsImNhbWVyYSI6eyJ0YXJnZXQiOlswLDAsMF0sInJhZGl1cyI6Mi4zMDM4LCJ0aGV0YSI6MC43ODU0LCJwaGkiOjEuMDU2fSwiZm91ckQiOnsicCI6WzAuOTg4OCwwLDAsLTAuMTQ5NF0sInEiOlswLjczMTcsMCwwLDAuNjgxNl0sInNsaWNlT24iOmZhbHNlLCJzbGljZUNlbnRlciI6MCwic2xpY2VUaGlja25lc3MiOjAsInNsaWNlUmVsQ29sb3IiOmZhbHNlfX0",
  },
  {
    name: "lens3",
    base: { hash: LENS_BASE_HASH },
    // --mint output, 2026-08-10: LENS_BASE_HASH after its boot auto-frame.
    hash: "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuMzUsMC4zNSwwLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfSx7InBvc2l0aW9uIjpbLTAuMzUsLTAuMzUsMC4zNV0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX0seyJwb3NpdGlvbiI6WzAuMzUsLTAuMzUsLTAuMzVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlstMC4zNSwwLjM1LC0wLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxLCJmaW5hbFRyYW5zZm9ybSI6eyJwb3NpdGlvbiI6WzAuMTUsLTAuMSwwLjA1XSwicm90YXRpb24iOlswLjIsMC4zLDAuMV0sInNjYWxlIjpbMC45LDAuOSwwLjldLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoiYm94Zm9sZCIsIndlaWdodCI6MC41NX1dfSwiY2FtZXJhIjp7InRhcmdldCI6WzAuMDU2OSwtMC4wOTI1LC0wLjAzNDhdLCJyYWRpdXMiOjEuNDM5OCwidGhldGEiOjAuNzg1NCwicGhpIjoxLjA1Nn19",
  },
  {
    name: "sierpinski3",
    base: { preset: "sierpinski" },
    // --mint output, 2026-08-10: the Sierpinski Tetrahedron preset after its
    // load auto-frame. Plain affine 3D — the empty-space-grid arm.
    hash: "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMC44LDBdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlswLjc1LC0wLjQsMF0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX0seyJwb3NpdGlvbiI6Wy0wLjM3NSwtMC40LDAuNjVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlstMC4zNzUsLTAuNCwtMC42NV0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiY2FtZXJhIjp7InRhcmdldCI6WzAuMzE1NCwwLjMwNzQsMC4wMTA2XSwicmFkaXVzIjo0LjE3NDcsInRoZXRhIjowLjc4NTQsInBoaSI6MS4wNTZ9fQ",
  },
];

/** Overlay elements that can paint on top of the canvas. Their boxes are
 * masked out of every diff (see the module doc) so page chrome — above all
 * the point count and the progress row — can never be mistaken for traced
 * pixels, in either direction. */
const OVERLAY_SELECTORS = [
  "#panel",
  "#help",
  "#legend",
  "#menuToggle",
  "#loading",
  "#error",
  "#updateBanner",
  "#renderError",
];

/** Channel delta above which a differing pixel counts as STRUCTURAL rather
 * than a last-bit rounding wobble. Reported separately, never used to
 * excuse a diff: the verdict below is zero-differing-pixels. */
const STRUCTURAL_DELTA = 8;

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    mode: "x11::0",
    scenario: "boxfold3",
    query: "",
    runs: 3,
    dwell: 2_000,
    settle: 240_000,
    outdir: DEFAULT_OUT_DIR,
    pose: "pinned",
    mint: false,
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = raw.slice(2, eq === -1 ? undefined : eq);
    const value = eq === -1 ? "" : raw.slice(eq + 1);
    if (!(key in args)) throw new Error(`unknown flag --${key}`);
    if (key === "mint") args.mint = value !== "false";
    else if (key === "runs" || key === "dwell" || key === "settle") {
      args[key] = Number(value);
    } else args[key] = value;
  }
  if (args.runs < 2) throw new Error("--runs must be at least 2");
  if (args.pose !== "pinned" && args.pose !== "free") {
    throw new Error(`--pose must be "pinned" or "free" (got ${args.pose})`);
  }
  return args;
}

function launchOptions(mode) {
  const env = { ...process.env };
  if (mode.startsWith("x11:")) {
    // Real driver (surface-4d.verify.mjs's idiom): a headed window on a live
    // X display is the only route to Iris here, and WebGPU reaches it
    // through Vulkan. Deliberately NO SwiftShader/ANGLE flags.
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
  if (mode === "sw") {
    delete env.DISPLAY;
    return {
      env,
      args: [
        "--headless=new",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--no-sandbox",
      ],
    };
  }
  throw new Error(`unknown --mode ${mode} (expected x11:<display> or sw)`);
}

/** Query string this script always asks for, plus whatever the caller added.
 * `surfacestate` is what publishes the settle latch (see the module doc). */
function searchFor(extra) {
  return extra ? `?surfacestate&${extra}` : "?surfacestate";
}

async function bootScene(page, target) {
  await page.goto(target, { waitUntil: "load", timeout: 60_000 });
  // The point count crossing zero means the boot chaos game landed — the
  // same boot signal every other verify script in this directory uses.
  await page.waitForFunction(
    () => {
      const el = document.getElementById("pointCount");
      return !!el && Number((el.textContent || "").replace(/[^\d]/g, "")) > 0;
    },
    undefined,
    { timeout: 60_000, polling: 100 },
  );
}

/**
 * Load a scenario in the requested pose mode. `pinned` opens the minted,
 * pose-carrying hash — the measurement configuration. `free` reproduces the
 * ORIGINAL bead: the same system with NO stored pose, so boot auto-frames it
 * from a `Math.random()`-seeded cloud. It is the control that says how much
 * of a "renderer nondeterminism" number is really the camera. A preset-based
 * scenario loads through the menu there, exactly as --mint does.
 */
async function loadScenario(page, args, scenario, pose) {
  const base = args.url.replace(/\/+$/, "");
  const search = searchFor(args.query);
  if (pose === "pinned") {
    await bootScene(page, `${base}/${search}${scenario.hash}`);
    return;
  }
  await bootScene(page, `${base}/${search}${scenario.base.hash ?? ""}`);
  if (scenario.base.preset) {
    await page.evaluate((preset) => {
      const sel = document.getElementById("presetSelect");
      sel.value = preset;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, scenario.base.preset);
    // The preset load regenerates through the worker and fits the camera
    // when the cloud lands; 4s is far past that on any machine that can run
    // this script at all.
    await page.waitForTimeout(4_000);
  }
}

/** Enter Surface mode unless a preset render hint already did. Returns the
 * button state that was observed, so a refusal is reported rather than
 * silently waited out. */
async function enterSurface(page) {
  const state = await page.evaluate(() => {
    const b = document.getElementById("modeSurfaceBtn");
    return {
      disabled: b?.disabled ?? null,
      pressed: b?.getAttribute("aria-pressed"),
      title: b?.title ?? "",
    };
  });
  if (state.disabled) return state;
  if (state.pressed !== "true") {
    await page.evaluate(() => {
      document
        .getElementById("modeSurfaceBtn")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
  return state;
}

/**
 * Wait for the TRUE settled state: the app's own latch, held continuously
 * for `dwellMs`. See the module doc for why neither the canvas nor the
 * progress row can answer this question.
 */
async function waitForSettled(page, dwellMs, budgetMs) {
  const t0 = Date.now();
  const deadline = t0 + budgetMs;
  let heldSince = null;
  let last = null;
  for (;;) {
    const s = await page.evaluate(() => window.__surfaceState?.() ?? null);
    if (s === null) {
      throw new Error(
        "window.__surfaceState is absent — the page was not loaded with ?surfacestate",
      );
    }
    last = s;
    const settled =
      s.mode === "surface" &&
      s.firstFrame &&
      s.settled &&
      !s.previewActive &&
      !s.settleActive &&
      !s.settlePending;
    if (settled) {
      heldSince ??= Date.now();
      if (Date.now() - heldSince >= dwellMs) {
        return { ok: true, elapsedMs: Date.now() - t0, state: s };
      }
    } else {
      // Any invalidation restarts the dwell — the grid landing mid-settle is
      // the expected one (main.ts's onGrid invalidates), and this is exactly
      // the window a canvas-polling harness would freeze a mixed frame in.
      heldSince = null;
    }
    if (Date.now() > deadline) {
      return { ok: false, elapsedMs: Date.now() - t0, state: last };
    }
    await page.waitForTimeout(250);
  }
}

/** Canvas screenshot plus the overlay boxes to mask, in canvas-local CSS
 * pixels. Nothing in the page is mutated — hiding chrome could perturb the
 * app's own layout reads (setRightInset), and the mask costs nothing. */
async function captureCanvas(page, filePath) {
  const geometry = await page.evaluate((selectors) => {
    const canvas = document.querySelector("canvas");
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
    .locator("canvas")
    .first()
    .screenshot({ type: "png", ...(filePath ? { path: filePath } : {}) });
  return { buffer, geometry };
}

/**
 * Pixel diff between two canvas PNGs, computed INSIDE a page (no new npm
 * dependency — the surface-4d.verify.mjs precedent): decode both onto a
 * canvas, skip the masked overlay boxes, and count differing pixels. Also
 * returns a red-marked diff PNG when anything differs.
 */
async function diffPngs(page, a, b, overlays) {
  return page.evaluate(
    async ({ aB64, bB64, masks, structuralDelta }) => {
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
      const out = document.createElement("canvas");
      out.width = width;
      out.height = height;
      const octx = out.getContext("2d");
      const outImg = octx.createImageData(width, height);
      let compared = 0;
      let differing = 0;
      let structural = 0;
      let maxDelta = 0;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let i = 0, p = 0; p < width * height; p++, i += 4) {
        // Base image, dimmed, so the diff PNG reads as marks on the frame.
        outImg.data[i] = A.data[i] >> 1;
        outImg.data[i + 1] = A.data[i + 1] >> 1;
        outImg.data[i + 2] = A.data[i + 2] >> 1;
        outImg.data[i + 3] = 255;
        if (masked[p]) continue;
        compared++;
        const d = Math.max(
          Math.abs(A.data[i] - B.data[i]),
          Math.abs(A.data[i + 1] - B.data[i + 1]),
          Math.abs(A.data[i + 2] - B.data[i + 2]),
        );
        if (d === 0) continue;
        differing++;
        if (d > maxDelta) maxDelta = d;
        if (d > structuralDelta) structural++;
        const x = p % width;
        const y = (p - x) / width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        outImg.data[i] = 255;
        outImg.data[i + 1] = 0;
        outImg.data[i + 2] = 0;
      }
      octx.putImageData(outImg, 0, 0);
      return {
        width,
        height,
        compared,
        differing,
        structural,
        maxDelta,
        bbox: maxX < 0 ? null : { minX, minY, maxX, maxY },
        diffPng:
          differing > 0 ? out.toDataURL("image/png").split(",")[1] : null,
      };
    },
    {
      aB64: a.toString("base64"),
      bB64: b.toString("base64"),
      masks: overlays,
      structuralDelta: STRUCTURAL_DELTA,
    },
  );
}

/** One fresh-load render of a scenario: new context (clean storage — a
 * carried-over autosave or collection would change what boots), pinned
 * viewport, reduced motion, settle, screenshot. */
async function runOnce(browser, args, scenario, index, arm) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  const consoleLines = [];
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(args.settle + 60_000);
    page.on("console", (msg) => consoleLines.push(msg.text()));
    page.on("pageerror", (err) =>
      consoleLines.push(`[uncaught] ${err.message}`),
    );
    await loadScenario(page, args, scenario, args.pose);
    const btn = await enterSurface(page);
    if (btn.disabled) {
      return {
        ok: false,
        reason: `surface button disabled: ${btn.title}`,
        consoleLines,
      };
    }
    const settle = await waitForSettled(page, args.dwell, args.settle);
    const shotPath = path.join(
      args.outdir,
      `repro-${scenario.name}-${arm}-${args.pose}-run${index}.png`,
    );
    const { buffer, geometry } = await captureCanvas(page, shotPath);
    return {
      ok: settle.ok,
      reason: settle.ok ? null : "settle timeout",
      settleMs: settle.elapsedMs,
      state: settle.state,
      buffer,
      geometry,
      shotPath,
      consoleLines,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/** --mint: boot the scenario's BASE scene, let it auto-frame, and read back
 * the app's own encoding of the framed document (camera + 4D pose included)
 * by saving it to the collection. Prints the hash to paste into SCENARIOS. */
async function mint(browser, args, scenario) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    page.on("console", (msg) => console.error(`[page] ${msg.text()}`));
    await loadScenario(page, args, scenario, "free");
    await page.waitForTimeout(1_000);
    const encoded = await page.evaluate(() => {
      document
        .getElementById("saveCollectionBtn")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const raw = localStorage.getItem("fractal-viewer:collection");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const scenes = Array.isArray(parsed) ? parsed : parsed.scenes;
      return scenes?.at(-1)?.encoded ?? scenes?.[0]?.encoded ?? null;
    });
    if (!encoded) throw new Error("collection save produced no encoded scene");
    console.log(`\n[mint] ${scenario.name}:\n#${encoded}\n`);
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outdir, { recursive: true });
  const scenarios =
    args.scenario === "all"
      ? SCENARIOS
      : SCENARIOS.filter((s) => s.name === args.scenario);
  if (scenarios.length === 0) {
    throw new Error(
      `unknown --scenario ${args.scenario} (have: ${SCENARIOS.map((s) => s.name).join(", ")}, all)`,
    );
  }
  const arm = args.query.includes("surfacegl") ? "surfacegl" : "auto";
  const { env, args: launchArgs } = launchOptions(args.mode);
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: false,
    env,
    args: launchArgs,
  });
  const t0 = Date.now();
  const verdicts = [];
  try {
    if (args.mint) {
      for (const scenario of scenarios) await mint(browser, args, scenario);
      return;
    }
    // A page that outlives the per-run contexts, used only as a decoder for
    // the pixel diffs (about:blank, no app involved).
    const diffContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const diffPage = await diffContext.newPage();
    await diffPage.goto("about:blank");

    for (const scenario of scenarios) {
      console.error(
        `\n[repro] === ${scenario.name} / arm=${arm} / pose=${args.pose} — ${args.runs} fresh loads ===`,
      );
      const runs = [];
      for (let i = 0; i < args.runs; i++) {
        const run = await runOnce(browser, args, scenario, i, arm);
        console.error(
          `[repro] ${scenario.name}/${arm}/${args.pose} run ${i}: ` +
            (run.ok
              ? `settled in ${(run.settleMs / 1000).toFixed(1)}s ` +
                `(engine=${run.state.engine}) -> ${path.basename(run.shotPath)}`
              : `NOT SETTLED (${run.reason}, ${(run.settleMs ?? 0) / 1000}s, state=${JSON.stringify(run.state ?? null)})`),
        );
        // The compute path prints its own settle census; worth keeping in
        // the log when a diff needs explaining (exhausted rays are the one
        // documented route by which a frame can keep prefill pixels).
        for (const line of run.consoleLines) {
          if (line.startsWith("Surface compute settle")) {
            console.error(`[repro]   ${line}`);
          }
        }
        runs.push(run);
        if (!run.ok) break;
      }
      if (runs.some((r) => !r.ok)) {
        verdicts.push(
          `${scenario.name}/${arm}/${args.pose}: INCONCLUSIVE — ${runs.find((r) => !r.ok).reason}`,
        );
        continue;
      }
      const maskJson = JSON.stringify(runs[0].geometry.overlays);
      const maskStable = runs.every(
        (r) => JSON.stringify(r.geometry.overlays) === maskJson,
      );
      console.error(
        `[repro] canvas ${runs[0].geometry.width}x${runs[0].geometry.height}, ` +
          `${runs[0].geometry.overlays.length} overlay box(es) masked, stable=${maskStable}`,
      );
      let worst = null;
      for (let i = 0; i < runs.length; i++) {
        for (let j = i + 1; j < runs.length; j++) {
          const d = await diffPngs(
            diffPage,
            runs[i].buffer,
            runs[j].buffer,
            runs[0].geometry.overlays,
          );
          if (d.error) {
            console.error(`[repro] run${i} vs run${j}: ${d.error}`);
            worst = {
              differing: Infinity,
              pct: NaN,
              maxDelta: NaN,
              structural: NaN,
            };
            continue;
          }
          const pct = (d.differing / d.compared) * 100;
          console.error(
            `[repro] run${i} vs run${j}: ${d.differing}/${d.compared} px differ ` +
              `(${pct.toFixed(3)}%), >${STRUCTURAL_DELTA}/255: ${d.structural}, ` +
              `max channel delta ${d.maxDelta}` +
              (d.bbox
                ? `, bbox x[${d.bbox.minX}..${d.bbox.maxX}] y[${d.bbox.minY}..${d.bbox.maxY}]`
                : ""),
          );
          if (d.diffPng) {
            const p = path.join(
              args.outdir,
              `repro-${scenario.name}-${arm}-${args.pose}-diff-${i}v${j}.png`,
            );
            await writeFile(p, Buffer.from(d.diffPng, "base64"));
            console.error(`[repro]   diff image: ${p}`);
          }
          if (!worst || d.differing > worst.differing) {
            worst = {
              differing: d.differing,
              pct,
              maxDelta: d.maxDelta,
              structural: d.structural,
            };
          }
        }
      }
      const settleTimes = runs
        .map((r) => (r.settleMs / 1000).toFixed(1))
        .join("/");
      verdicts.push(
        worst.differing === 0
          ? `${scenario.name}/${arm}/${args.pose} (engine=${runs[0].state.engine}): DETERMINISTIC — ` +
              `0 differing pixels across all ${(runs.length * (runs.length - 1)) / 2} pair(s); settles ${settleTimes}s`
          : `${scenario.name}/${arm}/${args.pose} (engine=${runs[0].state.engine}): NONDETERMINISTIC — ` +
              `worst pair ${worst.pct.toFixed(3)}% of pixels differ ` +
              `(${worst.structural} by >${STRUCTURAL_DELTA}/255), max channel delta ${worst.maxDelta}; settles ${settleTimes}s`,
      );
    }
  } finally {
    console.error("\n[repro] ===== VERDICTS =====");
    for (const v of verdicts) console.error(`[repro] ${v}`);
    console.error(
      `[repro] wall time ${((Date.now() - t0) / 1000).toFixed(1)}s (mode=${args.mode}, runs=${args.runs}, pose=${args.pose}, dwell=${args.dwell}ms)`,
    );
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[repro] fatal:", err);
  process.exitCode = 1;
});
