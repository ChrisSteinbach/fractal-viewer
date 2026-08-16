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
 * Section (4), added later, answers a DIFFERENT bead (fr-8yad) — its own
 * question, method and verdict are in the paragraph below the fr-5wlv.1
 * MEASURED VERDICT.
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
 * fr-8yad (section 4): fr-5wlv shipped the empty-space grid OFF in
 * balloon mode — a stored floor is fractal-only, so it is not
 * automatically a valid bound on distance to the UNION once the shell
 * exists. The epic recorded a re-enable rule (fractal-only floors stay
 * valid once the shell clears the grid box) and warned against itself
 * before anyone wrote that predicate: the balloon march spends most of
 * its steps in the CAVE GAP between the box and the shell, where a floor
 * was never stored regardless of validity. Section (4) measures that gap
 * directly, on the same `runMarch` machinery sections (2)/(3) use
 * (hoisted out of section (2)'s formerly inline `march` closure as
 * `runMarch`/`buildMarchSetup` — a behavior-preserving extraction:
 * re-running the file and diffing shows sections (0)-(2) byte-identical
 * and section (3) unchanged in its own `apps` figures, only its
 * wall-clock `us` differing run to run exactly as its own doc already
 * discloses). A first cut of this section reported one combined
 * evaluation-count figure; a review caught that it conflated two
 * different propositions with different implementation costs, that "the
 * shell clears the box" bounds an AGGREGATE, not a per-cell guarantee,
 * and that the box is origin-centred while the balloon is not. All three
 * are addressed below (4a-4c) and the numbers this paragraph now cites
 * are the corrected ones.
 *
 * METHOD. Every DE evaluation along a march ray is classified, PER TERM,
 * against the grid geometry: `inBox` (inside the
 * `visibleBoundingRadius*1.03` cube `buildSurfaceGridSlab` actually
 * spans), `posFloorSphere@{64,32}` (inside the sphere a cell could hold a
 * positive floor in, at BOTH shipped resolutions since
 * `pickSurfaceGridResolution` can downshift), and `gridSkip@{64,32}` (an
 * ACTUALLY-BUILT grid, NEAREST-sampled exactly as the shader would, whose
 * stored floor clears the march's own acceptance eps — built for 5 of 6
 * systems; `mandelboxKifs` is too costly to build twice in this one run,
 * per fr-aj4w's own measured verdict, so its row reports the geometric
 * upper bound only and SAYS SO). A balloon march step calls the estimator
 * TWICE: the FRACTAL term at the ray sample `p` (the query the plain,
 * already-shipped, non-balloon grid check already reaches — this is what
 * "re-enable the grid" gets for free), and the SHELL term at
 * `invert(balloon, p)` (a DIFFERENT query point that would need the grid
 * read a second time plus a `|p-c|/rho` rescale before its floor bounds
 * anything — new march-loop work the bead does not propose and does not
 * cost). The two are tallied and reported SEPARATELY, never averaged, so
 * "what the bead as scoped buys" and "what a further extension could add"
 * stay distinguishable. The plain (non-balloon) march's fractal-term
 * tally, over the SAME rays, is the reference for what the grid buys
 * where it is already enabled. Section (4c) additionally checks, over the
 * SAME built grids, whether the aggregate "shell clears the box" premise
 * actually certifies every individual cell's stored floor as a valid
 * bound on distance-to-shell (it does not follow automatically — see
 * below). Figures are stable: identical to the digit across two full
 * runs of the file (structural counts only — no timing figures are
 * reported here, per this measurement's own ground rules).
 *
 * VALIDITY PREMISE (4a). `R^2/rho` (the shell's nearest approach to the
 * balloon CENTER `c`) must exceed the grid box's farthest reach FROM `c`
 * — NOT `sqrt(3)*halfExtent` alone, which is the box's far corner from
 * the ORIGIN. `balloonBall()` returns `c = de.boundCenter` for plain
 * systems (only `[0,0,0]` for lens ones), while `surfaceGridSpec` centres
 * the box on the ORIGIN — so the correct bound, by the triangle
 * inequality, is `R^2/rho > |boundCenter| + sqrt(3)*halfExtent`. `rho`
 * here is `balloon.rho`, the MARGINED value `balloonEstimate`'s own
 * `scale = |p-c|/rho` divides by (not a raw radius recovered separately —
 * a first cut of this section used the raw one; at this harness's default
 * `RHO_MARGIN=1` the two are numerically identical, which is why no
 * number below changed from that fix alone, but the corrected formula is
 * now the one the code actually computes at any margin setting).
 * `|boundCenter|` is 0.0000 for default/spiral/lens (already
 * origin-centred), negligible for mandelboxKifs (0.0067), small for
 * boxfold sym3 (0.0414, farCorner 1.4092 -> boxFarFromC 1.4506), and
 * material for spherefold pair (0.7857 — about 46% of its own
 * visibleBoundingRadius — farCorner 3.0532 -> boxFarFromC 3.8389, a 26%
 * increase). No verdict flips: REST (1.6rho) still CLEARS on all 6
 * systems, both inflation regimes still fail to clear on all 6. But the
 * REST margin is no longer uniform once boundCenter is accounted for —
 * spherefold's margin shrinks from 43.5% over (the uncorrected,
 * origin-centred reading) to 14.1% over (`shellNear=4.3812` vs
 * `boxFarFromC=3.8389`) — still positive, but the one system among the
 * six where this correction is not just a formality.
 *
 * COVERAGE (4b), rest (R=1.6rho), production estimator per class, cutoff
 * engaged, same rays as section (2), PER TERM, `gridSkip@64` as a
 * fraction of that term's own eval count (= the march's step count, one
 * fractal- and one shell-term eval per balloon step): bead-AS-SCOPED
 * (fractal-only) vs plain's fractal-only rate vs the ratio between them,
 * then the shell-term figure reported separately and labelled NOT
 * proposed/NOT costed — default 26.4% vs 50.5% (52.3%), shell 19.3%;
 * spiral 31.1% vs 43.7% (71.1%), shell 22.0%; boxfold sym3 18.6% vs 33.9%
 * (54.9%), shell 11.3%; spherefold 33.2% vs 43.5% (76.3%), shell 14.8%;
 * lens 25.8% vs 52.9% (48.7%), shell 27.5%. The FRACTAL term — the one
 * the bead actually proposes — is the LARGER of the two on 4 of 5
 * measured systems, not the smaller one a "far p, near-center invert(p)"
 * intuition would predict; lens is the one exception, and even there the
 * two are close (25.8% vs 27.5%). Bead-as-scoped realizes 48.7-76.3% of
 * the plain grid's own rate — CLOSER to the combined figure a first cut
 * of this section reported than a pessimistic reading of "two terms
 * averaged" would suggest, because the two terms are not that far apart
 * for most systems here. `mandelboxKifs` (grid too costly to build twice
 * here) is bounded geometrically instead of measured: fractal-term
 * posFloorSphere@64 69.1% (balloon) vs 86.4% (plain) — an upper bound
 * only, not a measured skip rate.
 *
 * SOUNDNESS (4c). "Shell clears the box" is an AGGREGATE statement — it
 * bounds the box's farthest point from the shell's nearest point — and
 * does not by itself certify that any one cell's STORED FLOOR (built from
 * the fractal-only estimator, itself floored by `cellRadius`) stays under
 * that specific cell's true distance to the shell. This is checked
 * DIRECTLY: for every positive-floor cell in the SAME built grids (both
 * resolutions, all 5 measured systems, at rest), the floor is compared
 * against `distToShellBound(cellCenter) = max(0, R^2/rho - |cellCenter -
 * c|)` — a lower bound on distance-to-shell derived the same way the
 * module doc derives `R^2/rho` itself (every shell point `I(s)` satisfies
 * `|I(s)-c| = R^2/|s-c| >= R^2/rho`, so the whole shell lies outside the
 * ball of radius `R^2/rho` about `c`, and the reverse triangle inequality
 * gives the per-point bound from there).
 *
 * THE COMPARISON HAS TO CARRY A `cellRadius`, and a first cut of this
 * section did not. The grid's contract is that a cell's stored value
 * bounds the distance from EVERY point of the cell, not from its centre —
 * that is what `buildSurfaceGridSlab`'s own `- cellRadius` buys on the
 * fractal side. Requiring `stored <= dist(p, shell)` for all `p` in the
 * cell, and using `dist(p, shell) >= dist(centre, shell) - cellRadius`:
 *
 *     DE(centre) - cellRadius <= dist(centre, shell) - cellRadius
 *       <=>  floor + cellRadius <= distToShellBound(centre)
 *
 * so comparing the bare `floor` against the CENTRE's bound is looser than
 * the sufficient condition by exactly one `cellRadius`, in the UNSAFE
 * direction. Both ratios are printed; the `SUFFICIENT:` one is the one to
 * read.
 *
 * MEASURED, under the sufficient condition: 0 violations, on every system,
 * at both resolutions, over 115,739-140,267 positive-floor cells at res 64
 * and 13,152-18,519 at res 32 — not a single stored floor exceeded its
 * cell's conservative distance-to-shell bound. Not a knife-edge rescued by
 * rounding either: the CLOSEST call, `max (floor + cellRadius) /
 * distToShellBound` over every positive-floor cell, violating or not, runs
 * 0.389-0.572 at res 64 and 0.376-0.580 at res 32 — 42-62% margin
 * remaining at the tightest cell. (The loose `floor/dist` column reads
 * 0.338-0.547 and 0.338-0.529; the correction costs 2-5 points, and res 32
 * tightens more than res 64 because `cellRadius` doubles against an
 * unchanged shell distance. That is the direction to watch — a predicate
 * sound at 64 and not at 32 would matter, since
 * `pickSurfaceGridResolution` downshifts under load and nothing tells the
 * user which one they got — but at these margins it does not bite.)
 *
 * So "shell clears the box" (4a) turned out to be SUFFICIENT as well as
 * necessary for every system and resolution measured here, though the
 * argument for why (stored floors are bounded by local fractal geometry,
 * typically far smaller than the rest-state shell clearance) is
 * EMPIRICAL OVER FIVE SYSTEMS, not a proof that no system could violate
 * it.
 *
 * VERDICT. The originally-reported "cave gap" finding survives revision —
 * roughly HALF of a balloon march's evaluations still land outside the
 * grid box — but the SCOPE and SAFETY questions the review raised both
 * came back cleaner than the pessimistic reading of either would predict.
 * SCOPE: the bead's own proposal — re-enable the grid, gate it at rest —
 * reaches the FRACTAL-term query alone, and that alone would skip
 * 18.6-33.2% of a balloon march's STEPS at res 64 across the five
 * measured systems, realizing 48.7-76.3% of what the identical grid buys
 * the plain march over the identical rays. That is the number to build
 * against; the SHELL-term figure (11.3-27.5%) is a real but SEPARATE
 * opportunity this measurement did not cost, needing a second grid read
 * and a rescale the bead does not propose. SAFETY: the re-enable rule as
 * literally stated (shell clears the box) is not automatically sufficient
 * for a per-cell floor guarantee — but measured directly over 5 systems x
 * 2 resolutions, under the `floor + cellRadius` condition rather than the
 * looser one, it held with 0 violations and 42-62% margin at every
 * positive-floor cell, so no floor clamp or extra predicate is needed on
 * this evidence. What this measurement does NOT settle is whether an
 * 18.6-33.2% step-skip rate is worth a validity predicate's complexity
 * plus the mid-inflation transient (section (1)'s own disclosed soft
 * regime) it would need to stay clear of, or whether the shell-term
 * extension is worth building on top later — cost/benefit calls for the
 * bead, which this file informs but does not make.
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
import {
  buildSurfaceGrid,
  surfaceGridEstimator,
  surfaceGridSpec,
} from "../src/fractal/surface-grid";
import type { SurfaceGrid } from "../src/fractal/surface-grid";
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

interface MarchSetup {
  cam: Vec3;
  rays: Vec3[];
  tFar: number;
  eps: number;
}

/** Camera + ray-grid setup shared by sections (2) and (4): a fixed pose at
 * 1.35rho from the ball center, `MARCH_RAYS`x`MARCH_RAYS` rays at a
 * 60-degree fov, `eps=1e-3rho`, `tFar=cam-distance+10rho` (the balloon far
 * cap). Extracted verbatim from section (2)'s original inline setup — not
 * rederived — so both sections trace the IDENTICAL rays: section (4)'s
 * "same rays" comparison against the plain march depends on it. */
function buildMarchSetup(rho: number, c: Vec3): MarchSetup {
  const eps = 1e-3 * rho;
  const camDir = ((): Vec3 => {
    const n = Math.hypot(0.9, 0.55, 0.75);
    return [0.9 / n, 0.55 / n, 0.75 / n];
  })();
  const cam: Vec3 = [
    c[0] + camDir[0] * 1.35 * rho,
    c[1] + camDir[1] * 1.35 * rho,
    c[2] + camDir[2] * 1.35 * rho,
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
  return { cam, rays, tFar, eps };
}

interface MarchResult {
  hitF: number;
  hitS: number;
  far: number;
  cap: number;
  stepsMean: number;
  stepsP95: number;
  appsPerRay: number;
}

/**
 * The shared ray marcher for sections (2) and (4): steps every ray in
 * `rays` from `cam` until it hits the fractal term, hits the shell term,
 * passes `tFar`, or exhausts `maxSteps`. `balloon: null` marches the plain
 * field alone (`fn` direct, one eval/step); a `Balloon` marches the union
 * (`balloonEstimate`, two evals/step: the fractal term at the ray sample
 * `p`, the shell term at the untouched `invert(balloon, p)`).
 *
 * `onEval`, when supplied (fr-8yad's section (4) only — section (2) omits
 * it, so its output is exactly what the original inline `march` closure
 * produced), fires once per evaluation with the exact query point `fn` was
 * called at and which term produced it: the fractal term's `p` itself, or,
 * for a balloon march, the shell term's `invert(balloon, p)` as a SECOND
 * call. The extra `invert` this costs is pure arithmetic (no descent) and
 * never runs when `onEval` is omitted, so section (2)'s cost is unaffected.
 */
function runMarch(
  de: SurfaceDE,
  fn: EstimatorFn,
  cam: Vec3,
  rays: Vec3[],
  tFar: number,
  eps: number,
  maxSteps: number,
  balloon: Balloon | null,
  onEval?: (p: Vec3, term: "fractal" | "shell") => void,
): MarchResult {
  const { de: counted, counter } = countingDE(de, de.beamWidth);
  let hitF = 0;
  let hitS = 0;
  let far = 0;
  let cap = 0;
  const stepCounts: number[] = [];
  for (const dir of rays) {
    let t = 0;
    let steps = 0;
    let status: "hitF" | "hitS" | "far" | "cap" = "cap";
    while (steps < maxSteps) {
      const p: Vec3 = [
        cam[0] + dir[0] * t,
        cam[1] + dir[1] * t,
        cam[2] + dir[2] * t,
      ];
      if (onEval) {
        onEval(p, "fractal");
        if (balloon) onEval(invert(balloon, p), "shell");
      }
      const e = balloon
        ? balloonEstimate(fn, counted, balloon, p, eps)
        : { d: fn(counted, p, eps), shell: false };
      steps++;
      if (e.d < eps) {
        status = e.shell ? "hitS" : "hitF";
        break;
      }
      t += e.d * de.stepScale;
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
  const mean = stepCounts.reduce((acc, s) => acc + s, 0) / stepCounts.length;
  return {
    hitF,
    hitS,
    far,
    cap,
    stepsMean: mean,
    stepsP95: percentile(stepCounts, 0.95),
    appsPerRay: counter.n / rays.length,
  };
}

/** fr-8yad section (4): per-TERM tally of where one term's DE evaluations
 * land relative to the empty-space grid's cube (`inBox`), the sphere
 * inside which a cell could ever hold a positive floor (`posFloor64`/`32`,
 * one per shipped resolution since `pickSurfaceGridResolution` can
 * downshift), and — where an actual grid was built — how many the grid
 * would truly have replaced with a texture read (`skip64`/`32`). A
 * balloon march step produces ONE fractal-term evaluation (at the ray
 * sample `p`) and ONE shell-term evaluation (at `invert(balloon, p)`), so
 * `n` here is directly a STEP count per term — `fractal.skip64/fractal.n`
 * is "fraction of march steps the bead-as-proposed re-enable could skip";
 * `shell.skip64/shell.n` is a SEPARATE, unproposed opportunity (team-lead
 * review of the first cut of this section: a shell-term skip needs the
 * march loop to read the grid at a second, DIFFERENT point and rescale
 * the floor by `|p-c|/rho` before it bounds anything — new shader work,
 * not part of "re-enable the grid"). Reporting the two SEPARATELY, rather
 * than the combined-evaluation percentage the first cut of this section
 * reported, is the point of the split; the combined figure was always
 * exactly the mean of the two per-term rates (both terms fire once per
 * step on a balloon march), which is why it undersold the ambiguity. */
interface TermTally {
  n: number;
  inBox: number;
  posFloor64: number;
  posFloor32: number;
  skip64: number;
  skip32: number;
}

function emptyTermTally(): TermTally {
  return {
    n: 0,
    inBox: 0,
    posFloor64: 0,
    posFloor32: 0,
    skip64: 0,
    skip32: 0,
  };
}

interface EvalTally {
  fractal: TermTally;
  shell: TermTally;
}

function emptyTally(): EvalTally {
  return { fractal: emptyTermTally(), shell: emptyTermTally() };
}

interface GridCoverageCtx {
  halfExtent: number;
  cellRadius64: number;
  cellRadius32: number;
  visibleR: number;
  eps: number;
  grid64: SurfaceGrid | null;
  grid32: SurfaceGrid | null;
}

/** NEAREST-sample a built grid at `q`, exactly the way a texture fetch
 * would: floor `q` into the containing cell, clamped to the array bounds
 * (only ever exercised at the box's own edge, from `recordEval`'s `inBox`
 * guard — see its call site). */
function sampleGridNearest(grid: SurfaceGrid, q: Vec3): number {
  const { resolution, halfExtent, values } = grid;
  const cell = (2 * halfExtent) / resolution;
  const ix = Math.min(
    resolution - 1,
    Math.max(0, Math.floor((q[0] + halfExtent) / cell)),
  );
  const iy = Math.min(
    resolution - 1,
    Math.max(0, Math.floor((q[1] + halfExtent) / cell)),
  );
  const iz = Math.min(
    resolution - 1,
    Math.max(0, Math.floor((q[2] + halfExtent) / cell)),
  );
  return values[ix + resolution * (iy + resolution * iz)];
}

/** Classify one DE-evaluation query point, for ONE term, against the grid
 * box, the positive-floor sphere at both shipped resolutions, and (where
 * `ctx` carries a built grid) whether that grid's stored floor actually
 * clears `ctx.eps` — mirrors `buildSurfaceGridSlab`'s own `skipRadius`
 * formula (`visibleR * 1.02 + cellRadius`) rather than re-deriving it. */
function recordEval(
  t: EvalTally,
  q: Vec3,
  term: "fractal" | "shell",
  ctx: GridCoverageCtx,
): void {
  const b = term === "fractal" ? t.fractal : t.shell;
  b.n++;
  const inBox =
    Math.max(Math.abs(q[0]), Math.abs(q[1]), Math.abs(q[2])) <= ctx.halfExtent;
  if (!inBox) return;
  b.inBox++;
  const r = Math.hypot(q[0], q[1], q[2]);
  if (r <= ctx.visibleR * 1.02 + ctx.cellRadius64) {
    b.posFloor64++;
    if (ctx.grid64 && sampleGridNearest(ctx.grid64, q) > ctx.eps) b.skip64++;
  }
  if (r <= ctx.visibleR * 1.02 + ctx.cellRadius32) {
    b.posFloor32++;
    if (ctx.grid32 && sampleGridNearest(ctx.grid32, q) > ctx.eps) b.skip32++;
  }
}

function fmtTermTally(b: TermTally, gridBuilt: boolean): string {
  const pct = (n: number, d: number): string =>
    d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "n/a";
  const skip64 = gridBuilt ? pct(b.skip64, b.n) : `<=${pct(b.posFloor64, b.n)}`;
  const skip32 = gridBuilt ? pct(b.skip32, b.n) : `<=${pct(b.posFloor32, b.n)}`;
  return (
    `n=${b.n} inBox=${pct(b.inBox, b.n)}` +
    ` posFloorSphere@64=${pct(b.posFloor64, b.n)} @32=${pct(b.posFloor32, b.n)}` +
    ` gridSkip@64=${skip64} @32=${skip32}`
  );
}

/** Systems whose grid build fr-aj4w already measured as too costly to pay
 * twice (64^3 AND 32^3) inside one harness run — mandelboxKifs alone
 * (55.8s refined / 37.5s plain at 64^3 on the dev machine,
 * surface-grid-cost.harness.ts). Section (4) falls back to the geometric
 * upper bound (posFloorSphere%, which no grid can ever exceed) for these
 * instead of an actually-sampled grid, and discloses that substitution in
 * its own output rather than silently mixing the two kinds of number. */
const GRID_TOO_EXPENSIVE = new Set<string>(["mandelboxKifs preset"]);

/** fr-8yad soundness check (team-lead review of the first cut of this
 * section): "the shell clears the grid box" bounds the box's FARTHEST
 * point from the shell's NEAREST point, in aggregate — it does not by
 * itself certify that any one cell's STORED FLOOR (built from the
 * fractal-only estimator, floored by `cellRadius`) stays under that
 * cell's true distance to the shell. This measures the cell-by-cell claim
 * directly, over the grids section (4b) already built: for every cell
 * with a positive stored floor, compare it against a CONSERVATIVE lower
 * bound on that cell's distance to the shell,
 * `distToShellBound(x) = max(0, R^2/rho - |x-c|)`. This is sound by the
 * same argument the module doc already makes for `R^2/rho` itself: every
 * shell point `I(s)` has `|I(s)-c| = R^2/|s-c| >= R^2/rho` (since
 * `|s-c| <= rho`), so the WHOLE shell lies outside the ball of radius
 * `R^2/rho` about `c` — and the reverse triangle inequality then gives
 * `dist(x, shell) >= R^2/rho - |x-c|` for any `x` inside that ball, `0`
 * otherwise. `rho` here is `balloon.rho` — the MARGINED value
 * `estimateBalloonDistance`'s own `scale = |p-c|/rho` divides by, not a
 * raw radius this measurement recovers separately — so the bound matches
 * what the shipped wrapper actually certifies against, not an idealized
 * stand-in. A cell VIOLATES when `storedFloor > distToShellBound(cellCenter)`:
 * the floor is not a valid bound on distance-to-shell, so it is not safe
 * to use as a bound on distance-to-UNION regardless of what the aggregate
 * "shell clears the box" check says. */
interface SoundnessResult {
  cellsChecked: number;
  positiveFloors: number;
  violations: number;
  maxRatio: number;
  maxRatioIsInfinite: boolean;
  worstExcess: number;
  /** `floor / distToShellBound` at the CLOSEST call among ALL positive-floor
   * cells (violating or not) with `distToShellBound > 0` — 0 violations is
   * a much stronger claim when the nearest non-violating cell is also
   * reported: this is the margin's actual stress test, not just the pass
   * boolean. LOOSE — see {@link SoundnessResult.closestCallRatioExact}. */
  closestCallRatio: number;
  closestCallHasFiniteBound: boolean;
  /**
   * The SUFFICIENT condition's ratio, `(floor + cellRadius) /
   * distToShellBound`, and the one to read.
   *
   * The grid's contract is that a cell's stored value bounds the distance
   * from EVERY point of the cell, not from its centre — that is what
   * `buildSurfaceGridSlab`'s own `- cellRadius` buys on the fractal side,
   * and the shell side needs the same treatment. Requiring
   * `stored <= dist(p, shell)` for all `p` in the cell, and using
   * `dist(p, shell) >= dist(centre, shell) - cellRadius`, gives
   *
   *     DE(centre) - cellRadius <= dist(centre, shell) - cellRadius
   *       <=>  floor + cellRadius <= distToShellBound(centre)
   *
   * so comparing the bare `floor` against the CENTRE's bound is looser than
   * the condition by exactly one `cellRadius`, in the unsafe direction. Both
   * are reported because the gap between them is what a coarser grid costs:
   * `cellRadius` doubles from resolution 64 to 32, against an unchanged
   * shell distance, and `pickSurfaceGridResolution` downshifts to 32 under
   * load with nothing telling the user which one they got.
   */
  closestCallRatioExact: number;
  /** Violations under the SUFFICIENT condition above. This is the count that
   * decides whether "the shell clears the box" needs a floor clamp. */
  violationsExact: number;
}

function checkGridSoundness(
  grid: SurfaceGrid,
  balloon: Balloon,
): SoundnessResult {
  const { resolution, halfExtent, values } = grid;
  const cell = (2 * halfExtent) / resolution;
  // `buildSurfaceGridSlab`'s own half-space-diagonal, term for term.
  const cellRadius = (cell / 2) * Math.sqrt(3);
  const r2 = balloon.R * balloon.R;
  let cellsChecked = 0;
  let positiveFloors = 0;
  let violations = 0;
  let violationsExact = 0;
  let maxRatio = 0;
  let maxRatioIsInfinite = false;
  let worstExcess = 0;
  let closestCallRatio = 0;
  let closestCallRatioExact = 0;
  let closestCallHasFiniteBound = false;
  for (let z = 0; z < resolution; z++) {
    const cz = -halfExtent + (z + 0.5) * cell;
    for (let y = 0; y < resolution; y++) {
      const cy = -halfExtent + (y + 0.5) * cell;
      for (let x = 0; x < resolution; x++) {
        const cx = -halfExtent + (x + 0.5) * cell;
        cellsChecked++;
        const floor = values[x + resolution * (y + resolution * z)];
        if (floor <= 0) continue;
        positiveFloors++;
        const dCenter = Math.hypot(
          cx - balloon.c[0],
          cy - balloon.c[1],
          cz - balloon.c[2],
        );
        const distToShellBound = Math.max(0, r2 / balloon.rho - dCenter);
        if (distToShellBound > 0) {
          const ratio = floor / distToShellBound;
          if (ratio > closestCallRatio) {
            closestCallRatio = ratio;
            closestCallHasFiniteBound = true;
          }
          const exact = (floor + cellRadius) / distToShellBound;
          if (exact > closestCallRatioExact) closestCallRatioExact = exact;
        }
        if (floor + cellRadius > distToShellBound) violationsExact++;
        const excess = floor - distToShellBound;
        if (excess > 0) {
          violations++;
          if (excess > worstExcess) worstExcess = excess;
          if (distToShellBound > 0) {
            const ratio = floor / distToShellBound;
            if (ratio > maxRatio) maxRatio = ratio;
          } else {
            maxRatioIsInfinite = true;
          }
        }
      }
    }
  }
  return {
    cellsChecked,
    positiveFloors,
    violations,
    maxRatio,
    maxRatioIsInfinite,
    worstExcess,
    closestCallRatio,
    closestCallHasFiniteBound,
    closestCallRatioExact,
    violationsExact,
  };
}

function fmtSoundness(r: SoundnessResult): string {
  if (r.positiveFloors === 0) return "no positive-floor cells";
  const violFrac = ((r.violations / r.positiveFloors) * 100).toFixed(2);
  const ratioStr = r.maxRatioIsInfinite
    ? `inf (floor>0 at distToShellBound=0)`
    : r.maxRatio.toFixed(3);
  const closestStr = r.closestCallHasFiniteBound
    ? r.closestCallRatio.toFixed(3)
    : "n/a";
  const exactStr = r.closestCallHasFiniteBound
    ? r.closestCallRatioExact.toFixed(3)
    : "n/a";
  return (
    `positiveFloors=${r.positiveFloors} violations=${r.violations}` +
    ` (${violFrac}% of positive floors) maxViolationRatio=${ratioStr}` +
    ` worstExcess=${r.worstExcess.toExponential(2)}` +
    ` closestCall(floor/dist)=${closestStr}` +
    ` | SUFFICIENT: violations=${r.violationsExact}` +
    ` closestCall((floor+cellRadius)/dist)=${exactStr}` +
    ` (1.0 = right at the boundary, >1.0 = violation)`
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
      const { cam, rays, tFar, eps } = buildMarchSetup(rho, g.ball.c);
      const fmt = (m: MarchResult): string =>
        `hitF ${m.hitF} hitS ${m.hitS} far ${m.far} cap ${m.cap}` +
        ` | steps mu ${m.stepsMean.toFixed(1)} p95 ${m.stepsP95}` +
        ` | apps/ray ${m.appsPerRay.toFixed(0)}`;
      console.log(
        `-- ${sys.label} (${deHasFolds(g.de) ? "base/fold" : "refined"}):`,
      );
      const plain = runMarch(g.de, fn, cam, rays, tFar, eps, MARCH_STEPS, null);
      console.log(`   plain     : ${fmt(plain)}`);
      for (const rMult of R_REGIMES) {
        const m = runMarch(g.de, fn, cam, rays, tFar, eps, MARCH_STEPS, {
          ...g.ball,
          R: rMult * rho,
        });
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

  it("(4) fr-8yad: could the empty-space grid help a REST-state balloon march?", () => {
    const restMult = Math.max(...R_REGIMES);
    console.log(
      `\n== (4) fr-8yad: grid coverage of balloon-march DE evaluations ` +
        `(REST regime = ${restMult}rho, the largest of R_REGIMES=` +
        `[${R_REGIMES.join(", ")}]) ==`,
    );

    console.log(
      `-- (4a) validity premise: shell's nearest approach to c (R^2/rho, ` +
        `using the MARGINED balloon.rho that balloonEstimate's own ` +
        `scale=|p-c|/rho divides by — NOT a raw radius recovered ` +
        `separately) vs the box's far reach FROM c ` +
        `(|boundCenter| + sqrt(3)*halfExtent — the origin-offset` +
        ` correction; the box is origin-centred, the balloon is not) --`,
    );
    for (const sys of SYSTEMS) {
      const analysis = analyzeSurfaceSystem(sys.transforms, sys.final ?? null);
      if (analysis.status === "ineligible") continue;
      const g = ground(sys);
      const rho = g.ball.rho / BALLOON_RHO_MARGIN;
      const halfExtent = surfaceGridSpec(g.de).halfExtent;
      const farCorner = Math.sqrt(3) * halfExtent;
      const boundCenterNorm = Math.hypot(...g.ball.c);
      const boxFarFromC = boundCenterNorm + farCorner;
      console.log(
        `   ${sys.label}: halfExtent=${halfExtent.toFixed(4)}` +
          ` farCorner=${farCorner.toFixed(4)}` +
          ` |boundCenter|=${boundCenterNorm.toFixed(4)}` +
          ` boxFarFromC=${boxFarFromC.toFixed(4)}`,
      );
      for (const rMult of R_REGIMES) {
        const R = rMult * rho;
        const shellNear = (R * R) / g.ball.rho;
        const clears = shellNear > boxFarFromC;
        console.log(
          `     R=${String(rMult).padEnd(4)}rho: R^2/rho=` +
            `${shellNear.toFixed(4)} ${clears ? ">" : "<="} boxFarFromC=` +
            `${boxFarFromC.toFixed(4)} -> ` +
            `${clears ? "CLEARS" : "DOES NOT CLEAR"}` +
            `${rMult === restMult ? "  <-- rest" : ""}`,
        );
      }
    }

    console.log(
      `\n-- (4b)/(4c) at rest (R=${restMult}rho), production estimator per ` +
        `class, cutoff engaged. Coverage is reported PER TERM: a balloon ` +
        `march step makes ONE fractal-term eval (at the ray sample p — ` +
        `what "re-enable the grid" checks, same as the plain march does ` +
        `today) and ONE shell-term eval (at invert(p) — a SEPARATE, ` +
        `unproposed, uncosted opportunity that would need the grid read ` +
        `at a second point plus a |p-c|/rho rescale). gridSkip is read ` +
        `off an ACTUALLY-BUILT grid sampled NEAREST, except where marked, ` +
        `where it is the geometric upper bound (posFloorSphere%) instead. ` +
        `Soundness checks every positive-floor cell of that same grid ` +
        `against a conservative distance-to-shell bound --`,
    );
    for (const sys of SYSTEMS) {
      const analysis = analyzeSurfaceSystem(sys.transforms, sys.final ?? null);
      if (analysis.status === "ineligible") continue;
      const g = ground(sys);
      const rho = g.ball.rho / BALLOON_RHO_MARGIN;
      const fn: EstimatorFn = deHasFolds(g.de)
        ? estimateDistance
        : estimateDistanceRefined;
      const { cam, rays, tFar, eps } = buildMarchSetup(rho, g.ball.c);
      const halfExtent = surfaceGridSpec(g.de).halfExtent;
      const visibleR = g.de.visibleBoundingRadius;
      const cellRadius64 = ((2 * halfExtent) / 64 / 2) * Math.sqrt(3);
      const cellRadius32 = ((2 * halfExtent) / 32 / 2) * Math.sqrt(3);

      const gridBuilt = !GRID_TOO_EXPENSIVE.has(sys.label);
      let grid64: SurfaceGrid | null = null;
      let grid32: SurfaceGrid | null = null;
      if (gridBuilt) {
        const estimator = surfaceGridEstimator(g.de);
        grid64 = buildSurfaceGrid(g.de, 64, estimator);
        grid32 = buildSurfaceGrid(g.de, 32, estimator);
      }
      const ctx: GridCoverageCtx = {
        halfExtent,
        cellRadius64,
        cellRadius32,
        visibleR,
        eps,
        grid64,
        grid32,
      };

      const balloonRest: Balloon = { ...g.ball, R: restMult * rho };
      const balloonTally = emptyTally();
      runMarch(
        g.de,
        fn,
        cam,
        rays,
        tFar,
        eps,
        MARCH_STEPS,
        balloonRest,
        (p, term) => recordEval(balloonTally, p, term, ctx),
      );
      const plainTally = emptyTally();
      runMarch(g.de, fn, cam, rays, tFar, eps, MARCH_STEPS, null, (p, term) =>
        recordEval(plainTally, p, term, ctx),
      );

      console.log(
        `-- ${sys.label}` +
          `${gridBuilt ? "" : " [no grid: too expensive, geometric upper bound only]"}:`,
      );
      console.log(
        `     balloon(rest) fractal: ${fmtTermTally(balloonTally.fractal, gridBuilt)}`,
      );
      console.log(
        `     balloon(rest) shell  : ${fmtTermTally(balloonTally.shell, gridBuilt)}`,
      );
      console.log(
        `     plain         fractal: ${fmtTermTally(plainTally.fractal, gridBuilt)}`,
      );
      if (gridBuilt) {
        const bF = balloonTally.fractal;
        const pF = plainTally.fractal;
        const bS = balloonTally.shell;
        const bFractalRate64 = bF.skip64 / bF.n;
        const pFractalRate64 = pF.skip64 / pF.n;
        const bShellRate64 = bS.skip64 / bS.n;
        const scopedRatio =
          pFractalRate64 > 0 ? bFractalRate64 / pFractalRate64 : NaN;
        const combinedRate64 = (bF.skip64 + bS.skip64) / (bF.n + bS.n);
        console.log(
          `     -> bead AS SCOPED (fractal-term grid check only, @64): ` +
            `balloon ${bF.skip64}/${bF.n} steps ` +
            `(${(bFractalRate64 * 100).toFixed(1)}%) vs plain's ` +
            `${pF.skip64}/${pF.n} (${(pFractalRate64 * 100).toFixed(1)}%)` +
            `${
              Number.isFinite(scopedRatio)
                ? ` -- realizes ${(scopedRatio * 100).toFixed(1)}% of the` +
                  ` plain grid's rate`
                : ""
            }`,
        );
        console.log(
          `     -> shell-term extra (@64, NOT proposed / NOT costed): ` +
            `${bS.skip64}/${bS.n} steps ` +
            `(${(bShellRate64 * 100).toFixed(1)}%) additionally skippable` +
            ` if a second grid read + rescale were built`,
        );
        console.log(
          `     -> combined (both terms averaged, @64, the FIRST-CUT ` +
            `headline this section reported): ` +
            `${(combinedRate64 * 100).toFixed(1)}%`,
        );
      }

      if (gridBuilt && grid64 && grid32) {
        const s64 = checkGridSoundness(grid64, balloonRest);
        const s32 = checkGridSoundness(grid32, balloonRest);
        console.log(`     soundness@64: ${fmtSoundness(s64)}`);
        console.log(`     soundness@32: ${fmtSoundness(s32)}`);
      } else {
        console.log(`     soundness: not measured (no grid built)`);
      }
    }
    expect(true).toBe(true);
  }, 900_000);
});
