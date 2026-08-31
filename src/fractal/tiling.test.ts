import type { ShapeSpec } from "./shapes";
import { mulberry32 } from "./rng";
import {
  FOLD_EPS,
  LATTICE_TILING_CODE,
  MAX_TILING_FOLD_STEPS,
  TILING_GROUP_INFO,
  TILING_GROUPS,
  chamberDistance,
  enumerateOrbit,
  foldLattice3,
  foldLattice4,
  foldToChamber,
  foldToChamberWithSteps,
  isInChamber,
  isCanonicalResolvedLatticeTiling,
  isResolvedLatticeTiling,
  latticeFoldSource,
  mirrorLatticeCoordinate,
  reflectAcrossWall,
  resolveTiling,
  tilingFoldSource,
  tilingGroupCode,
} from "./tiling";
import type {
  FiniteTilingSpec,
  TilingGroup,
  TilingGroupInfo,
  TilingSpec,
} from "./tiling";
import type { Vec3, Vec4 } from "./types";

/** The frozen contract's tables, written out here independently of the
 * module so the tests pin the module against the contract rather than
 * against itself. */

/** Coxeter diagrams as edge lists — [i, j, m] means roots i and j are
 * adjacent in the diagram with m_ij = m. */
const DIAGRAMS: Record<TilingGroup, [number, number, number][]> = {
  a3: [
    [0, 1, 3],
    [1, 2, 3],
  ],
  b3: [
    [0, 1, 3],
    [1, 2, 4],
  ],
  h3: [
    [0, 1, 5],
    [1, 2, 3],
  ],
  a4: [
    [0, 1, 3],
    [1, 2, 3],
    [2, 3, 3],
  ],
  b4: [
    [0, 1, 3],
    [1, 2, 3],
    [2, 3, 4],
  ],
  f4: [
    [0, 1, 3],
    [1, 2, 4],
    [2, 3, 3],
  ],
};

const DIM: Record<TilingGroup, 3 | 4> = {
  a3: 3,
  b3: 3,
  h3: 3,
  a4: 4,
  b4: 4,
  f4: 4,
};

const ORDER: Record<TilingGroup, number> = {
  a3: 24,
  b3: 48,
  h3: 120,
  a4: 120,
  b4: 384,
  f4: 1152,
};

const MAX_WORD: Record<TilingGroup, number> = {
  a3: 6,
  b3: 9,
  h3: 15,
  a4: 10,
  b4: 16,
  f4: 24,
};

/** Fixed per-group seeds, so every run exercises the same points. */
const SEEDS: Record<TilingGroup, number> = {
  a3: 0xa3a3,
  b3: 0xb3b3,
  h3: 0xc3c3,
  a4: 0xd3d3,
  b4: 0xe3e3,
  f4: 0xf3f3,
};

function root(info: TilingGroupInfo, i: number): number[] {
  return info.roots.slice(i * info.dim, (i + 1) * info.dim);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let j = 0; j < a.length; j++) s += a[j] * b[j];
  return s;
}

function norm2(a: number[]): number {
  let s = 0;
  for (const v of a) s += v * v;
  return s;
}

function dist(a: number[], b: number[]): number {
  let s = 0;
  for (let j = 0; j < a.length; j++) {
    const d = a[j] - b[j];
    s += d * d;
  }
  return Math.sqrt(s);
}

/** The target pairing `⟨n_i, n_j⟩` per the test's own diagram copy:
 * `−cos(π/m_ij)` for adjacent roots, 0 otherwise, 1 on the diagonal. */
function cartanPair(group: TilingGroup, i: number, j: number): number {
  if (i === j) return 1;
  for (const [a, b, m] of DIAGRAMS[group]) {
    if ((a === i && b === j) || (a === j && b === i)) {
      return -Math.cos(Math.PI / m);
    }
  }
  return 0;
}

function randomPoint(dim: number, rng: () => number, scale: number): number[] {
  const p: number[] = [];
  for (let j = 0; j < dim; j++) p.push((rng() * 2 - 1) * scale);
  return p;
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

/** The generalized cross product of three 4-vectors: `w_a = (−1)^(1+a)`
 * times the 3x3 minor omitting column `a`, so `⟨w, v⟩ = det(v, a, b, c)`
 * — in particular `w` is orthogonal to each input. */
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
 * perpendicular to every wall but `k` (the cross of the other roots,
 * oriented toward the chamber, normalized). The chamber is a simplicial
 * cone over these, so ANY non-negative combination of them — with vertex
 * `k`'s weight positive — lies in the closed chamber, pairing with wall
 * `k` exactly `w_k·⟨V_k, n_k⟩ ≥ 0`. */
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

/** A content point `s ∈ C` for the nearest-copy tests, with the desired
 * face rank: `rank = dim` is the interior, `rank` zeroed weights (from the
 * end) drop `s` onto the face spanned by the first `rank` vertices — wall
 * (rank dim−1), edge (rank 2), vertex (rank 1) — and `nearVertex` parks
 * the point just off the vertex-0 ray. All are exactly in the closed
 * chamber by construction. */
function contentPoint(
  info: TilingGroupInfo,
  rng: () => number,
  opts: { rank?: number; nearVertex?: boolean } = {},
): number[] {
  const vertices = chamberVertices(info);
  const dim = info.dim;
  const rank = opts.rank ?? dim;
  const weights = vertices.map(() => 0.2 + rng());
  for (let i = rank; i < dim; i++) weights[i] = 0;
  if (opts.nearVertex) {
    weights[0] = 10;
    for (let i = 1; i < dim; i++) weights[i] = 0.05;
  }
  const sum = new Array<number>(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) sum[j] += vertices[i][j] * weights[i];
  }
  return sum;
}

/** The adversarial point set each fold test runs: uniform random points at
 * several scales, content points pushed just across a wall (the boundary
 * regime the greedy fold is built for), content points themselves (on the
 * wall/edge/vertex/2-face), and the antipodal chamber. */
function adversarialPoints(
  info: TilingGroupInfo,
  rng: () => number,
): number[][] {
  const dim = info.dim;
  const pts: number[][] = [];
  const r = (scale: number): number[] => randomPoint(dim, rng, scale);
  for (let i = 0; i < 40; i++) pts.push(r(3));
  pts.push(r(0.0001));
  pts.push(r(1000));
  const n0 = root(info, 0);
  const n1 = root(info, 1);
  const pushOff = (p: number[], delta: number): void => {
    pts.push(p);
    pts.push(p.map((v, j) => v - delta * n0[j]));
    pts.push(p.map((v, j) => v - delta * n1[j]));
  };
  pushOff(contentPoint(info, rng), 1e-4);
  pushOff(contentPoint(info, rng, { rank: dim - 1 }), 1e-4);
  pushOff(contentPoint(info, rng, { rank: 2 }), 1e-4);
  pushOff(contentPoint(info, rng, { rank: 1 }), 1e-4);
  pushOff(contentPoint(info, rng, { nearVertex: true }), 1e-4);
  if (dim === 4) pushOff(contentPoint(info, rng, { rank: 3 }), 1e-4);
  const interior = contentPoint(info, rng);
  pts.push(interior.map((v) => -v));
  return pts;
}

/** Typed wrappers so the test body works in plain `number[]` while the
 * module's `Vec3 | Vec4` signatures stay honest. The fold result is
 * spread out of the module's `out`-alias, so the returned array is
 * independent of the scratch. */
function foldInto(
  info: TilingGroupInfo,
  p: number[],
  scratch: number[],
): number[] | null {
  const r = foldToChamberWithSteps(
    info,
    p as Vec3 | Vec4,
    scratch as Vec3 | Vec4,
  );
  return r === null ? null : [...r.point];
}

function foldSteps(
  info: TilingGroupInfo,
  p: number[],
  scratch: number[],
): { point: number[]; steps: number } | null {
  const r = foldToChamberWithSteps(
    info,
    p as Vec3 | Vec4,
    scratch as Vec3 | Vec4,
  );
  return r === null ? null : { point: [...r.point], steps: r.steps };
}

function isIn(info: TilingGroupInfo, p: number[]): boolean {
  return isInChamber(info, p as Vec3 | Vec4);
}

function foldSimple(
  info: TilingGroupInfo,
  p: number[],
  scratch: number[],
): number[] | null {
  const r = foldToChamber(info, p as Vec3 | Vec4, scratch as Vec3 | Vec4);
  return r === null ? null : [...r];
}

describe("frozen contract constants", () => {
  it("pins TILING_GROUPS, FOLD_EPS and MAX_TILING_FOLD_STEPS", () => {
    expect(TILING_GROUPS).toEqual(["a3", "b3", "h3", "a4", "b4", "f4"]);
    expect(FOLD_EPS).toBe(1e-6);
    expect(MAX_TILING_FOLD_STEPS).toBe(32);
  });
});

describe("group tables", () => {
  for (const group of TILING_GROUPS) {
    const info = TILING_GROUP_INFO[group];
    it(`has the frozen dim, order and max word length: ${group}`, () => {
      expect(info.id).toBe(group);
      expect(info.dim).toBe(DIM[group]);
      expect(info.order).toBe(ORDER[group]);
      expect(info.maxWordLength).toBe(MAX_WORD[group]);
    });

    it(`has unit roots: ${group}`, () => {
      for (let i = 0; i < info.dim; i++) {
        expect(Math.abs(norm2(root(info, i)) - 1)).toBeLessThan(1e-12);
      }
    });

    it(`roots satisfy the Cartan pairings of the diagram: ${group}`, () => {
      for (let i = 0; i < info.dim; i++) {
        for (let j = 0; j < info.dim; j++) {
          const expected = cartanPair(group, i, j);
          expect(
            Math.abs(dot(root(info, i), root(info, j)) - expected),
          ).toBeLessThan(1e-12);
        }
      }
    });
  }

  it("the 4D groups' roots genuinely span all four axes — F4 especially uses w", () => {
    for (const group of ["a4", "b4", "f4"] as const) {
      const info = TILING_GROUP_INFO[group];
      for (const axis of [0, 1, 2, 3]) {
        const appears = info.roots.some(
          (v, idx) => idx % 4 === axis && Math.abs(v) > 1e-12,
        );
        expect(appears).toBe(true);
      }
      const det = dot(
        cross4(root(info, 0), root(info, 1), root(info, 2)),
        root(info, 3),
      );
      expect(Math.abs(det)).toBeGreaterThan(1e-9);
    }
  });

  it("is deep-frozen", () => {
    expect(Object.isFrozen(TILING_GROUP_INFO)).toBe(true);
    expect(Object.isFrozen(TILING_GROUP_INFO.a3)).toBe(true);
    expect(Object.isFrozen(TILING_GROUP_INFO.f4.roots)).toBe(true);
  });
});

describe("reflectAcrossWall", () => {
  const normals: number[][] = [
    [1, 0, 0],
    [Math.SQRT1_2, Math.SQRT1_2, 0],
    [0, 0.6, 0.8],
    [0.5, 0.5, 0.5, 0.5],
    [1, 0, 0, 0],
    [0.3, 0.4, 0.5, Math.sqrt(0.5)],
  ];
  const points: number[][] = [
    [1, 2, 3],
    [-0.5, 1.5, -2],
    [1, -1, 1, -1],
    [0.1, 0.2, 0.3, 0.4],
  ];

  it("is an isometry — |reflect(p)| == |p|", () => {
    for (const n of normals) {
      for (const p of points.filter((q) => q.length === n.length)) {
        const out = new Array<number>(n.length).fill(0);
        reflectAcrossWall(
          p as Vec3 | Vec4,
          n as Vec3 | Vec4,
          out as Vec3 | Vec4,
        );
        expect(Math.abs(norm2(out) - norm2(p))).toBeLessThan(1e-12);
      }
    }
  });

  it("is an involution — reflecting twice returns the original", () => {
    for (const n of normals) {
      for (const p of points.filter((q) => q.length === n.length)) {
        const a = new Array<number>(n.length).fill(0);
        const b = new Array<number>(n.length).fill(0);
        reflectAcrossWall(p as Vec3 | Vec4, n as Vec3 | Vec4, a as Vec3 | Vec4);
        reflectAcrossWall(a as Vec3 | Vec4, n as Vec3 | Vec4, b as Vec3 | Vec4);
        for (let j = 0; j < n.length; j++) {
          expect(Math.abs(b[j] - p[j])).toBeLessThan(1e-12);
        }
      }
    }
  });

  it("fixes its wall — a point with pairing 0 is unchanged", () => {
    for (const n of normals) {
      const onWall = [n[1], -n[0], 0, 0].slice(0, n.length);
      const out = new Array<number>(n.length).fill(0);
      reflectAcrossWall(
        onWall as Vec3 | Vec4,
        n as Vec3 | Vec4,
        out as Vec3 | Vec4,
      );
      for (let j = 0; j < n.length; j++) {
        expect(Math.abs(out[j] - onWall[j])).toBeLessThan(1e-12);
      }
    }
  });
});

describe("foldToChamber", () => {
  for (const group of TILING_GROUPS) {
    const info = TILING_GROUP_INFO[group];
    const seed = SEEDS[group];

    it(`lands every sampled point in-chamber without expiring: ${group}`, () => {
      const rng = mulberry32(seed);
      const scratch = new Array<number>(info.dim).fill(0);
      for (const p of adversarialPoints(info, rng)) {
        const folded = foldInto(info, p, scratch);
        expect(folded).not.toBeNull();
        expect(isIn(info, folded!)).toBe(true);
      }
    });

    it(`is idempotent and norm-preserving: ${group}`, () => {
      const rng = mulberry32(seed + 1);
      const a = new Array<number>(info.dim).fill(0);
      const b = new Array<number>(info.dim).fill(0);
      for (const p of adversarialPoints(info, rng)) {
        const once = foldInto(info, p, a);
        expect(once).not.toBeNull();
        const twice = foldInto(info, once!, b);
        expect(twice).not.toBeNull();
        for (let j = 0; j < info.dim; j++) {
          expect(Math.abs(twice![j] - once![j])).toBeLessThan(1e-12);
        }
        const n2p = norm2(p);
        expect(Math.abs(norm2(once!) - n2p)).toBeLessThanOrEqual(
          1e-12 * Math.max(1, n2p),
        );
      }
    });

    it(`fold steps never exceed maxWordLength (${info.maxWordLength}): ${group}`, () => {
      const rng = mulberry32(seed + 2);
      const scratch = new Array<number>(info.dim).fill(0);
      let max = 0;
      for (const p of adversarialPoints(info, rng)) {
        const r = foldSteps(info, p, scratch);
        expect(r).not.toBeNull();
        expect(isIn(info, r!.point)).toBe(true);
        max = Math.max(max, r!.steps);
      }
      expect(max).toBeLessThanOrEqual(info.maxWordLength);
    });
  }

  it("foldToChamber is a thin wrapper over foldToChamberWithSteps", () => {
    const info = TILING_GROUP_INFO.h3;
    const rng = mulberry32(0xfeed);
    for (let t = 0; t < 20; t++) {
      const p = randomPoint(3, rng, 3);
      const a = [0, 0, 0];
      const b = [0, 0, 0];
      const direct = foldSimple(info, p, a);
      const stepped = foldSteps(info, p, b);
      expect(stepped).not.toBeNull();
      expect(direct).toEqual(stepped!.point);
    }
  });

  it("chamberDistance is max(0, min pairing) — the distance to the chamber's complement", () => {
    const info = TILING_GROUP_INFO.a3;
    const rng = mulberry32(0x1234);
    const interior = contentPoint(info, rng);
    let minPair = Infinity;
    for (let i = 0; i < info.dim; i++) {
      minPair = Math.min(minPair, dot(interior, root(info, i)));
    }
    // A point strictly inside the chamber is that far from every wall.
    expect(minPair).toBeGreaterThan(0);
    expect(chamberDistance(info, interior as Vec3 | Vec4)).toBeCloseTo(
      minPair,
      12,
    );
    // On the boundary (a wall) and outside, the distance to the complement
    // is exactly 0.
    const wall = contentPoint(info, rng, { rank: info.dim - 1 });
    expect(chamberDistance(info, wall as Vec3 | Vec4)).toBe(0);
    const outside = interior.map((v, j) => v - 2 * root(info, 0)[j]);
    expect(chamberDistance(info, outside as Vec3 | Vec4)).toBe(0);
  });
});

describe("shader source authority", () => {
  it("keeps zero off, finite group codes frozen at 1..6, and the lattice code at 7", () => {
    expect(TILING_GROUPS.map(tilingGroupCode)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(LATTICE_TILING_CODE).toBe(7);
  });

  it("emits the 3D GLSL fold from A3's frozen roots and shared bounds", () => {
    const source = tilingFoldSource(TILING_GROUP_INFO.a3, "glsl");
    expect(source).toContain("struct TilingFoldResult");
    expect(source).toContain("TilingFoldResult tilingFold(vec3 pIn)");
    expect(source).toContain(`step < ${MAX_TILING_FOLD_STEPS}`);
    expect(source).toContain(`float worstDot = -${FOLD_EPS}`);
    expect(source).toContain("dot(q, vec3(1.0, 0.0, 0.0))");
    expect(source).toContain("q -= 2.0 * worstDot * vec3(");
    expect(source).toContain("return TilingFoldResult(q, minDot >=");
    expect(source).not.toContain("vec4");
  });

  it("emits the 4D WGSL fold from F4's w-dependent frozen roots", () => {
    const source = tilingFoldSource(TILING_GROUP_INFO.f4, "wgsl");
    expect(source).toContain("point: vec4f");
    expect(source).toContain("fn tilingFold(pIn: vec4f) -> TilingFoldResult");
    expect(source).toContain(`step < ${MAX_TILING_FOLD_STEPS}`);
    expect(source).toContain(`var worstDot: f32 = -${FOLD_EPS}`);
    const w = TILING_GROUP_INFO.f4.roots[15];
    expect(w).not.toBe(0);
    expect(source).toContain(String(w));
    expect(source).toContain("q -= 2.0 * worstDot * vec4f(");
    expect(source).not.toContain("vec3f");
  });

  it("keeps the fold arithmetic text aligned across shader dialects", () => {
    const canon = (source: string): string =>
      source
        .replace(/struct TilingFoldResult \{[\s\S]*?\};?\n/, "")
        .replace(/^TilingFoldResult tilingFold\(vec3 pIn\) \{/m, "fn {")
        .replace(/^fn tilingFold\(pIn: vec3f\) -> TilingFoldResult \{/m, "fn {")
        .replace(
          /\b(?:vec3|float|int) (q|pairing\d+|minDot|worst|worstDot|step)\b/g,
          "$1",
        )
        .replace(/\b(?:let|var) (pairing\d+|minDot|q)\b(?:: f32)?/g, "$1")
        .replace(/var (worst|step): i32/g, "$1")
        .replace(/var step/g, "step")
        .replace(/var worstDot: f32/g, "worstDot")
        .replace(/vec3f/g, "V")
        .replace(/vec3/g, "V")
        .replace(/;\s*\}/g, "; }")
        .replace(/\s+/g, " ")
        .trim();
    expect(canon(tilingFoldSource(TILING_GROUP_INFO.a3, "glsl"))).toBe(
      canon(tilingFoldSource(TILING_GROUP_INFO.a3, "wgsl")),
    );
  });

  it("rejects an invalid emitted function name", () => {
    expect(() =>
      tilingFoldSource(TILING_GROUP_INFO.a3, "glsl", "fold-now"),
    ).toThrow(/invalid shader function name/);
  });

  it.each([
    ["glsl", 3, "vec3", ["x", "z"]],
    ["glsl", 4, "vec4", ["x", "z", "w"]],
    ["wgsl", 3, "vec3f", ["x", "z"]],
    ["wgsl", 4, "vec4f", ["x", "z", "w"]],
  ] as const)(
    "emits the exact floor-mod lattice fold for %s %dD",
    (dialect, dimension, vector, mirroredAxes) => {
      const source = latticeFoldSource(dialect, dimension);
      expect(source).toContain("m = x + h - period * floor((x + h) / period);");
      expect(source).toContain("return h - abs(m - 2.0 * h);");
      expect(source).toContain(
        dialect === "glsl"
          ? `${vector} latticeFold(${vector} pIn, float h)`
          : `fn latticeFold(pIn: ${vector}, h: f32) -> ${vector}`,
      );
      for (const axis of mirroredAxes) {
        expect(source).toContain(
          `q.${axis} = latticeFoldCoordinate(q.${axis}, h);`,
        );
      }
      expect(source).not.toContain("q.y = latticeFoldCoordinate(q.y, h);");
      if (dimension === 3) {
        expect(source).not.toContain("q.w = latticeFoldCoordinate(q.w, h);");
      }
      expect(source).not.toMatch(/%|\bmod\s*\(/);
    },
  );

  it("keeps the lattice arithmetic text aligned across shader dialects", () => {
    const arithmetic = (source: string): string[] =>
      source
        .split("\n")
        .filter(
          (line) =>
            line.includes("period =") ||
            line.includes("m =") ||
            line.includes("return h - abs"),
        )
        .map((line) => line.replace(/^\s*(?:float|let)\s+/, "").trim());
    expect(arithmetic(latticeFoldSource("glsl", 4))).toEqual(
      arithmetic(latticeFoldSource("wgsl", 4)),
    );
  });

  it("validates and applies a custom lattice function name", () => {
    const source = latticeFoldSource("wgsl", 3, "foldLatticeNow");
    expect(source).toContain(
      "fn foldLatticeNowCoordinate(x: f32, h: f32) -> f32",
    );
    expect(source).toContain("fn foldLatticeNow(pIn: vec3f, h: f32) -> vec3f");
    expect(() => latticeFoldSource("glsl", 3, "fold-now")).toThrow(
      /invalid shader function name/,
    );
  });
});

describe("nearest-copy theorem", () => {
  for (const group of TILING_GROUPS) {
    it(`d(q, orbit(s)) == d(F(q), s) for every sampled content s: ${group}`, () => {
      const info = TILING_GROUP_INFO[group];
      const rng = mulberry32(SEEDS[group]);
      const scratch = new Array<number>(info.dim).fill(0);
      const orbit: number[][] = [];
      const contents: number[][] = [
        contentPoint(info, rng),
        contentPoint(info, rng, { rank: info.dim - 1 }),
        contentPoint(info, rng, { rank: 2 }),
        contentPoint(info, rng, { rank: 1 }),
        contentPoint(info, rng, { nearVertex: true }),
      ];
      for (const s of contents) {
        expect(isIn(info, s)).toBe(true);
        enumerateOrbit(info, s as Vec3 | Vec4, orbit);
        expect(orbit.length).toBeGreaterThan(0);
        for (let t = 0; t < 15; t++) {
          const q = randomPoint(info.dim, rng, 3);
          const folded = foldInto(info, q, scratch);
          expect(folded).not.toBeNull();
          let dOrbit = Infinity;
          for (const image of orbit) {
            dOrbit = Math.min(dOrbit, dist(q, image));
          }
          expect(Math.abs(dOrbit - dist(folded!, s))).toBeLessThan(1e-9);
        }
      }
    });
  }
});

describe("enumerateOrbit", () => {
  for (const group of TILING_GROUPS) {
    it(`enumerates info.order distinct images for a generic point: ${group}`, () => {
      const info = TILING_GROUP_INFO[group];
      const rng = mulberry32(SEEDS[group]);
      const orbit: number[][] = [];
      const p = randomPoint(info.dim, rng, 1);
      const count = enumerateOrbit(info, p as Vec3 | Vec4, orbit);
      expect(count).toBe(info.order);
      expect(orbit.length).toBe(info.order);
      for (const image of orbit) {
        expect(Math.abs(norm2(image) - norm2(p))).toBeLessThan(1e-9);
      }
      // A point in the OPEN chamber is provably generic (a nontrivial
      // element fixes only a proper subspace): the orbit is the full
      // group, no seed luck involved.
      const c = contentPoint(info, rng);
      expect(enumerateOrbit(info, c as Vec3 | Vec4, orbit)).toBe(info.order);
    });

    it(`a point on a chamber wall has a stabilizer, and the nearest-copy identity still holds: ${group}`, () => {
      const info = TILING_GROUP_INFO[group];
      const rng = mulberry32(SEEDS[group] + 7);
      const scratch = new Array<number>(info.dim).fill(0);
      const orbit: number[][] = [];
      const s = contentPoint(info, rng, { rank: info.dim - 1 });
      const count = enumerateOrbit(info, s as Vec3 | Vec4, orbit);
      expect(count).toBeLessThan(info.order);
      expect(count).toBeGreaterThanOrEqual(2);
      for (let t = 0; t < 10; t++) {
        const q = randomPoint(info.dim, rng, 3);
        const folded = foldInto(info, q, scratch);
        expect(folded).not.toBeNull();
        let dOrbit = Infinity;
        for (const image of orbit) dOrbit = Math.min(dOrbit, dist(q, image));
        expect(Math.abs(dOrbit - dist(folded!, s))).toBeLessThan(1e-9);
      }
    });
  }
});

describe("resolveTiling", () => {
  it("returns null when the scene carries no tiling block", () => {
    expect(resolveTiling(undefined)).toBeNull();
  });

  it("passes a valid group and clip through as authored", () => {
    const clip: ShapeSpec = {
      parts: [{ primitive: { kind: "sphere", radius: 0.5 }, combine: "union" }],
    };
    const r = resolveTiling({ group: "f4", clip });
    expect(r).not.toBeNull();
    expect(r!.group).toBe("f4");
    expect(r!.info).toBe(TILING_GROUP_INFO.f4);
    expect(r!.clip).toBe(clip);
  });

  it("resolves a clip-less group to the frozen table entry", () => {
    const r = resolveTiling({ group: "h3" });
    expect(r).not.toBeNull();
    expect(r!.group).toBe("h3");
    expect(r!.info).toBe(TILING_GROUP_INFO.h3);
    expect(r!.clip).toBeUndefined();
  });

  it("throws on an unknown group", () => {
    expect(() =>
      resolveTiling({ group: "x4" } as unknown as FiniteTilingSpec),
    ).toThrow(/unknown tiling group/);
  });

  it("resolves an explicitly-authored lattice from the certified radius, without a default or upper clamp", () => {
    const clip: ShapeSpec = {
      parts: [{ primitive: { kind: "sphere", radius: 0.5 }, combine: "union" }],
    };
    const r = resolveTiling({ kind: "lattice", cellScale: 7.25, clip }, 2.4);
    expect(isResolvedLatticeTiling(r)).toBe(true);
    expect(r).toEqual({
      kind: "lattice",
      cellScale: 7.25,
      radius: 2.4,
      h: 17.4,
      presentation: {
        contentRadius: 2.4,
        fadeStartRadius: 19.2,
        outerRadius: 24,
      },
      clip,
    });
  });

  it("requires the accepted lattice domain and a certified positive radius", () => {
    // @ts-expect-error A lattice cannot resolve without its certified radius.
    expect(() => resolveTiling({ kind: "lattice", cellScale: 1 })).toThrow(
      /radius/,
    );
    for (const cellScale of [0.999, 0, -1, Infinity, -Infinity, NaN]) {
      expect(() =>
        resolveTiling({ kind: "lattice", cellScale } as TilingSpec, 2),
      ).toThrow(/cellScale/);
    }
    for (const radius of [undefined, 0, -1, Infinity, NaN]) {
      expect(() =>
        resolveTiling({ kind: "lattice", cellScale: 1 }, radius as number),
      ).toThrow(/radius/);
    }
    expect(() =>
      resolveTiling(
        { kind: "lattice", cellScale: Number.MAX_VALUE },
        Number.MAX_VALUE,
      ),
    ).toThrow(/overflow/);
    expect(() =>
      resolveTiling({ kind: "lattice", cellScale: Number.MAX_VALUE }, 1),
    ).toThrow(/f32 4h period/);
    expect(() =>
      resolveTiling({ kind: "lattice", cellScale: 1 }, Number.MIN_VALUE),
    ).toThrow(/underflowed.*f32 4h period/);
    const maxHalfCell = 3.4028234663852886e38 / 4;
    const edge = resolveTiling({ kind: "lattice", cellScale: maxHalfCell }, 1);
    expect(isCanonicalResolvedLatticeTiling(edge)).toBe(true);
    expect(Number.isFinite(mirrorLatticeCoordinate(0, edge.h))).toBe(true);
    expect(() =>
      resolveTiling(
        { kind: "lattice", cellScale: maxHalfCell * (1 + 1e-6) },
        1,
      ),
    ).toThrow(/f32 4h period/);
    expect(
      isCanonicalResolvedLatticeTiling({ ...edge, h: Number.MIN_VALUE }),
    ).toBe(false);
  });
});

describe("mirrored affine-A1 lattice fold", () => {
  const h = 1.7;

  it("is continuous and non-zero-generating at exact and adjacent seams", () => {
    for (const wall of [-7 * h, -5 * h, -3 * h, -h, h, 3 * h, 5 * h, 7 * h]) {
      const at = mirrorLatticeCoordinate(wall, h);
      expect(mirrorLatticeCoordinate(wall - 1e-10, h)).toBeCloseTo(at, 8);
      expect(mirrorLatticeCoordinate(wall + 1e-10, h)).toBeCloseTo(at, 8);
      expect(Math.abs(at)).toBeCloseTo(h, 12);
    }
  });

  it("uses floor-mod semantics for negative cells and preserves phase at large supported coordinates", () => {
    const probes = [-6.73, -3.41, -0.37, 0.37, 2.91, 8.13];
    for (const x of probes) {
      const folded = mirrorLatticeCoordinate(x, h);
      expect(folded).toBeGreaterThanOrEqual(-h);
      expect(folded).toBeLessThanOrEqual(h);
      for (const cell of [-2048, -127, 127, 2048]) {
        expect(mirrorLatticeCoordinate(x + 4 * h * cell, h)).toBeCloseTo(
          folded,
          9,
        );
      }
    }

    // A binary-exact h makes this a large-coordinate arithmetic test rather
    // than a decimal multiplication-rounding test.
    const exactH = 2;
    const phase = 0.375;
    for (const cell of [-(2 ** 30), 2 ** 30]) {
      const x = phase + 4 * exactH * cell;
      expect(mirrorLatticeCoordinate(x, exactH)).toBe(phase);
    }
  });

  it("folds x/z in 3D and x/z/w in 4D while leaving y exact", () => {
    const p3: Vec3 = [-6.2, -0.375, 8.1];
    const p4: Vec4 = [-6.2, -0.375, 8.1, -4.7];
    expect(foldLattice3(p3, h, [0, 0, 0])).toEqual([
      mirrorLatticeCoordinate(p3[0], h),
      p3[1],
      mirrorLatticeCoordinate(p3[2], h),
    ]);
    expect(foldLattice4(p4, h, [0, 0, 0, 0])).toEqual([
      mirrorLatticeCoordinate(p4[0], h),
      p4[1],
      mirrorLatticeCoordinate(p4[2], h),
      mirrorLatticeCoordinate(p4[3], h),
    ]);
  });
});
