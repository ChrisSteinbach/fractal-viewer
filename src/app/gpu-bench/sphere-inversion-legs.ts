/**
 * The sphere-inversion family's `bench:surface` device legs — the half of
 * `sphere-inversion.ts` that needs a GPU. Called from the surface section
 * (`main.ts`) with the section's shared device, before its verdict; the
 * section folds {@link SphereInversionBenchResults.failed} into its own
 * verdict and prints the rows through `scripts/gpu-flame-bench.mjs`.
 *
 * Five legs, each pinned against the f64 CPU estimator through the pure
 * module's comparators:
 *
 *   1. COMPILE MATRIX — both cores in every mode and every composition the
 *      plan admits (eval; the app's unproject march with `statusOut`; shade
 *      plain, with a finish, with a finish over the ground plane, and with a
 *      lighting rig). A WGSL error fails the section with the message
 *      verbatim.
 *   2. EVAL AGREEMENT — every fixture row, `surfaceEvalTol` on clamped
 *      values at `fail = 0`, the one-sided f32 gate, the per-row
 *      anti-vacuity floors, the flat 4D reduction against the 3D kernel, and
 *      the hit-info attribution (generation and seed member) through a probe
 *      entry appended to the shade kernel.
 *   3. MARCH AGREEMENT — the app's exact ray derivation (`rays:
 *      "unproject"`) over a bounded 96×54 raster, per ray against the CPU
 *      march emulator, for the 3D kissing pearls and the 600-cell vault's
 *      interior camera.
 *   4. PRODUCTION FRAMES — `SurfaceComputeRenderer` sessions: 3D pearls over
 *      the ground plane, and the 600-cell medallion at two view4 poses on one
 *      renderer (the per-frame repack). A real adapter must finish with a
 *      HIT/MISS mix, no exhausted or active rays, and a hit rate within the
 *      section's sanity band of a strided CPU march.
 *   5. TIMING — eval µs/query per row at a pilot-sized batch, beside the
 *      caller's timing subjects (existing cores on the same harness).
 *      Informational, never gating.
 */
import {
  SURFACE_GPU_HIT_FLOOR,
  SURFACE_GPU_RAY_ACTIVE,
  SURFACE_GPU_SHADE_BYTES,
  packSphereInversion4GpuParams,
  packSphereInversionGpuParams,
  packSurfaceGpuShade,
  surfaceDeKernelWgsl,
} from "../../fractal/surface-de-gpu";
import type {
  SurfaceGpu4View,
  SurfaceGpuKernelOptions,
  SurfaceGpuPose,
  SurfaceGpuRunParams,
} from "../../fractal/surface-de-gpu";
import { packSphereInversionGpuTables } from "../../fractal/surface-sphere-inversion-gpu";
import type { SphereInversionGpuTables } from "../../fractal/surface-sphere-inversion-gpu";
import type { Vec3 } from "../../fractal/types";
import {
  SURFACE_COMPUTE_INITIAL_RAY_STEP_US,
  SURFACE_COMPUTE_WORKGROUP_SIZE,
  SurfaceComputeRenderer,
} from "../surface-compute";
import type { SurfaceComputeFrameSpec } from "../surface-compute";
import {
  SI_BENCH_MARCH_STEPS,
  SI_BENCH_PIXEL_EPS,
  buildSphereInversionBenchRows,
  compareSphereInversionAttribution,
  compareSphereInversionEval,
  compareSphereInversionFlat,
  compareSphereInversionMarch,
  sphereInversionBenchFixtures,
  sphereInversionBenchPose,
  sphereInversionBenchView4,
  sphereInversionCpuMarch,
  sphereInversionInvProjView,
  sphereInversionUnprojectRay,
} from "./sphere-inversion";
import type { SiBenchRow, SiEvalRow, SiMarchRow } from "./sphere-inversion";

const EVAL_WG = 16;
const MARCH_ROWS = ["siOct6Kiss3", "si600Vault4@XW.3W.1"];
const MARCH_WIDTH = 96;
const MARCH_HEIGHT = 54;
const MARCH_CAP_MS = 600_000;
const MARCH_PASS_TARGET_MS = 250;
const MARCH_MAX_STEPS_PER_PASS = 32;
const MARCH_MIN_CHUNK = 64;
const MARCH_INITIAL_RAY_STEP_US_SW = 1000;
const FRAME_WIDTH = 256;
const FRAME_HEIGHT = 144;
const FRAME_WIDTH_SW = 96;
const FRAME_HEIGHT_SW = 54;
const FRAME_BUDGET_MS = 120_000;
const FRAME_BUDGET_SW_MS = 300_000;
const FRAME_SANITY_STRIDE = 8;
const FRAME_SANITY_TOL = 0.15;
/** Eval timing (see {@link timeEval}): rows timed, the spread pilot, the
 * smallest submission, the per-submission target and its cap. */
const TIMING_ROWS = [
  "siOct6Pearls3",
  "siOct6Kiss3",
  "si600Vault4@XW.3W.1",
  "si600Medallion4@XW.4YW.3ZW.2",
  "si600Snowflake4@W.06",
  // Appended: the 30-generator 3D row, timed beside the 12-generator ones.
  "siIcosidodec30Star3",
  // Appended: the rest of the 3D shipped band, so µs/query reads against
  // generator count 6/8/12/30 in 3D and 24/120 in 4D.
  "siCube8Shell3",
  "siIco12Vault3",
  "siCell24Shell4",
];
const TIMING_PILOT = 64;
/** The smallest submission a slow core may shrink to. */
const TIMING_MIN = 64;
const TIMING_TARGET_MS = 150;
const TIMING_MAX = 262_144;
const TIMING_REPS = 3;

/** An existing core timed on the same eval harness, for comparison. */
export interface SiTimingSubject {
  name: string;
  core: string;
  code: string;
  packParams: (itemCount: number) => ArrayBuffer;
  maps: Float32Array;
  queries: Vec3[];
}

export interface SiCompileRow {
  core: "sphereInv" | "sphereInv4";
  config: string;
  compileMs: number;
  error?: string;
}

export interface SiFrameRow {
  system: string;
  label: string;
  width: number;
  height: number;
  wallMs: number;
  gpuMs: number;
  passes: number;
  truncated: boolean;
  counts: {
    hit: number;
    miss: number;
    exhausted: number;
    active: number;
    plane: number;
  };
  gpuHitRate: number;
  cpuHitRate: number;
  pass: boolean;
  reason?: string;
}

export interface SiTimingRow {
  name: string;
  core: string;
  /** Queries timed per repetition (whole tiles of the mix). */
  queries: number;
  /** Queries per submission. */
  submission: number;
  usPerQuery: number;
}

export interface SphereInversionBenchResults {
  compile: SiCompileRow[];
  eval: SiEvalRow[];
  flat?: { n: number; maxDelta: number; mismatches: number };
  march: SiMarchRow[];
  frames: SiFrameRow[];
  timing: SiTimingRow[];
  notes: string[];
  failed: boolean;
}

export interface SphereInversionBenchContext {
  device: GPUDevice;
  software: boolean;
  tol: (cpu: number, R: number) => number;
  status: (text: string) => void;
  /** Publish partial results as they land. */
  update?: (results: SphereInversionBenchResults) => void;
  onFrame?: (
    label: string,
    caption: string,
    pixels: Uint8Array,
    width: number,
    height: number,
  ) => void;
  timingSubjects?: SiTimingSubject[];
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function yieldToPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

async function compile(
  device: GPUDevice,
  code: string,
  entryPoint: string,
  label: string,
): Promise<{ pipeline: GPUComputePipeline; compileMs: number }> {
  const t0 = performance.now();
  device.pushErrorScope("validation");
  const module = device.createShaderModule({ label, code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === "error");
  if (errors.length > 0) {
    await device.popErrorScope();
    const lines = code.split("\n");
    throw new Error(
      `WGSL compile errors (${label}):\n` +
        errors
          .map(
            (m) =>
              `${m.lineNum}:${m.linePos}: ${m.message}\n  > ${(lines[m.lineNum - 1] ?? "").trim()}`,
          )
          .join("\n"),
    );
  }
  let pipeline: GPUComputePipeline;
  try {
    pipeline = await device.createComputePipelineAsync({
      label,
      layout: "auto",
      compute: { module, entryPoint },
    });
  } catch (e) {
    await device.popErrorScope();
    throw new Error(`pipeline creation failed (${label}): ${describe(e)}`, {
      cause: e,
    });
  }
  const validation = await device.popErrorScope();
  if (validation) {
    throw new Error(`pipeline creation (${label}): ${validation.message}`);
  }
  return { pipeline, compileMs: performance.now() - t0 };
}

function kernelOptions(
  core: "sphereInv" | "sphereInv4",
  extra: Partial<SurfaceGpuKernelOptions>,
): SurfaceGpuKernelOptions {
  return {
    core,
    mode: "eval",
    width: 4,
    workgroupSize: EVAL_WG,
    sharedFrontier: false,
    bnbStage2: false,
    ...extra,
  };
}

function coreOf(row: SiBenchRow): "sphereInv" | "sphereInv4" {
  return row.dim === 3 ? "sphereInv" : "sphereInv4";
}

function packParams(
  row: SiBenchRow,
  tables: SphereInversionGpuTables,
  run: SurfaceGpuRunParams,
  view4: SurfaceGpu4View | null = row.view4,
): ArrayBuffer {
  return row.dim === 3
    ? packSphereInversionGpuParams(tables, run)
    : packSphereInversion4GpuParams(tables, view4!, run);
}

function storage(
  device: GPUDevice,
  data: ArrayBufferView | ArrayBuffer,
  extraUsage = 0,
): GPUBuffer {
  const bytes =
    data instanceof ArrayBuffer
      ? data
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const buffer = device.createBuffer({
    size: Math.max(4, Math.ceil(bytes.byteLength / 4) * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extraUsage,
  });
  device.queue.writeBuffer(buffer, 0, bytes);
  return buffer;
}

function uniform(device: GPUDevice, data: ArrayBuffer): GPUBuffer {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

function queryData(
  queries: readonly Vec3[],
  count = queries.length,
  offset = 0,
): Float32Array {
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const q = queries[(offset + i) % queries.length];
    out[i * 4] = q[0];
    out[i * 4 + 1] = q[1];
    out[i * 4 + 2] = q[2];
  }
  return out;
}

async function readBack(
  device: GPUDevice,
  src: GPUBuffer,
  bytes: number,
): Promise<ArrayBuffer> {
  const staging = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(src, 0, staging, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const out = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return out;
}

/** One eval dispatch over `count` queries (tiled); returns the values and
 * the submit → done time. */
async function runEval(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  params: ArrayBuffer,
  maps: Float32Array,
  queries: readonly Vec3[],
  count = queries.length,
  read = true,
  offset = 0,
): Promise<{ values: Float32Array | null; ms: number }> {
  const buffers = [
    uniform(device, params),
    storage(device, maps),
    storage(device, queryData(queries, count, offset)),
    device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    }),
  ];
  try {
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: buffers.map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(count / EVAL_WG));
    pass.end();
    const t0 = performance.now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const ms = performance.now() - t0;
    const values = read
      ? new Float32Array(await readBack(device, buffers[3], count * 4))
      : null;
    return { values, ms };
  } finally {
    for (const b of buffers) b.destroy();
  }
}

/** The hit-info probe: the shade kernel's own `surfaceDEHitInfo` per query,
 * writing the generation and the seed member (decoded from `sheets`). */
async function runAttributionProbe(
  device: GPUDevice,
  row: SiBenchRow,
  tables: SphereInversionGpuTables,
): Promise<{ generation: Int32Array; seedMember: Int32Array }> {
  const core = coreOf(row);
  const n = row.queries.length;
  const code = `${surfaceDeKernelWgsl(kernelOptions(core, { mode: "shade" }))}
@compute @workgroup_size(${EVAL_WG})
fn siAttributionProbe(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.itemCount) {
    return;
  }
  let info = surfaceDEHitInfo(states[i].xyz, 0u);
  colorOut[i] = u32(max(info.firstChoice, 0));
  layerOut[i] = u32(round(info.sheets * f32(params.siCounts.y + 1u)));
}`;
  const { pipeline } = await compile(
    device,
    code,
    "siAttributionProbe",
    `si attribution ${row.fixture.name}`,
  );
  const layout = pipeline.getBindGroupLayout(0);
  const params = uniform(
    device,
    packParams(row, tables, { itemCount: n, cutoff: 0 }),
  );
  const maps = storage(device, tables.data);
  const states = storage(device, queryData(row.queries));
  const colorOut = device.createBuffer({
    size: n * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const layerOut = device.createBuffer({
    size: n * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  try {
    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: maps } },
        { binding: 3, resource: { buffer: states } },
        { binding: 6, resource: { buffer: colorOut } },
        { binding: 9, resource: { buffer: layerOut } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(n / EVAL_WG));
    pass.end();
    device.queue.submit([encoder.finish()]);
    const generation = new Uint32Array(await readBack(device, colorOut, n * 4));
    const sheets = new Uint32Array(await readBack(device, layerOut, n * 4));
    return {
      generation: Int32Array.from(generation),
      seedMember: Int32Array.from(sheets, (v) => v - 1),
    };
  } finally {
    for (const b of [params, maps, states, colorOut, layerOut]) b.destroy();
  }
}

async function runCompileMatrix(
  ctx: SphereInversionBenchContext,
  out: SphereInversionBenchResults,
): Promise<void> {
  const configs: [string, string, Partial<SurfaceGpuKernelOptions>][] = [
    ["eval", "evalQueries", { mode: "eval" }],
    [
      "march unproject statusOut",
      "marchRays",
      {
        mode: "march",
        rays: "unproject",
        statusOut: true,
        workgroupSize: SURFACE_COMPUTE_WORKGROUP_SIZE,
      },
    ],
    [
      "shade",
      "shadeRays",
      { mode: "shade", workgroupSize: SURFACE_COMPUTE_WORKGROUP_SIZE },
    ],
    [
      "shade finish",
      "shadeRays",
      {
        mode: "shade",
        finish: true,
        workgroupSize: SURFACE_COMPUTE_WORKGROUP_SIZE,
      },
    ],
    [
      "shade groundPlane+finish",
      "shadeRays",
      {
        mode: "shade",
        groundPlane: true,
        finish: true,
        workgroupSize: SURFACE_COMPUTE_WORKGROUP_SIZE,
      },
    ],
    [
      "shade lighting",
      "shadeRays",
      {
        mode: "shade",
        lighting: true,
        workgroupSize: SURFACE_COMPUTE_WORKGROUP_SIZE,
      },
    ],
  ];
  for (const core of ["sphereInv", "sphereInv4"] as const) {
    for (const [config, entry, extra] of configs) {
      ctx.status(`sphere-inversion: compiling ${core} ${config}…`);
      try {
        const { compileMs } = await compile(
          ctx.device,
          surfaceDeKernelWgsl(kernelOptions(core, extra)),
          entry,
          `si ${core} ${config}`,
        );
        out.compile.push({ core, config, compileMs });
      } catch (e) {
        out.compile.push({ core, config, compileMs: 0, error: describe(e) });
        out.notes.push(
          `sphere-inversion compile ${core} ${config}: ${describe(e)}`,
        );
        out.failed = true;
      }
      ctx.update?.(out);
    }
  }
}

async function runEvalLegs(
  ctx: SphereInversionBenchContext,
  rows: SiBenchRow[],
  out: SphereInversionBenchResults,
): Promise<Map<string, Float32Array>> {
  const values = new Map<string, Float32Array>();
  const pipelines = new Map<string, GPUComputePipeline>();
  for (const row of rows) {
    const core = coreOf(row);
    const name = row.fixture.name;
    ctx.status(`sphere-inversion eval: ${name}…`);
    try {
      let pipeline = pipelines.get(core);
      if (!pipeline) {
        ({ pipeline } = await compile(
          ctx.device,
          surfaceDeKernelWgsl(kernelOptions(core, {})),
          "evalQueries",
          `si eval ${core}`,
        ));
        pipelines.set(core, pipeline);
      }
      const tables = packSphereInversionGpuTables(row.de);
      const params = packParams(row, tables, {
        itemCount: row.queries.length,
        cutoff: 0,
      });
      const { values: gpu, ms } = await runEval(
        ctx.device,
        pipeline,
        params,
        tables.data,
        row.queries,
      );
      values.set(name, gpu!);
      const result = compareSphereInversionEval(row, gpu!, ctx.tol);
      result.gpuMs = ms;
      const attribution = await runAttributionProbe(ctx.device, row, tables);
      compareSphereInversionAttribution(
        row,
        result,
        gpu!,
        attribution.generation,
        attribution.seedMember,
        ctx.tol,
      );
      if (
        (result.generationMismatches ?? 0) > 0 ||
        (result.seedMemberMismatches ?? 0) > 0
      ) {
        result.pass = false;
      }
      out.eval.push(result);
      if (!result.pass) {
        out.failed = true;
        out.notes.push(
          `sphere-inversion eval ${name}: fail=${result.failures} oneSided=${result.oneSidedFailures} ` +
            `vacuous=[${result.vacuous.join(",")}] generationMismatches=${result.generationMismatches ?? "?"} ` +
            `seedMemberMismatches=${result.seedMemberMismatches ?? "?"}`,
        );
      }
    } catch (e) {
      out.failed = true;
      out.notes.push(`sphere-inversion eval ${name}: ${describe(e)}`);
    }
    ctx.update?.(out);
    await yieldToPage();
  }
  const g3 = values.get("siOct6Pearls3");
  const g4 = values.get("siFlat4");
  if (g3 && g4) {
    out.flat = compareSphereInversionFlat(g3, g4);
    if (out.flat.mismatches > 0) {
      out.failed = true;
      out.notes.push(
        `sphere-inversion flat reduction: ${out.flat.mismatches}/${out.flat.n} queries past ` +
          `1e-6 between the 4D kernel on the flat embedding and the 3D kernel`,
      );
    }
  } else {
    out.failed = true;
    out.notes.push("sphere-inversion flat reduction: a row did not run");
  }
  return values;
}

async function marchRows(
  ctx: SphereInversionBenchContext,
  row: SiBenchRow,
): Promise<SiMarchRow> {
  const { device } = ctx;
  const core = coreOf(row);
  const pose = sphereInversionBenchPose(row, MARCH_WIDTH, MARCH_HEIGHT);
  const inv = sphereInversionInvProjView(row, pose);
  const rays = MARCH_WIDTH * MARCH_HEIGHT;
  const { pipeline, compileMs } = await compile(
    device,
    surfaceDeKernelWgsl(
      kernelOptions(core, {
        mode: "march",
        rays: "unproject",
        workgroupSize: SURFACE_COMPUTE_WORKGROUP_SIZE,
      }),
    ),
    "marchRays",
    `si march ${row.fixture.name}`,
  );
  const tables = packSphereInversionGpuTables(row.de);
  const run = (
    itemCount: number,
    stepsThisPass: number,
  ): SurfaceGpuRunParams => ({
    itemCount,
    stepsThisPass,
    marchSteps: SI_BENCH_MARCH_STEPS,
    pose,
    cutoff: 0,
  });
  const params = uniform(device, packParams(row, tables, run(0, 1)));
  const maps = storage(device, tables.data);
  const active = device.createBuffer({
    size: rays * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const init = new Float32Array(rays * 4);
  for (let i = 0; i < rays; i++) init[i * 4] = -1;
  const states = storage(device, init, GPUBufferUsage.COPY_SRC);
  const shade = uniform(
    device,
    packSurfaceGpuShade({
      invProjView: inv,
      lightDir: [0, 1, 0],
      ambient: 0,
      bgTop: [0, 0, 0],
      bgBottom: [0, 0, 0],
      colorSpeed: 0.5,
      tracePixelEps: SI_BENCH_PIXEL_EPS,
      colorSource: 0,
      shadowSteps: 0,
      aoTaps: 0,
      dither: false,
      bgOffset: [0, 0],
      bgExtent: [MARCH_WIDTH, MARCH_HEIGHT],
      bgCenter: [0.5, 0.5],
      bgScale: [1, 1],
      bgShape: 0,
    }),
  );
  if (shade.size < SURFACE_GPU_SHADE_BYTES)
    throw new Error("shade buffer undersized");
  try {
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [params, maps, active, states, shade].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    });
    let list = Uint32Array.from({ length: rays }, (_, i) => i);
    let stepsThisPass = 1;
    let ema = ctx.software
      ? MARCH_INITIAL_RAY_STEP_US_SW
      : SURFACE_COMPUTE_INITIAL_RAY_STEP_US;
    let gpuMs = 0;
    let passes = 0;
    let truncated = false;
    let snapshot = init;
    const wallStart = performance.now();
    outer: while (list.length > 0) {
      let sweptWhole = true;
      let lastMs = Infinity;
      for (let offset = 0; offset < list.length;) {
        if (performance.now() - wallStart > MARCH_CAP_MS) {
          truncated = true;
          break outer;
        }
        const chunk = Math.min(
          Math.max(
            MARCH_MIN_CHUNK,
            Math.floor(
              (MARCH_PASS_TARGET_MS * 1000) /
                Math.max(1e-3, ema * stepsThisPass),
            ),
          ),
          list.length - offset,
        );
        if (offset > 0 || chunk < list.length) sweptWhole = false;
        const slice = list.subarray(offset, offset + chunk);
        device.queue.writeBuffer(
          params,
          0,
          packParams(row, tables, run(slice.length, stepsThisPass)),
        );
        device.queue.writeBuffer(active, 0, slice);
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(
          Math.ceil(slice.length / SURFACE_COMPUTE_WORKGROUP_SIZE),
        );
        pass.end();
        const t0 = performance.now();
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        lastMs = performance.now() - t0;
        gpuMs += lastMs;
        passes++;
        ema =
          ema * 0.6 + ((lastMs * 1000) / (slice.length * stepsThisPass)) * 0.4;
        offset += chunk;
      }
      snapshot = new Float32Array(await readBack(device, states, rays * 16));
      list = Uint32Array.from(
        Array.from(list).filter(
          (ray) => snapshot[ray * 4 + 1] === SURFACE_GPU_RAY_ACTIVE,
        ),
      );
      ctx.status(
        `sphere-inversion march ${row.fixture.name}: pass ${passes}, ${list.length}/${rays} active`,
      );
      if (
        sweptWhole &&
        lastMs < MARCH_PASS_TARGET_MS &&
        stepsThisPass < MARCH_MAX_STEPS_PER_PASS
      ) {
        stepsThisPass *= 2;
      }
    }
    const base = truncated
      ? null
      : compareSphereInversionMarch(row, pose, inv, snapshot, ctx.tol);
    const result: SiMarchRow = {
      ...(base ?? {
        system: row.fixture.name,
        core,
        rasterWidth: MARCH_WIDTH,
        rasterHeight: MARCH_HEIGHT,
        rays,
        gpuHits: 0,
        cpuHits: 0,
        gpuExhausted: 0,
        cpuExhausted: 0,
        statusMismatches: 0,
        boundaryFlips: 0,
        silhouetteFlips: 0,
        flipCap: 0,
        bothHits: 0,
        hitTFailures: 0,
        maxAbsT: 0,
        failures: 0,
      }),
      passes,
      gpuMs,
      compileMs,
      truncated,
      pass: false,
    };
    result.pass =
      !truncated &&
      passes >= 1 &&
      result.failures === 0 &&
      result.gpuHits > 0 &&
      result.gpuHits < rays &&
      result.cpuHits > 0 &&
      result.cpuHits < rays;
    return result;
  } finally {
    for (const b of [params, maps, active, states, shade]) b.destroy();
  }
}

function frameSanityRate(
  row: SiBenchRow,
  pose: SurfaceGpuPose,
  inv: Float32Array,
  view4: SurfaceGpu4View | null,
): number {
  const sub = {
    ...row,
    view4,
    visR: view4 ? Math.sqrt(Math.max(row.R ** 2 - view4.w0 ** 2, 0)) : row.R,
  };
  const ro: Vec3 = [
    Math.fround(pose.ro[0]),
    Math.fround(pose.ro[1]),
    Math.fround(pose.ro[2]),
  ];
  let hits = 0;
  let sampled = 0;
  for (
    let py = FRAME_SANITY_STRIDE >> 1;
    py < pose.rasterHeight;
    py += FRAME_SANITY_STRIDE
  ) {
    for (
      let px = FRAME_SANITY_STRIDE >> 1;
      px < pose.rasterWidth;
      px += FRAME_SANITY_STRIDE
    ) {
      const rd = sphereInversionUnprojectRay(
        inv,
        px,
        py,
        pose.rasterWidth,
        pose.rasterHeight,
      );
      if (sphereInversionCpuMarch(sub, ro, rd, SI_BENCH_PIXEL_EPS).status === 1)
        hits++;
      sampled++;
    }
  }
  return hits / Math.max(1, sampled);
}

async function runFrames(
  ctx: SphereInversionBenchContext,
  rows: SiBenchRow[],
  out: SphereInversionBenchResults,
): Promise<void> {
  const width = ctx.software ? FRAME_WIDTH_SW : FRAME_WIDTH;
  const height = ctx.software ? FRAME_HEIGHT_SW : FRAME_HEIGHT;
  const budgetMs = ctx.software ? FRAME_BUDGET_SW_MS : FRAME_BUDGET_MS;
  const palette: Vec3[] = [
    [0.85, 0.55, 0.25],
    [0.3, 0.6, 0.9],
    [0.6, 0.85, 0.4],
    [0.9, 0.35, 0.5],
  ];
  const plans: {
    row: string;
    groundPlane: boolean;
    views: { label: string; view4: SurfaceGpu4View | null }[];
  }[] = [
    {
      row: "siOct6Pearls3",
      groundPlane: true,
      views: [{ label: "si-frame-3d-plane", view4: null }],
    },
    {
      row: "si600Medallion4@WKISS",
      groundPlane: false,
      views: [
        { label: "si-frame-4d", view4: null },
        {
          label: "si-frame-4d-view2",
          view4: sphereInversionBenchView4(
            sphereInversionBenchFixtures().find(
              (f) => f.name === "si600Medallion4@XW.4YW.3ZW.2",
            )!,
          ),
        },
      ],
    },
  ];
  for (const plan of plans) {
    const row = rows.find((r) => r.fixture.name === plan.row);
    if (!row) {
      out.failed = true;
      out.notes.push(`sphere-inversion frame ${plan.row}: row missing`);
      continue;
    }
    const slots = row.de.depth + 3;
    const colors = Array.from(
      { length: slots },
      (_, i) => palette[i % palette.length],
    );
    const trapIndices = Array.from({ length: slots }, (_, i) => i);
    let renderer: SurfaceComputeRenderer | null = null;
    try {
      ctx.status(
        `sphere-inversion frame ${plan.row}: creating SurfaceComputeRenderer…`,
      );
      renderer = await SurfaceComputeRenderer.create(
        row.dim === 3
          ? {
              kind: "sphereInversion",
              de: row.de,
              groundPlane: plan.groundPlane,
            }
          : {
              kind: "sphereInversion4",
              de: row.de,
              groundPlane: plan.groundPlane,
            },
        colors,
        trapIndices,
      );
      for (const view of plan.views) {
        const view4 = row.dim === 4 ? (view.view4 ?? row.view4) : null;
        const pose = sphereInversionBenchPose(row, width, height);
        const inv = sphereInversionInvProjView(row, pose);
        const R = row.R;
        const spec: SurfaceComputeFrameSpec = {
          width,
          height,
          invProjView: inv,
          camPos: pose.ro,
          camForward: pose.fwd,
          focusDepth: -(
            pose.ro[0] * pose.fwd[0] +
            pose.ro[1] * pose.fwd[1] +
            pose.ro[2] * pose.fwd[2]
          ),
          acceptPixelEps: SI_BENCH_PIXEL_EPS,
          tracePixelEps: (2 * Math.tan((60 * Math.PI) / 360)) / height,
          maxDepth: row.de.depth,
          marchSteps: SI_BENCH_MARCH_STEPS,
          shadowSteps: 32,
          aoTaps: 5,
          hitFloor: SURFACE_GPU_HIT_FLOOR,
          lightDir: [0.5 / 1.0, 0.8, 0.3].map(
            (v, _, a) => v / Math.hypot(...a),
          ) as Vec3,
          ambient: 0.25,
          bgTop: [0, 0, 0],
          bgBottom: [0, 0, 0],
          colorSource: 0,
          colorSpeed: 0.5,
          lut: null,
          lutVersion: 0,
          dither: true,
          ...(view4 ? { view4 } : {}),
          ...(plan.groundPlane
            ? {
                groundPlane: {
                  y: -R * 1.02,
                  fadeStart: R * 4,
                  fadeEnd: R * 10,
                  ballCenter: [0, 0, 0] as Vec3,
                  ballRadius: R,
                  albedo: [0.62, 0.62, 0.62] as Vec3,
                },
              }
            : {}),
        };
        ctx.status(
          `sphere-inversion frame ${view.label}: rendering ${width}x${height}…`,
        );
        const frame = await renderer.renderFrame(spec, {
          budgetMs,
          onProgress: (pixels) =>
            ctx.onFrame?.(
              view.label,
              `${view.label} — ${row.fixture.name}`,
              pixels,
              width,
              height,
            ),
        });
        if (!frame)
          throw new Error(`renderFrame resolved null (${view.label})`);
        ctx.onFrame?.(
          view.label,
          `${view.label} — ${row.fixture.name}`,
          frame.pixels,
          width,
          height,
        );
        const gpuHitRate = frame.counts.hit / (width * height);
        const cpuHitRate = frameSanityRate(row, pose, inv, view4);
        const reasons: string[] = [];
        if (frame.counts.hit === 0 && !(ctx.software && frame.truncated))
          reasons.push("no hit rays");
        if (!ctx.software) {
          if (frame.truncated) reasons.push("truncated on a real adapter");
          if (frame.counts.miss + frame.counts.plane === 0)
            reasons.push("no miss rays");
          if (frame.counts.exhausted > 0)
            reasons.push(`${frame.counts.exhausted} exhausted rays`);
          if (frame.counts.active > 0)
            reasons.push(`${frame.counts.active} active rays`);
        }
        if (
          !frame.truncated &&
          Math.abs(gpuHitRate - cpuHitRate) > FRAME_SANITY_TOL
        ) {
          reasons.push(
            `hit-rate gap ${Math.abs(gpuHitRate - cpuHitRate).toFixed(3)} vs the CPU sanity march`,
          );
        }
        const result: SiFrameRow = {
          system: row.fixture.name,
          label: view.label,
          width,
          height,
          wallMs: frame.wallMs,
          gpuMs: frame.gpuMs,
          passes: frame.passes,
          truncated: frame.truncated,
          counts: { ...frame.counts },
          gpuHitRate,
          cpuHitRate,
          pass: reasons.length === 0,
          ...(reasons.length ? { reason: reasons.join("; ") } : {}),
        };
        out.frames.push(result);
        if (!result.pass) {
          out.failed = true;
          out.notes.push(
            `sphere-inversion frame ${view.label}: ${result.reason}`,
          );
        }
        ctx.update?.(out);
      }
    } catch (e) {
      out.failed = true;
      out.notes.push(`sphere-inversion frame ${plan.row}: ${describe(e)}`);
    } finally {
      renderer?.destroy();
    }
  }
}

/**
 * µs per query over WHOLE TILES of a row's query mix, so the figure is the
 * mix's cost and never one query class's (the mix is ordered by class, and
 * a production-width fold batch cut from its front measured ~10x a whole
 * tile). Submissions are sized from a small pilot spread across the mix and
 * refined on larger batches until the size settles, so a fast core's
 * per-submission overhead is negligible and a slow core's submission stays
 * near {@link TIMING_TARGET_MS}, far from a driver watchdog. A software
 * adapter times one tile once.
 */
async function timeEval(
  ctx: SphereInversionBenchContext,
  name: string,
  core: string,
  code: string,
  packAt: (count: number) => ArrayBuffer,
  maps: Float32Array,
  queries: readonly Vec3[],
): Promise<SiTimingRow> {
  const { pipeline } = await compile(
    ctx.device,
    code,
    "evalQueries",
    `si timing ${name}`,
  );
  const mix = queries.length;
  const spread = Array.from(
    { length: TIMING_PILOT },
    (_, i) => queries[Math.floor((i * mix) / TIMING_PILOT)],
  );
  const run = (count: number, offset: number, qs: readonly Vec3[] = queries) =>
    runEval(
      ctx.device,
      pipeline,
      packAt(count),
      maps,
      qs,
      count,
      false,
      offset,
    );
  const sizeFor = (perQueryMs: number): number =>
    Math.min(
      TIMING_MAX,
      Math.max(
        TIMING_MIN,
        Math.floor(TIMING_TARGET_MS / Math.max(perQueryMs, 1e-7)),
      ),
    );
  let chunk = sizeFor((await run(TIMING_PILOT, 0, spread)).ms / TIMING_PILOT);
  if (!ctx.software) {
    for (let refine = 0; refine < 4; refine++) {
      const next = sizeFor((await run(chunk, 0)).ms / chunk);
      const settled = next <= chunk * 2;
      chunk = Math.min(next, chunk * 4);
      if (settled) break;
    }
  } else {
    chunk = Math.min(chunk, mix);
  }
  const total = Math.ceil(Math.max(chunk, mix) / mix) * mix;
  const samples: number[] = [];
  for (let rep = 0; rep < (ctx.software ? 1 : TIMING_REPS); rep++) {
    let ms = 0;
    for (let offset = 0; offset < total; offset += chunk) {
      ms += (await run(Math.min(chunk, total - offset), offset % mix)).ms;
    }
    samples.push(ms);
  }
  samples.sort((x, y) => x - y);
  return {
    name,
    core,
    queries: total,
    submission: chunk,
    usPerQuery: (samples[samples.length >> 1] * 1000) / total,
  };
}

async function runTiming(
  ctx: SphereInversionBenchContext,
  rows: SiBenchRow[],
  out: SphereInversionBenchResults,
): Promise<void> {
  for (const name of TIMING_ROWS) {
    const row = rows.find((r) => r.fixture.name === name);
    if (!row) continue;
    ctx.status(`sphere-inversion timing: ${name}…`);
    try {
      const tables = packSphereInversionGpuTables(row.de);
      out.timing.push(
        await timeEval(
          ctx,
          name,
          coreOf(row),
          surfaceDeKernelWgsl(kernelOptions(coreOf(row), {})),
          (count) => packParams(row, tables, { itemCount: count, cutoff: 0 }),
          tables.data,
          row.queries,
        ),
      );
      // THE uniformUnit-OFF PENALTY: the same row, tables and queries with
      // the flag cleared, so the kernel takes the linear first-containing
      // scan instead of the unit arrangement's radial reject and nearest-
      // centre pick. The linear arm is correct for ANY construction, which is
      // what makes it the fair control; no shipped document reaches it.
      if (tables.uniformUnit) {
        const linear = { ...tables, uniformUnit: false, uniformRadius: 0 };
        out.timing.push(
          await timeEval(
            ctx,
            `${name} linear`,
            coreOf(row),
            surfaceDeKernelWgsl(kernelOptions(coreOf(row), {})),
            (count) => packParams(row, linear, { itemCount: count, cutoff: 0 }),
            linear.data,
            row.queries,
          ),
        );
      }
    } catch (e) {
      out.notes.push(
        `sphere-inversion timing ${name}: ${describe(e)} (informational)`,
      );
    }
    ctx.update?.(out);
  }
  for (const subject of ctx.timingSubjects ?? []) {
    ctx.status(`sphere-inversion timing: ${subject.name} (comparison)…`);
    try {
      out.timing.push(
        await timeEval(
          ctx,
          subject.name,
          subject.core,
          subject.code,
          subject.packParams,
          subject.maps,
          subject.queries,
        ),
      );
    } catch (e) {
      out.notes.push(
        `sphere-inversion timing ${subject.name}: ${describe(e)} (informational)`,
      );
    }
    ctx.update?.(out);
  }
}

/** Run every sphere-inversion leg on the section's device. Never throws:
 * a failure lands in `notes` and sets `failed`. */
export async function runSphereInversionBench(
  ctx: SphereInversionBenchContext,
): Promise<SphereInversionBenchResults> {
  const out: SphereInversionBenchResults = {
    compile: [],
    eval: [],
    march: [],
    frames: [],
    timing: [],
    notes: [],
    failed: false,
  };
  let rows: SiBenchRow[];
  try {
    ctx.status("sphere-inversion: building fixtures and the CPU oracle…");
    await yieldToPage();
    rows = buildSphereInversionBenchRows();
  } catch (e) {
    out.failed = true;
    out.notes.push(`sphere-inversion fixtures: ${describe(e)}`);
    return out;
  }
  await runCompileMatrix(ctx, out);
  await runEvalLegs(ctx, rows, out);
  for (const name of MARCH_ROWS) {
    const row = rows.find((r) => r.fixture.name === name);
    if (!row) continue;
    try {
      const result = await marchRows(ctx, row);
      out.march.push(result);
      if (!result.pass) {
        out.failed = true;
        out.notes.push(
          `sphere-inversion march ${name}: failures=${result.failures} truncated=${result.truncated} ` +
            `hits gpu=${result.gpuHits} cpu=${result.cpuHits}/${result.rays}`,
        );
      }
    } catch (e) {
      out.failed = true;
      out.notes.push(`sphere-inversion march ${name}: ${describe(e)}`);
    }
    ctx.update?.(out);
    await yieldToPage();
  }
  await runFrames(ctx, rows, out);
  await runTiming(ctx, rows, out);
  return out;
}
