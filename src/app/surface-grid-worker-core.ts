/**
 * The surface render's empty-space-skipping grid, worker-side compute
 * (fr-55r5 part 2): one pure function from a {@link SurfaceGridRequest} to a
 * {@link SurfaceGridResult} — `surface-grid.ts`'s own `buildSurfaceGrid`,
 * with the request's `id` carried through so a reply can be matched back to
 * its request. `surface-grid-worker.ts` is the thin
 * `self.onmessage`/`postMessage` glue that runs this inside the real Worker;
 * `surface-grid-client.ts` is the main-thread client that posts requests.
 *
 * Unlike `cloud-worker-core.ts` there is no synchronous-fallback path here:
 * a `64 ** 3` build costs real CPU seconds (see `surface-grid.ts`'s module
 * doc — "~0.5-5s of pure CPU" — hence a dedicated worker in the first
 * place), so running it inline on the main thread on worker failure would
 * freeze the very frame the grid exists to speed up. The grid is a pure
 * ENHANCEMENT of the sphere tracer — correct, just slower, with no grid at
 * all — so `surface-grid-client.ts` degrades to "no grid" instead of ever
 * falling back to a synchronous build; see that module's doc.
 */
import { buildSurfaceGrid } from "../fractal/surface-grid";
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
 * (`surface-grid-worker.ts`) and tests run. Delegates entirely to
 * `surface-grid.ts`'s own `buildSurfaceGrid(de, resolution)` (spec sizing +
 * the one-shot full-cube slab pass), then tags the result with the
 * request's `id`.
 */
export function buildSurfaceGridResult(
  request: SurfaceGridRequest,
): SurfaceGridResult {
  const grid = buildSurfaceGrid(request.de, request.resolution);
  return { id: request.id, ...grid };
}

/**
 * The buffer to move (zero-copy ownership transfer, not clone) when posting
 * `result` to the main thread — `values` is a fresh standalone allocation
 * per build (`buildSurfaceGrid` -> `new Float32Array(...)`), so transferring
 * never detaches memory anything else still holds a view of.
 *
 * The cast narrows `Float32Array.buffer`'s loose `ArrayBufferLike` typing:
 * `buildSurfaceGrid` only ever allocates a plain `ArrayBuffer`, never a
 * SharedArrayBuffer-backed view (same reasoning as
 * `cloud-worker-core.ts`'s `cloudResultTransfers`).
 */
export function surfaceGridResultTransfers(
  result: SurfaceGridResult,
): Transferable[] {
  return [result.values.buffer as ArrayBuffer];
}
