/**
 * Harness-only exact-cell dielectric renderer. It consumes the shared finite
 * ternary DDA geometry; no production DE supplies membership or an exit.
 */
import {
  DIELECTRIC_SOLID_FIXTURES,
  DIELECTRIC_SOLID_PACKED_BYTES,
  DIELECTRIC_SOLID_WGSL,
  packDielectricSolidFixture,
} from "./transmission-dielectric-solid";
import { runDielectricGpuControls } from "./transmission-dielectric-gpu-controls";

type FixtureKey = "menger3" | "hyper4";
type Mode = "opaque" | "glass";
type Options = {
  width?: number;
  height?: number;
  tileWidth?: number;
  tileHeight?: number;
  diagnostic?: boolean;
  fixture?: FixtureKey;
  mode?: Mode;
};

const WORKGROUP = 64;
const SPP = 4;
const MAX_PATHS = 8;
const MAX_INTERFACES = 48;
const MAX_PROCESSED_PATHS = 128;
const PATH_STATE_BYTES = 128;
const ADDITIONAL_STATE_LIMIT_BYTES = 128 * 1024 * 1024;
const IOR = 1.45;
const ENVIRONMENT_BOUND = 4;
const ERROR_BUDGET = 1 / 1024;
const BRANCH_RESIDUAL_ENERGY = ERROR_BUDGET / (ENVIRONMENT_BOUND * 16);
const STATUS_COMPLETE = 1;
const STATUS_RESIDUAL = 2;
const STATUS_UNRESOLVED = 3;

type Fixture = {
  id: FixtureKey;
  label: string;
  packed: ArrayBuffer;
  scene: { dimension: 3 | 4; depth: 3; construction: string };
};

function fixtures(): Fixture[] {
  return [
    {
      id: "menger3",
      label: "CONNECTED FINITE MENGER D3",
      packed: packDielectricSolidFixture(DIELECTRIC_SOLID_FIXTURES.mengerD3),
      scene: {
        dimension: 3,
        depth: 3,
        construction: "finite Menger ternary-cell union",
      },
    },
    {
      id: "hyper4",
      label: "POSED CONNECTED FINITE HYPER-MENGER D3",
      packed: packDielectricSolidFixture(
        DIELECTRIC_SOLID_FIXTURES.hyperMengerD3,
      ),
      scene: {
        dimension: 4,
        depth: 3,
        construction: "finite posed hyper-Menger ternary-cell union",
      },
    },
  ];
}

function gpuBuffer(
  device: GPUDevice,
  size: number,
  usage: GPUBufferUsageFlags,
) {
  return device.createBuffer({
    size: Math.max(4, Math.ceil(size / 4) * 4),
    usage,
  });
}

function base64(bytes: Uint8Array) {
  let text = "";
  for (let start = 0; start < bytes.length; start += 0x8000)
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
}

function memoryPlan(
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number,
) {
  const pixels = width * height;
  const tilePixels = tileWidth * tileHeight;
  const gpuBuffers = DIELECTRIC_SOLID_PACKED_BYTES + 96 + tilePixels * 32 * 2;
  const pageTypedImages = pixels * 4;
  const base64Characters = 4 * Math.ceil((pixels * 4) / 3);
  const returnedBase64PayloadBytes = base64Characters;
  const returnedBase64Utf16Bytes = base64Characters * 2;
  const tileReadbackCopy = tilePixels * 32;
  const logicalPrivateStacks = tilePixels * MAX_PATHS * PATH_STATE_BYTES;
  const knownAdditionalBytes =
    gpuBuffers +
    pageTypedImages +
    returnedBase64Utf16Bytes * 3 +
    tileReadbackCopy +
    logicalPrivateStacks;
  return {
    limitBytes: ADDITIONAL_STATE_LIMIT_BYTES,
    knownAdditionalBytes,
    declaredGpuBufferBytes: gpuBuffers,
    pageTypedImageBytes: pageTypedImages,
    returnedBase64PayloadBytes,
    returnedBase64Utf16Bytes,
    base64ConstructionTransientUtf16Bytes: returnedBase64Utf16Bytes,
    structuredCloneBase64Utf16Bytes: returnedBase64Utf16Bytes,
    tileReadbackCopyBytes: tileReadbackCopy,
    logicalPrivateStackBytes: logicalPrivateStacks,
    logicalPrivateStackBytesPerInvocation: MAX_PATHS * PATH_STATE_BYTES,
    exclusions:
      "One row is returned at a time. Browser/driver allocations, command encoding, shader compilation, JS object overhead, PNG encoding and launcher-side buffers are unmeasured.",
  };
}

function cameraBasis() {
  const eye: [number, number, number] = [2.1, 1.4, 3.2];
  const target: [number, number, number] = [0, 0, 0];
  const normalize = (value: readonly number[]) => {
    const length = Math.hypot(...value);
    return value.map((component) => component / length) as [
      number,
      number,
      number,
    ];
  };
  const cross = (left: readonly number[], right: readonly number[]) =>
    [
      left[1] * right[2] - left[2] * right[1],
      left[2] * right[0] - left[0] * right[2],
      left[0] * right[1] - left[1] * right[0],
    ] as [number, number, number];
  const forward = normalize(
    target.map((component, axis) => component - eye[axis]),
  );
  const right = normalize(cross(forward, [0, 1, 0]));
  return { eye, forward, right, up: cross(right, forward), tanHalf: 0.39 };
}

export function dielectricWgsl() {
  return /* wgsl */ `
${DIELECTRIC_SOLID_WGSL}

struct CameraControl {
  eye: vec4f,
  forward: vec4f,
  right: vec4f,
  up: vec4f,
  extent: vec4u, // full width, full height, tile x, tile y
  tile: vec4u,   // tile width, tile height, mode, spp
}
struct OutputPixel {
  packed: u32,
  status: u32,
  residual: f32,
  capEvents: u32,
  sampleComplete: u32,
  sampleUnresolved: u32,
  sampleInvalid: u32,
  _pad: u32,
}
struct TraceResult { radiance: vec3f, status: u32, residual: f32, capEvents: u32 }
struct PathState {
  origin: vec3f,
  direction: vec3f,
  energy: vec3f,
  inside: u32,
  previousAxis: i32,
  previousPlane: i32,
  interfaces: u32,
  anchorPoint: vec4f,
  anchorPlaneMask: u32,
  anchorPlaneIndices: vec4<i32>,
  hasAnchor: u32,
}
@group(0) @binding(0) var<uniform> solid: DielectricSolidFixture;
@group(0) @binding(1) var<uniform> camera: CameraControl;
@group(0) @binding(2) var<storage, read_write> output: array<OutputPixel>;

fn saturate(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn studioEnvironment(d: vec3f) -> vec3f {
  let horizon = smoothstep(-0.25, 0.45, d.y);
  var c = mix(vec3f(0.035, 0.045, 0.06), vec3f(0.16, 0.19, 0.23), horizon);
  let leftSoftbox = pow(max(dot(d, normalize(vec3f(-0.65, 0.45, 0.60))), 0.0), 24.0);
  let rightSoftbox = pow(max(dot(d, normalize(vec3f(0.70, 0.25, 0.66))), 0.0), 18.0);
  return c + vec3f(1.6, 1.45, 1.25) * leftSoftbox + vec3f(0.65, 0.85, 1.2) * rightSoftbox;
}
fn rearScene(o: vec3f, d: vec3f) -> vec3f {
  var best = 1e30;
  var c = studioEnvironment(d);
  if (d.y < -1e-5) {
    let t = (-0.95 - o.y) / d.y;
    if (t > 0.0 && t < best) {
      let p = o + t * d;
      c = mix(vec3f(0.12, 0.14, 0.15), vec3f(0.25, 0.23, 0.20), smoothstep(-1.8, 1.8, p.x));
      best = t;
    }
  }
  if (abs(d.z) > 1e-5) {
    let t = (-3.2 - o.z) / d.z;
    if (t > 0.0 && t < best) {
      let p = o + t * d;
      let band = select(vec3f(0.24, 0.29, 0.31), vec3f(0.40, 0.18, 0.12), p.x > 0.15);
      c = band * (0.55 + 0.45 * smoothstep(-0.8, 0.8, p.y));
    }
  }
  return c;
}
fn fresnel(cosI: f32, fromIor: f32, toIor: f32) -> f32 {
  let eta = fromIor / toIor;
  let sinT2 = eta * eta * max(0.0, 1.0 - cosI * cosI);
  if (sinT2 >= 1.0) { return 1.0; }
  let cosT = sqrt(max(0.0, 1.0 - sinT2));
  let rs = (fromIor * cosI - toIor * cosT) / (fromIor * cosI + toIor * cosT);
  let rp = (fromIor * cosT - toIor * cosI) / (fromIor * cosT + toIor * cosI);
  return 0.5 * (rs * rs + rp * rp);
}
fn refractOrReflect(d: vec3f, outward: vec3f, fromIor: f32, toIor: f32) -> vec4f {
  let n = select(outward, -outward, dot(d, outward) > 0.0);
  let cosI = clamp(-dot(d, n), 0.0, 1.0);
  let eta = fromIor / toIor;
  let sinT2 = eta * eta * max(0.0, 1.0 - cosI * cosI);
  if (sinT2 > 1.0) { return vec4f(normalize(reflect(d, n)), 1.0); }
  let cosT = sqrt(max(0.0, 1.0 - sinT2));
  return vec4f(normalize(eta * d + (eta * cosI - cosT) * n), 0.0);
}
fn beer(distance: f32) -> vec3f {
  let path = max(0.0, distance) / solid.shape.x;
  return exp(-path * vec3f(0.17, 0.055, 0.025));
}
fn maxChannel(value: vec3f) -> f32 { return max(max(value.x, value.y), value.z); }
fn packColor(linear: vec3f) -> u32 {
  let encoded = pow(max(linear, vec3f(0.0)), vec3f(1.0 / 2.2));
  let b = vec3u(round(255.0 * clamp(encoded, vec3f(0.0), vec3f(1.0))));
  return b.x | (b.y << 8u) | (b.z << 16u) | 0xff000000u;
}
// dielectricNextBoundary is supplied by DIELECTRIC_SOLID_WGSL. Its shared
// contract accepts the current medium, exact tMin and previous face only.
fn traceGlass(origin: vec3f, direction: vec3f) -> TraceResult {
  var paths: array<PathState, ${MAX_PATHS}>;
  paths[0] = PathState(
    origin, direction, vec3f(1.0), 0u, -1, -1, 0u,
    vec4f(0.0), 0u, vec4<i32>(-1), 0u,
  );
  var pending = 1u;
  var processed = 0u;
  var radiance = vec3f(0.0);
  var residual = 0.0;
  var status = ${STATUS_COMPLETE}u;
  var capEvents = 0u;
  loop {
    if (pending == 0u) { break; }
    pending--;
    var path = paths[pending];
    if (maxChannel(path.energy) * ${ENVIRONMENT_BOUND} <= ${BRANCH_RESIDUAL_ENERGY}) {
      residual += maxChannel(path.energy) * ${ENVIRONMENT_BOUND};
      continue;
    }
    processed++;
    if (processed > ${MAX_PROCESSED_PATHS}u || path.interfaces >= ${MAX_INTERFACES}u) {
      residual += max(max(path.energy.x, path.energy.y), path.energy.z) * ${ENVIRONMENT_BOUND};
      status = ${STATUS_UNRESOLVED}u;
      capEvents++;
      continue;
    }
    var boundary: DielectricBoundaryResult;
    if (path.hasAnchor != 0u) {
      boundary = dielectricNextBoundaryFromAnchor(
        solid, path.direction, path.inside, path.anchorPoint,
        path.anchorPlaneMask, path.anchorPlaneIndices,
      );
    } else {
      boundary = dielectricNextBoundary(
        solid, path.origin, path.direction, path.inside, 0.0,
        path.previousAxis, path.previousPlane,
        select(0u, 1u, path.previousAxis >= 0),
      );
    }
    if (boundary.kind == DIELECTRIC_RESULT_REFUSED) {
      status = ${STATUS_UNRESOLVED}u;
      residual += max(max(path.energy.x, path.energy.y), path.energy.z) * ${ENVIRONMENT_BOUND};
      capEvents++;
      continue;
    }
    if (boundary.kind == DIELECTRIC_RESULT_MISS) {
      if (path.inside != 0u) {
        status = ${STATUS_UNRESOLVED}u;
        residual += max(max(path.energy.x, path.energy.y), path.energy.z) * ${ENVIRONMENT_BOUND};
        capEvents++;
      } else {
        radiance += path.energy * rearScene(path.origin, path.direction);
      }
      continue;
    }
    let hit = path.origin + boundary.t * path.direction;
    if (camera.tile.z == 0u) {
      let key = max(dot(boundary.outwardNormal, normalize(vec3f(-0.45, 0.78, 0.42))), 0.0);
      return TraceResult(vec3f(0.54, 0.58, 0.60) * (0.20 + 0.80 * key), ${STATUS_COMPLETE}u, 0.0, 0u);
    }
    var energy = path.energy;
    if (path.inside != 0u) { energy *= beer(boundary.t); }
    let fromIor = select(1.0, ${IOR}, path.inside != 0u);
    let toIor = select(${IOR}, 1.0, path.inside != 0u);
    let cosI = abs(dot(path.direction, boundary.outwardNormal));
    let f = fresnel(cosI, fromIor, toIor);
    let reflectedEnergy = energy * f;
    let refracted = refractOrReflect(path.direction, boundary.outwardNormal, fromIor, toIor);
    if (refracted.w > 0.5) {
      if (maxChannel(energy) * ${ENVIRONMENT_BOUND} <= ${BRANCH_RESIDUAL_ENERGY}) {
        residual += maxChannel(energy) * ${ENVIRONMENT_BOUND};
      } else if (pending < ${MAX_PATHS}u) {
        paths[pending] = PathState(
          hit, refracted.xyz, energy, path.inside, i32(boundary.axis), boundary.planeIndex, path.interfaces + 1u,
          boundary.intrinsicPoint, boundary.planeMask, boundary.planeIndices, 1u,
        );
        pending++;
      } else { residual += max(max(energy.x, energy.y), energy.z) * ${ENVIRONMENT_BOUND}; status = ${STATUS_UNRESOLVED}u; capEvents++; }
      continue;
    }
    let transmittedEnergy = energy * (1.0 - f);
    let reflectedDirection = normalize(reflect(path.direction, boundary.outwardNormal));
    // Push the stronger child first, leaving the weaker actual-throughput
    // child at the top of the LIFO stack. Fresnel is not assumed below 0.5.
    var firstEnergy = transmittedEnergy;
    var firstDirection = refracted.xyz;
    var firstInside = 1u - path.inside;
    var secondEnergy = reflectedEnergy;
    var secondDirection = reflectedDirection;
    var secondInside = path.inside;
    if (maxChannel(reflectedEnergy) > maxChannel(transmittedEnergy)) {
      firstEnergy = reflectedEnergy;
      firstDirection = reflectedDirection;
      firstInside = path.inside;
      secondEnergy = transmittedEnergy;
      secondDirection = refracted.xyz;
      secondInside = 1u - path.inside;
    }
    for (var child = 0u; child < 2u; child++) {
      let childEnergy = select(secondEnergy, firstEnergy, child == 0u);
      let childDirection = select(secondDirection, firstDirection, child == 0u);
      let childInside = select(secondInside, firstInside, child == 0u);
      if (maxChannel(childEnergy) * ${ENVIRONMENT_BOUND} <= ${BRANCH_RESIDUAL_ENERGY}) {
        residual += maxChannel(childEnergy) * ${ENVIRONMENT_BOUND};
      } else if (pending < ${MAX_PATHS}u) {
        paths[pending] = PathState(
          hit, childDirection, childEnergy, childInside, i32(boundary.axis), boundary.planeIndex, path.interfaces + 1u,
          boundary.intrinsicPoint, boundary.planeMask, boundary.planeIndices, 1u,
        );
        pending++;
      } else {
        residual += maxChannel(childEnergy) * ${ENVIRONMENT_BOUND};
        status = ${STATUS_UNRESOLVED}u;
        capEvents++;
      }
    }
  }
  if (status == ${STATUS_COMPLETE}u && residual > 0.0) { status = ${STATUS_RESIDUAL}u; }
  return TraceResult(radiance, status, residual, capEvents);
}
@compute @workgroup_size(${WORKGROUP})
fn renderDielectric(@builtin(global_invocation_id) gid: vec3u) {
  let local = gid.x;
  let tilePixels = camera.tile.x * camera.tile.y;
  if (local >= tilePixels) { return; }
  let pixel = vec2u(camera.extent.z + local % camera.tile.x, camera.extent.w + local / camera.tile.x);
  var color = vec3f(0.0);
  var worstStatus = ${STATUS_COMPLETE}u;
  var residual = 0.0;
  var capEvents = 0u;
  var sampleComplete = 0u;
  var sampleUnresolved = 0u;
  var sampleInvalid = 0u;
  for (var sample = 0u; sample < ${SPP}u; sample++) {
    let jitter = vec2f(f32(sample & 1u) * 0.5 - 0.25, f32(sample >> 1u) * 0.5 - 0.25);
    let ndc = (2.0 * (vec2f(pixel) + vec2f(0.5) + jitter) / vec2f(camera.extent.xy) - vec2f(1.0, 1.0));
    let ray = normalize(camera.forward.xyz + ndc.x * camera.right.xyz + ndc.y * camera.up.xyz);
    let traced = traceGlass(camera.eye.xyz, ray);
    color += traced.radiance;
    worstStatus = max(worstStatus, traced.status);
    residual += traced.residual;
    capEvents += traced.capEvents;
    if (traced.status == ${STATUS_COMPLETE}u || traced.status == ${STATUS_RESIDUAL}u) {
      sampleComplete++;
    } else if (traced.status == ${STATUS_UNRESOLVED}u) {
      sampleUnresolved++;
    } else {
      sampleInvalid++;
    }
  }
  output[local].packed = packColor(color / f32(${SPP}));
  output[local].status = worstStatus;
  // Keep the raw four-sample sum so the host can report both the displayed
  // pixel average and the global discarded-branch bound without guessing.
  output[local].residual = residual;
  output[local].capEvents = capEvents;
  output[local].sampleComplete = sampleComplete;
  output[local].sampleUnresolved = sampleUnresolved;
  output[local].sampleInvalid = sampleInvalid;
}`;
}

export async function runTransmissionDielectricGpu(input: Options = {}) {
  const requestedWidth = input.width ?? 1024;
  const requestedHeight = input.height ?? 1024;
  const width = input.diagnostic
    ? Math.min(32, requestedWidth)
    : requestedWidth;
  const height = input.diagnostic
    ? Math.min(32, requestedHeight)
    : requestedHeight;
  const tileWidth = Math.min(input.tileWidth ?? 256, width);
  const tileHeight = Math.min(input.tileHeight ?? 144, height);
  if (
    ![width, height, tileWidth, tileHeight].every(
      (value) => Number.isInteger(value) && value > 0,
    )
  )
    return {
      inconclusive: "image and tile dimensions must be positive integers",
    };
  const plannedMemory = memoryPlan(width, height, tileWidth, tileHeight);
  if (plannedMemory.knownAdditionalBytes > plannedMemory.limitBytes)
    return {
      preflightRefusal: {
        reason:
          "known page, GPU-buffer and logical private-stack plan exceeds the additional-state limit before allocation",
        memory: plannedMemory,
      },
    };
  const adapter = await navigator.gpu?.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) return { inconclusive: "no WebGPU adapter" };
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
  const device = await adapter.requestDevice();
  const uncaptured: string[] = [];
  let lost: string | null = null;
  device.addEventListener("uncapturederror", (event) =>
    uncaptured.push(event.error.message),
  );
  void device.lost.then((detail) => {
    lost = `${detail.reason}: ${detail.message}`;
  });
  try {
    const controls = await runDielectricGpuControls(device, dielectricWgsl());
    if (!controls.passed)
      return {
        controlRefusal: {
          reason: "current-source GPU dielectric controls did not pass",
          controls,
        },
        browserAdapter: {
          vendor: info.vendor,
          architecture: info.architecture,
          device: info.device,
          description: info.description,
          isFallbackAdapter: !!info.isFallbackAdapter,
        },
        runtime: { uncaptured, lost },
      };
    const pipelineSetupStarted = performance.now();
    const module = device.createShaderModule({ code: dielectricWgsl() });
    const messages = await module.getCompilationInfo();
    const errors = messages.messages.filter(
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
          buffer: { type: "uniform" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });
    const pipeline = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: "renderDielectric" },
    });
    const solid = gpuBuffer(
      device,
      DIELECTRIC_SOLID_PACKED_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const camera = gpuBuffer(
      device,
      96,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const maxTilePixels = tileWidth * tileHeight;
    const output = gpuBuffer(
      device,
      maxTilePixels * 32,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    const readback = gpuBuffer(
      device,
      maxTilePixels * 32,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    );
    const pipelineSetupMs = performance.now() - pipelineSetupStarted;
    const rows: {
      key: FixtureKey;
      role: "main" | "opaque-control";
      fixture: string;
      mode: Mode;
      scene: Fixture["scene"];
      samplesPerPixel: number;
      width: number;
      height: number;
      imageBase64: string;
      completion: {
        complete: number;
        residual: number;
        unresolved: number;
        invalid: number;
        capEvents: number;
        sampleTotal: number;
        sampleComplete: number;
        sampleUnresolved: number;
        sampleInvalid: number;
        total: number;
      };
      residual: {
        radianceBound: number;
        totalRadianceBound: number;
        totalSampleMaxChannelRadianceBound: number;
        errorBudget: number;
        environmentRadianceBound: number;
        scope: string;
      };
      memory: typeof plannedMemory;
      timing: {
        pipelineSetupMs: number;
        tileEncodeSubmitMapWallMs: number;
        maxTileEncodeSubmitMapWallMs: number;
        tiles: number;
      };
    }[] = [];
    const view = cameraBasis();
    const selectedFixtures = fixtures().filter(
      (fixture) => input.fixture === undefined || fixture.id === input.fixture,
    );
    const selectedModes = (["opaque", "glass"] as Mode[]).filter(
      (mode) => input.mode === undefined || mode === input.mode,
    );
    if (selectedFixtures.length !== 1 || selectedModes.length !== 1)
      return {
        inconclusive:
          "one known fixture and one known mode are required per page invocation",
      };
    for (const fixture of selectedFixtures) {
      device.queue.writeBuffer(solid, 0, fixture.packed);
      for (const mode of selectedModes) {
        const rgba = new Uint8Array(width * height * 4);
        const completion = {
          complete: 0,
          residual: 0,
          unresolved: 0,
          invalid: 0,
          capEvents: 0,
          sampleTotal: width * height * SPP,
          sampleComplete: 0,
          sampleUnresolved: 0,
          sampleInvalid: 0,
          total: width * height,
        };
        let radianceBound = 0;
        let totalRadianceBound = 0;
        let totalSampleMaxChannelRadianceBound = 0;
        let tileEncodeSubmitMapWallMs = 0;
        let maxTileEncodeSubmitMapWallMs = 0;
        let tiles = 0;
        for (let y = 0; y < height; y += tileHeight) {
          for (let x = 0; x < width; x += tileWidth) {
            const currentWidth = Math.min(tileWidth, width - x);
            const currentHeight = Math.min(tileHeight, height - y);
            const control = new ArrayBuffer(96);
            const floats = new Float32Array(control);
            const uints = new Uint32Array(control);
            floats.set([
              ...view.eye,
              0,
              ...view.forward,
              0,
              ...view.right.map(
                (component) => component * view.tanHalf * (width / height),
              ),
              0,
              ...view.up.map((component) => component * view.tanHalf),
              0,
            ]);
            uints.set([width, height, x, y], 16);
            uints.set(
              [currentWidth, currentHeight, mode === "opaque" ? 0 : 1, SPP],
              20,
            );
            device.queue.writeBuffer(camera, 0, control);
            const bind = device.createBindGroup({
              layout,
              entries: [
                { binding: 0, resource: { buffer: solid } },
                { binding: 1, resource: { buffer: camera } },
                { binding: 2, resource: { buffer: output } },
              ],
            });
            const tileStarted = performance.now();
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bind);
            pass.dispatchWorkgroups(
              Math.ceil((currentWidth * currentHeight) / WORKGROUP),
            );
            pass.end();
            encoder.copyBufferToBuffer(
              output,
              0,
              readback,
              0,
              currentWidth * currentHeight * 32,
            );
            device.queue.submit([encoder.finish()]);
            await readback.mapAsync(GPUMapMode.READ);
            const mapped = readback
              .getMappedRange()
              .slice(0, currentWidth * currentHeight * 32);
            readback.unmap();
            const tileElapsed = performance.now() - tileStarted;
            tileEncodeSubmitMapWallMs += tileElapsed;
            maxTileEncodeSubmitMapWallMs = Math.max(
              maxTileEncodeSubmitMapWallMs,
              tileElapsed,
            );
            tiles++;
            const values = new Uint32Array(mapped);
            const residualValues = new Float32Array(mapped);
            for (let local = 0; local < currentWidth * currentHeight; local++) {
              const target =
                (y + Math.floor(local / currentWidth)) * width +
                x +
                (local % currentWidth);
              const packed = values[local * 8];
              rgba[target * 4] = packed & 255;
              rgba[target * 4 + 1] = (packed >>> 8) & 255;
              rgba[target * 4 + 2] = (packed >>> 16) & 255;
              rgba[target * 4 + 3] = 255;
              const status = values[local * 8 + 1];
              if (status === STATUS_COMPLETE) completion.complete++;
              else if (status === STATUS_RESIDUAL) {
                completion.complete++;
                completion.residual++;
              } else if (status === STATUS_UNRESOLVED) completion.unresolved++;
              else completion.invalid++;
              completion.capEvents += values[local * 8 + 3];
              completion.sampleComplete += values[local * 8 + 4];
              completion.sampleUnresolved += values[local * 8 + 5];
              completion.sampleInvalid += values[local * 8 + 6];
              const perPixelAverage = residualValues[local * 8 + 2] / SPP;
              radianceBound = Math.max(radianceBound, perPixelAverage);
              totalRadianceBound += perPixelAverage;
              totalSampleMaxChannelRadianceBound +=
                residualValues[local * 8 + 2];
            }
          }
        }
        rows.push({
          key: fixture.id,
          role: mode === "glass" ? "main" : "opaque-control",
          fixture: fixture.id,
          mode,
          scene: fixture.scene,
          samplesPerPixel: SPP,
          width,
          height,
          imageBase64: base64(rgba),
          completion,
          residual: {
            radianceBound,
            totalRadianceBound,
            totalSampleMaxChannelRadianceBound,
            errorBudget: ERROR_BUDGET,
            environmentRadianceBound: ENVIRONMENT_BOUND,
            scope:
              "radianceBound is the gate: maximum per-pixel, four-sample-average, max-channel discarded-branch bound. totalRadianceBound sums pixel averages across the image and totalSampleMaxChannelRadianceBound sums raw samples; both are instruments only and are not compared with the per-pixel error budget.",
          },
          memory: plannedMemory,
          timing: {
            pipelineSetupMs,
            tileEncodeSubmitMapWallMs,
            maxTileEncodeSubmitMapWallMs,
            tiles,
          },
        });
      }
    }
    [solid, camera, output, readback].forEach((item) => item.destroy());
    return {
      browserAdapter: {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
        isFallbackAdapter: !!info.isFallbackAdapter,
      },
      controls,
      options: {
        width,
        height,
        tileWidth,
        tileHeight,
        fixture: input.fixture,
        mode: input.mode,
        diagnostic: !!input.diagnostic,
        spp: SPP,
        maxPaths: MAX_PATHS,
        maxInterfaces: MAX_INTERFACES,
        maxProcessedPaths: MAX_PROCESSED_PATHS,
      },
      rows,
      runtime: { uncaptured, lost },
    };
  } finally {
    await device.queue.onSubmittedWorkDone();
    device.destroy();
  }
}

declare global {
  interface Window {
    TransmissionDielectricGpu?: {
      runTransmissionDielectricGpu: typeof runTransmissionDielectricGpu;
    };
  }
}
Object.assign(globalThis, {
  TransmissionDielectricGpu: { runTransmissionDielectricGpu },
});
