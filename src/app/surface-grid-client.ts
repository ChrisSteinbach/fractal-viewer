/**
 * The main-thread client for the surface render's empty-space-skipping grid
 * worker: owns the one-shot, latest-wins request policy that keeps a grid
 * build off the main thread without ever delivering a torn or stale result.
 *
 * Policy, in one breath: **at most one worker; latest request wins.** Unlike
 * `cloud-generator.ts`'s live point cloud, a request made while one is
 * already outstanding is not parked in a pending slot at all — it is posted
 * immediately (the worker's own mailbox serializes them: a synchronous
 * `onmessage` handler blocks the worker's event loop until it returns, so
 * two posts in flight are simply computed one after another, in order).
 * Every reply is checked against the id of the LATEST request: a reply to a
 * build that a newer request superseded before it finished arrives, matches
 * nothing, and is dropped silently — {@link SurfaceGridClient.busy} and
 * {@link SurfaceGridClient.settle} track only the latest id, never the
 * superseded ones.
 *
 * Fallback is the opposite of `cloud-generator.ts`'s. The live cloud IS the
 * app, so `CloudGenerator` falls back to a synchronous main-thread compute
 * when its worker dies. The grid is a pure ENHANCEMENT of the sphere tracer
 * — a cheap lower bound that lets a march skip empty space; the tracer is
 * fully correct, just slower, with no grid at all. A build costs real CPU
 * seconds (`surface-grid.ts`'s module doc), so running one inline on worker
 * failure would freeze the very frame the grid exists to speed up. So on any
 * failure — construction throwing/declining, or a runtime `onerror` — this
 * client drops the outstanding request and simply goes without a grid,
 * rather than ever computing one synchronously. Nothing is retried on a
 * timer; the render just stays gridless until a later `request()` (the next
 * scene edit, say) manages to stand up a fresh worker.
 *
 * Spawned lazily, on the first `request()`, unlike `cloud-generator.ts`'s
 * eager-at-construction worker: a grid is only useful once the surface
 * render is active and its system has settled, so there is no reason to pay
 * for a worker boot before it is first needed.
 */
import { SURFACE_GRID_RESOLUTION } from "../fractal/surface-grid";
import type { SurfaceGrid } from "../fractal/surface-grid";
import type { SurfaceDE } from "../fractal/surface-de";
import type {
  SerializedMeshSdfBake,
  SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";
import type {
  SurfaceGridRequest,
  SurfaceGridResult,
} from "./surface-grid-worker-core";

/** The client's handle on the real worker — post + terminate, mirroring
 * `cloud-generator.ts`'s `CloudWorkerHandle`. */
export interface SurfaceGridWorkerHandle {
  post(request: SurfaceGridRequest): void;
  /** Tear the worker down. Implementations should detach their message/
   * error handlers first so an already-queued event can't reach a client
   * that has moved on (same closed gap as `CloudWorkerHandle.terminate`). */
  terminate(): void;
}

export interface SurfaceGridClientDeps {
  /**
   * Spawn the grid worker, wiring `onResult`/`onError` to its message/error
   * events, and return the resulting handle — `null` (or a thrown error)
   * when workers are unavailable, exactly like `cloud-generator.ts`'s
   * `CloudGeneratorDeps.createWorker`. That is the house shape this
   * mirrors: the raw callbacks are threaded through `createWorker` itself,
   * rather than the handle exposing settable `onResult`/`onError`
   * properties. One difference from `CloudGeneratorDeps`: `onError` here
   * carries the error value, since (unlike `CloudGenerator`, which never
   * surfaces a worker failure outward) this client relays it to
   * {@link SurfaceGridClientDeps.onError}.
   *
   * The real implementation (main.ts) wraps `new Worker(new URL(
   * "./surface-grid-worker.ts", import.meta.url), { type: "module" })`; the
   * client itself never touches `Worker` directly, so tests inject a fake
   * handle. Called lazily — on the first `request()`, never at construction
   * (see the module doc) — and again after `dispose()` or a worker error
   * has forgotten the handle.
   */
  createWorker: (
    onResult: (result: SurfaceGridResult) => void,
    onError: (error: unknown) => void,
  ) => SurfaceGridWorkerHandle | null;
  /** Delivers a finished build — called ONLY for the request that is
   * current at the moment its result arrives (see the module doc's
   * latest-wins policy), with the id already stripped down to the plain
   * `{ resolution, halfExtent, values }` grid. `resolution`/`halfExtent`
   * here are what the worker actually built, which may be
   * coarser than requested (see {@link SurfaceGridClient.request}) — this
   * is the authoritative shape, not the request. */
  onGrid: (grid: SurfaceGrid) => void;
  /** Worker construction failure or a runtime crash — purely informational:
   * by the time this fires the client has already dropped the outstanding
   * request and gone idle again (see the module doc's fallback). */
  onError?: (error: unknown) => void;
}

export class SurfaceGridClient {
  private readonly deps: SurfaceGridClientDeps;
  private worker: SurfaceGridWorkerHandle | null = null;
  private nextId = 1;
  /** The id of the request whose result is still awaited, or `null` when
   * idle — nothing has been requested yet, the last result already arrived,
   * or the outstanding request was dropped by `cancel()`/a worker error.
   * Replies arrive in order (see the module doc), so an exact-match check
   * against this single id is enough to identify a stale one — no need to
   * track a threshold the way `cloud-generator.ts` does for its
   * `generateSync` supersession. */
  private outstandingId: number | null = null;
  /** Resolvers for callers awaiting {@link settle}, parked while a request
   * is outstanding. */
  private settledResolvers: (() => void)[] = [];

  constructor(deps: SurfaceGridClientDeps) {
    this.deps = deps;
  }

  /**
   * Request a grid build for `de` at `resolution` (default
   * `SURFACE_GRID_RESOLUTION`). Spawns the worker lazily on first use.
   * Supersedes any outstanding request — if that older request's reply
   * still arrives, it carries a stale id and is dropped, per the module doc
   * — and is posted immediately regardless of whether a previous request is
   * still being computed (no client-side queueing; the worker's own mailbox
   * serializes the posts). Silently does nothing if no worker is available
   * (creation failed or declined): see the module doc's graceful
   * degradation.
   *
   * `resolution` is a CEILING, not a promise: a fold system's build can
   * cost up to ~40x an affine one at the same resolution, so the worker
   * times a measured pilot slab first and may downshift to a coarser grid
   * to stay under its build-time budget (`surface-grid.ts`'s
   * `pickSurfaceGridResolution`). The delivered grid's own
   * `resolution`/`halfExtent` (see {@link SurfaceGridClientDeps.onGrid})
   * reflect what was actually built and are the authoritative values —
   * never the `resolution` passed here.
   */
  request(
    de: SurfaceDE,
    resolution: number = SURFACE_GRID_RESOLUTION,
    meshAssets?: readonly SerializedPreparedMeshAsset[],
    meshBakes?: readonly SerializedMeshSdfBake[],
  ): void {
    if (this.worker === null) this.worker = this.spawnWorker();
    if (this.worker === null) return;
    const id = this.nextId++;
    this.outstandingId = id;
    this.worker.post({
      id,
      de,
      resolution,
      ...(meshAssets === undefined ? {} : { meshAssets }),
      ...(meshBakes === undefined ? {} : { meshBakes }),
    });
  }

  /**
   * Forget the outstanding request, if any. The worker is NOT terminated —
   * it may already be computing, and is left to finish — but its eventual
   * reply will match no outstanding id and be dropped on arrival. Resolves
   * any parked {@link settle} waiters immediately, since the client is idle
   * again by definition. A no-op when already idle.
   */
  cancel(): void {
    this.outstandingId = null;
    this.flushSettled();
  }

  /**
   * Resolves once no request is outstanding — immediately if already idle.
   * The offline frame-exact exporter can await this so a captured frame's
   * grid, if one lands in time, is included deterministically — the same
   * job `CloudGenerator.settle` does for the point cloud. Multiple
   * concurrent callers all resolve together.
   */
  settle(): Promise<void> {
    if (this.outstandingId === null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.settledResolvers.push(resolve);
    });
  }

  /** Terminate the worker (if any) and go idle. Further {@link request}
   * calls respawn a fresh one. */
  dispose(): void {
    const worker = this.worker;
    this.worker = null;
    this.outstandingId = null;
    worker?.terminate();
    this.flushSettled();
  }

  /** True while a request's result is still awaited. */
  get busy(): boolean {
    return this.outstandingId !== null;
  }

  /** Ask `deps` for a worker, wiring its replies back to this client's own
   * handlers. Failure (a thrown construction error, or a declined `null`)
   * is swallowed here — see the module doc's graceful degradation — after
   * relaying whatever error value is available to `deps.onError`. */
  private spawnWorker(): SurfaceGridWorkerHandle | null {
    try {
      return this.deps.createWorker(
        (result) => this.handleResult(result),
        (error) => this.handleError(error),
      );
    } catch (error) {
      this.deps.onError?.(error);
      return null;
    }
  }

  private handleResult(result: SurfaceGridResult): void {
    if (result.id !== this.outstandingId) return; // stale or cancelled
    this.outstandingId = null;
    this.deps.onGrid({
      resolution: result.resolution,
      halfExtent: result.halfExtent,
      values: result.values,
    });
    this.flushSettled();
  }

  private handleError(error: unknown): void {
    const worker = this.worker;
    this.worker = null;
    this.outstandingId = null;
    worker?.terminate();
    this.deps.onError?.(error);
    this.flushSettled();
  }

  /** Resolve and clear every {@link settle} waiter, if the client has just
   * become idle. Called from the end of every method that can leave it
   * idle. Redundant calls are harmless. */
  private flushSettled(): void {
    if (this.outstandingId !== null) return;
    const resolvers = this.settledResolvers;
    this.settledResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}
