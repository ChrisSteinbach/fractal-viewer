/**
 * Measurement harness for the banded adaptive density-estimate pass —
 * `flame.ts`'s `createAdaptiveDownsampleJob`, which the flame worker drives
 * across scheduler ticks so the finished-frame estimate reports determinate
 * progress instead of an opaque multi-second wait.
 *
 * This sheet answers, with numbers:
 *  (1) is a banded run byte-identical to the one-shot `adaptiveDownsampleFlame`
 *      at production-ish size, at band budgets from one cell to unbounded?
 *  (2) does the work accounting stay monotonic and reach `total` exactly?
 *  (3) what does the PLAN phase cost relative to the gather it predicts?
 *
 * MEASURED VERDICT (2026-09-13, Node 22.23.2, i7-1165G7, a thin 800x450
 * source at 2% occupancy, 400x225 output — the shape the epic's measured
 * genomes have: nearly every cell asks the widest kernel and the occupancy
 * skip rarely fires):
 *   - Banded and one-shot output are byte-identical at every budget tried,
 *     and `done` reaches `total` exactly (whole-number work units).
 *   - The plan costs ~8ms against a 2.19s (defaults) / 6.68s (imported
 *     params) pass: 0.36% / 0.12% of the total, i.e. the pre-pass that buys
 *     determinate progress is free at frame scale. Throughput is 206-212M
 *     taps/s.
 *
 * The plan/gather split also produced the implementation note the code
 * carries: a closure-slot read per tap (the gather as a job-closure method)
 * measured ~13% slower than the same loop with local arrays, and a flat
 * indexed `while` measured ~5% slower than nested row/column loops on the
 * same fixture. Both phases therefore live in TOP-LEVEL functions that bind
 * their arrays and dimensions to locals, at parity with the pre-banding
 * implementation within run-to-run noise (interleaved A/B against a `main`
 * worktree on the same process, 6 rounds x 2 param sets: min delta -1.5% to
 * +1.0%).
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/flame-estimate-progress.harness.ts
 */
import {
  adaptiveDownsampleFlame,
  createAdaptiveDownsampleJob,
  createFlameHistogram,
} from "../src/fractal/flame";
import type {
  DensityEstimatorParams,
  FlameHistogram,
} from "../src/fractal/flame";
import { mulberry32 } from "../src/fractal/rng";

const OUT_W = 400;
const OUT_H = 225;
const SUPERSAMPLE = 2;
const COVERAGE = 0.02;
const SEED = 7;

/** A thin, noisy frame: `COVERAGE` of source cells carry 1 hit, mirroring the
 * measured genomes' almost-every-cell-asks-the-widest-radius shape. */
function thinFrame(): FlameHistogram {
  const w = OUT_W * SUPERSAMPLE;
  const h = OUT_H * SUPERSAMPLE;
  const hist = createFlameHistogram(w, h);
  const rand = mulberry32(SEED);
  const count = Math.round(w * h * COVERAGE);
  for (let i = 0; i < count; i++) {
    const x = (rand() * w) | 0;
    const y = (rand() * h) | 0;
    const bucket = y * w + x;
    hist.hits[bucket] += 1;
    hist.sumRGB[bucket * 3] += 0.3;
    hist.sumRGB[bucket * 3 + 1] += 0.6;
    hist.sumRGB[bucket * 3 + 2] += 0.9;
  }
  return hist;
}

/** The imported genomes' authored estimator params (r=11, c=0.6, min=0) and
 * the app's defaults (6/0.4/2). */
const PARAM_SETS: { label: string; params: DensityEstimatorParams }[] = [
  {
    label: "imported 11/0.6/0",
    params: {
      estimatorRadius: 11,
      estimatorMinimumRadius: 0,
      estimatorCurve: 0.6,
    },
  },
  {
    label: "defaults 6/0.4/2",
    params: {
      estimatorRadius: 6,
      estimatorMinimumRadius: 2,
      estimatorCurve: 0.4,
    },
  },
];

describe("flame estimate progress sheet", () => {
  it("a banded pass is byte-identical to the one-shot at every band budget", () => {
    const source = thinFrame();
    const params = PARAM_SETS[1].params; // the cheaper set: several full passes.
    const oneShot = adaptiveDownsampleFlame(source, OUT_W, OUT_H, params);
    for (const budget of [1, 257, 30_000_000, Infinity]) {
      const job = createAdaptiveDownsampleJob(source, OUT_W, OUT_H, params);
      let previous = 0;
      while (!job.run(budget)) {
        // Whole-number work units make the band sums exact: strict progress
        // every call, never past the total, and exactly the total at the end.
        expect(job.done).toBeGreaterThan(previous);
        expect(job.done).toBeLessThanOrEqual(job.total);
        previous = job.done;
      }
      expect(job.done).toBe(job.total);
      const out = job.result();
      expect(Array.from(out.hits)).toEqual(Array.from(oneShot.hits));
      expect(Array.from(out.sumRGB)).toEqual(Array.from(oneShot.sumRGB));
      expect(out.maxHits).toBe(oneShot.maxHits);
      expect(out.hitMass).toBe(oneShot.hitMass);
    }
  });

  it("prints the plan share and throughput for both param sets", () => {
    const source = thinFrame();
    for (const { label, params } of PARAM_SETS) {
      // Warm both phases once before timing.
      adaptiveDownsampleFlame(source, 80, 45, params);

      const t0 = performance.now();
      const job = createAdaptiveDownsampleJob(source, OUT_W, OUT_H, params);
      const planMs = performance.now() - t0;
      while (!job.run(30_000_000)) {
        /* banded */
      }
      const totalMs = performance.now() - t0;
      const gatherMs = totalMs - planMs;
      const work = job.total;
      console.log(
        `[estimate ${label}] plan=${planMs.toFixed(1)}ms ` +
          `gather=${gatherMs.toFixed(0)}ms total=${totalMs.toFixed(0)}ms ` +
          `planShare=${((planMs / totalMs) * 100).toFixed(2)}% ` +
          `work=${work} taps/s=${(((work / gatherMs) * 1000) / 1e6).toFixed(0)}M ` +
          `done===total=${job.done === work}`,
      );
    }
  });
});
