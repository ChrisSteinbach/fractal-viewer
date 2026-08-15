/**
 * Pins `GpuFlameBackend`'s deferred-teardown state machine (fr-mxkk): a
 * `destroy()` call while an op is parked on live submitted GPU work must not
 * touch the device until that op unwinds, must never explicitly destroy a
 * buffer (the device reclaims them), and must still refuse new work the
 * instant teardown is requested. See that class's own doc for why this file
 * exists — a fake GPUDevice/GPUBuffer pair is the only way to drive a state
 * machine whose real inputs are a GPU driver's timing.
 */
import { GpuFlameBackend } from "./flame-gpu-backend";
import { createFlameHistogram } from "../fractal/flame";

// `GPUMapMode` is a real runtime global in a browser/WebGPU context, not just
// the compile-time ambient type `@webgpu/types` declares — `snapshot()`/
// `snapshotDisplay()` read `GPUMapMode.READ` directly, mirroring the real
// WebGPU API. Node has no such global, so a plain Node test run needs the
// same minimal stand-in a browser provides for free (values match the WebGPU
// spec's own flag bits; nothing here reads them besides passing them through
// to this file's fake `mapAsync`, which ignores its arguments entirely).
globalThis.GPUMapMode = { READ: 0x0001, WRITE: 0x0002 };

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

/** A promise a test can settle on its own schedule, independent of when the
 * class under test actually awaits it — the primitive both the fake queue's
 * `onSubmittedWorkDone` and the fake staging buffers' `mapAsync` are built
 * from. */
function deferred(): {
  promise: Promise<undefined>;
  resolve: () => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<undefined>((res, rej) => {
    resolve = () => res(undefined);
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Resolves after a real macrotask boundary, by which point every microtask
 * queued so far has fully drained — mirrors flame-worker-core.test.ts's
 * helper of the same name and rationale (a fake GPU promise chain may take
 * more than one internal `await` to reach its parked point). */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A fake GPUBuffer. `mapAsync` defaults to a promise that never settles —
 * fine for the three buffers (params/hist/display) this class never calls
 * `mapAsync` on directly — overridable for the two staging buffers a test
 * needs to park and later resolve/reject. `getMappedRange` returns a real,
 * 4-byte-aligned `ArrayBuffer` since the class immediately wraps it in a
 * `Uint32Array`/`Float32Array` view. `destroy` is a spy: the fix under test
 * (fr-mxkk) means production code must never call it — every buffer-destroy
 * assertion in this file reads this spy. */
function createFakeBuffer(
  mapAsync: () => Promise<undefined> = () => new Promise(() => {}),
): { buffer: GPUBuffer; destroy: ReturnType<typeof vi.fn> } {
  const destroy = vi.fn();
  const buffer = {
    mapAsync,
    getMappedRange: () => new ArrayBuffer(64),
    unmap: () => {},
    destroy,
  } as unknown as GPUBuffer;
  return { buffer, destroy };
}

interface Harness {
  backend: GpuFlameBackend;
  /** Spy on the fake device's own `destroy()` — the one call the whole
   * fr-mxkk state machine exists to time correctly. */
  deviceDestroy: ReturnType<typeof vi.fn>;
  /** Spy on the fake queue's `submit()` — lets a test prove a refused op
   * never reached the GPU at all, not just that it rejected. */
  submit: ReturnType<typeof vi.fn>;
  /** One destroy spy per fake buffer the backend holds (params, hist,
   * staging, display, displayStaging) — see `GpuFlameBackendInit`'s doc for
   * why it's exactly these five. */
  bufferDestroys: ReturnType<typeof vi.fn>[];
  /** Settles `accumulate()`'s parked `queue.onSubmittedWorkDone()`. */
  resolveWork: () => void;
  rejectWork: (reason: unknown) => void;
  /** Settles `snapshot()`'s parked `stagingBuffer.mapAsync()`. */
  resolveSnapshotMap: () => void;
  rejectSnapshotMap: (reason: unknown) => void;
  /** Settles `snapshotDisplay()`'s parked `displayStagingBuffer.mapAsync()`. */
  resolveDisplayMap: () => void;
  rejectDisplayMap: (reason: unknown) => void;
}

/**
 * Builds a `GpuFlameBackend` over a fake GPUDevice and its five fake
 * GPUBuffers (the exact set `GpuFlameBackendInit` hands the class — see that
 * interface's doc for why it's five, not the old eleven). `device.lost`
 * never settles by default (a device that never dies), overridable for the
 * one test that drives the OTHER refusal path `beginOp` shares with
 * `destroyed`. Pipelines/bind groups are opaque `{}` casts: nothing here
 * inspects them, they only ever get handed to the fake encoder's methods
 * below.
 */
function createHarness(
  overrides: {
    lost?: Promise<{ reason: "destroyed" | "unknown"; message: string }>;
  } = {},
): Harness {
  const work = deferred();
  const snapshotMap = deferred();
  const displayMap = deferred();

  const params = createFakeBuffer();
  const hist = createFakeBuffer();
  const staging = createFakeBuffer(() => snapshotMap.promise);
  const display = createFakeBuffer();
  const displayStaging = createFakeBuffer(() => displayMap.promise);

  const deviceDestroy = vi.fn();
  const submit = vi.fn();
  const device = {
    lost: overrides.lost ?? new Promise<never>(() => {}),
    onuncapturederror: null,
    queue: {
      writeBuffer: () => {},
      submit,
      onSubmittedWorkDone: () => work.promise,
    },
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => {},
        setBindGroup: () => {},
        dispatchWorkgroups: () => {},
        end: () => {},
      }),
      copyBufferToBuffer: () => {},
      finish: () => ({}),
    }),
    destroy: deviceDestroy,
  } as unknown as GPUDevice;

  const backend = new GpuFlameBackend({
    device,
    accumulatePipeline: {} as GPUComputePipeline,
    bindGroup: {} as GPUBindGroup,
    paramsBuffer: params.buffer,
    histBuffer: hist.buffer,
    stagingBuffer: staging.buffer,
    paramsItersOffsetBytes: 0,
    convertSnapshot: (_words, _width, _height, out) => out,
    convertDisplay: (_data, _width, _height, out) => out,
    width: 2,
    height: 2,
    software: false,
    downsampleXPipeline: {} as GPUComputePipeline,
    downsampleYPipeline: {} as GPUComputePipeline,
    downsampleBindGroup: {} as GPUBindGroup,
    displayBuffer: display.buffer,
    displayStagingBuffer: displayStaging.buffer,
    displayWidth: 2,
    displayHeight: 2,
  });

  return {
    backend,
    deviceDestroy,
    submit,
    bufferDestroys: [
      params.destroy,
      hist.destroy,
      staging.destroy,
      display.destroy,
      displayStaging.destroy,
    ],
    resolveWork: work.resolve,
    rejectWork: work.reject,
    resolveSnapshotMap: snapshotMap.resolve,
    rejectSnapshotMap: snapshotMap.reject,
    resolveDisplayMap: displayMap.resolve,
    rejectDisplayMap: displayMap.reject,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GpuFlameBackend teardown", () => {
  it("defers device.destroy() until a parked snapshotDisplay() unwinds", async () => {
    const { backend, deviceDestroy, resolveDisplayMap } = createHarness();
    const pending = backend.snapshotDisplay(createFlameHistogram(2, 2));
    await flushMicrotasks();

    backend.destroy();
    expect(deviceDestroy).toHaveBeenCalledTimes(0);

    resolveDisplayMap();
    await pending;
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("defers device.destroy() until a parked snapshot() unwinds", async () => {
    const { backend, deviceDestroy, resolveSnapshotMap } = createHarness();
    const pending = backend.snapshot();
    await flushMicrotasks();

    backend.destroy();
    expect(deviceDestroy).toHaveBeenCalledTimes(0);

    resolveSnapshotMap();
    await pending;
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("defers device.destroy() until a parked accumulate() unwinds", async () => {
    const { backend, deviceDestroy, resolveWork } = createHarness();
    const pending = backend.accumulate(100);
    await flushMicrotasks();

    backend.destroy();
    expect(deviceDestroy).toHaveBeenCalledTimes(0);

    resolveWork();
    await pending;
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("tears down the device synchronously when nothing is in flight", () => {
    const { backend, deviceDestroy } = createHarness();
    backend.destroy();
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("never destroys a buffer directly, even once the deferred teardown completes", async () => {
    // The deferred path — a staging buffer a pending mapAsync still holds —
    // is the one the fix actually targets: freeing a buffer out from under a
    // pending map is its own crash vector, so this is the case that matters.
    const { backend, bufferDestroys, resolveSnapshotMap } = createHarness();
    const pending = backend.snapshot();
    await flushMicrotasks();

    backend.destroy();
    resolveSnapshotMap();
    await pending;

    bufferDestroys.forEach((destroy) =>
      expect(destroy).toHaveBeenCalledTimes(0),
    );
  });

  it("destroys the device exactly once even when destroy() is called twice during the deferred window", async () => {
    const { backend, deviceDestroy, resolveWork } = createHarness();
    const pending = backend.accumulate(100);
    await flushMicrotasks();

    backend.destroy();
    backend.destroy(); // second call while still deferred: must not re-commit the teardown.
    expect(deviceDestroy).toHaveBeenCalledTimes(0);

    resolveWork();
    await pending;
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("still releases the deferred teardown when the parked op rejects instead of resolving", async () => {
    const { backend, deviceDestroy, rejectSnapshotMap } = createHarness();
    const pending = backend.snapshot();
    await flushMicrotasks();

    backend.destroy();
    rejectSnapshotMap(new Error("simulated map failure"));

    await expect(pending).rejects.toThrow("simulated map failure");
    expect(deviceDestroy).toHaveBeenCalledTimes(1);
  });

  it("refuses new ops once destroy() has been requested, without reaching the queue", async () => {
    const { backend, submit } = createHarness();
    backend.destroy();

    await expect(backend.accumulate(1)).rejects.toThrow("destroyed");
    await expect(backend.snapshot()).rejects.toThrow("destroyed");
    await expect(
      backend.snapshotDisplay(createFlameHistogram(2, 2)),
    ).rejects.toThrow("destroyed");

    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses a second op started during the deferred window, without delaying or duplicating the teardown", async () => {
    const { backend, deviceDestroy, submit, resolveWork } = createHarness();
    const first = backend.accumulate(100);
    await flushMicrotasks();
    backend.destroy();

    await expect(backend.accumulate(1)).rejects.toThrow("destroyed");
    expect(submit).toHaveBeenCalledTimes(1); // only the first op's submit — the refused one never reached the queue.

    resolveWork();
    await first;
    expect(deviceDestroy).toHaveBeenCalledTimes(1); // the refused second op added no in-flight work to wait for.
  });

  it("a lost device refuses work with a message naming the operation, through the same gate as destroyed", async () => {
    const { backend } = createHarness({
      lost: Promise.resolve({ reason: "unknown", message: "simulated loss" }),
    });
    await flushMicrotasks(); // let device.lost's .then() mark the backend lost.

    await expect(
      backend.snapshotDisplay(createFlameHistogram(2, 2)),
    ).rejects.toThrow("device is lost, cannot snapshot display");
  });
});
