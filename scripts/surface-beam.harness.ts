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
} from "../src/fractal/surface-de";
import type { SurfaceDE, SurfaceDEMap } from "../src/fractal/surface-de";
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

/** Wrap a DE's maps so every `invM` read (one per inverse-affine
 * application in the estimators) bumps a counter — cost measured on the
 * SHIPPED estimator, not a copy. */
function countingDE(
  de: SurfaceDE,
  beamWidth: 1 | 2 | 3 | 4,
): {
  de: SurfaceDE;
  counter: { n: number };
} {
  const counter = { n: 0 };
  const maps = de.maps.map((m): SurfaceDEMap => ({
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

function measure3(sys: System3): {
  de: SurfaceDE;
  rows: {
    width: 1 | 2 | 3 | 4;
    estimator: "base" | "refined";
    result: MeasureResult;
  }[];
} {
  const de = buildSurfaceDE(sys.transforms, null, sys.symmetry);
  const cloud = runChaosGame(
    sys.transforms,
    CLOUD,
    mulberry32(101),
    null,
    sys.symmetry ?? { order: 1, axis: "y" },
  );
  const qs = queries3(cloud, de.boundingRadius);
  const trueD = qs.map((q) => nearest3(cloud, q.p));
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
        label: "repro2+sym4y (8 slots)",
        transforms: repro3D(),
        symmetry: { order: 4, axis: "y" },
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
        `-- ${sys.label}: slots=${de.maps.length} maxSigmaMax=${maxSigma.toFixed(3)}` +
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
});
