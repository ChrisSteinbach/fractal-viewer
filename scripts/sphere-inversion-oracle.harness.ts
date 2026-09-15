/**
 * The sphere-inversion estimators' INCREASED-DEPTH REFERENCE: the production
 * transported bound (`src/fractal/sphere-inversion-de.ts` and its 4D twin)
 * against the independent explicit-orbit oracle
 * (`src/fractal/sphere-inversion-oracle.ts`) at every depth the oracle can
 * afford, plus the stress fixtures where a conservative step is most likely
 * to fail: cusps at kissing tangency points, near-tangent generators, and
 * narrow openings in a perforated shell. The unit tests pin shallow depths
 * quickly; this sheet is the slow sweep. Verdict and numbers:
 * `docs/harness-sheets.md` and `docs/sphere-inversion-family.md`.
 *
 *   npx vitest run --config scripts/vitest.harness.config.ts scripts/sphere-inversion-oracle.harness.ts
 *
 * Failures of conservativeness are reported PER FIXTURE AND PER DEPTH, never
 * averaged: any violation fails the sheet.
 */
import { mulberry32 } from "../src/fractal/rng";
import { resolveSphereInversion } from "../src/fractal/sphere-inversion";
import type {
  SphereInversionAuthored,
  SphereInversionConstruction,
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
  enumerateSeedOrbit,
  explicitOrbitDistance,
  nearestPointOnPiece,
} from "../src/fractal/sphere-inversion-oracle";
import type { OrbitPiece } from "../src/fractal/sphere-inversion-oracle";
import type { Vec3, Vec4 } from "../src/fractal/types";

function construction(authored: SphereInversionAuthored) {
  const r = resolveSphereInversion(authored);
  if (!r.ok) throw new Error(r.reasons.join("; "));
  return r.construction;
}

function unit(rng: () => number, dim: number): number[] {
  for (;;) {
    const v = Array.from({ length: dim }, () => 2 * rng() - 1);
    const l = Math.hypot(...v);
    if (l > 1e-3 && l <= 1) return v.map((x) => x / l);
  }
}

function estimator(c: SphereInversionConstruction) {
  if (c.dim === 3) {
    const de = buildSphereInversionDE(c);
    return {
      boundingRadius: de.boundingRadius,
      estimate: (p: number[]) => estimateSphereInversionDistance(de, p as Vec3),
    };
  }
  const de = buildSphereInversionDE4(c);
  return {
    boundingRadius: de.boundingRadius,
    estimate: (p: number[]) => estimateSphereInversionDistance4(de, p as Vec4),
  };
}

interface Row {
  n: number;
  viol: number;
  worst: number;
  p05: number;
  p50: number;
  min: number;
}

function measure(
  c: SphereInversionConstruction,
  pieces: OrbitPiece[],
  qs: number[][],
): Row {
  const { estimate } = estimator(c);
  const ratios: number[] = [];
  let viol = 0;
  let worst = 0;
  for (const p of qs) {
    const truth = explicitOrbitDistance(pieces, p);
    if (truth <= 0) continue;
    const est = estimate(p);
    const r = est / truth;
    if (est > truth * (1 + 1e-9) + 1e-12) {
      viol++;
      worst = Math.max(worst, r);
    }
    ratios.push(r);
  }
  ratios.sort((a, b) => a - b);
  const q = (f: number) =>
    ratios.length ? ratios[Math.floor(f * (ratios.length - 1))] : NaN;
  return {
    n: ratios.length,
    viol,
    worst,
    p05: q(0.05),
    p50: q(0.5),
    min: ratios.length ? ratios[0] : NaN,
  };
}

/** Uniform in the bound ball, plus rays toward random deepest-level pieces'
 * nearest points at 1e-5..1 of the ray. */
function generalQueries(
  c: SphereInversionConstruction,
  pieces: OrbitPiece[],
  count: number,
  seed: number,
): number[][] {
  const { boundingRadius } = estimator(c);
  const rng = mulberry32(seed);
  const deepest = pieces.filter(
    (p) => p.word.length === pieces[pieces.length - 1].word.length,
  );
  const out: number[][] = [];
  while (out.length < count) {
    const p0 = unit(rng, c.dim).map(
      (x) => x * boundingRadius * rng() ** (1 / c.dim),
    );
    if (out.length % 2 === 0) {
      out.push(p0);
      continue;
    }
    const pool = rng() < 0.5 ? deepest : pieces;
    const near = nearestPointOnPiece(pool[Math.floor(rng() * pool.length)], p0);
    if (!near.point || near.distance === 0) continue;
    const q = near.point;
    const t = 10 ** (-5 * rng());
    out.push(q.map((x, a) => x + t * (p0[a] - x)));
  }
  return out;
}

function fmt(label: string, depth: number, pieces: number, r: Row): string {
  return (
    `    ${label.padEnd(34)} D${depth}  ${String(pieces).padStart(6)}  ` +
    `${String(r.viol).padStart(3)}/${String(r.n).padEnd(4)} ` +
    `min ${r.min.toPrecision(3)}  p05 ${r.p05.toPrecision(3)}  p50 ${r.p50.toPrecision(3)}`
  );
}

describe("sphere-inversion increased-depth reference", () => {
  const SWEEPS: [string, SphereInversionAuthored, number][] = [
    ["oct6 r .70 ball .28", { arrangement: "oct6", seed: { size: 0.28 } }, 5],
    ["oct6 KISS ball .28", { arrangement: "oct6", radiusFraction: 1 }, 5],
    [
      "cube8 KISS ball .41",
      { arrangement: "cube8", radiusFraction: 1, seed: { size: 0.41 } },
      4,
    ],
    [
      "ico12 .99 ball .47",
      { arrangement: "ico12", radiusFraction: 0.99, seed: { size: 0.47 } },
      3,
    ],
    [
      "cube8 shell 1 +- .03",
      { arrangement: "cube8", seed: { kind: "shell" } },
      3,
    ],
    [
      "oct6 vault (cut shell)",
      { arrangement: "oct6", seed: { kind: "cutShell" } },
      4,
    ],
    [
      "4D tess16 KISS ball .5",
      { arrangement: "tess16", radiusFraction: 1, seed: { size: 0.5 } },
      3,
    ],
    [
      "4D cross8 KISS ball .28",
      { arrangement: "cross8", radiusFraction: 1 },
      4,
    ],
    [
      "4D cell24 .98 shell",
      { arrangement: "cell24", radiusFraction: 0.98, seed: { kind: "shell" } },
      2,
    ],
  ];

  it("(a) holds below the true distance at every depth, and the true distance converges", () => {
    console.log(
      "\n  (a) depth sweep: violations / off-set queries, estimate/true ratios;" +
        " then the true distance's convergence over a fixed query set",
    );
    console.log(
      "    fixture                            D   pieces  viol/n    ratios",
    );
    for (const [label, authored, maxDepth] of SWEEPS) {
      const base = construction(authored);
      const deepPieces = enumerateSeedOrbit(base, maxDepth);
      // Convergence reads UNIFORM queries only: a query aimed at a deep
      // copy drops by ~100% when that copy appears, at any depth.
      const fixedRng = mulberry32(0xf1e);
      const { boundingRadius } = estimator(base);
      const fixed = Array.from({ length: 120 }, () =>
        unit(fixedRng, base.dim).map(
          (x) => x * boundingRadius * fixedRng() ** (1 / base.dim),
        ),
      );
      const prev: number[] = [];
      const changes: string[] = [];
      for (let depth = 0; depth <= maxDepth; depth++) {
        const c = { ...base, depth };
        const pieces = deepPieces.filter((p) => p.word.length <= depth);
        const qs = generalQueries(c, pieces, 400, 0x5eed + depth);
        const row = measure(c, pieces, qs);
        console.log(fmt(label, depth, pieces.length, row));
        expect(row.viol, `${label} D${depth}: worst ${row.worst}x`).toBe(0);
        const truths = fixed.map((p) => explicitOrbitDistance(pieces, p));
        if (prev.length) {
          // Absolute drop: bounded by the size of the new depth's copies.
          let maxDrop = 0;
          truths.forEach((t, i) => {
            maxDrop = Math.max(maxDrop, prev[i] - t);
            expect(t).toBeLessThanOrEqual(prev[i] + 1e-12);
          });
          changes.push(`${depth}:${maxDrop.toExponential(1)}`);
        }
        truths.forEach((t, i) => (prev[i] = t));
      }
      console.log(
        `      max drop of true distance at uniform queries, by depth: ${changes.join(" ")}`,
      );
    }
  });

  it("(b) stress: cusps, near-tangent generators and narrow openings", () => {
    console.log("\n  (b) stress fixtures (per fixture, never averaged)");
    const rng = mulberry32(0x57e55);
    const rows: [string, SphereInversionConstruction, number[][]][] = [];

    // Cusps: rays onto kissing tangency points (midpoints of neighbouring
    // centres), 1e-1..1e-7 away, from random directions.
    const cusp = (id: string, depth: number, seed?: number) => {
      const c = construction({
        arrangement: id,
        radiusFraction: 1,
        seed: seed === undefined ? undefined : { size: seed },
        depth,
      });
      const g = c.generators;
      const tangentDist = 2 * g[0].radius;
      const points: number[][] = [];
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) {
          const d = Math.hypot(
            ...g[i].center.map((x, a) => x - g[j].center[a]),
          );
          if (Math.abs(d - tangentDist) > 1e-9) continue;
          points.push(g[i].center.map((x, a) => (x + g[j].center[a]) / 2));
        }
      }
      const qs: number[][] = [];
      for (let k = 0; k < 300; k++) {
        const t = points[k % points.length];
        const u = unit(rng, c.dim);
        const delta = 10 ** (-1 - 6 * rng());
        qs.push(t.map((x, a) => x + delta * u[a]));
      }
      rows.push([`cusp ${id} KISS D${depth}`, c, qs]);
    };
    cusp("oct6", 4);
    cusp("cube8", 4, 0.41);
    cusp("tess16", 3, 0.5);
    cusp("cross8", 4);

    // Near-tangent generators: fractions just below kissing, queries in
    // the thin gap region between neighbours and generally.
    for (const [id, frac, depth, size] of [
      ["oct6", 0.999, 4, 0.28],
      ["oct6", 0.9999, 4, 0.28],
      ["cube8", 0.9999, 4, 0.41],
      ["tess16", 0.999, 3, 0.48],
    ] as [string, number, number, number][]) {
      const c = construction({
        arrangement: id,
        radiusFraction: frac,
        seed: { size },
        depth,
      });
      const pieces = enumerateSeedOrbit(c);
      rows.push([
        `near-tangent ${id} ${frac} D${depth}`,
        c,
        generalQueries(c, pieces, 300, 0x7a9 + depth),
      ]);
    }

    // Narrow openings: a shell crossing near-kissing generators, queried on
    // and just off the shell sphere toward the tangency directions, where
    // the shell's openings are narrowest.
    for (const [id, frac, depth] of [
      ["oct6", 0.995, 4],
      ["cube8", 0.995, 3],
      ["tess16", 0.995, 2],
    ] as [string, number, number][]) {
      const c = construction({
        arrangement: id,
        radiusFraction: frac,
        seed: { kind: "shell", size: 1, thickness: 0.03 },
        depth,
      });
      const g = c.generators;
      const qs: number[][] = [];
      for (let k = 0; k < 300; k++) {
        const i = Math.floor(rng() * g.length);
        let j = Math.floor(rng() * g.length);
        if (j === i) j = (j + 1) % g.length;
        const mid = g[i].center.map((x, a) => (x + g[j].center[a]) / 2);
        const len = Math.hypot(...mid) || 1;
        const r = 1 + (2 * rng() - 1) * 0.08;
        const u = unit(rng, c.dim);
        qs.push(mid.map((x, a) => (x / len) * r + 0.02 * rng() * u[a]));
      }
      rows.push([`opening ${id} shell ${frac} D${depth}`, c, qs]);
    }

    for (const [label, c, qs] of rows) {
      const pieces = enumerateSeedOrbit(c);
      const row = measure(c, pieces, qs);
      console.log(fmt(label, c.depth, pieces.length, row));
      expect(row.viol, `${label}: worst ${row.worst}x`).toBe(0);
    }
  });
});
