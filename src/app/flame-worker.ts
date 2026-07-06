/**
 * The flame render's actual Web Worker entry point (fr-73y): thin
 * `self.onmessage` / `postMessage` glue around {@link FlameWorkerSession},
 * which owns all the real logic (see that module's doc). Nothing here is
 * unit-tested directly — it is verified by running the app, same as
 * `main.ts`/`interactions.ts` — since it is just wiring the session to the
 * real worker globals `flame-worker-core.ts` is deliberately kept free of.
 *
 * Bundling: Vite's standard worker pattern (`new Worker(new URL(...,
 * import.meta.url), { type: "module" })` in `main.ts`) picks this file up
 * automatically as its own chunk — no vite.config change needed (verified
 * against the pinned Vite version during fr-73y's design).
 *
 * `self` is deliberately NOT typed via the ambient `webworker` lib: this
 * project's tsconfig has no explicit `lib`, so (per `target: ES2022`) it
 * defaults to including `DOM` for the main-thread app code, and `DOM` +
 * `webworker` cannot both be active in one TypeScript program (they declare
 * conflicting globals, `self` among them). Rather than split the project
 * into two tsconfigs for this one file, `self` is narrowed to just the
 * handful of members this file actually needs — true at runtime because
 * this module only ever runs inside a real Worker.
 */
import { FlameWorkerSession } from "./flame-worker-core";
import type { FlameWorkerCommand, FlameWorkerEvent } from "./flame-worker-core";
import { createGpuFlameBackend } from "./flame-gpu-backend";

interface FlameWorkerScope {
  postMessage(message: FlameWorkerEvent, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<FlameWorkerCommand>) => void) | null;
}

const scope = self as unknown as FlameWorkerScope;

const session = new FlameWorkerSession({
  now: () => performance.now(),
  schedule: (fn) => setTimeout(fn, 0),
  emit: (event) => {
    // Transfer-mode "progress" carries a whole RGBA frame: move its backing
    // buffer (zero-copy ownership transfer) rather than cloning it. Every
    // other event — including shared-mode's "sharedFrame", whose frame
    // already lives in SharedArrayBuffer-backed memory both threads see —
    // is scalars only, with nothing worth transferring (see
    // flame-worker-core's doc for the two transports).
    if (event.type === "progress") {
      scope.postMessage(event, [event.image.buffer]);
    } else {
      scope.postMessage(event, []);
    }
  },
  // WebGPU accumulation (fr-npb): wiring this factory up is what actually
  // gates the session's GPU attempt — a `start` command's `gpuPreference`
  // alone does nothing without it (see FlameWorkerDeps.createGpuBackend's
  // doc). Real WebGPU calls live entirely in flame-gpu-backend.ts, kept
  // separate from this thin glue file for the same reason flame-worker-core
  // stays free of `self`/`postMessage`: plain-Vitest testability.
  createGpuBackend: createGpuFlameBackend,
  log: (message) => console.info(message),
});

scope.onmessage = (event) => session.handle(event.data);
