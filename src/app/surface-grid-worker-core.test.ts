import {
  buildSurfaceGridResult,
  surfaceGridResultTransfers,
} from "./surface-grid-worker-core";
import type { SurfaceGridRequest } from "./surface-grid-worker-core";
import { buildSurfaceGrid, surfaceGridSpec } from "../fractal/surface-grid";
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

// -----------------------------------------------------------------------
// fr-aj4w: the measured-pilot-slab downshift. buildSurfaceGridResult times
// one mid z-layer of the requested cube, then lets surface-grid.ts's
// pickSurfaceGridResolution decide whether the full build stays at the
// request or drops to a cheaper ladder rung (see that module's doc and the
// module doc above for the full reasoning).
// -----------------------------------------------------------------------

describe("the pilot slab and downshift ladder (fr-aj4w)", () => {
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
