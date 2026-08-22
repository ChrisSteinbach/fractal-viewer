#!/usr/bin/env node
/**
 * Surface PATTERN gate on the WGSL COMPUTE kernel (fr-cmtl.6): does an
 * AUTHORED per-transform `surfacePattern` visibly change the settled
 * Surface render on the WebGPU compute path — every core family — from a
 * real `#v1=` document driven through the real app?
 *
 * THE ROLE INVERSION from scripts/pattern.verify.mjs (.5's gate): there the
 * pattern ALBEDO existed only in the GLSL tracers, so every leg FORCED the
 * WebGL arm (`?surfacegl`) and asserted engine=webgl. Here the pattern math
 * exists ONLY in the WGSL shade kernel (surface-de-gpu.ts's `pattern` gate),
 * so this gate NEVER forces the arm and asserts engine=compute at capture
 * time — a WebGL leg would be a false negative by design, and the engine
 * assertion is what makes the green row honest. The same documents now
 * render patterned on BOTH engines; the durable cross-engine parity gate
 * is fr-cmtl.8's, not this script's.
 *
 * THE SCENES cover the pattern arm's frame reconstruction per core:
 *
 * - lens3 (3D, fold-FINAL lens): the pattern source is the lens wrapper's
 *   winning-branch core query — the multivalued fold case where no single
 *   matrix inverse exists.
 * - escape3 (3D, escape-time Mandelbox + floor): the forward-orbit route,
 *   whose pattern wire is the HEAD transform's one slot (firstChoice = 0);
 *   the floor stays unpatterned inside the same frame.
 * - ifs4plane (4D IFS + floor): the 4D route — hit w lifted before the
 *   inverse rotor, then the affine final inverse, normalized by the raw
 *   4D radius. Its pattern authors ALL FOUR transforms: the xw rotation on
 *   transform 0 puts map 0's copy outside the visible slice, so a
 *   single-slot pattern never fires there (attribution, not wire).
 * - escape4 (4D, escape-time, COMPUTE-ONLY): the forward 4D route — the
 *   strongest fixture in the set, since no WebGL tracer can render it at
 *   all. The Mandelbox Brick is dense in the frame, so its pattern effect
 *   measures well above the small-object scenes' floor.
 *
 * THREE LEGS PER ROUTE, same-stage captured: unauthored (pattern absent),
 * patterned (a strong family on transform 0 — all four on ifs4plane), and
 * a strength-0 control (family present on the wire, albedo mix at 0). The
 * verdict pair: patterned vs unauthored must differ STRUCTURALLY above the
 * floor (the pattern reached pixels — a uniform never uploaded, a stride
 * the host sized wrong, or a splice a recompose site dropped is invisible
 * to every unit test), and strength-0 vs unauthored must be an identity
 * within the anti-floor (mix(base, full, 0.0) == base exactly, so a family
 * that fades to zero changes nothing). The pattern-none control is
 * deliberately NOT a second unauthored render: it is a document with the
 * SAME shader program compiled (pattern gate on) and the same calibration
 * — the strongest possible byte-level check that strength 0 is an albedo
 * identity on the real driver.
 *
 * SAME-STAGE CAPTURE is the pattern.verify.mjs discipline, verbatim: both
 * engines present only COMPLETED supersampling passes after pass 0, the
 * progress row names the stage, `?surfacestate`'s latch names the settled
 * end, and each leg captures the canvas at every stage boundary it crosses
 * after a stability grace. The pair is diffed at the HIGHEST COMMON STAGE
 * and each later leg stops the moment it reaches the earlier leg's best
 * stage, so the run costs no more than it must. On SwiftShader the full
 * 8-pass settle does not complete inside a 5-minute budget, so the default
 * `--stage=1` compares the pre-supersampling full-quality frame — the
 * cheapest leg that still answers a colour question.
 *
 * THE REGION is the central 70% x 70% of the canvas with overlay boxes
 * masked (finish.verify.mjs's overlay list and centre fraction), for the
 * same measured reasons: a panel row growing beats a full-frame diff, and
 * a floor over the whole canvas is diluted by backdrop identical in both
 * legs by construction.
 *
 * THE ENGINE IS SAMPLED AT CAPTURE TIME, never at a leg's first poll: a
 * compute-preferring session honestly reports engine="webgl" for its
 * opening polls while `SurfaceComputeRenderer.create()` is in flight. The
 * verdict asserts the engine tag read in the SAME poll that confirmed the
 * capture parked.
 *
 * Usage (build + `npm run preview` first — this measures a real build):
 *   node scripts/pattern.compute.verify.mjs               # sw, all scenes
 *   node scripts/pattern.compute.verify.mjs --mode=x11::0 # real driver
 *   node scripts/pattern.compute.verify.mjs --scene=escape4 --stage=1
 *
 *   --url       app origin (default https://localhost:4173)
 *   --mode      sw (default) | x11:<display>
 *   --scene     lens3 (default) | escape3 | ifs4plane | escape4 | all
 *   --viewport  WxH (default 640x360)
 *   --settle    per-leg budget in ms for reaching the target stage
 *               (default 300000)
 *   --stage     target stage for the first leg: 8 waits for the settled
 *               latch; 1..7 stops at that many completed passes (default 1)
 *   --dwell     ms the settled latch must hold (default 2000)
 *   --floor     minimum structural-diff fraction for patterned-vs-none
 *               (default 0.02; ifs4plane asserts 0.005)
 *   --identity  maximum structural-diff fraction for strength-0-vs-none
 *               (default 0.005)
 *   --outdir    where PNGs land (default .playwright-mcp/, gitignored)
 *
 * Exit codes: 0 all routes passed; 1 a verdict failed; 2 a CHECKING-side
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

/** pattern.verify.mjs's lens3 scenario hash, verbatim (it embeds
 * finish.verify.mjs's LENS_BASE_HASH after its boot auto-frame): a 4-map
 * Sierpinski base under a boxfold final transform. */
const LENS3_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuMzUsMC4zNSwwLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfSx7InBvc2l0aW9uIjpbLTAuMzUsLTAuMzUsMC4zNV0sInJvdGF0aW9uIjpbMCwwLDBdLCJzY2FsZSI6WzAuNSwwLjUsMC41XX0seyJwb3NpdGlvbiI6WzAuMzUsLTAuMzUsLTAuMzVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlstMC4zNSwwLjM1LC0wLjM1XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxLCJmaW5hbFRyYW5zZm9ybSI6eyJwb3NpdGlvbiI6WzAuMTUsLTAuMSwwLjA1XSwicm90YXRpb24iOlswLjIsMC4zLDAuMV0sInNjYWxlIjpbMC45LDAuOSwwLjldLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoiYm94Zm9sZCIsIndlaWdodCI6MC41NX1dfSwiY2FtZXJhIjp7InRhcmdldCI6WzAuMDU2OSwtMC4wOTI1LC0wLjAzNDhdLCJyYWRpdXMiOjEuNDM5OCwidGhldGEiOjAuNzg1NCwicGhpIjoxLjA1Nn19";

/** pattern.verify.mjs's ifs4plane document, verbatim: a 4-map 4D IFS
 * (sierpinski-class, with xw/yw rotations on two transforms) and the
 * floor. */
const IFS4PLANE_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAuNSwwLjUsMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InBvc2l0aW9uIjowLjMsInJvdGF0aW9uIjp7Inh3IjowLjR9fX0seyJwb3NpdGlvbiI6Wy0wLjUsMC41LC0wLjVdLCJyb3RhdGlvbiI6WzAsMCwwXSwic2NhbGUiOlswLjUsMC41LDAuNV19LHsicG9zaXRpb24iOlswLjUsLTAuNSwtMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdLCJ3Ijp7InJvdGF0aW9uIjp7Inl3IjowLjI1fX19LHsicG9zaXRpb24iOlstMC41LC0wLjUsMC41XSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNX0sInN5bW1ldHJ5Ijp7Im9yZGVyIjoxLCJwbGFuZSI6Inh6In0sImdsb3dCcmlnaHRuZXNzIjoxLCJiYWxsb29uRWNobyI6ZmFsc2UsImJhbGxvb25SYWRpdXMiOjEuNiwiZm9nRGVuc2l0eSI6MSwiZm9nVGludCI6IiNmZmZmZmYiLCJmb2dUaW50U3RyZW5ndGgiOjAsImdyb3VuZFBsYW5lIjp0cnVlfQ";

/** pattern.verify.mjs's escape3plane document, verbatim: the classic 3D
 * Mandelbox (one -1.5-weight mandelbox link) with the floor. */
const ESCAPE3_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMSwxLDFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjoyfV19XSwibnVtUG9pbnRzIjoxMDAwMDAsInBvaW50U2l6ZSI6MSwiY29sb3JNb2RlIjoidHJhbnNmb3JtIiwiY29sb3JHYW1tYSI6MSwicmFtcFBhbGV0dGVJZCI6ImxlZ2FjeSIsImZvdXJEQ29sb3IiOiJ3Qmx1ZU9yYW5nZSIsImZvdXJERGVwdGhGYWRlIjpmYWxzZSwicmVuZGVyU3R5bGUiOiJkZXB0aEZhZGUiLCJzaG93R3VpZGVzIjp0cnVlLCJmbGFtZSI6eyJleHBvc3VyZSI6MSwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsImdhbW1hIjoyLjQsInZpYnJhbmN5IjoxLCJzdXBlcnNhbXBsZSI6MiwiZXN0aW1hdG9yUmFkaXVzIjo2LCJlc3RpbWF0b3JNaW5pbXVtUmFkaXVzIjowLCJlc3RpbWF0b3JDdXJ2ZSI6MC40LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzb2xpZCI6eyJyZXNvbHV0aW9uIjoxOTIsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJ0aHJlc2hvbGQiOjAuMywibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic3VyZmFjZSI6eyJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJjb2xvclNvdXJjZSI6InRyYW5zZm9ybSIsInBhbGV0dGVJZCI6InNwZWN0cnVtIiwiY29sb3JTcGVlZCI6MC41fSwic3ltbWV0cnkiOnsib3JkZXIiOjEsInBsYW5lIjoieHoifSwiZ2xvd0JyaWdodG5lc3MiOjEsImJhbGxvb25FY2hvIjpmYWxzZSwiYmFsbG9vblJhZGl1cyI6MS42LCJmb2dEZW5zaXR5IjoxLCJmb2dUaW50IjoiI2ZmZmZmZiIsImZvZ1RpbnRTdHJlbmd0aCI6MCwiZ3JvdW5kUGxhbmUiOnRydWV9";

/** finish.verify.mjs's escape4 scenario hash, verbatim: the shipped
 * Mandelbox Brick — one -1.5-weight mandelbox link with a FULL xw
 * rotation, which routes it through `core: "escape4"` (the compute-only
 * forward 4D core). Dense in the frame, so a pattern on its head slot is
 * highly visible. */
const ESCAPE4_HASH =
  "#v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMSwxLDFdLCJ2YXJpYXRpb25zIjpbeyJ0eXBlIjoibWFuZGVsYm94Iiwid2VpZ2h0IjotMS41fV0sInciOnsicm90YXRpb24iOnsieHciOjF9fX1dLCJudW1Qb2ludHMiOjEwMDAwMCwicG9pbnRTaXplIjoxLCJjb2xvck1vZGUiOiJ0cmFuc2Zvcm0iLCJjb2xvckdhbW1hIjoxLCJyYW1wUGFsZXR0ZUlkIjoibGVnYWN5IiwiZm91ckRDb2xvciI6IndCbHVlT3JhbmdlIiwiZm91ckREZXB0aEZhZGUiOmZhbHNlLCJyZW5kZXJTdHlsZSI6ImRlcHRoRmFkZSIsInNob3dHdWlkZXMiOnRydWUsImZsYW1lIjp7ImV4cG9zdXJlIjoxLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwiZ2FtbWEiOjIuNCwidmlicmFuY3kiOjEsInN1cGVyc2FtcGxlIjoyLCJlc3RpbWF0b3JSYWRpdXMiOjYsImVzdGltYXRvck1pbmltdW1SYWRpdXMiOjAsImVzdGltYXRvckN1cnZlIjowLjQsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInNvbGlkIjp7InJlc29sdXRpb24iOjE5MiwiaXRlcmF0aW9ucyI6MjAwMDAwMDAsInRocmVzaG9sZCI6MC4zLCJsaWdodEF6aW11dGgiOjEzNSwibGlnaHRFbGV2YXRpb24iOjUwLCJhbWJpZW50IjowLjI1LCJwYWxldHRlSWQiOiJzcGVjdHJ1bSJ9LCJzdXJmYWNlIjp7ImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsImNvbG9yU291cmNlIjoidHJhbnNmb3JtIiwicGFsZXR0ZUlkIjoic3BlY3RydW0iLCJjb2xvclNwZWVkIjowLjV9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiYmFsbG9vbkVjaG8iOmZhbHNlLCJiYWxsb29uUmFkaXVzIjoxLjYsImZvZ0RlbnNpdHkiOjEsImZvZ1RpbnQiOiIjZmZmZmZmIiwiZm9nVGludFN0cmVuZ3RoIjowLCJncm91bmRQbGFuZSI6ZmFsc2V9";

/** The authored patterns, by transform index. Each is a strong family; the
 * strength-0 control reuses the same families with strength 0. The 4D IFS
 * scene patterns ALL transforms: its transform 0 carries an xw rotation
 * that puts map 0's copy outside the visible slice, so a single-slot
 * pattern never fires there (the attribution is scene geometry, not the
 * wire). */
const AUTHORED_PATTERNS = {
  lens3: { 0: { kind: "wood", axis: "y", scale: 3, strength: 1 } },
  escape3: { 0: { kind: "strata", axis: "y", scale: 2.6, strength: 1 } },
  escape4: { 0: { kind: "strata", axis: "y", scale: 2.6, strength: 1 } },
  ifs4plane: {
    0: { kind: "marble", axis: "y", scale: 1.35, strength: 1 },
    1: { kind: "marble", axis: "z", scale: 1.35, strength: 1 },
    2: { kind: "marble", axis: "x", scale: 1.35, strength: 1 },
    3: { kind: "marble", axis: "y", scale: 1.35, strength: 1 },
  },
};

const SCENES = [
  {
    name: "lens3",
    baseHash: LENS3_HASH,
    what: "3D fold-FINAL lens — the winning-branch source-hit route",
    patterns: AUTHORED_PATTERNS.lens3,
    floor: 0.02,
  },
  {
    name: "ifs4plane",
    baseHash: IFS4PLANE_HASH,
    what: "4D IFS + floor — rotor lift before the final inverse, floor unpatterned",
    patterns: AUTHORED_PATTERNS.ifs4plane,
    // The auto-framed 4D object is a small part of the frame (its pattern
    // effect measures ~1.1% on both engines): a 3D-scale floor would
    // demand an effect the object cannot fill.
    floor: 0.005,
  },
  {
    name: "escape3",
    baseHash: ESCAPE3_HASH,
    what: "3D escape-time Mandelbox + floor — the forward-orbit head-slot wire",
    patterns: AUTHORED_PATTERNS.escape3,
    floor: 0.02,
  },
  {
    name: "escape4",
    baseHash: ESCAPE4_HASH,
    what: "4D escape-time Mandelbox Brick (COMPUTE-ONLY) — the dense forward-4D route",
    patterns: AUTHORED_PATTERNS.escape4,
    floor: 0.01,
  },
];

/** Overlay elements that can paint on top of the canvas (finish.verify's
 * list). Their boxes are masked out of both regions, as the UNION over the
 * compared legs, so a notice that appears in one leg only can neither add
 * to nor hide a diff. */
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

/** Channel delta above which a differing pixel counts as STRUCTURAL
 * (surface-repro's constant). */
const STRUCTURAL_DELTA = 8;
/** The asserted region: the middle CENTER_FRACTION of the canvas on each
 * axis. */
const CENTER_FRACTION = 0.7;
/** The app's supersampling pass count; stage SETTLE_SAMPLES is the settled
 * latch. */
const SETTLE_SAMPLES = 8;
const STAGE_GRACE_MS = 2_500;
const POLL_MS = 250;

function parseArgs(argv) {
  const args = {
    url: "https://localhost:4173",
    mode: "sw",
    scene: "lens3",
    viewport: "640x360",
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
  if (
    !["lens3", "escape3", "ifs4plane", "escape4", "all"].includes(args.scene)
  ) {
    throw new Error(
      `--scene must be lens3, escape3, ifs4plane, escape4 or all`,
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
// Documents: decode the embedded hash, author the patterns, re-encode — the
// same base64url wire persist.ts uses.
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

/** A scene's legs: none, patterned, and the strength-0 control. `none` is
 * the scene's base document AFTER its derive step (a derived scene's
 * baseline must be the derived document — comparing a derived pattern
 * against the pre-derive base would diff the whole object, not the
 * pattern). Throws if the base does not round-trip byte for byte through
 * this script's own codec — the one way the legs could silently diverge. */
function buildLegs(scene) {
  const baseDoc = decodeHash(scene.baseHash);
  if (encodeHash(baseDoc) !== scene.baseHash) {
    throw new Error(
      `the embedded ${scene.name} hash does not round-trip through this script's codec; refusing to derive legs from it`,
    );
  }
  const noneDoc = scene.derive
    ? scene.derive(decodeHash(scene.baseHash))
    : baseDoc;
  const noneHash = encodeHash(noneDoc);
  const patterned = decodeHash(noneHash);
  for (const [index, pattern] of Object.entries(scene.patterns)) {
    const t = patterned.transforms[Number(index)];
    if (!t) {
      throw new Error(`${scene.name} base document has no transform ${index}`);
    }
    t.surfacePattern = { ...pattern };
  }
  const strength0 = decodeHash(noneHash);
  for (const [index, pattern] of Object.entries(scene.patterns)) {
    const t = strength0.transforms[Number(index)];
    t.surfacePattern = { ...pattern, strength: 0 };
  }
  return [
    { name: "unauthored", hash: noneHash },
    { name: "patterned", hash: encodeHash(patterned) },
    { name: "strength0", hash: encodeHash(strength0) },
  ];
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

/** One poll of the settle machinery (finish.verify.mjs's vocabulary). */
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

/** A capture of a PARKED canvas, diag-style: the strip settle presents each
 * completed pass on its SURFACE_SETTLE_PRESENT_MS (600ms) cadence, so after
 * the stage row appears a fixed grace lets the present land and the canvas
 * holds the completed mean. The byte-stability retry proved racy here — the
 * strip's presents are async and the settle re-arms mid-settle, so a
 * byte-stable pair could catch a STALE present, and legs of the same scene
 * then disagreed run to run. The fixed grace lands on the deterministic
 * completed mean instead. */
async function captureStable(page) {
  await page.waitForTimeout(STAGE_GRACE_MS);
  return { ...(await captureCanvas(page)), stable: true };
}

/** One leg: fresh context, boot the document, enter Surface, capture the
 * canvas at every stage boundary up to `stopAt` or the budget. */
async function runLeg(browser, args, leg, stopAt, budgetMs, log) {
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
  };
  const t0 = Date.now();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(budgetMs + 60_000);
    page.on("console", (msg) => consoleLines.push(msg.text()));
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.bringToFront();
    const base = args.url.replace(/\/+$/, "");
    // NO ?surfacegl: fr-cmtl.6's pattern math lives in the WGSL shade
    // kernel, so the default compute-preferring routing is the arm under
    // test — a WebGL leg would render unpatterned by design, and the
    // engine assertion below is what makes the green row honest.
    await bootScene(page, `${base}/?surfacestate${leg.hash}`);
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
            `    captured stage ${stage}/${SETTLE_SAMPLES} at ${((Date.now() - t0) / 1000).toFixed(1)}s${shot.stable ? "" : " (UNSTABLE canvas)"}`,
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
// Diff (pattern.verify.mjs's, verbatim).
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

function interestingConsole(lines) {
  return lines.filter(
    (l) =>
      /^Surface render: /.test(l) ||
      /^WebGL renderer is a software rasterizer/.test(l) ||
      /^Surface compute settle/.test(l) ||
      /^Surface compute: tracing/.test(l) ||
      /Surface compute device lost/.test(l) ||
      /WGSL compile failed/.test(l) ||
      /Surface compute: .* failed/.test(l),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outdir, { recursive: true });
  const scenes = SCENES.filter(
    (s) => args.scene === "all" || s.name === args.scene,
  );
  const legsByScene = new Map(scenes.map((scene) => [scene, buildLegs(scene)]));
  const log = (line) => console.error(`[pattern-compute] ${line}`);
  const region = centralRegion(args.width, args.height);

  log(
    `scenes=${args.scene}, ${args.width}x${args.height}, mode=${args.mode}, ` +
      `target stage ${stageName(args.stage)}, budget ${args.settle / 1000}s/leg, ` +
      `pattern floor ${(args.floor * 100).toFixed(2)}% structural (>${STRUCTURAL_DELTA}/255) ` +
      `over the central ${CENTER_FRACTION * 100}% region, ` +
      `strength-0 identity ceiling ${(args.identity * 100).toFixed(3)}%`,
  );
  for (const scene of scenes) {
    const legs = legsByScene.get(scene);
    log(
      `${scene.name}: ${scene.what}; legs: ${legs.map((l) => l.name).join(", ")}`,
    );
  }

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

    for (const scene of scenes) {
      const legs = legsByScene.get(scene);
      log(`=== ${scene.name} ===`);
      const results = [];
      let stopAt = args.stage;
      let budget = args.settle;
      for (const leg of legs) {
        log(
          `  leg ${leg.name}: stop at ${stageName(stopAt)}, budget ${(budget / 1000).toFixed(0)}s`,
        );
        let r;
        try {
          r = await runLeg(browser, args, leg, stopAt, budget, log);
        } catch (err) {
          log(
            `  CHECKING FAILURE on ${scene.name}/${leg.name}: ${err.message}`,
          );
          inconclusive++;
          verdicts.push(
            `${scene.name}: INCONCLUSIVE — ${leg.name} leg threw before a capture (${err.message})`,
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
            `${scene.name}-${leg.name}-s${stage}.png`,
          );
          await writeFile(file, cap.buffer);
        }
        results.push(r);
        const best = Math.max(0, ...r.captures.keys());
        if (best === 0) break;
        stopAt = best;
        budget = Math.max(args.settle, 2 * r.captures.get(best).elapsedMs);
      }
      if (results.length < 3) {
        const r = results[0];
        inconclusive++;
        verdicts.push(
          `${scene.name}: INCONCLUSIVE — a leg reached no stage inside ${(args.settle / 1000).toFixed(0)}s (${r?.stopReason ?? "no result"}); raise --settle or shrink --viewport`,
        );
        continue;
      }
      const [un, patterned, strength0] = results;
      const common = [...un.captures.keys()]
        .filter((s) => patterned.captures.has(s) && strength0.captures.has(s))
        .sort((a, b) => b - a)[0];
      if (common === undefined) {
        inconclusive++;
        verdicts.push(
          `${scene.name}: INCONCLUSIVE — no common stage (unauthored [${[...un.captures.keys()].join(",")}], patterned [${[...patterned.captures.keys()].join(",")}], strength0 [${[...strength0.captures.keys()].join(",")}]); raise --settle`,
        );
        continue;
      }
      const capUn = un.captures.get(common);
      const capPa = patterned.captures.get(common);
      const capS0 = strength0.captures.get(common);

      const problems = [];
      for (const r of results) {
        if (r.pageErrors.length) {
          problems.push(
            `${r.leg} leg: ${r.pageErrors.length} page error(s): ${r.pageErrors[0]}`,
          );
        }
      }
      // THE ENGINE ASSERTION READS THE COMPARED CAPTURES, not a leg-wide
      // summary — every leg must have run the COMPUTE tracer, because .6's
      // pattern math lives in the WGSL shade kernel and a WebGL leg would
      // render unpatterned by design.
      for (const [r, cap] of [
        [un, capUn],
        [patterned, capPa],
        [strength0, capS0],
      ]) {
        if (cap.engine !== "compute") {
          problems.push(
            `${r.leg} leg ran engine=${cap.engine ?? "none"} at the compared stage (${stageName(common)}), expected compute`,
          );
        }
      }
      if (!capUn.stable || !capPa.stable || !capS0.stable) {
        problems.push(
          `a stage-${common} capture never parked (unauthored stable=${capUn.stable}, patterned stable=${capPa.stable}, strength0 stable=${capS0.stable})`,
        );
      }

      const masks = [
        ...capUn.geometry.overlays,
        ...capPa.geometry.overlays,
        ...capS0.geometry.overlays,
      ];
      const dPattern = await diffPngs(
        diffPage,
        capUn.buffer,
        capPa.buffer,
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
      if (dPattern.error || dIdentity.error) {
        inconclusive++;
        verdicts.push(
          `${scene.name}: INCONCLUSIVE — diff failed: ${dPattern.error || dIdentity.error}`,
        );
        continue;
      }
      const paFrac =
        dPattern.center.compared > 0
          ? dPattern.center.structural / dPattern.center.compared
          : 0;
      const s0Frac =
        dIdentity.center.compared > 0
          ? dIdentity.center.structural / dIdentity.center.compared
          : 0;
      const diffFile = path.join(
        args.outdir,
        `${scene.name}-pattern-diff-s${common}.png`,
      );
      await writeFile(diffFile, Buffer.from(dPattern.diffPng, "base64"));
      const identityFile = path.join(
        args.outdir,
        `${scene.name}-identity-diff-s${common}.png`,
      );
      await writeFile(identityFile, Buffer.from(dIdentity.diffPng, "base64"));
      log(
        `  ${scene.name} @ ${stageName(common)}: patterned-vs-none central region ` +
          `${dPattern.center.structural}/${dPattern.center.compared} structural (${(paFrac * 100).toFixed(3)}%, max delta ${dPattern.center.maxDelta}); ` +
          `strength0-vs-none central region ${dIdentity.center.structural}/${dIdentity.center.compared} structural (${(s0Frac * 100).toFixed(3)}%, max delta ${dIdentity.center.maxDelta}); ` +
          `${masks.length} overlay box(es) masked -> ${path.basename(diffFile)}, ${path.basename(identityFile)}`,
      );
      if (paFrac < scene.floor) {
        problems.push(
          `patterned-vs-none central structural diff ${(paFrac * 100).toFixed(3)}% < floor ${(scene.floor * 100).toFixed(2)}%`,
        );
      }
      if (s0Frac > args.identity) {
        problems.push(
          `strength-0-vs-none central structural diff ${(s0Frac * 100).toFixed(3)}% > identity ceiling ${(args.identity * 100).toFixed(3)}%`,
        );
      }
      if (problems.length) {
        failures++;
        verdicts.push(`${scene.name}: FAIL — ${problems.join("; ")}`);
      } else {
        verdicts.push(
          `${scene.name}: PASS @ ${stageName(common)} (patterned ${(paFrac * 100).toFixed(2)}% structural, strength-0 ${(s0Frac * 100).toFixed(3)}%)`,
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
  console.error(`[pattern-compute] FATAL: ${err.stack ?? err}`);
  process.exit(2);
});
