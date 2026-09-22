/**
 * Sphere-inversion CPU cost AGAINST GENERATOR COUNT: what one estimator
 * query and one Points sample cost at every registry arrangement, 4 to 120
 * generators, at the family's representative seeds — the CPU half of the
 * generator-count cost record. The covering tables are n + s + n(s + n − 1)
 * generalized balls, so the question is whether cost bends quadratically
 * anywhere in the band the look study's ids (4, 20, 24, 30) opened, which no
 * earlier row measured in 3D. The GPU half is the bench's timing rows and
 * the cost probe's `gencount` plan. Verdict and numbers:
 * `docs/sphere-inversion-family.md` ("Cost against generator count") and
 * `docs/harness-sheets.md`.
 *
 *   npx vitest run --config scripts/vitest.harness.config.ts scripts/sphere-inversion-gencount.harness.ts
 *
 * Per row, on one core, each figure the median of three runs:
 *   - eval uniform: µs per `estimateSphereInversionDistance(4)` over 20,000
 *     points uniform in the construction's bounding ball (in 4D, the 3-ball
 *     of the w = 0 slice, the slice every identity-pose session queries);
 *   - eval near: µs per query over 20,000 points 0.005 off the set, each a
 *     Points boundary sample pushed out along a random direction — the
 *     near-set queries a sphere tracer spends its steps on;
 *   - table balls: n + s + n(s + n − 1), the packer's own count;
 *   - Points: the sampler's prepare in ms and its steady cost in ns per
 *     emitted point over a 200k cloud, and the skipped fraction.
 * Seeds are the cost probe's representatives (3D ball .28, shell 1 ± .03,
 * cut shell 1 ± .06; 4D ball .28, shell 1.1 ± .03, cut shell .9 ± .04) at
 * radius fraction .99, D8 in 3D and D5 in 4D, so these rows sit beside the
 * probe's.
 */
import { mulberry32 } from "../src/fractal/rng";
import {
  SPHERE_INVERSION_ARRANGEMENTS,
  resolveSphereInversion,
} from "../src/fractal/sphere-inversion";
import type {
  SphereInversionAuthored,
  SphereInversionAuthoredSeed,
} from "../src/fractal/sphere-inversion";
import {
  buildSphereInversionDE,
  estimateSphereInversionDistance,
} from "../src/fractal/sphere-inversion-de";
import {
  buildSphereInversionDE4,
  estimateSphereInversionDistance4,
} from "../src/fractal/sphere-inversion-de-4d";
import {
  prepareSphereInversionSampler,
  sampleSphereInversionCloud,
  sampleSphereInversionPoint,
} from "../src/fractal/sphere-inversion-sample";
import { sphereInversionTableEntries } from "../src/fractal/surface-sphere-inversion-gpu";
import type { Vec3, Vec4 } from "../src/fractal/types";

const QUERIES = 20_000;
const POINTS = 200_000;
const NEAR_OFFSET = 0.005;

const SEEDS: Record<3 | 4, Record<string, SphereInversionAuthoredSeed>> = {
  3: {
    ball: { kind: "ball", size: 0.28 },
    shell: { kind: "shell", size: 1, thickness: 0.03 },
    cutShell: { kind: "cutShell", size: 1, thickness: 0.06 },
  },
  4: {
    ball: { kind: "ball", size: 0.28 },
    shell: { kind: "shell", size: 1.1, thickness: 0.03 },
    cutShell: { kind: "cutShell", size: 0.9, thickness: 0.04 },
  },
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** A uniform point in the ball of radius R, in `dim` coordinates (the last
 * one 0 in 4D: the identity slice). */
function uniformInBall(rng: () => number, R: number, dim: 3 | 4): number[] {
  for (;;) {
    const p = [0, 0, 0].map(() => (2 * rng() - 1) * R);
    if (Math.hypot(...p) <= R) return dim === 3 ? p : [...p, 0];
  }
}

function randomUnit(rng: () => number, dim: 3 | 4): number[] {
  for (;;) {
    const v = Array.from({ length: dim }, () => 2 * rng() - 1);
    const n = Math.hypot(...v);
    if (n > 1e-3 && n <= 1) return v.map((x) => x / n);
  }
}

const rows = Object.entries(SPHERE_INVERSION_ARRANGEMENTS)
  .map(([id, arr]) => ({ id, dim: arr.dim, n: arr.centers.length }))
  .sort((a, b) => a.dim - b.dim || a.n - b.n);

describe("sphere-inversion CPU cost against generator count", () => {
  for (const { id, dim, n } of rows) {
    for (const [seedName, seed] of Object.entries(SEEDS[dim])) {
      it(`${id} (${n}) ${seedName}`, () => {
        const authored: SphereInversionAuthored = {
          arrangement: id,
          radiusFraction: 0.99,
          seed,
          depth: dim === 3 ? 8 : 5,
        };
        const r = resolveSphereInversion(authored);
        if (!r.ok) throw new Error(r.reasons.join("; "));
        const c = r.construction;
        const de =
          dim === 3 ? buildSphereInversionDE(c) : buildSphereInversionDE4(c);
        const evalAt =
          dim === 3
            ? (p: number[]) => estimateSphereInversionDistance(de, p as Vec3)
            : (p: number[]) => estimateSphereInversionDistance4(de, p as Vec4);

        // Query sets, drawn once so every timing run reads the same points.
        const rng = mulberry32(0x5eed + n);
        const uniform = Array.from({ length: QUERIES }, () =>
          uniformInBall(rng, de.boundingRadius, dim),
        );
        const sampler = prepareSphereInversionSampler(c);
        const onSet = new Float64Array(dim);
        const near: number[][] = [];
        for (let guard = 0; near.length < QUERIES && guard < QUERIES * 4;) {
          guard++;
          if (sampleSphereInversionPoint(sampler, rng, onSet) < 0) continue;
          const u = randomUnit(rng, dim);
          near.push(u.map((x, a) => onSet[a] + NEAR_OFFSET * x));
        }

        const time = (pts: number[][]) => {
          const us: number[] = [];
          let sink = 0;
          for (let run = 0; run < 3; run++) {
            const t0 = performance.now();
            for (const p of pts) sink += evalAt(p);
            us.push(((performance.now() - t0) * 1000) / pts.length);
          }
          expect(Number.isFinite(sink)).toBe(true);
          return median(us);
        };
        const uniformUs = time(uniform);
        const nearUs = time(near);

        const prepareMs: number[] = [];
        const nsPerPoint: number[] = [];
        let skipped = 0;
        for (let run = 0; run < 3; run++) {
          const t0 = performance.now();
          const s = prepareSphereInversionSampler(c);
          const t1 = performance.now();
          const cloud = sampleSphereInversionCloud(
            s,
            POINTS,
            mulberry32(run + 1),
          );
          const t2 = performance.now();
          prepareMs.push(t1 - t0);
          nsPerPoint.push(((t2 - t1) * 1e6) / Math.max(cloud.count, 1));
          skipped = 1 - cloud.count / POINTS;
        }

        const balls = sphereInversionTableEntries(n, c.seed.length);
        console.log(
          `${dim}D ${id.padEnd(14)} n=${String(n).padStart(3)} ${seedName.padEnd(8)} ` +
            `balls=${String(balls).padStart(5)} ` +
            `eval uniform ${uniformUs.toFixed(3)} µs  near ${nearUs.toFixed(3)} µs (${near.length})  ` +
            `points prepare ${median(prepareMs).toFixed(1)} ms  ` +
            `${median(nsPerPoint).toFixed(0)} ns/pt  skipped ${(100 * skipped).toFixed(2)}%`,
        );
      });
    }
  }
});
