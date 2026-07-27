/**
 * WebGPU compute renderer for FOLD 3D surface sessions (fr-tzdg) — the
 * integration of fr-q1f8's measured verdict: `surface-de-gpu.ts`'s image
 * kernel (the fold GLSL tracer's march + shading, mirrored term for term)
 * traces mandelboxKifs at ~49µs/ray on the same hardware where the WebGL
 * fragment tracer is unbounded (>1300µs/ray), compiles in ~0.1-0.3s where
 * the fold GLSL links in ~25s on Mesa (fr-096u's entry cliff), and — by
 * construction — never hands the driver an unbounded submission: a frame
 * is a sequence of small compute passes (`stepsThisPass` DE steps each)
 * with the active-ray list compacted host-side between them, the bench's
 * own march-loop shape.
 *
 * Division of labor: this module owns the DEVICE — acquisition, the
 * per-session pipeline (the DE is frozen at session enter, matching the
 * surface session's snapshot semantics), the bounded pass loop, readback —
 * and returns finished RGBA8 frames. scene.ts owns presentation (DataTexture
 * upload + the shared surface blit to the one WebGL canvas, so capture and
 * the recorder keep working unchanged) and assembles frame specs (camera,
 * tier budgets, live SurfaceParams). main.ts owns routing and choreography
 * (preview/settle cadence, fallback to the WebGL tracer).
 *
 * No Three.js here, deliberately: inputs are plain arrays and numbers, so
 * the module's contract is the kernel's byte-layout contract plus a handful
 * of pure helpers (background prefill, pass sizing) that carry unit tests.
 *
 * Failure taxonomy follows flame-gpu-backend.ts: a context with no usable
 * WebGPU throws {@link SurfaceComputeUnavailableError} (the session routes
 * to the WebGL tracer — THE fallback); anything else (WGSL compile, device
 * creation) is a plain rejection the session treats the same way. The
 * renderer never attempts its own fallback. `device.lost` latches
 * {@link SurfaceComputeRenderer.lost} and fires `onLost` once — the session
 * re-enters via the WebGL path.
 */

import {
  packSurfaceGpuMaps,
  packSurfaceGpuParams,
  packSurfaceGpuShade,
  packSurfaceGpuShadeMaps,
  SURFACE_GPU_PARAMS_BYTES,
  SURFACE_GPU_RAY_ACTIVE,
  SURFACE_GPU_SHADE_BYTES,
  surfaceDeKernelWgsl,
} from "../fractal/surface-de-gpu";
import { SURFACE_FOLD_BEAM_WIDTH, type SurfaceDE } from "../fractal/surface-de";
import type { Vec3 } from "../fractal/types";
import { clamp } from "../fractal/vec";
import { DARK_BACKDROP, hexToRgb01 } from "./constants";

/** Threads per workgroup — fr-q1f8's measured winner (private frontier,
 * stage-1 prune only; wg size itself measured a non-factor, 64 matches the
 * bench's private-variant default). */
export const SURFACE_COMPUTE_WORKGROUP_SIZE = 64;

/** Per-pass GPU-time target the adaptive `stepsThisPass` doubles toward —
 * the bench host loop's own pacing constant. Far under the ~7.5s i915
 * preemption watchdog (fr-096u) while keeping pass overhead amortized. */
export const SURFACE_COMPUTE_PASS_TARGET_MS = 250;

/** Cap on DE steps a single dispatch may advance a ray — the bench's own
 * bound; with the full march budget at 160 a frame is never more than a
 * few dozen passes. */
export const SURFACE_COMPUTE_MAX_STEPS_PER_PASS = 32;

/** Default interval between progressive presents of a long frame. */
export const SURFACE_COMPUTE_PROGRESS_MS = 500;

const BG_TOP = hexToRgb01(DARK_BACKDROP.top);
const BG_BOTTOM = hexToRgb01(DARK_BACKDROP.bottom);

/** A context with no usable WebGPU at all (`navigator.gpu` missing, or no
 * compatible adapter) — the session's signal to route to the WebGL tracer
 * without noting an error. */
export class SurfaceComputeUnavailableError extends Error {}

/** Everything one frame needs beyond the session-frozen DE: raster size,
 * camera, tier budgets, live lighting/color params. Assembled by scene.ts
 * (`surfaceComputeFrameSpec`) so the eps discipline stays in one place:
 * `acceptPixelEps` derives from the NATIVE buffer height (fr-7xgi — a
 * preview coarsens sampling, never acceptance), `tracePixelEps` from the
 * trace raster's own height (dither + normal probe scale). */
export interface SurfaceComputeFrameSpec {
  width: number;
  height: number;
  /** Column-major inverse(projection * view) — THREE.Matrix4.elements of
   * the exact matrix the GLSL tracer gets as uInvProjView. */
  invProjView: Float32Array;
  camPos: Vec3;
  acceptPixelEps: number;
  tracePixelEps: number;
  /** Tier depth clamp — previewMaxDepth(...) for previews, de.maxDepth
   * for full frames. */
  maxDepth: number;
  marchSteps: number;
  shadowSteps: number;
  aoTaps: number;
  /** Tier hit floor (fraction of boundingRadius) — surface-material.ts's
   * SURFACE_FULL_HIT_FLOOR / SURFACE_PREVIEW_HIT_FLOOR. */
  hitFloor: number;
  lightDir: Vec3;
  ambient: number;
  /** Index into SURFACE_COLOR_SOURCES — the shader's dispatch integer. */
  colorSource: number;
  colorSpeed: number;
  /** 256x4 RGBA bytes (scene.ts's Uint8-quantized ramp), or null for the
   * transform color source (a white LUT is bound, never sampled). */
  lut: Uint8Array | null;
  /** Monotonic version so the renderer re-uploads the LUT texture only
   * when the ramp actually changed. */
  lutVersion: number;
  dither: boolean;
}

export interface SurfaceComputeFrameOptions {
  /** Wall-clock cap for the whole frame; rays still active when it runs
   * out keep their background prefill and the frame reports `truncated`. */
  budgetMs?: number;
  /** Progressive present: called with a full-frame RGBA snapshot at most
   * every `progressIntervalMs` while rays are still marching. */
  onProgress?: (pixels: Uint8Array) => void;
  progressIntervalMs?: number;
}

export interface SurfaceComputeFrame {
  /** RGBA8, row 0 = bottom (the kernel's py=0 row is ndcY=-1), matching
   * an unflipped DataTexture under the shared blit quad. */
  pixels: Uint8Array;
  width: number;
  height: number;
  wallMs: number;
  /** Measured compute-submission time (excludes readbacks) — the honest
   * cost sample for the preview governor. */
  gpuMs: number;
  passes: number;
  truncated: boolean;
}

/**
 * The background gradient the kernel writes for miss rays, prefilled
 * host-side so rays still ACTIVE at a budget cut present backdrop instead
 * of stale memory (the kernel's documented host contract). Byte-for-byte
 * the kernel's own `pack4x8unorm(mix(bgBottom, bgTop, (py+0.5)/h))`:
 * pack4x8unorm rounds `floor(0.5 + 255*clamp(v))`, which is Math.round on
 * the positive domain — so a truncated frame's active pixels are
 * indistinguishable from its miss pixels.
 */
export function buildSurfaceComputeBackground(
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(width * height * 4);
  for (let py = 0; py < height; py++) {
    const v = clamp((py + 0.5) / height, 0, 1);
    const r = Math.round(
      clamp(BG_BOTTOM[0] + (BG_TOP[0] - BG_BOTTOM[0]) * v, 0, 1) * 255,
    );
    const g = Math.round(
      clamp(BG_BOTTOM[1] + (BG_TOP[1] - BG_BOTTOM[1]) * v, 0, 1) * 255,
    );
    const b = Math.round(
      clamp(BG_BOTTOM[2] + (BG_TOP[2] - BG_BOTTOM[2]) * v, 0, 1) * 255,
    );
    for (let px = 0; px < width; px++) {
      const o = (py * width + px) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** The bench host loop's adaptive pass sizing: double while the last pass
 * came in under target, capped. Pure so the pacing is unit-tested. */
export function nextStepsPerPass(current: number, lastPassMs: number): number {
  if (
    lastPassMs < SURFACE_COMPUTE_PASS_TARGET_MS &&
    current < SURFACE_COMPUTE_MAX_STEPS_PER_PASS
  ) {
    return Math.min(current * 2, SURFACE_COMPUTE_MAX_STEPS_PER_PASS);
  }
  return current;
}

const WHITE_LUT = new Uint8Array(256 * 4).fill(255);

interface FrameBuffers {
  rays: number;
  states: GPUBuffer;
  active: GPUBuffer;
  color: GPUBuffer;
  stagingStates: GPUBuffer;
  stagingColor: GPUBuffer;
  bindGroup: GPUBindGroup;
}

export class SurfaceComputeRenderer {
  /** Cheap sync routing predicate — a context without `navigator.gpu`
   * never even attempts {@link create}. */
  static supported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.gpu;
  }

  /**
   * Acquire a device and build the session pipeline for `de` (frozen — a
   * system edit re-enters the session, never retargets a live renderer).
   * `colors[j]`/`trapIndices[j]` shade `de.maps[j]`, the same per-slot
   * inputs the GLSL packer takes. Rejects with
   * {@link SurfaceComputeUnavailableError} when WebGPU is absent, or a
   * plain error (compile/validation) the caller treats identically: fall
   * back to the WebGL tracer.
   */
  static async create(
    de: SurfaceDE,
    colors: Vec3[],
    trapIndices: number[],
  ): Promise<SurfaceComputeRenderer> {
    if (!SurfaceComputeRenderer.supported()) {
      throw new SurfaceComputeUnavailableError(
        "Surface compute: WebGPU is not available (navigator.gpu is undefined)",
      );
    }
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) {
      throw new SurfaceComputeUnavailableError(
        "Surface compute: requestAdapter() returned null — no compatible GPU adapter",
      );
    }
    // Without requiredLimits the device silently defaults to WebGPU's
    // conservative spec minimums — the flame backend's fr-53k lesson. A
    // full-resolution settle's state buffer (16 bytes/ray) fits the 128MiB
    // default comfortably, but pass the adapter's real ceiling anyway so a
    // hi-res export never trips a limit the hardware doesn't have.
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    try {
      const renderer = await SurfaceComputeRenderer.buildOnDevice(
        device,
        de,
        colors,
        trapIndices,
      );
      return renderer;
    } catch (e) {
      // Partial resources die with the device — never leak a live
      // GPUDevice from a failed create (flame-gpu-backend's discipline).
      device.destroy();
      throw e;
    }
  }

  private static async buildOnDevice(
    device: GPUDevice,
    de: SurfaceDE,
    colors: Vec3[],
    trapIndices: number[],
  ): Promise<SurfaceComputeRenderer> {
    // The error-scope pair (out-of-memory outside, validation inside):
    // WebGPU's createBuffer never throws on allocation failure — it
    // returns an invalid buffer whose failure would otherwise surface
    // mid-render with a message naming the wrong thing.
    device.pushErrorScope("out-of-memory");
    device.pushErrorScope("validation");

    const code = surfaceDeKernelWgsl({
      mode: "image",
      width: SURFACE_FOLD_BEAM_WIDTH,
      workgroupSize: SURFACE_COMPUTE_WORKGROUP_SIZE,
      sharedFrontier: false,
      bnbStage2: false,
    });
    const module = device.createShaderModule({ code });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === "error");
    if (errors.length > 0) {
      throw new Error(
        `Surface compute: WGSL compile failed:\n${errors
          .map((m) => `${String(m.lineNum)}:${String(m.linePos)}: ${m.message}`)
          .join("\n")}`,
      );
    }

    const layout = device.createBindGroupLayout({
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
          buffer: { type: "uniform" },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 7,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 8,
          visibility: GPUShaderStage.COMPUTE,
          sampler: { type: "filtering" },
        },
      ],
    });
    const pipeline = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: "marchShadeRays" },
    });

    const paramsBuf = device.createBuffer({
      size: SURFACE_GPU_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const shadeBuf = device.createBuffer({
      size: SURFACE_GPU_SHADE_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Re-wrapped copies: the kernel packers' bare Float32Array types
    // (ArrayBufferLike-backed) don't satisfy writeBuffer's non-shared
    // buffer requirement — the bench's own idiom.
    const mapsData = new Float32Array(packSurfaceGpuMaps(de));
    const mapsBuf = device.createBuffer({
      size: mapsData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(mapsBuf, 0, mapsData);
    const shadeMapsData = new Float32Array(
      packSurfaceGpuShadeMaps(colors, trapIndices),
    );
    const shadeMapsBuf = device.createBuffer({
      size: shadeMapsData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(shadeMapsBuf, 0, shadeMapsData);
    const lutTex = device.createTexture({
      size: { width: 256, height: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: lutTex },
      WHITE_LUT,
      { bytesPerRow: 256 * 4 },
      { width: 256, height: 1 },
    );
    const lutSamp = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    const validation = await device.popErrorScope();
    const oom = await device.popErrorScope();
    const scopeError = validation ?? oom;
    if (scopeError) {
      throw new Error(
        `Surface compute: resource creation failed: ${scopeError.message}`,
      );
    }

    return new SurfaceComputeRenderer(
      device,
      de,
      pipeline,
      layout,
      paramsBuf,
      shadeBuf,
      mapsBuf,
      shadeMapsBuf,
      lutTex,
      lutSamp,
    );
  }

  /** Latched true by `device.lost` (or {@link destroy}); every later
   * {@link renderFrame} resolves null. */
  get lost(): boolean {
    return this.isLost;
  }

  /** Fired once when the device is lost OUTSIDE {@link destroy} — the
   * session's cue to re-enter via the WebGL path. */
  onLost: (() => void) | null = null;

  private isLost = false;
  private destroyed = false;
  private frameToken = 0;
  /** Serializes frames: they share buffers and staging maps, so two pass
   * loops must never interleave. */
  private chain: Promise<unknown> = Promise.resolve();
  private frame: FrameBuffers | null = null;
  private uploadedLutVersion: number | null = null;
  private background: {
    width: number;
    height: number;
    rows: Uint8Array<ArrayBuffer>;
  } | null = null;

  private constructor(
    private readonly device: GPUDevice,
    private readonly de: SurfaceDE,
    private readonly pipeline: GPUComputePipeline,
    private readonly layout: GPUBindGroupLayout,
    private readonly paramsBuf: GPUBuffer,
    private readonly shadeBuf: GPUBuffer,
    private readonly mapsBuf: GPUBuffer,
    private readonly shadeMapsBuf: GPUBuffer,
    private readonly lutTex: GPUTexture,
    private readonly lutSamp: GPUSampler,
  ) {
    void this.device.lost.then(() => {
      this.isLost = true;
      if (!this.destroyed) this.onLost?.();
    });
  }

  /**
   * Trace one frame as bounded compute passes and resolve with its RGBA8
   * pixels — or null when superseded ({@link cancel} or a newer frame),
   * lost, or destroyed. Frames are serialized internally; latest-wins
   * semantics belong to the caller (cancel, then request anew).
   */
  renderFrame(
    spec: SurfaceComputeFrameSpec,
    opts: SurfaceComputeFrameOptions = {},
  ): Promise<SurfaceComputeFrame | null> {
    const token = ++this.frameToken;
    const run = this.chain.then(() =>
      this.runFrame(token, spec, opts).catch((error: unknown) => {
        // A destroyed/lost device rejects in-flight awaits — that is a
        // cancellation, not a render error. Anything else is logged once
        // and degrades to "no frame"; the session's lost-latch (not this
        // path) owns recovery.
        if (!this.destroyed && !this.isLost) {
          console.error("Surface compute frame failed", error);
        }
        return null;
      }),
    );
    this.chain = run;
    return run;
  }

  /** Supersede any in-flight and queued frames — they resolve null at
   * their next await. */
  cancel(): void {
    this.frameToken++;
  }

  /** Cancel, then tear the device down. Safe to call twice; `onLost` does
   * not fire for a deliberate destroy. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.frameToken++;
    this.device.destroy();
  }

  private ensureFrameBuffers(rays: number): FrameBuffers {
    if (this.frame && this.frame.rays >= rays) return this.frame;
    if (this.frame) {
      for (const b of [
        this.frame.states,
        this.frame.active,
        this.frame.color,
        this.frame.stagingStates,
        this.frame.stagingColor,
      ]) {
        b.destroy();
      }
    }
    const device = this.device;
    const states = device.createBuffer({
      size: rays * 16,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
    const active = device.createBuffer({
      size: rays * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const color = device.createBuffer({
      size: rays * 4,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
    const stagingStates = device.createBuffer({
      size: rays * 16,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const stagingColor = device.createBuffer({
      size: rays * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: { buffer: this.mapsBuf } },
        { binding: 2, resource: { buffer: active } },
        { binding: 3, resource: { buffer: states } },
        { binding: 4, resource: { buffer: this.shadeBuf } },
        { binding: 5, resource: { buffer: this.shadeMapsBuf } },
        { binding: 6, resource: { buffer: color } },
        { binding: 7, resource: this.lutTex.createView() },
        { binding: 8, resource: this.lutSamp },
      ],
    });
    this.frame = {
      rays,
      states,
      active,
      color,
      stagingStates,
      stagingColor,
      bindGroup,
    };
    return this.frame;
  }

  private backgroundRows(
    width: number,
    height: number,
  ): Uint8Array<ArrayBuffer> {
    const cached = this.background;
    if (cached && cached.width === width && cached.height === height) {
      return cached.rows;
    }
    const rows = buildSurfaceComputeBackground(width, height);
    this.background = { width, height, rows };
    return rows;
  }

  private async readback(
    src: GPUBuffer,
    staging: GPUBuffer,
    bytes: number,
  ): Promise<ArrayBuffer> {
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(src, 0, staging, 0, bytes);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ, 0, bytes);
    const copy = staging.getMappedRange(0, bytes).slice(0);
    staging.unmap();
    return copy;
  }

  private async runFrame(
    token: number,
    spec: SurfaceComputeFrameSpec,
    opts: SurfaceComputeFrameOptions,
  ): Promise<SurfaceComputeFrame | null> {
    if (token !== this.frameToken || this.isLost || this.destroyed) return null;
    const wallStart = performance.now();
    const budgetMs = opts.budgetMs ?? Infinity;
    const progressMs = opts.progressIntervalMs ?? SURFACE_COMPUTE_PROGRESS_MS;
    const { width, height } = spec;
    const rays = width * height;
    const device = this.device;
    const buffers = this.ensureFrameBuffers(rays);

    if (spec.lutVersion !== this.uploadedLutVersion) {
      device.queue.writeTexture(
        { texture: this.lutTex },
        // Re-wrapped: the spec's bytes are scene.ts's live texture data
        // (ArrayBufferLike-typed); 1KB per ramp change.
        spec.lut ? new Uint8Array(spec.lut) : WHITE_LUT,
        { bytesPerRow: 256 * 4 },
        { width: 256, height: 1 },
      );
      this.uploadedLutVersion = spec.lutVersion;
    }
    device.queue.writeBuffer(
      this.shadeBuf,
      0,
      packSurfaceGpuShade({
        invProjView: spec.invProjView,
        lightDir: spec.lightDir,
        ambient: spec.ambient,
        bgTop: BG_TOP,
        bgBottom: BG_BOTTOM,
        colorSpeed: spec.colorSpeed,
        tracePixelEps: spec.tracePixelEps,
        colorSource: spec.colorSource,
        shadowSteps: spec.shadowSteps,
        aoTaps: spec.aoTaps,
        dither: spec.dither,
      }),
    );
    // Host prefill contract (module doc of surface-de-gpu.ts): rays still
    // ACTIVE at a budget cut keep this backdrop; the kernel writes every
    // terminal pixel itself.
    device.queue.writeBuffer(
      buffers.color,
      0,
      this.backgroundRows(width, height),
    );
    const states = new Float32Array(rays * 4);
    for (let i = 0; i < rays; i++) states[i * 4] = -1;
    device.queue.writeBuffer(buffers.states, 0, states);

    let active = new Uint32Array(rays);
    for (let i = 0; i < rays; i++) active[i] = i;
    let stepsThisPass = 1;
    let passes = 0;
    let gpuMs = 0;
    let truncated = false;
    let lastProgress = wallStart;

    while (active.length > 0) {
      if (performance.now() - wallStart > budgetMs) {
        truncated = true;
        break;
      }
      const params = packSurfaceGpuParams(this.de, {
        itemCount: active.length,
        stepsThisPass,
        marchSteps: spec.marchSteps,
        maxDepth: spec.maxDepth,
        hitFloor: spec.hitFloor,
        cutoff: 0,
        footprint: 0,
        pose: {
          ro: spec.camPos,
          right: [1, 0, 0],
          up: [0, 1, 0],
          fwd: [0, 0, 1],
          tanHalf: 0,
          aspect: width / Math.max(1, height),
          rasterWidth: width,
          rasterHeight: height,
          // The ACCEPTANCE slope (fr-7xgi): eps = max(pixelEps * t,
          // hitFloorEps) in the kernel's march — native-height derived,
          // tier-independent.
          pixelEps: spec.acceptPixelEps,
        },
      });
      device.queue.writeBuffer(this.paramsBuf, 0, params);
      device.queue.writeBuffer(buffers.active, 0, active);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, buffers.bindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(active.length / SURFACE_COMPUTE_WORKGROUP_SIZE),
      );
      pass.end();
      const t0 = performance.now();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      if (token !== this.frameToken || this.isLost || this.destroyed)
        return null;
      const passMs = performance.now() - t0;
      gpuMs += passMs;
      passes++;

      const stateCopy = new Float32Array(
        await this.readback(buffers.states, buffers.stagingStates, rays * 16),
      );
      if (token !== this.frameToken || this.isLost || this.destroyed)
        return null;
      const next: number[] = [];
      for (const ray of active) {
        if (stateCopy[ray * 4 + 1] === SURFACE_GPU_RAY_ACTIVE) next.push(ray);
      }
      active = Uint32Array.from(next);
      stepsThisPass = nextStepsPerPass(stepsThisPass, passMs);

      const now = performance.now();
      if (
        opts.onProgress &&
        active.length > 0 &&
        now - lastProgress >= progressMs
      ) {
        const partial = new Uint8Array(
          await this.readback(buffers.color, buffers.stagingColor, rays * 4),
        );
        if (token !== this.frameToken || this.isLost || this.destroyed)
          return null;
        lastProgress = performance.now();
        opts.onProgress(partial);
      }
    }

    const pixels = new Uint8Array(
      await this.readback(buffers.color, buffers.stagingColor, rays * 4),
    );
    if (token !== this.frameToken || this.isLost || this.destroyed) return null;
    return {
      pixels,
      width,
      height,
      wallMs: performance.now() - wallStart,
      gpuMs,
      passes,
      truncated,
    };
  }
}
