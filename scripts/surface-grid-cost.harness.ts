/**
 * Grid-build cost harness: what does an empty-space-grid build
 * (`buildSurfaceGrid`, `src/fractal/surface-grid.ts`) actually cost on a
 * pure-fold system (boxfold/spherefold/mandelbox variations)?
 *
 * Every 3D surface-mode enter builds a 64^3-cell grid by calling
 * `estimateDistanceRefined(de, cellCenter, cellRadius)` once per cell. That
 * estimator is a beam of inverse-map descents (up to `de.maxDepth` levels),
 * and on fold systems each descent LEVEL fans one visited map out into
 * 27/3/81 branches (`SURFACE_FOLD_*`) instead of the affine ladder's single
 * child. It was suspected — UNMEASURED before this harness — that this
 * makes a fold-system grid build take minutes instead of the ~2s an affine
 * system pays. This file produces the numbers behind that split: this
 * harness itself changes no production code, only measures it, but
 * `buildSurfaceGridSlab`/`buildSurfaceGrid`'s `estimator` parameter
 * (`surface-grid.ts`) now defaults to `surfaceGridEstimator`'s
 * per-system choice — `"plain"` for fold systems, `"refined"` for affine —
 * rather than the flat `"refined"` it shipped with before this harness's
 * verdict (below) justified the split.
 *
 * METHODOLOGY. Two shipped affine presets (`default`, `sierpinski`) as a
 * cheap baseline, the four synthetic pure-fold pairs from
 * `harness-profiles.ts` (`foldBoxfoldPair`, `foldBoxfoldNegPlusAffine`,
 * `foldSpherefoldPair`, `foldMandelboxPair` — extracted verbatim from
 * `surface-beam.harness.ts`'s pure-fold section so both harnesses measure
 * the IDENTICAL frozen profiles), and the shipped `mandelboxKifs` preset (12
 * maps: 8 mandelbox corners + 4 boxfold binders) — the acceptance-criterion
 * system the pure-fold branch sweep itself measured against, and the row
 * that matters most here. `mandelboxKifs` is measured right after the two
 * cheap affine rows, ahead of the four synthetic pairs, so it gets first
 * claim on the time budget below rather than risking starvation if an
 * earlier row runs long.
 *
 * For each system x estimator (`"plain"` = {@link estimateDistance},
 * `"refined"` = {@link estimateDistanceRefined}) x resolution (32, 48, 64),
 * one real `buildSurfaceGrid` call is timed (`performance.now()`) and
 * simultaneously wrapped in `countingDE(de, 4)` so the SAME call also
 * yields the inverse-map-visit count (a machine-independent cost currency,
 * shared with `surface-beam.harness.ts`) — one build serves both numbers
 * rather than paying the descent twice. `beamWidth` is pinned to 4
 * regardless of estimator or system: that is what `buildSurfaceDE` always
 * ships, and fold systems ignore it anyway (they route through
 * `descendFold`'s fixed-width frontier). Floor quality is read off the same
 * build's `values`: the fraction of cells with a stored floor `> 0`, and
 * the median of the POSITIVE floors as a fraction of `de.boundingRadius` —
 * the proxy for what a weaker (`"plain"`) estimator gives up: fewer, and
 * shorter, marcher skips.
 *
 * TIMEOUT GUARD (as specified). Resolution 32 always runs, for every
 * system x estimator. Its wall time projects 48 (`x3.375 = (48/32)^3`) and
 * 64 (`x8 = (64/32)^3`) under a constant-cost-per-cell assumption; a
 * resolution whose PROJECTION exceeds `PROJECTION_CUTOFF_MS` (240s) is
 * never run — its row prints `PROJECTED <s>` instead, which reads as a
 * measurement in its own right (a system that projects to
 * multiple minutes at 64^3 already answers the "does this take minutes"
 * question without spending the minutes). The projection is a heuristic
 * (constant per-cell cost), not a certified bound — a smaller `cellRadius`
 * at finer resolutions gives the early-out cutoff less slack, so real
 * scaling could run somewhat above cubic — but it is the specified
 * methodology and cheap to compute.
 *
 * GLOBAL TIME BUDGET (added beyond the specified guard, for this harness's
 * own safety). The per-resolution guard bounds any ONE build, but does not
 * bound the SUM across 7 systems x 2 estimators x up to 3 resolutions each
 * — a run of merely-under-cutoff builds could still add up past what the
 * runner invoking this harness can wait for. `GLOBAL_BUDGET_MS` (5 minutes
 * of accumulated REAL, i.e. non-projected/non-skipped, build time) is
 * checked before every build that isn't the system's mandatory resolution
 * 32; once exhausted, remaining cells print `SKIPPED` instead of a
 * projection. Chosen so a run comfortably finishes inside a 10-minute outer
 * wall-clock ceiling even if every row happens to sit right at the
 * per-cell cutoff, well under this config's own 900s per-test timeout.
 *
 * MEASURED VERDICT (dev machine, 2026-07-27): the feared minutes-long refined
 * fold build is real in direction, not magnitude — mandelboxKifs (12 maps)
 * costs 55.8s refined vs 37.5s plain at 64^3 (~1.5x, same ratio in inverse-map
 * visits), the 2-map fold pairs 0.3-13.4s with plain==refined within noise,
 * affine presets 0.13-0.29s. Floor quality is estimator-invariant in practice:
 * positive-floor fraction within ~0.6 points, median floor within ~0.7%R, at
 * every resolution measured. Per-cell cost spans ~40x across systems (boxfold
 * pair 2.6k visits/1k-cells vs mandelboxKifs 88.7k) and tracks descent depth +
 * branch count, not fold-kind alone, so no static predicate prices a build.
 * Shipped policy: surfaceGridEstimator (plain floors for fold systems — GLSL
 * march parity plus the free ~1.5x; refined kept for affine) and the worker's
 * measured pilot slab feeding pickSurfaceGridResolution (64->48->32 under
 * SURFACE_GRID_BUDGET_MS=3000, floored at 32, never skipped).
 *
 * Usage:
 *   npx vitest run --config scripts/vitest.harness.config.ts scripts/surface-grid-cost.harness.ts
 *
 * Like surface-beam.harness.ts, this file lives outside the main vitest
 * include and the tsc program: it only runs via the harness config.
 */
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
} from "../src/fractal/surface-de";
import type { SurfaceDE } from "../src/fractal/surface-de";
import { buildSurfaceGrid } from "../src/fractal/surface-grid";
import type { SurfaceGridEstimator } from "../src/fractal/surface-grid";
import {
  defaultTransforms,
  mandelboxKifs,
  sierpinskiTetrahedron,
} from "../src/fractal/presets";
import type { Transform } from "../src/fractal/types";
import {
  countingDE,
  foldBoxfoldNegPlusAffine,
  foldBoxfoldPair,
  foldMandelboxPair,
  foldSpherefoldPair,
} from "./harness-profiles";

/** Neither estimator is run past this projected cost — see the module doc's
 * TIMEOUT GUARD paragraph. */
const PROJECTION_CUTOFF_MS = 240_000;

/** `(48/32)^3` and `(64/32)^3`: cell-count scaling off the mandatory
 * resolution-32 baseline, under a constant-per-cell-cost assumption. */
const SCALE_48 = 3.375;
const SCALE_64 = 8;

/** Total accumulated REAL (non-projected, non-skipped) build time this
 * harness spends before it starts printing `SKIPPED` instead of running —
 * see the module doc's GLOBAL TIME BUDGET paragraph. */
const GLOBAL_BUDGET_MS = 300_000;

const ESTIMATORS: readonly SurfaceGridEstimator[] = ["plain", "refined"];
const RESOLUTIONS = [32, 48, 64] as const;

interface RanRow {
  resolution: number;
  status: "ran";
  wallMs: number;
  visits: number;
  visitsPer1k: number;
  posFrac: number;
  medFloorFracR: number;
}

interface ProjectedRow {
  resolution: number;
  status: "projected";
  projectedMs: number;
}

interface SkippedRow {
  resolution: number;
  status: "skipped";
  /** `null` when the global budget was already spent before this system's
   * mandatory resolution-32 build — there is no resolution-32 wall time to
   * project from in that case. */
  projectedMs: number | null;
}

type ResRow = RanRow | ProjectedRow | SkippedRow;

/** One timed `buildSurfaceGrid` call, wrapped in `countingDE` so the same
 * call yields both the wall time and the inverse-map-visit count (see the
 * module doc: one build, not two, serves both numbers). Floor-quality stats
 * are read off the same build's output. */
function measureBuild(
  de: SurfaceDE,
  resolution: number,
  estimator: SurfaceGridEstimator,
): RanRow {
  const { de: counted, counter } = countingDE(de, 4);
  const t0 = performance.now();
  const grid = buildSurfaceGrid(counted, resolution, estimator);
  const wallMs = performance.now() - t0;
  const { values } = grid;
  let positive = 0;
  const nonzero: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v > 0) {
      positive++;
      nonzero.push(v);
    }
  }
  nonzero.sort((a, b) => a - b);
  const medianFloor =
    nonzero.length > 0 ? nonzero[Math.floor(nonzero.length / 2)] : 0;
  return {
    resolution,
    status: "ran",
    wallMs,
    visits: counter.n,
    visitsPer1k: (counter.n / values.length) * 1000,
    posFrac: positive / values.length,
    medFloorFracR: medianFloor / de.boundingRadius,
  };
}

/** Resolution 32 (mandatory, unless the global budget is already spent),
 * then 48 and 64 gated by the timeout guard projected off 32's wall time —
 * see the module doc's TIMEOUT GUARD and GLOBAL TIME BUDGET paragraphs. */
function measureSystemEstimator(
  de: SurfaceDE,
  estimator: SurfaceGridEstimator,
  budget: { usedMs: number },
): ResRow[] {
  if (budget.usedMs >= GLOBAL_BUDGET_MS) {
    return RESOLUTIONS.map((resolution): SkippedRow => ({
      resolution,
      status: "skipped",
      projectedMs: null,
    }));
  }
  const row32 = measureBuild(de, 32, estimator);
  budget.usedMs += row32.wallMs;
  const rows: ResRow[] = [row32];

  for (const [resolution, scale] of [
    [48, SCALE_48],
    [64, SCALE_64],
  ] as const) {
    const projectedMs = row32.wallMs * scale;
    if (budget.usedMs >= GLOBAL_BUDGET_MS) {
      rows.push({ resolution, status: "skipped", projectedMs });
    } else if (projectedMs > PROJECTION_CUTOFF_MS) {
      rows.push({ resolution, status: "projected", projectedMs });
    } else {
      const row = measureBuild(de, resolution, estimator);
      budget.usedMs += row.wallMs;
      rows.push(row);
    }
  }
  return rows;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;
}

function fmtRow(estimator: SurfaceGridEstimator, row: ResRow): string {
  const estStr = estimator.padEnd(8);
  const resStr = String(row.resolution).padStart(4);
  if (row.status === "ran") {
    const wallStr = fmtMs(row.wallMs).padStart(11);
    const visitsStr = String(row.visits).padStart(10);
    const perKStr = row.visitsPer1k.toFixed(1).padStart(10);
    const posFracStr = `${(row.posFrac * 100).toFixed(1)}%`.padStart(8);
    const medFloorStr = `${(row.medFloorFracR * 100).toFixed(3)}%`.padStart(11);
    return `${estStr}${resStr}  ${wallStr}  ${visitsStr}  ${perKStr}  ${posFracStr}  ${medFloorStr}`;
  }
  const scale = row.resolution === 48 ? SCALE_48 : SCALE_64;
  if (row.status === "projected") {
    return (
      `${estStr}${resStr}  PROJECTED ${(row.projectedMs / 1000).toFixed(1)}s` +
      ` (x${scale} of res32 wall; over the ${PROJECTION_CUTOFF_MS / 1000}s cutoff)`
    );
  }
  const projText =
    row.projectedMs === null
      ? ""
      : ` (proj ${(row.projectedMs / 1000).toFixed(1)}s)`;
  return `${estStr}${resStr}  SKIPPED${projText} -- global time budget exhausted`;
}

interface CostSystem {
  label: string;
  transforms: Transform[];
}

describe("surface grid cost harness", () => {
  it("sanity: identical specs and plain<=refined monotonicity per cell", () => {
    const sanitySystems: CostSystem[] = [
      { label: "default", transforms: defaultTransforms() },
      { label: "spherefold pair", transforms: foldSpherefoldPair() },
    ];
    const SANITY_RESOLUTION = 32;
    const failures: string[] = [];
    for (const sys of sanitySystems) {
      const analysis = analyzeSurfaceSystem(sys.transforms);
      if (analysis.status === "ineligible") {
        failures.push(
          `${sys.label}: unexpectedly ineligible (${analysis.reasons.join("; ")})`,
        );
        continue;
      }
      const de = buildSurfaceDE(sys.transforms);
      const plainGrid = buildSurfaceGrid(de, SANITY_RESOLUTION, "plain");
      const refinedGrid = buildSurfaceGrid(de, SANITY_RESOLUTION, "refined");

      if (
        plainGrid.resolution !== refinedGrid.resolution ||
        plainGrid.halfExtent !== refinedGrid.halfExtent
      ) {
        failures.push(
          `${sys.label}: spec mismatch between estimators (plain res=` +
            `${plainGrid.resolution} halfExtent=${plainGrid.halfExtent},` +
            ` refined res=${refinedGrid.resolution}` +
            ` halfExtent=${refinedGrid.halfExtent})`,
        );
      }

      let violations = 0;
      let maxExcess = 0;
      for (let i = 0; i < plainGrid.values.length; i++) {
        const p = plainGrid.values[i];
        const r = refinedGrid.values[i];
        if (p > r) {
          violations++;
          maxExcess = Math.max(maxExcess, p - r);
        }
      }
      console.log(
        `-- sanity ${sys.label}: cells=${plainGrid.values.length}` +
          ` monotonicity violations=${violations}` +
          (violations > 0 ? ` maxExcess=${maxExcess.toExponential(2)}` : ""),
      );
      if (violations > 0) {
        failures.push(
          `${sys.label}: plain > refined on ${violations} cells` +
            ` (maxExcess=${maxExcess.toExponential(2)})`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("measures grid-build wall time, inverse-map visits, and floor quality per system, estimator, resolution", () => {
    const systems: CostSystem[] = [
      { label: "default", transforms: defaultTransforms() },
      { label: "sierpinski", transforms: sierpinskiTetrahedron() },
      // The shipped fold preset — the row that matters most — measured
      // right after the cheap affine baselines so it is never starved by
      // the global time budget (module doc).
      { label: "mandelboxKifs preset", transforms: mandelboxKifs() },
      { label: "boxfold pair", transforms: foldBoxfoldPair() },
      {
        label: "boxfold -w + affine",
        transforms: foldBoxfoldNegPlusAffine(),
      },
      { label: "spherefold pair", transforms: foldSpherefoldPair() },
      { label: "mandelbox pair", transforms: foldMandelboxPair() },
    ];
    console.log(
      `\n== surface-grid cost (resolutions 32/48/64;` +
        ` global budget ${(GLOBAL_BUDGET_MS / 1000).toFixed(0)}s,` +
        ` per-cell projection cutoff ${(PROJECTION_CUTOFF_MS / 1000).toFixed(0)}s) ==`,
    );
    console.log(
      `  ${"est".padEnd(8)}${"res".padStart(4)}  ${"wall".padStart(11)}` +
        `  ${"visits".padStart(10)}  ${"visits/1k".padStart(10)}` +
        `  ${"posFrac".padStart(8)}  ${"medFloor%R".padStart(11)}`,
    );

    const budget = { usedMs: 0 };
    for (const sys of systems) {
      const analysis = analyzeSurfaceSystem(sys.transforms);
      if (analysis.status === "ineligible") {
        console.log(
          `-- ${sys.label}: INELIGIBLE (${analysis.reasons.join("; ")})`,
        );
        continue;
      }
      const de = buildSurfaceDE(sys.transforms);
      console.log(
        `-- ${sys.label}: maps=${de.maps.length} status=${analysis.status}` +
          ` R=${de.boundingRadius.toFixed(4)} maxDepth=${de.maxDepth}` +
          ` beamWidth=${de.beamWidth}`,
      );
      for (const estimator of ESTIMATORS) {
        const rows = measureSystemEstimator(de, estimator, budget);
        for (const row of rows) {
          console.log(`  ${fmtRow(estimator, row)}`);
        }
      }
    }
    console.log(
      `\n(accumulated real build time: ${(budget.usedMs / 1000).toFixed(1)}s` +
        ` of ${(GLOBAL_BUDGET_MS / 1000).toFixed(0)}s budget)`,
    );
    expect(true).toBe(true);
  }, 480_000);
});
