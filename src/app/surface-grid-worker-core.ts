/**
 * The surface render's empty-space-skipping grid, worker-side compute: one
 * pure function from a {@link SurfaceGridRequest} to a
 * {@link SurfaceGridResult}. `surface-grid-worker.ts` is the thin
 * `self.onmessage`/`postMessage` glue that runs this inside the real
 * Worker; `surface-grid-client.ts` is the main-thread client that posts
 * requests.
 *
 * THE PILOT SLAB. A build's cost spans two orders of magnitude by system:
 * affine presets price a `64 ** 3` cube in ~0.3s where fold systems
 * (boxfold/spherefold/mandelbox variations) measured up to ~40s on the same
 * machine — a pegged worker core for a minute-class stall on mid hardware,
 * and offline timeline export AWAITS this build (`main.ts`'s
 * `surfaceGrid.settle()`), so the cost is a render-keyframe stall, not just
 * background heat. Instead of guessing from system shape, the worker
 * MEASURES: build the requested cube's mid z-layer first (the equator — the
 * most expensive layer), time it, and let `surface-grid.ts`'s
 * {@link pickSurfaceGridResolution} project the full cost and downshift the
 * resolution until the projection fits `SURFACE_GRID_BUDGET_MS` (floored,
 * never skipped — a coarse grid still beats gridless marching on exactly
 * the systems that are expensive to march). When no downshift is needed —
 * every affine preset — the pilot layer is simply the first slab of the
 * final build: zero waste. When one is, the discarded pilot cost
 * `1/requested` of the full build it avoided. The request's `resolution` is
 * therefore a CEILING; the result's `resolution` says what was actually
 * built.
 *
 * Unlike `cloud-worker-core.ts` there is no synchronous-fallback path here:
 * even a downshifted build costs real CPU time (hence a dedicated worker in
 * the first place), so running it inline on the main thread on worker
 * failure would freeze the very frame the grid exists to speed up. The grid
 * is a pure ENHANCEMENT of the sphere tracer — correct, just slower, with
 * no grid at all — so `surface-grid-client.ts` degrades to "no grid"
 * instead of ever falling back to a synchronous build; see that module's
 * doc.
 */
import {
  buildSurfaceGrid,
  buildSurfaceGridSlab,
  pickSurfaceGridResolution,
  surfaceGridSpec,
} from "../fractal/surface-grid";
import type { SurfaceDE } from "../fractal/surface-de";
import {
  hasMeshAsset,
  installCustomMeshAsset,
  installPreparedMeshSdfBake,
  installSerializedCustomMeshAsset,
  meshAsset,
  prepareSerializedCustomMeshAsset,
  prepareSerializedMeshSdfBake,
  type MeshSdfBake,
  type PreparedMeshAsset,
  type SerializedMeshSdfBake,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";
import { MAX_CUSTOM_MESHES_PER_SCENE } from "../fractal/custom-mesh";

function sameMeshSource(
  left: SerializedPreparedMeshAsset,
  right: SerializedPreparedMeshAsset,
): boolean {
  return (
    left.vertices instanceof Float64Array &&
    right.vertices instanceof Float64Array &&
    left.triangles instanceof Uint32Array &&
    right.triangles instanceof Uint32Array &&
    left.vertices.length === right.vertices.length &&
    left.triangles.length === right.triangles.length &&
    left.vertices.every((value, index) =>
      Object.is(value, right.vertices[index]),
    ) &&
    left.triangles.every((value, index) => value === right.triangles[index])
  );
}

function installRequestMeshAssets(
  wires: readonly SerializedPreparedMeshAsset[] = [],
  bakes: readonly SerializedMeshSdfBake[] = [],
): void {
  if (
    wires.length > MAX_CUSTOM_MESHES_PER_SCENE ||
    bakes.length > MAX_CUSTOM_MESHES_PER_SCENE ||
    new Set([
      ...wires.map((wire) => wire.id),
      ...bakes.map((bake) => bake.meshId),
    ]).size > MAX_CUSTOM_MESHES_PER_SCENE
  ) {
    throw new RangeError("too many custom mesh assets in request");
  }
  for (let index = 0; index < wires.length; index += 1) {
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (
        wires[earlier].id === wires[index].id &&
        !sameMeshSource(wires[earlier], wires[index])
      ) {
        throw new RangeError("serialized mesh conflicts within request");
      }
    }
  }
  const sourcesById = new Map<string, PreparedMeshAsset>();
  const stagedSources: PreparedMeshAsset[] = [];
  for (const wire of wires) {
    if (sourcesById.has(wire.id)) continue;
    if (hasMeshAsset(wire.id)) {
      sourcesById.set(wire.id, installSerializedCustomMeshAsset(wire));
      continue;
    }
    const source = prepareSerializedCustomMeshAsset(wire);
    sourcesById.set(wire.id, source);
    stagedSources.push(source);
  }
  const bakeKeys = new Set<string>();
  const stagedBakes: MeshSdfBake[] = [];
  for (const bake of bakes) {
    const key = `${bake.meshId}:${String(bake.version)}:${String(bake.resolution)}`;
    if (bakeKeys.has(key)) {
      throw new RangeError("duplicate custom mesh bake in request");
    }
    bakeKeys.add(key);
    const source =
      sourcesById.get(bake.meshId) ??
      (hasMeshAsset(bake.meshId) ? meshAsset(bake.meshId) : undefined);
    if (!source) {
      throw new RangeError(
        "custom mesh bake has no installed or staged source",
      );
    }
    stagedBakes.push(prepareSerializedMeshSdfBake(bake, source));
  }
  for (const source of stagedSources) installCustomMeshAsset(source);
  for (const bake of stagedBakes) installPreparedMeshSdfBake(bake);
}

/** Main thread -> worker: one grid-build request. */
export interface SurfaceGridRequest {
  /** Monotonic tag stamped by `surface-grid-client.ts` and echoed on the
   * result, so the client can match a reply to its request and drop stale
   * ones. */
  id: number;
  /** Custom mesh sources referenced by `de`. The worker validates the entire
   * batch before installing any entry in its realm-local registry. */
  meshAssets?: readonly SerializedPreparedMeshAsset[];
  /** Derived bakes matching `meshAssets`, avoiding a cold 64³ rebuild in a
   * newly spawned grid worker. */
  meshBakes?: readonly SerializedMeshSdfBake[];
  /** Plain structured-cloneable data (`surface-de.ts`) — crosses
   * postMessage as-is, no transfer needed. */
  de: SurfaceDE;
  /** Per-axis cell-count CEILING. The worker builds this resolution unless
   * its measured pilot slab projects the build over budget, in which case
   * it downshifts (see the module doc); the result's `resolution` is the
   * one actually built. */
  resolution: number;
}

/** Worker -> main thread: the built grid, tagged with the request's id. */
export interface SurfaceGridResult {
  id: number;
  resolution: number;
  halfExtent: number;
  values: Float32Array;
}

/**
 * Build one grid — the pure request -> result function both the real worker
 * (`surface-grid-worker.ts`) and tests run. The module doc's pilot flow:
 * mid z-layer of the requested cube first, timed with `now` (injected for
 * tests; defaults to `performance.now`, which Workers have), then either
 * finish the same array (no downshift — the pilot layer is kept) or run
 * `surface-grid.ts`'s one-shot `buildSurfaceGrid` at the downshifted
 * resolution. Estimator choice rides `surface-grid.ts`'s own per-system
 * default (`surfaceGridEstimator`): plain for fold systems, refined for
 * affine — this module never overrides it.
 */
export function buildSurfaceGridResult(
  request: SurfaceGridRequest,
  now: () => number = () => performance.now(),
): SurfaceGridResult {
  installRequestMeshAssets(request.meshAssets, request.meshBakes);

  const { de, resolution } = request;
  const spec = surfaceGridSpec(de, resolution);
  const values = new Float32Array(resolution * resolution * resolution);
  const pilotZ = resolution >> 1;
  const before = now();
  buildSurfaceGridSlab(de, spec, pilotZ, pilotZ + 1, values);
  const pilotLayerMs = now() - before;
  const chosen = pickSurfaceGridResolution(resolution, pilotLayerMs);
  if (chosen === resolution) {
    buildSurfaceGridSlab(de, spec, 0, pilotZ, values);
    buildSurfaceGridSlab(de, spec, pilotZ + 1, resolution, values);
    return { id: request.id, ...spec, values };
  }
  return { id: request.id, ...buildSurfaceGrid(de, chosen) };
}

/**
 * The buffer to move (zero-copy ownership transfer, not clone) when posting
 * `result` to the main thread — `values` is a fresh standalone allocation
 * per build (either this module's own `new Float32Array(...)` or
 * `buildSurfaceGrid`'s), so transferring never detaches memory anything
 * else still holds a view of.
 *
 * The cast narrows `Float32Array.buffer`'s loose `ArrayBufferLike` typing:
 * both allocation sites only ever produce a plain `ArrayBuffer`, never a
 * SharedArrayBuffer-backed view (same reasoning as `cloud-worker-core.ts`'s
 * `cloudResultTransfers`).
 */
export function surfaceGridResultTransfers(
  result: SurfaceGridResult,
): Transferable[] {
  return [result.values.buffer as ArrayBuffer];
}
