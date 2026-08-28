import {
  installSerializedCustomMeshAsset,
  installSerializedMeshSdfBake,
  meshContainsPoint,
  uninstallCustomMeshAsset,
} from "../fractal/mesh-shapes";
import {
  prepareCustomMeshImport,
  prepareCustomMeshWorkerRequest,
} from "./custom-mesh-worker-core";

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

describe("custom mesh import worker core", () => {
  it("prepares one transferable source and conservative bake wire", async () => {
    const result = await prepareCustomMeshImport(
      { type: "import", jobId: 7, source: TETRA_OBJ, fileName: "tiny.obj" },
      8,
    );
    expect(result).toMatchObject({ type: "result", jobId: 7 });
    expect(result.source.id).toBe(result.bake.meshId);
    expect(result.source.name).toBe("tiny");
    expect(result.bake.values).toHaveLength(8 ** 3);

    const asset = installSerializedCustomMeshAsset(result.source);
    try {
      const bake = installSerializedMeshSdfBake(result.bake);
      expect(bake.mesh).toBe(asset);
      expect(meshContainsPoint(asset, [0, 0, 0])).toBe(true);
    } finally {
      uninstallCustomMeshAsset(result.source.id);
    }
  });

  it("rejects malformed requests before allocating geometry", async () => {
    await expect(
      prepareCustomMeshImport({ type: "import", jobId: -1 }, 8),
    ).rejects.toThrow(/invalid custom mesh import request/);
  });

  it("validates durable cache wires and can regenerate their derived bake", async () => {
    const imported = await prepareCustomMeshImport(
      { type: "import", jobId: 1, source: TETRA_OBJ, fileName: "tiny.obj" },
      8,
    );
    const hydrated = await prepareCustomMeshWorkerRequest({
      type: "hydrate",
      jobId: 2,
      source: imported.source,
      bake: imported.bake,
    });
    expect(hydrated).toMatchObject({
      type: "result",
      jobId: 2,
      source: { id: imported.source.id },
      bake: { meshId: imported.source.id, resolution: 8 },
    });

    const rebaked = await prepareCustomMeshWorkerRequest({
      type: "bake",
      jobId: 3,
      source: imported.source,
      resolution: 8,
    });
    expect(rebaked.bake.values).toEqual(imported.bake.values);

    await expect(
      prepareCustomMeshWorkerRequest({
        type: "hydrate",
        jobId: 4,
        source: imported.source,
        bake: { ...imported.bake, values: new Float32Array(1) },
      }),
    ).rejects.toThrow(/arrays are malformed/);
  });
});
