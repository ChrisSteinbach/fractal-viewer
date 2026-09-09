import { rotationMatrix4 } from "../../fractal/affine4";
import { mulberry32 } from "../../fractal/rng";
import { SHAPE_MARCH_SAFETY, shapeSdf } from "../../fractal/shapes";
import {
  buildSurfaceDE,
  estimateDistanceRefined,
  type SurfaceDE,
} from "../../fractal/surface-de";
import {
  buildSurfaceDE4,
  estimateDistance4Refined,
  type SurfaceDE4,
} from "../../fractal/surface-de-4d";
import {
  packSurface4GpuParams,
  packSurfaceGpuMaps,
  packSurfaceGpuMaps4,
  packSurfaceGpuParams,
  packSurfaceGpuShadeMaps,
  packSurfaceGpuShade,
  surfaceDeKernelWgsl,
  SURFACE_GPU_RAY_HIT,
  type SurfaceGpu4View,
  type SurfaceGpuKernelOptions,
  type SurfaceGpuRunParams,
  type SurfaceGpuShadeParams,
} from "../../fractal/surface-de-gpu";
import { resolveSurfaceMaterial } from "../../fractal/surface-material-wire";
import type {
  HybridSchedule,
  Transform,
  Vec3,
  Vec4,
} from "../../fractal/types";
import { surfaceChaosKernelSpec } from "./chaos";
import { surfaceCondensationKernelSpec } from "./condensation";
import { surfaceScheduleKernelSpec } from "./schedule";

type Tolerance = (distance: number, radius: number) => number;
type EmitterOnlySystem =
  | { de: SurfaceDE; view4?: undefined }
  | { de: SurfaceDE4; view4: SurfaceGpu4View };

export type SurfaceEmitterOnlyFixture = EmitterOnlySystem & {
  name: string;
  core: "affine" | "affine4";
  queries: Vec3[];
  cpu: number[];
  shades: number[];
  requestedDepth?: number;
};

/** Two distinct materials plus an exact duplicate of the first emitter.
 * Every slot-0 winner also pins the strict tie rule against slot 2. The
 * disabled recursive transform must not occupy a physical or shade slot. */
function emitterOnlyTransforms(fourD: boolean, graph: boolean): Transform[] {
  const sphere: Transform = {
    id: 0,
    position: [0.53, -0.08, 0.11],
    rotation: [0.12, -0.17, 0.2],
    scale: [0.27, 0.27, 0.27],
    emitter: {
      parts: [{ primitive: { kind: "sphere", radius: 1 }, combine: "union" }],
    },
    ...(fourD ? { w: { position: 0.05, rotation: { xw: 0.21 } } } : {}),
  };
  const transforms: Transform[] = [
    sphere,
    {
      id: 1,
      position: [-0.47, 0.22, -0.07],
      rotation: [-0.13, 0.18, -0.09],
      scale: [0.26, 0.26, 0.26],
      emitter: {
        parts: [
          {
            primitive: { kind: "box", half: [0.8, 0.6, 0.9] },
            combine: "union",
          },
        ],
      },
      ...(fourD ? { w: { position: -0.04, rotation: { yw: -0.17 } } } : {}),
    },
    { ...sphere, id: 2 },
    {
      id: 3,
      position: [8, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.4, 0.4, 0.4],
      weight: 0,
    },
  ];
  return transforms.map((transform, index) => ({
    ...transform,
    ...(graph ? { chaos: index % 2 ? [0, 1, 0, 0] : [1, 0, 1, 0] } : {}),
  }));
}

function emitterOnlySchedule(): HybridSchedule {
  return {
    depth: 2,
    transforms: [-1, 1].map((sign, id) => ({
      id,
      position: [sign * 0.41, sign * 0.05, -sign * 0.03],
      rotation: [0, 0, sign * 0.11],
      scale: [0.48, 0.48, 0.48],
    })),
  };
}

const EMITTER_VIEW4: SurfaceGpu4View = {
  rotor: rotationMatrix4({ xw: 0.23, yw: -0.19 }).map(Math.fround),
  w0: 0.015,
  sliceHalfW: 0,
};

/** Exhaust the finite B word and posed C0 records, without inverse descent,
 * branch pruning, terminal balls, or xaos traversal. Root wildcard permits
 * every emitter even when all successor rows are disconnected. */
function finiteEmitterHit(
  system: EmitterOnlySystem,
  p: Vec3,
): {
  distance: number;
  shade: number;
} {
  const { de } = system;
  const dimension = system.view4 ? 4 : 3;
  const point: number[] = system.view4
    ? Array.from({ length: 4 }, (_, row) =>
        [p[0], p[1], p[2], system.view4.w0].reduce(
          (sum, value, column) =>
            sum + system.view4.rotor[column * 4 + row] * value,
          0,
        ),
      )
    : p;
  const inverse = (m: readonly number[], t: readonly number[], q: number[]) =>
    Array.from({ length: dimension }, (_, row) =>
      q.reduce(
        (sum, value, column) => sum + m[row * dimension + column] * value,
        t[row],
      ),
    );
  let frontier = [{ point, scale: 1 }];
  for (let depth = 0; depth < (de.schedule?.depth ?? 0); depth++) {
    frontier = frontier.flatMap((entry) =>
      de.schedule!.maps.map((map) => ({
        point: inverse(map.invM, map.invT, entry.point),
        scale: entry.scale * map.sigmaMin,
      })),
    );
  }
  let best = Infinity;
  let shade = -1;
  for (const entry of frontier) {
    for (const emitter of de.condensation!.emitters) {
      const q = inverse(emitter.invM, emitter.invT, entry.point);
      const sd = shapeSdf(emitter.shape, q[0], q[1], q[2]);
      const embedded = dimension === 4 ? Math.hypot(Math.max(sd, 0), q[3]) : sd;
      const distance = entry.scale * emitter.sigmaMin * embedded;
      if (distance < best) {
        best = distance;
        shade = emitter.shadeIndex;
      }
    }
  }
  return { distance: Math.max(0, SHAPE_MARCH_SAFETY * best), shade };
}

function emitterOnlyCpu(
  system: EmitterOnlySystem,
  q: Vec3,
  requestedDepth?: number,
): number {
  if (!system.view4) {
    return estimateDistanceRefined(
      { ...system.de, maxDepth: requestedDepth ?? system.de.maxDepth },
      q,
    );
  }
  const point = [q[0], q[1], q[2], system.view4.w0];
  const lifted = Array.from({ length: 4 }, (_, row) =>
    point.reduce(
      (sum, value, column) =>
        sum + system.view4.rotor[column * 4 + row] * value,
      0,
    ),
  ) as Vec4;
  return estimateDistance4Refined(
    { ...system.de, maxDepth: requestedDepth ?? system.de.maxDepth },
    lifted,
  );
}

/** Four unfinished B prefixes are the exact qualification boundary. These
 * queries are mandatory: the centre gap cannot be skipped just because a
 * CPU frontier bug disagrees with the independently enumerated finite set.
 * The first material owns both central spheres, so their equal distances
 * do not create an ambiguous cross-material tie; slot 2 duplicates it. */
function emitterOnlyBoundaryFixture(
  fourD: boolean,
  count: number,
  depth: number,
  tolerance: Tolerance,
): SurfaceEmitterOnlyFixture {
  const first: Transform = {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    emitter: {
      parts: [-0.4, 0.4].map((x) => ({
        primitive: { kind: "sphere", radius: 0.1 },
        combine: "union",
        pose: { offset: [x, 0, 0] },
      })),
    },
  };
  const transforms: Transform[] = [
    first,
    {
      id: 1,
      position: [0, 0.55, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      emitter: {
        parts: [
          { primitive: { kind: "sphere", radius: 0.08 }, combine: "union" },
        ],
      },
    },
    { ...first, id: 2 },
  ];
  const schedule: HybridSchedule = {
    depth,
    transforms: Array.from({ length: count }, (_, id) => ({
      id,
      position: [(id - (count - 1) / 2) * 0.01, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    })),
  };
  const system: EmitterOnlySystem = fourD
    ? {
        de: buildSurfaceDE4(
          transforms,
          null,
          { order: 1, plane: "xy" },
          { schedule },
        ),
        view4: { rotor: rotationMatrix4({}), w0: 0, sliceHalfW: 0 },
      }
    : {
        de: buildSurfaceDE(
          transforms,
          null,
          { order: 1, plane: "xy" },
          { schedule },
        ),
      };
  const name = `emitter-only-${fourD ? "4" : "3"}-boundary-${count}B-depth${depth}`;
  const queries: Vec3[] = [
    [0, 0, 0],
    [0.03, 0, 0],
    [-0.04, 0, 0.02],
    [0.08, 0.03, 0],
    [0, 0.43, 0],
    [0.01, 0.44, 0.03],
    [-0.02, 0.65, 0.01],
    [0.015, 0.54, 0.1],
  ].map((q) => q.map(Math.fround) as Vec3);
  const expected = queries.map((q) => finiteEmitterHit(system, q));
  const cpu = queries.map((q) => emitterOnlyCpu(system, q, 0));
  const exactGap = SHAPE_MARCH_SAFETY * (0.3 - 0.005 * (count - 1) * depth);
  if (Math.abs(expected[0].distance - exactGap) > 1e-12)
    throw new Error(
      `${name}: finite oracle lost the explicit centre gap ${exactGap}`,
    );
  for (let i = 0; i < queries.length; i++) {
    if (
      expected[i].distance <= 0 ||
      expected[i].shade !== (i < 4 ? 0 : 1) ||
      !Number.isFinite(cpu[i]) ||
      Math.abs(cpu[i] - expected[i].distance) >
        tolerance(expected[i].distance, system.de.visibleBoundingRadius) * 0.1
    ) {
      throw new Error(
        `${name} mandatory q${i}: cpu=${cpu[i]}, finite=${expected[i].distance}, shade=${expected[i].shade}`,
      );
    }
  }
  return {
    ...system,
    name,
    core: fourD ? "affine4" : "affine",
    queries,
    cpu,
    shades: expected.map((hit) => hit.shade),
    requestedDepth: 0,
  };
}

/** Stable, positive-distance queries expose false terminal balls and two
 * different material winners. At least four per material must survive the
 * finite-oracle comparison and local continuity check in every fixture. */
export function surfaceEmitterOnlyFixtures(
  tolerance: Tolerance,
): SurfaceEmitterOnlyFixture[] {
  const fixtures: SurfaceEmitterOnlyFixture[] = [];
  for (const fourD of [false, true]) {
    for (const variant of [
      "plain",
      "depth-zero",
      "schedule",
      "schedule-wide-all-levels",
      "xaos-symmetry",
      "schedule-xaos-symmetry",
    ] as const) {
      const graph = variant.includes("xaos");
      const transforms = emitterOnlyTransforms(fourD, graph);
      const symmetry = { order: graph ? 3 : 1, plane: "xy" as const };
      const wide = variant === "schedule-wide-all-levels";
      const options = {
        condensationDepthBand: wide ? {} : { minDepth: 0, maxDepth: 0 },
        ...(variant.includes("schedule")
          ? {
              schedule: wide
                ? {
                    depth: 1,
                    transforms: Array.from(
                      { length: 5 },
                      (_, id): Transform => ({
                        id,
                        position: [0, 0, 0],
                        rotation: [0, 0, 0],
                        scale: [1, 1, 1],
                      }),
                    ),
                  }
                : emitterOnlySchedule(),
            }
          : {}),
      };
      const system: EmitterOnlySystem = fourD
        ? {
            de: buildSurfaceDE4(transforms, null, symmetry, options),
            view4: EMITTER_VIEW4,
          }
        : { de: buildSurfaceDE(transforms, null, symmetry, options) };
      const name = `emitter-only-${fourD ? "4" : "3"}-${variant}`;
      if (
        system.de.maps.length !== 0 ||
        !system.de.condensation ||
        (graph && !system.de.chaos)
      ) {
        throw new Error(
          `${name}: fixture did not build its required zero-map condensation/xaos path`,
        );
      }
      const requestedDepth = variant === "plain" ? undefined : 0;
      const queries: Vec3[] = [];
      const cpu: number[] = [];
      const shades: number[] = [];
      const counts = [0, 0];
      const rng = mulberry32(0xc001 + (fourD ? 4 : 3));
      const radius = system.de.visibleBoundingRadius;
      for (let attempt = 0; attempt < 4096 && queries.length < 8; attempt++) {
        const q = [0, 1, 2].map(() =>
          Math.fround((2 * rng() - 1) * radius * 0.8),
        ) as Vec3;
        if (Math.hypot(...q) > radius * 0.9) continue;
        const expected = finiteEmitterHit(system, q);
        if (
          expected.shade > 1 ||
          counts[expected.shade] >= 4 ||
          expected.distance < radius * 0.005
        )
          continue;
        const value = emitterOnlyCpu(system, q, requestedDepth);
        const tol = tolerance(expected.distance, radius);
        if (Math.abs(value - expected.distance) > tol * 0.1) continue;
        let stable = true;
        for (let axis = 0; axis < 3; axis++) {
          for (const sign of [-1, 1]) {
            const nearby = [...q] as Vec3;
            nearby[axis] += sign * radius * 1e-5;
            const candidate = finiteEmitterHit(system, nearby);
            if (
              candidate.shade !== expected.shade ||
              Math.abs(candidate.distance - value) > tol * 0.25
            )
              stable = false;
          }
        }
        if (!stable) continue;
        queries.push(q);
        cpu.push(value);
        shades.push(expected.shade);
        counts[expected.shade]++;
      }
      if (queries.length !== 8)
        throw new Error(
          `${name}: only ${counts.join("+")} stable finite-oracle material queries`,
        );
      fixtures.push({
        ...system,
        name,
        core: fourD ? "affine4" : "affine",
        queries,
        cpu,
        shades,
        requestedDepth,
      });
    }
    fixtures.push(
      emitterOnlyBoundaryFixture(fourD, 2, 3, tolerance),
      emitterOnlyBoundaryFixture(fourD, 4, 2, tolerance),
    );
  }
  return fixtures;
}

function fixtureParams(
  fixture: SurfaceEmitterOnlyFixture,
  run: SurfaceGpuRunParams,
): ArrayBuffer {
  const options = { ...run, maxDepth: fixture.requestedDepth, fogDensity: 0 };
  return fixture.view4
    ? packSurface4GpuParams(fixture.de, fixture.view4, options)
    : packSurfaceGpuParams(fixture.de, options);
}

export interface SurfaceEmitterOnlyAgreementRow {
  name: string;
  queries: number;
  evalMaxError: number;
  hitInfoMismatches: number;
  shadeMaxByteError: number;
  paletteMaxByteError: number;
}

/** Actual eval and shade entry points, plus a diagnostic entry that calls
 * the unchanged shade kernel's surfaceDEHitInfo. Its states input and two
 * output lanes reuse existing bindings, so production wire sizes are still
 * tested exactly. Ambient=1, specular=0 and no AO/shadow/fog make the full
 * shade entry's expected pixel the authored material RGB or Palette texel.
 * No shader body is replaced; a wrong zero-map slot clamp or absent-child
 * trap read cannot hide behind matching eval. */
export async function runSurfaceEmitterOnlyAgreement(
  device: GPUDevice,
  tolerance: Tolerance,
  status: (text: string) => void,
): Promise<SurfaceEmitterOnlyAgreementRow[]> {
  const fixtures = surfaceEmitterOnlyFixtures(tolerance);
  const rows: SurfaceEmitterOnlyAgreementRow[] = [];
  const colors: Vec3[] = [
    [0.82, 0.13, 0.19],
    [0.12, 0.75, 0.27],
    [0.14, 0.2, 0.85],
  ];
  const shadeData = packSurfaceGpuShadeMaps(
    colors,
    [0.125, 0.625, 0.875],
    colors.map(() => resolveSurfaceMaterial({ specular: 0 }, undefined)),
  );
  // Exactly representable texel-centre coordinates above keep filtering
  // independent of the expected authored RGB. The two exercised materials
  // sample red and blue, visibly different from their By Transform colors.
  const palettePixels = new Uint8Array([
    240, 70, 40, 255, 50, 230, 130, 255, 45, 80, 230, 255, 230, 45, 190, 255,
  ]);
  const paletteTexels = [0, 2, 3];
  const layout = device.createBindGroupLayout({
    entries: [
      ...(
        [
          "uniform",
          "read-only-storage",
          "read-only-storage",
          "storage",
          "uniform",
          "read-only-storage",
          "storage",
        ] as const
      ).map((type, binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type },
      })),
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
      {
        binding: 9,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [layout],
  });
  for (const fixture of fixtures) {
    status(`emitter-only GPU agreement: ${fixture.name}…`);
    const buffers: GPUBuffer[] = [];
    const buffer = (
      data: ArrayBuffer | Uint32Array | Float32Array,
      usage: GPUBufferUsageFlags,
    ) => {
      const result = device.createBuffer({
        size: Math.max(4, data.byteLength),
        usage: usage | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(
        result,
        0,
        data instanceof ArrayBuffer
          ? data
          : new Uint8Array(
              data.buffer,
              data.byteOffset,
              data.byteLength,
            ).slice(),
      );
      buffers.push(result);
      return result;
    };
    const texture = device.createTexture({
      size: [4, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture },
      palettePixels,
      { bytesPerRow: 16 },
      [4, 1],
    );
    try {
      const n = fixture.queries.length;
      const params = buffer(
        fixtureParams(fixture, { itemCount: n }),
        GPUBufferUsage.UNIFORM,
      );
      const maps = buffer(
        new Float32Array(
          fixture.view4
            ? packSurfaceGpuMaps4(fixture.de)
            : packSurfaceGpuMaps(fixture.de),
        ),
        GPUBufferUsage.STORAGE,
      );
      const list = buffer(new Uint32Array(n), GPUBufferUsage.STORAGE);
      const input = new Float32Array(n * 4);
      fixture.queries.forEach((q, i) => input.set(q, i * 4));
      const states = buffer(input, GPUBufferUsage.STORAGE);
      const shadeParams: SurfaceGpuShadeParams = {
        invProjView: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        lightDir: [0, 1, 0],
        ambient: 1,
        bgTop: [0, 0, 0],
        bgBottom: [0, 0, 0],
        colorSpeed: 0.5,
        tracePixelEps: 0,
        colorSource: 0,
        shadowSteps: 0,
        aoTaps: 0,
        dither: false,
        bgOffset: [0, 0],
        bgExtent: [1, 1],
        bgCenter: [0.5, 0.5],
        bgScale: [1, 1],
        bgShape: 0,
      };
      const shade = buffer(
        packSurfaceGpuShade(shadeParams),
        GPUBufferUsage.UNIFORM,
      );
      const shadeMaps = buffer(shadeData, GPUBufferUsage.STORAGE);
      const output = buffer(
        new Uint32Array(n),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      );
      const layers = buffer(
        new Uint32Array(n),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      );
      const staging = device.createBuffer({
        size: n * 8,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      buffers.push(staging);
      const group = device.createBindGroup({
        layout,
        entries: [
          ...[params, maps, list, states, shade, shadeMaps, output].map(
            (resource, binding) => ({
              binding,
              resource: { buffer: resource },
            }),
          ),
          { binding: 7, resource: texture.createView() },
          {
            binding: 8,
            resource: device.createSampler({
              magFilter: "linear",
              minFilter: "linear",
            }),
          },
          { binding: 9, resource: { buffer: layers } },
        ],
      });
      const options: SurfaceGpuKernelOptions = {
        mode: "shade",
        core: fixture.core,
        width: 4,
        workgroupSize: 1,
        sharedFrontier: false,
        bnbStage2: false,
        finish: true,
        condensation: surfaceCondensationKernelSpec(fixture.de),
        ...(fixture.de.schedule
          ? { schedule: surfaceScheduleKernelSpec(fixture.de) }
          : {}),
        ...(fixture.de.chaos
          ? { chaos: surfaceChaosKernelSpec(fixture.de) }
          : {}),
      };
      const module = device.createShaderModule({
        code: `${surfaceDeKernelWgsl(options)}
@compute @workgroup_size(1)
fn emitterOnlyProbe(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.itemCount) { return; }
  let q = states[i].xyz;
  colorOut[i] = bitcast<u32>(surfaceDE(q, 0.0, 0u));
  layerOut[i] = bitcast<u32>(surfaceDEHitInfo(q, 0u).firstChoice);
}`,
      });
      const probe = await device.createComputePipelineAsync({
        layout: pipelineLayout,
        compute: { module, entryPoint: "emitterOnlyProbe" },
      });
      const shadePipeline = await device.createComputePipelineAsync({
        layout: pipelineLayout,
        compute: { module, entryPoint: "shadeRays" },
      });
      const evalPipeline = await device.createComputePipelineAsync({
        layout: "auto",
        compute: {
          module: device.createShaderModule({
            code: surfaceDeKernelWgsl({ ...options, mode: "eval" }),
          }),
          entryPoint: "evalQueries",
        },
      });
      const evalGroup = device.createBindGroup({
        layout: evalPipeline.getBindGroupLayout(0),
        entries: [params, maps, states, output].map((resource, binding) => ({
          binding,
          resource: { buffer: resource },
        })),
      });
      const dispatch = async (
        pipeline: GPUComputePipeline,
        count: number,
        bindGroup = group,
      ): Promise<ArrayBuffer> => {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(count);
        pass.end();
        encoder.copyBufferToBuffer(output, 0, staging, 0, n * 4);
        encoder.copyBufferToBuffer(layers, 0, staging, n * 4, n * 4);
        device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const result = staging.getMappedRange().slice(0);
        staging.unmap();
        return result;
      };
      const evaluated = new Float32Array(
        await dispatch(evalPipeline, n, evalGroup),
        0,
        n,
      );
      const probed = await dispatch(probe, n);
      const values = new Float32Array(probed, 0, n);
      const shades = new Int32Array(probed, n * 4, n);
      const row: SurfaceEmitterOnlyAgreementRow = {
        name: fixture.name,
        queries: n,
        evalMaxError: 0,
        hitInfoMismatches: 0,
        shadeMaxByteError: 0,
        paletteMaxByteError: 0,
      };
      for (let i = 0; i < n; i++) {
        for (const actual of [evaluated[i], values[i]]) {
          const error = Math.abs(actual - fixture.cpu[i]);
          if (
            !Number.isFinite(actual) ||
            error > tolerance(fixture.cpu[i], fixture.de.visibleBoundingRadius)
          )
            throw new Error(
              `${fixture.name} eval q${i}: gpu=${actual}, cpu=${fixture.cpu[i]}`,
            );
          row.evalMaxError = Math.max(row.evalMaxError, error);
        }
        if (shades[i] !== fixture.shades[i]) row.hitInfoMismatches++;
        const q = fixture.queries[i];
        device.queue.writeBuffer(
          params,
          0,
          fixtureParams(fixture, {
            itemCount: 1,
            pose: {
              ro: [q[0], q[1], q[2] - 1],
              right: [1, 0, 0],
              up: [0, 1, 0],
              fwd: [0, 0, 1],
              tanHalf: 1,
              aspect: 1,
              rasterWidth: 1,
              rasterHeight: 1,
              pixelEps: 0,
            },
          }),
        );
        device.queue.writeBuffer(
          states,
          0,
          new Float32Array([1, SURFACE_GPU_RAY_HIT, 1, 0]),
        );
        for (const colorSource of [0, 1]) {
          device.queue.writeBuffer(
            shade,
            0,
            packSurfaceGpuShade({ ...shadeParams, colorSource }),
          );
          const pixels = new Uint8Array(await dispatch(shadePipeline, 1));
          const key =
            colorSource === 0 ? "shadeMaxByteError" : "paletteMaxByteError";
          const emitter = fixture.shades[i];
          for (let channel = 0; channel < 3; channel++) {
            const expected =
              colorSource === 0
                ? Math.round(colors[emitter][channel] * 255)
                : palettePixels[paletteTexels[emitter] * 4 + channel];
            row[key] = Math.max(row[key], Math.abs(pixels[channel] - expected));
          }
          if (pixels[3] !== 255)
            throw new Error(
              `${fixture.name} source${colorSource} shade q${i}: alpha=${pixels[3]}`,
            );
        }
      }
      if (
        row.hitInfoMismatches !== 0 ||
        row.shadeMaxByteError > 1 ||
        row.paletteMaxByteError > 1
      )
        throw new Error(
          `${fixture.name}: hit-info mismatches=${row.hitInfoMismatches}, shade max byte error=${row.shadeMaxByteError}, palette max byte error=${row.paletteMaxByteError}`,
        );
      rows.push(row);
    } finally {
      for (const resource of buffers) resource.destroy();
      texture.destroy();
    }
  }
  return rows;
}
