/**
 * SPIKE (fr-53k, throwaway): benchmark page comparing the CPU flame worker's
 * chaos-game accumulation (`src/fractal/flame.ts`'s `accumulateFlame`) against
 * the WebGPU compute-shader port (`./engine.ts` driving `./kernel.ts`) on the
 * same systems and seed-class. Served at /gpu-spike/index.html by `npm run
 * dev`; not part of the production build (see vite.config.ts — only the root
 * index.html is a build input).
 *
 * Three things happen per scenario, each a SEPARATE accumulation (see (c)
 * below): a timed CPU run, a timed GPU run, and an equal-iteration-count
 * visual comparison. Results are exposed on `window.__BENCH_RESULTS__` for
 * both interactive use and the headless runner (`scripts/gpu-flame-bench.mjs`).
 */
import * as THREE from "three";
import { prepareChaosGame } from "../../fractal/chaos-game";
import type { PreparedChaosGame } from "../../fractal/chaos-game";
import { transformColors } from "../../fractal/color";
import {
  accumulateFlame,
  downsampleFlame,
  tonemapFlame,
  DEFAULT_GAMMA_THRESHOLD,
} from "../../fractal/flame";
import type { FlameHistogram, Mat4, TonemapParams } from "../../fractal/flame";
import { buildPaletteLUT } from "../../fractal/palette";
import type { FlamePaletteId } from "../../fractal/palette";
import {
  barnsleyFern,
  sierpinskiTetrahedron,
  swirlFlame,
} from "../../fractal/presets";
import { mulberry32 } from "../../fractal/rng";
import type { SymmetryParams, Transform, Vec3 } from "../../fractal/types";
import {
  DEFAULT_FLAME_EXPOSURE,
  DEFAULT_FLAME_GAMMA,
  DEFAULT_FLAME_VIBRANCY,
} from "../state";
import { GpuFlameAccumulator } from "./engine";
import type { GpuFlameSystem } from "./engine";

// ---------------------------------------------------------------------------
// Window surface for the headless runner
// ---------------------------------------------------------------------------

interface BenchAdapterInfo {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
}

interface TimedResult {
  iterations: number;
  ms: number;
  itersPerSec: number;
}

interface TimedGpuResult extends TimedResult {
  /** Total dispatchWorkgroups calls issued across every adaptively-sized batch. */
  dispatches: number;
}

interface SkippedResult {
  skipped: string;
}

interface ComparisonMetrics {
  /** Mean |Δ| over every R/G/B sample (0-255 scale) between the CPU and GPU
   * tone-mapped images. */
  maeRGB: number;
  /** Mean SIGNED per-channel delta (CPU - GPU), each averaged over all pixels. */
  biasRGB: [number, number, number];
  maxAbs: number;
  /** `maxHits` of the ACCUMULATION (not display) histograms. */
  maxHitsCpu: number;
  maxHitsGpu: number;
  /** True when the GPU run's fixed-point color channels (capacity ~16.7M —
   * see kernel.ts) are close enough to overflow to be worth flagging. */
  overflowWarning: boolean;
}

interface ScenarioResultRecord {
  name: string;
  cpu: TimedResult;
  gpu: TimedGpuResult | SkippedResult;
  comparison: ComparisonMetrics | SkippedResult;
}

interface BenchResults {
  userAgent: string;
  timestamp: string;
  adapter: BenchAdapterInfo | null;
  scenarios: ScenarioResultRecord[];
}

declare global {
  interface Window {
    __BENCH_RESULTS__?: BenchResults;
    __BENCH_DONE__?: boolean;
    __BENCH_ERROR__?: string;
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface ScenarioDef {
  name: string;
  transforms: Transform[];
  finalTransform: Transform | null;
  symmetry: SymmetryParams;
  paletteId: FlamePaletteId;
  cameraPos: [number, number, number];
  lookAt: [number, number, number];
}

const SIERPINSKI_CAMERA: Pick<ScenarioDef, "cameraPos" | "lookAt"> = {
  cameraPos: [2.5, 1.8, 2.5],
  lookAt: [0, 0.4, 0],
};

const SCENARIOS: ScenarioDef[] = [
  {
    name: "sierpinski",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 1, axis: "y" },
    paletteId: "legacy",
    ...SIERPINSKI_CAMERA,
  },
  {
    name: "fern",
    transforms: barnsleyFern(),
    finalTransform: null,
    symmetry: { order: 1, axis: "y" },
    paletteId: "ember",
    // The preset re-centers Barnsley's coordinates (FERN_SCALE 0.3 around
    // FERN_CENTER — see presets.ts), so the fern spans roughly ±0.75 x ±1.5
    // around the origin; a straight-on close camera frames it fully.
    cameraPos: [0, 0, 4.2],
    lookAt: [0, 0, 0],
  },
  {
    name: "swirl",
    transforms: swirlFlame(),
    finalTransform: null,
    symmetry: { order: 1, axis: "y" },
    paletteId: "spectrum",
    cameraPos: [2.6, 1.9, 2.6],
    lookAt: [0, 0, 0],
  },
  {
    name: "kaleido",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 5, axis: "y" },
    paletteId: "aurora",
    ...SIERPINSKI_CAMERA,
  },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed seed shared by every CPU rng and GPU engine — same seed-class, not
 * byte-identical orbits (see kernel.ts's doc for why GPU chains diverge). */
const SEED = 0xc0ffee;

const DISPLAY_WIDTH = 960;
const DISPLAY_HEIGHT = 540;
const SUPERSAMPLE = 2;
const ACCUM_WIDTH = DISPLAY_WIDTH * SUPERSAMPLE;
const ACCUM_HEIGHT = DISPLAY_HEIGHT * SUPERSAMPLE;

const CPU_CHUNK_ITERATIONS = 2_000_000;
const DOWNSAMPLE_FILTER_RADIUS = 0.4;

/** The app's default flame tone-map (state.ts) — see FlameParams' doc. */
const TONEMAP_PARAMS: TonemapParams = {
  exposure: DEFAULT_FLAME_EXPOSURE,
  gamma: DEFAULT_FLAME_GAMMA,
  gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
  vibrancy: DEFAULT_FLAME_VIBRANCY,
};

/** Equal-N comparison target: 65536 chains (GpuFlameAccumulator's default
 * numChains) x 256 iters/invocation x 3 dispatches = 50,331,648. */
const EQUAL_N_ITERS_PER_INVOCATION = 256;
const EQUAL_N_DISPATCHES = 3;
const EQUAL_N_ITERATIONS =
  65536 * EQUAL_N_ITERS_PER_INVOCATION * EQUAL_N_DISPATCHES;

/** Fixed-point color capacity is ~16.7M (2^32 / 256 — see kernel.ts); warn
 * well before a hot bucket could actually wrap. */
const OVERFLOW_WARNING_THRESHOLD = 12_000_000;

const SOFTWARE_ADAPTER_RE = /swiftshader|llvmpipe|software/i;

const ADAPTIVE_BATCH_TARGET_MS = 250;
const ADAPTIVE_BATCH_MIN_DISPATCHES = 1;
const ADAPTIVE_BATCH_MAX_DISPATCHES = 64;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function requireElement<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`[gpu-spike] index.html is missing #${id}`);
  }
  return el as unknown as T;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Same recipe as `scene.ts`'s `flameProjectionMatrix`: a frozen camera's
 * combined projection*view, row-major-flattened (`Mat4`'s convention).
 */
function buildProjection(
  width: number,
  height: number,
  position: [number, number, number],
  lookAt: [number, number, number],
): Mat4 {
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
  camera.updateMatrixWorld();
  const combined = camera.projectionMatrix
    .clone()
    .multiply(camera.matrixWorldInverse);
  return Array.from(combined.transpose().elements);
}

function toGpuSystem(def: ScenarioDef): GpuFlameSystem {
  return {
    transforms: def.transforms,
    finalTransform: def.finalTransform,
    symmetry: def.symmetry,
    paletteId: def.paletteId,
  };
}

function drawImage(
  canvas: HTMLCanvasElement,
  image: Uint8ClampedArray<ArrayBuffer>,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.putImageData(new ImageData(image, canvas.width, canvas.height), 0, 0);
}

// ---------------------------------------------------------------------------
// CPU accumulation
// ---------------------------------------------------------------------------

interface CpuPrepared {
  prepared: PreparedChaosGame;
  palette: Vec3[];
  lut: Float32Array | undefined;
}

function prepareCpu(def: ScenarioDef): CpuPrepared {
  return {
    prepared: prepareChaosGame(
      def.transforms,
      def.finalTransform,
      def.symmetry,
    ),
    palette: transformColors(def.transforms.length),
    lut: buildPaletteLUT(def.paletteId) ?? undefined,
  };
}

/** Accumulate in CPU_CHUNK_ITERATIONS-sized chunks until Σcall-time reaches
 * `durationSec`, yielding to the event loop between chunks. */
async function runCpuTimed(
  cpu: CpuPrepared,
  projection: Mat4,
  durationSec: number,
): Promise<TimedResult> {
  const rng = mulberry32(SEED);
  let histogram: FlameHistogram | undefined;
  let iterations = 0;
  let ms = 0;
  const targetMs = durationSec * 1000;
  while (ms < targetMs) {
    const t0 = performance.now();
    histogram = accumulateFlame(
      cpu.prepared,
      projection,
      ACCUM_WIDTH,
      ACCUM_HEIGHT,
      CPU_CHUNK_ITERATIONS,
      rng,
      cpu.palette,
      histogram,
      cpu.lut,
    );
    ms += performance.now() - t0;
    iterations += CPU_CHUNK_ITERATIONS;
    await new Promise<void>((resolve) => setTimeout(resolve));
  }
  return { iterations, ms, itersPerSec: iterations / (ms / 1000) };
}

/** Accumulate exactly `totalIterations`, split into CPU_CHUNK_ITERATIONS
 * chunks with a final partial chunk — a fresh histogram/rng, independent of
 * any timed run (see the module doc: timed and equal-N runs never share a
 * histogram). Always runs at least one chunk, so unlike the timed run above,
 * this returns a definite (non-optional) FlameHistogram. */
async function runCpuExactly(
  cpu: CpuPrepared,
  projection: Mat4,
  totalIterations: number,
): Promise<FlameHistogram> {
  const rng = mulberry32(SEED);
  const firstChunk = Math.min(CPU_CHUNK_ITERATIONS, totalIterations);
  let histogram = accumulateFlame(
    cpu.prepared,
    projection,
    ACCUM_WIDTH,
    ACCUM_HEIGHT,
    firstChunk,
    rng,
    cpu.palette,
    undefined,
    cpu.lut,
  );
  let remaining = totalIterations - firstChunk;
  while (remaining > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve));
    const n = Math.min(CPU_CHUNK_ITERATIONS, remaining);
    histogram = accumulateFlame(
      cpu.prepared,
      projection,
      ACCUM_WIDTH,
      ACCUM_HEIGHT,
      n,
      rng,
      cpu.palette,
      histogram,
      cpu.lut,
    );
    remaining -= n;
  }
  return histogram;
}

// ---------------------------------------------------------------------------
// GPU accumulation
// ---------------------------------------------------------------------------

/** Timed GPU run: adaptive batching targeting ~250ms/batch. Skips gracefully
 * (returns `{ skipped }`) rather than throwing when WebGPU is unavailable, so
 * the page stays usable in non-WebGPU browsers. */
async function runGpuTimed(
  def: ScenarioDef,
  projection: Mat4,
  durationSec: number,
): Promise<TimedGpuResult | SkippedResult> {
  let engine: GpuFlameAccumulator;
  try {
    engine = await GpuFlameAccumulator.create(toGpuSystem(def), {
      width: ACCUM_WIDTH,
      height: ACCUM_HEIGHT,
      projection,
      seed: SEED,
    });
  } catch (e) {
    return { skipped: describeError(e) };
  }
  try {
    await engine.warmup();
    let dispatches = 2;
    let iterations = 0;
    let ms = 0;
    let totalDispatches = 0;
    const targetMs = durationSec * 1000;
    while (ms < targetMs) {
      const batch = await engine.runBatch(dispatches);
      iterations += batch.iterations;
      ms += batch.ms;
      totalDispatches += dispatches;
      dispatches = clamp(
        Math.round((dispatches * ADAPTIVE_BATCH_TARGET_MS) / batch.ms),
        ADAPTIVE_BATCH_MIN_DISPATCHES,
        ADAPTIVE_BATCH_MAX_DISPATCHES,
      );
    }
    return {
      iterations,
      ms,
      itersPerSec: iterations / (ms / 1000),
      dispatches: totalDispatches,
    };
  } finally {
    engine.destroy();
  }
}

/** Equal-N comparison run: a FRESH engine (independent of `runGpuTimed`'s),
 * itersPerInvocation lowered to 256 so EQUAL_N_DISPATCHES batches lands on
 * EQUAL_N_ITERATIONS exactly. Destroyed only after `readHistogram` resolves. */
async function runGpuEqualN(
  def: ScenarioDef,
  projection: Mat4,
): Promise<{ histogram: FlameHistogram } | SkippedResult> {
  let engine: GpuFlameAccumulator;
  try {
    engine = await GpuFlameAccumulator.create(toGpuSystem(def), {
      width: ACCUM_WIDTH,
      height: ACCUM_HEIGHT,
      projection,
      seed: SEED,
      itersPerInvocation: EQUAL_N_ITERS_PER_INVOCATION,
    });
  } catch (e) {
    return { skipped: describeError(e) };
  }
  try {
    await engine.warmup();
    await engine.runBatch(EQUAL_N_DISPATCHES);
    const histogram = await engine.readHistogram();
    return { histogram };
  } finally {
    engine.destroy();
  }
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function buildDiffImage(
  cpuImage: Uint8ClampedArray<ArrayBuffer>,
  gpuImage: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): {
  diffImage: Uint8ClampedArray<ArrayBuffer>;
  maeRGB: number;
  biasRGB: [number, number, number];
  maxAbs: number;
} {
  const diffImage = new Uint8ClampedArray(width * height * 4);
  const count = width * height;
  let sumAbs = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let maxAbs = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const dr = cpuImage[o] - gpuImage[o];
    const dg = cpuImage[o + 1] - gpuImage[o + 1];
    const db = cpuImage[o + 2] - gpuImage[o + 2];
    sumR += dr;
    sumG += dg;
    sumB += db;
    const ar = Math.abs(dr);
    const ag = Math.abs(dg);
    const ab = Math.abs(db);
    sumAbs += ar + ag + ab;
    maxAbs = Math.max(maxAbs, ar, ag, ab);
    diffImage[o] = ar * 4;
    diffImage[o + 1] = ag * 4;
    diffImage[o + 2] = ab * 4;
    diffImage[o + 3] = 255;
  }
  return {
    diffImage,
    maeRGB: sumAbs / (count * 3),
    biasRGB: [sumR / count, sumG / count, sumB / count],
    maxAbs,
  };
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

interface ScenarioDom {
  status: HTMLElement;
  cpuCanvas: HTMLCanvasElement;
  gpuCanvas: HTMLCanvasElement;
  diffCanvas: HTMLCanvasElement;
  pre: HTMLPreElement;
}

function makeCanvasBlock(row: HTMLElement, label: string): HTMLCanvasElement {
  const block = document.createElement("div");
  block.className = "canvas-block";
  const canvas = document.createElement("canvas");
  canvas.width = DISPLAY_WIDTH;
  canvas.height = DISPLAY_HEIGHT;
  block.appendChild(canvas);
  const span = document.createElement("span");
  span.textContent = label;
  block.appendChild(span);
  row.appendChild(block);
  return canvas;
}

function buildScenarioDom(
  def: ScenarioDef,
  container: HTMLElement,
): ScenarioDom {
  const root = document.createElement("div");
  root.className = "scenario";

  const heading = document.createElement("h2");
  heading.textContent = `${def.name} — `;
  const status = document.createElement("span");
  status.className = "status";
  status.textContent = "idle";
  heading.appendChild(status);
  root.appendChild(heading);

  const canvasesRow = document.createElement("div");
  canvasesRow.className = "canvases";
  const cpuCanvas = makeCanvasBlock(canvasesRow, "CPU");
  const gpuCanvas = makeCanvasBlock(canvasesRow, "GPU");
  const diffCanvas = makeCanvasBlock(canvasesRow, "Diff (×4)");
  root.appendChild(canvasesRow);

  const pre = document.createElement("pre");
  root.appendChild(pre);

  container.appendChild(root);
  return { status, cpuCanvas, gpuCanvas, diffCanvas, pre };
}

function setStatus(dom: ScenarioDom, text: string): void {
  dom.status.textContent = text;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function runScenario(
  def: ScenarioDef,
  dom: ScenarioDom,
  durationSec: number,
): Promise<ScenarioResultRecord> {
  const projection = buildProjection(
    ACCUM_WIDTH,
    ACCUM_HEIGHT,
    def.cameraPos,
    def.lookAt,
  );
  const cpu = prepareCpu(def);

  setStatus(dom, "running: cpu timed…");
  const cpuTimed = await runCpuTimed(cpu, projection, durationSec);

  setStatus(dom, "running: gpu timed…");
  const gpuTimed = await runGpuTimed(def, projection, durationSec);

  setStatus(dom, "running: equal-N comparison…");
  const cpuHist = await runCpuExactly(cpu, projection, EQUAL_N_ITERATIONS);
  const cpuDisplay = downsampleFlame(
    cpuHist,
    DISPLAY_WIDTH,
    DISPLAY_HEIGHT,
    DOWNSAMPLE_FILTER_RADIUS,
  );
  const cpuImage = tonemapFlame(cpuDisplay, TONEMAP_PARAMS);
  drawImage(dom.cpuCanvas, cpuImage);

  let comparison: ComparisonMetrics | SkippedResult;
  if ("skipped" in gpuTimed) {
    comparison = { skipped: gpuTimed.skipped };
  } else {
    const gpuEqualN = await runGpuEqualN(def, projection);
    if ("skipped" in gpuEqualN) {
      comparison = { skipped: gpuEqualN.skipped };
    } else {
      const gpuDisplay = downsampleFlame(
        gpuEqualN.histogram,
        DISPLAY_WIDTH,
        DISPLAY_HEIGHT,
        DOWNSAMPLE_FILTER_RADIUS,
      );
      const gpuImage = tonemapFlame(gpuDisplay, TONEMAP_PARAMS);
      drawImage(dom.gpuCanvas, gpuImage);
      const diff = buildDiffImage(
        cpuImage,
        gpuImage,
        DISPLAY_WIDTH,
        DISPLAY_HEIGHT,
      );
      drawImage(dom.diffCanvas, diff.diffImage);
      comparison = {
        maeRGB: diff.maeRGB,
        biasRGB: diff.biasRGB,
        maxAbs: diff.maxAbs,
        maxHitsCpu: cpuHist.maxHits,
        maxHitsGpu: gpuEqualN.histogram.maxHits,
        overflowWarning:
          gpuEqualN.histogram.maxHits > OVERFLOW_WARNING_THRESHOLD,
      };
    }
  }

  const result: ScenarioResultRecord = {
    name: def.name,
    cpu: cpuTimed,
    gpu: gpuTimed,
    comparison,
  };
  setStatus(dom, "done");
  dom.pre.textContent = JSON.stringify(result, null, 2);
  return result;
}

async function probeAdapter(): Promise<BenchAdapterInfo | null> {
  if (!navigator.gpu) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const info = adapter.info;
    return {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
    };
  } catch {
    return null;
  }
}

function isSoftwareAdapter(adapter: BenchAdapterInfo): boolean {
  // Chrome's SwiftShader fallback (the common case in a headless/no-GPU CI
  // box — see scripts/gpu-flame-bench.mjs) reports the tell in `architecture`
  // ("swiftshader"), often leaving `description` empty — so all three fields
  // are checked, not just description/vendor.
  return (
    SOFTWARE_ADAPTER_RE.test(adapter.description) ||
    SOFTWARE_ADAPTER_RE.test(adapter.vendor) ||
    SOFTWARE_ADAPTER_RE.test(adapter.architecture)
  );
}

function renderAdapterBanner(
  banner: HTMLElement,
  adapter: BenchAdapterInfo | null,
): void {
  if (!navigator.gpu) {
    banner.textContent =
      "WebGPU is not available in this browser (navigator.gpu is undefined).";
    banner.classList.add("warning");
    return;
  }
  if (!adapter) {
    banner.textContent =
      "navigator.gpu.requestAdapter() returned null — no compatible GPU adapter.";
    banner.classList.add("warning");
    return;
  }
  const line = `adapter: vendor="${adapter.vendor}" architecture="${adapter.architecture}" device="${adapter.device}" description="${adapter.description}"`;
  if (isSoftwareAdapter(adapter)) {
    banner.textContent = `WARNING: software/CPU WebGPU adapter detected — GPU numbers will not be representative of real hardware.\n${line}`;
    banner.classList.add("warning");
  } else {
    banner.textContent = line;
  }
}

async function main(): Promise<void> {
  const banner = requireElement<HTMLDivElement>("adapterBanner");
  const durationInput = requireElement<HTMLInputElement>("durationInput");
  const runAllBtn = requireElement<HTMLButtonElement>("runAllBtn");
  const scenarioButtons = requireElement<HTMLDivElement>("scenarioButtons");
  const scenariosContainer = requireElement<HTMLDivElement>("scenarios");
  const resultsPre = requireElement<HTMLPreElement>("results");

  const params = new URLSearchParams(window.location.search);
  const autorun = params.get("autorun") === "1";
  const durationParam = params.get("duration");
  if (durationParam) durationInput.value = durationParam;
  const scenariosParam = params.get("scenarios");
  const filterNames = scenariosParam
    ? new Set(
        scenariosParam
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      )
    : null;
  const activeScenarios = filterNames
    ? SCENARIOS.filter((s) => filterNames.has(s.name))
    : SCENARIOS;

  const benchResults: BenchResults = {
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    adapter: null,
    scenarios: [],
  };
  window.__BENCH_RESULTS__ = benchResults;

  function renderResults(): void {
    resultsPre.textContent = JSON.stringify(benchResults, null, 2);
  }

  function recordResult(result: ScenarioResultRecord): void {
    const idx = benchResults.scenarios.findIndex((r) => r.name === result.name);
    if (idx >= 0) benchResults.scenarios[idx] = result;
    else benchResults.scenarios.push(result);
    renderResults();
  }

  const domByName = new Map<string, ScenarioDom>();
  for (const def of activeScenarios) {
    domByName.set(def.name, buildScenarioDom(def, scenariosContainer));
  }

  function currentDuration(): number {
    const v = Number(durationInput.value);
    return Number.isFinite(v) && v > 0 ? v : 4;
  }

  function setButtonsDisabled(disabled: boolean): void {
    runAllBtn.disabled = disabled;
    for (const btn of scenarioButtons.querySelectorAll("button")) {
      btn.disabled = disabled;
    }
  }

  let running = false;

  async function runOne(def: ScenarioDef): Promise<void> {
    if (running) return;
    running = true;
    setButtonsDisabled(true);
    try {
      const dom = domByName.get(def.name);
      if (!dom) return;
      recordResult(await runScenario(def, dom, currentDuration()));
    } finally {
      running = false;
      setButtonsDisabled(false);
    }
  }

  async function runAll(): Promise<void> {
    if (running) return;
    running = true;
    setButtonsDisabled(true);
    try {
      for (const def of activeScenarios) {
        const dom = domByName.get(def.name);
        if (!dom) continue;
        recordResult(await runScenario(def, dom, currentDuration()));
      }
    } finally {
      running = false;
      setButtonsDisabled(false);
    }
  }

  for (const def of activeScenarios) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `Run ${def.name}`;
    btn.addEventListener("click", () => {
      void runOne(def);
    });
    scenarioButtons.appendChild(btn);
  }
  runAllBtn.addEventListener("click", () => {
    void runAll();
  });

  const adapter = await probeAdapter();
  benchResults.adapter = adapter;
  renderAdapterBanner(banner, adapter);
  renderResults();

  if (autorun) {
    await runAll();
    window.__BENCH_DONE__ = true;
  }
}

try {
  await main();
} catch (err) {
  const message = describeError(err);
  window.__BENCH_ERROR__ = message;
  console.error("[gpu-spike] fatal:", err);
  const resultsPre = document.getElementById("results");
  if (resultsPre) resultsPre.textContent = `FATAL ERROR:\n${message}`;
}
