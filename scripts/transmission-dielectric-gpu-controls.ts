/**
 * Small WebGPU controls for the finite-cell dielectric experiment.
 *
 * The caller supplies the complete shader emitted by the image page.  This
 * module appends one control entry point and calls the page's own WGSL DDA,
 * Fresnel, refraction and Beer functions.  It deliberately does not launch a
 * device itself; the page owner supplies the already-authorized GPUDevice.
 */
import {
  DIELECTRIC_GEOMETRY_CONTROL_RAYS,
  DIELECTRIC_SOLID_FIXTURES,
  DIELECTRIC_TRANSPORT_CONTROL_INPUTS,
  dielectricBeerThroughput,
  dielectricNextBoundary,
  dielectricNextBoundaryFromAnchor,
  dielectricRefract,
  DIELECTRIC_SOLID_PACKED_BYTES,
  packDielectricSolidFixture,
  type DielectricBoundary,
  type DielectricBoundaryResult,
  type DielectricSolidFixture,
} from "./transmission-dielectric-solid";
import type { Vec3 } from "./de-preview";

const CONTROL_BUFFER_BYTES = 144;
const RESULT_BUFFER_BYTES = 96;
// The inactive page group-0 binding still has to satisfy the page-emitted
// OutputPixel storage layout during pipeline validation.
const KIND_BOUNDARY = 1;
const KIND_MISS = 2;
const KIND_REFUSED = 3;
const OP_BOUNDARY = 1;
const OP_ANCHORED_BOUNDARY = 2;
const OP_REFRACTION = 3;
const OP_FRESNEL = 4;
const OP_BEER = 5;
const TOLERANCE = 3e-4;

type ControlInput = {
  name: string;
  fixture?: DielectricSolidFixture;
  operation: number;
  origin?: Vec3;
  direction?: Vec3;
  inside?: boolean;
  outwardNormal?: Vec3;
  fromIor?: number;
  toIor?: number;
  distance?: number;
  params?: [number, number, number, number];
  anchor?: DielectricBoundary["anchor"];
  anchorFrom?: ControlInput;
  expected: ExpectedControl;
};

type ExpectedControl =
  | { kind: "boundary"; result: DielectricBoundaryResult }
  | { kind: "refract"; direction: Vec3; tir: boolean }
  | { kind: "fresnel"; value: number }
  | { kind: "beer"; value: Vec3 };

type RawControlResult = {
  scalar: [number, number, number, number];
  normal: [number, number, number, number];
  kind: number;
  reason: number;
  axis: number;
  planeMask: number;
  planeIndices: [number, number, number, number];
  intrinsicPoint: [number, number, number, number];
  cellIndices: [number, number, number, number];
};

export interface DielectricGpuControlCase {
  name: string;
  passed: boolean;
  operation: string;
  expected: unknown;
  actual: unknown;
  tolerance: number;
  failure?: string;
}

export interface DielectricGpuControlReport {
  passed: boolean;
  cases: DielectricGpuControlCase[];
  failures: string[];
  count: number;
  tolerance: number;
  source: "page-emitted-wgsl";
}

const CONTROL_WGSL = /* wgsl */ `
struct DielectricControlInput {
  operation: u32,
  inside: u32,
  fromIor: f32,
  toIor: f32,
  origin: vec4f,
  direction: vec4f,
  outwardNormal: vec4f,
  params: vec4f,
  anchorPoint: vec4f,
  anchorPlaneIndices: vec4<i32>,
  anchorCellIndices: vec4<i32>,
  planeMask: u32,
};

struct DielectricControlResult {
  scalar: vec4f,
  normal: vec4f,
  kind: u32,
  reason: u32,
  axis: u32,
  planeMask: u32,
  planeIndices: vec4<i32>,
  intrinsicPoint: vec4f,
  cellIndices: vec4<i32>,
};

const DIELECTRIC_CONTROL_INVALID_INPUT: u32 = 6u;

@group(1) @binding(0) var<uniform> controlSolid: DielectricSolidFixture;
@group(1) @binding(1) var<uniform> controlInput: DielectricControlInput;
@group(1) @binding(2) var<storage, read_write> controlOutput: DielectricControlResult;

@compute @workgroup_size(1)
fn runDielectricControl() {
  var result = DielectricControlResult(
    vec4f(0.0), vec4f(0.0), 0u, 0u, 0u, 0u, vec4<i32>(-1), vec4f(0.0), vec4<i32>(-1),
  );
  if (controlInput.operation == ${OP_BOUNDARY}u) {
    let boundary = dielectricNextBoundary(
      controlSolid, controlInput.origin.xyz, controlInput.direction.xyz,
      controlInput.inside, 0.0, -1, -1, 0u,
    );
    result.scalar = vec4f(boundary.t, f32(boundary.entering), f32(boundary.visits), 0.0);
    result.normal = vec4f(boundary.outwardNormal, 0.0);
    result.kind = boundary.kind;
    result.reason = boundary.reason;
    result.axis = boundary.axis;
    result.planeMask = boundary.planeMask;
    result.planeIndices = boundary.planeIndices;
    result.intrinsicPoint = boundary.intrinsicPoint;
    result.cellIndices = boundary.cellIndices;
  } else if (controlInput.operation == ${OP_ANCHORED_BOUNDARY}u) {
    let boundary = dielectricNextBoundaryFromAnchor(
      controlSolid, controlInput.direction.xyz, controlInput.inside,
      controlInput.anchorPoint, controlInput.planeMask,
      controlInput.anchorPlaneIndices, controlInput.anchorCellIndices,
    );
    result.scalar = vec4f(boundary.t, f32(boundary.entering), f32(boundary.visits), 0.0);
    result.normal = vec4f(boundary.outwardNormal, 0.0);
    result.kind = boundary.kind;
    result.reason = boundary.reason;
    result.axis = boundary.axis;
    result.planeMask = boundary.planeMask;
    result.planeIndices = boundary.planeIndices;
    result.intrinsicPoint = boundary.intrinsicPoint;
    result.cellIndices = boundary.cellIndices;
  } else if (controlInput.operation == ${OP_REFRACTION}u) {
    let refracted = refractOrReflect(
      controlInput.direction.xyz, controlInput.outwardNormal.xyz,
      controlInput.fromIor, controlInput.toIor,
    );
    result.normal = refracted;
    result.scalar.x = refracted.w;
  } else if (controlInput.operation == ${OP_FRESNEL}u) {
    result.scalar.x = fresnel(
      controlInput.params.x, controlInput.fromIor, controlInput.toIor,
    );
  } else if (controlInput.operation == ${OP_BEER}u) {
    result.normal = vec4f(beer(controlInput.params.x), 0.0);
  } else {
    result.kind = DIELECTRIC_RESULT_REFUSED;
    result.reason = DIELECTRIC_CONTROL_INVALID_INPUT;
  }
  controlOutput = result;
}
`;

function fixtureFor(name: string): DielectricSolidFixture {
  const fixture =
    DIELECTRIC_SOLID_FIXTURES[name as keyof typeof DIELECTRIC_SOLID_FIXTURES];
  if (!fixture) throw new Error(`unknown dielectric control fixture: ${name}`);
  return fixture;
}

function close(a: number, b: number) {
  return Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
}

function closeVec(actual: readonly number[], expected: readonly number[]) {
  return (
    actual.length === expected.length &&
    actual.every((value, axis) => close(value, expected[axis]))
  );
}

function fresnelExpected(cosI: number, fromIor: number, toIor: number) {
  const eta = fromIor / toIor;
  const sinT2 = eta * eta * Math.max(0, 1 - cosI * cosI);
  if (sinT2 >= 1) return 1;
  const cosT = Math.sqrt(Math.max(0, 1 - sinT2));
  const rs = (fromIor * cosI - toIor * cosT) / (fromIor * cosI + toIor * cosT);
  const rp = (fromIor * cosT - toIor * cosI) / (fromIor * cosT + toIor * cosI);
  return 0.5 * (rs * rs + rp * rp);
}

function boundarySummary(result: DielectricBoundaryResult) {
  if (result.kind !== "boundary")
    return { kind: result.kind, visits: result.visits };
  return {
    kind: result.kind,
    t: result.t,
    entering: result.entering,
    normal: result.outwardNormal,
    axis: result.intrinsicAxis,
    planeMask: result.anchor.planeMask,
    planeIndices: result.anchor.planeIndices,
    cellIndices: result.anchor.cellIndices,
    visits: result.visits,
  };
}

function makeCases(): ControlInput[] {
  const d0 = fixtureFor("mengerD0");
  const normalOrigin: Vec3 = [0.17, 0.11, 2];
  const normalDirection: Vec3 = [0, 0, -1];
  const normalEntry = dielectricNextBoundary(
    d0,
    normalOrigin,
    normalDirection,
    { inside: false },
  );
  const oblique = DIELECTRIC_GEOMETRY_CONTROL_RAYS.find(
    (ray) => ray.name === "box-oblique-3d",
  );
  if (!oblique) throw new Error("missing oblique geometry control");
  const obliqueFixture = fixtureFor(oblique.fixture);
  const obliqueEntry = dielectricNextBoundary(
    obliqueFixture,
    oblique.origin,
    oblique.direction,
    { inside: false },
  );
  const cases: ControlInput[] = [
    {
      name: "D0 normal entry",
      fixture: d0,
      operation: OP_BOUNDARY,
      origin: normalOrigin,
      direction: normalDirection,
      inside: false,
      expected: { kind: "boundary", result: normalEntry },
    },
    {
      name: "D0 oblique entry",
      fixture: obliqueFixture,
      operation: OP_BOUNDARY,
      origin: oblique.origin,
      direction: oblique.direction,
      inside: false,
      expected: { kind: "boundary", result: obliqueEntry },
    },
    {
      name: "D0 normal exit",
      fixture: d0,
      operation: OP_ANCHORED_BOUNDARY,
      direction: normalDirection,
      inside: true,
      anchor: normalEntry.kind === "boundary" ? normalEntry.anchor : undefined,
      expected: {
        kind: "boundary",
        result:
          normalEntry.kind === "boundary"
            ? dielectricNextBoundaryFromAnchor(d0, normalDirection, {
                inside: true,
                anchor: normalEntry.anchor,
              })
            : normalEntry,
      },
    },
    {
      name: "D0 oblique exit",
      fixture: obliqueFixture,
      operation: OP_ANCHORED_BOUNDARY,
      direction: oblique.direction,
      inside: true,
      anchor:
        obliqueEntry.kind === "boundary" ? obliqueEntry.anchor : undefined,
      expected: {
        kind: "boundary",
        result:
          obliqueEntry.kind === "boundary"
            ? dielectricNextBoundaryFromAnchor(
                obliqueFixture,
                oblique.direction,
                {
                  inside: true,
                  anchor: obliqueEntry.anchor,
                },
              )
            : obliqueEntry,
      },
    },
  ];
  for (const ray of DIELECTRIC_GEOMETRY_CONTROL_RAYS.filter(
    (candidate) => candidate.name === "menger-crossings-3d",
  )) {
    const fixture = fixtureFor(ray.fixture);
    cases.push({
      name: ray.name,
      fixture,
      operation: OP_BOUNDARY,
      origin: ray.origin,
      direction: ray.direction,
      inside: false,
      expected: {
        kind: "boundary",
        result: dielectricNextBoundary(fixture, ray.origin, ray.direction, {
          inside: false,
        }),
      },
    });
  }
  const hyperFixture = fixtureFor("hyperMengerD2");
  const hyperOrigin: Vec3 = [-0.6, 0.3, 2];
  const hyperDirection: Vec3 = [0, 0, -1];
  const hyperEntry = dielectricNextBoundary(
    hyperFixture,
    hyperOrigin,
    hyperDirection,
    { inside: false },
  );
  const hyperEntryInput: ControlInput = {
    name: "hyper-Menger D2 robust entry",
    fixture: hyperFixture,
    operation: OP_BOUNDARY,
    origin: hyperOrigin,
    direction: hyperDirection,
    inside: false,
    expected: { kind: "boundary", result: hyperEntry },
  };
  cases.push(hyperEntryInput, {
    name: "hyper-Menger D2 anchored exit",
    fixture: hyperFixture,
    operation: OP_ANCHORED_BOUNDARY,
    direction: hyperDirection,
    inside: true,
    anchor: hyperEntry.kind === "boundary" ? hyperEntry.anchor : undefined,
    anchorFrom: hyperEntryInput,
    expected: {
      kind: "boundary",
      result:
        hyperEntry.kind === "boundary"
          ? dielectricNextBoundaryFromAnchor(hyperFixture, hyperDirection, {
              inside: true,
              anchor: hyperEntry.anchor,
            })
          : hyperEntry,
    },
  });
  const normalEntryInput = cases.find(
    (entry) => entry.name === "D0 normal entry",
  );
  const obliqueEntryInput = cases.find(
    (entry) => entry.name === "D0 oblique entry",
  );
  const normalExitInput = cases.find(
    (entry) => entry.name === "D0 normal exit",
  );
  const obliqueExitInput = cases.find(
    (entry) => entry.name === "D0 oblique exit",
  );
  if (
    !normalEntryInput ||
    !obliqueEntryInput ||
    !normalExitInput ||
    !obliqueExitInput
  )
    throw new Error("missing D0 sequential anchor controls");
  normalExitInput.anchorFrom = normalEntryInput;
  obliqueExitInput.anchorFrom = obliqueEntryInput;
  const identity = DIELECTRIC_TRANSPORT_CONTROL_INPUTS.iorIdentity;
  const tir = DIELECTRIC_TRANSPORT_CONTROL_INPUTS.glassToAirTir50Degrees;
  const beer = DIELECTRIC_TRANSPORT_CONTROL_INPUTS.beer;
  cases.push(
    {
      name: "IOR 1 identity",
      operation: OP_REFRACTION,
      direction: identity.incident,
      outwardNormal: identity.outwardNormal,
      fromIor: identity.fromIor,
      toIor: identity.toIor,
      expected: {
        kind: "refract",
        ...(() => {
          const result = dielectricRefract(
            identity.incident,
            identity.outwardNormal,
            identity.fromIor,
            identity.toIor,
          );
          return { direction: result.direction, tir: result.tir };
        })(),
      },
    },
    {
      name: "glass to air TIR",
      operation: OP_REFRACTION,
      direction: tir.incident,
      outwardNormal: tir.outwardNormal,
      fromIor: tir.fromIor,
      toIor: tir.toIor,
      expected: {
        kind: "refract",
        ...(() => {
          const result = dielectricRefract(
            tir.incident,
            tir.outwardNormal,
            tir.fromIor,
            tir.toIor,
          );
          return { direction: result.direction, tir: result.tir };
        })(),
      },
    },
    {
      name: "Beer attenuation",
      fixture: d0,
      operation: OP_BEER,
      distance: beer.distance,
      expected: {
        kind: "beer",
        value: [
          dielectricBeerThroughput(0.17, beer.distance, d0.halfExtent),
          dielectricBeerThroughput(0.055, beer.distance, d0.halfExtent),
          dielectricBeerThroughput(0.025, beer.distance, d0.halfExtent),
        ],
      },
    },
    {
      name: "Fresnel normal incidence",
      operation: OP_FRESNEL,
      fromIor: 1,
      toIor: 1.45,
      params: [1, 0, 0, 0],
      expected: { kind: "fresnel", value: fresnelExpected(1, 1, 1.45) },
    },
  );
  return cases;
}

function writeInput(buffer: ArrayBuffer, input: ControlInput) {
  const floats = new Float32Array(buffer);
  const uints = new Uint32Array(buffer);
  const ints = new Int32Array(buffer);
  uints[0] = input.operation;
  uints[1] = input.inside ? 1 : 0;
  floats[2] = input.fromIor ?? 0;
  floats[3] = input.toIor ?? 0;
  for (let axis = 0; axis < 3; axis++) {
    floats[4 + axis] = input.origin?.[axis] ?? 0;
    floats[8 + axis] = input.direction?.[axis] ?? 0;
    floats[12 + axis] = input.outwardNormal?.[axis] ?? 0;
  }
  floats[16] =
    input.params?.[0] ??
    input.distance ??
    (input.expected.kind === "fresnel" ? input.expected.value : 0);
  const anchor = input.anchor;
  for (let axis = 0; axis < 4; axis++) {
    floats[20 + axis] = anchor?.intrinsicPoint[axis] ?? 0;
    ints[24 + axis] = anchor?.planeIndices[axis] ?? -1;
    ints[28 + axis] = anchor?.cellIndices[axis] ?? -1;
  }
  uints[32] = anchor?.planeMask ?? 0;
}

function readResult(bytes: ArrayBuffer): RawControlResult {
  const floats = new Float32Array(bytes);
  const uints = new Uint32Array(bytes);
  const ints = new Int32Array(bytes);
  return {
    scalar: [floats[0], floats[1], floats[2], floats[3]],
    normal: [floats[4], floats[5], floats[6], floats[7]],
    kind: uints[8],
    reason: uints[9],
    axis: uints[10],
    planeMask: uints[11],
    planeIndices: [ints[12], ints[13], ints[14], ints[15]],
    intrinsicPoint: [floats[16], floats[17], floats[18], floats[19]],
    cellIndices: [ints[20], ints[21], ints[22], ints[23]],
  };
}

function compareCase(
  input: ControlInput,
  actual: RawControlResult,
): DielectricGpuControlCase {
  const expected = input.expected;
  let passed: boolean;
  let failure: string | undefined;
  if (expected.kind === "boundary") {
    const result = expected.result;
    if (result.kind === "boundary") {
      passed =
        actual.kind === KIND_BOUNDARY &&
        close(actual.scalar[0], result.t) &&
        actual.scalar[1] === (result.entering ? 1 : 0) &&
        closeVec(actual.normal.slice(0, 3), result.outwardNormal) &&
        actual.axis === result.intrinsicAxis &&
        actual.planeMask === result.anchor.planeMask &&
        actual.planeIndices.every(
          (value, axis) => value === result.anchor.planeIndices[axis],
        ) &&
        actual.cellIndices.every(
          (value, axis) => value === result.anchor.cellIndices[axis],
        );
    } else {
      passed =
        actual.kind === (result.kind === "miss" ? KIND_MISS : KIND_REFUSED);
    }
    if (!passed) failure = "GPU boundary result differs from CPU solid oracle";
  } else if (expected.kind === "refract") {
    passed =
      actual.kind === 0 &&
      Boolean(actual.scalar[0] > 0.5) === expected.tir &&
      closeVec(actual.normal.slice(0, 3), expected.direction);
    if (!passed)
      failure = "GPU Snell/TIR result differs from CPU refraction oracle";
  } else if (expected.kind === "fresnel") {
    passed = actual.kind === 0 && close(actual.scalar[0], expected.value);
    if (!passed)
      failure = "GPU Fresnel value differs from the normal-incidence oracle";
  } else {
    passed =
      actual.kind === 0 && closeVec(actual.normal.slice(0, 3), expected.value);
    if (!passed)
      failure = "GPU Beer throughput differs from the CPU attenuation oracle";
  }
  return {
    name: input.name,
    passed,
    operation: [
      "",
      "boundary",
      "anchored-boundary",
      "refraction",
      "fresnel",
      "beer",
    ][input.operation],
    expected:
      expected.kind === "boundary"
        ? boundarySummary(expected.result)
        : expected,
    actual,
    tolerance: TOLERANCE,
    ...(failure ? { failure } : {}),
  };
}

/** Runs the compact controls using the exact shader source emitted by the image page. */
export async function runDielectricGpuControls(
  device: GPUDevice,
  shaderSource: string,
  pageOutputPixelBytes: number,
): Promise<DielectricGpuControlReport> {
  const failures: string[] = [];
  const cases: DielectricGpuControlCase[] = [];
  if (
    !shaderSource.includes("fn dielectricNextBoundaryFromAnchor") ||
    !shaderSource.includes("fn fresnel") ||
    !shaderSource.includes("fn refractOrReflect") ||
    !shaderSource.includes("fn beer")
  ) {
    return {
      passed: false,
      cases: [],
      failures: [
        "page shader source is missing one or more shared dielectric functions",
      ],
      count: 0,
      tolerance: TOLERANCE,
      source: "page-emitted-wgsl",
    };
  }
  try {
    const source = `${shaderSource}\n${CONTROL_WGSL}`;
    const module = device.createShaderModule({ code: source });
    const messages = await module.getCompilationInfo();
    const errors = messages.messages.filter(
      (message) => message.type === "error",
    );
    if (errors.length)
      throw new Error(errors.map((message) => message.message).join("\n"));
    const group0 = device.createBindGroupLayout({
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
    const group1 = device.createBindGroupLayout({
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
      layout: device.createPipelineLayout({
        bindGroupLayouts: [group0, group1],
      }),
      compute: { module, entryPoint: "runDielectricControl" },
    });
    const solid = device.createBuffer({
      size: DIELECTRIC_SOLID_PACKED_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const control = device.createBuffer({
      size: CONTROL_BUFFER_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const result = device.createBuffer({
      size: RESULT_BUFFER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
      size: RESULT_BUFFER_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const dummyCamera = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const dummyOutput = device.createBuffer({
      size: pageOutputPixelBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const bind0 = device.createBindGroup({
      layout: group0,
      entries: [
        { binding: 0, resource: { buffer: solid } },
        { binding: 1, resource: { buffer: dummyCamera } },
        { binding: 2, resource: { buffer: dummyOutput } },
      ],
    });
    const bind1 = device.createBindGroup({
      layout: group1,
      entries: [
        { binding: 0, resource: { buffer: solid } },
        { binding: 1, resource: { buffer: control } },
        { binding: 2, resource: { buffer: result } },
      ],
    });
    const runOne = async (
      input: ControlInput,
      anchorOverride?: DielectricBoundary["anchor"],
    ) => {
      const fixture = input.fixture ?? fixtureFor("mengerD0");
      device.queue.writeBuffer(solid, 0, packDielectricSolidFixture(fixture));
      const inputBytes = new ArrayBuffer(CONTROL_BUFFER_BYTES);
      writeInput(inputBytes, {
        ...input,
        fixture,
        anchor: anchorOverride ?? input.anchor,
      });
      device.queue.writeBuffer(control, 0, inputBytes);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind0);
      pass.setBindGroup(1, bind1);
      pass.dispatchWorkgroups(1);
      pass.end();
      encoder.copyBufferToBuffer(result, 0, readback, 0, RESULT_BUFFER_BYTES);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const bytes = readback.getMappedRange().slice(0, RESULT_BUFFER_BYTES);
      readback.unmap();
      return readResult(bytes);
    };
    const casesToRun = makeCases();
    const actualByName = new Map<string, RawControlResult>();
    for (const input of casesToRun) {
      let actual: RawControlResult;
      if (input.anchorFrom) {
        const sourceActual = actualByName.get(input.anchorFrom.name);
        if (!sourceActual || sourceActual.kind !== KIND_BOUNDARY) {
          const failure = `${input.name}: preceding GPU anchor source did not produce a boundary`;
          failures.push(failure);
          cases.push({
            name: input.name,
            passed: false,
            operation: "anchored-boundary",
            expected:
              input.expected.kind === "boundary"
                ? boundarySummary(input.expected.result)
                : input.expected,
            actual: sourceActual ?? null,
            tolerance: TOLERANCE,
            failure,
          });
          continue;
        }
        actual = await runOne(input, {
          intrinsicPoint: sourceActual.intrinsicPoint,
          planeMask: sourceActual.planeMask,
          planeIndices: sourceActual.planeIndices,
          cellIndices: sourceActual.cellIndices,
        });
      } else {
        actual = await runOne(input);
      }
      actualByName.set(input.name, actual);
      const checked = compareCase(input, actual);
      cases.push(checked);
      if (!checked.passed) failures.push(`${input.name}: ${checked.failure}`);
    }
    [solid, control, result, readback, dummyCamera, dummyOutput].forEach(
      (buffer) => buffer.destroy(),
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  return {
    passed:
      failures.length === 0 &&
      cases.length > 0 &&
      cases.every((entry) => entry.passed),
    cases,
    failures,
    count: cases.length,
    tolerance: TOLERANCE,
    source: "page-emitted-wgsl",
  };
}
