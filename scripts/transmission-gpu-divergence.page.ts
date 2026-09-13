/**
 * One-ray, harness-only divergence probe for the archived Brick transport
 * witness. This intentionally owns no scheduler or renderer: it evaluates
 * the public escape4 estimator at the prior pilot's canonical f32 lattice.
 */
import { ESCAPE_TIME_ITERATIONS } from "../src/fractal/escape-de";
import {
  buildEscapeDE4,
  estimateEscapeDistance4,
} from "../src/fractal/escape-de-4d";
import { rotationMatrix4 } from "../src/fractal/affine4";
import { mandelboxBrick } from "../src/fractal/presets";
import {
  packEscape4GpuMaps,
  packEscape4GpuParams,
  surfaceDeKernelWgsl,
} from "../src/fractal/surface-de-gpu";
import {
  clearanceLayerSignal,
  LAYER_FIELD_WGSL,
  layerOpticalIncrement,
  layerThroughput,
} from "./transmission-layer-field";
import { makeClearanceRayGrid } from "./transmission-gpu-contract";

type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];

const WIDTH = 64;
const HEIGHT = 36;
const GLOBAL_RAY = 1369;
const EXPECTED_SAMPLES = 1635;
const EXPECTED_CPU_TAU = 0.10419882088899612;
const EXPECTED_GPU_TAU = 0.11229562014341354;
const EXPECTED_CPU_VARIATION = 21.463964462280273;
const EXPECTED_GPU_VARIATION = 20.753694534301758;
const BASE_TAU = 0.9;
const GATE = 1 / 1024;
const WORKGROUP = 64;
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

type GpuTrace = {
  point: Vec3;
  gpuDistance: number;
  gpuSignal: number;
};

function f32(value: number) {
  return Math.fround(value);
}

function floatBits(value: number) {
  const buffer = new ArrayBuffer(4);
  new Float32Array(buffer)[0] = value;
  return new Uint32Array(buffer)[0];
}

function orderedBits(value: number) {
  const bits = floatBits(value);
  return bits & 0x80000000 ? 0x80000000 - (bits & 0x7fffffff) : bits;
}

function ulps(left: number, right: number) {
  return Math.abs(orderedBits(left) - orderedBits(right));
}

function nextF32(value: number, direction: -1 | 1) {
  if (!Number.isFinite(value) || value === 0)
    return direction > 0
      ? Math.fround(1.401298464324817e-45)
      : -Math.fround(1.401298464324817e-45);
  const buffer = new ArrayBuffer(4);
  const floats = new Float32Array(buffer);
  const uints = new Uint32Array(buffer);
  floats[0] = value;
  const bits = uints[0];
  uints[0] = bits + (value > 0 === direction > 0 ? 1 : -1);
  return floats[0];
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

function canonicalT(entry: number, delta: number, sample: number) {
  return f32(f32(entry) + f32(sample) * f32(delta));
}

function canonicalPoint(
  origin: Vec3,
  direction: Vec3,
  entry: number,
  delta: number,
  sample: number,
): Vec3 {
  const t = canonicalT(entry, delta, sample);
  return [
    f32(f32(origin[0]) + f32(direction[0]) * t),
    f32(f32(origin[1]) + f32(direction[1]) * t),
    f32(f32(origin[2]) + f32(direction[2]) * t),
  ];
}

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
      "canonical f32 count needed more than four edge corrections",
    );
  return count;
}

function traceWgsl() {
  const source = surfaceDeKernelWgsl({
    mode: "eval",
    core: "escape4",
    width: 4,
    workgroupSize: WORKGROUP,
    sharedFrontier: false,
    bnbStage2: false,
  });
  const oldIo = `@group(0) @binding(2) var<storage, read> queries: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> results: array<f32>;`;
  const originalEntryAt = source.lastIndexOf("\n@compute @workgroup_size(");
  if (
    originalEntryAt < 0 ||
    source.split(oldIo).length !== 2 ||
    !source.slice(originalEntryAt).includes("fn evalQueries(")
  )
    throw new Error(
      "public escape4 eval WGSL changed; divergence probe refuses splice",
    );
  const io = /* wgsl */ `
struct TraceControl {
  originEntry: vec4f,
  directionDelta: vec4f,
  radius: f32,
  sampleCount: u32,
  _pad0: vec2u,
}
struct TraceSample {
  pointDistance: vec4f,
  signal: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
}
struct TransportResult { value: vec4f }
@group(0) @binding(2) var<uniform> traceControl: TraceControl;
@group(0) @binding(3) var<storage, read_write> traceSamples: array<TraceSample>;
@group(0) @binding(4) var<storage, read_write> transportResult: TransportResult;`;
  const entry = /* wgsl */ `
${LAYER_FIELD_WGSL}
@compute @workgroup_size(${WORKGROUP})
fn captureCanonicalTrace(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let index = gid.x;
  if (index >= traceControl.sampleCount) { return; }
  let t = fma(f32(index), traceControl.directionDelta.w, traceControl.originEntry.w);
  let px = fma(traceControl.directionDelta.x, t, traceControl.originEntry.x);
  let py = fma(traceControl.directionDelta.y, t, traceControl.originEntry.y);
  let pz = fma(traceControl.directionDelta.z, t, traceControl.originEntry.z);
  let distance = surfaceDE(vec3f(px, py, pz), params.cutoff, li);
  traceSamples[index].pointDistance = vec4f(px, py, pz, distance);
  traceSamples[index].signal = clearanceLayerSignal(distance, traceControl.radius);
}
@compute @workgroup_size(1)
fn replayCapturedTransport() {
  var signal = 0.0;
  var tau = 1.0;
  var variation = 0.0;
  for (var index = 0u; index < traceControl.sampleCount; index++) {
    let nextSignal = traceSamples[index].signal;
    let increment = layerOpticalIncrement(signal, nextSignal);
    tau = f32(tau * layerThroughput(${BASE_TAU}, increment));
    variation = f32(variation + increment);
    signal = nextSignal;
  }
  transportResult.value = vec4f(signal, tau, variation, 0.0);
}`;
  const transformed = source.replace(oldIo, io);
  const entryAt = transformed.lastIndexOf("\n@compute @workgroup_size(");
  return `${transformed.slice(0, entryAt)}${entry}`;
}

function buffer(device: GPUDevice, size: number, usage: GPUBufferUsageFlags) {
  return device.createBuffer({
    size: Math.max(4, Math.ceil(size / 4) * 4),
    usage,
  });
}

/** The archived CPU oracle's JS arithmetic, including its double signal gap. */
function replayCpuTransport(signals: readonly number[]) {
  let previous = 0;
  let tau = 1;
  let variation = 0;
  const steps: {
    signal: number;
    increment: number;
    tau: number;
    variation: number;
  }[] = [];
  for (const raw of signals) {
    const signal = raw;
    const increment = layerOpticalIncrement(previous, signal);
    tau = f32(tau * layerThroughput(BASE_TAU, increment));
    variation = f32(variation + increment);
    steps.push({ signal, increment, tau, variation });
    previous = signal;
  }
  return { tau, variation, signal: previous, steps };
}

function first<T>(
  items: readonly T[],
  predicate: (item: T, index: number) => boolean,
) {
  for (let index = 0; index < items.length; index++)
    if (predicate(items[index], index)) return index;
  return null;
}

function asRecord(
  index: number | null,
  rows: readonly {
    point: Vec3;
    cpuDistance: number;
    gpuDistance: number;
    cpuSignal: number;
    gpuSignal: number;
    cpuIncrement: number;
    gpuIncrement: number;
    cpuTau: number;
    gpuTau: number;
  }[],
) {
  if (index === null) return null;
  const row = rows[index];
  return { sample: index, ...row };
}

export async function runTransmissionGpuDivergence() {
  const adapter = await navigator.gpu?.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) return { inconclusive: "no WebGPU adapter" };
  if (!adapter.features.has("timestamp-query"))
    return { inconclusive: "timestamp-query unavailable" };
  const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean };
  if (
    (adapter as GPUAdapter & { isFallbackAdapter?: boolean })
      .isFallbackAdapter ||
    info.isFallbackAdapter ||
    [info.vendor, info.architecture, info.device, info.description].some(
      (value) => /swiftshader|llvmpipe|software/i.test(value),
    )
  )
    return {
      inconclusive: "browser adapter is fallback or software",
      browserAdapter: info,
    };
  const device = await adapter.requestDevice({
    requiredFeatures: ["timestamp-query"],
  });
  const uncaptured: string[] = [];
  let lost: string | null = null;
  device.addEventListener("uncapturederror", (event) =>
    uncaptured.push(event.error.message),
  );
  void device.lost.then((detail) => {
    lost = `${detail.reason}: ${detail.message}`;
  });
  try {
    const view = {
      rotor: rotationMatrix4({ xw: 0.57, yw: -0.31 }),
      w0: 0.18,
      sliceHalfW: 0,
    };
    const de = buildEscapeDE4(mandelboxBrick());
    const radius = de.boundingRadius;
    const grid = makeClearanceRayGrid({ width: WIDTH, height: HEIGHT, radius });
    const ray = grid.rays[GLOBAL_RAY];
    if (!ray) throw new Error("archived global ray is absent");
    const sampleCount = canonicalSampleCount(ray, grid.delta);
    if (sampleCount !== EXPECTED_SAMPLES)
      throw new Error(
        `archived witness count changed: ${sampleCount} != ${EXPECTED_SAMPLES}`,
      );
    const module = device.createShaderModule({ code: traceWgsl() });
    const compilation = await module.getCompilationInfo();
    const errors = compilation.messages.filter(
      (message) => message.type === "error",
    );
    if (errors.length)
      throw new Error(errors.map((message) => message.message).join("\n"));
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
          buffer: { type: "uniform" },
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
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [layout],
    });
    const capture = await device.createComputePipelineAsync({
      layout: pipelineLayout,
      compute: { module, entryPoint: "captureCanonicalTrace" },
    });
    const replay = await device.createComputePipelineAsync({
      layout: pipelineLayout,
      compute: { module, entryPoint: "replayCapturedTransport" },
    });
    const params = buffer(
      device,
      packEscape4GpuParams(de, view, runParams(1, ESCAPE_TIME_ITERATIONS))
        .byteLength,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const mapsData = packEscape4GpuMaps(de);
    const maps = buffer(
      device,
      mapsData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const control = buffer(
      device,
      48,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const samples = buffer(
      device,
      sampleCount * 32,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    const transport = buffer(
      device,
      16,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    const readback = buffer(
      device,
      sampleCount * 32 + 16,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    );
    const paramsData = packEscape4GpuParams(
      de,
      view,
      runParams(1, ESCAPE_TIME_ITERATIONS),
    );
    device.queue.writeBuffer(params, 0, paramsData);
    device.queue.writeBuffer(
      maps,
      0,
      mapsData.buffer,
      mapsData.byteOffset,
      mapsData.byteLength,
    );
    device.queue.writeBuffer(
      control,
      0,
      new Float32Array([
        f32(ray.origin[0]),
        f32(ray.origin[1]),
        f32(ray.origin[2]),
        f32(ray.enter),
        f32(ray.direction[0]),
        f32(ray.direction[1]),
        f32(ray.direction[2]),
        f32(grid.delta),
        f32(radius),
      ]),
    );
    device.queue.writeBuffer(control, 36, new Uint32Array([sampleCount, 0, 0]));
    const bind = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: maps } },
        { binding: 2, resource: { buffer: control } },
        { binding: 3, resource: { buffer: samples } },
        { binding: 4, resource: { buffer: transport } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const capturePass = encoder.beginComputePass();
    capturePass.setPipeline(capture);
    capturePass.setBindGroup(0, bind);
    capturePass.dispatchWorkgroups(Math.ceil(sampleCount / WORKGROUP));
    capturePass.end();
    const replayPass = encoder.beginComputePass();
    replayPass.setPipeline(replay);
    replayPass.setBindGroup(0, bind);
    replayPass.dispatchWorkgroups(1);
    replayPass.end();
    encoder.copyBufferToBuffer(samples, 0, readback, 0, sampleCount * 32);
    encoder.copyBufferToBuffer(transport, 0, readback, sampleCount * 32, 16);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = readback.getMappedRange().slice(0);
    readback.unmap();
    const floats = new Float32Array(bytes);
    const gpuTrace: GpuTrace[] = [];
    for (let sample = 0; sample < sampleCount; sample++) {
      const base = sample * 8;
      gpuTrace.push({
        point: [floats[base], floats[base + 1], floats[base + 2]],
        gpuDistance: floats[base + 3],
        gpuSignal: floats[base + 4],
      });
    }
    const gpuTransport = {
      signal: floats[sampleCount * 8],
      tau: floats[sampleCount * 8 + 1],
      variation: floats[sampleCount * 8 + 2],
    };
    const rotor = view.rotor.map(f32);
    const w0 = f32(view.w0);
    const lift = (point: Vec3): Vec4 => {
      const dot = (row: number) => {
        let total = f32(rotor[row] * point[0]);
        total = f32(total + f32(rotor[4 + row] * point[1]));
        total = f32(total + f32(rotor[8 + row] * point[2]));
        return f32(total + f32(rotor[12 + row] * w0));
      };
      return [dot(0), dot(1), dot(2), dot(3)];
    };
    const rows = gpuTrace.map((sample) => ({
      point: sample.point,
      cpuDistance: estimateEscapeDistance4(de, lift(sample.point)),
      gpuDistance: sample.gpuDistance,
      cpuSignal: 0,
      gpuSignal: sample.gpuSignal,
      cpuIncrement: 0,
      gpuIncrement: 0,
      cpuTau: 1,
      gpuTau: 1,
    }));
    const cpuSignals = rows.map((row) =>
      clearanceLayerSignal(row.cpuDistance, radius),
    );
    const cpuTransport = replayCpuTransport(cpuSignals);
    const gpuSignalTransport = replayCpuTransport(
      rows.map((row) => row.gpuSignal),
    );
    for (let index = 0; index < rows.length; index++) {
      rows[index].cpuSignal = cpuTransport.steps[index].signal;
      rows[index].gpuSignal = gpuSignalTransport.steps[index].signal;
      rows[index].cpuIncrement = cpuTransport.steps[index].increment;
      rows[index].gpuIncrement = gpuSignalTransport.steps[index].increment;
      rows[index].cpuTau = cpuTransport.steps[index].tau;
      rows[index].gpuTau = gpuSignalTransport.steps[index].tau;
    }
    let localHash = hashGlobalRay(GLOBAL_RAY);
    let capturedHash = hashGlobalRay(GLOBAL_RAY);
    for (let sample = 0; sample < sampleCount; sample++) {
      localHash = hashPoint(
        localHash,
        canonicalPoint(
          ray.origin as Vec3,
          ray.direction as Vec3,
          ray.enter,
          grid.delta,
          sample,
        ),
      );
      capturedHash = hashPoint(capturedHash, rows[sample].point);
    }
    const firstDeDifference = first(
      rows,
      (row) => floatBits(row.cpuDistance) !== floatBits(row.gpuDistance),
    );
    const firstSignalDifference = first(
      rows,
      (row) => floatBits(row.cpuSignal) !== floatBits(row.gpuSignal),
    );
    const firstIncrementDifference = first(
      rows,
      (row) => floatBits(row.cpuIncrement) !== floatBits(row.gpuIncrement),
    );
    const firstThroughputDifference = first(
      rows,
      (row) => floatBits(row.cpuTau) !== floatBits(row.gpuTau),
    );
    let prefixGateCrossing: {
      sample: number;
      prefixLength: number;
      hybridFinalTau: number;
      absDifferenceFromCpuFinalTau: number;
    } | null = null;
    for (let index = 0; index < rows.length; index++) {
      const signals = cpuSignals.slice();
      for (let replace = 0; replace <= index; replace++)
        signals[replace] = rows[replace].gpuSignal;
      const hybridFinalTau = replayCpuTransport(signals).tau;
      const absDifferenceFromCpuFinalTau = Math.abs(
        hybridFinalTau - cpuTransport.tau,
      );
      if (absDifferenceFromCpuFinalTau > GATE) {
        prefixGateCrossing = {
          sample: index,
          prefixLength: index + 1,
          hybridFinalTau,
          absDifferenceFromCpuFinalTau,
        };
        break;
      }
    }
    const firstSignal = asRecord(firstSignalDifference, rows);
    const neighbourWitness = firstSignal
      ? {
          sample: firstSignal.sample,
          cpuDistanceAtPoint: firstSignal.cpuDistance,
          cpuDistanceAtOneUlpCoordinateNeighbours: ([0, 1, 2] as const).flatMap(
            (axis) =>
              ([-1, 1] as const).map((direction) => {
                const point = [...firstSignal.point] as Vec3;
                point[axis] = nextF32(point[axis], direction);
                return {
                  axis,
                  direction,
                  point,
                  distance: estimateEscapeDistance4(de, lift(point)),
                };
              }),
          ),
        }
      : null;
    const oldFinal = {
      cpuTau: EXPECTED_CPU_TAU,
      gpuTau: EXPECTED_GPU_TAU,
      cpuVariation: EXPECTED_CPU_VARIATION,
      gpuVariation: EXPECTED_GPU_VARIATION,
    };
    const currentFinal = {
      cpuTau: cpuTransport.tau,
      cpuOnGpuSignalsTau: gpuSignalTransport.tau,
      gpuTau: gpuTransport.tau,
      cpuVariation: cpuTransport.variation,
      cpuOnGpuSignalsVariation: gpuSignalTransport.variation,
      gpuVariation: gpuTransport.variation,
    };
    const reproduction = {
      expectedSampleCount: EXPECTED_SAMPLES,
      sampleCount,
      canonicalHashes: {
        local: localHash,
        capturedDevice: capturedHash,
        matched: localHash === capturedHash,
      },
      oldFinal,
      currentFinal,
      exactOldCpuTau: currentFinal.cpuTau === oldFinal.cpuTau,
      exactOldGpuTau: currentFinal.gpuTau === oldFinal.gpuTau,
      exactOldCpuVariation: currentFinal.cpuVariation === oldFinal.cpuVariation,
      exactOldGpuVariation: currentFinal.gpuVariation === oldFinal.gpuVariation,
      oldTransportGap: Math.abs(oldFinal.cpuTau - oldFinal.gpuTau),
      currentTransportGap: Math.abs(currentFinal.cpuTau - currentFinal.gpuTau),
      gate: GATE,
    };
    const compactRows = rows.map((row, sample) => ({
      sample,
      point: row.point,
      cpuDistance: row.cpuDistance,
      gpuDistance: row.gpuDistance,
      distanceUlps: ulps(row.cpuDistance, row.gpuDistance),
      cpuSignal: row.cpuSignal,
      gpuSignal: row.gpuSignal,
      cpuIncrement: row.cpuIncrement,
      gpuIncrement: row.gpuIncrement,
      cpuTau: row.cpuTau,
      cpuOnGpuSignalTau: row.gpuTau,
    }));
    return {
      browserAdapter: {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
        isFallbackAdapter: !!info.isFallbackAdapter,
      },
      archivedWitness: {
        fixture: "mandelbox-brick-4d-posed-filled-escape",
        width: WIDTH,
        height: HEIGHT,
        k: 1,
        globalRay: GLOBAL_RAY,
        viewRotor: { xw: 0.57, yw: -0.31 },
        w0: 0.18,
        coordinateContract:
          "old resumable pilot f32 FMA t and p sequence, not the earlier host f64 grid",
      },
      reproduction,
      attribution: {
        firstDeBitDifference: asRecord(firstDeDifference, rows),
        firstSignalBitDifference: firstSignal,
        firstIncrementBitDifference: asRecord(firstIncrementDifference, rows),
        firstThroughputBitDifference: asRecord(firstThroughputDifference, rows),
        firstPrefixReplacingCpuSignalsThatExceedsOneOver1024: prefixGateCrossing
          ? {
              ...prefixGateCrossing,
              sampleData: asRecord(prefixGateCrossing.sample, rows),
              chronologicalAtSample: {
                cpuTau: rows[prefixGateCrossing.sample].cpuTau,
                cpuOnGpuSignalTau: rows[prefixGateCrossing.sample].gpuTau,
              },
              scope:
                "hybrid uses captured GPU signals through this sample and the CPU signal suffix afterward. Its final tau is distinct from chronological per-sample tau values; replacement-prefix crossings need not be monotone.",
            }
          : null,
        classification:
          firstSignalDifference === null
            ? "DE float differences are signal-inert for this trace"
            : prefixGateCrossing === null
              ? "signal differences occur but their ordered prefix does not cross the existing 1/1024 final-tau gate"
              : "ordered CPU-to-GPU signal prefix crosses the existing 1/1024 final-tau gate; this is sequence attribution, not proof that one sample alone is causal",
        cpuTransportOnGpuCapturedSignals: {
          tau: gpuSignalTransport.tau,
          variation: gpuSignalTransport.variation,
          differenceFromDeviceReplayTau:
            gpuSignalTransport.tau - gpuTransport.tau,
          differenceFromDeviceReplayVariation:
            gpuSignalTransport.variation - gpuTransport.variation,
        },
        floatNeighbourWitness: neighbourWitness,
      },
      trace: compactRows,
      capture: {
        gpuBuffersBytes:
          params.size +
          maps.size +
          control.size +
          samples.size +
          transport.size +
          readback.size,
        hostReadbackBytes: bytes.byteLength,
        limitation:
          "One archived ray only. It captures public escape4 DE and smooth layer signal, then transport; it does not exercise a renderer, continuation scheduler, normals, bending, shading, or any production path.",
      },
      runtime: { uncaptured, lost },
    };
  } finally {
    await device.queue.onSubmittedWorkDone();
    device.destroy();
  }
}

declare global {
  interface Window {
    TransmissionGpuDivergence?: {
      runTransmissionGpuDivergence: typeof runTransmissionGpuDivergence;
    };
  }
}

Object.assign(globalThis, {
  TransmissionGpuDivergence: { runTransmissionGpuDivergence },
});
