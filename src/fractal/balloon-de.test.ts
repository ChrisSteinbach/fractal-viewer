import {
  BALLOON_CENTER_FLOOR,
  BALLOON_RHO_MARGIN,
  balloonBall,
  balloonBall4,
  buildBalloon,
  buildBalloon4,
  estimateBalloonDistance,
  estimateBalloonDistance4,
  invertBalloon,
} from "./balloon-de";
import type {
  Balloon,
  BalloonEstimator,
  BalloonEstimator4,
} from "./balloon-de";
import { toTransform4 } from "./affine4";
import { runChaosGame } from "./chaos-game";
import { runChaosGame4 } from "./chaos-game-4d";
import type { ChaosGameResult } from "./chaos-game";
import { defaultTransforms, pentatope } from "./presets";
import { mulberry32 } from "./rng";
import {
  buildSurfaceDE,
  estimateDistance,
  estimateDistanceRefined,
} from "./surface-de";
import { buildSurfaceDE4, estimateDistance4Refined } from "./surface-de-4d";
import type { Transform, Vec3, Vec4 } from "./types";

/**
 * fr-5wlv.3: tests for the balloon inverted-union DE. The reference
 * machinery below (`unitDir`, `nearestPlain`, `nearestShell`, the off-set
 * query builder) is ported from `scripts/balloon-inversion.harness.ts`'s
 * fr-5wlv.1 spike, at reduced scale — tests must not import from `scripts/`,
 * so it is copied here rather than shared.
 */

/** Uniform-random unit vector (RNG-to-sphere recipe ported from the spike
 * harness). */
function unitDir(rng: () => number): Vec3 {
  const z = 2 * rng() - 1;
  const t = 2 * Math.PI * rng();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(t), r * Math.sin(t), z];
}

/** Brute-force nearest cloud sample — the fractal term's own ground truth. */
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

/** `|s - center|^2` for every cloud sample, f64 — reused by
 * {@link nearestShell}'s identity-form scan and by the nearShell query
 * class's top-decile pick. */
function centerDistSq(cloud: ChaosGameResult, center: Vec3): Float64Array {
  const out = new Float64Array(cloud.count);
  for (let i = 0; i < cloud.count; i++) {
    const dx = cloud.positions[i * 3] - center[0];
    const dy = cloud.positions[i * 3 + 1] - center[1];
    const dz = cloud.positions[i * 3 + 2] - center[2];
    out[i] = dx * dx + dy * dy + dz * dz;
  }
  return out;
}

/** 90th-percentile `|s - center|`, from a precomputed {@link centerDistSq}
 * array. Copies before sorting: the caller's array is indexed by cloud
 * sample id elsewhere and must not be reordered. */
function decileRadius(sCenterSq: Float64Array): number {
  const sorted = Float64Array.from(sCenterSq).sort();
  return Math.sqrt(sorted[Math.floor(sorted.length * 0.9)]);
}

/**
 * Brute-force nearest INVERTED sample, through the exact identity
 * `min_s |p - I(s)| = |p - c| * min_s |I(p) - s| / |s - c|` — never by
 * inverting the f32-stored cloud samples directly (that would amplify their
 * storage rounding by the local conformal factor). Ported from the spike
 * harness's `nearestShell`; calls the module's own `invertBalloon`, exactly
 * as the harness's reference shared its one `invert` with the wrapper under
 * test — the inversion-identity test above pins that primitive
 * independently, so this is not circular.
 */
function nearestShell(
  cloud: ChaosGameResult,
  sCenterSq: Float64Array,
  b: Balloon,
  p: Vec3,
): number {
  const a = invertBalloon(b, p);
  const pos = cloud.positions;
  let bestRatio = Infinity;
  for (let i = 0; i < cloud.count; i++) {
    const dx = pos[i * 3] - a[0];
    const dy = pos[i * 3 + 1] - a[1];
    const dz = pos[i * 3 + 2] - a[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestRatio * sCenterSq[i]) bestRatio = d2 / sCenterSq[i];
  }
  const rp = Math.max(
    Math.hypot(p[0] - b.center[0], p[1] - b.center[1], p[2] - b.center[2]),
    BALLOON_CENTER_FLOOR * b.rho,
  );
  return rp * Math.sqrt(bestRatio);
}

interface OffsetQueryCounts {
  jittered: number;
  uniform: number;
  nearShell: number;
  nearCenter: number;
  onSphere: number;
}

const FULL_OFFSET_COUNTS: OffsetQueryCounts = {
  jittered: 150,
  uniform: 100,
  nearShell: 80,
  nearCenter: 60,
  onSphere: 60,
};

/**
 * The spike harness's off-set query mix (jittered/uniform/nearShell/
 * nearCenter/onSphere), fixed seeds, at the counts in `counts` (default the
 * full house mix). These are the classes a real violation would show up
 * on — a bound the marcher could step straight through.
 */
function buildOffsetQueries(
  cloud: ChaosGameResult,
  sCenterSq: Float64Array,
  b: Balloon,
  counts: OffsetQueryCounts = FULL_OFFSET_COUNTS,
): Vec3[] {
  const out: Vec3[] = [];

  const jitterRng = mulberry32(2);
  const stride = Math.max(1, Math.floor(cloud.count / counts.jittered));
  let jittered = 0;
  for (let i = 0; i < cloud.count && jittered < counts.jittered; i += stride) {
    out.push([
      cloud.positions[i * 3] + (jitterRng() - 0.5) * 0.3,
      cloud.positions[i * 3 + 1] + (jitterRng() - 0.5) * 0.3,
      cloud.positions[i * 3 + 2] + (jitterRng() - 0.5) * 0.3,
    ]);
    jittered++;
  }

  const uniformRng = mulberry32(3);
  const half = 1.2 * b.rho;
  for (let i = 0; i < counts.uniform; i++) {
    out.push([
      b.center[0] + (uniformRng() - 0.5) * 2 * half,
      b.center[1] + (uniformRng() - 0.5) * 2 * half,
      b.center[2] + (uniformRng() - 0.5) * 2 * half,
    ]);
  }

  const decile = decileRadius(sCenterSq);
  const decileSq = decile * decile;
  const shellRng = mulberry32(5);
  const pickTopDecile = (): Vec3 => {
    for (;;) {
      const i = Math.floor(shellRng() * cloud.count);
      if (sCenterSq[i] >= decileSq) {
        return [
          cloud.positions[i * 3],
          cloud.positions[i * 3 + 1],
          cloud.positions[i * 3 + 2],
        ];
      }
    }
  };
  for (let i = 0; i < counts.nearShell; i++) {
    const q = invertBalloon(b, pickTopDecile());
    const dir = unitDir(shellRng);
    const mag = (0.01 + 0.24 * shellRng()) * b.rho;
    out.push([q[0] + dir[0] * mag, q[1] + dir[1] * mag, q[2] + dir[2] * mag]);
  }

  const centerRng = mulberry32(6);
  for (let i = 0; i < counts.nearCenter; i++) {
    const dir = unitDir(centerRng);
    const mag = Math.pow(10, -4 + 3.5 * centerRng()) * b.rho;
    out.push([
      b.center[0] + dir[0] * mag,
      b.center[1] + dir[1] * mag,
      b.center[2] + dir[2] * mag,
    ]);
  }

  const sphereRng = mulberry32(7);
  for (let i = 0; i < counts.onSphere; i++) {
    const dir = unitDir(sphereRng);
    out.push([
      b.center[0] + dir[0] * b.R,
      b.center[1] + dir[1] * b.R,
      b.center[2] + dir[2] * b.R,
    ]);
  }

  return out;
}

/** Copied verbatim from `scripts/harness-profiles.ts`'s `foldBoxfoldPair()`
 * (tests must not import from `scripts/`): both maps pure `boxfold`, 27
 * branches each, every one a reflection + translation isometry. */
function foldBoxfoldPair(): Transform[] {
  return [
    {
      id: 0,
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.45, 0.45, 0.45],
      variations: [{ type: "boxfold", weight: 1 }],
    },
    {
      id: 1,
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.5, 0.5, 0.5],
      variations: [{ type: "boxfold", weight: 0.9 }],
    },
  ];
}

describe("balloon-de", () => {
  describe("inversion identity + involution", () => {
    it("holds the |p-I(s)| = |p-c|*|I(p)-s|/|s-c| identity and is self-inverse, to f64 roundoff", () => {
      // Ported from balloon-inversion.harness.ts's section (0), at reduced
      // scale (2000 pairs instead of 20000). The reference scan below
      // (nearestShell, identity form) and the wrapper under test
      // (estimateBalloonDistance, direct form) both reduce to a single
      // invertBalloon call — this pins THAT implementation against the
      // mathematical identity itself, so the two call sites cannot share a
      // bug in it.
      const b: Balloon = { center: [0.3, -0.2, 0.1], rho: 1.7, R: 2.3 };
      const rng = mulberry32(42);
      let worstIdentity = 0;
      let worstInvolution = 0;
      for (let i = 0; i < 2000; i++) {
        const dp = unitDir(rng);
        const ds = unitDir(rng);
        const rp = Math.pow(10, -4 + 5 * rng()) * b.rho;
        const rs = Math.pow(10, -4 + 5 * rng()) * b.rho;
        const p: Vec3 = [
          b.center[0] + dp[0] * rp,
          b.center[1] + dp[1] * rp,
          b.center[2] + dp[2] * rp,
        ];
        const s: Vec3 = [
          b.center[0] + ds[0] * rs,
          b.center[1] + ds[1] * rs,
          b.center[2] + ds[2] * rs,
        ];
        const is = invertBalloon(b, s);
        const direct = Math.hypot(p[0] - is[0], p[1] - is[1], p[2] - is[2]);
        const a = invertBalloon(b, p);
        const viaIdentity =
          (rp * Math.hypot(a[0] - s[0], a[1] - s[1], a[2] - s[2])) / rs;
        const scale = Math.max(direct, viaIdentity, 1e-300);
        worstIdentity = Math.max(
          worstIdentity,
          Math.abs(direct - viaIdentity) / scale,
        );
        const back = invertBalloon(b, invertBalloon(b, p));
        worstInvolution = Math.max(
          worstInvolution,
          Math.hypot(back[0] - p[0], back[1] - p[1], back[2] - p[2]) /
            Math.max(rp, 1e-300),
        );
      }
      expect(worstIdentity).toBeLessThan(1e-9);
      expect(worstInvolution).toBeLessThan(1e-9);
    });
  });

  describe("balloonBall / buildBalloon", () => {
    it("uses the DE's probe-fit ball for a plain system", () => {
      const de = buildSurfaceDE(defaultTransforms(), null, {
        order: 1,
        plane: "xz",
      });
      const ball = balloonBall(de);
      expect(ball.center).toEqual(de.boundCenter);
      expect(ball.radius).toBe(de.boundingRadius);
    });

    it("uses the analytic origin-centered visible ball for a lens system", () => {
      // Shape copied from balloon-inversion.harness.ts's lensArchetype().
      const final: Transform = {
        id: 99,
        position: [0.15, -0.1, 0.05],
        rotation: [0.25, 0.4, 0.1],
        scale: [0.85, 0.85, 0.85],
        variations: [{ type: "boxfold", weight: 1 }],
      };
      const de = buildSurfaceDE(defaultTransforms(), final, {
        order: 1,
        plane: "xz",
      });
      const ball = balloonBall(de);
      expect(ball.center).toEqual([0, 0, 0]);
      expect(ball.radius).toBe(de.visibleBoundingRadius);
    });

    it("margins the raw radius into rho and scales it by rMult into R", () => {
      const de = buildSurfaceDE(defaultTransforms(), null, {
        order: 1,
        plane: "xz",
      });
      const ball = balloonBall(de);
      const b = buildBalloon(de, 1.6);
      expect(b.center).toEqual(ball.center);
      expect(b.rho).toBe(ball.radius * BALLOON_RHO_MARGIN);
      expect(b.R).toBe(1.6 * ball.radius);
    });
  });

  describe("conservativeness against the sampled union", () => {
    it("stays under the sampled union on an affine system across R regimes (refined estimator)", () => {
      const transforms = defaultTransforms();
      const de = buildSurfaceDE(transforms, null, { order: 1, plane: "xz" });
      const cloud = runChaosGame(transforms, 24_000, mulberry32(101), null, {
        order: 1,
        plane: "xz",
      });
      const sCenterSq = centerDistSq(cloud, de.boundCenter);
      for (const rMult of [0.35, 0.9, 1.6]) {
        const b = buildBalloon(de, rMult);
        const queries = buildOffsetQueries(cloud, sCenterSq, b);
        for (const p of queries) {
          const dUnion = Math.min(
            nearestPlain(cloud, p),
            nearestShell(cloud, sCenterSq, b, p),
          );
          const est = estimateBalloonDistance(
            estimateDistanceRefined,
            de,
            b,
            p,
          );
          expect(est.d).toBeLessThanOrEqual(dUnion + 1e-9);
        }
      }
    });

    it("stays under the sampled union on a fold system across R regimes (base estimator)", () => {
      // Production fold paths march estimateDistance — the estimator the
      // fold GLSL/WGSL cores mirror. estimateDistanceRefined on a fold
      // system carries a disclosed pre-existing width-bound tail (fr-tikz)
      // and is not what fold systems march, so it is deliberately not
      // exercised here.
      const transforms = foldBoxfoldPair();
      const de = buildSurfaceDE(transforms, null, { order: 1, plane: "xz" });
      const cloud = runChaosGame(transforms, 24_000, mulberry32(101), null, {
        order: 1,
        plane: "xz",
      });
      const sCenterSq = centerDistSq(cloud, de.boundCenter);
      const counts: OffsetQueryCounts = {
        jittered: 100,
        uniform: 70,
        nearShell: 50,
        nearCenter: 40,
        onSphere: 40,
      };
      for (const rMult of [0.35, 1.6]) {
        const b = buildBalloon(de, rMult);
        const queries = buildOffsetQueries(cloud, sCenterSq, b, counts);
        for (const p of queries) {
          const dUnion = Math.min(
            nearestPlain(cloud, p),
            nearestShell(cloud, sCenterSq, b, p),
          );
          const est = estimateBalloonDistance(estimateDistance, de, b, p);
          expect(est.d).toBeLessThanOrEqual(dUnion + 1e-9);
        }
      }
    });

    it("stays under the sampled union with a nonzero footprint on the fold system", () => {
      // Same boxfold pair and cloud recipe as the fold test above, rebuilt
      // inline (DAMP) rather than sharing it — only the "uniform" query
      // class (mulberry32(3), +/-1.2*rho box) and the generic
      // nearestPlain/nearestShell/centerDistSq reference machinery are
      // reused.
      const transforms: Transform[] = [
        {
          id: 0,
          position: [0.4, 0.1, 0],
          rotation: [0.3, 0.2, 0],
          scale: [0.45, 0.45, 0.45],
          variations: [{ type: "boxfold", weight: 1 }],
        },
        {
          id: 1,
          position: [-0.35, -0.2, 0.3],
          rotation: [0, 0.5, 0.1],
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "boxfold", weight: 0.9 }],
        },
      ];
      const de = buildSurfaceDE(transforms, null, { order: 1, plane: "xz" });
      const cloud = runChaosGame(transforms, 24_000, mulberry32(101), null, {
        order: 1,
        plane: "xz",
      });
      const sCenterSq = centerDistSq(cloud, de.boundCenter);
      const b = buildBalloon(de, 1.6);
      const footprint = 0.02 * b.rho;
      const rng = mulberry32(3);
      const half = 1.2 * b.rho;
      for (let i = 0; i < 100; i++) {
        const p: Vec3 = [
          b.center[0] + (rng() - 0.5) * 2 * half,
          b.center[1] + (rng() - 0.5) * 2 * half,
          b.center[2] + (rng() - 0.5) * 2 * half,
        ];
        const dUnion = Math.min(
          nearestPlain(cloud, p),
          nearestShell(cloud, sCenterSq, b, p),
        );
        const est = estimateBalloonDistance(
          estimateDistance,
          de,
          b,
          p,
          0,
          footprint,
        );
        expect(est.d).toBeLessThanOrEqual(dUnion + 1e-9);
      }
    });
  });

  describe("shell term formula and argument routing (stub estimator)", () => {
    it("scales the shell call's point/cutoff/footprint and passes the fractal call through verbatim", () => {
      const de = buildSurfaceDE(defaultTransforms(), null, {
        order: 1,
        plane: "xz",
      });
      const calls: { p: Vec3; cutoff: number; footprint: number }[] = [];
      const stub: BalloonEstimator = (_de, p, cutoff = 0, footprint = 0) => {
        calls.push({ p, cutoff, footprint });
        return calls.length === 1 ? 100 : 0.7;
      };
      const b: Balloon = { center: [0.3, -0.2, 0.1], rho: 2.04, R: 3.2 };
      const p: Vec3 = [b.center[0] + 1.5, b.center[1], b.center[2]];
      // Mirrors estimateBalloonDistance's own dx/dy/dz/r/scale computation
      // exactly, so the values below are bit-identical to what the
      // wrapper computes internally — not independently re-derived.
      const dx = p[0] - b.center[0];
      const dy = p[1] - b.center[1];
      const dz = p[2] - b.center[2];
      const r = Math.max(Math.hypot(dx, dy, dz), BALLOON_CENTER_FLOOR * b.rho);
      const scale = r / b.rho;

      const result = estimateBalloonDistance(stub, de, b, p, 0.25, 0.01);

      expect(calls).toHaveLength(2);
      // Outer (fractal) call: p/cutoff/footprint pass through verbatim.
      expect(calls[0].p[0]).toBe(p[0]);
      expect(calls[0].p[1]).toBe(p[1]);
      expect(calls[0].p[2]).toBe(p[2]);
      expect(calls[0].cutoff).toBe(0.25);
      expect(calls[0].footprint).toBe(0.01);

      // Inner (shell) call: point is invertBalloon(b, p); cutoff/footprint
      // scaled by the wrapper's documented factors.
      const expectedInner = invertBalloon(b, p);
      expect(calls[1].p[0]).toBe(expectedInner[0]);
      expect(calls[1].p[1]).toBe(expectedInner[1]);
      expect(calls[1].p[2]).toBe(expectedInner[2]);
      expect(calls[1].cutoff).toBe(0.25 / scale);
      expect(calls[1].footprint).toBe((0.01 * (b.R * b.R)) / (r * r));

      expect(result.d).toBe(scale * 0.7);
      expect(result.shell).toBe(true);
    });

    it("breaks a tie between the two terms in favor of the fractal term", () => {
      const de = buildSurfaceDE(defaultTransforms(), null, {
        order: 1,
        plane: "xz",
      });
      const b: Balloon = { center: [0.3, -0.2, 0.1], rho: 2.04, R: 3.2 };
      const p: Vec3 = [b.center[0] + 1.5, b.center[1], b.center[2]];
      const dx = p[0] - b.center[0];
      const dy = p[1] - b.center[1];
      const dz = p[2] - b.center[2];
      const r = Math.max(Math.hypot(dx, dy, dz), BALLOON_CENTER_FLOOR * b.rho);
      const scale = r / b.rho;
      const innerValue = 0.7;
      // The outer (fractal) stub return is computed with the SAME scale
      // used by the wrapper, so dFractal and dShell land bit-identical.
      const tieValue = scale * innerValue;
      let calls = 0;
      const stub: BalloonEstimator = () => {
        calls++;
        return calls === 1 ? tieValue : innerValue;
      };

      const result = estimateBalloonDistance(stub, de, b, p);

      expect(result.shell).toBe(false);
      expect(result.d).toBe(tieValue);
    });
  });

  describe("center limit", () => {
    it("the shell term approaches R^2/rho as the query approaches the center", () => {
      const de = buildSurfaceDE(defaultTransforms(), null, {
        order: 1,
        plane: "xz",
      });
      const c: Vec3 = [0.3, -0.2, 0.1];
      const b: Balloon = { center: c, rho: 1.02, R: 1.6 };
      const limit = (b.R * b.R) / b.rho;
      let worstDeviation = Infinity;
      for (const r0 of [1e-3, 1e-6, 1e-9]) {
        let callIndex = 0;
        const stub: BalloonEstimator = (_de, q) => {
          callIndex++;
          // Outer (fractal) term: large and irrelevant here — the point
          // this test wants to isolate is the shell term's limit.
          if (callIndex === 1) return 1e6;
          // Inner (shell) term: the exact-outside DE of a unit sphere set
          // centered at c.
          return Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) - 1;
        };
        const p: Vec3 = [c[0] + r0, c[1], c[2]];
        const expected = limit - r0 / b.rho;
        const est = estimateBalloonDistance(stub, de, b, p);
        expect(est.shell).toBe(true);
        expect(Math.abs(est.d - expected)).toBeLessThan(1e-9 * b.R * b.R);
        const deviation = Math.abs(est.d - limit);
        expect(deviation).toBeLessThan(worstDeviation);
        worstDeviation = deviation;
      }
    });
  });

  describe("cutoff contract (fr-55r5)", () => {
    it("honors the cutoff contract on an affine system (refined estimator)", () => {
      const transforms = defaultTransforms();
      const de = buildSurfaceDE(transforms, null, { order: 1, plane: "xz" });
      const b = buildBalloon(de, 1.6);
      const rng = mulberry32(9);
      const half = 1.4 * b.rho;
      for (let i = 0; i < 40; i++) {
        const p: Vec3 = [
          b.center[0] + (rng() - 0.5) * 2 * half,
          b.center[1] + (rng() - 0.5) * 2 * half,
          b.center[2] + (rng() - 0.5) * 2 * half,
        ];
        const full = estimateBalloonDistance(estimateDistanceRefined, de, b, p);
        for (const mult of [0.5, 0.9, 2, 10]) {
          const cutoff = mult * Math.max(full.d, 1e-6);
          const cut = estimateBalloonDistance(
            estimateDistanceRefined,
            de,
            b,
            p,
            cutoff,
          );
          if (cut.d >= cutoff) {
            expect(cut.d).toBe(full.d);
            expect(cut.shell).toBe(full.shell);
          } else {
            expect(full.d).toBeLessThan(cutoff);
          }
        }
      }
    });

    it("honors the cutoff contract on a fold system (base estimator)", () => {
      const transforms = foldBoxfoldPair();
      const de = buildSurfaceDE(transforms, null, { order: 1, plane: "xz" });
      const b = buildBalloon(de, 1.6);
      const rng = mulberry32(9);
      const half = 1.4 * b.rho;
      for (let i = 0; i < 40; i++) {
        const p: Vec3 = [
          b.center[0] + (rng() - 0.5) * 2 * half,
          b.center[1] + (rng() - 0.5) * 2 * half,
          b.center[2] + (rng() - 0.5) * 2 * half,
        ];
        const full = estimateBalloonDistance(estimateDistance, de, b, p);
        for (const mult of [0.5, 0.9, 2, 10]) {
          const cutoff = mult * Math.max(full.d, 1e-6);
          const cut = estimateBalloonDistance(
            estimateDistance,
            de,
            b,
            p,
            cutoff,
          );
          if (cut.d >= cutoff) {
            expect(cut.d).toBe(full.d);
            expect(cut.shell).toBe(full.shell);
          } else {
            expect(full.d).toBeLessThan(cutoff);
          }
        }
      }
    });
  });

  describe("term attribution", () => {
    it("picks the fractal term beyond the attractor's edge and the shell term beyond its inverted image", () => {
      const transforms = defaultTransforms();
      const de = buildSurfaceDE(transforms, null, { order: 1, plane: "xz" });
      const cloud = runChaosGame(transforms, 24_000, mulberry32(101), null, {
        order: 1,
        plane: "xz",
      });
      const b = buildBalloon(de, 1.6);

      let bestD2 = -Infinity;
      let farthest: Vec3 = [0, 0, 0];
      for (let i = 0; i < cloud.count; i++) {
        const dx = cloud.positions[i * 3] - b.center[0];
        const dy = cloud.positions[i * 3 + 1] - b.center[1];
        const dz = cloud.positions[i * 3 + 2] - b.center[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > bestD2) {
          bestD2 = d2;
          farthest = [
            cloud.positions[i * 3],
            cloud.positions[i * 3 + 1],
            cloud.positions[i * 3 + 2],
          ];
        }
      }

      const outward = (from: Vec3): Vec3 => {
        const dx = from[0] - b.center[0];
        const dy = from[1] - b.center[1];
        const dz = from[2] - b.center[2];
        const n = Math.hypot(dx, dy, dz);
        return [dx / n, dy / n, dz / n];
      };
      const nudge = 0.02 * b.rho;

      // Query A: the farthest attractor sample, nudged further out — the
      // fractal is right there, the cave wall is ~R^2/rho - rho away.
      const dirA = outward(farthest);
      const queryA: Vec3 = [
        farthest[0] + dirA[0] * nudge,
        farthest[1] + dirA[1] * nudge,
        farthest[2] + dirA[2] * nudge,
      ];
      const resultA = estimateBalloonDistance(
        estimateDistanceRefined,
        de,
        b,
        queryA,
      );
      expect(resultA.shell).toBe(false);

      // Query B: that sample's inverted image, nudged further out — the
      // wall is right there, the attractor is far away.
      const inverted = invertBalloon(b, farthest);
      const dirB = outward(inverted);
      const queryB: Vec3 = [
        inverted[0] + dirB[0] * nudge,
        inverted[1] + dirB[1] * nudge,
        inverted[2] + dirB[2] * nudge,
      ];
      const resultB = estimateBalloonDistance(
        estimateDistanceRefined,
        de,
        b,
        queryB,
      );
      expect(resultB.shell).toBe(true);
    });
  });
});

/**
 * fr-qxxw: the 4D lift's entry points -- balloonBall4/buildBalloon4/
 * estimateBalloonDistance4, one dimension up from the describes above.
 * Mirrors their structure closely; see each block for what changes (and
 * what deliberately does not) crossing into 4D.
 */

describe("balloonBall4 (fr-qxxw)", () => {
  it("returns the origin and visibleBoundingRadius with or without a final transform -- the 3D final-transform fork is absent because 4D's ball is origin-anchored by construction", () => {
    const transforms = pentatope();
    const plain = buildSurfaceDE4(transforms);
    const finalTransform: Transform = {
      id: 99,
      position: [0.2, -0.1, 0.05],
      rotation: [0.25, 0.4, 0.1],
      scale: [0.85, 0.85, 0.85],
    };
    const lensed = buildSurfaceDE4(transforms, finalTransform);
    expect(plain.final).toBeNull();
    expect(lensed.final).not.toBeNull();
    // The two systems' visible radii genuinely differ (a real final
    // transform moves the visible set), so the "same formula either way"
    // checks below are not vacuous.
    expect(lensed.visibleBoundingRadius).not.toBe(plain.visibleBoundingRadius);

    const ballPlain = balloonBall4(plain);
    expect(ballPlain.center).toEqual([0, 0, 0]);
    expect(ballPlain.radius).toBe(plain.visibleBoundingRadius);

    const ballLensed = balloonBall4(lensed);
    expect(ballLensed.center).toEqual([0, 0, 0]);
    expect(ballLensed.radius).toBe(lensed.visibleBoundingRadius);
  });

  it("bounds EVERY w-slice about the origin, which is the one new precondition the 4D shell bound has", () => {
    // The shell term DIVIDES by rho, so rho under-covering the drawn set
    // inflates the bound into genuine overshoot -- and in 4D the drawn set
    // is a SLICE. The transfer argument on estimateBalloonDistance4 says
    // the slice sits inside ball(0, R4) because |q| <= |(q, w0)| <= R4;
    // this is that inequality measured, on the set the chaos game plots
    // rather than on the claim.
    const de4 = buildSurfaceDE4(pentatope());
    const radius = balloonBall4(de4).radius;
    const cloud = runChaosGame4(
      pentatope().map(toTransform4),
      40000,
      mulberry32(0x5b1c4),
    );
    // NOTE the storage: `runChaosGame4` keeps xyz at stride 3 and `w` in
    // its OWN array (the cloud uploads them as separate attributes), so a
    // stride-4 read here silently mixes coordinates from three different
    // points — which is exactly what a first cut of this test did, and it
    // "found" a 6.8% ball violation that does not exist.
    let worst4 = 0;
    let worst3 = 0;
    for (let i = 0; i < cloud.count; i++) {
      const x = cloud.positions[i * 3];
      const y = cloud.positions[i * 3 + 1];
      const z = cloud.positions[i * 3 + 2];
      const w = cloud.w[i];
      worst4 = Math.max(worst4, Math.hypot(x, y, z, w));
      worst3 = Math.max(worst3, Math.hypot(x, y, z));
    }
    // The 4D ball covers the 4D set...
    expect(worst4).toBeLessThanOrEqual(radius);
    // ...and therefore every slice's 3D projection, with room to spare
    // (the projection drops |w|, so this is the strictly easier bound —
    // asserted separately because it is the one the shell term uses).
    expect(worst3).toBeLessThanOrEqual(radius);
    expect(worst3).toBeLessThanOrEqual(worst4);
  });
});

describe("buildBalloon4 (fr-qxxw)", () => {
  it("margins the raw radius into rho and scales it by rMult into R, exactly as buildBalloon does", () => {
    const de4 = buildSurfaceDE4(pentatope());
    const ball = balloonBall4(de4);
    const b = buildBalloon4(de4, 1.6);
    expect(b.center).toEqual(ball.center);
    expect(b.rho).toBe(ball.radius * BALLOON_RHO_MARGIN);
    expect(b.R).toBe(1.6 * ball.radius);
  });
});

describe("estimateBalloonDistance4 conservativeness against each term's own certified value (fr-qxxw)", () => {
  it("never exceeds either term's own value and matches min(fractal, scale*shell) exactly, across rMult regimes and w0 slices", () => {
    // A faithful port of the 3D conservativeness test above -- sample a
    // cloud of the DRAWN SLICE, measure true nearest-neighbor distances --
    // is not possible here: surface-de-4d.ts has no cloud helper for the
    // SLICE S = A ∩ {w = w0}. runChaosGame4 samples the RAW 4D attractor,
    // and a continuous chaos game has essentially zero probability of
    // landing exactly on any hyperplane, so there is no "cloud of the
    // visible set" here the way 3D's runChaosGame IS the visible set. A
    // slab-filtered approximation (keep cloud samples with
    // |w_i - w0| < dw, treat their (x, y, z) as approximate slice samples)
    // was tried and rejected: measured on pentatope, dw = 0.05,
    // N = 400,000, over the same rMult/w0 grid this test uses, 10 of 540
    // queries (1.9%) read the WRAPPER above the slab-sampled "ground
    // truth" by up to 0.013 (~1.3% of boundingRadius) -- not sampling
    // noise but a structural artifact, since "near in w" does not imply
    // "near the slice in (x, y, z)" for a fractal attractor (confirmed by
    // the slab occupancy itself: 533 of 400,000 points at w0 = 0.35,
    // dw = 0.02, against 8,253 at w0 = 0 -- density is wildly non-uniform,
    // not merely sparse, so no fixed slack rescues it). So this pins the
    // WEAKER property the module doc's own argument actually rests on:
    // the wrapper is a MIN of two terms, each independently certified
    // elsewhere (estimateDistance4Refined's own validity suite in
    // surface-de-4d.test.ts), composed by one specific formula -- checked
    // here against a real build rather than a stub.
    const transforms = pentatope();
    const de4 = buildSurfaceDE4(transforms);
    const rng = mulberry32(7);
    let sawShellWin = false;
    let sawFractalWin = false;
    for (const w0 of [0, 0.15, 0.35]) {
      for (const rMult of [0.35, 0.9, 1.6]) {
        const b = buildBalloon4(de4, rMult);
        const half = 1.2 * b.rho;
        for (let i = 0; i < 20; i++) {
          const p: Vec3 = [
            b.center[0] + (rng() - 0.5) * 2 * half,
            b.center[1] + (rng() - 0.5) * 2 * half,
            b.center[2] + (rng() - 0.5) * 2 * half,
          ];
          const dFractal = estimateDistance4Refined(de4, [
            p[0],
            p[1],
            p[2],
            w0,
          ]);
          const dx = p[0] - b.center[0];
          const dy = p[1] - b.center[1];
          const dz = p[2] - b.center[2];
          const r = Math.max(
            Math.hypot(dx, dy, dz),
            BALLOON_CENTER_FLOOR * b.rho,
          );
          const scale = r / b.rho;
          const inv = invertBalloon(b, p);
          const dShell =
            scale * estimateDistance4Refined(de4, [inv[0], inv[1], inv[2], w0]);

          const est = estimateBalloonDistance4(
            estimateDistance4Refined,
            de4,
            b,
            p,
            w0,
          );

          expect(est.d).toBeLessThanOrEqual(dFractal);
          expect(est.d).toBeLessThanOrEqual(dShell);
          expect(est.d).toBe(Math.min(dFractal, dShell));
          if (est.shell) sawShellWin = true;
          else sawFractalWin = true;
        }
      }
    }
    // Both branches must fire somewhere in the grid, or the checks above
    // would only ever exercise one term.
    expect(sawShellWin).toBe(true);
    expect(sawFractalWin).toBe(true);
  });
});

describe("estimateBalloonDistance4 shell term formula and argument routing (stub estimator) (fr-qxxw)", () => {
  it("lifts the 3D-inverted point with the SAME w0 on the shell call, passes (p, w0) verbatim on the fractal call, scales the inner cutoff by 1/scale, and threads halfExtent through both calls untouched", () => {
    const w0 = 0.22;
    const halfExtent: Vec4 = [0.01, 0.02, -0.015, 0.03];
    const calls: { p: Vec4; cutoff: number; halfExtent: Vec4 | null }[] = [];
    const stub: BalloonEstimator4 = (_de, p, cutoff = 0, he = null) => {
      calls.push({ p, cutoff, halfExtent: he });
      return calls.length === 1 ? 100 : 0.7;
    };
    const de4 = buildSurfaceDE4(pentatope());
    const b: Balloon = { center: [0.3, -0.2, 0.1], rho: 2.04, R: 3.2 };
    const p: Vec3 = [b.center[0] + 1.5, b.center[1], b.center[2]];
    // Mirrors estimateBalloonDistance4's own dx/dy/dz/r/scale computation
    // exactly, so the values below are bit-identical to what the wrapper
    // computes internally -- not independently re-derived.
    const dx = p[0] - b.center[0];
    const dy = p[1] - b.center[1];
    const dz = p[2] - b.center[2];
    const r = Math.max(Math.hypot(dx, dy, dz), BALLOON_CENTER_FLOOR * b.rho);
    const scale = r / b.rho;

    const result = estimateBalloonDistance4(
      stub,
      de4,
      b,
      p,
      w0,
      0.25,
      halfExtent,
    );

    expect(calls).toHaveLength(2);
    // Outer (fractal) call: (p, w0) verbatim, cutoff verbatim, halfExtent
    // untouched.
    expect(calls[0].p).toEqual([p[0], p[1], p[2], w0]);
    expect(calls[0].cutoff).toBe(0.25);
    expect(calls[0].halfExtent).toBe(halfExtent);

    // Inner (shell) call: the 3D-inverted point, lifted with the SAME w0
    // (slice-then-invert -- the inversion is a 3D operation on the marched
    // point, never touching w); cutoff scaled by 1/scale; halfExtent
    // untouched.
    const expectedInner = invertBalloon(b, p);
    expect(calls[1].p).toEqual([
      expectedInner[0],
      expectedInner[1],
      expectedInner[2],
      w0,
    ]);
    expect(calls[1].cutoff).toBe(0.25 / scale);
    expect(calls[1].halfExtent).toBe(halfExtent);

    expect(result.d).toBe(scale * 0.7);
    expect(result.shell).toBe(true);
  });
});

describe("estimateBalloonDistance4 tie-breaking (fr-qxxw)", () => {
  it("breaks a tie between the two terms in favor of the fractal term", () => {
    const de4 = buildSurfaceDE4(pentatope());
    const b: Balloon = { center: [0.3, -0.2, 0.1], rho: 2.04, R: 3.2 };
    const p: Vec3 = [b.center[0] + 1.5, b.center[1], b.center[2]];
    const w0 = 0.1;
    const dx = p[0] - b.center[0];
    const dy = p[1] - b.center[1];
    const dz = p[2] - b.center[2];
    const r = Math.max(Math.hypot(dx, dy, dz), BALLOON_CENTER_FLOOR * b.rho);
    const scale = r / b.rho;
    const innerValue = 0.7;
    // The outer (fractal) stub return is computed with the SAME scale used
    // by the wrapper, so dFractal and dShell land bit-identical.
    const tieValue = scale * innerValue;
    let calls = 0;
    const stub: BalloonEstimator4 = () => {
      calls++;
      return calls === 1 ? tieValue : innerValue;
    };

    const result = estimateBalloonDistance4(stub, de4, b, p, w0);

    expect(result.shell).toBe(false);
    expect(result.d).toBe(tieValue);
  });
});

describe("estimateBalloonDistance4 center limit (fr-qxxw)", () => {
  it("the shell term approaches R^2/rho as the query approaches the center", () => {
    const de4 = buildSurfaceDE4(pentatope());
    const c: Vec3 = [0.3, -0.2, 0.1];
    const b: Balloon = { center: c, rho: 1.02, R: 1.6 };
    const w0 = 0.05;
    const limit = (b.R * b.R) / b.rho;
    let worstDeviation = Infinity;
    for (const r0 of [1e-3, 1e-6, 1e-9]) {
      let callIndex = 0;
      const stub: BalloonEstimator4 = (_de, q) => {
        callIndex++;
        // Outer (fractal) term: large and irrelevant here -- the point
        // this test wants to isolate is the shell term's limit.
        if (callIndex === 1) return 1e6;
        // Inner (shell) term: the exact-outside DE of a unit sphere set
        // centered at c -- q's w component is always w0 (the SAME w0 on
        // both calls), which is why it never needs to appear here.
        return Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) - 1;
      };
      const p: Vec3 = [c[0] + r0, c[1], c[2]];
      const expected = limit - r0 / b.rho;
      const est = estimateBalloonDistance4(stub, de4, b, p, w0);
      expect(est.shell).toBe(true);
      expect(Math.abs(est.d - expected)).toBeLessThan(1e-9 * b.R * b.R);
      const deviation = Math.abs(est.d - limit);
      expect(deviation).toBeLessThan(worstDeviation);
      worstDeviation = deviation;
    }
  });
});
