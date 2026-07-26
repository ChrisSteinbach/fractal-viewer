import {
  buildSurfaceGridResult,
  surfaceGridResultTransfers,
} from "./surface-grid-worker-core";
import type { SurfaceGridRequest } from "./surface-grid-worker-core";
import { buildSurfaceGrid } from "../fractal/surface-grid";
import { buildSurfaceDE } from "../fractal/surface-de";
import { sierpinskiTetrahedron } from "../fractal/presets";

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
