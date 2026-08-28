import {
  CUSTOM_MESH_SDF_RESOLUTION,
  MAX_CUSTOM_MESHES_PER_SCENE,
  MAX_CUSTOM_MESH_OBJ_BYTES,
  MAX_CUSTOM_MESH_SDF_VOXELS,
  MAX_CUSTOM_MESH_TRIANGLES,
  MAX_CUSTOM_MESH_VERTICES,
  canonicalizeCustomMeshObj,
  customMeshContentId,
  prepareCustomMeshObj,
} from "./custom-mesh";
import { meshContainsPoint } from "./mesh-shapes";

const TETRA_OBJ = `
# outward tetrahedron
o Tiny tetra
v 1 1 1
v -1 -1 1
v -1 1 -1
v 1 -1 -1
f 1 3 2
f 1 2 4
f 1 4 3
f 2 3 4
`;

const REORDERED_TETRA_OBJ = `
o Reordered tetra
v 1 -1 -1
v -1 1 -1
v -1 -1 1
v 1 1 1
f 3 2 1
f 4 1 2
f 4 3 1
f 4 2 3
`;

describe("strict custom OBJ canonicalization", () => {
  it("publishes explicit bounded resource limits", () => {
    expect(MAX_CUSTOM_MESH_OBJ_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_CUSTOM_MESH_VERTICES).toBe(25_000);
    expect(MAX_CUSTOM_MESH_TRIANGLES).toBe(50_000);
    expect(MAX_CUSTOM_MESHES_PER_SCENE).toBe(4);
    expect(CUSTOM_MESH_SDF_RESOLUTION).toBe(64);
    expect(MAX_CUSTOM_MESH_SDF_VOXELS).toBe(4 * 64 ** 3);
  });

  it("normalizes, removes unused vertices and preserves outward triangles", async () => {
    const geometry = canonicalizeCustomMeshObj(
      TETRA_OBJ.replace("f 1 3 2", "v 999 999 999\nf 1 3 2"),
      "fallback.obj",
    );
    expect(geometry.name).toBe("Tiny tetra");
    expect(geometry.vertices).toHaveLength(4);
    expect(geometry.triangles).toHaveLength(4);
    expect(Math.max(...geometry.vertices.flat())).toBe(1);
    expect(Math.min(...geometry.vertices.flat())).toBe(-1);

    const prepared = await prepareCustomMeshObj(TETRA_OBJ);
    expect(prepared.asset.id).toBe(prepared.id);
    expect(prepared.asset.name).toBe("Tiny tetra");
    expect(meshContainsPoint(prepared.asset, [0, 0, 0])).toBe(true);
  });

  it("gives equivalent indexed geometry the same canonical bytes and id", async () => {
    const first = canonicalizeCustomMeshObj(TETRA_OBJ);
    const second = canonicalizeCustomMeshObj(REORDERED_TETRA_OBJ);
    expect(Array.from(second.bytes)).toEqual(Array.from(first.bytes));
    expect(await customMeshContentId(second)).toBe(
      await customMeshContentId(first),
    );
  });

  it("pins the content-id vocabulary and ignores display names", async () => {
    const named = canonicalizeCustomMeshObj(TETRA_OBJ, "one.obj");
    const renamed = canonicalizeCustomMeshObj(
      TETRA_OBJ.replace("Tiny tetra", "Renamed tetra"),
      "two.obj",
    );
    const id = await customMeshContentId(named);
    expect(id).toMatch(/^mesh-sha256-[0-9a-f]{64}$/);
    expect(await customMeshContentId(renamed)).toBe(id);
  });

  it.each([
    ["quad", `${TETRA_OBJ}\nf 1 2 3 4`, /positive-index triangles/],
    ["relative index", `${TETRA_OBJ}\nf -1 -2 -3`, /positive-index/],
    ["slash index", `${TETRA_OBJ}\nf 1/1 2/2 3/3`, /positive-index/],
    ["material", `${TETRA_OBJ}\nusemtl red`, /unsupported directive/],
    ["normal", `${TETRA_OBJ}\nvn 0 0 1`, /unsupported directive/],
    ["forward reference", `v 0 0 0\nf 1 2 3`, /earlier vertices/],
    ["late vertex", `${TETRA_OBJ}\nv 0 0 0`, /vertices must precede faces/],
    ["non-finite", TETRA_OBJ.replace("v 1 1 1", "v 1e999 1 1"), /finite/],
  ])("rejects the %s extension", (_name, source, message) => {
    expect(() => canonicalizeCustomMeshObj(source)).toThrow(message);
  });

  it("rejects a second object and an oversized UTF-8 source", () => {
    expect(() => canonicalizeCustomMeshObj(`${TETRA_OBJ}\no second`)).toThrow(
      /exactly one object/,
    );
    const oversized = `#${"é".repeat(MAX_CUSTOM_MESH_OBJ_BYTES / 2 + 1)}`;
    expect(() => canonicalizeCustomMeshObj(oversized)).toThrow(/byte import/);
    expect(() => canonicalizeCustomMeshObj(`#${"x".repeat(4097)}`)).toThrow(
      /4096 characters/,
    );
  });
});
