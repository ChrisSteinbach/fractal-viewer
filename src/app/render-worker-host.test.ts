import {
  createRenderWorkerHost,
  type RenderWorkerLike,
} from "./render-worker-host";

class FakeWorker implements RenderWorkerLike<string, string> {
  onmessage: ((event: MessageEvent<string>) => unknown) | null = null;
  onerror: ((event: ErrorEvent) => unknown) | null = null;
  readonly posted: string[] = [];
  terminateCount = 0;
  handlersAtTerminate:
    | { message: FakeWorker["onmessage"]; error: FakeWorker["onerror"] }
    | undefined;

  postMessage(command: string): void {
    this.posted.push(command);
  }

  terminate(): void {
    this.handlersAtTerminate = {
      message: this.onmessage,
      error: this.onerror,
    };
    this.terminateCount++;
  }

  deliver(value: string): void {
    this.onmessage?.({ data: value } as MessageEvent<string>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

describe("createRenderWorkerHost", () => {
  it("forwards commands and live events through the Worker-like handle", () => {
    const worker = new FakeWorker();
    const events: string[] = [];
    const errors: string[] = [];
    const host = createRenderWorkerHost(
      worker,
      (event) => events.push(event),
      (error) => errors.push(error.message),
    );

    host.post("start");
    worker.deliver("grid");
    worker.fail("boom");

    expect(worker.posted).toEqual(["start"]);
    expect(events).toEqual(["grid"]);
    expect(errors).toEqual(["boom"]);
  });

  it("makes captured callbacks from a terminated worker inert after re-entry", () => {
    const oldWorker = new FakeWorker();
    const newWorker = new FakeWorker();
    const events: string[] = [];
    const errors: string[] = [];
    const oldHost = createRenderWorkerHost(
      oldWorker,
      (event) => events.push(`old:${event}`),
      (error) => errors.push(`old:${error.message}`),
    );
    // Model callbacks captured by a MessageEvent/ErrorEvent already queued on
    // the main thread before RenderSession re-entry tears this host down.
    const queuedMessage = oldWorker.onmessage!;
    const queuedError = oldWorker.onerror!;

    oldHost.terminate();
    createRenderWorkerHost(
      newWorker,
      (event) => events.push(`new:${event}`),
      (error) => errors.push(`new:${error.message}`),
    );

    expect(oldWorker.onmessage).toBeNull();
    expect(oldWorker.onerror).toBeNull();
    expect(oldWorker.handlersAtTerminate).toEqual({
      message: null,
      error: null,
    });
    expect(oldWorker.terminateCount).toBe(1);

    queuedMessage({ data: "stale-grid" } as MessageEvent<string>);
    queuedError({ message: "stale-error" } as ErrorEvent);
    oldWorker.deliver("also-stale");
    oldWorker.fail("also-stale");
    newWorker.deliver("grid");
    newWorker.fail("boom");

    expect(events).toEqual(["new:grid"]);
    expect(errors).toEqual(["new:boom"]);
  });
});
