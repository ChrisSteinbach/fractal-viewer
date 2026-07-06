/**
 * SPIKE (fr-53k, throwaway): WebGPU-side driver for `kernel.ts`'s
 * FLAME_KERNEL_WGSL. This module owns everything kernel.ts's doc comment
 * calls "the engine": packing plain-object systems into the exact
 * Params/Slot/Chain/colors byte layouts the shader expects, and the
 * dispatch/readback lifecycle around it.
 *
 * The Slot packing below re-derives `chaos-game.ts`'s `prepareChaosGame`
 * expansion (copy-major: for k in 0..order, for i in 0..baseTransformCount)
 * directly from `Transform[]`, using only its EXPORTED primitives
 * (`composeAffine`, `rotationMatrixXYZ`, `effectiveSymmetryOrder`) rather than
 * `PreparedChaosGame` itself — the CPU's `Affine`/`VariationBlend` shapes
 * are closures, not the flat numbers a GPU buffer needs, so this is a
 * parallel encoder of the same rules, not a reuse of the CPU's output.
 */
import {
  COLOR_FIXED_POINT_SCALE,
  FLAME_KERNEL_WGSL,
  KERNEL_VARIATION_INDEX,
  MAX_SLOT_VARIATIONS,
  WORKGROUP_SIZE,
} from "./kernel";
import { composeAffine, rotationMatrixXYZ } from "../../fractal/affine";
import {
  effectiveSymmetryOrder,
  WARMUP_ITERATIONS,
} from "../../fractal/chaos-game";
import { transformColors } from "../../fractal/color";
import { createFlameHistogram } from "../../fractal/flame";
import type { FlameHistogram, Mat4 } from "../../fractal/flame";
import { buildPaletteLUT } from "../../fractal/palette";
import type { FlamePaletteId } from "../../fractal/palette";
import { mulberry32 } from "../../fractal/rng";
import type {
  SymmetryAxis,
  SymmetryParams,
  Transform,
  Variation,
} from "../../fractal/types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A chaos-game system, in exactly the shape needed to pack the kernel's
 * Slot/colors buffers — the GPU counterpart of the arguments
 * `prepareChaosGame` + `accumulateFlame`'s `palette`/`colorLUT` take. */
export interface GpuFlameSystem {
  transforms: Transform[];
  finalTransform: Transform | null;
  symmetry: SymmetryParams;
  /** `"legacy"` selects the kernel's per-(base)transform color mode; any
   * other id selects the 256-entry gradient LUT mode. */
  paletteId: FlamePaletteId;
}

export interface GpuFlameOptions {
  /** Accumulation resolution — NOT necessarily display resolution; see
   * `main.ts`'s supersampled accumulate-then-downsample pipeline. */
  width: number;
  height: number;
  /** Row-major camera projection*view — same convention as `flame.ts`'s
   * `Mat4` (`accumulateFlame`'s `projection` argument). */
  projection: Mat4;
  seed: number;
  /** Independent chains iterated in parallel; must be a multiple of
   * WORKGROUP_SIZE. Defaults to 65536 (512 workgroups at WORKGROUP_SIZE 128). */
  numChains?: number;
  /** Iterations each invocation runs per dispatch. Defaults to 512. */
  itersPerInvocation?: number;
}

const DEFAULT_NUM_CHAINS = 65536;
const DEFAULT_ITERS_PER_INVOCATION = 512;

// ---------------------------------------------------------------------------
// Byte layout constants — kernel.ts's doc comment is the single source of
// truth for these; this module packs ArrayBuffers to match, exactly.
// ---------------------------------------------------------------------------

const PARAMS_BYTES = 96;
const SLOT_STRIDE = 144;
const CHAIN_STRIDE = 32;
/** colors: array<vec4u, 256>. */
const COLORS_BYTES = 256 * 16;
const COLORS_ENTRIES = 256;
/** hist bucket: 4 x u32 (hits, r, g, b) — see `readHistogram`. */
const HIST_U32_PER_BUCKET = 4;

/** Element offsets (4-byte units) into one Slot's combined Float32/Uint32
 * view — see kernel.ts's Slot struct doc. */
const F32_PER_SLOT = SLOT_STRIDE / 4; // 36
const SLOT_ROW_X = 0;
const SLOT_ROW_Y = 4;
const SLOT_ROW_Z = 8;
const SLOT_POST_X = 12;
const SLOT_POST_Y = 16;
const SLOT_POST_Z = 20;
const SLOT_VAR_WEIGHTS = 24;
const SLOT_VAR_TYPES = 28;
const SLOT_VAR_COUNT = 32;
const SLOT_HAS_POST = 33;
const SLOT_CUM_WEIGHT = 34;
// index 35 is Slot's trailing pad — left at ArrayBuffer's zero default.

/** Element offsets (4-byte units) into one Chain's combined Float32/Uint32
 * view — see kernel.ts's Chain struct doc. */
const F32_PER_CHAIN = CHAIN_STRIDE / 4; // 8
const CHAIN_POS = 0; // pos.xyzw: x, y, z, colorCoord
const CHAIN_META_X = 4; // meta.x: rng state (meta.yzw unused, left zeroed)

/** Element offsets (4-byte units) into the Params uniform buffer's combined
 * Float32/Uint32 view — see kernel.ts's Params struct doc. */
const P_PROJ_X = 0;
const P_PROJ_Y = 4;
const P_PROJ_W = 8;
const P_WIDTH = 12;
const P_HEIGHT = 13;
const P_TRANSFORM_COUNT = 14;
const P_BASE_TRANSFORM_COUNT = 15;
const P_ITERS_PER_INVOCATION = 16;
const P_COLOR_MODE = 17;
const P_WEIGHTED = 18;
const P_HAS_FINAL = 19;
const P_TOTAL_WEIGHT = 20;
const P_COLOR_DENOM = 21;
const P_NUM_CHAINS = 22;
// index 23 is Params' trailing pad.

// ---------------------------------------------------------------------------
// CPU-side packing — mirrors chaos-game.ts's prepareChaosGame + flame.ts's
// accumulateFlame color/weight handling, restated over flat GPU buffers.
// ---------------------------------------------------------------------------

/** `chaos-game.ts`'s private `symmetryRotation`, restated here since only
 * `rotationMatrixXYZ` (not that helper) is exported. */
function symmetryPostRotation(axis: SymmetryAxis, angle: number): number[] {
  switch (axis) {
    case "x":
      return rotationMatrixXYZ(angle, 0, 0);
    case "y":
      return rotationMatrixXYZ(0, angle, 0);
    case "z":
      return rotationMatrixXYZ(0, 0, angle);
  }
}

/** `composeVariations`' filter (drop non-finite or zero weight), restated
 * over the raw `Variation[]` so this module never imports `variations.ts`'s
 * closures — the kernel wants type/weight lanes, not a compiled function. */
function packVariations(variations: Variation[] | undefined): {
  types: number[];
  weights: number[];
} {
  const active = (variations ?? []).filter(
    (v) => Number.isFinite(v.weight) && v.weight !== 0,
  );
  if (active.length > MAX_SLOT_VARIATIONS) {
    throw new Error(
      `[gpu-spike] transform has ${active.length} active variations; ` +
        `the kernel's Slot layout carries at most MAX_SLOT_VARIATIONS (${MAX_SLOT_VARIATIONS})`,
    );
  }
  return {
    types: active.map((v) => KERNEL_VARIATION_INDEX[v.type]),
    weights: active.map((v) => v.weight),
  };
}

function writeSlotRows(
  f32: Float32Array,
  base: number,
  m: number[],
  t: readonly number[],
): void {
  f32[base + SLOT_ROW_X] = m[0];
  f32[base + SLOT_ROW_X + 1] = m[1];
  f32[base + SLOT_ROW_X + 2] = m[2];
  f32[base + SLOT_ROW_X + 3] = t[0];
  f32[base + SLOT_ROW_Y] = m[3];
  f32[base + SLOT_ROW_Y + 1] = m[4];
  f32[base + SLOT_ROW_Y + 2] = m[5];
  f32[base + SLOT_ROW_Y + 3] = t[1];
  f32[base + SLOT_ROW_Z] = m[6];
  f32[base + SLOT_ROW_Z + 1] = m[7];
  f32[base + SLOT_ROW_Z + 2] = m[8];
  f32[base + SLOT_ROW_Z + 3] = t[2];
}

/** `post === null` leaves postX/Y/Z and hasPost at the ArrayBuffer's zero
 * default — exactly the kernel's "hasPost = 0" no-rotation case. */
function writeSlotPost(
  f32: Float32Array,
  u32: Uint32Array,
  base: number,
  post: number[] | null,
): void {
  if (post === null) return;
  f32[base + SLOT_POST_X] = post[0];
  f32[base + SLOT_POST_X + 1] = post[1];
  f32[base + SLOT_POST_X + 2] = post[2];
  f32[base + SLOT_POST_Y] = post[3];
  f32[base + SLOT_POST_Y + 1] = post[4];
  f32[base + SLOT_POST_Y + 2] = post[5];
  f32[base + SLOT_POST_Z] = post[6];
  f32[base + SLOT_POST_Z + 1] = post[7];
  f32[base + SLOT_POST_Z + 2] = post[8];
  u32[base + SLOT_HAS_POST] = 1;
}

function writeSlotVariations(
  f32: Float32Array,
  u32: Uint32Array,
  base: number,
  variations: Variation[] | undefined,
): void {
  const { types, weights } = packVariations(variations);
  for (let i = 0; i < types.length; i++) {
    f32[base + SLOT_VAR_WEIGHTS + i] = weights[i];
    u32[base + SLOT_VAR_TYPES + i] = types[i];
  }
  u32[base + SLOT_VAR_COUNT] = types.length;
}

interface PackedSystem {
  slots: ArrayBuffer;
  colors: ArrayBuffer;
  /** Expanded slot count feeding pickIndex — `order * baseTransformCount`. */
  transformCount: number;
  baseTransformCount: number;
  weighted: boolean;
  totalWeight: number;
  colorDenom: number;
  colorMode: 0 | 1;
  hasFinal: boolean;
}

/**
 * Pack a {@link GpuFlameSystem} into the kernel's Slot storage buffer (one
 * slot per (symmetry copy, base transform) pair, copy-major, plus one extra
 * slot for the optional final transform) and its 256-entry colors buffer —
 * see the module doc and kernel.ts's byte-layout comment.
 */
function packSystem(system: GpuFlameSystem): PackedSystem {
  const { transforms, finalTransform, symmetry, paletteId } = system;
  const baseTransformCount = transforms.length;
  const baseAffines = transforms.map(composeAffine);
  const order = effectiveSymmetryOrder(symmetry.order, baseTransformCount);
  const transformCount = order * baseTransformCount;
  const hasFinal = finalTransform !== null;
  const slotCount = transformCount + 1; // + the final-transform slot.

  const slots = new ArrayBuffer(slotCount * SLOT_STRIDE);
  const slotF32 = new Float32Array(slots);
  const slotU32 = new Uint32Array(slots);

  // Selection weights over the EXPANDED slots (not the final slot, which
  // pickIndex never draws) — same rule as prepareChaosGame: each slot
  // inherits its base map's weight, defaulting to 1.
  const weights = new Array<number>(transformCount);
  for (let s = 0; s < transformCount; s++) {
    weights[s] = transforms[s % baseTransformCount].weight ?? 1;
  }
  let totalWeight = 0;
  const cumWeights = new Float64Array(transformCount);
  for (let s = 0; s < transformCount; s++) {
    totalWeight += weights[s];
    cumWeights[s] = totalWeight;
  }
  const weighted =
    weights.some((w) => w !== 1) &&
    totalWeight > 0 &&
    Number.isFinite(totalWeight);

  // Copy-major expansion: copy 0 (unrotated) first, then copy 1, etc. — see
  // prepareChaosGame's identical loop shape.
  for (let k = 0; k < order; k++) {
    const post =
      k === 0
        ? null
        : symmetryPostRotation(symmetry.axis, (2 * Math.PI * k) / order);
    for (let i = 0; i < baseTransformCount; i++) {
      const s = k * baseTransformCount + i;
      const base = s * F32_PER_SLOT;
      const affine = baseAffines[i];
      writeSlotRows(slotF32, base, affine.m, affine.t);
      writeSlotPost(slotF32, slotU32, base, post);
      writeSlotVariations(slotF32, slotU32, base, transforms[i].variations);
      slotF32[base + SLOT_CUM_WEIGHT] = cumWeights[s];
    }
  }

  // The final-transform lens: one extra slot, never chosen by pickIndex
  // (params.transformCount bounds that search), read only when hasFinal = 1.
  // hasPost stays 0 (the ArrayBuffer's zero default) — a lens never rotates.
  if (finalTransform !== null) {
    const finalBase = transformCount * F32_PER_SLOT;
    const affine = composeAffine(finalTransform);
    writeSlotRows(slotF32, finalBase, affine.m, affine.t);
    writeSlotVariations(slotF32, slotU32, finalBase, finalTransform.variations);
  }

  const colors = new ArrayBuffer(COLORS_BYTES);
  const colorsU32 = new Uint32Array(colors);
  const colorMode: 0 | 1 = paletteId === "legacy" ? 0 : 1;
  if (colorMode === 0) {
    const palette = transformColors(baseTransformCount);
    for (let i = 0; i < palette.length; i++) {
      const [r, g, b] = palette[i];
      colorsU32[i * 4] = Math.round(r * COLOR_FIXED_POINT_SCALE);
      colorsU32[i * 4 + 1] = Math.round(g * COLOR_FIXED_POINT_SCALE);
      colorsU32[i * 4 + 2] = Math.round(b * COLOR_FIXED_POINT_SCALE);
    }
  } else {
    const lut = buildPaletteLUT(paletteId);
    // Only "legacy" (handled above) ever returns null — see palette.ts.
    if (!lut) {
      throw new Error(
        `[gpu-spike] buildPaletteLUT(${paletteId}) returned null unexpectedly`,
      );
    }
    for (let i = 0; i < COLORS_ENTRIES; i++) {
      colorsU32[i * 4] = Math.round(lut[i * 3] * COLOR_FIXED_POINT_SCALE);
      colorsU32[i * 4 + 1] = Math.round(
        lut[i * 3 + 1] * COLOR_FIXED_POINT_SCALE,
      );
      colorsU32[i * 4 + 2] = Math.round(
        lut[i * 3 + 2] * COLOR_FIXED_POINT_SCALE,
      );
    }
  }

  return {
    slots,
    colors,
    transformCount,
    baseTransformCount,
    weighted,
    totalWeight,
    colorDenom: baseTransformCount > 1 ? baseTransformCount - 1 : 0,
    colorMode,
    hasFinal,
  };
}

/** Seed `numChains` independent orbits with `mulberry32(seed)` — same
 * `rng() - 0.5` seed-point convention as `accumulateFlame`'s fresh start,
 * one PCG state draw per chain for the kernel's own per-chain RNG. */
function packChains(numChains: number, seed: number): ArrayBuffer {
  const rng = mulberry32(seed);
  const buf = new ArrayBuffer(numChains * CHAIN_STRIDE);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  for (let c = 0; c < numChains; c++) {
    const base = c * F32_PER_CHAIN;
    f32[base + CHAIN_POS] = rng() - 0.5;
    f32[base + CHAIN_POS + 1] = rng() - 0.5;
    f32[base + CHAIN_POS + 2] = rng() - 0.5;
    f32[base + CHAIN_POS + 3] = 0.5; // orbitColor's initial 0.5, as accumulateFlame.
    u32[base + CHAIN_META_X] = Math.floor(rng() * 0x100000000) >>> 0;
  }
  return buf;
}

interface ParamsFields {
  projection: Mat4;
  width: number;
  height: number;
  transformCount: number;
  baseTransformCount: number;
  itersPerInvocation: number;
  colorMode: 0 | 1;
  weighted: boolean;
  hasFinal: boolean;
  totalWeight: number;
  colorDenom: number;
  numChains: number;
}

function packParams(p: ParamsFields): ArrayBuffer {
  const buf = new ArrayBuffer(PARAMS_BYTES);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  const proj = p.projection;
  // Row-major projX/Y/W — row 2 (clip Z) is never read, same as accumulateFlame.
  for (let i = 0; i < 4; i++) {
    f32[P_PROJ_X + i] = proj[i];
    f32[P_PROJ_Y + i] = proj[4 + i];
    f32[P_PROJ_W + i] = proj[12 + i];
  }
  u32[P_WIDTH] = p.width;
  u32[P_HEIGHT] = p.height;
  u32[P_TRANSFORM_COUNT] = p.transformCount;
  u32[P_BASE_TRANSFORM_COUNT] = p.baseTransformCount;
  u32[P_ITERS_PER_INVOCATION] = p.itersPerInvocation;
  u32[P_COLOR_MODE] = p.colorMode;
  u32[P_WEIGHTED] = p.weighted ? 1 : 0;
  u32[P_HAS_FINAL] = p.hasFinal ? 1 : 0;
  f32[P_TOTAL_WEIGHT] = p.totalWeight;
  f32[P_COLOR_DENOM] = p.colorDenom;
  u32[P_NUM_CHAINS] = p.numChains;
  return buf;
}

// ---------------------------------------------------------------------------
// GpuFlameAccumulator
// ---------------------------------------------------------------------------

/** Everything `GpuFlameAccumulator`'s private constructor needs — built up
 * by the (long) `create` factory, then frozen into the instance. */
interface AccumulatorInit {
  device: GPUDevice;
  warmupPipeline: GPUComputePipeline;
  accumulatePipeline: GPUComputePipeline;
  bindGroup: GPUBindGroup;
  paramsBuffer: GPUBuffer;
  slotsBuffer: GPUBuffer;
  colorsBuffer: GPUBuffer;
  chainsBuffer: GPUBuffer;
  histBuffer: GPUBuffer;
  width: number;
  height: number;
  numChains: number;
  itersPerInvocation: number;
  adapterInfo: GpuFlameAccumulator["adapterInfo"];
}

/**
 * Drives `kernel.ts`'s FLAME_KERNEL_WGSL over one packed system: many
 * independent chains scattering into a shared fixed-point histogram. See the
 * module doc and kernel.ts's doc comment for the exact semantics this mirrors
 * and the deliberate differences from the CPU path.
 */
export class GpuFlameAccumulator {
  readonly adapterInfo: {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
  };
  /** `numChains * itersPerInvocation` — iterations one `dispatchWorkgroups` call retires. */
  readonly iterationsPerDispatch: number;

  private readonly device: GPUDevice;
  private readonly warmupPipeline: GPUComputePipeline;
  private readonly accumulatePipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly paramsBuffer: GPUBuffer;
  private readonly slotsBuffer: GPUBuffer;
  private readonly colorsBuffer: GPUBuffer;
  private readonly chainsBuffer: GPUBuffer;
  private readonly histBuffer: GPUBuffer;
  private readonly width: number;
  private readonly height: number;
  private readonly numChains: number;
  private readonly itersPerInvocation: number;
  private readonly workgroupCount: number;
  private destroyed = false;

  private constructor(init: AccumulatorInit) {
    this.device = init.device;
    this.warmupPipeline = init.warmupPipeline;
    this.accumulatePipeline = init.accumulatePipeline;
    this.bindGroup = init.bindGroup;
    this.paramsBuffer = init.paramsBuffer;
    this.slotsBuffer = init.slotsBuffer;
    this.colorsBuffer = init.colorsBuffer;
    this.chainsBuffer = init.chainsBuffer;
    this.histBuffer = init.histBuffer;
    this.width = init.width;
    this.height = init.height;
    this.numChains = init.numChains;
    this.itersPerInvocation = init.itersPerInvocation;
    this.workgroupCount = init.numChains / WORKGROUP_SIZE;
    this.adapterInfo = init.adapterInfo;
    this.iterationsPerDispatch = init.numChains * init.itersPerInvocation;
  }

  static async create(
    system: GpuFlameSystem,
    options: GpuFlameOptions,
  ): Promise<GpuFlameAccumulator> {
    if (!navigator.gpu) {
      throw new Error(
        "[gpu-spike] WebGPU is not available: navigator.gpu is undefined " +
          "(needs Chrome/Edge 113+, or another browser with WebGPU enabled)",
      );
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error(
        "[gpu-spike] navigator.gpu.requestAdapter() returned null — no compatible GPU adapter found",
      );
    }

    const numChains = options.numChains ?? DEFAULT_NUM_CHAINS;
    if (numChains <= 0 || numChains % WORKGROUP_SIZE !== 0) {
      throw new Error(
        `[gpu-spike] numChains (${numChains}) must be a positive multiple of WORKGROUP_SIZE (${WORKGROUP_SIZE})`,
      );
    }
    const itersPerInvocation =
      options.itersPerInvocation ?? DEFAULT_ITERS_PER_INVOCATION;

    // Request the adapter's own maxStorageBufferBindingSize/maxBufferSize —
    // omitting requiredLimits would silently cap the DEVICE at WebGPU's
    // conservative spec-default limits (128 MiB), not what the adapter can
    // actually do, making the size guard below meaningless on any adapter
    // that supports more (most discrete GPUs do).
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    device.lost
      .then((info) => {
        console.error(
          `[gpu-spike] device lost (${info.reason}): ${info.message}`,
        );
      })
      .catch((e: unknown) => {
        console.error("[gpu-spike] device.lost rejected unexpectedly:", e);
      });
    device.onuncapturederror = (event) => {
      console.error(
        "[gpu-spike] uncaptured device error:",
        event.error.message,
      );
    };

    const histBytes = options.width * options.height * HIST_U32_PER_BUCKET * 4;
    if (histBytes > device.limits.maxStorageBufferBindingSize) {
      throw new Error(
        `[gpu-spike] histogram buffer (${options.width}x${options.height}, ${histBytes} bytes) ` +
          `exceeds this device's maxStorageBufferBindingSize (${device.limits.maxStorageBufferBindingSize} bytes) — ` +
          "reduce accumulation resolution",
      );
    }

    const packed = packSystem(system);
    const chainsBytes = packChains(numChains, options.seed);
    const paramsBytes = packParams({
      projection: options.projection,
      width: options.width,
      height: options.height,
      transformCount: packed.transformCount,
      baseTransformCount: packed.baseTransformCount,
      itersPerInvocation,
      colorMode: packed.colorMode,
      weighted: packed.weighted,
      hasFinal: packed.hasFinal,
      totalWeight: packed.totalWeight,
      colorDenom: packed.colorDenom,
      numChains,
    });

    const paramsBuffer = device.createBuffer({
      label: "gpu-spike params",
      size: PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(paramsBuffer, 0, paramsBytes);

    const slotsBuffer = device.createBuffer({
      label: "gpu-spike slots",
      size: packed.slots.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(slotsBuffer, 0, packed.slots);

    const colorsBuffer = device.createBuffer({
      label: "gpu-spike colors",
      size: packed.colors.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(colorsBuffer, 0, packed.colors);

    const chainsBuffer = device.createBuffer({
      label: "gpu-spike chains",
      size: chainsBytes.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(chainsBuffer, 0, chainsBytes);

    // Zero-initialized by WebGPU (createBuffer with no mappedAtCreation) —
    // exactly the fresh histogram createFlameHistogram would hand back.
    const histBuffer = device.createBuffer({
      label: "gpu-spike hist",
      size: histBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      label: "gpu-spike bind group layout",
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
    // below, so ONE bind group works for both — "auto" layouts can't share
    // bind groups across pipelines, and warmup/accumulate must read/write
    // the exact same buffers.
    const pipelineLayout = device.createPipelineLayout({
      label: "gpu-spike pipeline layout",
      bindGroupLayouts: [bindGroupLayout],
    });

    const shaderModule = device.createShaderModule({
      label: "gpu-spike flame kernel",
      code: FLAME_KERNEL_WGSL,
    });
    const compilationInfo = await shaderModule.getCompilationInfo();
    const errors = compilationInfo.messages.filter((m) => m.type === "error");
    if (errors.length > 0) {
      throw new Error(
        `[gpu-spike] WGSL compilation failed:\n${errors
          .map((m) => `  ${m.lineNum}:${m.linePos}: ${m.message}`)
          .join("\n")}`,
      );
    }

    // Two specializations of the same entry point via the PLOT override
    // constant (see kernel.ts's doc) — warmup iterates without recording.
    const warmupPipeline = device.createComputePipeline({
      label: "gpu-spike warmup pipeline",
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: "accumulate",
        constants: { PLOT: 0 },
      },
    });
    const accumulatePipeline = device.createComputePipeline({
      label: "gpu-spike accumulate pipeline",
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: "accumulate",
        constants: { PLOT: 1 },
      },
    });

    const bindGroup = device.createBindGroup({
      label: "gpu-spike bind group",
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: slotsBuffer } },
        { binding: 2, resource: { buffer: colorsBuffer } },
        { binding: 3, resource: { buffer: chainsBuffer } },
        { binding: 4, resource: { buffer: histBuffer } },
      ],
    });

    const info = adapter.info;
    return new GpuFlameAccumulator({
      device,
      warmupPipeline,
      accumulatePipeline,
      bindGroup,
      paramsBuffer,
      slotsBuffer,
      colorsBuffer,
      chainsBuffer,
      histBuffer,
      width: options.width,
      height: options.height,
      numChains,
      itersPerInvocation,
      adapterInfo: {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
      },
    });
  }

  /** Overwrite Params' itersPerInvocation field (offset 64 — see P_ITERS_PER_INVOCATION). */
  private writeItersPerInvocation(iters: number): void {
    this.device.queue.writeBuffer(
      this.paramsBuffer,
      P_ITERS_PER_INVOCATION * 4,
      new Uint32Array([iters]),
    );
  }

  /**
   * Run every chain forward WARMUP_ITERATIONS steps without recording (the
   * PLOT=false pipeline) — the GPU counterpart of accumulateFlame's fresh-start
   * warmup loop, done once so every chain starts on the attractor. Restores
   * the real `itersPerInvocation` afterward; safe without an intervening
   * dispatch because queue operations apply strictly in submission order.
   */
  async warmup(): Promise<void> {
    this.writeItersPerInvocation(WARMUP_ITERATIONS);
    const encoder = this.device.createCommandEncoder({
      label: "gpu-spike warmup",
    });
    const pass = encoder.beginComputePass({ label: "gpu-spike warmup pass" });
    pass.setPipeline(this.warmupPipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(this.workgroupCount);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    this.writeItersPerInvocation(this.itersPerInvocation);
  }

  /**
   * Encode `dispatches` back-to-back accumulate dispatches in ONE compute
   * pass (WebGPU guarantees dispatches within a pass see each other's writes
   * in issue order) and submit them as one command buffer, timing wall-clock
   * submit-to-done — the unit the benchmark harness adaptively sizes toward
   * a target batch duration.
   */
  async runBatch(
    dispatches: number,
  ): Promise<{ iterations: number; ms: number }> {
    const encoder = this.device.createCommandEncoder({
      label: "gpu-spike accumulate batch",
    });
    const pass = encoder.beginComputePass({
      label: "gpu-spike accumulate pass",
    });
    pass.setPipeline(this.accumulatePipeline);
    pass.setBindGroup(0, this.bindGroup);
    for (let i = 0; i < dispatches; i++) {
      pass.dispatchWorkgroups(this.workgroupCount);
    }
    pass.end();
    const t0 = performance.now();
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    const t1 = performance.now();
    return { iterations: dispatches * this.iterationsPerDispatch, ms: t1 - t0 };
  }

  /**
   * Copy `hist` back to a mappable staging buffer and convert it into a
   * {@link FlameHistogram} — dividing the fixed-point color sums back down by
   * COLOR_FIXED_POINT_SCALE (see kernel.ts's doc). Safe to call mid-run (the
   * histogram is read, not consumed); the caller decides when readback is due.
   */
  async readHistogram(): Promise<FlameHistogram> {
    const histBytes = this.width * this.height * HIST_U32_PER_BUCKET * 4;
    const staging = this.device.createBuffer({
      label: "gpu-spike hist staging",
      size: histBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const encoder = this.device.createCommandEncoder({
      label: "gpu-spike hist readback",
    });
    encoder.copyBufferToBuffer(this.histBuffer, 0, staging, 0, histBytes);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);

    const hist = createFlameHistogram(this.width, this.height);
    const { hits, sumRGB } = hist;
    let maxHits = 0;
    {
      // Scoped so this view is never touched after unmap() detaches it.
      const u32 = new Uint32Array(staging.getMappedRange());
      const count = this.width * this.height;
      for (let i = 0; i < count; i++) {
        const h = u32[i * 4];
        hits[i] = h;
        if (h > maxHits) maxHits = h;
        sumRGB[i * 3] = u32[i * 4 + 1] / COLOR_FIXED_POINT_SCALE;
        sumRGB[i * 3 + 1] = u32[i * 4 + 2] / COLOR_FIXED_POINT_SCALE;
        sumRGB[i * 3 + 2] = u32[i * 4 + 3] / COLOR_FIXED_POINT_SCALE;
      }
    }
    staging.unmap();
    staging.destroy();
    hist.maxHits = maxHits;
    return hist;
  }

  /** Release every GPU resource this accumulator owns. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.paramsBuffer.destroy();
    this.slotsBuffer.destroy();
    this.colorsBuffer.destroy();
    this.chainsBuffer.destroy();
    this.histBuffer.destroy();
    this.device.destroy();
  }
}
