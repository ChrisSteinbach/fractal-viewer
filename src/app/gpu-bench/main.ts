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
 * fr-e26: the 4D scenarios pin `src/fractal/flame-gpu-4d.ts`'s kernel
 * (driven by the same backend module's `createGpuFlameBackend4`) to
 * `flame-4d.ts`'s `accumulateFlame4` the exact same way — every scenario,
 * 3D or 4D, runs through ONE shared timed/equal-N/display-downsample
 * pipeline via its own {@link ScenarioEngines} adapter, so the comparison
 * and agreement logic literally cannot differ between the two kernels. The
 * 4D defs cover all four `FourDRenderColor` kinds and both soft-w-slice
 * states (the slice weighting being the 4D kernel's one genuinely new
 * accumulation mechanism — see flame-gpu-4d.ts's fixed-point-weight doc).
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
import { rotationMatrix4, toTransform4 } from "../../fractal/affine4";
import { prepareChaosGame, runChaosGame } from "../../fractal/chaos-game";
import type { PreparedChaosGame } from "../../fractal/chaos-game";
import { runChaosGame4, prepareChaosGame4 } from "../../fractal/chaos-game-4d";
import type { PreparedChaosGame4 } from "../../fractal/chaos-game-4d";
import {
  W_SIDE_PALETTES,
  buildColorModeLUT,
  transformColors,
} from "../../fractal/color";
import type { FourDRenderColor } from "../../fractal/color";
import {
  accumulateFlame,
  createFlameHistogram,
  downsampleFlame,
  tonemapFlame,
  DEFAULT_GAMMA_THRESHOLD,
} from "../../fractal/flame";
import type { FlameHistogram, Mat4, TonemapParams } from "../../fractal/flame";
import { accumulateFlame4 } from "../../fractal/flame-4d";
import { buildPaletteLUT } from "../../fractal/palette";
import type { FlamePaletteId } from "../../fractal/palette";
import {
  barnsleyFern,
  doubleRotation,
  hyperfern,
  mandelboxKifs,
  sierpinskiTetrahedron,
  swirlFlame,
} from "../../fractal/presets";
import {
  composeFlameProjection4,
  composeRotorProjection4,
} from "../../fractal/project4";
import type { FourDView } from "../../fractal/project4";
import { mulberry32 } from "../../fractal/rng";
import {
  buildSurfaceDE,
  deHasFolds,
  estimateDistance,
  SURFACE_FOLD_BEAM_WIDTH,
} from "../../fractal/surface-de";
import type { SurfaceDE } from "../../fractal/surface-de";
import {
  SURFACE_GPU_HIT_FLOOR,
  SURFACE_GPU_PARAMS_BYTES,
  SURFACE_GPU_RAY_ACTIVE,
  SURFACE_GPU_RAY_EXHAUSTED,
  SURFACE_GPU_RAY_HIT,
  SURFACE_GPU_RAY_MISS,
  SURFACE_GPU_SHADE_BYTES,
  packSurfaceGpuMaps,
  packSurfaceGpuParams,
  packSurfaceGpuShade,
  surfaceDeKernelWgsl,
  surfaceGpuWorkgroupBytes,
} from "../../fractal/surface-de-gpu";
import type { SurfaceGpuPose } from "../../fractal/surface-de-gpu";
import type {
  FourDColorMode,
  Rotation4,
  SymmetryParams,
  Transform,
  Vec3,
  Vec4,
} from "../../fractal/types";
import { clamp } from "../../fractal/vec";
import {
  DEFAULT_FLAME_EXPOSURE,
  DEFAULT_FLAME_GAMMA,
  DEFAULT_FLAME_VIBRANCY,
} from "../state";
import {
  createGpuFlameBackend,
  createGpuFlameBackend4,
} from "../flame-gpu-backend";
import { FLAME_FILTER_RADIUS } from "../flame-worker-core";
import type {
  FlameAccumBackend,
  GpuBackendRequest,
  GpuBackendRequest4,
} from "../flame-worker-core";
import { wSupport } from "../rotor4";
import {
  SURFACE_COMPUTE_INITIAL_RAY_STEP_US,
  SURFACE_COMPUTE_WORKGROUP_SIZE,
  SurfaceComputeRenderer,
} from "../surface-compute";
import type { SurfaceComputeFrameSpec } from "../surface-compute";

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
  /** The MAE bar `pass` was judged against — `AGREEMENT_MAE_THRESHOLD`
   * unless the scenario overrides it (see `ScenarioDef3D.maeThreshold`);
   * recorded so results.json shows the ruler, not just the verdict. */
  maeThreshold: number;
  /** `maeRGB < maeThreshold && every |biasRGB| <
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
  /** fr-q1f8: the surface-DE WGSL kernel section (`runSurfaceDeSection`) —
   * present only once that section has run (`?surface=1|only` or its
   * button), ABSENT otherwise so a run without the new flags produces a
   * bit-for-bit unchanged results.json. Its verdict is deliberately
   * independent of {@link agreement} (`computeAgreement` is untouched);
   * `scripts/gpu-flame-bench.mjs` gates on it only when a surface flag was
   * given. */
  surfaceDe?: SurfaceDeResults;
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

interface ScenarioDef3D {
  kind: "3d";
  name: string;
  transforms: Transform[];
  finalTransform: Transform | null;
  symmetry: SymmetryParams;
  paletteId: FlamePaletteId;
  cameraPos: [number, number, number];
  lookAt: [number, number, number];
  /**
   * Per-scenario override of `AGREEMENT_MAE_THRESHOLD`. The equal-N MAE
   * between two INDEPENDENT samplings of the same attractor never reaches 0
   * — it has a Monte-Carlo noise floor that is a property of the SCENARIO
   * (how much of the frame is sparse, few-hits-per-bucket haze, where one
   * hit of shot noise is a large tone-mapped delta), not of the kernels.
   * The compact-filament presets floor around ~0.3 (fr-53k), which is what
   * the default threshold's 1.0 was calibrated against; a diffuse scenario
   * with a higher measured floor documents it and overrides here rather
   * than loosening the bar for everyone.
   */
  maeThreshold?: number;
}

/**
 * A 4D scenario (fr-e26): a 3D-authored preset lifted per-map through
 * `toTransform4` (exactly how the app's own 4D mode builds its Transform4
 * set — see main.ts's `fourDRenderSnapshot`), viewed through a frozen
 * `rotationMatrix4(rotation)` tumble. `paletteId` and `colorMode` reproduce
 * the session's `buildFourDColor` precedence: a non-`"legacy"` palette wins
 * (structural coloring); `"legacy"` dispatches on `colorMode`. The camera is
 * derived from the scenario's own explorer cloud (see {@link prepare4D})
 * rather than authored per scenario — a fixed offset direction at a
 * radius-proportional distance frames any system at any tumble.
 */
interface ScenarioDef4D {
  kind: "4d";
  name: string;
  system: () => Transform[];
  finalTransform: Transform | null;
  rotation: Rotation4;
  paletteId: FlamePaletteId;
  colorMode: FourDColorMode;
  /** The "radius" color mode's ramp palette (fr-6ue) — the `fourD` start
   * block's `rampPalette`, minus the custom-payload arm the bench doesn't
   * author. Omitted = `"legacy"` (the built-in warm→cool ramp); only the
   * radius mode reads it. */
  rampPalette?: FlamePaletteId;
  sliceOn: boolean;
  sliceCenter: number;
  sliceWidth: number;
  sliceRelativeColor: boolean;
  /** See {@link ScenarioDef3D.maeThreshold} — same scenario-owned noise
   * floor override, one dimension up. */
  maeThreshold?: number;
}

type ScenarioDef = ScenarioDef3D | ScenarioDef4D;

const SIERPINSKI_CAMERA: Pick<ScenarioDef3D, "cameraPos" | "lookAt"> = {
  cameraPos: [2.5, 1.8, 2.5],
  lookAt: [0, 0.4, 0],
};

/** A fixed w-mixing tumble shared by the 4D scenarios — three plane angles
 * chosen to genuinely rotate w into view (nonzero xw/yw/zw), so the
 * projected cloud, the signed-w signal, and therefore the wRamp/slice legs
 * all actually depend on the 4D machinery rather than degenerating to a
 * w-dropped 3D render. */
const BENCH_TUMBLE: Rotation4 = { xy: 0.35, xw: 0.65, yw: 0.4, zw: 0.55 };

/**
 * fr-jnu: the "variation zoo" — three contractive maps that between them
 * enable all 12 VariationTypes exactly once (4 lanes each), so one scenario
 * pins every hand-written WGSL variation formula against the CPU oracle's
 * variations.ts. Grouping is deliberate: the origin-divergent warps
 * (spherical, spiral) sit on one map, blended with bounded ones, so the
 * occasional origin-adjacent point escapes and reseeds (identically on both
 * sides) instead of the whole system blowing up. Non-1 weights exercise the
 * weighted binary-search pick, including the 3D kernel's.
 */
function variationZoo(): Transform[] {
  return [
    {
      id: 0,
      position: [0.4, 0.15, 0.2],
      rotation: [0.3, 0.2, 0.4],
      scale: [0.55, 0.55, 0.55],
      weight: 2,
      variations: [
        { type: "linear", weight: 0.35 },
        { type: "sinusoidal", weight: 0.55 },
        { type: "swirl", weight: 0.4 },
        { type: "bubble", weight: 0.6 },
      ],
    },
    {
      id: 1,
      position: [-0.35, 0.3, -0.15],
      rotation: [0.1, 0.5, 1.1],
      scale: [0.5, 0.5, 0.5],
      weight: 1,
      variations: [
        { type: "polar", weight: 0.6 },
        { type: "handkerchief", weight: 0.35 },
        { type: "heart", weight: 0.35 },
        { type: "disc", weight: 0.55 },
      ],
    },
    {
      id: 2,
      position: [0.1, -0.4, 0.3],
      rotation: [0.7, 0.15, 0.25],
      scale: [0.5, 0.5, 0.5],
      weight: 1.5,
      variations: [
        { type: "spherical", weight: 0.45 },
        { type: "horseshoe", weight: 0.4 },
        { type: "spiral", weight: 0.3 },
        { type: "julia", weight: 0.5 },
      ],
    },
  ];
}

/**
 * fr-jnu: a gentle final-transform lens (small rotation, mild sinusoidal
 * fold) for the zoo scenarios — pins the kernels' hasFinal slot path
 * (applySlot on the lens slot, adopt-only-if-finite), which no other
 * scenario exercises in either dimension.
 */
function variationZooLens(): Transform {
  return {
    id: 99,
    position: [0.05, -0.05, 0.1],
    rotation: [0.15, 0.35, 0.1],
    scale: [0.85, 0.85, 0.85],
    variations: [
      { type: "linear", weight: 0.75 },
      { type: "sinusoidal", weight: 0.3 },
    ],
  };
}

/** fr-jnu: the zoo lifted to 4D — the same three maps with w-mixing blocks
 * (a w rotation, a w offset + rotation, an independent w scale), so the 4D
 * kernel's variations4 lanes run over genuinely 4D orbits. */
function variationZoo4(): Transform[] {
  const [t0, t1, t2] = variationZoo();
  return [
    { ...t0, w: { rotation: { xw: 0.45 } } },
    { ...t1, w: { position: 0.3, rotation: { yw: 0.3 } } },
    { ...t2, w: { scale: 0.6 } },
  ];
}

/**
 * fr-p7nu: the "fold zoo" — three contractive maps, each pairing one of the
 * Mandelbox fold family (`boxfold`/`spherefold`/`mandelbox`) with a small
 * `linear` component, so this scenario pins the three hand-written WGSL fold
 * formulas against the CPU oracle's `variations.ts` — the same role
 * `variationZoo` plays for the original 12 types. Affine parts are
 * contractive (per-axis scales 0.45-0.55, translations within ±0.35, mild
 * rotations) so the folds compound into a bounded, non-degenerate attractor
 * rather than an escape-dominated haze (probed at 400k points: bounds roughly
 * x ∈ [-2.8, 2.9], y ∈ [-3.0, 2.9], z ∈ [-2.7, 3.1], well inside the 50
 * escape limit).
 */
function foldZoo(): Transform[] {
  return [
    {
      id: 0,
      position: [0.3, 0.2, -0.15],
      rotation: [0.2, 0.35, 0.1],
      scale: [0.55, 0.5, 0.45],
      variations: [
        { type: "boxfold", weight: 1.0 },
        { type: "linear", weight: 0.35 },
      ],
    },
    {
      id: 1,
      position: [-0.35, 0.15, 0.25],
      rotation: [0.4, 0.1, -0.25],
      scale: [0.5, 0.45, 0.55],
      variations: [
        { type: "spherefold", weight: 0.9 },
        { type: "linear", weight: 0.3 },
      ],
    },
    {
      id: 2,
      position: [0.1, -0.3, 0.2],
      rotation: [0.15, -0.2, 0.3],
      scale: [0.45, 0.55, 0.5],
      variations: [
        { type: "mandelbox", weight: 1.4 },
        { type: "linear", weight: 0.2 },
      ],
    },
  ];
}

/** fr-p7nu: the fold zoo lifted to 4D — the same three maps with w-mixing
 * blocks (a w rotation, a w offset + rotation, an independent w scale),
 * mirroring `variationZoo4`'s pattern exactly, so the 4D kernel's fold cases
 * run over genuinely 4D orbits (the full 4D radius/box, not a w = 0 slice). */
function foldZoo4(): Transform[] {
  const [t0, t1, t2] = foldZoo();
  return [
    { ...t0, w: { rotation: { xw: 0.4 } } },
    { ...t1, w: { position: 0.25, rotation: { yw: 0.3 } } },
    { ...t2, w: { scale: 0.55 } },
  ];
}

const SCENARIOS: ScenarioDef[] = [
  {
    kind: "3d",
    name: "sierpinski",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 1, axis: "y" },
    paletteId: "legacy",
    ...SIERPINSKI_CAMERA,
  },
  {
    kind: "3d",
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
    kind: "3d",
    name: "swirl",
    transforms: swirlFlame(),
    finalTransform: null,
    symmetry: { order: 1, axis: "y" },
    paletteId: "spectrum",
    cameraPos: [2.6, 1.9, 2.6],
    lookAt: [0, 0, 0],
  },
  {
    kind: "3d",
    name: "kaleido",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    symmetry: { order: 5, axis: "y" },
    paletteId: "aurora",
    ...SIERPINSKI_CAMERA,
  },
  {
    kind: "3d",
    name: "variation-zoo",
    transforms: variationZoo(),
    finalTransform: variationZooLens(),
    symmetry: { order: 1, axis: "y" },
    paletteId: "legacy",
    // Frames the zoo's dense mass (probed at 400k points: x ∈ [0.06, 1.73],
    // y ∈ [-1.27, 1.27], z ∈ [-1.03, 1.10] at the 1%-99% percentiles, ~0.05%
    // escape-tail outliers beyond 2x that box).
    cameraPos: [3.4, 1.6, 3.3],
    lookAt: [0.9, 0, 0.05],
    // Measured equal-N noise floor (fr-jnu control experiment): the CPU
    // oracle against ITSELF at two seeds (0xc0ffee vs 0xbadcafe, 50.3M
    // iterations each, this exact camera/tonemap pipeline) gives maeRGB
    // 2.379 — the 12-warp blend renders as diffuse few-hits-per-bucket haze
    // over ~26% of the accumulation buckets, and single-hit shot noise
    // through the log-density tonemap dominates the mean. The measured
    // CPU-vs-GPU MAE was 2.391 (SwiftShader), i.e. the kernel adds ~0.01
    // over the floor. 4.0 = floor + ~1.6 detection margin: hundreds of
    // standard errors above run-to-run floor fluctuation, while a real
    // formula divergence (even one mislabeled case body at weight 0.35)
    // restructures whole filaments and measures in the tens.
    maeThreshold: 4,
    // Uniquely pins (fr-jnu): all 12 VariationTypes in the 3D WGSL kernel
    // (see variationZoo's doc), the 3D kernel's WEIGHTED transform pick
    // (sierpinski/fern/swirl/kaleido above are all uniform-weight systems),
    // and the 3D final-transform lens slot — none of which any other 3D
    // scenario here exercises.
  },
  {
    kind: "3d",
    name: "fold-zoo",
    transforms: foldZoo(),
    finalTransform: null,
    symmetry: { order: 1, axis: "y" },
    paletteId: "legacy",
    // Frames the fold zoo's mass (probed at 400k points: x ∈ [-1.23, 2.34],
    // y ∈ [-1.74, 1.83], z ∈ [-0.85, 2.04] at the 1%-99% percentiles).
    cameraPos: [4.3, 2.2, 5.0],
    lookAt: [0.6, 0, 0.6],
    // Measured equal-N noise floor (fr-p7nu): CPU-vs-GPU maeRGB on SwiftShader
    // is 1.469, stable bit-for-bit across repeated runs (integer atomic
    // accumulation has no run-to-run float-order variance). 3.0 = roughly 2x
    // that measured value, per the bead's threshold procedure.
    maeThreshold: 3.0,
    // Uniquely pins (fr-p7nu): the three Mandelbox fold variations
    // (boxfold/spherefold/mandelbox) in the 3D WGSL kernel — see foldZoo's
    // doc — which no other 3D scenario here exercises.
  },
  // The 4D legs (fr-e26): between them, all four FourDRenderColor kinds and
  // both slice states; hyperfern/doubleRotation both carry non-1 weights,
  // exercising the 4D kernel's weighted binary-search pick (mirroring the 3D
  // zoo's weighted-pick coverage above). fr-jnu's variation-zoo-4d below
  // closes the remaining gap: every variations4 formula over a genuinely 4D
  // orbit, plus the 4D kernel's final-transform lens slot — neither
  // exercised by hyperfern/doubleRotation.
  {
    kind: "4d",
    name: "hyperfern-structural",
    system: hyperfern,
    finalTransform: null,
    rotation: BENCH_TUMBLE,
    paletteId: "ember", // non-legacy => structural LUT coloring.
    colorMode: "wBlueOrange", // ignored under a non-legacy palette.
    sliceOn: false,
    sliceCenter: 0,
    sliceWidth: 0.35,
    sliceRelativeColor: false,
  },
  {
    kind: "4d",
    name: "doublerot-wramp-slice",
    system: doubleRotation,
    finalTransform: null,
    rotation: BENCH_TUMBLE,
    paletteId: "legacy",
    colorMode: "wBlueOrange", // wRamp, computed in-shader on the GPU side.
    // Slice ON: the fixed-point weight path, the 4D kernel's one genuinely
    // new accumulation mechanism, must run against the CPU oracle.
    sliceOn: true,
    sliceCenter: 0.25,
    sliceWidth: 0.3,
    // The fr-nn6 slice-relative recolor rides this leg too: the remap is the
    // identity arithmetic with non-neutral (shift, invScale), so this pins
    // both kernels' wRamp path AND the remap in one scenario.
    sliceRelativeColor: true,
  },
  {
    kind: "4d",
    name: "hyperfern-transform",
    system: hyperfern,
    finalTransform: null,
    rotation: BENCH_TUMBLE,
    paletteId: "legacy",
    colorMode: "transform",
    sliceOn: false,
    sliceCenter: 0,
    sliceWidth: 0.35,
    sliceRelativeColor: false,
  },
  {
    kind: "4d",
    name: "doublerot-radius",
    system: doubleRotation,
    finalTransform: null,
    rotation: BENCH_TUMBLE,
    paletteId: "legacy",
    colorMode: "radius",
    // Non-legacy (fr-6ue): the app's 4D radius LUT can now be palette-driven,
    // and the LUT crosses to the kernel as data — so the pinned scenario
    // rides a gradient-built LUT, proving the packing passes it through
    // rather than only ever agreeing on the built-in ramp's bytes.
    rampPalette: "dusk",
    sliceOn: false,
    sliceCenter: 0,
    sliceWidth: 0.35,
    sliceRelativeColor: false,
  },
  {
    kind: "4d",
    name: "variation-zoo-4d",
    system: variationZoo4,
    finalTransform: variationZooLens(),
    rotation: BENCH_TUMBLE,
    paletteId: "legacy",
    colorMode: "wBlueOrange",
    sliceOn: false,
    sliceCenter: 0,
    sliceWidth: 0.35,
    sliceRelativeColor: false,
    // Uniquely pins (fr-jnu): every variations4 formula in the 4D WGSL
    // kernel, run over genuinely 4D orbits via variationZoo4's w-mixing
    // blocks (see its doc), and the 4D kernel's final-transform lens slot —
    // neither exercised by the four 4D scenarios above.
  },
  {
    kind: "4d",
    name: "fold-zoo-4d",
    system: foldZoo4,
    finalTransform: null,
    rotation: BENCH_TUMBLE,
    paletteId: "legacy",
    colorMode: "wBlueOrange",
    sliceOn: false,
    sliceCenter: 0,
    sliceWidth: 0.35,
    sliceRelativeColor: false,
    // Measured equal-N noise floor (fr-p7nu): CPU-vs-GPU maeRGB on SwiftShader
    // is 0.225, stable bit-for-bit across repeated runs (see fold-zoo's own
    // comment for why). 2x that (0.45) is below the bead's 1.0 floor, so
    // maeThreshold stays at the default-equivalent 1.0 rather than tightening
    // below it.
    maeThreshold: 1.0,
    // Uniquely pins (fr-p7nu): the three Mandelbox fold variations in the 4D
    // WGSL kernel, run over genuinely 4D orbits via foldZoo4's w-mixing
    // blocks (see its doc) — the full 4D radius/box fold, not a w = 0 slice.
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
 * comfortably under both. The MAE threshold is the DEFAULT bar, calibrated
 * on the compact-filament presets' ~0.3 noise floor; a scenario whose
 * equal-N floor is intrinsically higher overrides it per scenario
 * (`ScenarioDef3D.maeThreshold`) with its own measured floor documented. */
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

/** Assemble the production {@link GpuBackendRequest} for a 3D scenario —
 * the GPU counterpart of `prepareCpu`'s CPU-side setup. */
function toGpuBackendRequest(
  def: ScenarioDef3D,
  projection: Mat4,
): GpuBackendRequest {
  return {
    transforms: def.transforms,
    finalTransform: def.finalTransform,
    order: def.symmetry.order,
    axis: def.symmetry.axis,
    palette: def.paletteId,
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
// Scenario engines: ONE timed/equal-N pipeline over per-dimension adapters
// ---------------------------------------------------------------------------

/**
 * Advance one CPU oracle chunk: `n` more iterations into `histogram`
 * (`undefined` = fresh start, warmup included), continuing `rng`. Closes
 * over everything scenario-fixed (prepared system, projection, palette/
 * color, view) so the shared chunk loops below ({@link runCpuTimed} /
 * {@link runCpuExactly}) drive `accumulateFlame` and `accumulateFlame4`
 * identically — the same one-seam shape as the production
 * `FlameAccumBackend`, but for the ORACLE side of the comparison.
 */
type CpuChunkFn = (
  n: number,
  histogram: FlameHistogram | undefined,
  rng: () => number,
) => FlameHistogram;

/**
 * A scenario's two engines (fr-e26): the CPU oracle's chunk function and
 * the production GPU backend factory — everything dimension-specific,
 * behind which `runScenario`'s timed/equal-N/display-downsample pipeline is
 * shared verbatim by the 3D and 4D kernels. Built by {@link prepare3D} /
 * {@link prepare4D}.
 */
interface ScenarioEngines {
  cpuChunk: CpuChunkFn;
  createBackend: () => Promise<FlameAccumBackend>;
}

/** Build a 3D scenario's engines: `prepareChaosGame` + `accumulateFlame`
 * on the oracle side, `createGpuFlameBackend` on the production side. */
function prepare3D(def: ScenarioDef3D): ScenarioEngines {
  const prepared: PreparedChaosGame = prepareChaosGame(
    def.transforms,
    def.finalTransform,
    def.symmetry,
  );
  const palette: Vec3[] = transformColors(def.transforms.length);
  const lut = buildPaletteLUT(def.paletteId) ?? undefined;
  const projection = buildProjection(
    ACCUM_WIDTH,
    ACCUM_HEIGHT,
    def.cameraPos,
    def.lookAt,
  );
  return {
    cpuChunk: (n, histogram, rng) =>
      accumulateFlame(
        prepared,
        projection,
        ACCUM_WIDTH,
        ACCUM_HEIGHT,
        n,
        rng,
        palette,
        histogram,
        lut,
      ),
    createBackend: () =>
      createGpuFlameBackend(toGpuBackendRequest(def, projection)),
  };
}

/** Points in the small explorer-stand-in cloud {@link prepare4D} runs to
 * derive the view exactly the way the app does — enough for stable bounds/
 * center/radius statistics, cheap enough to run once per scenario. */
const EXPLORER_CLOUD_POINTS = 100_000;

/**
 * Build a 4D scenario's engines: `prepareChaosGame4` + `accumulateFlame4`
 * on the oracle side, `createGpuFlameBackend4` on the production side —
 * both fed the IDENTICAL projection/view/color objects, so the comparison
 * pins the kernels, not the setup.
 *
 * The frozen view is derived exactly the way `main.ts`'s
 * `fourDRenderSnapshot` derives the app's: run the explorer's own cloud
 * (`runChaosGame4`, through `def.finalTransform` when the scenario has one —
 * see `toTransform4`'s `null`-preserving lift below), then take its bounds'
 * half-extents into `wSupport(rotor, halfExtents)` for `invWAmp` (same 1e-6
 * degenerate floor), its center as the rotor pivot, and its min/max 4D
 * distance from center as the "radius" color mode's normalization range. The
 * camera isn't authored per scenario like the 3D defs': it looks at the
 * cloud's own xyz-center from a fixed offset direction at `3 * radius` — far
 * enough to frame any of these systems at any tumble angle under the shared
 * 50° FOV.
 */
function prepare4D(def: ScenarioDef4D): ScenarioEngines {
  const transforms4 = def.system().map(toTransform4);
  const final4 =
    def.finalTransform === null ? null : toTransform4(def.finalTransform);
  const prepared4: PreparedChaosGame4 = prepareChaosGame4(transforms4, final4);
  // Lensed cloud: the view (bounds/center/radius statistics below) derives
  // from the explorer cloud exactly the way the app's own explorer cloud
  // does — through the final-transform lens when the scenario has one, not
  // the pre-lens orbit.
  const cloud = runChaosGame4(
    transforms4,
    EXPLORER_CLOUD_POINTS,
    mulberry32(SEED),
    final4,
  );
  const rotor = rotationMatrix4(def.rotation);
  const b = cloud.bounds;
  const halfExtents: Vec4 = [
    (b.maxX - b.minX) / 2,
    (b.maxY - b.minY) / 2,
    (b.maxZ - b.minZ) / 2,
    (b.maxW - b.minW) / 2,
  ];
  const invWAmp = 1 / Math.max(wSupport(rotor, halfExtents), 1e-6);
  const view: FourDView = {
    invWAmp,
    sliceOn: def.sliceOn,
    sliceCenter: def.sliceCenter,
    sliceWidth: def.sliceWidth,
    sliceRelativeColor: def.sliceRelativeColor,
  };

  // The "radius" mode's normalization range: min/max 4D distance from the
  // cloud's center over the explorer cloud itself — fourDRenderSnapshot's
  // own loop, verbatim.
  const { positions, w, count, center } = cloud;
  let radiusMin = Infinity;
  let radiusMax = 0;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - center[0];
    const dy = positions[i * 3 + 1] - center[1];
    const dz = positions[i * 3 + 2] - center[2];
    const dw = w[i] - center[3];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
    if (d < radiusMin) radiusMin = d;
    if (d > radiusMax) radiusMax = d;
  }
  if (!Number.isFinite(radiusMin)) radiusMin = 0;

  const color = buildBenchFourDColor(def, transforms4.length, {
    center,
    radiusMin,
    radiusMax,
  });

  // Auto-framing camera (see this function's doc): a fixed offset direction,
  // distance proportional to the cloud's own bounding radius.
  const dir = new THREE.Vector3(0.8, 0.55, 1.0).normalize();
  const dist = Math.max(3 * cloud.radius, 1e-3);
  const cameraPos: [number, number, number] = [
    center[0] + dir.x * dist,
    center[1] + dir.y * dist,
    center[2] + dir.z * dist,
  ];
  const camera = buildProjection(ACCUM_WIDTH, ACCUM_HEIGHT, cameraPos, [
    center[0],
    center[1],
    center[2],
  ]);
  const projection = composeFlameProjection4(
    camera,
    composeRotorProjection4(rotor, center),
  );

  return {
    cpuChunk: (n, histogram, rng) =>
      accumulateFlame4(
        prepared4,
        projection,
        view,
        ACCUM_WIDTH,
        ACCUM_HEIGHT,
        n,
        rng,
        color,
        histogram,
      ),
    createBackend: () =>
      createGpuFlameBackend4({
        transforms4,
        finalTransform4: final4,
        projection,
        view,
        color,
        width: ACCUM_WIDTH,
        height: ACCUM_HEIGHT,
        seed: SEED,
        displayWidth: DISPLAY_WIDTH,
        displayHeight: DISPLAY_HEIGHT,
        progressiveFilterRadius: FLAME_FILTER_RADIUS,
      } satisfies GpuBackendRequest4),
  };
}

/**
 * The session's `buildFourDColor` dispatch (flame-worker-core.ts), restated
 * over a {@link ScenarioDef4D}: a non-`"legacy"` palette wins (structural),
 * `"legacy"` dispatches on the explorer color mode — same precedence, same
 * LUT/palette constructors, so the bench renders the exact color pipeline
 * the app would for that palette/mode combination.
 */
function buildBenchFourDColor(
  def: ScenarioDef4D,
  transformCount: number,
  cloudStats: { center: Vec4; radiusMin: number; radiusMax: number },
): FourDRenderColor {
  const lut = buildPaletteLUT(def.paletteId);
  if (lut !== null) {
    return { kind: "structural", lut };
  }
  switch (def.colorMode) {
    case "wBlueOrange":
    case "wPurpleGreen":
    case "wCyanMagenta":
      return { kind: "wRamp", side: W_SIDE_PALETTES[def.colorMode] };
    case "transform":
      return { kind: "transform", palette: transformColors(transformCount) };
    case "radius":
      return {
        kind: "radius",
        lut: buildColorModeLUT("radius", 1, def.rampPalette ?? "legacy"),
        center: cloudStats.center,
        minD: cloudStats.radiusMin,
        maxD: cloudStats.radiusMax,
      };
  }
}

/** Build whichever dimension's engines a scenario calls for. */
function buildEngines(def: ScenarioDef): ScenarioEngines {
  return def.kind === "3d" ? prepare3D(def) : prepare4D(def);
}

// ---------------------------------------------------------------------------
// CPU accumulation
// ---------------------------------------------------------------------------

/** Accumulate in CPU_CHUNK_ITERATIONS-sized chunks until Σcall-time reaches
 * `durationSec`, yielding to the event loop between chunks. `onProgress`
 * (see its doc) fires once per chunk, in that same between-chunks gap. */
async function runCpuTimed(
  cpuChunk: CpuChunkFn,
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
    histogram = cpuChunk(CPU_CHUNK_ITERATIONS, histogram, rng);
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
  cpuChunk: CpuChunkFn,
  totalIterations: number,
  onProgress?: ProgressCallback,
): Promise<FlameHistogram> {
  const rng = mulberry32(SEED);
  const firstChunk = Math.min(CPU_CHUNK_ITERATIONS, totalIterations);
  let ms = 0;
  const t0 = performance.now();
  let histogram = cpuChunk(firstChunk, undefined, rng);
  ms += performance.now() - t0;
  let doneIterations = firstChunk;
  onProgress?.(doneIterations / (ms / 1000), doneIterations);
  let remaining = totalIterations - firstChunk;
  while (remaining > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve));
    const n = Math.min(CPU_CHUNK_ITERATIONS, remaining);
    const tChunk0 = performance.now();
    histogram = cpuChunk(n, histogram, rng);
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
 * `FlameAccumBackend` seam — whichever kernel's backend the scenario's
 * `createBackend` engine stands up. Skips gracefully (returns `{ skipped }`)
 * rather than throwing when WebGPU is unavailable, so the page stays usable
 * in non-WebGPU browsers — the production factories themselves never fall
 * back to CPU (see flame-gpu-backend.ts's module doc), so that graceful
 * skip is entirely this page's own doing. */
async function runGpuTimed(
  createBackend: ScenarioEngines["createBackend"],
  durationSec: number,
  onProgress?: ProgressCallback,
): Promise<TimedGpuResult | SkippedResult> {
  let backend: FlameAccumBackend;
  try {
    backend = await createBackend();
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
  createBackend: ScenarioEngines["createBackend"],
  onProgress?: ProgressCallback,
): Promise<GpuEqualNResult | SkippedResult> {
  let backend: FlameAccumBackend;
  try {
    backend = await createBackend();
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
 * the one place `maeThreshold`/`AGREEMENT_BIAS_THRESHOLD` are actually
 * applied. `maeThreshold` is the scenario's own bar (its `maeThreshold`
 * override, or `AGREEMENT_MAE_THRESHOLD`); bias has no scenario-dependent
 * noise floor (shot noise cancels in a SIGNED mean), so its threshold stays
 * global. */
function passesAgreement(
  maeRGB: number,
  biasRGB: [number, number, number],
  maeThreshold: number,
): boolean {
  return (
    maeRGB < maeThreshold &&
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
  // Everything dimension-specific — CPU oracle, projection/view/color
  // derivation, production backend factory — lives behind the engines
  // (fr-e26); the whole pipeline below is shared by the 3D and 4D kernels.
  const engines = buildEngines(def);

  setStatus(dom, `running: cpu timed — ${formatRate(NaN)}`);
  activity.setState("cpu", accumulatingLabel("cpu", NaN));
  const cpuTimed = await runCpuTimed(engines.cpuChunk, durationSec, (rate) => {
    activity.setState("cpu", accumulatingLabel("cpu", rate));
    setStatus(dom, `running: cpu timed — ${formatRate(rate)}`);
  });

  setStatus(dom, `running: gpu timed — ${formatRate(NaN)}`);
  activity.setState("gpu", accumulatingLabel("gpu", NaN));
  const gpuTimed = await runGpuTimed(
    engines.createBackend,
    durationSec,
    (rate) => {
      activity.setState("gpu", accumulatingLabel("gpu", rate));
      setStatus(dom, `running: gpu timed — ${formatRate(rate)}`);
    },
  );

  setStatus(dom, "equal-N: cpu…");
  activity.setState("cpu", accumulatingLabel("cpu", NaN));
  const cpuHist = await runCpuExactly(
    engines.cpuChunk,
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
    const gpuEqualN = await runGpuEqualN(engines.createBackend, (rate) => {
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
      const maeThreshold = def.maeThreshold ?? AGREEMENT_MAE_THRESHOLD;
      comparison = {
        maeRGB: diff.maeRGB,
        biasRGB: diff.biasRGB,
        maxAbs: diff.maxAbs,
        maxHitsCpu: cpuHist.maxHits,
        maxHitsGpu: gpuEqualN.histogram.maxHits,
        maeThreshold,
        pass: passesAgreement(diff.maeRGB, diff.biasRGB, maeThreshold),
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
  // The first 3D scenario's system: this check pins the SHARED downsample
  // kernel's scale-1 pass-through path (dimension-independent — the 4D
  // programs drive the very same kernel; see flame-gpu-4d.ts's module doc),
  // so one dimension's system suffices.
  const def = SCENARIOS.find((s): s is ScenarioDef3D => s.kind === "3d");
  if (!def) {
    return { skipped: "no 3D scenario to build the ss=1 check from" };
  }
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
      palette: def.paletteId,
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

// ---------------------------------------------------------------------------
// Surface-DE WGSL kernel section (fr-q1f8)
// ---------------------------------------------------------------------------
//
// Pins `src/fractal/surface-de-gpu.ts`'s fold-DE compute kernel against
// `estimateDistance` (surface-de.ts, refine=false — the exact estimator the
// kernel mirrors) on real query points, then times the march kernel on
// mandelboxKifs — the brief §3.7 measurement. Runs only when `?surface=1`
// (after the flame scenarios) or `?surface=only` (instead of them), or via
// its own button; with the param absent the flame pipeline above and
// `computeAgreement` behave bit-for-bit as before.

type SurfaceVariant = "shared" | "private";

interface SurfaceSectionConfig {
  agreementWidths: number[];
  timingWidths: number[];
  variants: SurfaceVariant[];
  sharedWg: number;
  privateWg: number;
  rasterWidth: number;
  rasterHeight: number;
  capMs: number;
  systems: "all" | "synthetic";
  timing: boolean;
  force: boolean;
}

interface SurfaceKernelConfig {
  variant: SurfaceVariant;
  width: number;
  stage2: boolean;
  wg: number;
}

interface SurfaceAgreementRow {
  system: string;
  variant: SurfaceVariant;
  width: number;
  stage2: boolean;
  wg: number;
  n: number;
  maxAbsErr: number;
  /** Max of `absErr / max(|cpu|, 0.05·R)` — the tolerance's own scale. */
  maxRelErr: number;
  p99AbsErr: number;
  /** Whether this row gates the section verdict. The CPU oracle's fold
   * frontier width is the FIXED module constant
   * `SURFACE_FOLD_BEAM_WIDTH` (12) — `estimateDistance` cannot be built
   * narrower (the fr-ck0w sweep rewrote the source to change it) — so
   * only rows at exactly that width compare like against like. Narrower
   * kernel widths are still run as an INFORMATIONAL measurement of the
   * fr-5rvk narrow-width erosion (a real, expected estimator difference,
   * not kernel disagreement). */
  gating: boolean;
  /** Queries whose error exceeded
   * `max(2e-4·R, 2e-3·max(|cpu|, 0.05·R))` — any nonzero count on a
   * GATING row fails the section verdict; on non-gating rows it counts
   * the expected width-erosion excursions. */
  failures: number;
  /** Error-distribution report (diagnosis, not gating): the most positive
   * and most negative `gpu − cpu`. At a width NARROWER than the oracle's
   * both signs are pure width effects, per the descendFold doc: silent
   * in-sphere floor-0 drops lose the true ancestor chain and OVERSHOOT
   * (gpu > cpu — fr-5rvk measured exactly this on-attractor), while
   * drop-folded escaped certificates freeze shallow and UNDER-estimate
   * ("loses tightness, never validity"). At the production width both
   * must vanish into f32 noise. */
  maxGpuMinusCpu: number;
  minGpuMinusCpu: number;
  /** Failures where the GPU OVER-estimated (gpu > cpu) — the dangerous
   * direction for a distance bound. */
  failuresOver: number;
  /** Failures split by the query mix's deterministic layout: first 400
   * jittered, next 200 uniform, last 100 exact on-attractor. */
  failuresByClass: { jittered: number; uniform: number; exact: number };
}

interface SurfaceCrossCheckRow {
  /** "shared-vs-private": identical (width, stage2) must be EXACTLY equal
   * (same arithmetic, different frontier storage) — mismatches fail the
   * verdict. "stage2-on-vs-off": informational only — the fr-kidj stage-2
   * skips are value no-ops in exact arithmetic, but f32 rounding may flip
   * marginal frontier insertions, so deltas are reported, never gated. */
  kind: "shared-vs-private" | "stage2-on-vs-off";
  system: string;
  width: number;
  n: number;
  mismatches: number;
  maxDelta: number;
  note: string;
}

interface SurfaceTimingRow {
  variant: SurfaceVariant;
  width: number;
  stage2: boolean;
  wg: number;
  rays: number;
  hits: number;
  miss: number;
  exhausted: number;
  activeRemaining: number;
  meanSteps: number;
  /** Σ per-pass performance.now() span submit → onSubmittedWorkDone. */
  gpuMs: number;
  wallMs: number;
  /** Shader-module + pipeline creation time — the headline number against
   * the WebGL fold tracer's ~25s links. */
  compileMs: number;
  passes: number;
  truncated: boolean;
  completedFraction?: number;
  /** `gpuMs / fractionOfRayStepsDone` where the fraction assumes every
   * still-active ray runs to the full step budget — an EXTRAPOLATION, not a
   * measurement. */
  extrapolatedMs?: number;
  gpuHitRate?: number;
  cpuHitRate?: number;
  /** "suspect" when |gpuHitRate − cpuHitRate| > 0.15 on the sampled pixels
   * — informational (f32 trajectories legitimately diverge; only a gross
   * mismatch matters). */
  sanity?: "ok" | "suspect" | "skipped (truncated)";
}

/**
 * fr-tzdg leg A — the march-unproject agreement gate: the app path's ray
 * derivation (`rays:"unproject"`, dirs from ShadeParams.invProjView, the
 * exact kernel config `SurfaceComputeRenderer` compiles) marched to
 * completion and compared per ray against a CPU emulator that derives rays
 * by the SAME f32 unproject arithmetic and then runs `surfaceCpuMarch`'s
 * loop on the plain-`estimateDistance` oracle. GATING: any `failures` (or a
 * truncated march, which verifies nothing) fails the section.
 */
interface SurfaceUnprojectRow {
  system: string;
  width: number;
  wg: number;
  rasterWidth: number;
  rasterHeight: number;
  rays: number;
  /** Rays whose terminal status (hit/miss/exhausted) differs. */
  statusMismatches: number;
  /** Status mismatches excluded from the gate per {@link boundaryFlipRule}:
   * CPU and GPU tracked the same trajectory (final `t` within the hit-t
   * tolerance) and only classified its terminal event differently —
   * f32-vs-f64 noise at the hit floor / sphere exit / budget edge, not ray
   * or estimator disagreement. */
  boundaryFlips: number;
  /** The exclusion rule, verbatim, so the row is self-reporting. */
  boundaryFlipRule: string;
  /** Max |gpuT − cpuT| over rays where BOTH sides hit — grazes included,
   * so a nonzero {@link hitTGrazes} row legitimately shows a large max. */
  maxAbsT: number;
  /** Both-hit rays over the t tolerance whose GPU endpoint the CPU oracle
   * CONFIRMS on-surface (see {@link boundaryFlipRule}) — silhouette grazes
   * resolved to a different sheet: at a graze one f32 trajectory fires
   * `d < eps` on the near sheet where the other skims past at `d ≥ eps`
   * and hits genuinely deeper (measured: 1 ray of 660 hits on Iris Xe,
   * Δt 2e-2). Excluded from the gate. */
  hitTGrazes: number;
  /** Both-hit rays whose |gpuT − cpuT| exceeded the eval gate's tolerance
   * formula applied to the hit distance —
   * `max(2e-4·R, 2e-3·max(|cpuT|, 0.05·R))` — AND whose GPU endpoint the
   * oracle could NOT confirm on-surface: real disagreement. */
  hitTFailures: number;
  /** `(statusMismatches − boundaryFlips) + hitTFailures` — any nonzero
   * fails the section. */
  failures: number;
  gpuHits: number;
  cpuHits: number;
  compileMs: number;
  gpuMs: number;
  passes: number;
  truncated: boolean;
}

/**
 * fr-tzdg leg B — one end-to-end frame through the PRODUCTION
 * `SurfaceComputeRenderer` (march slices + shade batches, the app's exact
 * host loop), presented onto a canvas the headless runner screenshots.
 * Informational, except: zero hit rays on a REAL adapter, or a null
 * `renderFrame`, fail the section (see the verdict computation).
 */
interface SurfaceComputeFrameRow {
  width: number;
  height: number;
  wallMs: number;
  gpuMs: number;
  passes: number;
  truncated: boolean;
  counts: { hit: number; miss: number; exhausted: number; active: number };
}

interface SurfaceDeResults {
  verdict: "pass" | "fail" | "skipped";
  reason?: string;
  adapter: BenchAdapterInfo | null;
  limits: Record<string, number>;
  agreement: SurfaceAgreementRow[];
  crossChecks: SurfaceCrossCheckRow[];
  timing: SurfaceTimingRow[];
  /** fr-tzdg leg A (gating) — absent until the leg runs; SkippedResult when
   * it could not run (the error is also in notes, and the verdict fails). */
  marchUnproject?: SurfaceUnprojectRow | SkippedResult;
  /** fr-tzdg leg B (informational + canvas artifact) — absent until run;
   * SkippedResult when mandelboxKifs was excluded or the renderer broke. */
  computeFrame?: SurfaceComputeFrameRow | SkippedResult;
  /** Skipped configs/systems, WGSL compile errors (verbatim), and other
   * per-run context — never silent. */
  notes: string[];
}

/** Chaos-cloud size behind the agreement query set — the surface-beam
 * harness's CLOUD default is 300k; 100k keeps the page budget while the
 * query MECHANICS stay the harness's verbatim. */
const SURFACE_CLOUD_POINTS = 100_000;

/** `SURFACE_FULL_MARCH_STEPS` mirror (`src/app/surface-material.ts`) — the
 * full-tier whole-ray analytic budget the timing march replays. Duplicated
 * like the harness emulators do (fold-cost-split.harness.ts's convention)
 * rather than importing the three-laden material module. */
const SURFACE_MARCH_STEPS = 160;

/** poseRays pose (scripts/fold-cost-split.harness.ts): off-axis orbit
 * angles deliberately not aligned to any coordinate plane or mandelboxKifs's
 * T_d symmetry, distance as a multiple of the visible bounding radius. */
const SURFACE_POSE_THETA = 0.9;
const SURFACE_POSE_PHI = 1.2;
const SURFACE_POSE_DIST_FACTOR = 2.4;
const SURFACE_POSE_FOV_DEG = 60;

/** Cone-eps slope `2·tan(fov/2) / 720` — 720 is the fr-ck0w width sweep's
 * viewport HEIGHT (scripts/fold-width-sweep.mjs), deliberately DECOUPLED
 * from the bench raster exactly like erosion-repro.harness.ts's
 * APP_PIXEL_EPS: the raster only decides how many rays we trace, not how
 * fine the hit test is. */
const SURFACE_PIXEL_EPS =
  (2 * Math.tan((SURFACE_POSE_FOV_DEG * Math.PI) / 360)) / 720;

/** Adaptive stepsThisPass: start at 1, double while the last pass came in
 * under the target, capped — every submission stays bounded (the fr-096u
 * i915 preemption-timeout lesson, host-side). */
const SURFACE_PASS_TARGET_MS = 250;
const SURFACE_MAX_STEPS_PER_PASS = 32;

/** The CPU sanity march samples every Nth pixel in both raster axes. */
const SURFACE_SANITY_STRIDE = 8;
/** Hit-rate gap beyond which a timing config's sanity reads "suspect". */
const SURFACE_SANITY_HIT_RATE_TOL = 0.15;

/** WebGPU's default `maxComputeWorkgroupStorageSize` — above this the
 * device must be asked for more at acquisition (surface-de-gpu.ts doc). */
const SURFACE_DEFAULT_WORKGROUP_STORAGE = 16_384;

/** fr-tzdg leg A raster — an agreement gate, not a timing, so small keeps
 * both the CPU emulator (a full estimateDistance march per pixel) and the
 * SwiftShader CI path affordable. 16:9 like the timing raster, so leg B's
 * real-adapter raster shares the same aspect (and therefore the same
 * invProjView tanHalf column scaling). */
const SURFACE_UNPROJ_WIDTH = 96;
const SURFACE_UNPROJ_HEIGHT = 54;

/** Leg A must reach COMPLETION to gate anything (a truncated march has
 * unverifiable rays), so it carries its own generous cap instead of the
 * timing legs' `surfaceCapMs` — on SwiftShader the march is slow but small
 * (5184 rays); truncation is reported and FAILS the leg, never waters down
 * the comparison. */
const SURFACE_UNPROJ_CAP_MS = 600_000;

/** Leg A march pacing: unlike the timing legs' `runSurfaceMarchConfig`
 * (real adapters only — software adapters skip timing), this leg's march
 * also runs on SwiftShader, where the kernel executes on the CPU and a
 * whole-raster dispatch of width-12 descents is a MINUTES-long single
 * submission — Chrome kills the GPU process (and took the page with it,
 * measured on the first CI-shaped run of this leg) — exactly the
 * unbounded-submission class fr-096u bans. So the leg's own host loop
 * slices the ACTIVE LIST too (surface-compute.ts's marchChunkFor idea,
 * floor sized for software costs), from a deliberately pessimistic
 * initial per-ray·step cost on software adapters that the measured EMA
 * immediately corrects; step growth waits on MEASURED sub-target passes,
 * never assumed ones. */
const SURFACE_UNPROJ_MIN_CHUNK = 64;
const SURFACE_UNPROJ_INITIAL_RAY_STEP_US_SW = 1000;

/** fr-tzdg leg B raster/budget: full-tier knobs at 256x144 on a real
 * adapter; the SwiftShader CI path shrinks the raster and stretches the
 * budget (truncation is accepted there — software timing is not the
 * point, the exercised host loop is). */
const SURFACE_FRAME_WIDTH = 256;
const SURFACE_FRAME_HEIGHT = 144;
const SURFACE_FRAME_WIDTH_SW = 96;
const SURFACE_FRAME_HEIGHT_SW = 54;
const SURFACE_FRAME_BUDGET_MS = 120_000;
const SURFACE_FRAME_BUDGET_SW_MS = 300_000;

/** Leg B full-tier shading budgets — `SURFACE_FULL_SHADOW_STEPS` /
 * `SURFACE_FULL_AO_TAPS` mirrors (surface-material.ts), duplicated like
 * {@link SURFACE_MARCH_STEPS} is. */
const SURFACE_FRAME_SHADOW_STEPS = 32;
const SURFACE_FRAME_AO_TAPS = 5;

/** Both maps pure `spherefold` — the hardest void-false-hit profile in the
 * fr-5rvk set. Mirrors scripts/harness-profiles.ts — keep in sync
 * (importing from scripts/ into the Vite page is off-limits). */
function surfaceFoldSpherefoldPair(): Transform[] {
  return [
    {
      id: 0,
      position: [0.5, 0.2, -0.1],
      rotation: [0.4, 0.1, 0.2],
      scale: [0.24, 0.24, 0.24],
      variations: [{ type: "spherefold", weight: 0.9 }],
    },
    {
      id: 1,
      position: [-0.3, -0.4, 0.25],
      rotation: [0, 0.6, 0.3],
      scale: [0.2, 0.2, 0.2],
      variations: [{ type: "spherefold", weight: 1.1 }],
    },
  ];
}

/** A NEGATIVE-weight boxfold map beside a plain affine map: sign absorption
 * plus the mixed frontier where fold branches and affine children compete.
 * Mirrors scripts/harness-profiles.ts — keep in sync. */
function surfaceFoldBoxfoldNegPlusAffine(): Transform[] {
  return [
    {
      id: 0,
      position: [0.3, 0, 0.2],
      rotation: [0.1, 0, 0.4],
      scale: [0.5, 0.5, 0.5],
      variations: [{ type: "boxfold", weight: -0.8 }],
    },
    {
      id: 1,
      position: [-0.4, 0.3, -0.1],
      rotation: [0.2, 0.3, 0],
      scale: [0.4, 0.4, 0.4],
    },
  ];
}

function parseSurfaceIntList(raw: string | null, fallback: number[]): number[] {
  if (raw === null) return fallback;
  const parsed = raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 1);
  return parsed.length > 0 ? parsed : fallback;
}

/** URL-param surface config, all optional: `surfaceWidths` (agreement,
 * default 12,4), `surfaceTimingWidths` (default 12,8,6,4),
 * `surfaceVariants` (default shared,private), `surfaceWg` (shared default
 * 32; private uses 64 unless the param is given, in which case both use
 * it), `surfaceSize` (march raster, default 320x180), `surfaceCapMs`
 * (per-timing-config wall cap, default 120000), `surfaceSystems`
 * (all|synthetic — synthetic skips the mandelboxKifs preset),
 * `surfaceTiming` (0 skips timing), `surfaceForce` (1 runs timing even on
 * a software adapter). */
function parseSurfaceConfig(params: URLSearchParams): SurfaceSectionConfig {
  const variants = (params.get("surfaceVariants") ?? "shared,private")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SurfaceVariant => s === "shared" || s === "private");
  const wgRaw = params.get("surfaceWg");
  const wgParsed = wgRaw === null ? NaN : Number.parseInt(wgRaw, 10);
  const wgGiven = Number.isInteger(wgParsed) && wgParsed >= 1;
  const sizeMatch = /^(\d+)x(\d+)$/.exec(params.get("surfaceSize") ?? "");
  const capParsed = Number.parseInt(params.get("surfaceCapMs") ?? "", 10);
  return {
    agreementWidths: parseSurfaceIntList(params.get("surfaceWidths"), [12, 4]),
    timingWidths: parseSurfaceIntList(
      params.get("surfaceTimingWidths"),
      [12, 8, 6, 4],
    ),
    variants: variants.length > 0 ? variants : ["shared", "private"],
    sharedWg: wgGiven ? wgParsed : 32,
    privateWg: wgGiven ? wgParsed : 64,
    rasterWidth: sizeMatch ? Number.parseInt(sizeMatch[1], 10) : 320,
    rasterHeight: sizeMatch ? Number.parseInt(sizeMatch[2], 10) : 180,
    capMs: Number.isFinite(capParsed) && capParsed > 0 ? capParsed : 120_000,
    systems: params.get("surfaceSystems") === "synthetic" ? "synthetic" : "all",
    timing: params.get("surfaceTiming") !== "0",
    force: params.get("surfaceForce") === "1",
  };
}

function surfaceWgFor(
  config: SurfaceSectionConfig,
  variant: SurfaceVariant,
): number {
  return variant === "shared" ? config.sharedWg : config.privateWg;
}

/**
 * The surface-beam harness's spike-shaped query mix — `queries3` plus
 * `probe3`'s cloud call, mechanics copied verbatim (seeds included) at the
 * page-budget cloud size: 400 jittered cloud samples (mulberry32(2),
 * ±0.15/axis), 200 uniform cube points (mulberry32(3), half-extent 1.2·R),
 * 100 exact cloud samples — 700 queries.
 *
 * Every component is `Math.fround`ed: the kernel unavoidably receives f32
 * query points (`array<vec4f>`), so rounding BEFORE the CPU oracle makes
 * both sides evaluate the IDENTICAL point — any disagreement is then kernel
 * arithmetic, not query quantization. (≤1 f32 ulp off the harness's f64
 * points; cloud samples are already f32.)
 */
function surfaceQueries(transforms: Transform[], radius: number): Vec3[] {
  const cloud = runChaosGame(
    transforms,
    SURFACE_CLOUD_POINTS,
    mulberry32(101),
    null,
    { order: 1, axis: "y" },
  );
  const out: Vec3[] = [];
  const jitterRng = mulberry32(2);
  const stride = Math.max(1, Math.floor(cloud.count / 400));
  for (let i = 0; i < cloud.count && out.length < 400; i += stride) {
    out.push([
      Math.fround(cloud.positions[i * 3] + (jitterRng() - 0.5) * 0.3),
      Math.fround(cloud.positions[i * 3 + 1] + (jitterRng() - 0.5) * 0.3),
      Math.fround(cloud.positions[i * 3 + 2] + (jitterRng() - 0.5) * 0.3),
    ]);
  }
  const uniformRng = mulberry32(3);
  const half = 1.2 * radius;
  for (let i = 0; i < 200; i++) {
    out.push([
      Math.fround((uniformRng() - 0.5) * 2 * half),
      Math.fround((uniformRng() - 0.5) * 2 * half),
      Math.fround((uniformRng() - 0.5) * 2 * half),
    ]);
  }
  for (let i = 0; i < 100; i++) {
    const j = Math.floor((cloud.count * (i + 0.5)) / 100);
    out.push([
      cloud.positions[j * 3],
      cloud.positions[j * 3 + 1],
      cloud.positions[j * 3 + 2],
    ]);
  }
  return out;
}

function surfaceNormalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function surfaceCross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** `poseRays`'s camera math (scripts/fold-cost-split.harness.ts) verbatim —
 * target origin, orbit angles (0.9, 1.2), distance
 * 2.4 × visibleBoundingRadius, vertical fov 60° — packed into the kernel's
 * {@link SurfaceGpuPose}. */
function buildSurfacePose(
  de: SurfaceDE,
  rasterWidth: number,
  rasterHeight: number,
): SurfaceGpuPose {
  const target: Vec3 = [0, 0, 0];
  const radius = SURFACE_POSE_DIST_FACTOR * de.visibleBoundingRadius;
  const ro: Vec3 = [
    target[0] +
      radius * Math.sin(SURFACE_POSE_PHI) * Math.sin(SURFACE_POSE_THETA),
    target[1] + radius * Math.cos(SURFACE_POSE_PHI),
    target[2] +
      radius * Math.sin(SURFACE_POSE_PHI) * Math.cos(SURFACE_POSE_THETA),
  ];
  const fwd = surfaceNormalize([
    target[0] - ro[0],
    target[1] - ro[1],
    target[2] - ro[2],
  ]);
  const right = surfaceNormalize(surfaceCross(fwd, [0, 1, 0]));
  const up = surfaceCross(right, fwd);
  const fov = (SURFACE_POSE_FOV_DEG * Math.PI) / 180;
  return {
    ro,
    right,
    up,
    fwd,
    tanHalf: Math.tan(fov / 2),
    aspect: rasterWidth / rasterHeight,
    rasterWidth,
    rasterHeight,
    pixelEps: SURFACE_PIXEL_EPS,
  };
}

/** The KERNEL's own pixel→ray mapping (marchRays' NDC lines) — used by the
 * CPU sanity march so "the same pixels" is literal. Note the kernel's ndcY
 * is poseRays' NEGATED (no vertical flip); the pose vectors are identical,
 * so this only re-indexes rows, but a per-pixel comparison must use the
 * kernel's convention. */
function surfaceRayDir(pose: SurfaceGpuPose, px: number, py: number): Vec3 {
  const ndcX = ((px + 0.5) / pose.rasterWidth) * 2 - 1;
  const ndcY = ((py + 0.5) / pose.rasterHeight) * 2 - 1;
  const dx = ndcX * pose.tanHalf * pose.aspect;
  const dy = ndcY * pose.tanHalf;
  return surfaceNormalize([
    pose.fwd[0] + pose.right[0] * dx + pose.up[0] * dy,
    pose.fwd[1] + pose.right[1] * dx + pose.up[1] * dy,
    pose.fwd[2] + pose.right[2] * dx + pose.up[2] * dy,
  ]);
}

/** The GLSL march minus shading, ported from erosion-repro.harness.ts's
 * `march()` WITHOUT the grid branches (gridless) and on the PLAIN
 * `estimateDistance` — the same sphere gate, cone-eps hit test, budget and
 * stepScale the kernel's marchRays runs, with the DE's eps passed as the
 * cutoff exactly like both of them. */
function surfaceCpuMarch(
  de: SurfaceDE,
  ro: Vec3,
  rd: Vec3,
  pixelEps: number,
  maxSteps: number,
): boolean {
  const radius = de.visibleBoundingRadius * 1.02;
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return false;
  const sq = Math.sqrt(disc);
  const tFar = -b + sq;
  if (tFar <= 0) return false;
  let t = Math.max(-b - sq, 0);
  for (let i = 0; i < maxSteps; i++) {
    if (t > tFar) break;
    const eps = Math.max(
      pixelEps * t,
      de.boundingRadius * SURFACE_GPU_HIT_FLOOR,
    );
    const p: Vec3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const d = estimateDistance(de, p, eps);
    if (d < eps) return true;
    t += d * de.stepScale;
  }
  return false;
}

/**
 * `inverse(P·V)` for the harness pose — the exact matrix scene.ts uploads
 * as uInvProjView (column-major THREE.Matrix4.elements), constructed from
 * the SAME pose basis the march legs use: camera world matrix with columns
 * right/up/−fwd/ro (THREE cameras look down local −Z), symmetric
 * perspective from the pose's tanHalf/aspect. near/far only shape the
 * matrix's depth row — the unproject divides them back out — so round
 * radius-proportional picks are fine. Returned as Float32Array so the CPU
 * emulator reads the IDENTICAL f32 entries the kernel's uniform holds.
 */
function surfaceInvProjView(de: SurfaceDE, pose: SurfaceGpuPose): Float32Array {
  const near = de.boundingRadius * 1e-3;
  const far = de.boundingRadius * 10;
  const top = near * pose.tanHalf;
  const right = top * pose.aspect;
  const proj = new THREE.Matrix4().makePerspective(
    -right,
    right,
    top,
    -top,
    near,
    far,
  );
  // prettier-ignore
  const world = new THREE.Matrix4().set(
    pose.right[0], pose.up[0], -pose.fwd[0], pose.ro[0],
    pose.right[1], pose.up[1], -pose.fwd[1], pose.ro[1],
    pose.right[2], pose.up[2], -pose.fwd[2], pose.ro[2],
    0, 0, 0, 1,
  );
  const view = world.clone().invert();
  const inv = new THREE.Matrix4().multiplyMatrices(proj, view).invert();
  return new Float32Array(inv.elements);
}

/**
 * The march "unproject" kernel's per-pixel ray, emulated in f32: every
 * intermediate `Math.fround`ed (surfaceQueries' discipline) over the SAME
 * Float32Array matrix entries the kernel's ShadeParams uniform holds — ndc
 * from pixel centers, near/far clip points through invProjView with
 * perspective divides, `normalize(far − near)`. Residual GPU-vs-emulator
 * noise (accumulation order, fma) is what the leg's tolerance absorbs.
 */
function surfaceUnprojectRay(
  inv: Float32Array,
  px: number,
  py: number,
  rasterWidth: number,
  rasterHeight: number,
): Vec3 {
  const f = Math.fround;
  const ndcX = f(f(f(f(px + 0.5) / rasterWidth) * 2) - 1);
  const ndcY = f(f(f(f(py + 0.5) / rasterHeight) * 2) - 1);
  const mul = (z: number): [number, number, number, number] => {
    const out: [number, number, number, number] = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      let acc = f(inv[r] * ndcX);
      acc = f(acc + f(inv[4 + r] * ndcY));
      acc = f(acc + f(inv[8 + r] * z));
      acc = f(acc + inv[12 + r]);
      out[r] = acc;
    }
    return out;
  };
  const nearP = mul(-1);
  const farP = mul(1);
  const dx = f(f(farP[0] / farP[3]) - f(nearP[0] / nearP[3]));
  const dy = f(f(farP[1] / farP[3]) - f(nearP[1] / nearP[3]));
  const dz = f(f(farP[2] / farP[3]) - f(nearP[2] / nearP[3]));
  const len = f(Math.sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz))));
  return [f(dx / len), f(dy / len), f(dz / len)];
}

/**
 * {@link surfaceCpuMarch} with the terminal CONTRACT surfaced — status +
 * final `t`, mirroring marchRays' persisted-state semantics exactly (one
 * continuous f64 loop ≡ the kernel's pass-bounded loop resumed on
 * `(t, steps)`; the check order — sphere exit, then budget, then eval — is
 * the kernel's). Ray derivation is the caller's; the loop itself stays
 * surfaceCpuMarch's: f64 accumulation, plain `estimateDistance`, the same
 * eps/hit-floor/stepScale. Pre-gate misses report `t = −1`, matching the
 * kernel's untouched `st.x` initialization.
 */
function surfaceCpuMarchState(
  de: SurfaceDE,
  ro: Vec3,
  rd: Vec3,
  pixelEps: number,
  maxSteps: number,
): { status: number; t: number } {
  const radius = de.visibleBoundingRadius * 1.02;
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return { status: SURFACE_GPU_RAY_MISS, t: -1 };
  const sq = Math.sqrt(disc);
  const tFar = -b + sq;
  if (tFar <= 0) return { status: SURFACE_GPU_RAY_MISS, t: -1 };
  let t = Math.max(-b - sq, 0);
  let steps = 0;
  for (;;) {
    if (t > tFar) return { status: SURFACE_GPU_RAY_MISS, t };
    if (steps >= maxSteps) return { status: SURFACE_GPU_RAY_EXHAUSTED, t };
    const eps = Math.max(
      pixelEps * t,
      de.boundingRadius * SURFACE_GPU_HIT_FLOOR,
    );
    const p: Vec3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const d = estimateDistance(de, p, eps);
    steps++;
    if (d < eps) return { status: SURFACE_GPU_RAY_HIT, t };
    t += d * de.stepScale;
  }
}

/** Every SURFACE_SANITY_STRIDE-th pixel in both axes, as ray indices. */
function surfaceSanityPixels(width: number, height: number): number[] {
  const out: number[] = [];
  for (let py = 0; py < height; py += SURFACE_SANITY_STRIDE) {
    for (let px = 0; px < width; px += SURFACE_SANITY_STRIDE) {
      out.push(py * width + px);
    }
  }
  return out;
}

interface SurfaceDeviceHandle {
  device: GPUDevice;
  adapterInfo: BenchAdapterInfo;
  software: boolean;
  limits: Record<string, number>;
}

/**
 * One device for the whole section, per flame-gpu-backend.ts's acquisition
 * discipline: high-performance adapter; requiredLimits passing the
 * adapter's real maxStorageBufferBindingSize/maxBufferSize ceilings through
 * (devices otherwise silently default to WebGPU's spec minimums — see the
 * comment there); PLUS `maxComputeWorkgroupStorageSize` when any
 * shared-frontier config needs more than the 16384-byte default (clamped to
 * what the adapter offers — configs the grant still can't cover are skipped
 * per config, with a note, never silently).
 */
async function acquireSurfaceDevice(
  neededWorkgroupBytes: number,
): Promise<SurfaceDeviceHandle | { skipped: string }> {
  if (!navigator.gpu) {
    return { skipped: "WebGPU unavailable (navigator.gpu is undefined)" };
  }
  let adapter: GPUAdapter | null;
  try {
    adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
  } catch (e) {
    return { skipped: `requestAdapter threw: ${describeError(e)}` };
  }
  if (!adapter) {
    return { skipped: "requestAdapter() returned null — no WebGPU adapter" };
  }
  const requiredLimits: Record<string, number> = {
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize,
  };
  if (neededWorkgroupBytes > SURFACE_DEFAULT_WORKGROUP_STORAGE) {
    requiredLimits.maxComputeWorkgroupStorageSize = Math.min(
      adapter.limits.maxComputeWorkgroupStorageSize,
      neededWorkgroupBytes,
    );
  }
  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({ requiredLimits });
  } catch (e) {
    return { skipped: `requestDevice failed: ${describeError(e)}` };
  }
  const info = adapter.info;
  const adapterInfo: BenchAdapterInfo = {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
  };
  return {
    device,
    adapterInfo,
    software: isSoftwareAdapter(adapterInfo),
    limits: {
      maxComputeWorkgroupStorageSize:
        device.limits.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup:
        device.limits.maxComputeInvocationsPerWorkgroup,
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
      maxBufferSize: device.limits.maxBufferSize,
      adapterMaxComputeWorkgroupStorageSize:
        adapter.limits.maxComputeWorkgroupStorageSize,
      requestedWorkgroupStorage: neededWorkgroupBytes,
    },
  };
}

/**
 * Shader module + compute pipeline for one kernel config, under the
 * out-of-memory + validation error-scope pair (flame-gpu-backend.ts's
 * resource-creation discipline) and an explicit pipeline layout (never
 * "auto"). WGSL diagnostics surface as `line:col: message` VERBATIM (plus
 * the offending source line) — the lead needs them untouched to fix the
 * kernel. `compileMs` spans module + pipeline creation.
 */
async function buildSurfacePipeline(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  code: string,
  entryPoint: "evalQueries" | "marchRays",
  label: string,
): Promise<{ pipeline: GPUComputePipeline; compileMs: number }> {
  const t0 = performance.now();
  device.pushErrorScope("out-of-memory");
  device.pushErrorScope("validation");
  const module = device.createShaderModule({ label, code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === "error");
  if (errors.length > 0) {
    await device.popErrorScope();
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
      layout,
      compute: { module, entryPoint },
    });
  } catch (e) {
    await device.popErrorScope();
    await device.popErrorScope();
    throw new Error(
      `pipeline creation failed (${label}): ${describeError(e)}`,
      { cause: e },
    );
  }
  const validation = await device.popErrorScope();
  const oom = await device.popErrorScope();
  if (oom) {
    throw new Error(
      `pipeline creation (${label}): out-of-memory: ${oom.message}`,
    );
  }
  if (validation) {
    throw new Error(
      `pipeline creation (${label}): validation: ${validation.message}`,
    );
  }
  return { pipeline, compileMs: performance.now() - t0 };
}

/** `createBuffer` under the same error-scope pair — WebGPU's createBuffer
 * never throws on allocation failure (see flame-gpu-backend.ts's doc), so
 * the scopes convert that into a create-time failure here. */
async function createSurfaceBuffer(
  device: GPUDevice,
  label: string,
  size: number,
  usage: GPUBufferUsageFlags,
): Promise<GPUBuffer> {
  device.pushErrorScope("out-of-memory");
  device.pushErrorScope("validation");
  const buffer = device.createBuffer({ label, size, usage });
  const validation = await device.popErrorScope();
  const oom = await device.popErrorScope();
  if (oom || validation) {
    buffer.destroy();
    throw new Error(
      `createBuffer(${label}): ${(oom ?? validation)?.message ?? "error"}`,
    );
  }
  return buffer;
}

/** One agreement system's frozen state: DE, query set, CPU-oracle values,
 * and (once created) its GPU-side buffers + bind group. */
interface SurfaceSystemState {
  name: string;
  de: SurfaceDE;
  /** The authored transform count behind `de` — what the app keys
   * `transformColors` on (fr-tzdg leg B copies that keying). */
  transformCount: number;
  queries: Vec3[];
  cpu: number[];
  buffers?: {
    params: GPUBuffer;
    maps: GPUBuffer;
    input: GPUBuffer;
    output: GPUBuffer;
    staging: GPUBuffer;
    bindGroup: GPUBindGroup;
  };
}

/** The section's fixed 4-binding interface (surface-de-gpu.ts's contract):
 * 0 = params uniform, 1 = maps storage read, 2 = input storage read,
 * 3 = output storage read_write. Shared by eval and march. */
function surfaceBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: "surface-de bind group layout",
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
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ],
  });
}

/** The march "unproject" interface (fr-tzdg): the march set (0-3) plus
 * binding 4 = the 128-byte ShadeParams uniform the kernel reads its rays +
 * dither inputs from (surface-de-gpu.ts's binding table). */
function surfaceUnprojectBindGroupLayout(
  device: GPUDevice,
): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: "surface-de march-unproject bind group layout",
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
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
    ],
  });
}

async function ensureSurfaceEvalBuffers(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sys: SurfaceSystemState,
): Promise<NonNullable<SurfaceSystemState["buffers"]>> {
  if (sys.buffers) return sys.buffers;
  const n = sys.queries.length;
  // eval params are config-independent: itemCount = query count, cutoff 0,
  // footprint 0 — the oracle's estimateDistance(de, q, 0) call, mirrored.
  const paramsData = packSurfaceGpuParams(sys.de, {
    itemCount: n,
    cutoff: 0,
    footprint: 0,
  });
  // Re-wrapped copy: packSurfaceGpuMaps' bare Float32Array type
  // (ArrayBufferLike-backed) doesn't satisfy writeBuffer's non-shared
  // buffer requirement, and the kernel module stays untouched.
  const mapsData = new Float32Array(packSurfaceGpuMaps(sys.de));
  const inputData = new Float32Array(n * 4);
  sys.queries.forEach((q, i) => {
    inputData[i * 4] = q[0];
    inputData[i * 4 + 1] = q[1];
    inputData[i * 4 + 2] = q[2];
  });
  const params = await createSurfaceBuffer(
    device,
    `surface-de params ${sys.name}`,
    paramsData.byteLength,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(params, 0, paramsData);
  const maps = await createSurfaceBuffer(
    device,
    `surface-de maps ${sys.name}`,
    mapsData.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(maps, 0, mapsData);
  const input = await createSurfaceBuffer(
    device,
    `surface-de queries ${sys.name}`,
    inputData.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(input, 0, inputData);
  const output = await createSurfaceBuffer(
    device,
    `surface-de results ${sys.name}`,
    n * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  );
  const staging = await createSurfaceBuffer(
    device,
    `surface-de staging ${sys.name}`,
    n * 4,
    GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  );
  const bindGroup = device.createBindGroup({
    label: `surface-de bind group ${sys.name}`,
    layout,
    entries: [
      { binding: 0, resource: { buffer: params } },
      { binding: 1, resource: { buffer: maps } },
      { binding: 2, resource: { buffer: input } },
      { binding: 3, resource: { buffer: output } },
    ],
  });
  sys.buffers = { params, maps, input, output, staging, bindGroup };
  return sys.buffers;
}

function destroySurfaceEvalBuffers(sys: SurfaceSystemState): void {
  if (!sys.buffers) return;
  sys.buffers.params.destroy();
  sys.buffers.maps.destroy();
  sys.buffers.input.destroy();
  sys.buffers.output.destroy();
  sys.buffers.staging.destroy();
  sys.buffers = undefined;
}

async function runSurfaceEvalDispatch(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  sys: SurfaceSystemState,
  wg: number,
): Promise<Float32Array> {
  const bufs = sys.buffers;
  if (!bufs) throw new Error("eval buffers not created");
  const n = sys.queries.length;
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bufs.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(n / wg));
  pass.end();
  encoder.copyBufferToBuffer(bufs.output, 0, bufs.staging, 0, n * 4);
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await bufs.staging.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(bufs.staging.getMappedRange().slice(0));
  bufs.staging.unmap();
  return out;
}

function compareSurfaceAgreement(
  sys: SurfaceSystemState,
  cfg: SurfaceKernelConfig,
  gpu: Float32Array,
): SurfaceAgreementRow {
  const R = sys.de.boundingRadius;
  const absErrs: number[] = [];
  let maxAbsErr = 0;
  let maxRelErr = 0;
  let failures = 0;
  let maxGpuMinusCpu = -Infinity;
  let minGpuMinusCpu = Infinity;
  let failuresOver = 0;
  const failuresByClass = { jittered: 0, uniform: 0, exact: 0 };
  for (let i = 0; i < sys.cpu.length; i++) {
    const cpu = sys.cpu[i];
    const signed = gpu[i] - cpu;
    const err = Math.abs(signed);
    absErrs.push(err);
    if (err > maxAbsErr) maxAbsErr = err;
    if (signed > maxGpuMinusCpu) maxGpuMinusCpu = signed;
    if (signed < minGpuMinusCpu) minGpuMinusCpu = signed;
    const rel = err / Math.max(Math.abs(cpu), 0.05 * R);
    if (rel > maxRelErr) maxRelErr = rel;
    const tol = Math.max(2e-4 * R, 2e-3 * Math.max(Math.abs(cpu), 0.05 * R));
    if (err > tol) {
      failures++;
      if (signed > 0) failuresOver++;
      // The query mix's deterministic layout — see surfaceQueries.
      if (i < 400) failuresByClass.jittered++;
      else if (i < 600) failuresByClass.uniform++;
      else failuresByClass.exact++;
    }
  }
  absErrs.sort((a, b) => a - b);
  const p99AbsErr =
    absErrs.length > 0
      ? absErrs[Math.min(absErrs.length - 1, Math.floor(0.99 * absErrs.length))]
      : 0;
  return {
    system: sys.name,
    variant: cfg.variant,
    width: cfg.width,
    stage2: cfg.stage2,
    wg: cfg.wg,
    n: sys.cpu.length,
    maxAbsErr,
    maxRelErr,
    p99AbsErr,
    gating: cfg.width === SURFACE_FOLD_BEAM_WIDTH,
    failures,
    maxGpuMinusCpu: Number.isFinite(maxGpuMinusCpu) ? maxGpuMinusCpu : 0,
    minGpuMinusCpu: Number.isFinite(minGpuMinusCpu) ? minGpuMinusCpu : 0,
    failuresOver,
    failuresByClass,
  };
}

interface SurfaceMarchOutcome {
  states: Float32Array;
  gpuMs: number;
  wallMs: number;
  passes: number;
  truncated: boolean;
  activeRemaining: number;
}

/**
 * Drive one march config to completion (or the wall cap): bounded passes of
 * `stepsThisPass` DE steps each, gpuMs summed over the submit →
 * onSubmittedWorkDone span of each COMPUTE submission (the readback is its
 * own untimed submission), states read back and the active list
 * host-compacted between passes — brief §3.7's "compaction every N steps".
 */
async function runSurfaceMarchConfig(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  buffers: {
    params: GPUBuffer;
    states: GPUBuffer;
    active: GPUBuffer;
    staging: GPUBuffer;
  },
  de: SurfaceDE,
  pose: SurfaceGpuPose,
  wg: number,
  capMs: number,
  onProgress: (text: string) => void,
): Promise<SurfaceMarchOutcome> {
  const rays = pose.rasterWidth * pose.rasterHeight;
  const stateBytes = rays * 16;
  // Host-initialized ray states: (-1, 0, 0, 0) — t < 0 means the sphere
  // gate has not run yet (surface-de-gpu.ts's contract).
  const init = new Float32Array(rays * 4);
  for (let i = 0; i < rays; i++) init[i * 4] = -1;
  device.queue.writeBuffer(buffers.states, 0, init);
  let active = new Uint32Array(rays);
  for (let i = 0; i < rays; i++) active[i] = i;
  let states = init;
  let stepsThisPass = 1;
  let gpuMs = 0;
  let passes = 0;
  let truncated = false;
  const wallStart = performance.now();
  while (active.length > 0) {
    if (performance.now() - wallStart > capMs) {
      truncated = true;
      break;
    }
    const params = packSurfaceGpuParams(de, {
      itemCount: active.length,
      stepsThisPass,
      marchSteps: SURFACE_MARCH_STEPS,
      pose,
      cutoff: 0,
      footprint: 0,
    });
    device.queue.writeBuffer(buffers.params, 0, params);
    device.queue.writeBuffer(buffers.active, 0, active);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(active.length / wg));
    pass.end();
    const t0 = performance.now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const passMs = performance.now() - t0;
    gpuMs += passMs;
    passes++;
    const copyEncoder = device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(
      buffers.states,
      0,
      buffers.staging,
      0,
      stateBytes,
    );
    device.queue.submit([copyEncoder.finish()]);
    await buffers.staging.mapAsync(GPUMapMode.READ);
    states = new Float32Array(buffers.staging.getMappedRange().slice(0));
    buffers.staging.unmap();
    const next: number[] = [];
    for (let i = 0; i < active.length; i++) {
      const ray = active[i];
      if (states[ray * 4 + 1] === SURFACE_GPU_RAY_ACTIVE) next.push(ray);
    }
    active = Uint32Array.from(next);
    onProgress(
      `pass ${passes} (${stepsThisPass} steps): ${active.length}/${rays} active, ${passMs.toFixed(0)}ms`,
    );
    if (
      passMs < SURFACE_PASS_TARGET_MS &&
      stepsThisPass < SURFACE_MAX_STEPS_PER_PASS
    ) {
      stepsThisPass = Math.min(stepsThisPass * 2, SURFACE_MAX_STEPS_PER_PASS);
    }
  }
  return {
    states,
    gpuMs,
    wallMs: performance.now() - wallStart,
    passes,
    truncated,
    activeRemaining: active.length,
  };
}

function summarizeSurfaceMarch(
  states: Float32Array,
  rays: number,
): {
  hits: number;
  miss: number;
  exhausted: number;
  activeRemaining: number;
  meanSteps: number;
  stepsDone: number;
  activeSteps: number;
} {
  let hits = 0;
  let miss = 0;
  let exhausted = 0;
  let activeRemaining = 0;
  let stepsDone = 0;
  let activeSteps = 0;
  for (let i = 0; i < rays; i++) {
    const status = states[i * 4 + 1];
    const steps = states[i * 4 + 2];
    stepsDone += steps;
    if (status === SURFACE_GPU_RAY_HIT) hits++;
    else if (status === SURFACE_GPU_RAY_MISS) miss++;
    else if (status === SURFACE_GPU_RAY_EXHAUSTED) exhausted++;
    else {
      activeRemaining++;
      activeSteps += steps;
    }
  }
  return {
    hits,
    miss,
    exhausted,
    activeRemaining,
    meanSteps: rays > 0 ? stepsDone / rays : 0,
    stepsDone,
    activeSteps,
  };
}

/**
 * Leg A's own march loop: `runSurfaceMarchConfig`'s protocol (host-
 * initialized states, compaction between passes, gpuMs = Σ compute-submit
 * spans) with BOTH work axes bounded per submission — `stepsThisPass` AND
 * an active-list slice sized from the measured per-ray·step EMA against
 * `SURFACE_PASS_TARGET_MS` (see the SURFACE_UNPROJ_MIN_CHUNK doc for why
 * the timing legs' whole-list dispatch cannot be reused on a software
 * adapter). Steps double only after a MEASURED whole-sweep pass came in
 * under target, so a software adapter never talks itself into a 32-step
 * mega-dispatch.
 */
async function runSurfaceUnprojectMarch(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  buffers: {
    params: GPUBuffer;
    states: GPUBuffer;
    active: GPUBuffer;
    staging: GPUBuffer;
  },
  de: SurfaceDE,
  pose: SurfaceGpuPose,
  software: boolean,
  capMs: number,
  onProgress: (text: string) => void,
): Promise<SurfaceMarchOutcome> {
  const rays = pose.rasterWidth * pose.rasterHeight;
  const stateBytes = rays * 16;
  const init = new Float32Array(rays * 4);
  for (let i = 0; i < rays; i++) init[i * 4] = -1;
  device.queue.writeBuffer(buffers.states, 0, init);
  let active = new Uint32Array(rays);
  for (let i = 0; i < rays; i++) active[i] = i;
  let states = init;
  let stepsThisPass = 1;
  let emaUsPerRayStep = software
    ? SURFACE_UNPROJ_INITIAL_RAY_STEP_US_SW
    : SURFACE_COMPUTE_INITIAL_RAY_STEP_US;
  let gpuMs = 0;
  let passes = 0;
  let truncated = false;
  const wallStart = performance.now();
  outer: while (active.length > 0) {
    let sweptWhole = true;
    let lastPassMs = Infinity;
    for (let offset = 0; offset < active.length;) {
      if (performance.now() - wallStart > capMs) {
        truncated = true;
        break outer;
      }
      const budgetUs = SURFACE_PASS_TARGET_MS * 1000;
      const chunk = Math.min(
        Math.max(
          SURFACE_UNPROJ_MIN_CHUNK,
          Math.floor(
            budgetUs / Math.max(1e-3, emaUsPerRayStep * stepsThisPass),
          ),
        ),
        active.length - offset,
      );
      if (offset > 0 || chunk < active.length) sweptWhole = false;
      const slice = active.subarray(offset, offset + chunk);
      const params = packSurfaceGpuParams(de, {
        itemCount: slice.length,
        stepsThisPass,
        marchSteps: SURFACE_MARCH_STEPS,
        pose,
        cutoff: 0,
        footprint: 0,
      });
      device.queue.writeBuffer(buffers.params, 0, params);
      device.queue.writeBuffer(buffers.active, 0, slice);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(slice.length / SURFACE_COMPUTE_WORKGROUP_SIZE),
      );
      pass.end();
      const t0 = performance.now();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      lastPassMs = performance.now() - t0;
      gpuMs += lastPassMs;
      passes++;
      emaUsPerRayStep =
        emaUsPerRayStep * 0.6 +
        ((lastPassMs * 1000) / (slice.length * stepsThisPass)) * 0.4;
      offset += chunk;
    }
    const copyEncoder = device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(
      buffers.states,
      0,
      buffers.staging,
      0,
      stateBytes,
    );
    device.queue.submit([copyEncoder.finish()]);
    await buffers.staging.mapAsync(GPUMapMode.READ);
    states = new Float32Array(buffers.staging.getMappedRange().slice(0));
    buffers.staging.unmap();
    const next: number[] = [];
    for (const ray of active) {
      if (states[ray * 4 + 1] === SURFACE_GPU_RAY_ACTIVE) next.push(ray);
    }
    active = Uint32Array.from(next);
    onProgress(
      `pass ${passes} (${stepsThisPass} steps): ${active.length}/${rays} active, ` +
        `${lastPassMs.toFixed(0)}ms`,
    );
    if (
      sweptWhole &&
      lastPassMs < SURFACE_PASS_TARGET_MS &&
      stepsThisPass < SURFACE_MAX_STEPS_PER_PASS
    ) {
      stepsThisPass = Math.min(stepsThisPass * 2, SURFACE_MAX_STEPS_PER_PASS);
    }
  }
  return {
    states,
    gpuMs,
    wallMs: performance.now() - wallStart,
    passes,
    truncated,
    activeRemaining: active.length,
  };
}

/**
 * fr-tzdg leg A driver: compile the march kernel at the app's EXACT config
 * (`rays:"unproject"`, production width, private frontier, stage-2 off,
 * `SURFACE_COMPUTE_WORKGROUP_SIZE`), march the agreement raster to
 * completion through {@link runSurfaceUnprojectMarch}'s bounded host loop,
 * then emulate every ray on the CPU (f32 unproject + plain-estimateDistance
 * march) and gate statuses + hit `t` per ray. Throws on compile/buffer
 * failure — the caller notes it and fails the section.
 */
async function runSurfaceUnprojectLeg(
  device: GPUDevice,
  sys: SurfaceSystemState,
  software: boolean,
  status: (text: string) => void,
  activity: ActivityBadge,
): Promise<SurfaceUnprojectRow> {
  const width = SURFACE_UNPROJ_WIDTH;
  const height = SURFACE_UNPROJ_HEIGHT;
  const rays = width * height;
  const pose = buildSurfacePose(sys.de, width, height);
  const invProjView = surfaceInvProjView(sys.de, pose);

  activity.setState("gpu", "Surface march-unproject agreement");
  status("march-unproject: compiling…");
  const layout = surfaceUnprojectBindGroupLayout(device);
  const pipelineLayout = device.createPipelineLayout({
    label: "surface-de march-unproject pipeline layout",
    bindGroupLayouts: [layout],
  });
  const code = surfaceDeKernelWgsl({
    mode: "march",
    rays: "unproject",
    width: SURFACE_FOLD_BEAM_WIDTH,
    workgroupSize: SURFACE_COMPUTE_WORKGROUP_SIZE,
    sharedFrontier: false,
    bnbStage2: false,
  });
  const { pipeline, compileMs } = await buildSurfacePipeline(
    device,
    pipelineLayout,
    code,
    "marchRays",
    "surface-de march-unproject",
  );
  const params = await createSurfaceBuffer(
    device,
    "surface-de unproj params",
    SURFACE_GPU_PARAMS_BYTES,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  // Re-wrapped copy — see ensureSurfaceEvalBuffers' mapsData note.
  const mapsData = new Float32Array(packSurfaceGpuMaps(sys.de));
  const maps = await createSurfaceBuffer(
    device,
    "surface-de unproj maps",
    mapsData.byteLength,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  device.queue.writeBuffer(maps, 0, mapsData);
  const active = await createSurfaceBuffer(
    device,
    "surface-de unproj active",
    rays * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  );
  const states = await createSurfaceBuffer(
    device,
    "surface-de unproj states",
    rays * 16,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  );
  const staging = await createSurfaceBuffer(
    device,
    "surface-de unproj staging",
    rays * 16,
    GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  );
  const shade = await createSurfaceBuffer(
    device,
    "surface-de unproj shade",
    SURFACE_GPU_SHADE_BYTES,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  try {
    // Only invProjView and the dither flag reach the march arm (module
    // doc); the shading fields are packed inert. dither OFF so the run is
    // deterministic against the emulator.
    device.queue.writeBuffer(
      shade,
      0,
      packSurfaceGpuShade({
        invProjView,
        lightDir: [0, 1, 0],
        ambient: 0,
        bgTop: [0, 0, 0],
        bgBottom: [0, 0, 0],
        colorSpeed: 0.5,
        tracePixelEps: SURFACE_PIXEL_EPS,
        colorSource: 0,
        shadowSteps: 0,
        aoTaps: 0,
        dither: false,
      }),
    );
    const bindGroup = device.createBindGroup({
      label: "surface-de march-unproject bind group",
      layout,
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: maps } },
        { binding: 2, resource: { buffer: active } },
        { binding: 3, resource: { buffer: states } },
        { binding: 4, resource: { buffer: shade } },
      ],
    });
    console.info(
      `[surface-bench] march-unproject: compiled in ${compileMs.toFixed(0)}ms, marching ${String(rays)} rays…`,
    );
    const outcome = await runSurfaceUnprojectMarch(
      device,
      pipeline,
      bindGroup,
      { params, states, active, staging },
      sys.de,
      pose,
      software,
      SURFACE_UNPROJ_CAP_MS,
      (text) => status(`march-unproject: ${text}`),
    );
    console.info(
      `[surface-bench] march-unproject: march done — ${String(outcome.passes)} passes, ` +
        `${outcome.gpuMs.toFixed(0)}ms gpu${outcome.truncated ? ", TRUNCATED" : ""}`,
    );

    const boundaryFlipRule =
      "excluded from failures: (a) boundaryFlips — status mismatch with " +
      "|tGpu − tCpu| <= max(2e-4·R, 2e-3·max(|tCpu|, 0.05·R)): same " +
      "trajectory, terminal event reclassified by f32/f64 noise; (b) " +
      "hitTGrazes — both-hit rays over that t tolerance whose GPU endpoint " +
      "the CPU oracle confirms on-surface (estimateDistance(ro + rd·tGpu) " +
      "< 1.5·eps(tGpu)): a silhouette graze resolved to a different sheet. " +
      "Diverged trajectories and off-surface endpoints still fail.";
    const row: SurfaceUnprojectRow = {
      system: sys.name,
      width: SURFACE_FOLD_BEAM_WIDTH,
      wg: SURFACE_COMPUTE_WORKGROUP_SIZE,
      rasterWidth: width,
      rasterHeight: height,
      rays,
      statusMismatches: 0,
      boundaryFlips: 0,
      boundaryFlipRule,
      maxAbsT: 0,
      hitTGrazes: 0,
      hitTFailures: 0,
      failures: 0,
      gpuHits: 0,
      cpuHits: 0,
      compileMs,
      gpuMs: outcome.gpuMs,
      passes: outcome.passes,
      truncated: outcome.truncated,
    };
    if (outcome.truncated) {
      // A truncated march verifies nothing — the caller fails the leg on
      // this flag; comparing partially-marched rays would only muddy it.
      return row;
    }

    activity.setState("cpu", "Surface march-unproject CPU emulator");
    const ro: Vec3 = [
      Math.fround(pose.ro[0]),
      Math.fround(pose.ro[1]),
      Math.fround(pose.ro[2]),
    ];
    const cpuStatus = new Int32Array(rays);
    const cpuT = new Float64Array(rays);
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const rd = surfaceUnprojectRay(invProjView, px, py, width, height);
        const res = surfaceCpuMarchState(
          sys.de,
          ro,
          rd,
          pose.pixelEps,
          SURFACE_MARCH_STEPS,
        );
        const ray = py * width + px;
        cpuStatus[ray] = res.status;
        cpuT[ray] = res.t;
      }
      status(`march-unproject: cpu emulator row ${py + 1}/${height}…`);
      await new Promise<void>((resolve) => setTimeout(resolve));
    }

    const R = sys.de.boundingRadius;
    for (let ray = 0; ray < rays; ray++) {
      const gpuStatus = outcome.states[ray * 4 + 1];
      const gpuT = outcome.states[ray * 4];
      const cs = cpuStatus[ray];
      const ct = cpuT[ray];
      if (gpuStatus === SURFACE_GPU_RAY_HIT) row.gpuHits++;
      if (cs === SURFACE_GPU_RAY_HIT) row.cpuHits++;
      const tol = Math.max(2e-4 * R, 2e-3 * Math.max(Math.abs(ct), 0.05 * R));
      if (gpuStatus !== cs) {
        row.statusMismatches++;
        if (ct >= 0 && gpuT >= 0 && Math.abs(gpuT - ct) <= tol) {
          row.boundaryFlips++;
        }
      } else if (gpuStatus === SURFACE_GPU_RAY_HIT) {
        const err = Math.abs(gpuT - ct);
        if (err > row.maxAbsT) row.maxAbsT = err;
        if (err > tol) {
          // Divergent both-hit t. At a silhouette graze the two f32
          // trajectories legitimately resolve different sheets — one
          // fires d < eps on the near sheet where the other skims past
          // at d ≥ eps and hits deeper — so before failing, ask the CPU
          // oracle whether the GPU's endpoint is a genuine surface point
          // at its own acceptance eps. A phantom reads far above it
          // (kernel-vs-oracle noise here measures ~1e-5 abs; eps ~1e-2),
          // so 1.5·eps discriminates sharply and real disagreement still
          // fails. Measured need: 1 ray of 660 hits on Iris Xe.
          const px = ray % width;
          const py = Math.floor(ray / width);
          const rd = surfaceUnprojectRay(invProjView, px, py, width, height);
          const pGpu: Vec3 = [
            ro[0] + rd[0] * gpuT,
            ro[1] + rd[1] * gpuT,
            ro[2] + rd[2] * gpuT,
          ];
          const epsGpu = Math.max(
            pose.pixelEps * gpuT,
            R * SURFACE_GPU_HIT_FLOOR,
          );
          if (estimateDistance(sys.de, pGpu, epsGpu * 1.5) < epsGpu * 1.5) {
            row.hitTGrazes++;
          } else {
            row.hitTFailures++;
          }
        }
      }
    }
    row.failures = row.statusMismatches - row.boundaryFlips + row.hitTFailures;
    console.info(
      `[surface-bench] march-unproject: compared — statusMm=${String(row.statusMismatches)} ` +
        `boundary=${String(row.boundaryFlips)} graze=${String(row.hitTGrazes)} ` +
        `hitTFail=${String(row.hitTFailures)} ` +
        `maxAbsT=${row.maxAbsT.toExponential(2)} fail=${String(row.failures)}`,
    );
    return row;
  } finally {
    params.destroy();
    maps.destroy();
    active.destroy();
    states.destroy();
    staging.destroy();
    shade.destroy();
  }
}

/** The leg B presentation canvas, created once under the surface section
 * root (inside a labeled `.canvases` row so the headless runner's existing
 * per-scenario canvas screenshot loop picks it up) and reused on re-runs. */
function surfaceFrameCanvas(
  dom: SurfaceSectionDom,
  width: number,
  height: number,
): HTMLCanvasElement {
  let canvas = dom.root.querySelector<HTMLCanvasElement>(
    "canvas[data-surface-frame]",
  );
  if (!canvas) {
    const rowDiv = document.createElement("div");
    rowDiv.className = "canvases";
    const block = document.createElement("div");
    block.className = "canvas-block";
    canvas = document.createElement("canvas");
    canvas.dataset.surfaceFrame = "1";
    block.appendChild(canvas);
    const span = document.createElement("span");
    span.textContent = "SurfaceComputeRenderer frame (march + shade)";
    block.appendChild(span);
    rowDiv.appendChild(block);
    dom.root.insertBefore(rowDiv, dom.pre);
  }
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Present a compute frame's RGBA8 pixels — row 0 is the BOTTOM row
 * (surface-de-gpu.ts's ndcY convention), so rows flip into ImageData's
 * top-first order. */
function drawSurfaceComputeFrame(
  canvas: HTMLCanvasElement,
  pixels: Uint8Array,
  width: number,
  height: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    img.data.set(pixels.subarray(src, src + width * 4), y * width * 4);
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * fr-tzdg leg B driver: one end-to-end mandelboxKifs frame through the
 * PRODUCTION `SurfaceComputeRenderer` — its own device, its own march/shade
 * pipelines, the app's host loop — at full-tier knobs, presented onto the
 * section's canvas (progressively, like the app's settle presents). Colors
 * and trap indices copy main.ts's keying: each slot takes its BASE map's
 * "By Transform" color, trap coordinate `baseIndex / (n − 1)`. Throws on
 * renderer-creation failure or a null frame — the caller fails the section.
 */
async function runSurfaceComputeFrameLeg(
  sys: SurfaceSystemState,
  software: boolean,
  dom: SurfaceSectionDom,
  status: (text: string) => void,
  activity: ActivityBadge,
): Promise<SurfaceComputeFrameRow> {
  const width = software ? SURFACE_FRAME_WIDTH_SW : SURFACE_FRAME_WIDTH;
  const height = software ? SURFACE_FRAME_HEIGHT_SW : SURFACE_FRAME_HEIGHT;
  const budgetMs = software
    ? SURFACE_FRAME_BUDGET_SW_MS
    : SURFACE_FRAME_BUDGET_MS;
  const pose = buildSurfacePose(sys.de, width, height);
  const invProjView = surfaceInvProjView(sys.de, pose);
  const palette = transformColors(sys.transformCount);
  const colors = sys.de.maps.map((m) => palette[m.baseIndex]);
  const denom = Math.max(1, sys.transformCount - 1);
  const trapIndices = sys.de.maps.map((m) => m.baseIndex / denom);

  activity.setState("gpu", "Surface compute frame (app path)");
  status("compute frame: creating SurfaceComputeRenderer…");
  const renderer = await SurfaceComputeRenderer.create(
    sys.de,
    colors,
    trapIndices,
  );
  try {
    const canvas = surfaceFrameCanvas(dom, width, height);
    const spec: SurfaceComputeFrameSpec = {
      width,
      height,
      invProjView,
      camPos: pose.ro,
      // The harness's fixed acceptance slope (fr-7xgi semantics) — the
      // same eps leg A marched with; trace slope from this raster's own
      // height, scene.ts's convention.
      acceptPixelEps: SURFACE_PIXEL_EPS,
      tracePixelEps:
        (2 * Math.tan((SURFACE_POSE_FOV_DEG * Math.PI) / 360)) / height,
      maxDepth: sys.de.maxDepth,
      marchSteps: SURFACE_MARCH_STEPS,
      shadowSteps: SURFACE_FRAME_SHADOW_STEPS,
      aoTaps: SURFACE_FRAME_AO_TAPS,
      hitFloor: SURFACE_GPU_HIT_FLOOR,
      lightDir: surfaceNormalize([0.5, 0.8, 0.3]),
      ambient: 0.25,
      colorSource: 0,
      colorSpeed: 0.5,
      lut: null,
      lutVersion: 0,
      dither: true,
    };
    status(`compute frame: rendering ${width}x${height}…`);
    console.info(
      `[surface-bench] compute frame: rendering ${String(width)}x${String(height)} (budget ${String(budgetMs)}ms)…`,
    );
    const frame = await renderer.renderFrame(spec, {
      budgetMs,
      onProgress: (pixels) => {
        drawSurfaceComputeFrame(canvas, pixels, width, height);
      },
    });
    if (!frame) {
      throw new Error(
        "renderFrame resolved null — the app path produced no frame",
      );
    }
    console.info(
      `[surface-bench] compute frame: done — ${String(frame.passes)} passes, ` +
        `${frame.wallMs.toFixed(0)}ms wall, hit=${String(frame.counts.hit)}` +
        `${frame.truncated ? ", TRUNCATED" : ""}`,
    );
    drawSurfaceComputeFrame(canvas, frame.pixels, width, height);
    return {
      width: frame.width,
      height: frame.height,
      wallMs: frame.wallMs,
      gpuMs: frame.gpuMs,
      passes: frame.passes,
      truncated: frame.truncated,
      counts: frame.counts,
    };
  } finally {
    renderer.destroy();
  }
}

interface SurfaceSectionDom {
  root: HTMLElement;
  status: HTMLElement;
  pre: HTMLPreElement;
}

function buildSurfaceSectionDom(container: HTMLElement): SurfaceSectionDom {
  const root = document.createElement("div");
  root.className = "scenario";
  const heading = document.createElement("h2");
  heading.textContent = "surface-de (fr-q1f8) — ";
  const status = document.createElement("span");
  status.className = "status";
  status.textContent = "idle";
  heading.appendChild(status);
  root.appendChild(heading);
  const pre = document.createElement("pre");
  root.appendChild(pre);
  container.appendChild(root);
  return { root, status, pre };
}

/**
 * The section driver: CPU oracles first (no GPU needed), then one device
 * for every GPU leg — the agreement protocol (always), the cross-checks,
 * and the march timing protocol (mandelboxKifs only; auto-skipped on
 * software adapters unless forced). Never throws: unavailable WebGPU is a
 * "skipped" verdict, anything after device acquisition that breaks is a
 * "fail" with the error in `reason`/`notes`.
 */
async function runSurfaceDeSection(
  config: SurfaceSectionConfig,
  dom: SurfaceSectionDom,
  activity: ActivityBadge,
  onUpdate: (results: SurfaceDeResults) => void,
): Promise<SurfaceDeResults> {
  const results: SurfaceDeResults = {
    verdict: "skipped",
    adapter: null,
    limits: {},
    agreement: [],
    crossChecks: [],
    timing: [],
    notes: [],
  };
  const render = (): void => {
    dom.pre.textContent = JSON.stringify(results, null, 2);
    onUpdate(results);
  };
  const status = (text: string): void => {
    dom.status.textContent = text;
  };

  // ----- Systems + CPU oracle (pure CPU, before any GPU acquisition) -----
  const systemDefs: { name: string; transforms: Transform[] }[] = [];
  if (config.systems !== "synthetic") {
    systemDefs.push({ name: "mandelboxKifs", transforms: mandelboxKifs() });
  }
  systemDefs.push(
    { name: "foldSpherefoldPair", transforms: surfaceFoldSpherefoldPair() },
    {
      name: "foldBoxfoldNegPlusAffine",
      transforms: surfaceFoldBoxfoldNegPlusAffine(),
    },
  );
  const systems: SurfaceSystemState[] = [];
  for (const def of systemDefs) {
    status(`cpu oracle: ${def.name}…`);
    activity.setState("cpu", `Surface CPU oracle — ${def.name}`);
    await new Promise<void>((resolve) => setTimeout(resolve));
    try {
      const de = buildSurfaceDE(def.transforms, null);
      if (!deHasFolds(de)) {
        results.notes.push(
          `${def.name}: skipped — no fold maps (this section pins the fold frontier)`,
        );
        continue;
      }
      const queries = surfaceQueries(def.transforms, de.boundingRadius);
      // CPU oracle: PLAIN estimateDistance (refine=false), cutoff 0 — the
      // estimator the kernel mirrors term for term. NOT
      // estimateDistanceRefined.
      const cpu = queries.map((q) => estimateDistance(de, q, 0));
      systems.push({
        name: def.name,
        de,
        transformCount: def.transforms.length,
        queries,
        cpu,
      });
    } catch (e) {
      results.notes.push(`${def.name}: skipped — ${describeError(e)}`);
    }
    render();
  }
  if (systems.length === 0) {
    results.reason = "no eligible fold systems (see notes)";
    status(`skipped — ${results.reason}`);
    activity.setState("idle", "Done");
    render();
    return results;
  }

  // ----- Config matrices -----
  const evalConfigs: SurfaceKernelConfig[] = [];
  for (const variant of config.variants) {
    for (const width of config.agreementWidths) {
      evalConfigs.push({
        variant,
        width,
        stage2: true,
        wg: surfaceWgFor(config, variant),
      });
    }
  }
  // The stage2=false control: shared width 12 by the brief; when the width
  // list is overridden the FIRST agreement width stands in so the on-vs-off
  // comparison always has its stage2=true twin.
  const stage2OffVariant: SurfaceVariant = config.variants.includes("shared")
    ? "shared"
    : config.variants[0];
  const stage2OffWidth = config.agreementWidths[0];
  evalConfigs.push({
    variant: stage2OffVariant,
    width: stage2OffWidth,
    stage2: false,
    wg: surfaceWgFor(config, stage2OffVariant),
  });

  const timingConfigs: SurfaceKernelConfig[] = [];
  if (config.timing) {
    for (const variant of config.variants) {
      for (const width of config.timingWidths) {
        timingConfigs.push({
          variant,
          width,
          stage2: true,
          wg: surfaceWgFor(config, variant),
        });
      }
    }
    const timingS2OffWidth = config.timingWidths.includes(12)
      ? 12
      : config.timingWidths[0];
    for (const variant of config.variants) {
      timingConfigs.push({
        variant,
        width: timingS2OffWidth,
        stage2: false,
        wg: surfaceWgFor(config, variant),
      });
    }
  }

  // ----- Device -----
  let neededWorkgroupBytes = 0;
  for (const cfg of [...evalConfigs, ...timingConfigs]) {
    if (cfg.variant === "shared") {
      neededWorkgroupBytes = Math.max(
        neededWorkgroupBytes,
        surfaceGpuWorkgroupBytes({
          width: cfg.width,
          workgroupSize: cfg.wg,
          sharedFrontier: true,
        }),
      );
    }
  }
  status("acquiring WebGPU device…");
  const acquired = await acquireSurfaceDevice(neededWorkgroupBytes);
  if ("skipped" in acquired) {
    results.reason = acquired.skipped;
    status(`skipped — ${acquired.skipped}`);
    activity.setState("idle", "Done");
    render();
    return results;
  }
  const { device } = acquired;
  results.adapter = acquired.adapterInfo;
  results.limits = acquired.limits;
  let compileFailed = false;

  const configLabel = (cfg: SurfaceKernelConfig): string =>
    `${cfg.variant} w${cfg.width} s2=${cfg.stage2 ? "on" : "off"} wg${cfg.wg}`;
  const workgroupBytesFor = (cfg: SurfaceKernelConfig): number =>
    cfg.variant === "shared"
      ? surfaceGpuWorkgroupBytes({
          width: cfg.width,
          workgroupSize: cfg.wg,
          sharedFrontier: true,
        })
      : 0;

  try {
    const bindGroupLayout = surfaceBindGroupLayout(device);
    const pipelineLayout = device.createPipelineLayout({
      label: "surface-de pipeline layout",
      bindGroupLayouts: [bindGroupLayout],
    });

    // ----- Agreement protocol (the correctness pin — always runs) -----
    const gpuByKey = new Map<string, Float32Array>();
    for (const cfg of evalConfigs) {
      const label = configLabel(cfg);
      const bytes = workgroupBytesFor(cfg);
      if (bytes > device.limits.maxComputeWorkgroupStorageSize) {
        results.notes.push(
          `agreement ${label}: skipped — needs ${bytes} workgroup bytes, ` +
            `device grants ${device.limits.maxComputeWorkgroupStorageSize}`,
        );
        render();
        continue;
      }
      status(`agreement: compiling ${label}…`);
      activity.setState("gpu", `Surface DE agreement — ${label}`);
      let pipeline: GPUComputePipeline;
      try {
        const code = surfaceDeKernelWgsl({
          mode: "eval",
          width: cfg.width,
          workgroupSize: cfg.wg,
          sharedFrontier: cfg.variant === "shared",
          bnbStage2: cfg.stage2,
        });
        ({ pipeline } = await buildSurfacePipeline(
          device,
          pipelineLayout,
          code,
          "evalQueries",
          `surface-de eval ${label}`,
        ));
      } catch (e) {
        compileFailed = true;
        results.notes.push(`agreement ${label}: ${describeError(e)}`);
        render();
        continue;
      }
      for (const sys of systems) {
        status(`agreement: ${label} × ${sys.name}…`);
        await ensureSurfaceEvalBuffers(device, bindGroupLayout, sys);
        const gpu = await runSurfaceEvalDispatch(device, pipeline, sys, cfg.wg);
        gpuByKey.set(
          `${sys.name}|${cfg.variant}|${cfg.width}|${String(cfg.stage2)}`,
          gpu,
        );
        results.agreement.push(compareSurfaceAgreement(sys, cfg, gpu));
        render();
        await new Promise<void>((resolve) => setTimeout(resolve));
      }
    }

    // ----- Cross-checks -----
    if (
      config.variants.includes("shared") &&
      config.variants.includes("private")
    ) {
      for (const sys of systems) {
        for (const width of config.agreementWidths) {
          const a = gpuByKey.get(`${sys.name}|shared|${width}|true`);
          const b = gpuByKey.get(`${sys.name}|private|${width}|true`);
          if (!a || !b) continue;
          let mismatches = 0;
          let maxDelta = 0;
          for (let i = 0; i < a.length; i++) {
            if (!Object.is(a[i], b[i])) {
              mismatches++;
              maxDelta = Math.max(maxDelta, Math.abs(a[i] - b[i]));
            }
          }
          results.crossChecks.push({
            kind: "shared-vs-private",
            system: sys.name,
            width,
            n: a.length,
            mismatches,
            maxDelta,
            note:
              mismatches === 0
                ? "exact — same arithmetic, different frontier storage"
                : "MISMATCH — shared and private must be bit-equal at identical (width, stage2)",
          });
        }
      }
    }
    for (const sys of systems) {
      const on = gpuByKey.get(
        `${sys.name}|${stage2OffVariant}|${stage2OffWidth}|true`,
      );
      const off = gpuByKey.get(
        `${sys.name}|${stage2OffVariant}|${stage2OffWidth}|false`,
      );
      if (!on || !off) continue;
      let mismatches = 0;
      let maxDelta = 0;
      for (let i = 0; i < on.length; i++) {
        if (!Object.is(on[i], off[i])) {
          mismatches++;
          maxDelta = Math.max(maxDelta, Math.abs(on[i] - off[i]));
        }
      }
      results.crossChecks.push({
        kind: "stage2-on-vs-off",
        system: sys.name,
        width: stage2OffWidth,
        n: on.length,
        mismatches,
        maxDelta,
        note: "informational — the skips are value no-ops, but f32 rounding may flip marginal skips; not verdict-affecting",
      });
    }
    render();

    // ----- Leg A (fr-tzdg): march-unproject agreement — GATING -----
    // The app path's ray derivation against the CPU emulator, at the exact
    // kernel config SurfaceComputeRenderer compiles. An agreement gate, so
    // it runs on software adapters too (the CI path), like the eval legs.
    let unprojFailed = false;
    {
      const sys = systems.find((s) => s.name === "mandelboxKifs") ?? systems[0];
      try {
        const row = await runSurfaceUnprojectLeg(
          device,
          sys,
          acquired.software,
          status,
          activity,
        );
        results.marchUnproject = row;
        if (row.truncated) {
          unprojFailed = true;
          results.notes.push(
            `march-unproject: truncated at ${SURFACE_UNPROJ_CAP_MS}ms — ` +
              "agreement not verifiable, failing the leg",
          );
        } else if (row.failures > 0) {
          unprojFailed = true;
        }
      } catch (e) {
        unprojFailed = true;
        results.marchUnproject = { skipped: describeError(e) };
        results.notes.push(`march-unproject: ${describeError(e)}`);
      }
      render();
    }

    // ----- Timing protocol (march — the §3.7 measurement) -----
    if (!config.timing) {
      results.notes.push("timing: skipped (surfaceTiming=0)");
    } else if (config.systems === "synthetic") {
      results.notes.push(
        "timing: skipped — mandelboxKifs excluded (surfaceSystems=synthetic)",
      );
    } else if (acquired.software && !config.force) {
      results.notes.push(
        "timing: skipped — software WebGPU adapter (timings would not be representative; pass surfaceForce=1 to run anyway)",
      );
    } else {
      const mbox = systems.find((s) => s.name === "mandelboxKifs");
      if (!mbox) {
        results.notes.push(
          "timing: skipped — mandelboxKifs did not build (see notes)",
        );
      } else {
        const pose = buildSurfacePose(
          mbox.de,
          config.rasterWidth,
          config.rasterHeight,
        );
        const rays = config.rasterWidth * config.rasterHeight;

        // CPU sanity reference — ONCE, not per config: gridless plain-DE
        // march of every 8th pixel in both axes at the same pose/eps/budget.
        activity.setState("cpu", "Surface CPU sanity march");
        const sanityPixels = surfaceSanityPixels(
          config.rasterWidth,
          config.rasterHeight,
        );
        const cpuHit = new Set<number>();
        for (let i = 0; i < sanityPixels.length; i++) {
          const ray = sanityPixels[i];
          const px = ray % config.rasterWidth;
          const py = Math.floor(ray / config.rasterWidth);
          if (
            surfaceCpuMarch(
              mbox.de,
              pose.ro,
              surfaceRayDir(pose, px, py),
              pose.pixelEps,
              SURFACE_MARCH_STEPS,
            )
          ) {
            cpuHit.add(ray);
          }
          if (i % 32 === 31) {
            status(`timing: cpu sanity march ${i + 1}/${sanityPixels.length}…`);
            await new Promise<void>((resolve) => setTimeout(resolve));
          }
        }
        const cpuHitRate = cpuHit.size / sanityPixels.length;
        results.notes.push(
          `cpu sanity march: ${cpuHit.size}/${sanityPixels.length} sampled pixels hit (rate ${cpuHitRate.toFixed(3)})`,
        );
        render();

        const marchParams = await createSurfaceBuffer(
          device,
          "surface-de march params",
          SURFACE_GPU_PARAMS_BYTES,
          GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        );
        // Re-wrapped copy — see ensureSurfaceEvalBuffers' mapsData note.
        const mapsData = new Float32Array(packSurfaceGpuMaps(mbox.de));
        const marchMaps = await createSurfaceBuffer(
          device,
          "surface-de march maps",
          mapsData.byteLength,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        );
        device.queue.writeBuffer(marchMaps, 0, mapsData);
        const marchActive = await createSurfaceBuffer(
          device,
          "surface-de march active list",
          rays * 4,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        );
        const marchStates = await createSurfaceBuffer(
          device,
          "surface-de march states",
          rays * 16,
          GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_DST |
            GPUBufferUsage.COPY_SRC,
        );
        const marchStaging = await createSurfaceBuffer(
          device,
          "surface-de march staging",
          rays * 16,
          GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        );
        const marchBindGroup = device.createBindGroup({
          label: "surface-de march bind group",
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: marchParams } },
            { binding: 1, resource: { buffer: marchMaps } },
            { binding: 2, resource: { buffer: marchActive } },
            { binding: 3, resource: { buffer: marchStates } },
          ],
        });
        try {
          for (const cfg of timingConfigs) {
            const label = configLabel(cfg);
            const bytes = workgroupBytesFor(cfg);
            if (bytes > device.limits.maxComputeWorkgroupStorageSize) {
              results.notes.push(
                `timing ${label}: skipped — needs ${bytes} workgroup bytes, ` +
                  `device grants ${device.limits.maxComputeWorkgroupStorageSize}`,
              );
              render();
              continue;
            }
            status(`timing: compiling ${label}…`);
            activity.setState("gpu", `Surface DE march — ${label}`);
            let pipeline: GPUComputePipeline;
            let compileMs: number;
            try {
              const code = surfaceDeKernelWgsl({
                mode: "march",
                width: cfg.width,
                workgroupSize: cfg.wg,
                sharedFrontier: cfg.variant === "shared",
                bnbStage2: cfg.stage2,
              });
              ({ pipeline, compileMs } = await buildSurfacePipeline(
                device,
                pipelineLayout,
                code,
                "marchRays",
                `surface-de march ${label}`,
              ));
            } catch (e) {
              compileFailed = true;
              results.notes.push(`timing ${label}: ${describeError(e)}`);
              render();
              continue;
            }
            const outcome = await runSurfaceMarchConfig(
              device,
              pipeline,
              marchBindGroup,
              {
                params: marchParams,
                states: marchStates,
                active: marchActive,
                staging: marchStaging,
              },
              mbox.de,
              pose,
              cfg.wg,
              config.capMs,
              (text) => status(`timing ${label}: ${text}`),
            );
            const summary = summarizeSurfaceMarch(outcome.states, rays);
            const row: SurfaceTimingRow = {
              variant: cfg.variant,
              width: cfg.width,
              stage2: cfg.stage2,
              wg: cfg.wg,
              rays,
              hits: summary.hits,
              miss: summary.miss,
              exhausted: summary.exhausted,
              activeRemaining: summary.activeRemaining,
              meanSteps: summary.meanSteps,
              gpuMs: outcome.gpuMs,
              wallMs: outcome.wallMs,
              compileMs,
              passes: outcome.passes,
              truncated: outcome.truncated,
            };
            let sampledHits = 0;
            for (const ray of sanityPixels) {
              if (outcome.states[ray * 4 + 1] === SURFACE_GPU_RAY_HIT) {
                sampledHits++;
              }
            }
            row.gpuHitRate = sampledHits / sanityPixels.length;
            row.cpuHitRate = cpuHitRate;
            if (outcome.truncated) {
              row.completedFraction =
                rays > 0 ? (rays - summary.activeRemaining) / rays : 1;
              // Fraction of projected ray-steps done, assuming every
              // still-active ray runs to the full budget — an
              // EXTRAPOLATION (upper-bound completion), labeled as such.
              const projected =
                summary.stepsDone +
                summary.activeRemaining * SURFACE_MARCH_STEPS -
                summary.activeSteps;
              const fraction =
                projected > 0 ? summary.stepsDone / projected : 0;
              if (fraction > 0 && Number.isFinite(outcome.gpuMs / fraction)) {
                row.extrapolatedMs = outcome.gpuMs / fraction;
              }
              row.sanity = "skipped (truncated)";
            } else {
              row.sanity =
                Math.abs(row.gpuHitRate - cpuHitRate) >
                SURFACE_SANITY_HIT_RATE_TOL
                  ? "suspect"
                  : "ok";
            }
            results.timing.push(row);
            render();
            await new Promise<void>((resolve) => setTimeout(resolve));
          }
        } finally {
          marchParams.destroy();
          marchMaps.destroy();
          marchActive.destroy();
          marchStates.destroy();
          marchStaging.destroy();
        }
      }
    }

    // ----- Leg B (fr-tzdg): end-to-end frame via SurfaceComputeRenderer --
    // The production app loop on its own device; informational except the
    // two documented conditions. Runs on software adapters too (shrunken
    // raster, stretched budget, truncation accepted — see the constants).
    let frameFailed = false;
    {
      const mbox = systems.find((s) => s.name === "mandelboxKifs");
      if (!mbox) {
        results.computeFrame = {
          skipped:
            "mandelboxKifs did not build or was excluded (surfaceSystems=synthetic)",
        };
      } else {
        try {
          const row = await runSurfaceComputeFrameLeg(
            mbox,
            acquired.software,
            dom,
            status,
            activity,
          );
          results.computeFrame = row;
          if (row.counts.hit === 0 && !acquired.software) {
            // A settled mandelboxKifs frame with zero hit rays on real
            // hardware means the app path is broken, not slow.
            frameFailed = true;
            results.notes.push(
              "compute frame: zero hit rays on a real adapter — failing the leg",
            );
          }
          if (row.truncated) {
            results.notes.push(
              `compute frame: truncated at its ${acquired.software ? SURFACE_FRAME_BUDGET_SW_MS : SURFACE_FRAME_BUDGET_MS}ms budget` +
                (acquired.software
                  ? " — accepted on a software adapter"
                  : " — informational (only hit=0 or a null frame gate)"),
            );
          }
        } catch (e) {
          frameFailed = true;
          results.computeFrame = { skipped: describeError(e) };
          results.notes.push(`compute frame: ${describeError(e)}`);
        }
      }
      render();
    }

    // ----- Verdict -----
    // Only production-width rows gate: the CPU oracle's fold frontier is
    // the fixed SURFACE_FOLD_BEAM_WIDTH scratch, so narrower-width rows
    // measure the expected fr-5rvk erosion, not kernel disagreement (see
    // SurfaceAgreementRow.gating).
    const anyAgreementFail = results.agreement.some(
      (r) => r.gating && r.failures > 0,
    );
    const anyCrossFail = results.crossChecks.some(
      (c) => c.kind === "shared-vs-private" && c.mismatches > 0,
    );
    const gatingRows = results.agreement.filter((r) => r.gating);
    const unprojRan =
      results.marchUnproject !== undefined &&
      !("skipped" in results.marchUnproject);
    if (
      compileFailed ||
      anyAgreementFail ||
      anyCrossFail ||
      unprojFailed ||
      frameFailed
    ) {
      results.verdict = "fail";
      results.reason = compileFailed
        ? "kernel compile/pipeline failure — WGSL errors verbatim in notes"
        : anyAgreementFail
          ? "agreement tolerance failures — see agreement rows"
          : anyCrossFail
            ? "shared-vs-private exact-equality mismatch — see crossChecks"
            : unprojFailed
              ? "march-unproject (app ray path) agreement failure — see marchUnproject/notes"
              : "compute-frame (app path) failure — see computeFrame/notes";
    } else if (gatingRows.length === 0 && !unprojRan) {
      // Informational-only rows (all widths ≠ SURFACE_FOLD_BEAM_WIDTH) and
      // no march-unproject gate verify nothing against a like-for-like
      // oracle — refuse to certify.
      results.verdict = "skipped";
      results.reason = `no agreement row ran at the oracle width ${SURFACE_FOLD_BEAM_WIDTH} (see notes)`;
    } else {
      results.verdict = "pass";
    }
  } catch (e) {
    results.verdict = "fail";
    results.reason = `section error: ${describeError(e)}`;
  } finally {
    for (const sys of systems) destroySurfaceEvalBuffers(sys);
    device.destroy();
  }
  status(results.verdict + (results.reason ? ` — ${results.reason}` : ""));
  activity.setState("idle", "Done");
  render();
  return results;
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
  // fr-q1f8: `surface=1` runs the surface-DE section AFTER the flame
  // scenarios; `surface=only` runs it INSTEAD of them. Absent (the CI
  // case), the flame pipeline below is bit-for-bit unchanged.
  const surfaceMode = params.get("surface");
  const surfaceConfig = parseSurfaceConfig(params);
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
  const surfaceDom = buildSurfaceSectionDom(
    requireElement<HTMLDivElement>("surfaceSection"),
  );

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

  async function runSurfaceSection(): Promise<void> {
    // Incremental publishing: partial surface results are visible on
    // __BENCH_RESULTS__ while the (potentially long) section runs.
    await runSurfaceDeSection(surfaceConfig, surfaceDom, activity, (r) => {
      benchResults.surfaceDe = r;
      renderResults();
    });
  }

  async function runAll(): Promise<void> {
    if (running) return;
    running = true;
    setButtonsDisabled(true);
    try {
      // fr-q1f8: `?surface=only` replaces the flame sweep with the
      // surface-DE section; without the param this branch is the unchanged
      // CI path.
      if (surfaceMode !== "only") {
        for (const def of activeScenarios) {
          const dom = domByName.get(def.name);
          if (!dom) continue;
          recordResult(
            await runScenario(def, dom, currentDuration(), activity),
          );
        }
        // fr-ee9: the standalone ss=1 display-downsample check — always run
        // as part of a full sweep (independent of any ?scenarios= filter
        // above), since it is the only leg that exercises the scale-1
        // pass-through path at all (see runSs1DisplayDownsampleCheck's doc),
        // and the headless runner's agreement verdict is meant to certify
        // the WHOLE kernel, not just whichever named scenarios were
        // requested.
        activity.setState("gpu", "GPU ss=1 check…");
        benchResults.ss1DisplayDownsample =
          await runSs1DisplayDownsampleCheck();
        activity.setState("idle", "Done");
        recomputeAgreement();
        renderResults();
      }
      if (surfaceMode !== null) {
        await runSurfaceSection();
      }
    } finally {
      running = false;
      setButtonsDisabled(false);
    }
  }

  async function runSurfaceOnly(): Promise<void> {
    if (running) return;
    running = true;
    setButtonsDisabled(true);
    try {
      await runSurfaceSection();
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
  const surfaceBtn = document.createElement("button");
  surfaceBtn.type = "button";
  surfaceBtn.textContent = "Run surface DE";
  surfaceBtn.addEventListener("click", () => {
    void runSurfaceOnly();
  });
  scenarioButtons.appendChild(surfaceBtn);
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
