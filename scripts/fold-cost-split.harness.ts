/**
 * fr-ck0w EXPERIMENT 2 measurement harness: march-steps vs DE-cost split for
 * pure-fold surface-DE systems (`docs/fold-de-performance-brief.md` §2 item
 * 2, "Instrument before optimising").
 *
 * THE QUESTION. Rendering cost for a fold system factors as
 *
 *     cost/pixel = (march steps per ray)  x  (inverse applications per
 *                   estimateDistance call)
 *
 * — factor B (bound looseness, more march steps) times factor A (branch
 * count per descent step, more work per call). The brief's §3 lists two
 * disjoint attack plans: §3.1/§3.5/§3.6 shrink factor A (branch-and-bound
 * the fold's 27/81 branches, per-cell live-branch masks, a precomputed
 * descent tree); §3.2/§3.3 shrink factor B (a tighter bounding ball, a
 * cone-radius-coupled depth cap). This harness measures BOTH factors on the
 * same rays so the brief's recommended order (§4) can be justified by
 * numbers instead of a guess.
 *
 * METHODOLOGY. For each pure-fold profile:
 *
 *  - Build the production `SurfaceDE` (`buildSurfaceDE`, no grid).
 *  - Cast a ray grid from one representative orbit pose (perspective camera,
 *    eye/target/up basis, fov 60 — the same convention
 *    `erosion-repro.harness.ts`'s `poseRays`/`cameraRays` use, matching
 *    `orbit.ts`'s `sphericalToCartesian`). The functions below are a COPY,
 *    not an import: `*.harness.ts` files register their own top-level
 *    `describe`/`it` blocks, so importing one from another would pull its
 *    suite into this run too (exactly why `harness-profiles.ts` exists as a
 *    deliberately unsuffixed shared module — see its own module doc).
 *  - March every ray with a CPU emulator of `surface-material.ts`'s main()
 *    loop (sphere gate, cone-eps hit test, step budget, `t += d *
 *    stepScale`) at the shipped FULL tier's budget (`SURFACE_FULL_MARCH_STEPS
 *    = 160`, confirmed at `src/app/surface-material.ts:2118`) and hit floor
 *    (`SURFACE_FULL_HIT_FLOOR = 1.0e-5`, same file:2128), GRIDLESS
 *    (`grid = null` throughout — no empty-space skip): the brief's ask is
 *    the DE's own cost, and a grid would substitute cheap texture reads for
 *    some march steps and muddy exactly the split under measurement. This
 *    is a superset of what `erosion-repro.harness.ts`'s `march()` does
 *    structurally (same sphere gate / cone eps / budget shape — confirmed
 *    against `surface-material.ts`'s main() line for line above), so no new
 *    march discipline is invented here, only reused.
 *  - Count inverse-map APPLICATIONS the same way `surface-beam.harness.ts`
 *    (fr-v6yg) and `surface-grid-cost.harness.ts` (fr-aj4w) do: import
 *    `countingDE` from `harness-profiles.ts` (extracted there verbatim so
 *    every cost-measuring harness shares one counter, not a second copy
 *    that could drift) and reset-then-diff its `counter.n` around each
 *    `estimateDistance` call. As those harnesses document, this counts map
 *    VISITS — one `invM` read per (chain, sector, map) triple — NOT branch
 *    children; a single visit still fans out to up to 81 branch
 *    evaluations internally (`descendFold`'s inner loop), so "apps" here is
 *    a unit of *inverse-affine work*, comparable 1:1 with the affine ladder's
 *    own apps count, but an UNDER-count of raw branch arithmetic by the
 *    branch factor (27/3/81). The per-system narrative below restores that
 *    factor explicitly so the reported numbers still answer the brief's
 *    original "~10^5 branch evaluations per march step" framing.
 *
 * TRANSFORMS APPLIED (fr-ck0w EXPERIMENT 2 follow-up, for fr-kidj). The
 * visit counter above is too COARSE for the upcoming branch-and-bound work:
 * `descendFold` hoists `const im = map.invM` once per visit and then
 * indexes `im[0]..im[8]` once per BRANCH TRANSFORM inside that visit (up to
 * 81 times for mandelbox) — fr-kidj's planned prune moves the floor-vs-best
 * test AHEAD of that indexing, skipping transforms WITHIN a visit, which a
 * per-visit counter cannot see move at all. `countingDEFine` (added to
 * `harness-profiles.ts` alongside, not instead of, `countingDE` — every
 * existing caller's numbers are unaffected, reverified below) wraps each
 * map's `invM` ARRAY itself in a `get`-trapped Proxy, so every numeric-index
 * element read bumps a second, finer counter. Every full inverse-affine
 * application reads all nine `im[i]` elements exactly once (confirmed
 * against `descend`'s and `descendFold`'s own bodies, not assumed), so
 * `fineCounter.n / 9` is "transforms applied" — directly comparable across
 * the affine and fold paths, and a strict refinement of "apps": today (pre-
 * fr-kidj, every branch's transform still runs unconditionally — the prune
 * only decides whether the RESULT is kept for the next frontier level, not
 * whether the transform itself executes), transforms/call should closely
 * track apps/call times each system's mean branch fan-out, i.e. this
 * harness's own EXPERIMENT 2 "branch evaluations" reconstruction — the
 * per-system narrative below cross-checks the two directly, which is also a
 * correctness check on the new counter itself. After fr-kidj ships,
 * transforms/call is exactly the number expected to drop sharply while
 * apps/call (visit count) stays roughly flat — the numbers this file
 * records now are that BEFORE baseline.
 *
 * WHICH ESTIMATOR. `estimateDistance` (refine = FALSE), not
 * `estimateDistanceRefined`. Two independent citations pin this down: (1)
 * `surface-de.ts`'s `descendFold` doc, "MIRROR NOTE: the GLSL fold tracer
 * marches this body's refine=FALSE path. Refinement is measurably a no-op
 * on fold systems ... The refined path stays the CPU production estimator
 * for the grid worker and the tests."; (2) `surface-material.ts`'s own
 * march-loop comment above the `SURFACE_FOLDS` main() body, "The march runs
 * the plain DE overload". `fold-phantom.harness.ts`'s `acceptMarch` (the
 * existing fold-specific march emulator) independently confirms this by
 * calling `estimateDistance`, never `estimateDistanceRefined`, and labels
 * it "plain = what the GLSL fold tracer marches" in its own module doc.
 * This is the OPPOSITE of the affine ladder, whose GLSL mirrors
 * `estimateDistanceRefined` — a caveat worth keeping in mind if these
 * numbers are ever compared against an affine cost-split run.
 *
 * PIXEL EPSILON. `uAcceptPixelEps` at a full-resolution 800px-tall frame,
 * fov 60 — `fold-phantom.harness.ts`'s `ACCEPT_FULL_EPS` convention
 * (itself mirroring `scene.ts`'s `setSurfaceFrameUniforms`:
 * `angularPerPixel = 2 tan(fov*pi/360)`, `uAcceptPixelEps = angularPerPixel
 * / acceptHeight`). In the FULL tier `uPixelEps === uAcceptPixelEps` (the
 * settle frame's buffer height IS the accept height), so one constant
 * serves both roles the GLSL loop reads.
 *
 * GRID SIZE. The brief allows shrinking from 48x48 "if runtime threatens
 * the 900s timeout". Rather than guess, each system runs a tiny (6x6) gridless
 * pilot at the SAME pose/budget to measure real ms/ray, then picks the
 * largest square grid up to 48x48 that projects under a fixed per-system
 * budget (mirrors `surface-grid-cost.harness.ts`'s projected-cost sizing,
 * one order simpler: linear in ray count here, not cubic in resolution).
 * JIT warm-up biases the pilot rate SLOWER than the steady-state main run,
 * so this sizing is conservative by construction (undersizes rather than
 * risks the timeout).
 *
 * MEASURED VERDICT (dev machine, pre-optimization baseline, commit d53d389;
 * 2304-ray 48x48 grids throughout, ~51.7% of which intersect the visible
 * bounding sphere under this pose — see the entered% diagnostic table for
 * why the headline "all-rays" steps/ray figures below read low: roughly
 * half of every grid is background by construction of the fixed pose/fov,
 * which is included deliberately, matching a real frame's per-pixel cost).
 * Full per-system numbers are the console table (re-run to reproduce; not
 * duplicated field-by-field here to avoid drift), but the shape is: apps/call
 * spans ~5.8 (boxfold -w + affine) to ~275 (mandelboxKifs) — a ~47x range —
 * while entered-conditioned steps/ray spans only ~3.8 to ~17.0, a ~4.5x
 * range. Factor A (apps/call, driven by per-visit branch fan-out: 3
 * spherefold / 27 boxfold / 81 mandelbox branches per map) is therefore the
 * dominant source of cross-system cost variation, not factor B — confirming
 * the brief's §4 recommended order (§3.1's branch-and-bound before §3.2/
 * §3.3's bound-tightening) by measurement. Expanding measured apps/call by
 * each system's mean branch fan-out reconnects with the brief's §1
 * back-of-envelope "~10^5 branch evaluations per march step": mandelboxKifs
 * (12 maps, 8 mandelbox + 4 boxfold, fan-out 63x) measures ~17.3k branch
 * evaluations per DE call, ~98.7k per ray — same order of magnitude as the
 * brief's estimate, undershooting it roughly 6x, most plausibly because (a)
 * this harness marches with a live cutoff (fr-55r5's early-out active,
 * unlike a raw uncut descent) and (b) `descendFold`'s floor-vs-best pruning
 * already collapses naive 27/81 enumeration toward its documented 10-33
 * live-chain peak before a visit is ever counted — both of which are
 * exactly the mechanisms §3.1 would strengthen further, so the measured
 * shortfall is evidence FOR that item, not against it. Caveat: this
 * harness's `estimateDistance` (refine=false, cutoff=eps) apps/call numbers
 * are NOT directly comparable to `surface-de.ts`'s own module-doc figures
 * for the same systems (which use `estimateDistanceRefined` at cutoff=0,
 * i.e. an uncut full descent) — the two measure genuinely different
 * regimes; treat any cross-reference as order-of-magnitude only.
 *
 * MEASURED VERDICT — TRANSFORMS APPLIED FOLLOW-UP (same dev machine/commit;
 * `countingDEFine`, `harness-profiles.ts`). CORRECTNESS: every system's
 * directly-measured transforms/call landed at EXACTLY 1.000x the apps x
 * mean-branch-fan-out reconstruction above (mandelboxKifs 17,408.4 vs
 * 17,407 reconstructed; boxfold pair 184.2 vs 184; boxfold-w+affine 80.7 vs
 * 81; spherefold pair 233.5 vs 234; mandelbox pair 6,739.7 vs 6,740) — the
 * expected result pre-fr-kidj (every branch's transform still runs
 * unconditionally today; the floor-vs-best prune only decides whether the
 * RESULT is kept, never whether the transform executes), and strong
 * evidence the element-counting Proxy counts the right thing. BASELINE
 * (fr-kidj's "before" numbers): boxfold pair 184.2 transforms/call / 613.7
 * /ray; boxfold-w+affine 80.7 /call / 157.0 /ray; spherefold pair 233.5
 * /call / 1,915.5 /ray; mandelbox pair 6,739.7 /call / 75,385.1 /ray (N=162
 * rays, hit its own hard cap — see below); mandelboxKifs 17,408.4 /call /
 * 99,493.9 /ray (N=144 rays). PERFORMANCE (the actual finding this follow-up
 * exists to surface): the counting Proxy itself is expensive enough to
 * change the experiment. Direct microbenchmark on mandelboxKifs at a
 * representative near-object point (cutoff 1e-4): plain `estimateDistance`
 * 0.61ms/call vs Proxy-wrapped 52.5ms/call — ~86x slower, ~252k element
 * reads for that one (near-worst-case) call. That overhead broke the
 * ORIGINAL sizing logic's soft `MIN_SIDE` floor (16, i.e. `Math.max`ed a
 * forced 256-ray minimum OVER the budget projection whenever a system was
 * expensive enough that the budget alone would have picked fewer) — the
 * first attempt at this run hung past 3 minutes of pegged CPU on
 * mandelboxKifs before being killed. Fixed by two changes, both required:
 * `MIN_SIDE` dropped to a true bare floor (4, not 16), and BOTH the pilot
 * and main ray loops now check a hard wall-clock cap after EVERY ray and
 * break on whatever completed (see the constants block's HARD WALL-CLOCK
 * CAPS note) — `SystemResult.rays` is always the ACTUAL count marched, not
 * the originally intended grid size. Consequence for THIS run: the three
 * cheap systems (boxfold pair, boxfold-w+affine, spherefold pair) still ran
 * their full 2304-ray 48x48 grid in seconds; mandelboxKifs's pilot alone
 * measured 207ms/ray, so the budget (30s/system) sized it down to a 12x12
 * grid (144 rays, completed without hitting the hard cap); mandelbox pair's
 * pilot measured 99ms/ray, sized to 17x17 (289 rays), but the main loop DID
 * hit `MAIN_HARD_CAP_MS` (45s) and stopped at 162/289 — its numbers above
 * are over that smaller completed subset, not the full intended grid. Both
 * undersized systems still produced a stable, EXACT 1.000x cross-check, so
 * the smaller N did not compromise correctness, only percentile precision.
 *
 * Usage:
 *   npx vitest run --config scripts/vitest.harness.config.ts scripts/fold-cost-split.harness.ts
 */
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  deHasFolds,
  estimateDistance,
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_MANDELBOX,
  SURFACE_FOLD_NONE,
  SURFACE_FOLD_SPHEREFOLD,
} from "../src/fractal/surface-de";
import type { SurfaceDE } from "../src/fractal/surface-de";
import { mandelboxKifs } from "../src/fractal/presets";
import type { Transform, Vec3 } from "../src/fractal/types";
import {
  countingDEFine,
  foldBoxfoldNegPlusAffine,
  foldBoxfoldPair,
  foldMandelboxPair,
  foldSpherefoldPair,
} from "./harness-profiles";

// ---------------------------------------------------------------------
// Shipped production constants, mirrored by hand (comment-cited, not
// imported): `surface-material.ts` pulls in a `three` module-scope
// construction (ShaderMaterial GLSL strings, `THREE.Vector3` backdrop
// colors) this lightweight CPU harness has no reason to load. The same
// hand-mirroring convention is already used by `erosion-repro.harness.ts`
// (`FULL_MARCH_STEPS`) and `fold-phantom.harness.ts` (`ACCEPT_FULL_HIT_FLOOR`).
// ---------------------------------------------------------------------

/** `SURFACE_FULL_MARCH_STEPS`, `src/app/surface-material.ts:2118`. */
const SURFACE_FULL_MARCH_STEPS = 160;
/** `SURFACE_FULL_HIT_FLOOR`, `src/app/surface-material.ts:2128`. */
const SURFACE_FULL_HIT_FLOOR = 1.0e-5;

/** Full-resolution frame height the shipped app derives `uAcceptPixelEps`
 * from at the settle frame — `fold-phantom.harness.ts`'s `ACCEPT_NATIVE_H`. */
const FULL_FRAME_HEIGHT = 800;
/** `PerspectiveCamera(60, ...)`, `src/app/scene.ts:683` — the app's fixed
 * vertical fov in degrees. */
const FULL_FOV_DEG = 60;
/** `uAcceptPixelEps` at the full-resolution settle frame — equal to
 * `uPixelEps` in the FULL tier, since `height === acceptHeight` there
 * (`scene.ts`'s `setSurfaceFrameUniforms`). */
const FULL_PIXEL_EPS =
  (2 * Math.tan((FULL_FOV_DEG * Math.PI) / 360)) / FULL_FRAME_HEIGHT;

// ---------------------------------------------------------------------
// Camera pose + ray grid — copied from erosion-repro.harness.ts's
// poseRays/normalize/cross (see the module doc for why this is a copy, not
// an import). One fixed representative pose, scaled per system by that
// system's own visibleBoundingRadius, used for every profile so the numbers
// are comparable apples-to-apples in relative framing.
// ---------------------------------------------------------------------

const POSE_TARGET: Vec3 = [0, 0, 0];
/** Off-axis orbit angles, deliberately not aligned to any coordinate plane
 * or the T_d symmetry the mandelboxKifs preset carries — an axis-aligned
 * pose risks degenerate ray/branch alignment that would not be
 * representative. */
const POSE_THETA = 0.9;
const POSE_PHI = 1.2;
/** Camera distance as a multiple of the system's visible bounding radius —
 * `erosion-repro.harness.ts`'s `cameraRays` default, "approximately the
 * app's framed orbit view". */
const POSE_DIST_FACTOR = 2.4;

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Perspective camera rays from an explicit orbit pose (target/radius/
 * theta/phi), matching `orbit.ts`'s `sphericalToCartesian` convention —
 * see the module doc for why this duplicates (rather than imports)
 * `erosion-repro.harness.ts`'s `poseRays`. */
function poseRays(
  target: Vec3,
  radius: number,
  theta: number,
  phi: number,
  width: number,
  height: number,
): { ro: Vec3; rays: Vec3[] } {
  const ro: Vec3 = [
    target[0] + radius * Math.sin(phi) * Math.sin(theta),
    target[1] + radius * Math.cos(phi),
    target[2] + radius * Math.sin(phi) * Math.cos(theta),
  ];
  const fwd = normalize([
    target[0] - ro[0],
    target[1] - ro[1],
    target[2] - ro[2],
  ]);
  const right = normalize(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const fov = (FULL_FOV_DEG * Math.PI) / 180;
  const tanHalf = Math.tan(fov / 2);
  const aspect = width / height;
  const rays: Vec3[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ndcX = ((x + 0.5) / width) * 2 - 1;
      const ndcY = 1 - ((y + 0.5) / height) * 2;
      const dx = ndcX * tanHalf * aspect;
      const dy = ndcY * tanHalf;
      rays.push(
        normalize([
          fwd[0] + right[0] * dx + up[0] * dy,
          fwd[1] + right[1] * dx + up[1] * dy,
          fwd[2] + right[2] * dx + up[2] * dy,
        ]),
      );
    }
  }
  return { ro, rays };
}

// ---------------------------------------------------------------------
// Gridless march emulator with per-call application counting.
// ---------------------------------------------------------------------

interface RayMarchStats {
  hit: boolean;
  /** Steps taken: the hit step (inclusive) or the budget/sphere-exit count. */
  steps: number;
  /** Whether the ray intersected the visible bounding sphere at all — false
   * for pure background rays (`disc < 0` or `tFar <= 0`), which never reach
   * the march loop and so trivially cost 0 steps. Kept separate from `hit`
   * so the results table can report both "cost per pixel of the whole
   * frame" (steps/apps averaged over ALL rays, background included — the
   * honest per-pixel number) and "cost of engaging the DE at all" (the same
   * average conditioned on `entered`, isolating the sparse-attractor
   * void-traversal cost from background dilution). */
  entered: boolean;
  /** Total inverse-map applications (invM VISIT reads) across this ray's
   * whole march — the sum of every step's DE-call apps. */
  appsThisRay: number;
  /** Apps for each individual `estimateDistance` call along this ray, in
   * march order — one entry per step actually taken. */
  callApps: number[];
  /** Total invM ELEMENT reads (raw, pre-/9) across this ray's whole march —
   * the fine-granularity twin of `appsThisRay`; see the module doc's
   * TRANSFORMS APPLIED section. */
  fineAppsThisRay: number;
  /** Element reads for each individual `estimateDistance` call along this
   * ray, parallel to `callApps` (same length, same march order). */
  fineCallApps: number[];
}

/** CPU emulator of `surface-material.ts`'s main() march loop (confirmed
 * line for line against the shipped GLSL: ray-sphere entry against
 * `uVisibleRadius * 1.02`, `eps = max(uAcceptPixelEps * t, uBoundingRadius *
 * uHitFloor)`, `d = surfaceDE(p, eps)`, `t += d * uStepScale`), GRIDLESS
 * (no `uGridEnabled` branch — isolates the DE's own cost) and calling the
 * PLAIN `estimateDistance` overload (the fold GLSL's refine=false mirror —
 * see the module doc). `de` must already be `countingDEFine`-wrapped;
 * `counter`/`fineCounter` are read/diffed around each call, never reset
 * here, so callers can attribute apps to whichever span they need (this
 * function attributes them per-call and sums them per-ray; the caller sums
 * further, per-system). Dither (`hash(gl_FragCoord.xy) * uPixelEps *
 * max(t,1)`) is omitted, matching `erosion-repro.harness.ts`'s `march()`:
 * sub-epsilon, no effect on step counts at this budget. */
function marchCounted(
  de: SurfaceDE,
  counter: { n: number },
  fineCounter: { n: number },
  ro: Vec3,
  rd: Vec3,
  pixelEps: number,
  maxSteps: number,
): RayMarchStats {
  const radius = de.visibleBoundingRadius * 1.02;
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - radius * radius;
  const disc = b * b - c;
  if (disc < 0) {
    return {
      hit: false,
      steps: 0,
      entered: false,
      appsThisRay: 0,
      callApps: [],
      fineAppsThisRay: 0,
      fineCallApps: [],
    };
  }
  const sq = Math.sqrt(disc);
  const tFar = -b + sq;
  if (tFar <= 0) {
    return {
      hit: false,
      steps: 0,
      entered: false,
      appsThisRay: 0,
      callApps: [],
      fineAppsThisRay: 0,
      fineCallApps: [],
    };
  }
  let t = Math.max(-b - sq, 0);
  const p: Vec3 = [0, 0, 0];
  const callApps: number[] = [];
  const fineCallApps: number[] = [];
  let appsThisRay = 0;
  let fineAppsThisRay = 0;
  let i = 0;
  for (; i < maxSteps; i++) {
    if (t > tFar) break;
    const eps = Math.max(
      pixelEps * t,
      de.boundingRadius * SURFACE_FULL_HIT_FLOOR,
    );
    p[0] = ro[0] + rd[0] * t;
    p[1] = ro[1] + rd[1] * t;
    p[2] = ro[2] + rd[2] * t;
    const before = counter.n;
    const fineBefore = fineCounter.n;
    // eps doubles as the cutoff (fr-55r5) AND the cone footprint for the
    // per-step depth cap (fr-3c0k) — exactly the pair the shipped GLSL
    // march passes.
    const d = estimateDistance(de, p, eps, eps);
    const callCost = counter.n - before;
    const fineCallCost = fineCounter.n - fineBefore;
    callApps.push(callCost);
    fineCallApps.push(fineCallCost);
    appsThisRay += callCost;
    fineAppsThisRay += fineCallCost;
    if (d < eps) {
      return {
        hit: true,
        steps: i + 1,
        entered: true,
        appsThisRay,
        callApps,
        fineAppsThisRay,
        fineCallApps,
      };
    }
    t += d * de.stepScale;
  }
  return {
    hit: false,
    steps: i,
    entered: true,
    appsThisRay,
    callApps,
    fineAppsThisRay,
    fineCallApps,
  };
}

// ---------------------------------------------------------------------
// Stats helpers.
// ---------------------------------------------------------------------

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** `xs` must already be sorted ascending. */
function percentile(xsSorted: number[], p: number): number {
  if (xsSorted.length === 0) return NaN;
  const idx = Math.min(xsSorted.length - 1, Math.floor(p * xsSorted.length));
  return xsSorted[idx];
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

// ---------------------------------------------------------------------
// Adaptive grid sizing: a cheap gridless pilot projects ms/ray, then picks
// the largest square grid (capped at TARGET_SIDE) that fits PER_SYSTEM_
// BUDGET_MS. See the module doc's GRID SIZE paragraph.
//
// HARD WALL-CLOCK CAPS (added after the fine-counter follow-up measured
// Proxy overhead empirically: ~86x per call on mandelboxKifs, 0.61ms ->
// 52.5ms at a representative near-object point — see the module doc's
// TRANSFORMS APPLIED section). The ORIGINAL sizing here was projection-only
// (pilot ms/ray -> budget -> side), with `MIN_SIDE` as a soft floor that
// `Math.max`ed OVER the budget-computed value whenever a system was so
// expensive the budget alone would pick something smaller — meaning a
// pathological system's `MIN_SIDE^2` rays could still blow arbitrarily past
// `PER_SYSTEM_BUDGET_MS`, which is exactly what happened: the first fine-
// counter run of this file hung past 3 minutes of 100% CPU with the ORIGINAL
// `MIN_SIDE=16` (a forced 256-ray floor) before being killed. Two
// independent fixes, both required (a soft floor plus a projection is not
// enough when the projection itself can be wrong by an order of magnitude
// on high-variance per-ray cost): `MIN_SIDE` drops to a true bare minimum
// (16 rays, not 256), and BOTH the pilot and main loops below now check a
// hard wall-clock cap periodically and break early on whatever they
// completed — `rays` in the returned {@link SystemResult} is always the
// ACTUAL count marched, not the originally intended grid size, so downstream
// stats stay honest about a shrunk sample.
// ---------------------------------------------------------------------

const TARGET_SIDE = 48;
const MIN_SIDE = 4;
const PILOT_SIDE = 4;
/** Wall-clock ceiling on the pilot loop itself — if even this few rays run
 * long, stop and project from whatever completed rather than let the pilot
 * (whose whole JOB is to be cheap) become the runaway. */
const PILOT_HARD_CAP_MS = 15_000;
const PER_SYSTEM_BUDGET_MS = 30_000;
/** Absolute wall-clock ceiling on the MAIN ray loop, independent of the
 * budget projection above — the real safety net against per-ray cost
 * variance the pilot's average can't see coming (a handful of rays that
 * graze the surface and need many small-eps, near-full-descent steps can
 * cost orders of magnitude more than the pilot's mean ray — measured up to
 * 52.5ms for a single near-object call on mandelboxKifs, so even a coarse
 * every-N-rays check could overshoot by seconds). Checked after EVERY ray:
 * a `performance.now()` call costs nanoseconds next to a march, so there is
 * no reason to batch it and every batch-size widens the worst-case overshoot
 * by one ray's full cost. */
const MAIN_HARD_CAP_MS = 45_000;

const FOLD_KIND_NAMES: Record<number, string> = {
  [SURFACE_FOLD_NONE]: "affine",
  [SURFACE_FOLD_BOXFOLD]: "boxfold",
  [SURFACE_FOLD_SPHEREFOLD]: "spherefold",
  [SURFACE_FOLD_MANDELBOX]: "mandelbox",
};
const FOLD_BRANCH_COUNT: Record<number, number> = {
  [SURFACE_FOLD_NONE]: 1,
  [SURFACE_FOLD_BOXFOLD]: 27,
  [SURFACE_FOLD_SPHEREFOLD]: 3,
  [SURFACE_FOLD_MANDELBOX]: 81,
};

interface SystemResult {
  label: string;
  rays: number;
  side: number;
  hitFrac: number;
  /** Fraction of rays that intersected the visible bounding sphere at all —
   * see {@link RayMarchStats.entered}. Disambiguates "cheap because it's
   * background" from "cheap because the march itself resolves fast". */
  enteredFrac: number;
  stepsMean: number;
  stepsMedian: number;
  stepsP95: number;
  /** Same three stats, conditioned on `entered` — the DE's own march-length
   * behavior with background rays' trivial 0-step entries excluded. */
  stepsMeanEntered: number;
  stepsMedianEntered: number;
  stepsP95Entered: number;
  callMean: number;
  callMedian: number;
  callP95: number;
  appsPerRayMean: number;
  totalApps: number;
  /** Element-granularity twin of `callMean`/`callMedian`/`callP95`, in
   * TRANSFORMS applied (`fineCounter.n / 9`) — see the module doc's
   * TRANSFORMS APPLIED section. Today (pre-fr-kidj) every branch's
   * transform runs unconditionally, so these should track `callMean *
   * meanBranchFanout` etc. closely; the per-system narrative cross-checks
   * that directly. */
  xformCallMean: number;
  xformCallMedian: number;
  xformCallP95: number;
  /** Element-granularity twin of `appsPerRayMean`/`totalApps`. */
  xformPerRayMean: number;
  totalTransforms: number;
  wallMs: number;
  /** Mean branch fan-out per map visit, weighted by each map's own branch
   * count (27/3/81/1) — restores the brief's original "branch evaluations"
   * framing from the visit-counted "apps" this harness reports (see the
   * module doc's WHICH ESTIMATOR / apps-unit paragraph). */
  meanBranchFanout: number;
}

function measureSystem(
  label: string,
  transforms: Transform[],
): SystemResult | null {
  const analysis = analyzeSurfaceSystem(transforms);
  if (analysis.status === "ineligible") {
    console.log(`-- ${label}: INELIGIBLE (${analysis.reasons.join("; ")})`);
    return null;
  }
  const rawDe = buildSurfaceDE(transforms);
  if (!deHasFolds(rawDe)) {
    throw new Error(
      `${label}: expected a pure-fold profile routed through descendFold; ` +
        `got a fold-free system (deHasFolds returned false)`,
    );
  }

  const kinds = rawDe.maps.map((m) => FOLD_KIND_NAMES[m.foldKind]);
  const meanBranchFanout = mean(
    rawDe.maps.map((m) => FOLD_BRANCH_COUNT[m.foldKind]),
  );
  const dist = POSE_DIST_FACTOR * rawDe.visibleBoundingRadius;

  // Pilot: tiny gridless march at the production budget, same pose family,
  // to measure real ms/ray on THIS machine before committing to a grid size.
  // Uses countingDEFine (not the plain countingDE) so the pilot pays the
  // SAME Proxy element-counting overhead the main run below pays — the
  // fine counter's per-branch trap firing is real cost the budget must see,
  // or the projected grid size would be too optimistic.
  const {
    de: pilotDe,
    counter: pilotCounter,
    fineCounter: pilotFineCounter,
  } = countingDEFine(rawDe, rawDe.beamWidth);
  const pilot = poseRays(
    POSE_TARGET,
    dist,
    POSE_THETA,
    POSE_PHI,
    PILOT_SIDE,
    PILOT_SIDE,
  );
  const pilotT0 = performance.now();
  let pilotRaysRun = 0;
  for (const rd of pilot.rays) {
    marchCounted(
      pilotDe,
      pilotCounter,
      pilotFineCounter,
      pilot.ro,
      rd,
      FULL_PIXEL_EPS,
      SURFACE_FULL_MARCH_STEPS,
    );
    pilotRaysRun++;
    // Hard cap: even the pilot's job is to be cheap, so if IT runs long,
    // stop and project off whatever completed rather than let it become
    // the runaway (see the constants block's HARD WALL-CLOCK CAPS note).
    if (performance.now() - pilotT0 > PILOT_HARD_CAP_MS) break;
  }
  const pilotMs = performance.now() - pilotT0;
  const msPerRay = pilotMs / Math.max(1, pilotRaysRun);
  const maxRaysByBudget = Math.max(
    MIN_SIDE * MIN_SIDE,
    Math.floor(PER_SYSTEM_BUDGET_MS / Math.max(msPerRay, 1e-6)),
  );
  const side = Math.max(
    MIN_SIDE,
    Math.min(TARGET_SIDE, Math.floor(Math.sqrt(maxRaysByBudget))),
  );

  console.log(
    `-- ${label}: maps=${rawDe.maps.length} folds=[${kinds.join(",")}] ` +
      `R=${rawDe.boundingRadius.toFixed(4)} maxDepth=${rawDe.maxDepth} ` +
      `pilot=${msPerRay.toFixed(3)}ms/ray (${pilotRaysRun}/${pilot.rays.length} pilot rays run) ` +
      `-> side=${side} (target ${TARGET_SIDE})`,
  );

  const {
    de: countedDe,
    counter,
    fineCounter,
  } = countingDEFine(rawDe, rawDe.beamWidth);
  const grid = poseRays(POSE_TARGET, dist, POSE_THETA, POSE_PHI, side, side);
  const stepsArr: number[] = [];
  const stepsEnteredArr: number[] = [];
  const callAppsArr: number[] = [];
  const fineCallAppsArr: number[] = [];
  let hits = 0;
  let entered = 0;
  let totalApps = 0;
  let totalFineApps = 0;
  let raysRun = 0;
  let hitCap = false;
  const t0 = performance.now();
  for (const rd of grid.rays) {
    const r = marchCounted(
      countedDe,
      counter,
      fineCounter,
      grid.ro,
      rd,
      FULL_PIXEL_EPS,
      SURFACE_FULL_MARCH_STEPS,
    );
    raysRun++;
    stepsArr.push(r.steps);
    if (r.entered) {
      entered++;
      stepsEnteredArr.push(r.steps);
    }
    if (r.hit) hits++;
    totalApps += r.appsThisRay;
    totalFineApps += r.fineAppsThisRay;
    for (const a of r.callApps) callAppsArr.push(a);
    for (const a of r.fineCallApps) fineCallAppsArr.push(a);
    // Hard cap, checked after every ray (see the constants block's HARD
    // WALL-CLOCK CAPS note): break and report on whatever actually ran
    // rather than trust the budget projection blindly.
    if (performance.now() - t0 > MAIN_HARD_CAP_MS) {
      hitCap = true;
      break;
    }
  }
  const wallMs = performance.now() - t0;
  if (hitCap) {
    console.log(
      `   [${label}] MAIN_HARD_CAP_MS (${MAIN_HARD_CAP_MS}ms) hit — ` +
        `stopped at ${raysRun}/${grid.rays.length} rays, stats below are ` +
        `over the completed subset only`,
    );
  }

  stepsArr.sort((a, b) => a - b);
  stepsEnteredArr.sort((a, b) => a - b);
  callAppsArr.sort((a, b) => a - b);
  fineCallAppsArr.sort((a, b) => a - b);
  const rays = raysRun;
  // "Transforms applied" = element reads / 9 (see the module doc's
  // TRANSFORMS APPLIED section) — division by a positive constant commutes
  // with mean/median/percentile, so dividing the raw fine numbers here
  // (rather than every individual sample before sorting) is exact, not an
  // approximation.
  const ELEMENTS_PER_TRANSFORM = 9;

  return {
    label,
    rays,
    side,
    hitFrac: hits / rays,
    enteredFrac: entered / rays,
    stepsMean: mean(stepsArr),
    stepsMedian: percentile(stepsArr, 0.5),
    stepsP95: percentile(stepsArr, 0.95),
    stepsMeanEntered: mean(stepsEnteredArr),
    stepsMedianEntered: percentile(stepsEnteredArr, 0.5),
    stepsP95Entered: percentile(stepsEnteredArr, 0.95),
    callMean: mean(callAppsArr),
    callMedian: percentile(callAppsArr, 0.5),
    callP95: percentile(callAppsArr, 0.95),
    appsPerRayMean: totalApps / rays,
    totalApps,
    xformCallMean: mean(fineCallAppsArr) / ELEMENTS_PER_TRANSFORM,
    xformCallMedian: percentile(fineCallAppsArr, 0.5) / ELEMENTS_PER_TRANSFORM,
    xformCallP95: percentile(fineCallAppsArr, 0.95) / ELEMENTS_PER_TRANSFORM,
    xformPerRayMean: totalFineApps / ELEMENTS_PER_TRANSFORM / rays,
    totalTransforms: totalFineApps / ELEMENTS_PER_TRANSFORM,
    wallMs,
    meanBranchFanout,
  };
}

function fmtHeader(): string {
  return (
    `${"system".padEnd(24)}${"rays".padStart(7)}${"hit%".padStart(8)}` +
    `${"stepMu".padStart(9)}${"stepMd".padStart(8)}${"stepP95".padStart(9)}` +
    `${"callMu".padStart(11)}${"callMd".padStart(10)}${"callP95".padStart(11)}` +
    `${"apps/ray".padStart(14)}${"totalApps".padStart(16)}`
  );
}

function fmtRow(r: SystemResult): string {
  return (
    `${r.label.padEnd(24)}${String(r.rays).padStart(7)}` +
    `${(r.hitFrac * 100).toFixed(1).padStart(7)}%` +
    `${r.stepsMean.toFixed(1).padStart(9)}${fmtInt(r.stepsMedian).padStart(8)}` +
    `${fmtInt(r.stepsP95).padStart(9)}` +
    `${r.callMean.toFixed(1).padStart(11)}${fmtInt(r.callMedian).padStart(10)}` +
    `${fmtInt(r.callP95).padStart(11)}` +
    `${r.appsPerRayMean.toFixed(1).padStart(14)}${fmtInt(r.totalApps).padStart(16)}`
  );
}

/** Second, narrower table isolating background dilution from the DE's own
 * march-length behavior (see {@link RayMarchStats.entered}'s doc). */
function fmtHeader2(): string {
  return (
    `${"system".padEnd(24)}${"entered%".padStart(9)}` +
    `${"stepMu|enter".padStart(13)}${"stepMd|enter".padStart(13)}${"stepP95|enter".padStart(14)}`
  );
}

function fmtRow2(r: SystemResult): string {
  return (
    `${r.label.padEnd(24)}${(r.enteredFrac * 100).toFixed(1).padStart(8)}%` +
    `${r.stepsMeanEntered.toFixed(1).padStart(13)}${fmtInt(r.stepsMedianEntered).padStart(13)}` +
    `${fmtInt(r.stepsP95Entered).padStart(14)}`
  );
}

/** Third table: TRANSFORMS APPLIED (element-granularity twin of table 1's
 * apps columns — see the module doc's TRANSFORMS APPLIED section and
 * fr-kidj's pre-optimization baseline ask). Same row order/labels as
 * tables 1-2 so a reader can align columns across all three by eye. */
function fmtHeader3(): string {
  return (
    `${"system".padEnd(24)}${"xformMu".padStart(11)}${"xformMd".padStart(10)}` +
    `${"xformP95".padStart(11)}${"xform/ray".padStart(14)}${"totalXforms".padStart(16)}`
  );
}

function fmtRow3(r: SystemResult): string {
  return (
    `${r.label.padEnd(24)}${r.xformCallMean.toFixed(1).padStart(11)}` +
    `${fmtInt(r.xformCallMedian).padStart(10)}${fmtInt(r.xformCallP95).padStart(11)}` +
    `${r.xformPerRayMean.toFixed(1).padStart(14)}${fmtInt(r.totalTransforms).padStart(16)}`
  );
}

describe("fr-ck0w fold-DE march-steps vs DE-cost split", () => {
  it("measures gridless full-tier march steps and inverse-map applications per pure-fold system", () => {
    const systems: { label: string; transforms: Transform[] }[] = [
      // Headline system (required): the shipped pure-fold preset, 12 maps
      // (8 mandelbox corners + 4 boxfold binders) — the acceptance-criterion
      // system fr-5rvk itself measured against.
      { label: "mandelboxKifs preset", transforms: mandelboxKifs() },
      // Every synthetic pure-fold profile the fold harnesses share
      // (harness-profiles.ts, extracted verbatim from surface-beam.harness.ts's
      // fr-5rvk section 4 so this harness measures the IDENTICAL systems
      // surface-beam.harness.ts and surface-grid-cost.harness.ts do): the
      // three branch counts (27/3/81) plus the mixed negative-weight-fold
      // + affine profile.
      { label: "boxfold pair (27)", transforms: foldBoxfoldPair() },
      {
        label: "boxfold -w + affine",
        transforms: foldBoxfoldNegPlusAffine(),
      },
      { label: "spherefold pair (3)", transforms: foldSpherefoldPair() },
      { label: "mandelbox pair (81)", transforms: foldMandelboxPair() },
    ];

    console.log(
      `\n== fr-ck0w EXPERIMENT 2: march-steps vs DE-cost split ==\n` +
        `estimator=estimateDistance (refine=false, the fold GLSL's mirror) ` +
        `grid=null (gridless) budget=${SURFACE_FULL_MARCH_STEPS} steps ` +
        `hitFloor=${SURFACE_FULL_HIT_FLOOR.toExponential(1)} ` +
        `pixelEps=${FULL_PIXEL_EPS.toExponential(4)} (fov ${FULL_FOV_DEG}deg, ` +
        `${FULL_FRAME_HEIGHT}px full-res frame) ` +
        `pose=(theta=${POSE_THETA},phi=${POSE_PHI},dist=${POSE_DIST_FACTOR}xvisibleR,target=origin) ` +
        `targetGrid=${TARGET_SIDE}x${TARGET_SIDE} perSystemBudget=${PER_SYSTEM_BUDGET_MS}ms`,
    );

    const results: SystemResult[] = [];
    for (const sys of systems) {
      const r = measureSystem(sys.label, sys.transforms);
      if (r) results.push(r);
    }

    console.log(
      `\n-- results table (apps = invM-read map visits, not raw branch evals) --`,
    );
    console.log(fmtHeader());
    for (const r of results) {
      console.log(fmtRow(r));
    }

    console.log(
      `\n-- background-dilution check: entered% is the fraction of rays that ` +
        `intersected the visible bounding sphere at all; stepMu/Md/P95|enter ` +
        `condition the step stats on that subset, excluding trivial 0-step ` +
        `background rays (see the module doc's pose caveat) --`,
    );
    console.log(fmtHeader2());
    for (const r of results) {
      console.log(fmtRow2(r));
    }

    console.log(
      `\n-- transforms applied (element-granularity twin of table 1's apps ` +
        `columns, fineCounter.n / 9 — see the module doc's TRANSFORMS ` +
        `APPLIED section; this is fr-kidj's pre-optimization baseline) --`,
    );
    console.log(fmtHeader3());
    for (const r of results) {
      console.log(fmtRow3(r));
    }

    console.log(`\n-- factor A vs factor B, per system --`);
    for (const r of results) {
      const affineBaselineApps = 90; // surface-beam.harness.ts's low end for affine presets.
      const reconstructedXformPerCall = r.callMean * r.meanBranchFanout;
      const xformCheckRatio = r.xformCallMean / reconstructedXformPerCall;
      console.log(
        `${r.label}: ${r.stepsMean.toFixed(1)} steps/ray x ${r.callMean.toFixed(1)} ` +
          `apps/call = ${r.appsPerRayMean.toFixed(1)} apps/ray ` +
          `(~${(r.callMean / affineBaselineApps).toFixed(2)}x an affine preset's apps/call baseline; ` +
          `mean branch fan-out/visit=${r.meanBranchFanout.toFixed(1)} => ` +
          `~${fmtInt(reconstructedXformPerCall)} branch evaluations/call (reconstructed), ` +
          `~${fmtInt(r.appsPerRayMean * r.meanBranchFanout)} branch evaluations/ray (reconstructed); ` +
          `DIRECTLY MEASURED (fine counter): ${r.xformCallMean.toFixed(1)} transforms/call, ` +
          `${r.xformPerRayMean.toFixed(1)} transforms/ray ` +
          `(${xformCheckRatio.toFixed(3)}x the reconstruction — expect ~1.0x pre-fr-kidj, since every ` +
          `branch's transform still runs unconditionally today); ` +
          `wall=${(r.wallMs / 1000).toFixed(2)}s for ${r.rays} rays (side=${r.side})`,
      );
    }

    expect(true).toBe(true);
  }, 900_000);
});
