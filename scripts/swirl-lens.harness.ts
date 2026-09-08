/**
 * A nonlinear Surface admission spike: the exact inverse of a pure SWIRL
 * final transform, wrapping the existing 3D and 4D estimators unchanged.
 *
 * The authored map S(x) rotates xy by pi/2 - |x|^2, carrying z/w, so its
 * inverse is the opposite rotation at the SAME radius. It is globally
 * one-to-one and preserves radius in both dimensions. This makes a final
 * lens much cheaper structurally than an iterated nonlinear base map.
 *
 * Certification is global, not a Jacobian evaluated only at the query.
 * Write DS = R(I - 2 Jx x^T), where J rotates xy and leaves z/w zero.
 * Since Jx is orthogonal to x, the nontrivial singular values are those of
 * a shear of magnitude 2 |x_xy| |x|. On a radius-r ball its norm is at most
 * sqrt(1+r^4)+r^2. A segment between query u and any set point y in a
 * radius-rho ball lies in radius max(|u|,rho), giving that inverse bound.
 * Independently, adding/subtracting the rotated y gives the chord bound
 * |S^-1(u)-S^-1(y)| <= [1+rho(|u|+rho)] |u-y|. Take the smaller bound.
 * A lower bound d on raw-set distance therefore becomes d/L after inverse
 * swirl. A pre-scale k followed by weight 1/k preserves the visible size
 * while varying twist, with the k and 1/k cancelling in the distance.
 *
 * Proof probes use the FORWARD production variation as an independent
 * oracle, including known finite-point-set distances and f32 chaos-game
 * support points. Pictures use de-preview.ts, the shared marcher; no ninth
 * marcher is hidden here. Its usual distance-based hit tolerance remains
 * unchanged, so a loose L may thicken details even if it never exhausts.
 *
 * This is a spike, not shipped eligibility or a shader implementation.
 * Nonzero 4D slabs are out of scope: inverse swirl bends their segments.
 *
 * Measured 2026-09-08: 60,000 independent point pairs had max round-trip
 * residual 9.75e-15, exact flat 3D/4D parity and max certificate/true-distance
 * ratio 0.99710. Across 20 panels, no ray exhausted the 160-step budget.
 * At twist radius 0.6 the denominator was 1.423 and eval cost 1.28-1.39x;
 * at 1.1 it was 2.780 and cost 1.83-2.41x. Both visibly deform the solid
 * detail. At 1.8 the denominator reached 6.722 and cost 2.39-4.10x:
 * especially the thin 4D slices visibly fatten into blobs under the common
 * hit tolerance. This is not evidence to ship arbitrary-strength swirl.
 * The bound is sound, but its loss near hits needs another qualification
 * before the CPU/shader lens paths and the eligibility gate change.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/swirl-lens.harness.ts
 * Writes: scripts/out/swirl-lens.png
 */
import { toTransform4 } from "../src/fractal/affine4";
import { runChaosGame } from "../src/fractal/chaos-game";
import { runChaosGame4 } from "../src/fractal/chaos-game-4d";
import {
  mengerSponge,
  pentatope,
  sierpinskiTetrahedron,
  tesseract,
} from "../src/fractal/presets";
import { mulberry32 } from "../src/fractal/rng";
import {
  buildSurfaceDE,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import {
  buildSurfaceDE4,
  estimateDistance4Refined,
} from "../src/fractal/surface-de-4d";
import type { Transform, Vec3, Vec4 } from "../src/fractal/types";
import { composeVariations } from "../src/fractal/variations";
import { composeVariations4 } from "../src/fractal/variations4";
import { renderPreview, writeLabeledContactSheet } from "./de-preview";
import type { PanelStats } from "./de-preview";

const SIZE = 128;
const MAX_STEPS = 160;
const TWISTS = [0, 0.6, 1.1, 1.8];

const forward3 = composeVariations([{ type: "swirl", weight: 1 }])!;
const forward4 = composeVariations4([{ type: "swirl", weight: 1 }])!;

function inverseSwirl4(u: Vec4): Vec4 {
  const r2 = u[0] ** 2 + u[1] ** 2 + u[2] ** 2 + u[3] ** 2;
  const s = Math.sin(r2);
  const c = Math.cos(r2);
  return [u[0] * s + u[1] * c, -u[0] * c + u[1] * s, u[2], u[3]];
}

function inverseSwirl3(u: Vec3): Vec3 {
  const q = inverseSwirl4([u[0], u[1], u[2], 0]);
  return [q[0], q[1], q[2]];
}

function inverseLipschitz(queryRadius: number, rho: number): number {
  const r2 = Math.max(queryRadius ** 2, rho ** 2);
  return Math.min(Math.sqrt(1 + r2 * r2) + r2, 1 + rho * (queryRadius + rho));
}

function distance4(a: Vec4, b: Vec4): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]);
}

/** The view's inverse xw rotation, lifting a screen query into set space. */
function slicePoint(p: Vec3, angle: number, slice: number): Vec4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * p[0] - s * slice, p[1], p[2], s * p[0] + c * slice];
}

interface Fixture {
  name: string;
  dimension: 3 | 4;
  transforms: Transform[];
  angle: number;
  sliceFraction: number;
}

const FIXTURES: Fixture[] = [
  {
    name: "TETRA",
    dimension: 3,
    transforms: sierpinskiTetrahedron(),
    angle: 0,
    sliceFraction: 0,
  },
  {
    name: "MENGER",
    dimension: 3,
    transforms: mengerSponge(),
    angle: 0,
    sliceFraction: 0,
  },
  {
    name: "PENTA-0",
    dimension: 4,
    transforms: pentatope(),
    angle: 0,
    sliceFraction: 0,
  },
  {
    name: "PENTA-TILT",
    dimension: 4,
    transforms: pentatope(),
    angle: 0.65,
    sliceFraction: 0.08,
  },
  {
    name: "TESS-TILT",
    dimension: 4,
    transforms: tesseract(),
    angle: 0.55,
    sliceFraction: 0.12,
  },
];

describe("swirl final lens spike", () => {
  it("certifies the inverse against independent forward 3D/4D points", () => {
    const rng = mulberry32(20260908);
    let maxRoundtrip = 0;
    let maxCertificateRatio = 0;
    let maxParityError = 0;
    const ratios: number[] = [];
    for (const dimension of [3, 4] as const) {
      for (let i = 0; i < 30000; i++) {
        const x: Vec4 = [
          rng() * 4 - 2,
          rng() * 4 - 2,
          rng() * 4 - 2,
          dimension === 4 ? rng() * 4 - 2 : 0,
        ];
        const xf: Vec4 =
          dimension === 4
            ? [...forward4(...x, rng)]
            : [...forward3(x[0], x[1], x[2], rng), 0];
        const restored = inverseSwirl4(xf);
        maxRoundtrip = Math.max(maxRoundtrip, distance4(x, restored));
        if (dimension === 3) {
          maxParityError = Math.max(
            maxParityError,
            distance4(xf, [...forward4(...x, rng)]),
          );
        }
        // A singleton is a known exact set: no DE oracle participates in
        // either the raw or transformed distance of this certificate pin.
        // Half the pairs are very close, to exercise the differential limit.
        const delta = i % 2 === 0 ? 1e-5 : 2;
        const q: Vec4 = [
          xf[0] + (rng() - 0.5) * delta,
          xf[1] + (rng() - 0.5) * delta,
          xf[2] + (rng() - 0.5) * delta,
          dimension === 4 ? xf[3] + (rng() - 0.5) * delta : 0,
        ];
        const actual = distance4(q, xf);
        const lower =
          distance4(inverseSwirl4(q), x) /
          inverseLipschitz(Math.hypot(...q), Math.hypot(...x));
        const ratio = lower / actual;
        ratios.push(ratio);
        maxCertificateRatio = Math.max(maxCertificateRatio, ratio);
      }
    }
    ratios.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        proof: {
          pairs: ratios.length,
          maxRoundtrip,
          maxParityError,
          maxCertificateRatio,
          ratioP10: ratios[Math.floor(ratios.length * 0.1)],
          ratioMedian: ratios[Math.floor(ratios.length * 0.5)],
        },
      }),
    );
    expect(maxRoundtrip).toBeLessThan(1e-12);
    expect(maxParityError).toBe(0);
    expect(maxCertificateRatio).toBeLessThanOrEqual(1 + 1e-8);
  });

  it("measures detail and the 160-step budget on actual 3D/4D systems", () => {
    const panels: { stats: PanelStats; lines: readonly [string, string] }[] =
      [];
    for (const fixture of FIXTURES) {
      const de3 =
        fixture.dimension === 3 ? buildSurfaceDE(fixture.transforms) : null;
      const de4 =
        fixture.dimension === 4 ? buildSurfaceDE4(fixture.transforms) : null;
      const radius = de3
        ? de3.boundingRadius + Math.hypot(...de3.boundCenter)
        : de4!.boundingRadius;
      const raw = (q: Vec4): number =>
        de3
          ? estimateDistanceRefined(de3, [q[0], q[1], q[2]])
          : estimateDistance4Refined(de4!, q);
      const slice = radius * fixture.sliceFraction;
      const cloud3 =
        fixture.dimension === 3
          ? runChaosGame(fixture.transforms, 512, mulberry32(2409))
          : null;
      const cloud4 =
        fixture.dimension === 4
          ? runChaosGame4(
              fixture.transforms.map(toTransform4),
              512,
              mulberry32(2409),
            )
          : null;
      let baselineEvals = 0;

      for (const twist of TWISTS) {
        // k*rhoRaw = twist: parameterize by the actual bounding radius so
        // the same column means the same maximum twist in every fixture.
        const k = twist === 0 ? 1 : twist / radius;
        const warped = (p: Vec3): number => {
          const q = slicePoint(p, fixture.angle, slice);
          if (twist === 0) return raw(q);
          const u: Vec4 = [q[0] * k, q[1] * k, q[2] * k, q[3] * k];
          const v = inverseSwirl4(u);
          const lower =
            raw([v[0] / k, v[1] / k, v[2] / k, v[3] / k]) /
            inverseLipschitz(Math.hypot(...u), twist);
          return Math.max(lower, Math.hypot(...q) - radius);
        };
        let supportResidual = 0;
        let maxRawResidual = 0;
        if (twist > 0) {
          for (let i = 0; i < 512; i++) {
            const positions = cloud3 ? cloud3.positions : cloud4!.positions;
            const q: Vec4 = [
              positions[i * 3],
              positions[i * 3 + 1],
              positions[i * 3 + 2],
              cloud4 ? cloud4.w[i] : 0,
            ];
            const u: Vec4 = [q[0] * k, q[1] * k, q[2] * k, q[3] * k];
            const forward: Vec4 =
              fixture.dimension === 3
                ? [...forward3(u[0], u[1], u[2], Math.random), 0]
                : [...forward4(...u, Math.random)];
            const inv =
              fixture.dimension === 3
                ? ([
                    ...inverseSwirl3([forward[0], forward[1], forward[2]]),
                    0,
                  ] as Vec4)
                : inverseSwirl4(forward);
            const value = raw([inv[0] / k, inv[1] / k, inv[2] / k, inv[3] / k]);
            supportResidual = Math.max(
              supportResidual,
              Math.abs(value - raw(q)),
            );
            maxRawResidual = Math.max(maxRawResidual, Math.abs(raw(q)));
          }
        }
        const stats = renderPreview(
          {
            de: warped,
            boundingRadius: radius,
            stepScale: 1,
            maxSteps: MAX_STEPS,
            ao: false,
            shadow: false,
            fog: false,
            collect: true,
          },
          SIZE,
        );
        if (twist === 0) baselineEvals = stats.evals;
        const denominators: number[] = [];
        if (twist > 0) {
          for (let i = 0; i < SIZE * SIZE; i++) {
            if (stats.status![i] !== 1) continue;
            const p: Vec3 = [
              stats.hitPos![i * 3],
              stats.hitPos![i * 3 + 1],
              stats.hitPos![i * 3 + 2],
            ];
            denominators.push(
              inverseLipschitz(
                Math.hypot(...slicePoint(p, fixture.angle, slice)) * k,
                twist,
              ),
            );
          }
          denominators.sort((a, b) => a - b);
        }
        const record = {
          fixture: fixture.name,
          dimension: fixture.dimension,
          twist,
          radius,
          hitPct: (100 * stats.hits) / (SIZE * SIZE),
          exhaustedPct: (100 * stats.exhausted) / (SIZE * SIZE),
          evals: stats.evals,
          evalRatio: stats.evals / baselineEvals,
          meanSteps: stats.steps / (SIZE * SIZE),
          ms: stats.ms,
          denominatorMedian: denominators.length
            ? denominators[Math.floor(denominators.length / 2)]
            : 1,
          denominatorMax: denominators.at(-1) ?? 1,
          supportResidual,
          maxRawResidual,
        };
        console.log(JSON.stringify(record));
        expect(supportResidual).toBeLessThan(1e-10);
        panels.push({
          stats,
          lines: [
            `${fixture.name} T=${twist}`,
            `H=${record.hitPct.toFixed(1)} E=${record.exhaustedPct.toFixed(1)} X=${record.evalRatio.toFixed(2)}`,
          ],
        });
      }
    }
    console.log(
      writeLabeledContactSheet(panels, TWISTS.length, "swirl-lens.png"),
    );
  });
});
