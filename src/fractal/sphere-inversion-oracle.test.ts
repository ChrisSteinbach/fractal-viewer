import { mulberry32 } from "./rng";
import { resolveSphereInversion } from "./sphere-inversion";
import type {
  SphereInversionAuthored,
  SphereInversionConstruction,
} from "./sphere-inversion";
import {
  enumerateSeedOrbit,
  explicitOrbitContains,
  explicitOrbitDistance,
  invertGeneralizedBall,
  invertPoint,
  nearestPointOnPiece,
  oracleMemberSdf,
  pieceContains,
} from "./sphere-inversion-oracle";
import type { OracleBall, OrbitPiece } from "./sphere-inversion-oracle";

/**
 * The oracle is pinned against the RAW point inversion and against sampling,
 * never against the estimators it exists to check.
 */

function construction(authored: SphereInversionAuthored) {
  const r = resolveSphereInversion(authored);
  if (!r.ok) throw new Error(r.reasons.join("; "));
  return r.construction;
}

function norm(v: readonly number[]): number {
  return Math.hypot(...v);
}

function randomUnit(rng: () => number, dim: number): number[] {
  for (;;) {
    const v = Array.from({ length: dim }, () => 2 * rng() - 1);
    const l = norm(v);
    if (l > 1e-3 && l <= 1) return v.map((x) => x / l);
  }
}

/** A point strictly inside `K ∩ F` (every root member SDF below −margin). */
function seedInteriorPoint(
  rng: () => number,
  c: SphereInversionConstruction,
  margin: number,
): number[] {
  const root = enumerateSeedOrbit(c, 0)[0];
  const reach = Math.max(...c.seed.map((m) => (m.complement ? 0 : m.radius)));
  for (;;) {
    const p = randomUnit(rng, c.dim).map((x) => x * reach * rng());
    if (root.members.every((b) => oracleMemberSdf(b, p) < -margin)) return p;
  }
}

/** A point strictly inside `F` and strictly outside `K`. */
function fundamentalNonSeedPoint(
  rng: () => number,
  c: SphereInversionConstruction,
  margin: number,
): number[] {
  const root = enumerateSeedOrbit(c, 0)[0];
  const seedCount = c.seed.length;
  for (;;) {
    const p = randomUnit(rng, c.dim).map((x) => x * 1.5 * rng());
    const walls = root.members.slice(seedCount);
    const seed = root.members.slice(0, seedCount);
    if (
      walls.every((b) => oracleMemberSdf(b, p) < -margin) &&
      seed.some((b) => oracleMemberSdf(b, p) > margin)
    ) {
      return p;
    }
  }
}

function randomReducedWord(
  rng: () => number,
  generators: number,
  length: number,
): number[] {
  const w: number[] = [];
  while (w.length < length) {
    const j = Math.floor(rng() * generators);
    if (w.length === 0 || w[w.length - 1] !== j) w.push(j);
  }
  return w;
}

/** Apply the word pointwise: innermost letter (last) first. */
function applyWord(
  c: SphereInversionConstruction,
  word: number[],
  x: number[],
): number[] {
  let y = x;
  for (let i = word.length - 1; i >= 0; i--) {
    y = invertPoint(c.generators[word[i]], y);
  }
  return y;
}

describe("invertGeneralizedBall (primitive images)", () => {
  it("maps a ball that misses the centre onto the sphere its sampled boundary points invert to", () => {
    const rng = mulberry32(0x5eed01);
    for (const dim of [3, 4]) {
      const g = {
        center: Array.from({ length: dim }, () => rng()),
        radius: 0.7,
      };
      const b: OracleBall = {
        center: g.center.map((x) => x + 1.4),
        radius: 0.3,
        complement: false,
      };
      const img = invertGeneralizedBall(g, b);
      expect(img.complement).toBe(false);
      for (let k = 0; k < 50; k++) {
        const on = randomUnit(rng, dim).map(
          (x, a) => b.center[a] + b.radius * x,
        );
        expect(oracleMemberSdf(img, invertPoint(g, on))).toBeCloseTo(0, 12);
      }
    }
  });

  it("maps a ball holding the centre to a COMPLEMENT whose set holds the images of its interior", () => {
    const rng = mulberry32(0x5eed02);
    for (const dim of [3, 4]) {
      const g = { center: Array.from({ length: dim }, () => 0), radius: 0.5 };
      const b: OracleBall = {
        center: Array.from({ length: dim }, (_, a) => (a === 0 ? 0.2 : 0)),
        radius: 0.6,
        complement: false,
      };
      const img = invertGeneralizedBall(g, b);
      expect(img.complement).toBe(true);
      for (let k = 0; k < 50; k++) {
        const inside = randomUnit(rng, dim).map(
          (x, a) => b.center[a] + b.radius * 0.9 * rng() * x,
        );
        if (norm(inside) < 1e-3) continue;
        expect(oracleMemberSdf(img, invertPoint(g, inside))).toBeLessThan(1e-9);
      }
    }
  });

  it("maps a generator's own exterior back onto its closed ball", () => {
    const g = { center: [1, 0, 0, 0], radius: 0.4 };
    const img = invertGeneralizedBall(g, {
      center: [1, 0, 0, 0],
      radius: 0.4,
      complement: true,
    });
    expect(img.complement).toBe(false);
    expect(img.radius).toBeCloseTo(0.4, 14);
    expect(img.center).toEqual([1, 0, 0, 0]);
  });

  it("throws on a sphere through the centre", () => {
    expect(() =>
      invertGeneralizedBall(
        { center: [0, 0, 0], radius: 1 },
        { center: [0.5, 0, 0], radius: 0.5, complement: false },
      ),
    ).toThrow(/plane/);
  });
});

describe("enumerateSeedOrbit", () => {
  it("lists exactly the reduced words up to the depth", () => {
    const pieces = enumerateSeedOrbit(construction({ arrangement: "oct6" }), 3);
    expect(pieces).toHaveLength(1 + 6 + 30 + 150);
    for (const { word } of pieces) {
      for (let i = 1; i < word.length; i++)
        expect(word[i]).not.toBe(word[i - 1]);
    }
    expect(new Set(pieces.map((p) => p.word.join())).size).toBe(pieces.length);
  });
});

describe("explicit orbit membership", () => {
  const fixtures: [string, SphereInversionAuthored][] = [
    [
      "cube8 cut shell (3D)",
      { arrangement: "cube8", seed: { kind: "cutShell" }, depth: 3 },
    ],
    [
      "cell24 shell (4D)",
      {
        arrangement: "cell24",
        radiusFraction: 0.98,
        seed: { kind: "shell" },
        depth: 2,
      },
    ],
  ];

  for (const [label, authored] of fixtures) {
    it(`${label}: holds every image of a seed interior point along a reduced word`, () => {
      const c = construction(authored);
      const pieces = enumerateSeedOrbit(c);
      const rng = mulberry32(0x0b17);
      for (let k = 0; k < 40; k++) {
        const x = seedInteriorPoint(rng, c, 1e-3);
        const word = randomReducedWord(
          rng,
          c.generators.length,
          1 + (k % c.depth),
        );
        expect(explicitOrbitContains(pieces, applyWord(c, word, x))).toBe(true);
      }
    });

    it(`${label}: holds no image of a fundamental-domain point outside the seed`, () => {
      const c = construction(authored);
      const pieces = enumerateSeedOrbit(c);
      const rng = mulberry32(0x0b18);
      for (let k = 0; k < 40; k++) {
        const x = fundamentalNonSeedPoint(rng, c, 1e-3);
        const word = randomReducedWord(
          rng,
          c.generators.length,
          k % (c.depth + 1),
        );
        expect(explicitOrbitContains(pieces, applyWord(c, word, x))).toBe(
          false,
        );
      }
    });
  }
});

/** Sample feasible points on each member sphere near `p` — within `reach`
 * of it — and return the smallest distance any of them achieves. */
function sampledFeasibleDistance(
  rng: () => number,
  piece: OrbitPiece,
  p: number[],
  reach: number,
  perMember: number,
): number {
  let best = Infinity;
  for (const b of piece.members) {
    const toP = p.map((x, a) => x - b.center[a]);
    const dc = norm(toP);
    if (Math.abs(dc - b.radius) >= reach || dc === 0) continue;
    const axis = toP.map((x) => x / dc);
    const cmin = Math.max(
      -1,
      (dc * dc + b.radius * b.radius - reach * reach) / (2 * dc * b.radius),
    );
    for (let k = 0; k < perMember; k++) {
      const cos = cmin + (1 - cmin) * rng() ** 3;
      let perp = randomUnit(rng, p.length);
      const t = perp.reduce((s, x, a) => s + x * axis[a], 0);
      perp = perp.map((x, a) => x - t * axis[a]);
      const pl = norm(perp);
      if (pl < 1e-9) continue;
      const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
      const q = axis.map(
        (x, a) => b.center[a] + b.radius * (cos * x + (sin * perp[a]) / pl),
      );
      if (piece.members.every((m) => oracleMemberSdf(m, q) <= 1e-12)) {
        best = Math.min(best, norm(q.map((x, a) => x - p[a])));
      }
    }
  }
  return best;
}

describe("nearestPointOnPiece (the query algorithm)", () => {
  it("equals |p − c| − r for a ball seed lying in the fundamental domain", () => {
    const c = construction({ arrangement: "oct6", seed: { size: 0.28 } });
    const root = enumerateSeedOrbit(c, 0)[0];
    const rng = mulberry32(0x11);
    for (let k = 0; k < 200; k++) {
      const p = randomUnit(rng, 3).map((x) => x * (0.3 + 0.5 * rng()));
      expect(nearestPointOnPiece(root, p).distance).toBeCloseTo(
        norm(p) - 0.28,
        12,
      );
    }
  });

  it("returns 0 inside a piece", () => {
    const c = construction({ arrangement: "cube8", seed: { kind: "shell" } });
    const root = enumerateSeedOrbit(c, 0)[0];
    expect(pieceContains(root, [0, 0, 1])).toBe(true);
    expect(nearestPointOnPiece(root, [0, 0, 1]).distance).toBe(0);
  });

  const fixtures: [string, SphereInversionAuthored, number][] = [
    [
      "cube8 cut shell depth-1 pieces (3D)",
      { arrangement: "cube8", seed: { kind: "cutShell" }, depth: 1 },
      3,
    ],
    [
      "oct6 cap depth-1 pieces (3D)",
      {
        arrangement: "oct6",
        radiusFraction: 0.93,
        seed: { kind: "cap" },
        depth: 1,
      },
      3,
    ],
    [
      "cell24 shell depth-1 pieces (4D)",
      {
        arrangement: "cell24",
        radiusFraction: 0.98,
        seed: { kind: "shell" },
        depth: 1,
      },
      4,
    ],
    [
      "tess16 kissing ball depth-2 pieces (4D)",
      {
        arrangement: "tess16",
        radiusFraction: 1,
        seed: { size: 0.5 },
        depth: 2,
      },
      4,
    ],
  ];

  for (const [label, authored, dim] of fixtures) {
    it(`${label}: attains its distance at a feasible point and no sampled feasible point is nearer`, () => {
      const c = construction(authored);
      const pieces = enumerateSeedOrbit(c);
      const rng = mulberry32(0xd15 + dim);
      let checked = 0;
      for (let k = 0; k < 60; k++) {
        const piece = pieces[1 + Math.floor(rng() * (pieces.length - 1))];
        const p = randomUnit(rng, dim).map((x) => x * 1.4 * rng());
        const r = nearestPointOnPiece(piece, p);
        if (r.distance === 0 || !r.point) continue;
        checked++;
        expect(
          pieceContains(piece, r.point) ||
            piece.members.every(
              (b) => oracleMemberSdf(b, r.point as number[]) <= 1e-9,
            ),
        ).toBe(true);
        expect(norm(r.point.map((x, a) => x - p[a]))).toBeCloseTo(
          r.distance,
          12,
        );
        const sampled = sampledFeasibleDistance(
          rng,
          piece,
          p,
          r.distance * 1.5 + 1e-6,
          200,
        );
        expect(sampled).toBeGreaterThanOrEqual(r.distance * (1 - 1e-9) - 1e-12);
      }
      expect(checked).toBeGreaterThan(20);
    });
  }
});

describe("explicitOrbitDistance", () => {
  it("equals the unpruned minimum over every piece", () => {
    const c = construction({
      arrangement: "ico12",
      radiusFraction: 0.95,
      seed: { kind: "shell" },
      depth: 2,
    });
    const pieces = enumerateSeedOrbit(c);
    const rng = mulberry32(0x77);
    for (let k = 0; k < 8; k++) {
      const p = randomUnit(rng, 3).map((x) => x * 1.3 * rng());
      const brute = Math.min(
        ...pieces.map((piece) => nearestPointOnPiece(piece, p).distance),
      );
      expect(explicitOrbitDistance(pieces, p)).toBe(brute);
    }
  });
});
