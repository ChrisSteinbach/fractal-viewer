/**
 * Hosts a {@link FlameWorkerSession} on the MAIN thread instead of inside a
 * dedicated Worker (fr-1ib) — the same command/event surface `main.ts` uses
 * for a real flame `Worker` (see {@link FlameSessionHost}), so
 * `enterFlameMode` can swap between the two with no other change to
 * `postFlame`/`handleFlameEvent`/`exitFlameMode`.
 *
 * Exists because of a real-world WebGPU gap: Firefox 152 exposes
 * `navigator.gpu` on the main thread but NOT inside dedicated workers (see
 * {@link probeWorkerWebGpu}, which is how `main.ts` finds this out). On a
 * machine whose ONLY WebGPU-capable context is the main thread — the
 * fastest one measured during fr-npb's benchmarking, an RX 7900 XTX — the
 * production flame render would otherwise always fall back to CPU
 * accumulation, because `flame-worker.ts`'s `createGpuFlameBackend` factory
 * runs inside the (GPU-less-in-this-browser) flame worker. Hosting the
 * session here instead lets it reach the SAME `createGpuFlameBackend`
 * factory, now running somewhere WebGPU actually works.
 *
 * `FlameWorkerSession` itself has no idea which thread it runs on — it was
 * built (fr-73y) specifically so worker globals (`self`, `postMessage`,
 * `performance`, `setTimeout`) are all INJECTED, never referenced directly
 * (see that module's doc) — so this file is barely more than
 * `flame-worker.ts` restated with real main-thread globals in place of
 * worker ones, plus the `terminate`-equivalent cleanup a real `Worker` gets
 * for free from the browser and a same-thread session has to do by hand
 * (see `dispose`'s doc on `FlameWorkerSession`).
 */
import { FlameWorkerSession } from "./flame-worker-core";
import type {
  FlameWorkerCommand,
  FlameWorkerDeps,
  FlameWorkerEvent,
} from "./flame-worker-core";
import { createGpuFlameBackend } from "./flame-gpu-backend";

/**
 * The same surface `main.ts` drives a real flame `Worker` through
 * (`post` ~ `worker.postMessage`, `terminate` ~ `worker.terminate`) — see
 * {@link createLocalFlameSessionHost}'s doc for why a second implementation
 * of it exists.
 */
export interface FlameSessionHost {
  post(command: FlameWorkerCommand): void;
  terminate(): void;
}

/**
 * Host a {@link FlameWorkerSession} on the CALLING thread (the main thread,
 * in production). `onEvent` fires for every event the session emits,
 * ASYNCHRONOUSLY — never from inside `post()`'s own call stack; see the
 * `emit` deps field below for why.
 *
 * `depsOverride` is internal/test-only (production callers never pass it):
 * it lets `flame-session-host.test.ts` substitute the same fake
 * scheduler/clock/backend `flame-worker-core.test.ts` already uses, in
 * place of the real `performance.now`/`setTimeout`/GPU-backend factory
 * below, so THIS module's own routing/timing/disposal glue is exercised
 * without a real browser or GPU. Applied last (spread after the real
 * defaults), so a test can override exactly the fields it needs.
 */
export function createLocalFlameSessionHost(
  onEvent: (event: FlameWorkerEvent) => void,
  depsOverride?: Partial<FlameWorkerDeps>,
): FlameSessionHost {
  let closed = false;
  const session = new FlameWorkerSession({
    now: () => performance.now(),
    schedule: (fn) => setTimeout(fn, 0),
    // Deliberately decoupled via queueMicrotask, not a direct call — a real
    // Worker's postMessage is ALWAYS asynchronous too, and `onEvent` can
    // react to an event by posting a new command right back into this same
    // host (main.ts's live tone-map handlers do exactly this on every
    // "progress"/"sharedFrame") or by tearing this host down entirely.
    // Either happening SYNCHRONOUSLY from inside the session's own `emit`
    // call — mid-`handle`, mid-`runChunk` — would be a reentrancy hazard a
    // real cross-thread postMessage can never have (the session and its
    // caller are never on the same call stack there). The `closed` check
    // inside the microtask callback (not just in `post`) covers an event
    // that was already queued the instant before `terminate()` ran.
    emit: (event) => {
      queueMicrotask(() => {
        if (!closed) onEvent(event);
      });
    },
    createGpuBackend: createGpuFlameBackend,
    log: (message) => console.info(message),
    ...depsOverride,
  });

  return {
    post(command) {
      if (closed) return;
      session.handle(command);
    },
    terminate() {
      closed = true;
      // Releases the GPU backend's device/buffers now — a real Worker's
      // terminate() reclaims everything (including any in-flight GPU
      // dispatch's JS-side bookkeeping) by killing the whole thread; a
      // same-thread session has no such hammer, so this is the explicit
      // stand-in. Can't cancel work already queued ON the GPU itself
      // (neither can a terminated worker's in-flight dispatch be recalled),
      // but nothing further will ever run this session's loop again — see
      // FlameWorkerSession.dispose's doc.
      session.dispose();
    },
  };
}

/** How long {@link probeWorkerWebGpu} waits for the probe worker to report
 * back before giving up and assuming no WebGPU — generous for a probe this
 * cheap (spawn a worker, request an adapter), but finite so a hung or
 * never-resolving probe (a misbehaving driver, a browser bug) can't block
 * `main.ts`'s boot sequence forever. */
const PROBE_TIMEOUT_MS = 5000;

/**
 * Probe whether WORKERS on this browser actually have usable WebGPU — not
 * just `navigator.gpu`'s presence, but a REAL adapter: a worker where
 * `requestAdapter()` resolves `null` is exactly as useless for fr-npb's
 * purposes as one with no `navigator.gpu` at all (see `flame-gpu-
 * backend.ts`'s `createGpuFlameBackend`, which treats both identically).
 *
 * Spawns a tiny classic (non-module) Worker from a Blob URL — no bundler
 * entry point needed for a probe this small — whose entire body reports one
 * boolean back and is torn down either way (success, failure, or timeout).
 * Never rejects: resolves `false` on any error, a `false`-report, or a
 * {@link PROBE_TIMEOUT_MS} timeout, so callers can `.then` this directly
 * with no `.catch` needed.
 */
export function probeWorkerWebGpu(): Promise<boolean> {
  return new Promise((resolve) => {
    const code = `(async () => {
      let ok = false;
      try {
        ok = !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
      } catch {
        // ok stays false.
      }
      postMessage(ok);
    })();`;
    const blob = new Blob([code], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timeoutId = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<boolean>) => finish(event.data);
    worker.onerror = () => finish(false);
  });
}
