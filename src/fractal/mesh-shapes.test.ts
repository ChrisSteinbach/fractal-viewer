import { mulberry32 } from "./rng";
import type { Vec3 } from "./types";
import {
  MESH_ASSET_IDS,
  MESH_SDF_BAKE_VERSION,
  bakeMeshSdf,
  bakePreparedMeshSdf,
  floorMeshValueToF32,
  ingestMeshAsset,
  isMeshAssetId,
  meshAsset,
  meshAssetCatalogIndex,
  meshAssetIdAtCatalogIndex,
  meshContainsPoint,
  meshContainsPointExact,
  meshSdfAtlas,
  meshUnsignedDistance,
  meshUnsignedDistanceExact,
  sampleMeshSdf,
  sampleMeshSurface,
} from "./mesh-shapes";

const ID = "star-prism-v1" as const;

const CATALOG_CASES: readonly {
  id: (typeof MESH_ASSET_IDS)[number];
  vertices: number;
  triangles: number;
  inside: Vec3;
  concavity: Vec3;
}[] = [
  {
    id: "star-prism-v1",
    vertices: 22,
    triangles: 40,
    inside: [0, 0, 0],
    concavity: [
      0.7 * Math.cos((54 * Math.PI) / 180),
      0.7 * Math.sin((54 * Math.PI) / 180),
      0,
    ],
  },
  {
    id: "faceted-crystal-v1",
    vertices: 10,
    triangles: 16,
    inside: [0, 0, 0],
    concavity: [0.55, 0, 0.55],
  },
  {
    id: "heart-prism-v1",
    vertices: 24,
    triangles: 44,
    inside: [0, -0.2, 0],
    concavity: [0, 0.9, 0],
  },
  {
    id: "crescent-moon-v1",
    vertices: 28,
    triangles: 52,
    inside: [-0.72, 0, 0],
    concavity: [0.2, 0, 0],
  },
  {
    id: "snowflake-prism-v1",
    vertices: 144,
    triangles: 284,
    inside: [0, 0, 0],
    concavity: [0.42 * Math.cos(Math.PI / 6), 0.42 * Math.sin(Math.PI / 6), 0],
  },
  {
    id: "trefoil-knot-v1",
    vertices: 720,
    triangles: 1440,
    inside: [0.93, 0, 0],
    concavity: [0, 0, 0],
  },
];

function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  return (
    Math.hypot(
      aby * acz - abz * acy,
      abz * acx - abx * acz,
      abx * acy - aby * acx,
    ) / 2
  );
}

interface IndexedFixture {
  vertices: Vec3[];
  triangles: [number, number, number][];
}

const OUTWARD_TETRA_TRIANGLES: readonly (readonly [number, number, number])[] =
  [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ];

function tetraFixture(offset: Vec3, scale = 1, inward = false): IndexedFixture {
  const vertices: Vec3[] = [
    [offset[0], offset[1], offset[2]],
    [offset[0] + scale, offset[1], offset[2]],
    [offset[0], offset[1] + scale, offset[2]],
    [offset[0], offset[1], offset[2] + scale],
  ];
  const triangles = OUTWARD_TETRA_TRIANGLES.map(
    ([a, b, c]): [number, number, number] => (inward ? [a, c, b] : [a, b, c]),
  );
  return { vertices, triangles };
}

function combineFixtures(...fixtures: IndexedFixture[]): IndexedFixture {
  const vertices: Vec3[] = [];
  const triangles: [number, number, number][] = [];
  for (const fixture of fixtures) {
    const base = vertices.length;
    vertices.push(...fixture.vertices);
    triangles.push(
      ...fixture.triangles.map(([a, b, c]): [number, number, number] => [
        a + base,
        b + base,
        c + base,
      ]),
    );
  }
  return { vertices, triangles };
}

function subtract3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Distance between finite 3D segments (Ericson's clamped closest points). */
function segmentDistance(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): number {
  const u = subtract3(a1, a0);
  const v = subtract3(b1, b0);
  const w = subtract3(a0, b0);
  const uu = dot3(u, u);
  const uv = dot3(u, v);
  const vv = dot3(v, v);
  const uw = dot3(u, w);
  const vw = dot3(v, w);
  const determinant = uu * vv - uv * uv;
  let sNumerator: number;
  let sDenominator = determinant;
  let tNumerator: number;
  let tDenominator = determinant;
  if (determinant < 1e-14) {
    sNumerator = 0;
    sDenominator = 1;
    tNumerator = vw;
    tDenominator = vv;
  } else {
    sNumerator = uv * vw - vv * uw;
    tNumerator = uu * vw - uv * uw;
    if (sNumerator < 0) {
      sNumerator = 0;
      tNumerator = vw;
      tDenominator = vv;
    } else if (sNumerator > sDenominator) {
      sNumerator = sDenominator;
      tNumerator = vw + uv;
      tDenominator = vv;
    }
  }
  if (tNumerator < 0) {
    tNumerator = 0;
    if (-uw < 0) sNumerator = 0;
    else if (-uw > uu) sNumerator = sDenominator;
    else {
      sNumerator = -uw;
      sDenominator = uu;
    }
  } else if (tNumerator > tDenominator) {
    tNumerator = tDenominator;
    if (-uw + uv < 0) sNumerator = 0;
    else if (-uw + uv > uu) sNumerator = sDenominator;
    else {
      sNumerator = -uw + uv;
      sDenominator = uu;
    }
  }
  const s = Math.abs(sNumerator) < 1e-14 ? 0 : sNumerator / sDenominator;
  const t = Math.abs(tNumerator) < 1e-14 ? 0 : tNumerator / tDenominator;
  return Math.hypot(
    w[0] + s * u[0] - t * v[0],
    w[1] + s * u[1] - t * v[1],
    w[2] + s * u[2] - t * v[2],
  );
}

describe("built-in mesh ingestion", () => {
  it("keeps stable append-only ids, indices and prepared identities", () => {
    expect(MESH_ASSET_IDS).toEqual(CATALOG_CASES.map(({ id }) => id));
    for (const [index, { id }] of CATALOG_CASES.entries()) {
      expect(isMeshAssetId(id)).toBe(true);
      expect(meshAsset(id)).toBe(meshAsset(id));
      expect(meshAssetCatalogIndex(id)).toBe(index);
      expect(meshAssetIdAtCatalogIndex(index)).toBe(id);
    }
    expect(isMeshAssetId("star-prism")).toBe(false);
  });

  it("prepares exact area CDFs and expected watertight topology", () => {
    for (const expected of CATALOG_CASES) {
      const asset = meshAsset(expected.id);
      expect(asset.vertices).toHaveLength(expected.vertices);
      expect(asset.triangles).toHaveLength(expected.triangles);
      let running = 0;
      const edges = new Map<string, { count: number; direction: number }>();
      asset.triangles.forEach((tri, i) => {
        running += triangleArea(
          asset.vertices[tri[0]],
          asset.vertices[tri[1]],
          asset.vertices[tri[2]],
        );
        expect(asset.triangleCumulativeAreas[i]).toBeCloseTo(running, 13);
        for (const [from, to] of [
          [tri[0], tri[1]],
          [tri[1], tri[2]],
          [tri[2], tri[0]],
        ] as const) {
          const lo = Math.min(from, to);
          const hi = Math.max(from, to);
          const key = `${lo}:${hi}`;
          const edge = edges.get(key) ?? { count: 0, direction: 0 };
          edge.count++;
          edge.direction += from === lo ? 1 : -1;
          edges.set(key, edge);
        }
      });
      expect(asset.totalArea).toBeCloseTo(running, 13);
      for (const edge of edges.values()) {
        expect(edge).toEqual({ count: 2, direction: 0 });
      }
      expect(asset.bounds.radius).toBeGreaterThan(1);
      expect(asset.bounds.radius).toBeLessThan(1.2);
      expect(meshContainsPoint(asset, expected.inside)).toBe(true);
      expect(meshContainsPoint(asset, expected.concavity)).toBe(false);
    }
  });

  it("rejects open, inconsistently oriented, degenerate and non-finite inputs", () => {
    const asset = meshAsset(ID);
    const vertices = asset.vertices.map((v) => [...v] as Vec3);
    const triangles = asset.triangles.map(
      (t) => [...t] as [number, number, number],
    );
    expect(() => ingestMeshAsset(ID, vertices, triangles.slice(1))).toThrow(
      /watertight/,
    );
    const flipped = triangles.map((t) => [...t] as [number, number, number]);
    [flipped[0][1], flipped[0][2]] = [flipped[0][2], flipped[0][1]];
    expect(() => ingestMeshAsset(ID, vertices, flipped)).toThrow(/orientation/);
    const degenerate = triangles.map((t) => [...t] as [number, number, number]);
    degenerate[0] = [0, 0, 1];
    expect(() => ingestMeshAsset(ID, vertices, degenerate)).toThrow(/repeats/);
    const badVertices = vertices.map((v) => [...v] as Vec3);
    badVertices[0][0] = Number.NaN;
    expect(() => ingestMeshAsset(ID, badVertices, triangles)).toThrow(
      /non-finite/,
    );
  });

  it("rejects duplicate triangles regardless of cyclic order or winding", () => {
    const asset = meshAsset(ID);
    const vertices = asset.vertices.map((vertex) => [...vertex] as Vec3);
    const triangles = asset.triangles.map(
      (triangle) => [...triangle] as [number, number, number],
    );
    const [a, b, c] = triangles[0];
    expect(() =>
      ingestMeshAsset(ID, vertices, [...triangles, [b, c, a]]),
    ).toThrow(/duplicates an existing triangle/);
    expect(() =>
      ingestMeshAsset(ID, vertices, [...triangles, [a, c, b]]),
    ).toThrow(/including reversed winding/);
  });

  it("requires every disconnected component to be outward after translated compensated summation", () => {
    // The large outward tetra dominates the old one-global-volume sum, so the
    // smaller inward component is the part this per-component gate must find.
    const mixed = combineFixtures(
      tetraFixture([0, 0, 0], 3),
      tetraFixture([10, 0, 0], 1, true),
    );
    expect(() => ingestMeshAsset(ID, mixed.vertices, mixed.triangles)).toThrow(
      /component 1.*outward, positive orientation/,
    );

    // Moving a small valid solid far from the origin must not change its
    // orientation through cancellation in the signed-volume sum.
    const translated = tetraFixture([1e8, -1e8, 1e8]);
    expect(() =>
      ingestMeshAsset(ID, translated.vertices, translated.triangles),
    ).not.toThrow();
  });

  it("rejects two otherwise closed face fans joined only at a bow-tie vertex", () => {
    const vertices: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, -1],
    ];
    const triangles: [number, number, number][] = [
      ...OUTWARD_TETRA_TRIANGLES.map(
        (triangle) => [...triangle] as [number, number, number],
      ),
      [0, 4, 5],
      [0, 6, 4],
      [0, 5, 6],
      [4, 6, 5],
    ];
    expect(() => ingestMeshAsset(ID, vertices, triangles)).toThrow(
      /non-manifold bow-tie vertex link at vertex 0/,
    );
  });

  it("rejects crossing and non-topological touching closed components", () => {
    const crossing = combineFixtures(
      tetraFixture([0, 0, 0]),
      tetraFixture([0.35, 0.2, 0.2]),
    );
    expect(() =>
      ingestMeshAsset(ID, crossing.vertices, crossing.triangles),
    ).toThrow(/self-intersect or touch beyond shared topology/);

    const touching = combineFixtures(
      tetraFixture([0, 0, 0]),
      tetraFixture([1, 0, 0]),
    );
    expect(() =>
      ingestMeshAsset(ID, touching.vertices, touching.triangles),
    ).toThrow(/self-intersect or touch beyond shared topology/);
  });

  it("rejects coplanar adjacent triangles that overlap beyond their shared edge", () => {
    const vertices: Vec3[] = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [0, -0.5, 1],
    ];
    const triangles: [number, number, number][] = [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7],
    ];
    expect(() => ingestMeshAsset(ID, vertices, triangles)).toThrow(
      /self-intersect or touch beyond shared topology/,
    );
  });

  it("bounds adversarial broad-phase work instead of scanning every triangle pair", () => {
    // Concentric closed tetrahedra do not intersect, but their nested AABBs
    // make a deliberately hostile broad phase. The deterministic work budget
    // must stop this input rather than completing an O(component²) scan.
    const nested = combineFixtures(
      ...Array.from({ length: 600 }, (_, index) => {
        const scale = 1 + index / 1_000;
        return tetraFixture([-scale / 4, -scale / 4, -scale / 4], scale);
      }),
    );
    expect(() =>
      ingestMeshAsset(ID, nested.vertices, nested.triangles),
    ).toThrow(/self-intersection validation exceeded its .* work-item limit/);
  }, 20_000);

  it("orients the crystal's long diamond axis for the ordinary front view", () => {
    const crystal = meshAsset("faceted-crystal-v1");
    const span = (axis: number): number =>
      crystal.bounds.max[axis] - crystal.bounds.min[axis];
    expect(span(1)).toBeGreaterThan(1.8 * span(0));
    expect(span(1)).toBeGreaterThan(1.8 * span(2));
  });

  it("keeps the thick trefoil below its local and nonlocal clearance", () => {
    const asset = meshAsset("trefoil-knot-v1");
    const pathSegments = 72;
    const tubeSides = 10;
    const centers: Vec3[] = [];
    let tubeRadius = 0;
    for (let i = 0; i < pathSegments; i++) {
      const center: Vec3 = [0, 0, 0];
      for (let j = 0; j < tubeSides; j++) {
        const vertex = asset.vertices[i * tubeSides + j];
        center[0] += vertex[0] / tubeSides;
        center[1] += vertex[1] / tubeSides;
        center[2] += vertex[2] / tubeSides;
      }
      centers.push(center);
      for (let j = 0; j < tubeSides; j++) {
        const offset = subtract3(asset.vertices[i * tubeSides + j], center);
        tubeRadius = Math.max(tubeRadius, Math.hypot(...offset));
      }
    }
    expect(tubeRadius).toBeCloseTo(0.0992, 13);

    // Strips within five path steps are the local tube neighbourhood. For all
    // other strip pairs, centreline separation minus two radii is a direct
    // non-intersection margin for their swept triangle patches.
    let nonlocalClearance = Infinity;
    for (let i = 0; i < pathSegments; i++) {
      for (let j = i + 1; j < pathSegments; j++) {
        const cyclicSeparation = Math.min(j - i, pathSegments - (j - i));
        if (cyclicSeparation <= 5) continue;
        nonlocalClearance = Math.min(
          nonlocalClearance,
          segmentDistance(
            centers[i],
            centers[(i + 1) % pathSegments],
            centers[j],
            centers[(j + 1) % pathSegments],
          ),
        );
      }
    }
    expect(nonlocalClearance).toBeCloseTo(0.4930643158014656, 12);
    expect(nonlocalClearance - 2 * tubeRadius).toBeGreaterThan(0.29);

    // The discrete local radius of curvature supplies the complementary
    // certificate for the excluded neighbouring strips.
    let localCurvatureRadius = Infinity;
    for (let i = 0; i < pathSegments; i++) {
      const a = centers[(i + pathSegments - 1) % pathSegments];
      const b = centers[i];
      const c = centers[(i + 1) % pathSegments];
      const ab = subtract3(b, a);
      const ac = subtract3(c, a);
      const bc = subtract3(c, b);
      const cross: Vec3 = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      localCurvatureRadius = Math.min(
        localCurvatureRadius,
        (Math.hypot(...ab) * Math.hypot(...bc) * Math.hypot(...ac)) /
          (2 * Math.hypot(...cross)),
      );
    }
    expect(localCurvatureRadius).toBeCloseTo(0.4495405794266881, 12);
    expect(localCurvatureRadius / tubeRadius).toBeGreaterThan(4.5);
  });
});

describe("area-weighted mesh surface sampling", () => {
  it("lands on the exact prepared surface for every catalog asset", () => {
    for (const [catalogIndex, { id }] of CATALOG_CASES.entries()) {
      const asset = meshAsset(id);
      const rng = mulberry32(0x5a710000 + catalogIndex);
      for (let i = 0; i < 800; i++) {
        expect(
          meshUnsignedDistance(asset, sampleMeshSurface(asset, rng)),
        ).toBeLessThan(3e-8);
      }
    }
  });

  it("lands on the triangle surface and selects cap area in proportion", () => {
    const asset = meshAsset(ID);
    let capArea = 0;
    for (let i = 0; i < asset.triangles.length; i++) {
      if (i % 4 < 2) {
        const before = i === 0 ? 0 : asset.triangleCumulativeAreas[i - 1];
        capArea += asset.triangleCumulativeAreas[i] - before;
      }
    }
    const wantCaps = capArea / asset.totalArea;
    const rng = mulberry32(0x5a71face);
    const draws = 20000;
    let caps = 0;
    for (let i = 0; i < draws; i++) {
      const p = sampleMeshSurface(asset, rng);
      expect(meshUnsignedDistance(asset, p)).toBeLessThan(2e-8);
      if (Math.abs(Math.abs(p[2]) - 0.28) < 1e-10) caps++;
    }
    expect(caps / draws).toBeGreaterThan(wantCaps - 0.015);
    expect(caps / draws).toBeLessThan(wantCaps + 0.015);
  });
});

describe("deterministic mesh query acceleration", () => {
  it("matches exact nearest and sign scans on the production trefoil mesh", () => {
    const asset = meshAsset("trefoil-knot-v1");
    expect(asset.triangles).toHaveLength(1440);
    const rng = mulberry32(0xb71f0a11);
    for (let i = 0; i < 1800; i++) {
      const p: Vec3 = [
        -1.2 + 2.4 * rng(),
        -1.2 + 2.4 * rng(),
        -0.6 + 1.2 * rng(),
      ];
      expect(meshUnsignedDistance(asset, p)).toBe(
        meshUnsignedDistanceExact(asset, p),
      );
      expect(meshContainsPoint(asset, p)).toBe(
        meshContainsPointExact(asset, p),
      );
    }
  });

  it("keeps the prepared object, version and resolution in the bake cache key", () => {
    const catalogAsset = meshAsset("faceted-crystal-v1");
    const first = ingestMeshAsset(
      catalogAsset.id,
      catalogAsset.vertices,
      catalogAsset.triangles,
    );
    const second = ingestMeshAsset(
      catalogAsset.id,
      catalogAsset.vertices,
      catalogAsset.triangles,
    );
    const firstBake = bakePreparedMeshSdf(first, 8);
    expect(firstBake.version).toBe(MESH_SDF_BAKE_VERSION);
    expect(bakePreparedMeshSdf(first, 8)).toBe(firstBake);
    expect(bakePreparedMeshSdf(first, 9)).not.toBe(firstBake);
    expect(bakePreparedMeshSdf(second, 8)).not.toBe(firstBake);
    expect(Array.from(bakePreparedMeshSdf(second, 8).values)).toEqual(
      Array.from(firstBake.values),
    );
  });
});

describe("conservative mesh SDF bake", () => {
  it("rounds signed values downward to one float32 ulp", () => {
    for (const value of [0, 1 / 3, 1e-20, -1 / 3, -1e-20, -0]) {
      const floored = floorMeshValueToF32(value);
      expect(Math.fround(floored)).toBe(floored);
      expect(floored).toBeLessThanOrEqual(value);
    }
  });

  it("caches a deterministic bake derived from the same prepared asset", () => {
    const bake = bakeMeshSdf(ID, 12);
    expect(bakeMeshSdf(ID, 12)).toBe(bake);
    expect(bake.mesh).toBe(meshAsset(ID));
    expect(bake.values).toHaveLength(12 ** 3);
    expect(bake.version).toBe(MESH_SDF_BAKE_VERSION);
    for (const value of bake.values) expect(Math.fround(value)).toBe(value);
  });

  it("stays below the exact oracle across trefoil lattice seams", () => {
    const asset = meshAsset("trefoil-knot-v1");
    const bake = bakePreparedMeshSdf(asset, 16);
    const rng = mulberry32(0x5ea0b71f);
    for (let i = 0; i < 1200; i++) {
      const seamAxis = i % 3;
      const lattice = 1 + Math.floor(rng() * (bake.resolution - 2));
      const p: Vec3 = [
        bake.min[0] + rng() * (bake.max[0] - bake.min[0]),
        bake.min[1] + rng() * (bake.max[1] - bake.min[1]),
        bake.min[2] + rng() * (bake.max[2] - bake.min[2]),
      ];
      p[seamAxis] =
        bake.min[seamAxis] + lattice * bake.cellSize + (i & 1 ? 1 : -1) * 1e-12;
      const unsigned = meshUnsignedDistanceExact(asset, p);
      const exact = meshContainsPointExact(asset, p) ? -unsigned : unsigned;
      expect(sampleMeshSdf(bake, p[0], p[1], p[2])).toBeLessThanOrEqual(
        exact + 3e-7,
      );
    }
  });

  it("manual trilinear samples never exceed the exact signed distance", () => {
    const bake = bakeMeshSdf(ID, 12);
    const asset = bake.mesh;
    const rng = mulberry32(0xc05e7a71);
    for (let i = 0; i < 2500; i++) {
      const p: Vec3 = [
        bake.min[0] + rng() * (bake.max[0] - bake.min[0]),
        bake.min[1] + rng() * (bake.max[1] - bake.min[1]),
        bake.min[2] + rng() * (bake.max[2] - bake.min[2]),
      ];
      const unsigned = meshUnsignedDistance(asset, p);
      const exact = meshContainsPoint(asset, p) ? -unsigned : unsigned;
      expect(sampleMeshSdf(bake, p[0], p[1], p[2])).toBeLessThanOrEqual(
        exact + 2e-7,
      );
    }
  });

  it("keeps every catalog bake conservative against independent exact scans", () => {
    for (const [catalogIndex, { id }] of CATALOG_CASES.entries()) {
      const bake = bakeMeshSdf(id, 10);
      const rng = mulberry32(0xc05e0000 + catalogIndex);
      for (let i = 0; i < 400; i++) {
        const p: Vec3 = [
          bake.min[0] + rng() * (bake.max[0] - bake.min[0]),
          bake.min[1] + rng() * (bake.max[1] - bake.min[1]),
          bake.min[2] + rng() * (bake.max[2] - bake.min[2]),
        ];
        const unsigned = meshUnsignedDistanceExact(bake.mesh, p);
        const exact = meshContainsPointExact(bake.mesh, p)
          ? -unsigned
          : unsigned;
        expect(sampleMeshSdf(bake, p[0], p[1], p[2])).toBeLessThanOrEqual(
          exact + 3e-7,
        );
      }
    }
  });

  // This is a production-resolution quality gate, not a wall-time gate.
  // Instrumented coverage runs need more room than the separately measured
  // cold-bake benchmark.
  it("retains all twelve snowflake side branches in the 64^3 bake", () => {
    const bake = bakeMeshSdf("snowflake-prism-v1", 64);
    for (let sector = 0; sector < 6; sector++) {
      const angle = (sector * Math.PI) / 3;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      for (const side of [-1, 1]) {
        const localX = 0.62;
        const localY = side * 0.24;
        const p: Vec3 = [
          localX * cosine - localY * sine,
          localX * sine + localY * cosine,
          0,
        ];
        expect(meshContainsPoint(bake.mesh, p)).toBe(true);
        expect(meshUnsignedDistance(bake.mesh, p)).toBeGreaterThan(
          1.7 * bake.cellRadius,
        );
        expect(sampleMeshSdf(bake, p[0], p[1], p[2])).toBeLessThan(0);
      }
    }
  }, 30_000);

  it("uses the containing-box distance as a conservative far-outside floor", () => {
    const bake = bakeMeshSdf(ID, 12);
    const p: Vec3 = [bake.max[0] + 20, bake.min[1] - 12, bake.max[2] + 5];
    const boxDistance = Math.hypot(20, 12, 5);
    const sampled = sampleMeshSdf(bake, p[0], p[1], p[2]);
    expect(sampled).toBeGreaterThanOrEqual(boxDistance);
    expect(sampled).toBeLessThanOrEqual(meshUnsignedDistance(bake.mesh, p));
  });

  it("publishes z-slab atlas metadata without copying a different bake", () => {
    const atlas = meshSdfAtlas([ID, ID], 12);
    expect(atlas.version).toBe(MESH_SDF_BAKE_VERSION);
    expect(atlas.entries).toHaveLength(1);
    expect(atlas.width).toBe(12);
    expect(atlas.height).toBe(12);
    expect(atlas.depth).toBe(12);
    expect(atlas.entries[0]).toMatchObject({
      meshId: ID,
      catalogIndex: 0,
      zOffset: 0,
      resolution: 12,
    });
    expect(Array.from(atlas.values)).toEqual(
      Array.from(bakeMeshSdf(ID, 12).values),
    );
  });

  it("publishes every stable catalog index at its compact slab offset", () => {
    const resolution = 8;
    const atlas = meshSdfAtlas(MESH_ASSET_IDS, resolution);
    expect(atlas.entries).toHaveLength(MESH_ASSET_IDS.length);
    expect(atlas.depth).toBe(MESH_ASSET_IDS.length * resolution);
    expect(atlas.values).toHaveLength(MESH_ASSET_IDS.length * resolution ** 3);
    for (const [catalogIndex, id] of MESH_ASSET_IDS.entries()) {
      expect(atlas.entries[catalogIndex]).toMatchObject({
        meshId: id,
        catalogIndex,
        zOffset: catalogIndex * resolution,
      });
    }
  });

  it("enforces the documented 8..128 integer resolution range", () => {
    expect(bakeMeshSdf(ID, 8).resolution).toBe(8);
    expect(() => bakeMeshSdf(ID, 7)).toThrow(/8\.\.128/);
    expect(() => bakeMeshSdf(ID, 129)).toThrow(/8\.\.128/);
    expect(() => bakeMeshSdf(ID, 12.5)).toThrow(/8\.\.128/);
  });
});
