/**
 * The WebGPU flame-accumulation backend's BROWSER side: plugs
 * `flame-gpu.ts`'s pure packing/planning/conversion layer into the flame
 * worker session's {@link FlameAccumBackend} seam (`flame-worker-core.ts`).
 * `flame-worker.ts` wires {@link createGpuFlameBackend} in as that seam's
 * `createGpuBackend` factory, so everything here runs INSIDE the flame
 * worker — `navigator.gpu` below is the `WorkerNavigator`'s, not the main
 * thread's (see that module's own doc for why `self`/`navigator` aren't
 * typed via the `webworker` lib in this project).
 *
 * Structurally this is the GPU flame-accumulation spike's driver
 * (`docs/flame-gpu-accumulation-spike.md`), restated against this module's
 * COMMITTED layout/API: 240 B slots (15 variation lanes, the Mandelbox fold
 * family bringing the original 12 to 15) and 8-word (emulated-u64)
 * histogram buckets instead of the spike's 144 B/4-lane/single-u32 shapes,
 * and `flame-gpu.ts`'s exported
 * `packGpuSystem`/`packGpuChains`/`packGpuParams`/`planGpuDispatches`/
 * `convertGpuHistogram` instead of the spike's local (unexported) packing
 * helpers. See that file's module doc for the byte-layout contract this
 * drives and the WGSL kernel itself.
 *
 * The driver body — device acquisition, buffer/bind-group/pipeline
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
 * what went wrong, and a CLASS naming its kind: `FlameGpuUnavailableError`
 * when the context has no usable WebGPU, `FlameGpuSizeError` when the
 * accumulation size is what failed (device limits, or a scoped
 * out-of-memory at resource creation), plain `Error` otherwise.
 * `flame-worker-core.ts`'s `FlameWorkerSession` (`handleGpuFailure` — the
 * supersample-shrink ladder in front of the `gpuFailed` ratchet) owns all
 * recovery and keys its retry policy off those classes. Diagnostics that
 * aren't part of that control flow (a genuinely lost device, an uncaptured
 * device error mid-render, the one-line backend-up breadcrumb) just
 * `console.info`/`console.error` — the session's own `log` sink is what
 * tells the user-visible fallback story once the next `accumulate()`
 * throws.
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
  packGpuColorLUT,
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
import { webgpuAdapterStatus } from "./render-backend";
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
 * {@link WORKGROUP_SIZE} (512 workgroups at 128). The spike measured this
 * as a good default across integrated and discrete GPUs; unlike the
 * spike, this isn't caller-configurable — one fixed value keeps the packed
 * chains buffer's size (and thus a big chunk of this backend's VRAM
 * footprint) predictable from the accumulation resolution alone.
 *
 * The phone validation kept this same value for mobile: an arm-valhall
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
 * dimension-named converters over the shared weighted bucket layout. */
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
 * One accumulation program's worth of dimension-SPECIFIC state:
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
  /** Independent balloon colors; absent aliases binding 5 to `colors`. */
  echoColors?: ArrayBuffer;
  chains: ArrayBuffer;
  convertSnapshot: SnapshotConverter;
  convertDisplay: DisplayConverter;
  /** Accumulation resolution (display size x effective supersample). */
  width: number;
  height: number;
  /** Display resolution + progressive filter radius — sizes the
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
export interface GpuFlameBackendInit {
  device: GPUDevice;
  accumulatePipeline: GPUComputePipeline;
  bindGroup: GPUBindGroup;
  /** Only the buffers the backend itself still TOUCHES are handed over:
   * `params` for `accumulate`'s one mid-session rewrite, and the two
   * copy/readback pairs. The rest of the packed set (slots, colors, chains,
   * the downsample intermediate/weights/params) is reachable only through
   * the bind groups above, which is all it ever needed to be — the backend
   * held references purely so its `destroy()` could free them one by one,
   * and `device.destroy()` does that. */
  paramsBuffer: GPUBuffer;
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
  /** The progressive-display two-pass separable downsample's
   * pipelines, buffers, and shared bind group — see `snapshotDisplay`'s doc. */
  downsampleXPipeline: GPUComputePipeline;
  downsampleYPipeline: GPUComputePipeline;
  downsampleBindGroup: GPUBindGroup;
  displayBuffer: GPUBuffer;
  displayStagingBuffer: GPUBuffer;
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
 *
 * Exported for `flame-gpu-backend.test.ts`, which drives the teardown
 * lifecycle ({@link destroy}, {@link beginOp}, {@link releaseOp}) over a
 * fake device — the same injected-fakes seam `FlameWorkerSession` is tested
 * through, and the only way to pin a state machine whose real inputs are a
 * GPU driver's timing. Production code reaches this class through the two
 * factories at the bottom of this file, never by name.
 */
export class GpuFlameBackend implements FlameAccumBackend {
  readonly kind = "gpu" as const;
  readonly adapterLabel?: string;
  readonly software: boolean;

  private readonly device: GPUDevice;
  private readonly accumulatePipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly paramsBuffer: GPUBuffer;
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
   * caller. Lazy because these are accumulation-resolution
   * Float64 arrays on the CPU heap — up to gigabytes at a desktop
   * resolution x supersample — and progressive redisplays never touch them
   * (they use `snapshotDisplay`): only the finished frame does. Allocating
   * them eagerly at create time taxed every GPU render with memory
   * pressure that — measured — directly shrinks how much the
   * GPU allocator will grant this same render's device buffers. */
  private outHistogram: FlameHistogram | null = null;
  /** The progressive-display two-pass downsample's pipelines,
   * buffers, and shared bind group — see `snapshotDisplay`'s doc. */
  private readonly downsampleXPipeline: GPUComputePipeline;
  private readonly downsampleYPipeline: GPUComputePipeline;
  private readonly downsampleBindGroup: GPUBindGroup;
  private readonly displayBuffer: GPUBuffer;
  private readonly displayStagingBuffer: GPUBuffer;
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
   * handler wired up below. Checked by {@link beginOp} so a doomed device
   * fails fast with a clear message instead of queuing a dispatch that will
   * never complete. */
  private lost = false;
  /** True once {@link destroy} has been called. It means "teardown
   * REQUESTED", not "device gone": with an op still parked on
   * live submitted GPU work, the real teardown is deferred until
   * {@link opsInFlight} drains. {@link beginOp} refuses new work once this
   * is set, which is what makes that drain finite. {@link deviceDestroyed}
   * carries the device's actual state. */
  private destroyed = false;
  /** True once `device.destroy()` has actually run — the one-shot guard
   * over the two paths that reach the real teardown ({@link destroy}, when
   * nothing was in flight, and {@link releaseOp}, when the last in-flight
   * op just unwound), since `destroyed` alone no longer tells those two
   * apart. */
  private deviceDestroyed = false;
  /** GPU work spans between their `queue.submit` and their final unwind:
   * `accumulate`'s `onSubmittedWorkDone`, and the two snapshots' `mapAsync`
   * over a submitted `copyBufferToBuffer`. Tearing this backend down out
   * from under one of those is the browser-killing teardown measured one
   * module over, so {@link destroy} hands the real teardown to whichever op
   * unwinds last. Each op parks on exactly ONE await, so the wait is
   * bounded by the chunk already in flight and there is nothing to cancel —
   * unlike `SurfaceComputeRenderer`, whose multi-await frames need a token
   * bump to bail out early. */
  private opsInFlight = 0;

  constructor(init: GpuFlameBackendInit) {
    this.device = init.device;
    this.accumulatePipeline = init.accumulatePipeline;
    this.bindGroup = init.bindGroup;
    this.paramsBuffer = init.paramsBuffer;
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
    this.displayBuffer = init.displayBuffer;
    this.displayStagingBuffer = init.displayStagingBuffer;
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
    this.beginOp("accumulate");
    try {
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
    } finally {
      this.releaseOp();
    }
  }

  async snapshot(): Promise<FlameHistogram> {
    this.beginOp("snapshot");
    try {
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
    } finally {
      this.releaseOp();
    }
  }

  /**
   * The progressive-display downsample — runs the two-pass separable
   * Gaussian filter (`FLAME_GPU_DOWNSAMPLE_WGSL`) over the RESIDENT `hist`
   * buffer (no full-histogram readback) and reads back only a
   * `displayWidth x displayHeight` f32 histogram into `out`. Both dispatches
   * go in ONE compute pass: WebGPU orders a pass's dispatches so each one
   * observes the prior dispatch's storage writes, so downsampleY always sees
   * downsampleX's freshly-written `intermediate` buffer, never a stale one.
   */
  async snapshotDisplay(out: FlameHistogram): Promise<FlameHistogram> {
    this.beginOp("snapshot display");
    try {
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
    } finally {
      this.releaseOp();
    }
  }

  /**
   * Refuse-or-count, the one gate all three GPU entry points pass through.
   * A lost device and a requested teardown both fail fast with a
   * message naming `what`; anything that gets past them is COUNTED into
   * {@link opsInFlight} until its `finally` releases it.
   *
   * Refusing after `destroy()` is not defensive validation — it is what
   * gives the deferred teardown a state to be in. Before it a
   * destroyed backend held a destroyed device, so work submitted to it
   * could do nothing by construction; now the device outlives `destroy()`
   * by up to one op, and a backend that kept accepting work would keep
   * running a superseded accumulation on a live device the session has
   * already replaced — and could hold that device (and its VRAM) alive
   * indefinitely behind its own successor. Nothing in the shipped worker
   * actually trips it: `startAccumulation` nulls `this.backend` in the same
   * breath as destroying it, and every `runChunk` resume re-checks its
   * generation before touching the backend again. So the refusal is the
   * retired state's DEFINITION rather than a live path — and if one ever
   * did reach it, that caller is by construction a stale chunk whose
   * rejection lands in a `catch` that already knows to drop it.
   */
  private beginOp(what: string): void {
    if (this.lost) {
      throw new Error(`Flame GPU: device is lost, cannot ${what}`);
    }
    if (this.destroyed) {
      throw new Error(`Flame GPU: backend is destroyed, cannot ${what}`);
    }
    this.opsInFlight++;
  }

  /** One counted op ({@link beginOp}) has fully unwound — success, throw or
   * rejection alike, since every call site releases from a `finally`. If
   * {@link destroy} came in while it was live, this is the last one out and
   * owes the deferred teardown. */
  private releaseOp(): void {
    this.opsInFlight--;
    if (this.opsInFlight === 0 && this.destroyed) this.destroyDevice();
  }

  /**
   * Retire this backend — immediately if nothing is in flight, or deferred
   * to {@link releaseOp} if an op is still parked on live submitted GPU
   * work. Idempotent, per the {@link FlameAccumBackend.destroy} contract;
   * the early return means a second call during the deferred window is a
   * no-op and will NOT retry the teardown, which is fine only because the
   * FIRST call already committed it to {@link releaseOp}.
   *
   * Stays synchronous and `void`: `flame-worker-core.ts`'s
   * `startAccumulation` is a command handler that must land its restart in
   * one tick, and the seam's own contract declares this `void`. The idle
   * path therefore still tears down inline — which is also what gpu-bench's
   * `finally { backend.destroy(); }` scenarios rely on to keep one device
   * alive at a time (their destroys all follow an `await` that already
   * resolved, so the counter is zero there).
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.opsInFlight > 0) return;
    this.destroyDevice();
  }

  /**
   * The actual teardown, behind the one-shot {@link deviceDestroyed}
   * guard: reachable from both {@link destroy} (idle) and
   * {@link releaseOp} (the last in-flight op just finished), and
   * `destroyed` alone no longer tells those two calls apart.
   *
   * `device.destroy()` reclaims every buffer this backend owns, so the
   * eleven explicit `GPUBuffer.destroy()` calls that used to run ahead of it
   * are GONE rather than merely reordered: two of them are the staging
   * buffers a parked `mapAsync` holds a pending mapping on, and freeing a
   * buffer out from under a pending map is its own crash vector — the same
   * class of bug this deferral exists to close.
   */
  private destroyDevice(): void {
    if (this.deviceDestroyed) return;
    this.deviceDestroyed = true;
    this.device.destroy();
  }
}

/**
 * Stand up one accumulation's worth of GPU state for a packed
 * {@link GpuProgramSpec} and return it behind the {@link FlameAccumBackend}
 * seam — the dimension-agnostic driver both factories share (this is the
 * whole body `createGpuFlameBackend` owned before the 4D kernel
 * existed, with the program-specific inputs parameterized out).
 *
 * Every early-exit here is a thrown `Error` (which, inside this `async`
 * function, becomes a REJECTED promise) with a message naming what failed;
 * see the module doc for why this never attempts its own CPU fallback. The
 * error's CLASS is the session's classification signal:
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
  // hardware that supports far more — the spike caught this the hard
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
 * snapshot readback — reproduced exactly this at 4K x supersample 3, and
 * a Firefox field report was the same mechanism). The scopes
 * convert that into a create-time, classified, retryable failure. Measured
 * on both Chrome and Firefox: allocation refusals DO report synchronously
 * through `pushErrorScope("out-of-memory")` here, at sizes far below the
 * limits the adapter reports (see `docs/flame-gpu-selection-investigation.md`
 * and scripts/gpu-probe.mjs).
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

  // In inherit/off mode binding 5 aliases the primary table and the kernel's
  // flag keeps it unread, avoiding a second allocation/upload. A selected
  // balloon palette gets its own immutable 4 KiB table.
  let echoColorsBuffer = colorsBuffer;
  if (program.echoColors) {
    echoColorsBuffer = device.createBuffer({
      label: "flame-gpu echo colors",
      size: program.echoColors.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(echoColorsBuffer, 0, program.echoColors);
  }

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
  // backend's whole lifetime — a fresh mappable buffer per call (as the
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
      {
        binding: 5,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
    ],
  });
  // An explicit (not "auto") pipeline layout, shared by both pipelines
  // below, so ONE bind group works for both — "auto" layouts can't share a
  // bind group across pipelines, and warmup/accumulate must read/write the
  // exact same buffers (a spike lesson).
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
      { binding: 5, resource: { buffer: echoColorsBuffer } },
    ],
  });

  // The progressive-display two-pass separable downsample — built
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
  // device-limit guard is needed here.
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
  // above) as a read-only resource — the whole point of the GPU downsample
  // is running it over that RESIDENT buffer, never reading it back in full.
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

  // A fallback adapter is SOFTWARE WebGPU (SwiftShader-class) — flagged on
  // the backend for the session's device-loss-retry policy, and labeled so
  // the UI note never passes software rasterization off as the real GPU.
  // Detection + label shape live in render-backend.ts, shared
  // with the surface compute renderer: the fallback flag's older home on
  // the adapter itself is read too, and the string tell catches the
  // real-looking software stacks Chrome hands out with `isFallbackAdapter`
  // unset (the field incident that made the string tell necessary).
  const { label: adapterLabel, software } = webgpuAdapterStatus(
    adapter.info,
    (adapter as { isFallbackAdapter?: boolean }).isFallbackAdapter,
  );

  // The one create-time diagnostic breadcrumb: when a field report
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
    displayBuffer,
    displayStagingBuffer,
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
    symmetry: { order: request.order, plane: request.plane },
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
      numChains: NUM_CHAINS,
      echo: request.echo,
      echoPalette: request.echoColorLUT !== undefined,
    }),
    paramsItersOffsetBytes: PARAMS_ITERS_OFFSET_BYTES,
    slots: packed.slots,
    colors: packed.colors,
    echoColors: request.echoColorLUT
      ? packGpuColorLUT(request.echoColorLUT)
      : undefined,
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
 * The 4D twin of {@link createGpuFlameBackend}: packs
 * `flame-gpu-4d.ts`'s program — the 4D kernel pinned against
 * `accumulateFlame4` — and hands off to the same shared driver. Matches
 * `FlameWorkerDeps.createGpuBackend4`'s signature exactly. Note the 4D
 * dimension-named readback converters over the shared x256 weighted layout.
 */
export async function createGpuFlameBackend4(
  request: GpuBackendRequest4,
): Promise<FlameAccumBackend> {
  const packed = packGpuSystem4({
    transforms4: request.transforms4,
    finalTransform4: request.finalTransform4,
    symmetry: {
      order: request.order,
      plane: request.plane,
      twist: request.twist,
    },
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
      baseTransformCount: packed.baseTransformCount,
      itersPerInvocation: WARMUP_ITERATIONS,
      weighted: packed.weighted,
      hasFinal: packed.hasFinal,
      totalWeight: packed.totalWeight,
      numChains: NUM_CHAINS,
      view: request.view,
      color: request.color,
      echo: request.echo,
      echoPalette: request.echoColorLUT !== undefined,
      rotorProjection: request.rotorProjection,
      cameraProjection: request.cameraProjection,
    }),
    paramsItersOffsetBytes: PARAMS4_ITERS_OFFSET_BYTES,
    slots: packed.slots,
    colors: packed.colors,
    echoColors: request.echoColorLUT
      ? packGpuColorLUT(request.echoColorLUT)
      : undefined,
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
