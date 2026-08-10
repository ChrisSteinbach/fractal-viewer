/**
 * fr-ybtq measurement harness: how much of a fold-LENS system's DE cost is
 * the branch SWEEP, and how much of that sweep is avoidable.
 *
 * THE QUESTION. `descendLens` (`surface-de.ts`) estimates a fold FINAL
 * lens by sweeping the fold's inverse branches (27/3/81) around the
 * UNTOUCHED descent cores: each surviving branch pays a whole root descent
 * through the base system. Three value-exact prunes keep that loop off its
 * worst case — the region floor, the depth-0 sphere certificate, and the
 * visible-sphere pin — and all three are tested against the running `best`,
 * so their strength depends ENTIRELY on how small `best` already is when
 * the branch is reached. The sweep visits branches in fixed index order
 * `0..branchCount-1`, so branch 0 always pays a full descent and every later
 * prune inherits whatever `best` that first descent happened to produce.
 *
 * fr-ybtq measured the consequence in the field: the fr-55s1 lens archetype
 * (tetra base, shrunk/offset mandelbox lens) settles a 1280x720 frame in
 * 9.4s on compute, while the user's own scene — the DEFAULT four-map base
 * (spread +-0.5, per-map pi/4 rotations) under a mandelbox lens at IDENTITY
 * affine part, weight 1 — is a 5-6 MINUTE settle at 1080p. The bead's
 * hypothesis for the gap: an identity lens neither shrinks nor displaces the
 * attractor, so much of it sits near the fold-plane boundaries where region
 * floors go to zero and `rq ~ R` makes the sphere certificate vacuous, and
 * "most of the 81 branches survive the prunes per eval".
 *
 * This harness tests that hypothesis directly, and sizes the headroom a
 * better branch ORDER could reach.
 *
 * VERDICT (2026-07-30, fr-ybtq). Both halves of the hypothesis are wrong,
 * and the lever it implied is CLOSED — measured, not argued:
 *
 *  - Survival is 5.5% (archetype) / 8.4% (field class) of 81 branches, not
 *    "most". The three prunes already kill 91-95% of the sweep.
 *  - Per EVAL the field class costs only ~1.4x the archetype (262 vs 195
 *    transforms, 522 vs 367us), which cannot explain a ~15x/ray field gap.
 *    The second leg below localises the rest: at matched framing the two
 *    systems take nearly the same march steps per ray (33.5 vs 31.0 at
 *    0.6x), so the lens tax is per-eval and the remaining field gap is
 *    framing and ray count, not a distinct grinding mode — exhaustion is
 *    ZERO at every framing tested.
 *  - BEST-FIRST ORDERING WAS IMPLEMENTED AND REVERTED. Seeding the sweep
 *    with the argmin of each branch's exact depth-0 lower bound cut core
 *    descents/call 4.46 -> 2.26 (archetype) and 6.83 -> 5.94 (field
 *    class), worth 9-15% of CPU wall — but on the REAL GPU (Iris Xe,
 *    npm run bench:surface --display=:0) it was a 1.46-1.54x REGRESSION
 *    (frame-lens 3425 -> 4986ms; unproj-lens 184 -> 283ms, that leg
 *    thermally stable across flag sets). The ordering pass re-enumerates
 *    all 81 branch preimages to save ~16% of descent transforms, and the
 *    GPU cannot buy that trade — the same verdict fr-kidj's stage-2 B&B
 *    got, one level up. The residual survivors are branches whose
 *    preimages land INSIDE the bounding ball, where a depth-0 sphere test
 *    is vacuous at any visit order; ordering was already at its ceiling.
 *
 * So the remaining prize (the lens sweep is a ~4.3x tax over the same
 * system un-lensed) needs a genuinely stronger IN-BALL certificate, not a
 * cheaper way to reach the existing one. See fr-ybtq's notes.
 *
 * WHAT IS COUNTED. Two independent instruments ride one march:
 *
 *  - CORE DESCENTS per DE call — the number of lens branches that actually
 *    paid a root descent. Counted through a getter on `de.final`, which
 *    `descend` and `descendFold` each read EXACTLY ONCE at entry
 *    (`surface-de.ts:1709`, `:2300`) and which nothing else in the descent
 *    hot path touches (`refinedCertValue` reads `de.symmetry`, not
 *    `de.final`, so the refined path does not inflate the count).
 *    `descendLens` itself never reads it — `de.final` is null whenever
 *    `de.foldFinal` is set — so the number is branch survivors, exactly.
 *    Against `foldBranchCount(kind)` it is the sweep's survival RATE; the
 *    ideal a perfect branch order could reach is 1.
 *  - TRANSFORMS per DE call — `countingDEFine`'s `invM` element counter / 9,
 *    the same unit `fold-cost-split.harness.ts` and `surface-beam.harness.ts`
 *    report, so lens numbers are comparable 1:1 with the fold-monster
 *    numbers already on record.
 *
 * WHICH ESTIMATOR. `estimateDistanceRefined`, not plain `estimateDistance`:
 * every system below is lens-over-AFFINE, and fr-55s1 pinned that class's
 * marched estimator as the refined one (`descendLens(refine=true) ->
 * descend`) — it is what the affine GLSL body mirrors line for line and what
 * `surface-de-gpu.ts`'s `core:"affine"` kernel emits. Measuring the plain
 * overload here would price an estimator no lens-over-affine session runs.
 *
 * SYSTEMS. Four, chosen so the archetype/field-class gap is visible in one
 * table and neither end is confounded:
 *
 *  - `lensMandelboxOverTetra` — the fr-55s1 M1b bench row verbatim (the
 *    9.4s-settle archetype). 81 branches, lens affine part rotated/offset
 *    and shrunk 0.85.
 *  - `lensMandelboxIdentityOverDefault` — fr-ybtq's field class. Same fold,
 *    same weight, IDENTITY affine part, over the shipped default system.
 *    The single controlled difference from the row above is the lens's
 *    affine part plus the base's spread/rotations.
 *  - `lensBoxfoldOverTetra` — the fr-55s1 M1a row: 27 branches, so the
 *    survival rate is read at a second branch count and cannot be an
 *    artifact of the mandelbox's composite structure.
 *  - `noLensDefault` — the default system with NO lens. Its transforms/call
 *    is one core descent's cost, which turns the lens rows' transforms/call
 *    into an independent cross-check on the survivor count.
 *
 * Usage:
 *   npx vitest run --config scripts/vitest.harness.config.ts scripts/lens-branch-cost.harness.ts
 */
import {
  buildSurfaceDE,
  estimateDistanceRefined,
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_MANDELBOX,
  SURFACE_FOLD_NONE,
  SURFACE_FOLD_SPHEREFOLD,
} from "../src/fractal/surface-de";
import type { SurfaceDE } from "../src/fractal/surface-de";
import { defaultTransforms } from "../src/fractal/presets";
import type { Transform, Vec3 } from "../src/fractal/types";
import { countingDEFine } from "./harness-profiles";

// ---------------------------------------------------------------------
// Shipped production constants, mirrored by hand (comment-cited, not
// imported) — the same convention fold-cost-split.harness.ts uses, and for
// the same reason: `surface-material.ts` drags in a `three` module-scope
// construction this CPU harness has no reason to load.
// ---------------------------------------------------------------------

/** `SURFACE_FULL_MARCH_STEPS`, `src/app/surface-material.ts`. */
const SURFACE_FULL_MARCH_STEPS = 160;
/** `SURFACE_FULL_HIT_FLOOR`, `src/app/surface-material.ts`. */
const SURFACE_FULL_HIT_FLOOR = 1.0e-5;
/** Full-resolution frame height the app derives `uAcceptPixelEps` from at
 * the settle frame — `fold-phantom.harness.ts`'s `ACCEPT_NATIVE_H`. */
const FULL_FRAME_HEIGHT = 800;
/** `PerspectiveCamera(60, ...)`, `src/app/scene.ts`. */
const FULL_FOV_DEG = 60;
/** `uAcceptPixelEps` at the full-resolution settle frame. */
const FULL_PIXEL_EPS =
  (2 * Math.tan((FULL_FOV_DEG * Math.PI) / 360)) / FULL_FRAME_HEIGHT;
/** `uStepScale`'s shipped value for fold-class fields. */
const STEP_SCALE = 1;

// ---------------------------------------------------------------------
// Systems.
// ---------------------------------------------------------------------

/** `gpu-bench/main.ts`'s `surfaceAffineTetra` verbatim — the M0/M1 affine
 * base the shipped lens agreement rows sit over. */
function affineTetra(): Transform[] {
  return [
    {
      id: 0,
      position: [0.35, 0.35, 0.35],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 1,
      position: [-0.35, -0.35, 0.35],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 2,
      position: [0.35, -0.35, -0.35],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 3,
      position: [-0.35, 0.35, -0.35],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
  ];
}

/** `gpu-bench/main.ts`'s `surfaceLensMandelboxFinal` verbatim (M1b). */
function lensMandelboxFinal(): Transform {
  return {
    id: 91,
    position: [0.1, 0.05, -0.1],
    rotation: [0.15, -0.2, 0.25],
    scale: [0.85, 0.85, 0.85],
    variations: [{ type: "mandelbox", weight: 1 }],
  };
}

/** `gpu-bench/main.ts`'s `surfaceLensBoxfoldFinal` verbatim (M1a). */
function lensBoxfoldFinal(): Transform {
  return {
    id: 90,
    position: [0.15, -0.1, 0.05],
    rotation: [0.2, 0.3, 0.1],
    scale: [0.9, 0.9, 0.9],
    variations: [{ type: "boxfold", weight: 0.55 }],
  };
}

/** fr-ybtq's field class: `defaultFinalTransform()`'s identity affine part
 * (unit scale, no rotation, no offset — the lens as the UI first enables it)
 * carrying a weight-1 mandelbox. No shrink, no displacement: the case the
 * bead names as the reason the prunes go weak. */
function lensMandelboxIdentityFinal(): Transform {
  return {
    id: 92,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight: 1 }],
  };
}

interface Profile {
  name: string;
  transforms: Transform[];
  finalTransform: Transform | null;
  /** What the bead expects, for the report's own narrative. */
  note: string;
}

const PROFILES: Profile[] = [
  {
    name: "lensMandelboxOverTetra",
    transforms: affineTetra(),
    finalTransform: lensMandelboxFinal(),
    note: "fr-55s1 M1b archetype (9.4s settle @720p on compute)",
  },
  {
    name: "lensMandelboxIdentityOverDefault",
    transforms: defaultTransforms(),
    finalTransform: lensMandelboxIdentityFinal(),
    note: "fr-ybtq field class (5-6min settle @1080p on compute)",
  },
  {
    name: "lensBoxfoldOverTetra",
    transforms: affineTetra(),
    finalTransform: lensBoxfoldFinal(),
    note: "fr-55s1 M1a archetype, 27 branches",
  },
  {
    name: "noLensDefault",
    transforms: defaultTransforms(),
    finalTransform: null,
    note: "core-only baseline (one descent's transforms/call)",
  },
];

// ---------------------------------------------------------------------
// Camera pose + ray grid — copied from fold-cost-split.harness.ts's
// poseRays/normalize/cross (which copied erosion-repro.harness.ts's; see
// that file's module doc for why these are copies, not imports).
// ---------------------------------------------------------------------

const POSE_TARGET: Vec3 = [0, 0, 0];
/** Off-axis orbit angles, deliberately unaligned to any coordinate plane. */
const POSE_THETA = 0.9;
const POSE_PHI = 1.2;
/** Camera distance as a multiple of the system's visible bounding radius —
 * "approximately the app's framed orbit view". */
const POSE_DIST_FACTOR = 2.4;
/** Square ray grid side. Small by design: an 81-branch lens eval on the
 * field-class system costs tens of core descents, and the point of this
 * harness is the RATIO, which is stable well before the pixel count is. */
const GRID_SIDE = 28;

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
// Instruments.
// ---------------------------------------------------------------------

/** Wrap a DE so every `descend`/`descendFold` ENTRY bumps a counter, via
 * the `de.final` read each performs exactly once at its top (see the module
 * doc's WHAT IS COUNTED for the citations and for why nothing else in the
 * descent — `descendLens` included — perturbs the count). Composed ON TOP of
 * a `countingDEFine` wrapper so one march yields both instruments. */
function countingDescents(de: SurfaceDE): {
  de: SurfaceDE;
  descents: { n: number };
} {
  const descents = { n: 0 };
  const finalValue = de.final;
  // Spread first, then re-define `final` as the counting getter — the same
  // spread-then-override discipline harness-profiles.ts documents, so every
  // field (including ones added to SurfaceDE after this file was written)
  // passes through untouched.
  return {
    de: {
      ...de,
      get final() {
        descents.n++;
        return finalValue;
      },
    },
    descents,
  };
}

function foldBranchCount(kind: number): number {
  if (kind === SURFACE_FOLD_BOXFOLD) return 27;
  if (kind === SURFACE_FOLD_SPHEREFOLD) return 3;
  if (kind === SURFACE_FOLD_MANDELBOX) return 81;
  return 1;
}

interface SystemStats {
  name: string;
  note: string;
  branches: number;
  visibleRadius: number;
  boundingRadius: number;
  distFactor: number;
  rays: number;
  entered: number;
  hits: number;
  /** Rays that consumed the whole march budget without hitting and without
   * leaving the visible sphere — the "grind" class. fr-ybtq's field report
   * (hit=9 of 10184 rays, 2840 still active at the preview's budget) is a
   * frame made almost entirely of these, so they, not hits, are what the
   * bead's minutes-class settle is actually paying for. */
  exhausted: number;
  deCalls: number;
  descents: number;
  transforms: number;
  ms: number;
}

/** CPU emulator of the shipped march loop (ray-sphere entry against
 * `uVisibleRadius * 1.02`, `eps = max(uAcceptPixelEps * t, uBoundingRadius *
 * uHitFloor)`, `d = surfaceDE(p, eps)`, `t += d * uStepScale`), GRIDLESS —
 * the compute path the lens class actually runs is gridless by decision
 * (fr-tzdg), so this is the shipped shape, not a simplification. */
function measure(profile: Profile, distFactor = POSE_DIST_FACTOR): SystemStats {
  const built = buildSurfaceDE(profile.transforms, profile.finalTransform);
  const fine = countingDEFine(built, built.beamWidth);
  const wrapped = countingDescents(fine.de);
  const de = wrapped.de;
  const kind = de.foldFinal ? de.foldFinal.foldKind : SURFACE_FOLD_NONE;

  const { ro, rays } = poseRays(
    POSE_TARGET,
    de.visibleBoundingRadius * distFactor,
    POSE_THETA,
    POSE_PHI,
    GRID_SIDE,
    GRID_SIDE,
  );

  const stats: SystemStats = {
    name: profile.name,
    note: profile.note,
    branches: foldBranchCount(kind),
    visibleRadius: de.visibleBoundingRadius,
    boundingRadius: de.boundingRadius,
    distFactor,
    rays: rays.length,
    entered: 0,
    hits: 0,
    exhausted: 0,
    deCalls: 0,
    descents: 0,
    transforms: 0,
    ms: 0,
  };

  const radius = de.visibleBoundingRadius * 1.02;
  const p: Vec3 = [0, 0, 0];
  const start = performance.now();
  for (const rd of rays) {
    const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
    const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - radius * radius;
    const disc = b * b - c;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    const tFar = -b + sq;
    if (tFar <= 0) continue;
    stats.entered++;
    let t = Math.max(-b - sq, 0);
    let terminal = false;
    for (let i = 0; i < SURFACE_FULL_MARCH_STEPS; i++) {
      if (t > tFar) {
        terminal = true;
        break;
      }
      const eps = Math.max(
        FULL_PIXEL_EPS * t,
        de.boundingRadius * SURFACE_FULL_HIT_FLOOR,
      );
      p[0] = ro[0] + rd[0] * t;
      p[1] = ro[1] + rd[1] * t;
      p[2] = ro[2] + rd[2] * t;
      stats.deCalls++;
      const d = estimateDistanceRefined(de, p, eps);
      if (d < eps) {
        stats.hits++;
        terminal = true;
        break;
      }
      t += d * STEP_SCALE;
    }
    if (!terminal) stats.exhausted++;
  }
  stats.ms = performance.now() - start;
  stats.descents = wrapped.descents.n;
  stats.transforms = fine.fineCounter.n / 9;
  return stats;
}

function fmt(n: number, digits = 1): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

describe("fr-ybtq fold-lens branch sweep cost", () => {
  it("measures lens branch survivors and transforms per DE call", () => {
    // NOT `PROFILES.map(measure)`: Array.map passes (element, INDEX, array),
    // which would silently feed the index in as `distFactor`.
    const rows = PROFILES.map((p) => measure(p));
    const lines: string[] = [];
    lines.push("");
    lines.push(
      `fr-ybtq LENS BRANCH SWEEP COST — estimator=estimateDistanceRefined ` +
        `(the lens-over-affine class's marched estimator, fr-55s1), gridless, ` +
        `${GRID_SIDE}x${GRID_SIDE} rays at theta=${POSE_THETA} phi=${POSE_PHI} ` +
        `r=${POSE_DIST_FACTOR}x visibleR, full tier (${SURFACE_FULL_MARCH_STEPS} steps).`,
    );
    lines.push("");
    const core =
      rows.find((r) => r.name === "noLensDefault")!.transforms /
      rows.find((r) => r.name === "noLensDefault")!.deCalls;
    for (const r of rows) {
      const perCall = r.deCalls > 0 ? r.transforms / r.deCalls : 0;
      const descentsPerCall = r.deCalls > 0 ? r.descents / r.deCalls : 0;
      const survival = r.branches > 1 ? descentsPerCall / r.branches : 0;
      lines.push(`${r.name} — ${r.note}`);
      lines.push(
        `  branches=${r.branches}  rays=${r.rays} entered=${r.entered} ` +
          `hits=${r.hits}  DE calls=${r.deCalls}`,
      );
      lines.push(
        `  core descents/call = ${fmt(descentsPerCall, 2)}` +
          (r.branches > 1
            ? `  (survival ${fmt(survival * 100, 1)}% of ${r.branches}; ` +
              `ideal order = 1.00)`
            : ""),
      );
      lines.push(
        `  transforms/call = ${fmt(perCall, 0)}` +
          (r.branches > 1
            ? `  (= ${fmt(perCall / core, 1)}x the no-lens core's ${fmt(core, 0)})`
            : ""),
      );
      lines.push(
        `  wall = ${fmt(r.ms, 0)}ms  (${fmt((r.ms * 1000) / Math.max(1, r.deCalls), 1)}us/call)`,
      );
      lines.push("");
    }
    console.log(lines.join("\n"));

    // The harness asserts only that it measured something coherent — the
    // report IS the deliverable, exactly like the other cost harnesses.
    for (const r of rows) {
      expect(r.deCalls).toBeGreaterThan(0);
    }
  });

  /**
   * THE OTHER FACTOR. The table above prices ONE DE call. A frame's cost is
   * that times the march steps a ray takes, and fr-ybtq's field report is a
   * frame of 10184 rays with NINE hits and 2840 still active at the
   * preview's budget — a frame made of misses and grinders, not of hits.
   * Cost per ray is bounded by the march budget, so the question this leg
   * answers is: at what camera framing does a fold-lens system stop
   * terminating its rays cheaply and start spending the whole budget?
   *
   * The sweep moves the camera in along its own `visibleBoundingRadius`.
   * The app auto-frames from the POINT CLOUD's trimmed-quantile bounds
   * (`framing-bounds.ts`), which for a lens that inflates the visible set
   * can sit far inside the DE's own visible sphere — so small factors here
   * are not an exotic pose, they are what auto-framing produces when the
   * two radii disagree.
   */
  it("measures where march-step exhaustion, not per-call cost, takes over", () => {
    const FACTORS = [2.4, 1.2, 0.6, 0.3];
    const sweepProfiles = PROFILES.filter(
      (p) => p.name !== "lensBoxfoldOverTetra",
    );
    const lines: string[] = [];
    lines.push("");
    lines.push(
      `fr-ybtq MARCH-STEP EXHAUSTION vs CAMERA FRAMING — ${GRID_SIDE}x${GRID_SIDE} rays, ` +
        `full tier (${SURFACE_FULL_MARCH_STEPS} steps), gridless.`,
    );
    lines.push("");
    for (const profile of sweepProfiles) {
      const rows = FACTORS.map((f) => measure(profile, f));
      lines.push(`${profile.name} — ${profile.note}`);
      lines.push(
        `  visibleR = ${fmt(rows[0].visibleRadius, 3)}  boundingR = ${fmt(rows[0].boundingRadius, 3)}` +
          `  (visible/bounding = ${fmt(rows[0].visibleRadius / rows[0].boundingRadius, 2)}x)`,
      );
      lines.push(
        `  ${"dist".padStart(6)} ${"entered".padStart(8)} ${"hits".padStart(6)} ` +
          `${"exhausted".padStart(10)} ${"steps/ray".padStart(10)} ${"ms/ray".padStart(9)}`,
      );
      for (const r of rows) {
        const perRay = r.entered > 0 ? r.deCalls / r.entered : 0;
        const msPerRay = r.entered > 0 ? r.ms / r.entered : 0;
        lines.push(
          `  ${(fmt(r.distFactor, 1) + "x").padStart(6)} ${String(r.entered).padStart(8)} ` +
            `${String(r.hits).padStart(6)} ${String(r.exhausted).padStart(10)} ` +
            `${fmt(perRay, 1).padStart(10)} ${fmt(msPerRay, 2).padStart(9)}`,
        );
      }
      lines.push("");
    }
    console.log(lines.join("\n"));
    expect(lines.length).toBeGreaterThan(0);
  });
});
