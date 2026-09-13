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
type PixelRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};
type Options = {
  width?: number;
  height?: number;
  tileWidth?: number;
  tileHeight?: number;
  window?: PixelRegion;
  diagnostic?: boolean;
  fixture?: FixtureKey;
  mode?: Mode;
};

type DielectricRunStage =
  "controls" | "pipeline" | "render" | "assemble" | "base64" | "cleanup";

type DielectricRunProgress = {
  runId: number;
  stage: DielectricRunStage;
  fixture: FixtureKey | null;
  mode: Mode | null;
  completedTiles: number;
  totalTiles: number;
  submissions: number;
  totalSubmissions: number;
  replayPass: number | null;
  submissionInFlight: boolean;
  activeSubmission: number | null;
  activeSubmissionStartedAtMs: number | null;
  lastSubmissionWallMs: number | null;
  maxSubmissionWallMs: number;
  cancelRequested: boolean;
  cancelRequestedAtMs: number | null;
  cancelAcknowledgedAtMs: number | null;
  cleanupCompleted: boolean;
  cleanupWallMs: number | null;
  cleanupError: string | null;
};

const WORKGROUP = 64;
const SPP = 4;
// With B=4 initial radiance and theta_min=epsilon/(64*2^5)=2^-21,
// weaker-first DFS needs ceil(log2(B/theta_min))+1 = 24 live entries.
const MAX_PATHS = 24;
// CPU replay witnesses need at most 5,714 processed paths. Every interface
// consumes one processed path, so this redundant interface sanity guard may
// equal the whole-tree work ceiling without increasing worst work or state.
const MAX_PROCESSED_PATHS = 16384;
const MAX_INTERFACES = MAX_PROCESSED_PATHS;
const PATH_STATE_BYTES = 144;
const OUTPUT_PIXEL_BYTES = 192;
const REPLAY_PASSES = 6;
const ADDITIONAL_STATE_LIMIT_BYTES = 128 * 1024 * 1024;
const IOR = 1.45;
const ENVIRONMENT_BOUND = 4;
const ERROR_BUDGET = 1 / 1024;
const INITIAL_BRANCH_THETA = ERROR_BUDGET / 64;
const STATUS_COMPLETE = 1;
const STATUS_RESIDUAL = 2;
const STATUS_UNRESOLVED = 3;
const STATUS_INVALID = 4;

let nextRunId = 1;
let activeRun: DielectricRunProgress | null = null;
let runReserved = false;

async function yieldToBrowserTasks() {
  const taskScheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;
  if (typeof taskScheduler?.yield === "function") {
    await taskScheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export function transmissionDielectricGpuProgress() {
  return activeRun === null ? null : { ...activeRun };
}

export function cancelTransmissionDielectricGpu() {
  if (activeRun === null)
    return { requested: false, reason: "no active dielectric run" };
  if (!activeRun.cancelRequested) {
    activeRun.cancelRequested = true;
    activeRun.cancelRequestedAtMs = performance.now();
  }
  return {
    requested: true,
    runId: activeRun.runId,
    stage: activeRun.stage,
    submissions: activeRun.submissions,
    requestedAtMs: activeRun.cancelRequestedAtMs,
  };
}

type Fixture = {
  id: FixtureKey;
  label: string;
  packed: ArrayBuffer;
  scene: { dimension: 3 | 4; depth: 2; construction: string };
};

function fixtures(): Fixture[] {
  return [
    {
      id: "menger3",
      label: "CONNECTED FINITE MENGER D2",
      packed: packDielectricSolidFixture(DIELECTRIC_SOLID_FIXTURES.mengerD2),
      scene: {
        dimension: 3,
        depth: 2,
        construction: "finite Menger ternary-cell union",
      },
    },
    {
      id: "hyper4",
      label: "POSED CONNECTED FINITE HYPER-MENGER D2",
      packed: packDielectricSolidFixture(
        DIELECTRIC_SOLID_FIXTURES.hyperMengerD2,
      ),
      scene: {
        dimension: 4,
        depth: 2,
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
  const gpuBuffers =
    DIELECTRIC_SOLID_PACKED_BYTES + 96 + tilePixels * OUTPUT_PIXEL_BYTES * 2;
  const pageTypedImages = pixels * 4;
  const base64Characters = 4 * Math.ceil((pixels * 4) / 3);
  const returnedBase64PayloadBytes = base64Characters;
  const returnedBase64Utf16Bytes = base64Characters * 2;
  const tileReadbackCopy = tilePixels * OUTPUT_PIXEL_BYTES;
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
  failureMask: u32,
  traversalReasonMask: u32,
  traversalSamples: u32,
  insideMissSamples: u32,
  stackLimitSamples: u32,
  interfaceLimitSamples: u32,
  processedLimitSamples: u32,
  _padFailure: u32,
  witnessReason: u32,
  witnessTraversalReason: u32,
  witnessMedium: u32,
  witnessSample: u32,
  witnessOrigin: vec3f,
  witnessAnchorMask: u32,
  witnessDirection: vec3f,
  _padWitness: u32,
  witnessAnchorPoint: vec4f,
  witnessAnchorCellIndices: vec4<i32>,
  witnessThroughput: vec3f,
  witnessBound: f32,
  accumulatedRadiance: vec3f,
  pendingMask: u32,
  acceptedResidual: f32,
  replayPasses: u32,
  acceptedMask: u32,
  invalidMask: u32,
}
struct TraceResult {
  radiance: vec3f,
  status: u32,
  residual: f32,
  capEvents: u32,
  failureMask: u32,
  traversalReasonMask: u32,
  witnessReason: u32,
  witnessTraversalReason: u32,
  witnessMedium: u32,
  witnessOrigin: vec3f,
  witnessAnchorMask: u32,
  witnessDirection: vec3f,
  _padWitness: u32,
  witnessAnchorPoint: vec4f,
  witnessAnchorCellIndices: vec4<i32>,
  witnessThroughput: vec3f,
  witnessBound: f32,
}
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
  anchorCellIndices: vec4<i32>,
  hasAnchor: u32,
}
@group(0) @binding(0) var<uniform> solid: DielectricSolidFixture;
@group(0) @binding(1) var<uniform> camera: CameraControl;
@group(0) @binding(2) var<storage, read_write> output: array<OutputPixel>;

const FAILURE_TRAVERSAL: u32 = 1u;
const FAILURE_INSIDE_MISS: u32 = 2u;
const FAILURE_STACK_LIMIT: u32 = 4u;
const FAILURE_INTERFACE_LIMIT: u32 = 8u;
const FAILURE_PROCESSED_LIMIT: u32 = 16u;

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
// DIELECTRIC_SOLID_WGSL supplies ordinary and canonical-anchor boundary
// queries. Secondary paths carry the shared post-incident intrinsic anchor.
fn traceGlass(origin: vec3f, direction: vec3f, theta: f32) -> TraceResult {
  var paths: array<PathState, ${MAX_PATHS}>;
  paths[0] = PathState(
    origin, direction, vec3f(1.0), 0u, -1, -1, 0u,
    vec4f(0.0), 0u, vec4<i32>(-1), vec4<i32>(-1), 0u,
  );
  var pending = 1u;
  var processed = 0u;
  var radiance = vec3f(0.0);
  var residual = 0.0;
  var status = ${STATUS_COMPLETE}u;
  var capEvents = 0u;
  var failureMask = 0u;
  var traversalReasonMask = 0u;
  var witnessReason = 0u;
  var witnessTraversalReason = 0u;
  var witnessMedium = 0u;
  var witnessOrigin = vec3f(0.0);
  var witnessAnchorMask = 0u;
  var witnessDirection = vec3f(0.0);
  var witnessAnchorPoint = vec4f(0.0);
  var witnessAnchorCellIndices = vec4<i32>(-1);
  var witnessThroughput = vec3f(0.0);
  var witnessBound = 0.0;
  loop {
    if (pending == 0u) { break; }
    pending--;
    var path = paths[pending];
    if (maxChannel(path.energy) * ${ENVIRONMENT_BOUND} <= theta) {
      residual += maxChannel(path.energy) * ${ENVIRONMENT_BOUND};
      continue;
    }
    processed++;
    if (processed > ${MAX_PROCESSED_PATHS}u) {
      residual += max(max(path.energy.x, path.energy.y), path.energy.z) * ${ENVIRONMENT_BOUND};
      status = ${STATUS_UNRESOLVED}u;
      capEvents++;
      failureMask |= FAILURE_PROCESSED_LIMIT;
      if (witnessReason == 0u) {
        witnessReason = FAILURE_PROCESSED_LIMIT;
        witnessMedium = path.inside;
        witnessOrigin = path.origin;
        witnessDirection = path.direction;
        witnessAnchorMask = path.anchorPlaneMask;
        witnessAnchorPoint = path.anchorPoint;
        witnessAnchorCellIndices = path.anchorCellIndices;
        witnessThroughput = path.energy;
        witnessBound = maxChannel(path.energy) * ${ENVIRONMENT_BOUND};
      }
      continue;
    }
    if (path.interfaces >= ${MAX_INTERFACES}u) {
      residual += max(max(path.energy.x, path.energy.y), path.energy.z) * ${ENVIRONMENT_BOUND};
      status = ${STATUS_UNRESOLVED}u;
      capEvents++;
      failureMask |= FAILURE_INTERFACE_LIMIT;
      if (witnessReason == 0u) {
        witnessReason = FAILURE_INTERFACE_LIMIT;
        witnessMedium = path.inside;
        witnessOrigin = path.origin;
        witnessDirection = path.direction;
        witnessAnchorMask = path.anchorPlaneMask;
        witnessAnchorPoint = path.anchorPoint;
        witnessAnchorCellIndices = path.anchorCellIndices;
        witnessThroughput = path.energy;
        witnessBound = maxChannel(path.energy) * ${ENVIRONMENT_BOUND};
      }
      continue;
    }
    var boundary: DielectricBoundaryResult;
    if (path.hasAnchor != 0u) {
      boundary = dielectricNextBoundaryFromAnchor(
        solid, path.direction, path.inside, path.anchorPoint,
        path.anchorPlaneMask, path.anchorPlaneIndices, path.anchorCellIndices,
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
      failureMask |= FAILURE_TRAVERSAL;
      traversalReasonMask |= 1u << min(boundary.reason, 31u);
      if (witnessReason == 0u) {
        witnessReason = FAILURE_TRAVERSAL;
        witnessTraversalReason = boundary.reason;
        witnessMedium = path.inside;
        witnessOrigin = path.origin;
        witnessDirection = path.direction;
        witnessAnchorMask = path.anchorPlaneMask;
        witnessAnchorPoint = path.anchorPoint;
        witnessAnchorCellIndices = path.anchorCellIndices;
        witnessThroughput = path.energy;
        witnessBound = maxChannel(path.energy) * ${ENVIRONMENT_BOUND};
      }
      continue;
    }
    if (boundary.kind == DIELECTRIC_RESULT_MISS) {
      if (path.inside != 0u) {
        status = ${STATUS_UNRESOLVED}u;
        residual += max(max(path.energy.x, path.energy.y), path.energy.z) * ${ENVIRONMENT_BOUND};
        capEvents++;
        failureMask |= FAILURE_INSIDE_MISS;
        if (witnessReason == 0u) {
          witnessReason = FAILURE_INSIDE_MISS;
          witnessMedium = path.inside;
          witnessOrigin = path.origin;
          witnessDirection = path.direction;
          witnessAnchorMask = path.anchorPlaneMask;
          witnessAnchorPoint = path.anchorPoint;
          witnessAnchorCellIndices = path.anchorCellIndices;
          witnessThroughput = path.energy;
          witnessBound = maxChannel(path.energy) * ${ENVIRONMENT_BOUND};
        }
      } else {
        radiance += path.energy * rearScene(path.origin, path.direction);
      }
      continue;
    }
    let hit = path.origin + boundary.t * path.direction;
    if (camera.tile.z == 0u) {
      let key = max(dot(boundary.outwardNormal, normalize(vec3f(-0.45, 0.78, 0.42))), 0.0);
      return TraceResult(vec3f(0.54, 0.58, 0.60) * (0.20 + 0.80 * key), ${STATUS_COMPLETE}u, 0.0, 0u, 0u, 0u, 0u, 0u, 0u, vec3f(0.0), 0u, vec3f(0.0), 0u, vec4f(0.0), vec4<i32>(-1), vec3f(0.0), 0.0);
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
      if (maxChannel(energy) * ${ENVIRONMENT_BOUND} <= theta) {
        residual += maxChannel(energy) * ${ENVIRONMENT_BOUND};
      } else if (pending < ${MAX_PATHS}u) {
        paths[pending] = PathState(
          hit, refracted.xyz, energy, path.inside, i32(boundary.axis), boundary.planeIndex, path.interfaces + 1u,
          boundary.intrinsicPoint, boundary.planeMask, boundary.planeIndices, boundary.cellIndices, 1u,
        );
        pending++;
      } else {
        residual += max(max(energy.x, energy.y), energy.z) * ${ENVIRONMENT_BOUND};
        status = ${STATUS_UNRESOLVED}u;
        capEvents++;
        failureMask |= FAILURE_STACK_LIMIT;
        if (witnessReason == 0u) {
          witnessReason = FAILURE_STACK_LIMIT;
          witnessMedium = path.inside;
          witnessOrigin = hit;
          witnessDirection = refracted.xyz;
          witnessAnchorMask = boundary.planeMask;
          witnessAnchorPoint = boundary.intrinsicPoint;
          witnessAnchorCellIndices = boundary.cellIndices;
          witnessThroughput = energy;
          witnessBound = maxChannel(energy) * ${ENVIRONMENT_BOUND};
        }
      }
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
      if (maxChannel(childEnergy) * ${ENVIRONMENT_BOUND} <= theta) {
        residual += maxChannel(childEnergy) * ${ENVIRONMENT_BOUND};
      } else if (pending < ${MAX_PATHS}u) {
        paths[pending] = PathState(
          hit, childDirection, childEnergy, childInside, i32(boundary.axis), boundary.planeIndex, path.interfaces + 1u,
          boundary.intrinsicPoint, boundary.planeMask, boundary.planeIndices, boundary.cellIndices, 1u,
        );
        pending++;
      } else {
        residual += maxChannel(childEnergy) * ${ENVIRONMENT_BOUND};
        status = ${STATUS_UNRESOLVED}u;
        capEvents++;
        failureMask |= FAILURE_STACK_LIMIT;
        if (witnessReason == 0u) {
          witnessReason = FAILURE_STACK_LIMIT;
          witnessMedium = childInside;
          witnessOrigin = hit;
          witnessDirection = childDirection;
          witnessAnchorMask = boundary.planeMask;
          witnessAnchorPoint = boundary.intrinsicPoint;
          witnessAnchorCellIndices = boundary.cellIndices;
          witnessThroughput = childEnergy;
          witnessBound = maxChannel(childEnergy) * ${ENVIRONMENT_BOUND};
        }
      }
    }
  }
  if (status == ${STATUS_COMPLETE}u && residual > 0.0) { status = ${STATUS_RESIDUAL}u; }
  return TraceResult(
    radiance, status, residual, capEvents, failureMask, traversalReasonMask,
    witnessReason, witnessTraversalReason, witnessMedium, witnessOrigin,
    witnessAnchorMask, witnessDirection, 0u, witnessAnchorPoint,
    witnessAnchorCellIndices, witnessThroughput, witnessBound,
  );
}
@compute @workgroup_size(${WORKGROUP})
fn renderDielectric(@builtin(global_invocation_id) gid: vec3u) {
  let local = gid.x;
  let tilePixels = camera.tile.x * camera.tile.y;
  if (local >= tilePixels) { return; }
  let pixel = vec2u(camera.extent.z + local % camera.tile.x, camera.extent.w + local / camera.tile.x);
  let passIndex = camera.tile.w;
  if (passIndex == 0u) {
    output[local] = OutputPixel(
      0u, ${STATUS_UNRESOLVED}u, 0.0, 0u, 0u, 0u, 0u, 0u,
      0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u,
      0u, 0u, 0u, 0u, vec3f(0.0), 0u, vec3f(0.0), 0u, vec4f(0.0), vec4<i32>(-1),
      vec3f(0.0), 0.0, vec3f(0.0), (1u << ${SPP}u) - 1u, 0.0, 0u, 0u, 0u,
    );
  }
  var state = output[local];
  let theta = ${INITIAL_BRANCH_THETA} * exp2(-f32(passIndex));
  for (var sample = 0u; sample < ${SPP}u; sample++) {
    let sampleBit = 1u << sample;
    if ((state.pendingMask & sampleBit) == 0u) { continue; }
    let jitter = vec2f(f32(sample & 1u) * 0.5 - 0.25, f32(sample >> 1u) * 0.5 - 0.25);
    let raster = vec2f(pixel) + vec2f(0.5) + jitter;
    // Output RGBA row zero is the PNG top row, so its ray points toward
    // positive camera-up. X retains the usual left-to-right NDC mapping.
    let ndc = vec2f(
      2.0 * raster.x / f32(camera.extent.x) - 1.0,
      1.0 - 2.0 * raster.y / f32(camera.extent.y),
    );
    let ray = normalize(camera.forward.xyz + ndc.x * camera.right.xyz + ndc.y * camera.up.xyz);
    let traced = traceGlass(camera.eye.xyz, ray, theta);
    state.capEvents += traced.capEvents;
    state.failureMask |= traced.failureMask;
    state.traversalReasonMask |= traced.traversalReasonMask;
    state.traversalSamples += select(0u, 1u, (traced.failureMask & FAILURE_TRAVERSAL) != 0u);
    state.insideMissSamples += select(0u, 1u, (traced.failureMask & FAILURE_INSIDE_MISS) != 0u);
    state.stackLimitSamples += select(0u, 1u, (traced.failureMask & FAILURE_STACK_LIMIT) != 0u);
    state.interfaceLimitSamples += select(0u, 1u, (traced.failureMask & FAILURE_INTERFACE_LIMIT) != 0u);
    state.processedLimitSamples += select(0u, 1u, (traced.failureMask & FAILURE_PROCESSED_LIMIT) != 0u);
    if (traced.witnessReason != 0u && (state.witnessReason == 0u || (traced.witnessReason == FAILURE_INSIDE_MISS && state.witnessReason != FAILURE_INSIDE_MISS))) {
      state.witnessReason = traced.witnessReason;
      state.witnessTraversalReason = traced.witnessTraversalReason;
      state.witnessMedium = traced.witnessMedium;
      state.witnessSample = sample;
      state.witnessOrigin = traced.witnessOrigin;
      state.witnessAnchorMask = traced.witnessAnchorMask;
      state.witnessDirection = traced.witnessDirection;
      state.witnessAnchorPoint = traced.witnessAnchorPoint;
      state.witnessAnchorCellIndices = traced.witnessAnchorCellIndices;
      state.witnessThroughput = traced.witnessThroughput;
      state.witnessBound = traced.witnessBound;
    }
    let residualFinite = traced.residual == traced.residual &&
      abs(traced.residual) < 3.402823466e+38;
    let radianceFinite = all(traced.radiance == traced.radiance) &&
      all(abs(traced.radiance) < vec3f(3.402823466e+38));
    if (!radianceFinite) {
      state.invalidMask |= sampleBit;
      state.pendingMask &= ~sampleBit;
      continue;
    }
    let accepted = traced.status != ${STATUS_UNRESOLVED}u && residualFinite &&
      radianceFinite && traced.residual <= ${ERROR_BUDGET};
    if (accepted) {
      state.accumulatedRadiance += traced.radiance / f32(${SPP});
      state.acceptedResidual += traced.residual / f32(${SPP});
      state.acceptedMask |= sampleBit;
      state.pendingMask &= ~sampleBit;
    }
  }
  state.replayPasses = passIndex + 1u;
  state.packed = packColor(state.accumulatedRadiance);
  state.residual = state.acceptedResidual * f32(${SPP});
  state.sampleComplete = countOneBits(state.acceptedMask);
  state.sampleUnresolved = countOneBits(state.pendingMask);
  state.sampleInvalid = countOneBits(state.invalidMask);
  if (state.invalidMask != 0u) {
    state.status = ${STATUS_INVALID}u;
  } else if (state.pendingMask == 0u) {
    state.status = select(${STATUS_COMPLETE}u, ${STATUS_RESIDUAL}u, state.acceptedResidual > 0.0);
  } else if (passIndex + 1u >= ${REPLAY_PASSES}u) {
    state.status = ${STATUS_UNRESOLVED}u;
  }
  output[local] = state;
}`;
}

export async function runTransmissionDielectricGpu(input: Options = {}) {
  const pageRunStarted = performance.now();
  const requestedWidth = input.width ?? 1024;
  const requestedHeight = input.height ?? 1024;
  const width = input.diagnostic
    ? Math.min(32, requestedWidth)
    : requestedWidth;
  const height = input.diagnostic
    ? Math.min(32, requestedHeight)
    : requestedHeight;
  const imageWindow = input.window ?? {
    x: 0,
    y: 0,
    width,
    height,
  };
  const tileWidth = Math.min(input.tileWidth ?? 128, imageWindow.width);
  const tileHeight = Math.min(input.tileHeight ?? 64, imageWindow.height);
  if (
    ![width, height, tileWidth, tileHeight].every(
      (value) => Number.isInteger(value) && value > 0,
    )
  )
    return {
      inconclusive: "image and tile dimensions must be positive integers",
    };
  if (
    ![
      imageWindow.x,
      imageWindow.y,
      imageWindow.width,
      imageWindow.height,
    ].every((value) => Number.isInteger(value)) ||
    imageWindow.x < 0 ||
    imageWindow.y < 0 ||
    imageWindow.width <= 0 ||
    imageWindow.height <= 0 ||
    imageWindow.x + imageWindow.width > width ||
    imageWindow.y + imageWindow.height > height
  )
    return {
      inconclusive:
        "window must be a positive integer rectangle inside the full raster",
    };
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
  const plannedMemory = memoryPlan(
    imageWindow.width,
    imageWindow.height,
    tileWidth,
    tileHeight,
  );
  if (plannedMemory.knownAdditionalBytes > plannedMemory.limitBytes)
    return {
      preflightRefusal: {
        reason:
          "known page, GPU-buffer and logical private-stack plan exceeds the additional-state limit before allocation",
        memory: plannedMemory,
      },
    };
  if (runReserved)
    return { inconclusive: "another dielectric run is already active" };
  runReserved = true;
  const adapterDeviceSetupStarted = performance.now();
  let adapter: GPUAdapter | null;
  try {
    adapter =
      (await navigator.gpu?.requestAdapter({
        powerPreference: "high-performance",
      })) ?? null;
  } catch (error) {
    runReserved = false;
    throw error;
  }
  if (!adapter) {
    runReserved = false;
    return { inconclusive: "no WebGPU adapter" };
  }
  const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean };
  if (
    (adapter as GPUAdapter & { isFallbackAdapter?: boolean })
      .isFallbackAdapter ||
    info.isFallbackAdapter ||
    [info.vendor, info.architecture, info.device, info.description].some(
      (value) => /swiftshader|llvmpipe|software/i.test(value),
    )
  ) {
    runReserved = false;
    return {
      inconclusive: "browser adapter is fallback or software",
      browserAdapter: info,
    };
  }
  let device: GPUDevice;
  try {
    device = await adapter.requestDevice();
  } catch (error) {
    runReserved = false;
    throw error;
  }
  const adapterDeviceSetupMs = performance.now() - adapterDeviceSetupStarted;
  if (activeRun !== null) {
    device.destroy();
    runReserved = false;
    return { inconclusive: "another dielectric run is already active" };
  }
  const runProgress: DielectricRunProgress = {
    runId: nextRunId++,
    stage: "controls",
    fixture: selectedFixtures[0].id,
    mode: selectedModes[0],
    completedTiles: 0,
    totalTiles:
      Math.ceil(imageWindow.width / tileWidth) *
      Math.ceil(imageWindow.height / tileHeight),
    submissions: 0,
    totalSubmissions:
      Math.ceil(imageWindow.width / tileWidth) *
      Math.ceil(imageWindow.height / tileHeight) *
      REPLAY_PASSES,
    replayPass: null,
    submissionInFlight: false,
    activeSubmission: null,
    activeSubmissionStartedAtMs: null,
    lastSubmissionWallMs: null,
    maxSubmissionWallMs: 0,
    cancelRequested: false,
    cancelRequestedAtMs: null,
    cancelAcknowledgedAtMs: null,
    cleanupCompleted: false,
    cleanupWallMs: null,
    cleanupError: null,
  };
  activeRun = runProgress;
  const uncaptured: string[] = [];
  let lost: string | null = null;
  device.addEventListener("uncapturederror", (event) =>
    uncaptured.push(event.error.message),
  );
  void device.lost.then((detail) => {
    lost = `${detail.reason}: ${detail.message}`;
  });
  try {
    const controlsStarted = performance.now();
    const controls = await runDielectricGpuControls(
      device,
      dielectricWgsl(),
      OUTPUT_PIXEL_BYTES,
    );
    const controlsMs = performance.now() - controlsStarted;
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
    runProgress.stage = "pipeline";
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
      maxTilePixels * OUTPUT_PIXEL_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    const readback = gpuBuffer(
      device,
      maxTilePixels * OUTPUT_PIXEL_BYTES,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    );
    const pipelineSetupMs = performance.now() - pipelineSetupStarted;
    const cancelledResult = () => {
      runProgress.cancelAcknowledgedAtMs ??= performance.now();
      return {
        cancelled: {
          reason: "dielectric run cancelled between bounded submissions",
          acknowledgementLatencyMs:
            runProgress.cancelRequestedAtMs === null
              ? null
              : runProgress.cancelAcknowledgedAtMs -
                runProgress.cancelRequestedAtMs,
          progress: runProgress,
        },
        browserAdapter: {
          vendor: info.vendor,
          architecture: info.architecture,
          device: info.device,
          description: info.description,
          isFallbackAdapter: !!info.isFallbackAdapter,
        },
        controls,
        timing: {
          adapterDeviceSetupMs,
          controlsMs,
          pipelineSetupMs,
          pageWorkWallMs: performance.now() - pageRunStarted,
        },
        runtime: { uncaptured, lost },
      };
    };
    if (runProgress.cancelRequested) return cancelledResult();
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
      raster: {
        fullWidth: number;
        fullHeight: number;
        window: PixelRegion;
      };
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
        replay: {
          maxPerPixelMaxChannelLinearRgbBound: number;
          allSamplesComplete: boolean;
          capFree: boolean;
          sampleComplete: number;
          sampleTotal: number;
          sampleUnresolved: number;
          sampleInvalid: number;
          unresolvedPixels: number;
          invalidPixels: number;
          capEvents: number;
        };
        scope: string;
      };
      memory: typeof plannedMemory;
      timing: {
        adapterDeviceSetupMs: number;
        controlsMs: number;
        pipelineSetupMs: number;
        tileEncodeSubmitMapWallMs: number;
        maxTileEncodeSubmitMapWallMs: number;
        maxReadbackMapWallMs: number;
        maxTileHostAssemblyWallMs: number;
        maxCancellationCheckpointWallMs: number;
        tiles: number;
        replayPassFenceWallMs: number[];
        tileHostAssemblyWallMs: number;
        base64EncodeMs: number;
        pageWorkWallMs: number;
        pageWorkWallScope: string;
      };
      refusal: {
        failurePixels: Record<string, number>;
        failureSamples: Record<string, number>;
        traversalReasonPixels: Record<string, number>;
        witnesses: {
          pixel: [number, number];
          sample: number;
          reason: string;
          traversalReason: number;
          medium: "outside" | "inside";
          origin: [number, number, number];
          direction: [number, number, number];
          anchorMask: number;
          anchorPoint: [number, number, number, number];
          anchorCellIndices: [number, number, number, number];
          throughput: [number, number, number];
          radianceBound: number;
        }[];
      };
    }[] = [];
    const view = cameraBasis();
    for (const fixture of selectedFixtures) {
      device.queue.writeBuffer(solid, 0, fixture.packed);
      for (const mode of selectedModes) {
        runProgress.stage = "render";
        const rgba = new Uint8Array(imageWindow.width * imageWindow.height * 4);
        const completion = {
          complete: 0,
          residual: 0,
          unresolved: 0,
          invalid: 0,
          capEvents: 0,
          sampleTotal: imageWindow.width * imageWindow.height * SPP,
          sampleComplete: 0,
          sampleUnresolved: 0,
          sampleInvalid: 0,
          total: imageWindow.width * imageWindow.height,
        };
        let radianceBound = 0;
        let totalRadianceBound = 0;
        let totalSampleMaxChannelRadianceBound = 0;
        const failurePixels = {
          traversal: 0,
          insideMiss: 0,
          stackLimit: 0,
          interfaceLimit: 0,
          processedLimit: 0,
        };
        const failureSamples = { ...failurePixels };
        const traversalReasonPixels: Record<string, number> = {};
        const witnesses: {
          pixel: [number, number];
          sample: number;
          reason: string;
          traversalReason: number;
          medium: "outside" | "inside";
          origin: [number, number, number];
          direction: [number, number, number];
          anchorMask: number;
          anchorPoint: [number, number, number, number];
          anchorCellIndices: [number, number, number, number];
          throughput: [number, number, number];
          radianceBound: number;
        }[] = [];
        let tileEncodeSubmitMapWallMs = 0;
        let maxTileEncodeSubmitMapWallMs = 0;
        let maxReadbackMapWallMs = 0;
        let maxTileHostAssemblyWallMs = 0;
        let tileHostAssemblyWallMs = 0;
        let tiles = 0;
        const replayPassFenceWallMs = Array<number>(REPLAY_PASSES).fill(0);
        for (
          let y = imageWindow.y;
          y < imageWindow.y + imageWindow.height;
          y += tileHeight
        ) {
          for (
            let x = imageWindow.x;
            x < imageWindow.x + imageWindow.width;
            x += tileWidth
          ) {
            const currentWidth = Math.min(
              tileWidth,
              imageWindow.x + imageWindow.width - x,
            );
            const currentHeight = Math.min(
              tileHeight,
              imageWindow.y + imageWindow.height - y,
            );
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
              [currentWidth, currentHeight, mode === "opaque" ? 0 : 1, 0],
              20,
            );
            const bind = device.createBindGroup({
              layout,
              entries: [
                { binding: 0, resource: { buffer: solid } },
                { binding: 1, resource: { buffer: camera } },
                { binding: 2, resource: { buffer: output } },
              ],
            });
            const tileStarted = performance.now();
            for (let replayPass = 0; replayPass < REPLAY_PASSES; replayPass++) {
              const replayPassStarted = performance.now();
              runProgress.replayPass = replayPass;
              uints[23] = replayPass;
              device.queue.writeBuffer(camera, 0, control);
              const encoder = device.createCommandEncoder();
              const pass = encoder.beginComputePass();
              pass.setPipeline(pipeline);
              pass.setBindGroup(0, bind);
              pass.dispatchWorkgroups(
                Math.ceil((currentWidth * currentHeight) / WORKGROUP),
              );
              pass.end();
              if (replayPass + 1 === REPLAY_PASSES)
                encoder.copyBufferToBuffer(
                  output,
                  0,
                  readback,
                  0,
                  currentWidth * currentHeight * OUTPUT_PIXEL_BYTES,
                );
              runProgress.submissionInFlight = true;
              runProgress.activeSubmission = runProgress.submissions + 1;
              runProgress.activeSubmissionStartedAtMs = performance.now();
              device.queue.submit([encoder.finish()]);
              await device.queue.onSubmittedWorkDone();
              const submissionWallMs = performance.now() - replayPassStarted;
              replayPassFenceWallMs[replayPass] += submissionWallMs;
              runProgress.submissions++;
              runProgress.submissionInFlight = false;
              runProgress.activeSubmission = null;
              runProgress.activeSubmissionStartedAtMs = null;
              runProgress.lastSubmissionWallMs = submissionWallMs;
              runProgress.maxSubmissionWallMs = Math.max(
                runProgress.maxSubmissionWallMs,
                submissionWallMs,
              );
              await yieldToBrowserTasks();
              if (runProgress.cancelRequested) return cancelledResult();
            }
            const readbackStarted = performance.now();
            await readback.mapAsync(GPUMapMode.READ);
            const mapped = readback
              .getMappedRange()
              .slice(0, currentWidth * currentHeight * OUTPUT_PIXEL_BYTES);
            readback.unmap();
            maxReadbackMapWallMs = Math.max(
              maxReadbackMapWallMs,
              performance.now() - readbackStarted,
            );
            await yieldToBrowserTasks();
            if (runProgress.cancelRequested) return cancelledResult();
            const tileElapsed = performance.now() - tileStarted;
            tileEncodeSubmitMapWallMs += tileElapsed;
            maxTileEncodeSubmitMapWallMs = Math.max(
              maxTileEncodeSubmitMapWallMs,
              tileElapsed,
            );
            tiles++;
            runProgress.completedTiles = tiles;
            runProgress.stage = "assemble";
            const assemblyStarted = performance.now();
            const values = new Uint32Array(mapped);
            const residualValues = new Float32Array(mapped);
            for (let local = 0; local < currentWidth * currentHeight; local++) {
              const target =
                (y + Math.floor(local / currentWidth) - imageWindow.y) *
                  imageWindow.width +
                x -
                imageWindow.x +
                (local % currentWidth);
              const offset = local * (OUTPUT_PIXEL_BYTES / 4);
              const packed = values[offset];
              rgba[target * 4] = packed & 255;
              rgba[target * 4 + 1] = (packed >>> 8) & 255;
              rgba[target * 4 + 2] = (packed >>> 16) & 255;
              rgba[target * 4 + 3] = 255;
              const status = values[offset + 1];
              if (status === STATUS_COMPLETE) completion.complete++;
              else if (status === STATUS_RESIDUAL) {
                completion.complete++;
                completion.residual++;
              } else if (status === STATUS_UNRESOLVED) completion.unresolved++;
              else completion.invalid++;
              completion.capEvents += values[offset + 3];
              completion.sampleComplete += values[offset + 4];
              completion.sampleUnresolved += values[offset + 5];
              completion.sampleInvalid += values[offset + 6];
              const failureMask = values[offset + 8];
              const traversalReasonMask = values[offset + 9];
              const names = [
                "traversal",
                "insideMiss",
                "stackLimit",
                "interfaceLimit",
                "processedLimit",
              ] as const;
              for (let bit = 0; bit < names.length; bit++) {
                if ((failureMask & (1 << bit)) !== 0)
                  failurePixels[names[bit]]++;
              }
              failureSamples.traversal += values[offset + 10];
              failureSamples.insideMiss += values[offset + 11];
              failureSamples.stackLimit += values[offset + 12];
              failureSamples.interfaceLimit += values[offset + 13];
              failureSamples.processedLimit += values[offset + 14];
              for (let reason = 0; reason < 32; reason++) {
                if ((traversalReasonMask & (1 << reason)) !== 0)
                  traversalReasonPixels[String(reason)] =
                    (traversalReasonPixels[String(reason)] ?? 0) + 1;
              }
              if (values[offset + 16] !== 0) {
                const witness: (typeof witnesses)[number] = {
                  pixel: [
                    x + (local % currentWidth),
                    y + Math.floor(local / currentWidth),
                  ],
                  sample: values[offset + 19],
                  reason:
                    names[Math.log2(values[offset + 16]) | 0] ?? "unknown",
                  traversalReason: values[offset + 17],
                  medium: values[offset + 18] === 0 ? "outside" : "inside",
                  origin: [
                    residualValues[offset + 20],
                    residualValues[offset + 21],
                    residualValues[offset + 22],
                  ],
                  direction: [
                    residualValues[offset + 24],
                    residualValues[offset + 25],
                    residualValues[offset + 26],
                  ],
                  anchorMask: values[offset + 23],
                  anchorPoint: [
                    residualValues[offset + 28],
                    residualValues[offset + 29],
                    residualValues[offset + 30],
                    residualValues[offset + 31],
                  ],
                  anchorCellIndices: [
                    values[offset + 32] | 0,
                    values[offset + 33] | 0,
                    values[offset + 34] | 0,
                    values[offset + 35] | 0,
                  ],
                  throughput: [
                    residualValues[offset + 36],
                    residualValues[offset + 37],
                    residualValues[offset + 38],
                  ],
                  radianceBound: residualValues[offset + 39],
                };
                if (witness.reason === "insideMiss") {
                  witnesses.unshift(witness);
                  if (witnesses.length > 4) witnesses.pop();
                } else if (witnesses.length < 4) witnesses.push(witness);
              }
              const perPixelAverage = residualValues[offset + 2] / SPP;
              radianceBound = Math.max(radianceBound, perPixelAverage);
              totalRadianceBound += perPixelAverage;
              totalSampleMaxChannelRadianceBound += residualValues[offset + 2];
            }
            const assemblyWallMs = performance.now() - assemblyStarted;
            tileHostAssemblyWallMs += assemblyWallMs;
            maxTileHostAssemblyWallMs = Math.max(
              maxTileHostAssemblyWallMs,
              assemblyWallMs,
            );
            runProgress.stage = "render";
            await yieldToBrowserTasks();
            if (runProgress.cancelRequested) return cancelledResult();
          }
        }
        runProgress.stage = "base64";
        const base64Started = performance.now();
        const imageBase64 = base64(rgba);
        const base64EncodeMs = performance.now() - base64Started;
        await yieldToBrowserTasks();
        if (runProgress.cancelRequested) return cancelledResult();
        rows.push({
          key: fixture.id,
          role: mode === "glass" ? "main" : "opaque-control",
          fixture: fixture.id,
          mode,
          scene: fixture.scene,
          samplesPerPixel: SPP,
          width: imageWindow.width,
          height: imageWindow.height,
          imageBase64,
          raster: {
            fullWidth: width,
            fullHeight: height,
            window: imageWindow,
          },
          completion,
          residual: {
            radianceBound,
            totalRadianceBound,
            totalSampleMaxChannelRadianceBound,
            errorBudget: ERROR_BUDGET,
            environmentRadianceBound: ENVIRONMENT_BOUND,
            replay: {
              maxPerPixelMaxChannelLinearRgbBound: radianceBound,
              allSamplesComplete:
                completion.sampleComplete === completion.sampleTotal &&
                completion.sampleUnresolved === 0 &&
                completion.sampleInvalid === 0 &&
                completion.unresolved === 0 &&
                completion.invalid === 0,
              capFree: completion.capEvents === 0,
              sampleComplete: completion.sampleComplete,
              sampleTotal: completion.sampleTotal,
              sampleUnresolved: completion.sampleUnresolved,
              sampleInvalid: completion.sampleInvalid,
              unresolvedPixels: completion.unresolved,
              invalidPixels: completion.invalid,
              capEvents: completion.capEvents,
            },
            scope:
              "radianceBound is the gate: maximum per-pixel, four-sample-average, max-channel discarded-branch bound. totalRadianceBound sums pixel averages across the image and totalSampleMaxChannelRadianceBound sums raw samples; both are instruments only and are not compared with the per-pixel error budget.",
          },
          memory: plannedMemory,
          timing: {
            adapterDeviceSetupMs,
            controlsMs,
            pipelineSetupMs,
            tileEncodeSubmitMapWallMs,
            maxTileEncodeSubmitMapWallMs,
            maxReadbackMapWallMs,
            maxTileHostAssemblyWallMs,
            maxCancellationCheckpointWallMs: Math.max(
              runProgress.maxSubmissionWallMs,
              maxReadbackMapWallMs,
              maxTileHostAssemblyWallMs,
              base64EncodeMs,
            ),
            tiles,
            replayPassFenceWallMs,
            tileHostAssemblyWallMs,
            base64EncodeMs,
            pageWorkWallMs: performance.now() - pageRunStarted,
            pageWorkWallScope:
              "Browser wall from runner entry through adapter/device setup, current-source controls, pipeline setup, complete tile work, host assembly and base64 encoding; excludes final device drain/destruction and launcher work.",
          },
          refusal: {
            failurePixels,
            failureSamples,
            traversalReasonPixels,
            witnesses,
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
        raster: {
          fullWidth: width,
          fullHeight: height,
          window: imageWindow,
        },
        fixture: input.fixture,
        mode: input.mode,
        diagnostic: !!input.diagnostic,
        spp: SPP,
        maxPaths: MAX_PATHS,
        maxPathsDerivation:
          "weaker-first DFS: ceil(log2(4 / (epsilon / (64 * 2^5)))) + 1 = 24 live entries; assumes 4 maximum initial radiance and absorption only decreases branch throughput",
        maxInterfaces: MAX_INTERFACES,
        maxProcessedPaths: MAX_PROCESSED_PATHS,
        replay: {
          attempts: REPLAY_PASSES,
          initialBranchTheta: INITIAL_BRANCH_THETA,
          thetaRule: "theta(attempt) = initialBranchTheta * exp2(-attempt)",
          errorBudget: ERROR_BUDGET,
          environmentRadianceBound: ENVIRONMENT_BOUND,
          samplesPerPixel: SPP,
        },
        imageCoordinates: {
          outputRowZero: "PNG top row",
          ndc: "x = 2*rasterX/width-1; y = 1-2*rasterY/height",
          note: "Archived pre-flip diagnostics retain their original ray convention.",
        },
      },
      rows,
      schedule: runProgress,
      runtime: { uncaptured, lost },
    };
  } finally {
    const cleanupStarted = performance.now();
    runProgress.stage = "cleanup";
    try {
      await device.queue.onSubmittedWorkDone();
      device.destroy();
      runProgress.cleanupCompleted = true;
    } catch (error) {
      runProgress.cleanupError =
        error instanceof Error ? error.message : String(error);
      try {
        device.destroy();
      } catch {
        // The first cleanup failure remains the useful diagnosis.
      }
    } finally {
      runProgress.cleanupWallMs = performance.now() - cleanupStarted;
      if (activeRun === runProgress) activeRun = null;
      runReserved = false;
    }
  }
}

declare global {
  interface Window {
    TransmissionDielectricGpu?: {
      runTransmissionDielectricGpu: typeof runTransmissionDielectricGpu;
      transmissionDielectricGpuProgress: typeof transmissionDielectricGpuProgress;
      cancelTransmissionDielectricGpu: typeof cancelTransmissionDielectricGpu;
    };
  }
}
Object.assign(globalThis, {
  TransmissionDielectricGpu: {
    runTransmissionDielectricGpu,
    transmissionDielectricGpuProgress,
    cancelTransmissionDielectricGpu,
  },
});
