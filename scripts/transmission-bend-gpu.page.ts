/**
 * Harness-only GPU image experiment for the CPU thin-interface study.
 *
 * It evaluates the public estimator WGSL and the shared finish emission, but
 * owns every buffer, continuation decision and output record. It is not an
 * application renderer or a production scheduling proposal.
 */
import {
  buildEscapeDE4,
  estimateEscapeDistance4,
} from "../src/fractal/escape-de-4d";
import { ESCAPE_TIME_ITERATIONS } from "../src/fractal/escape-de";
import { rotationMatrix4 } from "../src/fractal/affine4";
import { mandelboxClassic, mengerSponge } from "../src/fractal/presets";
import {
  buildSurfaceDE,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import {
  packEscape4GpuMaps,
  packEscape4GpuParams,
  packSurfaceGpuMaps,
  packSurfaceGpuParams,
  surfaceDeKernelWgsl,
} from "../src/fractal/surface-de-gpu";
import {
  SURFACE_FINISH_WGSL,
  surfaceFinishShadeSource,
} from "../src/fractal/surface-finish";
import { LAYER_FIELD_WGSL } from "./transmission-layer-field";

type Vec3 = [number, number, number];
type FixtureId = "menger3" | "native4";
type Mode = "none" | "weighted";
type Core = "affine" | "escape4";
type Options = {
  width?: number;
  height?: number;
  k?: number;
  fixture?: FixtureId | "";
  mode?: Mode | "";
  cpuCompareSize?: number;
  visuals?: Record<FixtureId, Visual>;
  reference?: Reference;
};
type Visual = {
  radius: number;
  center: Vec3;
  eye: Vec3;
  target: Vec3;
  zoom: number;
};
type Reference = {
  transmit: number;
  ior: number;
  slabFraction: number;
  maxOffsetFraction: number;
  opticalNormalFraction: number;
};
type Fixture = {
  id: FixtureId;
  core: Core;
  radius: number;
  center: Vec3;
  eye: Vec3;
  target: Vec3;
  zoom: number;
  maps: Float32Array;
  params: ArrayBuffer;
  maxDepth: number;
  cpuDistance: (p: Vec3) => number;
};

const WORKGROUP = 64;
const STATE_BYTES = 112;
const OUTPUT_BYTES = 4;
const QUEUE_BYTES_PER_RAY = 8;
const MAX_SAMPLES = 4096;
const MAX_LAYERS = 128;
const MAX_TIMESTAMP_QUERIES = 8192;
const ADDITIONAL_GPU_BYTES_LIMIT = 128 * 1024 * 1024;
/** The fixed 4096 cap remains a safety refusal; this is only useful work. */
const SCHEDULED_LATTICE_SLOTS = Math.ceil((2 + 0.08) / 0.001) + 2;
const F32_COMPARE_ABS = 3 / 255;
const BEND_FINISH_WGSL = surfaceFinishShadeSource({
  ...SURFACE_FINISH_WGSL,
  lightDir: "BEND_LIGHT",
  ambient: "0.25",
  envStrength: "0.0",
  bgTop: "BEND_SKY",
  bgBottom: "BEND_BOTTOM",
});

const f32 = Math.fround;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normal = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

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

function fixtures(visuals: Record<FixtureId, Visual>): Fixture[] {
  const menger = buildSurfaceDE(mengerSponge());
  // This is the exact MANDELBOX 4D fixture used by transmission-study.ts,
  // including the w lift. Brick is deliberately not substituted.
  const native4 = buildEscapeDE4(
    mandelboxClassic().map((transform) => ({
      ...transform,
      w: { scale: 2, position: 0.12 },
    })),
  );
  const angle = 0.35;
  const w0 = 0.3;
  // The public packer transposes pose rotor into the estimator's inverse rows.
  // Supply R(-angle) so the device query is the CPU fixture's R(+angle).
  const rotor = rotationMatrix4({ xw: -angle });
  const lift4 = (p: Vec3): [number, number, number, number] => [
    Math.cos(angle) * p[0] - Math.sin(angle) * w0,
    p[1],
    p[2],
    Math.sin(angle) * p[0] + Math.cos(angle) * w0,
  ];
  const camera3 = visuals.menger3;
  const camera4 = visuals.native4;
  if (
    Math.abs(camera3.radius - menger.visibleBoundingRadius) > 1e-9 ||
    Math.abs(camera4.radius - native4.boundingRadius) > 1e-9
  )
    throw new Error(
      "shared bend fixture radius disagrees with public GPU estimator",
    );
  return [
    {
      id: "menger3",
      core: "affine",
      ...camera3,
      maps: packSurfaceGpuMaps(menger),
      params: packSurfaceGpuParams(menger, runParams(1, menger.maxDepth)),
      maxDepth: menger.maxDepth,
      cpuDistance: (p) => estimateDistanceRefined(menger, p, 0),
    },
    {
      id: "native4",
      core: "escape4",
      ...camera4,
      maps: packEscape4GpuMaps(native4),
      params: packEscape4GpuParams(
        native4,
        { rotor, w0, sliceHalfW: 0 },
        runParams(1, ESCAPE_TIME_ITERATIONS),
      ),
      maxDepth: ESCAPE_TIME_ITERATIONS,
      cpuDistance: (p) => estimateEscapeDistance4(native4, lift4(p)),
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

function align4(bytes: number) {
  return Math.max(4, Math.ceil(bytes / 4) * 4);
}

/**
 * This must stay allocation-free: the 128 MiB device-buffer refusal is a
 * preflight, not evidence gathered after a large host or GPU allocation.
 */
function bufferPlan(
  fixture: Fixture,
  width: number,
  height: number,
  k: number,
  measure: boolean,
  enforceLimit = true,
) {
  const rays = width * height;
  const maxRounds = Math.ceil((SCHEDULED_LATTICE_SLOTS + 1) / k);
  const measuredPasses = measure ? maxRounds + 1 : 0;
  if (measuredPasses * 2 > MAX_TIMESTAMP_QUERIES)
    throw new Error("timestamp query set exceeds the device limit");
  const timestampResolveBytes = Math.max(16, measuredPasses * 16);
  const stateBytes = rays * STATE_BYTES;
  const outputBytes = rays * OUTPUT_BYTES;
  const readbackTimestampOffset = Math.ceil((stateBytes + outputBytes) / 8) * 8;
  const readbackBytes =
    readbackTimestampOffset + (measure ? timestampResolveBytes : 0);
  const declaredGpuBytes =
    align4(fixture.params.byteLength) +
    align4(fixture.maps.byteLength) +
    stateBytes +
    rays * 4 * 2 +
    8 +
    80 +
    outputBytes +
    16 +
    readbackBytes +
    timestampResolveBytes;
  const withinAdditionalGpuLimit =
    declaredGpuBytes <= ADDITIONAL_GPU_BYTES_LIMIT;
  if (enforceLimit && !withinAdditionalGpuLimit)
    throw new Error(
      `preflight refusal: declared GPU buffers ${declaredGpuBytes} exceed ${ADDITIONAL_GPU_BYTES_LIMIT}`,
    );
  return {
    maxRounds,
    measuredPasses,
    timestampResolveBytes,
    readbackTimestampOffset,
    readbackBytes,
    declaredGpuBytes,
    additionalGpuBytesLimit: ADDITIONAL_GPU_BYTES_LIMIT,
    withinAdditionalGpuLimit,
  };
}

/** Refuse generator drift: only the eval entry/I/O is replaced. */
function bendWgsl(core: Core, k: number): string {
  const source = surfaceDeKernelWgsl({
    mode: "eval",
    core,
    width: 4,
    workgroupSize: WORKGROUP,
    sharedFrontier: false,
    bnbStage2: false,
  });
  const oldIo = `@group(0) @binding(2) var<storage, read> queries: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> results: array<f32>;`;
  const at = source.lastIndexOf("\n@compute @workgroup_size(");
  if (
    at < 0 ||
    source.split(oldIo).length !== 2 ||
    !source.slice(at).includes("fn evalQueries(")
  )
    throw new Error(
      "public eval WGSL template changed; bend harness refuses splice",
    );
  const io = /* wgsl */ `
struct BendState {
  originEntry: vec4f,
  directionDomainEntry: vec4f,
  endPreviousTauVariation: vec4f,
  colorStrength: vec4f,
  delta: vec4f,
  counts: vec4u,
  flags: vec4u,
}
struct BendControl {
  optics: vec4f,
  bend: vec4f,
  center: vec4f,
  limits: vec4u,
  dimensions: vec4u,
}
@group(0) @binding(2) var<storage, read_write> states: array<BendState>;
@group(0) @binding(3) var<storage, read> activeIn: array<u32>;
@group(0) @binding(4) var<storage, read_write> activeOut: array<u32>;
@group(0) @binding(5) var<storage, read_write> queueWords: array<atomic<u32>>;
@group(0) @binding(6) var<uniform> control: BendControl;
@group(0) @binding(7) var<storage, read_write> output: array<u32>;
@group(0) @binding(8) var<storage, read_write> dispatchArgs: array<u32>;
${LAYER_FIELD_WGSL}
const BEND_LIGHT = vec3f(0.58521825, 0.7362423, 0.33980414);
const BEND_SKY = vec3f(0.1, 0.14, 0.2);
const BEND_BOTTOM = vec3f(0.025, 0.035, 0.055);
${BEND_FINISH_WGSL}
const ACTIVE: u32 = 0u;
const COMPLETE: u32 = 1u;
const INVALID: u32 = 2u;
const UNRESOLVED: u32 = 3u;
const APPROACH_STARTED: u32 = 1u;
const APPROACH_OPEN: u32 = 2u;
const BENT: u32 = 4u;
const REVERSAL: u32 = 8u;
const DELTA_SET: u32 = 16u;
fn hasFlag(flags: u32, bit: u32) -> bool { return (flags & bit) != 0u; }
fn saturate(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn finite(x: f32) -> bool { return x == x && abs(x) <= 3.4e38; }
fn slabDelta(rd: vec3f, inputN: vec3f) -> vec4f {
  let normalLength = length(inputN);
  if (!(normalLength > 0.0) || !finite(normalLength)) { return vec4f(0.0); }
  var n = inputN / normalLength;
  if (dot(n, rd) > 0.0) { n = -n; }
  let cosI = clamp(-dot(n, rd), 0.0, 1.0);
  let tangent = rd + cosI * n;
  let tangentLength = length(tangent);
  if (!(tangentLength > 0.0) || !finite(tangentLength)) { return vec4f(0.0); }
  let eta = 1.0 / control.optics.w;
  let cosT = sqrt(max(0.0, 1.0 - eta * eta * (1.0 - cosI * cosI)));
  let coefficient = select(eta / cosT - 1.0 / cosI, -1.0e20, cosI <= 0.0);
  let raw = abs(coefficient) * control.bend.x * tangentLength;
  let magnitude = control.bend.y * tanh(raw / control.bend.y);
  let signed = select(magnitude, -magnitude, coefficient < 0.0);
  return vec4f(tangent * (signed / tangentLength), select(0.0, 1.0, raw > control.bend.y));
}
fn shiftedInterval(origin: vec3f, rd: vec3f) -> vec2f {
  let relative = origin - control.center.xyz;
  let b = dot(relative, rd);
  let disc = b * b - dot(relative, relative) + control.optics.x * control.optics.x;
  if (disc <= 0.0) { return vec2f(0.0); }
  let root = sqrt(disc);
  let end = -b + root;
  if (end <= 0.0) { return vec2f(0.0); }
  return vec2f(max(0.0, -b - root), end);
}
fn opticalNormal(p: vec3f, lane: u32) -> vec3f {
  let h = control.bend.z;
  let dx = surfaceDE(p + vec3f(h, 0.0, 0.0), params.cutoff, lane) - surfaceDE(p - vec3f(h, 0.0, 0.0), params.cutoff, lane);
  let dy = surfaceDE(p + vec3f(0.0, h, 0.0), params.cutoff, lane) - surfaceDE(p - vec3f(0.0, h, 0.0), params.cutoff, lane);
  let dz = surfaceDE(p + vec3f(0.0, 0.0, h), params.cutoff, lane) - surfaceDE(p - vec3f(0.0, 0.0, h), params.cutoff, lane);
  let gradient = vec3f(dx, dy, dz);
  let gradientLength = length(gradient);
  if (!(gradientLength > 0.0) || !finite(gradientLength)) { return vec3f(0.0); }
  return gradient / gradientLength;
}
fn spatialColor(p: vec3f) -> vec3f {
  let t = saturate(p.z / (1.3 * control.optics.x) + 0.5);
  return vec3f(0.95 * (1.0 - t) + 0.12 * t, 0.26 * (1.0 - t) + 0.8 * t, 0.12 * (1.0 - t) + 0.96 * t);
}
fn floorRadiance(origin: vec3f, rd: vec3f) -> vec3f {
  if (rd.y < -1.0e-8) {
    let t = (-1.05 * control.optics.x - origin.y) / rd.y;
    if (t > 0.0) {
      let p = origin + rd * t;
      let cell = floor(p.x / (0.18 * control.optics.x)) + floor(p.z / (0.18 * control.optics.x));
      if (cell - 2.0 * floor(cell * 0.5) != 0.0) { return vec3f(0.7, 0.17, 0.05); }
      return vec3f(0.035, 0.32, 0.7);
    }
  }
  return vec3f(0.025, 0.035, 0.055);
}
fn rowBackdrop(ray: u32) -> vec3f {
  let py = ray / control.dimensions.x;
  let t = (f32(py) + 0.5) / f32(control.dimensions.y);
  return mix(pow(BEND_SKY, vec3f(2.2)), pow(BEND_BOTTOM, vec3f(2.2)), vec3f(t));
}
@compute @workgroup_size(1)
fn prepareStep() {
  let count = atomicLoad(&queueWords[0]);
  dispatchArgs[0] = (count + ${WORKGROUP - 1}u) / ${WORKGROUP}u;
  dispatchArgs[1] = 1u; dispatchArgs[2] = 1u;
}
@compute @workgroup_size(${WORKGROUP})
fn bendStep(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32) {
  if (gid.x >= atomicLoad(&queueWords[0])) { return; }
  let ray = activeIn[gid.x];
  var state = states[ray];
  if (state.counts.w != ACTIVE) { return; }
  var index = state.counts.x;
  var flags = state.flags.x;
  for (var turn = 0u; turn < ${k}u && state.counts.w == ACTIVE; turn++) {
    if (index >= control.limits.y) { state.flags.y = 4u; state.counts.w = UNRESOLVED; break; }
    let t = fma(f32(index), control.optics.y, state.originEntry.w);
    if (!(t < state.endPreviousTauVariation.x)) {
      state.colorStrength.xyz += state.endPreviousTauVariation.z * floorRadiance(state.originEntry.xyz, state.directionDomainEntry.xyz);
      if (state.flags.y == 0u) { state.flags.y = 1u; }
      state.counts.w = COMPLETE;
      break;
    }
    index++;
    if (t < state.directionDomainEntry.w) {
      if (control.limits.x == 1u && hasFlag(flags, APPROACH_OPEN) && hasFlag(flags, APPROACH_STARTED) && state.endPreviousTauVariation.y > 0.0) {
        flags = (flags & ~APPROACH_OPEN) | REVERSAL;
      }
      state.endPreviousTauVariation.y = 0.0;
      continue;
    }
    let p = state.originEntry.xyz + state.directionDomainEntry.xyz * t;
    let d = surfaceDE(p, params.cutoff, lane);
    state.flags.z++;
    if (!finite(d)) { state.flags.y = 6u; state.counts.w = INVALID; break; }
    let signal = clearanceLayerSignal(d, control.optics.x);
    let increment = layerOpticalIncrement(state.endPreviousTauVariation.y, signal);
    if (control.limits.x == 1u && hasFlag(flags, APPROACH_OPEN) && hasFlag(flags, APPROACH_STARTED) && signal < state.endPreviousTauVariation.y) {
      flags = (flags & ~APPROACH_OPEN) | REVERSAL;
    }
    state.endPreviousTauVariation.y = signal;
    if (increment == 0.0) { continue; }
    flags = flags | APPROACH_STARTED;
    state.endPreviousTauVariation.w += increment;
    var n = opticalNormal(p, lane);
    state.flags.w += 6u;
    if (!(finite(n.x) && finite(n.y) && finite(n.z))) { state.flags.y = 6u; state.counts.w = INVALID; break; }
    if (dot(n, state.directionDomainEntry.xyz) > 0.0) { n = -n; }
    let fresnel = 0.04 + 0.96 * pow(1.0 - saturate(-dot(n, state.directionDomainEntry.xyz)), 5.0);
    let eventTau = pow(control.optics.z * (1.0 - fresnel), increment);
    if (eventTau > 0.0 && control.limits.x != 0u && !hasFlag(flags, BENT)) {
      if (!hasFlag(flags, DELTA_SET)) { state.delta = slabDelta(state.directionDomainEntry.xyz, n); flags = flags | DELTA_SET; }
      let old = state.colorStrength.w;
      if (control.limits.x == 2u) { state.colorStrength.w = 1.0; }
      else if (hasFlag(flags, APPROACH_OPEN)) { state.colorStrength.w = min(1.0, state.colorStrength.w + increment); }
      let applied = state.colorStrength.w - old;
      state.originEntry.xyz += applied * state.delta.xyz;
      if (control.limits.x == 2u || state.colorStrength.w >= 1.0) { flags = (flags | BENT) & ~APPROACH_OPEN; }
      let interval = shiftedInterval(state.originEntry.xyz, state.directionDomainEntry.xyz);
      state.directionDomainEntry.w = interval.x;
      state.endPreviousTauVariation.x = interval.y;
    }
    let terminal = select(floorRadiance(state.originEntry.xyz, state.directionDomainEntry.xyz), rowBackdrop(ray), eventTau == 0.0);
    let encoded = finishShade(spatialColor(p), n, state.directionDomainEntry.xyz, 1.0, 1.0, pow(max(terminal, vec3f(0.0)), vec3f(1.0 / 2.2)), vec4f(1.0, 128.0, 0.0, 0.5), vec4f(0.0, 1.0, 0.0, 0.0));
    let local = pow(max(encoded, vec3f(0.0)), vec3f(2.2));
    state.colorStrength.xyz += state.endPreviousTauVariation.z * (1.0 - eventTau) * local;
    state.endPreviousTauVariation.z *= eventTau;
    state.counts.z++;
    if (eventTau == 0.0) { state.flags.y = 2u; state.counts.w = COMPLETE; break; }
    if (state.counts.z >= control.limits.z) { state.flags.y = 5u; state.counts.w = UNRESOLVED; break; }
  }
  state.counts.x = index;
  state.flags.x = flags;
  states[ray] = state;
  if (state.counts.w == ACTIVE) { let out = atomicAdd(&queueWords[1], 1u); activeOut[out] = ray; }
}
@compute @workgroup_size(1)
fn finalizeStep() { atomicStore(&queueWords[0], atomicLoad(&queueWords[1])); atomicStore(&queueWords[1], 0u); }
@compute @workgroup_size(${WORKGROUP})
fn markSchedulerCap(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= control.limits.w) { return; }
  var state = states[gid.x];
  if (state.counts.w == ACTIVE) {
    state.flags.y = 7u;
    state.counts.w = UNRESOLVED;
    states[gid.x] = state;
  }
}
@compute @workgroup_size(${WORKGROUP})
fn encodeImage(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= control.limits.w) { return; }
  let c = pow(max(states[gid.x].colorStrength.xyz, vec3f(0.0)), vec3f(1.0 / 2.2));
  let r = u32(round(255.0 * saturate(c.x)));
  let g = u32(round(255.0 * saturate(c.y)));
  let b = u32(round(255.0 * saturate(c.z)));
  output[gid.x] = r | (g << 8u) | (b << 16u) | 0xff000000u;
}`;
  return source.slice(0, at).replace(oldIo, io);
}

function cameraState(
  fixture: Fixture,
  width: number,
  height: number,
  k: number,
) {
  const fwd = normal(sub(fixture.target, fixture.eye));
  const right = normal(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const data = new ArrayBuffer(width * height * STATE_BYTES);
  const floats = new Float32Array(data);
  const uints = new Uint32Array(data);
  const active = new Uint32Array(width * height);
  const delta = f32(fixture.radius * 0.001);
  const maxRounds = Math.ceil((SCHEDULED_LATTICE_SLOTS + 1) / k);
  for (let py = 0; py < height; py++)
    for (let px = 0; px < width; px++) {
      const ray = py * width + px;
      const u = ((px + 0.5) / width) * 2 - 1;
      const v = 1 - ((py + 0.5) / height) * 2;
      const rd = normal([
        fwd[0] + fixture.zoom * (u * right[0] + v * up[0]),
        fwd[1] + fixture.zoom * (u * right[1] + v * up[1]),
        fwd[2] + fixture.zoom * (u * right[2] + v * up[2]),
      ]);
      const origin = fixture.eye;
      const relative = sub(origin, fixture.center);
      const b = dot(relative, rd);
      const disc =
        b * b - dot(relative, relative) + fixture.radius * fixture.radius;
      let entry = 0;
      let end = 0;
      if (disc > 0) {
        const root = Math.sqrt(disc);
        const candidateEnd = -b + root;
        if (candidateEnd > 0) {
          entry = Math.max(0, -b - root);
          end = candidateEnd;
        }
      }
      const base = ray * (STATE_BYTES / 4);
      floats.set(
        [
          f32(origin[0]),
          f32(origin[1]),
          f32(origin[2]),
          f32(entry),
          f32(rd[0]),
          f32(rd[1]),
          f32(rd[2]),
          f32(entry),
          f32(end),
          0,
          1,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
        ],
        base,
      );
      uints[base + 20] = 0;
      uints[base + 21] = 0;
      uints[base + 22] = 0;
      uints[base + 23] = 0;
      uints[base + 24] = 2; // approach open
      uints[base + 25] = end > 0 ? 0 : 3; // noIntersection retained at terminal
      active[ray] = ray;
    }
  return { data, active, delta, maxRounds };
}

function base64(bytes: Uint8Array) {
  let text = "";
  for (let start = 0; start < bytes.length; start += 0x8000)
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
}
function sameDiagnostic(
  left: Awaited<ReturnType<typeof renderOne>>,
  right: Awaited<ReturnType<typeof renderOne>>,
) {
  if (!left.arrays || !right.arrays)
    throw new Error("K invariance requires retained diagnostic arrays");
  const leftArrays = left.arrays;
  const rightArrays = right.arrays;
  const fields = [
    "eventCounts",
    "samples",
    "status",
    "reason",
    "tau",
    "variation",
    "strength",
  ] as const;
  return Object.fromEntries(
    fields.map((field) => [
      field,
      leftArrays[field].length === rightArrays[field].length &&
        leftArrays[field].every(
          (value, index) => value === rightArrays[field][index],
        ),
    ]),
  );
}

async function renderOne(
  device: GPUDevice,
  fixture: Fixture,
  mode: Mode,
  width: number,
  height: number,
  k: number,
  reference: Reference,
  measure = k !== 1,
  retainArrays = true,
) {
  const started = performance.now();
  const plan = bufferPlan(fixture, width, height, k, measure);
  const initial = cameraState(fixture, width, height, k);
  if (initial.maxRounds !== plan.maxRounds)
    throw new Error("scheduler plan diverged from initialized ray state");
  const module = device.createShaderModule({ code: bendWgsl(fixture.core, k) });
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
      {
        binding: 7,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ],
  });
  const prepareBindLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 5,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 8,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [layout],
  });
  const prepareLayout = device.createPipelineLayout({
    bindGroupLayouts: [prepareBindLayout],
  });
  const prepare = await device.createComputePipelineAsync({
    layout: prepareLayout,
    compute: { module, entryPoint: "prepareStep" },
  });
  const step = await device.createComputePipelineAsync({
    layout: pipelineLayout,
    compute: { module, entryPoint: "bendStep" },
  });
  const finalize = await device.createComputePipelineAsync({
    layout: pipelineLayout,
    compute: { module, entryPoint: "finalizeStep" },
  });
  const encode = await device.createComputePipelineAsync({
    layout: pipelineLayout,
    compute: { module, entryPoint: "encodeImage" },
  });
  const schedulerCap = await device.createComputePipelineAsync({
    layout: pipelineLayout,
    compute: { module, entryPoint: "markSchedulerCap" },
  });
  const params = gpuBuffer(
    device,
    fixture.params.byteLength,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  const maps = gpuBuffer(
    device,
    fixture.maps.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const states = gpuBuffer(
    device,
    initial.data.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  );
  const activeA = gpuBuffer(
    device,
    initial.active.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const activeB = gpuBuffer(
    device,
    initial.active.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const queue = gpuBuffer(
    device,
    8,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const control = gpuBuffer(
    device,
    80,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  const output = gpuBuffer(
    device,
    width * height * OUTPUT_BYTES,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  );
  const indirect = gpuBuffer(
    device,
    16,
    GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
  );
  // K=1 is a correctness-only parity run: timestamps are omitted to stay
  // below WebGPU's guaranteed 8192-query limit.
  const measuredPasses = plan.measuredPasses;
  const timestamps = device.createQuerySet({
    type: "timestamp",
    count: Math.max(2, measuredPasses * 2),
  });
  const timestampResolve = gpuBuffer(
    device,
    plan.timestampResolveBytes,
    GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  );
  const readbackTimestampOffset = plan.readbackTimestampOffset;
  const readback = gpuBuffer(
    device,
    plan.readbackBytes,
    GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  );
  const declaredGpuBytes = plan.declaredGpuBytes;
  if (
    declaredGpuBytes !==
    params.size +
      maps.size +
      states.size +
      activeA.size +
      activeB.size +
      queue.size +
      control.size +
      output.size +
      indirect.size +
      readback.size +
      timestampResolve.size
  )
    throw new Error("GPU buffer plan diverged from allocated buffer sizes");
  device.queue.writeBuffer(params, 0, fixture.params);
  device.queue.writeBuffer(
    maps,
    0,
    fixture.maps.buffer,
    fixture.maps.byteOffset,
    fixture.maps.byteLength,
  );
  device.queue.writeBuffer(states, 0, initial.data);
  device.queue.writeBuffer(activeA, 0, initial.active);
  device.queue.writeBuffer(queue, 0, new Uint32Array([width * height, 0]));
  const onset = mode === "none" ? 0 : 1;
  device.queue.writeBuffer(
    control,
    0,
    new Float32Array([
      fixture.radius,
      initial.delta,
      reference.transmit,
      reference.ior,
      reference.slabFraction * fixture.radius,
      reference.maxOffsetFraction * fixture.radius,
      reference.opticalNormalFraction * fixture.radius,
      0,
      fixture.center[0],
      fixture.center[1],
      fixture.center[2],
      0,
    ]),
  );
  device.queue.writeBuffer(
    control,
    48,
    new Uint32Array([onset, MAX_SAMPLES, MAX_LAYERS, width * height]),
  );
  device.queue.writeBuffer(control, 64, new Uint32Array([width, height, 0, 0]));
  const bind = (input: GPUBuffer, outputQueue: GPUBuffer) =>
    device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: maps } },
        { binding: 2, resource: { buffer: states } },
        { binding: 3, resource: { buffer: input } },
        { binding: 4, resource: { buffer: outputQueue } },
        { binding: 5, resource: { buffer: queue } },
        { binding: 6, resource: { buffer: control } },
        { binding: 7, resource: { buffer: output } },
      ],
    });
  const binds = [bind(activeA, activeB), bind(activeB, activeA)];
  const prepareBind = device.createBindGroup({
    layout: prepareBindLayout,
    entries: [
      { binding: 5, resource: { buffer: queue } },
      { binding: 8, resource: { buffer: indirect } },
    ],
  });
  const timings: number[] = [];
  for (let round = 0; round < initial.maxRounds; round++) {
    const encoder = device.createCommandEncoder();
    const p = encoder.beginComputePass();
    p.setPipeline(prepare);
    p.setBindGroup(0, prepareBind);
    p.dispatchWorkgroups(1);
    p.end();
    const w = encoder.beginComputePass(
      measure
        ? {
            timestampWrites: {
              querySet: timestamps,
              beginningOfPassWriteIndex: round * 2,
              endOfPassWriteIndex: round * 2 + 1,
            },
          }
        : undefined,
    );
    w.setPipeline(step);
    w.setBindGroup(0, binds[round % 2]);
    w.dispatchWorkgroupsIndirect(indirect, 0);
    w.end();
    const f = encoder.beginComputePass();
    f.setPipeline(finalize);
    f.setBindGroup(0, binds[round % 2]);
    f.dispatchWorkgroups(1);
    f.end();
    device.queue.submit([encoder.finish()]);
  }
  const terminal = device.createCommandEncoder();
  const cap = terminal.beginComputePass();
  cap.setPipeline(schedulerCap);
  cap.setBindGroup(0, binds[0]);
  cap.dispatchWorkgroups(Math.ceil((width * height) / WORKGROUP));
  cap.end();
  const image = terminal.beginComputePass(
    measure
      ? {
          timestampWrites: {
            querySet: timestamps,
            beginningOfPassWriteIndex: initial.maxRounds * 2,
            endOfPassWriteIndex: initial.maxRounds * 2 + 1,
          },
        }
      : undefined,
  );
  image.setPipeline(encode);
  image.setBindGroup(0, binds[0]);
  image.dispatchWorkgroups(Math.ceil((width * height) / WORKGROUP));
  image.end();
  if (measure)
    terminal.resolveQuerySet(
      timestamps,
      0,
      measuredPasses * 2,
      timestampResolve,
      0,
    );
  terminal.copyBufferToBuffer(states, 0, readback, 0, states.size);
  terminal.copyBufferToBuffer(output, 0, readback, states.size, output.size);
  if (measure)
    terminal.copyBufferToBuffer(
      timestampResolve,
      0,
      readback,
      readbackTimestampOffset,
      timestampResolve.size,
    );
  device.queue.submit([terminal.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const bytes = readback.getMappedRange().slice(0);
  readback.unmap();
  const stateUints = new Uint32Array(
    bytes,
    0,
    width * height * (STATE_BYTES / 4),
  );
  const stateFloats = new Float32Array(
    bytes,
    0,
    width * height * (STATE_BYTES / 4),
  );
  const packed = new Uint32Array(bytes, states.size, width * height);
  const pairs = measure
    ? new BigUint64Array(bytes, readbackTimestampOffset, measuredPasses * 2)
    : null;
  if (pairs)
    for (let i = 0; i < measuredPasses; i++)
      timings.push(Number(pairs[i * 2 + 1] - pairs[i * 2]) / 1e6);
  const rgba = new Uint8Array(width * height * 4);
  let complete = 0,
    invalid = 0,
    unresolved = 0;
  const reasons: Record<string, number> = {
    domainComplete: 0,
    opaque: 0,
    noIntersection: 0,
    sampleCap: 0,
    layerCap: 0,
    schedulerCap: 0,
    invalid: 0,
    unresolved: 0,
  };
  const eventCounts = new Uint32Array(width * height);
  const samples = new Uint32Array(width * height);
  const statuses = new Uint8Array(width * height);
  const reasonCodes = new Uint8Array(width * height);
  const variation = new Float32Array(width * height);
  const tau = new Float32Array(width * height);
  const strength = new Float32Array(width * height);
  let primaryFieldQueries = 0;
  let opticalNormalQueries = 0;
  for (let ray = 0; ray < width * height; ray++) {
    const base = ray * (STATE_BYTES / 4);
    const status = stateUints[base + 23];
    const reason = stateUints[base + 25];
    if (status === 1) {
      complete++;
      if (reason === 2) reasons.opaque++;
      else if (reason === 3) reasons.noIntersection++;
      else reasons.domainComplete++;
    } else if (status === 2) {
      invalid++;
      reasons.invalid++;
    } else {
      unresolved++;
      if (reason === 4) reasons.sampleCap++;
      else if (reason === 5) reasons.layerCap++;
      else if (reason === 7) reasons.schedulerCap++;
      else reasons.unresolved++;
    }
    eventCounts[ray] = stateUints[base + 22];
    samples[ray] = stateUints[base + 20];
    statuses[ray] = status;
    reasonCodes[ray] = reason;
    primaryFieldQueries += stateUints[base + 26];
    opticalNormalQueries += stateUints[base + 27];
    variation[ray] = stateFloats[base + 11];
    tau[ray] = stateFloats[base + 10];
    strength[ray] = stateFloats[base + 15];
    const word = packed[ray];
    rgba[ray * 4] = word & 255;
    rgba[ray * 4 + 1] = (word >>> 8) & 255;
    rgba[ray * 4 + 2] = (word >>> 16) & 255;
    rgba[ray * 4 + 3] = 255;
  }
  [
    params,
    maps,
    states,
    activeA,
    activeB,
    queue,
    control,
    output,
    indirect,
    readback,
    timestampResolve,
  ].forEach((buffer) => buffer.destroy());
  timestamps.destroy();
  const trace = new Uint8Array(width * height * 8);
  const traceView = new DataView(trace.buffer);
  for (let ray = 0; ray < width * height; ray++) {
    const offset = ray * 8;
    traceView.setUint32(offset, samples[ray], true);
    traceView.setUint16(offset + 4, eventCounts[ray], true);
    trace[offset + 6] = statuses[ray];
    trace[offset + 7] = reasonCodes[ray];
  }
  return {
    imageBase64: base64(rgba),
    traceBase64: base64(trace),
    arrays: retainArrays
      ? {
          eventCounts: [...eventCounts],
          samples: [...samples],
          status: [...statuses],
          reason: [...reasonCodes],
          variation: [...variation],
          tau: [...tau],
          strength: [...strength],
        }
      : undefined,
    report: {
      fixture: fixture.id,
      mode,
      width,
      height,
      k,
      estimatorDepth: fixture.maxDepth,
      completion: {
        complete,
        invalid,
        unresolved,
        total: width * height,
        reasons,
      },
      timing: {
        pageRenderWallMs: performance.now() - started,
        pageRenderWallScope:
          "one page-side render: includes state initialization, shader/pipeline creation, dispatches, map/readback, typed extraction and base64 encoding; excludes launcher/browser startup, CPU oracle, PNG/trace writes and any multi-row wall time",
        gpuPasses: timings.length,
        bendStepAndEncodeGpuMs: timings.reduce((a, b) => a + b, 0),
        gpuMaxPassMs: Math.max(0, ...timings),
        deviceTimingScope: measure
          ? "timestamps cover bendStep and encode passes only; prepare/finalize dispatches and map/readback are included in pageRenderWallMs, not device timestamps"
          : "correctness-only K parity run; timestamps intentionally omitted to remain below the device query-set limit",
      },
      work: { primaryFieldQueries, opticalNormalQueries },
      buffers: {
        stateBytesPerRay: STATE_BYTES,
        queueBytesPerRay: QUEUE_BYTES_PER_RAY,
        outputBytesPerRay: OUTPUT_BYTES,
        declaredGpuBytes,
        hostInitialTypedBytes:
          initial.data.byteLength + initial.active.byteLength,
        hostReadbackTypedBytes: bytes.byteLength,
        hostExtractionTypedBytes:
          rgba.byteLength +
          trace.byteLength +
          eventCounts.byteLength +
          samples.byteLength +
          statuses.byteLength +
          reasonCodes.byteLength +
          variation.byteLength +
          tau.byteLength +
          strength.byteLength,
        hostAccountingScope:
          "typed-array allocations directly made by this render. Base64 strings, structured-clone/JSON copies, JavaScript object/array overhead, browser/driver memory and retained CPU-oracle data are unmeasured; this row cannot certify total additional state <=128 MiB.",
      },
      coordinates:
        "f32 camera/ray/interval/sample arithmetic; CPU renderPreview uses JS numbers, so this is a recorded comparison rather than bit identity",
      sampleDelta: initial.delta,
      limitation:
        "This whole-raster state/readback experiment is measured only at the requested size. At 1920x1080, state plus same-size readback alone is about 450.9 MiB and declared GPU buffers about 474.6 MiB, so preflight refuses before allocation and this does not certify the 128 MiB additional-state target or any export extrapolation.",
    },
  };
}

export async function runTransmissionBendGpu(input: Options = {}) {
  const options = {
    width: input.width ?? 512,
    height: input.height ?? 512,
    k: input.k ?? 8,
    fixture: input.fixture ?? "",
    mode: input.mode ?? "",
    cpuCompareSize: input.cpuCompareSize ?? 32,
    visuals: input.visuals,
    reference: input.reference,
  };
  if (![1, 2, 4, 8].includes(options.k))
    throw new Error("k must be one of 1, 2, 4 or 8");
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
  void device.lost.then((info) => {
    lost = `${info.reason}: ${info.message}`;
  });
  if (!options.visuals || !options.reference)
    return {
      inconclusive:
        "launcher did not supply shared visual/optical fixture data",
    };
  const selectedFixtures = fixtures(options.visuals).filter(
    (fixture) => !options.fixture || fixture.id === options.fixture,
  );
  const modes = (["none", "weighted"] as Mode[]).filter(
    (mode) => !options.mode || mode === options.mode,
  );
  if (!selectedFixtures.length || !modes.length)
    return { inconclusive: "unknown fixture or mode" };
  const preflight = selectedFixtures.map((fixture) => ({
    fixture: fixture.id,
    ...bufferPlan(
      fixture,
      options.width,
      options.height,
      options.k,
      options.k !== 1,
      false,
    ),
  }));
  if (preflight.some((plan) => !plan.withinAdditionalGpuLimit))
    return {
      refused: {
        reason:
          "declared whole-image GPU buffers exceed the additional-state limit before allocation",
        preflight,
      },
    };
  const rows = [];
  for (const fixture of selectedFixtures)
    for (const mode of modes) {
      const diagnostic = await renderOne(
        device,
        fixture,
        mode,
        options.cpuCompareSize,
        options.cpuCompareSize,
        options.k,
        options.reference,
      );
      const alternateK = options.k === 1 ? 8 : 1;
      const alternate = await renderOne(
        device,
        fixture,
        mode,
        options.cpuCompareSize,
        options.cpuCompareSize,
        alternateK,
        options.reference,
      );
      const actual = await renderOne(
        device,
        fixture,
        mode,
        options.width,
        options.height,
        options.k,
        options.reference,
        options.k !== 1,
        false,
      );
      rows.push({
        ...actual.report,
        cpuDiagnostic: {
          report: diagnostic.report,
          arrays: diagnostic.arrays,
          imageBase64: diagnostic.imageBase64,
          f32ComparisonProposal: F32_COMPARE_ABS,
          kInvariant: {
            compared: [options.k, alternateK],
            complete:
              diagnostic.report.completion.unresolved === 0 &&
              alternate.report.completion.unresolved === 0,
            samePerRay: sameDiagnostic(diagnostic, alternate),
            sameImage: diagnostic.imageBase64 === alternate.imageBase64,
            sameWork:
              diagnostic.report.work.primaryFieldQueries ===
                alternate.report.work.primaryFieldQueries &&
              diagnostic.report.work.opticalNormalQueries ===
                alternate.report.work.opticalNormalQueries,
          },
        },
        imageBase64: actual.imageBase64,
        traceBase64: actual.traceBase64,
      });
    }
  await device.queue.onSubmittedWorkDone();
  if (String(lost ?? "").length)
    throw new Error("GPU device lost: " + String(lost));
  if (uncaptured.length)
    throw new Error(`uncaptured GPU error: ${uncaptured.join(" | ")}`);
  return {
    browserAdapter: {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
      isFallbackAdapter: Boolean(info.isFallbackAdapter),
    },
    options,
    rows,
  };
}

(
  globalThis as typeof globalThis & { TransmissionBendGpu?: unknown }
).TransmissionBendGpu = { runTransmissionBendGpu };
