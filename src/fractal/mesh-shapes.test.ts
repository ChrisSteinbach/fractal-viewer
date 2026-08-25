import { mulberry32 } from "./rng";
import type { Vec3 } from "./types";
import {
  MESH_ASSET_IDS,
  bakeMeshSdf,
  floorMeshValueToF32,
  ingestMeshAsset,
  isMeshAssetId,
  meshAsset,
  meshAssetCatalogIndex,
  meshAssetIdAtCatalogIndex,
  meshContainsPoint,
  meshSdfAtlas,
  meshUnsignedDistance,
  sampleMeshSdf,
  sampleMeshSurface,
} from "./mesh-shapes";

const ID = "star-prism-v1" as const;

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

describe("built-in mesh ingestion", () => {
  it("keeps a stable id and returns the same prepared object", () => {
    expect(MESH_ASSET_IDS).toEqual([ID]);
    expect(isMeshAssetId(ID)).toBe(true);
    expect(isMeshAssetId("star-prism")).toBe(false);
    expect(meshAsset(ID)).toBe(meshAsset(ID));
    expect(meshAssetCatalogIndex(ID)).toBe(0);
    expect(meshAssetIdAtCatalogIndex(0)).toBe(ID);
  });

  it("prepares the exact triangle-area CDF from the catalog vertices", () => {
    const asset = meshAsset(ID);
    let running = 0;
    asset.triangles.forEach((tri, i) => {
      running += triangleArea(
        asset.vertices[tri[0]],
        asset.vertices[tri[1]],
        asset.vertices[tri[2]],
      );
      expect(asset.triangleCumulativeAreas[i]).toBeCloseTo(running, 14);
    });
    expect(asset.totalArea).toBeCloseTo(running, 14);
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

  it("is genuinely non-convex and has a robust inside sign", () => {
    const asset = meshAsset(ID);
    expect(meshContainsPoint(asset, [0, 0, 0])).toBe(true);
    // At 54 degrees the star boundary is its 0.42 inner vertex: this point
    // lies in the convex hull but outside the concave solid.
    const angle = (54 * Math.PI) / 180;
    expect(
      meshContainsPoint(asset, [
        0.7 * Math.cos(angle),
        0.7 * Math.sin(angle),
        0,
      ]),
    ).toBe(false);
    expect(meshContainsPoint(asset, [0, 0, 0.5])).toBe(false);
  });
});

describe("area-weighted mesh surface sampling", () => {
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
    for (const value of bake.values) expect(Math.fround(value)).toBe(value);
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
});
