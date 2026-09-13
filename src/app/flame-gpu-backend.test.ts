/**
 * Pins `GpuFlameBackend`'s deferred-teardown state machine: a
 * `destroy()` call while an op is parked on live submitted GPU work must not
 * touch the device until that op unwinds, must never explicitly destroy a
 * buffer (the device reclaims them), and must still refuse new work the
 * instant teardown is requested. See that class's own doc for why this file
 * exists — a fake GPUDevice/GPUBuffer pair is the only way to drive a state
 * machine whose real inputs are a GPU driver's timing.
 */
import { GpuFlameBackend, type GpuFlameBackendInit } from "./flame-gpu-backend";
import { FlameGpuAdaptiveAbortError } from "./flame-worker-core";
import { createFlameHistogram } from "../fractal/flame";
import type { FlameHistogram } from "../fractal/flame";

// `GPUMapMode` is a real runtime global in a browser/WebGPU context, not just
// the compile-time ambient type `@webgpu/types` declares — `snapshot()`/
// `snapshotDisplay()` read `GPUMapMode.READ` directly, mirroring the real
// WebGPU API. Node has no such global, so a plain Node test run needs the
// same minimal stand-in a browser provides for free (values match the WebGPU
// spec's own flag bits; nothing here reads them besides passing them through
// to this file's fake `mapAsync`, which ignores its arguments entirely).
globalThis.GPUMapMode = { READ: 0x0001, WRITE: 0x0002 };
// Same stand-in rationale, for the adaptive resources' buffer creation.
globalThis.GPUBufferUsage = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
};

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
 * `Uint32Array`/`Float32Array` view. `destroy` and `unmap` are spies:
 * production code must never call `destroy` (the deferred-teardown
 * discipline — every buffer-destroy assertion in this file reads that spy),
 * while `unmap`'s spy lets a test pin that a mapped section always unmaps,
 * converter throw or not. */
function createFakeBuffer(
  mapAsync: () => Promise<undefined> = () => new Promise(() => {}),
): {
  buffer: GPUBuffer;
  destroy: ReturnType<typeof vi.fn>;
  unmap: ReturnType<typeof vi.fn>;
} {
  const destroy = vi.fn();
  const unmap = vi.fn();
  const buffer = {
    mapAsync,
    getMappedRange: () => new ArrayBuffer(64),
    unmap,
    destroy,
  } as unknown as GPUBuffer;
  return { buffer, destroy, unmap };
}

interface Harness {
  backend: GpuFlameBackend;
  /** Spy on the fake device's own `destroy()` — the one call the whole
   * deferred-teardown state machine exists to time correctly. */
  deviceDestroy: ReturnType<typeof vi.fn>;
  /** Spy on the fake queue's `submit()` — lets a test prove a refused op
   * never reached the GPU at all, not just that it rejected. */
  submit: ReturnType<typeof vi.fn>;
  /** One destroy spy per fake buffer the backend holds (params, hist,
   * staging, display, displayStaging) — see `GpuFlameBackendInit`'s doc for
   * why it's exactly these five. */
  bufferDestroys: ReturnType<typeof vi.fn>[];
  /** Settles `accumulate()`'s parked `queue.onSubmittedWorkDone()`. With a
   * multi-fence op (the adaptive pass) each call settles the OLDEST pending
   * fence, so the pass can be stepped await by await. */
  resolveWork: () => void;
  rejectWork: (reason: unknown) => void;
  /** Settles `snapshot()`'s parked `stagingBuffer.mapAsync()`. */
  resolveSnapshotMap: () => void;
  rejectSnapshotMap: (reason: unknown) => void;
  /** Settles `snapshotDisplay()`'s parked `displayStagingBuffer.mapAsync()`. */
  resolveDisplayMap: () => void;
  rejectDisplayMap: (reason: unknown) => void;
  /** Settles `adaptiveDisplay()`'s parked own-staging `mapAsync()`. */
  resolveAdaptiveMap: () => void;
  rejectAdaptiveMap: (reason: unknown) => void;
  /** The two staging buffers' `unmap` spies — pin that a snapshot's mapped
   * section unmaps even when its converter throws. */
  stagingUnmap: ReturnType<typeof vi.fn>;
  displayStagingUnmap: ReturnType<typeof vi.fn>;
  /** The adaptive pass's own staging `unmap` spy. */
  adaptiveStagingUnmap: ReturnType<typeof vi.fn>;
  /** Number of `device.createBuffer` calls so far — lets a serialization
   * test prove the queued second pass built nothing until the first
   * unwound. */
  createBufferCalls: ReturnType<typeof vi.fn>;
  /** Number of fences the CURRENT test can settle. */
  pendingFenceCount: () => number;
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
    /** Replaces the default pass-through snapshot converter — lets a test
     * throw from inside the mapped section. */
    convertSnapshot?: GpuFlameBackendInit["convertSnapshot"];
  } = {},
): Harness {
  const snapshotMap = deferred();
  const displayMap = deferred();
  const adaptiveMap = deferred();

  const params = createFakeBuffer();
  const hist = createFakeBuffer();
  const staging = createFakeBuffer(() => snapshotMap.promise);
  const display = createFakeBuffer();
  const displayStaging = createFakeBuffer(() => displayMap.promise);
  const adaptiveStaging = createFakeBuffer(() => adaptiveMap.promise);

  const deviceDestroy = vi.fn();
  const submit = vi.fn();
  /** Every `queue.onSubmittedWorkDone()` returns a FRESH deferred, so a
   * multi-fence op (the adaptive pass: occupancy, then one fence per band)
   * can be stepped one await at a time — a single shared promise would make
   * every await after the first resolve immediately. */
  const pendingWork: ReturnType<typeof deferred>[] = [];
  const queueWork = (): Promise<undefined> => {
    const next = deferred();
    pendingWork.push(next);
    return next.promise;
  };
  const createBuffer = vi.fn((descriptor?: { label?: string }) => {
    if (descriptor?.label === "flame-gpu adaptive display staging") {
      return adaptiveStaging.buffer;
    }
    return createFakeBuffer().buffer;
  });
  const device = {
    lost: overrides.lost ?? new Promise<never>(() => {}),
    onuncapturederror: null,
    queue: {
      writeBuffer: () => {},
      submit,
      onSubmittedWorkDone: queueWork,
    },
    createBuffer,
    createBindGroup: () => ({}),
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
    convertSnapshot:
      overrides.convertSnapshot ?? ((_words, _width, _height, out) => out),
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
    adaptiveMarkTilesPipeline: {} as GPUComputePipeline,
    adaptiveScanTilesXPipeline: {} as GPUComputePipeline,
    adaptiveScanTilesYPipeline: {} as GPUComputePipeline,
    adaptiveGatherPipeline: {} as GPUComputePipeline,
    adaptiveBindGroupLayout: {} as GPUBindGroupLayout,
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
    resolveWork: () => {
      pendingWork.shift()?.resolve();
    },
    rejectWork: (reason: unknown) => {
      pendingWork.shift()?.reject(reason);
    },
    resolveSnapshotMap: snapshotMap.resolve,
    rejectSnapshotMap: snapshotMap.reject,
    resolveDisplayMap: displayMap.resolve,
    rejectDisplayMap: displayMap.reject,
    resolveAdaptiveMap: adaptiveMap.resolve,
    rejectAdaptiveMap: adaptiveMap.reject,
    stagingUnmap: staging.unmap,
    displayStagingUnmap: displayStaging.unmap,
    adaptiveStagingUnmap: adaptiveStaging.unmap,
    createBufferCalls: createBuffer,
    pendingFenceCount: () => pendingWork.length,
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

  it("waits for BOTH in-flight ops when two overlap at destroy()", async () => {
    // `opsInFlight` is a COUNT, and the tests above only ever drive it at one.
    // Two ops really do overlap in the shipped worker — a progressive
    // redisplay's readback while an accumulation chunk is still running — and
    // each parks on its own await (onSubmittedWorkDone, mapAsync), so the
    // teardown owes the LAST one out, not the first.
    const { backend, deviceDestroy, resolveWork, resolveSnapshotMap } =
      createHarness();
    const accumulating = backend.accumulate(100);
    const snapshotting = backend.snapshot();
    await flushMicrotasks();

    backend.destroy();
    expect(deviceDestroy).toHaveBeenCalledTimes(0);

    resolveWork();
    await accumulating;
    expect(deviceDestroy).toHaveBeenCalledTimes(0); // the snapshot is still parked on its map.

    resolveSnapshotMap();
    await snapshotting;
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

  it("unmaps the staging buffer even when the snapshot converter throws", async () => {
    // A converter throw inside the mapped section used to leave the ONE
    // reusable staging buffer mapped, so every later mapAsync rejected and
    // the session's failure ladder demoted a healthy device to CPU.
    const { backend, stagingUnmap, resolveSnapshotMap } = createHarness({
      convertSnapshot: () => {
        throw new Error("simulated conversion failure");
      },
    });
    const pending = backend.snapshot();
    await flushMicrotasks();

    resolveSnapshotMap();

    await expect(pending).rejects.toThrow("simulated conversion failure");
    expect(stagingUnmap).toHaveBeenCalledTimes(1);
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

// ---------------------------------------------------------------------------
// The adaptive density-estimate pass: an op shaped differently from the other
// three — it submits several fences (occupancy prepass, one per band,
// readback) and reads back through its OWN staging buffer. These tests drive
// that sequence one fence at a time and pin the band progress, the abort
// channel and the pass serialization.
// ---------------------------------------------------------------------------

describe("GpuFlameBackend adaptiveDisplay", () => {
  const ESTIMATOR = {
    estimatorRadius: 1,
    estimatorMinimumRadius: 0,
    estimatorCurve: 0.4,
  };

  function sourceHistogram(): FlameHistogram {
    const hist = createFlameHistogram(2, 2);
    hist.hits.fill(1);
    hist.hitMass = 4;
    hist.maxHits = 1;
    return hist;
  }

  it("runs the occupancy prepass, then the gather band, then reads back into out", async () => {
    const { backend, submit, resolveWork, resolveAdaptiveMap } =
      createHarness();
    const out = createFlameHistogram(2, 2);
    const bands: [number, number][] = [];
    const pending = backend.adaptiveDisplay(
      sourceHistogram(),
      ESTIMATOR,
      out,
      (done, total) => {
        bands.push([done, total]);
        return true;
      },
    );

    // Occupancy prepass submitted, parked on its fence.
    await flushMicrotasks();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(bands).toEqual([]);
    resolveWork();

    // Gather band submitted, parked on its fence.
    await flushMicrotasks();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(bands).toEqual([]);
    resolveWork();

    // Band fence done: progress charged, readback submitted, map parked.
    await flushMicrotasks();
    expect(submit).toHaveBeenCalledTimes(3);
    expect(bands).toHaveLength(1);
    expect(bands[0][0]).toBe(bands[0][1]);
    expect(bands[0][0]).toBeGreaterThan(0);

    resolveAdaptiveMap();
    await flushMicrotasks();
    await expect(pending).resolves.toBe(out);
  });

  it("throws the abort error and leaves out untouched when onBand answers false", async () => {
    const { backend, resolveWork } = createHarness();
    const out = createFlameHistogram(2, 2);
    out.hits.fill(123);
    const pending = backend.adaptiveDisplay(
      sourceHistogram(),
      ESTIMATOR,
      out,
      () => false,
    );

    await flushMicrotasks();
    resolveWork(); // occupancy fence
    await flushMicrotasks();
    resolveWork(); // band fence -> onBand says superseded
    await flushMicrotasks();

    await expect(pending).rejects.toBeInstanceOf(FlameGpuAdaptiveAbortError);
    expect(Array.from(out.hits)).toEqual([123, 123, 123, 123]);
  });

  it("serializes overlapping passes: the second builds nothing until the first unwinds", async () => {
    const {
      backend,
      submit,
      createBufferCalls,
      resolveWork,
      resolveAdaptiveMap,
    } = createHarness();
    const first = backend.adaptiveDisplay(
      sourceHistogram(),
      ESTIMATOR,
      createFlameHistogram(2, 2),
      () => true,
    );
    await flushMicrotasks(); // first pass: resources built, occupancy submitted.
    const buffersAfterFirstStart = createBufferCalls.mock.calls.length;
    expect(buffersAfterFirstStart).toBeGreaterThan(0);

    const second = backend.adaptiveDisplay(
      sourceHistogram(),
      ESTIMATOR,
      createFlameHistogram(2, 2),
      () => true,
    );
    await flushMicrotasks();
    // The queued pass has not touched the device at all.
    expect(createBufferCalls.mock.calls.length).toBe(buffersAfterFirstStart);
    expect(submit).toHaveBeenCalledTimes(1);

    // Wind the first pass down (occupancy, band, readback map); only then
    // does the second's occupancy prepass reach the queue.
    resolveWork();
    await flushMicrotasks();
    resolveWork();
    await flushMicrotasks();
    resolveAdaptiveMap();
    await flushMicrotasks();
    await first;
    await flushMicrotasks();
    expect(submit).toHaveBeenCalledTimes(4); // first's 3 + second's occupancy.
    // Finish the second too, so no op is left parked.
    resolveWork();
    await flushMicrotasks();
    resolveWork();
    await flushMicrotasks();
    resolveAdaptiveMap();
    await second;
  });
});
