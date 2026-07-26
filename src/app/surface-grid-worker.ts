/**
 * The surface render's empty-space-skipping grid worker entry point
 * (fr-55r5 part 2): thin `self.onmessage`/`postMessage` glue around
 * {@link buildSurfaceGridResult}, which owns all the real logic. Nothing
 * here is unit-tested directly — it is verified by running the app, same as
 * `cloud-worker.ts` / `flame-worker.ts` / `voxel-worker.ts`, whose structure
 * (including the narrowed `self` typing; see `flame-worker.ts`'s doc for why
 * the ambient `webworker` lib can't be used) this mirrors exactly.
 *
 * Unlike the flame/voxel sessions there is no session object: a grid build
 * is a one-shot request -> response, and the at-most-one-outstanding/
 * latest-wins policy lives on the main thread (`surface-grid-client.ts`), so
 * this handler never needs to track more than the single message it is
 * currently handling — each message computes and replies, transferring the
 * built `values` buffer (zero-copy ownership move, not a clone).
 */
import {
  buildSurfaceGridResult,
  surfaceGridResultTransfers,
} from "./surface-grid-worker-core";
import type {
  SurfaceGridRequest,
  SurfaceGridResult,
} from "./surface-grid-worker-core";

interface SurfaceGridWorkerScope {
  postMessage(message: SurfaceGridResult, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<SurfaceGridRequest>) => void) | null;
}

const scope = self as unknown as SurfaceGridWorkerScope;

scope.onmessage = (event) => {
  const result = buildSurfaceGridResult(event.data);
  scope.postMessage(result, surfaceGridResultTransfers(result));
};
