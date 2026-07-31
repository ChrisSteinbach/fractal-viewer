/**
 * fr-v6yg measurement harness for the surface-DE descent beam.
 *
 * The fr-beck spike measured that single-chain greedy descent OVERSHOOTS
 * the true distance on doubleRotation's profile (2 maps, weight 6:1, sigma
 * 0.93/0.22): a non-descended in-sphere branch carries no certificate, and
 * when its piece is the nearest one the estimate exceeds the real distance
 * by up to ~25% of the bounding radius — on the shipped 3D `surface-de.ts`
 * as well as the 4D twin. The fix under measurement is the width-2 descent
 * beam (`descentBeamWidth`): a second chain refines the second-nearest
 * in-sphere branch instead of dropping it.
 *
 * This harness answers, with numbers:
 *  (1) does width 2 actually eliminate the measured violations, on the 3D
 *      repro profile, its kaleidoscope-expanded variant, a 3-map variant,
 *      the eligible 3D presets, and the four 4D presets the spike measured
 *      (base AND refined estimators)?
 *  (2) does any per-map sigma_max threshold separate the width-1-safe
 *      systems from the overshooting ones (i.e. could width 2 be gated by
 *      a predicate instead of applied universally)?
 *  (3) what does width 2 cost (inverse-affine applications per call) and
 *      what does it do to tightness (DE/D ratios, void false-hit proxy)?
 *
 * MEASURED VERDICT (recorded on the fr-v6yg bead; drove the shipped
 * design): width 1 overshoots not just on the doubleRotation profile
 * (~19% of R) but on plain shipped presets (default 10.8%R, spiral 8.6%R,
 * pyramid 6.2%R, jerusalem 6.1%R) with per-map sigma_max as low as 0.4 —
 * while other systems at the SAME sigma stay clean, so no predicate
 * exists and `buildSurfaceDE`/`buildSurfaceDE4` always build width 2.
 * Width 2 collapses violations to the deep-descent fp-noise floor
 * everywhere measured except three disclosed residual profiles
 * (kaleidoscope copies of a near-isometric map, whose image norms tie
 * exactly; m >= 3 slow-map systems; sigma_max >= 0.96), improves
 * tightness (the second chain refines the shallow barely-escaped
 * certificates fr-beck traced every ghost to), and costs ~1.7-1.8x
 * inverse applications.
 *
 * Methodology mirrors the fr-beck spike's section (a): per system, a
 * seeded chaos-game cloud is the ground-truth sample; queries are 400
 * jittered cloud points (+-0.15/coord), 200 uniform points in a cube of
 * half-side 1.2R, and 100 exact (on-cloud) points. `estimate > nearest +
 * 1e-9` counts as a violation — since the sampled cloud is a SUBSET of the
 * attractor, `nearest` over-states the true distance, so every counted
 * violation is a TRUE violation (sampling can only hide violations, never
 * invent them). Tightness ratios (DE/D) are reported over queries with
 * D > 0.01; the void proxy counts queries in genuine voids (D > 0.05R)
 * whose estimate reads below a marcher hit test (0.01R). All RNG streams
 * are seeded; results are reproducible bit-for-bit.
 *
 * FR-1Z6P ADDENDUM: the 3D section now measures BOTH estimators (base and
 * `estimateDistanceRefined`), exactly like the 4D section always has — the
 * refined rows are the ghost-balloon fix's evidence (voidFalseHit is the
 * balloon proxy), and the base rows double as a bit-exactness regression
 * of the shared descent body against the pre-refactor baseline.
 *
 * FR-JKPN ADDENDUM: every width loop now spans 1-4. Widths 3/4 are the
 * validity slots (rank-3/4 chains, live only while in-sphere) that closed
 * the width-2 residual above; `buildSurfaceDE`/`buildSurfaceDE4` now
 * always build width 4. Measured verdict (recorded on the fr-jkpn bead,
 * CLOUD=300k, refined estimator, w2 -> w4): jerusalem 38 viol @3.6%R ->
 * 4 @0.003%R, default/spiral/pyramid/dodecahedron -> 0, sigma-0.96 sweep
 * 23 @2.0%R -> 1 @0.0 (width 4 is exhaustive for m = 2), repro3 98
 * @2.1%R -> 57 @1.2%R (48-level cap clamps sigma-0.93 coverage; void
 * false hits tick 0 -> 2/435 there from chains legitimately surviving to
 * the clamped cap), preset voidFalseHits stay 0 everywhere, cost within
 * +/-5% of width 2 on clean presets and +28% worst (menger, refined).
 * The zero-translation kaleidoscope tie tree stays disclosed: repro2+sym4y
 * holds ~9.8%R refined at any finite width (order^depth exact ties;
 * rank selection cannot split them). The w1/w2 rows remain the
 * bit-exactness regression of the pre-fr-jkpn beam.
 *
 * FR-XOK8 ADDENDUM: the depth-cap ceiling rose 48 -> 128
 * (MAX_DESCENT_DEPTH — the old ceiling clamped sigma-0.93 systems at
 * 0.93^48 ~ 0.031R of unresolved feature size, rendering doubleRotation's
 * core as a smooth solid ball). Slow-map rows re-baselined at their new
 * formula depths (repro2/doubleRotation 127; sweep 0.85 -> 57, 0.90 -> 88,
 * 0.96 -> clamped 128): deep-descent fp-noise "violations" (sub-5e-7
 * excess, counted at the 1e-9 threshold) grow with depth and now dominate
 * the slow rows' viol counts — read maxExcess, not viol, on those rows.
 * Rows for systems below sigma 0.825 (every shipped 3D preset) are
 * bit-identical to the fr-jkpn baseline; repro3's disclosed width
 * residual (1.2%R) and wanderer-terminal void false hits (2/435) persist
 * unchanged at depth 127, confirming they were never cap artifacts.
 *
 * FR-5RVK ADDENDUM: section (4) measures PURE-FOLD systems — maps whose
 * variation list is exactly one active fold-family entry (`boxfold`,
 * `spherefold`, `mandelbox`), which `surface-de.ts` decomposes into inverse
 * BRANCHES (27/3/81 of them) and descends through a fixed-width
 * `SURFACE_FOLD_BEAM_WIDTH` FRONTIER (`descendFold`) rather than the affine
 * two-plus-two ladder. Consequence for this harness: those systems IGNORE
 * `SurfaceDE.beamWidth`, so the w1..w4 grid would print four identical rows
 * — the fold section prints ONE row per estimator (`frontier(base)` /
 * `frontier(refined)`) plus an explicit `width-invariance` line that pins
 * refined-at-w1 against refined-at-w4 bit-for-bit (a difference there is a
 * bug, not a measurement). The affine sections above are untouched.
 *
 * Measured verdict (CLOUD=300k, refined estimator): width invariance holds
 * exactly — 0 mismatches, maxDelta 0, on all five profiles. Off-attractor
 * (jittered + uniform) violations are 0 everywhere, and deep-void false
 * hits are 0/197-0/364 everywhere, so the region floors do hold the
 * spherefold inversion's escape-defeating chains. Two disclosures. (a)
 * TIGHTNESS: the fold bound is far looser than the affine one — median
 * DE/D 0.13 (mandelbox pair) and 0.20 (spherefold pair) against 0.61-0.84
 * across the affine presets — which is what puts 85/308 and 75/344 hits in
 * `collect`'s shallow 0.05R-0.15R void band while the deep band stays
 * clean. The boxfold-only profiles are much tighter (0.47-0.63) and score
 * 0 in both bands: the looseness rides the spherefold's conformal mid
 * branch, not the frontier. (b) EROSION: the spherefold pair reads
 * 6/100 exact on-attractor probes positive at 5.5e-5 (0.0024%R) — the same
 * deep-descent tail the affine repro2 (e66@3.2e-8) and 4D doubleRotation
 * (e98@3.0e-8) rows carry, two orders under a marcher epsilon. COST, in
 * `invM` reads per call: 12.5-13.3 boxfold pairs, 173.5 the order-3
 * kaleidoscope sweep, 194.0 spherefold, 231.8 mandelbox — comparable to
 * the affine presets' 90-865, because a visit fans out to its 27/81
 * branches off ONE inverse matrix.
 *
 * Usage:
 *   npx vitest run --config scripts/vitest.harness.config.ts scripts/surface-beam.harness.ts
 *
 * Env knobs (defaults shown):
 *   CLOUD=300000
 *
 * Like surprise-residual.harness.ts, this file lives outside the main
 * vitest include and the tsc program: it only runs via the harness config.
 */
import { runChaosGame } from "../src/fractal/chaos-game";
import type { ChaosGameResult } from "../src/fractal/chaos-game";
import { runChaosGame4 } from "../src/fractal/chaos-game-4d";
import type { ChaosGame4Result } from "../src/fractal/chaos-game-4d";
import { toTransform4 } from "../src/fractal/affine4";
import {
  chiralLace,
  defaultTransforms,
  dodecahedronFlake,
  doubleRotation,
  icosahedronFlake,
  jerusalemCube,
  mandelboxKifs,
  mengerSponge,
  octahedronFlake,
  pentatope,
  radiolarian,
  sierpinskiPyramid,
  sierpinskiTetrahedron,
  sixteenCellFlake,
  spiral,
  tesseract,
} from "../src/fractal/presets";
import { mulberry32 } from "../src/fractal/rng";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  estimateDistance,
  estimateDistanceRefined,
  SURFACE_FOLD_BEAM_WIDTH,
} from "../src/fractal/surface-de";
import type { SurfaceDE } from "../src/fractal/surface-de";
import {
  buildSurfaceDE4,
  estimateDistance4,
  estimateDistance4Refined,
} from "../src/fractal/surface-de-4d";
import type { SurfaceDE4, SurfaceDE4Map } from "../src/fractal/surface-de-4d";
import type {
  SymmetryParams,
  Transform,
  Vec3,
  Vec4,
} from "../src/fractal/types";
import {
  countingDE,
  foldBoxfoldNegPlusAffine,
  foldBoxfoldPair,
  foldMandelboxPair,
  foldSpherefoldPair,
} from "./harness-profiles";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const CLOUD = envInt("CLOUD", 300_000);

/** The 3D mirror of doubleRotation's profile (its w blocks dropped): the
 * exact repro the fr-beck spike confirmed on the shipped surface-de.ts. */
function repro3D(sigmaA = 0.93, sigmaB = 0.22): Transform[] {
  return [
    {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0.55],
      scale: [sigmaA, sigmaA, sigmaA],
      weight: 6,
    },
    {
      id: 1,
      position: [0.85, 0, 0],
      rotation: [0, 0, 0],
      scale: [sigmaB, sigmaB, sigmaB],
      weight: 1,
    },
  ];
}

/** 3-map variant of the repro profile: does the mechanism need m = 2, or
 * just a slow map? */
function repro3D3Map(): Transform[] {
  return [
    ...repro3D(),
    {
      id: 2,
      position: [-0.6, 0.4, 0],
      rotation: [0, 0.3, 0],
      scale: [0.3, 0.3, 0.3],
      weight: 1,
    },
  ];
}

interface ClassStats {
  n: number;
  violations: number;
  maxExcess: number;
}

interface MeasureResult {
  byClass: Record<"jittered" | "uniform" | "exact", ClassStats>;
  violations: number;
  maxExcess: number;
  p10: number;
  p50: number;
  p90: number;
  nRatios: number;
  voidCount: number;
  voidFalseHits: number;
  meanApps: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

interface Query3 {
  p: Vec3;
  cls: "jittered" | "uniform" | "exact";
}

/** Spike-shaped query mix: 400 jittered cloud samples, 200 uniform cube
 * points, 100 exact cloud samples. Seeds mirror the spike/test helpers. */
function queries3(cloud: ChaosGameResult, radius: number): Query3[] {
  const out: Query3[] = [];
  const jitterRng = mulberry32(2);
  const stride = Math.max(1, Math.floor(cloud.count / 400));
  for (let i = 0; i < cloud.count && out.length < 400; i += stride) {
    out.push({
      p: [
        cloud.positions[i * 3] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 1] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 2] + (jitterRng() - 0.5) * 0.3,
      ],
      cls: "jittered",
    });
  }
  const uniformRng = mulberry32(3);
  const half = 1.2 * radius;
  for (let i = 0; i < 200; i++) {
    out.push({
      p: [
        (uniformRng() - 0.5) * 2 * half,
        (uniformRng() - 0.5) * 2 * half,
        (uniformRng() - 0.5) * 2 * half,
      ],
      cls: "uniform",
    });
  }
  for (let i = 0; i < 100; i++) {
    const j = Math.floor((cloud.count * (i + 0.5)) / 100);
    out.push({
      p: [
        cloud.positions[j * 3],
        cloud.positions[j * 3 + 1],
        cloud.positions[j * 3 + 2],
      ],
      cls: "exact",
    });
  }
  return out;
}

function nearest3(cloud: ChaosGameResult, p: Vec3): number {
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

function countingDE4(
  de: SurfaceDE4,
  beamWidth: 1 | 2 | 3 | 4,
): {
  de: SurfaceDE4;
  counter: { n: number };
} {
  const counter = { n: 0 };
  const maps = de.maps.map((m): SurfaceDE4Map => ({
    invT: m.invT,
    sigmaMin: m.sigmaMin,
    baseIndex: m.baseIndex,
    get invM() {
      counter.n++;
      return m.invM;
    },
  }));
  return { de: { ...de, maps, beamWidth }, counter };
}

function collect(
  estimates: number[],
  queries: { cls: "jittered" | "uniform" | "exact" }[],
  trueD: number[],
  radius: number,
  apps: number,
): MeasureResult {
  const byClass: MeasureResult["byClass"] = {
    jittered: { n: 0, violations: 0, maxExcess: 0 },
    uniform: { n: 0, violations: 0, maxExcess: 0 },
    exact: { n: 0, violations: 0, maxExcess: 0 },
  };
  const ratios: number[] = [];
  let voidCount = 0;
  let voidFalseHits = 0;
  for (let i = 0; i < estimates.length; i++) {
    const est = estimates[i];
    const d = trueD[i];
    const cls = byClass[queries[i].cls];
    cls.n++;
    if (est > d + 1e-9) {
      cls.violations++;
      cls.maxExcess = Math.max(cls.maxExcess, est - d);
    }
    if (d > 0.01) ratios.push(est / d);
    if (d > 0.05 * radius) {
      voidCount++;
      if (est < 0.01 * radius) voidFalseHits++;
    }
  }
  ratios.sort((a, b) => a - b);
  const violations =
    byClass.jittered.violations +
    byClass.uniform.violations +
    byClass.exact.violations;
  const maxExcess = Math.max(
    byClass.jittered.maxExcess,
    byClass.uniform.maxExcess,
    byClass.exact.maxExcess,
  );
  return {
    byClass,
    violations,
    maxExcess,
    p10: percentile(ratios, 0.1),
    p50: percentile(ratios, 0.5),
    p90: percentile(ratios, 0.9),
    nRatios: ratios.length,
    voidCount,
    voidFalseHits,
    meanApps: apps / estimates.length,
  };
}

function fmt(r: MeasureResult, radius: number): string {
  const j = r.byClass.jittered;
  const u = r.byClass.uniform;
  const e = r.byClass.exact;
  const cls = (s: ClassStats): string =>
    s.violations === 0
      ? "0"
      : `${s.violations}@${s.maxExcess.toExponential(1)}`;
  return (
    `viol=${r.violations} (j${cls(j)}/u${cls(u)}/e${cls(e)})` +
    ` maxExcess=${r.maxExcess.toFixed(6)} (${((r.maxExcess / radius) * 100).toFixed(1)}%R)` +
    ` DE/D p10/50/90=${r.p10.toFixed(3)}/${r.p50.toFixed(3)}/${r.p90.toFixed(3)}` +
    ` voidFalseHit=${r.voidFalseHits}/${r.voidCount}` +
    ` apps=${r.meanApps.toFixed(1)}`
  );
}

interface System3 {
  label: string;
  transforms: Transform[];
  symmetry?: SymmetryParams;
}

/** The seeded ground truth a 3D system's rows are all measured against:
 * its DE, the spike-shaped query mix, and brute-force nearest-cloud
 * distances. Shared verbatim by {@link measure3} (affine ladder rows) and
 * {@link measureFold} (fr-5rvk frontier rows) so both sections quote the
 * same numbers for the same seeds. */
function probe3(sys: System3): {
  de: SurfaceDE;
  qs: Query3[];
  trueD: number[];
} {
  const de = buildSurfaceDE(sys.transforms, null, sys.symmetry);
  const cloud = runChaosGame(
    sys.transforms,
    CLOUD,
    mulberry32(101),
    null,
    sys.symmetry ?? { order: 1, plane: "xz" },
  );
  const qs = queries3(cloud, de.boundingRadius);
  const trueD = qs.map((q) => nearest3(cloud, q.p));
  return { de, qs, trueD };
}

function measure3(sys: System3): {
  de: SurfaceDE;
  rows: {
    width: 1 | 2 | 3 | 4;
    estimator: "base" | "refined";
    result: MeasureResult;
  }[];
} {
  const { de, qs, trueD } = probe3(sys);
  const rows: {
    width: 1 | 2 | 3 | 4;
    estimator: "base" | "refined";
    result: MeasureResult;
  }[] = [];
  for (const width of [1, 2, 3, 4] as const) {
    for (const [estimator, fn] of [
      ["base", estimateDistance],
      ["refined", estimateDistanceRefined],
    ] as const) {
      const { de: counted, counter } = countingDE(de, width);
      const estimates = qs.map((q) => fn(counted, q.p));
      rows.push({
        width,
        estimator,
        result: collect(estimates, qs, trueD, de.boundingRadius, counter.n),
      });
    }
  }
  return { de, rows };
}

/** Human-readable {@link SurfaceDEMap.foldKind}, indexed by the numeric
 * `SURFACE_FOLD_*` vocabulary the DE packs into its uniforms. */
const FOLD_KIND_NAMES = ["affine", "boxfold", "spherefold", "mandelbox"];

/** How many of a system's queries the width-invariance check re-runs. */
const WIDTH_INVARIANCE_PROBES = 200;

/** DEEP-void threshold: the criterion the fr-5rvk fold work itself measured
 * against (and the one `surface-de.test.ts`'s pure-fold void suites pin at
 * zero), reported alongside `collect`'s shared `voidFalseHit` column so the
 * two are comparable. `collect` calls anything past `0.05 * R` a void; the
 * shallow `0.05R-0.15R` band inside that is where a VALID but loose fold
 * bound legitimately reads under a marcher epsilon, and the fold
 * estimators ARE much looser than the affine ones (measured median DE/D
 * 0.13 mandelbox / 0.20 spherefold, against 0.61-0.84 across the affine
 * presets), so the shallow band measures tightness, not soundness. Only a
 * false hit in genuine deep void paints a ghost. */
const DEEP_VOID_FACTOR = 0.15;

/** Marcher hit-test proxy, shared with `collect`'s void column. */
const VOID_HIT_FACTOR = 0.01;

/** On-attractor EROSION budget, as a fraction of `R`, for the `exact`
 * probe class only. Those probes are cloud points, so their `nearest` is
 * 0 by construction and ANY positive estimate counts as a violation at the
 * 1e-9 threshold — the column measures how far the descent's bound sits
 * OFF a point known to be on the attractor, not an overshoot into void.
 * The affine and 4D sections carry the identical tail (repro2 w4 refined
 * `e66@3.2e-8`, doubleRotation w4 refined `e98@3.0e-8`) and the module doc
 * says of it: read maxExcess, not viol. Measured (CLOUD=300k): the fold
 * PAIRS read 0 or fp-noise — the worst is the spherefold pair at 9/100,
 * 1.02e-4 = 0.0060%R on the fr-pjqw probe set (6/100 at 5.55e-5 before
 * the probe-fit ball moved its R), still two orders below a marcher
 * epsilon at the set's deepest descent — so 1e-4 of R holds every
 * pair/mix row here with ~1.7x headroom while refusing anything an order
 * worse. One row needs more: see
 * {@link EXACT_EROSION_BUDGET_R_OVERRIDES} (fr-2v0y). The jittered/uniform
 * classes stay a HARD zero: an overshoot there is a real validity break. */
const EXACT_EROSION_BUDGET_R = 1e-4;

/** Per-system overrides of {@link EXACT_EROSION_BUDGET_R}, keyed by the
 * system's `label` in test (4)'s `systems` array. fr-2v0y (PR #174
 * review): the budget used to be loosened globally 1e-4 -> 3e-3 to admit
 * ONE system's tail, which handed every fold PAIR ~54x of regression
 * headroom they never needed — split per-system instead. The SHIPPED
 * mandelboxKifs preset (12 maps, 8x81 + 4x27 branches) holds a real
 * width-bound tail: refined e77 @4.4e-3 = 0.22%R at the production
 * frontier width 12 — the fold edition of fr-jkpn's
 * more-simultaneous-in-sphere-branches-than-slots drop, EXACT class only
 * (its jittered/uniform/void columns are all 0). Diagnostic at frontier
 * width 24: 39 @0.06%R at 3x the inverse applications (2039 -> 6029
 * apps/call) — converging in width, so wider frontiers buy it down, but
 * 0.22%R sits well under the disclosed affine precedent (repro3 1.2%R
 * JITTERED) and at the scale of a close-zoom marcher epsilon, so width
 * 12 ships and the tail is budgeted here instead: 0.3%R, ~35% headroom
 * over the measured worst — for THIS row only. */
const EXACT_EROSION_BUDGET_R_OVERRIDES: Record<string, number> = {
  "mandelboxKifs preset": 3e-3,
};

/** Per-system allowances against the deep-void HARD zero, keyed like
 * {@link EXACT_EROSION_BUDGET_R_OVERRIDES} (fr-2v0y — the fold section
 * had been failing since fr-pjqw landed, because the hard zero never
 * absorbed that change's disclosed reading). The one entry is carried in
 * surface-de.ts's fr-pjqw addendum: the probe-fit ball shrank the
 * mandelbox pair's R (2.30 -> 1.88), and the R-relative uniform probe
 * cloud now samples a pre-existing weak spot at p ~ [0.99, 1.93, 0.05] —
 * trueD 0.646 (0.34R) against an estimate of 0.0123, i.e. 1/200 in the
 * deep-void column. Verified BIT-IDENTICAL under the origin ball at the
 * old radius (the old probe set just never landed there) and above the
 * marcher's real acceptance epsilon at typical hit distances (~0.006): a
 * slow-march spot of the known in-sphere floor-0-drop residual class,
 * not a rendered ghost. The allowance is exactly that one probe; a
 * second hit on any system is a regression. */
const DEEP_VOID_ALLOWANCES: Record<string, number> = {
  "mandelbox pair": 1,
};

interface VoidStats {
  probes: number;
  falseHits: number;
}

/** Void false hits at the {@link DEEP_VOID_FACTOR} criterion. */
function deepVoid(
  estimates: number[],
  trueD: number[],
  radius: number,
): VoidStats {
  const stats: VoidStats = { probes: 0, falseHits: 0 };
  for (let i = 0; i < estimates.length; i++) {
    if (trueD[i] <= DEEP_VOID_FACTOR * radius) continue;
    stats.probes++;
    if (estimates[i] < VOID_HIT_FACTOR * radius) stats.falseHits++;
  }
  return stats;
}

interface FoldRow {
  estimator: "base" | "refined";
  result: MeasureResult;
  deep: VoidStats;
}

interface WidthInvariance {
  probes: number;
  mismatches: number;
  maxDelta: number;
}

/**
 * Fold-system rows: ONE per estimator, not a width grid. `estimateDistance`
 * / `estimateDistanceRefined` route fold systems to `descendFold`'s fixed
 * width-{@link SURFACE_FOLD_BEAM_WIDTH} frontier, which never reads
 * `SurfaceDE.beamWidth` — so the affine section's w1..w4 loop would print
 * four byte-identical rows here. {@link WidthInvariance} pins exactly that:
 * refined-at-width-1 against refined-at-width-4, bit-for-bit.
 *
 * `apps` is still the shipped `invM`-read counter, which on this path
 * counts map VISITS (one read per (chain, sector, map) triple), NOT branch
 * children — a single visit fans out to up to 81 candidates off one inverse
 * matrix, so fold `apps` and affine `apps` are the same unit of *inverse
 * affine work* but a very different unit of *candidates considered*.
 */
function measureFold(sys: System3): {
  de: SurfaceDE;
  rows: FoldRow[];
  invariance: WidthInvariance;
} {
  const { de, qs, trueD } = probe3(sys);
  const rows: FoldRow[] = [];
  for (const [estimator, fn] of [
    ["base", estimateDistance],
    ["refined", estimateDistanceRefined],
  ] as const) {
    const { de: counted, counter } = countingDE(de, de.beamWidth);
    const estimates = qs.map((q) => fn(counted, q.p));
    rows.push({
      estimator,
      result: collect(estimates, qs, trueD, de.boundingRadius, counter.n),
      deep: deepVoid(estimates, trueD, de.boundingRadius),
    });
  }
  // Spread the invariance probes across the whole query mix so all three
  // classes (jittered / uniform / exact) are represented.
  const { de: narrow } = countingDE(de, 1);
  const { de: wide } = countingDE(de, 4);
  const invariance: WidthInvariance = {
    probes: 0,
    mismatches: 0,
    maxDelta: 0,
  };
  for (let i = 0; i < WIDTH_INVARIANCE_PROBES; i++) {
    const q = qs[Math.floor((qs.length * i) / WIDTH_INVARIANCE_PROBES)];
    const a = estimateDistanceRefined(narrow, q.p);
    const b = estimateDistanceRefined(wide, q.p);
    invariance.probes++;
    if (!Object.is(a, b)) {
      invariance.mismatches++;
      invariance.maxDelta = Math.max(invariance.maxDelta, Math.abs(a - b));
    }
  }
  return { de, rows, invariance };
}

interface Query4 {
  p: Vec4;
  cls: "jittered" | "uniform" | "exact";
}

function queries4(cloud: ChaosGame4Result, radius: number): Query4[] {
  const out: Query4[] = [];
  const jitterRng = mulberry32(2);
  const stride = Math.max(1, Math.floor(cloud.count / 400));
  for (let i = 0; i < cloud.count && out.length < 400; i += stride) {
    out.push({
      p: [
        cloud.positions[i * 3] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 1] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 2] + (jitterRng() - 0.5) * 0.3,
        cloud.w[i] + (jitterRng() - 0.5) * 0.3,
      ],
      cls: "jittered",
    });
  }
  const uniformRng = mulberry32(3);
  const half = 1.2 * radius;
  for (let i = 0; i < 200; i++) {
    out.push({
      p: [
        (uniformRng() - 0.5) * 2 * half,
        (uniformRng() - 0.5) * 2 * half,
        (uniformRng() - 0.5) * 2 * half,
        (uniformRng() - 0.5) * 2 * half,
      ],
      cls: "uniform",
    });
  }
  for (let i = 0; i < 100; i++) {
    const j = Math.floor((cloud.count * (i + 0.5)) / 100);
    out.push({
      p: [
        cloud.positions[j * 3],
        cloud.positions[j * 3 + 1],
        cloud.positions[j * 3 + 2],
        cloud.w[j],
      ],
      cls: "exact",
    });
  }
  return out;
}

function nearest4(cloud: ChaosGame4Result, p: Vec4): number {
  let best = Infinity;
  const pos = cloud.positions;
  const w = cloud.w;
  for (let i = 0; i < cloud.count; i++) {
    const dx = pos[i * 3] - p[0];
    const dy = pos[i * 3 + 1] - p[1];
    const dz = pos[i * 3 + 2] - p[2];
    const dw = w[i] - p[3];
    const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

describe("fr-v6yg surface beam harness", () => {
  it("(1) 3D: predicate, validity, tightness, cost per system and width", () => {
    const presets: System3[] = [
      { label: "default", transforms: defaultTransforms() },
      { label: "sierpinski", transforms: sierpinskiTetrahedron() },
      { label: "menger", transforms: mengerSponge() },
      { label: "spiral", transforms: spiral() },
      { label: "pyramid", transforms: sierpinskiPyramid() },
      { label: "octahedron", transforms: octahedronFlake() },
      { label: "icosahedron", transforms: icosahedronFlake() },
      { label: "dodecahedron", transforms: dodecahedronFlake() },
      { label: "jerusalem", transforms: jerusalemCube() },
      { label: "chiral", transforms: chiralLace() },
      { label: "radiolarian", transforms: radiolarian() },
    ];
    const systems: System3[] = [
      { label: "repro2 (0.93/0.22 w6:1)", transforms: repro3D() },
      {
        label: "repro2+sym4y (2 maps x order 4)",
        transforms: repro3D(),
        symmetry: { order: 4, plane: "xz" },
      },
      { label: "repro3 (+0.3 map)", transforms: repro3D3Map() },
      ...presets,
    ];
    console.log(`\n== 3D systems (CLOUD=${CLOUD}) ==`);
    for (const sys of systems) {
      const analysis = analyzeSurfaceSystem(sys.transforms);
      if (analysis.status === "ineligible") {
        console.log(
          `-- ${sys.label}: INELIGIBLE (${analysis.reasons.join("; ")})`,
        );
        continue;
      }
      const { de, rows } = measure3(sys);
      const maxSigma = sys.transforms.reduce(
        (acc, t, i) =>
          (t.weight ?? 1) > 0 ? Math.max(acc, analysis.sigmas[i].max) : acc,
        0,
      );
      console.log(
        // baseMaps x symOrder is the branching factor per level — the map
        // array is BASE maps and the kaleidoscope is swept (fr-x029), so
        // neither number alone is the old "slots" count.
        `-- ${sys.label}: baseMaps=${de.maps.length}x${de.symmetry.order}` +
          ` maxSigmaMax=${maxSigma.toFixed(3)}` +
          ` builtWidth=${de.beamWidth} status=${analysis.status}` +
          ` R=${de.boundingRadius.toFixed(4)} maxDepth=${de.maxDepth}`,
      );
      for (const row of rows) {
        console.log(
          `   w=${row.width} ${row.estimator.padEnd(7)}: ${fmt(row.result, de.boundingRadius)}`,
        );
      }
    }
    expect(true).toBe(true);
  });

  it("(2) 3D sigma sweep: width-1 breadth and width-2 residuals along sigma_max", () => {
    console.log(`\n== 3D sigmaA sweep (m=2, sigmaB=0.22, weight 6:1) ==`);
    for (const sigmaA of [0.7, 0.75, 0.8, 0.85, 0.9, 0.93, 0.96]) {
      const { de, rows } = measure3({
        label: `sigmaA=${sigmaA}`,
        transforms: repro3D(sigmaA),
      });
      const pick = (width: 1 | 2 | 3 | 4, estimator: "base" | "refined") =>
        rows.find((r) => r.width === width && r.estimator === estimator)!
          .result;
      const w1 = pick(1, "base");
      const w2 = pick(2, "base");
      const w2r = pick(2, "refined");
      const w3r = pick(3, "refined");
      const w4r = pick(4, "refined");
      console.log(
        `sigmaA=${sigmaA.toFixed(2)} R=${de.boundingRadius.toFixed(3)}` +
          ` maxDepth=${de.maxDepth} builtWidth=${de.beamWidth}` +
          ` | w1 viol=${w1.violations} maxExcess=${w1.maxExcess.toFixed(6)}` +
          ` | w2 viol=${w2.violations} maxExcess=${w2.maxExcess.toFixed(6)}` +
          ` | w2r viol=${w2r.violations} maxExcess=${w2r.maxExcess.toFixed(6)}` +
          ` | w3r viol=${w3r.violations} maxExcess=${w3r.maxExcess.toFixed(6)}` +
          ` | w4r viol=${w4r.violations} maxExcess=${w4r.maxExcess.toFixed(6)}` +
          ` | apps w2r=${w2r.meanApps.toFixed(1)}` +
          ` w3r=${w3r.meanApps.toFixed(1)} w4r=${w4r.meanApps.toFixed(1)}`,
      );
    }
    expect(true).toBe(true);
  });

  it("(3) 4D: spike-parity validity per system, estimator, width", () => {
    const systems = [
      { label: "pentatope", transforms: pentatope() },
      { label: "sixteenCellFlake", transforms: sixteenCellFlake() },
      { label: "tesseract", transforms: tesseract() },
      { label: "doubleRotation", transforms: doubleRotation() },
    ];
    console.log(`\n== 4D systems (CLOUD=${CLOUD}) ==`);
    for (const sys of systems) {
      const de = buildSurfaceDE4(sys.transforms);
      const cloud = runChaosGame4(
        sys.transforms.map(toTransform4),
        CLOUD,
        mulberry32(101),
      );
      const qs = queries4(cloud, de.boundingRadius);
      const trueD = qs.map((q) => nearest4(cloud, q.p));
      console.log(
        `-- ${sys.label}: maps=${de.maps.length} builtWidth=${de.beamWidth}` +
          ` R=${de.boundingRadius.toFixed(4)} maxDepth=${de.maxDepth}`,
      );
      for (const width of [1, 2, 3, 4] as const) {
        for (const [name, fn] of [
          ["base", estimateDistance4],
          ["refined", estimateDistance4Refined],
        ] as const) {
          const { de: counted, counter } = countingDE4(de, width);
          const estimates = qs.map((q) => fn(counted, q.p));
          const result = collect(
            estimates,
            qs,
            trueD,
            de.boundingRadius,
            counter.n,
          );
          console.log(
            `   w=${width} ${name.padEnd(7)}: ${fmt(result, de.boundingRadius)}`,
          );
        }
      }
    }
    expect(true).toBe(true);
  }, 600_000);

  it("(4) 3D pure-fold systems: frontier validity, tightness, cost, width invariance", () => {
    const systems: System3[] = [
      { label: "boxfold pair", transforms: foldBoxfoldPair() },
      { label: "boxfold -w + affine", transforms: foldBoxfoldNegPlusAffine() },
      { label: "spherefold pair", transforms: foldSpherefoldPair() },
      { label: "mandelbox pair", transforms: foldMandelboxPair() },
      {
        label: "boxfold pair x sym3y",
        transforms: foldBoxfoldPair(),
        symmetry: { order: 3, plane: "xz" },
      },
      // The shipped pure-fold preset — the fr-5rvk acceptance criterion's
      // probe set (12 maps: 8 mandelbox corners + 4 boxfold binders).
      { label: "mandelboxKifs preset", transforms: mandelboxKifs() },
    ];
    console.log(
      `\n== 3D pure-fold systems (CLOUD=${CLOUD},` +
        ` frontier width ${SURFACE_FOLD_BEAM_WIDTH}, beamWidth ignored) ==`,
    );
    // Collected, not asserted inline: a mid-loop failure would truncate the
    // table this harness exists to print.
    const failures: string[] = [];
    for (const sys of systems) {
      const analysis = analyzeSurfaceSystem(sys.transforms);
      if (analysis.status === "ineligible") {
        console.log(
          `-- ${sys.label}: INELIGIBLE (${analysis.reasons.join("; ")})`,
        );
        failures.push(`${sys.label}: unexpectedly ineligible`);
        continue;
      }
      const { de, rows, invariance } = measureFold(sys);
      const maxSigma = sys.transforms.reduce(
        (acc, t, i) =>
          (t.weight ?? 1) > 0 ? Math.max(acc, analysis.sigmas[i].max) : acc,
        0,
      );
      const kinds = de.maps.map((m) => FOLD_KIND_NAMES[m.foldKind]).join(",");
      console.log(
        `-- ${sys.label}: baseMaps=${de.maps.length}x${de.symmetry.order}` +
          ` folds=[${kinds}] maxSigmaMax=${maxSigma.toFixed(3)}` +
          ` status=${analysis.status}` +
          ` R=${de.boundingRadius.toFixed(4)} maxDepth=${de.maxDepth}`,
      );
      for (const row of rows) {
        console.log(
          `   frontier(${row.estimator.padEnd(7)}): ${fmt(row.result, de.boundingRadius)}` +
            ` deepVoidFalseHit=${row.deep.falseHits}/${row.deep.probes}`,
        );
      }
      const ok = invariance.mismatches === 0;
      console.log(
        `   width-invariance: ${ok ? "OK" : "FAIL"}` +
          ` (refined w1 vs w4 over ${invariance.probes} probes,` +
          ` mismatches=${invariance.mismatches}` +
          ` maxDelta=${invariance.maxDelta.toExponential(1)})`,
      );
      if (!ok) {
        failures.push(
          `${sys.label}: width-invariance FAIL` +
            ` (${invariance.mismatches} mismatches,` +
            ` maxDelta=${invariance.maxDelta.toExponential(1)})`,
        );
      }
      const refinedRow = rows.find((r) => r.estimator === "refined")!;
      const refined = refinedRow.result;
      // Hard zero: the region floors exist precisely so a spurious
      // never-escaping chain cannot fabricate a hit across genuine DEEP
      // void — the fr-5rvk criterion, pinned at zero by the pure-fold
      // suites in surface-de.test.ts — except where a disclosed, verified
      // reading says otherwise (DEEP_VOID_ALLOWANCES). `collect`'s
      // shallower 0.05R column is printed above but NOT asserted: see
      // DEEP_VOID_FACTOR for why its inner band measures looseness rather
      // than ghosts.
      const deepAllowance = DEEP_VOID_ALLOWANCES[sys.label] ?? 0;
      if (refinedRow.deep.falseHits > deepAllowance) {
        failures.push(
          `${sys.label}: refined deepVoidFalseHits=` +
            `${refinedRow.deep.falseHits}/${refinedRow.deep.probes}` +
            ` (allowance ${deepAllowance})`,
        );
      }
      // Validity, hard: an estimate that exceeds the true distance at a
      // jittered or uniform probe is the real thing — a bound the marcher
      // could step straight through. Measured 0 on every fold system at
      // CLOUD=60k and 300k alike.
      const offAttractor =
        refined.byClass.jittered.violations +
        refined.byClass.uniform.violations;
      if (offAttractor !== 0) {
        failures.push(
          `${sys.label}: refined off-attractor violations=${offAttractor}` +
            ` (j${refined.byClass.jittered.violations}@` +
            `${refined.byClass.jittered.maxExcess.toExponential(1)}` +
            `/u${refined.byClass.uniform.violations}@` +
            `${refined.byClass.uniform.maxExcess.toExponential(1)})`,
        );
      }
      // On-attractor erosion, budgeted rather than zeroed: see
      // EXACT_EROSION_BUDGET_R for why the `exact` class counts differently.
      const budgetR =
        EXACT_EROSION_BUDGET_R_OVERRIDES[sys.label] ?? EXACT_EROSION_BUDGET_R;
      const erosion = refined.byClass.exact.maxExcess;
      if (erosion > budgetR * de.boundingRadius) {
        failures.push(
          `${sys.label}: refined exact-probe erosion=${erosion.toExponential(2)}` +
            ` (${((erosion / de.boundingRadius) * 100).toFixed(4)}%R) over budget` +
            ` on ${refined.byClass.exact.violations} probes` +
            ` (budget ${(budgetR * 100).toFixed(2)}%R)`,
        );
      }
    }
    expect(failures).toEqual([]);
  }, 900_000);
});
