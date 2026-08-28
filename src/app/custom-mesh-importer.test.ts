import {
  CustomMeshImportCancelledError,
  importCustomMeshObj,
  type CustomMeshWorkerLike,
} from "./custom-mesh-importer";
import type {
  CustomMeshImportRequest,
  CustomMeshImportResponse,
} from "./custom-mesh-worker-core";

class FakeWorker implements CustomMeshWorkerLike {
  onmessage: ((event: MessageEvent<CustomMeshImportResponse>) => void) | null =
    null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  request: CustomMeshImportRequest | null = null;
  terminated = false;

  postMessage(message: CustomMeshImportRequest): void {
    this.request = message;
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("custom mesh importer", () => {
  it("routes the matching worker response and terminates the job", async () => {
    const worker = new FakeWorker();
    const job = importCustomMeshObj("mesh", "mesh.obj", () => worker);
    expect(worker.request).toMatchObject({
      type: "import",
      source: "mesh",
      fileName: "mesh.obj",
    });
    const jobId = worker.request!.jobId;
    worker.onmessage?.(
      new MessageEvent("message", {
        data: {
          type: "error",
          jobId,
          message: "invalid mesh",
        },
      }),
    );
    await expect(job.promise).rejects.toThrow("invalid mesh");
    expect(worker.terminated).toBe(true);
  });

  it("terminates synchronous worker work and rejects on cancellation", async () => {
    const worker = new FakeWorker();
    const job = importCustomMeshObj("mesh", "mesh.obj", () => worker);
    job.cancel();
    await expect(job.promise).rejects.toBeInstanceOf(
      CustomMeshImportCancelledError,
    );
    expect(worker.terminated).toBe(true);
  });

  it("ignores stale response ids", () => {
    const worker = new FakeWorker();
    const job = importCustomMeshObj("mesh", "mesh.obj", () => worker);
    worker.onmessage?.(
      new MessageEvent("message", {
        data: { type: "error", jobId: -1, message: "stale" },
      }),
    );
    expect(worker.terminated).toBe(false);
    job.cancel();
    void job.promise.catch(() => undefined);
  });
});
