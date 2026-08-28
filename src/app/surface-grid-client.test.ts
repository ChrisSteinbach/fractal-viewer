import { SurfaceGridClient } from "./surface-grid-client";
import type {
  SurfaceGridRequest,
  SurfaceGridResult,
} from "./surface-grid-worker-core";
import { SURFACE_GRID_RESOLUTION } from "../fractal/surface-grid";
import type { SurfaceGrid } from "../fractal/surface-grid";
import { buildSurfaceDE } from "../fractal/surface-de";
import { sierpinskiTetrahedron } from "../fractal/presets";
import {
  MESH_SDF_BAKE_VERSION,
  type SerializedMeshSdfBake,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";

function meshSource(index: number): SerializedPreparedMeshAsset {
  return {
    id: `mesh-sha256-${index.toString(16).padStart(64, "0")}`,
    name: `Grid mesh ${index}`,
    vertices: new Float64Array(),
    triangles: new Uint32Array(),
  };
}

function meshBake(source: SerializedPreparedMeshAsset): SerializedMeshSdfBake {
  return {
    meshId: source.id,
    version: MESH_SDF_BAKE_VERSION,
    resolution: 1,
    values: new Float32Array(1),
    min: new Float64Array(3),
    max: new Float64Array(3),
    cellSize: 1,
    cellRadius: 1,
  };
}

/**
 * A cheap, shared `SurfaceDE` fixture. This suite tests the client's
 * request/response POLICY, never the grid math itself (see
 * surface-grid-worker-core.test.ts and surface-grid.test.ts for that), so
 * every test can pass this same opaque value through `request()`.
 */
const de = buildSurfaceDE(sierpinskiTetrahedron());

/** A minimal `SurfaceGridResult` tagged with `id`, standing in for whatever
 * a real worker would eventually deliver. `halfExtent` defaults to `id` so
 * a test can tell two results apart by their payload alone. */
function fakeResult(id: number, halfExtent = id): SurfaceGridResult {
  return { id, resolution: 4, halfExtent, values: new Float32Array(4 ** 3) };
}

/**
 * A fresh `SurfaceGridClient` wired to a fake worker: `createWorker`
 * captures the `onResult`/`onError` callbacks (so a test can fire them via
 * `deliverResult`/`triggerError`), counts its own invocations, and records
 * every posted request in `posted`; `onGrid`/`onError` record every
 * delivery in `grids`/`errors`.
 */
function harness(): {
  client: SurfaceGridClient;
  posted: SurfaceGridRequest[];
  grids: SurfaceGrid[];
  errors: unknown[];
  createWorkerCallCount: () => number;
  terminatedCount: () => number;
  deliverResult: (result: SurfaceGridResult) => void;
  triggerError: (error: unknown) => void;
} {
  const posted: SurfaceGridRequest[] = [];
  const grids: SurfaceGrid[] = [];
  const errors: unknown[] = [];
  let createWorkerCalls = 0;
  let terminated = 0;
  let deliver: ((result: SurfaceGridResult) => void) | null = null;
  let fail: ((error: unknown) => void) | null = null;

  const client = new SurfaceGridClient({
    createWorker: (onResult, onError) => {
      createWorkerCalls++;
      deliver = onResult;
      fail = onError;
      return {
        post: (request: SurfaceGridRequest) => posted.push(request),
        terminate: () => {
          terminated++;
        },
      };
    },
    onGrid: (grid) => grids.push(grid),
    onError: (error) => errors.push(error),
  });

  return {
    client,
    posted,
    grids,
    errors,
    createWorkerCallCount: () => createWorkerCalls,
    terminatedCount: () => terminated,
    deliverResult: (result: SurfaceGridResult) => deliver?.(result),
    triggerError: (error: unknown) => fail?.(error),
  };
}

describe("SurfaceGridClient request()", () => {
  it("posts the first request immediately with a stamped id, spawning the worker lazily", () => {
    const h = harness();
    expect(h.createWorkerCallCount()).toBe(0); // not spawned at construction

    h.client.request(de);

    expect(h.createWorkerCallCount()).toBe(1);
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0].id).toBe(1);
    expect(h.posted[0].resolution).toBe(SURFACE_GRID_RESOLUTION); // default
    expect(h.client.busy).toBe(true);
    expect(h.grids).toHaveLength(0);
  });

  it("delivers the built grid to onGrid with the result's fields intact", () => {
    const h = harness();
    h.client.request(de);

    const values = new Float32Array([1, 2, 3, 4]);
    h.deliverResult({ id: 1, resolution: 6, halfExtent: 2.5, values });

    expect(h.grids).toEqual([{ resolution: 6, halfExtent: 2.5, values }]);
    expect(h.grids[0].values).toBe(values); // delivered by reference, not copied
    expect(h.client.busy).toBe(false);
  });

  it("keeps one physical request in flight and only the latest pending build", () => {
    const h = harness();

    h.client.request(de);
    h.client.request(de);
    h.client.request(de);

    expect(h.createWorkerCallCount()).toBe(1);
    expect(h.posted.map((request) => request.id)).toEqual([1]);

    h.deliverResult(fakeResult(1));
    expect(h.posted.map((request) => request.id)).toEqual([1, 3]);
  });

  it("latest wins: an earlier physical reply dispatches the pending request but is dropped", () => {
    const h = harness();

    h.client.request(de); // id 1
    h.client.request(de); // id 2 — parked while id 1 executes
    expect(h.posted.map((p) => p.id)).toEqual([1]);

    h.deliverResult(fakeResult(1)); // stale — dropped, id 2 posts
    expect(h.posted.map((p) => p.id)).toEqual([1, 2]);
    expect(h.grids).toHaveLength(0);
    expect(h.client.busy).toBe(true); // still awaiting id 2

    h.deliverResult(fakeResult(2)); // latest — delivered
    expect(h.grids).toHaveLength(1);
    expect(h.grids[0].halfExtent).toBe(2); // fakeResult(2)'s own tag confirms which one landed
    expect(h.client.busy).toBe(false);
  });

  it("posts each source+bake once, then re-sends both after LRU eviction", () => {
    const h = harness();
    const sources = Array.from({ length: 9 }, (_, index) => meshSource(index));
    for (const [index, source] of sources.entries()) {
      const bake = meshBake(source);
      h.client.request(de, 4, [source], [bake]);
      expect(h.posted[index].meshAssetIds).toEqual([source.id]);
      expect(h.posted[index].meshAssets).toEqual([source]);
      expect(h.posted[index].meshBakes).toEqual([bake]);
      h.deliverResult(fakeResult(index + 1));
    }

    const revisitedBake = meshBake(sources[0]);
    h.client.request(de, 4, [sources[0]], [revisitedBake]);
    expect(h.posted[9].meshAssets).toEqual([sources[0]]);
    expect(h.posted[9].meshBakes).toEqual([revisitedBake]);
  });

  it("sends only the active id after a source+bake is resident", () => {
    const h = harness();
    const source = meshSource(9);
    const bake = meshBake(source);
    h.client.request(de, 4, [source], [bake]);
    h.deliverResult(fakeResult(1));

    h.client.request(de, 4, [source], [bake]);
    expect(h.posted[1].meshAssetIds).toEqual([source.id]);
    expect(h.posted[1].meshAssets).toBeUndefined();
    expect(h.posted[1].meshBakes).toBeUndefined();
  });

  it("tracks source and bake residency independently", () => {
    const h = harness();
    const source = meshSource(15);
    const bake = meshBake(source);
    h.client.request(de, 4, [source]);
    h.deliverResult(fakeResult(1));

    h.client.request(de, 4, [source], [bake]);
    expect(h.posted[1].meshAssets).toBeUndefined();
    expect(h.posted[1].meshBakes).toEqual([bake]);
  });

  it("does not count a superseded pending source as resident", () => {
    const h = harness();
    const first = meshSource(10);
    const dropped = meshSource(11);
    const latest = meshSource(12);
    h.client.request(de, 4, [first], [meshBake(first)]);
    h.client.request(de, 4, [dropped], [meshBake(dropped)]);
    h.client.request(de, 4, [latest], [meshBake(latest)]);

    h.deliverResult(fakeResult(1));
    expect(h.posted[1].meshAssets).toEqual([latest]);
    h.deliverResult(fakeResult(3));

    h.client.request(de, 4, [dropped], [meshBake(dropped)]);
    expect(h.posted[2].meshAssets).toEqual([dropped]);
  });
});

describe("SurfaceGridClient cancel()", () => {
  it("drops a late result and resolves settle", async () => {
    const h = harness();
    h.client.request(de); // id 1, outstanding

    let settled = false;
    h.client.settle().then(() => {
      settled = true;
    });

    h.client.cancel();
    await Promise.resolve();

    expect(settled).toBe(true);
    expect(h.client.busy).toBe(false);

    h.deliverResult(fakeResult(1)); // the cancelled request's late reply
    expect(h.grids).toHaveLength(0);
  });
});

describe("SurfaceGridClient settle()", () => {
  it("resolves immediately when idle", async () => {
    const h = harness();

    await expect(h.client.settle()).resolves.toBeUndefined();
  });

  it("waits for the result while a request is outstanding", async () => {
    const h = harness();
    const events: string[] = [];
    h.client.request(de);

    const waiter = h.client.settle().then(() => events.push("settled"));
    h.deliverResult(fakeResult(1));
    events.push("result");

    await waiter;
    expect(events).toEqual(["result", "settled"]);
  });

  it("resolves all concurrent waiters", async () => {
    const h = harness();
    h.client.request(de);

    const settleA = h.client.settle();
    const settleB = h.client.settle();
    h.deliverResult(fakeResult(1));

    await expect(settleA).resolves.toBeUndefined();
    await expect(settleB).resolves.toBeUndefined();
  });
});

describe("SurfaceGridClient worker error recovery", () => {
  it("onError fires, the client goes idle, and the next request spawns a fresh worker", async () => {
    const h = harness();
    h.client.request(de); // id 1, spawns worker #1
    expect(h.createWorkerCallCount()).toBe(1);

    let settled = false;
    h.client.settle().then(() => {
      settled = true;
    });

    const crash = new Error("worker crashed");
    h.triggerError(crash);
    await Promise.resolve();

    expect(h.errors).toEqual([crash]);
    expect(h.client.busy).toBe(false);
    expect(settled).toBe(true);
    expect(h.terminatedCount()).toBe(1);

    h.client.request(de); // respawns a fresh worker
    expect(h.createWorkerCallCount()).toBe(2);
  });

  it("re-sends cached wires after a worker crash creates a fresh realm", () => {
    const h = harness();
    const source = meshSource(13);
    const bake = meshBake(source);
    h.client.request(de, 4, [source], [bake]);
    h.triggerError(new Error("worker crashed"));

    h.client.request(de, 4, [source], [bake]);
    expect(h.posted[1].meshAssets).toEqual([source]);
    expect(h.posted[1].meshBakes).toEqual([bake]);
  });
});

describe("SurfaceGridClient dispose()", () => {
  it("terminates the worker handle and a later request respawns", () => {
    const h = harness();
    h.client.request(de);
    expect(h.createWorkerCallCount()).toBe(1);

    h.client.dispose();

    expect(h.terminatedCount()).toBe(1);
    expect(h.client.busy).toBe(false);

    h.client.request(de);
    expect(h.createWorkerCallCount()).toBe(2);
  });

  it("forgets worker residency along with the disposed realm", () => {
    const h = harness();
    const source = meshSource(14);
    const bake = meshBake(source);
    h.client.request(de, 4, [source], [bake]);
    h.client.dispose();

    h.client.request(de, 4, [source], [bake]);
    expect(h.posted[1].meshAssets).toEqual([source]);
    expect(h.posted[1].meshBakes).toEqual([bake]);
  });
});
