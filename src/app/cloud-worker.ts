/**
 * The live point cloud's actual Web Worker entry point (fr-5kx): thin
 * `self.onmessage` / `postMessage` glue around {@link generateCloud}, which
 * owns all the real logic. Nothing here is unit-tested directly — it is
 * verified by running the app, same as `flame-worker.ts` / `voxel-worker.ts`,
 * whose structure (including the narrowed `self` typing; see
 * `flame-worker.ts`'s doc for why the ambient `webworker` lib can't be used)
 * this mirrors exactly.
 *
 * Unlike those two there is no session object: a generation is a one-shot
 * request → response, and the at-most-one-in-flight policy lives on the main
 * thread (`cloud-generator.ts`), so this handler never sees overlapping
 * requests — each message computes and replies, transferring every per-point
 * buffer (zero-copy ownership move, not a clone).
 */
import { cloudResultTransfers, generateCloud } from "./cloud-worker-core";
import type { CloudRequest, CloudResult } from "./cloud-worker-core";

interface CloudWorkerScope {
  postMessage(message: CloudResult, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<CloudRequest>) => void) | null;
}

const scope = self as unknown as CloudWorkerScope;

scope.onmessage = (event) => {
  const result = generateCloud(event.data);
  scope.postMessage(result, cloudResultTransfers(result));
};
