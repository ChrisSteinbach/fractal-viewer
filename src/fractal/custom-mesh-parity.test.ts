import { prepareCustomMeshObj } from "./custom-mesh";
import {
  installCustomMeshAsset,
  meshAsset,
  meshSdfAtlas,
  uninstallCustomMeshAsset,
} from "./mesh-shapes";
import { mulberry32 } from "./rng";
import { surfaceMeshSdfWgslSource } from "./surface-de-gpu";
import {
  prepareShapeSampler,
  shapeSdf,
  shapeSdfSource,
  type ShapeSpec,
} from "./shapes";

const TETRA_OBJ = `
v 1 1 1
v -1 -1 1
v -1 1 -1
v 1 -1 -1
f 1 3 2
f 1 2 4
f 1 4 3
f 2 3 4
`;

describe("custom mesh renderer parity", () => {
  it("feeds sampling, CPU SDF and dense GLSL/WGSL slots from one prepared object", async () => {
    const prepared = await prepareCustomMeshObj(TETRA_OBJ);
    installCustomMeshAsset(prepared.asset);
    try {
      const shape: ShapeSpec = {
        parts: [
          {
            primitive: { kind: "mesh", meshId: prepared.id },
            combine: "union",
          },
        ],
      };
      expect(meshAsset(prepared.id)).toBe(prepared.asset);
      const sample = prepareShapeSampler(shape)(mulberry32(7));
      expect(Number.isFinite(sample[0] + sample[1] + sample[2])).toBe(true);
      expect(shapeSdf(shape, 0, 0, 0)).toBeLessThan(0);

      const atlas = meshSdfAtlas([prepared.id], 8);
      expect(atlas.entries[0]).toMatchObject({
        meshId: prepared.id,
        shaderIndex: 0,
        catalogIndex: -1,
        zOffset: 0,
      });
      for (const dialect of ["glsl", "wgsl"] as const) {
        expect(
          shapeSdfSource(shape, dialect, "customShape", {
            meshIndex: (id) => (id === prepared.id ? 0 : -1),
          }),
        ).toContain(
          dialect === "glsl" ? "shapeMeshSdf(0," : "shapeMeshSdf(0u,",
        );
      }
      const surfaceWgsl = surfaceMeshSdfWgslSource([prepared.id]);
      expect(surfaceWgsl).toContain("case 0u:");
      expect(surfaceWgsl).toContain("return shapeMeshSdf0(p);");
    } finally {
      uninstallCustomMeshAsset(prepared.id);
    }
  }, 30_000);
});
