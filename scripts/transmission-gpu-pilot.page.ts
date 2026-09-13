/** Browser half of the harness-only transmission feasibility pilot.
 *
 * It deliberately calls only public production estimator emitters/packers.
 * This is not a renderer, a material proposal, or a new params wire.  Each
 * submitted pass prices a bounded batch of the shared sampled-clearance
 * coordinates.  Host fence wall and the post-fence timestamp duration remain
 * separate currencies.
 */
import {
  CLEARANCE_BAND_CONTRACT,
  CONTINUATION_STATE_BYTES,
  applyClearanceSample,
  clearanceSamplePoint,
  makeClearanceRayGrid,
  makeClearanceTraceState,
  traceStateSummary,
} from "./transmission-gpu-contract";
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
  mengerSponge,
  mandelboxBrick,
  mandelboxCube,
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

type Core = "affine" | "affine4" | "escape" | "escape4";
type Fixture = {
  id: string;
  core: Core;
  radius: number;
  params: ArrayBuffer;
  /** Repack every bounded dispatch through the public production packer. */
  packParams: (itemCount: number) => ArrayBuffer;
  maps: Float32Array;
  maxDepth: number;
  /** Public CPU oracle for the exact f32 coordinate uploaded to the GPU. */
  cpuDistance: (point: [number, number, number]) => number;
};

type PilotOptions = {
  width?: number;
  height?: number;
  batchSamples?: number;
  maxSamples?: number;
  /** Two batch widths prove that changing submission boundaries changes no sampled events. */
  checkChunkInvariant?: boolean;
};

const WORKGROUP = 64;
const CPU_AGREEMENT_SAMPLES_PER_CLASS = 128;
const CPU_AGREEMENT_PER_SUBMISSION_CLASS = 8;
const pose = {
  ro: [0, 0, 0] as [number, number, number],
  right: [1, 0, 0] as [number, number, number],
  up: [0, 1, 0] as [number, number, number],
  fwd: [0, 0, -1] as [number, number, number],
  tanHalf: 0,
  aspect: 1,
  rasterWidth: 1,
  rasterHeight: 1,
  // Eval mode does not march. Keeping this zero makes it impossible for a
  // pixel-derived hit epsilon to leak into the world-space band predicate.
  pixelEps: 0,
};

function runParams(itemCount: number, maxDepth: number) {
  return {
    itemCount,
    // The GPU only returns the production estimator. Classification happens
    // in applyClearanceSample at the shared world-space thresholds.
    cutoff: 0,
    maxDepth,
    hitFloor: 1e-5,
    footprint: 0,
    pose,
  };
}

function fixtures(): Fixture[] {
  const view4 = {
    // Posed native 4D queries; the full raw radius below deliberately does
    // not shrink with this off-centre slice.
    rotor: rotationMatrix4({ xw: 0.57, yw: -0.31 }),
    w0: 0.18,
    sliceHalfW: 0,
  };
  const menger = buildSurfaceDE(mengerSponge());
  const sparse4 = buildSurfaceDE4(pentatope());
  const filled3 = buildEscapeDE(mandelboxCube());
  const filled4 = buildEscapeDE4(mandelboxBrick());
  // The kernel receives a displayed 3D point and applies this transposed
  // rotor lift internally. This is the public packer's representation, not a
  // separately invented 4D pose convention.
  const rotorF32 = view4.rotor.map(Math.fround);
  const w0F32 = Math.fround(view4.w0);
  const dotF32 = (row: number, point: [number, number, number]): number => {
    let total = Math.fround(rotorF32[row] * point[0]);
    total = Math.fround(total + Math.fround(rotorF32[4 + row] * point[1]));
    total = Math.fround(total + Math.fround(rotorF32[8 + row] * point[2]));
    return Math.fround(total + Math.fround(rotorF32[12 + row] * w0F32));
  };
  const lift4 = (point: [number, number, number]) =>
    [
      dotF32(0, point),
      dotF32(1, point),
      dotF32(2, point),
      dotF32(3, point),
    ] as [number, number, number, number];
  return [
    {
      id: "menger-3d",
      core: "affine",
      radius: menger.visibleBoundingRadius,
      params: packSurfaceGpuParams(menger, runParams(1, menger.maxDepth)),
      packParams: (itemCount) =>
        packSurfaceGpuParams(menger, runParams(itemCount, menger.maxDepth)),
      maps: packSurfaceGpuMaps(menger),
      maxDepth: menger.maxDepth,
      cpuDistance: (point) => estimateDistanceRefined(menger, point, 0),
    },
    {
      id: "pentatope-4d-posed-sparse",
      core: "affine4",
      radius: sparse4.visibleBoundingRadius,
      params: packSurface4GpuParams(
        sparse4,
        view4,
        runParams(1, sparse4.maxDepth),
      ),
      maps: packSurfaceGpuMaps4(sparse4),
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
      params: packEscapeGpuParams(
        filled3,
        runParams(1, ESCAPE_TIME_ITERATIONS),
      ),
      packParams: (itemCount) =>
        packEscapeGpuParams(
          filled3,
          runParams(itemCount, ESCAPE_TIME_ITERATIONS),
        ),
      maps: packEscapeGpuMaps(filled3),
      maxDepth: ESCAPE_TIME_ITERATIONS,
      cpuDistance: (point) => estimateEscapeDistance(filled3, point),
    },
    {
      id: "mandelbox-brick-4d-posed-filled-escape",
      core: "escape4",
      radius: filled4.boundingRadius,
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
      maps: packEscape4GpuMaps(filled4),
      maxDepth: ESCAPE_TIME_ITERATIONS,
      cpuDistance: (point) => estimateEscapeDistance4(filled4, lift4(point)),
    },
  ];
}

function median(values: number[]) {
  const xs = [...values].sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)] ?? null;
}

function buffer(device: GPUDevice, size: number, usage: GPUBufferUsageFlags) {
  return device.createBuffer({
    size: Math.max(4, Math.ceil(size / 4) * 4),
    usage,
  });
}

async function runFixture(
  device: GPUDevice,
  fixture: Fixture,
  options: Required<PilotOptions>,
) {
  const fixtureStart = performance.now();
  const grid = makeClearanceRayGrid({
    width: options.width,
    height: options.height,
    radius: fixture.radius,
  });
  const module = device.createShaderModule({
    code: surfaceDeKernelWgsl({
      mode: "eval",
      core: fixture.core,
      width: 4,
      workgroupSize: WORKGROUP,
      sharedFrontier: false,
      bnbStage2: false,
    }),
  });
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter((m) => m.type === "error");
  if (errors.length)
    throw new Error(
      `${fixture.id}: ${errors.map((m) => m.message).join("\n")}`,
    );
  const pipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module, entryPoint: "evalQueries" },
  });
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
  const queries = buffer(
    device,
    options.batchSamples * 16,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const results = buffer(
    device,
    options.batchSamples * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  );
  const readback = buffer(
    device,
    options.batchSamples * 4,
    GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  );
  const stateReservation = buffer(
    device,
    grid.rays.length * CONTINUATION_STATE_BYTES.core,
    GPUBufferUsage.STORAGE,
  );
  const activeReservation = buffer(
    device,
    grid.rays.length * 4,
    GPUBufferUsage.STORAGE,
  );
  const statusReservation = buffer(
    device,
    grid.rays.length * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  );
  device.queue.writeBuffer(
    maps,
    0,
    fixture.maps.buffer,
    fixture.maps.byteOffset,
    fixture.maps.byteLength,
  );

  const tsSupported = device.features.has("timestamp-query");
  const timestamps = tsSupported
    ? device.createQuerySet({ type: "timestamp", count: 2 })
    : null;
  const tsResolve = timestamps
    ? buffer(device, 16, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC)
    : null;
  const tsRead = timestamps
    ? buffer(device, 16, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ)
    : null;
  const state = makeClearanceTraceState(grid);
  const bandEnter =
    fixture.radius * CLEARANCE_BAND_CONTRACT.enterRadiusFraction;
  const bandLeave =
    fixture.radius * CLEARANCE_BAND_CONTRACT.leaveRadiusFraction;
  const wallMs: number[] = [];
  const gpuMs: number[] = [];
  let hostPackMs = 0;
  let timestampResolveMs = 0;
  let readbackAndTransitionMs = 0;
  const agreementCandidates: {
    point: [number, number, number];
    gpu: number;
    nearestBand: number;
  }[] = [];
  const farAgreementCandidates: {
    point: [number, number, number];
    gpu: number;
    nearestBand: number;
  }[] = [];
  const eventWitnesses: {
    ray: [number, number];
    sample: number;
    point: [number, number, number];
    distance: number;
  }[] = [];
  let submissions = 0;
  let samples = 0;
  let cursorRay = 0;

  // Fixed-grid strategy: an item is a single declared sample.  A production
  // continuation scheduler may compact rays differently, but may not change
  // this coordinate sequence or silently turn an unfinished tail into a miss.
  while (cursorRay < grid.rays.length) {
    const packed: { ray: number; sample: number }[] = [];
    const remainingBudget = options.maxSamples - samples;
    if (remainingBudget <= 0) break;
    for (
      ;
      cursorRay < grid.rays.length &&
      packed.length < options.batchSamples &&
      packed.length < remainingBudget;
      cursorRay++
    ) {
      const ray = grid.rays[cursorRay];
      const trace = state[cursorRay];
      while (
        trace.sample < ray.samples &&
        packed.length < options.batchSamples &&
        packed.length < remainingBudget
      ) {
        packed.push({ ray: cursorRay, sample: trace.sample++ });
      }
      if (trace.sample >= ray.samples) trace.complete = true;
      if (trace.sample < ray.samples) break;
    }
    if (packed.length === 0) continue;
    const packStart = performance.now();
    const queryData = new Float32Array(packed.length * 4);
    packed.forEach(({ ray, sample }, i) => {
      const p = clearanceSamplePoint(grid.rays[ray], sample, grid.delta);
      queryData.set([p[0], p[1], p[2], 0], i * 4);
    });
    const packedParams = fixture.packParams(packed.length);
    device.queue.writeBuffer(params, 0, packedParams);
    device.queue.writeBuffer(queries, 0, queryData);
    hostPackMs += performance.now() - packStart;
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: maps } },
        { binding: 2, resource: { buffer: queries } },
        { binding: 3, resource: { buffer: results } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass(
      timestamps
        ? {
            timestampWrites: {
              querySet: timestamps,
              beginningOfPassWriteIndex: 0,
              endOfPassWriteIndex: 1,
            },
          }
        : undefined,
    );
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(packed.length / WORKGROUP));
    pass.end();
    encoder.copyBufferToBuffer(results, 0, readback, 0, packed.length * 4);
    const t0 = performance.now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    wallMs.push(performance.now() - t0);
    if (timestamps && tsResolve && tsRead) {
      // Resolve after the fence in a new submission. A same-submission
      // resolve is unreliable; docs/surface-compute-renderer.md records the
      // tested placement and the production renderer uses this shape.
      const resolveStart = performance.now();
      const resolve = device.createCommandEncoder();
      resolve.resolveQuerySet(timestamps, 0, 2, tsResolve, 0);
      resolve.copyBufferToBuffer(tsResolve, 0, tsRead, 0, 16);
      device.queue.submit([resolve.finish()]);
      await tsRead.mapAsync(GPUMapMode.READ);
      const pair = new BigUint64Array(tsRead.getMappedRange().slice(0));
      tsRead.unmap();
      gpuMs.push(Number(pair[1] - pair[0]) / 1e6);
      timestampResolveMs += performance.now() - resolveStart;
    }
    const readbackStart = performance.now();
    await readback.mapAsync(GPUMapMode.READ, 0, packed.length * 4);
    const distances = new Float32Array(
      readback.getMappedRange(0, packed.length * 4).slice(0),
    );
    readback.unmap();
    // The CPU oracle is intentionally bounded: retain only the most relevant
    // f32-uploaded locations near either predicate boundary from this
    // submission, then choose the closest 128 across the run. A separate
    // 128-point far class avoids falsely calling boundary-only agreement a
    // whole-estimator agreement.
    const nearThisSubmission = packed.map(({ ray, sample }, i) => {
      const point = clearanceSamplePoint(grid.rays[ray], sample, grid.delta);
      const uploaded: [number, number, number] = [
        Math.fround(point[0]),
        Math.fround(point[1]),
        Math.fround(point[2]),
      ];
      const gpu = distances[i];
      return {
        point: uploaded,
        gpu,
        nearestBand: Math.min(
          Math.abs(gpu - bandEnter),
          Math.abs(gpu - bandLeave),
        ),
      };
    });
    nearThisSubmission
      .sort((a, b) => a.nearestBand - b.nearestBand)
      .slice(0, CPU_AGREEMENT_PER_SUBMISSION_CLASS)
      .forEach((candidate) => agreementCandidates.push(candidate));
    nearThisSubmission
      .sort((a, b) => b.gpu - a.gpu)
      .slice(0, CPU_AGREEMENT_PER_SUBMISSION_CLASS)
      .forEach((candidate) => farAgreementCandidates.push(candidate));
    agreementCandidates.sort((a, b) => a.nearestBand - b.nearestBand);
    agreementCandidates.length = Math.min(
      agreementCandidates.length,
      CPU_AGREEMENT_SAMPLES_PER_CLASS,
    );
    farAgreementCandidates.sort((a, b) => b.gpu - a.gpu);
    farAgreementCandidates.length = Math.min(
      farAgreementCandidates.length,
      CPU_AGREEMENT_SAMPLES_PER_CLASS,
    );
    packed.forEach(({ ray, sample }, i) => {
      const distance = distances[i];
      if (
        eventWitnesses.length < 3 &&
        !state[ray].insideRun &&
        distance <= bandEnter
      ) {
        const point = clearanceSamplePoint(grid.rays[ray], sample, grid.delta);
        eventWitnesses.push({
          ray: [grid.rays[ray].x, grid.rays[ray].y],
          sample,
          point: [
            Math.fround(point[0]),
            Math.fround(point[1]),
            Math.fround(point[2]),
          ],
          distance,
        });
      }
      applyClearanceSample(state[ray], distance, fixture.radius);
    });
    readbackAndTransitionMs += performance.now() - readbackStart;
    submissions++;
    samples += packed.length;
  }
  // A chunk that ended in the middle of a ray has a precise unresolved tail.
  for (let i = 0; i < state.length; i++) {
    const trace = state[i];
    if (trace.sample < grid.rays[i].samples) trace.unresolved = true;
  }
  const summary = traceStateSummary(state);
  const fullSamples = grid.rays.reduce((total, ray) => total + ray.samples, 0);
  const hostTotal = wallMs.reduce((a, b) => a + b, 0);
  const gpuTotal = gpuMs.reduce((a, b) => a + b, 0);
  const perSample = (total: number) => (samples === 0 ? null : total / samples);
  let maxCpuAbsError = 0;
  let maxCpuRelativeError = 0;
  let worstRawWitness:
    | {
        point: [number, number, number];
        cpuDistance: number;
        gpuDistance: number;
      }
    | undefined;
  let enterPredicateMismatches = 0;
  let leavePredicateMismatches = 0;
  const predicateFailureWitnesses: {
    point: [number, number, number];
    cpuDistance: number;
    gpuDistance: number;
    enterThreshold: number;
    leaveThreshold: number;
    cpuEntered: boolean;
    gpuEntered: boolean;
    cpuRearmed: boolean;
    gpuRearmed: boolean;
  }[] = [];
  const cpuOracleStart = performance.now();
  for (const candidate of [...agreementCandidates, ...farAgreementCandidates]) {
    const cpu = fixture.cpuDistance(candidate.point);
    const abs = Math.abs(cpu - candidate.gpu);
    maxCpuAbsError = Math.max(maxCpuAbsError, abs);
    if (
      !worstRawWitness ||
      abs > Math.abs(worstRawWitness.cpuDistance - worstRawWitness.gpuDistance)
    ) {
      worstRawWitness = {
        point: candidate.point,
        cpuDistance: cpu,
        gpuDistance: candidate.gpu,
      };
    }
    maxCpuRelativeError = Math.max(
      maxCpuRelativeError,
      abs / Math.max(1e-8, Math.abs(cpu)),
    );
    const cpuEntered = cpu <= bandEnter;
    const gpuEntered = candidate.gpu <= bandEnter;
    if (cpuEntered !== gpuEntered) {
      enterPredicateMismatches++;
    }
    const cpuRearmed = cpu > bandLeave;
    const gpuRearmed = candidate.gpu > bandLeave;
    if (cpuRearmed !== gpuRearmed) {
      leavePredicateMismatches++;
    }
    if (
      predicateFailureWitnesses.length < 8 &&
      (cpuEntered !== gpuEntered || cpuRearmed !== gpuRearmed)
    ) {
      predicateFailureWitnesses.push({
        point: candidate.point,
        cpuDistance: cpu,
        gpuDistance: candidate.gpu,
        enterThreshold: bandEnter,
        leaveThreshold: bandLeave,
        cpuEntered,
        gpuEntered,
        cpuRearmed,
        gpuRearmed,
      });
    }
  }
  const cpuOracleMs = performance.now() - cpuOracleStart;
  const comparedSamples =
    agreementCandidates.length + farAgreementCandidates.length;
  const agreementVerdict =
    comparedSamples === CPU_AGREEMENT_SAMPLES_PER_CLASS * 2 &&
    enterPredicateMismatches === 0 &&
    leavePredicateMismatches === 0
      ? "pass"
      : "refused";
  const f32Ulp = (value: number) => {
    const magnitude = Math.max(Math.abs(value), 2 ** -126);
    return 2 ** (Math.floor(Math.log2(magnitude)) - 23);
  };
  const cpuNeighborRange = worstRawWitness
    ? (() => {
        const values = [worstRawWitness.cpuDistance];
        for (let axis = 0; axis < 3; axis++) {
          const ulp = f32Ulp(worstRawWitness.point[axis]);
          for (const sign of [-1, 1]) {
            const point: [number, number, number] = [...worstRawWitness.point];
            point[axis] = Math.fround(point[axis] + sign * ulp);
            values.push(fixture.cpuDistance(point));
          }
        }
        return { min: Math.min(...values), max: Math.max(...values) };
      })()
    : null;
  const report = {
    fixture: fixture.id,
    core: fixture.core,
    estimatorDepth: fixture.maxDepth,
    raster: { width: grid.width, height: grid.height, rays: grid.rays.length },
    contract: {
      ...CLEARANCE_BAND_CONTRACT,
      rawBoundingRadius: fixture.radius,
      delta: grid.delta,
      pixelEpsilonParticipates: false,
      sampleDomain:
        "analytic sphere interval [enter, exit); no endpoint sample",
      pilotCamera: {
        origin: grid.rays[0]?.origin ?? null,
        fovY: grid.fovY,
        limitation:
          "Fixed pilot framing, not the CPU preview renderer camera; only the shared ray-grid contract makes a CPU/GPU run comparable.",
      },
    },
    phase: {
      // Eval measures every fixed clearance sample. A production first trace,
      // hit attribution, normal/shade and warp remain intentionally absent.
      firstTrace: "not implemented by this pilot",
      clearance: {
        samples,
        fullAnalyticDomainSamples: fullSamples,
        submissions,
        samplesPerSubmissionCap: options.batchSamples,
      },
      laterTrace: "not implemented by this pilot",
      attributionNormalShadeWarp: "not implemented by this pilot",
    },
    result: summary,
    termination: {
      // A ray that never intersects the raw bounding ball is an exact domain
      // miss. A ray that consumes every declared sample is only complete for
      // this sampled appearance rule, including if it ends while still in a
      // run; neither result declares a mathematical interior exit.
      analyticDomainMisses: grid.rays.filter((ray) => ray.samples === 0).length,
      sampledDomainComplete: summary.sampledDomainComplete,
      opaqueStops: 0,
      contributionBoundedBelowTolerance: 0,
      unresolved: summary.unresolved,
    },
    timing: {
      endToEndPilotWallMs: performance.now() - fixtureStart,
      hostFenceWallMs: {
        total: hostTotal,
        medianPerSubmission: median(wallMs),
        maxPerSubmission: Math.max(0, ...wallMs),
      },
      gpuPassMs: gpuMs.length
        ? {
            total: gpuTotal,
            medianPerSubmission: median(gpuMs),
            maxPerSubmission: Math.max(0, ...gpuMs),
          }
        : null,
      hostPackingMs: hostPackMs,
      timestampResolveAndMapMs: timestampResolveMs,
      readbackAndCpuTransitionMs: readbackAndTransitionMs,
      cpuOracleAgreementMs: cpuOracleMs,
    },
    coverageNormalized: {
      eventRays: summary.eventRays,
      hostFenceWallMsPerEventRay:
        summary.eventRays === 0 ? null : hostTotal / summary.eventRays,
      gpuPassMsPerEventRay:
        gpuMs.length === 0 || summary.eventRays === 0
          ? null
          : gpuTotal / summary.eventRays,
    },
    cpuAgreement: {
      oracle:
        "public production estimator at the f32 coordinate uploaded to evalQueries",
      comparedNearBandSamples: agreementCandidates.length,
      comparedFarSamples: farAgreementCandidates.length,
      maxAbsoluteError: maxCpuAbsError,
      maxRelativeError: maxCpuRelativeError,
      worstRawValueWitness: worstRawWitness
        ? { ...worstRawWitness, cpuNeighborRange }
        : null,
      enterPredicateMismatches,
      leavePredicateMismatches,
      predicateFailureWitnesses,
      verdict: agreementVerdict,
      refusal:
        agreementVerdict === "pass"
          ? null
          : "CPU/GPU sampled event predicate agreement is incomplete or changed; timing row is refused.",
      escapeClassifierLimitation:
        fixture.core === "escape" || fixture.core === "escape4"
          ? "Escape DE comparison pins the sampled event classifier only; DE>leave is not a certified interior exit."
          : null,
    },
    wholePaneExtrapolation: {
      // This is an extrapolation from bounded submissions, not an observed
      // full-pane settle. It is intentionally null when no samples ran.
      fullAnalyticDomainSamples: fullSamples,
      estimatedSubmissions: Math.ceil(fullSamples / options.batchSamples),
      kernelGpuLowerBoundMs:
        gpuMs.length === 0 || perSample(gpuTotal) === null
          ? null
          : perSample(gpuTotal)! * fullSamples,
      limitation:
        "Kernel-only linear lower bound. It excludes host packing, fences, timestamp resolve/map, readback, compaction, first/later tracing, shading, presentation and export.",
    },
    memory: {
      continuationCoreStateBytes:
        grid.rays.length * CONTINUATION_STATE_BYTES.core,
      activeAndStatusBytes: grid.rays.length * 8,
      fixedEstimatorParamsAndMapsBytes:
        fixture.params.byteLength + fixture.maps.byteLength,
      timestampResolveAndReadbackBytes: timestamps ? 32 : 0,
      perSubmissionQueryResultReadbackBytes:
        options.batchSamples * (16 + 4 + 4),
      allocatedBytes:
        grid.rays.length * CONTINUATION_STATE_BYTES.total +
        options.batchSamples * 24 +
        fixture.params.byteLength +
        fixture.maps.byteLength +
        (timestamps ? 32 : 0),
      limitation:
        "Timestamp query-set implementation memory is not exposed by WebGPU and is excluded from this byte total.",
    },
    coordinateWitness: {
      nonzeroSampleRay: (() => {
        const ray = grid.rays.find((candidate) => candidate.samples > 0);
        return ray
          ? {
              ray: [ray.x, ray.y],
              enter: ray.enter,
              exit: ray.exit,
              samples: ray.samples,
              first: clearanceSamplePoint(ray, 0, grid.delta),
            }
          : null;
      })(),
      enteredRuns: eventWitnesses,
    },
  };
  [
    params,
    maps,
    queries,
    results,
    readback,
    stateReservation,
    activeReservation,
    statusReservation,
    tsResolve,
    tsRead,
  ].forEach((item) => item?.destroy());
  timestamps?.destroy();
  return {
    report,
    // Kept in-page only for exact chunk-boundary comparison. It never goes
    // into the JSON report, which would otherwise retain a full-raster state
    // vector merely to prove a scheduler invariant.
    trace: state.map(({ events, insideRun, complete, unresolved }) => ({
      events,
      insideRun,
      complete,
      unresolved,
    })),
  };
}

export async function runTransmissionGpuPilot(input: PilotOptions = {}) {
  const options: Required<PilotOptions> = {
    width: input.width ?? 512,
    height: input.height ?? 288,
    batchSamples: input.batchSamples ?? 65536,
    // An explicit cap protects a pilot from being mistaken for a full render;
    // cap exhaustion is reported unresolved, never as background.
    maxSamples: input.maxSamples ?? 8_000_000,
    checkChunkInvariant: input.checkChunkInvariant ?? false,
  };
  const adapter = await navigator.gpu?.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) return { inconclusive: "no WebGPU adapter" };
  const requiredFeatures: GPUFeatureName[] = adapter.features.has(
    "timestamp-query",
  )
    ? ["timestamp-query"]
    : [];
  const device = await adapter.requestDevice({ requiredFeatures });
  const info = adapter.info as GPUAdapterInfo & {
    isFallbackAdapter?: boolean;
  };
  const adapterFallback = (
    adapter as GPUAdapter & {
      isFallbackAdapter?: boolean;
    }
  ).isFallbackAdapter;
  const browserAdapter = {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
    isFallbackAdapter:
      adapterFallback === true || info.isFallbackAdapter === true,
  };
  const adapterFields = [
    browserAdapter.vendor,
    browserAdapter.architecture,
    browserAdapter.device,
    browserAdapter.description,
  ].filter((field) => field.trim().length > 0);
  const software =
    browserAdapter.isFallbackAdapter ||
    adapterFields.some((field) => /swiftshader|llvmpipe|software/i.test(field));
  if (adapterFields.length === 0 || software) {
    return {
      inconclusive:
        adapterFields.length === 0
          ? "browser WebGPU adapter identity is blank"
          : "browser WebGPU adapter is fallback/software",
      browserAdapter,
    };
  }
  const runs = [];
  for (const fixture of fixtures())
    runs.push(await runFixture(device, fixture, options));
  // The second pass is deliberately opt-in: it costs the same samples, and
  // compares event/tail classification rather than comparing a rendered look.
  // It only claims an invariant if both runs consume their whole analytic
  // domains; a budget-truncated prefix is a different scheduling question.
  const chunkInvariant = [];
  if (options.checkChunkInvariant) {
    const comparisonOptions = {
      ...options,
      batchSamples: Math.max(WORKGROUP, Math.floor(options.batchSamples / 2)),
    };
    for (const fixture of fixtures()) {
      const comparison = await runFixture(device, fixture, comparisonOptions);
      const original = runs.find(
        (candidate) => candidate.report.fixture === fixture.id,
      )!;
      const complete =
        original.report.result.unresolved === 0 &&
        comparison.report.result.unresolved === 0;
      const samePerRayTrace =
        complete &&
        original.trace.length === comparison.trace.length &&
        original.trace.every((left, index) => {
          const right = comparison.trace[index];
          return (
            left.events === right.events &&
            left.insideRun === right.insideRun &&
            left.complete === right.complete &&
            left.unresolved === right.unresolved
          );
        });
      chunkInvariant.push({
        fixture: fixture.id,
        comparedBatchSamples: [
          options.batchSamples,
          comparisonOptions.batchSamples,
        ],
        complete,
        sameEventCount:
          complete &&
          original.report.result.events === comparison.report.result.events,
        sameEventRayCount:
          complete &&
          original.report.result.eventRays ===
            comparison.report.result.eventRays,
        samePerRayTrace,
        limitation: complete
          ? null
          : "Not judged: at least one run exhausted its declared sample budget.",
      });
    }
  }
  return {
    browserAdapter,
    timestampQuery: device.features.has("timestamp-query"),
    options,
    continuationStateBytesPerRay: CONTINUATION_STATE_BYTES.total,
    rows: runs.map((run) => run.report),
    chunkInvariant,
    limitation:
      "This prices fixed-grid DE samples only. It does not establish an optical material, a certified interior, a general exit oracle, or first/later ray march and shade cost.",
  };
}

// esbuild's IIFE entry exposes this stable testing seam to the launcher.
(
  globalThis as typeof globalThis & { TransmissionGpuPilot?: unknown }
).TransmissionGpuPilot = {
  runTransmissionGpuPilot,
};
