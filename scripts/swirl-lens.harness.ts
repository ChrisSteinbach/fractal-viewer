/**
 * Pure SWIRL final-transform qualification, wrapping the existing 3D and
 * 4D estimators unchanged. The original spike is retained as a negative
 * control; the shipped policy and fixed-geometry record are below and in
 * docs/swirl-surface-lens.md.
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
 * marcher is hidden here. The legacy panels keep the usual hit tolerance,
 * so a loose L may thicken details even if it never exhausts; the qualified
 * leg explicitly compensates that tolerance.
 *
 * Original policy: G=1+rho²+rho*sqrt(rho²+2) bounds ALL inverse queries against
 * a set in ball(rho). Divide both certified distance and the whole primary
 * hit epsilon by G. This restores the ordinary raw acceptance shell and
 * composes through post-affines and Balloon without a query-domain cap.
 * rho<=0.5 qualifies against the 160-step budget at 128 and 512 pixels in
 * TETRA, PENTA-TILT and TESS-TILT. The maximum is 132 steps. Nonzero 4D
 * slabs remain refused: inverse swirl bends their segments.
 *
 * Measured 2026-09-08: 60,000 independent point pairs had max round-trip
 * residual 9.75e-15, exact flat 3D/4D parity and max certificate/true-distance
 * ratio 0.99710. Across 20 panels, no ray exhausted the 160-step budget.
 * At twist radius 0.6 the denominator was 1.423 and eval cost 1.28-1.39x;
 * at 1.1 it was 2.780 and cost 1.83-2.41x. Both visibly deform the solid
 * detail. At 1.8 the denominator reached 6.722 and cost 2.39-4.10x:
 * especially the thin 4D slices visibly fatten into blobs under the common
 * hit tolerance. This is not evidence to ship arbitrary-strength swirl.
 * The bound was sound, but its acceptance loss needed the global constant
 * and compensation above. Lowering rho alone was not an adequate fix.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/swirl-lens.harness.ts
 * Fixed-geometry gate: SWIRL_QUALIFY=1 and -t 'qualifies fixed'. Defaults
 * to the production cap, 128-pixel controls and 512-pixel final references.
 * Writes: scripts/out/swirl-lens.png and swirl-qualified-*.png.
 * Paired echo gate: SWIRL_MARCH_QUALIFY=1 and -t 'qualifies paired stride'.
 * TETRA, PENTA-TILT and TESS-TILT at rho=0.5, 128/256/512 pixels, plain
 * and a visible R=0.35 Balloon echo. Each camera, slice, ball and raw query
 * is fixed across paired/matched-raw/fine panels; both echo and primary
 * hits must activate. The 600-step reference counts every step and gates
 * the actual maximum strictly below the existing 160-step budget.
 * Writes: scripts/out/swirl-march-*.png and per-panel .bin measurements.
 */
import { toTransform4 } from "../src/fractal/affine4";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { serialize, deserialize } from "node:v8";
import {
  BALLOON_FAR_CAP_RHO,
  buildBalloon,
  buildBalloon4,
  estimateBalloonDistanceSample,
  estimateBalloonDistance4Sample,
  invertBalloon,
} from "../src/fractal/balloon-de";
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
  estimateDistanceRefinedSample,
} from "../src/fractal/surface-de";
import {
  buildSurfaceDE4,
  estimateDistance4Refined,
  estimateDistance4RefinedSample,
} from "../src/fractal/surface-de-4d";
import type { Transform, Vec3, Vec4 } from "../src/fractal/types";
import {
  SWIRL_LENS_MAX_RADIUS,
  swirlGlobalInverseLipschitz,
} from "../src/fractal/swirl-lens";
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

/** One constant for ALL query radii, against a set inside ball(0,rho).
 * Split at R=sqrt(rho²+2): inside, the angle chord bound is at most
 * 1+rho*(R+rho); outside, the saturated rotation bound is at most
 * 1+2rho/(R-rho). These are equal because R²-rho²=2. No query radius,
 * post-affine condition number or balloon inversion can exceed it.
 * Admitted radii use the exact production ceil-to-f32 helper. Refused
 * historical radii keep a small 2^-20 margin for their negative controls. */
function globalInverseLipschitz(rho: number): number {
  if (rho <= SWIRL_LENS_MAX_RADIUS) return swirlGlobalInverseLipschitz(rho);
  if (rho === 0) return 1;
  return (1 + rho * (rho + Math.sqrt(rho * rho + 2))) * (1 + 2 ** -20);
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

/** Exact squared Euclidean distance to the nearest hit-pixel centre. */
function maskDistances(stats: PanelStats): Float64Array {
  const n = stats.width;
  const out = Float64Array.from(stats.status!, (x) => (x === 1 ? 0 : 1e12));
  const f = new Float64Array(n);
  const z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const transform = (stride: number, start: number): void => {
    for (let q = 0; q < n; q++) f[q] = out[start + q * stride];
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
      }
      v[++k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      out[start + q * stride] = (q - v[k]) ** 2 + f[v[k]];
    }
  };
  for (let y = 0; y < n; y++) transform(1, y * n);
  for (let x = 0; x < n; x++) transform(n, x);
  return out;
}

function downsamplePanel(stats: PanelStats, size: number): PanelStats {
  const scale = stats.width / size;
  const rgb = new Uint8Array(size * size * 3);
  const status = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sums = [0, 0, 0];
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const i = (y * scale + sy) * stats.width + x * scale + sx;
          if (stats.status![i] === 1) status[y * size + x] = 1;
          for (let c = 0; c < 3; c++) sums[c] += stats.rgb[3 * i + c];
        }
      }
      for (let c = 0; c < 3; c++)
        rgb[3 * (y * size + x) + c] = sums[c] / scale ** 2;
    }
  }
  return { ...stats, rgb, width: size, height: size, status };
}

function compareFixedGeometry(coarse: PanelStats, reference: PanelStats) {
  const factor = reference.width / coarse.width;
  const fineDistances = maskDistances(reference);
  const distance: number[] = [];
  let outwardBeyondPixel = 0;
  let outwardBeyondTwoPixels = 0;
  let worstPixel: [number, number] | null = null;
  let worstDistance = -1;
  // The nearest fine-grid centre can be sqrt(0.5)/factor away from a
  // coarse centre; subtract ONLY this sampling uncertainty, not a feature
  // tolerance. Distances remain in coarse pixels, independent of coverage.
  const samplingUncertainty = factor % 2 === 0 ? Math.SQRT1_2 / factor : 0;
  for (let y = 0; y < coarse.height; y++) {
    for (let x = 0; x < coarse.width; x++) {
      if (coarse.status![y * coarse.width + x] !== 1) continue;
      const fx = Math.floor((x + 0.5) * factor);
      const fy = Math.floor((y + 0.5) * factor);
      const d = Math.max(
        0,
        Math.sqrt(fineDistances[fy * reference.width + fx]) / factor -
          samplingUncertainty,
      );
      distance.push(d);
      if (d > worstDistance) {
        worstDistance = d;
        worstPixel = [x, y];
      }
      if (d > 1) outwardBeyondPixel++;
      if (d > 2) outwardBeyondTwoPixels++;
    }
  }
  distance.sort((a, b) => a - b);
  return {
    size: coarse.width,
    referenceSize: reference.width,
    hits: coarse.hits,
    referenceHitEquivalent: reference.hits / factor ** 2,
    outwardMax: distance.at(-1) ?? 0,
    outwardCentreMax: (distance.at(-1) ?? 0) + samplingUncertainty,
    outwardP99: distance[Math.floor(distance.length * 0.99)] ?? 0,
    outwardBeyondPixel,
    outwardBeyondTwoPixels,
    worstPixel,
    exhausted: coarse.exhausted,
    referenceExhausted: reference.exhausted,
    maxSteps: coarse.stepCount!.reduce(
      (maximum, value) => Math.max(maximum, value),
      0,
    ),
    raysAt160Steps: coarse.stepCount!.reduce(
      (sum, value) => sum + Number(value >= MAX_STEPS),
      0,
    ),
  };
}

/** Distance from fine support to exact coarse pixel centres. Stop a grid
 * search only when every point outside it is farther than the best hit;
 * no dilation or rounding allowance enters this reverse comparison. */
function fineSupportToCoarse(coarse: PanelStats, fine: PanelStats) {
  const factor = fine.width / coarse.width;
  let maxDistance = 0;
  let beyondOnePixel = 0;
  let beyondTwoPixels = 0;
  for (let i = 0; i < fine.status!.length; i++) {
    if (fine.status![i] !== 1) continue;
    const x = ((i % fine.width) + 0.5) / factor - 0.5;
    const y = (Math.floor(i / fine.width) + 0.5) / factor - 0.5;
    const cx = Math.round(x);
    const cy = Math.round(y);
    const offset = Math.max(Math.abs(x - cx), Math.abs(y - cy));
    let best = Infinity;
    for (let radius = 0; radius <= coarse.width; radius++) {
      for (
        let yy = Math.max(0, cy - radius);
        yy <= Math.min(coarse.height - 1, cy + radius);
        yy++
      ) {
        for (
          let xx = Math.max(0, cx - radius);
          xx <= Math.min(coarse.width - 1, cx + radius);
          xx++
        ) {
          if (
            radius > 0 &&
            Math.abs(xx - cx) !== radius &&
            Math.abs(yy - cy) !== radius
          )
            continue;
          if (coarse.status![yy * coarse.width + xx] === 1)
            best = Math.min(best, (x - xx) ** 2 + (y - yy) ** 2);
        }
      }
      if (best <= (radius + 1 - offset) ** 2) break;
    }
    const d = Math.sqrt(best);
    maxDistance = Math.max(maxDistance, d);
    if (d > 1) beyondOnePixel++;
    if (d > 2) beyondTwoPixels++;
  }
  return {
    coarseSize: coarse.width,
    fineSize: fine.width,
    fineHits: fine.hits,
    maxDistance,
    beyondOnePixel,
    beyondTwoPixels,
  };
}

/** Compare connected features at one resolution; a newly joined gap is
 * counted by the minimum spanning forest of the control's components.
 * This avoids calling two distant features a direct gap closure merely
 * because a third feature bridges them. Eight-neighbour connectivity.
 * Distances are between pixel centres: 2 means one empty pixel row. */
function joinedControlGaps(bound: PanelStats, control: PanelStats) {
  const n = bound.width;
  const components = (
    stats: PanelStats,
  ): { labels: Int32Array; count: number } => {
    const labels = new Int32Array(n * n).fill(-1);
    let count = 0;
    for (let i = 0; i < n * n; i++) {
      if (stats.status![i] !== 1 || labels[i] !== -1) continue;
      const queue = [i];
      labels[i] = count;
      for (let at = 0; at < queue.length; at++) {
        const p = queue[at];
        const px = p % n;
        const py = Math.floor(p / n);
        for (let y = Math.max(0, py - 1); y <= Math.min(n - 1, py + 1); y++) {
          for (let x = Math.max(0, px - 1); x <= Math.min(n - 1, px + 1); x++) {
            const q = y * n + x;
            if (stats.status![q] === 1 && labels[q] === -1) {
              labels[q] = count;
              queue.push(q);
            }
          }
        }
      }
      count++;
    }
    return { labels, count };
  };
  const b = components(bound);
  const c = components(control);
  const parent = Array.from({ length: c.count }, (_, i) => i);
  const root = (i: number): number =>
    parent[i] === i ? i : (parent[i] = root(parent[i]));
  const points: { x: number; y: number; c: number; b: number }[] = [];
  for (let i = 0; i < n * n; i++) {
    if (c.labels[i] !== -1 && b.labels[i] !== -1)
      points.push({
        x: i % n,
        y: Math.floor(i / n),
        c: c.labels[i],
        b: b.labels[i],
      });
  }
  const closest = new Map<string, { a: number; b: number; d2: number }>();
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    for (let j = i + 1; j < points.length; j++) {
      const b = points[j];
      if (a.c === b.c || a.b !== b.b) continue;
      const key = `${Math.min(a.c, b.c)}:${Math.max(a.c, b.c)}`;
      const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      if (d2 < (closest.get(key)?.d2 ?? Infinity))
        closest.set(key, { a: a.c, b: b.c, d2 });
    }
  }
  const gaps: number[] = [];
  for (const edge of [...closest.values()].sort((a, b) => a.d2 - b.d2)) {
    const a = root(edge.a);
    const b = root(edge.b);
    if (a === b) continue;
    parent[a] = b;
    gaps.push(Math.sqrt(edge.d2));
  }
  return {
    boundComponents: b.count,
    controlComponents: c.count,
    joinedGaps: gaps.length,
    joinedGapCentreMax: Math.max(0, ...gaps),
    joinedGapCentreBeyond2: gaps.filter((g) => g > 2).length,
  };
}

describe("swirl final lens qualification", () => {
  it("certifies a global constant through near, remote and 4D queries", () => {
    const rng = mulberry32(22092026);
    let pairs = 0;
    let maxRatio = 0;
    let maxNonzeroRatio = 0;
    for (const dimension of [3, 4] as const) {
      for (const rho of [0, 0.05, 0.15, 0.3, SWIRL_LENS_MAX_RADIUS]) {
        const globalL = globalInverseLipschitz(rho);
        expect(Math.fround(globalL)).toBeGreaterThanOrEqual(
          1 + rho * (rho + Math.sqrt(rho * rho + 2)),
        );
        for (let i = 0; i < 6000; i++) {
          const a: Vec4 = [
            rng() - 0.5,
            rng() - 0.5,
            rng() - 0.5,
            dimension === 4 ? rng() - 0.5 : 0,
          ];
          const scale =
            (rho * Math.pow(rng(), 1 / dimension)) / (Math.hypot(...a) || 1);
          const x: Vec4 = [
            a[0] * scale,
            a[1] * scale,
            a[2] * scale,
            a[3] * scale,
          ];
          const y: Vec4 =
            dimension === 4
              ? [...forward4(...x, rng)]
              : [...forward3(x[0], x[1], x[2], rng), 0];
          const displacement = i % 3 === 0 ? 1e-5 : i % 3 === 1 ? 2 : 1000;
          const query: Vec4 = [
            y[0] + (rng() - 0.5) * displacement,
            y[1] + (rng() - 0.5) * displacement,
            y[2] + (rng() - 0.5) * displacement,
            dimension === 4 ? y[3] + (rng() - 0.5) * displacement : 0,
          ];
          const lower = distance4(inverseSwirl4(query), x) / globalL;
          const actual = distance4(query, y);
          maxRatio = Math.max(maxRatio, lower / actual);
          if (rho > 0)
            maxNonzeroRatio = Math.max(maxNonzeroRatio, lower / actual);
          pairs++;
        }
      }
    }
    console.log(
      JSON.stringify({
        globalProof: {
          pairs,
          maxRatio,
          maxNonzeroRatio,
          capRadius: SWIRL_LENS_MAX_RADIUS,
          capDenominator: globalInverseLipschitz(SWIRL_LENS_MAX_RADIUS),
        },
      }),
    );
    expect(maxRatio).toBeLessThanOrEqual(1 + 1e-10);
  });
  it.skipIf(process.env.SWIRL_QUALIFY !== "1")(
    "qualifies fixed geometry against fine references",
    () => {
      const names = (
        process.env.SWIRL_FIXTURES ?? "TETRA,PENTA-TILT,TESS-TILT"
      ).split(",");
      const requestedTwists = process.env.SWIRL_TWISTS?.split(",").map(Number);
      const sizes = (process.env.SWIRL_SIZES ?? "128").split(",").map(Number);
      const outDir = join(import.meta.dirname, "out");
      mkdirSync(outDir, { recursive: true });
      for (const fixture of FIXTURES.filter((f) => names.includes(f.name))) {
        const de3 =
          fixture.dimension === 3 ? buildSurfaceDE(fixture.transforms) : null;
        const de4 =
          fixture.dimension === 4 ? buildSurfaceDE4(fixture.transforms) : null;
        const radius = de3
          ? de3.boundingRadius + Math.hypot(...de3.boundCenter)
          : de4!.boundingRadius;
        const raw = (q: Vec4) =>
          de3
            ? estimateDistanceRefined(de3, [q[0], q[1], q[2]])
            : estimateDistance4Refined(de4!, q);
        const twists = requestedTwists ?? [SWIRL_LENS_MAX_RADIUS];
        for (const twist of twists) {
          const k = twist === 0 ? 1 : twist / radius;
          // A tilted slice query has |q|²=|p|²+slice². Price the ENTIRE
          // march sphere, including its part outside the visible set ball.
          const safeL =
            twist === 0
              ? 1
              : inverseLipschitz(
                  twist * Math.hypot(1, fixture.sliceFraction),
                  twist,
                );
          const globalL = globalInverseLipschitz(twist);
          const warped = (
            p: Vec3,
            unitHit = false,
            globalBound = false,
            withoutSphereFloor = false,
          ): number => {
            const q = slicePoint(
              p,
              fixture.angle,
              radius * fixture.sliceFraction,
            );
            if (twist === 0) return raw(q);
            const u: Vec4 = [q[0] * k, q[1] * k, q[2] * k, q[3] * k];
            const v = inverseSwirl4(u);
            const lower =
              raw([v[0] / k, v[1] / k, v[2] / k, v[3] / k]) /
              (unitHit
                ? 1
                : globalBound
                  ? globalL
                  : inverseLipschitz(Math.hypot(...u), twist));
            if (withoutSphereFloor) return lower;
            return Math.max(
              lower,
              (Math.hypot(...q) - radius) *
                (unitHit ? (globalBound ? globalL : safeL) : 1),
            );
          };
          const panels: PanelStats[] = [];
          for (const size of sizes) {
            const cache = join(
              outDir,
              `swirl-fixed-v1-${fixture.name}-${twist}-${size}.bin`,
            );
            const stats =
              process.env.SWIRL_REUSE === "1" && existsSync(cache)
                ? (deserialize(readFileSync(cache)) as PanelStats)
                : renderPreview(
                    {
                      de: (p) => warped(p),
                      boundingRadius: radius,
                      stepScale: 1,
                      maxSteps: 600,
                      ao: false,
                      shadow: false,
                      fog: false,
                      collect: true,
                    },
                    size,
                  );
            writeFileSync(cache, serialize(stats));
            panels.push(stats);
            console.log(
              JSON.stringify({
                fixed: fixture.name,
                twist,
                size,
                hits: stats.hits,
                exhausted: stats.exhausted,
                evals: stats.evals,
                ms: stats.ms,
              }),
            );
          }
          const controlCache = join(
            outDir,
            `swirl-fixed-v1-control-${fixture.name}-${twist}-${sizes[0]}.bin`,
          );
          const control =
            process.env.SWIRL_REUSE === "1" && existsSync(controlCache)
              ? (deserialize(readFileSync(controlCache)) as PanelStats)
              : renderPreview(
                  {
                    de: (p) => warped(p, true),
                    boundingRadius: radius,
                    stepScale: 1 / safeL,
                    maxSteps: 600,
                    ao: false,
                    shadow: false,
                    fog: false,
                    collect: true,
                  },
                  sizes[0],
                );
          writeFileSync(controlCache, serialize(control));
          // March-only acceptance correction. Multiplying the returned
          // certificate by Lmax and dividing stepScale by the same value
          // leaves each stride unchanged and divides only the acceptance
          // epsilon by Lmax. The shared marcher's unscaled minimum step is
          // still below the certified stride before a hit when Lmax < 2.
          const correctedCache = join(
            outDir,
            `swirl-fixed-v1-corrected-${fixture.name}-${twist}-${sizes[0]}.bin`,
          );
          const corrected =
            process.env.SWIRL_REUSE === "1" && existsSync(correctedCache)
              ? (deserialize(readFileSync(correctedCache)) as PanelStats)
              : renderPreview(
                  {
                    de: (p) => safeL * warped(p),
                    boundingRadius: radius,
                    stepScale: 1 / safeL,
                    maxSteps: 600,
                    ao: false,
                    shadow: false,
                    fog: false,
                    collect: true,
                  },
                  sizes[0],
                );
          writeFileSync(correctedCache, serialize(corrected));
          const nearestRayT = (Math.hypot(1.55, 1.1, 1.8) - 1) * radius;
          // The primary minimum step is eps*0.5, whereas hit acceptance is
          // eps*max(t,1). This strict condition proves the unchanged minimum
          // cannot replace a certified step before acceptance in this leg.
          const minimumStepInactive = Math.max(nearestRayT, 1) > 0.5 * globalL;
          const globalSizes = (process.env.SWIRL_GLOBAL_SIZES ?? "128,256,512")
            .split(",")
            .map(Number);
          const globalPanels: PanelStats[] = [];
          for (const size of globalSizes) {
            const globalCache = join(
              outDir,
              `swirl-fixed-v4-global-${fixture.name}-${twist}-${size}.bin`,
            );
            const stats =
              process.env.SWIRL_REUSE === "1" && existsSync(globalCache)
                ? (deserialize(readFileSync(globalCache)) as PanelStats)
                : renderPreview(
                    {
                      de: (p) => globalL * warped(p, false, true),
                      boundingRadius: radius,
                      stepScale: 1 / globalL,
                      maxSteps: 600,
                      minimumStepFraction: 0,
                      ao: false,
                      shadow: false,
                      fog: false,
                      collect: true,
                    },
                    size,
                  );
            writeFileSync(globalCache, serialize(stats));
            globalPanels.push(stats);
            console.log(
              JSON.stringify({
                globalPanel: fixture.name,
                twist,
                ...compareFixedGeometry(stats, stats),
              }),
            );
          }
          const globalStats = globalPanels[0];
          const globalReference = globalPanels.at(-1)!;
          const matchedCache = join(
            outDir,
            `swirl-fixed-v4-matched-${fixture.name}-${twist}-${sizes[0]}.bin`,
          );
          const matchedControl =
            process.env.SWIRL_REUSE === "1" && existsSync(matchedCache)
              ? (deserialize(readFileSync(matchedCache)) as PanelStats)
              : renderPreview(
                  {
                    de: (p) => warped(p, true, true),
                    boundingRadius: radius,
                    stepScale: 1 / globalL,
                    maxSteps: 600,
                    minimumStepFraction: 0,
                    ao: false,
                    shadow: false,
                    fog: false,
                    collect: true,
                  },
                  sizes[0],
                );
          writeFileSync(matchedCache, serialize(matchedControl));
          const uncompensatedCache = join(
            outDir,
            `swirl-fixed-v4-uncompensated-${fixture.name}-${twist}-${sizes[0]}.bin`,
          );
          const uncompensated =
            process.env.SWIRL_REUSE === "1" && existsSync(uncompensatedCache)
              ? (deserialize(readFileSync(uncompensatedCache)) as PanelStats)
              : renderPreview(
                  {
                    de: (p) => warped(p, false, true),
                    boundingRadius: radius,
                    stepScale: 1,
                    maxSteps: 600,
                    minimumStepFraction: 0,
                    ao: false,
                    shadow: false,
                    fog: false,
                    collect: true,
                  },
                  sizes[0],
                );
          writeFileSync(uncompensatedCache, serialize(uncompensated));
          const rigidCache = join(
            outDir,
            `swirl-fixed-v1-rigid-${fixture.name}-${sizes[0]}.bin`,
          );
          const rigid =
            process.env.SWIRL_REUSE === "1" && existsSync(rigidCache)
              ? (deserialize(readFileSync(rigidCache)) as PanelStats)
              : renderPreview(
                  {
                    de: (p) => {
                      const q = slicePoint(
                        p,
                        fixture.angle,
                        radius * fixture.sliceFraction,
                      );
                      return raw([q[1], -q[0], q[2], q[3]]);
                    },
                    boundingRadius: radius,
                    stepScale: 1,
                    maxSteps: 600,
                    ao: false,
                    shadow: false,
                    fog: false,
                    collect: true,
                  },
                  sizes[0],
                );
          writeFileSync(rigidCache, serialize(rigid));
          const reference = panels.at(-1)!;
          // Qualification always compares the final policy with itself.
          // Rejected-policy high-resolution panels keep their separate
          // `comparison` records above and never substitute for this one.
          const fineReference = globalReference;
          for (const coarse of panels.slice(0, -1)) {
            console.log(
              JSON.stringify({
                comparison: fixture.name,
                twist,
                ...compareFixedGeometry(coarse, reference),
              }),
            );
          }
          console.log(
            JSON.stringify({
              unitHitControl: fixture.name,
              twist,
              safeL,
              ...compareFixedGeometry(panels[0], control),
              ...joinedControlGaps(panels[0], control),
            }),
          );
          console.log(
            JSON.stringify({
              unitVsFine: fixture.name,
              twist,
              ...compareFixedGeometry(control, fineReference),
            }),
          );
          console.log(
            JSON.stringify({
              correctedAcceptance: fixture.name,
              twist,
              safeL,
              ...compareFixedGeometry(corrected, control),
              ...joinedControlGaps(corrected, control),
            }),
          );
          console.log(
            JSON.stringify({
              correctedVsFine: fixture.name,
              twist,
              ...compareFixedGeometry(corrected, fineReference),
            }),
          );
          const globalComparison = compareFixedGeometry(globalStats, control);
          const globalOmissions = compareFixedGeometry(control, globalStats);
          const globalGaps = joinedControlGaps(globalStats, control);
          const matchedComparison = compareFixedGeometry(
            globalStats,
            matchedControl,
          );
          const matchedOmissions = compareFixedGeometry(
            matchedControl,
            globalStats,
          );
          const matchedGaps = joinedControlGaps(globalStats, matchedControl);
          if (
            process.env.SWIRL_TRACE === "1" &&
            sizes[0] === 128 &&
            fixture.name === "TESS-TILT" &&
            twist === 0.5
          ) {
            const at = 46 * sizes[0] + 54;
            const p: Vec3 = [
              globalStats.hitPos![3 * at],
              globalStats.hitPos![3 * at + 1],
              globalStats.hitPos![3 * at + 2],
            ];
            const eye: Vec3 = [1.55 * radius, 1.1 * radius, 1.8 * radius];
            const v: Vec3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
            const t = Math.hypot(...v);
            const rd: Vec3 = [v[0] / t, v[1] / t, v[2] / t];
            const pixelEps = (1.1 / sizes[0]) * 0.55;
            const trace: { t: number; ratio: number }[] = [];
            renderPreview(
              {
                de: (q) => {
                  const d = warped(q, true);
                  const off: Vec3 = [
                    q[0] - eye[0],
                    q[1] - eye[1],
                    q[2] - eye[2],
                  ];
                  const qt = off[0] * rd[0] + off[1] * rd[1] + off[2] * rd[2];
                  if (
                    Math.hypot(
                      off[0] - qt * rd[0],
                      off[1] - qt * rd[1],
                      off[2] - qt * rd[2],
                    ) < 1e-6
                  )
                    trace.push({
                      t: qt,
                      ratio: d / (pixelEps * Math.max(qt, 1)),
                    });
                  return d;
                },
                boundingRadius: radius,
                stepScale: 1 / safeL,
                maxSteps: 600,
                ao: false,
                shadow: false,
                fog: false,
              },
              sizes[0],
            );
            const before = trace.filter((q) => q.t < t).at(-1);
            const after = trace.find((q) => q.t > t);
            console.log(
              JSON.stringify({
                strideAlias: fixture.name,
                twist,
                pixel: [54, 46],
                t,
                rawRatioAtGlobalHit:
                  warped(p, true) / (pixelEps * Math.max(t, 1)),
                before,
                after,
                trace,
              }),
            );
          }
          console.log(
            JSON.stringify({
              globalAcceptance: fixture.name,
              twist,
              radius,
              globalL,
              nearestRayT,
              minimumStepInactive,
              ...globalComparison,
              ...globalGaps,
            }),
          );
          console.log(
            JSON.stringify({
              globalOmissions: fixture.name,
              twist,
              ...globalOmissions,
            }),
          );
          console.log(
            JSON.stringify({
              matchedAcceptance: fixture.name,
              twist,
              ...matchedComparison,
              ...matchedGaps,
            }),
          );
          console.log(
            JSON.stringify({
              matchedOmissions: fixture.name,
              twist,
              ...matchedOmissions,
            }),
          );
          console.log(
            JSON.stringify({
              uncompensatedAcceptance: fixture.name,
              twist,
              ...compareFixedGeometry(uncompensated, matchedControl),
              ...joinedControlGaps(uncompensated, matchedControl),
            }),
          );
          console.log(
            JSON.stringify({
              globalVsFine: fixture.name,
              twist,
              ...compareFixedGeometry(globalStats, fineReference),
            }),
          );
          for (const stats of globalPanels.slice(0, -1))
            console.log(
              JSON.stringify({
                globalFixedReference: fixture.name,
                twist,
                ...compareFixedGeometry(stats, globalReference),
              }),
            );
          if (globalReference.width > globalStats.width) {
            console.log(
              JSON.stringify({
                fineSupport: fixture.name,
                twist,
                ...fineSupportToCoarse(globalStats, globalReference),
              }),
            );
            const worst = compareFixedGeometry(
              globalStats,
              globalReference,
            ).worstPixel;
            if (worst) {
              const at = worst[1] * globalStats.width + worst[0];
              const p: Vec3 = [
                globalStats.hitPos![at * 3],
                globalStats.hitPos![at * 3 + 1],
                globalStats.hitPos![at * 3 + 2],
              ];
              const t = Math.hypot(
                p[0] - 1.55 * radius,
                p[1] - 1.1 * radius,
                p[2] - 1.8 * radius,
              );
              const rawDistance = warped(p, true, true, true);
              const coarseEpsilon =
                (1.1 / globalStats.width) * 0.55 * Math.max(t, 1);
              const fineEpsilon =
                (coarseEpsilon * globalStats.width) / globalReference.width;
              console.log(
                JSON.stringify({
                  finiteEpsilonWitness: fixture.name,
                  twist,
                  pixel: worst,
                  p,
                  t,
                  rawDistance,
                  coarseEpsilon,
                  fineEpsilon,
                  coarseRatio: rawDistance / coarseEpsilon,
                  fineRatio: rawDistance / fineEpsilon,
                }),
              );
            }
          }
          console.log(
            JSON.stringify({
              deformation: fixture.name,
              twist,
              rigidRotationHits: rigid.hits,
              silhouetteChangedPixels: globalStats.status!.reduce(
                (sum, value, i) =>
                  sum + Number((value === 1) !== (rigid.status![i] === 1)),
                0,
              ),
            }),
          );
          console.log(
            writeLabeledContactSheet(
              [rigid, panels[0], control, ...panels.slice(1)].map(
                (stats, i) => ({
                  stats: downsamplePanel(stats, sizes[0]),
                  lines: [
                    `${fixture.name} T=${twist}`,
                    `${i === 0 ? "RIGID ROT" : i === 2 ? "UNIT HIT" : "BOUND"} ${stats.width}`,
                  ] as const,
                }),
              ),
              panels.length + 2,
              `swirl-fixed-${fixture.name}-${twist}.png`,
            ),
          );
          console.log(
            writeLabeledContactSheet(
              [rigid, panels[0], corrected, control, reference].map(
                (stats, i) => ({
                  stats: downsamplePanel(stats, sizes[0]),
                  lines: [
                    `${fixture.name} T=${twist}`,
                    `${["RIGID", "OLD HIT", "FIXED HIT", "UNIT HIT", "REF"][i]} ${stats.width}`,
                  ] as const,
                }),
              ),
              5,
              `swirl-corrected-${fixture.name}-${twist}.png`,
            ),
          );
          console.log(
            writeLabeledContactSheet(
              [rigid, panels[0], globalStats, control, fineReference].map(
                (stats, i) => ({
                  stats: downsamplePanel(stats, sizes[0]),
                  lines: [
                    `${fixture.name} T=${twist}`,
                    `${["RIGID", "OLD HIT", "GLOBAL HIT", "UNIT HIT", "REF"][i]} ${stats.width}`,
                  ] as const,
                }),
              ),
              5,
              `swirl-global-${fixture.name}-${twist}.png`,
            ),
          );
          console.log(
            writeLabeledContactSheet(
              globalPanels.map((stats) => ({
                stats: downsamplePanel(stats, sizes[0]),
                lines: [
                  `${fixture.name} T=${twist}`,
                  `GLOBAL ${stats.width}`,
                ] as const,
              })),
              globalPanels.length,
              `swirl-global-reference-${fixture.name}-${twist}.png`,
            ),
          );
          console.log(
            writeLabeledContactSheet(
              [
                rigid,
                uncompensated,
                globalStats,
                matchedControl,
                fineReference,
              ].map((stats, i) => ({
                stats: downsamplePanel(stats, sizes[0]),
                lines: [
                  `${fixture.name} T=${twist}`,
                  `${["RIGID", "G ONLY", "G AND EPS", "MATCHED RAW", "REF"][i]} ${stats.width}`,
                ] as const,
              })),
              5,
              `swirl-qualified-${fixture.name}-${twist}.png`,
            ),
          );
          if (twist > 0 && twist <= SWIRL_LENS_MAX_RADIUS) {
            // Emit the evidence before failing a qualification, so a
            // rejected candidate still leaves its reviewable image.
            expect(globalStats.status).toEqual(matchedControl.status);
            expect(globalStats.hits).toBeGreaterThan(0);
            expect(matchedComparison.outwardMax).toBe(0);
            expect(matchedOmissions.outwardMax).toBe(0);
            expect(matchedGaps.joinedGaps).toBe(0);
            for (const stats of globalPanels) {
              expect(stats.exhausted).toBe(0);
              if (stats.width <= 512)
                expect(
                  stats.stepCount!.reduce(
                    (maximum, value) => Math.max(maximum, value),
                    0,
                  ),
                ).toBeLessThan(MAX_STEPS);
            }
          }
        }
      }
    },
  );
  it.skipIf(process.env.SWIRL_MARCH_QUALIFY !== "1")(
    "qualifies paired stride on fixed thin-slice geometry",
    () => {
      const names = (
        process.env.SWIRL_FIXTURES ?? "TETRA,PENTA-TILT,TESS-TILT"
      ).split(",");
      const sizes = (process.env.SWIRL_MARCH_SIZES ?? "128,256,512")
        .split(",")
        .map(Number);
      const outDir = join(import.meta.dirname, "out");
      mkdirSync(outDir, { recursive: true });
      for (const fixture of FIXTURES.filter((f) => names.includes(f.name))) {
        const raw3 =
          fixture.dimension === 3 ? buildSurfaceDE(fixture.transforms) : null;
        const raw4 =
          fixture.dimension === 4 ? buildSurfaceDE4(fixture.transforms) : null;
        const radius = raw3
          ? raw3.boundingRadius + Math.hypot(...raw3.boundCenter)
          : raw4!.boundingRadius;
        const rho = SWIRL_LENS_MAX_RADIUS * (1 - 1e-12);
        const k = rho / radius;
        const final: Transform = {
          id: 99,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [k, k, k],
          variations: [{ type: "swirl", weight: 1 / k }],
          ...(fixture.dimension === 4 ? { w: { scale: k } } : {}),
        };
        const de3 = raw3 ? buildSurfaceDE(fixture.transforms, final) : null;
        const de4 = raw4 ? buildSurfaceDE4(fixture.transforms, final) : null;
        const de = de3 ?? de4!;
        const G = de.foldFinal!.swirlLipschitz!;
        const affineFactor = de.foldFinal!.absW * de.foldFinal!.sigmaMin;
        const query = (p: Vec3) =>
          slicePoint(p, fixture.angle, radius * fixture.sliceFraction);
        const lensSample = (p: Vec3, cutoff = 0) => {
          const q = query(p);
          const sample = de3
            ? estimateDistanceRefinedSample(de3, [q[0], q[1], q[2]], cutoff)
            : estimateDistance4RefinedSample(de4!, q, cutoff);
          return sample;
        };
        const rawAcceptance = (p: Vec3) => {
          const q = query(p);
          const u = q.map((x) => x * k) as Vec4;
          const v = inverseSwirl4(u).map((x) => x / k) as Vec4;
          const raw = raw3
            ? estimateDistanceRefined(raw3, [v[0], v[1], v[2]])
            : estimateDistance4Refined(raw4!, v);
          return Math.max(
            affineFactor * raw,
            G * (Math.hypot(...q) - de.visibleBoundingRadius),
          );
        };
        for (const echo of [false, true]) {
          const b = de3 ? buildBalloon(de3, 0.35) : buildBalloon4(de4!, 0.35);
          const label = fixture.name + (echo ? "-BALLOON" : "-PLAIN");
          const productionSample = (p: Vec3, cutoff = 0) => {
            if (!echo) {
              const sample = lensSample(p, cutoff);
              return { d: sample.d, stride: sample.d, shell: false };
            }
            return de3
              ? estimateBalloonDistanceSample(
                  (_de, q, cut = 0) => lensSample(q, cut),
                  de3,
                  b,
                  p,
                  cutoff,
                )
              : estimateBalloonDistance4Sample(
                  (_de, q, cut = 0) => lensSample([q[0], q[1], q[2]], cut),
                  de4!,
                  b,
                  p,
                  0,
                  cutoff,
                );
          };
          // The shared renderer keeps epsilon in ordinary pixel units.
          const paired = (p: Vec3, epsilon = 0) => {
            const sample = productionSample(p, epsilon / G);
            return { d: sample.d * G, stride: sample.stride };
          };
          const unionRawAcceptance = (p: Vec3) => {
            if (!echo) return rawAcceptance(p);
            const r = Math.max(Math.hypot(...p), 1e-12 * b.rho);
            return Math.min(
              rawAcceptance(p),
              (r / b.rho) * rawAcceptance(invertBalloon(b, p)),
            );
          };
          // Hold the camera on the original thin slice while admitting the
          // echo out to the far-cap radius. Starting inside a MARCH ball is
          // intentional here; it is not an enclosing solid.
          const marchRadius = echo ? BALLOON_FAR_CAP_RHO * b.rho : radius;
          const common = {
            de: (p: Vec3) => paired(p).d,
            boundingRadius: marchRadius,
            eyeOffset: [1.55, 1.1, 1.8].map(
              (x) => (x * radius) / marchRadius,
            ) as Vec3,
            stepScale: 1,
            maxSteps: 600,
            minimumStepFraction: 0,
            ao: false,
            shadow: false,
            fog: false,
            collect: true,
          };
          const panels: PanelStats[] = [];
          for (const size of sizes) {
            const stats = renderPreview({ ...common, march: paired }, size);
            writeFileSync(
              join(outDir, `swirl-march-${label}-${size}.bin`),
              serialize(stats),
            );
            panels.push(stats);
            console.log(
              JSON.stringify({
                pairedStride: label,
                ...compareFixedGeometry(stats, stats),
                ms: stats.ms,
              }),
            );
          }
          const control = renderPreview(
            {
              ...common,
              march: (p, epsilon) => ({
                d: unionRawAcceptance(p),
                stride: paired(p, epsilon).stride,
              }),
            },
            sizes[0],
          );
          const coarse = panels[0];
          const fine = panels.at(-1)!;
          const gaps = joinedControlGaps(coarse, control);
          console.log(
            JSON.stringify({
              pairedAcceptance: label,
              ...compareFixedGeometry(coarse, control),
              ...gaps,
            }),
          );
          console.log(
            JSON.stringify({
              pairedFineReference: label,
              ...compareFixedGeometry(coarse, fine),
              ...fineSupportToCoarse(coarse, fine),
            }),
          );
          let shellHits = 0;
          for (let i = 0; i < coarse.status!.length; i++) {
            if (
              coarse.status![i] === 1 &&
              productionSample([
                coarse.hitPos![3 * i],
                coarse.hitPos![3 * i + 1],
                coarse.hitPos![3 * i + 2],
              ]).shell
            )
              shellHits++;
          }
          console.log(
            JSON.stringify({
              pairedAttribution: label,
              shellHits,
              fractalHits: coarse.hits - shellHits,
            }),
          );
          console.log(
            writeLabeledContactSheet(
              [coarse, control, fine].map((stats, index) => ({
                stats: downsamplePanel(stats, sizes[0]),
                lines: [
                  `${label} RHO=0.5`,
                  `${["PAIRED", "MATCHED RAW", "FINE"][index]} ${stats.width}`,
                ] as const,
              })),
              3,
              `swirl-march-${label}.png`,
            ),
          );
          expect(coarse.status).toEqual(control.status);
          expect(coarse.hits).toBeGreaterThan(0);
          if (echo) {
            expect(shellHits).toBeGreaterThan(0);
            expect(coarse.hits - shellHits).toBeGreaterThan(0);
          }
          expect(gaps.joinedGaps).toBe(0);
          for (const stats of panels) {
            expect(stats.exhausted).toBe(0);
            if (stats.width <= 512)
              expect(
                stats.stepCount!.reduce(
                  (maximum, value) => Math.max(maximum, value),
                  0,
                ),
              ).toBeLessThan(MAX_STEPS);
          }
        }
      }
    },
  );
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
