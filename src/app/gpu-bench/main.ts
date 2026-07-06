/**
 * fr-npb: the standing statistical-agreement harness pinning
 * `src/fractal/flame-gpu.ts`'s WGSL kernel (driven by
 * `src/app/flame-gpu-backend.ts`) to `src/fractal/flame.ts`'s
 * `accumulateFlame` — its CPU oracle. Productized from fr-53k's spike page
 * (`git show spike/fr-53k-gpu-flame-accum:src/app/gpu-spike/main.ts`), now
 * driving the SHIPPED backend instead of the spike's standalone engine.
 * Served at /gpu-bench/index.html by `npm run dev`; dev-only — not part of
 * the production build (see vite.config.ts — only the root index.html is a
 * build input).
 *
 * Three things happen per scenario, each a SEPARATE accumulation (see (c)
 * below): a timed CPU run, a timed GPU run, and an equal-iteration-count
 * visual comparison that also doubles as the pass/fail agreement check.
 * Results are exposed on `window.__BENCH_RESULTS__` for both interactive use
 * and the headless runner (`scripts/gpu-flame-bench.mjs`, this repo's CI-able
 * entry point via its `agreement` field) — also the phone-benchmarking path,
 * since the page works interactively over the LAN like any other dev page.
 */
import * as THREE from "three";
import { prepareChaosGame } from "../../fractal/chaos-game";
import type { PreparedChaosGame } from "../../fractal/chaos-game";
import { transformColors } from "../../fractal/color";
import {
  accumulateFlame,
  createFlameHistogram,
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
import { createGpuFlameBackend } from "../flame-gpu-backend";
import { FLAME_FILTER_RADIUS } from "../flame-worker-core";
import type {
  FlameAccumBackend,
  GpuBackendRequest,
} from "../flame-worker-core";

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
  /** Total `backend.accumulate()` calls issued across the timed run. Unlike
   * the spike's "dispatches" count, an individual `dispatchWorkgroups` tally
   * is now an implementation detail fully internal to `flame-gpu-backend.ts`
   * (`planGpuDispatches` can fan one `accumulate()` call out to several) —
   * this counts the unit the PAGE actually controls. */
  calls: number;
  /** `FlameAccumBackend.adapterLabel` — the GPU backend's own best-effort
   * adapter description (see `flame-gpu-backend.ts`'s doc), independent of
   * the page-level adapter probe that drives the banner. `undefined` when it
   * had no better label to offer. */
  adapterLabel?: string;
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
  /** `maeRGB < AGREEMENT_MAE_THRESHOLD && every |biasRGB| <
   * AGREEMENT_BIAS_THRESHOLD` — the agreement CHECK, not just a report; see
   * `computeAgreement` for how this rolls up into the top-level verdict. */
  pass: boolean;
}

/**
 * fr-ee9: the display-downsample agreement leg's metrics — comparing the GPU
 * `snapshotDisplay` kernel's output against `downsampleFlame` fed the exact
 * SAME resident histogram (see `compareDisplayDownsample`'s doc). An
 * EXACTNESS check modulo f32 rounding, not a statistical one like
 * {@link ComparisonMetrics} — hence the much tighter tolerances `pass` above
 * applies.
 */
interface DisplayDownsampleMetrics {
  /** Largest |gpu - cpu| observed over every `hits` bucket. */
  maxAbsHitsError: number;
  /** Largest |gpu - cpu| observed over every `sumRGB` channel. */
  maxAbsColorError: number;
  /** |gpu.maxHits - cpu.maxHits| / cpu.maxHits (or |gpu.maxHits| when
   * cpu.maxHits is exactly 0). */
  maxHitsRelError: number;
  /** Every hits/sumRGB bucket within `max(1e-6, 1e-4 * max(|cpu|, 1))`, AND
   * `maxHitsRelError <= 1e-4`. */
  pass: boolean;
}

/**
 * fr-ee9's acceptance-evidence measurement: how much cheaper a progressive
 * redisplay tick is with the new resident-buffer downsample
 * (`snapshotDisplay`, readback + convert already included) than with the old
 * full-histogram-readback path (`snapshot` + CPU `downsampleFlame`) — see
 * `measureRedisplayCost`'s doc.
 */
interface RedisplayCostMetrics {
  /** Mean ms of `snapshot()` (readback + convert already included) + CPU
   * `downsampleFlame`, over several reps. */
  oldMs: number;
  /** Mean ms of `snapshotDisplay()` (readback + convert already included),
   * over the same number of reps. */
  newMs: number;
  /** `newMs / oldMs` — the new path's cost as a fraction of the old path's;
   * fr-ee9's whole point is this landing well under 1. */
  ratio: number;
}

interface ScenarioResultRecord {
  name: string;
  cpu: TimedResult;
  gpu: TimedGpuResult | SkippedResult;
  comparison: ComparisonMetrics | SkippedResult;
  /** fr-ee9: the display-downsample agreement leg — see
   * `DisplayDownsampleMetrics`'s doc. Skipped under the exact same condition
   * as `comparison` (no GPU backend at all this run). */
  displayDownsample: DisplayDownsampleMetrics | SkippedResult;
  /** fr-ee9: see `RedisplayCostMetrics`'s doc — this scenario's measured
   * redisplay-cost ratio, the bead's acceptance evidence. */
  redisplayCost: RedisplayCostMetrics | SkippedResult;
}

interface BenchResults {
  userAgent: string;
  timestamp: string;
  adapter: BenchAdapterInfo | null;
  scenarios: ScenarioResultRecord[];
  /** fr-ee9: a standalone ss=1 (no supersample) display-downsample agreement
   * check — every `scenarios` entry runs at the same ss=2 accumulation (see
   * `ACCUM_WIDTH`/`ACCUM_HEIGHT`), so this is the only leg exercising
   * `downsampleFlame`'s (and the GPU kernel's) scale-1 pass-through path —
   * see `runSs1DisplayDownsampleCheck`'s doc.
   */
  ss1DisplayDownsample: DisplayDownsampleMetrics | SkippedResult;
  /** "fail" iff any scenario's `comparison.pass`/`displayDownsample.pass`, or
   * the standalone `ss1DisplayDownsample.pass`, is `false`; "pass" only once
   * every one of those has actually run and all passed — including
   * vacuously "skipped" before any scenario has run, or when every GPU leg
   * was skipped (no WebGPU in this browser: see `computeAgreement`'s doc for
   * why that is deliberately NOT a failure). */
  agreement: "pass" | "fail" | "skipped";
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

/** Fixed seed shared by every CPU rng and GPU backend request — same
 * seed-class, not byte-identical orbits (see flame-gpu.ts's module doc for
 * why the GPU's many PCG32 chains diverge from the CPU's single mulberry32
 * orbit). */
const SEED = 0xc0ffee;

const DISPLAY_WIDTH = 960;
const DISPLAY_HEIGHT = 540;
const SUPERSAMPLE = 2;
const ACCUM_WIDTH = DISPLAY_WIDTH * SUPERSAMPLE;
const ACCUM_HEIGHT = DISPLAY_HEIGHT * SUPERSAMPLE;

const CPU_CHUNK_ITERATIONS = 2_000_000;
// Downsample filter radius: imported FLAME_FILTER_RADIUS (flame-worker-core.ts)
// rather than a locally-redeclared copy, so this harness can never silently
// drift from the value production actually blurs progressive frames with —
// see that export's own doc.

/** The app's default flame tone-map (state.ts) — see FlameParams' doc. */
const TONEMAP_PARAMS: TonemapParams = {
  exposure: DEFAULT_FLAME_EXPOSURE,
  gamma: DEFAULT_FLAME_GAMMA,
  gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
  vibrancy: DEFAULT_FLAME_VIBRANCY,
};

/**
 * Equal-N comparison target. `flame-gpu-backend.ts` fixes its chain count at
 * 65,536 (not caller-configurable) and its dispatch planner
 * (`planGpuDispatches`) rounds a request UP to whole invocations — asking
 * for anything other than an exact multiple of the chain count would let
 * that rounding silently inflate the "equal" in equal-N. 16,777,216 =
 * 65,536 chains x 256 iters/invocation is exactly one single-dispatch
 * request (`ceil(16,777,216 / 65,536) = 256`, zero remainder), so calling
 * `accumulate` with this value can never overshoot — verified per call (see
 * `runGpuEqualN`), not just assumed.
 */
const EQUAL_N_CALL_ITERATIONS = 16_777_216;
const EQUAL_N_CALLS = 3;
const EQUAL_N_ITERATIONS = EQUAL_N_CALL_ITERATIONS * EQUAL_N_CALLS; // 50,331,648

/** Agreement thresholds (fr-npb): below these, CPU/GPU output is accepted as
 * the same statistical render (Monte-Carlo shot noise, not divergence) — see
 * `docs/spike-fr-53k-gpu-flame-accum.md`'s measured figures, which sit
 * comfortably under both. */
const AGREEMENT_MAE_THRESHOLD = 1.0;
const AGREEMENT_BIAS_THRESHOLD = 0.3;

const SOFTWARE_ADAPTER_RE = /swiftshader|llvmpipe|software/i;

const ADAPTIVE_BATCH_TARGET_MS = 250;
const ADAPTIVE_BATCH_MIN_ITERATIONS = 100_000;
const ADAPTIVE_BATCH_MAX_ITERATIONS = 2_000_000_000;
/** First timed-run `accumulate()` request — deliberately modest so a slow
 * (e.g. software) adapter's first real batch doesn't blow far past the
 * target before the adaptive loop gets a timing sample to correct from. */
const INITIAL_GPU_BATCH_ITERATIONS = 1_000_000;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function requireElement<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`[gpu-bench] index.html is missing #${id}`);
  }
  return el as unknown as T;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Human-scale throughput, e.g. `15.9 M iter/s` / `413 M iter/s` — matches
 * the live activity badge / status-line wording. `"…"` for a not-yet-known
 * rate (no chunk/call has completed yet). */
function formatRate(itersPerSec: number): string {
  if (!Number.isFinite(itersPerSec) || itersPerSec <= 0) return "…";
  if (itersPerSec >= 1e9) return `${(itersPerSec / 1e9).toFixed(2)} B iter/s`;
  if (itersPerSec >= 1e6) return `${(itersPerSec / 1e6).toFixed(1)} M iter/s`;
  if (itersPerSec >= 1e3) return `${(itersPerSec / 1e3).toFixed(1)} K iter/s`;
  return `${itersPerSec.toFixed(0)} iter/s`;
}

/** Human-scale iteration COUNT (not rate), e.g. `50.3M` — used for the
 * equal-N phase's running "(done/total)" status text. */
function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
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

/** Assemble the production {@link GpuBackendRequest} for a scenario — the
 * GPU counterpart of `prepareCpu`'s CPU-side setup. */
function toGpuBackendRequest(
  def: ScenarioDef,
  projection: Mat4,
): GpuBackendRequest {
  return {
    transforms: def.transforms,
    finalTransform: def.finalTransform,
    order: def.symmetry.order,
    axis: def.symmetry.axis,
    paletteId: def.paletteId,
    projection,
    width: ACCUM_WIDTH,
    height: ACCUM_HEIGHT,
    seed: SEED,
    displayWidth: DISPLAY_WIDTH,
    displayHeight: DISPLAY_HEIGHT,
    progressiveFilterRadius: FLAME_FILTER_RADIUS,
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
// Live-progress plumbing (activity badge / status line)
// ---------------------------------------------------------------------------

/**
 * Fired strictly BETWEEN timed windows — after one chunk/call's
 * `accumulateFlame`/`backend.accumulate` has returned and before the next
 * one starts — so wiring this up can never add work inside what's actually
 * timed; the running numbers it reports are themselves derived only from
 * the same call-time sums the final `TimedResult`/`TimedGpuResult` use.
 * `itersPerSec` is the CUMULATIVE rate so far (matches how the final
 * `itersPerSec` is computed, so the last live tick agrees with it);
 * `doneIterations` is the running total, used by the equal-N phase's
 * "(done/total)" status text (ignored by the open-ended timed runs).
 */
type ProgressCallback = (itersPerSec: number, doneIterations: number) => void;

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
 * `durationSec`, yielding to the event loop between chunks. `onProgress`
 * (see its doc) fires once per chunk, in that same between-chunks gap. */
async function runCpuTimed(
  cpu: CpuPrepared,
  projection: Mat4,
  durationSec: number,
  onProgress?: ProgressCallback,
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
    onProgress?.(iterations / (ms / 1000), iterations);
    await new Promise<void>((resolve) => setTimeout(resolve));
  }
  return { iterations, ms, itersPerSec: iterations / (ms / 1000) };
}

/** Accumulate exactly `totalIterations`, split into CPU_CHUNK_ITERATIONS
 * chunks with a final partial chunk — a fresh histogram/rng, independent of
 * any timed run (see the module doc: timed and equal-N runs never share a
 * histogram). Always runs at least one chunk, so unlike the timed run above,
 * this returns a definite (non-optional) FlameHistogram. `onProgress` fires
 * once per chunk (including the first), between chunks like `runCpuTimed`'s. */
async function runCpuExactly(
  cpu: CpuPrepared,
  projection: Mat4,
  totalIterations: number,
  onProgress?: ProgressCallback,
): Promise<FlameHistogram> {
  const rng = mulberry32(SEED);
  const firstChunk = Math.min(CPU_CHUNK_ITERATIONS, totalIterations);
  let ms = 0;
  const t0 = performance.now();
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
  ms += performance.now() - t0;
  let doneIterations = firstChunk;
  onProgress?.(doneIterations / (ms / 1000), doneIterations);
  let remaining = totalIterations - firstChunk;
  while (remaining > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve));
    const n = Math.min(CPU_CHUNK_ITERATIONS, remaining);
    const tChunk0 = performance.now();
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
    ms += performance.now() - tChunk0;
    doneIterations += n;
    remaining -= n;
    onProgress?.(doneIterations / (ms / 1000), doneIterations);
  }
  return histogram;
}

// ---------------------------------------------------------------------------
// GPU accumulation — drives the PRODUCTION backend (flame-gpu-backend.ts)
// ---------------------------------------------------------------------------

/** Timed GPU run: adaptive batching (toward ~250ms/call) through the real
 * `FlameAccumBackend` seam. Skips gracefully (returns `{ skipped }`) rather
 * than throwing when WebGPU is unavailable, so the page stays usable in
 * non-WebGPU browsers — `createGpuFlameBackend` itself never falls back to
 * CPU (see its module doc), so that graceful skip is entirely this page's
 * own doing. */
async function runGpuTimed(
  def: ScenarioDef,
  projection: Mat4,
  durationSec: number,
  onProgress?: ProgressCallback,
): Promise<TimedGpuResult | SkippedResult> {
  let backend: FlameAccumBackend;
  try {
    backend = await createGpuFlameBackend(toGpuBackendRequest(def, projection));
  } catch (e) {
    return { skipped: describeError(e) };
  }
  try {
    let n = INITIAL_GPU_BATCH_ITERATIONS;
    let iterations = 0;
    let ms = 0;
    let calls = 0;
    const targetMs = durationSec * 1000;
    while (ms < targetMs) {
      const t0 = performance.now();
      const retired = await backend.accumulate(n);
      const dt = performance.now() - t0;
      iterations += retired;
      ms += dt;
      calls++;
      onProgress?.(iterations / (ms / 1000), iterations);
      n = Math.round(
        clamp(
          (n * ADAPTIVE_BATCH_TARGET_MS) / dt,
          ADAPTIVE_BATCH_MIN_ITERATIONS,
          ADAPTIVE_BATCH_MAX_ITERATIONS,
        ),
      );
    }
    return {
      iterations,
      ms,
      itersPerSec: iterations / (ms / 1000),
      calls,
      adapterLabel: backend.adapterLabel,
    };
  } finally {
    backend.destroy();
  }
}

/** {@link runGpuEqualN}'s result. */
interface GpuEqualNResult {
  histogram: FlameHistogram;
  /**
   * fr-ee9: the SAME backend's own `snapshotDisplay()` output, taken right
   * after `histogram` (no further `accumulate()` calls in between — both
   * read the identical resident buffer). `undefined` only if this backend
   * has no `snapshotDisplay` (shouldn't happen for a production GPU backend
   * — `createGpuFlameBackend` always builds one — but this function stays
   * honest about the interface's optionality rather than asserting it).
   */
  gpuDisplayDownsample?: FlameHistogram;
  /** fr-ee9: see {@link measureRedisplayCost}'s doc; `undefined` under the
   * same condition as `gpuDisplayDownsample`. */
  redisplayCost?: RedisplayCostMetrics;
}

/**
 * Equal-N comparison run: a FRESH backend (independent of `runGpuTimed`'s),
 * driven by exactly {@link EQUAL_N_CALLS} calls of
 * {@link EQUAL_N_CALL_ITERATIONS} each. The returned actual-retired count is
 * asserted equal to the request EVERY call — not just assumed from
 * `planGpuDispatches`' documented single-dispatch behavior — because that
 * assertion holding IS part of what this harness checks (a silent rounding
 * change in the production dispatch planner would otherwise inflate "equal"
 * N without anyone noticing). A mismatch throws, which propagates all the
 * way to `main`'s top-level catch as a genuine `__BENCH_ERROR__` — this is
 * NOT downgraded to a graceful `{ skipped }`, unlike a missing/failed
 * backend, because it signals a real bug rather than an absent capability.
 *
 * fr-ee9: also captures the display-downsample agreement leg's GPU side and
 * the redisplay-cost bench, both against this SAME accumulated backend
 * before it is destroyed — see `GpuEqualNResult`'s doc. `runScenario` builds
 * the CPU-oracle side (a `downsampleFlame` call it needs anyway for its own
 * tone-mapped-image comparison) and does the actual comparing, so the same
 * `downsampleFlame` call is never made twice.
 */
async function runGpuEqualN(
  def: ScenarioDef,
  projection: Mat4,
  onProgress?: ProgressCallback,
): Promise<GpuEqualNResult | SkippedResult> {
  let backend: FlameAccumBackend;
  try {
    backend = await createGpuFlameBackend(toGpuBackendRequest(def, projection));
  } catch (e) {
    return { skipped: describeError(e) };
  }
  try {
    let iterations = 0;
    let ms = 0;
    for (let i = 0; i < EQUAL_N_CALLS; i++) {
      const t0 = performance.now();
      const retired = await backend.accumulate(EQUAL_N_CALL_ITERATIONS);
      ms += performance.now() - t0;
      if (retired !== EQUAL_N_CALL_ITERATIONS) {
        throw new Error(
          `[gpu-bench] equal-N assertion failed: backend.accumulate(${EQUAL_N_CALL_ITERATIONS}) ` +
            `retired ${retired} iterations, expected exactly ${EQUAL_N_CALL_ITERATIONS} ` +
            "(planGpuDispatches should hit its exact single-dispatch path here)",
        );
      }
      iterations += retired;
      onProgress?.(iterations / (ms / 1000), iterations);
    }
    const histogram = await backend.snapshot();

    let gpuDisplayDownsample: FlameHistogram | undefined;
    let redisplayCost: RedisplayCostMetrics | undefined;
    if (backend.snapshotDisplay) {
      gpuDisplayDownsample = await backend.snapshotDisplay(
        createFlameHistogram(DISPLAY_WIDTH, DISPLAY_HEIGHT),
      );
      redisplayCost = (await measureRedisplayCost(backend)) ?? undefined;
    }

    return { histogram, gpuDisplayDownsample, redisplayCost };
  } finally {
    backend.destroy();
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

/** Whether this scenario's raw diff metrics clear the agreement thresholds —
 * the one place `AGREEMENT_MAE_THRESHOLD`/`AGREEMENT_BIAS_THRESHOLD` are
 * actually applied. */
function passesAgreement(
  maeRGB: number,
  biasRGB: [number, number, number],
): boolean {
  return (
    maeRGB < AGREEMENT_MAE_THRESHOLD &&
    biasRGB.every((b) => Math.abs(b) < AGREEMENT_BIAS_THRESHOLD)
  );
}

/** Per-bucket tolerance for the fr-ee9 display-downsample exactness check —
 * `max(1e-6, 1e-4 * max(|cpu|, 1))`, per the bead's brief. */
function displayDownsampleTolerance(cpuValue: number): number {
  return Math.max(1e-6, 1e-4 * Math.max(Math.abs(cpuValue), 1));
}

/**
 * fr-ee9's display-downsample agreement leg: compares the GPU
 * `snapshotDisplay` kernel's output against `downsampleFlame` fed the exact
 * SAME resident histogram (both `gpu` and `cpu` here are downsampled from
 * the same `backend.snapshot()` readback — see `GpuEqualNResult`'s doc) — an
 * EXACTNESS check modulo f32 rounding, NOT a statistical one like
 * `passesAgreement`'s tone-mapped-image MAE/bias thresholds (which pin
 * equal-N ACCUMULATION agreement instead, across two independently-run
 * accumulations), so tight per-bucket tolerances are valid here.
 */
function compareDisplayDownsample(
  gpu: FlameHistogram,
  cpu: FlameHistogram,
): DisplayDownsampleMetrics {
  let maxAbsHitsError = 0;
  let withinTolerance = true;
  for (let i = 0; i < gpu.hits.length; i++) {
    const err = Math.abs(gpu.hits[i] - cpu.hits[i]);
    if (err > maxAbsHitsError) maxAbsHitsError = err;
    if (err > displayDownsampleTolerance(cpu.hits[i])) withinTolerance = false;
  }
  let maxAbsColorError = 0;
  for (let i = 0; i < gpu.sumRGB.length; i++) {
    const err = Math.abs(gpu.sumRGB[i] - cpu.sumRGB[i]);
    if (err > maxAbsColorError) maxAbsColorError = err;
    if (err > displayDownsampleTolerance(cpu.sumRGB[i])) {
      withinTolerance = false;
    }
  }
  const maxHitsRelError =
    cpu.maxHits !== 0
      ? Math.abs(gpu.maxHits - cpu.maxHits) / cpu.maxHits
      : Math.abs(gpu.maxHits);
  return {
    maxAbsHitsError,
    maxAbsColorError,
    maxHitsRelError,
    pass: withinTolerance && maxHitsRelError <= 1e-4,
  };
}

/** Reps averaged by {@link measureRedisplayCost} — enough to smooth out a
 * stray GC pause or driver hiccup without materially lengthening the bench. */
const REDISPLAY_COST_REPS = 5;

/**
 * fr-ee9's acceptance-evidence measurement: how much cheaper a progressive
 * redisplay tick is with the new resident-buffer downsample
 * (`snapshotDisplay` — GPU dispatch + readback + convert already included)
 * than with the OLD full-histogram-readback path (`snapshot` — readback +
 * convert already included — followed by a CPU `downsampleFlame` pass).
 * Both are timed against the SAME already-accumulated `backend` (no further
 * `accumulate()` calls in between, or between the two loops below), so
 * neither side's timing is skewed by doing more or less actual accumulation
 * work — the ratio isolates the redisplay mechanism's own cost. Returns
 * `null` when `backend` has no `snapshotDisplay` (see `GpuEqualNResult`'s
 * doc for when that can happen).
 */
async function measureRedisplayCost(
  backend: FlameAccumBackend,
): Promise<RedisplayCostMetrics | null> {
  if (!backend.snapshotDisplay) return null;
  const snapshotDisplay = backend.snapshotDisplay.bind(backend);
  const oldOut = createFlameHistogram(DISPLAY_WIDTH, DISPLAY_HEIGHT);
  const newOut = createFlameHistogram(DISPLAY_WIDTH, DISPLAY_HEIGHT);

  let oldMs = 0;
  for (let i = 0; i < REDISPLAY_COST_REPS; i++) {
    const t0 = performance.now();
    const full = await backend.snapshot();
    downsampleFlame(
      full,
      DISPLAY_WIDTH,
      DISPLAY_HEIGHT,
      FLAME_FILTER_RADIUS,
      oldOut,
    );
    oldMs += performance.now() - t0;
  }

  let newMs = 0;
  for (let i = 0; i < REDISPLAY_COST_REPS; i++) {
    const t0 = performance.now();
    await snapshotDisplay(newOut);
    newMs += performance.now() - t0;
  }

  oldMs /= REDISPLAY_COST_REPS;
  newMs /= REDISPLAY_COST_REPS;
  return { oldMs, newMs, ratio: newMs / oldMs };
}

/**
 * Roll every scenario's `comparison`/`displayDownsample`, plus the standalone
 * `ss1DisplayDownsample` check, up into one verdict:
 *
 * - `"fail"`: at least one of those actually RAN and did not clear its
 *   thresholds — the kernel and its CPU oracle disagree.
 * - `"pass"`: at least one scenario's `comparison` ran, at least one
 *   scenario's `displayDownsample` ran, AND `ss1DisplayDownsample` ran —
 *   and every one of those that ran passed.
 * - `"skipped"`: nothing to fail, but not everything above ran either (no
 *   WebGPU in this browser, every GPU run failed, or the full sweep — every
 *   scenario plus the ss=1 check — hasn't finished yet). Deliberately its
 *   own state rather than a vacuous "pass": an agreement check that
 *   silently checked nothing must never read as green — a CI box that loses
 *   WebGPU (a flag change, a busted SwiftShader) would otherwise keep
 *   reporting success while pinning nothing. `scripts/gpu-flame-bench.mjs`
 *   exits non-zero on BOTH "fail" and "skipped" for exactly that reason; a
 *   human on a non-WebGPU browser (e.g. benchmarking a phone's CPU side)
 *   just sees the honest label.
 */
function computeAgreement(
  scenarios: ScenarioResultRecord[],
  ss1: DisplayDownsampleMetrics | SkippedResult,
): "pass" | "fail" | "skipped" {
  const ranImage = scenarios.filter((s) => "pass" in s.comparison);
  const ranDisplay = scenarios.filter((s) => "pass" in s.displayDownsample);
  const ss1Ran = "pass" in ss1;
  const anyImageFail = ranImage.some(
    (s) => "pass" in s.comparison && !s.comparison.pass,
  );
  const anyDisplayFail = ranDisplay.some(
    (s) => "pass" in s.displayDownsample && !s.displayDownsample.pass,
  );
  const ss1Fail = ss1Ran && !ss1.pass;
  if (anyImageFail || anyDisplayFail || ss1Fail) {
    return "fail";
  }
  return ranImage.length > 0 && ranDisplay.length > 0 && ss1Ran
    ? "pass"
    : "skipped";
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

/** Which kind of work — if any — is on the GPU/CPU right now. Drives the
 * fixed-position activity badge: idle/done are the same neutral gray state
 * (just different text), cpu is amber, gpu is green. */
type ActivityKind = "idle" | "cpu" | "gpu";

interface ActivityBadge {
  setState(kind: ActivityKind, text: string): void;
}

function createActivityBadge(
  badge: HTMLElement,
  label: HTMLElement,
): ActivityBadge {
  return {
    setState(kind, text) {
      badge.classList.remove("idle", "cpu", "gpu");
      badge.classList.add(kind);
      label.textContent = text;
    },
  };
}

/** The badge's label while a chunk/call is in flight but hasn't reported a
 * rate yet — `formatRate`'s own `NaN` fallback ("…") keeps this in sync with
 * every other "not yet known" rate string on the page. */
function accumulatingLabel(kind: "cpu" | "gpu", itersPerSec: number): string {
  const verb = kind === "cpu" ? "CPU accumulating" : "GPU accumulating";
  return `${verb} — ${formatRate(itersPerSec)}`;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function runScenario(
  def: ScenarioDef,
  dom: ScenarioDom,
  durationSec: number,
  activity: ActivityBadge,
): Promise<ScenarioResultRecord> {
  const projection = buildProjection(
    ACCUM_WIDTH,
    ACCUM_HEIGHT,
    def.cameraPos,
    def.lookAt,
  );
  const cpu = prepareCpu(def);

  setStatus(dom, `running: cpu timed — ${formatRate(NaN)}`);
  activity.setState("cpu", accumulatingLabel("cpu", NaN));
  const cpuTimed = await runCpuTimed(cpu, projection, durationSec, (rate) => {
    activity.setState("cpu", accumulatingLabel("cpu", rate));
    setStatus(dom, `running: cpu timed — ${formatRate(rate)}`);
  });

  setStatus(dom, `running: gpu timed — ${formatRate(NaN)}`);
  activity.setState("gpu", accumulatingLabel("gpu", NaN));
  const gpuTimed = await runGpuTimed(def, projection, durationSec, (rate) => {
    activity.setState("gpu", accumulatingLabel("gpu", rate));
    setStatus(dom, `running: gpu timed — ${formatRate(rate)}`);
  });

  setStatus(dom, "equal-N: cpu…");
  activity.setState("cpu", accumulatingLabel("cpu", NaN));
  const cpuHist = await runCpuExactly(
    cpu,
    projection,
    EQUAL_N_ITERATIONS,
    (rate, done) => {
      activity.setState("cpu", accumulatingLabel("cpu", rate));
      setStatus(
        dom,
        `equal-N: cpu (${formatCount(done)}/${formatCount(EQUAL_N_ITERATIONS)})…`,
      );
    },
  );
  const cpuDisplay = downsampleFlame(
    cpuHist,
    DISPLAY_WIDTH,
    DISPLAY_HEIGHT,
    FLAME_FILTER_RADIUS,
  );
  const cpuImage = tonemapFlame(cpuDisplay, TONEMAP_PARAMS);
  drawImage(dom.cpuCanvas, cpuImage);

  let comparison: ComparisonMetrics | SkippedResult;
  let displayDownsample: DisplayDownsampleMetrics | SkippedResult;
  let redisplayCost: RedisplayCostMetrics | SkippedResult;
  if ("skipped" in gpuTimed) {
    comparison = { skipped: gpuTimed.skipped };
    displayDownsample = { skipped: gpuTimed.skipped };
    redisplayCost = { skipped: gpuTimed.skipped };
  } else {
    setStatus(dom, "equal-N: gpu…");
    activity.setState("gpu", accumulatingLabel("gpu", NaN));
    const gpuEqualN = await runGpuEqualN(def, projection, (rate) => {
      activity.setState("gpu", accumulatingLabel("gpu", rate));
    });
    if ("skipped" in gpuEqualN) {
      comparison = { skipped: gpuEqualN.skipped };
      displayDownsample = { skipped: gpuEqualN.skipped };
      redisplayCost = { skipped: gpuEqualN.skipped };
    } else {
      // fr-ee9: this IS the CPU oracle side of the display-downsample
      // agreement leg below (downsampleFlame fed the GPU's own resident
      // histogram) — computed once here for the existing tone-mapped-image
      // comparison, then reused for `compareDisplayDownsample` rather than
      // calling downsampleFlame on the same input a second time.
      const gpuDisplay = downsampleFlame(
        gpuEqualN.histogram,
        DISPLAY_WIDTH,
        DISPLAY_HEIGHT,
        FLAME_FILTER_RADIUS,
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
        pass: passesAgreement(diff.maeRGB, diff.biasRGB),
      };
      displayDownsample = gpuEqualN.gpuDisplayDownsample
        ? compareDisplayDownsample(gpuEqualN.gpuDisplayDownsample, gpuDisplay)
        : { skipped: "backend has no snapshotDisplay" };
      redisplayCost = gpuEqualN.redisplayCost ?? {
        skipped: "backend has no snapshotDisplay",
      };
    }
  }

  const result: ScenarioResultRecord = {
    name: def.name,
    cpu: cpuTimed,
    gpu: gpuTimed,
    comparison,
    displayDownsample,
    redisplayCost,
  };
  setStatus(dom, "done");
  activity.setState("idle", "Done");
  dom.pre.textContent = JSON.stringify(result, null, 2);
  return result;
}

// ---------------------------------------------------------------------------
// Standalone ss=1 display-downsample check (fr-ee9)
// ---------------------------------------------------------------------------

/** Small enough to accumulate and read back quickly — this check only needs
 * to exercise the ss=1 (scale-1, no-supersample) codepath, not produce a
 * representative-quality image. */
const SS1_WIDTH = 240;
const SS1_HEIGHT = 135;
const SS1_ITERATIONS = 4_000_000;

/**
 * fr-ee9's ss=1 (no supersample) display-downsample agreement check,
 * standalone from the per-scenario legs above: every `SCENARIOS` entry runs
 * at the same fixed ss=2 accumulation (`ACCUM_WIDTH`/`ACCUM_HEIGHT`, both
 * `DISPLAY_WIDTH`/`HEIGHT * SUPERSAMPLE`), so none of them ever exercises
 * `downsampleFlame`'s (and the mirrored GPU kernel's) scale-1 pass-through
 * path — phase pinned to 0, sigma pinned to its `MIN_FILTER_SIGMA` floor
 * (see flame.ts's `downsampleFlame` doc). Reworking every `ScenarioDef` to
 * carry its own supersample factor just for this would be a much bigger
 * change than the bead calls for, so this runs one small, cheap,
 * independent accumulation at `SS1_WIDTH x SS1_HEIGHT` (accumulation ===
 * display resolution) using the first scenario's system, purely to exercise
 * that path — not a timed/visual comparison the way the scenarios above are.
 */
async function runSs1DisplayDownsampleCheck(): Promise<
  DisplayDownsampleMetrics | SkippedResult
> {
  const def = SCENARIOS[0];
  const projection = buildProjection(
    SS1_WIDTH,
    SS1_HEIGHT,
    def.cameraPos,
    def.lookAt,
  );
  let backend: FlameAccumBackend;
  try {
    backend = await createGpuFlameBackend({
      transforms: def.transforms,
      finalTransform: def.finalTransform,
      order: def.symmetry.order,
      axis: def.symmetry.axis,
      paletteId: def.paletteId,
      projection,
      width: SS1_WIDTH,
      height: SS1_HEIGHT,
      seed: SEED,
      displayWidth: SS1_WIDTH,
      displayHeight: SS1_HEIGHT,
      progressiveFilterRadius: FLAME_FILTER_RADIUS,
    });
  } catch (e) {
    return { skipped: describeError(e) };
  }
  try {
    if (!backend.snapshotDisplay) {
      return { skipped: "backend has no snapshotDisplay" };
    }
    const retired = await backend.accumulate(SS1_ITERATIONS);
    if (retired < SS1_ITERATIONS) {
      throw new Error(
        `[gpu-bench] ss=1 check: backend.accumulate(${SS1_ITERATIONS}) retired ` +
          `only ${retired} iterations`,
      );
    }
    const full = await backend.snapshot();
    const gpuDisplay = await backend.snapshotDisplay(
      createFlameHistogram(SS1_WIDTH, SS1_HEIGHT),
    );
    const cpuDisplay = downsampleFlame(
      full,
      SS1_WIDTH,
      SS1_HEIGHT,
      FLAME_FILTER_RADIUS,
    );
    return compareDisplayDownsample(gpuDisplay, cpuDisplay);
  } finally {
    backend.destroy();
  }
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
  const activity = createActivityBadge(
    requireElement<HTMLDivElement>("activityBadge"),
    requireElement<HTMLSpanElement>("activityLabel"),
  );
  activity.setState("idle", "Idle");

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
    // "skipped" (not yet run) until runAll's own ss=1 check completes — see
    // computeAgreement.
    ss1DisplayDownsample: { skipped: "not yet run" },
    // "skipped" until every leg (every scenario's comparison/displayDownsample
    // plus ss1DisplayDownsample) actually runs — see computeAgreement.
    agreement: "skipped",
  };
  window.__BENCH_RESULTS__ = benchResults;

  function renderResults(): void {
    resultsPre.textContent = JSON.stringify(benchResults, null, 2);
  }

  function recomputeAgreement(): void {
    benchResults.agreement = computeAgreement(
      benchResults.scenarios,
      benchResults.ss1DisplayDownsample,
    );
  }

  function recordResult(result: ScenarioResultRecord): void {
    const idx = benchResults.scenarios.findIndex((r) => r.name === result.name);
    if (idx >= 0) benchResults.scenarios[idx] = result;
    else benchResults.scenarios.push(result);
    recomputeAgreement();
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
      recordResult(await runScenario(def, dom, currentDuration(), activity));
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
        recordResult(await runScenario(def, dom, currentDuration(), activity));
      }
      // fr-ee9: the standalone ss=1 display-downsample check — always run as
      // part of a full sweep (independent of any ?scenarios= filter above),
      // since it is the only leg that exercises the scale-1 pass-through
      // path at all (see runSs1DisplayDownsampleCheck's doc), and the
      // headless runner's agreement verdict is meant to certify the WHOLE
      // kernel, not just whichever named scenarios were requested.
      activity.setState("gpu", "GPU ss=1 check…");
      benchResults.ss1DisplayDownsample = await runSs1DisplayDownsampleCheck();
      activity.setState("idle", "Done");
      recomputeAgreement();
      renderResults();
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
  console.error("[gpu-bench] fatal:", err);
  const resultsPre = document.getElementById("results");
  if (resultsPre) resultsPre.textContent = `FATAL ERROR:\n${message}`;
}
