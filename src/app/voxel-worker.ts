/**
 * The solid render's actual Web Worker entry point (fr-v4f): thin
 * `self.onmessage` / `postMessage` glue around {@link VoxelWorkerSession},
 * which owns all the real logic. Nothing here is unit-tested directly — it
 * is verified by running the app, same as `flame-worker.ts`, whose structure
 * (including the narrowed `self` typing; see that file's doc for why the
 * ambient `webworker` lib can't be used) this mirrors exactly.
 */
import { VoxelWorkerSession } from "./voxel-worker-core";
import type { VoxelWorkerCommand, VoxelWorkerEvent } from "./voxel-worker-core";

interface VoxelWorkerScope {
  postMessage(message: VoxelWorkerEvent, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<VoxelWorkerCommand>) => void) | null;
}

const scope = self as unknown as VoxelWorkerScope;

const session = new VoxelWorkerSession({
  now: () => performance.now(),
  schedule: (fn) => setTimeout(fn, 0),
  emit: (event) => {
    // Transfer the packed texture's backing buffer — a zero-copy ownership
    // move to the main thread, not a copy (`voxelTextureData` allocates a
    // fresh buffer per pack for exactly this reason).
    if (event.type === "grid") {
      scope.postMessage(event, [event.texture.buffer]);
    } else {
      scope.postMessage(event, []);
    }
  },
});

scope.onmessage = (event) => session.handle(event.data);
