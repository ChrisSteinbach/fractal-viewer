/**
 * fr-5wlv.1 spike harness: the balloon inverted-union DE.
 *
 * The fr-5wlv epic wants the attractor enclosed by its own sphere-inverted
 * echo — `I(p) = c + R²(p−c)/|p−c|²` through a balloon of radius `R`
 * centered at the attractor center `c` — with the scene the UNION of the
 * attractor `S` and its echo `S' = I(S)`. This harness measures whether
 * that is marchable with the SHIPPED estimators untouched, before any
 * app/kernel work.
 *
 * THE BOUND UNDER TEST. Inversion's exact distance distortion
 * `|I(a)−I(b)| = R²|a−b| / (|a−c||b−c|)` gives, for a query `p` against
 * the echo, with `a = I(p)` and `|I(p)−c| = R²/|p−c|`:
 *
 *     d(p, S') = |p−c| · inf_s |a−s|/|s−c|  >=  |p−c| · DE(I(p)) / rho
 *
 * where `rho` bounds the set's radius about `c`. So the wrapper is
 *
 *     DE_scene(p) = min( DE(p),  (|p−c|/rho) · DE(I(p)) )
 *
 * — conservative whenever `DE` is, certified relative to the same
 * bounding-ball provenance (`rho >= sup|s−c|`) the descent's own in-sphere
 * validity already stands on. `(c, rho)` is the DE's own ball: the fr-pjqw
 * probe-fit `(boundCenter, boundingRadius)` for plain systems, the
 * analytic `([0,0,0], visibleBoundingRadius)` for lens systems (the
 * balloon encloses the VISIBLE set, which is what both the estimator
 * measures distance to and the chaos game plots when handed the final).
 *
 * METHODOLOGY: surface-beam.harness.ts's, extended one set. Per system, a
 * seeded chaos-game cloud is the ground-truth sample of `S`; the reference
 * distance to the ECHO is computed through the exact identity itself —
 * `d(p, S'_sampled) = |p−c| · min_s |I(p)−s|/|s−c|` — over the SAME
 * cloud, never by inverting the f32-stored samples (inverting them would
 * amplify their ~1e-7 storage rounding by the local conformal factor
 * `R²/|s−c|²`; the identity form keeps the reference at plain f64/f32
 * noise). Since the cloud is a SUBSET of the set, both references
 * over-state their true distances, so `estimate > reference + 1e-9` is a
 * TRUE conservativeness violation (sampling can only hide violations,
 * never invent them). Section (0) pins the identity implementation itself
 * against directly-inverted f64 points, so the wrapper and the reference
 * cannot share a bug in `invert`. All RNG streams are seeded; results are
 * reproducible bit-for-bit.
 *
 * The sections answer the fr-5wlv.1 bead directly:
 *  (0) identity/involution self-check (hard assertions);
 *  (1) conservativeness (hard-zero on every off-set class; on-set probes
 *      read as EROSION, house style — see EXACT_EROSION discussion in
 *      surface-beam.harness.ts) + tightness (DE/D percentiles) + the
 *      provenance pre-check `sampleMax/rho <= 1` (hard: the certification
 *      input measured against a 37x denser cloud than the ball's probe);
 *  (2) march behavior: step counts/terminal mix through the union vs the
 *      plain field on the same rays, production estimator per class
 *      (fold -> base, affine/lens -> refined), cutoff early-exit engaged;
 *  (3) cost: invM apps (countingDE, the house machine-independent unit)
 *      and wall-clock per eval, union vs plain.
 *
 * R regimes, as multiples of `rho`: 0.35 (early inflation), 0.9
 * (mid-inflation interpenetration), 1.6 (rest — the fractal "fits well
 * within"). Mid-inflation is provably sound (a min of two conservative
 * bounds at ANY R) — what section (1) checks there is that the arithmetic
 * agrees, and sections (2)/(3) what the regime costs.
 *
 * MEASURED VERDICT (CLOUD=300k, RHO_MARGIN=1, recorded on fr-5wlv):
 * PROCEED.
 *  - CONSERVATIVENESS: 0 off-set violations across all 36 rows (6 systems
 *    x 3 R regimes x 2 estimators, 950 off-set queries per row), at
 *    margin 1 — the DE's own ball certifies the wrapper as-is at this
 *    sampling density. Identity self-check 1.75e-13, involution 8.6e-16.
 *  - PROVENANCE: sampleMax/ballR = 0.9521-0.9619 on every real-ball
 *    system at 37x the probe's density (lens analytic ball 0.5665) — the
 *    x1.05 pad holds with ~4% headroom. The production wrapper should
 *    still carry a small margin (the probe is 8192 points; density
 *    independence is measured here, not proven).
 *  - The ONE violation ever observed (CLOUD=60k dev run, mandelboxKifs
 *    refined j1@7.7e-4) attributed as plain-field: the estimator's
 *    disclosed width-bound tail at a query the house cube never sampled,
 *    reproduced on the UNMODIFIED surface-beam harness and filed as
 *    fr-tikz. Production fold paths march base; base columns are 0
 *    everywhere at both densities. fr-tikz has since re-gated the house
 *    harness onto the production row per class (this file's own shape)
 *    and re-sized its mandelboxKifs override for the base row (3e-3 ->
 *    1.2e-2, covering both recorded regimes).
 *  - EROSION TRANSPORTS, NEVER AMPLIFIES: exactShell de-amplified ==
 *    exactOuter (the same outer-decile attractor points, uninverted) on
 *    every row — spherefold pair 1.3e-3 both (0.077%R, the plain
 *    descent's own extremity tail, 13x its whole-attractor house tail —
 *    fr-tikz evidence, not a balloon defect), mandelboxKifs 1.1-1.8e-3
 *    both, inside its 3e-3 budget.
 *  - TIGHTNESS: union DE/D p50 at rest (R=1.6rho) — default .762/.794
 *    (base/refined), spiral .794/.821, boxfold sym3 .442, spherefold
 *    .243, mandelboxKifs .551/.579, lens .745/.785 — the plain field's
 *    own band; the shell term inherits each family's looseness class and
 *    adds no new one. deepVoid false hits at R>=0.9rho: 0-1 per row
 *    (spherefold 1/410 worst). At R=0.35rho (early inflation) the fold
 *    monsters go soft near the crumpled ball — mandelboxKifs 39-44/83 —
 *    the TRANSIENT the inflation animation must either ride out fast or
 *    disclose (rest state is what persists, and it is clean).
 *  - MARCH: 0 cap-outs in all 24 rows (600-step budget). Rest state:
 *    steps x1.25-2.06 over plain, apps/ray x1.40-3.21. Mid-inflation:
 *    x0.75-3.81 steps (the shell TERMINATES far-miss rays on
 *    mandelboxKifs — cheaper than plain). Early inflation worst: lens
 *    x6.45 steps, p95 215 — over the 160-step production full-tier
 *    budget, so the animation's transient regime needs tier-aware
 *    budgets even though the resting render fits (worst rest p95 131).
 *  - COST at value queries: x1.00-1.27 apps (the inner eval lands
 *    outside the ball for most queries and the sphere prunes kill it
 *    near-free; the naive 2x never materializes); the march-context
 *    ratios above are the real in-gap price. Wall tracks apps on the
 *    heavy systems (x0.93-1.04 where evals cost 80-2500us); sub-10us
 *    rows are timer/GC-noise-dominated and apps is the unit of record.
 *
 * Usage:
 *   npx vitest run --config scripts/vitest.harness.config.ts scripts/balloon-inversion.harness.ts
 *
 * Env knobs (defaults shown):
 *   CLOUD=300000 MARCH_RAYS=12 MARCH_STEPS=600
 *
 * Like the other harnesses, this file lives outside the main vitest
 * include and only runs via the harness config.
 */
import { runChaosGame } from "../src/fractal/chaos-game";
import type { ChaosGameResult } from "../src/fractal/chaos-game";
import {
  defaultTransforms,
  mandelboxKifs,
  spiral,
} from "../src/fractal/presets";
import { mulberry32 } from "../src/fractal/rng";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  deHasFolds,
  estimateDistance,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import type { SurfaceDE } from "../src/fractal/surface-de";
import type { SymmetryParams, Transform, Vec3 } from "../src/fractal/types";
import {
  countingDE,
  foldBoxfoldPair,
  foldSpherefoldPair,
} from "./harness-profiles";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const CLOUD = envInt("CLOUD", 300_000);
const MARCH_RAYS = envInt("MARCH_RAYS", 12);
const MARCH_STEPS = envInt("MARCH_STEPS", 600);

/** Balloon radii measured, as multiples of the ball radius `rho`:
 * early inflation, mid-inflation interpenetration, rest. */
const R_REGIMES = [0.35, 0.9, 1.6] as const;

/** The margin the wrapper multiplies onto the DE's ball radius before it
 * becomes the bound's `rho`. The shell bound DIVIDES by `rho`, so a `rho`
 * that under-covers the true attractor inflates the bound into genuine
 * overshoot — and the DE ball's radius is `probe.maxR * 1.05 + 1e-3` over
 * an 8192-point probe, which this harness's much denser cloud checks
 * directly (the `sampleMax/ballR` column). Default 1: measure the DE's
 * own ball as-is; the epic's production margin is DERIVED from what this
 * measures, not assumed. */
const BALLOON_RHO_MARGIN = envFloat("RHO_MARGIN", 1);

/** House violation threshold (surface-beam.harness.ts): excess above the
 * sampled reference that counts as a violation. */
const VIOLATION_EPS = 1e-9;

/** House deep-void band and marcher hit-test proxy, relative to `rho`
 * (surface-beam.harness.ts's DEEP_VOID_FACTOR / VOID_HIT_FACTOR). */
const DEEP_VOID_FACTOR = 0.15;
const VOID_HIT_FACTOR = 0.01;

/** House on-set erosion budgets, relative to `rho` — the `exact` and
 * `exactShell` classes sit ON the sampled sets, so any positive estimate
 * counts at the 1e-9 threshold and the column measures descent fp-noise,
 * not overshoot into void (see surface-beam.harness.ts's
 * EXACT_EROSION_BUDGET_R block for the full argument and the
 * mandelboxKifs disclosure). Report-only here — the spike's hard gate is
 * the off-set classes — but printed against these so the tables read
 * pass/fail at a glance. The house mandelboxKifs override has since been
 * re-sized (fr-tikz: 1.2e-2, gating the base row over both recorded
 * regimes); this file keeps the fr-2v0y-era 3e-3 its recorded readings
 * (1.1-1.8e-3) were measured against. */
const EXACT_EROSION_BUDGET_R = 1e-4;
const EXACT_EROSION_BUDGET_R_OVERRIDES: Record<string, number> = {
  "mandelboxKifs preset": 3e-3,
};

type EstimatorFn = (
  de: SurfaceDE,
  p: Vec3,
  cutoff?: number,
  footprint?: number,
) => number;

interface Ball {
  c: Vec3;
  rho: number;
}

interface Balloon extends Ball {
  R: number;
}

/** The ball the wrapper certifies against: the DE's own. Lens systems
 * (either final shape) descend to the VISIBLE set, so their ball is the
 * origin-centered visible bound; plain systems use the fr-pjqw fit. */
function balloonBall(de: SurfaceDE): Ball {
  if (de.final !== null || de.foldFinal !== null) {
    return { c: [0, 0, 0], rho: de.visibleBoundingRadius };
  }
  return { c: de.boundCenter, rho: de.boundingRadius };
}

/** `I(p) = c + R²(p−c)/|p−c|²`, `|p−c|` floored at `1e-12·rho` so a query
 * exactly at `c` maps far away instead of to NaN. */
function invert(b: Balloon, p: Vec3): Vec3 {
  const dx = p[0] - b.c[0];
  const dy = p[1] - b.c[1];
  const dz = p[2] - b.c[2];
  const floor = 1e-12 * b.rho;
  const r2 = Math.max(dx * dx + dy * dy + dz * dz, floor * floor);
  const s = (b.R * b.R) / r2;
  return [b.c[0] + s * dx, b.c[1] + s * dy, b.c[2] + s * dz];
}

/**
 * The wrapper under test: `min(DE(p), (|p−c|/rho)·DE(I(p)))` over the
 * UNTOUCHED public estimator. The shell term's cutoff scales by the
 * inverse of its value factor (`cutoff·rho/|p−c|`), so the fr-55r5
 * early-exit contract survives verbatim: the outer value crosses `cutoff`
 * exactly when the inner value crosses the scaled one.
 */
function balloonEstimate(
  fn: EstimatorFn,
  de: SurfaceDE,
  b: Balloon,
  p: Vec3,
  cutoff = 0,
): { d: number; shell: boolean } {
  const dFractal = fn(de, p, cutoff);
  const dx = p[0] - b.c[0];
  const dy = p[1] - b.c[1];
  const dz = p[2] - b.c[2];
  const r = Math.max(Math.hypot(dx, dy, dz), 1e-12 * b.rho);
  const scale = r / b.rho;
  const innerCutoff = cutoff > 0 ? cutoff / scale : 0;
  const dShell = scale * fn(de, invert(b, p), innerCutoff);
  return dShell < dFractal
    ? { d: dShell, shell: true }
    : { d: dFractal, shell: false };
}

type QueryClass =
  | "jittered"
  | "uniform"
  | "exact"
  | "nearShell"
  | "nearCenter"
  | "onSphere"
  | "exactShell"
  | "exactOuter";

/** Off-set classes: a violation here is a bound the marcher steps straight
 * through — the hard zero. `exact`/`exactShell` sit ON the sampled sets
 * and read as erosion instead. */
const HARD_CLASSES: QueryClass[] = [
  "jittered",
  "uniform",
  "nearShell",
  "nearCenter",
  "onSphere",
];

interface QueryB {
  p: Vec3;
  cls: QueryClass;
  /** `|p−c|`, kept for `exactShell` de-amplification: the shell term
   * scales the estimator's on-set erosion by `|p−c|/rho`, so comparing
   * against the house budgets means dividing it back out. */
  rq: number;
}

type UnitRng = () => number;

function unitDir(rng: UnitRng): Vec3 {
  const z = 2 * rng() - 1;
  const t = 2 * Math.PI * rng();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(t), r * Math.sin(t), z];
}

interface SystemB {
  label: string;
  transforms: Transform[];
  final?: Transform;
  symmetry?: SymmetryParams;
}

/** Per-system ground context, R-independent: the cloud, the wrapper's
 * ball, per-sample `|s−c|²` (f64, reused by every shell reference scan),
 * and the provenance measurement `sampleMax`. */
interface Ground {
  de: SurfaceDE;
  cloud: ChaosGameResult;
  ball: Ball;
  sCenterSq: Float64Array;
  sampleMax: number;
  /** 90th-percentile `|s−c|` — the `nearShell`/`exactShell` classes seed
   * from samples above this, whose images form the cave's nearest wall. */
  decile: number;
}

function ground(sys: SystemB): Ground {
  const de = buildSurfaceDE(
    sys.transforms,
    sys.final ?? null,
    sys.symmetry ?? { order: 1, plane: "xz" },
  );
  const cloud = runChaosGame(
    sys.transforms,
    CLOUD,
    mulberry32(101),
    sys.final ?? null,
    sys.symmetry ?? { order: 1, plane: "xz" },
  );
  const rawBall = balloonBall(de);
  const sCenterSq = new Float64Array(cloud.count);
  const radii = new Float64Array(cloud.count);
  let maxSq = 0;
  for (let i = 0; i < cloud.count; i++) {
    const dx = cloud.positions[i * 3] - rawBall.c[0];
    const dy = cloud.positions[i * 3 + 1] - rawBall.c[1];
    const dz = cloud.positions[i * 3 + 2] - rawBall.c[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    sCenterSq[i] = d2;
    radii[i] = d2;
    if (d2 > maxSq) maxSq = d2;
  }
  radii.sort();
  return {
    de,
    cloud,
    // The wrapper's rho carries the provenance margin (see
    // BALLOON_RHO_MARGIN); sampleMax below is measured against the RAW
    // ball so the provenance table stays a statement about the DE's own
    // numbers.
    ball: { c: rawBall.c, rho: rawBall.rho * BALLOON_RHO_MARGIN },
    sCenterSq,
    sampleMax: Math.sqrt(maxSq),
    decile: Math.sqrt(radii[Math.floor(cloud.count * 0.9)]),
  };
}

/** House query mix (jittered/uniform/exact, house seeds and sizes) plus
 * the balloon classes; `nearShell`/`onSphere`/`exactShell` depend on `R`.
 * All seeds fixed, so regimes differ only where geometry does. */
function buildQueries(g: Ground, R: number): QueryB[] {
  const { cloud, ball } = g;
  const out: QueryB[] = [];
  const push = (p: Vec3, cls: QueryClass): void => {
    out.push({
      p,
      cls,
      rq: Math.hypot(p[0] - ball.c[0], p[1] - ball.c[1], p[2] - ball.c[2]),
    });
  };
  const jitterRng = mulberry32(2);
  const stride = Math.max(1, Math.floor(cloud.count / 400));
  let jittered = 0;
  for (let i = 0; i < cloud.count && jittered < 400; i += stride) {
    push(
      [
        cloud.positions[i * 3] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 1] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 2] + (jitterRng() - 0.5) * 0.3,
      ],
      "jittered",
    );
    jittered++;
  }
  const uniformRng = mulberry32(3);
  const half = 1.2 * ball.rho;
  for (let i = 0; i < 200; i++) {
    push(
      [
        ball.c[0] + (uniformRng() - 0.5) * 2 * half,
        ball.c[1] + (uniformRng() - 0.5) * 2 * half,
        ball.c[2] + (uniformRng() - 0.5) * 2 * half,
      ],
      "uniform",
    );
  }
  for (let i = 0; i < 100; i++) {
    const j = Math.floor((cloud.count * (i + 0.5)) / 100);
    push(
      [
        cloud.positions[j * 3],
        cloud.positions[j * 3 + 1],
        cloud.positions[j * 3 + 2],
      ],
      "exact",
    );
  }
  const balloon: Balloon = { ...ball, R };
  // Top-decile samples invert to the cave's nearest, densest-sampled wall.
  const shellRng = mulberry32(5);
  const pickTopDecile = (): Vec3 => {
    for (;;) {
      const i = Math.floor(shellRng() * cloud.count);
      if (g.sCenterSq[i] >= g.decile * g.decile) {
        return [
          cloud.positions[i * 3],
          cloud.positions[i * 3 + 1],
          cloud.positions[i * 3 + 2],
        ];
      }
    }
  };
  for (let i = 0; i < 150; i++) {
    const q = invert(balloon, pickTopDecile());
    const dir = unitDir(shellRng);
    const mag = (0.01 + 0.24 * shellRng()) * ball.rho;
    push(
      [q[0] + dir[0] * mag, q[1] + dir[1] * mag, q[2] + dir[2] * mag],
      "nearShell",
    );
  }
  const centerRng = mulberry32(6);
  for (let i = 0; i < 100; i++) {
    const dir = unitDir(centerRng);
    const mag = Math.pow(10, -4 + 3.5 * centerRng()) * ball.rho;
    push(
      [
        ball.c[0] + dir[0] * mag,
        ball.c[1] + dir[1] * mag,
        ball.c[2] + dir[2] * mag,
      ],
      "nearCenter",
    );
  }
  const sphereRng = mulberry32(7);
  for (let i = 0; i < 100; i++) {
    const dir = unitDir(sphereRng);
    push(
      [ball.c[0] + dir[0] * R, ball.c[1] + dir[1] * R, ball.c[2] + dir[2] * R],
      "onSphere",
    );
  }
  // exactShell and its CONTROL, from the SAME selected samples: the shell
  // probe is `I(s)` and the control is the raw `s` — so the exactShell
  // column's de-amplified erosion can be read against what the plain
  // descent already erodes at that exact outer-decile attractor point
  // (the house exact class spreads over the WHOLE attractor; the fr-pjqw
  // record shows the on-set tail is ball-geometry-sensitive, so an
  // extremity-only probe set needs its own extremity-only baseline).
  const exactShellRng = mulberry32(8);
  for (let i = 0; i < 60; i++) {
    for (;;) {
      const j = Math.floor(exactShellRng() * cloud.count);
      if (g.sCenterSq[j] >= g.decile * g.decile) {
        const s: Vec3 = [
          cloud.positions[j * 3],
          cloud.positions[j * 3 + 1],
          cloud.positions[j * 3 + 2],
        ];
        push(invert(balloon, s), "exactShell");
        push(s, "exactOuter");
        break;
      }
    }
  }
  return out;
}

/** Brute-force nearest sample of `S` (house `nearest3`). */
function nearestPlain(cloud: ChaosGameResult, p: Vec3): number {
  let best = Infinity;
  const pos = cloud.positions;
  for (let i = 0; i < cloud.count; i++) {
    const dx = pos[i * 3] - p[0];
    const dy = pos[i * 3 + 1] - p[1];
    const dz = pos[i * 3 + 2] - p[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/**
 * Brute-force nearest INVERTED sample, through the exact identity:
 * `min_s |p−I(s)| = |p−c| · min_s |I(p)−s|/|s−c|`. The min avoids a
 * division per sample by testing `d2 < bestRatio·|s−c|²` first; a sample
 * at `c` itself (`|s−c|² = 0`) can never win the min — its image is at
 * infinity — and falls out of both comparisons naturally.
 */
function nearestShell(g: Ground, b: Balloon, p: Vec3): number {
  const a = invert(b, p);
  const pos = g.cloud.positions;
  const sq = g.sCenterSq;
  let bestRatio = Infinity;
  for (let i = 0; i < g.cloud.count; i++) {
    const dx = pos[i * 3] - a[0];
    const dy = pos[i * 3 + 1] - a[1];
    const dz = pos[i * 3 + 2] - a[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestRatio * sq[i]) bestRatio = d2 / sq[i];
  }
  const rp = Math.max(
    Math.hypot(p[0] - b.c[0], p[1] - b.c[1], p[2] - b.c[2]),
    1e-12 * b.rho,
  );
  return rp * Math.sqrt(bestRatio);
}

interface ClassStats {
  n: number;
  violations: number;
  maxExcess: number;
}

interface RowB {
  byClass: Record<QueryClass, ClassStats>;
  hardViolations: number;
  hardMaxExcess: number;
  /** `exactShell` erosion with the shell scale divided back out —
   * comparable to the house `exact` budgets. */
  exactShellDeamp: number;
  p10: number;
  p50: number;
  p90: number;
  nRatios: number;
  shellWins: number;
  deepVoidProbes: number;
  deepVoidFalseHits: number;
  meanApps: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function collectB(
  estimates: { d: number; shell: boolean }[],
  qs: QueryB[],
  dUnion: number[],
  rho: number,
  apps: number,
): RowB {
  const byClass = {} as Record<QueryClass, ClassStats>;
  for (const cls of [
    ...HARD_CLASSES,
    "exact",
    "exactShell",
    "exactOuter",
  ] as const) {
    byClass[cls] = { n: 0, violations: 0, maxExcess: 0 };
  }
  const ratios: number[] = [];
  let shellWins = 0;
  let deepVoidProbes = 0;
  let deepVoidFalseHits = 0;
  let exactShellDeamp = 0;
  for (let i = 0; i < estimates.length; i++) {
    const est = estimates[i].d;
    const d = dUnion[i];
    const q = qs[i];
    const cls = byClass[q.cls];
    cls.n++;
    if (est > d + VIOLATION_EPS) {
      cls.violations++;
      const excess = est - d;
      cls.maxExcess = Math.max(cls.maxExcess, excess);
      if (q.cls === "exactShell") {
        exactShellDeamp = Math.max(
          exactShellDeamp,
          excess * (rho / Math.max(q.rq, 1e-12 * rho)),
        );
      }
    }
    if (estimates[i].shell) shellWins++;
    if (d > 0.01) ratios.push(est / d);
    if (d > DEEP_VOID_FACTOR * rho) {
      deepVoidProbes++;
      if (est < VOID_HIT_FACTOR * rho) deepVoidFalseHits++;
    }
  }
  ratios.sort((a, b) => a - b);
  let hardViolations = 0;
  let hardMaxExcess = 0;
  for (const cls of HARD_CLASSES) {
    hardViolations += byClass[cls].violations;
    hardMaxExcess = Math.max(hardMaxExcess, byClass[cls].maxExcess);
  }
  return {
    byClass,
    hardViolations,
    hardMaxExcess,
    exactShellDeamp,
    p10: percentile(ratios, 0.1),
    p50: percentile(ratios, 0.5),
    p90: percentile(ratios, 0.9),
    nRatios: ratios.length,
    shellWins,
    deepVoidProbes,
    deepVoidFalseHits,
    meanApps: apps / estimates.length,
  };
}

function fmtRow(r: RowB, rho: number, budgetR: number): string {
  const cls = (s: ClassStats): string =>
    s.violations === 0
      ? "0"
      : `${s.violations}@${s.maxExcess.toExponential(1)}`;
  const b = r.byClass;
  const total =
    b.jittered.n +
    b.uniform.n +
    b.exact.n +
    b.nearShell.n +
    b.nearCenter.n +
    b.onSphere.n +
    b.exactShell.n +
    b.exactOuter.n;
  const worstErosion = Math.max(
    b.exact.maxExcess,
    b.exactOuter.maxExcess,
    r.exactShellDeamp,
  );
  return (
    `viol j${cls(b.jittered)}/u${cls(b.uniform)}/nS${cls(b.nearShell)}` +
    `/nC${cls(b.nearCenter)}/oS${cls(b.onSphere)}` +
    ` ero e${cls(b.exact)}/eO${cls(b.exactOuter)}` +
    ` eS${b.exactShell.violations}@${r.exactShellDeamp.toExponential(1)}d` +
    ` | DE/D p10/50/90=${r.p10.toFixed(3)}/${r.p50.toFixed(3)}/${r.p90.toFixed(3)}` +
    ` shell=${((r.shellWins / total) * 100).toFixed(0)}%` +
    ` deepVoid=${r.deepVoidFalseHits}/${r.deepVoidProbes}` +
    ` apps=${r.meanApps.toFixed(1)}` +
    ` eroOK=${worstErosion <= budgetR * rho ? "y" : "OVER"}`
  );
}

/** fr-g58b lens archetype for the wrapper's lens coverage: affine base
 * maps under a pure-boxfold FINAL — the descent runs `descendLens`, the
 * ball is the analytic visible bound. */
function lensArchetype(): SystemB {
  return {
    label: "default + boxfold lens",
    transforms: defaultTransforms(),
    final: {
      id: 99,
      position: [0.15, -0.1, 0.05],
      rotation: [0.25, 0.4, 0.1],
      scale: [0.85, 0.85, 0.85],
      variations: [{ type: "boxfold", weight: 1 }],
    },
  };
}

const SYSTEMS: SystemB[] = [
  { label: "default", transforms: defaultTransforms() },
  { label: "spiral", transforms: spiral() },
  {
    label: "boxfold pair x sym3y",
    transforms: foldBoxfoldPair(),
    symmetry: { order: 3, plane: "xz" },
  },
  { label: "spherefold pair", transforms: foldSpherefoldPair() },
  { label: "mandelboxKifs preset", transforms: mandelboxKifs() },
  lensArchetype(),
];

describe("fr-5wlv.1 balloon inversion harness", () => {
  it("(0) inversion identity + involution self-check", () => {
    // Synthetic ball, seeded points spanning [1e-4, 10]·rho shells: the
    // identity `|p−I(s)| = |p−c|·|I(p)−s|/|s−c|` must hold to f64
    // roundoff, with the LEFT side computed by direct inversion of s —
    // so the reference scan (identity form) and the wrapper (direct
    // form) are pinned against each other here, not shared.
    const b: Balloon = { c: [0.3, -0.2, 0.1], rho: 1.7, R: 2.3 };
    const rng = mulberry32(42);
    let worstIdentity = 0;
    let worstInvolution = 0;
    for (let i = 0; i < 20_000; i++) {
      const dp = unitDir(rng);
      const ds = unitDir(rng);
      const rp = Math.pow(10, -4 + 5 * rng()) * b.rho;
      const rs = Math.pow(10, -4 + 5 * rng()) * b.rho;
      const p: Vec3 = [
        b.c[0] + dp[0] * rp,
        b.c[1] + dp[1] * rp,
        b.c[2] + dp[2] * rp,
      ];
      const s: Vec3 = [
        b.c[0] + ds[0] * rs,
        b.c[1] + ds[1] * rs,
        b.c[2] + ds[2] * rs,
      ];
      const is = invert(b, s);
      const direct = Math.hypot(p[0] - is[0], p[1] - is[1], p[2] - is[2]);
      const a = invert(b, p);
      const viaIdentity =
        (rp * Math.hypot(a[0] - s[0], a[1] - s[1], a[2] - s[2])) / rs;
      const scale = Math.max(direct, viaIdentity, 1e-300);
      worstIdentity = Math.max(
        worstIdentity,
        Math.abs(direct - viaIdentity) / scale,
      );
      const back = invert(b, invert(b, p));
      worstInvolution = Math.max(
        worstInvolution,
        Math.hypot(back[0] - p[0], back[1] - p[1], back[2] - p[2]) /
          Math.max(rp, 1e-300),
      );
    }
    console.log(
      `\n== (0) identity self-check: worst relative identity error ` +
        `${worstIdentity.toExponential(2)}, worst involution error ` +
        `${worstInvolution.toExponential(2)} over 20k seeded pairs ==`,
    );
    expect(worstIdentity).toBeLessThan(1e-9);
    expect(worstInvolution).toBeLessThan(1e-9);
  });

  it("(1) conservativeness + tightness across systems x R regimes", () => {
    console.log(
      `\n== (1) balloon union DE (CLOUD=${CLOUD},` +
        ` rhoMargin=${BALLOON_RHO_MARGIN}) ==`,
    );
    const failures: string[] = [];
    for (const sys of SYSTEMS) {
      const analysis = analyzeSurfaceSystem(sys.transforms, sys.final ?? null);
      if (analysis.status === "ineligible") {
        console.log(
          `-- ${sys.label}: INELIGIBLE (${analysis.reasons.join("; ")})`,
        );
        failures.push(`${sys.label}: unexpectedly ineligible`);
        continue;
      }
      const g = ground(sys);
      const provenance = g.sampleMax / (g.ball.rho / BALLOON_RHO_MARGIN);
      console.log(
        `-- ${sys.label}: baseMaps=${g.de.maps.length}x${g.de.symmetry.order}` +
          ` status=${analysis.status}` +
          ` ballR=${(g.ball.rho / BALLOON_RHO_MARGIN).toFixed(4)}` +
          ` |c|=${Math.hypot(...g.ball.c).toFixed(3)}` +
          ` sampleMax/ballR=${provenance.toFixed(4)}` +
          `${provenance > 1 ? " <-- PROVENANCE GAP (margin must cover)" : ""}`,
      );
      if (g.sampleMax > g.ball.rho) {
        failures.push(
          `${sys.label}: provenance gap NOT covered by margin — ` +
            `sampleMax=${g.sampleMax.toFixed(4)} > ` +
            `rho(margined)=${g.ball.rho.toFixed(4)}`,
        );
      }
      for (const rMult of R_REGIMES) {
        const R = rMult * (g.ball.rho / BALLOON_RHO_MARGIN);
        const balloon: Balloon = { ...g.ball, R };
        const qs = buildQueries(g, R);
        const dUnion = qs.map((q) =>
          Math.min(nearestPlain(g.cloud, q.p), nearestShell(g, balloon, q.p)),
        );
        const shellInner = (R * R) / g.sampleMax;
        console.log(
          `   [R=${rMult}rho shellInner=${(shellInner / (g.ball.rho / BALLOON_RHO_MARGIN)).toFixed(2)}rho]`,
        );
        // The production estimator for this system class: fold systems
        // march `base` (the estimator the fold GLSL/WGSL cores mirror,
        // fr-aj4w/fr-q1f8); affine and lens systems march `refined`.
        const prodName = deHasFolds(g.de) ? "base" : "refined";
        for (const [name, fn] of [
          ["base", estimateDistance],
          ["refined", estimateDistanceRefined],
        ] as const) {
          const { de: counted, counter } = countingDE(g.de, g.de.beamWidth);
          const estimates = qs.map((q) =>
            balloonEstimate(fn, counted, balloon, q.p),
          );
          const row = collectB(estimates, qs, dUnion, balloon.rho, counter.n);
          const budget =
            EXACT_EROSION_BUDGET_R_OVERRIDES[sys.label] ??
            EXACT_EROSION_BUDGET_R;
          console.log(
            `     ${name.padEnd(7)}: ${fmtRow(row, balloon.rho, budget)}`,
          );
          if (row.hardViolations > 0) {
            // ATTRIBUTION (the bead's "report which"): a union violation
            // means both estimate terms exceed dUnion; the responsible
            // side is the one whose OWN reference is the min — plain-field
            // (`estF > dPlain`, the balloon merely re-measured the plain
            // estimator at a new query) vs shell-term (`estS > dShell`,
            // the wrapper's bound — an implementation or provenance
            // problem). Shell-term always fails; plain-field fails only
            // on the production row and is otherwise disclosed alongside
            // the house harness's known refined-fold width-bound tail —
            // which is exactly what the one measured instance was:
            // mandelboxKifs refined j1@7.7e-4 at CLOUD=60k, reproduced on
            // the UNMODIFIED surface-beam harness and filed as fr-tikz
            // (the tail is not exact-class-only — fr-tikz corrected the
            // record and re-gated the house harness onto the production
            // row; production fold paths march base, whose columns stay
            // 0).
            for (let i = 0; i < qs.length; i++) {
              const q = qs[i];
              if (!HARD_CLASSES.includes(q.cls)) continue;
              if (estimates[i].d <= dUnion[i] + VIOLATION_EPS) continue;
              const dPlain = nearestPlain(g.cloud, q.p);
              const dShell = nearestShell(g, balloon, q.p);
              const estF = fn(g.de, q.p);
              const scale =
                Math.max(
                  Math.hypot(
                    q.p[0] - balloon.c[0],
                    q.p[1] - balloon.c[1],
                    q.p[2] - balloon.c[2],
                  ),
                  1e-12 * balloon.rho,
                ) / balloon.rho;
              const estS = scale * fn(g.de, invert(balloon, q.p));
              const plainSide = estF > dPlain + VIOLATION_EPS;
              const shellSide = estS > dShell + VIOLATION_EPS;
              const kind = shellSide
                ? "SHELL-TERM"
                : plainSide
                  ? "plain-field"
                  : "unattributed";
              console.log(
                `     !! viol cls=${q.cls} |p-c|=${(q.rq / balloon.rho).toFixed(2)}rho` +
                  ` dPlain=${dPlain.toFixed(6)} dShell=${dShell.toFixed(6)}` +
                  ` estF=${estF.toFixed(6)} estS=${estS.toFixed(6)}` +
                  ` -> ${kind}`,
              );
              if (kind !== "plain-field" || name === prodName) {
                failures.push(
                  `${sys.label} R=${rMult}rho ${name}: ${kind} violation` +
                    ` cls=${q.cls}` +
                    ` excess=${(estimates[i].d - dUnion[i]).toExponential(2)}` +
                    `${provenance > 1 ? " (provenance gap present)" : ""}`,
                );
              } else {
                console.log(
                  `        ^ disclosed: pre-existing ${name}-estimator` +
                    ` plain-field tail on a non-production row (fold` +
                    ` systems march base); the balloon wrapper did not` +
                    ` cause it.`,
                );
              }
            }
          }
          const worstErosion = Math.max(
            row.byClass.exact.maxExcess,
            row.byClass.exactOuter.maxExcess,
            row.exactShellDeamp,
          );
          if (worstErosion > budget * balloon.rho) {
            // Report-only (house reads erosion via maxExcess): printed
            // loudly so the verdict can't miss it, but not a gate — the
            // bead's gate is the off-set classes.
            console.log(
              `     ^^ EROSION OVER HOUSE BUDGET: ` +
                `${worstErosion.toExponential(2)} > ` +
                `${(budget * balloon.rho).toExponential(2)}`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  }, 900_000);

  it("(2) march behavior: union vs plain on the same rays", () => {
    console.log(
      `\n== (2) march: ${MARCH_RAYS}x${MARCH_RAYS} rays, camera at` +
        ` 1.35rho, eps=1e-3rho, tFar=cam+10rho, maxSteps=${MARCH_STEPS},` +
        ` production estimator per class, cutoff engaged ==`,
    );
    for (const sys of SYSTEMS) {
      const analysis = analyzeSurfaceSystem(sys.transforms, sys.final ?? null);
      if (analysis.status === "ineligible") continue;
      const g = ground(sys);
      const rho = g.ball.rho / BALLOON_RHO_MARGIN;
      const fn: EstimatorFn = deHasFolds(g.de)
        ? estimateDistance
        : estimateDistanceRefined;
      const eps = 1e-3 * rho;
      const camDir = ((): Vec3 => {
        const n = Math.hypot(0.9, 0.55, 0.75);
        return [0.9 / n, 0.55 / n, 0.75 / n];
      })();
      const cam: Vec3 = [
        g.ball.c[0] + camDir[0] * 1.35 * rho,
        g.ball.c[1] + camDir[1] * 1.35 * rho,
        g.ball.c[2] + camDir[2] * 1.35 * rho,
      ];
      const tFar = 1.35 * rho + 10 * rho;
      const fwd: Vec3 = [-camDir[0], -camDir[1], -camDir[2]];
      const right = ((): Vec3 => {
        const rx = fwd[1] * 0 - fwd[2] * 1;
        const ry = fwd[2] * 0 - fwd[0] * 0;
        const rz = fwd[0] * 1 - fwd[1] * 0;
        const n = Math.hypot(rx, ry, rz);
        return [rx / n, ry / n, rz / n];
      })();
      const upv: Vec3 = [
        right[1] * fwd[2] - right[2] * fwd[1],
        right[2] * fwd[0] - right[0] * fwd[2],
        right[0] * fwd[1] - right[1] * fwd[0],
      ];
      const tanHalf = Math.tan(Math.PI / 6);
      const rays: Vec3[] = [];
      for (let iy = 0; iy < MARCH_RAYS; iy++) {
        for (let ix = 0; ix < MARCH_RAYS; ix++) {
          const nx = ((ix + 0.5) / MARCH_RAYS) * 2 - 1;
          const ny = ((iy + 0.5) / MARCH_RAYS) * 2 - 1;
          const dx = fwd[0] + tanHalf * (nx * right[0] + ny * upv[0]);
          const dy = fwd[1] + tanHalf * (nx * right[1] + ny * upv[1]);
          const dz = fwd[2] + tanHalf * (nx * right[2] + ny * upv[2]);
          const n = Math.hypot(dx, dy, dz);
          rays.push([dx / n, dy / n, dz / n]);
        }
      }
      const march = (
        balloon: Balloon | null,
      ): {
        hitF: number;
        hitS: number;
        far: number;
        cap: number;
        stepsMean: number;
        stepsP95: number;
        appsPerRay: number;
      } => {
        const { de: counted, counter } = countingDE(g.de, g.de.beamWidth);
        let hitF = 0;
        let hitS = 0;
        let far = 0;
        let cap = 0;
        const stepCounts: number[] = [];
        for (const dir of rays) {
          let t = 0;
          let steps = 0;
          let status: "hitF" | "hitS" | "far" | "cap" = "cap";
          while (steps < MARCH_STEPS) {
            const p: Vec3 = [
              cam[0] + dir[0] * t,
              cam[1] + dir[1] * t,
              cam[2] + dir[2] * t,
            ];
            const e = balloon
              ? balloonEstimate(fn, counted, balloon, p, eps)
              : { d: fn(counted, p, eps), shell: false };
            steps++;
            if (e.d < eps) {
              status = e.shell ? "hitS" : "hitF";
              break;
            }
            t += e.d * g.de.stepScale;
            if (t > tFar) {
              status = "far";
              break;
            }
          }
          if (status === "hitF") hitF++;
          else if (status === "hitS") hitS++;
          else if (status === "far") far++;
          else cap++;
          stepCounts.push(steps);
        }
        stepCounts.sort((a, b) => a - b);
        const mean =
          stepCounts.reduce((acc, s) => acc + s, 0) / stepCounts.length;
        return {
          hitF,
          hitS,
          far,
          cap,
          stepsMean: mean,
          stepsP95: percentile(stepCounts, 0.95),
          appsPerRay: counter.n / rays.length,
        };
      };
      const fmt = (m: ReturnType<typeof march>): string =>
        `hitF ${m.hitF} hitS ${m.hitS} far ${m.far} cap ${m.cap}` +
        ` | steps mu ${m.stepsMean.toFixed(1)} p95 ${m.stepsP95}` +
        ` | apps/ray ${m.appsPerRay.toFixed(0)}`;
      console.log(
        `-- ${sys.label} (${deHasFolds(g.de) ? "base/fold" : "refined"}):`,
      );
      const plain = march(null);
      console.log(`   plain     : ${fmt(plain)}`);
      for (const rMult of R_REGIMES) {
        const m = march({ ...g.ball, R: rMult * rho });
        console.log(
          `   R=${String(rMult).padEnd(4)}rho: ${fmt(m)}` +
            ` | x plain: steps ${(m.stepsMean / plain.stepsMean).toFixed(2)}` +
            ` apps ${(m.appsPerRay / plain.appsPerRay).toFixed(2)}` +
            `${m.cap > 0 ? " <-- CAP-OUTS (march creep)" : ""}`,
        );
      }
    }
    expect(true).toBe(true);
  }, 900_000);

  it("(3) cost per eval: union vs plain", () => {
    console.log(
      `\n== (3) cost (200 jittered+uniform queries, wall = min of 3 reps,` +
        ` R=1.6rho) ==`,
    );
    for (const sys of SYSTEMS) {
      const analysis = analyzeSurfaceSystem(sys.transforms, sys.final ?? null);
      if (analysis.status === "ineligible") continue;
      const g = ground(sys);
      const rho = g.ball.rho / BALLOON_RHO_MARGIN;
      const balloon: Balloon = { ...g.ball, R: 1.6 * rho };
      const qs = buildQueries(g, balloon.R)
        .filter((q) => q.cls === "jittered" || q.cls === "uniform")
        .slice(0, 200);
      const lines: string[] = [];
      for (const [name, fn] of [
        ["base", estimateDistance],
        ["refined", estimateDistanceRefined],
      ] as const) {
        const timed = (union: boolean): { apps: number; ns: number } => {
          const { de: counted, counter } = countingDE(g.de, g.de.beamWidth);
          // One untimed warmup lap first: the very first pass through a
          // system x estimator pays JIT/IC warmup that showed up as a
          // spurious sub-1x wall ratio on the cheapest system.
          for (const q of qs) {
            if (union) balloonEstimate(fn, counted, balloon, q.p);
            else fn(counted, q.p);
          }
          counter.n = 0;
          let best = Infinity;
          for (let rep = 0; rep < 3; rep++) {
            const t0 = process.hrtime.bigint();
            for (const q of qs) {
              if (union) balloonEstimate(fn, counted, balloon, q.p);
              else fn(counted, q.p);
            }
            const dt = Number(process.hrtime.bigint() - t0);
            if (dt < best) best = dt;
          }
          return { apps: counter.n / 3 / qs.length, ns: best / qs.length };
        };
        const plain = timed(false);
        const union = timed(true);
        lines.push(
          `${name}: plain ${plain.apps.toFixed(1)} apps` +
            ` ${(plain.ns / 1000).toFixed(1)}us | union` +
            ` ${union.apps.toFixed(1)} apps ${(union.ns / 1000).toFixed(1)}us` +
            ` (x${(union.apps / plain.apps).toFixed(2)} apps,` +
            ` x${(union.ns / plain.ns).toFixed(2)} wall)`,
        );
      }
      console.log(`-- ${sys.label}: ${lines.join(" ; ")}`);
    }
    expect(true).toBe(true);
  }, 900_000);
});
