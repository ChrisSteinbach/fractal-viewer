import {
  buildSurfaceGridResult,
  surfaceGridResultTransfers,
} from "./surface-grid-worker-core";
import type { SurfaceGridRequest } from "./surface-grid-worker-core";
import { buildSurfaceGrid, surfaceGridSpec } from "../fractal/surface-grid";
import { buildSurfaceDE } from "../fractal/surface-de";
import { sierpinskiTetrahedron } from "../fractal/presets";
import {
  bakeMeshSdf,
  bakePreparedMeshSdf,
  hasMeshAsset,
  installCustomMeshAsset,
  prepareSerializedCustomMeshAsset,
  serializeMeshSdfBake,
  uninstallCustomMeshAsset,
  type CustomMeshAssetId,
  type SerializedMeshSdfBake,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";
import type { Transform } from "../fractal/types";

const SURFACE_MESH_ID: CustomMeshAssetId = `mesh-sha256-${"3".repeat(64)}`;

function meshSource(
  id: CustomMeshAssetId = SURFACE_MESH_ID,
): SerializedPreparedMeshAsset {
  return {
    id,
    name: "Worker tetra",
    vertices: new Float64Array([1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1]),
    triangles: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
  };
}

function meshBake(
  id: CustomMeshAssetId = SURFACE_MESH_ID,
): SerializedMeshSdfBake {
  const source = prepareSerializedCustomMeshAsset(meshSource(id));
  return serializeMeshSdfBake(bakePreparedMeshSdf(source, 8));
}

function customMeshTransform(id = SURFACE_MESH_ID): Transform {
  return {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
    emitter: {
      parts: [
        {
          combine: "union",
          primitive: { kind: "mesh", meshId: id },
        },
      ],
    },
  };
}

function customMeshDe() {
  const asset = prepareSerializedCustomMeshAsset(meshSource());
  installCustomMeshAsset(asset);
  try {
    return buildSurfaceDE([
      customMeshTransform(),
      { ...sierpinskiTetrahedron()[0], id: 1 },
    ]);
  } finally {
    uninstallCustomMeshAsset(SURFACE_MESH_ID);
  }
}

/**
 * A minimal, fully-specified `SurfaceGridRequest`, overridable per test so
 * each test states only what it actually varies. `resolution: 8` (well
 * under the shipped `SURFACE_GRID_RESOLUTION`) keeps every build cheap —
 * this suite tests the request/response WIRING, never the grid math itself
 * (see surface-grid.test.ts for that).
 */
function request(
  overrides: Partial<SurfaceGridRequest> = {},
): SurfaceGridRequest {
  return {
    id: 1,
    de: buildSurfaceDE(sierpinskiTetrahedron()),
    resolution: 8,
    ...overrides,
  };
}

describe("buildSurfaceGridResult", () => {
  it("installs custom mesh payloads before evaluating a surface request", () => {
    const de = customMeshDe();
    expect(() =>
      buildSurfaceGridResult(request({ de, resolution: 4 }), () => 0),
    ).toThrow(/missing local mesh asset/);

    try {
      const prepared = prepareSerializedCustomMeshAsset(meshSource());
      const bake = serializeMeshSdfBake(bakePreparedMeshSdf(prepared, 8));
      bake.values[0] -= 0.125;
      const result = buildSurfaceGridResult(
        request({
          de,
          resolution: 4,
          meshAssets: [meshSource()],
          meshBakes: [bake],
        }),
        () => 0,
      );
      expect(result.values).toHaveLength(4 ** 3);
      expect(Array.from(result.values).every(Number.isFinite)).toBe(true);
      expect(bakeMeshSdf(SURFACE_MESH_ID, 8).values[0]).toBe(bake.values[0]);
    } finally {
      uninstallCustomMeshAsset(SURFACE_MESH_ID);
    }
  });

  it("reuses an active resident source+bake without repeated wires", () => {
    const de = customMeshDe();
    try {
      const first = buildSurfaceGridResult(
        request({
          de,
          resolution: 4,
          meshAssets: [meshSource()],
          meshBakes: [meshBake()],
        }),
        () => 0,
      );
      const second = buildSurfaceGridResult(
        request({
          id: 2,
          de,
          resolution: 4,
          meshAssetIds: [SURFACE_MESH_ID],
        }),
        () => 0,
      );

      expect(first.values).toHaveLength(4 ** 3);
      expect(second.values).toHaveLength(4 ** 3);
    } finally {
      uninstallCustomMeshAsset(SURFACE_MESH_ID);
    }
  });

  it("rejects custom mesh batches above the scene budget", () => {
    expect(() =>
      buildSurfaceGridResult(
        request({ meshAssets: Array.from({ length: 5 }, () => meshSource()) }),
      ),
    ).toThrow(/too many custom mesh assets/);
  });

  it("rejects a malformed batch without partially installing earlier wires", () => {
    const malformedId: CustomMeshAssetId = `mesh-sha256-${"4".repeat(64)}`;
    expect(() =>
      buildSurfaceGridResult(
        request({
          de: customMeshDe(),
          resolution: 4,
          meshAssets: [
            meshSource(),
            {
              ...meshSource(malformedId),
              triangles: new Uint32Array([0]),
            },
          ],
        }),
        () => 0,
      ),
    ).toThrow(/malformed/);
    expect(hasMeshAsset(SURFACE_MESH_ID)).toBe(false);
  });

  it("stages all bakes before installing their new sources", () => {
    const secondId: CustomMeshAssetId = `mesh-sha256-${"5".repeat(64)}`;
    const firstBake = meshBake();
    const secondBake = meshBake(secondId);
    try {
      expect(() =>
        buildSurfaceGridResult(
          request({
            meshAssets: [meshSource(), meshSource(secondId)],
            meshBakes: [
              firstBake,
              { ...secondBake, values: new Float32Array(1) },
            ],
          }),
        ),
      ).toThrow(/arrays are malformed/);
      expect(hasMeshAsset(SURFACE_MESH_ID)).toBe(false);
      expect(hasMeshAsset(secondId)).toBe(false);
    } finally {
      uninstallCustomMeshAsset(SURFACE_MESH_ID);
      uninstallCustomMeshAsset(secondId);
    }
  });

  it("rejects a malformed first bake without installing its source", () => {
    const bake = meshBake();
    try {
      expect(() =>
        buildSurfaceGridResult(
          request({
            meshAssets: [meshSource()],
            meshBakes: [{ ...bake, values: new Float32Array(1) }],
          }),
        ),
      ).toThrow(/arrays are malformed/);
      expect(hasMeshAsset(SURFACE_MESH_ID)).toBe(false);
    } finally {
      uninstallCustomMeshAsset(SURFACE_MESH_ID);
    }
  });

  it("rejects duplicate bake keys before installing their source", () => {
    const first = meshBake();
    const conflicting = serializeMeshSdfBake(
      bakePreparedMeshSdf(prepareSerializedCustomMeshAsset(meshSource()), 8),
    );
    conflicting.values[0] -= 0.125;
    try {
      expect(() =>
        buildSurfaceGridResult(
          request({
            meshAssets: [meshSource()],
            meshBakes: [first, conflicting],
          }),
        ),
      ).toThrow(/duplicate custom mesh bake/);
      expect(hasMeshAsset(SURFACE_MESH_ID)).toBe(false);
    } finally {
      uninstallCustomMeshAsset(SURFACE_MESH_ID);
    }
  });

  it("matches buildSurfaceGrid for resolution/halfExtent/values and echoes the request id (oracle)", () => {
    const req = request({ id: 7 });
    const result = buildSurfaceGridResult(req);

    const direct = buildSurfaceGrid(req.de, req.resolution);

    expect(result.resolution).toBe(direct.resolution);
    expect(result.halfExtent).toBe(direct.halfExtent);
    expect(result.values).toEqual(direct.values);
    expect(result.id).toBe(7);
  });

  it("is deterministic for a fixed request", () => {
    const req = request();

    const a = buildSurfaceGridResult(req);
    const b = buildSurfaceGridResult(req);

    expect(Array.from(a.values)).toEqual(Array.from(b.values));
  });
});

describe("surfaceGridResultTransfers", () => {
  it("lists exactly the values buffer", () => {
    const result = buildSurfaceGridResult(request());

    const transfers = surfaceGridResultTransfers(result);

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toBe(result.values.buffer);
  });
});

// -----------------------------------------------------------------------
// The measured-pilot-slab downshift. buildSurfaceGridResult times one mid
// z-layer of the requested cube, then lets surface-grid.ts's
// pickSurfaceGridResolution decide whether the full build stays at the
// request or drops to a cheaper ladder rung (see that module's doc and the
// module doc above for the full reasoning).
// -----------------------------------------------------------------------

describe("the pilot slab and downshift ladder", () => {
  it("keeps the requested resolution and matches a one-shot build bit-for-bit when the resolution sits below the ladder", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    // 16 is below every SURFACE_GRID_RESOLUTION_LADDER rung (64/48/32), so
    // pickSurfaceGridResolution always keeps it regardless of the pilot's
    // measured time — the real `performance.now()` default is fine here,
    // nothing depends on its actual value.
    const req = request({ de, resolution: 16 });

    const result = buildSurfaceGridResult(req);

    expect(result.resolution).toBe(16);
    expect(result.values).toEqual(buildSurfaceGrid(de, 16).values);
  });

  it("downshifts to the ladder floor when the measured pilot projects the full build over budget", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const req = request({ de, resolution: 48 });
    // A huge injected pilot time forces pickSurfaceGridResolution(48, 1e7)
    // to land on the 32 floor (every rung, including 32 itself, projects
    // far over SURFACE_GRID_BUDGET_MS at that pilot cost).
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls === 1 ? 0 : 10_000_000;
    };

    const result = buildSurfaceGridResult(req, now);

    expect(result.resolution).toBe(32);
    expect(result.values.length).toBe(32 ** 3);
    expect(result.values).toEqual(buildSurfaceGrid(de, 32).values);
    // halfExtent depends only on the DE, never on resolution, so the
    // downshifted result must still agree with a spec built at the chosen
    // (not the requested) resolution.
    expect(result.halfExtent).toBe(surfaceGridSpec(de, 32).halfExtent);
  });

  it("times the pilot layer with the injected clock", () => {
    let calls = 0;
    const now = () => {
      calls += 1;
      return 0;
    };

    buildSurfaceGridResult(request(), now);

    // Not pinning an exact call count — that would over-fit the
    // implementation's internal timing calls — only that the injected
    // clock is genuinely consulted at least twice (before and after the
    // pilot slab).
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
