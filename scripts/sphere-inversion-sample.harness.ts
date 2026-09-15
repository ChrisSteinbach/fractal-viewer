/**
 * The sphere-inversion Points sampler's COST: what a boundary sample of the
 * depth-D seed orbit (`src/fractal/sphere-inversion-sample.ts`) costs on the
 * family's subjects, so the Points budget is a measured policy rather than a
 * guess. The set-identity evidence is the unit tests'
 * (`sphere-inversion-sample.test.ts`); this sheet only times and counts.
 * Verdict and numbers: `docs/harness-sheets.md` and
 * `docs/sphere-inversion-family.md`.
 *
 *   npx vitest run --config scripts/vitest.harness.config.ts scripts/sphere-inversion-sample.harness.ts
 *
 * Per row: the prepare (patch enumeration + fixed-seed pilot) in ms, the
 * steady sampling cost in ns per emitted point over a 200k-point cloud, the
 * skipped fraction (points whose bounded budget ran out), the patch count,
 * and the generation histogram. Timing is the median of three runs on one
 * core; the chaos game on the default preset is timed beside it as the
 * reference the Points budget already absorbs.
 */
import { runChaosGame } from "../src/fractal/chaos-game";
import { iterationRng, mulberry32 } from "../src/fractal/rng";
import { resolveSphereInversion } from "../src/fractal/sphere-inversion";
import type { SphereInversionAuthored } from "../src/fractal/sphere-inversion";
import {
  prepareSphereInversionSampler,
  sampleSphereInversionCloud,
} from "../src/fractal/sphere-inversion-sample";
import { initialState } from "../src/app/state";

const POINTS = 200_000;

function construction(authored: SphereInversionAuthored) {
  const r = resolveSphereInversion(authored);
  if (!r.ok) throw new Error(r.reasons.join("; "));
  return r.construction;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const ROWS: [string, SphereInversionAuthored][] = [
  ["oct6 pearls D8 (3D)", { arrangement: "oct6", depth: 8 }],
  [
    "oct6 kissing pearls D8 (3D)",
    { arrangement: "oct6", radiusFraction: 1, depth: 8 },
  ],
  [
    "ico12 lace shell D6 (3D)",
    { arrangement: "ico12", seed: { kind: "shell" }, depth: 6 },
  ],
  [
    "ico12 vault D8 (3D)",
    { arrangement: "ico12", seed: { kind: "cutShell" }, depth: 8 },
  ],
  [
    "cell24 shell .98 D5 (4D)",
    {
      arrangement: "cell24",
      radiusFraction: 0.98,
      seed: { kind: "shell" },
      depth: 5,
    },
  ],
  [
    "cell600 vault D5 (4D)",
    {
      arrangement: "cell600",
      seed: { kind: "cutShell", size: 0.9, thickness: 0.04 },
      depth: 5,
    },
  ],
  [
    "cell600 medallion D5 (4D)",
    {
      arrangement: "cell600",
      seed: { kind: "shell", size: 1.1, thickness: 0.03 },
      depth: 5,
    },
  ],
  [
    "cell600 vault D10 (4D, candidate range top)",
    {
      arrangement: "cell600",
      seed: { kind: "cutShell", size: 0.9, thickness: 0.04 },
      depth: 10,
    },
  ],
];

describe("sphere-inversion Points sampler cost", () => {
  it("reference: the chaos game on the default preset", () => {
    const state = initialState(false);
    const ns: number[] = [];
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      runChaosGame(
        state.transforms,
        POINTS,
        mulberry32(run + 1),
        state.finalTransform ?? null,
        state.symmetry,
        iterationRng(run + 7),
        null,
      );
      ns.push(((performance.now() - t0) * 1e6) / POINTS);
    }
    console.log(
      `chaos game, default preset: ${median(ns).toFixed(0)} ns/point (${POINTS} points)`,
    );
  });

  for (const [label, authored] of ROWS) {
    it(label, () => {
      const c = construction(authored);
      const prepareMs: number[] = [];
      let sampler = prepareSphereInversionSampler(c);
      for (let run = 0; run < 3; run++) {
        const t0 = performance.now();
        sampler = prepareSphereInversionSampler(c);
        prepareMs.push(performance.now() - t0);
      }
      const ns: number[] = [];
      let count = 0;
      let generations: Uint8Array = new Uint8Array(0);
      for (let run = 0; run < 3; run++) {
        const t0 = performance.now();
        const cloud = sampleSphereInversionCloud(
          sampler,
          POINTS,
          mulberry32(0x5a + run),
        );
        const dt = performance.now() - t0;
        ns.push((dt * 1e6) / Math.max(1, cloud.count));
        count = cloud.count;
        generations = cloud.generations;
      }
      const hist = new Array<number>(c.depth + 1).fill(0);
      for (const g of generations) hist[g]++;
      const walls = sampler.patches.filter((p) => p.kind === "wall").length;
      console.log(
        [
          label,
          `  prepare ${median(prepareMs).toFixed(1)} ms; sample ${median(ns).toFixed(0)} ns/point`,
          `  emitted ${count}/${POINTS} (skipped ${(((POINTS - count) / POINTS) * 100).toFixed(3)}%)`,
          `  patches ${sampler.patches.length} (${walls} walls)`,
          `  generations ${hist.map((h) => ((h / Math.max(1, count)) * 100).toFixed(1)).join("/")} %`,
        ].join("\n"),
      );
      expect(count).toBeGreaterThan(0);
    });
  }
});
