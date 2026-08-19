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

/** Main thread -> worker: one grid-build request. */
export interface SurfaceGridRequest {
  /** Monotonic tag stamped by `surface-grid-client.ts` and echoed on the
   * result, so the client can match a reply to its request and drop stale
   * ones. */
  id: number;
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
