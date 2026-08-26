import {
  CRESCENT_MOON_SHAPE,
  FACETED_CRYSTAL_SHAPE,
  HEART_PRISM_SHAPE,
  prepareShapeSampler,
  shapeBoundingRadius,
  shapeMeshIds,
  shapeSdfSource,
  shapeSpecsMeshIds,
  SNOWFLAKE_PRISM_SHAPE,
  STAR_PRISM_SHAPE,
  TREFOIL_KNOT_SHAPE,
  type ShapeSpec,
} from "./shapes";
import {
  meshAsset,
  meshAssetCatalogIndex,
  meshUnsignedDistance,
  type MeshAssetId,
} from "./mesh-shapes";
import { mulberry32 } from "./rng";

const CATALOG_SHAPES = [
  ["star-prism-v1", STAR_PRISM_SHAPE],
  ["faceted-crystal-v1", FACETED_CRYSTAL_SHAPE],
  ["heart-prism-v1", HEART_PRISM_SHAPE],
  ["crescent-moon-v1", CRESCENT_MOON_SHAPE],
  ["snowflake-prism-v1", SNOWFLAKE_PRISM_SHAPE],
  ["trefoil-knot-v1", TREFOIL_KNOT_SHAPE],
] as const satisfies readonly (readonly [MeshAssetId, ShapeSpec])[];

describe("canonical catalog mesh ShapeSpecs", () => {
  it("stores only one stable mesh id per canonical document value", () => {
    for (const [meshId, shape] of CATALOG_SHAPES) {
      expect(shape).toEqual({
        parts: [
          {
            primitive: { kind: "mesh", meshId },
            combine: "union",
          },
        ],
      });
      expect(shapeMeshIds(shape)).toEqual([meshId]);
    }
    expect(shapeSpecsMeshIds(CATALOG_SHAPES.map(([, shape]) => shape))).toEqual(
      CATALOG_SHAPES.map(([meshId]) => meshId),
    );
  });

  it("preserves Star at catalog index zero and appends every new mesh", () => {
    CATALOG_SHAPES.forEach(([meshId], index) => {
      expect(meshAssetCatalogIndex(meshId)).toBe(index);
    });
  });

  it("emits the stable catalog index in both shader dialects", () => {
    CATALOG_SHAPES.forEach(([, shape], index) => {
      const glsl = shapeSdfSource(shape, "glsl", "catalogShape");
      const wgsl = shapeSdfSource(shape, "wgsl", "catalogShape");
      expect(glsl).toContain(`shapeMeshSdf(${index}, vec3(px, py, pz))`);
      expect(wgsl).toContain(`shapeMeshSdf(${index}u, vec3f(px, py, pz))`);
      expect(glsl.match(/shapeMeshSdf/g)).toHaveLength(1);
      expect(wgsl.match(/shapeMeshSdf/g)).toHaveLength(1);
    });
  });

  it("shares each prepared asset's bound and surface sampler", () => {
    const rng = mulberry32(0x863c47);
    for (const [meshId, shape] of CATALOG_SHAPES) {
      const asset = meshAsset(meshId);
      expect(shapeBoundingRadius(shape)).toBe(asset.bounds.radius);

      const draw = prepareShapeSampler(shape);
      for (let i = 0; i < 64; i++) {
        const p = draw(rng);
        expect(meshUnsignedDistance(asset, p)).toBeLessThan(1e-7);
        expect(Math.hypot(...p)).toBeLessThanOrEqual(
          asset.bounds.radius + 1e-10,
        );
      }
    }
  });
});
