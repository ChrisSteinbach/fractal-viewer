/** Main-thread lifetime wrapper for the terminating custom-mesh worker. */
import type {
  CustomMeshImportResponse,
  CustomMeshImportSuccess,
  CustomMeshWorkerRequest,
} from "./custom-mesh-worker-core";
import type {
  SerializedMeshSdfBake,
  SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";

export interface CustomMeshWorkerLike {
  onmessage: ((event: MessageEvent<CustomMeshImportResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: CustomMeshWorkerRequest): void;
  terminate(): void;
}

export type CustomMeshWorkerFactory = () => CustomMeshWorkerLike;

function browserWorkerFactory(): CustomMeshWorkerLike {
  return new Worker(new URL("./custom-mesh-worker.ts", import.meta.url), {
    type: "module",
  });
}

export class CustomMeshImportCancelledError extends Error {
  constructor() {
    super("Custom mesh import cancelled");
    this.name = "CustomMeshImportCancelledError";
  }
}

export interface CustomMeshImportJob {
  readonly promise: Promise<CustomMeshImportSuccess>;
  cancel(): void;
}

let nextJobId = 1;

function runCustomMeshWorker(
  makeRequest: (jobId: number) => CustomMeshWorkerRequest,
  workerFactory: CustomMeshWorkerFactory,
): CustomMeshImportJob {
  const worker = workerFactory();
  const jobId = nextJobId++;
  let settled = false;
  let rejectJob: (reason: unknown) => void = () => undefined;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    worker.terminate();
  };
  const promise = new Promise<CustomMeshImportSuccess>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = (event): void => {
      if (settled || event.data.jobId !== jobId) return;
      finish();
      if (event.data.type === "result") resolve(event.data);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event): void => {
      if (settled) return;
      finish();
      reject(new Error(event.message || "Custom mesh worker failed"));
    };
    try {
      worker.postMessage(makeRequest(jobId));
    } catch (error) {
      finish();
      reject(
        error instanceof Error
          ? error
          : new Error("Custom mesh worker request failed", { cause: error }),
      );
    }
  });
  return {
    promise,
    cancel(): void {
      if (settled) return;
      finish();
      rejectJob(new CustomMeshImportCancelledError());
    },
  };
}

/** Start one isolated import. Cancellation terminates the worker, which is the
 * only reliable way to interrupt synchronous topology checks/SDF slices. */
export function importCustomMeshObj(
  source: string,
  fileName: string,
  workerFactory: CustomMeshWorkerFactory = browserWorkerFactory,
): CustomMeshImportJob {
  return runCustomMeshWorker(
    (jobId) => ({ type: "import", jobId, source, fileName }),
    workerFactory,
  );
}

export function validateCustomMeshCache(
  source: SerializedPreparedMeshAsset,
  bake: SerializedMeshSdfBake,
  workerFactory: CustomMeshWorkerFactory = browserWorkerFactory,
): CustomMeshImportJob {
  return runCustomMeshWorker(
    (jobId) => ({ type: "hydrate", jobId, source, bake }),
    workerFactory,
  );
}

export function rebakeCustomMeshSource(
  source: SerializedPreparedMeshAsset,
  resolution: number,
  workerFactory: CustomMeshWorkerFactory = browserWorkerFactory,
): CustomMeshImportJob {
  return runCustomMeshWorker(
    (jobId) => ({ type: "bake", jobId, source, resolution }),
    workerFactory,
  );
}
