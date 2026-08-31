import { mulberry32 } from "./rng";
import { shapeSdf } from "./shapes";
import type { ShapeSpec } from "./shapes";
import {
  estimateBulbDistanceTiled,
  estimateDistance4RefinedTiled,
  estimateDistance4Tiled,
  estimateDistanceRefinedTiled,
  estimateDistanceTiled,
  estimateEscapeDistance4Tiled,
  estimateEscapeDistanceTiled,
} from "./tiling-de";
import {
  TILING_GROUP_INFO,
  enumerateOrbit,
  foldLattice3,
  foldLattice4,
  foldToChamber,
  isInChamber,
  resolveTiling,
} from "./tiling";
import type { TilingGroup, TilingGroupInfo } from "./tiling";
import { estimateDistance, estimateDistanceRefined } from "./surface-de";
import { estimateDistance4, estimateDistance4Refined } from "./surface-de-4d";
import { estimateEscapeDistance } from "./escape-de";
import { estimateBulbDistance } from "./bulb-de";
import { estimateEscapeDistance4 } from "./escape-de-4d";
import { buildBulbDE } from "./bulb-de";
import { buildEscapeDE } from "./escape-de";
import { buildEscapeDE4 } from "./escape-de-4d";
import { buildSurfaceDE } from "./surface-de";
import { buildSurfaceDE4 } from "./surface-de-4d";
import {
  mandelbulbClassic,
  mandelboxKifs,
  pentatope,
  sierpinskiTetrahedron,
} from "./presets";
import type { Transform, Vec3, Vec4 } from "./types";

/** The 3D groups — the fold's dimension must match the query's. */
const GROUPS3: TilingGroup[] = ["a3", "b3", "h3"];
/** The 4D groups. */
const GROUPS4: TilingGroup[] = ["a4", "b4", "f4"];

/** A signed-distance clip for the tests: one posed unit sphere. */
function sphereClip(offset: Vec3, radius: number): ShapeSpec {
  return {
    parts: [
      {
        primitive: { kind: "sphere", radius },
        combine: "union",
        pose: { offset },
      },
    ],
  };
}

/** Root `i` of a group's table, as a fresh array. */
function root(info: TilingGroupInfo, i: number): number[] {
  const dim = info.dim;
  return info.roots.slice(i * dim, i * dim + dim);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let j = 0; j < a.length; j++) s += a[j] * b[j];
  return s;
}

function norm2(a: number[]): number {
  return dot(a, a);
}

function cross3(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

/** The generalized cross of three 4-vectors (`tiling.test.ts`'s oracle
 * helper): `w_a = (−1)^(1+a)` times the 3x3 minor omitting column `a`. */
function cross4(a: number[], b: number[], c: number[]): number[] {
  const w: number[] = [];
  for (let col = 0; col < 4; col++) {
    const m = [0, 1, 2, 3]
      .filter((k) => k !== col)
      .map((k) => [a[k], b[k], c[k]]);
    w.push((col % 2 === 0 ? 1 : -1) * det3(m));
  }
  return w;
}

/** The chamber's extreme rays: vertex `k` is the unit direction
 * perpendicular to every wall but `k`, oriented into the chamber. Any
 * positive-weight combination lies in the chamber's INTERIOR. */
function chamberVertices(info: TilingGroupInfo): number[][] {
  const dim = info.dim;
  const vertices: number[][] = [];
  for (let k = 0; k < dim; k++) {
    const others: number[][] = [];
    for (let i = 0; i < dim; i++) if (i !== k) others.push(root(info, i));
    const raw =
      dim === 3
        ? cross3(others[0], others[1])
        : cross4(others[0], others[1], others[2]);
    if (dot(raw, root(info, k)) < 0) {
      for (let j = 0; j < dim; j++) raw[j] = -raw[j];
    }
    const len = Math.sqrt(norm2(raw));
    vertices.push(raw.map((v) => v / len));
  }
  return vertices;
}

/** A random INTERIOR chamber point (all weights positive — a generic
 * point, so the fold of it is itself and its group orbit is full). */
function chamberPoint(info: TilingGroupInfo, rng: () => number): number[] {
  const vertices = chamberVertices(info);
  const p = new Array<number>(info.dim).fill(0);
  for (let i = 0; i < vertices.length; i++) {
    const w = 0.2 + rng();
    for (let j = 0; j < info.dim; j++) p[j] += vertices[i][j] * w;
  }
  return p;
}

/** The fold into a fresh local scratch, returned as a copy — the test side
 * of the composition, independent of the module's scratch. */
function foldInto3(info: TilingGroupInfo, p: Vec3): Vec3 | null {
  const scratch: Vec3 = [0, 0, 0];
  const r = foldToChamber(info, p, scratch);
  return r === null ? null : [r[0], r[1], r[2]];
}

function foldInto4(info: TilingGroupInfo, p: Vec4): Vec4 | null {
  const scratch: Vec4 = [0, 0, 0, 0];
  const r = foldToChamber(info, p, scratch);
  return r === null ? null : [...(r as Vec4)];
}

function distToSet(q: number[], set: number[][]): number {
  let best = Infinity;
  for (const s of set) {
    let d2 = 0;
    for (let j = 0; j < q.length; j++) d2 += (q[j] - s[j]) ** 2;
    best = Math.min(best, Math.sqrt(d2));
  }
  return best;
}

/** The canonical single-map Mandelbox shape — `escape-de.test.ts`'s own
 * fixture, duplicated (test files stay DAMP-isolated in this codebase). */
function canonicalMandelbox(overrides: Partial<Transform> = {}): Transform {
  return {
    id: 0,
    position: [0.4, 0.3, 0.2],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight: 2 }],
    ...overrides,
  };
}

/** A single pure triplex-power map — `bulb-de.test.ts`'s fixture. */
function bulbSystem(overrides: Partial<Transform> = {}): Transform {
  return {
    id: 1,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "bulb", weight: 1 }],
    ...overrides,
  };
}

/** A single contractive affine map whose fixed point — the whole
 * attractor — is exactly `fixed` (solve p = 0.1p + t for t = 0.9·fixed). */
function pointAttractor(fixed: Vec3): Transform[] {
  return [
    {
      id: 0,
      position: [0.9 * fixed[0], 0.9 * fixed[1], 0.9 * fixed[2]],
      rotation: [0, 0, 0],
      scale: [0.1, 0.1, 0.1],
    },
  ];
}

describe("decomposition identity — the wrappers' definition", () => {
  const rng3 = mulberry32(101);
  const rng4 = mulberry32(102);
  const clip = sphereClip([0.4, -0.2, 0.3], 0.7);

  it("estimateDistanceTiled: wrapper === max(core, clipTerm) at the folded point (affine family)", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    for (let i = 0; i < 60; i++) {
      const group = GROUPS3[Math.floor(rng3() * GROUPS3.length)];
      for (const withClip of [false, true]) {
        const t = resolveTiling({ group, clip: withClip ? clip : undefined })!;
        const p: Vec3 = [
          (rng3() * 2 - 1) * 3,
          (rng3() * 2 - 1) * 3,
          (rng3() * 2 - 1) * 3,
        ];
        const cutoff = rng3() < 0.5 ? 0 : 0.03;
        const footprint = rng3() < 0.5 ? 0 : 0.5;
        const q = foldInto3(t.info, p);
        if (q === null) continue;
        const inner = estimateDistance(de, q, cutoff, footprint);
        const clipTerm = withClip ? shapeSdf(clip, q[0], q[1], q[2]) : 0;
        expect(estimateDistanceTiled(t, de, p, cutoff, footprint)).toBe(
          Math.max(inner, clipTerm),
        );
      }
    }
  });

  it("estimateDistanceTiled: wrapper === max(core, clipTerm) at the folded point (fold family)", () => {
    const de = buildSurfaceDE(mandelboxKifs());
    for (let i = 0; i < 40; i++) {
      const group = GROUPS3[Math.floor(rng3() * GROUPS3.length)];
      for (const withClip of [false, true]) {
        const t = resolveTiling({ group, clip: withClip ? clip : undefined })!;
        const p: Vec3 = [
          (rng3() * 2 - 1) * 3,
          (rng3() * 2 - 1) * 3,
          (rng3() * 2 - 1) * 3,
        ];
        const cutoff = rng3() < 0.5 ? 0 : 0.03;
        const footprint = rng3() < 0.5 ? 0 : 0.5;
        const q = foldInto3(t.info, p);
        if (q === null) continue;
        const inner = estimateDistance(de, q, cutoff, footprint);
        const clipTerm = withClip ? shapeSdf(clip, q[0], q[1], q[2]) : 0;
        expect(estimateDistanceTiled(t, de, p, cutoff, footprint)).toBe(
          Math.max(inner, clipTerm),
        );
      }
    }
  });

  it("estimateDistanceRefinedTiled: wrapper === max(core, clipTerm) at the folded point (affine and fold families)", () => {
    for (const de of [
      buildSurfaceDE(sierpinskiTetrahedron()),
      buildSurfaceDE(mandelboxKifs()),
    ]) {
      for (let i = 0; i < 40; i++) {
        const group = GROUPS3[Math.floor(rng3() * GROUPS3.length)];
        for (const withClip of [false, true]) {
          const t = resolveTiling({
            group,
            clip: withClip ? clip : undefined,
          })!;
          const p: Vec3 = [
            (rng3() * 2 - 1) * 3,
            (rng3() * 2 - 1) * 3,
            (rng3() * 2 - 1) * 3,
          ];
          const cutoff = rng3() < 0.5 ? 0 : 0.03;
          const footprint = rng3() < 0.5 ? 0 : 0.5;
          const q = foldInto3(t.info, p);
          if (q === null) continue;
          const inner = estimateDistanceRefined(de, q, cutoff, footprint);
          const clipTerm = withClip ? shapeSdf(clip, q[0], q[1], q[2]) : 0;
          expect(
            estimateDistanceRefinedTiled(t, de, p, cutoff, footprint),
          ).toBe(Math.max(inner, clipTerm));
        }
      }
    }
  });

  it("estimateDistance4Tiled: wrapper === max(core, clipTerm) at the folded point, clip read on the folded xyz", () => {
    const de = buildSurfaceDE4(pentatope());
    for (let i = 0; i < 60; i++) {
      const group = GROUPS4[Math.floor(rng4() * GROUPS4.length)];
      for (const withClip of [false, true]) {
        const t = resolveTiling({ group, clip: withClip ? clip : undefined })!;
        const p: Vec4 = [
          (rng4() * 2 - 1) * 2.5,
          (rng4() * 2 - 1) * 2.5,
          (rng4() * 2 - 1) * 2.5,
          (rng4() * 2 - 1) * 2.5,
        ];
        const q = foldInto4(t.info, p);
        if (q === null) continue;
        const inner = estimateDistance4(de, q, null);
        const clipTerm = withClip ? shapeSdf(clip, q[0], q[1], q[2]) : 0;
        expect(estimateDistance4Tiled(t, de, p, null)).toBe(
          Math.max(inner, clipTerm),
        );
      }
    }
  });

  it("estimateDistance4RefinedTiled: wrapper === max(core, clipTerm) at the folded point, cutoff threaded", () => {
    const de = buildSurfaceDE4(pentatope());
    for (let i = 0; i < 60; i++) {
      const group = GROUPS4[Math.floor(rng4() * GROUPS4.length)];
      for (const withClip of [false, true]) {
        const t = resolveTiling({ group, clip: withClip ? clip : undefined })!;
        const p: Vec4 = [
          (rng4() * 2 - 1) * 2.5,
          (rng4() * 2 - 1) * 2.5,
          (rng4() * 2 - 1) * 2.5,
          (rng4() * 2 - 1) * 2.5,
        ];
        const cutoff = rng4() < 0.5 ? 0 : 0.03;
        const q = foldInto4(t.info, p);
        if (q === null) continue;
        const inner = estimateDistance4Refined(de, q, cutoff, null);
        const clipTerm = withClip ? shapeSdf(clip, q[0], q[1], q[2]) : 0;
        expect(estimateDistance4RefinedTiled(t, de, p, cutoff, null)).toBe(
          Math.max(inner, clipTerm),
        );
      }
    }
  });

  it("estimateEscapeDistanceTiled: wrapper === max(core, clipTerm) at the folded point", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    for (let i = 0; i < 60; i++) {
      const group = GROUPS3[Math.floor(rng3() * GROUPS3.length)];
      for (const withClip of [false, true]) {
        const t = resolveTiling({ group, clip: withClip ? clip : undefined })!;
        const p: Vec3 = [
          (rng3() * 2 - 1) * 2.5,
          (rng3() * 2 - 1) * 2.5,
          (rng3() * 2 - 1) * 2.5,
        ];
        const maxIterations = rng3() < 0.5 ? 30 : 12;
        const q = foldInto3(t.info, p);
        if (q === null) continue;
        const inner = estimateEscapeDistance(de, q, maxIterations, null);
        const clipTerm = withClip ? shapeSdf(clip, q[0], q[1], q[2]) : 0;
        expect(estimateEscapeDistanceTiled(t, de, p, maxIterations, null)).toBe(
          Math.max(inner, clipTerm),
        );
      }
    }
  });

  it("estimateBulbDistanceTiled: wrapper === max(core, clipTerm) at the folded point", () => {
    const de = buildBulbDE([bulbSystem()]);
    for (let i = 0; i < 60; i++) {
      const group = GROUPS3[Math.floor(rng3() * GROUPS3.length)];
      for (const withClip of [false, true]) {
        const t = resolveTiling({ group, clip: withClip ? clip : undefined })!;
        const p: Vec3 = [
          (rng3() * 2 - 1) * 2.5,
          (rng3() * 2 - 1) * 2.5,
          (rng3() * 2 - 1) * 2.5,
        ];
        const maxIterations = rng3() < 0.5 ? 16 : 8;
        const q = foldInto3(t.info, p);
        if (q === null) continue;
        const inner = estimateBulbDistance(de, q, maxIterations);
        const clipTerm = withClip ? shapeSdf(clip, q[0], q[1], q[2]) : 0;
        expect(estimateBulbDistanceTiled(t, de, p, maxIterations)).toBe(
          Math.max(inner, clipTerm),
        );
      }
    }
  });

  it("estimateEscapeDistance4Tiled: wrapper === max(core, clipTerm) at the folded point", () => {
    const de = buildEscapeDE4([
      canonicalMandelbox(),
      canonicalMandelbox({ id: 1, w: { rotation: { xw: 0.3 } } }),
    ]);
    for (let i = 0; i < 60; i++) {
      const group = GROUPS4[Math.floor(rng4() * GROUPS4.length)];
      for (const withClip of [false, true]) {
        const t = resolveTiling({ group, clip: withClip ? clip : undefined })!;
        const p: Vec4 = [
          (rng4() * 2 - 1) * 2.5,
          (rng4() * 2 - 1) * 2.5,
          (rng4() * 2 - 1) * 2.5,
          (rng4() * 2 - 1) * 2.5,
        ];
        const maxIterations = rng4() < 0.5 ? 30 : 12;
        const q = foldInto4(t.info, p);
        if (q === null) continue;
        const inner = estimateEscapeDistance4(de, q, maxIterations, null);
        const clipTerm = withClip ? shapeSdf(clip, q[0], q[1], q[2]) : 0;
        expect(
          estimateEscapeDistance4Tiled(t, de, p, maxIterations, null),
        ).toBe(Math.max(inner, clipTerm));
      }
    }
  });
});

describe("absent clip — the term vanishes", () => {
  it("wrapper === the underlying estimator at the folded point when the tiling carries no clip", () => {
    const rng = mulberry32(201);
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    for (let i = 0; i < 30; i++) {
      const group = GROUPS3[Math.floor(rng() * GROUPS3.length)];
      // A TilingSpec with NO clip key at all — the absent-field path.
      const t = resolveTiling({ group })!;
      expect(t.clip).toBeUndefined();
      const p: Vec3 = [
        (rng() * 2 - 1) * 3,
        (rng() * 2 - 1) * 3,
        (rng() * 2 - 1) * 3,
      ];
      const q = foldInto3(t.info, p);
      if (q === null) continue;
      expect(estimateDistanceTiled(t, de, p)).toBe(estimateDistance(de, q));
      expect(estimateDistanceRefinedTiled(t, de, p)).toBe(
        estimateDistanceRefined(de, q),
      );
    }
  });
});

describe("single-map nearest copy — no overshoot, membership (test 4)", () => {
  for (const group of GROUPS3) {
    describe(`group ${group}`, () => {
      it("the wrapper never exceeds d(q, orbit) and hits at orbit members", () => {
        const info = TILING_GROUP_INFO[group];
        const rng = mulberry32(300 + info.order);
        // A generic chamber point scaled to |c| ~ 1.5 — the single map's
        // fixed point, IN the chamber, so S = A ∩ C = A and the rendered
        // set is exactly the orbit of c (the nearest-copy theorem).
        const raw = chamberPoint(info, rng);
        const len = Math.sqrt(norm2(raw));
        const c = raw.map((v) => (v / len) * 1.5) as Vec3;
        const de = buildSurfaceDE(pointAttractor(c));
        const t = resolveTiling({ group })!;
        const orbit: number[][] = [];
        enumerateOrbit(info, c, orbit);
        // A generic point has the full orbit — guards against a
        // seed-degenerate c (a wall point would silently shrink the set).
        expect(orbit.length).toBe(info.order);

        for (let i = 0; i < 40; i++) {
          const q: Vec3 = [
            (rng() * 2 - 1) * 3,
            (rng() * 2 - 1) * 3,
            (rng() * 2 - 1) * 3,
          ];
          const bound = distToSet(q, orbit) + 1e-9;
          expect(estimateDistanceTiled(t, de, q)).toBeLessThanOrEqual(bound);
          expect(estimateDistanceRefinedTiled(t, de, q)).toBeLessThanOrEqual(
            bound,
          );
        }

        // At an orbit member the estimate is a HIT (<= 0): the marcher
        // stops there. Clip absent.
        for (const o of orbit) {
          const op: Vec3 = [o[0], o[1], o[2]];
          expect(estimateDistanceTiled(t, de, op)).toBeLessThanOrEqual(0);
          expect(estimateDistanceRefinedTiled(t, de, op)).toBeLessThanOrEqual(
            0,
          );
        }

        // Near an orbit member the value is small (<= 1e-6 at 1e-8 away).
        for (const o of orbit.slice(0, 6)) {
          for (let k = 0; k < 2; k++) {
            const q: Vec3 = [
              o[0] + (rng() * 2 - 1) * 1e-8,
              o[1] + (rng() * 2 - 1) * 1e-8,
              o[2] + (rng() * 2 - 1) * 1e-8,
            ];
            expect(estimateDistanceTiled(t, de, q)).toBeLessThanOrEqual(1e-6);
          }
        }
      });

      it("with a clip, an orbit member's estimate is bounded by max(0, sdf) at the FOLDED point", () => {
        const info = TILING_GROUP_INFO[group];
        const rng = mulberry32(400 + info.order);
        const raw = chamberPoint(info, rng);
        const len = Math.sqrt(norm2(raw));
        const c = raw.map((v) => (v / len) * 1.5) as Vec3;
        const de = buildSurfaceDE(pointAttractor(c));
        const clip = sphereClip([2, 0, 0], 0.5);
        const t = resolveTiling({ group, clip })!;
        const orbit: number[][] = [];
        enumerateOrbit(info, c, orbit);
        for (const o of orbit) {
          const op: Vec3 = [o[0], o[1], o[2]];
          // The clip term is read at the FOLDED point, not at o — the clip
          // is not group-symmetric, so sdf(o) and sdf(F(o)) are unrelated
          // (the wrapper's term is sdf(F(o)); the decomposition identity
          // pins it exactly). The inner is a hit up to the fold's own f64
          // noise (F(o) = c + ~1e-14), so max(0, sdf(F(o))) + 1e-9 bounds it.
          const f = foldInto3(t.info, op)!;
          expect(estimateDistanceTiled(t, de, op)).toBeLessThanOrEqual(
            Math.max(0, shapeSdf(clip, f[0], f[1], f[2])) + 1e-9,
          );
        }
      });
    });
  }
});

describe("the clip term directs the estimate (test 5)", () => {
  for (const group of GROUPS3) {
    it(`group ${group}: inside the attractor but outside the clip, the estimate IS the clip term`, () => {
      const info = TILING_GROUP_INFO[group];
      const rng = mulberry32(500 + info.order);
      const raw = chamberPoint(info, rng);
      const len = Math.sqrt(norm2(raw));
      const c = raw.map((v) => (v / len) * 1.5) as Vec3;
      const de = buildSurfaceDE(pointAttractor(c));
      // A clip that does NOT contain c: at c, sdf = |c - (c+1.5x)| - 0.5
      // = 1.0 > 0, so the clip term dominates the inner (a hit, ~0).
      const clip = sphereClip([c[0] + 1.5, c[1], c[2]], 0.5);
      const t = resolveTiling({ group, clip })!;
      const orbit: number[][] = [];
      enumerateOrbit(info, c, orbit);

      // At the attractor point itself: inner <= 0, so the estimate is
      // exactly the clip's signed value — the marcher must not stop at an
      // attractor point the authored clip excludes.
      expect(estimateDistanceTiled(t, de, c)).toBe(
        shapeSdf(clip, c[0], c[1], c[2]),
      );
      expect(shapeSdf(clip, c[0], c[1], c[2])).toBeGreaterThan(0);

      // Same at every orbit member: the estimate is >= the clip term at
      // the FOLDED point — the wrapper's guarantee (the clip is not
      // group-symmetric, so the term at o itself is unrelated; only the
      // folded-point term enters the composition). At an orbit member the
      // folded clip term is still 1.0 > 0, so the estimate stays positive:
      // the marcher does NOT stop at an attractor member the clip excludes.
      for (const o of orbit) {
        const op: Vec3 = [o[0], o[1], o[2]];
        const f = foldInto3(t.info, op)!;
        expect(estimateDistanceTiled(t, de, op)).toBeGreaterThanOrEqual(
          shapeSdf(clip, f[0], f[1], f[2]),
        );
        expect(estimateDistanceTiled(t, de, op)).toBeGreaterThan(0);
      }
    });
  }
});

describe("the cutoff contract composes with the max (test 6)", () => {
  const CUTOFFS = [0.02, 0.05, 0.1];

  it("estimateDistanceTiled: >= cutoff is exact, < cutoff means the full value is < cutoff", () => {
    const rng = mulberry32(601);
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const clip = sphereClip([2, 0, 0], 0.5);
    for (let i = 0; i < 80; i++) {
      const group = GROUPS3[Math.floor(rng() * GROUPS3.length)];
      for (const withClip of [false, true]) {
        const t = resolveTiling({ group, clip: withClip ? clip : undefined })!;
        // Near-hit points (distance < cutoff — the early-out regime) and
        // far points (exact regime) alike.
        const scale = rng() < 0.5 ? 0.4 : 8;
        const p: Vec3 = [
          (rng() * 2 - 1) * scale,
          (rng() * 2 - 1) * scale,
          (rng() * 2 - 1) * scale,
        ];
        const cutoff = CUTOFFS[Math.floor(rng() * CUTOFFS.length)];
        const short = estimateDistanceTiled(t, de, p, cutoff);
        const full = estimateDistanceTiled(t, de, p);
        if (short >= cutoff) {
          expect(short).toBe(full);
        } else {
          expect(full).toBeLessThan(cutoff);
        }
      }
    }
  });

  it("estimateDistanceRefinedTiled: the same contract, on the fold family too", () => {
    const rng = mulberry32(602);
    for (const de of [
      buildSurfaceDE(sierpinskiTetrahedron()),
      buildSurfaceDE(mandelboxKifs()),
    ]) {
      for (let i = 0; i < 60; i++) {
        const group = GROUPS3[Math.floor(rng() * GROUPS3.length)];
        const t = resolveTiling({ group })!;
        const scale = rng() < 0.5 ? 0.4 : 8;
        const p: Vec3 = [
          (rng() * 2 - 1) * scale,
          (rng() * 2 - 1) * scale,
          (rng() * 2 - 1) * scale,
        ];
        const cutoff = CUTOFFS[Math.floor(rng() * CUTOFFS.length)];
        const short = estimateDistanceRefinedTiled(t, de, p, cutoff);
        const full = estimateDistanceRefinedTiled(t, de, p);
        if (short >= cutoff) {
          expect(short).toBe(full);
        } else {
          expect(full).toBeLessThan(cutoff);
        }
      }
    }
  });
});

describe("4D slab refusal (test 7)", () => {
  const de = buildSurfaceDE4(pentatope());
  const t = resolveTiling({ group: "a4" })!;
  const p: Vec4 = [0.3, 0.2, 0.1, 0.4];

  it("estimateDistance4Tiled throws on any real slab, in every component", () => {
    const segments: Vec4[] = [
      [0.1, 0, 0, 0],
      [0, -0.2, 0, 0],
      [0, 0, 0.05, 0],
      [0, 0, 0, 0.3],
      [0.1, 0.1, 0.1, 0.1],
    ];
    for (const halfExtent of segments) {
      expect(() => estimateDistance4Tiled(t, de, p, halfExtent)).toThrow(
        /segment|slab|polyline/,
      );
    }
  });

  it("estimateDistance4RefinedTiled throws on a real slab", () => {
    expect(() =>
      estimateDistance4RefinedTiled(t, de, p, 0.05, [0.1, 0, 0, 0]),
    ).toThrow(/segment|slab|polyline/);
  });

  it("null and zero are the point query, value for value", () => {
    expect(estimateDistance4Tiled(t, de, p, [0, 0, 0, 0])).toBe(
      estimateDistance4Tiled(t, de, p, null),
    );
    expect(estimateDistance4RefinedTiled(t, de, p, 0, [0, 0, 0, 0])).toBe(
      estimateDistance4RefinedTiled(t, de, p, 0, null),
    );
  });
});

describe("4D clip embedding — extruded through w (test 8)", () => {
  it("the clip term reads the folded point's xyz and drops w", () => {
    const rng = mulberry32(701);
    const de = buildSurfaceDE4(pentatope());
    const clip = sphereClip([0.4, -0.2, 0.3], 0.7);
    for (let i = 0; i < 60; i++) {
      const group = GROUPS4[Math.floor(rng() * GROUPS4.length)];
      const t = resolveTiling({ group, clip })!;
      const p: Vec4 = [
        (rng() * 2 - 1) * 2.5,
        (rng() * 2 - 1) * 2.5,
        (rng() * 2 - 1) * 2.5,
        (rng() * 2 - 1) * 2.5,
      ];
      const q = foldInto4(t.info, p);
      if (q === null) continue;
      const inner = estimateDistance4(de, q, null);
      expect(estimateDistance4Tiled(t, de, p)).toBe(
        Math.max(inner, shapeSdf(clip, q[0], q[1], q[2])),
      );
      expect(estimateDistance4RefinedTiled(t, de, p)).toBe(
        Math.max(
          estimateDistance4Refined(de, q),
          shapeSdf(clip, q[0], q[1], q[2]),
        ),
      );
    }
  });

  it("two in-chamber queries with equal xyz and different w read the same clip term", () => {
    // F4's roots genuinely carry w — the strongest case for the embedding.
    const info = TILING_GROUP_INFO.f4;
    const rng = mulberry32(702);
    const c = chamberPoint(info, rng);
    expect(isInChamber(info, c as Vec4)).toBe(true);
    const cShifted: Vec4 = [c[0], c[1], c[2], c[3] + 0.1];
    expect(isInChamber(info, cShifted)).toBe(true);
    // Both fold to themselves (in-chamber by construction).
    expect(foldInto4(info, c as Vec4)).toEqual(c);
    expect(foldInto4(info, cShifted)).toEqual(cShifted);

    // A clip placed 100 units off the xyz part: its term (~99) dominates
    // any inner distance, so the wrapper's value IS the clip term — and
    // the clip term depends only on xyz, so the two queries agree.
    const clip = sphereClip([c[0] + 100, c[1], c[2]], 1);
    const de = buildSurfaceDE4(pentatope());
    const t = resolveTiling({ group: "f4", clip })!;
    const want = shapeSdf(clip, c[0], c[1], c[2]);
    expect(estimateDistance4Tiled(t, de, c as Vec4)).toBe(want);
    expect(estimateDistance4Tiled(t, de, cShifted)).toBe(want);
    expect(estimateDistance4RefinedTiled(t, de, c as Vec4)).toBe(want);
    expect(estimateDistance4RefinedTiled(t, de, cShifted)).toBe(want);
  });
});

describe("forward family — decomposition identity only (test 9)", () => {
  const rng = mulberry32(801);
  const clip = sphereClip([0.4, -0.2, 0.3], 0.7);

  it("estimateEscapeDistanceTiled on the canonical mandelbox", () => {
    const de = buildEscapeDE([canonicalMandelbox()]);
    for (let i = 0; i < 40; i++) {
      const group = GROUPS3[Math.floor(rng() * GROUPS3.length)];
      for (const withClip of [false, true]) {
        const t = resolveTiling({ group, clip: withClip ? clip : undefined })!;
        const p: Vec3 = [
          (rng() * 2 - 1) * 2.5,
          (rng() * 2 - 1) * 2.5,
          (rng() * 2 - 1) * 2.5,
        ];
        const maxIterations = rng() < 0.5 ? 30 : 12;
        const q = foldInto3(t.info, p);
        if (q === null) continue;
        const inner = estimateEscapeDistance(de, q, maxIterations, null);
        const clipTerm = withClip ? shapeSdf(clip, q[0], q[1], q[2]) : 0;
        expect(estimateEscapeDistanceTiled(t, de, p, maxIterations, null)).toBe(
          Math.max(inner, clipTerm),
        );
      }
    }
  });

  it("estimateBulbDistanceTiled on a shipped mandelbulb preset", () => {
    const de = buildBulbDE(mandelbulbClassic());
    for (let i = 0; i < 40; i++) {
      const group = GROUPS3[Math.floor(rng() * GROUPS3.length)];
      for (const withClip of [false, true]) {
        const t = resolveTiling({ group, clip: withClip ? clip : undefined })!;
        const p: Vec3 = [
          (rng() * 2 - 1) * 2.5,
          (rng() * 2 - 1) * 2.5,
          (rng() * 2 - 1) * 2.5,
        ];
        const maxIterations = rng() < 0.5 ? 16 : 8;
        const q = foldInto3(t.info, p);
        if (q === null) continue;
        const inner = estimateBulbDistance(de, q, maxIterations);
        const clipTerm = withClip ? shapeSdf(clip, q[0], q[1], q[2]) : 0;
        expect(estimateBulbDistanceTiled(t, de, p, maxIterations)).toBe(
          Math.max(inner, clipTerm),
        );
      }
    }
  });

  it("estimateEscapeDistance4Tiled on a w-mixing chain", () => {
    const de = buildEscapeDE4([
      canonicalMandelbox(),
      canonicalMandelbox({ id: 1, w: { rotation: { xw: 0.3 } } }),
    ]);
    for (let i = 0; i < 40; i++) {
      const group = GROUPS4[Math.floor(rng() * GROUPS4.length)];
      for (const withClip of [false, true]) {
        const t = resolveTiling({ group, clip: withClip ? clip : undefined })!;
        const p: Vec4 = [
          (rng() * 2 - 1) * 2.5,
          (rng() * 2 - 1) * 2.5,
          (rng() * 2 - 1) * 2.5,
          (rng() * 2 - 1) * 2.5,
        ];
        const maxIterations = rng() < 0.5 ? 30 : 12;
        const q = foldInto4(t.info, p);
        if (q === null) continue;
        const inner = estimateEscapeDistance4(de, q, maxIterations, null);
        const clipTerm = withClip ? shapeSdf(clip, q[0], q[1], q[2]) : 0;
        expect(
          estimateEscapeDistance4Tiled(t, de, p, maxIterations, null),
        ).toBe(Math.max(inner, clipTerm));
      }
    }
  });
});

describe("mirrored lattice estimator composition", () => {
  const clip = sphereClip([0.25, -0.1, 0.2], 0.8);

  it("applies x/z mirror, certified ball, and clip to inverse 3D plain/refined cores", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const t = resolveTiling(
      { kind: "lattice", cellScale: 1.75, clip },
      de.visibleBoundingRadius,
    );
    const rng = mulberry32(0x1a13);
    for (let i = 0; i < 100; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 30,
        (rng() - 0.5) * 6,
        (rng() - 0.5) * 30,
      ];
      const q = foldLattice3(p, t.h, [0, 0, 0]);
      const ball = Math.hypot(q[0], q[1], q[2]) - t.radius;
      const clipTerm = shapeSdf(clip, q[0], q[1], q[2]);
      expect(estimateDistanceTiled(t, de, p)).toBe(
        Math.max(estimateDistance(de, q), ball, clipTerm),
      );
      expect(estimateDistanceRefinedTiled(t, de, p)).toBe(
        Math.max(estimateDistanceRefined(de, q), ball, clipTerm),
      );
    }
  });

  it("has no seam status or false zero: exact and adjacent walls evaluate ordinary content", () => {
    const fixed: Vec3 = [0.34, 0.06, 0.21];
    const de = buildSurfaceDE(pointAttractor(fixed));
    const t = resolveTiling(
      { kind: "lattice", cellScale: 1.5 },
      de.visibleBoundingRadius,
    );
    for (const axis of [0, 2] as const) {
      for (const wall of [-t.h, t.h]) {
        const at: Vec3 = [0, fixed[1], 0];
        at[axis] = wall;
        at[axis === 0 ? 2 : 0] = fixed[axis === 0 ? 2 : 0];
        const value = estimateDistanceTiled(t, de, at);
        expect(value).toBeGreaterThan(1e-3);
        for (const delta of [-1e-9, 1e-9]) {
          const adjacent: Vec3 = [...at];
          adjacent[axis] += delta;
          expect(estimateDistanceTiled(t, de, adjacent)).toBeCloseTo(value, 7);
        }
      }
    }
  });

  it("applies x/z/w mirror and the full visible 4D ball to both inverse entries", () => {
    const de = buildSurfaceDE4(pentatope());
    const t = resolveTiling(
      { kind: "lattice", cellScale: 2, clip },
      de.visibleBoundingRadius,
    );
    const rng = mulberry32(0x1a14);
    for (let i = 0; i < 80; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 20,
        (rng() - 0.5) * 5,
        (rng() - 0.5) * 20,
        (rng() - 0.5) * 20,
      ];
      const q = foldLattice4(p, t.h, [0, 0, 0, 0]);
      const ball = Math.hypot(q[0], q[1], q[2], q[3]) - t.radius;
      const clipTerm = shapeSdf(clip, q[0], q[1], q[2]);
      expect(estimateDistance4Tiled(t, de, p)).toBe(
        Math.max(estimateDistance4(de, q), ball, clipTerm),
      );
      expect(estimateDistance4RefinedTiled(t, de, p)).toBe(
        Math.max(estimateDistance4Refined(de, q), ball, clipTerm),
      );
    }
  });

  it("keeps inverse/forward families on the same lattice wrapper", () => {
    const inverse = buildSurfaceDE(mandelboxKifs());
    const escape = buildEscapeDE([canonicalMandelbox()]);
    const bulb = buildBulbDE(mandelbulbClassic());
    const escape4 = buildEscapeDE4([
      canonicalMandelbox(),
      canonicalMandelbox({ id: 1, w: { rotation: { xw: 0.3 } } }),
    ]);
    const rows = [
      {
        de: inverse,
        radius: inverse.visibleBoundingRadius,
        core: (q: Vec3) => estimateDistance(inverse, q),
        wrapped: (t: ReturnType<typeof resolveTiling>, p: Vec3) =>
          estimateDistanceTiled(t!, inverse, p),
      },
      {
        de: escape,
        radius: escape.boundingRadius,
        core: (q: Vec3) => estimateEscapeDistance(escape, q),
        wrapped: (t: ReturnType<typeof resolveTiling>, p: Vec3) =>
          estimateEscapeDistanceTiled(t!, escape, p),
      },
      {
        de: bulb,
        radius: bulb.boundingRadius,
        core: (q: Vec3) => estimateBulbDistance(bulb, q),
        wrapped: (t: ReturnType<typeof resolveTiling>, p: Vec3) =>
          estimateBulbDistanceTiled(t!, bulb, p),
      },
    ];
    const p: Vec3 = [-7.3, 0.2, 8.4];
    for (const row of rows) {
      const t = resolveTiling({ kind: "lattice", cellScale: 1.4 }, row.radius);
      const q = foldLattice3(p, t.h, [0, 0, 0]);
      expect(row.wrapped(t, p)).toBe(
        Math.max(row.core(q), Math.hypot(q[0], q[1], q[2]) - t.radius),
      );
    }

    const t4 = resolveTiling(
      { kind: "lattice", cellScale: 1.4 },
      escape4.boundingRadius,
    );
    const p4: Vec4 = [-7.3, 0.2, 8.4, -4.8];
    const q4 = foldLattice4(p4, t4.h, [0, 0, 0, 0]);
    expect(estimateEscapeDistance4Tiled(t4, escape4, p4)).toBe(
      Math.max(
        estimateEscapeDistance4(escape4, q4),
        Math.hypot(q4[0], q4[1], q4[2], q4[3]) - t4.radius,
      ),
    );
  });

  it("folds a genuine inverse-rotated xw slice query before evaluating w", () => {
    const de = buildSurfaceDE4(pentatope());
    const t = resolveTiling(
      { kind: "lattice", cellScale: 1.3 },
      de.visibleBoundingRadius,
    );
    const angle = 0.63;
    const w0 = 0.37;
    const p: Vec3 = [4.2, -0.15, -3.1];
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const attractorQuery: Vec4 = [
      c * p[0] + s * w0,
      p[1],
      p[2],
      -s * p[0] + c * w0,
    ];
    const folded = foldLattice4(attractorQuery, t.h, [0, 0, 0, 0]);
    expect(estimateDistance4Tiled(t, de, attractorQuery)).toBe(
      Math.max(
        estimateDistance4(de, folded),
        Math.hypot(folded[0], folded[1], folded[2], folded[3]) - t.radius,
      ),
    );
    // Omitting w repetition produces a different query for this pose.
    expect(folded[3]).not.toBeCloseTo(attractorQuery[3], 10);
  });

  it("keeps the existing 4D slab refusal for the lattice arm", () => {
    const de = buildSurfaceDE4(pentatope());
    const t = resolveTiling(
      { kind: "lattice", cellScale: 1 },
      de.visibleBoundingRadius,
    );
    expect(() =>
      estimateDistance4Tiled(t, de, [0.1, 0.2, 0.3, 0.4], [0, 0, 0, 0.1]),
    ).toThrow(/segment|slab|polyline/);
  });
});
