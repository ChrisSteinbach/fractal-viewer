/**
 * Harness-only device-continuation feasibility pilot. It reuses the public
 * WGSL estimator body, but owns its scheduler, state layout and transport
 * metric here. Nothing in this file is a production frame loop.
 */
import {
  buildEscapeDE,
  ESCAPE_TIME_ITERATIONS,
  estimateEscapeDistance,
} from "../src/fractal/escape-de";
import {
  buildEscapeDE4,
  estimateEscapeDistance4,
} from "../src/fractal/escape-de-4d";
import { rotationMatrix4 } from "../src/fractal/affine4";
import {
  mandelboxBrick,
  mandelboxCube,
  mengerSponge,
  pentatope,
} from "../src/fractal/presets";
import {
  buildSurfaceDE,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import {
  buildSurfaceDE4,
  estimateDistance4Refined,
} from "../src/fractal/surface-de-4d";
import {
  packEscape4GpuMaps,
  packEscape4GpuParams,
  packEscapeGpuMaps,
  packEscapeGpuParams,
  packSurface4GpuParams,
  packSurfaceGpuMaps,
  packSurfaceGpuMaps4,
  packSurfaceGpuParams,
  surfaceDeKernelWgsl,
} from "../src/fractal/surface-de-gpu";
import {
  clearanceLayerSignal,
  LAYER_FIELD_WGSL,
  layerOpticalIncrement,
  layerThroughput,
} from "./transmission-layer-field";
import { makeClearanceRayGrid } from "./transmission-gpu-contract";

type Core = "affine" | "affine4" | "escape" | "escape4";
type Fixture = {
  id: string;
  core: Core;
  radius: number;
  maps: Float32Array;
  params: ArrayBuffer;
  packParams: (itemCount: number) => ArrayBuffer;
  maxDepth: number;
  cpuDistance: (point: Vec3) => number;
};
type Vec3 = [number, number, number];
type Options = {
  width?: number;
  height?: number;
  k?: 1 | 2 | 4 | 8;
  windowRays?: number;
  checkWindowInvariant?: boolean;
  fixture?: string;
};

const WORKGROUP = 64;
const STATE_BYTES = 64;
const QUEUE_BYTES_PER_RAY = 8;
const TRANSPORT_MAX_ABS_ERROR = 1 / 1024;
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function runParams(itemCount: number, maxDepth: number) {
  return {
    itemCount,
    cutoff: 0,
    maxDepth,
    hitFloor: 1e-5,
    footprint: 0,
    pose: {
      ro: [0, 0, 0] as Vec3,
      right: [1, 0, 0] as Vec3,
      up: [0, 1, 0] as Vec3,
      fwd: [0, 0, -1] as Vec3,
      tanHalf: 0,
      aspect: 1,
      rasterWidth: 1,
      rasterHeight: 1,
      pixelEps: 0,
    },
  };
}

function fixtures(): Fixture[] {
  const view4 = {
    rotor: rotationMatrix4({ xw: 0.57, yw: -0.31 }),
    w0: 0.18,
    sliceHalfW: 0,
  };
  const menger = buildSurfaceDE(mengerSponge());
  const sparse4 = buildSurfaceDE4(pentatope());
  const filled3 = buildEscapeDE(mandelboxCube());
  const filled4 = buildEscapeDE4(mandelboxBrick());
  const rotor = view4.rotor.map(Math.fround);
  const w0 = Math.fround(view4.w0);
  const lift4 = (point: Vec3) => {
    const dot = (row: number) => {
      let total = Math.fround(rotor[row] * point[0]);
      total = Math.fround(total + Math.fround(rotor[4 + row] * point[1]));
      total = Math.fround(total + Math.fround(rotor[8 + row] * point[2]));
      return Math.fround(total + Math.fround(rotor[12 + row] * w0));
    };
    return [dot(0), dot(1), dot(2), dot(3)] as [number, number, number, number];
  };
  return [
    {
      id: "menger-3d",
      core: "affine",
      radius: menger.visibleBoundingRadius,
      maps: packSurfaceGpuMaps(menger),
      params: packSurfaceGpuParams(menger, runParams(1, menger.maxDepth)),
      packParams: (itemCount) =>
        packSurfaceGpuParams(menger, runParams(itemCount, menger.maxDepth)),
      maxDepth: menger.maxDepth,
      cpuDistance: (point) => estimateDistanceRefined(menger, point, 0),
    },
    {
      id: "pentatope-4d-posed-sparse",
      core: "affine4",
      radius: sparse4.visibleBoundingRadius,
      maps: packSurfaceGpuMaps4(sparse4),
      params: packSurface4GpuParams(
        sparse4,
        view4,
        runParams(1, sparse4.maxDepth),
      ),
      packParams: (itemCount) =>
        packSurface4GpuParams(
          sparse4,
          view4,
          runParams(itemCount, sparse4.maxDepth),
        ),
      maxDepth: sparse4.maxDepth,
      cpuDistance: (point) =>
        estimateDistance4Refined(sparse4, lift4(point), 0),
    },
    {
      id: "mandelbox-cube-3d-filled-escape",
      core: "escape",
      radius: filled3.boundingRadius,
      maps: packEscapeGpuMaps(filled3),
      params: packEscapeGpuParams(
        filled3,
        runParams(1, ESCAPE_TIME_ITERATIONS),
      ),
      packParams: (itemCount) =>
        packEscapeGpuParams(
          filled3,
          runParams(itemCount, ESCAPE_TIME_ITERATIONS),
        ),
      maxDepth: ESCAPE_TIME_ITERATIONS,
      cpuDistance: (point) => estimateEscapeDistance(filled3, point),
    },
    {
      id: "mandelbox-brick-4d-posed-filled-escape",
      core: "escape4",
      radius: filled4.boundingRadius,
      maps: packEscape4GpuMaps(filled4),
      params: packEscape4GpuParams(
        filled4,
        view4,
        runParams(1, ESCAPE_TIME_ITERATIONS),
      ),
      packParams: (itemCount) =>
        packEscape4GpuParams(
          filled4,
          view4,
          runParams(itemCount, ESCAPE_TIME_ITERATIONS),
        ),
      maxDepth: ESCAPE_TIME_ITERATIONS,
      cpuDistance: (point) => estimateEscapeDistance4(filled4, lift4(point)),
    },
  ];
}

function buffer(device: GPUDevice, size: number, usage: GPUBufferUsageFlags) {
  return device.createBuffer({
    size: Math.max(4, Math.ceil(size / 4) * 4),
    usage,
  });
}

/**
 * The old eval entry has fixed query/result bindings. Keep the public body,
 * reject generator drift loudly, and replace only that harness entry and I/O.
 */
function resumableWgsl(core: Core, k: number): string {
  const evalSource = surfaceDeKernelWgsl({
    mode: "eval",
    core,
    width: 4,
    workgroupSize: WORKGROUP,
    sharedFrontier: false,
    bnbStage2: false,
  });
  const oldIo = `@group(0) @binding(2) var<storage, read> queries: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> results: array<f32>;`;
  const originalEntryAt = evalSource.lastIndexOf("\n@compute @workgroup_size(");
  if (
    originalEntryAt < 0 ||
    evalSource.split(oldIo).length !== 2 ||
    !evalSource.slice(originalEntryAt).includes("fn evalQueries(")
  ) {
    throw new Error(
      "public eval WGSL template changed; resumable harness refuses to splice it",
    );
  }
  const io = /* wgsl */ `
struct TransmissionState {
  originEntry: vec4f,
  directionExit: vec4f,
  signalTauSum: vec4f,
  counts: vec4u,
}
@group(0) @binding(2) var<storage, read_write> transmissionStates: array<TransmissionState>;
@group(0) @binding(3) var<storage, read> activeIn: array<u32>;
@group(0) @binding(4) var<storage, read_write> activeOut: array<u32>;
// queue[0]=current count, queue[1]=next count.
@group(0) @binding(5) var<storage, read_write> queueWords: array<atomic<u32>>;
// radius, fixed f32 delta, base tau, unused.
@group(0) @binding(6) var<uniform> transmissionControl: vec4f;
@group(0) @binding(7) var<storage, read_write> dispatchArgs: array<u32>;`;
  const entry = /* wgsl */ `
${LAYER_FIELD_WGSL}
fn transmissionHash(h: u32, value: u32) -> u32 {
  return (h ^ value) * ${FNV_PRIME}u;
}
@compute @workgroup_size(1)
fn prepareTransmissionStep() {
  let activeCount = atomicLoad(&queueWords[0]);
  dispatchArgs[0] = (activeCount + ${WORKGROUP - 1}u) / ${WORKGROUP}u;
  dispatchArgs[1] = 1u;
  dispatchArgs[2] = 1u;
}
@compute @workgroup_size(${WORKGROUP})
fn transmissionStep(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let slot = gid.x;
  if (slot >= atomicLoad(&queueWords[0])) { return; }
  let ray = activeIn[slot];
  var state = transmissionStates[ray];
  if (state.counts.z != 0u) { return; }
  var index = state.counts.x;
  var signal = state.signalTauSum.x;
  var tau = state.signalTauSum.y;
  var sum = state.signalTauSum.z;
  var hash = state.counts.w;
  for (var lane = 0u; lane < ${k}u && index < state.counts.y; lane++) {
    // Explicit f32 stages are the newly declared coordinate sequence. This
    // intentionally differs from the earlier host f64 coordinate packing.
    let t = fma(f32(index), transmissionControl.y, state.originEntry.w);
    let px = fma(state.directionExit.x, t, state.originEntry.x);
    let py = fma(state.directionExit.y, t, state.originEntry.y);
    let pz = fma(state.directionExit.z, t, state.originEntry.z);
    hash = transmissionHash(hash, bitcast<u32>(px));
    hash = transmissionHash(hash, bitcast<u32>(py));
    hash = transmissionHash(hash, bitcast<u32>(pz));
    let d = surfaceDE(vec3f(px, py, pz), params.cutoff, li);
    if (d != d || abs(d) > 3.4e38) {
      state.counts.z = 2u;
      break;
    }
    let nextSignal = clearanceLayerSignal(d, transmissionControl.x);
    let increment = layerOpticalIncrement(signal, nextSignal);
    tau = f32(tau * layerThroughput(transmissionControl.z, increment));
    sum = f32(sum + increment);
    signal = nextSignal;
    index++;
  }
  state.counts.x = index;
  state.counts.w = hash;
  state.signalTauSum = vec4f(signal, tau, sum, 0.0);
  if (state.counts.z == 0u && index >= state.counts.y) { state.counts.z = 1u; }
  transmissionStates[ray] = state;
  if (state.counts.z == 0u) {
    let outputSlot = atomicAdd(&queueWords[1], 1u);
    activeOut[outputSlot] = ray;
  }
}
@compute @workgroup_size(1)
fn finalizeTransmissionStep() {
  atomicStore(&queueWords[0], atomicLoad(&queueWords[1]));
  atomicStore(&queueWords[1], 0u);
}`;
  const transformed = evalSource.replace(oldIo, io);
  const entryAt = transformed.lastIndexOf("\n@compute @workgroup_size(");
  return `${transformed.slice(0, entryAt)}${entry}`;
}

function f32(value: number) {
  return Math.fround(value);
}

function canonicalPoint(
  origin: Vec3,
  direction: Vec3,
  entry: number,
  delta: number,
  sample: number,
): Vec3 {
  const t = f32(f32(entry) + f32(sample) * f32(delta));
  return [
    f32(f32(origin[0]) + f32(direction[0]) * t),
    f32(f32(origin[1]) + f32(direction[1]) * t),
    f32(f32(origin[2]) + f32(direction[2]) * t),
  ];
}

function canonicalT(entry: number, delta: number, sample: number) {
  return f32(f32(entry) + f32(sample) * f32(delta));
}

/**
 * The prior pilot counted against f64 entry/exit values. This pilot declares
 * the staged f32 t sequence instead, then makes only a bounded edge repair
 * around the old count. A larger repair is a contract failure, not a quiet
 * scheduler choice.
 */
function canonicalSampleCount(
  ray: { enter: number; exit: number; samples: number },
  delta: number,
) {
  const exit = f32(ray.exit);
  const inside = (sample: number) =>
    canonicalT(ray.enter, delta, sample) < exit;
  let count = ray.samples;
  let corrections = 0;
  while (count > 0 && !inside(count - 1)) {
    count--;
    corrections++;
  }
  while (inside(count)) {
    count++;
    corrections++;
  }
  if (corrections > 4)
    throw new Error(
      "f32 half-open count needs more than four edge corrections",
    );
  if (
    count > 1 &&
    !(
      canonicalT(ray.enter, delta, count - 2) <
      canonicalT(ray.enter, delta, count - 1)
    )
  )
    throw new Error("f32 sample lattice is not strictly monotonic");
  if (count > 0 && !inside(count - 1))
    throw new Error("f32 half-open lattice includes its exit");
  if (inside(count)) throw new Error("f32 half-open lattice omits a sample");
  return count;
}

const bitScratch = new ArrayBuffer(4);
const bitFloat = new Float32Array(bitScratch);
const bitUint = new Uint32Array(bitScratch);
function floatBits(value: number) {
  bitFloat[0] = value;
  return bitUint[0];
}
function hashPoint(hash: number, point: Vec3) {
  let next = hash;
  for (const value of point)
    next = Math.imul(next ^ floatBits(value), FNV_PRIME);
  return next >>> 0;
}
function hashGlobalRay(globalRay: number) {
  return Math.imul(FNV_OFFSET ^ globalRay, FNV_PRIME) >>> 0;
}
function percentile(values: number[], fraction: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))
  ];
}
function distribution(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    max: Math.max(0, ...values),
    mean: values.length ? total / values.length : null,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  };
}

function selectedRayIds(sampleCounts: readonly number[], full: boolean) {
  const populated = sampleCounts
    .map((samples, index) => ({ samples, index }))
    .filter((item) => item.samples > 0);
  if (full) return populated.map((item) => item.index);
  const selected: number[] = [];
  for (let step = 0; step < populated.length && selected.length < 128; step++) {
    const position = Math.floor((step * populated.length) / 128);
    const id = populated[position]?.index;
    if (id !== undefined && selected.at(-1) !== id) selected.push(id);
  }
  return selected;
}

type TraceRecord = {
  hash: number;
  sample: number;
  status: number;
  signal: number;
  tau: number;
  sum: number;
};

async function runFixture(
  device: GPUDevice,
  fixture: Fixture,
  options: Required<Options>,
) {
  const harnessStart = performance.now();
  const gridStart = performance.now();
  const grid = makeClearanceRayGrid({
    width: options.width,
    height: options.height,
    radius: fixture.radius,
  });
  const canonicalSampleCounts = grid.rays.map((ray) =>
    canonicalSampleCount(ray, grid.delta),
  );
  const f32CountChanges = canonicalSampleCounts.reduce(
    (total, count, index) =>
      total + (count === grid.rays[index].samples ? 0 : 1),
    0,
  );
  const gridSetupMs = performance.now() - gridStart;
  const compileStart = performance.now();
  const module = device.createShaderModule({
    code: resumableWgsl(fixture.core, options.k),
  });
  const messages = await module.getCompilationInfo();
  const errors = messages.messages.filter(
    (message) => message.type === "error",
  );
  if (errors.length)
    throw new Error(
      `${fixture.id}: ${errors.map((x) => x.message).join("\n")}`,
    );
  const stepBindGroupLayout = device.createBindGroupLayout({
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
        buffer: { type: "storage" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 5,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 6,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
    ],
  });
  const prepareBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 5,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 7,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ],
  });
  const stepLayout = device.createPipelineLayout({
    bindGroupLayouts: [stepBindGroupLayout],
  });
  const prepareLayout = device.createPipelineLayout({
    bindGroupLayouts: [prepareBindGroupLayout],
  });
  const prepare = await device.createComputePipelineAsync({
    layout: prepareLayout,
    compute: { module, entryPoint: "prepareTransmissionStep" },
  });
  const step = await device.createComputePipelineAsync({
    layout: stepLayout,
    compute: { module, entryPoint: "transmissionStep" },
  });
  const finalize = await device.createComputePipelineAsync({
    layout: stepLayout,
    compute: { module, entryPoint: "finalizeTransmissionStep" },
  });
  const compilePipelinesMs = performance.now() - compileStart;
  const params = buffer(
    device,
    fixture.params.byteLength,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  const maps = buffer(
    device,
    fixture.maps.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(params, 0, fixture.params);
  device.queue.writeBuffer(
    maps,
    0,
    fixture.maps.buffer,
    fixture.maps.byteOffset,
    fixture.maps.byteLength,
  );
  const fullCpu = grid.rays.length <= 4096;
  const selected = new Set(selectedRayIds(canonicalSampleCounts, fullCpu));
  const trace: TraceRecord[] = [];
  const timings: number[] = [];
  const actualBuffers: {
    globalRayStart: number;
    globalRayEnd: number;
    state: number;
    activeQueues: number;
    queueControl: number;
    outputMap: number;
    timestampResolve: number;
    timestampQueryPairs: number;
  }[] = [];
  let totalHostInitBytes = 0;
  let totalHostTerminalMapBytes = 0;
  let totalHostTraceBytes = 0;
  let totalWindowSetupMs = 0;
  let totalEncodeSubmitTerminalMapMs = 0;
  let cpuOracleWallMs = 0;
  let cumulativeDeclaredGpuBufferBytes =
    fixture.params.byteLength + fixture.maps.byteLength;
  let peakDeclaredGpuBufferBytes = cumulativeDeclaredGpuBufferBytes;
  let cumulativeHostTypedArrayBytes =
    fixture.params.byteLength + fixture.maps.byteLength;
  let peakHostTypedArrayBytes = cumulativeHostTypedArrayBytes;
  let totalGpuMs = 0;
  let maxGpuMs = 0;
  let submissions = 0;
  let complete = 0;
  let invalid = 0;
  let coordinateHashMismatches = 0;
  let emptyWindows = 0;
  const residuals: number[] = [];
  const signalResiduals: number[] = [];
  const variationResiduals: number[] = [];
  let rawSelectedWitness: { point: Vec3; cpu: number } | null = null;
  let worstTransportWitness: {
    globalRay: number;
    canonicalRay: {
      origin: Vec3;
      direction: Vec3;
      entry: number;
      exit: number;
      sampleCount: number;
    };
    cpuTau: number;
    gpuTau: number;
    cpuPositiveVariation: number;
    gpuPositiveVariation: number;
  } | null = null;

  for (
    let windowStart = 0;
    windowStart < grid.rays.length;
    windowStart += options.windowRays
  ) {
    const windowSetupStart = performance.now();
    const windowEnd = Math.min(
      grid.rays.length,
      windowStart + options.windowRays,
    );
    const rays = grid.rays.slice(windowStart, windowEnd);
    const stateData = new ArrayBuffer(rays.length * STATE_BYTES);
    const stateFloats = new Float32Array(stateData);
    const stateUints = new Uint32Array(stateData);
    const active = new Uint32Array(rays.length);
    let activeCount = 0;
    let maxRounds = 0;
    for (let local = 0; local < rays.length; local++) {
      const ray = rays[local];
      const base = local * 16;
      stateFloats.set(
        [
          f32(ray.origin[0]),
          f32(ray.origin[1]),
          f32(ray.origin[2]),
          f32(ray.enter),
          f32(ray.direction[0]),
          f32(ray.direction[1]),
          f32(ray.direction[2]),
          f32(ray.exit),
          0,
          1,
          0,
          0,
        ],
        base,
      );
      stateUints[base + 12] = 0;
      const sampleCount = canonicalSampleCounts[windowStart + local];
      stateUints[base + 13] = sampleCount;
      stateUints[base + 14] = sampleCount === 0 ? 1 : 0;
      // The seed proves that an identical local slot in another window still
      // represents its full-image ray identity.
      stateUints[base + 15] = hashGlobalRay(windowStart + local);
      if (sampleCount > 0) {
        active[activeCount++] = local;
        maxRounds = Math.max(maxRounds, Math.ceil(sampleCount / options.k));
      }
    }
    if (maxRounds === 0) {
      emptyWindows++;
      totalHostInitBytes += stateData.byteLength + active.byteLength;
      totalWindowSetupMs += performance.now() - windowSetupStart;
      const emptyHostTypedArrayBytes =
        fixture.params.byteLength +
        fixture.maps.byteLength +
        stateData.byteLength +
        active.byteLength;
      cumulativeHostTypedArrayBytes += stateData.byteLength + active.byteLength;
      peakHostTypedArrayBytes = Math.max(
        peakHostTypedArrayBytes,
        emptyHostTypedArrayBytes,
      );
      for (let local = 0; local < rays.length; local++) {
        complete++;
        if (options.checkWindowInvariant) {
          trace[windowStart + local] = {
            hash: stateUints[local * 16 + 15],
            sample: 0,
            status: 1,
            signal: 0,
            tau: 1,
            sum: 0,
          };
        }
      }
      continue;
    }
    const states = buffer(
      device,
      stateData.byteLength,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    );
    const activeA = buffer(
      device,
      active.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const activeB = buffer(
      device,
      active.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const queue = buffer(
      device,
      8,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const indirect = buffer(
      device,
      16,
      GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
    );
    const control = buffer(
      device,
      16,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const timestampPairs = Math.max(1, maxRounds);
    const timestamps = device.createQuerySet({
      type: "timestamp",
      count: timestampPairs * 2,
    });
    const timestampResolve = buffer(
      device,
      timestampPairs * 16,
      GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    );
    const readback = buffer(
      device,
      stateData.byteLength + timestampPairs * 16,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    );
    actualBuffers.push({
      globalRayStart: windowStart,
      globalRayEnd: windowEnd,
      state: stateData.byteLength,
      activeQueues: active.byteLength * 2,
      queueControl: 40,
      outputMap: readback.size,
      timestampResolve: timestampResolve.size,
      timestampQueryPairs: timestampPairs,
    });
    totalHostInitBytes += stateData.byteLength + active.byteLength + 8 + 16;
    const windowDeclaredGpuBytes =
      fixture.params.byteLength +
      fixture.maps.byteLength +
      stateData.byteLength +
      active.byteLength * 2 +
      8 +
      16 +
      16 +
      readback.size +
      timestampResolve.size;
    cumulativeDeclaredGpuBufferBytes +=
      stateData.byteLength +
      active.byteLength * 2 +
      8 +
      16 +
      16 +
      readback.size +
      timestampResolve.size;
    peakDeclaredGpuBufferBytes = Math.max(
      peakDeclaredGpuBufferBytes,
      windowDeclaredGpuBytes,
    );
    device.queue.writeBuffer(states, 0, stateData);
    device.queue.writeBuffer(activeA, 0, active);
    device.queue.writeBuffer(queue, 0, new Uint32Array([activeCount, 0]));
    device.queue.writeBuffer(
      control,
      0,
      new Float32Array([fixture.radius, grid.delta, 0.9, 0]),
    );
    const bind = (input: GPUBuffer, output: GPUBuffer) =>
      device.createBindGroup({
        layout: stepBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: maps } },
          { binding: 2, resource: { buffer: states } },
          { binding: 3, resource: { buffer: input } },
          { binding: 4, resource: { buffer: output } },
          { binding: 5, resource: { buffer: queue } },
          { binding: 6, resource: { buffer: control } },
        ],
      });
    const binds = [bind(activeA, activeB), bind(activeB, activeA)];
    const prepareBind = device.createBindGroup({
      layout: prepareBindGroupLayout,
      entries: [
        { binding: 5, resource: { buffer: queue } },
        { binding: 7, resource: { buffer: indirect } },
      ],
    });
    totalWindowSetupMs += performance.now() - windowSetupStart;
    const encodeSubmitTerminalMapStart = performance.now();
    for (let round = 0; round < maxRounds; round++) {
      const encoder = device.createCommandEncoder();
      const preparePass = encoder.beginComputePass();
      preparePass.setPipeline(prepare);
      preparePass.setBindGroup(0, prepareBind);
      preparePass.dispatchWorkgroups(1);
      preparePass.end();
      const workPass = encoder.beginComputePass({
        timestampWrites: {
          querySet: timestamps,
          beginningOfPassWriteIndex: round * 2,
          endOfPassWriteIndex: round * 2 + 1,
        },
      });
      workPass.setPipeline(step);
      workPass.setBindGroup(0, binds[round % 2]);
      workPass.dispatchWorkgroupsIndirect(indirect, 0);
      workPass.end();
      const finalizePass = encoder.beginComputePass();
      finalizePass.setPipeline(finalize);
      finalizePass.setBindGroup(0, binds[round % 2]);
      finalizePass.dispatchWorkgroups(1);
      finalizePass.end();
      device.queue.submit([encoder.finish()]);
      submissions++;
    }
    const terminal = device.createCommandEncoder();
    terminal.resolveQuerySet(
      timestamps,
      0,
      timestampPairs * 2,
      timestampResolve,
      0,
    );
    terminal.copyBufferToBuffer(states, 0, readback, 0, stateData.byteLength);
    terminal.copyBufferToBuffer(
      timestampResolve,
      0,
      readback,
      stateData.byteLength,
      timestampPairs * 16,
    );
    device.queue.submit([terminal.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const terminalBytes = readback.getMappedRange().slice(0);
    readback.unmap();
    totalHostTerminalMapBytes += terminalBytes.byteLength;
    totalEncodeSubmitTerminalMapMs +=
      performance.now() - encodeSubmitTerminalMapStart;
    const windowHostTypedArrayBytes =
      fixture.params.byteLength +
      fixture.maps.byteLength +
      stateData.byteLength +
      active.byteLength +
      8 +
      16 +
      16 +
      terminalBytes.byteLength;
    cumulativeHostTypedArrayBytes +=
      stateData.byteLength +
      active.byteLength +
      8 +
      16 +
      16 +
      terminalBytes.byteLength;
    peakHostTypedArrayBytes = Math.max(
      peakHostTypedArrayBytes,
      windowHostTypedArrayBytes,
    );
    const finalFloats = new Float32Array(terminalBytes, 0, rays.length * 16);
    const finalUints = new Uint32Array(terminalBytes, 0, rays.length * 16);
    const pairs = new BigUint64Array(
      terminalBytes,
      stateData.byteLength,
      timestampPairs * 2,
    );
    for (let i = 0; i < timestampPairs; i++) {
      const ms = Number(pairs[i * 2 + 1] - pairs[i * 2]) / 1e6;
      timings.push(ms);
      totalGpuMs += ms;
      maxGpuMs = Math.max(maxGpuMs, ms);
    }
    for (let local = 0; local < rays.length; local++) {
      const base = local * 16;
      const state: TraceRecord = {
        hash: finalUints[base + 15],
        sample: finalUints[base + 12],
        status: finalUints[base + 14],
        signal: finalFloats[base + 8],
        tau: finalFloats[base + 9],
        sum: finalFloats[base + 10],
      };
      const globalRay = windowStart + local;
      const sampleCount = canonicalSampleCounts[globalRay];
      if (state.status === 1 && state.sample === sampleCount) complete++;
      if (state.status === 2) invalid++;
      if (options.checkWindowInvariant) trace[globalRay] = state;
      if (!selected.has(globalRay)) continue;
      const oracleStart = performance.now();
      totalHostTraceBytes += 64;
      let hash = hashGlobalRay(globalRay);
      let signal = 0;
      let tau = 1;
      let variation = 0;
      for (let sample = 0; sample < sampleCount; sample++) {
        const point = canonicalPoint(
          rays[local].origin as Vec3,
          rays[local].direction as Vec3,
          rays[local].enter,
          grid.delta,
          sample,
        );
        hash = hashPoint(hash, point);
        const cpu = fixture.cpuDistance(point);
        const next = clearanceLayerSignal(cpu, fixture.radius);
        const increment = layerOpticalIncrement(signal, next);
        tau = f32(tau * layerThroughput(0.9, increment));
        variation = f32(variation + increment);
        signal = next;
        if (sample === sampleCount - 1) rawSelectedWitness = { point, cpu };
      }
      if (hash !== state.hash) coordinateHashMismatches++;
      residuals.push(Math.abs(tau - state.tau));
      signalResiduals.push(Math.abs(signal - state.signal));
      variationResiduals.push(Math.abs(variation - state.sum));
      if (
        !worstTransportWitness ||
        Math.abs(tau - state.tau) >
          Math.abs(worstTransportWitness.cpuTau - worstTransportWitness.gpuTau)
      ) {
        worstTransportWitness = {
          globalRay,
          canonicalRay: {
            origin: rays[local].origin.map(f32) as Vec3,
            direction: rays[local].direction.map(f32) as Vec3,
            entry: f32(rays[local].enter),
            exit: f32(rays[local].exit),
            sampleCount,
          },
          cpuTau: tau,
          gpuTau: state.tau,
          cpuPositiveVariation: variation,
          gpuPositiveVariation: state.sum,
        };
      }
      cpuOracleWallMs += performance.now() - oracleStart;
    }
    [
      states,
      activeA,
      activeB,
      queue,
      indirect,
      control,
      timestampResolve,
      readback,
    ].forEach((item) => item.destroy());
    timestamps.destroy();
  }
  params.destroy();
  maps.destroy();
  const throughputResidual = distribution(residuals);
  return {
    report: {
      fixture: fixture.id,
      core: fixture.core,
      estimatorDepth: fixture.maxDepth,
      raster: {
        width: grid.width,
        height: grid.height,
        rays: grid.rays.length,
      },
      declaredCoordinates:
        "new f32 fused multiply-add sequence; not bit-identical to the earlier JS f64-packed grid",
      windowIdentity:
        "rays are generated for the full raster before slicing; each coordinate hash is seeded with its full-image global ray ID",
      transport: {
        h: "1 at DE<=.002R, 0 at DE>=.003R, smoothstep between",
        increment: "max(0, h-hPrevious)",
        baseTau: 0.9,
        maxAbsoluteErrorProposal: TRANSPORT_MAX_ABS_ERROR,
      },
      canonicalF32Grid: {
        sampleDomain: "t(index) < f32(exit); f32 fused entry + index*delta",
        countChangedFromOldF64GridRays: f32CountChanges,
        monotonicity: "checked for every ray's final two canonical samples",
      },
      deviceScheduler: {
        k: options.k,
        windowRays: options.windowRays,
        submissions,
        terminalMapsPerWindow: 1,
        noIntermediateHostClassification: true,
        emptyWindows,
      },
      timing: {
        gridSetupMs,
        compilePipelinesMs,
        windowSetupMs: totalWindowSetupMs,
        encodeSubmitTerminalMapMs: totalEncodeSubmitTerminalMapMs,
        cpuOracleWallMs,
        totalHarnessWallMs: performance.now() - harnessStart,
      },
      completion: {
        complete,
        total: grid.rays.length,
        invalid,
        unresolved: grid.rays.length - complete - invalid,
      },
      gpuTimingMs: {
        total: totalGpuMs,
        maxSubmission: maxGpuMs,
        medianSubmission: percentile(timings, 0.5),
        boundedSubmissionLimitMs: 4,
        submissionsOver4ms: timings.filter((value) => value > 4).length,
      },
      buffers: {
        perRayStateBytes: STATE_BYTES,
        perRayQueueBytes: QUEUE_BYTES_PER_RAY,
        fixedEstimatorParamsAndMapsBytes:
          fixture.params.byteLength + fixture.maps.byteLength,
        actualWindows: actualBuffers,
        peakDeclaredGpuBufferBytes,
        cumulativeDeclaredGpuBufferBytes,
        hostInitTypedArrayBytes: totalHostInitBytes,
        hostTerminalMapTypedArrayBytes: totalHostTerminalMapBytes,
        hostSelectedTraceBytes: totalHostTraceBytes,
        peakHostTypedArrayBytes,
        cumulativeHostTypedArrayBytes,
        unmeasuredGpuAllocation:
          "WebGPU does not expose query-set or driver allocation bytes; timestamp query-set storage is counted as opaque pairs, not invented bytes.",
        unmeasuredHostAllocations:
          "The full JS ray-grid object array, JS objects, driver allocation, browser command encoding and shader compiler memory are not observable through WebGPU. The unknown full-grid object footprint prevents certifying a 1080p 128 MiB host-plus-device cap.",
      },
      cpuTransportOracle: {
        scope: fullCpu
          ? "all rays at <=64x36"
          : "128 deterministic non-empty rays",
        selectedRays: residuals.length,
        coordinateHashMismatches,
        residual: {
          ...throughputResidual,
          pass:
            coordinateHashMismatches === 0 &&
            residuals.every((value) => value <= TRANSPORT_MAX_ABS_ERROR),
        },
        finalSignalResidualDiagnostic: distribution(signalResiduals),
        positiveVariationResidualDiagnostic: distribution(variationResiduals),
        worstTransportWitness,
        selectedCpuLastDistanceWitness: rawSelectedWitness
          ? { point: rawSelectedWitness.point, cpu: rawSelectedWitness.cpu }
          : null,
      },
      inheritedOldPilotDisclosure:
        "The old host-packed predicate pilot remains the baseline: Pentatope had a leave flip, Brick had an entry flip, and the 3D escape witness was CPU 4.000000100681544 versus GPU 2.794940948486328 at (-0.12038888037204742, 0.16854442656040192, 3.994633913040161), with CPU f32-neighbour range 2.794940679796013..4.000000338780273. This transport metric does not raise or replace that hard-predicate gate.",
      limitation:
        "No bending, normals, Fresnel appearance, shading, warps, lights, compositor or production frame-loop work. Device timestamps are optimistic lower bounds.",
      totalHarnessWallMs: performance.now() - harnessStart,
    },
    trace,
  };
}

export async function runResumableTransmissionPilot(input: Options = {}) {
  const options: Required<Options> = {
    width: input.width ?? 64,
    height: input.height ?? 36,
    k: input.k ?? 4,
    windowRays: input.windowRays ?? 1024,
    checkWindowInvariant: input.checkWindowInvariant ?? false,
    fixture: input.fixture ?? "",
  };
  const adapter = await navigator.gpu?.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) return { inconclusive: "no WebGPU adapter" };
  if (!adapter.features.has("timestamp-query"))
    return { inconclusive: "timestamp-query unavailable" };
  const device = await adapter.requestDevice({
    requiredFeatures: ["timestamp-query"],
  });
  const uncapturedErrors: string[] = [];
  let lostReason: string | null = null;
  const onUncapturedError = (event: GPUUncapturedErrorEvent) => {
    uncapturedErrors.push(event.error.message);
  };
  device.addEventListener("uncapturederror", onUncapturedError);
  void device.lost.then((info) => {
    lostReason = `${info.reason}: ${info.message}`;
  });
  device.pushErrorScope("validation");
  const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean };
  const fallback =
    (adapter as GPUAdapter & { isFallbackAdapter?: boolean })
      .isFallbackAdapter === true || info.isFallbackAdapter === true;
  const fields = [
    info.vendor,
    info.architecture,
    info.device,
    info.description,
  ].filter((value) => value.trim().length > 0);
  let scopePopped = false;
  try {
    if (
      fallback ||
      fields.length === 0 ||
      fields.some((value) => /swiftshader|llvmpipe|software/i.test(value))
    )
      return {
        inconclusive: "browser adapter is blank, fallback or software",
        browserAdapter: info,
      };
    const availableFixtures = fixtures();
    const selectedFixtures = options.fixture
      ? availableFixtures.filter((fixture) => fixture.id === options.fixture)
      : availableFixtures;
    if (selectedFixtures.length === 0)
      return {
        inconclusive: `unknown fixture: ${options.fixture}; use one of ${availableFixtures.map((fixture) => fixture.id).join(", ")}`,
      };
    const first = [];
    for (const fixture of selectedFixtures)
      first.push(await runFixture(device, fixture, options));
    const chunkInvariant = [];
    if (options.checkWindowInvariant) {
      const sameTrace = (
        left: readonly TraceRecord[],
        right: readonly TraceRecord[],
      ) =>
        left.length === right.length &&
        left.every((entry, index) => {
          const other = right[index];
          return (
            !!other &&
            entry.hash === other.hash &&
            entry.sample === other.sample &&
            entry.status === other.status &&
            entry.signal === other.signal &&
            entry.tau === other.tau &&
            entry.sum === other.sum
          );
        });
      const alternate = {
        ...options,
        windowRays: Math.max(WORKGROUP, Math.floor(options.windowRays / 2)),
      };
      for (const fixture of selectedFixtures) {
        const other = await runFixture(device, fixture, alternate);
        const original = first.find(
          (row) => row.report.fixture === fixture.id,
        )!;
        const kComparisons = [];
        for (const k of [1, 2, 4, 8] as const) {
          if (k === options.k) continue;
          const otherK = await runFixture(device, fixture, { ...options, k });
          kComparisons.push({
            k,
            samePerRay: sameTrace(original.trace, otherK.trace),
            complete:
              original.report.completion.unresolved === 0 &&
              otherK.report.completion.unresolved === 0,
            gpuTimingMs: otherK.report.gpuTimingMs,
            timing: otherK.report.timing,
          });
        }
        chunkInvariant.push({
          fixture: fixture.id,
          windowRays: [options.windowRays, alternate.windowRays],
          samePerRay: sameTrace(original.trace, other.trace),
          complete:
            original.report.completion.unresolved === 0 &&
            other.report.completion.unresolved === 0,
          gpuTimingMs: other.report.gpuTimingMs,
          timing: other.report.timing,
          kComparisons,
        });
      }
    }
    await device.queue.onSubmittedWorkDone();
    await Promise.resolve();
    const scopedError = await device.popErrorScope();
    scopePopped = true;
    if (scopedError)
      throw new Error(`GPU validation error: ${scopedError.message}`);
    if (lostReason !== null)
      throw new Error("GPU device lost: " + String(lostReason));
    if (uncapturedErrors.length)
      throw new Error(`uncaptured GPU error: ${uncapturedErrors.join(" | ")}`);
    return {
      browserAdapter: {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
        isFallbackAdapter: fallback,
      },
      options,
      requestedFixture: options.fixture || "all fixtures",
      rows: first.map((row) => row.report),
      chunkInvariant,
    };
  } finally {
    if (!scopePopped) await device.popErrorScope();
    device.removeEventListener("uncapturederror", onUncapturedError);
  }
}

(
  globalThis as typeof globalThis & { TransmissionGpuResumable?: unknown }
).TransmissionGpuResumable = { runResumableTransmissionPilot };
