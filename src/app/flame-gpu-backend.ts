/**
 * The WebGPU flame-accumulation backend's BROWSER side (fr-npb): plugs
 * `flame-gpu.ts`'s pure packing/planning/conversion layer into the flame
 * worker session's {@link FlameAccumBackend} seam (`flame-worker-core.ts`).
 * `flame-worker.ts` wires {@link createGpuFlameBackend} in as that seam's
 * `createGpuBackend` factory, so everything here runs INSIDE the flame
 * worker — `navigator.gpu` below is the `WorkerNavigator`'s, not the main
 * thread's (see that module's own doc for why `self`/`navigator` aren't
 * typed via the `webworker` lib in this project).
 *
 * Structurally this is fr-53k's spike driver (`git show
 * spike/fr-53k-gpu-flame-accum:src/app/gpu-spike/engine.ts`), restated
 * against this module's COMMITTED layout/API: 208 B slots (12 variation
 * lanes) and 8-word (emulated-u64) histogram buckets instead of the spike's
 * 144 B/4-lane/single-u32 shapes, and `flame-gpu.ts`'s exported
 * `packGpuSystem`/`packGpuChains`/`packGpuParams`/`planGpuDispatches`/
 * `convertGpuHistogram` instead of the spike's local (unexported) packing
 * helpers. See that file's module doc for the byte-layout contract this
 * drives and the WGSL kernel itself.
 *
 * fr-e26: the driver body — device acquisition, buffer/bind-group/pipeline
 * setup, the shared downsample pipeline, the warmup dispatch, and the
 * {@link GpuFlameBackend} class itself — is dimension-agnostic, so it is
 * factored into {@link createBackendForProgram}, parameterized by a
 * {@link GpuProgramSpec} (which kernel, which packed buffers, which
 * readback conversions). {@link createGpuFlameBackend} packs the 3D program
 * (`flame-gpu.ts`), {@link createGpuFlameBackend4} the 4D one
 * (`flame-gpu-4d.ts`, pinned against `accumulateFlame4`); both share every
 * line of driver code, so the two paths can never drift on the driving.
 *
 * This module never falls back to CPU itself — every failure mode here is a
 * thrown (`create`) or rejected (`accumulate`) error with a message naming
 * what went wrong, and (fr-2w5) a CLASS naming its kind:
 * `FlameGpuUnavailableError` when the context has no usable WebGPU,
 * `FlameGpuSizeError` when the accumulation size is what failed (device
 * limits, or a scoped out-of-memory at resource creation), plain `Error`
 * otherwise. `flame-worker-core.ts`'s `FlameWorkerSession`
 * (`handleGpuFailure` — the supersample-shrink ladder in front of the
 * `gpuFailed` ratchet) owns all recovery and keys its retry policy off
 * those classes. Diagnostics that aren't part of that control flow (a
 * genuinely lost device, an uncaptured device error mid-render, the
 * one-line backend-up breadcrumb) just `console.info`/`console.error` — the
 * session's own `log` sink is what tells the user-visible fallback story
 * once the next `accumulate()` throws.
 */
import {
  BYTES_PER_GPU_BUCKET,
  DOWNSAMPLE_PARAMS_BYTES,
  DOWNSAMPLE_WORKGROUP_SIZE,
  FLAME_GPU_DOWNSAMPLE_WGSL,
  FLAME_GPU_KERNEL_WGSL,
  PARAMS_ITERS_OFFSET_BYTES,
  WARMUP_ITERATIONS,
  WORKGROUP_SIZE,
  convertGpuDisplayHistogram,
  convertGpuHistogram,
  packGpuChains,
  packGpuDownsample,
  packGpuParams,
  packGpuSystem,
  planGpuDispatches,
} from "../fractal/flame-gpu";
import {
  FLAME_GPU_KERNEL_4D_WGSL,
  PARAMS4_ITERS_OFFSET_BYTES,
  convertGpuDisplayHistogram4,
  convertGpuHistogram4,
  packGpuChains4,
  packGpuParams4,
  packGpuSystem4,
} from "../fractal/flame-gpu-4d";
import { createFlameHistogram } from "../fractal/flame";
import type { FlameHistogram } from "../fractal/flame";
import {
  FlameGpuSizeError,
  FlameGpuUnavailableError,
} from "./flame-worker-core";
import type {
  FlameAccumBackend,
  GpuBackendRequest,
  GpuBackendRequest4,
} from "./flame-worker-core";

/** Bytes per display-resolution downsample bucket: interleaved f32 [hits, r,
 * g, b] — see flame-gpu.ts's FLAME_GPU_DOWNSAMPLE_WGSL doc. */
const DISPLAY_BUCKET_BYTES = 16;

/** Smallest workgroup count covering `total` invocations at `size` per
 * workgroup — used to size both downsample passes' 2D dispatches. */
function ceilDiv(total: number, size: number): number {
  return Math.ceil(total / size);
}

/**
 * Independent chains iterated in parallel — must be a multiple of
 * {@link WORKGROUP_SIZE} (512 workgroups at 128). fr-53k's spike measured
 * this as a good default across integrated and discrete GPUs; unlike the
 * spike, this isn't caller-configurable — one fixed value keeps the packed
 * chains buffer's size (and thus a big chunk of this backend's VRAM
 * footprint) predictable from the accumulation resolution alone.
 *
 * fr-hs9's phone validation kept this same value for mobile: an arm-valhall
 * phone passed the gpu-bench agreement checks and measured ~19-36x its CPU
 * worker at 65536 chains, so there is no adapter-conditional lower count —
 * the minimum dispatch quantum (one iteration per chain, ~1.2 ms at that
 * phone's ~55 M iters/s) stays far below the 24 ms GPU chunk budget.
 */
const NUM_CHAINS = 65536;

/**
 * Ceiling on iterations-per-chain a single dispatch runs (see
 * `planGpuDispatches`). A dispatch's fixed JS/submit overhead (building the
 * command encoder, `queue.submit`, `onSubmittedWorkDone`) is roughly
 * constant regardless of how many iterations it covers, so this bounds how
 * long the GPU can run "heads down" between opportunities for `runChunk` to
 * reschedule — too small wastes throughput on overhead, too large risks a
 * single dispatch blowing well past the GPU frame budget
 * (`FLAME_GPU_FRAME_BUDGET_MS` in flame-worker-core.ts).
 */
const MAX_ITERS_PER_INVOCATION = 512;

/** Convert a `snapshot()` staging readback into a {@link FlameHistogram} —
 * `convertGpuHistogram` for the 3D program, `convertGpuHistogram4` (whose
 * buckets carry the extra weight fixed-point factor) for the 4D one. */
type SnapshotConverter = (
  words: Uint32Array,
  width: number,
  height: number,
  out: FlameHistogram,
) => FlameHistogram;

/** Convert a `snapshotDisplay()` staging readback — same 3D/4D split as
 * {@link SnapshotConverter} (see `convertGpuDisplayHistogram4`'s doc for why
 * the shared downsample kernel needs only a different readback scale). */
type DisplayConverter = (
  data: Float32Array,
  width: number,
  height: number,
  out: FlameHistogram,
) => FlameHistogram;

/**
 * One accumulation program's worth of dimension-SPECIFIC state (fr-e26):
 * the WGSL kernel, its packed buffers, the one mid-session-rewritten uniform
 * field's offset, and the readback conversions — everything about a backend
 * that differs between the 3D and 4D kernels. The dimension-AGNOSTIC rest
 * (device, bind groups, pipelines, downsample, warmup, the backend class)
 * lives in {@link createBackendForProgram}, which this parameterizes.
 */
interface GpuProgramSpec {
  /** Names the kernel in compile-error messages (e.g. "3D kernel"). */
  label: string;
  kernel: string;
  /** Packed uniform contents — `itersPerInvocation` must already be
   * {@link WARMUP_ITERATIONS}, the value the warmup dispatch reads. */
  params: ArrayBuffer;
  /** Byte offset of the uniform's `itersPerInvocation` — the one field
   * `accumulate()` rewrites mid-session. */
  paramsItersOffsetBytes: number;
  slots: ArrayBuffer;
  colors: ArrayBuffer;
  chains: ArrayBuffer;
  convertSnapshot: SnapshotConverter;
  convertDisplay: DisplayConverter;
  /** Accumulation resolution (display size x effective supersample). */
  width: number;
  height: number;
  /** fr-ee9: display resolution + progressive filter radius — sizes the
   * shared downsample pipeline (see `GpuBackendRequest`'s same fields). */
  displayWidth: number;
  displayHeight: number;
  progressiveFilterRadius: number;
}

/**
 * Everything {@link GpuFlameBackend}'s constructor needs, built up by the
 * (long) {@link createBackendForProgram} driver. Mirrors
 * `flame-worker-core.ts`'s `CpuFlameBackend` constructor-argument shape in
 * spirit — a plain bag of "what this backend needs to do its job" — but as
 * an object rather than positional arguments, since there are enough GPU
 * resources here that position would be unreadable.
 */
interface GpuFlameBackendInit {
  device: GPUDevice;
  accumulatePipeline: GPUComputePipeline;
  bindGroup: GPUBindGroup;
  paramsBuffer: GPUBuffer;
  slotsBuffer: GPUBuffer;
  colorsBuffer: GPUBuffer;
  chainsBuffer: GPUBuffer;
  histBuffer: GPUBuffer;
  stagingBuffer: GPUBuffer;
  /** See {@link GpuProgramSpec} — the program's mid-session-rewritten
   * uniform offset and readback conversions, threaded through to the
   * backend's accumulate/snapshot/snapshotDisplay. */
  paramsItersOffsetBytes: number;
  convertSnapshot: SnapshotConverter;
  convertDisplay: DisplayConverter;
  /** Accumulation resolution (display size x effective supersample) — see
   * `GpuBackendRequest`'s doc. */
  width: number;
  height: number;
  adapterLabel?: string;
  /** Whether the adapter is a software fallback — see
   * {@link FlameAccumBackend.software}. */
  software: boolean;
  /** fr-ee9: the progressive-display two-pass separable downsample's
   * pipelines, buffers, and shared bind group — see `snapshotDisplay`'s doc. */
  downsampleXPipeline: GPUComputePipeline;
  downsampleYPipeline: GPUComputePipeline;
  downsampleBindGroup: GPUBindGroup;
  intermediateBuffer: GPUBuffer;
  displayBuffer: GPUBuffer;
  displayStagingBuffer: GPUBuffer;
  downsampleWeightsBuffer: GPUBuffer;
  downsampleParamsBuffer: GPUBuffer;
  /** Display resolution — what `snapshotDisplay`'s `out` histogram must
   * already be sized to (baked in at backend-creation time). */
  displayWidth: number;
  displayHeight: number;
}

/**
 * The GPU accumulation backend: drives a {@link GpuProgramSpec}'s kernel
 * (3D or 4D) over one packed system, behind the same
 * {@link FlameAccumBackend} seam `CpuFlameBackend` implements. Built and
 * warmed up entirely inside {@link createBackendForProgram} — by the time
 * this class exists, every chain has already run its `WARMUP_ITERATIONS`
 * steps unrecorded, so the very first `accumulate()` call starts already on
 * the attractor, exactly like the CPU accumulators' fresh-start.
 */
class GpuFlameBackend implements FlameAccumBackend {
  readonly kind = "gpu" as const;
  readonly adapterLabel?: string;
  readonly software: boolean;

  private readonly device: GPUDevice;
  private readonly accumulatePipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly paramsBuffer: GPUBuffer;
  private readonly slotsBuffer: GPUBuffer;
  private readonly colorsBuffer: GPUBuffer;
  private readonly chainsBuffer: GPUBuffer;
  private readonly histBuffer: GPUBuffer;
  private readonly stagingBuffer: GPUBuffer;
  private readonly paramsItersOffsetBytes: number;
  private readonly convertSnapshot: SnapshotConverter;
  private readonly convertDisplay: DisplayConverter;
  private readonly width: number;
  private readonly height: number;
  private readonly histBytes: number;
  private readonly workgroupCount = NUM_CHAINS / WORKGROUP_SIZE;
  /** The `snapshot()` target, allocated LAZILY on the first `snapshot()`
   * call and reused every call after — the GPU counterpart of
   * `CpuFlameBackend` handing back its own live accumulator object every
   * time. The converters' `out` contract unconditionally overwrites every
   * bucket, so reuse is indistinguishable from a fresh allocation to any
   * caller. Lazy (fr-2w5/fr-7su) because these are accumulation-resolution
   * Float64 arrays on the CPU heap — up to gigabytes at a desktop
   * resolution x supersample — and progressive redisplays never touch them
   * (they use `snapshotDisplay`): only the finished frame does. Allocating
   * them eagerly at create time taxed every GPU render with memory
   * pressure that (fr-2w5's measurements) directly shrinks how much the
   * GPU allocator will grant this same render's device buffers. */
  private outHistogram: FlameHistogram | null = null;
  /** fr-ee9: the progressive-display two-pass downsample's pipelines,
   * buffers, and shared bind group — see `snapshotDisplay`'s doc. */
  private readonly downsampleXPipeline: GPUComputePipeline;
  private readonly downsampleYPipeline: GPUComputePipeline;
  private readonly downsampleBindGroup: GPUBindGroup;
  private readonly intermediateBuffer: GPUBuffer;
  private readonly displayBuffer: GPUBuffer;
  private readonly displayStagingBuffer: GPUBuffer;
  private readonly downsampleWeightsBuffer: GPUBuffer;
  private readonly downsampleParamsBuffer: GPUBuffer;
  private readonly displayWidth: number;
  private readonly displayHeight: number;
  private readonly displayBytes: number;
  /** Dispatch geometry for the two downsample passes, precomputed once (both
   * are fixed for the backend's whole lifetime): downsampleX covers (display
   * width, accumulation height), downsampleY covers (display width, display
   * height) — see FLAME_GPU_DOWNSAMPLE_WGSL's doc for why the two passes
   * have different shapes. */
  private readonly downsampleXWorkgroups: readonly [number, number];
  private readonly downsampleYWorkgroups: readonly [number, number];
  /** The Params buffer's CURRENT `itersPerInvocation` field — starts at
   * {@link WARMUP_ITERATIONS} because that is the value the warmup dispatch
   * (run by `createBackendForProgram`, before this instance exists) actually
   * wrote there. `accumulate()` only pays for a `writeBuffer` when a new
   * plan's value differs from this, per the program's
   * `paramsItersOffsetBytes` doc ("the one field the driver rewrites
   * mid-session"). */
  private currentItersPerInvocation = WARMUP_ITERATIONS;
  /** Set once — a lost device never comes back — by the `device.lost`
   * handler wired up below. Checked at the top of `accumulate()` so a
   * doomed device fails fast with a clear message instead of queuing a
   * dispatch that will never complete. */
  private lost = false;
  private destroyed = false;

  constructor(init: GpuFlameBackendInit) {
    this.device = init.device;
    this.accumulatePipeline = init.accumulatePipeline;
    this.bindGroup = init.bindGroup;
    this.paramsBuffer = init.paramsBuffer;
    this.slotsBuffer = init.slotsBuffer;
    this.colorsBuffer = init.colorsBuffer;
    this.chainsBuffer = init.chainsBuffer;
    this.histBuffer = init.histBuffer;
    this.stagingBuffer = init.stagingBuffer;
    this.paramsItersOffsetBytes = init.paramsItersOffsetBytes;
    this.convertSnapshot = init.convertSnapshot;
    this.convertDisplay = init.convertDisplay;
    this.width = init.width;
    this.height = init.height;
    this.adapterLabel = init.adapterLabel;
    this.software = init.software;
    this.histBytes = init.width * init.height * BYTES_PER_GPU_BUCKET;
    this.downsampleXPipeline = init.downsampleXPipeline;
    this.downsampleYPipeline = init.downsampleYPipeline;
    this.downsampleBindGroup = init.downsampleBindGroup;
    this.intermediateBuffer = init.intermediateBuffer;
    this.displayBuffer = init.displayBuffer;
    this.displayStagingBuffer = init.displayStagingBuffer;
    this.downsampleWeightsBuffer = init.downsampleWeightsBuffer;
    this.downsampleParamsBuffer = init.downsampleParamsBuffer;
    this.displayWidth = init.displayWidth;
    this.displayHeight = init.displayHeight;
    this.displayBytes =
      init.displayWidth * init.displayHeight * DISPLAY_BUCKET_BYTES;
    this.downsampleXWorkgroups = [
      ceilDiv(init.displayWidth, DOWNSAMPLE_WORKGROUP_SIZE),
      ceilDiv(init.height, DOWNSAMPLE_WORKGROUP_SIZE),
    ];
    this.downsampleYWorkgroups = [
      ceilDiv(init.displayWidth, DOWNSAMPLE_WORKGROUP_SIZE),
      ceilDiv(init.displayHeight, DOWNSAMPLE_WORKGROUP_SIZE),
    ];

    // Fatal only: a validation error in one dispatch does NOT resolve this
    // (it surfaces via onuncapturederror instead, logged but non-fatal) —
    // only a genuine device loss (driver crash, an explicit destroy(), or
    // the browser reclaiming the device) does, which is also the only case
    // worth refusing further work for.
    this.device.lost
      .then((info) => {
        this.lost = true;
        // reason "destroyed" means THIS backend's own destroy() caused it
        // (the routine case: every setSupersample/setPalette/setSymmetry
        // restart, and every session end, destroys the outgoing backend) —
        // confirmed-intentional, not a failure, so it doesn't warrant an
        // error-level log; only a genuinely unexpected loss ("unknown") do.
        if (info.reason !== "destroyed") {
          console.error(
            `Flame GPU: device lost (${info.reason}): ${info.message}`,
          );
        }
      })
      .catch((e: unknown) => {
        console.error("Flame GPU: device.lost rejected unexpectedly:", e);
      });
    this.device.onuncapturederror = (event) => {
      console.error("Flame GPU: uncaptured device error:", event.error.message);
    };
  }

  async accumulate(iterations: number): Promise<number> {
    if (this.lost) {
      throw new Error("Flame GPU: device is lost, cannot accumulate");
    }
    const plan = planGpuDispatches(
      iterations,
      NUM_CHAINS,
      MAX_ITERS_PER_INVOCATION,
    );
    if (plan.itersPerInvocation !== this.currentItersPerInvocation) {
      this.device.queue.writeBuffer(
        this.paramsBuffer,
        this.paramsItersOffsetBytes,
        new Uint32Array([plan.itersPerInvocation]),
      );
      this.currentItersPerInvocation = plan.itersPerInvocation;
    }

    const encoder = this.device.createCommandEncoder({
      label: "flame-gpu accumulate",
    });
    // Every dispatch this plan calls for goes in ONE compute pass — WebGPU
    // guarantees dispatches within a pass observe each other's storage
    // writes in issue order, so this is `plan.dispatches` sequential steps
    // of the SAME orbit (each chain's `pos`/`aux` feeding the next), not
    // `plan.dispatches` independent ones.
    const pass = encoder.beginComputePass({
      label: "flame-gpu accumulate pass",
    });
    pass.setPipeline(this.accumulatePipeline);
    pass.setBindGroup(0, this.bindGroup);
    for (let i = 0; i < plan.dispatches; i++) {
      pass.dispatchWorkgroups(this.workgroupCount);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    return plan.iterations;
  }

  async snapshot(): Promise<FlameHistogram> {
    if (this.lost) {
      throw new Error("Flame GPU: device is lost, cannot snapshot");
    }
    // Deferred from construction — see this field's doc. A CPU allocation
    // failure here rejects like any other snapshot failure, into the
    // session's ordinary recovery.
    this.outHistogram ??= createFlameHistogram(this.width, this.height);
    const encoder = this.device.createCommandEncoder({
      label: "flame-gpu hist readback",
    });
    encoder.copyBufferToBuffer(
      this.histBuffer,
      0,
      this.stagingBuffer,
      0,
      this.histBytes,
    );
    this.device.queue.submit([encoder.finish()]);
    await this.stagingBuffer.mapAsync(GPUMapMode.READ);
    // Convert BEFORE unmap(): unmap() detaches the ArrayBuffer backing
    // getMappedRange()'s view, so reading `words` after it would throw.
    const words = new Uint32Array(this.stagingBuffer.getMappedRange());
    this.convertSnapshot(words, this.width, this.height, this.outHistogram);
    this.stagingBuffer.unmap();
    return this.outHistogram;
  }

  /**
   * fr-ee9: the progressive-display downsample — runs the two-pass separable
   * Gaussian filter (`FLAME_GPU_DOWNSAMPLE_WGSL`) over the RESIDENT `hist`
   * buffer (no full-histogram readback) and reads back only a
   * `displayWidth x displayHeight` f32 histogram into `out`. Both dispatches
   * go in ONE compute pass: WebGPU orders a pass's dispatches so each one
   * observes the prior dispatch's storage writes, so downsampleY always sees
   * downsampleX's freshly-written `intermediate` buffer, never a stale one.
   */
  async snapshotDisplay(out: FlameHistogram): Promise<FlameHistogram> {
    if (this.lost) {
      throw new Error("Flame GPU: device is lost, cannot snapshot display");
    }
    const encoder = this.device.createCommandEncoder({
      label: "flame-gpu downsample display",
    });
    const pass = encoder.beginComputePass({
      label: "flame-gpu downsample pass",
    });
    pass.setBindGroup(0, this.downsampleBindGroup);
    pass.setPipeline(this.downsampleXPipeline);
    pass.dispatchWorkgroups(...this.downsampleXWorkgroups);
    pass.setPipeline(this.downsampleYPipeline);
    pass.dispatchWorkgroups(...this.downsampleYWorkgroups);
    pass.end();
    encoder.copyBufferToBuffer(
      this.displayBuffer,
      0,
      this.displayStagingBuffer,
      0,
      this.displayBytes,
    );
    this.device.queue.submit([encoder.finish()]);
    await this.displayStagingBuffer.mapAsync(GPUMapMode.READ);
    // Convert BEFORE unmap() — same reason as snapshot()'s own readback above.
    const data = new Float32Array(this.displayStagingBuffer.getMappedRange());
    this.convertDisplay(data, this.displayWidth, this.displayHeight, out);
    this.displayStagingBuffer.unmap();
    return out;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.paramsBuffer.destroy();
    this.slotsBuffer.destroy();
    this.colorsBuffer.destroy();
    this.chainsBuffer.destroy();
    this.histBuffer.destroy();
    this.stagingBuffer.destroy();
    this.intermediateBuffer.destroy();
    this.displayBuffer.destroy();
    this.displayStagingBuffer.destroy();
    this.downsampleWeightsBuffer.destroy();
    this.downsampleParamsBuffer.destroy();
    this.device.destroy();
  }
}

/**
 * Stand up one accumulation's worth of GPU state for a packed
 * {@link GpuProgramSpec} and return it behind the {@link FlameAccumBackend}
 * seam — the dimension-agnostic driver both factories share (fr-e26; this
 * is the whole body `createGpuFlameBackend` owned before the 4D kernel
 * existed, with the program-specific inputs parameterized out).
 *
 * Every early-exit here is a thrown `Error` (which, inside this `async`
 * function, becomes a REJECTED promise) with a message naming what failed;
 * see the module doc for why this never attempts its own CPU fallback. The
 * error's CLASS is the session's classification signal (fr-2w5):
 * {@link FlameGpuUnavailableError} for a context with no usable WebGPU at
 * all, {@link FlameGpuSizeError} for size-caused failures — the device-limit
 * guards AND any scoped out-of-memory error from resource creation, which
 * the session's supersample ladder retries smaller — anything else for
 * failures where a retry makes no sense (e.g. a WGSL compile error).
 */
async function createBackendForProgram(
  program: GpuProgramSpec,
): Promise<FlameAccumBackend> {
  if (!navigator.gpu) {
    throw new FlameGpuUnavailableError(
      "Flame GPU: WebGPU is not available (navigator.gpu is undefined)",
    );
  }
  // powerPreference is advisory, but on dual-GPU machines the default may
  // be the low-power integrated adapter (often with smaller limits); a
  // long-running compute burst is the textbook high-performance case.
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) {
    throw new FlameGpuUnavailableError(
      "Flame GPU: navigator.gpu.requestAdapter() returned null — no compatible GPU adapter",
    );
  }

  // Without requiredLimits, the DEVICE (not just the adapter) is silently
  // capped at WebGPU's conservative spec-default limits (128 MiB) even on
  // hardware that supports far more — fr-53k's spike caught this the hard
  // way; every render past a trivial accumulation resolution needs the
  // adapter's REAL ceiling, not the spec default.
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  try {
    return await buildBackendOnDevice(device, adapter, program);
  } catch (e) {
    // Whatever partial resources were created die with the device — without
    // this, every failed attempt (e.g. each step of the session's
    // supersample ladder) would leak a live GPUDevice until GC.
    device.destroy();
    throw e;
  }
}

/**
 * The resource-building body of {@link createBackendForProgram}, split out
 * so its caller can own exactly one `device.destroy()`-on-throw path. All
 * resource creation — buffers, pipelines, bind groups, AND the warmup
 * dispatch — runs inside a pair of error scopes, because WebGPU's
 * `createBuffer` NEVER throws on allocation failure: it returns an
 * invalid-but-real-looking buffer whose failure otherwise surfaces only
 * when something touches it mid-render, seconds later and with a message
 * naming the wrong thing ("invalid due to a previous error" at the first
 * snapshot readback — fr-2w5 reproduced exactly this at 4K x supersample 3,
 * and fr-e07's Firefox field report was the same mechanism). The scopes
 * convert that into a create-time, classified, retryable failure. Measured
 * on both Chrome and Firefox: allocation refusals DO report synchronously
 * through `pushErrorScope("out-of-memory")` here, at sizes far below the
 * limits the adapter reports (see the fr-2w5 bead / scripts/gpu-probe.mjs).
 */
async function buildBackendOnDevice(
  device: GPUDevice,
  adapter: GPUAdapter,
  program: GpuProgramSpec,
): Promise<FlameAccumBackend> {
  const histBytes = program.width * program.height * BYTES_PER_GPU_BUCKET;
  if (histBytes > device.limits.maxStorageBufferBindingSize) {
    // The session's own RAM budget already sized the accumulation
    // resolution for a CPU Float64 histogram; this device's storage-buffer
    // ceiling is a SEPARATE, GPU-specific limit that can bind tighter — the
    // session retries a smaller supersample (or runs on CPU) when this
    // throws.
    throw new FlameGpuSizeError(
      `Flame GPU: histogram buffer for ${program.width}x${program.height} ` +
        `needs ${histBytes} bytes, exceeding this device's ` +
        `maxStorageBufferBindingSize (${device.limits.maxStorageBufferBindingSize} bytes)`,
    );
  }
  if (histBytes > device.limits.maxBufferSize) {
    // Same size, different limit: the MAP_READ staging twin is not a
    // storage BINDING, so only maxBufferSize governs it (and buffer
    // creation in general) — a device could pass the binding guard above
    // yet be unable to create the staging buffer at all.
    throw new FlameGpuSizeError(
      `Flame GPU: histogram staging buffer needs ${histBytes} bytes, ` +
        `exceeding this device's maxBufferSize (${device.limits.maxBufferSize} bytes)`,
    );
  }

  // See this function's doc: everything from here to the matching pops runs
  // under an out-of-memory + validation scope pair, so an allocation the
  // reported limits permit but the allocator refuses fails HERE, classified,
  // not seconds later at the first readback.
  device.pushErrorScope("out-of-memory");
  device.pushErrorScope("validation");

  const paramsBuffer = device.createBuffer({
    label: "flame-gpu params",
    size: program.params.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsBuffer, 0, program.params);

  const slotsBuffer = device.createBuffer({
    label: "flame-gpu slots",
    size: program.slots.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(slotsBuffer, 0, program.slots);

  const colorsBuffer = device.createBuffer({
    label: "flame-gpu colors",
    size: program.colors.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(colorsBuffer, 0, program.colors);

  const chainsBuffer = device.createBuffer({
    label: "flame-gpu chains",
    size: program.chains.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(chainsBuffer, 0, program.chains);

  // Zero-initialized by WebGPU (createBuffer with no mappedAtCreation) —
  // exactly the fresh histogram createFlameHistogram would hand back.
  const histBuffer = device.createBuffer({
    label: "flame-gpu hist",
    size: histBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  // ONE reusable staging buffer for every snapshot() readback over this
  // backend's whole lifetime — a fresh mappable buffer per call (as fr-53k's
  // spike did, readHistogram() being called once at the very end there)
  // would be needless per-redisplay churn here, where runChunk calls
  // snapshot() repeatedly over a render's whole progressive lifetime.
  const stagingBuffer = device.createBuffer({
    label: "flame-gpu hist staging",
    size: histBytes,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const bindGroupLayout = device.createBindGroupLayout({
    label: "flame-gpu bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ],
  });
  // An explicit (not "auto") pipeline layout, shared by both pipelines
  // below, so ONE bind group works for both — "auto" layouts can't share a
  // bind group across pipelines, and warmup/accumulate must read/write the
  // exact same buffers (fr-53k lesson).
  const pipelineLayout = device.createPipelineLayout({
    label: "flame-gpu pipeline layout",
    bindGroupLayouts: [bindGroupLayout],
  });

  const shaderModule = device.createShaderModule({
    label: "flame-gpu kernel",
    code: program.kernel,
  });
  const compilationInfo = await shaderModule.getCompilationInfo();
  const errors = compilationInfo.messages.filter((m) => m.type === "error");
  if (errors.length > 0) {
    throw new Error(
      `Flame GPU: ${program.label} WGSL compilation failed:\n${errors
        .map((m) => `  ${m.lineNum}:${m.linePos}: ${m.message}`)
        .join("\n")}`,
    );
  }

  // Two specializations of the same entry point via the PLOT override
  // constant (see the kernels' shared doc) — warmup iterates every chain
  // without recording into hist.
  const warmupPipeline = device.createComputePipeline({
    label: "flame-gpu warmup pipeline",
    layout: pipelineLayout,
    compute: {
      module: shaderModule,
      entryPoint: "accumulate",
      constants: { PLOT: 0 },
    },
  });
  const accumulatePipeline = device.createComputePipeline({
    label: "flame-gpu accumulate pipeline",
    layout: pipelineLayout,
    compute: {
      module: shaderModule,
      entryPoint: "accumulate",
      constants: { PLOT: 1 },
    },
  });

  const bindGroup = device.createBindGroup({
    label: "flame-gpu bind group",
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: slotsBuffer } },
      { binding: 2, resource: { buffer: colorsBuffer } },
      { binding: 3, resource: { buffer: chainsBuffer } },
      { binding: 4, resource: { buffer: histBuffer } },
    ],
  });

  // fr-ee9: the progressive-display two-pass separable downsample — built
  // once per backend (display dims + filter radius are fixed for the whole
  // accumulation), driven by GpuFlameBackend.snapshotDisplay() on every
  // progressive redisplay tick instead of a full histogram readback + CPU
  // downsampleFlame. Shared verbatim by the 3D and 4D programs (the filter
  // is linear, so the 4D buckets' extra fixed-point weight factor divides
  // out in the program's convertDisplay instead — see
  // flame-gpu-4d.ts's convertGpuDisplayHistogram4).
  const packedDownsample = packGpuDownsample(
    program.width,
    program.height,
    program.displayWidth,
    program.displayHeight,
    program.progressiveFilterRadius,
  );

  const downsampleParamsBuffer = device.createBuffer({
    label: "flame-gpu downsample params",
    size: DOWNSAMPLE_PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(downsampleParamsBuffer, 0, packedDownsample.params);

  const downsampleWeightsBuffer = device.createBuffer({
    label: "flame-gpu downsample weights",
    size: packedDownsample.weights.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(
    downsampleWeightsBuffer,
    0,
    packedDownsample.weights,
  );

  // intermediate: one row per SOURCE row, one column per OUTPUT column (see
  // downsampleX's doc) — outW * srcH * 16 B, always <= the already-limit-
  // checked hist buffer's 32 B * srcW * srcH (since srcW >= outW), so no new
  // device-limit guard is needed here (see the fr-ee9 brief's Part 2 note).
  const intermediateBuffer = device.createBuffer({
    label: "flame-gpu downsample intermediate",
    size: program.displayWidth * program.height * DISPLAY_BUCKET_BYTES,
    usage: GPUBufferUsage.STORAGE,
  });
  const displayBytes =
    program.displayWidth * program.displayHeight * DISPLAY_BUCKET_BYTES;
  const displayBuffer = device.createBuffer({
    label: "flame-gpu downsample display",
    size: displayBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  // ONE reusable staging buffer for every snapshotDisplay() readback over
  // this backend's whole lifetime — same rationale as the accumulate
  // histogram's own `stagingBuffer` above.
  const displayStagingBuffer = device.createBuffer({
    label: "flame-gpu downsample display staging",
    size: displayBytes,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const downsampleBindGroupLayout = device.createBindGroupLayout({
    label: "flame-gpu downsample bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ],
  });
  // ONE explicit layout shared by both downsample pipelines, same
  // "auto layouts can't share a bind group across pipelines" reasoning as
  // the accumulate/warmup pipeline pair above — downsampleY must read the
  // exact `intermediate` buffer downsampleX just wrote.
  const downsamplePipelineLayout = device.createPipelineLayout({
    label: "flame-gpu downsample pipeline layout",
    bindGroupLayouts: [downsampleBindGroupLayout],
  });

  const downsampleShaderModule = device.createShaderModule({
    label: "flame-gpu downsample kernel",
    code: FLAME_GPU_DOWNSAMPLE_WGSL,
  });
  const downsampleCompilationInfo =
    await downsampleShaderModule.getCompilationInfo();
  const downsampleErrors = downsampleCompilationInfo.messages.filter(
    (m) => m.type === "error",
  );
  if (downsampleErrors.length > 0) {
    throw new Error(
      `Flame GPU: downsample WGSL compilation failed:\n${downsampleErrors
        .map((m) => `  ${m.lineNum}:${m.linePos}: ${m.message}`)
        .join("\n")}`,
    );
  }

  const downsampleXPipeline = device.createComputePipeline({
    label: "flame-gpu downsampleX pipeline",
    layout: downsamplePipelineLayout,
    compute: { module: downsampleShaderModule, entryPoint: "downsampleX" },
  });
  const downsampleYPipeline = device.createComputePipeline({
    label: "flame-gpu downsampleY pipeline",
    layout: downsamplePipelineLayout,
    compute: { module: downsampleShaderModule, entryPoint: "downsampleY" },
  });

  // binding 1 reuses the accumulate pipeline's own `histBuffer` (created
  // above) as a read-only resource — the whole point of fr-ee9 is running
  // the downsample over that RESIDENT buffer, never reading it back in full.
  const downsampleBindGroup = device.createBindGroup({
    label: "flame-gpu downsample bind group",
    layout: downsampleBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: downsampleParamsBuffer } },
      { binding: 1, resource: { buffer: histBuffer } },
      { binding: 2, resource: { buffer: downsampleWeightsBuffer } },
      { binding: 3, resource: { buffer: intermediateBuffer } },
      { binding: 4, resource: { buffer: displayBuffer } },
    ],
  });

  // Run every chain forward WARMUP_ITERATIONS steps without recording (the
  // PLOT=0 pipeline), BEFORE this factory resolves — the GPU counterpart of
  // the CPU accumulators' fresh-start warmup loop, so the session's very
  // first real accumulate() call starts already on the attractor. Runs
  // inside the error scopes too: a validation error here means the whole
  // setup is broken and every later dispatch would silently no-op.
  const workgroupCount = NUM_CHAINS / WORKGROUP_SIZE;
  {
    const encoder = device.createCommandEncoder({
      label: "flame-gpu warmup",
    });
    const pass = encoder.beginComputePass({ label: "flame-gpu warmup pass" });
    pass.setPipeline(warmupPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupCount);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }

  // Close the scope pair opened before the first createBuffer (pop order is
  // the reverse of push). An OOM here is the "reported limits lie" case this
  // module's doc describes — classified FlameGpuSizeError so the session's
  // supersample ladder retries smaller ON this GPU instead of writing the
  // GPU off for the session.
  const validationError = await device.popErrorScope();
  const oomError = await device.popErrorScope();
  if (oomError) {
    throw new FlameGpuSizeError(
      `Flame GPU: out of memory creating resources for a ` +
        `${program.width}x${program.height} accumulation (~${Math.round(
          (histBytes * 2) / (1024 * 1024),
        )} MiB histogram + staging): ${oomError.message}`,
    );
  }
  if (validationError) {
    throw new Error(
      `Flame GPU: validation error during setup: ${validationError.message}`,
    );
  }

  // Firefox (and possibly others) blanks vendor/architecture rather than
  // omitting them — filter empties instead of trusting the whole info
  // object's truthiness, so a blank-but-present adapter.info still yields
  // `undefined` (no bare parenthesis in the UI note) rather than "".
  const info = adapter.info;
  // A fallback adapter is SOFTWARE WebGPU (SwiftShader-class) — flagged on
  // the backend for the session's device-loss-retry policy, and labeled so
  // the UI note never passes software rasterization off as the real GPU.
  // `isFallbackAdapter` still lives on the adapter itself in older
  // implementations — read both homes.
  const software =
    info.isFallbackAdapter === true ||
    (adapter as { isFallbackAdapter?: boolean }).isFallbackAdapter === true;
  const baseLabel = [info.vendor, info.architecture].filter(Boolean).join(" ");
  const adapterLabel = software
    ? `${baseLabel || "fallback adapter"} (software)`
    : baseLabel || undefined;

  // The one create-time diagnostic breadcrumb (fr-2w5): when a field report
  // says "it picked X", this line says what the context offered and what
  // was asked of it. console.info, not the session's log sink — same
  // pattern as the device-lost diagnostics in GpuFlameBackend's
  // constructor: informational, not part of the fallback control flow.
  console.info(
    `Flame GPU: backend up on "${adapterLabel ?? "unnamed adapter"}" — ` +
      `${program.width}x${program.height} accumulation, ` +
      `${Math.round(histBytes / (1024 * 1024))} MiB histogram + equal staging ` +
      `(device maxStorageBufferBindingSize ${Math.round(
        device.limits.maxStorageBufferBindingSize / (1024 * 1024),
      )} MiB, maxBufferSize ${Math.round(
        device.limits.maxBufferSize / (1024 * 1024),
      )} MiB)`,
  );

  return new GpuFlameBackend({
    software,
    device,
    accumulatePipeline,
    bindGroup,
    paramsBuffer,
    slotsBuffer,
    colorsBuffer,
    chainsBuffer,
    histBuffer,
    stagingBuffer,
    paramsItersOffsetBytes: program.paramsItersOffsetBytes,
    convertSnapshot: program.convertSnapshot,
    convertDisplay: program.convertDisplay,
    width: program.width,
    height: program.height,
    adapterLabel,
    downsampleXPipeline,
    downsampleYPipeline,
    downsampleBindGroup,
    intermediateBuffer,
    displayBuffer,
    displayStagingBuffer,
    downsampleWeightsBuffer,
    downsampleParamsBuffer,
    displayWidth: program.displayWidth,
    displayHeight: program.displayHeight,
  });
}

/**
 * Stand up one 3D accumulation's worth of GPU state for `request` and return
 * it behind the {@link FlameAccumBackend} seam — the `createGpuBackend`
 * factory `flame-worker.ts` wires into `FlameWorkerSession`. Matches
 * `FlameWorkerDeps.createGpuBackend`'s signature exactly, so it plugs in
 * with no adapter shim. Packs `flame-gpu.ts`'s program, then hands off to
 * the shared {@link createBackendForProgram} driver.
 */
export async function createGpuFlameBackend(
  request: GpuBackendRequest,
): Promise<FlameAccumBackend> {
  const packed = packGpuSystem({
    transforms: request.transforms,
    finalTransform: request.finalTransform,
    symmetry: { order: request.order, axis: request.axis },
    palette: request.palette,
  });
  // itersPerInvocation starts at WARMUP_ITERATIONS: the FIRST dispatch this
  // backend ever runs is the warmup one (see createBackendForProgram), which
  // reads this very same Params field (warmup and accumulate are two
  // specializations of the same WGSL entry point). GpuFlameBackend.
  // accumulate() takes over rewriting it, once construction hands back a
  // backend whose `currentItersPerInvocation` already agrees with this value.
  return createBackendForProgram({
    label: "3D kernel",
    kernel: FLAME_GPU_KERNEL_WGSL,
    params: packGpuParams({
      projection: request.projection,
      width: request.width,
      height: request.height,
      transformCount: packed.transformCount,
      baseTransformCount: packed.baseTransformCount,
      itersPerInvocation: WARMUP_ITERATIONS,
      colorMode: packed.colorMode,
      weighted: packed.weighted,
      hasFinal: packed.hasFinal,
      totalWeight: packed.totalWeight,
      colorDenom: packed.colorDenom,
      numChains: NUM_CHAINS,
    }),
    paramsItersOffsetBytes: PARAMS_ITERS_OFFSET_BYTES,
    slots: packed.slots,
    colors: packed.colors,
    chains: packGpuChains(NUM_CHAINS, request.seed),
    convertSnapshot: convertGpuHistogram,
    convertDisplay: convertGpuDisplayHistogram,
    width: request.width,
    height: request.height,
    displayWidth: request.displayWidth,
    displayHeight: request.displayHeight,
    progressiveFilterRadius: request.progressiveFilterRadius,
  });
}

/**
 * The 4D twin of {@link createGpuFlameBackend} (fr-e26): packs
 * `flame-gpu-4d.ts`'s program — the 4D kernel pinned against
 * `accumulateFlame4` — and hands off to the same shared driver. Matches
 * `FlameWorkerDeps.createGpuBackend4`'s signature exactly. Note the 4D
 * readback converters: the 4D kernel's buckets carry the fixed-point slice-
 * weight factor (see flame-gpu-4d.ts's module doc), so reading them back
 * with the 3D converters would inflate every value 256-fold.
 */
export async function createGpuFlameBackend4(
  request: GpuBackendRequest4,
): Promise<FlameAccumBackend> {
  const packed = packGpuSystem4({
    transforms4: request.transforms4,
    finalTransform4: request.finalTransform4,
    color: request.color,
  });
  // itersPerInvocation starts at WARMUP_ITERATIONS — same warmup contract as
  // the 3D factory above.
  return createBackendForProgram({
    label: "4D kernel",
    kernel: FLAME_GPU_KERNEL_4D_WGSL,
    params: packGpuParams4({
      projection: request.projection,
      width: request.width,
      height: request.height,
      transformCount: packed.transformCount,
      itersPerInvocation: WARMUP_ITERATIONS,
      weighted: packed.weighted,
      hasFinal: packed.hasFinal,
      totalWeight: packed.totalWeight,
      colorDenom: packed.colorDenom,
      numChains: NUM_CHAINS,
      view: request.view,
      color: request.color,
    }),
    paramsItersOffsetBytes: PARAMS4_ITERS_OFFSET_BYTES,
    slots: packed.slots,
    colors: packed.colors,
    chains: packGpuChains4(NUM_CHAINS, request.seed),
    convertSnapshot: convertGpuHistogram4,
    convertDisplay: convertGpuDisplayHistogram4,
    width: request.width,
    height: request.height,
    displayWidth: request.displayWidth,
    displayHeight: request.displayHeight,
    progressiveFilterRadius: request.progressiveFilterRadius,
  });
}
