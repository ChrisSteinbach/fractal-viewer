/**
 * The main-thread client for the live point cloud's generation worker
 * (fr-5kx): owns the request/response policy that lets the interactive cloud
 * regenerate off the main thread without ever showing torn or out-of-order
 * results.
 *
 * Policy, in one breath: **at most one request in flight; latest state wins.**
 * A request made while one is computing is not queued — it parks in a single
 * `pending` slot, and each newer request overwrites it (OR-merging the
 * `replaced`/`fit` delivery flags, so a superseded preset load's "fresh
 * visit" resets and camera fit survive into the request that actually runs).
 * When the in-flight result lands, the pending request (if any) is posted
 * immediately, then the result is delivered. Combined with `main.ts`'s rAF
 * coalescer in front (fr-acc), a drag burst degrades gracefully: the cloud
 * updates as fast as one generation takes, showing every result it finishes,
 * always converging on the latest state.
 *
 * Fallback, because the live cloud IS the app (unlike the optional flame/
 * solid overlays, a dead worker here would mean a dead viewer): if the worker
 * can't be created, fails to load (e.g. a stale-deploy 404), or crashes, the
 * generator flips permanently to running {@link CloudGeneratorDeps.computeSync}
 * — the exact same pure `generateCloud` the worker runs — inline on the main
 * thread: fr-acc's coalesced-but-synchronous behavior, jankier but correct.
 * The freshest outstanding request is re-run synchronously at the moment of
 * failure, so a request can never be silently lost to a crash.
 *
 * Everything is injected (worker factory, sync compute, delivery callback),
 * so the whole policy is unit-tested without a real Worker — the same
 * discipline as `edit-session.ts` and `regen-scheduler.ts`.
 */
import type { CloudRequest, CloudResult } from "./cloud-worker-core";

/** What a request looks like before the generator stamps its `id`. */
export type CloudParams = Omit<CloudRequest, "id">;

/** The generator's handle on the real worker — post + terminate, mirroring
 * `render-session.ts`'s `RenderSessionHandle`. */
export interface CloudWorkerHandle {
  post(request: CloudRequest): void;
  /** Tear the worker down. Implementations should detach their message/error
   * handlers first so an already-queued event can't reach a generator that
   * has moved on (same closed gap as the flame worker host's terminate). */
  terminate(): void;
}

export interface CloudGeneratorDeps {
  /**
   * Spawn the generation worker, wiring `onResult`/`onError` to its message/
   * error events. Return `null` (or throw) when workers are unavailable —
   * the generator then runs synchronously from the start. Called once, at
   * construction, so the worker script starts loading during boot and is
   * warm by the first drag. Logging the failure that `onError` reports is
   * the implementation's business (main.ts logs in its onerror wiring, like
   * the flame/voxel hosts), keeping this policy module console-silent.
   */
  createWorker: (
    onResult: (result: CloudResult) => void,
    onError: () => void,
  ) => CloudWorkerHandle | null;
  /** The same pure compute the worker runs (`generateCloud`) — the
   * synchronous fallback, and {@link CloudGenerator.generateSync}'s path. */
  computeSync: (request: CloudRequest) => CloudResult;
  /** Deliver a finished result together with the request that produced it
   * (whose `replaced`/`fit` flags the arrival handler acts on) and the
   * generation's measured latency in ms — post→reply on the worker path,
   * around the compute on the synchronous paths — which feeds the morph's
   * adaptive point budget (`morph-budget.ts`, fr-a5gu). Never called for a
   * result a newer `generateSync` has already superseded. */
  onResult: (
    result: CloudResult,
    request: CloudRequest,
    elapsedMs: number,
  ) => void;
  /** Monotonic clock in ms backing that measurement. Defaults to
   * `performance.now()`; injected by tests. */
  now?: () => number;
}

export class CloudGenerator {
  private readonly deps: CloudGeneratorDeps;
  private readonly now: () => number;
  private worker: CloudWorkerHandle | null = null;
  /** True once the generator has given up on the worker — permanent
   * synchronous mode. Never reset: a worker that failed once (missing chunk,
   * crash) would just fail again. */
  private broken = false;
  private nextId = 1;
  /** The request the worker is computing right now, or null when idle. */
  private inFlight: CloudRequest | null = null;
  /** Clock reading when {@link inFlight} was posted — the start of the
   * latency measurement `onResult` reports. */
  private sentAtMs = 0;
  /** The single latest-wins slot for a request made while one is in flight. */
  private pending: CloudRequest | null = null;
  /** Results with `id` below this were superseded by a `generateSync` and
   * must not be delivered (their arrival still dispatches `pending`). */
  private staleBelowId = 0;
  /** Resolvers for callers awaiting {@link settle}, parked while the
   * generator is not yet fully idle. */
  private settledResolvers: (() => void)[] = [];

  constructor(deps: CloudGeneratorDeps) {
    this.deps = deps;
    this.now = deps.now ?? ((): number => performance.now());
    try {
      this.worker = deps.createWorker(
        (result) => this.handleResult(result),
        () => this.handleError(),
      );
    } catch {
      this.worker = null;
    }
    if (this.worker === null) this.broken = true;
  }

  /** Request a generation of `params`. Latest-wins: see the module doc. */
  request(params: CloudParams): void {
    const request: CloudRequest = { ...params, id: this.nextId++ };
    if (this.broken) {
      this.computeAndDeliver(request);
      return;
    }
    if (this.inFlight !== null) {
      this.pending =
        this.pending === null
          ? request
          : {
              ...request,
              replaced: this.pending.replaced || request.replaced,
              fit: this.pending.fit || request.fit,
            };
      return;
    }
    this.send(request);
  }

  /**
   * Generate and deliver synchronously, on the main thread, even when the
   * worker is healthy — the boot path, so the first paint still includes the
   * cloud (and `npm run smoke`'s timing is untouched) instead of flashing an
   * empty backdrop for a worker round-trip. Anything outstanding was built
   * from OLDER state than this call snapshots, so it is superseded whole:
   * the parked pending request (if any) is dropped rather than pointlessly
   * computed, and the in-flight result's eventual delivery is suppressed.
   */
  generateSync(params: CloudParams): void {
    const request: CloudRequest = { ...params, id: this.nextId++ };
    this.staleBelowId = request.id;
    this.pending = null;
    this.computeAndDeliver(request);
  }

  /**
   * Resolves once the generator is fully drained: no request in flight,
   * nothing parked in `pending`, and every settled result already
   * delivered via `onResult` — not merely posted. Resolves immediately
   * when already idle, including permanent synchronous-fallback mode,
   * where every `request()` computes and delivers inline before
   * returning. The offline frame-exact video export (fr-92t9) awaits this
   * between issuing a frame's generation request and rendering/encoding
   * that frame, so each exported frame shows exactly its own sample
   * rather than a stale or still-computing one. Multiple concurrent
   * callers all resolve together.
   */
  settle(): Promise<void> {
    if (this.inFlight === null && this.pending === null) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.settledResolvers.push(() => resolve());
    });
  }

  /** Run `request` through the synchronous compute and deliver it, timing
   * the compute for `onResult`'s latency report. */
  private computeAndDeliver(request: CloudRequest): void {
    const startedAtMs = this.now();
    const result = this.deps.computeSync(request);
    this.deps.onResult(result, request, this.now() - startedAtMs);
    this.flushSettled();
  }

  private send(request: CloudRequest): void {
    this.inFlight = request;
    this.sentAtMs = this.now();
    this.worker?.post(request);
  }

  private handleResult(result: CloudResult): void {
    const request = this.inFlight;
    // Only the reply to the in-flight request counts; anything else is a
    // stray from a torn-down state and is dropped (belt-and-braces — the
    // at-most-one-in-flight policy means it shouldn't occur).
    if (request === null || result.id !== request.id) return;
    // Read the latency before posting the successor — send() restamps the
    // measurement start for the next request.
    const elapsedMs = this.now() - this.sentAtMs;
    this.inFlight = null;
    const next = this.pending;
    this.pending = null;
    // Post the successor BEFORE delivering: the worker starts on the newer
    // request while the main thread uploads this result.
    if (next !== null) this.send(next);
    if (result.id >= this.staleBelowId) {
      this.deps.onResult(result, request, elapsedMs);
    }
    // If next !== null, inFlight is that successor and the generator is
    // NOT idle — flushSettled correctly leaves settle() waiters parked
    // until the successor's own arrival flushes again.
    this.flushSettled();
  }

  private handleError(): void {
    if (this.broken) return; // already fallen back; a second event changes nothing.
    this.broken = true;
    const worker = this.worker;
    this.worker = null;
    worker?.terminate();
    // The freshest outstanding request still deserves its cloud — run it
    // here, now. (pending is by construction newer than inFlight.)
    const latest = this.pending ?? this.inFlight;
    this.inFlight = null;
    this.pending = null;
    if (latest !== null) {
      this.computeAndDeliver(latest); // also flushes settle() waiters
    }
    this.flushSettled();
  }

  /** Resolve and clear every {@link settle} waiter, if the generator has
   * just become fully idle. Called from the end of every method that can
   * leave it idle: `handleResult` (after posting any parked successor —
   * see the comment there), `computeAndDeliver` (the broken-mode
   * `request()` path and `generateSync`, the latter of which can leave a
   * stale worker request in flight, in which case this correctly leaves
   * waiters parked for that request's own arrival), and `handleError`
   * (covers the case where an error arrives with nothing outstanding to
   * re-run, so `computeAndDeliver` never fires). Redundant calls are
   * harmless — idle is idle, and an empty waiter list is a no-op. */
  private flushSettled(): void {
    if (this.inFlight !== null || this.pending !== null) return;
    const resolvers = this.settledResolvers;
    this.settledResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}
