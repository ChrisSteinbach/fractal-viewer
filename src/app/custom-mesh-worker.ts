/** Dedicated terminating worker for strict OBJ validation and SDF baking. */
import {
  customMeshImportFailure,
  customMeshImportTransfers,
  prepareCustomMeshWorkerRequest,
  type CustomMeshImportResponse,
  type CustomMeshWorkerRequest,
} from "./custom-mesh-worker-core";

interface CustomMeshWorkerScope {
  postMessage(
    message: CustomMeshImportResponse,
    transfer?: Transferable[],
  ): void;
  onmessage: ((event: MessageEvent<CustomMeshWorkerRequest>) => void) | null;
}

const scope = self as unknown as CustomMeshWorkerScope;

scope.onmessage = (event): void => {
  const jobId = Number.isSafeInteger(event.data?.jobId) ? event.data.jobId : -1;
  void prepareCustomMeshWorkerRequest(event.data)
    .then((result) => {
      scope.postMessage(result, customMeshImportTransfers(result));
    })
    .catch((error: unknown) => {
      const response: CustomMeshImportResponse = customMeshImportFailure(
        jobId,
        error,
      );
      scope.postMessage(response);
    });
};

export {};
